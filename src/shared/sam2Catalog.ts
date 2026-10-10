/**
 * SAM 2.1 的 ONNX 下载目录。
 *
 * Meta 官方检查点是 PyTorch `.pt`，onnxruntime 不能直接加载。
 * 这里使用同一套 SAM 2.1 权重导出的 encoder / decoder ONNX（Apache-2.0 权重），
 * 每个档位一个 zip，解压后得到两个 `.onnx`。
 */
import type { YoloCatalogModel } from './yolo'
import { SAM2_MODEL_SUBDIR } from './localModelLayout'

export const SAM2_CATALOG_BASE_URL =
  'https://huggingface.co/vietanhdev/segment-anything-2.1-onnx-models/resolve/main'

export const SAM2_SUBDIR = SAM2_MODEL_SUBDIR

interface RawSam2Entry {
  id: string
  /** zip 文件名里的导出日期，与 Hugging Face 仓库文件名一致 */
  exportDate: string
  /** zip 的 Content-Length 取整后的展示体积（MB） */
  sizeMb: number
  minBytes: number
}

const RAW_SAM2_ENTRIES: readonly RawSam2Entry[] = [
  { id: 'sam2.1_hiera_tiny', exportDate: '20260221', sizeMb: 111, minBytes: 80 * 1024 * 1024 },
  { id: 'sam2.1_hiera_small', exportDate: '20260221', sizeMb: 136, minBytes: 100 * 1024 * 1024 },
  {
    id: 'sam2.1_hiera_base_plus',
    exportDate: '20260221',
    sizeMb: 259,
    minBytes: 180 * 1024 * 1024
  },
  { id: 'sam2.1_hiera_large', exportDate: '20260221', sizeMb: 768, minBytes: 500 * 1024 * 1024 }
]

export interface Sam2OnnxNames {
  encoder: string
  decoder: string
}

/** 解压后落盘的两个 ONNX 文件名。 */
export function sam2OnnxFileNames(id: string): Sam2OnnxNames {
  return {
    encoder: `${id}.encoder.onnx`,
    decoder: `${id}.decoder.onnx`
  }
}

/** 设置页可下载的 SAM 2.1 ONNX。kind 仅用于目录类型，不进入 YOLO 自动选型。 */
export const SAM2_CATALOG: readonly YoloCatalogModel[] = RAW_SAM2_ENTRIES.map((raw) => {
  const fileName = `${raw.id}_${raw.exportDate}.zip`
  return {
    id: raw.id,
    kind: 'segment',
    fileName,
    url: `${SAM2_CATALOG_BASE_URL}/${fileName}`,
    sizeMb: raw.sizeMb,
    minBytes: raw.minBytes
  }
})

export function findSam2CatalogModel(modelId: string): YoloCatalogModel | undefined {
  return SAM2_CATALOG.find((model) => model.id === modelId)
}
