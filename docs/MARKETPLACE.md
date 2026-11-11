# 技能市场开发者文档（v8.9.1）

> **本文同步发布在官网**：<https://justin-sky.github.io/ai-art-engine/developers.html>（源码 `website/developers.html` / `website/developers.en.html`，中英双语静态页，无构建转换步骤；修改客户端契约时请同步更新）。

面向**往技能市场发布工作流/技能包或接入 Claude Code 技能**的开发者：市场里有什么、内容如何被校验与分发、桌面端拿到后会执行哪些安全门禁与物化动作。作者侧逐字段写作规范见内容仓库 `CONTRIBUTING.md`，本文聚焦**桌面客户端契约、Claude Code `SKILL.md` 规范支持与 MCP 技能工具链**。

> **核心客户端实现路径**：
>
> - `src/shared/claudeSkill.ts`（Claude Code `SKILL.md` 规范与 frontmatter 解析）
> - `src/main/services/claudeSkillRuntime.ts`（参数展开、`` !`cmd` `` 预处理、hooks / `fork` 子代理 / `allowed-tools` 治理与内置节点能力桥）
> - `src/main/services/githubSkillInstaller.ts`（任意 GitHub 仓库/子目录/`SKILL.md` 联网检索、预检与直装）
> - `src/shared/graph/nodeCapabilities.ts`（画布节点原生能力 `NodeCapabilityDef` 目录）
> - `src/shared/skillMarket.ts`（市场索引与工作流包契约校验）
> - `src/main/services/marketPipeline.ts`（主镜像源回退下载、磁盘缓存、staging → rename 原子安装）
> - `src/main/services/skillMarketService.ts`（官方市场目录拉取、节点类型兼容性拦截、安装记账与卸载）
> - `src/main/services/mcpServerService.ts`（6 个 MCP 技能与模板工具：`skill_list`、`skill_search`、`skill_inspect_github`、`skill_install`、`skill_uninstall`、`workflow_use_installed`）
> - `src/renderer/src/views/MarketplaceView.vue`（独立技能市场窗口界面）

---

## 1. 市场里有什么

技能市场是一个**独立窗口**（顶栏「技能市场」按钮打开，紧挨「设置」左侧），分为三个页签：

| 页签     | 内容                                                                                                                                                                 | 托管位置                                                                    |
| :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| **全部** | MCP 服务与全部技能混排展示，支持关键词过滤与顶部 GitHub 技能直装栏                                                                                                   | —                                                                           |
| **MCP**  | 内置 `aiartengine` 主服务（93 工具）、Blender 实时建模桥 `/mcp/blender`（9 工具），以及用户添加的第三方 MCP 服务（`http` / `stdio`）                                 | 应用内建 + 用户本机配置                                                     |
| **技能** | **官方/社区市场技能**（可附带 `workflow.json` 画布模板）、**GitHub 直装技能**、**工程级技能**（`<workspace>/.claude/skills` · `.agents/skills`）、**个人自定义技能** | `ai-art-engine-skills` 仓库 + GitHub 任意仓库 + 工作区 + `$DSH_HOME/skills` |

为什么只有三个页签、且不再将内置节点写成独立 `.md` 技能文件？

- **画布节点能力已内聚为 `NodeCapabilityDef`**：节点的默认系统提示词、用法与端口输入绑定统一声明在节点自身定义（`src/shared/graph/nodeCapabilities.ts`），由 MCP `graph_node_types` 与运行时自省引擎直接向 Agent 暴露，不再平铺污染 `$DSH_HOME/skills/`。
- **工作流模板与技能包合流管理**：远端市场仓库里的条目本质上是「给 Agent 阅读的领域操作手册（`SKILL.md`）+ 可选的一键画布种子拓扑（`workflow.json`）」。安装后既可在画布「一键工作流」或 MCP `workflow_use_installed` 中复现拓扑，也会把技能落盘到 `$DSH_HOME/skills/<skill.name>/`，在「技能」页签一张卡片统一管理。

### 内容仓库（双源逐字节镜像）

- **主源（GitHub）**：`https://github.com/Justin-sky/ai-art-engine-skills`（raw 路径 `/main`）
- **国内镜像（Gitee）**：`https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine-skills`（raw 路径 `/main`）

两个仓库的内容**必须逐字节一致**，避免出现「同一版本号在不同网络源下装出不同内容」的隐蔽故障。

---

## 2. 交付链路与工作流/技能解耦架构

```text
贡献者提交 workflows/<id>/{workflow.json, cover.png, skill/**} 至 ai-art-engine-skills
   ↓  CI 门禁校验（node scripts/validate.mjs + 单测）
   ↓  node scripts/build-index.mjs 从磁盘自动派生 index.json（含技能文件清单与代码摘要）
客户端 skillMarketService.ts 拉取 index.json（优先 GitHub 主源，超时无缝降级 Gitee 镜像）
   ↓  用户在技能市场点「安装」或 Agent 调用 MCP skill_install({ marketId })
marketPipeline.ts 下载 workflow.json + cover.png（+ 技能文件清单）至 staging 临时目录
   ↓  校验 SKILL.md frontmatter 与节点兼容性后原子 rename 落盘
<userData>/workflows/<id>/            画布工作流模板本体 + installed.json 记账
   ↓  同一次原子事务内
$DSH_HOME/skills/<skill.name>/        技能包（wf-<id>）落盘
   ↓
Agent 当轮直接拿到 instructions（或下轮扫描注入 <available_skills>）+ workflow_use_installed 装载画布
```

### 2.0 桌面内核轻量化：内置种子预设 vs 独立技能仓库

在 `v8.9.1` 架构中，应用彻底移除了早期硬编码在客户端里的十余条行业预设大表与旧同步脚本，确立了清晰的职责边界：

1. **桌面端内置仅保留双节点视频拆解复刻种子（`builtin.video-breakdown-remake`）**：
   - 定义于 `src/renderer/src/features/aiWorkflow/presets.ts`（`semantic.analyze` → `semantic.rebuild` 两节点直连拓扑），保证离线开箱即可运行核心视频逆向取证与复刻管线（另有免 Key 交互样板间位于 `src/shared/chatShowcaseStarters.ts`）。
2. **官方与社区行业工作流/技能包全部独立托管于 `ai-art-engine-skills`**：
   - 所有行业模板（如漫剧短片、古画一镜入画 `ancient-scroll-revive`、鬼畜调音 `guichu-remix`、游戏资产管线等）均以独立版本包形态维护在 `ai-art-engine-skills` 仓库中，无需发版升级桌面安装包即可随时迭代上新。
   - **创作与导出闭环**：开发者在画布搭好工作流后，右键选择 **「导出为市场工作流」**，填好元数据与封面即可生成干净的 `workflows/<id>/{workflow.json, cover.png}`（自动剥离运行时临时回写字段与未声明参数）；随后在 `ai-art-engine-skills` 仓库执行 `node scripts/build-index.mjs && node scripts/validate.mjs` 即可提交发布。
3. **MCP 全生命周期工具链直通**：
   - Agent 在对话中可通过 `skill_list`、`skill_search`、`skill_inspect_github`、`skill_install`、`skill_uninstall` 全自动检索与装卸技能，并通过 `workflow_use_installed` 的三种模式灵活消费模板：
     - `mode: "seed"`（默认）：一键将种子节点与完整连线落入当前画布并自动排版；
     - `mode: "merge"`：多技能跨界混搭——保留当前画布已有节点，自动为新节点加前缀消歧并汇聚连入同一个 `output.timeline`；
     - `mode: "blueprint"`：纯只读返回 `plan` 拓扑与 `SKILL.md` 正文，供 Agent 用 `graph_edit` 自由裁剪重组。

### 2.1 `index.json` 的派生字段必须由脚本生成，严禁手改

`ai-art-engine-skills` 仓库 `index.json` 中的以下字段全部由 `scripts/build-index.mjs` 从磁盘自动计算派生：

- `requires.nodeTypes`（由 `plan.nodes[].typeId` 去重排序派生）与 `requires.appMinVersion`
- `nodeCount` / `edgeCount` / `sizeBytes`
- `hasExecutableCode` 与 `script.run` 节点摘要（节点 key、能力白名单、字符数、FNV-1a 短哈希）
- **`skill`**：技能包名称、描述、`hasScripts` 标记、**逐文件相对路径与字节数清单**、整包体积

> **为什么文件清单必须服务端脚本派生？** GitHub / Gitee 的 `raw` 静态源没有目录列表 API，客户端必须预先拿到精确的文件路径列表才能逐个拉取；由 `build-index.mjs` 从磁盘派生并在 CI 用 `--check` 强校验，可以从根源上消灭「手写清单与实际磁盘文件漂移」故障。

### 2.2 附带画布模板的市场技能包强制使用 `wf-` 前缀

市场技能包与用户从 GitHub 直装的通用 Claude Code 技能共享同一个落地根目录 `$DSH_HOME/skills/<name>`。因此，`ai-art-engine-skills` 仓库中随工作流分发的技能包强制要求 `SKILL.md` frontmatter 的 `name` 为 **`wf-<id>`**，从源头杜绝与通用技能命名冲突。

### 2.3 技能包目录布局与体积硬顶

```text
workflows/<id>/skill/
  SKILL.md          必需。frontmatter: name(wf-<id>) / description / workflow: <id>
  references/       可选。端口与参数速查、领域长契约、提示词配方
  scripts/          可选。需经 §4 用户明示同意流方可落盘
  assets/           可选。静态模板资源
  examples/         可选（GitHub 直装 Claude Code 技能同样支持）
  templates/        可选（GitHub 直装 Claude Code 技能同样支持）
```

- 严禁符号链接与越界相对路径；仅允许上述白名单子目录。
- 单文件 `≤ 128 KB`，整包总计 `≤ 512 KB`，文件总数 `≤ 40`（保障逐文件 HTTP 拉取稳定快速）。
- `description` `≤ 500` 字符：**它是 Agent 在决定是否加载该技能前唯一能看到的摘要**，请聚焦描述「何时应当触发加载本技能」。

### 2.4 技能正文引用的节点命名空间与 `typeId` 真实性校验

仓库校验器（`validate.mjs`）会扫描 `SKILL.md` 及 `references/*.md` 中所有**反引号包裹的 `x.y` 代码记号**：只要前缀 `x` 属于已知节点命名空间，该记号就必须是当前引擎真实注册的 `typeId`（或本工作流 `plan` 已声明的节点类型）。

`v8.9.1` 覆盖的节点命名空间体系包括：

- **影视漫剧与叙事**：`film.*`（如 `film.workbench`、`film.breakdown`、`film.review`、`film.cast`、`film.shot`、`film.render`）、`novel.*`（`novel.outline`）、`comic.*`（`comic.page`）
- **游戏工业与数值沙盘**：`game.*`（`game.economy`、`game.numerical`、`game.pbrTile`、`game.spriteProp`、`game.vfxAlpha`、`game.audioDsp`、`game.levelMap`）、`gameplay.*` / `play.*`
- **游戏 UI 拆层与图集拼装**：`ui.*`（`ui.split`、`ui.gen`、`ui.componentLib`、`ui.atlasCompose`）
- **视频取证复刻与可执行脚本**：`semantic.*`（`semantic.analyze`、`semantic.rebuild`、`semantic.compile`）、`script.*`（`script.run`）
- **2D 骨骼舞台、3D 导演台、模型加工与空间世界**：`stage.*`（`stage.2d`）、`director.*`（`director.stage`）、`model.*` / `model3d.*`（`model.rigSkin`、`model.pose`、`model.animation`、`model.retarget`、`model.segment`、`model.meshComplete`、`model.retopology`、`model.rigCheck`、`model.texture`、`model.convert`）、`spatialWorld.*`（`spatialWorld.export`）、`world.*`
- **多模态资产、图像精修、动效与成片输出**：`asset.*`、`image.*`（含 `image.layerSplit`、`image.portrait`、`image.lighting`、`image.multiAngle`、`image.emotion`、`image.process`、`image.iconPack` 等）、`video.*`、`voice.*`、`text.*`、`note.*`、`anim.*`、`svg.*`、`frame.*`、`media.*`、`graph.*`、`prompt.*`、`decisions.*`、`output.*`（`output.timeline`、`output.director` 等）

> **防呆价值**：已下线的历史前缀（如 `beat.*`、`episode.*`、`world.*` 旧节点）仍保留在校验器的拦截集合内——一旦技能文档残留旧版或拼错的 `typeId`（例如编造出 `asset.pic`），Agent 照着调 `graph_edit` 会失败或建出残图，因此必须在校验阶段机械拦截。书写节点参数名时请单独包裹（如 `` `generateAspectRatio` ``），切勿写成 `` `image.generateAspectRatio` ``。

### 2.5 Claude Code `SKILL.md` 规范完整兼容与 GitHub 直装

除了官方 `ai-art-engine-skills` 市场外，客户端原生支持标准 **Claude Code Skill (`SKILL.md`)** 生态：

1. **GitHub 任意地址直装（`src/main/services/githubSkillInstaller.ts`）**：支持在技能市场顶部输入栏或通过 MCP `skill_install({ url })` 传入 `owner/repo`、仓库根 URL、`/tree/<branch>/<subpath>` 子目录或 `/blob/.../SKILL.md` 直链；落盘时写入 `.source.json` 记录源仓库、分支与 commit SHA，支持卡片上一键检查更新与卸载。
2. **多级技能发现优先级**：工程级（`<workspace>/.claude/skills/<name>/SKILL.md` · `<workspace>/.agents/skills/<name>/SKILL.md`）高于全局级（`$DSH_HOME/skills/<name>/SKILL.md`）。
3. **Frontmatter 全字段治理（`src/shared/claudeSkill.ts`）**：完整支持 `name`、`description`、`argument-hint`、`when_to_use`、`disable-model-invocation`、`user-invocable`、`allowed-tools`（含 `Bash(git *)` 等通配模式）、`model`、`context: inline | fork`、`agent`、`hooks`（`PreToolUse` / `PostToolUse` / `Stop`）、`version`、`license`、`author`、`workflow`。
4. **变量替换与动态预处理（`src/main/services/claudeSkillRuntime.ts`）**：支持 `$ARGUMENTS`、`$ARGUMENTS[n]`、`$0`..`$9`、`${CLAUDE_SKILL_DIR}`、`${CLAUDE_SESSION_ID}`、`${WORKSPACE_ROOT}`，以及正文中 `` !`command` `` 的工作区受控预处理替换。

---

## 3. 客户端安装与卸载契约

- **原子性与同生共死**：`marketPipeline.ts` 先拉取全量文件至临时 staging 目录并通过 `validateSkillEntryText` 校验 `SKILL.md` 合法性（防止 `dsh` 对非法 frontmatter 静默忽略导致「装上了却看不见」），全部通过后原子 rename 入位；任一环节失败立即回滚清理，绝不留半成品。
- **精准记账卸载**：卸载市场工作流时仅按 `installed.json` 记录的精确 `skillName`（`wf-<id>`）移除对应技能目录，绝不按前缀批量误删用户自建技能。
- **分源独立缓存与离线兜底**：打开技能市场窗口即触发目录刷新；网络异常时保留本地上次成功缓存并给出轻提示，主源与镜像缓存按源隔离落盘。

---

## 4. 技能随包脚本（`scripts/`）与一次性授权流

技能包中的 `scripts/` 属于 Agent 可在用户机器上调用的本地脚本，**默认一律跳过不落盘**：

1. **安装期逐次明示同意**：无论是界面点击安装（弹出逐文件确认框）还是 MCP `skill_install`（默认 `allowScripts: false`，必须先经 `ask_user` 征得用户同意后再传 `allowScripts: true`），主进程仅认严格字面量布尔值 `true`，且每次重装/更新均重新询问，不设永久免问开关。拒绝脚本时仍正常安装 `SKILL.md` 与 `references/`，因此**技能设计必须将脚本作为可选项**。
2. **运行期沙箱越界审批**：Agent 在 `dsh` 受限沙箱中执行脚本若触及越界操作，会触发对话内审批应答器卡片（仅提供 **「允许一次 / 拒绝」**，无「总是允许」；超时或异常一律按拒绝关闭）。

---

## 5. 画布可执行代码节点（`script.run`）与沙箱同意流

与技能包里的 `scripts/` 相互独立，工作流 `plan` 内部也可包含 `script.run` JavaScript 节点：

- **QuickJS WASM 内存隔离沙箱**：运行在渲染进程的 `src/shared/graph/execute/scriptSandboxQuickjs.ts` 中，**无文件系统、无直接网络、无 `require`、无宿主全局对象**，仅能消费上游端口输入、产出下游端口输出，并调用节点 `capabilities` 白名单声明过的受控 `await om.<能力>(...)` 接口，同时受代码长度（`< 100,000` 字符）、超时（`≤ 120s`）与内存硬顶（`≤ 512 MB`）约束。
- **安装期整包同意门禁**：含 `script.run` 的市场条目会显著标记 **「含可执行代码」**，安装前逐节点展示所需能力与代码规模；用户点「取消」则**整条工作流放弃安装**（因为节点本身即是拓扑不可分割的一环；用户在本地画布自建的 `script.run` 节点不弹市场确认框）。

---

## 6. 兼容性校验与本地联调

### 6.1 在 `ai-art-engine-skills` 内容仓库联调

```bash
node scripts/validate.mjs              # 校验全部工作流、节点命名空间、脚本硬顶与索引一致性
node scripts/build-index.mjs           # 从磁盘重新派生 index.json
node scripts/build-index.mjs --check   # CI 模式：检查 index.json 是否与磁盘完全同步
node --test scripts/validate.test.mjs  # 运行校验器自身单测
```

### 6.2 常见退回与排障速查

| 现象                    | 根因                                                                                            |
| :---------------------- | :---------------------------------------------------------------------------------------------- |
| 安装后 Agent 看不到技能 | `SKILL.md` 缺少合法 YAML frontmatter 或用了被禁用的旧驼峰键（客户端安装前校验会直接报错拦截）。 |
| 市场仓库 PR 校验失败    | 随工作流分发的技能 `name` 未加 `wf-` 前缀，或手改了 `index.json` 未跑 `build-index.mjs`。       |
| 技能描述在目录中被截断  | `description` 超过 `500` 字符上限。                                                             |
| 正文校验报未知节点类型  | 反引号内写了不存在或已下线的 `x.y` 节点类型（请对照 `graph_node_types` 清单修正）。             |
| 用户跳过脚本后技能失效  | 将核心提示词或操作逻辑全部塞进了 `scripts/` 而未在 `SKILL.md` 给出免脚本主路径。                |
