import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(),
    postgresQuery: vi.fn(),
    readJsonDataFile: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    getDatabaseProvider: mocks.getDatabaseProvider,
    postgresQuery: mocks.postgresQuery,
}));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.readJsonDataFile }));

import { countLocalMediaReferences } from "./local-media-references";

describe("countLocalMediaReferences", () => {
    beforeEach(() => vi.clearAllMocks());

    it("counts all requested keys with one PostgreSQL query", async () => {
        mocks.getDatabaseProvider.mockReturnValue("postgres");
        mocks.postgresQuery.mockResolvedValue({
            rows: [
                { storage_key: "permanent/one.png", total: "2" },
                { storage_key: "permanent/two.png", total: 0 },
            ],
        });

        const result = await countLocalMediaReferences(["permanent/one.png", "permanent/two.png", "permanent/one.png"]);

        expect(result).toEqual(
            new Map([
                ["permanent/one.png", 2],
                ["permanent/two.png", 0],
            ]),
        );
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        expect(mocks.postgresQuery).toHaveBeenCalledWith(expect.stringContaining("unnest($1::text[])"), [["permanent/one.png", "permanent/two.png"]]);
        const sql = String(mocks.postgresQuery.mock.calls[0]?.[0]);
        for (const table of [
            "creative_assets",
            "creative_messages",
            "creative_run_events",
            "library_assets",
            "canvas_projects",
            "drama_projects",
            "drama_project_versions",
            "generation_logs",
            "generation_log_assets",
            "generation_tasks",
            "published_work_assets",
        ])
            expect(sql).toContain(table);
    });

    it("keeps media referenced by another file-provider generation task", async () => {
        mocks.getDatabaseProvider.mockReturnValue("file");
        mocks.readJsonDataFile.mockImplementation(async (name: string, fallback: unknown) => (name === "generation-tasks.json" ? [{ id: "task-two", payload: { referenceUrl: "/api/reference-assets/permanent/shared.png" }, resultPayload: {} }] : fallback));

        const result = await countLocalMediaReferences(["permanent/shared.png", "permanent/unreferenced.png"]);

        expect(result).toEqual(
            new Map([
                ["permanent/shared.png", 1],
                ["permanent/unreferenced.png", 0],
            ]),
        );
    });

    it("counts a generation log asset that points at the reference-scope video as a reference", async () => {
        // BUG-088: in object storage mode the generation log now references the reference-scope
        // video instead of keeping its own generation-scope copy. Deleting that reference asset
        // must stay blocked while the log (or the task result) still points at it.
        const video = "permanent/2026/11/04/videos/20261104-080101-ee410162.mp4";
        mocks.getDatabaseProvider.mockReturnValue("file");
        mocks.readJsonDataFile.mockImplementation(async (name: string, fallback: unknown) => {
            if (name === "generation-logs.json") return { logs: [{ id: "log", assets: [{ type: "video", url: `/api/reference-assets/${video}`, serverUrl: `/api/reference-assets/${video}` }] }] };
            if (name === "generation-tasks.json") return [{ id: "task", payload: { result: { url: `/api/reference-assets/${video}` } }, resultPayload: {} }];
            return fallback;
        });

        const result = await countLocalMediaReferences([video]);

        expect(result.get(video)).toBe(2);
    });

    it("still counts a task whose result holds a legacy signed object URL", async () => {
        const video = "permanent/2026/11/04/videos/legacy.mp4";
        mocks.getDatabaseProvider.mockReturnValue("file");
        mocks.readJsonDataFile.mockImplementation(async (name: string, fallback: unknown) =>
            name === "generation-tasks.json" ? [{ id: "task", payload: { result: { url: `https://bucket.r2.cloudflarestorage.com/vozeb-pro/media/reference/${video}?X-Amz-Signature=abc` } }, resultPayload: {} }] : fallback,
        );

        const result = await countLocalMediaReferences([video]);

        expect(result.get(video)).toBe(1);
    });
});
