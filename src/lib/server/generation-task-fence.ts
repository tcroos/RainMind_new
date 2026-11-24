import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GenerationTaskType } from "./generation-task-types";
import { getStoredGenerationTaskRecord } from "./generation-task-store";
import { maintenanceWorkerContext, maintenanceWorkerContextHeaders } from "./maintenance-auth";

export type GenerationTaskFence = { workerId: string; leaseUntil: number; taskId?: string; type?: GenerationTaskType; userId?: string };
type Scope = GenerationTaskFence & { type: GenerationTaskType; taskId: string; userId: string };
const scope = new AsyncLocalStorage<Scope>();

/** Carry the claim through nested provider/fallback/refund calls without storing it in payloads. */
export function withGenerationTaskFence<T>(value: Scope, run: () => Promise<T>) {
    return scope.run(value, run);
}

export function runWithGenerationTaskFence<T>(value: Scope | undefined, run: () => Promise<T>) {
    return value ? scope.run(value, run) : run();
}

export function currentGenerationTaskFence(type?: GenerationTaskType, taskId?: string) {
    const current = scope.getStore();
    return current && (!type || current.type === type) && (!taskId || current.taskId === taskId) ? current : undefined;
}

export function signGenerationTaskFenceHeader() {
    const fence = currentGenerationTaskFence();
    if (!fence?.type || !fence.taskId || !fence.userId || !fence.workerId || !fence.leaseUntil) return undefined;
    const payload = Buffer.from(JSON.stringify(fence)).toString("base64url");
    const context = maintenanceWorkerContext(fence.userId || "");
    const signature = createHmac("sha256", fenceSecret()).update(`generation-fence-v1\0${payload}\0${context}`).digest("base64url");
    return `${payload}.${signature}`;
}

export function generationTaskFenceRequestHeaders(): Record<string, string> {
    const fence = currentGenerationTaskFence();
    if (!fence?.userId) return {};
    const context = maintenanceWorkerContext(fence.userId);
    const workerHeaders = maintenanceWorkerContextHeaders(context);
    if (!workerHeaders) return {};
    return { ...workerHeaders, "x-vozeb-pro-worker-context": context, "x-vozeb-pro-generation-fence": signGenerationTaskFenceHeader() || "" };
}

export function verifyGenerationTaskFenceHeader(value: string | null, request: Request) {
    if (!value) return undefined;
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return undefined;
    const workerContext = request.headers.get("x-vozeb-pro-worker-context") || "";
    const workerHeaders = maintenanceWorkerContextHeaders(workerContext);
    if (!workerHeaders || workerHeaders.authorization !== request.headers.get("authorization")) return undefined;
    const expected = createHmac("sha256", fenceSecret()).update(`generation-fence-v1\0${payload}\0${workerContext}`).digest();
    let received: Buffer;
    try { received = Buffer.from(signature, "base64url"); } catch { return undefined; }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
    try {
        const fence = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Scope;
        const workerUserId = workerHeaders["x-vozeb-pro-worker-user-id"];
        return fence.workerId && fence.taskId && fence.type && fence.userId === workerUserId && Number.isFinite(fence.leaseUntil) ? fence : undefined;
    } catch { return undefined; }
}

export async function validateGenerationTaskFenceRequest(fence: Scope | undefined, request: Request, userId: string) {
    if (!fence) return false;
    if (fence.userId !== userId) return false;
    const record = await getStoredGenerationTaskRecord(fence.type, fence.taskId);
    return Boolean(record && record.userId === userId && record.workerId === fence.workerId && Number(record.leaseUntil) > Date.now());
}


export function matchesGenerationTaskFence(record: { workerId?: string; leaseUntil?: number }, fence: GenerationTaskFence | undefined, now = Date.now()) {
    return !fence || (record.workerId === fence.workerId && Number(record.leaseUntil) > now);
}

export class GenerationTaskFenceLostError extends Error {
    constructor() { super("任务租约已失效，旧执行器不能提交或退款"); this.name = "GenerationTaskFenceLostError"; }
}

function fenceSecret() {
    const secret = process.env.VOZEB_PRO_WORKER_TOKEN?.trim() || "";
    if (secret.length < 32) throw new Error("生成任务围栏需要配置 Worker 令牌");
    return secret;
}
