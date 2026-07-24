# AIArtEngine 官方主页

静态落地页，无需构建。仓库：https://github.com/Justin-sky/ai-art-engine

```bash
# 项目根目录：
npm run site
```

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

重新压缩截图（需已安装 `sharp`）：

```bash
node website/optimize-assets.mjs
```

浏览器打开提示的本地地址即可。推荐部署到 **GitHub Pages** 或任意静态托管。
