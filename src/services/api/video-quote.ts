import type { VideoGenerationReference } from "@/lib/video-reference-contract";
import { GenerationTaskRequestError } from "./generation-task-request-error";
import { videoQuoteKey, type VideoGenerationQuote, type VideoQuoteConfig } from "@/lib/video-generation-quote";
import { useUserStore } from "@/stores/use-user-store";

export type VideoQuote = VideoGenerationQuote;
type QuoteConfig = VideoQuoteConfig;
export type VideoQuoteBatchItem = { targetId: string; config: QuoteConfig; references: VideoGenerationReference[] };
const displayedQuotes = new Map<string, VideoQuote>();
const quoteRefreshListeners = new Map<string, Set<() => void>>();
let sessionEpoch = 0;
useUserStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) { sessionEpoch += 1; displayedQuotes.clear(); quoteRefreshListeners.clear(); }
});

function quoteKey(config: QuoteConfig, references: VideoGenerationReference[], scope: string) {
    return JSON.stringify([sessionEpoch, useUserStore.getState().user?.id || "", scope, videoQuoteKey(config, references, typeof location !== "undefined" ? location.origin : undefined)]);
}

export function rememberDisplayedVideoQuote(config: QuoteConfig, references: VideoGenerationReference[], quote: VideoQuote, scope = "") {
    const prefix = JSON.stringify([sessionEpoch, useUserStore.getState().user?.id || "", scope]).slice(0, -1) + ",";
    for (const key of displayedQuotes.keys()) if (key.startsWith(prefix)) displayedQuotes.delete(key);
    displayedQuotes.set(quoteKey(config, references, scope), quote);
}

export function displayedVideoQuote(config: QuoteConfig, references: VideoGenerationReference[], scope = "") {
    return displayedQuotes.get(quoteKey(config, references, scope));
}

export function forgetDisplayedVideoQuote(config: QuoteConfig, references: VideoGenerationReference[], quote: VideoQuote, scope = "") {
    const key = quoteKey(config, references, scope);
    if (displayedQuotes.get(key) === quote) displayedQuotes.delete(key);
}

export function subscribeVideoQuoteRefresh(config: QuoteConfig, references: VideoGenerationReference[], scope = "", listener: () => void) {
    const key = quoteKey(config, references, scope);
    const listeners = quoteRefreshListeners.get(key) || new Set<() => void>();
    listeners.add(listener);
    quoteRefreshListeners.set(key, listeners);
    return () => {
        listeners.delete(listener);
        if (!listeners.size) quoteRefreshListeners.delete(key);
    };
}

export function requestVideoQuoteRefresh(config: QuoteConfig, references: VideoGenerationReference[], scope = "") {
    quoteRefreshListeners.get(quoteKey(config, references, scope))?.forEach((listener) => listener());
}

export async function quoteVideoGeneration(config: QuoteConfig, references: VideoGenerationReference[], signal?: AbortSignal, targetId?: string): Promise<VideoQuote> {
    const epoch = sessionEpoch;
    const response = await fetch("/api/video-generation-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, references, quoteOnly: true, ...(targetId ? { quoteTargetId: targetId } : {}) }), signal });
    const payload = await response.json() as { quote?: VideoQuote; error?: string };
    if (epoch !== sessionEpoch) throw new GenerationTaskRequestError("登录账号已变化，请重新核价", 409);
    if (!response.ok || !payload.quote) throw new GenerationTaskRequestError(payload.error || "视频计费预估失败", response.ok ? 400 : response.status);
    if (targetId && payload.quote.targetId !== targetId) throw new GenerationTaskRequestError("视频报价与任务身份不匹配，请重新核价", 409);
    return payload.quote;
}

export async function quoteVideoGenerationBatch(items: VideoQuoteBatchItem[], signal?: AbortSignal): Promise<Record<string, VideoQuote>> {
    const epoch = sessionEpoch;
    const targetIds = items.map((item) => item.targetId);
    if (!items.length || targetIds.some((id) => !id) || new Set(targetIds).size !== targetIds.length) throw new GenerationTaskRequestError("视频报价任务列表无效", 400);
    const response = await fetch("/api/video-generation-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteOnly: true, quoteItems: items }),
        signal,
    });
    const payload = await response.json() as { quotes?: Array<{ targetId: string; quote: VideoQuote }>; error?: string };
    if (epoch !== sessionEpoch) throw new GenerationTaskRequestError("登录账号已变化，请重新核价", 409);
    if (!response.ok || !payload.quotes) throw new GenerationTaskRequestError(payload.error || "视频批量报价失败", response.ok ? 400 : response.status);
    const quotes = new Map(payload.quotes.map(({ targetId, quote }) => [targetId, quote]));
    if (quotes.size !== items.length || targetIds.some((id) => quotes.get(id)?.targetId !== id)) throw new GenerationTaskRequestError("视频批量报价不完整或任务身份不匹配", 409);
    return Object.fromEntries(quotes);
}
