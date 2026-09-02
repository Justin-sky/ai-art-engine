# 集成 Spine 与 YOLO 规划

> 状态：草案 · 目标版本：5.x
> 范围：2D 骨骼动画（Spine）资产化与生产化；本地视觉理解（YOLO）与创作链路联动。

---

## 1. 背景与目标

### 1.1 背景

- 当前角色动画能力集中在 **3D 导演台**（Three.js 站位、IK、骨架重定向、AI 姿态解析），2D 侧只有帧动画 / 序列图，缺少**骨骼动画**资产与编辑能力。
- 视觉理解依赖「多帧抽帧 + 文本模型描述」的间接方式（`shared/graph/videoReview.ts`），缺少**确定性、本地、实时**的目标检测 / 分割 / 姿态估计能力。
- Roadmap P1 已有「3D 闭环：骨骼动画导入编辑（复用导演台 IK / 骨骼基础）」前置项，本规划是其 2D 侧补全 + 视觉理解底座。

### 1.2 目标

1. **Spine 资产化**：`.spine`（JSON / `.skel` + 图集 + 纹理）可作为工程资产导入、预览、播放，并在节点图与时间线中使用。
2. **Spine 生产化**：Spine 动画可导出为**透明通道视频**接入成片时间线；支持皮肤 / 插槽切换、动画集切换、播放控制。
3. **YOLO 本地视觉底座**：内置 ONNX Runtime 推理，提供目标检测 / 实例分割 / 人体姿态三种能力，**纯本地、无需联网**，数据不出本机。
4. **创作链路联动**：YOLO 检测结果反哺智能剪辑（构图裁切、主体定位）、素材打标、媒体质检；YOLO-pose 关键点驱动 Spine 与 3D 角色骨骼，实现本地「视频 → 角色动画」动捕 MVP。

---

## 2. 现状与可复用基础

| 能力 | 现有实现 | 复用方式 |
|---|---|---|
| 骨骼命名归一 | `renderer/features/director/skeletonRetarget.ts` `normalizeBoneName` | Spine 骨骼名 / YOLO 关键点名统一走同一套归一化 |
| 姿态资产编码 | `renderer/features/director/poseAsset.ts` | Spine 姿态快照沿用 `encodeBonePoseNormalized` 结构 |
| AI 姿态解析 | `renderer/features/director/aiPoseParse.ts` | 文本 → 规范化骨骼姿势，可直接套用 Spine 骨架 |
| 骨架动画工具 | `renderer/features/director/skeletonAnim.ts` | 播放 / 混合逻辑参考（Spine 用自己的 runtime） |
| IK 链 | `renderer/features/director/ikChains.ts` | 与骨骼链判断逻辑共用 `spine/hip/chest/head` 语义 |
| 资产模型 | `shared/domain.ts` `AssetType` + 真实目录 / meta | 新增 `spine` 资产类型 |
| 媒体帧提取 | 主进程 `videoFrameService.ts`（ffmpeg/ffprobe） | YOLO 视频抽帧复用；Spine 导出合成复用 ffmpeg |
| 智能剪辑 | `shared/graph/smartCut.ts` | 融入 YOLO 主体定位结果做构图决策 |
| 媒体质检 | `shared/graph/videoReview.ts` | YOLO 检测分数作为确定性维度叠加 |
| MCP / Skill | 内置 MCP 工具 + 技能系统 | 暴露 `detect_objects`、`export_spine_animation` 等工具 |

---

## 3. 整体架构

```text
┌────────────────────────── 渲染进程 (Renderer) ──────────────────────────┐
│  Spine 播放器 (spine-webgl / spine-canvas)                              │
│    ├─ SpineAssetPreviewView  资产预览 / Inspector                       │
│    ├─ SpineComposeCanvas    节点图/时间线内联渲染                        │
│    └─ SpineFrameExporter     逐帧离屏渲染 → 帧序列                       │
│  导演台 / 时间线 / 节点图 / 资产库                                       │
└───────────────┬────────────────────────────────────────────────────────┘
                │ IPC（新增：spine:* / yolo:* / visual:*）
┌───────────────▼────────────────── 主进程 (Main) ────────────────────────┐
│  SpineService                                                           │
│    ├─ 导入解析（spine-core: JSON / SKEL / 图集 / 纹理）                   │
│    ├─ 资产索引（meta 落盘 `Spine.asset.json`）                           │
│    └─ 动画导出（帧序列 → ffmpeg 透明视频，VP9 alpha / ProRes）            │
│  YoloService (onnxruntime-node)                                         │
│    ├─ DetectEngine   目标检测  YOLOv8n/v8s (COCO)                       │
│    ├─ SegmentEngine  实例分割  YOLOv8n-seg                              │
│    └─ PoseEngine     姿态估计  YOLOv8n-pose (COCO 17 关键点)             │
│    └─ 关键点 → 骨骼旋转映射（复用骨架归一，输出规范化 bonePose）           │
│  复用：videoFrameService / ffmpeg 管线 / 资产仓库 / MCP 工具注册          │
└─────────────────────────────────────────────────────────────────────────┘
```

**依赖与运行时**（随包内置，Electron asar 内）：

| 模块 | 选型 | 说明 |
|---|---|---|
| Spine 运行时 | `@esotericsoftware/spine-core` + `spine-webgl`（预览）/ `spine-canvas`（兜底） | 官方 runtime，MIT；**Spine 编辑器本身不在分发范围** |
| 本地推理 | `onnxruntime-node` | 原生模块需按 Electron ABI 重建（electron-rebuild），Windows x64/arm64 + macOS + Linux 三平台验证 |
| 模型权重 | YOLOv8n / YOLOv8n-seg / YOLOv8n-pose 的 ONNX（GPL-3.0 兼容，Ultralytics 权重为 AGPL-3.0——**需确认协议合规或换用 Apache 2.0 模型**） | 首次运行下载 / 随包内置，默认 CPU 推理，预留 DirectML/CUDA 开关 |

---

## 4. Spine 集成

### 4.1 资产化

1. **新增资产类型 `spine`**（`shared/domain.ts` AssetType 扩展）。
   - 磁盘形态：`.spine` 目录（JSON/SKEL + `.atlas` + PNG/WebP 纹理）或单 `.spine` 文件 + 旁挂 meta。
   - `import.ts` 识别扩展名 `.spine.json` / `.skel` / `.atlas`，导入时聚合为单一资产并解析依赖纹理。
2. **SpineService（主进程）**：
   - `spine:import`：解析 SkeletonJson / SkeletonBinary → 资产索引（骨骼树、动画名列表、皮肤名列表、插槽列表）。
   - `spine:inspect`：返回资产元数据供 Inspector 展示（动画 / 皮肤 / 插槽 / 骨骼数量）。
   - 纹理：本地文件加载（file:// 或自定义协议），规避 CORS。
3. **资产预览（渲染进程）**：
   - `SpineAssetPreviewView`：spine-webgl 渲染，支持动画播放 / 暂停 / 速度 / 时间线拖拽 / 皮肤切换 / 循环开关；白色棋盘格背景显示透明。
   - 归一到导演台同一套骨骼语义，可在 Inspector 查看骨骼映射。

### 4.2 节点图集成

- 新增节点：**「Spine 动画」**（输入：Spine 资产 / 动画名 / 皮肤 / 播放参数 → 输出：透明视频或帧序列）。
- 新增节点：**「Spine 姿态套用」**（输入：文本姿态或 poseAsset → 输出：应用姿态后的 Spine 资产/帧），复用 `aiPoseParse` 文本 → 规范化姿势 → 映射到 Spine 骨骼。
- 端口类型沿用端口必须相同的规则（Spine 资产端口 `spine`，输出口 `out` / `out-all`）。

### 4.3 时间线与导出

- **SpineFrameExporter**：离屏逐帧渲染（透明背景）→ 帧序列落盘 `Cache/SpineFrames/<asset>/` → ffmpeg 合成：
  - WebM/VP9 alpha（Web 与后续 PWA 兼容）或 ProRes 4444（剪辑友好）；预览/内部使用先出 MP4+alpha matte。
- 时间线：Spine 生成的透明视频可作为普通视频轨/叠加轨片段，配合既有转场、画中画使用。
- 导出时长 = 动画时长 × 播放次数，参数化到生成节点。

### 4.4 AI / MCP 暴露

- MCP 工具：`spine_animate`（资产 + 动画名 + 皮肤 → 导出视频）、`spine_list_animations`。
- Skill：新增「2D 角色动画」技能，指导 Agent 选动画、切皮肤、套姿态、落时间线。

---

## 5. YOLO 集成

### 5.1 推理底座（YoloService，主进程 worker 线程）

- `onnxruntime-node` 加载 ONNX 模型，`yolo:detect` / `yolo:segment` / `yolo:pose` 三个 IPC。
- 统一输入：图片路径 / 视频抽帧（复用 `videoFrameService`）。
- 输出规范（跨平台自用协议）：
  ```ts
  type YoloDetectResult = {
    boxes: Array<{ label: string; confidence: number; x, y, w, h: number }>
  }
  type YoloSegmentResult = YoloDetectResult & {
    masks: Array<{ width: number; height: number; data: Uint8Array }> // 0/1 mask
  }
  type YoloPoseResult = YoloDetectResult & {
    skeletons: Array<Array<{ x, y, confidence }>> // COCO 17 关键点
  }
  ```
- 模型管理：`resources/models/yolo/`；设置页显示模型状态（存在 / 版本 / 推理后端 CPU/DirectML）。

### 5.2 应用场景

| 场景 | 实现 | 复用/联动 |
|---|---|---|
| 素材自动标签 | 资产导入时对图片/视频首帧跑 Detect → 标签写入 meta | Roadmap「资产语义检索」的视觉通道 |
| 智能剪辑构图 | 检测人物/主体 bbox → 建议裁切框（竖屏 9:16 适配、主体居中） | `smartCut.ts` 方案中新增「构图约束」输入 |
| 实例分割抠图 | Segment mask → 抠图出透明 PNG | 现有「抠图」技能 / 图层分离链路的本地化补充 |
| 媒体质检增强 | 主体是否完整在画面内、是否有人脸/人物、目标置信度 | 叠加到 `videoReview` 五维评分 |
| 运镜辅助 | 逐帧主体位置 → 自动生成缩放/平移关键帧（模拟推拉摇移） | 时间线片段变换参数 |
| 人体姿态动捕 | Pose 关键点 → 规范化骨骼旋转 → Spine / 3D 角色 | **见第 6 节联动** |

### 5.3 MCP / Skill 暴露

- MCP 工具：`detect_objects`（图片/视频 → 检测结果 JSON）、`segment_subject`（抠图产物入库）。
- Skill：新增「本地视觉」技能，约定输出格式（标签 / bbox / mask / 骨架），供分镜与质检 Agent 调用。

### 5.4 对标 LibTV：YOLO 可实现的视觉功能

> LibTV（LiblibAI 一站式 AI 视频创作平台，无限画布 + 剧本 / 分镜 / 生图 / 生视频）的「图像 / 视频工具集」中，**视觉类功能大部分可用本规划的 YOLO 底座本地实现**——这正是项目 Local-First 相对竞品的差异化点（本地、免费、数据不出机）。

| LibTV 功能 | YOLO 能力 | 本规划落地 | 优先级 |
|---|---|---|---|
| 抠图 | Segment 实例分割 | 本地抠图，替代云端抠图 API | P0 |
| 标注 | Detect 自动打标 | 资产导入自动标签（5.2 素材自动标签） | P0 |
| 裁剪（智能构图） | Detect bbox 主体定位 | 9:16 居中裁切（5.2 智能剪辑构图） | P0 |
| 视频分镜解析 | Detect + 镜头切分 | 「视频 → 分镜」管线：ffmpeg scene 切分 + 每镜首帧检测/场景标签 + 文本模型生成镜头描述 | P0 |
| 擦除 / 重绘区域 | Segment mask | mask 精确限定 inpaint/erase 区域（接 ComfyUI） | P1 |
| 宫格切分（9/25 宫格） | Detect 主体避让 | 分镜宫格排布避开主体 / 人脸 | P1 |
| 打光（智能光位） | Detect 人脸 / 主体朝向 | 反推合理主光方位作「智能打光」参考 | P2 |
| 角色一致性 | Detect + 跟踪（ByteTrack） | 跨镜头同角色匹配，辅助一致性控制 | P2 |

**关于「深度视频」的澄清**：深度估计（depth estimation）不是 YOLO 任务，LibTV 也并非主打深度视频，但 AI 视频圈确有「深度控制图生视频」用法。两种接近方案：

- **伪深度（YOLO 可做）**：按 bbox / 分割面积 + 遮挡关系排序 → 语义深度图（近处亮），零额外依赖，够构图 / 层次判断用。
- **真深度（独立模型）**：Depth Anything v2 / DepthCrafter 单目深度估计 → 连续灰度深度图，用于深度控制图生视频 / 2D 转 3D；可并入同一 onnxruntime 推理底座，作为**可选模块**（不在本期强制范围）。

---

## 6. 联动：YOLO-pose → Spine / 3D 角色动捕

> 本项目的差异化价值点：一条「视频 → 骨骼动画」的本地闭环。

### 6.1 关键点 → 骨骼映射

1. COCO 17 关键点 → 规范化骨骼键（复用 `normalizeBoneName` 语义扩展）：
   - 关键点 `left_shoulder / left_elbow / left_wrist` → 骨骼 `shoulderL / elbowL / handL`（Spine 约定），并与 Mixamo 风格命名对齐。
2. 2D 关键点 + 深度先验 → 各关节 3D 方向：用**三角化 + 骨骼长度约束**（复用导演台骨骼链）反解关节旋转角，输出 `encodeBonePoseNormalized` 兼容的规范化 `bonePose`。
3. 时间维：按帧序列输出姿势关键帧，稀疏化（降采样）后插值平滑，避免抖动。

### 6.2 应用目标

| 目标 | 描述 | 阶段 |
|---|---|---|
| Spine 驱动 | 规范化 bonePose 经 `mapNormalizedPoseToTargetBones` 套用到 Spine 骨架（演示角色小动画） | MVP |
| 3D 角色驱动 | 套用到导演台 3D 角色（复用既有骨骼应用管线） | MVP+ |
| 动画库积累 | 录制的姿势序列可存为 `motion` 资产，供复用/编辑 | MVP+ |

### 6.3 精度与鲁棒性

- 单目 2D → 3D 存在歧义，MVP 面向**侧向 / 大动作**场景（演员朝侧面，肢体层次分明），不做正对镜头精细捕捉。
- 关键点置信度 < 阈值时按上一帧保持 + 插值，输出带 `confidence` 供上层判断。

---

## 7. 分阶段计划

### Phase 1 — Spine 资产化与预览（里程碑 A）

- [ ] AssetType 扩展 `spine`；导入识别 `.spine.json / .skel / .atlas`，依赖纹理聚合
- [ ] `SpineService` 主进程解析 + `spine:*` IPC
- [ ] `SpineAssetPreviewView` 资产预览（播放 / 速度 / 皮肤 / 动画集）
- [ ] 依赖入包：spine-core + spine-webgl 随包内置
- 验收：导入一个标准 Spine 角色工程，能在资产库预览并切换 2 个动画。

### Phase 2 — Spine 生产化（里程碑 B）

- [ ] SpineFrameExporter 逐帧离屏渲染 → ffmpeg 透明视频
- [ ] 节点图「Spine 动画」「Spine 姿态套用」节点
- [ ] 时间线支持透明视频片段（普通轨 + 叠加轨）
- [ ] MCP `spine_animate` / `spine_list_animations` + Skill
- 验收：Spine 动画 2 分钟内产出透明视频并上轨导出成片；Agent 对话可直接驱动一次动画导出。

### Phase 3 — YOLO 本地视觉底座（里程碑 C）

- [ ] `onnxruntime-node` 集成 + 三平台重建验证 + 模型内置
- [ ] `YoloService` Detect / Segment / Pose 三引擎 + `yolo:*` IPC
- [ ] 设置页模型状态与推理后端开关
- 验收：对一张图片完成 80 类检测与 17 关键点姿态输出，CPU 推理首帧 < 1s。

### Phase 4 — YOLO 创作链路（里程碑 D）

- [ ] 素材自动标签写入 meta（衔接资产语义检索）
- [ ] 智能剪辑构图约束（9:16 主体居中裁切建议）
- [ ] Segment 抠图入库（复用抠图/图层分离出口）
- [ ] 媒体质检叠加确定性检测维度
- [ ] 视频分镜解析：镜头切分 + 每镜检测/标签 + LLM 镜头描述（对标 LibTV）
- [ ] 擦除 / 重绘区域 mask（接 ComfyUI inpaint/erase）
- 验收：拖入一段竖屏素材，一键生成「主体居中」裁切方案并可预览应用；一段视频可解析为带主体/场景标签的镜头清单。

### Phase 5 — 视频驱动角色动画（里程碑 E）

- [ ] YOLO-pose 关键点 → 规范化骨骼旋转映射
- [ ] Spine 角色驱动 MVP（视频 → Spine 动画预览）
- [ ] 3D 角色驱动 + `motion` 资产化积累
- [ ] MCP `pose_to_animation` 工具 +「动捕」Skill
- 验收：一段 10s 侧向行走视频 → 导出 Spine 角色同步走路的动画/视频。

### Phase 6 — 视觉进阶（可选，P1 后期）

- [ ] 宫格切分主体避让、智能打光方位参考（Detect 人脸 / 主体朝向）
- [ ] 跨镜头角色跟踪匹配（Detect + ByteTrack，辅助角色一致性）
- [ ] 伪深度构图层次分析（bbox / 分割 → 语义深度图）
- [ ] 真深度估计模块（Depth Anything v2 ONNX：深度控制图生视频 / 2D 转 3D）
- 验收：跨镜头同角色自动匹配提示；一段普通视频可产出深度图序列供外部深度控制使用。

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Spine 资产许可（编辑器商业，runtime 免费） | 合规 | 只分发 runtime（MIT）；文档注明资产版权归用户；不内置任何付费 Spine 示例 |
| YOLOv8 权重 AGPL-3.0 与项目 GPL-3.0 混用 | 合规 / 授权 | 评估换用 Apache-2.0 模型（如 RT-DETR、部分 COCO 预训练权重）；或以「随包独立下载 + 独立协议文件」方式隔离 |
| `onnxruntime-node` 原生模块跨平台/跨 Electron 版本 | 构建 | CI 三平台 electron-rebuild + smoke test；发布前在 win/mac/linux 实机验证 |
| 打包体积膨胀（onnxruntime ~60-100MB + 模型） | 分发 | 模型按需下载（首次使用提示），运行时随包；体积报告纳入 CI |
| Spine 逐帧导出性能 | 效率 | 离屏渲染并行批次 + 进度回报；降采样帧率（如 24fps→12fps）选项 |
| 单目 2D 姿态歧义 | 质量 | 限定可捕捉动作类型；置信度门控 + 插值平滑；文档明确能力边界 |
| Spine runtime 与 Electron 渲染器兼容 | 稳定性 | 早期 Spike 验证（webgl 上下文、透明、离屏渲染）后进入正式开发 |

---

## 9. 验收总览

| 里程碑 | 一句话验收 |
|---|---|
| A Spine 资产化 | 导入 Spine 角色工程并在资产库预览、切动画 |
| B Spine 生产化 | Spine 动画导出透明视频上轨成片，Agent 可驱动 |
| C YOLO 底座 | 本地 CPU 完成检测 / 分割 / 姿态三种推理 |
| D YOLO 链路 | 自动打标 + 智能构图裁切 + 抠图 + 质检增强 |
| E 动捕闭环 | 视频 → YOLO-pose → Spine / 3D 角色动画 |
| F 视觉进阶（可选） | 角色跨镜头匹配 / 深度图序列产出 |

---

## 10. 相关文档

- 资产模型：[ASSET_MODEL.md](./ASSET_MODEL.md) · 节点图插件：[GRAPH_PLUGINS.md](./GRAPH_PLUGINS.md)
- 路线图：[ROADMAP.md](./ROADMAP.md)（P1「3D 闭环」与本规划衔接）
- 骨架/姿态实现：`src/renderer/src/features/director/`（skeletonRetarget.ts / aiPoseParse.ts / poseAsset.ts / skeletonAnim.ts / ikChains.ts）
- 智能剪辑与质检：`src/shared/graph/smartCut.ts` / `src/shared/graph/videoReview.ts` / 主进程 `videoFrameService.ts`
