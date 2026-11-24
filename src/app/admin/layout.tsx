import type { ReactNode } from "react";

import { AuthUserHydrator } from "@/components/auth/auth-user-hydrator";
import { requireAdminUser } from "@/lib/server/admin-page-access";

/*
 * admin 后台的外壳。拆分前 /admin、/admin/billing、/admin/setup 各自抄了一遍
 * 「鉴权 + 15 字段用户注入 + <main class="admin-console-page">」，约 130 行重复，
 * 而且三份的灰阶已经分裂（zinc / stone）。收进布局后页面只留自己的内容。
 *
 * 刻意不放在这里的东西：
 *  · 顶栏 —— 三页的结构本来就不同（控制台是侧栏 + 内嵌 header，
 *    另外两页是「返回 + 标题 + 账号区」的独立 header），硬统一会改变现有视觉；
 *  · 分区/权限判定 —— 依赖各自页面的 searchParams（?section / ?tab），布局拿不到。
 *
 * 这里也不加 relative：控制台页原本是 <main class="relative">，
 * 若在布局统一加上，会让另外两页凭空多出一个定位上下文。控制台页自己在内容外包一层 relative。
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
    const currentUser = await requireAdminUser();

    return (
        <AuthUserHydrator
            user={{
                id: currentUser.id,
                accountId: currentUser.accountId,
                username: currentUser.username,
                email: currentUser.email,
                displayName: currentUser.displayName,
                bio: currentUser.bio,
                role: currentUser.role,
                adminPermissions: currentUser.adminPermissions,
                status: currentUser.status,
                planId: currentUser.planId,
                planName: currentUser.planName,
                hasActivePlan: currentUser.hasActivePlan,
                pointsBalance: currentUser.pointsBalance,
                mfaEnabled: currentUser.mfaEnabled,
            }}
        >
            <main className="admin-console-page app-scroll-page bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">{children}</main>
        </AuthUserHydrator>
    );
}
