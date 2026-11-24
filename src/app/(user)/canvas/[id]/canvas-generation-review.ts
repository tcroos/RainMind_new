import type { CanvasNodeData } from "../types";

export function hasCanvasGenerationTask(node: CanvasNodeData) {
    const metadata = node.metadata;
    return Boolean(metadata?.task?.taskId || metadata?.imageTask || metadata?.videoTask || metadata?.videoTaskRequest?.clientRequestId || metadata?.textTask || metadata?.audioTask);
}

export function pauseCanvasGenerationReview(nodes: CanvasNodeData[], nodeIds: Iterable<string>, errorDetails: string) {
    const reviewed = new Set(nodeIds);
    return nodes.map((node) => (reviewed.has(node.id) && hasCanvasGenerationTask(node) ? { ...node, metadata: { ...node.metadata, status: "needs_review" as const, errorDetails } } : node));
}

export function resumeCanvasGenerationReview(nodes: CanvasNodeData[], nodeId: string) {
    return nodes.map((node) => (node.id === nodeId && hasCanvasGenerationTask(node) ? { ...node, metadata: { ...node.metadata, status: "loading" as const, errorDetails: undefined } } : node));
}
