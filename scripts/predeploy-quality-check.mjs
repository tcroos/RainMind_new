import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const checks = [];
for (const [name, args] of [["unit", ["node_modules/vitest/vitest.mjs", "run"]], ["protocol", ["node_modules/vitest/vitest.mjs", "run", "scripts/protocol-fixture-server.test.mjs", "src/lib/server/active-protocol-media-matrix.live.test.ts", "src/lib/server/active-protocol-media-proxy-matrix.live.test.ts", "src/lib/server/protocol-media-matrix.live.test.ts", "src/lib/server/protocol-model-catalog.live.test.ts"]]]) {
 console.log(`Starting ${name}`);
 const result = spawnSync(process.execPath, args, { stdio: "inherit" });
 checks.push({ name, status: result.status });
 writeFileSync(".predeploy-quality-result.json", JSON.stringify(checks));
 if (result.status !== 0) break;
}
