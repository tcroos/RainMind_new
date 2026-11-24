import { describe, expect, it } from "vitest";
import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store-types";
import { applyChannelProtocol, emptyAdvancedConfig, resolveChannelModelConfig } from "./channel-protocol-registry";
import { synchronizeLogicalModelsWithChannels } from "./model-routing-config";
import { applyLogicalModelCapabilityEdits } from "./admin-model-capability";

const channel = (id: string): SystemModelChannel => applyChannelProtocol({ id, name: id, baseUrl: "https://example.test/v1", apiKey: "secret", apiFormat: "openai", models: ["opaque-model", "writer"], enabled: true }, "newapi");
const model: LogicalModel = { id: "opaque-model", name: "Model", capability: "text", enabled: true, bindings: ["one", "two"].map(channelId => ({ id: channelId, channelId, upstreamModel: "opaque-model", enabled: true, priority: 1 })) };

describe("explicit administrator model capability edits", () => {
    it("reproduces channel authority overwriting a logical-only edit", () => {
        expect(synchronizeLogicalModelsWithChannels([{ ...model, capability: "video" }], [channel("one")]).find(item => item.id === model.id)?.capability).toBe("text");
    });
    it.each(["image", "video", "audio"] as const)("updates all bindings to %s without changing other models or credentials", capability => {
        const original = [channel("one"), channel("two")];
        const before = structuredClone(original);
        const updated = applyLogicalModelCapabilityEdits([model], [{ ...model, capability }], original);
        expect(original).toEqual(before);
        for (const item of updated) {
            expect(item.apiKey).toBe("secret");
            expect(resolveChannelModelConfig(item.advancedConfig, "opaque-model")?.capability).toBe(capability);
            expect(item.advancedConfig?.modelConfigs?.writer).toEqual(original[0].advancedConfig?.modelConfigs?.writer);
        }
        expect(synchronizeLogicalModelsWithChannels([{ ...model, capability }], updated).find(item => item.id === model.id)?.capability).toBe(capability);
    });
    it("leaves ordinary saves channel-authoritative", () => {
        const channels = [channel("one")];
        expect(applyLogicalModelCapabilityEdits([model], [model], channels)).toBe(channels);
    });
    it("rejects unsupported single-capability protocols", () => {
        const source = applyChannelProtocol(channel("one"), "vozeb-recommended");
        expect(() => applyLogicalModelCapabilityEdits([{ ...model, capability: "video" }], [model], [source])).toThrow("渠道协议不支持");
    });
    it("rejects custom capability changes without matching operation instead of retaining chat paths", () => {
        const source = { ...channel("one"), advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom" as const, modelConfigs: { "opaque-model": { capability: "text" as const, protocol: "custom" as const, createPath: "/chat/completions" } } } };
        expect(() => applyLogicalModelCapabilityEdits([model], [{ ...model, capability: "video" }], [source])).toThrow("缺少 video 协议配置");
    });
    it("preserves explicitly submitted custom paths for the new capability", () => {
        const config = { capability: "video" as const, protocol: "custom" as const, createPath: "/jobs", queryPath: "/jobs/:task_id", requestTemplate: '{"prompt":"{{prompt}}"}', resultField: "output.url" };
        const source = { ...channel("one"), advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom" as const, modelConfigs: { "opaque-model": config } } };
        const updated = applyLogicalModelCapabilityEdits([model], [{ ...model, capability: "video" }], [source]);
        expect(updated[0].advancedConfig?.modelConfigs?.["opaque-model"]).toEqual({ ...config, source: "manual" });
    });
});
