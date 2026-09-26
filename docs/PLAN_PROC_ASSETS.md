# 程序化资产生成（AI 对话面板实现）规划

> 状态：草案（已按本轮决策收窄）· 目标版本 6.7.x
> 决策快照：
> ① **只在 AI 对话面板实现**，不新增图节点；
> ② 生成完成后对话里**只有一个「试玩」按钮**，点击直接打开试玩窗口；
> ③ build 成功后**自动在资产库建一个 `gamePlay` 资产**（游戏可留存、可再玩）；
> ④ **删掉既有的 `game.htmlGen` 与 `asset.gamePlay` 两个节点**（放在阶段 4，等对话路径跑通之后再删，见 §10）；
> ⑤ 不导出 GLB / PNG / WAV——程序化资产活在生成的游戏程序里（见附录 A）。
> 外部参考：`riba2534/claude-opus-5-5-demo` 的 `pelican-bike`（本仓 `gamePlayScaffold.ts` 已对齐该工程结构）。

---

## 1. 背景与目标

### 1.1 背景

v6.6 的「可玩 HTML」已经能一句话出可试玩原型（dsh 多轮写纯 Node/esbuild 工程 → 宿主 cook 成单文件 → 沙盒 iframe 试玩），但**只有图节点一个入口**，且提示词把资产写死了：

1. **提示词层面**：3D 专规只有一句「简单几何体即可」，模型于是倾向堆 Box/Sphere，恰好放弃了程序化生成最值钱的部分——Canvas 画贴图、BufferGeometry 造形体、WebAudio 合成音效、种子驱动关卡。这不是模型能力问题，是我们没给它接口。
2. **入口层面**：节点一次性提交，隐藏的 dsh 会话跑完才回来，中途插不上话；而程序化生成天然是「出第一版 → 再暗一点 / 加个跳跃音效 / 换个种子」的迭代活。
3. **呈现层面**：对话流里的产物卡不认可玩 HTML（`ChatAssetPreview` 只认 image / video / audio / model）；而节点路径的产物只能靠**双击节点**进沙盒，删除节点后必须先补一条「资产库试玩」入口。

### 1.2 本轮目标

1. **对话面板里一句话出 3D 游戏**：agent 复用**当前可见会话**落工程 → cook → 对话流里出现一张卡。
2. **卡上只有一个「试玩」按钮**，点击**直接打开试玩窗口**（不经过资产库 / dive / 文件路径）。
3. **美术与音频全部程序化生成**：零 API 计费、秒级出资产、同种子可复现、风格自洽。
4. **游戏可留存**：build 成功后自动建 `gamePlay` 资产，资产库 / 资产编辑器里也能试玩（节点删掉之后这是唯一的长期入口）。
5. **生成质量有兜底**：cook 成功 ≠ 能跑，提供试玩门禁（未捕获异常 / 黑屏）作为可选阶段，把今天的「沙盒黑屏只能靠人眼发现」补上。
6. **收敛入口**：删掉 `game.htmlGen` / `asset.gamePlay` 两个节点，游戏生成从此只有对话一条路（§10）。

### 1.3 明确不做（本轮）

不导出 GLB / PNG / WAV、不做 manifest、不做 hybrid / api 档、不新增图节点。理由与「以后想捡回来怎么做」写在**附录 A**。既有两个节点的删除见 §10（阶段 4）。

---

## 2. 现状与可复用基础

| 能力           | 现有实现                                                                                                                                                                                                | 本轮怎么用                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| dsh 常驻 Agent | `main/services/deepseekHarnessService.ts`（单 worker + `harnessQueue` / `activeWaiters` 队列，`cwd` = 工程根，含 shell / 文件工具）                                                                     | 生成者就是当前对话会话，**不新开 dsh** |
| 工具面         | `main/services/mcpServerService.ts`（45+ 工具）+ `shared/mcpModeAccess.ts`（read / write / generate 分级，按请求头收窄 tools/list）                                                                     | 新增 3 个工具并按 `generate` 分级      |
| 对话产物卡     | **唯一来源是 `McpActivity`**（`shared/ipc.ts` 的 `McpActivityTool` / `McpActivity`）→ `ChatPanel.onMcpActivity` → `pushAsset` → `ChatAssetPreview`；另有 `outputScanService` 兜底扫 `Output/`、`Cache/` | 让 cook 活动出一张卡                   |
| 沙盒试玩       | `components/dive/EditorDiveGamePlayView.vue` + `main/studioGameplayProtocol.ts`（`studio-gameplay://` 特权 scheme + 严格 CSP）+ `shared/gamePlay/prepare.ts`（`prepareGameHtml`）                       | 加第三种入口：按工程相对路径打开       |
| 读工程文件     | `window.studio.readProjectFile`（`features/graph/readGraphRunText.ts` 在用）                                                                                                                            | 按路径读 `dist/single.html`            |
| 工程脚手架     | `main/services/gamePlayScaffold.ts`（`package.json` / `build.mjs` / `index.template.html` / `src/main.js`；3D 加 `three@^0.185`）                                                                       | 加资产层目录与样例                     |
| cook           | `gamePlayDshJobService.buildGamePlayProject`（`npm install` + `node build.mjs` → `dist/single.html`，上限 8MB）                                                                                         | 原样复用，**npm 只由宿主跑**           |
| 技能系统       | dsh 技能（`docs/DEEPSEEK_HARNESS.md` + 设置里的技能面板）；`GAME_PLAY_DSH_SKILL_HINT`（`shared/gamePlayDshJob.ts`）**定义了但无任何消费方**                                                             | 资产层约定做成技能                     |

---

## 3. 目标形态（一次对话长什么样）

```
用户：低多边形太空站走廊里捡能量块，WASD 移动，鼠标转向，捡满 10 个过关；用 Three.js
agent：gameplay_prepare_project（落脚手架）
       写 src/assets/**（程序化贴图 / 形体 / 音效）+ src/game/**（玩法）
       gameplay_build（npm install + build）→ 日志里报单文件体积 → 自动建 gamePlay 资产
       ✅ 可玩 HTML · 低多边形太空站     [▶ 试玩]        ← 卡上只有这一个按钮
用户：[点 ▶ 试玩] → 试玩窗口直接打开，开玩
用户：再暗一点，加个跳跃音效
agent：只改 src/assets/** 与 src/game/** → 重新 build → 卡片与资产一起刷新
```

磁盘与资产：

```
Cache/GamePlayJobs/<jobId>/project/
  package.json  build.mjs  index.template.html
  src/core/{rng,palette,registry}.js
  src/assets/{geometry,texture,material,audio,level}/*.js
  src/game/*.js        src/main.js
  dist/single.html     ← 试玩读它
Assets/…/<游戏名>        ← 自动建的 gamePlay 资产（genParams 指向上面的工程与单文件）
```

**为什么还要建资产**：删除两个节点后，缓存目录是唯一的物理位置，没有资产就等于「关掉这条对话就找不回这个游戏」。资产让游戏可留存、可再玩、可随工程/素材包带走（见 §10 的删除前提）。

---

## 4. 设计

### 4.1 资产层约定（提示词 v2 + 脚手架 + 技能）

**目录约定**（写进技能与 brief，脚手架先落好骨架）：

| 路径                   | 职责                                                      |
| ---------------------- | --------------------------------------------------------- |
| `src/core/rng.js`      | `mulberry32(hash(seed + assetId))`，同种子同形状          |
| `src/core/palette.js`  | 主色 / 辅色 / 材质基调，保证风格自洽                      |
| `src/core/registry.js` | `defineAsset({ id, kind, build(ctx) })` + `listAssets()`  |
| `src/assets/geometry/` | 程序化形体（挤出 / 旋转 / 合并 / 实例化）                 |
| `src/assets/texture/`  | Canvas 2D 画贴图 → `CanvasTexture`（禁止外链图）          |
| `src/assets/audio/`    | WebAudio 合成（Oscillator / Noise + BiquadFilter + 包络） |
| `src/assets/level/`    | 关卡布局（seed + 资产 id 组合）                           |
| `src/game/`            | 玩法、输入、HUD；`src/main.js` 只做装配                   |

**提示词 v2**（`shared/gamePlay/prompts.ts`）：先建资产层再写玩法；禁止把玩法写成几何体堆叠；贴图必须 Canvas 生成而不是纯色 `color`；音效必须合成而不是静音；允许 3–5 个资产的极简玩法兜底，避免过度设计超时。

**技能 `gameplay.procAssets`**：把上述约定 + Canvas 贴图配方 + WebAudio 配方 + 种子规范做成**按需加载**的 dsh 技能，别把几千字塞进系统提示或工具描述。`GAME_PLAY_DSH_SKILL_HINT` 在这里第一次真正落地。

### 4.2 对话工具面（最小三件）

| 工具                       | 等级     | 作用                                                                                                                                                                                                                                                              |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gameplay_prepare_project` | write    | 落宿主脚手架（`package.json` / `build.mjs` / `index.template.html` / `src/core` / `src/assets` 骨架），记 `projectRelativeDir`，返回绝对与相对路径                                                                                                                |
| `gameplay_build`           | generate | cook：`npm install` + `node build.mjs` → `dist/single.html`；**提交后立即返回 `jobId`**，后台跑；成功时**顺带建 `gamePlay` 资产**（名称取游戏标题、`genParams` 写 `gamePlayProjectDir` + `gamePlayBuildHtmlPath`、去重：同工程重复 build 更新既有资产而不是新建） |
| `gameplay_job_status`      | read     | 轮询作业：状态 / 日志尾巴 / 产物相对路径 / **资产 id** / 错误码                                                                                                                                                                                                   |

- **长任务一律「提交 → 轮询」**，沿用本仓 `task_run` / `task_status` / `video_job_*` 的既有形状；不要让一次工具调用挂着等 `npm install`。
- 作业记录放主进程（照 `videoJobService` 的形状），这样「对话面板」与「外部 Agent（Claude Code / Codex 经 stdio 桥 / HTTP 直连）」两条入口天然都能用。
- 沿用既有硬规则并写进工具描述：**agent 不许自己跑 npm / build.mjs**（沙箱里 npm 行为不确定，且宿主 cook 才能保证产物落在约定位置）。
- 系统提示（`deepseekHarnessService` 的 studio 提示块）补一段：有这条路，先 prepare → 写 `src/**` → build → 轮询。
- 同步更新：`shared/mcpModeAccess.ts`（分级）、`docs/MCP.md`、`website/guide-mcp.html` 工具表。

### 4.3 试玩入口（产物卡 → 直接开窗）

四步，都很小：

1. **活动接进卡片**：`shared/ipc.ts` 的 `McpActivityTool` 加 `'gameplay_build'`；cook 终态回 `relativePaths: ['Cache/GamePlayJobs/<id>/project/dist/single.html']`，于是 `ChatPanel.onMcpActivity` 照既有链路出卡。
2. **卡片只渲染一个按钮**：`ChatAssetPreview.vue` 增加「可玩 HTML」判定（`.html` + `<!-- game-mode: -->`，或活动工具是 `gameplay_build`）→ 渲染游戏卡：标题 + 一行模式（2D / 3D）+ **仅一个「试玩」按钮**；不渲染「保存到资产库」、不渲染路径、不渲染源码。
3. **沙盒加第三种入口**：`features/media/gamePlaySandboxDialog.ts` 的 state 增加 `htmlPath`；`EditorDiveGamePlayView.vue` 增加 `htmlPath` prop → `window.studio.readProjectFile(path)` → 既有 `prepareGameHtml` → `publishFrame`（2D/3D 判定与 three 注入全部沿用现成逻辑）。
4. **点击即开窗**：按钮调 `openGamePlaySandboxDialog({ htmlPath, title })`，直接出现试玩窗口（不经资产库、不经 dive）。

### 4.4 资产库试玩入口（删节点后必须有）

节点删掉后，「双击 `asset.gamePlay` 节点进沙盒」（`GraphNodeCard.vue:2386`）这条路就没了，而**资产库 / 资产编辑器目前没有试玩入口**——管线里 `openGamePlaySandboxDialog({ gamePlayAssetId })` 与 `editorDive` 的 `gamePlayAssetId` 参数**都已经预留但没有任何调用方**。所以阶段 4 之前要补：

- 资产库（`AssetBrowser.vue`）对 `gamePlay` 资产：右键菜单 + 双击 → 试玩（调 `openGamePlaySandboxDialog({ gamePlayAssetId })`）。
- 资产编辑器（`AssetEditor.vue`）工具栏对 `gamePlay` 资产加一个「试玩」按钮（同一入口）。
- 复用同一个 `EditorDiveGamePlayView`，不新写播放器。

### 4.5 试玩门禁（可选阶段 3）

同一个隐藏窗口加载 `dist/single.html` → 收 `console-message` / `did-fail-load` / `render-process-gone` → 进程内合成输入 → 采样若干帧判断非纯色 + rAF 计数 → 报告 `{ ok, errors[], blank, fps }`。作为 `gameplay_job_status` 的附加字段回给 agent，让它自己决定要不要再改一轮（**不自动烧轮次**）。

---

## 5. 分阶段计划

| 阶段      | 内容                                                           | 工作量 | 风险                     |
| --------- | -------------------------------------------------------------- | ------ | ------------------------ |
| 0         | 提示词 v2 + 脚手架资产层 + `gameplay.procAssets` 技能          | 0.5d   | 极低                     |
| 1         | 对话工具面（prepare / build / job_status）+ 系统提示 + 文档    | 1–2d   | 低                       |
| 2         | build 后自动建 `gamePlay` 资产 + 试玩入口（卡 + 沙盒第三入口） | 1–2d   | 低                       |
| 3（可选） | 试玩门禁，报告回给 agent                                       | 1–2d   | 中（截图/输入合成时序）  |
| 4         | 资产库试玩入口 + **删除两个节点**（见 §10）                    | 1–2d   | 中（跨 20 个文件的拆除） |

**MVP = 阶段 0–2（约 3 天）**：对话里一句话 → 生成 → cook → 自动建资产 → 卡上「试玩」→ 开窗开玩。
**阶段 4 必须在阶段 0–2 跑通之后再动**：先删节点会让应用在一段时间里**完全没有游戏生成入口**。

### 阶段 0：提示词与脚手架（0.5d）

- `shared/gamePlay/prompts.ts`：3D 系统提示词 v2（资产层优先），保留 `isBuiltinGameHtmlSystemPrompt`「内置词跟随模式切换」语义。
- `shared/gamePlayDshJob.ts`：brief 增加 `## Asset layer` 小节与硬规则（必须 `defineAsset`、贴图 Canvas 生成、音效合成、命名、种子）。
- `main/services/gamePlayScaffold.ts`：加 `src/core/{rng,palette,registry}.js` 与 `src/assets/**` 骨架；3D 样例从「一个旋转的 Box」升级为「注册表 + 两个程序化资产」。
- dsh 技能 `gameplay.procAssets`（新增技能文件 + 引用）。
- 测试：扩展 `tests/gamePlayHtml.test.ts` / `tests/gamePlayDshJob.test.ts`（brief 含资产层规则、脚手架文件清单、提示词 v2 中英都在、技能存在且被引用）。

### 阶段 1：对话工具面（1–2d）

- `main/services/gamePlayJobService.ts`（新）：prepare / build 作业记录与状态机（照 `videoJobService` 形状），日志尾巴截断、错误码 `GRAPH_GAMEPLAY_*`、超时与取消。
- `mcpServerService.ts`：注册三个工具（描述中英双语，含「不要自己跑 npm」与「先生成最小可玩版本」的引导）。
- `shared/mcpModeAccess.ts`：`gameplay_prepare_project` = write，`gameplay_build` = generate，`gameplay_job_status` = read。
- `deepseekHarnessService`：studio 提示块补这段能力说明。
- 文档：`docs/MCP.md` + `website/guide-mcp.html` 工具表。
- 测试：`tests/gamePlayJob.test.ts`（状态机、轮询、日志截断、取消、错误码）+ 工具入参校验 + 模式分级（ask / plan 下不可见 write / generate 工具）。

### 阶段 2：自动建资产 + 试玩入口（1–2d）

- **自动建资产**：`gameplay_build` 成功后在主进程建 `gamePlay` 资产（`asset_create` 同一套落盘/入库管线），`genParams` 写 `gamePlayProjectDir` + `gamePlayBuildHtmlPath` + `gamePlayMode`；同工程重复 build **更新既有资产**（按 `gamePlayProjectDir` 去重），避免每轮迭代都新建一条。作业状态里回 `assetId`。
- `shared/ipc.ts`：`McpActivityTool` 加 `'gameplay_build'`；活动终态带 `relativePaths` 与 `assetId`。
- `main/services/mcpServerService.ts`：cook 终态上报活动（复用既有活动上报路径）。
- `ChatAssetPreview.vue` + `ChatPanel.vue`：可玩 HTML 判定 → 游戏卡（只有一个「试玩」按钮）。
- `features/media/gamePlaySandboxDialog.ts` + `EditorDiveGamePlayView.vue`：`htmlPath` 第三入口。
- 测试：`tests/chatGameplayCard.test.ts`（可玩 HTML 判定、卡上只有一个按钮的源码不变量、按钮调 `openGamePlaySandboxDialog({ htmlPath })`）+ 沙盒第三入口的单测（`readProjectFile` → `prepareGameHtml` 分支）+ 资产去重（同工程二次 build 不新建）。

### 阶段 3（可选）：试玩门禁（1–2d）

- `main/services/gamePlaySmokeService.ts`（新）：隐藏窗口加载单文件、错误采集、合成输入、帧采样。
- `gameplay_job_status` 增字段 `smoke`（`off` 时不跑）；不做自动修复轮。
- 测试：报告解析、`off` 时不执行、失败不影响已产出的 `dist/single.html`。

### 阶段 4：资产库试玩入口 + 删除两个节点（1–2d）

先补入口（§4.4），再删节点（清单与前置条件见 §10），顺序不能反。

---

## 6. 关键设计决策

| #   | 决策                                                        | 理由 / 取舍                                                                                                                                                                                   |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **只在对话面板实现，不做图节点**                            | 程序化生成是迭代活，人在环里价值最大；对话还免去「节点另开 dsh 会话」与**单 worker 队列争用**（`harnessQueue`），并且顺带把能力开放给外部 Agent（MCP 一旦存在，Claude Code / Codex 也能驱动） |
| D2  | **不导出 GLB / PNG / WAV**                                  | 用户要的交付物是「能玩」；程序化资产的价值在代码里（改一个种子整批换），导出会引入 `GLTFExporter` 保真度、AudioWorklet 不可离线等一堆限制，还要多一张资产卡，与「卡上只有一个按钮」直接冲突   |
| D3  | **卡上只有一个「试玩」按钮**                                | 少即是快：不渲染入库 / 路径 / 源码按钮，用户在意的是画面能不能跑                                                                                                                              |
| D4  | 三个工具（prepare / build / status），长任务「提交 + 轮询」 | 对齐仓内既有形状（`task_run` / `video_job_*`）；避免一次工具调用挂分钟级                                                                                                                      |
| D5  | npm / build 只由宿主执行                                    | 与既有 brief 的禁止项一致；沙箱里 npm 行为不确定，且产物必须落在约定位置                                                                                                                      |
| D6  | 生成者 = 当前对话会话                                       | 不新开 dsh；用户随时插话改需求，也避免嵌套会话                                                                                                                                                |
| D7  | 资产层约定走**技能**而不是系统提示                          | dsh 技能按需加载，系统提示已经被 studio 工具说明占满；`GAME_PLAY_DSH_SKILL_HINT` 正好是为此预留的                                                                                             |
| D8  | 生成代码仍在受限环境执行                                    | 试玩走既有 `studio-gameplay://` 特权 scheme + CSP（`connect-src 'none'` 不放宽）；拒绝「为了预览把 CSP 放宽」的捷径                                                                           |

---

## 7. 验证与验收（DoD）

- **不回归**：既有全量测试、typecheck（node + web）、CJK 门禁、prettier 全绿。
- **新增单测**：`gamePlayJob`、工具入参与模式分级、可玩 HTML 判定与卡片单按钮不变量、沙盒第三入口与 `htmlPath`、资产去重、节点删除后的引用完整性（`graph_node_types` 不再列这两个 typeId、预设/模板/政策表无残留）。
- **端到端手工验收（对话路径）**：
  1. 对话里说一句 3D 玩法 → agent 落工程 → build 成功；对话流出现一张游戏卡，**卡上只有一个「试玩」按钮**。
  2. 点按钮 → 试玩窗口**直接打开**并能玩（WASD / 鼠标生效，≥30 FPS 观感）。
  3. 追一句「加个跳跃音效 / 再暗一点」→ agent 只改 `src/assets/**`、`src/game/**` 后重新 build，卡片刷新、资产更新（**不新增重复资产**），再点仍能玩。
  4. 不说「Three.js」时也能从 brief 里认出该做 3D（提示词 v2 生效）。
  5. `gameplay_job_status` 在 build 失败时能给出可读原因（npm 缺失 / 语法错误 / 体积超限）。
- **端到端手工验收（阶段 4 之后）**：6. 资产库里找到自动建的游戏资产 → 能试玩；关掉工程重开仍在。7. 画布右键菜单里不再有「可玩 HTML 生成 / 可玩 HTML」，`graph_node_types` 也不返回它们；旧工程里若已有这两个节点，打开时**不崩**（见 §10 的兼容项）。
- **不变式**：`dist/single.html` 仍 ≤8MB；`studio-gameplay` CSP 不放宽；资产库只多出「用户真正生成过的游戏」这一类条目。

---

## 8. 风险与限制（诚实清单）

1. **需要本机 npm**：cook 依赖本机 Node/npm（既有约束，非本规划引入），失败时靠 `gameplay_job_status` 给出可读原因。
2. **生成质量方差**：靠提示词 v2 + 技能 + （可选）门禁收敛，不保证任意 brief 一次到位；极端 brief 仍可能超时（既有 1h 上限）。
3. **一轮时长**：`npm install` + build 是分钟级，靠「提交 + 轮询 + 面板停止按钮」化解；用户要习惯「等一会儿」。
4. **黑屏 / 着色器报错**：门禁是**可选**阶段，不做时仍可能出现手册 FAQ 里那条「不保证任意着色器一次通过」。
5. **工具面膨胀**：新增 3 个工具会进入所有模式的 `tools/list`，Ask / Plan 下必须靠 `mcpModeAccess` 收窄；系统提示要写清「什么时候用」，否则模型容易乱调。
6. **工程仍在 `Cache/`**：资产让游戏「可找回」，但工程本体与 `dist/single.html` 仍在缓存目录（既有约定：对话产物不搬进 `Assets/`），清理缓存会导致资产指向的路径失效——所以资产重建入口要友好（试玩失败时提示重新 build）。
7. **删节点会砍掉三种能力**（见 §10）：批量/工作流、同图参考图链路、无 dsh 时的样例兜底。用户已确认接受。

---

## 9. 待确认（两条）

1. **要不要「生成完自动弹窗」**？现在是「点卡片上的试玩按钮打开」；若你要生成完立刻弹窗，我按自动开一次处理（会打断对话流，需你点头）。
2. **试玩门禁（阶段 3）要不要**？它不做 UI，只把「黑屏 / 未捕获异常」的报告回给 agent 让它自己决定改不改。

---

## 10. 删除既有两个节点（阶段 4）——**已完成**

> 落地情况：阶段 0–4 全部实现（含「试玩交给系统默认程序打开」这一变更）。本节保留为**删除依据与兼容决策记录**；
> 实际删法与本节最初的设想有两处偏差，已在下面灰字标注。

**目标**：`game.htmlGen`（可玩 HTML 生成）与 `asset.gamePlay`（可玩 HTML 资产）从节点图里消失；游戏生成只剩对话一条路，游戏本身以 `gamePlay` **资产**（不是节点）形式留存。

### 10.1 前置条件（顺序不能反）

1. 阶段 0–2 跑通：对话里能 prepare → 写 `src/**` → build → 自动建资产 → 卡上「试玩」开窗；
2. §4.4 的**资产库 / 资产编辑器试玩入口**已补（否则删了节点就没有任何地方能玩到已建资产）。

### 10.2 删除清单（按文件，全部已核对过引用）

| 文件                                                                                                                                           | 动作                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/graph/builtins.ts`                                                                                                                     | 删 `game.htmlGen` 节点定义；删资产元数据里 `type: 'gamePlay'` 那一项（连带 `defaultParams` / `execute` / `contributeToGeneration` 里的 gamePlay 分支），`asset.gamePlay` 节点类型随之消失                                                                                                                       |
| `shared/graph/execute/gameHtmlGen.ts`、`execute/gamePlay.ts`                                                                                   | 删文件 + 从 `execute/index.ts` 摘掉导出                                                                                                                                                                                                                                                                         |
| `shared/graph/execute/context.ts`                                                                                                              | 删 `gameHtmlGen` 的 presetKind 映射与 `buildGameHtmlSystemPrompt` / `buildGameHtmlUserPrompt`（这两个是**图内指令对话框**用的，对话路径由 agent 自己组 brief）                                                                                                                                                  |
| `shared/graph/execute/helpers.ts`                                                                                                              | 删 `game.htmlGen` 的 `project` 值分支                                                                                                                                                                                                                                                                           |
| `shared/graph/execute/types.ts` + `engine.ts` + 后台任务派发                                                                                   | 删 `NodeExecuteContext.runGamePlayDshJob` / `buildGamePlayProject` 注入（对话路径不再经图执行）                                                                                                                                                                                                                 |
| `shared/graph/aiWorkflowPresets.ts`                                                                                                            | 删「一句话小游戏」一键工作流预设（没有节点可编排）                                                                                                                                                                                                                                                              |
| `shared/graph/defaultGraph.ts`                                                                                                                 | 删 `gamePlayProcessingTemplate()` 与 `workflow` 里的 gamePlay 分支（新建 gamePlay 资产的内图不再自动放节点）                                                                                                                                                                                                    |
| `shared/graph/textOutput.ts`                                                                                                                   | 删 `asset.gamePlay` 的大 HTML 排除分支（节点没了即死代码；资产参数侧的保护另议）                                                                                                                                                                                                                                |
| `renderer/inspector/builtins.ts` + `components/GameHtmlGenInspector.vue`                                                                       | 删 inspector 注册与组件                                                                                                                                                                                                                                                                                         |
| `renderer/components/GraphNodeCard.vue`                                                                                                        | 删 `game.htmlGen` 的指令框分支（925）与双击分支（2405）、`asset.gamePlay` 的卡面分支（1625）与双击进沙盒分支（2386）                                                                                                                                                                                            |
| `renderer/components/dive/EditorDiveInstructionView.vue`                                                                                       | 删 `case 'game.htmlGen'`                                                                                                                                                                                                                                                                                        |
| `renderer/components/NodeGraphEditor.vue`                                                                                                      | `game` 分组 typeIds 去掉这两个（保留 `asset.gameSystem` / `ui.split` / `ui.gen`）                                                                                                                                                                                                                               |
| `renderer/features/graph/model/runGamePlayDshJob.ts`                                                                                           | 删（仅节点路径在用）                                                                                                                                                                                                                                                                                            |
| `shared/gamePlayDshJob.ts` + `main/services/gamePlayDshJobService.ts`                                                                          | **保留**：`writeNodeGamePlayScaffold` + `buildGamePlayProject` + `inlineDistToSingleHtml` 被新的 `gamePlayJobService` 复用；只删「dsh 作业契约」部分（`buildGamePlayJobBrief` / `buildGamePlayJobTask` / `validateGamePlayJobDelivered` / `result.json` 机制）与 `GAME_PLAY_DSH_SKILL_HINT`（改由技能 id 承担） |
| `shared/gamePlay/*`、`main/studioGameplayProtocol.ts`、`components/dive/EditorDiveGamePlayView.vue`、`features/media/gamePlaySandboxDialog.ts` | **保留**（试玩链路的核心）                                                                                                                                                                                                                                                                                      |
| i18n（`zh-CN` / `en-US`）                                                                                                                      | 删 `studio.graph.gameHtmlGen.*`、`graph.types.game.htmlGen` 等节点文案；`studio.dive.gamePlay.*`（沙盒UI）保留                                                                                                                                                                                                  |
| 测试                                                                                                                                           | 改写 `tests/assetEditorGraph.test.ts`（默认 gamePlay 图不再含节点）、`graphGenerateNodes.test.ts` / `graphPolicy.test.ts`（节点清单去掉两项）、`graphTextOutput.test.ts`（删该分支用例）；`gamePlayHtml` / `gamePlayDshJob` / `gamePlayScaffold` 相关保留                                                       |
| 文档                                                                                                                                           | `website/guide-gameplay.html` / `.en.html` **整篇改写**为对话流程（现全文是节点链路教程）；`docs/ROADMAP.md`、`README` 里提到「可玩 HTML 节点」的措辞同步                                                                                                                                                       |

### 10.3 旧工程兼容（必须做，否则等于给用户埋雷）

读了装载链路后结论很明确：**两个节点的"删除"方式不能一样**。证据是 `shared/graph/registry.ts` 的 `inferNodeTypeId`：类型不在注册表时按 `category` / `assetType` 兜底推断——

- `category === 'note'` → 回落到 **`note.text`（备注）**；
- `category === 'output'` → `output.<kind>`；
- 其余 → `asset.${assetType ?? 'image'}`。

于是：

| 节点                                 | 硬删类型会怎样                                                                                                                                              | 建议做法                                                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game.htmlGen`（`category: 'note'`） | 旧图里的节点**静默变成「备注」**，params（含指令文本）保留、边被 `sanitizeEdges` 丢掉，不崩但语义漂移                                                       | **硬删类型** + 在 `normalize.ts` 写一条**显式迁移**（`game.htmlGen` → `note.text`，保留标题与指令文本并补一句说明），把隐式兜底变成有意为之                                                          |
| `asset.gamePlay`                     | `inferNodeTypeId` 会推回 `asset.gamePlay`（由 `assetType` 派生）→ 类型仍不存在 → 节点带着未知 def 留在图里，渲染/连线行为不可控；而游戏本体没有替代节点可迁 | **保留类型注册，但 `addable: false`**：从右键分组与 MCP `graph_node_types` 自动消失（该工具走 `listAddableNodeTypes`，且对不可添加类型已有「存在但不可添加」的友好提示），旧图照常显示、照常双击试玩 |

也就是说：**对用户可见的「节点」消失（加不出来、菜单里没有、Agent 也看不到），但旧工程不丢数据**。保留的那点内部类型定义（`asset.gamePlay` + `executeGamePlayAssetNode`）是兼容层，不是功能入口——不再给它加任何能力，等旧工程自然淘汰后再硬删。

**实际落地的两处偏差（记录在案，免得后来者按本表核对时困惑）**：

1. **`asset.gamePlay` 的卡面与双击分支没有删**（表中「GraphNodeCard 删 `asset.gamePlay` 卡面分支（1625）与双击进沙盒分支（2386）」作废）：既然类型保留了兼容层，旧图里的节点就该照常显示、照常双击试玩——删掉分支反而会让旧工程变成"看得见点不动"。
2. **`textOutput.ts` 的 gamePlay 排除分支保留**：节点类型仍在（旧资产里仍可能存着整页 `gamePlayHtml`），这条保护不是死代码。
3. 迁移实现放在 `hydrateNode` 的**最前面**（`migrateRetiredGameHtmlGenNode`），而不是 `finalizeGraph`：类型已从注册表移除，`inferNodeTypeId` 会先把 `typeId` 换成 `note.text`，放到后面就再也认不出被下线的节点了（第一次实现就踩了这个坑，由新测试 `tests/graphGamePlayRetire.test.ts` 钉住）。
4. 迁移时**删除**游戏专属参数（`gamePlayHtml` / `gamePlayProjectDir` / `gamePlayMode` / `generateInstruction`），而不是留空串——备注节点不该拖着无用键；玩法需求原文落到 `params.text`。

### 10.4 删除后失去的能力（已知账）

1. **批量 / 工作流**：不能再把游戏生成嵌进一键工作流或后台批量（「一句话小游戏」预设一并下线）；
2. **同图参考图链路**：`in-image` 那种「同图设定图 → 风格一致的游戏」没了（对话里靠 @引用 / 粘贴图片替代）；
3. **无 dsh 兜底**：节点路径在没配模型密钥时会退化成样例工程，对话路径没有这个降级（agent 就是生成者）。

---

## 附录 A：本轮明确排除（保留分析，后续可再议）

以下都在上一版规划里，本轮按「只在对话实现 + 只留试玩」裁掉。想要时按此顺序捡回：

| 排除项                                     | 当时的价值                                                 | 捡回的成本                                                                |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| 烘焙 GLB / PNG / WAV + `manifest.json`     | 把程序化资产变成工程资产，能被节点图 / 导演台 / 时间线复用 | 中：需隐藏窗口 + `studio-bake` scheme + `src/bake.js`；限制见下           |
| 资产卡与入库                               | 产物可直接进资产库                                         | 小：给活动加路径 + 卡上加入库按钮（与"只有一个按钮"冲突，需先改这条决策） |
| 图节点 `game.bakeAssets` / `asset.procGen` | 批量、可复现、可嵌进一键工作流                             | 中：服务已存在时只是薄壳 + Inspector                                      |
| `hybrid` / `api` 档                        | hero 资产走付费接口换质量                                  | 中：需体积预算与计费提示                                                  |
| 试玩门禁                                   | 抓黑屏 / 未捕获异常                                        | 已降级为可选阶段 3                                                        |

排除的硬理由（记账用）：

- `GLTFExporter` 只认标准材质，自定义 shader 导不出（会变白模），`InstancedMesh` 会被展开导致面数暴涨；
- `AudioWorklet` 无法离线烘焙（`OfflineAudioContext` 覆盖不到需要真实音频回调的节点）；
- 导出还要处理隐藏窗口 WebGL 可用性、单文件 8MB 上限与「塞进游戏本体就卡」的历史教训（已修过一次拖拽卡顿）。
