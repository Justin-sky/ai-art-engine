# AIArtEngine 官方主页

静态落地页，无需构建。仓库：https://github.com/Justin-sky/ai-art-engine

```bash
# 项目根目录：
npm run site
```

## 页面

| 路径 | 说明 |
|------|------|
| `index.html` | 官网首页（含按目标划分的三条入口路径） |
| `quickstart.html` | 快速上手：安装 → 接入模型 → 模板生成 → 出片，新手主入口 |
| `manual.html` | 使用手册概述页（§1–2 概述与核心概念 + 章节导航；旧的 `manual.html#锚点` 会自动跳转到对应子页） |
| `manual-setup.html` | 手册 §3–4 工程与设置 |
| `manual-workspace.html` | 手册 §5–6 工作区与资产库 |
| `manual-workflow.html` | 手册 §7–8 一键工作流与节点图 |
| `manual-production.html` | 手册 §9–12 剧本、成片与导演台 |
| `manual-reference.html` | 手册 §13–16 参考与故障排查 |
| `guide-short-video.html` | 短剧制作教程 |
| `guide-video.html` | 自由画布 · 视频与参考视频 |
| `guide-comfyui.html` | ComfyUI 接入教程（API 2、本机安装 comfy-api-proxy、API 格式 workflow） |
| `guide-newapi.html` | NewAPI 接入教程（内置 NewAPI 提供商、按网关端点元数据区分文本 / 图片模型、令牌分组注意事项） |
| `developers.html` | 技能市场开发者文档：发布工作流与技能包、Claude Code 技能规范支持与 GitHub 直装、脚本同意流与运行时审批、索引派生规则、交付链路 |
| `*.en.html` | 以上 8 个页面各有英文版（统一 `.en.html` 后缀） |
| `manual.css` | 手册与教程页样式（中英文共用） |
| `styles.css` | 首页样式（中英文共用） |
| `site.css` | 全站共享组件样式（搜索面板、复制按钮、目录分组、概念卡、排查折叠、路径卡） |
| `site-search.js` | 站内全文搜索（纯前端，Ctrl/Cmd+K 唤起，无需构建索引） |
| `site-enhance.js` | 代码块一键复制、外链安全属性补全；文档页的左侧文档树（宽屏三栏布局）、面包屑、阅读时长、编辑 / 反馈入口与上一篇 / 下一篇（新增文档页需加入脚本内的 `DOCS` 列表） |

### 文档体系

按 Diátaxis 四层组织，四种文档职责互不重叠：

| 层 | 落点 | 回答的问题 |
|----|------|-----------|
| Tutorial 教程 | `quickstart.html` | 带新手走完一遍，5 分钟出片 |
| How-to 操作指南 | 四个 `guide-*.html` | 怎么做某件具体的事 |
| Reference 参考 | `manual*.html` | 这个界面 / 组件是什么 |
| Explanation 解释 | 手册 §2 核心概念 | 这些术语到底指什么 |

面向**技能市场发布者**的 `developers.html` 不在这四层里 —— 它换了一个读者（写工作流与技能包的
作者，而不是用应用的创作者），所以单列。其正文源头是仓库 [`docs/MARKETPLACE.md`](../docs/MARKETPLACE.md)：
**改内容时两边都要改**（站点是手写静态页，没有 md → html 的构建步骤，这一点与中英两版同理）；
仓库那份是给贡献者就近查阅与随代码走查的，站点这份是给外部发布者看的。
应用内市场窗口右上角的「开发者文档」按钮指向站点这一页。

手册目录分四组：`入门`（概述、核心概念、快速上手）→ `基础`（工程、设置、工作区、资产库）
→ `核心能力`（一键工作流、节点图、剧本与场、时间线、画布、导演台）
→ `参考`（资产包、快捷键、故障排查、关于与更新），另有独立的 `专题教程` 组外链五个 guide 页。

新增内容时请对号入座：教人做事写 How-to，罗列界面写 Reference，解释术语写 Explanation，**不要混在一起**。

### 中英文页面

两套页面一一对应，通过导航栏右侧的 `中文` / `EN` 胶囊按钮互切（`.nav-lang`）。要点：

- 英文页内链全部指向 `.en.html`，中文页指向中文页，不会串语言。
- 每个页面都声明 `hreflang`  alternate 链接，便于搜索引擎识别。
- **内容是两份独立文件**，更新文案时请同步修改中英两版。
- 新增页面时记得同时建 `.en.html`，并在两侧导航加入语言入口。

开发文档在仓库 [`docs/`](../docs/README.md)（架构、节点图插件、资产模型）。用户手册 §7.1 已写明：端口类型必须相同，单数不能进复数。

## 资源目录

| 路径 | 说明 |
|------|------|
| `assets/logo-mark.png` | 品牌图标（页面使用图标 + 文字组合） |
| `assets/show.mp4` | 首页演示视频（首页 hero 视频）（CRF20 + AAC 96k 压缩，9.79MB → 3.3MB） |
| `assets/demo/video-output.mp4` | 示例：输出视频 |
| `assets/imgs/film-workbench.webp` | 短剧影视工作台（四阶段闭环、结构化分镜卡片、`@1`–`@4` 设定图引用与分段动态提示词） |
| `assets/imgs/script-camera.webp` | 3D 分镜白模预演与剧本运镜（角色/道具白模站位、Cinemachine 分镜机位切换轨与逐镜运镜轨） |
| `assets/imgs/ui-layers.webp` | 节点图工作流与 UI 图层拆解（同时用作社交分享 `og:image` 与视频封面帧） |
| `assets/imgs/video-timeline.webp` | 多轨视频与分镜时间线 |
| `assets/imgs/2d-director.webp` | 2D 分镜导演台（镜头构图与机位推演） |
| `assets/imgs/3d-director.webp` | 3D 导演台（三维机位、布光与骨骼摆拍） |
| `assets/imgs/comic-books.webp` | 条漫与多格漫分镜排版 |
| `assets/imgs/image-editor.webp` | 内置画布与图像精修编辑器 |
| `assets/imgs/model-provides.webp` | 多厂商云端模型与 API 网关配置 |
| `assets/imgs/local-models.webp` | 本机离线视觉模型管理（抠图 / 分割 / 修复 / 超分） |
| `assets/imgs/storage.webp` | 对象存储（OSS / S3 / R2 / COS）配置 |

社区入口在首页 `#community` 区块与根 README 页脚以文字列出（交流 QQ 群
`346340389` · `647306826`），不用二维码图片。

重新压缩截图（需已安装 `sharp`）：

```bash
node website/optimize-assets.mjs
```

浏览器打开提示的本地地址即可。

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
