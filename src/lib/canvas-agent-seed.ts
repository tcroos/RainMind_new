import { appStorageKey } from "@/lib/storage-keys";

/**
 * 首页「Agent 画布」：先新建一块画布，把用户的需求（和选中的 Skill）存进 sessionStorage，
 * 画布页打开后读出来、展开 Agent 面板并自动发送一次，然后删掉这条记录。
 */
export type CanvasAgentSeed = { prompt: string; skillId?: string };

export function canvasAgentSeedKey(projectId: string) {
    return `${appStorageKey("canvas_agent_seed")}:${projectId}`;
}

export function writeCanvasAgentSeed(projectId: string, seed: CanvasAgentSeed) {
    try {
        window.sessionStorage.setItem(canvasAgentSeedKey(projectId), JSON.stringify(seed));
    } catch {
        /* 无痕模式写不进 sessionStorage：画布照常打开，只是不自动发送 */
    }
}

export function takeCanvasAgentSeed(projectId: string): CanvasAgentSeed | null {
    try {
        const key = canvasAgentSeedKey(projectId);
        const raw = window.sessionStorage.getItem(key);
        if (!raw) return null;
        window.sessionStorage.removeItem(key);
        const parsed = raw.startsWith("{") ? (JSON.parse(raw) as CanvasAgentSeed) : { prompt: raw };
        return parsed.prompt?.trim() ? { prompt: parsed.prompt.trim(), skillId: parsed.skillId || undefined } : null;
    } catch {
        return null;
    }
}
