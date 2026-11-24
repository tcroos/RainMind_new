"use client";

import { App, Button, DatePicker, Empty, Result, Select, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { ChevronLeft, ChevronRight, PauseCircle, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { Panel, PanelHeader } from "@/components/admin/admin-panel";
import {
    CANCEL_REVIEW_DEFAULT_PAGE_SIZE,
    CANCEL_REVIEW_TASK_TYPES,
    cancelReviewRefundLabel,
    cancelReviewRowKey,
    cancelReviewTypeLabel,
    cancelReviewUpstreamStatusLabel,
    currentCursor,
    formatCancelReviewTime,
    INITIAL_CURSOR_STACK,
    KEEP_PENDING_MAX_ITEMS,
    loadCancelReviewQueue,
    queuePagingReducer,
    submitKeepPending,
    type CancelReviewFilters,
    type CancelReviewQueueItem,
    type KeepPendingOutcome,
    type KeepPendingResult,
} from "./cancel-review-queue-model";
import { chargeLabel, surfaceLabel } from "./generation-operations-labels";
import { generationOperationStatusTagClass, generationOperationThemeClasses } from "./generation-operations-theme";

export type CancelReviewViewStatus = "loading" | "ready" | "error" | "forbidden";

const EXECUTION_PHASE_OPTIONS = [{ value: "needs_review", label: "待人工确认 · needs_review" }];
const UPSTREAM_STATUS_OPTIONS = ["cancel_unconfirmed"];
const browserFetch = (input: string, init?: RequestInit) => fetch(input, init);

export function CancelReviewQueueClient() {
    const { message, modal } = App.useApp();
    const [paging, dispatch] = useReducer(queuePagingReducer, { filters: {}, stack: INITIAL_CURSOR_STACK });
    const [items, setItems] = useState<CancelReviewQueueItem[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [status, setStatus] = useState<CancelReviewViewStatus>("loading");
    const [errorMessage, setErrorMessage] = useState("");
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [actingKey, setActingKey] = useState("");
    const [refreshToken, setRefreshToken] = useState(0);
    const requestIdRef = useRef(0);
    const actingRef = useRef(false);
    const cursor = currentCursor(paging.stack);

    useEffect(() => {
        const requestId = ++requestIdRef.current;
        setStatus((previous) => (previous === "forbidden" ? previous : "loading"));
        void loadCancelReviewQueue(browserFetch, paging.filters, cursor, CANCEL_REVIEW_DEFAULT_PAGE_SIZE).then((result) => {
            if (requestId !== requestIdRef.current) return;
            if (result.kind === "ok") {
                setItems(result.items);
                setNextCursor(result.nextCursor);
                setSelectedKeys((keys) => keys.filter((key) => result.items.some((item) => cancelReviewRowKey(item) === key)));
                setStatus("ready");
                return;
            }
            if (result.kind === "cursor_invalid") {
                message.warning(result.message);
                setSelectedKeys([]);
                dispatch({ type: "reset" });
                return;
            }
            setItems([]);
            setNextCursor(null);
            setSelectedKeys([]);
            setErrorMessage(result.message);
            setStatus(result.kind === "forbidden" ? "forbidden" : "error");
        });
    }, [cursor, message, paging.filters, refreshToken]);

    const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

    const keepPending = useCallback(
        async (targets: CancelReviewQueueItem[], key: string) => {
            if (actingRef.current) return;
            if (targets.length > KEEP_PENDING_MAX_ITEMS) {
                message.warning(`单次最多处理 ${KEEP_PENDING_MAX_ITEMS} 条任务，请减少勾选`);
                return;
            }
            actingRef.current = true;
            setActingKey(key);
            try {
                const result = await submitKeepPending(browserFetch, targets);
                reportKeepPending(result, { message, modal });
                if (result.kind === "forbidden") {
                    setErrorMessage(result.message);
                    setStatus("forbidden");
                    return;
                }
                if (result.kind === "applied" || result.kind === "conflict" || result.kind === "not_found") {
                    setSelectedKeys([]);
                    refresh();
                }
            } finally {
                actingRef.current = false;
                setActingKey("");
            }
        },
        [message, modal, refresh],
    );

    const selectedItems = useMemo(() => items.filter((item) => selectedKeys.includes(cancelReviewRowKey(item))), [items, selectedKeys]);

    return (
        <CancelReviewQueueView
            status={status}
            errorMessage={errorMessage}
            items={items}
            filters={paging.filters}
            hasPrevious={paging.stack.length > 1}
            hasNext={Boolean(nextCursor)}
            pageNumber={paging.stack.length}
            selectedKeys={selectedKeys}
            actingKey={actingKey}
            onFiltersChange={(filters) => {
                setSelectedKeys([]);
                dispatch({ type: "filters", filters });
            }}
            onNext={() => {
                if (!nextCursor) return;
                setSelectedKeys([]);
                dispatch({ type: "next", cursor: nextCursor });
            }}
            onPrevious={() => {
                setSelectedKeys([]);
                dispatch({ type: "previous" });
            }}
            onRefresh={refresh}
            onSelectionChange={setSelectedKeys}
            onKeepPending={(item) => void keepPending([item], cancelReviewRowKey(item))}
            onKeepPendingSelected={() => void keepPending(selectedItems, "batch")}
        />
    );
}

type Feedback = { message: ReturnType<typeof App.useApp>["message"]; modal: ReturnType<typeof App.useApp>["modal"] };

function reportKeepPending(result: KeepPendingResult, { message, modal }: Feedback) {
    if (result.kind === "empty") return void message.info("请先勾选任务");
    if (result.kind === "too_many") return void message.warning(`单次最多处理 ${result.max} 条任务，请减少勾选`);
    if (result.kind === "forbidden") return void message.error(result.message);
    if (result.kind === "not_found") return void message.error(result.message);
    if (result.kind === "error") return void message.error(result.message);
    if (result.kind === "applied") {
        const { applied, conflict, notFound } = result.batch.summary;
        const extra = [conflict ? `${conflict} 条状态已变化` : "", notFound ? `${notFound} 条不存在` : ""].filter(Boolean).join("，");
        message.success(extra ? `已保持待处理 ${applied} 条；${extra}` : `已保持待处理 ${applied} 条`);
        if (result.conflicts.length) showConflicts(modal, result.conflicts);
        return;
    }
    showConflicts(modal, result.conflicts);
}

function showConflicts(modal: Feedback["modal"], conflicts: KeepPendingOutcome[]) {
    modal.warning({
        title: "有任务状态已变化",
        content: (
            <div className="space-y-2">
                <div className="text-sm">以下任务已被其他操作更新，未写入。队列已刷新，请核对后重试。</div>
                {conflicts.length ? (
                    <ul className="max-h-60 list-disc space-y-1 overflow-auto pl-5 font-mono text-xs">
                        {conflicts.map((entry) => (
                            <li key={`${entry.type}:${entry.id}`}>
                                {cancelReviewTypeLabel(entry.type)} · {entry.id}
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
        ),
    });
}

export type CancelReviewQueueViewProps = {
    status: CancelReviewViewStatus;
    errorMessage?: string;
    items: CancelReviewQueueItem[];
    filters: CancelReviewFilters;
    hasPrevious: boolean;
    hasNext: boolean;
    pageNumber: number;
    selectedKeys: string[];
    actingKey: string;
    onFiltersChange: (filters: CancelReviewFilters) => void;
    onNext: () => void;
    onPrevious: () => void;
    onRefresh: () => void;
    onSelectionChange: (keys: string[]) => void;
    onKeepPending: (item: CancelReviewQueueItem) => void;
    onKeepPendingSelected: () => void;
};

/** Stateless render of the queue, so loading/empty/error/forbidden states can be tested without a DOM. */
export function CancelReviewQueueView(props: CancelReviewQueueViewProps) {
    const { status, errorMessage, items, filters, hasPrevious, hasNext, pageNumber, selectedKeys, actingKey } = props;
    const busy = Boolean(actingKey);
    const overLimit = selectedKeys.length > KEEP_PENDING_MAX_ITEMS;
    const columns = useCancelReviewColumns(actingKey, props.onKeepPending);

    if (status === "forbidden") {
        return (
            <Panel>
                <Result status="403" title="无权限" subTitle={errorMessage || "需要生成运维（generation.manage）权限才能查看取消待核查队列。"} />
            </Panel>
        );
    }

    return (
        <Panel>
            <PanelHeader
                title="取消待核查"
                description="取消后无法确认上游是否已停止的任务。此处只能保持待处理，不退款、不改变任务阶段。"
                actions={
                    <Button aria-label="刷新取消待核查队列" icon={<RefreshCw className="size-4" />} loading={status === "loading"} onClick={props.onRefresh}>
                        刷新
                    </Button>
                }
            />
            <section data-testid="cancel-review-filters" className="border-b border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-[repeat(3,minmax(140px,180px))_minmax(260px,1fr)_auto] xl:gap-3">
                    <Select
                        className="w-full"
                        aria-label="按任务类型筛选"
                        value={filters.type || undefined}
                        allowClear
                        placeholder="任务类型"
                        options={CANCEL_REVIEW_TASK_TYPES.map((value) => ({ value, label: cancelReviewTypeLabel(value) }))}
                        onChange={(value?: string) => props.onFiltersChange({ ...filters, type: value || undefined })}
                    />
                    <Select
                        className="w-full"
                        aria-label="按执行阶段筛选"
                        value={filters.executionPhase || undefined}
                        allowClear
                        placeholder="执行阶段（默认待人工确认）"
                        options={EXECUTION_PHASE_OPTIONS}
                        onChange={(value?: string) => props.onFiltersChange({ ...filters, executionPhase: value || undefined })}
                    />
                    <Select
                        className="w-full"
                        aria-label="按上游状态筛选"
                        value={filters.lastUpstreamStatus || undefined}
                        allowClear
                        placeholder="上游状态（默认取消未确认）"
                        options={UPSTREAM_STATUS_OPTIONS.map((value) => ({ value, label: `${cancelReviewUpstreamStatusLabel(value)} · ${value}` }))}
                        onChange={(value?: string) => props.onFiltersChange({ ...filters, lastUpstreamStatus: value || undefined })}
                    />
                    <DatePicker.RangePicker
                        className="col-span-2 w-full sm:col-span-2 xl:col-span-1"
                        aria-label="按取消时间筛选"
                        showTime
                        allowEmpty={[true, true]}
                        placeholder={["取消时间起", "取消时间止"]}
                        value={[filters.requestedFrom ? dayjs(filters.requestedFrom) : null, filters.requestedTo ? dayjs(filters.requestedTo) : null]}
                        onChange={(range) => props.onFiltersChange({ ...filters, ...rangeToFilters(range) })}
                    />
                    <Button className={generationOperationThemeClasses.secondaryButton} icon={<RotateCcw className="size-4" />} onClick={() => props.onFiltersChange({})}>
                        重置
                    </Button>
                </div>
            </section>

            <section className="min-w-0 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        已选 {selectedKeys.length} 条{overLimit ? `，超过单次上限 ${KEEP_PENDING_MAX_ITEMS} 条` : `，单次最多 ${KEEP_PENDING_MAX_ITEMS} 条`}
                    </div>
                    <Button
                        aria-label="批量保持待处理"
                        className={generationOperationThemeClasses.primaryButton}
                        icon={<PauseCircle className="size-4" />}
                        disabled={!selectedKeys.length || overLimit || (busy && actingKey !== "batch")}
                        loading={actingKey === "batch"}
                        onClick={props.onKeepPendingSelected}
                    >
                        批量保持待处理
                    </Button>
                </div>
                {status === "error" ? (
                    <Result
                        status="error"
                        title="待核查队列读取失败"
                        subTitle={errorMessage}
                        extra={
                            <Button icon={<RefreshCw className="size-4" />} onClick={props.onRefresh}>
                                重试
                            </Button>
                        }
                    />
                ) : (
                    <div data-testid="cancel-review-table" className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <Table<CancelReviewQueueItem>
                            rowKey={cancelReviewRowKey}
                            size="middle"
                            loading={status === "loading"}
                            columns={columns}
                            dataSource={items}
                            pagination={false}
                            scroll={{ x: 2600 }}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待核查的取消任务" /> }}
                            rowSelection={{
                                selectedRowKeys: selectedKeys,
                                preserveSelectedRowKeys: false,
                                getCheckboxProps: () => ({ disabled: busy }),
                                onChange: (keys) => props.onSelectionChange(keys.map(String)),
                            }}
                        />
                    </div>
                )}
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">第 {pageNumber} 页</span>
                    <Button aria-label="上一页" icon={<ChevronLeft className="size-4" />} disabled={!hasPrevious || status === "loading"} onClick={props.onPrevious}>
                        上一页
                    </Button>
                    <Button aria-label="下一页" icon={<ChevronRight className="size-4" />} iconPlacement="end" disabled={!hasNext || status === "loading"} onClick={props.onNext}>
                        下一页
                    </Button>
                </div>
            </section>
        </Panel>
    );
}

function rangeToFilters(range: null | [Dayjs | null, Dayjs | null]): Pick<CancelReviewFilters, "requestedFrom" | "requestedTo"> {
    const [from, to] = range || [null, null];
    return { requestedFrom: from ? from.valueOf() : undefined, requestedTo: to ? to.valueOf() : undefined };
}

function useCancelReviewColumns(actingKey: string, onKeepPending: (item: CancelReviewQueueItem) => void) {
    return useMemo<TableColumnsType<CancelReviewQueueItem>>(
        () => [
            {
                title: "任务",
                dataIndex: "taskId",
                width: 220,
                fixed: "left",
                render: (_, item) => (
                    <Typography.Text className="!font-mono !text-xs" copyable={{ text: item.taskId, tooltips: ["复制任务 ID", "已复制"] }} ellipsis={{ tooltip: item.taskId }} style={{ maxWidth: 190 }}>
                        {item.taskId}
                    </Typography.Text>
                ),
            },
            { title: "类型", dataIndex: "type", width: 80, render: (value: string) => <Tag className={generationOperationThemeClasses.neutralTag}>{cancelReviewTypeLabel(value)}</Tag> },
            {
                title: "用户",
                width: 160,
                render: (_, item) =>
                    item.user ? (
                        <div className="min-w-0">
                            <div className="truncate text-sm">{item.user.displayName || "未命名用户"}</div>
                            <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">ID {item.user.accountId}</div>
                        </div>
                    ) : (
                        <span className="text-xs text-zinc-400">用户信息不可用</span>
                    ),
            },
            { title: "attempt", dataIndex: "attemptNo", width: 80, render: (value: number) => <span className="tabular-nums">{value}</span> },
            { title: "上游 ID", dataIndex: "hasUpstreamTaskId", width: 90, render: (value: boolean) => <Tag className={generationOperationThemeClasses.neutralTag}>{value ? "有" : "无"}</Tag> },
            { title: "渠道", dataIndex: "channelId", width: 120, render: (value: string | null) => <TruncatedText value={value} /> },
            { title: "provider", dataIndex: "provider", width: 120, render: (value: string | null) => <TruncatedText value={value} /> },
            { title: "模型", dataIndex: "model", width: 160, render: (value: string | null) => <TruncatedText value={value} /> },
            { title: "入口", dataIndex: "surface", width: 110, render: (value: string | null) => <span className="text-xs">{surfaceLabel(value)}</span> },
            { title: "提交阶段", dataIndex: "submissionPhase", width: 120, render: (value: string | null) => <TruncatedText value={value} /> },
            { title: "executionPhase", dataIndex: "executionPhase", width: 140, render: (value: string | null) => <TruncatedText value={value} /> },
            { title: "lastUpstreamStatus", dataIndex: "lastUpstreamStatus", width: 160, render: (value: string | null) => <TruncatedText value={value} /> },
            { title: "错误摘要", dataIndex: "errorSummary", width: 220, render: (value: string | null) => <TruncatedText value={value} lines /> },
            { title: "取消时间", dataIndex: "cancellationRequestedAt", width: 170, render: (value: number) => <span className="tabular-nums">{formatCancelReviewTime(value)}</span> },
            { title: "扣费记录", dataIndex: "pointsRecordId", width: 150, render: (value: string | null) => <TruncatedText value={value} mono /> },
            {
                title: "扣款",
                width: 130,
                render: (_, item) => <Tag className={item.charged ? generationOperationStatusTagClass("running") : generationOperationThemeClasses.neutralTag}>{chargeLabel(item.charged, item.chargedAmount)}</Tag>,
            },
            { title: "退款状态", dataIndex: "refundStatus", width: 100, render: (value: CancelReviewQueueItem["refundStatus"]) => cancelReviewRefundLabel(value) },
            { title: "有结果", dataIndex: "hasResult", width: 80, render: (value: boolean) => (value ? "是" : "否") },
            {
                title: "上次操作",
                width: 180,
                render: (_, item) =>
                    item.lastOperator || item.lastOperatedAt ? (
                        <div className="text-xs">
                            <div className="font-mono">{item.lastOperator ? `ID ${item.lastOperator.accountId}` : "未记录"}</div>
                            <div className="tabular-nums text-zinc-500 dark:text-zinc-400">{formatCancelReviewTime(item.lastOperatedAt)}</div>
                        </div>
                    ) : (
                        <span className="text-xs text-zinc-400">无</span>
                    ),
            },
            { title: "更新时间", dataIndex: "updatedAt", width: 170, render: (value: number) => <span className="tabular-nums">{formatCancelReviewTime(value)}</span> },
            {
                title: "操作",
                width: 130,
                fixed: "right",
                render: (_, item) => {
                    const key = cancelReviewRowKey(item);
                    return (
                        <Button size="small" aria-label={`保持待处理 ${item.taskId}`} disabled={Boolean(actingKey) && actingKey !== key} loading={actingKey === key} onClick={() => onKeepPending(item)}>
                            保持待处理
                        </Button>
                    );
                },
            },
        ],
        [actingKey, onKeepPending],
    );
}

function TruncatedText({ value, lines = false, mono = false }: { value: string | null; lines?: boolean; mono?: boolean }) {
    if (!value) return <span className="text-xs text-zinc-400">—</span>;
    return (
        <Tooltip title={value}>
            <div className={`${lines ? "line-clamp-2 break-all" : "truncate"} ${mono ? "font-mono" : ""} text-xs leading-5`}>{value}</div>
        </Tooltip>
    );
}
