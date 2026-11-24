# AGENTS.md — 多助手协作约定

> 本仓库同时有 **2 个 AI 助手**在改造前端页面。开工前请先读本文件，遵循分区与提交纪律。
> 修改本文件 = 修改契约，需在提交信息里写 `chore(agents):` 并在下方「变更记录」留一行。

---

## 0. 开工前 60 秒检查（任何助手、每次任务）

```bash
git status --short          # 有哪些未提交改动，是谁的
git log --oneline -5        # 上一个提交在做什么
```

- 目标文件出现在 `git status` 里 → **视为对方正在用**，不要覆盖，先换文件或先问人
- 只 `git add <自己改的具体路径>`，**禁止** `git add -A` / `git add .` / `git commit -a`
- 一个逻辑改动立刻提交，不要让 diff 在工作区挂很久（挂越久越容易被对方误伤）

## 1. 参与者与分区

| 角色 | 负责域 | 独占目录 |
| --- | --- | --- |
| **OWNER-ME** | 个人主页 / 个人中心 | `src/app/(user)/me/`、`src/app/(user)/profile/`、`src/app/(user)/u/`、`src/components/profile/`、`src/lib/user-avatar.ts`、`public/profile-cover.*` |
| **OWNER-CANVAS** | 画布（Canvas） | 见下 |

**规则：只在自己独占目录里动代码。** 需要改对方独占目录 → 停手，写进 §5 交接日志，由人决定谁改。

### OWNER-CANVAS 独占范围

```
src/app/(user)/canvas/**              # 页面、[id] 详情、components/(81 文件)、stores/、utils/
src/lib/canvas-*.ts                   # canvas-theme / canvas-palette / canvas-project-* / canvas-image-decomposition
src/app/api/canvas/**                 # projects、image-decomposition
src/app/styles/global-canvas-*.css    # controls / overrides / responsive 三个分片
```

画布约 140 文件 / 1 万行，核心是 `canvas/components/canvas-surface.tsx`（1641 行）与 `canvas/[id]/use-canvas-generation-actions.tsx`（1221 行）。

**画布对外的只读依赖**（可读、不擅自改，要改走 §2 共享层流程）：
`services/api`（44 处）、`stores/use-theme-store`、`stores/use-config-store`、`lib/media-image-url`、`lib/image-utils`、`components/agent/`。

分给画布、但**其它域暂无人认领**的目录（`create/`、`drama/`、`works/`、`gallery/`、`community/`、`wallet/`、`billing/`、`help/`、`assets/`、`prompts/`）：需要改时按共享层流程走，改前在 §5 记一行。

## 2. 共享层（谁都能碰，但必须走流程）

以下文件被两个域的页面同时引用，改动会外溢：

| 共享层 | 被谁复用 | 注意 |
| --- | --- | --- |
| `src/components/layout/`（app-sidebar、mobile-nav-drawer、user-status-actions） | 全站 | 改行为会影响所有页 |
| `src/components/ui/` | 全站 | 改基础组件 = 改全站 |
| `src/app/globals.css`、`src/app/styles/global-*.css`（非 canvas 分片） | 全站 | 优先加新文件；`globals.css` 只允许「新增 @import 一行」 |
| `src/components/works/` | 作品广场 + `me` 页复用卡片 | **改卡片签名/结构会直接打断 me 页** |
| `src/components/agent/` | 画布 + 创作工作台共用 | 双方都可能动，改前必须记账 |
| `src/services/api/`、`src/stores/` | 全站 | 只加不改，改接口必同步所有调用方 |
| `src/lib/media-image-url`、`image-utils`、`utils` 等公共工具 | 全站 | 签名保持向后兼容 |

**共享层改动三步：**

1. 改之前，在 §5 交接日志写一行「我要改 X，原因 Y」
2. 改动保持**向后兼容**（加 prop 用可选、加字段不删旧字段）
3. **单独一个 commit**，不和页面改动混在一起 —— 方便对方 cherry-pick 或回滚

## 3. 提交纪律

- 沿用现有 conventional commit，scope 写域名，归属一眼可辨：`feat(canvas):` / `fix(me):` / `chore(agents):`
- 一次提交只装一件事；页面改动和共享层改动分开
- **禁止** `git commit --amend`、`git rebase`、`git reset --hard`、`git checkout -- <file>`、`git stash`、切换分支
  —— 这些操作会直接吞掉对方未提交的工作
- 需要撤销自己的改动：`git restore --source=HEAD -- <自己的文件>`，只针对自己

## 4. 撞车了怎么办

1. **先别 commit**，`git diff <冲突文件>` 看清双方改动
2. 双方都想改同一个文件 → 按分区归属，**非归属方退出**，把需求写进 §5
3. 已经互相覆盖（文件内容丢了）→ `git reflog` 找回自己那次提交，`git show <hash> -- <file>` 取回，不要 reset
4. 真的分不开（同一文件两侧都要改）→ 升级到物理隔离，见 §6

## 5. 交接日志（追加写，不要改别人的行）

格式：`- [HH:MM] <角色> <动作> <文件/目录> — <说明>`

- [12:53] OWNER-CANVAS 占用 `.workbuddy/`、`AGENTS.md` — 建立协作契约，不涉及业务代码
- [12:53] OWNER-ME 持有 7 个文件未提交（头像渐变调整），OWNER-CANVAS 不触碰
- [12:56] OWNER-ME 提交 `3846a2d` — `public/profile-cover.*`、`scripts/generate-profile-cover.mjs`：封面底色改中性石墨，只动自己域
- [12:56] OWNER-ME 补记历史改动：`108a33f` 里一并改了共享层 `components/layout/{app-sidebar,mobile-nav-drawer,user-status-actions}.tsx` 的头像渐变类名（纯 class 替换、无行为/接口变更），当时契约尚未建立；此后共享层改动会单独提交并在此记账

## 6. 端口与运行环境

- **3001**：主工作树的 dev server，OWNER-ME 的 Playwright 脚本写死了这个端口 —— 不要重启、不要杀进程
- OWNER-CANVAS 需要独立跑截图/验证时，用 `PORT=3002 pnpm dev` 另起一份（`next dev` 读 `process.env.PORT`；若 `.env.local` 里的 `PORT=3001` 覆盖了它，复制一份 `.env.canvas` 后 `node --env-file=.env.canvas ...` 起）
- **不要** 为了跑自己的验证去重启 3001，会打断对方的截图脚本

## 7. 升级方案：物理隔离（撞车频繁时启用）

当前是**单一工作树、单分支**，两个助手直接写同一份文件 —— 分区靠自觉，撞车靠沟通。若开始频繁互相踩：

```bash
# 给其中一方开独立 worktree + 独立分支（两者共享同一个 .git，能互相合并）
git worktree add ../vozeb-wt-canvas -b feat/canvas-local feat/3034-frontend-local-dev
```

配套：

- 各自 `node_modules`（pnpm store 硬链接，成本低）、各自 `.env.local`（gitignore，需手动复制）
- **端口分开**：主树 3001 保持不动（对方脚本指这里），新树用 `PORT=3002`
- 定期 `git merge` 对方分支收敛；合并时冲突就是真冲突，按 §4 处理
- 注意：同一分支不能同时检出到两个 worktree

## 变更记录

- 2026-11-24 12:53 初版，OWNER-PAGES 建立
- 2026-11-24 12:58 分区定稿：OWNER-PAGES → OWNER-CANVAS（画布域），补端口约定与画布只读依赖
- 2026-11-24 12:57 OWNER-ME 在 §5 追加两条记账（封面提交、历史共享层改动补记），未改分区与规则
