# AI 对话与 DeepSeek Harness 工作台（v8.9.1）

> 你负责表达创意，它负责动手落地。AI Art Engine 内置基于 `@deepseek-ai/dsh`（`0.2.2-rc.1`）的 **AI 对话助手（`ChatPanel.vue`）**——一个打通多工程工作区、102 个 MCP 工具、全画布节点图与各专业 Dive 工作台的本地优先创作 Agent。

---

## 1. 核心定位：从“聊天框”到“全工作区创作搭子”

传统 AI 聊天工具需要你自己把对话结果复制成提示词、手动拖节点、找模型、调参数。AI Art Engine 的内置对话面板直接把 **DeepSeek Harness 运行时**（`src/main/services/deepseekHarnessService.ts`，由 Electron 内置 Node 以 `ELECTRON_RUN_AS_NODE=1` 离线驱动 `resources/dsh`）与主进程 **MCP 服务**（`src/main/services/mcpServerService.ts`）深度合流：

- **一句话建图与跑图**：「拆解 `@参考视频` 的镜头节奏，换成赛博朋克女主重拍成 15 秒竖屏短片」→ 自动编排 `semantic.analyze` → `semantic.rebuild` 流水线并启动任务。
- **跨专业子工作台直控**：双击进入 3D 导演台、Machinations v2 数值实验室、5 阶漫剧工作台、人像精修、2D Spine 舞台或 6 轨剪辑台时，AI 自动感知当前焦点界面与深层参数，一句话微调数值。
- **多工程与定时自动化**：支持向左展开多工程会话侧栏、内嵌编辑工程文件与查看 Git 变更，并可配置 `00:00–23:59` 全天候定时自动化任务。
- **零 Key 即刻体验**：尚未配置任何云端 API Key 的新用户，也可一键触发内置零 Key 交互演示（`src/shared/chatShowcaseStarters.ts`），直观体验节点图编排与工作台联动。

---

## 2. v8.9.1 对话工作台核心特性

| 模块                                | 核心实现路径                                                                                                                                            | 能力说明                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **向左展开多工程侧栏**              | `src/renderer/src/components/ChatPanel.vue`、`src/renderer/src/composables/useChatHistory.ts`、`src/renderer/src/editor/workbench/sidePanelCollapse.ts` | 点击展开后 Dockview 对话面板向左侧画布方向平滑拓宽，不挤压右侧消息流；支持多工程工作区树（`workspace.json`）、跨会话全文检索、置顶与分支派生（Fork）                                                                                                |
| **内嵌工作区文件编辑器与 Git 感知** | `src/renderer/src/components/WorkspaceFileEditor.vue`、`src/main/services/gitService.ts`                                                                | 在对话侧栏直接浏览并编辑工程内的 `memory.md`、剧本、JSON 配置与文本文档，支持配合 `project_git_status` / `project_git_diff` 审阅工作区改动                                                                                                          |
| **24h（`00:00–23:59`）定时自动化**  | `src/renderer/src/components/ChatPanel.vue`、`src/main/services/deepseekHarnessService.ts`                                                              | 内置覆盖全天 `00:00–23:59`（48 个半点档位 + `23:59`）的时间选择器与 Cron / 单次提醒调度（MCP `schedule_list` / `schedule_delete`），支持无人值守批量巡检、素材质检或定时跑图                                                                        |
| **零 Key 即刻演示与精选灵感卡**     | `src/shared/chatShowcaseStarters.ts`                                                                                                                    | 未配 Key 时可通过 `buildZeroKeyLiveDemoGraph()` 一键在画布铺开可交互演示拓扑；内置 `CHAT_SHOWCASE_STARTERS` 覆盖漫剧、3D 导演台、游戏数值、UI 拆层与视频复刻等高频起手式                                                                            |
| **`Agent / Plan / Ask` 三模式门禁** | `src/shared/mcpModeAccess.ts`                                                                                                                           | 界面提供 **Craft（Agent 执行）**、**Plan（只读规划）**、**Ask（纯问答）** 三档切换，并由服务端工具门禁硬性约束读写权限（见 §3）                                                                                                                     |
| **实时工具操作摘要卡片**            | `src/shared/mcpToolOperationSummary.ts`                                                                                                                 | 每一次 MCP 工具调用都会在消息流渲染结构化进度与前后对比摘要（改了哪个节点、调了哪项参数、产出了哪个资产），全程透明可追溯                                                                                                                           |
| **画布许愿少女与程序化天气陪伴**    | `src/renderer/src/components/ChatWishShrine.vue`、`src/shared/chatWishShrine.ts`、`src/renderer/src/components/CanvasWeatherOverlay.vue`                | 在长耗时视频/3D 生成等待期间提供情境化二次元祈愿祝福、金色暴击彩蛋，以及 10 种程序化画布天气（樱吹雪、流星雨、极光、霓虹雨等，`src/renderer/src/graph/vfx/canvasWeatherEngine.ts` + `canvasWeatherAudio.ts`）与远景风光（`CanvasGenshinVista.vue`） |

---

## 3. `Agent (Craft) / Plan / Ask` 三模式权限边界

模式状态通过请求头 `x-aiae-chat-mode` 同步至 MCP 服务端（`src/shared/mcpModeAccess.ts`），不是单纯的提示词约束，而是**服务端硬门禁**：

| 界面档位                | 协议值    | 工具权限与适用场景                                                                                                                                                                                    |
| ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Craft（Agent 模式）** | `'craft'` | **全量读写与执行**。可创建/切换工程、增删改查资产、编辑节点图与 3D 导演台、安装市场技能、运行生成任务、驱动 Machinations 仿真与合成录屏教程                                                           |
| **Plan（规划模式）**    | `'plan'`  | **审批前严格只读**。仅放行读取类工具（如 `graph_read`、`asset_list`、`director_stage_read`、`skill_search`）与交互确认工具 `ask_user`；生成完整方案并由用户点击「确认执行」后，才放行写操作与任务调度 |
| **Ask（问答模式）**     | `'ask'`   | **零工具纯对话**。服务端整体屏蔽全部 MCP 工具调用，100% 保证不改动任何工程资产、画布节点或定时计划，适合讨论创意、润色剧本或咨询软件用法                                                              |

---

## 4. 节点原生能力与外部技能包的分工

在 `v8.9.1` 中，画布节点能力与外部 Agent 技能包职责清晰解耦：

1. **画布节点原生能力（`src/shared/graph/nodeCapabilities.ts`）**：
   - 每个内置或插件节点的默认系统提示词、指令模板、端口连线语义与一键预设（`NodeCapabilityDef`）直接注册在共享图核心中，通过自省引擎（`src/shared/graph/introspection.ts`）与 MCP `graph_node_types` 动态暴露给 AI，不再向 `$DSH_HOME/skills` 写入散装的九宫格 `.md` 文件。
2. **Claude Code 兼容技能与工作流市场（`src/main/services/skillMarketService.ts`）**：
   - 官方与社区的可复用工作流包及 `SKILL.md` 技能包托管于独立仓库 `ai-art-engine-skills`，支持在对话中直接通过 `skill_search`、`skill_inspect_github`、`skill_install`、`workflow_use_installed` 检索、审计并实例化到当前画布（详见 [MARKETPLACE.md](./MARKETPLACE.md)）。

---

## 5. 全工作区对话直控：典型场景速查

无论当前停留在主节点图画布，还是已双击下钻（Dive）进任意专业子工作台，焦点感知注册表（`src/renderer/src/editor/control/surfaceRegistry.ts`）与深层智能补丁（`src/shared/graph/smartPatch.ts`）都会自动锁定当前上下文：

### 5.1 3D 导演台（`director.stage`）

- **站位、姿态与 56 骨微调**：「让林小满换成奔跑姿态，右手握拳，左大臂抬高 35 度，视线看向镜头」
- **灯光、环境与机位抓拍**：「主光源改成暖橙色、强度 2.4，切到 85mm 特写机位并抓拍当前白模构图」

### 5.2 游戏研发、数值仿真与 UI 管线

- **Machinations v2 数值实验室（`game.economy`）**：「搭建一套抽卡保底与体力循环经济图，跑 200 步 Monte Carlo 仿真，反推第 30 天金币通胀不崩盘的掉落率」
- **游戏 UI 16 类拆层与图集组装（`image.layerSplit` / `ui.atlasCompose`）**：「把 `@背包界面` 按游戏 UI 拆成独立控件与可编辑文字层，识别九宫格切线后打包成 Unity 图集和 PSD」
- **一句话可玩 HTML5 原型**：「做一个赛博朋克霓虹弹幕射击可玩小游戏，带 Boss 阶段切换与合成音效」

### 5.3 AI 漫剧、取证级复刻与 6 轨剪辑台

- **21 流派 5 阶漫剧工作台（`film.workbench`）**：「按古风仙侠流派把 `@第一集剧本` 拆成五阶段分镜，锁死男女主定妆参考图，把第 3 镜台词改成『退后！』」
- **爆款视频取证级拆解与换角重拍（`semantic.analyze` → `semantic.rebuild`）**：「拆解 `@爆款样片` 的分镜节拍与运镜提示词，把主角替换成 `@品牌吉祥物` 重拍成片」
- **4 频段小波人像精修（`image.portrait`）与 2D Spine 舞台（`stage.2d`）**：「人像磨皮调到标准、加清透日系滤镜并导出 2 寸蓝底证件照」「给 `@Q版立绘` 自动拆件绑骨并导出 Spine 4.1 JSON」
- **6 轨非线性剪辑台（`output.timeline`）**：「把刚生成的分镜视频按节拍粗剪上轨，对齐配音字幕，同时导出 MP4 和剪映草稿」

---

## 6. 快速上手与排障清单

### 三步开始创作

1. **打开或新建工作区/工程**（未配置模型 Key 时可直接点击欢迎卡片的「零 Key 即刻体验」）。
2. **选择对话大脑**：在设置 → 模型接入中启用任一文本模型（推荐 DeepSeek 官方、OpenAI 兼容或本地 Ollama / vLLM），在对话面板顶部切换模型与模式（`Craft` / `Plan` / `Ask`）。
3. **输入 `@` 引用工程资产**：在输入框敲 `@` 选择图片、视频、音频、3D 模型或文档，直接用自然语言下达指令。

### 常见现象自查

| 现象                              | 原因与解决方法                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 提示「请先打开工程」              | 资产读写、画布编辑与工程记忆均绑定在具体工程目录上；新建或打开任一工程即可解锁全部工作区工具                                   |
| 选了 `Ask` 模式后 AI 不动手改图   | 符合预期：`Ask` 模式下服务端硬性禁用全部 MCP 工具；切回 `Craft`（直接执行）或 `Plan`（先出方案确认后执行）即可                 |
| `Plan` 模式下弹出确认卡片等待响应 | 符合预期：`Plan` 在落盘修改或触发生成前必须经 `ask_user` 取得你的确认，点击允许后同一轮对话会自动继续执行                      |
| 外部或内置工具全部不可用          | 检查设置 →「MCP 工具服务」是否已启用（默认监听 `127.0.0.1:43110`，详见 [MCP.md](./MCP.md)）                                    |
| 定时任务到点未触发                | 确认应用处于运行状态（可最小化至后台）、目标工程路径仍存在，且通过顶部计划面板或 `schedule_list` 核对计划未处于暂停/已删除状态 |
