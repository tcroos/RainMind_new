import { redirect } from "next/navigation";

/* 提示词已并入素材库：侧栏只留「素材库」一个入口，页面内用三段 tab 切换。
 * 这里保留路由做重定向，旧书签、外部链接以及代码里写死的 /my-prompts 都不会 404。 */
export default function Page() {
    redirect("/assets?tab=mine");
}
