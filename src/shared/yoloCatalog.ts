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

/** 官方直链基址（固定 release tag，避免仓库默认分支内容变动破坏下载） */
export const YOLO_CATALOG_BASE_URL =
  'https://github.com/ultralytics/assets/releases/download/v8.4.0'

/** 展示顺序：检测 / 分割 / 姿态 */
export const YOLO_KIND_ORDER: readonly YoloTaskKind[] = ['detect', 'segment', 'pose']

/** scale 档位展示顺序与粗略说明索引（n 内置、s 轻量、m 均衡、l/x 高精度） */
export const YOLO_SCALE_ORDER: readonly string[] = ['s', 'm', 'l', 'x']

interface RawCatalogEntry {
  kind: YoloTaskKind
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

function catalogEntryFor(kind: YoloTaskKind, scale: string, approxMb: number): YoloCatalogModel {
  const suffix = kind === 'detect' ? '' : `-${kind}`
  const id = `yolo11${scale}${suffix}`
  const fileName = `${id}.onnx`
  return {
    id,
    kind,
    fileName,
    url: `${YOLO_CATALOG_BASE_URL}/${fileName}`,
    sizeMb: approxMb
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
