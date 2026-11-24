import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";

/** The URL must be generated from an authorized object-storage registration. */
export async function createObjectMediaDownloadResponse(request: Request, signedUrl: string) {
    const upstream = await fetchSafeOutbound(signedUrl, { signal: request.signal, redirect: "error" });
    if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        return Response.json({ error: "原文件读取失败" }, { status: 502 });
    }
    const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-length", "content-disposition"]) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { headers });
}
