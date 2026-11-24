import { createHash } from "node:crypto";
import type { getAuthSettings } from "@/lib/auth/store";
import type { VideoGenerationQuote } from "@/lib/video-generation-quote";
import { videoReferenceIdentity } from "@/lib/video-generation-quote";
import { agentTaskCopies } from "@/lib/server/agent-run-validation";
import type { AgentRun, AgentRunTask } from "@/lib/server/agent-run-store";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { taskReferences } from "@/lib/server/agent-run-execution-helpers";
import { resolveLogicalModel } from "@/lib/server/logical-model-router";
import { maintenanceWorkerContextHeaders } from "@/lib/server/maintenance-auth";

type Settings = Awaited<ReturnType<typeof getAuthSettings>>;
export type AgentVideoQuoteTask = { copyIndex: number; quote: VideoGenerationQuote };

export function agentVideoQuoteTargetId(run: AgentRun, task: AgentRunTask, attempt: number, copyIndex: number) {
    return `${run.clientRequestId}:${task.id}:${attempt}:${copyIndex}`;
}

export async function quoteAgentVideoTasks(input: { run: AgentRun; tasks: AgentRunTask[]; origin: string; cookie: string; settings: Settings; attemptOverrides?: Map<string, number>; taskIds?: Set<string>; copyIndexes?: Map<string, number[]>; deferDependencyTasks?: boolean }) {
    const targetTaskModels = new Map<string, string>();
    const quoteItems: Array<{ targetId: string; config: Record<string, unknown>; references: Array<{ type: "image" | "video" | "audio"; url: string; role?: string }> }> = [];
    const taskRows = new Map<string, AgentVideoQuoteTask[]>();

    for (const task of input.tasks) {
        if (task.type !== "video" || (input.taskIds && !input.taskIds.has(task.id)) || (input.deferDependencyTasks && task.dependencies.length > 0)) continue;
        const plannedModel = typeof task.model === "string" ? task.model.trim() : "";
        const model = (plannedModel && resolveLogicalModel(input.settings, "video", plannedModel) ? plannedModel : undefined) || (input.settings.defaultModels.videoModel && resolveLogicalModel(input.settings, "video", input.settings.defaultModels.videoModel) ? input.settings.defaultModels.videoModel : undefined);
        if (!model) continue;
        targetTaskModels.set(task.id, model);
        const config = {
            model,
            ...(task.ratio ? { size: task.ratio } : {}),
            ...(task.seconds ? { videoSeconds: String(task.seconds) } : {}),
            ...(task.quality ? { vquality: task.quality } : {}),
            ...(task.generateAudio !== undefined ? { videoGenerateAudio: String(task.generateAudio) } : {}),
            ...(task.watermark !== undefined ? { videoWatermark: String(task.watermark) } : {}),
        };
        const references = taskReferences(task).map((reference) => ({ type: reference.type, url: reference.url, ...(reference.role ? { role: reference.role } : {}) }));
        const attempt = input.attemptOverrides?.get(task.id) ?? Math.max(1, task.attempts + 1);
        const copyIndexes = input.copyIndexes?.get(task.id) || Array.from({ length: agentTaskCopies("video", task.count) }, (_, index) => index + 1);
        for (const copyIndex of Array.from(new Set(copyIndexes)).filter((index) => Number.isSafeInteger(index) && index > 0 && index <= agentTaskCopies("video", task.count)).sort((left, right) => left - right)) {
            quoteItems.push({ targetId: agentVideoQuoteTargetId(input.run, task, attempt, copyIndex), config, references });
        }
    }

    if (!quoteItems.length) {
        return { tasks: input.tasks.map((task) => (input.taskIds?.has(task.id) || (input.deferDependencyTasks && task.type === "video" && task.dependencies.length > 0) ? { ...task, videoQuotes: undefined } : task)), videoQuoteDigest: undefined };
    }

    const headers = new Headers({ "Content-Type": "application/json" });
    const workerHeaders = maintenanceWorkerContextHeaders(input.cookie);
    if (workerHeaders) Object.entries(workerHeaders).forEach(([key, value]) => headers.set(key, value));
    else if (input.cookie) headers.set("cookie", input.cookie);
    const response = await fetchInternalApi(`${input.origin}/api/video-generation-tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ quoteOnly: true, quoteItems }),
        cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as { quotes?: Array<{ targetId: string; quote: VideoGenerationQuote }>; error?: string } | null;
    if (!response.ok || !payload?.quotes) throw new Error(payload?.error || "Agent 视频报价失败");
    const quotes = new Map(payload.quotes.map(({ targetId, quote }) => [targetId, quote]));
    if (quotes.size !== quoteItems.length || quoteItems.some((item) => quotes.get(item.targetId)?.targetId !== item.targetId)) throw new Error("Agent 视频报价集合不完整");

    for (const task of input.tasks) {
        const model = targetTaskModels.get(task.id);
        if (!model) continue;
        const attempt = input.attemptOverrides?.get(task.id) ?? Math.max(1, task.attempts + 1);
        const copyIndexes = input.copyIndexes?.get(task.id) || Array.from({ length: agentTaskCopies("video", task.count) }, (_, index) => index + 1);
        const rows = copyIndexes.map((copyIndex) => {
            const quote = quotes.get(agentVideoQuoteTargetId(input.run, task, attempt, copyIndex));
            if (!quote) throw new Error("Agent 视频报价缺少对应子任务");
            return { copyIndex, quote };
        });
        taskRows.set(task.id, rows);
    }

    const tasks = input.tasks.map((task) => {
        const selected = !input.taskIds || input.taskIds.has(task.id);
        const deferred = input.deferDependencyTasks && task.type === "video" && task.dependencies.length > 0;
        if (!selected || deferred) return { ...task, videoQuotes: undefined };
        return { ...task, ...(targetTaskModels.has(task.id) ? { model: targetTaskModels.get(task.id) } : {}), ...(task.type === "video" ? { videoQuotes: taskRows.get(task.id) } : {}) };
    });
    return { tasks, videoQuoteDigest: agentRunVideoQuoteDigest(tasks) };
}

export function agentRunVideoQuoteDigest(tasks: AgentRunTask[]) {
    if (!tasks.some((task) => task.videoQuotes?.length)) return undefined;
    const digestInput = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        type: task.type,
        model: task.model,
        prompt: task.prompt,
        count: task.count,
        ratio: task.ratio,
        quality: task.quality,
        seconds: task.seconds,
        generateAudio: task.generateAudio,
        watermark: task.watermark,
        dependencies: task.dependencies,
        references: taskReferences(task).map((reference) => ({ type: reference.type, role: reference.role || "", url: videoReferenceIdentity(reference.url) })),
        quotes: task.videoQuotes?.map(({ copyIndex, quote }) => ({ copyIndex, targetId: quote.targetId, outputSeconds: quote.outputSeconds, referenceSeconds: quote.referenceSeconds, totalSeconds: quote.totalSeconds, points: quote.points, units: quote.units, fingerprint: quote.fingerprint, confirmation: quote.confirmation })) || [],
    }));
    return createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");
}

export function agentRunVideoQuotePriceDigest(tasks: AgentRunTask[]) {
    if (!tasks.some((task) => task.videoQuotes?.length)) return undefined;
    const digestInput = tasks.map((task) => ({
        id: task.id,
        type: task.type,
        model: task.model,
        prompt: task.prompt,
        count: task.count,
        ratio: task.ratio,
        quality: task.quality,
        seconds: task.seconds,
        generateAudio: task.generateAudio,
        watermark: task.watermark,
        dependencies: task.dependencies,
        references: taskReferences(task).map((reference) => ({ type: reference.type, role: reference.role || "", url: videoReferenceIdentity(reference.url) })),
        quotes: task.videoQuotes?.map(({ copyIndex, quote }) => ({ copyIndex, targetId: quote.targetId, outputSeconds: quote.outputSeconds, referenceSeconds: quote.referenceSeconds, totalSeconds: quote.totalSeconds, points: quote.points, units: quote.units, fingerprint: quote.fingerprint })) || [],
    }));
    return createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");
}

export function agentVideoQuotesExpired(tasks: AgentRunTask[], now = Date.now()) {
    const quotes = tasks.flatMap((task) => task.videoQuotes || []).map(({ quote }) => quote);
    return quotes.length > 0 && quotes.some((quote) => !Number.isSafeInteger(quote.expiresAt) || Number(quote.expiresAt) <= now);
}

export function agentRunVideoQuoteTotalPoints(tasks: AgentRunTask[]) {
    return Number(tasks.flatMap((task) => task.videoQuotes || []).reduce((sum, item) => sum + item.quote.points, 0).toFixed(2));
}
