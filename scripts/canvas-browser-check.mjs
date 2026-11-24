import { spawnSync } from "node:child_process";
import net from "node:net";

async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return String(port);
}
const [appPort, protocolPort, paymentPort] = await Promise.all([freePort(), freePort(), freePort()]);
if (!process.env.CANVAS_SKIP_BUILD) {
    const build = spawnSync(process.execPath, ["scripts/production-build.mjs"], { stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: ".next-canvas-interaction" } });
    if (build.status !== 0) process.exit(build.status || 1);
}

const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.bug-audit.config.ts", "e2e/bug-audit.spec.ts", "--reporter=list,json", ...process.argv.slice(2)], {
    env: { ...process.env, BUG_AUDIT_BROWSER: "C:/Users/taofb/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe", PLAYWRIGHT_JSON_OUTPUT_FILE: ".canvas-browser-result.json", NEXT_DIST_DIR: ".next-canvas-interaction", VOZEB_PRO_E2E_PORT: appPort, VOZEB_PRO_PROTOCOL_FIXTURE_PORT: protocolPort, VOZEB_PRO_PAYMENT_FIXTURE_PORT: paymentPort, BUG_AUDIT_DATA_DIR: `${process.cwd()}/.e2e-canvas-interaction-${Date.now()}` },
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 20 * 1024 * 1024,
});
console.log(`Browser checks finished: ${result.status}`);
process.exitCode = result.status || 0;
