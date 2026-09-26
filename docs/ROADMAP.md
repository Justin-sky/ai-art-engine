# AIArtEngine Roadmap

## Unreleased（进行中）

- [x] 3D 模型加工节点补齐：**3D 骨骼蒙皮**（Meshy / Tripo Rigging API，可选骨架命名与 GLB / FBX 输出）、**绑骨检查**、**动画重定向**（Tripo 预设 / Meshy 动作库选择器）、**模型拆分**（网格 / 智能分割）、**部件补全**、**重拓扑**、**贴图**、**格式转换**；生成节点回归「只出几何 GLB」
- [x] 3D 网格加工分层重构：能力矩阵（`shared/meshOps.ts`）+ 供应商方言（`tripo/meshOps.ts` / `meshy/meshOps.ts`）+ 与供应商无关的编排层；卡片下拉、facade 门禁、参数显隐全部由能力位派生
- [x] 轮询 token 去品牌化（`<providerKind>-<jobOp>::<taskId>`）并兼容 9 条历史前缀，在途任务续跑不受影响
- [ ] Meshy 次要开关（`hd_texture` / `enable_original_uv` / 动作合并 `post_process`）与 Tripo `refine` / `import` 视需求再评估

## 战略路线 V7–V9（AI 创作操作系统）

> 定位升级：从「用户 → AI 助手 → 节点图 → 模型 → 素材」升级为「导演 → AI Producer → 角色 Agent 团队 → Workflow Compiler → 节点图执行 → 结构化工程交付」。
> 节点图仍是执行层（bytecode）；Compiler / Agent 是编排层；用户当导演。
> 三大突破点优先贯穿 V7–V8：**AI Director Agent**、**Character Consistency Engine**、**AI Blender / 动画系统**。
> 下方条目为战略 checklist，与上方 5.x / P1 / P2 交叉推进；已有底座（episode 流水线、`workflow_plan`、导演台、Rig API、gameSystem / stage2d、stylePresets、Cordis / Skills）必须复用，禁止另起炉灶。

### 三大突破点

- [ ] **A. AI Director Agent（价值 ★★★★★ / 难度中）**
  - [ ] Producer 编排器：自然语言意图 + 工程记忆 → `ProductionPlan`（角色 Agent 列表、依赖、交付物）；可选 `ask_user` 确认
  - [ ] 角色 Agent 技能包：Script / Concept / Character / Camera / Animator / Editor / QA（dsh skill / graphSkills；白名单 MCP / 图节点；产出写回约定目录）
  - [ ] 项目交付目录规范：`project/{script,storyboard,characters,shots,assets,timeline,reviews}/` + `final.*`；Dive「项目总览」
  - [ ] 与现有合流：短剧继续 episode.review 链；广告 / 影视用 ProductionPlan 物化为 graph + Dive
  - [ ] **闭环**：QA Agent FAIL 必须能驱动 Producer / Compiler 局部改 Plan 或重跑，不得停在「只出报告」
  - > V7 先做单 Producer + 3–5 角色 Agent + 落盘目录 + 至少一轮自动返工；并行 Agent / 消息总线放 V7.x。

- [ ] **B. Character Consistency Engine（价值 ★★★★★ / 难度中）**
  - [ ] Character Bible 资产类型：Identity（face / body / voice embedding，v1 可先参考图集）、Attributes、Relations
  - [ ] 生成时强制注入：扩展 `characterConsistency` / `characterRefs`——命中角色名 → `input_references` + prompt 锁
  - [ ] World 实体 ↔ Bible 双向同步；一致性 QA 节点（VLM / embedding）→ FAIL 返工（对齐 media.review）
  - [ ] **闭环**：一致性 FAIL → 强制带参考重抽 / 重跑，结果回写 Bible 使用记录
  - > V7：Bible + 参考图注入 + 返工接线；V7.1：embedding 与自动 QA。

- [ ] **C. AI Blender / 动画系统（价值 ★★★★★ / 难度高）**
  - [ ] AI Rigging 产品化：统一入口（上传 / 生成 → 检测 → 绑骨 → 权重 → 动作库匹配 → `.glb` / `.fbx`；`.blend` 可选经 Blender MCP）；承接现有 Meshy / Tripo Rig + 导演台骨骼预览
  - [ ] AI Motion Library：walk / run / fight / dance… + 情绪标签；NL → `{ emotion, motion, camera }` → 导演台挂轨（承接 P1 MoMask）
  - [ ] 一句话 Stage Compile：角色 / 服装 / 骨骼 / 动作 / 机位 / 灯 / 录屏或渲染
  - [ ] 与「单 HTML 可玩沙盒」分流：影视预演走导演台；轻量可玩原型走 HTML iframe（见 V7.8）

### V7 — AI Director（创作团队模拟器 · 第一阶段）

> **成功标准（创作闭环必达，缺一不可）**
>
> 1. **意图 → 交付**：一句话广告 / 短片，无需手搭图，得到 Project Tree 中间件 + 至少一条可预览成片（或等价预览）链路。
> 2. **质检 → 返工 → 再质检**：主路径上至少一轮 **自动** `QA FAIL → 注入原因 → 局部重编译或重跑子图 → 再 QA`（复用 `mediaRework` / episode FAIL 注入，禁止只出报告不返工）。
> 3. **经验回注**：本轮 Bible / DNA / 制作结论写入 `memory.md`（或等价），下一轮同类意图可被 Producer / Compiler 读到。
>
> 只做到「出目录 + 可预览、人工点重跑」视为 **开环**，不算 V7 完成。

- [ ] **7.1 Producer Agent**：NL → ProductionPlan；可选确认
- [ ] **7.2 Role Agents MVP**：Script / Storyboard / Character / Image|Video / QA
- [ ] **7.3 Project Tree**：标准目录落盘 + Dive 项目总览
- [ ] **7.4 Character Bible v1**：资产类型 + 参考图锁 + 生成注入
- [ ] **7.5 Visual DNA v1**：电影 / 风格 → Color / Lens / Light / Grain / Composition 等槽位，写入工程全局（扩展 stylePresets，非再造一套）
- [ ] **7.6 Workflow Compiler v1**：Intent IR（`movie|ad|episode|gameProto`）→ 选预设 / 改拓扑 / 绑模型（扩展 `workflow_plan` / `materializeGraphPlan`）
- [ ] **7.6a 创作闭环运行时（V7 必达）**：统一「执行 → QA → FAIL 原因落盘 → 局部重编译 / 重跑 → 再 QA」；广告 / 影视新链路必须接线，短剧继续吃 episode.review；上限 `maxAttempts`，禁止无限循环
- [ ] **7.7 记忆升级**：`memory.md` ↔ Bible / DNA / 制作计划双向写（闭环第 3 环）
- [x] **7.8 可玩 HTML 沙盒（快赢）**：一句话 → 单 HTML（**2D Canvas** / **3D Three.js**，`gamePlayMode=2d|3d|auto`）→ Dive iframe（`sandbox` + `srcdoc`，本地注入 three）；新资产 `gamePlay` + 预设 `gamePlayHtml`；试玩闭环自洽，**不替代**影视成片闭环

### V8 — AI Film Studio（AI 原生 Blender 体验）

> 成功标准：无 Blender 经验用户，一句话出可导 GLB + 导演台可播镜头序列。

- [ ] **8.1 AI Rigging Studio**：统一 Rig UX、骨骼 QA 预览、多格式导出
- [ ] **8.2 Motion Library + NL 检索**：情绪 × 动作 × 镜头语法；挂导演台轨
- [ ] **8.3 One-shot Stage Compile**：一句话 → 白模 / 角色 / 机位 / 灯 / 录屏
- [ ] **8.4 Camera Director Agent**：镜头语言预设自动排机位与切换
- [ ] **8.5 Editor Agent**：时间线粗剪 + 旁白 / 字幕对齐（扩展现有 timeline / smartCut）
- [ ] **8.6 Consistency QA 视觉**：embedding / VLM 角色与 DNA 校验进流水线
- [ ] **8.7 Visual DNA v2**：跨镜头强制 DNA；「只变情节不变风格」

### V9 — AI Game Engine + 生态

> 成功标准：一句话小游戏有可玩 HTML + 可导入 Godot / Unity 的资产包；商店有第一条第三方 Workflow。

- [ ] **9.1 Game Producer**：「做一个塔防」→ 角色 / 地图 / UI / 任务 / 剧情 Agent
- [ ] **9.2 游戏节点包**：Story / Character / Model / Anim / Level / Audio → engine-ready manifest（对齐 5.4 / GameFactory 观察项）
- [ ] **9.3 导出适配器**：先 Godot + 现有 Spine；再 Unity Prefab；UE 更后
- [ ] **9.4 NPC / 剧情 Agent**：对话树 + 任务图（与 `gameSystem` 合流）
- [ ] **9.5 HTML 原型升级**：沙盒 HTML ↔ 引擎导出中间层（仍非自研完整引擎）
- [ ] **9.6 Marketplace**：LoRA / Character / Motion / Workflow / Node / Skill；V7 先规范化 pack 清单格式
- [ ] **9.7 Studio Server**：团队角色、云工程、GPU 队列；Desktop 变客户端（Frame.io + 审片心智）；V8 末可做只读云同步试点

### Workflow Compiler（持续技术壁垒）

- [ ] Intent 解析 → 类型 + 约束（时长 / 比例 / DNA / Bible）
- [ ] Plan IR → Agent 步骤 + 预设种子 + 资源绑定
- [ ] Materialize → 现有物化 + 目录约定
- [ ] **Execute + QA 闭环（硬门槛）** → FAIL 注入原因、局部子图重编译、再 QA；对齐 `mediaRework` / episode FAIL；V7 必达见 7.6a
- [ ] 长期：类型检查、成本估算、并行调度、可微调解译器

### 近两季度建议切片（与 Unreleased / P1 交叉）

**Q1（V7 前半）**：Character Bible v1 → Producer MVP（广告 / 短剧各 1 模板）+ Project Tree → **创作闭环运行时 7.6a（接现有返工）** → Visual DNA v1 → 单 HTML 2D/3D 沙盒 → Compiler Intent IR 文档化并联 `workflow_plan`。

**Q2（V7 后半 → V8 启动）**：Role Agents 扩 Camera / Editor → Motion Library 数据模型 + 导演台挂接 → Rigging UX 统一 → Consistency QA 节点（进闭环）→ Skill/Pack 清单格式（Marketplace 铺路）。

### 战略上明确不做

- 自研通用游戏引擎替换 Unity / UE
- 无沙箱 `eval` 任意代码当 gameplay（HTML iframe 沙盒除外且须隔离）
- V7 同步上完整 SaaS 与商店（格式先于商店）
- 用提示词堆砌替代 Bible / DNA / Compiler 结构化层

## 5.0.7（已发布）

- [x] dsh 运行体裁剪：内置运行体只保留运行必需文件（-55% 文件数、-36% 体积），安装解压更快、包更小
- [x] dsh 内置运行体重新进包（绕过 electron-builder 26 copyDir 过滤缺陷，5.0.4 / 5.0.5 回归修复）
- [x] dsh 启动修复：内置 Node 直启时注入 `--expose-internals`，消除 HMR 插件崩溃

## 5.0.5（已发布）

- [x] **dsh 运行时离线打包**：dsh 运行体随包内置（`resources/dsh`），并复用 Electron 内置 Node（`ELECTRON_RUN_AS_NODE=1`）执行——运行时不再依赖系统 Node 22.19+ 与 npx 联网拉包

## 5.0.4（已发布）

- [x] **Skill 技能系统基础**：内置创作技能随对话自动就位（快照 + 指纹去重）、设置 → 自定义技能目录（dsh SKILL.md 格式）、对话真实上下文用量环形进度、提问弹窗

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
