"use client";

import { useEffect, useRef } from "react";

/**
 * 点距（CSS px）：实测 moss 的底纹是 12px 一格、2×2px 的点，
 * 所以这里对齐 12px，避免点距被读成"屏幕脏了"。
 */
const SPACING = 12;
/** 光标影响半径：半径之外只有静止的底纹。
 * 从 340 收到 150 —— 原来那档会在内容区里压出一块边界明显的大圆点斑，
 * 比「涟漪」更像「脏块」；150px 大约只有输入区宽度的五分之一，读起来才是一圈水波。 */
const RADIUS = 150;
/** 波数（rad/px）：波长 = 2π / WAVE_NUMBER ≈ 140px，
 * 半径收小后同步缩短波长，保证小范围内仍能看到 1~2 圈波纹 */
const WAVE_NUMBER = 0.045;
/** 波速（rad/s）：波峰以 WAVE_SPEED / WAVE_NUMBER ≈ 160px/s 向外推进 */
const WAVE_SPEED = 5.6;
/** 最大径向位移（px）：靠挤密/拉疏读出波浪，而不是靠忽明忽暗 */
const MAX_PUSH = 9;
/** 光标半径内点阵的可见度（0~1）。
 * 这里原来是 BASE_ALPHA = 0.09：每一格都常驻画一层底纹，静态停留（或截图）时能看到
 * 满屏点阵，读起来像「屏幕脏了」。现在底纹归零，只有指针半径内才把点显出来，
 * 指针离开或能量衰减完就彻底消失。数值比原来的底纹高，因为只在局部出现、需要看得见。 */
const REVEAL_ALPHA = 0.16;

/**
 * 跟随光标的点阵涟漪。
 * - **静态不画点**：整片点阵只在光标 RADIUS 内显形，指针离开或停在页面之外时
 *   完全消失 —— 之前每格都常驻一层 9% 底纹，静止时像「屏幕脏了」；
 * - 指针悬停时保留一块局部纹理（基础档 0.4），移动时被波推着走到满值；
 * - canvas 上有 `.create-dot-field` 蒙版，点阵只在上半屏可见、向下柔和淡出，
 *   所以不会在项目卡片 / 灵感区里读出一块边界生硬的亮斑；
 * - 点的颜色统一，波浪完全由 sin(距离 - 时间) 的径向位移产生，
 *   所以看到的是"点被推着走"的疏密带，而不是随机明暗的噪点；
 * - 指针停住后能量衰减到 0、涟漪停下，rAF 同时停下，不常驻占用主线程。
 */
export function CreateDotField() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

        let width = 0;
        let height = 0;
        let dpr = 1;
        let color = { r: 32, g: 36, b: 42 };
        /** 扁平存放的格点坐标：x0, y0, x1, y1 ... */
        let grid: Float32Array = new Float32Array(0);

        let raf = 0;
        let lastTs = 0;
        let pointerX = 0;
        let pointerY = 0;
        let targetX = 0;
        let targetY = 0;
        let energy = 0;
        let presence = 0;
        let inside = false;

        const readColor = () => {
            const raw = getComputedStyle(canvas).getPropertyValue("--create-dot-rgb").trim();
            if (!raw) return;
            const parts = raw.split(/[\s,]+/).map(Number);
            if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
                color = { r: parts[0], g: parts[1], b: parts[2] };
            }
        };

        const layout = () => {
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, Math.round(rect.width));
            height = Math.max(1, Math.round(rect.height));
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const cols = Math.max(1, Math.floor(width / SPACING));
            const rows = Math.max(1, Math.floor(height / SPACING));
            const offsetX = (width - (cols - 1) * SPACING) / 2;
            const offsetY = (height - (rows - 1) * SPACING) / 2;
            grid = new Float32Array(cols * rows * 2);
            let index = 0;
            for (let row = 0; row < rows; row += 1) {
                for (let col = 0; col < cols; col += 1) {
                    grid[index] = offsetX + col * SPACING;
                    grid[index + 1] = offsetY + row * SPACING;
                    index += 2;
                }
            }
        };

        // 整页点阵都由 canvas 画：只在光标附近显形，靠近时被波推着走。
        // 不再叠一层 CSS 点阵，否则两套点会互相错位、看起来发脏。
        const paint = (seconds: number) => {
            ctx.clearRect(0, 0, width, height);
            const radiusSquared = RADIUS * RADIUS;
            /* 只看指针在不在，不再要求「有能量」：指针停住时能量会衰减到 0，
             * 若拿能量当开关，停下来那一小块也会跟着消失，手感变成「一动才有一点」。 */
            const active = presence > 0.004;
            ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;

            for (let index = 0; index < grid.length; index += 2) {
                const baseX = grid[index];
                const baseY = grid[index + 1];
                let x = baseX;
                let y = baseY;
                /* 底纹归零：不在光标半径内的点一律不画（alpha 为 0 直接跳过，
                 * 顺带省掉大量 fillRect —— 一屏几千个点里绝大多数本来都是白画的）。 */
                let alpha = 0;
                let size = 1.2;

                if (active) {
                    const dx = baseX - pointerX;
                    const dy = baseY - pointerY;
                    const distanceSquared = dx * dx + dy * dy;
                    if (distanceSquared <= radiusSquared) {
                        const distance = Math.sqrt(distanceSquared) || 0.001;
                        const ratio = distance / RADIUS;
                        // 只在最外圈羽化；收得更早一点，边界才不会读出硬边
                        const edge = ratio < 0.62 ? 1 : Math.max(0, 1 - (ratio - 0.62) / 0.38);
                        const feather = edge * edge;
                        const phase = distance * WAVE_NUMBER - seconds * WAVE_SPEED;
                        const push = Math.sin(phase) * feather * energy * MAX_PUSH;
                        x += (dx / distance) * push;
                        y += (dy / distance) * push;

                        // 波峰：点被推得略大、略亮，和挤密一起强化"鼓起来"的观感
                        const crest = (Math.cos(phase) + 1) / 2;
                        const strength = presence * feather;
                        /* 指针还在时保留一块局部纹理（基础档 0.4），移动把它推到满值；
                         * 指针离开后 presence 归零，整片点连着涟漪一起淡掉。 */
                        alpha = REVEAL_ALPHA * strength * (0.4 + 0.6 * energy) * (0.55 + 0.45 * crest);
                        size += strength * energy * (0.25 + crest * 0.7);
                    }
                }

                if (alpha <= 0) continue;

                ctx.globalAlpha = Math.min(1, alpha);
                ctx.fillRect(x - size / 2, y - size / 2, size, size);
            }
            ctx.globalAlpha = 1;
        };

        const tick = (timestamp: number) => {
            const delta = lastTs ? Math.min((timestamp - lastTs) / 1000, 0.05) : 1 / 60;
            lastTs = timestamp;

            const follow = 1 - Math.pow(0.0004, delta);
            pointerX += (targetX - pointerX) * follow;
            pointerY += (targetY - pointerY) * follow;
            presence += ((inside ? 1 : 0) - presence) * Math.min(1, delta * 9);
            energy = Math.max(0, energy - delta * 0.6);

            paint(timestamp / 1000);

            const settled = energy <= 0.002 && Math.abs(presence - (inside ? 1 : 0)) < 0.004;
            if (settled) {
                raf = 0;
                lastTs = 0;
                return;
            }
            raf = window.requestAnimationFrame(tick);
        };

        const start = () => {
            if (raf || reduceMotion) return;
            lastTs = 0;
            raf = window.requestAnimationFrame(tick);
        };

        const onPointerMove = (event: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const nextInside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
            if (!inside && nextInside) {
                // 首次进入时直接落位，避免从旧坐标滑过来
                pointerX = x;
                pointerY = y;
            }
            targetX = x;
            targetY = y;
            inside = nextInside;
            if (nextInside) energy = 1;
            start();
        };

        const onPointerLeave = () => {
            inside = false;
            start();
        };

        const observer = new ResizeObserver(() => {
            layout();
            pointerX = targetX;
            pointerY = targetY;
            paint(performance.now() / 1000);
        });
        observer.observe(canvas);

        const themeObserver = new MutationObserver(() => {
            readColor();
            paint(performance.now() / 1000);
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

        readColor();
        layout();
        paint(0);

        if (!coarsePointer && !reduceMotion) {
            window.addEventListener("pointermove", onPointerMove, { passive: true });
            document.addEventListener("pointerleave", onPointerLeave);
            window.addEventListener("blur", onPointerLeave);
        }

        return () => {
            if (raf) window.cancelAnimationFrame(raf);
            observer.disconnect();
            themeObserver.disconnect();
            window.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerleave", onPointerLeave);
            window.removeEventListener("blur", onPointerLeave);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden
            data-testid="create-dot-field"
            className="create-dot-field pointer-events-none absolute inset-0 h-full w-full [--create-dot-rgb:226_103_31] dark:[--create-dot-rgb:232_180_74]"
        />
    );
}
