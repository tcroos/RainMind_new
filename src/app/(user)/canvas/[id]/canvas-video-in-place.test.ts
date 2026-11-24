import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/stores/use-config-store";
import { readGenerationTask } from "@/services/api/generation-tasks";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { VideoGenerationStorageError } from "@/services/api/video-types";
import { createVideoStorageDiagnostic } from "@/services/api/video-storage-diagnostic";
import { useCanvasGenerationActions } from "./use-canvas-generation-actions";
import { useCanvasTaskRuntime } from "./use-canvas-task-runtime";

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: () => undefined }));
const api = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), recover: vi.fn(), readTask: vi.fn(), wait: vi.fn(), store: vi.fn() }));
vi.mock("@/services/api/generation-tasks", async original => ({ ...(await original<typeof import("@/services/api/generation-tasks")>()), readGenerationTask: api.readTask }));
vi.mock("@/services/api/video", async (original) => ({ ...(await original<typeof import("@/services/api/video")>()), createServerVideoGenerationTask: api.create, findServerVideoGenerationTask: api.find, recoverVideoGenerationTask: api.recover, waitForVideoGenerationTask: api.wait, storeGeneratedVideo: api.store }));

function fixture() {
    const nodesRef = {
        current: [
            {
                id: "copy",
                type: CanvasNodeType.Video,
                title: "视频副本",
                position: { x: 100, y: 200 },
                width: 330,
                height: 587,
                metadata: { content: "/old.mp4", size: "9:16", model: "video-model", seconds: "5", status: "success", videoTask: { id: "old-task", model: "video-model", provider: "generation" }, videoTaskRequest: { clientRequestId: "old", attemptNo: 1 } },
            },
        ] as CanvasNodeData[],
    };
    const connectionsRef = { current: [{ id: "input", fromNodeId: "text", toNodeId: "copy" }] };
    const state = {
        nodesRef,
        connectionsRef,
        effectiveConfig: { ...defaultConfig, model: "video-model", videoModel: "video-model", videoModels: ["video-model"] },
        projectId: "test",
        projectSession: { current: { projectId: "test", token: "session" } },
        canvasTaskCommitIdentityByTargetRef: { current: new Map() },
        currentProject: {},
        isAiConfigReady: () => true,
        setRunningNodeId: vi.fn(),
        setSelectedNodeIds: vi.fn(),
        setSelectedConnectionId: vi.fn(),
        setDialogNodeId: vi.fn(),
        generationRequestsRef: { current: new Map() },
        setNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
            nodesRef.current = update(nodesRef.current);
        },
        setConnections: vi.fn(),
        message: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    };
    return { state, nodesRef, connectionsRef };
}

beforeEach(() => {
    vi.clearAllMocks();
    api.readTask.mockResolvedValue({ status: "error", refundStatus: "refunded", needsReview: false, result: null });
});

describe("BUG-026 existing video generation", () => {
    it("silently supersedes an old running request without a result", () => {
        const { state } = fixture();
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const old = runtime.beginCanvasTaskAttempt("copy", "copy", "old");
        const newer = runtime.beginCanvasTaskAttempt("copy", "copy", "new");
        expect(newer.supersededHasResult).toBeUndefined();
        expect(runtime.canvasTaskCommitGuard(old)).toBe(false);
        expect(state.message.warning).not.toHaveBeenCalled();
    });

    it("warns once only when a superseded task actually returns a result", async () => {
        const { state } = fixture();
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const old = runtime.beginCanvasTaskAttempt("copy", "copy", "old");
        const newer = runtime.beginCanvasTaskAttempt("copy", "copy", "new");
        expect(old.supersededHasResult).toBe(true);
        api.wait.mockResolvedValue({ url: "/old-result.mp4" });
        api.store.mockResolvedValue({ url: "/old-result.mp4" });
        for (let i = 0; i < 2; i++) await runtime.completeVideoTask("copy", state.effectiveConfig, { id: "old", model: "video-model", provider: "generation" }, new AbortController(), undefined, old);
        expect(state.message.warning).toHaveBeenCalledTimes(1);
    });

    it("keeps the old request valid when new task creation fails", async () => {
        const { state } = fixture();
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const old = runtime.beginCanvasTaskAttempt("copy", "copy", "old");
        const oldController = runtime.startGenerationRequest("copy", "copy", "copy", new AbortController(), "old", old);
        api.create.mockRejectedValue(new Error("creation rejected"));
        const actions = useCanvasGenerationActions({ state: { ...state, size: { width: 1440, height: 1000 } }, tasks: runtime, interactions: {} } as unknown as Parameters<typeof useCanvasGenerationActions>[0]);
        await actions.handleGenerateNode("copy", "video", "prompt");
        expect(oldController.signal.aborted).toBe(false);
        expect(runtime.canvasTaskCommitGuard(old)).toBe(true);
    });

    it("does not warn for a result arriving after an explicit stop", async () => {
        const { state } = fixture();
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const identity = runtime.beginCanvasTaskAttempt("copy", "copy", "old");
        runtime.startGenerationRequest("copy", "copy", "copy", new AbortController(), "old", identity);
        runtime.stopGenerationByRunningId("copy");
        api.wait.mockResolvedValue({ url: "/late.mp4" }); api.store.mockResolvedValue({ url: "/late.mp4" });
        await runtime.completeVideoTask("copy", state.effectiveConfig, { id: "old", model: "video-model", provider: "generation" }, new AbortController(), undefined, identity);
        expect(state.message.warning).not.toHaveBeenCalled();
    });
    it("submits into the video copy without adding a node or copying old request identity", async () => {
        const { state, nodesRef } = fixture();
        const complete = vi.fn();
        api.create.mockResolvedValue({ id: "new-task", model: "video-model" });
        const tasks = { ...useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]), completeVideoTask: complete };
        const actions = useCanvasGenerationActions({ state: { ...state, size: { width: 1440, height: 1000 } }, tasks, interactions: {} } as unknown as Parameters<typeof useCanvasGenerationActions>[0]);
        await actions.handleGenerateNode("copy", "video", "new prompt");
        expect(nodesRef.current).toHaveLength(1);
        expect(nodesRef.current[0]).toMatchObject({ id: "copy", position: { x: 100, y: 200 }, width: 330, height: 587, metadata: { videoTask: { id: "new-task" } } });
        expect(nodesRef.current[0].metadata?.videoTaskRequest?.clientRequestId).not.toBe("old");
        expect(nodesRef.current[0].metadata?.content).toBeUndefined();
        expect(state.setConnections).not.toHaveBeenCalled();
        expect(api.create).toHaveBeenCalledTimes(1);
        expect(api.create.mock.calls[0][3]).toEqual([]);
        expect(complete.mock.calls[0][0]).toBe("copy");
    });

    it("keeps a successful task recoverable when saving its video result fails", async () => {
        const { state, nodesRef } = fixture();
        const task = { id: "new-task", model: "video-model", provider: "generation" as const, pollPath: "server" as const, serverTaskId: "new-task" };
        api.create.mockResolvedValue(task);
        api.wait.mockResolvedValue({ url: "/generated.mp4", remoteUrl: "https://media.example/generated.mp4" });
        api.store.mockRejectedValueOnce(new VideoGenerationStorageError("disk full", "https://media.example/generated.mp4", createVideoStorageDiagnostic("upload", new Error("disk full"), { sourceUrl: "https://media.example/generated.mp4", bytes: 12345, mimeType: "video/mp4", errorCode: "R2_WRITE_FAILED" }))).mockResolvedValue({ url: "/generated.mp4", width: 360, height: 640, bytes: 100, mimeType: "video/mp4" });
        api.recover.mockResolvedValue(task);
        api.find.mockResolvedValue(task);

        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const actions = useCanvasGenerationActions({ state: { ...state, size: { width: 1440, height: 1000 } }, tasks: runtime, interactions: {} } as unknown as Parameters<typeof useCanvasGenerationActions>[0]);
        await actions.handleGenerateNode("copy", "video", "prompt");

        expect(api.create).toHaveBeenCalledTimes(1);
        expect(api.store).toHaveBeenCalledTimes(1);
        expect(nodesRef.current[0].metadata).toMatchObject({
            status: "error",
            videoTask: { id: "new-task", serverTaskId: "new-task" },
            remoteUrl: "https://media.example/generated.mp4",
            videoStorageDiagnostic: { stage: "upload", bytes: 12345, mimeType: "video/mp4", errorCode: "R2_WRITE_FAILED" },
            errorDetails: expect.stringContaining("上传阶段"),
        });

        api.readTask.mockResolvedValue({ status: "success", needsReview: false, refundStatus: "not_required", result: { url: "/generated.mp4" } });
        api.wait.mockResolvedValue({ url: "/generated.mp4" });
        await actions.handleRetryNode(nodesRef.current[0]);
        expect(api.recover).toHaveBeenCalledWith(expect.objectContaining({ id: "new-task" }), expect.anything());
        expect(api.recover).toHaveBeenCalledTimes(1);
        expect(api.create).toHaveBeenCalledTimes(1);
        expect(nodesRef.current[0].metadata?.content).toBe("/generated.mp4");
    });

    it("keeps the scoped video quote requirement on explicit retry", async () => {
        const { state, nodesRef } = fixture();
        nodesRef.current[0].metadata = { ...nodesRef.current[0].metadata, status: "error", prompt: "retry prompt", videoReferences: [], task: { taskId: "failed-original" } };
        const complete = vi.fn();
        api.create.mockResolvedValue({ id: "retry-task", model: "video-model" });
        const tasks = { ...useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]), completeVideoTask: complete };
        const actions = useCanvasGenerationActions({ state: { ...state, size: { width: 1440, height: 1000 } }, tasks, interactions: {} } as unknown as Parameters<typeof useCanvasGenerationActions>[0]);
        await actions.handleRetryNode(nodesRef.current[0]);
        expect(api.create).toHaveBeenCalledTimes(1);
        expect(api.create.mock.calls[0][5]).toMatchObject({ quoteScope: "canvas:copy" });
    });
});

describe("BUG-027 video completion display size", () => {
    it("keeps the source image request and identity alive when starting a downstream video", async () => {
        const { state, nodesRef } = fixture();
        nodesRef.current[0].type = CanvasNodeType.Image;
        nodesRef.current[0].metadata = { content: "/image.png", status: "loading", imageTask: { id: "image-running", kind: "generation", model: "image-model" } };
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const imageIdentity = runtime.beginCanvasTaskAttempt("copy", "copy", "image-running");
        const imageController = runtime.startGenerationRequest("copy", "copy", "copy", new AbortController(), "image-running", imageIdentity);
        api.create.mockResolvedValue({ id: "video-task", model: "video-model" });
        const complete = vi.fn();
        const actions = useCanvasGenerationActions({ state: { ...state, size: { width: 1440, height: 1000 } }, tasks: { ...runtime, completeVideoTask: complete }, interactions: {} } as unknown as Parameters<typeof useCanvasGenerationActions>[0]);
        await actions.handleGenerateNode("copy", "video", "video from source image");
        expect(imageController.signal.aborted).toBe(false);
        expect(state.canvasTaskCommitIdentityByTargetRef.current.get("copy")).toEqual(imageIdentity);
        expect(runtime.canvasTaskCommitGuard(imageIdentity)).toBe(true);
        expect(nodesRef.current.find(node => node.id === "copy")?.metadata?.status).toBe("loading");
        expect(state.message.warning).not.toHaveBeenCalled();
        expect(complete.mock.calls[0][0]).not.toBe("copy");
    });

    it("rejects a delayed old completion before it mutates a newer task registry", async () => {
        const { state, nodesRef } = fixture();
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const oldIdentity = runtime.beginCanvasTaskAttempt("copy", "copy", "old-task");
        let finish!: (value: { url: string }) => void;
        api.wait.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        api.store.mockResolvedValue({ url: "/old-result.mp4", width: 360, height: 640 });
        const pending = runtime.completeVideoTask("copy", state.effectiveConfig, { id: "old-task", provider: "generation", model: "video-model" }, new AbortController(), undefined, oldIdentity);
        const newer = runtime.beginCanvasTaskAttempt("copy", "copy", "new-task");
        finish({ url: "/old-result.mp4" });
        await pending;
        expect(state.canvasTaskCommitIdentityByTargetRef.current.get("copy")).toEqual(newer);
        expect(nodesRef.current[0].metadata?.content).toBe("/old.mp4");
    });
    it.each([false, true])("preserves display scale and center (freeResize=%s)", async (freeResize) => {
        const { state, nodesRef } = fixture();
        nodesRef.current[0].metadata!.freeResize = freeResize;
        const runtime = useCanvasTaskRuntime({ state } as unknown as Parameters<typeof useCanvasTaskRuntime>[0]);
        const identity = runtime.beginCanvasTaskAttempt("copy", "copy", "task");
        api.wait.mockResolvedValue({ url: "/new.mp4" });
        api.store.mockResolvedValue({ url: "/new.mp4", width: 360, height: 640, bytes: 100, mimeType: "video/mp4" });
        await runtime.completeVideoTask("copy", state.effectiveConfig, { id: "task", provider: "generation", model: "video-model" }, new AbortController(), undefined, identity);
        expect(nodesRef.current[0].width).toBe(330);
        expect(nodesRef.current[0].height).toBe(587);
        expect(nodesRef.current[0].position).toEqual({ x: 100, y: 200 });
        expect(nodesRef.current[0].metadata).toMatchObject({ naturalWidth: 360, naturalHeight: 640 });
    });
});
