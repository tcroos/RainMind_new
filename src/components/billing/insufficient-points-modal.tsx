"use client";

import { Modal } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { WalletPurchaseSection } from "@/app/(user)/profile/wallet-overview-blocks";
import { formatCreditAmount } from "@/constant/credits";
import { listBillingProducts, type BillingProduct } from "@/services/api/billing";
import { useUserStore } from "@/stores/use-user-store";

export const INSUFFICIENT_POINTS_EVENT = "vozeb-pro:insufficient-points";
const INSUFFICIENT_PATTERN = /积分不足|余额不足/;

/** 业务代码也可以直接调用：在自己捕获到「积分不足」时弹出充值小窗 */
export function notifyInsufficientPoints() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(INSUFFICIENT_POINTS_EVENT));
}

let fetchPatched = false;

/*
 * 生成接口分散在 image / video / audio / agent 多个 service 里，各自解析错误。
 * 这里在客户端只装一次 fetch 观察器：站内 /api/ 请求返回 402/429 时克隆响应看一眼，
 * 文案是「积分不足 / 余额不足」就广播事件。不改原响应，调用方的错误处理照旧。
 */
function patchFetchOnce() {
    if (fetchPatched || typeof window === "undefined") return;
    fetchPatched = true;
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (response.status === 402 || response.status === 429) {
            const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
            if (url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`)) {
                void response
                    .clone()
                    .text()
                    .then((text) => {
                        if (INSUFFICIENT_PATTERN.test(text)) notifyInsufficientPoints();
                    })
                    .catch(() => undefined);
            }
        }
        return response;
    };
}

/** 积分不足时的充值小窗：复用钱包里的金额快选，支付后可回到当前页面 */
export function InsufficientPointsModal() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const user = useUserStore((state) => state.user);
    const [open, setOpen] = useState(false);
    const [products, setProducts] = useState<BillingProduct[]>([]);
    const [loading, setLoading] = useState(false);
    const loadedRef = useRef(false);
    const lastShownRef = useRef(0);

    useEffect(() => {
        patchFetchOnce();
        const onInsufficient = () => {
            /* 同一次操作常会连着失败好几个请求，10 秒内只弹一次 */
            if (Date.now() - lastShownRef.current < 10_000) return;
            lastShownRef.current = Date.now();
            setOpen(true);
        };
        window.addEventListener(INSUFFICIENT_POINTS_EVENT, onInsufficient);
        return () => window.removeEventListener(INSUFFICIENT_POINTS_EVENT, onInsufficient);
    }, []);

    useEffect(() => {
        if (!open || loadedRef.current) return;
        loadedRef.current = true;
        setLoading(true);
        void listBillingProducts()
            .then((payload) => setProducts(payload.products || []))
            .catch(() => setProducts([]))
            .finally(() => setLoading(false));
    }, [open]);

    const query = searchParams.toString();
    const from = `${pathname}${query ? `?${query}` : ""}`;
    const checkout = (product: BillingProduct) => {
        setOpen(false);
        router.push(`/billing/checkout?product=${encodeURIComponent(product.id)}&from=${encodeURIComponent(from)}`);
    };

    return (
        <Modal open={open} onCancel={() => setOpen(false)} footer={null} centered width="min(94vw, 760px)" title={null} rootClassName="profile-page-scroll" destroyOnHidden>
            <div data-testid="insufficient-points-modal">
                <div className="mb-3 pr-8">
                    <h2 className="text-[16px] font-semibold text-[var(--ink-1)]">积分不足，充值后继续创作</h2>
                    <p className="mt-1 text-[12.5px] text-[var(--ink-3)]">
                        当前余额 <span className="font-semibold tabular-nums text-[var(--ink-1)]">{formatCreditAmount(user?.pointsBalance || 0)}</span> 积分。支付成功后可以一键回到当前页面。
                    </p>
                </div>
                <WalletPurchaseSection flat products={products} loading={loading} mode="points" modes={["points"]} hasActivePlan={Boolean(user?.hasActivePlan)} onCheckout={checkout} />
            </div>
        </Modal>
    );
}
