/**
 * 单层 AI 修补（UI 图层拆分编辑器内选中单个前景图层调用生图模型修补锯齿/残缺/遮挡孔洞）：
 *
 * - 为不同尺寸与极端长宽比（如 24×24 小图标、600×24 细长血条）构建防拉伸且满足云端最小像素限制的参考垫图；
 * - 针对非原生透明生图模型自动挑选与前景外沿高对比度的纯色平涂底，避免黑底吞没深色描边或棋盘格污染；
 * - 对生图结果先还原几何裁剪，再自动识别是否已带原生 Alpha；若为不透明底则执行外圈泛洪去底 + 边缘反解去杂色。
 *
 * 纯 RGBA 缓冲区与纯函数实现，零 DOM / IPC 依赖，便于单测直接覆盖。
 */

import type { ImageLayerSplitState } from './imageLayerSplit'
import {
  cloneImage,
  compositeOver,
  createImage,
  cropImage,
  fillHoles,
  inpaintPushPull,
  nearestAspectRatio,
  resizeBilinear,
  type RgbaImage
} from './uiPreciseSplit'

export interface PreparedLayerRepairReference {
  image: RgbaImage
  aspectRatio: string
  cropLeft: number
  cropTop: number
  workWidth: number
  workHeight: number
  matteRgb: [number, number, number] | null
  keepOpaque: boolean
}

const ASPECT_RATIO_VALUES: Readonly<Record<string, number>> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '9:16': 9 / 16
}

const RESOLVED_AI_REPAIR_QA_ISSUES: ReadonlySet<string> = new Set([
  'occluded_blurry',
  'occluded_not_completed',
  'edge_halo'
])

const EXPLICIT_CUTOUT_HINT_RE =
  /抠图|去底|去背景|透明底|透明背景|抠除背景|\b(?:cutout|remove\s+background|transparent\s+background)\b/i // cjk-ok

export function isExplicitLayerCutoutHint(prompt: string): boolean {
  const trimmed = prompt.trim()
  return trimmed.length > 0 && EXPLICIT_CUTOUT_HINT_RE.test(trimmed)
}

/**
 * 规整单层 AI 修补分辨率：生图编辑接口不支持 'auto' 与 Qwen 专属的 '1.5K'，统一归一为 '2K'。
 */
export function normalizeLayerRepairResolution(resolution: string | undefined): string {
  const r = String(resolution ?? '').trim()
  if (!r || r === 'auto' || r === '1.5K') return '2K'
  return r
}

function countTransparentPixels(img: RgbaImage, alphaThreshold = 24): number {
  const { data } = img
  const n = img.width * img.height
  let count = 0
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3]! < alphaThreshold) count++
  }
  return count
}

function hasOriginalTransparency(img: RgbaImage): boolean {
  const n = img.width * img.height
  if (n <= 0) return false
  return countTransparentPixels(img, 24) >= Math.max(4, Math.round(n * 0.02))
}

function hasOpaqueOuterBorder(img: RgbaImage): boolean {
  const { width: W, height: H, data } = img
  if (W <= 0 || H <= 0) return false
  let total = 0
  let opaque = 0
  for (let x = 0; x < W; x++) {
    total += 2
    if (data[x * 4 + 3]! >= 200) opaque++
    if (data[((H - 1) * W + x) * 4 + 3]! >= 200) opaque++
  }
  for (let y = 1; y < H - 1; y++) {
    total += 2
    if (data[y * W * 4 + 3]! >= 200) opaque++
    if (data[(y * W + (W - 1)) * 4 + 3]! >= 200) opaque++
  }
  return total > 0 && opaque / total >= 0.75
}

/**
 * 从中性纯白、深石板灰、绿幕、天青四个候选纯色底中，挑选与前景外沿像素色差最大的底色；
 * 中性纯白/深灰在最小分位色差足够大（>= 72）时优先采用，避免彩色底对半透明边缘产生环境反光染色。
 */
export function pickContrastMatteRgb(orig: RgbaImage): [number, number, number] {
  const { width: W, height: H, data } = orig
  const edgeColors: Array<[number, number, number]> = []
  const maxSamples = 1200
  const n = W * H
  const step = Math.max(1, Math.floor(n / maxSamples))

  for (let p = 0; p < n; p += step) {
    const a = data[p * 4 + 3]!
    if (a < 24) continue
    const y = Math.floor(p / W)
    const x = p - y * W
    let touchesBg = x === 0 || x === W - 1 || y === 0 || y === H - 1 || a < 220
    if (!touchesBg) {
      if (
        data[(p - 1) * 4 + 3]! < 48 ||
        data[(p + 1) * 4 + 3]! < 48 ||
        data[(p - W) * 4 + 3]! < 48 ||
        data[(p + W) * 4 + 3]! < 48
      ) {
        touchesBg = true
      }
    }
    if (touchesBg) {
      edgeColors.push([data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!])
    }
  }

  if (!edgeColors.length) {
    for (let p = 0; p < n; p += step) {
      if (data[p * 4 + 3]! >= 24) {
        edgeColors.push([data[p * 4]!, data[p * 4 + 1]!, data[p * 4 + 2]!])
      }
    }
  }
  if (!edgeColors.length) return [246, 248, 252]

  const candidates: Array<{ rgb: [number, number, number]; neutral: boolean }> = [
    { rgb: [246, 248, 252], neutral: true },
    { rgb: [20, 24, 32], neutral: true },
    { rgb: [38, 198, 102], neutral: false },
    { rgb: [56, 189, 248], neutral: false }
  ]

  let best = candidates[0]!.rgb
  let bestScore = -1
  for (const cand of candidates) {
    const [cr, cg, cb] = cand.rgb
    const dists = edgeColors.map(([r, g, b]) => Math.hypot(r - cr, g - cg, b - cb))
    dists.sort((a, b) => a - b)
    const p05 = dists[Math.floor(dists.length * 0.05)] ?? dists[0]!
    const p20 = dists[Math.floor(dists.length * 0.2)] ?? dists[0]!
    const baseScore = p05 * 0.7 + p20 * 0.3
    const bonus = cand.neutral && p05 >= 72 ? 32 : 0
    const score = baseScore + bonus
    if (score > bestScore) {
      bestScore = score
      best = cand.rgb
    }
  }
  return best
}

/**
 * 构建发送给生图模型的单层参考图：
 * 1) 若图层宽高比超出标准画幅范围（如 12:1 横条），先居中垫入匹配标准画幅的工作画布，防止模型返回后被强行压扁；
 * 2) 若模型不支持原生 RGBA 透明图且原层含透明外框，垫上高对比度均匀纯色底；
 * 3) 对过小控件（如 24×24 图标）等比放大至 API 安全像素尺寸（长边 >= 512，短边 >= 128）。
 */
export function prepareLayerRepairReference(
  orig: RgbaImage,
  opts: {
    nativeTransparent: boolean
    isBase?: boolean
    minSide?: number
    minLongSide?: number
  }
): PreparedLayerRepairReference {
  const W = Math.max(1, orig.width)
  const H = Math.max(1, orig.height)
  const aspectRatio = nearestAspectRatio(W, H)
  const targetRatio = ASPECT_RATIO_VALUES[aspectRatio] ?? 1
  const origRatio = W / H

  let workWidth = W
  let workHeight = H
  if (Math.abs(Math.log(origRatio / targetRatio)) > 0.08) {
    if (origRatio > targetRatio) {
      workWidth = W
      workHeight = Math.max(H, Math.round(W / targetRatio))
    } else {
      workHeight = H
      workWidth = Math.max(W, Math.round(H * targetRatio))
    }
  }

  const cropLeft = Math.floor((workWidth - W) / 2)
  const cropTop = Math.floor((workHeight - H) / 2)

  // 底图（Base）：若外圈本身是整幅不透明背景图（仅内部存在剥离留下的透明白洞），
  // 先用推拉金字塔预填内部白洞，避免生图模型把黑洞/透明洞误判为新控件框，并标记保持整图不透明。
  const keepOpaque = Boolean(opts.isBase && hasOpaqueOuterBorder(orig))
  let sourceForRef = orig
  if (keepOpaque && countTransparentPixels(orig, 240) > 0) {
    sourceForRef = cloneImage(orig)
    const n = W * H
    const hole = new Uint8Array(n)
    let hasHole = false
    for (let p = 0; p < n; p++) {
      if (sourceForRef.data[p * 4 + 3]! < 240) {
        hole[p] = 1
        hasHole = true
      }
    }
    if (hasHole) {
      inpaintPushPull(sourceForRef, hole)
      for (let p = 0; p < n; p++) {
        sourceForRef.data[p * 4 + 3] = 255
      }
    }
  }

  const origTransparent = !keepOpaque && hasOriginalTransparency(sourceForRef)
  const useMatte =
    !keepOpaque &&
    !opts.nativeTransparent &&
    (origTransparent || workWidth !== W || workHeight !== H)
  const matteRgb = useMatte ? pickContrastMatteRgb(sourceForRef) : null

  const workCanvas = createImage(workWidth, workHeight)
  if (matteRgb) {
    const [mr, mg, mb] = matteRgb
    for (let p = 0; p < workWidth * workHeight; p++) {
      const i = p * 4
      workCanvas.data[i] = mr
      workCanvas.data[i + 1] = mg
      workCanvas.data[i + 2] = mb
      workCanvas.data[i + 3] = 255
    }
  } else if (keepOpaque && (workWidth !== W || workHeight !== H)) {
    const fallback = pickContrastMatteRgb(sourceForRef)
    for (let p = 0; p < workWidth * workHeight; p++) {
      const i = p * 4
      workCanvas.data[i] = fallback[0]
      workCanvas.data[i + 1] = fallback[1]
      workCanvas.data[i + 2] = fallback[2]
      workCanvas.data[i + 3] = 255
    }
  }
  compositeOver(workCanvas, sourceForRef, cropLeft, cropTop)

  const minLongSide = Math.max(64, opts.minLongSide ?? 512)
  const minSide = Math.max(32, opts.minSide ?? 128)
  const curLong = Math.max(workWidth, workHeight)
  const curShort = Math.min(workWidth, workHeight)
  const scale = Math.max(1, Math.min(8, Math.max(minLongSide / curLong, minSide / curShort)))
  const image =
    scale > 1.01
      ? resizeBilinear(
          workCanvas,
          Math.max(1, Math.round(workWidth * scale)),
          Math.max(1, Math.round(workHeight * scale))
        )
      : workCanvas

  return {
    image,
    aspectRatio,
    cropLeft,
    cropTop,
    workWidth,
    workHeight,
    matteRgb,
    keepOpaque
  }
}

export function buildLayerRepairPrompt(input: {
  userInstruction: string
  layerName: string
  locale?: string
  nativeTransparent: boolean
  matteRgb: [number, number, number] | null
  isBase?: boolean
}): string {
  const isZh = String(input.locale || '')
    .toLowerCase()
    .startsWith('zh')
  const instruction = input.userInstruction.trim()

  if (input.isBase) {
    if (instruction) {
      return isZh
        ? `${instruction}。请原位修补这张游戏 UI 界面的底层背景底图（已剥离前景控件），无缝延续周围原有的背景材质、底板纹理与光影过渡，严格保持整张底图的构图、尺寸与色调一致，严禁重新生成无关的按钮、图标或文字控件。` // cjk-ok
        : `${instruction}. Repair this game UI underlying base background plate in-place (foreground widgets have been peeled off), seamlessly continuing the surrounding background texture, panel material, and lighting while strictly preserving the exact composition, dimensions, and color palette, without adding any new buttons, icons, or text.`
    }
    return isZh
      ? '这是游戏 UI 界面剥离上层前景控件后的底层背景底图。请原位消除底板上残留的控件边缘印记、外发光残影、投影痕迹或修补模糊块，无缝延续周围干净区域的背景纹理、面板材质与光影过渡，严格保持整张底图的尺寸、构图与边界不变，严禁新增任何按钮、图标或文字。' // cjk-ok
      : 'This is the underlying game UI base background plate after foreground controls were peeled off. Cleanly remove any leftover control edge ghosting, outer glow residue, cast shadows, or blurry inpaint patches in-place by seamlessly continuing the surrounding clean background texture, panel material, and lighting, strictly preserving the exact dimensions and framing without adding any buttons, icons, or text.'
  }

  const name = input.layerName.trim() || (isZh ? 'UI 元件' : 'UI element') // cjk-ok

  if (input.nativeTransparent) {
    if (instruction) {
      return isZh
        ? `${instruction}。请直接在原生透明/半透明背景（RGBA 透明通道）上原位输出修补后的独立 UI 元件「${name}」，严格保持元件在画面中的位置、比例、外轮廓、材质与配色一致，外围背景直接生成透明通道（严禁填充纯色底或绘制灰白棋盘格纹理）。` // cjk-ok
        : `${instruction}. Directly output the repaired isolated UI element "${name}" in-place on a true transparent/semi-transparent background (RGBA alpha channel), strictly preserving its exact position, scale, silhouette, colors, and borders, with a transparent exterior background (no solid fill and strictly no checkerboard pattern).`
    }
    return isZh
      ? `这是游戏 UI 元件「${name}」的独立图层。请直接在原生透明/半透明背景（RGBA 透明通道）上原位修补该元件因上层子控件剥离留下的残缺孔洞、遮挡痕迹或边缘锯齿，延续原有的材质、边框与光影，外围背景直接生成透明通道（严禁填充纯色底或绘制灰白棋盘格纹理），不要改变位置与尺寸，不要新增文字或多余装饰。` // cjk-ok
      : `This is an isolated game UI element layer ("${name}"). Directly repair any occlusion holes, missing surface texture, or jagged edges in-place on a true transparent/semi-transparent background (RGBA alpha channel), preserving its exact position, scale, silhouette, borders, and lighting, with a transparent exterior (no solid fill and no checkerboard pattern), and do not add new text or icons.`
  }

  const matteDescZh = input.matteRgb
    ? '严格保持参考图外围单一均匀纯色平涂背景不变（严禁添加渐变、投影、场景杂物或灰白棋盘格纹理）' // cjk-ok
    : '严格保持元件原有的边界与构图不变' // cjk-ok
  const matteDescEn = input.matteRgb
    ? 'strictly keep the exact flat uniform solid-color exterior background from the reference image unchanged (no gradients, no cast shadows, no clutter, and strictly no checkerboard pattern)'
    : 'strictly preserve the original bounds and framing'

  if (instruction) {
    return isZh
      ? `${instruction}。请原位修补参考图中的独立 UI 元件「${name}」，严格保持元件在画面中的位置、尺寸比例、外轮廓、材质与配色一致，边缘清晰顺滑无锯齿；${matteDescZh}，不要新增无关文字或装饰。` // cjk-ok
      : `${instruction}. Repair the isolated UI element "${name}" strictly in-place, preserving its exact position, scale, silhouette, materials, and colors with crisp smooth anti-aliased edges; ${matteDescEn}, and do not add extra text or decorations.`
  }
  return isZh
    ? `这是游戏 UI 元件「${name}」的独立图层参考图。请原位修补该元件因上层子控件剥离留下的残缺孔洞、遮挡痕迹与边缘锯齿，自然延续元件原有的材质、边框与光影过渡，严格保持其在画面中的位置、比例与外轮廓不变；${matteDescZh}，不要新增任何文字或图标。` // cjk-ok
    : `This is a reference image of an isolated game UI element ("${name}"). Repair any occlusion holes, missing surface texture, and jagged edges strictly in-place, continuing its existing material, borders, and lighting while keeping its exact position, scale, and silhouette; ${matteDescEn}, and do not add any new text or icons.`
}

/**
 * 检测模型返回图像是否本身已具备有效的原生外圈透明通道（避免误将原生半透明光效覆盖为不透明）。
 */
export function hasNativeExteriorTransparency(img: RgbaImage, orig?: RgbaImage): boolean {
  const { width: W, height: H, data } = img
  if (W <= 0 || H <= 0) return false
  let borderTotal = 0
  let borderTransparent = 0
  for (let x = 0; x < W; x++) {
    borderTotal += 2
    if (data[x * 4 + 3]! < 180) borderTransparent++
    if (data[((H - 1) * W + x) * 4 + 3]! < 180) borderTransparent++
  }
  for (let y = 1; y < H - 1; y++) {
    borderTotal += 2
    if (data[y * W * 4 + 3]! < 180) borderTransparent++
    if (data[(y * W + (W - 1)) * 4 + 3]! < 180) borderTransparent++
  }
  if (borderTotal > 0 && borderTransparent / borderTotal >= 0.2) return true

  if (orig && orig.width === W && orig.height === H) {
    let extTotal = 0
    let extTransparent = 0
    const n = W * H
    for (let p = 0; p < n; p++) {
      if (orig.data[p * 4 + 3]! < 16) {
        extTotal++
        if (data[p * 4 + 3]! < 180) extTransparent++
      }
    }
    if (extTotal >= 8 && extTransparent / extTotal >= 0.25) return true
  }
  return false
}

function dilateBinaryBox(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Uint8Array(mask)
  const horiz = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let count = 0
    for (let x = 0; x <= Math.min(width - 1, r); x++) count += mask[row + x]!
    for (let x = 0; x < width; x++) {
      if (count > 0) horiz[row + x] = 1
      const addIdx = x + r + 1
      if (addIdx < width) count += mask[row + addIdx]!
      const subIdx = x - r
      if (subIdx >= 0) count -= mask[row + subIdx]!
    }
  }
  const out = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    let count = 0
    for (let y = 0; y <= Math.min(height - 1, r); y++) count += horiz[y * width + x]!
    for (let y = 0; y < height; y++) {
      if (count > 0) out[y * width + x] = 1
      const addIdx = y + r + 1
      if (addIdx < height) count += horiz[addIdx * width + x]!
      const subIdx = y - r
      if (subIdx >= 0) count -= horiz[subIdx * width + x]!
    }
  }
  return out
}

/**
 * 在原地将非原生透明模型返回的不透明底图抠除为干净 RGBA 透明通道，并对 1~2px 边缘做色差反解与软边抗锯齿。
 */
export function stripOpaqueRepairBackgroundInPlace(
  generated: RgbaImage,
  orig?: RgbaImage,
  opts?: { matteRgb?: [number, number, number] | null; forceCutout?: boolean }
): void {
  const { width: W, height: H, data } = generated
  const n = W * H
  if (n <= 0) return

  const hasOrig = orig != null && orig.width === W && orig.height === H
  const origTransparent = hasOrig && orig ? hasOriginalTransparency(orig) : false

  // 若原图层本身就是完全不透明的实心矩形卡片，且既未垫底也未显式要求抠图，则保留实心不透明避免误啃四角
  if (hasOrig && !origTransparent && !opts?.matteRgb && !opts?.forceCutout) {
    return
  }

  const isBg = new Uint8Array(n)
  const seedOff = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let qHead = 0
  let qTail = 0

  const pushSeed = (p: number, refOff = p * 4): void => {
    if (isBg[p]) return
    isBg[p] = 1
    seedOff[p] = refOff
    queue[qTail++] = p
  }

  let allowedZone: Uint8Array | null = null
  if (origTransparent && orig) {
    const rawFg = new Uint8Array(n)
    for (let p = 0; p < n; p++) {
      if (orig.data[p * 4 + 3]! >= 16) rawFg[p] = 1
    }
    const closedSilhouette = fillHoles(rawFg, W, H)
    const margin = Math.max(4, Math.min(18, Math.round(Math.min(W, H) * 0.06)))
    allowedZone = dilateBinaryBox(closedSilhouette, W, H, margin)

    const rList: number[] = []
    const gList: number[] = []
    const bList: number[] = []
    for (let p = 0; p < n; p++) {
      if (orig.data[p * 4 + 3]! < 16) {
        const i = p * 4
        rList.push(data[i]!)
        gList.push(data[i + 1]!)
        bList.push(data[i + 2]!)
      }
    }
    rList.sort((a, b) => a - b)
    gList.sort((a, b) => a - b)
    bList.sort((a, b) => a - b)
    const mr = rList[rList.length >> 1] ?? opts?.matteRgb?.[0] ?? 0
    const mg = gList[gList.length >> 1] ?? opts?.matteRgb?.[1] ?? 0
    const mb = bList[bList.length >> 1] ?? opts?.matteRgb?.[2] ?? 0

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        if (!allowedZone[p]) {
          pushSeed(p)
          continue
        }
        const onBorder = x === 0 || x === W - 1 || y === 0 || y === H - 1
        const origA = orig.data[p * 4 + 3]!
        if (origA >= 24 && !onBorder) continue
        const i = p * 4
        const dMed = Math.hypot(data[i]! - mr, data[i + 1]! - mg, data[i + 2]! - mb)
        const dMatte = opts?.matteRgb
          ? Math.hypot(
              data[i]! - opts.matteRgb[0],
              data[i + 1]! - opts.matteRgb[1],
              data[i + 2]! - opts.matteRgb[2]
            )
          : Infinity
        if (onBorder && origA < 64) {
          pushSeed(p)
        } else if (origA < 16 && Math.min(dMed, dMatte) <= 52) {
          pushSeed(p)
        }
      }
    }
  }

  if (qTail === 0) {
    const corners = [
      0,
      W - 1,
      (H - 1) * W,
      (H - 1) * W + (W - 1),
      Math.min(n - 1, W + 1),
      Math.max(0, (H - 2) * W + (W - 2))
    ]
    for (const cp of corners) pushSeed(cp)
    for (let x = 0; x < W; x++) {
      const topP = x
      const botP = (H - 1) * W + x
      for (const cp of corners) {
        const ci = cp * 4
        if (
          Math.hypot(
            data[topP * 4]! - data[ci]!,
            data[topP * 4 + 1]! - data[ci + 1]!,
            data[topP * 4 + 2]! - data[ci + 2]!
          ) <= 30
        ) {
          pushSeed(topP, ci)
        }
        if (
          Math.hypot(
            data[botP * 4]! - data[ci]!,
            data[botP * 4 + 1]! - data[ci + 1]!,
            data[botP * 4 + 2]! - data[ci + 2]!
          ) <= 30
        ) {
          pushSeed(botP, ci)
        }
      }
    }
    for (let y = 0; y < H; y++) {
      const leftP = y * W
      const rightP = y * W + (W - 1)
      for (const cp of corners) {
        const ci = cp * 4
        if (
          Math.hypot(
            data[leftP * 4]! - data[ci]!,
            data[leftP * 4 + 1]! - data[ci + 1]!,
            data[leftP * 4 + 2]! - data[ci + 2]!
          ) <= 30
        ) {
          pushSeed(leftP, ci)
        }
        if (
          Math.hypot(
            data[rightP * 4]! - data[ci]!,
            data[rightP * 4 + 1]! - data[ci + 1]!,
            data[rightP * 4 + 2]! - data[ci + 2]!
          ) <= 30
        ) {
          pushSeed(rightP, ci)
        }
      }
    }
  }

  while (qHead < qTail) {
    const p = queue[qHead++]!
    const py = Math.floor(p / W)
    const px = p - py * W
    const pi = p * 4
    const sOff = seedOff[p]!
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= H) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = px + dx
        if (nx < 0 || nx >= W) continue
        const np = ny * W + nx
        if (isBg[np]) continue
        const ni = np * 4
        const step = Math.hypot(
          data[pi]! - data[ni]!,
          data[pi + 1]! - data[ni + 1]!,
          data[pi + 2]! - data[ni + 2]!
        )
        const seedDist = Math.hypot(
          data[sOff]! - data[ni]!,
          data[sOff + 1]! - data[ni + 1]!,
          data[sOff + 2]! - data[ni + 2]!
        )
        const origA = hasOrig && orig ? orig.data[np * 4 + 3]! : 255
        const maxStep = origA < 24 ? 32 : 16
        const maxSeed = origA < 24 ? 58 : 34
        if (step <= maxStep && seedDist <= maxSeed) {
          isBg[np] = 1
          seedOff[np] = sOff
          queue[qTail++] = np
        }
      }
    }
  }

  let bgCount = 0
  for (let p = 0; p < n; p++) bgCount += isBg[p]!
  if (bgCount > n * 0.96 && origTransparent && orig) {
    for (let p = 0; p < n; p++) {
      data[p * 4 + 3] = orig.data[p * 4 + 3]!
    }
    return
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      const i = p * 4
      if (isBg[p]) {
        data[i + 3] = 0
        continue
      }
      let nearBgOff = -1
      let minBgDist = Infinity
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          const np = ny * W + nx
          if (!isBg[np]) continue
          const bi = np * 4
          const d = Math.hypot(
            data[i]! - data[bi]!,
            data[i + 1]! - data[bi + 1]!,
            data[i + 2]! - data[bi + 2]!
          )
          if (d < minBgDist) {
            minBgDist = d
            nearBgOff = bi
          }
        }
      }
      if (nearBgOff >= 0 && minBgDist < 46) {
        const t = Math.max(0.08, Math.min(1, (minBgDist - 6) / 40))
        const alpha = t * t * (3 - 2 * t)
        data[i + 3] = Math.round(alpha * 255)
        if (alpha > 0.12 && alpha < 0.98) {
          for (let c = 0; c < 3; c++) {
            const u = data[i + c]!
            const b = data[nearBgOff + c]!
            data[i + c] = Math.max(0, Math.min(255, Math.round((u - b * (1 - alpha)) / alpha)))
          }
        }
      } else {
        data[i + 3] = 255
      }
    }
  }
}

/**
 * 将生图模型返回的修补大图还原回原图层的精确像素尺寸与透明通道。
 */
export function finalizeLayerRepairRgba(
  generated: RgbaImage,
  orig: RgbaImage,
  refMeta: Pick<
    PreparedLayerRepairReference,
    'cropLeft' | 'cropTop' | 'workWidth' | 'workHeight' | 'matteRgb'
  > & {
    keepOpaque?: boolean
    forceCutout?: boolean
  }
): RgbaImage {
  const workImg = resizeBilinear(generated, refMeta.workWidth, refMeta.workHeight)
  const cropped =
    refMeta.cropLeft !== 0 ||
    refMeta.cropTop !== 0 ||
    refMeta.workWidth !== orig.width ||
    refMeta.workHeight !== orig.height
      ? cropImage(workImg, {
          left: refMeta.cropLeft,
          top: refMeta.cropTop,
          width: orig.width,
          height: orig.height
        })
      : workImg

  if (refMeta.keepOpaque && !refMeta.forceCutout) {
    const n = cropped.width * cropped.height
    for (let p = 0; p < n; p++) {
      cropped.data[p * 4 + 3] = 255
    }
    return cropped
  }

  if (!hasNativeExteriorTransparency(cropped, orig)) {
    stripOpaqueRepairBackgroundInPlace(cropped, orig, {
      matteRgb: refMeta.matteRgb,
      forceCutout: refMeta.forceCutout
    })
  }
  return cropped
}

/**
 * 将修补完成的新纹理 ID 写回图层拆分状态，并清除与单层 AI 修补对应的质检问题标记。
 */
export function applyRepairedLayerToState(
  state: ImageLayerSplitState,
  layerId: string,
  newImageId: string
): ImageLayerSplitState {
  return {
    ...state,
    layers: state.layers.map((layer) => {
      if (layer.id !== layerId) return layer
      const remainingQa = (layer.qaIssues ?? []).filter(
        (issue) => !RESOLVED_AI_REPAIR_QA_ISSUES.has(issue)
      )
      const next = { ...layer, imageId: newImageId }
      if (remainingQa.length) next.qaIssues = remainingQa
      else delete next.qaIssues
      return next
    })
  }
}
