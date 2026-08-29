# MCP Server 接入指南

AiArtEngine 内置一个本地 **MCP 工具服务**，让外部 AI Agent（Claude Code、Codex 等）可以直接操作你的工程：浏览资产、用自然语言规划并落盘节点图工作流、查询异步视频任务等。

## 架构

```
Claude Code / Codex ──stdio(MCP)──▶ scripts/mcp-bridge.mjs ──HTTP──▶ AiArtEngine 应用（127.0.0.1 工具服务）
```

- 应用启动时在 `127.0.0.1` 起一个带 Bearer token 的本地工具服务，并把 `{ port, token, pid }` 写入
  `<userData>/mcp.json`（Windows 为 `%APPDATA%/aiartengine/mcp.json`），退出时删除。
- `scripts/mcp-bridge.mjs` 是零依赖的 stdio MCP 桥：由 MCP 客户端拉起，读取 mcp.json（或环境变量）转发调用。
- 通信仅限本机回环地址；除 `/health` 外全部需要 token。

## 接入（Claude Code 为例）

1. 启动 AiArtEngine 桌面应用。
2. 注册 MCP server（开发场景，桥在仓库内）：

```bash
claude mcp add aiartengine -- node <仓库绝对路径>/scripts/mcp-bridge.mjs
```

或手动写入 MCP 配置：

```json
{
  "mcpServers": {
    "aiartengine": {
      "command": "node",
      "args": ["C:/path/to/ai-art-engine/scripts/mcp-bridge.mjs"]
    }
  }
}
```

3. 重启会话，即可在对话中直接使用工具，例如：
   「列出我的最近工程」「打开这个工程，用行业模板 shortDrama 规划一条工作流并落盘」。

> 环境变量覆盖：`AIAE_MCP_CONFIG` 指定 mcp.json 路径；`AIAE_MCP_PORT` + `AIAE_MCP_TOKEN`
> 直连指定端口与 token。桥会依次尝试端口 43110–43119。

## 工具清单（v0.1）

| 工具 | 作用 | 依赖 |
| --- | --- | --- |
| `app_status` | 版本、当前工程、资产数量 | 应用运行 |
| `project_list` | 最近工程路径列表 | 无（读配置） |
| `project_open` | 打开工程 | 应用运行 |
| `project_create` | 新建工程 | 应用运行 |
| `asset_list` | 列出当前工程资产 | 已打开工程 |
| `asset_read_file` | 按相对路径读取工程内文本文件 | 已打开工程 |
| `asset_write_text` | 更新文本资产（剧本 / 备注），界面同步刷新 | 已打开工程 |
| `workflow_list_presets` | 行业模板列表（id + 标题） | 应用运行 |
| `workflow_plan` | 自然语言 → GraphPlan 预览（走应用已配置的文本模型，耗时可能数十秒） | 已打开工程 + 文本模型 |
| `workflow_commit` | 把 plan 落盘为宿主资产，界面同步出现 | 已打开工程 |
| `task_run` | 运行一个已落盘的宿主资产工作流（整图拓扑序执行，输出写回资产），返回 `mcpTaskId` | 已打开工程 + 应用界面运行 |
| `task_status` | 按 `mcpTaskId` 查询运行状态（running / done / error / stopped） | 应用运行 |
| `video_job_list` / `video_job_get` | 异步视频生成任务状态 | 应用运行 |
| `graph_edit` | 对宿主资产图应用节点 / 连线编辑操作批（类型与端口兼容性在应用内校验；图在编辑器中打开时拒绝） | 已打开工程 |
| `models_list` | 已启用的模型提供商与各模态勾选模型（不含任何密钥） | 无（读设置） |
| `generate_image` | 文生图 / 图生图，落盘为工程资产 | 已打开工程 + 图片模型 |
| `generate_video` | 提交视频生成并登记资产（异步，可 `video_job_*` 跟踪） | 已打开工程 + 视频模型 |
| `generate_model3d` | 文生 3D / 图生 3D，产出 GLB 资产（异步） | 已打开工程 + 3D 模型 |

安全约定：服务只监听 `127.0.0.1`、token 鉴权；文件读写被工程服务限制在工程根目录内；
`settings_get` 类密钥信息不对外暴露。

## 当前限制

- 语音生成（`generate_speech`）暂未暴露：当前语音生成返回内容而非落盘资产。
- `task_run` 依赖应用界面进程执行任务：请保持应用处于运行状态；同一图重复触发会按「进行中任务」去重。
- 桥脚本分发：安装包内置在 `<安装目录>/resources/mcp-bridge.mjs`；开发场景用仓库内
  `scripts/mcp-bridge.mjs`（需 Node.js 18+）。
