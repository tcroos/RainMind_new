import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";
import { creativeUploadMaxBytes } from "@/lib/creative-upload";
import type { VideoGenerationReference } from "@/lib/video-reference-contract";
import { runFfprobe } from "@/lib/server/ffmpeg";
import { getLocalMediaRegistration, isLocalMediaRegistrationExpired } from "@/lib/server/local-media-registry";
import { GENERATION_MEDIA_ROOT, REFERENCE_MEDIA_ROOT } from "@/lib/server/local-media-storage";
import { createExternalMediaReadUrl } from "@/lib/server/object-storage-service";
import { downloadMediaToFile } from "@/lib/server/media-download";
import { MEDIA_DOWNLOAD_CALLER_TIMEOUT_MS } from "@/lib/server/media-response-limit";

export async function trustedReferenceVideoDurations(references: readonly VideoGenerationReference[], user: { id: string; role: "user" | "admin" }, origin: string) {
    const probes = new Map<string, Promise<{ storageKey: string; durationMs: number }>>();
    const result = [];
    for (const reference of references.filter((item) => item.type === "video")) {
        const url = new URL(reference.url, origin);
        const prefix = url.pathname.startsWith("/api/reference-assets/") ? "/api/reference-assets/" : url.pathname.startsWith("/api/generation-log-assets/") ? "/api/generation-log-assets/" : "";
        if (url.origin !== new URL(origin).origin || !prefix) throw new Error("参考视频计费仅支持站内原始素材，请先上传视频");
        const storageKey = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
        const scope = prefix === "/api/reference-assets/" ? "reference" : "generation";
        const registration = await getLocalMediaRegistration(storageKey);
        if (!registration || registration.type !== "video" || registration.scope !== scope || isLocalMediaRegistrationExpired(registration) || (user.role !== "admin" && registration.ownerUserId !== user.id)) throw new Error("参考视频不存在或无权访问");
        const key = `${scope}:${storageKey}`;
        if (!probes.has(key)) probes.set(key, (async () => {
            const cacheKey = createHash("sha256").update(JSON.stringify([scope, storageKey, registration.ownerUserId, registration.createdAt, registration.bytes, registration.externalStorageId, registration.externalObjectKey])).digest("hex");
            const cacheFile = `media-probes/${cacheKey}.json`;
            const cached = await readJsonDataFile<{ version: number; durationMs: number } | null>(cacheFile, null);
            if (cached?.version === 1 && Number.isFinite(cached.durationMs) && cached.durationMs > 0) return { storageKey, durationMs: cached.durationMs };
            const root = resolve(scope === "reference" ? REFERENCE_MEDIA_ROOT : GENERATION_MEDIA_ROOT);
            const localPath = resolve(root, storageKey);
            if (!localPath.startsWith(`${root}${sep}`)) throw new Error("参考视频路径无效");
            let workdir: string | undefined;
            try {
                let path = localPath;
                if (registration.storageProvider === "object") {
                    const source = await createExternalMediaReadUrl(new Request(origin), registration);
                    if (!source) throw new Error("参考视频原文件不可读取");
                    workdir = await mkdtemp(join(tmpdir(), "vozeb-reference-probe-"));
                    path = join(workdir, "source-video");
                    await downloadMediaToFile(source, path, { origin, maxBytes: creativeUploadMaxBytes("video"), timeoutMs: MEDIA_DOWNLOAD_CALLER_TIMEOUT_MS });
                }
                const { stdout } = await runFfprobe(["-v", "error", "-protocol_whitelist", "file", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path], { timeoutMs: MEDIA_DOWNLOAD_CALLER_TIMEOUT_MS }).catch(() => { throw new Error("参考视频时长无法识别，请确认原文件可读取或联系管理员检查媒体探测工具"); });
                const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
                const duration = Number(data.format?.duration);
                if (!data.streams?.some((stream) => stream.codec_type === "video") || !Number.isFinite(duration) || duration <= 0) throw new Error("参考视频时长无法识别");
                const durationMs = duration * 1000;
                await writeJsonDataFile(cacheFile, { version: 1, durationMs });
                return { storageKey, durationMs };
            } finally {
                if (workdir) await rm(workdir, { recursive: true, force: true });
            }
        })());
        // Probe once, bill every occurrence; do not deduplicate repeated video references.
        result.push(await probes.get(key)!);
    }
    return result;
}
