<div align="center">
  <img src="docs/assets/logo.png" alt="AIArtEngine" width="120" />

  <h1>AIArtEngine</h1>

  <p><b>本地 AI 短视频创作工作台</b></p>
  <p>
    工程与素材都在本机 · 分镜与节点图驱动生成<br />
    对接 OpenRouter / 火山方舟（Seedream · Seedance · 声音）
  </p>

  <p>
    <a href="https://github.com/Justin-sky/aiartengine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/aiartengine?style=social" alt="GitHub stars" /></a>
    <a href="https://github.com/Justin-sky/aiartengine/network/members"><img src="https://img.shields.io/github/forks/Justin-sky/aiartengine?style=social" alt="GitHub forks" /></a>
    <a href="https://github.com/Justin-sky/aiartengine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/aiartengine?include_prereleases&label=release&style=flat-square" alt="release" /></a>
    <a href="https://github.com/Justin-sky/aiartengine/releases"><img src="https://img.shields.io/github/downloads/Justin-sky/aiartengine/total?label=downloads&style=flat-square" alt="downloads" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat-square" alt="license" /></a>
    <a href="package.json"><img src="https://img.shields.io/badge/version-1.0.0-orange.svg?style=flat-square" alt="version" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Local--First-本地优先-00B894?style=for-the-badge" alt="local" />
    <img src="https://img.shields.io/badge/Node_Graph-节点图-6C5CE7?style=for-the-badge" alt="graph" />
    <img src="https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-多平台-0984E3?style=for-the-badge" alt="platform" />
  </p>

  <p>
    <a href="./website/index.html"><b>官网</b></a> ·
    <a href="#download"><b>Download</b></a> ·
    <a href="#features"><b>Features</b></a> ·
    <a href="#quick-start"><b>Quick Start</b></a> ·
    <a href="./README.en.md"><b>English</b></a>
  </p>
</div>

---

<a id="download"></a>

## Download

| Platform | Package | Get it |
|----------|---------|--------|
| **Windows** | `.exe` | [GitHub Releases](https://github.com/Justin-sky/aiartengine/releases) |
| **macOS** | `.dmg` | 同上（需 Mac / CI 构建；未签名时在「隐私与安全性」允许） |
| **Linux** | `.AppImage` | 同上（`chmod +x` 后运行） |

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
- **节点图生成** — 文本 / 图片 / 视频 / 声音节点，指令面板与模型参数
- **多模型** — OpenRouter、火山方舟（Seedream / Seedance / 声音设计）
- **可扩展** — Editor Kernel + 声明式扩展（窗口 / Inspector / 节点 / 工具栏）

---

<a id="quick-start"></a>

## Quick Start

**用安装包**

1. 从 [Releases](https://github.com/Justin-sky/aiartengine/releases) 下载对应平台包  
2. 安装启动 → 新建工程  
3. 设置里填写 API Key → 在分镜 / 节点图中创作  

**从源码**

```bash
git clone https://github.com/Justin-sky/aiartengine.git
cd aiartengine
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
git tag v1.0.0
git push origin v1.0.0
```

  CI 会校验 tag（去掉 `v`）与 `package.json` 一致，再构建并发布 [GitHub Release](https://github.com/Justin-sky/aiartengine/releases)（含 `latest.yml` 等更新元数据）。
- **客户端更新**：安装包启动后会检查 Releases；也可在 **设置 → 通用 → 关于与更新** 中手动检查，下载完成后重启安装。开发模式（`npm run dev`）不检查更新。

---

## Contribute

欢迎 Issue 与 Pull Request。提交前建议：

```bash
npm run typecheck && npm test
```

讨论与缺陷跟踪请走 [GitHub Issues](https://github.com/Justin-sky/aiartengine/issues)。

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
