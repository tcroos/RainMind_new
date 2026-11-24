"use client";

import { Button } from "antd";
import { Sparkles } from "lucide-react";

import type { DramaEpisode, DramaProject, DramaShot } from "../types";

export function DramaSceneStructure({
    project,
    episode,
    selectedShotId,
    onSelect,
    analyzing = false,
    onAnalyze,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    selectedShotId?: string;
    onSelect: (shot: DramaShot) => void;
    analyzing?: boolean;
    onAnalyze?: () => void;
}) {
    const sceneNames = new Map(project.scenes.map((scene) => [scene.id, scene.name]));
    return (
        <aside className="flex h-full min-h-0 min-w-0 flex-col bg-transparent" data-drama-scene-structure>
            <div className="shrink-0 px-4 pb-2 pt-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h3 className="text-[13px] font-semibold text-[var(--ink-1)]">场景结构</h3>
                        <p className="mt-1 text-[11px] text-[var(--ink-3)]">{episode.shots.length} 个场景 / 镜头</p>
                    </div>
                </div>
            </div>
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {episode.shots.length ? (
                    <div className="space-y-1">
                        {episode.shots.map((shot) => {
                            const active = shot.id === selectedShotId;
                            return (
                                <button
                                    key={shot.id}
                                    type="button"
                                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-inset)]"}`}
                                    onClick={() => onSelect(shot)}
                                    aria-current={active ? "true" : undefined}
                                >
                                    <span className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                                        <span className="tabular-nums">场景 {String(shot.order).padStart(2, "0")}</span>
                                        <span className="truncate">{sceneNames.get(shot.sceneId || "") || "未分配场景"}</span>
                                    </span>
                                    <span className="mt-1 block truncate text-xs font-medium text-foreground">{shot.title || "未命名镜头"}</span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-xl bg-[var(--surface-inset)] p-4">
                        <div className="text-[12px] font-medium text-[var(--ink-1)]">暂无场景结构</div>
                        <p className="mt-1.5 text-[11px] leading-5 text-[var(--ink-3)]">完成剧本后整理为可定位场景</p>
                        {onAnalyze ? (
                            <Button className="!mt-3 !h-8 !rounded-lg !border-0 !bg-[var(--surface-panel)] !px-3 !text-[var(--ink-1)] !shadow-none" size="small" icon={<Sparkles className="size-3" />} loading={analyzing} disabled={!episode.script.trim()} onClick={onAnalyze}>
                                AI 整理
                            </Button>
                        ) : null}
                    </div>
                )}
            </div>
        </aside>
    );
}
