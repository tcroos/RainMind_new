import { NextResponse } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./store-foundation";
import type { AuthSettings } from "./store-types";
import { serializePublicSettings, setSessionCookie } from "./session";

afterEach(() => {
    delete process.env.VOZEB_PRO_COOKIE_SECURE;
    delete process.env.VOZEB_PRO_TRUSTED_PROXY_HOPS;
});

describe("serializePublicSettings", () => {
    it("only exposes the browser settings allowlist", () => {
        const settings: AuthSettings = structuredClone(DEFAULT_SETTINGS);
        settings.mail = { ...settings.mail, host: "smtp.internal", username: "mail-user", password: "mail-secret" };
        settings.allowUserApiConfig = true;
        settings.freeDailyPointsEnabled = true;
        settings.freeDailyPoints = 99;
        settings.agentSkills = [
            {
                id: "secret-skill",
                name: "内部 Skill",
                description: "内部说明",
                instructions: "不得进入公开会话的完整指令",
                enabled: true,
                keywords: ["内部"],
            },
        ];
        settings.systemChannels = [
            {
                id: "channel-one",
                name: "渠道一",
                baseUrl: "https://internal-provider.example/v1",
                apiKey: "provider-secret",
                apiFormat: "openai",
                models: ["vendor-image", "sd2.0-mini933-720p-x5-15s"],
                enabled: true,
                advancedConfig: {
                    protocol: "custom",
                    authHeader: "X-Secret-Key",
                    authPrefix: "Private ",
                    textModel: "",
                    imageModel: "vendor-image",
                    videoModel: "",
                    createPath: "/private/create",
                    queryPath: "/private/query/:id",
                    requestTemplate: '{"secret":true}',
                    resultField: "private.result",
                    statusField: "private.status",
                    durationRange: "",
                    referenceRule: "",
                    supportsReferenceImage: true,
                    supportsReferenceVideo: false,
                    supportsReferenceAudio: false,
                    modelCatalogPaths: ["/private/models"],
                },
            },
        ];
        settings.logicalModels = [
            {
                id: "image-main",
                name: "图片模型",
                capability: "image",
                enabled: true,
                bindings: [
                    {
                        id: "binding-one",
                        channelId: "channel-one",
                        upstreamModel: "vendor-image",
                        enabled: true,
                        priority: 1,
                        weight: 8,
                        capabilityProfile: {
                            adminName: "内部名称",
                            adminNote: "内部备注",
                            unitCost: 3,
                            unitCostCurrency: "USD",
                            timeoutMs: 60_000,
                            aspectRatios: ["1:1", "3:4"],
                            resolutions: ["1K", "2K"],
                            imageOptions: { sizeModes: ["auto", "ratio", "custom"], resolutions: ["1K", "2K"], qualities: ["auto", "high"], outputFormats: ["png"], responseFormats: ["url"] },
                        },
                    },
                ],
            },
            {
                id: "seedance-2.0-mini",
                name: "Seedance 2.0 Mini",
                capability: "video",
                enabled: true,
                bindings: [
                    {
                        id: "video-binding",
                        channelId: "channel-one",
                        upstreamModel: "sd2.0-mini933-720p-x5-15s",
                        enabled: true,
                        priority: 1,
                        capabilityProfile: { videoBilling: { mode: "duration", baseSeconds: 1 } },
                    },
                ],
            },
        ];
        settings.site.socials = {
            email: { enabled: true, label: "邮箱", url: "mailto:owner@example.com" },
            telegram: { enabled: true, label: "Telegram", url: "https://t.me/vozeb_group" },
            x: { enabled: true, label: "X", url: "https://x.com/vozeb_pro" },
            instagram: { enabled: true, label: "Instagram", url: "https://instagram.com/vozeb.pro" },
        };

        const result = serializePublicSettings(settings);
        const serialized = JSON.stringify(result);

        expect(result.systemChannels).toEqual([
            {
                id: "channel-one",
                name: "渠道一",
                baseUrl: "/api/ai/system/channel-one",
                apiKey: "system",
                apiFormat: "openai",
                models: ["vendor-image", "sd2.0-mini933-720p-x5-15s"],
                enabled: true,
                hasApiKey: true,
            },
        ]);
        expect(result.logicalModels[0]?.bindings[0]).toEqual({
            id: "binding-one",
            channelId: "channel-one",
            upstreamModel: "vendor-image",
            enabled: true,
            priority: 1,
            capabilityProfile: {
                aspectRatios: ["1:1", "3:4"],
                resolutions: ["1K", "2K"],
                imageOptions: { sizeModes: ["auto", "ratio", "custom"], resolutions: ["1K", "2K"], qualities: ["auto", "high"], outputFormats: ["png"], responseFormats: ["url"] },
            },
        });
        expect(serialized).not.toContain("provider-secret");
        expect(serialized).not.toContain("internal-provider.example");
        expect(serialized).not.toContain("smtp.internal");
        expect(serialized).not.toContain("mail-secret");
        expect(serialized).not.toContain("private/create");
        expect(serialized).not.toContain("完整指令");
        expect(result.logicalModels[1].bindings[0].capabilityProfile).toMatchObject({
            supportsReferenceImage: true,
            supportsReferenceVideo: true,
            supportsReferenceAudio: true,
            maxReferenceImages: 9,
            maxReferenceVideos: 3,
            maxReferenceAudios: 3,
            maxReferenceTotal: 15,
            requiresReferenceImageOrVideo: true,
        });
        expect(result).not.toHaveProperty("mail");
        expect(result).not.toHaveProperty("agentSkills");
        expect(result).not.toHaveProperty("entitlements");
        expect(result).not.toHaveProperty("allowUserApiConfig");
        expect(result).not.toHaveProperty("freeDailyPoints");
        expect(result.site).not.toHaveProperty("homeShowcaseMode");
        expect(result.site).not.toHaveProperty("homeShowcaseItems");
        expect(result.site.socials).toEqual(settings.site.socials);
    });
});

describe("session cookie security", () => {
    it("ignores forwarded protocol headers unless proxy trust is configured", () => {
        const response = NextResponse.json({ ok: true });
        setSessionCookie(response, "session", new Request("http://localhost", { headers: { "x-forwarded-proto": "https" } }));

        expect(response.headers.get("set-cookie")).not.toContain("Secure");
    });

    it("uses Secure behind a configured HTTPS reverse proxy", () => {
        process.env.VOZEB_PRO_TRUSTED_PROXY_HOPS = "1";
        const response = NextResponse.json({ ok: true });
        setSessionCookie(response, "session", new Request("http://localhost", { headers: { "x-forwarded-proto": "https" } }));

        expect(response.headers.get("set-cookie")).toContain("Secure");
    });

    it("uses Secure for direct HTTPS requests", () => {
        const response = NextResponse.json({ ok: true });
        setSessionCookie(response, "session", new Request("https://example.test/login"));

        expect(response.headers.get("set-cookie")).toContain("Secure");
    });
});
