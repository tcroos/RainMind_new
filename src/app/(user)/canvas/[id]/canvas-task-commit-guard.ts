export type CanvasProjectSession = { projectId: string; token: string };
export type CanvasTaskCommitIdentity = CanvasProjectSession & {
    attemptToken: string;
    sourceNodeId: string;
    targetNodeId: string;
    taskId?: string;
    supersededHasResult?: boolean;
    supersededWarningShown?: boolean;
};

export function canvasTaskHasResult(metadata: Record<string, unknown> | undefined) {
    return Boolean(metadata && (metadata.status === "success" || [metadata.content, metadata.url, metadata.resultUrl].some(value => typeof value === "string" && value.length > 0)));
}

/** Bind only the captured attempt; never mutate a newer target's registration. */
export function bindCanvasTaskId(registry: Map<string, CanvasTaskCommitIdentity>, current: CanvasProjectSession, captured: CanvasTaskCommitIdentity, taskId: string) {
    const registered = registry.get(captured.targetNodeId);
    if (captured.projectId !== current.projectId || captured.token !== current.token || registered?.attemptToken !== captured.attemptToken || registered.projectId !== captured.projectId || registered.token !== captured.token || (registered.taskId && registered.taskId !== taskId)) return undefined;
    const bound = { ...captured, taskId };
    registry.set(captured.targetNodeId, bound);
    return bound;
}

/** A downstream operation observes its source identity without registering a new source attempt. */
export function sourceCanvasTaskIdentity(registry: ReadonlyMap<string, CanvasTaskCommitIdentity>, session: CanvasProjectSession, sourceNodeId: string, attemptToken: string) {
    return registry.get(sourceNodeId) || { ...session, sourceNodeId, targetNodeId: sourceNodeId, attemptToken };
}

export function canCommitCanvasTaskResult(input: {
    captured: CanvasTaskCommitIdentity;
    current: CanvasProjectSession;
    nodeIds: ReadonlySet<string>;
    currentTaskId?: string;
    registeredTaskId?: string;
    registeredAttemptToken?: string;
}) {
    if (input.captured.projectId !== input.current.projectId || input.captured.token !== input.current.token) {
        return { allowed: false as const, reason: "项目或画布会话已切换", traceNodeId: input.captured.sourceNodeId };
    }
    if (!input.nodeIds.has(input.captured.targetNodeId)) {
        return { allowed: false as const, reason: "任务目标节点已删除，结果保留在生成记录中", traceNodeId: input.captured.sourceNodeId };
    }
    if (input.registeredAttemptToken && input.captured.attemptToken !== input.registeredAttemptToken) {
        return { allowed: false as const, reason: "节点已开始新的任务，旧任务结果保留在生成记录中", traceNodeId: input.captured.sourceNodeId };
    }
    if (input.captured.taskId && input.registeredTaskId && input.captured.taskId !== input.registeredTaskId) {
        return { allowed: false as const, reason: "目标节点已登记其他任务，旧任务结果保留在生成记录中", traceNodeId: input.captured.sourceNodeId };
    }
    if (input.captured.taskId && input.currentTaskId && input.captured.taskId !== input.currentTaskId) {
        return { allowed: false as const, reason: "节点已开始新的任务，旧任务结果保留在生成记录中", traceNodeId: input.captured.sourceNodeId };
    }
    return { allowed: true as const };
}
