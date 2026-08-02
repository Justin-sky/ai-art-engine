# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。版本号以 [`package.json`](./package.json) 为准；发版时打 `vX.Y.Z` tag，由 GitHub Actions 构建并上传安装包。

## [Unreleased]

### Added

- 一键工作流：预设 / AI 规划预览后创建可复用宿主资产
- 宿主多汇点边界输出；任务队列跨并行任务复用已完成共同上游
- 节点图画布：连线样式、小地图、更大缩放范围；侧栏 Rider 式收起与叠放

### Changed

- 官网使用手册补全一键工作流、宿主 Dive、任务复用与侧栏交互；首页工作流步骤增加「一键工作流」
- 节点 / Inspector 预览改为完整显示（object-fit: contain）
- 打光效果 / 多角度编辑器左侧预览改为顶部对齐

## [2.0.0-alpha.0] — 2026-07-29

2.0 首个 Alpha 预发布。

### Added

- 成片时间线：素材分组、拖入导入、视频首帧 / 声音图标；预览播选中片段、时间线播整轨；轨道片段可自由拖动
- 导演台：站位与动作双分类（截图 / 录制视频）；动画录制红色圆点图标，自动写入 `Cache/Videos`
- 导演台编辑节点：方形输出口 `out-shots`（站位 images）与 `out-actions`（动作 videos）；Inspector 可预览
- 导演台左侧场景列表可拖拽调整宽度
- 目录端口专用类型 `world` / `narrative` / `shots`（显示为世界元素 / 叙事单元 / 分镜）：结构化 JSON 不再占用 `text`，避免误连
- 生成类节点锁定：开启后跳过模型调用，直接复用图库/上次输出（节点卡锁图标与 Inspector）
- 模型提供商：可灵（Kling）、海螺 AI（MiniMax）、通义千问（DashScope）、魔塔（ModelScope）
- 对象存储：阿里云 OSS、腾讯云 COS（与火山 TOS 并列；同时仅可启用一个；设置页支持折叠）
- 设置页与手册展示各模型 / 对象存储密钥申请链接；方舟声音页签补充豆包语音控制台说明
- 图片精修对齐编辑管线，Inspector 提示词实时同步

### Changed

- 可灵鉴权改为官方文档的 API Key（`Authorization: Bearer`），移除 Access Key / Secret Key JWT 签发
- 通义千问静态模型目录按百炼文档对齐（可灵 V3 / HappyHorse t2v·i2v·r2v·edit + 万相图 ≤2.5 / 视频 2.2–2.7）
- README / 官网 / 手册补全海螺 AI 等模型提供商说明
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
