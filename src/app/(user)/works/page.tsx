import { redirect } from "next/navigation";

type WorksPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/* 作品管理已并入个人主页的「作品管理」tab（见 me/page.tsx）。
 * 这里保留路由做永久重定向：旧书签、外部链接、以及从画布/素材/短剧发起的
 * 「发布作品」跳转（带 sourceType/sourceId）都还能落到正确位置 ——
 * 原样透传 query，深链打开发布编辑器的行为不变。 */
export default async function WorksPage({ searchParams }: WorksPageProps) {
    const params = (await searchParams) ?? {};
    const query = new URLSearchParams({ tab: "works" });
    for (const [key, value] of Object.entries(params)) {
        if (key === "tab" || value === undefined) continue;
        const first = Array.isArray(value) ? value[0] : value;
        if (typeof first === "string" && first) query.set(key, first);
    }
    redirect(`/me?${query.toString()}`);
}
