import { after, NextResponse } from "next/server";
import { readJsonBodyResult } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { abortAgentRun } from "@/lib/server/agent-run-executor";
import { getAgentRun, setAgentRunStatus, updateAgentRunById, type AgentRun, type AgentRunStatus } from "@/lib/server/agent-run-store";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { publicAgentRun } from "@/lib/server/agent-run-public";
import { agentRunVideoQuoteDigest, agentRunVideoQuotePriceDigest, agentVideoQuotesExpired, quoteAgentVideoTasks } from "@/lib/server/agent-run-video-quotes";
import { agentTaskExecutionAttempt, agentTaskUnsubmittedVideoQuoteCopyIndexes } from "@/lib/server/agent-run-execution-helpers";
import { maintenanceWorkerContext, maintenanceWorkerContextHeaders, requestRuntimeCredential } from "@/lib/server/maintenance-auth";

export const maxDuration = 2400;

const actions: Record<string, AgentRunStatus> = { pause: "paused", resume: "running" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const { id, action } = await params;
    const parsed = await readJsonBodyResult<{ conversationId?: unknown; quoteDigest?: unknown }>(request);
    if (!parsed.ok) return NextResponse.json({ code: parsed.status, data: null, msg: parsed.message }, { status: parsed.status });
    const body = parsed.data;
    const expectedConversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
    if (body?.conversationId !== undefined && !expectedConversationId) return NextResponse.json({ code: 400, data: null, msg: "对话标识无效" }, { status: 400 });
    const quoteDigest = typeof body?.quoteDigest === "string" ? body.quoteDigest.trim() : "";
    const status = actions[action];
    if (!status && action !== "retry" && action !== "cancel" && action !== "confirm") return NextResponse.json({ code: 400, data: null, msg: "不支持的 Agent 操作" }, { status: 400 });
    const run = await getAgentRun(id);
    if (!run || (run.userId !== user.id && user.role !== "admin")) return NextResponse.json({ code: 404, data: null, msg: "Agent 任务不存在" }, { status: 404 });
    const needsOwnerCredential = action === "confirm" || action === "resume" || action === "retry" || action === "cancel";
    const ownerCredential = needsOwnerCredential ? resolveAgentRunCredential(request, run, user) : "";
    if (ownerCredential === null) return NextResponse.json({ code: 503, data: null, msg: "管理员代操作需要配置独立 Worker 令牌" }, { status: 503 });
    if (expectedConversationId && run.conversationId !== expectedConversationId) return NextResponse.json({ code: 409, data: null, msg: "当前对话与 Agent 任务不匹配" }, { status: 409 });
    if (action === "retry" && (run.status !== "failed" || run.tasks.length)) return NextResponse.json({ code: 409, data: null, msg: "只有规划阶段失败的任务可以整体重试" }, { status: 409 });
    if (action === "pause" && !["planning", "running"].includes(run.status)) return NextResponse.json({ code: 409, data: null, msg: "当前任务无法暂停" }, { status: 409 });
    if (action === "resume" && (run.status !== "paused" || run.cancellation)) return NextResponse.json({ code: 409, data: null, msg: run.cancellation ? "任务正在取消，无法恢复" : "只有暂停中的任务可以恢复" }, { status: 409 });
    if (action === "confirm") {
        if (run.status !== "awaiting_confirmation" || !run.videoQuoteDigest || !quoteDigest || quoteDigest !== run.videoQuoteDigest) return NextResponse.json({ code: 409, data: { run: publicAgentRun(run) }, msg: "报价列表已变化，请检查最新报价后确认" }, { status: 409 });
        return confirmAgentVideoQuotes(request, run, quoteDigest, ownerCredential);
    }
    if (action === "resume" && run.status === "paused" && run.videoQuoteDigest) {
        const copyIndexes = new Map(run.tasks.map((task) => [task.id, agentTaskUnsubmittedVideoQuoteCopyIndexes(task)]));
        const quotedTasks = run.tasks.filter((task) => task.status !== "completed" && (copyIndexes.get(task.id)?.length || 0) > 0);
        if (quotedTasks.length) {
            const quoteTaskIds = new Set(quotedTasks.map((task) => task.id));
            const quoteScopeTasks = run.tasks.map((task) => ({
                ...task,
                videoQuotes: quoteTaskIds.has(task.id) ? task.videoQuotes?.filter((item) => copyIndexes.get(task.id)?.includes(item.copyIndex)) : undefined,
            }));
            const expired = agentVideoQuotesExpired(quoteScopeTasks);
            try {
                const refreshed = await quoteAgentVideoTasks({
                    run,
                    tasks: run.tasks,
                    origin: resolveInternalOrigin(new URL(request.url).origin),
                    cookie: ownerCredential,
                    settings: await getAuthSettings(),
                    attemptOverrides: new Map(quotedTasks.map((task) => [task.id, agentTaskExecutionAttempt(task)])),
                    taskIds: quoteTaskIds,
                    copyIndexes: new Map(quotedTasks.map((task) => [task.id, copyIndexes.get(task.id)!])),
                });
                const refreshedTasks = mergeAgentVideoQuotes(run.tasks, refreshed.tasks);
                const refreshedPrice = agentRunVideoQuotePriceDigest(refreshedTasks);
                const currentPrice = agentRunVideoQuotePriceDigest(run.tasks);
                if (expired || refreshedPrice !== currentPrice) {
                    const updated = await updateAgentRunById(run.id, { status: "awaiting_confirmation", tasks: refreshedTasks, videoQuoteDigest: agentRunVideoQuoteDigest(refreshedTasks), executionId: undefined }, { type: "run.quote_confirmation_required", data: { quoteDigest: agentRunVideoQuoteDigest(refreshedTasks) } }, ["paused"]);
                    return NextResponse.json({ code: 409, data: { run: publicAgentRun(updated || run) }, msg: expired ? "视频报价已过期，请重新确认后恢复" : "视频报价已变化，请重新确认后恢复" }, { status: 409 });
                }
                const refreshedRun = await updateAgentRunById(run.id, { tasks: refreshedTasks, videoQuoteDigest: agentRunVideoQuoteDigest(refreshedTasks) }, { type: "run.quote.refreshed" }, ["paused"]);
                if (!refreshedRun) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
            } catch (error) {
                return NextResponse.json({ code: 409, data: { run: publicAgentRun(run) }, msg: error instanceof Error ? error.message : "视频报价暂时无法核实" }, { status: 409 });
            }
        }
    }
    const limit = action === "resume" || action === "retry" ? (await getAuthSettings()).generationConcurrency.agent : 0;
    if (action === "cancel" && ["completed", "failed", "cancelled"].includes(run.status)) return NextResponse.json({ code: 409, data: null, msg: "当前任务无法取消" }, { status: 409 });
    if (action === "cancel") return cancelAgentRun(request, run, ownerCredential);
    if (action !== "resume") abortAgentRun(run.id);
    const mutate = async () => ({
        updated:
            action === "retry"
                ? await updateAgentRunById(
                      run.id,
                      {
                          status: "planning",
                          executionId: undefined,
                          tasks: [],
                          foundation: undefined,
                          projectHandoff: undefined,
                          projectHandoffEmitted: undefined,
                          review: undefined,
                          reviewed: false,
                          assetIds: [],
                          failure: undefined,
                          failureStage: undefined,
                          candidateFailures: undefined,
                          videoQuoteDigest: undefined,
                      },
                      { type: "run.retry.requested" },
                      ["failed"],
                  )
                : await setAgentRunStatus(run, status!),
    });
    const result = action === "resume" || action === "retry" ? await withGenerationConcurrencyLimit(run.userId, "agent", 10 * 60 * 1000, limit, mutate, run.id) : await mutate();
    if (result === null) return NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${limit} 个 Agent 任务` }, { status: 429 });
    const updated = result.updated;
    if (!updated) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const cookie = ownerCredential;
    if (action === "resume" || action === "retry") {
        await scheduleGenerationTask("agent", updated.id, { executionPhase: "created", nextPollAt: Date.now(), lastUpstreamStatus: action });
        after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [updated.id] }));
    } else {
        await scheduleGenerationTask("agent", updated.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: action });
    }
    return NextResponse.json({ code: 0, data: { run: publicAgentRun(updated) }, msg: "OK" });
}

async function cancelAgentRun(request: Request, run: AgentRun, ownerCredential: string) {
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const cookie = ownerCredential;
    const children = run.tasks
        .filter((task) => (task.status === "running" || task.status === "needs_review") && ["text", "image", "video", "audio"].includes(task.type))
        .flatMap((task) => cancellableChildTaskIds(task).map((taskId) => ({ type: task.type, taskId })));
    const requestedAt = run.cancellation?.requestedAt || Date.now();
    const stopping = await updateAgentRunById(
        run.id,
        { status: "paused", executionId: undefined, cancellation: { requestedAt, pendingChildTaskIds: children.map((child) => child.taskId) } },
        { type: "run.cancel.requested", data: { pendingCount: children.length } },
        run.status === "awaiting_confirmation" ? ["awaiting_confirmation"] : ["planning", "running", "paused"],
    );
    if (!stopping) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    abortAgentRun(run.id);
    await scheduleGenerationTask("agent", stopping.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "cancel_requested" });

    const results = await Promise.all(children.map((child) => cancelChildTask(child, origin, cookie)));
    const pending = results.filter((result) => !result.confirmed);
    if (pending.length) {
        const message = pending.map((result) => `${result.taskId}：${result.error || "取消状态待确认"}`).join("；");
        const updated = await updateAgentRunById(
            run.id,
            { cancellation: { requestedAt, pendingChildTaskIds: pending.map((result) => result.taskId), lastError: message } },
            { type: "run.cancel.pending", data: { pendingTaskIds: pending.map((result) => result.taskId) } },
            ["paused"],
        );
        return NextResponse.json({ code: 502, data: { run: publicAgentRun(updated || stopping), pendingCount: pending.length }, msg: "部分子任务取消状态尚未确认，请稍后再次取消" }, { status: 502 });
    }

    const latest = (await getAgentRun(run.id)) || stopping;
    const cancelled = await setAgentRunStatus(latest, "cancelled");
    if (!cancelled) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    await scheduleGenerationTask("agent", cancelled.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "cancel" });
    return NextResponse.json({ code: 0, data: { run: publicAgentRun(cancelled) }, msg: "OK" });
}

async function confirmAgentVideoQuotes(request: Request, run: AgentRun, confirmedDigest: string, ownerCredential: string) {
    const settings = await getAuthSettings();
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const copyIndexes = new Map(run.tasks.map((task) => [task.id, agentTaskUnsubmittedVideoQuoteCopyIndexes(task)]));
    const quotedTasks = run.tasks.filter((task) => task.status !== "completed" && (copyIndexes.get(task.id)?.length || 0) > 0);
    const quotedTaskIds = new Set(quotedTasks.map((task) => task.id));
    let refreshed: Awaited<ReturnType<typeof quoteAgentVideoTasks>>;
    try {
        const quotedCopyIndexes = new Map(quotedTasks.map((task) => [task.id, copyIndexes.get(task.id)!]));
        const attemptOverrides = new Map(quotedTasks.map((task) => [task.id, agentTaskExecutionAttempt(task)]));
        refreshed = await quoteAgentVideoTasks({ run, tasks: run.tasks, origin, cookie: ownerCredential, settings, attemptOverrides, taskIds: quotedTaskIds, copyIndexes: quotedCopyIndexes });
    } catch (error) {
        const message = error instanceof Error ? error.message : "视频报价暂时无法核实";
        return NextResponse.json({ code: 409, data: { run: publicAgentRun(run) }, msg: `${message}，请取消并重新规划任务` }, { status: 409 });
    }
    const refreshedTasks = mergeAgentVideoQuotes(run.tasks, refreshed.tasks);
    const nextDigest = agentRunVideoQuoteDigest(refreshedTasks);
    const pricingChanged = agentRunVideoQuotePriceDigest(refreshedTasks) !== agentRunVideoQuotePriceDigest(run.tasks);
    const quoteScopeTasks = run.tasks.map((task) => ({ ...task, videoQuotes: quotedTaskIds.has(task.id) ? task.videoQuotes?.filter((item) => copyIndexes.get(task.id)?.includes(item.copyIndex)) : undefined }));
    const expired = agentVideoQuotesExpired(quoteScopeTasks);
    if (!nextDigest || confirmedDigest !== run.videoQuoteDigest) return NextResponse.json({ code: 409, data: { run: publicAgentRun(run) }, msg: "报价确认已过期，请检查最新报价后重试" }, { status: 409 });
    if (pricingChanged || expired) {
        const updated = await updateAgentRunById(run.id, { tasks: refreshedTasks, videoQuoteDigest: nextDigest }, { type: "run.quote_confirmation_required", data: { quoteDigest: nextDigest } }, ["awaiting_confirmation"], undefined, run.videoQuoteDigest);
        const latest = updated || (await getAgentRun(run.id)) || run;
        return NextResponse.json({ code: 409, data: { run: publicAgentRun(latest) }, msg: pricingChanged ? "视频报价或任务参数已变化，请检查更新后的报价后重新确认" : "视频报价已过期，请检查最新报价后重新确认" }, { status: 409 });
    }

    const limit = settings.generationConcurrency.agent;
    const result = await withGenerationConcurrencyLimit(
        run.userId,
        "agent",
        10 * 60 * 1000,
        limit,
        async () => ({
            updated: await updateAgentRunById(run.id, { status: "planning", executionId: undefined, tasks: refreshedTasks, videoQuoteDigest: nextDigest }, { type: "run.quote.confirmed" }, ["awaiting_confirmation"], undefined, run.videoQuoteDigest),
        }),
        run.id,
    );
    if (result === null) return NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${limit} 个 Agent 任务` }, { status: 429 });
    const updated = result.updated;
    if (!updated) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    const cookie = ownerCredential;
    await scheduleGenerationTask("agent", updated.id, { executionPhase: "created", nextPollAt: Date.now(), lastUpstreamStatus: "quote_confirmed" });
    after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [updated.id] }));
    return NextResponse.json({ code: 0, data: { run: publicAgentRun(updated) }, msg: "已确认报价并开始生成" });
}

async function cancelChildTask(child: { type: AgentRun["tasks"][number]["type"]; taskId: string }, origin: string, cookie: string) {
    const url = `${origin}/api/${child.type}-tasks/${encodeURIComponent(child.taskId)}`;
    const credentialHeaders = runtimeCredentialHeaders(cookie);
    try {
        const response = await fetchInternalApi(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...credentialHeaders },
            body: JSON.stringify({ status: "cancelled" }),
        });
        const result = await readChildTaskResponse(response);
        if ((response.ok && childTaskTerminal(result.status)) || response.status === 404) return { taskId: child.taskId, confirmed: true as const };
    } catch {
        // The request may have reached the child route. Confirm its persisted state below.
    }
    try {
        const response = await fetchInternalApi(url, { headers: credentialHeaders });
        if (response.status === 404) return { taskId: child.taskId, confirmed: true as const };
        const result = await readChildTaskResponse(response);
        if (response.ok && childTaskTerminal(result.status)) return { taskId: child.taskId, confirmed: true as const };
        return { taskId: child.taskId, confirmed: false as const, error: result.error || `子任务仍处于 ${result.status || response.status}` };
    } catch (error) {
        return { taskId: child.taskId, confirmed: false as const, error: error instanceof Error ? error.message : "无法读取子任务状态" };
    }
}

async function readChildTaskResponse(response: Response) {
    const payload = (await response.json().catch(() => null)) as { task?: { status?: unknown }; error?: unknown; msg?: unknown } | null;
    return {
        status: typeof payload?.task?.status === "string" ? payload.task.status.trim().toLowerCase() : "",
        error: typeof payload?.error === "string" ? payload.error : typeof payload?.msg === "string" ? payload.msg : "",
    };
}

function childTaskTerminal(status: string) {
    return ["success", "completed", "error", "failed", "cancelled", "canceled"].includes(status);
}

function cancellableChildTaskIds(task: AgentRun["tasks"][number]) {
    const childStatuses = new Map(task.childTasks?.map((child) => [child.id, child.status]) || []);
    const ids = new Set([...(task.taskIds || []), ...(task.taskId ? [task.taskId] : []), ...(task.childTasks?.map((child) => child.id) || [])]);
    return Array.from(ids).filter((taskId) => !childStatuses.has(taskId) || childStatuses.get(taskId) === "pending" || childStatuses.get(taskId) === "needs_review");
}

function resolveAgentRunCredential(request: Request, run: AgentRun, user: { id: string; role: string }) {
    if (run.userId === user.id) return requestRuntimeCredential(request, run.userId);
    if (user.role !== "admin") return null;
    try {
        return maintenanceWorkerContext(run.userId);
    } catch {
        return null;
    }
}

function runtimeCredentialHeaders(credential: string): Record<string, string> {
    const workerHeaders = maintenanceWorkerContextHeaders(credential);
    return workerHeaders || (credential ? { cookie: credential } : {});
}

function mergeAgentVideoQuotes(originalTasks: AgentRun["tasks"], refreshedTasks: AgentRun["tasks"]) {
    const refreshedById = new Map(refreshedTasks.map((task) => [task.id, task]));
    return originalTasks.map((task) => {
        const refreshed = refreshedById.get(task.id);
        if (!refreshed || task.type !== "video" || !task.videoQuotes?.length || !refreshed.videoQuotes?.length) return refreshed || task;
        const refreshedIndexes = new Set(refreshed.videoQuotes.map((item) => item.copyIndex));
        const preserved = task.videoQuotes.filter((item) => !refreshedIndexes.has(item.copyIndex));
        return { ...refreshed, videoQuotes: [...preserved, ...refreshed.videoQuotes].sort((left, right) => left.copyIndex - right.copyIndex) };
    });
}
