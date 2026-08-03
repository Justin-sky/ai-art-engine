<div align="center">
  <img src="docs/assets/logo-mark.png" alt="" width="96" />

  <h1>AI Art Engine</h1>

  <p><b>本地 AI 短视频创作工作台</b></p>
  <p>
    工程与素材都在本机 · 分镜与节点图驱动生成<br />
    对接 OpenRouter · 火山方舟 · 可灵 · MinMax · 通义千问 · 魔塔<br />
    对象存储：火山 TOS · 阿里云 OSS · 腾讯云 COS
  </p>

  <p>
    <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=social" alt="GitHub stars" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/network/members"><img src="https://img.shields.io/github/forks/Justin-sky/ai-art-engine?style=social" alt="GitHub forks" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&label=release&style=flat-square" alt="release" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/downloads/Justin-sky/ai-art-engine/total?label=downloads&style=flat-square" alt="downloads" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square" alt="license" /></a>
    <a href="https://github.com/Justin-sky/ai-art-engine/blob/main/package.json"><img src="https://img.shields.io/badge/version-2.0.0--alpha.0-orange.svg?style=flat-square" alt="version" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Local--First-本地优先-00B894?style=for-the-badge" alt="local" />
    <img src="https://img.shields.io/badge/Node_Graph-节点图-6C5CE7?style=for-the-badge" alt="graph" />
    <img src="https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-多平台-0984E3?style=for-the-badge" alt="platform" />
  </p>

  <p>
    <a href="https://justin-sky.github.io/ai-art-engine/"><b>官网</b></a> ·
    <a href="https://justin-sky.github.io/ai-art-engine/manual.html"><b>使用手册</b></a> ·
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

## 官网

落地页源码在仓库 `website/` 目录：

| 渠道 | 地址 |
|------|------|
| **GitHub Pages**（国际） | https://justin-sky.github.io/ai-art-engine/ |
| **阿里云 OSS**（国内） | 部署后见桶自定义域名 / `publicBaseUrl` |

请勿使用带 `/website/` 的地址（例如 `.../website/index.html`），会 404。

本地预览 / 发布国内镜像：

```bash
npm run site                 # 本地预览 http://localhost:5174
npm run site:deploy          # 部署 website/ 到阿里云 OSS
```

阿里云 OSS 部署：

1. 复制 `oss-website.example.json` → `oss-website.local.json`
2. 填写 `accessKeyId` / `accessKeySecret` / `bucket` / `region`（如 `oss-cn-hangzhou`）
3. 建议在 OSS 控制台为桶开启**公共读**与**静态页面**（首页 `index.html`），绑定**自定义域名**或 CDN，并在配置里填写 `publicBaseUrl`
4. 执行 `npm run site:deploy`

也可用环境变量：`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_BUCKET`、`OSS_REGION`、`OSS_ENDPOINT`、`OSS_PUBLIC_BASE_URL`。

说明：默认桶域名访问 HTML 可能被强制下载；绑定自定义域名后浏览器可直接打开页面（国内域名需 ICP 备案）。

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
| **macOS** | `.dmg` | [GitHub Releases](https://github.com/Justin-sky/ai-art-engine/releases)（需 Mac / CI 构建；未签名时在「隐私与安全性」允许） |
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

**AIArtEngine** 是本地优先的短视频创作桌面端：资产、分镜、节点图在同一工作台完成，模型调用走你自己的 API Key。

- **本地工程** — 新建 / 打开 / 最近列表，JSON + 媒体目录落盘，数据不出本机
- **资产库** — 图片 / 视频 / 声音；AssetRef GUID；`.aipackage` 导入导出
- **分镜与画布** — 镜头参数、Fabric 构图、可停靠布局
- **一键工作流** — 预设模板或 AI 规划拓扑，一键创建可复用宿主资产（边界 I/O + Dive 内图）
- **节点图生成** — 文本 / 图片 / 视频 / 声音节点，指令面板与模型参数；生成锁定、图库双输出口；连线样式 / 小地图；任务队列复用共同上游
- **宿主资产** — 外层暴露边界口，内图可 Dive；多汇点各建独立出口
- **导演台** — 3D 站位截图与动作录制（写入 `Cache/Videos`）；方形口 `out-shots` / `out-actions`
- **成片时间线** — 素材分组与上轨编排；预览播选中 / 时间线整轨联播；导出成片
- **多模型提供商** — OpenRouter、火山方舟（Seedream / Seedance / 声音）、可灵、MinMax、通义千问（DashScope）、魔塔（ModelScope）
- **对象存储** — 火山引擎 TOS、阿里云 OSS、腾讯云 COS（同时仅可启用一个，用于参考视频等公网外链）
- **可扩展** — Editor Kernel + 声明式扩展（窗口 / Inspector / 节点 / 工具栏）

### 模型与对象存储一览

| 类型 | 提供商 | 能力概要 |
|------|--------|----------|
| 模型 | OpenRouter | 文本 / 图片 / 视频（聚合目录） |
| 模型 | 火山方舟 | 文本 / Seedream 图 / Seedance 视频 / 声音设计 |
| 模型 | 可灵 | 图片 / 视频（API Key） |
| 模型 | MinMax | 文本 / 图片 / 视频 / 音色设计 |
| 模型 | 通义千问 | 文本（兼容模式）/ 万相图 / 万相视频（含 HappyHorse 等） |
| 模型 | 魔塔 | 文本 / 文生图（访问令牌） |
| 对象存储 | 火山 TOS / 阿里云 OSS / 腾讯云 COS | 参考媒体上传与签名 URL；设置中互斥启用 |

配置入口：**设置 → 模型** / **设置 → 对象存储**。

---

<a id="quick-start"></a>

## Quick Start

**用安装包**

1. 从 [Releases](https://github.com/Justin-sky/ai-art-engine/releases) 下载对应平台包  
2. 安装启动 → 新建工程  
3. 设置里添加模型提供商并填写密钥；可选配置对象存储  
4. 顶栏「一键工作流」快速出宿主资产，或在分镜 / 节点图中手搭链路  

完整操作说明见 [使用手册](https://justin-sky.github.io/ai-art-engine/manual.html)（源码在 `website/manual.html`）。

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

需要 **Node.js 22+**。Electron 下载失败时可：

```bash
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
node node_modules/electron/install.js
```

```bash
npm run typecheck && npm test   # 检查
npm run pack                    # 未封装目录，便于自测
```

---

## 版本与更新

- 版本号以 [`package.json`](./package.json) 的 `version` 为准（SemVer），变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
- **发版**：先改 `package.json` 与 CHANGELOG，提交后打 tag 并推送，例如：

```bash
git tag v2.0.0-alpha.0
git push origin v2.0.0-alpha.0
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

`Electron` · `Vue 3` · `Pinia` · `TypeScript` · `Fabric.js` · `electron-vite` · `electron-builder`

---

## License

[GPL-3.0](./LICENSE) — 修改并再分发时，衍生作品需以相同协议开源。

---

<div align="center">
  <p>如果这个项目对你有帮助，请点一颗 ⭐ Star</p>
  <img src="docs/assets/logo-mark.png" alt="" width="40" />
</div>
