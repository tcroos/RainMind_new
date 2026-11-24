"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import type { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData, CanvasNodeTaskState } from "../types";
import { canvasNodeFailureBillingLabel, deriveCanvasNodeTaskState } from "../[id]/canvas-node-task-state";

type TaskTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

function shortTaskId(taskId: string) {
    return taskId.length > 22 ? `${taskId.slice(0, 10)}…${taskId.slice(-8)}` : taskId;
}

function CopyTaskId({ taskId, theme, className = "" }: { taskId: string; theme: TaskTheme; className?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            className={`pointer-events-auto inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] transition hover:brightness-110 ${className}`}
            style={{ color: theme.node.placeholder }}
            title={taskId}
            onClick={async (event) => {
                event.stopPropagation();
                try {
                    await navigator.clipboard.writeText(taskId);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                } catch {
                    setCopied(false);
                }
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {copied ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
            <span className="truncate">TaskID {shortTaskId(taskId)}</span>
        </button>
    );
}

/** Inline, borderless task id used under the loading/error label. */
export function CanvasNodeTaskId({ taskId, theme, className = "" }: { taskId?: string; theme: TaskTheme; className?: string }) {
    if (!taskId) return null;
    return (
        <div className={`flex max-w-full items-center justify-center ${className}`}>
            <CopyTaskId taskId={taskId} theme={theme} />
        </div>
    );
}

export function CanvasNodeTaskStateOverlay({ node, theme }: { node: CanvasNodeData; theme: TaskTheme }) {
    const task = deriveCanvasNodeTaskState(node.metadata);
    if (task?.status === "error") {
        const billingLabel = canvasNodeFailureBillingLabel(task);
        return billingLabel ? (
            <div
                className="pointer-events-none absolute bottom-2 right-2 z-20 rounded-full border px-2 py-1 text-[10px]"
                style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.muted }}
                data-canvas-task-state="error-billing"
            >
                {billingLabel}
            </div>
        ) : null;
    }
    if (!task || task.status !== "success" || task.power === undefined) return null;
    return (
        <div
            className="pointer-events-none absolute bottom-2 right-2 z-20 rounded-full border px-2 py-1 text-[10px]"
            style={{ background: theme.node.successSurface, borderColor: theme.node.successBorder, color: theme.node.successText }}
            data-canvas-task-state="success"
        >
            消耗 {task.power} 积分
        </div>
    );
}
