# AGENTS.md — 三助手协作约定

> 本仓库同时有 **3 个 AI 助手**在改造前端。开工前请先读本文件，按分区干活。
> 修改本文件 = 修改契约，提交信息用 `chore(agents):`，并在末尾「变更记录」留一行。

---

## 0. 开工前 60 秒检查（任何助手、每次任务）

```bash
git status --short          # 有哪些未提交改动，是谁的
git log --oneline -5        # 前面的人在做什么
```

- 目标文件出现在 `git status` 里 → **视为别人正在用**，换文件或写进 §8 交接日志再等人裁决
- 只 `git add <自己改的具体路径>`，**禁止** `git add -A` / `git add .` / `git commit -a`
- 一个逻辑改动立刻提交，别让 diff 在工作区挂太久（挂越久越容易被误伤）
- **改本文件前必须 `git pull` 式地先看最新版**（`git log -1 -- AGENTS.md` + 通读当前内容），**只做局部编辑或追加，禁止整文件重写** —— 已发生过一次覆盖事故，见 §8 13:01

## 1. 三方分区

| 角色 | 负责 | 独占范围 |
| --- | --- | --- |
| **OWNER-SHELL** | 全站布局、导航、共享 UI、全局样式、**页面合并调整** | `src/app/layout.tsx`、`src/app/(user)/layout.tsx`、`src/components/layout/`、`src/components/ui/`、`src/app/globals.css`、`src/app/styles/global-*.css`（`global-canvas-*` 除外）、路由结构与页面搬迁 |
| **OWNER-PAGES** | 具体页面改造 | `(user)/me/`、`profile/`、`u/`、`works/`、`gallery/`、`community/`、`create/`、`drama/`、`wallet/`、`billing/`、`help/`、`assets/`、`prompts/`、`my-prompts/`、`src/components/profile/`、`src/components/works/`、`src/lib/user-avatar.ts`、`public/profile-cover.*` |
| **OWNER-CANVAS** | 画布 | `(user)/canvas/**`、`src/lib/canvas-*.ts`、`src/app/api/canvas/**`、`src/app/styles/global-canvas-*.css` |

**一句话规则：** 自己的独占目录随便改；别人的独占目录**只读**；需要别人改 → 写 §8，由人转达。

### OWNER-CANVAS 独占范围细节

```
src/app/(user)/canvas/**              # 页面、[id] 详情、components/(81 文件)、stores/、utils/
src/lib/canvas-*.ts                   # canvas-theme / canvas-palette / canvas-project-* / canvas-image-decomposition
src/app/api/canvas/**                 # projects、image-decomposition
src/app/styles/global-canvas-*.css    # controls / overrides / responsive 三个分片
```

约 140 文件 / 1 万行，核心 `canvas/components/canvas-surface.tsx`（1641 行）、`canvas/[id]/use-canvas-generation-actions.tsx`（1221 行）。

**画布对外只读依赖**：`services/api`（44 处）、`stores/use-theme-store`、`stores/use-config-store`、`lib/media-image-url`、`lib/image-utils`、`components/agent/`。

### 共管文件（两个助手都用）

| 文件 | 共管方 | 规则 |
| --- | --- | --- |
| `src/components/agent/` | OWNER-CANVAS + OWNER-PAGES | 先记账再改；加 prop 用可选、不删旧字段；改完在 §8 留一行 |

## 2. 骨架 ↔ 页面 的接口约定（OWNER-SHELL 必须遵守）

这是三方协作里最容易出事的地方，写死：

- **shell 只管外壳**：导航、侧边栏、顶栏、外层 padding、max-width、滚动容器。页面内容区内部结构归各页面负责人。
- **内容容器必须「高度确定 + 可 100% 撑满 + 不重复滚动」**，不得在页面外层套固定高度或 `overflow: auto`。
- **画布的硬性要求**：内容区必须**全幅（无左右 padding）、高度 100%、外层不滚动**，缩放和平移由画布自己管。若 shell 改动导致画布出现双滚动条、视口塌陷或四周留白，属**破坏性改动**，改前必须协商。
- shell 改导航分组 / 路由路径 → 必须同步更新所有受影响链接，并在 §8 通知两个页面负责人。

## 3. 页面合并 / 搬迁的冻结协议（OWNER-SHELL 执行）

「页面合并调整」必然要移动别人正在改的文件，必须走冻结：

1. 先在 §8 写冻结公告：`[HH:MM] OWNER-SHELL 冻结 <文件或目录> — 计划合并为 <目标>`
2. 冻结期内该文件的原负责人**不得改动**；有需求先写进 §8，等解冻
3. 搬迁单独一个 commit：`refactor(shell): 合并 X → Y（仅搬迁，无逻辑改动）`
4. 紧接着一个 commit 修引用（import、路由、redirect）
5. 完成后在 §8 写 `解除冻结`；两个 commit 之间**不要夹业务逻辑改动**

## 4. 共享层现状

原先的「共享层」已按所有权拆开：

- `components/layout/`、`components/ui/`、`globals.css`、`styles/global-*.css` → **有主了，归 OWNER-SHELL**，另两人只读
- `components/works/`、`components/profile/` → 归 OWNER-PAGES
- `components/agent/` → 共管，见 §1
- `services/api/`、`stores/`、`lib/media-*`、`lib/utils` 等跨域工具 → **无人独占**，谁改谁负责，要求：只加不改、向后兼容、单独 commit、在 §8 记账

## 5. 提交纪律

- scope 前缀标归属，三方交替提交时一眼可辨：`feat(canvas):` / `feat(page):` / `refactor(shell):` / `chore(agents):`
- 一次提交只装一件事；页面改动与共享层改动分开
- **禁止** `git commit --amend`、`git rebase`、`git reset --hard`、`git checkout -- <file>`、`git stash`、切换分支 —— 这些会直接吞掉别人未提交的工作
- 撤销自己的改动：`git restore --source=HEAD -- <自己的文件>`，只针对自己
- `pnpm typecheck` 是全项目严格 tsc，**别人没写完时也会报错** —— 只把自己文件的错误当阻塞项

## 6. 撞车了怎么办

1. **先别 commit**，`git diff <文件>` 看清双方改动
2. 双方都要改同一文件 → 按分区归属，**非归属方退出**，需求写进 §8
3. 已经互相覆盖（内容丢了）→ `git reflog` 找回自己那次提交，`git show <hash> -- <file>` 取回，**不要 reset**
4. 实在分不开 → 升级到物理隔离，见 §9

## 7. 端口与运行环境

- **3001**：主工作树共用的 dev server，**谁都不要重启或杀进程**（有人的 Playwright 脚本写死了它）
- 需要独立跑验证：CANVAS 用 `PORT=3002`、PAGES 用 `PORT=3003`、SHELL 用 `PORT=3004`；同时最多开 2 个
- **注意**：`layout.tsx` / `globals.css` 一旦语法错误，会拖垮 3001 上所有人的页面。shell 改动请小步保存，出错立刻修
- 不要删 `.next-dev/`、`.tsconfig.tsbuildinfo`、`.tmp/` —— 可能有人正在用

## 8. 交接日志（追加写，不要改别人的行）

格式：`- [HH:MM] <角色> <动作> <文件/目录> — <说明>`

- [12:53] OWNER-CANVAS 占用 `.workbuddy/`、`AGENTS.md` — 建立协作契约
- [12:53] OWNER-ME 持有 7 个文件未提交（头像渐变），OWNER-CANVAS 不触碰
- [12:56] OWNER-ME 提交 `3846a2d` — `public/profile-cover.*`、`scripts/generate-profile-cover.mjs`：封面底色改中性石墨，只动自己域
- [12:56] OWNER-ME 补记历史改动：`108a33f` 里一并改了共享层 `components/layout/{app-sidebar,mobile-nav-drawer,user-status-actions}.tsx` 的头像渐变类名（纯 class 替换、无行为/接口变更），当时契约尚未建立；此后共享层改动会单独提交并在此记账
- [12:58] 分区定稿：OWNER-PAGES → OWNER-CANVAS（画布域）
- [13:00] 契约升级为三方版：新增 OWNER-SHELL（全站骨架 + 页面合并），`components/layout`、`components/ui`、`globals.css` 从「共享层」改为 OWNER-SHELL 独占
- [13:00] 历史说明：`108a33f`（头像配色）曾修改 `components/layout/` 三个文件，属两方制时期的改动，**不回滚**；此后 layout 归 OWNER-SHELL
- [13:01] OWNER-CANVAS 重写 AGENTS.md 时**覆盖**了 OWNER-ME 的 12:56 两条记账，已在 3009a80 之后恢复 —— 教训：本文件只能局部编辑/追加，禁止整文件覆盖
- [13:18] OWNER-SHELL 就位，接掌 shell 域：`src/app/layout.tsx`、`src/app/(user)/layout.tsx`、`src/components/layout/`、`src/components/ui/`、`src/app/globals.css`、`src/app/styles/global-*.css`（`global-canvas-*` 除外）。验证端口按 §7 用 3004。开工检查见工作区仍有 PAGES 的 2 个未提交文件（`public/profile-cover.webp`、`(user)/me/page.tsx`），SHELL 不触碰

## 9. 升级方案：物理隔离（撞车频繁时启用）

现在是**单一工作树、单分支**，三人共写一份文件 —— 分区靠自觉。若开始频繁互相踩：

```bash
git worktree add ../vozeb-wt-canvas -b feat/canvas-local feat/3034-frontend-local-dev
```

- 各自 `node_modules`（pnpm store 硬链接，成本低）、各自 `.env.local`（gitignore，需手动复制）
- 端口分开：主树 3001 不动，新树 3002 / 3003
- 定期 `git merge` 收敛；合并冲突按 §6 处理
- 同一分支不能同时检出到两个 worktree

## 变更记录

- 2026-11-24 12:53 初版，双助手（ME / PAGES）
- 2026-11-24 12:58 分区定稿：OWNER-PAGES → OWNER-CANVAS
- 2026-11-24 12:57 OWNER-ME 在 §5 追加两条记账（封面提交、历史共享层改动补记），未改分区与规则
- 2026-11-24 13:00 三方版：新增 OWNER-SHELL；补骨架接口约定、搬迁冻结协议、端口分配
- 2026-11-24 13:01 恢复被覆盖的 OWNER-ME 记账；新增「本文件只追加、不整文件重写」硬规则
- 2026-11-24 13:18 OWNER-SHELL 就位并在 §8 留一行；分区与规则未改
