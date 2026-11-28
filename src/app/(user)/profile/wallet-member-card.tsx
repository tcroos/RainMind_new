"use client";

import { CreditCard, ReceiptText, TicketPercent } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { appStorageKey } from "@/lib/storage-keys";
import { cn } from "@/lib/utils";

import { AnimatedNumber } from "./wallet-overview-blocks";

const LAST_BALANCE_KEY = appStorageKey("wallet_last_balance");

/**
 * 钱包首屏的「会员卡」：浅色主题是暖白卡面，深色主题是深色卡面（颜色全走 --wm-* 变量），品牌橙光 + 首页同款点阵，
 * 余额 56px 并在进场时滚动计数；套餐名像卡面等级一样印在右上角。
 * 余额比上次看到的多（比如刚支付完回来），卡面闪一下「+N」。
 */
export function WalletMemberCard({
    balance,
    dailyBalance,
    permanentBalance,
    dailyExpiry,
    planLabel,
    hasActivePlan,
    equivalent,
    lowBalanceText,
    ordersTotal,
    onRecharge,
    onCoupons,
    onBills,
}: {
    balance: number;
    dailyBalance: number;
    permanentBalance: number;
    dailyExpiry: string;
    planLabel: string;
    hasActivePlan: boolean;
    equivalent: string;
    lowBalanceText: string;
    ordersTotal: number;
    onRecharge: () => void;
    onCoupons: () => void;
    onBills: () => void;
}) {
    const [gain, setGain] = useState(0);
    const checkedRef = useRef(false);

    useEffect(() => {
        if (checkedRef.current) return;
        checkedRef.current = true;
        try {
            const last = Number(window.localStorage.getItem(LAST_BALANCE_KEY));
            if (Number.isFinite(last) && window.localStorage.getItem(LAST_BALANCE_KEY) !== null && balance > last) setGain(balance - last);
        } catch {
            /* 无痕模式读不到 localStorage 就不闪 */
        }
    }, [balance]);

    useEffect(() => {
        try {
            window.localStorage.setItem(LAST_BALANCE_KEY, String(balance));
        } catch {
            /* ignore */
        }
    }, [balance]);

    useEffect(() => {
        if (!gain) return;
        const timer = window.setTimeout(() => setGain(0), 2600);
        return () => window.clearTimeout(timer);
    }, [gain]);

    const stats = [
        { label: dailyExpiry ? `每日积分 · ${dailyExpiry}` : "每日积分 · 优先扣除", value: formatCreditAmount(dailyBalance) },
        { label: "永久积分 · 每日积分用完后扣", value: formatCreditAmount(permanentBalance) },
    ];

    return (
        <section data-testid="wallet-balance-card" className="wallet-member-card relative mb-4 overflow-hidden rounded-2xl text-[var(--wm-ink)] sm:mb-6">
            <div aria-hidden className="wallet-member-card__dots pointer-events-none absolute inset-0" />
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-32 size-[420px] rounded-full bg-[radial-gradient(circle,var(--wm-glow),transparent_62%)]" />
            <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-[360px] rounded-full bg-[radial-gradient(circle,var(--wm-glow-2),transparent_65%)]" />

            <div className="relative flex flex-col gap-6 p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--wm-ink-3)]">
                        <CreditSymbol className="text-[var(--wm-accent)]" /> 可用积分
                    </div>
                    <span className={cn("inline-flex h-7 items-center rounded-full px-3 text-[12px] font-semibold tracking-wide", hasActivePlan ? "bg-gradient-to-r from-[#f6b181] to-[#e2671f] text-[#1a1208]" : "bg-[var(--wm-chip)] text-[var(--wm-ink-2)] ring-1 ring-[var(--wm-ring)]")}>
                        {planLabel}
                    </span>
                </div>

                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                        <div className="relative flex items-end gap-2">
                            <span className="text-[48px] font-semibold leading-none tracking-[-0.03em] sm:text-[56px]">
                                <AnimatedNumber value={balance} duration={900} />
                            </span>
                            <span className="pb-1.5 text-[13px] text-[var(--wm-ink-3)]">积分</span>
                            {gain ? (
                                <span data-testid="wallet-balance-gain" className="wallet-gain-pop absolute -top-5 left-0 rounded-full bg-emerald-400/90 px-2 py-0.5 text-[12px] font-semibold text-[#06281b]">
                                    +{formatCreditAmount(gain)}
                                </span>
                            ) : null}
                        </div>
                        {equivalent ? <div className="mt-2.5 text-[12.5px] text-[var(--wm-ink-3)]">按默认模型，{equivalent}</div> : null}
                        {lowBalanceText ? (
                            <div data-testid="wallet-low-balance" className="mt-2.5 inline-flex items-center rounded-full bg-amber-400/15 px-2.5 py-1 text-[12px] font-medium text-amber-700 ring-1 ring-amber-400/30 dark:text-amber-200">
                                {lowBalanceText}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button type="button" onClick={onRecharge} className="inline-flex h-10 items-center gap-2 rounded-full !bg-[var(--wm-btn)] px-5 text-[13.5px] font-semibold !text-[var(--wm-btn-ink)] transition hover:opacity-90">
                            <CreditCard className="size-4" /> 立即充值
                        </button>
                        <button type="button" onClick={onCoupons} className="inline-flex h-10 items-center gap-2 rounded-full !bg-[var(--wm-chip)] px-4 text-[13.5px] font-medium !text-[var(--wm-ink)] ring-1 ring-[var(--wm-ring)] transition hover:opacity-80">
                            <TicketPercent className="size-4" /> 优惠券
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {stats.map((item) => (
                        <div key={item.label} className="rounded-xl bg-[var(--wm-chip)] px-3.5 py-2.5 ring-1 ring-[var(--wm-ring)]">
                            <div className="text-[15px] font-semibold tabular-nums">{item.value}</div>
                            <div className="mt-0.5 truncate text-[11.5px] text-[var(--wm-ink-3)]">{item.label}</div>
                        </div>
                    ))}
                    <button type="button" onClick={onBills} className="group rounded-xl bg-[var(--wm-chip)] px-3.5 py-2.5 text-left ring-1 ring-[var(--wm-ring)] transition hover:opacity-80">
                        <div className="flex items-center gap-1.5 text-[15px] font-semibold tabular-nums">
                            <ReceiptText className="size-4 text-[var(--wm-ink-3)]" /> {ordersTotal} 笔订单
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[var(--wm-ink-3)] group-hover:text-[var(--wm-ink-2)]">查看账单明细 →</div>
                    </button>
                </div>
            </div>
        </section>
    );
}
