/**
 * VLM 版面解析结果 → 元素树：
 * 1. 宽容解析 JSON（代码块 / 前后说明 / 数组或对象包裹 / box_2d 与 bbox 两种口径 / 0-1 与 0-1000 两种尺度）
 * 2. OCR 融合：文字元素的几何以本地 OCR 像素框为准，VLM 负责纠错与语义；未被认领的 OCR 文本补成文字元素
 * 3. 几何校正父子关系（VLM 声明的父级不包含子级时，改挂到最小的包含容器上）
 * 4. 同级绘制顺序 + DFS 绘制序号 + 遮挡层级（决定逐级剥层的次序）
 */

import type { LocalOcrTextBox, UiControlPartRole, UiControlType } from '../uiControlSpec'
import { clampRect, rectArea, rectIntersection, rectUnion } from './pixels'
import {
  UI_ELEMENT_KINDS,
  type PixelRect,
  type UiElementKind,
  type UiElementNode,
  type UiLayoutTree
} from './types'

export interface RawLayoutElement {
  id: string
  name: string
  kind: UiElementKind
  box: PixelRect
  /** VLM 声明的父级 id；null = 直接放在背景上 */
  parentRef: string | null
  order: number
  ocrRefs: number[]
  text?: string
}

export interface ParsedLayout {
  screenKind?: string
  elements: RawLayoutElement[]
}

const KIND_SET = new Set<string>(UI_ELEMENT_KINDS)

const KIND_ALIASES: Record<string, UiElementKind> = {
  btn: 'button',
  'cta-button': 'button',
  cta: 'button',
  close: 'close-button',
  'close-btn': 'close-button',
  closebutton: 'close-button',
  'nav-arrow': 'arrow',
  'page-arrow': 'arrow',
  tabs: 'tab',
  'tab-bar': 'tab',
  slot: 'item-slot',
  'reward-slot': 'item-slot',
  cell: 'item-slot',
  card: 'panel',
  container: 'panel',
  dialog: 'panel',
  popup: 'panel',
  window: 'panel',
  border: 'frame',
  ribbon: 'banner',
  header: 'banner',
  title: 'art-text',
  label: 'text',
  number: 'text',
  'text-block': 'text',
  art_text: 'art-text',
  arttext: 'art-text',
  logo: 'art-text',
  image: 'illustration',
  character: 'illustration',
  portrait: 'illustration',
  figure: 'illustration',
  progress: 'progress-bar',
  bar: 'progress-bar',
  'hp-bar': 'progress-bar',
  separator: 'divider',
  line: 'divider',
  ornament: 'decoration',
  glow: 'effect',
  overlay: 'effect',
  mask: 'effect',
  dot: 'decoration',
  'page-dot': 'decoration',
  indicator: 'decoration',
  'icon-badge': 'badge',
  tag: 'badge',
  'red-dot': 'badge'
}

/** 只做空白规整：中日韩字符之间的分词空格去掉，其余保留 */
export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/\r?\n+/g, ' ')
    .replace(/([\u3000-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u9fff\uff00-\uffef])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function normalizeElementKind(raw: unknown): UiElementKind {
  const s =
    typeof raw === 'string'
      ? raw
          .trim()
          .toLowerCase()
          .replace(/[\s_]+/g, '-')
      : ''
  if (KIND_SET.has(s)) return s as UiElementKind
  if (KIND_ALIASES[s]) return KIND_ALIASES[s]!
  if (s.includes('button')) return 'button'
  if (s.includes('icon')) return 'icon'
  if (s.includes('text')) return 'text'
  if (s.includes('panel')) return 'panel'
  return 'other'
}

function extractJsonCandidate(raw: string): unknown {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return null
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const body = fence ? fence[1]!.trim() : trimmed
  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  const direct = tryParse(body)
  if (direct !== undefined) return direct
  const o0 = body.indexOf('{')
  const o1 = body.lastIndexOf('}')
  if (o0 >= 0 && o1 > o0) {
    const obj = tryParse(body.slice(o0, o1 + 1))
    if (obj !== undefined) return obj
  }
  const a0 = body.indexOf('[')
  const a1 = body.lastIndexOf(']')
  if (a0 >= 0 && a1 > a0) {
    const arr = tryParse(body.slice(a0, a1 + 1))
    if (arr !== undefined) return arr
  }
  return null
}

function readBox(rec: Record<string, unknown>, width: number, height: number): PixelRect | null {
  let ymin: number
  let xmin: number
  let ymax: number
  let xmax: number
  const box2d = Array.isArray(rec.box_2d) ? rec.box_2d : Array.isArray(rec.box2d) ? rec.box2d : null
  const bbox = Array.isArray(rec.bbox) ? rec.bbox : Array.isArray(rec.box) ? rec.box : null
  if (box2d && box2d.length >= 4) {
    ;[ymin, xmin, ymax, xmax] = box2d.slice(0, 4).map(Number) as [number, number, number, number]
  } else if (bbox && bbox.length >= 4) {
    ;[xmin, ymin, xmax, ymax] = bbox.slice(0, 4).map(Number) as [number, number, number, number]
  } else {
    return null
  }
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null
  const maxV = Math.max(ymin, xmin, ymax, xmax)
  let sx: number
  let sy: number
  if (maxV <= 1.05) {
    sx = width
    sy = height
  } else if (maxV <= 1000.5) {
    sx = width / 1000
    sy = height / 1000
  } else {
    // 少数模型直接给像素坐标
    sx = 1
    sy = 1
  }
  const x0 = Math.min(xmin, xmax) * sx
  const x1 = Math.max(xmin, xmax) * sx
  const y0 = Math.min(ymin, ymax) * sy
  const y1 = Math.max(ymin, ymax) * sy
  if (x1 - x0 < 2 || y1 - y0 < 2) return null
  return clampRect({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }, width, height)
}

function readOcrRefs(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const out: number[] = []
  for (const item of list) {
    const m = /^\s*T?\s*(\d+)\s*$/i.exec(String(item))
    if (m) out.push(Number(m[1]) - 1)
  }
  return out
}

/** 宽容解析 VLM 版面 JSON，坐标换算到给定画布像素 */
export function parseLayoutResponse(
  raw: string,
  width: number,
  height: number,
  maxElements = 120
): ParsedLayout {
  const parsed = extractJsonCandidate(raw)
  let list: unknown[] = []
  let screenKind: string | undefined
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    screenKind = typeof obj.screenKind === 'string' ? obj.screenKind.trim() : undefined
    const arr =
      (Array.isArray(obj.elements) && obj.elements) ||
      (Array.isArray(obj.layers) && obj.layers) ||
      (Array.isArray(obj.items) && obj.items) ||
      Object.values(obj).find((v) => Array.isArray(v))
    list = Array.isArray(arr) ? arr : []
  }
  const elements: RawLayoutElement[] = []
  const seen = new Set<string>()
  for (const [index, item] of list.entries()) {
    if (elements.length >= maxElements) break
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const box = readBox(rec, width, height)
    if (!box) continue
    let id = typeof rec.id === 'string' || typeof rec.id === 'number' ? String(rec.id).trim() : ''
    if (!id || seen.has(id)) id = `e${index + 1}_${elements.length}`
    seen.add(id)
    const kind = normalizeElementKind(rec.kind ?? rec.type ?? rec.controlType)
    const parentRaw = rec.parent ?? rec.parentId ?? rec.parent_id
    const parentRef =
      parentRaw == null || parentRaw === '' || String(parentRaw).toLowerCase() === 'null'
        ? null
        : String(parentRaw).trim()
    const orderNum = Number(rec.order ?? rec.z ?? rec.zIndex)
    const textRaw =
      typeof rec.text === 'string' ? rec.text : typeof rec.ocrText === 'string' ? rec.ocrText : ''
    const text = cleanText(textRaw)
    const name =
      (typeof rec.name === 'string' && rec.name.trim()) || text || `${kind}_${elements.length + 1}`
    elements.push({
      id,
      name: name.slice(0, 48),
      kind,
      box,
      parentRef: parentRef === id ? null : parentRef,
      order: Number.isFinite(orderNum) ? orderNum : index,
      ocrRefs: readOcrRefs(rec.ocr ?? rec.ocrIds ?? rec.ocr_ids),
      ...(text ? { text } : {})
    })
  }
  return {
    ...(screenKind ? { screenKind } : {}),
    elements: dedupeElements(elements, width, height)
  }
}

function dedupeElements(
  list: RawLayoutElement[],
  width: number,
  height: number
): RawLayoutElement[] {
  const canvasArea = width * height
  const out: RawLayoutElement[] = []
  for (const el of list) {
    const area = rectArea(el.box)
    // 整张画布大小的非特效元素就是背景本身，交给底图
    if (area >= canvasArea * 0.97 && el.kind !== 'effect') continue
    const dup = out.find((o) => {
      const inter = rectIntersection(o.box, el.box)
      const union = rectArea(o.box) + area - inter
      return (
        union > 0 &&
        inter / union > 0.88 &&
        (o.kind === el.kind || isTextKind(o.kind) === isTextKind(el.kind))
      )
    })
    if (dup) {
      if (!dup.text && el.text) dup.text = el.text
      if (!dup.ocrRefs.length && el.ocrRefs.length) dup.ocrRefs = el.ocrRefs
      continue
    }
    out.push(el)
  }
  return out
}

export function isTextKind(kind: UiElementKind): boolean {
  return kind === 'text' || kind === 'art-text'
}

function centerInside(inner: PixelRect, outer: PixelRect, pad = 0): boolean {
  const cx = inner.left + inner.width / 2
  const cy = inner.top + inner.height / 2
  return (
    cx >= outer.left - pad &&
    cx <= outer.left + outer.width + pad &&
    cy >= outer.top - pad &&
    cy <= outer.top + outer.height + pad
  )
}

/** inner 有多少比例落在 outer 内 */
export function containment(inner: PixelRect, outer: PixelRect): number {
  const area = rectArea(inner)
  return area > 0 ? rectIntersection(inner, outer) / area : 0
}

function similarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, '')
  const y = b.replace(/\s+/g, '')
  if (!x || !y) return 0
  if (x === y) return 1
  const setY = new Map<string, number>()
  for (const ch of y) setY.set(ch, (setY.get(ch) ?? 0) + 1)
  let hit = 0
  for (const ch of x) {
    const n = setY.get(ch) ?? 0
    if (n > 0) {
      hit++
      setY.set(ch, n - 1)
    }
  }
  return (2 * hit) / (x.length + y.length)
}

/**
 * 原始元素 + OCR → 元素树（父子、绘制序、遮挡层级）。
 * @param rootParentId 局部放大复检时，把 parent=null 的元素挂到该容器下
 */
export function buildLayoutTree(input: {
  elements: RawLayoutElement[]
  ocr: readonly LocalOcrTextBox[]
  width: number
  height: number
  screenKind?: string
}): UiLayoutTree {
  const { width, height } = input
  const ocr = input.ocr.map((b) => ({ ...b, text: cleanText(b.text) }))
  const claimed = new Set<number>()
  const nodes: UiElementNode[] = []

  // 1) VLM 元素 + 文字 OCR 融合
  for (const raw of input.elements) {
    const node: UiElementNode = {
      id: raw.id,
      name: raw.name,
      kind: raw.kind,
      box: { ...raw.box },
      rawBox: { ...raw.box },
      parentId: raw.parentRef,
      order: raw.order
    }
    if (isTextKind(raw.kind)) {
      let refs = raw.ocrRefs.filter((i) => i >= 0 && i < ocr.length && !claimed.has(i))
      if (!refs.length) {
        const pad = Math.max(4, Math.round(raw.box.height * 0.2))
        refs = ocr
          .map((b, i) => ({ b, i }))
          .filter(({ b, i }) => !claimed.has(i) && b.text && centerInside(b, raw.box, pad))
          .map(({ i }) => i)
      }
      // VLM 引用了 OCR 但位置差太远的引用丢弃（防止串号）
      refs = refs.filter((i) => {
        const b = ocr[i]!
        const pad = Math.max(raw.box.height, 12)
        return centerInside(b, raw.box, pad)
      })
      for (const i of refs) claimed.add(i)
      const ocrText = refs
        .map((i) => ocr[i]!)
        .sort((a, b) => a.top - b.top || a.left - b.left)
        .map((b) => b.text)
        .join(' ')
        .trim()
      const vlmText = raw.text?.trim() ?? ''
      // 文字内容：VLM 读字（纠正 OCR 误识）优先；VLM 没给时用 OCR
      node.text = vlmText || ocrText || undefined
      if (vlmText && ocrText && similarity(vlmText, ocrText) < 0.25 && raw.kind === 'text') {
        // 两者完全对不上时以本地 OCR 为准（VLM 可能把邻近文字读串了）
        node.text = ocrText
      }
      node.plainText = raw.kind === 'text'
      if (refs.length && node.plainText) {
        const union = rectUnion(refs.map((i) => ocr[i]!))
        if (union) node.box = clampRect(union, width, height)
      }
      if (refs.length) node.ocrIndices = refs
    }
    nodes.push(node)
  }

  // 2) 未被认领的 OCR 文本：不在艺术字/图标/立绘里的，补成普通文字元素
  const artLike = nodes.filter(
    (n) =>
      n.kind === 'art-text' || n.kind === 'icon' || n.kind === 'illustration' || n.kind === 'avatar'
  )
  for (const [i, box] of ocr.entries()) {
    if (claimed.has(i) || !box.text) continue
    if (box.width < 4 || box.height < 4) continue
    if (artLike.some((a) => centerInside(box, a.box))) continue
    nodes.push({
      id: `ocr${i + 1}`,
      name: box.text.slice(0, 32),
      kind: 'text',
      box: clampRect(box, width, height),
      parentId: null,
      order: 10_000 + i,
      text: box.text,
      plainText: true,
      ocrIndices: [i]
    })
    claimed.add(i)
  }

  resolveParents(nodes)
  assignPaintOrder(nodes)
  assignOcclusionLevels(nodes)
  return {
    canvasWidth: width,
    canvasHeight: height,
    ...(input.screenKind ? { screenKind: input.screenKind } : {}),
    elements: nodes
  }
}

/** 几何校正父子：父级必须是面积更大的非文字元素且基本包含子级 */
export function resolveParents(nodes: UiElementNode[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    const area = rectArea(node.box)
    const declared = node.parentId ? byId.get(node.parentId) : undefined
    const valid = (p: UiElementNode | undefined, minContain: number): boolean =>
      !!p &&
      p !== node &&
      !isTextKind(p.kind) &&
      p.kind !== 'effect' &&
      rectArea(p.box) > area * 1.02 &&
      containment(node.box, p.box) >= minContain
    if (valid(declared, 0.55)) continue
    let best: UiElementNode | undefined
    for (const cand of nodes) {
      if (!valid(cand, 0.8)) continue
      if (!best || rectArea(cand.box) < rectArea(best.box)) best = cand
    }
    node.parentId = best?.id ?? null
  }
}

function childrenMap(nodes: UiElementNode[]): Map<string | null, UiElementNode[]> {
  const map = new Map<string | null, UiElementNode[]>()
  for (const n of nodes) {
    const key = n.parentId ?? null
    const list = map.get(key) ?? []
    list.push(n)
    map.set(key, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      // 文字压在同级图形之上；其余按 VLM 绘制序，再按面积从大到小
      const ta = isTextKind(a.kind) ? 1 : 0
      const tb = isTextKind(b.kind) ? 1 : 0
      if (a.kind === 'effect' && b.kind !== 'effect') return -1
      if (b.kind === 'effect' && a.kind !== 'effect') return 1
      return (
        ta - tb || a.order - b.order || rectArea(b.box) - rectArea(a.box) || a.box.top - b.box.top
      )
    })
  }
  return map
}

/** DFS 绘制序：父先于子，同级按排序 */
export function assignPaintOrder(nodes: UiElementNode[]): void {
  const map = childrenMap(nodes)
  let index = 0
  const seen = new Set<string>()
  const visit = (parent: string | null): void => {
    for (const child of map.get(parent) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      child.paintIndex = ++index
      visit(child.id)
    }
  }
  visit(null)
  // 防御：有环/悬空的节点追加在最后
  for (const n of nodes) {
    if (!seen.has(n.id)) n.paintIndex = ++index
  }
}

/**
 * 遮挡层级：level(E) = 1 + max(level(A))，A 为绘制序更早、且与 E 明显重叠的非普通文字元素
 * （祖先必然满足）。要还原 A 被 E 挡住的部分，必须先剥掉 E，所以 E 的层级更高。
 * 普通文字不参与（在最顶层本地去字）。
 */
export function assignOcclusionLevels(nodes: UiElementNode[], maxLevel = 12): void {
  const ordered = nodes
    .filter((n) => !n.plainText)
    .sort((a, b) => (a.paintIndex ?? 0) - (b.paintIndex ?? 0))
  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i]!
    const area = rectArea(e.box)
    let level = 1
    for (let j = 0; j < i; j++) {
      const a = ordered[j]!
      const inter = rectIntersection(a.box, e.box)
      if (!inter) continue
      const minArea = Math.max(1, Math.min(area, rectArea(a.box)))
      if (inter / minArea < 0.06) continue
      level = Math.max(level, (a.level ?? 1) + 1)
    }
    e.level = Math.min(maxLevel, level)
  }
}

/** 某元素的全部后代 id */
export function collectDescendantIds(nodes: readonly UiElementNode[], rootId: string): Set<string> {
  const out = new Set<string>()
  let added = true
  while (added) {
    added = false
    for (const n of nodes) {
      if (!n.parentId || out.has(n.id)) continue
      if (n.parentId === rootId || out.has(n.parentId)) {
        out.add(n.id)
        added = true
      }
    }
  }
  return out
}

export function elementControlType(kind: UiElementKind): UiControlType | undefined {
  switch (kind) {
    case 'button':
    case 'close-button':
    case 'arrow':
      return 'button'
    case 'panel':
    case 'frame':
      return 'panel'
    case 'item-slot':
      return 'item-slot'
    case 'progress-bar':
      return 'progress-bar'
    case 'tab':
      return 'tab-bar'
    case 'icon':
    case 'badge':
      return 'icon-badge'
    default:
      return undefined
  }
}

export function elementPartRole(
  node: Pick<UiElementNode, 'kind' | 'plainText'>,
  parentKind?: UiElementKind
): UiControlPartRole | undefined {
  if (isTextKind(node.kind)) {
    if (parentKind === 'button' || parentKind === 'close-button') return 'button-label'
    if (parentKind === 'tab') return 'tab-label'
    if (parentKind === 'item-slot') return 'slot-level-text'
    if (parentKind === 'panel' || parentKind === 'frame' || parentKind === 'banner') {
      return node.kind === 'art-text' ? 'panel-title' : 'panel-content-text'
    }
    return undefined
  }
  switch (node.kind) {
    case 'button':
      return 'button-bg-normal'
    case 'close-button':
      return 'panel-close-btn'
    case 'panel':
    case 'frame':
      return 'panel-frame-bg'
    case 'banner':
      return 'panel-header'
    case 'item-slot':
      return 'slot-bg'
    case 'icon':
      return parentKind === 'item-slot'
        ? 'slot-item-icon'
        : parentKind === 'button'
          ? 'button-icon'
          : 'icon-graphic'
    case 'badge':
      return parentKind === 'item-slot' ? 'slot-corner-badge' : 'icon-graphic'
    case 'decoration':
      return 'panel-ornament'
    default:
      return undefined
  }
}
