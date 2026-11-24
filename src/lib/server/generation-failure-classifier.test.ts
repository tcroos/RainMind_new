import { describe, expect, it } from "vitest";

import { classifyGenerationFailure, isChannelRetryableFailure, isRetryableCandidateFailure } from "./generation-failure-classifier";

describe("generation failure classifier", () => {
    it("classifies retryable upstream errors", () => {
        expect(classifyGenerationFailure({ stage: "submit", status: 502 })).toBe("retryable_upstream");
        expect(classifyGenerationFailure({ stage: "submit", status: 524 })).toBe("retryable_upstream");
        expect(classifyGenerationFailure({ stage: "submit", error: Object.assign(new Error("timeout"), { name: "TimeoutError" }) })).toBe("retryable_upstream");
        expect(isRetryableCandidateFailure("retryable_upstream")).toBe(true);
    });

    it("classifies rate limit separately from other 4xx", () => {
        expect(classifyGenerationFailure({ stage: "submit", status: 429 })).toBe("retryable_rate_limit");
        expect(classifyGenerationFailure({ stage: "submit", status: 400 })).toBe("terminal_request");
        expect(classifyGenerationFailure({ stage: "submit", status: 401 })).toBe("terminal_request");
        expect(classifyGenerationFailure({ stage: "submit", status: 422 })).toBe("terminal_request");
    });

    it("does not retry content policy or quota failures", () => {
        expect(classifyGenerationFailure({ stage: "submit", message: "内容政策审核未通过" })).toBe("terminal_request");
        expect(classifyGenerationFailure({ stage: "submit", message: "insufficient quota" })).toBe("terminal_request");
        expect(classifyGenerationFailure({ stage: "submit", message: "余额不足" })).toBe("terminal_request");
    });

    it("separates requests not sent from uncertain submissions", () => {
        expect(classifyGenerationFailure({ stage: "submit", message: "connect ECONNREFUSED 127.0.0.1" })).toBe("retryable_not_sent");
        expect(classifyGenerationFailure({ stage: "submit", message: "fetch failed" })).toBe("uncertain_submitted");
        expect(classifyGenerationFailure({ stage: "submit", message: "图片接口返回了无效 JSON" })).toBe("uncertain_submitted");
    });

    it("detects cancellation", () => {
        expect(classifyGenerationFailure({ stage: "poll", message: "用户取消" })).toBe("cancelled");
    });

    it("allows channel-level retryable status and message overrides", () => {
        const config = { retryableStatuses: [400], retryableErrorPatterns: ["上游服务暂时不可用"] };
        expect(isChannelRetryableFailure(config, 400, "参数错误")).toBe(true);
        expect(isChannelRetryableFailure(config, 500, "上游服务暂时不可用")).toBe(true);
        expect(isChannelRetryableFailure({ retryableErrorPatterns: ["上游服务暂时不可用"] }, 400, "内容政策审核未通过")).toBe(false);
        expect(isChannelRetryableFailure(undefined, 400, "上游服务暂时不可用")).toBe(false);
    });
});
