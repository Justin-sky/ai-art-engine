# 内置 Pi Agent 9.0 运行时与全工作区对话工作台（v9.0.0）

> 你负责表达创意，它负责动手落地。AI Art Engine `v9.0.0` 彻底告别外部子进程包装器，在 Electron 主进程内部原生构建了基于 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai`（`^1.5.2`）的 **进程内 Pi Agent 9.0 运行时（`src/main/agent/`）**——零子进程冷启动、零本地 HTTP 回环损耗、零跨进程文件锁，无缝贯通多工程工作区、102 个内置 MCP 工具、超大型第三方 MCP 服务、强类型 DAG 节点图与 10+ 专业 Dive 工作台。

---

## 1. 核心架构概览（`src/main/agent/`）

在 `v9.0.0` 中，AI 对话面板（`src/renderer/src/components/ChatPanel.vue`）由主进程内的七大高内聚模块协同驱动：

| 模块路径                             | 核心类 / 导出符号                                                                                                          | 架构职责                                                                                                                                                           |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/agent/piHarnessService.ts` | `runHarnessTask` · `MAX_PARALLEL_SESSIONS = 6` · `steerHarnessTurn` · `setHarnessSandboxMode` · `notifyHarnessCanvasEvent` | 进程内 `Agent` 会话编排中枢、6 槽并发会话队列、5 个原生协同工具（`todo_write` / `present_files` / `goal_manage` / `schedule_manage` / `spawn_subagent`）与斜杠命令 |
| `src/main/agent/mcpLazyToolsets.ts`  | `McpLazyToolsetManager` · `STUDIO_CORE_TOOL_NAMES` · `BUILTIN_LAZY_TOOLSETS` · `MAX_ACTIVE_TOOLS = 96`                     | 按需懒加载 MCP 工具集引擎（`load_toolset`）、首轮意图零延迟预热（`prewarmForPrompt`）、外部 MCP 相关性打分（`MAX_EXTERNAL_TOOLS_PER_LOAD = 32`）与 LRU 容量淘汰    |
| `src/main/agent/piGovernance.ts`     | `PiTurnGovernance` · `PiAskUserBroker` · `PiApprovalBroker` · `inspectToolSandboxSafety`                                   | `Craft / Plan / Ask` 双层权限硬门禁、进程内 `ask_user` 同轮计划解锁、失败即关闭单次审批卡、实时沙箱切换与结构安全红线                                              |
| `src/main/agent/piModelResolver.ts`  | `resolvePiModelFromProviders` · `piMultiApiStreamFn` · `repairMalformedToolJsonString` · `wrapPiStreamWithDsmlRecovery`    | 跨 30+ 云端与本地服务商的多协议原生流式适配、多模态视觉输入推断、畸形工具 JSON 状态机自愈、DeepSeek `<｜DSML｜function_calls>` 恢复与 `<= 128` 线级安全阀          |
| `src/main/agent/piWorkspaceTools.ts` | `createPiWorkspaceTools`（`read` · `write` · `edit` · `search` · `bash`）                                                  | 5 个高内聚进程内工作区原生工具（支持图片内联检视、Glob+Grep 一体化检索、强制 `windowsHide: true` 无闪烁静默终端与进程树清理）                                      |
| `src/main/agent/piPersona.ts`        | `buildPiSystemPrompt` · `STUDIO_DOMAIN_SUBAGENTS`                                                                          | 动态组装工程记忆、画布优先生成契约、按需工具包目录与 4 大专业领域子代理角色指令                                                                                    |
| `src/main/agent/piSessionStore.ts`   | `savePiSession` · `loadPiSession` · `rewindPiSession` · `searchPiSessions` · `buildPiSessionExportZip`                     | `<userData>/dsh-harness/pi-sessions/` 下的无锁原子 JSON 会话持久化、轮次回退/分叉、跨会话全文检索与 `.zip` 归档导出                                                |

---

## 2. 四大核心技术支柱

### 2.1 进程内多协议运行时、容错自愈流与 6 槽并发调度

1. **多协议原生流式直连（`piModelResolver.ts`）**：
   - `resolvePiModelFromProviders` 与 `piMultiApiStreamFn` 原生调度 `openai-completions`、`anthropic-messages` 与 `google-generative-ai`（兼容 OpenAI / Responses 网关、Anthropic 官方与代理、Google Gemini、DeepSeek、OpenRouter、通义千问、豆包、智谱、Kimi 等 30+ 云端服务商及本地 Ollama / vLLM / LM Studio）。
   - 自动识别模型原生视觉能力（`inferChatModelInputModalities`）与思维链能力（`inferChatModelReasoning`）：对纯文本模型（如 `deepseek-chat` / `deepseek-reasoner`）自动剥离图片块，彻底杜绝上游返回 `400 Invalid content type image_url`。
2. **工具调用双保险自愈传输**：
   - **长参数畸形 JSON 状态机修复（`repairMalformedToolJsonString`）**：当大模型在生成长篇剧本 Markdown、GDD 或深层嵌套节点补丁时偶发未转义双引号、裸换行/制表符、尾随逗号或 Markdown 代码块包裹，状态机在不破坏合法结构的前提下自动原地修复。
   - **DeepSeek DSML 文本流回退恢复（`wrapPiStreamWithDsmlRecovery` / `parseDsmlToolCalls`）**：实时监控流式文本增量（含 20 字符滑动安全缓冲防半截标签外漏），将偶发落入正文的 `<｜DSML｜function_calls>` 块无损转换为标准 `toolCall` 事件流。
3. **6 路并发会话槽位与隔离领域子代理（`piHarnessService.ts` · `piPersona.ts`）**：
   - 主进程维护最高 **6 个并发隔离会话槽位**（`MAX_PARALLEL_SESSIONS = 6`，`pi-slot-1..N` + `overflowQueue` 自动排队），支持跨多个工程同时后台跑图、写策划或修配表而互不串台。
   - 原生 `spawn_subagent` 工具可在独立 `Agent` 实例与独立懒加载上下文中并发派发专业子代理：
     - `storyboard-director`（分镜与剧本导演）：拆解分镜表、维护角色一致性与 `film.workbench` 管线；
     - `visual-asset-artist`（美术与视觉资产师）：编排关键帧生图、10 合 1 图像加工与 SVG 矢量动效并做视觉自检；
     - `blender-3d-director`（3D 场景与绑定导演）：按需挂载 `director_3d_blender` 操控 3D 导演台、绑骨与 Blender 实时建模；
     - `timeline-audio-editor`（配音与成片剪辑师）：按需挂载 `video_timeline_audio` 完成多角色对白、音效音乐合成、时间线粗剪与帧级审片；
     - `general`（通用独立上下文子代理）：承接专项代码检索、批量数据清洗或跨文档核对任务。
4. **零 HTTP 回环进程内 MCP 直调 + 外部标准接入双轨并存**：
   - 内置 Pi Agent 通过 `src/main/services/mcpServerService.ts` 导出的 `callInProcessMcpTool`、`listInProcessStudioAndBlenderTools` 与 `listInProcessExternalMcpTools` 在主进程内存态零拷贝调用全部工具，省去本地 HTTP 序列化与端口握手开销。
   - 同时完整保留 `127.0.0.1:43110` 本机回环服务（`/mcp` 93 工具 + `/mcp/blender` 9 工具 = 102 工具）及零依赖 **`npx -y ai-art-engine-mcp`** stdio CLI（`packages/ai-art-engine-mcp`）与随包 `resources/mcp-bridge.mjs`，供 Claude Code、Cursor、Codex、Windsurf 外部联调（详见 [MCP.md](./MCP.md)）。

---

### 2.2 按需懒加载 MCP 工具集引擎——永久攻克 `<= 128` 工具上限（`mcpLazyToolsets.ts`）

主流 OpenAI 兼容网关对单次请求 `tools` 数组长度设有严格的 **`128` 硬上限**。当内置 102 个 Studio/Blender 工具叠加原生工作区工具与动辄 150+ 工具的第三方 MCP 服务（如逆向分析服务 `rea`）时，传统全量注入会立即触发 `400 tools array too long` 并浪费数万 Prompt Token。

`McpLazyToolsetManager` 通过四级机制从根源解决这一架构瓶颈：

1. **精简常驻基线（每轮仅 `24` 个常驻工具）**：
   - **`12` 个进程内原生工具**：`read`、`write`、`edit`、`search`、`bash`、`load_toolset`、`ask_user`、`todo_write`、`present_files`、`spawn_subagent`、`goal_manage`、`schedule_manage`。
   - **`12` 个 `studio_core` 常驻 MCP 核心工具（`STUDIO_CORE_TOOL_NAMES`）**：`app_status`、`project_list`、`project_memory_read`、`asset_list`、`asset_create`、`models_list`、`graph_node_types`、`graph_read`、`graph_edit`、`task_run`、`task_status`、`render_svg`——无需额外加载即可直接覆盖 90% 的画布建图、改参、运行与 SVG 视觉自检。
2. **6 大内置语义工具包（`BUILTIN_LAZY_TOOLSETS`）按需挂载**：

   | 工具包 ID              | 工具数 | 涵盖能力域与代表工具                                                                                                                                       |
   | :--------------------- | :----: | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `project_assets`       |   24   | 打开/新建工程、写入工程记忆、读写/导入/移动/删除资产与文件夹、像素质检修复（`asset_qc*`）、对象存储上传、`workflow_use_installed`、`decide`、Git 状态/Diff |
   | `video_timeline_audio` |   19   | 角色音色档案（`voice_profile_*`）、语音转写、人声伴奏分离、`rea-video` 语义拆解、6 栏时间线读写/粗剪/预览/导出、抽帧与关键帧检测、B 站素材抓取             |
   | `director_3d_blender`  |   13   | 3D 导演台（`director_stage_read` / `director_stage_edit`）、3D 动作列表、`stage2d_spine_export`，以及 `/mcp/blender` 全套 9 个 Blender 建模绑骨工具        |
   | `game_production`      |   15   | 一句话可玩游戏、HTML5 脚手架与冒烟构建（`gameplay_*`）、Machinations 59 积木与 Studio 求解器、UI 8 屏套件、瓦片/PBR/音效变体/Shader/配表生成               |
   | `tutorial_recording`   |   8    | 应用窗口教学录屏（`screen_record_*`）、控件坐标查询与真实点击（`ui_bounds` / `ui_click`）、带 TTS 字幕的教程成片合成（`tutorial_compose`）                 |
   | `skills_web_vision`    |   10   | 无头浏览器网页图文提取（`web_extract_article`）、在线技能检索/预检/安装/卸载（`skill_*`）、本地离线 OCR 与 ONNX 视觉（`vision_local_*`）、定时列表         |

3. **外部 MCP 服务目录摘要与关键词相关性精选（`ext:<serverId>`）**：
   - 会话启动时仅向系统提示词注入外部 MCP 服务的单行目录摘要（`ext:<id>`、名称、说明与挂载状态），**绝不预先倾倒完整 JSON Schema**。
   - 当模型调用 `load_toolset({ toolsets: ["ext:<serverId>"], query: "..." })` 时，`selectRelevantExternalTools` 对工具名与描述进行中英文分词打分，单次最多挂载相关性最高的 **`MAX_EXTERNAL_TOOLS_PER_LOAD = 32`** 个工具，并返回被省略工具数与样本供二次精确检索。
4. **首轮意图零延迟预热（`prewarmForPrompt`）与 LRU 淘汰护栏**：
   - 首轮请求发出前，`prewarmForPrompt` 自动匹配用户提示词意图（如提及 Blender/绑骨、Machinations/肉鸽小游戏、时间线/字幕、公众号文章链接/OCR、反编译/逆向工程等）并预先挂载对应工具包，**零额外 LLM 往返**。
   - 全局激活工具数严格封顶 **`MAX_ACTIVE_TOOLS = 96`**（超出时按 `touchTool` 最近使用序号自动 LRU 淘汰最久未用工具包），底层 `onPayload` 再经 `enforceOpenAiToolsLimitPayload`（`OPENAI_HARD_MAX_TOOLS = 128`）兜底截断；同时配置 `compat.supportsMidConvoToolAdditions: false`，通过 `prepareNextTurnWithContext` 在下一轮请求头干净同步工具列表，兼顾网关兼容性与提示词前缀缓存命中率。

---

### 2.3 原生双层权限治理与实时沙箱切换（`piGovernance.ts`）

1. **`Craft / Plan / Ask` 双层硬门禁（`PiTurnGovernance` + `src/shared/mcpModeAccess.ts`）**：

   | 面板档位          | 第一层：`agent.state.tools` 暴露面过滤                                                                          | 第二层：`beforeToolCall` 运行时硬拦截                                                                         |
   | :---------------- | :-------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
   | **Craft（执行）** | 暴露当前激活的全部原生工具与读写/生成类 MCP 工具                                                                | 按当前沙箱策略（`workspace-write` / `danger-full-access`）与结构安全红线校验放行                              |
   | **Plan（规划）**  | 确认前仅暴露只读原生工具（`read`、`search`、`load_toolset`、`ask_user`、`todo_write`）与 `read` 级只读 MCP 工具 | 用户确认前拦截一切写盘、Shell 命令、子代理与生成类工具；经 `ask_user` 确认后**同轮即时解锁**全量 Craft 工具链 |
   | **Ask（纯问答）** | 空数组 `[]`（对模型完全隐藏一切原生与 MCP 工具）                                                                | 拒绝任何工具调用请求，100% 保证零文件改动、零画布变更、零云端生成消耗                                         |

2. **进程内 `ask_user` 与自定义回答无损透传（`PiAskUserBroker`）**：
   - 彻底移除旧版基于临时文件轮询的问答桥，由主进程内存态 Promise 直接对接渲染层交互卡片（兼容扁平 `{ question, options, hint }` 与 Claude Code `questions` 数组格式）。
   - 用户在卡片中输入自定义补充要求时，严格保留 `fromCustom: true` 原始文本（绝不被预设选项标签覆盖），并在 `Plan` 模式下非取消答复时立即回调 `confirmPlan()` 动态挂载写权限，无需打断重开新一轮对话。
3. **失败即关闭单次审批卡与盘中实时沙箱切换（`PiApprovalBroker` · `inspectToolSandboxSafety`）**：
   - **`🛡️ 受限模式`（`workspace-write`，默认）**：允许直接读写当前工作区根目录与系统临时目录；若模型尝试写入工作区外部路径、在外部 `cwd` 执行终端命令，或运行高敏感 `bash` 指令（如递归强删、`git reset --hard`、全局包安装等），立即挂起当次调用并在对话流弹出**单次权限审批卡**（仅识别显式点击 `允许一次` `'allow-once'`，点击 `拒绝`、取消或 10 分钟超时一律按失败即关闭拦截；已激活 Claude Skill 声明的 `allowed-tools` 白名单可按规则免确认放行）。
   - **`🔓 完全访问`（`danger-full-access`）**：支持在会话空闲或**运行盘中随时点击切换**（`setHarnessSandboxMode` 更新治理器并通过 `agent.steer(...)` 向正在执行的 Agent 注入实时策略变更通知，无需中止重跑）。
   - **全模式不可逾越的三条结构安全红线**：即便开启 `🔓 完全访问`，治理层仍硬性阻断以下破坏性操作：
     1. 禁止通过 `read` / `write` / `edit` / `search` / `bash` 直接读写 `.canvas.asset.json`（画布受前端实时状态托管，必须走 `graph_read` / `graph_edit`）；
     2. 禁止通过文件工具或终端直接修改 `$DSH_HOME/skills`（`<userData>/dsh-harness/skills`，必须走 `skill_install` / `skill_uninstall` 审计安装）；
     3. 禁止在 `bash` 中拉起 `chrome` / `msedge` / `chromium` / `playwright open` 浏览器进程（检视 SVG/HTML 请调 `render_svg`，提取动态网页正文与配图请调 `web_extract_article`）。

---

### 2.4 无锁原子 JSON 会话持久化（`piSessionStore.ts` · `dshPaths.ts`）

- **零文件锁原子替换**：会话持久化为标准 UTF-8 JSON 文件 `<userData>/dsh-harness/pi-sessions/<sessionId>.json`（保留 `dsh-harness` 父目录，使 `$DSH_HOME/skills` 技能包与导出目录 100% 向下兼容），写入时采用先写同目录 `.tmp` 临时文件再 `renameSync` 原子替换。
- **跨模型/跨模式零残留热切换**：`stripRuntimeSystemMessages` 在落盘时自动剥离运行时动态生成的 `role: "system"` 快照，仅保存纯净消息序列（`user` / `assistant` / `toolResult`）以及 `loadedToolsets`、`todos` 与 `goal`。这彻底根除了旧版 `.jsonl.zstd` 流式压缩句柄锁导致的「中途切换供应商/模型报文件占用锁死」故障，每次唤醒均按最新模型协议、最新模式与最新工具目录干净重建前导提示词。
- **回退分叉、全文检索与一键归档**：原生提供按用户轮次截断回退或派生分支会话（`rewindPiSession`）、无需 SQLite 原生依赖的跨会话毫秒级全文检索（`searchPiSessions`），以及同时打包 `session.json` 与可读 Markdown 对话稿 `transcript.md` 的 `.zip` 导出（`buildPiSessionExportZip`）。

---

## 3. 对话工作台 UI 与创作陪伴体验

| 功能模块                             | 核心实现路径                                                                                                                                              | 交互与能力亮点                                                                                                                                                                                            |
| :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **向左自适应扩展多工程侧栏**         | `src/renderer/src/components/ChatPanel.vue` · `src/renderer/src/composables/useChatHistory.ts` · `src/renderer/src/editor/workbench/sidePanelCollapse.ts` | 点击展开后 Dockview 对话面板向左侧画布方向平滑拓宽，不挤压右侧对话阅读区；统一管理多工程工作区树（`workspace.json`）、6 槽并发运行态角标、全文搜索、置顶与分支派生（Fork）                                |
| **内嵌工作区文件编辑器与 Git 感知**  | `src/renderer/src/components/WorkspaceFileEditor.vue` · `src/main/services/gitService.ts`                                                                 | 在对话侧栏直接查看与编辑 `.aiartengine/memory.md`、剧本、数值 CSV/JSON 与代码文件，配合 `project_git_status` / `project_git_diff` 审阅改动                                                                |
| **24h（`00:00–23:59`）定时自动化**   | `src/renderer/src/components/ChatPanel.vue` · `src/main/agent/piHarnessService.ts`                                                                        | 内置覆盖全天 `00:00–23:59`（48 个半点档位 + `23:59`）的周期调度器与会话内 `schedule_manage` / `schedule_list` / `schedule_delete`，支持定时巡检、批量跑图与自动汇报                                       |
| **盘中实时转向与画布事件自动闭环**   | `steerHarnessTurn` · `notifyHarnessCanvasEvent`（`piHarnessService.ts`）                                                                                  | Agent 执行途中可随时发送补充指令实时修正方向（`agent.steer`）；画布工作流完成或节点报错时可自动唤醒 Agent 审片交付或定位修图                                                                              |
| **零 Key 即刻体验与精选灵感卡**      | `src/shared/chatShowcaseStarters.ts`                                                                                                                      | 未配置任何云端 API Key 时，一键触发 `buildZeroKeyLiveDemoGraph()` 铺开 6 图层仙侠装备 UI + 原生 `TySh` PSD 拆层可交互样板间；内置 `CHAT_SHOWCASE_STARTERS` 覆盖漫剧、导演台、数值沙盘等高频起手式         |
| **多仙子许愿神龛与 10 种程序化天气** | `src/renderer/src/components/ChatWishShrine.vue` · `src/shared/chatWishShrine.ts` · `src/renderer/src/graph/vfx/canvasWeatherEngine.ts`                   | 长耗时视频/3D 生成等待期间提供多仙子情境祈愿陪伴、金色暴击彩蛋、远景风光（`CanvasGenshinVista.vue`），以及樱吹雪、流星雨、极光、霓虹雨等 **10 种程序化画布动态天气与环境音效**（`canvasWeatherAudio.ts`） |

---

## 4. 典型创作工作流与内置斜杠指令

### 4.1 画布优先（Canvas-First）全工作区直控场景

焦点感知注册表（`src/renderer/src/editor/control/surfaceRegistry.ts`）与深层智能补丁（`src/shared/graph/smartPatch.ts`）会将当前打开的画布或 Dive 子工作台上下文实时注入对话轮次：

- **AI 漫剧与爆款视频取证复刻**：「按古风仙侠流派把 `@第一集剧本` 拆成五阶段漫剧工作台并锁死女主定妆图」「拆解 `@参考短片.mp4` 的四轴视听节拍，换成赛博朋克主角重拍成 15 秒竖屏成片」（自动编排 `film.workbench` 或 `semantic.analyze → semantic.rebuild` 并调用 `task_run`）。
- **3D 导演台与 Blender 实时联动**：「让 3D 导演台里的林小满切成奔跑姿态、主光调成暖橙色并切 85mm 特写抓拍」「在 Blender 里搭一座低多边形浮空岛，截视口图自检后导成 GLB 入库」（首轮自动预热 `director_3d_blender`）。
- **Machinations v2 数值实验室与游戏 UI 管线**：「建一个抽卡软保底经济图跑仿真并反推第 60 步出金率」「把 `@背包界面.png` 拆成 16 类游戏控件并导出可双击改字的 `TySh` PSD 与 Unity UGUI」（首轮自动预热 `game_production`）。
- **技术文章一键转科普成片**：「把这篇公众号文章 `https://...` 做成带配音字幕和架构动图的 1 分钟科普短视频」（主进程前置调用无头浏览器 `web_extract_article` 抓取 Markdown 与配图入 `Cache/imports/`，再编排 `asset.voice` + `svg.gen → svg.anim` + `output.timeline` 合成成片）。

### 4.2 内置斜杠指令速查

除支持输入 `/<skill-name>` 调用已安装的 Claude Code `SKILL.md` 技能包外，输入框原生内置以下管理指令：

| 斜杠指令                                 | 作用说明                                                                                       |
| :--------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `/goal <目标描述>`                       | 启动多轮自主目标巡航（自动拆解 `todo_write` 并在每轮结束后自检续跑，直至验证完成或达轮次上限） |
| `/goal status \| pause \| resume \| end` | 查看当前会话自主目标进度，或暂停、恢复、终止多轮巡航                                           |
| `/compact`                               | 压缩当前会话较早历史轮次，保留近期关键上下文并释放 Token 窗口空间                              |
| `/export`                                | 将当前会话完整记录一键打包导出为含 `session.json` 与 `transcript.md` 的 `.zip` 交付卡片        |
| `/feedback <备注>`                       | 记录当前会话诊断与体验反馈至 `<userData>/dsh-harness/feedback/`                                |

---

## 5. 常见现象与排障清单

| 现象 / 提示                                          | 原因定位与解决办法                                                                                                                                    |
| :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 选了 `Ask` 模式后 AI 只给建议不动手改画布            | 符合预期：`Ask` 模式下双层门禁对模型隐藏并拦截全部工具；切回 `Craft`（直接执行）或 `Plan`（先出方案确认后同轮执行）即可。                             |
| `Plan` 模式下弹出选项卡片等待点击                    | 符合预期：`Plan` 模式在写盘或跑图前必须通过 `ask_user` 取得确认；点击「确认执行计划」或输入自定义要求发送后，同一轮运行会自动解锁写权限继续落地。     |
| 对话中弹出「单次权限审批卡」（`允许一次 / 拒绝`）    | 当前处于 `🛡️ 受限模式`（`workspace-write`），且模型请求修改工作区外部路径或执行高敏感终端命令；可按需点「允许一次」，或在输入栏切换至 `🔓 完全访问`。 |
| 报错拦截直接读写 `.canvas.asset.json`                | 结构安全红线保护：直接改盘会与前端内存画布冲突，Agent 会自动按提示改用 `graph_read` 与 `graph_edit` 实时操作画布。                                    |
| 中途切换不同服务商/模型是否会冲突报错？              | 不会：`v9.0.0` 采用无锁原子 JSON 会话存储并自动剥离临时 `system` 快照，可在任意两轮之间自由切换 Claude、GPT、DeepSeek、Gemini 或本地 Ollama 模型。    |
| 挂载了超大型第三方 MCP 服务会触发 `128` 工具报错吗？ | 不会：`McpLazyToolsetManager` 对外部服务默认只注摘要，按需检索单次最多挂载 32 个高相关工具，且全局硬封顶 `MAX_ACTIVE_TOOLS = 96 < 128`。              |
