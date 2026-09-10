# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。版本号以 [`package.json`](./package.json) 为准；发版时打 `vX.Y.Z` tag，由 GitHub Actions 构建并上传安装包。预发布（如 `4.0.0-alpha.0`）会标为 GitHub prerelease，**不会**作为 `latest` 推给 3.x 稳定版自动更新。

## [Unreleased] — 5.2 智能创作版（进行中）

### Added

- **MCP 运行的工作流产物自动进入 AI 对话流（GIF / 拼版 / 成片直接出预览卡）**：此前只有 `generate_*` 这类同步生成工具会把落盘产物以预览卡追加到对话里；`task_run` 跑工作流的产物（`anim.2d` 的 `out-gif` 动图、`stage.2d` 的 `out-sheet` 拼版、输出节点成片）虽然写进了 `runStates` 与节点参数，但对话流没有任何读取通道，结果只能自己回图编辑器 / 素材库找。现在打通这条回路：`task_run` 受理即在主进程登记为旁路活动（`McpActivityTool` 新增 `task_run`，任务列表「MCP 生成」与执行日志同步可见），渲染层在任务终态后从任务图与 `runStates` 收集本轮「作品级」产物相对路径（新共享纯函数 `collectRunMediaPaths`：优先 `out-gif` / `out-sheet` / 输出节点成片末条，逐帧序列端口跳过、仅在完全没有作品级产物时才以单件末条兜底，按顺序去重并限 6 条防批量产物刷屏），随 `reportMcpTask` 终态回报新增的 `relativePaths` 回传；主进程把路径写进活动（`McpActivity.relativePath` 保留首条兼容单产物消费方，新增 `relativePaths` 承载完整清单），对话流据此逐条出预览卡（GIF 本就在图片白名单内，`<img>` 自动播放；多产物按 `asset:<id>:<i>` 各自去重，重复的延迟回调原地更新不重复插卡）。收集前先等任务写回完成（`waitForTaskIds`，30s 超时兜底），保证拿到的是物化后的相对路径而不是 dataUrl；受理失败 / 停止等异常路径同样收尾活动，避免活动一直挂在「运行中」。7 项单测锁定收集口径（GIF 优先且跳过逐帧 / 拼版 / 成片末条 / 无作品级时兜底 / 已有作品级不兜底 / 去重截断 / 未物化不收）
- **2D 舞台「动作帧序列 / sheet」成为节点产物（Agent / 工作流可直接取用）**：2D 骨骼编辑器的「导出序列帧」此前只能在弹窗里手动导出，是渲染层局部能力。现在同一套逐帧合成与拼版接进节点执行器：`stage.2d` 节点设 `stage2dAnimFps`（6 / 8 / 10 / 12 / 15 / 24，0 = 关闭，默认关闭）并带自定义动作（`stage2dAction`）时，运行节点即按该帧率采样动作逐帧合成透明 PNG，并从两个新端口输出——`out-frames`（逐帧帧序列图库，与单帧舞台图分开，避免下游「收集上游图片」把整套动作帧当素材序列吃掉）与 `out-sheet`（一张自适应拼版 PNG），同时全部落盘为工程图片资产、帧数 / sheet 路径 / 逐帧路径写回节点参数（`stage2dAnimFrameCount` / `stage2dAnimSheetRelativePath` / `stage2dAnimFramePaths`）；帧率为 0、无自定义动作或无骨骼装配时保持「只出单帧舞台图」的原行为，单帧合成或落盘失败只跳过该帧、绝不牵连整轮 cook（与动图 GIF 产物同一容错口径）。帧时刻表与编辑器导出同口径（帧数 = round(时长 × 帧率)，**不含终点**，循环动作首尾天然无缝），收敛为纯函数 `buildStage2dFrameTimes` 单一来源，超长动作夹到 240 帧上限防爆。弹窗导出区新增「帧率会写入节点、运行即产出帧序列 + sheet」说明与「最近一次运行产出 N 帧 + sheet（路径）」回显，且手动导出的帧率会写回节点，手动导出与节点产物保持同一档；`graph_node_types` 能力说明同步点出 `stage2dAnimFps` 语义，Agent 可自行发现；新增 7 项单测（帧率归一化 / 帧时刻表边界 / 执行器端到端产出端口值 + 节点参数 + 落盘次数）
- **AI 对话里的 Git 变更预览（文件清单 + 行级 diff，全程只读）**：agent 在工程里改完文件后，此前只能自己去 git 客户端翻看改了什么。现在每轮运行结束会自动在对话中追加一张「变更预览」卡：列出这一轮真正被改动的文件（新增 / 修改 / 删除 / 重命名 / 复制 / 未跟踪 / 冲突徽标 + 逐文件 +N/-M 行数），点开文件才按需拉取该文件的统一 diff 并逐行染色（新增绿 / 删除红 / hunk 蓝），支持刷新重采与折叠，随会话持久化（diff 不落 localStorage，展开时现取）。去重基于内容指纹：发送前静默记录基线指纹，运行结束时只筛指纹变化的文件，因此一轮最多一张卡、上一轮展示过且未再改动的文件不会重复刷屏；未跟踪文件由主进程读全文合成「新文件全新增」diff，二进制与超大 diff 分别给出提示。实现：主进程新增只读 `gitService`（`rev-parse` / `status --porcelain=v1 -z` / `diff --numstat` / `diff -U3`，`execFile` 直调不经 shell、路径二次 resolve 不可越出工程、`core.quotepath=false` 保证中文路径可读、`GIT_TERMINAL_PROMPT=0` + `GIT_OPTIONAL_LOCKS=0` 不弹凭据不抢锁），找不到 git / 不在仓库内 / 命令失败一律降级为 `reason` 返回而不抛异常（预览失败绝不打断对话）；新增 `git:status` / `git:file-diff` 两个 IPC 与 `StudioApi.getGitStatus` / `getGitFileDiff`；格式解析全部收敛到 `src/shared/git.ts` 纯函数（porcelain -z 的 rename 双字段、numstat 的 `{old => new}` 折叠路径、`+++` 头不被误判为新增行、未跟踪 diff 合成、相对路径越界校验），11 项单测覆盖
- **2D 帧动画运行即产出 GIF（MCP / 工作流也能拿到动图产物）**：GIF 合成此前只存在于检查器的「导出 GIF」按钮里（UI 动作），`graph_edit` / `task_run` 等 MCP 链路无法触及——外部 Agent 拿不到动图。现在 `anim.2d` 新增 `animGifFps` 参数（0 = 关闭，默认关闭以保持原有「只切帧」行为与耗时；上限 24fps）与 `out-gif` 输出端口：运行切帧后把逐帧 PNG（含「特效透明化」键控结果）交给新上下文能力 `composeGifFrames`（渲染层复用既有 `composeAnim2dGif`，零改动）合成动图，经 `saveRunMedia` 以 `image/gif` 落盘为工程图片资产（默认随节点输出目录配置，素材库自动可搜），并把 `animGifRelativePath` / 帧数 / 尺寸写回节点参数（检查器展示「已输出 GIF：{路径}（{N} 帧 @ {fps} fps）」）；帧率为 0、帧数不足 2 帧或渲染层未注入能力时不产出，既有链路行为不变。接线：`NodeExecuteContext` / `GraphRunOptions` 新增 `composeGifFrames`，任务商店 `graphTasks`（后台 cook / MCP）与前台运行会话 `useGraphRunSession` 两处注入，`task_run` 因此同源生效；检查器新增「运行输出 GIF」帧率下拉；`NodeTypeDefinition` 新增可选 `description` 并随 `graph_node_types` 返回，外部 Agent 可自发现 `animGifFps` 语义而无需猜参数名；3 项执行器单测锁定「开启 → 产出 out-gif 且落盘」「关闭 → 纯切帧」「未注入能力 → 不产出」
- **2D 序列动画 GIF 导出（`anim.2d` 从「只能逐帧看」到「可直接交付动图」）**：检查器的动画预览此前只有播放 / 帧率 / 循环 / 帧格，产物只能以 PNG 序列交付——新增「导出 GIF」按钮：用预览同一份切帧结果（含「特效透明化」的键控透明）按当前帧率合成动图，循环开关决定无限循环还是播放一次，透明背景原样保留（GIF 为单透明索引），落盘为工程图片资产（默认 `Assets/2D`，随节点输出目录配置）并自动刷新素材库；实现为零依赖纯 TS 编码器 `shared/media/gifEncode`——自研 GIF89a 写入（全局颜色表 / NETSCAPE 循环扩展 / 图形控制扩展 / LZW 码流与数据子块打包）配合跨帧中位切分量化（索引 0 固定留给透明色、5 位/通道最近色缓存查表），主进程落盘侧已有 `image/gif` → `.gif` 资产类型与媒体解码支持，故不新增任何运行时依赖（与 jpeg-js / pngjs 的既有取舍一致）；渲染层 `composeAnim2dGif` 负责逐帧解码、等比缩放（上限 512 控制体积与耗时）与 RGBA 采样；13 项单测内置 GIF 解析器与 LZW 解码器做逐码往返验证（覆盖 256 色随机大图的码长增长与字典写满重置、高重复图案的长字典链、多帧共用全局调色板互不串码、透明索引与入参校验）

- **MCP 单枚图标精修回炉工具 `graph_icon_refine`（图标包链路「某一枚画糊了」远程回炉）**：此前「整版图标表 → `image.gridSplit` 切格 → `image.iconPack` 打包」链路的逐枚精修（`iconRefine`）只有 dive 弹窗里的「重画这一枚」按钮，外部 Agent / MCP 无法触及——只能在图里手工删格重跑或整版重生成。新增工具：`assetId` + `splitNodeId` + `cellKey`（如 `1-1`）定位某一枚，`hint` 说明不满意点（或 `prompt` 直接给指令）→ 按整版画风重画这一枚方形图标卡片 → 写回同源打包节点的逐枚覆盖 `iconPackCellRefines` → 默认重跑打包节点、用精修图顶替该格 PNG（`repack: false` 可只写回）；返回 `cellKey` / 该枚名字 / `packNodeId` / 实际使用的指令 / `repacked`。实现上把弹窗的精修链路抽成共享执行器 `runIconRefine`（渲染层），弹窗与 MCP **共用同一实现**，不再有两套口径：上下文与指令来自既有纯逻辑（`resolveIconRefineContext` / `buildIconRefineInstruction`），整版源图解析复用 `resolveNodeUpstreamImageUrl`（与编辑弹窗源图逻辑对齐），单格裁切复用 `composeImageGridCell`（`edgeInset: 'auto'`，与打包同一 canvas 口），生成模型 / 服务实例克隆上游整版节点保证画风一致；写回新增共享纯函数 `withIconPackCellRefine`（不可变、只动本格、经 `normalizeIconPackCellRefines` 归一化，3 项单测覆盖）；MCP 侧经新增 IPC 信道 `MCP_GRAPH_ICON_REFINE`（渲染层执行生图 + 打包，10 分钟轮询预算）回报，`graph_edit` 同款「编辑器打开时拒绝写入」保护同样适用；打包重跑用任务商店 `invalidatedNodeIds` 禁用该节点旧 done 结果，避免复用缓存导致精修图不生效；外部 Agent 调用期间应用内可见活动——主进程登记 `McpActivity`（新工具类型 `graph_icon_refine`），任务按钮角标与任务列表「MCP 生成」区出现运行中条目（终态后归档到近期列表并给出资产路径），执行日志同步生成 `MCP graph_icon_refine` 会话、素材库资产卡片显示旋转角标（`begin` 新增可选 `assetId`：运行中即可定位资产——精修要求该图编辑器关闭，卡片角标是应用里唯一能直接看到「这一枚正在被重画」的地方；同一位置角标 MCP 活动优先于视频打点态，列表视图在资产名左侧显示旋转圆点）；`McpActivity` 新增 `detail` 字段（界面副行优先于 `model` 展示，这里用于显示「修正：…」或「按整版画风重画这一枚」）
- **MCP 节点类型清单工具 `graph_node_types`（外部 Agent 自发现可建节点）**：此前 MCP 只有 `graph_edit`（`node_upsert` 传 typeId）与 `graph_read`（读已落盘图），Agent 想知道「这张图能加哪些节点 / 新节点叫什么类型」只能靠猜或试探——猜错的 typeId 会被 graph_edit 跳过并记入 warnings。新增只读工具 `graph_node_types`：列出**与 graph_edit 的 `node_upsert` 校验同一白名单**的节点类型（清单取自共享常量 `MCP_GRAPH_EDIT_SCOPE` = 宿主资产子图 + `listAddableNodeTypes`，两者永不脱钩），每项含 `typeId` / 名称 / 分类 / 资产类型 / 端口（连线 `fromPort` / `toPort` 用的 id、方向、数据类型、是否多连）；`includeParams: true` 附带默认参数作为 `node_upsert` 的 `params` 起点，`typeId` 精确查单类型且对「不存在」与「存在但不可添加（输出 / 边界节点）」分别给出可区分的提示；新增节点类型（如 `stage.2d` / `image.gridSplit` / `image.iconPack`）随注册自动进入清单，无需改工具代码；契约单测锁定「清单内类型 graph_edit 全部能建、清单外被跳过」（对应 `tests/mcpGraphEdit.test.ts`）
- **Spine 骨架包导出（5.4「Spine 骨骼拆件与装配数据」导出侧 / 5.5「骨骼装配与摆姿」Spine 导出待办句落地）**：stage.2d 编辑器「骨骼」页新增「Spine 骨架包」导出——把挂到关节的可见部件层按放置计划从源图裁出实际绘制主体、缩放到部件页尺寸成独立透明 PNG 页；共享纯函数层 `shared/gameAssets/stage2dSpineExport` 做全部几何换算（root 骨承载舞台根锚点、y-down→y-up 翻转即局部 y 取反 / 旋转取反并入 setup pose、位图不翻转、每挂点生成 attach 子骨承载偏移与部件旋转、ground 锚点=图像底边中点故 region 中心上移半高、部件名安全化与槽名去重），输出 Spine 3.8 `skeleton.json`（bones / slots / skins region）+ `.atlas`（每部件一页）；渲染层 `composeStage2dSpineExport` 像素拼装与纯函数共用同一放置计划口径（12 项几何单测）；部件页落 `Assets/2D/Spine/<包名>/` 工程媒体自动入库，skeleton.json 与 .atlas 同目录写工程文件，供 Spine 编辑器 / 引擎直接导入。立绘自动拆件（剥层切分半自动工具）仍待办
- **2D 动作资产独立试播宿主（5.5「动作资产独立预览宿主」落地为素材库浮窗）**：素材库双击 2D 动作资产或右键「🏃 试播 2D 动作」即开全局浮窗（复用 StudioFloatingWindow）——直接用动作资产自带的装配快照 + 动作帧实时 FK 骨架试播：播放 / 暂停 / 停止、进度拖拽即时采样、循环 / 单次随动作数据、静态自适视口（绑定位 ∪ 全部关键帧取景，播放不跳框）；空帧 / 单帧定格 / 无装配分别给出「先回 2D 骨骼编辑器补帧再存」「不可循环」「无装配」引导文案，正常资产提示可在其他 2D 骨骼节点编辑器「📥 载入素材库」选中即载回精修（骨架用与 2D 骨骼编辑器同源的 `computeStage2dRigTransforms` / `sampleStage2dAction` 纯函数，观感与编辑/导出一致）
- **2D 动作资产容器（5.5「导出与资产出口」动作资产落地）**：素材库新增数据型资产类型 `motion2d`（双语命名「2D 动作」/ 图标 / 工具栏「新建 2D 动作」，主进程 createAsset 自动播种标准人形装配 + 空动作包）；动作资产包 `shared/gameAssets/stage2dActionAsset` 纯函数层把「动作 + 创作装配快照」归一化为可入库纯 JSON（含 pack / unpack / 容错单测）；stage.2d 编辑器动作区新增「💾 存为动作资产」（当前动作 + rig + 摆姿写入素材库，默认名取动作名，成功刷新并提示跨节点可复用）与「📥 载入素材库」（下拉列出全部 2D 动作资产，载回即试播——按关键帧关节 id 命中检测，0 命中拒载提示装配不匹配、无动作帧提示先回编辑器）；动作因此从「节点 params」升级为可复用的工程内资产，跨 rig 以关节命名映射生效、未命中关节自然忽略；motion2d 暂无独立编辑窗（双击已接入素材库试播浮窗，见上），Inspector 仍可看元数据 / 改名，主入口是 2D 骨骼节点编辑器
- **从表演视频生成骨骼关键帧动作（5.5「骨骼装配与摆姿」参考视频待办落地）**：stage.2d 编辑器「骨骼」页动作区新增「🎬 从视频生成动作」浮窗——选工程视频资产后预载元数据取时长，按帧率（4~24fps、单条上限 60 帧）均匀抽帧（复用主进程 ffmpeg 帧采样桥），逐帧 YOLO pose（跟随上一帧跟踪 / 平均置信最高选主角色，支持镜像参考），`solveStage2dPoseFromSkeleton` 逐帧反解为 pose 关键帧（空帧剔除、补动作起始帧、可选闭环收尾帧）；生成结果以「custom」动作进入既有「动作试播」（播放 / 定格 / 导出动作帧链路全部复用），点「保存」即随节点 params 的 `stage2dAction` 持久化（graph schema / 保存链路 / 参数桥接层单测），重开节点自动恢复该动作
- **帧动画 sheet 循环试播（5.5「2D 导演台」动作与循环预览收尾）**：素材库右键任意图片资产 →「帧动画试播」浮窗（复用 StudioFloatingWindow）——`frame.animGen` / `anim.2d` 产出的网格序列 sheet PNG 由渲染层 `resolveAssetFrameSheetGrid` 从生成内图软解析 rows×cols 自动预填，普通多帧 PNG 手填行列即可切；播放器 `SheetFramePreview` 用 rAF 按帧率（2 / 4 / 6 / 8 / 10 / 12 / 15 / 24 / 30fps）行优先逐格切帧循环试播（循环开关、单帧步进、帧计数、整张网格总览点击跳帧），透明棋盘底直查接缝与抖动；通用播放组件可再挂到任意宿主
- **导出与资产出口：动作帧序列导出（5.5「2D 导演台」续）**：stage.2d 编辑器「骨骼」页新增「导出动作帧」——选中试播动作按帧率（6 / 8 / 10 / 12 / 15 / 24fps）把动作 cook 成透明 PNG 序列帧（复用合成管线 `composeStage2dCanvas`，逐帧采样首尾衔接可无缝循环），并自动拼一张水平序列 sheet（`composeStage2dFrameSheet` 渲染线程本地拼版，自动等比缩放控制尺寸）；帧与 sheet 经宿主 `saveGraphRunMediaForNode` 落盘为工程图片资产（默认 `Assets/2D`，可随节点输出目录配置），素材库自动刷新即可拖回预览 / 交给引擎循环播放；导出不入节点 params / generatedImages（动画帧是复用资产而非节点产物），编辑器显示导出进度与结果
- **动作与循环预览：pose 关键帧循环试播（5.5「2D 导演台」续）**：`shared` 层新增动作纯函数层 `stage2dAction`——秒制 pose 关键帧插值循环（逐关节最短路径角度插值、`{}` 帧=回绑定姿势可平滑回绕、循环对时长取模 / 非循环夹取，19 项新单测）与内置动作预设 `stage2dActionPresets`（待机呼吸 / 挥手 / 欢呼 / 节奏摇摆，按人形模板关节命名，播放到任意 rig 时命中的关节照常驱动）；stage.2d 编辑器「骨骼」页新增「动作试播」区块——选内置动作即循环播放、暂停 / 停止回到试播前摆姿、可一键把当前采样帧「定格」为你的摆姿；拖关节 / 滑杆摆姿、人形模板、图片反解应用与切离骨骼页、关闭浮窗都会自动停止试播；动作数据结构同时是 P1「Spine 关键帧动画编辑器」时间轴的本地契约
- **素材视觉打标**：资产入库 / 打开工程时对图片与视频首帧跑内置 YOLO 本地检测（全程离线）——COCO 80 类对象标签按类聚合 + 逐框主体位置（原图像素坐标）写入资产旁挂 meta（`asset.visionTags`，`shared/visionTags.ts`）；已有结果自动跳过、替换媒体 / 重新导入自动重打，模型未就绪时打标自动跳过、模型可用后打开工程即补齐。素材卡直接展示对象标签 chip（中文名 × 数量，最多 3 个 + 更多），资产库搜索同时匹配名称与视觉标签，为「资产语义检索（P1）」铺好本地标签数据源
- **素材视觉打标：弱置信度标签弱化**：置信度 <60% 的对象标签按「疑似」处理——素材卡与素材检查器以「疑似」前缀 + 弱化样式展示并附低置信度提示；COCO 80 类不含蝴蝶、蜻蜓等细分类，模型会把蝴蝶强行归为鸟（实测 41%~64%），弱化展示避免用户误当可靠结论
- **音效库**：内置 22 个常用音效预设（转场 8 / UI 7 / 环境 7，中英双语，`features/timeline/sfxPresets.ts`），一键「生成并上轨」复用 AI 音效生成管线；分类浏览 + 资产库声音一键「导入上轨」
- **项目级 Agent 记忆**：工程 `.aiartengine/memory.md` 跨会话沉淀项目偏好（风格 / 机位 / 角色一致性 / 其它），工程创建 / 打开时由配置自动生成基线，每轮对话注入 persona（截断 4000 字符）；MCP 工具 `project_memory_read / append / write`
- **角色音色 / 声音克隆**：工程 `.aiartengine/voiceProfiles.json` 角色音色档案（角色 → 音色 id / 克隆参考音频），配音节点按角色（`generateSpeechCharacter`）自动取档实现跨镜头一致配音；`referenceAudio` 透传火山方舟声音复刻（few-shot voice clone）；声音节点检查器「角色音色」下拉 + 档案管理对话框；MCP 工具 `voice_profile_list / upsert / delete`
- **智能剪辑（AI 粗剪）**：`shared/graph/smartCut.ts` 依据视频素材标题 / 分镜描述编排视频轨顺序、每段时长与转场；时间线「智能粗剪」调用剧本节点文本模型生成方案，预览对话框可调时长与转场后一键应用（仅重排视频轨，其他轨保留）
- **视频级媒体理解**：媒体质检从视频首帧升级为多帧序列审核——`shared/graph/videoReview.ts` 按时间均匀抽帧（含首末帧），主进程 ffmpeg 按时间戳取帧（`video:extract-frames`），质检执行器图片优先、帧补位（上限 6 张），帧数 >1 时提示词追加「同一视频时间切片」说明，无 ffmpeg 自动回退首帧
- **人声 / 伴奏分离**：时间线「人声伴奏分离」把选中片段音源拆为对白与伴奏（内置 ffmpeg 中置 / 侧置声道提取，`shared/graph/audioSeparation.ts` 纯函数），产物落 `Cache/Separated/<stem>/`，对齐原位置分别上配音轨与音乐轨，混音器调比例后再混音导出；第三方 AI 分离接入位已预留（配置 `AUDIO_SEPARATION_API_URL` 即启用）
- **BGM 音乐生成接入百炼 Fun-Music**：MiniMax `music_generation` 自 2026-08-20 对新用户 / 免费用户停服，新增通义千问（DashScope）提供商 Fun-Music 音乐生成平替——注册 `fun-music-v1` / `fun-music-preview`（audio 模态，`/api/v1/services/audio/music/generation`，仅华北2北京，邀测需在百炼模型广场开通），设置页支持勾选 audio 模态、门面 / MCP / 时间线 BGM 生成链路自动选型；MiniMax 旧接口保留供历史付费用户继续使用
- **本地一键抠图（离线）**：内置 YOLO 实例分割升级为软掩码通道——掩码以整张 letterbox 画布的网格随 letterbox 几何回传，渲染层 `shared/yoloCutout.ts` 纯函数管线完成网格 → 原图坐标双线性采样、多实例取 max 合并、置信度阈值二值化与可分离盒式羽化（均有单测）；资产检查器图片条目新增「本地抠图」一键入口：自动识别画面主体、多主体勾选保留、掩码阈值 / 边缘羽化 / 裁剪到主体可调，透明棋盘格实时预览后保存为透明 PNG 落 `Assets/Cutouts` 自动入库，供图流程与时间线 overlay 直接使用；png/jpeg 直接走主进程解码保持原分辨率，webp 等由渲染层 canvas 解码兜底
- **精灵统一对齐（2D 游戏资产 5.4 起步）**：`shared/gameAssets` 统一对齐纯函数层——由透明通道求主体外接框，按统一画布等比缩放并以中心 / 脚底锚点就位（`spriteGeometry.ts`），多帧平移去抖估计（掩码 + 灰度代价搜索），`spriteManifest.ts` 构建带锚点的 sprite-batch 清单（全带单测）；节点图新增「精灵对齐」`image.align` 节点（承接本地抠图产物）——参数态 `imageAlign`（画布 / 锚点 / 主体高度占比 / 地面留白 / 超宽收缩），执行器经渲染层 `composeImageAlignCanvas` 本地像素合成、下钻检查器可调参数并预览，为角色差分 / 特效序列 / 骨骼拆件 / UI 部件提供统一几何前置
- **2D 舞台场景落地（5.5「2D 导演台」起步）**：`shared/gameAssets/stage2dScene` 舞台共享层——统一画布 + 按 z 序精灵层叠放的场景状态 / 归一化夹取 / 逐层锚点落位放置计划（复用精灵统一对齐几何、ground 层共踩同一地面基线，带单测）；节点图新增「2D 舞台」`stage.2d` 节点——参数态 `stage2dScene` 入 GraphNodeParams 随 free canvas 图持久化，新建节点播种默认舞台场景，右键「2D」分组可添加，为多精灵按锚点就位 / 换装拼接 / 骨骼摆姿预览的独立平面舞台铺好共享地基
- **stage.2d 执行器接线与像素叠绘（5.5 地基续）**：上游精灵（如级联 `image.align` 输出）自动成层 `stageSceneWithUpstreamSources`（复用同序层 id / 对齐参数，重跑不抖动，带单测），渲染层新增 `composeStage2dCanvas`——多精灵层按 z 序依锚点放置计划叠绘单帧透明 PNG；`executeStage2dNode` 端到端接线（像素源逐层解析 → 合成 → 物化落盘 → 图库双输出，层随 params 持久化），前/后台两条运行路径均注入合成器
- **YOLO pose 反解赋起始姿势（5.5「2D 导演台」续）**：`shared` 层新增纯平面 FK 姿势反解 `stage2dPoseSolve`（无 THREE：自根向下逐骨把 rig 子链方向贴到关键点方向、只动旋转保留自身比例、低置信不驱动、flip 镜像换边 + 水平反射、torso 中髋→中肩）与一键人形模板 `stage2dHumanoid`（中性站姿，命名已按可驱动约定）；stage.2d 编辑器「骨骼」页新增两个入口：按画布重建人形骨架、「从图片反解姿势」浮窗（图片素材 → 自动 YOLO 检测 → 逐段命中状态 chips → 应用覆盖 pose，视口立即按 FK 显示）；角色命名含 chest/shoulder/elbow/wrist/hip/knee/ankle + L/R 即自动参与驱动（11 项新单测）
- **2D 骨骼装配与摆姿编辑器（5.5「2D 导演台」续）**：stage.2d 编辑器左栏分「层/骨骼」两页——骨骼页可加/删关节、改名、换父级、调绑定偏移，把部件层挂到关节并微调挂点 X/Y；摆姿用旋转滑杆或直接在视口拖关节（骨骼线 + 关节叠层随画布缩放平移，FK 实时驱动子链与挂件），pose 只覆盖旋转、可一键回绑定姿势；挂到骨骼的层在合成时以自身锚点对准挂点并随关节旋转，`composeStage2dCanvas` 与 stage.2d 执行器同步消费 rig/pose（导出帧与编辑器预览一致）；rig/pose 随节点 params 持久化，参数 schema / 编辑器 api / 保存链路与会话状态全接线（桥接层单测）
- **2D 骨骼装配共享层（5.5「2D 导演台」骨骼摆姿地基）**：`shared/gameAssets/stage2dRig`——关节层级（相对父关节的绑定偏移与旋转）+ attach 槽（舞台层挂到关节）+ 平面正向运动学：父关节旋转带动子关节与挂点、pose 只覆盖旋转不改写绑定值（可随时回绑定姿势）、父关节缺失或成环自动断链挂根、角度收敛到 (-180,180]（均有单测）；该结构同时作为 5.4 导出 Spine `skeleton.json` 的目标契约，供后续编辑器装配面板与拖动摆姿接入
- **2D 舞台正交视口与层微调（5.5「2D 导演台」续）**：舞台编辑器视口升级为正交视口——滚轮以光标为锚缩放、拖拽平移、复位自动适配画幅，栅格与 ground 基线 / 中心十字参考线可开关；新增层手动微调 `offset`（「微调层」模式下拖拽选中层，或数值输入 / 一键归零），微调叠加在锚点自动落位之上，共享层负责补默认值、越界夹取与放置计划叠加（均有单测），旧场景缺省偏移自动回落 0
- **2D 舞台编辑器（5.5「2D 导演台」）**：双击 `stage.2d` 节点下钻独立 2D 舞台编辑器——层列表按 z 序叠放（上移/下移、显隐、移除，从资产库添加精灵即按锚点就位）、舞台参数（统一画布尺寸、ground 地面语义与留白）、选中层参数（中心/脚底锚点、内容占高、地面留白、限制宽度），透明棋盘视口经 `composeStage2dCanvas` 实时合成预览；「应用到节点」把舞台参数与合成帧一并写回，卡片立即显示结果。同时修复 `stage.2d`（note 分类）双击被误判成可记事本节点、弹出记事本的问题

### Fixed

- **GIF 动图预览不再退化成静态首帧**：`anim.2d` 导出的 GIF 在检查器里预览时常只有第一帧、不播放动画——图片预览走 `getAssetPreviewUrl`，而它对图片返回的是 `.aiartengine/thumbs/` 下的缩略图 PNG（`nativeImage` 解原图所得，GIF 只剩首帧），且仅在缩略图尚未生成时才临时回退原图，故表现为「第一次打开会动、之后不动」。新增共享 `isAnimatedImageFilePath`（GIF 集合，可扩展）与渲染层 `resolveAssetPlaybackUrl`：动图预览改走 `getAssetFileUrl` 原文件（`studio-media://` 已按扩展名给出 `image/gif`，`<img>` 自动播放动画），静态图仍用缩略图省内存与 IO；资产检查器 `AssetMediaPreview` 与资产编辑器 `AssetEditor` 两处大图预览统一走该入口，列表 / 节点卡缩略图保持静态首帧不变（缩略图逐张播放既费内存也失去缩略图意义）
- **GIF 动图不再显示「一键抠图 / 智能构图 / 提取 UI 部件」入口**：这三项本地处理都只对单帧像素生效（`<img>` 载入 GIF 后 canvas 取到的是播放中的某一帧，产物也注定是静态 PNG），对动图既不可预期也无意义——`AssetInspector` 的 `cutoutSourcePath` 现复用 `isAnimatedImageFilePath` 识别 GIF 并直接置空，三个入口区块随之隐藏；静态图（png / jpg / webp）入口保持不变

## [6.0.0-alpha1] — 2026-09-09

6.0.0-alpha1 内部预发布（首个 6.0 alpha 构建）：内容为当前 `main` 上 [Unreleased]（5.2 智能创作版）的完整快照。本版主要用于验证 GitHub Actions 三平台自动构建 → 静默安装 + 启动冒烟 → GitHub Release 自动发布全链路；预发布版本会标为 GitHub prerelease，不会被作为 `latest` 推给 5.x 稳定版用户。

## [5.0.7] — 2026-08-31

5.0.7 体验优化版：缩小安装包、加快安装解压——内置 dsh 运行体（`resources/dsh`，约 200MB）只保留运行必需文件，剔除 sourcemap、类型声明、测试与文档目录、Markdown 与点文件后，文件数 -55%（29899 → 13517）、体积 -36%（204.5MB → 130.6MB）。NSIS 安装逐文件解压与杀软扫描开销随之大幅下降，全新安装明显更快，安装包下载也更小。

### Changed

- **dsh 以目录形态直接进包，放弃 zip 解压方案**：早期 5.0.7 曾把 dsh 压成单文件 zip、首启解压到用户目录——升级会破坏运行体文件权限、解压需等待数秒且旧版解压结果在新版变更后成为 200MB 孤儿垃圾，故回退为 `resources/dsh` 目录直接进包：安装即用、随应用升级、权限继承安装目录；删除解压进度 UI 与相关 IPC；首次启动自动后台清理旧版遗留的 `userData/dsh-runtime`
- **dsh 运行体裁剪（含误删防护）**：`scripts/bundle-dsh.mjs` 复制依赖闭包时过滤非运行文件（`*.map`、`*.d.ts`、`test`/`docs`/`examples` 目录、`*.md`、仓库/工具配置类点文件），保留 `LICENSE`、`CHANGELOG` 等合规文本；`dist/` 目录与数据类点文件（如 `.manifest.json`）受保护不过滤；新增**引用可达性校验**——扫描产物内全部 JS 的相对 `require`/`import`，对照源包区分「裁剪误删」与「可选引用」，误删即中止构建；裁剪后 dsh 131.4MB / 13586 文件，安装包 153.8MB（较早期全量版 -38%）

### Fixed

- **测试文件 lint 清零（`npm run lint` 恢复 0 error）**：`GraphRunResult.error` 本就是可选字段，4 处 `(result as any).error` 是多余 cast（`no-explicit-any`），改为直接读 `result.error`；`uiKit.test.ts` 九宫格解构去掉 3 个未使用变量（`no-unused-vars`），改用位置留空并对齐 3×3 row-major 顺序注释

## [5.0.6] — 2026-08-31

5.0.6 修复版：恢复安装包内置 dsh 运行体——electron-builder 26 的 copyDir 过滤会丢弃「复制源根目录下的 node_modules」，导致 5.0.4 / 5.0.5 安装包 `resources/dsh` 只残留 package.json，用户首启被迫走 npx 联网下载（1–2 分钟）。本版修复后安装包重新自带约 200MB dsh 运行体，开箱即用。

### Fixed

- **dsh 内置运行体重新进包**：`extraResources` 复制源由 `out/dsh-bundle` 改为其下的 `node_modules`（复制源根即目录本身，绕过 electron-builder 26 的过滤缺陷），安装包恢复完整 dsh 运行体
- **dsh 启动不再因 HMR 插件崩溃**：dsh 0.1.1-rc.2 的 headless 启动会无条件创建 `cordis-plugin-hmr`，其要求 loader 能访问 Node 内部模块（`loader.internal`）。内置 Node（Electron 44 / Node 24）下此前未注入 `--expose-internals`，启动即抛 `failed to apply loader entry … (cordis-plugin-hmr): --expose-internals is required for HMR service`。现在以 Node 直启 dsh 时注入该 flag（内置/系统 Node ≥22 均支持），对话恢复正常
- 5.0.4 / 5.0.5 已安装用户可通过自动更新升级到 5.0.6 修复；已装 5.0.5 的升级请求会被 `latest.yml` 正常接收

## [5.0.5] — 2026-08-31

5.0.5 新版本：**dsh 运行时离线打包**——DeepSeek Harness 运行体与 Node 运行时随安装包内置，执行复用 Electron 内置 Node（`ELECTRON_RUN_AS_NODE`），用户无需安装系统 Node 22.19+，也不依赖 npx 联网拉包，开箱即用。

### Added

- **dsh 运行时离线打包**：dsh 运行体随应用分发，`resolveNodeCommand()` 优先使用内置 Node（Electron `process.execPath` + `ELECTRON_RUN_AS_NODE=1`），未命中才回退系统 `node`
- harness 状态检测与提示同步更新：识别内置 Node（Electron 44 内置 Node 24.x），不再出现「请先安装 Node.js」引导
- 文档同步：README（中/英）、dsh 使用文档、官网使用手册（中/英）均已更新

### Docs

- 路线图重构为按优先级划分的 P0 / P1 / P2 方向；P0「dsh 运行时离线打包」本次完成

## [5.0.4] — 2026-08-31

5.0.4 新版本：引入 Skill 技能系统——对话 Agent 自动注入内置创作技能（分镜 / 导演审核 / 系统创作），并可在设置中添加自定义技能；AI 对话面板新增真实上下文用量环形进度、模型与会话下拉选中态对勾、任务列表内嵌消息流与提问弹窗。

### Added

- **Skill 技能系统**：内置 GraphSkill 快照注入 AI 对话 Agent，对话时按需加载为指令；快照带指纹去重，未变化时跳过重写，节省 IO
- 设置 → **自定义技能** 面板：展示技能目录与内置 / 自定义数量，支持「打开目录」「生成示例模板」，放入 dsh SKILL.md 格式文件后下次对话自动生效
- AI 对话面板**真实上下文用量环形进度**：按 dsh 上报的 inputTokens + 缓存命中实时显示已用 / 上限，进度随对话动态变化
- AI 对话**提问弹窗**（ask_user_question）：Agent 需要确认时弹出选项供用户选择，并按对话模式约束可用工具
- **界面输出 Skill 工具调用卡**：harness 运行日志中以卡片形式展示 skill 工具调用

### Changed

- AI 对话模型下拉、会话下拉改为自定义菜单，当前选中项以对勾 + 高亮标记
- 任务列表内嵌到消息流中展示，运行状态随消息滚动可见
- 允许把资产 / 参数窗口拖入 AI 对话页签
- README 与官网新增技能系统文档（使用手册 §5.6、主页特性卡）

## [5.0.3] — 2026-08-30

5.0.3 修复版：一键工作流创建的节点标题不再有英文直显死角（任务列表、运行日志、note/演示卡片统一走 i18n 解析）；世界元素生成节点 dive 后正确播种出对应子图。

### Fixed

- 一键工作流创建的节点在任务列表、运行日志、note/演示卡片等入口直显英文复合标题（如 `Director Review · Beat Breakdown Table`）：新增 `graphNodeDisplayTitle` 统一解析层，画布卡片、属性面板、任务列表、运行日志全部改走 i18n 标签解析，兜底逻辑不再回退英文原文
- 世界元素生成节点 dive 后没有创建出对应子节点：dive 时若子图为空，回退到资产级世界目录播种（`applyWorldCatalogOnOpen`），并在播种完成后才挂载子编辑器，避免空画布

### Docs

- 新增 MCP + AI 对话教程视频脚本（`docs/tutorial-script/mcp-ai-chat-tutorial-script.md`）

## [5.0.2] — 2026-08-30

5.0.2 修复版：AI 对话面板多轮记忆升级为 dsh 原生持久化 session，模型读到的是真实消息序列（含工具调用历史），而非文本拼接的上下文。

### Changed

- AI 对话面板多轮上下文改为 dsh 原生持久化 session：将 `ChatSession.id` 传入 dsh，runner 对已有 JSONL 会话执行 resume（不存在则自动创建），多轮对话成为真实消息序列，含工具调用与崩溃恢复，删除文本拼接上下文路径
- 删除 AI 对话会话时同步清理磁盘上的 dsh JSONL 记录，避免同 id 会话被"幽灵恢复"

### Fixed

- AI 对话面板多轮记忆失效：对话历史作为上下文传入模型，模型可引用前面轮次的对话内容与工具执行结果

## [5.0.1] — 2026-08-30

5.0.1 修复版：长耗时生成（3D / 视频）不再被 MCP 超时误判为失败而重复提交，对象存储上传增加会话级幂等缓存。

### Added

- 对象存储上传会话级幂等缓存：同一本地文件 / data URL 作为参考媒体时只上传一次（重试、图节点、AI 对话、Agent 重发等多入口不再产生重复对象）；缓存按文件路径 + size + mtime / 内容哈希做 key，预签名 URL 有效期内直接复用，删除对象后自动失效

### Fixed

- MCP 工具调用超时延长至 120 分钟，与 HTTP 层长超时对齐：`generate_model3d` / `generate_video` 等"提交后阻塞轮询到完成"的长任务不再被默认 60s 超时误判为失败
- Lux3D 单账号并发冲突改为自动重试：识别并发冲突错误后指数退避（10s 起步、5 分钟封顶、12 次），非冲突错误立即抛出，避免 Agent 并行生成时撞车
- AI 对话面板选择资产引用后自动补空格，避免继续输入时再次误触资产选择窗

## [5.0.0] — 2026-08-30

5.0 正式版：外部 Agent（MCP）集成与 AI 对话面板，支持第三方工具调用本应用工作流。

### Added

- 内置 MCP 工具服务：外部 Agent（Claude Desktop / Cursor / 其他支持 MCP 的客户端）可通过 stdio 桥或 `/mcp` 端点（streamable HTTP 直连）调用本应用能力——规划/落盘工作流、管理工程资产、运行宿主资产工作流与状态回报
- MCP 工具面：`models_list` 与 `generate_image` / `generate_video` / `generate_model3d` / `generate_speech` 语义生成工具；`graph_read` / `graph_edit` 读写宿主资产图（节点增删改/连线，端口校验+编辑器冲突保护）；`task_run` / `task_status` 运行工作流；`folder_list` 资产分类与 `folderId` / `outputDir` 落盘
- MCP 稳定性：token 跨重启持久复用（退出保留 `mcp.json`）、设置界面可直接编辑/保存 Token；操作审计落盘（JSONL 截断/滚动）；生成并发闸门（默认 3 可调）；`generate_*` 支持 `extraParams` 低频参数透传；旁路生成活动在任务列表可见可查；Host/Origin 校验防 DNS rebinding
- 新增 DeepSeek Harness AI 对话面板（MCP 工具调用）：应用内 AI 助手可边对话边调用 MCP 工具；dsh 运行体打包进安装包，无需额外安装 Node 环境
- 任务容错模式：节点失败降级（continued）不整链中断，运行日志 / 流水线总览 / 节点状态同步
- 媒体质检增强：专用质检模型 + 参考图/审核对象角色判定 + 五维评分，返工接入备选模型链与图片尺寸校验
- 工作流规划支持取消（AbortSignal）：调用轮次间检查取消，取消不再发起新一轮模型调用
- 一键工作流新增行业模板：电商带货 / 游戏 3D 资产 / 漫画出版 / 知识口播 / 3D 白模预演
- 导演台新增着色模式与线框模式菜单
- 官网重构：英文版页面与中英语言切换、全站深色主题、按 Diátaxis 四层重构文档体系、SEO 与社交分享优化（og 卡片图 / hreflang / robots / sitemap）、MCP 接入教程页

### Fixed

- AI 对话面板模型选择不生效：dsh 对话通道改为每次运行前将面板选中的模型写入 dsh `settings.yaml`（`agent-default-model` + `llm-deepseek.baseURL`），不再回落到内置默认 `deepseek-v4-flash`（多数 OpenAI 兼容端点不存在该模型，导致 `HTTP_404`）

### Changed

- 语音生成统一落盘为工程资产（`generateSpeechAsset`），与图片生成同一资产模型
- MCP stdio 桥改纯隧道：协议收归应用 `/mcp` 统一处理，协议层支持 `notifications/cancelled` 与外部信号中止

## [4.1.1] — 2026-08-28

### Added

- 3D 模型生成新增 Lux3D（AHOLO）提供商：文生 3D 支持 7 种风格选择
- 导演台物体支持材质贴图覆盖（基础贴图 / 法线贴图）：替换、隐藏、还原模型自带贴图
- Cache 产物模型文件 `modelRelativePath` 回退加载，新增 Cache/Models 输出子目录

### Fixed

- 导演台基础几何体重开后全部变成占位方块：落盘白名单补齐全部 primitive
- 导演台创建物体后视图跳动；多选删除只删掉一个

### Changed

- 错误消息全面中文化：新增统一错误目录（`src/shared/errors`）与主进程 `messages.ts`，主进程异常改为结构化 AppError 返回，renderer 按错误码提取用户可读中文
- i18n 优化：硬编码中文迁移到语言包，新增 CI 检查（`check-hardcoded-cjk`），zh/en 语言包自动校验条目对等
- 用户手册与官网文档全面修订（设置路径、快捷键、节点清单、教程页导航一致性）

## [4.1.0] — 2026-08-27

### Added

- 3D 模型生成：新增 Meshy、Tripo、Rodin（Hyper3D）、Luma AI 四家提供商（文生 3D / 图生 3D，异步提交 → 轮询 → 下载）
- 节点图新增「3D 模型生成」节点：文本 / 上游参考图 → 3D 模型资产（`model` 资产），结果可按引用接入下游
- 导演台节点新增 3D 模型输入端口：连入模型生成结果后，dive 自动实例化到舞台场景
- 3D 模型生成支持图节点回写绑定（宿主资产 id + 节点 id）：重启后可持久化、续拉与取消
- ComfyUI 视频生成：r2v 多模态参考输入、视频 / 音频参考注入、首尾帧（`first_frame` / `last_frame`）注入、视频时长上限 15s、模型列表纯动态拉取（移除写死的模板目录）
- 节点图新增「漫画页」节点：网格分镜格 + 台词气泡编辑器；从资产库拖图入格 / 本地导入 / 上游图片一键填入，逐格清除图片路径；分格大小用右缘 / 下缘 / 右下角手柄按单格跨数调整（连续跟手预览、松手吸附网格）；气泡可拖动移动、角部手柄等比缩放（0.5~4 倍）；页面级与分镜格背景颜色选择（点击空白处显示全局属性）；导出 PNG 默认透明底，Cook 执行按阅读顺序回填上游图片并合成 PNG 进图库
- 节点图新增「广告变体矩阵」：产品描述与画幅比例设置，双击进入变体维度配置与对比预览
- Agent 流水线新增质检 / 返工节点
- 导演台：AI 白模几何体与透视落地、场景块遮罩与全景图视图、新增全景图输入并 dive 时自动设为背景
- 图层分离窗口支持滚轮缩放与空格平移

### Changed

- 视频生成按模型上限隐藏限额为 0 的媒体入端口；首帧 / 首尾帧模式下参考图口与帧口互斥
- 异步视频 / 3D 模型生成任务去超时，改为依赖轮询完成与取消

## [4.0.3] — 2026-08-21

### Added

- 图层分离导出 PSD 时保留嵌套分组（名称、折叠、可见性）

### Fixed

- 图层分离等 dive 编辑器打开时，工具栏撤销/重做代理到草稿历史，不再误回退整张图
- 面包屑回退时提交裁剪 / 网格拆分 / 图层分离的实时预览，撤销命令不再丢失
- 图层分离导出 PSD 的图层顺序由顶→底改为底→顶，符合 PSD 规范

## [4.0.2] — 2026-08-21

### Added

- 图层分离导出：支持导出为 PSD（保留层级、位置、尺寸、透明通道与名称）；分组 PNG 导出支持按分组建子目录

### Changed

- 图层拆分对话框导出工具栏调整按钮顺序与样式

## [4.0.1] — 2026-08-21

### Added

- MagicRouter 提供商（OpenAI 兼容聚合网关）：文本 / 图片 / 视频，图片按 DashScope 风格尺寸映射，视频异步提交 / 轮询
- 图层分离：Seedream 5.0 Pro `layer_decomposition` 拆成底图 + 最多 16 张透明 PNG，可在 dive 编辑器调层级后本地重组

### Changed

- ComfyUI 教程补充 MiniMax H3 视频说明，并新增 ComfyUI 接入教程脚本

## [4.0.0] — 2026-08-20

4.0 正式版：内部扩展改为 Cordis 插件运行时，并补齐 ComfyUI 视频 / 声音生成与 MiniMax H3 支持。

### Added

- ComfyUI API 2 视频 / 声音生成：从 userdata 拉取并读取 API 格式 workflow，画布 UI 图（含子图）自动转 API，首帧 / 参考图 multipart 上传
- MiniMax H3 视频：宽高自动对齐到 32 并压到原生画布（768 短边 / 768×1344 面积上限），时长按 24fps + 17k+5 网格注入

### Changed

- 编辑器、模型提供商与对象存储改为 Cordis 插件注册；节点连线端口类型严格匹配；内部上传接口统一为对象存储服务（详见 4.0.0-alpha.0）

## [4.0.0-alpha.1] — 2026-08-18

### Fixed

- 场选取节点输出单条文本，测试改为接到文本消费口，不再误连「选取文本」

## [4.0.0-alpha.0] — 2026-08-18

4.0 首个 Alpha 预发布：内部扩展改为 Cordis 插件运行时。

### Changed

- 节点连线要求两端端口类型完全相同：图 / 视频 / 声音 / 文本的单数口不能接入复数口；选取节点只收 `out-all` 等列表口
- 编辑器、模型提供商与对象存储改为 Cordis 插件注册；图执行器按域拆分，Skill / 执行器支持覆盖栈回滚
- 内部上传接口统一为对象存储服务（不再用 TOS 作为内部通称）
- 官网手册、README 与仓库文档同步连线规则与扩展说明

## [3.0.9] — 2026-08-17

### Added

- 成片时间线支持画中画叠加编辑（位置 / 尺寸 / 不透明度 / 音量）与预览框比例
- 视频轨转场效果与重叠时长手柄；导出成片跟进转场与画中画

### Changed

- 时间线播放、入点出点与播放头拖拽命中区域更易操作

### Fixed

- 成片时间线预览叠层与拖拽幽灵改用主题变量，浅色主题不再出现白叠色无对比

## [3.0.7] — 2026-08-14

### Fixed

- 修复 Windows 自动更新 404：NSIS 安装包改为 `AIArtEngine-Setup-x.y.z.exe`（无空格），与 GitHub Release / electron-updater 文件名一致

### Added

- GraphSkill：短剧流水线提示词以 `params.skillId` 快照绑定，运行轨迹记录 skill 与阶段
- 9 宫格直出视频模式与动态提示词；末端关键帧之后的节拍覆盖到剧本结束
- 分镜窗动态提示词可双击打开词本编辑

## [3.0.6] — 2026-08-11

### Added

- 新增 2D 帧动画（`anim.2d`）与生成帧动画序列图（`frame.animGen`）节点：右键「动效」分组与专属图标（序列图网格 / 播放按钮）
- 生成帧动画序列图节点：双击打开指令面板（角色 / 特效 / 武功预设，默认指令与系统提示词），行列参数拼入提示词，模型列表使用图片模型，输出预览支持删除与选择输出图
- 2D 帧动画节点改为普通播放节点（移除 dive 内图，in 端口输入序列图），Inspector 提供行列参数，节点卡片自动播放帧预览，cook 时清除上一次输出不累积
- 多图卡片折叠预览改为扑克手牌扇形叠加，右下角展开按钮与缩放把手悬停 / 选中时显示，节点边框提亮
- 新增帧动画序列图与特效预设的剪映推广脚本（`website/tutorial-script/frame-anim-fx-promo-script.md`）

### Fixed

- 修复序列图切格黑边；帧动画输出预览删除 / 选中与 2D 帧动画双击播放

## [3.0.5] — 2026-08-10

### Added

- 图片/视频生成支持随机种子（seed）：图片生成适配火山方舟 Seedream / OpenRouter 透传 seed，视频生成链路（视频生成、对口型、片段重拍）接通节点参数；执行日志记录实际使用的 seed，未设置时显式输出 `null`，便于同参数复现
- 全局参数面板新增「全局随机种子」：生成节点默认跟随全局，节点可关闭跟随并单独设置，与全局风格参考图同一套交互
- 右键菜单新增「提示词」分组（提示词优化 / 图片反推提示词），并区分「图片精修 / 图片编辑」等分组图标

### Changed

- CI：`actions/upload-artifact` 升级 v6（Node 24），消除 GitHub Actions 的 Node 20 弃用警告

### Fixed

- 修复记事本等浮动窗口脱离主窗口后复制功能不可用：剪贴板写入改走主进程（Electron clipboard），不再依赖渲染窗口焦点，并保留 `navigator.clipboard` / `execCommand` 回退

## [3.0.4] — 2026-08-10

### Added

- 游戏 UI 工作流：一键工作流新增「游戏UI界面」预设（策划案生成 → UI界面拆分 → UI界面生成），UI界面生成支持双击 dive 进内图逐屏出图，外层 Cook 汇集全部输出边界；拆分为 UI界面拆分 / UI界面生成两个节点，UI界面拆分输出各界面提示词数组
- 风格库新增「UI 风格」分类：内置 25 张游戏界面风格图，可设为全局风格参考统一控件、配色与质感；风格图预览改为完整显示（竖版 UI 图不再被裁切）
- 图片生成参考图 `@n` 指代改写共享化（Google / OpenRouter / 火山方舟统一转换）；风格引用新增 UI 语义（迁移界面视觉语言，不照抄参考图具体内容）
- 执行日志记录图片生成参考图清单：来源（风格库 / 端口参考图）与相对路径
- 游戏 UI 工作流剪映教程脚本（`website/tutorial-script/gameui-tutorial-script.md`）
- 节点图支持多选批量连线（输入/输出口多条预览线，合并为一次撤销）
- 导演台（3D 工作台）：名称标签改为可见网格顶部中心锚点（排除隐藏/辅助几何）；最小推近距离 0.05 → 0.005，无全景背景时拉远上限放宽至全景半径 ×6；删除导演台节点 / 模型 / 相机时清理孤儿舞台与动画数据（stagesByNodeId 自动剪枝、轨道与机位组同步清理）；机位组支持整组删除（连同预设相机，可撤销）；层级列表支持多选拖拽改父级（整组移动并保留世界变换）
- 新增 3D 工作台剪映教程脚本（`website/tutorial-script/director-stage-tutorial-script.md`，约 2 分钟）
- 新增 OpenAI 官方模型提供商：文本（GPT 系列，`/chat/completions`）+ 图片（gpt-image-1 / gpt-image-2，`/images/generations` 与 `/images/edits`）
- 新增 DeepSeek 模型提供商：文本（deepseek-chat / deepseek-reasoner，OpenAI 兼容）
- 新增智谱（Zhipu）模型提供商：GLM 文本（`/chat/completions`）+ CogView 文生图（`/images/generations`）
- 新增本地 OpenAI 兼容提供商 vLLM / Ollama / LM Studio：默认 Base URL 分别为 localhost:8000/v1、localhost:11434/v1、localhost:1234/v1；无需 API Key，模型目录由 `/models` 全量拉取
- vLLM-Omni 视频生成接入：异步任务走 `/v1/videos`（multipart/form-data），完成后自动下载登记；支持 Wan T2V / I2V 等扩散模型，首帧图生视频（input_reference / image_reference）与参考视频 / 音频（video_reference / audio_reference）；Ollama / LM Studio 保持仅文本
- 新增 Kimi（月之暗面 / Moonshot AI）模型提供商：文本（kimi-k2 系列 / moonshot-v1 系列，OpenAI 兼容），默认 Base URL 为 api.moonshot.cn/v1
- 新增 xAI（Grok）模型提供商：文本（grok-* 对话，OpenAI 兼容）+ Grok Imagine 文生图（`/images/generations`，aspect_ratio / response_format）+ Grok Imagine Video 异步视频（`/videos/generations` 提交、轮询 `GET /videos/{request_id}`，支持 480p / 720p、5–15 秒与首帧图生视频）
- 新增 Google（Gemini）模型提供商：文本（gemini-* 对话）+ Nano Banana 系列文生图 / 图生图（`/images/generations`，JSON body，支持 aspect_ratio / resolution / n / response_format 与 image 参考图字段）+ Veo 3.1 异步视频（`/videos` 提交、轮询 `GET /videos/{id}`，支持 720p–4K、4–8 秒与首帧图生视频），均走官方 OpenAI 兼容层（默认 Base URL 为 generativelanguage.googleapis.com/v1beta/openai）

### Changed

- UI 界面拆分提示词体系：禁止输出视觉风格 / 材质 / 光影 / 配色描述（策划案中的风格词一律剔除）；游戏 UI 生成专用系统提示词要求严格对齐风格参考图的 UI 元素、界面风格、控件、配色等细节
- 风格库条目提示词按最新库内容强制刷新，避免项目残留旧通用提示词

### Fixed

- 修复 ui.gen 内图边界节点重复、提示词输入未连接图片生成节点的问题；dive 后直接按输入端口数组展开，无需先 Cook
- 修复 UI 风格库中文乱码（`library.json` 条目）
- 修复 ui.split dive 面包屑显示英文（改为本地化标题）

## [3.0.2] — 2026-08-07

### Added

- 成片时间线节点新增方形视频输入口（`in-videos`），执行时合并单条与视频组输入
- 宿主输出汇集：执行当前直接按内图边界出口收集产物（无需进内图 Cook），并物化到宿主节点参数，视频组 / 文本组外层预览统一走图库
- 画布缩放范围调整为 1%–1000%

### Changed

- 节点输入输出端口外移到边框外与边框外切，连线锚点保持边框位置，避免显示断开

## [3.0.1] — 2026-08-07

### Added

- 新增「UI 界面拆分」节点：读取策划案，把每个独立界面拆成详细生图提示词，主出口输出 texts 数组

### Fixed

- 修复同一毫秒内连续生成导致文本图库出现重复 id、「最新选中」误指旧条目的问题（图片 / 视频 / 声音图库同类冲突一并处理）
- 宿主节点「执行当前」直接按内图边界出口收集产物：内层生成视频 / 文本后无需再 Cook 一次边界输出，也不会复用过期的抬升缓存

## [3.0.0] — 2026-08-07

3.0 首个正式版本：短剧分镜 Agent 流水线一键成片。

### Added

- 一键工作流新增「短剧分镜（Agent 流水线）」短视频模板：自动生成 剧本 → 节拍拆解表 → 9宫格分镜表 → 9宫格拼图 → 宫格提取 / 高清放大 → 4宫格动态分镜表 → 4宫格拼图 → 动态提示词表 → 36 条动态视频 的完整链路，以及 review1~4 导演审核
- 剧集流水线（Agent 流程窗口）：独立窗口集中完成 节拍拆解、9宫格、4宫格、拼图、导演审核与视频生成
- 9宫格一键生成全部 9 格；视频产物在流程窗口内直接播放预览；三栏布局可拖动调整宽度；拼图按钮改为图标并置于导演审核之后
- 阶段重新生成后级联失效下游产物：旧图 / 旧视频不再被复用，再次生成会从最新文本一致补跑，避免“新文本配旧图”
- 导演审核：阶段重新生成成功写回后才开放审核；质检提示词默认偏 PASS，仅阻断性问题才 FAIL，FAIL 原因自动回写并附加到对应阶段重跑
- 宫格选择 / 动态格选择节点新增 Inspector（宫格 1~9、组×格 参数编辑）
- 指令编辑器：引入节点缩略图悬停预览（图片限尺寸；文本显示正文前段并支持读取旁挂 txt / md 文件）
- 官网新增《短视频制作教程》页，使用手册补充剧集流水线章节

### Fixed

- 分镜流水线窗口 9宫格格子角标误显示「未生成」（改为按本格图片是否生成显示）
- 指令窗口文本节点预览读不到旁挂文件正文
- 生成9宫格拼图只出当前格（改为一次生成全部 9 格）

## [2.0.2] — 2026-08-04

### Added

- 顶栏「AI Art Engine」品牌按钮改为工程打开菜单：新建 / 打开 / 最近工程 / 关闭工程，首页与顶栏共用同一套工程生命周期逻辑
- 节点按预览媒体比例自动适配尺寸（横图锚默认宽、竖图锚默认高），手动拖拽缩放后保持用户尺寸
- macOS 安装包同时产出 x64（Intel）与 arm64（Apple Silicon），官网与 README 更新按架构下载指引

### Changed

- 叙事单元更名为「场（beat）」，并修复宿主输出回传与选择场预览
- 节点卡片顶栏 / 类型图标 / 播放控件默认隐藏，悬停或画布有选中节点时显示，并弱化边框阴影
- 官网与 README 定位改为专业 AI 创作工具

### Fixed

- 宿主输出回传与选择场预览问题

## [2.0.1] — 2026-08-03

### Added

- 一键工作流：预设 / AI 规划预览后创建可复用宿主资产；多汇点各建边界输出；创建时选目录并按内图推断宿主 I/O
- 宿主多汇点边界输出；任务队列跨并行任务复用已完成共同上游
- 节点图画布：连线样式、小地图、更大缩放范围；侧栏 Rider 式收起与叠放；拖线改接
- 宿主节点圆形菜单「Cook 子图」；单独执行默认复用缓存；世界元素 / 分镜图 / 分镜视频生成同样支持 Cook 批跑
- 节点复制粘贴（Ctrl/Cmd+C/V 与右键）；普通引用资产可多次拖入同一资产

### Changed

- 官网使用手册补全一键工作流、宿主 Dive、任务复用与侧栏交互；首页工作流步骤增加「一键工作流」
- 节点 / Inspector 预览改为完整显示（object-fit: contain）
- 打光效果 / 多角度编辑器左侧预览改为顶部对齐
- MiniMax 提供商更名；Windows 风格视频图标；节点媒体控件优化

### Fixed

- Cook 子图强制重跑内图，避免空 done / 占位符导致出口为空
- 画布改节点名不再改资产原名
- TOS endpoint 去掉协议，避免预签名主机名异常
- 侧栏布局保存恢复与删除确认弹窗样式

## [2.0.0-alpha.0] — 2026-07-29

2.0 首个 Alpha 预发布。

### Added

- 成片时间线：素材分组、拖入导入、视频首帧 / 声音图标；预览播选中片段、时间线播整轨；轨道片段可自由拖动
- 导演台：站位与动作双分类（截图 / 录制视频）；动画录制红色圆点图标，自动写入 `Cache/Videos`
- 导演台编辑节点：方形输出口 `out-shots`（站位 images）与 `out-actions`（动作 videos）；Inspector 可预览
- 导演台左侧场景列表可拖拽调整宽度
- 目录端口专用类型 `world` / `narrative` / `shots`（显示为世界元素 / 叙事单元 / 分镜）：结构化 JSON 不再占用 `text`，避免误连
- 生成类节点锁定：开启后跳过模型调用，直接复用图库/上次输出（节点卡锁图标与 Inspector）
- 模型提供商：可灵（Kling）、MiniMax、通义千问（DashScope）、魔塔（ModelScope）
- 对象存储：阿里云 OSS、腾讯云 COS（与火山 TOS 并列；同时仅可启用一个；设置页支持折叠）
- 设置页与手册展示各模型 / 对象存储密钥申请链接；方舟声音页签补充豆包语音控制台说明
- 图片精修对齐编辑管线，Inspector 提示词实时同步

### Changed

- 可灵鉴权改为官方文档的 API Key（`Authorization: Bearer`），移除 Access Key / Secret Key JWT 签发
- 通义千问静态模型目录按百炼文档对齐（可灵 V3 / HappyHorse t2v·i2v·r2v·edit + 万相图 ≤2.5 / 视频 2.2–2.7）
- README / 官网 / 手册补全 MiniMax 等模型提供商说明
- 图库类生成节点双输出口：`out` 为当前选中单条（默认连线；每次成功执行强制选中最新），`out-all` 为全部历史；Inspector 可单击切换当前输出
- 预览走弹窗，图片编辑工具仅 Dive

### Fixed

- 魔塔文生图改为异步提交（`X-ModelScope-Async-Mode`）并轮询 `/tasks/{id}`
- 宿主删端口同步清内图 boundary；剧集宿主边界输入默认接线等稳定性问题

## [1.0.1] — 2026-07-24

### Added

- 官网全组件使用手册与首页入口；GitHub Pages + 阿里云 OSS 双渠道
- 镜头调度预设与电影化分镜能力；分镜表格编辑体验优化
- Gitee 源码镜像链接

### Fixed

- 亮色主题：剧本预览、分镜列表缩略图、分镜表格拉伸柄样式
- 多角度 / 打光编辑窗口打开时左侧预览不显示
- 打光透视球随鼠标旋转，网格正实背虚
- 人像质感选项选中反馈不明显
- 官网移动端菜单显示不全

## [1.0.0] — 2026-07-24

首个正式版本。

### Added

- 本地优先工作台：资产库、分镜、节点图、导演台
- 模型对接：OpenRouter、火山方舟（文本 / 图片 / 视频 / 声音）
- 资产包 `.aipackage` 导入导出与 GUID 引用
- 叙事单元 / 分镜拆解 / 世界元素等图节点流水线
- 应用内自动更新（`electron-updater` + GitHub Releases）
- 多平台安装包（Windows / macOS / Linux）

### Changed

- 产品名统一为 **AIArtEngine**
- 正式发版默认关闭内置图插件 Demo；Seedance 默认不再启用 Mock

## [0.1.0] — 预发布

- 本地 AI 短视频创作工作台雏形（资产 / 分镜 / 节点图）
- OpenRouter、火山方舟模型对接
- 多平台安装包试构建
