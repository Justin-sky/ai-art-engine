# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。版本号以 [`package.json`](./package.json) 为准；发版时打 `vX.Y.Z` tag，由 GitHub Actions 构建并上传安装包。预发布（如 `4.0.0-alpha.0`）会标为 GitHub prerelease，**不会**作为 `latest` 推给 3.x 稳定版自动更新。

## [未发布]

### Added

- **对话助手现在认得 SVG 矢量链路（`svg.gen` → `svg.anim`）：技能目录、节点清单描述与规划提示词三处信号补齐**：`svg.gen` 能出 `.svg` 矢量资产、`svg.anim` 能把它烘焙成帧序列与 GIF，能力本身完整，但对外只有节点层可见——GraphSkill 目录里只有 `anim2d.frames`（位图帧动画）、没有 SVG 类技能，`graph_node_types` 的描述只点名 `anim.2d`，`workflow_plan` 的系统提示词规则 6 也只写「`play.script` → `asset.image` → `asset.video`」这条位图链，于是「生成一个鹈鹕骑自行车的 SVG 动画」这类请求在 Agent 手里没有可走的路：它既看不到 `svg.gen` 的用法（端口 `in` / `in-image`、参数 `svgGenWidth` / `svgGenHeight` / `svgGenBackground`），也不知道静态 SVG 接进 `svg.anim` 只会出 1 帧。本轮补齐三处信号（**不改任何运行时链路**）：① 新增 GraphSkill `svg.motion`（「SVG 矢量图与矢量动画（GIF）」，`GraphSkillKind` 增 `'svg'`）：生成指令是矢量绘制模板（强制全矢量、动效写在 SVG 自身内才可烘焙），`usageZh` / `usageEn` 给出 3 步 MCP 落地流程（`workflow_commit` 手写 plan → `task_run` → `task_status`，带鹈鹕骑车示例）并点明「要矢量就别改用 `generate_image`」；② `graph_node_types` 描述补 `svg.gen` / `svg.anim` 口径（端口、参数范围、静态 SVG 只出 1 帧、GIF 走 `out-gif`）；③ `workflow_plan` 规则 6 补「矢量图 / SVG 动画用 `svg.gen`（要帧序列或 GIF 再接 `svg.anim`）」，并提醒 `image ≠ svg` 端口不兼容。技能随 `writeDshSkills` 的签名变化自动重写落盘，Agent 在 `<available_skills>` 里即可看到 `SVG vector art / vector animation (GIF)`

- **PSD 源文件进资产库并能看到画面（图层分离导出的 `.psd` 不再只能躺在工程目录）**：此前 `.psd` 不在导入白名单（`src/shared/import.ts` 的 `IMAGE_EXT` / `IMPORTABLE_EXTENSIONS`），既导不进资产库、也扫不进素材库——图层分离导出的 PSD 落盘后无人认领，想再找到它只能自己去翻工程目录、用 Photoshop 打开。现在 PSD 按图片资产入库：可经导入对话框 / 拖入 / `asset_import` 进素材库，可被检索与引用。画面也不再缺失：Chromium 与 `nativeImage` 都解不出 PSD（文件里存的是未合成的图层文档，不是现成位图），但 PSD 的 Image Data Section 自带整份合成图，新增 `psdCompositeService` 用 ag-psd 把它读出来（只取合成图、跳过图层像素与内嵌缩略图；Node 侧没有 canvas，用纯数组垫上 `createImageData`），编码成 PNG 后与普通图片共用同一条缩略图 / 预览链路——素材卡、列表、检查器与大图预览（双击）都能直接看到画面，缩略图长边 1024 落盘复用（比普通缩略图大：一次合成解码要数百毫秒，解出来就该多用几处），导入规划与打开工程补扫也把 PSD 一并排队。新增「分层源文件」判定 `isLayeredSourceImageFilePath`，只在「不能把源文件本身当像素用」的地方拦：预览 URL 不回落原文件（回落必是破图），撞上 ag-psd 不支持的情况（ZIP 压缩的合成图、CMYK / Lab 色彩模式、体积超限）则返回空串，由界面按「PSD 源文件」徽章展示，同一分辨率下的失败在会话内不再重试。编辑出口交系统默认程序：大图预览拿不到画面时、右键菜单「用 Photoshop 打开」均走新增的 `asset:open-with-default-app` 通道（主进程 `shell.openPath`，路径先过工程内校验）。图片选择对话框与「打开编辑器」入口同步排除 PSD，避免把它当可解码像素送进生成链路

- **对话助手默认会用 2D 帧动画出 GIF（原来的默认路径是「自己写个 HTML」）**：`anim.2d` 早已支持运行即产出 GIF（`animGifFps` + `out-gif`），但对 Agent 而言这条路几乎不可见——工具表里没有「生成 GIF」的工具，`graph_edit` / `graph_node_types` 的描述没提动图，技能目录里没有帧动画类技能，AI 工作流预设里也没有它；再加上 `anim.2d` 的 `in` 端口吃的是**按行列分格的序列图**（不是单张参考图）、GIF 默认关闭，于是「生成一个 GIF 动画」的需求通常落到模型自己写 HTML / SVG / CSS 动画上。本轮把三处信号补齐（**不改任何运行时链路**）：① `graph_node_types` / `graph_edit` 工具描述点明 `anim.2d` 的完整口径——序列图接 `in`、`animRows` / `animCols` 逐格切帧、`animGifFps`（1–24，默认 0 = 只切帧）> 0 时经 `out-gif` 产出 GIF 并落盘为工程资产；② 新增 GraphSkill `anim2d.frames`（「2D 帧动画（GIF）」）：系统提示复用 `resolveFrameAnimGenSystemPrompt`（与节点内图同一份），生成指令为动作描述模板（`{action}` / `{rows}` / `{cols}` 由 `applyGraphSkill` 插值），并为 `GraphSkill` 增加可选 `usageZh` / `usageEn`——**只渲染进 dsh 的 SKILL.md「用法」段**（讲怎么把能力变成产物），不进节点 `params`，因此不会污染生成提示词；`SKILL.md` 反向导入同步解析 usage，导出 / 导入往返保真；③ 新增 AI 工作流预设 `anim2dGif`（图片节点出 1 行 4 列行走序列图 → `anim.2d` 设 `animGifFps: 12` → 说明节点），中英文案同步，`workflow_list_presets` 里 Agent 直接可见可选

- **对话里模型返回的 Markdown 真的会渲染（此前是纯文本：`**加粗**`、列表、代码块、表格都按字面字符显示）**：助手气泡走的是一条自定义富文本链路——只做 HTML 转义、把 `@路径` 变成文本 chip、把图片路径变成卡片，Markdown 语法一律当普通文本，`.bubble` 的 `pre-wrap` 只是把换行显示出来，于是模型精心排版的回答在界面上是一坨带星号的原文。现在助手气泡接上完整 Markdown 渲染，解析与安全策略收敛在新的共享纯函数层 `src/shared/chatMarkdown.ts`（marked 解析 → HTML 字符串，不依赖 DOM，可在 node 环境直接单测）：标题 / 列表 / 引用 / 表格 / 分隔线 / 粗斜体 / 行内代码 / 代码块（语言标注 + 复制按钮）/ 链接 / 图片全部支持；用户输入、状态行与提问卡**刻意不解析**（走同一份渲染器的纯文本入口：转义 + 内联引用高亮），免得把用户随手输入的 `*`、`_` 变成排版。**安全边界是这轮的重点**：探针实测 marked 交给各 renderer 的 token 文本**全是未转义原文**（`text` / `code` / `codespan` / `image` 皆如此，默认实现之所以安全是因为它自己会转义），因此每个 renderer 自行转义，漏一处就等于把模型输出里的 `<` 当标签用；原始 HTML 一律丢弃（marked 默认会把 `<script>` / `<img onerror=…>` 原样透传），链接只放行 `http(s)` / `mailto` 且**先做实体解码再判协议**（`JaVaScRiPt:`、`java&#115;cript:`、`java&#9;script:` 都按纯文本落地），图片只认工程内 / 本地路径并统一走既有的 `img[data-src]` 管线（真实 URL 由渲染层解析，不接受模型给定的 src），图片卡片本体由 `<div>` 改成 `<span>` 以免块级元素出现在 `<p>` 里被浏览器拆包。既有的 `@路径` chip 与 `@image:` 图片卡片语义原样保留，且**代码块内的 `@路径` 不再被替换**（替换只发生在普通文本 token 上）。代码块右上角带复制按钮：节点由 v-html 注入、数量不定，因此用事件委托处理，代码原文直接取同组 `<code>` 的文本，不必把内容再塞进属性；链接带 `target="_blank"`，点击走主进程既有的 `setWindowOpenHandler` → `shell.openExternal` 到系统浏览器。解析器实例与渲染结果按「文案 + 原文」缓存，流式逐帧刷新时不再反复重建解析器。验证：新增 12 项单测（基础语法、转义、原始 HTML 丢弃、危险协议与实体绕过、内联引用与图片卡片、代码块内不替换、缓存与文案切换），`typecheck` / `lint` / `check:cjk` / 全量单测通过

- **SVG 进资产库并新增「SVG 动画」节点（矢量图从「只能当图标」变成可动、可导出 GIF 的素材）**：`.svg` 此前不在导入白名单（`src/shared/import.ts` 的 `IMAGE_EXT` / `IMPORTABLE_EXTENSIONS`），既导不进资产库、也扫不进素材库；即使手动放进工程目录也没有任何节点能处理它。本轮把 SVG 按图片资产入库，并补上一个把 SVG 动画落成 GIF 的节点。**资产侧照 PSD 的先例走「image 家族的特殊子格式」**（不新增 `AssetType`——那要同步约 20 处，而 SVG 需要的只是「不走位图缩略图链路」），但两者的取舍正好互为镜像：PSD 是 Chromium 与 `nativeImage` 都解不出（要靠 `psdCompositeService` 用 ag-psd 合成出 PNG 才能看到画面），SVG 却是 **Chromium 能直接当 `<img>` 渲染、而 `nativeImage` 解不出**——所以它不需要任何解码服务，只需要让开缩略图链路：新增 `isVectorImageFilePath` 判定，`thumbnailService` 的 `isThumbnailableMediaPath` / `loadNativeImageSync` / `ensureImageThumbnail` 与 `projectService.getAssetPreviewUrl` 一律直接放行原文件，`resolvePreviewMediaPath` / `resolveAssetPlaybackUrl` 按 GIF 同一口径（「预览必须读原文件」）走原文件，`studioMediaProtocol` 补 `image/svg+xml`，视觉打标与「一键抠图 / 智能构图 / 提取 UI 部件」这类必须按原文件取像素的能力同步撤掉（打标只在缩略图尺度上跑，矢量图没有那个尺度），图片选择对话框也把 SVG 排除在生成输入之外（下游按原文件字节送模型，位图模型吃不了）。展示口径新增「SVG 矢量图」（`assetDisplayTypeLabel` + 卡片徽章 + 检查器类型行，与 PSD 的「PSD 源文件」并列）。**节点侧新增 `svg.anim`（note 分类，card: media）**：入端口接图库 SVG 资产，运行后按动画时间轴逐帧烘焙成 PNG（`out` / `out-all`，可逐帧检查、可继续送后续节点），并合成 GIF 从 `out-gif` 产出、落盘为工程资产，Inspector 给帧数（2–60）/ 取样时长 / 输出宽高 / 背景（透明 / 白 / 黑）四项参数与帧序列播放预览，另有「导出 GIF」按资源库保存对话框选目录与命名（与 `anim.2d` 同一条链路）。**逐帧导出必须「先求值、再烘焙」**：`<img>` 里的 SMIL 动画无法 seek——把带 `<animate>` 的文档序列化出去，它在 `<img>` 里会从 0 重播，直接 `setCurrentTime()` 拿到的又是「动画还在文档里」的活文档、进不了 canvas；因此新增共享纯函数层 `src/shared/media/svgTimeline.ts`（SMIL 时间语义：clock-value 解析、`begin` 偏移、`repeatCount` 取模、`fill="freeze"` 冻结、`values` / `from&to` / `from&by` / `to&by` 关键值推导、`keyTimes`、`calcMode` 的 discrete 分段语义、数值 / 颜色 / 多数值逐段插值、动画周期探测，19 项单测锁住——其中 `discrete` 按「n 段等长区间」而非「n-1 个点」求值、`to & by` 的起点是 `to - by` 两处都是实测出来的语义偏差），渲染层 `features/graph/model/renderSvgFrames.ts` 负责克隆文档 → 逐元素求值写属性（`animateTransform` 按文档顺序拼成一条 `transform`）→ **移除全部动画元素**（保证帧可复现）→ 补 `width` / `height` / `viewBox`（`<img>` 加载无固有尺寸的 SVG 会退化成 300×150）→ `data:image/svg+xml` → canvas 栅格化。能力经 `NodeExecuteContext` 新增的 `renderSvgFrames` 注入（与 `composeGifFrames` 同构的能力缝：引擎透传 + 运行会话与任务 runner 两处注入），GIF 编码完全复用既有 `media/gifEncode`，本节点不新增一行编码逻辑。**已知边界**：`keySplines` 缓动按 linear 处理、`<animateMotion>`（需要路径求长）不参与求值、SVG 内的外链资源（`<image href>` / Web Font）在 data URI 下不会加载、`<text>` 依赖本机字体

### Changed

- **「SVG 动画」节点改名为「SVG 烘焙」（职责写清为「矢量源 → 位图序列」，接口一律不动）**：`svg.anim` 的实质是「把矢量源落成可导出、可进下游链路的位图」，旧名却把它说成「动画」——而 SVG 是否自带 SMIL / CSS 动效由生成模型自由发挥，静态 SVG 同样能接（执行侧本就是双态：`renderSvgFrames` 探不到动效周期时只栅格化 1 帧，`composeSvgAnimGifOutput` 也不产 GIF），于是「没动画的 SVG 接进去没用」的错觉与「动画是它的专属前提」的误解都来自命名。现只改展示层与元数据：节点 `label` / `defaultTitle` 与 `graph.types.svg.anim`（中「SVG 烘焙」/ 英「SVG Bake」）改名，节点描述、`graph.svgAnim.inspectorHint` / `preview` / `zeroHint` 与 `svg.gen` 的检查器提示一并重写为「含动效出 N 帧 + GIF，无动效只出 1 帧、不产 GIF」，并同步 `graphNodeTypeI18n` 的断言与相关代码注释；`typeId` 仍是 `svg.anim`，端口（`in` / `out` / `out-all` / `out-gif`）与参数不变，老工程连线与既有节点不受影响

- **`asset_import` 的描述漏写 PSD / SVG / 3D 模型（Agent 因此不知道矢量图能进库、能接烘焙）**：MCP 工具 `description` 与 `docs/MCP.md` 的工具表都只写「图片 / 视频 / 音频 / 文本」，而导入白名单 `IMPORTABLE_EXTENSIONS` 实际含 `psd` / `svg` / `glb` / `gltf` / `fbx`——`.psd` 与 `.svg` 各自的主题条目都写了「可经 `asset_import` 进素材库」，唯独对外的工具描述没跟上，于是「导入素材 → 看画面（PSD）/ 接 `svg.anim` 烘焙位图（SVG）」这条链路在 Agent 眼里不存在（它只看得见工具描述，看不见 CHANGELOG）。现补齐为「图片（含 PSD / SVG 矢量图）/ 视频 / 音频 / 3D 模型 / 剧本文本」，并点明导入的 SVG 归图片资产、可直接接入 `svg.anim` 烘焙节点转位图序列。纯描述改动，白名单与链路不动

- **右键菜单把「SVG 生成」「SVG 动画」两个节点收进「图片」分组**：新增 `svg.gen` / `svg.anim` 时它们只落在节点定义上（`category: 'note'`），画布右键菜单的分组表 `CONTEXT_MENU_RESOURCE_GROUPS`（`NodeGraphEditor.vue`）没有登记，于是两个矢量节点被当成「无资源归属」留在根菜单末尾，与「图片」分组里的 `asset.image` / `image.select` 分家——它们产出的本就是图片家族的 SVG 资产。现在把两者并入 `image` 组的 `typeIds`，`CONTEXT_MENU_GROUPED_TYPE_IDS` 与 `rootAddableMenuItems` 自动跟随（同一份声明派生，无需另改），右键「图片」子菜单即可直接新建 SVG 生成 / SVG 动画节点

- **对话面板的三种模式从「给模型的一句话」变成工具面硬约束（Ask 下应用自己的创作工具一个都不给，Plan 未确认前只给只读）**：Ask / Plan / Craft 此前只写进 persona——`ask` 的 `Do NOT call any MCP tool` 是请求而非约束，模型不听话时照样能改工程、能发起生成（生成要花额度、产物不可逆），「说好不改还是改了」比没有这个模式更伤信任；同一段代码里原生工具（`ask_user_question`）早就做了工具面禁用，MCP 这一侧却始终没对称处理，而会改文件、会花钱的恰恰全在 MCP 侧。本轮把模式提升为协议级约束：`writeDshConfig` 每轮重写 mcp-client 配置时把模式与本次运行 id 写进请求头（`X-AIArt-Mode` / `X-AIArt-Run-Id`），MCP 服务端按请求头收窄 `tools/list` 并直接拒绝越权的 `tools/call`（工具列表里没有的东西被调用——模型幻觉或陈旧清单——同样挡住，收窄不只是「看不见」）。分级与文案收敛在共享纯函数层 `src/shared/mcpModeAccess.ts`：53 个工具分 **read**（只读，含 `timeline_preview` / `asset_qc` / `ask_user`）、**write**（改工程 / 资产 / 文件 / 任务）、**generate**（花额度：`generate_*` / `workflow_plan` / `transcribe_audio`），**未登记的工具一律按 write**（新增工具默认受 Plan 首轮限制，忘登记只会「暂时不可用」而不会变成越权口子）；**Ask 不给任何工具**（连只读也不给，与 persona「用你自己的知识回答」同义），**Plan 未确认前只给只读**（规划阶段要能读工程，否则计划都是空想），**Craft 不限制**。Plan 的「用户已确认」在 MCP 侧按 runId 回查：用户经 `ask_user` 给出任何非「取消」的选择即置位（取消词兜底匹配 `cancel` / `取消` / `放弃` 等，取消与超时都不放行），进程退出或启动失败即释放，因而确认只在本条消息内有效。被模式拦下的调用照记审计日志（模型试图越权本身就是值得回查的线索），拒绝文案写成给下一步的指引而不是干巴巴的 forbidden。**边界刻意划清：模式绑在请求上，不做成服务的全局开关**——面板与外部 Agent（Claude Code / Codex，经 stdio 桥或 HTTP 直连）共用同一个 MCP 服务，后者不带这两个头即不受任何模式限制，面板切到 Ask 不会影响你挂到别的客户端上的用法。首轮真机运行还踩掉一处配置期崩溃：请求头的值在 `cordis.patch.yml` 里裸写 runId 会被 YAML 解析成 number，而 dsh-mcp-client 的配置 schema 是 `z.dict(String)`——实测报 `$.x-aiart-run-id expected string but got 1`，整棵插件树加载失败，面板上表现为每次发消息都「dsh 异常退出」（不限模式，runId 恒为数字；该特性因此从没真正跑起来过）。现在头载荷改由 `accessHeaders` 以数据产出（值类型锁死为 string）、再统一经 `yamlScalar` 序列化，手拼字符串与类型要求不再需要人工对齐（同款 schema 校验实测：数字 `1` 被拒、字符串 `"1"` 通过）。验证：`typecheck` / `lint` / 全量 1921 项单测通过（新增 11 项：分级判定的模式矩阵与边界、协议层请求上下文透传、模式头载荷的类型不变量）

  边界（本轮只覆盖**应用自己的工具面**）：dsh 还自带一整套原生工具，`--dump-default-config` 实测 headless profile 默认加载 `tool-fs`（文件读写）/ `tool-fs-search` / `tool-bash` / `tool-pwsh`（执行命令，跑在 OS 级 ACL 沙箱内）/ `tool-web` / `tool-subagent` / `tool-skill` 等，它们不经 MCP、也读不到这两个请求头，因此 Ask 模式下依旧可用，只能靠 persona 与沙箱约束。也就是说本轮做到的是「Ask 下应用的创作工具（生成 / 改工程 / 跑任务）为零」，而不是「进程毫无手脚」。要连原生工具一并摘掉，需要在生成的 overlay 里按插件 id 追加 `disabled: true`（注意 headless profile 里 `tool-subagent` 这个 id 出现两次、按 id 修补只能命中其一）或改走 runner 侧的工具表过滤，两条路都得在真机上实测 headless 启动与对话链路后再定

- **dsh（DeepSeek Harness）从 `0.1.1-rc.2` 升到 `0.1.5-rc.2`，自定义 headless runner 随上游 API 迁移**：运行体整棵 `@deepseek-ai/*` 树更新到 0.1.5（`package.json` 精确版本 / lock / `bundle-dsh` 产物重打包 486 包），上游这次动了三处我们直接依赖的东西，逐项跟进——① **流式增量不再落会话日志**：`assistant/chunk` 事件被移除，正文与思考增量改由实时帧事件 `agent/assistant-stream` 推送（`frame.chunk.type` 为 `text-delta` / `reasoning-delta` / `block-start` / `block-end` / `tool-call-delta` / `usage` / `finish`，`frame.type` 为 `start` / `chunk` / `end`），runner 因此拆成两路：增量走实时事件即时写 stdout，工具调用与用量仍按 30ms 轮询会话日志——对外标记口径逐字不变（`REASONING` / `TOOL` / `CONTEXT` 三对 marker 与思考区的开合规则照旧，正文与 marker 写入前一律先闭合思考区，避免「思考区吞掉正文、界面永久等不到 assistant 事件」的老毛病复发）；② **会话日志读取入口改为 `eventAt(seq)`**：`session.events` 数组属性已移除，`flushEvents` / `summarize` 改用 `session.seq` + `eventAt(SessionSeq(seq))` 逐条读取（越界返回 `undefined`，容错边界放宽到 `<=`），`summarize` 里那两行从来没人读的 reasoning 收集一并删掉；③ **`system-prompt` 的配置键由 `persona` 改名 `personaPrefix`**：schemastery 对未知键是**静默丢弃**，不改的话 craft / ask / plan 三种模式口径与工程记忆注入会全部失效且毫无报错（`--dump-config` 实测：旧键只留在组合树里空转），现在新键落地。另对齐官方 runner 的收尾动作：运行结束 `await sessions.flush(agent.session)`（失败只记一行 stderr，不影响已产出的回答），让本轮事件真正落 jsonl、下次 resume 读得到完整历史。Windows 沙箱控制台补丁的命中点也跟着上游搬家：`CreateProcessAsUserW` + STARTUPINFO 编码从 `@deepseek-ai/dsh-sandbox-windows-acl` 抽到了新包 `@deepseek-ai/dsh-win32-process`（旧包里已无 `dwFlags: 256`，补丁原样会静默失配、黑窗复发），运行时补丁与 `bundle-dsh` 同步改为按包名列表「新包优先、旧包兜底」扫描（两处各自幂等），单测补「新位置命中写盘」「新旧同树各自计数」两条用例。`allowScripts` 里 `@deepseek-ai/dsh-subprocess-local` 的版本指纹同步为 `0.1.5-rc.2`。验证：`lint` / `typecheck` / 全量 1910 项单测通过，`bundle:dsh` 重打包成功（闭包 486 包、入口校验通过、控制台补丁命中 1 文件 2 处 spawn），overlay 组合经 `--dump-config` 实测生效（`personaPrefix` 落地、`headless-runner` 被禁用、`aiart-runner` 注入成功）

- **`bundle-dsh` 构建收尾清掉中间暂存目录（不再每次打包在工作区堆一份 130 MB 副本）**：`out/.dsh-stage` 是打包过程中的临时组装树——按运行文件裁剪后的依赖闭包，`out/dsh` 只是它的一份完整拷贝（11970 个文件 / 约 130 MB）；脚本此前只在构建开头清一次、结束时不收尾，于是每跑一次 `bundle:dsh` 就多留一份，实测已积累 131.7 MB 的重复副本。现在成功与失败两条路径都在收尾删除该目录（内容可由 `node_modules` 重新生成，删掉不影响任何产物），删除失败只打一行警告并提示手动路径、不改变构建结论——收尾属于清理动作，不该让一次成功的打包以失败退出，也不该掩盖真正的构建错误

- **PSD 源文件的类型标注与图像能力边界**：素材库卡片徽章、资产检查器「类型」行与预览占位统一显示「PSD 源文件」而不是笼统的「图片」（新增展示口径 `assetDisplayTypeLabel`，后续再扩源文件格式只改一处）；同时撤掉 PSD 上那些必须按原文件取像素才能跑的能力——检查器不再出现「一键抠图 / 智能构图 / 提取 UI 部件」三个区块，素材库右键不再出现「提取 UI 部件」与「帧动画试播」，视觉打标补扫队列也把 PSD 排除（打标只在缩略图尺度上跑，与一次数百毫秒的合成解码收益不对等；此前还会每次打开工程都排一次、只留下永不完成的视觉标签区块）。预览占位文案由「应用内无法预览」改为「未能生成该 PSD 的合成预览」——正常情况已能看到画面，只有解码失败才会走到这句话

- **新增「SVG 生成」节点（`svg.gen`）与 `svg` / `svgs` 端口类型**：文本模型按生成指令产出 SVG 源码，落盘为工程内 `.svg` 资产（主进程按 `image/svg+xml` 落 `.svg`，缩略图与预览复用图库 SVG 资产的既有链路），`out` 出选中结果、`out-all` 出历次结果。双击节点卡片即展开生成指令框（内置扁平图标 / 徽章图标 / 加载动效 / UI 按钮 / 图标动效 / 扁平插画六套预设），右侧检查器可调画布宽高、背景与系统提示词。同时新增 `GraphSvgItem` / `GraphSvgValue` / `GraphSvgsValue` 值类型，`svg.anim` 的输入口由 `image` 改为 `svg` 以消费该节点的输出；为不打断既有工程，`portsCompatible` 放行 `image → svg` 单向兼容（图库 SVG 资产的引用节点只出 image 口），内容确实不是矢量时由执行期明确报「SVG 源不可读」。**本轮补上参考图输入**：`svg.gen` 新增 `in-image` 图片端口（`multiple`，可多连），上游图片节点与图库图片资产可直接接进来，执行时经 `collectIncomingImageItems` 收集、`resolveImageUrls` 解析成模型可消费的 URL（最多 4 张，`SVG_GEN_REFERENCE_MAX` 截断），随请求作为多模态 `images` 与指令一同送出，并在提示词末尾追加一句参考图说明（`buildSvgGenReferenceInstruction`，中英同步）——「照着图片生成矢量图」不必再先把图转成文字。未接图片时 `images` 参数完全不出现（沿用纯文生 SVG 路径），既有工程不受影响；节点描述与检查器提示同步注明该图片端口

### Fixed

- **dsh 异常退出被工具事件掩盖（对话面板表现为「这一轮什么都没发生」）**：`launchDsh` 的收尾判定是 `code !== 0 && !sawOutput`，而 `sawOutput` 会被任何工具事件（文本增量、工具 marker、提问与用量标记）置位——只要这一轮调过工具（哪怕只调一次就崩），非零退出就被当成正常结束：不发 `error`、也没有文本，面板上只剩一张早已 `done` 的 `dsh-agent` 卡（或什么都不显示），用户完全看不出发生过什么。现在失败判定只认「有没有真正产出文本」（`code !== 0 && finalText === ''`），非零退出但已有文本时补一条退出码状态，失败文案再带上「本轮只产生了工具调用、没有文本」，把静默失败变成可读的结论

- **对话流里看不到生成的 SVG（产物卡收不到 `svg` / `svgs` 端口值，纯 SVG 链路整轮零卡片）**：会话侧只能看见 MCP 活动回报的产物清单，而 `collectRunMediaPaths` 的端口值归一化只认 `image*` / `video*` / `voice*` / `output`，`svg.gen` 的 `out`（`svg`）与 `out-all`（`svgs`）落进 `default` 被丢弃——于是「让 Agent 生成一个 SVG 图标」这类只经 `svg.gen` 的链路，运行成功、资产也进了素材库，对话流却一张卡都不出（出位图的链路照旧正常，因为 `svg.anim` 的帧 / GIF 端口是 image 家族）。现补上两个分支：`svg` 取条目自身路径，`svgs` 取**首条**（`commitSvgGallery` 是「新在前」合并，与 image 图库的 append 顺序相反，取末条会把卡片指向最旧的一张），并把 `svg.anim` 的 `out-gif` 一并列进「作品级端口」清单——与 `anim.2d` 的 GIF 同级，同一张图两者都出时不再互相顶掉。产物最终仍由 `ChatAssetPreview` 渲染（其图片白名单本就含 `svg`），渲染链路无改动。验证：`collectRunMediaPaths` 新增 3 项用例（SVG 生成取最新 / 未落盘不进会话 / 烘焙 GIF 与帧动画 GIF 并存），`typecheck` 通过

- **SVG 动画节点双击弹出记事本、三个输出端口挤成三个「图片」**：`svg.anim` 和 `stage.2d` 一样挂在 `note` 分类下，`isNodeTextCapable` 却只放行了后者，于是双击 SVG 动画卡片落进 note 兜底分支——弹出记事本（这个节点根本没有文本产物）。现把 `svg.anim` 一并排除，双击改为与 2D 帧动画同构的「播放 / 暂停烘焙帧」（进入视口自动播放，播放间隔按「采样帧数 ÷ 取样时长」推出的 FPS，不再固定 8fps），卡片悬停提示同步说明。端口侧的毛病在显示名：卡片端口标签只按 `dataType` 翻译，而 `svg.anim` 的 out（选中帧）/ out-all（全部帧）/ out-gif（GIF）三者 dataType 都是 image，于是一起显示成「图片 / 全部 / 图片」，端口定义里写的 `label: 'GIF'` 压根没被用上。现给 `GraphPortDef` 增 `labelKey`（i18n 键，缺省仍按 dataType 翻译），三个端口分别标注「帧 / 全部帧 / GIF」（英 Frame / All frames / GIF）

- **SVG 资产的两处收尾（节点类型名未走 i18n、双击打开了空图编辑器）**：`svg.anim` 的类型名此前只落在节点定义的 `label` / `defaultTitle` 上，而界面里节点类型名走的是 `graph.types.<typeId>`（`useStudioI18n.graphTypeLabel` / `resolveGraphTypeLabel`），缺这一条就回退成原始 typeId——检查器标题、运行日志与任务列表里显示的是 `svg.anim`。现补 `graph.types.svg.anim`（中「SVG 动画」/ 英「SVG Animation」），并新增用例锁住「每个内置节点类型都有对应的中英文案」。另一处是双击：SVG 归 image 家族后被视为「有编辑器」的图片资产，双击素材卡走的是打开图编辑器（新建的空图里只有默认备注节点，看着就像「打开了记事本」），而应用内根本没有编辑矢量的编辑器。现与 PSD 同口径——`canOpenEditorForAssetId` 对矢量图返回 false（检查器与右键菜单的「打开编辑器」入口一并消失），双击改为 `openFullImagePreview` 直接看原文件（Chromium 能直接渲染 SVG，不需要主进程解码）
- **修复 Plan 模式下 `ask_user_question` 必定失败导致的「计划无法确认」（同一条会话切到 Plan 后模型仍自称 Ask 模式、一个工具都不调）**：面板切到 Plan 后请求头（`X-AIArt-Mode: plan`）与 persona（`You are currently running in Plan mode`）实测都已正确下发、工具面也已收窄（会话记录里逐个 turn 的 `system/message` 与 `request/header` 可查：Plan 轮 45 个工具 = 25 个 dsh 原生 + 19 个 `mcp__studio__*` 只读 + `ask_user_question`；Ask 轮 25 个 = 只剩原生、MCP 工具为零），但模型回复仍是「我现在是 Ask 模式，不能真的跑图」。真凶在应答通道：0.1.5 把 `ctx.userQuestions` 改成了 Cordis waterfall 服务（`ctx.waterfall('user-questions/request', request, noAnswerer)`，见 `dsh-user-questions` 的 `UserQuestionService`），应答方靠监听该事件注册（官方客户端写法 `ctx.remote.$on('user-questions/request', (request, next) => …)`），而自定义 runner 仍按旧 API 调 `userQuestions.registerProvider({ ask })`——服务类上已无此方法，`if (userQuestions?.registerProvider)` 恒为假、**静默跳过连一行日志都没有**，于是应答方为空：`ask_user_question` 一调用就抛 `UserQuestionError: no user-questions answerer accepted the request`（`code: NO_PROVIDER`，会话记录 `tool/result` 原文），而 Plan 的 persona 恰是「先出分步计划 → 调 `ask_user_question` 让用户 Proceed / Adjust / Cancel → 确认后才执行」，这条路一断，模型拿不到确认只能退回纯文字，并顺手沿用 16 秒前 Ask 轮自己说过的「我在 Ask 模式」——用户看到的就是「换了 Plan 还是提示 Ask 模式」。修法：应答方改为在 **agent 作用域**监听 `user-questions/request`（事件按 `scopeTarget(agent, agent)` 派发、签名 `this: Scoped<Agent>`，挂到根 ctx 收不到），返回答案即终止水流、不落服务内置的 `noAnswerer`；提问 → stdout marker → 渲染层选项 → `answerFile` 轮询这条链路原样复用，只补 `request.signal.aborted` 短路（本轮中止时不再干等满 5 分钟）与「异常只记 stderr、返回空答案」的兜底。另在 persona 公共段补一行「本轮说法为准」：同一会话可以逐轮切模式，禁止复述上一轮的模式名、也禁止复述上一轮「工具不可用」的结论（这是本次误报的第二个来源）；Plan 分支再点名禁掉 dsh 自带 `plan-mode` 插件挂出的 `exit_plan_mode`——上游注释写明「工具目录不随模式变化（为请求缓存稳定）」，所以它始终出现在工具面里，但它要求 dsh 自己的 session 处于 plan 模式，面板这套 Plan 调它只会报「exit_plan_mode is only available in plan mode」，是个假出口

- **修复升级 dsh 后同一会话发第二条消息必然失败（界面只报「dsh 异常退出（code 1）」，且重试永远无效）**：0.1.5 把 `SessionPersistence.list()` 的返回从「会话头数组」改成了快照数组（每项形如 `{ header: { id }, revision, sizeBytes }`，见 `dsh-session-persistence-jsonl` 的 `list()`），而自定义 runner 判存仍按旧形状直接读 `h.id`——该字段恒为 `undefined`，于是每次都判定「会话不存在」并走 `agents.create`，撞上磁盘上已有的记录抛 `session "s_xxx" already exists`；进程在写出任何 stdout 之前就退出 1，主进程只看到「非零退出 + 无输出」，界面于是弹出与真实原因毫不相干的通用提示，而会话记录一直留在 `$DSH_HOME/sessions/` 里，所以「请重试」永远不会成功（首条消息能成功，是从零走 `create` 的路径）。判存改为优先 `persistence.stat(id)`——只探查这一条、不遍历整个会话目录（实测：会话目录里任何一条头部与目录名不匹配的坏日志都会让 `list()` 整体抛错，从而连坐掉所有会话），老后端没有 `stat` 时回退 `list()` 并对新旧两种形状都做匹配。实测修复后同一会话 id 打印 `[aiart-runner] resumed session: ...` 正常走 resume（多轮历史恢复），新 id 仍走 create

- **修复图层记录畸形的 PSD 一张画面都出不来（素材卡与检查器一直停在「未能生成该 PSD 的合成预览」）**：`psdCompositeService` 此前只走 ag-psd 的 `readPsd`——`skipLayerImageData` 只跳过图层**像素**，图层**记录**仍要完整解析，而 `readLayerRecord` 一读到 `top > bottom` / `left > right` 就抛 `Invalid layer size`，整份文件直接被判死；偏偏非 Photoshop 工具写出的 PSD 常有这类畸形记录（实测用户导入的 `背包主界面-原神风.psd`：1280×720 / RGB / 8bit，色彩模式与压缩方式都没问题，卡住的只是图层记录），而它的合成图其实完好无损。修法是在直读之后加一层降级：按段长度前缀把 Header / Color Mode Data / Image Resources 原样保留、Layer & Mask 段的长度前缀置 0 整体丢弃、再接上原 Image Data 段重读一次（`stripLayerAndMaskSection`）——合成图与图层本就是彼此独立的段，预览只需要前者；常规文件仍走首次直读、零额外开销，只有两条路都失败才打一行带原因的日志（此前失败原因是静默吞掉的，现场只能看到「解不出画面」）。该刀只对 PSD（version 1）生效：PSB 的段长度是八字节、布局不同，直接放弃并回落系统缩略图兜底。新增用例用「top 被改到 bottom 之下」的畸形图层记录复现该场景，并先断言 ag-psd 直读确实抛错，避免测试退化成重复覆盖直读路径

## [6.1.0] — 2026-09-11

6.1.0 功能版：继续收敛「能力已经在界面里、对话够不到」的缺口——MCP 补齐资产库写入（建文件夹 / 新建 / 导入 / 改名 / 移动 / 删除）、交付出口（转写 / 人声分离 / 对象存储上传 / 资产包导入导出）与时间线读写 + 智能粗剪出片三组工具，Agent 从「能生成」做到「能建、能剪、能出片」，并补上资产规范质检与安全返工；2D 侧新增动作帧序列 / sheet 节点产物与 Spine 骨架包导出，GIF 产物接进工作流与对话流（对话流里的动图真正会动、`@` 引用选择器单列 GIF 一类）；另修掉资产库元数据旁挂、dockview 升级导致的 Studio 布局塌陷、Windows 沙箱命令弹窗三处缺陷。

### Added

- **MCP 资产库写入工具族（资产库从「只能读」补齐为「可建 / 可归档 / 可整理」）**：此前 MCP 工具面在资产侧只有 `asset_list` / `asset_read_file`（只读）与 `asset_write_text`（只改文本内容）——Agent 能生成内容、能编排节点图，却**建不了资产、导不进来素材、改不了名字、归不了档、删不掉废件**，想整理一次素材库只能让用户回界面手点。本轮补齐 6 个工具，全部复用既有主进程服务（`projectService` 的 `createFolder` / `createAsset` / `importAssets` / `renameAsset` / `updateAsset` / `deleteAsset` / `findAssetReferences`），零新增旁路实现：`folder_create`（建资产库文件夹并返回 `folderId`）、`asset_create`（按白名单新建数据 / 占位型资产：剧本 / 策划案 / 世界观 / 分镜 / 子图 / 自由画布 / 图片 / 视频 / 声音 / 2D 动作，白名单刻意排除需要专用编辑器写入的 `motion` / `model` / `model3d`，避免造出界面上无从编辑的空资产）、`asset_import`（把本机绝对路径的图片 / 视频 / 音频 / 文本导入资产库，单次上限 50 条并返回逐条 `skipped` 原因）、`asset_rename`、`asset_move`（媒体文件随目录搬移，返回搬移后的相对路径）、`asset_delete`（删除前先跑 `findAssetReferences`，被引用时默认拒绝并回传引用来源，确认后传 `force: true`；与界面删除同口径，只移除资产元数据、源媒体文件保留在工程目录）。类型白名单与导入路径归一化抽到共享纯函数层 `src/shared/mcpAssetWrite.ts`（7 项单测覆盖白名单边界、去重保序、非数组入参）
- **资产移除 / 目录变化的跨窗口同步通道（对话侧改动即时反映到界面）**：此前主进程只有 `asset:updated`（新增或更新）一条资产广播，删除与文件夹变化没有通道，旁路工具（MCP / 外部 Agent）删完资产后界面卡片会残留。新增 `ASSET_REMOVED`（载荷为资产 id → 渲染层 `removeAssetLocal`）与 `FOLDERS_UPDATED`（载荷为空 → 渲染层 `refreshFolders`）两条主进程 → 渲染层广播，preload 暴露 `onAssetRemoved` / `onFoldersUpdated`，`App.vue` 统一订阅并在卸载时解绑；`asset_create` / `asset_import` / `asset_rename` / `asset_move` 与 `folder_create` / `asset_delete` 落库后即时广播，界面素材库与目录树随对话操作同步
- **MCP 交付出口工具族（转写 / 人声分离 / 对象存储上传 / 资产包导入导出）**：继续收敛「应用内已实现、对话够不到」的缺口。`transcribe_audio`（工程内音频 / 视频转写成带时间戳分段，可作台词表与字幕底稿）、`audio_separate`（人声 / 伴奏分离，产物落 `Cache/Separated/`，不登记资产库）、`storage_upload`（工程内媒体上传对象存储，返回可分享 URL，用于交付与外部评审）、`asset_package_export`（打包 `.aipackage` 交付包，可选依赖资产与生成缓存）、`asset_package_import`（导入交付包，可按 guid 选子集、回传逐条 导入 / 复用 / 重映射 报告）。安全边界：媒体类工具只接受 `assetId` 或**工程内相对路径**，绝对路径与 `..` 越界一律拒绝（`normalizeProjectRelativePath` 共享纯函数，单测覆盖绝对路径 / 越界 / 反斜杠归一化）
- **资产包导出支持无界面写入（`ExportAssetPackageInput.targetPath`）**：`exportPackage` 此前必经系统「另存为」对话框——主进程侧 MCP 调用会挂起等待用户点确认，Agent 实际用不了这条能力。新增可选 `targetPath`：传了就跳过对话框直接写入该绝对路径（自动补 `.aipackage` 扩展名并创建父目录），不传仍走原对话框流程，界面与 Agent 两条链路互不影响

- **MCP「渲染层能力作业」通道 + Spine 骨架包导出 / UI 部件提取**：第三刀继续收敛「能力在渲染层、对话够不到」。新增通用作业通道 `mcp:render-job`——主进程按 `kind` 派发、渲染层执行后回报（5 分钟预算 / 800ms 轮询；界面未响应时直接报错，不返回空壳成功）。首批接入两项能力：`stage2d_spine_export`（把 2D 舞台节点的落盘装配导出成 Spine 骨架包：挂点部件按放置计划裁成独立透明 PNG 页，加 `skeleton.json` 与 `.atlas`，落 `Assets/2D/Spine/<包名>/`）、`ui_kit_extract`（整屏 UI 图按框选矩形逐部件裁 PNG 落 `Assets/UIKits/<源图名>/`，并写 `ui-kit.json` 九宫格清单，含每部件 border / safe 边距）。渲染层用 `Record<McpRenderJobKind, …>` 让「主进程声明的 kind」与「渲染层实现」在类型层强绑定——漏写实现直接编译失败；两项能力与编辑器弹窗共用同一套共享层归一化（`normalizeUiKitDocument` / `readStage2dRigFromNode`），并沿用「图编辑器打开时拒绝导出」的口径，避免导出编辑器里未落盘的旧装配

- **MCP 资产规范质检 + 安全返工（`asset_qc` / `asset_qc_fix`）**：第四刀补上「引擎就绪」的本地判定能力，与 `media.review`（视觉模型判画面语义质量）互补——这边全是本地算法、不耗模型。共享层新增 `gameAssets/assetQc.ts`：四边泛洪求主体内部透明孔洞（抠图漏底，画布四周的正常留白不误判）、半透明过渡带的近白 / 近黑残留与**边缘亮度偏移**（`lumaDelta`：羽化边缘天然是前景与背景的混合色，比「纯白像素计数」灵敏得多）、孤立半透明碎屑、主体贴边可能已被裁切、空图、尺寸超 8192、命名规范（可选，默认不查，存量中文名不该被刷屏）。冒烟时抓到一个真实缺陷：「有内容」的 alpha 阈值（8）被误用成「实心」阈值，导致 alpha≈128 的羽化边缘被算作实心、半透明统计恒为 0——现已拆成 `alphaSolid` / `alphaOpaque` 两个语义，单测 16 项锁住。返工只做安全项：复用 `yoloCutout.defringeRgba` 剔掉边缘残留的背景色，产出**新资产**落 `Assets/QC/<原名>/` 而不覆盖原件，并在返回值里给出修复前后的指标对比（可验证闭环）；孔洞 / 贴边 / 命名只报告——镂空可能是刻意设计，改画布与改名都会动到下游引用。渲染层经 `asset-qc` 作业通道执行（单次上限 40 个资产），工具面 46 → 48。

- **MCP 时间线读写与智能粗剪（`timeline_read` / `timeline_rough_cut` / `timeline_export`）**：第五刀把成片时间线接进对话——此前时间线只在界面里手工拖拽，Agent 既看不到轨道内容、也不能按转写收紧节奏、更不能出片。三个工具：`timeline_read`（读片段 / 设置 / 总时长，可按轨过滤）、`timeline_rough_cut`（**智能粗剪**：按配音转写把静默挤掉，默认 dry-run 只回计划，`apply: true` 才落盘）、`timeline_export`（ffmpeg 合成成片，无界面链路走 `targetPath`）。粗剪算法落在共享纯函数层 `shared/graph/timelineCut.ts`（18 项单测）：转写分段是**源文件时间戳**，先经片段 `sourceOffsetSec` 平移到轨道时间，再按呼吸边距扩张、合并重叠，最后与「配音轨覆盖区」求差集得到待剪静默（短于阈值的停顿不剪，避免把节奏切碎）；`planRippleCut` 做**全线 ripple 前移**——与删除区间相交的片段被切分且保留子段各自重算 `sourceOffsetSec`（画面 / 声音取到的仍是源文件里对应的那段），字幕 / 音乐 / 特效轨同步跟随，转场与淡入淡出只保留在片段真正的首尾（切分产生的中间子段清空，免得剪辑点冒出莫名转场）。边界刻意保守：**只动配音轨覆盖的时间段**，配音轨之外（空镜、纯音乐）一律不碰；某条配音片段一句语音都没匹配上时**整段保留**、只回 warning——纯音乐 / 环境音 / 转写时间戳对不上，都不该被误剪，宁漏剪不误剪。落盘沿用既有「编辑器打开时拒绝」口径：新增 `openTimelineEditors` 占用登记（时间线编辑器挂载即登记、换剧本资产随迁、卸载注销），远端写入撞上编辑器一律拒绝并说明理由，避免与编辑器的自动保存互相覆盖。`TimelineExportInput` 顺带补 `targetPath`（不给仍走「另存为」对话框，界面链路不受影响）。工具面 48 → 51。

- **MCP 时间线编辑工具 `timeline_edit`（铺轨 / 改片段 / 重建字幕，把时间线从「能读能剪」补到「能写」）**：上一刀打通了读、粗剪、出片，但 Agent 仍然**铺不了轨**——拿到一个空时间线就什么也做不了（粗剪要配音轨已存在，导出要片段已存在）。本刀补上写入侧，四类指令按 `operations` 顺序执行：`add`（铺素材上轨，每枚给 `track` 与 `durationSec`，`assetId` 自动补媒体路径与标题；缺 `startSec` 时排到该轨轨尾、同批多枚依次紧接，`gapSec` 留空隙）、`update`（按片段 id 改 text / startSec / durationSec / volume / fadeInSec / overlayX 等，**传 `null` 清除字段**——JSON 表达不了 undefined，取消转场需要一条正经通道）、`remove`（按 id 批量删）、`subtitles`（把 `transcribe_audio` 的分段按配音片段的取段起点对齐铺成字幕，默认替换该配音区间上的旧字幕，避免重复生成时字幕堆积）。新增共享纯函数层 `shared/graph/timelineEdit.ts`（29 项单测）：`id` / `track` 刻意不在可改字段里（换轨等于换片段，避免把图片搬到 voice 轨），数值一律夹取到合法区间、只有「时长 ≤ 0」算无效指令，草稿 id 冲突自动加 `~n` 后缀而不是覆盖既有片段，结构不完整的脏片段原样留着不参与排布（绝不顺手丢数据）。字幕生成同时从渲染层 `features/script/timelineSubtitleFromTranscription.ts` **下沉到共享层** `shared/graph/timelineSubtitle.ts`（编辑器与 MCP 共用一份，零口径分叉），并顺手修掉一个既有缺陷：转写时间戳是**源文件时间**，此前未减去片段 `sourceOffsetSec`，配音片段只取源文件中段时字幕会整体前移（缺省 0 时行为不变，故存量不受影响）。**错误分级**：`op` 不认识、缺 `durationSec` 这类「API 用错」直接抛错让调用方重发；id 找不到（粗剪会切分并改名 `clip-1` → `clip-1~2`）、时长非法这类「数据问题」只记入 `failures` 继续跑其余指令——批量编辑里一条 typo 不该让整批白干，但失败项必须逐条回报、绝不静默跳过。工具面 51 → 52。

- **MCP 图片通路 + 时间线抽帧预览 `timeline_preview`（让 Agent 真能看到成片画面）**：前几刀把时间线打通到「能铺轨、能剪、能出片」，但 Agent 全程只能看到数字——它没法确认自己铺的画面对不对。本刀先补一条**图片通路**：MCP 协议层 `McpToolCallOutcome` 新增可选 `images`，响应里拼成 `content: [{type:'text'},{type:'image',data,mimeType}]`——多模态客户端能直接看到画面，纯文本客户端只会读到文本，不会因此失败（工具把图放在结果对象的 `mcpImages` 键上，在交给协议层之前摘出来：base64 不混进文本结果，也不会被审计日志记下）。在此之上新增 `timeline_preview`：用**导出同一条 ffmpeg 滤镜图**抽帧，转场 / 画中画 / 烧录字幕 / 水印都会出现在画面里——预览看到的就是成片，不是另画一套近似的预览。为此把 `encodeTimeline` 的输入准备与滤镜图构建抽成 `prepareTimelinePipeline` 供出片与抽帧共用（零口径分叉）；抽帧是**一次解码、多路输出**（`scale` 一次 → `split` → 每帧 `trim` + `-frames:v 1`），不是逐帧 `-ss` 重跑，且不落中间视频、不编码整片。时间点规划 `shared/graph/timelinePreview.ts` 与命令组装（同为纯函数，23 项单测）：默认按成片时长均匀抽 3 帧并**取每格中心**——开头常是淡入黑场、结尾常是淡出，取边界只会拿到黑帧；也可用 `atSec` 定点检查某一刻，越界夹取、重复合并、超上限截断，每次都如实回报。输出 JPEG 而非 PNG（单帧体积小一个量级），帧宽 160~1280 可调。工具面 52 → 53。

- **2D 帧动画 GIF 导出改为「先选资源库目录」（动图不再只能落进固定目录）**：检查器的「导出 GIF」此前只有一条落点（节点输出目录，缺省 `Assets/2D`），想放进别的资源库文件夹只能先导出、再自己去素材库里挪。现在点「导出 GIF」先弹既有的资源库保存对话框（`SaveAssetDialog`：资产库文件夹树 + 文件名），确认后按「合成 → 缓存暂存（`<cacheRoot>/Gifs`，不进资产库）→ `saveProjectAsset` 复制进所选文件夹并登记为图片资产 → 刷新素材库」落盘，结果提示资产库内相对路径。与 CutoutDialog / ComposerDialog 的「保存到资产库」共用同一条链路与同一套对话框，零新增旁路实现；取消对话框不产生任何落盘。接线契约测试锁住「按钮只开对话框、点击时不动磁盘」「确认回调四步顺序与 `folderId` 来源」「取消不落盘」，中英文案同步

- **AI 对话 `@` 引用选择器把 GIF 单列一类（动图不再淹没在一堆静态图里）**：GIF 在资产模型里仍是 `image`——缩略图、图谱节点、执行链路、批量导入判定一律不动（新增全局 `AssetType` 会牵动这些链路，收益却只是换个筛选标签）。改的是选择器自己的**筛选维度**：`@` 弹窗此前只有「全部 / 图片 / 视频 / 音频」四档，工程里 GIF 一多就只能在整库静态图里翻，现在新增「GIF」一档并与「图片」并列，卡片右上角徽标从笼统的「图片」改为「GIF」、无缩略图时占位图标用 🎞️，各档计数与空态 / 副标题文案（图片 / GIF / 视频 / 音频）同步。分类判定复用共享纯函数 `isAnimatedImageFilePath`（与对话流「动图预览必须走原文件」同一口径，将来动图格式扩到 `.webp` / `.apng` 时两处同时生效），非图片类型原样归类，视频 / 音频筛选行为逐字不变；中英文案同步

### Fixed

- **修复写进资产库的文件拿不到旁挂元数据（部件页「磁盘上有 PNG、素材库里没影」）**：`saveGraphRunMedia` / `saveGraphRunText` / `attachExternalGeneratedFile` 的「是否登记为资产」判定基于**入参字符串**，而落盘目标由 `join(root, dir)` 解析——两者对 `outputDir` 写法的容忍度并不一致：`normalizeProjectRelativeDir` 不去前导斜杠，于是 `/Assets/UIKits/x`（Agent 直传的 `ui_kit_extract.outputDir`、节点参数里手填的输出目录都可能是这种写法）被解析成 `<工程>/Assets/UIKits/x` **真的写进资产库**，而 `isUnderAssetLibraryDir('/Assets/UIKits/x')` 判否 → 不写 `.asset.json`、不建目录链、素材库扫不到，作业却照旧返回成功（MCP 部件导出因此表现为「跑完了但没有部件」）。修法三层：① `normalizeProjectRelativeDir` 一并去掉前导 `/`（绝对式写法按工程相对目录处理，写盘与判定同源）；② 主进程三处落盘改用**实际写入目录**（由落盘绝对路径反推）调用新共享纯函数 `shouldRegisterOutputInAssetLibrary`，判定不可能再与写盘分叉，库外目录统一「只落盘 + 返回内存 AssetInfo」（原先在库外目录也会登记，重启后资产凭空消失）；③ MCP 渲染作业侧把 `ui_kit_extract` 的 `outputDir` 归一后强制限定在资产库内（否则直接报错并给出默认目录），并在落盘后复查部件确实进了素材库（`assertPartsImported`）——「半成功」变成可读错误，不再静默。单测补前导斜杠 / 反斜杠 / 缓存根三组门禁用例
- **修复 dockview-vue 7.0.4 升级引发的 Studio 主窗口布局塌陷（竖栏贴左边、中间面板消失、点击无响应）**：`aae92b0` 把 `dockview-vue` 由 7.0.2 升到 7.0.4（为修掉「侧栏拖拽叠放后出现灰洞」），但 7.0.4 起 `DockviewVue` 的根节点从单个 `div` 变成 Fragment（dock 容器 `div` + 面板 Teleport 宿主），而 Vue 只会把父组件的 scoped 属性写到「单根」子组件的根元素上——内层 `div` 因此只拿得到 `class="studio-dock"`、拿不到 `data-v-*`。`StudioView.vue` 里 23 条 `.studio-dock …` 的 scoped 规则（含 `flex: 1; min-width: 0; min-height: 0`）编译成 `.studio-dock[data-v-*]` 后全部失配：dock 被压成 0 宽，竖栏成为唯一占据宽度的元素而贴到最左，中间整片空白且点不动（`readDockWidth` 取到的宽度、拖放后的 overlay 清理、`.studio-side-collapsed` 压制规则同时失效）。修法是让规则从本组件自己的元素穿下去——全部改写为 `.studio-main :deep(.studio-dock …)`，编译结果 `.studio-main[data-v-*] .studio-dock …` 稳定命中（特异性还提高一档）；dock 的 `flex: 1` 回归后竖栏自然回到最右，无需改动 DOM 顺序。新增守卫测试 `tests/studioDockScopedStyle.test.ts` 锁住这条约定与「dock 在竖栏之前」的顺序
- **Windows 沙箱命令不再弹出控制台窗口（补齐 6.0.0 那处修复漏掉的沙箱链路）**：6.0.0 修掉了「执行命令时反复弹出的命令行窗口」，但那只覆盖非沙箱命令——预载 hook（`dshHideChildWindowsHook`）只能改 Node `child_process` 的 `windowsHide`，而 Windows 沙箱（`@deepseek-ai/dsh-sandbox-windows-acl`）的子进程由原生 `CreateProcessAsUserW` 以受限令牌创建，并且**刻意不用** `CREATE_NO_WINDOW` / `CREATE_NEW_CONSOLE`（上游 spawn 模块注释与实测一致：受限令牌下带控制台隔离的子进程会在 DLL 初始化阶段以 `STATUS_DLL_INIT_FAILED`（`0xC0000142`）死掉）。于是宿主（GUI 主进程 → dsh）没有控制台可共享时，受限子进程只能新建一个控制台，表现就是每执行一条沙箱命令弹一次黑窗。本轮新增 `src/main/services/dshSandboxConsolePatch.ts`：把沙箱 spawn 的 `STARTUPINFO` 由 `STARTF_USESTDHANDLES`（256）改为 `STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW`（257）并置 `wShowWindow = SW_HIDE`（0）——只影响「新建控制台窗口如何显示」，受限令牌、沙箱模式、stdio 管道与 fail-closed 语义全都不动；若子进程最终共享了某个已有控制台，该标志不产生任何作用。落地两条：运行时在下拉 dsh 前对解析到的 dsh 依赖树打补丁（幂等，同一棵树只尝试一次；写盘失败只记一行日志，绝不影响对话），`scripts/bundle-dsh.mjs` 同步在 `out/dsh` 产物里预置同一处改动（安装目录只读时也能生效）。上游修好或换实现后本补丁自动失效：匹配不到调用点即静默跳过，绝不抛错。8 项单测锁住改写口径：两处 spawn 变体（管道 stdio / 继承 std handle）都改、缩进与其余字节逐字不变、幂等、结构体声明与无 `dwFlags` 的编码点不动、真实产物改写后仍是合法 ESM（`node --check`）、临时依赖树落盘与「已补丁」二次判断、构建脚本与运行时补丁的字面量防漂移。

- **AI 对话流里的 GIF 现在会动（消息卡不再只显示静态首帧）**：资产卡与消息气泡内 `@路径` 图片卡统一走 `getAssetPreviewUrl`（图片缩略图优先），而缩略图是 `nativeImage` 解码后写的 PNG——动图只剩第一帧，GIF 产物在对话里永远定住不动；点击大图预览因为取的是原文件，一直是动的，两者表现不一致。本轮把渲染层既有的「动图必须走原文件」口径（`resolveAssetPlaybackUrl`，资产媒体预览与资产编辑器在用）延伸到对话流两条渲染路径：新增 `features/media/animatedImagePlayback.ts` 收敛策略，`pickChatImageSrc` 只做 src 决策（动图且已进入播放态 → 原文件，其余一律「缩略图优先、缺失回退原文件」，非动图行为逐字不变），`observeInView` 与 `attachAnimatedImagePlayback` 负责「进入视口才换原文件、离开视口还原缩略图」，避免一屏多张 GIF 常驻解码（rootMargin 200px 提前预载）；`ChatAssetPreview` 用响应式观察（元素挂载后才开始观察、卸载即解绑），v-html 注入的气泡图片卡用命令式版本（节点被移除时自动停表）。动态图未进入视口前仍是静态缩略图占位，不改变首屏 IO 开销。10 项单测锁定决策边界（非动图即使用播放态也不换源、动图未进入视口仍是缩略图、缺原文件回退缩略图、缩略图缺失回退原文件、无 IntersectionObserver 时降级为始终可见、节点已脱离文档时绝不加载原文件）

## [6.0.0] — 2026-09-11

6.0.0 正式版（首个 6.0 稳定版）：内容为 6.0.0-alpha1 预发布验证过的同一批能力的完整快照，把 5.2「智能创作版」～5.5「2D 导演台」几条主线的落地成果一并交付——Agent 侧补齐项目级记忆、角色音色 / 声音克隆、智能粗剪与视频级媒体理解；本地视觉侧把内置 YOLO 从「能力底座」做成素材打标 / 一键抠图 / 精灵统一对齐等日常工具；2D 侧从舞台场景、骨骼装配摆姿一路做到动作资产容器、独立试播、帧序列 / sheet / GIF 产物与 Spine 骨架包导出；MCP 与工作流侧补齐节点类型自发现（`graph_node_types`）、单枚图标精修回炉、运行产物回注对话流与 Git 变更预览。相对 alpha1 另含两处 Windows 对话链路修复（执行命令时反复弹出的命令行窗口，以及 `NODE_OPTIONS` 预载路径被反斜杠转义吃掉导致的子进程 `MODULE_NOT_FOUND`）。本版为正式版（非 prerelease），会进入客户端自动更新的 `latest` 通道。

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

- **Windows 上 AI 对话过程中不再频繁弹出命令行窗口**：dsh 运行体的子进程服务（`@deepseek-ai/dsh-subprocess-local`）spawn 时只传 `cwd` / `env` / `stdio` / `detached`，没设 `windowsHide`；而宿主是 GUI 进程（没有控制台窗口），于是 agent 每执行一条命令（`bash -c`、`git`、`node`…）Windows 都会新建一个可见控制台窗口，表现为对话期间反复闪黑窗。上游修好前由启动参数兜底：每次拉起 dsh 前在 dsh home 写一份预载 hook（`aiart-hide-child-windows.cjs`），把 `child_process` 各启动 API（`spawn` / `spawnSync` / `fork` / `exec` / `execFile` / `execSync` / `execFileSync`）的 `windowsHide` 默认置为 `true`——只改这一个默认值，参数形态、返回值、事件语义与调用方传入的 options 对象都不变（hook 在对象副本上补，不 mutate 入参）；hook 幂等（IIFE + 全局哨兵，被 `--require` 与 `NODE_OPTIONS` 各预载一次也只生效一次）且任何失败静默忽略，绝不拖累对话。注入覆盖两条路径：node 直启用命令行 `--require`（已实测 dsh 的 ESM `import { spawn }` 同样被 live 接管），npx 现场拉包与 dsh 内部再拉起的 Node 子进程走 `NODE_OPTIONS`（路径含空格用双引号包裹，Node 只认双引号；且路径一律换成正斜杠——Node 分词该变量时把 `\` 当转义符吃掉，原生路径 `C:\Users\…\hook.cjs` 会变成 `C:Users…` 让子进程启动即抛 `MODULE_NOT_FOUND`（requireStack: `internal/preload`），命令行 `--require` 参数没有这层解析故仍用系统原生路径）；顺带补上我们自己两处 `spawnSync`（`node --version` / `npm config get cache`）遗漏的 `windowsHide`；新增 14 项单测（vm 沙箱逐一锁定各 API 的参数形态 / 选项保留 / 幂等 / 显式 `false` 也覆盖，外加真实 Node `--require` 与 `NODE_OPTIONS` 两条预载链路的端到端用例）
- **GIF 动图预览不再退化成静态首帧**：`anim.2d` 导出的 GIF 在检查器里预览时常只有第一帧、不播放动画——图片预览走 `getAssetPreviewUrl`，而它对图片返回的是 `.aiartengine/thumbs/` 下的缩略图 PNG（`nativeImage` 解原图所得，GIF 只剩首帧），且仅在缩略图尚未生成时才临时回退原图，故表现为「第一次打开会动、之后不动」。新增共享 `isAnimatedImageFilePath`（GIF 集合，可扩展）与渲染层 `resolveAssetPlaybackUrl`：动图预览改走 `getAssetFileUrl` 原文件（`studio-media://` 已按扩展名给出 `image/gif`，`<img>` 自动播放动画），静态图仍用缩略图省内存与 IO；资产检查器 `AssetMediaPreview` 与资产编辑器 `AssetEditor` 两处大图预览统一走该入口，列表 / 节点卡缩略图保持静态首帧不变（缩略图逐张播放既费内存也失去缩略图意义）
- **GIF 动图不再显示「一键抠图 / 智能构图 / 提取 UI 部件」入口**：这三项本地处理都只对单帧像素生效（`<img>` 载入 GIF 后 canvas 取到的是播放中的某一帧，产物也注定是静态 PNG），对动图既不可预期也无意义——`AssetInspector` 的 `cutoutSourcePath` 现复用 `isAnimatedImageFilePath` 识别 GIF 并直接置空，三个入口区块随之隐藏；静态图（png / jpg / webp）入口保持不变

## [6.0.0-alpha1] — 2026-09-09

6.0.0-alpha1 内部预发布（首个 6.0 alpha 构建）：内容为当前 `main` 上 [6.0.0]（5.2 智能创作版）的完整快照。本版主要用于验证 GitHub Actions 三平台自动构建 → 静默安装 + 启动冒烟 → GitHub Release 自动发布全链路；预发布版本会标为 GitHub prerelease，不会被作为 `latest` 推给 5.x 稳定版用户。

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
