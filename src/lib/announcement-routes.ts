/**
 * 这些页面是「进入站点的门」：访客还没进站，登录/注册/找回密码页上不该出现
 * 站点公告抽屉。以前只在营销页 `/` 做了拦截，登录前先到 `/register` 的用户
 * 会先在表单右侧被弹一次，登录进站后又按「登录后弹窗」弹第二次。
 */
const AUTH_PATHS = ["/login", "/register", "/forgot-password"] as const;

/**
 * 编辑类页面：画布是手不能停的地方，公告抽屉从右侧滑出来会盖住节点、还会抢走焦点，
 * 用户正在拖素材时被弹一次体验很差。消息中心入口（顶栏铃铛）不受影响，想看仍然能点开。
 */
const EDITOR_PATHS = ["/canvas"] as const;

export function isAnnouncementSuppressedPath(pathname: string | null | undefined) {
    if (!pathname) return false;
    if (pathname === "/") return true;
    if (EDITOR_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return true;
    return AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
