"use client";

import { useEffect, useState } from "react";
import type { VideoGenerationReference } from "@/lib/video-reference-contract";
import type { VideoQuoteConfig } from "@/lib/video-generation-quote";
import { quoteVideoGeneration, rememberDisplayedVideoQuote, subscribeVideoQuoteRefresh, type VideoQuote } from "@/services/api/video-quote";
import { useUserStore } from "@/stores/use-user-store";

export function useVideoReferenceQuote(enabled: boolean, config: VideoQuoteConfig, references: VideoGenerationReference[], scope = "") {
    const userId = useUserStore((state) => state.user?.id || "");
    const key = JSON.stringify({ enabled, config, references, userId, scope });
    const [state, setState] = useState<{ key: string; quote?: VideoQuote; error?: string }>({ key: "" });
    useEffect(() => {
        if (!enabled) return;
        const input = JSON.parse(key) as { config: typeof config; references: VideoGenerationReference[] };
        let controller: AbortController | undefined;
        const loadQuote = () => {
            controller?.abort();
            controller = new AbortController();
            const activeController = controller;
            void quoteVideoGeneration(input.config, input.references, activeController.signal).then((quote) => {
                if (!activeController.signal.aborted && useUserStore.getState().user?.id === (userId || undefined)) {
                    rememberDisplayedVideoQuote(input.config, input.references, quote, scope);
                    setState({ key, quote });
                }
            }).catch((error: unknown) => {
                if (!activeController.signal.aborted) setState({ key, error: error instanceof Error ? error.message : "视频计费预估失败" });
            });
        };
        loadQuote();
        const unsubscribe = subscribeVideoQuoteRefresh(input.config, input.references, scope, loadQuote);
        // Generation can unmount the panel before media normalization completes.
        // Keep its confirmed quote for that submission; account changes clear the cache.
        return () => {
            unsubscribe();
            controller?.abort();
        };
    }, [enabled, key, scope, userId]);
    return enabled ? state.key === key ? state : { key } : undefined;
}
