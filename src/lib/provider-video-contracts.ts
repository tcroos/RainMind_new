import type { SystemChannelModelConfig, LogicalModelCapabilityProfile } from "@/lib/auth/store-types";

export function deepKeyVideoContract(model: string): { config: SystemChannelModelConfig; profile: LogicalModelCapabilityProfile } | null {
    const seedance = /^sd2\.0-(?:933-720p-fast|mini933-720p)-x(10s|15s|5-15s)$/.exec(model);
    const h3 = /^(?:Minimax-H3-768p-933-(10s|15s|10s-15s)|MiniMax-H3-933-1440p-(10s|15s|10-15s))$/.exec(model);
    if (!seedance && !h3) return null;
    const timing = seedance?.[1] || h3?.[1] || h3?.[2] || "";
    const variable = timing.includes("-");
    const min = seedance ? 5 : 10;
    const fixed = timing === "15s" ? 15 : 10;
    const maxReferenceTotal = seedance ? 15 : h3?.[1] ? 12 : 15;
    return {
        config: {
            capability: "video",
            protocol: "custom",
            createPath: "/videos",
            imageToVideoPath: "/videos",
            queryPath: "/videos/:task_id",
            statusField: "status",
            resultField: "metadata.url / result_url / url",
            requestTemplate: JSON.stringify({
                model: "{{model}}",
                prompt: "{{prompt}}",
                aspect_ratio: "{{aspect_ratio}}",
                ...(variable ? { seconds: "{{seconds}}" } : {}),
                images: "{{images}}",
                metadata: { video_urls: "{{videos}}", audio_urls: "{{audios}}" },
            }),
            durationRange: variable ? `${min}-15 秒` : `${fixed} 秒`,
            supportsReferenceImage: true,
            supportsReferenceVideo: true,
            supportsReferenceAudio: true,
        },
        profile: {
            supportsReferenceImage: true,
            supportsReferenceVideo: true,
            supportsReferenceAudio: true,
            maxReferenceImages: 9,
            maxReferenceVideos: 3,
            maxReferenceAudios: 3,
            maxReferenceTotal,
            ...(seedance ? { requiresReferenceImageOrVideo: true } : {}),
            aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "3:2", "2:3"],
            ...(variable ? { minDurationSeconds: min, maxDurationSeconds: 15 } : { durationSeconds: [fixed] }),
        },
    };
}

export function clmmVideoTimingTemplate(model: string) {
    const tokens = model.split(/[-\s]+/);
    const duration = tokens.find((token) => /^\d+s$/i.test(token));
    const fixed = tokens.some((token) => token.toLowerCase() === "gz");
    return duration ? { seconds: "1", mySeconds: fixed ? duration.slice(0, -1) : "{{duration_string}}" } : { seconds: "{{seconds_string}}" };
}
