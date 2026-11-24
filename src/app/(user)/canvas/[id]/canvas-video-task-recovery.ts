import { isGenerationTaskNeedsReviewError } from "@/services/api/generation-task-state";
import { VideoGenerationStorageError, VideoGenerationUpstreamError } from "@/services/api/video-types";
import { formatVideoStorageDiagnostic } from "@/services/api/video-storage-diagnostic";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export type CanvasVideoTaskFailureKind = "needs_review" | "upstream_failed" | "storage_failed" | "query_pending";

export const MAX_VIDEO_REQUEST_LOOKUPS = 5;

export function hasExhaustedVideoRequestLookups(attempts: number | undefined) {
    return (attempts || 0) >= MAX_VIDEO_REQUEST_LOOKUPS;
}

export function hasRecoverableCanvasVideoTaskRequest(node: CanvasNodeData) {
    const metadata = node.metadata;
    return node.type === CanvasNodeType.Video && (metadata?.status === "loading" || metadata?.status === "needs_review") && !metadata.videoTask && Boolean(metadata.videoTaskRequest?.clientRequestId);
}

/**
 * A needs_review node that already has a server task id must still be resumed.
 * Otherwise the node stays "结果待确认" forever while the server task finishes.
 */
export function shouldResumeCanvasVideoTask(node: CanvasNodeData, projectId: string, lookedUp: ReadonlySet<string>) {
    const metadata = node.metadata;
    if (node.type !== CanvasNodeType.Video) return false;
    if (metadata?.status !== "loading" && metadata?.status !== "needs_review") return false;
    if (metadata.videoTask) return true;
    const clientRequestId = metadata.videoTaskRequest?.clientRequestId;
    if (!clientRequestId) return false;
    return !lookedUp.has(`${projectId}:${node.id}:${clientRequestId}`);
}

export function classifyCanvasVideoTaskFailure(error: unknown): CanvasVideoTaskFailureKind {
    if (isGenerationTaskNeedsReviewError(error)) return "needs_review";
    if (error instanceof VideoGenerationStorageError) return "storage_failed";
    return error instanceof VideoGenerationUpstreamError ? "upstream_failed" : "query_pending";
}

export function isTerminalCanvasVideoTaskFailureKind(kind: CanvasVideoTaskFailureKind): boolean {
    return kind === "upstream_failed";
}

export function canvasVideoStorageFailureDetails(error: unknown) {
    if (!(error instanceof VideoGenerationStorageError) || !error.diagnostic) return "视频已生成，但结果保存失败。点击重试可继续保存原任务结果，不会重新生成。";
    return `视频已生成，但结果保存失败（${formatVideoStorageDiagnostic(error.diagnostic)}）。点击重试可继续保存原任务结果，不会重新生成。`;
}
