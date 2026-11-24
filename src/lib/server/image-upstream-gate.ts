import { GenerationSubmissionSafeFailure } from "@/lib/server/generation-submission-error";
import { generationDiagnostic } from "./generation-diagnostics";
import { currentGenerationTaskFence } from "./generation-task-fence";

type Waiter = {
    resolve: (release: () => void) => void;
    timer: ReturnType<typeof setTimeout>;
};

class ImageUpstreamSemaphore {
    private active = 0;
    private readonly waiters: Waiter[] = [];

    constructor(private readonly limit: number) {}

    acquire(timeoutMs: number): Promise<() => void> {
        if (this.active < this.limit) {
            this.active += 1;
            return Promise.resolve(this.releaseHandle());
        }
        return new Promise((resolve, reject) => {
            const waiter: Waiter = {
                resolve,
                timer: setTimeout(() => {
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0) this.waiters.splice(index, 1);
                    reject(new GenerationSubmissionSafeFailure("图片上游并发已满，请稍后重试", 429));
                }, Math.max(1_000, timeoutMs)),
            };
            this.waiters.push(waiter);
        });
    }

    private releaseHandle() {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.waiters.shift();
            if (next) {
                clearTimeout(next.timer);
                next.resolve(this.releaseHandle());
                return;
            }
            this.active = Math.max(0, this.active - 1);
        };
    }
}

const gateState = globalThis as typeof globalThis & {
    __vozebImageUpstreamGates?: Map<string, ImageUpstreamSemaphore>;
};
const gates = (gateState.__vozebImageUpstreamGates ??= new Map<string, ImageUpstreamSemaphore>());

function positiveIntegerEnv(name: string, fallback: number) {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Math.floor(Number(raw));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Per-App-process, per-channel upstream submission gate.
 *
 * The default is intentionally small: two App nodes × 8 = 16 concurrent
 * image submissions per channel. Set the env to 0 to disable the gate.
 */
export async function withImageUpstreamGate<T>(channelId: string, run: () => Promise<T>): Promise<T> {
    const limit = positiveIntegerEnv("VOZEB_PRO_IMAGE_UPSTREAM_CHANNEL_CONCURRENCY", 8);
    if (limit <= 0) return run();
    const key = channelId.trim() || "unknown";
    let gate = gates.get(key);
    if (!gate) {
        gate = new ImageUpstreamSemaphore(limit);
        gates.set(key, gate);
    }
    const timeoutMs = positiveIntegerEnv("VOZEB_PRO_IMAGE_UPSTREAM_QUEUE_TIMEOUT_MS", 60_000);
    const queuedAt = Date.now();
    const release = await gate.acquire(timeoutMs);
    const enteredAt = Date.now();
    const taskId = currentGenerationTaskFence()?.taskId;
    generationDiagnostic("upstream_enter", { taskId, channelId: key, waitMs: enteredAt - queuedAt, limit });
    try {
        return await run();
    } finally {
        generationDiagnostic("upstream_exit", { taskId, channelId: key, elapsedMs: Date.now() - enteredAt, limit });
        release();
    }
}
