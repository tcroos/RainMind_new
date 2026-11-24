import { describe, expect, it } from "vitest";

import { bindCanvasTaskId, canCommitCanvasTaskResult, sourceCanvasTaskIdentity } from "./canvas-task-commit-guard";

const captured = { projectId: "project-a", token: "session-a", attemptToken: "attempt-a", sourceNodeId: "source", targetNodeId: "output", taskId: "task-a" };

describe("canvas task result commit guard", () => {
    it("keeps a generating image identity when starting a downstream video from it", () => {
        const registry = new Map([[captured.targetNodeId, captured]]);
        const session = { projectId: captured.projectId, token: captured.token };
        const source = sourceCanvasTaskIdentity(registry, session, captured.targetNodeId, "video-source");
        const video = { ...captured, targetNodeId: "video-output", sourceNodeId: captured.targetNodeId, attemptToken: "video-attempt", taskId: "video-task" };
        registry.set(video.targetNodeId, video);
        expect(source).toBe(captured);
        expect(registry.get(captured.targetNodeId)).toBe(captured);
        for (const identity of [captured, video]) {
            expect(canCommitCanvasTaskResult({ captured: identity, current: session, nodeIds: new Set(registry.keys()), registeredAttemptToken: registry.get(identity.targetNodeId)?.attemptToken, registeredTaskId: registry.get(identity.targetNodeId)?.taskId })).toEqual({ allowed: true });
        }
    });

    it("independent image and video targets both bind and commit without false stale results", () => {
        const session = { projectId: captured.projectId, token: captured.token };
        const image = { ...captured, taskId: undefined };
        const video = { ...image, targetNodeId: "video", attemptToken: "video-attempt" };
        const registry = new Map([[image.targetNodeId, image], [video.targetNodeId, video]]);
        for (const [identity, taskId] of [[image, "image-task"], [video, "video-task"]] as const) {
            const bound = bindCanvasTaskId(registry, session, identity, taskId)!;
            expect(canCommitCanvasTaskResult({ captured: bound, current: session, nodeIds: new Set(registry.keys()), registeredTaskId: registry.get(bound.targetNodeId)?.taskId, registeredAttemptToken: registry.get(bound.targetNodeId)?.attemptToken })).toEqual({ allowed: true });
        }
    });

    it("a delayed creation response cannot overwrite a new attempt registration", () => {
        const newer = { ...captured, attemptToken: "new-attempt", taskId: "new-task" };
        const registry = new Map([[captured.targetNodeId, newer]]);
        expect(bindCanvasTaskId(registry, captured, captured, "late-task")).toBeUndefined();
        expect(registry.get(captured.targetNodeId)).toBe(newer);
    });

    it("a deleted target rejects before attach and is never rebuilt", () => {
        const registry = new Map([[captured.targetNodeId, captured]]);
        const nodeIds = new Set(["source"]);
        const decision = canCommitCanvasTaskResult({ captured, current: captured, nodeIds });
        if (decision.allowed) bindCanvasTaskId(registry, captured, captured, "late-task");
        expect(nodeIds.has(captured.targetNodeId)).toBe(false);
        expect(registry.get(captured.targetNodeId)).toBe(captured);
    });

    it("restored task guards before attach and keeps its persisted task id", () => {
        const restored = { ...captured, attemptToken: "restored-attempt" };
        const registry = new Map([[restored.targetNodeId, restored]]);
        expect(canCommitCanvasTaskResult({ captured: restored, current: restored, nodeIds: new Set([restored.targetNodeId]), currentTaskId: "task-a", registeredAttemptToken: restored.attemptToken })).toEqual({ allowed: true });
        expect(bindCanvasTaskId(registry, restored, restored, "task-a")).toEqual(restored);
        expect(bindCanvasTaskId(registry, restored, restored, "different-task")).toBeUndefined();
        expect(registry.get(restored.targetNodeId)?.taskId).toBe("task-a");
    });
    it("allows a result only in the same project session and while its target node exists", () => {
        expect(canCommitCanvasTaskResult({ captured, current: { projectId: "project-a", token: "session-a" }, nodeIds: new Set(["output"]) })).toEqual({ allowed: true });
    });

    it("rejects results from an old project session and returns a trace node", () => {
        expect(canCommitCanvasTaskResult({ captured, current: { projectId: "project-b", token: "session-b" }, nodeIds: new Set(["output"]) })).toMatchObject({ allowed: false, traceNodeId: "source" });
    });

    it("does not recreate a deleted target node", () => {
        expect(canCommitCanvasTaskResult({ captured, current: { projectId: "project-a", token: "session-a" }, nodeIds: new Set(["source"]) })).toMatchObject({ allowed: false, traceNodeId: "source" });
    });

    it("rejects an older task result after the target starts a newer task", () => {
        expect(canCommitCanvasTaskResult({ captured, current: { projectId: "project-a", token: "session-a" }, nodeIds: new Set(["output"]), currentTaskId: "task-b" })).toMatchObject({ allowed: false, traceNodeId: "source" });
    });

    it("rejects an old result when a newer task is registered for the target", () => {
        expect(canCommitCanvasTaskResult({ captured, current: { projectId: "project-a", token: "session-a" }, nodeIds: new Set(["output"]), registeredTaskId: "task-b" })).toMatchObject({ allowed: false, traceNodeId: "source" });
    });

    it("rejects an older attempt even before the newer attempt has a server task id", () => {
        expect(canCommitCanvasTaskResult({ captured, current: { projectId: "project-a", token: "session-a" }, nodeIds: new Set(["output"]), registeredAttemptToken: "attempt-b" })).toMatchObject({ allowed: false, traceNodeId: "source" });
    });
});
