/**
 * 单图 2.5D 视差景深微动运镜引擎（Parallax Camera Rig & Hitchcock Dolly Zoom）
 *
 * 针对静态漫剧分镜、人像海报或概念插画，无需调用图生视频大模型（0 Token、100% 锁脸不崩坏），
 * 通过自动伪深度场估计与分层逆向 UV 视差映射，实时合成 4 种电影级 2.5D 动态镜头序列：
 * - `dolly-zoom`：希区柯克变焦（前景主体比例锁死，背景发生强烈透视压缩/拉伸）
 * - `orbit-pan`：3D 环绕摇移（水平+垂直微弧度立体环绕位移，近景快、远景慢）
 * - `breathing-float`：电影感呼吸浮动（正弦柔缓悬浮与微推拉）
 * - `dutch-push`：荷兰角推进（镜头缓推叠加微倾角张力）
 */

export type ParallaxMotionPresetId = 'dolly-zoom' | 'orbit-pan' | 'breathing-float' | 'dutch-push'

export interface ParallaxMotionPresetSpec {
  id: ParallaxMotionPresetId
  labelZh: string
  labelEn: string
  descriptionZh: string
}

export const PARALLAX_MOTION_PRESETS: readonly ParallaxMotionPresetSpec[] = [
  {
    id: 'dolly-zoom',
    labelZh: '希区柯克变焦',
    labelEn: 'Hitchcock Dolly Zoom',
    descriptionZh: '前景人物大小锁死，背景急速透视拉伸，营造强烈戏剧眩晕张力'
  },
  {
    id: 'orbit-pan',
    labelZh: '3D 环绕视差摇移',
    labelEn: '3D Orbit Parallax Pan',
    descriptionZh: '围绕前景焦点水平弧线运镜，前景与远景产生真实立体视差位移'
  },
  {
    id: 'breathing-float',
    labelZh: '电影感呼吸悬浮',
    labelEn: 'Cinematic Breathing Float',
    descriptionZh: '柔和正弦呼吸感微推拉与视差浮动，让静态插画瞬间「活」起来'
  },
  {
    id: 'dutch-push',
    labelZh: '荷兰角张力推进',
    labelEn: 'Dutch-Angle Push-In',
    descriptionZh: '向主体中心推进并伴随轻微倾斜旋转与纵深分离，适合高燃漫剧特写'
  }
] as const

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 镜像反射边界采样坐标（避免视差位移在图片边缘产生黑边）
 */
function mirrorCoord(coord: number, maxExclusive: number): number {
  if (maxExclusive <= 1) return 0
  let c = coord
  const period = (maxExclusive - 1) * 2
  c = ((c % period) + period) % period
  if (c >= maxExclusive) {
    c = period - c
  }
  return clamp(c, 0, maxExclusive - 1)
}

/**
 * 从单张 RGBA 图像估计归一化 2.5D 伪深度图（`Float32Array`，长度 `width * height`，`1.0` = 最靠近镜头的前景，`0.0` = 最远背景）。
 *
 * 融合三项视觉先验：
 * 1. 中心黄金构图先验（主体通常位于中轴偏中上部）
 * 2. 暖色/肤色显著性先验與局部明度梯度（清晰边缘与暖调区域更偏向近景）
 * 3. 可选的外部前景蒙版（`foregroundMask`）直接锚定前景层
 */
export function estimatePseudoDepthMap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  foregroundMask?: Uint8Array | Uint8ClampedArray | null
): Float32Array {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const depth = new Float32Array(w * h)

  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h
    // 人像/分镜主体重心通常在 x=0.5, y=0.46
    const dy = (ny - 0.46) / 0.52
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w
      const dx = (nx - 0.5) / 0.46
      const radialDist2 = dx * dx + dy * dy
      const centerPrior = Math.exp(-radialDist2 * 1.15)

      const idx = (y * w + x) * 4
      const r = (pixels[idx] ?? 0) / 255
      const g = (pixels[idx + 1] ?? 0) / 255
      const b = (pixels[idx + 2] ?? 0) / 255
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

      // 暖色/肤色显著度
      const warmthAffinity = clamp01((r - b) * 1.2 + 0.35)

      // 简易局部梯度（高频细节在焦平面内，更接近前景）
      const xRight = Math.min(w - 1, x + 1)
      const yDown = Math.min(h - 1, y + 1)
      const rRight = (pixels[(y * w + xRight) * 4] ?? 0) / 255
      const rDown = (pixels[(yDown * w + x) * 4] ?? 0) / 255
      const focusEnergy = clamp01((Math.abs(r - rRight) + Math.abs(r - rDown)) * 3.2)

      let d = centerPrior * 0.58 + warmthAffinity * 0.22 + luma * 0.1 + focusEnergy * 0.1
      if (foregroundMask && foregroundMask.length >= w * h) {
        const m = foregroundMask[y * w + x]! / 255
        d = d * 0.35 + m * 0.65
      }
      depth[y * w + x] = clamp01(d)
    }
  }

  return depth
}

/**
 * 渲染单帧 2.5D 视差动态画面（`progress` 为 `0..1` 的归一化时间进度）
 */
export function renderParallaxFrameRgba(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  depthMap: Float32Array,
  options: {
    preset: ParallaxMotionPresetId
    /** 归一化时间进度 0..1 */
    progress: number
    /** 视差运动幅度 0..2，默认 1.0 */
    intensity?: number
  }
): Uint8ClampedArray {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const out = new Uint8ClampedArray(w * h * 4)
  const t = clamp01(options.progress)
  const amp = clamp(options.intensity ?? 1.0, 0, 2.5)
  const cx = (w - 1) * 0.5
  const cy = (h - 1) * 0.45

  for (let y = 0; y < h; y++) {
    const relY = y - cy
    for (let x = 0; x < w; x++) {
      const relX = x - cx
      const d = depthMap[y * w + x] ?? 0.5 // 1 = 前景, 0 = 远景
      const bgWeight = 1 - d // 远景权重

      let sampleX = x
      let sampleY = y

      if (options.preset === 'dolly-zoom') {
        // 希区柯克变焦：前景缩放接近 1.0，背景随 t 剧烈放大/拉远
        const bgZoom = 1 + t * 0.22 * amp * bgWeight - t * 0.03 * amp * d
        sampleX = cx + relX / Math.max(0.5, bgZoom)
        sampleY = cy + relY / Math.max(0.5, bgZoom)
      } else if (options.preset === 'orbit-pan') {
        // 3D 环绕视差：前景向一个方向微移，背景向反方向位移，且带微缩放防裁边
        const baseZoom = 1 + 0.06 * amp
        const phase = (t - 0.5) * 2 // -1 .. +1
        const shiftX = phase * w * 0.045 * amp * (d - 0.45)
        const shiftY = Math.sin(t * Math.PI) * h * 0.015 * amp * (d - 0.5)
        sampleX = cx + relX / baseZoom - shiftX
        sampleY = cy + relY / baseZoom - shiftY
      } else if (options.preset === 'breathing-float') {
        // 呼吸悬浮：正弦平滑缩放与上下浮动
        const wave = Math.sin(t * Math.PI)
        const zoom = 1 + wave * (0.025 + d * 0.045) * amp
        const floatY = wave * h * 0.022 * amp * d
        sampleX = cx + relX / zoom
        sampleY = cy + relY / zoom + floatY
      } else {
        // dutch-push：推进 + 轻微荷兰角旋转
        const zoom = 1 + t * (0.06 + d * 0.1) * amp
        const angle = t * 0.055 * amp * (0.5 + d * 0.5)
        const cosA = Math.cos(angle)
        const sinA = Math.sin(angle)
        const rx = (relX * cosA - relY * sinA) / zoom
        const ry = (relX * sinA + relY * cosA) / zoom
        sampleX = cx + rx
        sampleY = cy + ry
      }

      const sx = mirrorCoord(sampleX, w)
      const sy = mirrorCoord(sampleY, h)
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0

      const p00 = (y0 * w + x0) * 4
      const p10 = (y0 * w + x1) * 4
      const p01 = (y1 * w + x0) * 4
      const p11 = (y1 * w + x1) * 4

      const dstIdx = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        const v0 = sourcePixels[p00 + c]! * (1 - fx) + sourcePixels[p10 + c]! * fx
        const v1 = sourcePixels[p01 + c]! * (1 - fx) + sourcePixels[p11 + c]! * fx
        out[dstIdx + c] = Math.round(v0 * (1 - fy) + v1 * fy)
      }
    }
  }

  return out
}

/**
 * 批量生成一整段 2.5D 视差运镜帧序列（可用于导出 GIF/WebM 或时间轴预览）
 */
export function generateParallaxSequenceRgba(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    preset?: ParallaxMotionPresetId
    frameCount?: number
    intensity?: number
    foregroundMask?: Uint8Array | Uint8ClampedArray | null
  }
): {
  preset: ParallaxMotionPresetId
  width: number
  height: number
  depthMap: Float32Array
  frames: Uint8ClampedArray[]
} {
  const preset = options?.preset ?? 'dolly-zoom'
  const count = clamp(Math.floor(options?.frameCount ?? 8), 2, 120)
  const depthMap = estimatePseudoDepthMap(sourcePixels, width, height, options?.foregroundMask)
  const frames: Uint8ClampedArray[] = []

  for (let i = 0; i < count; i++) {
    const progress = count <= 1 ? 1 : i / (count - 1)
    frames.push(
      renderParallaxFrameRgba(sourcePixels, width, height, depthMap, {
        preset,
        progress,
        intensity: options?.intensity
      })
    )
  }

  return {
    preset,
    width,
    height,
    depthMap,
    frames
  }
}
