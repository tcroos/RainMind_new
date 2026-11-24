/**
 * 画布色盘：12 款（浅色 6 / 深色 6）。
 *
 * 只负责「底色 + 底纹 + 连线 + 文字」这几项跟背景强相关的颜色，
 * 节点材质、工具栏等其余 token 仍由 canvasThemes 提供，避免两套主题源打架。
 */

export type CanvasPaletteMode = "light" | "dark";

export interface CanvasPalette {
    id: string;
    mode: CanvasPaletteMode;
    name: string;
    /** 色板上的圆形色块 */
    swatch: string;
    /** 画布底色（CSS 渐变） */
    background: string;
    /** 点阵底纹色 */
    dot: string;
    /** 网格底纹色 */
    line: string;
    edge: string;
    edgeActive: string;
    textPrimary: string;
    textMuted: string;
    /* ── 悬浮 UI 面板：吸附当前色盘色温，避免中性黑面板浮在有色画布上 ── */
    panelBg: string;
    panelBorder: string;
    panelShadow: string;
    /** 贴边大面板用的高不透明底色（资产面板这类内容密集区域） */
    surfaceBg: string;
    /* ── 节点玻璃材质（纯中性无色，只靠明度梯度与内倒角立体积） ── */
    nodeBg: string;
    nodeRim: string;
    nodeShadow: string;
    /** 镜面聚光：中心色 / 过渡色。坐标由 CSS 在使用处解析，不能写进 token 值 */
    spotHighlight: string;
    spotMid: string;
    nodeShimmer: string;
    /** 额外物理锁边（极简瓷白等亮底需要用冷灰细环把边界钉住） */
    nodeLockRing: string;
}

/* ── 节点 10 玻璃材质：按明暗两套共享，色盘只覆盖底色相关项 ────────────
 * 关键点：全部是纯中性白/黑，不含任何色相，视觉色差完全来自背后画布。
 */
const LIGHT_NODE = {
    nodeBg: "#eef6fb",
    nodeRim: "linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.42) 46%, rgba(255, 255, 255, 0.16) 100%)",
    /* 顶部 1.5px 内倒角高光 + 底部内阴影暗角 + 外环境投影 */
    nodeShadow: "inset 0 1.5px 1px rgba(255, 255, 255, 0.85), 0 16px 34px -10px rgba(15, 23, 42, 0.12)",
    spotHighlight: "rgba(255, 255, 255, 0.52)",
    spotMid: "rgba(255, 255, 255, 0.12)",
    nodeShimmer: "rgba(255, 255, 255, 0.62)",
    nodeLockRing: "none",
    panelBg: "rgba(255, 255, 255, 0.82)",
    panelBorder: "rgba(255, 255, 255, 0.86)",
    panelShadow: "0 20px 44px -22px rgba(15, 23, 42, 0.34), 0 2px 8px rgba(15, 23, 42, 0.06)",
    surfaceBg: "rgba(255, 255, 255, 0.95)",
} as const;

const DARK_NODE = {
    nodeBg: "#202023",
    nodeRim: "linear-gradient(145deg, rgba(255, 255, 255, 0.62) 0%, rgba(255, 255, 255, 0.22) 46%, rgba(255, 255, 255, 0.08) 100%)",
    nodeShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.30), 0 20px 42px -12px rgba(0, 0, 0, 0.45)",
    spotHighlight: "rgba(255, 255, 255, 0.26)",
    spotMid: "rgba(186, 230, 253, 0.05)",
    nodeShimmer: "rgba(186, 230, 253, 0.30)",
    nodeLockRing: "none",
    panelBg: "rgba(28, 28, 32, 0.72)",
    panelBorder: "rgba(255, 255, 255, 0.16)",
    panelShadow: "0 22px 48px -20px rgba(0, 0, 0, 0.66)",
    surfaceBg: "rgba(28, 28, 32, 0.94)",
} as const;

/** 色盘的基础字段（材质字段由 mode 共享常量补齐） */
type CanvasPaletteBase = Pick<CanvasPalette, "id" | "mode" | "name" | "swatch" | "background" | "dot" | "line" | "edge" | "edgeActive" | "textPrimary" | "textMuted">;

const RAW_PALETTES: Record<CanvasPaletteMode, CanvasPaletteBase[]> = {
    light: [
        {
            id: "glacier",
            mode: "light",
            name: "冰川雾蓝",
            swatch: "#bfd1e3",
            background: "linear-gradient(145deg, #d7e3ef 0%, #bfd1e3 50%, #a5bed7 100%)",
            dot: "rgba(15, 23, 42, 0.16)",
            line: "rgba(15, 23, 42, 0.08)",
            edge: "rgba(15, 23, 42, 0.28)",
            edgeActive: "#0284c7",
            textPrimary: "#0f172a",
            textMuted: "rgba(15, 23, 42, 0.58)",
        },
        {
            id: "sage",
            mode: "light",
            name: "莫兰迪鼠尾草",
            swatch: "#bfd2c7",
            background: "linear-gradient(145deg, #d7e3dc 0%, #bfd2c7 50%, #a6bfb1 100%)",
            dot: "rgba(20, 35, 28, 0.16)",
            line: "rgba(20, 35, 28, 0.08)",
            edge: "rgba(20, 35, 28, 0.28)",
            edgeActive: "#0f766e",
            textPrimary: "#14231c",
            textMuted: "rgba(20, 35, 28, 0.58)",
        },
        {
            id: "iris",
            mode: "light",
            name: "烟熏鸢尾紫",
            swatch: "#c8c1da",
            background: "linear-gradient(145deg, #dfdbe9 0%, #c8c1da 50%, #b1a8c9 100%)",
            dot: "rgba(30, 24, 46, 0.16)",
            line: "rgba(30, 24, 46, 0.08)",
            edge: "rgba(30, 24, 46, 0.28)",
            edgeActive: "#6d28d9",
            textPrimary: "#1e182e",
            textMuted: "rgba(30, 24, 46, 0.58)",
        },
        {
            id: "mint",
            mode: "light",
            name: "海盐薄荷青",
            swatch: "#bad4d7",
            background: "linear-gradient(145deg, #d4e6e8 0%, #bad4d7 50%, #9fc1c5 100%)",
            dot: "rgba(14, 40, 44, 0.16)",
            line: "rgba(14, 40, 44, 0.08)",
            edge: "rgba(14, 40, 44, 0.28)",
            edgeActive: "#0e7490",
            textPrimary: "#0f262a",
            textMuted: "rgba(14, 40, 44, 0.58)",
        },
        {
            id: "mist",
            mode: "light",
            name: "静谧云雾蓝",
            swatch: "#c3cddc",
            background: "linear-gradient(145deg, #dbe2ec 0%, #c3cddc 50%, #abb8cb 100%)",
            dot: "rgba(20, 30, 46, 0.16)",
            line: "rgba(20, 30, 46, 0.08)",
            edge: "rgba(20, 30, 46, 0.28)",
            edgeActive: "#1d4ed8",
            textPrimary: "#141e2e",
            textMuted: "rgba(20, 30, 46, 0.58)",
        },
        {
            id: "white",
            mode: "light",
            name: "极简瓷白",
            swatch: "#f1f5f9",
            background: "linear-gradient(145deg, #f8fafc 0%, #f1f5f9 55%, #e8eef5 100%)",
            /* 瓷白底对比度天然低，底纹和连线都要加重一档 */
            dot: "rgba(15, 23, 42, 0.22)",
            line: "rgba(15, 23, 42, 0.11)",
            edge: "rgba(15, 23, 42, 0.36)",
            edgeActive: "#0369a1",
            textPrimary: "#0a1220",
            textMuted: "rgba(10, 18, 32, 0.62)",
        },
    ],
    dark: [
        {
            id: "aurora",
            mode: "dark",
            name: "午夜极光靛",
            swatch: "#0a2d66",
            background: "linear-gradient(135deg, #061539 0%, #0a2d66 48%, #156082 100%)",
            dot: "rgba(255, 255, 255, 0.16)",
            line: "rgba(255, 255, 255, 0.07)",
            edge: "rgba(255, 255, 255, 0.3)",
            edgeActive: "#38bdf8",
            textPrimary: "#f8fafc",
            textMuted: "rgba(248, 250, 252, 0.56)",
        },
        {
            id: "forest",
            mode: "dark",
            name: "森林暗松青",
            swatch: "#0f302d",
            background: "linear-gradient(135deg, #071918 0%, #0f302d 50%, #194a45 100%)",
            dot: "rgba(255, 255, 255, 0.15)",
            line: "rgba(255, 255, 255, 0.06)",
            edge: "rgba(255, 255, 255, 0.3)",
            edgeActive: "#34d399",
            textPrimary: "#f4faf7",
            textMuted: "rgba(244, 250, 247, 0.56)",
        },
        {
            id: "obsidian",
            mode: "dark",
            name: "深海曜石蓝",
            swatch: "#0f1c33",
            background: "linear-gradient(135deg, #070d19 0%, #0f1c33 52%, #192f52 100%)",
            dot: "rgba(255, 255, 255, 0.15)",
            line: "rgba(255, 255, 255, 0.06)",
            edge: "rgba(255, 255, 255, 0.3)",
            edgeActive: "#60a5fa",
            textPrimary: "#f6f9fc",
            textMuted: "rgba(246, 249, 252, 0.56)",
        },
        {
            id: "amethyst",
            mode: "dark",
            name: "暮色紫檀靛",
            swatch: "#1d1436",
            background: "linear-gradient(135deg, #0d091a 0%, #1d1436 50%, #2f2054 100%)",
            dot: "rgba(255, 255, 255, 0.15)",
            line: "rgba(255, 255, 255, 0.06)",
            edge: "rgba(255, 255, 255, 0.3)",
            edgeActive: "#a78bfa",
            textPrimary: "#f8f6fc",
            textMuted: "rgba(248, 246, 252, 0.56)",
        },
        {
            id: "basalt",
            mode: "dark",
            name: "暗夜玄武青",
            swatch: "#11232d",
            background: "linear-gradient(135deg, #081116 0%, #11232d 50%, #1b3847 100%)",
            dot: "rgba(255, 255, 255, 0.14)",
            line: "rgba(255, 255, 255, 0.06)",
            edge: "rgba(255, 255, 255, 0.28)",
            edgeActive: "#22d3ee",
            textPrimary: "#f2f8f9",
            textMuted: "rgba(242, 248, 249, 0.54)",
        },
        {
            id: "black",
            mode: "dark",
            name: "纯粹深黑",
            swatch: "#111114",
            background: "linear-gradient(145deg, #09090b 0%, #111114 55%, #18181b 100%)",
            dot: "rgba(255, 255, 255, 0.13)",
            line: "rgba(255, 255, 255, 0.05)",
            edge: "rgba(255, 255, 255, 0.26)",
            edgeActive: "#e2e8f0",
            textPrimary: "#fafafa",
            textMuted: "rgba(250, 250, 250, 0.52)",
        },
    ],
};

/**
 * 补全材质的最终色盘表。
 * - 节点玻璃材质按明暗两套共享，色盘只覆盖底色相关项
 * - 深色面板底色吸附各色盘主色相，避免中性黑浮在有色画布上
 * - 极简瓷白单独抬高面板对比度并加冷灰物理锁边
 */
export const CANVAS_PALETTES: Record<CanvasPaletteMode, CanvasPalette[]> = {
    light: RAW_PALETTES.light.map((item) => ({
        ...LIGHT_NODE,
        ...item,
        ...(item.id === "white"
            ? {
                  panelBg: "rgba(255, 255, 255, 0.88)",
                  panelBorder: "rgba(15, 23, 42, 0.09)",
                  panelShadow: "0 12px 32px -6px rgba(15, 23, 42, 0.10), 0 1px 3px rgba(15, 23, 42, 0.06)",
                  nodeLockRing: "none",
                  surfaceBg: "#ffffff",
              }
            : {}),
    })),
    dark: RAW_PALETTES.dark.map((item) => ({
        ...DARK_NODE,
        ...item,
        panelBg: DARK_NODE.panelBg,
        surfaceBg: DARK_NODE.surfaceBg,
    })),
};

export const DEFAULT_CANVAS_PALETTE_ID: Record<CanvasPaletteMode, string> = {
    light: "glacier",
    dark: "aurora",
};

/** 取色盘；id 不存在或模式不匹配时回退该模式的默认款 */
export function resolveCanvasPalette(mode: CanvasPaletteMode, id?: string | null): CanvasPalette {
    const list = CANVAS_PALETTES[mode];
    return list.find((item) => item.id === id) ?? list.find((item) => item.id === DEFAULT_CANVAS_PALETTE_ID[mode]) ?? list[0];
}

/** 注入到画布根节点的 CSS 变量，供背景/底纹/连线/文字统一取色 */
export function canvasPaletteVariables(palette: CanvasPalette): Record<string, string> {
    return {
        "--rm-canvas-bg": palette.background,
        "--rm-canvas-dot": palette.dot,
        "--rm-canvas-line": palette.line,
        "--rm-canvas-edge": palette.edge,
        "--rm-canvas-edge-active": palette.edgeActive,
        "--rm-canvas-text": palette.textPrimary,
        "--rm-canvas-text-muted": palette.textMuted,
        /* 悬浮面板：色温吸附 + 玻璃模糊 */
        "--rm-panel-bg": palette.panelBg,
        "--rm-panel-border": palette.panelBorder,
        "--rm-panel-shadow": palette.panelShadow,
        "--rm-surface-bg": palette.surfaceBg,
        /* 节点 10 玻璃材质 */
        "--rm-node-bg": palette.nodeBg,
        "--rm-node-rim": palette.nodeRim,
        "--rm-node-shadow": palette.nodeShadow,
        "--rm-spot-hi": palette.spotHighlight,
        "--rm-spot-mid": palette.spotMid,
        "--rm-node-shimmer": palette.nodeShimmer,
        "--rm-node-lock-ring": palette.nodeLockRing,
    };
}
