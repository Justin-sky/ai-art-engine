# 本地视觉（ONNX / YOLO / FaceMesh / SAM 2.1）与跨平台离线 OCR 架构（v9.0.0）

> 将目标检测、实例分割、17 点人体姿态、468 点人脸网格、SAM 2.1 交互式点框分割、高精度 Alpha 抠图，以及零依赖原生系统离线 OCR 以 **Local-First** 方式集成进桌面端：数据不出本机、零云端调用成本，同时通过 IPC 与 MCP 工具（`vision_local_ocr` / `vision_local_yolo`）向全工作区节点与 AI Agent 开放。

---

## 1. 能力全景与边界

### 1.1 已落地的七大本地视觉与识别支柱

1. **YOLO11 目标检测 / 实例分割 / 17 点人体姿态**（`detect` / `segment` / `pose`，随包内置开箱即用）。
2. **`stage.2d` 辅助 2D 人形立绘自动绑骨**（`src/shared/gameAssets/stage2dHumanoid.ts`）：融合 `YOLOv8/YOLO11-Pose` COCO-17 关键点与 2–8 头身二次元/Q 版 Alpha 剪影形态学，自动剔除透明区幻觉点、吸附不透明像素并修正正立绘解剖学左右手脚翻转。
3. **两段式 BlazeFace + MediaPipe 468 点 FaceMesh 人脸网格**（`src/main/yolo/faceInfer.ts`、`src/shared/faceMesh.ts`，随包内置）：映射为 `canonical-68` 关键点，驱动 `image.portrait`（4 频段小波实时精修 + 云端重绘回贴）的面部区域门禁、Procrustes 身份锁与羽化蒙版。
4. **SAM 2.1（Segment Anything 2.1）交互式点/框分割**（`src/main/yolo/sam2Infer.ts`、`src/shared/sam2Catalog.ts`）：支持正负点击点（`points`）与矩形框（`box`）提示词实时解码掩码，内置 6 槽位图像 Embedding LRU 缓存，点选交互毫秒级响应。
5. **高精度边缘 Alpha 抠图精修（Matting）**（`src/main/yolo/mattingInfer.ts`、`src/shared/mattingCatalog.ts`）：支持 `BiRefNet-Lite`、`RMBG-1.4`（FP16 / Q8）与 `MODNet`，可在分割抠图与 UI 拆层时替换粗糙掩码，保留发丝与半透明边缘。
6. **跨平台原生 OS 离线 OCR**（`src/main/services/localOcrService.ts`）：调用 Windows `Windows.Media.Ocr`、macOS Apple `Vision.framework`、Linux `tesseract`，零原生 NPM 依赖完成词级坐标检测、同行聚类与文字主色/描边双采样。
7. **MCP 标准工具直通**（`src/main/services/mcpServerService.ts`）：通过 `vision_local_ocr` 与 `vision_local_yolo` 直接向内置进程内 Pi Agent（`src/main/agent/`，归属 `skills_web_vision` 工具包并支持意图预热）与外部 Claude / Cursor / Codex Agent 暴露全部本地视觉能力。

### 1.2 架构边界

- **不做本地模型训练 / 微调**：端侧专注低延迟推理；自定义 `.onnx` 权重可放入本地模型目录即放即用。
- **进程级崩溃与阻塞隔离**：全部 ONNX 原生推理运行于 Electron `utilityProcess` 独立子进程（`src/main/yolo/yoloWorker.ts`），绝不阻塞主进程事件循环或拖垮渲染层。

---

## 2. 架构总览与硬件加速管线

```
┌────────────────────────────────────┐      ┌──────────────────────────────────────────┐
│  Renderer / AI Agent               │      │  Main Process                            │
│  • features/yolo/api.ts            │ IPC  │  • ipc.ts (`yolo:*` / `ocr:*`)           │
│  • MCP `vision_local_yolo`         │─────▶│  • mcpServerService.ts                   │
│  • MCP `vision_local_ocr`          │      │  • yoloService.ts / yoloModelManager.ts  │
└────────────────────────────────────┘      │  • localOcrService.ts (WinRT/Vision/CLI) │
                                            └───────────────────┬──────────────────────┘
                                                                │ utilityProcess.fork()
                                                                ▼
                                            ┌──────────────────────────────────────────┐
                                            │  YoloWorker (src/main/yolo/yoloWorker.ts)│
                                            │  ├ ortSession.ts (CUDA→DML→CoreML→CPU)   │
                                            │  ├ imageDecoder.ts + WebP Raw 容错兜底   │
                                            │  ├ preprocess.ts / postprocess.ts (YOLO) │
                                            │  ├ faceInfer.ts (BlazeFace + 468点网格)  │
                                            │  ├ sam2Infer.ts (Encoder LRU + Decoder)  │
                                            │  └ mattingInfer.ts (BiRefNet/RMBG/MODNet)│
                                            └──────────────────────────────────────────┘
```

### 2.1 GPU 硬件加速自动探测与无感回退（`src/main/yolo/ortSession.ts`）

创建 `onnxruntime-node` `InferenceSession` 时，`createAcceleratedSession()` 按以下优先级自动探测可用 Execution Provider：

1. **`cuda`**（NVIDIA CUDA，Linux / Windows）
2. **`dml`**（DirectML，Windows 10/11 原生 D3D12，兼容 NVIDIA / AMD / Intel 核显与独显；自动设置 `enableMemPattern: false` 与 `executionMode: 'sequential'` 规避驱动兼容故障）
3. **`coreml`**（Apple Silicon / macOS ANE & GPU）
4. **`cpu`**（跨平台兜底，开启图级别全优化 `graphOptimizationLevel: 'all'`）

若高优先级硬件后端因驱动缺失或算子不支持初始化失败，会话加载器会**自动回退至 `cpu`** 并记录实际生效的 `activeBackend`（可通过 `yolo:status` 或 `vision_local_yolo({ task: "status" })` 查询），确保任何机器上永不因显卡环境差异报错中断。

---

## 3. 核心模块清单

| 文件路径                                                    | 职责说明                                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/localModelLayout.ts`                            | 统一本地模型根目录 `<userData>/local-models/{yolo,face,sam2,matting,whisper}` 路径约定                                               |
| `src/main/yolo/localModelMigrate.ts`                        | 启动时自动将历史旧目录 `<userData>/yolo-models` 无损迁移至新版分层结构                                                               |
| `src/shared/yolo.ts`                                        | 任务契约（`detect` / `segment` / `pose` / `face` / `sam2`）、输入三形态（`file / dataUrl / raw`）、COCO 标签与阈值常量               |
| `src/shared/yoloCatalog.ts`、`src/shared/yoloFaceModels.ts` | YOLO11 与人脸两段式模型的元数据、SHA-256 校验值与匹配规则                                                                            |
| `src/shared/sam2Catalog.ts`、`src/shared/mattingCatalog.ts` | SAM 2.1 四档规格（`tiny / small / base_plus / large`）与抠图模型（BiRefNet / RMBG / MODNet）目录                                     |
| `src/main/yolo/yoloModelManager.ts`                         | 内置安全模型下载器：主机白名单校验（GitHub Releases / Hugging Face）、断点续传、SHA-256 与最小字节数校验、ZIP 解包（`sam2Unzip.ts`） |
| `src/main/yolo/yoloService.ts`                              | `utilityProcess` 生命周期守护、随包模型同步（`.bundled-models.json` 防删后复活）、请求路由与相对工程路径解析                         |
| `src/main/yolo/yoloWorker.ts`                               | Worker 进程主循环：会话缓存管理、任务分发与退出时资源释放                                                                            |
| `src/main/yolo/ortSession.ts`                               | `CUDA → DirectML → CoreML → CPU` 硬件加速探测与自动降级封装                                                                          |
| `src/main/yolo/imageDecoder.ts`                             | 纯 JS PNG/JPEG 解码（放宽至 4096MB / 160MP 兼容高像素相机原图，同时拦截解压炸弹）                                                    |
| `src/main/yolo/faceInfer.ts`、`src/shared/faceMesh.ts`      | BlazeFace（`128×128`）检测 + FaceMesh（`192×192` → 468 点 → `canonical-68`）两段式推理与几何映射                                     |
| `src/main/yolo/sam2Infer.ts`                                | SAM 2.1 双会话（Image Encoder + Mask Decoder）推理与 6 帧图像特征 LRU 缓存                                                           |
| `src/main/yolo/mattingInfer.ts`                             | 高精度前景 Alpha 推理与原图尺寸双线性还原                                                                                            |
| `src/main/services/localOcrService.ts`                      | Windows / macOS / Linux 原生系统离线 OCR 引擎与 TSV/WinRT/Vision 词框解析                                                            |
| `src/shared/graph/uiControlSpec.ts`                         | OCR 同行词聚类、父子控件排他匹配与字芯/描边自适应双色采样                                                                            |
| `src/shared/gameAssets/stage2dHumanoid.ts`                  | `stage.2d` 立绘 Alpha 剪影形态学 + YOLO-Pose 17 点混合 2D 骨骼求解器                                                                 |
| `src/renderer/src/features/yolo/api.ts`                     | 渲染层 IPC 薄封装与伪装扩展名 WebP 的 Chromium Canvas → `raw` 自动容错重试                                                           |

---

## 4. 本地模型目录与随包/按需分发机制

### 4.1 统一目录布局（`<userData>/local-models/`）

应用统一在 `<userData>/local-models/` 下按职责分子目录存放本地权重（`src/shared/localModelLayout.ts`）：

- `yolo/`：`yolo11n.onnx`（检测）、`yolo11n-seg.onnx`（实例分割）、`yolo11n-pose.onnx`（17 点姿态）及用户扩展的 `yolo11s/m/l` 权重。
- `face/`：`face-detect.onnx`（BlazeFace 短距检测器）与 `face-landmark.onnx`（MediaPipe 468 点网格）。
- `sam2/`：`sam2.1_hiera_{tiny,small,base_plus,large}.{encoder,decoder}.onnx` 双文件组。
- `matting/`：`birefnet-lite.onnx`、`rmbg-1.4.onnx`、`rmbg-1.4-q8.onnx`、`modnet.onnx`。
- `whisper/`：本地离线语音转写模型目录（与音频管线共享同一套本地模型根路径）。

### 4.2 五份随包内置模型（离线零下载开箱即用）

安装包内 `resources/yolo-models/` 与 `resources/face-models/` 已随仓库内置 5 份核心轻量模型（合计约 35MB，打包前由 `npm run check:pack` 与 `tests/bundledModelFiles.test.ts` 校验完整性）：

| 目录                     | 模型文件                                                | 默认能力                                           |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------- |
| `resources/yolo-models/` | `yolo11n.onnx`、`yolo11n-seg.onnx`、`yolo11n-pose.onnx` | 目标检测、实例分割抠图、17 点人体姿态              |
| `resources/face-models/` | `face-detect.onnx`、`face-landmark.onnx`                | 人脸检测 + 468 点三维语义网格（转 `canonical-68`） |

首次启动时 `YoloService.ensureBundledModels()` 将缺失模型同步至 `<userData>/local-models/{yolo,face}` 并记录在 `.bundled-models.json`；用户手动删除某模型后不会在重启时强制“复活”，亦可在「设置 → 本地模型」面板（`YoloModelsPanel.vue`）随时一键重装或按需下载更高精度的 SAM 2.1 / Matting 扩展包。

> **许可证提示**：Ultralytics YOLO11 官方权重采用 **AGPL-3.0** 许可，MediaPipe FaceMesh / BlazeFace 衍生模型采用 **Apache-2.0**，SAM 2.1 采用 **Apache-2.0**；商业闭源分发前请结合业务形态核对各模型条目在 `yoloCatalog.ts` / `mattingCatalog.ts` 中标注的上游许可证。

---

## 5. MCP 工具直通契约（`vision_local_ocr` & `vision_local_yolo`）

主进程 `src/main/services/mcpServerService.ts` 将本地视觉与离线 OCR 直接封装为标准 MCP 工具，供内置对话助手与外部 IDE / CLI Agent 零成本调用：

| MCP 工具名          | 核心入参                                                                                                                                                                                              | 返回结构与典型用途                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vision_local_ocr`  | `assetId` 或 `relativePath`                                                                                                                                                                           | 调用 `localOcrService.ts` 对工程内图片执行离线文字识别，返回 `{ assetId, relativePath, count, fullText, boxes }`（含每处文字的归一化 `x, y, w, h` 框），适合 UI 截图抄录、分镜台词提取、海报错别字质检                                                                    |
| `vision_local_yolo` | `task: 'status' \| 'detect' \| 'segment' \| 'pose' \| 'face' \| 'sam2'`，`assetId` / `relativePath`，可选 `confThreshold`、`iouThreshold`、`classes`、`useMatting`、`points`、`box`、`saveCutoutPath` | `status` 查询本地模型与 GPU 后端就绪态；`detect` 返回目标框与类别；`segment`（可配 `useMatting: true` 启用高精度发丝抠图并写入 `saveCutoutPath`）；`pose` 返回 COCO-17 骨骼关键点；`face` 返回 468→68 点人脸地标；`sam2` 按 `points`（正负点）与 `box` 执行交互式精确分割 |

---

## 6. 核心业务场景深度接线

### 6.1 `stage.2d`：YOLOv8/11-Pose 辅助 2D 立绘骨骼自动对齐（`stage2dHumanoid.ts`）

在 2D Spine 骨骼动画舞台（`stage.2d`）中，二次元立绘与 Q 版角色（2–8 头身）直接套用真人比例模板往往导致肩髋错位。`solveHumanoidSkeletonFromRgba()` 采用**「Alpha 剪影形态学 + 本地 YOLO-Pose 17 点先验」双模融合**：

1. **剪影头身比自适应**：逐行扫描不透明像素包络，定位头顶、颈部最窄处（锁骨线）、躯干收腰与双腿分叉点，自动适配 2 头身 Q 版到 8 头身写实立绘。
2. **YOLO-Pose 关键点约束与异常过滤**：调用本地 `yolo:pose` 提取肩、肘、腕、髋、膝、踝 17 个关键点；自动剔除落在透明背景外的幻觉点，并将靠近边缘的关节点向内吸附至最近的不透明像素（`snapInsideOpaque`）。
3. **正立绘解剖学左右翻转校正**：COCO 关键点定义的是角色自身的解剖学左/右（面朝镜头时解剖学左肩在画面右侧），求解器自动对齐至 `stage.2d` 画布左/右骨骼槽位（`L_clavicle` / `R_clavicle` 等），生成的 2D 骨架可直接用于自动拆件蒙皮并通过 `stage2d_spine_export` 导出 Spine 4.1 标准资产。

### 6.2 `image.portrait`：468 点 FaceMesh 驱动 4 频段小波精修与 AI 局部回贴

人像精修工作台（`image.portrait`，详见 [PORTRAIT.md](./PORTRAIT.md)）同时服务于**本地 60fps 实时像素管线**（`src/shared/graph/portraitLiveMath.ts`）与**云端图像大模型重绘**：

- **两段式人脸检测与网格提取**：`faceInfer.ts` 先以 BlazeFace（`128×128`）定位人脸框并外扩旋转裁剪，再经 FaceMesh（`192×192`）回归 468 个三维语义点并映射为归一化 `canonical-68` 地标（`src/shared/faceMesh.ts`、`src/shared/graph/portraitFace.ts`）。
- **4 频段小波皮肤分离与面部液化**：本地实时引擎基于 68 点语义多边形（脸缘、眼、眉、唇、鼻）构建羽化保护掩码，执行 4 频段小波磨皮（保留毛孔高频纹理、平滑中频瑕疵）、瘦脸大眼液化位移场（`buildFaceLiquifyControlVectors`）、`.cube` 3D LUT 调色与证件照智能裁切排版。
- **提示词门禁与 Procrustes 身份回贴锁**：走云端模型精修时，若未检测到人脸则自动屏蔽五官/妆容提示词防止幻觉改图；出图后结合人脸 + 颈部羽化蒙版与分割人物蒙版（`yolo:segment`）局部回贴原图，确保只改请求部位、背景与无关区域像素级零漂移。

### 6.3 SAM 2.1 交互式点/框分割与高精度 Matting

- **SAM 2.1 双阶段缓存架构（`src/main/yolo/sam2Infer.ts`）**：首次在一张图上点击时运行重量级 Image Encoder 提取特征并存入 6 槽位 SHA-256 LRU 缓存；后续增删正负提示点或拖拽框选仅运行轻量 Mask Decoder，实现交互式局部重绘选区、道具拆件与漫剧分镜抠图。
- **Matting 边缘精修（`src/main/yolo/mattingInfer.ts`）**：当用户安装 `BiRefNet-Lite`、`RMBG-1.4` 或 `MODNet` 后，抠图节点与 `vision_local_yolo` 可开启 `useMatting: true`，输出 `0..255` 连续 Alpha 通道，解决毛发、婚纱薄纱与发光特效边缘锯齿问题。

---

## 7. 跨平台原生系统离线 OCR 与伪装 WebP 容错

在游戏 UI 16 类控件拆分（`image.layerSplit` 的 `ui` 模式）及 MCP `vision_local_ocr` 中，系统通过 `src/main/services/localOcrService.ts`（IPC `ocr:recognize-local`）调用操作系统原生 OCR 能力，**零外部原生 NPM 依赖、零额外安装包体积**：

| 操作系统    | 原生离线引擎                                        | 运行机制与特点                                                                                                                                   |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Windows** | `Windows.Media.Ocr.OcrEngine` (WinRT)               | 通过内置脚本调用 Windows 10/11 系统 WinRT OCR API（`TryCreateFromUserProfileLanguages()`），原生输出行文本及每个词的精确 `(X, Y, Width, Height)` |
| **macOS**   | Apple `Vision.framework` (`VNRecognizeTextRequest`) | 首次调用自动通过 `/usr/bin/swiftc` 将内置 Swift 桥接脚本编译至临时目录缓存，启用 `.accurate` 精度档与中/英/日/韩自动语言识别                     |
| **Linux**   | 系统 `tesseract` CLI（`--psm 11 ... tsv`）          | 自动探测已装语言包并解析 TSV 词级坐标（`parseTesseractTsvToOcrLines`）；未装 `tesseract` 时优雅返回空结果，绝不抛错中断拆层流水线                |

### 词级聚类、控件排他回填与伪装 WebP 兜底

1. **同行邻近词聚类（`clusterOcrLineWordsIntoBoxes` in `src/shared/graph/uiControlSpec.ts`）**：合并同行间距不超过字高 `1.35×` 的相邻词框（CJK 字符零空格拼接，西文单词保留空格），产出紧致归一化 `LocalOcrTextBox`。
2. **父子控件排他匹配（`matchOcrBoxesToControlRect`）**：将文字框分配给 16 类游戏 UI 控件时，自动剔除已被子控件（如弹窗内的按钮）认领的文字，杜绝父容器面板重复吞字。
3. **字芯与描边双采样（`estimateUiControlTextStyleFromRgba`）**：自适应区分背景、文字主色与 1px 描边色，直接生成 Photoshop 原生可编辑 `TySh` 文本层（`src/renderer/src/features/graph/model/layerSplitPsd.ts`）及 `ui.atlasCompose` 多引擎导出元数据。
4. **伪装后缀 WebP 自动容错（`src/renderer/src/features/yolo/api.ts`）**：遇到后缀为 `.png` / `.jpg` 但实际魔数为 `RIFF....WEBP` 的素材时，自动回退至渲染层 Chromium 原生解码转为 `YoloImageInputRaw` 重试，彻底消除解码报错。

---

## 8. 开发验证与回归测试

相关自动化单测（运行 `npm test`）：

- `tests/ortSession.test.ts` — GPU Execution Provider（CUDA / DirectML / CoreML）优先级探测与 CPU 自动回退
- `tests/localModelMigrate.test.ts`、`tests/bundledModelFiles.test.ts` — 模型目录迁移与随包 `.onnx` 体积/完整性门禁
- `tests/yoloCatalog.test.ts`、`tests/yoloCutout.test.ts`、`tests/imageDecoderJpegLimits.test.ts` — YOLO 目录、抠图合成与大图解码边界
- `tests/faceMesh.test.ts`、`tests/yoloFaceModels.test.ts`、`tests/portraitFaceWiring.test.ts`、`tests/portraitLiveEngine.test.ts` — BlazeFace 锚点、468→68 映射与 4 频段小波人像管线
- `tests/sam2Catalog.test.ts`、`tests/sam2Unzip.test.ts`、`tests/mattingCatalog.test.ts` — SAM 2.1 与高精度抠图模型目录及解包校验
- `tests/stage2dPoseSolve.test.ts`、`tests/stage2dAutoPart.test.ts` — 2D 立绘 YOLO-Pose + Alpha 剪影骨骼求解与自动拆件
- `tests/uiComponentLibrarySplit.test.ts`、`tests/uiPreciseSplit.test.ts`、`tests/uiAtlasCompose.test.ts` — 离线 OCR 控件文字回填、九宫格识别与 UI 图集组装
