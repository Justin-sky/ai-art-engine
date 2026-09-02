# 多 Agent 协作架构设计

> 在现有"单 agent（dsh 子进程）一次一任务"的基础上，演进为**多 agent 会话并行 + 可选编排协作**。
> 目标是让"编剧 agent 写 prompt、绘图 agent 出图、审核 agent 把关"这类创作流水线成为可能，
> 同时保持每次演进都可独立落地、可回退。

## 1. 背景与现状

当前推理链路（`src/main/services/deepseekHarnessService.ts`）：

```
ChatPanel → HARNESS_RUN → spawn dsh --profile headless <task>
  → dsh 内嵌 mcp-client → http://127.0.0.1:43110/mcp（应用内置 MCP 工具服务）
  → 工具执行（generate_image 等）→ MCP 活动广播 → 工具卡
  → dsh stdout/stderr 按行解析 → HARNESS_EVENT 广播（assistant/status/tool/reasoning/done/error/context/final）
```

关键约束（改造的出发点）：

| 现状 | 位置 | 含义 |
|---|---|---|
| 单例子进程 | `deepseekHarnessService.ts:69` `child: ChildProcess \| null` | 全局同时只能跑一个任务；`L1513` 直接拒绝并发 |
| 会话状态全局单例 | `runSeq` / `lastStatusText` / `harnessAskUserRequests` | 无并发归属 |
| 事件无归属 | `HarnessEvent` 无 `agentId` 字段，`HARNESS_EVENT` 全窗口广播 | 多 agent 并发时渲染层无法分流 |
| 会话=子进程+JSONL | `AIART_SESSION_ID` 环境变量，`$DSH_HOME/sessions/*.jsonl` | "一个 agent = 一个进程 + 一个会话"模型天然成立 |
| 会话 UI 本地存储 | `useChatHistory.ts`：`studio.chat.sessions.v1`（localStorage） | 会话与 agent 的绑定关系在渲染层 |
| 工具共享 | MCP Server `127.0.0.1:43110` | 工具能力天然多 agent 共享，**无需改造** |
| agent 模式 | ChatPanel 传 `mode: 'craft' \| 'ask' \| 'plan'` → 切换 dsh system-prompt | 已具备"角色"雏形，可扩展为多 agent 的 profile |

## 2. 目标与边界

**做什么**：
- 支持多个 agent **并发**运行，各有独立的模型、system prompt、技能白名单、工作区与历史。
- 支持从"人工编排"（多标签页各干各的）平滑演进到"半自动"（转交/管道）与"自主协作"（Orchestrator 拆解汇总）。
- 渲染层按 agent 分流事件，工具卡、token 统计、abort、会话删除全部按 agent 归属。

**不做什么（本阶段）**：
- 不做 agent 间实时 socket / 直接互调协议——统一走"Orchestrator 中继 + 共享工作区文件"。
- 不做模型自托管 / 训练 / 微调。
- 不做 agent 市场 / 云端编排。
- 不改变 MCP 工具服务本身（保持共享单一实例）。

## 3. 核心概念

- **Agent（角色）**：一个配置化的执行者，静态描述"它是谁"。
  `agentId`、名称、profile（角色模板）、model、systemPrompt、skills 白名单、workspace。
- **Agent Runtime（运行时）**：Agent 的一次活跃实例 = 一个 dsh 子进程 + 一个 JSONL 会话文件。
  同一 Agent 可以被实例化多次（如两个"绘图 agent"跑不同任务）。
- **Agent Session（会话）**：用户与一个 runtime 的多轮对话记录，映射现有 `ChatSession`。
- **Orchestrator（调度器）**：可选。维护任务 DAG、监听所有 runtime 事件、做转交/拆解/汇总。

## 4. 架构总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 渲染层 Renderer                                                           │
│  AgentPanel（多标签页，每个绑定一个 agentId）                              │
│  ├─ ChatPanel（复用现有会话 UI，按 agentId 过滤事件）                     │
│  ├─ OrchestratorView（可选：任务 DAG 可视化）                             │
│  └─ useChatHistory → localStorage key 增加 agent 命名空间                 │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ HARNESS_*（invoke/on）
┌───────────────▼──────────────────────────────────────────────────────────┐
│ 主进程 Main                                                               │
│  ├─ AgentRegistry              Map<agentId, AgentRuntime>                │
│  │     agent-1 → dsh child#1 → JSONL#1 → workspace/agent-1              │
│  │     agent-2 → dsh child#2 → JSONL#2 → workspace/agent-2              │
│  │     ...上限 N（默认 3，可配）                                          │
│  ├─ AgentEventBus              HARNESS_EVENT 增加 agentId 维度            │
│  ├─ MCP Server                 （共享，127.0.0.1:43110，不改）            │
│  ├─ AgentBridge（模式 B）      forward(agentA → agentB, payload)         │
│  └─ Orchestrator（模式 C）     任务 DAG、监听 done/tool、汇总             │
└───────────────────────────────────────────────────────────────────────────┘
```

**进程模型**：每个 runtime 持有自己的 dsh 子进程；进程数与 agent 并发数一一对应。
复用现有 `ELECTRON_RUN_AS_NODE=1` 启动方式，仅把"全局 child"改为"按 agentId 管理"。

## 5. 关键设计决策

| 决策 | 理由 |
|---|---|
| `AgentRegistry = Map<agentId, AgentRuntime>` 替代全局 `child` | 最小改造：`deepseekHarnessService` 内部结构不变，只做去单例化 |
| `HarnessEvent` 增加可选 `agentId`（缺省 `'default'`） | 向后兼容：旧调用方不传 agentId 行为不变 |
| 事件用 `agentId` 而非 `sessionId` 路由 | runtime 生命周期与 UI 会话解耦；一个 agent 的多次任务共享事件维度 |
| 会话文件按 agent 命名空间 | `AIART_SESSION_ID = 'agent-<agentId>-<uiSessionId>'`，避免多 agent 历史串号 |
| 工具共享单一 MCP 实例 | 工具（出图/上传/YOLO）无状态、可并发，agent 只需约定"用哪个工作区文件" |
| agent 间通信走"Orchestrator 中继 + 工作区文件" | 不引入 agent↔agent 直接消息，避免死锁/循环调用，每个 agent 保持"无状态任务输入" |
| 渲染层按 `agentId` 过滤 `HARNESS_EVENT` | 无需新通道；一个监听器分发到对应面板 |
| 并发上限 + 排队 | 每个 dsh 进程有固定内存/CPU 开销；超限任务入 FIFO 队列而非报错 |

## 6. 数据结构设计

### 6.1 共享层（`src/shared/ipc.ts`）

```ts
/** Agent 静态配置（设置页可维护多份） */
export interface AgentConfig {
  agentId: string            // 'planner' | 'painter' | 'critic' | 'custom-xxx'
  name: string               // UI 显示名
  profile: 'craft' | 'ask' | 'plan' | 'custom'   // 复用现有 dsh system-prompt 切换
  model?: string             // 缺省走全局设置
  systemPrompt?: string      // profile 之外的追加指令
  skills?: string[]          // 技能白名单，缺省 = 全部
  workspace?: string         // 缺省 userData/workspaces/<agentId>
  color?: string             // UI 标识色
}

/** HARNESS_RUN 入参：在 HarnessRunInput 基础上增加 agent 归属 */
// { task, sessionId, model, providerId, mode, agentId? }

/** HARNESS_EVENT：每个事件变体增加可选 agentId（缺省 'default'） */
export type HarnessEvent =
  | { type: 'assistant'; text: string; agentId?: string }
  | { type: 'status'; text: string; agentId?: string }
  | { type: 'tool'; id?: string; name: string; state: 'start'|'done'|'error'; detail?: string; agentId?: string }
  | { type: 'reasoning'; text: string; agentId?: string }
  | { type: 'final'; text: string; agentId?: string }
  | { type: 'done'; runId: string; agentId?: string }
  | { type: 'error'; message: string; agentId?: string }
  | { type: 'context'; used: number; agentId?: string }

/** 新增通道（模式 B/C 需要） */
// 'agent:forward'  —— 模式 B：把 A 的结论/产物转交 B
// 'agent:list'     —— 查询已注册 AgentConfig + 活跃 runtime 状态
// 'orchestrator:run' —— 模式 C：提交一个多 agent 任务（任务描述 → DAG）
```

### 6.2 主进程（`src/main/services/agentRuntime.ts`）

```ts
export interface AgentRuntime {
  agentId: string
  child: ChildProcess | null       // 由现有 deepseekHarnessService 迁移而来
  runSeq: number
  lastStatusText: string
  askUserRequests: Map<string, string>   // requestId → answerFile
  config: AgentConfig
  state: 'idle' | 'running' | 'waiting-ask'
  queue: HarnessRunInput[]         // 超限并发时排队
}
```

## 7. 模块清单

| 文件 | 职责 | 改动量 |
|---|---|---|
| `src/shared/ipc.ts` | `AgentConfig`、`HarnessEvent.agentId`、新通道 | 小 |
| `src/main/services/deepseekHarnessService.ts` | 去单例化：`child` → `Map<agentId, runtime>`；`run/abort/delete` 按 agentId 路由 | 中 |
| `src/main/services/agentRegistry.ts`（新增） | runtime 生命周期、并发上限与排队、AgentConfig 加载 | 中 |
| `src/main/services/agentBridge.ts`（新增，模式 B） | `forward(agentA, agentB, payload)`：A 的 done 事件 → B 的新任务 | 小 |
| `src/main/services/agentOrchestrator.ts`（新增，模式 C） | 任务 DAG、监听所有 runtime 事件、拆解/汇总 | 大 |
| `src/renderer/src/components/AgentPanel.vue`（新增） | 多标签页容器，每个标签绑定一个 agentId | 中 |
| `src/renderer/src/components/ChatPanel.vue` | `HARNESS_EVENT` 按 agentId 过滤；`runHarnessTask` 传 agentId | 小 |
| `src/renderer/src/composables/useChatHistory.ts` | 会话 key 加 agent 命名空间；会话记录 `agentId` | 小 |
| 设置页 `SettingsView.vue` / `ModelsPanel.vue` | AgentConfig 管理 UI（新建/编辑/删除 agent 预设） | 中 |

## 8. 三种协作模式

### 模式 A：并发多会话（人工编排）—— 第一步

用户在 AgentPanel 开多个标签，各绑一个 agentId，各自对话、互不感知。

**改造点**：
1. `deepseekHarnessService.ts`：全局 `child`/`runSeq`/`lastStatusText` 收进 `AgentRuntime`；
   `runHarnessTask` 按 `agentId` 找/建 runtime 后 spawn；`abortHarnessTask(agentId)` 定位 kill。
2. 事件带 `agentId`，渲染层监听后分流到对应标签。
3. `useChatHistory`：localStorage key 改为 `studio.chat.sessions.v1.<agentId>`，
   `ChatSession` 增加 `agentId` 字段。
4. 并发上限：`AgentRegistry` 默认 3，超出进队列（复用现有"已有任务正在运行"文案改为排队提示）。

**验收**：两个标签同时跑任务，事件、工具卡、abort 互不串扰；历史互不覆盖。

### 模式 B：顺序管道 / 转交（半自动）

允许一个 agent 把结论或产物转给另一个。

**机制**：
- `agent:forward { from, to, payload }`。payload 三选一：
  - `text`：A 的最终文本（`final` 事件内容）
  - `file`：A 在工作区写出的产物路径（如 `workspaces/planner/storyboard.md`）
  - `live`：B 直接从 A 的 `final` 事件取值（订阅式）
- 主进程 `AgentBridge` 在 A 的 `done` 事件后把 payload 拼进 B 的 `task` 输入。
- 工作区共享是核心：所有 agent 默认共享工程根目录（现有 `resolveWorkspace()` 已支持），
  文件即协议——A 写 `outputs/xxx.png`，B 的 prompt 引用该相对路径。

**典型流水线**：`planner（分镜文本）→ painter（逐镜出图）→ critic（审核返回修改意见）`。

### 模式 C：自主协作（Orchestrator）

一个 planner agent 把任务拆给多个 worker，汇总结果。

**机制**：
- `Orchestrator` 持有任务 DAG：`node = { role: agentId, input, dependsOn: [] }`。
- 监听所有 runtime 的 `done`/`tool`/`error`，满足依赖即下发下一个 node。
- worker 与 orchestrator 通过**共享工作区文件**交换中间产物：
  每个 node 的输入是 `task: <指令> + artifacts: [<相对路径>]`，输出写回工作区。
- 汇总：`aggregate` 节点把各 worker 的产物路径列表 + 摘要合并成最终交付。

**通信协议约定（避免死锁）**：
- agent 之间**不直接互调**；所有消息经 Orchestrator 单向中继。
- 每个 node 幂等：输入固定（task + artifacts 列表），可重跑。
- 失败策略：node 错误 → 重试 1 次 → 标记 failed 并通知依赖节点跳过。

## 9. 事件流改造（最小破坏性）

```ts
// 现状：单通道全量广播
broadcastToAllWindows(IpcChannels.HARNESS_EVENT, event)

// 目标：事件携带 agentId，渲染层分流；不改变事件本身结构
broadcastToAllWindows(IpcChannels.HARNESS_EVENT, { ...event, agentId: runtime.agentId })

// 渲染层（ChatPanel）：
window.studio.onHarnessEvent((e) => {
  if (e.agentId && e.agentId !== props.agentId) return   // 只处理自己标签的
  // ...原有逻辑
})
```

**兼容性**：旧事件（无 `agentId`）视为 `'default'`，未接入 AgentPanel 的窗口行为不变。

## 10. IPC 通道清单（目标态）

| 通道 | 现状 | 目标 |
|---|---|---|
| `harness:status` | 全局 | 加 `agentId?` 查询单 agent |
| `harness:run` | 全局单任务 | 加 `agentId?`（缺省 `default`），并发上限+排队 |
| `harness:abort` | 全局 | 加 `agentId` 定位 kill |
| `harness:delete-session` | 按 sessionId | 加 `agentId`（会话文件命名空间） |
| `harness:event` | 广播 | 事件带 `agentId` |
| `agent:list`（新） | — | 已注册 AgentConfig + 活跃 runtime 状态 |
| `agent:save-config`（新） | — | 设置页管理 AgentConfig |
| `agent:forward`（新，模式 B） | — | 转交 text/file/live |
| `orchestrator:run`（新，模式 C） | — | 提交 DAG 任务 |

## 11. 演进路线

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M1** 并发多会话 | 去单例化、事件带 agentId、渲染层分流、AgentPanel、AgentConfig 设置 UI | 无 |
| **M2** 转交与管道 | `agent:forward`、AgentBridge、工作区产物约定、AgentPanel 内拖拽连线 | M1 |
| **M3** 自主协作 | Orchestrator、任务 DAG、node 幂等与重试、聚合节点、DAG 可视化 | M2 |

每个里程碑独立可回退：M1 不改动任何 M2/M3 涉及的文件。

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 并发 dsh 进程资源占用 | 内存/CPU 上升，慢机器卡顿 | 并发上限默认 3 + FIFO 排队；`--max-old-space-size` 视需要下调 |
| 事件风暴 | 多 agent 同时流式输出 | 渲染层按 agentId 过滤；`status` 去重合并（现有逻辑保留） |
| 会话文件串号 | 多 agent 历史互相污染 | `AIART_SESSION_ID` 必须带 `agent-<agentId>` 前缀；删除会话按 agentId 命名空间 |
| MCP 活动广播无归属 | 工具卡显示到错误标签 | `mcpActivityService` 广播增加 agentId（工具调用上下文透传） |
| abort 歧义 | 中止了错误的进程 | `abortHarnessTask` 必传 agentId；不传时拒绝（不再隐式中止全局） |
| agent 循环调用（模式 C） | DAG 死锁 | 仅 Orchestrator 单向中继；node 幂等；DAG 静态校验无环 |
| localStorage 会话 key 膨胀 | 老数据遗留 | 迁移逻辑：读旧 key 归入 `default` agent，之后不再读写旧 key |

## 13. 附录：与现有能力的衔接

- **模型配置**：`settings.yaml` 的 `agent-default-model` 目前是全局的；M1 起每个 runtime 落地
  到自己的 `$DSH_HOME/agents/<agentId>/settings.yaml`，互不影响。
- **API Key**：仍走 `DEEPSEEK_API_KEY` 环境变量，多 agent 共享同一密钥（不引入按 agent 分钥）。
- **技能（Skills）**：`writeDshSkills` 目前快照全部应用技能；M1 起按 `AgentConfig.skills` 白名单过滤。
- **Ask-User**：`harnessAskUserRequests` Map 收进 runtime；渲染层弹窗按 agentId 定位。
- **token 统计**：`context` 事件带 agentId 后，每个面板独立显示自己的上下文用量。
