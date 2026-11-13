# DeepSeek Harness 架构升级说明（v9.0.0 → 请参阅 `PI_AGENT.md`）

> **[!IMPORTANT] `v9.0.0` 重大架构升级提示**
> 自 **AI Art Engine `v9.0.0`** 起，内置 AI 对话工作台已从 `v8.x` 的外部受限子进程 `@deepseek-ai/dsh`（`deepseekHarnessService.ts` / `resources/dsh` / `.jsonl.zstd`）全面升级为运行在 Electron 主进程内部的 **进程内 Pi Agent 9.0 运行时（`src/main/agent/`）**。
>
> 最新完整技术手册与排障指南请直接参阅：**[PI_AGENT.md](./PI_AGENT.md)**。

---

## `v8.x`（`dsh`）与 `v9.0.0`（Pi Agent 9.0）核心演进对照

| 维度                   | `v8.x` 旧架构（DeepSeek Harness `dsh`）                               | `v9.0.0` 现行架构（In-Process Pi Agent `src/main/agent/`）                                                                                                      |
| :--------------------- | :-------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **进程与运行模型**     | 外部独立 Node 子进程（`ELECTRON_RUN_AS_NODE=1` 拉起 `resources/dsh`） | **Electron 主进程内原生运行**（`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` `^1.5.2`，`piHarnessService.ts`），零子进程冷启动开销                  |
| **模型协议与容错**     | 受限于外部 CLI 支持的网关格式                                         | **多协议原生流式直连**（`openai-completions` / `anthropic-messages` / `google-generative-ai`），内置畸形工具 JSON 状态机修复与 `<｜DSML｜function_calls>` 恢复  |
| **MCP 工具调用链路**   | 子进程经本机 HTTP 回环请求 `127.0.0.1:43110/mcp`                      | **进程内零回环内存直调**（`callInProcessMcpTool`）；同时对外保留 `127.0.0.1:43110` 与零依赖 `npx -y ai-art-engine-mcp` stdio CLI 供外部 IDE Agent 接入          |
| **`128` 工具上限治理** | 全量挂载工具易触发网关 `400 tools array too long`                     | **按需懒加载引擎（`mcpLazyToolsets.ts`）**：`24` 常驻核心工具 + `6` 大领域工具包 + `ext:<serverId>` 关键词相关性挂载（`MAX_ACTIVE_TOOLS = 96 < 128`）+ 意图预热 |
| **并发与子代理**       | 单会话串行受限                                                        | **最高 6 槽跨工程并发会话**（`MAX_PARALLEL_SESSIONS = 6`）+ `spawn_subagent` 四大影视/美术/3D/剪辑专业子代理隔离协同                                            |
| **权限门禁与实时沙箱** | 依赖本地 HTTP 头与临时文件轮询 `ask_user`                             | **原生双层门禁（`piGovernance.ts`）**：工具暴露过滤 + `beforeToolCall` 硬拦截、内存态 `ask_user` 同轮解锁、失败即关闭单次审批卡与盘中实时切换 `🔓 完全访问`     |
| **会话持久化格式**     | 压缩流 `.jsonl.zstd`（跨模型切换时易出现文件句柄锁冲突）              | **无锁原子 JSON**（`<userData>/dsh-harness/pi-sessions/<sessionId>.json`，`*.tmp` → `rename`），中途任意切模型零锁冲突，支持瞬时回退/分叉与 `.zip` 导出         |
| **技能与记忆目录兼容** | `<userData>/dsh-harness/skills`（`$DSH_HOME/skills`）                 | **路径 100% 原位兼容保留**（`src/main/services/dshPaths.ts`），用户已安装的技能市场包、GitHub `SKILL.md` 与工程 `.aiartengine/memory.md` 无需任何迁移直接使用   |

---

## 相关权威文档导航

- **[PI_AGENT.md](./PI_AGENT.md)** — `v9.0.0` 进程内 Pi Agent 运行时、按需懒加载工具引擎、原生治理沙箱与对话工作台完整指南
- **[MCP.md](./MCP.md)** — 102 工具双向 MCP 服务、`npx -y ai-art-engine-mcp` 零依赖 CLI 接入与全量工具清单
- **[MARKETPLACE.md](./MARKETPLACE.md)** — 技能市场、`ai-art-engine-skills` 工作流包与 Claude Code `SKILL.md` 开发者规范
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — AI Art Engine `v9.0.0` 全局五层架构与八大工业交付子系统说明
