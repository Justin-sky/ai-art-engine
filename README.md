<div align="center">

<a href="https://justin-sky.github.io/ai-art-engine/">
  <img src="docs/assets/banner.webp" alt="AI Art Engine" width="780" height="330" />
</a>

<h1>AI Art Engine</h1>

<p>
  <b>Agent 原生的 AI 游戏美术与影视生产力引擎</b><br />
  <sub>一句话操控全工作区 · 交付分层可编辑 PSD / Spine / 引擎代码 / 剪映草稿 · 强类型节点图 · 100% 本地优先</sub>
</p>

<p>
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/v/release/Justin-sky/ai-art-engine?include_prereleases&style=flat-square&labelColor=0d1117&color=5b8cff&label=release" alt="release" /></a>
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><img src="https://img.shields.io/github/downloads/Justin-sky/ai-art-engine/total?style=flat-square&labelColor=0d1117&color=8b5cf6" alt="downloads" /></a>
  <a href="https://github.com/Justin-sky/ai-art-engine/stargazers"><img src="https://img.shields.io/github/stars/Justin-sky/ai-art-engine?style=flat-square&labelColor=0d1117&color=f5b301" alt="stars" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-22d3ee?style=flat-square&labelColor=0d1117" alt="license" /></a>
  <img src="https://img.shields.io/badge/MCP-Native%20%2B%20Blender-10b981?style=flat-square&labelColor=0d1117" alt="MCP Native" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748b?style=flat-square&labelColor=0d1117" alt="platform" />
</p>

<p>
  <a href="https://justin-sky.github.io/ai-art-engine/"><b>🌐 官方网站</b></a> ·
  <a href="https://justin-sky.github.io/ai-art-engine/quickstart.html"><b>🚀 5 分钟上手</b></a> ·
  <a href="https://justin-sky.github.io/ai-art-engine/manual.html"><b>📖 完整手册</b></a> ·
  <a href="https://space.bilibili.com/3707036976024122"><b>🎬 视频教程</b></a> ·
  <a href="https://github.com/Justin-sky/ai-art-engine/releases"><b>⬇️ 下载安装包</b></a> ·
  <a href="./CHANGELOG.md"><b>📝 更新日志</b></a> ·
  <a href="./README.en.md"><b>English</b></a>
</p>

</div>

---

## 💡 为什么是 AI Art Engine？

市面上的 AI 工具大多困在两个极端：**要么是只能聊天的对话框**（生成一张无法拆改的扁平死图就结束），**要么是繁琐的节点迷宫**（上百个参数让创作者望而却步）。

**AI Art Engine 将「自然语言全局操控」与「工业级可编辑工程交付」合二为一**：你既可以用一句话指挥 AI 完成建图、修图、摆姿与剪辑，又能直接导出设计师和程序员立刻能用的 **分层 `.psd`、Spine 骨骼包、Unity/Godot 界面代码与剪映多轨草稿**。

---

## ✨ 四大核心亮点

### 1. 📦 不止生成图片，直接交付「工业级可编辑工程」

告别无法二次修改的“一锤子生成”，所有产物均可无缝进入专业研发与后期管线：

| 创作领域             | 传统 AI 工具产出       | **AI Art Engine 直接交付产物**                                                                                                                                                                                                      |
| :------------------- | :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🎮 游戏 UI 研发**  | 单张扁平 PNG 死图      | 识别 16 类标准控件，拆出**按钮文字（内置离线/在线 OCR，生成 Photoshop `TySh` 双击可改文本层）**、**无字修补九宫格底板**、**悬停/按下态**，直出 **二级嵌套 `.psd`** + **Unity (`.uxml/.uss`/UGUI) · Godot 4 (`.tscn`) · HTML5** 代码 |
| **🦴 2D 角色与动画** | 静态立绘或抖动视频     | 自动部位切分、父子骨骼绑定、IK 解算与动作关键帧烘焙，直出标准 **Spine 工程包（`skeleton.json` + `.atlas` + 透明图集）**                                                                                                             |
| **🎬 AI 短剧与漫剧** | 零散镜头视频           | 剧本拆解 → 导演审核 → `#变体` 角色定妆 → 批量拍片，直出 **MP4 成片** 与 **剪映专业版（JianyingPro / CapCut）可编辑多轨草稿**                                                                                                        |
| **🎥 3D 与可玩原型** | 无空间控制或纯文本代码 | **56 骨骼 3D 导演台 + 高斯泼溅实景预演 + Blender MCP 实时建模（直出 `.glb`）**；一句话编译零素材可玩 **HTML5 游戏 (`single.html`)**                                                                                                 |

### 2. 🗣️ 对话即全局工作台（Chat-Native & MCP-First）

- **所见皆可对话操控**：画布建图连线、下钻（Dive）子编辑器参数微调、3D 导演台演员走位与骨骼旋转、时间线智能粗剪——**所有手动能点的操作，在左侧 `◈ AI 对话` 里说一句话即可完成**。
- **双向 MCP 生态（含 Blender 直连）**：启动即在本机 `127.0.0.1` 开启 MCP 服务，**Claude Code、Codex、Cursor** 一行命令即可接管你的创作工程；内置零依赖 **Blender MCP 桥**，在对话中直接执行 `bpy` 建模、材质修改与视口截图自检。

### 3. 🧩 强类型多模态节点图 × 10+ 专业下钻（Dive）工作台

- **宏观编排，微观精修**：在画布上串联文本、图像、视频、语音、音乐、音效、3D、空间世界 8 大模态；双击任意专业节点即可无损 **Dive（下钻）** 进入全屏工作台（**合一影视工作台、UI 控件拆层台、10 合 1 图像工坊、人像精修台、3D 机位与球面打光、漫画分镜排版、3D 导演台**）。
- **PNG 即工作流（Drag-and-Drop Reproducibility）**：导出的 PNG 产物自动内嵌轻量工作流图谱元数据，把一张 PNG 拖回画布即可 100% 还原完整节点拓扑。

### 4. 🔒 100% 本地优先 & BYOK 零锁定

- **内置离线视觉与 OCR 算力**：开箱内置跨平台**系统级离线 OCR（Windows WinRT / macOS Vision，0 MB 额外包体积）**与本地 **ONNX 视觉引擎（YOLO 检测/分割/姿态、人脸 468 关键点、SAM 2.1）**，断网也能跑通 UI 控件拆层、智能抠图与人像分区精修。
- **30+ 模型自由切换，数据不出本机**：支持 DeepSeek、可灵、火山方舟、通义千问、OpenRouter、OpenAI、Gemini、Meshy、Tripo、World Labs 以及本地 **ComfyUI / Ollama / vLLM**。工程只是你硬盘上的普通文件夹（可读 JSON + 原始媒体），随时打包迁移。

---

## 💬 开口即所得：自然语言操控示例

无需记忆节点名或深层参数，在画布或任意下钻（Dive）视图中直接对 **◈ AI 对话** 说人话：

| 当前场景           | 你只需要对 AI 说…                                                      | 引擎自动完成的精准操作                                                                                                                                |
| :----------------- | :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI 控件拆层**    | 「把这张仙侠背包界面按标准控件拆成可编辑 PSD，顺便导出 Unity UI 代码」 | 识别 16 类 UI 控件 → 离线/在线 OCR 提取按钮与标题真字 → 2D 纹理修补无字底板 → 生成含 `TySh` 文本层与常态/悬停/按下态的二级嵌套 `.psd` 及 `.uxml/.uss` |
| **3D 导演台**      | 「把主光源调成暖橙色，让男主左大臂抬高 45 度并看向镜头，拍一张预演图」 | 自动定位当前 3D 舞台，更新光源色温与强度、旋转 `leftUpperArm` 骨骼、应用视线预设并抓拍构图回填分镜                                                    |
| **影视工作台**     | 「把第 2 镜音效改成雷雨声，林小满换成黑色机能风衣，只重拍这一镜」      | 精准定位第 2 镜与角色 `#变体` 设定，利用指纹缓存跳过未改动镜头，仅增量重拍目标镜头                                                                    |
| **人像精修与打光** | 「切换成伦勃朗光，水平角转到 45 度；磨皮调成强烈，加一点眼神光」       | 实时同步 3D 光位球角度，通过本地人脸关键点门禁局部更新磨皮与眼神光参数并重算生图提示词                                                                |
| **成片时间线**     | 「把口播里的停顿气口全部剪掉，铺好中文字幕，导出剪映草稿」             | 自动语音转写 → 静音波纹裁剪 → 生成字幕轨 → 导出 MP4 或剪映专业版可二次精剪草稿目录                                                                    |

---

## 🚀 3 分钟快速上手

### 1. 下载安装（开箱即用，无需配置环境）

前往 [**GitHub Releases**](https://github.com/Justin-sky/ai-art-engine/releases) 下载对应系统的安装包：

- **Windows**：`.exe` 安装包
- **macOS**：`.dmg`（Apple Silicon 选 `arm64`，Intel 选 `x64`）
- **Linux**：`.AppImage`

### 2. 零 Key 立即体验 / 接入你的模型

1. **零 Key 体验**：新建工程后打开左侧 **◈ AI 对话**，点击欢迎卡片上的 **「⚡ 零 Key 极速体验」**，无需配置任何 API Key 即可一键在画布上跑通完整的 UI 控件级拆层与可编辑 PSD 导出！
2. **接入模型**：打开 **设置 → 模型**，填入任一云端 API Key（或连接本机 ComfyUI / Ollama），即可在工作区「新建」中打开「一键工作流」模板库并解锁全模态生成。

👉 详见 [**5 分钟快速上手**](https://justin-sky.github.io/ai-art-engine/quickstart.html) · [**完整使用手册**](https://justin-sky.github.io/ai-art-engine/manual.html) · [**B 站视频教程**](https://space.bilibili.com/3707036976024122)。

---

## 🔌 一行命令接入 Claude Code / Codex / Blender

应用启动后自动在本机 `127.0.0.1` 开启 MCP 服务（支持 `Ask / Plan / Craft` 请求级权限门禁与操作审计）：

```bash
# 方式 A：stdio 桥接入 Claude Code
claude mcp add aiartengine -- node <安装目录或仓库路径>/scripts/mcp-bridge.mjs

# 方式 B：HTTP 直连（端口与 Token 见「设置 → MCP 工具服务」）
claude mcp add --transport http aiartengine http://127.0.0.1:43110/mcp \
  --header "Authorization: Bearer <token>"

# 可选：挂载内置 Blender MCP 建模端点
claude mcp add --transport http blender http://127.0.0.1:43110/mcp/blender \
  --header "Authorization: Bearer <token>"
```

---

## 🛠️ 从源码运行与扩展开发

环境要求：**Node.js 22+**

```bash
git clone https://github.com/Justin-sky/ai-art-engine.git
cd ai-art-engine
npm install
npm run dev     # 启动开发模式（热重载）
npm test        # 运行全量单元测试
npm run build   # 构建多平台生产安装包
```

- **核心技术文档**：[系统架构 (`ARCHITECTURE.md`)](./docs/ARCHITECTURE.md) · [MCP 协议与工具集 (`MCP.md`)](./docs/MCP.md) · [本地视觉与离线 OCR (`ARCH_YOLO_LOCAL.md`)](./docs/ARCH_YOLO_LOCAL.md) · [节点插件开发 (`GRAPH_PLUGINS.md`)](./docs/GRAPH_PLUGINS.md) · [技能市场规范 (`MARKETPLACE.md`)](./docs/MARKETPLACE.md)

---

## 🤝 社区与许可证

欢迎提交 Issue 与 Pull Request（参见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)）。GitHub 为主仓库，[Gitee](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine) 为国内同步镜像。

<a href="https://github.com/Justin-sky/ai-art-engine/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Justin-sky/ai-art-engine" alt="contributors" />
</a>

- **QQ 交流群**：`346340389` · `647306826` ｜ **视频教程**：[Bilibili @AIArtEngine](https://space.bilibili.com/3707036976024122) ｜ **X**：[@IoKKFOvWAt12669](https://x.com/IoKKFOvWAt12669) ｜ **邮箱**：[284139554@qq.com](mailto:284139554@qq.com)
- **开源许可**：[GPL-3.0](./LICENSE)
