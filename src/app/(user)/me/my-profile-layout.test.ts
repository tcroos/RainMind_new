import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("personal creator page layout", () => {
    it("uses a left-aligned cover header with the avatar overlapping the banner", async () => {
        const page = await readFile(resolve(process.cwd(), "src/app/(user)/me/page.tsx"), "utf8");

        // 封面横幅 + 头像压边（负 margin 上浮，ring 用背景色隔开）
        expect(page).toContain("sm:h-36 sm:rounded-2xl");
        expect(page).toContain("-mt-9 grid size-18");
        expect(page).toContain("ring-4 ring-background");
        // 左对齐布局取代了此前"昵称独立居中"的居中排版
        expect(page).not.toContain("grid-cols-[1.5rem_minmax(0,1fr)_1.5rem]");
        expect(page).not.toContain("items-center pb-5 pt-6 text-center");
        // 昵称与操作按钮同一行，统计单独一行（点分隔），窄屏不会被按钮挤到换行
        expect(page).toContain("flex items-start justify-between gap-3");
        expect(page).toContain("<ProfileMetricDivider />");
        expect(page).not.toContain("rounded-md border border-border bg-card text-muted-foreground");
        expect(page).toContain("<UserRoundPen");
        expect(page).not.toContain("@{user.username}");
        expect(page).toContain('aria-haspopup="dialog"');
        expect(page).toContain("<Input.TextArea");
        expect(page).toContain("maxLength={160}");
        expect(page).toContain("JSON.stringify({ displayName: draftDisplayName.trim(), bio: draftBio.trim() })");
        expect(page).toContain('setActivityView("likes")');
        expect(page).toContain('setActivityView("following")');
        expect(page).toContain('setActivityView("followers")');
        expect(page).toContain("<CommunityActivityModal");
        // 分享入口是昵称行右侧的图标按钮（flex + gap，避开 antd 对 button margin 的重置）
        expect(page).toContain("flex shrink-0 items-center gap-2 pt-0.5");
        expect(page).toContain('aria-label={summary?.publicProfileAvailable ? "复制公开主页链接" : "主页尚未公开"}');
        expect(page).not.toContain("mt-6 !h-10 !min-w-48");
        expect(page).not.toContain("absolute left-full");
        // antd 的无分层 `a { background: transparent }` 会覆盖 Tailwind 的 bg-*，必须带 !
        expect(page).toContain("!bg-foreground");
    });

    it("shows the account id under the nickname", async () => {
        const actions = await readFile(resolve(process.cwd(), "src/components/layout/user-status-actions.tsx"), "utf8");

        expect(actions).toContain("ID：${user.accountId}");
        expect(actions).not.toContain("VOZEB 创作账户");
    });
});
