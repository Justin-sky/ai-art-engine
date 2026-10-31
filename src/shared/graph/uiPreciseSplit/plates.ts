/**
 * 逐级剥层（progressive peeling）：
 *   plate[L+1] = 去字后的原图
 *   plate[k]   = plate[k+1] 去掉第 k 级全部元素、补全其下方内容
 * 第 k 级元素的图层 = matte(plate[k+1], plate[k])。
 *
 * 补底方式（逐元素判定）：
 * - 元素下方是透明（悬浮在透明底上）→ 直接置透明，零误差
 * - 低层级（大面板、立绘，遮挡内容重要）→ 指令编辑模型补全，结果对齐后只在蒙版内羽化回贴，
 *   蒙版外像素保持原样（模型改动了别处也不影响）；没移掉的元素逐个回退本地补底
 * - 高层级（小图标/角标，下方多为简单底板）或无生图能力 → 推拉金字塔本地补底
 */

import { buildAtlasInpaintPrompt, buildPeelEditPrompt, buildSceneBackgroundPrompt } from './prompts'
import {
  boxBlurFloat,
  clampRect,
  cloneImage,
  cropImage,
  createImage,
  dilateMask,
  expandRect,
  inpaintPushPull,
  nearestAspectRatio,
  pixelDistance,
  resizeBilinear
} from './pixels'
import { paintRect, ringStats } from './refine'
import { detectSlotInnerRect, estimateSlotRowBackground } from './segment'
import type {
  PixelRect,
  PreciseSplitIo,
  RgbaImage,
  UiBackgroundRepairMode,
  UiElementNode
} from './types'

export interface PackedAtlasCell {
  id: string
  name: string
  /** 原画布上的像素矩形 */
  sourceRect: PixelRect
  /** 图集（Atlas）上的像素起点 */
  atlasLeft: number
  atlasTop: number
}

export interface PackedOcclusionAtlas {
  atlas: RgbaImage
  maskImage: RgbaImage
  cells: PackedAtlasCell[]
}

/**
 * 把整图二值空洞掩码（1 = 待修补空洞，0 = 保持不变）编码为黑白 RGBA 图像，
 * 供支持显式 Mask 的生图修补接口或图集修补使用（白=修补区，黑=保留区）。
 */
export function buildBinaryMaskRgba(hole: Uint8Array, width: number, height: number): RgbaImage {
  const img = createImage(width, height)
  for (let p = 0; p < hole.length; p++) {
    const v = hole[p] ? 255 : 0
    const i = p * 4
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  return img
}

/**
 * 图集（Atlas）架式打包（对标知乎方案 2.3.2）：
 * 将多个存在遮挡空洞的父元素切片打包进同一张图集，并在遮挡孔洞处写入纯黑 [0,0,0,255] 诊断块，
 * 同时生成对应的黑白二值掩码图（白色 = 待修补空洞，黑色 = 保持原样）。
 */
export function packOcclusionAtlas(input: {
  plate: RgbaImage
  holeMask: Uint8Array
  targets: ReadonlyArray<{ id: string; name: string; rect: PixelRect }>
  pad?: number
}): PackedOcclusionAtlas {
  const { plate, holeMask, targets } = input
  const gap = Math.max(8, input.pad ?? 12)
  const clamped = targets.map((t) => ({
    id: t.id,
    name: t.name,
    rect: clampRect(t.rect, plate.width, plate.height)
  }))
  const totalArea = clamped.reduce(
    (acc, c) => acc + (c.rect.width + gap) * (c.rect.height + gap),
    0
  )
  const maxCellW = clamped.reduce((m, c) => Math.max(m, c.rect.width + gap * 2), 64)
  const targetRowW = Math.max(maxCellW, Math.ceil(Math.sqrt(totalArea) * 1.15))

  const cells: PackedAtlasCell[] = []
  let curX = gap
  let curY = gap
  let rowH = 0
  let atlasW = maxCellW

  for (const item of clamped) {
    if (curX + item.rect.width + gap > targetRowW && curX > gap) {
      curX = gap
      curY += rowH + gap
      rowH = 0
    }
    cells.push({
      id: item.id,
      name: item.name,
      sourceRect: item.rect,
      atlasLeft: curX,
      atlasTop: curY
    })
    curX += item.rect.width + gap
    rowH = Math.max(rowH, item.rect.height)
    atlasW = Math.max(atlasW, curX)
  }
  const atlasH = Math.max(64, curY + rowH + gap)
  const atlas = createImage(atlasW, atlasH)
  const maskImage = createImage(atlasW, atlasH)
  // 图集背景置为深灰中性底，掩码置黑（不修补）
  for (let i = 0; i < atlas.data.length; i += 4) {
    atlas.data[i] = 24
    atlas.data[i + 1] = 26
    atlas.data[i + 2] = 30
    atlas.data[i + 3] = 255
    maskImage.data[i + 3] = 255
  }

  for (const cell of cells) {
    const { sourceRect: sr, atlasLeft, atlasTop } = cell
    for (let y = 0; y < sr.height; y++) {
      for (let x = 0; x < sr.width; x++) {
        const sp = (sr.top + y) * plate.width + (sr.left + x)
        const si = sp * 4
        const dp = (atlasTop + y) * atlasW + (atlasLeft + x)
        const di = dp * 4
        if (holeMask[sp]) {
          // 被子元素挖空的黑洞区域
          atlas.data[di] = 0
          atlas.data[di + 1] = 0
          atlas.data[di + 2] = 0
          atlas.data[di + 3] = 255
          maskImage.data[di] = 255
          maskImage.data[di + 1] = 255
          maskImage.data[di + 2] = 255
          maskImage.data[di + 3] = 255
        } else {
          atlas.data[di] = plate.data[si]!
          atlas.data[di + 1] = plate.data[si + 1]!
          atlas.data[di + 2] = plate.data[si + 2]!
          atlas.data[di + 3] = plate.data[si + 3]!
        }
      }
    }
  }

  return { atlas, maskImage, cells }
}

/**
 * 将生图模型修补后的图集（Atlas）按原坐标解包回贴到画布底板的空洞区域内。
 */
export function unpackOcclusionAtlas(
  plate: RgbaImage,
  repairedAtlas: RgbaImage,
  packed: PackedOcclusionAtlas,
  holeMask: Uint8Array
): RgbaImage {
  const out = cloneImage(plate)
  const resized =
    repairedAtlas.width === packed.atlas.width && repairedAtlas.height === packed.atlas.height
      ? repairedAtlas
      : resizeBilinear(repairedAtlas, packed.atlas.width, packed.atlas.height)
  const atlasW = resized.width

  for (const cell of packed.cells) {
    const { sourceRect: sr, atlasLeft, atlasTop } = cell
    for (let y = 0; y < sr.height; y++) {
      for (let x = 0; x < sr.width; x++) {
        const sp = (sr.top + y) * out.width + (sr.left + x)
        if (!holeMask[sp]) continue
        const si = sp * 4
        const di = ((atlasTop + y) * atlasW + (atlasLeft + x)) * 4
        out.data[si] = resized.data[di]!
        out.data[si + 1] = resized.data[di + 1]!
        out.data[si + 2] = resized.data[di + 2]!
      }
    }
  }
  return out
}

export { buildAtlasInpaintPrompt, buildSceneBackgroundPrompt }

export interface PeelLevelReport {
  level: number
  method: 'generative' | 'local' | 'transparent'
  elementCount: number
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function peelPad(img: RgbaImage): number {
  return Math.max(2, Math.round(Math.max(img.width, img.height) * 0.004))
}

/** 元素正下方是否是透明底（外圈环带基本透明） */
function sitsOnTransparency(img: RgbaImage, box: PixelRect): boolean {
  const ring = ringStats(img, expandRect(box, 3, img.width, img.height), 2)
  return ring.color[3]! < 20
}

/**
 * 估计生成结果相对参考图的整体平移（模型重绘常有几像素漂移）。
 * 在 ≤320px 的缩略图上、蒙版外区域做 SAD 搜索。
 */
export function estimateShift(
  ref: RgbaImage,
  mov: RgbaImage,
  hole: Uint8Array
): { dx: number; dy: number; error: number } {
  const scale = Math.max(1, Math.ceil(Math.max(ref.width, ref.height) / 320))
  const w = Math.max(1, Math.round(ref.width / scale))
  const h = Math.max(1, Math.round(ref.height / scale))
  const a = resizeBilinear(ref, w, h)
  const b = resizeBilinear(mov, w, h)
  const valid = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(ref.width - 1, Math.floor(x * scale))
      const sy = Math.min(ref.height - 1, Math.floor(y * scale))
      valid[y * w + x] = hole[sy * ref.width + sx] ? 0 : 1
    }
  }
  const radius = Math.max(2, Math.min(10, Math.round(Math.max(w, h) * 0.03)))
  let best = { dx: 0, dy: 0, error: Infinity }
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let sum = 0
      let count = 0
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y += 2) {
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x += 2) {
          const p = y * w + x
          if (!valid[p]) continue
          sum += pixelDistance(a.data, p * 4, b.data, ((y + dy) * w + x + dx) * 4)
          count++
        }
      }
      if (count < 16) continue
      const err = sum / count
      if (err < best.error) best = { dx, dy, error: err }
    }
  }
  return { dx: best.dx * scale, dy: best.dy * scale, error: best.error }
}

function shiftImage(img: RgbaImage, dx: number, dy: number): RgbaImage {
  if (!dx && !dy) return img
  const out = createImage(img.width, img.height)
  for (let y = 0; y < img.height; y++) {
    const sy = Math.min(img.height - 1, Math.max(0, y + dy))
    for (let x = 0; x < img.width; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, x + dx))
      const si = (sy * img.width + sx) * 4
      const o = (y * img.width + x) * 4
      out.data[o] = img.data[si]!
      out.data[o + 1] = img.data[si + 1]!
      out.data[o + 2] = img.data[si + 2]!
      out.data[o + 3] = img.data[si + 3]!
    }
  }
  return out
}

function meanDistanceInRect(a: RgbaImage, b: RgbaImage, rect: PixelRect): number {
  let sum = 0
  let n = 0
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      const i = (y * a.width + x) * 4
      sum += pixelDistance(a.data, i, b.data, i)
      n++
    }
  }
  return n ? sum / n : 0
}

/**
 * 移除一组元素，返回补底后的新底板。
 * 支持按父级材质（element_repair_mode / background_repair.mode）分流：
 * - 当所有被遮挡底板均显式声明为 'surface' 时，走零生图开销的本地边缘延续补全；
 * - 当启用 useAtlasPacking 且存在多个独立遮挡父级时，支持打包为 Atlas + 二值 Mask 一次性修补。
 */
export async function peelLevel(input: {
  io: PreciseSplitIo
  plate: RgbaImage
  elements: readonly UiElementNode[]
  allElements?: readonly UiElementNode[]
  backgroundRepairMode?: UiBackgroundRepairMode
  useAtlasPacking?: boolean
  level: number
  useGenerative: boolean
  locale?: string
}): Promise<{ plate: RgbaImage; report: PeelLevelReport[] }> {
  const { io, plate, elements, level } = input
  const W = plate.width
  const H = plate.height
  const pad = peelPad(plate)
  const next = cloneImage(plate)
  const report: PeelLevelReport[] = []

  const transparent: UiElementNode[] = []
  const solid: UiElementNode[] = []
  for (const el of elements) (sitsOnTransparency(plate, el.box) ? transparent : solid).push(el)

  const byId = input.allElements ? new Map(input.allElements.map((e) => [e.id, e])) : null
  const resolveParentInnerRect = (el: UiElementNode): PixelRect | null => {
    let cur = el.parentId && byId ? byId.get(el.parentId) : undefined
    while (cur) {
      if (
        cur.kind === 'panel' ||
        cur.kind === 'frame' ||
        cur.kind === 'item-slot' ||
        cur.kind === 'banner'
      ) {
        return cur.slotInnerRect ?? detectSlotInnerRect(plate, cur.box)
      }
      cur = cur.parentId && byId ? byId.get(cur.parentId) : undefined
    }
    return null
  }

  const hole = new Uint8Array(W * H)
  const featherAllow = new Uint8Array(W * H)
  const parentGroups = new Map<
    string,
    { innerRect: PixelRect; els: UiElementNode[]; mask: Uint8Array }
  >()
  const rootHole = new Uint8Array(W * H)

  for (const el of elements) {
    const parentInner = resolveParentInnerRect(el)
    const elHole = new Uint8Array(W * H)
    if (el.instanceMask) {
      const im = el.instanceMask
      const grown = dilateMask(im.mask, im.rect.width, im.rect.height, pad)
      for (let y = 0; y < im.rect.height; y++) {
        const cy = im.rect.top + y
        if (cy < 0 || cy >= H) continue
        if (parentInner && (cy < parentInner.top || cy >= parentInner.top + parentInner.height)) {
          continue
        }
        const rowOff = y * im.rect.width
        for (let x = 0; x < im.rect.width; x++) {
          if (!grown[rowOff + x]) continue
          const cx = im.rect.left + x
          if (cx < 0 || cx >= W) continue
          if (
            parentInner &&
            (cx < parentInner.left || cx >= parentInner.left + parentInner.width)
          ) {
            continue
          }
          elHole[cy * W + cx] = 1
        }
      }
    } else {
      const r = expandRect(el.box, pad, W, H)
      const x0 = parentInner ? Math.max(r.left, parentInner.left) : r.left
      const y0 = parentInner ? Math.max(r.top, parentInner.top) : r.top
      const x1 = parentInner
        ? Math.min(r.left + r.width, parentInner.left + parentInner.width)
        : r.left + r.width
      const y1 = parentInner
        ? Math.min(r.top + r.height, parentInner.top + parentInner.height)
        : r.top + r.height
      if (x1 > x0 && y1 > y0) {
        paintRect(elHole, W, H, { left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
      }
    }

    for (let p = 0; p < elHole.length; p++) {
      if (!elHole[p]) continue
      hole[p] = 1
      if (parentInner) {
        const key = `${parentInner.left},${parentInner.top},${parentInner.width},${parentInner.height}`
        let grp = parentGroups.get(key)
        if (!grp) {
          grp = { innerRect: parentInner, els: [], mask: new Uint8Array(W * H) }
          parentGroups.set(key, grp)
        }
        if (!grp.els.includes(el)) grp.els.push(el)
        grp.mask[p] = 1
      } else {
        rootHole[p] = 1
      }
    }

    if (parentInner) {
      paintRect(featherAllow, W, H, parentInner)
    } else {
      paintRect(featherAllow, W, H, expandRect(el.box, pad + 4, W, H))
    }
  }

  // 本地补底总是先算：
  // 1) 对位于父容器内腔（parentInner）中的子元素，严格在父容器内腔子图上执行补底，绝不采样容器外的深蓝画布背景，也绝不破坏容器边框！
  // 2) 对槽位内的大尺寸人像/立绘（avatar/illustration），结合槽位垂直背景渐变与内腔推拉金字塔还原干净底板。
  const local = cloneImage(next)
  for (const grp of parentGroups.values()) {
    const ir = grp.innerRect
    const sub = cropImage(local, ir)
    const subHole = new Uint8Array(ir.width * ir.height)
    for (let y = 0; y < ir.height; y++) {
      const srcRow = (ir.top + y) * W + ir.left
      const dstRow = y * ir.width
      for (let x = 0; x < ir.width; x++) {
        if (grp.mask[srcRow + x]) subHole[dstRow + x] = 1
      }
    }
    const hasPortrait = grp.els.some(
      (e) => (e.kind === 'avatar' || e.kind === 'illustration') && e.box.width >= ir.width * 0.42
    )
    if (hasPortrait) {
      // 剥除槽位主立绘时，将整个槽位内腔（ir）标记为待还原区并以 100% 槽位纯净垂直渐变填充，
      // 彻底消除 inpaintPushPull 全洞短路或 28% 原图混色导致的底板人像五官重影与发丝残留
      const rowBg = estimateSlotRowBackground(local, ir)
      paintRect(hole, W, H, ir)
      paintRect(grp.mask, W, H, ir)
      for (let y = 0; y < ir.height; y++) {
        const bg = rowBg[y]!
        for (let x = 0; x < ir.width; x++) {
          const di = ((ir.top + y) * W + (ir.left + x)) * 4
          local.data[di] = bg[0]
          local.data[di + 1] = bg[1]
          local.data[di + 2] = bg[2]
          local.data[di + 3] = 255
        }
      }
    } else {
      inpaintPushPull(sub, subHole)
      for (let y = 0; y < ir.height; y++) {
        for (let x = 0; x < ir.width; x++) {
          const sp = y * ir.width + x
          if (!subHole[sp]) continue
          const si = sp * 4
          const di = ((ir.top + y) * W + (ir.left + x)) * 4
          local.data[di] = sub.data[si]!
          local.data[di + 1] = sub.data[si + 1]!
          local.data[di + 2] = sub.data[si + 2]!
          local.data[di + 3] = sub.data[si + 3]!
        }
      }
    }
  }
  let hasRootHole = false
  for (let p = 0; p < rootHole.length; p++) {
    if (rootHole[p]) {
      hasRootHole = true
      break
    }
  }
  if (hasRootHole) {
    inpaintPushPull(local, rootHole)
  }

  const copyLocal = (rect: PixelRect): void => {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      const start = (y * W + rect.left) * 4
      next.data.set(local.data.subarray(start, start + rect.width * 4), start)
    }
  }

  if (!solid.length) {
    for (const el of transparent) copyLocal(expandRect(el.box, pad, W, H))
    report.push({ level, method: 'transparent', elementCount: transparent.length })
    return { plate: next, report }
  }

  // 检查是否所有实心元素下方的承载面都显式声明为 'surface' 或 'none'（无需生图）
  const allSurfaceOnly =
    byId != null &&
    solid.every((el) => {
      if (el.parentId) {
        const p = byId.get(el.parentId)
        return p?.repairMode === 'surface' || p?.repairMode === 'none'
      }
      return input.backgroundRepairMode === 'surface' || input.backgroundRepairMode === 'none'
    })

  let generated: RgbaImage | null = null
  if (input.useGenerative && !allSurfaceOnly && io.editImage) {
    throwIfAborted(io.signal)
    try {
      if (input.useAtlasPacking && solid.length >= 2) {
        const packed = packOcclusionAtlas({
          plate: next,
          holeMask: hole,
          targets: solid.map((el) => ({
            id: el.id,
            name: el.name,
            rect: expandRect(el.box, Math.max(pad * 3, 12), W, H)
          }))
        })
        const [atlasUrl, maskUrl] = await Promise.all([
          io.encodePng(packed.atlas),
          io.encodePng(packed.maskImage)
        ])
        const rawAtlas = await io.editImage({
          prompt: buildAtlasInpaintPrompt({
            locale: input.locale,
            cellNames: solid.map((el) => el.name)
          }),
          image: atlasUrl,
          maskImage: maskUrl,
          aspectRatio: nearestAspectRatio(packed.atlas.width, packed.atlas.height)
        })
        if (rawAtlas) {
          generated = unpackOcclusionAtlas(next, rawAtlas, packed, hole)
        }
      } else {
        const [image, maskImage] = await Promise.all([
          io.encodePng(next),
          io.encodePng(buildBinaryMaskRgba(hole, W, H))
        ])
        const isSceneBg =
          level === 1 && input.backgroundRepairMode === 'scene' && solid.every((el) => !el.parentId)
        const prompt = isSceneBg
          ? buildSceneBackgroundPrompt({ locale: input.locale })
          : buildPeelEditPrompt({
              locale: input.locale,
              width: W,
              height: H,
              targets: solid.map((el) => ({ name: el.name, box: el.box }))
            })
        const raw = await io.editImage({
          prompt,
          image,
          maskImage,
          aspectRatio: nearestAspectRatio(W, H)
        })
        if (raw) {
          const resized = resizeBilinear(raw, W, H)
          const shift = estimateShift(next, resized, hole)
          // 蒙版外平均色差过大 = 模型改了构图/画幅，结果不可用
          if (Number.isFinite(shift.error) && shift.error <= 24) {
            generated = shiftImage(resized, shift.dx, shift.dy)
          } else {
            io.log?.(
              `peel L${level}: generated plate rejected (misaligned, err=${shift.error.toFixed(1)})`
            )
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      io.log?.(
        `peel L${level}: generative inpaint failed, using local fill (${String((err as Error)?.message ?? err)})`
      )
    }
  }

  // 羽化蒙版（向外扩 2px 再模糊 2px），蒙版外及父容器边框外像素逐位保持原样
  const soft = new Float32Array(W * H)
  const grown = dilateMask(hole, W, H, 2)
  for (let p = 0; p < soft.length; p++) {
    if (grown[p] && featherAllow[p]) soft[p] = 1
  }
  const feather = boxBlurFloat(soft, W, H, 2)
  const fill = generated ?? local
  for (let p = 0; p < feather.length; p++) {
    if (!featherAllow[p]) continue
    const m = hole[p] ? 1 : feather[p]!
    if (m <= 0) continue
    const i = p * 4
    for (let c = 0; c < 3; c++)
      next.data[i + c] = fill.data[i + c]! * m + next.data[i + c]! * (1 - m)
    // alpha 跟随本地补底（生图模型输出不带透明通道）
    next.data[i + 3] = local.data[i + 3]! * m + next.data[i + 3]! * (1 - m)
  }
  for (const el of transparent) copyLocal(expandRect(el.box, pad, W, H))
  if (transparent.length)
    report.push({ level, method: 'transparent', elementCount: transparent.length })

  if (generated) {
    // 模型没移掉的元素：改用本地补底
    let fallback = 0
    for (const el of solid) {
      const r = expandRect(el.box, pad, W, H)
      if (meanDistanceInRect(next, plate, r) >= 6) continue
      fallback++
      copyLocal(r)
    }
    if (fallback)
      io.log?.(`peel L${level}: ${fallback} element(s) not removed by the model, used local fill`)
    report.push({ level, method: 'generative', elementCount: solid.length - fallback })
    if (fallback) report.push({ level, method: 'local', elementCount: fallback })
  } else {
    report.push({ level, method: 'local', elementCount: solid.length })
  }
  return { plate: next, report }
}
