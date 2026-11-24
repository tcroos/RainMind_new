"use client";

import { FileAudio, Film, Plus, RotateCcw, Search, Upload } from "lucide-react";
import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { App, Button, Form, Input, Modal, Pagination, Segmented, Select, Space, Spin, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { useRouter, useSearchParams } from "next/navigation";

import { LibraryEmptyState, LibraryShowcaseEmptyState, LibraryTabs, type LibraryTabItem } from "@/components/library/library-ui";
import { MyPromptsPage } from "@/components/my-prompts/my-prompts-page";
import { PublicPromptsPanel } from "@/components/prompts/public-prompts-panel";

import { useCopyText } from "@/hooks/use-copy-text";
import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { formatBytes } from "@/lib/image-utils";
import { mediaDownloadFileName } from "@/lib/media-file";
import { imagePreviewUrl, originalImageDownloadUrl, originalImageExtension, originalMediaDownloadUrl } from "@/lib/media-image-url";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { isPermanentServerMedia, serverMediaUrl } from "@/services/server-media-storage";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type AudioAsset, type ImageAsset, type VideoAsset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type MediaDraft = ImageAsset["data"] | VideoAsset["data"] | AudioAsset["data"] | null;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

import { AssetCard, AssetPreviewModal } from "./asset-elements";
import { useAssetPage } from "./use-asset-page";

export default function AssetsPage() {
    const { message } = App.useApp();
    const router = useRouter();
    /* 素材与提示词合并成一个页面，靠 ?tab 切换。
     * 侧栏的二级菜单和页面内的 tab 都指向同一组 URL，两边状态永远一致。 */
    const searchParams = useSearchParams();
    /* 三段内容共用同一外壳：公共词库 / 我的提示词 / 我的素材。
     * 默认落在公共词库（内容最丰富的一页）；旧参数 ?tab=prompts 仍认作我的提示词，
     * ?tab=assets 仍认作我的素材，旧链接不会跳错。 */
    const rawTab = searchParams.get("tab");
    const tab: LibraryTabKey = rawTab === "mine" || rawTab === "prompts" ? "mine" : rawTab === "assets" ? "assets" : "public";
    /* 切换 tab 只改查询参数，不走 Next 的 Link/RSC 导航：后者会重新请求服务端组件，
     * 三个 tab 的内容被整块替换，肉眼能看到明显闪动。原生 history API 与 useSearchParams 同步。 */
    const selectTab = (key: string) => {
        const next = key === "public" ? "/assets" : `/assets?tab=${key}`;
        if (`${location.pathname}${location.search}` === next) return;
        window.history.pushState(null, "", next);
    };
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const userId = useUserStore((state) => state.user?.id || "");
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [isCoverDragActive, setIsCoverDragActive] = useState(false);
    const [isImageDragActive, setIsImageDragActive] = useState(false);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [mediaDraft, setMediaDraft] = useState<MediaDraft>(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const { assets, total, loading, error, reload } = useAssetPage({ userId, page, pageSize, kind: kindFilter, keyword });
    const ready = Boolean(userId);
    /* 空状态下不再给内容区额外留顶部间距：和「我的提示词」从工具栏下方同一位置起排，
       两个空状态的示范图与新增按钮才能严格对齐。 */
    const showAssetsEmpty = !loading && !error && !assets.length;

    const openCreate = () => {
        setEditingAsset(null);
        setMediaDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setMediaDraft(asset.kind === "text" ? null : asset.data);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        setSaving(true);
        try {
            const values = await form.validateFields();
            let nextCover = values.coverUrl?.trim() || (values.kind === "image" && mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : "");
            if (nextCover && !isPermanentServerMedia(undefined, nextCover)) nextCover = (await uploadImage(nextCover)).url;
            else nextCover = serverMediaUrl(undefined, nextCover);
            const base = {
                title: values.title.trim(),
                coverUrl: nextCover,
                tags: values.tags || [],
                source: values.source?.trim(),
                note: values.note?.trim(),
                metadata: editingAsset?.metadata || { source: "manual" },
            };

            if (values.kind === "text") {
                const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
                await (editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset));
            } else {
                if (!mediaDraft) throw new Error(`请选择${values.kind === "image" ? "图片" : values.kind === "video" ? "视频" : "音频"}文件`);
                const asset = { ...base, kind: values.kind, data: mediaDraft } as Parameters<typeof addAsset>[0];
                await (editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset));
            }

            message.success(editingAsset ? "素材已更新" : "素材已保存");
            setIsAssetOpen(false);
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材保存失败");
        } finally {
            setSaving(false);
        }
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const image = await uploadImage(file);
        form.setFieldValue("coverUrl", image.url);
    };

    const readMediaFile = async (file?: File) => {
        if (!file || formKind === "text" || !file.type.startsWith(`${formKind}/`)) return message.warning(`请选择${formKind === "image" ? "图片" : formKind === "video" ? "视频" : "音频"}格式文件`);
        const media = formKind === "image" ? await uploadImage(file) : await uploadMediaFile(file, formKind);
        const draft: MediaDraft =
            formKind === "image"
                ? { dataUrl: media.url, storageKey: media.storageKey, serverUrl: media.url, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType }
                : formKind === "video"
                  ? { url: media.url, storageKey: media.storageKey, serverUrl: media.url, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType }
                  : { url: media.url, storageKey: media.storageKey, serverUrl: media.url, durationMs: "durationMs" in media ? media.durationMs : undefined, bytes: media.bytes, mimeType: media.mimeType };
        setMediaDraft(draft);
        if (formKind === "image" && !form.getFieldValue("coverUrl") && "dataUrl" in draft) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const handleCoverDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsCoverDragActive(true);
    };

    const handleCoverDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event) || !leftDropTarget(event)) return;
        setIsCoverDragActive(false);
    };

    const handleCoverDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsCoverDragActive(false);
        const [file] = droppedFiles(event, (item) => item.type.startsWith("image/"));
        if (file) void readCoverFile(file);
    };

    const handleImageDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsImageDragActive(true);
    };

    const handleImageDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event) || !leftDropTarget(event)) return;
        setIsImageDragActive(false);
    };

    const handleImageDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsImageDragActive(false);
        const [file] = droppedFiles(event, (item) => formKind !== "text" && item.type.startsWith(`${formKind}/`));
        if (file) void readMediaFile(file);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "文本已复制");
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind === "text") return;
        const url = asset.kind === "image" ? originalImageDownloadUrl(asset.data.dataUrl) : originalMediaDownloadUrl(asset.data.url);
        const mediaUrl = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const media = asset.data;
        saveAs(url, mediaDownloadFileName(asset.id, media.mimeType, media.storageKey || media.serverUrl || mediaUrl));
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        setDeleting(true);
        try {
            await removeAsset(deletingAsset.id);
            message.success("素材已删除");
            setDeletingAsset(null);
            if (assets.length === 1 && page > 1) setPage((value) => Math.max(1, value - 1));
            else reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材删除失败");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="h-full min-h-0 overflow-hidden bg-background text-foreground">
            <main className="h-full min-h-0 overflow-y-auto px-3 py-3 sm:px-6 sm:py-6">
                <div className="mx-auto max-w-[1560px]">
                    {/* 统一外框：一个标题、一组 tab、一个滚动容器。
                        三段内容（素材 / 我的提示词 / 公共词库）共用这里，面板不再自带页头与滚动。
                        没有分割线、没有描边卡：层级靠留白、字重与浅底药丸表达。 */}
                    {/* 页头只留标题与 tab。三句副标题是上一版逐 tab 写的营销话术，
                        与卡片信息重复又占纵向空间，删掉后靠 tab 自身说明当前位置。 */}
                    <header>
                        <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--ink-1)] sm:text-2xl">素材库</h1>
                        <LibraryTabs tabs={LIBRARY_TABS} active={tab} onSelect={selectTab} />
                    </header>

                    {/* 我的提示词从素材库打开时就在后台预加载：切 tab 只是把已经就绪的面板显示出来。
                        之前切到 mine 才挂载，首帧必然命中 loading 骨架卡片，闪一下再变成空状态。 */}
                    <div className={tab === "mine" ? "" : "hidden"} aria-hidden={tab !== "mine"}>
                        <MyPromptsPage />
                    </div>

                    {tab === "public" ? (
                        <PublicPromptsPanel />
                    ) : tab === "assets" ? (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-5">
                                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                    {/* 普通 Input 而不是 Input.Search：已经是实时筛选，
                                        再挂一个独立搜索按钮只会多出一块方角，与无线条语言冲突。 */}
                                    <Input
                                        className="library-input min-w-[180px] flex-1 sm:max-w-sm"
                                        size="large"
                                        allowClear
                                        prefix={<Search className="size-4 text-[var(--ink-3)]" />}
                                        value={keyword}
                                        placeholder="搜索标题、内容、标签或来源"
                                        onChange={(event) => {
                                            setPage(1);
                                            setKeyword(event.target.value);
                                        }}
                                    />
                                    <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                        <Segmented
                                            className="library-segmented"
                                            value={kindFilter}
                                            options={kindOptions}
                                            onChange={(value) => {
                                                setPage(1);
                                                setKindFilter(value as AssetKind | "all");
                                            }}
                                        />
                                    </div>
                                </div>
                                {/* 完全空白时只在下方引导区给一个入口，工具栏不再重复；
                                    有素材（或正在加载）时按钮才出现在搜索框同一行。 */}
                                {(loading || assets.length > 0) ? (
                                    <Button type="primary" size="large" className="library-primary" icon={<Plus className="size-4" />} disabled={!ready} onClick={openCreate}>
                                        新增素材
                                    </Button>
                                ) : null}
                            </div>

                            <div className={cn(!showAssetsEmpty && "pt-4 sm:pt-5")}>
                                <div className={cn("grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-[repeat(auto-fill,minmax(240px,280px))] sm:justify-start", loading && assets.length && "opacity-60")} aria-busy={loading}>
                                    {assets.map((asset) => (
                                        <AssetCard
                                            key={asset.id}
                                            asset={asset}
                                            onOpen={() => setPreviewAsset(asset)}
                                            onEdit={() => openEdit(asset)}
                                            onCopy={copyAssetText}
                                            onDownload={downloadImage}
                                            onDelete={() => setDeletingAsset(asset)}
                                            onPublish={asset.kind === "text" ? undefined : () => router.push(`/works?sourceType=media&sourceId=${encodeURIComponent(asset.id)}`)}
                                        />
                                    ))}
                                </div>

                                {loading && !assets.length ? (
                                    <section className="flex min-h-40 items-center justify-center">
                                        <Spin description="正在加载素材" />
                                    </section>
                                ) : error ? (
                                    <LibraryEmptyState icon={<RotateCcw className="size-5" />} title="素材加载失败" description={error} action={<Button onClick={reload}>重新加载</Button>} />
                                ) : !assets.length ? (
                                    <LibraryShowcaseEmptyState
                                        images={["/library/asset-empty-banner-back.webp", "/library/asset-empty-banner.webp"]}
                                        title="还没有素材"
                                        description="把常用的图片、文本与视频存进来，创作时一键复用。"
                                        action={
                                            <div className="flex flex-wrap items-center justify-center gap-2">
                                                {keyword || kindFilter !== "all" ? (
                                                    <Button
                                                        size="large"
                                                        className="library-tool"
                                                        onClick={() => {
                                                            setKeyword("");
                                                            setKindFilter("all");
                                                            setPage(1);
                                                        }}
                                                    >
                                                        清除筛选
                                                    </Button>
                                                ) : null}
                                                <Button type="primary" size="large" className="library-primary" icon={<Plus className="size-4" />} disabled={!ready} onClick={openCreate}>
                                                    新增第一条素材
                                                </Button>
                                            </div>
                                        }
                                    />
                                ) : null}

                                {!loading && assets.length > 0 && total > pageSize ? (
                                    <div className="flex justify-center pt-5">
                                        <Pagination
                                            current={page}
                                            pageSize={pageSize}
                                            total={total}
                                            showSizeChanger
                                            pageSizeOptions={[10, 20, 50, 100]}
                                            onChange={(nextPage, nextPageSize) => {
                                                setPage(nextPage);
                                                setPageSize(nextPageSize);
                                            }}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </>
                    ) : null}
                </div>
            </main>

            <Modal title={editingAsset ? "编辑素材" : "新增素材"} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} confirmLoading={saving} okText="保存" cancelText="取消" destroyOnHidden>
                <div className="grid gap-3 pt-1 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label="类型">
                            <Select
                                options={[
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                    { label: "音频", value: "audio" },
                                ]}
                                onChange={(value) => {
                                    setFormKind(value);
                                    setMediaDraft(null);
                                }}
                            />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                            <Input size="large" placeholder="给素材起一个容易检索的名字" />
                        </Form.Item>
                        <Form.Item label="封面 URL">
                            <div
                                className={cn("rounded-md transition", isCoverDragActive && "ring-2 ring-cyan-300 ring-offset-2 ring-offset-white dark:ring-cyan-500 dark:ring-offset-stone-950")}
                                onDragEnter={handleCoverDragOver}
                                onDragOver={handleCoverDragOver}
                                onDragLeave={handleCoverDragLeave}
                                onDrop={handleCoverDrop}
                            >
                                <Space.Compact className="w-full">
                                    <Form.Item name="coverUrl" noStyle>
                                        <Input placeholder="可粘贴图片 URL，也可以上传本地封面" />
                                    </Form.Item>
                                    <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </Space.Compact>
                            </div>
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后回车" />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label="来源">
                                <Input placeholder="手动添加 / 画布 / 提示词库" />
                            </Form.Item>
                            <Form.Item name="note" label="备注">
                                <Input placeholder="可选" />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                                <Input.TextArea rows={8} placeholder="保存提示词、说明文案、参考描述等文本素材" />
                            </Form.Item>
                        ) : (
                            <Form.Item label={`${formKind === "image" ? "图片" : formKind === "video" ? "视频" : "音频"}内容`} required>
                                <div
                                    className={cn(
                                        "rounded-lg border border-dashed border-stone-300 p-4 transition dark:border-stone-700",
                                        isImageDragActive && "border-cyan-400 bg-cyan-50/60 ring-1 ring-cyan-200 dark:border-cyan-400 dark:bg-cyan-500/10 dark:ring-cyan-400/25",
                                    )}
                                    onDragEnter={handleImageDragOver}
                                    onDragOver={handleImageDragOver}
                                    onDragLeave={handleImageDragLeave}
                                    onDrop={handleImageDrop}
                                >
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        选择{formKind === "image" ? "图片" : formKind === "video" ? "视频" : "音频"}文件
                                    </Button>
                                    {mediaDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {"width" in mediaDraft ? `${mediaDraft.width}x${mediaDraft.height} · ` : ""}
                                            {formatBytes(mediaDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            未选择文件
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>预览</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || (mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : "") ? (
                                <img src={imagePreviewUrl(coverUrl || (mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : ""), 960)} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : formKind === "video" && mediaDraft && "url" in mediaDraft ? (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-900 text-white">
                                    <Film className="size-10" />
                                </div>
                            ) : formKind === "audio" && mediaDraft && "url" in mediaDraft ? (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 text-stone-500 dark:bg-stone-900">
                                    <FileAudio className="size-10" />
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "暂无封面"}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || "未命名素材"}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">未打标签</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept={formKind === "image" ? "image/*" : formKind === "video" ? "video/*" : "audio/*"}
                    className="hidden"
                    onChange={(event) => {
                        void readMediaFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <Modal title="删除素材" open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={() => void confirmDelete()} confirmLoading={deleting} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除「{deletingAsset?.title}」吗？删除后会从我的素材中移除。
            </Modal>
        </div>
    );
}

/* 三段内容共用的 tab 定义。URL 是唯一状态源：可分享、可返回、刷新不丢。
 * 顺序按用户习惯：公共词库 → 我的提示词 → 我的素材；裸 /assets 默认进公共词库。
 * 下划线 tab 已弃用 —— 那条横线既违和「不要线条」，窄屏又会被挤成等宽小字。 */
type LibraryTabKey = "assets" | "mine" | "public";

const LIBRARY_TABS: readonly LibraryTabItem[] = [
    { key: "public", label: "公共词库", href: "/assets?tab=public" },
    { key: "mine", label: "我的提示词", href: "/assets?tab=mine" },
    { key: "assets", label: "我的素材", href: "/assets?tab=assets" },
];
