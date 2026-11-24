import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const adminFile = (name: string) => readFile(resolve(process.cwd(), `src/app/admin/${name}`), "utf8");

describe("admin shell", () => {
    it("owns auth, user hydration and the console wrapper in one layout", async () => {
        const layout = await adminFile("layout.tsx");

        // 三页原先各抄一遍「鉴权 + 15 字段 hydrator + admin-console-page」，
        // 收进布局后任何新增的 admin 路由自动继承，不用再复制
        expect(layout).toContain("requireAdminUser");
        expect(layout).toContain("<AuthUserHydrator");
        expect(layout).toContain("admin-console-page app-scroll-page");
        expect(layout).toContain("mfaEnabled: currentUser.mfaEnabled");
        // 鉴权只在 requireAdminUser 里做一次
        expect(layout).not.toContain("getAuthenticatedPageAccess");
    });

    it("keeps the three admin routes free of duplicated shell boilerplate", async () => {
        const [page, billing, setup] = await Promise.all([adminFile("page.tsx"), adminFile("billing/page.tsx"), adminFile("setup/page.tsx")]);

        for (const source of [page, billing, setup]) {
            expect(source).not.toContain("<AuthUserHydrator");
            expect(source).not.toContain("admin-console-page");
            expect(source).not.toContain("getAuthenticatedPageAccess");
        }
        // 页面仍要拿到当前管理员（顶栏账号区、按权限筛分区都要用）
        for (const source of [page, billing, setup]) {
            expect(source).toContain("requireAdminUser()");
        }
    });

    it("resolves the session once per request so layout and page do not read it twice", async () => {
        const access = await readFile(resolve(process.cwd(), "src/lib/server/admin-page-access.ts"), "utf8");

        // React cache：布局判过之后，页面再调一次不会多读一次会话/库
        expect(access).toContain("cache(async () =>");
        // 三条出口与拆分前一致：装站未完成 → /install，未登录 → 登录页，非 admin → 首页
        expect(access).toContain('redirect("/install")');
        expect(access).toContain('redirect("/login?next=/admin")');
        expect(access).toContain('if (access.user.role !== "admin") redirect("/")');
    });
});
