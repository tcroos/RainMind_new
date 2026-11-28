import { describe, expect, it } from "vitest";

import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth, sidebarModeForWidth } from "./sidebar-width";

describe("sidebar width modes", () => {
    it("clamps to the original 72px ~ 232px bounds", () => {
        expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
        expect(clampSidebarWidth(999)).toBe(SIDEBAR_MAX_WIDTH);
        expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_MIN_WIDTH);
    });

    it("switches collapsed → compact at 30% and compact → full at 70%", () => {
        expect(sidebarModeForWidth(72)).toBe("collapsed");
        expect(sidebarModeForWidth(119)).toBe("collapsed");
        expect(sidebarModeForWidth(120)).toBe("compact");
        expect(sidebarModeForWidth(183)).toBe("compact");
        expect(sidebarModeForWidth(184)).toBe("full");
        expect(sidebarModeForWidth(232)).toBe("full");
    });

    it("keeps rail icons pinned on the left while the width animates (Lovart-style)", async () => {
        const { readFile } = await import("node:fs/promises");
        const nav = await readFile("src/components/layout/workspace-nav-list.tsx", "utf8");
        const projects = await readFile("src/components/layout/sidebar-projects.tsx", "utf8");
        const sidebar = await readFile("src/components/layout/app-sidebar.tsx", "utf8");
        expect(nav).toContain("pl-[19px]");
        expect(nav).not.toContain('expanded ? "px-4" : "px-2"');
        expect(projects).toContain('expanded ? "w-full pr-3" : "w-10"');
        expect(sidebar).toContain("overflow-x-clip");
    });
});
