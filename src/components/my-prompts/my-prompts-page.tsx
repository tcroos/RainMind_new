"use client";

import { FolderPlus, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { App, Button, Form, Input, Modal, Pagination, Popconfirm, Tag } from "antd";

import { LibraryEmptyState, LibraryShowcaseEmptyState } from "@/components/library/library-ui";
import { PromptCard } from "@/components/prompts/prompt-card";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { cn } from "@/lib/utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { createMyPrompt, deleteMyPrompt, listMyPrompts } from "@/services/api/my-prompts";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";
import { useAssetStore } from "@/stores/use-asset-store";

const PAGE_SIZE = 12;

type PromptFormValue = {
    title: string;
    prompt: string;
    category?: string;
    tags?: string;
    coverUrl?: string;
    preview?: string;
};

export function MyPromptsPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm<PromptFormValue>();
    const [items, setItems] = useState<Prompt[]>([]);
    const [total, setTotal] = useState(0);
    const [categories, setCategories] = useState<string[]>([ALL_PROMPTS_OPTION]);
    const [keyword, setKeyword] = useState("");
    const [category, setCategory] = useState(ALL_PROMPTS_OPTION);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [selectedPreviewUrl, setSelectedPreviewUrl] = useState("");
    const copyText = useCopyText();
    const addAsset = useAssetStore((state) => state.addAsset);
    const deferredKeyword = useDeferredValue(keyword.trim());
    const hasFilters = Boolean(keyword.trim()) || category !== ALL_PROMPTS_OPTION;
    const requestRevision = useRef(0);

    const loadPrompts = useCallback(async () => {
        const revision = ++requestRevision.current;
        setLoading(true);
        try {
            const payload = await listMyPrompts({ page, pageSize: PAGE_SIZE, keyword: deferredKeyword, category });
            if (revision !== requestRevision.current) return;
            setItems(payload.items);
            setTotal(payload.total);
            setCategories([ALL_PROMPTS_OPTION, ...(payload.categories || [])]);
        } catch (error) {
            if (revision === requestRevision.current) message.error(error instanceof Error ? error.message : "获取我的提示词失败");
        } finally {
            if (revision === requestRevision.current) setLoading(false);
        }
    }, [category, deferredKeyword, message, page]);

    useEffect(() => {
        void loadPrompts();
    }, [loadPrompts, reloadToken]);

    const updateCategory = (value: string) => {
        setCategory(value);
        setPage(1);
    };

    const clearFilters = () => {
        setKeyword("");
        setCategory(ALL_PROMPTS_OPTION);
        setPage(1);
    };

    const createPrompt = async (value: PromptFormValue) => {
        setSubmitting(true);
        try {
            await createMyPrompt({ ...value, tags: splitTags(value.tags) });
            form.resetFields();
            setCreateOpen(false);
            message.success("提示词已保存");
            // 新记录可能不满足当前筛选条件，保存后回到第一页看全部
            setKeyword("");
            setCategory(ALL_PROMPTS_OPTION);
            setPage(1);
            setReloadToken((token) => token + 1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新增提示词失败");
        } finally {
            setSubmitting(false);
        }
    };

    const deletePrompt = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteMyPrompt(id);
            message.success("提示词已删除");
            const targetPage = Math.min(page, Math.max(1, Math.ceil(Math.max(0, total - 1) / PAGE_SIZE)));
            if (targetPage === page) setReloadToken((token) => token + 1);
            else setPage(targetPage);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除提示词失败");
        } finally {
            setDeletingId("");
        }
    };

    const savePromptAsset = async (item: Prompt) => {
        try {
            await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "my-prompts", promptId: item.id } });
            message.success("已加入我的素材");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材保存失败");
        }
    };

    const showEmptyState = !loading && items.length === 0;

    return (
        /* 只作为「素材库」的提示词面板存在：不自带 h1、不自带滚动容器，
         * 外框（标题 / tab / 滚动 / max-width）统一由 assets 页面提供。
         * 自己再套一层 <main> + overflow 会变成页内第二条滚动条，也是「硬塞」的来源。 */
        <div className="bg-background">
            <div className="w-full">
                {/* 新增按钮与搜索框同一行：不再单独占一条页头，
                    这也是「我的提示词」和另外两个 tab 保持 toolbar 语言一致的地方。 */}
                <div className="flex flex-wrap items-center gap-2 pt-5">
                    <Input
                        allowClear
                        size="large"
                        className="library-input min-w-[180px] flex-1 sm:max-w-sm"
                        prefix={<Search className="size-4 text-[var(--ink-3)]" />}
                        value={keyword}
                        placeholder="搜索标题或提示词内容"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                    <Button size="large" className="library-tool" icon={<RotateCcw className="size-3.5" />} aria-label="清除筛选" disabled={!hasFilters} onClick={clearFilters}>
                        清除
                    </Button>
                    <div className="ml-auto flex shrink-0 items-center gap-2.5">
                        <span className="hidden text-[12px] tabular-nums text-[var(--ink-3)] sm:inline">共 {total} 条</span>
                        {/* 完全空白时只留下方引导区那一个入口，工具栏不再重复；
                            与「我的素材」保持同一套规则。 */}
                        {loading || items.length ? (
                            <Button type="primary" size="large" icon={<Plus className="size-4" />} className="library-primary" onClick={() => setCreateOpen(true)}>
                                添加提示词
                            </Button>
                        ) : null}
                    </div>
                </div>

                {categories.length > 1 ? (
                    <div className="mt-3 flex min-w-0 items-center gap-2">
                        <span className="w-8 shrink-0 text-[11px] font-medium text-[var(--ink-3)]">分类</span>
                        <div className="thin-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {categories.map((option) => {
                                const active = option === category;
                                return (
                                    <Tag.CheckableTag key={option} checked={active} className={cn("prompt-filter-tag shrink-0", active && "is-active")} onChange={() => updateCategory(option)}>
                                        {option}
                                    </Tag.CheckableTag>
                                );
                            })}
                        </div>
                    </div>
                ) : null}

                    {/* 首屏不再铺一排假卡片：那 4 张灰色占位会被看成「有内容」，
                        等接口回来再替换成空状态，肉眼就是一次明显闪烁。 */}
                    {loading && !items.length ? (
                        <div className="flex min-h-[220px] items-center justify-center pt-8 text-[12px] text-[var(--ink-3)]" aria-busy="true">
                            正在加载提示词
                        </div>
                    ) : null}

                    {showEmptyState ? (
                        hasFilters ? (
                            <LibraryEmptyState icon={<Search className="size-5" />} title="没有匹配的提示词" description="换个关键词，或清除分类筛选再看看。" action={<Button icon={<RotateCcw className="size-3.5" />} onClick={clearFilters}>清除筛选</Button>} />
                        ) : (
                            <LibraryShowcaseEmptyState
                                images={["/library/prompt-empty-banner-back.webp", "/library/prompt-empty-banner.webp"]}
                                title="还没有提示词"
                                description="把常用的提示词存进来，创作时一键复用。"
                                action={
                                    <Button type="primary" size="large" className="library-primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                                        添加第一个提示词
                                    </Button>
                                }
                            />
                        )
                    ) : null}

                    {!loading && items.length ? (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {items.map((item) => (
                                <PromptCard
                                    key={item.id}
                                    item={item}
                                    onOpen={(previewUrl) => {
                                        setSelectedPrompt(item);
                                        setSelectedPreviewUrl(previewUrl || "");
                                    }}
                                    onCopy={() => copyText(item.prompt, "提示词已复制")}
                                    extraAction={
                                        <div className="flex items-center gap-0.5">
                                            <Button
                                                size="small"
                                                type="text"
                                                shape="circle"
                                                className="library-card-action"
                                                icon={<FolderPlus className="size-3.5" />}
                                                aria-label="加入我的素材"
                                                title="加入我的素材"
                                                onClick={() => savePromptAsset(item)}
                                            />
                                            <Popconfirm title="删除提示词？" description="删除后无法恢复。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => deletePrompt(item.id)}>
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    shape="circle"
                                                    danger
                                                    className="library-card-action"
                                                    icon={<Trash2 className="size-3.5" />}
                                                    aria-label="删除提示词"
                                                    title="删除提示词"
                                                    loading={deletingId === item.id}
                                                />
                                            </Popconfirm>
                                        </div>
                                    }
                                />
                            ))}
                        </div>
                    ) : null}

                    {total > PAGE_SIZE ? (
                        <div className="flex flex-wrap items-center justify-center gap-3 py-5 sm:py-8">
                            <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} showLessItems responsive onChange={setPage} />
                            <span className="text-[11px] tabular-nums text-[var(--ink-3)] sm:text-xs">
                                第 {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
                            </span>
                        </div>
                    ) : null}
                </div>

            <PromptDetailDialog
                prompt={selectedPrompt}
                previewUrl={selectedPreviewUrl}
                onClose={() => {
                    setSelectedPrompt(null);
                    setSelectedPreviewUrl("");
                }}
                onCopy={(prompt) => copyText(prompt, "提示词已复制")}
                onSaveAsset={savePromptAsset}
            />

            <Modal
                className="prompt-create-modal"
                title="添加提示词"
                open={createOpen}
                footer={null}
                centered
                width={680}
                destroyOnHidden
                onCancel={() => setCreateOpen(false)}
                afterClose={() => form.resetFields()}
                styles={{ header: { borderBottom: 0 }, body: { maxHeight: "calc(100dvh - 200px)", overflowY: "auto", paddingTop: 4 } }}
            >
                <Form form={form} layout="vertical" onFinish={createPrompt} requiredMark={false} className="prompt-form">
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
                            <Input size="large" placeholder="例如：产品摄影主视觉" />
                        </Form.Item>
                        <Form.Item label="分类" name="category">
                            <Input size="large" placeholder="例如：商业海报" />
                        </Form.Item>
                        <Form.Item label="标签" name="tags">
                            <Input size="large" placeholder="摄影, 电商, 写实" />
                        </Form.Item>
                        <Form.Item label="封面 URL" name="coverUrl">
                            <Input size="large" placeholder="https://..." />
                        </Form.Item>
                    </div>
                    <Form.Item label="提示词内容" name="prompt" rules={[{ required: true, message: "请输入提示词内容" }]}>
                        <Input.TextArea rows={6} placeholder="输入完整提示词..." />
                    </Form.Item>
                    <Form.Item label="备注" name="preview">
                        <Input size="large" placeholder="可选" />
                    </Form.Item>
                    <div className="flex justify-end gap-2 pt-1">
                        <Button className="library-tool" size="large" onClick={() => setCreateOpen(false)}>
                            取消
                        </Button>
                        <Button className="library-primary" type="primary" htmlType="submit" size="large" loading={submitting} icon={<Plus className="size-4" />}>
                            保存提示词
                        </Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

function splitTags(value?: string) {
    return (value || "")
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
}
