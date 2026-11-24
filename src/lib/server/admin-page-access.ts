import { cache } from "react";
import { redirect } from "next/navigation";

import { getAuthenticatedPageAccess } from "@/lib/server/page-access";

/*
 * admin 后台的统一入口鉴权。布局与页面共用同一个实例：
 * React 的 cache() 会把同一请求内的调用合并成一次，所以 layout 判过之后，
 * 页面里再调一次不会多读一次会话/库 —— 这也是不做成「每页各写一遍」的原因。
 *
 * 三处行为与拆分前保持一致：
 *  · 没登录 → 库未就绪或还没有首个管理员就跳 /install，否则跳登录；
 *  · 非 admin → 回首页；
 *  · 三页原先各带 next=/admin/xxx 的深链回跳，收进布局后统一用 /admin
 *    （布局拿不到当前 pathname，除非让 proxy 注入头部；为这个改安全相关代码不划算）。
 */
export const requireAdminUser = cache(async () => {
    const access = await getAuthenticatedPageAccess();
    if (!access.user) {
        if (!access.install.database.healthy || access.install.firstAdminRequired) redirect("/install");
        redirect("/login?next=/admin");
    }
    if (access.user.role !== "admin") redirect("/");
    return access.user;
});
