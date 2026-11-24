import type { DramaAssetReference, DramaProject, DramaShot } from "../types";
import type { useEffectiveConfig } from "@/stores/use-config-store";
import { resolveDramaGenerationSize } from "@/lib/drama-image-size";
import { compileDramaShotPrompts } from "@/lib/drama-prompt-compiler";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";
import type { VideoReferenceRole } from "@/lib/video-reference-contract";
import type { VideoGenerationReference } from "@/lib/video-reference-contract";

export function shotReferenceImages(project: DramaProject, shot: DramaShot) {
    const assetUrls = [...project.characters.filter((item) => shot.characterIds.includes(item.id)), ...project.scenes.filter((item) => item.id === shot.sceneId), ...project.props.filter((item) => shot.propIds.includes(item.id))].flatMap((item) => {
        const reference = primaryAssetReference(item);
        return reference ? [referenceImage(item.id, `${item.name}.png`, reference.url, "image/png", reference.width, reference.height)] : [];
    });
    const sourceUrls = (project.sourceAssets || []).flatMap((item) => {
        if (item.type !== "image") return [];
        const url = item.serverUrl || item.remoteUrl;
        return url ? [referenceImage(item.id, item.title, url, item.mimeType, item.width, item.height)] : [];
    });
    return [...assetUrls, ...sourceUrls];
}

export function storyboardReferenceImages(shot: DramaShot) {
    return [
        shot.storyboardImageUrl ? referenceImage(`storyboard-start-${shot.id}`, `${shot.title}-起始帧.png`, shot.storyboardImageUrl, "image/png", shot.storyboardImageWidth, shot.storyboardImageHeight, "first_frame") : null,
        shot.storyboardFrameMode === "first_last" && shot.storyboardEndImageUrl
            ? referenceImage(`storyboard-end-${shot.id}`, `${shot.title}-结束帧.png`, shot.storyboardEndImageUrl, "image/png", shot.storyboardEndImageWidth, shot.storyboardEndImageHeight, "last_frame")
            : null,
    ].filter((item): item is ReturnType<typeof referenceImage> => Boolean(item));
}

export function dramaShotReferenceVideos(project: DramaProject, shot: DramaShot, origin = typeof window !== "undefined" ? window.location.origin : undefined): ReferenceVideo[] {
    const assets = new Map((project.sourceAssets || []).filter((asset) => asset.type === "video").map((asset) => [asset.id, asset]));
    return (shot.referenceVideoAssetIds || []).flatMap((id) => {
        const asset = assets.get(id);
        const url = asset ? managedDramaSourceVideoUrl(asset, origin) : "";
        if (!asset || !url) return [];
        return [{ id: asset.id, name: asset.title, type: asset.mimeType || "video/mp4", url, ...(asset.storageKey ? { storageKey: asset.storageKey } : {}) }];
    });
}

export function dramaVideoQuoteReferences(images: ReferenceImage[], videos: readonly ReferenceVideo[]): VideoGenerationReference[] {
    return [
        ...images.flatMap((image) => {
            const url = image.serverUrl || image.remoteUrl || image.url;
            return url ? [{ type: "image" as const, url, role: image.videoRole || "reference" }]: [];
        }),
        ...videos.map((video) => ({ type: "video" as const, url: video.url })),
    ];
}

export function dramaVideoQuoteTargetId(projectId: string, episodeId: string, shotId: string, attemptNo: number) {
    return `drama-video:${projectId}:${episodeId}:${shotId}:attempt-${attemptNo}`;
}

export function buildDramaVideoQuoteItems(project: DramaProject, episode: DramaProject["episodes"][number], config: ReturnType<typeof useEffectiveConfig>, shotIds: string[]) {
    return shotIds.flatMap((shotId) => {
        const shot = episode.shots.find((item) => item.id === shotId);
        if (!shot) return [];
        const mode = shot.videoMode || project.defaultVideoMode;
        const images = mode === "reference" ? shotReferenceImages(project, shot) : storyboardReferenceImages(shot);
        const videos = dramaShotReferenceVideos(project, shot);
        const prompt = compileDramaShotPrompts(project, episode, shot).videoPrompt;
        // A queued shot with no quote is a pre-submission recovery (for example,
        // a 409 caused by expiry or changed billing semantics). Keep that same
        // attempt identity so its fresh confirmation can be submitted in place.
        const attemptNo = shot.generationStatus === "queued" && (shot.generationAttempt || 0) > 0 ? shot.generationAttempt! : (shot.generationAttempt || 0) + 1;
        return [{
            shotId,
            attemptNo,
            targetId: dramaVideoQuoteTargetId(project.id, episode.id, shot.id, attemptNo),
            title: shot.title || `镜头 ${shot.order}`,
            config: {
                model: config.videoModel || config.model,
                size: dramaGenerationSize(project, prompt, images),
                vquality: config.vquality,
                videoSeconds: String(shot.duration),
                videoGenerateAudio: String((shot.audioMode || "source") === "source"),
                videoWatermark: String(config.videoWatermark || "false"),
            },
            references: dramaVideoQuoteReferences(images, videos),
        }];
    });
}

export function confirmedDramaVideoQuote(projectId: string, episodeId: string, shot: DramaShot) {
    const attemptNo = shot.generationAttempt || 1;
    const targetId = dramaVideoQuoteTargetId(projectId, episodeId, shot.id, attemptNo);
    return shot.generationQuote?.attemptNo === attemptNo && shot.generationQuote.targetId === targetId && shot.generationQuote.quote.targetId === targetId ? shot.generationQuote.quote : undefined;
}

function managedDramaSourceVideoUrl(asset: NonNullable<DramaProject["sourceAssets"]>[number], origin?: string) {
    const storageUrl = asset.storageKey ? `/api/reference-assets/${asset.storageKey.split("/").map(encodeURIComponent).join("/")}` : "";
    for (const candidate of [asset.serverUrl, storageUrl]) {
        if (!candidate) continue;
        try {
            const base = origin || "https://managed-media.invalid";
            const value = new URL(candidate, base);
            const managed = /^\/api\/(?:reference-assets|generation-log-assets)\//.test(value.pathname);
            if (!managed) continue;
            if (/^https?:\/\//i.test(candidate) && origin && value.origin !== new URL(origin).origin) continue;
            if (/^https?:\/\//i.test(candidate) && !origin) continue;
            return candidate;
        } catch {
            continue;
        }
    }
    return "";
}

function primaryAssetReference(item: DramaProject["characters"][number]): Pick<DramaAssetReference, "url" | "width" | "height"> | undefined {
    return item.references?.find((reference) => reference.id === item.primaryReferenceId) || item.references?.[0] || (item.referenceImageUrl ? { url: item.referenceImageUrl } : undefined);
}

export function referenceImage(id: string, name: string, url: string, type = "image/png", width?: number, height?: number, videoRole?: VideoReferenceRole): ReferenceImage {
    return { id, name, type, dataUrl: url, url, width, height, ...(videoRole ? { videoRole } : {}), ...(url.startsWith("/") ? { serverUrl: url } : /^https?:\/\//i.test(url) ? { remoteUrl: url } : {}) };
}

export function dramaGenerationSize(project: DramaProject, prompt: string, references: ReferenceImage[] = []) {
    return resolveDramaGenerationSize({ projectSize: project.ratio, prompt, references });
}

export function dramaShotVideoReady(project: DramaProject, shot: DramaShot) {
    if ((shot.videoMode || project.defaultVideoMode) !== "storyboard") return true;
    return shot.storyboardStatus === "success" && Boolean(shot.storyboardImageUrl) && (shot.storyboardFrameMode !== "first_last" || (shot.storyboardEndStatus === "success" && Boolean(shot.storyboardEndImageUrl)));
}

export function queuedDramaShotsNeedingVideoQuote(project: DramaProject, episode: DramaProject["episodes"][number]) {
    return episode.shots.filter((shot) => shot.generationStatus === "queued" && dramaShotVideoReady(project, shot) && !confirmedDramaVideoQuote(project.id, episode.id, shot)).map((shot) => shot.id);
}

export function estimateTaskPoints(config: ReturnType<typeof useEffectiveConfig>, type: "image" | "video" | "audio", duration = 5) {
    const model = type === "image" ? config.imageModel || config.model : type === "video" ? config.videoModel || config.model : config.audioModel;
    const base = Number(config.modelPointCosts[model] || 0);
    if (type === "image") return Number((base * (config.generationPointMultipliers.imageQuality[config.quality] || 1)).toFixed(2));
    if (type === "video") {
        const quality = config.generationPointMultipliers.videoQuality[config.vquality] || 1;
        const seconds = config.generationPointMultipliers.videoSeconds[String(duration)] || config.generationPointMultipliers.videoSeconds[config.videoSeconds] || 1;
        return Number((base * quality * seconds).toFixed(2));
    }
    return Number(base.toFixed(2));
}

export function estimateEpisodePoints(config: ReturnType<typeof useEffectiveConfig>, project: DramaProject, shots: DramaShot[]) {
    const total = shots.reduce((sum, shot) => {
        const mode = shot.videoMode || project.defaultVideoMode;
        const image = mode === "storyboard" ? estimateTaskPoints(config, "image") * (shot.storyboardFrameMode === "first_last" ? 2 : 1) : 0;
        const audio = shot.audioMode === "voiceover" && (shot.subtitle || shot.dialogue || shot.narration).trim() ? estimateTaskPoints(config, "audio") : 0;
        return sum + image + estimateTaskPoints(config, "video", shot.duration) + audio;
    }, 0);
    return Number(total.toFixed(2));
}
