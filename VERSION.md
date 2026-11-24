# 版本说明（唯一权威版本）

本仓库是 **3034 开发环境的唯一版本基线**。

| 项 | 值 |
| --- | --- |
| tag | `v2026.11.17-canvas` |
| 分支 | `release/3034-canvas-20261117` |
| 远程 | `https://github.com/tcroos/rainmind-vozeb.git` |
| 日期 | 2026-11-17 |

commit hash 与提交总数不写死在本文件（否则每次改文档都会变，反而难认），用 tag 解析：

```bash
git rev-parse v2026.11.17-canvas^{}   # commit hash
git rev-list --count HEAD             # 提交总数
```

## 确认方式

```bash
git describe --tags --always   # 应输出 v2026.11.17-canvas
git status --porcelain          # 应为空
```

## 本版本包含什么

- **基线**：`77adc80` 3034 前后端合并版基线快照（服务器保留源码 + FEAT-020 集中合并）
- **画布视觉**：22px 圆角、菲涅尔描边、缩放组件对齐中央工具栏、移除节点鼠标光效、移除色盘前端入口
- **反馈入口**：侧边栏（API 下方）、画布顶栏（头像左侧）、官网页脚「平台」列，三处统一指向飞书表单
- **运维修复**：`run-app.mjs` 固化 `--max-old-space-size=4096`，修复 dev 模式堆内存耗尽导致的 exit 134

## 重要：与主仓库的关系

本仓库历史与主仓库 `D:/VOZEB-PRO`（`rainmind-vozeb` 的 main 线）**没有共同祖先**。

- 基线 commit `77adc80` 在主仓库中不存在
- 主仓库当前检出 `feat/libtv-a-canvas-visual @ abe07947`，两边互不可见
- 如果需要合并，必须使用 `git merge --allow-unrelated-histories`

**不要把本版本称作 `fbf1e157`** —— 那是 `feat/libtv-b-task` 的旧提交，与本仓库无关。

## 环境说明

`.env.local` 不在本仓库内（`.gitignore` 第 18 行 `.env.*` 排除），这是有意为之，不是文件丢失。

本地开发所需的关键配置：

- `DATABASE_URL` → 本地 PostgreSQL `127.0.0.1:5432/vozeb_pro`
- `VOZEB_PRO_ENCRYPTION_KEY` → 与上述数据库配套的那把，来源 `D:/VOZEB-PRO-wt-b/web/.env.local`（实测可解密库中 R2 凭据密文）
