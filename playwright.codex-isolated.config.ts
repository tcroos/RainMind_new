import path from "node:path";
import { fileURLToPath } from "node:url";

import baseConfig from "./playwright.config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const testRoot = process.cwd();
const port = Number(process.env.VOZEB_PRO_E2E_PORT || 3187);
const protocolFixturePort = Number(process.env.VOZEB_PRO_PROTOCOL_FIXTURE_PORT || 4187);
const paymentFixturePort = Number(process.env.VOZEB_PRO_PAYMENT_FIXTURE_PORT || 4287);
const baseAppEnv = baseConfig.webServer?.[2]?.env || {};

export default {
    ...baseConfig,
    testDir: path.join(webRoot, "e2e"),
    outputDir: path.join(testRoot, ".e2e-artifacts"),
    reporter: "list",
    use: { ...baseConfig.use, baseURL: `http://127.0.0.1:${port}`, channel: "chrome" },
    webServer: [
        {
            command: `node "${path.join(webRoot, "scripts", "protocol-fixture-server.mjs")}"`,
            cwd: webRoot,
            url: `http://127.0.0.1:${protocolFixturePort}/health`,
            timeout: 30_000,
            reuseExistingServer: false,
            env: { ...process.env, VOZEB_PRO_PROTOCOL_FIXTURE_PORT: String(protocolFixturePort) },
        },
        {
            command: `node "${path.join(webRoot, "scripts", "payment-fixture-server.mjs")}"`,
            cwd: webRoot,
            url: `http://127.0.0.1:${paymentFixturePort}/health`,
            timeout: 30_000,
            reuseExistingServer: false,
            env: { ...process.env, VOZEB_PRO_PAYMENT_FIXTURE_PORT: String(paymentFixturePort) },
        },
        {
            command: `"${process.execPath}" "${path.join(webRoot, "node_modules", "next", "dist", "bin", "next")}" dev --webpack -H 127.0.0.1 -p ${port}`,
            cwd: webRoot,
            url: `http://127.0.0.1:${port}/api/auth/session`,
            timeout: 120_000,
            reuseExistingServer: false,
            env: {
                ...baseAppEnv,
                PORT: String(port),
                NEXT_DIST_DIR: ".next-codex-e2e-20261023-1315",
                NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
                VOZEB_PRO_DATABASE_PROVIDER: "file",
                VOZEB_PRO_DATA_DIR: path.join(testRoot, ".e2e-data"),
                VOZEB_PRO_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                VOZEB_PRO_INSTALL_TOKEN: "vozeb-pro-e2e-install-token-32chars",
                VOZEB_PRO_MAINTENANCE_TOKEN: "vozeb-pro-e2e-maintenance-token-32chars",
                VOZEB_PRO_WORKER_TOKEN: "vozeb-pro-e2e-worker-token-separate-32chars",
                VOZEB_PRO_ALLOW_PRIVATE_UPSTREAMS: "1",
                VOZEB_PRO_PRIVATE_UPSTREAM_HOSTS: "127.0.0.1",
            },
        },
    ],
};
