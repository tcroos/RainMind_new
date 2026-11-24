import type { ImageTask } from "@/lib/server/image-task-store";
import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { buildProviderRequest, isProviderBusinessError, readProviderError, readProviderString, readProviderValue } from "@/lib/server/provider-task-config";
import { buildYumengImageRequest, resolveYumengImageResolution } from "@/lib/yumeng-model-center";
import { geminiImageConfig } from "./image-task-gemini-config";

import { publicImageReferenceRequestUrl } from "./image-task-openai";
import { IMAGE_TASK_POLL_INTERVAL_MS, type ImageApiResponse, type ImageTaskResult, type GeminiPayload } from "./image-task-types";
import {
    findImageResults,
    imagePointsIdempotencyKey,
    imageSubmissionFetch,
    imageSubmissionResponseError,
    imageReferenceToDataUrl,
    imageTaskPollAttempts,
    imageTaskPollUrls,
    isPendingImageStatus,
    parseChargedImageResponse,
    readFetchError,
    readImageTaskId,
    parseImageSubmissionJson,
    imageRequestAspectRatio,
    resolveRequestSize,
    buildImageEditFormData,
    taskFetch,
    taskHeaders,
    taskUrl,
    withSystemPrompt,
    withImageOutputInstructions,
    ImageUpstreamTerminalError,
    toGeminiImagePart,
    parseGeminiImagePayload,
} from "./image-task-support";

export async function runCustomImageTask(task: ImageTask, origin: string, publicOrigin: string, cookie: string, singleStep = false) {
    const config = task.config;
    const advanced = config.advancedConfig;
    if (!advanced?.createPath || !advanced.requestTemplate || !advanced.resultField) throw new GenerationSubmissionSafeFailure("自定义图片协议缺少创建路径、请求模板或结果字段");
    const size = resolveDeclarativeImageSize(config);
    const [width, height] = /^\d+x\d+$/.test(size) ? size.split("x").map(Number) : [undefined, undefined];
    const context = { ownerUserId: task.userId, taskId: task.id };
    const gemini = config.apiFormat === "gemini";
    const inlineReferences = gemini || advanced.protocol === "stable-diffusion" || /\bbase64\b|data:image|\binline\b/i.test(advanced.referenceRule || "");
    const images = (
        await Promise.all(
            task.references.map((reference, index) => (inlineReferences ? imageReferenceToDataUrl(reference, reference.name || `reference-${index + 1}.png`, origin, cookie) : publicImageReferenceRequestUrl(reference, origin, publicOrigin, context))),
        )
    ).filter(Boolean);
    const outputCount = config.outputMode === "layers" ? undefined : 1;
    const maskInstruction = gemini && task.mask ? "\n\n最后一张图片是编辑蒙版：透明区域需要重新生成，白色不透明区域必须保持原图。只补全透明区域，不要把蒙版当作画面内容。" : "";
    const prompt = withSystemPrompt(config, withImageOutputInstructions(config, task.prompt + maskInstruction));
    const content = [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))];
    const values = {
        model: config.model,
        prompt,
        content,
        messages: [{ role: "user", content }],
        size,
        ratio: imageRequestAspectRatio(config.size || "auto"),
        aspect_ratio: imageRequestAspectRatio(config.size || "auto"),
        resolution: gemini ? geminiImageConfig(config.size, config.quality).imageSize : advanced.protocol === "yumeng" ? resolveYumengImageResolution(config.model, config.quality) : config.quality || "auto",
        width,
        height,
        quality: config.quality || "auto",
        background: config.outputBackground || "opaque",
        output_format: config.outputBackground === "transparent" ? "png" : "",
        n: outputCount,
        count: outputCount,
        num_images: outputCount,
        batch_size: outputCount,
        image: images[0] || "",
        images,
    };
    const payload =
        advanced.protocol === "yumeng"
            ? buildYumengImageRequest({ model: config.model, prompt: values.prompt, images, aspectRatio: values.aspect_ratio, resolution: values.resolution, size })
            : buildProviderRequest(advanced.requestTemplate, values, values);
    if (gemini) {
        const generationConfig = (payload.generationConfig || {}) as Record<string, unknown>;
        const imageConfig = geminiImageConfig(config.size, config.quality, generationConfig.imageConfig as Record<string, unknown> | undefined);
        payload.generationConfig = { ...generationConfig, ...(Object.keys(imageConfig).length ? { imageConfig } : {}) };
    }
    if (gemini && (images.length || task.mask)) {
        const contents = payload.contents;
        if (!Array.isArray(contents)) throw new GenerationSubmissionSafeFailure("Gemini 自定义图片模板必须提供 contents 数组才能发送参考图");
        const userContent = [...contents].reverse().find((item) => item && typeof item === "object" && (!item.role || item.role === "user"));
        if (!userContent || !Array.isArray(userContent.parts)) throw new GenerationSubmissionSafeFailure("Gemini 自定义图片模板必须提供用户 parts 数组才能发送参考图");
        userContent.parts.push(...images.map((image, index) => toGeminiImagePart(image, task.references[index]?.type)));
        if (task.mask) userContent.parts.push(toGeminiImagePart(await imageReferenceToDataUrl(task.mask, task.mask.name || "mask.png", origin, cookie), task.mask.type));
    }
    const url = taskUrl(config, task.kind === "edit" ? advanced.editPath || advanced.createPath : advanced.createPath, origin);
    const headers = taskHeaders(config, cookie, imagePointsIdempotencyKey(task));
    const multipartEdit = task.kind === "edit" && task.references.length > 0 && /\bmultipart\b|form-?data|文件上传/i.test(advanced.referenceRule || "");
    let response: Response;
    if (multipartEdit) {
        let formData: FormData;
        try {
            formData = await buildImageEditFormData(task, config.quality || "", size || undefined, origin, cookie, "url", false);
        } catch (error) {
            throw new GenerationSubmissionSafeFailure(error instanceof Error ? error.message : "参考图读取失败，请重新上传参考图");
        }
        response = await imageSubmissionFetch(config, url, { method: "POST", headers, body: formData, cache: "no-store" }, task);
    } else {
        headers.set("content-type", "application/json");
        response = await imageSubmissionFetch(config, url, { method: "POST", headers, body: JSON.stringify(payload), cache: "no-store" }, task);
    }
    if (!response.ok) throw imageSubmissionResponseError(response.status, await readFetchError(response, "自定义图片接口调用失败"));
    const data = await parseImageSubmissionJson<ImageApiResponse>(task, response);
    return parseChargedImageResponse(task, response, async () => {
        if (isProviderBusinessError(data)) throw new ImageUpstreamTerminalError(readProviderError(data) || "自定义图片接口返回失败");
        const mediaBaseUrl = response.headers.get("x-vozeb-pro-upstream-url") || url;
        const direct = configuredImageResult(data, mediaBaseUrl, task);
        if (direct) return direct;
        const taskId = readImageTaskId(data);
        if (!taskId || !advanced.queryPath) throw new GenerationSubmissionUncertainError("自定义图片接口没有返回图片或任务 ID，创建结果待确认");
        if (singleStep) return { dataUrl: "", pending: { id: taskId, mediaBaseUrl, pollBaseUrl: url } };
        return pollCustomImageTask(task, taskId, mediaBaseUrl, url, cookie);
    });
}

export function resolveDeclarativeImageSize(config: Pick<ImageTask["config"], "quality" | "size" | "advancedConfig">) {
    const size = resolveRequestSize(config.quality, config.size || "auto") || config.size || "";
    return !size || size.toLowerCase() === "auto" ? "" : size;
}

export async function pollCustomImageTask(task: ImageTask, taskId: string, mediaBaseUrl: string, pollBaseUrl: string, cookie: string, singleStep = false) {
    const config = task.config;
    let lastError = "";
    for (let attempt = 0; attempt < (singleStep ? 1 : imageTaskPollAttempts(config)); attempt += 1) {
        for (const url of imageTaskPollUrls(config, pollBaseUrl, taskId)) {
            const response = await taskFetch(config, url, { headers: taskHeaders(config, cookie), cache: "no-store" });
            if (!response.ok) {
                lastError = await readFetchError(response, "自定义图片任务查询失败");
                continue;
            }
            const data = (await response.json().catch(() => null)) as ImageApiResponse | null;
            if (!data || isProviderBusinessError(data)) throw new ImageUpstreamTerminalError(readProviderError(data) || "自定义图片任务查询失败");
            const result = configuredImageResult(data, response.headers.get("x-vozeb-pro-upstream-url") || mediaBaseUrl || url, task);
            if (result) return result;
            const status = readProviderString(data, config.advancedConfig?.statusField, STATUS_KEYS).toLowerCase();
            if (!isPendingImageStatus(status)) throw new ImageUpstreamTerminalError(readProviderError(data) || "自定义图片任务完成但没有返回图片");
            lastError = "";
            break;
        }
        if (lastError) throw new Error(lastError);
        if (!singleStep) await new Promise((resolve) => setTimeout(resolve, IMAGE_TASK_POLL_INTERVAL_MS));
    }
    if (singleStep) return { dataUrl: "", pending: { id: taskId, mediaBaseUrl, pollBaseUrl } };
    throw new Error("自定义图片任务生成超时");
}

function configuredImageResult(data: ImageApiResponse, baseUrl: string, task: ImageTask): ImageTaskResult | null {
    if (task.config.apiFormat === "gemini" && "candidates" in data) return { dataUrl: parseGeminiImagePayload(data as GeminiPayload) };
    const configured = findImageResults(readProviderValue(data, task.config.advancedConfig?.resultField), baseUrl, task.config);
    const discovered = findImageResults(data, baseUrl, task.config);
    const images = discovered.length > configured.length ? discovered : configured;
    return images.length ? { ...images[0], results: images } : null;
}

const STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
