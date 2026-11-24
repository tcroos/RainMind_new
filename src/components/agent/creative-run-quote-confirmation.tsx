import type { CreativeAgentRun } from "@/services/api/creative";

export type CreativeRunVideoQuote = NonNullable<CreativeAgentRun["videoQuotes"]>[number];

export function CreativeRunQuoteConfirmation({
    quotes,
    totalPoints,
    error,
    confirming = false,
    cancelling = false,
    onConfirm,
    onCancel,
}: {
    quotes: CreativeRunVideoQuote[];
    totalPoints: number;
    error?: string;
    confirming?: boolean;
    cancelling?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <section className="mt-3 min-w-0 max-w-2xl border-y border-border py-3" data-agent-video-quote-confirmation aria-label="视频任务报价">
            <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
                <h3 className="min-w-0 truncate text-sm font-semibold">确认视频任务报价</h3>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{quotes.length} 项</span>
            </div>
            <div className="max-w-full overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-xs" aria-label="逐任务视频报价">
                    <thead className="text-muted-foreground">
                        <tr className="border-b border-border">
                            <th scope="col" className="px-2 py-2 font-medium">任务</th>
                            <th scope="col" className="px-2 py-2 font-medium">模型</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">输出</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">参考</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">计费</th>
                            <th scope="col" className="px-2 py-2 text-right font-medium">积分</th>
                        </tr>
                    </thead>
                    <tbody>
                        {quotes.map((quote) => (
                            <tr key={quote.targetId} className="border-b border-border/70 last:border-0">
                                <th scope="row" className="max-w-40 truncate px-2 py-2 font-medium" title={quote.title}>{quote.title}{quotes.filter((item) => item.taskId === quote.taskId).length > 1 ? ` · ${quote.copyIndex}` : ""}</th>
                                <td className="max-w-32 truncate px-2 py-2 text-muted-foreground" title={quote.model}>{quote.model}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{formatSeconds(quote.outputSeconds)}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{formatSeconds(quote.referenceSeconds)}</td>
                                <td className="px-2 py-2 text-right tabular-nums">{formatSeconds(quote.totalSeconds)}</td>
                                <td className="px-2 py-2 text-right font-medium tabular-nums">{formatPoints(quote.points)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold tabular-nums">合计 {formatPoints(totalPoints)} 积分</p>
                <div className="flex shrink-0 gap-2">
                    <button type="button" className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={confirming || cancelling} onClick={onCancel}>
                        {cancelling ? "正在取消" : "取消任务"}
                    </button>
                    <button type="button" className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" disabled={confirming || cancelling || !quotes.length} onClick={onConfirm}>
                        {confirming ? "正在确认" : "确认报价并开始"}
                    </button>
                </div>
            </div>
            {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
        </section>
    );
}

function formatSeconds(value: number) {
    return `${Number.isInteger(value) ? value : value.toFixed(2)} 秒`;
}

function formatPoints(value: number) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}
