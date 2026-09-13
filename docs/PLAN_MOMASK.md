# 集成 MoMask 动作生成规划

> 状态：草案 · 目标版本：5.x
> 范围：文本 / 姿态提示 → 3D 人体动作序列（text-to-motion）；生成动作的重定向、资产化与导演台消费。
> 对应 Roadmap：P1「3D 动作生成（MoMask）」，联动 P1「3D 闭环」与 5.3「姿态进导演台」。

---

## 1. 背景与目标

### 1.1 背景

- 3D 角色动作目前**只能来自外部现成库**：Mixamo 等导出「仅骨骼 + 动画 GLB」再入库。动作可控性受限于手头素材——分镜要一段「拔剑挥砍」「踉跄后退两步」，没有素材就只能改文案。
- 2D 侧已有对称能力：5.5「2D 导演台」的「从视频生成动作」已落地（逐帧 YOLO pose 反解平面旋转 → 动作帧 → 试播 / 存动作资产）；3D 侧缺少同级的动作来源扩充。
- 动作消费链路已完备：导演台骨骼轨（`DirectorAnimTrack.skeletonClips`）按 `assetId` 取外部动画资产、自动重定向到当前角色（`ensureRetargetedClip` → `retargetClipToCharacter`）后播放。**生成动作只要落成同构的动画资产，导演台 / 资产库就不需要新增消费端**——这是本规划能低成本接入的关键前提。
- 本地推理底座已具备：`YoloService`（`utilityProcess` fork + `onnxruntime-node`，含模型目录 / 随包内置清单 / 按需下载 / 设置页管理 / 崩溃与超时处理）是可套用的工程范式，`onnxruntime-node` 已在包内。
- Roadmap 定位：P1「3D 动作生成（MoMask）」展开为本规划；其产物同时是 P1「3D 闭环」（骨骼动画编辑、GLB 动画导出）的动作素材来源。

### 1.2 目标

1. **文本 → 动作**：一句描述（给定或自动推导时长）产出一段动作序列，可在导演台 / 3D 资产预览中循环播放。
2. **姿态 → 动作**：以工程内既有姿势（姿态资产 `PoseAssetData`、YOLO 关键点反解、AI 文本姿态）作为首段条件或时间区间条件，续写 / 插值 / 补全动作（时间 in-painting）。
3. **动作重定向**：生成动作按骨骼语义映射到任意目标角色，复用 `normalizeBoneName` + `retargetClipToCharacter` 双路径，不要求目标角色是 SMPL / Mixamo 骨架。
4. **资产化交付**：动作落为「仅骨骼 + 动画 GLB」资产（`genParams.modelKind = 'animation'`，目录 `Models/`），与既有外部动作同构，直接进导演台骨骼轨、资产库预览与后续 GLB 动画导出。
5. **入口完备**：节点图「3D 动作生成」节点 + MCP 工具 `generate_motion` + 对话技能，Agent 可编排。
6. **合规可分**：不随包内置 SMPL / SMPL-X 官方模型文件与训练数据集；权重按需下载并明示各自许可（§7）。

---

## 2. 现状与可复用基础

| 能力               | 现有实现                                                                                                                                                                        | 复用方式                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 骨骼名归一         | `renderer/features/director/skeletonRetarget.ts` `normalizeBoneName`（剥离 `mixamorig:` / `bip01` / `bone` 前缀）                                                               | SMPL 22 关节 → 目标角色骨骼的语义匹配基准 |
| 动作重定向         | 同文件 `retargetClipToCharacter` / `remapClipTracksByBoneNames` / `buildBoneNameMap` / `findHipBoneName`                                                                        | 生成 clip → 任意目标角色的现成通道        |
| 骨骼动画播放       | `useDirectorStageScene.ts`（`skeletonRuntimes` / `ensureRetargetedClip` / `applySkeletonAnimationsAtTime`）、`skeletonAnim.ts`（分段）                                          | 生成动作在导演台的分段播放与重定向缓存    |
| 动作资产契约       | `shared/domain.ts` `DirectorSkeletonClipSegment`（`assetId` / `clip` / `speed` / `loop` / `start` / `end`）、`DirectorAnimTrack.skeletonClips`、`ModelAssetKind='animation'`    | 生成产物直接成为可挂载的动作资产          |
| 姿态资产           | `features/director/poseAsset.ts`（`PoseAssetData`、`encodeBonePoseNormalized`、`mapNormalizedPoseToTargetBones`）                                                               | 姿态提示的规范化输入 / 输出契约           |
| 文本 → 姿态        | `features/director/aiPoseParse.ts`（`parseAiPoseFunctionCall`、`mapAiPoseDegreesToBonePose`、`apply_bone_pose` 系统提示词）                                                     | 文本描述的起始姿态 → 首段条件             |
| 图像 / 视频 → 姿态 | `poseFromMedia.ts`（`solvePoseFromSkeleton`、`visibleKeypointIndices`）、`imagePoseSolver.ts`（`solveImagePoseToBonePose`、`inferBoneRole`、`alignQuaternion`）                 | 自根向下逐骨对齐的解算思路，解码层同源    |
| 姿势写回导演台     | `useDirectorStageScene.applyObjectBonePoseMap(objectId, bonePose, mode)`、`setObjectBonePoseWithUndo`、`listObjectPoseBindBones`                                                | 姿态条件的读取、应用与撤销                |
| 本地推理底座       | `main/yolo/yoloService.ts`（`utilityProcess.fork` + ping 握手 + 超时 + 崩溃标记）、`yoloWorker.ts`（onnxruntime 会话）、`yoloModelManager.ts`（模型目录 + 随包清单 + 按需落地） | 动作推理服务照此范式落地                  |
| 模型管理 UI        | `components/settings/YoloModelsPanel.vue` + IPC `yolo:model-*`（`shared/ipc.ts`）                                                                                               | 动作模型目录 / 下载 / 删除面板            |
| 3D 生成节点        | `asset.model3d` + `shared/graph/execute/generateModel3d.ts`（异步 submit → poll → download）                                                                                    | 新节点的编排、进度与落盘范式              |
| 资产落盘           | `shared/domain.ts` `ASSET_MODEL_OUTPUT_KIND_DIR='Models'` + 旁挂 `<file>.asset.json` meta                                                                                       | 动作 GLB 的入库与元数据                   |
| 资产预览           | `components/ModelPreview.vue`                                                                                                                                                   | 「3D 资产驱动预览」的扩展位               |
| 媒体管线           | 主进程 `videoFrameService.ts` / ffmpeg 封装                                                                                                                                     | 拇指帧、时长探测、外部格式转换            |
| 子进程先例         | `deepseekHarnessService.ts`（spawn + `ELECTRON_RUN_AS_NODE`）、`audioSeparationService.ts`（execFile）                                                                          | Python sidecar 承载参考（仅开发验证）     |
| MCP / 技能         | 内置 MCP 工具注册（`generate_model3d` / `generate_image` 等）与技能系统                                                                                                         | 暴露 `generate_motion` 与「3D 动作」技能  |

---

## 3. 整体架构

```text
┌───────────────────────── 渲染进程 (Renderer) ─────────────────────────┐
│  节点卡「3D 动作生成」/ 导演台动画面板 / 资产库预览 / 对话面板         │
│    ├─ 文本提示 + 目标时长 + 首段姿态（PoseAssetData / YOLO / AI 文本） │
│    ├─ 候选预览与重抽（导演台骨骼轨直接试播）                          │
│    └─ 重定向到当前角色（复用 retargetClipToCharacter）                 │
└───────────────┬───────────────────────────────────────────────────────┘
                │ IPC（新增 motion:* / motion-model:*）
┌───────────────▼───────────────────── 主进程 (Main) ───────────────────┐
│  MotionService                                                        │
│    ├─ 后端选择：本地 ONNX（首选）/ Python sidecar（开发验证）/ 远程 API │
│    ├─ 采样与解码：token → 263 维姿态特征 → 关节旋转 + 根位移           │
│    ├─ 骨架装配：标准人形骨架 humanoidRig3d → AnimationClip / GLB       │
│    └─ 资产落盘：Models/ + 旁挂 meta（modelKind:'animation'）           │
│  复用：utilityProcess worker 范式 / 模型目录管理 / ffmpeg / MCP 注册   │
└───────────────────────────────────────────────────────────────────────┘
```

**依赖与运行时**：

| 模块       | 选型                                           | 说明                                                                      |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| 本地推理   | `onnxruntime-node`（已在包内）                 | 与 YOLO 共用原生模块，走 `utilityProcess` worker，CPU 优先、预留 DML 开关 |
| 模型权重   | MoMask 官方预训练权重（RVQ + M/R-Transformer） | **按需下载**，不随包内置；来源与许可在设置页明示                          |
| 文本编码器 | CLIP（与 MoMask 训练口径一致）                 | 与权重同策略按需获取                                                      |
| 动作表示   | T2M / HumanML3D 263 维特征 + SMPL 22 关节      | 只消费**数值**（关节旋转 / 位置），不打包也不要 SMPL 网格模型文件         |

> 官方实现为 PyTorch（`gen_t2m.py` / `edit_t2m.py`），本项目不自带 Python 运行时进发行包；PyTorch 仅用于阶段 0 的开发验证与数值对拍（§5.2）。

---

## 4. 动作表示与解码路径

### 4.1 MoMask 输出形态（事实基线）

- 生成脚本输出 `generation/<ext>/joints/*.npy`，形状 **`(nframe, 22, 3)`**（SMPL 22 关节三维位置），帧率 **20 fps**；同目录另出 BVH 与火柴人 mp4。
- 内部动作表征沿用 T2M / HumanML3D 的 **263 维逐帧特征**：根旋转速度 1 + 根线速度 2 + 根高度 1 + 21 关节局部位置 63 + 21 关节 6D 局部旋转 126 + 22 关节速度 66 + 脚部接触 4。
- 结构：RVQ 动作 tokenizer（6 层量化、码本 512）→ Masked Transformer（base 层 token）→ Residual Transformer（残差层 token）；推理迭代约 15 次且**与动作长度无关**，官方 demo 可纯 CPU 运行。
- 已知边界（写进 UI 提示与文档，不承诺）：**目标时长需外部给定**（可接 text2length 预测长度）；**根节点快速变化**的动作（原地急转、连续旋转）生成质量差；多样性相对受限；官方可选脚部 IK 后处理存在「有时成功有时失败」的不稳定。

### 4.2 解码路径（本项目口径）

`motion token → 263 维特征 → 关节旋转 / 根位移 → 标准人形骨架 AnimationClip`

1. **旋转为主**：取 263 维中的 **21 关节 6D 局部旋转**，正交化回旋转矩阵 → 四元数，作为局部关节旋转；根位移与根朝向由根线速度 / 旋转速度**积分还原**（避免仅靠关节位置做拟合的不稳定）。
2. **位置为辅**：`(nframe, 22, 3)` 关节位置用于①脚部接触与地面高度校正（消滑步）②缺失旋转分量时的兜底解算——按自根向下逐骨对齐方向，与 `imagePoseSolver.ts` 的 `alignQuaternion` / `bindDirInLocal` 同源，可抽公共函数复用。
3. **标准人形骨架契约 `humanoidRig3d`**：与 5.5 `stage2dHumanoid` 对称——定义 SMPL 22 关节语义 → 归一骨名（`normalizeBoneName`）的标准骨架（hips / spine / chest / neck / head + shoulder / upperarm / forearm / hand + thigh / shin / foot，左右对称）。MoMask 输出先装配为**该标准骨架的 `AnimationClip`**，再经既有重定向通道落到目标角色，**不硬编码任何具体角色骨名**。
4. **帧率与时长**：模型侧 20 fps → 目标 clip 按 24 / 30 fps 重采样；`duration` 未给定时先预测长度（text2length 或按文本 token 数启发式），超上限给警示。
5. **闭环**：可选把末帧回接到首帧姿态（`poseAsset` 夹角阈值内插值过渡），使 `loop: true` 无缝循环。

### 4.3 资产契约（`genParams.motion`）

沿用 `PoseAssetData` 的契约风格（`schemaVersion` + 只增字段、旧版本忽略）：

| 字段            | 说明                                                   |
| --------------- | ------------------------------------------------------ |
| `schemaVersion` | 契约版本，从 1 起                                      |
| `prompt`        | 生成用文本提示（含时长标注）                           |
| `lengthFrames`  | 动作帧数（模型侧 20 fps 口径）                         |
| `fps`           | 输出 clip 帧率                                         |
| `skeleton`      | 标准骨架标识（`humanoidRig3d@1`）                      |
| `source`        | `text` / `pose-prefix` / `inpaint`                     |
| `backend`       | `local-onnx` / `sidecar` / `remote:<provider>`         |
| `seed`          | 随机种子，供重抽与复现                                 |
| `poseCondition` | 首段 / 区间条件摘要（关节名 + 角度，不含源资产二进制） |

动作资产本体仍是 GLB（`modelKind:'animation'`），`genParams.motion` 只承载可检索、可复现的语义元数据。

---

## 5. 推理接入（三级承载）

### 5.1 本地 ONNX（首选，与 YoloService 同构）

- MoMask 三段（RVQ 编解码器 + M-Transformer + R-Transformer）与 CLIP 文本编码器都是静态图结构（1D 卷积 + BERT 式 transformer），可导出 ONNX。
- **采样循环留在 TS 侧**：掩码迭代、置信度保留、重新掩码调度、CFG 外推（`ω = (1+s)·ω_c − s·ω_u`）在 Node 侧实现，ONNX 只承载单步前向——避免把动态控制流塞进计算图，也便于调参与断点复现。
- 运行承载：新增 `motionService`（`utilityProcess.fork` + `onnxruntime-node`），沿用 `yoloService` 的 ping 握手 / request id / 超时 / 崩溃标记 / 懒启动；IPC 走新前缀 `motion:*`。
- 模型管理：默认 `<userData>/motion-models`，随包只带 `.bundled-models.json` **清单**（不含权重），设置页提供下载 / 删除 / 换目录，复用 `YoloModelsPanel` 的交互与 IPC 形状（`motion-model:*`）。

### 5.2 本地 Python sidecar（开发验证 / 数值对拍）

- 直接跑官方脚本，最省事地打通「文本 → 动作」链路，用于阶段 0 的可视化验证与重定向观感确认。
- 承载参考现有 spawn（`deepseekHarnessService` 用 `ELECTRON_RUN_AS_NODE` 跑内置 Node）；**仅开发者环境使用，不进发行包**（PyTorch CPU 体积不可接受）。
- 另一职责是**对拍基线**：同一 prompt / seed 下，把 ONNX 路径的关节旋转与该路径逐帧比对，作为阶段 2 的退出条件。

### 5.3 远程 API 兜底

- 抽 `MotionBackendProvider`（`local-onnx` / `sidecar` / `remote:<provider>`），与既有模型提供商体系一致的配置、错误码与降级口径。
- 用途：本地模型未下载时的可用性兜底；以及成片级质量对照。

---

## 6. 重定向、消费与导出

### 6.1 重定向

- 生成 clip 的轨道是标准人形骨架（归一骨名）→ 复用 `retargetClipToCharacter(targetRoot, sourceRoot, clip)`：优先 `SkeletonUtils.retargetClip`（`buildBoneNameMap` + 髋对齐 + 首帧位置），失败退回 `remapClipTracksByBoneNames` 纯骨名重映射。
- SMPL 关节 → 归一骨名的语义映射表随 `humanoidRig3d` 维护，作为唯一映射来源。

### 6.2 导演台消费

- 产物入库后即可像外部动作一样拖到骨骼轨；亦提供「生成即挂载」：自动追加 `DirectorSkeletonClipSegment`（`assetId` + `clip` + `loop` + `speed`）到当前选中角色的轨道。
- 播放复用 `ensureRetargetedClip`（`retargetedClipCache` 以 `assetId|objectId|clipName` 为键）与 `applySkeletonAnimationsAtTime`，不新增播放路径。
- 「重抽」交互：同 prompt 换 `seed` 出多条候选（`out-all`），挑一条入库，其余落 `Cache` 不入库（与 `asset.model3d` 的 in-model 端口口径一致）。

### 6.3 资产库预览

- `ModelPreview.vue` 扩展动画播放：对 `modelKind:'animation'` 的资产读 clip 列表 + `genParams.motion` 元数据，显示时长 / 帧率 / 提示词并支持播放 / 循环 / 拖动进度。

### 6.4 节点图 / MCP / 技能

- 节点：`asset.motion3d`「3D 动作生成」——入参文本、时长、可选姿态（姿态资产端口）、seed、fps、后端；输出动作资产（`out` 单条 / `out-all` 多候选，遵循既有端口类型严格相等与单复数不互通规则）。
- MCP：`generate_motion`（文本 → 动作资产）；可选 `motion_retarget`（动作资产 → 目标角色可用动作资产）。
- 技能：新增「3D 动作」技能，约定「按分镜文案生成 → 挑候选 → 挂骨骼轨 → 调时长 / 循环」的标准流程，供 Agent 编排。

### 6.5 导出

- GLB 动画导出属 P1「3D 闭环」职责。本节只约定契约：生成的动作资产本身就是「仅骨骼 + 动画 GLB」，导出侧无需为「生成动作」做特判。

---

## 7. 合规与风险

| 项                                    | 情况                                                                  | 应对                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| MoMask 代码                           | MIT                                                                   | 可直接借鉴 / 移植；保留出处与论文引用                                                  |
| SMPL / SMPL-X / PyTorch3D             | 各自独立许可（SMPL 系列历来为非商用许可，**须以其官方最新条款为准**） | 不随包内置 SMPL 模型文件；本项目只消费关节旋转 / 位置**数值**，不输出 SMPL 网格        |
| HumanML3D / KIT-ML 数据集与预训练权重 | 数据集许可独立；权重再分发条款需逐项确认                              | 权重按需下载、不随包内置；设置页明示来源与许可，由用户确认后获取                       |
| CLIP 文本编码器                       | OpenAI CLIP 代码 MIT，权重条款需确认                                  | 与权重同策略：按需获取、明示来源                                                       |
| 体积与性能                            | onnxruntime 已在包内；动作权重另计；CPU 推理有耗时                    | 权重按需下载；CPU 优先，UI 给进度与耗时预期，不做「秒出」承诺                          |
| 生成质量边界                          | 时长需外部给定、根旋转类动作为弱项、多样性受限、脚部 IK 不稳定        | 长度自动预测 + 重抽；弱项在 UI 与文档明说；脚部接触用位置分量做本地校正而非依赖官方 IK |
| 外部流程依赖                          | 官方示例用 Blender + Mixamo + `keemap.rig.transfer` 做重定向          | 不引入该流程；重定向一律走项目内 `retargetClipToCharacter`                             |

---

## 8. 分阶段实施

| 阶段             | 内容                                                                                                     | 退出条件                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0 可行性验证     | sidecar 跑通官方生成 → 取关节旋转 / 位置 → 装配 `humanoidRig3d` AnimationClip → GLB → 导演台播放与重定向 | 一段描述生成的动作能在导演台角色上循环播放，目视无明显穿模 / 滑步    |
| 1 链路打通       | `MotionService` + IPC + 节点卡 + 资产落盘 + 导演台消费 + 资产库预览 + MCP `generate_motion`              | 节点出动作 → 自动入库 → 挂骨骼轨播放闭环；外部 Agent 可调            |
| 2 本地化         | ONNX 导出 + TS 侧采样循环 + worker 承载 + 模型目录 / 设置页                                              | 断网可用；与 sidecar 路径逐帧数值对拍在容差内                        |
| 3 姿态条件与编辑 | 首段姿态条件、时间 in-painting（续写 / 插值 / 补全）、时长自动预测、闭环尾帧                             | 以现有姿势为首帧续写动作；指定区间重排且区间外动作不变               |
| 4 延伸           | 从视频生成 3D 动作（对称 5.5）、动作混合与过渡、动作语义检索                                             | 视频 → 3D 动作入库可用；两段动作可无缝拼接；动作可按语义被检索与复用 |

---

## 9. 验收口径

**主验收**（与 Roadmap 一致）：一段动作描述（如「拔剑挥砍」）3 分钟内产出可在导演台 / 3D 资产上循环播放的动作，并导出 GLB 动画。

**细分验收**：

1. 文本生成：给定描述与时长，产出动作资产的骨骼层级与目标角色语义匹配（归一骨名命中率 100%，未命中关节保持 bind 不产生扭曲）。
2. 重定向：同一动作挂到 ≥2 个不同来源的角色（Mixamo 骨架 / 非标准骨架）均可播放，髋部不漂移、脚不悬空。
3. 姿态条件：以姿态资产或 YOLO 反解姿势为首帧，生成动作首帧与条件姿态在阈值内一致。
4. 编辑：对已生成动作指定区间重排 / 补全后，区间外帧逐帧一致。
5. 资产化：产物为「仅骨骼 + 动画 GLB」，`genParams.motion` 元数据完整，可被 `DirectorSkeletonClipSegment` 引用并在重开后恢复。
6. 离线：本地模型就绪时全程断网可生成（阶段 2 起）。

---

## 10. 与 Roadmap 的映射

| Roadmap 条目                     | 本规划对应                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| P1「3D 动作生成（MoMask）」      | 全文（§4 解码 / §5 推理接入 / §6 重定向与消费）                                    |
| P1「3D 闭环」                    | §6.5 导出契约、§2 骨骼链路依赖                                                     |
| 5.3「姿态进导演台」              | §4.2 自根向下解算复用、§4.3 姿态条件契约                                           |
| 5.5「2D 导演台」                 | §4.2 `humanoidRig3d` 与 `stage2dHumanoid` 对称、§8 阶段 4 与「从视频生成动作」对称 |
| 5.4 / 5.5 动作资产（`motion2d`） | §4.3 元数据契约风格对齐（`schemaVersion` + 只增字段）                              |
| P1「资产语义检索」               | §8 阶段 4 动作语义检索（复用 `genParams.motion` 作为检索语料）                     |
