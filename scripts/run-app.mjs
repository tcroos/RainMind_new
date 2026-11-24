import path from "node:path";
import { fileURLToPath } from "node:url";

import { generationRuntimeEnvironment, superviseGenerationRuntime } from "./generation-runtime.mjs";

const mode = process.argv[2];
if (mode !== "dev") throw new Error("Usage: run-app.mjs dev");

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextEntry = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const runtime = generationRuntimeEnvironment({ allowEphemeralToken: true });
/* dev 模式下 Next 编译、两条 generation worker lane 与页面渲染挤在同一个 Node 进程里，
 * 实测常驻约 3GB，默认堆上限会在崩溃前先耗尽内存（表现为 exit 134 / heap out of memory）。
 * 这里给一个够用的下限；外部已经显式设置 max-old-space-size 时不覆盖。
 *
 * 为什么是 8192 而不是 4096：Next dev 在**每个请求结束后**都会检查
 *   used_heap_size > 0.8 * heap_size_limit
 * 一过线就 log「Server is approaching the used memory threshold, restarting...」
 * 然后 process.exit(77)，由外层 CLI 重新拉起（见 next/dist/server/lib/start-server.js）。
 * 4096 的 80% 是 3.24GB，而实测 heapUsed 已到 2.83GB、heapTotal 2.98GB、RSS 5.5GB
 * （.next-dev/dev/trace 的 311 条请求记录），几分钟就会撞线 ——
 * 表现就是「用着用着服务自己重启、内存里的编译结果全丢、下个请求从零编译」，
 * 于是又慢又卡还老重启。抬到 8GB 后触发线是 6.4GB，正常编译不会撞；
 * 真撞上说明是泄漏，那时重启才合理。机器 32GB、空闲 11GB，放得下。
 *
 * 若要彻底关掉这个自愈重启（比如为了抓泄漏），设 __NEXT_DISABLE_MEMORY_WATCHER=1。 */
const heapOption = "--max-old-space-size=8192";
const inheritedNodeOptions = runtime.environment.NODE_OPTIONS?.trim() || "";
const environment = {
    ...runtime.environment,
    NEXT_DIST_DIR: runtime.environment.NEXT_DIST_DIR?.trim() || ".next-dev",
    NODE_OPTIONS: inheritedNodeOptions.includes("max-old-space-size") ? inheritedNodeOptions : `${inheritedNodeOptions} ${heapOption}`.trim(),
};
if (runtime.ephemeralToken) console.log("Generated ephemeral maintenance and worker tokens for this local development process.");

process.exitCode = await superviseGenerationRuntime({
    app: { command: process.execPath, args: [nextEntry, "dev", "--webpack", "-H", "0.0.0.0", "-p", process.env.PORT || "3000"], cwd: webRoot },
    workerScript: path.join(webRoot, "scripts", "generation-worker.mjs"),
    environment,
});
