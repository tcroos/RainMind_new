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
 * 这里给一个够用的下限；外部已经显式设置 max-old-space-size 时不覆盖。 */
const heapOption = "--max-old-space-size=4096";
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
