import { describe, expect, it } from "vitest";

import { GenerationTaskNeedsReviewError } from "@/services/api/generation-task-state";
import { VideoGenerationStorageError, VideoGenerationUpstreamError } from "@/services/api/video-types";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { classifyCanvasVideoTaskFailure, hasExhaustedVideoRequestLookups, hasRecoverableCanvasVideoTaskRequest, isTerminalCanvasVideoTaskFailureKind, shouldResumeCanvasVideoTask } from "./canvas-video-task-recovery";

describe("canvas video task recovery", () => {
    it("recovers only loading video nodes with a saved request and no task id", () => {
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 330, height: 180, metadata: { status: "loading", videoTaskRequest: { clientRequestId: "original-request", attemptNo: 1 } } };
        expect(hasRecoverableCanvasVideoTaskRequest(node)).toBe(true);
        expect(hasRecoverableCanvasVideoTaskRequest({ ...node, metadata: { ...node.metadata, status: "needs_review" } })).toBe(true);
        expect(hasRecoverableCanvasVideoTaskRequest({ ...node, metadata: { ...node.metadata, status: "success" } })).toBe(false);
        expect(hasRecoverableCanvasVideoTaskRequest({ ...node, metadata: { ...node.metadata, videoTaskRequest: undefined } })).toBe(false);
        expect(hasRecoverableCanvasVideoTaskRequest({ ...node, metadata: { ...node.metadata, videoTask: { id: "found", provider: "generation", model: "video" } } })).toBe(false);
    });
    it("resumes needs_review nodes that already have a server task id", () => {
        const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "视频", position: { x: 0, y: 0 }, width: 330, height: 180, metadata: { status: "needs_review", videoTask: { id: "server-task", provider: "generation", model: "video" }, videoTaskRequest: { clientRequestId: "request", attemptNo: 1 } } };
        expect(shouldResumeCanvasVideoTask(node, "project", new Set())).toBe(true);
        expect(shouldResumeCanvasVideoTask({ ...node, metadata: { ...node.metadata, videoTask: undefined } }, "project", new Set())).toBe(true);
        expect(shouldResumeCanvasVideoTask({ ...node, metadata: { ...node.metadata, videoTask: undefined } }, "project", new Set(["project:video:request"]))).toBe(false);
        expect(shouldResumeCanvasVideoTask({ ...node, metadata: { ...node.metadata, status: "success" } }, "project", new Set())).toBe(false);
    });

    it("stops recovery lookups after five failures", () => {
        expect(hasExhaustedVideoRequestLookups(undefined)).toBe(false);
        expect(hasExhaustedVideoRequestLookups(4)).toBe(false);
        expect(hasExhaustedVideoRequestLookups(5)).toBe(true);
        expect(hasExhaustedVideoRequestLookups(9)).toBe(true);
    });

    it("keeps human review separate from upstream terminal failures", () => {
        expect(classifyCanvasVideoTaskFailure(new GenerationTaskNeedsReviewError())).toBe("needs_review");
        expect(classifyCanvasVideoTaskFailure(new VideoGenerationUpstreamError("upstream failed"))).toBe("upstream_failed");
    });

    it("keeps video storage failures recoverable through the original task", () => {
        expect(classifyCanvasVideoTaskFailure(new VideoGenerationStorageError("上传失败"))).toBe("storage_failed");
        expect(isTerminalCanvasVideoTaskFailureKind("storage_failed")).toBe(false);
        expect(isTerminalCanvasVideoTaskFailureKind("upstream_failed")).toBe(true);
        expect(isTerminalCanvasVideoTaskFailureKind("query_pending")).toBe(false);
        expect(isTerminalCanvasVideoTaskFailureKind("needs_review")).toBe(false);
    });

    it("continues the original task after local query failures", () => {
        expect(classifyCanvasVideoTaskFailure(new Error("network unavailable"))).toBe("query_pending");
    });
});
