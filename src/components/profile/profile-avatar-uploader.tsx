"use client";

import { App, Button } from "antd";
import { Camera } from "lucide-react";
import { useRef, useState } from "react";

import { userAvatarInitial } from "@/lib/user-avatar";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";

export function ProfileAvatarUploader({ onUpdated, variant = "row" }: { onUpdated?: (user: LocalUser) => void; variant?: "row" | "avatar" }) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const fallback = userAvatarInitial(user?.displayName || user?.username || "用户");

    const upload = async (file: File) => {
        if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) return message.warning("请选择 PNG、JPG 或 WebP 图片");
        if (file.size > 5 * 1024 * 1024) return message.warning("头像文件不能超过 5MB");
        setUploading(true);
        try {
            const body = new FormData();
            body.set("avatar", file);
            const response = await fetch("/api/auth/avatar", { method: "POST", body });
            const payload = (await response.json().catch(() => null)) as { code?: number; data?: { user?: LocalUser }; msg?: string } | null;
            if (!response.ok || payload?.code !== 0 || !payload.data?.user) throw new Error(payload?.msg || "头像更新失败");
            setUser(payload.data.user);
            onUpdated?.(payload.data.user);
            message.success("头像已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "头像更新失败");
        } finally {
            setUploading(false);
        }
    };

    const fileInput = (
        <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="选择头像图片"
            onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
            }}
        />
    );

    if (variant === "avatar") {
        return (
            <div className="group relative shrink-0">
                <span className="grid size-20 place-items-center overflow-hidden rounded-full bg-[linear-gradient(140deg,#8a94a3_0%,#3f4854_100%)] text-2xl font-semibold text-white ring-1 ring-black/5 dark:ring-white/15">
                    {user?.avatarUrl ? <img src={user.avatarUrl} alt="当前头像" className="size-full object-cover" /> : fallback}
                </span>
                {fileInput}
                {/* 悬停/聚焦时浮出遮罩；触屏设备没有 hover，用 @media(hover:none) 兜底常驻 */}
                <button
                    type="button"
                    className="absolute inset-0 grid place-items-center rounded-full bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed [@media(hover:none)]:opacity-100"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    aria-label="更换头像"
                >
                    <span className="flex items-center gap-1 text-[11px] font-medium !text-white">
                        <Camera className="size-3.5" />
                        {uploading ? "上传中" : "更换"}
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div className="flex min-w-0 items-center gap-3 border-b border-border pb-4 sm:gap-4">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(140deg,#8a94a3_0%,#3f4854_100%)] text-xl font-semibold text-white ring-1 ring-black/5 dark:ring-white/15">
                {user?.avatarUrl ? <img src={user.avatarUrl} alt="当前头像" className="size-full object-cover" /> : fallback}
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">个人头像</div>
                <div className="mt-1 text-xs text-muted-foreground">PNG、JPG 或 WebP，最大 5MB</div>
            </div>
            {fileInput}
            <Button className="shrink-0" icon={<Camera className="size-4" />} loading={uploading} onClick={() => inputRef.current?.click()}>
                更换头像
            </Button>
        </div>
    );
}
