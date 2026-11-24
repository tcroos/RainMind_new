import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { CancelReviewQueueItem as ServerCancelReviewQueueItem } from "@/lib/server/generation-cancel-review-queue";

import { CancelReviewQueueView, type CancelReviewQueueViewProps } from "./cancel-review-queue-client";
import {
    CANCEL_REVIEW_KEEP_PENDING_URL,
    CANCEL_REVIEW_QUEUE_URL,
    INITIAL_CURSOR_STACK,
    KEEP_PENDING_MAX_ITEMS,
    currentCursor,
    loadCancelReviewQueue,
    queuePagingReducer,
    submitKeepPending,
    type CancelReviewQueueItem,
} from "./cancel-review-queue-model";
import { GenerationOperationsClient } from "./generation-operations-client";

const BATCH_ID = "11111111-2222-4333-8444-555555555555";

function item(overrides: Partial<CancelReviewQueueItem> = {}): CancelReviewQueueItem {
    return {
        taskId: "task-one",
        type: "image",
        user: { accountId: "0001", displayName: "测试用户" },
        attemptNo: 2,
        hasUpstreamTaskId: false,
        channelId: "channel-a",
        provider: "provider-a",
        model: "gpt-image-1",
        surface: "canvas",
        submissionPhase: "submitting",
        executionPhase: "needs_review",
        lastUpstreamStatus: "cancel_unconfirmed",
        errorSummary: "上游取消请求超时",
        cancellationRequestedAt: 1_762_000_000_000,
        pointsRecordId: "points-1",
        refundStatus: "not_refunded",
        charged: true,
        chargedAmount: 12,
        hasResult: false,
        lastOperator: null,
        lastOperatedAt: null,
        updatedAt: 1_762_000_100_000,
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

function calledUrls(fetcher: ReturnType<typeof mockFetch>) {
    return fetcher.mock.calls.map(([url]) => url);
}

function expectOnlyQueueEndpoints(fetcher: ReturnType<typeof mockFetch>) {
    for (const url of calledUrls(fetcher)) {
        const pathname = new URL(url, "http://local").pathname;
        expect([CANCEL_REVIEW_QUEUE_URL, CANCEL_REVIEW_KEEP_PENDING_URL]).toContain(pathname);
        expect(pathname).not.toMatch(/refund|confirm|recheck|provide_result/);
    }
}

function viewProps(overrides: Partial<CancelReviewQueueViewProps> = {}): CancelReviewQueueViewProps {
    return {
        status: "ready",
        items: [],
        filters: {},
        hasPrevious: false,
        hasNext: false,
        pageNumber: 1,
        selectedKeys: [],
        actingKey: "",
        onFiltersChange: () => undefined,
        onNext: () => undefined,
        onPrevious: () => undefined,
        onRefresh: () => undefined,
        onSelectionChange: () => undefined,
        onKeepPending: () => undefined,
        onKeepPendingSelected: () => undefined,
        ...overrides,
    };
}

function render(props: Partial<CancelReviewQueueViewProps> = {}) {
    return renderToStaticMarkup(
        <App>
            <CancelReviewQueueView {...viewProps(props)} />
        </App>,
    );
}

describe("cancel review queue contract", () => {
    it("uses exactly the server item shape", () => {
        expectTypeOf<CancelReviewQueueItem>().toEqualTypeOf<ServerCancelReviewQueueItem>();
    });
});

describe("cancel review queue loading", () => {
    it("sends filters, cursor and limit as query parameters", async () => {
        const fetcher = mockFetch(jsonResponse(200, { code: 0, data: { items: [item()], nextCursor: "cursor-2" }, msg: "OK" }));
        const result = await loadCancelReviewQueue(fetcher, { type: "video", executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", requestedFrom: 100, requestedTo: 200 }, "cursor-1", 20);

        expect(result).toEqual({ kind: "ok", items: [item()], nextCursor: "cursor-2" });
        const url = new URL(calledUrls(fetcher)[0], "http://local");
        expect(url.pathname).toBe(CANCEL_REVIEW_QUEUE_URL);
        expect(Object.fromEntries(url.searchParams)).toEqual({ type: "video", executionPhase: "needs_review", lastUpstreamStatus: "cancel_unconfirmed", requestedFrom: "100", requestedTo: "200", cursor: "cursor-1", limit: "20" });
        expect(url.searchParams.has("page")).toBe(false);
        expectOnlyQueueEndpoints(fetcher);
    });

    it("omits empty filters and the cursor on the first page", async () => {
        const fetcher = mockFetch(jsonResponse(200, { code: 0, data: { items: [], nextCursor: null }, msg: "OK" }));
        const result = await loadCancelReviewQueue(fetcher, {}, null, 20);

        expect(result).toEqual({ kind: "ok", items: [], nextCursor: null });
        expect(calledUrls(fetcher)[0]).toBe(`${CANCEL_REVIEW_QUEUE_URL}?limit=20`);
    });

    it("maps 403, invalid cursor 400 and server failures to distinct states", async () => {
        expect(await loadCancelReviewQueue(mockFetch(jsonResponse(403, { code: 403, data: null, msg: "需要管理员权限" })), {}, null, 20)).toEqual({ kind: "forbidden", message: "需要管理员权限" });
        expect(await loadCancelReviewQueue(mockFetch(jsonResponse(400, { code: 400, data: null, msg: "队列游标无效" })), {}, "stale", 20)).toEqual({ kind: "cursor_invalid", message: "队列已变化，请刷新" });
        expect(await loadCancelReviewQueue(mockFetch(jsonResponse(500, { code: 500, data: null, msg: "待核查队列读取失败" })), {}, null, 20)).toEqual({ kind: "error", message: "待核查队列读取失败" });
        expect(await loadCancelReviewQueue(vi.fn().mockRejectedValue(new Error("offline")), {}, null, 20)).toMatchObject({ kind: "error" });
    });
});

describe("cancel review queue paging", () => {
    it("pushes the next cursor, pops back to the previous page and restarts on filter change", () => {
        let state = queuePagingReducer({ filters: {}, stack: INITIAL_CURSOR_STACK }, { type: "next", cursor: "c2" });
        state = queuePagingReducer(state, { type: "next", cursor: "c3" });
        expect(state.stack).toEqual([null, "c2", "c3"]);
        expect(currentCursor(state.stack)).toBe("c3");

        state = queuePagingReducer(state, { type: "previous" });
        expect(currentCursor(state.stack)).toBe("c2");

        state = queuePagingReducer(state, { type: "filters", filters: { type: "audio" } });
        expect(state).toEqual({ filters: { type: "audio" }, stack: [null] });

        state = queuePagingReducer(queuePagingReducer(state, { type: "next", cursor: "c9" }), { type: "reset" });
        expect(state).toEqual({ filters: { type: "audio" }, stack: [null] });
        expect(queuePagingReducer(state, { type: "previous" }).stack).toEqual([null]);
    });
});

describe("keep_pending submission", () => {
    it("sends a single item with its CAS tokens and a fresh batch id", async () => {
        const fetcher = mockFetch(jsonResponse(200, { code: 0, data: { batchRequestId: BATCH_ID, items: [{ type: "image", id: "task-one", outcome: "applied", updatedAt: 5 }], summary: { applied: 1, conflict: 0, notFound: 0 } }, msg: "已保持待处理" }));
        const result = await submitKeepPending(fetcher, [item()], () => BATCH_ID);

        expect(result).toMatchObject({ kind: "applied", conflicts: [] });
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe(CANCEL_REVIEW_KEEP_PENDING_URL);
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
            batchRequestId: BATCH_ID,
            action: "keep_pending",
            items: [{ type: "image", id: "task-one", expectedUpdatedAt: 1_762_000_100_000, expectedAttempt: 2 }],
        });
        expectOnlyQueueEndpoints(fetcher);
    });

    it("sends every selected item in one batch and generates a UUID per call by default", async () => {
        const fetcher = mockFetch(
            jsonResponse(200, { code: 0, data: { batchRequestId: "a", items: [], summary: { applied: 2, conflict: 0, notFound: 0 } }, msg: "OK" }),
            jsonResponse(200, { code: 0, data: { batchRequestId: "b", items: [], summary: { applied: 2, conflict: 0, notFound: 0 } }, msg: "OK" }),
        );
        const targets = [item(), item({ taskId: "task-two", type: "video", attemptNo: 0, updatedAt: 42 })];
        await submitKeepPending(fetcher, targets);
        await submitKeepPending(fetcher, targets);

        const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies[0].items).toEqual([
            { type: "image", id: "task-one", expectedUpdatedAt: 1_762_000_100_000, expectedAttempt: 2 },
            { type: "video", id: "task-two", expectedUpdatedAt: 42, expectedAttempt: 0 },
        ]);
        expect(bodies[0].batchRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(bodies[0].batchRequestId).not.toBe(bodies[1].batchRequestId);
    });

    it("reports partial and full conflicts with the conflicting items", async () => {
        const partial = await submitKeepPending(
            mockFetch(jsonResponse(200, { code: 0, data: { batchRequestId: BATCH_ID, items: [{ type: "image", id: "task-one", outcome: "applied", updatedAt: 9 }, { type: "video", id: "task-two", outcome: "conflict" }], summary: { applied: 1, conflict: 1, notFound: 0 } }, msg: "OK" })),
            [item(), item({ taskId: "task-two", type: "video" })],
            () => BATCH_ID,
        );
        expect(partial).toMatchObject({ kind: "applied", conflicts: [{ type: "video", id: "task-two", outcome: "conflict" }] });

        const full = await submitKeepPending(mockFetch(jsonResponse(409, { code: 409, data: { batchRequestId: BATCH_ID, items: [{ type: "image", id: "task-one", outcome: "conflict" }], summary: { applied: 0, conflict: 1, notFound: 0 } }, msg: "任务状态已变化" })), [item()], () => BATCH_ID);
        expect(full).toMatchObject({ kind: "conflict", conflicts: [{ id: "task-one", outcome: "conflict" }] });
    });

    it("maps 404 and 403 responses", async () => {
        expect(await submitKeepPending(mockFetch(jsonResponse(404, { code: 404, data: { batchRequestId: BATCH_ID, items: [], summary: { applied: 0, conflict: 0, notFound: 1 } }, msg: "任务不存在或已过期" })), [item()], () => BATCH_ID)).toEqual({ kind: "not_found", message: "任务不存在或已过期" });
        expect(await submitKeepPending(mockFetch(jsonResponse(403, { code: 403, data: null, msg: "需要管理员权限" })), [item()], () => BATCH_ID)).toEqual({ kind: "forbidden", message: "需要管理员权限" });
    });

    it("refuses more than 50 items and empty selections without calling the API", async () => {
        const fetcher = mockFetch();
        const many = Array.from({ length: KEEP_PENDING_MAX_ITEMS + 1 }, (_, index) => item({ taskId: `task-${index}` }));

        expect(await submitKeepPending(fetcher, many)).toEqual({ kind: "too_many", max: 50 });
        expect(await submitKeepPending(fetcher, [])).toEqual({ kind: "empty" });
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe("cancel review queue view", () => {
    it("renders loading and empty states", () => {
        expect(render({ status: "loading" })).toContain("ant-spin");
        expect(render({ status: "ready", items: [] })).toContain("没有待核查的取消任务");
    });

    it("renders a dedicated no-permission state on 403", () => {
        const markup = render({ status: "forbidden", errorMessage: "需要管理员权限" });
        expect(markup).toContain("无权限");
        expect(markup).not.toContain("批量保持待处理");
    });

    it("renders an error state with retry", () => {
        const markup = render({ status: "error", errorMessage: "待核查队列读取失败" });
        expect(markup).toContain("待核查队列读取失败");
        expect(markup).toContain("重试");
    });

    it("renders every column without sensitive fields or extra actions", () => {
        const markup = render({ items: [item({ lastOperator: { accountId: "0002" }, lastOperatedAt: "2026-11-05T10:00:00.000Z", errorSummary: "x".repeat(240) })] });
        for (const title of ["任务", "类型", "用户", "attempt", "上游 ID", "渠道", "provider", "模型", "入口", "扣款", "提交阶段", "executionPhase", "lastUpstreamStatus", "错误摘要", "取消时间", "扣费记录", "退款状态", "有结果", "上次操作", "更新时间"]) {
            expect(markup).toContain(`>${title}<`);
        }
        expect(markup).toContain("task-one");
        expect(markup).toContain("测试用户");
        expect(markup).toContain("gpt-image-1");
        expect(markup).toContain("Canvas");
        expect(markup).toContain("已扣款 12 积分");
        expect(markup).toContain("line-clamp-2");
        expect(markup).toContain("保持待处理");
        expect(markup).not.toMatch(/退款<\/span><\/button>|确认终态|recheck|重新核对|provide_result|录入结果|apiKey|cookie/i);
        expect(markup).not.toMatch(/href="[^"]*(task-one|points-1)/);
    });

    it("disables next on the last page and previous on the first page", () => {
        const first = render({ hasNext: true, hasPrevious: false });
        expect(first).toMatch(/aria-label="上一页"[^>]*disabled=""/);
        expect(first).not.toMatch(/aria-label="下一页"[^>]*disabled=""/);

        const last = render({ hasNext: false, hasPrevious: true, pageNumber: 2 });
        expect(last).toMatch(/aria-label="下一页"[^>]*disabled=""/);
        expect(last).not.toMatch(/aria-label="上一页"[^>]*disabled=""/);
        expect(last).toContain("第 2 页");
    });

    it("blocks the batch button above 50 selected rows", () => {
        const keys = Array.from({ length: KEEP_PENDING_MAX_ITEMS + 1 }, (_, index) => `image:task-${index}`);
        const markup = render({ items: [item()], selectedKeys: keys });
        expect(markup).toMatch(/aria-label="批量保持待处理"[^>]*disabled=""/);
        expect(markup).toContain("超过单次上限 50 条");
        expect(render({ items: [item()], selectedKeys: ["image:task-one"] })).not.toMatch(/aria-label="批量保持待处理"[^>]*disabled=""/);
    });

    it("shows a loading batch button while acting", () => {
        expect(render({ items: [item()], selectedKeys: ["image:task-one"], actingKey: "batch" })).toContain("ant-btn-loading");
    });
});

describe("generation operations tabs", () => {
    it("keeps task troubleshooting as the default tab and offers the cancel review tab", () => {
        const markup = renderToStaticMarkup(
            <App>
                <GenerationOperationsClient />
            </App>,
        );
        expect(markup).toContain("任务排障");
        expect(markup).toContain("取消待核查");
        expect(markup).toContain("运行概览");
    });

    it("renders the cancel review queue in its tab", () => {
        const markup = renderToStaticMarkup(
            <App>
                <GenerationOperationsClient initialView="cancelReview" />
            </App>,
        );
        expect(markup).toContain("批量保持待处理");
        expect(markup).not.toContain("运行概览");
    });
});
