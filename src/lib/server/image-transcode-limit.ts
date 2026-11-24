import sharp from "sharp";

const MAX_CONCURRENT_TRANSCODES = 2;
let active = 0;
const waiters: Array<() => void> = [];

sharp.concurrency(1);
sharp.cache({ files: 0, items: 32, memory: 32 });

export async function withImageTranscodePermit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT_TRANSCODES) {
        await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
    try {
        return await task();
    } finally {
        active -= 1;
        waiters.shift()?.();
    }
}
