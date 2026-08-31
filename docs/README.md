# 文档目录

面向用户的手册与教程在官网（`website/`），开发说明在本目录。

## 用户

| 文档 | 说明 |
|------|------|
| [快速上手](https://justin-sky.github.io/ai-art-engine/quickstart.html) | 新用户 5 分钟跑通首条生成链路 |
| [使用手册](https://justin-sky.github.io/ai-art-engine/manual.html) | 工程、设置（含 MCP 工具服务）、工作区（含 AI 对话面板）、一键工作流、节点图、时间线、导演台 |
| [视频生成指南](https://justin-sky.github.io/ai-art-engine/guide-video.html) | 自由画布 · 视频生成与参考视频 |
| [短视频教程](https://justin-sky.github.io/ai-art-engine/guide-short-video.html) | 短视频一键工作流 |
| [ComfyUI 接入](https://justin-sky.github.io/ai-art-engine/guide-comfyui.html) | API 2 与本机 comfy-api-proxy |
| [MCP 接入教程](https://justin-sky.github.io/ai-art-engine/guide-mcp.html) | 外部 Agent 接入（stdio 桥 / HTTP 直连） |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更 |

源码：`website/manual.html` 等。本地预览：`npm run site`。

## 开发

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 进程边界、Editor Kernel、Cordis 运行时、注册表 |
| [GRAPH_PLUGINS.md](./GRAPH_PLUGINS.md) | 节点类型、Scope、Policy、卡片、Skill、端口连线 |
| [ASSET_MODEL.md](./ASSET_MODEL.md) | 工程内资产目录与旁挂 meta |
| [ASSET_REF.md](./ASSET_REF.md) | `{ $type: "AssetRef", guid }` 引用 |
| [ASSET_PACKAGE.md](./ASSET_PACKAGE.md) | `.aipackage` 跨工程素材包 |
| [ROADMAP.md](./ROADMAP.md) | 路线图 |
| [MCP.md](./MCP.md) | MCP Server 接入：外部 Agent 驱动应用 |
| [DEEPSEEK_HARNESS.md](./DEEPSEEK_HARNESS.md) | AI 对话面板（DeepSeek Harness 运行时）用户指南：像跟同事聊天一样指挥创作流水线 |
| [examples/graph-extension](../examples/graph-extension/README.md) | 图插件骨架 |

连线规则（与手册 §7.1 一致）：两端 `dataType` 必须相同；单数与复数不互通；选取节点只收列表口。
