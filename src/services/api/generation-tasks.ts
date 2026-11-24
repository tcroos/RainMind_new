export type GenerationTaskView = {
    id: string;
    taskId: string;
    kind: "image" | "video" | "audio" | "text";
    status: string;
    needsReview: boolean;
    progressPercent: number | null;
    power: number | null;
    billed?: boolean;
    result: unknown;
    error: string | null;
    refundStatus: "pending" | "refunded" | "not_required" | "failed";
};

/** Display-only snapshot. Never replace legacy poll/recover readers: those settle refunds. */
export async function readGenerationTask(kind: GenerationTaskView["kind"], id: string): Promise<GenerationTaskView> {
    const response = await fetch(`/api/generation-tasks/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: { task?: GenerationTaskView }; error?: { message?: string } } | null;
    if (!response.ok || !payload?.ok || !payload.data?.task) throw new Error(payload?.error?.message || "任务状态读取失败");
    return payload.data.task;
}

export type GenerationTaskQuote = {
    kind: "video";
    power: number;
    breakdown: import("@/lib/video-generation-quote").VideoGenerationQuote;
    expiresAt: number;
    quoteToken: string;
};

async function postGenerationContract<T>(operation: "create" | "quote", body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/generation-tasks/${operation}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal,
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { code?: string; message?: string }; traceId?: string } | null;
    if (!response.ok || !payload?.ok || !payload.data) {
        throw Object.assign(new Error(payload?.error?.message || "生成任务请求失败"), { code: payload?.error?.code, traceId: payload?.traceId, status: response.status });
    }
    return payload.data;
}

export async function createGenerationTask(kind: GenerationTaskView["kind"], input: Record<string, unknown>, options?: { quoteToken?: string; signal?: AbortSignal }) {
    return (await postGenerationContract<{ task: Pick<GenerationTaskView, "id" | "taskId" | "kind" | "status" | "power" | "needsReview">; warning?: string }>("create", { kind, input, quoteToken: options?.quoteToken }, options?.signal));
}

export async function quoteGenerationTask(kind: GenerationTaskView["kind"], input: Record<string, unknown>, signal?: AbortSignal) {
    return (await postGenerationContract<{ quote: GenerationTaskQuote }>("quote", { kind, input }, signal)).quote;
}

export type GenerationProgress = {
    id: string;
    kind: string;
    status: string;
    progressPercent: number | null;
    taskId: string | null;
    error: string | null;
    needsReview: boolean;
    resultCount: number;
    notFound?: boolean;
};

export type TaskProgressReader = (id: string, kind: string, signal?: AbortSignal) => Promise<GenerationProgress | null>;

export async function readGenerationProgress(ids: string[]): Promise<GenerationProgress[]> {
    const response = await fetch("/api/generation-tasks/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(`批量任务查询失败（${response.status}）`);
    const payload = await response.json() as { code?: number; data?: { tasks?: GenerationProgress[] } };
    if (payload.code !== 0 || !Array.isArray(payload.data?.tasks)) throw new Error("批量任务响应无效");
    return payload.data.tasks;
}

/** Coalesce callers in the same polling turn; one caller's abort never cancels others. */
export function createTaskProgressBatcher(read = readGenerationProgress) {
    const pending = new Map<string, Array<(value: GenerationProgress | null) => void>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const flush = async () => {
        timer = undefined;
        const entries = [...pending.entries()];
        pending.clear();
        for (let offset = 0; offset < entries.length; offset += 20) {
            const batch = entries.slice(offset, offset + 20);
            let states: GenerationProgress[] = [];
            try { states = await read(batch.map(([id]) => id)); } catch { /* Existing readers handle fallback and errors. */ }
            const byId = new Map(states.map(state => [state.id, state]));
            for (const [id, resolve] of batch) for (const done of resolve) done(disposed ? null : byId.get(id) || null);
        }
    };
    const readProgress: TaskProgressReader = (id, kind, signal) => {
        if (disposed || signal?.aborted) return Promise.resolve(null);
        return new Promise(resolve => {
            let settled = false;
            const finish = (state: GenerationProgress | null) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", abort);
                resolve(state && !state.notFound && state.kind === kind ? state : null);
            };
            const abort = () => finish(null);
            signal?.addEventListener("abort", abort, { once: true });
            pending.set(id, [...(pending.get(id) || []), finish]);
            // Shared 2.5s collection window also batches restored tasks started at different times.
            timer ??= setTimeout(() => { void flush(); }, 2500);
        });
    };
    return {
        readProgress,
        dispose() {
            disposed = true;
            clearTimeout(timer);
            timer = undefined;
            for (const resolvers of pending.values()) for (const resolve of resolvers) resolve(null);
            pending.clear();
        },
    };
}

export function isProgressStillRunning(state: GenerationProgress | null) {
    return Boolean(state && !state.needsReview && ["pending", "running"].includes(state.status));
}
