/**
 * 3D / 2.5D PBR 材质贴图本地派生纯函数层。
 *
 * 由单张 Albedo / Diffuse RGBA 像素缓冲区派生全套引擎可直接挂载的 PBR 贴图：
 * - `height`：感知亮度高度图（Perceptual Luminance Height Map）
 * - `normal`：3x3 Sobel 切线空间法线贴图（支持 OpenGL +Y 与 DirectX -Y，支持无缝环绕采样）
 * - `roughness`：基于局部高频梯度与亮度反演的粗糙度贴图
 * - `ao`：基于局部凹陷（Laplacian 腔体）与暗部阴影的环境光遮蔽贴图（Ambient Occlusion）
 * - `metallic`：基于高光饱和度与色相特征的金属度贴图
 * - `orm`：glTF 2.0 / Unreal / Godot 标准通道打包贴图（R=AO, G=Roughness, B=Metallic, A=255）
 */

export type NormalMapFormat = 'opengl' | 'directx'

export interface PbrDeriveOptions {
  /** 法线凹凸强度（0.2~12，默认 2.5） */
  normalStrength?: number
  /** 法线绿通道方向：opengl (+Y，Unity/Godot/Blender) 或 directx (-Y，Unreal) */
  normalFormat?: NormalMapFormat
  /** 边缘算子是否按无缝瓦片环绕采样（默认 true） */
  wrapTiling?: boolean
  /** 粗糙度对比度（0.2~3，默认 1.2） */
  roughnessContrast?: number
  /** 粗糙度基准偏移（-0.5~0.5，默认 0.05） */
  roughnessBias?: number
  /** 是否将亮面映射为低粗糙度（光滑）（默认 true） */
  invertRoughness?: boolean
  /** AO 腔体遮蔽强度（0~2，默认 0.85） */
  aoStrength?: number
  /** 金属度基准缩放（0~2，默认 0.25，非金属材质默认偏低） */
  metallicScale?: number
}

export interface PbrDerivedMaps {
  width: number
  height: number
  normalFormat: NormalMapFormat
  normal: Uint8ClampedArray
  heightMap: Uint8ClampedArray
  roughness: Uint8ClampedArray
  ao: Uint8ClampedArray
  metallic: Uint8ClampedArray
  /** glTF / Unreal / Godot 标准打包贴图：R=AO, G=Roughness, B=Metallic, A=255 */
  orm: Uint8ClampedArray
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}

function sampleIndex(x: number, y: number, width: number, height: number, wrap: boolean): number {
  if (wrap) {
    const wx = ((x % width) + width) % width
    const wy = ((y % height) + height) % height
    return wy * width + wx
  }
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y
  return cy * width + cx
}

/**
 * 从单张 RGBA 像素缓冲派生全套 PBR 贴图。
 */
export function derivePbrMapsFromRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: PbrDeriveOptions
): PbrDerivedMaps {
  const safeW = Math.max(1, Math.floor(width))
  const safeH = Math.max(1, Math.floor(height))
  const totalPixels = safeW * safeH
  const byteLength = totalPixels * 4

  const normalStrength = clamp(Number(options?.normalStrength ?? 2.5), 0.2, 12)
  const normalFormat: NormalMapFormat = options?.normalFormat === 'directx' ? 'directx' : 'opengl'
  const wrapTiling = options?.wrapTiling !== false
  const roughnessContrast = clamp(Number(options?.roughnessContrast ?? 1.2), 0.2, 3)
  const roughnessBias = clamp(Number(options?.roughnessBias ?? 0.05), -0.5, 0.5)
  const invertRoughness = options?.invertRoughness !== false
  const aoStrength = clamp(Number(options?.aoStrength ?? 0.85), 0, 2)
  const metallicScale = clamp(Number(options?.metallicScale ?? 0.25), 0, 2)

  // 1. 计算归一化灰度高度场 [0..1] 与饱和度特征
  const lum = new Float32Array(totalPixels)
  const sat = new Float32Array(totalPixels)
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4
    const r = (rgba[idx] ?? 0) / 255
    const g = (rgba[idx + 1] ?? 0) / 255
    const b = (rgba[idx + 2] ?? 0) / 255
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    sat[i] = maxC > 1e-4 ? (maxC - minC) / maxC : 0
  }

  const normal = new Uint8ClampedArray(byteLength)
  const heightMap = new Uint8ClampedArray(byteLength)
  const roughness = new Uint8ClampedArray(byteLength)
  const ao = new Uint8ClampedArray(byteLength)
  const metallic = new Uint8ClampedArray(byteLength)
  const orm = new Uint8ClampedArray(byteLength)

  const ySign = normalFormat === 'directx' ? -1 : 1

  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const pIdx = y * safeW + x
      const outIdx = pIdx * 4
      const centerLum = lum[pIdx]!

      // 3x3 邻域高度采样
      const tl = lum[sampleIndex(x - 1, y - 1, safeW, safeH, wrapTiling)]!
      const tc = lum[sampleIndex(x, y - 1, safeW, safeH, wrapTiling)]!
      const tr = lum[sampleIndex(x + 1, y - 1, safeW, safeH, wrapTiling)]!
      const ml = lum[sampleIndex(x - 1, y, safeW, safeH, wrapTiling)]!
      const mr = lum[sampleIndex(x + 1, y, safeW, safeH, wrapTiling)]!
      const bl = lum[sampleIndex(x - 1, y + 1, safeW, safeH, wrapTiling)]!
      const bc = lum[sampleIndex(x, y + 1, safeW, safeH, wrapTiling)]!
      const br = lum[sampleIndex(x + 1, y + 1, safeW, safeH, wrapTiling)]!

      // Sobel X / Y 梯度
      const dX = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const dY = bl + 2 * bc + br - (tl + 2 * tc + tr)

      let nx = -dX * normalStrength
      let ny = -dY * normalStrength * ySign
      let nz = 1.0
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx *= invLen
      ny *= invLen
      nz *= invLen

      normal[outIdx] = clampByte((nx * 0.5 + 0.5) * 255)
      normal[outIdx + 1] = clampByte((ny * 0.5 + 0.5) * 255)
      normal[outIdx + 2] = clampByte((nz * 0.5 + 0.5) * 255)
      normal[outIdx + 3] = 255

      // Height Map
      const hByte = clampByte(centerLum * 255)
      heightMap[outIdx] = hByte
      heightMap[outIdx + 1] = hByte
      heightMap[outIdx + 2] = hByte
      heightMap[outIdx + 3] = 255

      // 局部均值与微表面梯度用于 Roughness & AO
      const neighborMean = (tl + tc + tr + ml + mr + bl + bc + br) / 8
      const microGradient = Math.min(1, Math.sqrt(dX * dX + dY * dY) * 0.65)
      const baseRough = invertRoughness ? 1 - centerLum : centerLum
      const roughVal = clamp(
        (baseRough - 0.5) * roughnessContrast + 0.5 + microGradient * 0.22 + roughnessBias,
        0.04,
        0.98
      )
      const rByte = clampByte(roughVal * 255)
      roughness[outIdx] = rByte
      roughness[outIdx + 1] = rByte
      roughness[outIdx + 2] = rByte
      roughness[outIdx + 3] = 255

      // AO：局部凹陷（neighborMean > centerLum 时为凹腔）+ 暗部抑制
      const cavity = Math.max(0, neighborMean - centerLum)
      const darkOcclusion = (1 - centerLum) * 0.35
      const aoVal = clamp(1 - (cavity * 2.4 + darkOcclusion) * aoStrength, 0.08, 1)
      const aoByte = clampByte(aoVal * 255)
      ao[outIdx] = aoByte
      ao[outIdx + 1] = aoByte
      ao[outIdx + 2] = aoByte
      ao[outIdx + 3] = 255

      // Metallic：高亮度且低饱和度/微梯度平稳处倾向更高金属反射感，乘以 metallicScale
      const s = sat[pIdx]!
      const metalVal = clamp(
        centerLum * (1 - s * 0.7) * (1 - microGradient * 0.5) * metallicScale,
        0,
        1
      )
      const mByte = clampByte(metalVal * 255)
      metallic[outIdx] = mByte
      metallic[outIdx + 1] = mByte
      metallic[outIdx + 2] = mByte
      metallic[outIdx + 3] = 255

      // ORM Packed: R=AO, G=Roughness, B=Metallic, A=255
      orm[outIdx] = aoByte
      orm[outIdx + 1] = rByte
      orm[outIdx + 2] = mByte
      orm[outIdx + 3] = 255
    }
  }

  return {
    width: safeW,
    height: safeH,
    normalFormat,
    normal,
    heightMap,
    roughness,
    ao,
    metallic,
    orm
  }
}
