"use client";

import { FolderPlus, RotateCcw, Search } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { App, Button, Input, Pagination, Tag } from "antd";

import { LibraryEmptyState } from "@/components/library/library-ui";
import { PromptCard } from "@/components/prompts/prompt-card";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { usePromptPage } from "@/components/prompts/use-prompt-list";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

const PAGE_SIZE = 16;

/**
 * 公共词库面板。只负责自己的筛选行与卡片网格：
 * 页头、tab、滚动容器和 max-width 全部由素材库外壳（/assets）提供。
 * 之前它是一整个独立页面（自带 h1 + main + overflow），并进来时会变成
 * 「两条滚动 + 两个标题」；这里保持纯面板形态。
 */
export function PublicPromptsPanel() {
    const { message } = App.useApp();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [page, setPage] = useState(1);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [selectedPromptPreviewUrl, setSelectedPromptPreviewUrl] = useState("");
    const listStartRef = useRef<HTMLDivElement | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const deferredKeyword = useDeferredValue(titleKeyword.trim());
    const {
        query,
        items: promptItems,
        categories: promptCategoryOptions,
        total: totalPrompts,
    } = usePromptPage({
        keyword: deferredKeyword,
        tag: ALL_PROMPTS_OPTION,
        category: selectedCategory,
        page,
        pageSize: PAGE_SIZE,
    });
    const hasFilters = Boolean(titleKeyword.trim()) || selectedCategory !== ALL_PROMPTS_OPTION;

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
        }
    }, [message, query.error, query.isError]);

    const updateCategory = (value: string) => {
        setSelectedCategory(value);
        setPage(1);
    };

    const clearFilters = () => {
        setTitleKeyword("");
        setSelectedCategory(ALL_PROMPTS_OPTION);
        setPage(1);
    };

    const changePage = (value: number) => {
        setPage(value);
        requestAnimationFrame(() => listStartRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };

    const savePromptAsset = async (item: Prompt) => {
        try {
            await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl || "" } });
            message.success("已加入我的素材");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材保存失败");
        }
    };

    return (
        <div className="bg-background">
            {/* 两行工具区，边距和另外两个 tab 对齐：
                第一行搜索 + 清除，第二行分类胶囊与总数齐高。删掉「分类」小字与标签下拉，
                胶囊本身就是筛选器，再挂一个下拉只会让人以为有两套筛选。 */}
            <div className="flex flex-wrap items-center gap-2 pt-4 sm:pt-5">
                <Input
                    allowClear
                    size="large"
                    className="library-input min-w-[180px] flex-1 sm:max-w-sm"
                    prefix={<Search className="size-4 text-[var(--ink-3)]" />}
                    value={titleKeyword}
                    placeholder="搜索标题或提示词内容"
                    onChange={(event) => {
                        setTitleKeyword(event.target.value);
                        setPage(1);
                    }}
                />
                <Button size="large" className="library-tool" icon={<RotateCcw className="size-3.5" />} disabled={!hasFilters} onClick={clearFilters}>
                    清除
                </Button>
            </div>

            <div className="mt-3 flex min-w-0 items-center gap-3">
                <div className="thin-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {promptCategoryOptions.map((option) => (
                        <Tag.CheckableTag
                            key={`category-${option}`}
                            checked={option === selectedCategory}
                            className={cn("prompt-filter-tag shrink-0", option === selectedCategory && "is-active")}
                            onChange={() => updateCategory(option)}
                        >
                            {option}
                        </Tag.CheckableTag>
                    ))}
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-[var(--ink-3)]">共 {totalPrompts} 条</span>
            </div>

            <div ref={listStartRef} className="scroll-mt-4 pt-4 sm:pt-5">
                {query.isLoading ? <PromptGridSkeleton /> : null}
                {!query.isLoading ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {promptItems.map((item) => (
                            <PromptCard
                                key={item.id}
                                item={item}
                                onOpen={(previewUrl) => {
                                    setSelectedPrompt(item);
                                    setSelectedPromptPreviewUrl(previewUrl || "");
                                }}
                                onCopy={() => copyText(item.prompt, "提示词已复制")}
                                extraAction={
                                    <Button
                                        size="small"
                                        type="text"
                                        className="library-card-action"
                                        icon={<FolderPlus className="size-3.5" />}
                                        aria-label="加入我的素材"
                                        title="加入我的素材"
                                        onClick={() => savePromptAsset(item)}
                                    />
                                }
                            />
                        ))}
                    </div>
                ) : null}
                {!query.isLoading && promptItems.length === 0 ? (
                    <LibraryEmptyState
                        icon={<Search className="size-5" />}
                        title="没有找到匹配的提示词"
                        description="换个关键词，或切换分类与标签再看看。"
                        action={
                            hasFilters ? (
                                <Button icon={<RotateCcw className="size-3.5" />} onClick={clearFilters}>
                                    清除筛选
                                </Button>
                            ) : null
                        }
                    />
                ) : null}
                {totalPrompts > PAGE_SIZE ? (
                    <div className="flex flex-wrap items-center justify-center gap-3 py-6">
                        <Pagination current={page} pageSize={PAGE_SIZE} total={totalPrompts} showSizeChanger={false} showLessItems responsive onChange={changePage} />
                        <span className="text-[11px] tabular-nums text-[var(--ink-3)] sm:text-xs">
                            第 {page} / {Math.max(1, Math.ceil(totalPrompts / PAGE_SIZE))} 页
                        </span>
                    </div>
                ) : null}
            </div>

            <PromptDetailDialog
                prompt={selectedPrompt}
                previewUrl={selectedPromptPreviewUrl}
                onClose={() => {
                    setSelectedPrompt(null);
                    setSelectedPromptPreviewUrl("");
                }}
                onCopy={(prompt) => copyText(prompt, "提示词已复制")}
                onSaveAsset={savePromptAsset}
            />
        </div>
    );
}

function PromptGridSkeleton() {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
            {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="overflow-hidden rounded-2xl bg-[var(--surface-panel)] p-3 shadow-[0_1px_2px_rgba(17,17,19,0.04)]">
                    <div className="aspect-[16/10] w-full rounded-xl bg-[var(--surface-inset)]" />
                    <div className="space-y-2 px-0.5 pt-3">
                        <div className="h-3.5 w-2/3 rounded bg-[var(--surface-inset)]" />
                        <div className="h-3 w-full rounded bg-[var(--surface-inset)]" />
                        <div className="h-3 w-4/5 rounded bg-[var(--surface-inset)]" />
                    </div>
                </div>
            ))}
        </div>
    );
}
