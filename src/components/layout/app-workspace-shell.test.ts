import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isFullscreenWorkspacePath } from "./app-workspace-path";

const layoutFile = (name: string) => readFile(resolve(process.cwd(), `src/components/layout/${name}`), "utf8");
const stylesFile = (name: string) => readFile(resolve(process.cwd(), `src/app/styles/${name}`), "utf8");

describe("workspace sidebar", () => {
    it("starts expanded and keeps scrolling without a visible scrollbar", async () => {
        const [shell, sidebar, nav] = await Promise.all([layoutFile("app-workspace-shell.tsx"), layoutFile("app-sidebar.tsx"), layoutFile("workspace-nav-list.tsx")]);

        expect(shell).toContain("const [sidebarExpanded, setSidebarExpanded] = useState(true)");
        expect(shell).toContain("expanded={sidebarExpanded}");
        expect(sidebar).toContain('expanded ? "w-[232px]" : "w-[72px]"');
        // 滚动容器挂在导航列表上（sidebar 与抽屉共用），不是侧栏壳本身
        expect(nav).toContain("hide-scrollbar min-h-0 flex-1 overflow-y-auto");
        expect(nav).not.toContain("thin-scrollbar min-h-0 flex-1 overflow-y-auto");
        // 底部账号条不再直接跳个人中心：它现在是账户菜单的触发器，
        // 小字「个人中心」和右侧箭头已去掉（参考稿：未点开只有头像/名字/积分一行）
        expect(sidebar).toContain("AccountRailBar");
        expect(sidebar).not.toContain("个人中心");
        expect(sidebar).not.toContain("ChevronRight");
        expect(sidebar).not.toContain('href="/help"');
        expect(sidebar).not.toContain("userAvatarFallback");
        expect(sidebar).not.toContain("workspaceUrl");
        expect(sidebar).not.toContain("window.location.host");
    });

    it("remembers the collapsed sidebar across reloads", async () => {
        const shell = await layoutFile("app-workspace-shell.tsx");

        // 壳是持久布局，站内跳转不丢；但硬刷新 / 新开标签会回到默认展开，所以必须落盘
        expect(shell).toContain('appStorageKey("sidebar_expanded")');
        expect(shell).toContain('if (stored === "collapsed") setSidebarExpanded(false);');
        expect(shell).toContain('next ? "expanded" : "collapsed"');
        // localStorage 在隐私模式会抛异常，读和写都要兜住，不能因为留不住偏好就点不动
        expect(shell).toContain("} catch {");
        // 首帧仍用展开态：服务端与客户端必须一致，否则 hydration 报错
        expect(shell).toContain("const [sidebarExpanded, setSidebarExpanded] = useState(true)");
    });

    it("uses the wider Lovart-like rail with a compact type scale", async () => {
        const [sidebar, mobile, nav] = await Promise.all([layoutFile("app-sidebar.tsx"), layoutFile("mobile-nav-drawer.tsx"), layoutFile("workspace-nav-list.tsx")]);

        // 侧栏从 208px 放宽到 232px（参考 Lovart），收起态仍是 72px 不跳动
        expect(sidebar).toContain('expanded ? "w-[232px]" : "w-[72px]"');
        expect(sidebar).not.toContain('"w-52"');
        expect(sidebar).toContain('"w-[72px]"');
        // 分组标题取消后不需要 16px 大字：条目 14px / 行高 40px / 图标 18px
        expect(nav).toContain("h-10 items-center rounded-lg px-2 text-[14px]");
        expect(nav).toContain("size-[18px] shrink-0");
        expect(nav).not.toContain("groupLabel");
        expect(sidebar).toContain("text-[15px] font-semibold");
        // 移动抽屉沿用同一套字号，触控高度单独放宽
        expect(nav).toContain("min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-[14px]");
        expect(mobile).toContain("text-base");
    });

    it("places new-project and recent-project blocks around a single flat nav", async () => {
        const [sidebar, nav, projects] = await Promise.all([layoutFile("app-sidebar.tsx"), layoutFile("workspace-nav-list.tsx"), layoutFile("sidebar-projects.tsx")]);

        expect(sidebar).toContain("<SidebarNewProject expanded={expanded} />");
        expect(sidebar).toContain("footer={<SidebarRecentProjects expanded={expanded} />}");
        // 分组只用来定顺序，不再渲染小字标题；两种形态共用一份渲染
        expect(nav).toContain("FLAT_TOOLS");
        expect(nav).toContain("navigationGroups.flatMap");
        expect(nav).not.toContain("group.label");
        // 新建 = 画布项目；最近项目按视口高度在 3~8 条之间收敛
        expect(projects).toContain("createCanvasProject({ title: \"未命名画布\" })");
        expect(projects).toContain("MAX_RECENT_PROJECTS = 8");
        expect(projects).toContain("listCanvasProjectSummaries({ page: 1, pageSize: MAX_RECENT_PROJECTS })");
        expect(projects).toContain("saveCanvasProjectMutation");
        expect(projects).toContain("deleteCanvasProjects([project.id])");
    });

    it("renders the workspace nav from one implementation instead of two copies", async () => {
        const [sidebar, mobile, nav] = await Promise.all([layoutFile("app-sidebar.tsx"), layoutFile("mobile-nav-drawer.tsx"), layoutFile("workspace-nav-list.tsx")]);

        // 两侧只留容器，导航条目统一由 workspace-nav-list 渲染。
        // 以前各写一遍 map + active + 外链分支，加一个导航项要改两个文件，
        // 参数也已经各自漂移（分组间距、字号、选中指示）。
        expect(sidebar).toContain('<WorkspaceNavList variant="rail"');
        expect(mobile).toContain('<WorkspaceNavList variant="drawer"');
        expect(sidebar).not.toContain("navigationTools");
        expect(mobile).not.toContain("navigationTools");
        expect(sidebar).not.toContain("navigationGroups");
        expect(mobile).not.toContain("navigationGroups");
        // 有意的差异集中在一张表里，想对齐就改一处；选中态只用浅底不再加圆点
        expect(nav).toContain('items: "space-y-0.5"');
        expect(nav).toContain("activeItem: \"bg-[var(--surface-inset)] text-[var(--ink-1)]\"");
        expect(nav).toContain("activeItem: \"font-semibold text-[var(--brand-600)]\"");
        // 抽屉底部的非导航条目（个人中心 / 官网首页）复用同一套条目样式
        expect(mobile).toContain("drawerNavItemClass");
    });

    it("puts the collapse toggle in the sidebar brand row instead of the header", async () => {
        const [shell, sidebar] = await Promise.all([layoutFile("app-workspace-shell.tsx"), layoutFile("app-sidebar.tsx")]);

        // 顶栏左上角只保留移动端的菜单键与 logo；桌面端的页面标题和折叠按钮都已移走
        expect(shell).not.toContain("PAGE_TITLES");
        expect(shell).not.toContain("pageTitle");
        expect(shell).toContain("onToggleExpanded={toggleSidebarExpanded}");

        // 开关在侧栏品牌行右侧；收起态不再占一行，折叠图标平时透明、悬停品牌图标才换出来
        expect(sidebar).toContain("SidebarToggle");
        expect(sidebar).toContain("justify-between gap-2 pl-5 pr-3");
        expect(sidebar).toContain("group-hover:opacity-0");
        expect(sidebar).toContain("group-hover:opacity-100");
        expect(sidebar).not.toContain("self-center");
        // 图标用最简的 PanelLeft，不再用带箭头的两枚
        expect(sidebar).toContain("PanelLeft");
        expect(sidebar).not.toContain("PanelLeftClose");
        expect(sidebar).not.toContain("PanelLeftOpen");
    });

    it("gives the composer and panels a visible edge on the white canvas", async () => {
        const [shellCss, surfacesCss] = await Promise.all([stylesFile("global-app-shell.css"), stylesFile("global-surfaces.css")]);

        // 画布改纯白后，白输入框/白卡片与页面同色（实测输入框内 L=251、页面 L=252），
        // 边界只能靠描边：输入框用 outline（不动组件自己按聚焦态切换的 box-shadow），
        // 面板用内描边，6.5% 仍然看不清，已提到 9.5%。
        expect(shellCss).toContain("outline: 1px solid rgba(17, 17, 19, 0.09);");
        expect(shellCss).toContain("outline-offset: -1px;");
        // 深色态黑线等于没有，要换浅色
        expect(shellCss).toContain("outline-color: rgba(255, 255, 255, 0.08);");
        expect(surfacesCss).toContain("inset 0 0 0 1px rgba(17, 17, 19, 0.095)");
    });

    it("keeps the content surface lighter than the rail in light mode", async () => {
        const css = await stylesFile("global-surfaces.css");
        const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));

        // 内容是主体，应该最亮；侧栏退一档灰做分区。之前是反的（页面 #f8f9fa、侧栏纯白），
        // 视觉重心落在导航上，整页还像蒙了一层灰。这里只锁「谁比谁亮」，不锁具体色值，
        // 方便以后微调色号而不用改测试。
        const read = (token: string) => new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i").exec(lightBlock)?.[1];
        const brightness = (hex: string) => hex.slice(1).match(/../g)!.reduce((sum, part) => sum + Number.parseInt(part, 16), 0);

        const canvas = read("--surface-canvas");
        const rail = read("--surface-rail");
        expect(canvas).toBeDefined();
        expect(rail).toBeDefined();
        expect(brightness(canvas!)).toBeGreaterThan(brightness(rail!));
    });

    it("keeps sidebar links readable in dark mode despite antd's unlayered anchor rule", async () => {
        const css = await stylesFile("global-surfaces.css");

        // antd 的无层级 a{color} 在深色态等于侧栏底色，整排文字会隐形；
        // 覆盖规则必须写在 @layer 之外并按 ink 令牌取色。
        expect(css).toContain(".workspace-shell aside a {");
        expect(css).toContain(".workspace-shell aside a:hover,");
        expect(css).toContain("color: var(--ink-2);");
        expect(css).toContain("color: var(--ink-1);");
        // 底色同样会被 antd reset 的 a{background-color:transparent} 压掉，
        // 实测当前页算出来是 rgba(0,0,0,0)：只有文字变深、没有灰底，几乎看不出选中。
        // 只挑导航条目与底部账号入口，顶部 logo 链接不能跟着出现灰块。
        expect(css).toContain('.workspace-shell aside nav a[aria-current="page"],');
        expect(css).toContain(".workspace-shell aside > div a[aria-current=\"page\"] {");
        expect(css).toContain("background-color: var(--surface-inset);");
    });

    it("keeps the mobile nav drawer readable despite antd's unlayered anchor rules", async () => {
        const [drawer, nav, css] = await Promise.all([layoutFile("mobile-nav-drawer.tsx"), layoutFile("workspace-nav-list.tsx"), stylesFile("global-surfaces.css")]);

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
        // 条目配色改用令牌，不再手抄灰阶（头像渐变由页面域统一维护，不在此断言范围）
        expect(nav).toContain("bg-[var(--surface-inset)]");
        expect(nav).toContain("text-[var(--ink-2)]");
        expect(nav).not.toContain("#697381");
        expect(nav).not.toContain("#9aa2ad");
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
