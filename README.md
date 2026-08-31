<div align="center">
  <img src="docs/assets/logo-mark.png" alt="" width="96" />

  <h1>AI Art Engine</h1>

  <p><b>专业 AI 创作工具 · 短剧 · 广告 · 成片</b></p>
  <p>
    本地工程与素材 · 分镜与节点图驱动生成 · 内置 MCP Server 可被 Claude Code 等 AI Agent 驱动<br />
    对接 OpenRouter · OpenAI · DeepSeek · 智谱 · Kimi · xAI · Google · vLLM · Ollama · LM Studio · 火山方舟 · 可灵 · MiniMax · 通义千问 · 魔塔 · ComfyUI · MagicRouter · Meshy · Tripo · Rodin（Hyper3D） · Luma AI · Lux3D<br />
    对象存储：火山 TOS · 阿里云 OSS · 腾讯云 COS
  </p>

  <p>
    <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=social" alt="GitHub stars" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/network/members"><img src="https://img.shields.io/github/forks/Justin-sky/ai-art-engine?style=social" alt="GitHub forks" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&label=release&style=flat-square" alt="release" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/downloads/Justin-sky/ai-art-engine/total?label=downloads&style=flat-square" alt="downloads" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square" alt="license" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/package.json"><img src="https://img.shields.io/github/package-json/v/Justin-sky/ai-art-engine?label=version&style=flat-square&color=orange" alt="version" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Local--First-本地优先-00B894?style=for-the-badge" alt="local" />
    <img src="https://img.shields.io/badge/Node_Graph-节点图-6C5CE7?style=for-the-badge" alt="graph" />
    <img src="https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-多平台-0984E3?style=for-the-badge" alt="platform" />
  </p>

  <p>
    <a href="https://justin-sky.github.io/ai-art-engine/"><b>官网</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/manual.html"><b>使用手册</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/guide-video.html"><b>视频生成指南</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/guide-short-video.html"><b>短视频教程</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/guide-comfyui.html"><b>ComfyUI 教程</b></a> · <a href="https://justin-sky.github.io/ai-art-engine/guide-mcp.html"><b>MCP 接入</b></a> ·
    <a href="https://space.bilibili.com/3707036976024122"><b>视频教程</b></a> ·
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><b>Download</b></a> ·
    <a href="https://github.com/Justin-sky/ai-art-engine"><b>GitHub</b></a> ·
    <a href="https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine"><b>Gitee</b></a> ·
    <a href="#交流"><b>交流</b></a> ·
    <a href="#features"><b>Features</b></a> ·
    <a href="#quick-start"><b>Quick Start</b></a> ·
    <a href="./README.en.md"><b>English</b></a>
  </p>
</div>

---

## 源码仓库

- GitHub（主仓库）：https://github.com/Justin-sky/ai-art-engine
- Gitee（国内镜像）：https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine

两个仓库的 `main` 分支保持同步；Release 与客户端自动更新仍以 GitHub 为准。

---

<a id="download"></a>

## Download

| Platform | Package | Get it |
|----------|---------|--------|
| **Windows** | `.exe` | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases) |
| **macOS** | `.dmg`（`x64` / `arm64`） | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases)：Intel 选 **x64**，Apple Silicon 选 **arm64**（仅 arm64 时 Intel Mac 会提示不支持） |
| **Linux** | `.AppImage` | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases)（`chmod +x` 后运行） |

推送 `v*` tag 可由 GitHub Actions 自动构建并发布多平台安装包。也可自行打包：

```bash
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

---

<a id="features"></a>

## Features

**AIArtEngine** 是面向短剧、广告与成片制作的专业 AI 创作工具：资产、分镜、节点图在同一桌面端完成，工程本地优先，模型调用走你自己的 API Key。

### 特色功能：AI 对话 + MCP

> 应用内聊天即可驱动全部生成与编排能力；Claude Code / Codex 等外部 AI Agent 也能直连操作你的工程。

- **AI 对话面板** — 应用内 AI 助手（DeepSeek Harness 运行时）：在对话里 `@` 引用工程资产、让 Agent 调用 MCP 工具直接干活——生成图片 / 视频 / 3D / 语音、编辑节点图、运行工作流并查状态；多会话历史、模型可选任意已配置文本模型
- **MCP 工具服务** — 内置 MCP Server，Claude Code / Codex 等外部 AI Agent 可经 stdio 桥或 HTTP 直连操作你的工程（规划并落盘工作流、运行生成、读写资产与节点图）；token 跨重启持久复用、操作审计、并发闸门

### 特色功能：Skill 技能系统

> 技能是"职业手册"——告诉 Agent 怎么做（流程、规范、输出格式）；MCP 工具是"手脚"——真正动手执行。两者配合，对话才能"说到做到"。

- **内置创作技能** — 随对话自动就位，无需配置：分镜 / 动画（9 宫格分镜表、节拍拆解表、动态提示词表、4 宫格动态分镜表等）、导演审核、系统创作（剧本、图生提示词、图片 / 视频生成、声音、情绪、灯光、多角度、扩图、重绘、抠图、高清放大、界面图、界面拆分、世界提取、节拍拆分、节拍单元生成、策划案、肖像贴图、提示词优化、擦除）
- **自定义技能** — 设置 → **自定义技能**：把符合 dsh SKILL.md 格式（frontmatter `name` / `description` + Markdown 正文）的 `.md` 文件放进技能目录，下次对话自动生效；目录内一键「生成示例模板」
- **机制** — 技能清单以 `<available_skills>` 注入对话上下文，Agent 判断任务匹配时按需加载技能文件作为指令；内置技能由程序自动管理（快照 + 指纹去重），自定义技能不受影响。节点图节点也使用同一套技能定义节点行为

### 完整能力

- **本地工程** — 新建 / 打开 / 最近列表，JSON + 媒体目录落盘，数据不出本机
- **资产库** — 图片 / 视频 / 声音 / 3D 模型；AssetRef GUID；`.aipackage` 导入导出
- **分镜与画布** — 镜头参数、Fabric 构图、可停靠布局
- **一键工作流** — 预设模板（短剧分镜、游戏UI界面、游戏买量、产品广告、电商带货、游戏3D资产、漫画出版、知识口播、3D白模预演等）或 AI 规划拓扑，一键创建可复用宿主资产（边界 I/O + Dive 内图）
- **节点图生成** — 文本 / 图片 / 视频 / 声音 / 3D 模型节点，指令面板与模型参数；生成锁定、图库双输出口；端口类型必须相同（单数不能进复数，选取节点只收列表口）；连线样式 / 小地图；任务队列复用共同上游、**任务容错模式**（节点失败降级不整链中断）；漫画页（分镜格 + 台词气泡，导出透明 PNG）、广告变体矩阵、媒体质检 / 返工（专用质检模型五维评分 → FAIL 自动注入原因重试）、2D 帧动画与帧动画序列图、图层分离（拆层后可导出 PSD）
- **宿主资产** — 外层暴露边界口，内图可 Dive；多汇点各建独立出口
- **导演台** — 3D 站位截图与动作录制（写入 `Cache/Videos`）；方形口 `out-shots` / `out-actions`；3D 模型输入端口，dive 自动实例化到舞台；全景图输入自动设为背景；AI 白模搭场景、20+ 种基础几何体、材质贴图覆盖（基础 / 法线贴图）、着色模式与线框模式
- **成片时间线** — 素材分组与上轨编排；画中画叠加（位置 / 尺寸 / 不透明度 / 音量）与视频轨转场；预览播选中 / 时间线整轨联播；导出成片
- **多模型提供商** — OpenRouter、OpenAI（GPT 文本 / gpt-image 图片）、DeepSeek（文本）、智谱（GLM 文本 / CogView 图片）、Kimi / 月之暗面（文本）、xAI / Grok（文本 / 图片 / 视频）、Google / Gemini（文本 / 图片 / 视频）、本地 vLLM（文本 / Wan 视频）、Ollama / LM Studio（文本，OpenAI 兼容，无需 API Key）、火山方舟（Seedream / Seedance / 声音）、可灵、MiniMax、通义千问（DashScope）、魔塔（ModelScope）、ComfyUI（API 2：图片 / 视频 / 声音，本机或云端 Base URL）、MagicRouter（聚合网关：文本 / 图片 / 视频）、Meshy / Tripo / Rodin（Hyper3D） / Luma AI / Lux3D（3D 模型生成，文生 3D / 图生 3D）
- **对象存储** — 火山引擎 TOS、阿里云 OSS、腾讯云 COS（同时仅可启用一个，用于参考视频等公网外链）
- **可扩展** — Editor Kernel + Cordis 内部扩展（窗口 / Inspector / 节点 / Skill / 执行器）+ 声明式外部插件清单

### 模型与对象存储一览

| 类型 | 提供商 | 能力概要 |
|------|--------|----------|
| 模型 | OpenRouter | 文本 / 图片 / 视频（聚合目录） |
| 模型 | OpenAI | 文本 / 图片（需可访问 api.openai.com 的网络与账号） |
| 模型 | DeepSeek | 文本（deepseek-chat / deepseek-reasoner） |
| 模型 | 智谱 | GLM 文本 / CogView 文生图 |
| 模型 | Kimi（月之暗面） | 文本（kimi-k2 系列 / moonshot-v1 系列） |
| 模型 | xAI（Grok） | 文本 / Grok Imagine 图片 / Grok Imagine Video（异步轮询） |
| 模型 | Google（Gemini） | 文本 / Nano Banana 图片 / Veo 3.1 视频（异步轮询，官方 OpenAI 兼容层） |
| 模型 | vLLM | 本地文本 / 视频（Wan T2V / I2V，OpenAI 兼容，无需 API Key） |
| 模型 | Ollama / LM Studio | 本地文本（OpenAI 兼容，无需 API Key） |
| 模型 | 火山方舟 | 文本 / Seedream 图 / Seedance 视频 / 声音设计 |
| 模型 | 可灵 | 图片 / 视频（API Key） |
| 模型 | MiniMax | 文本 / 图片 / 视频 / 音色设计 |
| 模型 | 通义千问 | 文本（兼容模式）/ 万相图 / 万相视频（含 HappyHorse 等） |
| 模型 | 魔塔 | 文本 / 文生图（访问令牌） |
| 模型 | ComfyUI | 图片 / 视频 / 声音（API 2；本机 8189 或云端 Base URL） |
| 模型 | MagicRouter | 文本 / 图片 / 视频（OpenAI 兼容聚合网关，视频异步轮询） |
| 模型 | Meshy | 文生 3D / 图生 3D（含多图生 3D，API Key） |
| 模型 | Tripo | 文生 3D / 图生 3D（API Key） |
| 模型 | Rodin（Hyper3D） | 文生 3D / 图生 3D（API Key） |
| 模型 | Luma AI | 文生 3D / 图生 3D（API Key） |
| 模型 | Lux3D | 文生 3D / 图生 3D（含多图生 3D，G1 / G1-Turbo，API Key） |
| 对象存储 | 火山 TOS / 阿里云 OSS / 腾讯云 COS | 参考媒体上传与签名 URL；设置中互斥启用 |

配置入口：**设置 → 模型** / **设置 → 对象存储**。本机 ComfyUI 需先装 [comfy-api-proxy](https://justin-sky.github.io/ai-art-engine/guide-comfyui.html)（默认 8189），不要直连 8188。

---

<a id="quick-start"></a>

## Quick Start

**用安装包**

1. 从 [Releases](https://github.com/Justin-sky/ai-art-engine/releases) 下载对应平台包  
2. 安装启动 → 新建工程  
3. 设置里添加模型提供商并填写密钥；可选配置对象存储  
4. 顶栏「一键工作流」快速出宿主资产，或在分镜 / 节点图中手搭链路  
5. 点左侧窄栏「◈」打开 AI 对话，`@` 引用资产让助手直接生成；或按 [MCP 接入教程](https://justin-sky.github.io/ai-art-engine/guide-mcp.html) 接入 Claude Code 等外部 Agent  

完整操作说明见 [使用手册](https://justin-sky.github.io/ai-art-engine/manual.html)（源码在 `website/manual.html`）。本机 ComfyUI 需先装 [comfy-api-proxy](https://justin-sky.github.io/ai-art-engine/guide-comfyui.html)（默认 8189），不要直连 8188。

**从源码**

```bash
# GitHub
git clone https://github.com/Justin-sky/ai-art-engine.git

# 或使用 Gitee 国内镜像
git clone https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine.git

cd ai-art-engine
npm install
npm run dev
```

开发构建需要 **Node.js 22+**（运行时已内置 Node，用户无需安装）。Electron 下载失败时可：

```bash
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
node node_modules/electron/install.js
```

```bash
npm run typecheck && npm test   # 检查
npm run pack                    # 未封装目录，便于自测
```

---

## 文档

- [使用手册](https://justin-sky.github.io/ai-art-engine/manual.html)（源码 `website/manual.html`）
- [架构](./docs/ARCHITECTURE.md) · [节点图插件](./docs/GRAPH_PLUGINS.md) · [文档目录](./docs/README.md)
- [资产模型](./docs/ASSET_MODEL.md) · [AssetRef](./docs/ASSET_REF.md) · [素材包](./docs/ASSET_PACKAGE.md)
- [路线图](./docs/ROADMAP.md) · [变更记录](./CHANGELOG.md)

---

## 版本与更新

- 版本号以 [`package.json`](./package.json) 的 `version` 为准（SemVer），变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
- **发版**：先改 `package.json` 与 CHANGELOG，提交后打 tag 并推送，例如：

```bash
git tag v5.0.0
git push origin v5.0.0
```

  CI 会校验 tag（去掉 `v`）与 `package.json` 一致，再构建并发布 [GitHub Release](https://github.com/Justin-sky/ai-art-engine/releases)（含 `latest.yml` 等更新元数据）。
- **客户端更新**：安装包启动后会检查 Releases；也可在 **设置 → 通用 → 关于与更新** 中手动检查，下载完成后重启安装。开发模式（`npm run dev`）不检查更新。

---

## Contribute

欢迎 Issue 与 Pull Request。提交前建议：

```bash
npm run typecheck && npm test
```

讨论与缺陷跟踪可使用 [GitHub Issues](https://github.com/Justin-sky/ai-art-engine/issues) 或
[Gitee Issues](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine/issues)。

---

## 交流

- **官网**：[GitHub Pages](https://justin-sky.github.io/ai-art-engine/) · 阿里云 OSS（见 `npm run site:deploy`）
- **视频教程**：[Bilibili 空间](https://space.bilibili.com/3707036976024122)
- **国内镜像**：阿里云 OSS 静态托管（自定义域名 / `publicBaseUrl`）
- **GitHub**：[Justin-sky/ai-art-engine](https://github.com/Justin-sky/ai-art-engine)
- **Gitee**：[beijing_blue_whale_era_zhangjian/ai-art-engine](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine)
- **QQ 群**：647306826（扫码入群）

  <img src="docs/assets/qq-group.png" alt="AIArtEngine QQ 群二维码" width="220" />

- **邮箱**：[284139554@qq.com](mailto:284139554@qq.com)

---

## Stack

`Electron` · `Vue 3` · `Pinia` · `TypeScript` · `Cordis` · `Fabric.js` · `electron-vite` · `electron-builder`

---

## License

[GPL-3.0](./LICENSE) — 修改并再分发时，衍生作品需以相同协议开源。

---

<div align="center">
  <p>如果这个项目对你有帮助，请点一颗 ⭐ Star</p>
  <img src="docs/assets/logo-mark.png" alt="" width="40" />
</div>
