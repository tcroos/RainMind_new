import path from "node:path";
import { generationRuntimeEnvironment, superviseGenerationRuntime } from "./generation-runtime.mjs";

const runtime = generationRuntimeEnvironment({ environment: { ...process.env, HOSTNAME: "127.0.0.1", VOZEB_PRO_INTERNAL_ORIGIN: `http://127.0.0.1:${process.env.PORT}` } });
process.exitCode = await superviseGenerationRuntime({
    app: { command: process.execPath, args: ["node_modules/next/dist/bin/next", "start", "-p", process.env.PORT], cwd: process.cwd() },
    workerScript: path.join(process.cwd(), "scripts/generation-worker.mjs"),
    environment: runtime.environment,
});
