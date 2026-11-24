export const DEFAULT_SITE_TITLE = "RainMind";

export function resolveSiteTitle(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SITE_TITLE;
}
