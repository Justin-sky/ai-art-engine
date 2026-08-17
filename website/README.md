# AIArtEngine 官方主页

静态落地页，无需构建。仓库：https://github.com/Justin-sky/ai-art-engine

```bash
# 项目根目录：
npm run site
```

## 页面

| 路径 | 说明 |
|------|------|
| `index.html` | 官网首页 |
| `manual.html` | 使用手册（一键工作流、宿主资产、节点任务、成片时间线、导演台等） |
| `guide-short-video.html` | 短视频制作教程 |
| `guide-video.html` | 自由画布 · 视频与参考视频 |
| `guide-comfyui.html` | ComfyUI 接入教程（API 2、本机安装 comfy-api-proxy、API 格式 workflow） |
| `manual.css` | 手册页样式 |

## 资源目录

| 路径 | 说明 |
|------|------|
| `assets/logo-mark.png` | 品牌图标（页面使用图标 + 文字组合） |
| `assets/banner/node-graph.webp` | 节点图 |
| `assets/banner/storyboard.webp` | 分镜编辑 |
| `assets/banner/director-stage.webp` | 3D 导演台 |
| `assets/banner/multi-angle-editor.webp` | 多角度编辑器 |
| `assets/banner/lighting-editor.webp` | 打光效果编辑器 |
| `assets/banner/mood-editor.webp` | 情绪调节编辑器 |
| `assets/banner/image-editor.webp` | 图片修改器 |
| `assets/demo/demo.png` | 示例：节点连接（参考图 → 设定图 → 视频） |
| `assets/demo/video-output.mp4` | 示例：输出视频 |
| `assets/demo/video-poster.jpg` | 示例：视频封面帧 |
| `assets/qq-group.png` | QQ 交流群二维码（群号 647306826） |

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
