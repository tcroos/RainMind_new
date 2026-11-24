import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), provider: vi.fn(), query: vi.fn(), file: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: mocks.provider, ensurePostgresSchema: vi.fn(), postgresQuery: mocks.query }));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.file }));
import { POST } from "./route";
const request = (ids: unknown) => new Request("http://localhost/api/generation-tasks/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "owner", role: "admin" }); mocks.provider.mockReturnValue("postgres"); });
describe("batch task progress API", () => {
    it("requires login and rejects empty/oversized/invalid ids", async () => {
        mocks.user.mockResolvedValueOnce(null);
        expect((await POST(request(["one"]))).status).toBe(401);
        for (const ids of [[], Array(21).fill("id"), [null], [" "]]) expect((await POST(request(ids))).status).toBe(400);
        expect(mocks.query).not.toHaveBeenCalled();
    });
    it("queries only the current user even for admins and returns missing entries separately", async () => {
        mocks.query.mockResolvedValue({ rows: [{ id: "one", kind: "image", status: "success", progress: null, task_id: "upstream", error: null, phase: "completed", result_count: 2 }] });
        const response = await POST(request(["one", "other-user", "one"]));
        const body = await response.json();
        expect(body.data.tasks).toHaveLength(2);
        expect(body.data.tasks[0]).toMatchObject({ status: "success", progressPercent: 100, resultCount: 2 });
        expect(body.data.tasks[1]).toMatchObject({ id: "other-user", notFound: true });
        expect(mocks.query.mock.calls[0][1]).toEqual(["owner", ["one", "other-user"]]);
        expect(body.data.tasks[0]).not.toHaveProperty("result");
        expect(mocks.query.mock.calls[0][0]).not.toContain("SELECT payload,");
    });
    it("file provider preserves review/cancelled states and hides foreign/expired tasks", async () => {
        mocks.provider.mockReturnValue("file");
        mocks.file.mockResolvedValue([
            { id: "review", userId: "owner", type: "video", status: "running", expiresAt: Date.now() + 10000, executionPhase: "needs_review", payload: {} },
            { id: "cancelled", userId: "owner", type: "audio", status: "cancelled", expiresAt: Date.now() + 10000, payload: {} },
            { id: "foreign", userId: "other", expiresAt: Date.now() + 10000, payload: {} },
            { id: "expired", userId: "owner", expiresAt: 0, payload: {} },
        ]);
        const body = await (await POST(request(["review", "cancelled", "foreign", "expired"]))).json();
        expect(body.data.tasks[0]).toMatchObject({ needsReview: true, status: "running" });
        expect(body.data.tasks[1].status).toBe("cancelled");
        expect(body.data.tasks.slice(2).every((t: { notFound: boolean }) => t.notFound)).toBe(true);
    });
});
