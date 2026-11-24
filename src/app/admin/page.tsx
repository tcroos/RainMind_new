import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { parseAdminSection, resolveAdminSection } from "@/components/admin/admin-sections";
import { AdminReturnButton } from "@/components/admin/admin-return-button";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { getFreshAuthSettings, getPublicUserSummary } from "@/lib/auth/store";
import { requireAdminUser } from "@/lib/server/admin-page-access";
import { getAdminSetupSummary } from "@/lib/server/admin-setup-status";
import { serializeAdminSettingsForUser } from "@/lib/server/admin-channel-config";

type AdminPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
    const params = searchParams ? await searchParams : {};
    const requestedSection = parseAdminSection(params.section);
    // 鉴权、用户注入与后台外壳（main 容器）都在 src/app/admin/layout.tsx
    const currentUser = await requireAdminUser();
    const initialSection = resolveAdminSection(currentUser, requestedSection);
    if (!initialSection) redirect("/");

    const [settings, userSummary] = await Promise.all([getFreshAuthSettings(), getPublicUserSummary()]);
    const setup = await getAdminSetupSummary({ settings, userSummary });

    return (
        /* 控制台内部有相对定位的浮层，这里保留原先 <main> 上的定位上下文 */
        <div className="relative">
            <AdminDashboard
                initialUsers={[]}
                initialUserSummary={userSummary}
                initialSettings={serializeAdminSettingsForUser(settings, currentUser)}
                initialPromptCount={0}
                currentUser={currentUser}
                initialSection={initialSection}
                setupSummary={setup}
                headerActions={
                    <>
                        <AdminReturnButton />
                        <UserStatusActions initialUser={currentUser} />
                    </>
                }
            />
        </div>
    );
}
