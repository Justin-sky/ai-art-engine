# 让 AI 助手直接操作 AiArtEngine（MCP 接入指南）

## 这是什么？

AiArtEngine 内置了一个 **MCP 工具服务**（MCP 是"模型上下文协议"，即 AI 助手调用你本机工具的标准方式）。接入后，**Claude Code、Codex 等 AI Agent 就可以直接操作你的工程**，而不用你手动点界面。应用内的 **AI 对话面板**（工作区左侧「◈」按钮）也通过这套同一工具面运行——它在聊天里 `@` 引用资产并让 Agent 调用下列工具，行为与外部 Agent 完全一致。

能帮你做什么，举几个例子（对话里直接说就行）：

- 「列出我最近的工程」→ `project_list`
- 「打开工程 `demo`，用 `shortDrama` 模板规划一条工作流并落盘」→ `workflow_plan` + `workflow_commit`
- 「把剧本里第 3 段改成……并更新资产」→ `asset_read_file` + `asset_write_text`
- 「生成一张标题图 / 一段口播音频，存进工程」→ `generate_image` / `generate_speech`
- 「刚才提交的视频生成好了吗？」→ `task_status` / `video_job_get`

一句话：**应用负责干活，Agent 负责发指令，全程不离开你的对话窗口。**

---

## 快速开始（5 分钟跑通）

前置条件：已安装并启动 AiArtEngine 桌面应用（工具服务随应用启动，退出即关闭）。

接入有**两种方式，任选其一**：

| | 方式 A：stdio 桥 | 方式 B：HTTP 直连 |
|---|---|---|
| 一句话 | Claude Code 帮你拉起一个桥脚本，桥再转发给应用 | 客户端直连应用的工具服务 |
| 需要 Node.js | 是（18+） | 否 |
| 适用 | 本机日常使用（推荐） | 客户端不支持 stdio、或不想装 Node |
| 端点/命令 | `scripts/mcp-bridge.mjs` | `http://127.0.0.1:43110/mcp` |

### 方式 A：stdio 桥（推荐）

1. 启动 AiArtEngine 应用。
2. 在工程根目录执行下面命令，向 Claude Code 注册这个 MCP server（`<仓库绝对路径>` 换成实际路径）：

   ```bash
   claude mcp add aiartengine -- node <仓库绝对路径>/scripts/mcp-bridge.mjs
   ```

   > 开发场景用仓库内脚本；安装包里也内置了一份，位于 `<安装目录>/resources/mcp-bridge.mjs`。

3. 新开一个 Claude Code 会话（注册后需重启会话生效），然后直接说：
   「列出我的工程，打开最近的一个，告诉我里面有哪些资产」。

### 方式 B：HTTP 直连（无需 Node.js）

1. 启动 AiArtEngine 应用。
2. 找到应用的连接信息文件 `mcp.json`（Windows 在 `%APPDATA%\aiartengine\mcp.json`），里面是 `{ port, token, pid, version }`。
3. 注册（把 `<token>` 换成文件里的 token）：

   ```bash
   claude mcp add --transport http aiartengine http://127.0.0.1:43110/mcp --header "Authorization: Bearer <token>"
   ```

   > 端口默认是 43110；如果被占用，应用会依次尝试 43110–43119，用实际端口替换即可。

4. 新开会话验证（同上）。

### 怎么确认接通了？

会话里问一句：「调用一下 `app_status`，看下当前版本和打开的工程」。有正常返回就说明通了；返回报错看文末[常见问题](#常见问题排查)。

---

## 原理：消息是怎么走的

```
┌────────────────┐  MCP(stdio)   ┌────────────────────┐   HTTP    ┌────────────────────────┐
│ Claude Code    │──────────────▶│ mcp-bridge.mjs     │──────────▶│ AiArtEngine 应用        │
│ Codex 等 Agent │◀──────────────│（纯隧道，只转发）    │◀─────────│ 127.0.0.1 工具服务      │
└────────────────┘               └────────────────────┘           └────────────────────────┘
```

- **方式 A** 走完整条链路：Agent 拉起桥 → 桥把消息原样 POST 到应用的 `/mcp` 端点。
- **方式 B** 跳过桥，Agent 直连应用的 `/mcp` 端点。

关键点：**桥不做任何协议处理**，只负责转发（stdin 一行进、stdout 一行出）。协议语义（版本协商、工具清单、错误码）全部由应用内的 `src/shared/mcpProtocol.ts` 实现。好处是——**工具清单和协议版本永远跟应用同步，升级应用不会出现"桥和协议对不上"**。

### 两个 mcp.json，别搞混

这是最容易踩坑的地方，有两个同名文件、职责完全不同：

| | 应用侧 `mcp.json` | 项目侧 `.mcp.json` |
|---|---|---|
| 位置 | `%APPDATA%\aiartengine\mcp.json` | **你运行 Claude Code 的项目根目录**（或其中的 `.claude/` 子目录），不是 ai-art-engine 仓库 |
| 属于谁 | AiArtEngine 应用 | Claude Code 的项目配置 |
| 内容 | 连接信息 `{ port, token, pid, version }` | 声明"如何启动 aiartengine 这个 MCP server" |
| 谁写 | 应用启动自动写、退出自动删 | 你手动写，可提交进 git 共享给团队 |
| 你要做 | **不要手改** | 可选，团队共享时有用 |

**为什么设计成两个文件？** token 和端口是动态的（重启可能变化），放应用侧由程序维护；`.mcp.json` 是静态声明，告诉 Claude Code"这个 server 用哪条命令/哪个地址拉起来"。桥（或直连）正是靠读应用侧的 `mcp.json` 才找到工具服务的。

**`.mcp.json` 需要手动创建吗？** 需要——**没有任何程序会自动生成它**，用法是新建一个名为 `.mcp.json` 的文本文件，填入下面的模板内容。但**大多数场景不用创建**：

- **单人使用**：直接执行 `claude mcp add aiartengine -- node <桥脚本实际路径>`，Claude Code 会自动写入本机配置（`~/.claude.json`），效果相同、无需建任何文件；
- **团队共享**：才值得手动创建 `.mcp.json` 并提交进 git，成员克隆项目即用。

两种方式二选一，无需同时做。

> 团队共享配置示例（`.mcp.json`，stdio 版，放在**你跑 claude 的项目根目录**，`args` 里的路径换成 ai-art-engine 桥脚本的实际位置）：
>
> ```json
> {
>   "mcpServers": {
>     "aiartengine": {
>       "command": "node",
>       "args": ["C:/path/to/ai-art-engine/scripts/mcp-bridge.mjs"]
>     }
>   }
> }
> ```
>
> HTTP 版（无需 Node.js，token 取自应用侧 mcp.json）：
>
> ```json
> {
>   "mcpServers": {
>     "aiartengine": {
>       "type": "http",
>       "url": "http://127.0.0.1:43110/mcp",
>       "headers": { "Authorization": "Bearer <应用侧 mcp.json 里的 token>" }
>     }
>   }
> }
> ```

### token 持久复用

应用侧 `mcp.json` 里的 token **跨重启保持不变**，所以配置一次就能长期用。要重置（比如怀疑泄露）：删除 `mcp.json` 后重启应用，会生成新 token。

---

## 可用工具清单

按用途分四组，按需查阅：

### ① 工程与资产（探索、读写你的工程）

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `project_list` | 最近工程路径列表 | 无 |
| `project_open` | 打开一个工程 | 应用运行中 |
| `project_create` | 新建工程 | 应用运行中 |
| `asset_list` | 列出当前工程的资产 | 已打开工程 |
| `asset_read_file` | 按相对路径读取工程内文本文件 | 已打开工程 |
| `asset_write_text` | 更新文本资产（剧本/备注），界面同步刷新 | 已打开工程 |
| `graph_edit` | 对节点图做编辑操作批（节点/连线，应用内校验类型与端口兼容性） | 已打开工程，且该图未在编辑器中打开 |

### ② 工作流：规划 → 落盘 → 运行

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `workflow_list_presets` | 行业模板列表（id + 标题） | 应用运行中 |
| `workflow_plan` | 自然语言 → 工作流方案预览（走应用已配置的文本模型，耗时可能数十秒） | 已打开工程 + 文本模型 |
| `workflow_commit` | 把方案落盘为宿主资产，界面同步出现 | 已打开工程 |
| `folder_list` | 列出资产库文件夹（generate_* 的 folderId 来源） | 已打开工程 |
| `graph_read` | 读取宿主资产图结构（节点 id / 类型 / 标题 + 连线），graph_edit 前置 | 已打开工程 |
| `task_run` | 运行已落盘的工作流（整图拓扑序执行，输出写回资产），返回 `mcpTaskId` | 已打开工程 + 应用界面运行 |
| `task_status` | 按 `mcpTaskId` 查运行状态（running / done / error / stopped） | 应用运行中 |

### ③ 内容生成（图片 / 视频 / 3D / 语音）

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `generate_image` | 文生图 / 图生图，落盘为工程资产 | 已打开工程 + 图片模型 |
| `generate_video` | 提交视频生成并登记资产（异步，用 `video_job_*` 跟踪） | 已打开工程 + 视频模型 |
| `generate_model3d` | 文生 3D / 图生 3D，产出 GLB 资产（异步） | 已打开工程 + 3D 模型 |
| `generate_speech` | 台词转 MP3 并导入为声音资产 | 已打开工程 + 音频模型 |
| `video_job_list` / `video_job_get` | 查询异步视频生成任务的状态 | 应用运行中 |

### ④ 环境查询

| 工具 | 作用 | 前置条件 |
|---|---|---|
| `app_status` | 版本、当前工程、资产数量 | 应用运行中 |
| `models_list` | 已启用的模型提供商与各模态勾选模型（**不含任何密钥**） | 无 |

---

## 安全设计

- 工具服务**只监听 `127.0.0.1`**（本机回环），外部机器无法访问。
- 除健康检查外，所有请求必须带 `Authorization: Bearer <token>`。
- 文件读写被限制在工程根目录内，无法越权访问其他路径。
- 密钥类信息（`models_list` 等）**不对外暴露**。
- 全部工具调用追加写入审计日志 `<userData>/logs/mcp-audit.jsonl`（时间 / 工具 / 参数摘要 / 耗时 / 结果，参数超 200 字符截断，单文件 5MB 滚动），可回查 Agent 触发的每次生成与写入。

---

## 当前限制

- **`task_run` 依赖应用界面进程**：请保持应用运行；同一张图重复触发会按「进行中任务」去重。
- **资产分类**：`generate_*` 与 `workflow_commit` 支持 `folderId`（资产库文件夹，`folder_list` 查询）与
  `outputDir`（工程内相对输出目录，缺省按类型 Assets/Generated/* 或 Cache/Videos）。
- **低频参数透传**：`generate_*` 工具支持 `extraParams` 对象，把底层生成输入的全部字段
  （如图片 `seed` / `quality`、视频 `resolution` / `lastFrameImageUrl`）合并进生成请求；
  显式传参优先于透传值，内部回写绑定字段（graphBinding）会被自动剥离。
- **并发闸门**：`generate_image` / `generate_speech` / `workflow_plan` 同时最多 3 个（可用环境变量 `AIAE_MCP_GEN_LIMIT` 调整），排队超限直接返回错误；`generate_video` / `generate_model3d` 提交即返回，不受闸门限制。
- **取消粒度**：客户端断开连接，或发送 `notifications/cancelled`，会中止进行中的长任务（如 `workflow_plan` 在两次模型调用之间）；单次模型调用内部不可中断。
- **状态报告有 TTL**：`task_status` 的成功/失败终态保留 10 分钟后自动清理，过期查询返回「未知任务 id」。
- **环境变量覆盖**：`AIAE_MCP_CONFIG` 指定应用侧 mcp.json 路径；`AIAE_MCP_PORT` + `AIAE_MCP_TOKEN` 直接指定端口与 token（优先于文件）。

---

## 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 报错「未找到 mcp.json」 | 应用没启动，或应用侧 mcp.json 被删 | 先启动 AiArtEngine；或用 `AIAE_MCP_CONFIG` 指定路径 |
| 返回 401「未授权」 | token 对不上（应用重启过换了？配置过期？） | 删除 mcp.json 重启应用拿新 token，重新注册 |
| 连不上 / ECONNREFUSED | 端口被占用，实际端口不是 43110 | 看应用侧 mcp.json 里的 `port`，换成实际端口 |
| 注册后工具不出现 | 注册后需新开会话 | 重启 Claude Code 会话 |
| 工具报错「请先打开工程」 | 对应工具需要已打开工程 | 先调用 `project_open` |
| 生成长任务卡住不动 | 模型调用耗时（`workflow_plan` 可数十秒） | 等待；超时想中断可断开连接或发 `notifications/cancelled` |
