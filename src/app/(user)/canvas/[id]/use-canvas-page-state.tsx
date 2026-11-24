"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { canvasPaletteVariables, resolveCanvasPalette } from "@/lib/canvas-palette";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { App } from "antd";
import { type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { useCanvasStore } from "../stores/use-canvas-store";
import { type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type ContextMenuState, type Position, type ViewportTransform } from "../types";

import { CanvasClipboard, CanvasGenerationRequest, CanvasHistoryEntry, PendingConnectionCreate } from "./canvas-page-elements";
import type { CanvasTaskCommitIdentity } from "./canvas-task-commit-guard";

export function useCanvasPageState() {
    const { message, modal } = App.useApp();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const projectId = params.id;
    const projectSession = useRef({ projectId, token: crypto.randomUUID() });
    useLayoutEffect(() => {
        if (projectSession.current.projectId !== projectId) projectSession.current = { projectId, token: crypto.randomUUID() };
    }, [projectId]);

    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nodeDraggingRef = useRef(false);

    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const hydratedUserId = useCanvasStore((state) => state.hydratedUserId);
    const hydrate = useCanvasStore((state) => state.hydrate);
    const loadProject = useCanvasStore((state) => state.loadProject);
    const createProject = useCanvasStore((state) => state.createProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const flushProjectSave = useCanvasStore((state) => state.flushProjectSave);
    const projectSaveState = useCanvasStore((state) => state.saveStateByProject[projectId]);
    const retryProjectSave = useCanvasStore((state) => state.retryProjectSave);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    /* 色盘按深浅各自记忆：切深浅时回到该模式下上次选的那款 */
    const lightPaletteId = useCanvasUiStore((state) => state.lightPaletteId);
    const darkPaletteId = useCanvasUiStore((state) => state.darkPaletteId);
    const setPaletteId = useCanvasUiStore((state) => state.setPaletteId);
    const palette = resolveCanvasPalette(colorTheme, colorTheme === "dark" ? darkPaletteId : lightPaletteId);
    const paletteStyle = useMemo(() => canvasPaletteVariables(palette) as CSSProperties, [palette]);
    const selectPalette = useCallback((id: string) => setPaletteId(colorTheme, id), [colorTheme, setPaletteId]);
    /* 色盘偏好由 zustand persist 托管：关闭了自动水合，挂载后手动读一次，
     * 这样 SSR 首屏永远是默认色盘，不会闪一下上次的选择。 */
    useEffect(() => {
        void useCanvasUiStore.persist.rehydrate();
    }, []);
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("dots");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
    const [projectLoadAttempt, setProjectLoadAttempt] = useState(0);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [emotionNodeId, setEmotionNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [assistantCollapsed, setAssistantCollapsed] = useState(true);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const agentCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoOpenedAgentRef = useRef(false);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const canvasTaskCommitIdentityByTargetRef = useRef(new Map<string, CanvasTaskCommitIdentity>());
    const resumingImageTaskIdsRef = useRef(new Set<string>());
    const resumingVideoTaskIdsRef = useRef(new Set<string>());
    const resumingTextTaskIdsRef = useRef(new Set<string>());
    const resumingAudioTaskIdsRef = useRef(new Set<string>());
    return {
        message,
        modal,
        params,
        router,
        projectId,
        projectSession,
        containerRef,
        imageInputRef,
        uploadTargetRef,
        clipboardRef,
        historyRef,
        lastHistoryRef,
        historyCommitTimerRef,
        applyingHistoryRef,
        didInitialCenterRef,
        toolbarHideTimerRef,
        nodeDraggingRef,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        addAsset,
        userId,
        hydrated,
        hydratedUserId,
        hydrate,
        loadProject,
        createProject,
        updateProject,
        flushProjectSave,
        projectSaveState,
        retryProjectSave,
        renameProject,
        deleteProjects,
        currentProject,
        theme,
        nodes,
        setNodes,
        connections,
        setConnections,
        chatSessions,
        setChatSessions,
        activeChatId,
        setActiveChatId,
        viewport,
        setViewport,
        size,
        setSize,
        selectedNodeIds,
        setSelectedNodeIds,
        selectedConnectionId,
        setSelectedConnectionId,
        hoveredNodeId,
        setHoveredNodeId,
        pendingConnectionCreate,
        setPendingConnectionCreate,
        contextMenu,
        setContextMenu,
        runningNodeId,
        setRunningNodeId,
        isMiniMapOpen,
        setIsMiniMapOpen,
        backgroundMode,
        palette,
        paletteStyle,
        selectPalette,
        setBackgroundMode,
        showImageInfo,
        setShowImageInfo,
        clearConfirmOpen,
        setClearConfirmOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        projectLoaded,
        setProjectLoaded,
        projectLoadError,
        setProjectLoadError,
        projectLoadAttempt,
        retryProjectLoad: () => setProjectLoadAttempt((attempt) => attempt + 1),
        toolbarNodeId,
        setToolbarNodeId,
        nodeImageSettingsOpen,
        setNodeImageSettingsOpen,
        dialogNodeId,
        setDialogNodeId,
        editingNodeId,
        setEditingNodeId,
        editRequestNonce,
        setEditRequestNonce,
        infoNodeId,
        setInfoNodeId,
        cropNodeId,
        setCropNodeId,
        maskEditNodeId,
        setMaskEditNodeId,
        splitNodeId,
        setSplitNodeId,
        upscaleNodeId,
        setUpscaleNodeId,
        angleNodeId,
        setAngleNodeId,
        emotionNodeId,
        setEmotionNodeId,
        previewNodeId,
        setPreviewNodeId,
        assistantCollapsed,
        setAssistantCollapsed,
        assistantMounted,
        setAssistantMounted,
        assistantClosing,
        setAssistantClosing,
        titleEditing,
        setTitleEditing,
        titleDraft,
        setTitleDraft,
        historyState,
        setHistoryState,
        collapsingBatchIds,
        setCollapsingBatchIds,
        openingBatchIds,
        setOpeningBatchIds,
        isNodeDragging,
        setIsNodeDragging,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        agentCloseTimerRef,
        autoOpenedAgentRef,
        pendingConnectionCreateRef,
        generationRequestsRef,
        canvasTaskCommitIdentityByTargetRef,
        resumingImageTaskIdsRef,
        resumingVideoTaskIdsRef,
        resumingTextTaskIdsRef,
        resumingAudioTaskIdsRef,
    };
}

export type CanvasPageState = ReturnType<typeof useCanvasPageState>;
