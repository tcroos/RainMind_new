"use client";

import { useEffect, useState } from "react";
import { App, Input, Modal, Segmented } from "antd";
import { Clapperboard, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/stores/use-user-store";
import { normalizeDramaImageSize } from "@/lib/drama-image-size";

import { DramaProjectCard } from "./components/drama-project-card";
import { useDramaStore } from "./stores/use-drama-store";

/* 和广场 / 素材库同一套「无线条」语言：不画页头横线、不摆虚线新建卡、不套描边输入框。
 * 层级只靠留白、字重、浅底块（--surface-inset）和唯一一处品牌橙动作点。 */
const primaryButtonClass = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl !bg-[var(--brand-600)] px-5 text-[13px] font-medium !text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const softButtonClass = "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl !bg-[var(--surface-inset)] px-5 text-[13px] font-medium !text-[var(--ink-1)] transition hover:opacity-75";
const fieldLabelClass = "text-[13px] font-semibold leading-5 text-[var(--ink-1)]";

export default function DramaPage() {
    const router = useRouter();
    const { message } = App.useApp();
    const hydrated = useDramaStore((state) => state.hydrated);
    const hydrate = useDramaStore((state) => state.hydrate);
    const syncError = useDramaStore((state) => state.syncError);
    const projects = useDramaStore((state) => state.summaries);
    const projectTotal = useDramaStore((state) => state.summaryTotal);
    const loadingMore = useDramaStore((state) => state.summaryLoadingMore);
    const loadMore = useDramaStore((state) => state.loadMore);
    const createProject = useDramaStore((state) => state.createProject);
    const userId = useUserStore((state) => state.user?.id || "");
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [style, setStyle] = useState("电影感国漫");
    const [ratio, setRatio] = useState("9:16");
    const [customWidth, setCustomWidth] = useState(1080);
    const [customHeight, setCustomHeight] = useState(1920);
    const [creating, setCreating] = useState(false);
    const episodeCount = projects.reduce((total, project) => total + project.episodeCount, 0);
    const pendingCount = projects.reduce((total, project) => total + project.pendingTaskCount, 0);
    useEffect(() => {
        void hydrate();
    }, [hydrate, userId]);
    const create = async () => {
        if (!title.trim()) return message.warning("请输入项目名称");
        const normalizedSize = normalizeDramaImageSize(ratio);
        if (!normalizedSize) return message.warning("请输入有效的短剧尺寸");
        setCreating(true);
        try {
            const id = await createProject({ title: title.trim(), summary: summary.trim(), style: style.trim(), ratio: normalizedSize });
            setOpen(false);
            setTitle("");
            setSummary("");
            router.push(`/drama/${id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "短剧项目创建失败");
        } finally {
            setCreating(false);
        }
    };
    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto w-full max-w-[1440px] px-5 pb-20 pt-8 sm:px-9 sm:pb-24 sm:pt-12 lg:px-12">
                {/* 页头不再压一条横线：标题、说明、统计和动作各自成组，靠留白分层。 */}
                <header className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--ink-3)]">
                            <Clapperboard className="size-3.5" />
                            短剧生产线
                        </div>
                        {/* h1 的 margin 被 antd 重置，上边距交给包裹层承载。 */}
                        <div className="mt-3">
                            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--ink-1)] sm:text-[32px]">短剧项目</h1>
                        </div>
                        <p className="mt-2 text-[13px] leading-6 text-[var(--ink-3)]">从故事简介到分镜成片，一条线把每集做完</p>
                        <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-[var(--ink-2)]">
                            <span className="inline-flex h-7 items-center rounded-full bg-[var(--surface-inset)] px-3">{projectTotal} 个项目</span>
                            <span className="inline-flex h-7 items-center rounded-full bg-[var(--surface-inset)] px-3">{episodeCount} 集</span>
                            {pendingCount ? <span className="inline-flex h-7 items-center rounded-full bg-amber-50 px-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">{pendingCount} 个任务执行中</span> : null}
                        </div>
                    </div>
                    <button type="button" disabled={!hydrated} onClick={() => setOpen(true)} className={primaryButtonClass}>
                        <Plus className="size-4" />
                        新建短剧
                    </button>
                </header>

                {syncError ? (
                    <div className="mt-7 rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-6 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">项目服务暂不可用：{syncError}</div>
                ) : null}

                {!hydrated ? (
                    <div className="grid min-h-40 place-items-center text-[13px] text-[var(--ink-3)]">正在加载短剧项目…</div>
                ) : projects.length ? (
                    <>
                        <section className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
                            {/* 新建入口从虚线框改成一块浅底卡：不靠边框提示「可点击」。 */}
                            <button
                                type="button"
                                onClick={() => setOpen(true)}
                                className="group/create flex min-h-[210px] flex-col items-center justify-center gap-1 rounded-2xl bg-[var(--surface-inset)] px-6 text-center transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-28px_rgba(17,17,19,0.42)] motion-reduce:transition-none"
                            >
                                <span className="grid size-12 place-items-center rounded-full bg-[var(--surface-panel)] text-[var(--brand-600)] transition-transform duration-200 group-hover/create:scale-105">
                                    <Plus className="size-5" />
                                </span>
                                <span className="mt-3 text-[14px] font-semibold text-[var(--ink-1)]">新建短剧</span>
                                <span className="mt-1 text-[12px] text-[var(--ink-3)]">从故事简介开始搭分镜</span>
                            </button>
                            {projects.map((project) => (
                                <DramaProjectCard key={project.id} project={project} />
                            ))}
                        </section>
                        {projects.length < projectTotal ? (
                            <div className="flex justify-center pt-10 sm:pt-14">
                                <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={softButtonClass}>
                                    {loadingMore ? "加载中…" : "加载更多"}
                                </button>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center sm:min-h-[400px] sm:py-24">
                        <span className="grid size-14 place-items-center rounded-2xl bg-[var(--surface-inset)] text-[var(--ink-3)]">
                            <Clapperboard className="size-6" />
                        </span>
                        <div className="mt-6">
                            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--ink-1)]">还没有短剧项目</h2>
                        </div>
                        <p className="mt-2 max-w-sm text-[13px] leading-6 text-[var(--ink-3)]">从剧本结构开始创建第一条短剧生产线。</p>
                        <div className="mt-7">
                            <button type="button" onClick={() => setOpen(true)} className={primaryButtonClass}>
                                <Plus className="size-4" />
                                新建第一个项目
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 新建弹窗：一张无分隔线的整卡。字段统一浅底无描边，底栏只留两个动作。 */}
            <Modal
                title="新建短剧项目"
                open={open}
                width={520}
                destroyOnHidden
                style={{ maxWidth: "calc(100vw - 24px)" }}
                styles={{ body: { padding: "4px 24px 24px" } }}
                footer={null}
                onCancel={() => setOpen(false)}
            >
                <div className="grid gap-5">
                    <p className="text-[13px] leading-6 text-[var(--ink-3)]">先定下名字和风格，进入项目后可以把故事逐步拆成剧集与分镜。</p>
                    <div className="grid gap-2">
                        <label htmlFor="drama-project-title" className={fieldLabelClass}>
                            项目名称
                        </label>
                        <Input id="drama-project-title" className="library-input !h-11" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：月影长安" />
                    </div>
                    <div className="grid gap-2">
                        <label htmlFor="drama-project-summary" className={fieldLabelClass}>
                            故事简介
                        </label>
                        <Input.TextArea id="drama-project-summary" className="library-input" value={summary} onChange={(event) => setSummary(event.target.value)} autoSize={{ minRows: 2, maxRows: 3 }} placeholder="一句话说明人物、冲突和目标" />
                    </div>
                    <div className="grid gap-2">
                        <label htmlFor="drama-project-style" className={fieldLabelClass}>
                            视觉风格
                        </label>
                        <Input id="drama-project-style" className="library-input !h-11" value={style} onChange={(event) => setStyle(event.target.value)} />
                    </div>
                    <div className="grid min-w-0 gap-2">
                        <span className={fieldLabelClass}>生成尺寸</span>
                        <div className="min-w-0">
                            <Segmented
                                block
                                className="library-segmented !w-full"
                                value={ratio.includes("x") ? "custom" : ratio}
                                options={[
                                    { label: "9:16", value: "9:16" },
                                    { label: "16:9", value: "16:9" },
                                    { label: "自定义", value: "custom" },
                                ]}
                                onChange={(value) => setRatio(value === "custom" ? `${customWidth}x${customHeight}` : String(value))}
                            />
                        </div>
                        {ratio.includes("x") ? (
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                {/* 用 Input 而非 InputNumber：两者都能填数字，但 Input 能复用
                                    library-input 那套浅底无描边样式，不用再为数字框单独写一份覆盖。 */}
                                <Input
                                    className="library-input !h-11"
                                    type="number"
                                    min={256}
                                    value={customWidth}
                                    prefix="W"
                                    aria-label="自定义宽度"
                                    onChange={(event) => {
                                        const width = Number(event.target.value) || 256;
                                        setCustomWidth(width);
                                        setRatio(`${width}x${customHeight}`);
                                    }}
                                />
                                <span className="text-[var(--ink-3)]">×</span>
                                <Input
                                    className="library-input !h-11"
                                    type="number"
                                    min={256}
                                    value={customHeight}
                                    prefix="H"
                                    aria-label="自定义高度"
                                    onChange={(event) => {
                                        const height = Number(event.target.value) || 256;
                                        setCustomHeight(height);
                                        setRatio(`${customWidth}x${height}`);
                                    }}
                                />
                            </div>
                        ) : null}
                    </div>
                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button type="button" onClick={() => setOpen(false)} className={softButtonClass}>
                            取消
                        </button>
                        <button type="button" disabled={creating} onClick={() => void create()} className={primaryButtonClass}>
                            {creating ? "创建中…" : "创建并进入"}
                        </button>
                    </div>
                </div>
            </Modal>
        </main>
    );
}
