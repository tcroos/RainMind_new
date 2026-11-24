import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft, ReceiptText } from "lucide-react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { ADMIN_BILLING_TABS, resolveAdminBillingTab, type AdminBillingTab } from "@/lib/admin-permissions";
import { requireAdminUser } from "@/lib/server/admin-page-access";
import { getDatabaseProvider } from "@/lib/server/database";
import { getPaymentConfigSummary } from "@/lib/server/payment-config-status";
import { getTrustedProxyHops } from "@/lib/server/trusted-proxy";

import { BillingOperations } from "./components/billing-operations";

type AdminBillingPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminBillingPage({ searchParams }: AdminBillingPageProps) {
    const params = searchParams ? await searchParams : {};
    const requestedTab = parseBillingTab(params.tab);
    // 鉴权、用户注入与后台外壳（main 容器）都在 src/app/admin/layout.tsx
    const currentUser = await requireAdminUser();
    const initialTab = resolveAdminBillingTab(currentUser, requestedTab);
    if (!initialTab) redirect("/");

    const paymentConfig = initialTab === "payments" ? await getPaymentConfigSummary(await resolveRequestOrigin()) : undefined;

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mx-auto flex h-16 max-w-[1440px] min-w-0 items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
                    <Link href="/admin" className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-zinc-950 dark:text-zinc-100">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950">
                            <ArrowLeft className="size-4" />
                        </span>
                        <span className="truncate">财务钱包</span>
                    </Link>
                    <UserStatusActions initialUser={currentUser} />
                </div>
            </header>

            <div className="mx-auto max-w-[1440px] px-3 py-4 sm:px-6 sm:py-5 lg:py-6">
                <div className="mb-5 flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-4 shadow-sm shadow-zinc-200/40 sm:px-5 md:flex-row md:items-center md:justify-between dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/20">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white dark:bg-emerald-400 dark:text-zinc-950">
                            <ReceiptText className="size-5" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="text-2xl font-semibold tracking-normal text-zinc-950 dark:text-zinc-100">财务钱包</h1>
                            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">管理套餐商品、限时促销、优惠券、支付配置、订单收款和退款对账。</p>
                        </div>
                    </div>
                    <Link
                        href="/admin"
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                        <ArrowLeft className="size-4" />
                        返回后台
                    </Link>
                </div>

                <BillingOperations databaseProvider={getDatabaseProvider()} initialTab={initialTab} initialPaymentConfig={paymentConfig} />
            </div>
        </>
    );
}

function parseBillingTab(value: string | string[] | undefined): AdminBillingTab {
    const tab = Array.isArray(value) ? value[0] : value;
    return ADMIN_BILLING_TABS.includes(tab as AdminBillingTab) ? (tab as AdminBillingTab) : "orders";
}

async function resolveRequestOrigin() {
    const requestHeaders = await headers();
    const trustForwarded = getTrustedProxyHops() > 0;
    const host = (trustForwarded ? requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() : "") || requestHeaders.get("host") || "localhost:3000";
    const protocol = (trustForwarded ? requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() : "") || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${protocol}://${host}`;
}
