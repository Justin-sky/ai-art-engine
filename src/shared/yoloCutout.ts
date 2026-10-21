/**
 * 本地高精抠图 — 纯函数层（无 DOM 依赖，主进程 / 渲染层 / 测试共用）。
 *
 * 包含完整商业级本地抠图数学管线：
 * 1. YOLO / 高精抠图（RMBG / BiRefNet / MODNet）掩码重采样与连续 Sigmoid 软边合成；
 * 2. 窄带颜色亲和度修正（Narrow-Band Color Matting）+ 引导图像滤波（Fast Guided Image Filter, O(N)）；
 * 3. 封闭背景内洞自动穿透（Interior Background Hole Punching，解决叉腰/双腿间/镂空环背景残留）；
 * 4. 交互式保留/擦除修补画笔（Keep / Erase Touch-Up Brushes，归一化坐标与软边笔触光栅化）；
 * 5. 八方向前景包络约束色彩去污染（Multi-Directional Defringe，消除发丝白边/彩边光晕）；
 * 6. 零样本显著性主体兜底提取（Salient Subject Mask，解决非 COCO 游戏道具/图标/武器漏检）。
 */
import { YOLO_INPUT_SIZE, type YoloBox, type YoloLetterboxGeometry } from './yolo'

/** 原图坐标系中的矩形区域（整数像素） */
export interface CutoutRegion {
  x: number
  y: number
  width: number
  height: number
}

/** 修补画笔轨迹点（归一化原图坐标 0~1，与分辨率及裁剪框无关） */
export interface CutoutBrushPoint {
  x: number
  y: number
}

/** 交互式保留 / 擦除修补画笔笔画 */
export interface CutoutBrushStroke {
  /** keep = 强制保留前景；erase = 强制擦除为透明背景 */
  mode: 'keep' | 'erase'
  /** 画笔半径（相对原图短边的归一化比例 0.003~0.25） */
  radius: number
  /** 连续笔触轨迹点（归一化原图坐标 0~1） */
  points: CutoutBrushPoint[]
}

export interface CutoutAlphaInput {
  /** 需要保留的实例 mask（softMask=true 时为 0~255 概率，否则 0/1 二值） */
  masks: Uint8Array[]
  /** mask 网格边长（masks[0].width，通常 160 或高精模型 512） */
  maskHw: number
  /** data 是否为 0~255 概率；false 时按 0/1 二值处理 */
  soft?: boolean
  /** worker 返回的 letterbox 几何；缺省按原图尺寸复算 */
  letterbox?: YoloLetterboxGeometry
  /** 原图宽度（推理输入尺寸） */
  srcWidth: number
  /** 原图高度（推理输入尺寸） */
  srcHeight: number
  /** 输出区域（原图坐标）；缺省整图 */
  region?: CutoutRegion
  /** mask 概率阈值 0~1，低于阈值视为背景。默认 0.5 */
  threshold?: number
  /** 边缘羽化半径（输出像素），0 表示保留硬边 */
  feather?: number
  /**
   * 输出相对 region 的分辨率倍率。
   * 推理可能在缩放图上进行（省 IPC / 推理开销），但抠图要按原图分辨率输出时，
   * 直接从 mask 网格采样到目标分辨率即可，无需二次放大。默认 1。
   */
  outScale?: number
  /**
   * 是否保留连续概率过渡带（Smoothstep Sigmoid Ramp）而非一刀切 0/1 二值化。
   * 开启后可保留高精抠图模型与软掩码的发丝/半透明渐变的原始概率梯度。
   */
  continuousAlpha?: boolean
  /** 边缘收缩/扩展（-10 ~ +10，负数向内收缩去白边，正数向外扩张保细节） */
  edgeChoke?: number
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge0 ? 1 : 0
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * 复刻 YOLO 前处理的 letterbox 几何（worker 未返回时的兜底路径）。
 * 公式必须与 src/main/yolo/preprocess.ts 保持一致，否则掩码会整体偏移。
 */
export function letterboxGeometryFor(
  srcWidth: number,
  srcHeight: number,
  size: number = YOLO_INPUT_SIZE
): YoloLetterboxGeometry {
  const w = Math.max(1, srcWidth)
  const h = Math.max(1, srcHeight)
  const scale = Math.min(size / w, size / h)
  const newW = Math.max(1, Math.round(w * scale))
  const newH = Math.max(1, Math.round(h * scale))
  return {
    size,
    scale,
    padX: Math.floor((size - newW) / 2),
    padY: Math.floor((size - newH) / 2)
  }
}

/** 网格连续坐标处的概率（双线性插值；letterbox 填充区一律视为背景） */
function probabilityAt(
  data: Uint8Array,
  maskHw: number,
  soft: boolean,
  gx: number,
  gy: number
): number {
  if (gx < -0.5 || gy < -0.5 || gx > maskHw - 0.5 || gy > maskHw - 0.5) return 0
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const cx0 = clampInt(x0, 0, maskHw - 1)
  const cy0 = clampInt(y0, 0, maskHw - 1)
  const cx1 = clampInt(x0 + 1, 0, maskHw - 1)
  const cy1 = clampInt(y0 + 1, 0, maskHw - 1)
  const unit = soft ? 1 / 255 : 1
  const v00 = data[cy0 * maskHw + cx0]! * unit
  const v10 = data[cy0 * maskHw + cx1]! * unit
  const v01 = data[cy1 * maskHw + cx0]! * unit
  const v11 = data[cy1 * maskHw + cx1]! * unit
  const top = v00 + (v10 - v00) * fx
  const bottom = v01 + (v11 - v01) * fx
  return top + (bottom - top) * fy
}

/**
 * 把选中的实例掩码合成为输出区域的 alpha（0~1，长度 = region.width * region.height）。
 * 多实例取概率最大值合并；
 * - 默认模式（兼容单测）：按阈值二值化后做羽化模糊；
 * - continuousAlpha 模式：在阈值附近保留平滑 Sigmoid/Hermite 连续概率梯度，供后续引导滤波精修。
 */
export function buildCutoutAlpha(input: CutoutAlphaInput): Float32Array {
  const srcW = Math.max(1, Math.floor(input.srcWidth))
  const srcH = Math.max(1, Math.floor(input.srcHeight))
  const region = input.region ?? { x: 0, y: 0, width: srcW, height: srcH }
  const outScale = Math.max(0.01, input.outScale ?? 1)
  const outW = Math.max(1, Math.round(region.width * outScale))
  const outH = Math.max(1, Math.round(region.height * outScale))
  const out = new Float32Array(outW * outH)
  if (input.masks.length === 0 || input.maskHw <= 0) return out

  const geo = input.letterbox ?? letterboxGeometryFor(srcW, srcH)
  const soft = input.soft === true
  const threshold = clamp(input.threshold ?? 0.5, 0, 1)
  const maskHw = input.maskHw

  for (const mask of input.masks) {
    if (mask.length < maskHw * maskHw) continue
    for (let oy = 0; oy < outH; oy++) {
      // 取原图像素中心，保证与 letterbox 前处理的采样对齐
      const ly = (region.y + (oy + 0.5) / outScale) * geo.scale + geo.padY
      const gy = ly * (maskHw / geo.size) - 0.5
      const row = oy * outW
      if (gy < -1 || gy > maskHw) continue
      for (let ox = 0; ox < outW; ox++) {
        const lx = (region.x + (ox + 0.5) / outScale) * geo.scale + geo.padX
        const gx = lx * (maskHw / geo.size) - 0.5
        const p = probabilityAt(mask, maskHw, soft, gx, gy)
        const i = row + ox
        if (p > out[i]!) out[i] = p
      }
    }
  }

  const chokeShift = clamp(input.edgeChoke ?? 0, -10, 10) * 0.025
  const effThreshold = clamp(threshold - chokeShift, 0.03, 0.97)

  if (input.continuousAlpha && soft) {
    // 保留高精抠图模型在 (0.06, 0.94) 区间的连续半透明发丝响应，避免窄带 smoothstep 将发丝间隙背景压成全不透明
    const band = clamp(0.42 + Math.max(0, input.feather ?? 0) * 0.01, 0.18, 0.46)
    const low = Math.max(0.01, effThreshold - band)
    const high = Math.min(0.99, effThreshold + band)
    for (let i = 0; i < out.length; i++) {
      out[i] = smoothstep(low, high, out[i]!)
    }
  } else {
    for (let i = 0; i < out.length; i++) out[i] = out[i]! >= effThreshold ? 1 : 0
  }

  const feather = Math.max(0, Math.round(input.feather ?? 0))
  return feather > 0 ? featherAlpha(out, outW, outH, feather) : out
}

/** 可分离盒式模糊（3 趟近似高斯），把硬边 alpha 羽化成软边 */
export function featherAlpha(
  alpha: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  if (radius <= 0 || width <= 0 || height <= 0) return Float32Array.from(alpha)
  let src = Float32Array.from(alpha)
  let dst = new Float32Array(src.length)
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(src, dst, width, height, radius)
    const t1 = src
    src = dst
    dst = t1
    boxBlurV(src, dst, width, height, radius)
    const t2 = src
    src = dst
    dst = t2
  }
  return src
}

function boxBlurSinglePass(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  if (radius <= 0 || width <= 0 || height <= 0) return Float32Array.from(src)
  const tmp = new Float32Array(src.length)
  const dst = new Float32Array(src.length)
  boxBlurH(src, tmp, width, height, radius)
  boxBlurV(tmp, dst, width, height, radius)
  return dst
}

function boxBlurH(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  const win = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[row + clampInt(x, 0, width - 1)]!
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum / win
      sum +=
        src[row + clampInt(x + radius + 1, 0, width - 1)]! -
        src[row + clampInt(x - radius, 0, width - 1)]!
    }
  }
}

function boxBlurV(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number
): void {
  const win = radius * 2 + 1
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += src[clampInt(y, 0, height - 1) * width + x]!
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / win
      sum +=
        src[clampInt(y + radius + 1, 0, height - 1) * width + x]! -
        src[clampInt(y - radius, 0, height - 1) * width + x]!
    }
  }
}

export interface GuidedRefineOptions {
  /** 引导滤波窗口半径（输出像素，0 表示关闭，默认 4） */
  radius?: number
  /** 引导滤波正则化系数 eps（默认 1e-3） */
  eps?: number
  /** 窄带颜色亲和度 Matting 混合权重 0~1（默认 0.55） */
  colorMattingStrength?: number
  /** 边缘收缩/扩展 -10~+10（默认 0） */
  edgeChoke?: number
}

/**
 * 引导图像滤波 + 窄带颜色亲和度 Alpha 精修（Fast Guided Image Filter + Narrow-Band Color Matting）。
 *
 * 解决痛点：
 * - YOLO 160×160 掩码放大到原图分辨率后，1 个掩码网格对应 6~10 个原图像素，直接二值化+高斯模糊
 *   会导致硬角被磨圆、发丝与细剑刃粘连背景。
 * - 本函数以原图全分辨率 RGB/亮度作为引导图 I，对粗掩码 P 做两步精修：
 *   1. 在轮廓窄带内沿 8 方向采样局部纯前景 F 与纯背景 B，计算像素颜色对 (F, B) 的亲和度投影，
 *      将粗掩码边界吸附到原图真实色彩阶跃边；
 *   2. 执行 O(N) 可分离盒式引导滤波 q = mean_a * I + mean_b，使输出 alpha 严格贴合原图亚像素边缘与发丝。
 */
export function refineCutoutAlphaGuided(
  rgba: Uint8ClampedArray | Uint8Array,
  alpha: Float32Array,
  width: number,
  height: number,
  options: GuidedRefineOptions = {}
): Float32Array {
  const total = width * height
  if (total <= 0 || alpha.length < total || rgba.length < total * 4) {
    return Float32Array.from(alpha)
  }
  const radius = Math.max(0, Math.min(24, Math.round(options.radius ?? 4)))
  const choke = clamp(options.edgeChoke ?? 0, -10, 10)
  if (radius === 0 && choke === 0) {
    return Float32Array.from(alpha)
  }

  const r = Math.max(1, radius || 2)
  const eps = options.eps ?? 1e-3
  const colorStrength = clamp(options.colorMattingStrength ?? 0.55, 0, 1)

  // Step 1: Shared Matting 窄带共享色彩采样（Gastal & Oliveira 思想）
  // 相比仅取 8 方向均值，在更大步长内收集候选前景集 {F_m} 与候选背景集 {B_n}，
  // 遍历配对寻找重构误差 ||C - (α·F_m + (1-α)·B_n)||^2 最小且色彩分离度高的最优 (F*, B*) 样本对，
  // 对蓬松卷发、羽毛、网格镂空及半透明边缘能跨越局部半透明区找到真实前景/背景基底。
  const meanInitial = boxBlurSinglePass(alpha, width, height, Math.max(2, r))
  const prior = Float32Array.from(alpha)

  if (colorStrength > 0 && radius > 0) {
    const dirX = [1, -1, 0, 0, 1, -1, 1, -1]
    const dirY = [0, 0, 1, -1, 1, 1, -1, -1]
    const maxStep = Math.max(10, r * 5)
    const fSamplesR = new Float32Array(8)
    const fSamplesG = new Float32Array(8)
    const fSamplesB = new Float32Array(8)
    const bSamplesR = new Float32Array(8)
    const bSamplesG = new Float32Array(8)
    const bSamplesB = new Float32Array(8)

    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const i = row + x
        const mp = meanInitial[i]!
        // 仅在轮廓窄带内执行 Shared Matting 采样与最优样本对筛选
        if (mp <= 0.015 || mp >= 0.985) continue
        let fCount = 0
        let bCount = 0
        for (let d = 0; d < 8; d++) {
          const dx = dirX[d]!
          const dy = dirY[d]!
          let gotF = false
          let gotB = false
          for (let s = 1; s <= maxStep; s++) {
            const nx = x + dx * s
            const ny = y + dy * s
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) break
            const ni = ny * width + nx
            const na = alpha[ni]!
            if (!gotF && na >= 0.85) {
              const noff = ni * 4
              fSamplesR[fCount] = rgba[noff]!
              fSamplesG[fCount] = rgba[noff + 1]!
              fSamplesB[fCount] = rgba[noff + 2]!
              fCount++
              gotF = true
            } else if (!gotB && na <= 0.12) {
              const noff = ni * 4
              bSamplesR[bCount] = rgba[noff]!
              bSamplesG[bCount] = rgba[noff + 1]!
              bSamplesB[bCount] = rgba[noff + 2]!
              bCount++
              gotB = true
            }
            if (gotF && gotB) break
          }
        }
        if (fCount === 0 || bCount === 0) continue

        const off = i * 4
        const obsR = rgba[off]!
        const obsG = rgba[off + 1]!
        const obsB = rgba[off + 2]!

        // 在候选样本笛卡尔积 {F_m} × {B_n} 中挑选重构残差最小的最佳样本对 (F*, B*)
        let bestAlpha = prior[i]!
        let bestCost = Infinity
        let bestFbDistSq = 0

        for (let fi = 0; fi < fCount; fi++) {
          const fr = fSamplesR[fi]!
          const fg = fSamplesG[fi]!
          const fb = fSamplesB[fi]!
          for (let bi = 0; bi < bCount; bi++) {
            const br = bSamplesR[bi]!
            const bg = bSamplesG[bi]!
            const bb = bSamplesB[bi]!
            const dfbR = fr - br
            const dfbG = fg - bg
            const dfbB = fb - bb
            const fbDistSq = dfbR * dfbR + dfbG * dfbG + dfbB * dfbB
            if (fbDistSq < 300) continue
            const cr = obsR - br
            const cg = obsG - bg
            const cb = obsB - bb
            const estA = clamp((cr * dfbR + cg * dfbG + cb * dfbB) / fbDistSq, 0, 1)
            // 颜色线性混合重构残差 ||C - (estA * F + (1 - estA) * B)||^2
            const resR = cr - estA * dfbR
            const resG = cg - estA * dfbG
            const resB = cb - estA * dfbB
            const reconErrSq = resR * resR + resG * resG + resB * resB
            // 结合粗掩码先验偏差，防止远端偶发同色样本抢夺
            const priorDiff = estA - prior[i]!
            const cost = reconErrSq / (fbDistSq + 256) + priorDiff * priorDiff * 0.18
            if (cost < bestCost) {
              bestCost = cost
              bestAlpha = estA
              bestFbDistSq = fbDistSq
            }
          }
        }

        if (bestFbDistSq < 300) continue
        // 重构误差越小（越符合线性混合物理模型），颜色 Matting 置信度越高
        const confidence = Math.exp(-Math.min(4, bestCost * 2.5))
        const bandWeight = 1 - Math.abs(mp - 0.5) * 2
        const w = colorStrength * clamp(bandWeight * 1.3, 0, 1) * (0.4 + 0.6 * confidence)
        prior[i] = clamp(prior[i]! * (1 - w) + bestAlpha * w, 0, 1)
      }
    }
  }

  // Step 2: Full 3x3 RGB Color-Line Covariance Guided Image Filter (He et al. TPAMI 2013)
  // 相比单通道灰度引导，3×3 RGB 协方差矩阵满足局部色彩线模型（Local Color Line Model），
  // 即使前景与背景等亮度（如红底绿叶、紫底蓝发）也能在三维色彩空间精确分离亚像素发丝 alpha。
  const ir = new Float32Array(total)
  const ig = new Float32Array(total)
  const ib = new Float32Array(total)
  const irr = new Float32Array(total)
  const irg = new Float32Array(total)
  const irb = new Float32Array(total)
  const igg = new Float32Array(total)
  const igb = new Float32Array(total)
  const ibb = new Float32Array(total)
  const irp = new Float32Array(total)
  const igp = new Float32Array(total)
  const ibp = new Float32Array(total)

  for (let i = 0; i < total; i++) {
    const off = i * 4
    const cr = rgba[off]! / 255
    const cg = rgba[off + 1]! / 255
    const cb = rgba[off + 2]! / 255
    const p = prior[i]!
    ir[i] = cr
    ig[i] = cg
    ib[i] = cb
    irr[i] = cr * cr
    irg[i] = cr * cg
    irb[i] = cr * cb
    igg[i] = cg * cg
    igb[i] = cg * cb
    ibb[i] = cb * cb
    irp[i] = cr * p
    igp[i] = cg * p
    ibp[i] = cb * p
  }

  const meanR = boxBlurSinglePass(ir, width, height, r)
  const meanG = boxBlurSinglePass(ig, width, height, r)
  const meanB = boxBlurSinglePass(ib, width, height, r)
  const meanP = boxBlurSinglePass(prior, width, height, r)

  const meanRR = boxBlurSinglePass(irr, width, height, r)
  const meanRG = boxBlurSinglePass(irg, width, height, r)
  const meanRB = boxBlurSinglePass(irb, width, height, r)
  const meanGG = boxBlurSinglePass(igg, width, height, r)
  const meanGB = boxBlurSinglePass(igb, width, height, r)
  const meanBB = boxBlurSinglePass(ibb, width, height, r)

  const meanRP = boxBlurSinglePass(irp, width, height, r)
  const meanGP = boxBlurSinglePass(igp, width, height, r)
  const meanBP = boxBlurSinglePass(ibp, width, height, r)

  const ar = new Float32Array(total)
  const ag = new Float32Array(total)
  const ab = new Float32Array(total)
  const b = new Float32Array(total)

  for (let i = 0; i < total; i++) {
    const mr = meanR[i]!
    const mg = meanG[i]!
    const mb = meanB[i]!
    const mp = meanP[i]!

    const crr = Math.max(0, meanRR[i]! - mr * mr) + eps
    const crg = meanRG[i]! - mr * mg
    const crb = meanRB[i]! - mr * mb
    const cgg = Math.max(0, meanGG[i]! - mg * mg) + eps
    const cgb = meanGB[i]! - mg * mb
    const cbb = Math.max(0, meanBB[i]! - mb * mb) + eps

    const covRP = meanRP[i]! - mr * mp
    const covGP = meanGP[i]! - mg * mp
    const covBP = meanBP[i]! - mb * mp

    // 3x3 对称正定协方差矩阵伴随矩阵求逆
    const invRR = cgg * cbb - cgb * cgb
    const invRG = crb * cgb - crg * cbb
    const invRB = crg * cgb - crb * cgg
    const invGG = crr * cbb - crb * crb
    const invGB = crb * crg - crr * cgb
    const invBB = crr * cgg - crg * crg

    const det = Math.max(1e-12, crr * invRR + crg * invRG + crb * invRB)
    const invDet = 1 / det

    const ari = (invRR * covRP + invRG * covGP + invRB * covBP) * invDet
    const agi = (invRG * covRP + invGG * covGP + invGB * covBP) * invDet
    const abi = (invRB * covRP + invGB * covGP + invBB * covBP) * invDet

    ar[i] = ari
    ag[i] = agi
    ab[i] = abi
    b[i] = mp - ari * mr - agi * mg - abi * mb
  }

  const meanAr = boxBlurSinglePass(ar, width, height, r)
  const meanAg = boxBlurSinglePass(ag, width, height, r)
  const meanAb = boxBlurSinglePass(ab, width, height, r)
  const meanBCoef = boxBlurSinglePass(b, width, height, r)

  // Step 3: 多尺度金字塔细节融合（粗尺度 r 消除阶梯锯齿 + 细尺度 r=1 锁住 1px 尖角与发梢）
  const useMultiScale = radius >= 3
  const fineAr = useMultiScale ? boxBlurSinglePass(ar, width, height, 1) : meanAr
  const fineAg = useMultiScale ? boxBlurSinglePass(ag, width, height, 1) : meanAg
  const fineAb = useMultiScale ? boxBlurSinglePass(ab, width, height, 1) : meanAb
  const fineBCoef = useMultiScale ? boxBlurSinglePass(b, width, height, 1) : meanBCoef

  const out = new Float32Array(total)
  const chokeBias = choke * 0.025
  for (let i = 0; i < total; i++) {
    const mp = meanInitial[i]!
    // 核心实心前景与远离主体的纯背景保持纯净，不引入任何灰雾
    if (mp <= 0.005 && prior[i]! <= 0.01) {
      out[i] = 0
      continue
    }
    if (mp >= 0.995 && prior[i]! >= 0.99 && choke >= 0) {
      out[i] = 1
      continue
    }
    let q = prior[i]!
    if (radius > 0) {
      const qCoarse =
        meanAr[i]! * ir[i]! + meanAg[i]! * ig[i]! + meanAb[i]! * ib[i]! + meanBCoef[i]!
      if (useMultiScale) {
        const qFine =
          fineAr[i]! * ir[i]! + fineAg[i]! * ig[i]! + fineAb[i]! * ib[i]! + fineBCoef[i]!
        // 局部色彩方差越大（处于发丝、剑尖、高对比锐利边缘），细尺度权重越高以锁住 1px 尖角
        const mr = meanR[i]!
        const mg = meanG[i]!
        const mb = meanB[i]!
        const traceVar =
          Math.max(0, meanRR[i]! - mr * mr) +
          Math.max(0, meanGG[i]! - mg * mg) +
          Math.max(0, meanBB[i]! - mb * mb)
        const fineWeight = clamp(traceVar * 18, 0.2, 0.72)
        q = qCoarse * (1 - fineWeight) + qFine * fineWeight
      } else {
        q = qCoarse
      }
    }
    const shifted = q + chokeBias
    // 将 [0.03, 0.97] 映射到 [0, 1] 以消除极低/极高处的残余底灰
    out[i] = smoothstep(0.03, 0.97, shifted)
  }

  // Step 4: 边界连通背景剥离与发丝间隙色彩线抠图（Boundary-Connected Hair Interstice Matting）
  // 解决痛点：高精显著性模型（BiRefNet / RMBG）在稀疏碎发外圈常输出包络式高 alpha，
  // 且当窗口内同时存在「亮肤色 + 深色细发 + 亮白背景」三色时，局部仿射引导滤波无法线性分离同亮度的背景与肤色。
  // 做法：从外部纯背景（alpha < 0.12）向内传播最近背景色 B_ext，若局部窗口存在高对比前景锚点 F_anchor（如深色发丝），
  // 则将边界与发丝间隙像素投影到色彩线 B_ext -> F_anchor，精准剥离夹在发丝之间的背景色，同时通过正交色差残差保护暖色皮肤与同色衣物。
  if (radius > 0 && colorStrength > 0) {
    peelBoundaryHairInterstices(rgba, out, width, height, r)
  }
  return out
}

function peelBoundaryHairInterstices(
  rgba: Uint8ClampedArray | Uint8Array,
  alpha: Float32Array,
  width: number,
  height: number,
  r: number
): void {
  const total = width * height
  const maxDist = Math.max(12, Math.min(28, r * 6))
  const dist = new Int16Array(total).fill(32767)
  const bgR = new Float32Array(total)
  const bgG = new Float32Array(total)
  const bgB = new Float32Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0

  for (let i = 0; i < total; i++) {
    if (alpha[i]! < 0.12) {
      dist[i] = 0
      const off = i * 4
      bgR[i] = rgba[off]!
      bgG[i] = rgba[off + 1]!
      bgB[i] = rgba[off + 2]!
      queue[tail++] = i
    }
  }
  if (tail === 0) return

  const dirX = [-1, 1, 0, 0, -1, 1, -1, 1]
  const dirY = [0, 0, -1, 1, -1, -1, 1, 1]

  while (head < tail) {
    const cur = queue[head++]!
    const d = dist[cur]!
    if (d >= maxDist) continue
    const cx = cur % width
    const cy = (cur - cx) / width
    for (let k = 0; k < 8; k++) {
      const nx = cx + dirX[k]!
      const ny = cy + dirY[k]!
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const ni = ny * width + nx
      if (dist[ni]! <= d + 1) continue
      dist[ni] = d + 1
      bgR[ni] = bgR[cur]!
      bgG[ni] = bgG[cur]!
      bgB[ni] = bgB[cur]!
      queue[tail++] = ni
    }
  }

  const baseAlpha = Float32Array.from(alpha)
  const winR = Math.min(10, Math.max(4, r * 2 + 2))
  const step = winR > 6 ? 2 : 1

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      const d = dist[i]!
      if (d <= 0 || d > maxDist) continue
      const off = i * 4
      const cr = rgba[off]!
      const cg = rgba[off + 1]!
      const cb = rgba[off + 2]!
      const br = bgR[i]!
      const bg = bgG[i]!
      const bb = bgB[i]!

      let contrastSumR = 0
      let contrastSumG = 0
      let contrastSumB = 0
      let contrastW = 0
      let fgTotal = 0
      let fgHighContrast = 0
      let maxContrast = 0

      const y0 = Math.max(0, y - winR)
      const y1 = Math.min(height - 1, y + winR)
      const x0 = Math.max(0, x - winR)
      const x1 = Math.min(width - 1, x + winR)
      for (let wy = y0; wy <= y1; wy += step) {
        const wRow = wy * width
        for (let wx = x0; wx <= x1; wx += step) {
          const wi = wRow + wx
          const wa = baseAlpha[wi]!
          if (wa < 0.35) continue
          fgTotal++
          const woff = wi * 4
          const wr = rgba[woff]! - br
          const wg = rgba[woff + 1]! - bg
          const wb = rgba[woff + 2]! - bb
          const cDist = Math.sqrt((wr * wr + wg * wg + wb * wb) / 3)
          if (cDist >= 38) {
            fgHighContrast++
            const w = cDist * wa
            contrastSumR += rgba[woff]! * w
            contrastSumG += rgba[woff + 1]! * w
            contrastSumB += rgba[woff + 2]! * w
            contrastW += w
            if (cDist > maxContrast) maxContrast = cDist
          }
        }
      }

      // 仅当局部窗口内存在足够比例的高对比前景（如深色发丝/轮廓，排除白衣贴白底的低对比边界）时才执行剥离
      if (contrastW > 0 && maxContrast >= 42 && fgHighContrast >= Math.max(2, fgTotal * 0.25)) {
        const fR = contrastSumR / contrastW
        const fG = contrastSumG / contrastW
        const fB = contrastSumB / contrastW
        const dfR = fR - br
        const dfG = fG - bg
        const dfB = fB - bb
        const dfLenSq = dfR * dfR + dfG * dfG + dfB * dfB
        if (dfLenSq >= 900) {
          const projAlpha = clamp(
            ((cr - br) * dfR + (cg - bg) * dfG + (cb - bb) * dfB) / dfLenSq,
            0,
            1
          )
          const reconR = br + projAlpha * dfR
          const reconG = bg + projAlpha * dfG
          const reconB = bb + projAlpha * dfB
          const dr = cr - reconR
          const dg = cg - reconG
          const db = cb - reconB
          const perpErr = Math.sqrt((dr * dr + dg * dg + db * db) / 3)
          if (perpErr < 24 && projAlpha < alpha[i]!) {
            const cleaned = smoothstep(0.14, 0.96, projAlpha)
            const peelDist = Math.floor(maxDist * 0.62)
            const blend =
              d <= peelDist ? 0.95 : Math.max(0, ((maxDist - d) / (maxDist - peelDist)) * 0.95)
            alpha[i] = alpha[i]! * (1 - blend) + cleaned * blend
          }
        }
      }
    }
  }
}

export interface HolePunchOptions {
  /** 判定为同背景色的归一化色距阈值（0~255，默认 26） */
  colorDistance?: number
  /** 最小内洞像素面积（默认 20，保护白眼珠/细小高光点不被误穿） */
  minHoleArea?: number
  /** 最大内洞占画布面积比（默认 0.25，避免把大块同色服装误判为内洞） */
  maxHoleAreaRatio?: number
}

/**
 * 封闭背景内洞自动穿透（Interior Background Hole Punching）。
 *
 * 解决痛点：
 * - 四边泛洪（applyBorderFloodColorKey）无法进入被手臂叉腰、双腿间、武器护手、圆环封闭包围的背景内洞；
 * - 低分辨率实例分割常将较小的封闭背景内洞与主体糊成一片。
 *
 * 判定准则：
 * 1. 从已透明的外部背景像素（及画布四边）提取主背景色基准；
 * 2. 在主体内部（alpha > 0.15）寻找与主背景色高度接近（色距 < colorDistance）的连通域；
 * 3. 校验该连通域的「外围紧邻前景环」与内洞本身的平均色差：真背景内洞四周是手臂/武器轮廓（边界色差显著），
 *    而白色衣服内部的亮斑四周仍是白色衣服（边界色差小）；同时过滤面积过小（高光点）或过大的区域。
 */
export function punchInteriorBackgroundHoles(
  rgba: Uint8ClampedArray | Uint8Array,
  alpha: Float32Array,
  width: number,
  height: number,
  options: HolePunchOptions = {}
): Float32Array {
  const total = width * height
  const out = Float32Array.from(alpha)
  if (total <= 0 || alpha.length < total || rgba.length < total * 4) return out

  // 1. 统计外部透明区域（alpha < 0.08）与四边的背景代表色
  let bgR = 0,
    bgG = 0,
    bgB = 0,
    bgCount = 0
  const step = Math.max(1, Math.floor(total / 4096))
  for (let i = 0; i < total; i += step) {
    if (out[i]! < 0.08) {
      const off = i * 4
      bgR += rgba[off]!
      bgG += rgba[off + 1]!
      bgB += rgba[off + 2]!
      bgCount++
    }
  }
  if (bgCount < 8) return out
  bgR /= bgCount
  bgG /= bgCount
  bgB /= bgCount

  const distThresh = clamp(options.colorDistance ?? 26, 6, 80)
  const softThresh = distThresh + 14
  const minArea = Math.max(8, Math.floor(options.minHoleArea ?? 20))
  const maxArea = Math.max(minArea + 1, Math.floor(total * (options.maxHoleAreaRatio ?? 0.25)))

  const colorDist = (pixelIdx: number): number => {
    const off = pixelIdx * 4
    const dr = rgba[off]! - bgR
    const dg = rgba[off + 1]! - bgG
    const db = rgba[off + 2]! - bgB
    return Math.sqrt((dr * dr + dg * dg + db * db) / 3)
  }

  // 2. 标记所有与外部透明区四连通的像素，排除非封闭区域
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  for (let i = 0; i < total; i++) {
    if (out[i]! < 0.15) {
      visited[i] = 1
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const idx = queue[head++]!
    const x = idx % width
    const y = (idx - x) / width
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x + 1 < width ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y + 1 < height ? idx + width : -1
    ]
    for (const n of neighbors) {
      if (n >= 0 && !visited[n] && out[n]! < 0.15) {
        visited[n] = 1
        queue[tail++] = n
      }
    }
  }

  // 3. 在内部不透明区域搜索背景色连通域
  const component: number[] = []
  for (let start = 0; start < total; start++) {
    if (visited[start]) continue
    if (colorDist(start) >= distThresh) {
      visited[start] = 1
      continue
    }
    component.length = 0
    head = 0
    tail = 0
    visited[start] = 1
    queue[tail++] = start
    let borderDiffSum = 0
    let borderCount = 0
    let touchesCanvasEdge = false

    while (head < tail) {
      const idx = queue[head++]!
      component.push(idx)
      const x = idx % width
      const y = (idx - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesCanvasEdge = true
      }
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x + 1 < width ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y + 1 < height ? idx + width : -1
      ]
      for (const n of neighbors) {
        if (n < 0) continue
        const nd = colorDist(n)
        if (!visited[n] && nd < distThresh && out[n]! >= 0.15) {
          visited[n] = 1
          queue[tail++] = n
        } else if (nd >= distThresh && out[n]! >= 0.5) {
          borderDiffSum += nd
          borderCount++
        }
      }
    }

    if (touchesCanvasEdge) continue
    if (component.length < minArea || component.length > maxArea) continue
    const avgBorderContrast = borderCount > 0 ? borderDiffSum / borderCount : 0
    // 外围前景环与背景色必须存在显著色差（确认为被异色主体合围的背景孔洞，而非同色衣服内部）
    if (avgBorderContrast < distThresh + 10) continue

    for (const idx of component) {
      out[idx] = 0
      // 对内洞紧邻的 1px 边缘按色距做抗锯齿软化
      const x = idx % width
      const y = (idx - x) / width
      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x + 1 < width ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y + 1 < height ? idx + width : -1
      ]
      for (const n of neighbors) {
        if (n >= 0 && out[n]! > 0) {
          const nd = colorDist(n)
          if (nd >= distThresh && nd < softThresh) {
            const keep = (nd - distThresh) / (softThresh - distThresh)
            if (keep < out[n]!) out[n] = keep
          }
        }
      }
    }
  }

  return out
}

/**
 * 将交互式保留/擦除修补画笔（Keep / Erase Brush Strokes）光栅化叠加到 alpha 通道。
 *
 * 坐标约定：
 * - stroke.points 中的 (x, y) 均为相对原图尺寸 (srcWidth, srcHeight) 的 0~1 归一化坐标；
 * - stroke.radius 为相对 min(srcWidth, srcHeight) 的归一化半径；
 * - 函数自动将其换算至当前输出 region 与 outScale 对应的像素平面，笔触边缘带 30% 软羽化环。
 */
export function applyCutoutBrushStrokes(
  alpha: Float32Array,
  strokes: readonly CutoutBrushStroke[] | undefined | null,
  params: {
    srcWidth: number
    srcHeight: number
    region?: CutoutRegion
    outScale?: number
  }
): Float32Array {
  const out = Float32Array.from(alpha)
  if (!strokes || strokes.length === 0) return out

  const srcW = Math.max(1, Math.floor(params.srcWidth))
  const srcH = Math.max(1, Math.floor(params.srcHeight))
  const region = params.region ?? { x: 0, y: 0, width: srcW, height: srcH }
  const outScale = Math.max(0.01, params.outScale ?? 1)
  const outW = Math.max(1, Math.round(region.width * outScale))
  const outH = Math.max(1, Math.round(region.height * outScale))
  if (out.length < outW * outH) return out

  const shortSide = Math.min(srcW, srcH)

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length === 0) continue
    const target = stroke.mode === 'keep' ? 1 : 0
    const rPx = Math.max(1.5, clamp(stroke.radius, 0.002, 0.3) * shortSide * outScale)
    const innerR = stroke.mode === 'erase' ? rPx * 0.82 : rPx * 0.68
    const rSq = rPx * rPx

    const toOutPt = (p: CutoutBrushPoint): { x: number; y: number } => ({
      x: (clamp(p.x, 0, 1) * srcW - region.x) * outScale,
      y: (clamp(p.y, 0, 1) * srcH - region.y) * outScale
    })

    const segCount = Math.max(1, stroke.points.length - 1)
    for (let s = 0; s < segCount; s++) {
      const p0 = toOutPt(stroke.points[s]!)
      const p1 = toOutPt(stroke.points[Math.min(stroke.points.length - 1, s + 1)]!)
      const minX = clampInt(Math.floor(Math.min(p0.x, p1.x) - rPx - 1), 0, outW - 1)
      const maxX = clampInt(Math.ceil(Math.max(p0.x, p1.x) + rPx + 1), 0, outW - 1)
      const minY = clampInt(Math.floor(Math.min(p0.y, p1.y) - rPx - 1), 0, outH - 1)
      const maxY = clampInt(Math.ceil(Math.max(p0.y, p1.y) + rPx + 1), 0, outH - 1)

      const vx = p1.x - p0.x
      const vy = p1.y - p0.y
      const lenSq = vx * vx + vy * vy

      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5
        const row = y * outW
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5
          let t = 0
          if (lenSq > 1e-6) {
            t = clamp(((px - p0.x) * vx + (py - p0.y) * vy) / lenSq, 0, 1)
          }
          const cx = p0.x + t * vx
          const cy = p0.y + t * vy
          const dx = px - cx
          const dy = py - cy
          const dSq = dx * dx + dy * dy
          if (dSq > rSq) continue
          const d = Math.sqrt(dSq)
          const idx = row + x
          if (d <= innerR) {
            out[idx] = target
          } else {
            const w = 1 - smoothstep(innerR, rPx, d)
            out[idx] = out[idx]! + (target - out[idx]!) * w
          }
        }
      }
    }
  }
  return out
}

export interface BrushDirtyRect {
  minX: number
  minY: number
  dirtyW: number
  dirtyH: number
}

/**
 * 将单段画笔线段 (p0 -> p1) 增量光栅化到 workingAlpha 与 workingRgba，
 * 仅遍历线段局部外接框像素并返回脏矩形，供 Canvas `putImageData` 局部微秒级刷新（< 0.15ms）。
 */
export function stampCutoutBrushSegment(params: {
  workingAlpha: Float32Array
  workingRgba: Uint8ClampedArray | Uint8Array
  rawSourceRgba: Uint8ClampedArray | Uint8Array
  mode: 'keep' | 'erase'
  radiusNorm: number
  p0: CutoutBrushPoint
  p1: CutoutBrushPoint
  srcWidth: number
  srcHeight: number
  region: CutoutRegion
  outScale: number
  outWidth: number
  outHeight: number
}): BrushDirtyRect | null {
  const {
    workingAlpha,
    workingRgba,
    rawSourceRgba,
    mode,
    radiusNorm,
    p0,
    p1,
    srcWidth,
    srcHeight,
    region,
    outScale,
    outWidth: outW,
    outHeight: outH
  } = params
  if (outW <= 0 || outH <= 0) return null
  const srcW = Math.max(1, Math.floor(srcWidth))
  const srcH = Math.max(1, Math.floor(srcHeight))
  const shortSide = Math.min(srcW, srcH)
  const rPx = Math.max(1.5, clamp(radiusNorm, 0.002, 0.3) * shortSide * outScale)
  const innerR = mode === 'erase' ? rPx * 0.82 : rPx * 0.68
  const rSq = rPx * rPx
  const target = mode === 'keep' ? 1 : 0

  const x0 = (clamp(p0.x, 0, 1) * srcW - region.x) * outScale
  const y0 = (clamp(p0.y, 0, 1) * srcH - region.y) * outScale
  const x1 = (clamp(p1.x, 0, 1) * srcW - region.x) * outScale
  const y1 = (clamp(p1.y, 0, 1) * srcH - region.y) * outScale

  const minX = clampInt(Math.floor(Math.min(x0, x1) - rPx - 1), 0, outW - 1)
  const maxX = clampInt(Math.ceil(Math.max(x0, x1) + rPx + 1), 0, outW - 1)
  const minY = clampInt(Math.floor(Math.min(y0, y1) - rPx - 1), 0, outH - 1)
  const maxY = clampInt(Math.ceil(Math.max(y0, y1) + rPx + 1), 0, outH - 1)
  if (minX > maxX || minY > maxY) return null

  const vx = x1 - x0
  const vy = y1 - y0
  const lenSq = vx * vx + vy * vy

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5
    const row = y * outW
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5
      let t = 0
      if (lenSq > 1e-6) {
        t = clamp(((px - x0) * vx + (py - y0) * vy) / lenSq, 0, 1)
      }
      const cx = x0 + t * vx
      const cy = y0 + t * vy
      const dx = px - cx
      const dy = py - cy
      const dSq = dx * dx + dy * dy
      if (dSq > rSq) continue
      const d = Math.sqrt(dSq)
      const idx = row + x
      const nextA =
        d <= innerR
          ? target
          : workingAlpha[idx]! + (target - workingAlpha[idx]!) * (1 - smoothstep(innerR, rPx, d))
      workingAlpha[idx] = nextA
      const off = idx * 4
      if (mode === 'keep') {
        workingRgba[off] = rawSourceRgba[off]!
        workingRgba[off + 1] = rawSourceRgba[off + 1]!
        workingRgba[off + 2] = rawSourceRgba[off + 2]!
      }
      workingRgba[off + 3] = Math.round(clamp(nextA, 0, 1) * 255)
    }
  }

  return {
    minX,
    minY,
    dirtyW: maxX - minX + 1,
    dirtyH: maxY - minY + 1
  }
}

/**
 * 零样本显著性主体掩码提取（Salient Subject Fallback）。
 *
 * 当图像为非 COCO 80 类的游戏道具、武器、药水瓶、魔法图标、二次元立绘且未下载高精抠图模型时，
 * YOLO 实例分割可能返回 0 个实例。本函数通过分析画面四周边框主背景色簇、四边连通泛洪、
 * 封闭背景内洞穿透与中心显著性先验，生成 0~255 软概率掩码与主体外接框，确保任意素材均可稳定抠图。
 */
export function buildSalientSubjectMask(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): { mask: Uint8Array; maskHw: number; box: YoloBox; letterbox: YoloLetterboxGeometry } | null {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const total = w * h
  if (rgba.length < total * 4) return null

  // 1. 从四边采样多个背景代表块（8 块），提取背景调色板
  const patch = Math.max(1, Math.min(8, Math.floor(Math.min(w, h) / 10) || 1))
  const coords = [
    [0, 0],
    [w - patch, 0],
    [0, h - patch],
    [w - patch, h - patch],
    [Math.floor((w - patch) / 2), 0],
    [Math.floor((w - patch) / 2), h - patch],
    [0, Math.floor((h - patch) / 2)],
    [w - patch, Math.floor((h - patch) / 2)]
  ]
  const palette: Array<{ r: number; g: number; b: number }> = []
  for (const [px, py] of coords) {
    let sr = 0,
      sg = 0,
      sb = 0,
      cnt = 0
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const x = clampInt(px! + dx, 0, w - 1)
        const y = clampInt(py! + dy, 0, h - 1)
        const off = (y * w + x) * 4
        if (rgba[off + 3]! < 16) continue
        sr += rgba[off]!
        sg += rgba[off + 1]!
        sb += rgba[off + 2]!
        cnt++
      }
    }
    if (cnt > 0) {
      palette.push({ r: sr / cnt, g: sg / cnt, b: sb / cnt })
    }
  }

  // 若原图自带透明通道（超过 5% 像素已透明），直接使用原图 alpha 作为主体掩码
  let transparentCount = 0
  for (let i = 0; i < total; i++) {
    if (rgba[i * 4 + 3]! < 200) transparentCount++
  }
  const hasNativeAlpha = transparentCount > total * 0.05 && transparentCount < total * 0.98

  const alpha = new Float32Array(total)
  if (hasNativeAlpha) {
    for (let i = 0; i < total; i++) alpha[i] = rgba[i * 4 + 3]! / 255
  } else if (palette.length > 0) {
    const minBgDist = (idx: number): number => {
      const off = idx * 4
      const r = rgba[off]!
      const g = rgba[off + 1]!
      const b = rgba[off + 2]!
      let best = Infinity
      for (const c of palette) {
        const dr = r - c.r
        const dg = g - c.g
        const db = b - c.b
        const d = Math.sqrt((dr * dr + dg * dg + db * db) / 3)
        if (d < best) best = d
      }
      return best
    }

    // 四边连通泛洪：把从画布边缘可达的背景色区域置为透明，过渡带平滑衰减
    const baseDist = 28
    const softSpan = 26
    const visited = new Uint8Array(total)
    const queue = new Int32Array(total)
    let head = 0
    let tail = 0
    alpha.fill(1)

    const tryFlood = (idx: number): void => {
      if (idx < 0 || idx >= total || visited[idx]) return
      visited[idx] = 1
      const d = minBgDist(idx)
      if (d >= baseDist + softSpan) return
      if (d <= baseDist) {
        alpha[idx] = 0
        queue[tail++] = idx
      } else {
        alpha[idx] = smoothstep(baseDist, baseDist + softSpan, d)
        if (d < baseDist + softSpan * 0.55) {
          queue[tail++] = idx
        }
      }
    }

    for (let x = 0; x < w; x++) {
      tryFlood(x)
      tryFlood((h - 1) * w + x)
    }
    for (let y = 1; y < h - 1; y++) {
      tryFlood(y * w)
      tryFlood(y * w + w - 1)
    }
    while (head < tail) {
      const idx = queue[head++]!
      const x = idx % w
      const y = (idx - x) / w
      if (x > 0) tryFlood(idx - 1)
      if (x + 1 < w) tryFlood(idx + 1)
      if (y > 0) tryFlood(idx - w)
      if (y + 1 < height) tryFlood(idx + w)
    }

    // 穿透封闭背景内洞
    const punched = punchInteriorBackgroundHoles(rgba, alpha, w, h)
    alpha.set(punched)
  } else {
    return null
  }

  // 若泛洪抠除的背景不足 2%（复杂自然背景），结合中心-边缘颜色反差构造显著性先验
  let bgPixels = 0
  for (let i = 0; i < total; i++) {
    if (alpha[i]! < 0.5) bgPixels++
  }
  if (bgPixels < total * 0.02 && palette.length > 0) {
    for (let y = 0; y < h; y++) {
      const ny = (y + 0.5) / h - 0.5
      for (let x = 0; x < w; x++) {
        const nx = (x + 0.5) / w - 0.5
        const idx = y * w + x
        const off = idx * 4
        let best = Infinity
        for (const c of palette) {
          const dr = rgba[off]! - c.r
          const dg = rgba[off + 1]! - c.g
          const db = rgba[off + 2]! - c.b
          const d = Math.sqrt((dr * dr + dg * dg + db * db) / 3)
          if (d < best) best = d
        }
        const centerPrior = Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny) * 1.45)
        const colorScore = smoothstep(14, 52, best)
        alpha[idx] = clamp(colorScore * 0.8 + centerPrior * 0.25, 0, 1)
      }
    }
  }

  const refined = refineCutoutAlphaGuided(rgba, alpha, w, h, { radius: 3 })

  // 编码到 letterbox 网格（最大 320×320）并求原图外接框
  const maskHw = Math.min(320, Math.max(160, Math.max(w, h)))
  const geo = letterboxGeometryFor(w, h, maskHw)
  const mask = new Uint8Array(maskHw * maskHw)

  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (refined[y * w + x]! >= 0.2) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    minX = Math.floor(w * 0.1)
    minY = Math.floor(h * 0.1)
    maxX = Math.ceil(w * 0.9) - 1
    maxY = Math.ceil(h * 0.9) - 1
  }

  for (let gy = 0; gy < maskHw; gy++) {
    const sy = (gy + 0.5 - geo.padY) / geo.scale - 0.5
    if (sy < -0.5 || sy > h - 0.5) continue
    const cy = clampInt(Math.round(sy), 0, h - 1)
    for (let gx = 0; gx < maskHw; gx++) {
      const sx = (gx + 0.5 - geo.padX) / geo.scale - 0.5
      if (sx < -0.5 || sx > w - 0.5) continue
      const cx = clampInt(Math.round(sx), 0, w - 1)
      mask[gy * maskHw + gx] = Math.round(clamp(refined[cy * w + cx]!, 0, 1) * 255)
    }
  }

  return {
    mask,
    maskHw,
    box: {
      label: 'subject',
      confidence: 0.92,
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1)
    },
    letterbox: geo
  }
}

/**
 * 选中实例的外接区域（原图坐标，整数像素，clamp 到画面内）。
 * 羽化会把边缘向外扩散，因此按羽化半径 + 边距一起外扩，避免软边被裁掉；
 * 若用户使用「保留画笔 (keep)」在框外涂抹了内容，自动将保留笔触纳入裁剪区域。
 */
export function resolveCutoutRegion(params: {
  boxes: YoloBox[]
  srcWidth: number
  srcHeight: number
  feather?: number
  margin?: number
  brushStrokes?: readonly CutoutBrushStroke[] | null
}): CutoutRegion {
  const srcW = Math.max(1, Math.floor(params.srcWidth))
  const srcH = Math.max(1, Math.floor(params.srcHeight))
  const keepStrokes = (params.brushStrokes ?? []).filter(
    (s) => s.mode === 'keep' && s.points.length > 0
  )
  if (params.boxes.length === 0 && keepStrokes.length === 0) {
    return { x: 0, y: 0, width: srcW, height: srcH }
  }
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const b of params.boxes) {
    x1 = Math.min(x1, b.x)
    y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + b.width)
    y2 = Math.max(y2, b.y + b.height)
  }
  const shortSide = Math.min(srcW, srcH)
  for (const stroke of keepStrokes) {
    const rPx = clamp(stroke.radius, 0.002, 0.3) * shortSide
    for (const pt of stroke.points) {
      const px = clamp(pt.x, 0, 1) * srcW
      const py = clamp(pt.y, 0, 1) * srcH
      x1 = Math.min(x1, px - rPx)
      y1 = Math.min(y1, py - rPx)
      x2 = Math.max(x2, px + rPx)
      y2 = Math.max(y2, py + rPx)
    }
  }
  const pad =
    Math.max(0, Math.round(params.feather ?? 0)) + Math.max(0, Math.round(params.margin ?? 0))
  const left = clampInt(Math.floor(x1) - pad, 0, srcW - 1)
  const top = clampInt(Math.floor(y1) - pad, 0, srcH - 1)
  const right = clampInt(Math.ceil(x2) + pad, left + 1, srcW)
  const bottom = clampInt(Math.ceil(y2) + pad, top + 1, srcH)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 把 0~1 的 alpha 写入 RGBA 像素的第 4 字节（就地修改） */
export function applyAlphaToRgba(rgba: Uint8ClampedArray | Uint8Array, alpha: Float32Array): void {
  const count = Math.min(alpha.length, rgba.length >> 2)
  for (let i = 0; i < count; i++) {
    rgba[i * 4 + 3] = Math.round(clamp(alpha[i]!, 0, 1) * 255)
  }
}

export interface DefringeOptions {
  /** 向外搜索纯背景像素的最大步数（输出像素）。默认 48 */
  maxSearch?: number
  /** alpha 低于该值视为「纯背景」像素，用于估计背景色。默认 0.05 */
  bgAlphaThresh?: number
  /** 仅处理 alpha 落在此区间的过渡像素（避免无谓计算与噪声）。默认 [0.05, 0.95] */
  minAlpha?: number
  maxAlpha?: number
  /** 去污染强度 0~1，1 为完全按反混合公式替换。默认 0.9 */
  strength?: number
}

/**
 * 边缘背景去污染（Multi-Directional Defringe），消除发丝 / 轮廓四周的光晕。
 *
 * 做法：
 * 1. 对每个半透明像素，沿 8 个方向（正交 + 对角线）向外找最近的纯背景像素（alpha < bgAlphaThresh），
 *    按距离反比加权估计局部背景色 B，同时搜索最近的不透明前景像素估计局部前景色 F_ref；
 * 2. 用前景反混合公式 F = (C - (1-α)·B) / α 恢复前景色；
 * 3. 当 α 很小时（< 0.35），将反混合结果向局部真实前景色 F_ref 正则化约束，防止除以小 α 放大噪点或产生亮斑。
 */
export function defringeRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  alpha: Float32Array,
  width: number,
  height: number,
  opts: DefringeOptions = {}
): void {
  const maxSearch = opts.maxSearch ?? 48
  const bgThresh = opts.bgAlphaThresh ?? 0.05
  const minA = opts.minAlpha ?? 0.05
  const maxA = opts.maxAlpha ?? 0.95
  const strength = clamp(opts.strength ?? 0.9, 0, 1)
  const dirX = [1, -1, 0, 0, 1, -1, 1, -1]
  const dirY = [0, 0, 1, -1, 1, 1, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = alpha[i]!
      if (a < minA || a > maxA) continue
      let br = 0
      let bg = 0
      let bb = 0
      let bWeight = 0
      let fr = 0
      let fg = 0
      let fb = 0
      let fWeight = 0
      for (let d = 0; d < 8; d++) {
        const dx = dirX[d]!
        const dy = dirY[d]!
        let foundBg = false
        let foundFg = false
        for (let s = 1; s <= maxSearch; s++) {
          const nx = x + dx * s
          const ny = y + dy * s
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) break
          const na = alpha[ny * width + nx]!
          const w = 1 / s
          if (!foundBg && na < bgThresh) {
            const off = (ny * width + nx) * 4
            br += rgba[off]! * w
            bg += rgba[off + 1]! * w
            bb += rgba[off + 2]! * w
            bWeight += w
            foundBg = true
          } else if (!foundFg && na > maxA) {
            const off = (ny * width + nx) * 4
            fr += rgba[off]! * w
            fg += rgba[off + 1]! * w
            fb += rgba[off + 2]! * w
            fWeight += w
            foundFg = true
          }
          if (foundBg && foundFg) break
        }
      }
      if (bWeight <= 0) continue
      const estBr = br / bWeight
      const estBg = bg / bWeight
      const estBb = bb / bWeight

      // 搜索邻域内高对比度前景锚点（如深色发丝），避免半透明发梢向远端浅色皮肤去污染导致残留灰白光晕
      let hcR = 0
      let hcG = 0
      let hcB = 0
      let hcW = 0
      if (a < 0.65) {
        const y0 = Math.max(0, y - 6)
        const y1 = Math.min(height - 1, y + 6)
        const x0 = Math.max(0, x - 6)
        const x1 = Math.min(width - 1, x + 6)
        for (let wy = y0; wy <= y1; wy += 2) {
          const wRow = wy * width
          for (let wx = x0; wx <= x1; wx += 2) {
            const wi = wRow + wx
            if (wi === i) continue
            const wa = alpha[wi]!
            if (wa < 0.6) continue
            const woff = wi * 4
            const wr = rgba[woff]!
            const wg = rgba[woff + 1]!
            const wb = rgba[woff + 2]!
            const dbr = wr - estBr
            const dbg = wg - estBg
            const dbb = wb - estBb
            const cDist = Math.sqrt((dbr * dbr + dbg * dbg + dbb * dbb) / 3)
            if (cDist >= 38) {
              const w = cDist * wa
              hcR += wr * w
              hcG += wg * w
              hcB += wb * w
              hcW += w
            }
          }
        }
      }

      const inv = 1 / Math.max(a, 0.08)
      const off = i * 4
      let r = (rgba[off]! - (1 - a) * estBr) * inv
      let g = (rgba[off + 1]! - (1 - a) * estBg) * inv
      let b = (rgba[off + 2]! - (1 - a) * estBb) * inv
      if (hcW > 0 && a < 0.65) {
        const refR = hcR / hcW
        const refG = hcG / hcW
        const refB = hcB / hcW
        const reg = clamp((0.65 - a) / 0.65, 0, 0.72)
        r = r * (1 - reg) + refR * reg
        g = g * (1 - reg) + refG * reg
        b = b * (1 - reg) + refB * reg
      } else if (fWeight > 0 && a < 0.35) {
        const refR = fr / fWeight
        const refG = fg / fWeight
        const refB = fb / fWeight
        const reg = clamp((0.35 - a) / 0.35, 0, 0.65)
        r = r * (1 - reg) + refR * reg
        g = g * (1 - reg) + refG * reg
        b = b * (1 - reg) + refB * reg
      }
      rgba[off] = clampInt(Math.round(rgba[off]! + (r - rgba[off]!) * strength), 0, 255)
      rgba[off + 1] = clampInt(Math.round(rgba[off + 1]! + (g - rgba[off + 1]!) * strength), 0, 255)
      rgba[off + 2] = clampInt(Math.round(rgba[off + 2]! + (b - rgba[off + 2]!) * strength), 0, 255)
    }
  }
}
