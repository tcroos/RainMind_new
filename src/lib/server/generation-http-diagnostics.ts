import { channel } from "node:diagnostics_channel";
import { currentGenerationTaskFence } from "./generation-task-fence";
import { generationDiagnostic } from "./generation-diagnostics";

type RequestTiming = { taskId: string; createdAt: number; sentAt?: number };
const state = globalThis as typeof globalThis & { __vozebGenerationHttpDiagnostics?: boolean };

/** Undici events distinguish waiting for a socket from sending through response headers. */
export function enableGenerationHttpDiagnostics() {
    if (process.env.VOZEB_PRO_GENERATION_DIAGNOSTICS !== "1" || state.__vozebGenerationHttpDiagnostics) return;
    state.__vozebGenerationHttpDiagnostics = true;
    const timings = new WeakMap<object, RequestTiming>();
    channel("undici:request:create").subscribe(message => {
        const request = (message as { request: object }).request;
        const taskId = currentGenerationTaskFence()?.taskId;
        if (taskId) timings.set(request, { taskId, createdAt: Date.now() });
    });
    channel("undici:client:sendHeaders").subscribe(message => {
        const timing = timings.get((message as { request: object }).request);
        if (!timing) return;
        timing.sentAt = Date.now();
        generationDiagnostic("http_sent", { taskId: timing.taskId, socketWaitMs: timing.sentAt - timing.createdAt });
    });
    channel("undici:request:headers").subscribe(message => {
        const { request, response } = message as { request: object; response: { statusCode: number } };
        const timing = timings.get(request);
        if (!timing) return;
        generationDiagnostic("http_headers", { taskId: timing.taskId, elapsedMs: Date.now() - (timing.sentAt ?? timing.createdAt), status: response.statusCode });
        timings.delete(request);
    });
    channel("undici:request:error").subscribe(message => {
        const request = (message as { request: object }).request;
        const timing = timings.get(request);
        if (timing) generationDiagnostic("http_error", { taskId: timing.taskId, sent: timing.sentAt !== undefined });
        timings.delete(request);
    });
}
