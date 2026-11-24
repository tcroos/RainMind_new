const queue: Array<() => Promise<void>> = [];
let running = false;

/** One background image transcode at a time; a failed warm task never blocks later work. */
export function enqueueWarmImagePreview(task: () => Promise<void>) {
    queue.push(task);
    void drain();
}

async function drain() {
    if (running) return;
    running = true;
    try {
        while (queue.length) {
            const task = queue.shift()!;
            try {
                await task();
            } catch (error) {
                console.warn("Image preview warm task failed", error instanceof Error ? error.message : "unknown");
            }
        }
    } finally {
        running = false;
    }
}
