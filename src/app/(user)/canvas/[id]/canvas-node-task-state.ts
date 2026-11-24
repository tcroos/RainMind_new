import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTaskRefundStatus, CanvasNodeTaskState, CanvasNodeTaskStatus } from "../types";

const TASK_ID_FIELDS = ["imageTask", "videoTask", "audioTask", "textTask"] as const;

function statusFromMetadata(metadata: CanvasNodeMetadata | undefined): CanvasNodeTaskStatus | undefined {
    if (metadata?.status === "loading") return "running";
    if (metadata?.status === "success") return "success";
    if (metadata?.status === "error") return "error";
    if (metadata?.status === "cancelled") return "cancelled";
    return undefined;
}

function taskIdFromMetadata(metadata: CanvasNodeMetadata | undefined) {
    for (const field of TASK_ID_FIELDS) {
        const task = metadata?.[field];
        if (task?.id) return task.id;
    }
    return undefined;
}

export function canvasNodeTaskId(metadata: CanvasNodeMetadata | undefined) {
    return metadata?.task?.taskId || taskIdFromMetadata(metadata);
}

export function canvasNodeSafeFailureMessage(message: string | undefined) {
    if (!message) return message;
    if (/channel_config_invalid|接口地址不允许访问内网或保留地址/i.test(message)) return "当前模型暂不可用，请联系管理员";
    if (/状态码\s*500|HTTP\s*500|provider_http_500/i.test(message)) return "上游服务暂时不可用，请稍后重试";
    return message;
}

/**
 * Derive the persisted task snapshot from the live node fields.
 *
 * The snapshot must survive clearing `imageTask` / `videoTask` on success, so an
 * existing taskId is kept when the live task reference is gone. Only the fields
 * that actually changed get a new updatedAt, otherwise every save would look dirty.
 */
export function deriveCanvasNodeTaskState(metadata: CanvasNodeMetadata | undefined): CanvasNodeTaskState | undefined {
    const existing = metadata?.task;
    const taskId = canvasNodeTaskId(metadata);
    const status = statusFromMetadata(metadata) || existing?.status;
    if (!taskId && !existing) return undefined;
    const error = status === "error" ? canvasNodeSafeFailureMessage(metadata?.errorDetails || existing?.error) : undefined;
    // A local display/persistence error is not evidence of a refund request.
    const refundStatus: CanvasNodeTaskRefundStatus | undefined = status === "success" ? "not_required" : existing?.refundStatus;
    const next: CanvasNodeTaskState = {
        ...existing,
        ...(taskId ? { taskId } : {}),
        ...(status ? { status } : {}),
        ...(status === "success" || status === "running" ? { error: undefined } : error ? { error } : {}),
        ...(refundStatus ? { refundStatus } : {}),
    };
    if (!next.taskId && !next.status) return undefined;
    const changed =
        !existing ||
        existing.taskId !== next.taskId ||
        existing.status !== next.status ||
        existing.error !== next.error ||
        existing.refundStatus !== next.refundStatus ||
        existing.power !== next.power ||
        existing.billed !== next.billed ||
        existing.progressPercent !== next.progressPercent;
    return changed ? { ...next, updatedAt: Date.now() } : existing;
}

export function mergeCanvasNodeTaskState(metadata: CanvasNodeMetadata | undefined, patch: CanvasNodeTaskState): CanvasNodeMetadata {
    return {
        ...metadata,
        task: {
            ...(patch.taskId && patch.taskId !== metadata?.task?.taskId ? { attemptToken: metadata?.task?.attemptToken } : metadata?.task),
            ...patch,
            updatedAt: Date.now(),
        },
    };
}

export function beginCanvasNodeTaskAttempt(metadata: CanvasNodeMetadata | undefined, attemptToken: string): CanvasNodeMetadata {
    return {
        ...metadata,
        status: "loading",
        errorDetails: undefined,
        imageTask: undefined,
        videoTask: undefined,
        audioTask: undefined,
        textTask: undefined,
        task: { attemptToken, status: "running", updatedAt: Date.now() },
    };
}

export function withDerivedCanvasTaskStates(nodes: CanvasNodeData[]): CanvasNodeData[] {
    let changed = false;
    const next = nodes.map((node) => {
        const task = deriveCanvasNodeTaskState(node.metadata);
        if (task === node.metadata?.task) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, task } };
    });
    return changed ? next : nodes;
}

export function canvasNodeTaskStatusLabel(status: CanvasNodeTaskState["status"]) {
    if (status === "running") return "生成中";
    if (status === "success") return "生成完成";
    if (status === "error") return "生成失败";
    if (status === "cancelled") return "已取消";
    return "等待中";
}

export function canvasNodeRefundStatusLabel(status: CanvasNodeTaskState["refundStatus"]) {
    if (status === "pending") return "退款处理中";
    if (status === "refunded") return "已返还";
    if (status === "failed") return "退款失败";
    if (status === "not_required") return "无需退款";
    return undefined;
}

export function canvasNodeFailureBillingLabel(task: CanvasNodeTaskState | undefined) {
    if (task?.status !== "error") return undefined;
    if (task.refundStatus === "pending") return "退款处理中";
    if (task.refundStatus === "refunded") return "已返还";
    if (task.refundStatus === "failed") return "退款失败";
    if (task.billed === false) return "本次未扣费";
    return task.refundStatus === "not_required" ? "无需退款" : undefined;
}
