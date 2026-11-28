import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { accountSectionHref, parseScopedSection, scopeOfSectionParam } from "./account-sections";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("wallet and profile section split", () => {
    it("routes every money section to the wallet and every identity section to profile", () => {
        expect(scopeOfSectionParam("billing")).toBe("wallet");
        expect(scopeOfSectionParam("coupons")).toBe("wallet");
        expect(scopeOfSectionParam("orders")).toBe("wallet");
        expect(scopeOfSectionParam("points")).toBe("wallet");
        expect(scopeOfSectionParam("consume")).toBe("wallet");
        expect(scopeOfSectionParam("referrals")).toBe("wallet");
        expect(scopeOfSectionParam("profile")).toBe("profile");
        expect(scopeOfSectionParam("security")).toBe("profile");
        expect(scopeOfSectionParam("help")).toBe("profile");
        expect(scopeOfSectionParam("unknown")).toBeNull();
    });

    it("never renders a section on the wrong page", () => {
        // 个人中心收到资金分区、钱包收到身份分区，都回落到本页首页，不会渲染出空白
        expect(parseScopedSection("billing", "profile")).toBe("overview");
        expect(parseScopedSection("security", "wallet")).toBe("wallet");
        expect(parseScopedSection(null, "wallet")).toBe("wallet");
        expect(parseScopedSection("points", "wallet")).toBe("points");
    });

    it("builds clean urls without a redundant section param on home", () => {
        expect(accountSectionHref("wallet", "wallet")).toBe("/wallet");
        expect(accountSectionHref("overview", "profile")).toBe("/profile");
        expect(accountSectionHref("billing", "wallet")).toBe("/wallet?section=billing");
        expect(accountSectionHref("help", "profile")).toBe("/profile?section=help");
    });

    it("redirects legacy money links from the profile page to the wallet", async () => {
        const [profile, wallet] = await Promise.all([read("src/app/(user)/profile/page.tsx"), read("src/app/(user)/wallet/page.tsx")]);

        expect(profile).toContain('redirect(section === "wallet" ? "/wallet"');
        expect(profile).toContain('<AccountCenter scope="profile" />');
        expect(wallet).toContain('redirect(section === "overview" ? "/profile"');
        expect(wallet).toContain('<AccountCenter scope="wallet" />');
    });

    it("lays plans, top-up amounts, bills and coupon/referral cards out inline on the wallet overview", async () => {
        const center = await read("src/app/(user)/profile/account-center.tsx");
        const elements = await read("src/app/(user)/profile/profile-elements.tsx");
        const blocks = await read("src/app/(user)/profile/wallet-overview-blocks.tsx");

        const memberCard = await read("src/app/(user)/profile/wallet-member-card.tsx");
        expect(memberCard).toContain('data-testid="wallet-balance-card"');
        // 套餐与充值金额直接在页面上，不再走弹窗
        expect(center).not.toContain("<BillingPlansModal");
        // 套餐与积分包合成一个购买区：按月订阅 / 按量充值切换，共用支付栏
        expect(center).toContain("<WalletPurchaseSection");
        expect(center).toContain("<WalletMemberCard");
        expect(blocks).toContain('id="wallet-purchase"');
        expect(blocks).toContain('"按月订阅" : "按量充值"');
        expect(blocks).toContain('aria-label={activeMode === "plan" ? "选择套餐" : "充值金额"}');
        // 钱包不再用左侧导航，改分段标签
        expect(center).toContain('mode="tabs" scope={scope}');
        expect(center).toContain("<WalletFaqCard");
        expect(blocks).toContain('product.productKind === "points"');
        // 优惠券是概览里的小窗，「全部」打开弹窗；邀请是小卡
        expect(center).toContain("<WalletCouponCard");
        expect(center).toContain("<WalletReferralCard");
        expect(center).toContain("open={couponsOpen}");
        expect(center).toContain('requestedSection === "coupons"');
        // 订单 / 积分 / 消费合成一张账单明细，分段切换
        expect(center).toContain('compact ? "wallet-bills" : "wallet-bill-detail"');
        expect(center).toContain("setBillTab");
        expect(elements).toContain('const WALLET_NAV_KEYS: ProfileSectionKey[] = ["wallet", "orders", "referrals"]');
        expect(elements).toContain('orders: "账单明细"');
        // 老链接 ?section=billing 仍可用：滚到套餐区并把地址清成 /wallet
        expect(center).toContain('requestedSection === "billing"');
        expect(center).toContain('router.replace("/wallet", { scroll: false })');
        expect(elements).not.toContain('label: "充值套餐"');
    });

    it("keeps the sidebar account menu as the second way into the profile", async () => {
        const sidebar = await read("src/components/layout/app-sidebar.tsx");
        const account = await read("src/components/layout/user-status-actions.tsx");

        // 个人中心入口收进侧栏底部的账户菜单（AccountRailBar → 账户管理）
        expect(sidebar).toContain("<AccountRailBar");
        expect(account).toContain('label: "账户管理"');
        expect(account).toContain('href: "/profile"');
        // 帮助从侧栏底部撤下，收进个人中心分区
        expect(sidebar).not.toContain('href="/help"');
    });
});
