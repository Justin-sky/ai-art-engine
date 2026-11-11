# AI Art Engine 官方主页（v8.9.1）

纯静态中英双语官网与文档站，无需构建步骤。仓库：https://github.com/Justin-sky/ai-art-engine

```bash
# 项目根目录启动本地预览：
npm run site
```

## 页面与站点文件（共 30 个 HTML 页面）

全站由 **15 个中文页面 + 15 个对应的 `.en.html` 英文页面（合计 30 个 HTML 页面）**，以及面向搜索引擎与大模型的发现文件组成：

| 路径 | 说明 |
|------|------|
| `index.html` / `index.en.html` | 官网首页（核心工作台总览、配方展示与下载入口） |
| `quickstart.html` / `quickstart.en.html` | 快速上手：`◈ AI 对话` 零 Key 极速体验 → 接入模型 → 多项目工作区 → 一键工作流 / `aiae:graph` PNG 配方拖入 → 出片 |
| `manual.html` / `manual.en.html` | 使用手册总览页（§1–2 概述与核心概念 + 五卷章节卡片；历史 `manual(.en).html#锚点` 自动重定向到对应子页） |
| `manual-setup.html` / `manual-setup.en.html` | 手册第 1 卷（§3–4）：多项目工作区（`workspace.json` + `project.json`）、云端/本地模型、对象存储、离线视觉、102 工具 MCP 与联网搜索 |
| `manual-workspace.html` / `manual-workspace.en.html` | 手册第 2 卷（§5–6）：工作区、AI 对话多项目侧栏与内嵌编辑器、技能市场、24h 定时任务、祈愿巫女与程序化天气、资产库 |
| `manual-workflow.html` / `manual-workflow.en.html` | 手册第 3 卷（§7–8）：一键工作流与 `aiae:graph` PNG 即工作流、UI 拆层（原生 `TySh` PSD）与 `ui.atlasCompose`、Machinations v2（120fps Goal-Seek）、`rea-video` 爆款视频复刻与 `script.run` |
| `manual-production.html` / `manual-production.en.html` | 手册第 4 卷（§9–12）：21 类题材五阶段影视工作台、6 页签剪映级 NLE 时间线（剪映草稿导出）、2D 舞台（YOLOv8-Pose + Spine 导出）、4 频段小波人像精修与 56 骨 3D 导演台 |
| `manual-reference.html` / `manual-reference.en.html` | 手册第 5 卷（§13–16）：工作区目录结构、`.aipackage` 资产包、完整快捷键表、高频故障排查与版本更新 |
| `guide-short-video.html` / `guide-short-video.en.html` | 短剧 / AI 漫剧教程：21 种题材五阶段影视工作台全流程实战 |
| `guide-video.html` / `guide-video.en.html` | 自由画布 · 视频生成、`rea-video` 拆解复刻与参考视频教程 |
| `guide-comfyui.html` / `guide-comfyui.en.html` | ComfyUI 接入教程（API v2、本机 `comfy-api-proxy` 与 API 格式 workflow） |
| `guide-newapi.html` / `guide-newapi.en.html` | NewAPI 自建中转网关接入教程（端点元数据识别与令牌分组注意事项） |
| `guide-mcp.html` / `guide-mcp.en.html` | MCP 接入教程（Claude Code / Cursor / Codex 接入 `/mcp` 93 工具 + `/mcp/blender` 9 工具，合计 102 工具） |
| `guide-gameplay.html` / `guide-gameplay.en.html` | 可玩 HTML 与 Machinations v2 玩法/经济原型教程 |
| `developers.html` / `developers.en.html` | 技能市场开发者文档：发布工作流与技能包、Claude Code 技能规范支持、GitHub 直装、运行时脚本审批与索引派生规则 |

### 搜索、AI 发现与前端脚本/样式文件

| 路径 | 说明 |
|------|------|
| `sitemap.xml` | 覆盖全部 30 个中英文页面的 XML 站点地图（含 `xhtml:link` 多语言互指） |
| `robots.txt` | 搜索引擎与主流 AI 检索爬虫抓取放行规则及 `Sitemap` 声明 |
| `llms.txt` | 面向 LLM / AI Agent 的精简站点导航与能力索引（遵循 llms.txt 规范） |
| `llms-full.txt` | 面向 LLM / AI Agent 的 AI Art Engine v8.9.1 全量技术架构、节点与 MCP 工具参考 |
| `manifest.webmanifest` | Web App Manifest 站点清单（应用名称、主题色与图标元数据） |
| `manual.css` | 手册与专题教程页样式（中英文共用） |
| `styles.css` | 首页样式（中英文共用） |
| `site.css` | 全站共享组件样式（搜索面板、复制按钮、目录分组、概念卡、排查折叠、路径卡） |
| `site-search.js` | 站内全文搜索（纯前端，`Ctrl/Cmd+K` 唤起，自动按 `section[id]` 建立章节索引） |
| `site-enhance.js` | 代码块一键复制、外链安全属性补全；宽屏三栏文档树、面包屑、阅读时长与上一篇 / 下一篇（新增文档页需同步更新脚本内 `DOCS` 列表） |

### 文档体系

按 Diátaxis 四层组织，四种文档职责互不重叠：

| 层 | 落点 | 回答的问题 |
|----|------|-----------|
| Tutorial 教程 | `quickstart(.en).html` | 带新手走完一遍，零 Key 体验或 5 分钟出片 |
| How-to 操作指南 | 六个 `guide-*(.en).html` | 怎么做某件具体的事 |
| Reference 参考 | `manual*(.en).html` | 这个界面 / 节点 / 参数是什么 |
| Explanation 解释 | `manual(.en).html#concepts` | 这些核心术语与架构到底指什么 |

面向**技能市场发布者**的 `developers(.en).html` 读者是工作流与技能包作者，其正文源头是仓库 [`docs/MARKETPLACE.md`](../docs/MARKETPLACE.md)：**改内容时两边都要同步更新**（站点是手写静态页，无 md → html 构建步骤）。应用内技能市场窗口右上角的「开发者文档」按钮指向站点这一页。

### 中英文页面与 SEO 约定

两套页面一一对应，通过导航栏右侧的 `中文` / `EN` 胶囊按钮互切（`.nav-lang`）。维护要点：

- 英文页内链全部指向 `.en.html`，中文页指向 `.html`，切勿串语言。
- 每个页面均声明 `canonical`、`hreflang="zh-CN"`、`hreflang="en"` 与 `hreflang="x-default"`（统一指向中文 `.html` URL），并配备完整 OpenGraph / Twitter Card 与有效 `<script type="application/ld+json">` 结构化数据。
- **中英文是两份独立文件**，更新文案、节点名称或版本号时请同步修改两版，并同步检查 `sitemap.xml`、`llms.txt` 与 `llms-full.txt`。

开发文档在仓库 [`docs/`](../docs/README.md)（架构、节点图插件、资产模型）。用户手册 §8.1（`manual-workflow.html#graph`）已写明：端口类型必须匹配，单数不能直接进复数，`spatialWorld` 必须经 `spatialWorld.export` 转换。

## 资源目录与 `optimize-assets.mjs` 规则

| 路径 | 说明 |
|------|------|
| `assets/logo-mark.png` | 品牌图标（`optimize-assets.mjs` 保持 PNG 透明锐利边缘，最大宽度 256px） |
| `assets/wish-maiden.png` | 工作区画布角落交互式看板娘「祈愿巫女」透明立绘（位于 `assets/` 根目录且非 `logo*`，脚本保持原样不转 WebP） |
| `assets/show.mp4` | 首页演示视频（CRF20 + AAC 96k 压缩） |
| `assets/demo/video-output.mp4` | 示例输出视频 |
| `assets/recipe/recipe1..3.(png\|gif\|mp4)` | 官方 `aiae:graph` PNG 即工作流配方卡（PNG `iTXt` 块内嵌完整节点图拓扑，拖入画布即还原）及配套预览动图/视频 |
| `assets/imgs/film-workbench.webp` | 五阶段 21 类型 AI 漫剧/短剧影视工作台（`film.workbench`） |
| `assets/imgs/script-camera.webp` | 3D 分镜白模预演与剧本 Cinemachine 运镜轨 |
| `assets/imgs/ui-layers.webp` | 游戏 UI 图层拆分工作台（3D 爆炸视图、二级分组树与原生 `TySh` PSD 导出；兼作默认 `og:image`） |
| `assets/imgs/video-timeline.webp` | 6 页签剪映级 NLE 成片时间线（120+ 特效、DOTween 关键帧与剪映草稿导出） |
| `assets/imgs/2d-director.webp` | 2D 舞台导演台（YOLOv8-Pose AI 骨骼对齐、IK 牵引与 Spine 2D 导出） |
| `assets/imgs/3d-director.webp` | 3D 导演台（56 骨人形骨架、Cinemachine 切镜轨与离屏 `.webm` 轨迹录制） |
| `assets/imgs/comic-books.webp` | 多页漫画排版 Dive 工作台（斜切分镜、集中线、对白气泡与拟声词） |
| `assets/imgs/image-editor.webp` | 10 合 1 图像处理工作台（本地抠图、边缘精修与 AI 重绘/扩图/超分） |
| `assets/imgs/model-provides.webp` | 多厂商云端模型与 API 网关配置 |
| `assets/imgs/local-models.webp` | 本机离线视觉模型管理（抠图 / 分割 / 修复 / 姿态 / OCR） |
| `assets/imgs/storage.webp` | 对象存储（TOS / OSS / COS / Amazon S3 兼容）配置 |

社区入口在首页 `#community` 区块与根 README 页脚以文字列出（交流 QQ 群 `346340389` · `647306826`），不用二维码图片。

### 截图与图标压缩规则（`optimize-assets.mjs`）

需已安装 `sharp`：

```bash
node website/optimize-assets.mjs
```

`website/optimize-assets.mjs` 的处理边界：

1. **品牌图标（`assets/logo*.{png,jpg,jpeg,webp}`）**：保持 **PNG（compressionLevel 9）** 以保留透明通道与锐利边缘（`logo-mark*` 最大宽 256px，其余 `logo*` 最大宽 720px）。
2. **`assets/` 下非 `logo*` 根文件与子目录（如 `assets/wish-maiden.png`、`assets/recipe/*.png`）**：**完全跳过不改写**——确保 `wish-maiden.png` 原图与 `assets/recipe/` 配方 PNG 内嵌的 `aiae:graph` `iTXt` 元数据块绝不被重编码剥离。
3. **功能界面截图（`assets/imgs/*.{png,jpg,jpeg,webp}`）**：统一缩放（最大宽 1600px，不放大）并编码为 **WebP（quality 82, alphaQuality 90）**，源 `.png`/`.jpg` 转换后自动清理。

## 部署（GitHub Pages）

仓库已配置 Actions：`.github/workflows/deploy-website.yml`。

1. Settings → Pages → Source 选 **GitHub Actions**
2. 推送到 `main`（或手动跑该 workflow）后自动发布
3. 地址：https://justin-sky.github.io/ai-art-engine/

## 部署（阿里云 OSS · 国内推荐）

```bash
# 1. 复制并填写密钥 / 桶信息（local 文件已 gitignore）
cp oss-website.example.json oss-website.local.json

# 2. 项目根目录上传 website/
npm run site:deploy
```

建议在 OSS 控制台：

1. 桶读写权限设为**公共读**
2. 基础设置 → 静态页面 → 默认首页 `index.html`（脚本也会尝试自动配置）
3. 绑定**自定义域名**或 CDN（国内需 ICP 备案），并在 `oss-website.local.json` 填写 `publicBaseUrl`

也可用环境变量：`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_BUCKET`、`OSS_REGION`、`OSS_ENDPOINT`、`OSS_PUBLIC_BASE_URL`。
