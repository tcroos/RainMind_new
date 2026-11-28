"use client";

import { Sparkles } from "lucide-react";

import { skillPresentation } from "@/lib/skill-presentation";
import { cn } from "@/lib/utils";
import type { AgentSkillSummary } from "@/services/api/agent-skills";

/** 新对话的空状态：给几个具体到能直接出片的例子，避免整屏只剩一个输入框。 */
const SUGGESTIONS = [
    "生成一张 3:4 的产品主图，白底、柔光，突出质感",
    "做一条 15 秒短视频：城市夜景，慢推镜，配轻快电子乐",
    "写一份 6 个镜头的短剧分镜，都市情感题材",
    "把这句文案改成小红书口播风格：今天也要好好生活",
] as const;

/**
 * 三张斜叠封面：左「人像 / 短剧」、中「产品图」、右「夜景视频」，
 * 正好对应产品能产出的三类东西。图放在 public 里，不走接口，
 * 不依赖作品广场有没有内容，首屏就不会空着。
 */
const COVERS = [
    { key: "portrait", src: "/empty-cover-1.jpg", alt: "人像短剧示例" },
    { key: "product", src: "/empty-cover-2.jpg", alt: "产品图示例" },
    { key: "motion", src: "/empty-cover-3.jpg", alt: "夜景视频示例" },
] as const;

const PLACEMENTS = [
    "left-0 top-6 h-[118px] w-[88px] -rotate-[14deg]",
    "left-1/2 top-0 h-[140px] w-[104px] -translate-x-1/2",
    "right-0 top-7 h-[112px] w-[84px] rotate-[14deg]",
] as const;

export function CreativeEmptyChat({ siteTitle, onPick, skills = [], onPickSkill }: { siteTitle: string; onPick: (prompt: string) => void; skills?: AgentSkillSummary[]; onPickSkill?: (skill: AgentSkillSummary) => void }) {
    return (
        <div className="mx-auto flex w-full max-w-[760px] flex-col items-center px-4 pb-8 pt-10 sm:pt-[8vh]" data-testid="creative-empty-chat">
            <div className="relative h-[148px] w-[270px] shrink-0" aria-hidden="true">
                {COVERS.map((cover, index) => (
                    <figure
                        key={cover.key}
                        className={cn(
                            "absolute overflow-hidden rounded-lg border border-black/5 bg-[var(--surface-inset)] shadow-[0_12px_26px_-14px_rgba(20,20,24,0.45)] dark:border-white/10",
                            PLACEMENTS[index],
                        )}
                    >
                        <img src={cover.src} alt={cover.alt} className="size-full object-cover" loading="lazy" decoding="async" />
                    </figure>
                ))}
            </div>

            <h2 className="mt-7 text-center text-[22px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ink-1)] sm:text-[26px]">
                和 {siteTitle} 一起，把想法变成作品
            </h2>
            <p className="mt-2 text-center text-[13px] text-[var(--ink-3)]">从一个想法开始，也可以直接点下面的例子</p>

            <div className="mt-6 flex w-full flex-col items-stretch gap-2 sm:items-center">
                {SUGGESTIONS.map((item) => (
                    <button
                        key={item}
                        type="button"
                        onClick={() => onPick(item)}
                        className="group inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface-panel)] px-4 py-2.5 text-left text-[13px] leading-5 text-[var(--ink-2)] shadow-[0_1px_2px_rgba(17,17,19,0.04)] transition hover:border-[var(--brand-500)]/50 hover:bg-[var(--surface-soft)] hover:text-[var(--ink-1)] sm:w-auto sm:justify-center"
                    >
                        <Sparkles className="size-3.5 shrink-0 text-[var(--brand-600)]" />
                        <span>{item}</span>
                    </button>
                ))}
            </div>
            {skills.length && onPickSkill ? (
                <div className="mt-8 w-full" data-testid="creative-empty-skills">
                    <p className="text-center text-[12px] text-[var(--ink-3)]">或者用一个 Skill 开始</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {skills.map((skill) => {
                            const cover = skillPresentation(skill).cover;
                            return (
                                <button key={skill.id} type="button" onClick={() => onPickSkill(skill)} className="group overflow-hidden rounded-xl bg-[var(--surface-panel)] text-left shadow-[inset_0_0_0_1px_var(--hairline)] transition hover:shadow-[inset_0_0_0_1px_var(--hairline),0_10px_24px_-14px_rgba(17,17,19,0.3)]">
                                    <span className="block aspect-[16/10] overflow-hidden bg-[var(--surface-inset)]">{cover ? <img src={cover} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" /> : null}</span>
                                    <span className="block truncate px-3 py-2 text-[13px] font-medium text-[var(--ink-1)]">{skill.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
