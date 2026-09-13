# 让 AI 助手直接操作 AiArtEngine（MCP 接入指南）

## 这是什么？

AiArtEngine 内置了一个 **MCP 工具服务**（MCP 是"模型上下文协议"，即 AI 助手调用你本机工具的标准方式）。接入后，**Claude Code、Codex 等 AI Agent 就可以直接操作你的工程**，而不用你手动点界面。应用内的 **AI 对话面板**（工作区左侧「◈」按钮）也通过这套同一工具面运行——它在聊天里 `@` 引用资产并让 Agent 调用下列工具，行为与外部 Agent 完全一致。

能帮你做什么，举几个例子（对话里直接说就行）：

- 「列出我最近的工程」→ `project_list`
- 「打开工程 `demo`，用 `shortDrama` 模板规划一条工作流并落盘」→ `workflow_plan` + `workflow_commit`
- 「把剧本里第 3 段改成……并更新资产」→ `asset_read_file` + `asset_write_text`
- 「把 `D:\art\icons` 里的图标导入工程，新建个 IconPacks 文件夹整理好」→ `folder_create` + `asset_import` + `asset_move`
- 「把这段语音转写成字幕底稿，再打包成资产包发给同事」→ `transcribe_audio` + `asset_package_export`
- 「把 2D 舞台那套骨骼装配导成 Spine 包，部件要独立透明页」→ `stage2d_spine_export`
- 「这张 UI 效果图里的按钮和面板切出来，按钮给 12px 九宫格边距」→ `ui_kit_extract`
- 「把角色差分图体检一遍，白边和光晕清理干净再用」→ `asset_qc` + `asset_qc_fix`
- 「把这条口播里的停顿静默剪掉，再导出成片」→ `transcribe_audio` + `timeline_rough_cut` + `timeline_export`
- 「把这 5 张分镜图铺到视频轨、每张 3 秒，台词按转写铺成字幕」→ `timeline_edit`
- 「铺完了，让我看看画面对不对」→ `timeline_preview`
- 「生成一张标题图 / 一段口播音频，存进工程」→ `generate_image` / `generate_speech`
- 「刚才提交的视频生成好了吗？」→ `task_status` / `video_job_get`

一句话：**应用负责干活，Agent 负责发指令，全程不离开你的对话窗口。**

---

## 快速开始（5 分钟跑通）

前置条件：已安装并启动 AiArtEngine 桌面应用（工具服务随应用启动，退出即关闭）。

接入有**两种方式，任选其一**：

| | 方式 A：stdio 桥 | 方式 B：HTTP 直连 |
|---|---|---|
| 一句话 | Claude Code 帮你拉起一个桥脚本，桥再转发给应用 | 客户端直连应用的工具服务 |
| 需要 Node.js | 是（18+） | 否 |
| 适用 | 本机日常使用（推荐） | 客户端不支持 stdio、或不想装 Node |
| 端点/命令 | `scripts/mcp-bridge.mjs` | `http://127.0.0.1:43110/mcp` |

### 方式 A：stdio 桥（推荐）

1. 启动 AiArtEngine 应用。
2. 在工程根目录执行下面命令，向 Claude Code 注册这个 MCP server（`<仓库绝对路径>` 换成实际路径）：

   ```bash
   claude mcp add aiartengine -- node <仓库绝对路径>/scripts/mcp-bridge.mjs
   ```

   > 开发场景用仓库内脚本；安装包里也内置了一份，位于 `<安装目录>/resources/mcp-bridge.mjs`。

3. 新开一个 Claude Code 会话（注册后需重启会话生效），然后直接说：
   「列出我的工程，打开最近的一个，告诉我里面有哪些资产」。

### 方式 B：HTTP 直连（无需 Node.js）

1. 启动 AiArtEngine 应用。
2. 找到应用的连接信息文件 `mcp.json`（Windows 在 `%APPDATA%\aiartengine\mcp.json`），里面是 `{ port, token, pid, version }`。
3. 注册（把 `<token>` 换成文件里的 token）：

   ```bash
   claude mcp add --transport http aiartengine http://127.0.0.1:43110/mcp --header "Authorization: Bearer <token>"
   ```

   > 端口默认是 43110；如果被占用，应用会依次尝试 43110–43119，用实际端口替换即可。

4. 新开会话验证（同上）。

### 怎么确认接通了？

会话里问一句：「调用一下 `app_status`，看下当前版本和打开的工程」。有正常返回就说明通了；返回报错看文末[常见问题](#常见问题排查)。

---

## 原理：消息是怎么走的

```
┌────────────────┐  MCP(stdio)   ┌────────────────────┐   HTTP    ┌────────────────────────┐
│ Claude Code    │──────────────▶│ mcp-bridge.mjs     │──────────▶│ AiArtEngine 应用        │
│ Codex 等 Agent │◀──────────────│（纯隧道，只转发）    │◀─────────│ 127.0.0.1 工具服务      │
└────────────────┘               └────────────────────┘           └────────────────────────┘
```

- **方式 A** 走完整条链路：Agent 拉起桥 → 桥把消息原样 POST 到应用的 `/mcp` 端点。
- **方式 B** 跳过桥，Agent 直连应用的 `/mcp` 端点。

关键点：**桥不做任何协议处理**，只负责转发（stdin 一行进、stdout 一行出）。协议语义（版本协商、工具清单、错误码）全部由应用内的 `src/shared/mcpProtocol.ts` 实现。好处是——**工具清单和协议版本永远跟应用同步，升级应用不会出现"桥和协议对不上"**。

### 两个 mcp.json，别搞混

这是最容易踩坑的地方，有两个同名文件、职责完全不同：

| | 应用侧 `mcp.json` | 项目侧 `.mcp.json` |
|---|---|---|
| 位置 | `%APPDATA%\aiartengine\mcp.json` | **你运行 Claude Code 的项目根目录**（或其中的 `.claude/` 子目录），不是 ai-art-engine 仓库 |
| 属于谁 | AiArtEngine 应用 | Claude Code 的项目配置 |
| 内容 | 连接信息 `{ port, token, pid, version }` | 声明"如何启动 aiartengine 这个 MCP server" |
| 谁写 | 应用启动自动写、退出自动删 | 你手动写，可提交进 git 共享给团队 |
| 你要做 | **不要手改** | 可选，团队共享时有用 |

**为什么设计成两个文件？** token 和端口是动态的（重启可能变化），放应用侧由程序维护；`.mcp.json` 是静态声明，告诉 Claude Code"这个 server 用哪条命令/哪个地址拉起来"。桥（或直连）正是靠读应用侧的 `mcp.json` 才找到工具服务的。

**`.mcp.json` 需要手动创建吗？** 需要——**没有任何程序会自动生成它**，用法是新建一个名为 `.mcp.json` 的文本文件，填入下面的模板内容。但**大多数场景不用创建**：

- **单人使用**：直接执行 `claude mcp add aiartengine -- node <桥脚本实际路径>`，Claude Code 会自动写入本机配置（`~/.claude.json`），效果相同、无需建任何文件；
- **团队共享**：才值得手动创建 `.mcp.json` 并提交进 git，成员克隆项目即用。

两种方式二选一，无需同时做。

> 团队共享配置示例（`.mcp.json`，stdio 版，放在**你跑 claude 的项目根目录**，`args` 里的路径换成 ai-art-engine 桥脚本的实际位置）：
>
> ```json
> {
>   "mcpServers": {
>     "aiartengine": {
>       "command": "node",
>       "args": ["C:/path/to/ai-art-engine/scripts/mcp-bridge.mjs"]
>     }
>   }
> }
> ```
>
> HTTP 版（无需 Node.js，token 取自应用侧 mcp.json）：
>
> ```json
> {
>   "mcpServers": {
>     "aiartengine": {
>       "type": "http",
>       "url": "http://127.0.0.1:43110/mcp",
>       "headers": { "Authorization": "Bearer <应用侧 mcp.json 里的 token>" }
>     }
>   }
> }
> ```

### token 持久复用

应用侧 `mcp.json` 里的 token **跨重启保持不变**，所以配置一次就能长期用。要重置（比如怀疑泄露）：删除 `mcp.json` 后重启应用，会生成新 token。

---

## 可用工具清单

按用途分四组，按需查阅：

### ① 工程与资产（探索、读写你的工程）

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `project_list` | 最近工程路径列表 | 无 |
| `project_open` | 打开一个工程 | 应用运行中 |
| `project_create` | 新建工程 | 应用运行中 |
| `project_memory_read` | 读取当前工程的 Agent 记忆（`.aiartengine/memory.md`，跨会话偏好的完整 Markdown） | 已打开工程 |
| `project_memory_append` | 向项目记忆指定分类追加一条偏好（style / camera / character / other），下一轮对话自动注入 | 已打开工程 |
| `project_memory_write` | 整体覆盖写入项目记忆（Markdown，用于整理 / 重建） | 已打开工程 |
| `voice_profile_list` | 列出角色音色档案（角色 → 音色 id / 克隆参考音频） | 已打开工程 |
| `voice_profile_upsert` | 新建 / 更新角色音色档案（character + voice 或 referenceAudio + description） | 已打开工程 |
| `voice_profile_delete` | 删除指定角色音色档案 | 已打开工程 |
| `asset_list` | 列出当前工程的资产 | 已打开工程 |
| `asset_read_file` | 按相对路径读取工程内文本文件 | 已打开工程 |
| `asset_write_text` | 更新文本资产（剧本/备注），界面同步刷新 | 已打开工程 |
| `folder_create` | 新建资产库文件夹，返回 `folderId`（供 `asset_import` / `asset_create` / `generate_*` 归档用） | 已打开工程 |
| `asset_create` | 新建资产（剧本 / 策划案 / 世界观 / 分镜 / 子图 / 自由画布 / 图片 / 视频 / 声音 / 2D 动作），界面同步出现 | 已打开工程 |
| `asset_import` | 把本机绝对路径的媒体文件导入资产库（图片（含 PSD / SVG 矢量图）/ 视频 / 音频 / 3D 模型 / 剧本文本，单次上限 50 条；SVG 归图片资产，预览读原文件，可直接接 `svg.anim` 烘焙），返回逐条结果与跳过原因 | 已打开工程 |
| `asset_rename` | 重命名资产 | 已打开工程 |
| `asset_move` | 把资产移动到指定文件夹（省略 `folderId` 即移回资产库根目录，媒体文件随目录搬移） | 已打开工程 |
| `asset_delete` | 从资产库移除资产（默认拒绝删除仍被引用的资产，`force: true` 强制） | 已打开工程 |
| `transcribe_audio` | 把工程内音频 / 视频转写成带时间戳的分段文本（台词表 / 字幕底稿） | 已打开工程 |
| `audio_separate` | 人声 / 伴奏分离，两条音轨落 `Cache/Separated/` | 已打开工程 |
| `storage_upload` | 上传工程内媒体到对象存储，返回可分享的公网 / 预签名 URL | 已打开工程，且已配置对象存储 |
| `asset_package_export` | 导出 `.aipackage` 交付包（可选带依赖与生成缓存；无界面链路需给绝对 `targetPath`） | 已打开工程 |
| `asset_package_import` | 导入 `.aipackage` 交付包（可按 guid 选子集），界面素材库同步刷新 | 已打开工程 |
| `stage2d_spine_export` | 把 2D 舞台的骨骼装配导出成 Spine 骨架包（部件透明页 + `skeleton.json` + `.atlas`） | 已打开工程，且应用的界面已打开 |
| `ui_kit_extract` | 按框选矩形把整屏 UI 图切成部件 PNG，并写 `ui-kit.json` 九宫格清单 | 已打开工程，且应用的界面已打开 |
| `asset_qc` | 图片资产「引擎就绪」体检：抠图漏底 / 边缘白边 / 碎屑 / 贴边 / 空图 / 尺寸 / 命名（只读，不写盘） | 已打开工程，且应用的界面已打开 |
| `asset_qc_fix` | 去边缘污染返工（去白边 / 光晕），产出新资产落 `Assets/QC/<原名>/`，附修复前后对比 | 已打开工程，且应用的界面已打开 |
| `timeline_read` | 读剧本资产的成片时间线：片段（轨道 / 起止秒 / 取段起点 / 字幕 / 音量 / 转场）、设置、总时长，可按轨过滤 | 已打开工程 |
| `timeline_rough_cut` | 智能粗剪：按配音转写挤掉静默并全线前移（ripple），字幕 / 音乐轨跟随；默认只回计划 | 已打开工程（`apply: true` 时还需该剧本的时间线编辑器已关闭） |
| `timeline_export` | 时间线合成 MP4（拼接 / 转场 / 画中画 / 混音 / 烧字幕 / 水印） | 已打开工程，且系统可用 ffmpeg（无界面链路需传 `targetPath`） |
| `timeline_edit` | 时间线增删改：铺素材上轨 / 改音量·转场·字幕文本 / 删片段 / 用转写重建字幕 | 已打开工程（`apply: true` 时还需该剧本的时间线编辑器已关闭） |
| `timeline_preview` | 看成片画面：按导出同一条滤镜图渲染几张静帧（可均匀抽 / 定点抽），画面随响应回给多模态客户端 | 已打开工程，且系统可用 ffmpeg |
| `graph_edit` | 对节点图做编辑操作批（节点/连线，应用内校验类型与端口兼容性） | 已打开工程，且该图未在编辑器中打开 |

### ② 工作流：规划 → 落盘 → 运行

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `workflow_list_presets` | 行业模板列表（id + 标题） | 应用运行中 |
| `workflow_plan` | 自然语言 → 工作流方案预览（走应用已配置的文本模型，耗时可能数十秒） | 已打开工程 + 文本模型 |
| `workflow_commit` | 把方案落盘为宿主资产，界面同步出现（`plan` 也可手写从而跳过 `workflow_plan`；节点 `params` 按类型声明的键校验，未声明的键会被忽略并列在返回的 `warnings` 里；`imageModel` / `videoModel` 等可显式指定生成模型） | 已打开工程 |
| `folder_list` | 列出资产库文件夹（generate_* 的 folderId 来源） | 已打开工程 |
| `graph_node_types` | 可添加节点类型清单（typeId / 名称 / 分类 / 端口 / 能力说明 / 可选默认参数），即 graph_edit 建节点的白名单，供 Agent 自发现节点；能力说明会点出关键参数语义，如 `anim.2d` 设 `animGifFps` > 0 后运行即额外输出 GIF 动图（`out-gif` 端口 + 落盘资产）、`stage.2d` 设 `stage2dAnimFps` > 0 且带自定义动作时运行即额外输出逐帧 PNG 序列与拼版 sheet（`out-frames` / `out-sheet` 端口 + 落盘资产）、`svg.gen` 用文本模型把描述画成 SVG 矢量源码并落盘为 .svg 资产（`in` 接文本指令、`in-image` 接参考图照图生矢量）、`svg.anim`（SVG 烘焙）接入矢量源（SVG 生成节点 / 图库 SVG 资产）后运行即烘焙为位图序列——含动效时按动画时间轴逐帧出 PNG 并合成 GIF（`out-gif` 端口 + 落盘资产），无动效只出单帧 | 应用运行中 |
| `graph_read` | 读取宿主资产图结构（节点 id / 类型 / 标题 + 连线），graph_edit 前置 | 已打开工程 |
| `graph_icon_refine` | 单枚图标精修回炉：按整版画风重画某一枚（hint / prompt 可指定），写回同源打包节点的逐枚覆盖并默认重跑打包（耗时较长：一次生图 + 一次打包重跑；调用期间任务列表与素材库资产卡片角标可见运行中活动） | 已打开工程，且该图未在编辑器中打开 |
| `task_run` | 运行已落盘的工作流（整图拓扑序执行，输出写回资产），返回 `mcpTaskId` | 已打开工程 + 应用界面运行 |
| `task_status` | 按 `mcpTaskId` 查运行状态（running / done / error / stopped） | 应用运行中 |

### ③ 内容生成（图片 / 视频 / 3D / 语音 / 音乐）

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `generate_image` | 文生图 / 图生图，落盘为工程资产 | 已打开工程 + 图片模型 |
| `generate_video` | 提交视频生成并登记资产（异步，用 `video_job_*` 跟踪） | 已打开工程 + 视频模型 |
| `generate_model3d` | 文生 3D / 图生 3D，产出 GLB 资产（异步） | 已打开工程 + 3D 模型 |
| `generate_speech` | 台词转 MP3 并导入为声音资产 | 已打开工程 + 音频模型 |
| `generate_music` | 按情绪 / 场景描述生成 BGM 并落盘 `Cache/Music`（同步），返回 `assetId` / `relativePath` / `durationMs`，可铺到时间线 music 轨 | 已打开工程 + 音乐模型（如 `music-3.0`） |
| `video_job_list` / `video_job_get` | 查询异步视频生成任务的状态 | 应用运行中 |

### ④ 环境查询

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `app_status` | 版本、当前工程、资产数量 | 应用运行中 |
| `models_list` | 已启用的模型提供商与各模态勾选模型（**不含任何密钥**） | 无 |

---

## 安全设计

- 工具服务**只监听 `127.0.0.1`**（本机回环），外部机器无法访问。
- 除健康检查外，所有请求必须带 `Authorization: Bearer <token>`。
- 文件读写被限制在工程根目录内，无法越权访问其他路径。唯一例外是 `asset_import`：它按你（或你授权的 Agent）给出的**绝对路径**读取工程外文件并复制进工程，不接受目录扫描，单次最多 50 条。
- 密钥类信息（`models_list` 等）**不对外暴露**。
- **对话面板的模式是硬约束，不是提示词**：面板上的 Ask / Plan / Craft 随每次运行经请求头（`X-AIArt-Mode` / `X-AIArt-Run-Id`）下发，服务端据此收窄工具面——**Ask 不返回任何工具**、任何调用一律被拒；**Plan 在用户确认计划前只返回只读工具**，写 / 生成类调用被拒（用户经 `ask_user` 选「继续」后，本条消息内放行）；**Craft 不限制**。工具分级与文案见 `src/shared/mcpModeAccess.ts`（read / write / generate 三级，未登记的工具按 write 处理），被拦下的调用同样写入审计日志。**外部 Agent（stdio 桥 / HTTP 直连）不带这两个头，不受任何模式限制**——模式绑在请求上而不是服务上，所以面板切模式不会影响你挂到其他客户端的用法。注意这条约束只覆盖**本应用的工具面**：dsh 自带的原生工具（文件读写、执行命令、网络、子 agent 等）不经 MCP，不在其内，仍由 persona 与系统级沙箱约束。
- 全部工具调用追加写入审计日志 `<userData>/logs/mcp-audit.jsonl`（时间 / 工具 / 参数摘要 / 耗时 / 结果，参数超 200 字符截断，单文件 5MB 滚动），可回查 Agent 触发的每次生成与写入。

---

## 当前限制

- **`task_run` 依赖应用界面进程**：请保持应用运行；同一张图重复触发会按「进行中任务」去重。
- **资产分类**：`generate_*` 与 `workflow_commit` 支持 `folderId`（资产库文件夹，`folder_list` 查询）与
  `outputDir`（工程内相对输出目录，缺省按类型 Assets/Generated/* 或 Cache/Videos）。
- **删除是「出库」不是物理删除**：`asset_delete` 与界面删除同口径——只移除资产元数据（含缩略图登记），源媒体文件仍保留在工程目录内；
  被其他资产 / 节点引用时默认拒绝并回传引用来源，确认无影响后传 `force: true` 强制。资产名重复时 `asset_create` 会自动去重命名。
- **无界面链路不走系统对话框**：`asset_package_export` 必须传绝对路径 `targetPath`（自动补 `.aipackage`、自动建父目录），
  `asset_package_import` 必须传绝对路径 `packPath`；界面上两者仍走「另存为 / 打开」对话框，两条链路互不影响。
- **媒体路径边界**：`transcribe_audio` / `audio_separate` / `storage_upload` 只接受 `assetId` 或工程内相对路径，
  绝对路径与含 `..` 的路径会被直接拒绝（`asset_import` 是唯一允许读工程外文件的工具，且只复制进工程）。
- **渲染层能力需要界面在场**：`stage2d_spine_export` / `ui_kit_extract` / `asset_qc` / `asset_qc_fix` 要跑 canvas 与落盘，
  作业由界面进程执行——应用没开界面（或界面版本过旧）时会明确报错，不会静默产出空壳结果；导出骨架包沿用
  「图编辑器打开时拒绝」的保护，避免导出编辑器里未落盘的旧装配。
- **质检只读、返工不覆盖原件**：`asset_qc` 逐像素判完只回报告，不写盘也不改资产；`asset_qc_fix` 只修「边缘白边残留」
  这一项安全缺陷（按反混合公式去掉半透明边缘里的背景色），产出新资产落 `Assets/QC/<原名>/`，原件保留可回溯。
  抠图漏底（镂空可能是刻意设计）、主体贴边、命名只报告不自动改——改画布会动到所有下游引用，改名请走 `asset_rename`。
- **时间线写入要避开编辑器**：`timeline_rough_cut` 与 `timeline_edit` 的 `apply` 都会重写剧本资产的时间线，而时间线编辑器
  在界面里打开时一律拒绝写入——编辑器内存态与它的自动保存会把远端改动覆盖掉（与 `graph_edit` 同一保护口径），
  先关掉时间线再让 Agent 改。两个工具默认都是 `apply: false`：先看计划 / 报告，确认了再落盘。
  另外粗剪只依据**配音轨**的转写，配音轨之外的时间段（空镜、纯音乐）不会被剪。
- **时间线编辑按片段 id 定位**：`timeline_edit` 的 `update` / `remove` 都要 id，从 `timeline_read` 拿；
  粗剪会切分片段并改名（`clip-1` → `clip-1~2`），所以重排之后要重新读一次 ids。
  单条指令失败不会中断其余指令，原因逐条回在 `failures` 里（id 找不到、时长 ≤ 0 等），
  返回的 `addedClipIds` / `removedClipIds` 是后续编辑的抓手。
- **工具能回图片，旧客户端只是看不到**：`timeline_preview` 的画面以 MCP image content 随响应回给客户端，
  多模态客户端（Claude Desktop / Codex 等）能直接看到；纯文本客户端只会读到时间点列表与说明，不会报错——
  图放在结果的旁路字段里，不混进文本结果，也不会被审计日志记下 base64。
  预览与 `timeline_export` 走**同一条 ffmpeg 滤镜图**，所以「预览看到的就是成片」，不是另画一套近似预览；
  代价是它要真渲染：时间点越靠后解码越久（抽几帧比导出一次便宜得多，但不是瞬时）。
- **低频参数透传**：`generate_*` 工具支持 `extraParams` 对象，把底层生成输入的全部字段
  （如图片 `seed` / `quality`、视频 `resolution` / `lastFrameImageUrl`）合并进生成请求；
  显式传参优先于透传值，内部回写绑定字段（graphBinding）会被自动剥离。
- **并发闸门**：`generate_image` / `generate_speech` / `generate_music` / `workflow_plan` 同时最多 3 个（可用环境变量 `AIAE_MCP_GEN_LIMIT` 调整），排队超限直接返回错误；`generate_video` / `generate_model3d` 提交即返回，不受闸门限制。
- **取消粒度**：客户端断开连接，或发送 `notifications/cancelled`，会中止进行中的长任务（如 `workflow_plan` 在两次模型调用之间）；单次模型调用内部不可中断。
- **状态报告有 TTL**：`task_status` 的成功/失败终态保留 10 分钟后自动清理，过期查询返回「未知任务 id」。
- **环境变量覆盖**：`AIAE_MCP_CONFIG` 指定应用侧 mcp.json 路径；`AIAE_MCP_PORT` + `AIAE_MCP_TOKEN` 直接指定端口与 token（优先于文件）。

---

## 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 报错「未找到 mcp.json」 | 应用没启动，或应用侧 mcp.json 被删 | 先启动 AiArtEngine；或用 `AIAE_MCP_CONFIG` 指定路径 |
| 返回 401「未授权」 | token 对不上（应用重启过换了？配置过期？） | 删除 mcp.json 重启应用拿新 token，重新注册 |
| 连不上 / ECONNREFUSED | 端口被占用，实际端口不是 43110 | 看应用侧 mcp.json 里的 `port`，换成实际端口 |
| 注册后工具不出现 | 注册后需新开会话 | 重启 Claude Code 会话 |
| 工具报错「请先打开工程」 | 对应工具需要已打开工程 | 先调用 `project_open` |
| 生成长任务卡住不动 | 模型调用耗时（`workflow_plan` 可数十秒） | 等待；超时想中断可断开连接或发 `notifications/cancelled` |
