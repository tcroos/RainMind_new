/* 生成 public/profile-cover.svg（个人主页默认封面）：深海蓝渐变 + 等高线 + 细网格 + 柔光斑 + 颗粒。
 * 固定随机种子，保证可复现。
 * 导出位图（在浏览器里渲染后再压缩，比 librsvg 更接近设计稿）：
 *   1) 用 Chrome/Playwright 把 svg 截成 1600x400 的 png
 *   2) npx sharp: sharp('cover.png').webp({ quality: 82 }).toFile('public/profile-cover.webp')
 * 产物只有 webp 入库，svg 仅作源文件，不随应用发布。
 */

import { writeFileSync } from "node:fs";

/* 生成个人主页默认封面：深海蓝渐变 + 等高线 + 柔光斑 + 颗粒。
 * 固定随机种子保证每次生成结果一致，便于 review diff。 */

const W = 1600;
const H = 400;

let seed = 20261124;
const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};
const between = (min, max) => min + rand() * (max - min);

// 等高线：沿 x 轴采样若干正弦叠加，形成起伏的地形线
const contourPaths = [];
const LINES = 26;
for (let i = 0; i < LINES; i += 1) {
    const baseY = 20 + (i / (LINES - 1)) * (H - 20);
    const amp1 = between(8, 26);
    const amp2 = between(4, 14);
    const freq1 = between(0.004, 0.009);
    const freq2 = between(0.012, 0.021);
    const phase1 = between(0, Math.PI * 2);
    const phase2 = between(0, Math.PI * 2);
    const points = [];
    for (let x = 0; x <= W; x += 16) {
        const y = baseY + Math.sin(x * freq1 + phase1) * amp1 + Math.sin(x * freq2 + phase2) * amp2;
        points.push(`${x},${y.toFixed(1)}`);
    }
    const opacity = (0.06 + Math.abs(Math.sin(i * 0.7)) * 0.16).toFixed(3);
    const width = (0.9 + rand() * 0.7).toFixed(2);
    contourPaths.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#dbeafe" stroke-opacity="${opacity}" stroke-width="${width}" />`);
}

// 柔光斑：模拟海面反光
const blooms = [
    { cx: 240, cy: -40, rx: 520, ry: 300, color: "#bae6fd", opacity: 0.24 },
    { cx: 1180, cy: 40, rx: 460, ry: 260, color: "#a5b4fc", opacity: 0.2 },
    { cx: 820, cy: 400, rx: 620, ry: 240, color: "#0f172a", opacity: 0.34 },
]
    .map((b) => `<ellipse cx="${b.cx}" cy="${b.cy}" rx="${b.rx}" ry="${b.ry}" fill="${b.color}" opacity="${b.opacity}" filter="url(#soft)" />`)
    .join("\n        ");

// 陆块：低透明度不规则多边形，模仿卫星图里的地形块
const blobs = [];
for (let i = 0; i < 5; i += 1) {
    const cx = between(120, W - 120);
    const cy = between(-40, H + 40);
    const rx = between(110, 260);
    const ry = between(60, 130);
    const steps = 12;
    const pts = [];
    for (let s = 0; s < steps; s += 1) {
        const angle = (s / steps) * Math.PI * 2;
        const wobble = between(0.72, 1.18);
        pts.push(`${(cx + Math.cos(angle) * rx * wobble).toFixed(1)},${(cy + Math.sin(angle) * ry * wobble).toFixed(1)}`);
    }
    const opacity = between(0.08, 0.16).toFixed(3);
    blobs.push(`<polygon points="${pts.join(" ")}" fill="#e0f2fe" opacity="${opacity}" filter="url(#soft)" />`);
}

// 细网格：给整张图一个坐标系骨架，避免只有渐变显得空泛
const gridLines = [];
for (let x = 0; x <= W; x += 100) gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#e0f2fe" stroke-opacity="0.05" stroke-width="1" />`);
for (let y = 0; y <= H; y += 100) gridLines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#e0f2fe" stroke-opacity="0.05" stroke-width="1" />`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="presentation">
    <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#082f49" />
            <stop offset="38%" stop-color="#0e4d68" />
            <stop offset="72%" stop-color="#1e3a8a" />
            <stop offset="100%" stop-color="#312e81" />
        </linearGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="30" />
        </filter>
        <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
        </filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sea)" />
    <g>
        ${blobs.join("\n        ")}
    </g>
    <g>
        ${gridLines.join("\n        ")}
    </g>
    <g>
        ${contourPaths.join("\n        ")}
    </g>
    <g>
        ${blooms}
    </g>
    <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.09" />
    <rect width="${W}" height="${H}" fill="url(#vignette)" />
    <defs>
        <radialGradient id="vignette" cx="0.5" cy="0.4" r="0.75">
            <stop offset="55%" stop-color="#000" stop-opacity="0" />
            <stop offset="100%" stop-color="#000" stop-opacity="0.38" />
        </radialGradient>
    </defs>
</svg>
`;

writeFileSync("public/profile-cover.svg", svg, "utf8");
console.log("written", svg.length, "bytes");
