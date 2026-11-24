import { after, NextResponse } from "next/server";

import { readJsonBodyResult } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { getAgentRun, updateAgentRunById } from "@/lib/server/agent-run-store";
import { failedAgentTaskRetryOps, prepareFailedAgentTaskRetry } from "@/lib/server/agent-run-task-input";
import { agentTaskCopies } from "@/lib/server/agent-run-validation";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { publicAgentRun } from "@/lib/server/agent-run-public";
import { quoteAgentVideoTasks } from "@/lib/server/agent-run-video-quotes";
import { maintenanceWorkerContext, requestRuntimeCredential } from "@/lib/server/maintenance-auth";

export const maxDuration = 2400;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const { id, taskId } = await params;
    const parsed = await readJsonBodyResult<{ conversationId?: unknown; taskIds?: unknown }>(request);
    if (!parsed.ok) return NextResponse.json({ code: parsed.status, data: null, msg: parsed.message }, { status: parsed.status });
    const expectedConversationId = typeof parsed.data?.conversationId === "string" ? parsed.data.conversationId.trim() : "";
    if (parsed.data?.conversationId !== undefined && !expectedConversationId) return NextResponse.json({ code: 400, data: null, msg: "对话标识无效" }, { status: 400 });
    const run = await getAgentRun(id);
    if (!run || (run.userId !== user.id && user.role !== "admin")) return NextResponse.json({ code: 404, data: null, msg: "Agent 任务不存在" }, { status: 404 });
    const ownerCredential = resolveAgentRunCredential(request, run, user);
    if (ownerCredential === null) return NextResponse.json({ code: 503, data: null, msg: "管理员代操作需要配置独立 Worker 令牌" }, { status: 503 });
    if (expectedConversationId && run.conversationId !== expectedConversationId) return NextResponse.json({ code: 409, data: null, msg: "当前对话与 Agent 任务不匹配" }, { status: 409 });
    if (run.status !== "failed" && run.status !== "completed") return NextResponse.json({ code: 409, data: { run: publicAgentRun(run) }, msg: "Agent 任务状态已变化，请刷新后重试" }, { status: 409 });
    const requestedTaskIds = normalizeTaskIds(parsed.data?.taskIds, taskId);
    if (!requestedTaskIds || requestedTaskIds[0] !== taskId) return NextResponse.json({ code: 400, data: null, msg: "失败任务标识无效" }, { status: 400 });
    const requestedTaskIdSet = new Set(requestedTaskIds);
    const requestedTasks = run.tasks.filter((item) => requestedTaskIdSet.has(item.id));
    if (requestedTasks.length !== requestedTaskIds.length || requestedTasks.some((task) => task.status !== "failed")) return NextResponse.json({ code: 409, data: null, msg: "只有失败任务可以重试" }, { status: 409 });
    const settings = await getAuthSettings();
    const limit = settings.generationConcurrency.agent;
    let tasks = run.tasks.map((item) => {
        if (!requestedTaskIdSet.has(item.id)) return item;
        const completedChildren = item.childTasks?.filter((child) => child.status === "completed") || [];
        return prepareFailedAgentTaskRetry(
            run,
            {
                ...item,
                status: "ready" as const,
                attempts: Math.max(1, item.attempts || 0),
                taskId: completedChildren.at(-1)?.id,
                taskIds: completedChildren.length ? completedChildren.map((child) => child.id) : undefined,
                childTasks: completedChildren.length ? completedChildren : undefined,
                result: undefined,
                error: undefined,
                videoQuotes: undefined,
            },
            settings,
        );
    });
    const retriedTasks = tasks.filter((item) => requestedTaskIdSet.has(item.id));
    const retryVideoTasks = new Set(retriedTasks.filter((task) => task.type === "video").map((task) => task.id));
    const copyIndexes = new Map(retriedTasks.filter((task) => task.type === "video").map((task) => {
        const completed = new Set((task.childTasks || []).filter((child) => child.status === "completed").map((child, index) => child.copyIndex || index + 1));
        return [task.id, Array.from({ length: agentTaskCopies("video", task.count) }, (_, index) => index + 1).filter((copyIndex) => !completed.has(copyIndex))];
    }));
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const cookie = ownerCredential;
    let videoQuoteDigest: string | undefined;
    if (retryVideoTasks.size) {
        try {
            const quotePlan = await quoteAgentVideoTasks({ run, tasks, origin, cookie, settings, taskIds: retryVideoTasks, copyIndexes });
            tasks = quotePlan.tasks;
            videoQuoteDigest = quotePlan.videoQuoteDigest;
        } catch (error) {
            return NextResponse.json({ code: 409, data: { run: publicAgentRun(run) }, msg: error instanceof Error ? error.message : "视频报价暂时无法核实" }, { status: 409 });
        }
    } else {
        tasks = tasks.map((item) => (requestedTaskIdSet.has(item.id) ? { ...item, videoQuotes: undefined } : item));
    }
    const nextStatus = videoQuoteDigest ? "awaiting_confirmation" : "running";
    const mutate = async () => ({
        updated: await updateAgentRunById(
            run.id,
            { status: nextStatus, tasks, videoQuoteDigest, failure: undefined, failureStage: undefined, candidateFailures: undefined },
            { type: videoQuoteDigest ? "task.retry.quote_confirmation_required" : "task.retry.requested", data: { taskId, taskIds: requestedTaskIds, quoteDigest: videoQuoteDigest, ops: retriedTasks.flatMap((task) => failedAgentTaskRetryOps(run, task)) } },
            [run.status],
        ),
    });
    const result = videoQuoteDigest ? await mutate() : await withGenerationConcurrencyLimit(run.userId, "agent", 10 * 60 * 1000, limit, mutate, run.id);
    if (result === null) return NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${limit} 个 Agent 任务` }, { status: 429 });
    const { updated } = result;
    if (!updated) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    await scheduleGenerationTask("agent", updated.id, videoQuoteDigest ? { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "awaiting_confirmation" } : { executionPhase: "created", nextPollAt: Date.now(), lastUpstreamStatus: "task_retry" });
    if (!videoQuoteDigest) after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [updated.id] }));
    return NextResponse.json({ code: 0, data: { run: publicAgentRun(updated) }, msg: "OK" });
}

function normalizeTaskIds(value: unknown, fallbackTaskId: string) {
    if (value === undefined) return [fallbackTaskId];
    if (!Array.isArray(value)) return null;
    const taskIds = Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)));
    return taskIds.length ? taskIds : null;
}

function resolveAgentRunCredential(request: Request, run: Awaited<ReturnType<typeof getAgentRun>>, user: { id: string; role: string }) {
    if (!run) return "";
    if (run.userId === user.id) return requestRuntimeCredential(request, run.userId);
    if (user.role !== "admin") return null;
    try {
        return maintenanceWorkerContext(run.userId);
    } catch {
        return null;
    }
}
