"use client";

import { App, Button, Input, Switch, Tag, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
    MAX_VIDEO_TIERS,
    VIDEO_TIER_LABEL_MAX_LENGTH,
} from "@/lib/video-tier-config";
import { normalizeImageTiers, type ImageTierConfig } from "@/lib/image-tier-config";

type Props = {
    tiers: ImageTierConfig[] | undefined;
    onChange: (tiers: ImageTierConfig[]) => void;
};

export function AdminImageTierManager({ tiers, onChange }: Props) {
    const { message } = App.useApp();
    const list = useMemo(() => normalizeImageTiers(tiers), [tiers]);
    const idsKey = list.map((tier) => tier.id).join("|");
    const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

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

    const commit = (next: ImageTierConfig[]) => onChange(normalizeImageTiers(next));
    const patch = (id: string, part: Partial<ImageTierConfig>) => commit(list.map((tier) => (tier.id === id ? { ...tier, ...part } : tier)));

    const commitLabel = (tier: ImageTierConfig) => {
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
            message.warning(`最多 ${MAX_VIDEO_TIERS} 个图片档位`);
            return;
        }
        commit([
            ...list,
            {
                id: `image-tier-${Date.now().toString(36)}`,
                label: "新图片档位",
                order: (list.length + 1) * 10,
                enabled: true,
                free: false,
            },
        ]);
    };

    const remove = (id: string) => {
        if (list.length <= 1) {
            message.warning("至少保留一个图片档位");
            return;
        }
        commit(list.filter((tier) => tier.id !== id));
    };

    return (
        <div className="rounded-xl border border-border/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">图片一级档位</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                        控制画布图片模式的档位选择器。图片档位下直接列模型（不做二级展开），免费/常规/站长等分类由运营手工把模型挂到对应档位。
                    </div>
                </div>
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={add} disabled={list.length >= MAX_VIDEO_TIERS}>
                    新增档位
                </Button>
            </div>
            <div className="mt-3 space-y-2">
                {list.map((tier, index) => (
                    <div key={tier.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 px-2 py-2">
                        <Tag className="m-0" color="purple">
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
                        <Tooltip title={tier.free ? "该档位下的模型仅图片生成按 0 积分计费（频控/并发照常）" : "按正常积分单价计费"}>
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Switch size="small" checked={tier.free} onChange={(checked) => patch(tier.id, { free: checked })} />
                                免费
                            </label>
                        </Tooltip>
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
