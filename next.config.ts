import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { parseChangelog } from "@/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
/* 源码包存在两种目录布局：标准仓库的 web/ 子目录，以及本分支拍平后的仓库根目录。
 * 因此 VERSION / CHANGELOG.md 既可能在本目录，也可能在上一级；缺失时降级而不是启动即抛错。 */
const localVersion = readFirstText(["VERSION", "../VERSION"]).trim() || "dev";
const localChangelog = readFirstText(["CHANGELOG.md", "../CHANGELOG.md"]);
const configuredBuildCpus = Number.parseInt(process.env.NEXT_BUILD_CPUS || "", 10);
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const skipBuildTypeCheck = process.env.NEXT_SKIP_BUILD_TYPECHECK === "1";
const nodeProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const privatePageSource = "/:section(api|admin|assets|billing|canvas|community|create|drama|forgot-password|help|image|install|login|my-prompts|profile|prompts|register|video|works)/:path*";
if (nodeProxy) setGlobalDispatcher(new ProxyAgent(nodeProxy));

function readFirstText(candidates: string[]) {
    for (const candidate of candidates) {
        try {
            return readFileSync(resolve(webDir, candidate), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return "";
}

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;
    const isProduction = process.env.NODE_ENV === "production";
    const releases = parseChangelog(localChangelog);
    return {
        distDir,
        output: "standalone",
        outputFileTracingRoot: webDir,
        turbopack: { root: webDir },
        typescript: { ignoreBuildErrors: skipBuildTypeCheck },
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
            NEXT_PUBLIC_APP_RELEASES: JSON.stringify(releases),
        },
        experimental: {
            ...(Number.isSafeInteger(configuredBuildCpus) && configuredBuildCpus > 0 ? { cpus: configuredBuildCpus } : {}),
            proxyClientMaxBodySize: "220mb",
            /* antd 是桶导入：仓库里 176 个文件写着 `import { Button, Input } from "antd"`，
             * 打包器必须把整包的入口图解析一遍才知道每个符号在哪个文件。按需导入把它换成
             * 直指组件路径的 import，webpack / Turbopack 都能省掉这一大块解析与常驻内存。
             * Next 的默认优化清单里已经有 lucide-react，但没有 antd，所以这里要显式加。
             * （本仓库没用到 @ant-design/icons，就不加无用项。） */
            optimizePackageImports: ["antd"],
        },
        async rewrites() {
            return {
                beforeFiles: [{ source: "/favicon.ico", destination: "/api/site-icon" }],
                afterFiles: [],
                fallback: [],
            };
        },
        async headers() {
            return [
                {
                    source: "/(.*)",
                    headers: [
                        { key: "X-Content-Type-Options", value: "nosniff" },
                        { key: "X-Frame-Options", value: "DENY" },
                        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
                        ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
                    ],
                },
                {
                    source: privatePageSource,
                    headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" }],
                },
            ];
        },
    };
}
