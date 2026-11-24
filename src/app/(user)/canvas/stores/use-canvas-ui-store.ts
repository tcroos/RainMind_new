import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_CANVAS_PALETTE_ID, type CanvasPaletteMode } from "@/lib/canvas-palette";

type CanvasUiStore = {
    editingProjectId: string | null;
    editingProjectTitle: string;
    selectedProjectIds: string[];
    deleteProjectIds: string[];
    startEditingProject: (id: string, title: string) => void;
    setEditingProjectTitle: (title: string) => void;
    stopEditingProject: () => void;
    toggleSelectedProjectId: (id: string, selected: boolean) => void;
    setDeleteProjectIds: (ids: string[]) => void;
    removeSelectedProjectIds: (ids: string[]) => void;
    /** 深浅两套色盘各自记忆，切换深浅时还原各自上次选择 */
    lightPaletteId: string;
    darkPaletteId: string;
    setPaletteId: (mode: CanvasPaletteMode, id: string) => void;
};

export const useCanvasUiStore = create<CanvasUiStore>()(
    persist(
        (set) => ({
            editingProjectId: null,
            editingProjectTitle: "",
            selectedProjectIds: [],
            deleteProjectIds: [],
            startEditingProject: (editingProjectId, editingProjectTitle) => set({ editingProjectId, editingProjectTitle }),
            setEditingProjectTitle: (editingProjectTitle) => set({ editingProjectTitle }),
            stopEditingProject: () => set({ editingProjectId: null }),
            toggleSelectedProjectId: (id, selected) => set((state) => ({ selectedProjectIds: selected ? [...new Set([...state.selectedProjectIds, id])] : state.selectedProjectIds.filter((item) => item !== id) })),
            setDeleteProjectIds: (deleteProjectIds) => set({ deleteProjectIds }),
            lightPaletteId: DEFAULT_CANVAS_PALETTE_ID.light,
            darkPaletteId: DEFAULT_CANVAS_PALETTE_ID.dark,
            setPaletteId: (mode, id) => set(mode === "light" ? { lightPaletteId: id } : { darkPaletteId: id }),
            removeSelectedProjectIds: (ids) =>
                set((state) => ({
                    selectedProjectIds: state.selectedProjectIds.filter((id) => !ids.includes(id)),
                    editingProjectId: state.editingProjectId && ids.includes(state.editingProjectId) ? null : state.editingProjectId,
                    editingProjectTitle: state.editingProjectId && ids.includes(state.editingProjectId) ? "" : state.editingProjectTitle,
                })),
        }),
        {
            name: "rainmind-canvas-ui",
            /* 只持久化色盘偏好：面板开关这类瞬时 UI 状态不该跨会话还原 */
            partialize: (state) => ({ lightPaletteId: state.lightPaletteId, darkPaletteId: state.darkPaletteId }),
            storage: createJSONStorage(() => localStorage),
            /* 关闭自动水合，改由画布页在挂载后手动 rehydrate，避免 SSR/CSR 首屏色盘闪一下 */
            skipHydration: true,
        },
    ),
);
