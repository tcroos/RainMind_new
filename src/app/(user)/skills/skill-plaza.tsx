"use client";

import { Modal } from "antd";
import { ArrowRight, Blocks, ExternalLink, ImagePlus, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { skillPresentation } from "@/lib/skill-presentation";
import { cn } from "@/lib/utils";
import { listAgentSkills, type AgentSkillSummary } from "@/services/api/agent-skills";

/*
 * 官方 Skill 广场：分类 + 搜索 + 精选大卡 + 卡片网格，点卡片看详情，
 * 「用这个 Skill 开始」带着 Skill（和示例）回首页 Agent 画布。
 * Skill 由管理员在后台配置；这里只做展示，不涉及用户发布。
 */
const CATEGORIES = [
    { id: "all", label: "全部" },
    { id: "image", label: "图片" },
    { id: "video", label: "视频" },
    { id: "canvas", label: "画布" },
    { id: "drama", label: "短剧" },
    { id: "edit", label: "编辑参考图" },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["id"];

const WORKSPACE_LABELS: Record<string, string> = { image: "图片", video: "视频", canvas: "画布", drama: "短剧" };

function matches(skill: AgentSkillSummary, category: CategoryId) {
    if (category === "all") return true;
    if (category === "edit") return skill.action === "edit" || Boolean(skill.requiresReference);
    return Boolean(skill.workspaces?.includes(category as never));
}

export function skillStartHref(skill: AgentSkillSummary, withExample: boolean) {
    const params = new URLSearchParams({ source: "home", mode: "agent", skill: skill.id });
    const example = skillPresentation(skill).example;
    if (withExample && example) params.set("prompt", example);
    return `/create#${params}`;
}

export function SkillPlaza() {
    const router = useRouter();
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [category, setCategory] = useState<CategoryId>("all");
    const [keyword, setKeyword] = useState("");
    const [active, setActive] = useState<AgentSkillSummary | null>(null);

    useEffect(() => {
        let alive = true;
        listAgentSkills("all")
            .then((items) => alive && setSkills(items))
            .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Skill 加载失败"))
            .finally(() => alive && setLoading(false));
        return () => {
            alive = false;
        };
    }, []);

    const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((item) => [item.id, skills.filter((skill) => matches(skill, item.id)).length])), [skills]);
    const visible = useMemo(() => {
        const text = keyword.trim().toLowerCase();
        return skills.filter((skill) => matches(skill, category) && (!text || [skill.name, skill.description, ...(skill.keywords || [])].some((value) => value?.toLowerCase().includes(text))));
    }, [category, keyword, skills]);
    const featured = category === "all" && !keyword.trim() ? visible.find((skill) => skillPresentation(skill).cover) : undefined;
    const rest = featured ? visible.filter((skill) => skill.id !== featured.id) : visible;
    const start = (skill: AgentSkillSummary, withExample = false) => router.push(skillStartHref(skill, withExample));

    return (
        <main className="h-full min-h-0 overflow-y-auto bg-[var(--surface-canvas)] text-[var(--ink-1)]" data-testid="skill-plaza">
            <div className="mx-auto w-full max-w-[1280px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight">
                            <Blocks className="size-6 text-[var(--brand-600)]" /> Skill 广场
                        </h1>
                        <p className="mt-1 text-[13.5px] text-[var(--ink-3)]">官方打磨的创作工作流。选一个 Skill，Agent 会按它的方法帮你拆解和生成。</p>
                    </div>
                    <label className="flex h-10 w-full items-center gap-2 rounded-full bg-[var(--surface-soft)] px-4 text-[var(--ink-3)] shadow-[inset_0_0_0_1px_var(--hairline)] focus-within:text-[var(--ink-1)] sm:w-72">
                        <Search className="size-4 shrink-0" />
                        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 Skill，如：电商、分镜" aria-label="搜索 Skill" className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-[var(--ink-1)] outline-none placeholder:text-[var(--ink-3)]" />
                    </label>
                </header>

                <nav className="hide-scrollbar mt-6 flex items-center gap-2 overflow-x-auto" aria-label="Skill 分类">
                    {CATEGORIES.filter((item) => item.id === "all" || counts[item.id]).map((item) => {
                        const selected = category === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => setCategory(item.id)}
                                style={selected ? { color: "var(--surface-canvas)", backgroundColor: "var(--ink-1)" } : undefined}
                                className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-colors", !selected && "bg-[var(--surface-soft)] text-[var(--ink-2)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink-1)]")}
                            >
                                {item.label}
                                <span className={cn("text-[12px] tabular-nums", selected ? "opacity-70" : "text-[var(--ink-3)]")}>{counts[item.id] ?? 0}</span>
                            </button>
                        );
                    })}
                </nav>

                {loading ? (
                    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 8 }, (_, index) => (
                            <div key={index} className="h-[260px] animate-pulse rounded-2xl bg-[var(--surface-inset)]" />
                        ))}
                    </div>
                ) : error ? (
                    <p className="mt-16 text-center text-[13px] text-[var(--ink-3)]">{error}</p>
                ) : !visible.length ? (
                    <p className="mt-16 text-center text-[13px] text-[var(--ink-3)]">{keyword ? `没有找到与「${keyword}」相关的 Skill` : "这个分类下还没有 Skill"}</p>
                ) : (
                    <>
                        {featured ? <FeaturedSkill skill={featured} onOpen={() => setActive(featured)} onStart={() => start(featured)} /> : null}
                        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="list" aria-label="Skill 列表">
                            {rest.map((skill) => (
                                <SkillCard key={skill.id} skill={skill} onOpen={() => setActive(skill)} onStart={() => start(skill)} />
                            ))}
                        </div>
                    </>
                )}
            </div>
            <SkillDetail skill={active} onClose={() => setActive(null)} onStart={start} />
        </main>
    );
}

function SkillCover({ skill, className }: { skill: AgentSkillSummary; className?: string }) {
    const cover = skillPresentation(skill).cover;
    return cover ? (
        <img src={cover} alt="" className={cn("size-full object-cover", className)} />
    ) : (
        <span className={cn("grid size-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(246,177,129,0.55),transparent_60%),linear-gradient(135deg,#fff3e8,#f3ecff)] text-[40px] font-semibold text-[var(--brand-600)] dark:bg-[linear-gradient(135deg,#2b1f17,#1f1d2b)]", className)}>
            {Array.from(skill.name)[0]}
        </span>
    );
}

function SkillTags({ skill }: { skill: AgentSkillSummary }) {
    return (
        <span className="flex flex-wrap gap-1">
            {(skill.workspaces || []).map((workspace) => (
                <span key={workspace} className="rounded-md bg-[var(--surface-inset)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)]">
                    {WORKSPACE_LABELS[workspace] || workspace}
                </span>
            ))}
            {skill.requiresReference ? (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[11px] text-[var(--brand-600)]">
                    <ImagePlus className="size-3" /> 需上传参考图
                </span>
            ) : null}
        </span>
    );
}

function FeaturedSkill({ skill, onOpen, onStart }: { skill: AgentSkillSummary; onOpen: () => void; onStart: () => void }) {
    const presentation = skillPresentation(skill);
    return (
        <section data-testid="skill-plaza-featured" className="group mt-6 grid overflow-hidden rounded-3xl bg-[var(--surface-panel)] shadow-[inset_0_0_0_1px_var(--hairline)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <button type="button" onClick={onOpen} className="relative aspect-[16/10] overflow-hidden md:aspect-auto md:min-h-[300px]" aria-label={`查看 ${skill.name} 详情`}>
                <span className="absolute inset-0">
                    <SkillCover skill={skill} className="transition-transform duration-500 group-hover:scale-[1.03]" />
                </span>
                <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur-sm">
                    <Sparkles className="size-3.5" /> 本周推荐
                </span>
            </button>
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
                <h2 className="text-[24px] font-semibold tracking-tight">{skill.name}</h2>
                {presentation.tagline ? <p className="text-[15px] font-medium text-[var(--ink-2)]">{presentation.tagline}</p> : null}
                <p className="text-[13.5px] leading-6 text-[var(--ink-3)]">{skill.description}</p>
                <SkillTags skill={skill} />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={onStart} style={{ color: "var(--surface-canvas)", backgroundColor: "var(--ink-1)" }} className="inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-[14px] font-medium transition-opacity hover:opacity-85">
                        用这个 Skill 开始 <ArrowRight className="size-4" />
                    </button>
                    <button type="button" onClick={onOpen} className="text-[13px] text-[var(--ink-3)] hover:text-[var(--ink-1)]">
                        查看详情
                    </button>
                </div>
            </div>
        </section>
    );
}

function SkillCard({ skill, onOpen, onStart }: { skill: AgentSkillSummary; onOpen: () => void; onStart: () => void }) {
    const presentation = skillPresentation(skill);
    return (
        <article role="listitem" data-testid="skill-plaza-card" className="group flex flex-col overflow-hidden rounded-2xl bg-[var(--surface-panel)] shadow-[inset_0_0_0_1px_var(--hairline)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--hairline),0_16px_36px_-18px_rgba(17,17,19,0.28)]">
            <button type="button" onClick={onOpen} className="relative aspect-[16/10] overflow-hidden" aria-label={`查看 ${skill.name} 详情`}>
                <SkillCover skill={skill} className="transition-transform duration-500 group-hover:scale-[1.04]" />
            </button>
            <div className="flex flex-1 flex-col gap-2 p-4">
                <button type="button" onClick={onOpen} className="text-left">
                    <h3 className="text-[15px] font-semibold">{skill.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-[var(--ink-3)]">{presentation.tagline || skill.description}</p>
                </button>
                <SkillTags skill={skill} />
                <button type="button" onClick={onStart} className="mt-auto inline-flex h-8 w-fit items-center gap-1 pt-1 text-[13px] font-medium text-[var(--ink-1)] transition-colors hover:text-[var(--brand-600)]">
                    立即使用 <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
            </div>
        </article>
    );
}

function SkillDetail({ skill, onClose, onStart }: { skill: AgentSkillSummary | null; onClose: () => void; onStart: (skill: AgentSkillSummary, withExample?: boolean) => void }) {
    const presentation = skill ? skillPresentation(skill) : null;
    return (
        <Modal open={Boolean(skill)} onCancel={onClose} footer={null} centered width="min(92vw, 720px)" title={null} destroyOnHidden styles={{ container: { padding: 0, overflow: "hidden", borderRadius: 20 } }}>
            {skill && presentation ? (
                <div data-testid="skill-plaza-detail">
                    <div className="relative aspect-[21/9] overflow-hidden">
                        <SkillCover skill={skill} />
                        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
                        <h2 className="absolute bottom-4 left-6 text-[24px] font-semibold text-white">{skill.name}</h2>
                    </div>
                    <div className="space-y-4 p-6">
                        {presentation.tagline ? <p className="text-[15px] font-medium text-[var(--ink-1)]">{presentation.tagline}</p> : null}
                        <p className="text-[13.5px] leading-6 text-[var(--ink-2)]">{skill.description}</p>
                        <SkillTags skill={skill} />
                        <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                            <p className="text-[12px] font-medium text-[var(--ink-3)]">怎么写需求</p>
                            <p className="mt-1 text-[13.5px] leading-6 text-[var(--ink-1)]">{presentation.placeholder}</p>
                            {presentation.example ? (
                                <>
                                    <p className="mt-3 text-[12px] font-medium text-[var(--ink-3)]">示例</p>
                                    <p className="mt-1 text-[13.5px] leading-6 text-[var(--ink-2)]">{presentation.example}</p>
                                </>
                            ) : null}
                        </div>
                        {skill.keywords?.length ? (
                            <p className="text-[12px] leading-5 text-[var(--ink-3)]">在 Agent 里提到这些词也会自动用上它：{skill.keywords.slice(0, 8).join("、")}</p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                            <button type="button" onClick={() => onStart(skill)} style={{ color: "var(--surface-canvas)", backgroundColor: "var(--ink-1)" }} className="inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-[14px] font-medium transition-opacity hover:opacity-85">
                                用这个 Skill 开始 <ArrowRight className="size-4" />
                            </button>
                            {presentation.example ? (
                                <button type="button" onClick={() => onStart(skill, true)} className="inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-[var(--ink-1)] shadow-[inset_0_0_0_1px_var(--hairline)] transition-colors hover:bg-[var(--surface-soft)]">
                                    带着示例试试
                                </button>
                            ) : null}
                            {skill.sourceUrl ? (
                                <a href={skill.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--ink-3)] hover:text-[var(--ink-1)]">
                                    来源{skill.license ? ` · ${skill.license}` : ""} <ExternalLink className="size-3" />
                                </a>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
