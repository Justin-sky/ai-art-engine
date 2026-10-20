# 文档目录

面向用户的手册与教程在官网（`website/`），开发说明在本目录。

## 用户

| 文档                                                                          | 说明                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [快速上手](https://justin-sky.github.io/ai-art-engine/quickstart.html)        | 零配置即刻体验示例工程 + 3 分钟跑通首条生成链路                                                                                                                                                    |
| [使用手册](https://justin-sky.github.io/ai-art-engine/manual.html)            | 工程、设置（含 MCP 服务与本地视觉）、工作区（AI 对话与技能市场）、节点图（含 16 类游戏 UI 拆层导出可编辑 PSD / Unity / Godot 代码、PNG 即工作流）、影视工作台、时间线（含剪映草稿导出）、3D 导演台 |
| [视频教程](https://justin-sky.github.io/ai-art-engine/guide-video.html)       | 自由画布 · 视频生成与参考视频                                                                                                                                                                      |
| [短剧教程](https://justin-sky.github.io/ai-art-engine/guide-short-video.html) | 影视工作台四阶段闭环（分镜拆解 → 导演审核 → `#variant` 角色服装设定 → 批量拍摄）                                                                                                                   |
| [可玩 HTML](https://justin-sky.github.io/ai-art-engine/guide-gameplay.html)   | 一句话生成单文件 `single.html` 可玩 HTML5 游戏原型与无头浏览器冒烟自检                                                                                                                             |
| [ComfyUI 接入](https://justin-sky.github.io/ai-art-engine/guide-comfyui.html) | API 2 与本机 comfy-api-proxy                                                                                                                                                                       |
| [NewAPI 接入](https://justin-sky.github.io/ai-art-engine/guide-newapi.html)   | 内置 NewAPI 提供商 + 自建 OpenAI 兼容中转网关；端点元数据区分文本 / 图片模型                                                                                                                       |
| [MCP 接入教程](https://justin-sky.github.io/ai-art-engine/guide-mcp.html)     | 外部 Agent 接入（Claude Code / Codex / Cursor stdio 桥与 HTTP 直连 + Blender MCP）                                                                                                                 |
| [CHANGELOG.md](../CHANGELOG.md)                                               | 版本变更                                                                                                                                                                                           |

源码：`website/manual*.html`（概述页 + 五个章节子页）等。本地预览：`npm run site`。

## 开发

| 文档                                                              | 说明                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)                              | 进程边界、Editor Kernel、Cordis 运行时、全工作区 AI 直控四支柱架构、工业级交付导出器（PSD `TySh` / Unity / Godot / Spine / 剪映草稿 / PNG 隐写）                                                                 |
| [PORTRAIT.md](./PORTRAIT.md)                                      | 人像处理节点（`image.portrait`）：参数契约、提示词派生、局部回贴、编辑器与依赖                                                                                                                                   |
| [ARCH_YOLO_LOCAL.md](./ARCH_YOLO_LOCAL.md)                        | 本地视觉（YOLO 检测/分割/姿态、468 点人脸网格、SAM 2.1）与跨平台本地离线 OCR（Windows WinRT / macOS Vision / Linux Tesseract）架构                                                                               |
| [GRAPH_PLUGINS.md](./GRAPH_PLUGINS.md)                            | 节点类型、Scope、Policy、卡片、节点原生能力（`NodeCapabilityDef`）、端口连线                                                                                                                                     |
| [ASSET_MODEL.md](./ASSET_MODEL.md)                                | 工程内资产目录与旁挂 meta                                                                                                                                                                                        |
| [ASSET_REF.md](./ASSET_REF.md)                                    | `{ $type: "AssetRef", guid }` 引用                                                                                                                                                                               |
| [ASSET_PACKAGE.md](./ASSET_PACKAGE.md)                            | `.aipackage` 跨工程素材包                                                                                                                                                                                        |
| [ROADMAP.md](./ROADMAP.md)                                        | 路线图                                                                                                                                                                                                           |
| [MCP.md](./MCP.md)                                                | MCP Server 接入：外部 Agent 驱动应用                                                                                                                                                                             |
| [DEEPSEEK_HARNESS.md](./DEEPSEEK_HARNESS.md)                      | AI 对话面板（DeepSeek Harness 运行时）用户指南：像跟同事聊天一样指挥创作流水线                                                                                                                                   |
| [MARKETPLACE.md](./MARKETPLACE.md)                                | **技能市场开发者文档**：发布内容、Claude Code 技能规范支持与 GitHub 直装、技能包契约、脚本同意流与审批、派生索引、交付链路（[官网版](https://justin-sky.github.io/ai-art-engine/developers.html)，改需两处同步） |
| [examples/graph-extension](../examples/graph-extension/README.md) | 图插件骨架                                                                                                                                                                                                       |

连线规则（与手册 §7.1 一致）：两端 `dataType` 必须相同；单数与复数不互通；选取节点只收列表口。
