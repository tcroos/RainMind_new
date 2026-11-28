"use client";

import { Film, ImageIcon, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { CreativeMessage } from "@/lib/creative-runtime-contract";
import type { CreativeAgentRun } from "@/services/api/creative";

import { creativeRunMode } from "./creative-run-presentation";

const LONG_WAIT_MESSAGES = ["主人，久等了，辛苦你再陪我一会儿，我一直在这里守着这次创作。", "主人，别担心，创作还在继续，不用重复发送，先放松一下，这里交给我守着吧。", "主人，作品正在慢慢雕琢，可能比平时久一点，但我没有离开。"] as const;

export function CreativeGenerationWaiting({ run, message }: { run?: CreativeAgentRun; message: Pick<CreativeMessage, "content" | "createdAt"> }) {
    const startedAt = run?.createdAt || message.createdAt;
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const update = () => setNow(Date.now());
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    const copy = creativeGenerationWaitingCopy({ mode: creativeRunMode(run), runStatus: run?.status, progressText: message.content, elapsedSeconds });

    const mode = creativeRunMode(run);
    const skeleton = creativeWaitingSkeleton(run, mode);

    return (
        <div data-testid="creative-generation-waiting" className="mb-3 max-w-[620px] py-1 text-[#667085] dark:text-[#a0a9b4]">
            <div className="flex items-start gap-2.5">
                <Sparkles className="mt-1 size-4 shrink-0 animate-pulse text-primary/75" aria-hidden />
                <div className="min-w-0">
                    <p className="text-sm leading-6 text-[#596474] dark:text-[#b0b8c2]" aria-live="polite">
                        {copy}
                    </p>
                    <p data-testid="creative-generation-elapsed" className="mt-0.5 text-[11px] tabular-nums leading-4 text-[#98a2b3] dark:text-[#7f8996]">
                        已等待 {formatCreativeWaitingTime(elapsedSeconds)}
                        {skeleton.expected ? ` · 通常 ${skeleton.expected}` : ""}
                    </p>
                </div>
            </div>
            {/* 按所选比例和数量先画出骨架，结果出来后原地替换，用户能预期会出几张、什么形状 */}
            {skeleton.count ? (
                <div data-testid="creative-generation-skeleton" className="mt-3 flex flex-wrap gap-2.5">
                    {Array.from({ length: skeleton.count }, (_, index) => (
                        <div
                            key={index}
                            className="creative-skeleton-tile relative overflow-hidden rounded-xl bg-[var(--surface-inset)]"
                            style={{ aspectRatio: skeleton.ratio, width: skeleton.count > 1 ? (skeleton.ratio >= 1 ? 220 : 160) : skeleton.ratio >= 1 ? 360 : 240, maxWidth: "100%" }}
                        >
                            {mode === "video" ? <Film className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-[var(--ink-3)] opacity-40" /> : <ImageIcon className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-[var(--ink-3)] opacity-40" />}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function creativeGenerationWaitingCopy({ mode, runStatus, progressText, elapsedSeconds }: { mode?: "text" | "image" | "video" | "audio"; runStatus?: CreativeAgentRun["status"]; progressText: string; elapsedSeconds: number }) {
    const progress = progressText.trim();
    if (runStatus === "paused" || /任务已暂停/.test(progress)) return "主人，任务已经替你暂停，进度好好保存着，想继续时叫我就好。";
    if (/连接暂时中断|无法确认实时状态/.test(progress)) return "主人，连接刚刚有些不稳，不过任务仍在后台继续，我正在替你确认。";
    if (/连接已恢复|恢复连接/.test(progress)) return "主人，连接恢复啦，我会继续守着这次创作。";
    if (/检查完成|正在整理|创作结果/.test(progress)) return "主人，作品已经生成，我正在整理最后的细节，很快就能交到你手上。";

    const activeTask = /正在处理|上游处理中|创作任务|重新生成|正在优化/.test(progress);
    if (!activeTask && (runStatus === "planning" || /理解需求|匹配创作技能|方案已确定|创建任务/.test(progress))) return planningCopy(mode);

    const elapsedMinutes = Math.floor(Math.max(0, elapsedSeconds) / 60);
    if (elapsedMinutes === 0) {
        if (mode === "image") return "主人，画面正在一点点显现，再给我一点点时间呀。";
        if (mode === "video") return "主人，镜头正在一帧帧铺开，我会在这里陪你等着。";
        if (mode === "audio") return "主人，声音正在一点点成形，我会替你仔细听好。";
        return "主人，灵感已经接住啦，我正在把它变成作品。";
    }
    if (elapsedMinutes === 1) return longWaitCopy(mode, false);
    return longWaitCopy(mode, true, LONG_WAIT_MESSAGES[(elapsedMinutes - 2) % LONG_WAIT_MESSAGES.length]);
}

function planningCopy(mode?: "text" | "image" | "video" | "audio") {
    if (mode === "image") return "主人，我接住你的灵感啦，正在把画面的氛围和细节安排好。";
    if (mode === "video") return "主人，我已经抓住这个镜头啦，正在把节奏和画面串起来。";
    if (mode === "audio") return "主人，我先替你把声音的语气和节奏调到合适。";
    return "主人，我先帮你把想法理顺，很快就给你一版好内容。";
}

function longWaitCopy(mode: "text" | "image" | "video" | "audio" | undefined, veryLong: boolean, fallback: string = "") {
    if (veryLong) {
        if (mode === "image") return "主人，画面还在细细打磨，不用重复发送，我会替你稳稳守着。";
        if (mode === "video") return "主人，久等了，镜头还在一帧帧渲染，不用重复发送，我会替你稳稳守着。";
        if (mode === "audio") return "主人，声音还在细细校准，不用重复发送，我会替你稳稳守着。";
        return fallback;
    }
    if (mode === "image") return "主人，画面还在认真打磨，马上就把好看的细节交给你。";
    if (mode === "video") return "主人，镜头还在慢慢铺开，再陪我一会儿，很快就好。";
    if (mode === "audio") return "主人，声音还在细细调校，再陪我一会儿，很快就好。";
    return "主人，文字还在认真打磨，再陪我一会儿，很快就好。";
}

export function formatCreativeWaitingTime(elapsedSeconds: number) {
    const totalSeconds = Math.max(0, Math.floor(elapsedSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}小时${minutes ? `${minutes}分` : ""}${seconds ? `${seconds}秒` : ""}`;
    if (minutes) return `${minutes}分${seconds ? `${seconds}秒` : ""}`;
    return `${seconds}秒`;
}


/** 骨架占位：只在图片 / 视频生成时显示；比例取任务或偏好里的 size（如 16:9），取不到按 1:1 / 16:9 */
export function creativeWaitingSkeleton(run: CreativeAgentRun | undefined, mode: ReturnType<typeof creativeRunMode>) {
    if (mode !== "image" && mode !== "video") return { count: 0, ratio: 1, expected: "" };
    const task = run?.tasks.find((item) => item.type === mode);
    const preference = mode === "image" ? run?.generationPreferences?.image : run?.generationPreferences?.video;
    const size = task?.ratio || preference?.size || "";
    const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(size);
    const ratio = match ? Number(match[1]) / Number(match[2]) : mode === "video" ? 16 / 9 : 1;
    const count = Math.max(1, Math.min(4, Number(preference?.count) || 1));
    return { count, ratio: Math.min(2.4, Math.max(0.4, ratio)), expected: mode === "video" ? "1~3 分钟" : "10~30 秒" };
}
