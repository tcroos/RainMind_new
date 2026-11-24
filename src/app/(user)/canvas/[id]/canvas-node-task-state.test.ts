import { describe, expect, it } from "vitest";

import { beginCanvasNodeTaskAttempt, canvasNodeFailureBillingLabel, canvasNodeSafeFailureMessage, canvasNodeTaskId, deriveCanvasNodeTaskState, mergeCanvasNodeTaskState, withDerivedCanvasTaskStates } from "./canvas-node-task-state";
import { CanvasNodeType, type CanvasNodeData } from "../types";

function node(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "node-a", type: CanvasNodeType.Image, title: "node", position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("canvas node task state", () => {
    it("derives a running task snapshot from the live task reference", () => {
        expect(deriveCanvasNodeTaskState({ status: "loading", imageTask: { id: "task-a", kind: "generation", model: "image" } })).toMatchObject({
            taskId: "task-a",
            status: "running",
        });
    });

    it("keeps the task id when the live task reference is cleared on success", () => {
        expect(deriveCanvasNodeTaskState({ status: "success", task: { taskId: "task-a", status: "running" } })).toMatchObject({
            taskId: "task-a",
            status: "success",
            refundStatus: "not_required",
        });
    });

    it("carries local error without inventing a refund request", () => {
        expect(deriveCanvasNodeTaskState({ status: "error", errorDetails: "上游超时", task: { taskId: "task-a", power: 4 } })).toMatchObject({
            taskId: "task-a",
            status: "error",
            error: "上游超时",
            power: 4,
        });
        expect(deriveCanvasNodeTaskState({ status: "error", task: { taskId: "task-a", power: 4 } })?.refundStatus).toBeUndefined();
    });

    it("labels only explicitly unbilled failures as not charged and preserves real refund states", () => {
        expect(canvasNodeFailureBillingLabel({ status: "error", billed: false })).toBe("本次未扣费");
        expect(canvasNodeFailureBillingLabel({ status: "error", billed: true, power: undefined })).toBeUndefined();
        expect(canvasNodeFailureBillingLabel({ status: "error" })).toBeUndefined();
        expect(canvasNodeFailureBillingLabel({ status: "error", power: 20, refundStatus: "pending" })).toBe("退款处理中");
        expect(canvasNodeFailureBillingLabel({ status: "error", power: 20, refundStatus: "refunded" })).toBe("已返还");
        expect(canvasNodeFailureBillingLabel({ status: "error", power: 20, refundStatus: "failed" })).toBe("退款失败");
        expect(canvasNodeFailureBillingLabel({ status: "error", power: 20, refundStatus: "not_required" })).toBe("无需退款");
        expect(canvasNodeFailureBillingLabel({ status: "success" })).toBeUndefined();
    });

    it("maps historical unsafe failure strings to safe display messages", () => {
        expect(canvasNodeSafeFailureMessage("图片生成失败，状态码 500")).toBe("上游服务暂时不可用，请稍后重试");
        expect(canvasNodeSafeFailureMessage("接口地址不允许访问内网或保留地址")).toBe("当前模型暂不可用，请联系管理员");
        expect(deriveCanvasNodeTaskState({ status: "error", task: { taskId: "old", error: "图片生成失败，状态码 500" } })?.error).toBe("上游服务暂时不可用，请稍后重试");
    });

    it("clears old financial fields only when a new task replaces the original", () => {
        const metadata = { task: { taskId: "old", power: 40, refundStatus: "refunded" as const, error: "old failure" } };
        expect(mergeCanvasNodeTaskState(metadata, { taskId: "new", status: "running" }).task).toMatchObject({ taskId: "new", status: "running" });
        expect(mergeCanvasNodeTaskState(metadata, { taskId: "new" }).task?.power).toBeUndefined();
        expect(mergeCanvasNodeTaskState(metadata, { taskId: "old" }).task?.power).toBe(40);
    });

    it("starts a new attempt without carrying the previous task identity or billing state while keeping its result", () => {
        const previous = {
            status: "success" as const,
            content: "data:image/png;base64,old-result",
            imageTask: { id: "old-task", kind: "generation" as const, model: "image" },
            task: { taskId: "old-task", status: "success" as const, power: 20, refundStatus: "not_required" as const },
        };

        const next = beginCanvasNodeTaskAttempt(previous, "attempt-new");

        expect(next).toMatchObject({ status: "loading", content: previous.content, task: { attemptToken: "attempt-new", status: "running" } });
        expect(next.imageTask).toBeUndefined();
        expect(next.task?.taskId).toBeUndefined();
        expect(next.task?.power).toBeUndefined();
        expect(next.task?.refundStatus).toBeUndefined();
        expect(deriveCanvasNodeTaskState(next)?.taskId).toBeUndefined();
        expect(canvasNodeTaskId(next)).toBeUndefined();
    });

    it("does not create a snapshot for unrelated node errors without a task", () => {
        expect(deriveCanvasNodeTaskState({ status: "error", errorDetails: "上传失败" })).toBeUndefined();
    });

    it("returns the original nodes when nothing changed", () => {
        const nodes = [node({ task: { taskId: "task-a", status: "running", updatedAt: 1 } })];
        expect(withDerivedCanvasTaskStates(nodes)).toBe(nodes);
    });
});
