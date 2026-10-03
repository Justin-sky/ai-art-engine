# 本地视觉（YOLO）基础架构

> 把 YOLO 目标检测 / 实例分割 / 姿态估计以 **Local-First** 方式集成进应用：
> ONNX 模型 + onnxruntime 本地 CPU 推理，数据不出机、无调用成本，与云端生成链路（模型提供商）互补。

## 1. 目标与边界

- **做什么**：提供 `detect` / `segment` / `pose` 三类本地视觉能力，作为后续功能（素材自动打标、智能构图、抠图、视频分镜解析、动捕）的底座。
- **不做什么**：
  - 不做训练 / 微调（模型由用户放入目录或随包分发）。
  - 不做 GPU 加速（CPU 优先；DML 预留扩展位）。
  - 不做模型内置下载器（模型文件由用户放置，文档给出建议来源）。

## 2. 架构总览

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│  Renderer                   │      │  Main                        │
│  features/yolo/api.ts       │ IPC  │  ipc.ts                      │
│  window.studio.yoloDetect() │─────▶│  └─ yoloService.ts           │
└─────────────────────────────┘      │       │ 管理生命周期/路由/模型│
                                     │       │ utilityProcess.fork   │
                                     └───────┼──────────────────────┘
                                             ▼
                             ┌──────────────────────────────┐
                             │  YoloWorker（独立 Node 进程） │
                             │  yoloWorker.ts               │
                             │  ├ imageDecoder.ts 纯JS解码  │
                             │  ├ preprocess.ts   letterbox │
                             │  ├ postprocess.ts  NMS/解析  │
                             │  └ onnxruntime-node（N-API） │
                             └──────────────────────────────┘
```

**进程隔离是关键决策**：推理是 CPU 密集任务，且 onnxruntime 是原生模块。把它放进
`utilityProcess` 独立进程，避免：阻塞主进程事件循环、原生模块崩溃拖垮整个应用、
污染主应用"纯 JS"约定。

## 3. 关键设计决策

| 决策                                             | 理由                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utilityProcess.fork()` 跑推理                   | Electron 官方推荐；崩溃隔离、可重启、不阻塞主进程；`process.parentPort` 提供消息通道                                                               |
| `onnxruntime-node`（N-API）                      | **无需 electron-rebuild**，符合项目 `npmRebuild:false` 约束；N-API 对 Electron ABI 稳定                                                            |
| 动态 `require('onnxruntime-node')`               | 包缺失时 worker 仍能启动并返回明确错误，而不是启动即崩                                                                                             |
| 纯 JS 解码（`jpeg-js` / `pngjs`）                | 保持"主应用纯 JS"约定，零原生依赖、零编译；WebP 走渲染层 canvas → raw 兜底                                                                         |
| JPEG 解码上限 4096MB / 160MP                     | jpeg-js 默认 512MB 是按「不可信内容」设的，实测约 21 字节/像素 → 30MP 出头就误伤相机原图；上限只放宽到「覆盖最大画幅」，解压炸弹仍由分辨率上限拒掉 |
| 输入三形态 `file / dataUrl / raw`                | file 适配资产库路径，dataUrl 通用，raw 适配渲染层 canvas（webp）                                                                                   |
| 模型目录 `<userData>/yolo-models`                | 用户可放置任意 YOLO ONNX；设置页可改目录；文件名推断任务类型                                                                                       |
| sigmoid 兼容 + 退化框过滤                        | 部分导出变体输出 logits（值 >1），检测后统一 sigmoid；面积≈0 的框直接丢弃                                                                          |
| `electron-builder` `asarUnpack` onnxruntime-node | `.node` 原生模块不能直接从 asar 内 dlopen，需解包到 `app.asar.unpacked`                                                                            |

## 4. 模块清单

| 文件                                    | 职责                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| `src/shared/yolo.ts`                    | 对外契约：任务类型、结果类型、输入三形态、COCO 标签、阈值常量         |
| `src/shared/ipc.ts`                     | IPC 通道（`yolo:*`）+ `StudioApi` 方法签名                            |
| `src/main/yolo/protocol.ts`             | 主进程 ↔ worker 的 JSON-RPC 风格消息协议                              |
| `src/main/yolo/yoloService.ts`          | worker 生命周期、请求路由（pending map）、模型扫描/选择、相对路径解析 |
| `src/main/yolo/yoloWorker.ts`           | worker 入口：消息循环、ort 加载、会话缓存、坐标逆映射                 |
| `src/main/yolo/imageDecoder.ts`         | PNG / JPEG 纯 JS 解码                                                 |
| `src/main/yolo/preprocess.ts`           | letterbox + RGBA → CHW float32 张量（填充 114/255）                   |
| `src/main/yolo/postprocess.ts`          | 输出解析、sigmoid 兼容、退化框过滤、类内 NMS、mask 合成               |
| `src/renderer/src/features/yolo/api.ts` | 渲染层薄封装 + dataUrl → raw 工具                                     |

## 5. 调用时序（以 detect 为例）

```
Renderer  yoloDetect({ image: { kind:'file', path: 'assets/a.png' }, confThreshold })
   │  ipcRenderer.invoke('yolo:detect')
   ▼
Main      yoloService.detect()
   │  ensureStarted() —— 首次懒启动 utilityProcess，ping 握手
   │  resolveModelPath('detect') —— 扫描模型目录选 .onnx
   │  resolveImageInput() —— 相对工程根路径 → 绝对路径
   │  call('infer', params) —— postMessage + pending map + 120s 超时
   ▼
Worker    decodeImage → rgbaToLetterboxTensor → InferenceSession.run
   │  parseYoloOutput（sigmoid 兼容 → 阈值过滤 → 退化框过滤 → NMS）
   │  toBox() 把 640 坐标逆映射回原图（scale / pad）
   ▼
Main      返回 YoloDetectResult 给 Renderer
```

## 6. 模型约定

### 随包内置（默认）

三个模型随应用分发，共约 33MB：

| 文件                | 任务    | 体积    | 覆盖能力             |
| ------------------- | ------- | ------- | -------------------- |
| `yolo11n.onnx`      | detect  | 10.4 MB | 打标 / 构图 / 分镜   |
| `yolo11n-seg.onnx`  | segment | 11.2 MB | 抠图 / 擦除重绘 mask |
| `yolo11n-pose.onnx` | pose    | 11.3 MB | 动捕 / 姿态          |

- 源位置：`resources/yolo-models/`；打包配置：`electron-builder.yml` → `extraResources: resources/yolo-models → yolo-models`（即安装目录下的 `resources/yolo-models`）。
- **同步策略**：应用启动时 `YoloService.ensureBundledModels()` 把内置模型拷贝到模型目录，规则为
  - 缺失的内置模型 → 安装；
  - 清单（`.bundled-models.json`）中已记录过的 → 不再重复落地，因此**用户主动删除后不会被"复活"**；
  - 后续新增的内置模型（升级版本）→ 只装新增的那些。
- 模型体积大，不进 git：`.gitignore` 忽略 `resources/yolo-models/*.onnx`，拉取命令 `npm run fetch:yolo-models`（`pack` / `dist` 会自动调用，本地已有模型时跳过）。

### 用户自定义

- 目录：`<userData>/yolo-models/`（`%APPDATA%\aiartengine\yolo-models`），设置项 `yolo.modelDir` 可覆盖。
- 文件名决定任务类型：含 `seg` → segment，含 `pose` → pose，否则 detect。
- 单任务多个模型时按大小选最大；也可用 `modelId` 显式指定。
- 许可提示：YOLOv8 / YOLO11 官方权重为 **AGPL-3.0**，随应用分发存在传染性风险，商用前请评估或替换为许可宽松的模型。

## 7. IPC 契约

| 通道                  | 说明                                            |
| --------------------- | ----------------------------------------------- |
| `yolo:status`         | worker 就绪 / ort 版本 / 后端 / 模型清单 / 错误 |
| `yolo:detect`         | 目标检测，返回 `YoloDetectResult`               |
| `yolo:segment`        | 实例分割，返回 boxes + 160×160 二值 mask        |
| `yolo:pose`           | 姿态估计，返回 boxes + COCO 17 关键点           |
| `yolo:open-model-dir` | 打开模型目录（系统文件管理器）                  |

## 8. 打包注意

- `electron-builder.yml`：`asarUnpack: node_modules/onnxruntime-node/**`（已配置）。
- `onnxruntime-node` 进依赖白名单（`dependencies`），`externalizeDepsPlugin` 保持外部 require。
- `electron.vite.config.ts` main 多入口：`index` + `yoloWorker` → 产物 `out/main/yoloWorker.js`，service 用 `join(__dirname, 'yoloWorker.js')` 定位（dev / prod 一致）。

## 9. 开发与验证

- 类型检查：`npm run typecheck:node`
- 冒烟：模拟 `process.parentPort` 直接加载 `out/main/yoloWorker.js`，发 `ping` / `status` / `infer`（bus.jpg + yolo11n.onnx 可验证端到端，预期 bus + 3~4 person）。
- 构建产物变更时先 `npm run build` 再冒烟。

## 10. 后续扩展位

- **DML 加速**：装 `onnxruntime-directml`，worker 增加 `executionProviders` 分支，设置加 `backend`。
- **真深度估计**：Depth Anything v2 ONNX 可复用同一 worker 通道（新增 `depth` 方法）。
- **视频分镜 / 打标 / 动捕**：基于 `detect` / `pose` 的上层管线（见 `PLAN_SPINE_YOLO.md` 5.4）。
- **模型下载器**：`yolo:install-model` 从 CDN 拉取模型（预留，本期未做）。
- **人脸关键点（`face` 任务类型）**：见下节，`image.portrait` 已按可插拔方式预留。

## 11. 人像处理节点（`image.portrait`）用到的本地视觉

`image.portrait` 是纯本地烘焙节点（不调图片模型），它把本地视觉能力当作**可选依赖**：

| 能力              | 现状               | 用途                                                     | 缺失时的降级                                                                    |
| ----------------- | ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `segment` 主体    | 已内置可跑         | 背景虚化 / 换底色 / 证件照换底 / 边缘去杂边              | 背景与证件照换底整组跳过（不动背景，不猜蒙版）                                  |
| `pose` 姿态       | 已内置可跑         | 身形（瘦身 / 收腰 / 提臀 / 瘦手臂 / 美肩 / 美颈 / 长腿） | 身形整组跳过                                                                    |
| `face` 人脸关键点 | **待接入**（见下） | 五官微调 / 液化定点 / 妆容 / 牙齿 / 证件照头肩裁切       | 编辑器提供「手动人脸锚点」（标 5 点拟合 68 点），五官与妆容功能不残，仅精度下降 |

接线口径（渲染层 `features/graph/model/portraitBake.ts`）：

- 主体蒙版经 `yoloSegment({ softMask: true })` + `buildCutoutAlpha`（`shared/yoloCutout.ts`）还原到工作分辨率；
- 姿态关键点经 `yoloPose` 取第一具骨架，按结果尺寸归一化（与分辨率无关）；
- 两者都包在 `tryLoad` 里：模型缺失 / 推理失败一律退化为 `null`，**不让整次烘焙失败**；
- 是否需要它们由参数决定（`needsSubjectMask` / `needsPose`）：只开磨皮调色时不跑任何模型。

### 接入 `face` 任务类型要改的地方（尚未实现）

1. `src/shared/yolo.ts`：`YoloTaskKind` 增 `'face'`，加 `YoloFaceResult`（内部统一成 **canonical-68** iBUG 顺序，见 `src/shared/graph/portraitFace.ts` 的索引约定）；
2. `src/main/yolo/postprocess.ts`：新增 face 输出解析（两种常见导出：`[1,N,3]` 直接回归 / `[1,N,5]` 热图 argmax），并把模型原生点数映射到 68 点；
3. `src/main/yolo/{yoloWorker,protocol,yoloService}.ts`：`kindOfModelId` 识别 `face` / `landmark` 文件名，新增 `yolo:face` 通道；
4. `src/shared/yoloCatalog.ts` + `src/renderer/src/components/settings/YoloModelsPanel.vue`：加「人脸关键点」档位与下载项；
5. `scripts/fetch-yolo-models.mjs`：**必须同时固定 URL 与 SHA-256**（该模型不在当前内置清单里，未固定就不要加入 `MODELS`，否则 `pack` / `dist` 会因下载失败整体失败）；
6. `src/renderer/src/features/graph/model/portraitBake.ts` 的 `detectPortraitFaces` 改为调用 `yolo:face`，把结果转成 `PortraitFaceAnalysis`（`schema: 'canonical68'`）。

**许可证闸门（必须先行确认）**：模型必须可商用、可再分发。候选：MediaPipe Face Mesh（Apache-2.0，需 TFLite→ONNX 转换并自测精度）、PIPNet 68/98 点（Apache-2.0）。**排除**：InsightFace `2d106det`（非商用研究许可）、YOLO11n-face 派生（AGPL-3.0，与包内 YOLO 同源但风险更高 —— 现有 YOLO 权重的 AGPL 风险见第 6 节末的许可提示）。确认后把仓库 URL、版本、许可证与 SHA-256 一并写进 fetch 脚本注释与本文件。
