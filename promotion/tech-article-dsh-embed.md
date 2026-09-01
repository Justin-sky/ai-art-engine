# DeepSeek Harness 开源一个月，我把它整个嵌进了 Electron 桌面软件

> 定位：掘金 / 知乎 / CSDN 技术深文。切入点 = DeepSeek Harness（dsh）刚开源，社区都在写"怎么用 dsh CLI"，而这篇讲的是**怎么把 dsh 当作运行时嵌入自己的产品**——这是全新的技术角度，蹭热点 + 有干货。
> 发布时把「配图位」换成真实截图，标题从下方候选里选一个。

---

## 候选标题

1. DeepSeek Harness 开源一个月，我把它整个嵌进了 Electron 桌面软件（主推，掘金/知乎用）
2. 不满足于命令行玩 Agent：我把 dsh 运行时打包进桌面应用，开箱即用
3. 当 AI 创作工具拥有"会干活的手"：DeepSeek Harness 内嵌实践与踩坑实录

---

## 正文

### 0. 先说结论

DeepSeek Harness（dsh）刚开源一个月，社区里最热的玩法是 `npx @deepseek-ai/dsh web` 打开一个网页版 Agent，或者把它当 Claude Code 的替代品在终端里用。

但我做的是另一件事：**把 dsh 整个 Agent 运行时塞进了一个 Electron 桌面应用（AI Art Engine）**，让它作为"大脑"住在软件里，通过内置的 MCP Server 直接调用软件自己的能力（出图、出视频、建 3D、跑工作流）。用户安装软件后开箱即用，不需要装 Node、不需要 npx、不需要任何命令行。

这篇文章不讲"dsh 是什么"这种科普（网上已经很多），而是讲清楚三件事：

1. **架构上怎么把 dsh 嵌进 Electron**——headless 子进程 + MCP 双向连接的完整链路；
2. **运行时怎么离线打包**——200MB 依赖树进安装包，用户零依赖；
3. **真正踩过的五个坑**——每个都花过真金白银的调试时间。

---

### 1. 背景：为什么是"内嵌运行时"，而不是"对接 Agent"

先交代产品背景。AI Art Engine 是一个本地优先的 AI 创作工作站：资产、分镜、节点图、成片时间线都在一个桌面工程里，生成走用户自己的 API Key，对接 30+ 模型提供商（可灵、ComfyUI、Meshy、Tripo、Lux3D、火山方舟、MiniMax 等）。

做这类工具，迟早要面对一个问题：**AI 到底是在陪你聊天，还是帮你把活干了？**

市面上有两类解法：

- **对接 Agent**：给 Claude Code / Codex 写 MCP Server，让外部 Agent 驱动你的工具。这我们做了（内置 MCP Server，Claude Code 可直连），但它的心智是"Agent 是主人，工具是被驱动的对象"——用户得先学会用外部 Agent，才能用上这个能力；
- **内嵌 Agent**：把 Agent 运行时直接打包进产品，产品里开一个对话面板，用户张嘴说需求，Agent 就地调用工具干活。心智是"软件自己会干活了"——**这是大多数普通用户更自然的交互**。

我选了后者。而当时市面上能"嵌入产品"的开源 Agent 运行时屈指可数，直到 dsh 出现：

- 它是 **MIT 协议**（不是非要套壳的 API），可以整体打包进商业/开源桌面应用再分发；
- 它基于 Cordis 内核、**"一切皆插件"**，模型适配、工具、skill、MCP client 都是插件——这意味着我可以不改它的源码，只靠**配置注入**就把自己的 MCP Server、模型、技能接进去；
- 它有 **headless profile**，`dsh --profile headless <task>` 起一个无 UI 的 Agent 进程，正好当子进程养。

于是就有了这套架构。

---

### 2. 架构：dsh headless 子进程 + MCP 双向连接

先看整体链路，这是理解全文的钥匙：

```
Chat 面板（渲染层）
   │  HARNESS_RUN（用户一句话）
   ▼
主进程：spawn dsh --profile headless <task>
   （dsh 运行体：安装包内置 resources/dsh，由 Electron 内置 Node 执行）
   │  dsh 内嵌 mcp-client 插件（streamable-http）
   ▼
GET/POST http://127.0.0.1:<port>/mcp  (Bearer token)
   ▼
应用内置 MCP Server（工具面：generate_image / generate_video /
  generate_model3d / graph_edit / task_run / asset_* ...）
   │  工具执行
   ▼
生成结果落盘到工程资产库
   ▲
dsh stdout/stderr 按行转发 → HARNESS_EVENT（assistant/status/tool/done）
```

几个关键设计决策：

**决策一：Agent 是子进程，不是库。**
虽然 `@deepseek-ai/dsh` 本身是可 require 的 npm 包，但直接把它 link 进 Electron 主进程风险太大——Agent 要跑 LLM 循环、加载 Cordis 插件、读写 session，任何一个未捕获异常都可能拖垮整个应用。子进程隔离：dsh 崩了，应用还活着，最多就是这条消息失败。

**决策二：连接用 MCP，而不是自定义 IPC。**
dsh 自带 `@deepseek-ai/dsh-mcp-client` 插件，天然认识 MCP Server。我们的 MCP Server 本来就要给 Claude Code / Codex 用（工具定义只写一份），内部 Agent 直接复用同一套。**一个 MCP Server，同时服务"内置助手"和"外部 Agent 生态"。**

配置注入的核心代码（主进程每次运行前写入 dsh 的 home 目录）：

```yaml
# cordis.patch.yml —— 注册 mcp-client 插件，指向本应用 MCP 工具服务
- insert:
  - id: mcp-studio
    name: '@deepseek-ai/dsh-mcp-client'
    config:
      serverName: studio
      transport: streamable-http
      url: http://127.0.0.1:<port>/mcp
      toolCallTimeoutMs: 7200000   # 见踩坑 #1
      headers:
        Authorization: !!js "`Bearer ${process.env.STUDIO_MCP_TOKEN}`"
```

这里有个 YAML 的坑值得记录：dsh 的 patch 文件用 `!!js` 标签让 Cordis loader 对配置做 JS 求值，**裸字符串不是合法 JS 表达式**，必须写成 `!!js "`Bearer ${...}`"`（JS 模板字符串包进 YAML 引号），token 才能从环境变量注入——token 不进命令行、不落盘。

**决策三：Agent 的工作区 = 当前打开的工程目录。**
dsh 是通用 Agent，它默认在任意目录都能跑。但我们希望它"在工程里干活"——`@` 引用的资产、生成结果的落盘、`graph_edit` 改的节点图，都在当前工程里。所以 spawn 时把 `cwd` 设为工程根目录，Agent 读写文件天然落在工程内。

---

### 3. 运行时离线打包：让 200MB 依赖树"住"进安装包

这是"普通用户可用"的最关键一环。dsh 是 npm CLI，依赖树有 **60+ 个子包**，如果让用户自己 `npx @deepseek-ai/dsh`，首次体验就是 1-2 分钟的联网下载——对桌面产品是致命的。

解法：构建时把 dsh 的完整依赖闭包打进安装包，作为 `extraResources` 分发，**用户安装即用、随应用升级、无需联网**。

打包脚本的核心思路（`scripts/bundle-dsh.mjs`）：

1. **BFS 收集依赖闭包**：从 `@deepseek-ai/dsh` 出发，沿 `dependencies` + `optionalDependencies` + `peerDependencies` 做 BFS，复用主项目 `node_modules` 里 npm 已经解析好的包，形成扁平、自包含的依赖树——不在干净环境重新 install（CI 上那要几分钟还会 OOM）；
2. **裁剪非运行文件**：剔除 sourcemap、`*.d.ts`、test/docs/examples 目录、Markdown、工具配置类点文件。效果：文件数 -55%（29899 → 13517）、体积 -36%（204.5MB → 130.6MB），安装包小了一圈，NSIS 逐文件解压也明显变快；
3. **两道校验兜底，防止"裁出事故"**：
   - *完整性校验*：产物里每个包声明的 dependencies / peerDependencies 必须存在；
   - *引用可达性校验*：扫描产物内所有 JS 的相对 `require` / `import`，对照源包区分"裁剪误删"和"可选引用"，**误删即中止构建**。

为什么校验这么严格？因为踩过坑：`yaml` 包的运行时代码放在 `dist/doc/directives.js` 这种"看似文档"的路径里，一刀切过滤目录名就会删掉运行文件——只过滤扩展名，`dist/` 内的路径一律不按目录名过滤，才躲过一劫。

dsh 的加载优先级（运行期）：

```
安装包内置 <resources>/dsh  →  工程本地 node_modules（开发模式）  →  npx 现场拉包（兜底）
```

而执行 dsh 的 Node 也内置了——Electron 44 自带 Node 24.x，用 `ELECTRON_RUN_AS_NODE=1` 环境变量让 Electron 二进制以纯 Node 模式运行 dsh，**用户系统里可以完全没有 Node**。

```ts
function resolveNodeCommand(): { command: string; env: NodeJS.ProcessEnv } {
  if (isNodeVersionOk(embeddedNodeVersion())) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { command: 'node', env: {} }  // 仅在内置版本不满足时回退系统 node
}
```

---

### 4. 三个"注入"：模型、技能、会话，全都不动 dsh 源码

**注入一：模型。** dsh 默认读 `settings.yaml` 里的 `agent-default-model`，不读 `DSH_MODEL` 环境变量。如果用户在面板里选了别的模型，而 dsh 还回落到默认的 `deepseek-v4-flash`，在多数 OpenAI 兼容端点上就是 `HTTP_404`。解法：每次运行前，把面板选中的模型 + 端点写进 dsh 的 settings，API Key 经 `DEEPSEEK_API_KEY` 环境变量透传。

```yaml
# settings.yaml（每次任务前生成）
agent-default-model:
  provider: deepseek-official
  model: "<面板选中的模型 id>"
llm-deepseek:
  baseURL: "<面板选中的端点，OpenAI 兼容>"
```

**注入二：技能。** dsh 的 `skill-filesystem` 插件会扫描 `$DSH_HOME/skills` 下的 `*.md`（SKILL.md 格式，frontmatter + 正文）作为 Agent 的职业手册。我们把应用内置的创作技能（分镜 / 9 宫格分镜表 / 节拍拆解 / 导演审核 / 图生提示词……）快照成 SKILL.md 写进去，Agent 对话时按需加载——**一个懂美术、会走专业流程的 Agent 就诞生了**。快照带指纹，没变化就不重写，省 IO。

```ts
// GraphSkill → dsh SKILL.md 的 name（kebab-case，dsh 校验格式）
function toDshSkillName(id: string): string {
  const kebab = id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return kebab
}
```

**注入三：会话。** 多轮对话如果靠"把历史文本拼进 prompt"，模型读到的是拼接垃圾，工具调用历史全丢。dsh 有**原生持久化 session**（JSONL，含工具调用记录、支持崩溃恢复）。我们把 ChatSession.id 传给 runner：`有则 resume、无则 create`——多轮对话是真实消息序列，删会话时同步清掉磁盘 JSONL，防止"幽灵恢复"。

```ts
const exists = (await persistence.list()).some((h) => h.id === sessionId)
if (exists) {
  const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
  agent = resumed.agent
}
```

---

### 5. 自定义 runner：流式输出、工具卡、提问弹窗

dsh 自带的 headless-runner 只会"跑完打印最终结果"，这对一个产品级对话面板是不够的。我们写了一个自定义 runner（ESM 模板，从 dsh 内部包导入 `@deepseek-ai/dsh-agent` / `@deepseek-ai/dsh-session` / `@deepseek-ai/dsh-tools`），通过 stdout 的 marker 协议把内部事件流式转发给主进程，再广播到渲染层：

| Marker | 作用 |
|--------|------|
| `===BEGIN_REASONING=== / END` | 思考过程折叠展示 |
| `===BEGIN_TOOL=== / END` | 工具调用实时进度卡片（正在调用哪个能力、进度如何） |
| `===BEGIN_CONTEXT===` | 上下文用量上报 → UI 显示真实 inputTokens 环形进度 |
| `===BEGIN_ASK_USER===` | Agent 提问 → 渲染层弹窗选择 → 主进程写 answerFile → runner 轮询返回 |

其中"提问"这一环在 headless 下尤其麻烦：Agent 中途需要确认（"用可灵还是用 MiniMax？"）时，headless profile 没有 UI provider，我们就自己注册 `ask_user_question` 工具 + 一个 UI provider，把问题经 marker 转发出去，用户选完再喂回给 Agent——**Agent 从"闷头干"变成"会先问"**。甚至还有一个 Plan 模式：Agent 先给计划、问用户确认、才允许动工具。

---

### 6. 踩坑实录：五个真实事故

#### 坑 1：MCP 工具调用超时 60s，长任务被误判失败重复提交

`generate_model3d` / `generate_video` 是"提交后阻塞轮询到生成完成"，Lux3D、视频生成动辄几分钟。dsh 的 mcp-client 默认单次工具调用超时 **60s**——Agent 以为提交失败了，于是**重复提交**，你被扣了两次钱还一脸懵。

解法：把 `toolCallTimeoutMs` 对齐到 120 分钟（和 HTTP 层 `LONG_GENERATE_TIMEOUT_MS` 一致）。短任务正常返回，长任务不再误判。

#### 坑 2：headless 启动也会创建 HMR 插件，内置 Node 直接崩

dsh 0.1.1-rc.2 的 headless 启动会无条件创建 `cordis-plugin-hmr`，它要求 loader 能访问 Node 内部模块，否则抛 `--expose-internals is required for HMR service`。我们的内置 Node（Electron 44 / Node 24）默认没暴露。解法：spawn 时给 Node 注入 `--expose-internals` flag。就一行，但查了俩小时。

#### 坑 3：electron-builder 26 的 copyDir 会"吃掉" node_modules

`extraResources` 复制源如果是 `out/dsh-bundle` 这种**包含 node_modules 的目录**，electron-builder 26 的过滤逻辑会把复制源根目录下的 `node_modules` 丢弃——你辛苦打包的 dsh 在安装包里只剩一个 package.json，用户首启默默走 npx 下载（1-2 分钟）。

解法：复制源直接指向 `node_modules` 目录本身（根即目录），绕过过滤缺陷。

#### 坑 4：模型 404 与"我明明选了模型，它不用"

见第 4 节"注入一"。根因是 dsh 的模型选择不读 `DSH_MODEL` 环境变量，只认 `settings.yaml` 的 `agent-default-model`。**每次任务前覆盖 settings，而不是相信环境变量**——这是 dsh 开发者预览期 API 快速迭代的真实写照。

#### 坑 5：zip 解压方案产生的 200MB 孤儿垃圾

早期版本把 dsh 压成 zip、首启解压到 userData——升级会破坏运行体文件权限、解压要等几秒、旧版解压结果在新版变更后成为 200MB 孤儿垃圾。后来回退为 **`resources/dsh` 目录直接进包**：安装即用、随应用升级、权限继承安装目录；旧解压遗留由新版本首次启动时后台自动清理。

> 小结：dsh 还是开发者预览版（v0.1），API 迭代快，文档少。但正因为它是插件化架构，这些坑大多能用"配置注入"绕过去，不需要 fork 源码——这是它适合内嵌的底层原因。

---

### 7. 落地效果：一句话驱动整条创作流水线

有了这套东西，用户的实际体验是：

> 「@参考图 用可灵把这张主视觉做成 15 秒产品广告，写实风格，素材丢进时间线」

Agent 的旅程：引用资产 → 调用 `generate_image`/`generate_video` → 生成结果落盘工程资产库 → 用户直接拖上成片时间线。全程一个窗口，没有复制提示词、没有切网站。

而在技术侧，同一个 MCP Server 还被 Claude Code / Codex 通过 stdio 桥 / HTTP 直连——**应用内助手和外部 Agent 生态共用一套工具面**，这是"桌面软件被 Agent 化"的一种落地形态。

---

### 8. 一点思考

这一轮 Agent 开源潮里，我最深的感受是：**"Agent 能驱动"正在从加分项变成桌面软件的必备项**。但"能被 Claude Code 驱动"和"自己就是一个 Agent 宿主"是两种产品。前者接入了生态，后者定义了产品形态——用户面对的不再是一个按钮，而是一个会调用工具的同事。

dsh 这类 MIT 协议的 Agent 运行时，把"内嵌 Agent"的成本从"自研一个运行时"降到了"写一个 headless 子进程 + 一套 MCP 工具面"。对做创作工具、垂直软件、桌面应用的团队，这条路值得认真看。

项目开源（GPL-3.0），Win / macOS / Linux 三端安装包：

- GitHub：https://github.com/Justin-sky/ai-art-engine
- 官网与手册：https://justin-sky.github.io/ai-art-engine/
- 下载：https://github.com/Justin-sky/ai-art-engine/releases
- 国内镜像 Gitee：https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine
- 交流：QQ 群 647306826

如果你也在做 Agent 相关工具，或者被"6 个 AI 网站来回切"折磨，欢迎来提 issue / 提 PR，或者进来聊聊。

**配图位 1**：AI 对话面板——`@` 引用资产 + 工具调用进度卡片（思考过程折叠展示）
**配图位 2**：dsh 运行体在安装包中的目录结构 / `cordis.patch.yml` 配置截图
**配图位 3**：节点图全屏工作台（展示工具执行落盘的资产）
**配图位 4**：成片时间线（Agent 生成的素材直接上轨）

---

## 发布提示

- **掘金**：标题用第 1 个；分类「前端」/「全栈」，标签 `Electron`、`DeepSeek`、`Agent`、`MCP`、`开源`。掘金吃"技术深挖 + 踩坑"内容，正文保留完整。
- **知乎**：正文结尾补一句"利益相关：作者本人"；把标题里的"踩坑实录"前置到副标题增强点击。
- **CSDN / 博客园**：副标题强调"DeepSeek Harness + Electron 集成实战"，便于 SEO（`dsh`、`DeepSeek Harness`、`Electron`、`MCP` 都是热搜词）。
- **公众号**：可拆成上下篇（架构篇 / 踩坑篇），引流到 GitHub。
- 发布后 1 小时内回复所有评论，平台算法都吃互动。
