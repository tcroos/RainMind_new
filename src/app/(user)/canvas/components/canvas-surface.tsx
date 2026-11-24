"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

import { Plus, Scissors } from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNode, type CanvasNodeProps } from "./canvas-node";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position, type ViewportTransform } from "../types";
import { edgePath, expandCanvasDragNodeIds, findConnectionTarget, isBlockedConnectionDrop, isCanvasVideoControlPoint, nodeAnchor, previewPath, samePosition, selectNodesInBounds, worldFromScreen } from "../utils/canvas-surface-geometry";
import { buildCanvasSpatialIndex, canvasNodeBounds, canvasNodesBounds, type CanvasBounds } from "../utils/canvas-spatial-index";
import { canvasMediaLoadBudget, selectCanvasMediaLoadIds } from "../utils/canvas-media-load-budget";
import { CANVAS_MIN_ZOOM } from "../utils/canvas-zoom";

type CanvasPointerEvent = ReactMouseEvent | ReactPointerEvent;
type CanvasNodeUpdate = { id: string; position?: Position; width?: number; height?: number };
type CanvasNodeTransform = { position: Position; width: number; height: number };
export type CanvasInteractionMode = "pan" | "select";
type ConnectionDraft = { nodeId: string; handleType: "source" | "target"; world: Position; targetNodeId: string | null; pointerId: number | null };
type BatchConnectionDraft = { pointerId: number; start: Position; current: Position; sourceIds: string[]; targetNodeId: string | null };
type BoxSelection = { start: Position; current: Position; nodeIds: Set<string> };
type Interaction =
    | { kind: "pan"; pointerId: number; start: Position; viewport: ViewportTransform; moved: boolean }
    | { kind: "drag"; pointerId: number | null; start: Position; nodeIds: string[]; positions: Map<string, Position>; moved: boolean }
    | { kind: "box"; pointerId: number; start: Position; current: Position; initialNodeIds: Set<string>; moved: boolean };
type PinchState = { startDistance: number; startZoom: number; world: Position };
type WheelFrame = { clientX: number; clientY: number; deltaY: number };

const CANVAS_EDGE_LOD_THRESHOLD = 512;
const EDGE_FLOW_WIDTH = 3;
const EDGE_FLOW_LAYERS = [
    { dash: "36 64", opacity: 0.15 },
    { dash: "0 6 30 64", opacity: 0.17647058823529413 },
    { dash: "0 12 24 64", opacity: 0.21428571428571427 },
    { dash: "0 18 18 64", opacity: 0.2727272727272727 },
    { dash: "0 24 12 64", opacity: 0.37499999999999994 },
    { dash: "0 30 6 64", opacity: 0.6 },
] as const;
const EDGE_ACTIVE_COLOR = "#ffffff";
const MULTI_SELECTION_PADDING_PX = 28;
const CANVAS_NODE_OVERSCAN_PX = 900;
const CANVAS_IMAGE_OVERSCAN_PX = 420;

type CanvasSurfaceProps = {
    containerRef?: RefObject<HTMLDivElement | null>;
    nodes: CanvasNodeData[];
    hiddenNodeIds?: ReadonlySet<string>;
    connections: CanvasConnection[];
    viewport: ViewportTransform;
    backgroundMode: CanvasBackgroundMode;
    interactionMode: CanvasInteractionMode;
    minimapOpen: boolean;
    selectedNodeIds: Set<string>;
    selectedConnectionId: string | null;
    relatedNodeIds: Set<string>;
    relatedConnectionIds: Set<string>;
    renderNode: (node: CanvasNodeData) => ReactNode;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    nodeProps: Omit<
        CanvasNodeProps,
        | "data"
        | "scale"
        | "isSelected"
        | "isRelated"
        | "isFocusRelated"
        | "isConnectionTarget"
        | "isConnecting"
        | "isNear"
        | "connectingHandleSide"
        | "editRequestNonce"
        | "showPanel"
        | "showImageInfo"
        | "resourceLabel"
        | "mentionReferences"
        | "batchCount"
        | "batchExpanded"
        | "batchClosing"
        | "batchOpening"
        | "batchRecovering"
        | "batchMotion"
        | "loadImage"
        | "renderPanel"
        | "renderNodeContent"
        | "onMouseDown"
        | "onConnectStart"
        | "onResize"
        | "onContextMenu"
    >;
    getNodeViewProps: (
        node: CanvasNodeData,
    ) => Pick<CanvasNodeProps, "editRequestNonce" | "showPanel" | "showImageInfo" | "resourceLabel" | "mentionReferences" | "batchCount" | "batchExpanded" | "batchClosing" | "batchOpening" | "batchRecovering" | "batchMotion">;
    onNodesCommit: (updates: CanvasNodeUpdate[]) => void;
    onSelectionChange: (nodeIds: Set<string>, connectionId: string | null) => void;
    onViewportCommit: (viewport: ViewportTransform) => void;
    onConnect: (connection: { source: string; target: string }) => void;
    onConnectBatch: (sourceIds: string[], targetId: string) => void;
    onConnectStart?: () => void;
    onConnectionCreate: (connection: { nodeId: string; handleType: "source" | "target"; position: Position; sourceNodeIds?: string[] }) => void;
    onPaneClick: () => void;
    onPaneDoubleClick: (position: Position) => void;
    onPaneContextMenu: (event: MouseEvent | ReactMouseEvent) => void;
    onNodeContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
    onEdgeContextMenu: (event: ReactMouseEvent, connectionId: string) => void;
    onEdgeCut: (connectionId: string) => void;
    onDrop: (event: ReactDragEvent<Element>) => void;
    onSizeChange?: (size: { width: number; height: number }) => void;
    onDragStateChange?: (dragging: boolean) => void;
    onViewportInteractionChange?: (interacting: boolean) => void;
    overlay?: ReactNode;
    pendingConnectionCreate?: { connection: { nodeId: string; handleType: "source" | "target" }; position: Position; sourceNodeIds?: string[] } | null;
};

function isPointerControlTarget(target: EventTarget | null, event?: Pick<MouseEvent, "clientY">) {
    if (!(target instanceof Element)) return false;
    const video = target.closest("video");
    if (video) {
        if (!(video as HTMLVideoElement).controls) return false;
        const rect = video.getBoundingClientRect();
        if (event && !isCanvasVideoControlPoint(rect, event.clientY)) return false;
        return true;
    }
    return Boolean(target.closest("button,input,textarea,select,audio,[data-canvas-no-drag],[data-canvas-minimap],[data-connection-create-menu],[data-canvas-node-create-menu]"));
}

function isWheelControlTarget(target: EventTarget | null, event?: Pick<MouseEvent, "clientY">) {
    return target instanceof Element && (Boolean(target.closest("[data-canvas-no-zoom]")) || isPointerControlTarget(target, event));
}

function isEditableKeyboardTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("button,input,textarea,select,[contenteditable='true'],[role='textbox']"));
}

function sameViewport(a: ViewportTransform, b: ViewportTransform) {
    return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.k - b.k) < 0.0001;
}

export function reconcilePendingViewport(previousProp: ViewportTransform, incoming: ViewportTransform, pending: ViewportTransform[]) {
    if (!pending.length) return { pending: [], acceptIncoming: true };
    const matchingCommitIndex = pending.findIndex((value) => sameViewport(value, incoming));
    if (matchingCommitIndex >= 0) return { pending: matchingCommitIndex === pending.length - 1 ? [] : pending.slice(matchingCommitIndex + 1), acceptIncoming: matchingCommitIndex === pending.length - 1 };
    if (sameViewport(previousProp, incoming)) return { pending, acceptIncoming: false };
    return { pending: [], acceptIncoming: true };
}

export function CanvasSurface({
    containerRef,
    nodes,
    hiddenNodeIds = EMPTY_NODE_IDS,
    connections,
    viewport,
    backgroundMode,
    interactionMode,
    minimapOpen,
    selectedNodeIds,
    selectedConnectionId,
    relatedNodeIds,
    relatedConnectionIds,
    renderNode,
    renderPanel,
    nodeProps,
    getNodeViewProps,
    onNodesCommit,
    onSelectionChange,
    onViewportCommit,
    onConnect,
    onConnectBatch,
    onConnectStart,
    onConnectionCreate,
    onPaneClick,
    onPaneDoubleClick,
    onPaneContextMenu,
    onNodeContextMenu,
    onEdgeContextMenu,
    onEdgeCut,
    onDrop,
    onSizeChange,
    onDragStateChange,
    onViewportInteractionChange,
    overlay,
    pendingConnectionCreate,
}: CanvasSurfaceProps) {
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const edgeFlowWidth = EDGE_FLOW_WIDTH;
    const edgeFlowOpacity = themeName === "light" ? 0.55 : 1;
    const surfaceRef = useRef<HTMLDivElement>(null);
    const backgroundLayerRef = useRef<HTMLDivElement>(null);
    const worldLayerRef = useRef<HTMLDivElement>(null);
    const connectionPointerRef = useRef<{ x: number; y: number } | null>(null);
    const nodesRef = useRef(nodes);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const multiSelectionBoundsRef = useRef<CanvasBounds | null>(null);
    const selectedConnectionIdRef = useRef(selectedConnectionId);
    const interactionRef = useRef<Interaction | null>(null);
    const connectionRef = useRef<ConnectionDraft | null>(null);
    const touchPointersRef = useRef(new Map<number, Position>());
    const pinchRef = useRef<PinchState | null>(null);
    const localTransformsRef = useRef<Record<string, CanvasNodeTransform>>({});
    const resizingNodeIdRef = useRef<string | null>(null);
    const displayViewportRef = useRef(viewport);
    const viewportDirtyRef = useRef(false);
    const previousViewportPropRef = useRef(viewport);
    const animationFrameRef = useRef<number | null>(null);
    const frameActionsRef = useRef(new Map<string, () => void>());
    const wheelFrameRef = useRef<WheelFrame | null>(null);
    const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingViewportCommitRef = useRef<ViewportTransform[]>([]);
    const boxSelectionRef = useRef<BoxSelection | null>(null);
    const temporaryPanRef = useRef(false);
    const [localTransforms, setLocalTransforms] = useState<Record<string, CanvasNodeTransform>>({});
    const [displayViewport, setDisplayViewport] = useState(viewport);
    const [connection, setConnection] = useState<ConnectionDraft | null>(null);
    const [boxSelection, setBoxSelection] = useState<BoxSelection | null>(null);
    const [temporaryPan, setTemporaryPan] = useState(false);
    const [surfaceInteracting, setSurfaceInteracting] = useState(false);
    const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
    const [edgeCut, setEdgeCut] = useState<{ connectionId: string; left: number; top: number } | null>(null);
    const [batchConnection, setBatchConnection] = useState<BatchConnectionDraft | null>(null);
    const [batchHandleHidden, setBatchHandleHidden] = useState(false);
    const batchConnectionRef = useRef<BatchConnectionDraft | null>(null);
    const batchConnectionPointerRef = useRef<Position | null>(null);

    useEffect(() => {
        setBatchHandleHidden(false);
    }, [selectedNodeIds]);
    const [batchHandleOffset, setBatchHandleOffset] = useState({ x: 0, y: 0 });
    const [nearNodeId, setNearNodeId] = useState<string | null>(null);
    const [surfaceSize, setSurfaceSize] = useState({ width: 1280, height: 760 });
    const setSurfaceRef = useCallback(
        (element: HTMLDivElement | null) => {
            surfaceRef.current = element;
            if (containerRef) containerRef.current = element;
        },
        [containerRef],
    );

    nodesRef.current = nodes;
    selectedNodeIdsRef.current = selectedNodeIds;
    selectedConnectionIdRef.current = selectedConnectionId;

    const displayNodesRef = useRef(nodes);
    displayNodesRef.current = nodes;
    const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const getDisplayNode = useCallback(
        (nodeId: string) => {
            const node = nodesById.get(nodeId);
            const transform = localTransforms[nodeId];
            return node && transform ? { ...node, ...transform } : node;
        },
        [localTransforms, nodesById],
    );
    const visibleNodes = useMemo(() => nodes.filter((node) => !hiddenNodeIds.has(node.id)), [hiddenNodeIds, nodes]);
    const connectedNodeIds = useMemo(() => {
        const ids = new Set<string>();
        connections.forEach((item) => {
            ids.add(item.fromNodeId);
            ids.add(item.toNodeId);
        });
        return ids;
    }, [connections]);
    const nodeSpatialIndex = useMemo(() => buildCanvasSpatialIndex(visibleNodes, (node) => canvasNodeBounds(node)), [visibleNodes]);
    const nodeSpatialIndexRef = useRef(nodeSpatialIndex);
    nodeSpatialIndexRef.current = nodeSpatialIndex;
    const lastFrameNodeIdsRef = useRef<Set<string>>(new Set());
    const viewBounds = useMemo(() => {
        const paddingX = CANVAS_NODE_OVERSCAN_PX / Math.max(displayViewport.k, 0.01);
        const paddingY = CANVAS_NODE_OVERSCAN_PX / Math.max(displayViewport.k, 0.01);
        return {
            left: -displayViewport.x / displayViewport.k - paddingX,
            top: -displayViewport.y / displayViewport.k - paddingY,
            right: (surfaceSize.width - displayViewport.x) / displayViewport.k + paddingX,
            bottom: (surfaceSize.height - displayViewport.y) / displayViewport.k + paddingY,
        };
    }, [displayViewport, surfaceSize.height, surfaceSize.width]);
    const imageViewBounds = useMemo(() => {
        const paddingX = CANVAS_IMAGE_OVERSCAN_PX / Math.max(displayViewport.k, 0.01);
        const paddingY = CANVAS_IMAGE_OVERSCAN_PX / Math.max(displayViewport.k, 0.01);
        return {
            left: -displayViewport.x / displayViewport.k - paddingX,
            top: -displayViewport.y / displayViewport.k - paddingY,
            right: (surfaceSize.width - displayViewport.x) / displayViewport.k + paddingX,
            bottom: (surfaceSize.height - displayViewport.y) / displayViewport.k + paddingY,
        };
    }, [displayViewport, surfaceSize.height, surfaceSize.width]);
    const forcedImageNodeIds = useMemo(() => {
        const ids = new Set(selectedNodeIds);
        nodes.forEach((node) => {
            if (getNodeViewProps(node).showPanel) ids.add(node.id);
        });
        if (connection?.nodeId) ids.add(connection.nodeId);
        if (connection?.targetNodeId) ids.add(connection.targetNodeId);
        return ids;
    }, [connection?.nodeId, connection?.targetNodeId, getNodeViewProps, nodes, selectedNodeIds]);
    const renderedNodes = useMemo(() => {
        const indexed = nodeSpatialIndex.query(viewBounds);
        const indexedIds = new Set(indexed.map((node) => node.id));
        forcedImageNodeIds.forEach((id) => {
            const node = nodesById.get(id);
            if (node && !indexedIds.has(id) && !hiddenNodeIds.has(id)) indexed.push(node);
        });
        const rawCurrentIds = new Set(indexed.map((node) => node.id));
        if (surfaceInteracting) {
            lastFrameNodeIdsRef.current.forEach((id) => {
                if (rawCurrentIds.has(id)) return;
                const node = nodesById.get(id);
                if (node && !hiddenNodeIds.has(id)) indexed.push(node);
            });
        }
        lastFrameNodeIdsRef.current = rawCurrentIds;
        return indexed.map((node) => getDisplayNode(node.id) || node);
    }, [forcedImageNodeIds, getDisplayNode, hiddenNodeIds, nodeSpatialIndex, nodesById, surfaceInteracting, viewBounds]);
    const renderedNodeIds = useMemo(() => new Set(renderedNodes.map((node) => node.id)), [renderedNodes]);
    const mediaLoadIds = useMemo(() => {
        const budget = canvasMediaLoadBudget(displayViewport.k);
        if (budget <= 0) return new Set<string>();
        const centerX = (imageViewBounds.left + imageViewBounds.right) / 2;
        const centerY = (imageViewBounds.top + imageViewBounds.bottom) / 2;
        const candidates = renderedNodes
            .filter((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video)
            .filter((node) => {
                if (forcedImageNodeIds.has(node.id)) return true;
                const bounds = canvasNodeBounds(node);
                return bounds.left <= imageViewBounds.right && bounds.right >= imageViewBounds.left && bounds.top <= imageViewBounds.bottom && bounds.bottom >= imageViewBounds.top;
            })
            .map((node) => {
                const bounds = canvasNodeBounds(node);
                return {
                    id: node.id,
                    forced: forcedImageNodeIds.has(node.id),
                    distance: Math.hypot((bounds.left + bounds.right) / 2 - centerX, (bounds.top + bounds.bottom) / 2 - centerY),
                };
            });
        return selectCanvasMediaLoadIds(displayViewport.k, candidates);
    }, [displayViewport.k, forcedImageNodeIds, imageViewBounds, renderedNodes]);
    // Below 44% the generic media budget can skip videos that are still visible.
    // Load every rendered video in that range so their first frame remains visible.
    const lowZoomVideoLoadIds = useMemo(() => {
        if (displayViewport.k >= 0.44) return new Set<string>();
        return new Set(renderedNodes.filter((node) => node.type === CanvasNodeType.Video).map((node) => node.id));
    }, [displayViewport.k, renderedNodes]);
    const denseEdgeLod = connections.length > CANVAS_EDGE_LOD_THRESHOLD;
    const flowConnections = useMemo(() => {
        if (denseEdgeLod) {
            return connections.filter((item) => renderedNodeIds.has(item.fromNodeId) && renderedNodeIds.has(item.toNodeId));
        }
        return connections.filter((item) => {
            const from = nodesById.get(item.fromNodeId);
            const to = nodesById.get(item.toNodeId);
            if (!from || !to || hiddenNodeIds.has(from.id) || hiddenNodeIds.has(to.id)) return false;
            const start = nodeAnchor(from, "source");
            const end = nodeAnchor(to, "target");
            return Math.min(start.x, end.x) < viewBounds.right && Math.max(start.x, end.x) > viewBounds.left && Math.min(start.y, end.y) < viewBounds.bottom && Math.max(start.y, end.y) > viewBounds.top;
        });
    }, [connections, denseEdgeLod, hiddenNodeIds, nodesById, renderedNodeIds, viewBounds]);
    const connectionPaths = useMemo(() => {
        const paths = new Map<string, string>();
        flowConnections.forEach((item) => {
            const from = getDisplayNode(item.fromNodeId);
            const to = getDisplayNode(item.toNodeId);
            if (!from || !to) return;
            paths.set(item.id, edgePath(from, to));
        });
        return paths;
    }, [flowConnections, getDisplayNode]);
    const aggregateIdleConnectionPath = useMemo(() => {
        return flowConnections
            .filter((item) => item.id !== selectedConnectionId && item.id !== hoveredConnectionId)
            .map((item) => connectionPaths.get(item.id))
            .filter((path): path is string => Boolean(path))
            .join(" ");
    }, [connectionPaths, flowConnections, hoveredConnectionId, selectedConnectionId]);

    useEffect(() => {
        const finish = () => setSurfaceInteracting(false);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("mouseup", finish, true);
        return () => {
            window.removeEventListener("pointerup", finish, true);
            window.removeEventListener("pointercancel", finish, true);
            window.removeEventListener("mouseup", finish, true);
        };
    }, []);

    useEffect(() => {
        if (interactionRef.current?.kind === "drag" || resizingNodeIdRef.current) return;
        if (!Object.keys(localTransformsRef.current).length) return;
        localTransformsRef.current = {};
        setLocalTransforms({});
    }, [nodes]);

    useEffect(() => {
        const propChanged = !sameViewport(previousViewportPropRef.current, viewport);
        const previousViewportProp = previousViewportPropRef.current;
        previousViewportPropRef.current = viewport;
        if (!propChanged && !pendingViewportCommitRef.current.length) return;
        const reconciliation = reconcilePendingViewport(previousViewportProp, viewport, pendingViewportCommitRef.current);
        pendingViewportCommitRef.current = reconciliation.pending;
        if (!reconciliation.acceptIncoming) return;
        if (!propChanged || sameViewport(displayViewportRef.current, viewport)) return;
        if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
        viewportDirtyRef.current = false;
        displayViewportRef.current = viewport;
        setDisplayViewport(viewport);
    }, [viewport]);

    const applyViewportStyles = useCallback(
        (next: ViewportTransform) => {
            if (worldLayerRef.current) worldLayerRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`;
            if (!backgroundLayerRef.current) return;
            const gridSize = canvasGridSize(backgroundMode, next.k);
            backgroundLayerRef.current.style.backgroundImage = canvasGridImage(backgroundMode, theme, next.k);
            backgroundLayerRef.current.style.backgroundSize = `${gridSize}px ${gridSize}px`;
            backgroundLayerRef.current.style.backgroundPosition = `${next.x}px ${next.y}px`;
            backgroundLayerRef.current.style.opacity = String(canvasGridOpacity(next.k));
        },
        [backgroundMode, theme],
    );

    useEffect(() => applyViewportStyles(displayViewport), [applyViewportStyles, displayViewport]);

    const flushFrame = useCallback(() => {
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        const actions = [...frameActionsRef.current.values()];
        frameActionsRef.current.clear();
        actions.forEach((action) => action());
    }, []);

    const scheduleFrame = useCallback((key: string, action: () => void) => {
        frameActionsRef.current.set(key, action);
        if (animationFrameRef.current !== null) return;
        animationFrameRef.current = requestAnimationFrame(() => {
            animationFrameRef.current = null;
            const actions = [...frameActionsRef.current.values()];
            frameActionsRef.current.clear();
            actions.forEach((next) => next());
        });
    }, []);

    const previewViewport = useCallback(
        (next: ViewportTransform) => {
            viewportDirtyRef.current = true;
            displayViewportRef.current = next;
            applyViewportStyles(next);
        },
        [applyViewportStyles],
    );

    const commitViewport = useCallback(() => {
        if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = null;
        if (!viewportDirtyRef.current) return;
        viewportDirtyRef.current = false;
        const next = displayViewportRef.current;
        pendingViewportCommitRef.current = [...pendingViewportCommitRef.current, next].slice(-8);
        setDisplayViewport((current) => (sameViewport(current, next) ? current : next));
        onViewportCommit(next);
    }, [onViewportCommit]);

    useEffect(
        () => () => {
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        const element = surfaceRef.current;
        if (!element) return;
        const resize = () => {
            const next = { width: element.clientWidth, height: element.clientHeight };
            setSurfaceSize((current) => (current.width === next.width && current.height === next.height ? current : next));
            onSizeChange?.(next);
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [onSizeChange]);

    const screenToWorld = useCallback((clientX: number, clientY: number) => {
        const rect = surfaceRef.current?.getBoundingClientRect();
        return rect ? worldFromScreen(clientX, clientY, displayViewportRef.current, rect) : { x: 0, y: 0 };
    }, []);

    const setSelection = useCallback(
        (nodeIds: Set<string>, connectionId: string | null = null) => {
            onSelectionChange(nodeIds, connectionId);
        },
        [onSelectionChange],
    );

    const endConnection = useCallback(
        (clientX: number, clientY: number) => {
            const draft = connectionRef.current;
            if (!draft) return;
            const world = screenToWorld(clientX, clientY);
            const candidates = nodeSpatialIndexRef.current.queryPoint(world, 52 / Math.max(displayViewportRef.current.k, 0.1));
            const targetId = findConnectionTarget(world, draft, candidates, displayViewportRef.current.k);
            if (targetId) {
                onConnect(draft.handleType === "source" ? { source: draft.nodeId, target: targetId } : { source: targetId, target: draft.nodeId });
            } else {
                const origin = getDisplayNode(draft.nodeId);
                const blockedCandidates = origin && !candidates.some((node) => node.id === origin.id) ? [...candidates, origin] : candidates;
                if (!isBlockedConnectionDrop(world, draft, blockedCandidates, displayViewportRef.current.k)) onConnectionCreate({ nodeId: draft.nodeId, handleType: draft.handleType, position: world });
            }
            connectionRef.current = null;
            connectionPointerRef.current = null;
            setConnection(null);
        },
        [getDisplayNode, onConnect, onConnectionCreate, screenToWorld],
    );

    const handleConnectStart = useCallback(
        (event: CanvasPointerEvent, nodeId: string, handleType: "source" | "target") => {
            event.preventDefault();
            event.stopPropagation();
            const pointerId = "pointerId" in event ? event.pointerId : null;
            onConnectStart?.();
            const next = { nodeId, handleType, world: screenToWorld(event.clientX, event.clientY), targetNodeId: null, pointerId } satisfies ConnectionDraft;
            connectionRef.current = next;
            connectionPointerRef.current = { x: event.clientX, y: event.clientY };
            setConnection(next);
        },
        [screenToWorld, onConnectStart],
    );

    const commitDrag = useCallback(() => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.kind !== "drag") return;
        const updates: CanvasNodeUpdate[] = [];
        interaction.nodeIds.forEach((id) => {
            const original = interaction.positions.get(id);
            const current = localTransformsRef.current[id]?.position;
            if (original && current && !samePosition(original, current)) updates.push({ id, position: current });
        });
        if (updates.length) onNodesCommit(updates);
        interactionRef.current = null;
        onDragStateChange?.(false);
    }, [onDragStateChange, onNodesCommit]);

    const cancelTransientInteraction = useCallback(() => {
        flushFrame();
        connectionRef.current = null;
        connectionPointerRef.current = null;
        setConnection(null);
        boxSelectionRef.current = null;
        setBoxSelection(null);
        pinchRef.current = null;
        touchPointersRef.current.clear();
        wheelFrameRef.current = null;
        const interaction = interactionRef.current;
        interactionRef.current = null;
        if (interaction?.kind === "drag") {
            localTransformsRef.current = {};
            setLocalTransforms({});
            onDragStateChange?.(false);
        }
        commitViewport();
        onViewportInteractionChange?.(false);
    }, [commitViewport, flushFrame, onDragStateChange, onViewportInteractionChange]);

    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => onNodeContextMenu(event, nodeId), [onNodeContextMenu]);

    const handleNodeMouseDown = useCallback(
        (event: CanvasPointerEvent, nodeId: string) => {
            if (isPointerControlTarget(event.target, event)) return;
            if (displayNodesRef.current.find((node) => node.id === nodeId)?.type !== CanvasNodeType.Text) event.preventDefault();
            const additive = event.shiftKey || event.ctrlKey || event.metaKey;
            const nextSelection = new Set(selectedNodeIdsRef.current);
            if (additive) {
                if (nextSelection.has(nodeId)) nextSelection.delete(nodeId);
                else nextSelection.add(nodeId);
            } else if (!nextSelection.has(nodeId)) {
                nextSelection.clear();
                nextSelection.add(nodeId);
            }
            setSelection(nextSelection, null);
            const dragIds = nextSelection.has(nodeId) ? expandCanvasDragNodeIds(displayNodesRef.current, nextSelection) : [];
            if (!dragIds.length) return;
            const positions = new Map(dragIds.map((id) => [id, displayNodesRef.current.find((node) => node.id === id)?.position || { x: 0, y: 0 }]));
            interactionRef.current = { kind: "drag", pointerId: "pointerId" in event ? event.pointerId : null, start: { x: event.clientX, y: event.clientY }, nodeIds: dragIds, positions, moved: false };
        },
        [onDragStateChange, setSelection],
    );

    const handlePointerDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-node-id],[data-connection-id],[data-canvas-minimap],[data-connection-create-menu],[data-canvas-node-create-menu]")) return;
            if (event.pointerType === "touch") {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const points = [...touchPointersRef.current.values()];
                if (points.length >= 2) {
                    const [first, second] = points;
                    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
                    pinchRef.current = { startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)), startZoom: displayViewportRef.current.k, world: screenToWorld(midpoint.x, midpoint.y) };
                    onViewportInteractionChange?.(true);
                    interactionRef.current = null;
                } else {
                    interactionRef.current = { kind: "pan", pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, viewport: displayViewportRef.current, moved: false };
                }
                return;
            }
            if (event.button === 1 || event.button === 0) {
                const world = screenToWorld(event.clientX, event.clientY);
                const additive = event.shiftKey || event.ctrlKey || event.metaKey;
                const multiBounds = multiSelectionBoundsRef.current;
                const insideMultiSelection =
                    !additive &&
                    event.button === 0 &&
                    interactionMode !== "pan" &&
                    !isPointerControlTarget(target, event) &&
                    Boolean(multiBounds && world.x >= multiBounds.left && world.x <= multiBounds.right && world.y >= multiBounds.top && world.y <= multiBounds.bottom);
                if (insideMultiSelection) {
                    const nodeIds = Array.from(selectedNodeIdsRef.current);
                    const positions = new Map(nodeIds.map((id) => [id, displayNodesRef.current.find((node) => node.id === id)?.position || { x: 0, y: 0 }]));
                    if (positions.size) {
                        interactionRef.current = { kind: "drag", pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, nodeIds, positions, moved: false };
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                        return;
                    }
                }
                const kind = event.button === 1 || (interactionMode === "pan" && !additive) ? "pan" : "box";
                const initialNodeIds = kind === "box" && additive ? new Set(selectedNodeIdsRef.current) : new Set<string>();
                interactionRef.current =
                    kind === "box"
                        ? { kind, pointerId: event.pointerId, start: world, current: world, initialNodeIds, moved: false }
                        : { kind, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, viewport: displayViewportRef.current, moved: false };
                if (kind === "pan") onViewportInteractionChange?.(true);
                if (kind === "box") {
                    const next = { start: world, current: world, nodeIds: initialNodeIds };
                    boxSelectionRef.current = next;
                    setBoxSelection(next);
                }
                event.currentTarget.setPointerCapture?.(event.pointerId);
            }
        },
        [interactionMode, onViewportInteractionChange, screenToWorld],
    );

    const handlePointerDownCapture = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            if (event.button === 0 && !isPointerControlTarget(event.target, event)) event.currentTarget.focus({ preventScroll: true });
            if (!temporaryPanRef.current || event.button !== 0 || event.pointerType === "touch") return;
            event.preventDefault();
            event.stopPropagation();
            interactionRef.current = { kind: "pan", pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, viewport: displayViewportRef.current, moved: false };
            onViewportInteractionChange?.(true);
            event.currentTarget.setPointerCapture?.(event.pointerId);
        },
        [onViewportInteractionChange],
    );

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            // Native media controls can consume pointerup. Never keep dragging
            // after the mouse has returned with no buttons pressed.
            if (event.pointerType === "mouse" && event.buttons === 0 && (interactionRef.current || connectionRef.current)) {
                flushFrame();
                commitDrag();
                cancelTransientInteraction();
                return;
            }
            if (event.pointerType === "touch" && touchPointersRef.current.has(event.pointerId)) {
                touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const points = [...touchPointersRef.current.values()];
                if (points.length >= 2 && pinchRef.current) {
                    const [first, second] = points;
                    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
                    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
                    const pinch = pinchRef.current;
                    const rect = surfaceRef.current?.getBoundingClientRect();
                    if (rect) {
                        scheduleFrame("pinch", () => {
                            if (pinchRef.current !== pinch) return;
                            const zoom = Math.min(5, Math.max(CANVAS_MIN_ZOOM, pinch.startZoom * (distance / pinch.startDistance)));
                            previewViewport({ x: midpoint.x - rect.left - pinch.world.x * zoom, y: midpoint.y - rect.top - pinch.world.y * zoom, k: zoom });
                        });
                    }
                    return;
                }
            }
            const draft = connectionRef.current;
            if (draft && (draft.pointerId === null || draft.pointerId === event.pointerId)) {
                connectionPointerRef.current = { x: event.clientX, y: event.clientY };
                const clientX = event.clientX;
                const clientY = event.clientY;
                scheduleFrame("connection", () => {
                    if (connectionRef.current !== draft) return;
                    const world = screenToWorld(clientX, clientY);
                    const candidates = nodeSpatialIndexRef.current.queryPoint(world, 52 / Math.max(displayViewportRef.current.k, 0.1));
                    const next = { ...draft, world, targetNodeId: findConnectionTarget(world, draft, candidates, displayViewportRef.current.k) };
                    connectionRef.current = next;
                    const origin = nodesRef.current.find((node) => node.id === next.nodeId);
                    if (origin) {
                        const nextPath = previewPath(nodeAnchor(origin, next.handleType), world, next.handleType);
                        surfaceRef.current?.querySelectorAll<SVGPathElement>("[data-canvas-connection-preview]").forEach((preview) => preview.setAttribute("d", nextPath));
                    }
                    const surface = surfaceRef.current;
                    const knob = surface?.querySelector<HTMLElement>("[data-canvas-connection-knob]");
                    if (surface && knob) {
                        const rect = surface.getBoundingClientRect();
                        knob.style.left = `${clientX - rect.left}px`;
                        knob.style.top = `${clientY - rect.top}px`;
                    }
                    if (next.targetNodeId !== draft.targetNodeId) setConnection(next);
                });
                return;
            }
            const interaction = interactionRef.current;
            if (!interaction || (interaction.pointerId !== null && interaction.pointerId !== event.pointerId)) return;
            if (interaction.kind === "drag") {
                const clientX = event.clientX;
                const clientY = event.clientY;
                scheduleFrame("drag", () => {
                    if (interactionRef.current !== interaction) return;
                    const dx = (clientX - interaction.start.x) / displayViewportRef.current.k;
                    const dy = (clientY - interaction.start.y) / displayViewportRef.current.k;
                    if (!interaction.moved && Math.hypot(clientX - interaction.start.x, clientY - interaction.start.y) > 6) {
                        interaction.moved = true;
                        onDragStateChange?.(true);
                    }
                    if (!interaction.moved) return;
                    const next = { ...localTransformsRef.current };
                    interaction.nodeIds.forEach((id) => {
                        const start = interaction.positions.get(id);
                        const current = next[id] || displayNodesRef.current.find((node) => node.id === id);
                        if (start && current) next[id] = { position: { x: start.x + dx, y: start.y + dy }, width: current.width, height: current.height };
                    });
                    localTransformsRef.current = next;
                    setLocalTransforms(next);
                });
                return;
            }
            if (interaction.kind === "pan") {
                const clientX = event.clientX;
                const clientY = event.clientY;
                scheduleFrame("pan", () => {
                    if (interactionRef.current !== interaction) return;
                    const dx = clientX - interaction.start.x;
                    const dy = clientY - interaction.start.y;
                    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) interaction.moved = true;
                    previewViewport({ x: interaction.viewport.x + dx, y: interaction.viewport.y + dy, k: interaction.viewport.k });
                });
                return;
            }
            const clientX = event.clientX;
            const clientY = event.clientY;
            scheduleFrame("box", () => {
                if (interactionRef.current !== interaction) return;
                const current = screenToWorld(clientX, clientY);
                interaction.current = current;
                if (Math.abs(current.x - interaction.start.x) > 2 || Math.abs(current.y - interaction.start.y) > 2) interaction.moved = true;
                const next = {
                    start: interaction.start,
                    current,
                    nodeIds: selectNodesInBounds(
                        nodeSpatialIndexRef.current.query({
                            left: Math.min(interaction.start.x, current.x),
                            top: Math.min(interaction.start.y, current.y),
                            right: Math.max(interaction.start.x, current.x),
                            bottom: Math.max(interaction.start.y, current.y),
                        }),
                        interaction.start,
                        current,
                        interaction.initialNodeIds,
                    ),
                };
                boxSelectionRef.current = next;
                setBoxSelection(next);
            });
        };
        const handlePointerUp = (event: PointerEvent) => {
            flushFrame();
            let finishedPinch = false;
            if (event.pointerType === "touch") {
                touchPointersRef.current.delete(event.pointerId);
                if (touchPointersRef.current.size < 2 && pinchRef.current) {
                    pinchRef.current = null;
                    finishedPinch = true;
                }
            }
            if (connectionRef.current && (connectionRef.current.pointerId === null || connectionRef.current.pointerId === event.pointerId)) {
                endConnection(event.clientX, event.clientY);
                commitViewport();
                return;
            }
            if (finishedPinch) {
                commitViewport();
                onViewportInteractionChange?.(false);
                return;
            }
            const interaction = interactionRef.current;
            if (!interaction || (interaction.pointerId !== null && interaction.pointerId !== event.pointerId)) return;
            if (interaction.kind === "drag") commitDrag();
            else if (interaction.kind === "box") {
                interactionRef.current = null;
                setSelection(boxSelectionRef.current?.nodeIds || new Set(), null);
                boxSelectionRef.current = null;
                setBoxSelection(null);
                if (!interaction.moved) onPaneClick();
            } else {
                if (!interaction.moved) onPaneClick();
                else commitViewport();
                if (interaction.kind === "pan") onViewportInteractionChange?.(false);
                interactionRef.current = null;
            }
        };
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp, true);
        window.addEventListener("pointercancel", cancelTransientInteraction, true);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp, true);
            window.removeEventListener("pointercancel", cancelTransientInteraction, true);
        };
    }, [cancelTransientInteraction, commitDrag, commitViewport, endConnection, flushFrame, onDragStateChange, onPaneClick, onViewportInteractionChange, previewViewport, scheduleFrame, screenToWorld, setSelection]);

    useEffect(() => {
        if (!connection) return;
        let frame = 0;
        let previousTime = 0;
        const panAtEdge = (time: number) => {
            const pointer = connectionPointerRef.current;
            const draft = connectionRef.current;
            const rect = surfaceRef.current?.getBoundingClientRect();
            if (!pointer || !draft || !rect) return;
            const margin = 52;
            const velocity = (position: number, min: number, max: number) => (position < min + margin ? Math.min(1, (min + margin - position) / margin) : position > max - margin ? -Math.min(1, (position - max + margin) / margin) : 0);
            const elapsed = previousTime ? (time - previousTime) / 1000 : 0;
            previousTime = time;
            const dx = velocity(pointer.x, rect.left, rect.right) * margin * 6 * elapsed;
            const dy = velocity(pointer.y, rect.top, rect.bottom) * margin * 6 * elapsed;
            if (dx || dy) {
                const viewport = displayViewportRef.current;
                const nextViewport = { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
                previewViewport(nextViewport);
                const world = screenToWorld(pointer.x, pointer.y);
                const candidates = nodeSpatialIndexRef.current.queryPoint(world, margin / Math.max(viewport.k, 0.1));
                const next = { ...draft, world, targetNodeId: findConnectionTarget(world, draft, candidates, viewport.k) };
                connectionRef.current = next;
                setConnection(next);
            }
            frame = requestAnimationFrame(panAtEdge);
        };
        frame = requestAnimationFrame(panAtEdge);
        return () => cancelAnimationFrame(frame);
    }, [Boolean(connection), previewViewport, screenToWorld]);

    const handleWheel = useCallback(
        (event: WheelEvent) => {
            if (isWheelControlTarget(event.target, event) && !event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            onViewportInteractionChange?.(true);
            const pending = wheelFrameRef.current;
            wheelFrameRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                deltaY: (pending?.deltaY || 0) + event.deltaY,
            };
            scheduleFrame("wheel", () => {
                const input = wheelFrameRef.current;
                wheelFrameRef.current = null;
                const rect = surfaceRef.current?.getBoundingClientRect();
                if (!input || !rect) return;
                const current = displayViewportRef.current;
                const factor = Math.pow(1.1, -input.deltaY / 100);
                const nextZoom = Math.min(5, Math.max(CANVAS_MIN_ZOOM, current.k * factor));
                const localX = input.clientX - rect.left;
                const localY = input.clientY - rect.top;
                const world = { x: (localX - current.x) / current.k, y: (localY - current.y) / current.k };
                previewViewport({ x: localX - world.x * nextZoom, y: localY - world.y * nextZoom, k: nextZoom });
            });
            if (wheelCommitTimerRef.current) clearTimeout(wheelCommitTimerRef.current);
            wheelCommitTimerRef.current = setTimeout(() => {
                flushFrame();
                commitViewport();
                onViewportInteractionChange?.(false);
            }, 140);
        },
        [commitViewport, flushFrame, onViewportInteractionChange, previewViewport, scheduleFrame],
    );

    useEffect(() => {
        const element = surfaceRef.current;
        if (!element) return;
        element.addEventListener("wheel", handleWheel, { passive: false });
        return () => element.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    const handlePaneDoubleClick = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-node-id],[data-connection-id],[data-connection-create-menu],[data-canvas-node-create-menu]")) return;
            onPaneDoubleClick(screenToWorld(event.clientX, event.clientY));
        },
        [onPaneDoubleClick, screenToWorld],
    );

    const previewNodeResize = useCallback(
        (id: string, width: number, height: number, position?: Position) => {
            scheduleFrame(`resize:${id}`, () => {
                const current = localTransformsRef.current[id] || nodesRef.current.find((node) => node.id === id);
                if (!current) return;
                const next = { ...localTransformsRef.current, [id]: { position: position || current.position, width, height } };
                resizingNodeIdRef.current = id;
                localTransformsRef.current = next;
                setLocalTransforms(next);
            });
        },
        [scheduleFrame],
    );

    const commitNodeResize = useCallback(
        (id: string, width: number, height: number, position?: Position) => {
            flushFrame();
            resizingNodeIdRef.current = null;
            onNodesCommit([{ id, width, height, position }]);
        },
        [flushFrame, onNodesCommit],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") cancelTransientInteraction();
            if (event.code !== "Space" || isEditableKeyboardTarget(event.target)) return;
            event.preventDefault();
            if (temporaryPanRef.current) return;
            temporaryPanRef.current = true;
            setTemporaryPan(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            temporaryPanRef.current = false;
            setTemporaryPan(false);
        };
        const handleBlur = () => {
            temporaryPanRef.current = false;
            setTemporaryPan(false);
            cancelTransientInteraction();
        };
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, [cancelTransientInteraction]);

    const activeSelectedNodeIds = boxSelection?.nodeIds || selectedNodeIds;
    const visibleConnection = connection || (pendingConnectionCreate ? { ...pendingConnectionCreate.connection, world: pendingConnectionCreate.position, targetNodeId: null } : null);
    const connectionStartNode = visibleConnection ? nodesById.get(visibleConnection.nodeId) : null;
    const pendingPreviewSourceIds = pendingConnectionCreate ? (pendingConnectionCreate.sourceNodeIds?.length ? pendingConnectionCreate.sourceNodeIds : [pendingConnectionCreate.connection.nodeId]) : [];
    const visibleConnectionPreviewPaths =
        connection && connectionStartNode
            ? [previewPath(nodeAnchor(connectionStartNode, connection.handleType), connection.world, connection.handleType)]
            : pendingPreviewSourceIds
                  .map((sourceId) => {
                      const source = nodesById.get(sourceId);
                      return source ? previewPath(nodeAnchor(source, pendingConnectionCreate!.connection.handleType), pendingConnectionCreate!.position, pendingConnectionCreate!.connection.handleType) : null;
                  })
                  .filter((path): path is string => Boolean(path));
    const previewMinimapViewport = useCallback(
        (next: ViewportTransform) => {
            onViewportInteractionChange?.(true);
            scheduleFrame("minimap", () => previewViewport(next));
        },
        [onViewportInteractionChange, previewViewport, scheduleFrame],
    );
    const commitMinimapViewport = useCallback(() => {
        flushFrame();
        commitViewport();
        onViewportInteractionChange?.(false);
    }, [commitViewport, flushFrame, onViewportInteractionChange]);
    const showCutScissors = useCallback((event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
        event.preventDefault();
        event.stopPropagation();
        const surface = surfaceRef.current;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        setEdgeCut({ connectionId, left: event.clientX - rect.left, top: event.clientY - rect.top });
    }, []);

    useEffect(() => {
        if (!edgeCut) return;
        if (!connections.some((connection) => connection.id === edgeCut.connectionId)) {
            setEdgeCut(null);
            return;
        }
        const dismissPointer = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".canvas-edge-cut-scissors")) return;
            setEdgeCut(null);
        };
        const dismissWheel = () => setEdgeCut(null);
        const dismissKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setEdgeCut(null);
        };
        document.addEventListener("pointerdown", dismissPointer, true);
        document.addEventListener("keydown", dismissKey, true);
        window.addEventListener("wheel", dismissWheel, { capture: true, passive: true });
        return () => {
            document.removeEventListener("pointerdown", dismissPointer, true);
            document.removeEventListener("keydown", dismissKey, true);
            window.removeEventListener("wheel", dismissWheel, { capture: true });
        };
    }, [connections, edgeCut]);

    const worldStyle: CSSProperties = { transform: `translate(${displayViewport.x}px, ${displayViewport.y}px) scale(${displayViewport.k})`, transformOrigin: "0 0" };
    /* LOD 双条件：远景缩放 或 视口内渲染节点过多，任一满足就释放 backdrop-filter */
    const lodLow = displayViewport.k < 0.48 || renderedNodes.length > 40;

    const canvasStyle: CSSProperties = { background: theme.canvas.backdrop, color: theme.node.text, touchAction: "none", cursor: temporaryPan || interactionMode === "pan" ? "grab" : "default" };
    const gridSize = canvasGridSize(backgroundMode, displayViewport.k);
    const selectionStyle = boxSelection
        ? {
              left: Math.min(boxSelection.start.x, boxSelection.current.x),
              top: Math.min(boxSelection.start.y, boxSelection.current.y),
              width: Math.abs(boxSelection.current.x - boxSelection.start.x),
              height: Math.abs(boxSelection.current.y - boxSelection.start.y),
          }
        : undefined;
    const multiSelectionNodes = useMemo(() => {
        if (selectedNodeIds.size < 2) return [];
        return Array.from(selectedNodeIds)
            .map((id) => getDisplayNode(id))
            .filter((node): node is CanvasNodeData => node !== undefined && !hiddenNodeIds.has(node.id));
    }, [getDisplayNode, hiddenNodeIds, selectedNodeIds]);
    const multiSelectionBounds = useMemo(() => {
        if (boxSelection || multiSelectionNodes.length < 2) return null;
        const padding = MULTI_SELECTION_PADDING_PX / Math.max(displayViewport.k, 0.01);
        return canvasNodesBounds(multiSelectionNodes, padding, padding);
    }, [boxSelection, displayViewport.k, multiSelectionNodes]);
    multiSelectionBoundsRef.current = multiSelectionBounds;
    const multiSelectionScale = Math.max(displayViewport.k, 0.01);
    const knobScreenScale = Math.max(0.5, Math.min(1, displayViewport.k));

    const updateBatchHandleMagnet = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!multiSelectionBounds || batchConnectionRef.current) {
            setBatchHandleOffset((current) => (current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 }));
            return;
        }
        const surface = surfaceRef.current;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        const anchorX = displayViewport.x + multiSelectionBounds.right * displayViewport.k + 18;
        const anchorY = displayViewport.y + ((multiSelectionBounds.top + multiSelectionBounds.bottom) / 2) * displayViewport.k;
        const dx = event.clientX - rect.left - anchorX;
        const dy = event.clientY - rect.top - anchorY;
        const distance = Math.hypot(dx, dy);
        const radius = 56;
        if (distance > radius) {
            setBatchHandleOffset((current) => (current.x === 0 && current.y === 0 ? current : { x: 0, y: 0 }));
            return;
        }
        const strength = 1 - distance / radius;
        const maxOffset = 14 * strength;
        const length = Math.max(1, distance);
        setBatchHandleOffset({ x: (dx / length) * maxOffset, y: (dy / length) * maxOffset });
    };

    const batchHandlePosition = batchConnection
        ? batchConnection.current
        : {
              x: multiSelectionBounds ? multiSelectionBounds.right + (18 + batchHandleOffset.x) / multiSelectionScale : 0,
              y: multiSelectionBounds ? (multiSelectionBounds.top + multiSelectionBounds.bottom) / 2 + batchHandleOffset.y / multiSelectionScale : 0,
          };

    const updateNearNodeProximity = (event: ReactPointerEvent<HTMLDivElement>) => {
        const world = screenToWorld(event.clientX, event.clientY);
        const threshold = 48 / Math.max(displayViewportRef.current.k, 0.01);
        const candidates = nodeSpatialIndexRef.current.queryPoint(world, threshold);
        let nearestId: string | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const node of candidates) {
            const dx = Math.max(node.position.x - world.x, 0, world.x - (node.position.x + node.width));
            const dy = Math.max(node.position.y - world.y, 0, world.y - (node.position.y + node.height));
            const distance = Math.hypot(dx, dy);
            if (distance <= threshold && distance < nearestDistance) {
                nearestDistance = distance;
                nearestId = node.id;
            }
        }
        setNearNodeId((current) => (current === nearestId ? current : nearestId));
    };

    const findBatchTarget = (world: Position, sourceIds: ReadonlySet<string>) => {
        const tolerance = 52 / Math.max(displayViewport.k, 0.1);
        let best: { id: string; distance: number } | null = null;
        for (let index = visibleNodes.length - 1; index >= 0; index -= 1) {
            const node = visibleNodes[index];
            if (sourceIds.has(node.id)) continue;
            const anchor = nodeAnchor(node, "target");
            const inside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
            const distance = Math.hypot(world.x - anchor.x, world.y - anchor.y);
            if (!inside && distance > tolerance) continue;
            if (!best || distance < best.distance) best = { id: node.id, distance };
        }
        return best?.id ?? null;
    };

    useEffect(() => {
        if (!batchConnection) return;
        let frame = 0;
        let previousTime = 0;
        const panAtEdge = (time: number) => {
            const pointer = batchConnectionPointerRef.current;
            const draft = batchConnectionRef.current;
            const rect = surfaceRef.current?.getBoundingClientRect();
            if (!pointer || !draft || !rect) return;
            const margin = 52;
            const velocity = (position: number, min: number, max: number) => (position < min + margin ? Math.min(1, (min + margin - position) / margin) : position > max - margin ? -Math.min(1, (position - max + margin) / margin) : 0);
            const elapsed = previousTime ? (time - previousTime) / 1000 : 0;
            previousTime = time;
            const dx = velocity(pointer.x, rect.left, rect.right) * margin * 6 * elapsed;
            const dy = velocity(pointer.y, rect.top, rect.bottom) * margin * 6 * elapsed;
            if (dx || dy) {
                const viewport = displayViewportRef.current;
                previewViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
                const world = screenToWorld(pointer.x, pointer.y);
                const next = { ...draft, current: world, targetNodeId: findBatchTarget(world, new Set(draft.sourceIds)) };
                batchConnectionRef.current = next;
                setBatchConnection(next);
            }
            frame = requestAnimationFrame(panAtEdge);
        };
        frame = requestAnimationFrame(panAtEdge);
        return () => cancelAnimationFrame(frame);
    }, [Boolean(batchConnection), previewViewport, screenToWorld]);

    const startBatchConnection = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!multiSelectionBounds) return;
        setBatchHandleHidden(false);
        const sourceIds = [...selectedNodeIds].filter((id) => nodesById.has(id) && !hiddenNodeIds.has(id));
        if (sourceIds.length < 2) return;
        const start = { x: multiSelectionBounds.right, y: (multiSelectionBounds.top + multiSelectionBounds.bottom) / 2 };
        const draft: BatchConnectionDraft = {
            pointerId: event.pointerId,
            start,
            current: start,
            sourceIds,
            targetNodeId: findBatchTarget(start, new Set(sourceIds)),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        batchConnectionPointerRef.current = { x: event.clientX, y: event.clientY };
        batchConnectionRef.current = draft;
        setBatchConnection(draft);
        setEdgeCut(null);
    };

    const moveBatchConnection = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const draft = batchConnectionRef.current;
        if (!draft || draft.pointerId !== event.pointerId) return;
        batchConnectionPointerRef.current = { x: event.clientX, y: event.clientY };
        const world = screenToWorld(event.clientX, event.clientY);
        const next = { ...draft, current: world, targetNodeId: findBatchTarget(world, new Set(draft.sourceIds)) };
        batchConnectionRef.current = next;
        setBatchConnection(next);
    };

    const finishBatchConnection = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const draft = batchConnectionRef.current;
        if (!draft || draft.pointerId !== event.pointerId) return;
        batchConnectionPointerRef.current = null;
        const world = screenToWorld(event.clientX, event.clientY);
        const targetNodeId = findBatchTarget(world, new Set(draft.sourceIds));
        batchConnectionRef.current = null;
        setBatchConnection(null);
        setBatchHandleHidden(true);
        if (targetNodeId) {
            onConnectBatch(draft.sourceIds, targetNodeId);
            return;
        }
        onConnectionCreate({
            nodeId: draft.sourceIds[0],
            handleType: "source",
            position: world,
            sourceNodeIds: draft.sourceIds,
        });
    };

    const cancelBatchConnection = () => {
        batchConnectionPointerRef.current = null;
        batchConnectionRef.current = null;
        setBatchConnection(null);
        setBatchHandleHidden(true);
    };

    return (
        <div
            ref={setSurfaceRef}
            data-canvas-surface
            data-canvas-interaction-mode={interactionMode}
            data-canvas-temporary-pan={temporaryPan ? "true" : "false"}
            tabIndex={-1}
            className={`canvas-surface absolute inset-0 select-none overflow-hidden${surfaceInteracting ? " canvas-interacting" : ""}`}
            style={canvasStyle}
            onPointerDownCapture={(event) => {
                setSurfaceInteracting(true);
                handlePointerDownCapture(event);
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={(event) => {
                updateBatchHandleMagnet(event);
                updateNearNodeProximity(event);
            }}
            onPointerLeave={() => {
                setBatchHandleOffset({ x: 0, y: 0 });
                setNearNodeId(null);
            }}
            onWheelCapture={() => setSurfaceInteracting(true)}
            onWheel={() => {
                window.setTimeout(() => setSurfaceInteracting(false), 180);
            }}
            onDoubleClick={handlePaneDoubleClick}
            onDrop={onDrop}
            onDragOver={(event) => event.preventDefault()}
            onContextMenu={(event) => {
                if ((event.target as Element).closest("[data-node-id],[data-connection-id],[data-canvas-node-create-menu]")) return;
                event.preventDefault();
                onPaneContextMenu(event);
                onPaneDoubleClick(screenToWorld(event.clientX, event.clientY));
            }}
        >
            {backgroundMode !== "blank" ? (
                <div
                    ref={backgroundLayerRef}
                    data-canvas-grid
                    className="pointer-events-none absolute inset-0"
                    style={{
                        backgroundImage: canvasGridImage(backgroundMode, theme, displayViewport.k),
                        backgroundSize: `${gridSize}px ${gridSize}px`,
                        backgroundPosition: `${displayViewport.x}px ${displayViewport.y}px`,
                        opacity: canvasGridOpacity(displayViewport.k),
                    }}
                />
            ) : null}
            <div data-canvas-world-viewport className="pointer-events-none absolute inset-0 overflow-visible" style={{ contain: "layout style", isolation: "isolate", backgroundColor: "transparent" }}>
                <div ref={worldLayerRef} className="absolute inset-0 overflow-visible" style={worldStyle} data-lod={lodLow ? "low" : "normal"}>
                    <svg className="absolute left-0 top-0 h-full w-full overflow-visible" style={{ pointerEvents: "none" }} aria-hidden="true">
                        {aggregateIdleConnectionPath ? <path d={aggregateIdleConnectionPath} fill="none" stroke={theme.edge.idle} strokeWidth={1.5} strokeLinecap="round" /> : null}
                        {flowConnections.map((item) => {
                            const from = nodesById.get(item.fromNodeId);
                            const to = nodesById.get(item.toNodeId);
                            if (!from || !to) return null;
                            const selected = selectedConnectionId === item.id;
                            const hovered = hoveredConnectionId === item.id;
                            const active = selected || relatedConnectionIds.has(item.id);
                            const path = connectionPaths.get(item.id) || edgePath(from, to);
                            return (
                                <g key={item.id} data-connection-id={item.id}>
                                    <path
                                        d={path}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={20}
                                        style={{ pointerEvents: "stroke", cursor: "pointer" }}
                                        onPointerEnter={() => setHoveredConnectionId(item.id)}
                                        onPointerLeave={() => setHoveredConnectionId((current) => (current === item.id ? null : current))}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setSelection(new Set(), item.id);
                                        }}
                                        onDoubleClick={(event) => showCutScissors(event, item.id)}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onEdgeContextMenu(event, item.id);
                                        }}
                                    />
                                    {selected || hovered ? (
                                        <path
                                            d={path}
                                            fill="none"
                                            stroke={selected ? theme.edge.selected : theme.edge.hover}
                                            strokeWidth={selected ? 2 : 1.5}
                                            strokeLinecap="round"
                                            style={{ pointerEvents: "none", transition: "stroke 200ms ease, stroke-width 200ms ease" }}
                                        />
                                    ) : null}
                                    {active ? (
                                        <g className="canvas-edge-flow-group" fill="none" stroke={theme.edge.flow} style={{ pointerEvents: "none" }} aria-hidden="true">
                                            <path d={path} pathLength={300} strokeWidth={edgeFlowWidth + 4} strokeOpacity={0.06 * edgeFlowOpacity} strokeLinecap="round" />
                                            <path d={path} pathLength={300} strokeWidth={edgeFlowWidth + 2} strokeOpacity={0.12 * edgeFlowOpacity} strokeLinecap="round" />
                                            {EDGE_FLOW_LAYERS.map((layer) => (
                                                <path key={layer.dash} d={path} pathLength={300} strokeWidth={edgeFlowWidth} strokeDasharray={layer.dash} strokeOpacity={layer.opacity * edgeFlowOpacity} strokeLinecap="butt" />
                                            ))}
                                        </g>
                                    ) : null}
                                </g>
                            );
                        })}
                        {visibleConnectionPreviewPaths.length ? (
                            <g data-canvas-connection-preview-group style={{ pointerEvents: "none" }}>
                                {visibleConnectionPreviewPaths.map((previewPathValue, index) => (
                                    <g key={`${previewPathValue}-${index}`}>
                                        <path d={previewPathValue} data-canvas-connection-preview fill="none" stroke={theme.edge.selected} strokeWidth={2} strokeLinecap="round" />
                                        <g className="canvas-edge-flow-group canvas-batch-edge-flow" fill="none" stroke={theme.edge.flow} aria-hidden="true">
                                            <path d={previewPathValue} data-canvas-connection-preview pathLength={300} strokeWidth={edgeFlowWidth + 4} strokeOpacity={0.06 * edgeFlowOpacity} strokeLinecap="round" />
                                            <path d={previewPathValue} data-canvas-connection-preview pathLength={300} strokeWidth={edgeFlowWidth + 2} strokeOpacity={0.12 * edgeFlowOpacity} strokeLinecap="round" />
                                            {EDGE_FLOW_LAYERS.map((layer) => (
                                                <path
                                                    key={layer.dash}
                                                    d={previewPathValue}
                                                    data-canvas-connection-preview
                                                    pathLength={300}
                                                    strokeWidth={edgeFlowWidth}
                                                    strokeDasharray={layer.dash}
                                                    strokeOpacity={layer.opacity * edgeFlowOpacity}
                                                    strokeLinecap="butt"
                                                />
                                            ))}
                                        </g>
                                    </g>
                                ))}
                            </g>
                        ) : null}
                        {batchConnection
                            ? batchConnection.sourceIds.map((sourceId) => {
                                  const source = nodesById.get(sourceId);
                                  if (!source) return null;
                                  const path = previewPath(nodeAnchor(source, "source"), batchConnection.current, "source");
                                  return (
                                      <g key={sourceId} data-canvas-batch-connection-preview>
                                          <path d={path} fill="none" stroke={theme.edge.selected} strokeWidth={2} strokeLinecap="round" />
                                          <g className="canvas-edge-flow-group canvas-batch-edge-flow" fill="none" stroke={theme.edge.flow} style={{ pointerEvents: "none" }} aria-hidden="true">
                                              <path d={path} pathLength={300} strokeWidth={edgeFlowWidth + 4} strokeOpacity={0.06 * edgeFlowOpacity} strokeLinecap="round" />
                                              <path d={path} pathLength={300} strokeWidth={edgeFlowWidth + 2} strokeOpacity={0.12 * edgeFlowOpacity} strokeLinecap="round" />
                                              {EDGE_FLOW_LAYERS.map((layer) => (
                                                  <path key={layer.dash} d={path} pathLength={300} strokeWidth={edgeFlowWidth} strokeDasharray={layer.dash} strokeOpacity={layer.opacity * edgeFlowOpacity} strokeLinecap="butt" />
                                              ))}
                                          </g>
                                      </g>
                                  );
                              })
                            : null}
                    </svg>
                    <div className="pointer-events-none absolute inset-0 overflow-visible">
                        {renderedNodes.map((node) => {
                            const viewProps = getNodeViewProps(node);
                            const loadImage = mediaLoadIds.has(node.id) || lowZoomVideoLoadIds.has(node.id);
                            return (
                                <CanvasNode
                                    key={node.id}
                                    {...nodeProps}
                                    {...viewProps}
                                    loadImage={loadImage}
                                    data={node}
                                    scale={displayViewport.k}
                                    isSelected={activeSelectedNodeIds.has(node.id)}
                                    isRelated={relatedNodeIds.has(node.id)}
                                    isFocusRelated={activeSelectedNodeIds.has(node.id) || relatedNodeIds.has(node.id)}
                                    isConnectionTarget={connection?.targetNodeId === node.id || batchConnection?.targetNodeId === node.id}
                                    isNear={nearNodeId === node.id}
                                    connectingHandleSide={connection?.nodeId === node.id ? (connection.handleType === "source" ? "right" : "left") : null}
                                    isConnecting={connection?.nodeId === node.id}
                                    animateSize={!connectedNodeIds.has(node.id)}
                                    renderPanel={renderPanel}
                                    renderNodeContent={renderNode}
                                    onMouseDown={handleNodeMouseDown}
                                    onConnectStart={handleConnectStart}
                                    onResize={previewNodeResize}
                                    onResizeEnd={commitNodeResize}
                                    onContextMenu={handleNodeContextMenu}
                                />
                            );
                        })}
                        {selectionStyle ? <div className="pointer-events-none absolute border" style={{ ...selectionStyle, borderColor: theme.canvas.selectionStroke, background: theme.canvas.selectionFill }} /> : null}
                        {multiSelectionBounds ? (
                            <div
                                data-canvas-multi-selection-frame
                                aria-label={`已选 ${multiSelectionNodes.length} 项`}
                                className="pointer-events-none absolute"
                                style={{
                                    left: multiSelectionBounds.left,
                                    top: multiSelectionBounds.top,
                                    width: Math.max(0, multiSelectionBounds.right - multiSelectionBounds.left),
                                    height: Math.max(0, multiSelectionBounds.bottom - multiSelectionBounds.top),
                                    border: `${1.5 / multiSelectionScale}px dashed ${EDGE_ACTIVE_COLOR}`,
                                    borderRadius: 18 / multiSelectionScale,
                                    background: theme.canvas.selectionFill,
                                    boxShadow: `0 0 0 ${1 / multiSelectionScale}px rgba(255,255,255,.08)`,
                                    zIndex: 46,
                                }}
                            />
                        ) : null}
                        {multiSelectionBounds ? (
                            <div
                                data-canvas-multi-selection-count
                                className="pointer-events-none absolute whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
                                style={{
                                    left: multiSelectionBounds.left + 12 / multiSelectionScale,
                                    top: multiSelectionBounds.top - 12 / multiSelectionScale,
                                    transform: `translateY(-100%) scale(${1 / multiSelectionScale})`,
                                    transformOrigin: "0 100%",
                                    background: theme.node.stroke,
                                    zIndex: 60,
                                }}
                            >
                                已选 {multiSelectionNodes.length} 项
                            </div>
                        ) : null}
                        {multiSelectionBounds && (!batchHandleHidden || batchConnection) ? (
                            <button
                                type="button"
                                data-canvas-batch-connect
                                aria-label="批量连接选中节点"
                                className="canvas-glass-knob pointer-events-auto absolute grid size-7 place-items-center rounded-full"
                                style={{
                                    left: batchHandlePosition.x,
                                    top: batchHandlePosition.y,
                                    transform: `translate(-50%, -50%) scale(${knobScreenScale / multiSelectionScale})`,
                                    color: theme.node.text,
                                    transition: batchConnection ? "none" : "left 90ms ease-out, top 90ms ease-out",
                                    willChange: "left, top",
                                    zIndex: 70,
                                }}
                                onPointerDown={startBatchConnection}
                                onPointerMove={moveBatchConnection}
                                onPointerUp={finishBatchConnection}
                                onPointerCancel={cancelBatchConnection}
                                onDoubleClick={(event) => event.stopPropagation()}
                            >
                                <Plus className="size-3" aria-hidden />
                            </button>
                        ) : null}
                        {overlay}
                    </div>
                </div>
            </div>
            {connection ? (
                <div
                    data-canvas-connection-knob
                    className="canvas-glass-knob pointer-events-none absolute z-[130] grid size-7 place-items-center rounded-full"
                    style={{
                        left: displayViewport.x + connection.world.x * displayViewport.k,
                        top: displayViewport.y + connection.world.y * displayViewport.k,
                        transform: `translate(-50%, -50%) scale(${knobScreenScale})`,
                        color: theme.node.text,
                    }}
                >
                    <Plus className="size-3" aria-hidden />
                </div>
            ) : null}
            {edgeCut ? (
                <button
                    type="button"
                    className="canvas-edge-cut-scissors pointer-events-auto absolute z-[130] grid size-9 place-items-center rounded-full border shadow-xl"
                    style={{ left: edgeCut.left, top: edgeCut.top, transform: "translate(-50%, -50%)", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setEdgeCut(null);
                        onEdgeCut(edgeCut.connectionId);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerLeave={() => setEdgeCut(null)}
                    onContextMenu={(event) => event.stopPropagation()}
                    aria-label="切断参考"
                >
                    <Scissors className="size-5" aria-hidden />
                </button>
            ) : null}
            {minimapOpen ? <CanvasMiniMap nodes={visibleNodes} viewport={displayViewport} viewportSize={surfaceSize} theme={theme} onViewportPreview={previewMinimapViewport} onViewportCommit={commitMinimapViewport} /> : null}
        </div>
    );
}

const EMPTY_NODE_IDS = new Set<string>();

function canvasGridSize(backgroundMode: CanvasBackgroundMode, scale: number) {
    /* 低缩放时不跟着缩：22px * 0.25 = 5.5px 间距会把点糊成一片灰雾 */
    if (scale < 0.5) return backgroundMode === "dots" ? 28 : 40;
    return backgroundMode === "dots" ? 22 * scale : 32 * scale;
}

function canvasGridImage(backgroundMode: CanvasBackgroundMode, theme: CanvasTheme, scale: number) {
    const dotRadius = Math.max(0.7, Math.min(1.5, scale));
    const dot = theme.canvas.dot;
    const line = theme.canvas.line;
    return backgroundMode === "dots" ? `radial-gradient(circle, ${dot} ${dotRadius}px, transparent ${dotRadius}px)` : `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`;
}

function canvasGridOpacity(scale: number) {
    return Math.max(0.28, Math.min(0.7, scale * 0.9));
}

/* 小地图节点配色：按类型区分，一眼能看出缩略图里哪块是图、哪块是视频 */
const MINIMAP_NODE_COLORS: Partial<Record<CanvasNodeType, string>> = {
    [CanvasNodeType.Image]: "#60a5fa",
    [CanvasNodeType.Video]: "#a78bfa",
    [CanvasNodeType.Audio]: "#34d399",
    [CanvasNodeType.Panorama]: "#22d3ee",
    [CanvasNodeType.Config]: "#e2671f",
    [CanvasNodeType.Text]: "#94a3b8",
};

function minimapNodeColor(type: CanvasNodeType, theme: CanvasTheme) {
    return MINIMAP_NODE_COLORS[type] ?? theme.node.muted;
}

function CanvasMiniMap({
    nodes,
    viewport,
    viewportSize,
    theme,
    onViewportPreview,
    onViewportCommit,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    theme: CanvasTheme;
    onViewportPreview: (viewport: ViewportTransform) => void;
    onViewportCommit: () => void;
}) {
    const width = Math.min(264, Math.max(184, viewportSize.width - 32));
    const height = Math.round(width * 0.62);
    const ref = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    /* 拖动时限制到约 30fps：小地图每帧都改 viewport，会让整张画布（含所有节点）
     * 跟着重排，节点一多就明显掉帧。 */
    const lastPreviewAtRef = useRef(0);
    const viewportWorldRect = { x: -viewport.x / viewport.k, y: -viewport.y / viewport.k, width: viewportSize.width / viewport.k, height: viewportSize.height / viewport.k };
    const nodeBounds = useMemo(() => canvasNodesBounds(nodes), [nodes]);
    /* 视野框也算进世界范围：画布平移出节点区域时，小地图要缩放到"节点 + 当前视野"的并集，
     * 否则视口框会跑到小地图外面被裁掉，看起来像消失了。 */
    const bounds = useMemo(
        () => ({
            left: Math.min(nodeBounds.left, viewportWorldRect.x),
            top: Math.min(nodeBounds.top, viewportWorldRect.y),
            right: Math.max(nodeBounds.right, viewportWorldRect.x + viewportWorldRect.width),
            bottom: Math.max(nodeBounds.bottom, viewportWorldRect.y + viewportWorldRect.height),
        }),
        [nodeBounds, viewportWorldRect.x, viewportWorldRect.y, viewportWorldRect.width, viewportWorldRect.height],
    );
    const worldWidth = Math.max(1, bounds.right - bounds.left);
    const worldHeight = Math.max(1, bounds.bottom - bounds.top);
    const scale = Math.min(width / worldWidth, height / worldHeight);
    const offsetX = (width - worldWidth * scale) / 2;
    const offsetY = (height - worldHeight * scale) / 2;
    const point = useCallback((x: number, y: number) => ({ x: offsetX + (x - bounds.left) * scale, y: offsetY + (y - bounds.top) * scale }), [bounds.left, bounds.top, offsetX, offsetY, scale]);
    const viewPoint = point(viewportWorldRect.x, viewportWorldRect.y);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(width * pixelRatio));
        canvas.height = Math.max(1, Math.round(height * pixelRatio));
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);

        /* 底纹：跟画布一致的点阵，缩略图才像"一张画布"而不是浮在空白上的灰块 */
        context.globalAlpha = 0.45;
        context.fillStyle = theme.canvas.dot;
        for (let gx = 6; gx < width; gx += 12) {
            for (let gy = 6; gy < height; gy += 12) {
                context.fillRect(gx, gy, 1, 1);
            }
        }

        /* 节点：按类型着色 + 圆角，替代原来清一色的直角灰块 */
        context.globalAlpha = 1;
        for (const node of nodes) {
            const p = point(node.position.x, node.position.y);
            const w = Math.max(2.5, node.width * scale);
            const h = Math.max(2.5, node.height * scale);
            context.fillStyle = minimapNodeColor(node.type, theme);
            context.beginPath();
            context.roundRect(p.x, p.y, w, h, Math.min(2.5, w / 2, h / 2));
            context.fill();
        }
    }, [bounds.bottom, bounds.left, bounds.right, bounds.top, height, nodes, point, scale, theme.canvas.dot, theme.node.muted, width]);
    const update = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const now = performance.now();
        if (now - lastPreviewAtRef.current < 32) return;
        lastPreviewAtRef.current = now;
        const world = { x: (event.clientX - rect.left - offsetX) / scale + bounds.left, y: (event.clientY - rect.top - offsetY) / scale + bounds.top };
        onViewportPreview({ x: viewportSize.width / 2 - world.x * viewport.k, y: viewportSize.height / 2 - world.y * viewport.k, k: viewport.k });
    };
    const finishDrag = () => {
        if (!dragging) return;
        setDragging(false);
        onViewportCommit();
    };
    return (
        <div
            data-canvas-minimap
            data-canvas-no-zoom
            className="canvas-minimap absolute bottom-20 left-3 z-50 overflow-hidden rounded-[14px] backdrop-blur-xl sm:bottom-24 sm:left-5"
            style={{ width, height, background: theme.toolbar.panel, border: `1px solid ${theme.toolbar.border}` }}
        >
            <div
                ref={ref}
                className="relative h-full w-full cursor-crosshair"
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                    update(event);
                }}
                onPointerMove={(event) => {
                    if (dragging) update(event);
                }}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
            >
                <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden="true" />
                <div
                    className="canvas-minimap-viewport pointer-events-none absolute rounded-[4px]"
                    style={{
                        left: viewPoint.x,
                        top: viewPoint.y,
                        width: Math.max(6, viewportWorldRect.width * scale),
                        height: Math.max(6, viewportWorldRect.height * scale),
                        border: "1.5px solid #e2671f",
                        background: "rgba(226,103,31,.1)",
                        boxShadow: "0 0 0 1px rgba(255,255,255,.55), 0 0 8px rgba(226,103,31,.35)",
                    }}
                />
            </div>
        </div>
    );
}
