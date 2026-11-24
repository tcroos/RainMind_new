import { NextResponse, type NextRequest } from "next/server";
import { getTrustedProxyHops } from "@/lib/server/trusted-proxy";

export function proxy(request: NextRequest) {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", contentSecurityPolicy);

    if (!request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/api/billing/webhooks/") || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        return securedNextResponse(requestHeaders, contentSecurityPolicy);
    }

    const requestOrigin = publicRequestOrigin(request);
    const origin = request.headers.get("origin");
    if (origin && origin !== requestOrigin) return securedJsonResponse({ error: "跨站请求已被拦截" }, 403, contentSecurityPolicy);

    const referer = request.headers.get("referer");
    if (referer) {
        try {
            if (new URL(referer).origin !== requestOrigin) return securedJsonResponse({ error: "跨站请求已被拦截" }, 403, contentSecurityPolicy);
        } catch {
            return securedJsonResponse({ error: "请求来源无效" }, 403, contentSecurityPolicy);
        }
    }

    return securedNextResponse(requestHeaders, contentSecurityPolicy);
}

export const config = {
    /* 静态资源和清单文件不需要走 middleware：少一次 CSP 生成和 origin 校验 */
    matcher: "/((?!_next/static|_next/image|favicon.ico|icon.svg|logo.svg|manifest.webmanifest|.*\\.(?:png|jpe?g|webp|avif|svg|ico|txt|xml|woff2?)$).*)",
};

function securedNextResponse(requestHeaders: Headers, contentSecurityPolicy: string) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
}

function securedJsonResponse(body: unknown, status: number, contentSecurityPolicy: string) {
    const response = NextResponse.json(body, { status });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
}

function buildContentSecurityPolicy(nonce: string) {
    const isDev = process.env.NODE_ENV !== "production";
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        `connect-src 'self' https:${isDev ? " http: ws: wss:" : ""}`,
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");
}

function publicRequestOrigin(request: NextRequest) {
    const trustForwarded = getTrustedProxyHops() > 0;
    const forwardedProto = trustForwarded ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : "";
    const forwardedHost = trustForwarded ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : "";
    const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
    const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    try {
        const origin = new URL(`${protocol}://${host}`);
        return origin.protocol === "http:" || origin.protocol === "https:" ? origin.origin : request.nextUrl.origin;
    } catch {
        return request.nextUrl.origin;
    }
}
