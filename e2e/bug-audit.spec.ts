import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { createCanvasProject, deleteCanvasProject, expectCanvasSaved, node } from "./canvas-e2e-helpers";

test("canvas repairs: existing image regenerates in place without referencing itself", async ({ page, request }) => {
    const fixture = `http://127.0.0.1:${process.env.VOZEB_PRO_PROTOCOL_FIXTURE_PORT}`;
    const project = await createCanvasProject(request, {
        title: `Regenerate ${randomUUID()}`,
        viewport: { x: 20, y: 90, k: 1 },
        nodes: [node("regenerate-image", "image", 10, 10, 160, 100, { content: `${fixture}/media/fixture.png`, status: "success", prompt: "old prompt", count: 1 })],
        connections: [],
    });
    try {
        let submitted: Record<string, unknown> | undefined;
        await page.route("**/api/image-tasks", async (route) => {
            if (route.request().method() === "POST") submitted = route.request().postDataJSON();
            await route.continue();
        });
        await page.goto(`/canvas/${project.id}`);
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        const item = page.locator('[data-node-id="regenerate-image"]');
        await item.click({ position: { x: 40, y: 20 } });
        const panel = page.locator("[data-canvas-node-panel]");
        await panel.getByRole("textbox", { name: "节点提示词" }).fill("a new blue teapot");
        await panel.getByRole("button", { name: "生成", exact: true }).click();
        await expect.poll(() => submitted).toBeDefined();
        expect(submitted!.references || []).toEqual([]);
        await expect(page.locator("[data-node-id]")).toHaveCount(1);
        await expect
            .poll(async () => {
                const saved = (await (await request.get(`/api/canvas/projects/${project.id}`)).json()).data.project;
                return saved.nodes[0].metadata.status;
            })
            .toBe("success");
        await expectCanvasSaved(page);
        await page.reload();
        await expect(page.locator('[data-node-id="regenerate-image"]')).toBeVisible();
        await expect(page.locator("[data-node-id]")).toHaveCount(1);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas repairs: image and video duplicates retain incoming links and parameters", async ({ page, request }) => {
    const project = await createCanvasProject(request, {
        title: `Duplicate ${randomUUID()}`,
        viewport: { x: 20, y: 90, k: 1 },
        nodes: [
            node("reference", "text", 10, 10, 80, 60, { content: "reference" }),
            node("original-image", "image", 120, 10, 100, 80, { prompt: "image version", model: "fixture-image", size: "9:16", count: 1 }),
            node("original-video", "video", 120, 180, 100, 80, { prompt: "video version", model: "fixture-video", size: "16:9", seconds: "10", vquality: "720" }),
        ],
        connections: [
            { id: "image-link", fromNodeId: "reference", toNodeId: "original-image" },
            { id: "video-link", fromNodeId: "reference", toNodeId: "original-video" },
        ],
    });
    try {
        await page.goto(`/canvas/${project.id}`);
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        for (const id of ["original-image", "original-video"]) {
            await page.locator("[data-canvas-surface]").click({ position: { x: 5, y: 5 } });
            await page.locator(`[data-node-id="${id}"]`).click({ button: "right", position: { x: 20, y: 20 } });
            await page.getByRole("menuitem", { name: "添加副本", exact: true }).click();
            await expectCanvasSaved(page);
        }
        await expect(page.locator("[data-node-id]")).toHaveCount(5);
        const read = async () => (await (await request.get(`/api/canvas/projects/${project.id}`)).json()).data.project;
        const saved = await read();
        for (const id of ["original-image", "original-video"]) {
            const original = saved.nodes.find((item: { id: string }) => item.id === id);
            const copy = saved.nodes.find((item: { title: string }) => item.title === `${id} 副本`);
            expect(copy.metadata).toMatchObject(original.metadata);
            expect(saved.connections).toContainEqual(expect.objectContaining({ fromNodeId: "reference", toNodeId: copy.id }));
            expect(saved.connections.filter((link: { toNodeId: string }) => link.toNodeId === id)).toHaveLength(1);
        }
        await page.reload();
        await expect(page.locator("[data-node-id]")).toHaveCount(5);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas portrait upload matches its frame before reload", async ({ page, request }) => {
    const project = await createCanvasProject(request, { title: `Portrait ${randomUUID()}`, viewport: { x: 20, y: 20, k: 1 }, nodes: [], connections: [] });
    try {
        await page.goto(`/canvas/${project.id}`);
        await expect(page.getByText("项目正在加载中...", { exact: true })).toHaveCount(0, { timeout: 5000 });
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "上传素材", exact: true }).click();
        await (
            await chooser
        ).setFiles({
            name: "portrait.png",
            mimeType: "image/png",
            buffer: await sharp({ create: { width: 180, height: 320, channels: 3, background: "#456789" } })
                .png()
                .toBuffer(),
        });
        const item = page.locator("[data-node-id]");
        await expect(item).toHaveCount(1);
        await expect
            .poll(async () => {
                const box = await item.boundingBox();
                return box!.width / box!.height;
            })
            .toBeCloseTo(9 / 16, 2);
        await expectCanvasSaved(page);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas video preferences combine sections and synchronize bounded duration", async ({ page, request }) => {
    const project = await createCanvasProject(request, {
        title: `Preferences ${randomUUID()}`,
        viewport: { x: page.viewportSize().width >= 1000 ? 300 : 20, y: 20, k: 1 },
        nodes: [node("preferences-video", "video", 130, 20, 100, 80, { prompt: "镜头缓缓推进", status: "success" })],
        connections: [],
    });
    try {
        await page.goto(`/canvas/${project.id}`);
        await expect(page.getByText("项目正在加载中...", { exact: true })).toHaveCount(0, { timeout: 5000 });
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        await page.locator('[data-node-id="preferences-video"]').click({ position: { x: 30, y: 30 } });
        const panel = page.locator("[data-canvas-node-panel]");
        const header = panel.locator("[data-canvas-prompt-header]");
        const headerButtons = header.getByRole("button");
        const libraryBox = await headerButtons.first().boundingBox();
        const expandBox = await header.getByRole("button", { name: "放大提示词输入" }).boundingBox();
        expect(libraryBox).not.toBeNull();
        expect(expandBox).not.toBeNull();
        expect(libraryBox!.x).toBeLessThan(expandBox!.x);
        expect(Math.abs(libraryBox!.width - expandBox!.width)).toBeLessThan(1);
        expect(Math.abs(libraryBox!.height - expandBox!.height)).toBeLessThan(1);
        expect(Math.abs(libraryBox!.y + libraryBox!.height / 2 - expandBox!.y - expandBox!.height / 2)).toBeLessThan(2);
        await expect(panel.getByRole("button", { name: "视频参考方式", exact: true })).toBeVisible();
        const model = panel.getByRole("combobox");
        await model.click();
        await expect(page.getByRole("listbox")).toBeVisible();
        await panel.getByRole("textbox", { name: "节点提示词" }).click();
        await expect(page.getByRole("listbox")).toHaveCount(0);
        await model.click();
        await panel.getByRole("button", { name: "视频参考方式", exact: true }).click();
        await expect(page.getByRole("listbox")).toHaveCount(0);
        await expect(page.locator("[data-canvas-video-reference-settings]")).toBeVisible();
        await panel.getByRole("button", { name: /^视频设置：/ }).click();
        await expect(page.locator("[data-canvas-video-reference-settings]")).not.toBeVisible();
        const preferences = page.locator("[data-creative-generation-preferences]");
        await expect(preferences).toBeVisible();
        await expect(preferences.getByRole("tablist")).toHaveCount(0);
        await expect(preferences.getByText("参考方式", { exact: true })).toHaveCount(0);
        const duration = preferences.getByRole("spinbutton", { name: "输入视频时长" });
        await duration.fill("17");
        await expect(preferences.getByRole("slider", { name: "拖动视频时长" })).toHaveValue("17");
        await duration.fill("50");
        await expect(duration).toHaveValue("30");
        await duration.fill("1");
        await expect(duration).toHaveValue("2");
        await page.keyboard.press("Escape");
        await expectCanvasSaved(page);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas media and editable prompts survive zoom and reload", async ({ page, request }) => {
    const prompt = "保留人物并修改背景光线";
    const fixture = `http://127.0.0.1:${process.env.VOZEB_PRO_PROTOCOL_FIXTURE_PORT}`;
    const project = await createCanvasProject(request, {
        title: `Media ${randomUUID()}`,
        viewport: { x: 20, y: 70, k: 1 },
        nodes: [
            node("persist-image", "image", 280, 250, 100, 100, { content: "/logo.svg", sourcePrompt: prompt, prompt, status: "success" }),
            node("persist-video", "video", 420, 250, 100, 100, { serverUrl: `${fixture}/media/fixture.mp4`, sourcePrompt: prompt, prompt, status: "success" }),
        ],
        connections: [],
    });
    try {
        await page.goto(`/canvas/${project.id}`);
        const image = page.locator('[data-node-id="persist-image"]');
        await expect.poll(() => image.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(page.locator('[data-node-id="persist-video"] video')).toHaveAttribute("src", new RegExp(encodeURIComponent(`${fixture}/media/fixture.mp4`)));
        const video = page.locator('[data-node-id="persist-video"] video');
        await video.click({ position: { x: 30, y: 20 } });
        await expect(page.locator("[data-canvas-node-panel]")).toBeVisible();
        await expect(page.getByRole("textbox", { name: "节点提示词" })).toHaveValue(prompt);
        await page.keyboard.press("Escape");
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        await image.click({ position: { x: 20, y: 20 } });
        const input = page.getByRole("textbox", { name: "节点提示词" });
        await expect(input).toHaveValue(prompt);
        expect(await input.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
        await expect(input).toHaveAttribute("rows", "4");
        expect((await input.boundingBox())!.height).toBeCloseTo(112, 0);
        await expect(page.locator("[data-canvas-node-panel] .canvas-composer-model-picker img")).toHaveCount(0);
        await expect(page.locator("[data-canvas-node-panel] .canvas-composer-model-picker")).not.toHaveAttribute("title", /.+/);
        await input.fill(`${prompt}，增加暖色`);
        await page.keyboard.press("Escape");
        const box = await image.boundingBox();
        await page.mouse.move(box!.x, box!.y);
        await page.mouse.wheel(0, 600);
        await expect.poll(async () => Number(await page.getByRole("slider", { name: "放大/缩小画布" }).inputValue())).toBeLessThan(100);
        const visibleSrc = await image.locator("img").getAttribute("src");
        await expect(image.locator("img")).toHaveAttribute("src", visibleSrc!);
        await expect.poll(() => image.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expectCanvasSaved(page);
        await page.reload();
        await expect(image).toBeVisible();
        await image.click({ position: { x: 20, y: 20 } });
        await expect(input).toHaveValue(`${prompt}，增加暖色`);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas connection edge pans while pointer stays at boundary", async ({ page, request }) => {
    const project = await createCanvasProject(request, { title: `Edge pan ${randomUUID()}`, viewport: { x: 20, y: 70, k: 1 }, nodes: [node("edge-pan-source", "image", 100, 80, 80, 80, {})], connections: [] });
    try {
        await page.goto(`/canvas/${project.id}`);
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        const surface = page.locator("[data-canvas-surface]");
        const world = page.locator("[data-canvas-world-viewport] > div");
        const source = page.locator('[data-node-id="edge-pan-source"]');
        const sourceBox = await source.boundingBox();
        await page.mouse.move(sourceBox!.x + 40, sourceBox!.y + 40);
        const handle = await source.locator('[aria-label="输出连接点"]').boundingBox();
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
        await page.mouse.down();
        const initial = await world.getAttribute("style");
        const bounds = await surface.boundingBox();
        await page.mouse.move(bounds!.x + bounds!.width - 4, bounds!.y + bounds!.height / 2, { steps: 12 });
        await expect.poll(() => world.getAttribute("style")).not.toBe(initial);
        const first = await world.getAttribute("style");
        await expect.poll(() => world.getAttribute("style")).not.toBe(first);
        await expect(surface.locator("[data-canvas-connection-preview]")).toBeVisible();
        await page.mouse.up();
        await expect(page.locator("[data-connection-create-menu]")).toBeVisible();
        await expectCanvasSaved(page);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas connections: reverse curves, live preview and scaled pointer drop agree", async ({ page, request }) => {
    const project = await createCanvasProject(request, {
        title: `Connections ${randomUUID()}`,
        viewport: { x: 20, y: 70, k: 1 },
        nodes: [node("curve-source", "image", 190, 80, 80, 80, {}), node("curve-target", "image", 30, 80, 80, 80, {})],
        connections: [],
    });
    try {
        await page.goto(`/canvas/${project.id}`);
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        const surface = page.locator("[data-canvas-surface]");
        for (const scale of [100, 60]) {
            if (scale === 60) {
                const anchor = await page.locator('[data-node-id="curve-source"]').boundingBox();
                await page.mouse.move(anchor!.x, anchor!.y);
                await page.mouse.wheel(0, (-100 * Math.log(0.6)) / Math.log(1.1));
                await expect.poll(async () => Number(await page.getByRole("slider", { name: "放大/缩小画布" }).inputValue())).toBeLessThan(100);
            }
            const source = page.locator('[data-node-id="curve-source"]');
            const target = page.locator('[data-node-id="curve-target"]');
            const sourceRect = await source.boundingBox();
            const targetRect = await target.boundingBox();
            await page.mouse.move(sourceRect!.x + sourceRect!.width / 2, sourceRect!.y + sourceRect!.height / 2);
            const output = source.locator('[aria-label="输出连接点"]');
            const start = await output.boundingBox();
            expect(start).not.toBeNull();
            await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
            await page.mouse.down();
            await page.mouse.move(targetRect!.x - 10, targetRect!.y + targetRect!.height / 2, { steps: 15 });
            const preview = surface.locator("[data-canvas-connection-preview]");
            await expect(preview).toBeVisible();
            await expect(preview).not.toHaveAttribute("stroke-dasharray");
            await expect(preview).toHaveAttribute("stroke-width", "1.5");
            const path = await preview.getAttribute("d");
            expect(path).toContain(" C ");
            expect(path).not.toMatch(/ [LQ] /);
            await page.mouse.up();
            const edge = surface.locator("[data-connection-id]");
            await expect(edge).toHaveCount(1);
            await expect(edge.locator("path").nth(1)).toHaveAttribute("d", path!);
            const point = await edge
                .locator("path")
                .first()
                .evaluate((element) => {
                    const path = element as SVGPathElement;
                    const point = path.getPointAtLength(path.getTotalLength() / 2);
                    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
                    return { x: screen.x, y: screen.y };
                });
            await page.mouse.click(point.x, point.y);
            await page.keyboard.press("Delete");
            await expect(edge).toHaveCount(0);
        }
        const source = page.locator('[data-node-id="curve-source"]');
        const sourceBounds = await source.boundingBox();
        await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
        const handleBounds = await source.locator('[aria-label="输出连接点"]').boundingBox();
        await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, handleBounds!.y + handleBounds!.height / 2);
        await page.mouse.down();
        await page.mouse.move(sourceBounds!.x + sourceBounds!.width + 60, sourceBounds!.y + sourceBounds!.height + 130, { steps: 12 });
        await page.mouse.up();
        const createMenu = page.locator("[data-connection-create-menu]");
        await expect(createMenu).toBeVisible();
        await expect(surface.locator("[data-canvas-connection-preview]")).toBeVisible();
        await createMenu.getByRole("button", { name: "视频生成", exact: true }).click();
        await expect(createMenu).toHaveCount(0);
        await expect(surface.locator("[data-canvas-connection-preview]")).toHaveCount(0);
        await expect(surface.locator("[data-connection-id]")).toHaveCount(1);
        const newVideo = page.locator("[data-node-id]").last();
        const createdBounds = await newVideo.boundingBox();
        expect(Math.abs(createdBounds!.x - (sourceBounds!.x + sourceBounds!.width + 60))).toBeLessThan(2);
        expect(Math.abs(createdBounds!.y + createdBounds!.height / 2 - (sourceBounds!.y + sourceBounds!.height + 130))).toBeLessThan(2);
        await expect(page.locator("[data-canvas-node-panel]")).toBeVisible();
        await expectCanvasSaved(page);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas repairs: slow loading and real failure retry", async ({ page, request }) => {
    const project = await createCanvasProject(request, { title: `Loading ${randomUUID()}`, nodes: [], connections: [] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const endpoint = `**/api/canvas/projects/${project.id}`;
    try {
        await page.route(endpoint, async (route) => {
            await gate;
            await route.continue();
        });
        await page.goto(`/canvas/${project.id}`);
        await expect(page.getByText("项目正在加载中...", { exact: true })).toBeVisible();
        await page.waitForTimeout(4500); // Deliberately crosses the old four-second deadline.
        await expect(page.getByText("项目暂未加载完成", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "重新加载", exact: true })).toHaveCount(0);
        release();
        await expect(page.locator("[data-canvas-surface]")).toBeVisible();
        await page.unroute(endpoint);
        let fail = true;
        await page.route(endpoint, (route) => (fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 1, msg: "测试加载失败" }) }) : route.continue()));
        await page.reload();
        await expect(page.getByRole("alert").filter({ hasText: "项目加载失败" })).toContainText("测试加载失败");
        fail = false;
        await page.getByRole("button", { name: "重新加载", exact: true }).click();
        await expect(page.locator("[data-canvas-surface]")).toBeVisible();
    } finally {
        release();
        await page.unroute(endpoint);
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas repairs: selected video controls and zoom stay inside canvas", async ({ page, request }) => {
    const fixture = `http://127.0.0.1:${process.env.VOZEB_PRO_PROTOCOL_FIXTURE_PORT}`;
    const project = await createCanvasProject(request, {
        title: `Video controls ${randomUUID()}`,
        viewport: { x: 20, y: 90, k: 1 },
        nodes: [node("controls-video", "video", 10, 20, 160, 100, { content: `${fixture}/media/fixture.mp4`, status: "success" })],
        connections: [],
    });
    try {
        await page.goto(`/canvas/${project.id}`);
        const videoNode = page.locator('[data-node-id="controls-video"]');
        const video = videoNode.locator("video");
        await expect(video).toBeVisible();
        await expect(video).not.toHaveAttribute("controls");
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        await videoNode.click({ position: { x: 40, y: 20 } });
        await expect(video).toHaveAttribute("controls", "");
        await expect(video).toHaveAttribute("controlslist", /noplaybackrate/);
        const scale = await page.evaluate(() => ({ dpr: devicePixelRatio, scale: visualViewport!.scale, width: innerWidth }));
        const zoom = page.getByRole("slider", { name: "放大/缩小画布" });
        const before = await zoom.inputValue();
        await video.hover();
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -100);
        await page.keyboard.up("Control");
        await expect.poll(() => zoom.inputValue()).not.toBe(before);
        expect(await page.evaluate(() => ({ dpr: devicePixelRatio, scale: visualViewport!.scale, width: innerWidth }))).toEqual(scale);
        const textbox = page.getByRole("textbox", { name: "节点提示词" });
        await textbox.hover();
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -100);
        await page.keyboard.up("Control");
        expect(await page.evaluate(() => ({ dpr: devicePixelRatio, scale: visualViewport!.scale, width: innerWidth }))).toEqual(scale);
        const handle = await videoNode.locator('[data-canvas-handle="source"]').boundingBox();
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
        await page.mouse.down();
        await expect(page.locator("[data-canvas-node-panel]")).toHaveCount(0);
        await page.mouse.move(handle!.x + 60, handle!.y + 120, { steps: 5 });
        await page.mouse.up();
        await page.keyboard.press("Escape");
        await page.locator("[data-canvas-surface]").click({ position: { x: 10, y: 10 } });
        await expect(video).not.toHaveAttribute("controls");
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas repairs: dragging releases over video controls and after a missed pointerup", async ({ page, request }) => {
    const fixture = `http://127.0.0.1:${process.env.VOZEB_PRO_PROTOCOL_FIXTURE_PORT}`;
    const project = await createCanvasProject(request, {
        title: `Drag release ${randomUUID()}`,
        viewport: { x: 20, y: 90, k: 1 },
        nodes: [node("drag-video", "video", 10, 20, 220, 140, { content: `${fixture}/media/fixture.mp4`, status: "success" })],
        connections: [],
    });
    try {
        await page.addInitScript(() => {
            window.addEventListener(
                "pointerup",
                (event) => {
                    if (document.documentElement.hasAttribute("data-test-miss-release")) {
                        document.documentElement.removeAttribute("data-test-miss-release");
                        event.stopImmediatePropagation();
                    }
                },
                true,
            );
        });
        await page.goto(`/canvas/${project.id}`);
        const item = page.locator('[data-node-id="drag-video"]');
        const video = item.locator("video");
        await expect(video).toBeVisible();
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        await item.click({ position: { x: 40, y: 20 } });
        await expect(video).toHaveAttribute("controls", "");
        for (const missedRelease of [false, true]) {
            const before = (await item.boundingBox())!;
            await video.evaluate((element, missed) => {
                if (missed) document.documentElement.setAttribute("data-test-miss-release", "");
                else element.addEventListener("pointerup", (event) => event.stopImmediatePropagation(), { once: true });
            }, missedRelease);
            await page.mouse.move(before.x + 60, before.y + 30);
            await page.mouse.down();
            await page.mouse.move(before.x + 100, before.y + 55, { steps: 6 });
            await expect.poll(async () => (await item.boundingBox())!.x).toBeGreaterThan(before.x + 30);
            await page.mouse.up();
            const released = (await item.boundingBox())!;
            await page.mouse.move(released.x + 120, released.y + 70, { steps: 5 });
            await expect.poll(async () => (await item.boundingBox())!.x).toBeCloseTo(released.x, 0);
            expect((await item.boundingBox())!.y).toBeCloseTo(released.y, 0);
        }
        const beforeSeek = (await item.boundingBox())!;
        const media = (await video.boundingBox())!;
        await page.mouse.move(media.x + media.width / 2, media.y + media.height - 16);
        await page.mouse.down();
        await page.mouse.move(media.x + media.width / 2 + 25, media.y + media.height - 16, { steps: 4 });
        await page.mouse.up();
        await page.mouse.move(beforeSeek.x + 80, beforeSeek.y + 20);
        expect((await item.boundingBox())!.x).toBeCloseTo(beforeSeek.x, 0);
        expect((await item.boundingBox())!.y).toBeCloseTo(beforeSeek.y, 0);
    } finally {
        await page.mouse.up();
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas repairs: upload placeholder moves, retries and stays deleted", async ({ page, request }) => {
    const project = await createCanvasProject(request, { title: `Uploads ${randomUUID()}`, viewport: { x: 20, y: 20, k: 1 }, nodes: [], connections: [] });
    let release!: () => void;
    let gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let fail = true;
    const endpoint = "**/api/reference-assets";
    try {
        await page.goto(`/canvas/${project.id}`);
        await expect(page.locator("[data-canvas-surface]")).toBeVisible();
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        await page.route(endpoint, async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            await gate;
            return fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试上传失败" }) }) : route.continue();
        });
        const payload = {
            name: "upload.png",
            mimeType: "image/png",
            buffer: await sharp({ create: { width: 120, height: 80, channels: 3, background: "#456789" } })
                .png()
                .toBuffer(),
        };
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "上传素材", exact: true }).click();
        await (await chooser).setFiles(payload);
        const item = page.locator("[data-node-id]");
        await expect(item).toHaveCount(1);
        await expect(item.getByRole("status")).toHaveText("上传中");
        const selectMode = page.getByRole("button", { name: "切换到框选模式" });
        if (await selectMode.isVisible()) await selectMode.click();
        const original = await item.boundingBox();
        await page.mouse.move(original!.x + original!.width / 2, original!.y + original!.height / 2);
        await page.mouse.down();
        await page.mouse.move(original!.x + original!.width / 2 + 20, original!.y + original!.height / 2 + 20, { steps: 5 });
        await page.mouse.up();
        await expect.poll(async () => (await item.boundingBox())!.x).toBeGreaterThan(original!.x + 15);
        release();
        await expect(item).toContainText("测试上传失败");
        fail = false;
        await item.getByRole("button", { name: "重试", exact: true }).click();
        await expect(item.locator("img")).toBeVisible();
        await expectCanvasSaved(page);
        gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const next = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "上传素材", exact: true }).click();
        await (await next).setFiles(payload);
        await expect(item).toHaveCount(2);
        await page.keyboard.press("Delete");
        await expect(item).toHaveCount(0);
        release();
        await expectCanvasSaved(page);
        await page.reload();
        await expect(item).toHaveCount(0);
    } finally {
        release?.();
        await page.unroute(endpoint);
        await deleteCanvasProject(request, project.id);
    }
});

test("canvas interactions: panel dismissal, references, context menu and remembered mode", async ({ page, request }) => {
    const project = await createCanvasProject(request, {
        title: `Interactions ${randomUUID()}`,
        viewport: { x: 40, y: 80, k: 1 },
        nodes: [node("interaction-source", "image", 20, 80, 100, 100, { content: "/logo.svg" }), node("interaction-target", "image", 180, 100, 100, 100, {})],
        connections: [{ id: "interaction-edge", fromNodeId: "interaction-source", toNodeId: "interaction-target" }],
    });
    try {
        await page.goto(`/canvas/${project.id}`);
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        const surface = page.locator("[data-canvas-surface]");
        const target = page.locator('[data-node-id="interaction-target"]');
        const panel = page.locator("[data-canvas-node-panel]");
        const selectMode = page.getByRole("button", { name: "切换到框选模式" });
        if (await selectMode.isVisible()) await selectMode.click();
        for (const dark of [false, true]) {
            await page.getByRole("button", { name: "画布外观", exact: true }).click();
            await page
                .locator(".canvas-appearance-panel")
                .getByRole("button", { name: dark ? "切换到深色主题" : "切换到浅色主题", exact: true })
                .click();
            await page.getByRole("button", { name: "画布外观", exact: true }).click();
            await target.click({ position: { x: 35, y: 35 } });
            await expect(panel).toBeVisible();
            const bounds = await panel.boundingBox();
            const anchor = await target.boundingBox();
            expect(Math.abs(bounds!.y - anchor!.y - anchor!.height - 12)).toBeLessThan(2);
            expect(Math.abs(bounds!.x + bounds!.width / 2 - anchor!.x - anchor!.width / 2)).toBeLessThan(2);
            await expect(panel.getByRole("button", { name: "定位图片1" })).toBeVisible();
            const reference = panel.locator("[data-canvas-panel-references] > div").first();
            expect((await reference.boundingBox())!.width).toBeCloseTo(48, 0);
            const referenceButton = reference.locator("button").first();
            expect(await referenceButton.getAttribute("title")).toBeNull();
            await reference.hover();
            await expect(panel.getByRole("button", { name: "移除图片1引用" })).toHaveCSS("opacity", "1");
            const input = panel.getByRole("textbox", { name: "节点提示词" });
            await input.fill("@");
            const mentions = page.locator("[data-canvas-resource-mention-menu]");
            await expect(mentions).toBeVisible();
            const menuBox = await mentions.boundingBox();
            const inputBox = await input.boundingBox();
            expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(inputBox!.y);
            await mentions.getByRole("button").first().click();
            await expect(input).toHaveValue("图片1 ");
            expect(await input.evaluate((element) => getComputedStyle(element).color)).not.toBe("rgba(0, 0, 0, 0)");
            await panel.getByRole("textbox", { name: "节点提示词" }).fill("Keep draft");
            await page.mouse.move(12, 100);
            await expect(page.locator(".ant-popover:not(.ant-popover-hidden)")).toHaveCount(0);
            await expect(panel).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(panel).toHaveCount(0);
            await target.click({ position: { x: 35, y: 35 } });
            await expect(panel).toBeVisible();
            await surface.click({ position: { x: 12, y: 100 } });
            await expect(panel).toHaveCount(0);
        }
        await target.click({ position: { x: 35, y: 35 } });
        await expect(panel).toBeVisible();
        const targetRect = await target.boundingBox();
        await page.mouse.move(targetRect!.x + 35, targetRect!.y + 35);
        await page.mouse.down();
        await page.mouse.move(targetRect!.x + 60, targetRect!.y + 60, { steps: 8 });
        await expect(panel).toBeAttached();
        await page.mouse.up();
        const movedPanel = await panel.boundingBox();
        const movedNode = await target.boundingBox();
        expect(Math.abs(movedPanel!.y - movedNode!.y - movedNode!.height - 12)).toBeLessThan(2);
        await panel.locator("[data-canvas-panel-references] > div").first().hover();
        await panel.getByRole("button", { name: "移除图片1引用" }).click();
        await expect(page.locator('[data-connection-id="interaction-edge"]')).toHaveCount(0);
        await expect(page.locator('[data-node-id="interaction-source"]')).toHaveCount(1);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "切换到小手模式" }).click();
        await expectCanvasSaved(page);
        await page.reload();
        await expect(surface).toHaveAttribute("data-canvas-interaction-mode", "pan");
        const rect = await surface.boundingBox();
        await page.mouse.click(rect!.x + 20, rect!.y + 350, { button: "right" });
        const menu = page.locator("[data-canvas-node-create-menu]");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("button")).toHaveText(["×", "上传选择图片、视频或音频", "视频", "图片", "文字脚本、广告词、品牌文案", "音频", "全景图生成 2:1 环境全景", "生成配置模型、尺寸、数量和输入顺序"]);
        const chooserPromise = page.waitForEvent("filechooser");
        await menu.getByRole("button", { name: /^上传/ }).click();
        const chooser = await chooserPromise;
        expect(chooser.isMultiple()).toBe(true);
        const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
        const fixture = `http://127.0.0.1:${process.env.VOZEB_PRO_PROTOCOL_FIXTURE_PORT}`;
        const video = await request.get(`${fixture}/media/fixture.mp4`);
        const audio = await request.get(`${fixture}/media/fixture.wav`);
        await chooser.setFiles([
            { name: "reference-one.png", mimeType: "image/png", buffer: image },
            { name: "reference-two.png", mimeType: "image/png", buffer: image },
            { name: "reference-video.mp4", mimeType: "video/mp4", buffer: await video.body() },
            { name: "reference-audio.wav", mimeType: "audio/wav", buffer: await audio.body() },
        ]);
        await expect(page.locator("[data-node-id]")).toHaveCount(6);
        await expectCanvasSaved(page);
        await page.reload();
        await expect(page.locator("[data-node-id]")).toHaveCount(6);
        const upload = page.getByRole("button", { name: "上传素材", exact: true });
        const canceled = page.waitForEvent("filechooser");
        await upload.click();
        await (await canceled).setFiles([]);
        await expect(page.locator("[data-node-id]")).toHaveCount(6);
        const invalid = page.waitForEvent("filechooser");
        await upload.click();
        await (await invalid).setFiles({ name: "unsupported.txt", mimeType: "text/plain", buffer: Buffer.from("not media") });
        await expect(page.getByText(/文件添加失败：unsupported.txt/)).toBeVisible();
        await expect(page.locator("[data-node-id]")).toHaveCount(6);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});

test("bug audit: keyboard deletion, editing protection, undo and consistent curved edges", async ({ page, request }) => {
    const project = await createCanvasProject(request, {
        title: `Bug audit ${randomUUID()}`,
        viewport: { x: 80, y: 100, k: 1 },
        nodes: [node("audit-a", "image", 50, 100, 180, 160, { content: "/logo.svg" }), node("audit-b", "image", 600, 100, 180, 160, { content: "/logo.svg" }), node("audit-obstacle", "text", 300, 80, 180, 200, { content: "obstacle" })],
        connections: [{ id: "audit-edge", fromNodeId: "audit-a", toNodeId: "audit-b" }],
    });
    try {
        const desktop = page.viewportSize()!.width >= 1000;
        if (!desktop) {
            await page.goto(`/canvas/${project.id}`);
            await expect(page.locator("[data-node-id]")).toHaveCount(3);
            const base = page.locator('[data-connection-id="audit-edge"] path').nth(1);
            await expect(base).toHaveAttribute("stroke-width", "1.5");
            await expect(base).toHaveAttribute("stroke-opacity", "0.8");
            expect(await base.getAttribute("d")).toContain("C");
            await page.reload();
            await expect(page.locator("[data-node-id]")).toHaveCount(3);
            return;
        }
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.goto(`/canvas/${project.id}`);
        const collapse = page.getByRole("button", { name: "收起 Agent 面板" });
        if (await collapse.isVisible()) await collapse.click();
        const selectMode = page.getByRole("button", { name: "切换到框选模式" });
        if (await selectMode.isVisible()) await selectMode.click();
        const a = page.locator('[data-node-id="audit-a"]');
        await expect(a).toBeVisible();
        const edge = page.locator('[data-connection-id="audit-edge"]');
        const base = edge.locator("path").nth(1);
        const before = await base.getAttribute("d");
        expect(before).toContain("C");
        await expect(base).toHaveAttribute("stroke-width", "1.5");
        const point = await edge
            .locator("path")
            .first()
            .evaluate((element) => {
                const path = element as SVGPathElement;
                const point = path.getPointAtLength(path.getTotalLength() * 0.1);
                const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
                return { x: screen.x, y: screen.y };
            });
        await page.mouse.click(point.x, point.y);
        await expect(edge.locator("path")).toHaveCount(5);
        await expect(base).toHaveAttribute("stroke-width", "1.5");
        await expect(base).toHaveAttribute("stroke-opacity", "0.8");
        await page.keyboard.press("Delete");
        await expect(edge).toHaveCount(0);
        await page.keyboard.press("Control+z");
        await expect(edge).toHaveCount(1);

        await a.click({ position: { x: 30, y: 30 } });
        const input = page.getByRole("textbox", { name: "节点提示词" });
        await expect(input).toBeVisible();
        await input.fill("abc");
        await input.press("Backspace");
        await expect(input).toHaveValue("ab");
        await expect(a).toHaveCount(1);
        await page.keyboard.press("Escape");
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Backspace");
        await expect(page.locator("[data-node-id]")).toHaveCount(0);
        await page.keyboard.press("Control+z");
        await expect(page.locator("[data-node-id]")).toHaveCount(3);
        await expect(edge).toHaveCount(1);
        await expectCanvasSaved(page);
        if (!desktop) {
            await page.setViewportSize({ width: test.info().project.name === "mobile-390" ? 390 : 430, height: 844 });
            await expect(page.locator("[data-canvas-surface]")).toBeVisible();
        }
        await page.reload();
        await expect(page.locator("[data-node-id]")).toHaveCount(3);
    } finally {
        await deleteCanvasProject(request, project.id);
    }
});
