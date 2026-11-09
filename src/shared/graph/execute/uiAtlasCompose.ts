import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import {
  autoGroupLayersForGameUi,
  computeNineSliceFromRgbaBuffer,
  imageLayerSplitToNodePatch,
  isCanvasSafeImageSrc,
  isLayerSplitBase,
  layerSplitCompositeImageId,
  readImageLayerSplitFromNode,
  sortLayersForCompose,
  type ImageLayerSplitGroup,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState
} from '../imageLayerSplit'
import { buildGeneratedMediaFileKey, formatGeneratedMediaStamp } from '../../domain'
import type { UiEditableTextMeta } from '../uiControlSpec'
import {
  componentIdToPsdGuid,
  emptyUiComponentLibrary,
  mergeUiComponentLibraries,
  parseUiComponentLibrary,
  sanitizeComponentExportName,
  stringifyUiComponentLibrary,
  type UiComponentLibrary,
  type UiComponentScalePolicy,
  type UiSharedComponentItem
} from '../uiComponentLibrary'
import {
  bleedTransparentRgb,
  computeComponentVisualDescriptor,
  createImage,
  cropImage,
  labelComponents,
  renderComponentToRect,
  type PreciseSplitComponentCandidate,
  type RgbaImage
} from '../uiPreciseSplit'
import { flattenTextValues, flattenTextsValues } from './gallery'
import { commitGeneratedImages, materializeGeneratedBatch } from './materialize'
import {
  collectImageItemsFromValue,
  resolveNodeStyleImages,
  resolveStyleReferenceUrls
} from './mediaInputs'
import type { GraphImageItem, GraphValue, NodeExecuteContext } from './types'
import { resolveUpstreamComponentCandidates, uiComponentsValue } from './uiComponentLib'

export interface UiAtlasPlacementSpec {
  id?: string
  name: string
  exportName?: string
  componentId?: string
  groupId?: string
  left: number
  top: number
  width: number
  height: number
  zIndex?: number
  editableText?: UiEditableTextMeta
}

export interface UiAtlasLayoutPlan {
  canvasWidth: number
  canvasHeight: number
  baseColor?: [number, number, number]
  groups?: Array<{ id: string; name: string }>
  placements: UiAtlasPlacementSpec[]
}

const NINE_SLICE_KINDS = new Set([
  'panel',
  'frame',
  'banner',
  'button',
  'tab',
  'item-slot',
  'progress-bar',
  'card',
  'bar'
])

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(val))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function inferAtlasSliceKind(
  title: string,
  width: number,
  height: number,
  canvasW: number,
  canvasH: number
): string {
  const lower = title.toLowerCase()
  if (/panel|dialog|window|modal|bg_frame|底板|面板|主框|弹窗/.test(lower)) return 'panel' // cjk-ok
  if (/frame|border|边框|外框/.test(lower)) return 'frame' // cjk-ok
  if (/header|banner|title_bar|标题栏|横幅|顶栏/.test(lower)) return 'banner' // cjk-ok
  if (/bar|progress|slider|血条|进度条|资源条|底栏/.test(lower)) return 'bar' // cjk-ok
  if (/tab|页签|标签/.test(lower)) return 'tab' // cjk-ok
  if (/slot|cell|grid|card|格|槽|背包格|道具框|卡片/.test(lower)) return 'item-slot' // cjk-ok
  if (/btn|button|按钮/.test(lower)) return 'button' // cjk-ok
  if (/close|关闭/.test(lower)) return 'close-button' // cjk-ok
  if (/badge|tag|角标|红点|徽章/.test(lower)) return 'badge' // cjk-ok
  if (/icon|item|prop|gem|sword|coin|图标|道具|装备/.test(lower)) return 'icon' // cjk-ok

  const areaRatio = (width * height) / Math.max(1, canvasW * canvasH)
  const ar = width / Math.max(1, height)
  if (areaRatio >= 0.22) return 'panel'
  if (ar >= 3.2 && height <= 160) return 'banner'
  if (ar >= 1.7 && ar <= 3.6 && height >= 36 && height <= 140) return 'button'
  if (ar >= 0.82 && ar <= 1.22) {
    if (width >= 68 && width <= 220) return 'item-slot'
    if (width < 68) return 'icon'
  }
  if (ar >= 1.2 && ar < 1.7 && height <= 90) return 'tab'
  return 'other'
}

/**
 * Segments a raw image into 1 or more UI sprite candidates:
 * - If the image is a packed Sprite Sheet / Atlas (multiple disconnected alpha or foreground islands),
 *   slices each island into an independent `PreciseSplitComponentCandidate`.
 * - Otherwise registers the image itself as a single component candidate.
 */
export function extractAtlasCandidatesFromRgba(
  rgba: RgbaImage,
  baseTitle: string,
  startIndex: number
): PreciseSplitComponentCandidate[] {
  const w = rgba.width
  const h = rgba.height
  if (w < 4 || h < 4) return []

  // Build foreground mask: prefer alpha channel if image has transparency; otherwise compare against corner color
  const totalPx = w * h
  let transparentCount = 0
  for (let i = 3; i < rgba.data.length; i += 4) {
    if (rgba.data[i]! < 32) transparentCount++
  }
  const hasTransparency = transparentCount > totalPx * 0.08
  const mask = new Uint8Array(totalPx)

  if (hasTransparency) {
    for (let p = 0; p < totalPx; p++) {
      if (rgba.data[p * 4 + 3]! >= 28) mask[p] = 1
    }
  } else {
    // Sample 4 corners to estimate solid sheet background color
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4]
    let bgR = 0
    let bgG = 0
    let bgB = 0
    for (const c of corners) {
      bgR += rgba.data[c]!
      bgG += rgba.data[c + 1]!
      bgB += rgba.data[c + 2]!
    }
    bgR = Math.round(bgR / 4)
    bgG = Math.round(bgG / 4)
    bgB = Math.round(bgB / 4)
    for (let p = 0; p < totalPx; p++) {
      const idx = p * 4
      const diff =
        Math.abs(rgba.data[idx]! - bgR) +
        Math.abs(rgba.data[idx + 1]! - bgG) +
        Math.abs(rgba.data[idx + 2]! - bgB)
      if (diff > 36) mask[p] = 1
    }
  }

  const { stats } = labelComponents(mask, w, h)
  const validBoxes = stats
    .map((c) => ({
      area: c.area,
      rect: {
        left: c.minX,
        top: c.minY,
        width: c.maxX - c.minX + 1,
        height: c.maxY - c.minY + 1
      }
    }))
    .filter((c) => {
      const bw = c.rect.width
      const bh = c.rect.height
      return (
        bw >= 18 &&
        bh >= 18 &&
        c.area >= 180 &&
        bw * bh < totalPx * 0.82 &&
        bw * bh >= totalPx * 0.0015
      )
    })
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)

  const buildCandidate = (
    subRgba: RgbaImage,
    title: string,
    seqIndex: number
  ): PreciseSplitComponentCandidate => {
    bleedTransparentRgb(subRgba.data, subRgba.width, subRgba.height)
    const cleaned = subRgba
    const kind = inferAtlasSliceKind(title, cleaned.width, cleaned.height, w, h)
    const raw9s = NINE_SLICE_KINDS.has(kind)
      ? computeNineSliceFromRgbaBuffer(cleaned.data, cleaned.width, cleaned.height)
      : undefined
    // Convert [left, top, right, bottom] from computeNineSliceFromRgbaBuffer to CSS [top, right, bottom, left]
    const nineSliceBorders: [number, number, number, number] | undefined =
      raw9s && raw9s.some((v) => v > 0) ? [raw9s[1], raw9s[2], raw9s[3], raw9s[0]] : undefined
    const scalePolicy: UiComponentScalePolicy = nineSliceBorders ? 'nine-slice' : 'uniform'
    const id = `atlas_comp_${String(seqIndex).padStart(2, '0')}`
    const exportName = sanitizeComponentExportName(`${kind}_${title || id}`, seqIndex)
    const item: UiSharedComponentItem = {
      id,
      psdGuid: componentIdToPsdGuid(id),
      name: title || exportName,
      exportName,
      kind,
      canonicalWidth: cleaned.width,
      canonicalHeight: cleaned.height,
      scalePolicy,
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      sourceCount: 1,
      descriptor: computeComponentVisualDescriptor(cleaned)
    }
    return { item, rgba: cleaned }
  }

  // If 2 or more distinct islands were found on the sheet, slice each island out!
  if (validBoxes.length >= 2 && validBoxes.length <= 48) {
    const out: PreciseSplitComponentCandidate[] = []
    for (let i = 0; i < validBoxes.length; i++) {
      const box = validBoxes[i]!.rect
      const cropped = cropImage(rgba, box)
      // If original sheet had opaque solid background, zero alpha outside foreground mask
      if (!hasTransparency) {
        for (let y = 0; y < box.height; y++) {
          for (let x = 0; x < box.width; x++) {
            const srcP = (box.top + y) * w + (box.left + x)
            if (!mask[srcP]) {
              cropped.data[(y * box.width + x) * 4 + 3] = 0
            }
          }
        }
      }
      const sliceTitle = `${baseTitle || 'Atlas'}_${String(i + 1).padStart(2, '0')}`
      out.push(buildCandidate(cropped, sliceTitle, startIndex + i))
    }
    return out
  }

  return [buildCandidate(rgba, baseTitle || `Component_${startIndex}`, startIndex)]
}

/**
 * Generates a stylized dark game UI backdrop RGBA image when no full-screen background plate is supplied.
 */
function renderGameUiBackdropRgba(
  width: number,
  height: number,
  baseColor: [number, number, number] = [20, 24, 36]
): RgbaImage {
  const img = createImage(width, height)
  const [br, bg, bb] = baseColor
  const cx = width * 0.5
  const cy = height * 0.45
  const maxDist = Math.hypot(cx, cy) || 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.min(1, Math.hypot(x - cx, y - cy) / maxDist)
      const vignette = 1 - d * 0.42
      const idx = (y * width + x) * 4
      img.data[idx] = Math.max(0, Math.min(255, Math.round(br * vignette + (1 - d) * 14)))
      img.data[idx + 1] = Math.max(0, Math.min(255, Math.round(bg * vignette + (1 - d) * 18)))
      img.data[idx + 2] = Math.max(0, Math.min(255, Math.round(bb * vignette + (1 - d) * 24)))
      img.data[idx + 3] = 255
    }
  }
  return img
}

/**
 * Procedurally renders a 9-slice UI frame/button/slot RGBA component with outer border,
 * corner accents, inner bevel, and body fill. Used as a built-in UI Atlas Kit when
 * the user runs `ui.atlasCompose` with `in-text` / prompt before connecting an external image.
 */
function renderProceduralNineSliceComponentRgba(opts: {
  width: number
  height: number
  fillTop: [number, number, number]
  fillBottom: [number, number, number]
  borderOuter: [number, number, number]
  borderInner: [number, number, number]
  cornerAccent?: [number, number, number]
  borderThickness?: number
  cornerRadius?: number
  alpha?: number
}): RgbaImage {
  const w = Math.max(24, Math.round(opts.width))
  const h = Math.max(24, Math.round(opts.height))
  const img = createImage(w, h)
  const bt = opts.borderThickness ?? 3
  const cr = opts.cornerRadius ?? 6
  const alpha = opts.alpha ?? 242
  const accent = opts.cornerAccent ?? opts.borderInner

  for (let y = 0; y < h; y++) {
    const ty = h > 1 ? y / (h - 1) : 0
    const fr = Math.round(opts.fillTop[0] * (1 - ty) + opts.fillBottom[0] * ty)
    const fg = Math.round(opts.fillTop[1] * (1 - ty) + opts.fillBottom[1] * ty)
    const fb = Math.round(opts.fillTop[2] * (1 - ty) + opts.fillBottom[2] * ty)

    for (let x = 0; x < w; x++) {
      // Chamfered corner clip
      const dx = Math.min(x, w - 1 - x)
      const dy = Math.min(y, h - 1 - y)
      if (dx + dy < cr) continue

      const distEdge = Math.min(dx, dy)
      const isOuterBorder = distEdge < bt || dx + dy < cr + bt
      const isInnerBevel =
        !isOuterBorder && (distEdge === bt || distEdge === bt + 1 || dx + dy === cr + bt)
      const isCornerOrnament = dx < bt * 4 && dy < bt * 4 && (dx < bt * 2 || dy < bt * 2)

      const idx = (y * w + x) * 4
      if (isCornerOrnament) {
        img.data[idx] = accent[0]
        img.data[idx + 1] = accent[1]
        img.data[idx + 2] = accent[2]
        img.data[idx + 3] = 255
      } else if (isOuterBorder) {
        img.data[idx] = opts.borderOuter[0]
        img.data[idx + 1] = opts.borderOuter[1]
        img.data[idx + 2] = opts.borderOuter[2]
        img.data[idx + 3] = 255
      } else if (isInnerBevel) {
        img.data[idx] = opts.borderInner[0]
        img.data[idx + 1] = opts.borderInner[1]
        img.data[idx + 2] = opts.borderInner[2]
        img.data[idx + 3] = 250
      } else {
        img.data[idx] = fr
        img.data[idx + 1] = fg
        img.data[idx + 2] = fb
        img.data[idx + 3] = alpha
      }
    }
  }
  return img
}

/**
 * Synthesizes a built-in 9-slice Game UI Atlas Component Kit (Panel, Header Banner,
 * Progress Bar, Active/Normal Tabs, Item Grid Slot, Primary/Secondary Buttons, Icons & Badges)
 * when `ui.atlasCompose` is executed without an upstream `ui.componentLib` or raw atlas image.
 */
export function synthesizeProceduralUiAtlasKit(prompt = ''): PreciseSplitComponentCandidate[] {
  const isSciFi = /舰炮|科幻|机甲|战术|终端|星际|cyber|sci-?fi|tech/i.test(prompt) // cjk-ok
  const specs: Array<{
    id: string
    name: string
    exportName: string
    kind: UiSharedComponentItem['kind']
    width: number
    height: number
    scalePolicy: UiComponentScalePolicy
    nineSliceBorders?: [number, number, number, number]
    rgba: RgbaImage
  }> = [
    {
      id: 'atlas_kit_panel',
      name: '主界面九宫格底框面板', // cjk-ok
      exportName: 'Panel_Main_Window_9S',
      kind: 'panel',
      width: 256,
      height: 192,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [24, 24, 24, 24],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 256,
        height: 192,
        fillTop: isSciFi ? [22, 32, 48] : [28, 30, 42],
        fillBottom: isSciFi ? [14, 20, 32] : [18, 20, 28],
        borderOuter: isSciFi ? [56, 138, 210] : [168, 136, 78],
        borderInner: isSciFi ? [110, 195, 250] : [235, 202, 132],
        cornerAccent: [255, 226, 148],
        borderThickness: 3,
        cornerRadius: 8,
        alpha: 242
      })
    },
    {
      id: 'atlas_kit_header',
      name: '顶部信息栏横幅底板', // cjk-ok
      exportName: 'Banner_Top_Header_9S',
      kind: 'banner',
      width: 240,
      height: 56,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [12, 24, 12, 24],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 240,
        height: 56,
        fillTop: isSciFi ? [30, 46, 70] : [42, 36, 52],
        fillBottom: isSciFi ? [18, 28, 46] : [24, 22, 34],
        borderOuter: isSciFi ? [72, 160, 232] : [192, 156, 92],
        borderInner: [248, 220, 156],
        borderThickness: 2,
        cornerRadius: 6,
        alpha: 248
      })
    },
    {
      id: 'atlas_kit_bar',
      name: '容量进度条槽位', // cjk-ok
      exportName: 'Bar_Capacity_Progress_9S',
      kind: 'bar',
      width: 200,
      height: 28,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [6, 14, 6, 14],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 200,
        height: 28,
        fillTop: [46, 134, 212],
        fillBottom: [28, 92, 168],
        borderOuter: [96, 178, 245],
        borderInner: [168, 224, 255],
        borderThickness: 2,
        cornerRadius: 4,
        alpha: 245
      })
    },
    {
      id: 'atlas_kit_tab_active',
      name: '导航页签_选中态', // cjk-ok
      exportName: 'Tab_Nav_Active_9S',
      kind: 'tab',
      width: 140,
      height: 56,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [10, 16, 10, 16],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 140,
        height: 56,
        fillTop: isSciFi ? [52, 118, 196] : [168, 126, 58],
        fillBottom: isSciFi ? [32, 82, 148] : [118, 84, 34],
        borderOuter: [248, 214, 136],
        borderInner: [255, 240, 190],
        borderThickness: 2,
        cornerRadius: 5,
        alpha: 250
      })
    },
    {
      id: 'atlas_kit_tab_normal',
      name: '导航页签_常态', // cjk-ok
      exportName: 'Tab_Nav_Normal_9S',
      kind: 'tab',
      width: 140,
      height: 56,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [10, 16, 10, 16],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 140,
        height: 56,
        fillTop: [38, 44, 60],
        fillBottom: [26, 30, 44],
        borderOuter: [82, 96, 124],
        borderInner: [120, 138, 172],
        borderThickness: 2,
        cornerRadius: 5,
        alpha: 235
      })
    },
    {
      id: 'atlas_kit_slot',
      name: '方形道具格槽位', // cjk-ok
      exportName: 'Slot_Item_Grid_9S',
      kind: 'item-slot',
      width: 96,
      height: 96,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [12, 12, 12, 12],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 96,
        height: 96,
        fillTop: [24, 30, 44],
        fillBottom: [16, 20, 30],
        borderOuter: [92, 112, 148],
        borderInner: [148, 172, 212],
        cornerAccent: [212, 184, 118],
        borderThickness: 2,
        cornerRadius: 6,
        alpha: 240
      })
    },
    {
      id: 'atlas_kit_btn_primary',
      name: '操作按钮_主按钮', // cjk-ok
      exportName: 'Btn_Primary_Action_9S',
      kind: 'button',
      width: 160,
      height: 54,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [10, 18, 10, 18],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 160,
        height: 54,
        fillTop: [216, 164, 68],
        fillBottom: [164, 112, 34],
        borderOuter: [252, 224, 148],
        borderInner: [255, 244, 204],
        borderThickness: 2,
        cornerRadius: 6,
        alpha: 252
      })
    },
    {
      id: 'atlas_kit_btn_secondary',
      name: '操作按钮_次按钮', // cjk-ok
      exportName: 'Btn_Secondary_Action_9S',
      kind: 'button',
      width: 160,
      height: 54,
      scalePolicy: 'nine-slice',
      nineSliceBorders: [10, 18, 10, 18],
      rgba: renderProceduralNineSliceComponentRgba({
        width: 160,
        height: 54,
        fillTop: [54, 88, 138],
        fillBottom: [34, 58, 98],
        borderOuter: [108, 158, 224],
        borderInner: [168, 208, 252],
        borderThickness: 2,
        cornerRadius: 6,
        alpha: 248
      })
    },
    {
      id: 'atlas_kit_icon_item',
      name: '道具与资源图标', // cjk-ok
      exportName: 'Icon_Item_Crystal',
      kind: 'icon',
      width: 64,
      height: 64,
      scalePolicy: 'uniform',
      rgba: renderProceduralNineSliceComponentRgba({
        width: 64,
        height: 64,
        fillTop: [88, 196, 255],
        fillBottom: [38, 118, 212],
        borderOuter: [212, 244, 255],
        borderInner: [255, 255, 255],
        borderThickness: 2,
        cornerRadius: 12,
        alpha: 248
      })
    }
  ]

  return specs.map((s) => ({
    item: {
      id: s.id,
      psdGuid: componentIdToPsdGuid(s.id),
      name: s.name,
      exportName: s.exportName,
      kind: s.kind,
      canonicalWidth: s.width,
      canonicalHeight: s.height,
      scalePolicy: s.scalePolicy,
      ...(s.nineSliceBorders ? { nineSliceBorders: s.nineSliceBorders } : {}),
      sourceCount: 1,
      descriptor: computeComponentVisualDescriptor(s.rgba)
    },
    rgba: s.rgba
  }))
}

/**
 * Renders a subtle visual preview bitmap for an editable text layer (`TySh`),
 * ensuring the text layer is visible on the 2D/3D stage and satisfies `layerSplitToPsdUint8Array`
 * while carrying native `editableText` metadata for Photoshop.
 */
export function renderTextLayerPreviewRgba(
  width: number,
  height: number,
  meta: UiEditableTextMeta
): RgbaImage {
  const w = Math.max(16, Math.round(width))
  const h = Math.max(16, Math.round(height))
  const img = createImage(w, h)
  const [r, g, b] = meta.color ?? [248, 236, 200]
  const [sr, sg, sb] = meta.strokeColor ?? [24, 20, 16]
  const textLen = Math.max(1, [...(meta.text?.trim() || 'UI')].length)
  const charW = Math.max(8, Math.min(Math.floor(w / textLen), Math.round(h * 0.68)))
  const charH = Math.max(10, Math.round(h * 0.62))
  const totalW = Math.min(w - 4, textLen * charW)
  const startX =
    meta.align === 'right'
      ? Math.max(2, w - totalW - 2)
      : meta.align === 'left'
        ? 2
        : Math.max(2, Math.round((w - totalW) * 0.5))
  const startY = Math.max(2, Math.round((h - charH) * 0.5))

  for (let c = 0; c < textLen; c++) {
    const cx0 = startX + c * charW + 2
    const cx1 = Math.min(w - 2, cx0 + Math.max(4, charW - 4))
    const cy0 = startY
    const cy1 = Math.min(h - 2, startY + charH)
    for (let y = cy0; y < cy1; y++) {
      for (let x = cx0; x < cx1; x++) {
        const isBorder = x === cx0 || x === cx1 - 1 || y === cy0 || y === cy1 - 1
        const isBar =
          y === cy0 + 2 ||
          y === Math.round((cy0 + cy1) * 0.5) ||
          y === cy1 - 3 ||
          x === cx0 + 2 ||
          x === cx1 - 3
        if (!isBorder && !isBar) continue
        const idx = (y * w + x) * 4
        img.data[idx] = isBorder ? sr : r
        img.data[idx + 1] = isBorder ? sg : g
        img.data[idx + 2] = isBorder ? sb : b
        img.data[idx + 3] = isBorder ? 210 : 245
      }
    }
  }
  return img
}

/**
 * Deterministic Game UI layout solver:
 * Organizes available atlas components into a complete, layered game UI screen
 * (Main Panel Frame, Header Bar, Tabs, Grid of Item Slots + Icons, Action Buttons, and Editable Texts)
 * whenever no LLM is configured or as a fallback.
 */
export function solveUiAtlasLayoutDeterministic(
  candidates: readonly PreciseSplitComponentCandidate[],
  userPrompt: string,
  canvasWidth = 1920,
  canvasHeight = 1080,
  locale?: string
): UiAtlasLayoutPlan {
  const isZh = !locale || locale.toLowerCase().startsWith('zh')
  const items = candidates.map((c) => c.item)

  const panels = items.filter((it) => it.kind === 'panel' || it.kind === 'frame')
  const banners = items.filter((it) => it.kind === 'banner' || it.kind === 'bar')
  const tabs = items.filter((it) => it.kind === 'tab')
  const slots = items.filter((it) => it.kind === 'item-slot' || it.kind === 'card')
  const buttons = items.filter((it) => it.kind === 'button' || it.kind === 'close-button')
  const icons = items.filter((it) => it.kind === 'icon' || it.kind === 'badge')
  const others = items.filter(
    (it) =>
      !panels.includes(it) &&
      !banners.includes(it) &&
      !tabs.includes(it) &&
      !slots.includes(it) &&
      !buttons.includes(it) &&
      !icons.includes(it)
  )

  // Fallbacks so every category has a reasonable candidate if the atlas is small
  const mainPanel =
    panels[0] ??
    [...items].sort(
      (a, b) => b.canonicalWidth * b.canonicalHeight - a.canonicalWidth * a.canonicalHeight
    )[0]
  const headerBar = banners[0] ?? panels[1]
  const slotComp = slots[0] ?? panels[1] ?? others[0] ?? mainPanel
  const btnComp = buttons[0] ?? tabs[0] ?? others[0] ?? mainPanel
  const tabComp = tabs[0] ?? buttons[1] ?? buttons[0]

  const groups = [
    { id: 'grp_panel', name: isZh ? '01_面板与容器底框' : '01_Panels_Containers' }, // cjk-ok
    { id: 'grp_header', name: isZh ? '02_顶栏与页签导航' : '02_Header_Tabs' }, // cjk-ok
    { id: 'grp_slots', name: isZh ? '03_内容槽位与图标' : '03_Content_Slots' }, // cjk-ok
    { id: 'grp_buttons', name: isZh ? '04_交互按钮与控件' : '04_Buttons_Controls' }, // cjk-ok
    { id: 'grp_texts', name: isZh ? '05_可编辑文字层' : '05_Editable_Texts' } // cjk-ok
  ]

  const placements: UiAtlasPlacementSpec[] = []
  let z = 1

  const panelW = Math.round(canvasWidth * 0.78)
  const panelH = Math.round(canvasHeight * 0.8)
  const panelLeft = Math.round((canvasWidth - panelW) * 0.5)
  const panelTop = Math.round((canvasHeight - panelH) * 0.52)

  if (mainPanel) {
    placements.push({
      name: isZh ? '主界面底框面板' : 'Main_Panel_Frame', // cjk-ok
      exportName: 'Panel_Main_Frame',
      componentId: mainPanel.id,
      groupId: 'grp_panel',
      left: panelLeft,
      top: panelTop,
      width: panelW,
      height: panelH,
      zIndex: z++
    })
  }

  // Top Header Banner
  const headerW = Math.round(panelW * 0.52)
  const headerH = Math.max(56, Math.round(canvasHeight * 0.075))
  const headerLeft = Math.round((canvasWidth - headerW) * 0.5)
  const headerTop = Math.max(24, panelTop - Math.round(headerH * 0.35))
  if (headerBar) {
    placements.push({
      name: isZh ? '顶部标题横幅' : 'Header_Title_Banner', // cjk-ok
      exportName: 'Header_Title_Banner',
      componentId: headerBar.id,
      groupId: 'grp_header',
      left: headerLeft,
      top: headerTop,
      width: headerW,
      height: headerH,
      zIndex: z++
    })
  }

  // Title Editable Text
  const quotedTitleMatch = /标题[「“"']([^」”"'\n]{1,16})[」”"']/i.exec(userPrompt) // cjk-ok
  const titleRe = /(?:《([^》]+)》|([^\n，。；：:]{2,12}(?:界面|系统|背包|商城|面板|弹窗)))/ // cjk-ok
  const titleMatch = titleRe.exec(userPrompt)
  const screenTitle =
    quotedTitleMatch?.[1]?.trim() ||
    titleMatch?.[1]?.trim() ||
    titleMatch?.[2]?.trim() ||
    (isZh ? '角色背包与装备系统' : 'Inventory & Equipment') // cjk-ok
  placements.push({
    name: isZh ? `标题文字_${screenTitle}` : `Txt_Title`, // cjk-ok
    exportName: 'Txt_Header_Title',
    groupId: 'grp_texts',
    left: headerLeft + Math.round(headerW * 0.15),
    top: headerTop + Math.round(headerH * 0.18),
    width: Math.round(headerW * 0.7),
    height: Math.round(headerH * 0.64),
    zIndex: z + 40,
    editableText: {
      text: screenTitle,
      fontSize: Math.max(22, Math.round(headerH * 0.46)),
      color: [255, 242, 204],
      strokeColor: [36, 24, 14],
      strokeWidth: 2,
      align: 'center'
    }
  })

  // Optional Capacity / Progress Bar Row (e.g. "1832 / 2000")
  const capacityTextMatch = /(\d+\s*\/\s*\d+)/.exec(userPrompt)
  const barComp = items.find((it) => it.kind === 'bar') ?? banners[1]
  if (capacityTextMatch && barComp) {
    const capBarW = Math.round(panelW * 0.36)
    const capBarH = Math.max(24, Math.round(canvasHeight * 0.028))
    const capBarLeft = panelLeft + Math.round(panelW * 0.28)
    const capBarTop = panelTop + Math.round(panelH * 0.065)
    placements.push({
      name: isZh ? '容量进度条' : 'Bar_Capacity', // cjk-ok
      exportName: 'Bar_Capacity_Progress',
      componentId: barComp.id,
      groupId: 'grp_header',
      left: capBarLeft,
      top: capBarTop,
      width: capBarW,
      height: capBarH,
      zIndex: z++
    })
    placements.push({
      name: isZh ? `容量数值_${capacityTextMatch[1]}` : 'Txt_Capacity', // cjk-ok
      exportName: 'Txt_Capacity_Value',
      groupId: 'grp_texts',
      left: Math.max(24, capBarLeft - 170),
      top: capBarTop - 2,
      width: 156,
      height: capBarH + 6,
      zIndex: z + 42,
      editableText: {
        text: capacityTextMatch[1]!.trim(),
        fontSize: Math.max(16, Math.round(capBarH * 0.72)),
        color: [226, 238, 255],
        strokeColor: [18, 24, 36],
        strokeWidth: 2,
        align: 'right'
      }
    })
  }

  // Side Tabs
  if (tabComp) {
    const parsedTabMatch = /页签(?:按钮)?[：:]\s*([^\n。；]+)/.exec(userPrompt) // cjk-ok
    const parsedTabs = parsedTabMatch?.[1]
      ? parsedTabMatch[1]
          .split(/[、，,/\s]+/)
          .map((s) => s.replace(/^[「“"']|[」”"']$/g, '').trim())
          .filter((s) => s.length >= 1 && s.length <= 8)
          .slice(0, 6)
      : []
    const tabLabels =
      parsedTabs.length >= 2
        ? parsedTabs
        : isZh
          ? ['全部', '武器', '防具', '材料'] // cjk-ok
          : ['All', 'Weapons', 'Armor', 'Items']
    const tabW = Math.max(110, Math.round(canvasWidth * 0.075))
    const tabH = Math.max(52, Math.round(canvasHeight * 0.062))
    const tabLeft = Math.max(24, panelLeft + Math.round(panelW * 0.035))
    const tabStartTop = panelTop + Math.round(panelH * 0.14)
    for (let i = 0; i < tabLabels.length; i++) {
      const top = tabStartTop + i * (tabH + 16)
      const chosenTabComp = i === 0 ? (tabs[0] ?? tabComp) : (tabs[1] ?? tabs[0] ?? tabComp)
      placements.push({
        name: isZh ? `分类页签_${tabLabels[i]}` : `Tab_Category_${i + 1}`, // cjk-ok
        exportName: `Tab_Category_0${i + 1}`,
        componentId: chosenTabComp.id,
        groupId: 'grp_header',
        left: tabLeft,
        top,
        width: tabW,
        height: tabH,
        zIndex: z++
      })
      placements.push({
        name: isZh ? `页签文字_${tabLabels[i]}` : `Txt_Tab_${i + 1}`, // cjk-ok
        exportName: `Txt_Tab_0${i + 1}`,
        groupId: 'grp_texts',
        left: tabLeft + 10,
        top: top + Math.round(tabH * 0.22),
        width: tabW - 20,
        height: Math.round(tabH * 0.56),
        zIndex: z + 40,
        editableText: {
          text: tabLabels[i]!,
          fontSize: Math.max(16, Math.round(tabH * 0.38)),
          color: i === 0 ? [255, 236, 179] : [210, 216, 230],
          strokeColor: [24, 20, 16],
          strokeWidth: 2,
          align: 'center'
        }
      })
    }
  }

  // Item Slot Grid (supports prompt column count e.g. "六列" -> 6 cols)
  if (slotComp) {
    const colWordMatch = /([三四五六七八3-8])\s*列/.exec(userPrompt) // cjk-ok
    const colMap: Record<string, number> = {
      三: 3, // cjk-ok
      四: 4, // cjk-ok
      五: 5, // cjk-ok
      六: 6, // cjk-ok
      七: 7, // cjk-ok
      八: 8 // cjk-ok
    }
    const cols = colWordMatch?.[1]
      ? (colMap[colWordMatch[1]] ?? (Number.parseInt(colWordMatch[1], 10) || 4))
      : 4
    const rows = 3
    const gridLeft = panelLeft + Math.round(panelW * (tabComp ? 0.17 : 0.08))
    const gridTop = panelTop + Math.round(panelH * 0.14)
    const availW = Math.round(panelW * (tabComp ? 0.76 : 0.84))
    const availH = Math.round(panelH * 0.62)
    const gap = 16
    const cellSize = Math.max(
      64,
      Math.min(
        Math.floor((availW - gap * (cols - 1)) / cols),
        Math.floor((availH - gap * (rows - 1)) / rows),
        148
      )
    )
    const gridTotalW = cols * cellSize + (cols - 1) * gap
    const startX = gridLeft + Math.max(0, Math.round((availW - gridTotalW) * 0.5))

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c
        const x = startX + c * (cellSize + gap)
        const y = gridTop + r * (cellSize + gap)
        const chosenSlot = slots.length > 0 ? slots[idx % slots.length]! : slotComp
        placements.push({
          name: isZh ? `道具槽位_${String(idx + 1).padStart(2, '0')}` : `Item_Slot_${idx + 1}`, // cjk-ok
          exportName: `Slot_Item_${String(idx + 1).padStart(2, '0')}`,
          componentId: chosenSlot.id,
          groupId: 'grp_slots',
          left: x,
          top: y,
          width: cellSize,
          height: cellSize,
          zIndex: z++
        })
        if (icons.length > 0 && idx < Math.min(cols * rows, Math.max(6, icons.length * 3))) {
          const iconComp = icons[idx % icons.length]!
          const pad = Math.round(cellSize * 0.16)
          placements.push({
            name: `${iconComp.name}_${String(idx + 1).padStart(2, '0')}`,
            exportName: `Icon_Item_${String(idx + 1).padStart(2, '0')}`,
            componentId: iconComp.id,
            groupId: 'grp_slots',
            left: x + pad,
            top: y + pad,
            width: Math.max(24, cellSize - pad * 2),
            height: Math.max(24, cellSize - pad * 2),
            zIndex: z++
          })
        }
      }
    }
  }

  // Bottom Action Buttons
  if (btnComp) {
    const extractedBtns: string[] = []
    const btnRegex = /「([^」\n]{2,6})」/g
    let m: RegExpExecArray | null
    while ((m = btnRegex.exec(userPrompt)) !== null) {
      const candidate = m[1]!.trim()
      if (
        candidate !== screenTitle &&
        !/^\d/.test(candidate) &&
        !extractedBtns.includes(candidate)
      ) {
        extractedBtns.push(candidate)
      }
    }
    const btnLabels =
      extractedBtns.length >= 2
        ? extractedBtns.slice(0, 4)
        : isZh
          ? ['一键整理', '强化升阶'] // cjk-ok
          : ['Sort All', 'Upgrade']
    const btnW = Math.max(152, Math.round(canvasWidth * 0.11))
    const btnH = Math.max(54, Math.round(canvasHeight * 0.064))
    const btnGap = 28
    const totalBtnW = btnLabels.length * btnW + (btnLabels.length - 1) * btnGap
    const btnStartX = Math.round((canvasWidth - totalBtnW) * 0.5)
    const btnTop = panelTop + panelH - btnH - Math.round(panelH * 0.055)
    for (let i = 0; i < btnLabels.length; i++) {
      const chosenBtn = buttons.length > 0 ? buttons[i % buttons.length]! : btnComp
      const left = btnStartX + i * (btnW + btnGap)
      placements.push({
        name: isZh ? `按钮_${btnLabels[i]}` : `Btn_${i + 1}`, // cjk-ok
        exportName: `Btn_Action_0${i + 1}`,
        componentId: chosenBtn.id,
        groupId: 'grp_buttons',
        left,
        top: btnTop,
        width: btnW,
        height: btnH,
        zIndex: z++
      })
      placements.push({
        name: isZh ? `按钮文字_${btnLabels[i]}` : `Txt_Btn_${i + 1}`, // cjk-ok
        exportName: `Txt_Btn_0${i + 1}`,
        groupId: 'grp_texts',
        left: left + 14,
        top: btnTop + Math.round(btnH * 0.22),
        width: btnW - 28,
        height: Math.round(btnH * 0.56),
        zIndex: z + 45,
        editableText: {
          text: btnLabels[i]!,
          fontSize: Math.max(18, Math.round(btnH * 0.42)),
          color: [255, 245, 214],
          strokeColor: [32, 20, 12],
          strokeWidth: 2,
          align: 'center'
        }
      })
    }
  }

  return {
    canvasWidth,
    canvasHeight,
    baseColor: [20, 24, 36],
    groups,
    placements
  }
}

function buildAtlasComposeSystemPrompt(): string {
  return [
    'You are a Principal Game UI Technical Artist and PSD Layout Engine.',
    'Given a catalog of Sprite Atlas UI components (`id`, `name`, `kind`, `width`, `height`, `scalePolicy`) and a user UI requirement/GDD,',
    'assemble a complete, well-proportioned, multi-layer Game UI screen layout where every element is placed on its own layer.',
    'Return ONLY a valid JSON object matching this schema (no markdown commentary outside JSON):',
    '{',
    '  "canvasWidth": 1920,',
    '  "canvasHeight": 1080,',
    '  "baseColor": [20, 24, 36],',
    '  "groups": [',
    '    { "id": "grp_panel", "name": "01_面板与容器底框" },', // cjk-ok
    '    { "id": "grp_header", "name": "02_顶栏与页签导航" },', // cjk-ok
    '    { "id": "grp_slots", "name": "03_内容槽位与图标" },', // cjk-ok
    '    { "id": "grp_buttons", "name": "04_交互按钮与控件" },', // cjk-ok
    '    { "id": "grp_texts", "name": "05_可编辑文字层" }', // cjk-ok
    '  ],',
    '  "placements": [',
    '    {',
    '      "name": "主界面底框",', // cjk-ok
    '      "exportName": "Panel_Main_Frame",',
    '      "componentId": "comp_01",',
    '      "groupId": "grp_panel",',
    '      "left": 210, "top": 108, "width": 1500, "height": 864, "zIndex": 1',
    '    },',
    '    {',
    '      "name": "标题文字_背包系统",', // cjk-ok
    '      "exportName": "Txt_Header_Title",',
    '      "groupId": "grp_texts",',
    '      "left": 760, "top": 96, "width": 400, "height": 48, "zIndex": 50,',
    '      "editableText": { "text": "背包系统", "fontSize": 30, "color": [255, 242, 204], "strokeColor": [36, 24, 14], "strokeWidth": 2, "align": "center" }', // cjk-ok
    '    }',
    '  ]',
    '}',
    'Rules:',
    '1. Every visual widget placement MUST reference a valid `componentId` from the provided catalog.',
    '2. Components with `scalePolicy: "nine-slice"` can be stretched to larger containers/panels/bars/buttons while keeping crisp corners.',
    '3. Order `zIndex` from back to front: main panels (1..5) -> headers/sub-panels (6..15) -> tabs/slots (16..40) -> icons/badges (41..60) -> buttons (61..80) -> editable text layers (81..120).',
    '4. For titles, tab labels, item counts, and button captions, emit separate text layers with `editableText` (`componentId` omitted) placed accurately over their parent control.'
  ].join('\n')
}

export function parseAiAtlasLayoutPlan(
  rawText: string,
  validComponentIds: ReadonlySet<string>,
  defaultWidth = 1920,
  defaultHeight = 1080
): UiAtlasLayoutPlan | null {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null
  try {
    const parsed = JSON.parse(
      cleaned.slice(firstBrace, lastBrace + 1)
    ) as Partial<UiAtlasLayoutPlan>
    if (!parsed || !Array.isArray(parsed.placements) || !parsed.placements.length) return null
    const cw = clampInt(parsed.canvasWidth, defaultWidth, 320, 4096)
    const ch = clampInt(parsed.canvasHeight, defaultHeight, 320, 4096)
    const placements: UiAtlasPlacementSpec[] = []
    for (let i = 0; i < parsed.placements.length; i++) {
      const p = parsed.placements[i]
      if (!p || typeof p !== 'object') continue
      const compId = typeof p.componentId === 'string' ? p.componentId.trim() : ''
      const hasValidComp = Boolean(compId && validComponentIds.has(compId))
      const hasText = Boolean(
        p.editableText && typeof p.editableText.text === 'string' && p.editableText.text.trim()
      )
      if (!hasValidComp && !hasText) continue
      const width = clampInt(p.width, 120, 12, cw)
      const height = clampInt(p.height, 60, 12, ch)
      const left = clampInt(p.left, 0, 0, Math.max(0, cw - 8))
      const top = clampInt(p.top, 0, 0, Math.max(0, ch - 8))
      placements.push({
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Layer_${i + 1}`,
        ...(typeof p.exportName === 'string' && p.exportName.trim()
          ? { exportName: sanitizeComponentExportName(p.exportName, i + 1) }
          : {}),
        ...(hasValidComp ? { componentId: compId } : {}),
        ...(typeof p.groupId === 'string' && p.groupId.trim() ? { groupId: p.groupId.trim() } : {}),
        left,
        top,
        width: Math.min(width, cw - left),
        height: Math.min(height, ch - top),
        zIndex: clampInt(p.zIndex, i + 1, 1, 2048),
        ...(hasText ? { editableText: p.editableText } : {})
      })
    }
    if (!placements.length) return null
    return {
      canvasWidth: cw,
      canvasHeight: ch,
      ...(Array.isArray(parsed.baseColor) && parsed.baseColor.length >= 3
        ? {
            baseColor: [
              clampInt(parsed.baseColor[0], 20, 0, 255),
              clampInt(parsed.baseColor[1], 24, 0, 255),
              clampInt(parsed.baseColor[2], 36, 0, 255)
            ]
          }
        : {}),
      ...(Array.isArray(parsed.groups) ? { groups: parsed.groups } : {}),
      placements
    }
  } catch {
    return null
  }
}

const UI_ATLAS_RESOURCE_KEYWORD_RE =
  /ui|图集|图标|组件|切片|按钮|边框|底板|面板|槽位|背包|技能|装备|界面|控件|九宫格|atlas|sprite|icon|button|panel|frame|slot|hud|widget|banner|tab/i // cjk-ok

export interface ProjectUiAtlasDiscoveryInput {
  graphs?: ReadonlyArray<import('../types').GraphDocument | null | undefined>
  assets?: ReadonlyArray<{
    id: string
    type: string
    name: string
    relativePath?: string
    folderId?: string | null
    prompt?: string
    genParams?: Record<string, unknown>
  }>
  folders?: ReadonlyArray<{ id: string; name: string; parentId?: string | null }>
  excludeNodeId?: string
}

export interface ChatProjectDirectoryRef {
  name: string
  rootPath: string
}

export interface ResolveChatUiAtlasSearchDirsInput {
  /**
   * 当前 AI 对话选中的子工程（如 `Client_Harmmy`）；
   * 若当前处于全局工作空间中的会话（`Conversations` 区），则为 `null` 或 `undefined`。
   */
  activeProject?: ChatProjectDirectoryRef | null
  /** 工作空间中挂载的全部项目列表（用于识别用户指令中是否指定了其它项目） */
  allProjects?: ReadonlyArray<ChatProjectDirectoryRef>
  /** 全局工作空间根目录（用于定位 `<workspaceRoot>/Cache`） */
  workspaceRootPath?: string | null
  /** 用户提示词或生成指令文本 */
  prompt?: string
}

/**
 * 解析图集拼装 UI（`ui.atlasCompose`）的磁盘搜索目录优先级：
 * 1. 当在具体项目会话（如 `Client_Harmmy`）中要求拼装 UI 时，默认从当前项目（`Client_Harmmy`）目录中查找对应图片；
 * 2. 若用户在指令中还指定了其它项目名称，则除当前项目外，同步去指定的其它项目目录中查找；
 * 3. 若在全局工作空间中的会话（`activeProject == null`）中，则默认去 `<workspaceRoot>/Cache` 目录中查找（若同时指定了其它项目则一并查找）。
 */
export function resolveChatUiAtlasSearchDirs(input: ResolveChatUiAtlasSearchDirsInput): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const normKey = (p: string): string =>
    p.replace(/\\/g, '/').replace(/\/+$/, '').trim().toLowerCase()
  const pushDir = (raw?: string | null): void => {
    const cleaned = (raw ?? '').trim()
    if (!cleaned) return
    const key = normKey(cleaned)
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push(cleaned)
  }

  const promptLower = (input.prompt ?? '').toLowerCase()
  const activeRootKey = input.activeProject?.rootPath ? normKey(input.activeProject.rootPath) : ''

  // Detect any other projects explicitly mentioned in the prompt
  const mentionedOtherProjects: string[] = []
  if (promptLower && Array.isArray(input.allProjects)) {
    for (const proj of input.allProjects) {
      if (!proj?.rootPath?.trim()) continue
      const pKey = normKey(proj.rootPath)
      if (pKey === activeRootKey) continue
      const nameCandidate = (proj.name ?? '').trim().toLowerCase()
      const folderName =
        proj.rootPath
          .replace(/\\/g, '/')
          .replace(/\/+$/, '')
          .split('/')
          .pop()
          ?.trim()
          .toLowerCase() ?? ''
      const matchedName = nameCandidate.length >= 2 && promptLower.includes(nameCandidate)
      const matchedFolder = folderName.length >= 2 && promptLower.includes(folderName)
      if (matchedName || matchedFolder) {
        mentionedOtherProjects.push(proj.rootPath.trim())
      }
    }
  }

  if (input.activeProject?.rootPath?.trim()) {
    // Project session (e.g. Client_Harmmy): search current project first, plus any specified other projects
    pushDir(input.activeProject.rootPath)
    for (const otherDir of mentionedOtherProjects) {
      pushDir(otherDir)
    }
    return result
  }

  // Global Workspace session: search any specified projects + <workspaceRoot>/Cache
  for (const otherDir of mentionedOtherProjects) {
    pushDir(otherDir)
  }
  const wsRoot = (input.workspaceRootPath ?? '').replace(/[\\/]+$/, '').trim()
  if (wsRoot) {
    const sep = wsRoot.includes('\\') ? '\\' : '/'
    pushDir(`${wsRoot}${sep}Cache`)
  }
  return result
}

/**
 * Automatically discovers existing UI Atlas / Component Library / Icon Pack / UI Image resources
 * across the project's graphs and asset library (`project.assets`).
 */
export function collectProjectUiAtlasResources(input: ProjectUiAtlasDiscoveryInput): {
  componentLibraries: UiComponentLibrary[]
  images: GraphImageItem[]
} {
  const componentLibraries: UiComponentLibrary[] = []
  const priorityImages: GraphImageItem[] = []
  const fallbackImages: GraphImageItem[] = []
  const seenImgKeys = new Set<string>()

  const pushImg = (target: GraphImageItem[], item: GraphImageItem): void => {
    const key = item.relativePath?.trim() || item.dataUrl?.trim() || ''
    if (!key || seenImgKeys.has(key)) return
    seenImgKeys.add(key)
    target.push(item)
  }

  const folderMap = new Map<string, { name: string; parentId?: string | null }>()
  for (const f of input.folders ?? []) {
    if (f?.id) folderMap.set(f.id, f)
  }
  const getFolderChainName = (folderId?: string | null): string => {
    const parts: string[] = []
    let cur = folderId?.trim() || ''
    let guard = 0
    while (cur && guard++ < 12) {
      const f = folderMap.get(cur)
      if (!f) break
      parts.push(f.name)
      cur = f.parentId?.trim() || ''
    }
    return parts.join('/')
  }

  const allGraphs: Array<import('../types').GraphDocument> = []
  const seenGraphRefs = new Set<object>()
  for (const g of input.graphs ?? []) {
    if (g && Array.isArray(g.nodes) && !seenGraphRefs.has(g)) {
      seenGraphRefs.add(g)
      allGraphs.push(g)
    }
  }
  for (const a of input.assets ?? []) {
    const g = a?.genParams?.graphJson as import('../types').GraphDocument | undefined
    if (g && typeof g === 'object' && Array.isArray(g.nodes) && !seenGraphRefs.has(g)) {
      seenGraphRefs.add(g)
      allGraphs.push(g)
    }
  }

  for (const g of allGraphs) {
    for (const node of g.nodes ?? []) {
      if (!node || node.id === input.excludeNodeId) continue
      const parsedLib = parseUiComponentLibrary(node.params?.uiComponentLibrary ?? '')
      if (parsedLib && parsedLib.items.length > 0) {
        componentLibraries.push(parsedLib)
      }
      if (node.typeId === 'image.layerSplit' || node.typeId === 'ui.atlasCompose') {
        const splitState = readImageLayerSplitFromNode(node.params)
        if (splitState.componentLibrary && splitState.componentLibrary.length > 0) {
          componentLibraries.push({
            schema: 'aiart.ui-component-library@1',
            items: splitState.componentLibrary
          })
        }
      }
      if (node.typeId === 'ui.componentLib' || node.typeId === 'image.iconPack') {
        for (const gen of node.params?.generatedImages ?? []) {
          if (gen?.relativePath?.trim() || gen?.dataUrl?.trim()) {
            pushImg(priorityImages, {
              id: gen.id || `${node.id}:img`,
              title: gen.title || node.title || node.typeId,
              dataUrl: gen.dataUrl ?? '',
              ...(gen.relativePath ? { relativePath: gen.relativePath } : {})
            })
          }
        }
      } else if (node.typeId === 'image.plain' || node.typeId === 'asset.image') {
        const haystack = `${node.title ?? ''} ${node.params?.generateInstruction ?? ''}`
        const isUiRelated = UI_ATLAS_RESOURCE_KEYWORD_RE.test(haystack)
        const targetArr = isUiRelated
          ? priorityImages
          : node.typeId === 'image.plain'
            ? fallbackImages
            : null
        if (!targetArr) continue
        for (const gen of node.params?.generatedImages ?? []) {
          if (gen?.relativePath?.trim() || gen?.dataUrl?.trim()) {
            pushImg(targetArr, {
              id: gen.id || `${node.id}:img`,
              title: gen.title || node.title || 'Atlas',
              dataUrl: gen.dataUrl ?? '',
              ...(gen.relativePath ? { relativePath: gen.relativePath } : {})
            })
          }
        }
        const directRel = node.params?.previewRelativePath?.trim() || ''
        const directUrl = node.params?.previewDataUrl?.trim() || ''
        if (directRel || directUrl) {
          pushImg(targetArr, {
            id: `${node.id}:direct`,
            title: node.title || 'Atlas',
            dataUrl: directUrl,
            ...(directRel ? { relativePath: directRel } : {})
          })
        }
      }
    }
  }

  for (const asset of input.assets ?? []) {
    if (!asset || asset.type !== 'image') continue
    const rel = asset.relativePath?.trim() || ''
    if (!rel) continue
    const folderChain = getFolderChainName(asset.folderId)
    const haystack = `${asset.name} ${asset.prompt ?? ''} ${rel} ${folderChain}`
    if (UI_ATLAS_RESOURCE_KEYWORD_RE.test(haystack)) {
      pushImg(priorityImages, {
        id: asset.id,
        title: asset.name || 'UI_Atlas',
        dataUrl: '',
        relativePath: rel
      })
    } else if (asset.genParams?.mediaRole === 'reference') {
      pushImg(fallbackImages, {
        id: asset.id,
        title: asset.name || 'Ref_Image',
        dataUrl: '',
        relativePath: rel
      })
    }
  }

  return {
    componentLibraries,
    images: priorityImages.length > 0 ? priorityImages.slice(0, 12) : fallbackImages.slice(0, 6)
  }
}

async function resolveSafeAtlasImageUrl(
  ctx: NodeExecuteContext,
  item: { relativePath?: string; dataUrl?: string },
  stamp: number,
  suffix: string
): Promise<string | undefined> {
  const rel = item.relativePath?.trim()
  if (rel && ctx.resolveImageUrls) {
    const resolved = await ctx.resolveImageUrls([{ relativePath: rel }])
    const u = resolved[0]?.trim()
    if (u && isCanvasSafeImageSrc(u)) return u
  }
  const url = item.dataUrl?.trim() || ''
  if (url && isCanvasSafeImageSrc(url)) return url
  if (url && ctx.saveRunMedia && ctx.resolveImageUrls) {
    try {
      const [mat] = await materializeGeneratedBatch(
        ctx,
        [{ id: `atlasIn:${ctx.node.id}:${stamp}:${suffix}`, dataUrl: url }],
        `atlasIn:${ctx.node.id}:${stamp}:${suffix}`
      )
      if (mat?.relativePath) {
        const resolved = await ctx.resolveImageUrls([{ relativePath: mat.relativePath }])
        const u = resolved[0]?.trim()
        if (u && isCanvasSafeImageSrc(u)) return u
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Executes `ui.atlasCompose` (`图集拼装 UI`):
 * 1. Collects UI components from `in-components` (`ui.componentLib`) and/or slices sprite sheets from `in` / `in-images`.
 * 2. Solves the layered UI layout using AI (`ctx.generateText`) or deterministic Game UI layout templates.
 * 3. Renders all placed components with lossless 9-slice / bilinear scaling onto separate layers,
 *    embeds Smart Object GUIDs + native Photoshop `TySh` editable text layers, and writes both
 *    the composite preview image (`out`) and layered `.psd` file (`out-psd` / `params.layerSplitPsdRelativePath`).
 */
export async function executeUiAtlasComposeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.uiRgbaCodec) {
    throw fail(SHARED_ERRORS.layerSplitPreciseFailed, { detail: 'no RGBA codec' })
  }
  const codec = ctx.uiRgbaCodec
  const stamp = Date.now()
  const prev = readImageLayerSplitFromNode(ctx.node.params)

  // 1) Collect upstream component library candidates
  const { candidates: compCandidates } = await resolveUpstreamComponentCandidates(ctx, stamp)
  const allCandidates: PreciseSplitComponentCandidate[] = [...compCandidates]

  // Also check local stored componentLibrary if no upstream `in-components`
  if (!allCandidates.length) {
    const localLib =
      parseUiComponentLibrary(ctx.node.params.uiComponentLibrary ?? '') ??
      (prev.componentLibrary?.length
        ? { schema: 'aiart.ui-component-library@1' as const, items: prev.componentLibrary }
        : emptyUiComponentLibrary())
    for (let i = 0; i < localLib.items.length; i++) {
      const item = localLib.items[i]!
      const safeUrl = await resolveSafeAtlasImageUrl(
        ctx,
        { relativePath: item.imageRelativePath, dataUrl: item.imageUrl },
        stamp,
        `localComp${i}`
      )
      if (!safeUrl) continue
      try {
        const rgba = await codec.decodeImageRgba(safeUrl)
        if (rgba.width > 0 && rgba.height > 0) {
          allCandidates.push({ item, rgba })
        }
      } catch {
        // Ignore unreadable local component
      }
    }
  }

  // 2) Collect raw atlas / slice images from `in`, `in-image`, `in-images`, `in-style`
  const imagePortValues: GraphValue[] = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? []),
    ...(ctx.inputs['in-images'] ?? []),
    ...(ctx.inputs['in-style'] ?? [])
  ]
  const rawImageItems: GraphImageItem[] = []
  for (const val of imagePortValues) {
    const items = await collectImageItemsFromValue(val, ctx)
    rawImageItems.push(...items)
  }

  // Deduplicate raw images by path/url
  const seenImgKeys = new Set<string>()
  for (let i = 0; i < rawImageItems.length; i++) {
    const imgItem = rawImageItems[i]!
    const key = imgItem.relativePath?.trim() || imgItem.dataUrl?.trim() || ''
    if (!key || seenImgKeys.has(key)) continue
    seenImgKeys.add(key)
    const safeUrl = await resolveSafeAtlasImageUrl(ctx, imgItem, stamp, `raw${i}`)
    if (!safeUrl) continue
    try {
      const rgba = await codec.decodeImageRgba(safeUrl)
      if (rgba.width > 0 && rgba.height > 0) {
        const extracted = extractAtlasCandidatesFromRgba(
          rgba,
          imgItem.title?.trim() || `Atlas_${i + 1}`,
          allCandidates.length + 1
        )
        allCandidates.push(...extracted)
      }
    } catch {
      // Skip unreadable image
    }
  }

  // 2b) Resolve UI specification / prompt first so project & directory discovery can rank matching images
  const textCandidates = [...(ctx.inputs['in-text'] ?? []), ...(ctx.inputs.in ?? [])]
  const incomingText = [
    ...flattenTextValues(textCandidates).map((t) => t.text ?? ''),
    ...flattenTextsValues(textCandidates).map((t) => t.text ?? '')
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n')
  const effectivePrompt = [
    prev.prompt?.trim(),
    ctx.node.params.generateInstruction?.trim(),
    ctx.node.params.text?.trim(),
    incomingText.trim()
  ]
    .filter(Boolean)
    .join('\n\n')

  // 2c) Auto-discover project-wide UI Atlas / Component Library / Icon Pack resources
  // when no explicit upstream `in-components` / `in` / `in-images` was connected
  if (!allCandidates.length && ctx.resolveProjectUiAtlasResources) {
    try {
      const discovered = await ctx.resolveProjectUiAtlasResources({ prompt: effectivePrompt })
      let mergedProjLib = emptyUiComponentLibrary()
      for (const lib of discovered.componentLibraries ?? []) {
        mergedProjLib = mergeUiComponentLibraries(mergedProjLib, lib)
      }
      for (let i = 0; i < mergedProjLib.items.length; i++) {
        const item = mergedProjLib.items[i]!
        const safeUrl = await resolveSafeAtlasImageUrl(
          ctx,
          { relativePath: item.imageRelativePath, dataUrl: item.imageUrl },
          stamp,
          `projComp${i}`
        )
        if (!safeUrl) continue
        try {
          const rgba = await codec.decodeImageRgba(safeUrl)
          if (rgba.width > 0 && rgba.height > 0) {
            allCandidates.push({ item, rgba })
          }
        } catch {
          // Ignore unreadable project component
        }
      }
      for (let i = 0; i < (discovered.images ?? []).length; i++) {
        const imgItem = discovered.images![i]!
        const key = imgItem.relativePath?.trim() || imgItem.dataUrl?.trim() || ''
        if (!key || seenImgKeys.has(key)) continue
        seenImgKeys.add(key)
        const safeUrl = await resolveSafeAtlasImageUrl(ctx, imgItem, stamp, `projAtlas${i}`)
        if (!safeUrl) continue
        try {
          const rgba = await codec.decodeImageRgba(safeUrl)
          if (rgba.width > 0 && rgba.height > 0) {
            const extracted = extractAtlasCandidatesFromRgba(
              rgba,
              imgItem.title?.trim() || `ProjectAtlas_${i + 1}`,
              allCandidates.length + 1
            )
            allCandidates.push(...extracted)
          }
        } catch {
          // Ignore unreadable project atlas image
        }
      }
    } catch {
      // Ignore project discovery error
    }
  }

  // 2d) Also check node & project global UI style reference images (`styleImages` / `resolveProjectStyleImages`)
  if (!allCandidates.length && ctx.node.params.styleImagesUseGlobal !== false) {
    const styleImages = resolveNodeStyleImages(ctx)
    if (styleImages.length > 0) {
      const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)
      for (let i = 0; i < styleUrls.length; i++) {
        const styleUrl = styleUrls[i]?.trim() || ''
        if (!styleUrl || seenImgKeys.has(styleUrl)) continue
        seenImgKeys.add(styleUrl)
        const safeUrl = await resolveSafeAtlasImageUrl(
          ctx,
          { dataUrl: styleUrl },
          stamp,
          `style${i}`
        )
        if (!safeUrl) continue
        try {
          const rgba = await codec.decodeImageRgba(safeUrl)
          if (rgba.width > 0 && rgba.height > 0) {
            const styleName = styleImages[i]?.name?.trim() || `StyleAtlas_${i + 1}`
            const extracted = extractAtlasCandidatesFromRgba(
              rgba,
              styleName,
              allCandidates.length + 1
            )
            allCandidates.push(...extracted)
          }
        } catch {
          // Ignore unreadable style image
        }
      }
    }
  }

  // 3) If no external atlas/component image was connected yet, synthesize the built-in 9-slice Game UI Atlas Kit
  // so that running `ui.atlasCompose` with `in-text` (or standalone) immediately produces a complete layered UI & PSD!
  if (!allCandidates.length) {
    allCandidates.push(...synthesizeProceduralUiAtlasKit(effectivePrompt))
  }

  const portraitRe = /竖屏|竖版|9\s*[:：]\s*16|portrait|mobile\s*vertical/i // cjk-ok
  const isPortraitPrompt = portraitRe.test(effectivePrompt)
  const targetCanvasW = prev.canvasWidth > 0 ? prev.canvasWidth : isPortraitPrompt ? 1080 : 1920
  const targetCanvasH = prev.canvasHeight > 0 ? prev.canvasHeight : isPortraitPrompt ? 1920 : 1080

  // 4) Solve UI layout (AI LLM solver with deterministic fallback)
  const candidateById = new Map<string, PreciseSplitComponentCandidate>()
  for (const cand of allCandidates) {
    candidateById.set(cand.item.id, cand)
  }
  const validComponentIds = new Set(candidateById.keys())

  let layoutPlan: UiAtlasLayoutPlan | null = null
  if (ctx.generateText) {
    try {
      const catalogSummary = allCandidates.map((c) => ({
        id: c.item.id,
        name: c.item.name,
        kind: c.item.kind,
        width: c.item.canonicalWidth,
        height: c.item.canonicalHeight,
        scalePolicy: c.item.scalePolicy,
        ...(c.item.nineSliceBorders ? { nineSliceBorders: c.item.nineSliceBorders } : {})
      }))
      const userMessage = [
        `Target Canvas: ${targetCanvasW}x${targetCanvasH}`,
        `Available Atlas Components (${catalogSummary.length}):`,
        JSON.stringify(catalogSummary, null, 2),
        effectivePrompt
          ? `UI Screen Requirement:\n${effectivePrompt}`
          : 'Assemble a complete Game UI screen (main panel frame, top header bar, tabs, item slot grid, action buttons, and editable text labels) using the available atlas components.'
      ].join('\n\n')

      const aiRes = await ctx.generateText({
        system: buildAtlasComposeSystemPrompt(),
        prompt: userMessage,
        ...(ctx.node.params.visionModel?.trim()
          ? { model: ctx.node.params.visionModel.trim() }
          : ctx.node.params.generateModel?.trim()
            ? { model: ctx.node.params.generateModel.trim() }
            : {}),
        ...(ctx.node.params.visionProviderInstanceId?.trim()
          ? { providerInstanceId: ctx.node.params.visionProviderInstanceId.trim() }
          : ctx.node.params.generateProviderInstanceId?.trim()
            ? { providerInstanceId: ctx.node.params.generateProviderInstanceId.trim() }
            : {})
      })
      if (aiRes?.text?.trim()) {
        layoutPlan = parseAiAtlasLayoutPlan(
          aiRes.text,
          validComponentIds,
          targetCanvasW,
          targetCanvasH
        )
      }
    } catch (err) {
      ctx.log?.(
        `[ui.atlasCompose] AI layout solver fallback to template: ${String((err as Error)?.message ?? err)}`,
        'info'
      )
    }
  }

  if (!layoutPlan) {
    layoutPlan = solveUiAtlasLayoutDeterministic(
      allCandidates,
      effectivePrompt,
      targetCanvasW,
      targetCanvasH,
      ctx.locale
    )
  }

  // 5) Render canonical component masters + all placed layers into ImageLayerSplitState
  const cw = layoutPlan.canvasWidth
  const ch = layoutPlan.canvasHeight
  const createdAt = new Date().toISOString()
  const layerBatch: GraphImageItem[] = []
  const layers: ImageLayerSplitLayer[] = []

  // Encode canonical component masters so PSD export can build shared Smart Objects (`SoLd` / `lnk2`)
  const embeddedLibrary: UiSharedComponentItem[] = []
  for (const cand of allCandidates) {
    const compImgId = `atlasMaster:${ctx.node.id}:${stamp}:${cand.item.id}`
    const masterDataUrl = await codec.encodeRgbaPng(cand.rgba)
    layerBatch.push({
      id: compImgId,
      title: cand.item.name,
      dataUrl: masterDataUrl,
      createdAt
    })
    embeddedLibrary.push({
      ...cand.item,
      imageId: compImgId,
      imageUrl: masterDataUrl
    })
  }

  // Base layer (zIndex = 0)
  const baseImgId = `atlasLayer:${ctx.node.id}:${stamp}:base`
  const baseRgba = renderGameUiBackdropRgba(cw, ch, layoutPlan.baseColor ?? [20, 24, 36])
  const baseDataUrl = await codec.encodeRgbaPng(baseRgba)
  layerBatch.push({
    id: baseImgId,
    title: 'Base',
    dataUrl: baseDataUrl,
    createdAt
  })
  layers.push({
    id: baseImgId,
    imageId: baseImgId,
    zIndex: 0,
    name: 'Base',
    description: 'Canvas Base Backdrop',
    visible: true,
    left: 0,
    top: 0,
    width: cw,
    height: ch,
    role: 'canvas-base',
    originalAbsolute: [0, 0, cw, ch],
    originalNormalized: [0, 0, 1000, 1000]
  })

  // Render each placement layer
  const sortedPlacements = [...layoutPlan.placements].sort(
    (a, b) => (a.zIndex ?? 1) - (b.zIndex ?? 1)
  )
  for (let i = 0; i < sortedPlacements.length; i++) {
    const p = sortedPlacements[i]!
    const zIndex = i + 1
    const layerId = `atlasLayer:${ctx.node.id}:${stamp}:${zIndex}`
    const w = Math.max(8, Math.round(p.width))
    const h = Math.max(8, Math.round(p.height))
    const left = Math.max(0, Math.min(cw - 4, Math.round(p.left)))
    const top = Math.max(0, Math.min(ch - 4, Math.round(p.top)))

    const cand = p.componentId ? candidateById.get(p.componentId) : undefined
    let renderedRgba: RgbaImage
    let nineSliceBorders: [number, number, number, number] | undefined
    if (cand) {
      renderedRgba = renderComponentToRect(
        cand.rgba,
        w,
        h,
        cand.item.scalePolicy,
        cand.item.nineSliceBorders
      )
      if (cand.item.nineSliceBorders) {
        // Convert CSS [top, right, bottom, left] to layerSplit [left, top, right, bottom]
        const [tB, rB, bB, lB] = cand.item.nineSliceBorders
        nineSliceBorders = [lB, tB, rB, bB]
      }
    } else if (p.editableText) {
      renderedRgba = renderTextLayerPreviewRgba(w, h, p.editableText)
    } else {
      continue
    }

    const layerDataUrl = await codec.encodeRgbaPng(renderedRgba)
    layerBatch.push({
      id: layerId,
      title: p.name,
      dataUrl: layerDataUrl,
      createdAt
    })

    const normX1 = Math.round((left / cw) * 1000)
    const normY1 = Math.round((top / ch) * 1000)
    const normX2 = Math.round(((left + w) / cw) * 1000)
    const normY2 = Math.round(((top + h) / ch) * 1000)

    layers.push({
      id: layerId,
      imageId: layerId,
      zIndex,
      name: p.name,
      description: cand ? `${cand.item.kind} (${cand.item.name})` : 'Editable Text Layer',
      visible: true,
      left,
      top,
      width: w,
      height: h,
      role: 'layer',
      ...(p.groupId ? { groupId: p.groupId } : {}),
      originalAbsolute: [left, top, left + w, top + h],
      originalNormalized: [normX1, normY1, normX2, normY2],
      ...(nineSliceBorders ? { nineSliceBorders } : {}),
      ...(p.exportName
        ? { exportName: p.exportName }
        : { exportName: sanitizeComponentExportName(p.name, zIndex) }),
      ...(cand
        ? {
            componentId: cand.item.id,
            componentMatchScore: 1,
            originalImageId: layerId,
            componentImageId: layerId,
            prefabKey: cand.item.exportName
          }
        : {}),
      ...(p.editableText ? { editableText: p.editableText } : {})
    })
  }

  const groups: ImageLayerSplitGroup[] = (layoutPlan.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    collapsed: false,
    visible: true,
    sourceLayerId: ''
  }))

  const selectedId = layers.find((layer) => !isLayerSplitBase(layer))?.id || layers[0]?.id || ''
  let state: ImageLayerSplitState = {
    ...prev,
    prompt: effectivePrompt,
    selectedId,
    canvasWidth: cw,
    canvasHeight: ch,
    layers: sortLayersForCompose(layers),
    groups,
    componentLibrary: embeddedLibrary,
    sourceFingerprint: `atlasCompose:${stamp}`
  }
  if (!state.groups.length) {
    state = autoGroupLayersForGameUi(state, ctx.locale)
  }

  // 6) Materialize layer PNGs and compose preview + PSD file
  const inMemoryLayerUrls: Record<string, string> = {}
  for (const item of layerBatch) {
    const id = item.id?.trim()
    const url = item.dataUrl?.trim()
    if (id && url && isCanvasSafeImageSrc(url)) {
      inMemoryLayerUrls[id] = url
    }
  }

  const materializedLayers = await materializeGeneratedBatch(
    ctx,
    layerBatch,
    `atlasCompose:${ctx.node.id}:${stamp}`
  )
  if (!materializedLayers.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }

  const matMap = new Map(materializedLayers.map((m) => [m.id, m]))
  state = {
    ...state,
    componentLibrary: (state.componentLibrary ?? []).map((comp) => {
      const mat = comp.imageId ? matMap.get(comp.imageId) : undefined
      const rel = mat?.relativePath?.trim()
      return rel ? { ...comp, imageRelativePath: rel } : comp
    })
  }

  let composite: GraphImageItem | null = null
  let psdDataUrl: string | undefined
  if (ctx.composeImageLayerStack) {
    try {
      const layerUrls: Record<string, string> = { ...inMemoryLayerUrls }
      for (const item of materializedLayers) {
        const id = item.id?.trim()
        if (!id || layerUrls[id]) continue
        if (item.dataUrl?.trim() && isCanvasSafeImageSrc(item.dataUrl.trim())) {
          layerUrls[id] = item.dataUrl.trim()
        } else if (item.relativePath?.trim() && ctx.resolveImageUrls) {
          const urls = await ctx.resolveImageUrls([{ relativePath: item.relativePath.trim() }])
          if (urls[0]?.trim()) layerUrls[id] = urls[0].trim()
        }
      }
      const composed = await ctx.composeImageLayerStack({ state, layerUrls })
      if (composed.dataUrl?.trim()) {
        composite = {
          id: layerSplitCompositeImageId(ctx.node.id),
          title: 'Composite',
          dataUrl: composed.dataUrl.trim(),
          createdAt
        }
      }
      psdDataUrl = composed.psdDataUrl?.trim() || undefined
    } catch (err) {
      console.warn('[graph] ui.atlasCompose compose failed', err)
    }
  }

  const extra: GraphImageItem[] = []
  if (composite) {
    const [materializedComposite] = await materializeGeneratedBatch(
      ctx,
      [composite],
      `atlasCompose:${ctx.node.id}:${stamp}:comp`
    )
    if (materializedComposite) extra.push(materializedComposite)
  }

  let psdRelativePath: string | undefined
  if (psdDataUrl && ctx.saveRunMedia) {
    try {
      const psdKey = buildGeneratedMediaFileKey({
        hostAssetName: ctx.resolveHostAssetName?.(),
        nodeTitle: ctx.node.title || ctx.node.typeId || 'atlasCompose',
        stamp: formatGeneratedMediaStamp(),
        index: null
      })
      psdRelativePath = (
        await ctx.saveRunMedia({
          dataUrl: psdDataUrl,
          key: psdKey,
          outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
          node: ctx.node
        })
      )?.trim()
    } catch (err) {
      console.warn('[graph] ui.atlasCompose psd persist failed', err)
    }
  }

  const libDoc: UiComponentLibrary = mergeUiComponentLibraries({
    schema: 'aiart.ui-component-library@1',
    items: state.componentLibrary ?? []
  })
  const generatedImages = [...materializedLayers, ...extra]
  const previewPath = extra[0]?.relativePath?.trim() || materializedLayers[0]?.relativePath?.trim()
  const outputs = commitGeneratedImages(ctx, generatedImages, previewPath, {
    ...imageLayerSplitToNodePatch(state),
    uiComponentLibrary: stringifyUiComponentLibrary(libDoc),
    ...(psdRelativePath ? { layerSplitPsdRelativePath: psdRelativePath } : {})
  })
  outputs['out-components'] = uiComponentsValue(libDoc)
  if (psdRelativePath) {
    outputs['out-psd'] = {
      kind: 'text',
      text: psdRelativePath,
      relativePath: psdRelativePath
    }
  }
  return outputs
}
