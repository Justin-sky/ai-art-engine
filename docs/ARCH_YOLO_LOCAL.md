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

| 通道                  | 说明                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `yolo:status`         | worker 就绪 / ort 版本 / 后端 / 模型清单 / 错误                             |
| `yolo:detect`         | 目标检测，返回 `YoloDetectResult`                                           |
| `yolo:segment`        | 实例分割，返回 boxes + 160×160 二值 mask                                    |
| `yolo:pose`           | 姿态估计，返回 boxes + COCO 17 关键点                                       |
| `yolo:face`           | 人脸关键点：两段式（BlazeFace + FaceMesh），返回 468 点 + canonical-68 映射 |
| `yolo:open-model-dir` | 打开模型目录（系统文件管理器）                                              |

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

| 能力              | 现状                   | 用途                                                     | 缺失时的降级                                                                    |
| ----------------- | ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `segment` 主体    | 已内置可跑             | 背景虚化 / 换底色 / 证件照换底 / 边缘去杂边              | 背景与证件照换底整组跳过（不动背景，不猜蒙版）                                  |
| `pose` 姿态       | 已内置可跑             | 身形（瘦身 / 收腰 / 提臀 / 瘦手臂 / 美肩 / 美颈 / 长腿） | 身形整组跳过                                                                    |
| `face` 人脸关键点 | **随包内置**，开箱可用 | 五官微调 / 液化定点 / 妆容 / 牙齿 / 证件照头肩裁切       | 编辑器提供「手动人脸锚点」（标 5 点拟合 68 点），五官与妆容功能不残，仅精度下降 |

`face` 两段式（BlazeFace short-range 检测器 + MediaPipe FaceMesh 468 点）：
模型文件名即模型 id（`face-detect.onnx` / `face-landmark.onnx`），放进模型目录即被识别。

**托管与分发方式**：这两个模型来自另一套上游，上游没有可长期固定的直链，因此由
**本仓 GitHub Release**（tag 固定为 `face-models-v1`）分发，地址写在 `@shared/yoloCatalog`
的 `YOLO_FACE_CATALOG_BASE_URL`。同一份资产有两条通路：

1. **随包内置（默认路径）**：`npm run fetch:yolo-models` 在构建期把它拉进
   `resources/yolo-models/`，随安装包分发；用户首次启动时 `YoloService.ensureBundledModels()`
   会把内置的 .onnx 拷进模型目录 —— 开箱即用、无需联网。打包前
   `npm run check:pack` 会**硬失败**在缺失的人脸模型上（逐文件给下限：Ultralytics 那批 1MB、
   人脸两个 256KB，人脸检测器比 YOLO 小一个量级，统一门槛会误判），避免安装包悄悄少东西。
2. **兜底下载**：用户删掉了内置副本时，设置页仍可按需下载（走 `yolo:model-download`）。

下载链路的两个安全点：

- 渲染层把最终地址作为可选的 `sourceUrl` 传下来（tag 变了不必重新打包），主进程按
  **主机白名单**（`@shared/yoloDownload`：github.com 及其资产重定向域名）校验，
  避免变成任意 URL 下载器；
- 目录条目声明了 `sha256` 就**必须校验通过**才落盘（`minBytes` 按条目给值）。

**发布流程**（上传资产 + 生成要填的哈希）：

```bash
node scripts/sync-face-models.mjs --dir <含两个 onnx 的目录>          # 算 sha256，打印可粘贴的条目
node scripts/sync-face-models.mjs --dir <目录> --upload              # 用 gh CLI 建 release 并上传
```

脚本按约定名找文件（认不出时退化为名字特征匹配，与主进程 `pickFaceModel` 同一套口径），
输出 `RAW_FACE_ENTRIES` 里可直接粘贴的 `{ id, approxMb, minBytes, sha256 }`。
上传完成后 `npm run fetch:yolo-models` 才能拉到这两个文件并一起打进安装包。

### ⚠️ 待解决：转换出来的两个模型还不能入库（实测记录）

2026-10 用官方 MediaPipe 权重 + `scripts/convert-face-models.py` 实测：**转换管线通了，
但两个模型都还不能用**。留档避免重复踩坑：

1. **转换器选型（已解决，已写进脚本）**
   `tflite2onnx 0.4.1` 处理不了 MediaPipe 的量化权重（自身警告 float16 不支持），转出来的图
   **形状完全正确但回归量纲整体偏小**：人脸框缩到约 1/4、置信度 0.81 → 0.67，且不报错 ——
   这正是「五官 / 妆容静默失效」的典型来源。换 `tf2onnx --tflite`（+ tensorflow）后保真度
   已核对：同一输入下与 TFLite 解释器原始输出 `max |Δ| < 1e-4`。

2. **锚点边长 bug（已修，`shared/faceMesh.ts`）**
   `fixedAnchorSize` 下锚点的归一化宽高必须是 **1.0**（scale 只用于插值锚）；原实现填了
   `scale`，而解码是 `raw / 128 * anchor.w`，等于把 scale 乘两遍 → 检测框只有应有值的
   1/4~1/5（实测 0.038 vs 应有的 0.169）。已改为 `w = h = 1`，`tests/faceMesh.test.ts` 同步更新。

3. **检测器锚点排列尚未对齐（阻塞）**
   修好锚点边长后，argmax 命中的锚点解出的框仍偏小（多张实测 0.03~0.12；MediaPipe 基准为
   0.165×0.247、置信度 0.807）。同一位置相邻两个锚点（固定锚 w=1 与插值锚 w≈0.23）解出的
   框相差 4 倍，说明**模型输出的锚点排列 / 层序与 `generateBlazeFaceAnchors()` 的顺序未对齐**。
   需要 MediaPipe 检测器的 cfg（anchor 生成参数 + 输出张量排列）才能定论。

4. **关键点输出约定不符（阻塞）**
   官方 `face_landmark.tflite`（192 输入 / 1404 输出，形状与契约一致）的输出是**像素量纲**
   （0~~192 范围），而 `faceInfer.ts` 按 0~~1 归一化处理再回投原图 → 468 点落点完全错。
   用 MediaPipe Tasks 的 `FaceLandmarker` 在同一裁剪上对照：它给 **478 点、0~1 归一化**。
   即：**契约（192 / 1404 / 0~1）与这个 tflite 的实际输出约定不一致**，需要 MIS 文档或
   `face_landmark_with_attention.tflite` 等其它档位来确认正确来源。

**验证入口**：`scripts/convert-face-models.py --verify-only <dir>` 只做形状自检；数值验收必须
跑真实人脸照并与 MediaPipe 参考值对照（上面的基准值可直接复用）。

接线口径（渲染层 `portraitQualityPreview.ts` 与 `features/graph/execute/portrait.ts`）：

- 主体蒙版经 `yoloSegment({ softMask: true })` + `buildCutoutAlpha`（`shared/yoloCutout.ts`）还原到工作分辨率；
- 姿态关键点经 `yoloPose` 取第一具骨架，按结果尺寸归一化（与分辨率无关）；
- 两者都包在 `tryLoad` 里：模型缺失 / 推理失败一律退化为 `null`，**不让整次烘焙失败**；
- 是否需要它们由参数决定（`needsSubjectMask` / `needsPose`）：只开磨皮调色时不跑任何模型。

### `face` 任务类型的实际接线（已实现）

1. `src/shared/yolo.ts`：`YoloTaskKind` 含 `'face'`，`YoloFaceResult` 内部统一成 **canonical-68** iBUG 顺序（索引约定见 `src/shared/graph/portraitFace.ts`）；
2. `src/main/yolo/faceInfer.ts`：两段式推理（张量装配 / 会话缓存 / 裁剪投影），纯数学在 `src/shared/faceMesh.ts`（有单测）；`protocol.ts` 的 `face` 方法收 `{ detectorPath, landmarkPath }`；
3. `src/main/yolo/{yoloWorker,yoloService}.ts`：worker 分发 `face` 并在退出时 `disposeFaceSessions()`；`kindOfModelId` 认得出人脸文件，`resolveFaceModelPath` 解析两段式路径；对外通道 `yolo:face`；
4. `src/shared/ipc.ts` + `src/preload/index.ts` + `src/main/ipc.ts` + `src/renderer/src/features/yolo/api.ts`：`yoloFace` 一路到渲染层；
5. `src/renderer/src/components/settings/YoloModelsPanel.vue` + 两套 locale：加「人脸关键点」档位（**只给放置引导，不编造下载源**）；
6. `src/renderer/src/features/graph/model/portraitBake.ts` 的 `detectPortraitFaces` 调 `yoloFace`，把结果转成 `PortraitFaceAnalysis`（`schema: 'canonical68'`，landmarks 归一化 0..1，box 由 `portraitFaceBoxFromLandmarks` 从关键点反推），按面积降序，失败 / 模型缺失返回 `[]`；
7. `tests/portraitFaceWiring.test.ts`：源码文本断言锁住上面这条链，防止被静默删掉。

### 区域蒙版：68 点多边形 → 468 点稠密环

`PortraitFaceAnalysis.regions`（可选）现在会带一份 **468 点语义稠密环**派生的区域多边形，唇线 / 眼 / 眉 / 脸缘 / 鼻因此贴合真实轮廓（妆容、牙齿、眼睛、磨皮都跟着变准）：

1. 来源：`src/shared/faceMesh.ts` 新增的 MediaPipe 规范连接集常量（`FACE_OVAL` / `FACE_LIPS_OUTER` / `FACE_LIPS_INNER` / `FACE_EYE_R|L` / `FACE_BROW_R|L` / `FACE_NOSE`）。这些常量**只保证「是哪些点」**，索引顺序不可靠，使用处一律按绕质心的极角重排成有序闭合环（`src/shared/graph/portraitFaceRegions.ts` 的 `orderRing` / `orderRingIndices`），脸缘再用 `splitRingAt` 按 127 → 152 → 365 切成下半脸与额头两段弧；
2. 产出：`faceOval`（下半脸，保持原语义，**不含额头**）/ `faceSkin`（**整圈**脸缘 36 点，只服务肤色蒙版）/ `forehead`（脸缘上半弧经 10，与 68 点眉高线闭合）/ 左右眼 / 左右眉 / `nose`（`FACE_NOSE ∪ {19, 94}`）/ `outerLip` / `innerLip` / `teeth`（内唇环向质心收缩）。区域清单只在 `portraitFace.ts` 的 `PORTRAIT_ALL_REGIONS` 里写一份，管线蒙版清单与编辑器调试叠加清单都从它派生；
3. **几何自检**：点数 ≥ 3、面积 > 0、且与同语义 68 点多边形面积比在 `[0.3, 4]`（`forehead` 的 68 点参照**有意**取 `faceOval` 多边形而非同区域矩形）。不合格就**不产出该区域**，下游 `portraitRegionPolygon` 照常回落 —— 索引表写错时的表现是「少一个区域」，而不是「静默错蒙版」；
4. `PORTRAIT_FACES_VERSION` 提到 **2**：老缓存里没有 `regions`，执行器 `readCachedFaces` 除 `sourceHash` 外还校验版本，版本不符立刻重新检测（否则用户得等到换图才升级到稠密蒙版）；
5. 消费方 `renderPortrait`：区域蒙版优先取 `faces.regions`，并**与关键点一起过同一张变形网格**（瘦脸 / 液化后蒙版不会错位）；肤色蒙版在有稠密区域时用**整圈 `faceSkin`** 减五官（眼 ∪ 眉 ∪ 外唇 ∪ 鼻）的几何差集，拿不到稠密区域（手动 5 点锚点 / 模型缺失 / 自检丢弃）时保持 `buildSkinMask` 的 YCbCr 阈值。用整圈而不是 `faceOval ∪ forehead`：后者漏掉「眉线 → 耳位闭合弦」之间那条带（太阳穴 / 上颊 / 眼周），磨皮会漏一块皮肤；`faceOval` 仍是**下半脸**语义（`faceContour` 修容的轮廓带与去碎发都靠它，不能改成整脸），`forehead` 只给额头纹 / 高光用。

**仍缺**：模型的下载源（见下节许可闸门）。在此之前用户只能手动放置两个 ONNX。

**许可证闸门（必须先行确认）**：模型必须可商用、可再分发。候选：MediaPipe Face Mesh（Apache-2.0，需 TFLite→ONNX 转换并自测精度）、PIPNet 68/98 点（Apache-2.0）。**排除**：InsightFace `2d106det`（非商用研究许可）、YOLO11n-face 派生（AGPL-3.0，与包内 YOLO 同源但风险更高 —— 现有 YOLO 权重的 AGPL 风险见第 6 节末的许可提示）。确认后把仓库 URL、版本、许可证与 SHA-256 一并写进 fetch 脚本注释与本文件。
