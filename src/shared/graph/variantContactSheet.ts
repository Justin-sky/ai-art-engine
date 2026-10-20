/**
 * 「平行宇宙」实时变体矩阵与客户审片比稿样张（Parallel Universe Variant Matrix & Contact Sheet）
 *
 * 本地 0 Token 同时渲染多套高辨识度人像精修风格或 2.5D 布光矩阵，
 * 并自动排版为带深色暗房边框、分割线与色标徽章的商业比稿样张（2×2 或 3×2）。
 */

import {
  apply25dRelightToRgba,
  normalizeLightingSetup,
  type LightingSetupState
} from './lightingSetup'
import { applyPortraitLivePixelPipeline } from './portraitLiveMath'
import { normalizePortraitRetouch, type PortraitRetouchState } from './portraitRetouch'

export interface PortraitVariantRecipe {
  id: string
  labelZh: string
  labelEn: string
  accentRgb: readonly [number, number, number]
  statePatch: Partial<PortraitRetouchState>
}

export interface LightingVariantRecipe {
  id: string
  labelZh: string
  labelEn: string
  accentRgb: readonly [number, number, number]
  setup: LightingSetupState
}

export const PORTRAIT_PARALLEL_UNIVERSE_RECIPES: readonly PortraitVariantRecipe[] = [
  {
    id: 'cool-porcelain',
    labelZh: '清透冷白皮',
    labelEn: 'Cool Porcelain',
    accentRgb: [110, 200, 255],
    statePatch: {
      skinSmoothing: 'standard',
      skinWhiten: 'strong',
      skinDeYellow: 'standard',
      colorTemp: 'coolLight',
      toneGrade: 'brightAiry',
      lutId: 'coolFilm'
    }
  },
  {
    id: 'fuji-film',
    labelZh: '富士胶片感',
    labelEn: 'Fuji Film',
    accentRgb: [92, 224, 168],
    statePatch: {
      skinSmoothing: 'light',
      skinWhiten: 'light',
      colorTint: 'slightGreen',
      toneGrade: 'filmFade',
      grain: 'light',
      lutId: 'fuji'
    }
  },
  {
    id: 'hk-vintage',
    labelZh: '港风复古金',
    labelEn: 'HK Vintage',
    accentRgb: [255, 176, 84],
    statePatch: {
      skinSmoothing: 'standard',
      colorTemp: 'warm',
      toneGrade: 'highContrast',
      saturation: 'boost',
      vignette: 'light',
      lutId: 'hongkong'
    }
  },
  {
    id: 'black-gold-editorial',
    labelZh: '高定黑金大刊',
    labelEn: 'Editorial Black-Gold',
    accentRgb: [240, 198, 102],
    statePatch: {
      skinSmoothing: 'standard',
      faceContour: 'strong',
      lightRatio: 'dramatic',
      toneGrade: 'lowKeyMoody',
      sharpness: 'standard',
      lutId: 'blackGold'
    }
  }
] as const

export const LIGHTING_PARALLEL_UNIVERSE_RECIPES: readonly LightingVariantRecipe[] = [
  {
    id: 'rembrandt-warm',
    labelZh: '伦勃朗暖主光',
    labelEn: 'Warm Rembrandt',
    accentRgb: [255, 178, 92],
    setup: normalizeLightingSetup({
      yaw: 45,
      pitch: 28,
      brightness: 88,
      color: '#ffb26b',
      rimLight: true
    })
  },
  {
    id: 'butterfly-beauty',
    labelZh: '蝴蝶光美人镜',
    labelEn: 'Butterfly Beauty',
    accentRgb: [255, 226, 208],
    setup: normalizeLightingSetup({
      yaw: 0,
      pitch: 42,
      brightness: 92,
      color: '#fff4eb',
      rimLight: false
    })
  },
  {
    id: 'cyber-neon-split',
    labelZh: '赛博冰蓝侧逆',
    labelEn: 'Cyber Cyan Split',
    accentRgb: [72, 212, 255],
    setup: normalizeLightingSetup({
      yaw: -78,
      pitch: 12,
      brightness: 94,
      color: '#48d4ff',
      rimLight: true
    })
  },
  {
    id: 'sunset-rim',
    labelZh: '落日熔金轮廓',
    labelEn: 'Golden Sunset Rim',
    accentRgb: [255, 122, 69],
    setup: normalizeLightingSetup({
      yaw: 110,
      pitch: -8,
      brightness: 95,
      color: '#ff7a45',
      rimLight: true
    })
  }
] as const

export interface ContactSheetCellResult {
  id: string
  labelZh: string
  labelEn: string
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  pixels: Uint8ClampedArray
}

export interface ContactSheetResult {
  pixels: Uint8ClampedArray
  width: number
  height: number
  columns: number
  rows: number
  cells: ContactSheetCellResult[]
}

function downsampleRgba(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) return new Uint8ClampedArray(src)
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW))
      const si = (sy * srcW + sx) * 4
      const di = (y * dstW + x) * 4
      out[di] = src[si]!
      out[di + 1] = src[si + 1]!
      out[di + 2] = src[si + 2]!
      out[di + 3] = src[si + 3]!
    }
  }
  return out
}

function composeContactSheetFromCells(
  rawCells: Array<{
    id: string
    labelZh: string
    labelEn: string
    accentRgb: readonly [number, number, number]
    pixels: Uint8ClampedArray
  }>,
  cellW: number,
  cellH: number,
  columns: number,
  gapPx: number,
  marginPx: number
): ContactSheetResult {
  const cols = Math.max(1, columns)
  const rows = Math.max(1, Math.ceil(rawCells.length / cols))
  const sheetW = marginPx * 2 + cols * cellW + (cols - 1) * gapPx
  const sheetH = marginPx * 2 + rows * cellH + (rows - 1) * gapPx
  const out = new Uint8ClampedArray(sheetW * sheetH * 4)

  // 深空灰专业审片暗房底色 (#14161B)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 20
    out[i + 1] = 22
    out[i + 2] = 27
    out[i + 3] = 255
  }

  const cells: ContactSheetCellResult[] = []
  const barHeight = Math.max(4, Math.min(10, Math.round(cellH * 0.035)))

  for (let idx = 0; idx < rawCells.length; idx++) {
    const item = rawCells[idx]!
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const ox = marginPx + col * (cellW + gapPx)
    const oy = marginPx + row * (cellH + gapPx)

    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const si = (y * cellW + x) * 4
        const di = ((oy + y) * sheetW + (ox + x)) * 4
        out[di] = item.pixels[si]!
        out[di + 1] = item.pixels[si + 1]!
        out[di + 2] = item.pixels[si + 2]!
        out[di + 3] = 255
      }
    }

    // 顶部风格特征色标条（Accent Color Ribbon）
    const [ar, ag, ab] = item.accentRgb
    for (let y = 0; y < barHeight; y++) {
      for (let x = 0; x < cellW; x++) {
        const di = ((oy + y) * sheetW + (ox + x)) * 4
        out[di] = ar
        out[di + 1] = ag
        out[di + 2] = ab
        out[di + 3] = 255
      }
    }

    cells.push({
      id: item.id,
      labelZh: item.labelZh,
      labelEn: item.labelEn,
      col,
      row,
      x: ox,
      y: oy,
      width: cellW,
      height: cellH,
      pixels: item.pixels
    })
  }

  return {
    pixels: out,
    width: sheetW,
    height: sheetH,
    columns: cols,
    rows,
    cells
  }
}

/**
 * 并行渲染人像精修「平行宇宙」2×2 商业风格比稿样张（Contact Sheet）
 */
export function renderPortraitVariantGridRgba(
  sourcePixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  options?: {
    baseState?: Partial<PortraitRetouchState>
    landmarks?: ReadonlyArray<readonly [number, number]> | null
    recipes?: readonly PortraitVariantRecipe[]
    columns?: number
    maxCellEdge?: number
    gapPx?: number
    marginPx?: number
  }
): ContactSheetResult {
  const recipes = options?.recipes?.length ? options.recipes : PORTRAIT_PARALLEL_UNIVERSE_RECIPES
  const cols = options?.columns ?? 2
  const maxEdge = Math.max(32, options?.maxCellEdge ?? 480)
  const scale = Math.min(1, maxEdge / Math.max(1, srcW, srcH))
  const cellW = Math.max(8, Math.round(srcW * scale))
  const cellH = Math.max(8, Math.round(srcH * scale))
  const workSrc = downsampleRgba(sourcePixels, srcW, srcH, cellW, cellH)

  const base = normalizePortraitRetouch(options?.baseState)
  const rawCells = recipes.map((recipe) => {
    const mergedState = normalizePortraitRetouch({
      ...base,
      ...recipe.statePatch
    })
    const rendered = applyPortraitLivePixelPipeline(workSrc, cellW, cellH, {
      state: mergedState,
      landmarks: options?.landmarks ?? null
    })
    return {
      id: recipe.id,
      labelZh: recipe.labelZh,
      labelEn: recipe.labelEn,
      accentRgb: recipe.accentRgb,
      pixels: rendered.pixels
    }
  })

  return composeContactSheetFromCells(
    rawCells,
    cellW,
    cellH,
    cols,
    options?.gapPx ?? 8,
    options?.marginPx ?? 12
  )
}

/**
 * 并行渲染 2.5D 重打光「平行宇宙」2×2 商业布光比稿样张（Contact Sheet）
 */
export function renderLightingVariantGridRgba(
  sourcePixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  options?: {
    recipes?: readonly LightingVariantRecipe[]
    columns?: number
    maxCellEdge?: number
    gapPx?: number
    marginPx?: number
  }
): ContactSheetResult {
  const recipes = options?.recipes?.length ? options.recipes : LIGHTING_PARALLEL_UNIVERSE_RECIPES
  const cols = options?.columns ?? 2
  const maxEdge = Math.max(32, options?.maxCellEdge ?? 480)
  const scale = Math.min(1, maxEdge / Math.max(1, srcW, srcH))
  const cellW = Math.max(8, Math.round(srcW * scale))
  const cellH = Math.max(8, Math.round(srcH * scale))
  const workSrc = downsampleRgba(sourcePixels, srcW, srcH, cellW, cellH)

  const rawCells = recipes.map((recipe) => {
    const relit = apply25dRelightToRgba(workSrc, cellW, cellH, recipe.setup)
    return {
      id: recipe.id,
      labelZh: recipe.labelZh,
      labelEn: recipe.labelEn,
      accentRgb: recipe.accentRgb,
      pixels: relit
    }
  })

  return composeContactSheetFromCells(
    rawCells,
    cellW,
    cellH,
    cols,
    options?.gapPx ?? 8,
    options?.marginPx ?? 12
  )
}
