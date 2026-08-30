# AI Art Engine 推广发布内容包

> 用法：各节内容均可直接复制到对应平台发布。发布前请先按 `7. 发布检查表` 逐项核对。

---

## 0. 通用信息速查（所有平台通用）

| 项目 | 内容 |
|---|---|
| 产品名 | AI Art Engine（AIArtEngine） |
| 中文标语 | 专业 AI 创作工具 · 短剧 · 广告 · 成片 |
| 一句话卖点 | 本地优先的 AI 创作工作站：资产、分镜、节点图在一个桌面端完成，内置 AI 对话 + MCP，可被 Claude Code 直接驱动 |
| 官网 | https://justin-sky.github.io/ai-art-engine/ |
| 使用手册 | https://justin-sky.github.io/ai-art-engine/manual.html |
| GitHub | https://github.com/Justin-sky/ai-art-engine |
| Gitee 镜像 | https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine |
| Releases | https://github.com/Justin-sky/ai-art-engine/releases |
| 视频教程（B站） | https://space.bilibili.com/3707036976024122 |
| 交流 | QQ 群 647306826 · 邮箱 284139554@qq.com |

核心亮点（写帖子时挑 2-3 个展开）：
1. **AI 对话 + MCP**：应用内聊天 `@` 引用资产直接生成；内置 MCP Server，Claude Code / Codex 可直连操作工程
2. **节点图驱动生成**：文本/图片/视频/声音/3D 节点，任务容错模式、媒体质检自动返工、漫画页、帧动画、图层分离导出 PSD
3. **30+ 模型提供商**：可灵 / ComfyUI / Meshy / Tripo / Rodin / Luma / Lux3D / 火山方舟 / MiniMax / 通义 / 本地 vLLM / Ollama 等，走你自己的 API Key
4. **本地优先**：工程、资产全部落盘本机，数据不出门

---

## 1. V2EX 发帖正文（节点：分享创造）

### 标题
```
[分享创造] 开源免费：本地优先的 AI 创作工作站 —— 节点图 + AI 对话 + MCP Server，Claude Code 可直接驱动，对接 30+ 模型（可灵/ComfyUI/Meshy/Lux3D…）
```

### 正文
```
做这个软件是因为做短剧/广告/成片时，生成素材要来回切换一堆网站和脚本：文生图一个站、图生视频一个站、3D 一个站、配音一个站，还要自己维护 prompt、整理素材、拼时间线，特别碎。

于是干脆做了个本地优先的桌面端，把这些事串在一个工程里：

**核心功能**
- 节点图驱动生成：文本 / 图片 / 视频 / 声音 / 3D 模型都是节点，连起来就是一个流水线。支持任务容错（节点失败降级不整链断）、媒体质检自动返工（五维评分，FAIL 自动注入原因重试）、漫画页（分镜格+台词气泡导出透明 PNG）、帧动画、图层分离导出 PSD
- 分镜与画布、一键工作流（短剧分镜 / 广告 / 游戏资产等预设）、成片时间线（画中画、转场、导出）
- 导演台：3D 站位截图、动作录制、AI 白模搭场景
- 资产库：图片/视频/声音/3D，AssetRef GUID，`.aipackage` 导入导出

**AI 对话 + MCP（我最想安利的部分）**
- 应用内 AI 助手：对话里 `@` 引用工程资产，Agent 直接调用 MCP 工具干活——生成、编辑节点图、跑工作流、查状态
- 内置 MCP Server：Claude Code / Codex 等外部 Agent 可以直连操作工程（stdio 或 HTTP），token 跨重启持久复用、操作审计、并发闸门

**30+ 模型提供商**：OpenRouter / OpenAI / DeepSeek / 智谱 / Kimi / xAI / Google / 本地 vLLM / Ollama / 火山方舟 / 可灵 / MiniMax / 通义千问 / ComfyUI / Meshy / Tripo / Rodin / Luma / Lux3D 等，全部走你自己的 API Key；还支持火山 TOS / 阿里云 OSS / 腾讯云 COS 对象存储。

**本地优先**：工程和媒体文件全在本地，数据不出门。

- 官网与手册：https://justin-sky.github.io/ai-art-engine/
- 下载：https://github.com/Justin-sky/ai-art-engine/releases （Win / macOS / Linux）
- GitHub（GPL-3.0）：https://github.com/Justin-sky/ai-art-engine
- 国内镜像 Gitee：https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine
- 视频教程：https://space.bilibili.com/3707036976024122

（图片区：放 3-4 张界面截图，节点图 + AI 对话面板 + 成片时间线；如果有 30s 演示视频更好）

任何建议 / Issue 欢迎提。QQ 群：647306826，有问题可以直接群里问。

首次发帖如有不妥请指正，谢谢。
```

### 发布要点
- 选节点「分享创造」，标题不要带「求 star」「求关注」等
- 发完前 1 小时多回复楼层互动，帖子热度会滚起来
- 图片先传到 sm.ms / 图床，V2EX 外链图片直接可用

---

## 2. Product Hunt（英文素材）

### 基础信息
- **Name**: AI Art Engine
- **Tagline**（≤60 字符）: `Local-first AI studio for short dramas & ads, MCP-powered`
- **Website**: https://justin-sky.github.io/ai-art-engine/
- **Links**: GitHub `https://github.com/Justin-sky/ai-art-engine` · Releases `https://github.com/Justin-sky/ai-art-engine/releases`

### Description（首段 + 详细介绍）
```
AI Art Engine is a local-first desktop studio for making short dramas, ads, and films. Assets, storyboards, and a node graph live in one app — projects stay on your disk, and generation runs through your own API keys.

What's inside:
- Node-graph generation: text, image, video, voice, and 3D model nodes wired into pipelines; fault-tolerant mode (a failed node degrades without breaking the chain), media QC with auto-rework (5-dimension scoring, FAIL triggers a cause-injected retry), comic pages, frame animation, and layer separation with PSD export
- One-click workflows: presets for short-drama storyboards, game UI/UA, product ads, e-commerce, game 3D assets, and more
- Storyboard & canvas, director's stage (3D pose shots, action recording, AI white-box scene setup), and an editing timeline with PiP and transitions
- AI chat + MCP: reference project assets with @ in an in-app conversation, or let external agents (Claude Code / Codex) drive your project over a built-in MCP server — stdio bridge or HTTP, stable tokens, audit log, concurrency gate
- 30+ model providers: Kling, ComfyUI, Meshy, Tripo, Rodin, Luma AI, Lux3D, Volcengine Ark, MiniMax, Qwen, local vLLM / Ollama, OpenRouter, and more — with your own API keys. Object storage: Volcano TOS, Aliyun OSS, Tencent COS

Open source (GPL-3.0), cross-platform (Win / macOS / Linux). Manual and tutorials included.
```

### 首图 / 截图建议
- 首图 1275×750：节点图全屏工作台（深色主题，效果最好），左上角放产品 logo
- 第二张：AI 对话面板演示（`@` 引用资产 + 生成结果）
- 第三张：一键工作流菜单 / 分镜
- 第四张：成片时间线
- 附 30-45s 演示 GIF 或视频（优先：AI 对话让 Agent 跑通"分镜→生成→成片"）

### 第一评论（First Comment，发布后立即自己发）
```
Hi Product Hunt! I built AI Art Engine because making short dramas and ads means juggling too many separate tools: image gen on one site, video on another, 3D somewhere else, voice-over elsewhere — plus keeping prompts, assets, and timelines in sync by hand.

So I made a local-first desktop studio where everything lives in one project:
- a node graph where text/image/video/voice/3D nodes form pipelines,
- an in-app AI assistant that can @-reference assets and call MCP tools to do the work,
- and a built-in MCP server so Claude Code / Codex can drive your project directly over stdio or HTTP.

It supports 30+ providers (Kling, ComfyUI, Meshy, Tripo, Rodin, Luma, Lux3D, OpenRouter, local vLLM/Ollama, ...) with your own API keys, and everything stays on your machine.

Happy to answer questions about the node engine, MCP integration, or provider support. If you make short-form content, I'd love to hear how this fits your workflow!
```

### 发布时间
- 美西时间（PDT）00:30 前后发布（= 北京/上海时间 15:30，上午发完图，晚间冲榜）
- 发布当天白天持续回复评论、拉朋友 upvote

---

## 3. 掘金技术文（可直接发布）

### 标题
```
我用 Electron 给 AI 创作工具加了一双"能干活的手"：内置 MCP Server 驱动本地节点图
```

### 正文
```
做 AI 创作工具（短剧/广告/成片方向）时，有个反复被问的问题：AI 到底是在"陪你聊天"，还是"帮你把活干了"？

我的答案是后者。这篇文章聊聊我怎么做了一台本地优先的桌面工作站 AI Art Engine，以及为什么最终选择用 **MCP** 把"AI 驱动生成"这件事打通。

## 一、架构选型

- Electron + Vue 3 + Pinia + TypeScript，electron-vite 构建
- 编辑器内核 Editor Kernel + Cordis 扩展体系（窗口 / Inspector / 节点 / Skill / 执行器），声明式外部插件清单
- Fabric.js 做画布构图，节点图引擎做生成流水线

本地优先意味着：工程（JSON）+ 媒体文件全部落盘本机，模型调用走用户自己的 API Key。这也让"数据不出门"成为卖点——对做商业素材的团队尤其重要。

## 二、为什么是 MCP，而不是自造协议

需求其实很简单：**让 Agent 能操作这个工程**——生成素材、编辑节点图、跑工作流、查状态。

如果自造一套 HTTP + JSON schema 协议，也能做，但代价是：Claude Code / Codex 这类 Agent 生态不会原生认识它，用户每次都要写自定义工具绑定。而 MCP 是 Agent 生态的事实标准：

- 应用内 AI 助手（DeepSeek Harness 运行时）直接作为 MCP client 驱动同一套工具
- 外部 Agent（Claude Code / Codex）经 stdio 桥或 HTTP 直连，zero-custom-code
- 工具即能力：generate_image / generate_video / generate_model3d / graph_* / workflow_* / asset_* 等

架构上是一个 MCP Server 同时服务"内部助手"和"外部 Agent"，工具定义只写一份。

## 三、踩过的坑

1. **工具调用超时**。`generate_model3d` / `generate_video` 是"提交后阻塞轮询到生成完成"的调用，Lux3D / 视频生成常需数分钟。MCP client 默认单次工具调用 60s 超时，Agent 会误以为提交失败而**重复提交**。解法：把工具调用超时与 HTTP 层长超时对齐到 120 分钟（`toolCallTimeoutMs` + `LONG_GENERATE_TIMEOUT_MS`）。

2. **单并发冲突**。Lux3D 单账号同时只能跑一个生成任务，Agent 并行发起时必撞车。我最初加了串行队列，但队列会把"非冲突失败"也串进去，反而拖慢。最终改成：识别并发冲突错误（code + 上游文案标记）后**指数退避自动重试**（10s → 20s → ... → 5min 封顶），非冲突错误立即抛出不重试。用"错误分类"替代"全局排队"，并发不被浪费。

3. **媒体质检自动返工**。生成失败不只看错误码——用专用质检模型做五维评分，FAIL 时把原因注入 prompt 自动重试，比裸抛错对用户友好得多。

## 四、节点图 + 容错模式

文本 / 图片 / 视频 / 声音 / 3D 模型都是节点，端口类型强约束（单数不能进复数，选取节点只收列表口）。任务队列会复用共同上游；开启**任务容错模式**后，节点失败降级而不整链中断。

## 五、一点思考

对桌面 AI 工具来说，"Agent 能驱动"可能比"内置一个助手"更重要——前者让工具接入整个 Agent 生态，后者只是单点。MCP 把这条路的成本降到了"实现一次协议"。

项目开源（GPL-3.0）：https://github.com/Justin-sky/ai-art-engine
官网：https://justin-sky.github.io/ai-art-engine/
```

---

## 4. B站视频脚本（3-5 分钟 · 成片向演示）

**标题**：用 AI 从零做一条广告片，全程本地不联网？（AI Art Engine 全流程）
**封面**：左边"传统流程 6 个软件"，右边"AI Art Engine 1 个软件"，中间大箭头

| 时间 | 画面 | 旁白 |
|---|---|---|
| 0:00-0:15 | 快剪：6 个软件来回切换的痛苦 | 做一条广告片要开几个软件？文生图、图生视频、3D、配音、剪辑……今天给你看一个全干完的 |
| 0:15-0:45 | 打开软件 → 新建工程 | 本地优先，工程和素材全在你自己硬盘上 |
| 0:45-1:30 | 一键工作流 → 选"产品广告" | 不用搭节点，AI 直接给你规划一条生成流水线 |
| 1:30-2:15 | AI 对话面板 `@` 引用资产 → 让它生成 | 在聊天里 @ 一下素材，Agent 直接调用 MCP 工具生成图片/视频 |
| 2:15-2:45 | 切 Claude Code 终端 → MCP 直连 | 不只内置助手，Claude Code 也能连进来驱动工程 |
| 2:45-3:30 | 节点图调整 → 成片时间线 | 不满意的地方在节点图上改参数，重跑；时间线里叠画中画、转场 |
| 3:30-4:00 | 导出成片 + 下载地址 | 全流程一条龙。开源免费，链接在简介 |
| 结尾 | 口播 | 30+ 模型提供商，走你自己的 API Key；QQ 群 647306826 交流 |

**发布要点**：简介放官网 + GitHub Releases + QQ 群；标题带"AI 生成""广告片""免费开源"关键词；投稿分区选「科技·软件教程」。

---

## 5. AI 导航站批量提交（一次性铺量）

统一简介（各站微调）：
> AI Art Engine — 本地优先的 AI 创作工作站：节点图驱动生成图片/视频/声音/3D，内置 AI 对话与 MCP Server（Claude Code/Codex 可直连），对接 30+ 模型提供商（可灵、ComfyUI、Meshy、Tripo、Lux3D 等），走自己的 API Key。开源 GPL-3.0，支持 Win/macOS/Linux。

| 站点 | 地址 | 分类建议 |
|---|---|---|
| AIbase | aibase.com（站内找"提交/Submit"） | AI 视频/图像/创意工具 |
| Toolify.ai | toolify.ai（Submit a tool） | Video Generator / 3D |
| TopAI.tools | topai.tools | AI Art / 3D Model |
| Woy.ai | woy.ai（站内提交） | 3D / Video |
| Futurepedia | futurepedia.io（Submit） | Video Generation |
| There's An AI For That | theresanaiforthat.com（Submit） | Video / 3D |
| FlowGPT | flowgpt.com | 创作工具 |
| 灵感岛 / 集智导航等国内导航 | 站内提交 | AIGC 创作 |

> 注意：以上站点提交入口入口位置可能调整，进站搜 "Submit" / "提交" 即可；部分站需要注册。

---

## 6. 发布节奏建议（一周版）

| 时间 | 动作 |
|---|---|
| Day 1 | V2EX「分享创造」发帖 + B站上传演示视频 |
| Day 2 | 批量提交 AI 导航站（10-20 个，半天完成） |
| Day 3 | 掘金发技术文 + 公众号/知乎同步 |
| Day 4-5 | 准备 PH 素材（截图、英文文案用第 2 节） |
| Day 6 | Product Hunt 美西 00:30 发布 + 白天互动；GitHub 同步打 Release tag 冲 Trending |

---

## 7. 发布检查表

- [ ] 官网可访问、下载链接有效（Win/mac/Linux 三包）
- [ ] 截图清晰无水印，统一暗色主题
- [ ] 各平台标题里都有「AI / 创作 / 免费开源」关键词
- [ ] 链接统一指向官网 / GitHub Releases，不散落
- [ ] QQ 群号 + 邮箱在各平台留一处即可，不刷屏
- [ ] 发布后 1 小时内回复所有评论（平台算法都吃互动）
