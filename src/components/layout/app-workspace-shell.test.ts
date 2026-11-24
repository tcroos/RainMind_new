import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isFullscreenWorkspacePath } from "./app-workspace-path";

describe("workspace sidebar", () => {
    it("starts expanded and keeps scrolling without a visible scrollbar", async () => {
        const [shell, sidebar] = await Promise.all([readFile(resolve(process.cwd(), "src/components/layout/app-workspace-shell.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/components/layout/app-sidebar.tsx"), "utf8")]);

        expect(shell).toContain("const [sidebarExpanded, setSidebarExpanded] = useState(true)");
        expect(shell).toContain("expanded={sidebarExpanded}");
        expect(sidebar).toContain('expanded ? "w-52" : "w-[72px]"');
        expect(sidebar).toContain("hide-scrollbar min-h-0 flex-1 overflow-y-auto");
        expect(sidebar).not.toContain("thin-scrollbar min-h-0 flex-1 overflow-y-auto");
        // 底部固定账号入口（帮助已收进个人中心），点它进个人中心
        expect(sidebar).toContain('href="/profile"');
        expect(sidebar).toContain("个人中心");
        expect(sidebar).not.toContain('href="/help"');
        expect(sidebar).not.toContain("userAvatarFallback");
        expect(sidebar).not.toContain("workspaceUrl");
        expect(sidebar).not.toContain("window.location.host");
    });

    it("uses a larger nav type scale and a Dreamina-like rail width", async () => {
        const [sidebar, mobile] = await Promise.all([readFile(resolve(process.cwd(), "src/components/layout/app-sidebar.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/components/layout/mobile-nav-drawer.tsx"), "utf8")]);

        // 即梦工作台侧栏约占视口 12%；仅从 176 → 192px 肉眼几乎看不出变化，
        // 这次放大到 208px(14.4%) 并把字号抬到 16px，让加宽一眼可见。
        expect(sidebar).toContain('expanded ? "w-52" : "w-[72px]"');
        expect(sidebar).not.toContain('"w-44"');
        expect(sidebar).not.toContain('"w-48"');
        // 12 个导航项要在 900px 高度内排完，行高从 48 收到 44，字号仍是 16px
        expect(sidebar).toContain("h-11 items-center rounded-lg px-2 text-base");
        expect(sidebar).toContain("text-[13px] font-normal text-[var(--ink-3)]");
        expect(sidebar).toContain("text-[17px] font-semibold");
        expect(sidebar).toContain("size-5 shrink-0");
        // 收起态只留图标，宽度不变，避免折叠时跳动
        expect(sidebar).toContain('"w-[72px]"');
        // 移动抽屉同步字号，桌面/窄屏读起来是同一套比例
        expect(mobile).toContain("text-base");
        expect(mobile).toContain("size-5 shrink-0");
    });

    it("keeps sidebar links readable in dark mode despite antd's unlayered anchor rule", async () => {
        const css = await readFile(resolve(process.cwd(), "src/app/styles/global-surfaces.css"), "utf8");

        // antd 的无层级 a{color} 在深色态等于侧栏底色，整排文字会隐形；
        // 覆盖规则必须写在 @layer 之外并按 ink 令牌取色。
        expect(css).toContain(".workspace-shell aside a {");
        expect(css).toContain(".workspace-shell aside a:hover,");
        expect(css).toContain("color: var(--ink-2);");
        expect(css).toContain("color: var(--ink-1);");
    });

    it("keeps the mobile nav drawer readable despite antd's unlayered anchor rules", async () => {
        const [drawer, css] = await Promise.all([readFile(resolve(process.cwd(), "src/components/layout/mobile-nav-drawer.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/styles/global-surfaces.css"), "utf8")]);

        // 抽屉被 antd portal 到 <body>，不在 .workspace-shell 里，上面那条 aside 规则管不到。
        // 而 antd reset 的 a{background-color:transparent} 和 a{color:var(--ant-color-link)}
        // 都是无层级的，会压过 @layer utilities —— 结果是组件里写的 text-/bg- 全部失效，
        // 实测选中项没有底色、整列文字都取 antd 链接色。必须挂稳定根类并在 @layer 之外覆盖。
        expect(drawer).toContain('rootClassName="workspace-mobile-nav"');
        expect(css).toContain(".workspace-mobile-nav .ant-drawer-body a {");
        expect(css).toContain('.workspace-mobile-nav .ant-drawer-body a[aria-current="page"] {');
        expect(css).toContain(".workspace-mobile-nav .ant-drawer-body a:hover {");
        expect(css).toContain(".workspace-mobile-nav .ant-drawer-title a {");
        expect(css).toContain("background-color: var(--surface-inset);");
        // 组件侧改用令牌，不再手抄灰阶（头像渐变由页面域统一维护，不在此断言范围）
        expect(drawer).toContain("bg-[var(--surface-inset)]");
        expect(drawer).toContain("text-[var(--ink-2)]");
        expect(drawer).not.toContain("#697381");
        expect(drawer).not.toContain("#9aa2ad");
    });

    it("opens Canvas and drama project details as full-screen workspaces only", () => {
        expect(isFullscreenWorkspacePath("/canvas/canvas-one")).toBe(true);
        expect(isFullscreenWorkspacePath("/canvas/canvas-one/history")).toBe(true);
        expect(isFullscreenWorkspacePath("/drama/drama-one")).toBe(true);
        expect(isFullscreenWorkspacePath("/drama/drama-one/episode")).toBe(true);
        expect(isFullscreenWorkspacePath("/canvas")).toBe(false);
        expect(isFullscreenWorkspacePath("/drama")).toBe(false);
    });
});
