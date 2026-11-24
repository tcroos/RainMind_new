/* 对外链接常量（纯字符串，不依赖组件库）。
 * 单独成文件是为了让官网首页等轻量入口只引入字符串，
 * 不必因为一个链接把 navigation-tools 里的整套图标带进打包产物。 */

/* 用户反馈表单（飞书）：侧边栏、画布顶栏、官网顶部导航共用，换链接只改这一处 */
export const FEEDBACK_FORM_URL = "https://hcn5dyc2gmu4.feishu.cn/share/base/form/shrcnWX9mPBWvKNEw2UVUI69ETe";
