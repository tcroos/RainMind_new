"use client";

import { App, Dropdown, Input, Modal } from "antd";
import { Ellipsis, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

import type { CanvasProjectSummary } from "@/lib/canvas-project-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { createCanvasProject, deleteCanvasProjects, listCanvasProjectSummaries, saveCanvasProjectMutation } from "@/services/api/canvas-projects";

/* 侧栏新建的画布项目会被画布页自己改标题 / 删除，靠一个轻量事件让最近项目列表重拉，
 * 不往画布域里塞全局 store 依赖。 */
export const PROJECTS_CHANGED_EVENT = "vozeb:canvas-projects-changed";
const MAX_RECENT_PROJECTS = 8;

/** 顶部「+ 新建项目」：直接创建一张画布并进入，不再先跳到列表页再二次跳转。 */
export function SidebarNewProject({ expanded }: { expanded: boolean }) {
    const router = useRouter();
    const { message } = App.useApp();
    const [creating, setCreating] = useState(false);

    const create = async () => {
        if (creating) return;
        setCreating(true);
        try {
            const project = await createCanvasProject({ title: "未命名画布" });
            window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
            router.push(`/canvas/${project.id}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建项目失败");
        } finally {
            setCreating(false);
        }
    };

    return (
        <button
            type="button"
            disabled={creating}
            onClick={() => void create()}
            aria-label="新建项目"
            title="新建项目"
            /* 收起/展开同一套几何：左边缘固定在 16px，图标左内边距 11px（中心 x≈36），
             * 只有宽度在 40px 与整行之间过渡，文字淡入淡出 —— 动画时「+」不左右跳。 */
            className={cn(
                "sidebar-new-project flex h-10 items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl pl-[11px] text-[13.5px] font-medium shadow-[0_1px_2px_rgba(17,17,19,0.04)] transition-[width,background-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)] disabled:cursor-progress",
                expanded ? "w-full pr-3" : "w-10",
            )}
        >
            {creating ? <Loader2 className="size-[17px] shrink-0 animate-spin" /> : <Plus className="size-[17px] shrink-0" />}
            <span aria-hidden={!expanded || undefined} className={cn("transition-opacity duration-200", !expanded && "opacity-0")}>
                新建项目
            </span>
        </button>
    );
}

/**
 * 导航下方的「最近项目」。数据直接取画布项目列表（服务端已按 updatedAt 倒序），
 * 数量按视口剩余高度在 3~8 之间收敛：900px 视口给满 8 条，矮屏不会把账号条顶出屏幕。
 * 收起态只留图标导航，不渲染这一块。
 */
export function SidebarRecentProjects({ expanded }: { expanded: boolean }) {
    const pathname = usePathname();
    const { message, modal } = App.useApp();
    const inCanvas = pathname.startsWith("/canvas");
    const [projects, setProjects] = useState<CanvasProjectSummary[]>([]);
    const [limit, setLimit] = useState(6);
    const [preview, setPreview] = useState<{ url: string; title: string; top: number } | null>(null);
    const [previewBroken, setPreviewBroken] = useState(false);
    const [renameTarget, setRenameTarget] = useState<CanvasProjectSummary | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renameSaving, setRenameSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const page = await listCanvasProjectSummaries({ page: 1, pageSize: MAX_RECENT_PROJECTS });
            setProjects(page.projects);
        } catch {
            /* 未登录 / 接口暂时不可用时，最近项目安静留空，不影响主导航 */
            setProjects([]);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load, inCanvas]);

    useEffect(() => {
        const onChange = () => void load();
        window.addEventListener(PROJECTS_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onChange);
    }, [load]);

    useEffect(() => {
        const sync = () => setLimit(Math.max(3, Math.min(MAX_RECENT_PROJECTS, Math.floor((window.innerHeight - 560) / 34))));
        sync();
        window.addEventListener("resize", sync);
        return () => window.removeEventListener("resize", sync);
    }, []);

    const startRename = (project: CanvasProjectSummary) => {
        setRenameTarget(project);
        setRenameValue(project.title || "未命名画布");
    };

    const submitRename = async () => {
        const title = renameValue.trim();
        if (!renameTarget || !title || renameSaving) return;
        setRenameSaving(true);
        try {
            await saveCanvasProjectMutation(renameTarget.id, {
                mutationId: crypto.randomUUID(),
                baseUpdatedAt: renameTarget.updatedAt,
                title,
            });
            setRenameTarget(null);
            await load();
            message.success("已重命名");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重命名失败");
        } finally {
            setRenameSaving(false);
        }
    };

    const removeProject = (project: CanvasProjectSummary) => {
        modal.confirm({
            title: "删除项目？",
            content: `「${project.title || "未命名画布"}」删除后无法恢复。`,
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteCanvasProjects([project.id]);
                await load();
                message.success("项目已删除");
            },
        });
    };

    if (!expanded) return null;

    return (
        <section aria-label="最近项目" className="min-w-0">
            <div className="mb-1.5 px-3 text-[12px] font-normal text-[var(--ink-3)]">最近项目</div>
            <div className="space-y-0.5">
                {projects.slice(0, limit).map((project) => {
                    const cover = project.previews?.find((item) => item.kind === "image")?.url || project.previews?.[0]?.url;
                    const title = project.title || "未命名画布";
                    return (
                        <div key={project.id} className="group/recent relative">
                            <Link
                                href={`/canvas/${project.id}`}
                                className="sidebar-recent-link flex h-9 items-center rounded-lg px-3 text-[13px] transition-colors"
                                onMouseEnter={(event) => {
                                    setPreviewBroken(false);
                                    setPreview(cover ? { url: cover, title, top: Math.max(8, Math.min(event.currentTarget.getBoundingClientRect().top - 12, window.innerHeight - 210)) } : null);
                                }}
                                onMouseLeave={() => setPreview(null)}
                            >
                                <span className="min-w-0 flex-1 truncate">{title}</span>
                            </Link>
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomRight"
                                rootClassName="sidebar-recent-menu"
                                menu={{
                                    items: [
                                        { key: "rename", label: "重命名", icon: <Pencil className="size-3.5" /> },
                                        { key: "delete", label: "删除", icon: <Trash2 className="size-3.5" />, danger: true },
                                    ],
                                    onClick: ({ key }) => {
                                        if (key === "rename") startRename(project);
                                        if (key === "delete") removeProject(project);
                                    },
                                }}
                            >
                                <button
                                    type="button"
                                    aria-label={`${title} 更多操作`}
                                    title="更多操作"
                                    className="sidebar-recent-more absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md opacity-0 transition-opacity group-hover/recent:opacity-100 focus-visible:opacity-100"
                                    onClick={(event) => event.preventDefault()}
                                >
                                    <Ellipsis className="size-4" />
                                </button>
                            </Dropdown>
                        </div>
                    );
                })}
            </div>

            {preview ? (
                <div className="pointer-events-none fixed left-[240px] z-50 w-64 overflow-hidden rounded-xl bg-[var(--surface-panel)] p-1.5 shadow-[0_18px_44px_-24px_rgba(17,17,19,0.45)]" style={{ top: preview.top }}>
                    {previewBroken ? (
                        <div className="flex aspect-[16/10] items-center justify-center rounded-lg bg-[var(--surface-inset)] px-4 text-center text-[12px] text-[var(--ink-2)]">{preview.title}</div>
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- 画布预览来自用户媒体，不走 next/image 白名单
                        <img
                            src={imagePreviewUrl(preview.url, 640)}
                            alt={preview.title}
                            className="aspect-[16/10] w-full rounded-lg object-cover"
                            onError={() => setPreviewBroken(true)}
                        />
                    )}
                </div>
            ) : null}

            <Modal
                title="重命名项目"
                open={Boolean(renameTarget)}
                onCancel={() => setRenameTarget(null)}
                onOk={() => void submitRename()}
                okText="保存"
                cancelText="取消"
                confirmLoading={renameSaving}
                destroyOnHidden
                width={400}
            >
                <Input value={renameValue} maxLength={120} onChange={(event) => setRenameValue(event.target.value)} onPressEnter={() => void submitRename()} placeholder="项目名称" />
            </Modal>
        </section>
    );
}
