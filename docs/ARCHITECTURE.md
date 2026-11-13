# AI Art Engine 系统架构说明（v9.0.0）

AI Art Engine（`v9.0.0`）采用类似 Unity Editor 的 **「微内核（Editor Kernel）+ Cordis 插件运行时 + 强类型多模态 DAG 执行层 + 进程内 Pi Agent 9.0 全工作区直控」** 架构，在保持 Electron 严格进程安全隔离的前提下，直接交付可进入商业游戏与影视管线的结构化工程产物。

---

## 1. 进程边界与工作区存储模型

### 1.1 五层进程隔离

| 进程 / 层级              | 源码目录                                                  | 核心职责                                                                                                                                                                                                            |
| :----------------------- | :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Main（主进程）**       | `src/main/` · `src/main/agent/`                           | 进程内 Pi Agent 9.0 运行时（6 槽并发会话、按需懒加载 MCP 引擎、原生双层权限治理）、文件系统原子持久化、工作区与 Git 服务、`127.0.0.1` 102 工具 MCP 服务、Blender TCP 桥、FFmpeg 媒体管线与跨平台原生离线 OCR。      |
| **Preload（类型化桥）**  | `src/preload/index.ts`                                    | Renderer 与 Main 之间唯一的 `contextIsolation` 安全受控桥接（`window.studio`），契约统一声明于 `src/shared/ipc.ts`。                                                                                                |
| **Renderer（工作台）**   | `src/renderer/src/`                                       | Editor Kernel、Dockview 多窗工作台、强类型节点图画布、10+ 全屏 Dive 专业子工作台、Three.js 3D 导演台、AI 对话面板（`ChatPanel.vue`）与技能市场界面。                                                                |
| **Shared（纯逻辑契约）** | `src/shared/`                                             | 零宿主耦合的领域模型、节点图拓扑与执行器、参数自省与 `SmartPatch`、Machinations v2 仿真与逆向求解器、漫剧 21 题材引擎、UI 16 类控件规范、PNG 隐写与剪映草稿编译器。                                                 |
| **隔离工作子进程**       | `src/main/yolo/yoloWorker.ts` · 受控隐藏窗口 / 静默子进程 | ① ONNX Runtime 本地视觉推理运行在独立 `utilityProcess` 中（崩溃可自愈，不阻塞主事件循环）；② 网页图文提取与可玩 HTML5 冒烟门禁运行在受控隐藏窗口中，工作区 `bash` 工具强制 `windowsHide: true` 与进程树级超时清理。 |

### 1.2 多工程工作区（Multi-Project Workspaces）与原子持久化

- **工作区清单（`workspace.json` + 兼容 `project.json`）**：`src/main/repositories/projectRepository.ts` 以明文 JSON 管理工作区元数据（新建默认写入 `workspace.json`，无缝读取旧版 `project.json`），自动维护 `Assets/`、`Output/`、`Thumbnails/` 与 `.aiartengine/{autosave,gen-requests,graph-outputs,thumbs}` 目录树。
- **真实目录 + 旁挂元数据与强引用**：资产落盘规范见 [ASSET_MODEL.md](./ASSET_MODEL.md)，跨文档 GUID 强引用（`{ $type: "AssetRef", guid }`）见 [ASSET_REF.md](./ASSET_REF.md)，跨工作区交付包（`.aipackage`）见 [ASSET_PACKAGE.md](./ASSET_PACKAGE.md)。
- **内嵌工作区文件编辑器与 Git 只读检视**：`src/renderer/src/components/WorkspaceFileEditor.vue` 支持在工作台内直接浏览和编辑工作区源码、配表与配置文本；`src/main/services/gitService.ts` 提供工作区 Git 分支、变更统计与单文件统一 Diff 检视。
- **原子 JSON 与影子自动保存**：`src/main/repositories/jsonFile.ts` 采用临时文件 + `atomicRename` 杜绝半写损坏；`src/main/repositories/autosaveRepository.ts` 将未保存脏态写入 `.aiartengine/autosave`，与 `EditorDocumentService` 的按 Scope 撤销栈及可选定时自动保存协同工作。

---

## 2. Editor Kernel 与 Cordis 扩展运行时

### 2.1 Editor Kernel（`src/renderer/src/editor/kernel/`）

- `selection`：全局唯一选择态真源（统一表达 `asset`、`shot`、`graph node` 等；`workspace` Store 仅暴露只读兼容投影）。
- `commands`：按文档 Scope 严格隔离的 `EditorCommand` 合并与 Undo/Redo 历史栈（不会把 A 画布的撤销误应用到 B 画布）。
- `events`：跨 Feature 解耦的进程内领域事件总线。
- `documents`：宿主标签页聚合子文档 `clean / dirty / saving` 状态机与生命周期管理。

Graph 编辑宿主端口收敛于 `src/renderer/src/features/graph/model/graphEditorHosts.ts`；全屏沉浸视口切换由 `src/renderer/src/composables/useWorkspaceFullscreen.ts` 与 `WorkspaceFullscreenBtn.vue` 统一驱动。

### 2.2 核心注册表与 Cordis 插件体系

- **Renderer 插件运行时**：`src/renderer/src/editor/runtime/`（基于 `@cordisjs/core`）与内部扩展目录 `src/renderer/src/editor/extensions/`（支持贡献 Dock 窗口、Inspector、节点类型、画布 Scope、图策略、卡片、工具栏条目与快捷键命令；外部声明式插件清单经 `src/main/repositories/pluginRepository.ts` 校验 `apiVersion` 与权限，严禁 `eval` 任意外部脚本）。
- **Main 插件运行时**：`src/main/runtime/`（30+ 云端与本地模型提供商 `src/main/plugins/providers.ts`、对象存储 `src/main/plugins/objectStorage.ts`、联网搜索 `src/main/plugins/searchProviders.ts` 均以标准插件挂载）。
- **节点图核心注册表**：
  - 节点类型与端口：`src/shared/graph/registry.ts` · `src/shared/graph/builtins.ts` · `src/shared/graph/ports.ts`（严格同 `dataType` 连线，单复数不互通）
  - 节点原生能力：`src/shared/graph/nodeCapabilities.ts`
  - 画布作用域与策略：`src/shared/graph/scopes.ts` · `src/shared/graph/policy/`
  - 多模态拓扑执行引擎：`src/shared/graph/execute/`（`engine.ts`、`topo.ts`、`lanes.ts`、`film.ts`、`gameNodes.ts`、`uiAtlasCompose.ts`、`layerSplitPrecise.ts`、`portrait.ts`、`semanticTimeline.ts`、`stageLocal.ts`、`scriptSandboxQuickjs.ts` 等）
  - 画布卡片与检查器：`src/renderer/src/graph/cards/registry.ts` · `src/renderer/src/inspector/registry.ts`

节点图扩展开发规范详见 [GRAPH_PLUGINS.md](./GRAPH_PLUGINS.md)。

---

## 3. Agent 原生工作区、按需懒加载引擎与四支柱直控架构

### 3.1 进程内 Pi Agent 9.0（`src/main/agent/`）+ 102 工具 MCP + 24h 定时自动化

- **进程内多协议运行时与 6 槽并发（`src/main/agent/piHarnessService.ts` · `piModelResolver.ts`）**：取代旧版外部 `@deepseek-ai/dsh` 子进程，基于 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai`（`^1.5.2`）直接运行在 Electron 主进程内；原生支持跨 30+ 云端服务商与本地 Ollama/vLLM/LM Studio 的多协议流式调度（`openai-completions` / `anthropic-messages` / `google-generative-ai`）、长参数畸形工具 JSON 状态机自愈（`repairMalformedToolJsonString`）与 `<｜DSML｜function_calls>` 恢复，并提供最高 **6 个跨工程并发会话槽位**（`MAX_PARALLEL_SESSIONS = 6`）与 4 大专业领域子代理（`spawn_subagent`，详见 [PI_AGENT.md](./PI_AGENT.md)）。
- **按需懒加载 MCP 工具集引擎（`src/main/agent/mcpLazyToolsets.ts`）**：每轮默认仅常驻 `24` 个核心工具（`12` 个进程内工作区与协调工具 + `12` 个 `studio_core` 高频 MCP 工具），其余 80+ Studio 工具、9 个 Blender 工具与 `ext:<serverId>` 外部 MCP 服务按 `6` 大语义工具包通过 `load_toolset` 或首轮意图预热（`prewarmForPrompt`）按需挂载；外部大型服务按相关性筛选最多挂载 `32` 个工具，全局严格封顶 `MAX_ACTIVE_TOOLS = 96 < 128` 并支持 LRU 淘汰，从根源杜绝网关 `128` 工具超限报错。
- **原生双层权限治理与无锁原子会话（`src/main/agent/piGovernance.ts` · `piSessionStore.ts`）**：通过 `agent.state.tools` 暴露面过滤与 `beforeToolCall` 双层硬门禁执行 `Craft / Plan / Ask` 权限隔离，支持内存态 `ask_user` 同轮解锁、失败即关闭单次审批卡、盘中实时热切换 `🛡️ 受限模式 / 🔓 完全访问`，以及针对 `.canvas.asset.json` 与 `$DSH_HOME/skills` 的不可逾越结构护栏；会话以无锁原子 JSON（`*.tmp` → `rename`）落盘至 `<userData>/dsh-harness/pi-sessions/`，随时切换任意服务商/模型零文件锁冲突。
- **向左扩展多工程侧栏、24h 定时任务与零 Key 样板间（`ChatPanel.vue` · `chatShowcaseStarters.ts`）**：对话侧栏展开时向左侧画布平滑拓宽（不挤压对话流），内置覆盖全天 `00:00–23:59` 的周期自动化任务与 `schedule_manage` 调度；`buildZeroKeyLiveDemoGraph()` 提供免配置 API Key 的 6 图层仙侠装备 UI + 原生 `TySh` PSD 拆层即时体验样板间。
- **102 工具双向 MCP 服务、零依赖 CLI 与技能市场**：内置 Pi Agent 通过 `callInProcessMcpTool` 内存态零回环直调；对外完整提供 `127.0.0.1:43110`（`/mcp` 93 工具 + `/mcp/blender` 9 工具）与零依赖 `npx -y ai-art-engine-mcp` stdio CLI（`packages/ai-art-engine-mcp`）及 `resources/mcp-bridge.mjs`，并由 `skillMarketService.ts`、`githubSkillInstaller.ts`、`marketPipeline.ts` 与 `claudeSkillRuntime.ts` 统一治理官方技能市场与 GitHub `SKILL.md` 生态（详见 [MCP.md](./MCP.md) 与 [MARKETPLACE.md](./MARKETPLACE.md)）。

### 3.2 四支柱全工作区 AI 直控架构（4-Pillar Universal Workspace Control）

1. **Pillar 1 · 零配置运行时参数自省引擎（`src/shared/graph/introspection.ts`）**
   - `introspectNodeType(typeId)` 与 `introspectNodeInstance(node)` 直接对注册节点的 `defaultParams()` 与实时参数做递归结构反射，自动派生字段树 `fields`、扁平点路径 `flatPaths`、无歧义简写路由表 `shorthandMap` 及预设清单 `presets`。新增节点无需手写 MCP Schema 即可自动被 Agent 发现与调参。
2. **Pillar 2 · 深层点路径与模糊别名自愈补丁（`src/shared/graph/smartPatch.ts`）**
   - `mergeSmartNodeParams(node, patch)` 原生支持任意深度点路径、数组条件选择器（如 `filmStoryboard.shots[index=2].sound`、`filmCast.characters[name=林小满].outfit`）、JSON 字符串透明解包重封（`Unmarshal → Deep Patch → Normalize → Marshal`）以及中英文口语键名/档位词自愈，补丁后自动同步领域归一化与派生提示词。
3. **Pillar 3 · 全图/分组/预设与 3D 舞台统一编辑协议（`src/shared/graph/mcpGraphEdit.ts` & `src/renderer/src/features/director/mcpDirectorStageOps.ts`）**
   - `applyGraphEditOps` 覆盖节点增删改查、端口连线、一键预设、分组框、自动排版与锁定；`mcpDirectorStageOps.ts` 驱动 3D 导演台的对象、56 根人形骨骼、38 种姿态预设、24 种程序化动作片段、灯光环境与 Cinemachine 机位实时操控。
4. **Pillar 4 · 焦点感知上下文总线（`src/renderer/src/editor/control/surfaceRegistry.ts` & `src/renderer/src/features/mcp/buildActiveWorkspaceContext.ts`）**
   - 实时追踪当前活动画布、Dive 下钻栈顶工作台与选中节点，按需将焦点节点的可编辑路径摘要动态注入 Agent 上下文，并通过 `src/renderer/src/features/mcp/mcpGraphLiveCanvas.ts` 与 `mcpTaskRunner.ts` 实现打开态画布热更新与无头自动挂载执行。

---

## 4. 八大旗舰领域子系统与工业交付导出器（v9.0.0）

### 4.1 Machinations v2 游戏经济与机制仿真沙盘（`game.economy` + 在线试玩场）

- **100% 机制对齐与 59 款标准积木**：`src/shared/gameAssets/machinationsV2.ts` 实现 10 类标准图元、8 类状态修饰符、条件/技能门与多色资源池策略；`src/shared/gameAssets/machinationsBuildingBlocks.ts` 内置 59 款经仿真验证的机制积木（抽卡软硬保底、护甲减伤、挂机产线、RPG 成长等），拖入同画布自动重映射变量零冲突拼装。
- **双模无损折叠、在线交互试玩场与 120fps 贝塞尔曲线反推**：`src/renderer/src/components/dive/machinations/MachinationsStudio.vue`（同步配套免安装浏览器端 **Online Machinations Playground**）支持「极简创造 ↔ 专业蓝图」无损互转、零代码 RPG HUD + 技能卡牌试玩台（含 AI 自动观战与同种子操作录制重放），以及折线图 **120fps 零卡顿直接拖拽靶心与 `◆` 贝塞尔斜率控制点逆向配平**（`autoSolveMxCurveTarget` 自动求解上游参数并合成 `k * pow(STEP, p)` 动态步进公式）。
- **多格式交付**：`src/shared/gameAssets/machinationsDiagramSvg.ts` 与 `machinationsV2Export.ts` 一键导出高清矢量 SVG、Mermaid、蒙特卡洛预测 CSV 以及 **Unity C# / Godot 4 GDScript** 运行时经济脚本。

### 4.2 21 题材五阶段 AI 漫剧工作台（`film.workbench` + `asset.screenplay`）

- **21 类漫剧题材基因库**：`src/shared/graph/film/manjuGenres.ts` 内置 `P01–P21` 竖屏漫剧/短剧题材配方（前 3 秒冷开场、爽点推进公式、断章钩子、穿帮红线与专属视觉母题），由 `EditorDiveScreenplayView.vue` 自动向下游 `film.workbench` 传递锁定。
- **五阶段闭环与单镜指纹增量缓存**：`src/shared/graph/film/nodes.ts`、`storyboard.ts` 与 `src/shared/graph/execute/film.ts` 串联 ① 分镜拆解（A 段首帧 + B 段分时段动态拍点）→ ② 11 项连续性与 ≥67% 对白占比审计 → ③ `#variant` 角色/场景/道具/`STYLE01` 锚点定妆与跨集音色绑定 → ④ `@1`–`@4` 锁脸批量生图、3D 白模运镜 `@2` 注入、视觉 QC 自动重拍与 TTS 配音 → ⑤ 爆款封面标题发布包与整集 `.mp4` 合成。

### 4.3 双节点 `rea-video` 视听取证拆解与复刻（`semantic.analyze` → `semantic.rebuild`）

- **四轴逆向取证**：`src/main/services/semanticTimeline/SemanticTimelineService.ts`、`forensics/probeProvenance.ts`（GB 45438-2025 / C2PA 溯源）、`forensics/visualForensics.ts`、`forensics/audioForensics.ts` 与 `entityDetectVlm.ts` 对参考视频做切镜、运镜、花字冻结框、干声分离与角色实体抽取。
- **DP 最优合批与高还原/换品复刻**：`src/main/services/semanticTimeline/rebuildService.ts`、`segmentRebuild.ts` 与 `localRemakeRenderer.ts` 自动净化首帧烧录花字生成干净底板（`clean-plate`），经动态规划编排连续生成单元（`G1..Gk`）与零成本本地推拉运镜（`K1..Kk`），支持对口型、ASS 动态花字还原及并排对比片 `compare.mp4` 直出。

### 4.4 游戏 UI 16 类拆层（`image.layerSplit`）与确定性图集拼装（`ui.atlasCompose`）

- **16 类标准控件识别与精准分层净化**：`src/shared/graph/uiControlSpec.ts` 与 `src/shared/graph/uiPreciseSplit/pipeline.ts` 结合本地离线 OCR（`src/main/services/localOcrService.ts`）、SAM 2.1 与多模态版面解析，自动剥离 16 类控件、估算九宫格切线、采样字芯与描边色彩并修补无字干净底板。
- **零幻觉图集拼装 UI**：`src/shared/graph/execute/uiAtlasCompose.ts` 与 `src/shared/graph/uiComponentLibrary.ts`（`ui.componentLib` → `ui.atlasCompose`）直接用工程内切图 100% 保真原始像素拼装完整游戏界面。
- **原生 `TySh` 可改字 PSD 与多引擎代码导出**：`src/renderer/src/features/graph/model/layerSplitPsd.ts`、`src/renderer/src/features/graph/model/composeImageLayerStack.ts`（及主进程 PSD 合成解码 `src/main/services/psdCompositeService.ts`）导出带二级嵌套分组与原生 Photoshop `TySh` 可双击改字文本层的 `.psd`；`src/shared/graph/uiEngineExport.ts` 同步导出 Unity UI Toolkit（`.uxml/.uss`）、Unity UGUI（C#）、Godot 4（`.tscn`）与响应式 HTML5。

### 4.5 剪映级 6 栏成片时间线与草稿导出（`output.timeline`）

- **双端同源 6 栏创意套件**：`src/shared/graph/timelineCreativePack.ts`、`src/shared/graph/timelineTween.ts`（DOTween 双层关键帧补间）、`src/main/services/vocalSingingService.ts`（TD-PSOLA 时域共振峰保持移调与歌唱合成）与 `src/main/services/timelineExportService.ts` 提供 120+ 特效/转场/电影 LUT/调色/模板的 60fps 实时预览与 FFmpeg 成片渲染。
- **剪映专业版 / CapCut 多轨草稿包导出**：`src/shared/graph/timelineNleExport.ts` 将视频、画中画、配音、音乐、音效与字幕轨编译为微秒级对齐的 `draft_content.json` + `draft_meta_info.json` 并归档本地 `materials/`。

### 4.6 2D Spine 骨骼舞台（`stage.2d`）与四频段小波人像工作台（`image.portrait`）

- **2D 骨骼自动对齐、拆件与 Spine 交付**：`src/shared/gameAssets/stage2dHumanoid.ts`（二次元 Alpha 轮廓形态学 + 本地 YOLO-Pose 关键点融合）、`stage2dAutoPart.ts` 与 `stage2dSpineExport.ts` 一键完成识骨拆件、IK 动作烘焙及标准 Spine 2D（`skeleton.json` + `.atlas`）导出。
- **商业级小波人像精修**：`src/shared/graph/portraitLiveMath.ts`、`src/shared/graph/portraitRetouch.ts`、`src/renderer/src/features/graph/portraitLiveEngine.ts` 与 `src/shared/graph/idPhoto.ts` 实现 4 频段 à-trous 小波保毛孔磨皮、7 大相机/胶片色彩科学、468 点人脸门禁回贴与 10 规格证件照排版（详见 [PORTRAIT.md](./PORTRAIT.md)）。

### 4.7 3D 导演台（`director.stage`）、空间世界与 PNG 即工作流

- **3D 导演台与无头白模预演**：`src/renderer/src/features/director/useDirectorStageScene.ts` 与 `renderOffscreenDirectorPreviz.ts` 支持 56 骨标准人形摆姿、24 款程序化动作片段、38 款全身/手势预设及后台无头录制分镜 `.webm` 白模运镜视频（作为 `@2` 参考视频锁死下游视频运镜）；同时通过 `src/shared/meshOps.ts` 对接云端 3D 绑骨/拆件/重拓扑/贴图及 World Labs 3D 高斯泼溅世界。
- **PNG 即工作流（`src/shared/graph/pngWorkflowCodec.ts`）**：在 PNG `iTXt/tEXt(aiae:graph)` 数据块无损内嵌与提取完整节点图拓扑，拖入画布即可 1:1 复现整条生成管线。

### 4.8 本地 ONNX 视觉与跨平台原生离线 OCR

- `src/main/yolo/yoloService.ts`、`src/main/yolo/ortSession.ts`（自动启用 CUDA / DirectML / CoreML 硬件加速并支持无损回退 CPU）、`src/main/yolo/sam2Infer.ts`、`src/main/yolo/mattingInfer.ts`、`src/main/yolo/faceInfer.ts` 与 `src/main/services/localOcrService.ts`（Windows WinRT / macOS Vision / Linux Tesseract）共同构成零云端成本的本地视觉底座（详见 [ARCH_YOLO_LOCAL.md](./ARCH_YOLO_LOCAL.md)）。

---

## 5. 自动化测试保障

全仓通过 Vitest 守护 Editor Kernel、强类型节点图、Pi Agent 9.0 治理与懒加载工具集、四支柱 AI 直控及各大工业导出器的核心不变量：

- 全工作区节点零配置自省、深层点路径/JSON 透明补丁与焦点上下文注入：`tests/universalWorkspaceControl.test.ts`
- 左窗全态感知与 3D 导演台全量场景/骨骼/灯光/镜头 MCP 操控：`tests/leftWindowPerceptionAndDirectorMcp.test.ts`
- 游戏 UI 16 类拆层、图集确定性拼装、离线 OCR 聚类匹配、原生 `TySh` PSD 导出、PNG 隐写与剪映草稿导出：`tests/imageLayerSplit.test.ts` · `tests/uiAtlasCompose.test.ts` · `tests/blockbusterFeatures.test.ts`

运行全量单测：`npm test`
