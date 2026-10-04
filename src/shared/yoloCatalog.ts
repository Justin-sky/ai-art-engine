/**
 * YOLO 模型官方下载目录（可替换源：改 YOLO_CATALOG_BASE_URL 指向镜像即可）。
 *
 * 数据来源：Ultralytics 官方仓库 ultralytics/assets 的 GitHub release 资产
 * （v8.4.0 起随发布附带导出的 fp32 ONNX，与随包内置的 yolo11n 系列同一导出管线，
 * 可直接被 onnxruntime CPU worker 加载，无需安装任何 Python 依赖）。
 *
 * 覆盖：detect / segment / pose × s / m / l / x 共 12 档；
 * n 档已随包内置（resources/yolo-models），不在此重复提供。
 *
 * 体积为「约值」（fp32 ONNX ≈ 官方 .pt 的两倍），下载时以 content-length 为准。
 * 替换/新增源：保持 id 为「文件名去 .onnx」即可被模型目录扫描自动识别。
 */
import type { YoloCatalogModel, YoloTaskKind } from './yolo'
import { YOLO_FACE_DETECT_MODEL_ID, YOLO_FACE_LANDMARK_MODEL_ID } from './yolo'

/** 官方直链基址（固定 release tag，避免仓库默认分支内容变动破坏下载） */
export const YOLO_CATALOG_BASE_URL =
  'https://github.com/ultralytics/assets/releases/download/v8.4.0'

/** 展示顺序：检测 / 分割 / 姿态 */
export const YOLO_KIND_ORDER: readonly UltralyticsKind[] = ['detect', 'segment', 'pose']

/** scale 档位展示顺序与粗略说明索引（n 内置、s 轻量、m 均衡、l/x 高精度） */
export const YOLO_SCALE_ORDER: readonly string[] = ['s', 'm', 'l', 'x']

/**
 * 走 Ultralytics 官方资产命名的三类任务。
 * `face`（BlazeFace 检测器 + FaceMesh 468 点）是另一个来源的两段式模型，
 * 不在 `yolo11<s|m|l|x>-*` 这套命名里，因此显式排除，避免误拼出「yolo11s-face.onnx」。
 */
export type UltralyticsKind = Exclude<YoloTaskKind, 'face'>

interface RawCatalogEntry {
  kind: UltralyticsKind
  scale: 's' | 'm' | 'l' | 'x'
  /** 官方 GitHub assets 实际体积取整（MB），展示用；下载以 content-length 为准 */
  approxMb: number
}

const RAW_ENTRIES: RawCatalogEntry[] = [
  // detect（COCO 80 类目标检测；素材打标 / 语义检索 / 视频打点的检测底座）
  { kind: 'detect', scale: 's', approxMb: 36 },
  { kind: 'detect', scale: 'm', approxMb: 77 },
  { kind: 'detect', scale: 'l', approxMb: 97 },
  { kind: 'detect', scale: 'x', approxMb: 218 },
  // segment（实例分割：主体轮廓 / 一键抠图 / 透明素材）
  { kind: 'segment', scale: 's', approxMb: 39 },
  { kind: 'segment', scale: 'm', approxMb: 86 },
  { kind: 'segment', scale: 'l', approxMb: 106 },
  { kind: 'segment', scale: 'x', approxMb: 237 },
  // pose（COCO 17 关键点人体姿态估计）
  { kind: 'pose', scale: 's', approxMb: 38 },
  { kind: 'pose', scale: 'm', approxMb: 80 },
  { kind: 'pose', scale: 'l', approxMb: 100 },
  { kind: 'pose', scale: 'x', approxMb: 225 }
]

/**
 * 官方 GitHub release 资产的文件名后缀（与随包内置 yolo11n-*.onnx 命名一致）：
 * - detect → 无后缀（yolo11s.onnx）
 * - segment → -seg（官方是 yolo11s-seg.onnx，不是 -segment）
 * - pose → -pose（yolo11s-pose.onnx）
 */
function onnxSuffixFor(kind: UltralyticsKind): string {
  switch (kind) {
    case 'detect':
      return ''
    case 'segment':
      return '-seg'
    case 'pose':
      return '-pose'
  }
}

function catalogEntryFor(kind: UltralyticsKind, scale: string, approxMb: number): YoloCatalogModel {
  const id = `yolo11${scale}${onnxSuffixFor(kind)}`
  const fileName = `${id}.onnx`
  return {
    id,
    kind,
    fileName,
    url: `${YOLO_CATALOG_BASE_URL}/${fileName}`,
    sizeMb: approxMb,
    // Ultralytics 最小的 fp32 ONNX（yolo11n 系）也有 ~10MB，1MB 以下是错误页
    minBytes: 1024 * 1024
  }
}

/** 官方可下载模型目录（已按 kind → scale 排序，UI 直接分组展示） */
export const YOLO_CATALOG: readonly YoloCatalogModel[] = YOLO_KIND_ORDER.flatMap((kind) =>
  YOLO_SCALE_ORDER.map((scale) => {
    const raw = RAW_ENTRIES.find((r) => r.kind === kind && r.scale === scale)
    return catalogEntryFor(kind, scale, raw?.approxMb ?? 0)
  })
)

/** 目录里每个 kind 应覆盖的 scale 数（UI 空态提示用） */
export const YOLO_CATALOG_SCALE_COUNT = YOLO_SCALE_ORDER.length

// ── 人脸关键点（两段式）：随包内置 + Release 分发 ───────────────────────
/**
 * 人脸两段式模型（BlazeFace 检测器 + FaceMesh）来自另一套上游，没有可长期固定的
 * 官方直链，因此**不跟随 Ultralytics 目录**，改为托管在**本仓 GitHub Release**：
 *
 *   https://github.com/Justin-sky/ai-art-engine/releases/download/face-models-v1/face-detect.onnx
 *   https://github.com/Justin-sky/ai-art-engine/releases/download/face-models-v1/face-landmark.onnx
 *
 * 这个地址有**两个用途**（同一份资产）：
 * 1. **构建期**：`npm run fetch:yolo-models` 把它拉进 `resources/yolo-models/`，随安装包内置，
 *    用户开箱即用（`YoloService.ensureBundledModels()` 首次启动会把内置 .onnx 拷进模型目录）；
 * 2. **兜底**：用户删掉了内置模型时，设置页仍可从这里重新下载。
 *
 * 换源：改这里（或指向镜像 / 自有 OSS）即可，UI、下载器与构建脚本都从这里取地址。
 *
 * ⚠️ 这两个资产需要**先用 `npm run sync:face-models -- --upload` 上传**（脚本会打印精确的
 * sha256）；在这之前 `fetch:yolo-models` 会报 404，这是预期行为。
 */
export const YOLO_FACE_CATALOG_BASE_URL =
  'https://github.com/Justin-sky/ai-art-engine/releases/download/face-models-v1'

/**
 * 随包内置的人脸模型文件名。
 *
 * `scripts/fetch-yolo-models.mjs` 按这个列表把两个 .onnx 拉进 `resources/yolo-models/`，
 * `scripts/check-pack-resources.mjs` 按它做打包前自检 —— 打包漏了模型会在打包前硬失败，
 * 而不是等用户发现「五官悄悄不生效」。
 */
export const YOLO_FACE_BUNDLED_FILES: readonly string[] = [
  `${YOLO_FACE_DETECT_MODEL_ID}.onnx`,
  `${YOLO_FACE_LANDMARK_MODEL_ID}.onnx`
]

interface RawFaceEntry {
  id: string
  /** 展示用估算体积 MB；精确值以下载 content-length 为准 */
  approxMb: number
  /** 完整性粗检下限（字节）：人脸模型比 YOLO 小得多，按条目给值 */
  minBytes: number
  /**
   * 期望 SHA-256（小写十六进制）。声明了就**必须**校验通过才落盘。
   *
   * 这两个值是本地用官方 MediaPipe 权重转换后实测的（`scripts/convert-face-models.py`
   * + tf2onnx，转换保真度已与 TFLite 解释器逐值核对 max |Δ| < 1e-4）：
   *   face-detect.onnx   4e2659cf…
   *   face-landmark.onnx 7a0c84ae…
   * 上传 Release 时要保证资产与这两个哈希一致，否则下载会在落盘前被拦下（这是期望行为）。
   */
  sha256: string
}

/**
 * 人脸模型条目。id 必须与 `@shared/yolo` 的约定名一致 ——
 * 主进程按这两个 id 精确定位（`pickFaceModel` 的 aliases 首选），模型目录扫描也据此
 * 标 `kind = 'face'`。
 */
const RAW_FACE_ENTRIES: readonly RawFaceEntry[] = [
  {
    id: YOLO_FACE_DETECT_MODEL_ID,
    approxMb: 0.4,
    minBytes: 256 * 1024,
    sha256: '4e2659cf0d55721c79317249fa01f7f55f43b8283a7ccf2134a41f04863565f0'
  },
  {
    id: YOLO_FACE_LANDMARK_MODEL_ID,
    approxMb: 2.4,
    minBytes: 256 * 1024,
    sha256: '7a0c84ae34c3a84873807191d680d6ca155ee213c8da5669764c05fe711579e1'
  }
]

export const YOLO_FACE_CATALOG: readonly YoloCatalogModel[] = RAW_FACE_ENTRIES.map((raw) => ({
  id: raw.id,
  kind: 'face',
  fileName: `${raw.id}.onnx`,
  url: `${YOLO_FACE_CATALOG_BASE_URL}/${raw.id}.onnx`,
  sizeMb: raw.approxMb,
  minBytes: raw.minBytes,
  ...(raw.sha256 ? { sha256: raw.sha256 } : {})
}))

/** 下载源是否已配置：没配源时 UI 只做放置引导，不显示必然 404 的下载按钮 */
export function yoloFaceCatalogReady(): boolean {
  return /^https:\/\//.test(YOLO_FACE_CATALOG_BASE_URL)
}

/** 全部可下载模型（Ultralytics 十二档 + 人脸两段式） */
export const YOLO_CATALOG_ALL: readonly YoloCatalogModel[] = [...YOLO_CATALOG, ...YOLO_FACE_CATALOG]
