import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const BLOCKED_HOSTNAMES = ["metadata.google.internal", "metadata.goog", "metadata.azure.com", "instance-data"];
const NON_PUBLIC_IPV4_ADDRESSES = addressBlockList([
    ["0.0.0.0", 8, "ipv4"],
    ["10.0.0.0", 8, "ipv4"],
    ["100.64.0.0", 10, "ipv4"],
    ["127.0.0.0", 8, "ipv4"],
    ["169.254.0.0", 16, "ipv4"],
    ["172.16.0.0", 12, "ipv4"],
    ["192.0.0.0", 24, "ipv4"],
    ["192.0.2.0", 24, "ipv4"],
    ["192.88.99.0", 24, "ipv4"],
    ["192.168.0.0", 16, "ipv4"],
    ["198.18.0.0", 15, "ipv4"],
    ["198.51.100.0", 24, "ipv4"],
    ["203.0.113.0", 24, "ipv4"],
    ["224.0.0.0", 4, "ipv4"],
    ["240.0.0.0", 4, "ipv4"],
]);
const PROXY_FAKE_IP_ADDRESSES = addressBlockList([["198.18.0.0", 15, "ipv4"]]);
const NON_PUBLIC_IPV6_ADDRESSES = addressBlockList([
    ["::", 96, "ipv6"],
    ["::ffff:0:0", 96, "ipv6"],
    ["64:ff9b::", 96, "ipv6"],
    ["64:ff9b:1::", 48, "ipv6"],
    ["100::", 64, "ipv6"],
    ["2001::", 23, "ipv6"],
    ["2001:db8::", 32, "ipv6"],
    ["2002::", 16, "ipv6"],
    ["fc00::", 7, "ipv6"],
    ["fe80::", 10, "ipv6"],
    ["fec0::", 10, "ipv6"],
    ["ff00::", 8, "ipv6"],
]);
const PRIVATE_ALLOWLISTABLE_IPV4_ADDRESSES = addressBlockList([
    ["10.0.0.0", 8, "ipv4"],
    ["100.64.0.0", 10, "ipv4"],
    ["127.0.0.0", 8, "ipv4"],
    ["172.16.0.0", 12, "ipv4"],
    ["192.168.0.0", 16, "ipv4"],
]);
const PRIVATE_ALLOWLISTABLE_IPV6_ADDRESSES = addressBlockList([
    ["::1", 128, "ipv6"],
    ["fc00::", 7, "ipv6"],
    ["fec0::", 10, "ipv6"],
]);

export type SafeOutboundTarget = {
    url: URL;
    address: string;
    family: 4 | 6;
};

export type OutboundTargetInspection =
    | { ok: true; target: SafeOutboundTarget; addresses: string[] }
    | { ok: false; reason: "dns_resolution_failed" | "blocked_hostname" | "address_not_public" | "credentials_not_allowed" | "invalid_url"; addresses: string[]; blockedAddresses?: string[]; dnsError?: string };

export async function inspectResolveOutboundTarget(value: string | URL, options?: { allowCredentials?: boolean; allowProxyFakeIp?: boolean }): Promise<OutboundTargetInspection> {
    let url: URL;
    try {
        url = value instanceof URL ? new URL(value) : new URL(value);
    } catch {
        return { ok: false, reason: "invalid_url", addresses: [] };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "invalid_url", addresses: [] };
    if (!options?.allowCredentials && (url.username || url.password)) return { ok: false, reason: "credentials_not_allowed", addresses: [] };

    const hostname = normalizeHostname(url.hostname);
    if (!hostname || isBlockedHostname(hostname)) return { ok: false, reason: "blocked_hostname", addresses: [] };
    const privateAllowed = privateUpstreamHostAllowed(hostname);
    if ((hostname === "localhost" || hostname.endsWith(".localhost")) && !privateAllowed) return { ok: false, reason: "blocked_hostname", addresses: [] };
    const directFamily = isIP(hostname);
    if (directFamily) {
        const allowed = addressAllowed(hostname, privateAllowed, options?.allowProxyFakeIp);
        return allowed
            ? { ok: true, target: { url, address: hostname, family: directFamily as 4 | 6 }, addresses: [hostname] }
            : { ok: false, reason: "address_not_public", addresses: [hostname], blockedAddresses: [hostname] };
    }

    let resolved: Array<{ address: string; family: number }> = [];
    let dnsError = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            resolved = dedupeAddresses(await lookup(hostname, { all: true, verbatim: true }));
            dnsError = "";
            if (resolved.length) break;
            dnsError = "NO_ADDRESS";
        } catch (error) {
            dnsError = safeDnsError(error);
        }
    }
    if (dnsError) return { ok: false, reason: "dns_resolution_failed", addresses: [], dnsError };
    const addresses = resolved.map(({ address }) => address);
    if (!addresses.length) return { ok: false, reason: "dns_resolution_failed", addresses, dnsError: "NO_ADDRESS" };

    const blockedAddresses = resolved
        .filter(({ address }) => !addressAllowed(address, privateAllowed, options?.allowProxyFakeIp) && !(options?.allowProxyFakeIp && isTeredoAddress(address)))
        .map(({ address }) => address);
    if (blockedAddresses.length) return { ok: false, reason: "address_not_public", addresses, blockedAddresses };
    const selected = options?.allowProxyFakeIp ? resolved.find(({ address }) => addressAllowed(address, privateAllowed, true)) : resolved[0];
    if (!selected) return { ok: false, reason: "address_not_public", addresses, blockedAddresses: addresses };
    return { ok: true, target: { url, address: selected.address, family: selected.family as 4 | 6 }, addresses };
}

export async function resolveSafeOutboundTarget(value: string | URL, options?: { allowCredentials?: boolean; allowProxyFakeIp?: boolean }): Promise<SafeOutboundTarget | null> {
    const inspection = await inspectResolveOutboundTarget(value, options);
    return inspection.ok ? inspection.target : null;
}

export async function isSafeOutboundUrl(value: string, options?: { allowCredentials?: boolean; allowProxyFakeIp?: boolean }) {
    return Boolean(await resolveSafeOutboundTarget(value, options));
}

export function isProxyFakeIpAddress(address: string) {
    return isIP(address) === 4 && PROXY_FAKE_IP_ADDRESSES.check(address, "ipv4");
}

export function isPublicIpAddress(address: string) {
    const version = isIP(address);
    if (!version) return false;
    const mapped = mappedIpv4(address);
    if (mapped) return isPublicIpAddress(mapped);
    return !addressBlockListContains(address, version, NON_PUBLIC_IPV4_ADDRESSES, NON_PUBLIC_IPV6_ADDRESSES);
}

function addressAllowed(address: string, privateAllowed: boolean, allowProxyFakeIp = false) {
    return isPublicIpAddress(address) || (privateAllowed && isPrivateAllowlistableAddress(address)) || (allowProxyFakeIp && isProxyFakeIpAddress(address));
}

function isPrivateAllowlistableAddress(address: string) {
    const version = isIP(address);
    if (!version) return false;
    const mapped = mappedIpv4(address);
    if (mapped) return isPrivateAllowlistableAddress(mapped);
    return addressBlockListContains(address, version, PRIVATE_ALLOWLISTABLE_IPV4_ADDRESSES, PRIVATE_ALLOWLISTABLE_IPV6_ADDRESSES);
}

function addressBlockListContains(address: string, version: number, ipv4: BlockList, ipv6: BlockList) {
    return version === 4 ? ipv4.check(address, "ipv4") : ipv6.check(address, "ipv6");
}

function privateUpstreamHostAllowed(hostname: string) {
    if (process.env.VOZEB_PRO_ALLOW_PRIVATE_UPSTREAMS !== "1") return false;
    return (process.env.VOZEB_PRO_PRIVATE_UPSTREAM_HOSTS || "").split(",").map(normalizeHostname).filter(Boolean).includes(hostname);
}

function isBlockedHostname(hostname: string) {
    return BLOCKED_HOSTNAMES.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`) || hostname.includes(blocked));
}

function normalizeHostname(value: string) {
    return value
        .trim()
        .replace(/^\[|\]$/g, "")
        .toLowerCase();
}

function dedupeAddresses(addresses: Array<{ address: string; family: number }>) {
    const seen = new Set<string>();
    return addresses.filter((item): item is { address: string; family: 4 | 6 } => {
        if ((item.family !== 4 && item.family !== 6) || !isIP(item.address)) return false;
        const key = `${item.family}:${item.address.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function addressBlockList(entries: Array<[string, number, "ipv4" | "ipv6"]>) {
    const list = new BlockList();
    entries.forEach(([network, prefix, family]) => list.addSubnet(network, prefix, family));
    return list;
}

function mappedIpv4(address: string) {
    const match = address.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    return match?.[1] && isIP(match[1]) === 4 ? match[1] : "";
}

function isTeredoAddress(address: string) {
    return isIP(address) === 6 && address.toLowerCase().startsWith("2001:");
}

function safeDnsError(error: unknown) {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 80);
    return error instanceof Error ? error.name.slice(0, 80) : "DNS_ERROR";
}
