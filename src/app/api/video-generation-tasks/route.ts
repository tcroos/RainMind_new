import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { generationModelId } from "@/lib/server/generation-channel";
import { getStoredGenerationTaskByRequest } from "@/lib/server/generation-task-store";
import type { VideoTask } from "@/lib/server/video-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 2400;

export { POST } from "./video-generation-route";

export async function GET(request: Request) {
    const headers = { "Cache-Control": "private, no-store" };
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const clientRequestId = params.get("clientRequestId")?.trim();
    const projectId = params.get("projectId")?.trim();
    const attemptNo = Number(params.get("attemptNo"));
    if (!clientRequestId || !projectId || !Number.isSafeInteger(attemptNo) || attemptNo < 1) return NextResponse.json({ error: "任务查询参数不完整" }, { status: 400, headers });
    const task = await getStoredGenerationTaskByRequest<VideoTask>("video", user.id, clientRequestId, attemptNo);
    if (!task || task.userId !== user.id || task.surface !== "canvas" || task.projectId !== projectId) return NextResponse.json({ task: null }, { headers });
    return NextResponse.json({ task: { id: task.id, model: generationModelId(task.config), durationSeconds: task.requestedDurationSeconds } }, { headers });
}
