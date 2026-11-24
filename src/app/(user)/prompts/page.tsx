import { redirect } from "next/navigation";

/* 公共词库已并入素材库的「公共词库」tab（/assets?tab=public）。
 * 保留这个路由做重定向：旧书签、外部链接和其他页面写死的 /prompts 都不会 404。
 * 后端接口 /api/prompts 完全没动，只是前端外壳换了位置。 */
export default function Page() {
    redirect("/assets?tab=public");
}
