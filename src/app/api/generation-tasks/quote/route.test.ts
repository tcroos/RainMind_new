import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), video: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/app/api/video-generation-tasks/video-generation-route", () => ({ POST: mocks.video }));
import { POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/generation-tasks/quote", { method: "POST", body: JSON.stringify(body) });

describe("unified quote contract", () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "user" }); });
    it("uses video quoteOnly and preserves the complete signed quote in the opaque token", async () => {
        const quote = { points: 12, outputSeconds: 5, referenceSeconds: 0, totalSeconds: 5, expiresAt: Date.now() + 60_000, confirmation: "signature" };
        mocks.video.mockImplementation(async (forwarded: Request) => {
            const body = await forwarded.json();
            expect(body).toMatchObject({ config: { model: "video" }, quoteOnly: true });
            expect(body.quoteItems).toBeUndefined();
            return Response.json({ quote });
        });
        const response = await POST(request({ kind: "video", input: { config: { model: "video" }, quoteOnly: false, quoteItems: [{}] } }));
        const payload = await response.json();
        expect(payload).toMatchObject({ ok: true, data: { quote: { kind: "video", power: 12, breakdown: quote, expiresAt: quote.expiresAt } } });
        expect(JSON.parse(Buffer.from(payload.data.quote.quoteToken, "base64url").toString())).toEqual(quote);
    });
    it.each(["image", "audio", "text"])("does not invent %s pricing", async kind => {
        const response = await POST(request({ kind, input: {} }));
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ error: { code: "QUOTE_NOT_SUPPORTED" } });
        expect(mocks.video).not.toHaveBeenCalled();
    });
    it("returns downstream quote errors and auth errors", async () => {
        mocks.video.mockResolvedValue(Response.json({ error: "参考无效" }, { status: 400 }));
        expect((await POST(request({ kind: "video", input: {} }))).status).toBe(400);
        mocks.user.mockResolvedValue(null);
        expect((await POST(request({ kind: "video", input: {} }))).status).toBe(401);
    });
});
