import { readGenerationTask, type GenerationTaskView } from "@/services/api/generation-tasks";

/** A failed read is never permission to create and charge another task. */
export async function reconcileCanvasTaskRetry(kind: GenerationTaskView["kind"], taskId: string) {
    const task = await readGenerationTask(kind, taskId);
    if (task.needsReview) return { action: "review" as const, task };
    if (task.status === "success" || task.status === "running" || task.status === "pending") return { action: "resume" as const, task };
    if (task.status === "error" && !task.result && ["refunded", "not_required"].includes(task.refundStatus)) return { action: "recreate" as const, task };
    // cancelled is a local fact, not confirmation that the provider stopped.
    return { action: "review" as const, task };
}
