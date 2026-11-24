"use client";

import { App, Button, Checkbox, Drawer, Empty, Input, InputNumber, Select, Space, Switch, Tag } from "antd";
import { AlertTriangle, ArrowDown, ArrowUp, GitBranch, Pencil, RefreshCw, Route, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { LabeledControl, SectionTitle } from "@/components/admin/admin-settings-controls";
import type { ImageGenerationOptions, LogicalModel, LogicalModelBinding, LogicalModelCapability, LogicalModelCapabilityProfile, SystemDefaultModels, SystemModelChannel } from "@/lib/auth/store";
import { capabilityLabel, isLogicalModelResolvable, normalizeDefaultModelsConfig, resolveLogicalModelConfig, synchronizeLogicalModelsWithChannels } from "@/lib/model-routing-config";
import { normalizeVideoTiers, type VideoTierConfig } from "@/lib/video-tier-config";
import { normalizeImageTiers, type ImageTierConfig } from "@/lib/image-tier-config";

type Props = {
    channels: SystemModelChannel[];
    logicalModels: LogicalModel[];
    defaultModels: SystemDefaultModels;
    videoTiers?: VideoTierConfig[];
    imageTiers?: ImageTierConfig[];
    onChange: (value: { logicalModels: LogicalModel[]; defaultModels: SystemDefaultModels }) => void;
};

const capabilityOptions: Array<{ label: string; value: LogicalModelCapability }> = [
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

const videoTierDefaultOptions = [
    { label: "官方原生", value: "official" },
    { label: "特价稳定", value: "stable" },
    { label: "低价福利", value: "value" },
];

const defaultFields: Array<{ capability: LogicalModelCapability; key: keyof SystemDefaultModels; label: string }> = [
    { capability: "text", key: "textModel", label: "默认文本模型" },
    { capability: "image", key: "imageModel", label: "默认图片模型" },
    { capability: "video", key: "videoModel", label: "默认视频模型" },
    { capability: "audio", key: "audioModel", label: "默认音频模型" },
];

export function AdminLogicalModelManager({ channels, logicalModels, defaultModels, videoTiers, imageTiers, onChange }: Props) {
    const { message, modal } = App.useApp();
    const tierCatalog = useMemo(() => {
        const entries = normalizeVideoTiers(videoTiers);
        const labels: Record<string, string> = {};
        for (const entry of entries) labels[entry.id] = entry.label;
        // 兼容旧模型：历史数据里 tier 仍可能是语义档位 official/stable/value。
        for (const legacy of videoTierDefaultOptions) {
            if (!labels[legacy.value]) labels[legacy.value] = legacy.label;
        }
        return {
            labels,
            options: [{ label: "未分组", value: "" }, ...entries.map((entry) => ({ label: entry.label, value: entry.id }))],
        };
    }, [videoTiers]);
    const videoTierOptions = tierCatalog.options;
    const videoTierLabels = tierCatalog.labels;
    const imageTierCatalog = useMemo(() => {
        const entries = normalizeImageTiers(imageTiers);
        const labels: Record<string, string> = {};
        for (const entry of entries) labels[entry.id] = entry.label;
        return { labels, options: [{ label: "未分组", value: "" }, ...entries.map((entry) => ({ label: entry.label, value: entry.id }))] };
    }, [imageTiers]);
    const tierLabelsAll = { ...imageTierCatalog.labels, ...videoTierLabels };
    const tierFilterOptions = [
        { label: "全部档位", value: "all" },
        { label: "未分档", value: "none" },
        ...Array.from(new Set([...imageTierCatalog.options.slice(1), ...videoTierOptions.slice(1)].map((option) => option.value))).map((value) => ({
            value,
            label: tierLabelsAll[value] || value,
        })),
    ];
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingId, setEditingId] = useState("");
    const [draft, setDraft] = useState<LogicalModel | null>(null);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [query, setQuery] = useState("");
    const [capabilityFilter, setCapabilityFilter] = useState<LogicalModelCapability | "all">("all");
    const [tierFilter, setTierFilter] = useState<string>("all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const groupOptions = useMemo(
        () => Array.from(new Set(logicalModels.map((model) => model.group?.trim()).filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right)),
        [logicalModels],
    );
    const visibleModels = useMemo(
        () =>
            logicalModels.filter(
                (model) =>
                    (capabilityFilter === "all" || model.capability === capabilityFilter) &&
                    (tierFilter === "all" || (tierFilter === "none" ? !model.tier : model.tier === tierFilter)) &&
                    (groupFilter === "all" || (groupFilter === "__none__" ? !model.group?.trim() : model.group?.trim() === groupFilter)) &&
                    (statusFilter === "all" || (statusFilter === "enabled" ? model.enabled : !model.enabled)) &&
                    (!deferredQuery || `${model.id} ${model.name} ${model.group || ""} ${model.bindings.map((binding) => binding.upstreamModel).join(" ")}`.toLowerCase().includes(deferredQuery)),
            ),
        [capabilityFilter, deferredQuery, groupFilter, logicalModels, statusFilter, tierFilter],
    );
    const availableDefaultFields = defaultFields.filter(({ capability }) => logicalModels.some((model) => model.capability === capability && isLogicalModelResolvable(logicalModels, channels, capability, model.id)));
    const availableCapabilityOptions = capabilityOptions.filter(({ value }) => availableDefaultFields.some(({ capability }) => capability === value));
    const readyCount = availableDefaultFields.filter(({ capability, key }) => isLogicalModelResolvable(logicalModels, channels, capability, defaultModels[key])).length;

    const openEdit = (model: LogicalModel) => {
        setEditingId(model.id);
        setDraft(cloneLogicalModel(model));
        setDrawerOpen(true);
    };

    const deleteCurrentGroup = () => {
        const group = draft?.group?.trim();
        if (!group) return;
        const affected = logicalModels.filter((model) => model.group?.trim() === group);
        modal.confirm({
            title: `删除二级分组「${group}」？`,
            content: `将从 ${affected.length} 个模型中清除该分组，不删除模型、绑定和价格。`,
            okText: "删除分组",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                const nextModels = logicalModels.map((model) => (model.group?.trim() === group ? { ...model, group: undefined, groupOrder: undefined } : model));
                onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
                setDraft((current) => (current ? { ...current, group: "", groupOrder: undefined } : current));
                setCreatingGroup(false);
                message.success(`已删除分组「${group}」，请保存模型渠道配置`);
            },
        });
    };

    const saveDraft = () => {
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) {
            message.error("请填写前端展示昵称");
            return;
        }
        const nextModels = logicalModels.map((model) => (model.id === editingId ? cloneLogicalModel({ ...draft, name, group: draft.group?.trim() || undefined, groupOrder: typeof draft.groupOrder === "number" ? Math.trunc(draft.groupOrder) : undefined, userNote: draft.userNote?.trim() || undefined }) : model));
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        setDrawerOpen(false);
        message.success("模型路由设置已更新，请保存渠道配置");
    };

    const syncChannelModels = () => {
        const nextModels = synchronizeLogicalModelsWithChannels(logicalModels, channels);
        if (JSON.stringify(nextModels) === JSON.stringify(logicalModels)) {
            message.info("逻辑模型已与渠道目录同步");
            return;
        }
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        message.success(`已按上游模型名同步 ${nextModels.length} 个逻辑模型`);
    };

    const updateDefault = (key: keyof SystemDefaultModels, modelId: string) => onChange({ logicalModels, defaultModels: { ...defaultModels, [key]: modelId } });

    const moveModel = (model: LogicalModel, direction: -1 | 1) => {
        const group = logicalModels.filter((item) => item.capability === model.capability);
        const groupIndex = group.findIndex((item) => item.id === model.id);
        const neighbor = group[groupIndex + direction];
        if (groupIndex < 0 || !neighbor) return;
        const nextModels = [...logicalModels];
        const currentIndex = nextModels.findIndex((item) => item.id === model.id);
        const neighborIndex = nextModels.findIndex((item) => item.id === neighbor.id);
        if (currentIndex < 0 || neighborIndex < 0) return;
        [nextModels[currentIndex], nextModels[neighborIndex]] = [nextModels[neighborIndex], nextModels[currentIndex]];
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        message.success("模型顺序已更新，请保存设置");
    };

    return (
        <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <SectionTitle icon={<Route className="size-4" />} title="逻辑模型路由" />
                        <Tag color={availableDefaultFields.length && readyCount === availableDefaultFields.length ? "green" : "orange"} className="m-0">
                            默认能力 {readyCount}/{availableDefaultFields.length} 可用
                        </Tag>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">逻辑模型由渠道模型目录自动生成；同名上游模型跨渠道合并，前端昵称可独立设置。使用 ↑ ↓ 调整同一能力模型的前端展示顺序，保存后生效。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={syncChannelModels}>
                    重新同步
                </Button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0">
                    <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_132px_132px_132px_120px]">
                        <Input allowClear value={query} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索昵称、ID、分组或上游模型" onChange={(event) => setQuery(event.target.value)} />
                        <Select value={capabilityFilter} options={[{ label: "全部能力", value: "all" }, ...availableCapabilityOptions]} onChange={(value) => setCapabilityFilter(value)} />
                        <Select
                            value={tierFilter}
                            options={tierFilterOptions}
                            onChange={(value) => setTierFilter(value)}
                        />
                        <Select
                            value={groupFilter}
                            options={[{ label: "全部分组", value: "all" }, { label: "未分组", value: "__none__" }, ...groupOptions.map((group) => ({ label: group, value: group }))]}
                            onChange={(value) => setGroupFilter(value)}
                        />
                        <Select
                            value={statusFilter}
                            options={[{ label: "全部状态", value: "all" }, { label: "启用", value: "enabled" }, { label: "停用", value: "disabled" }]}
                            onChange={(value) => setStatusFilter(value)}
                        />
                    </div>
                    <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                        {visibleModels.map((model) => {
                            const resolved = resolveLogicalModelConfig(logicalModels, channels, model.capability, model.id);
                            const isDefault = Object.values(defaultModels).some((value) => value.toLowerCase() === model.id.toLowerCase());
                            const capabilityGroup = logicalModels.filter((item) => item.capability === model.capability);
                            const capabilityIndex = capabilityGroup.findIndex((item) => item.id === model.id);
                            return (
                                <div key={model.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-950">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{model.name}</span>
                                            <Tag className="m-0">{capabilityLabel(model.capability)}</Tag>
                                            {model.tier ? <Tag color={model.tier === "official" ? "blue" : model.tier === "stable" ? "green" : "orange"} className="m-0">{tierLabelsAll[model.tier] || model.tier}</Tag> : null}
                                            {model.group ? <Tag color="purple" className="m-0">分组：{model.group}{typeof model.groupOrder === "number" ? ` · ${model.groupOrder}` : ""}</Tag> : null}
                                            <Tag color={model.enabled ? "green" : "default"} className="m-0">
                                                {model.enabled ? "启用" : "停用"}
                                            </Tag>
                                            {isDefault ? (
                                                <Tag color="blue" className="m-0">
                                                    默认
                                                </Tag>
                                            ) : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                            <span>ID：{model.id}</span>
                                            <span>{model.bindings.length} 个同名渠道绑定</span>
                                            <span className={resolved ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{resolved ? `${resolved.channel.name} / ${resolved.binding.upstreamModel}` : "当前无可用渠道"}</span>
                                        </div>
                                    </div>
                                    <Space className="shrink-0" size={2}>
                                        <Button type="text" size="small" title="上移" aria-label={`上移 ${model.name}`} disabled={capabilityIndex <= 0} icon={<ArrowUp className="size-3.5" />} onClick={() => moveModel(model, -1)} />
                                        <Button type="text" size="small" title="下移" aria-label={`下移 ${model.name}`} disabled={capabilityIndex < 0 || capabilityIndex >= capabilityGroup.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => moveModel(model, 1)} />
                                        <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(model)}>
                                            路由设置
                                        </Button>
                                    </Space>
                                </div>
                            );
                        })}
                        {!visibleModels.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={logicalModels.length ? "没有匹配的逻辑模型" : "渠道尚未同步到模型目录"} /> : null}
                    </div>
                </div>

                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                    <SectionTitle icon={<GitBranch className="size-4" />} title="默认模型" />
                    <div className="mt-4 space-y-4">
                        {availableDefaultFields.map(({ capability, key, label }) => {
                            const options = logicalModels.filter((model) => model.capability === capability && isLogicalModelResolvable(logicalModels, channels, capability, model.id)).map((model) => ({ label: model.name, value: model.id }));
                            const selected = logicalModels.find((model) => model.id === defaultModels[key]);
                            const resolved = selected ? resolveLogicalModelConfig(logicalModels, channels, capability, selected.id) : null;
                            return (
                                <LabeledControl key={key} label={label}>
                                    <Select
                                        className="w-full"
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        value={defaultModels[key] || undefined}
                                        placeholder={`选择可用${capabilityLabel(capability)}模型`}
                                        options={options}
                                        status={defaultModels[key] && !resolved ? "error" : undefined}
                                        onChange={(value) => updateDefault(key, value || "")}
                                    />
                                    <div className={`mt-1 flex items-center gap-1 text-xs ${resolved ? "text-stone-500 dark:text-stone-400" : "text-amber-600 dark:text-amber-400"}`}>
                                        {!resolved ? <AlertTriangle className="size-3.5 shrink-0" /> : null}
                                        <span>{resolved ? `实际路由：${resolved.channel.name} / ${resolved.binding.upstreamModel}` : defaultModels[key] ? "当前默认模型不可解析" : "尚未设置默认模型"}</span>
                                    </div>
                                </LabeledControl>
                            );
                        })}
                    </div>
                </div>
            </div>

            <Drawer
                title="模型路由设置"
                size={760}
                styles={{ wrapper: { maxWidth: "100vw" } }}
                open={drawerOpen}
                destroyOnHidden
                onClose={() => setDrawerOpen(false)}
                extra={
                    <Space>
                        <Button onClick={() => setDrawerOpen(false)}>取消</Button>
                        <Button type="primary" disabled={!draft?.name.trim()} onClick={saveDraft}>
                            应用修改
                        </Button>
                    </Space>
                }
            >
                {draft ? (
                    <>
                        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
                            <div className="truncate text-xs text-stone-500 dark:text-stone-400">逻辑 ID：{draft.id}（由上游模型自动建立）</div>
                            <div className="mt-2 grid gap-3 sm:max-w-[456px] sm:grid-cols-[192px_144px_96px]">
                                <LabeledControl label="前端昵称">
                                    <Input
                                        className="!w-full"
                                        aria-label="前端展示昵称"
                                        maxLength={120}
                                        value={draft.name}
                                        placeholder={draft.bindings[0]?.upstreamModel || draft.id}
                                        onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                                    />
                                </LabeledControl>
                                <LabeledControl label="能力类型">
                                    <Select className="w-full" value={draft.capability} options={capabilityOptions} onChange={(capability) => setDraft((current) => (current ? { ...current, capability } : current))} />
                                </LabeledControl>
                                <LabeledControl label="模型状态">
                                    <div className="flex h-8 items-center">
                                        <Switch checkedChildren="启用" unCheckedChildren="停用" checked={draft.enabled} onChange={(enabled) => setDraft((current) => (current ? { ...current, enabled } : current))} />
                                    </div>
                                </LabeledControl>
                            </div>
                            <div className="mt-3 grid gap-3 sm:max-w-[456px] sm:grid-cols-[minmax(0,1fr)_144px]">
                                <LabeledControl label="二级分组">
                                    <Select
                                        className="w-full"
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        aria-label="二级分组"
                                        value={creatingGroup ? "__new__" : draft.group || undefined}
                                        placeholder="选择已有分组"
                                        options={[
                                            ...groupOptions.map((group) => ({ label: group, value: group })),
                                            ...(draft.group && !groupOptions.includes(draft.group) && !creatingGroup ? [{ label: draft.group, value: draft.group }] : []),
                                            ...(draft.group && !creatingGroup ? [{ label: "🗑 删除当前分组", value: "__delete__" }] : []),
                                            { label: "＋ 新建二级分组", value: "__new__" },
                                        ]}
                                        onChange={(value) => {
                                            if (value === "__delete__") {
                                                deleteCurrentGroup();
                                                return;
                                            }
                                            if (value === "__new__") {
                                                setCreatingGroup(true);
                                                setDraft((current) => (current ? { ...current, group: "" } : current));
                                                return;
                                            }
                                            setCreatingGroup(false);
                                            setDraft((current) => (current ? { ...current, group: value || "" } : current));
                                        }}
                                    />
                                    {creatingGroup ? <Input className="mt-2 !w-full" aria-label="新二级分组名称" maxLength={120} value={draft.group || ""} placeholder="输入新分组名称，例如 Seedance 2.5" autoFocus onChange={(event) => setDraft((current) => (current ? { ...current, group: event.target.value } : current))} /> : null}
                                </LabeledControl>
                                <LabeledControl label="分组排序">
                                    <InputNumber
                                        className="!w-full"
                                        aria-label="分组排序"
                                        min={0}
                                        max={9999}
                                        value={draft.groupOrder}
                                        placeholder="越小越靠前"
                                        onChange={(value) => setDraft((current) => (current ? { ...current, groupOrder: typeof value === "number" ? value : undefined } : current))}
                                    />
                                </LabeledControl>
                            </div>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">二级分组用于把不同上游渠道的模型收进同一类；不填则回退到系统按模型名自动归类。</p>
                            <div className="mt-3 max-w-[456px]">
                                <LabeledControl label="模型用户备注（A 兜底）">
                                    <Input.TextArea
                                        aria-label="模型用户备注"
                                        rows={2}
                                        maxLength={1000}
                                        value={draft.userNote || ""}
                                        placeholder="用户悬浮模型时显示；具体渠道备注优先"
                                        onChange={(event) => setDraft((current) => (current ? { ...current, userNote: event.target.value } : current))}
                                    />
                                </LabeledControl>
                            </div>
                            {draft.capability === "video" || draft.capability === "image" ? (
                                <div className="mt-3 max-w-[220px]">
                                    <LabeledControl label="模型档位">
                                        <Select
                                            className="w-full"
                                            value={draft.tier || ""}
                                            options={draft.capability === "image" ? imageTierCatalog.options : videoTierOptions}
                                            onChange={(tier) => setDraft((current) => (current ? { ...current, tier: tier ? (tier as string) : undefined } : current))}
                                        />
                                    </LabeledControl>
                                </div>
                            ) : null}
                        </div>
                        <div className="mt-5">
                            <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-100">同名渠道绑定</h3>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">渠道与上游模型由目录自动同步；这里调整路由优先级、启停和能力档案。</p>
                            <div className="mt-3 space-y-3">
                                {draft.bindings.map((binding) => (
                                    <BindingEditor
                                        key={binding.id}
                                        binding={binding}
                                        capability={draft.capability}
                                        channels={channels}
                                        onChange={(patch) => setDraft((current) => (current ? { ...current, bindings: current.bindings.map((item) => (item.id === binding.id ? { ...item, ...patch } : item)) } : current))}
                                    />
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
            </Drawer>
        </section>
    );
}

function BindingEditor({ binding, capability, channels, onChange }: { binding: LogicalModelBinding; capability: LogicalModelCapability; channels: SystemModelChannel[]; onChange: (patch: Partial<LogicalModelBinding>) => void }) {
    const channel = channels.find((item) => item.id === binding.channelId);
    const profile = binding.capabilityProfile || {};
    const effectiveAsync = profile.supportsAsync ?? (capability === "image" || capability === "video");
    const timeoutSeconds = profile.timeoutMs ? Math.round(profile.timeoutMs / 1000) : undefined;
    const defaultTimeoutSeconds = capability === "image" ? 600 : capability === "text" ? 180 : 1800;
    const updateProfile = (patch: Partial<LogicalModelCapabilityProfile>) => onChange({ capabilityProfile: { ...profile, ...patch } });
    const updateList = (value: string) =>
        updateProfile({
            aspectRatios: value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        });
    const updateResolutions = (value: string) =>
        updateProfile({
            resolutions: value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        });
    const updateDurations = (value: string) =>
        updateProfile({
            durationSeconds: value
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isSafeInteger(item) && item > 0),
        });
    const updateImageOptions = (key: keyof ImageGenerationOptions, value: string) => {
        const values = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        const imageOptions = { ...profile.imageOptions, [key]: values } as ImageGenerationOptions;
        if (key === "resolutions") updateProfile({ resolutions: values, imageOptions });
        else updateProfile({ imageOptions });
    };
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_90px_90px_auto] sm:items-end">
                <LabeledControl label="渠道">
                    <div className="flex h-8 items-center truncate rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">{channel?.name || "渠道已移除"}</div>
                </LabeledControl>
                <LabeledControl label="上游模型">
                    <div className="flex h-8 items-center truncate rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">{binding.upstreamModel}</div>
                </LabeledControl>
                <LabeledControl label="优先级">
                    <InputNumber className="w-full" min={1} max={10000} precision={0} value={binding.priority} onChange={(priority) => onChange({ priority: Number(priority) || 1 })} />
                </LabeledControl>
                <LabeledControl label="权重">
                    <InputNumber className="w-full" min={1} max={10000} precision={0} value={binding.weight || 100} onChange={(weight) => onChange({ weight: Number(weight) || 100 })} />
                </LabeledControl>
                <div className="flex h-8 items-center">
                    <Switch size="small" checked={binding.enabled} aria-label={`${channel?.name || "渠道"}绑定启用状态`} onChange={(enabled) => onChange({ enabled })} />
                </div>
            </div>
            <div className="mt-3 rounded-md border border-stone-200/80 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-xs font-semibold text-stone-700 dark:text-stone-200">能力档案</div>
                        <div className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">控制参考素材、任务能力和资源限制。</div>
                    </div>
                    <Tag className="m-0">{capabilityLabel(capability)}</Tag>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="sm:col-span-2 lg:col-span-4">
                        <LabeledControl label="后台显示名称">
                            <Input aria-label="后台显示名称" value={profile.adminName || ""} maxLength={120} onChange={(event) => updateProfile({ adminName: event.target.value })} />
                        </LabeledControl>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-4">
                        <Checkbox checked={profile.supportsReferenceImage === true} onChange={(event) => updateProfile({ supportsReferenceImage: event.target.checked })}>
                            参考图片
                        </Checkbox>
                        <Checkbox checked={profile.supportsReferenceVideo === true} onChange={(event) => updateProfile({ supportsReferenceVideo: event.target.checked })}>
                            参考视频
                        </Checkbox>
                        <Checkbox checked={profile.supportsReferenceAudio === true} onChange={(event) => updateProfile({ supportsReferenceAudio: event.target.checked })}>
                            参考音频
                        </Checkbox>
                        <Checkbox checked={effectiveAsync} onChange={(event) => updateProfile({ supportsAsync: event.target.checked })}>
                            异步查询
                        </Checkbox>
                        <Checkbox checked={profile.supportsCancel === true} onChange={(event) => updateProfile({ supportsCancel: event.target.checked })}>
                            上游取消
                        </Checkbox>
                        <Checkbox checked={profile.supportsWebhook === true} onChange={(event) => updateProfile({ supportsWebhook: event.target.checked })}>
                            Webhook
                        </Checkbox>
                    </div>
                    <LabeledControl label="最大参考图数量">
                        <InputNumber className="w-full" min={0} max={16} precision={0} value={profile.maxReferenceImages} onChange={(value) => updateProfile({ maxReferenceImages: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="最大批量数量">
                        <InputNumber className="w-full" min={1} max={100} precision={0} value={profile.maxBatchSize} onChange={(value) => updateProfile({ maxBatchSize: Number(value) || 1 })} />
                    </LabeledControl>
                    <LabeledControl label="最短时长（秒）">
                        <InputNumber className="w-full" min={0} max={3600} precision={0} value={profile.minDurationSeconds} onChange={(value) => updateProfile({ minDurationSeconds: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="最长时长（秒）">
                        <InputNumber className="w-full" min={0} max={3600} precision={0} value={profile.maxDurationSeconds} onChange={(value) => updateProfile({ maxDurationSeconds: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="支持比例（逗号分隔）">
                        <Input value={profile.aspectRatios?.join(", ") || ""} placeholder="1:1, 16:9, 9:16" onChange={(event) => updateList(event.target.value)} />
                    </LabeledControl>
                    <LabeledControl label="支持画质/清晰度">
                        <Input value={profile.resolutions?.join(", ") || ""} placeholder={capability === "image" ? "high, 1K, 2K, 4K" : "480, 720, 1080"} onChange={(event) => updateResolutions(event.target.value)} />
                    </LabeledControl>
                    {capability === "image" ? (
                        <>
                            <div className="sm:col-span-2 lg:col-span-4">
                                <div className="text-xs font-semibold text-stone-700 dark:text-stone-200">图片请求参数</div>
                                <div className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">按当前上游 binding 声明可用值；留空表示不在前端提供该选项。</div>
                            </div>
                            <LabeledControl label="尺寸模式">
                                <Input value={profile.imageOptions?.sizeModes?.join(", ") || ""} placeholder="auto, ratio, custom" onChange={(event) => updateImageOptions("sizeModes", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="图片分辨率">
                                <Input value={profile.imageOptions?.resolutions?.join(", ") || ""} placeholder="1K, 2K, 4K" onChange={(event) => updateImageOptions("resolutions", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="生成画质">
                                <Input value={profile.imageOptions?.qualities?.join(", ") || ""} placeholder="auto, low, medium, high, xhigh, max" onChange={(event) => updateImageOptions("qualities", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="风格">
                                <Input value={profile.imageOptions?.styles?.join(", ") || ""} placeholder="vivid, natural" onChange={(event) => updateImageOptions("styles", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="输出格式">
                                <Input value={profile.imageOptions?.outputFormats?.join(", ") || ""} placeholder="png, jpeg, webp" onChange={(event) => updateImageOptions("outputFormats", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="背景">
                                <Input value={profile.imageOptions?.backgrounds?.join(", ") || ""} placeholder="auto, opaque, transparent" onChange={(event) => updateImageOptions("backgrounds", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="内容审核">
                                <Input value={profile.imageOptions?.moderations?.join(", ") || ""} placeholder="auto, low" onChange={(event) => updateImageOptions("moderations", event.target.value)} />
                            </LabeledControl>
                            <LabeledControl label="响应格式">
                                <Input value={profile.imageOptions?.responseFormats?.join(", ") || ""} placeholder="url, b64_json" onChange={(event) => updateImageOptions("responseFormats", event.target.value)} />
                            </LabeledControl>
                        </>
                    ) : null}
                    <LabeledControl label="支持时长（秒）">
                        <Input value={profile.durationSeconds?.join(", ") || ""} placeholder="5, 8, 10" disabled={capability !== "video"} onChange={(event) => updateDurations(event.target.value)} />
                    </LabeledControl>
                    <LabeledControl label="请求超时（秒）">
                        <InputNumber
                            className="w-full"
                            min={5}
                            max={1800}
                            precision={0}
                            value={timeoutSeconds}
                            placeholder={`默认 ${defaultTimeoutSeconds} 秒`}
                            onChange={(value) => updateProfile({ timeoutMs: value ? Number(value) * 1000 : undefined })}
                        />
                    </LabeledControl>
                    <LabeledControl label="并发上限">
                        <InputNumber className="w-full" min={1} max={1000} precision={0} value={profile.concurrencyLimit} onChange={(value) => updateProfile({ concurrencyLimit: Number(value) || 1 })} />
                    </LabeledControl>
                    <LabeledControl label="单次成本">
                        <InputNumber className="w-full" min={0} precision={4} value={profile.unitCost} onChange={(value) => updateProfile({ unitCost: Number(value) || 0 })} />
                    </LabeledControl>
                    {capability === "video" && (
                        <>
                            <LabeledControl label="视频积分计费">
                                <Select
                                    className="w-full"
                                    value={profile.videoBilling?.mode || "legacy"}
                                    options={[
                                        { value: "legacy", label: "全局时长倍率" },
                                        { value: "fixed", label: "固定按次" },
                                        { value: "duration", label: "按时长比例" },
                                    ]}
                                    onChange={(mode) => updateProfile({ videoBilling: mode === "legacy" ? undefined : mode === "fixed" ? { mode: "fixed" } : { mode: "duration", baseSeconds: profile.videoBilling?.baseSeconds || 10 } })}
                                />
                            </LabeledControl>
                            {profile.videoBilling?.mode === "duration" && (
                                <LabeledControl label="参考视频计费">
                                    <Select value={profile.videoBilling.referenceVideoSeconds === true} options={[{ value: false, label: "仅输出时长" }, { value: true, label: "输出＋参考时长（逐段向上取整，重复计费）" }]} onChange={(value) => updateProfile({ videoBilling: { ...profile.videoBilling, mode: "duration", referenceVideoSeconds: value } })} />
                                </LabeledControl>
                            )}
                            {profile.videoBilling?.mode === "duration" && (
                                <LabeledControl label="基础积分对应秒数">
                                    <InputNumber className="w-full" min={1} value={profile.videoBilling.baseSeconds} onChange={(value) => updateProfile({ videoBilling: { ...profile.videoBilling, mode: "duration", baseSeconds: Number(value) || 1 } })} />
                                </LabeledControl>
                            )}
                        </>
                    )}
                    <LabeledControl label="成本货币">
                        <Input value={profile.unitCostCurrency || ""} maxLength={12} placeholder="USD / CNY" onChange={(event) => updateProfile({ unitCostCurrency: event.target.value.trim().toUpperCase() })} />
                    </LabeledControl>
                    <div className="sm:col-span-2 lg:col-span-4">
                        <LabeledControl label="用户可见备注（B 优先）">
                            <Input.TextArea aria-label="用户可见备注" rows={2} maxLength={1000} value={profile.userNote || ""} placeholder="用户悬浮该上游模型时显示；留空则回退到逻辑模型备注" onChange={(event) => updateProfile({ userNote: event.target.value })} />
                        </LabeledControl>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                        <LabeledControl label="管理员备注">
                            <Input.TextArea aria-label="管理员备注" rows={3} maxLength={4000} value={profile.adminNote || ""} onChange={(event) => updateProfile({ adminNote: event.target.value })} />
                        </LabeledControl>
                    </div>
                </div>
            </div>
        </div>
    );
}

function cloneLogicalModel(model: LogicalModel): LogicalModel {
    return { ...model, bindings: model.bindings.map((binding) => ({ ...binding, capabilityProfile: binding.capabilityProfile ? { ...binding.capabilityProfile } : undefined })) };
}
