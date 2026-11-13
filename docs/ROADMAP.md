# AI Art Engine 产品与技术路线图（Roadmap）

> **当前已发布基线版本：`v9.0.0`**
> 产品定位：**本地优先（Local-First）的 AI 原生视觉、漫剧、视频与游戏资产全链路创作操作系统**——以 Typed DAG 节点图为确定性执行层、以进程内 Pi Agent 9.0 + 按需懒加载 102 工具 MCP 服务为智能编排层，让创作者以导演视角完成从灵感到工业级交付物的闭环。

---

## 1. `v9.0.0` 已交付核心里程碑（Current Baseline）

### 1.1 进程内 Pi Agent 9.0、按需懒加载 MCP 引擎与原生权限沙箱

- [x] **进程内 Pi Agent 9.0 运行时（`src/main/agent/piHarnessService.ts` · `piModelResolver.ts`）**：彻底取代外部 `@deepseek-ai/dsh` 子进程与 `.jsonl.zstd` 锁流，基于 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai`（`^1.5.2`）直接运行在 Electron 主进程内；原生支持跨 30+ 云端服务商与本地 Ollama / vLLM / LM Studio 的多协议流式调度（`openai-completions` / `anthropic-messages` / `google-generative-ai`），内置长参数畸形工具 JSON 状态机自愈（`repairMalformedToolJsonString`）与 DeepSeek `<｜DSML｜function_calls>` 文本流回退恢复。
- [x] **按需懒加载 MCP 工具集引擎（`src/main/agent/mcpLazyToolsets.ts`）——根治 `<= 128` 工具数上限**：维持每轮 `24` 个精简常驻工具（`12` 个工作区/协同原生工具 + `12` 个 `studio_core` 高频 MCP 工具），将剩余工具划分为 `6` 大语义领域包并支持 `ext:<serverId>` 超大型第三方 MCP 服务关键词相关性精选（单次上限 `32`），配合首轮意图零延迟预热（`prewarmForPrompt`）、LRU 自动淘汰与 `MAX_ACTIVE_TOOLS = 96 < 128` 硬封顶，实现零回环内存直调（`callInProcessMcpTool`）。
- [x] **原生双层治理、实时沙箱切换与无锁原子会话（`piGovernance.ts` · `piSessionStore.ts`）**：双层执行 `Craft / Plan / Ask` 权限硬门禁（工具暴露过滤 + `beforeToolCall` 运行拦截），支持内存态 `ask_user` 自定义输入无损保留与 `Plan -> Craft` 同轮解锁、失败即关闭单次权限审批卡、盘中实时热切换 `🛡️ 受限模式 / 🔓 完全访问` 及 `.canvas.asset.json` / `$DSH_HOME/skills` 结构保护；会话采用 `<userData>/dsh-harness/pi-sessions/` 无锁原子 JSON（`*.tmp` → `rename`），中途跨服务商切模型零句柄冲突，支持瞬时回退/分叉、全文检索与 `.zip` 导出。
- [x] **6 槽跨工程多会话并发、专业子代理与多仙子画布陪伴**：支持最高 **6 路隔离会话并发执行**（`MAX_PARALLEL_SESSIONS = 6`）与 4 大专业领域子代理（`storyboard-director`、`visual-asset-artist`、`blender-3d-director`、`timeline-audio-editor`）协同制片；配备向左平滑拓宽的多工程侧栏、内嵌文件编辑器与 Git Diff、覆盖全天 `00:00–23:59` 的定时自动化、零 Key 即刻体验样板间（`chatShowcaseStarters.ts`），以及**多仙子祈愿陪伴（`ChatWishShrine.vue`）与 10 种程序化画布动态天气及音效**。
- [x] **102 工具双端点 MCP 服务与零依赖 `npx` CLI**：主端点 `/mcp`（**93** 个核心工具）+ `/mcp/blender`（**9** 个 Blender 实时建模工具），同时提供零依赖 **`npx -y ai-art-engine-mcp`** stdio CLI（`packages/ai-art-engine-mcp`）、随包 `resources/mcp-bridge.mjs` 与 Streamable HTTP 直连，打通 `ai-art-engine-skills` 社区市场与 GitHub `SKILL.md` 直装生态。

### 1.2 影视漫剧、爆款复刻与 6 轨非线性剪辑

- [x] **21 流派 × 5 阶 AI 漫剧工业化工作台（`film.workbench`）**：覆盖都市逆袭、古风仙侠、赛博悬疑等 21 种题材流派（`manjuGenres.ts`），贯通「剧本拆解 → 连续性审计 → 角色定妆锁与跨集音色绑定 → 批量锁脸拍摄 → 审片成片」全流程。
- [x] **2 节点取证级爆款视频拆解与复刻（`rea-video`）**：由 `semantic.analyze`（容器溯源、镜头切分、ASR 台词、音频节拍、VLM 机位/景别/光影反推）与 `semantic.rebuild`（干净底板修补、主体/风格替换、DP 合批重拍、原片节奏自动对齐）组成极简双节点复刻管线。
- [x] **6 轨非线性剪辑时间线（`output.timeline`）与剪映草稿直出**：集成 6 栏创意套件（120+ 特效/转场/LUT/调色/模板 + TD-PSOLA 调音歌唱），支持词级动态字幕与节拍粗剪，一键渲染 MP4 或导出**剪映专业版 / CapCut 草稿目录**、Premiere FCP7 XML 与 OpenTimelineIO（`timelineNleExport.ts`）。

### 1.3 游戏数值仿真（含在线试玩场）、16 类 UI 管线、2D Spine 与 3D 导演台

- [x] **Machinations v2 游戏经济工作台（`game.economy`）与 Online Machinations Playground**：完整支持 **59 种标准构造块**、确定性 Tick 与大规模 Monte Carlo 随机仿真，独创 **120fps 贝塞尔目标曲线直拖反推求解器（Goal-Seek）**、免安装浏览器端 **Online Machinations Playground** 与 RPG 卡牌试玩台，一键导出 Unity C# / Godot GDScript / 矢量 SVG / CSV，并通过 `machinations_building_blocks` / `machinations_studio` 暴露给 Agent。
- [x] **游戏 UI 16 类精准拆层（`image.layerSplit`）与图集组装（`ui.atlasCompose`）**：结合跨平台原生离线 OCR、字芯/描边双色采样、九宫格切线检测与背景生成式补全，一键导出含原生可编辑 `TySh` 文本层的分层 PSD（`layerSplitPsd.ts`）、Sprite 图集及 Unity UGUI / UI Toolkit / Godot `.tscn` / HTML5 布局代码。
- [x] **一句话可玩 HTML5（2D Canvas / 3D Three.js）沙盒**：支持程序化几何/贴图/音效生成、无头浏览器 5 帧冒烟自检（`smoke`）与一键编译单文件可玩预览包（`gameplay_prepare_project` / `gameplay_build` / `game_playable_preview_compile`）。
- [x] **2D Spine 立绘舞台（`stage.2d`）**：融合 Alpha 剪影形态学与本地 YOLOv8/11-Pose 17 点关键点自动适配 2–8 头身二次元/Q 版骨骼（`stage2dHumanoid.ts`），支持自动拆件蒙皮与 Spine 4.1 标准导出（`stage2d_spine_export`）。
- [x] **3D 导演台（`director.stage`）与网格后处理矩阵**：56 骨人形 IK、24 套内置程序化动作、多光源与分镜白模预演；统一封装 Meshy / Tripo 骨骼绑定、智能分件、减面重拓扑与 PBR 贴图能力矩阵（`meshOps.ts`），并打通 Blender 双向实时桥接。

### 1.4 本地视觉底座与 4 频段小波人像精修

- [x] **4 频段小波人像精修工作台（`image.portrait`）**：60fps 本地实时小波皮肤分离、68 点面部液化、`.cube` 3D LUT、证件照智能排版 + 云端重绘 Procrustes 身份回贴锁。
- [x] **Local-First 视觉与离线 OCR 引擎**：独立 `utilityProcess` 运行 ONNX（`CUDA → DirectML → CoreML → CPU` 自动降级），随包内置 YOLO11 检测/分割/姿态与 BlazeFace + 468 点 FaceMesh，支持按需扩展 SAM 2.1 交互式分割与 BiRefNet/RMBG/MODNet 高精度抠图，配合 Windows WinRT / macOS Vision / Linux Tesseract 零依赖离线 OCR，并由 `vision_local_ocr` 与 `vision_local_yolo` 对外服务。
- [x] **PNG 工作流无损内嵌（`pngWorkflowCodec.ts`）**：导出的 PNG 作品自动携带 `tEXt/iTXt(aiae:graph)` 节点拓扑元数据，拖入画布即可无损还原完整创作图。

---

## 2. `v9.1+` 前瞻演进路线（Forward Milestones）

在 `v9.0.0` 完成进程内 Pi Agent 9.0、按需懒加载 MCP 引擎、6 槽并发领域子代理与游戏/漫剧核心工作台闭环的基础上，`v9.1+` 聚焦**「全自动质检返工闭环、跨集资产圣经、AI 原生动作合成与开放市场生态」**四大方向：

### 2.1 `v9.1` — AI Producer 与全链路质检返工闭环（Autonomous Production Loop）

- [ ] **Producer 多角色编排器（`ProductionPlan` IR）**：在 `v9.0.0` 领域子代理（`spawn_subagent`）基础上，将一句话长篇剧集、商业广告或游戏立项需求编译为带显式依赖图与预算配额的 `ProductionPlan` 中间表示，支持 `Plan` 模式可视化审阅后全自动派发。
- [ ] **全链路自动质检 → 归因返工闭环**：打通 `media.review` / `film.review` / `asset_qc` 与上游子图重编译——当 VLM 或多模态质检判定穿帮、崩坏或时长超差时，自动将失败原因注入局部子图重跑（受 `maxAttempts` 与预算上限保护）。
- [ ] **标准化制片交付树（Project Deliverable Tree）**：统一生成结构化交付目录（`script/`、`bible/`、`storyboard/`、`shots/`、`ui-atlas/`、`economy/`、`timeline/`、`reviews/`）与「制片总览」Dive 审片看板。

### 2.2 `v9.2` — 跨集角色与世界观圣经引擎（Character & Visual DNA Bible）

- [ ] **一等公民 `CharacterBible` 与 `VisualDNA` 资产**：统一管理主角跨集多视图设定、面部特征锁、专属克隆音色（`voice_profile_*`）、服装状态机以及全片色彩/镜头/胶片颗粒 DNA 槽位，并与 `.aiartengine/memory.md` 双向实时同步。
- [ ] **跨集一致性视觉度量门禁**：在批量漫剧拍摄与视频复刻链路内置角色身份相似度与画风漂移评分，低于阈值自动触发带定妆参考图的局部重抽。

### 2.3 `v9.3` — AI 原生动作库与跨维绑定工作台（Motion & Rigging Studio）

- [ ] **自然语言检索与情绪化动作合成库**：构建带情绪/节奏/镜头语法标签的 3D/2D 动作资产库，支持从参考视频提取动作序列并一键重定向至 `director.stage` 56 骨角色或 `stage.2d` Spine 立绘角色。
- [ ] **Unreal Engine 5 与大型引擎深度资产桥接**：在现有 Unity UGUI、Godot `.tscn`、Spine 4.1 与 Blender `/mcp/blender` 基础上，补齐面向 UE5 DataTable / Widget Blueprint / Control Rig 的工程级导出清单。

### 2.4 `v9.4+` — 多品类创意市场与团队协同审片（Ecosystem & Studio Sync）

- [ ] **市场品类扩展（Six-Grid Marketplace）**：在现有 `Workflow` + `Skill` 双品类市场基础上，扩展规范化的 **自定义 Cordis 节点包（Node Pack）**、**角色设定包（Character Pack）**、**3D/2D 动作包（Motion Pack）** 与 **风格预设包（Style DNA Pack）** 签名校验与分发协议。
- [ ] **局域网 / 私有云团队审片队列（Optional Studio Server）**：坚持桌面端 Local-First 前提下，面向漫剧工作室与游戏美术团队提供可选的共享资产缓存、GPU 渲染队列调度与带时间码批注的多人审片同步组件。

---

## 3. 长期架构原则（明确不做的事）

1. **不造封闭黑盒通用游戏引擎**：AI Art Engine 专注成为 Unity、Godot、Unreal、Blender、Spine 与剪映/Premiere 上游最强大的 AI 资产、数值与预演生产力底座，绝不把用户锁定在私有运行时内。
2. **不允许无沙箱任意脚本裸跑**：QuickJS 脚本节点（`script.run`）、HTML5 可玩预览、进程内 Pi Agent `workspace-write` 终端与外部 `SKILL.md` 附带脚本始终遵循严格隔离与用户显式授权门禁。
3. **不用提示词堆砌替代结构化中间层**：分镜表、UI 控件树、Machinations 经济图、时间线轨道与角色圣经始终保持可版本化（Git 友好）、可手动精修、可确定性重放的 JSON 契约。

---

## 4. 历史关键大版本演进摘要

- **`v8.x`（`v8.0` – `v8.9.5`）**：确立「全场景图生万物，全工作区对话直控」架构；落地 102 工具 MCP 服务与零依赖 `ai-art-engine-mcp` 桥接包、多工程工作区与 24h 定时自动化、Machinations v2（59 构造块 + 120fps 贝塞尔曲线反推求解 + 在线试玩场）、21 流派 5 阶漫剧工作台、2 节点 `rea-video` 取证级视频复刻、16 类游戏 UI 拆层 + `ui.atlasCompose` 图集导出、6 轨剪辑台 + 剪映草稿直出、4 频段小波人像精修、2D Spine 舞台与本地 ONNX（YOLO11 / FaceMesh / SAM 2.1 / Matting）+ 跨平台原生离线 OCR。
- **`v6.x` – `v7.x`**：重构可玩 HTML5 程序化游戏管线、引入 Claude Code `SKILL.md` 技能市场与 GitHub 直装审计、统一 3D 网格加工能力矩阵（Meshy / Tripo Rigging、分件、减面、贴图）与 Blender 实时桥接。
- **`v5.0.x`**：集成初代内置离线 DeepSeek Harness（`resources/dsh` + `ELECTRON_RUN_AS_NODE=1`）对话面板、初代内置 MCP 服务、节点失败容错降级与多维媒体质检返工链。
- **`v4.x`**：引入 Cordis 插件化运行时、严格端口类型相等契约、3D 模型生成节点、漫画页排版、广告变体矩阵与分层 PSD 导出。
- **`v1.0` – `v2.0`**：奠定 Electron + Vue 3 + Pinia 桌面架构、Dockview 多面板工作台、本地工程与 `.aipackage` 资产包、Three.js 3D 导演台、多云模型提供商与成片时间线基础底座。
