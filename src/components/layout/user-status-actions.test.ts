import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

describe("signing out of the workspace", () => {
    it("always goes back to the /login page after clearing the client session", async () => {
        const tsx = await read("src/components/layout/user-status-actions.tsx");

        expect(tsx).toContain('await fetch("/api/auth/logout", { method: "POST" });');
        expect(tsx).toContain("await resetClientSessionState();");
        expect(tsx).toContain('router.replace("/login");');
        expect(tsx).toContain("router.refresh();");

        // 先清本地会话再跳，避免登录页上仍挂着旧账号
        expect(tsx.indexOf("await resetClientSessionState();")).toBeLessThan(tsx.indexOf('router.replace("/login")'));

        // 不再有「留在 /create」的特判分支与那句停留提示
        expect(tsx).not.toContain("usePathname");
        expect(tsx).not.toContain("pathname.startsWith");
        expect(tsx).not.toContain("已退出登录，可继续浏览");
    });

    it("renders the account menu as a controlled panel instead of an antd dropdown", async () => {
        const tsx = await read("src/components/layout/user-status-actions.tsx");

        // 自定义面板才有稳定的排版：套餐信息一块、菜单一组、退出登录单独一档
        expect(tsx).toContain("function AccountMenuPanel(");
        expect(tsx).toContain("account-menu-popover");
        expect(tsx).not.toContain("accountItems");
    });

    it("points the account panel at the wallet instead of a nested plan modal", async () => {
        const tsx = await read("src/components/layout/user-status-actions.tsx");

        // 充值入口统一在 /wallet，浮层里不再套一层套餐弹窗
        expect(tsx).toContain('href: "/wallet"');
        expect(tsx).toContain('href: "/help"');
        expect(tsx).not.toContain("BillingPlansModal");
        expect(tsx).not.toContain("购买积分与套餐");
    });

    it("keeps the plan action readable on its dark pill", async () => {
        const tsx = await read("src/components/layout/user-status-actions.tsx");

        // 全局有未分层的 `button { color: inherit }`，Tailwind 的文字颜色类会被压掉，
        // 这里必须用内联色，否则黑底黑字（之前就踩过）
        expect(tsx).toContain('style={{ color: "var(--surface-panel)" }}');
    });

    it("labels the profile entry as 账户管理 in the bottom-left account popover", async () => {
        const tsx = await read("src/components/layout/user-status-actions.tsx");

        // 账户菜单第一行改叫「账户管理」，但入口仍指向 /profile，行为不变
        expect(tsx).toContain('key: "profile", label: "账户管理", icon: UserCircle, href: "/profile"');
        expect(tsx).not.toContain('label: "个人中心"');
    });

    it("uses the compact Lovart-style account rail and popover", async () => {
        const tsx = await read("src/components/layout/user-status-actions.tsx");

        // 底部账号条：24px 头像 + 13px 名字 + 13px 积分，整行 40px
        expect(tsx).toContain("size-6 shrink-0 place-items-center overflow-hidden rounded-full");
        expect(tsx).toContain('expanded ? "h-10 min-w-0 flex-1 gap-2 pl-4 pr-2"');
        expect(tsx).toContain("text-[13px] font-semibold tabular-nums");
        // 弹层与侧栏同宽：头像 + 邮箱、套餐/积分一行、整宽升级按钮、纯文字菜单
        expect(tsx).toContain("w-[232px] text-[var(--ink-1)]");
        expect(tsx).toContain("user.email || `ID：${user.accountId}`");
        expect(tsx).toContain("mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg");
        expect(tsx).toContain("PointsQuickPanel");
    });
});
