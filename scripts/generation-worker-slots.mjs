// Preserve the existing ten-task claim budget per lane, but refill each slot independently.
export const GENERATION_TASKS_PER_LANE = 10;

export async function runGenerationWorkerSlots({ lanes, runSlot }) {
    await Promise.all(Array.from({ length: lanes }, (_, lane) =>
        Promise.all(Array.from({ length: GENERATION_TASKS_PER_LANE }, (_, slot) => runSlot(lane + 1, slot + 1))),
    ));
}
