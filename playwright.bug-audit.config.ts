import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
    ...base,
    projects: base.projects?.map((project) => ({
        ...project,
        testMatch: project.name === "setup" ? /installation\.spec\.ts/ : /(?:bug-audit|core|responsive|canvas)\.spec\.ts/,
        use: { ...project.use, ...(process.env.BUG_AUDIT_BROWSER ? { launchOptions: { executablePath: process.env.BUG_AUDIT_BROWSER } } : {}) },
    })),
    webServer: (base.webServer as Array<Record<string, unknown>>).map((server, index) =>
        index === 2 ? { ...server, command: "node scripts/start-bug-audit.mjs", env: { ...(server.env as Record<string, string>), VOZEB_PRO_DATA_DIR: process.env.BUG_AUDIT_DATA_DIR || `${process.cwd()}/.e2e-bug-audit` } } : server,
    ),
});
