import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AdminGenerationTask } from "@/lib/admin-generation-operations";

import { BATCH_CLOSE_UNBILLED_URL, batchCloseBlocker, submitBatchCloseUnbilled } from "./batch-close-unbilled-model";
import { BatchCloseBar } from "./generation-operations-client";
import { chargeLabel, surfaceLabel } from "./generation-operations-labels";

const BATCH_ID = "11111111-2222-4333-8444-555555555555";

function task(overrides: Partial<AdminGenerationTask> = {}): AdminGenerationTask {
    return {
        id: "task-one",
        userId: "user-one",
        username: "user",
        displayName: "用户",
        type: "image",
        status: "running",
        surface: "canvas",
        attemptNo: 1,
        model: "gpt-image-1",
        channelId: "channel-a",
        executionPhase: "needs_review",
        leaseExpired: false,
        prompt: "",
        durationMs: 0,
        pointsCost: 0,
        charged: false,
        hasResult: false,
        createdAt: 1,
        updatedAt: 500,
        canCancel: true,
        canReview: true,
        ...overrides,
    };
}

function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(...responses: Response[]) {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
    for (const response of responses) fetcher.mockResolvedValueOnce(response);
    return fetcher;
}

function bar(selectedTasks: AdminGenerationTask[], loading = false) {
    return renderToStaticMarkup(
        <App>
            <BatchCloseBar selectedTasks={selectedTasks} loading={loading} onClose={() => undefined} onClear={() => undefined} />
        </App>,
    );
}

describe("labels", () => {
    it("labels charge evidence with the amount", () => {
        expect(chargeLabel(false)).toBe("未扣款");
        expect(chargeLabel(true, 12)).toBe("已扣款 12 积分");
        expect(chargeLabel(true)).toBe("已扣款");
        expect(surfaceLabel("canvas")).toBe("Canvas");
        expect(surfaceLabel(null)).toBe("专业工作台");
    });
});

describe("batch close eligibility", () => {
    it("allows only reviewable, uncharged, resultless tasks without an upstream id", () => {
        expect(batchCloseBlocker([task(), task({ id: "b" })])).toBeNull();
        expect(batchCloseBlocker([])).toBe("请先勾选任务");
        expect(batchCloseBlocker([task(), task({ id: "b", charged: true, chargedAmount: 3 })])).toContain("已扣款");
        expect(batchCloseBlocker([task({ hasResult: true })])).toContain("已有结果");
        expect(batchCloseBlocker([task({ upstreamTaskId: "up" })])).toContain("上游任务 ID");
        expect(batchCloseBlocker([task({ canReview: false })])).toContain("待人工确认");
        expect(batchCloseBlocker(Array.from({ length: 51 }, (_, index) => task({ id: `t${index}` })))).toContain("50");
    });

    it("disables the batch button when the selection holds a charged task", () => {
        expect(bar([task(), task({ id: "b", charged: true, chargedAmount: 3 })])).toMatch(/aria-label="批量关闭未扣款"[^>]*disabled=""/);
        expect(bar([task(), task({ id: "b", charged: true })])).toContain("含 1 条已扣款");
        expect(bar([])).toMatch(/aria-label="批量关闭未扣款"[^>]*disabled=""/);
        expect(bar([task()])).not.toMatch(/aria-label="批量关闭未扣款"[^>]*disabled=""/);
        expect(bar([task()], true)).toContain("ant-btn-loading");
    });

    it("offers no refund action", () => {
        expect(bar([task()])).not.toMatch(/退款<\/span>|批量退款/);
    });
});

describe("batch close submission", () => {
    it("posts every selected task with CAS tokens and reports success", async () => {
        const fetcher = mockFetch(jsonResponse(200, { code: 0, data: { batchRequestId: BATCH_ID, rejected: false, items: [{ type: "image", id: "task-one", outcome: "applied" }, { type: "video", id: "b", outcome: "applied" }], summary: { applied: 2, conflict: 0, notFound: 0, rejected: 0, failed: 0 } }, msg: "OK" }));

        const result = await submitBatchCloseUnbilled(fetcher, [task(), task({ id: "b", type: "video", attemptNo: undefined, updatedAt: 42 })], () => BATCH_ID);

        expect(result).toMatchObject({ kind: "applied", problems: [] });
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe(BATCH_CLOSE_UNBILLED_URL);
        expect(url).not.toMatch(/refund/);
        expect(JSON.parse(String(init?.body))).toEqual({
            batchRequestId: BATCH_ID,
            items: [
                { type: "image", id: "task-one", expectedUpdatedAt: 500, expectedAttempt: 1 },
                { type: "video", id: "b", expectedUpdatedAt: 42, expectedAttempt: 0 },
            ],
        });
    });

    it("does not call the API for charged, empty or oversized selections", async () => {
        const fetcher = mockFetch();
        expect(await submitBatchCloseUnbilled(fetcher, [task({ charged: true })])).toMatchObject({ kind: "blocked" });
        expect(await submitBatchCloseUnbilled(fetcher, [])).toMatchObject({ kind: "blocked" });
        expect(await submitBatchCloseUnbilled(fetcher, Array.from({ length: 51 }, (_, index) => task({ id: `t${index}` })))).toMatchObject({ kind: "blocked" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("maps 409 rejection, 409 conflict, 403 and 400", async () => {
        const rejected = await submitBatchCloseUnbilled(
            mockFetch(jsonResponse(409, { code: 409, data: { batchRequestId: BATCH_ID, rejected: true, items: [{ type: "image", id: "task-one", outcome: "rejected", message: "同批次中有不可关闭的任务，整批未执行" }, { type: "image", id: "c", outcome: "rejected", reasons: ["charged"], message: "已扣款" }], summary: { applied: 0, conflict: 0, notFound: 0, rejected: 2, failed: 0 } }, msg: "整批未执行" })),
            [task(), task({ id: "c" })],
            () => BATCH_ID,
        );
        expect(rejected).toEqual({ kind: "rejected", message: "整批未执行", problems: [{ type: "image", id: "c", outcome: "rejected", reasons: ["charged"], message: "已扣款" }] });

        const conflict = await submitBatchCloseUnbilled(mockFetch(jsonResponse(409, { code: 409, data: { batchRequestId: BATCH_ID, rejected: false, items: [{ type: "image", id: "task-one", outcome: "conflict" }], summary: { applied: 0, conflict: 1, notFound: 0, rejected: 0, failed: 0 } }, msg: "任务状态已变化" })), [task()], () => BATCH_ID);
        expect(conflict).toMatchObject({ kind: "conflict", problems: [{ id: "task-one", outcome: "conflict" }] });

        expect(await submitBatchCloseUnbilled(mockFetch(jsonResponse(403, { code: 403, data: null, msg: "需要管理员权限" })), [task()], () => BATCH_ID)).toEqual({ kind: "forbidden", message: "需要管理员权限" });
        expect(await submitBatchCloseUnbilled(mockFetch(jsonResponse(400, { code: 400, data: null, msg: "缺少任务版本" })), [task()], () => BATCH_ID)).toEqual({ kind: "error", message: "缺少任务版本" });
    });
});
