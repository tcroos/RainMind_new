# VOZEB PRO 前端 — 交接说明

> 更新：2026-11-27　｜　适用对象：接手本项目的开发者（含 AI 助手）

## 1. 项目是什么

VOZEB PRO 主应用：Next.js 16 App Router + React 19 + antd 6 + Tailwind 4 + zustand + @tanstack/react-query，pnpm 单仓。

- `src/app/(user)/` 用户端：create / canvas / drama / assets / gallery / community / me / profile / wallet / billing 等
- `src/app/admin/` 管理后台；`src/app/api/` 大量 Route Handler
- `src/lib/` 业务纯函数与契约（多带 `.test.ts`）；`src/lib/server/` 服务端实现
- `src/services/api/`、`src/stores/`、`src/components/` 按域组织
- 测试：vitest（与源码同目录）、playwright（e2e/ 与 scripts/*check.mjs）

## 2. 仓库与分支 —— 接手第一坑，务必看懂

远端：`https://github.com/tcroos/RainMind_new.git`（public，2026-11-27 首次推送）

> 注意：仓库最初叫 `RainMind_old`，GitHub 上已改名为 `RainMind_new`。旧地址会 301 跳转但仍可用；一律用上面的新地址，避免同事 clone 时收到迁移提示。

| 分支 | 远端指向 | 说明 |
| --- | --- | --- |
| `main` | `47ed916` | **默认分支 = 最新代码**，clone 后直接用这条 |
| `feat/3034-assets-redesign-1795521040` | `47ed916` | 与 main 内容相同，改造期工作分支 |
| `feat/3034-frontend-local-dev` | `a244bf1` | 改造前快照，落后 45 个 commit，只读参考 |

⚠️ **本地 `main` 分支 ≠ 远端 `main`**：本地 main 还停在旧基线 `65b62bb`，远端 main 是从当前工作分支推上去的 `47ed916`。**不要在本地 main 上开发，也不要 `git push --all`**（会把旧 main 覆盖远端）。开工前先 `git status --short` + `git branch -vv` 看清自己在哪。

`VERSION.md` 里写的 tag / remote（`tcroos/rainmind-vozeb`）是上游信息，**与本仓库不一致**，判断版本一律以 `git log` 为准。

## 3. 从零跑起来

### 3.1 依赖与代码

```bash
git clone https://github.com/tcroos/RainMind_new.git
cd RainMind_old
pnpm install
```

复制或补齐 `.env.local`（**不入库**）。关键项：`NEXT_PUBLIC_SITE_URL=http://localhost:3001`、`PORT=3001`、`DATABASE_URL`、`VOZEB_PRO_ENCRYPTION_KEY`（AES-256-GCM，64 位十六进制）、`VOZEB_PRO_DATA_DIR`、`VOZEB_PRO_INSTALL_TOKEN`（≥32 字符，首次 /install 用）。端口固定 3001（3000 被本机 Docker 占用）。

### 3.2 数据库

本地是**便携版 PostgreSQL，不是服务也不是容器**：

- bin：`F:/vozeb-dev-data/pgsql`，data：`F:/vozeb-dev-data/pgdata`，日志：`F:/vozeb-dev-data/pg.log`
- 检查：`psql -h 127.0.0.1 -p 5432 -U postgres -c "select 1"`
- 挂了：先把失效的 `pgdata/postmaster.pid` **改名备份**（别直接删），再用前台 `postgres.exe -D F:/vozeb-dev-data/pgdata -p 5432` 挂后台常驻。`pg_ctl start` 经工具调用启动会被回收，是假启动。

### 3.3 前端

```bash
pnpm dev        # 端口 3001，Turbopack
```

- 首次启动若报 `Another next dev server is already running`，说明已有实例，先查端口不要重复起。
- 看到 `/install` 安装向导卡在「步骤 2/3 配置并初始化数据库」→ **先查 5432**，不是安装流程的 bug；向导 Host 写 `localhost` 而 PG 只监听 IPv4 时改成 `127.0.0.1`。
- 生产：`pnpm build`（先严格 tsc 再 next build）→ `pnpm start:standalone`。

## 4. 最近这轮改了什么

- **全站视觉**：创作页纯平深色背景、鼠标邻近点阵；全站去线条/描边，改浅底 + 留白 + 极淡投影。
- **导航与侧栏**：Lovart 风格加宽平铺侧栏，顶部「新建项目」、下方「最近项目」；左下账号 + 积分弹窗（账户管理入口）；删掉「主页/钱包」侧栏入口（页面仍在）。
- **页面合并**：`/works` → 重定向到 `/me?tab=works`；`/prompts`、`/my-prompts` → 重定向到 `/assets?tab=...`。素材/提示词/公共词库统一为 `/assets` 三 tab，tab 切换用 `history.pushState` 避免闪动。
- **提示词**：删分类筛选与分类字段，补编辑入口（PATCH），卡片去冗余信息。
- **短剧 / 广场 / 画布**：去线条硬框、统一品牌橙；画布支持框选打组/解组、缩放手柄降敏、组名跟随缩放。
- **视频计费**：`src/constant/credits.tsx` 中 `generationParameterMultiplier` 对 `videoBilling.mode === "fixed"` 直接返回 1，固定按次收费不再受全局清晰度/秒数倍率影响；实际每次收多少分由 admin「模型基础扣费」决定。

## 5. 还没做完 / 需要你决定的

1. **浏览器视觉验收未做**：按协作约定 agent 不得自起 dev server，侧栏、素材库、短剧、画布的浅/深/移动截图都由人拉起服务后复验。服务已由用户在自己终端启动过，若已能用可直接看。
2. **视频固定计费需在 admin 配置**：给视频模型开「固定按次」+ 填基础分（`/admin` → 积分/配额）。代码层已锁死倍率，但配置本身没代填。
3. **本地两个未提交文件**：`next-env.d.ts`、`tsconfig.json` 是他人改动，接手后看清(`git diff`)再决定处理，别误提交。
4. **远端 main 与本地 main 分叉**：见 §2，这是最容易被新同事踩到的坑。

## 6. 日常开发约定

仓库根目录有 `AGENTS.md`，是三人协作契约（若继续多人/多 AI 协作必读）：

- 开工前 `git status --short` + `git log --oneline -5`；目标文件已 modified 视为他人在用
- 只 `git add <自己的具体路径>`；禁止 `git add -A` / `git commit -a`
- 禁止 amend / rebase / reset --hard / checkout -- / stash / 切分支
- 按分区独占：SHELL（布局/导航/全局样式）、PAGES（具体页面）、CANVAS（画布域）；跨域工具只加不改、单独 commit、在 AGENTS.md §8 记账
- agent 不得自起 dev server；服务挂了由人在终端拉起唯一实例

## 7. 排障速查

| 症状 | 先查什么 |
|---|---|
| `Cannot find module 'antd'` / `@ant-design/nextjs-registry`，伴随 CSS 解析错 | `.next-dev` Turbopack 缓存损坏，不是依赖缺失。停实例 → 把 `.next-dev` 改名备份 → 重建 → 重启；别先重装依赖、别改业务代码 |
| 全站 307 跳 `/install` | 5432 PostgreSQL 不通，先查数据库 |
| dev 反复重启且变慢 | `scripts/run-app.mjs` 的内存阈值自愈，或 webpack 未切 Turbopack；已修，回退开关 `NEXT_DEV_BUNDLER=webpack pnpm dev` |
| tab 切换闪一下 | `/assets` 用 `history.pushState` 同步 query，别改回 Next Link 导航 |
| 画布出现双滚动条 / 四周留白 | shell 改了内容容器，违反「全幅、高度 100%、外层不滚动」约定 |

## 8. 常用命令

```bash
pnpm dev                 # 开发，3001
pnpm typecheck           # 全项目严格 tsc
pnpm test                # vitest
pnpm lint                # eslint
pnpm build               # 生产构建
pnpm worker:generation   # 生成任务 worker（dev server 会自动拉起）
pnpm backup:disaster     # 灾难备份
```
