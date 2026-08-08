# AIArtEngine Roadmap

## Unreleased（进行中）

- [x] 新增 OpenAI / DeepSeek / 智谱 / 本地 vLLM / Ollama / LM Studio 模型提供商
- [ ] 剧本 → 集 → 幕 → 分镜树
- [ ] 参数继承与覆盖
- [ ] 批量生成
- [ ] 时间线高级剪辑（多轨特效 / 转场库等）

## 2.0.0-alpha.0（已发布）

- [x] 成片时间线 MVP：素材分组、上轨拖动、预览选中 / 整轨联播、导出成片
- [x] 导演台站位与动作双分类；录制写入 `Cache/Videos`
- [x] 导演台编辑节点方形口 `out-shots` / `out-actions` 与 Inspector 预览
- [x] 目录端口专用类型 `world` / `beat` / `shots`
- [x] 生成类节点锁定；图库双输出口 `out` / `out-all`
- [x] 可灵 / MiniMax / 通义千问 / 魔塔模型提供商
- [x] 阿里云 OSS / 腾讯云 COS 对象存储（与火山 TOS 互斥启用）

## 1.0.1（已发布）

- [x] 电影化分镜 / 镜头调度预设与分镜表格体验
- [x] 多角度 / 打光预览初始化与透视球交互
- [x] 亮色主题与人像质感选中反馈修复
- [x] 官网手册、移动端适配与阿里云 OSS 镜像托管

## 1.0.0（已发布）

- [x] Electron + Vue3 + Pinia 工作台
- [x] 工程新建 / 打开 / 最近列表
- [x] 资产导入、浏览、旁挂 meta 与 `.aipackage`
- [x] 分镜栏 + 参数 / 构图
- [x] 节点图（生成、拆解、世界元素、场等）
- [x] OpenRouter / 火山方舟模型对接
- [x] 导演台（Three.js 站位与姿势）
- [x] dockview 布局、Undo / Redo、扩展清单
- [x] 应用内自动更新与多平台安装包
