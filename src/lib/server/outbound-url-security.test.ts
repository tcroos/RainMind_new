import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import { inspectResolveOutboundTarget, isSafeOutboundUrl, resolveSafeOutboundTarget } from "./outbound-url-security";

describe("outbound url security", () => {
    beforeEach(() => {
        mocks.lookup.mockReset();
        vi.unstubAllEnvs();
    });

    it("resolves a public hostname once and returns the exact address to connect", async () => {
        mocks.lookup.mockResolvedValue([
            { address: "8.8.8.8", family: 4 },
            { address: "8.8.4.4", family: 4 },
        ]);

        await expect(resolveSafeOutboundTarget("https://provider.example/v1/models")).resolves.toMatchObject({ address: "8.8.8.8", family: 4 });
        expect(mocks.lookup).toHaveBeenCalledWith("provider.example", { all: true, verbatim: true });
    });

    it("rejects mixed public and private DNS answers", async () => {
        mocks.lookup.mockResolvedValue([
            { address: "8.8.8.8", family: 4 },
            { address: "10.0.0.8", family: 4 },
        ]);
        await expect(isSafeOutboundUrl("https://provider.example/result")).resolves.toBe(false);
    });

    it("rejects documentation, benchmark, link-local, and multicast addresses", async () => {
        for (const address of ["192.0.2.1", "198.18.0.1", "198.51.100.2", "203.0.113.3", "169.254.169.254", "224.0.0.1"]) {
            await expect(isSafeOutboundUrl(`http://${address}/result`)).resolves.toBe(false);
        }
        await expect(isSafeOutboundUrl("http://[::ffff:127.0.0.1]/result")).resolves.toBe(false);
    });

    it("allows exact private hosts only when explicitly enabled and never allows metadata addresses", async () => {
        vi.stubEnv("VOZEB_PRO_ALLOW_PRIVATE_UPSTREAMS", "1");
        vi.stubEnv("VOZEB_PRO_PRIVATE_UPSTREAM_HOSTS", "localhost,provider.internal,169.254.169.254");
        mocks.lookup.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);

        await expect(isSafeOutboundUrl("http://provider.internal:11434/v1/models")).resolves.toBe(true);
        await expect(isSafeOutboundUrl("http://localhost:11434/v1/models")).resolves.toBe(true);
        await expect(isSafeOutboundUrl("http://169.254.169.254/latest/meta-data")).resolves.toBe(false);
        await expect(isSafeOutboundUrl("http://metadata.google.internal/computeMetadata/v1")).resolves.toBe(false);
    });

    it("allows proxy fake-IP answers only when the caller opts in", async () => {
        mocks.lookup.mockResolvedValue([{ address: "198.18.0.7", family: 4 }]);
        await expect(isSafeOutboundUrl("https://api.a6api.com/v1/images/generations")).resolves.toBe(false);
        await expect(isSafeOutboundUrl("https://api.a6api.com/v1/images/generations", { allowProxyFakeIp: true })).resolves.toBe(true);
        await expect(resolveSafeOutboundTarget("https://api.a6api.com/v1/images/generations", { allowProxyFakeIp: true })).resolves.toMatchObject({ address: "198.18.0.7" });
    });

    it("selects a usable public answer for proxied upstreams when DNS also returns Teredo", async () => {
        mocks.lookup.mockResolvedValue([
            { address: "2001::6ca0:aa21", family: 6 },
            { address: "104.244.43.128", family: 4 },
        ]);
        await expect(isSafeOutboundUrl("https://api.a6api.com/v1/images/generations")).resolves.toBe(false);
        await expect(resolveSafeOutboundTarget("https://api.a6api.com/v1/images/generations", { allowProxyFakeIp: true })).resolves.toMatchObject({ address: "104.244.43.128", family: 4 });
    });

    it("allows multiple public DNS addresses and returns all of them for diagnostics", async () => {
        mocks.lookup.mockResolvedValue([
            { address: "45.196.216.135", family: 4 },
            { address: "182.16.62.234", family: 4 },
            { address: "45.121.138.20", family: 4 },
        ]);

        await expect(inspectResolveOutboundTarget("https://api.a6api.com/v1/images/generations")).resolves.toMatchObject({
            ok: true,
            addresses: ["45.196.216.135", "182.16.62.234", "45.121.138.20"],
            target: { address: "45.196.216.135" },
        });
    });

    it("retries one transient DNS lookup failure before allowing the public target", async () => {
        mocks.lookup.mockRejectedValueOnce(Object.assign(new Error("EAI_AGAIN"), { code: "EAI_AGAIN" })).mockResolvedValueOnce([{ address: "45.196.216.135", family: 4 }]);

        await expect(inspectResolveOutboundTarget("https://api.a6api.com/v1/images/generations")).resolves.toMatchObject({ ok: true, target: { address: "45.196.216.135" } });
        expect(mocks.lookup).toHaveBeenCalledTimes(2);
    });

    it("reports continuous DNS failure distinctly after one retry", async () => {
        mocks.lookup.mockRejectedValueOnce(Object.assign(new Error("first dns failure"), { code: "EAI_AGAIN" })).mockRejectedValueOnce(Object.assign(new Error("second dns failure"), { code: "SERVFAIL" }));

        await expect(inspectResolveOutboundTarget("https://api.a6api.com/v1/images/generations")).resolves.toMatchObject({
            ok: false,
            reason: "dns_resolution_failed",
            addresses: [],
            dnsError: "SERVFAIL",
        });
    });

    it("reports private and mixed DNS answers without allowing them", async () => {
        mocks.lookup.mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]).mockResolvedValueOnce([
            { address: "8.8.8.8", family: 4 },
            { address: "192.168.1.10", family: 4 },
        ]);

        await expect(inspectResolveOutboundTarget("https://private.example/result")).resolves.toMatchObject({ ok: false, reason: "address_not_public", blockedAddresses: ["10.0.0.8"] });
        await expect(inspectResolveOutboundTarget("https://mixed.example/result")).resolves.toMatchObject({ ok: false, reason: "address_not_public", addresses: ["8.8.8.8", "192.168.1.10"], blockedAddresses: ["192.168.1.10"] });
    });

    it("classifies blocked hostnames, credentials, and invalid URLs", async () => {
        await expect(inspectResolveOutboundTarget("http://metadata.google.internal/latest")).resolves.toMatchObject({ ok: false, reason: "blocked_hostname" });
        await expect(inspectResolveOutboundTarget("https://user:secret@provider.example/result")).resolves.toMatchObject({ ok: false, reason: "credentials_not_allowed" });
        await expect(inspectResolveOutboundTarget("not a url")).resolves.toMatchObject({ ok: false, reason: "invalid_url" });
        expect(mocks.lookup).not.toHaveBeenCalled();
    });

    it("does not reject concurrent requests resolving to public DNS answers", async () => {
        mocks.lookup.mockResolvedValue([{ address: "45.196.216.135", family: 4 }, { address: "182.16.62.234", family: 4 }]);

        const results = await Promise.all(Array.from({ length: 20 }, () => inspectResolveOutboundTarget("https://api.a6api.com/v1/images/generations")));

        expect(results.every((result) => result.ok)).toBe(true);
        expect(mocks.lookup).toHaveBeenCalledTimes(20);
    });
});
