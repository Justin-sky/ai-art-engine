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
| `manual.html` | 使用手册（全组件操作说明） |
| `manual.css` | 手册页样式 |

## 资源目录

| 路径 | 说明 |
|------|------|
| `assets/logo.png` / `logo-mark.png` | 品牌标识 |
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
