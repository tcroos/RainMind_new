import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const results = [];
for (const [label, entry, args] of [
    ["tests", "node_modules/vitest/vitest.mjs", ["run"]],
    ["build", "scripts/production-build.mjs", []],
]) {
    console.log(`\nStarting ${label}`);
    const result = spawnSync(process.execPath, [entry, ...args], { stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: ".next-canvas-interaction" } });
    results.push({ label, status: result.status, error: result.error?.message });
    writeFileSync(".canvas-interaction-check.json", JSON.stringify(results));
    if (result.status !== 0) break;
}
process.exitCode = results.some((result) => result.status !== 0) ? 1 : 0;
