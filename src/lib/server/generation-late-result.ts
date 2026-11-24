import { appendGenerationTaskLateEvidence, getStoredGenerationTaskRecord } from "./generation-task-store";
import { scheduleGenerationTask } from "./generation-task-scheduler";
import type { GenerationTaskType } from "./generation-task-types";

/** Keep settlement-conflicting results for administrators, without public delivery. */
export async function retainLateGenerationResult(type: GenerationTaskType, id: string, result: unknown, options: { evidenceOnly?: boolean } = {}) {
    if (options.evidenceOnly) {
        await appendGenerationTaskLateEvidence(type, id, result);
        return;
    }
    const record = await getStoredGenerationTaskRecord(type, id);
    if (record?.status === "success") return;
    if (!options.evidenceOnly) {
        await scheduleGenerationTask(type, id, {
            executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "result_settlement_conflict",
            resultPayload: { ...record?.resultPayload, lateResult: result, reviewReason: "结果已返回，但原任务结算状态冲突，请管理员核查；未自动交付或扣回积分" },
        }, { cancellation: true });
        return;
    }
}
