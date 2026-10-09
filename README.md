<div align="center">

<a href="https://justin-sky.github.io/ai-art-engine/">
  <img src="docs/assets/banner.webp" alt="AI Art Engine" width="760" height="322" />
</a>

<p><b>Agent 原生的 AI 美术资产引擎</b><br />图片、视频、语音、3D 模型与空间世界，在一个桌面端里生成、沉淀、复用</p>

<p>
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&style=flat-square&labelColor=0d1117&color=5b8cff&label=release" alt="release" /></a>
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/downloads/Justin-sky/ai-art-engine/total?style=flat-square&labelColor=0d1117&color=8b5cf6" alt="downloads" /></a>
  <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=flat-square&labelColor=0d1117&color=f5b301" alt="stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-22d3ee?style=flat-square&labelColor=0d1117" alt="license" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748b?style=flat-square&labelColor=0d1117" alt="platform" />
</p>

<p>
  <a href="https://justin-sky.github.io/ai-art-engine/">官网</a> ·
  <a href="https://justin-sky.github.io/ai-art-engine/quickstart.html">快速上手</a> ·
  <a href="https://justin-sky.github.io/ai-art-engine/manual.html">使用手册</a> ·
  <a href="https://github.com/Justin-sky/ai-art-engine/releases">下载</a> ·
  <a href="./CHANGELOG.md">更新日志</a> ·
  <a href="./README.en.md">English</a>
</p>

</div>

## 简介

AI Art Engine 是一款开源桌面应用，把模型调用、节点编排、3D 预演与成片剪辑放进同一个本地工程，服务短剧、广告、游戏与电商内容生产。

- **Agent 原生**：应用内 AI 对话可直接调用工具完成生成与编排；内置 MCP Server，Claude Code、Codex 等外部 Agent 也能操作你的工程。
- **节点图与一键工作流**：覆盖文本、图片、视频、声音、3D、空间世界等模态；行业模板一键生成可复用的宿主资产。
- **3D 导演台与时间线**：站位、机位与动作录制，成片时间线编排并导出。
- **多模型、本地优先**：接入 30+ 模型提供商，自带 API Key；工程是本机目录里的 JSON 与媒体文件，不经过任何中转服务。

## 快速开始

从 [Releases](https://github.com/Justin-sky/ai-art-engine/releases) 下载安装包：Windows `.exe`、macOS `.dmg`（Intel 选 `x64`，Apple Silicon 选 `arm64`）、Linux `.AppImage`。

1. 启动后进入 **设置 → 模型**，添加提供商并填写 API Key。
2. 新建工程，在工作区「新建」里选择「一键工作流」生成第一组资产。
3. 打开左侧「◈」AI 对话，用 `@` 引用资产，让助手继续生成与编排。

完整流程见 [快速上手](https://justin-sky.github.io/ai-art-engine/quickstart.html)。

## 接入外部 Agent

应用运行时会在 `127.0.0.1` 启动带 Bearer token 的 MCP 工具服务：

```bash
# stdio 桥（需要 Node.js 18+）
claude mcp add aiartengine -- node <安装目录>/resources/mcp-bridge.mjs

# 或 HTTP 直连（接入地址与 token 见 设置 → MCP）
claude mcp add --transport http aiartengine <接入地址> --header "Authorization: Bearer <token>"
```

工具清单与安全设计见 [`docs/MCP.md`](./docs/MCP.md)。

## 从源码构建

需要 Node.js 22+。

```bash
git clone https://github.com/Justin-sky/ai-art-engine.git
cd ai-art-engine
npm install
npm run dev
```

技术栈为 Electron、Vue 3、TypeScript、Pinia、Three.js 与 Cordis，架构说明见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。测试、打包、发版与常见环境问题见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 文档

|            |                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户       | [快速上手](https://justin-sky.github.io/ai-art-engine/quickstart.html) · [使用手册](https://justin-sky.github.io/ai-art-engine/manual.html) · [B 站视频教程](https://space.bilibili.com/3707036976024122) |
| 插件发布者 | [开发者文档](https://justin-sky.github.io/ai-art-engine/developers.html) · [`docs/MARKETPLACE.md`](./docs/MARKETPLACE.md)                                                                                 |
| 贡献者     | [`docs/`](./docs/README.md) · [路线图](./docs/ROADMAP.md) · [更新日志](./CHANGELOG.md)                                                                                                                    |

## 参与贡献

欢迎提交 Issue 与 Pull Request，提交前请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。GitHub 为主仓库，[Gitee](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine) 为国内镜像，两边 `main` 分支保持同步。

<a href="https://github.com/Justin-sky/ai-art-engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Justin-sky/ai-art-engine" alt="contributors" />
</a>

## 社区

QQ 群 `346340389` · `647306826` ｜ [Bilibili](https://space.bilibili.com/3707036976024122) ｜ [X @IoKKFOvWAt12669](https://x.com/IoKKFOvWAt12669) ｜ [284139554@qq.com](mailto:284139554@qq.com)

## 许可证

[GPL-3.0](./LICENSE)
