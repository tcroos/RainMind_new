import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ambientCss = () => readFile(resolve(process.cwd(), "src/app/styles/global-create-ambient.css"), "utf8");

describe("create page background", () => {
    it("paints the backdrop from the shell so it reaches the top edge", async () => {
        const shell = await readFile(resolve(process.cwd(), "src/components/layout/app-workspace-shell.tsx"), "utf8");
        const page = await readFile(resolve(process.cwd(), "src/app/(user)/create/page.tsx"), "utf8");

        // 背景挂在外壳上：页头是透明的，画在 <main> 里只能从页头下沿开始，会留一道横缝
        expect(shell).toContain('rootSlug === "create"');
        expect(shell).toContain('className="create-ambient"');
        // 外壳必须隔离成层叠上下文，背景走 z-index:-1 才能压在内容之下
        expect(shell).toContain("relative isolate");
        // 页面自己不再画这一层，避免叠两层
        expect(page).not.toContain('className="create-ambient"');
        expect(page).toContain("<CreateDotField />");
    });

    it("keeps the backdrop flat in both themes", async () => {
        const css = await ambientCss();
        const globals = await readFile(resolve(process.cwd(), "src/app/globals.css"), "utf8");

        expect(globals).toContain("./styles/global-create-ambient.css");
        expect(css).toContain(".create-ambient {");
        expect(css).toContain("z-index: -1");
        expect(css).toContain("position: absolute");
        expect(css).toContain("background-color: var(--surface-canvas);");

        // 只允许纯色底。任何 background-image（光池 / 竖向渐变 / 暗角 / 胶片颗粒）
        // 都会让静态截图出现「顶部有一团光」——深色态尤其明显，顶部被抬亮后
        // 和底部近黑之间拉出一条明暗过渡带。层次交给控件自己的描边与落影。
        expect(css).not.toContain("background-image");
        expect(css).not.toContain("radial-gradient");
        expect(css).not.toContain("feTurbulence");
        expect(css).not.toContain(".dark .create-ambient");
        expect(css).not.toContain("create-ambient-breathe");
        expect(css).not.toContain("::before");
        expect(css).not.toContain("::after");
    });

    it("keeps the dot ripple as the only moving layer, and it stays local to the cursor", async () => {
        const css = await ambientCss();
        const dotField = await readFile(resolve(process.cwd(), "src/app/(user)/create/components/create-dot-field.tsx"), "utf8");

        // 点阵是唯一的动态层；它只在光标半径内显形，静态不画任何像素（见 create-dot-field.tsx）
        expect(css).toContain(".create-dot-field {");
        expect(css).toContain("mask-image: linear-gradient(180deg");
        expect(css).toContain("transparent 100%");
        expect(dotField).toContain("create-dot-field pointer-events-none");
        expect(dotField).toContain("[--create-dot-rgb:226_103_31]");
        expect(dotField).toContain("const RADIUS = 150;");
        // 显形量从 0 起算：没有常驻底纹，静态不会出现满屏点阵
        expect(dotField).toContain("const REVEAL_ALPHA = 0.16;");
        expect(dotField).not.toContain("const BASE_ALPHA");
        expect(dotField).toContain("let alpha = 0;");
        expect(dotField).toContain("if (alpha <= 0) continue;");

        // 卡面暖光与背景无关，属面板质感，仍收窄在左上角一小团
        const surfaces = await readFile(resolve(process.cwd(), "src/app/styles/global-surfaces.css"), "utf8");
        expect(surfaces).toContain("radial-gradient(72% 110% at 6% -24%");
        expect(surfaces).toContain("rgba(240, 128, 58, 0.045)");
    });
});
