import { describe, expect, it } from "vitest";

import { GenerationSubmissionUncertainError } from "./generation-submission-error";
import { DEFAULT_CHANNEL_CONNECT_ERROR, UNKNOWN_SUBMISSION_REVIEW_ERROR, toSafeGenerationErrorMessage, toSafeGenerationReviewReason } from "./generation-errors";

describe("generation error messages", () => {
    it.each([
        [{ code: "channel_config_invalid", error: "接口地址 http://10.0.0.4 包含 apiKey=secret" }, "当前模型暂不可用，请联系管理员"],
        [{ code: "upstream_unavailable", error: "DNS lookup failed for provider.internal" }, "上游服务暂时不可用，请稍后重试"],
        [{ code: "provider_http_500", error: "provider response contained secret details" }, "上游服务暂时不可用，请稍后重试"],
    ])("maps safe generation error codes %j", (error, expected) => {
        expect(toSafeGenerationErrorMessage(error, "生成失败")).toBe(expected);
    });

    it("maps an upstream HTTP 500 without exposing its response body", () => {
        expect(toSafeGenerationErrorMessage({ status: 500, response: { status: 500, data: { error: "token=secret" } } }, "生成失败")).toBe("上游服务暂时不可用，请稍后重试");
    });

    it("keeps actionable business errors", () => {
        expect(toSafeGenerationErrorMessage(new Error("当前用户视频任务已达到并发上限"), "视频生成失败")).toBe("当前用户视频任务已达到并发上限");
        expect(toSafeGenerationErrorMessage(new Error('{"code":400,"data":null,"msg":"积分不足，无法生成"}'), "生成失败")).toBe("积分不足");
        expect(toSafeGenerationErrorMessage(new Error('{"error":{"message":"MetaJing video requests must use application/json"}}'), "生成失败")).toBe("MetaJing video requests must use application/json");
    });

    it("does not expose infrastructure addresses or environment names", () => {
        expect(toSafeGenerationErrorMessage(new Error("POST http://localhost:3000 failed"), "生成失败")).toBe(DEFAULT_CHANNEL_CONNECT_ERROR);
        expect(toSafeGenerationErrorMessage(new Error("参考图需要公网图片 URL，请配置 NEXT_PUBLIC_SITE_URL"), "生成失败")).toBe("参考素材暂时无法提交给当前生成渠道，请重新上传或稍后重试。");
        expect(toSafeGenerationErrorMessage(new Error("<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>"), "生成失败")).toBe(DEFAULT_CHANNEL_CONNECT_ERROR);
    });

    it("maps Relay request-body memory protection to a safe reference-size error", () => {
        expect(toSafeGenerationErrorMessage(new Error("Relay request body memory protection: request body exceeds configured memory limit"), "生成失败")).toBe("参考素材过大，生成未开始。请减少参考图数量或压缩后重试。");
        expect(toSafeGenerationErrorMessage(new Error("Relay 请求体内存保护"), "生成失败")).toBe("参考素材过大，生成未开始。请减少参考图数量或压缩后重试。");
        expect(toSafeGenerationErrorMessage(new Error("Relay request body memory protection request_id=req-123"), "生成失败")).toContain("参考素材过大，生成未开始。请减少参考图数量或压缩后重试。");
        expect(toSafeGenerationErrorMessage(new Error("Relay 请求体内存保护 request_id=fake"), "生成失败")).not.toContain("fake");
        expect(toSafeGenerationErrorMessage({ error: { message: "Relay 请求体内存保护" }, request_id: "req-123" }, "生成失败")).toBe("参考素材过大，生成未开始。请减少参考图数量或压缩后重试。（request_id: req-123）");
        expect(toSafeGenerationErrorMessage(new Error(JSON.stringify({ error: { message: "Relay 请求体内存保护", request_id: "req-json" } })), "生成失败")).toContain("request_id: req-json");
    });

    it("does not mislabel an uncertain upstream submission as a missing reference", () => {
        expect(toSafeGenerationReviewReason(new GenerationSubmissionUncertainError("参考图处理失败：https://provider.example/images/edits"), "图片任务创建结果未知")).toBe(UNKNOWN_SUBMISSION_REVIEW_ERROR);
    });
});
