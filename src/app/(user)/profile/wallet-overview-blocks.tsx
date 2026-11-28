"use client";

import { App, Button, Input, Skeleton } from "antd";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Gift, TicketPercent } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CreditSymbol, formatCreditAmount, requestCreditCost } from "@/constant/credits";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { listPointRecords } from "@/services/api/points";
import { claimBillingCoupon, type BillingProduct, type CouponTemplate, type UserCoupon } from "@/services/api/billing";

import { profilePrimaryButtonClass } from "./profile-elements";

/*
 * 钱包概览的内嵌区块：
 * - WalletPurchaseSection：套餐与积分包合成的购买区（按月订阅 / 按量充值切换，共用支付栏）
 * - WalletCouponCard / WalletReferralCard：优惠券、邀请做成右侧小窗
 */

function formatYuan(amountCents: number) {
    const yuan = amountCents / 100;
    return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

function salePrice(product: BillingProduct) {
    return product.pricing?.saleUnitAmountCents ?? product.amountCents;
}

function productBadge(product: BillingProduct) {
    const metadata = product.metadata && typeof product.metadata === "object" ? (product.metadata as Record<string, unknown>) : {};
    return typeof metadata.badge === "string" ? metadata.badge : "";
}

export type PurchaseMode = "plan" | "points";

/** 数字补间：余额进场滚动、支付按钮金额跟着档位滚动 */
export function AnimatedNumber({ value, format = (n: number) => formatCreditAmount(n), duration = 600 }: { value: number; format?: (value: number) => string; duration?: number }) {
    const [shown, setShown] = useState(0);
    const fromRef = useRef(0);
    useEffect(() => {
        const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        const from = fromRef.current;
        if (reduce || from === value) {
            fromRef.current = value;
            setShown(value);
            return;
        }
        let frame = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setShown(from + (value - from) * eased);
            if (t < 1) frame = requestAnimationFrame(tick);
            else fromRef.current = value;
        };
        frame = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(frame);
            fromRef.current = value;
        };
    }, [duration, value]);
    return <span className="tabular-nums">{format(shown)}</span>;
}

function isRecommended(product: BillingProduct) {
    const metadata = product.metadata && typeof product.metadata === "object" ? (product.metadata as Record<string, unknown>) : {};
    return metadata.recommended === true || productBadge(product) === "最受欢迎";
}

function bonusText(product: BillingProduct) {
    const badge = productBadge(product);
    if (badge.startsWith("多送")) return badge;
    const match = /多赠\s*\d+%/.exec(product.description || "");
    return match ? match[0].replace("多赠", "多送") : "";
}

/**
 * 购买区：套餐与积分包合成一张卡，顶部「按月订阅 / 按量充值」切换，
 * 底部始终是同一条支付栏，视线不用上下跳。
 * 档位层级：价格是主角（大字），积分第二层，赠送比例绿色小字；只有推荐档带一个角标并略微抬高。
 */
export function WalletPurchaseSection({
    products,
    loading,
    mode,
    onModeChange,
    modes = ["plan", "points"],
    hasActivePlan = false,
    activePlanId,
    onCheckout,
    flat = false,
}: {
    products: BillingProduct[];
    loading: boolean;
    mode: PurchaseMode;
    onModeChange?: (mode: PurchaseMode) => void;
    modes?: PurchaseMode[];
    hasActivePlan?: boolean;
    activePlanId?: string;
    onCheckout: (product: BillingProduct) => void;
    /** 嵌在弹窗里时不要外框 */
    flat?: boolean;
}) {
    const plans = useMemo(() => products.filter((product) => product.productKind === "plan").sort((a, b) => salePrice(a) - salePrice(b)), [products]);
    const packs = useMemo(() => products.filter((product) => product.productKind === "points").sort((a, b) => salePrice(a) - salePrice(b)), [products]);
    const available = modes.filter((item) => (item === "plan" ? plans.length : packs.length) > 0);
    const activeMode: PurchaseMode = available.includes(mode) ? mode : available[0] || mode;
    const list = activeMode === "plan" ? plans : packs;
    const fallbackId = (activeMode === "plan" && activePlanId ? list.find((item) => item.planId === activePlanId)?.id : undefined) || list.find(isRecommended)?.id || list[Math.min(1, list.length - 1)]?.id;
    const [picked, setPicked] = useState<Record<PurchaseMode, string | undefined>>({ plan: undefined, points: undefined });
    const selected = list.find((item) => item.id === (picked[activeMode] || fallbackId));
    const costs = useCreditEquivalents();
    const cheaperPlan = activeMode === "points" && selected && !hasActivePlan && modes.includes("plan") ? plans.filter((plan) => salePrice(plan) <= salePrice(selected) && plan.pointsAmount >= selected.pointsAmount * 0.5)[0] : undefined;
    const isCurrentPlan = activeMode === "plan" && selected?.planId && selected.planId === activePlanId;

    if (!loading && !available.length) return null;

    return (
        <section id="wallet-purchase" data-testid="wallet-purchase" className={cn("scroll-mt-4", flat ? "" : "rounded-2xl border border-[var(--hairline)] bg-card p-4 sm:p-6")}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold leading-6 text-[var(--ink-1)]">{activeMode === "plan" ? "订阅套餐" : "充值积分"}</h2>
                    <p className="mt-0.5 text-[12px] leading-5 text-[var(--ink-3)]">{activeMode === "plan" ? "按月开通，积分与会员权益一起到账。" : "一次性到账的永久积分，不随套餐过期。"}</p>
                </div>
                {available.length > 1 ? (
                    <div className="flex items-center gap-0.5 rounded-full bg-[var(--surface-inset)] p-1" role="tablist" aria-label="购买方式">
                        {available.map((item) => (
                            <button
                                key={item}
                                type="button"
                                role="tab"
                                aria-selected={activeMode === item}
                                onClick={() => onModeChange?.(item)}
                                className={cn(
                                    "h-8 rounded-full px-4 text-[13px] font-medium transition-colors",
                                    activeMode === item ? "bg-card text-[var(--ink-1)] shadow-[0_1px_3px_rgba(32,36,42,0.1)] dark:bg-[#2f343b]" : "text-[var(--ink-3)] hover:text-[var(--ink-1)]",
                                )}
                            >
                                {item === "plan" ? "按月订阅" : "按量充值"}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            {loading ? (
                <Skeleton active paragraph={{ rows: 3 }} />
            ) : (
                <>
                    <div
                        className={cn(
                            "hide-scrollbar -mx-4 flex snap-x items-stretch gap-2.5 overflow-x-auto px-4 pb-1 pt-3 sm:mx-0 sm:grid sm:overflow-visible sm:px-0",
                            activeMode === "plan" ? (list.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2") : "sm:grid-cols-3 lg:grid-cols-5",
                        )}
                        role="radiogroup"
                        aria-label={activeMode === "plan" ? "选择套餐" : "充值金额"}
                    >
                        {list.map((item) => {
                            const active = item.id === selected?.id;
                            const recommended = isRecommended(item);
                            const current = activeMode === "plan" && item.planId && item.planId === activePlanId;
                            const bonus = activeMode === "points" ? bonusText(item) : "";
                            const equivalent = equivalentText(item.pointsAmount, costs);
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    data-topup-pack={activeMode === "points" ? item.id : undefined}
                                    data-plan-tile={activeMode === "plan" ? item.id : undefined}
                                    onClick={() => setPicked((prev) => ({ ...prev, [activeMode]: item.id }))}
                                    className={cn(
                                        "relative flex w-[42vw] shrink-0 snap-start flex-col items-start rounded-xl border bg-[var(--surface-soft)] px-4 text-left transition-[transform,box-shadow,border-color,background-color] duration-200 sm:w-auto",
                                        activeMode === "plan" ? "min-h-[160px] py-4" : "min-h-[112px] py-3.5",
                                        recommended && "sm:-translate-y-1.5",
                                        active ? "border-[var(--brand-500)] bg-card shadow-[0_10px_28px_-12px_rgba(226,103,31,0.45)] ring-1 ring-[var(--brand-500)]/20" : "border-transparent hover:border-[var(--hairline)] hover:bg-card",
                                    )}
                                >
                                    {recommended ? <span className="absolute -top-2.5 left-3.5 rounded-full bg-[var(--brand-500)] px-2 py-px text-[10px] font-semibold leading-4 text-white">推荐</span> : null}
                                    {current ? <span className="absolute right-3 top-3 rounded-full bg-emerald-500/10 px-2 py-px text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">使用中</span> : null}
                                    {activeMode === "plan" ? <span className="mb-2 text-[13px] font-medium text-[var(--ink-2)]">{item.name}</span> : null}
                                    <span className="flex items-baseline gap-0.5 text-[var(--ink-1)]">
                                        <span className="text-[13px] font-medium">¥</span>
                                        <span className={cn("font-semibold leading-none tracking-[-0.02em] tabular-nums", activeMode === "plan" ? "text-[32px]" : "text-[26px]")}>{formatYuan(salePrice(item))}</span>
                                        {activeMode === "plan" ? <span className="ml-0.5 text-[12px] text-[var(--ink-3)]">/ 月</span> : null}
                                    </span>
                                    <span className="mt-2 flex items-center gap-1 text-[12.5px] font-medium tabular-nums text-[var(--ink-2)]">
                                        <CreditSymbol className="text-[12px] text-[var(--brand-600)]" />
                                        {formatCreditAmount(item.pointsAmount)} 积分{activeMode === "plan" ? " / 月" : ""}
                                    </span>
                                    {bonus ? <span className="mt-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">{bonus}</span> : null}
                                    {activeMode === "plan" ? (
                                        <span className="mt-2 line-clamp-2 text-[11.5px] leading-[17px] text-[var(--ink-3)]">{item.description}</span>
                                    ) : equivalent ? (
                                        <span className="mt-1 text-[11px] text-[var(--ink-3)]">{equivalent}</span>
                                    ) : null}
                                    {active ? (
                                        <span className="absolute bottom-3 right-3 grid size-[18px] place-items-center rounded-full bg-[var(--brand-500)] text-white">
                                            <Check className="size-3" strokeWidth={3} />
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>

                    <div
                        className={cn(
                            "sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-4 sm:static",
                            flat ? "bg-[var(--ant-color-bg-elevated,#fff)] dark:bg-transparent" : "-mx-4 bg-card px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0",
                        )}
                    >
                        <span className="min-w-0 text-[12px] text-[var(--ink-3)]">
                            {selected ? (
                                <>
                                    {activeMode === "plan" ? `${selected.name} · 每月 ` : "到账 "}
                                    <span className="font-semibold tabular-nums text-[var(--ink-1)]">{formatCreditAmount(selected.pointsAmount)}</span> 积分
                                    {cheaperPlan ? (
                                        <>
                                            {" · "}
                                            <button type="button" onClick={() => onModeChange?.("plan")} className="font-medium text-[var(--brand-600)] hover:underline">
                                                开通{cheaperPlan.name}只要 ¥{formatYuan(salePrice(cheaperPlan))}，更划算
                                            </button>
                                        </>
                                    ) : (
                                        " · 结算页可用优惠券"
                                    )}
                                </>
                            ) : null}
                        </span>
                        <Button type="primary" className={cn(profilePrimaryButtonClass, "!h-10 !rounded-full !px-5")} disabled={!selected} onClick={() => selected && onCheckout(selected)}>
                            <span className="inline-flex items-center gap-1.5">
                                {activeMode === "plan" ? (isCurrentPlan ? "续费" : hasActivePlan ? "切换套餐" : "开通") : "去支付"} ¥
                                <AnimatedNumber value={selected ? salePrice(selected) : 0} format={(value) => formatYuan(Math.round(value))} duration={350} />
                                <ArrowUpRight className="size-4" />
                            </span>
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
}

function discountLabel(template?: CouponTemplate) {
    if (!template) return "";
    if (template.discountType === "fixed") return `¥${formatYuan(template.discountValue)}`;
    return `${(template.discountValue / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
}

export function WalletCouponCard({ coupons, loading, onClaimed, onOpenAll }: { coupons: UserCoupon[]; loading: boolean; onClaimed: () => Promise<void> | void; onOpenAll: () => void }) {
    const { message } = App.useApp();
    const [code, setCode] = useState("");
    const [claiming, setClaiming] = useState(false);
    const available = coupons.filter((coupon) => coupon.status === "available");
    const soonest = [...available].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0];

    const redeem = async () => {
        const value = code.trim();
        if (!value || claiming) return;
        setClaiming(true);
        try {
            await claimBillingCoupon({ code: value });
            message.success("优惠券已领取");
            setCode("");
            await onClaimed();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "兑换失败");
        } finally {
            setClaiming(false);
        }
    };

    return (
        <section data-testid="wallet-coupon-card" className="rounded-2xl border border-[var(--hairline)] bg-card p-4">
            <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--ink-1)]">
                    <TicketPercent className="size-4 text-[var(--brand-600)]" /> 优惠券
                    <span className="ml-0.5 rounded-full bg-[var(--surface-inset)] px-1.5 text-[11px] font-medium tabular-nums text-[var(--ink-2)]">{available.length}</span>
                </h3>
                <button type="button" onClick={onOpenAll} className="inline-flex items-center gap-0.5 text-[12px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]">
                    全部 <ArrowRight className="size-3.5" />
                </button>
            </div>
            {loading ? (
                <Skeleton active paragraph={{ rows: 1 }} title={false} className="mt-3" />
            ) : (
                /* 票根样式：左侧面额、右侧说明，中间一条虚线撕口，两端各挖一个半圆缺口 */
                <div className={cn("wallet-ticket relative mt-3 flex items-stretch rounded-xl", soonest ? "bg-[var(--brand-soft)] text-[var(--brand-600)]" : "bg-[var(--surface-soft)] text-[var(--ink-3)]")}>
                    <div className="grid w-[76px] shrink-0 place-items-center py-3 text-[18px] font-semibold tabular-nums">{soonest ? discountLabel(soonest.template) : "—"}</div>
                    <div className="relative my-2 border-l border-dashed border-current opacity-30" aria-hidden />
                    <span aria-hidden className="absolute -top-1.5 left-[76px] size-3 -translate-x-1/2 rounded-full bg-card" />
                    <span aria-hidden className="absolute -bottom-1.5 left-[76px] size-3 -translate-x-1/2 rounded-full bg-card" />
                    <div className="min-w-0 flex-1 px-3 py-3">
                        <div className="truncate text-[13px] font-medium text-[var(--ink-1)]">{soonest ? soonest.template?.name || "优惠券" : "暂无可用优惠券"}</div>
                        <div className="mt-0.5 truncate text-[11px] text-[var(--ink-3)]">{soonest ? (soonest.expiresAt ? `${new Date(soonest.expiresAt).toLocaleDateString("zh-CN")} 到期` : "长期有效") : "有兑换码可以在下面兑换"}</div>
                    </div>
                </div>
            )}
            <div className="mt-3 flex gap-2">
                <Input value={code} onChange={(event) => setCode(event.target.value)} onPressEnter={() => void redeem()} placeholder="输入兑换码" maxLength={64} />
                <Button className="shrink-0" loading={claiming} disabled={!code.trim()} onClick={() => void redeem()}>
                    {"兑换"}
                </Button>
            </div>
        </section>
    );
}

export function WalletReferralCard({ onOpen }: { onOpen: () => void }) {
    return (
        <div className="overflow-hidden rounded-2xl">
            <button
                type="button"
                data-testid="wallet-referral-card"
                onClick={onOpen}
                className="group relative w-full overflow-hidden rounded-2xl border border-[var(--hairline)] bg-card p-4 text-left transition-colors hover:bg-[var(--surface-soft)]"
                aria-label="邀请好友得积分"
            >
                <span aria-hidden className="pointer-events-none absolute -bottom-10 -right-8 size-32 rounded-full bg-[radial-gradient(circle,rgba(226,103,31,0.18),transparent_68%)]" />
                <span className="relative flex items-center gap-1.5 text-[14px] font-semibold text-[var(--ink-1)]">
                    <Gift className="size-4 text-[var(--brand-600)]" /> 邀请好友得积分
                </span>
                <span className="relative mt-1 block text-[12px] leading-5 text-[var(--ink-3)]">好友注册与首单都有奖励，积分直接到账。</span>
                <span className="relative mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink-1)]">
                    复制邀请链接 <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
            </button>
        </div>
    );
}

/**
 * 「这些积分能做多少事」：按当前默认图片 / 视频模型和默认参数估算单次消耗，
 * 用和输入框一致的 requestCreditCost；拿不到价格（自有 API、模型未定价）时返回 0，界面就不显示换算。
 */
export function useCreditEquivalents() {
    const config = useConfigStore((state) => state.config);
    const defaults = usePublicSessionStore((state) => state.payload?.settings?.defaultModels);
    return useMemo(() => {
        const base = { apiSource: config.apiSource, modelPointCosts: config.modelPointCosts, generationPointMultipliers: config.generationPointMultipliers, logicalModels: config.logicalModels, imageTiers: config.imageTiers };
        const imageModel = config.imageModel || defaults?.imageModel || "";
        const videoModel = config.videoModel || defaults?.videoModel || "";
        const image = imageModel ? requestCreditCost({ ...base, model: imageModel, kind: "image", quality: config.quality }) : 0;
        const video = videoModel ? requestCreditCost({ ...base, model: videoModel, kind: "video", videoQuality: config.vquality, videoSeconds: config.videoSeconds }) : 0;
        return { image, video };
    }, [config, defaults?.imageModel, defaults?.videoModel]);
}

export function equivalentText(points: number, costs: { image: number; video: number }) {
    const parts: string[] = [];
    if (costs.image > 0) parts.push(`约 ${Math.floor(points / costs.image).toLocaleString("zh-CN")} 张图`);
    if (costs.video > 0) parts.push(`${Math.floor(points / costs.video).toLocaleString("zh-CN")} 条视频`);
    return parts.join(" · ");
}

/** 每日积分的清零时间：今天 → 「今晚 HH:mm 清零」，否则给日期 */
export function dailyExpiryText(iso?: string) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const hm = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const sameDay = date.toDateString() === now.toDateString();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() === date.getTime();
    if (endOfToday) return "今晚 24:00 清零";
    if (sameDay) return `今天 ${hm} 清零`;
    return `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${hm} 清零`;
}

const CONSUMPTION_SOURCES = [
    { key: "video", label: "视频", color: "#e2671f" },
    { key: "image", label: "图片", color: "#f2a46b" },
    { key: "audio", label: "音频", color: "#7c8cff" },
    { key: "agent", label: "Agent / 其他", color: "#9aa3ad" },
] as const;
type ConsumptionSource = (typeof CONSUMPTION_SOURCES)[number]["key"];

function consumptionSource(description: string): ConsumptionSource {
    if (/视频|video/i.test(description)) return "video";
    if (/音频|语音|配音|音乐|audio|speech|tts/i.test(description)) return "audio";
    if (/图|image/i.test(description)) return "image";
    return "agent";
}

type ConsumptionRecord = { amount: number; createdAt: string; type: string; description?: string };

/**
 * 近 14 天消耗：按来源（视频 / 图片 / 音频 / Agent）分色堆叠，顶部图例给各来源合计，
 * 悬停某一天浮出当天明细（各来源积分 + 次数）。数据自己拉 50 条扣除记录，不受列表分页影响。
 */
export function ConsumptionSparkline({ records: fallback }: { records: ConsumptionRecord[] }) {
    const [loaded, setLoaded] = useState<ConsumptionRecord[] | null>(null);
    const [hover, setHover] = useState<number | null>(null);
    useEffect(() => {
        let alive = true;
        void listPointRecords({ direction: "debit", page: 1, pageSize: 50 })
            .then((result) => alive && setLoaded(result.records))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);
    const records = loaded ?? fallback;
    const { days, totals, max, total } = useMemo(() => {
        const today = new Date();
        const empty = () => ({ video: 0, image: 0, audio: 0, agent: 0 }) as Record<ConsumptionSource, number>;
        const buckets = Array.from({ length: 14 }, (_, index) => {
            const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (13 - index));
            return { key: day.toDateString(), label: `${day.getMonth() + 1}月${day.getDate()}日`, short: `${day.getMonth() + 1}/${day.getDate()}`, points: empty(), counts: empty(), sum: 0 };
        });
        const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
        const sourceTotals = empty();
        for (const record of records) {
            if (record.amount >= 0) continue;
            const bucket = byKey.get(new Date(record.createdAt).toDateString());
            if (!bucket) continue;
            const source = consumptionSource(record.description || "");
            const value = Math.abs(record.amount);
            bucket.points[source] += value;
            bucket.counts[source] += 1;
            bucket.sum += value;
            sourceTotals[source] += value;
        }
        return { days: buckets, totals: sourceTotals, max: Math.max(...buckets.map((bucket) => bucket.sum), 0), total: buckets.reduce((acc, bucket) => acc + bucket.sum, 0) };
    }, [records]);
    const active = hover === null ? null : days[hover];
    const average = total / 14;

    return (
        <div data-testid="wallet-consumption-sparkline" className="mb-4 rounded-xl border border-[var(--hairline)] px-4 pb-3 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div>
                    <div className="text-[12px] text-[var(--ink-3)]">近 14 天消耗</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="text-[22px] font-semibold tabular-nums text-[var(--ink-1)]">{formatCreditAmount(total)}</span>
                        <span className="text-[12px] text-[var(--ink-3)]">积分 · 日均 {formatCreditAmount(Math.round(average))}</span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {CONSUMPTION_SOURCES.map((source) => (
                        <div key={source.key} className="min-w-[72px]">
                            <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink-3)]">
                                <span className="size-2 rounded-sm" style={{ background: source.color }} />
                                {source.label}
                            </div>
                            <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[var(--ink-1)]">
                                {formatCreditAmount(totals[source.key])}
                                <span className="ml-1 text-[11px] font-normal text-[var(--ink-3)]">{total > 0 ? `${Math.round((totals[source.key] / total) * 100)}%` : ""}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="relative mt-4">
                {/* 日均参考线 */}
                {max > 0 ? (
                    <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--ink-3)]/30" style={{ bottom: `${(average / max) * 100}%` }}>
                        <span className="absolute -top-4 right-0 text-[10px] text-[var(--ink-3)]">日均</span>
                    </div>
                ) : null}
                <div className="flex h-28 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
                    {days.map((day, index) => (
                        <div
                            key={day.key}
                            data-day={day.short}
                            onMouseEnter={() => setHover(index)}
                            className={cn("relative flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-md transition-colors", hover === index && "bg-[var(--surface-inset)]")}
                        >
                            {day.sum > 0 ? (
                                <div className="flex w-[62%] flex-col-reverse overflow-hidden rounded-[3px]" style={{ height: `${Math.max(4, (day.sum / max) * 100)}%` }}>
                                    {CONSUMPTION_SOURCES.map((source) =>
                                        day.points[source.key] > 0 ? <span key={source.key} className="block w-full shrink-0" style={{ height: `${(day.points[source.key] / day.sum) * 100}%`, background: source.color }} /> : null,
                                    )}
                                </div>
                            ) : (
                                <span className="h-[3px] w-[62%] rounded-full bg-[var(--hairline)]" />
                            )}
                        </div>
                    ))}
                </div>
                {active ? (
                    <div
                        role="tooltip"
                        data-testid="wallet-consumption-tooltip"
                        className="pointer-events-none absolute bottom-full z-20 mb-2 w-[200px] rounded-xl bg-[var(--surface-panel,#fff)] p-3 text-[12px] shadow-[0_12px_32px_-8px_rgba(17,17,19,0.25)] ring-1 ring-[var(--hairline)]"
                        style={{ left: `clamp(0px, calc(${((hover! + 0.5) / 14) * 100}% - 100px), calc(100% - 200px))` }}
                    >
                        <div className="flex items-baseline justify-between">
                            <span className="font-medium text-[var(--ink-1)]">{active.label}</span>
                            <span className="font-semibold tabular-nums text-[var(--ink-1)]">{formatCreditAmount(active.sum)} 积分</span>
                        </div>
                        {active.sum > 0 ? (
                            <div className="mt-2 space-y-1">
                                {CONSUMPTION_SOURCES.filter((source) => active.points[source.key] > 0).map((source) => (
                                    <div key={source.key} className="flex items-center justify-between text-[var(--ink-2)]">
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-sm" style={{ background: source.color }} />
                                            {source.label}
                                            <span className="text-[var(--ink-3)]">× {active.counts[source.key]}</span>
                                        </span>
                                        <span className="tabular-nums">{formatCreditAmount(active.points[source.key])}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-1.5 text-[var(--ink-3)]">当天没有消耗</div>
                        )}
                    </div>
                ) : null}
            </div>
            <div className="mt-1.5 flex gap-1.5 text-[10px] text-[var(--ink-3)]">
                {days.map((day, index) => (
                    <span key={day.key} className={cn("flex-1 text-center tabular-nums", index % 2 === 1 && index !== 13 && "invisible sm:visible", hover === index && "font-semibold text-[var(--ink-1)]")}>
                        {index === 13 ? "今天" : day.short}
                    </span>
                ))}
            </div>
        </div>
    );
}

const WALLET_FAQ = [
    { q: "积分怎么扣？", a: "每次生成按模型和参数计费。先扣当天的每日积分，用完再扣永久积分；生成失败会自动退回。" },
    { q: "积分会过期吗？", a: "每日积分只在当天有效；充值得到的永久积分不会过期，套餐到期也不影响。" },
    { q: "充值后多久到账？", a: "支付成功后自动到账，余额会马上刷新；订单状态可以在账单明细的「充值订单」里查看。" },
] as const;

/** 右栏第三张：三条常见问题，点开展开，不跳页 */
export function WalletFaqCard() {
    const [open, setOpen] = useState<number | null>(null);
    return (
        <section data-testid="wallet-faq" className="rounded-2xl border border-[var(--hairline)] bg-card p-2">
            <h3 className="px-2 pb-1 pt-2 text-[14px] font-semibold text-[var(--ink-1)]">常见问题</h3>
            {WALLET_FAQ.map((item, index) => {
                const expanded = open === index;
                return (
                    <div key={item.q}>
                        <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : index)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--ink-1)]">
                            {item.q}
                            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
                        </button>
                        {expanded ? <p className="px-2 pb-2 text-[12px] leading-5 text-[var(--ink-3)]">{item.a}</p> : null}
                    </div>
                );
            })}
        </section>
    );
}
