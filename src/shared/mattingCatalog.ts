/**
 * 高精抠图（显著性二元分割 / Alpha Matting）ONNX 模型下载目录。
 *
 * 背景：内置的 `yolo11n-seg.onnx` 仅覆盖 COCO 80 类且掩码原型分辨率仅 160×160，
 * 面对非 COCO 游戏道具/图标、复杂发丝、半透明边缘或镂空结构时容易漏检或出现锯齿。
 *
 * 这里提供可在「设置 → 本地视觉」一键下载至 `local-models/matting/` 的开源高精抠图模型：
 * - `rmbg-1.4-q8`：BRIA RMBG-1.4 INT8 量化版（≈44 MB，1024×1024，兼顾速度与边缘精度，推荐首选）
 * - `rmbg-1.4`：BRIA RMBG-1.4 FP32 完整版（≈176 MB，1024×1024，基于 IS-Net DIS 架构的通用主体抠图）
 * - `birefnet-lite`：BiRefNet Lite 双边参考高精分割（≈178 MB，1024×1024，复杂发丝/镂空内洞表现极佳）
 * - `modnet`：MODNet 轻量人像抠图（≈25 MB，512×512，专注人像发丝软边 Alpha Matting）
 *
 * 所有下载源均位于已加入白名单的 `huggingface.co`。
 */
import type { YoloCatalogModel, YoloModelInfo } from './yolo'
import { MATTING_MODEL_SUBDIR } from './localModelLayout'

export const MATTING_SUBDIR = MATTING_MODEL_SUBDIR

export type MattingNormalizationKind = 'rmbg' | 'imagenet' | 'modnet'

export interface MattingCatalogModel extends YoloCatalogModel {
  /** 模型推理输入正方形边长（像素，如 1024 或 512） */
  inputSize: number
  /** 通道归一化方式 */
  norm: MattingNormalizationKind
  /** 优先级权重：同目录安装多个高精抠图模型时按 priority 从高到低自动选用 */
  priority: number
}

const RAW_MATTING_ENTRIES: readonly MattingCatalogModel[] = [
  {
    id: 'rmbg-1.4-q8',
    kind: 'segment',
    fileName: 'rmbg-1.4-q8.onnx',
    url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
    sizeMb: 44,
    minBytes: 20 * 1024 * 1024,
    inputSize: 1024,
    norm: 'rmbg',
    priority: 90
  },
  {
    id: 'birefnet-lite',
    kind: 'segment',
    fileName: 'birefnet-lite.onnx',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite/resolve/main/onnx/model.onnx',
    sizeMb: 178,
    minBytes: 100 * 1024 * 1024,
    inputSize: 1024,
    norm: 'imagenet',
    priority: 100
  },
  {
    id: 'rmbg-1.4',
    kind: 'segment',
    fileName: 'rmbg-1.4.onnx',
    url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
    sizeMb: 176,
    minBytes: 100 * 1024 * 1024,
    inputSize: 1024,
    norm: 'rmbg',
    priority: 95
  },
  {
    id: 'modnet',
    kind: 'segment',
    fileName: 'modnet.onnx',
    url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
    sizeMb: 25,
    minBytes: 12 * 1024 * 1024,
    inputSize: 512,
    norm: 'modnet',
    priority: 75
  }
]

/** 设置页可下载的高精抠图 ONNX 目录 */
export const MATTING_CATALOG: readonly MattingCatalogModel[] = RAW_MATTING_ENTRIES

export function findMattingCatalogModel(modelId: string): MattingCatalogModel | undefined {
  return MATTING_CATALOG.find((model) => model.id === modelId)
}

/**
 * 从已安装的 matting 模型列表中挑选默认自动使用的模型：
 * 优先按目录定义的精度优先级（BiRefNet-Lite > RMBG-1.4 > RMBG-1.4-Q8 > MODNet），
 * 用户手动放入的自定义 `.onnx` 则按文件体积降序兜底。
 */
export function pickPreferredMattingModel(
  installed: readonly YoloModelInfo[]
): YoloModelInfo | undefined {
  if (!installed.length) return undefined
  return [...installed].sort((a, b) => {
    const pa = findMattingCatalogModel(a.id)?.priority ?? 50
    const pb = findMattingCatalogModel(b.id)?.priority ?? 50
    if (pb !== pa) return pb - pa
    return b.sizeMb - a.sizeMb
  })[0]
}
