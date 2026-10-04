# 人像节点本地视觉升级规划（开源 ONNX 路线）

> **状态：已废弃。**
> `image.portrait` 的内部实现已全部改为**调用图片模型**，不再有本地像素流水线：
> 参数是分段档位枚举（`src/shared/graph/portraitRetouch.ts`），执行器按参数合成提示词后调
> `ctx.generateImage`（`src/shared/graph/execute/portrait.ts`），本地只保留**局部回贴**的蒙版合成
> （`src/shared/graph/portraitScope.ts` + `portraitCapabilities.composePortraitScopedRetouch`）、
> 人脸关键点检测与证件照的纯几何裁切 / 拼版。
> `src/shared/media/portrait/*`（pipeline / kernels / mask / warp）与 `portraitFaceRegions.ts` 已删除；
> 依附它的区域多边形（`portraitRegionPolygon` / `PORTRAIT_ALL_REGIONS`）、五官 / 身形变形控制点与
> 手动 5 点拟合（`manual5ToCanonical68`）也已一并删除，需要时按
> [ARCH_YOLO_LOCAL.md](./ARCH_YOLO_LOCAL.md) §11 的口径重建。
> **当前实现见 [PORTRAIT.md](./PORTRAIT.md)**；本文仅作历史决策记录保留，
> 其中的 ONNX 本地能力清单（区域蒙版、融合、修复、超分、景深…）不再对应当前实现。
>
> 原始状态：草案。468 稠密区域实现中；人脸解析 / 抠像 / 景深 / 修复 / 超分待接入。
> 范围：`image.portrait` 节点的**本地**视觉能力。全部走开源 ONNX + 现有 `onnxruntime-node` 通道，
> **不调图片模型**；每个能力都是可选依赖，缺模型时该组工具跳过而不是报错。

---

## 1. 现状与缺口

- **人脸检测 + 关键点**：已接线（BlazeFace short-range + FaceMesh 468 → canonical-68），见 `src/main/yolo/faceInfer.ts`、`src/shared/faceMesh.ts`、`portraitBake.detectPortraitFaces`。缺模型时只能用手动 5 点锚点，五官 / 妆容精度下降。
- **区域蒙版**：68 点多边形，正在升级为 468 稠密环；见 `src/shared/graph/portraitFace.ts` 的 `portraitRegionPolygon` 与 `pipeline.ts` 的 `region()`。当前唇线 / 眼影 / 眉形边缘发虚，蒙版形状粗糙。
- **肤色蒙版**：`mask.ts` 的 `buildSkinMask` 走 YCbCr 阈值 + 开运算 + 羽化（有 468 区域后改为 `faceOval − 五官`）。现状问题是磨皮糊到背景 / 衣服，或漏掉额头与阴影里的皮肤。
- **主体 / 背景**：YOLO `segment` 软蒙版阈值化（`mask.ts` 的 `backgroundMaskFromSubject`）。发丝边缘有光晕，证件照换底有毛边。
- **身形 / 姿态**：YOLO `pose` 只有 COCO 17 点（`portraitFace.ts` 的 `buildBodyWarpControls`），驱动点太稀，瘦身 / 美肩 / 长腿不自然。
- **瑕疵修复**：`kernels.ts` 的 `healBlemishes` 是局部邻域混合，大痘印 / 杂物留痕，不是真 inpainting。
- **背景虚化**：主体蒙版二值化后统一高斯，前后景一刀切，缺少景深层次与高光散景。
- **清晰度 / 质感**：`unsharpMask` / `localContrast` / 降噪 / 颗粒 / 暗角（`kernels.ts`）。糊脸无法变清晰，低质人像无解。
- **光影**：全局提亮 / 压暗 + 明度加权，没有重光照，容易塑料感。

**结论**：目前所有「不好看」集中在三处 —— 蒙版边界（区域 + 肤色 + 主体）、几何驱动点太稀、缺少学习型增强。下面按「先蒙版、后几何、最后学习型」排优先级。

---

## 2. 候选模型（开源；许可为**待复核项**，接入前必须逐项确认）

- **人脸检测 + 468 点** —— BlazeFace short-range + MediaPipe FaceMesh，Apache-2.0，约 5 MB；契约：128² → 896×16 + 896×1，192² → 468×3。
- **人脸解析**（皮肤 / 唇 / 眼 / 眉 / 发 / 颈 / 衣 / 眼镜… 19 类）—— BiSeNet-R18（CelebAMask-HQ 训练），代码宽松但**训练权重许可需复核**（必要时自训 / 自转换），约 50 MB；契约：512² → 19×512²（argmax 得类别图）。
- **抠像 / matting** —— MODNet（轻，约 25 MB）或 BiRefNet（强，体积大）；MODNet 代码 Apache-2.0、**权重商用需确认**，BiRefNet 为 **MIT**；契约：512² → 单通道 alpha。
- **单目深度（景深）** —— Depth Anything V2 small，Apache-2.0（**权重档位需复核**），约 100 MB；契约：518² → 单通道相对深度。
- **姿态（身形驱动）** —— RTMPose / DWPose（mmpose），Apache-2.0，约 30–50 MB；契约：256² → COCO-WholeBody 133 点（含面部 68 + 双手）。
- **人脸修复 / 增强** —— GFPGAN，Apache-2.0（已有商用软件打包先例），约 350 MB，**只在烘焙跑**；契约：512² → 512²。
- **通用超分** —— Real-ESRGAN，**BSD-3-Clause**（最干净），约 64 MB；契约：任意 → ×2 / ×4。
- **修复填充** —— LaMa / MAT，代码宽松但**权重来源需复核**，约 200 MB；契约：512² + mask → 填充图。
- **重光照** —— IC-Light（许可随 SD 底座，需复核）或 3DMM 法线引导（纯算法、无模型可跑）。
- **❌ 排除** —— CodeFormer（S-Lab 非商用）、InsightFace `2d106det`（研究许可）、RMBG-2.0（CC-BY-NC）、YOLO-face 的 AGPL 派生。

> 许可闸门（与 `docs/ARCH_YOLO_LOCAL.md` 一致）：**必须可商用、可再分发**。确认后把仓库 URL、
> 版本、许可证与 SHA-256 一起写进 `scripts/fetch-yolo-models.mjs` 的注释与
> `src/shared/yoloCatalog.ts`；**未固定 URL + SHA-256 之前不进任何下载目录**，否则
> `npm run pack` 会因下载失败整体失败。
> 本地转换的模板见 `scripts/convert-face-models.py`（MediaPipe → ONNX + 形状自检 + 打印哈希）。

---

## 3. 接入方式（照 `face` 那条线的模板，逐层照抄）

每个新能力都要落这 7 处，缺一处就是「静默坏掉」：

1. `src/shared/yolo.ts`：`YoloTaskKind` 增值 + 结果类型 + 输入尺寸常量；
2. `src/main/yolo/<capability>Infer.ts`：张量装配 / 会话缓存 / 输出解析；纯数学抽到 `src/shared/`（可单测）；
3. `src/main/yolo/protocol.ts` + `yoloWorker.ts`：worker 方法与分发（退出时释放会话）；
4. `src/main/yolo/yoloService.ts`：`yolo:<capability>` 对外方法 + 模型解析（挑不到时报清缺什么）；
5. `src/shared/ipc.ts` + `src/main/ipc.ts` + `src/preload/index.ts` + `renderer/features/yolo/api.ts`：四层通道 + 薄壳；
6. `src/renderer/src/features/graph/model/portraitBake.ts`：把结果接进 `bakePortraitRetouch` 的输入（**失败一律降级为空，不抛**）；
7. `src/shared/media/portrait/pipeline.ts` 的消费点（见第 4 节）+ `settings/YoloModelsPanel.vue` 的档位与放置引导。

**模型契约自检**：每个新模型都要在会话创建后核对输入 / 输出尺寸（模板见 `faceInfer.assertFaceModelContract`），
把「文件放反 / 装错模型」变成一条能定位的报错；**动态维跳过校验**，宁可漏报不误报。

---

## 4. 各能力的消费点

- **人脸解析** → `pipeline.ts` 蒙版段：用解析图替换 / 兜底 `buildSkinMask`，`skin = 皮肤类 − (眼 ∪ 唇 ∪ 眉 ∪ 发 ∪ 眼镜)`，妆容分区直接用类别图；缺失时回落 468 区域 / YCbCr。
- **抠像 matting** → `pipeline.ts` 背景段与证件照：alpha 取代 `backgroundMaskFromSubject` 的二值 + 羽化，边缘去杂边也用它；缺失时回落 YOLO seg。
- **景深** → `pipeline.ts` 背景虚化：由统一高斯改为按深度变半径 `r(p) = r_max · clamp((d(p) − d_face) / range)`；缺失时回落统一模糊。
- **姿态 133 点** → `portraitFace.buildBodyWarpControls`：语义关键点对齐后仍走位移场，驱动点密度提升；缺失时回落 YOLO pose 17 点。
- **修复** → `pipeline.ts` 修复段：`healBlemishes` 换成 inpainting（修复笔画即 mask）；缺失时回落局部混合。
- **人脸修复 / 超分** → `portraitBake.bakePortraitRetouch`：**只在烘焙跑**（预览不跑），接在 `rgbaToDataUrl` 之前；缺失时回落锐化 / 本地放大。

---

## 5. 性能口径（预览 vs 烘焙）

- **FaceMesh 468**：CPU ~10–30 ms/脸 —— 预览与烘焙都跑（现已如此）。
- **人脸解析 BiSeNet**：CPU 0.1–0.3 s —— 预览可跑；建议缓存进参数，只在源图变化时重算。
- **MODNet**：CPU 50–150 ms —— 预览可跑。
- **Depth Anything V2 small**：CPU 0.2–0.5 s —— 预览可跑，同样缓存。
- **GFPGAN / Real-ESRGAN**：CPU 1–3 s —— **只在烘焙**；有 DirectML 时再考虑进预览。

现有分层已经够用：编辑器预览 `PREVIEW_MAX_EDGE = 1280`（`PortraitEditorDialog.vue`）走
`bakePortraitRetouch({ maxEdge })`，烘焙走全分辨率，重模型接在烘焙侧即可，不需要新的调度机制。
Windows 提速入口是 `onnxruntime-directml` 的 `executionProviders` 分支（`docs/ARCH_YOLO_LOCAL.md` §10 已预留）。

---

## 6. 验收标准（怎么证明真的变好了）

1. **纯函数单测**：模型输出的后处理 / 区域派生 / 掩码运算全部放 `src/shared/` 并配单测；索引表类常量必须有**不变式测试**（例：468 稠密环必须包含 68 点语义组，做法见 `tests/yoloFaceModels.test.ts`、`tests/portraitFaceRegions.test.ts`）。
2. **蒙版可视化**：把指定区域蒙版导出成 PNG 叠加图（脚本或编辑器调试叠加层）用于人眼核对边界。装好模型后必须做一次，把 468 / 解析 / matting 的蒙版各导一张，确认没有系统性错位。
3. **前后对比**：同一张图同一组参数，改造前 / 后各出一张，逐项看 —— 磨皮是否保留毛孔、五官边缘是否发虚、背景光晕是否消失、证件照边缘是否干净。
4. **回归基线**：沙箱跑测器现状为 14 个文件 `PASS: 133 cases / 7780 assertions`（含 `portraitPipeline.test.ts` 的 11 cases）。任何管线改动都必须保持这份基线全绿，并补上新能力的用例。

---

## 7. 顺序与依赖

- **S1 · 468 稠密区域蒙版**（进行中）—— 无外部依赖（没有 468 时回落 68 点多边形）。
- **S2 · 装上两个 ONNX**（用户本机转换 / 托管）—— 依赖 `scripts/convert-face-models.py`；完成首次推理自检 + 蒙版可视化核对。
- **S3 · 人脸解析 BiSeNet** → 替换肤色蒙版与妆容分区 —— 依赖许可复核 + 模型。
- **S4 · 抠像 MODNet / BiRefNet** → 背景 / 证件照 / 去杂边 —— 依赖许可复核 + 模型。
- **S5 · 景深 Depth Anything V2** → 背景虚化分层 —— 依赖许可复核 + 模型。
- **S6 · 姿态 RTMPose 133 点** → 身形 —— 依赖许可复核 + 模型。
- **S7 · 人脸修复 GFPGAN / 超分 Real-ESRGAN**（仅烘焙）—— 依赖许可复核 + 模型 + GPU 选项。
- **S8 · 输出旋转**（已排队）—— 参数契约 + 内核 + 执行器 + 预览，不依赖模型。

S1 / S8 不依赖模型，可随时推进；S3–S7 每一项都是「许可确认 → 模型到位 → 接线 → 蒙版可视化核对」同一套流程。
