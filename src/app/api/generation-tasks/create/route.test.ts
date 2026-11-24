import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), image: vi.fn(), video: vi.fn(), audio: vi.fn(), text: vi.fn(), stored: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/app/api/image-tasks/route", () => ({ POST: mocks.image }));
vi.mock("@/app/api/video-generation-tasks/video-generation-route", () => ({ POST: mocks.video }));
vi.mock("@/app/api/audio-tasks/route", () => ({ POST: mocks.audio }));
vi.mock("@/app/api/text-tasks/route", () => ({ POST: mocks.text }));
vi.mock("@/lib/server/image-task-store", () => ({ getImageTask: mocks.stored }));
vi.mock("@/lib/server/video-task-store", () => ({ getVideoTask: mocks.stored }));
vi.mock("@/lib/server/audio-task-store", () => ({ getAudioTask: mocks.stored }));
vi.mock("@/lib/server/text-task-store", () => ({ getTextTask: mocks.stored }));

import { POST } from "./route";

const token = (expiresAt = Date.now() + 60_000) => Buffer.from(JSON.stringify({ confirmation: "signed-by-existing-video-handler", expiresAt, points: 12 })).toString("base64url");
const request = (body: unknown) => new Request("http://localhost/api/generation-tasks/create", { method: "POST", headers: { cookie: "session", "x-vozeb-pro-client-request-id": "request-one" }, body: JSON.stringify(body) });

describe("unified generation creation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.mockResolvedValue({ id: "user" });
        mocks.stored.mockResolvedValue({ billing: { pointsCost: 4 } });
        for (const handler of [mocks.image, mocks.video, mocks.audio, mocks.text]) handler.mockImplementation(async () => Response.json({ task: { id: "task", status: "pending" } }));
    });

    it.each(["image", "video", "audio", "text"] as const)("reuses %s handler and preserves request credentials and identity", async kind => {
        const response = await POST(request({ kind, input: { prompt: "hello", context: { clientRequestId: "request-one" } }, ...(kind === "video" ? { quoteToken: token() } : {}) }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ ok: true, data: { task: { id: "task", taskId: "task", kind, status: "pending", power: 4 } }, traceId: expect.any(String) });
        const forwarded = mocks[kind].mock.calls[0][0] as Request;
        expect(forwarded.headers.get("cookie")).toBe("session");
        expect(forwarded.headers.get("x-vozeb-pro-client-request-id")).toBe("request-one");
        expect(await forwarded.json()).toMatchObject({ prompt: "hello", context: { clientRequestId: "request-one" } });
    });

    it("preserves uncertain submission 202, needsReview and warning instead of retrying", async () => {
        mocks.video.mockResolvedValue(Response.json({ task: { id: "task", status: "running", needsReview: true }, warning: "检查原任务" }, { status: 202 }));
        const response = await POST(request({ kind: "video", input: {}, quoteToken: token() }));
        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({ data: { task: { needsReview: true }, warning: "检查原任务" } });
        expect(mocks.video).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, "bad-token", token(1)])("rejects missing, malformed or expired quote before dispatch", async quoteToken => {
        expect((await POST(request({ kind: "video", input: {}, quoteToken }))).status).toBe(409);
        expect(mocks.video).not.toHaveBeenCalled();
    });

    it("does not allow quote controls to bypass creation and propagates downstream conflict", async () => {
        mocks.video.mockImplementation(async (forwarded: Request) => {
            const body = await forwarded.json();
            expect(body.quoteOnly).toBeUndefined();
            expect(body.quoteItems).toBeUndefined();
            expect(body.expectedQuote.confirmation).toBe("signed-by-existing-video-handler");
            return Response.json({ error: "报价已变化" }, { status: 409 });
        });
        const response = await POST(request({ kind: "video", input: { quoteOnly: true, quoteItems: [], expectedQuote: {} }, quoteToken: token() }));
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ ok: false, error: { code: "QUOTE_OR_REQUEST_CONFLICT" } });
    });

    it("does not turn a post-submit billing read error into another creation", async () => {
        mocks.stored.mockRejectedValue(new Error("offline"));
        expect((await (await POST(request({ kind: "image", input: {} }))).json()).data.task.power).toBeNull();
        expect(mocks.image).toHaveBeenCalledTimes(1);
    });

    it("keeps rate-limit status and retry-after", async () => {
        mocks.image.mockResolvedValue(Response.json({ error: "稍后重试" }, { status: 429, headers: { "Retry-After": "20" } }));
        const response = await POST(request({ kind: "image", input: {} }));
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("20");
    });

    it("validates auth, kind, input and unsupported quote tokens", async () => {
        expect((await POST(request({ kind: "other", input: {} }))).status).toBe(400);
        expect((await POST(request({ kind: "image", input: [] }))).status).toBe(400);
        expect((await POST(request({ kind: "audio", input: {}, quoteToken: token() }))).status).toBe(400);
        mocks.user.mockResolvedValue(null);
        expect((await POST(request({ kind: "image", input: {} }))).status).toBe(401);
    });
});
