# AIArtEngine Roadmap

## Unreleased（进行中）

- [ ] 剧本 → 集 → 幕 → 分镜树
- [ ] 参数继承与覆盖
- [ ] 批量生成
- [ ] 时间线高级剪辑（多轨特效 / 转场库等）

## 5.0.0（已发布）

- [x] 内置 MCP 工具服务：stdio 桥 / HTTP 直连，外部 Agent 驱动工作流规划、生成与工程操作
- [x] MCP 工具面：models_list / generate_image / generate_video / generate_model3d / generate_speech / graph_read / graph_edit / task_run / task_status / folder_list
- [x] AI 对话面板（DeepSeek Harness 运行时）：对话中 @ 引用资产并调用 MCP 工具
- [x] 任务容错模式：整图运行 / 任务队列节点失败降级（degraded）不整链中断
- [x] 媒体质检增强：专用质检模型 + 五维评分，返工接入备选模型链
- [x] 一键工作流新增行业模板：电商带货 / 游戏 3D 资产 / 漫画出版 / 知识口播 / 3D 白模预演
- [x] 导演台着色模式 / 线框模式
- [x] 官网重构：英文版 / 深色主题 / Diátaxis 文档体系 / MCP 教程页

## 4.1.0（已发布）

- [x] 3D 模型生成：Meshy / Tripo / Rodin（Hyper3D）/ Luma AI（文生 3D / 图生 3D，异步提交 → 轮询 → 下载）
- [x] 节点图「3D 模型生成」节点与导演台 3D 输入端口（dive 自动实例化）
- [x] ComfyUI 视频生成：r2v 多模态参考、首尾帧注入、模型列表动态拉取
- [x] 节点图「漫画页」「广告变体矩阵」；Agent 流水线质检 / 返工节点
- [x] 导演台 AI 白模几何体与透视落地、场景块遮罩与全景图视图
- [x] 图层分离导出 PSD（保留嵌套分组）

## 4.0.0-alpha.1（已发布）

- [x] 场选取节点输出单条文本，测试改为接到文本消费口
- [x] Cordis 插件运行时（编辑器 / 模型提供商 / 对象存储）与图执行器按域拆分
- [x] 端口类型严格相等（图 / 视频 / 声音 / 文本单数不能进复数）
- [x] 新增 OpenAI / DeepSeek / 智谱 / Kimi / xAI / Google / 本地 vLLM / Ollama / LM Studio 模型提供商

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
