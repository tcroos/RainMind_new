import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { CanvasNode } from "./canvas-node";
import { NodeContent } from "./canvas-node-content";

const imageNode: CanvasNodeData = {
    id: "generated-image",
    type: CanvasNodeType.Image,
    title: "生成图片",
    position: { x: 120, y: 80 },
    width: 320,
    height: 320,
    metadata: { content: "/api/reference-assets/permanent/generated-image.png" },
};

const noop = () => undefined;

function renderImageNode(overrides: Partial<React.ComponentProps<typeof CanvasNode>> = {}) {
    return renderToStaticMarkup(
        <CanvasNode
            data={imageNode}
            scale={1}
            isSelected={false}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            isConnecting={false}
            showPanel={false}
            showImageInfo={false}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResize={noop}
            onContentChange={noop}
            onContextMenu={noop}
            {...overrides}
        />,
    );
}

function renderContent(node: CanvasNodeData, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    return renderToStaticMarkup(
        <NodeContent
            node={node}
            theme={theme}
            isEditingContent={false}
            textareaRef={{ current: null }}
            isBatchRoot={false}
            batchCount={0}
            batchExpanded={false}
            batchOpening={false}
            batchRecovering={false}
            onContentChange={noop}
            onStopEditing={noop}
            mentionReferences={[]}
        />,
    );
}

describe("CanvasNode image border", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("uses the themed card border for an idle generated image", () => {
        const markup = renderImageNode();

        /* 边框不再承载状态：border-2 保留占位、颜色透明，菲涅尔描边由伪元素绘制 */
        expect(markup).toContain("rm-node-glass rm-node-fresnel");
        expect(markup).toContain("rounded-[22px] border-2");
        expect(markup).toContain("border-color:transparent");
        expect(markup).toContain("var(--rm-node-shadow");
        expect(markup).toContain("rounded-[inherit] overflow-hidden");
        expect(markup).toContain("/api/reference-assets/permanent/generated-image.png?format=webp&amp;width=320");
        expect(markup).toContain('alt="" aria-label="画布图片"');
        expect(markup).not.toContain('alt="生成图片"');
        expect(markup).toContain('decoding="async"');
    });

    it("uses a white active ring when the image is selected", () => {
        const markup = renderImageNode({ isSelected: true });

        expect(markup).toContain('data-selected="true"');
        expect(markup).toContain("0 0 0 1.5px #ffffff");
    });

    it("keeps the muted highlight for a related image", () => {
        expect(renderImageNode({ isRelated: true })).toContain(`0 0 0 1px ${canvasThemes.light.node.muted}66`);
    });

    it("does not apply the related highlight to a batch child", () => {
        const batchChild = { ...imageNode, metadata: { ...imageNode.metadata, batchRootId: "batch-root" } };

        const markup = renderImageNode({ data: batchChild, isRelated: true });

        expect(markup).toContain('class="rm-node-glass rm-node-fresnel relative h-full w-full overflow-visible rounded-[22px] border-2"');
        expect(markup).toContain("border-color:transparent");
        expect(markup).not.toContain(`0 0 0 1px ${canvasThemes.light.node.muted}66`);
    });

    it("does not emit hover-tilt or spotlight markers on nodes", () => {
        /* 卡片悬浮的 3D 微倾与镜面聚光已按产品要求移除，这里锁住不再回归 */
        expect(renderImageNode()).not.toContain("data-tilt");
        expect(renderImageNode({ data: { ...imageNode, metadata: {} } })).not.toContain("rm-node-spotlight");
    });

    it("marks loading and uploading nodes as generating for the silk wave", () => {
        expect(renderImageNode({ data: { ...imageNode, metadata: { ...imageNode.metadata, status: "loading" } } })).toContain('data-generating="true"');
        expect(renderImageNode({ data: { ...imageNode, metadata: { ...imageNode.metadata, uploadState: "uploading" } } })).toContain('data-generating="true"');
        expect(renderImageNode()).toContain('data-generating="false"');
    });

    it("透明主体图层使用干净预览且继续使用原图片地址", () => {
        const subject = renderContent({ ...imageNode, metadata: { ...imageNode.metadata, layerName: "主体" } }, canvasThemes.light);
        const removedBackground = renderContent({ ...imageNode, metadata: { ...imageNode.metadata, layerName: "主体（透明背景）" } }, canvasThemes.light);
        const background = renderContent({ ...imageNode, metadata: { ...imageNode.metadata, layerName: "背景" } }, canvasThemes.light);
        const ordinary = renderContent(imageNode, canvasThemes.light);

        expect(subject).not.toContain('data-canvas-transparent-preview="true"');
        expect(removedBackground).not.toContain('data-canvas-transparent-preview="true"');
        expect(subject).not.toContain("background-image:linear-gradient");
        expect(subject).toContain("/api/reference-assets/permanent/generated-image.png?format=webp&amp;width=320");
        expect(background).not.toContain("data-canvas-transparent-preview");
        expect(ordinary).not.toContain("data-canvas-transparent-preview");
    });

    it("分层图片使用干净预览，不渲染文字编辑框", () => {
        const markup = renderContent(
            {
                ...imageNode,
                metadata: {
                    ...imageNode.metadata,
                    layerName: "主标题",
                    imageLayer: { kind: "headline", bbox: { x: 20, y: 20, width: 180, height: 40 }, zIndex: 2, sourceWidth: 1000, sourceHeight: 800 },
                },
            },
            canvasThemes.light,
        );

        expect(markup).not.toContain('data-canvas-transparent-preview="true"');
        expect(markup).not.toContain("编辑主标题");
    });
});

describe("CanvasNode task content", () => {
    it("uses theme-owned surfaces and borders for all nine node types", () => {
        const theme = canvasThemes.light;

        for (const type of Object.values(CanvasNodeType)) {
            const markup = renderImageNode({ data: { ...imageNode, id: `theme-${type}`, type, metadata: {} } });
            /* 配置节点保留实色面板；其余节点底色交给 --rm-node-bg，不再写死主题填充色 */
            if (type === CanvasNodeType.Config) {
                expect(markup, type).toContain(`background:${theme.node.panel}`);
            } else {
                expect(markup, type).not.toContain(`background:${theme.node.fill}`);
            }
            expect(markup, type).toContain("border-color:transparent");
        }
    });

    it.each(["light", "dark"] as const)("passes explicit %s theme colors into all nine node renderers", (themeName) => {
        const theme = canvasThemes[themeName];

        for (const type of Object.values(CanvasNodeType)) {
            const markup = renderContent({ ...imageNode, id: `content-theme-${type}`, type, metadata: {} }, theme);
            const expectedColor =
                type === CanvasNodeType.Image || type === CanvasNodeType.Config ? theme.node.subtleText : type === CanvasNodeType.Panorama || type === CanvasNodeType.Video || type === CanvasNodeType.Audio ? theme.node.placeholder : theme.node.text;

            expect(markup, type).toContain(`color:${expectedColor}`);
        }
    });

    it("keeps long task text scrollable while preserving the footer", () => {
        const taskNode: CanvasNodeData = {
            ...imageNode,
            id: "task",
            type: CanvasNodeType.Task,
            title: "Agent 任务",
            height: 210,
            metadata: { agentTaskStatus: "completed", prompt: "很长的任务说明".repeat(30), agentTaskAttempts: 1 },
        };

        const markup = renderImageNode({ data: taskNode });

        expect(markup).toContain("thin-scrollbar min-h-0 flex-1 overflow-y-auto");
        expect(markup).toContain("mt-3 flex shrink-0");
    });

    it.each(["light", "dark"] as const)("keeps task states and supporting node chips readable in %s mode", (themeName) => {
        const theme = canvasThemes[themeName];
        const taskNode: CanvasNodeData = {
            ...imageNode,
            id: "task-theme",
            type: CanvasNodeType.Task,
            title: "Agent 任务",
            metadata: { agentTaskStatus: "running", prompt: "生成主题回归" },
        };
        const briefNode: CanvasNodeData = {
            ...imageNode,
            id: "brief-theme",
            type: CanvasNodeType.Brief,
            title: "创作简报",
            metadata: { agentBrief: { objective: "主题回归", deliverables: [{ type: "image", title: "主视觉", count: 1 }] } },
        };
        const brandNode: CanvasNodeData = {
            ...imageNode,
            id: "brand-theme",
            type: CanvasNodeType.BrandKit,
            title: "视觉方向",
            metadata: { brandKit: { summary: "主题回归", keywords: ["电影感"] } },
        };

        const taskMarkup = renderContent(taskNode, theme);
        const supportingMarkup = `${renderContent(briefNode, theme)}${renderContent(brandNode, theme)}`;

        expect(taskMarkup).toContain(`background:${theme.node.infoSurface}`);
        expect(taskMarkup).toContain(`border-color:${theme.node.infoBorder}`);
        expect(taskMarkup).toContain(`color:${theme.node.infoText}`);
        expect(supportingMarkup).toContain(`background:${theme.node.subtleSurface}`);
        expect(supportingMarkup).toContain(`color:${theme.node.subtleText}`);
        expect(taskMarkup).not.toContain(`background:${theme.toolbar.activeBg};color:${theme.node.text}`);
    });
});

describe("CanvasNode error content", () => {
    it("centers the error and retry action inside the node", () => {
        const failedNode: CanvasNodeData = { ...imageNode, metadata: { status: "error", errorDetails: "生成失败，请稍后重试" } };

        const markup = renderImageNode({ data: failedNode, onRetry: noop });

        expect(markup).toContain("h-full w-full flex-col items-center justify-center");
        expect(markup).toContain(`color:${canvasThemes.light.node.danger}`);
        expect(markup).toContain("生成失败，请稍后重试");
        expect(markup).toContain("重试");
    });

    it("renders a cancelled terminal state without a retry action", () => {
        const cancelledNode: CanvasNodeData = { ...imageNode, metadata: { status: "cancelled", agentTaskStatus: "cancelled" } };

        const markup = renderImageNode({ data: cancelledNode, onRetry: noop });

        expect(markup).toContain("任务已取消");
        expect(markup).not.toContain("重试");
    });

    it("pauses tasks that need review without offering a new generation retry", () => {
        const reviewNode: CanvasNodeData = { ...imageNode, metadata: { status: "needs_review", errorDetails: "上游创建状态待确认" } };

        const markup = renderImageNode({ data: reviewNode, onRetry: noop });

        expect(markup).toContain("上游创建状态待确认");
        expect(markup).toContain("结果待确认");
        expect(markup).toContain("检查状态");
        expect(markup).not.toContain(">重试<");
    });

    it("labels an unrecoverable submission as unknown instead of waiting", () => {
        const reviewNode: CanvasNodeData = { ...imageNode, metadata: { status: "needs_review", errorDetails: "原任务没有保存上游任务 ID，无法安全追回结果" } };

        const markup = renderImageNode({ data: reviewNode, onRetry: noop });

        expect(markup).toContain("提交结果未知");
        expect(markup).toContain("重新生成");
        expect(markup).not.toContain("等待状态确认");
        expect(markup).not.toContain("检查状态");
    });
});
