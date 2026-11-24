import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/stores/use-config-store";
import { readGenerationTask } from "@/services/api/generation-tasks";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { useCanvasGenerationActions } from "./use-canvas-generation-actions";

const hookMocks = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: (fn: () => unknown) => { const cleanup = fn(); if (typeof cleanup === "function") hookMocks.cleanups.push(cleanup as () => void); } }));
vi.mock("@/services/api/generation-tasks", async original => ({ ...(await original<typeof import("@/services/api/generation-tasks")>()), readGenerationTask: vi.fn() }));
vi.mock("@/services/api/video", async original => ({ ...(await original<typeof import("@/services/api/video")>()), createServerVideoGenerationTask: vi.fn(), waitForVideoGenerationTask: vi.fn(), storeGeneratedVideo: vi.fn() }));

function createState(kind: "image" | "video" | "audio" | "text") {
    const type = kind === "image" ? CanvasNodeType.Image : kind === "video" ? CanvasNodeType.Video : kind === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Text;
    const live = kind === "image" ? { imageTask: { id: "task-1", model: "model" } } : kind === "video" ? { videoTask: { id: "task-1", model: "model", provider: "generation" as const } } : kind === "audio" ? { audioTask: { id: "task-1", model: "model" } } : { textTask: { id: "task-1", model: "model" } };
    const nodesRef = { current: [{ id: "node-1", type, title: "node", position: { x: 0, y: 0 }, width: 330, height: 330, metadata: { status: "needs_review", task: { taskId: "task-1" }, prompt: "prompt", ...live } }] as CanvasNodeData[] };
    const state = {
        nodesRef,
        connectionsRef: { current: [] },
        effectiveConfig: { ...defaultConfig, model: "model", imageModel: "model", videoModel: "model" }, size: { width: 1200, height: 800 }, containerRef: { current: null },
        projectId: "project-1", projectSession: { current: { projectId: "project-1", token: "session" } }, canvasTaskCommitIdentityByTargetRef: { current: new Map() }, currentProject: {},
        isAiConfigReady: () => true, setRunningNodeId: vi.fn(), setSelectedNodeIds: vi.fn(), setSelectedConnectionId: vi.fn(), setDialogNodeId: vi.fn(), generationRequestsRef: { current: new Map() },
        setNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => { nodesRef.current = update(nodesRef.current); }, setConnections: vi.fn(), message: { error: vi.fn(), info: vi.fn(), warning: vi.fn() }, projectLoaded: true, generateNodeRef: { current: null }, autoOpenedAgentRef: { current: true },
    };
    const recover = vi.fn(async () => {
        nodesRef.current = nodesRef.current.map(node => node.id === "node-1" ? { ...node, metadata: { ...node.metadata, status: "success", content: "/restored-result" } } : node);
    });
    return { state, nodesRef, recover, kind, type };
}

function createTaskRuntime(fixture: ReturnType<typeof createState>) {
    return {
        recoverAndCompleteImageTask: fixture.recover,
        recoverAndCompleteVideoTask: fixture.recover,
        recoverAndCompleteTextTask: fixture.recover,
        recoverAndCompleteAudioTask: fixture.recover,
        startGenerationRequest: vi.fn(() => new AbortController()),
        finishGenerationRequest: vi.fn(),
        captureCanvasTaskIdentity: vi.fn((targetNodeId: string, sourceNodeId: string) => ({
            projectId: "project-1",
            token: "session",
            attemptToken: "attempt-1",
            targetNodeId,
            sourceNodeId,
            taskId: "task-1",
        })),
        attachCanvasTaskId: vi.fn((_: string, taskId: string, identity: object) => ({ ...identity, taskId })),
        canvasTaskCommitGuard: vi.fn(() => true),
        readProgress: vi.fn(async (id: string, kind: string) => ({ id, taskId: id, kind, status: "success", needsReview: false, progressPercent: 100, error: null, resultCount: 1 })),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: vi.fn(() => ({ matches: false })) });
});
afterEach(() => {
    for (const cleanup of hookMocks.cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("BUG-087 needs_review synchronization", () => {
    it.each(["image", "video", "audio", "text"] as const)("reads and recovers a reviewed %s task", async kind => {
        const fixture = createState(kind);
        vi.mocked(readGenerationTask).mockResolvedValue({ id: "task-1", taskId: "task-1", kind, status: "success", needsReview: false, progressPercent: 100, power: null, result: {}, error: null, refundStatus: "not_required", billed: true });
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        await vi.waitFor(() => expect(fixture.recover).toHaveBeenCalledOnce());
        expect(readGenerationTask).toHaveBeenCalledWith(kind, "task-1");
        expect(fixture.nodesRef.current[0].metadata).toMatchObject({ status: "success", content: "/restored-result" });
        expect(fixture.nodesRef.current[0].metadata?.task?.billed).toBe(true);
    });

    it("uses batched progress and skips detail reads while a task is still running or under review", async () => {
        const fixture = createState("video");
        const runtime = createTaskRuntime(fixture);
        vi.mocked(runtime.readProgress).mockResolvedValue({
            id: "task-1",
            kind: "video",
            status: "running",
            progressPercent: 40,
            taskId: "task-1",
            error: null,
            needsReview: false,
            resultCount: 0,
        });
        useCanvasGenerationActions({ state: fixture.state as never, tasks: runtime as never, interactions: {} as never });
        await vi.waitFor(() => expect(runtime.readProgress).toHaveBeenCalledWith("task-1", "video"));
        expect(readGenerationTask).not.toHaveBeenCalled();
        expect(fixture.recover).not.toHaveBeenCalled();
        expect(fixture.nodesRef.current[0].metadata?.status).toBe("needs_review");
    });

    it.each([
        ["image", "success"], ["image", "error"], ["image", "cancelled"],
        ["video", "success"], ["video", "error"], ["video", "cancelled"],
        ["audio", "success"], ["audio", "error"], ["audio", "cancelled"],
        ["text", "success"], ["text", "error"], ["text", "cancelled"],
    ] as const)("synchronizes task snapshot only nodes for %s %s", async (kind, status) => {
        const fixture = createState(kind);
        const node = fixture.nodesRef.current[0];
        node.metadata = { ...node.metadata, imageTask: undefined, videoTask: undefined, audioTask: undefined, textTask: undefined, videoTaskRequest: undefined };
        vi.mocked(readGenerationTask).mockResolvedValue({ id: "task-1", taskId: "task-1", kind, status, needsReview: false, progressPercent: 100, power: null, result: status === "success" ? {} : null, error: status === "error" ? "server failed" : status === "cancelled" ? "已取消" : null, refundStatus: "not_required", billed: status === "success" ? true : status === "error" ? false : undefined });
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        await vi.waitFor(() => expect(status === "success" ? fixture.recover : vi.mocked(readGenerationTask)).toHaveBeenCalled());
        if (status === "success") {
            await vi.waitFor(() => expect(fixture.recover).toHaveBeenCalledOnce());
            expect(fixture.nodesRef.current[0].metadata?.status).toBe("success");
        } else {
            await vi.waitFor(() => expect(fixture.nodesRef.current[0].metadata?.status).toBe(status));
            if (status === "error") expect(fixture.nodesRef.current[0].metadata?.errorDetails).toBe("server failed");
            expect(fixture.nodesRef.current[0].metadata?.task?.billed).toBe(status === "error" ? false : undefined);
        }
        expect(readGenerationTask).toHaveBeenCalledWith(kind, "task-1");
    });

    it("marks a failed server task as error and preserves its task id and reason", async () => {
        const fixture = createState("image");
        vi.mocked(readGenerationTask).mockResolvedValue({ id: "task-1", taskId: "task-1", kind: "image", status: "error", needsReview: false, progressPercent: 100, power: null, result: null, error: "provider rejected", refundStatus: "refunded" });
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        await vi.waitFor(() => expect(fixture.nodesRef.current[0].metadata?.status).toBe("error"));
        expect(fixture.nodesRef.current[0].metadata).toMatchObject({ task: { taskId: "task-1" }, imageTask: { id: "task-1" }, errorDetails: "provider rejected" });
        expect(fixture.recover).not.toHaveBeenCalled();
    });

    it("marks a cancelled server task as cancelled without clearing its task id or recovering", async () => {
        const fixture = createState("video");
        vi.mocked(readGenerationTask).mockResolvedValue({ id: "task-1", taskId: "task-1", kind: "video", status: "cancelled", needsReview: false, progressPercent: null, power: null, result: null, error: "已取消", refundStatus: "not_required" });
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        await vi.waitFor(() => expect(fixture.nodesRef.current[0].metadata?.status).toBe("cancelled"));
        expect(fixture.nodesRef.current[0].metadata).toMatchObject({ task: { taskId: "task-1" }, videoTask: { id: "task-1" }, errorDetails: "已取消" });
        expect(fixture.recover).not.toHaveBeenCalled();
    });

    it("does not start another recovery while the same task recovery is still pending", async () => {
        const fixture = createState("video");
        vi.mocked(readGenerationTask).mockResolvedValue({ id: "task-1", taskId: "task-1", kind: "video", status: "success", needsReview: false, progressPercent: 100, power: null, result: {}, error: null, refundStatus: "not_required" });
        let finishRecovery!: () => void;
        fixture.recover.mockReturnValue(new Promise<void>(resolve => { finishRecovery = resolve; }));
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        await vi.waitFor(() => expect(fixture.recover).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(7500);
        expect(readGenerationTask).toHaveBeenCalledOnce();
        expect(fixture.recover).toHaveBeenCalledOnce();
        finishRecovery();
    });

    it("leaves nodes unchanged while still reviewed or when the read fails", async () => {
        const fixture = createState("video");
        vi.mocked(readGenerationTask).mockRejectedValue(new Error("offline"));
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        await vi.waitFor(() => expect(readGenerationTask).toHaveBeenCalledOnce());
        expect(fixture.recover).not.toHaveBeenCalled();
        expect(fixture.nodesRef.current[0].metadata?.status).toBe("needs_review");
    });

    it("does not process a response for a task replaced during the read", async () => {
        const fixture = createState("audio");
        let finish!: (task: Awaited<ReturnType<typeof readGenerationTask>>) => void;
        vi.mocked(readGenerationTask).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const identity = { projectId: "project-1", token: "session", attemptToken: "new-attempt", sourceNodeId: "node-1", targetNodeId: "node-1", taskId: "task-2" };
        fixture.state.canvasTaskCommitIdentityByTargetRef.current.set("node-1", identity);
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        finish({ id: "task-1", taskId: "task-1", kind: "audio", status: "success", needsReview: false, progressPercent: 100, power: null, result: {}, error: null, refundStatus: "not_required" });
        await Promise.resolve();
        await Promise.resolve();
        expect(fixture.recover).not.toHaveBeenCalled();
    });

    it("ignores a response when the canvas attempt changes during the read", async () => {
        const fixture = createState("audio");
        let finish!: (task: Awaited<ReturnType<typeof readGenerationTask>>) => void;
        vi.mocked(readGenerationTask).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const originalIdentity = { projectId: "project-1", token: "session", attemptToken: "attempt-1", sourceNodeId: "node-1", targetNodeId: "node-1", taskId: "task-1" };
        fixture.state.canvasTaskCommitIdentityByTargetRef.current.set("node-1", originalIdentity);
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        fixture.state.canvasTaskCommitIdentityByTargetRef.current.set("node-1", { ...originalIdentity, attemptToken: "attempt-2" });
        finish({ id: "task-1", taskId: "task-1", kind: "audio", status: "error", needsReview: false, progressPercent: 100, power: null, result: null, error: "old attempt", refundStatus: "refunded" });
        await Promise.resolve();
        await Promise.resolve();
        expect(fixture.nodesRef.current[0].metadata?.status).toBe("needs_review");
        expect(fixture.nodesRef.current[0].metadata?.errorDetails).toBeUndefined();
    });

    it("ignores a response when the node task id changes during the read", async () => {
        const fixture = createState("video");
        let finish!: (task: Awaited<ReturnType<typeof readGenerationTask>>) => void;
        vi.mocked(readGenerationTask).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        useCanvasGenerationActions({ state: fixture.state as never, tasks: createTaskRuntime(fixture) as never, interactions: {} as never });
        fixture.nodesRef.current[0].metadata = { ...fixture.nodesRef.current[0].metadata, task: { taskId: "task-2" }, videoTask: { id: "task-2", model: "model", provider: "generation" } };
        finish({ id: "task-1", taskId: "task-1", kind: "video", status: "cancelled", needsReview: false, progressPercent: null, power: null, result: null, error: null, refundStatus: "not_required" });
        await Promise.resolve();
        await Promise.resolve();
        expect(fixture.nodesRef.current[0].metadata?.status).toBe("needs_review");
        expect(fixture.nodesRef.current[0].metadata?.task?.taskId).toBe("task-2");
    });
});
