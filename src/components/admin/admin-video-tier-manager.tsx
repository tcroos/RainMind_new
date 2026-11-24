"use client";

import { App, Button, Input, Select, Switch, Tag, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
    MAX_VIDEO_TIERS,
    normalizeVideoTiers,
    VIDEO_TIER_LABEL_MAX_LENGTH,
    type VideoTierConfig,
    type VideoTierModelTier,
} from "@/lib/video-tier-config";

type Props = {
    tiers: VideoTierConfig[] | undefined;
    onChange: (tiers: VideoTierConfig[]) => void;
};

const modelTierOptions: Array<{ label: string; value: VideoTierModelTier }> = [
    { label: "官方原生", value: "official" },
    { label: "特价稳定", value: "stable" },
    { label: "低价福利", value: "value" },
];

const displayOptions = [
    { label: "扁平直出", value: "flat" },
    { label: "二级展开", value: "grouped" },
];

const billingOptions = [
    { label: "不限计费", value: "" },
    { label: "按次", value: "fixed" },
    { label: "按秒", value: "duration" },
];

export function AdminVideoTierManager({ tiers, onChange }: Props) {
    const { message } = App.useApp();
    const list = useMemo(() => normalizeVideoTiers(tiers), [tiers]);
    const idsKey = list.map((tier) => tier.id).join("|");
    const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

    // 输入框用本地草稿，避免每次按键都触发归一化（空值曾被归一化丢弃，导致“删字删档位”）。
    useEffect(() => {
        setLabelDrafts((current) => {
            const next: Record<string, string> = {};
            for (const tier of list) {
                if (current[tier.id] !== undefined) next[tier.id] = current[tier.id];
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    const commit = (next: VideoTierConfig[]) => onChange(normalizeVideoTiers(next));
    const patch = (id: string, part: Partial<VideoTierConfig>) => commit(list.map((tier) => (tier.id === id ? { ...tier, ...part } : tier)));

    const commitLabel = (tier: VideoTierConfig) => {
        const draft = labelDrafts[tier.id];
        if (draft === undefined) return;
        const value = draft.trim();
        patch(tier.id, { label: value || tier.label });
        setLabelDrafts((current) => {
            const next = { ...current };
            delete next[tier.id];
            return next;
        });
    };

    const move = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= list.length) return;
        const next = list.map((tier) => ({ ...tier }));
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        commit(next.map((tier, position) => ({ ...tier, order: (position + 1) * 10 })));
    };

    const add = () => {
        if (list.length >= MAX_VIDEO_TIERS) {
            message.warning(`最多 ${MAX_VIDEO_TIERS} 个一级档位`);
            return;
        }
        commit([
            ...list,
            {
                id: `tier-${Date.now().toString(36)}`,
                label: "新档位",
                modelTier: "value",
                display: "grouped",
                order: (list.length + 1) * 10,
                enabled: true,
            },
        ]);
    };

    const remove = (id: string) => {
        if (list.length <= 1) {
            message.warning("至少保留一个一级档位");
            return;
        }
        commit(list.filter((tier) => tier.id !== id));
    };

    return (
        <div className="rounded-xl border border-border/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">视频一级档位</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                        控制前端档位选择器的条目与展示方式；模型身上的档位标记仍是官方原生/特价稳定/低价福利，不受此处改名影响。按计费拆分只对「低价福利」生效。
                    </div>
                </div>
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={add} disabled={list.length >= MAX_VIDEO_TIERS}>
                    新增档位
                </Button>
            </div>
            <div className="mt-3 space-y-2">
                {list.map((tier, index) => (
                    <div key={tier.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 px-2 py-2">
                        <Tag className="m-0" color={tier.modelTier === "official" ? "blue" : tier.modelTier === "stable" ? "green" : "orange"}>
                            {tier.id}
                        </Tag>
                        <Input
                            size="small"
                            className="!w-40"
                            value={labelDrafts[tier.id] ?? tier.label}
                            maxLength={VIDEO_TIER_LABEL_MAX_LENGTH}
                            onChange={(event) => setLabelDrafts((current) => ({ ...current, [tier.id]: event.target.value }))}
                            onBlur={() => commitLabel(tier)}
                            onPressEnter={() => commitLabel(tier)}
                        />
                        <Select
                            size="small"
                            className="!w-28"
                            value={tier.modelTier}
                            options={modelTierOptions}
                            onChange={(value) => patch(tier.id, { modelTier: value as VideoTierModelTier })}
                        />
                        <Select
                            size="small"
                            className="!w-28"
                            value={tier.display}
                            options={displayOptions}
                            onChange={(value) => patch(tier.id, { display: value === "grouped" ? "grouped" : "flat" })}
                        />
                        <Select
                            size="small"
                            className="!w-28"
                            value={tier.billingMode || ""}
                            options={billingOptions}
                            disabled={tier.modelTier !== "value"}
                            onChange={(value) => patch(tier.id, { billingMode: value === "fixed" || value === "duration" ? value : undefined })}
                        />
                        <Tooltip title={tier.enabled ? "已启用" : "已停用"}>
                            <Switch size="small" checked={tier.enabled} onChange={(checked) => patch(tier.id, { enabled: checked })} />
                        </Tooltip>
                        <div className="ml-auto flex items-center gap-1">
                            <Button size="small" type="text" icon={<ArrowUp className="size-3.5" />} disabled={index === 0} onClick={() => move(index, -1)} />
                            <Button size="small" type="text" icon={<ArrowDown className="size-3.5" />} disabled={index === list.length - 1} onClick={() => move(index, 1)} />
                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(tier.id)} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
