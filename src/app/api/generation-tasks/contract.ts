import { NextResponse } from "next/server";

export type GenerationKind = "image" | "video" | "audio" | "text";
export const generationKinds = new Set<string>(["image", "video", "audio", "text"]);

export function contractResponse(traceId: string, operation: string, body: Record<string, unknown>, status = 200, inheritedHeaders?: Headers) {
    const headers = new Headers({ "Cache-Control": "private, no-store", "X-Trace-Id": traceId });
    for (const name of ["retry-after", "x-vozeb-pro-points-cost", "x-vozeb-pro-points-remaining"]) {
        const value = inheritedHeaders?.get(name);
        if (value) headers.set(name, value);
    }
    // Log identifiers and outcome only; prompts, credentials and signed quotes stay private.
    console.info("Generation task contract", { traceId, operation, status });
    return NextResponse.json({ ...body, traceId }, { status, headers });
}

export function contractError(traceId: string, operation: string, status: number, code: string, message: string, headers?: Headers) {
    return contractResponse(traceId, operation, { ok: false, error: { code, message } }, status, headers);
}

export function forwardGenerationRequest(request: Request, path: string, input: Record<string, unknown>) {
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    return new Request(new URL(path, request.url), { method: "POST", headers, body: JSON.stringify(input), signal: request.signal });
}
