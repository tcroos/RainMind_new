export type VideoBillingRule = { mode: "fixed" | "duration"; baseSeconds?: number; resolutionMultipliers?: Record<string, number>; referenceVideoSeconds?: boolean };

export type VideoBillingSnapshot = { version: 1; rule?: VideoBillingRule; outputSeconds: number; references: Array<{ storageKey: string; durationMs: number; billedSeconds: number }>; referenceSeconds: number; totalSeconds: number; charge?: { units: number; points: number } };

export function videoBillingSnapshot(rule: VideoBillingRule | undefined, outputSeconds: number, references: Array<{ storageKey: string; durationMs: number }>): VideoBillingSnapshot {
    if (!Number.isFinite(outputSeconds) || outputSeconds <= 0) throw new Error("视频计费必须明确输出时长");
    const items = rule?.mode === "duration" && rule.referenceVideoSeconds ? references.map((item) => {
        if (!Number.isFinite(item.durationMs) || item.durationMs <= 0) throw new Error("参考视频缺少可信时长，请重新上传后重试");
        return { ...item, billedSeconds: Math.ceil(item.durationMs / 1000) };
    }) : [];
    const referenceSeconds = items.reduce((sum, item) => sum + item.billedSeconds, 0);
    return { version: 1, rule, outputSeconds, references: items, referenceSeconds, totalSeconds: outputSeconds + referenceSeconds };
}

export function logicalVideoBillingRule(models: readonly { id: string; bindings: Array<{ enabled: boolean; priority: number; capabilityProfile?: { videoBilling?: VideoBillingRule } }> }[], modelId: string) {
    const model = models.find((item) => item.id === modelId);
    return model?.bindings.filter((binding) => binding.enabled).sort((a, b) => a.priority - b.priority)[0]?.capabilityProfile?.videoBilling;
}

export function normalizeVideoBillingRule(value: unknown): VideoBillingRule | undefined {
    if (!value || typeof value !== "object") return undefined;
    const rule = value as Record<string, unknown>;
    if (rule.mode === "fixed") return { mode: "fixed" };
    const baseSeconds = Number(rule.baseSeconds);
    if (rule.mode !== "duration" || !Number.isFinite(baseSeconds) || baseSeconds <= 0) return undefined;
    const resolutionMultipliers = rule.resolutionMultipliers && typeof rule.resolutionMultipliers === "object" && !Array.isArray(rule.resolutionMultipliers)
        ? Object.fromEntries(Object.entries(rule.resolutionMultipliers).filter(([key, value]) => /^\d+p?$/i.test(key) && typeof value === "number" && Number.isFinite(value) && value > 0).map(([key, value]) => [key.replace(/p$/i, ""), value]))
        : undefined;
    return { mode: "duration", baseSeconds, ...(rule.referenceVideoSeconds === true ? { referenceVideoSeconds: true } : {}), ...(resolutionMultipliers && Object.keys(resolutionMultipliers).length ? { resolutionMultipliers } : {}) };
}

export function videoBillingResolutionMultiplier(rule: VideoBillingRule | undefined, quality: unknown) {
    if (!rule?.resolutionMultipliers) return undefined;
    const keys = Object.keys(rule.resolutionMultipliers);
    if (!keys.length) return undefined;
    const key = String(quality || "").trim().toLowerCase().replace(/p$/, "");
    // 旧配置可能残留 720/1080/auto 等未声明的清晰度：回退到第一个已声明档位，避免整页崩溃。
    // 真正请求时后端会按绑定能力校验清晰度，非法值不会落到上游。
    const direct = !key || key === "auto" ? undefined : rule.resolutionMultipliers[key];
    const value = direct ?? rule.resolutionMultipliers[keys[0]];
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function videoBillingDurationMultiplier(rule: VideoBillingRule | undefined, seconds: unknown, fallback: number) {
    if (!rule) return fallback;
    if (rule.mode === "fixed") return 1;
    const duration = Number(seconds);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(rule.baseSeconds) || Number(rule.baseSeconds) <= 0) throw new Error("按时长计费模型必须提供有效生成时长");
    return duration / Number(rule.baseSeconds);
}
