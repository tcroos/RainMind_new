import { describe, expect, it } from "vitest";

import { groupVideoModels } from "./canvas-video-grouped-model-picker";

const config = {
    models: [],
    logicalModels: [],
    modelPointCosts: {},
    generationPointMultipliers: {},
    videoModels: [],
} as unknown as import("@/stores/use-config-store").AiConfig;

describe("groupVideoModels", () => {
    it("groups seedance variants, keeps H3 max separate, and hides ungrouped models", () => {
        const groups = groupVideoModels(config, ["seedance-2.5", "seedance-2.5-480p", "seedance-2.5-720p", "seedance-2.5-720-MAX", "seedance-2.5-720-vip", "seedance-2.5-TG", "seedance-2.0-fast", "seedance-2.0-fast-native", "minimax-h3-768p", "minimax-h3-max", "wan3.0-video", "wan3.0-720p", "custom-video"]);
        const byKey = new Map(groups.map((group) => [group.key, group]));
        expect(byKey.get("seedance-2.5")?.models).toEqual(["seedance-2.5", "seedance-2.5-480p", "seedance-2.5-720p", "seedance-2.5-720-MAX", "seedance-2.5-720-vip", "seedance-2.5-TG"]);
        expect(byKey.get("seedance-2.0-fast")?.models).toEqual(["seedance-2.0-fast", "seedance-2.0-fast-native"]);
        expect(byKey.get("minimax-h3-768p")?.models).toContain("minimax-h3-768p");
        expect(byKey.get("minimax-h3-max")?.models).toEqual(["minimax-h3-max"]);
        expect(byKey.get("wan3.0")?.models).toEqual(["wan3.0-video", "wan3.0-720p"]);
        expect(byKey.has("__other__")).toBe(false);
    });

    it("uses official models as the second-level order and hides ungrouped models", () => {
        const groups = groupVideoModels(
            config,
            ["custom-video", "seedance-2.5-720p", "minimax-h3-768p", "wan3.0-720p", "seedance-2.0-fast-native"],
            ["seedance-2.5", "seedance-2.0-fast", "minimax-h3-768p", "wan3.0-video"],
        );
        expect(groups.map((group) => group.key)).toEqual(["seedance-2.5", "seedance-2.0-fast", "minimax-h3-768p", "wan3.0"]);
    });

    it("honors admin configured group and groupOrder", () => {
        const configured = {
            ...config,
            logicalModels: [
                { id: "model-a", name: "A", group: "第二组", groupOrder: 20 },
                { id: "model-b", name: "B", group: "第一组", groupOrder: 10 },
            ],
        } as never;
        const groups = groupVideoModels(configured, ["model-a", "model-b", "unconfigured-video"], []);
        expect(groups.map((group) => group.label)).toEqual(["第一组", "第二组"]);
    });

    it("keeps an admin group even when it is not in the official reference list", () => {
        const configured = {
            ...config,
            logicalModels: [{ id: "kling-4.0", name: "kling-4.0", group: "keling", groupOrder: 2 }],
        } as never;
        const groups = groupVideoModels(configured, ["kling-4.0", "wan3.0-video"], ["wan3.0-video"]);
        expect(groups.find((group) => group.key === "group:keling")?.models).toEqual(["kling-4.0"]);
        expect(groups.some((group) => group.key === "__other__")).toBe(false);
    });

    it("suppresses automatic reference groups once an admin group exists", () => {
        const configured = {
            ...config,
            logicalModels: [{ id: "kling-4.0", name: "kling-4.0", group: "keling", groupOrder: 2 }],
        } as never;
        const groups = groupVideoModels(configured, ["kling-4.0", "wan3.0-video", "seedance-2.5"], ["wan3.0-video", "seedance-2.5"]);
        expect(groups.map((group) => group.label)).toEqual(["keling"]);
        expect(groups.some((group) => group.key === "__other__")).toBe(false);
    });
});
