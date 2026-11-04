/**
 * 精准 UI 拆层流水线（由叶向根逐级循环剥离 · Leaf-to-Root Progressive Loop）：
 *   本地 OCR ─┐
 *             ├─► VLM 双图版面解析（元素遮挡树）─► 大容器局部放大复检 ─► OCR 融合 / 父子校正
 *   原图 ─────┘
 *   ─► 顶层普通文字笔画挖洞补底（得到初始无字底板）
 *   ─► Loop（按遮挡树从叶到根 k = maxLevel → 1 逐轮剥离）：
 *        输入当前底板 Plate[k+1]
 *        ─► 本轮叶子 bbox 边缘重吸附 + 实例分割（已剥离上层干扰点自动剔除）+ 遮挡边角轮廓补全
 *        ─► 膨胀挖白洞 + 一补（本地推拉 / 槽位渐变 / 生图剥层）生成 Plate[k]
 *        ─► 二补（结构化多实例/对称/九宫格补全 + 按需单层 AI 精补 Plate[k+1]；清扫 Plate[k] 外发光残留）
 *        ─► Plate[k] 作为下一轮输入图
 *   ─► 自上而下窄带解混抠图（可见像素锁定原图，半透明边缘反解去底色）─► 质检与叠回误差校验
 */

import { estimateEditableTextMeta } from '../uiControlSpec'
import {
  assignOcclusionLevels,
  assignPaintOrder,
  buildLayoutTree,
  collectDescendantIds,
  elementControlType,
  elementPartRole,
  isTextKind,
  parseLayoutResponse,
  resolveParents,
  type RawLayoutElement
} from './layout'
import { extractMatte } from './matting'
import {
  buildOwnershipMap,
  composeOwnedLayer,
  scanPlateResidue,
  scrubPlateResidue,
  type CanvasMask,
  type OwnershipEntry,
  type OwnershipMap
} from './ownership'
import { peelLevel, type PeelLevelReport } from './plates'
import { runSplitQa, type QaLayerInput } from './qa'
import {
  completeOccludedRegions,
  completeOccludedSilhouette,
  type CompletionReport,
  type CompletionTarget
} from './completion'
import { completeOccludedGenerative, type GenerativeCompletionReport } from './generativeCompletion'
import { refineMaskByPalette } from './maskRefine'
import { bleedTransparentRgb } from './productize'
import {
  buildLayoutSystemPrompt,
  buildLayoutUserPrompt,
  buildZoomUserPrompt,
  formatComponentCatalogHints,
  formatOcrHints
} from './prompts'
import {
  buildComponentUnionPeelMask,
  eraseExtraComponentFootprintOnPlate,
  matchElementToComponentLibrary,
  type ComponentMatchResult
} from './componentLibrary'
import {
  cloneImage,
  compositeOver,
  cropImage,
  dilateMask,
  expandRect,
  fillHoles,
  inpaintPushPull,
  labelComponents,
  meanAbsoluteError,
  median,
  pixelDistance,
  rectArea,
  rectIntersection,
  resizeBilinear
} from './pixels'
import {
  filterOcrFalsePositives,
  paintLocalMask,
  refineElementBox,
  textStrokeMask,
  type LocalMask
} from './refine'
import {
  decomposeCompositeBadge,
  detectSlotInnerRect,
  segmentContainerSilhouette,
  segmentElementInstance,
  segmentPortraitInParentSlot
} from './segment'
import type {
  PixelRect,
  PreciseSplitIo,
  PreciseSplitLayer,
  PreciseSplitOptions,
  PreciseSplitResult,
  RgbaImage,
  UiBackgroundRepairMode,
  UiElementKind,
  UiElementNode
} from './types'
import { OPAQUE_UI_ELEMENT_KINDS } from './types'
import type { LocalOcrTextBox } from '../uiControlSpec'

export class PreciseSplitError extends Error {
  constructor(
    public readonly code: 'PRECISE_SPLIT_NO_VLM_RESPONSE' | 'PRECISE_SPLIT_NO_ELEMENTS',
    message?: string
  ) {
    super(message ?? code)
    this.name = 'PreciseSplitError'
  }
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

async function runLayoutPass(input: {
  io: PreciseSplitIo
  image: RgbaImage
  cleanedPreview?: RgbaImage
  ocr: readonly LocalOcrTextBox[]
  options: PreciseSplitOptions
  zoomContainerName?: string
}): Promise<{
  elements: RawLayoutElement[]
  screenKind?: string
  rasterTextIds?: number[]
  backgroundRepairMode?: UiBackgroundRepairMode
}> {
  const { io, image, ocr, options } = input
  const dataUrl = await io.encodePng(image)
  const images = [dataUrl]
  if (input.cleanedPreview && !input.zoomContainerName) {
    const cleanedUrl = await io.encodePng(input.cleanedPreview)
    if (cleanedUrl) images.push(cleanedUrl)
  }
  const ocrHints = formatOcrHints(ocr, image.width, image.height)
  const prompt = input.zoomContainerName
    ? buildZoomUserPrompt({
        locale: options.locale,
        containerName: input.zoomContainerName,
        width: image.width,
        height: image.height,
        ocrHints
      })
    : buildLayoutUserPrompt({
        locale: options.locale,
        width: image.width,
        height: image.height,
        ocrHints,
        userHint: options.userHint,
        sourceTitle: options.sourceTitle,
        hasCleanedPreview: images.length > 1,
        ...(options.components?.length
          ? {
              componentCatalogHints: formatComponentCatalogHints(
                options.components.map((c) => c.item)
              )
            }
          : {})
      })
  let text = ''
  try {
    text = await io.vlm({
      system: buildLayoutSystemPrompt(options.locale),
      prompt,
      images
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || io.signal?.aborted) throw err
    if (images.length > 1) {
      io.log?.(
        `vlm dual-image pass failed (${String((err as Error)?.message ?? err)}), retrying with single image`
      )
      const singlePrompt = buildLayoutUserPrompt({
        locale: options.locale,
        width: image.width,
        height: image.height,
        ocrHints,
        userHint: options.userHint,
        sourceTitle: options.sourceTitle,
        hasCleanedPreview: false
      })
      text = await io.vlm({
        system: buildLayoutSystemPrompt(options.locale),
        prompt: singlePrompt,
        images: [dataUrl]
      })
    } else {
      throw err
    }
  }
  if (!text?.trim()) throw new PreciseSplitError('PRECISE_SPLIT_NO_VLM_RESPONSE')
  const parsed = parseLayoutResponse(text, image.width, image.height, options.maxElements ?? 120)
  return parsed
}

/**
 * 局部放大复检：对占画面比例大、内部有子元素的顶层容器，裁图放大后重新检测其内部元素，
 * 用复检结果替换该容器原有的全部后代（放大后小元素召回与框精度都明显更好）。
 */
async function zoomRefine(input: {
  io: PreciseSplitIo
  source: RgbaImage
  ocr: readonly LocalOcrTextBox[]
  options: PreciseSplitOptions
  raw: RawLayoutElement[]
}): Promise<RawLayoutElement[]> {
  const { io, source, ocr, options } = input
  const W = source.width
  const H = source.height
  const tree = buildLayoutTree({ elements: input.raw, ocr, width: W, height: H })
  const canvasArea = W * H
  const containers = tree.elements
    .filter(
      (n) =>
        !n.parentId &&
        !isTextKind(n.kind) &&
        n.kind !== 'effect' &&
        rectArea(n.box) >= canvasArea * 0.1 &&
        rectArea(n.box) <= canvasArea * 0.95 &&
        tree.elements.some((c) => c.parentId === n.id)
    )
    .sort((a, b) => rectArea(b.box) - rectArea(a.box))
    .slice(0, 3)
  if (!containers.length) return input.raw

  const results = await Promise.all(
    containers.map(async (container, ci) => {
      try {
        throwIfAborted(io.signal)
        const crop = expandRect(container.box, Math.round(Math.max(W, H) * 0.015), W, H)
        const longSide = Math.max(crop.width, crop.height)
        const scale = Math.min(3, Math.max(1, 1280 / longSide))
        const cropped = cropImage(source, crop)
        const zoomed =
          scale > 1.05 ? resizeBilinear(cropped, crop.width * scale, crop.height * scale) : cropped
        const sx = zoomed.width / crop.width
        const sy = zoomed.height / crop.height
        const localOcr = ocr
          .filter((b) => {
            const cx = b.left + b.width / 2
            const cy = b.top + b.height / 2
            return (
              cx >= crop.left &&
              cx <= crop.left + crop.width &&
              cy >= crop.top &&
              cy <= crop.top + crop.height
            )
          })
          .map((b) => ({
            ...b,
            left: (b.left - crop.left) * sx,
            top: (b.top - crop.top) * sy,
            width: b.width * sx,
            height: b.height * sy
          }))
        const parsed = await runLayoutPass({
          io,
          image: zoomed,
          ocr: localOcr,
          options,
          zoomContainerName: container.name
        })
        if (!parsed.elements.length) return null
        // 复检坐标映射回整图；OCR 编号映射回全局下标
        const localToGlobal = ocr
          .map((b, i) => ({ b, i }))
          .filter(({ b }) => {
            const cx = b.left + b.width / 2
            const cy = b.top + b.height / 2
            return (
              cx >= crop.left &&
              cx <= crop.left + crop.width &&
              cy >= crop.top &&
              cy <= crop.top + crop.height
            )
          })
          .map(({ i }) => i)
        const mapped: RawLayoutElement[] = parsed.elements.map((el) => ({
          ...el,
          id: `z${ci + 1}_${el.id}`,
          parentRef: el.parentRef ? `z${ci + 1}_${el.parentRef}` : container.id,
          box: {
            left: crop.left + el.box.left / sx,
            top: crop.top + el.box.top / sy,
            width: el.box.width / sx,
            height: el.box.height / sy
          },
          ocrRefs: el.ocrRefs.map((i) => localToGlobal[i] ?? -1).filter((i) => i >= 0)
        }))
        return { container, mapped }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err
        io.log?.(
          `zoom refine "${container.name}" failed: ${String((err as Error)?.message ?? err)}`
        )
        return null
      }
    })
  )

  let next = [...input.raw]
  for (const res of results) {
    if (!res) continue
    const drop = collectDescendantIds(tree.elements, res.container.id)
    // OCR 自动补出来的文字不在 raw 里，无需处理；只替换 VLM 元素
    next = next.filter((el) => !drop.has(el.id))
    next.push(...res.mapped)
    io.log?.(
      `zoom refine "${res.container.name}": ${drop.size} → ${res.mapped.length} child elements`
    )
  }
  return next
}

function maskBoundingBox(rect: PixelRect, mask: Uint8Array): PixelRect | null {
  let minX = rect.width
  let minY = rect.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < rect.height; y++) {
    const row = y * rect.width
    for (let x = 0; x < rect.width; x++) {
      if (!mask[row + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return null
  return {
    left: rect.left + minX,
    top: rect.top + minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  }
}

/**
 * 判定一个被标为 avatar/illustration 的包围盒是否真的自带独立矩形槽位外框：
 * 至少 3 条边在内侧 1px 处呈均匀直线边框（色散小）且与外侧 2px 背景存在显著阶跃，
 * 防止把无框独立站立的全息人像/角色立绘误包一层虚假的矩形 item-slot 底框。
 */
function hasEnclosedSlotBorder(img: RgbaImage, box: PixelRect): boolean {
  const { width: W, height: H } = img
  if (box.width < 28 || box.height < 28) return false
  const xStart = box.left + Math.max(3, Math.round(box.width * 0.18))
  const xEnd = box.left + box.width - Math.max(3, Math.round(box.width * 0.18))
  const yStart = box.top + Math.max(3, Math.round(box.height * 0.18))
  const yEnd = box.top + box.height - Math.max(3, Math.round(box.height * 0.18))
  if (xEnd - xStart < 8 || yEnd - yStart < 8) return false

  const checkEdge = (
    count: number,
    inCoord: (k: number) => [number, number],
    outCoord: (k: number) => [number, number] | null
  ): boolean => {
    const rs: number[] = []
    const gs: number[] = []
    const bs: number[] = []
    let jumps = 0
    let validOut = 0
    for (let k = 0; k < count; k++) {
      const [ix, iy] = inCoord(k)
      const ii = (iy * W + ix) * 4
      rs.push(img.data[ii]!)
      gs.push(img.data[ii + 1]!)
      bs.push(img.data[ii + 2]!)
      const oc = outCoord(k)
      if (oc) {
        const [ox, oy] = oc
        validOut++
        if (pixelDistance(img.data, ii, img.data, (oy * W + ox) * 4) >= 18) jumps++
      }
    }
    if (rs.length < 6) return false
    const mr = median(rs)
    const mg = median(gs)
    const mb = median(bs)
    const devs = rs.map((r, idx) =>
      Math.max(Math.abs(r - mr), Math.abs(gs[idx]! - mg), Math.abs(bs[idx]! - mb))
    )
    if (median(devs) > 16) return false
    return validOut === 0 ? true : jumps >= validOut * 0.65
  }

  let borderSides = 0
  const topInY = Math.min(H - 1, box.top + 1)
  const topOutY = box.top >= 2 ? box.top - 2 : -1
  if (
    checkEdge(
      xEnd - xStart,
      (k) => [xStart + k, topInY],
      (k) => (topOutY >= 0 ? [xStart + k, topOutY] : null)
    )
  ) {
    borderSides++
  }
  const botInY = Math.max(0, box.top + box.height - 2)
  const botOutY = box.top + box.height + 1 < H ? box.top + box.height + 1 : -1
  if (
    checkEdge(
      xEnd - xStart,
      (k) => [xStart + k, botInY],
      (k) => (botOutY >= 0 ? [xStart + k, botOutY] : null)
    )
  ) {
    borderSides++
  }
  const leftInX = Math.min(W - 1, box.left + 1)
  const leftOutX = box.left >= 2 ? box.left - 2 : -1
  if (
    checkEdge(
      yEnd - yStart,
      (k) => [leftInX, yStart + k],
      (k) => (leftOutX >= 0 ? [leftOutX, yStart + k] : null)
    )
  ) {
    borderSides++
  }
  const rightInX = Math.max(0, box.left + box.width - 2)
  const rightOutX = box.left + box.width + 1 < W ? box.left + box.width + 1 : -1
  if (
    checkEdge(
      yEnd - yStart,
      (k) => [rightInX, yStart + k],
      (k) => (rightOutX >= 0 ? [rightOutX, yStart + k] : null)
    )
  ) {
    borderSides++
  }
  return borderSides >= 3
}
function ensureSlotPortraitDecomposition(img: RgbaImage, nodes: UiElementNode[]): Set<string> {
  const canvasArea = img.width * img.height
  const added: UiElementNode[] = []
  const lockedBadgeMaskIds = new Set<string>()

  // 1) 先对所有 icon / badge 检测是否存在「纯色碎片底板 + 内部亮色符号」复合结构
  for (const el of nodes) {
    if (el.plainText || (el.kind !== 'icon' && el.kind !== 'badge')) continue
    const area = rectArea(el.box)
    if (area < 144 || area > canvasArea * 0.2) continue
    const comp = decomposeCompositeBadge(img, el.box)
    if (!comp) continue

    // 若该图标本来就坐落在某个已检出的独立按钮/槽位内部，只收紧图标为纯符号掩码并挂到该按钮下，
    // 绝不重复新建 *_plate 把下层按钮掏出一个大洞
    const existingButtonOrSlot = nodes.find(
      (o) =>
        o.id !== el.id &&
        !o.plainText &&
        (o.kind === 'button' ||
          o.kind === 'close-button' ||
          o.kind === 'tab' ||
          o.kind === 'item-slot') &&
        rectIntersection(o.box, comp.plateBox) /
          Math.max(1, Math.min(rectArea(o.box), rectArea(comp.plateBox))) >=
          0.55
    )
    if (existingButtonOrSlot) {
      el.box = comp.symbolBox
      el.parentId = existingButtonOrSlot.id
      el.instanceMask = { rect: comp.rect, mask: comp.symbolMask }
      lockedBadgeMaskIds.add(el.id)
      continue
    }

    // 检查是否已有紧邻的同区域角标底板节点
    const existingPlate = nodes.find(
      (o) =>
        o.id !== el.id &&
        !o.plainText &&
        (o.kind === 'badge' || o.kind === 'icon') &&
        rectIntersection(o.box, comp.plateBox) /
          Math.max(1, Math.min(rectArea(o.box), rectArea(comp.plateBox))) >=
          0.65
    )
    if (existingPlate) {
      existingPlate.box = comp.plateBox
      existingPlate.instanceMask = { rect: comp.rect, mask: comp.plateMask }
      el.box = comp.symbolBox
      el.parentId = existingPlate.id
      el.instanceMask = { rect: comp.rect, mask: comp.symbolMask }
      lockedBadgeMaskIds.add(existingPlate.id)
      lockedBadgeMaskIds.add(el.id)
    } else {
      const plateId = `${el.id}_plate`
      const plateNode: UiElementNode = {
        id: plateId,
        name: `${el.name} Base`,
        kind: 'badge',
        box: comp.plateBox,
        parentId: el.parentId,
        order: Math.max(0, el.order - 1),
        repairMode: 'surface',
        instanceMask: { rect: comp.rect, mask: comp.plateMask }
      }
      el.box = comp.symbolBox
      el.parentId = plateId
      el.instanceMask = { rect: comp.rect, mask: comp.symbolMask }
      lockedBadgeMaskIds.add(plateId)
      lockedBadgeMaskIds.add(el.id)
      added.push(plateNode)
    }
  }
  if (added.length > 0) {
    nodes.push(...added)
    added.length = 0
    resolveParents(nodes)
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const snapshot = [...nodes]

  for (const el of snapshot) {
    if (el.plainText) continue
    const elArea = rectArea(el.box)
    // 支持完整弹窗中的单个头像槽位（面积最低可至全画布 1.2%）以及单独裁剪的卡片图
    if (elArea < canvasArea * 0.012 || el.box.width < 32 || el.box.height < 32) continue
    const aspect = el.box.width / Math.max(1, el.box.height)
    if (aspect < 0.55 || aspect > 1.45) continue

    // 若 VLM 漏检了槽位左上角的复合角标（碎片底板 + 拼图 Icon），自动在左上角探测补齐
    const topLeftProbe: PixelRect = {
      left: el.box.left,
      top: el.box.top,
      width: Math.max(16, Math.round(el.box.width * 0.42)),
      height: Math.max(16, Math.round(el.box.height * 0.42))
    }
    const hasTopLeftBadge = [...nodes, ...added].some(
      (c) =>
        c.id !== el.id &&
        !c.plainText &&
        (c.kind === 'icon' || c.kind === 'badge') &&
        rectIntersection(c.box, topLeftProbe) >= rectArea(c.box) * 0.5
    )
    if (!hasTopLeftBadge) {
      const comp = decomposeCompositeBadge(img, topLeftProbe, el.box)
      if (comp && rectArea(comp.plateBox) <= elArea * 0.28) {
        const plateId = `${el.id}_corner_plate`
        const iconId = `${el.id}_corner_icon`
        lockedBadgeMaskIds.add(plateId)
        lockedBadgeMaskIds.add(iconId)
        added.push(
          {
            id: plateId,
            name: 'Corner Badge Plate',
            kind: 'badge',
            box: comp.plateBox,
            parentId: el.id,
            order: el.order + 2,
            repairMode: 'surface',
            instanceMask: { rect: comp.rect, mask: comp.plateMask }
          },
          {
            id: iconId,
            name: 'Corner Badge Icon',
            kind: 'icon',
            box: comp.symbolBox,
            parentId: plateId,
            order: el.order + 3,
            instanceMask: { rect: comp.rect, mask: comp.symbolMask }
          }
        )
      }
    }

    const allNodes = [...nodes, ...added]
    const children = allNodes.filter((c) => !c.plainText && c.parentId === el.id)
    const childBadges = allNodes.filter(
      (c) =>
        c.id !== el.id &&
        rectArea(c.box) < elArea * 0.38 &&
        c.box.left >= el.box.left - 4 &&
        c.box.top >= el.box.top - 4 &&
        c.box.left + c.box.width <= el.box.left + el.box.width + 4 &&
        c.box.top + c.box.height <= el.box.top + el.box.height + 4
    )
    const childRects = childBadges.map((c) => c.box)

    if (el.kind === 'avatar' || el.kind === 'illustration') {
      const parent = el.parentId ? byId.get(el.parentId) : undefined
      const hasSlotParent =
        parent != null &&
        (parent.kind === 'panel' || parent.kind === 'item-slot' || parent.kind === 'frame') &&
        rectArea(parent.box) <= elArea * 1.45
      if (hasSlotParent) continue
      if (aspect < 0.68 || aspect > 1.35 || !hasEnclosedSlotBorder(img, el.box)) continue

      const innerRect = detectSlotInnerRect(img, el.box)
      const portSeg = segmentPortraitInParentSlot(img, innerRect, childRects)
      if (portSeg.fgRatio >= 0.16 && portSeg.fgRatio <= 0.94 && portSeg.meanFgContrast >= 34) {
        const slotId = `${el.id}_slot`
        const slotNode: UiElementNode = {
          id: slotId,
          name: `${el.name} Frame`,
          kind: 'item-slot',
          box: { ...el.box },
          slotInnerRect: innerRect,
          repairMode: 'surface',
          parentId: el.parentId,
          order: Math.max(0, el.order - 1)
        }
        el.parentId = slotId
        el.instanceMask = { rect: portSeg.rect, mask: portSeg.mask }
        const tight = maskBoundingBox(portSeg.rect, portSeg.mask)
        if (tight) el.box = tight
        for (const cb of childBadges) {
          if (cb.parentId === el.id) cb.parentId = slotId
        }
        added.push(slotNode)
      }
      continue
    }

    if (el.kind === 'panel' || el.kind === 'item-slot' || el.kind === 'frame') {
      const hasFigureChild = children.some(
        (c) =>
          c.kind === 'avatar' ||
          c.kind === 'illustration' ||
          (c.kind === 'icon' && rectArea(c.box) >= elArea * 0.25)
      )
      if (hasFigureChild) continue
      if (children.some((c) => rectArea(c.box) >= elArea * 0.35)) continue

      const innerRect = detectSlotInnerRect(img, el.box)
      const portSeg = segmentPortraitInParentSlot(img, innerRect, childRects)
      if (portSeg.fgRatio < 0.18 || portSeg.fgRatio > 0.92 || portSeg.meanFgContrast < 38) {
        continue
      }
      const tight = maskBoundingBox(portSeg.rect, portSeg.mask)
      if (!tight || rectArea(tight) < rectArea(innerRect) * 0.22) continue

      el.slotInnerRect = innerRect
      el.repairMode = el.repairMode ?? 'surface'
      const portraitNode: UiElementNode = {
        id: `${el.id}_portrait`,
        name: 'Portrait',
        kind: 'avatar',
        box: tight,
        parentId: el.id,
        order: el.order + 1,
        instanceMask: { rect: portSeg.rect, mask: portSeg.mask }
      }
      added.push(portraitNode)
    }
  }

  if (added.length > 0) {
    nodes.push(...added)
  }
  resolveParents(nodes)
  assignPaintOrder(nodes)
  assignOcclusionLevels(nodes, 24)
  return lockedBadgeMaskIds
}

export async function runPreciseUiSplit(
  io: PreciseSplitIo,
  source: RgbaImage,
  options: PreciseSplitOptions = {}
): Promise<PreciseSplitResult> {
  const W = source.width
  const H = source.height
  const notes: string[] = []
  const log = (msg: string): void => {
    notes.push(msg)
    io.log?.(msg)
  }

  // 1) 本地 OCR + 误检过滤（低置信度 / 单字母图标误识 / 竖向装饰误识）
  let ocr: LocalOcrTextBox[] = []
  if (io.ocr) {
    try {
      const rawOcr = (await io.ocr(source)).filter(
        (b) => b.text?.trim() && b.width > 1 && b.height > 1
      )
      ocr = filterOcrFalsePositives(rawOcr)
    } catch {
      ocr = []
    }
  }
  log(`ocr: ${ocr.length} text boxes`)
  throwIfAborted(io.signal)

  // 1.5) 先对全部过滤后 OCR 框做初步本地去字，生成「初步去字预览图」连同原图一起送 VLM 双图规划
  let initialCleanedPreview: RgbaImage | undefined
  if (ocr.length > 0) {
    initialCleanedPreview = cloneImage(source)
    const previewHole = new Uint8Array(W * H)
    for (const b of ocr) {
      const lm = textStrokeMask(source, b, b.text, { hasOcrBacking: true })
      if ((lm.coverage ?? 1) > 0) {
        paintLocalMask(previewHole, W, { rect: lm.rect, mask: lm.eraseMask ?? lm.mask })
      }
    }
    inpaintPushPull(initialCleanedPreview, previewHole)
  }

  // 2) VLM 版面解析（双图输入：[原图, 初步去字图]）
  const first = await runLayoutPass({
    io,
    image: source,
    cleanedPreview: initialCleanedPreview,
    ocr,
    options
  })
  if (!first.elements.length) {
    throw new PreciseSplitError('PRECISE_SPLIT_NO_ELEMENTS')
  }
  log(`vlm layout: ${first.elements.length} elements`)
  let raw = first.elements

  // 3) 局部放大复检
  if (options.zoomRefine !== false) {
    raw = await zoomRefine({ io, source, ocr, options, raw })
  }
  throwIfAborted(io.signal)

  // 4) 元素树 + 边缘吸附 / 点框实例分割紧致框（文字框来自 OCR，已是像素级，不再吸附）
  const tree = buildLayoutTree({
    elements: raw,
    ocr,
    width: W,
    height: H,
    screenKind: first.screenKind,
    rasterTextIds: first.rasterTextIds,
    backgroundRepairMode: first.backgroundRepairMode
  })
  if (tree.rasterTextIds?.length) {
    log(`raster text restored: ${tree.rasterTextIds.length} boxes`)
  }
  // 5) 顶层普通文字叶子：笔画蒙版 → 本地去字，得到初始无字底板（raster_text_ids 与 art-text 自动保留原图像素）
  const plainTexts = tree.elements.filter((e) => e.plainText)
  const textMaskById = new Map<string, LocalMask>()
  const textFree = cloneImage(source)
  if (plainTexts.length) {
    const hole = new Uint8Array(W * H)
    for (const t of plainTexts) {
      const lm = textStrokeMask(source, t.box, t.text, {
        hasOcrBacking: Boolean(t.ocrIndices?.length)
      })
      textMaskById.set(t.id, lm)
      if ((lm.coverage ?? 1) > 0) {
        paintLocalMask(hole, W, { rect: lm.rect, mask: lm.eraseMask ?? lm.mask })
      }
    }
    inpaintPushPull(textFree, hole)
  }

  const isContainerKind = (kind: UiElementKind): boolean =>
    kind === 'panel' || kind === 'frame' || kind === 'item-slot' || kind === 'banner'

  // 在无字底板上做单次精确 bbox 边缘吸附（先父容器后子控件，避免容器内子按钮外扩吸附到父容器外描边上）
  const rawBoxById = new Map(tree.elements.map((e) => [e.id, { ...e.box }]))
  const preById = new Map(tree.elements.map((e) => [e.id, e]))
  const glowElements = tree.elements.filter((e) => !e.plainText && isTranslucentGlowElement(e))
  const refineOrder = [...tree.elements].sort((a, b) => rectArea(b.box) - rectArea(a.box))
  for (const el of refineOrder) {
    if (el.plainText || isTranslucentGlowElement(el)) continue
    let refined = refineElementBox(textFree, el.box)
    const rawEl = rawBoxById.get(el.id)
    // 立绘/人像不得把脚底重叠的半透明发光底座吸进自身包围盒而向下/向两侧恶性外扩
    if (rawEl && (el.kind === 'illustration' || el.kind === 'avatar')) {
      for (const glow of glowElements) {
        if ((glow.paintIndex ?? 0) >= (el.paintIndex ?? 0)) continue
        if (rectIntersection(refined, glow.box) <= 0) continue
        if (glow.box.top > rawEl.top + rawEl.height * 0.45) {
          const x0 = glow.box.left < rawEl.left ? Math.max(refined.left, rawEl.left) : refined.left
          const x1 =
            glow.box.left + glow.box.width > rawEl.left + rawEl.width
              ? Math.min(refined.left + refined.width, rawEl.left + rawEl.width)
              : refined.left + refined.width
          const y1 = Math.min(refined.top + refined.height, rawEl.top + rawEl.height)
          if (x1 - x0 >= 8 && y1 - refined.top >= 8) {
            refined = { left: x0, top: refined.top, width: x1 - x0, height: y1 - refined.top }
          }
        }
      }
    }
    const parent = el.parentId ? preById.get(el.parentId) : undefined
    const rawParent = parent ? rawBoxById.get(parent.id) : undefined
    if (
      parent &&
      rawEl &&
      rawParent &&
      isContainerKind(parent.kind) &&
      rectIntersection(rawEl, rawParent) >= rectArea(rawEl) * 0.88
    ) {
      const pBox = parent.box
      let x0 = refined.left
      let y0 = refined.top
      let x1 = refined.left + refined.width
      let y1 = refined.top + refined.height
      if (rawEl.left - rawParent.left >= 4) x0 = Math.max(x0, pBox.left + 2)
      if (rawEl.top - rawParent.top >= 4) y0 = Math.max(y0, pBox.top + 2)
      if (rawParent.left + rawParent.width - (rawEl.left + rawEl.width) >= 4) {
        x1 = Math.min(x1, pBox.left + pBox.width - 2)
      }
      if (rawParent.top + rawParent.height - (rawEl.top + rawEl.height) >= 4) {
        y1 = Math.min(y1, pBox.top + pBox.height - 2)
      }
      if (x1 - x0 >= 6 && y1 - y0 >= 6) {
        refined = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
      }
    }
    el.box = refined
  }

  // 5.5) 在去字底板 textFree 上执行「复合角标 / 槽位底框 ↔ 角色人像」自动补拆：
  // 复合角标锁定精确拆分掩码；槽位内立绘留到其自身剥层轮次（角标已被剥除补好后）再重分割，避免角标切掉发丝。
  const lockedBadgeMaskIds = ensureSlotPortraitDecomposition(textFree, tree.elements)

  const byId = new Map(tree.elements.map((e) => [e.id, e]))
  const ordered = [...tree.elements].sort((a, b) => (a.paintIndex ?? 0) - (b.paintIndex ?? 0))
  const levelOf = (el: UiElementNode): number => el.level ?? 1

  const parentIdsWithChildren = new Set<string>()
  for (const el of tree.elements) {
    if (!el.plainText && el.parentId) parentIdsWithChildren.add(el.parentId)
  }
  for (const el of tree.elements) {
    if (parentIdsWithChildren.has(el.id) && isContainerKind(el.kind)) {
      el.slotInnerRect = el.slotInnerRect ?? detectSlotInnerRect(textFree, el.box)
    }
  }

  // 先提取顶层文字叶子的初始足迹并写入渐进归属图，使后续各轮叶子都能准确感知文字遮挡区
  const extractPlainTextMattes = (): Map<string, { rect: PixelRect; rgba: Uint8ClampedArray }> => {
    const out = new Map<string, { rect: PixelRect; rgba: Uint8ClampedArray }>()
    for (const el of ordered) {
      if (!el.plainText) continue
      const lm = textMaskById.get(el.id)
      if (lm && (lm.coverage ?? 1) <= 0) continue
      const tightTextMask =
        lm?.glyphMask && lm.maskQuality === 'estimated_glyphs'
          ? dilateMask(lm.glyphMask, lm.rect.width, lm.rect.height, 1)
          : lm?.mask
      const matte = extractMatte(
        source,
        textFree,
        expandRect(el.box, Math.max(2, Math.round(el.box.height * 0.18)), W, H),
        {
          t0: 8,
          t1: 36,
          ...(lm && tightTextMask ? { instanceMask: { rect: lm.rect, mask: tightTextMask } } : {})
        }
      )
      if (matte) out.set(el.id, { rect: matte.rect, rgba: matte.rgba })
    }
    return out
  }

  let textMattes = extractPlainTextMattes()
  const maskById = new Map<string, CanvasMask>()
  for (const el of ordered) {
    if (!el.plainText) continue
    const tm = textMattes.get(el.id)
    if (tm) maskById.set(el.id, alphaFootprint(tm.rect, tm.rgba, 8))
  }

  const entries: OwnershipEntry[] = []
  const entryIdx = new Map<string, number>()
  const rebuildProgressiveOwnership = (): OwnershipMap => {
    entries.length = 0
    entryIdx.clear()
    for (const el of ordered) {
      const m = maskById.get(el.id)
      if (!m) continue
      entryIdx.set(el.id, entries.length)
      entries.push({ id: el.id, paintIndex: el.paintIndex ?? 0, mask: m })
    }
    return buildOwnershipMap(W, H, entries)
  }
  let ownership = rebuildProgressiveOwnership()

  // 6) 由叶向根逐轮循环剥离：
  //    loop(输入底板 Plate[k+1] => 叶子 bbox 重吸附 + 实例分割 + 遮挡轮廓补全 => 膨胀白洞一补 Plate[k] => 二补纹理与残影清扫 => 下一轮输入图)
  const peelable = tree.elements.filter((e) => !e.plainText)
  const maxLevel = peelable.reduce((m, e) => Math.max(m, e.level ?? 1), 0)
  const maxGen = Math.max(0, options.maxPeelLevels ?? 3)
  const peelPadPx = Math.max(2, Math.round(Math.max(W, H) * 0.004))
  const plates: RgbaImage[] = []
  plates[maxLevel + 1] = textFree
  const peelReport: PeelLevelReport[] = []

  let paletteTrimmed = 0
  let silhouetteRestoredPx = 0
  let scrubbedPx = 0
  let scrubbedEls = 0
  const componentMatchById = new Map<string, ComponentMatchResult>()
  const peeledByReplacement = new Uint8Array(W * H)

  const projectCanvasMaskToBox = (cm: CanvasMask, box: PixelRect): Uint8Array => {
    const out = new Uint8Array(box.width * box.height)
    const x0 = Math.max(box.left, cm.rect.left)
    const y0 = Math.max(box.top, cm.rect.top)
    const x1 = Math.min(box.left + box.width, cm.rect.left + cm.rect.width)
    const y1 = Math.min(box.top + box.height, cm.rect.top + cm.rect.height)
    for (let cy = y0; cy < y1; cy++) {
      const by = cy - box.top
      const my = cy - cm.rect.top
      for (let cx = x0; cx < x1; cx++) {
        if (cm.mask[my * cm.rect.width + (cx - cm.rect.left)]) {
          out[by * box.width + (cx - box.left)] = 1
        }
      }
    }
    return out
  }

  const stampCanvasFootprint = (box: PixelRect, localMask: Uint8Array): void => {
    for (let y = 0; y < box.height; y++) {
      const cy = box.top + y
      if (cy < 0 || cy >= H) continue
      for (let x = 0; x < box.width; x++) {
        if (!localMask[y * box.width + x]) continue
        const cx = box.left + x
        if (cx >= 0 && cx < W) peeledByReplacement[cy * W + cx] = 1
      }
    }
  }

  const buildUnobstructedKnownMask = (box: PixelRect, selfPaint: number): Uint8Array => {
    const known = new Uint8Array(box.width * box.height)
    known.fill(1)
    for (let y = 0; y < box.height; y++) {
      const cy = box.top + y
      if (cy < 0 || cy >= H) continue
      for (let x = 0; x < box.width; x++) {
        const cx = box.left + x
        if (cx < 0 || cx >= W) continue
        const own = ownership.owner[cy * W + cx]!
        if (own >= 0 && (ownership.entries[own]?.paintIndex ?? -1) > selfPaint) {
          known[y * box.width + x] = 0
        }
      }
    }
    // Exclude pixels where plain text was locally inpainted so text strokes never penalize matching
    for (const t of plainTexts) {
      const lm = textMaskById.get(t.id)
      if (!lm) continue
      const erase = lm.eraseMask ?? lm.mask
      const x0 = Math.max(box.left, lm.rect.left)
      const y0 = Math.max(box.top, lm.rect.top)
      const x1 = Math.min(box.left + box.width, lm.rect.left + lm.rect.width)
      const y1 = Math.min(box.top + box.height, lm.rect.top + lm.rect.height)
      for (let cy = y0; cy < y1; cy++) {
        const by = cy - box.top
        const ly = cy - lm.rect.top
        for (let cx = x0; cx < x1; cx++) {
          if (erase[ly * lm.rect.width + (cx - lm.rect.left)]) {
            known[by * box.width + (cx - box.left)] = 0
          }
        }
      }
    }
    return known
  }

  for (let k = maxLevel; k >= 1; k--) {
    throwIfAborted(io.signal)
    const currPlate = plates[k + 1]!
    const levelElements = peelable.filter((e) => (e.level ?? 1) === k)
    if (!levelElements.length) {
      plates[k] = currPlate
      continue
    }

    // 6.1 本轮叶子实例分割（不再做二次 refineElementBox 重扩框，避免把上层剥离后的桌面补底晕染吸进容器框内）
    for (const el of levelElements) {
      throwIfAborted(io.signal)
      if (isTranslucentGlowElement(el)) continue

      const preSegBox = { ...el.box }
      const parent = el.parentId ? byId.get(el.parentId) : undefined
      const selfPaint = el.paintIndex ?? 0

      // 检测是否有已剥离的上层非文字元素跨越了当前元素框（若有跨边遮挡则在已剥离干净的 currPlate 上分割，否则在清晰无损的 textFree 上分割）
      let crossedByUpper = false
      for (const upper of ordered) {
        if (upper.plainText || (upper.paintIndex ?? 0) <= selfPaint) continue
        if (!maskById.has(upper.id)) continue
        const inter = rectIntersection(upper.box, preSegBox)
        if (inter <= 0) continue
        if (inter < rectArea(upper.box) * 0.92) {
          crossedByUpper = true
          break
        }
      }
      const segSource = crossedByUpper ? currPlate : textFree

      if (lockedBadgeMaskIds.has(el.id) && el.instanceMask && !io.segmentSam2) {
        // 复合角标或按钮内纯符号：保留已精确拆出的实例掩码
      } else if (
        (el.kind === 'panel' || el.kind === 'banner' || el.kind === 'item-slot') &&
        !io.segmentSam2
      ) {
        // 实心圆角容器在清晰无损的 textFree 上提取紧致圆角剪影，剔除框外四角桌面残片
        const contSil = segmentContainerSilhouette(textFree, preSegBox)
        if (contSil) {
          el.instanceMask = contSil
        }
      } else if (el.kind === 'frame' && !io.segmentSam2) {
        // 镂空边框交由剥层前后底板差分提取轮廓
      } else if (
        (el.kind === 'avatar' || el.kind === 'illustration') &&
        parent?.slotInnerRect &&
        !io.segmentSam2
      ) {
        // 上层角标（level > k）已在前面轮次剥离并补平，直接在干净 currPlate 上分割完整立绘
        const sameLevelRects = levelElements
          .filter(
            (s) =>
              s.id !== el.id &&
              (s.parentId === parent.id ||
                (s.parentId && byId.get(s.parentId)?.parentId === parent.id))
          )
          .map((s) => s.box)
        const portSeg = segmentPortraitInParentSlot(currPlate, parent.slotInnerRect, sameLevelRects)
        if (portSeg.fgRatio >= 0.12 && portSeg.fgRatio <= 0.94) {
          el.instanceMask = { rect: portSeg.rect, mask: portSeg.mask }
        }
      } else {
        // 剔除 VLM 当初点在「现已剥离的上层遮挡元素」上的负向提示点，避免在补平区域内误挖空洞
        const filteredNeg = el.negativePoints?.filter((pt) => {
          const px = Math.max(0, Math.min(W - 1, Math.round(pt.x)))
          const py = Math.max(0, Math.min(H - 1, Math.round(pt.y)))
          const insideBox =
            px >= preSegBox.left &&
            px < preSegBox.left + preSegBox.width &&
            py >= preSegBox.top &&
            py < preSegBox.top + preSegBox.height
          if (!insideBox) return true
          const own = ownership.owner[py * W + px]!
          return !(own >= 0 && (ownership.entries[own]?.paintIndex ?? -1) > selfPaint)
        })
        const segNode =
          filteredNeg && filteredNeg.length !== (el.negativePoints?.length ?? 0)
            ? { ...el, negativePoints: filteredNeg }
            : el
        const seg = await segmentElementInstance(segSource, segNode, io)
        const segTight = maskBoundingBox(seg.rect, seg.mask)
        if (segTight && seg.score.bboxIoU >= 0.35) {
          el.instanceMask = { rect: seg.rect, mask: seg.mask }
        }
      }

      if (el.instanceMask) {
        if (PALETTE_REFINE_KINDS.has(el.kind)) {
          const refined = refineMaskByPalette(segSource, el.instanceMask)
          if (refined.removed) {
            el.instanceMask = { rect: refined.rect, mask: refined.mask }
            paletteTrimmed += refined.removed
          }
        }
        el.instanceMask = trimLowerTranslucentGlowFromMask(
          textFree,
          el,
          el.instanceMask,
          ordered,
          ownership
        )
        el.instanceMask = solidifyInstanceMask(el.kind, el.instanceMask)
        let cm: CanvasMask = extendElementMaskUnderOccluders(el, el.instanceMask, ordered, maskById)
        if (crossedByUpper) {
          const sil = completeOccludedSilhouette({
            box: preSegBox,
            mask: cm,
            plate: currPlate,
            kind: el.kind,
            repairMode: el.repairMode,
            ownership,
            selfPaint,
            occluderPad: peelPadPx + 3
          })
          if (sil.added > 0) {
            cm = sil.mask
            silhouetteRestoredPx += sil.added
          }
        }
        el.instanceMask = { rect: cm.rect, mask: cm.mask }
        const tight = maskBoundingBox(cm.rect, cm.mask)
        if (tight) el.box = tight

        // 6.1b 若传入了共享组件库，在剥层前执行抗遮挡匹配并将剥层掩码扩展为 (原掩码 ∪ 母本足迹)
        if (options.components?.length && !el.plainText) {
          const detectedMask = projectCanvasMaskToBox(el.instanceMask, el.box)
          const knownMask = buildUnobstructedKnownMask(el.box, selfPaint)
          const observedPatch = cropImage(currPlate, el.box)
          const matched = matchElementToComponentLibrary({
            elementKind: el.kind,
            box: el.box,
            observedPatch,
            detectedMask,
            knownMask,
            hintedComponentId: el.matchedComponentId,
            candidates: options.components
          })
          if (matched) {
            componentMatchById.set(el.id, matched)
            const { unionMask } = buildComponentUnionPeelMask(
              el.box,
              detectedMask,
              matched.rendered,
              currPlate,
              knownMask
            )
            stampCanvasFootprint(el.box, unionMask)
            el.instanceMask = { rect: { ...el.box }, mask: unionMask }
          }
        }
      }
    }

    // 6.2 膨胀白洞 + 补图（本地推拉 / 槽位纯净渐变 / 图集或整版生图剥层），得到下一层底板 plates[k]
    const useGenerative = options.generativePeel !== false && k <= maxGen
    const { plate, report } = await peelLevel({
      io,
      plate: currPlate,
      elements: levelElements,
      allElements: tree.elements,
      backgroundRepairMode: tree.backgroundRepairMode,
      level: k,
      useGenerative,
      locale: options.locale
    })
    plates[k] = plate
    peelReport.push(...report)
    log(`peel L${k}: ${report.map((r) => `${r.method}×${r.elementCount}`).join(', ')}`)

    // 6.3 登记本轮叶子完整轮廓，刷新渐进归属图供下一轮下层元素感知遮挡
    for (const el of levelElements) {
      if (isTranslucentGlowElement(el)) continue
      if (el.instanceMask) {
        maskById.set(el.id, { rect: el.instanceMask.rect, mask: el.instanceMask.mask })
        continue
      }
      const diff = extractMatte(currPlate, plates[k]!, el.box, {
        fillHoles: OPAQUE_UI_ELEMENT_KINDS.has(el.kind)
      })
      if (!diff) continue
      let cm = alphaFootprint(diff.rect, diff.rgba, 128)
      cm = extendElementMaskUnderOccluders(el, cm, ordered, maskById)
      const sil = completeOccludedSilhouette({
        box: el.box,
        mask: cm,
        plate: currPlate,
        kind: el.kind,
        repairMode: el.repairMode,
        ownership,
        selfPaint: el.paintIndex ?? 0,
        occluderPad: peelPadPx + 3
      })
      if (sil.added > 0) {
        cm = sil.mask
        silhouetteRestoredPx += sil.added
      }
      if (options.components?.length && !el.plainText && !componentMatchById.has(el.id)) {
        const tightBox = maskBoundingBox(cm.rect, cm.mask) ?? cm.rect
        el.box = tightBox
        const detectedMask = projectCanvasMaskToBox(cm, tightBox)
        const knownMask = buildUnobstructedKnownMask(tightBox, el.paintIndex ?? 0)
        const observedPatch = cropImage(currPlate, tightBox)
        const matched = matchElementToComponentLibrary({
          elementKind: el.kind,
          box: tightBox,
          observedPatch,
          detectedMask,
          knownMask,
          hintedComponentId: el.matchedComponentId,
          candidates: options.components
        })
        if (matched) {
          componentMatchById.set(el.id, matched)
          const { unionMask, extraMask, extraPixelCount } = buildComponentUnionPeelMask(
            tightBox,
            detectedMask,
            matched.rendered,
            currPlate,
            knownMask
          )
          stampCanvasFootprint(tightBox, unionMask)
          eraseExtraComponentFootprintOnPlate(plates[k]!, tightBox, extraMask, extraPixelCount)
          cm = { rect: { ...tightBox }, mask: unionMask }
        }
      }
      maskById.set(el.id, cm)
    }
    ownership = rebuildProgressiveOwnership()
  }

  // 7) 全部层级轮廓与完整归属图确定后：
  //    a) 清扫各层外发光/抗锯齿残影（拥有 100% 完整归属图，绝不误伤同层或下层兄弟控件）；
  //    b) 对全部结构类控件执行跨层多实例融合 / 镜像 / 横轴扫描线补全；
  //    c) 对被遮挡立绘/全息影像执行按需单图层 AI 补全。
  for (const el of [...ordered].reverse()) {
    if (!isResidueScrubEligible(el, W, H)) continue
    const idx = entryIdx.get(el.id)
    const m = maskById.get(el.id)
    if (idx === undefined || !m) continue
    const k = levelOf(el)
    const scan = scanPlateResidue({
      plate: plates[k]!,
      upper: plates[k + 1]!,
      mask: m,
      ownership,
      entryIndex: idx,
      radius: haloRadiusFor(el)
    })
    if (scan.pixels.length < 3) continue
    scrubbedPx += scrubPlateResidue({ plates, level: k, residue: scan.pixels, mask: m })
    scrubbedEls++
  }

  const allCompletionTargets: CompletionTarget[] = ordered
    .filter(
      (el) =>
        !el.plainText &&
        !componentMatchById.has(el.id) &&
        entryIdx.has(el.id) &&
        maskById.has(el.id)
    )
    .map((el) => ({
      id: el.id,
      kind: el.kind,
      repairMode: el.repairMode,
      entryIndex: entryIdx.get(el.id)!,
      mask: maskById.get(el.id)!,
      plate: plates[levelOf(el) + 1]!
    }))
  const completion: CompletionReport = completeOccludedRegions({
    ownership,
    targets: allCompletionTargets
  })
  completion.prefabGroups = mergePrefabGroups(completion.prefabGroups)

  let generativeCompletion: GenerativeCompletionReport | undefined
  if (options.generativePeel !== false && io.editImage) {
    const maxCalls = Math.max(0, options.maxLayerCompletions ?? 4)
    if (maxCalls > 0) {
      generativeCompletion = await completeOccludedGenerative({
        io,
        ownership,
        locale: options.locale,
        maxCalls,
        targets: ordered
          .filter(
            (el) =>
              !el.plainText &&
              !componentMatchById.has(el.id) &&
              entryIdx.has(el.id) &&
              maskById.has(el.id)
          )
          .map((el) => ({
            id: el.id,
            name: el.name,
            kind: el.kind,
            repairMode: el.repairMode,
            entryIndex: entryIdx.get(el.id)!,
            mask: maskById.get(el.id)!,
            plate: plates[levelOf(el) + 1]!
          }))
      })
    } else {
      generativeCompletion = { attempted: 0, accepted: 0, rejected: 0, pixels: 0 }
    }
  }

  const base = plates[1] ?? textFree

  if (paletteTrimmed) log(`mask palette refine: trimmed ${paletteTrimmed} background px`)
  if (silhouetteRestoredPx) {
    log(`occluded silhouette completion: restored ${silhouetteRestoredPx} px`)
  }
  if (scrubbedPx) log(`residue scrub: ${scrubbedPx} px around ${scrubbedEls} element(s)`)
  if (
    completion.instances + completion.mirror + completion.axis > 0 ||
    completion.prefabGroups.length
  ) {
    log(
      `occlusion completion: instances ${completion.instances}, mirror ${completion.mirror}, axis ${completion.axis}, kept ${completion.kept} px; prefab groups ${completion.prefabGroups.length}`
    )
  }
  if (generativeCompletion?.attempted) {
    log(
      `layer completion (generative): ${generativeCompletion.accepted}/${generativeCompletion.attempted} accepted, ${generativeCompletion.pixels} px`
    )
  }

  const prefabKeyById = new Map<string, string>()
  completion.prefabGroups.forEach((g, gi) => {
    for (const id of g) prefabKeyById.set(id, `prefab_${gi + 1}`)
  })

  // 去字图可能被最高层元素的结构化/生成式补全修改：文字层按补全后的 textFree 重新解混去底色
  if (plainTexts.length) {
    textMattes = extractPlainTextMattes()
  }

  // 7.5 自上而下合成：维护「上层图层 alpha 累积图」，只有上层完全没覆盖的可见像素才锁定原图
  const aboveAlpha = new Float32Array(W * H)
  const stampAlpha = (rect: PixelRect, rgba: Uint8ClampedArray): void => {
    for (let y = 0; y < rect.height; y++) {
      const cy = rect.top + y
      if (cy < 0 || cy >= H) continue
      for (let x = 0; x < rect.width; x++) {
        const cx = rect.left + x
        if (cx < 0 || cx >= W) continue
        const a = rgba[(y * rect.width + x) * 4 + 3]! / 255
        const g = cy * W + cx
        if (a > aboveAlpha[g]!) aboveAlpha[g] = a
      }
    }
  }
  const matteById = new Map<string, { rect: PixelRect; rgba: Uint8ClampedArray }>()
  const originalRgbaById = new Map<string, Uint8ClampedArray>()
  let ownedCount = 0
  let fallbackCount = 0
  for (const el of [...ordered].reverse()) {
    throwIfAborted(io.signal)
    let matte: { rect: PixelRect; rgba: Uint8ClampedArray } | null = null
    if (el.plainText) {
      matte = textMattes.get(el.id) ?? null
    } else {
      const k = levelOf(el)
      const idx = entryIdx.get(el.id)
      const m = maskById.get(el.id)
      const unmixGlow = isTranslucentGlowElement(el)
      if (!unmixGlow && idx !== undefined && m) {
        matte = composeOwnedLayer({
          source,
          upper: plates[k + 1]!,
          lower: plates[k]!,
          mask: m,
          ownership,
          entryIndex: idx,
          haloRadius: haloRadiusFor(el),
          detectTranslucent: !OPAQUE_UI_ELEMENT_KINDS.has(el.kind),
          aboveAlpha
        })
        if (matte) ownedCount++
      }
      if (!matte) {
        // 半透明光效/发光底座/无轮廓面板：物理去底色反解 alpha，彻底剥离下层棕色桌面底色
        matte = extractMatte(plates[k + 1]!, plates[k]!, el.box, {
          fillHoles: !unmixGlow && OPAQUE_UI_ELEMENT_KINDS.has(el.kind),
          unmixTranslucent: unmixGlow,
          ...(unmixGlow ? { t0: 6, t1: 32 } : {}),
          ...(!unmixGlow && el.instanceMask ? { instanceMask: el.instanceMask } : {})
        })
        if (matte) fallbackCount++
      }
      const compMatch = componentMatchById.get(el.id)
      if (compMatch) {
        const targetRect = {
          left: el.box.left,
          top: el.box.top,
          width: compMatch.rendered.width,
          height: compMatch.rendered.height
        }
        if (matte) {
          if (matte.rect.width === targetRect.width && matte.rect.height === targetRect.height) {
            originalRgbaById.set(el.id, new Uint8ClampedArray(matte.rgba))
          } else {
            const resizedOrig = resizeBilinear(
              { width: matte.rect.width, height: matte.rect.height, data: matte.rgba },
              targetRect.width,
              targetRect.height
            )
            originalRgbaById.set(el.id, resizedOrig.data)
          }
        }
        matte = {
          rect: targetRect,
          rgba: new Uint8ClampedArray(compMatch.rendered.data)
        }
      }
    }
    if (!matte) continue
    matteById.set(el.id, matte)
    stampAlpha(matte.rect, matte.rgba)
  }
  if (componentMatchById.size > 0) {
    log(
      `component library matched: ${componentMatchById.size} element(s) replaced by clean masters`
    )
  }
  log(`compose: ${ownedCount} owned (pixel-locked), ${fallbackCount} diff-matte fallback`)

  // 7.6 底板可见像素锁定：没有任何图层覆盖（且非组件替换已剥离区域）的像素一律取原图
  let baseLocked = 0
  for (let g = 0; g < W * H; g++) {
    if (aboveAlpha[g]! > 0 || peeledByReplacement[g]) continue
    const i = g * 4
    if (
      base.data[i] !== source.data[i] ||
      base.data[i + 1] !== source.data[i + 1] ||
      base.data[i + 2] !== source.data[i + 2] ||
      base.data[i + 3] !== source.data[i + 3]
    ) {
      base.data[i] = source.data[i]!
      base.data[i + 1] = source.data[i + 1]!
      base.data[i + 2] = source.data[i + 2]!
      base.data[i + 3] = source.data[i + 3]!
      baseLocked++
    }
  }
  if (baseLocked) log(`base pixel lock: ${baseLocked} px restored from source`)

  const layers: PreciseSplitLayer[] = []
  const qaInputs: QaLayerInput[] = []
  for (const el of ordered) {
    const matte = matteById.get(el.id)
    if (!matte) {
      log(`skip "${el.name}": no separable pixels`)
      continue
    }
    const parent = el.parentId ? byId.get(el.parentId) : undefined
    const layer: PreciseSplitLayer = {
      id: el.id,
      elementId: el.id,
      name: el.name,
      kind: el.kind,
      parentElementId: el.parentId,
      paintIndex: el.paintIndex ?? layers.length + 1,
      left: matte.rect.left,
      top: matte.rect.top,
      width: matte.rect.width,
      height: matte.rect.height,
      rgba: matte.rgba
    }
    const controlType = elementControlType(el.kind)
    if (controlType) layer.uiControlType = controlType
    const role = elementPartRole(el, parent?.kind)
    if (role) layer.uiPartRole = role
    const prefabKey = prefabKeyById.get(el.id)
    if (prefabKey) layer.prefabKey = prefabKey
    const compMatch = componentMatchById.get(el.id)
    if (compMatch) {
      layer.componentId = compMatch.candidate.item.id
      layer.componentMatchScore = compMatch.score
      layer.prefabKey = compMatch.candidate.item.id
      const origRgba = originalRgbaById.get(el.id)
      if (origRgba) layer.originalRgba = origRgba
    }
    if (el.plainText && el.text) {
      const lm = textMaskById.get(el.id)
      layer.editableText = estimateEditableTextMeta({
        foregroundRgba: matte.rgba,
        width: matte.rect.width,
        height: matte.rect.height,
        rawName: el.name,
        ocrText: el.text,
        bgColor: lm?.bgColor,
        glyphCoverage: lm?.coverage
      })
    }
    layers.push(layer)
    const idx = entryIdx.get(el.id)
    const m = maskById.get(el.id)
    if (idx !== undefined && m) {
      const k = levelOf(el)
      qaInputs.push({
        elementId: el.id,
        name: el.name,
        kind: el.kind,
        ...(el.repairMode ? { repairMode: el.repairMode } : {}),
        plainText: !!el.plainText,
        entryIndex: idx,
        mask: m,
        layer: matte,
        lower: el.plainText ? textFree : plates[k]!,
        upper: el.plainText ? source : plates[k + 1]!,
        haloRadius: haloRadiusFor(el)
      })
    }
  }
  if (!layers.length) throw new PreciseSplitError('PRECISE_SPLIT_NO_ELEMENTS')
  // 父元素没抠出像素时，子图层挂到最近的仍存在的祖先
  const present = new Set(layers.map((l) => l.elementId))
  for (const layer of layers) {
    let pid = layer.parentElementId
    const guard = new Set<string>()
    while (pid && !present.has(pid) && !guard.has(pid)) {
      guard.add(pid)
      pid = byId.get(pid)?.parentId ?? null
    }
    layer.parentElementId = pid && present.has(pid) ? pid : null
  }

  // 8) 逐图层质检 + 叠回校验
  const qa = runSplitQa({ source, base, ownership, layers: qaInputs })
  for (const lq of qa.layers) {
    if (!lq.issues.length) continue
    log(
      `qa "${lq.name}": ${lq.issues.join(', ')} (halo ${lq.scores.edgeHalo.toFixed(2)}, residue ${lq.scores.baseResidue.toFixed(2)}, dup ${lq.scores.occludedDup.toFixed(2)}, coverage ${lq.scores.coverage.toFixed(2)})`
    )
  }
  log(`qa: ${qa.flagged}/${qa.layers.length} layer(s) flagged`)

  // 9) 产品化：透明像素 RGB 外扩（引擎双线性过滤 / mipmap 不出黑边），alpha 不变、叠回结果不变
  let bled = 0
  for (const layer of layers) bled += bleedTransparentRgb(layer.rgba, layer.width, layer.height, 4)
  if (bled) log(`alpha bleed: ${bled} transparent px colourised`)

  const recomposed = cloneImage(base)
  for (const layer of layers) {
    compositeOver(
      recomposed,
      { width: layer.width, height: layer.height, data: layer.rgba },
      layer.left,
      layer.top
    )
  }
  const reconstructionError = meanAbsoluteError(recomposed, source)
  log(`reconstruction error: ${reconstructionError.toFixed(2)} / 255, layers: ${layers.length}`)

  return {
    canvasWidth: W,
    canvasHeight: H,
    base,
    layers,
    tree,
    reconstructionError,
    peelReport,
    qa,
    completion,
    ...(generativeCompletion ? { generativeCompletion } : {}),
    ...(componentMatchById.size > 0
      ? {
          componentMatches: [...componentMatchById.entries()].map(([elementId, m]) => ({
            elementId,
            componentId: m.candidate.item.id,
            score: m.score
          }))
        }
      : {}),
    notes
  }
}

/** 实例掩码需要调色板精修（剔除边带上多包进来的底色）的类别；大面板 / 立绘 / 文字不做 */
const PALETTE_REFINE_KINDS: ReadonlySet<UiElementKind> = new Set<UiElementKind>([
  'icon',
  'badge',
  'button',
  'close-button',
  'tab',
  'arrow',
  'decoration',
  'item-slot',
  'frame',
  'banner',
  'progress-bar',
  'art-text',
  'other'
])

/** 会带外发光 / 投影 / 描边光的控件类别：光晕带半径随尺寸放大 */
const HALO_UI_ELEMENT_KINDS: ReadonlySet<UiElementKind> = new Set<UiElementKind>([
  'button',
  'close-button',
  'tab',
  'badge',
  'icon',
  'item-slot',
  'frame',
  'banner',
  'art-text',
  'decoration',
  'arrow',
  'progress-bar'
])

const TRANSLUCENT_GLOW_NAME_RE =
  /(?:发光底座|投影底座|全息底座|全息投影.*底座|光圈|发光|光效|光晕|光束|投影光|glow|halo|light\s*beam|hologram\s*base)/i // cjk-ok

function isTranslucentGlowElement(el: UiElementNode): boolean {
  if (el.kind === 'effect') return true
  if ((el.kind === 'decoration' || el.kind === 'other') && TRANSLUCENT_GLOW_NAME_RE.test(el.name)) {
    return true
  }
  return false
}

function haloRadiusFor(el: UiElementNode): number {
  if (el.plainText || !HALO_UI_ELEMENT_KINDS.has(el.kind)) return 2
  const s = Math.min(el.box.width, el.box.height)
  return Math.max(2, Math.min(10, Math.round(s * 0.12)))
}

function isResidueScrubEligible(el: UiElementNode, W: number, H: number): boolean {
  if (el.plainText || isTranslucentGlowElement(el)) return false
  if (el.kind === 'avatar' || el.kind === 'illustration' || el.kind === 'effect') return false
  return rectArea(el.box) < W * H * 0.25
}

/** RGBA 图块的 alpha 足迹（≥ threshold）→ 画布掩码 */
function alphaFootprint(rect: PixelRect, rgba: Uint8ClampedArray, threshold: number): CanvasMask {
  const mask = new Uint8Array(rect.width * rect.height)
  for (let p = 0; p < mask.length; p++) mask[p] = rgba[p * 4 + 3]! >= threshold ? 1 : 0
  return { rect: { ...rect }, mask }
}

/**
 * 当立绘/全息人像站在下层半透明发光底座（isTranslucentGlowElement）上时，
 * 实例分割容易把底座光晕与深色背景的混合色误并入人像底部，导致剥离人像时把下层发光底座挖空。
 * 这里采样发光底座紧邻上方的腿部/下摆真实前景色，在底座重叠区内剔除与人像下端颜色显著偏离的半透明光晕像素。
 */
function trimLowerTranslucentGlowFromMask(
  cleanSource: RgbaImage,
  el: UiElementNode,
  im: { rect: PixelRect; mask: Uint8Array },
  ordered: readonly UiElementNode[],
  ownership: OwnershipMap
): { rect: PixelRect; mask: Uint8Array } {
  if (el.plainText || isTranslucentGlowElement(el) || OPAQUE_UI_ELEMENT_KINDS.has(el.kind)) {
    return im
  }
  const selfPaint = el.paintIndex ?? 0
  const lowerGlows = ordered.filter(
    (o) =>
      (o.paintIndex ?? 0) < selfPaint &&
      isTranslucentGlowElement(o) &&
      rectIntersection(o.box, im.rect) > 0 &&
      o.box.top > im.rect.top + im.rect.height * 0.45
  )
  if (!lowerGlows.length) return im

  const { width: rw, height: rh, left: rx, top: ry } = im.rect
  const W = cleanSource.width
  const out = new Uint8Array(im.mask)
  let changed = false

  for (const glow of lowerGlows) {
    const bandTop = Math.max(0, glow.box.top - Math.max(16, Math.round(rh * 0.25)) - ry)
    const bandBot = Math.max(0, Math.min(rh, glow.box.top - ry))
    if (bandBot <= bandTop) continue

    const rs: number[] = []
    const gs: number[] = []
    const bs: number[] = []
    for (let y = bandTop; y < bandBot; y++) {
      const row = y * rw
      const cy = ry + y
      for (let x = 0; x < rw; x++) {
        if (!out[row + x]) continue
        const cx = rx + x
        const own = ownership.owner[cy * W + cx]!
        if (own >= 0 && (ownership.entries[own]?.paintIndex ?? -1) > selfPaint) continue
        const gi = (cy * W + cx) * 4
        rs.push(cleanSource.data[gi]!)
        gs.push(cleanSource.data[gi + 1]!)
        bs.push(cleanSource.data[gi + 2]!)
      }
    }
    if (rs.length < 6) continue
    const refPx = new Uint8ClampedArray([median(rs), median(gs), median(bs), 255])
    const devs = rs.map((r, idx) =>
      pixelDistance(new Uint8ClampedArray([r, gs[idx]!, bs[idx]!, 255]), 0, refPx, 0)
    )
    const tol = Math.max(32, Math.min(54, median(devs) * 2.2 + 24))

    const gx0 = Math.max(0, glow.box.left - rx)
    const gy0 = Math.max(0, glow.box.top - ry)
    const gx1 = Math.min(rw, glow.box.left + glow.box.width - rx)
    const gy1 = Math.min(rh, glow.box.top + glow.box.height - ry)
    for (let y = gy0; y < gy1; y++) {
      const row = y * rw
      const cy = ry + y
      for (let x = gx0; x < gx1; x++) {
        const p = row + x
        if (!out[p]) continue
        const cx = rx + x
        const own = ownership.owner[cy * W + cx]!
        if (own >= 0 && (ownership.entries[own]?.paintIndex ?? -1) > selfPaint) continue
        const pi = (cy * W + cx) * 4
        if (pixelDistance(cleanSource.data, pi, refPx, 0) > tol) {
          out[p] = 0
          changed = true
        }
      }
    }
  }

  if (!changed) return im
  // 只保留与底座上方主体相连的连通域，剔除底座区域内孤立的高光噪点
  const minGlowTop = Math.min(...lowerGlows.map((g) => g.box.top - ry))
  const { labels, stats } = labelComponents(out, rw, rh)
  const keep = new Set<number>()
  for (const s of stats) {
    if (s.minY < minGlowTop) keep.add(s.label)
  }
  if (!keep.size) return im
  for (let p = 0; p < out.length; p++) {
    if (out[p] && !keep.has(labels[p]!)) out[p] = 0
  }
  return { rect: im.rect, mask: out }
}

/**
 * 实心控件补洞：OPAQUE 类（除 frame）补全部内孔；
 * 立绘/全息人像/装饰类只补 ≤ 96px（且 < 1.5%）的细小针孔，保留双臂与躯干、双腿之间的背景镂空。
 */
function solidifyInstanceMask(
  kind: UiElementKind,
  im: { rect: PixelRect; mask: Uint8Array }
): { rect: PixelRect; mask: Uint8Array } {
  const { width: w, height: h } = im.rect
  const filled = fillHoles(im.mask, w, h)
  if (OPAQUE_UI_ELEMENT_KINDS.has(kind) && kind !== 'frame') return { rect: im.rect, mask: filled }
  const holes = new Uint8Array(filled.length)
  let filledArea = 0
  for (let p = 0; p < filled.length; p++) {
    if (filled[p]) filledArea++
    if (filled[p] && !im.mask[p]) holes[p] = 1
  }
  const { labels, stats } = labelComponents(holes, w, h)
  if (!stats.length) return im
  const isFreeformFigure = kind === 'avatar' || kind === 'illustration' || kind === 'decoration'
  const smallLimit = isFreeformFigure ? Math.min(96, filledArea * 0.015) : filledArea * 0.08
  const keep = new Set(stats.filter((s) => s.area < smallLimit).map((s) => s.label))
  const out = new Uint8Array(im.mask)
  for (let p = 0; p < out.length; p++) {
    if (holes[p] && keep.has(labels[p]!)) out[p] = 1
  }
  return { rect: im.rect, mask: out }
}

/**
 * 被上层遮挡的部分并入当前下层元素轮廓：
 * - 规则实心控件（OPAQUE 类）把中心落在其框内且相连的上层元素整块并入；
 * - 异形元素（立绘 / 全息人像 / 图标）只并入落在上下相邻可见轮廓行横向跨度之内的被遮挡像素，
 *   绝不把向外伸出人像躯干的穴位标签框（如「足三里 ST36」伸到棕褐色书架上的矩形）硬塞进人像轮廓。
 */
function extendElementMaskUnderOccluders(
  lowerEl: UiElementNode,
  lowerMask: CanvasMask,
  ordered: readonly UiElementNode[],
  maskById: ReadonlyMap<string, CanvasMask>
): CanvasMask {
  if (lowerEl.plainText || isTranslucentGlowElement(lowerEl)) return lowerMask
  const r = lowerMask.rect
  const isOpaqueKind = OPAQUE_UI_ELEMENT_KINDS.has(lowerEl.kind)
  const grown = dilateMask(lowerMask.mask, r.width, r.height, 1)

  let rowMinX: Int32Array | null = null
  let rowMaxX: Int32Array | null = null
  if (!isOpaqueKind) {
    rowMinX = new Int32Array(r.height).fill(r.width)
    rowMaxX = new Int32Array(r.height).fill(-1)
    for (let y = 0; y < r.height; y++) {
      const row = y * r.width
      for (let x = 0; x < r.width; x++) {
        if (!lowerMask.mask[row + x]) continue
        if (x < rowMinX[y]!) rowMinX[y] = x
        if (x > rowMaxX[y]!) rowMaxX[y] = x
      }
    }
    // 对被遮挡截断的行，由上下最近 48px 内的可见轮廓行线性插值横向跨度上界
    for (let y = 0; y < r.height; y++) {
      if (rowMaxX[y]! >= rowMinX[y]!) continue
      let topY = -1
      for (let yy = y - 1; yy >= Math.max(0, y - 48); yy--) {
        if (rowMaxX[yy]! >= rowMinX[yy]!) {
          topY = yy
          break
        }
      }
      let botY = -1
      for (let yy = y + 1; yy <= Math.min(r.height - 1, y + 48); yy++) {
        if (rowMaxX[yy]! >= rowMinX[yy]!) {
          botY = yy
          break
        }
      }
      if (topY >= 0 && botY >= 0) {
        const t = (y - topY) / (botY - topY)
        rowMinX[y] = Math.round(rowMinX[topY]! + (rowMinX[botY]! - rowMinX[topY]!) * t)
        rowMaxX[y] = Math.round(rowMaxX[topY]! + (rowMaxX[botY]! - rowMaxX[topY]!) * t)
      } else if (topY >= 0) {
        rowMinX[y] = rowMinX[topY]!
        rowMaxX[y] = rowMaxX[topY]!
      } else if (botY >= 0) {
        rowMinX[y] = rowMinX[botY]!
        rowMaxX[y] = rowMaxX[botY]!
      }
    }
  }

  let merged: Uint8Array | null = null
  const lowerPaint = lowerEl.paintIndex ?? 0
  for (const upperEl of ordered) {
    if ((upperEl.paintIndex ?? 0) <= lowerPaint) continue
    const mj = maskById.get(upperEl.id)
    if (!mj) continue
    const cxj = mj.rect.left + mj.rect.width / 2
    const cyj = mj.rect.top + mj.rect.height / 2
    if (cxj < r.left || cyj < r.top || cxj >= r.left + r.width || cyj >= r.top + r.height) {
      continue
    }
    if (rectIntersection(r, mj.rect) <= 0) continue
    let touches = false
    const add: number[] = []
    for (let y = 0; y < mj.rect.height; y++) {
      const ly = mj.rect.top + y - r.top
      if (ly < 0 || ly >= r.height) continue
      for (let x = 0; x < mj.rect.width; x++) {
        if (!mj.mask[y * mj.rect.width + x]) continue
        const lx = mj.rect.left + x - r.left
        if (lx < 0 || lx >= r.width) continue
        const lp = ly * r.width + lx
        if (grown[lp]) touches = true
        if (!isOpaqueKind && rowMinX && rowMaxX) {
          const minX = rowMinX[ly]!
          const maxX = rowMaxX[ly]!
          if (maxX < minX || lx < minX - 2 || lx > maxX + 2) continue
        }
        add.push(lp)
      }
    }
    if (!touches || !add.length) continue
    if (!merged) merged = new Uint8Array(lowerMask.mask)
    for (const lp of add) merged[lp] = 1
  }
  return merged ? { rect: r, mask: merged } : lowerMask
}

/** 归并跨轮次（含 donors 借像素）产生的预制体等价组，输出互不相交的组件组 */
function mergePrefabGroups(groups: readonly string[][]): string[][] {
  if (!groups.length) return []
  const parent = new Map<string, string>()
  const order = new Map<string, number>()
  let seq = 0
  const find = (x: string): string => {
    let cur = x
    while (parent.get(cur) !== cur) cur = parent.get(cur)!
    let walk = x
    while (walk !== cur) {
      const next = parent.get(walk)!
      parent.set(walk, cur)
      walk = next
    }
    return cur
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    if ((order.get(ra) ?? 0) <= (order.get(rb) ?? 0)) parent.set(rb, ra)
    else parent.set(ra, rb)
  }
  for (const g of groups) {
    for (const id of g) {
      if (!parent.has(id)) {
        parent.set(id, id)
        order.set(id, seq++)
      }
    }
    for (let i = 1; i < g.length; i++) union(g[0]!, g[i]!)
  }
  const buckets = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const r = find(id)
    const list = buckets.get(r) ?? []
    list.push(id)
    buckets.set(r, list)
  }
  return [...buckets.values()].filter((g) => g.length >= 2)
}

/** 供执行器组 PSD 分组：有子图层的元素各成一组（组内含其本体图层） */
export function groupableElementIds(layers: readonly PreciseSplitLayer[]): Set<string> {
  const present = new Set(layers.map((l) => l.elementId))
  const out = new Set<string>()
  for (const l of layers) {
    if (l.parentElementId && present.has(l.parentElementId)) out.add(l.parentElementId)
  }
  return out
}

export type { UiElementNode }
