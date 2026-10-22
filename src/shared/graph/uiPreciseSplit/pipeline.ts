/**
 * 精准 UI 拆层流水线：
 *   本地 OCR ─┐
 *             ├─► VLM 版面解析（元素树）─► 大容器局部放大复检 ─► OCR 融合 / 父子校正 / 边缘吸附
 *   原图 ─────┘
 *   ─► 普通文字本地去字（plate 顶层）─► 按遮挡层级自上而下逐级剥层（生成式 / 本地 / 透明）
 *   ─► 每个元素 matte(plate[k+1], plate[k]) 抠出完整透明图层（被遮挡部分已补全）
 *   ─► 文字层 matte(原图, 去字图) + 可编辑文字元数据 ─► 叠回校验重建误差
 */

import { estimateEditableTextMeta } from '../uiControlSpec'
import {
  buildLayoutTree,
  collectDescendantIds,
  elementControlType,
  elementPartRole,
  isTextKind,
  parseLayoutResponse,
  type RawLayoutElement
} from './layout'
import { extractMatte } from './matting'
import { peelLevel, type PeelLevelReport } from './plates'
import {
  buildLayoutSystemPrompt,
  buildLayoutUserPrompt,
  buildZoomUserPrompt,
  formatOcrHints
} from './prompts'
import {
  cloneImage,
  compositeOver,
  cropImage,
  expandRect,
  inpaintPushPull,
  meanAbsoluteError,
  rectArea,
  resizeBilinear
} from './pixels'
import { paintLocalMask, refineElementBox, textStrokeMask } from './refine'
import type {
  PreciseSplitIo,
  PreciseSplitLayer,
  PreciseSplitOptions,
  PreciseSplitResult,
  RgbaImage,
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
  ocr: readonly LocalOcrTextBox[]
  options: PreciseSplitOptions
  zoomContainerName?: string
}): Promise<{ elements: RawLayoutElement[]; screenKind?: string }> {
  const { io, image, ocr, options } = input
  const dataUrl = await io.encodePng(image)
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
        sourceTitle: options.sourceTitle
      })
  const text = await io.vlm({
    system: buildLayoutSystemPrompt(options.locale),
    prompt,
    images: [dataUrl]
  })
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

  // 1) 本地 OCR
  let ocr: LocalOcrTextBox[] = []
  if (io.ocr) {
    try {
      ocr = (await io.ocr(source)).filter((b) => b.text?.trim() && b.width > 1 && b.height > 1)
    } catch {
      ocr = []
    }
  }
  log(`ocr: ${ocr.length} text boxes`)
  throwIfAborted(io.signal)

  // 2) VLM 版面解析
  const first = await runLayoutPass({ io, image: source, ocr, options })
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

  // 4) 元素树 + 边缘吸附（文字框来自 OCR，已是像素级，不再吸附）
  const tree = buildLayoutTree({
    elements: raw,
    ocr,
    width: W,
    height: H,
    screenKind: first.screenKind
  })
  for (const el of tree.elements) {
    if (el.plainText || el.kind === 'effect') continue
    el.box = refineElementBox(source, el.box)
  }

  // 5) 普通文字：笔画蒙版 → 本地去字，得到顶层底板
  const plainTexts = tree.elements.filter((e) => e.plainText)
  const textFree = cloneImage(source)
  if (plainTexts.length) {
    const hole = new Uint8Array(W * H)
    for (const t of plainTexts) paintLocalMask(hole, W, textStrokeMask(source, t.box))
    inpaintPushPull(textFree, hole)
  }

  // 6) 逐级剥层（自上而下）
  const peelable = tree.elements.filter((e) => !e.plainText)
  const maxLevel = peelable.reduce((m, e) => Math.max(m, e.level ?? 1), 0)
  const maxGen = Math.max(0, options.maxPeelLevels ?? 3)
  const plates: RgbaImage[] = []
  plates[maxLevel + 1] = textFree
  const peelReport: PeelLevelReport[] = []
  for (let k = maxLevel; k >= 1; k--) {
    throwIfAborted(io.signal)
    const levelElements = peelable.filter((e) => (e.level ?? 1) === k)
    if (!levelElements.length) {
      plates[k] = plates[k + 1]!
      continue
    }
    const useGenerative = options.generativePeel !== false && k <= maxGen
    const { plate, report } = await peelLevel({
      io,
      plate: plates[k + 1]!,
      elements: levelElements,
      level: k,
      useGenerative,
      locale: options.locale
    })
    plates[k] = plate
    peelReport.push(...report)
    log(`peel L${k}: ${report.map((r) => `${r.method}×${r.elementCount}`).join(', ')}`)
  }
  const base = plates[1] ?? textFree

  // 7) 抠图出层
  const byId = new Map(tree.elements.map((e) => [e.id, e]))
  const layers: PreciseSplitLayer[] = []
  const ordered = [...tree.elements].sort((a, b) => (a.paintIndex ?? 0) - (b.paintIndex ?? 0))
  for (const el of ordered) {
    throwIfAborted(io.signal)
    const parent = el.parentId ? byId.get(el.parentId) : undefined
    let matte
    if (el.plainText) {
      matte = extractMatte(
        source,
        textFree,
        expandRect(el.box, Math.max(2, Math.round(el.box.height * 0.18)), W, H),
        {
          t0: 8,
          t1: 36
        }
      )
    } else {
      const k = el.level ?? 1
      matte = extractMatte(plates[k + 1]!, plates[k]!, el.box, {
        fillHoles: OPAQUE_UI_ELEMENT_KINDS.has(el.kind)
      })
    }
    if (!matte) {
      log(`skip "${el.name}": no separable pixels`)
      continue
    }
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
    if (el.plainText && el.text) {
      layer.editableText = estimateEditableTextMeta({
        foregroundRgba: matte.rgba,
        width: matte.rect.width,
        height: matte.rect.height,
        rawName: el.name,
        ocrText: el.text
      })
    }
    layers.push(layer)
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

  // 8) 叠回校验
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
    notes
  }
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
