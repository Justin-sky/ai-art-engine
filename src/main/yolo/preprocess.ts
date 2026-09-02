/**
 * YOLO 前处理：letterbox 缩放 + RGBA → CHW float32 张量（0~1 归一化）。
 * 输出 scale / padX / padY 供后处理把 640 坐标逆映射回原图。
 */
import { YOLO_INPUT_SIZE, YOLO_PAD_VALUE } from '@shared/yolo'

export interface LetterboxTensor {
  /** [1, 3, size, size] float32，RGB 顺序 */
  tensor: Float32Array
  /** 原图 → 640 的缩放系数（letterbox 边长缩放） */
  scale: number
  padX: number
  padY: number
  srcWidth: number
  srcHeight: number
}

export function rgbaToLetterboxTensor(
  rgba: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  size = YOLO_INPUT_SIZE
): LetterboxTensor {
  const scale = Math.min(size / srcWidth, size / srcHeight)
  const newW = Math.max(1, Math.round(srcWidth * scale))
  const newH = Math.max(1, Math.round(srcHeight * scale))
  const padX = Math.floor((size - newW) / 2)
  const padY = Math.floor((size - newH) / 2)

  const tensor = new Float32Array(1 * 3 * size * size)
  // 填充色用 YOLO 训练惯例灰度（114/255），letterbox 区域与推理结果一致性更好
  tensor.fill(YOLO_PAD_VALUE / 255)
  const plane = size * size

  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(srcHeight - 1, Math.floor(y / scale))
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x / scale))
      const srcIdx = (srcY * srcWidth + srcX) * 4
      const dstIdx = (y + padY) * size + (x + padX)
      tensor[dstIdx] = rgba[srcIdx] / 255
      tensor[plane + dstIdx] = rgba[srcIdx + 1] / 255
      tensor[plane * 2 + dstIdx] = rgba[srcIdx + 2] / 255
    }
  }
  return { tensor, scale, padX, padY, srcWidth, srcHeight }
}
