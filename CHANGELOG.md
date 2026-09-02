# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。版本号以 [`package.json`](./package.json) 为准；发版时打 `vX.Y.Z` tag，由 GitHub Actions 构建并上传安装包。预发布（如 `4.0.0-alpha.0`）会标为 GitHub prerelease，**不会**作为 `latest` 推给 3.x 稳定版自动更新。

## [Unreleased] — 5.2 智能创作版（进行中）

### Added

- **多 Agent 编排（自主协作 DAG）**：AI 对话面板 Agent 标签栏新增固定「编排」标签——提交「总目标 + 角色节点」（执行 Agent / 环节说明 / 依赖勾选）即生成任务 DAG，也可一键「智能拆解」让策划 Agent 把总目标自动拆成可编辑节点草案；依赖就绪的节点跨 agent 真并行执行（同一 Agent 排队、全局并行上限），每个节点用独立 dsh 会话执行并自动注入前置节点产出文本，失败自动重试 1 次，可一键中止；「编排记录」支持列表 / 分层连线图双视图实时查看节点状态流，节点产出 / 失败原因与最终汇总均可复制；节点任务静默运行不污染各角色会话历史（新通道 `orchestrator:run/plan/list/abort/event`）
- **音效库**：内置 22 个常用音效预设（转场 8 / UI 7 / 环境 7，中英双语，`features/timeline/sfxPresets.ts`），一键「生成并上轨」复用 AI 音效生成管线；分类浏览 + 资产库声音一键「导入上轨」
- **项目级 Agent 记忆**：工程 `.aiartengine/memory.md` 跨会话沉淀项目偏好（风格 / 机位 / 角色一致性 / 其它），工程创建 / 打开时由配置自动生成基线，每轮对话注入 persona（截断 4000 字符）；MCP 工具 `project_memory_read / append / write`
- **角色音色 / 声音克隆**：工程 `.aiartengine/voiceProfiles.json` 角色音色档案（角色 → 音色 id / 克隆参考音频），配音节点按角色（`generateSpeechCharacter`）自动取档实现跨镜头一致配音；`referenceAudio` 透传火山方舟声音复刻（few-shot voice clone）；声音节点检查器「角色音色」下拉 + 档案管理对话框；MCP 工具 `voice_profile_list / upsert / delete`
- **智能剪辑（AI 粗剪）**：`shared/graph/smartCut.ts` 依据视频素材标题 / 分镜描述编排视频轨顺序、每段时长与转场；时间线「智能粗剪」调用剧本节点文本模型生成方案，预览对话框可调时长与转场后一键应用（仅重排视频轨，其他轨保留）
- **视频级媒体理解**：媒体质检从视频首帧升级为多帧序列审核——`shared/graph/videoReview.ts` 按时间均匀抽帧（含首末帧），主进程 ffmpeg 按时间戳取帧（`video:extract-frames`），质检执行器图片优先、帧补位（上限 6 张），帧数 >1 时提示词追加「同一视频时间切片」说明，无 ffmpeg 自动回退首帧
- **人声 / 伴奏分离**：时间线「人声伴奏分离」把选中片段音源拆为对白与伴奏（内置 ffmpeg 中置 / 侧置声道提取，`shared/graph/audioSeparation.ts` 纯函数），产物落 `Cache/Separated/<stem>/`，对齐原位置分别上配音轨与音乐轨，混音器调比例后再混音导出；第三方 AI 分离接入位已预留（配置 `AUDIO_SEPARATION_API_URL` 即启用）
- **BGM 音乐生成接入百炼 Fun-Music**：MiniMax `music_generation` 自 2026-08-20 对新用户 / 免费用户停服，新增通义千问（DashScope）提供商 Fun-Music 音乐生成平替——注册 `fun-music-v1` / `fun-music-preview`（audio 模态，`/api/v1/services/audio/music/generation`，仅华北2北京，邀测需在百炼模型广场开通），设置页支持勾选 audio 模态、门面 / MCP / 时间线 BGM 生成链路自动选型；MiniMax 旧接口保留供历史付费用户继续使用

## [5.0.7] — 2026-08-31

5.0.7 体验优化版：缩小安装包、加快安装解压——内置 dsh 运行体（`resources/dsh`，约 200MB）只保留运行必需文件，剔除 sourcemap、类型声明、测试与文档目录、Markdown 与点文件后，文件数 -55%（29899 → 13517）、体积 -36%（204.5MB → 130.6MB）。NSIS 安装逐文件解压与杀软扫描开销随之大幅下降，全新安装明显更快，安装包下载也更小。

### Changed

- **dsh 以目录形态直接进包，放弃 zip 解压方案**：早期 5.0.7 曾把 dsh 压成单文件 zip、首启解压到用户目录——升级会破坏运行体文件权限、解压需等待数秒且旧版解压结果在新版变更后成为 200MB 孤儿垃圾，故回退为 `resources/dsh` 目录直接进包：安装即用、随应用升级、权限继承安装目录；删除解压进度 UI 与相关 IPC；首次启动自动后台清理旧版遗留的 `userData/dsh-runtime`
- **dsh 运行体裁剪（含误删防护）**：`scripts/bundle-dsh.mjs` 复制依赖闭包时过滤非运行文件（`*.map`、`*.d.ts`、`test`/`docs`/`examples` 目录、`*.md`、仓库/工具配置类点文件），保留 `LICENSE`、`CHANGELOG` 等合规文本；`dist/` 目录与数据类点文件（如 `.manifest.json`）受保护不过滤；新增**引用可达性校验**——扫描产物内全部 JS 的相对 `require`/`import`，对照源包区分「裁剪误删」与「可选引用」，误删即中止构建；裁剪后 dsh 131.4MB / 13586 文件，安装包 153.8MB（较早期全量版 -38%）

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
