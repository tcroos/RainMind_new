const MESSAGE = "参考素材过大，生成未开始。请减少参考图数量或压缩后重试。";
const RELAY_MEMORY_PROTECTION = /relay\s*(?:request\s+body\s+memory\s+protection|请求体\s*内存保护)/i;

/** Preserve only an explicit provider request_id, never infer one from free text. */
export function relayRequestBodyError(value: unknown): string | undefined {
    const messages: string[] = [];
    let requestId: string | undefined;
    const visit = (item: unknown, depth: number) => {
        if (depth > 4) return;
        if (typeof item === "string") {
            messages.push(item);
            if (item.trim().startsWith("{")) {
                try { visit(JSON.parse(item), depth + 1); } catch { /* Plain errors need no JSON envelope. */ }
            }
            return;
        }
        if (!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        if (!requestId && typeof record.request_id === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(record.request_id)) requestId = record.request_id;
        for (const key of ["message", "msg", "error", "response", "data"]) visit(record[key], depth + 1);
    };
    visit(value, 0);
    if (!messages.some(message => RELAY_MEMORY_PROTECTION.test(message))) return undefined;
    return requestId ? `${MESSAGE}（request_id: ${requestId}）` : MESSAGE;
}
