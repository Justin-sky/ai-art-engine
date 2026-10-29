/**
 * Production-Grade Indie Game Asset Pipeline Pure Functions.
 *
 * Covers the 6 core production asset workflows required by indie game developers (Godot 4 / Unity / Universal):
 * 1. Multi-Action Character Sprite Suite Normalization & Atlas Packing (`normalizeMultiActionSpriteSuite`, `exportGodotSpriteFramesTres`)
 *    - Locks character torso height ratio and bottom-center foot pivot across Idle/Run/Attack/Hit/Death frames.
 * 2. Wang-16 (4x4 = 16-cell) Auto-Tile Terrain Atlas Synthesizer & Godot 4 TileSet `.tres` Exporter (`synthesizeWang16AutoTileAtlas`, `exportGodotTileSetTres`)
 *    - Generates a ready-to-paint 16-tile bitmask transition atlas from primary + secondary terrain textures.
 * 3. Modular Scene Prop Processor (`processScenePropWithYSortAndShadow`)
 *    - Computes Y-Sort baseline origin, renders grounded ambient-occlusion contact shadow, and extracts base-footprint collision polygon.
 * 4. UI 4-State Button Generator & 5-Tier Rarity Icon Frame Compositor (`generateUiButtonFourStates`, `compositeIconWithRarityFrame`, `exportGodotUiButtonThemeTres`)
 *    - Derives Normal / Hover / Pressed / Disabled button states with optional horizontal symmetry lock, and 5 rarity icon frames.
 * 5. 2D VFX Black-to-Alpha Unpremultiply Demult (`extractVfxLuminanceAlpha`)
 *    - Converts black-background fire/slash/magic VFX into clean unpremultiplied linear alpha without dark halos.
 * 6. BGM Intro + Seamless Loop Splitter & LUFS Loudness Normalizer (`splitBgmIntroAndSeamlessLoop`, `normalizeIntegratedLufsPcm`)
 *    - Splits BGM into an intro segment and a phase-continuous seamless loop segment with LUFS loudness targeting.
 */

import { extractAlphaBounds } from './spriteGeometry'
import { applyBorderFloodColorKey, hasNativeTransparentPixels } from './iconPackKeying'
import { buildEngineSpriteSheetJson, type EngineSpriteSheetJson } from './spriteManifest'
import {
  extractSpriteCollisionHull,
  type Point2D,
  type SpriteCollisionHullResult
} from './spritePhysicsHull'
import { applyEqualPowerLoopCrossfadePcm } from './gameAudioWavDSP'
import {
  applySeamlessTileBlend,
  buildAutoTileAtlasManifest,
  type AutoTileAtlasManifest,
  type AutoTileCellEntry
} from './tilemapSeamless'
import {
  detectNineSliceBorders,
  type NineSliceBorders,
  type NineSliceDetectionResult
} from './uiNineSlice'
import type { GameBundleCategory } from './gameBundleManifest'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}

// ============================================================================
// 1. Multi-Action Character Sprite Suite Normalization & Godot 4 SpriteFrames
// ============================================================================

export interface SpriteActionFrameInput {
  rgba: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  holdMultiplier?: number
}

export interface SpriteActionClipInput {
  actionName: string
  fps?: number
  loop?: boolean
  frames: SpriteActionFrameInput[]
}

export interface NormalizedActionFrame {
  actionName: string
  frameIndex: number
  atlasCol: number
  atlasRow: number
  atlasX: number
  atlasY: number
  width: number
  height: number
  pivotX: number
  pivotY: number
  rgba: Uint8ClampedArray
}

export interface MultiActionSpriteSuiteResult {
  cellWidth: number
  cellHeight: number
  footPivotX: number
  footPivotY: number
  atlasWidth: number
  atlasHeight: number
  atlasColumns: number
  atlasRows: number
  atlasRgba: Uint8ClampedArray
  frames: NormalizedActionFrame[]
  actions: Array<{
    actionName: string
    fps: number
    loop: boolean
    startFrameIndex: number
    frameCount: number
  }>
  spriteSheetJson: EngineSpriteSheetJson
  godotSpriteFramesTres: string
}

/**
 * Normalizes multiple character animation clips onto a unified cell canvas (`cellWidth x cellHeight`)
 * with a locked bottom-center foot pivot `(cellWidth / 2, cellHeight - bottomMarginPx)` and consistent
 * character scale derived from the reference `idle` clip (or first clip), then packs all frames into
 * a single Sprite Atlas with TexturePacker JSON and Godot 4 `SpriteFrames.tres`.
 */
export function normalizeMultiActionSpriteSuite(
  clips: SpriteActionClipInput[],
  options?: {
    cellWidth?: number
    cellHeight?: number
    bottomMarginPx?: number
    targetBodyHeightRatio?: number
    atlasImageFileName?: string
  }
): MultiActionSpriteSuiteResult {
  const cellWidth = Math.max(16, Math.min(1024, Math.round(options?.cellWidth ?? 128)))
  const cellHeight = Math.max(16, Math.min(1024, Math.round(options?.cellHeight ?? 128)))
  const bottomMarginPx = Math.max(
    2,
    Math.min(Math.floor(cellHeight * 0.25), Math.round(options?.bottomMarginPx ?? 8))
  )
  const targetBodyHeightRatio = clamp(Number(options?.targetBodyHeightRatio ?? 0.72), 0.35, 0.92)
  const footPivotX = Math.round(cellWidth / 2)
  const footPivotY = cellHeight - bottomMarginPx
  const targetRefHeightPx = Math.max(8, Math.round(cellHeight * targetBodyHeightRatio))

  // Measure reference character height from idle[0] (or first non-empty frame)
  let refContentHeight = 0
  for (const clip of clips) {
    for (const f of clip.frames) {
      const b = extractAlphaBounds(f.rgba, f.width, f.height, { alphaMin: 12 })
      if (b && b.height > 0) {
        refContentHeight = b.height
        break
      }
    }
    if (refContentHeight > 0) break
  }
  const uniformScale = refContentHeight > 0 ? targetRefHeightPx / refContentHeight : 1

  const totalFrames = clips.reduce((acc, c) => acc + c.frames.length, 0)
  const atlasColumns = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(Math.max(1, totalFrames)))))
  const atlasRows = Math.max(1, Math.ceil(Math.max(1, totalFrames) / atlasColumns))
  const atlasWidth = atlasColumns * cellWidth
  const atlasHeight = atlasRows * cellHeight
  const atlasRgba = new Uint8ClampedArray(atlasWidth * atlasHeight * 4)

  const normalizedFrames: NormalizedActionFrame[] = []
  const actionsMeta: MultiActionSpriteSuiteResult['actions'] = []
  const frameNames: string[] = []
  const frameHolds: number[] = []

  let globalIdx = 0
  for (const clip of clips) {
    const actionName = clip.actionName.trim() || 'idle'
    const fps = Math.max(1, Math.min(60, Math.round(clip.fps ?? 10)))
    const loop = clip.loop ?? !/(attack|hit|hurt|die|death|cast|skill)/i.test(actionName)
    const startFrameIndex = globalIdx

    for (let fIdx = 0; fIdx < clip.frames.length; fIdx++) {
      const src = clip.frames[fIdx]!
      const cellRgba = new Uint8ClampedArray(cellWidth * cellHeight * 4)
      const bounds = extractAlphaBounds(src.rgba, src.width, src.height, { alphaMin: 12 })

      if (bounds && bounds.width > 0 && bounds.height > 0) {
        // Fit within cell while preserving the reference character scale (clamped only if overflowing cell)
        const maxScaleX = (cellWidth - 4) / bounds.width
        const maxScaleY = (footPivotY - 2) / bounds.height
        const scale = Math.min(uniformScale, maxScaleX, maxScaleY)
        const dstW = Math.max(1, Math.round(bounds.width * scale))
        const dstH = Math.max(1, Math.round(bounds.height * scale))
        const dstX0 = Math.round(footPivotX - dstW / 2)
        const dstY0 = Math.round(footPivotY - dstH)

        for (let dy = 0; dy < dstH; dy++) {
          const ty = dstY0 + dy
          if (ty < 0 || ty >= cellHeight) continue
          const sy = Math.min(
            src.height - 1,
            bounds.y + Math.floor(((dy + 0.5) / dstH) * bounds.height)
          )
          for (let dx = 0; dx < dstW; dx++) {
            const tx = dstX0 + dx
            if (tx < 0 || tx >= cellWidth) continue
            const sx = Math.min(
              src.width - 1,
              bounds.x + Math.floor(((dx + 0.5) / dstW) * bounds.width)
            )
            const sOff = (sy * src.width + sx) * 4
            const dOff = (ty * cellWidth + tx) * 4
            cellRgba[dOff] = src.rgba[sOff]!
            cellRgba[dOff + 1] = src.rgba[sOff + 1]!
            cellRgba[dOff + 2] = src.rgba[sOff + 2]!
            cellRgba[dOff + 3] = src.rgba[sOff + 3]!
          }
        }
      }

      const atlasCol = globalIdx % atlasColumns
      const atlasRow = Math.floor(globalIdx / atlasColumns)
      const atlasX = atlasCol * cellWidth
      const atlasY = atlasRow * cellHeight

      for (let y = 0; y < cellHeight; y++) {
        const srcRowStart = y * cellWidth * 4
        const dstRowStart = ((atlasY + y) * atlasWidth + atlasX) * 4
        atlasRgba.set(cellRgba.subarray(srcRowStart, srcRowStart + cellWidth * 4), dstRowStart)
      }

      normalizedFrames.push({
        actionName,
        frameIndex: fIdx,
        atlasCol,
        atlasRow,
        atlasX,
        atlasY,
        width: cellWidth,
        height: cellHeight,
        pivotX: footPivotX,
        pivotY: footPivotY,
        rgba: cellRgba
      })
      frameNames.push(`${actionName}_${String(fIdx).padStart(2, '0')}`)
      frameHolds.push(src.holdMultiplier ?? 1)
      globalIdx++
    }

    actionsMeta.push({
      actionName,
      fps,
      loop,
      startFrameIndex,
      frameCount: clip.frames.length
    })
  }

  const imageFileName = options?.atlasImageFileName?.trim() || 'character_atlas.png'
  const spriteSheetJson = buildEngineSpriteSheetJson({
    imageFileName,
    frameWidth: cellWidth,
    frameHeight: cellHeight,
    frameNames,
    columns: atlasColumns,
    fps: actionsMeta[0]?.fps ?? 10,
    anchor: 'ground',
    frameHolds
  })

  // Populate multi-action frameTags for Aseprite / Godot / Phaser importers
  spriteSheetJson.meta.frameTags = actionsMeta
    .filter((a) => a.frameCount > 0)
    .map((a) => ({
      name: a.actionName,
      from: a.startFrameIndex,
      to: a.startFrameIndex + a.frameCount - 1,
      direction: 'forward' as const
    }))

  const godotSpriteFramesTres = exportGodotSpriteFramesTres({
    textureResPath: `res://assets/sprites/${imageFileName}`,
    cellWidth,
    cellHeight,
    frames: normalizedFrames,
    actions: actionsMeta
  })

  return {
    cellWidth,
    cellHeight,
    footPivotX,
    footPivotY,
    atlasWidth,
    atlasHeight,
    atlasColumns,
    atlasRows,
    atlasRgba,
    frames: normalizedFrames,
    actions: actionsMeta,
    spriteSheetJson,
    godotSpriteFramesTres
  }
}

export function exportGodotSpriteFramesTres(input: {
  textureResPath: string
  cellWidth: number
  cellHeight: number
  frames: ReadonlyArray<{
    actionName: string
    frameIndex: number
    atlasX: number
    atlasY: number
    width: number
    height: number
  }>
  actions: ReadonlyArray<{
    actionName: string
    fps: number
    loop: boolean
    startFrameIndex: number
    frameCount: number
  }>
}): string {
  const lines: string[] = [
    `[gd_resource type="SpriteFrames" load_steps=${input.frames.length + 2} format=3]`,
    '',
    `[ext_resource type="Texture2D" path="${input.textureResPath}" id="1_atlas"]`,
    ''
  ]

  for (let i = 0; i < input.frames.length; i++) {
    const f = input.frames[i]!
    lines.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]`)
    lines.push('atlas = ExtResource("1_atlas")')
    lines.push(`region = Rect2(${f.atlasX}, ${f.atlasY}, ${f.width}, ${f.height})`)
    lines.push('')
  }

  lines.push('[resource]')
  const animBlocks: string[] = []
  for (const act of input.actions) {
    if (act.frameCount <= 0) continue
    const frameRefs: string[] = []
    for (let i = 0; i < act.frameCount; i++) {
      const gIdx = act.startFrameIndex + i
      frameRefs.push(`{\n"duration": 1.0,\n"texture": SubResource("AtlasTexture_${gIdx}")\n}`)
    }
    animBlocks.push(
      `{\n"frames": [${frameRefs.join(', ')}],\n"loop": ${act.loop ? 'true' : 'false'},\n"name": &"${act.actionName}",\n"speed": ${act.fps.toFixed(1)}\n}`
    )
  }
  lines.push(`animations = [${animBlocks.join(', ')}]`)
  return lines.join('\n') + '\n'
}

// ============================================================================
// 2. Wang-16 (4x4 = 16-Cell) Auto-Tile Terrain Atlas Synthesizer & Godot TileSet
// ============================================================================

export interface Wang16AutoTileSynthesisResult {
  tileWidth: number
  tileHeight: number
  atlasWidth: number
  atlasHeight: number
  atlasRgba: Uint8ClampedArray
  data: Uint8ClampedArray
  cells: AutoTileCellEntry[]
  manifest: AutoTileAtlasManifest
  godotTileSetTres: string
}

/**
 * Generates a secondary transition terrain (e.g., rich dark soil / dungeon stone bed)
 * from a primary terrain tile when the user hasn't connected a separate secondary texture.
 */
export function deriveSecondaryTerrainTileRgba(
  primaryRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Shift sampling coordinates + warm/darken into soil/sub-terrain
      const sx = (x + Math.floor(width / 2)) % width
      const sy = (y + Math.floor(height / 2)) % height
      const sIdx = (sy * width + sx) * 4
      const dIdx = (y * width + x) * 4
      const r = primaryRgba[sIdx] ?? 100
      const g = primaryRgba[sIdx + 1] ?? 100
      const b = primaryRgba[sIdx + 2] ?? 100
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      out[dIdx] = clampByte(luma * 0.42 + r * 0.15 + 22)
      out[dIdx + 1] = clampByte(luma * 0.34 + g * 0.12 + 16)
      out[dIdx + 2] = clampByte(luma * 0.28 + b * 0.1 + 14)
      out[dIdx + 3] = 255
    }
  }
  return out
}

/**
 * Synthesizes a complete 4x4 (16-cell) Wang-16 Auto-Tile Terrain Atlas (`4*tileWidth x 4*tileHeight`).
 * Each cell `index = 0..15` corresponds to the 4-bit cardinal mask `N=1, E=2, S=4, W=8`:
 * - Bit = 1 means connected to primary terrain on that side;
 * - Bit = 0 means exposed border transitioning to secondary terrain with an organic bevel edge.
 */
export function synthesizeWang16AutoTileAtlas(
  primaryRgba: Uint8Array | Uint8ClampedArray,
  tileWidth: number,
  tileHeight: number,
  options?: {
    secondaryRgba?: Uint8Array | Uint8ClampedArray | null
    terrainName?: string
    edgeSoftness?: number
    transitionRatio?: number
    bevelStrength?: number
    edgeBevelStrength?: number
  }
): Wang16AutoTileSynthesisResult {
  const tw = Math.max(8, Math.min(256, Math.round(tileWidth)))
  const th = Math.max(8, Math.min(256, Math.round(tileHeight)))
  const seamlessPrimary = applySeamlessTileBlend(primaryRgba, tw, th, { blendRatio: 0.2 })
  const secondary =
    options?.secondaryRgba && options.secondaryRgba.length >= tw * th * 4
      ? applySeamlessTileBlend(options.secondaryRgba, tw, th, { blendRatio: 0.2 })
      : deriveSecondaryTerrainTileRgba(seamlessPrimary, tw, th)

  const terrainName = (options?.terrainName ?? 'DungeonTerrain').trim() || 'DungeonTerrain'
  const edgeSoftness = clamp(
    Number(options?.edgeSoftness ?? options?.transitionRatio ?? 0.18),
    0.05,
    0.45
  )
  const bevelStrength = clamp(
    Number(options?.bevelStrength ?? options?.edgeBevelStrength ?? 0.35),
    0,
    1
  )

  const manifest = buildAutoTileAtlasManifest({
    terrainName,
    layout: 'wang16',
    tileWidth: tw,
    tileHeight: th
  })

  const atlasWidth = manifest.atlasWidth
  const atlasHeight = manifest.atlasHeight
  const atlasRgba = new Uint8ClampedArray(atlasWidth * atlasHeight * 4)

  for (const cell of manifest.cells) {
    const mask = cell.cardinalMask // N=1, E=2, S=4, W=8
    const hasN = (mask & 1) !== 0
    const hasE = (mask & 2) !== 0
    const hasS = (mask & 4) !== 0
    const hasW = (mask & 8) !== 0

    for (let y = 0; y < th; y++) {
      // Normalized coordinates u, v in [0, 1]
      const v = (y + 0.5) / th
      for (let x = 0; x < tw; x++) {
        const u = (x + 0.5) / tw

        // Distance to any unconnected border (0 at exposed edge, 1 inside)
        const margin = 0.26
        let distFromExposed = 1.0
        if (!hasN) distFromExposed = Math.min(distFromExposed, v / margin)
        if (!hasS) distFromExposed = Math.min(distFromExposed, (1 - v) / margin)
        if (!hasW) distFromExposed = Math.min(distFromExposed, u / margin)
        if (!hasE) distFromExposed = Math.min(distFromExposed, (1 - u) / margin)

        // Corner rounding when two adjacent sides are exposed
        if (!hasN && !hasW) {
          const d = Math.hypot(Math.max(0, margin - u), Math.max(0, margin - v)) / margin
          distFromExposed = Math.min(distFromExposed, 1 - d)
        }
        if (!hasN && !hasE) {
          const d = Math.hypot(Math.max(0, u - (1 - margin)), Math.max(0, margin - v)) / margin
          distFromExposed = Math.min(distFromExposed, 1 - d)
        }
        if (!hasS && !hasW) {
          const d = Math.hypot(Math.max(0, margin - u), Math.max(0, v - (1 - margin))) / margin
          distFromExposed = Math.min(distFromExposed, 1 - d)
        }
        if (!hasS && !hasE) {
          const d =
            Math.hypot(Math.max(0, u - (1 - margin)), Math.max(0, v - (1 - margin))) / margin
          distFromExposed = Math.min(distFromExposed, 1 - d)
        }

        //Isolated tile (mask === 0): small central island
        if (mask === 0) {
          const dCenter = Math.hypot(u - 0.5, v - 0.5) / 0.36
          distFromExposed = clamp(1 - dCenter, 0, 1)
        }

        // Organic deterministic micro-modulation along border
        const wave =
          Math.sin(u * Math.PI * 4) * Math.cos(v * Math.PI * 4) * 0.08 * (1 - distFromExposed)
        const rawWeight = clamp(
          (distFromExposed + wave - 0.35) / Math.max(0.05, edgeSoftness),
          0,
          1
        )
        // Smoothstep blend weight (1 = primary terrain, 0 = secondary transition terrain)
        const w = rawWeight * rawWeight * (3 - 2 * rawWeight)
        // Rim bevel highlight/shadow right on the transition boundary (w around 0.5)
        const rimBand = Math.max(0, 1 - Math.abs(w - 0.55) / 0.28) * bevelStrength
        const lightDir = (!hasN || !hasW ? 1 : -0.65) * rimBand * 38

        const tIdx = (y * tw + x) * 4
        const aIdx = ((cell.y + y) * atlasWidth + (cell.x + x)) * 4

        const pr = seamlessPrimary[tIdx]!
        const pg = seamlessPrimary[tIdx + 1]!
        const pb = seamlessPrimary[tIdx + 2]!

        const sr = secondary[tIdx]!
        const sg = secondary[tIdx + 1]!
        const sb = secondary[tIdx + 2]!

        atlasRgba[aIdx] = clampByte(pr * w + sr * (1 - w) + lightDir)
        atlasRgba[aIdx + 1] = clampByte(pg * w + sg * (1 - w) + lightDir)
        atlasRgba[aIdx + 2] = clampByte(pb * w + sb * (1 - w) + lightDir)
        atlasRgba[aIdx + 3] = 255
      }
    }
  }

  const godotTileSetTres = exportGodotTileSetTres(
    manifest,
    `res://assets/tilesets/${terrainName}_wang16.png`
  )

  return {
    tileWidth: tw,
    tileHeight: th,
    atlasWidth,
    atlasHeight,
    atlasRgba,
    data: atlasRgba,
    cells: manifest.cells,
    manifest,
    godotTileSetTres
  }
}

export function exportGodotTileSetTres(
  manifestOrAtlas: AutoTileAtlasManifest | Wang16AutoTileSynthesisResult,
  textureResPath: string
): string {
  const manifest = 'manifest' in manifestOrAtlas ? manifestOrAtlas.manifest : manifestOrAtlas
  const lines: string[] = [
    '[gd_resource type="TileSet" load_steps=3 format=3]',
    '',
    `[ext_resource type="Texture2D" path="${textureResPath}" id="1_tileset"]`,
    '',
    '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]',
    'texture = ExtResource("1_tileset")',
    `texture_region_size = Vector2i(${manifest.tileWidth}, ${manifest.tileHeight})`
  ]

  for (const cell of manifest.cells) {
    const key = `${cell.col}:${cell.row}/0`
    lines.push(`${key} = 0`)
    lines.push(`${key}/terrain_set = 0`)
    lines.push(`${key}/terrain = 0`)
    if (cell.neighbors.n) lines.push(`${key}/terrains_peering_bit/top_side = 0`)
    if (cell.neighbors.e) lines.push(`${key}/terrains_peering_bit/right_side = 0`)
    if (cell.neighbors.s) lines.push(`${key}/terrains_peering_bit/bottom_side = 0`)
    if (cell.neighbors.w) lines.push(`${key}/terrains_peering_bit/left_side = 0`)
  }

  lines.push('')
  lines.push('[resource]')
  lines.push(`tile_size = Vector2i(${manifest.tileWidth}, ${manifest.tileHeight})`)
  lines.push('terrain_set_0/mode = 2')
  lines.push(`terrain_set_0/terrain_0/name = "${manifest.terrainName}"`)
  lines.push('terrain_set_0/terrain_0/color = Color(0.28, 0.72, 0.48, 1)')
  lines.push('sources/0 = SubResource("TileSetAtlasSource_1")')
  return lines.join('\n') + '\n'
}

// ============================================================================
// 3. Modular Scene Prop Processor (Y-Sort Baseline + Contact Shadow + Footprint Hull)
// ============================================================================

export interface ScenePropProcessResult {
  width: number
  height: number
  rgba: Uint8ClampedArray
  data: Uint8ClampedArray
  /** Y-Sort sorting baseline Y coordinate in pixels (from top of image) */
  ySortBaselineY: number
  /** Normalized Y-Sort pivot `{ x, y }` in 0..1 space */
  ySortPivotNormalized: { x: number; y: number }
  /** Ground contact anchor X coordinate in pixels */
  groundAnchorX: number
  /** Ground footprint rectangle in pixels */
  footprintRect: { x: number; y: number; width: number; height: number }
  /** Rendered ground contact shadow ellipse parameters */
  shadowEllipse: { cx: number; cy: number; rx: number; ry: number }
  /** Ground footprint collision hull result */
  footprintHull: SpriteCollisionHullResult
  /** Ground footprint collision polygon vertices */
  footprintHullPx: Point2D[]
}

/**
 * Processes a scene prop (chest, tree, pillar, barrel, door, statue):
 * - Computes the exact Y-Sort ground contact baseline (`ySortBaselineY`) and `groundAnchorX`;
 * - Renders a soft elliptical ambient-occlusion contact shadow underneath the base;
 * - Extracts a ground-footprint collision hull from the bottom `footprintRatio` (default 38%)
 *   so characters collide with the prop's base while walking naturally behind its upper canopy.
 */
export function processScenePropWithYSortAndShadow(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    shadowOpacity?: number
    footprintRatio?: number
    footprintHeightRatio?: number
    maxHullVertices?: number
  }
): ScenePropProcessResult {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const shadowOpacity = clamp(Number(options?.shadowOpacity ?? 0.42), 0, 0.95)
  const footprintRatio = clamp(
    Number(options?.footprintRatio ?? options?.footprintHeightRatio ?? 0.35),
    0.1,
    1.0
  )

  const bounds = extractAlphaBounds(rgba, w, h, { alphaMin: 16 }) ?? {
    x: Math.floor(w * 0.2),
    y: Math.floor(h * 0.2),
    width: Math.max(1, Math.floor(w * 0.6)),
    height: Math.max(1, Math.floor(h * 0.6))
  }

  const groundAnchorX = Math.round(bounds.x + bounds.width / 2)
  const ySortBaselineY = Math.min(h - 1, bounds.y + bounds.height - 2)
  const rx = Math.max(4, Math.round(bounds.width * 0.46))
  const ry = Math.max(2, Math.round(Math.min(bounds.height * 0.16, h * 0.12)))
  const cy = Math.round(Math.min(h - 1 - ry * 0.4, ySortBaselineY))

  // Render soft elliptical ground contact shadow under the prop's base
  const out = new Uint8ClampedArray(rgba.length)
  out.set(rgba)

  if (shadowOpacity > 0.01) {
    const y0 = Math.max(0, Math.floor(cy - ry))
    const y1 = Math.min(h - 1, Math.ceil(cy + ry))
    const x0 = Math.max(0, Math.floor(groundAnchorX - rx))
    const x1 = Math.min(w - 1, Math.ceil(groundAnchorX + rx))

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - groundAnchorX) / rx
        const dy = (y - cy) / ry
        const d2 = dx * dx + dy * dy
        if (d2 >= 1) continue
        const shadowA = (1 - d2) * (1 - d2) * shadowOpacity
        const idx = (y * w + x) * 4
        const srcA = out[idx + 3]! / 255
        // Alpha-over: prop pixel over shadow pixel
        const outA = srcA + shadowA * (1 - srcA)
        if (outA > 0.001) {
          const scale = srcA / outA
          out[idx] = clampByte(out[idx]! * scale)
          out[idx + 1] = clampByte(out[idx + 1]! * scale)
          out[idx + 2] = clampByte(out[idx + 2]! * scale)
          out[idx + 3] = clampByte(outA * 255)
        }
      }
    }
  }

  // Mask out top (1 - footprintRatio) of the prop to extract only the ground footprint collision hull
  const footprintRgba = new Uint8ClampedArray(rgba.length)
  const cutoffY = Math.floor(bounds.y + bounds.height * (1 - footprintRatio))
  for (let y = cutoffY; y < h; y++) {
    const rowStart = y * w * 4
    footprintRgba.set(rgba.subarray(rowStart, rowStart + w * 4), rowStart)
  }

  const hull = extractSpriteCollisionHull(footprintRgba, w, h, {
    maxVertices: options?.maxHullVertices ?? 8,
    pivotMode: 'bottom_center'
  })

  const footprintRect = {
    x: bounds.x,
    y: cutoffY,
    width: bounds.width,
    height: Math.max(1, bounds.y + bounds.height - cutoffY)
  }

  return {
    width: w,
    height: h,
    rgba: out,
    data: out,
    ySortBaselineY,
    ySortPivotNormalized: {
      x: Number((groundAnchorX / w).toFixed(4)),
      y: Number((ySortBaselineY / h).toFixed(4))
    },
    groundAnchorX,
    footprintRect,
    shadowEllipse: { cx: groundAnchorX, cy, rx, ry },
    footprintHull: hull,
    footprintHullPx: hull.verticesPx
  }
}

// ============================================================================
// 4. UI 4-State Button Generator & 5-Tier Rarity Icon Frame Compositor
// ============================================================================

export type NineSliceStretchMode = 'stretch' | 'tile'

export interface UiButtonFourStatesResult {
  width: number
  height: number
  borders: NineSliceBorders
  nineSlice: NineSliceDetectionResult
  states: {
    normal: Uint8ClampedArray
    hover: Uint8ClampedArray
    pressed: Uint8ClampedArray
    disabled: Uint8ClampedArray
    focused: Uint8ClampedArray
  }
  /** 1x4 vertical strip sheet containing Normal, Hover, Pressed, Disabled */
  sheetRgba: Uint8ClampedArray
  sheetData: Uint8ClampedArray
  /** 1x5 vertical strip sheet containing Normal, Hover, Pressed, Disabled, Focused (Gamepad/Keyboard selection) */
  sheet5StatesRgba: Uint8ClampedArray
  sheetWidth: number
  sheetHeight: number
  godotThemeTres: string
}

/**
 * Generates 5 production UI button states (`normal`, `hover`, `pressed`, `disabled`, `focused`)
 * from a base UI control texture, with optional bilateral symmetry enforcement so
 * 9-slice left/right borders match pixel-for-pixel.
 */
export function generateUiButtonFourStates(
  baseRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    enforceHorizontalSymmetry?: boolean
    symmetricNineSlice?: boolean
    customBorders?: NineSliceBorders
    pressShiftPx?: number
    stretchMode?: NineSliceStretchMode
    resourceName?: string
  }
): UiButtonFourStatesResult {
  const w = Math.max(4, Math.floor(width))
  const h = Math.max(4, Math.floor(height))
  const enforceSymmetry = options?.enforceHorizontalSymmetry ?? options?.symmetricNineSlice ?? true
  const pressShiftPx = Math.max(1, Math.min(4, Math.round(options?.pressShiftPx ?? 2)))

  const normal = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      if (enforceSymmetry && x >= Math.ceil(w / 2)) {
        const mirrorIdx = (y * w + (w - 1 - x)) * 4
        normal[idx] = baseRgba[mirrorIdx]!
        normal[idx + 1] = baseRgba[mirrorIdx + 1]!
        normal[idx + 2] = baseRgba[mirrorIdx + 2]!
        normal[idx + 3] = baseRgba[mirrorIdx + 3]!
      } else {
        normal[idx] = baseRgba[idx]!
        normal[idx + 1] = baseRgba[idx + 1]!
        normal[idx + 2] = baseRgba[idx + 2]!
        normal[idx + 3] = baseRgba[idx + 3]!
      }
    }
  }

  const hover = new Uint8ClampedArray(w * h * 4)
  const pressed = new Uint8ClampedArray(w * h * 4)
  const disabled = new Uint8ClampedArray(w * h * 4)
  const focused = new Uint8ClampedArray(w * h * 4)

  const focusRimW = Math.max(2, Math.round(Math.min(w, h) * 0.08))

  for (let y = 0; y < h; y++) {
    const topHighlight = Math.max(0, 1 - y / Math.max(1, h * 0.45)) * 22
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const r = normal[idx]!
      const g = normal[idx + 1]!
      const b = normal[idx + 2]!
      const a = normal[idx + 3]!

      // Hover: specular lift + top rim highlight
      hover[idx] = clampByte(r * 1.12 + topHighlight)
      hover[idx + 1] = clampByte(g * 1.12 + topHighlight)
      hover[idx + 2] = clampByte(b * 1.14 + topHighlight * 1.1)
      hover[idx + 3] = a

      // Disabled: desaturated luma + reduced alpha
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      disabled[idx] = clampByte(luma * 0.82 + r * 0.12)
      disabled[idx + 1] = clampByte(luma * 0.82 + g * 0.12)
      disabled[idx + 2] = clampByte(luma * 0.85 + b * 0.12)
      disabled[idx + 3] = clampByte(a * 0.72)

      // Focused (Gamepad / Keyboard Navigation Ring): radiant gold/cyan outer focus outline + lifted interior
      const edgeDist = Math.min(x, y, w - 1 - x, h - 1 - y)
      if (edgeDist < focusRimW) {
        const rimFactor = 1 - edgeDist / focusRimW
        focused[idx] = clampByte(r * (1 - rimFactor * 0.65) + 254 * rimFactor)
        focused[idx + 1] = clampByte(g * (1 - rimFactor * 0.65) + 228 * rimFactor)
        focused[idx + 2] = clampByte(b * (1 - rimFactor * 0.65) + 98 * rimFactor)
        focused[idx + 3] = Math.max(a, clampByte(rimFactor * 255))
      } else {
        focused[idx] = clampByte(r * 1.15 + topHighlight * 1.15)
        focused[idx + 1] = clampByte(g * 1.15 + topHighlight * 1.1)
        focused[idx + 2] = clampByte(b * 1.18 + topHighlight * 1.2)
        focused[idx + 3] = a
      }

      // Pressed: shifted down by pressShiftPx + darkened inner bevel
      const srcY = y - pressShiftPx
      if (srcY >= 0 && srcY < h) {
        const sIdx = (srcY * w + x) * 4
        const topShadow = y < pressShiftPx + 3 ? 0.76 : 0.88
        pressed[idx] = clampByte(normal[sIdx]! * topShadow)
        pressed[idx + 1] = clampByte(normal[sIdx + 1]! * topShadow)
        pressed[idx + 2] = clampByte(normal[sIdx + 2]! * topShadow)
        pressed[idx + 3] = normal[sIdx + 3]!
      }
    }
  }

  const sheetWidth = w
  const sheetHeight = h * 4
  const sheetRgba = new Uint8ClampedArray(sheetWidth * sheetHeight * 4)
  const stateArrays = [normal, hover, pressed, disabled]
  for (let s = 0; s < 4; s++) {
    sheetRgba.set(stateArrays[s]!, s * w * h * 4)
  }

  const sheet5StatesRgba = new Uint8ClampedArray(w * h * 5 * 4)
  const fiveStateArrays = [normal, hover, pressed, disabled, focused]
  for (let s = 0; s < 5; s++) {
    sheet5StatesRgba.set(fiveStateArrays[s]!, s * w * h * 4)
  }

  const detected = detectNineSliceBorders(normal, w, h)
  const finalBorders: NineSliceBorders = options?.customBorders
    ? { ...options.customBorders }
    : enforceSymmetry
      ? {
          left: Math.round((detected.borders.left + detected.borders.right) / 2),
          right: Math.round((detected.borders.left + detected.borders.right) / 2),
          top: detected.borders.top,
          bottom: detected.borders.bottom
        }
      : detected.borders
  const nineSlice: NineSliceDetectionResult = {
    ...detected,
    borders: finalBorders,
    centerRect: {
      x: finalBorders.left,
      y: finalBorders.top,
      width: Math.max(1, w - finalBorders.left - finalBorders.right),
      height: Math.max(1, h - finalBorders.top - finalBorders.bottom)
    }
  }
  const resName = (options?.resourceName ?? 'ui_button').trim() || 'ui_button'
  const godotThemeTres = exportGodotUiButtonThemeTres(
    finalBorders,
    resName,
    w,
    h,
    options?.stretchMode ?? 'stretch'
  )

  return {
    width: w,
    height: h,
    borders: finalBorders,
    nineSlice,
    states: { normal, hover, pressed, disabled, focused },
    sheetRgba,
    sheetData: sheetRgba,
    sheet5StatesRgba,
    sheetWidth,
    sheetHeight,
    godotThemeTres
  }
}

export function exportGodotUiButtonThemeTres(
  bordersOrName: NineSliceBorders | string,
  nameOrBorders?: string | NineSliceBorders,
  width = 128,
  height = 48,
  stretchMode: NineSliceStretchMode = 'stretch'
): string {
  const borders: NineSliceBorders =
    typeof bordersOrName === 'string' ? (nameOrBorders as NineSliceBorders) : bordersOrName
  const effectiveStretchMode: NineSliceStretchMode =
    nameOrBorders === 'tile' || stretchMode === 'tile' ? 'tile' : 'stretch'
  const resourceName =
    typeof bordersOrName === 'string'
      ? bordersOrName
      : typeof nameOrBorders === 'string' && nameOrBorders !== 'stretch' && nameOrBorders !== 'tile'
        ? nameOrBorders
        : 'ui_button'
  const states = ['normal', 'hover', 'pressed', 'disabled', 'focus'] as const
  const axisMode = effectiveStretchMode === 'tile' ? 1 : 0
  const lines: string[] = [
    '[gd_resource type="Theme" load_steps=7 format=3]',
    '',
    `[ext_resource type="Texture2D" path="res://assets/ui/${resourceName}_states.png" id="1_tex"]`,
    ''
  ]
  states.forEach((st, idx) => {
    const regionIdx = Math.min(idx, 3)
    lines.push(`[sub_resource type="StyleBoxTexture" id="StyleBox_${st}"]`)
    lines.push('texture = ExtResource("1_tex")')
    lines.push(`region_rect = Rect2(0, ${regionIdx * height}, ${width}, ${height})`)
    lines.push(`texture_margin_left = ${borders.left.toFixed(1)}`)
    lines.push(`texture_margin_top = ${borders.top.toFixed(1)}`)
    lines.push(`texture_margin_right = ${borders.right.toFixed(1)}`)
    lines.push(`texture_margin_bottom = ${borders.bottom.toFixed(1)}`)
    lines.push(`axis_stretch_horizontal = ${axisMode}`)
    lines.push(`axis_stretch_vertical = ${axisMode}`)
    lines.push('')
  })
  lines.push('[resource]')
  for (const st of states) {
    lines.push(`Button/styles/${st} = SubResource("StyleBox_${st}")`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Pure 9-Slice Resizer & Tile/Stretch Compositor (`renderNineSliceResizedRgba`):
 * Preserves the 4 corner regions (`left`, `right`, `top`, `bottom`) at 1:1 pixel ratio while
 * either bilinearly stretching (`'stretch'`) or repeating (`'tile'`) the 4 edge strips and center region
 * to any target dimensions `(dstWidth, dstHeight)`.
 */
export function renderNineSliceResizedRgba(
  srcRgba: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  borders: NineSliceBorders,
  mode: NineSliceStretchMode = 'stretch'
): Uint8ClampedArray {
  const sw = Math.max(4, Math.floor(srcWidth))
  const sh = Math.max(4, Math.floor(srcHeight))
  const dw = Math.max(8, Math.floor(dstWidth))
  const dh = Math.max(8, Math.floor(dstHeight))
  const out = new Uint8ClampedArray(dw * dh * 4)

  const L = clamp(Math.round(borders.left), 1, Math.floor(Math.min(sw, dw) * 0.46))
  const R = clamp(Math.round(borders.right), 1, Math.floor(Math.min(sw, dw) * 0.46))
  const T = clamp(Math.round(borders.top), 1, Math.floor(Math.min(sh, dh) * 0.46))
  const B = clamp(Math.round(borders.bottom), 1, Math.floor(Math.min(sh, dh) * 0.46))

  const srcCenterW = Math.max(1, sw - L - R)
  const srcCenterH = Math.max(1, sh - T - B)
  const dstCenterW = Math.max(1, dw - L - R)
  const dstCenterH = Math.max(1, dh - T - B)

  const mapAxis = (
    dPos: number,
    startM: number,
    endM: number,
    sTotal: number,
    dTotal: number,
    sCenter: number,
    dCenter: number
  ): number => {
    if (dPos < startM) return dPos
    if (dPos >= dTotal - endM) return sTotal - (dTotal - dPos)
    const offset = dPos - startM
    if (mode === 'tile') {
      return startM + (offset % sCenter)
    }
    return (
      startM + Math.min(sCenter - 1, (offset / Math.max(1, dCenter - 1)) * Math.max(0, sCenter - 1))
    )
  }

  for (let dy = 0; dy < dh; dy++) {
    const syFloat = clamp(mapAxis(dy, T, B, sh, dh, srcCenterH, dstCenterH), 0, sh - 1)
    const y0 = Math.floor(syFloat)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = syFloat - y0

    for (let dx = 0; dx < dw; dx++) {
      const sxFloat = clamp(mapAxis(dx, L, R, sw, dw, srcCenterW, dstCenterW), 0, sw - 1)
      const x0 = Math.floor(sxFloat)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = sxFloat - x0

      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4

      const w00 = (1 - wx) * (1 - wy)
      const w10 = wx * (1 - wy)
      const w01 = (1 - wx) * wy
      const w11 = wx * wy

      const dIdx = (dy * dw + dx) * 4
      out[dIdx] = clampByte(
        srcRgba[i00]! * w00 + srcRgba[i10]! * w10 + srcRgba[i01]! * w01 + srcRgba[i11]! * w11
      )
      out[dIdx + 1] = clampByte(
        srcRgba[i00 + 1]! * w00 +
          srcRgba[i10 + 1]! * w10 +
          srcRgba[i01 + 1]! * w01 +
          srcRgba[i11 + 1]! * w11
      )
      out[dIdx + 2] = clampByte(
        srcRgba[i00 + 2]! * w00 +
          srcRgba[i10 + 2]! * w10 +
          srcRgba[i01 + 2]! * w01 +
          srcRgba[i11 + 2]! * w11
      )
      out[dIdx + 3] = clampByte(
        srcRgba[i00 + 3]! * w00 +
          srcRgba[i10 + 3]! * w10 +
          srcRgba[i01 + 3]! * w01 +
          srcRgba[i11 + 3]! * w11
      )
    }
  }

  return out
}

export type GameItemRarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export type IconRarityTier = GameItemRarityTier

export interface RarityFrameCompositeResult {
  width: number
  height: number
  rarity: GameItemRarityTier
  rgba: Uint8ClampedArray
  data: Uint8ClampedArray
}

export const RARITY_TIER_COLORS: Record<
  GameItemRarityTier,
  { border: [number, number, number]; glow: [number, number, number]; bg: [number, number, number] }
> = {
  common: { border: [148, 163, 184], glow: [203, 213, 225], bg: [30, 41, 59] },
  uncommon: { border: [34, 197, 94], glow: [134, 239, 172], bg: [20, 52, 43] },
  rare: { border: [56, 189, 248], glow: [125, 211, 252], bg: [18, 42, 74] },
  epic: { border: [192, 132, 252], glow: [233, 213, 255], bg: [46, 24, 78] },
  legendary: { border: [251, 191, 36], glow: [254, 240, 138], bg: [68, 36, 18] }
}

/**
 * Composites an item/skill icon onto a standardized square Rarity Frame
 * (`common` / `uncommon` / `rare` / `epic` / `legendary`) with radial inner glow,
 * beveled metallic border, and corner gem accents.
 */
export function compositeIconWithRarityFrame(
  iconRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  rarity: GameItemRarityTier = 'legendary',
  options?: { borderWidthPx?: number }
): RarityFrameCompositeResult {
  const w = Math.max(8, Math.floor(width))
  const h = Math.max(8, Math.floor(height))
  const out = new Uint8ClampedArray(w * h * 4)
  const theme = RARITY_TIER_COLORS[rarity] ?? RARITY_TIER_COLORS.legendary
  const borderW = Math.max(
    2,
    Math.min(Math.floor(Math.min(w, h) * 0.16), Math.round(options?.borderWidthPx ?? w * 0.08))
  )

  for (let y = 0; y < h; y++) {
    const ny = (y - h / 2) / (h / 2)
    for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2)
      const idx = (y * w + x) * 4

      const distEdge = Math.min(x, y, w - 1 - x, h - 1 - y)
      const isCornerGem =
        distEdge < borderW * 1.45 &&
        ((x < borderW * 2 && y < borderW * 2) ||
          (x >= w - borderW * 2 && y < borderW * 2) ||
          (x < borderW * 2 && y >= h - borderW * 2) ||
          (x >= w - borderW * 2 && y >= h - borderW * 2))

      if (distEdge < borderW) {
        // Beveled metallic rarity border
        const bevel = x + y < (w + h) / 2 ? 1.18 : 0.78
        const srcColor = isCornerGem ? theme.glow : theme.border
        out[idx] = clampByte(srcColor[0] * bevel)
        out[idx + 1] = clampByte(srcColor[1] * bevel)
        out[idx + 2] = clampByte(srcColor[2] * bevel)
        out[idx + 3] = 255
        continue
      }

      // Inner dark vignette + radial rarity glow
      const rad = Math.min(1, Math.hypot(nx, ny))
      const glowFactor = Math.max(0, 1 - rad * 0.95) * 0.38
      const bgR = theme.bg[0] + theme.border[0] * glowFactor
      const bgG = theme.bg[1] + theme.border[1] * glowFactor
      const bgB = theme.bg[2] + theme.border[2] * glowFactor

      const sR = iconRgba[idx]!
      const sG = iconRgba[idx + 1]!
      const sB = iconRgba[idx + 2]!
      const sA = iconRgba[idx + 3]! / 255

      out[idx] = clampByte(sR * sA + bgR * (1 - sA))
      out[idx + 1] = clampByte(sG * sA + bgG * (1 - sA))
      out[idx + 2] = clampByte(sB * sA + bgB * (1 - sA))
      out[idx + 3] = 255
    }
  }
  return {
    width: w,
    height: h,
    rarity,
    rgba: out,
    data: out
  }
}

// ============================================================================
// 5. 2D VFX Professional Studio: Black-to-Alpha Demult, Thermal Color Ramp,
//    HDR Soft Bloom, Safe Border Guard, Flipbook Lifecycle & Channel Packing
// ============================================================================

export type VfxProductionMode =
  'vfx_flipbook' | 'vfx_demult' | 'vfx_trail_ribbon' | 'vfx_channel_pack'

export type VfxArchetypePreset =
  'slash_arc' | 'fire_explosion' | 'arcane_vortex' | 'lightning_burst' | 'heal_aura' | 'poison_nova'

export type VfxElementalPalette =
  | 'original'
  | 'solar_fire'
  | 'arcane_cyan'
  | 'void_purple'
  | 'fel_emerald'
  | 'holy_gold'
  | 'blood_crimson'

export const VFX_ELEMENTAL_PALETTES: Record<
  Exclude<VfxElementalPalette, 'original'>,
  { edge: [number, number, number]; mid: [number, number, number]; core: [number, number, number] }
> = {
  solar_fire: {
    edge: [188, 28, 12],
    mid: [255, 138, 18],
    core: [255, 250, 198]
  },
  arcane_cyan: {
    edge: [16, 82, 198],
    mid: [38, 214, 255],
    core: [228, 253, 255]
  },
  void_purple: {
    edge: [72, 14, 136],
    mid: [186, 68, 255],
    core: [246, 218, 255]
  },
  fel_emerald: {
    edge: [14, 114, 42],
    mid: [72, 245, 96],
    core: [230, 255, 198]
  },
  holy_gold: {
    edge: [176, 112, 18],
    mid: [255, 208, 64],
    core: [255, 255, 236]
  },
  blood_crimson: {
    edge: [104, 8, 24],
    mid: [238, 28, 58],
    core: [255, 198, 212]
  }
}

export function remapVfxThermalColor(
  energyNorm: number,
  palette: Exclude<VfxElementalPalette, 'original'>
): [number, number, number] {
  const ramp = VFX_ELEMENTAL_PALETTES[palette] ?? VFX_ELEMENTAL_PALETTES.solar_fire
  const t = clamp(energyNorm, 0, 1)
  if (t < 0.55) {
    const k = t / 0.55
    return [
      clampByte(ramp.edge[0] + (ramp.mid[0] - ramp.edge[0]) * k),
      clampByte(ramp.edge[1] + (ramp.mid[1] - ramp.edge[1]) * k),
      clampByte(ramp.edge[2] + (ramp.mid[2] - ramp.edge[2]) * k)
    ]
  }
  const k = (t - 0.55) / 0.45
  return [
    clampByte(ramp.mid[0] + (ramp.core[0] - ramp.mid[0]) * k),
    clampByte(ramp.mid[1] + (ramp.core[1] - ramp.mid[1]) * k),
    clampByte(ramp.mid[2] + (ramp.core[2] - ramp.mid[2]) * k)
  ]
}

function vfxProceduralNoise2D(x: number, y: number, seed = 1337): number {
  const hash = (ix: number, iy: number): number => {
    const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 17.3) * 43758.5453
    return n - Math.floor(n)
  }
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

function vfxFbmNoise2D(nx: number, ny: number, seed = 1337): number {
  return (
    0.58 * vfxProceduralNoise2D(nx * 5.0, ny * 5.0, seed) +
    0.28 * vfxProceduralNoise2D(nx * 11.0, ny * 11.0, seed + 31) +
    0.14 * vfxProceduralNoise2D(nx * 23.0, ny * 23.0, seed + 79)
  )
}

export interface VfxDemultOptions {
  /** Luminance/chroma threshold below which background is clipped to 0 alpha (0..0.35, default 0.05) */
  blackClip?: number
  /** Signal level at which alpha reaches 1.0 (0.3..1.0, default 0.85) */
  whitePoint?: number
  /** Gamma curve for semi-transparent glow falloff (0.4..2.2, default 0.85) */
  gamma?: number
  /** Color saturation recovery boost on semi-transparent edges (1.0..2.0, default 1.2) */
  colorBoost?: number
  /** Optional thermal color ramp re-theming ('original' keeps source hue) */
  palette?: VfxElementalPalette
  /** Optional soft HDR Gaussian bloom intensity (0..1.5, default 0) */
  bloomStrength?: number
  /** Optional safe border feathering margin (0..0.35, default 0) to prevent quad edge clipping */
  edgeFeather?: number
  /** Optional noise erosion amount (0..1.0, default 0) for ember/dissolve breakup */
  dissolveErosion?: number
}

export interface VfxDemultResult {
  width: number
  height: number
  rgba: Uint8ClampedArray
  data: Uint8ClampedArray
  transparentRatio: number
  peakAlpha: number
}

/**
 * Converts a black/dark-background VFX image or sprite sheet (fire, slash, magic circle, laser, sparks)
 * into a clean unpremultiplied RGBA texture with linear semi-transparent glow alpha, zero black halos,
 * optional thermal color-ramp remapping, soft HDR bloom, and quad-border feather guard.
 */
export function extractVfxLuminanceAlpha(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: VfxDemultOptions
): VfxDemultResult {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const out = new Uint8ClampedArray(w * h * 4)

  const blackClip = clamp(Number(options?.blackClip ?? 0.05), 0, 0.45)
  const whitePoint = clamp(Number(options?.whitePoint ?? 0.85), blackClip + 0.1, 1.0)
  const gamma = clamp(Number(options?.gamma ?? 0.85), 0.35, 2.5)
  const colorBoost = clamp(Number(options?.colorBoost ?? 1.2), 1.0, 2.5)
  const palette: VfxElementalPalette = options?.palette ?? 'original'
  const bloomStrength = clamp(Number(options?.bloomStrength ?? 0), 0, 1.5)
  const edgeFeather = clamp(Number(options?.edgeFeather ?? 0), 0, 0.42)
  const dissolveErosion = clamp(Number(options?.dissolveErosion ?? 0), 0, 0.98)

  // Estimate dark floor from the 4 corners
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4]
  let bgR = 0
  let bgG = 0
  let bgB = 0
  for (const cIdx of corners) {
    bgR += (rgba[cIdx] ?? 0) / 4
    bgG += (rgba[cIdx + 1] ?? 0) / 4
    bgB += (rgba[cIdx + 2] ?? 0) / 4
  }
  // Only subtract corner floor if it is actually a dark background (< 64 luma)
  const bgLuma = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB
  if (bgLuma > 64) {
    bgR = 0
    bgG = 0
    bgB = 0
  }

  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const i = (y * w + x) * 4
      const srcA = (rgba[i + 3] ?? 255) / 255
      if (srcA <= 0.004) continue

      const r = Math.max(0, (rgba[i]! - bgR) / 255)
      const g = Math.max(0, (rgba[i + 1]! - bgG) / 255)
      const b = Math.max(0, (rgba[i + 2]! - bgB) / 255)

      // Screen/Max-channel optical energy
      const maxCh = Math.max(r, g, b)
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const energy = Math.max(maxCh, luma)

      if (energy <= blackClip) {
        out[i + 3] = 0
        continue
      }

      const norm = clamp((energy - blackClip) / (whitePoint - blackClip), 0, 1)
      let alpha = clamp(Math.pow(norm, gamma) * srcA, 0, 1)

      if (dissolveErosion > 0.005) {
        const noiseVal = vfxFbmNoise2D(nx, ny, 911)
        const threshold = dissolveErosion * 0.78
        const eroded = clamp(
          (alpha - threshold * (0.45 + 0.55 * noiseVal)) / Math.max(0.12, 1 - threshold),
          0,
          1
        )
        alpha = eroded
      }

      if (edgeFeather > 0.005) {
        const distBorder = Math.min(nx, 1 - nx, ny, 1 - ny)
        if (distBorder < edgeFeather) {
          const borderFactor = clamp(distBorder / edgeFeather, 0, 1)
          alpha *= borderFactor * borderFactor * (3 - 2 * borderFactor)
        }
      }

      if (alpha <= 0.004) {
        out[i + 3] = 0
        continue
      }

      if (palette !== 'original') {
        const [pr, pg, pb] = remapVfxThermalColor(norm, palette)
        out[i] = pr
        out[i + 1] = pg
        out[i + 2] = pb
        out[i + 3] = clampByte(alpha * 255)
      } else {
        // Unpremultiply RGB by maxCh so semi-transparent glow edges retain full color saturation
        const denom = Math.max(0.08, maxCh)
        const ur = clamp((r / denom) * colorBoost, 0, 1)
        const ug = clamp((g / denom) * colorBoost, 0, 1)
        const ub = clamp((b / denom) * colorBoost, 0, 1)

        // Blend between unpremultiplied edge color and core highlight color
        const coreMix = norm * norm
        out[i] = clampByte((ur * (1 - coreMix) + r * coreMix) * 255)
        out[i + 1] = clampByte((ug * (1 - coreMix) + g * coreMix) * 255)
        out[i + 2] = clampByte((ub * (1 - coreMix) + b * coreMix) * 255)
        out[i + 3] = clampByte(alpha * 255)
      }
    }
  }

  // Optional soft HDR bloom pass (separable box/tent blur over high-energy core pixels)
  if (bloomStrength > 0.01 && w >= 8 && h >= 8) {
    const radius = Math.max(2, Math.min(6, Math.round(Math.min(w, h) * 0.05)))
    const bloomBuf = new Float32Array(w * h * 4)
    const tmpBuf = new Float32Array(w * h * 4)

    // Horizontal blur of premultiplied bright pixels
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sumR = 0
        let sumG = 0
        let sumB = 0
        let sumA = 0
        let wSum = 0
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = clamp(x + dx, 0, w - 1)
          const wt = radius + 1 - Math.abs(dx)
          const idx = (y * w + sx) * 4
          const a = out[idx + 3]! / 255
          sumR += out[idx]! * a * wt
          sumG += out[idx + 1]! * a * wt
          sumB += out[idx + 2]! * a * wt
          sumA += a * wt
          wSum += wt
        }
        const oIdx = (y * w + x) * 4
        tmpBuf[oIdx] = sumR / wSum
        tmpBuf[oIdx + 1] = sumG / wSum
        tmpBuf[oIdx + 2] = sumB / wSum
        tmpBuf[oIdx + 3] = sumA / wSum
      }
    }

    // Vertical blur + additive/screen composite back onto out
    for (let y = 0; y < h; y++) {
      const ny = y / Math.max(1, h - 1)
      for (let x = 0; x < w; x++) {
        const nx = x / Math.max(1, w - 1)
        let sumR = 0
        let sumG = 0
        let sumB = 0
        let sumA = 0
        let wSum = 0
        for (let dy = -radius; dy <= radius; dy++) {
          const sy = clamp(y + dy, 0, h - 1)
          const wt = radius + 1 - Math.abs(dy)
          const idx = (sy * w + x) * 4
          sumR += tmpBuf[idx]! * wt
          sumG += tmpBuf[idx + 1]! * wt
          sumB += tmpBuf[idx + 2]! * wt
          sumA += tmpBuf[idx + 3]! * wt
          wSum += wt
        }
        const oIdx = (y * w + x) * 4
        let bA = (sumA / wSum) * bloomStrength * 0.72
        if (edgeFeather > 0.005) {
          const distBorder = Math.min(nx, 1 - nx, ny, 1 - ny)
          if (distBorder < edgeFeather) {
            const bf = clamp(distBorder / edgeFeather, 0, 1)
            bA *= bf * bf
          }
        }
        bloomBuf[oIdx] = sumR / wSum
        bloomBuf[oIdx + 1] = sumG / wSum
        bloomBuf[oIdx + 2] = sumB / wSum
        bloomBuf[oIdx + 3] = bA

        const baseA = out[oIdx + 3]! / 255
        const finalA = clamp(baseA + bA * (1 - baseA * 0.65), 0, 1)
        if (finalA > 0.004) {
          const bScale = bloomStrength * 0.55
          const unpremB_R = sumA > 0.01 ? sumR / sumA : 0
          const unpremB_G = sumA > 0.01 ? sumG / sumA : 0
          const unpremB_B = sumA > 0.01 ? sumB / sumA : 0
          out[oIdx] = clampByte(
            (out[oIdx]! * baseA + unpremB_R * bA * bScale) / Math.max(0.05, finalA)
          )
          out[oIdx + 1] = clampByte(
            (out[oIdx + 1]! * baseA + unpremB_G * bA * bScale) / Math.max(0.05, finalA)
          )
          out[oIdx + 2] = clampByte(
            (out[oIdx + 2]! * baseA + unpremB_B * bA * bScale) / Math.max(0.05, finalA)
          )
          out[oIdx + 3] = clampByte(finalA * 255)
        }
      }
    }
  }

  let transparentPixels = 0
  let peakAlpha = 0
  const totalPixels = w * h
  for (let i = 3; i < out.length; i += 4) {
    const a = out[i]!
    if (a <= 4) transparentPixels++
    if (a > peakAlpha) peakAlpha = a
  }

  return {
    width: w,
    height: h,
    rgba: out,
    data: out,
    transparentRatio: Number((transparentPixels / Math.max(1, totalPixels)).toFixed(4)),
    peakAlpha
  }
}

export interface VfxFlipbookPipelineOptions extends VfxDemultOptions {
  /** Number of lifecycle frames to synthesize (4 = 2x2, 8 = 4x2, 16 = 4x4, default 8) */
  frameCount?: number
  /** Playback frame rate (6..30, default 14) */
  fps?: number
  /** 2D Curl-noise fluid advection & rotational vortex shear intensity (0..1.5, default 0.65) */
  turbulence?: number
  /** Secondary physics sparks sub-emitter count (0..80, default 36) */
  sparkCount?: number
  /** Screen-space shockwave & heat-haze refraction normal strength (0..1.5, default 0.55) */
  distortionStrength?: number
  /** Resource identifier for exported Godot .tres / .tscn / .gdshader */
  resourceName?: string
}

export interface VfxFlipbookPipelineResult {
  frameWidth: number
  frameHeight: number
  frameCount: number
  cols: number
  rows: number
  fps: number
  sheetWidth: number
  sheetHeight: number
  /** Sprite sheet RGBA containing all lifecycle frames (`Anticipation -> Impact -> Curl Advection & Blackbody Cooling`) */
  sheetRgba: Uint8ClampedArray
  /** Individual frames RGBA for live canvas playback */
  framesRgba: Uint8ClampedArray[]
  /** Peak Hero Impact frame (unpremultiplied + bloomed + color-graded) */
  peakFrameRgba: Uint8ClampedArray
  /** Industry-standard 4-channel Uber VFX Mask (`R=Core`, `G=DissolveNoise`, `B=FlowUV`, `A=Alpha`) */
  channelPackedRgba: Uint8ClampedArray
  /** Screen-space Shockwave & Heat-Haze Refraction Normal Map (`R=nx, G=ny, B=nz, A=refractionMask`) */
  distortionNormalRgba: Uint8ClampedArray
  /** Inter-frame 2D Optical Flow Motion Vector Map (`R=vx, G=vy, B=speedMag, A=255`) for sub-frame slow-motion interpolation */
  flowMotionVectorsRgba: Uint8ClampedArray
  /** Per-frame pixel-space 2D velocity field `[vx, vy]` for live Bullet-Time Optical Flow Frame Blending */
  framesFlowVectors: Float32Array[]
  /** Layer 5 Ground Scorch & Glowing Elemental Fissure Decal (`VFX_Scorch_Decal`) */
  scorchDecalRgba: Uint8ClampedArray
  /** Seamless horizontal UV-scrolling weapon trail / energy beam ribbon texture */
  ribbonTrailRgba: Uint8ClampedArray
  transparentRatio: number
  peakAlpha: number
  godotSpriteFramesTres: string
  godotVfxShader: string
  /** Complete Godot 4 5-Layer Composite VFX Prefab Scene (.tscn) */
  godotVfxPrefabTscn: string
  /** Complete Unity 5-Layer ParticleSystem + SubEmitters Prefab Manifest (.json) */
  unityParticleJson: string
}

/**
 * Bidirectional Optical-Flow Sub-Frame Interpolation (`0 <= subPhase <= 1`):
 * Advects `frameA` forward along `(vx, vy) * subPhase` and `frameB` backward along `-(vx, vy) * (1 - subPhase)`,
 * eliminating frame-stepping and ghosting during 0.1x ~ 0.5x Bullet-Time slow motion.
 */
export function blendVfxFramesOpticalFlow(
  frameA: Uint8ClampedArray,
  frameB: Uint8ClampedArray,
  flowVecs: Float32Array | undefined,
  width: number,
  height: number,
  subPhase: number
): Uint8ClampedArray {
  const t = clamp(subPhase, 0, 1)
  if (t <= 0.005 || !flowVecs) return frameA
  if (t >= 0.995) return frameB
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x
      const vx = flowVecs[pIdx * 2] ?? 0
      const vy = flowVecs[pIdx * 2 + 1] ?? 0
      // Forward sample from frameA (pulling from x - vx * t) and backward sample from frameB (pulling from x + vx * (1 - t))
      const [rA, gA, bA, aA] = sampleRgbaBilinear(frameA, width, height, x - vx * t, y - vy * t)
      const [rB, gB, bB, aB] = sampleRgbaBilinear(
        frameB,
        width,
        height,
        x + vx * (1 - t),
        y + vy * (1 - t)
      )
      const dstIdx = pIdx * 4
      const aMix = aA * (1 - t) + aB * t
      if (aMix <= 0.002) {
        out[dstIdx] = 0
        out[dstIdx + 1] = 0
        out[dstIdx + 2] = 0
        out[dstIdx + 3] = 0
      } else {
        const wA = aA * (1 - t)
        const wB = aB * t
        const wSum = Math.max(0.001, wA + wB)
        out[dstIdx] = clampByte((rA * wA + rB * wB) / wSum)
        out[dstIdx + 1] = clampByte((gA * wA + gB * wB) / wSum)
        out[dstIdx + 2] = clampByte((bA * wA + bB * wB) / wSum)
        out[dstIdx + 3] = clampByte(aMix * 255)
      }
    }
  }
  return out
}

function vfxCurlVelocity2D(nx: number, ny: number, seed = 1337): [number, number] {
  const eps = 0.025
  const dPsiDy = (vfxFbmNoise2D(nx, ny + eps, seed) - vfxFbmNoise2D(nx, ny - eps, seed)) / (2 * eps)
  const dPsiDx = (vfxFbmNoise2D(nx + eps, ny, seed) - vfxFbmNoise2D(nx - eps, ny, seed)) / (2 * eps)
  return [dPsiDy, -dPsiDx]
}

function sampleRgbaBilinear(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  fx: number,
  fy: number
): [number, number, number, number] {
  if (fx < 0 || fx > w - 1 || fy < 0 || fy > h - 1) return [0, 0, 0, 0]
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0

  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4

  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty

  return [
    buf[i00]! * w00 + buf[i10]! * w10 + buf[i01]! * w01 + buf[i11]! * w11,
    buf[i00 + 1]! * w00 + buf[i10 + 1]! * w10 + buf[i01 + 1]! * w01 + buf[i11 + 1]! * w11,
    buf[i00 + 2]! * w00 + buf[i10 + 2]! * w10 + buf[i01 + 2]! * w01 + buf[i11 + 2]! * w11,
    (buf[i00 + 3]! * w00 + buf[i10 + 3]! * w10 + buf[i01 + 3]! * w01 + buf[i11 + 3]! * w11) / 255
  ]
}

/**
 * Full professional Engine-Grade 2D VFX pipeline:
 * 1. Unpremultiplies, color-ramps, and blooms the source/procedural VFX keyframe;
 * 2. Synthesizes a multi-frame lifecycle Flipbook Sprite Sheet using Divergence-Free 2D Curl-Noise Fluid Advection,
 *    Rotational Vortex Shear, Upward Thermal Buoyancy, Anamorphic Impact Flash, and Blackbody Radiation Cooling;
 * 3. Generates an Uber VFX 4-Channel Packed Texture (`R=Core, G=DissolveNoise, B=FlowUV, A=Alpha`);
 * 4. Generates a Screen-Space Shockwave & Heat-Haze Refraction Normal Map (`VFX_Distortion_Normal`);
 * 5. Generates a horizontal UV-Scrolling Weapon Trail / Beam Ribbon texture;
 * 6. Exports Godot 4 `SpriteFrames.tres`, `canvas_item` `.gdshader`, 4-Layer Composite VFX `.tscn`, and Unity Particle Prefab `.json`.
 */
export function synthesizeVfxFlipbookPipeline(
  rawRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: VfxFlipbookPipelineOptions
): VfxFlipbookPipelineResult {
  const fw = Math.max(8, Math.floor(width))
  const fh = Math.max(8, Math.floor(height))
  const rawFrameCount = Number(options?.frameCount ?? 8)
  const frameCount = rawFrameCount <= 4 ? 4 : rawFrameCount >= 16 ? 16 : 8
  const cols = frameCount === 4 ? 2 : 4
  const rows = frameCount / cols
  const fps = clamp(Math.round(Number(options?.fps ?? 14)), 4, 60)
  const palette: VfxElementalPalette = options?.palette ?? 'original'
  const baseErosion = clamp(Number(options?.dissolveErosion ?? 0.35), 0, 1.0)
  const edgeFeather = clamp(Number(options?.edgeFeather ?? 0.12), 0.02, 0.38)
  const turbulence = clamp(Number(options?.turbulence ?? 0.65), 0, 1.5)
  const sparkCount = clamp(Math.round(Number(options?.sparkCount ?? 36)), 0, 120)
  const distortionStrength = clamp(Number(options?.distortionStrength ?? 0.55), 0, 1.5)

  // Hero impact frame (cleanly unpremultiplied + bloomed)
  const heroRes = extractVfxLuminanceAlpha(rawRgba, fw, fh, {
    ...options,
    edgeFeather,
    dissolveErosion: 0
  })
  const peakFrameRgba = heroRes.rgba

  const sheetWidth = fw * cols
  const sheetHeight = fh * rows
  const sheetRgba = new Uint8ClampedArray(sheetWidth * sheetHeight * 4)
  const framesRgba: Uint8ClampedArray[] = []
  const framesFlowVectors: Float32Array[] = []
  const flowMotionVectorsRgba = new Uint8ClampedArray(fw * fh * 4)
  const scorchDecalRgba = new Uint8ClampedArray(fw * fh * 4)

  const cx = fw * 0.5
  const cy = fh * 0.5
  const maxR = Math.min(fw, fh) * 0.46
  const dtStep = 1 / Math.max(1, frameCount - 1)

  for (let f = 0; f < frameCount; f++) {
    // Normalized lifecycle time t in [0, 1]
    const t = frameCount > 1 ? f / (frameCount - 1) : 0.25
    const frameBuf = new Uint8ClampedArray(fw * fh * 4)
    const flowBuf = new Float32Array(fw * fh * 2)

    // Lifecycle dynamics:
    // t = 0.00..0.20: Anticipation & Impact Flash (compressed core + anamorphic star burst)
    // t = 0.20..0.44: Peak Expansion & Shockwave Ring
    // t = 0.44..1.00: Curl-Noise Fluid Advection + Upward Thermal Buoyancy + Blackbody Cooling + 2.5D Lit Smoke + Ember Erosion
    let scale = 1.0
    let erosionThreshold = 0
    let shockwaveRadius = -1
    let shockwaveStrength = 0
    let impactFlashGain = 0
    let blackbodyCooling = 0
    let advectionPhase = 0
    let alphaGain = 1.0

    if (t < 0.22) {
      const k = t / 0.22
      scale = 0.58 + 0.42 * k
      impactFlashGain = Math.sin(k * Math.PI) * 0.85
      alphaGain = 0.82 + 0.18 * k
    } else if (t < 0.45) {
      const k = (t - 0.22) / 0.23
      scale = 1.0 + 0.1 * k
      shockwaveRadius = (0.34 + 0.56 * k) * maxR
      shockwaveStrength = (1 - k * 0.6) * 0.62
      impactFlashGain = Math.max(0, (1 - k * 1.8) * 0.45)
      advectionPhase = k * 0.35
      erosionThreshold = k * 0.14 * (0.5 + baseErosion)
    } else {
      const k = (t - 0.45) / 0.55
      scale = 1.1 + 0.24 * k
      advectionPhase = 0.35 + k * 0.95
      blackbodyCooling = k * 0.68
      erosionThreshold = (0.14 + k * 0.84) * (0.45 + 0.55 * baseErosion)
      alphaGain = Math.max(0, 1 - Math.pow(k, 1.65))
    }

    for (let y = 0; y < fh; y++) {
      const ny = y / Math.max(1, fh - 1)
      for (let x = 0; x < fw; x++) {
        const nx = x / Math.max(1, fw - 1)
        const dx = x - cx
        const dy = y - cy
        const dist = Math.hypot(dx, dy)
        const normDist = dist / Math.max(1, maxR)

        // 1. Compute Semi-Lagrangian Backward Advection Coordinates:
        //    - Rotational vortex shear (inner core swirls faster than outer edge)
        //    - Upward thermal buoyancy (hot plumes rise in -Y)
        //    - Divergence-free 2D curl-noise turbulence
        const swirlAngle = advectionPhase * turbulence * 0.55 * Math.max(0, 1 - normDist * 0.85)
        const cosA = Math.cos(-swirlAngle)
        const sinA = Math.sin(-swirlAngle)
        const rotDx = dx * cosA - dy * sinA
        const rotDy = dx * sinA + dy * cosA

        const [curlVx, curlVy] =
          advectionPhase > 0.01 && turbulence > 0.01
            ? vfxCurlVelocity2D(nx * 1.35 + f * 0.06, ny * 1.35 - f * 0.05, 613)
            : [0, 0]
        const dispMag = advectionPhase * turbulence * maxR * 0.26
        // Upward thermal buoyancy pulls samples from lower (+Y) coordinates so flames rise upward (-Y)
        const buoyancyShiftY =
          advectionPhase * turbulence * maxR * 0.16 * Math.max(0, 1 - normDist * 0.6)

        const sx = cx + (rotDx - curlVx * dispMag) / Math.max(0.25, scale)
        const sy = cy + (rotDy - curlVy * dispMag + buoyancyShiftY) / Math.max(0.25, scale)
        const dstIdx = (y * fw + x) * 4
        const pIdx = y * fw + x

        // Record inter-frame optical flow velocity (pixels/frame) for Bullet-Time sub-frame blending
        const instVx = (dx * 0.18 + curlVx * maxR * 0.24 * Math.max(0.2, turbulence)) * dtStep * 1.8
        const instVy =
          (dy * 0.18 + curlVy * maxR * 0.24 - maxR * 0.14) *
          Math.max(0.2, turbulence) *
          dtStep *
          1.8
        flowBuf[pIdx * 2] = instVx
        flowBuf[pIdx * 2 + 1] = instVy

        let [r, g, b, a] = sampleRgbaBilinear(peakFrameRgba, fw, fh, sx, sy)

        // 2. Blackbody Radiation Thermal Cooling + 2.5D Volumetric Lit Smoke Self-Illumination:
        //    Outer cooling smoke clouds transition to dark soot while their inner walls facing (cx, cy)
        //    catch warm 2.5D firelight from the glowing core!
        if (blackbodyCooling > 0.02 && a > 0.01) {
          const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
          const cooledEnergy = clamp(luma * (1 - blackbodyCooling * (1 - luma * 0.45)), 0, 1)
          const activeRamp: Exclude<VfxElementalPalette, 'original'> =
            palette !== 'original' ? palette : 'solar_fire'
          const [cr, cg, cb] = remapVfxThermalColor(cooledEnergy, activeRamp)

          // 2.5D Smoke Inner-Rim Illumination: sample density slightly closer to explosion center (cx, cy)
          const toCenterX = dist > 0.5 ? -dx / dist : 0
          const toCenterY = dist > 0.5 ? -dy / dist : 0
          const [, , , innerA] = sampleRgbaBilinear(
            peakFrameRgba,
            fw,
            fh,
            sx + toCenterX * 2.2,
            sy + toCenterY * 2.2
          )
          // Positive inward density gradient + proximity to core = warm inner rim light on dark smoke
          const smokeRimLight =
            clamp((innerA - a * 0.72) * 1.6 + Math.max(0, 1 - normDist * 1.15) * 0.45, 0, 1) *
            blackbodyCooling
          const [rimR, rimG, rimB] = remapVfxThermalColor(0.78, activeRamp)
          // Outer smoke cools to dark charcoal soot (24, 22, 28) while inner wall glows with rimR/G/B
          const sootBlend = clamp(blackbodyCooling * (1 - luma * 0.7) * 0.65, 0, 0.75)
          const coolBlend = clamp(blackbodyCooling * 0.85, 0, 0.9)
          r = r * (1 - coolBlend) + cr * coolBlend
          g = g * (1 - coolBlend) + cg * coolBlend
          b = b * (1 - coolBlend) + cb * coolBlend
          r = r * (1 - sootBlend) + 26 * sootBlend + rimR * smokeRimLight * 0.42
          g = g * (1 - sootBlend) + 24 * sootBlend + rimG * smokeRimLight * 0.42
          b = b * (1 - sootBlend) + 30 * sootBlend + rimB * smokeRimLight * 0.42
        }

        // 3. Layer 1 Composite: Anamorphic Impact Cross-Star Flash on early frames
        if (impactFlashGain > 0.01 && normDist < 0.95) {
          const horizRay =
            Math.max(0, 1 - Math.abs(dy) / (maxR * 0.09)) *
            Math.max(0, 1 - Math.abs(dx) / (maxR * 0.88))
          const vertRay =
            Math.max(0, 1 - Math.abs(dx) / (maxR * 0.09)) *
            Math.max(0, 1 - Math.abs(dy) / (maxR * 0.72))
          const coreFlash = Math.pow(Math.max(0, 1 - normDist * 1.45), 2.2)
          const starA = clamp(
            (Math.max(horizRay, vertRay) * 0.85 + coreFlash) * impactFlashGain,
            0,
            1
          )
          if (starA > 0.005) {
            const newA = clamp(a + starA * (1 - a), 0, 1)
            r = clampByte((r * a + 255 * starA) / newA)
            g = clampByte((g * a + 252 * starA) / newA)
            b = clampByte((b * a + 235 * starA) / newA)
            a = newA
          }
        }

        // 4. Expanding Shockwave Ring during Impact phase
        if (shockwaveRadius > 0 && shockwaveStrength > 0) {
          const ringWidth = Math.max(2, maxR * 0.14)
          const ringFactor = Math.max(0, 1 - Math.abs(dist - shockwaveRadius) / ringWidth)
          if (ringFactor > 0) {
            const ringA = ringFactor * ringFactor * shockwaveStrength
            const [rr, rg, rb] =
              palette !== 'original' ? remapVfxThermalColor(0.85, palette) : [255, 232, 175]
            const newA = clamp(a + ringA * (1 - a), 0, 1)
            if (newA > 0.004) {
              r = clampByte((r * a + rr * ringA) / newA)
              g = clampByte((g * a + rg * ringA) / newA)
              b = clampByte((b * a + rb * ringA) / newA)
              a = newA
            }
          }
        }

        // 5. Progressive Cellular/FBM Ember Erosion during Dissipation phase
        if (erosionThreshold > 0.01 && a > 0) {
          const noise = vfxFbmNoise2D(
            nx + curlVx * 0.12 + f * 0.07,
            ny + curlVy * 0.12 - f * 0.05,
            733
          )
          const mask = noise * 0.65 + a * 0.35
          if (mask < erosionThreshold) {
            a = 0
          } else {
            // Bright burning rim right along the erosion boundary
            const rimDist = mask - erosionThreshold
            if (rimDist < 0.12) {
              const rimBoost = 1 - rimDist / 0.12
              r = clampByte(r + rimBoost * 68)
              g = clampByte(g + rimBoost * 46)
              b = clampByte(b + rimBoost * 24)
            }
            a = clamp((mask - erosionThreshold) / Math.max(0.15, 1 - erosionThreshold), 0, 1)
          }
        }

        a *= alphaGain

        // Enforce safe quad border feathering on every frame
        if (edgeFeather > 0.005 && a > 0) {
          const distBorder = Math.min(nx, 1 - nx, ny, 1 - ny)
          if (distBorder < edgeFeather) {
            const bf = clamp(distBorder / edgeFeather, 0, 1)
            a *= bf * bf * (3 - 2 * bf)
          }
        }

        frameBuf[dstIdx] = clampByte(r)
        frameBuf[dstIdx + 1] = clampByte(g)
        frameBuf[dstIdx + 2] = clampByte(b)
        frameBuf[dstIdx + 3] = clampByte(a * 255)
      }
    }

    framesRgba.push(frameBuf)
    framesFlowVectors.push(flowBuf)

    // Blit frame into sprite sheet grid
    const col = f % cols
    const row = Math.floor(f / cols)
    const offsetX = col * fw
    const offsetY = row * fh
    for (let y = 0; y < fh; y++) {
      const srcRowStart = y * fw * 4
      const dstRowStart = ((offsetY + y) * sheetWidth + offsetX) * 4
      sheetRgba.set(frameBuf.subarray(srcRowStart, srcRowStart + fw * 4), dstRowStart)
    }
  }

  // 3. Build Uber VFX 4-Channel Packed Mask (R=Core Luminance, G=Dissolve Noise, B=Radial Flow, A=Alpha),
  //    Screen-Space Shockwave Refraction Normal Map (VFX_Distortion_Normal),
  //    Inter-Frame 2D Optical Flow Motion Vector Map (VFX_Flow_Motion_Vectors),
  //    AND Layer 5 Ground Scorch & Glowing Elemental Fissure Decal (VFX_Scorch_Decal)
  const channelPackedRgba = new Uint8ClampedArray(fw * fh * 4)
  const distortionNormalRgba = new Uint8ClampedArray(fw * fh * 4)

  const sampleLumaAt = (px: number, py: number): number => {
    const cxPx = clamp(px, 0, fw - 1)
    const cyPy = clamp(py, 0, fh - 1)
    const idx = (cyPy * fw + cxPx) * 4
    return (
      ((peakFrameRgba[idx]! * 0.299 +
        peakFrameRgba[idx + 1]! * 0.587 +
        peakFrameRgba[idx + 2]! * 0.114) /
        255) *
      (peakFrameRgba[idx + 3]! / 255)
    )
  }

  const activeDecalRamp: Exclude<VfxElementalPalette, 'original'> =
    palette !== 'original' ? palette : 'solar_fire'

  for (let y = 0; y < fh; y++) {
    const ny = y / Math.max(1, fh - 1)
    for (let x = 0; x < fw; x++) {
      const nx = x / Math.max(1, fw - 1)
      const idx = (y * fw + x) * 4
      const pr = peakFrameRgba[idx]! / 255
      const pg = peakFrameRgba[idx + 1]! / 255
      const pb = peakFrameRgba[idx + 2]! / 255
      const pa = peakFrameRgba[idx + 3]!
      const coreLuma = Math.pow(Math.max(pr, pg, pb), 1.35)
      const dissolveNoise = vfxFbmNoise2D(nx, ny, 509)
      const flowAngle = (Math.atan2(ny - 0.5, nx - 0.5) + Math.PI) / (Math.PI * 2)

      channelPackedRgba[idx] = clampByte(coreLuma * 255)
      channelPackedRgba[idx + 1] = clampByte(dissolveNoise * 255)
      channelPackedRgba[idx + 2] = clampByte(flowAngle * 255)
      channelPackedRgba[idx + 3] = pa

      // Screen-Space Shockwave & Heat-Haze Refraction Normal Map:
      // Combines Sobel height gradient of the VFX energy + radial shockwave torus derivative
      const dx = x - cx
      const dy = y - cy
      const dist = Math.hypot(dx, dy)
      const normDist = dist / Math.max(1, maxR)
      const torusSlope =
        normDist < 0.92
          ? -Math.sin(((normDist - 0.55) / 0.35) * Math.PI) *
            Math.max(0, 1 - Math.abs(normDist - 0.55) / 0.35)
          : 0
      const dirX = dist > 0.001 ? dx / dist : 0
      const dirY = dist > 0.001 ? dy / dist : 0

      const gradX = sampleLumaAt(x + 1, y) - sampleLumaAt(x - 1, y)
      const gradY = sampleLumaAt(x, y + 1) - sampleLumaAt(x, y - 1)

      let vx = (gradX * 2.4 + dirX * torusSlope * 0.85) * distortionStrength * 2.2
      let vy = (gradY * 2.4 + dirY * torusSlope * 0.85) * distortionStrength * 2.2
      // Feather distortion to 0 at quad borders so screen UV never tears at quad edges
      const borderFade = clamp(Math.min(nx, 1 - nx, ny, 1 - ny) / 0.14, 0, 1)
      vx *= borderFade
      vy *= borderFade
      const vz = 1.0
      const vLen = Math.hypot(vx, vy, vz) || 1
      distortionNormalRgba[idx] = clampByte(((vx / vLen) * 0.5 + 0.5) * 255)
      distortionNormalRgba[idx + 1] = clampByte(((vy / vLen) * 0.5 + 0.5) * 255)
      distortionNormalRgba[idx + 2] = clampByte(((vz / vLen) * 0.5 + 0.5) * 255)
      distortionNormalRgba[idx + 3] = clampByte(
        clamp(Math.max(pa / 255, Math.abs(torusSlope) * 0.9) * borderFade, 0, 1) * 255
      )

      // Inter-Frame 2D Optical Flow Motion Vector Map (R = vx * 0.5 + 0.5, G = vy * 0.5 + 0.5, B = speedMag, A = 255)
      const [curlFlowX, curlFlowY] = vfxCurlVelocity2D(nx * 1.4, ny * 1.4, 613)
      const flowNormX = clamp((dirX * 0.45 + curlFlowX * 0.55) * 0.5 + 0.5, 0, 1)
      const flowNormY = clamp((dirY * 0.45 + curlFlowY * 0.55 - 0.18) * 0.5 + 0.5, 0, 1)
      const flowSpeedMag = clamp(Math.hypot(flowNormX - 0.5, flowNormY - 0.5) * 2.0, 0, 1)
      flowMotionVectorsRgba[idx] = clampByte(flowNormX * 255)
      flowMotionVectorsRgba[idx + 1] = clampByte(flowNormY * 255)
      flowMotionVectorsRgba[idx + 2] = clampByte(flowSpeedMag * 255)
      flowMotionVectorsRgba[idx + 3] = 255

      // Layer 5: Ground Scorch & Glowing Elemental Fissure Decal (2.5D perspective-flattened ellipse)
      const ellipDist = Math.hypot(dx / Math.max(1, maxR * 0.95), dy / Math.max(1, maxR * 0.62))
      if (ellipDist < 1.0) {
        const angle = Math.atan2(dy, dx)
        const crackNoise = vfxFbmNoise2D(
          Math.cos(angle * 4) * 0.6 + nx * 2.2,
          Math.sin(angle * 4) * 0.6 + ny * 2.2,
          919
        )
        const fissureRidge = Math.pow(Math.max(0, 1 - Math.abs(crackNoise - 0.52) / 0.085), 2.0)
        const radialFade = Math.pow(Math.max(0, 1 - ellipDist), 1.45)
        const charA = clamp(radialFade * (0.68 + 0.32 * dissolveNoise) * borderFade, 0, 1)
        const emberGlow = clamp(
          fissureRidge * Math.pow(Math.max(0, 1 - ellipDist * 0.85), 1.2),
          0,
          1
        )
        const [er, eg, eb] = remapVfxThermalColor(0.55 + emberGlow * 0.42, activeDecalRamp)
        scorchDecalRgba[idx] = clampByte(16 * (1 - emberGlow) + er * emberGlow)
        scorchDecalRgba[idx + 1] = clampByte(14 * (1 - emberGlow) + eg * emberGlow)
        scorchDecalRgba[idx + 2] = clampByte(18 * (1 - emberGlow) + eb * emberGlow)
        scorchDecalRgba[idx + 3] = clampByte(Math.max(charA * 0.78, emberGlow * radialFade) * 255)
      }
    }
  }

  // 4. Build Seamless UV-Scrolling Weapon Trail / Energy Beam Ribbon Texture
  const ribbonTrailRgba = new Uint8ClampedArray(fw * fh * 4)
  for (let y = 0; y < fh; y++) {
    const v = y / Math.max(1, fh - 1)
    // Symmetric vertical profile: 0 at top/bottom edges, 1 at center line v=0.5
    const vDist = Math.abs(v - 0.5) * 2
    const vEnvelope = Math.pow(Math.max(0, 1 - vDist), 1.8)
    for (let x = 0; x < fw; x++) {
      const u = x / Math.max(1, fw - 1)
      const idx = (y * fw + x) * 4
      // Head (u ~ 0.88) hot burst tapering smoothly toward tail (u = 0) and leading edge (u = 1)
      const headTaper = u < 0.86 ? Math.pow(u / 0.86, 1.25) : Math.pow((1 - u) / 0.14, 1.6)
      const streak = 0.62 + 0.38 * vfxFbmNoise2D(u * 2.5, v * 4.2, 811)
      const energy = clamp(vEnvelope * headTaper * streak * 1.25, 0, 1)
      const [tr, tg, tb] =
        palette !== 'original'
          ? remapVfxThermalColor(energy, palette)
          : remapVfxThermalColor(energy, 'solar_fire')
      ribbonTrailRgba[idx] = tr
      ribbonTrailRgba[idx + 1] = tg
      ribbonTrailRgba[idx + 2] = tb
      ribbonTrailRgba[idx + 3] = clampByte(Math.pow(energy, 0.85) * 255)
    }
  }

  // 5. Export Godot 4 SpriteFrames.tres, Uber VFX .gdshader, 5-Layer Composite .tscn & Unity Particle JSON
  const resName =
    (options?.resourceName ?? 'vfx_effect').replace(/[^a-zA-Z0-9_-]/g, '_') || 'vfx_effect'
  const subResLines: string[] = []
  const frameEntries: string[] = []
  for (let f = 0; f < frameCount; f++) {
    const col = f % cols
    const row = Math.floor(f / cols)
    const subId = `AtlasTexture_f${f}`
    subResLines.push(`[sub_resource type="AtlasTexture" id="${subId}"]`)
    subResLines.push('atlas = ExtResource("1_sheet")')
    subResLines.push(`region = Rect2(${col * fw}, ${row * fh}, ${fw}, ${fh})`)
    subResLines.push('')
    frameEntries.push(`{\n"duration": 1.0,\n"texture": SubResource("${subId}")\n}`)
  }

  const godotSpriteFramesTres = [
    `[gd_resource type="SpriteFrames" load_steps=${frameCount + 2} format=3]`,
    '',
    `[ext_resource type="Texture2D" path="res://assets/vfx/${resName}_flipbook.png" id="1_sheet"]`,
    '',
    ...subResLines,
    '[resource]',
    'animations = [{',
    `"frames": [${frameEntries.join(', ')}],`,
    '"loop": true,',
    `"name": &"${resName}",`,
    `"speed": ${fps}.0`,
    '}]',
    ''
  ].join('\n')

  const godotVfxShader = [
    'shader_type canvas_item;',
    'render_mode blend_mix;',
    '',
    'uniform sampler2D vfx_packed_mask : source_color;',
    'uniform sampler2D vfx_distortion_normal : hint_normal;',
    'uniform sampler2D vfx_flow_motion_vectors : hint_default_transparent;',
    'uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear_mipmap;',
    'uniform float dissolve_progress : hint_range(0.0, 1.0) = 0.25;',
    'uniform float optical_flow_blend : hint_range(0.0, 1.0) = 0.0;',
    'uniform float emission_boost : hint_range(1.0, 6.0) = 2.4;',
    `uniform float refraction_strength : hint_range(0.0, 0.15) = ${(distortionStrength * 0.04).toFixed(4)};`,
    'uniform vec2 uv_scroll_speed = vec2(1.5, 0.0);',
    '',
    'void fragment() {',
    '  vec2 flow_vec = (texture(vfx_flow_motion_vectors, UV).rg * 2.0 - 1.0) * 0.045;',
    '  vec2 norm_xy = texture(vfx_distortion_normal, UV).rg * 2.0 - 1.0;',
    '  vec2 warped_uv = UV + norm_xy * refraction_strength - flow_vec * optical_flow_blend;',
    '  vec4 base_tex = texture(TEXTURE, warped_uv);',
    '  vec4 mask = texture(vfx_packed_mask, fract(warped_uv + TIME * uv_scroll_speed * 0.1));',
    '  float core = mask.r;',
    '  float noise = mask.g;',
    '  float alpha = smoothstep(dissolve_progress, dissolve_progress + 0.18, noise * 0.5 + base_tex.a * 0.5) * base_tex.a;',
    '  vec3 screen_bg = texture(screen_tex, SCREEN_UV + norm_xy * refraction_strength * alpha).rgb;',
    '  vec3 vfx_rgb = base_tex.rgb * (1.0 + core * (emission_boost - 1.0));',
    '  COLOR = vec4(mix(screen_bg, vfx_rgb, alpha), alpha);',
    '}',
    ''
  ].join('\n')

  const godotVfxPrefabTscn = [
    '[gd_scene load_steps=8 format=3]',
    '',
    `[ext_resource type="SpriteFrames" path="res://assets/vfx/${resName}_spriteframes.tres" id="1_frames"]`,
    `[ext_resource type="Texture2D" path="res://assets/vfx/${resName}_alpha.png" id="2_hero"]`,
    `[ext_resource type="Texture2D" path="res://assets/vfx/${resName}_distortion_normal.png" id="3_norm"]`,
    `[ext_resource type="Shader" path="res://assets/vfx/${resName}_uber_vfx.gdshader" id="4_shader"]`,
    `[ext_resource type="Texture2D" path="res://assets/vfx/${resName}_scorch_decal.png" id="5_decal"]`,
    '',
    '[sub_resource type="CanvasItemMaterial" id="Mat_Additive"]',
    'blend_mode = 1',
    '',
    '[sub_resource type="ParticleProcessMaterial" id="Mat_SparksSubEmitter"]',
    'particle_flag_align_y = true',
    'particle_flag_disable_z = true',
    'emission_shape = 1',
    'emission_sphere_radius = 12.0',
    'direction = Vector3(0, -1, 0)',
    'spread = 165.0',
    'initial_velocity_min = 95.0',
    'initial_velocity_max = 260.0',
    'gravity = Vector3(0, 220, 0)',
    'damping_min = 45.0',
    'damping_max = 90.0',
    'scale_min = 0.18',
    'scale_max = 0.55',
    '',
    `[node name="${resName}_CompositeVFX" type="Node2D"]`,
    '',
    '[node name="Layer0_GroundScorchDecal" type="Sprite2D" parent="."]',
    'texture = ExtResource("5_decal")',
    'position = Vector2(0, 24)',
    '',
    '[node name="Layer1_ImpactFlash" type="Sprite2D" parent="."]',
    'material = SubResource("Mat_Additive")',
    'texture = ExtResource("2_hero")',
    'scale = Vector2(1.25, 1.25)',
    '',
    '[node name="Layer2_MainFlipbook" type="AnimatedSprite2D" parent="."]',
    'sprite_frames = ExtResource("1_frames")',
    `animation = &"${resName}"`,
    'autoplay = "' + resName + '"',
    '',
    '[node name="Layer3_SparksSubEmitter" type="GPUParticles2D" parent="."]',
    'material = SubResource("Mat_Additive")',
    `amount = ${Math.max(4, sparkCount)}`,
    'process_material = SubResource("Mat_SparksSubEmitter")',
    'lifetime = 0.55',
    'one_shot = true',
    'explosiveness = 0.92',
    '',
    '[node name="Layer4_ShockwaveRefraction" type="BackBufferCopy" parent="."]',
    'copy_mode = 2',
    ''
  ].join('\n')

  const unityParticleJson = JSON.stringify(
    {
      prefabName: `${resName}_CompositeVFX`,
      layers: {
        groundScorchDecal: {
          enabled: true,
          texture: `${resName}_scorch_decal.png`,
          fadeOutDurationSec: 2.5
        },
        mainFlipbook: {
          textureSheetAnimation: {
            enabled: true,
            tilesX: cols,
            tilesY: rows,
            frameCount,
            fps,
            opticalFlowMotionVectors: `${resName}_flow_motion_vectors.png`
          },
          curlNoiseAdvection: {
            enabled: turbulence > 0,
            strength: turbulence,
            frequency: 1.35,
            scrollSpeed: 0.85
          },
          litSmokeSelfIllumination: true,
          colorOverLifetimeRamp: palette
        },
        impactFlashBurst: {
          enabled: true,
          blendMode: 'Additive',
          durationSec: Number((2 / fps).toFixed(3)),
          scaleMultiplier: 1.25
        },
        sparksSubEmitter: {
          enabled: sparkCount > 0,
          burstCount: sparkCount,
          renderMode: 'StretchedBillboard',
          velocityScale: 0.12,
          lengthScale: 2.4,
          initialSpeedRange: [95, 260],
          gravityModifier: 1.2,
          dragDamping: 0.92
        },
        shockwaveRefraction: {
          enabled: distortionStrength > 0,
          normalMap: `${resName}_distortion_normal.png`,
          refractionStrength: distortionStrength
        }
      }
    },
    null,
    2
  )

  return {
    frameWidth: fw,
    frameHeight: fh,
    frameCount,
    cols,
    rows,
    fps,
    sheetWidth,
    sheetHeight,
    sheetRgba,
    framesRgba,
    peakFrameRgba,
    channelPackedRgba,
    distortionNormalRgba,
    flowMotionVectorsRgba,
    framesFlowVectors,
    scorchDecalRgba,
    ribbonTrailRgba,
    transparentRatio: heroRes.transparentRatio,
    peakAlpha: heroRes.peakAlpha,
    godotSpriteFramesTres,
    godotVfxShader,
    godotVfxPrefabTscn,
    unityParticleJson
  }
}

// ============================================================================
// 6. BGM Intro + Seamless Loop Splitter & LUFS Loudness Normalization
// ============================================================================

export interface BgmIntroLoopSplitResult {
  sampleRate: number
  introSamples: Float32Array
  loopSamples: Float32Array
  introChannels: Float32Array[]
  loopChannels: Float32Array[]
  introDurationSec: number
  loopDurationSec: number
  spliceSec: number
}

/**
 * Splits a BGM buffer (single `Float32Array` or multi-channel `Float32Array[]`) into:
 * 1. `introSamples` / `introChannels`: The non-repeating opening intro `[0 .. spliceSample]` snapped to the nearest zero-crossing;
 * 2. `loopSamples` / `loopChannels`: The seamlessly looping body `[spliceSample .. end]` with equal-power crossfade so
 *    transitioning from `introSamples` -> `loopSamples` -> `loopSamples` is 100% click-free.
 */
export function splitBgmIntroAndSeamlessLoop(
  samplesOrChannels: Float32Array | Float32Array[],
  sampleRate: number,
  options?: {
    introSec?: number
    introDurationSec?: number
    crossfadeSec?: number
    loopCrossfadeSec?: number
  }
): BgmIntroLoopSplitResult {
  const channels = Array.isArray(samplesOrChannels)
    ? samplesOrChannels.length > 0
      ? samplesOrChannels
      : [new Float32Array(0)]
    : [samplesOrChannels]
  const primary = channels[0]!
  const sr = Math.max(8000, Math.round(sampleRate))
  const totalSec = primary.length / sr
  const requestedIntroSec = clamp(
    Number(options?.introSec ?? options?.introDurationSec ?? totalSec * 0.25),
    0.2,
    Math.max(0.25, totalSec * 0.6)
  )
  let spliceIdx = Math.min(
    Math.max(64, Math.floor(primary.length * 0.6)),
    Math.max(64, Math.round(requestedIntroSec * sr))
  )
  spliceIdx = Math.max(
    32,
    Math.min(Math.floor(primary.length * 0.65), roundToZeroCrossing(primary, spliceIdx, 512))
  )

  const crossfadeSec = clamp(
    Number(options?.crossfadeSec ?? options?.loopCrossfadeSec ?? 1.2),
    0.1,
    Math.max(0.2, ((primary.length - spliceIdx) / sr) * 0.35)
  )

  const introChannels: Float32Array[] = []
  const loopChannels: Float32Array[] = []

  for (const ch of channels) {
    const intro = ch.slice(0, spliceIdx)
    const fadeLen = Math.min(Math.floor(intro.length / 4), Math.max(8, Math.round(sr * 0.003)))
    for (let i = 0; i < fadeLen; i++) {
      intro[intro.length - 1 - i] = intro[intro.length - 1 - i]! * (i / fadeLen)
    }
    introChannels.push(intro)

    const rawLoopBody = ch.slice(spliceIdx)
    loopChannels.push(applyEqualPowerLoopCrossfadePcm(rawLoopBody, sr, crossfadeSec))
  }

  const introSamples = introChannels[0]!
  const loopSamples = loopChannels[0]!

  return {
    sampleRate: sr,
    introSamples,
    loopSamples,
    introChannels,
    loopChannels,
    introDurationSec: Number((introSamples.length / sr).toFixed(3)),
    loopDurationSec: Number((loopSamples.length / sr).toFixed(3)),
    spliceSec: Number((spliceIdx / sr).toFixed(3))
  }
}

function roundToZeroCrossing(
  samples: Float32Array,
  centerIdx: number,
  searchRadius: number
): number {
  const start = Math.max(1, centerIdx - searchRadius)
  const end = Math.min(samples.length - 2, centerIdx + searchRadius)
  let bestIdx = centerIdx
  let bestAbs = Math.abs(samples[centerIdx] ?? 0)
  for (let i = start; i <= end; i++) {
    const prev = samples[i - 1]!
    const curr = samples[i]!
    if ((prev <= 0 && curr >= 0) || (prev >= 0 && curr <= 0)) {
      const distPenalty = Math.abs(i - centerIdx) * 0.0005
      const score = Math.abs(curr) + distPenalty
      if (score < bestAbs) {
        bestAbs = score
        bestIdx = i
      }
    }
  }
  return bestIdx
}

/**
 * Normalizes a PCM buffer to a target integrated loudness in LUFS (e.g., `-14` for BGM, `-16` for SFX)
 * with a `-1.0 dBFS` true-peak soft-knee ceiling.
 */
export function normalizeIntegratedLufsPcm(
  samples: Float32Array,
  targetLufs = -14,
  ceilingDb = -1.0
): {
  data: Float32Array
  samples: Float32Array
  measuredLufs: number
  appliedGainDb: number
} {
  if (samples.length === 0) {
    const empty = new Float32Array(0)
    return { data: empty, samples: empty, measuredLufs: -70, appliedGainDb: 0 }
  }
  let sumSq = 0
  let gatedCount = 0
  // Gate out silence below -60 dBFS so SFX pauses don't skew LUFS
  const gateThresholdSq = Math.pow(10, -60 / 10)
  for (let i = 0; i < samples.length; i++) {
    const sq = samples[i]! * samples[i]!
    if (sq >= gateThresholdSq) {
      sumSq += sq
      gatedCount++
    }
  }
  const meanSq = gatedCount > 0 ? sumSq / gatedCount : sumSq / samples.length
  const measuredLufs = meanSq > 1e-12 ? -0.691 + 10 * Math.log10(meanSq) : -70
  const rawGainDb = clamp(targetLufs - measuredLufs, -24, 24)
  const gainLinear = Math.pow(10, rawGainDb / 20)
  const ceilingAmp = Math.pow(10, ceilingDb / 20)

  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]! * gainLinear
    if (Math.abs(x) <= ceilingAmp * 0.85) {
      out[i] = x
    } else {
      // Soft-knee limiting approaching ceilingAmp
      const sign = x < 0 ? -1 : 1
      const excess = (Math.abs(x) - ceilingAmp * 0.85) / (ceilingAmp * 0.15)
      out[i] = sign * ceilingAmp * (0.85 + 0.15 * Math.tanh(excess))
    }
  }
  return {
    data: out,
    samples: out,
    measuredLufs: Number(measuredLufs.toFixed(2)),
    appliedGainDb: Number(rawGainDb.toFixed(2))
  }
}

// ============================================================================
// 7. Direct Local Game Engine Directory Sync Contract
// ============================================================================

export interface SyncGameEngineBundleFileEntry {
  relativePath: string
  content: string
  encoding?: 'utf8' | 'dataUrl'
  category?: GameBundleCategory | 'sprite' | 'tilemap' | 'pbr' | 'audio' | 'ui' | 'data'
  spriteBorders?: { left: number; right: number; top: number; bottom: number }
}

export interface SyncGameEngineBundleInput {
  targetDir: string
  engineKind: 'godot4' | 'unity' | 'raw'
  files: SyncGameEngineBundleFileEntry[]
}

export interface SyncGameEngineBundleResult {
  targetDir: string
  engineKind: 'godot4' | 'unity' | 'raw'
  writtenCount: number
  unityMetaCount: number
  preservedGuidCount: number
  writtenPaths: string[]
}

// ============================================================================
// 8. Universal Layered Frame & Mask Template Compositor (Cards / Slots / Medallions / Banners)
// ============================================================================

export type UniversalFrameShape =
  'rect_card' | 'square_slot' | 'octagonal_medallion' | 'banner_plaque'

export interface NormalizedLayoutRect {
  x: number
  y: number
  width: number
  height: number
  normX: number
  normY: number
  normWidth: number
  normHeight: number
}

export type UiStylePreset =
  | 'dark_iron_parchment'
  | 'royal_gold_enamel'
  | 'arcane_crystal'
  | 'cyber_holo_grid'
  | 'ink_paper_cel'
  | 'celestial_star_gold'
  | 'persona_rebel_red'
  | 'minimal_ark_tech'

export type HudBarColorPreset =
  'hp_crimson' | 'shield_cyan' | 'mana_violet' | 'xp_gold' | 'boss_inferno'

export interface LayeredFrameLayoutMetadata {
  frameShape: UniversalFrameShape
  rarity: GameItemRarityTier
  stylePreset: UiStylePreset
  artViewportRect: NormalizedLayoutRect
  headerBarRect: NormalizedLayoutRect
  bodyBoxRect: NormalizedLayoutRect
  badgeSocketCenter: { x: number; y: number; radius: number; normX: number; normY: number }
}

export interface LayeredFrameTemplateResult {
  width: number
  height: number
  frameShape: UniversalFrameShape
  rarity: GameItemRarityTier
  stylePreset: UiStylePreset
  compositeRgba: Uint8ClampedArray
  maskedArtRgba: Uint8ClampedArray
  frameBorderRgba: Uint8ClampedArray
  socketHeaderRgba: Uint8ClampedArray
  /** Layer 4: Foil Holographic Shimmer & Metallic Specular Mask (`R=RimSpec, G=FoilPhase, B=ArtHigh, A=ShimmerWeight`) */
  foilShimmerMaskRgba: Uint8ClampedArray
  layoutRects: LayeredFrameLayoutMetadata
  godotControlTres: string
  /** Godot 4 CanvasItem Holographic Foil & 3D Tilt Shader (.gdshader) */
  godotFoilShader: string
}

export interface HudProgressBarKitResult {
  width: number
  height: number
  preset: HudBarColorPreset
  stylePreset: UiStylePreset
  nineSliceBorders: NineSliceBorders
  backplateRgba: Uint8ClampedArray
  fillStripRgba: Uint8ClampedArray
  frameOverlayRgba: Uint8ClampedArray
  compositePreviewRgba: Uint8ClampedArray
  godotProgressBarTscn: string
}

function makeLayoutRect(
  x: number,
  y: number,
  width: number,
  height: number,
  totalW: number,
  totalH: number
): NormalizedLayoutRect {
  const rx = Math.round(x)
  const ry = Math.round(y)
  const rw = Math.max(1, Math.round(width))
  const rh = Math.max(1, Math.round(height))
  return {
    x: rx,
    y: ry,
    width: rw,
    height: rh,
    normX: Number((rx / Math.max(1, totalW)).toFixed(4)),
    normY: Number((ry / Math.max(1, totalH)).toFixed(4)),
    normWidth: Number((rw / Math.max(1, totalW)).toFixed(4)),
    normHeight: Number((rh / Math.max(1, totalH)).toFixed(4))
  }
}

const UI_GLYPH_5X7: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x06, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  ':': [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06],
  ',': [0x00, 0x00, 0x00, 0x00, 0x06, 0x04, 0x08],
  '>': [0x10, 0x08, 0x04, 0x02, 0x04, 0x08, 0x10],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '%': [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  '*': [0x04, 0x15, 0x0e, 0x1f, 0x0e, 0x15, 0x04],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
}

/**
 * Universal Layered Frame & Mask Compositor for cards, equipment slots, character medallions, and banners.
 * Separates raw artwork into 4 independent layers (`Layer_1_Masked_Art`, `Layer_2_Frame_Border`,
 * `Layer_3_Socket_And_Header`, `Layer_4_Foil_Shimmer_Mask`) plus a merged `Composite_Preview`,
 * 5 game UI material themes, layout anchor metadata JSON, Godot 4 Control `.tscn`, and Foil `.gdshader`.
 */
export function composeLayeredFrameTemplate(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    frameShape?: UniversalFrameShape
    rarity?: GameItemRarityTier
    stylePreset?: UiStylePreset
    foilStrength?: number
    resourceName?: string
  }
): LayeredFrameTemplateResult {
  const w = Math.max(16, Math.floor(width))
  const h = Math.max(16, Math.floor(height))
  const frameShape: UniversalFrameShape = options?.frameShape ?? 'rect_card'
  const rarity: GameItemRarityTier = options?.rarity ?? 'rare'
  const stylePreset: UiStylePreset = options?.stylePreset ?? 'dark_iron_parchment'
  const foilStrength = clamp(Number(options?.foilStrength ?? 0.65), 0, 1.5)
  const baseTheme = RARITY_TIER_COLORS[rarity] ?? RARITY_TIER_COLORS.rare

  // Derive style-adjusted material colors
  const styleBodyBg: [number, number, number] =
    stylePreset === 'dark_iron_parchment'
      ? [214, 196, 162] // Warm aged parchment for dark fantasy card/tooltip body
      : stylePreset === 'royal_gold_enamel'
        ? [24, 42, 86] // Deep royal sapphire enamel
        : stylePreset === 'arcane_crystal'
          ? [28, 22, 64] // Deep arcane void indigo
          : stylePreset === 'cyber_holo_grid'
            ? [12, 28, 44] // Tactical cyan-tinted dark glass
            : stylePreset === 'celestial_star_gold'
              ? [236, 229, 216] // Genshin-style warm astral cream-parchment
              : stylePreset === 'persona_rebel_red'
                ? [16, 16, 20] // Persona 5 high-contrast pitch black
                : stylePreset === 'minimal_ark_tech'
                  ? [24, 27, 32] // Arknights matte tactical slate
                  : [238, 232, 218] // Sumi rice-paper off-white

  const styleTheme = getUiStyleThemeColors(stylePreset)
  const theme = {
    border:
      stylePreset === 'celestial_star_gold'
        ? ([228, 198, 138] as [number, number, number])
        : stylePreset === 'ink_paper_cel' ||
            stylePreset === 'persona_rebel_red' ||
            stylePreset === 'minimal_ark_tech' ||
            stylePreset === 'cyber_holo_grid' ||
            stylePreset === 'royal_gold_enamel' ||
            stylePreset === 'arcane_crystal'
          ? styleTheme.rim
          : ([
              Math.round(baseTheme.border[0] * 0.22 + styleTheme.rim[0] * 0.78),
              Math.round(baseTheme.border[1] * 0.22 + styleTheme.rim[1] * 0.78),
              Math.round(baseTheme.border[2] * 0.22 + styleTheme.rim[2] * 0.78)
            ] as [number, number, number]),
    glow:
      stylePreset === 'celestial_star_gold'
        ? ([255, 246, 214] as [number, number, number])
        : stylePreset === 'ink_paper_cel'
          ? ([204, 42, 42] as [number, number, number])
          : stylePreset === 'persona_rebel_red'
            ? ([252, 248, 248] as [number, number, number])
            : stylePreset === 'cyber_holo_grid'
              ? ([255, 42, 156] as [number, number, number])
              : stylePreset === 'minimal_ark_tech'
                ? ([255, 118, 20] as [number, number, number])
                : stylePreset === 'arcane_crystal'
                  ? ([88, 238, 255] as [number, number, number])
                  : stylePreset === 'royal_gold_enamel'
                    ? ([255, 238, 148] as [number, number, number])
                    : baseTheme.glow,
    gem: styleTheme.accent,
    bg:
      stylePreset === 'celestial_star_gold'
        ? ([24, 34, 58] as [number, number, number])
        : styleTheme.bg
  }

  const maskedArtRgba = new Uint8ClampedArray(w * h * 4)
  const frameBorderRgba = new Uint8ClampedArray(w * h * 4)
  const socketHeaderRgba = new Uint8ClampedArray(w * h * 4)
  const foilShimmerMaskRgba = new Uint8ClampedArray(w * h * 4)
  const compositeRgba = new Uint8ClampedArray(w * h * 4)

  const minDim = Math.min(w, h)
  const borderW = Math.max(3, Math.round(minDim * 0.056))

  // Compute viewport & UI anchor regions based on universal frame shape
  const artViewportRect =
    frameShape === 'rect_card'
      ? makeLayoutRect(borderW * 1.4, h * 0.11, w - borderW * 2.8, h * 0.62, w, h)
      : frameShape === 'banner_plaque'
        ? makeLayoutRect(borderW * 1.4, h * 0.14, w - borderW * 2.8, h * 0.58, w, h)
        : makeLayoutRect(borderW * 1.3, borderW * 1.3, w - borderW * 2.6, h - borderW * 2.6, w, h)

  const headerBarRect =
    frameShape === 'rect_card' || frameShape === 'banner_plaque'
      ? makeLayoutRect(
          borderW * 1.8,
          borderW * 1.15,
          w - borderW * 3.6,
          Math.max(6, h * 0.075),
          w,
          h
        )
      : makeLayoutRect(
          borderW * 1.5,
          h - borderW * 2.8,
          w - borderW * 3.0,
          Math.max(4, h * 0.12),
          w,
          h
        )

  const bodyBoxRect =
    frameShape === 'rect_card'
      ? makeLayoutRect(borderW * 1.4, h * 0.745, w - borderW * 2.8, h * 0.195, w, h)
      : frameShape === 'banner_plaque'
        ? makeLayoutRect(borderW * 1.6, h * 0.74, w - borderW * 3.2, h * 0.16, w, h)
        : makeLayoutRect(borderW * 1.5, h * 0.76, w - borderW * 3.0, h * 0.14, w, h)

  const socketRadius = Math.max(3, Math.round(minDim * 0.068))
  const socketX = Math.round(borderW * 1.5 + socketRadius * 0.75)
  const socketY = Math.round(borderW * 1.5 + socketRadius * 0.75)
  const badgeSocketCenter = {
    x: socketX,
    y: socketY,
    radius: socketRadius,
    normX: Number((socketX / w).toFixed(4)),
    normY: Number((socketY / h).toFixed(4))
  }

  // Shape signed distance helper: returns distance inside outer silhouette (>0 inside)
  const outerShapeDist = (x: number, y: number): number => {
    const dx = Math.min(x, w - 1 - x)
    const dy = Math.min(y, h - 1 - y)
    if (frameShape === 'octagonal_medallion') {
      const cut = minDim * 0.24
      const cornerDist = x + y - cut
      const cornerDist2 = w - 1 - x + y - cut
      const cornerDist3 = x + (h - 1 - y) - cut
      const cornerDist4 = w - 1 - x + (h - 1 - y) - cut
      return Math.min(
        dx,
        dy,
        cornerDist * 0.707,
        cornerDist2 * 0.707,
        cornerDist3 * 0.707,
        cornerDist4 * 0.707
      )
    }
    if (frameShape === 'banner_plaque') {
      const notch = y > h * 0.84 ? ((y - h * 0.84) / (h * 0.16)) * (w * 0.16) : 0
      return Math.min(dx - notch, dy)
    }
    const chamfer = stylePreset === 'cyber_holo_grid' ? minDim * 0.1 : minDim * 0.048
    const c1 = (x + y - chamfer) * 0.707
    const c2 = (w - 1 - x + y - chamfer) * 0.707
    const c3 = (x + (h - 1 - y) - chamfer) * 0.707
    const c4 = (w - 1 - x + (h - 1 - y) - chamfer) * 0.707
    return Math.min(dx, dy, c1, c2, c3, c4)
  }

  const vpAspect = artViewportRect.width / Math.max(1, artViewportRect.height)
  const srcAspect = w / Math.max(1, h)

  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const idx = (y * w + x) * 4
      const sDist = outerShapeDist(x, y)
      if (sDist < -0.75) continue
      const outerAA = clamp((sDist + 0.75) / 1.5, 0, 1)

      const inViewport =
        x >= artViewportRect.x &&
        x < artViewportRect.x + artViewportRect.width &&
        y >= artViewportRect.y &&
        y < artViewportRect.y + artViewportRect.height &&
        sDist >= borderW

      // Layer 1: Masked Art inside viewport with aspect-preserving cover crop & clean alpha over astral backdrop
      if (inViewport) {
        const uRaw = (x - artViewportRect.x) / Math.max(1, artViewportRect.width - 1)
        const vRaw = (y - artViewportRect.y) / Math.max(1, artViewportRect.height - 1)
        const u = vpAspect < srcAspect ? 0.5 + (uRaw - 0.5) * (vpAspect / srcAspect) : uRaw
        const v = vpAspect > srcAspect ? 0.5 + (vRaw - 0.5) * (srcAspect / vpAspect) : vRaw
        const srcX = clamp(Math.round(u * (w - 1)), 0, w - 1)
        const srcY = clamp(Math.round(v * (h - 1)), 0, h - 1)
        const sIdx = (srcY * w + srcX) * 4

        // Rich style-distinctive backdrop & peripheral frame matte inside viewport
        const rad = Math.hypot(uRaw - 0.5, (vRaw - 0.42) * 1.1)
        const halo = Math.max(0, 1 - rad * 1.25)
        let bgR = clampByte(theme.bg[0] * (0.85 + halo * 0.35) + theme.border[0] * halo * 0.25)
        let bgG = clampByte(theme.bg[1] * (0.85 + halo * 0.35) + theme.border[1] * halo * 0.22)
        let bgB = clampByte(theme.bg[2] * (0.9 + halo * 0.3) + theme.gem[2] * halo * 0.22)

        if (stylePreset === 'ink_paper_cel') {
          const ridge = Math.sin(uRaw * 9.5) * 0.08 + Math.cos(uRaw * 4.2) * 0.06
          const inMount = vRaw > 0.56 + ridge
          bgR = inMount ? 82 : 238
          bgG = inMount ? 76 : 228
          bgB = inMount ? 70 : 208
        } else if (stylePreset === 'persona_rebel_red') {
          const slash = Math.sin((uRaw * 2.4 + vRaw * 1.6) * Math.PI * 3) > 0.1
          bgR = slash ? 228 : 14
          bgG = slash ? 20 : 12
          bgB = slash ? 38 : 16
        } else if (stylePreset === 'cyber_holo_grid') {
          const onGrid = Math.abs((uRaw * 8) % 1) < 0.06 || Math.abs((vRaw * 8) % 1) < 0.06
          bgR = onGrid ? 0 : 8
          bgG = onGrid ? 232 : 20
          bgB = onGrid ? 255 : 36
        }

        const rawA = rgba[sIdx + 3]! / 255
        // Suppress low-alpha compression fringe (< 0.28) so un-premultiplied black/red dots never appear
        const cleanA = rawA >= 0.96 ? 1 : clamp((rawA - 0.28) / 0.64, 0, 1)
        const vig = 1 - Math.pow(rad * 1.1, 2) * 0.16
        let sR = rgba[sIdx]! * vig
        let sG = rgba[sIdx + 1]! * vig
        let sB = rgba[sIdx + 2]! * vig

        // Peripheral style matte & color grading so even opaque portraits carry the chosen UI style
        const rimMatte = clamp((rad - 0.34) * 1.35, 0, 0.68)
        if (stylePreset === 'ink_paper_cel') {
          const luma = sR * 0.299 + sG * 0.587 + sB * 0.114
          const inkR = clampByte(242 - (255 - luma) * 0.82)
          const inkG = clampByte(232 - (255 - luma) * 0.85)
          const inkB = clampByte(212 - (255 - luma) * 0.88)
          sR = sR * 0.48 + inkR * 0.52
          sG = sG * 0.48 + inkG * 0.52
          sB = sB * 0.48 + inkB * 0.52
        } else if (stylePreset === 'persona_rebel_red') {
          const luma = sR * 0.299 + sG * 0.587 + sB * 0.114
          const hiContrast = luma > 128 ? 245 : 18
          sR = sR * 0.58 + (luma > 105 && luma < 165 ? 236 : hiContrast) * 0.42
          sG = sG * 0.52 + (luma > 105 && luma < 165 ? 22 : hiContrast) * 0.48
          sB = sB * 0.52 + (luma > 105 && luma < 165 ? 38 : hiContrast) * 0.48
        } else if (stylePreset === 'cyber_holo_grid') {
          const scan = y % 3 === 0 ? 1.18 : 0.92
          sR = clampByte((sR * 0.72 + (vRaw > 0.5 ? 48 : 0)) * scan)
          sG = clampByte((sG * 0.85 + 36) * scan)
          sB = clampByte((sB * 0.92 + 54) * scan)
        }
        sR = sR * (1 - rimMatte) + bgR * rimMatte
        sG = sG * (1 - rimMatte) + bgG * rimMatte
        sB = sB * (1 - rimMatte) + bgB * rimMatte

        maskedArtRgba[idx] = clampByte(sR * cleanA + bgR * (1 - cleanA))
        maskedArtRgba[idx + 1] = clampByte(sG * cleanA + bgG * (1 - cleanA))
        maskedArtRgba[idx + 2] = clampByte(sB * cleanA + bgB * (1 - cleanA))
        maskedArtRgba[idx + 3] = 255
      }

      // Layer 2: Multi-Line Ornamental Filigree Frame Border, 4-Point Astral Corner Gems & Inner Pinstripes
      const isOuterBorder = sDist >= -0.75 && sDist < borderW * 1.18
      const vpEdgeDist = Math.min(
        Math.abs(x - artViewportRect.x),
        Math.abs(x - (artViewportRect.x + artViewportRect.width)),
        Math.abs(y - artViewportRect.y),
        Math.abs(y - (artViewportRect.y + artViewportRect.height))
      )
      const onViewportRim =
        x >= artViewportRect.x - 2 &&
        x <= artViewportRect.x + artViewportRect.width + 2 &&
        y >= artViewportRect.y - 2 &&
        y <= artViewportRect.y + artViewportRect.height + 2 &&
        vpEdgeDist <= Math.max(1, Math.round(borderW * 0.28))

      const cornerInset = borderW * 1.45
      const cornerStarDist = Math.min(
        Math.abs(x - cornerInset) * 1.3 + Math.abs(y - cornerInset) * 0.75,
        Math.abs(x - cornerInset) * 0.75 + Math.abs(y - cornerInset) * 1.3,
        Math.abs(w - 1 - x - cornerInset) * 1.3 + Math.abs(y - cornerInset) * 0.75,
        Math.abs(w - 1 - x - cornerInset) * 0.75 + Math.abs(y - cornerInset) * 1.3,
        Math.abs(x - cornerInset) * 1.3 + Math.abs(h - 1 - y - cornerInset) * 0.75,
        Math.abs(x - cornerInset) * 0.75 + Math.abs(h - 1 - y - cornerInset) * 1.3,
        Math.abs(w - 1 - x - cornerInset) * 1.3 + Math.abs(h - 1 - y - cornerInset) * 0.75,
        Math.abs(w - 1 - x - cornerInset) * 0.75 + Math.abs(h - 1 - y - cornerInset) * 1.3
      )
      const isCornerGemCore = cornerStarDist <= Math.max(1.5, borderW * 0.35)
      const isCornerOrnament = cornerStarDist <= Math.max(2.5, borderW * 0.72)

      if (isOuterBorder || onViewportRim || isCornerOrnament) {
        const isDarkContour =
          sDist < 1.4 || (sDist > borderW * 0.62 && sDist < borderW * 0.88 && !isCornerOrnament)
        const anisoSheen = 0.92 + 0.22 * Math.sin((nx * 2.2 - ny * 1.8) * Math.PI)
        let bevel = (x + y < (w + h) * 0.55 ? 1.12 : 0.84) * anisoSheen
        if (isDarkContour) {
          bevel = stylePreset === 'ink_paper_cel' ? 1.35 : 0.28
        } else if (stylePreset === 'cyber_holo_grid' && y % 3 === 0) {
          bevel *= 1.15
        }
        const col = isCornerGemCore
          ? theme.gem
          : (onViewportRim && !isOuterBorder) || isCornerOrnament
            ? theme.glow
            : isDarkContour && stylePreset === 'ink_paper_cel'
              ? ([236, 226, 206] as [number, number, number])
              : isDarkContour && stylePreset === 'persona_rebel_red'
                ? ([252, 250, 250] as [number, number, number])
                : theme.border
        frameBorderRgba[idx] = clampByte(col[0] * bevel)
        frameBorderRgba[idx + 1] = clampByte(col[1] * bevel)
        frameBorderRgba[idx + 2] = clampByte(col[2] * bevel)
        frameBorderRgba[idx + 3] = clampByte(255 * outerAA)
      } else if (!inViewport && sDist >= borderW) {
        frameBorderRgba[idx] = theme.bg[0]
        frameBorderRgba[idx + 1] = theme.bg[1]
        frameBorderRgba[idx + 2] = theme.bg[2]
        frameBorderRgba[idx + 3] = clampByte(248 * outerAA)
      }

      // Layer 3: Faceted Elemental Crest Medallion, Translucent Header Ribbon & Star-Rated Body Plate
      const dxSoc = x - socketX
      const dySoc = y - socketY
      const distSocket = Math.max(
        Math.hypot(dxSoc, dySoc),
        (Math.abs(dxSoc) + Math.abs(dySoc)) * 0.76
      )
      if (distSocket <= socketRadius + 0.75) {
        const socketAA = clamp((socketRadius + 0.75 - distSocket) / 1.4, 0, 1)
        const isSocketRim = distSocket >= socketRadius - Math.max(1.5, borderW * 0.35)
        const starCross = Math.min(
          Math.abs(dxSoc) * 2.2 + Math.abs(dySoc) * 0.65,
          Math.abs(dxSoc) * 0.65 + Math.abs(dySoc) * 2.2
        )
        const isInnerStar = starCross <= socketRadius * 0.52
        const sCol = isSocketRim ? theme.glow : isInnerStar ? theme.gem : theme.bg
        const radialShade =
          isSocketRim || isInnerStar ? 1.08 : 0.85 + 0.25 * (1 - distSocket / socketRadius)
        socketHeaderRgba[idx] = clampByte(sCol[0] * radialShade)
        socketHeaderRgba[idx + 1] = clampByte(sCol[1] * radialShade)
        socketHeaderRgba[idx + 2] = clampByte(sCol[2] * radialShade)
        socketHeaderRgba[idx + 3] = clampByte(255 * socketAA * outerAA)
      } else {
        const inHeader =
          x >= headerBarRect.x &&
          x < headerBarRect.x + headerBarRect.width &&
          y >= headerBarRect.y &&
          y < headerBarRect.y + headerBarRect.height
        const inBody =
          (frameShape === 'rect_card' || frameShape === 'banner_plaque') &&
          x >= bodyBoxRect.x &&
          x < bodyBoxRect.x + bodyBoxRect.width &&
          y >= bodyBoxRect.y &&
          y < bodyBoxRect.y + bodyBoxRect.height

        if (inHeader) {
          const isHeaderRim =
            y <= headerBarRect.y + 1 || y >= headerBarRect.y + headerBarRect.height - 2
          const bannerArchShade = 1 - Math.abs(nx - 0.5) * 0.35
          socketHeaderRgba[idx] = isHeaderRim
            ? theme.border[0]
            : clampByte(theme.bg[0] * 0.92 * bannerArchShade)
          socketHeaderRgba[idx + 1] = isHeaderRim
            ? theme.border[1]
            : clampByte(theme.bg[1] * 0.92 * bannerArchShade)
          socketHeaderRgba[idx + 2] = isHeaderRim
            ? theme.border[2]
            : clampByte(theme.bg[2] * 0.96 * bannerArchShade)
          socketHeaderRgba[idx + 3] = isHeaderRim ? 235 : 212
        } else if (inBody) {
          const bx = (x - bodyBoxRect.x) / Math.max(1, bodyBoxRect.width - 1)
          const by = (y - bodyBoxRect.y) / Math.max(1, bodyBoxRect.height - 1)
          const isBodyRim =
            x <= bodyBoxRect.x + 1 ||
            x >= bodyBoxRect.x + bodyBoxRect.width - 2 ||
            y <= bodyBoxRect.y + 1 ||
            y >= bodyBoxRect.y + bodyBoxRect.height - 2
          const isDivider = Math.abs(by - 0.46) < 0.025 && bx > 0.12 && bx < 0.88
          // 5-Star rating row centered in upper body plate (by ~ 0.24)
          let isStarGlyph = false
          if (by >= 0.12 && by <= 0.38 && bx >= 0.25 && bx <= 0.75) {
            const starSlot = (bx - 0.25) / 0.1
            const sxLocal = (starSlot - Math.floor(starSlot) - 0.5) * 2
            const syLocal = (by - 0.25) / 0.13
            const starDiamond = Math.min(
              Math.abs(sxLocal) * 1.6 + Math.abs(syLocal) * 0.8,
              Math.abs(sxLocal) * 0.8 + Math.abs(syLocal) * 1.6
            )
            isStarGlyph = starDiamond < 0.72
          }
          const grain = 0.96 + 0.06 * vfxFbmNoise2D(nx * 3.2, ny * 3.2, 409)
          if (isBodyRim || isDivider) {
            socketHeaderRgba[idx] = theme.border[0]
            socketHeaderRgba[idx + 1] = theme.border[1]
            socketHeaderRgba[idx + 2] = theme.border[2]
            socketHeaderRgba[idx + 3] = 245
          } else if (isStarGlyph) {
            socketHeaderRgba[idx] = stylePreset === 'ink_paper_cel' ? 204 : 250
            socketHeaderRgba[idx + 1] = stylePreset === 'ink_paper_cel' ? 42 : 204
            socketHeaderRgba[idx + 2] = stylePreset === 'ink_paper_cel' ? 42 : 62
            socketHeaderRgba[idx + 3] = 255
          } else {
            socketHeaderRgba[idx] = clampByte(styleBodyBg[0] * grain)
            socketHeaderRgba[idx + 1] = clampByte(styleBodyBg[1] * grain)
            socketHeaderRgba[idx + 2] = clampByte(styleBodyBg[2] * grain)
            socketHeaderRgba[idx + 3] = 242
          }
        }
      }

      // Layer 4: Foil Holographic Shimmer & Metallic Specular Mask
      // R = Metallic Rim Specular Weight, G = Diagonal Diffraction Grating Phase, B = Artwork Highlight, A = Mask Alpha
      const rimSpec = isOuterBorder || onViewportRim || distSocket <= socketRadius ? 1.0 : 0.18
      const foilPhase = 0.5 + 0.5 * Math.sin((nx * 1.35 + ny * 0.95) * Math.PI * 4)
      const artLuma = inViewport
        ? (maskedArtRgba[idx]! * 0.299 +
            maskedArtRgba[idx + 1]! * 0.587 +
            maskedArtRgba[idx + 2]! * 0.114) /
          255
        : 0
      const shimmerWeight = clamp(
        (rimSpec * 0.75 + Math.pow(artLuma, 1.8) * 0.55) * foilStrength,
        0,
        1
      )
      foilShimmerMaskRgba[idx] = clampByte(rimSpec * 255)
      foilShimmerMaskRgba[idx + 1] = clampByte(foilPhase * 255)
      foilShimmerMaskRgba[idx + 2] = clampByte(artLuma * 255)
      foilShimmerMaskRgba[idx + 3] = clampByte(shimmerWeight * 255)

      // Alpha-composite Layer 1 -> Layer 2 -> Layer 3 into Composite_Preview
      let outR = maskedArtRgba[idx]!
      let outG = maskedArtRgba[idx + 1]!
      let outB = maskedArtRgba[idx + 2]!
      let outA = maskedArtRgba[idx + 3]! / 255

      const blendLayer = (lR: number, lG: number, lB: number, lA255: number): void => {
        const lA = lA255 / 255
        if (lA <= 0) return
        const newA = lA + outA * (1 - lA)
        if (newA <= 0) return
        outR = (lR * lA + outR * outA * (1 - lA)) / newA
        outG = (lG * lA + outG * outA * (1 - lA)) / newA
        outB = (lB * lA + outB * outA * (1 - lA)) / newA
        outA = newA
      }

      blendLayer(
        frameBorderRgba[idx]!,
        frameBorderRgba[idx + 1]!,
        frameBorderRgba[idx + 2]!,
        frameBorderRgba[idx + 3]!
      )
      blendLayer(
        socketHeaderRgba[idx]!,
        socketHeaderRgba[idx + 1]!,
        socketHeaderRgba[idx + 2]!,
        socketHeaderRgba[idx + 3]!
      )

      compositeRgba[idx] = clampByte(outR)
      compositeRgba[idx + 1] = clampByte(outG)
      compositeRgba[idx + 2] = clampByte(outB)
      compositeRgba[idx + 3] = clampByte(outA * 255)
    }
  }

  // Stamp crisp star rating badges, socket emblems & plaque labels on high-res frames
  if (w >= 128 && h >= 128) {
    const scale1 = Math.max(1, Math.min(3, Math.floor(w / 240)))
    const scale2 = Math.max(1, Math.min(2, Math.floor(w / 320)))
    const starCol: [number, number, number] =
      stylePreset === 'ink_paper_cel'
        ? [204, 42, 42]
        : stylePreset === 'cyber_holo_grid'
          ? [0, 242, 255]
          : stylePreset === 'persona_rebel_red'
            ? [242, 32, 48]
            : stylePreset === 'minimal_ark_tech'
              ? [255, 118, 20]
              : [255, 214, 78]
    const cardHeaderTitle =
      stylePreset === 'ink_paper_cel'
        ? '* INK SCROLL SSR CARD *'
        : stylePreset === 'persona_rebel_red'
          ? '* PHANTOM REBEL ARCANA *'
          : stylePreset === 'cyber_holo_grid'
            ? '* CYBER NETRUNNER UNIT *'
            : stylePreset === 'minimal_ark_tech'
              ? '* PRTS ELITE OPERATOR *'
              : stylePreset === 'royal_gold_enamel'
                ? '* IMPERIAL CROWN SSR *'
                : stylePreset === 'arcane_crystal'
                  ? '* ARCANE SANCTUM SSR *'
                  : stylePreset === 'dark_iron_parchment'
                    ? '* ASHEN SOULS RELIC *'
                    : '* 5* SSR WISH CARD *'
    const cardHeroTitle =
      stylePreset === 'ink_paper_cel'
        ? 'SWORD IMMORTAL'
        : stylePreset === 'persona_rebel_red'
          ? 'JOKER // PHANTOM'
          : stylePreset === 'cyber_holo_grid'
            ? 'VALKYRIE // MK-IX'
            : stylePreset === 'minimal_ark_tech'
              ? 'OPERATOR // ELITE 2'
              : 'ASTRAL SOVEREIGN'
    const drawOnBoth = (fn: (buf: Uint8ClampedArray) => void): void => {
      fn(socketHeaderRgba)
      fn(compositeRgba)
    }
    // Socket emblem star / level badge
    drawOnBoth((buf) => {
      if (frameShape === 'square_slot') {
        drawUiTextOnBuffer(
          buf,
          w,
          h,
          '+20',
          badgeSocketCenter.x,
          badgeSocketCenter.y,
          scale2,
          [255, 248, 224],
          [12, 16, 28]
        )
      } else {
        drawFourPointStarOnBuffer(
          buf,
          w,
          h,
          badgeSocketCenter.x,
          badgeSocketCenter.y,
          Math.max(4, Math.round(badgeSocketCenter.radius * 0.58)),
          [255, 250, 232]
        )
      }
    })

    if (frameShape === 'rect_card' || frameShape === 'banner_plaque') {
      drawOnBoth((buf) => {
        drawUiTextOnBuffer(
          buf,
          w,
          h,
          cardHeaderTitle,
          headerBarRect.x + headerBarRect.width * 0.5,
          headerBarRect.y + headerBarRect.height * 0.52,
          scale2,
          [248, 224, 152],
          [12, 16, 28]
        )
        const starY = Math.round(bodyBoxRect.y + bodyBoxRect.height * 0.24)
        const starStep = Math.round(bodyBoxRect.width * 0.085)
        const starStartX = Math.round(bodyBoxRect.x + bodyBoxRect.width * 0.5 - starStep * 2)
        for (let s = 0; s < 5; s++) {
          drawFourPointStarOnBuffer(
            buf,
            w,
            h,
            starStartX + s * starStep,
            starY,
            Math.max(4, Math.round(w * 0.016)),
            starCol
          )
        }
        drawUiTextOnBuffer(
          buf,
          w,
          h,
          cardHeroTitle,
          bodyBoxRect.x + bodyBoxRect.width * 0.5,
          bodyBoxRect.y + bodyBoxRect.height * 0.62,
          scale1,
          [42, 34, 24],
          [248, 240, 224]
        )
        drawUiTextOnBuffer(
          buf,
          w,
          h,
          'LV.90  ATK +842  CRIT +38%',
          bodyBoxRect.x + bodyBoxRect.width * 0.5,
          bodyBoxRect.y + bodyBoxRect.height * 0.82,
          scale2,
          [68, 56, 40],
          [248, 240, 224]
        )
      })
    } else if (frameShape === 'octagonal_medallion') {
      const pillW = Math.round(w * 0.58)
      const pillH = Math.round(h * 0.105)
      const px0 = Math.round((w - pillW) * 0.5)
      const py0 = Math.round(h * 0.82)
      drawOnBoth((buf) => {
        drawOrnatePanelBoxOnBuffer(
          buf,
          w,
          h,
          px0,
          py0,
          px0 + pillW,
          py0 + pillH,
          theme.bg,
          theme.border,
          0.96,
          6
        )
        const starStep = Math.round(pillW * 0.115)
        const starStartX = Math.round(w * 0.36 - starStep * 1.5)
        for (let s = 0; s < 5; s++) {
          drawFourPointStarOnBuffer(
            buf,
            w,
            h,
            starStartX + s * starStep,
            py0 + pillH * 0.5,
            Math.max(5, Math.round(w * 0.021)),
            starCol
          )
        }
        drawUiTextOnBuffer(
          buf,
          w,
          h,
          'LV.90',
          w * 0.68,
          py0 + pillH * 0.52,
          scale1,
          [248, 232, 184],
          [10, 14, 24]
        )
      })
    } else if (frameShape === 'square_slot') {
      const barW = Math.round(w * 0.72)
      const barH = Math.round(h * 0.095)
      const bx0 = Math.round((w - barW) * 0.5)
      const by0 = Math.round(h * 0.83)
      drawOnBoth((buf) => {
        drawOrnatePanelBoxOnBuffer(
          buf,
          w,
          h,
          bx0,
          by0,
          bx0 + barW,
          by0 + barH,
          theme.bg,
          theme.border,
          0.96,
          6
        )
        const starStep = Math.round(barW * 0.14)
        const starStartX = Math.round(w * 0.5 - starStep * 2)
        for (let s = 0; s < 5; s++) {
          drawFourPointStarOnBuffer(
            buf,
            w,
            h,
            starStartX + s * starStep,
            by0 + barH * 0.5,
            Math.max(5, Math.round(w * 0.023)),
            starCol
          )
        }
      })
    }
  }

  const resName = (options?.resourceName ?? 'layered_frame').trim() || 'layered_frame'
  const layoutRects: LayeredFrameLayoutMetadata = {
    frameShape,
    rarity,
    stylePreset,
    artViewportRect,
    headerBarRect,
    bodyBoxRect,
    badgeSocketCenter
  }

  const godotControlTres = [
    '[gd_scene load_steps=5 format=3]',
    '',
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_art.png" id="1_art"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_border.png" id="2_border"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_Overlay.png" id="3_overlay"]`,
    `[ext_resource type="Shader" path="res://assets/ui/${resName}_foil.gdshader" id="4_foil"]`,
    '',
    `[node name="${resName}" type="Control"]`,
    `custom_minimum_size = Vector2(${w}, ${h})`,
    'layout_mode = 3',
    'anchors_preset = 0',
    '',
    '[node name="Layer1_MaskedArt" type="TextureRect" parent="."]',
    'layout_mode = 1',
    'anchors_preset = 15',
    'grow_horizontal = 2',
    'grow_vertical = 2',
    'texture = ExtResource("1_art")',
    '',
    '[node name="Layer2_FrameBorder" type="TextureRect" parent="."]',
    'layout_mode = 1',
    'anchors_preset = 15',
    'grow_horizontal = 2',
    'grow_vertical = 2',
    'texture = ExtResource("2_border")',
    '',
    '[node name="Layer3_SocketAndHeader" type="TextureRect" parent="."]',
    'layout_mode = 1',
    'anchors_preset = 15',
    'grow_horizontal = 2',
    'grow_vertical = 2',
    'texture = ExtResource("3_overlay")',
    '',
    '[node name="HeaderTitleLabel" type="Label" parent="."]',
    'layout_mode = 0',
    `offset_left = ${headerBarRect.x}.0`,
    `offset_top = ${headerBarRect.y}.0`,
    `offset_right = ${headerBarRect.x + headerBarRect.width}.0`,
    `offset_bottom = ${headerBarRect.y + headerBarRect.height}.0`,
    'horizontal_alignment = 1',
    'vertical_alignment = 1',
    '',
    '[node name="BodyRichTextLabel" type="RichTextLabel" parent="."]',
    'layout_mode = 0',
    `offset_left = ${bodyBoxRect.x}.0`,
    `offset_top = ${bodyBoxRect.y}.0`,
    `offset_right = ${bodyBoxRect.x + bodyBoxRect.width}.0`,
    `offset_bottom = ${bodyBoxRect.y + bodyBoxRect.height}.0`,
    'bbcode_enabled = true',
    ''
  ].join('\n')

  const godotFoilShader = [
    'shader_type canvas_item;',
    '',
    'uniform sampler2D foil_mask_tex : source_color;',
    `uniform float foil_intensity : hint_range(0.0, 2.0) = ${foilStrength.toFixed(2)};`,
    'uniform float sweep_speed : hint_range(0.1, 5.0) = 1.35;',
    'uniform vec2 tilt_vector = vec2(0.0, 0.0);',
    '',
    'vec3 rainbow_holo(float phase) {',
    '  return 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.67)));',
    '}',
    '',
    'void fragment() {',
    '  vec4 base = texture(TEXTURE, UV + tilt_vector * 0.015);',
    '  vec4 mask = texture(foil_mask_tex, UV);',
    '  float band = pow(max(0.0, sin((UV.x * 1.4 + UV.y * 0.9 - TIME * sweep_speed) * 3.14159)), 6.0);',
    '  vec3 holo = rainbow_holo(mask.g + TIME * 0.25 + dot(tilt_vector, vec2(0.5))) * mask.a * foil_intensity;',
    '  vec3 spec = vec3(1.0, 0.96, 0.82) * band * mask.r * foil_intensity;',
    '  COLOR = vec4(base.rgb + holo * 0.45 + spec * 0.65, base.a);',
    '}',
    ''
  ].join('\n')

  return {
    width: w,
    height: h,
    frameShape,
    rarity,
    stylePreset,
    compositeRgba,
    maskedArtRgba,
    frameBorderRgba,
    socketHeaderRgba,
    foilShimmerMaskRgba,
    layoutRects,
    godotControlTres,
    godotFoilShader
  }
}

/**
 * Synthesizes a 3-Layer Combat HUD Progress Bar & Status Gauge Kit (`hud_bar_kit`):
 * 1. `HUD_Bar_Backplate`: Recessed metallic trough with dark inner bevel shadow;
 * 2. `HUD_Bar_Fill_Strip`: Liquid energy fill bar with wave highlights & vertical specular sheen;
 * 3. `HUD_Bar_Frame_Overlay`: Beveled metallic frame with 25%/50%/75% tick notches, glass highlight & end-caps;
 * 4. `HUD_Bar_Composite_Preview`: Merged preview at 78% fill + 18% delayed damage trail;
 * 5. `godotProgressBarTscn`: Complete Godot 4 `Control` scene with `DamageTrailBar`, `MainFillBar`, and `ShieldOverlayBar`.
 */
export function synthesizeHudProgressBarKit(
  _rawRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    preset?: HudBarColorPreset
    stylePreset?: UiStylePreset
    resourceName?: string
  }
): HudProgressBarKitResult {
  const w = Math.max(16, Math.floor(width))
  const h = Math.max(16, Math.floor(height))
  const preset: HudBarColorPreset = options?.preset ?? 'hp_crimson'
  const stylePreset: UiStylePreset = options?.stylePreset ?? 'dark_iron_parchment'

  const palettes: Record<
    HudBarColorPreset,
    {
      dark: [number, number, number]
      main: [number, number, number]
      glow: [number, number, number]
      frame: [number, number, number]
    }
  > = {
    hp_crimson: {
      dark: [118, 16, 28],
      main: [232, 38, 58],
      glow: [255, 168, 178],
      frame: [212, 178, 108]
    },
    shield_cyan: {
      dark: [16, 78, 138],
      main: [38, 198, 248],
      glow: [204, 248, 255],
      frame: [168, 204, 232]
    },
    mana_violet: {
      dark: [58, 18, 124],
      main: [158, 68, 248],
      glow: [236, 198, 255],
      frame: [188, 162, 228]
    },
    xp_gold: {
      dark: [132, 78, 12],
      main: [248, 188, 28],
      glow: [255, 246, 178],
      frame: [228, 196, 118]
    },
    boss_inferno: {
      dark: [96, 12, 18],
      main: [248, 88, 24],
      glow: [255, 228, 128],
      frame: [238, 184, 78]
    }
  }
  const pal = palettes[preset] ?? palettes.hp_crimson
  const styleTheme = getUiStyleThemeColors(stylePreset)
  const frameColor: [number, number, number] = [
    Math.round(pal.frame[0] * 0.55 + styleTheme.rim[0] * 0.45),
    Math.round(pal.frame[1] * 0.55 + styleTheme.rim[1] * 0.45),
    Math.round(pal.frame[2] * 0.55 + styleTheme.rim[2] * 0.45)
  ]

  const backplateRgba = new Uint8ClampedArray(w * h * 4)
  const fillStripRgba = new Uint8ClampedArray(w * h * 4)
  const frameOverlayRgba = new Uint8ClampedArray(w * h * 4)
  const compositePreviewRgba = new Uint8ClampedArray(w * h * 4)

  const barTop = Math.round(h * 0.16)
  const barBot = Math.round(h * 0.84)
  const barLeft = Math.round(w * 0.04)
  const barRight = Math.round(w * 0.96)
  const barW = Math.max(4, barRight - barLeft)
  const barH = Math.max(4, barBot - barTop)
  const rimPx = Math.max(2, Math.round(barH * 0.14))

  for (let y = barTop; y < barBot; y++) {
    const v = (y - barTop) / Math.max(1, barH - 1)
    for (let x = barLeft; x < barRight; x++) {
      const u = (x - barLeft) / Math.max(1, barW - 1)
      const idx = (y * w + x) * 4

      // Sub-pixel SDF anti-aliased chamfered bar silhouette
      const cornerDist =
        Math.min(x - barLeft, barRight - 1 - x) + Math.min(y - barTop, barBot - 1 - y)
      const rectDist = Math.min(x - barLeft, barRight - 1 - x, y - barTop, barBot - 1 - y)
      const chamferDist = (cornerDist - rimPx * 1.15) * 0.7071
      const edgeDist = Math.min(rectDist, chamferDist)
      if (edgeDist < -0.8) continue
      const outerAA = clamp((edgeDist + 0.8) / 1.5, 0, 1)

      // 1. Backplate: recessed dark obsidian trough with subtle 10% micro-grid
      const innerShadow = v < 0.35 ? 0.62 : v > 0.82 ? 0.78 : 0.95
      const subGrid = Math.abs(u * 10 - Math.round(u * 10)) < 0.035 ? 8 : 0
      backplateRgba[idx] = clampByte(styleTheme.bg[0] * 0.65 * innerShadow + subGrid)
      backplateRgba[idx + 1] = clampByte(styleTheme.bg[1] * 0.65 * innerShadow + subGrid)
      backplateRgba[idx + 2] = clampByte(styleTheme.bg[2] * 0.75 * innerShadow + subGrid)
      backplateRgba[idx + 3] = clampByte(246 * outerAA)

      // 2. Fill Strip (inside rim): cylindrical glass tube + energy wave + 10% segment groove
      const fillAA = clamp((edgeDist - rimPx + 0.8) / 1.5, 0, 1)
      if (fillAA > 0) {
        const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * 8 - v * 1.8)
        const cylShade = 1.08 - Math.pow(Math.abs(v - 0.45) * 1.45, 2) * 0.48
        const topSpec = Math.pow(Math.max(0, 1 - Math.abs(v - 0.25) * 3.8), 2)
        const segDist = Math.abs(u * 10 - Math.round(u * 10))
        const segWeight = u > 0.05 && u < 0.95 ? clamp((0.028 - segDist) / 0.016, 0, 1) : 0
        const segDip = 1 - segWeight * 0.24
        const baseR =
          (pal.dark[0] * (1 - u * 0.55) + pal.main[0] * (0.45 + u * 0.55)) * cylShade * segDip
        const baseG =
          (pal.dark[1] * (1 - u * 0.55) + pal.main[1] * (0.45 + u * 0.55)) * cylShade * segDip
        const baseB =
          (pal.dark[2] * (1 - u * 0.55) + pal.main[2] * (0.45 + u * 0.55)) * cylShade * segDip
        fillStripRgba[idx] = clampByte(baseR + wave * 14 + pal.glow[0] * topSpec * 0.52)
        fillStripRgba[idx + 1] = clampByte(baseG + wave * 14 + pal.glow[1] * topSpec * 0.52)
        fillStripRgba[idx + 2] = clampByte(baseB + wave * 14 + pal.glow[2] * topSpec * 0.52)
        fillStripRgba[idx + 3] = clampByte(255 * fillAA)
      }

      // 3. Frame Overlay: metallic rim + end-cap gems + 25%/50%/75% gauge ticks + top glass reflection
      const isMajorTick =
        (v < 0.36 || v > 0.76) &&
        (Math.abs(u - 0.25) < 0.009 || Math.abs(u - 0.5) < 0.012 || Math.abs(u - 0.75) < 0.009)
      const isEndCapGem =
        Math.abs(v - 0.5) < 0.16 && (Math.abs(u - 0.018) < 0.012 || Math.abs(u - 0.982) < 0.012)
      const rimBandAA = isMajorTick
        ? outerAA
        : clamp((rimPx - edgeDist + 0.65) / 1.3, 0, 1) * outerAA
      if (isEndCapGem) {
        frameOverlayRgba[idx] = pal.glow[0]
        frameOverlayRgba[idx + 1] = pal.glow[1]
        frameOverlayRgba[idx + 2] = pal.glow[2]
        frameOverlayRgba[idx + 3] = clampByte(255 * outerAA)
      } else if (rimBandAA > 0.02) {
        const bevel = v < 0.48 ? 1.22 : 0.74
        frameOverlayRgba[idx] = clampByte(frameColor[0] * bevel)
        frameOverlayRgba[idx + 1] = clampByte(frameColor[1] * bevel)
        frameOverlayRgba[idx + 2] = clampByte(frameColor[2] * bevel)
        frameOverlayRgba[idx + 3] = clampByte(255 * rimBandAA)
      } else if (v >= 0.16 && v <= 0.28) {
        // Subtle upper glass highlight across bar interior
        frameOverlayRgba[idx] = 255
        frameOverlayRgba[idx + 1] = 255
        frameOverlayRgba[idx + 2] = 255
        frameOverlayRgba[idx + 3] = clampByte(44 * outerAA)
      }

      // 4. Composite Preview (74% primary fill + 74%..88% white delayed damage catch-up trail)
      let cR = backplateRgba[idx]!
      let cG = backplateRgba[idx + 1]!
      let cB = backplateRgba[idx + 2]!
      const cA = backplateRgba[idx + 3]!
      if (fillAA > 0) {
        if (u <= 0.74) {
          cR = fillStripRgba[idx]!
          cG = fillStripRgba[idx + 1]!
          cB = fillStripRgba[idx + 2]!
        } else if (u <= 0.88) {
          cR = 255
          cG = 238
          cB = 196
        }
      }
      const fA = frameOverlayRgba[idx + 3]! / 255
      compositePreviewRgba[idx] = clampByte(frameOverlayRgba[idx]! * fA + cR * (1 - fA))
      compositePreviewRgba[idx + 1] = clampByte(frameOverlayRgba[idx + 1]! * fA + cG * (1 - fA))
      compositePreviewRgba[idx + 2] = clampByte(frameOverlayRgba[idx + 2]! * fA + cB * (1 - fA))
      compositePreviewRgba[idx + 3] = Math.max(cA, frameOverlayRgba[idx + 3]!)
    }
  }

  const resName = (options?.resourceName ?? 'hud_bar').trim() || 'hud_bar'
  const godotProgressBarTscn = [
    '[gd_scene load_steps=4 format=3]',
    '',
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_backplate.png" id="1_under"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_fill.png" id="2_fill"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_frame.png" id="3_over"]`,
    '',
    `[node name="${resName}_HUD" type="Control"]`,
    `custom_minimum_size = Vector2(${w}, ${h})`,
    'layout_mode = 3',
    '',
    '[node name="DamageTrailBar" type="TextureProgressBar" parent="."]',
    'layout_mode = 1',
    'anchors_preset = 15',
    'value = 88.0',
    'nine_patch_stretch = true',
    'texture_under = ExtResource("1_under")',
    'texture_progress = ExtResource("2_fill")',
    'tint_progress = Color(1, 0.95, 0.82, 1)',
    '',
    '[node name="MainHealthBar" type="TextureProgressBar" parent="."]',
    'layout_mode = 1',
    'anchors_preset = 15',
    'value = 74.0',
    'nine_patch_stretch = true',
    'texture_over = ExtResource("3_over")',
    'texture_progress = ExtResource("2_fill")',
    ''
  ].join('\n')

  return {
    width: w,
    height: h,
    preset,
    stylePreset,
    nineSliceBorders: {
      left: barLeft + rimPx * 2,
      right: w - barRight + rimPx * 2,
      top: barTop + rimPx,
      bottom: h - barBot + rimPx
    },
    backplateRgba,
    fillStripRgba,
    frameOverlayRgba,
    compositePreviewRgba,
    godotProgressBarTscn
  }
}

export type UiScreenBlueprintPreset =
  | 'blank_canvas'
  | 'combat_hud'
  | 'title_menu'
  | 'inventory_paperdoll'
  | 'skill_tree'
  | 'shop_gacha'
  | 'dialogue_vn'
  | 'quest_victory'
  | 'settings_form'

export interface RadialHudKitResult {
  width: number
  height: number
  stylePreset: UiStylePreset
  minimapCompassRgba: Uint8ClampedArray
  skillSlotFrameRgba: Uint8ClampedArray
  cooldownWipeMaskRgba: Uint8ClampedArray
  actionWheelRgba: Uint8ClampedArray
  godotRadialHudTscn: string
}

export interface DialogueBoxKitResult {
  width: number
  height: number
  stylePreset: UiStylePreset
  nineSliceBorders: NineSliceBorders
  compositePreviewRgba: Uint8ClampedArray
  mainBoxRgba: Uint8ClampedArray
  nameplateAndChoiceRgba: Uint8ClampedArray
  portraitAndCursorRgba: Uint8ClampedArray
  godotDialogueSceneTscn: string
}

export interface UiFormControlsKitResult {
  width: number
  height: number
  stylePreset: UiStylePreset
  atlasSheetRgba: Uint8ClampedArray
  tabsPairRgba: Uint8ClampedArray
  sliderAndScrollRgba: Uint8ClampedArray
  checkboxAndToggleRgba: Uint8ClampedArray
  godotFullControlsThemeTres: string
}

function getUiStyleThemeColors(stylePreset: UiStylePreset): {
  rim: [number, number, number]
  accent: [number, number, number]
  bg: [number, number, number]
} {
  switch (stylePreset) {
    case 'royal_gold_enamel':
      return { rim: [255, 210, 56], accent: [64, 216, 255], bg: [16, 44, 108] }
    case 'arcane_crystal':
      return { rim: [198, 116, 255], accent: [72, 238, 255], bg: [36, 16, 74] }
    case 'cyber_holo_grid':
      return { rim: [0, 242, 255], accent: [255, 42, 156], bg: [6, 18, 32] }
    case 'ink_paper_cel':
      return { rim: [42, 36, 32], accent: [204, 42, 42], bg: [236, 226, 206] }
    case 'celestial_star_gold':
      return { rim: [230, 200, 140], accent: [118, 218, 255], bg: [22, 28, 52] }
    case 'persona_rebel_red':
      return { rim: [238, 22, 42], accent: [252, 248, 248], bg: [14, 12, 16] }
    case 'minimal_ark_tech':
      return { rim: [226, 232, 240], accent: [255, 118, 20], bg: [28, 32, 38] }
    default:
      return { rim: [176, 144, 96], accent: [224, 96, 36], bg: [22, 18, 15] }
  }
}

/**
 * Synthesizes a 4-Part Polar/Radial HUD Kit (`radial_hud_kit`):
 * 1. `Radial_Minimap_Compass_Ring`: Circular minimap border with 360° degree ticks, N/E/S/W cardinal markers & radar sweep;
 * 2. `Radial_Skill_Slot_Frame`: Action skill slot with bevel rim & bottom-right hotkey socket;
 * 3. `Radial_Cooldown_Wipe_Mask`: 360° clockwise angular gradient (0..255) for `TextureProgressBar (FILL_CLOCKWISE)` or radial wipe shader;
 * 4. `Radial_Action_Wheel_8Sector`: 8-way gamepad radial weapon/item wheel with active highlighted sector.
 */
export function synthesizeRadialHudKit(
  rawRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    stylePreset?: UiStylePreset
    resourceName?: string
  }
): RadialHudKitResult {
  const w = Math.max(16, Math.floor(width))
  const h = Math.max(16, Math.floor(height))
  const stylePreset: UiStylePreset = options?.stylePreset ?? 'dark_iron_parchment'
  const theme = getUiStyleThemeColors(stylePreset)

  const minimapCompassRgba = new Uint8ClampedArray(w * h * 4)
  const skillSlotFrameRgba = new Uint8ClampedArray(w * h * 4)
  const cooldownWipeMaskRgba = new Uint8ClampedArray(w * h * 4)
  const actionWheelRgba = new Uint8ClampedArray(w * h * 4)

  const cx = (w - 1) * 0.5
  const cy = (h - 1) * 0.5
  const maxR = Math.min(w, h) * 0.46

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const dx = x - cx
      const dy = y - cy
      const r = Math.hypot(dx, dy)
      const normR = r / Math.max(1, maxR)
      // Clockwise angle starting at 12 o'clock (0..1)
      const angleRad = Math.atan2(dx, -dy)
      const cwPhase = (angleRad < 0 ? angleRad + Math.PI * 2 : angleRad) / (Math.PI * 2)

      // 1. Minimap & 360° Compass Ring (sub-pixel SDF anti-aliased)
      const mmOuterAA = clamp((maxR * 1.02 + 0.75 - r) / 1.4, 0, 1)
      if (mmOuterAA > 0) {
        if (normR >= 0.84) {
          const isCardinal =
            Math.abs(cwPhase - 0) < 0.02 ||
            Math.abs(cwPhase - 1) < 0.02 ||
            Math.abs(cwPhase - 0.25) < 0.02 ||
            Math.abs(cwPhase - 0.5) < 0.02 ||
            Math.abs(cwPhase - 0.75) < 0.02
          const isDegreeTick = Math.abs(cwPhase * 36 - Math.round(cwPhase * 36)) < 0.12
          const mul = isCardinal ? 1.35 : isDegreeTick && normR < 0.92 ? 1.15 : 0.88
          minimapCompassRgba[idx] = clampByte((isCardinal ? theme.accent[0] : theme.rim[0]) * mul)
          minimapCompassRgba[idx + 1] = clampByte(
            (isCardinal ? theme.accent[1] : theme.rim[1]) * mul
          )
          minimapCompassRgba[idx + 2] = clampByte(
            (isCardinal ? theme.accent[2] : theme.rim[2]) * mul
          )
          minimapCompassRgba[idx + 3] = clampByte(255 * mmOuterAA)
        } else {
          // Radar grid + subtle terrain tint inside minimap
          const ringGrid =
            Math.abs(normR - 0.42) < 0.018 || Math.abs(dx) < 0.8 || Math.abs(dy) < 0.8
          const sweepGlow = Math.max(0, 1 - ((cwPhase - 0.18 + 1) % 1) * 4.5) * 0.45
          minimapCompassRgba[idx] = clampByte(
            theme.bg[0] + (ringGrid ? 42 : 0) + theme.accent[0] * sweepGlow
          )
          minimapCompassRgba[idx + 1] = clampByte(
            theme.bg[1] + (ringGrid ? 58 : 0) + theme.accent[1] * sweepGlow
          )
          minimapCompassRgba[idx + 2] = clampByte(
            theme.bg[2] + (ringGrid ? 68 : 0) + theme.accent[2] * sweepGlow
          )
          minimapCompassRgba[idx + 3] = 228
        }
      }

      // 2. Skill Slot Frame + Hotkey Socket (bottom-right)
      const boxDist = Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, maxR * 0.88)
      const hkRadius = Math.max(1, maxR * 0.24)
      const hkRawDist = Math.hypot(x - w * 0.76, y - h * 0.76)
      const hkDist = hkRawDist / hkRadius
      const hkAA = clamp((hkRadius + 0.7 - hkRawDist) / 1.35, 0, 1)
      if (hkAA > 0) {
        const isHkRim = hkDist >= 0.74
        skillSlotFrameRgba[idx] = isHkRim ? theme.accent[0] : theme.bg[0]
        skillSlotFrameRgba[idx + 1] = isHkRim ? theme.accent[1] : theme.bg[1]
        skillSlotFrameRgba[idx + 2] = isHkRim ? theme.accent[2] : theme.bg[2]
        skillSlotFrameRgba[idx + 3] = clampByte(255 * hkAA)
      } else if (boxDist <= 1.0) {
        if (boxDist >= 0.82) {
          const bevel = dy < 0 ? 1.18 : 0.78
          skillSlotFrameRgba[idx] = clampByte(theme.rim[0] * bevel)
          skillSlotFrameRgba[idx + 1] = clampByte(theme.rim[1] * bevel)
          skillSlotFrameRgba[idx + 2] = clampByte(theme.rim[2] * bevel)
          skillSlotFrameRgba[idx + 3] = 255
        } else {
          // Sample upstream icon art inside slot viewport, darkened on cooldown sector (cwPhase < 0.35)
          const cdDim = cwPhase < 0.35 ? 0.42 : 1.0
          const isSweepLine = Math.abs(cwPhase - 0.35) < 0.014
          skillSlotFrameRgba[idx] = clampByte(isSweepLine ? 255 : (rawRgba[idx] ?? 60) * cdDim)
          skillSlotFrameRgba[idx + 1] = clampByte(
            isSweepLine ? 245 : (rawRgba[idx + 1] ?? 120) * cdDim
          )
          skillSlotFrameRgba[idx + 2] = clampByte(
            isSweepLine ? 190 : (rawRgba[idx + 2] ?? 180) * cdDim
          )
          skillSlotFrameRgba[idx + 3] = 255
        }
      }

      // 3. 360° Clockwise Cooldown Wipe Mask
      const cdOuterAA = clamp((maxR + 0.75 - r) / 1.4, 0, 1)
      if (cdOuterAA > 0) {
        const rampVal = clampByte(cwPhase * 255)
        const ringAlpha = (normR >= 0.18 ? 255 : clampByte((normR / 0.18) * 255)) * cdOuterAA
        cooldownWipeMaskRgba[idx] = rampVal
        cooldownWipeMaskRgba[idx + 1] = clampByte((1 - Math.abs(normR - 0.65)) * 255)
        cooldownWipeMaskRgba[idx + 2] = clampByte((1 - cwPhase) * 255)
        cooldownWipeMaskRgba[idx + 3] = clampByte(ringAlpha)
      }

      // 4. 8-Sector Radial Action Wheel
      const wheelAA =
        clamp((r - maxR * 0.34 + 0.7) / 1.4, 0, 1) * clamp((maxR * 0.98 + 0.7 - r) / 1.4, 0, 1)
      if (wheelAA > 0) {
        const sectorIdx = Math.floor(cwPhase * 8) % 8
        const sectorPhase = cwPhase * 8 - Math.floor(cwPhase * 8)
        const isGap = sectorPhase < 0.045 || sectorPhase > 0.955
        if (!isGap) {
          const isSelected = sectorIdx === 1
          const isRim = normR <= 0.4 || normR >= 0.92
          const col = isSelected ? theme.accent : isRim ? theme.rim : theme.bg
          const mul = isSelected && !isRim ? 0.85 : 1.0
          actionWheelRgba[idx] = clampByte(col[0] * mul)
          actionWheelRgba[idx + 1] = clampByte(col[1] * mul)
          actionWheelRgba[idx + 2] = clampByte(col[2] * mul)
          actionWheelRgba[idx + 3] = clampByte((isSelected ? 245 : 215) * wheelAA)
        }
      }
    }
  }

  const resName = (options?.resourceName ?? 'radial_hud').trim() || 'radial_hud'
  const godotRadialHudTscn = [
    '[gd_scene load_steps=4 format=3]',
    '',
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_minimap_ring.png" id="1_minimap"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_skill_slot.png" id="2_slot"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_cooldown_mask.png" id="3_cd"]`,
    '',
    `[node name="${resName}_PolarHUD" type="CanvasLayer"]`,
    '',
    '[node name="MinimapCompass" type="TextureRect" parent="."]',
    'anchors_preset = 1',
    'offset_left = -180.0',
    'offset_top = 20.0',
    'offset_right = -20.0',
    'offset_bottom = 180.0',
    'texture = ExtResource("1_minimap")',
    '',
    '[node name="SkillCooldownSlot" type="TextureProgressBar" parent="."]',
    'anchors_preset = 7',
    'fill_mode = 4',
    'value = 35.0',
    'texture_under = ExtResource("2_slot")',
    'texture_progress = ExtResource("3_cd")',
    'tint_progress = Color(0.05, 0.07, 0.12, 0.72)',
    ''
  ].join('\n')

  return {
    width: w,
    height: h,
    stylePreset,
    minimapCompassRgba,
    skillSlotFrameRgba,
    cooldownWipeMaskRgba,
    actionWheelRgba,
    godotRadialHudTscn
  }
}

/**
 * Synthesizes a 4-Part RPG / Visual Novel Dialogue Box Kit (`dialogue_kit`):
 * 1. `Dialogue_Composite_Preview`: Combined preview of main box, speaker nameplate, portrait frame, choice pill & bounce cursor;
 * 2. `Dialogue_Main_Box_9Slice`: 9-slice main dialogue box with semi-transparent dark vignette & ornate corners;
 * 3. `Dialogue_Nameplate_And_Choice`: Floating speaker nameplate ribbon + branching choice button pill;
 * 4. `Dialogue_Portrait_And_Cursor`: Character bust socket frame + glowing next-page bounce cursor (`▼`).
 */
export function synthesizeDialogueBoxKit(
  rawRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    stylePreset?: UiStylePreset
    resourceName?: string
  }
): DialogueBoxKitResult {
  const w = Math.max(16, Math.floor(width))
  const h = Math.max(16, Math.floor(height))
  const stylePreset: UiStylePreset = options?.stylePreset ?? 'dark_iron_parchment'
  const theme = getUiStyleThemeColors(stylePreset)

  const compositePreviewRgba = new Uint8ClampedArray(w * h * 4)
  const mainBoxRgba = new Uint8ClampedArray(w * h * 4)
  const nameplateAndChoiceRgba = new Uint8ClampedArray(w * h * 4)
  const portraitAndCursorRgba = new Uint8ClampedArray(w * h * 4)

  const rimPx = Math.max(3, Math.round(Math.min(w, h) * 0.06))

  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1)
      const idx = (y * w + x) * 4

      // 1. Main Box 9-Slice (full canvas with 8% margin)
      const mx0 = Math.round(w * 0.06)
      const mx1 = Math.round(w * 0.94)
      const my0 = Math.round(h * 0.12)
      const my1 = Math.round(h * 0.92)
      if (x >= mx0 && x < mx1 && y >= my0 && y < my1) {
        const edgeDist = Math.min(x - mx0, mx1 - 1 - x, y - my0, my1 - 1 - y)
        const cornerDist = Math.min(x - mx0, mx1 - 1 - x) + Math.min(y - my0, my1 - 1 - y)
        if (edgeDist < rimPx || cornerDist < rimPx * 2.2) {
          const isCornerGem = cornerDist < rimPx * 1.8 && edgeDist >= 1
          const col = isCornerGem ? theme.accent : theme.rim
          mainBoxRgba[idx] = col[0]
          mainBoxRgba[idx + 1] = col[1]
          mainBoxRgba[idx + 2] = col[2]
          mainBoxRgba[idx + 3] = 255
        } else {
          const grad = 0.85 + v * 0.25
          mainBoxRgba[idx] = clampByte(theme.bg[0] * grad)
          mainBoxRgba[idx + 1] = clampByte(theme.bg[1] * grad)
          mainBoxRgba[idx + 2] = clampByte(theme.bg[2] * grad)
          mainBoxRgba[idx + 3] = 232
        }
      }

      // 2. Nameplate Ribbon (top band) & Choice Pill (bottom band)
      const inNameplate = u >= 0.1 && u <= 0.68 && v >= 0.16 && v <= 0.42
      const inChoice = u >= 0.08 && u <= 0.92 && v >= 0.56 && v <= 0.84
      if (inNameplate || inChoice) {
        const bx0 = inNameplate ? Math.round(w * 0.1) : Math.round(w * 0.08)
        const bx1 = inNameplate ? Math.round(w * 0.68) : Math.round(w * 0.92)
        const by0 = inNameplate ? Math.round(h * 0.16) : Math.round(h * 0.56)
        const by1 = inNameplate ? Math.round(h * 0.42) : Math.round(h * 0.84)
        const eDist = Math.min(x - bx0, bx1 - 1 - x, y - by0, by1 - 1 - y)
        const isRim = eDist < Math.max(2, Math.round(rimPx * 0.65))
        const col = isRim ? (inNameplate ? theme.accent : theme.rim) : theme.bg
        nameplateAndChoiceRgba[idx] = col[0]
        nameplateAndChoiceRgba[idx + 1] = col[1]
        nameplateAndChoiceRgba[idx + 2] = col[2]
        nameplateAndChoiceRgba[idx + 3] = isRim ? 255 : 238
      }

      // 3. Portrait Socket (left square) + Continue Bounce Cursor (bottom-right triangle)
      const inPortrait = u >= 0.08 && u <= 0.62 && v >= 0.18 && v <= 0.82
      const cxCursor = u - 0.82
      const cyCursor = v - 0.72
      const inCursorTriangle =
        cyCursor >= -0.08 && cyCursor <= 0.08 && Math.abs(cxCursor) <= (0.08 - cyCursor) * 0.75
      if (inPortrait) {
        const px0 = Math.round(w * 0.08)
        const px1 = Math.round(w * 0.62)
        const py0 = Math.round(h * 0.18)
        const py1 = Math.round(h * 0.82)
        const eDist = Math.min(x - px0, px1 - 1 - x, y - py0, py1 - 1 - y)
        if (eDist < rimPx) {
          portraitAndCursorRgba[idx] = theme.rim[0]
          portraitAndCursorRgba[idx + 1] = theme.rim[1]
          portraitAndCursorRgba[idx + 2] = theme.rim[2]
          portraitAndCursorRgba[idx + 3] = 255
        } else {
          portraitAndCursorRgba[idx] = rawRgba[idx] ?? 90
          portraitAndCursorRgba[idx + 1] = rawRgba[idx + 1] ?? 130
          portraitAndCursorRgba[idx + 2] = rawRgba[idx + 2] ?? 190
          portraitAndCursorRgba[idx + 3] = 255
        }
      } else if (inCursorTriangle) {
        portraitAndCursorRgba[idx] = theme.accent[0]
        portraitAndCursorRgba[idx + 1] = theme.accent[1]
        portraitAndCursorRgba[idx + 2] = theme.accent[2]
        portraitAndCursorRgba[idx + 3] = 255
      }

      // 4. Composite Preview (Dialogue layout: choice pill at top, dialogue box at bottom, nameplate on top-left of box)
      const inCompBox = u >= 0.05 && u <= 0.95 && v >= 0.46 && v <= 0.94
      const inCompName = u >= 0.09 && u <= 0.46 && v >= 0.36 && v <= 0.52
      const inCompChoice = u >= 0.18 && u <= 0.82 && v >= 0.1 && v <= 0.26
      if (inCompName) {
        const isEdge = u < 0.11 || u > 0.44 || v < 0.38 || v > 0.5
        const col = isEdge ? theme.accent : theme.bg
        compositePreviewRgba[idx] = col[0]
        compositePreviewRgba[idx + 1] = col[1]
        compositePreviewRgba[idx + 2] = col[2]
        compositePreviewRgba[idx + 3] = 255
      } else if (inCompBox) {
        const isEdge = u < 0.08 || u > 0.92 || v < 0.49 || v > 0.91
        const inMiniPortrait = u >= 0.11 && u <= 0.29 && v >= 0.54 && v <= 0.86
        if (isEdge) {
          compositePreviewRgba[idx] = theme.rim[0]
          compositePreviewRgba[idx + 1] = theme.rim[1]
          compositePreviewRgba[idx + 2] = theme.rim[2]
          compositePreviewRgba[idx + 3] = 255
        } else if (inMiniPortrait) {
          compositePreviewRgba[idx] = rawRgba[idx] ?? 120
          compositePreviewRgba[idx + 1] = rawRgba[idx + 1] ?? 150
          compositePreviewRgba[idx + 2] = rawRgba[idx + 2] ?? 210
          compositePreviewRgba[idx + 3] = 255
        } else {
          compositePreviewRgba[idx] = theme.bg[0]
          compositePreviewRgba[idx + 1] = theme.bg[1]
          compositePreviewRgba[idx + 2] = theme.bg[2]
          compositePreviewRgba[idx + 3] = 238
        }
      } else if (inCompChoice) {
        const isEdge = u < 0.2 || u > 0.8 || v < 0.12 || v > 0.24
        const col = isEdge ? theme.rim : theme.bg
        compositePreviewRgba[idx] = col[0]
        compositePreviewRgba[idx + 1] = col[1]
        compositePreviewRgba[idx + 2] = col[2]
        compositePreviewRgba[idx + 3] = 240
      }
    }
  }

  const resName = (options?.resourceName ?? 'dialogue_kit').trim() || 'dialogue_kit'
  const godotDialogueSceneTscn = [
    '[gd_scene load_steps=4 format=3]',
    '',
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_main_box.png" id="1_box"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_nameplate_choice.png" id="2_name"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_portrait_cursor.png" id="3_port"]`,
    '',
    `[node name="${resName}_DialogueUI" type="CanvasLayer"]`,
    '',
    '[node name="DialogueMainBox" type="NinePatchRect" parent="."]',
    'anchors_preset = 12',
    'offset_left = 120.0',
    'offset_top = -260.0',
    'offset_right = -120.0',
    'offset_bottom = -32.0',
    'texture = ExtResource("1_box")',
    `patch_margin_left = ${rimPx * 2}`,
    `patch_margin_top = ${rimPx * 2}`,
    `patch_margin_right = ${rimPx * 2}`,
    `patch_margin_bottom = ${rimPx * 2}`,
    '',
    '[node name="SpeakerNameplate" type="NinePatchRect" parent="DialogueMainBox"]',
    'offset_left = 28.0',
    'offset_top = -24.0',
    'offset_right = 260.0',
    'offset_bottom = 18.0',
    'texture = ExtResource("2_name")',
    '',
    '[node name="TypewriterRichText" type="RichTextLabel" parent="DialogueMainBox"]',
    'offset_left = 220.0',
    'offset_top = 28.0',
    'offset_right = -36.0',
    'offset_bottom = -28.0',
    'bbcode_enabled = true',
    ''
  ].join('\n')

  return {
    width: w,
    height: h,
    stylePreset,
    nineSliceBorders: {
      left: rimPx * 2,
      right: rimPx * 2,
      top: rimPx * 2,
      bottom: rimPx * 2
    },
    compositePreviewRgba,
    mainBoxRgba,
    nameplateAndChoiceRgba,
    portraitAndCursorRgba,
    godotDialogueSceneTscn
  }
}

/**
 * Synthesizes a Complete UI Form & Settings Controls Kit (`ui_controls_kit`):
 * 1. `UI_Controls_Atlas_Sheet`: Master 2×2 widget atlas (Tabs + Sliders + Checkboxes + Toggle Switches);
 * 2. `UI_Tab_Active_Inactive`: Active illuminated tab vs. Inactive recessed tab;
 * 3. `UI_Slider_And_Scrollbar`: Slider recessed track, glowing fill bar, diamond grabber thumb & scrollbar;
 * 4. `UI_Checkbox_And_Toggle`: Checkbox unchecked/checked with rune checkmark + Pill toggle switch.
 */
export function synthesizeUiFormControlsKit(
  _rawRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    stylePreset?: UiStylePreset
    resourceName?: string
  }
): UiFormControlsKitResult {
  const w = Math.max(16, Math.floor(width))
  const h = Math.max(16, Math.floor(height))
  const stylePreset: UiStylePreset = options?.stylePreset ?? 'dark_iron_parchment'
  const theme = getUiStyleThemeColors(stylePreset)

  const atlasSheetRgba = new Uint8ClampedArray(w * h * 4)
  const tabsPairRgba = new Uint8ClampedArray(w * h * 4)
  const sliderAndScrollRgba = new Uint8ClampedArray(w * h * 4)
  const checkboxAndToggleRgba = new Uint8ClampedArray(w * h * 4)

  const rimPx = Math.max(2, Math.round(Math.min(w, h) * 0.045))

  for (let y = 0; y < h; y++) {
    const v = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const u = x / Math.max(1, w - 1)
      const idx = (y * w + x) * 4

      // 1. Tabs Pair: Top = Active Tab (illuminated top crest), Bottom = Inactive Tab (dimmed)
      const inActiveTab = u >= 0.08 && u <= 0.92 && v >= 0.12 && v <= 0.44
      const inInactiveTab = u >= 0.08 && u <= 0.92 && v >= 0.56 && v <= 0.86
      if (inActiveTab || inInactiveTab) {
        const isTopCrest = inActiveTab && v <= 0.18
        const isSideEdge = u <= 0.12 || u >= 0.88
        const col = isTopCrest ? theme.accent : isSideEdge ? theme.rim : theme.bg
        const mul = inActiveTab ? 1.15 : 0.72
        tabsPairRgba[idx] = clampByte(col[0] * mul)
        tabsPairRgba[idx + 1] = clampByte(col[1] * mul)
        tabsPairRgba[idx + 2] = clampByte(col[2] * mul)
        tabsPairRgba[idx + 3] = 255
      }

      // 2. Slider Track + Fill + Grabber Thumb (top) & Scrollbar (bottom)
      const inSliderTrack = u >= 0.08 && u <= 0.92 && v >= 0.24 && v <= 0.38
      const grabberDist = Math.abs(u - 0.64) + Math.abs(v - 0.31)
      const inScrollTrack = u >= 0.08 && u <= 0.92 && v >= 0.66 && v <= 0.78
      if (grabberDist <= 0.13) {
        const isGrabberRim = grabberDist >= 0.09
        const col = isGrabberRim ? theme.rim : theme.accent
        sliderAndScrollRgba[idx] = col[0]
        sliderAndScrollRgba[idx + 1] = col[1]
        sliderAndScrollRgba[idx + 2] = col[2]
        sliderAndScrollRgba[idx + 3] = 255
      } else if (inSliderTrack) {
        const isFilled = u <= 0.64
        const col = isFilled ? theme.accent : theme.bg
        sliderAndScrollRgba[idx] = col[0]
        sliderAndScrollRgba[idx + 1] = col[1]
        sliderAndScrollRgba[idx + 2] = col[2]
        sliderAndScrollRgba[idx + 3] = 255
      } else if (inScrollTrack) {
        const isThumb = u >= 0.28 && u <= 0.58
        const col = isThumb ? theme.rim : theme.bg
        sliderAndScrollRgba[idx] = col[0]
        sliderAndScrollRgba[idx + 1] = col[1]
        sliderAndScrollRgba[idx + 2] = col[2]
        sliderAndScrollRgba[idx + 3] = 255
      }

      // 3. Checkbox (top-left unchecked, top-right checked) + Toggle Switch (bottom pill)
      const inCbUnchecked = u >= 0.12 && u <= 0.42 && v >= 0.12 && v <= 0.42
      const inCbChecked = u >= 0.56 && u <= 0.86 && v >= 0.12 && v <= 0.42
      const inTogglePill = u >= 0.18 && u <= 0.82 && v >= 0.58 && v <= 0.84
      if (inCbUnchecked || inCbChecked) {
        const bx = inCbUnchecked ? u - 0.27 : u - 0.71
        const by = v - 0.27
        const isRim = Math.max(Math.abs(bx), Math.abs(by)) >= 0.11
        const isCheckmark =
          inCbChecked &&
          Math.abs(bx) <= 0.07 &&
          Math.abs(by) <= 0.07 &&
          (Math.abs(bx + by * 0.8) < 0.028 || Math.abs(bx - by * 0.9) < 0.028)
        const col = isCheckmark ? theme.accent : isRim ? theme.rim : theme.bg
        checkboxAndToggleRgba[idx] = col[0]
        checkboxAndToggleRgba[idx + 1] = col[1]
        checkboxAndToggleRgba[idx + 2] = col[2]
        checkboxAndToggleRgba[idx + 3] = 255
      } else if (inTogglePill) {
        const isKnob = Math.hypot(u - 0.66, v - 0.71) <= 0.1
        const isEdge = u < 0.21 || u > 0.79 || v < 0.61 || v > 0.81
        const col = isKnob ? theme.accent : isEdge ? theme.rim : theme.bg
        checkboxAndToggleRgba[idx] = col[0]
        checkboxAndToggleRgba[idx + 1] = col[1]
        checkboxAndToggleRgba[idx + 2] = col[2]
        checkboxAndToggleRgba[idx + 3] = 255
      }

      // 4. Master Atlas Sheet (combines Tabs in top-left, Slider in top-right, Checkbox in bottom-left, Toggle in bottom-right)
      const sx = Math.min(w - 1, (x % Math.max(1, Math.floor(w / 2))) * 2)
      const sy = Math.min(h - 1, (y % Math.max(1, Math.floor(h / 2))) * 2)
      const sIdx = (sy * w + sx) * 4
      const quadSrc =
        y < h / 2
          ? x < w / 2
            ? tabsPairRgba
            : sliderAndScrollRgba
          : x < w / 2
            ? checkboxAndToggleRgba
            : sliderAndScrollRgba
      atlasSheetRgba[idx] = quadSrc[sIdx]!
      atlasSheetRgba[idx + 1] = quadSrc[sIdx + 1]!
      atlasSheetRgba[idx + 2] = quadSrc[sIdx + 2]!
      atlasSheetRgba[idx + 3] = quadSrc[sIdx + 3]!
    }
  }

  const resName = (options?.resourceName ?? 'ui_controls').trim() || 'ui_controls'
  const godotFullControlsThemeTres = [
    '[gd_resource type="Theme" load_steps=6 format=3]',
    '',
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_tabs.png" id="1_tabs"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_slider.png" id="2_slider"]`,
    `[ext_resource type="Texture2D" path="res://assets/ui/${resName}_checkbox.png" id="3_cb"]`,
    '',
    '[sub_resource type="StyleBoxTexture" id="StyleBox_tab_selected"]',
    'texture = ExtResource("1_tabs")',
    `texture_margin_left = ${rimPx * 2}`,
    `texture_margin_right = ${rimPx * 2}`,
    '',
    '[sub_resource type="StyleBoxTexture" id="StyleBox_slider_rail"]',
    'texture = ExtResource("2_slider")',
    '',
    '[resource]',
    'TabContainer/styles/tab_selected = SubResource("StyleBox_tab_selected")',
    'HSlider/styles/slider = SubResource("StyleBox_slider_rail")',
    'CheckBox/icons/checked = ExtResource("3_cb")',
    ''
  ].join('\n')

  return {
    width: w,
    height: h,
    stylePreset,
    atlasSheetRgba,
    tabsPairRgba,
    sliderAndScrollRgba,
    checkboxAndToggleRgba,
    godotFullControlsThemeTres
  }
}

/**
 * Exports a complete 1920×1080 (16:9) Godot 4 `CanvasLayer` Full-Screen UI Blueprint (`.tscn`)
 * for any of the 4 commercial game screen archetypes (`combat_hud`, `inventory_paperdoll`, `dialogue_vn`, `settings_form`).
 */
export function exportGodotFullScreenUiTscn(
  blueprint: UiScreenBlueprintPreset,
  stylePreset: UiStylePreset = 'dark_iron_parchment',
  resourceName = 'game_ui_screen'
): string {
  const safeName = resourceName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'game_ui_screen'
  if (blueprint === 'blank_canvas') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_CustomFreeformScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      ''
    ].join('\n')
  }
  if (blueprint === 'title_menu') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_TitleMenuScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="TitleLogoBanner" type="TextureRect" parent="."]',
      'anchors_preset = 5',
      'offset_left = -460.0',
      'offset_top = 110.0',
      'offset_right = 460.0',
      'offset_bottom = 350.0',
      '',
      '[node name="MainMenuButtonsVBox" type="VBoxContainer" parent="."]',
      'anchors_preset = 8',
      'offset_left = -220.0',
      'offset_top = -40.0',
      'offset_right = 220.0',
      'offset_bottom = 360.0',
      ''
    ].join('\n')
  }
  if (blueprint === 'skill_tree') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_SkillTreeScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="ConstellationGraphCanvas" type="Control" parent="."]',
      'anchors_preset = 15',
      '',
      '[node name="SkillDetailInspector" type="NinePatchRect" parent="."]',
      'anchors_preset = 11',
      'offset_left = -520.0',
      'offset_top = 96.0',
      'offset_right = -48.0',
      'offset_bottom = -96.0',
      ''
    ].join('\n')
  }
  if (blueprint === 'shop_gacha') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_ShopGachaScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="TopCurrencyHeader" type="HBoxContainer" parent="."]',
      'anchors_preset = 1',
      'offset_left = -640.0',
      'offset_top = 28.0',
      'offset_right = -40.0',
      'offset_bottom = 84.0',
      '',
      '[node name="BannerCardsHBox" type="HBoxContainer" parent="."]',
      'anchors_preset = 8',
      'offset_left = -760.0',
      'offset_top = -320.0',
      'offset_right = 760.0',
      'offset_bottom = 280.0',
      ''
    ].join('\n')
  }
  if (blueprint === 'quest_victory') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_QuestVictoryScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="VictoryBannerTitle" type="Label" parent="."]',
      'anchors_preset = 5',
      'offset_left = -420.0',
      'offset_top = 80.0',
      'offset_right = 420.0',
      'offset_bottom = 190.0',
      '',
      '[node name="LootRewardsHBox" type="HBoxContainer" parent="."]',
      'anchors_preset = 8',
      'offset_left = -520.0',
      'offset_top = -140.0',
      'offset_right = 520.0',
      'offset_bottom = 120.0',
      ''
    ].join('\n')
  }
  if (blueprint === 'inventory_paperdoll') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_InventoryScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="RootMargin" type="MarginContainer" parent="."]',
      'anchors_preset = 15',
      'offset_right = 1920.0',
      'offset_bottom = 1080.0',
      '',
      '[node name="MainHSplit" type="HSplitContainer" parent="RootMargin"]',
      'layout_mode = 2',
      '',
      '[node name="CharacterPaperdollPanel" type="NinePatchRect" parent="RootMargin/MainHSplit"]',
      'custom_minimum_size = Vector2(520, 860)',
      'layout_mode = 2',
      '',
      '[node name="BagGridPanel" type="VBoxContainer" parent="RootMargin/MainHSplit"]',
      'layout_mode = 2',
      '',
      '[node name="CategoryTabBar" type="TabBar" parent="RootMargin/MainHSplit/BagGridPanel"]',
      'layout_mode = 2',
      'tab_count = 4',
      '',
      '[node name="ItemSlotGrid" type="GridContainer" parent="RootMargin/MainHSplit/BagGridPanel"]',
      'layout_mode = 2',
      'columns = 4',
      ''
    ].join('\n')
  }
  if (blueprint === 'dialogue_vn') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_DialogueScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="BranchingChoiceStack" type="VBoxContainer" parent="."]',
      'anchors_preset = 8',
      'offset_left = -320.0',
      'offset_top = -180.0',
      'offset_right = 320.0',
      'offset_bottom = 20.0',
      '',
      '[node name="DialogueMainBox" type="NinePatchRect" parent="."]',
      'anchors_preset = 12',
      'offset_left = 140.0',
      'offset_top = -280.0',
      'offset_right = -140.0',
      'offset_bottom = -36.0',
      '',
      '[node name="SpeakerNameplate" type="NinePatchRect" parent="DialogueMainBox"]',
      'offset_left = 32.0',
      'offset_top = -28.0',
      'offset_right = 280.0',
      'offset_bottom = 16.0',
      '',
      '[node name="PortraitSocket" type="TextureRect" parent="DialogueMainBox"]',
      'offset_left = 24.0',
      'offset_top = 24.0',
      'offset_right = 204.0',
      'offset_bottom = 204.0',
      ''
    ].join('\n')
  }
  if (blueprint === 'settings_form') {
    return [
      '[gd_scene format=3]',
      '',
      `[node name="${safeName}_SettingsScreen" type="CanvasLayer"]`,
      `metadata/ui_style_preset = "${stylePreset}"`,
      '',
      '[node name="SettingsModalWindow" type="NinePatchRect" parent="."]',
      'anchors_preset = 8',
      'offset_left = -460.0',
      'offset_top = -340.0',
      'offset_right = 460.0',
      'offset_bottom = 340.0',
      '',
      '[node name="SettingsTabs" type="TabContainer" parent="SettingsModalWindow"]',
      'anchors_preset = 15',
      '',
      '[node name="AudioVideoPage" type="VBoxContainer" parent="SettingsModalWindow/SettingsTabs"]',
      'layout_mode = 2',
      '',
      '[node name="MasterVolumeSlider" type="HSlider" parent="SettingsModalWindow/SettingsTabs/AudioVideoPage"]',
      'layout_mode = 2',
      'value = 82.0',
      '',
      '[node name="FullscreenCheckBox" type="CheckBox" parent="SettingsModalWindow/SettingsTabs/AudioVideoPage"]',
      'layout_mode = 2',
      'button_pressed = true',
      ''
    ].join('\n')
  }
  return [
    '[gd_scene format=3]',
    '',
    `[node name="${safeName}_CombatHUD" type="CanvasLayer"]`,
    `metadata/ui_style_preset = "${stylePreset}"`,
    '',
    '[node name="TopLeftPlayerStatus" type="HBoxContainer" parent="."]',
    'offset_left = 28.0',
    'offset_top = 24.0',
    'offset_right = 480.0',
    'offset_bottom = 116.0',
    '',
    '[node name="BossInfernoBar" type="TextureProgressBar" parent="."]',
    'anchors_preset = 5',
    'offset_left = -340.0',
    'offset_top = 22.0',
    'offset_right = 340.0',
    'offset_bottom = 68.0',
    'value = 74.0',
    '',
    '[node name="TopRightMinimapCompass" type="TextureRect" parent="."]',
    'anchors_preset = 1',
    'offset_left = -196.0',
    'offset_top = 24.0',
    'offset_right = -24.0',
    'offset_bottom = 196.0',
    '',
    '[node name="BottomActionSkillBar" type="HBoxContainer" parent="."]',
    'anchors_preset = 7',
    'offset_left = -220.0',
    'offset_top = -108.0',
    'offset_right = 220.0',
    'offset_bottom = -24.0',
    ''
  ].join('\n')
}

function parseHexRgbOrDefault(
  hex: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback
  const clean = hex.trim().replace(/^#/, '')
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b]
    }
  }
  return fallback
}

function toRenderableUiLabel(raw: string, fallback = 'UI'): string {
  const mapped = raw
    .replace(/^(btn|lyr|ui|left|right|top|bottom|featured)[_-]+/gi, '')
    .replace(/[_-]+(showcase|center|left|right|top|bottom|mid|panel|frame)$/gi, '')
    .replace(/5star/gi, '5* SSR')
    .replace(/4star/gi, '4* SR')
    .replace(/character/gi, 'ASTRAL HERO')
    .replace(/enter[_-\s]*world/gi, 'ENTER WORLD')
    .replace(/continue[_-\s]*save/gi, 'CONTINUE')
    .replace(/options/gi, 'SETTINGS')
    .replace(/leave[_-\s]*domain/gi, 'CLAIM REWARDS')
    .replace(/retry[_-\s]*domain/gi, 'RETRY DOMAIN')
    .replace(/进入|开始|启动/g, 'START ') // cjk-ok
    .replace(/继续|存档/g, 'RESUME ') // cjk-ok
    .replace(/祈愿|抽卡|召唤|寻访/g, 'WISH ') // cjk-ok
    .replace(/十连/g, '10X ') // cjk-ok
    .replace(/单抽/g, '1X ') // cjk-ok
    .replace(/圣遗物|背包|行囊/g, 'ARTIFACTS ') // cjk-ok
    .replace(/武器/g, 'WEAPON ') // cjk-ok
    .replace(/角色|人物/g, 'HERO ') // cjk-ok
    .replace(/命之座|天赋|星盘|技能/g, 'CONSTELLATION ') // cjk-ok
    .replace(/设置|系统/g, 'SETTINGS ') // cjk-ok
    .replace(/原石|星琼|货币/g, 'PRIMOGEM ') // cjk-ok
    .replace(/生命|血量/g, 'HP ') // cjk-ok
    .replace(/护盾|能量/g, 'SHIELD ') // cjk-ok
    .replace(/首领|强敌/g, 'BOSS ') // cjk-ok
    .replace(/对话|剧情/g, 'DIALOGUE ') // cjk-ok
    .replace(/胜利|结算|奖励/g, 'VICTORY ') // cjk-ok
    .replace(/[★✦]/g, '*')
    .replace(/[_-]+/g, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9+/:.%* ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return mapped.length > 0 ? mapped.slice(0, 26) : fallback
}

function drawUiTextOnBuffer(
  data: Uint8ClampedArray,
  outW: number,
  outH: number,
  text: string,
  cx: number,
  cy: number,
  scale: number,
  color: [number, number, number],
  shadowColor: [number, number, number] = [8, 10, 18],
  alphaMul = 1
): void {
  const clean = text.toUpperCase().slice(0, 48)
  if (!clean || scale < 1) return
  const charAdvance = 6 * scale
  const totalW = clean.length * charAdvance - scale
  const totalH = 7 * scale
  const startX = Math.round(cx - totalW / 2)
  const startY = Math.round(cy - totalH / 2)

  // Automatically adapt text & shadow contrast on light rice-paper / parchment vs dark panels
  const sampleX = clamp(Math.round(cx), 0, outW - 1)
  const sampleY = clamp(Math.round(cy), 0, outH - 1)
  const sIdx = (sampleY * outW + sampleX) * 4
  const bgLuma =
    (data[sIdx] ?? 20) * 0.299 + (data[sIdx + 1] ?? 24) * 0.587 + (data[sIdx + 2] ?? 36) * 0.114
  const fgLuma = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
  let effColor: [number, number, number] = color
  let effShadow: [number, number, number] = shadowColor
  if (bgLuma > 155 && fgLuma > 140) {
    const isWarmAccent = color[0] > 235 && color[1] > 205 && color[2] < 185
    effColor = isWarmAccent ? [188, 32, 32] : [32, 26, 22]
    effShadow = [248, 242, 230]
  } else if (bgLuma < 85 && fgLuma < 95) {
    effColor = [246, 242, 232]
    effShadow = [8, 10, 18]
  }

  const plotGlyphPass = (ox: number, oy: number, col: [number, number, number], a: number) => {
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i]!
      const rows = UI_GLYPH_5X7[ch] ?? UI_GLYPH_5X7[' ']!
      const baseX = startX + i * charAdvance + ox
      const baseY = startY + oy
      for (let ry = 0; ry < 7; ry++) {
        const rowBits = rows[ry]!
        if (!rowBits) continue
        for (let rx = 0; rx < 5; rx++) {
          if ((rowBits & (1 << (4 - rx))) === 0) continue
          for (let sy = 0; sy < scale; sy++) {
            const py = baseY + ry * scale + sy
            if (py < 0 || py >= outH) continue
            for (let sx = 0; sx < scale; sx++) {
              const px = baseX + rx * scale + sx
              if (px < 0 || px >= outW) continue
              const idx = (py * outW + px) * 4
              data[idx] = clampByte(col[0] * a + data[idx]! * (1 - a))
              data[idx + 1] = clampByte(col[1] * a + data[idx + 1]! * (1 - a))
              data[idx + 2] = clampByte(col[2] * a + data[idx + 2]! * (1 - a))
              data[idx + 3] = 255
            }
          }
        }
      }
    }
  }

  plotGlyphPass(scale, scale, effShadow, 0.72 * alphaMul)
  plotGlyphPass(0, 0, effColor, alphaMul)
}

function drawFourPointStarOnBuffer(
  data: Uint8ClampedArray,
  outW: number,
  outH: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number],
  alphaMul = 1
): void {
  const r = Math.max(2, Math.round(radius))
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(outW - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(outH - 1, Math.ceil(cy + r))
  for (let py = y0; py <= y1; py++) {
    const dy = Math.abs(py - cy) / r
    for (let px = x0; px <= x1; px++) {
      const dx = Math.abs(px - cx) / r
      const starMetric = Math.pow(dx, 0.62) + Math.pow(dy, 0.62)
      if (starMetric > 1) continue
      const glow = clamp(1 - starMetric, 0, 1)
      const a = clamp(glow * 1.35, 0, 1) * alphaMul
      const idx = (py * outW + px) * 4
      const coreBoost = starMetric < 0.32 ? 42 : 0
      data[idx] = clampByte(Math.min(255, color[0] + coreBoost) * a + data[idx]! * (1 - a))
      data[idx + 1] = clampByte(Math.min(255, color[1] + coreBoost) * a + data[idx + 1]! * (1 - a))
      data[idx + 2] = clampByte(Math.min(255, color[2] + coreBoost) * a + data[idx + 2]! * (1 - a))
      data[idx + 3] = 255
    }
  }
}

function sampleSourceAspectClean(
  src: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  u: number,
  v: number,
  targetAspect: number,
  fallbackBg: [number, number, number],
  focusY = 0.42
): [number, number, number, number] {
  const sW = Math.max(1, src.width)
  const sH = Math.max(1, src.height)
  const sData = src.data
  if (sData.length < sW * sH * 4) {
    return [fallbackBg[0], fallbackBg[1], fallbackBg[2], 0]
  }
  const srcAspect = sW / sH
  let su = u
  let sv = v
  if (targetAspect > srcAspect) {
    const visibleH = srcAspect / targetAspect
    const offsetV = (1 - visibleH) * clamp(focusY, 0, 1)
    sv = offsetV + v * visibleH
  } else {
    const visibleW = targetAspect / srcAspect
    const offsetU = (1 - visibleW) * 0.5
    su = offsetU + u * visibleW
  }
  const sx = clamp(Math.floor(su * sW), 0, sW - 1)
  const sy = clamp(Math.floor(sv * sH), 0, sH - 1)
  const sIdx = (sy * sW + sx) * 4
  const rawA = sData[sIdx + 3]! / 255
  const cleanA = clamp((rawA - 0.28) / 0.64, 0, 1)
  const r = clampByte(sData[sIdx]! * cleanA + fallbackBg[0] * (1 - cleanA))
  const g = clampByte(sData[sIdx + 1]! * cleanA + fallbackBg[1] * (1 - cleanA))
  const b = clampByte(sData[sIdx + 2]! * cleanA + fallbackBg[2] * (1 - cleanA))
  return [r, g, b, cleanA]
}

function drawOrnatePanelBoxOnBuffer(
  data: Uint8ClampedArray,
  outW: number,
  outH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  bgCol: [number, number, number],
  rimCol: [number, number, number],
  alphaMul = 1,
  chamferPx = 6
): void {
  const lw = Math.max(2, x1 - x0)
  const lh = Math.max(2, y1 - y0)
  const isLightPaper = bgCol[0] > 180 && bgCol[1] > 170
  const isRebelRed = rimCol[0] > 215 && rimCol[1] < 48 && bgCol[0] < 35
  const isCyberNeon = rimCol[1] > 215 && rimCol[2] > 225 && rimCol[0] < 45
  const isArkTech = rimCol[0] > 205 && rimCol[1] > 205 && rimCol[2] > 205 && bgCol[0] < 45
  const ch = isArkTech ? 0 : Math.min(chamferPx, Math.floor(Math.min(lw, lh) * 0.22))
  const outerBorder = Math.max(2, Math.round(Math.min(lw, lh) * 0.025))
  const innerInset = outerBorder + Math.max(2, Math.round(outerBorder * 0.85))

  for (let py = Math.max(0, y0); py < Math.min(outH, y1); py++) {
    const dyTop = py - y0
    const dyBot = y1 - 1 - py
    const dyEdge = Math.min(dyTop, dyBot)
    const v = dyTop / Math.max(1, lh - 1)
    for (let px = Math.max(0, x0); px < Math.min(outW, x1); px++) {
      const dxLeft = px - x0
      const dxRight = x1 - 1 - px
      const dxEdge = Math.min(dxLeft, dxRight)
      if (dxEdge + dyEdge < ch) continue
      const edgeDist = Math.min(dxEdge, dyEdge, Math.floor((dxEdge + dyEdge - ch) * 0.72))
      const idx = (py * outW + px) * 4

      let r = bgCol[0]
      let g = bgCol[1]
      let b = bgCol[2]
      let a = (isLightPaper ? 0.94 : 0.88) * alphaMul

      if (edgeDist < outerBorder) {
        if (isArkTech && dxLeft < outerBorder * 2) {
          r = 255
          g = 118
          b = 20
        } else {
          const bevel = dyTop < dxRight ? 1.16 : 0.82
          r = clampByte(rimCol[0] * bevel)
          g = clampByte(rimCol[1] * bevel)
          b = clampByte(rimCol[2] * bevel)
        }
        a = 0.98 * alphaMul
      } else if (edgeDist === innerInset) {
        if (isRebelRed) {
          r = 252
          g = 248
          b = 248
        } else if (isLightPaper) {
          r = 188
          g = 48
          b = 42
        } else {
          r = clampByte(rimCol[0] * 0.72 + bgCol[0] * 0.28)
          g = clampByte(rimCol[1] * 0.72 + bgCol[1] * 0.28)
          b = clampByte(rimCol[2] * 0.72 + bgCol[2] * 0.28)
        }
        a = 0.94 * alphaMul
      } else if (isLightPaper) {
        // Xuan rice-paper horizontal fiber & warm scroll wash
        const fiber = ((px * 13 + py * 37) % 9) - 4
        const wash = Math.sin(px * 0.045 + py * 0.025) * 6 - v * 10
        r = clampByte(bgCol[0] + fiber + wash)
        g = clampByte(bgCol[1] + fiber + wash)
        b = clampByte(bgCol[2] + fiber + wash * 1.1)
      } else if (isRebelRed) {
        const slash = (px + py * 2) % 28 < 4 ? 22 : 0
        r = clampByte(bgCol[0] + slash)
        g = clampByte(bgCol[1] + (slash ? 2 : 0))
        b = clampByte(bgCol[2] + (slash ? 4 : 0))
      } else if (isCyberNeon) {
        const scan = py % 3 === 0 ? 14 : 0
        r = clampByte(bgCol[0] + (v > 0.75 ? 18 : 0))
        g = clampByte(bgCol[1] + scan)
        b = clampByte(bgCol[2] + scan * 1.4)
      } else {
        const glassSheen = v < 0.35 ? (0.35 - v) * 28 : 0
        const grad = 1.06 - v * 0.22
        r = clampByte(bgCol[0] * grad + glassSheen)
        g = clampByte(bgCol[1] * grad + glassSheen)
        b = clampByte(bgCol[2] * grad + glassSheen * 1.2)
      }

      data[idx] = clampByte(r * a + data[idx]! * (1 - a))
      data[idx + 1] = clampByte(g * a + data[idx + 1]! * (1 - a))
      data[idx + 2] = clampByte(b * a + data[idx + 2]! * (1 - a))
      data[idx + 3] = 255
    }
  }

  // Draw 4 corner ornaments (Cinnabar seals for ink_paper_cel, magenta nodes for cyber, orange nodes for ark, stars otherwise)
  const cOff = Math.max(3, innerInset)
  const corners: Array<[number, number]> = [
    [x0 + cOff, y0 + cOff],
    [x1 - 1 - cOff, y0 + cOff],
    [x0 + cOff, y1 - 1 - cOff],
    [x1 - 1 - cOff, y1 - 1 - cOff]
  ]
  const cornerCol: [number, number, number] = isLightPaper
    ? [204, 42, 42]
    : isCyberNeon
      ? [255, 42, 156]
      : isArkTech
        ? [255, 118, 20]
        : isRebelRed
          ? [252, 248, 248]
          : [clampByte(rimCol[0] * 1.15), clampByte(rimCol[1] * 1.15), clampByte(rimCol[2] * 1.15)]
  for (const [cx, cy] of corners) {
    drawFourPointStarOnBuffer(
      data,
      outW,
      outH,
      cx,
      cy,
      Math.max(2, outerBorder + 1),
      cornerCol,
      alphaMul
    )
  }
}

/**
 * Synthesizes a 640x360 high-clarity UI Component Asset Kit Showcase Sheet (`synthesizeUiAssetKitShowcaseRgba`)
 * for `hud_bar_kit`, `radial_hud_kit`, or `dialogue_kit` so each specialized UI asset output port
 * displays a complete, labeled, production-grade component kit card.
 */
export function synthesizeUiAssetKitShowcaseRgba(
  kind: 'hud_bar_kit' | 'radial_hud_kit' | 'dialogue_kit',
  rawRgba: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  stylePreset: UiStylePreset = 'celestial_star_gold'
): { width: number; height: number; data: Uint8ClampedArray } {
  const outW = 640
  const outH = 360
  const data = new Uint8ClampedArray(outW * outH * 4)
  const theme = getUiStyleThemeColors(stylePreset)
  const isInk = stylePreset === 'ink_paper_cel'
  const rimCol: [number, number, number] =
    stylePreset === 'celestial_star_gold' ? [228, 198, 138] : theme.rim
  const bgCol: [number, number, number] =
    stylePreset === 'celestial_star_gold' ? [20, 26, 44] : theme.bg
  const panelCol: [number, number, number] = isInk
    ? [244, 236, 220]
    : [
        clampByte(bgCol[0] * 1.25 + 6),
        clampByte(bgCol[1] * 1.25 + 8),
        clampByte(bgCol[2] * 1.25 + 12)
      ]
  const srcObj = { width: Math.max(1, srcW), height: Math.max(1, srcH), data: rawRgba }

  // Outer card backdrop with ornate style frame
  drawOrnatePanelBoxOnBuffer(data, outW, outH, 4, 4, outW - 4, outH - 4, bgCol, rimCol, 1, 10)
  // Top header ribbon
  drawOrnatePanelBoxOnBuffer(
    data,
    outW,
    outH,
    18,
    14,
    outW - 18,
    44,
    isInk ? [42, 36, 32] : panelCol,
    isInk ? [204, 42, 42] : rimCol,
    0.96,
    6
  )

  const drawGaugeTrack = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    fillRatio: number,
    trailRatio: number,
    barMain: [number, number, number],
    barDark: [number, number, number],
    labelLeft: string,
    labelRight: string
  ) => {
    drawUiTextOnBuffer(
      data,
      outW,
      outH,
      labelLeft,
      x0 + 135,
      y0 - 9,
      1,
      [244, 232, 196],
      [8, 10, 18]
    )
    drawUiTextOnBuffer(
      data,
      outW,
      outH,
      labelRight,
      x1 - 75,
      y0 - 9,
      1,
      [196, 224, 255],
      [8, 10, 18]
    )
    const bw = Math.max(8, x1 - x0)
    const bh = Math.max(6, y1 - y0)
    for (let py = y0; py < y1; py++) {
      const v = (py - y0) / Math.max(1, bh - 1)
      const dyEdge = Math.min(py - y0, y1 - 1 - py)
      for (let px = x0; px < x1; px++) {
        const u = (px - x0) / Math.max(1, bw - 1)
        const dxEdge = Math.min(px - x0, x1 - 1 - px)
        if (dxEdge + dyEdge < 4) continue
        const isRim =
          dxEdge < 2 ||
          dyEdge < 2 ||
          (dyEdge < 5 &&
            (Math.abs(u - 0.25) < 0.006 || Math.abs(u - 0.5) < 0.008 || Math.abs(u - 0.75) < 0.006))
        const idx = (py * outW + px) * 4
        if (isRim) {
          data[idx] = rimCol[0]
          data[idx + 1] = rimCol[1]
          data[idx + 2] = rimCol[2]
          data[idx + 3] = 255
        } else if (u <= fillRatio) {
          const sheen = v < 0.42 ? 32 : 0
          const segGap = Math.abs(u * 10 - Math.round(u * 10)) < 0.018 ? 0.76 : 1
          data[idx] = clampByte(
            (barDark[0] * (1 - u * 0.5) + barMain[0] * (0.5 + u * 0.5)) * segGap + sheen
          )
          data[idx + 1] = clampByte(
            (barDark[1] * (1 - u * 0.5) + barMain[1] * (0.5 + u * 0.5)) * segGap + sheen
          )
          data[idx + 2] = clampByte(
            (barDark[2] * (1 - u * 0.5) + barMain[2] * (0.5 + u * 0.5)) * segGap + sheen
          )
          data[idx + 3] = 255
        } else if (u <= trailRatio) {
          data[idx] = 255
          data[idx + 1] = 238
          data[idx + 2] = 192
          data[idx + 3] = 255
        } else {
          data[idx] = isInk ? 214 : clampByte(bgCol[0] * 0.58)
          data[idx + 1] = isInk ? 204 : clampByte(bgCol[1] * 0.58)
          data[idx + 2] = isInk ? 186 : clampByte(bgCol[2] * 0.68)
          data[idx + 3] = 245
        }
      }
    }
    drawFourPointStarOnBuffer(data, outW, outH, x0 + 6, (y0 + y1) >> 1, 4, theme.accent)
    drawFourPointStarOnBuffer(data, outW, outH, x1 - 6, (y0 + y1) >> 1, 4, theme.accent)
  }

  if (kind === 'hud_bar_kit') {
    drawUiTextOnBuffer(
      data,
      outW,
      outH,
      `* COMBAT HUD GAUGE KIT (${stylePreset.toUpperCase()}) *`,
      outW * 0.5,
      29,
      2,
      [255, 236, 178],
      [8, 12, 22]
    )
    const hpMain: [number, number, number] = isInk
      ? [204, 42, 42]
      : stylePreset === 'persona_rebel_red'
        ? [242, 24, 42]
        : stylePreset === 'cyber_holo_grid'
          ? [255, 42, 156]
          : stylePreset === 'minimal_ark_tech'
            ? [255, 118, 20]
            : [72, 228, 136]
    const hpDark: [number, number, number] = [
      Math.round(hpMain[0] * 0.42),
      Math.round(hpMain[1] * 0.42),
      Math.round(hpMain[2] * 0.42)
    ]
    drawGaugeTrack(
      36,
      74,
      outW - 36,
      102,
      0.74,
      0.88,
      hpMain,
      hpDark,
      '1. HP GAUGE + DELAYED TRAIL',
      '14280 / 16000'
    )
    const shMain: [number, number, number] = isInk
      ? [58, 148, 124]
      : stylePreset === 'persona_rebel_red'
        ? [245, 245, 250]
        : [78, 214, 255]
    drawGaugeTrack(
      36,
      134,
      outW - 36,
      160,
      0.92,
      0.92,
      shMain,
      [Math.round(shMain[0] * 0.42), Math.round(shMain[1] * 0.42), Math.round(shMain[2] * 0.42)],
      '2. SHIELD / QI BARRIER',
      '4850 / 5000'
    )
    drawGaugeTrack(
      36,
      192,
      outW - 36,
      218,
      1.0,
      1.0,
      theme.accent,
      [
        Math.round(theme.accent[0] * 0.48),
        Math.round(theme.accent[1] * 0.48),
        Math.round(theme.accent[2] * 0.48)
      ],
      '3. ULTIMATE BURST ENERGY',
      '100% MAX READY'
    )

    const cardW = 182
    const gap = 16
    const startX = Math.round((outW - (cardW * 3 + gap * 2)) * 0.5)
    const sliceTitles = ['L1: BACKPLATE', 'L2: LIQUID FILL', 'L3: FRAME OVERLAY']
    for (let c = 0; c < 3; c++) {
      const cx0 = startX + c * (cardW + gap)
      const cy0 = 242
      const cx1 = cx0 + cardW
      const cy1 = 336
      drawOrnatePanelBoxOnBuffer(data, outW, outH, cx0, cy0, cx1, cy1, panelCol, rimCol, 0.94, 6)
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        sliceTitles[c]!,
        (cx0 + cx1) * 0.5,
        cy0 + 22,
        1,
        [248, 228, 168],
        [8, 10, 18]
      )
      const bx0 = cx0 + 16
      const bx1 = cx1 - 16
      const by0 = cy0 + 44
      const by1 = cy0 + 70
      for (let py = by0; py < by1; py++) {
        const v = (py - by0) / Math.max(1, by1 - by0 - 1)
        const dyEdge = Math.min(py - by0, by1 - 1 - py)
        for (let px = bx0; px < bx1; px++) {
          const u = (px - bx0) / Math.max(1, bx1 - bx0 - 1)
          const dxEdge = Math.min(px - bx0, bx1 - 1 - px)
          if (dxEdge + dyEdge < 3) continue
          const idx = (py * outW + px) * 4
          if (c === 0) {
            data[idx] = isInk ? 204 : clampByte(bgCol[0] * 0.55)
            data[idx + 1] = isInk ? 194 : clampByte(bgCol[1] * 0.55)
            data[idx + 2] = isInk ? 176 : clampByte(bgCol[2] * 0.65)
            data[idx + 3] = 255
          } else if (c === 1) {
            if (dxEdge >= 2 && dyEdge >= 2) {
              const sheen = v < 0.4 ? 30 : 0
              data[idx] = clampByte(hpMain[0] * (0.65 + u * 0.35) + sheen)
              data[idx + 1] = clampByte(hpMain[1] * (0.65 + u * 0.35) + sheen)
              data[idx + 2] = clampByte(hpMain[2] * (0.65 + u * 0.35) + sheen)
              data[idx + 3] = 255
            }
          } else {
            const isRim =
              dxEdge < 3 ||
              dyEdge < 3 ||
              (dyEdge < 6 &&
                (Math.abs(u - 0.25) < 0.012 ||
                  Math.abs(u - 0.5) < 0.014 ||
                  Math.abs(u - 0.75) < 0.012))
            if (isRim) {
              data[idx] = rimCol[0]
              data[idx + 1] = rimCol[1]
              data[idx + 2] = rimCol[2]
              data[idx + 3] = 255
            }
          }
        }
      }
    }
    return { width: outW, height: outH, data }
  }

  if (kind === 'radial_hud_kit') {
    drawUiTextOnBuffer(
      data,
      outW,
      outH,
      `* POLAR MINIMAP & RADIAL SKILL KIT (${stylePreset.toUpperCase()}) *`,
      outW * 0.5,
      29,
      2,
      [255, 236, 178],
      [8, 12, 22]
    )
    const cells = [
      { x0: 22, y0: 56, x1: 310, y1: 196, title: '1. 360* MINIMAP COMPASS' },
      { x0: 330, y0: 56, x1: 618, y1: 196, title: '2. SKILL & BURST SLOTS' },
      { x0: 22, y0: 208, x1: 310, y1: 344, title: '3. 360* COOLDOWN MASK' },
      { x0: 330, y0: 208, x1: 618, y1: 344, title: '4. 8-SECTOR QUICK WHEEL' }
    ]
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      drawOrnatePanelBoxOnBuffer(
        data,
        outW,
        outH,
        cell.x0,
        cell.y0,
        cell.x1,
        cell.y1,
        panelCol,
        rimCol,
        0.94,
        6
      )
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        cell.title,
        cell.x0 + 108,
        cell.y0 + 18,
        1,
        [248, 228, 168],
        [8, 10, 18]
      )
      const cx = Math.round(cell.x0 + (cell.x1 - cell.x0) * 0.68)
      const cy = Math.round(cell.y0 + (cell.y1 - cell.y0) * 0.56)
      const rad = 46
      if (i === 0) {
        for (let py = cy - rad; py <= cy + rad; py++) {
          for (let px = cx - rad; px <= cx + rad; px++) {
            const dx = px - cx
            const dy = py - cy
            const dist = Math.hypot(dx, dy)
            if (dist > rad) continue
            const normR = dist / rad
            const ang = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2)
            const cw = ang / (Math.PI * 2)
            const idx = (py * outW + px) * 4
            if (normR >= 0.84) {
              const tick = Math.abs(cw * 24 - Math.round(cw * 24)) < 0.14
              data[idx] = clampByte(rimCol[0] * (tick ? 1.18 : 0.88))
              data[idx + 1] = clampByte(rimCol[1] * (tick ? 1.18 : 0.88))
              data[idx + 2] = clampByte(rimCol[2] * (tick ? 1.18 : 0.88))
            } else {
              const grid = Math.abs(normR - 0.45) < 0.025 || Math.abs(dx) < 1 || Math.abs(dy) < 1
              const sweep = Math.max(0, 1 - ((cw - 0.15 + 1) % 1) * 4.5) * 0.45
              const radarBase = isInk ? [218, 208, 188] : [22, 42, 64]
              data[idx] = clampByte(
                radarBase[0]! + (grid ? (isInk ? -48 : 36) : 0) + theme.accent[0] * sweep
              )
              data[idx + 1] = clampByte(
                radarBase[1]! + (grid ? (isInk ? -48 : 48) : 0) + theme.accent[1] * sweep
              )
              data[idx + 2] = clampByte(
                radarBase[2]! + (grid ? (isInk ? -48 : 56) : 0) + theme.accent[2] * sweep
              )
            }
            data[idx + 3] = 255
          }
        }
        drawFourPointStarOnBuffer(data, outW, outH, cx, cy, 6, theme.accent)
        drawUiTextOnBuffer(data, outW, outH, 'N', cx, cy - rad + 6, 1, [255, 240, 180], [8, 10, 18])
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          'RADAR + N/E/S/W',
          cell.x0 + 78,
          cy + 12,
          1,
          [186, 214, 248],
          [8, 10, 18]
        )
      } else if (i === 1) {
        const slots = [
          { sx: cell.x0 + 135, sy: cy + 6, r: 36, key: 'E', cd: '3.5S', isBurst: false },
          { sx: cell.x0 + 225, sy: cy + 2, r: 44, key: 'Q', cd: 'MAX', isBurst: true }
        ]
        for (const sl of slots) {
          for (let py = sl.sy - sl.r; py <= sl.sy + sl.r; py++) {
            for (let px = sl.sx - sl.r; px <= sl.sx + sl.r; px++) {
              const dx = px - sl.sx
              const dy = py - sl.sy
              const dist = Math.hypot(dx, dy)
              if (dist > sl.r) continue
              const normR = dist / sl.r
              const idx = (py * outW + px) * 4
              if (normR >= 0.84) {
                data[idx] = sl.isBurst ? theme.accent[0] : rimCol[0]
                data[idx + 1] = sl.isBurst ? theme.accent[1] : rimCol[1]
                data[idx + 2] = sl.isBurst ? theme.accent[2] : rimCol[2]
              } else {
                const u = (dx / (sl.r * 0.84) + 1) * 0.5
                const v = (dy / (sl.r * 0.84) + 1) * 0.5
                const [sr, sg, sb] = sampleSourceAspectClean(srcObj, u, v, 1, bgCol, 0.5)
                const cw = ((Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
                const dim = !sl.isBurst && cw < 0.38 ? 0.42 : 1
                data[idx] = clampByte(sr * dim)
                data[idx + 1] = clampByte(sg * dim)
                data[idx + 2] = clampByte(sb * dim)
              }
              data[idx + 3] = 255
            }
          }
          drawUiTextOnBuffer(data, outW, outH, sl.cd, sl.sx, sl.sy, 1, [255, 246, 210], [8, 10, 18])
          drawUiTextOnBuffer(
            data,
            outW,
            outH,
            sl.key,
            sl.sx,
            sl.sy + sl.r - 4,
            1,
            [124, 224, 255],
            [8, 10, 18]
          )
        }
      } else if (i === 2) {
        for (let py = cy - rad; py <= cy + rad; py++) {
          for (let px = cx - rad; px <= cx + rad; px++) {
            const dx = px - cx
            const dy = py - cy
            const dist = Math.hypot(dx, dy)
            if (dist > rad || dist < rad * 0.22) continue
            const cw = ((Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
            const idx = (py * outW + px) * 4
            const ramp = clampByte(cw * 255)
            data[idx] = ramp
            data[idx + 1] = clampByte(80 + cw * 160)
            data[idx + 2] = clampByte(255 - cw * 180)
            data[idx + 3] = 255
          }
        }
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          '0* -> 360*',
          cell.x0 + 78,
          cy + 12,
          1,
          [186, 214, 248],
          [8, 10, 18]
        )
      } else {
        for (let py = cy - rad; py <= cy + rad; py++) {
          for (let px = cx - rad; px <= cx + rad; px++) {
            const dx = px - cx
            const dy = py - cy
            const dist = Math.hypot(dx, dy)
            const normR = dist / rad
            if (normR > 1 || normR < 0.34) continue
            const cw = ((Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
            const sec = Math.floor(cw * 8) % 8
            const secPhase = cw * 8 - Math.floor(cw * 8)
            if (secPhase < 0.05 || secPhase > 0.95) continue
            const isSel = sec === 1
            const isRim = normR <= 0.42 || normR >= 0.9
            const col = isSel ? theme.accent : isRim ? rimCol : bgCol
            const idx = (py * outW + px) * 4
            data[idx] = col[0]
            data[idx + 1] = col[1]
            data[idx + 2] = col[2]
            data[idx + 3] = 255
          }
        }
        drawFourPointStarOnBuffer(data, outW, outH, cx, cy, 7, theme.accent)
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          '8-WAY WHEEL',
          cell.x0 + 78,
          cy + 12,
          1,
          [186, 214, 248],
          [8, 10, 18]
        )
      }
    }
    return { width: outW, height: outH, data }
  }

  // kind === 'dialogue_kit'
  drawUiTextOnBuffer(
    data,
    outW,
    outH,
    `* DIALOGUE BOX & 9-SLICE BUTTON KIT (${stylePreset.toUpperCase()}) *`,
    outW * 0.5,
    29,
    2,
    [255, 236, 178],
    [8, 12, 22]
  )
  const btnStates: Array<{
    label: string
    bg: [number, number, number]
    rim: [number, number, number]
  }> = [
    { label: '* NORMAL', bg: panelCol, rim: rimCol },
    { label: '* HOVER GLOW', bg: theme.accent, rim: rimCol },
    {
      label: '* PRESSED',
      bg: [clampByte(bgCol[0] * 0.78), clampByte(bgCol[1] * 0.78), clampByte(bgCol[2] * 0.78)],
      rim: rimCol
    },
    { label: 'DISABLED', bg: [92, 94, 102], rim: [138, 142, 152] }
  ]
  const btnW = 138
  const btnGap = 14
  const btnStartX = Math.round((outW - (btnW * 4 + btnGap * 3)) * 0.5)
  for (let b = 0; b < 4; b++) {
    const bx0 = btnStartX + b * (btnW + btnGap)
    const by0 = 56
    const bx1 = bx0 + btnW
    const by1 = 94
    const st = btnStates[b]!
    drawOrnatePanelBoxOnBuffer(data, outW, outH, bx0, by0, bx1, by1, st.bg, st.rim, 0.96, 6)
    drawUiTextOnBuffer(
      data,
      outW,
      outH,
      st.label,
      (bx0 + bx1) * 0.5,
      (by0 + by1) * 0.5,
      1,
      b === 3 ? [198, 204, 214] : [252, 238, 196],
      [8, 10, 18]
    )
  }

  const choices = isInk
    ? ['* UNSEAL THE JADE SWORD SCROLL', '* OFFER CINNABAR INCENSE']
    : stylePreset === 'persona_rebel_red'
      ? ['* SEND THE CALLING CARD', '* ALL-OUT PHANTOM STRIKE']
      : stylePreset === 'cyber_holo_grid'
        ? ['* BREACH ICE FIREWALL // LV.9', '* OVERCLOCK NEURAL IMPLANT']
        : ['* ENTER THE CELESTIAL GATE', '* INSPECT 5* GOLDEN GOBLET']
  for (let c = 0; c < 2; c++) {
    const cx0 = c === 0 ? 32 : 328
    const cx1 = c === 0 ? 312 : 608
    const cy0 = 108
    const cy1 = 144
    drawOrnatePanelBoxOnBuffer(data, outW, outH, cx0, cy0, cx1, cy1, panelCol, rimCol, 0.95, 8)
    drawFourPointStarOnBuffer(data, outW, outH, cx0 + 18, (cy0 + cy1) * 0.5, 4, theme.accent)
    drawUiTextOnBuffer(
      data,
      outW,
      outH,
      choices[c]!,
      (cx0 + cx1) * 0.5 + 8,
      (cy0 + cy1) * 0.5,
      1,
      [246, 238, 218],
      [8, 10, 18]
    )
  }

  const dx0 = 24
  const dy0 = 172
  const dx1 = outW - 24
  const dy1 = 342
  drawOrnatePanelBoxOnBuffer(data, outW, outH, dx0, dy0, dx1, dy1, panelCol, rimCol, 0.96, 10)

  drawOrnatePanelBoxOnBuffer(
    data,
    outW,
    outH,
    168,
    156,
    448,
    188,
    isInk ? [204, 42, 42] : theme.accent,
    rimCol,
    0.98,
    6
  )
  const speakerTitle = isInk
    ? '* SWORD IMMORTAL LING *'
    : stylePreset === 'persona_rebel_red'
      ? '* PHANTOM THIEF JOKER *'
      : stylePreset === 'cyber_holo_grid'
        ? '* NETRUNNER AI // ZERO *'
        : stylePreset === 'minimal_ark_tech'
          ? '* DR. KALTSIT // PRTS *'
          : '* ASTROLOGER MONA *'
  drawUiTextOnBuffer(data, outW, outH, speakerTitle, 308, 172, 2, [255, 246, 224], [8, 12, 22])

  const px0 = 42
  const py0 = 190
  const px1 = 152
  const py1 = 326
  drawOrnatePanelBoxOnBuffer(data, outW, outH, px0, py0, px1, py1, bgCol, rimCol, 0.98, 6)
  const pIn0 = 5
  for (let py = py0 + pIn0; py < py1 - pIn0; py++) {
    const v = (py - (py0 + pIn0)) / Math.max(1, py1 - py0 - pIn0 * 2 - 1)
    for (let px = px0 + pIn0; px < px1 - pIn0; px++) {
      const u = (px - (px0 + pIn0)) / Math.max(1, px1 - px0 - pIn0 * 2 - 1)
      const [sr, sg, sb] = sampleSourceAspectClean(
        srcObj,
        u,
        v,
        (px1 - px0) / (py1 - py0),
        bgCol,
        0.35
      )
      const idx = (py * outW + px) * 4
      data[idx] = sr
      data[idx + 1] = sg
      data[idx + 2] = sb
      data[idx + 3] = 255
    }
  }

  drawUiTextOnBuffer(
    data,
    outW,
    outH,
    isInk ? 'INK AND BLADE FLOW ACROSS THOUSAND PEAKS.' : 'THE STARS ALIGN IN THE NIGHT SKY.',
    380,
    232,
    2,
    [244, 240, 230],
    [8, 10, 18]
  )
  drawUiTextOnBuffer(
    data,
    outW,
    outH,
    isInk
      ? 'DESTINY IS SEALED IN VERMILION CINNABAR.'
      : 'CLAIM YOUR 5* DESTINY BEYOND THE ASTRAL GATE.',
    380,
    268,
    1,
    [186, 214, 248],
    [8, 10, 18]
  )
  drawFourPointStarOnBuffer(data, outW, outH, dx1 - 36, dy1 - 26, 7, theme.accent)
  drawUiTextOnBuffer(data, outW, outH, 'NEXT', dx1 - 72, dy1 - 26, 1, [248, 228, 168], [8, 10, 18])

  return { width: outW, height: outH, data }
}

/**
 * Synthesizes a 16:9 / 9:16 Full-Screen UI Artboard Composite RGBA buffer (`synthesizeFullScreenUiArtboardRgba`)
 * directly from the node's `gameUiArtboardJson` layers (or active `UiScreenBlueprintPreset`),
 * embedding the upstream `rawRgba` and `secondarySources` textures into portrait medallions, cards, item slots, and panels
 * with aspect-ratio-preserving cover sampling, clean alpha compositing, ornate borders, sub-grids, and crisp bitmap typography.
 */
export function synthesizeFullScreenUiArtboardRgba(
  rawRgba: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  options?: {
    blueprint?: UiScreenBlueprintPreset
    stylePreset?: UiStylePreset
    artboardJson?: string
    designWidth?: number
    designHeight?: number
    outWidth?: number
    outHeight?: number
    resourceName?: string
    secondarySources?: Array<{
      width: number
      height: number
      data: Uint8Array | Uint8ClampedArray
    }>
  }
): {
  width: number
  height: number
  data: Uint8ClampedArray
  layerCount: number
  godotFullScreenTscn: string
} {
  const blueprint: UiScreenBlueprintPreset = options?.blueprint ?? 'combat_hud'
  const stylePreset: UiStylePreset = options?.stylePreset ?? 'dark_iron_parchment'
  const designW = Math.max(320, options?.designWidth ?? 1920)
  const designH = Math.max(240, options?.designHeight ?? 1080)
  const isPortrait = designH > designW
  const hiResAuto = Math.max(srcWidth, srcHeight) >= 256
  const defaultLongEdge = hiResAuto ? 960 : 480
  const defaultShortEdge = hiResAuto ? 540 : 270
  const outW = Math.max(64, options?.outWidth ?? (isPortrait ? defaultShortEdge : defaultLongEdge))
  const outH = Math.max(64, options?.outHeight ?? (isPortrait ? defaultLongEdge : defaultShortEdge))
  const theme = getUiStyleThemeColors(stylePreset)
  const data = new Uint8ClampedArray(outW * outH * 4)
  const textScale = outW >= 720 ? 2 : 1

  const sourcePool: Array<{
    width: number
    height: number
    data: Uint8Array | Uint8ClampedArray
  }> = [
    { width: Math.max(1, srcWidth), height: Math.max(1, srcHeight), data: rawRgba },
    ...(options?.secondarySources ?? []).filter(
      (s) => s.width > 0 && s.height > 0 && s.data.length >= s.width * s.height * 4
    )
  ]
  const bgHeroSource = sourcePool[Math.min(1, sourcePool.length - 1)] ?? sourcePool[0]!
  const iconSource = sourcePool[Math.min(2, sourcePool.length - 1)] ?? sourcePool[0]!

  // 1. Render Style-Distinctive Scene Backdrop (Xuan Paper Ink Mountain / Persona Slash / Cyber Grid / Ark Hazard / Astral Starfield)
  const screenAspect = outW / Math.max(1, outH)
  for (let y = 0; y < outH; y++) {
    const ny = y / Math.max(1, outH - 1)
    for (let x = 0; x < outW; x++) {
      const nx = x / Math.max(1, outW - 1)
      const idx = (y * outW + x) * 4
      const dist = Math.hypot((nx - 0.5) * 1.15, (ny - 0.42) * 1.1)
      const vig = clamp(1.08 - dist * 0.92, 0.18, 1)

      const [artR, artG, artB, artA] = sampleSourceAspectClean(
        bgHeroSource,
        nx,
        ny,
        screenAspect,
        theme.bg,
        0.35
      )
      const baseArtWeight =
        blueprint === 'title_menu' || blueprint === 'dialogue_vn' || blueprint === 'shop_gacha'
          ? 0.32
          : 0.18

      let baseR = theme.bg[0]
      let baseG = theme.bg[1]
      let baseB = theme.bg[2]

      if (stylePreset === 'ink_paper_cel') {
        // Warm Xuan Rice Paper scroll with aged tea-stained edges, fiber weave, and 3-layer Sumi Ink-Wash Mountains (水墨远山)
        const edgeBurn = clamp(1 - Math.pow(dist * 0.82, 2.1) * 0.22, 0.76, 1.03)
        const fiber =
          Math.sin(x * 0.35 + y * 0.06) * 3.5 +
          Math.cos(y * 0.48 - x * 0.05) * 3 +
          (((x * 13 + y * 29) % 7) - 3) * 0.8
        baseR = 236 * edgeBurn + fiber
        baseG = 226 * edgeBurn + fiber * 0.92
        baseB = 205 * edgeBurn + fiber * 0.78

        // Far, Mid, and Near Ink-Wash Mountain Ridges
        const mtnFarY = 0.46 + Math.sin(nx * 5.2 + 0.4) * 0.065 + Math.cos(nx * 11.5) * 0.025
        const mtnMidY = 0.6 + Math.sin(nx * 4.1 + 2.1) * 0.08 + Math.cos(nx * 9.3 + 1.2) * 0.03
        const mtnNearY = 0.76 + Math.sin(nx * 3.4 + 4.0) * 0.075 + Math.sin(nx * 8.2) * 0.025

        if (ny > mtnFarY) {
          const mistFade = clamp(1 - (ny - mtnFarY) * 2.6, 0.15, 0.85)
          const wash = 0.22 * mistFade
          baseR = baseR * (1 - wash) + 86 * wash
          baseG = baseG * (1 - wash) + 92 * wash
          baseB = baseB * (1 - wash) + 96 * wash
        }
        if (ny > mtnMidY) {
          const mistFade = clamp(1 - (ny - mtnMidY) * 2.8, 0.2, 0.92)
          const wash = 0.34 * mistFade
          baseR = baseR * (1 - wash) + 52 * wash
          baseG = baseG * (1 - wash) + 54 * wash
          baseB = baseB * (1 - wash) + 56 * wash
        }
        if (ny > mtnNearY) {
          const mistFade = clamp(1 - (ny - mtnNearY) * 3.2, 0.3, 1)
          const wash = 0.48 * mistFade
          baseR = baseR * (1 - wash) + 28 * wash
          baseG = baseG * (1 - wash) + 26 * wash
          baseB = baseB * (1 - wash) + 24 * wash
        }

        // Convert hero art into Sumi-ink wash with warm Xuan paper toning
        const artLum = (artR * 0.299 + artG * 0.587 + artB * 0.114) / 255
        const inkShade = Math.pow(clamp(artLum, 0, 1), 0.9)
        const inkArtR = 38 + inkShade * 196
        const inkArtG = 34 + inkShade * 186
        const inkArtB = 30 + inkShade * 168
        const artBlend = baseArtWeight * 0.95 * artA
        baseR = baseR * (1 - artBlend) + inkArtR * artBlend
        baseG = baseG * (1 - artBlend) + inkArtG * artBlend
        baseB = baseB * (1 - artBlend) + inkArtB * artBlend

        // Red Cinnabar Artist Seal (朱砂印章) in top-right scroll corner
        const sealX0 = Math.round(outW * 0.91)
        const sealX1 = Math.round(outW * 0.955)
        const sealY0 = Math.round(outH * 0.16)
        const sealY1 = Math.round(outH * 0.27)
        if (x >= sealX0 && x <= sealX1 && y >= sealY0 && y <= sealY1) {
          const onSealRim = x <= sealX0 + 2 || x >= sealX1 - 2 || y <= sealY0 + 2 || y >= sealY1 - 2
          const sealGlyph = ((x >> 2) + (y >> 2)) % 2 === 0
          if (onSealRim || sealGlyph) {
            baseR = 196
            baseG = 36
            baseB = 34
          }
        }
      } else if (stylePreset === 'persona_rebel_red') {
        // Persona 5 Rebel Red & Pitch-Black diagonal comic slash bands + halftone dots
        const diag = nx * 1.45 - ny * 0.92
        const inRedSlash =
          (diag > 0.12 && diag < 0.44) ||
          (diag > 0.72 && diag < 0.88) ||
          (diag > -0.45 && diag < -0.24)
        const onWhiteRazor =
          Math.abs(diag - 0.12) < 0.01 ||
          Math.abs(diag - 0.44) < 0.01 ||
          Math.abs(diag - 0.72) < 0.008
        if (onWhiteRazor) {
          baseR = 250
          baseG = 250
          baseB = 252
        } else if (inRedSlash) {
          const dotPattern = x % 6 < 3 && y % 6 < 3 && ny > 0.45 ? -26 : 0
          baseR = 216 + dotPattern
          baseG = 16
          baseB = 32
        } else {
          const darkHalftone = x % 8 === 0 && y % 8 === 0 ? 28 : 0
          baseR = 12 + darkHalftone
          baseG = 12 + darkHalftone
          baseB = 16 + darkHalftone
        }
        const artLum = (artR * 0.299 + artG * 0.587 + artB * 0.114) / 255
        const comicArt = artLum > 0.52 ? 235 : 18
        const artBlend = baseArtWeight * 0.75 * artA
        baseR = baseR * (1 - artBlend) + comicArt * artBlend
        baseG = baseG * (1 - artBlend) + (inRedSlash ? comicArt * 0.2 : comicArt) * artBlend
        baseB = baseB * (1 - artBlend) + (inRedSlash ? comicArt * 0.25 : comicArt) * artBlend
      } else if (stylePreset === 'cyber_holo_grid') {
        // Cyberpunk Neon Cyan & Magenta 3D perspective synthwave grid + CRT scanlines
        baseR = 6 + (1 - ny) * 10
        baseG = 18 + (1 - Math.abs(ny - 0.52)) * 28
        baseB = 34 + (1 - ny) * 26

        // Glowing Magenta horizon line at ny = 0.52
        const horizonDist = Math.abs(ny - 0.52)
        if (horizonDist < 0.04) {
          const glow = Math.pow(1 - horizonDist / 0.04, 2)
          baseR += 235 * glow
          baseG += 32 * glow
          baseB += 148 * glow
        }

        // Perspective neon cyan laser floor grid for ny > 0.52
        if (ny > 0.52) {
          const z = (ny - 0.52) / 0.48
          const perspX = (nx - 0.5) / Math.max(0.06, z)
          const onGridX = Math.abs((perspX * 6) % 1) < 0.07
          const onGridZ = Math.abs((Math.pow(z, 0.55) * 10) % 1) < 0.08
          if (onGridX || onGridZ) {
            baseR = baseR * 0.35 + 24 * 0.65
            baseG = baseG * 0.35 + 242 * 0.65
            baseB = baseB * 0.35 + 255 * 0.65
          }
        } else {
          // Upper HUD hexagonal / matrix grid
          if (x % 32 === 0 || y % 32 === 0) {
            baseG += 22
            baseB += 32
          }
        }
        // CRT scanline modulation
        if (y % 3 === 0) {
          baseR *= 0.82
          baseG *= 0.85
          baseB *= 0.88
        }
        const artBlend = baseArtWeight * 0.85 * artA * vig
        baseR = baseR * (1 - artBlend) + artR * 0.45 * artBlend
        baseG = baseG * (1 - artBlend) + clampByte(artG * 1.15) * artBlend
        baseB = baseB * (1 - artBlend) + clampByte(artB * 1.25) * artBlend
      } else if (stylePreset === 'minimal_ark_tech') {
        // Arknights Rhodes Island Matte Tactical Slate + Technical Crosshair Grid + Orange Caution Stripes
        baseR = 26 * vig + 6
        baseG = 30 * vig + 7
        baseB = 36 * vig + 9
        if (x % 40 === 0 || y % 40 === 0) {
          baseR += 10
          baseG += 12
          baseB += 15
        }
        if (
          Math.abs((x % 40) - 20) <= 2 &&
          Math.abs((y % 40) - 20) <= 2 &&
          (x % 40 === 20 || y % 40 === 20)
        ) {
          baseR += 32
          baseG += 36
          baseB += 42
        }
        // Top and bottom diagonal orange/black hazard caution bands (///)
        if (ny < 0.032 || ny > 0.968) {
          const hazardStripe = (x + y * 2) % 24 < 12
          baseR = hazardStripe ? 249 : 18
          baseG = hazardStripe ? 115 : 20
          baseB = hazardStripe ? 22 : 24
        }
        const artBlend = baseArtWeight * 0.8 * artA * vig
        baseR = baseR * (1 - artBlend) + artR * artBlend
        baseG = baseG * (1 - artBlend) + artG * artBlend
        baseB = baseB * (1 - artBlend) + artB * artBlend
      } else if (stylePreset === 'royal_gold_enamel') {
        // Royal Cobalt Enamel & Imperial Gold Sunburst Cathedral Rays
        const angle = Math.atan2(ny - 0.45, (nx - 0.5) * screenAspect)
        const sunRay = (Math.sin(angle * 16) + 1) * 0.5
        baseR = (16 + sunRay * 24) * vig
        baseG = (42 + sunRay * 26) * vig
        baseB = (108 + sunRay * 38) * vig
        const ringDist = Math.hypot((nx - 0.5) * screenAspect, ny - 0.45)
        if (Math.abs(ringDist - 0.34) < 0.004 || Math.abs(ringDist - 0.5) < 0.003) {
          baseR = 248
          baseG = 204
          baseB = 72
        }
        const artBlend = baseArtWeight * artA * vig
        baseR = baseR * (1 - artBlend) + artR * artBlend
        baseG = baseG * (1 - artBlend) + artG * artBlend
        baseB = baseB * (1 - artBlend) + artB * artBlend
      } else if (stylePreset === 'arcane_crystal') {
        // Arcane Amethyst Violet + Glowing Cyan/Magenta Magic Rune Circles
        const ringDist = Math.hypot((nx - 0.5) * screenAspect, ny - 0.48)
        const angle = Math.atan2(ny - 0.48, (nx - 0.5) * screenAspect)
        const runePulse = Math.abs(Math.sin(angle * 8)) > 0.75
        baseR = 38 * vig + 8
        baseG = 14 * vig + 4
        baseB = 78 * vig + 18
        if (
          Math.abs(ringDist - 0.28) < 0.004 ||
          Math.abs(ringDist - 0.42) < 0.004 ||
          (Math.abs(ringDist - 0.35) < 0.018 && runePulse)
        ) {
          baseR = 196
          baseG = 92
          baseB = 255
        }
        const starHash = ((x * 73856093) ^ (y * 19349663)) >>> 0
        if (starHash % 680 === 0) {
          baseR = 96
          baseG = 236
          baseB = 255
        }
        const artBlend = baseArtWeight * artA * vig
        baseR = baseR * (1 - artBlend) + artR * artBlend
        baseG = baseG * (1 - artBlend) + artG * artBlend
        baseB = baseB * (1 - artBlend) + artB * artBlend
      } else if (stylePreset === 'dark_iron_parchment') {
        // Dark Souls Charred Obsidian + Warm Hearth Ember Glow from Bottom + Rising Fire Sparks
        const hearthGlow = Math.pow(clamp(ny, 0, 1), 2.2) * 0.65
        baseR = 20 * vig + hearthGlow * 96
        baseG = 16 * vig + hearthGlow * 38
        baseB = 14 * vig + hearthGlow * 12
        const emberHash = ((x * 73856093) ^ (y * 19349663)) >>> 0
        if (emberHash % 790 === 0 && ny > 0.28) {
          baseR = 255
          baseG = 146
          baseB = 42
        }
        const artBlend = baseArtWeight * 0.85 * artA * vig
        baseR = baseR * (1 - artBlend) + artR * artBlend
        baseG = baseG * (1 - artBlend) + artG * artBlend
        baseB = baseB * (1 - artBlend) + artB * artBlend
      } else {
        // Default: celestial_star_gold (Genshin Astral Night-Sky Indigo + Golden Astrolabe Rings + Starfield)
        baseR = theme.bg[0] * 0.85 * vig + 8
        baseG = theme.bg[1] * 0.9 * vig + 12
        baseB = theme.bg[2] * 0.98 * vig + 22

        const artBlend = baseArtWeight * artA * vig
        baseR = baseR * (1 - artBlend) + artR * artBlend
        baseG = baseG * (1 - artBlend) + artG * artBlend
        baseB = baseB * (1 - artBlend) + artB * artBlend

        const ringDist = Math.hypot((nx - 0.5) * screenAspect, ny - 0.48)
        const onRing1 = Math.abs(ringDist - 0.36) < 0.0025
        const onRing2 = Math.abs(ringDist - 0.52) < 0.002
        if (onRing1 || onRing2) {
          baseR = baseR * 0.72 + theme.rim[0] * 0.28
          baseG = baseG * 0.72 + theme.rim[1] * 0.28
          baseB = baseB * 0.72 + theme.rim[2] * 0.28
        }

        const starHash = ((x * 73856093) ^ (y * 19349663)) >>> 0
        if (starHash % 997 === 0 && ny < 0.75) {
          baseR += 48
          baseG += 52
          baseB += 64
        }
      }

      data[idx] = clampByte(baseR)
      data[idx + 1] = clampByte(baseG)
      data[idx + 2] = clampByte(baseB)
      data[idx + 3] = 255
    }
  }

  // 2. Parse custom PS Artboard layers or build default normalized layers
  interface NormalizedLayerSpec {
    name: string
    kind: string
    x: number
    y: number
    w: number
    h: number
    visible: boolean
    opacity: number
    valuePct?: number
    bgColor?: string
    accentColor?: string
  }

  let layersTopToBottom: NormalizedLayerSpec[] = []
  if (options?.artboardJson && options.artboardJson.trim()) {
    try {
      const parsed = JSON.parse(options.artboardJson)
      // Only honor per-layer hex overrides when the JSON payload explicitly matches the active stylePreset
      const jsonStyleMatched =
        typeof parsed?.stylePreset === 'string' && parsed.stylePreset === stylePreset
      const rawList = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.pages?.[blueprint])
          ? parsed.pages[blueprint]
          : Array.isArray(parsed?.layers)
            ? parsed.layers
            : []
      if (Array.isArray(rawList) && rawList.length > 0) {
        layersTopToBottom = rawList.map((item: Record<string, unknown>) => ({
          name: String(item.name || 'UI_Layer'),
          kind: String(item.kind || 'panel_box'),
          x: Number(item.x ?? 0),
          y: Number(item.y ?? 0),
          w: Math.max(16, Number(item.w ?? 200)),
          h: Math.max(16, Number(item.h ?? 80)),
          visible: item.visible !== false,
          opacity: Math.max(0, Math.min(100, Number(item.opacity ?? 100))),
          valuePct: item.valuePct !== undefined ? Number(item.valuePct) : undefined,
          bgColor: jsonStyleMatched && typeof item.bgColor === 'string' ? item.bgColor : undefined,
          accentColor:
            jsonStyleMatched && typeof item.accentColor === 'string' ? item.accentColor : undefined
        }))
      }
    } catch {
      // fallback to default blueprint rects
    }
  }

  if (layersTopToBottom.length === 0 && blueprint !== 'blank_canvas') {
    if (blueprint === 'title_menu') {
      layersTopToBottom = [
        {
          name: 'Currency_Bar',
          kind: 'currency_bar',
          x: 1460,
          y: 36,
          w: 400,
          h: 58,
          visible: true,
          opacity: 100
        },
        {
          name: 'Btn_Start',
          kind: 'ui_button',
          x: 740,
          y: 520,
          w: 440,
          h: 86,
          visible: true,
          opacity: 100
        },
        {
          name: 'Btn_Continue',
          kind: 'ui_button',
          x: 740,
          y: 626,
          w: 440,
          h: 82,
          visible: true,
          opacity: 100
        },
        {
          name: 'Btn_Settings',
          kind: 'ui_button',
          x: 740,
          y: 728,
          w: 440,
          h: 82,
          visible: true,
          opacity: 100
        },
        {
          name: 'Logo_Banner',
          kind: 'panel_box',
          x: 480,
          y: 110,
          w: 960,
          h: 280,
          visible: true,
          opacity: 100
        }
      ]
    } else if (blueprint === 'shop_gacha') {
      layersTopToBottom = [
        {
          name: 'Primogem_Bar',
          kind: 'currency_bar',
          x: 1380,
          y: 32,
          w: 480,
          h: 60,
          visible: true,
          opacity: 100
        },
        {
          name: 'Banner_Tabs',
          kind: 'tab_bar',
          x: 80,
          y: 32,
          w: 760,
          h: 64,
          visible: true,
          opacity: 100
        },
        {
          name: 'Wish_10X',
          kind: 'ui_button',
          x: 1360,
          y: 928,
          w: 460,
          h: 96,
          visible: true,
          opacity: 100
        },
        {
          name: 'Wish_1X',
          kind: 'ui_button',
          x: 880,
          y: 928,
          w: 440,
          h: 96,
          visible: true,
          opacity: 100
        },
        {
          name: 'Card_Right',
          kind: 'foil_card',
          x: 1320,
          y: 140,
          w: 480,
          h: 730,
          visible: true,
          opacity: 100
        },
        {
          name: 'Card_Center',
          kind: 'foil_card',
          x: 710,
          y: 118,
          w: 520,
          h: 760,
          visible: true,
          opacity: 100
        },
        {
          name: 'Card_Left',
          kind: 'foil_card',
          x: 140,
          y: 140,
          w: 480,
          h: 730,
          visible: true,
          opacity: 100
        }
      ]
    } else if (blueprint === 'inventory_paperdoll') {
      layersTopToBottom = [
        {
          name: 'Category_Tabs',
          kind: 'tab_bar',
          x: 640,
          y: 36,
          w: 820,
          h: 64,
          visible: true,
          opacity: 100
        },
        {
          name: 'Currency_Bar',
          kind: 'currency_bar',
          x: 1480,
          y: 36,
          w: 360,
          h: 60,
          visible: true,
          opacity: 100
        },
        {
          name: 'Btn_Equip',
          kind: 'ui_button',
          x: 1420,
          y: 964,
          w: 400,
          h: 78,
          visible: true,
          opacity: 100
        },
        {
          name: 'Bag_Grid',
          kind: 'inventory_grid',
          x: 640,
          y: 120,
          w: 1180,
          h: 820,
          visible: true,
          opacity: 100
        },
        {
          name: 'Hero_Card',
          kind: 'foil_card',
          x: 96,
          y: 120,
          w: 480,
          h: 860,
          visible: true,
          opacity: 100
        }
      ]
    } else if (blueprint === 'skill_tree') {
      layersTopToBottom = [
        {
          name: 'Constellation_Title',
          kind: 'tab_bar',
          x: 80,
          y: 40,
          w: 680,
          h: 68,
          visible: true,
          opacity: 100
        },
        {
          name: 'Star_Node_1',
          kind: 'item_slot',
          x: 920,
          y: 150,
          w: 132,
          h: 132,
          visible: true,
          opacity: 100
        },
        {
          name: 'Star_Node_2',
          kind: 'item_slot',
          x: 1160,
          y: 310,
          w: 132,
          h: 132,
          visible: true,
          opacity: 100
        },
        {
          name: 'Star_Node_3',
          kind: 'item_slot',
          x: 1220,
          y: 540,
          w: 132,
          h: 132,
          visible: true,
          opacity: 100
        },
        {
          name: 'Star_Node_4',
          kind: 'item_slot',
          x: 1060,
          y: 760,
          w: 132,
          h: 132,
          visible: true,
          opacity: 100
        },
        {
          name: 'Star_Node_5',
          kind: 'item_slot',
          x: 780,
          y: 660,
          w: 132,
          h: 132,
          visible: true,
          opacity: 100
        },
        {
          name: 'Star_Core',
          kind: 'avatar_medallion',
          x: 890,
          y: 410,
          w: 196,
          h: 196,
          visible: true,
          opacity: 100
        },
        {
          name: 'Hero_Portrait',
          kind: 'foil_card',
          x: 96,
          y: 140,
          w: 480,
          h: 840,
          visible: true,
          opacity: 100
        },
        {
          name: 'Talent_Info',
          kind: 'panel_box',
          x: 1420,
          y: 140,
          w: 420,
          h: 840,
          visible: true,
          opacity: 100
        }
      ]
    } else if (blueprint === 'dialogue_vn') {
      layersTopToBottom = [
        {
          name: 'Choice_1',
          kind: 'ui_button',
          x: 1280,
          y: 520,
          w: 520,
          h: 78,
          visible: true,
          opacity: 100
        },
        {
          name: 'Choice_2',
          kind: 'ui_button',
          x: 1280,
          y: 620,
          w: 520,
          h: 78,
          visible: true,
          opacity: 100
        },
        {
          name: 'Dialogue_Box',
          kind: 'dialogue_box',
          x: 140,
          y: 740,
          w: 1640,
          h: 280,
          visible: true,
          opacity: 100
        },
        {
          name: 'Speaker_Card',
          kind: 'foil_card',
          x: 180,
          y: 110,
          w: 520,
          h: 640,
          visible: true,
          opacity: 100
        }
      ]
    } else if (blueprint === 'quest_victory') {
      layersTopToBottom = [
        {
          name: 'Btn_Claim',
          kind: 'ui_button',
          x: 740,
          y: 890,
          w: 440,
          h: 92,
          visible: true,
          opacity: 100
        },
        {
          name: 'Reward_1',
          kind: 'item_slot',
          x: 560,
          y: 560,
          w: 160,
          h: 160,
          visible: true,
          opacity: 100
        },
        {
          name: 'Reward_2',
          kind: 'item_slot',
          x: 760,
          y: 560,
          w: 160,
          h: 160,
          visible: true,
          opacity: 100
        },
        {
          name: 'Reward_3',
          kind: 'item_slot',
          x: 960,
          y: 560,
          w: 160,
          h: 160,
          visible: true,
          opacity: 100
        },
        {
          name: 'Reward_4',
          kind: 'item_slot',
          x: 1160,
          y: 560,
          w: 160,
          h: 160,
          visible: true,
          opacity: 100
        },
        {
          name: 'Victory_Banner',
          kind: 'panel_box',
          x: 420,
          y: 140,
          w: 1080,
          h: 680,
          visible: true,
          opacity: 95
        }
      ]
    } else if (blueprint === 'settings_form') {
      layersTopToBottom = [
        {
          name: 'Settings_Tabs',
          kind: 'tab_bar',
          x: 260,
          y: 110,
          w: 1400,
          h: 72,
          visible: true,
          opacity: 100
        },
        {
          name: 'Volume_Master',
          kind: 'slider_bar',
          x: 420,
          y: 300,
          w: 1080,
          h: 64,
          visible: true,
          opacity: 100,
          valuePct: 85
        },
        {
          name: 'Volume_BGM',
          kind: 'slider_bar',
          x: 420,
          y: 420,
          w: 1080,
          h: 64,
          visible: true,
          opacity: 100,
          valuePct: 72
        },
        {
          name: 'Graphics_Quality',
          kind: 'slider_bar',
          x: 420,
          y: 540,
          w: 1080,
          h: 64,
          visible: true,
          opacity: 100,
          valuePct: 90
        },
        {
          name: 'Btn_Apply',
          kind: 'ui_button',
          x: 760,
          y: 820,
          w: 400,
          h: 84,
          visible: true,
          opacity: 100
        },
        {
          name: 'Settings_Panel',
          kind: 'settings_panel',
          x: 240,
          y: 96,
          w: 1440,
          h: 880,
          visible: true,
          opacity: 96
        }
      ]
    } else {
      layersTopToBottom = [
        {
          name: 'Skill_Bar',
          kind: 'skill_bar',
          x: 1160,
          y: 884,
          w: 680,
          h: 152,
          visible: true,
          opacity: 100
        },
        {
          name: 'Minimap',
          kind: 'minimap_compass',
          x: 52,
          y: 36,
          w: 236,
          h: 236,
          visible: true,
          opacity: 100
        },
        {
          name: 'Boss_Bar',
          kind: 'boss_bar',
          x: 580,
          y: 32,
          w: 760,
          h: 86,
          visible: true,
          opacity: 100,
          valuePct: 78
        },
        {
          name: 'Shield_Bar',
          kind: 'shield_bar',
          x: 680,
          y: 984,
          w: 420,
          h: 40,
          visible: true,
          opacity: 100,
          valuePct: 84
        },
        {
          name: 'HP_Bar',
          kind: 'hp_bar',
          x: 680,
          y: 932,
          w: 420,
          h: 46,
          visible: true,
          opacity: 100,
          valuePct: 82
        },
        {
          name: 'Party_Slot_1',
          kind: 'avatar_medallion',
          x: 1700,
          y: 260,
          w: 156,
          h: 156,
          visible: true,
          opacity: 100
        },
        {
          name: 'Party_Slot_2',
          kind: 'avatar_medallion',
          x: 1700,
          y: 440,
          w: 156,
          h: 156,
          visible: true,
          opacity: 100
        }
      ]
    }
  }

  // 3. Render visible layers bottom-to-top onto data
  const orderedBottomToTop = [...layersTopToBottom].reverse().filter((l) => l.visible)
  let artSlotCounter = 0

  // Pre-connect skill tree / constellation lines between item_slot / avatar_medallion nodes
  const starNodes = orderedBottomToTop.filter(
    (l) => l.kind === 'item_slot' || (blueprint === 'skill_tree' && l.kind === 'avatar_medallion')
  )
  if (starNodes.length >= 3) {
    for (let i = 0; i < starNodes.length - 1; i++) {
      const a = starNodes[i]!
      const b = starNodes[i + 1]!
      const ax = Math.round(((a.x + a.w * 0.5) / designW) * outW)
      const ay = Math.round(((a.y + a.h * 0.5) / designH) * outH)
      const bx = Math.round(((b.x + b.w * 0.5) / designW) * outW)
      const by = Math.round(((b.y + b.h * 0.5) / designH) * outH)
      const steps = Math.max(16, Math.hypot(bx - ax, by - ay))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const px = Math.round(ax + (bx - ax) * t)
        const py = Math.round(ay + (by - ay) * t)
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const xx = px + ox
            const yy = py + oy
            if (xx < 0 || xx >= outW || yy < 0 || yy >= outH) continue
            const idx = (yy * outW + xx) * 4
            const w = ox === 0 && oy === 0 ? 0.78 : 0.35
            data[idx] = clampByte(theme.rim[0] * w + data[idx]! * (1 - w))
            data[idx + 1] = clampByte(theme.rim[1] * w + data[idx + 1]! * (1 - w))
            data[idx + 2] = clampByte(theme.rim[2] * w + data[idx + 2]! * (1 - w))
          }
        }
      }
    }
  }

  for (const lyr of orderedBottomToTop) {
    const x0 = clamp(Math.round((lyr.x / designW) * outW), 0, outW - 2)
    const y0 = clamp(Math.round((lyr.y / designH) * outH), 0, outH - 2)
    const x1 = clamp(Math.round(((lyr.x + lyr.w) / designW) * outW), x0 + 4, outW)
    const y1 = clamp(Math.round(((lyr.y + lyr.h) / designH) * outH), y0 + 4, outH)
    const lw = Math.max(4, x1 - x0)
    const lh = Math.max(4, y1 - y0)
    const alphaMul = clamp(lyr.opacity / 100, 0, 1)
    const rectAspect = lw / Math.max(1, lh)

    const defaultAccent: [number, number, number] =
      lyr.kind === 'hp_bar'
        ? stylePreset === 'celestial_star_gold'
          ? [150, 218, 92]
          : stylePreset === 'ink_paper_cel'
            ? [204, 42, 42]
            : stylePreset === 'minimal_ark_tech'
              ? [56, 189, 248]
              : stylePreset === 'cyber_holo_grid'
                ? [255, 42, 148]
                : [239, 68, 68]
        : lyr.kind === 'boss_bar'
          ? stylePreset === 'ink_paper_cel'
            ? [188, 32, 32]
            : stylePreset === 'cyber_holo_grid'
              ? [255, 42, 148]
              : stylePreset === 'arcane_crystal'
                ? [216, 96, 255]
                : [235, 84, 76]
          : lyr.kind === 'shield_bar'
            ? stylePreset === 'ink_paper_cel'
              ? [58, 138, 126]
              : stylePreset === 'minimal_ark_tech'
                ? [255, 132, 24]
                : [76, 201, 240]
            : theme.rim
    const bgCol = parseHexRgbOrDefault(lyr.bgColor, theme.bg)
    const rimCol = parseHexRgbOrDefault(lyr.accentColor, defaultAccent)
    const fillRatio = clamp((lyr.valuePct ?? 78) / 100, 0.08, 1)

    if (lyr.kind === 'avatar_medallion') {
      const chosenSource = sourcePool[artSlotCounter++ % sourcePool.length] ?? sourcePool[0]!
      const cx = (x0 + x1) * 0.5
      const cy = (y0 + y1) * 0.5
      const rad = Math.min(lw, lh) * 0.48
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const dx = px - cx
          const dy = py - cy
          const dist = Math.hypot(dx, dy)
          if (dist > rad) continue
          const normR = dist / Math.max(1, rad)
          const idx = (py * outW + px) * 4
          let r = bgCol[0]
          let g = bgCol[1]
          let b = bgCol[2]
          if (normR > 0.86) {
            const bevel = dy < dx ? 1.18 : 0.82
            r = clampByte(rimCol[0] * bevel)
            g = clampByte(rimCol[1] * bevel)
            b = clampByte(rimCol[2] * bevel)
          } else if (normR > 0.79) {
            r = clampByte(theme.accent[0] * 0.75)
            g = clampByte(theme.accent[1] * 0.75)
            b = clampByte(theme.accent[2] * 0.75)
          } else {
            const u = clamp((dx / (rad * 0.79)) * 0.5 + 0.5, 0, 1)
            const v = clamp((dy / (rad * 0.79)) * 0.5 + 0.5, 0, 1)
            const radialBg: [number, number, number] = [
              clampByte(bgCol[0] * 0.92 + rimCol[0] * 0.14 * (1 - normR)),
              clampByte(bgCol[1] * 0.92 + rimCol[1] * 0.14 * (1 - normR)),
              clampByte(bgCol[2] * 0.95 + rimCol[2] * 0.16 * (1 - normR))
            ]
            const [sr, sg, sb] = sampleSourceAspectClean(chosenSource, u, v, 1, radialBg, 0.32)
            r = sr
            g = sg
            b = sb
          }
          const edgeAa = clamp((rad - dist) * 1.2, 0, 1) * alphaMul
          data[idx] = clampByte(r * edgeAa + data[idx]! * (1 - edgeAa))
          data[idx + 1] = clampByte(g * edgeAa + data[idx + 1]! * (1 - edgeAa))
          data[idx + 2] = clampByte(b * edgeAa + data[idx + 2]! * (1 - edgeAa))
          data[idx + 3] = 255
        }
      }
      // Elemental / Style badge on top-left of medallion
      drawFourPointStarOnBuffer(
        data,
        outW,
        outH,
        x0 + lw * 0.18,
        y0 + lh * 0.18,
        Math.max(4, Math.min(lw, lh) * 0.11),
        theme.accent,
        alphaMul
      )
    } else if (lyr.kind === 'minimap_compass') {
      const cx = (x0 + x1) * 0.5
      const cy = (y0 + y1) * 0.5
      const rad = Math.min(lw, lh) * 0.48
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const dx = px - cx
          const dy = py - cy
          const dist = Math.hypot(dx, dy)
          if (dist > rad) continue
          const normR = dist / Math.max(1, rad)
          const idx = (py * outW + px) * 4
          let r = bgCol[0]
          let g = bgCol[1]
          let b = bgCol[2]
          if (normR > 0.87) {
            r = rimCol[0]
            g = rimCol[1]
            b = rimCol[2]
          } else {
            const terrainWave =
              Math.sin(px * 0.12) * Math.cos(py * 0.12) * 16 + Math.sin((px + py) * 0.06) * 12
            const onGrid = Math.abs(normR - 0.52) < 0.025 || Math.abs(dx) < 1 || Math.abs(dy) < 1
            if (stylePreset === 'ink_paper_cel') {
              r = clampByte(228 + terrainWave * 0.45 - (onGrid ? 95 : 0))
              g = clampByte(216 + terrainWave * 0.42 - (onGrid ? 95 : 0))
              b = clampByte(194 + terrainWave * 0.38 - (onGrid ? 90 : 0))
            } else if (stylePreset === 'persona_rebel_red') {
              r = clampByte(22 + Math.max(0, terrainWave) * 1.4 + (onGrid ? 195 : 0))
              g = clampByte(12 + (onGrid ? 16 : 0))
              b = clampByte(16 + (onGrid ? 24 : 0))
            } else if (stylePreset === 'cyber_holo_grid') {
              r = clampByte(8 + (onGrid ? 24 : 0))
              g = clampByte(34 + terrainWave * 0.7 + (onGrid ? 180 : 0))
              b = clampByte(56 + terrainWave * 0.9 + (onGrid ? 200 : 0))
            } else {
              const ringGrid = onGrid ? 28 : 0
              r = clampByte(bgCol[0] * 0.85 + terrainWave * 0.5 + ringGrid)
              g = clampByte(bgCol[1] * 0.9 + terrainWave * 0.8 + ringGrid)
              b = clampByte(bgCol[2] * 0.98 + terrainWave + ringGrid * 1.2)
            }
          }
          const edgeAa = clamp((rad - dist) * 1.2, 0, 1) * alphaMul
          data[idx] = clampByte(r * edgeAa + data[idx]! * (1 - edgeAa))
          data[idx + 1] = clampByte(g * edgeAa + data[idx + 1]! * (1 - edgeAa))
          data[idx + 2] = clampByte(b * edgeAa + data[idx + 2]! * (1 - edgeAa))
          data[idx + 3] = 255
        }
      }
      drawFourPointStarOnBuffer(
        data,
        outW,
        outH,
        cx,
        cy,
        Math.max(4, rad * 0.16),
        theme.accent,
        alphaMul
      )
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        'N',
        cx,
        y0 + Math.max(6, rad * 0.14),
        1,
        [255, 240, 188],
        [10, 14, 24],
        alphaMul
      )
    } else if (lyr.kind === 'foil_card' || lyr.kind === 'custom_image') {
      const chosenSource =
        sourcePool[
          lyr.name.toLowerCase().includes('center') && sourcePool.length > 1
            ? 1
            : artSlotCounter++ % sourcePool.length
        ] ?? sourcePool[0]!
      drawOrnatePanelBoxOnBuffer(
        data,
        outW,
        outH,
        x0,
        y0,
        x1,
        y1,
        bgCol,
        rimCol,
        alphaMul,
        Math.max(5, Math.round(Math.min(lw, lh) * 0.04))
      )
      const pad = Math.max(4, Math.round(Math.min(lw, lh) * 0.045))
      const footerH = Math.max(16, Math.round(lh * 0.18))
      const ax0 = x0 + pad
      const ay0 = y0 + pad
      const ax1 = x1 - pad
      const ay1 = Math.max(ay0 + 4, y1 - footerH)
      const aw = Math.max(2, ax1 - ax0)
      const ah = Math.max(2, ay1 - ay0)
      const artAspect = aw / ah

      for (let py = ay0; py < ay1; py++) {
        const v = (py - ay0) / Math.max(1, ah - 1)
        for (let px = ax0; px < ax1; px++) {
          const u = (px - ax0) / Math.max(1, aw - 1)
          const radialGlow = clamp(1 - Math.hypot(u - 0.5, v - 0.38) * 1.1, 0, 1)
          const backdropCol: [number, number, number] = [
            clampByte(bgCol[0] * 0.85 + rimCol[0] * 0.32 * radialGlow),
            clampByte(bgCol[1] * 0.85 + rimCol[1] * 0.28 * radialGlow),
            clampByte(bgCol[2] * 0.95 + rimCol[2] * 0.35 * radialGlow)
          ]
          const [sr, sg, sb] = sampleSourceAspectClean(
            chosenSource,
            u,
            v,
            artAspect,
            backdropCol,
            0.34
          )
          // Subtle diagonal foil sheen
          const sheen = Math.max(0, 1 - Math.abs(u * 0.9 + v * 0.6 - 0.72) * 6.5) * 26
          const idx = (py * outW + px) * 4
          data[idx] = clampByte((sr + sheen) * alphaMul + data[idx]! * (1 - alphaMul))
          data[idx + 1] = clampByte((sg + sheen) * alphaMul + data[idx + 1]! * (1 - alphaMul))
          data[idx + 2] = clampByte((sb + sheen * 0.8) * alphaMul + data[idx + 2]! * (1 - alphaMul))
          data[idx + 3] = 255
        }
      }

      // Draw 5-star rarity row + label in card footer
      const starY = Math.round(ay1 + (y1 - ay1) * 0.34)
      const starSpacing = Math.max(6, Math.min(14, Math.floor(lw * 0.1)))
      for (let s = -2; s <= 2; s++) {
        drawFourPointStarOnBuffer(
          data,
          outW,
          outH,
          (x0 + x1) * 0.5 + s * starSpacing,
          starY,
          Math.max(2, Math.floor(starSpacing * 0.42)),
          [255, 216, 92],
          alphaMul
        )
      }
      if (lh >= 72) {
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          toRenderableUiLabel(lyr.name, 'SSR HERO').slice(
            0,
            Math.max(6, Math.floor(lw / (7 * textScale)))
          ),
          (x0 + x1) * 0.5,
          Math.round(ay1 + (y1 - ay1) * 0.72),
          1,
          [246, 236, 210],
          [10, 12, 22],
          alphaMul
        )
      }
    } else if (lyr.kind === 'inventory_grid') {
      drawOrnatePanelBoxOnBuffer(data, outW, outH, x0, y0, x1, y1, bgCol, rimCol, alphaMul, 8)
      const pad = Math.max(6, Math.round(Math.min(lw, lh) * 0.04))
      const hasDetailPane = lw > lh * 1.15
      const gridAreaW = hasDetailPane ? Math.round(lw * 0.66) : lw - pad * 2
      const cols = lw >= 260 ? 5 : 4
      const rows = lh >= 180 ? 4 : 3
      const gap = Math.max(3, Math.round(Math.min(gridAreaW, lh) * 0.022))
      const cellW = Math.max(12, Math.floor((gridAreaW - pad - gap * (cols - 1)) / cols))
      const cellH = Math.max(12, Math.floor((lh - pad * 2 - gap * (rows - 1)) / rows))

      const rarityRims: Array<[number, number, number]> = [
        [242, 198, 92], // 5-star Gold
        [242, 198, 92],
        [188, 122, 246], // 4-star Purple
        [88, 182, 248], // 3-star Blue
        [242, 198, 92]
      ]

      for (let rIdx = 0; rIdx < rows; rIdx++) {
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          const slotIdx = rIdx * cols + cIdx
          const sx0 = x0 + pad + cIdx * (cellW + gap)
          const sy0 = y0 + pad + rIdx * (cellH + gap)
          const sx1 = Math.min(x1 - pad, sx0 + cellW)
          const sy1 = Math.min(y1 - pad, sy0 + cellH)
          if (sx1 - sx0 < 8 || sy1 - sy0 < 8) continue
          const slotRim = rarityRims[slotIdx % rarityRims.length]!
          const slotBg: [number, number, number] = [
            clampByte(bgCol[0] * 0.72 + slotRim[0] * 0.16),
            clampByte(bgCol[1] * 0.72 + slotRim[1] * 0.16),
            clampByte(bgCol[2] * 0.8 + slotRim[2] * 0.18)
          ]
          drawOrnatePanelBoxOnBuffer(
            data,
            outW,
            outH,
            sx0,
            sy0,
            sx1,
            sy1,
            slotBg,
            slotIdx === 0 ? [255, 238, 148] : slotRim,
            alphaMul,
            3
          )
          const srcItem = iconSource
          // Crop different zoom/offset regions of the artifact icon sheet so slots look varied
          const qx = (slotIdx % 3) * 0.08
          const qy = (Math.floor(slotIdx / 3) % 2) * 0.08
          const zoom = 0.86 - (slotIdx % 3) * 0.04
          for (let py = sy0 + 3; py < sy1 - 3; py++) {
            const v = qy + ((py - sy0 - 3) / Math.max(1, sy1 - sy0 - 7)) * zoom
            for (let px = sx0 + 3; px < sx1 - 3; px++) {
              const u = qx + ((px - sx0 - 3) / Math.max(1, sx1 - sx0 - 7)) * zoom
              const [ir, ig, ib] = sampleSourceAspectClean(
                srcItem,
                clamp(u, 0, 1),
                clamp(v, 0, 1),
                1,
                slotBg,
                0.45
              )
              const idx = (py * outW + px) * 4
              data[idx] = clampByte(ir * alphaMul + data[idx]! * (1 - alphaMul))
              data[idx + 1] = clampByte(ig * alphaMul + data[idx + 1]! * (1 - alphaMul))
              data[idx + 2] = clampByte(ib * alphaMul + data[idx + 2]! * (1 - alphaMul))
            }
          }
          if (cellH >= 24) {
            drawUiTextOnBuffer(
              data,
              outW,
              outH,
              '+20',
              (sx0 + sx1) * 0.5,
              sy1 - Math.max(5, Math.floor(cellH * 0.16)),
              1,
              [255, 244, 200],
              [10, 12, 20],
              alphaMul
            )
          }
        }
      }

      if (hasDetailPane) {
        const dx0 = x0 + gridAreaW + Math.floor(pad * 0.6)
        const dy0 = y0 + pad
        const dx1 = x1 - pad
        const dy1 = y1 - pad
        if (dx1 - dx0 >= 36) {
          drawOrnatePanelBoxOnBuffer(
            data,
            outW,
            outH,
            dx0,
            dy0,
            dx1,
            dy1,
            [clampByte(bgCol[0] * 1.12), clampByte(bgCol[1] * 1.12), clampByte(bgCol[2] * 1.18)],
            rimCol,
            alphaMul,
            4
          )
          const previewH = Math.min(dx1 - dx0 - 8, Math.floor((dy1 - dy0) * 0.42))
          const px0 = dx0 + 6
          const py0 = dy0 + 6
          const px1 = dx1 - 6
          const py1 = py0 + previewH
          for (let py = py0; py < py1; py++) {
            const v = (py - py0) / Math.max(1, py1 - py0 - 1)
            for (let px = px0; px < px1; px++) {
              const u = (px - px0) / Math.max(1, px1 - px0 - 1)
              const [ir, ig, ib] = sampleSourceAspectClean(iconSource, u, v, 1, bgCol, 0.45)
              const idx = (py * outW + px) * 4
              data[idx] = ir
              data[idx + 1] = ig
              data[idx + 2] = ib
            }
          }
          const statLines = ['SSR GOBLET +20', 'ATK +46.6%', 'CRIT DMG +28%', 'CRIT RATE +10%']
          statLines.forEach((line, idxLine) => {
            const ly = py1 + 14 + idxLine * Math.max(10, Math.floor((dy1 - py1 - 16) / 4))
            if (ly < dy1 - 6) {
              drawUiTextOnBuffer(
                data,
                outW,
                outH,
                line.slice(0, Math.max(6, Math.floor((dx1 - dx0) / 6))),
                (dx0 + dx1) * 0.5,
                ly,
                1,
                idxLine === 0 ? [255, 220, 118] : [224, 232, 248],
                [10, 12, 20],
                alphaMul
              )
            }
          })
        }
      }
    } else if (lyr.kind === 'skill_bar') {
      const count = 4
      const keys = ['E', 'Q', 'R', 'F']
      const slotGap = Math.max(4, Math.floor(lw * 0.04))
      const slotSize = Math.min(lh - 4, Math.floor((lw - slotGap * (count - 1)) / count))
      const totalBarW = slotSize * count + slotGap * (count - 1)
      const startX = Math.round((x0 + x1 - totalBarW) * 0.5)
      const cy = Math.round((y0 + y1) * 0.5)

      for (let i = 0; i < count; i++) {
        const isBurst = i === count - 1
        const rad = Math.round(slotSize * (isBurst ? 0.52 : 0.44))
        const cx = Math.round(startX + i * (slotSize + slotGap) + slotSize * 0.5)
        const sx0 = Math.max(0, cx - rad)
        const sx1 = Math.min(outW - 1, cx + rad)
        const sy0 = Math.max(0, cy - rad)
        const sy1 = Math.min(outH - 1, cy + rad)

        for (let py = sy0; py <= sy1; py++) {
          for (let px = sx0; px <= sx1; px++) {
            const dx = Math.abs(px - cx)
            const dy = Math.abs(py - cy)
            const metric = isBurst ? Math.hypot(dx, dy) : (dx + dy) * 0.76
            if (metric > rad) continue
            const norm = metric / Math.max(1, rad)
            const idx = (py * outW + px) * 4
            let r = bgCol[0]
            let g = bgCol[1]
            let b = bgCol[2]
            if (norm > 0.82) {
              r = isBurst ? 255 : rimCol[0]
              g = isBurst ? 218 : rimCol[1]
              b = isBurst ? 98 : rimCol[2]
            } else {
              const u = clamp((px - cx) / (rad * 1.5) + 0.5, 0, 1)
              const v = clamp((py - cy) / (rad * 1.5) + 0.5, 0, 1)
              const [ir, ig, ib] = sampleSourceAspectClean(iconSource, u, v, 1, bgCol, 0.45)
              r = ir
              g = ig
              b = ib
            }
            data[idx] = clampByte(r * alphaMul + data[idx]! * (1 - alphaMul))
            data[idx + 1] = clampByte(g * alphaMul + data[idx + 1]! * (1 - alphaMul))
            data[idx + 2] = clampByte(b * alphaMul + data[idx + 2]! * (1 - alphaMul))
            data[idx + 3] = 255
          }
        }
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          keys[i]!,
          cx,
          Math.min(outH - 5, cy + rad - 2),
          1,
          [255, 244, 196],
          [8, 10, 18],
          alphaMul
        )
      }
    } else if (lyr.kind === 'item_slot') {
      const slotSrc = sourcePool[(artSlotCounter++ + 2) % sourcePool.length] ?? iconSource
      drawOrnatePanelBoxOnBuffer(data, outW, outH, x0, y0, x1, y1, bgCol, rimCol, alphaMul, 5)
      const pad = Math.max(3, Math.round(Math.min(lw, lh) * 0.1))
      for (let py = y0 + pad; py < y1 - pad; py++) {
        const v = (py - y0 - pad) / Math.max(1, lh - pad * 2 - 1)
        for (let px = x0 + pad; px < x1 - pad; px++) {
          const u = (px - x0 - pad) / Math.max(1, lw - pad * 2 - 1)
          const [ir, ig, ib] = sampleSourceAspectClean(slotSrc, u, v, rectAspect, bgCol, 0.45)
          const idx = (py * outW + px) * 4
          data[idx] = clampByte(ir * alphaMul + data[idx]! * (1 - alphaMul))
          data[idx + 1] = clampByte(ig * alphaMul + data[idx + 1]! * (1 - alphaMul))
          data[idx + 2] = clampByte(ib * alphaMul + data[idx + 2]! * (1 - alphaMul))
        }
      }
      drawFourPointStarOnBuffer(
        data,
        outW,
        outH,
        (x0 + x1) * 0.5,
        y0 + Math.max(4, pad),
        Math.max(3, Math.min(lw, lh) * 0.1),
        [255, 228, 128],
        alphaMul
      )
    } else if (
      lyr.kind === 'hp_bar' ||
      lyr.kind === 'shield_bar' ||
      lyr.kind === 'boss_bar' ||
      lyr.kind === 'slider_bar'
    ) {
      drawOrnatePanelBoxOnBuffer(data, outW, outH, x0, y0, x1, y1, bgCol, rimCol, alphaMul, 4)
      const pad = Math.max(3, Math.round(Math.min(lw, lh) * 0.14))
      const fx0 = x0 + pad
      const fy0 = y0 + pad
      const fx1 = x0 + pad + Math.round((lw - pad * 2) * fillRatio)
      const fy1 = y1 - pad
      for (let py = fy0; py < fy1; py++) {
        const v = (py - fy0) / Math.max(1, fy1 - fy0 - 1)
        const sheen = v < 0.42 ? 1.24 : 0.88
        for (let px = fx0; px < fx1; px++) {
          const u = (px - fx0) / Math.max(1, lw - pad * 2)
          const isTick = u > 0.08 && u < 0.95 && Math.abs((u * 10) % 1) < 0.035 && v < 0.45
          const idx = (py * outW + px) * 4
          const r = isTick ? 18 : clampByte(rimCol[0] * sheen)
          const g = isTick ? 22 : clampByte(rimCol[1] * sheen)
          const b = isTick ? 32 : clampByte(rimCol[2] * sheen)
          data[idx] = clampByte(r * alphaMul + data[idx]! * (1 - alphaMul))
          data[idx + 1] = clampByte(g * alphaMul + data[idx + 1]! * (1 - alphaMul))
          data[idx + 2] = clampByte(b * alphaMul + data[idx + 2]! * (1 - alphaMul))
        }
      }
      const barLabel =
        lyr.kind === 'boss_bar'
          ? 'ASTRAL SOVEREIGN  LV.90'
          : lyr.kind === 'hp_bar'
            ? 'HP 18420 / 22400'
            : lyr.kind === 'shield_bar'
              ? 'ENERGY 100%'
              : `${toRenderableUiLabel(lyr.name, 'VALUE')} ${Math.round(fillRatio * 100)}%`
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        barLabel,
        (x0 + x1) * 0.5,
        (y0 + y1) * 0.5,
        1,
        [255, 250, 236],
        [8, 10, 18],
        alphaMul
      )
    } else if (lyr.kind === 'ui_button' || lyr.kind === 'tab_bar' || lyr.kind === 'currency_bar') {
      const btnBg: [number, number, number] =
        lyr.kind === 'ui_button'
          ? stylePreset === 'ink_paper_cel'
            ? [226, 212, 186]
            : stylePreset === 'persona_rebel_red'
              ? [216, 18, 34]
              : stylePreset === 'cyber_holo_grid'
                ? [8, 38, 58]
                : stylePreset === 'minimal_ark_tech'
                  ? [36, 42, 50]
                  : [
                      clampByte(bgCol[0] * 0.45 + rimCol[0] * 0.55),
                      clampByte(bgCol[1] * 0.45 + rimCol[1] * 0.52),
                      clampByte(bgCol[2] * 0.5 + rimCol[2] * 0.45)
                    ]
          : bgCol
      drawOrnatePanelBoxOnBuffer(
        data,
        outW,
        outH,
        x0,
        y0,
        x1,
        y1,
        btnBg,
        rimCol,
        alphaMul,
        Math.max(4, Math.round(lh * 0.22))
      )

      if (lyr.kind === 'tab_bar') {
        const tabs = ['WISH', 'ARTIFACTS', 'CONSTELLATION', 'WEAPON']
        const tabCount = Math.min(4, Math.max(2, Math.floor(lw / 56)))
        const segW = lw / tabCount
        for (let t = 0; t < tabCount; t++) {
          const tx = Math.round(x0 + segW * (t + 0.5))
          if (t > 0) {
            const divX = Math.round(x0 + segW * t)
            for (let py = y0 + 4; py < y1 - 4; py++) {
              const idx = (py * outW + divX) * 4
              data[idx] = rimCol[0]
              data[idx + 1] = rimCol[1]
              data[idx + 2] = rimCol[2]
            }
          }
          drawUiTextOnBuffer(
            data,
            outW,
            outH,
            tabs[t]!,
            tx,
            (y0 + y1) * 0.5,
            1,
            t === 0 ? [255, 236, 152] : [206, 214, 232],
            [8, 10, 18],
            alphaMul
          )
        }
      } else if (lyr.kind === 'currency_bar') {
        drawFourPointStarOnBuffer(
          data,
          outW,
          outH,
          x0 + Math.min(20, lw * 0.14),
          (y0 + y1) * 0.5,
          Math.max(4, lh * 0.28),
          theme.accent,
          alphaMul
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          '16000 +',
          (x0 + x1) * 0.54,
          (y0 + y1) * 0.5,
          textScale,
          [255, 244, 208],
          [8, 10, 18],
          alphaMul
        )
      } else {
        drawFourPointStarOnBuffer(
          data,
          outW,
          outH,
          x0 + Math.min(22, lw * 0.1),
          (y0 + y1) * 0.5,
          Math.max(3, lh * 0.2),
          theme.accent,
          alphaMul
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          toRenderableUiLabel(lyr.name, 'ACTION'),
          (x0 + x1) * 0.52,
          (y0 + y1) * 0.5,
          textScale,
          [255, 250, 232],
          [12, 14, 24],
          alphaMul
        )
      }
    } else if (lyr.kind === 'buff_icons') {
      const count = 4
      const labels = ['ATK+', 'SHLD', 'CRIT', 'ELEM']
      const slotGap = Math.max(3, Math.floor(lw * 0.04))
      const slotSize = Math.min(lh, Math.floor((lw - slotGap * (count - 1)) / count))
      for (let i = 0; i < count; i++) {
        const sx0 = x0 + i * (slotSize + slotGap)
        const sx1 = sx0 + slotSize
        drawOrnatePanelBoxOnBuffer(
          data,
          outW,
          outH,
          sx0,
          y0,
          sx1,
          y0 + slotSize,
          bgCol,
          rimCol,
          alphaMul,
          3
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          labels[i]!,
          (sx0 + sx1) * 0.5,
          y0 + slotSize * 0.5,
          1,
          [255, 236, 156],
          [8, 10, 18],
          alphaMul
        )
      }
    } else if (lyr.kind === 'key_prompt') {
      drawOrnatePanelBoxOnBuffer(
        data,
        outW,
        outH,
        x0,
        y0,
        x1,
        y1,
        bgCol,
        rimCol,
        alphaMul,
        Math.max(4, Math.round(lh * 0.28))
      )
      const keySize = Math.max(10, lh - 6)
      drawOrnatePanelBoxOnBuffer(
        data,
        outW,
        outH,
        x0 + 4,
        y0 + 3,
        x0 + 4 + keySize,
        y1 - 3,
        [clampByte(rimCol[0] * 0.85), clampByte(rimCol[1] * 0.82), clampByte(rimCol[2] * 0.72)],
        [255, 250, 224],
        alphaMul,
        2
      )
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        'F',
        x0 + 4 + keySize * 0.5,
        (y0 + y1) * 0.5,
        1,
        [20, 24, 36],
        [255, 255, 255],
        alphaMul
      )
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        'PICK UP ARTIFACT',
        x0 + keySize + (lw - keySize) * 0.5,
        (y0 + y1) * 0.5,
        1,
        [255, 248, 220],
        [8, 10, 18],
        alphaMul
      )
    } else if (lyr.kind === 'text_label') {
      const suiteMainTitle =
        blueprint === 'quest_victory'
          ? 'DOMAIN CHALLENGE CLEAR'
          : stylePreset === 'ink_paper_cel'
            ? 'INK SCROLL CHRONICLES'
            : stylePreset === 'persona_rebel_red'
              ? 'REBEL PHANTOM UI'
              : stylePreset === 'cyber_holo_grid'
                ? 'CYBER HOLO MATRIX 2099'
                : stylePreset === 'minimal_ark_tech'
                  ? 'RHODES PRTS TERMINAL'
                  : stylePreset === 'royal_gold_enamel'
                    ? 'IMPERIAL GRAND ENAMEL'
                    : stylePreset === 'arcane_crystal'
                      ? 'ARCANE ASTRAL GRIMOIRE'
                      : stylePreset === 'dark_iron_parchment'
                        ? 'ASHEN CITADEL SOULS'
                        : 'CELESTIAL FANTASY UI'
      const suiteSubTitle =
        stylePreset === 'ink_paper_cel'
          ? 'XUAN PAPER & SUMI INK // FULL SUITE'
          : stylePreset === 'persona_rebel_red'
            ? 'CRIMSON METAVERSE // FULL SUITE'
            : stylePreset === 'cyber_holo_grid'
              ? 'NEURAL SYNTHWAVE HUD // FULL SUITE'
              : stylePreset === 'minimal_ark_tech'
                ? 'TACTICAL OPERATOR HUD // FULL SUITE'
                : stylePreset === 'royal_gold_enamel'
                  ? 'ROYAL CATHEDRAL // FULL SUITE'
                  : stylePreset === 'arcane_crystal'
                    ? 'RUNE CONCLAVE // FULL SUITE'
                    : stylePreset === 'dark_iron_parchment'
                      ? 'DARK IRON & EMBER // FULL SUITE'
                      : 'ASTRAL EDITION // FULL SUITE'
      const hasBackdropBox = orderedBottomToTop.some(
        (item) => item.kind === 'panel_box' && Math.abs(item.y - lyr.y) < 120
      )
      if (!hasBackdropBox) {
        drawOrnatePanelBoxOnBuffer(
          data,
          outW,
          outH,
          x0,
          y0,
          x1,
          y1,
          bgCol,
          rimCol,
          alphaMul * 0.85,
          Math.max(5, Math.round(Math.min(lw, lh) * 0.05))
        )
      }
      drawFourPointStarOnBuffer(
        data,
        outW,
        outH,
        (x0 + x1) * 0.5,
        y0 + lh * 0.22,
        Math.max(5, Math.min(lw, lh) * 0.1),
        theme.accent,
        alphaMul
      )
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        suiteMainTitle,
        (x0 + x1) * 0.5,
        y0 + lh * 0.54,
        textScale,
        [255, 244, 206],
        [8, 10, 18],
        alphaMul
      )
      drawUiTextOnBuffer(
        data,
        outW,
        outH,
        suiteSubTitle,
        (x0 + x1) * 0.5,
        y0 + lh * 0.8,
        1,
        [196, 218, 248],
        [8, 10, 18],
        alphaMul
      )
    } else {
      // panel_box, dialogue_box, settings_panel
      drawOrnatePanelBoxOnBuffer(
        data,
        outW,
        outH,
        x0,
        y0,
        x1,
        y1,
        bgCol,
        rimCol,
        alphaMul,
        Math.max(6, Math.round(Math.min(lw, lh) * 0.04))
      )
      const hasSeparateTextLabel = orderedBottomToTop.some(
        (item) => item.kind === 'text_label' && Math.abs(item.y - lyr.y) < 120
      )
      if (lyr.kind === 'dialogue_box') {
        const nameplateW = Math.min(Math.floor(lw * 0.28), 180)
        const nameplateH = Math.max(14, Math.floor(lh * 0.24))
        const nameplateBg: [number, number, number] =
          stylePreset === 'ink_paper_cel'
            ? [196, 38, 36]
            : stylePreset === 'persona_rebel_red'
              ? [224, 18, 34]
              : [
                  clampByte(rimCol[0] * 0.45),
                  clampByte(rimCol[1] * 0.42),
                  clampByte(rimCol[2] * 0.38)
                ]
        drawOrnatePanelBoxOnBuffer(
          data,
          outW,
          outH,
          x0 + 14,
          Math.max(0, y0 - Math.floor(nameplateH * 0.45)),
          x0 + 14 + nameplateW,
          y0 + Math.floor(nameplateH * 0.55),
          nameplateBg,
          rimCol,
          alphaMul,
          4
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          'LUMINE // ASTROLOGER',
          x0 + 14 + nameplateW * 0.5,
          y0 + 2,
          1,
          [255, 244, 204],
          [8, 10, 18],
          alphaMul
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          'THE STARS ALIGN ACROSS CELESTIAL REALMS...',
          (x0 + x1) * 0.5,
          (y0 + y1) * 0.52,
          textScale,
          [238, 242, 252],
          [8, 10, 18],
          alphaMul
        )
      } else if (lyr.kind === 'settings_panel') {
        const rows = [
          { label: 'GRAPHICS QUALITY // 60 FPS HDR', pct: 0.9 },
          { label: 'MASTER AUDIO VOLUME // 85%', pct: 0.85 },
          { label: 'VOICEOVER & BGM MIX // 75%', pct: 0.75 },
          { label: 'CAMERA SENSITIVITY // 60%', pct: 0.6 }
        ]
        const padX = Math.max(12, Math.floor(lw * 0.08))
        const rowStep = Math.floor((lh - 24) / rows.length)
        rows.forEach((row, rIdx) => {
          const ry = y0 + 16 + rIdx * rowStep
          const barY0 = ry + Math.floor(rowStep * 0.46)
          const barY1 = Math.min(y1 - 8, barY0 + Math.max(8, Math.floor(rowStep * 0.28)))
          drawUiTextOnBuffer(
            data,
            outW,
            outH,
            row.label,
            (x0 + x1) * 0.5,
            ry + Math.floor(rowStep * 0.22),
            1,
            [244, 236, 208],
            [8, 10, 18],
            alphaMul
          )
          if (barY1 > barY0 + 4) {
            drawOrnatePanelBoxOnBuffer(
              data,
              outW,
              outH,
              x0 + padX,
              barY0,
              x1 - padX,
              barY1,
              [clampByte(bgCol[0] * 0.85), clampByte(bgCol[1] * 0.85), clampByte(bgCol[2] * 0.88)],
              rimCol,
              alphaMul,
              2
            )
            const fillX1 = x0 + padX + Math.round((lw - padX * 2) * row.pct)
            const sliderFill = stylePreset === 'ink_paper_cel' ? theme.accent : rimCol
            for (let py = barY0 + 2; py < barY1 - 2; py++) {
              for (let px = x0 + padX + 2; px < fillX1 - 2; px++) {
                const idx = (py * outW + px) * 4
                data[idx] = sliderFill[0]
                data[idx + 1] = sliderFill[1]
                data[idx + 2] = sliderFill[2]
              }
            }
          }
        })
      } else if (
        !hasSeparateTextLabel &&
        (lyr.name.toLowerCase().includes('logo') ||
          lyr.name.toLowerCase().includes('banner') ||
          lyr.name.toLowerCase().includes('title'))
      ) {
        drawFourPointStarOnBuffer(
          data,
          outW,
          outH,
          (x0 + x1) * 0.5,
          y0 + lh * 0.26,
          Math.max(6, Math.min(lw, lh) * 0.11),
          theme.accent,
          alphaMul
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          blueprint === 'quest_victory'
            ? 'DOMAIN CHALLENGE CLEAR'
            : stylePreset === 'ink_paper_cel'
              ? 'INK SCROLL CHRONICLES'
              : stylePreset === 'persona_rebel_red'
                ? 'REBEL PHANTOM UI'
                : stylePreset === 'cyber_holo_grid'
                  ? 'CYBER HOLO MATRIX 2099'
                  : stylePreset === 'minimal_ark_tech'
                    ? 'RHODES PRTS TERMINAL'
                    : 'CELESTIAL FANTASY UI',
          (x0 + x1) * 0.5,
          y0 + lh * 0.56,
          textScale,
          [255, 244, 206],
          [8, 10, 18],
          alphaMul
        )
        drawUiTextOnBuffer(
          data,
          outW,
          outH,
          'ASTRAL EDITION // FULL SUITE',
          (x0 + x1) * 0.5,
          y0 + lh * 0.78,
          1,
          [196, 218, 248],
          [8, 10, 18],
          alphaMul
        )
      } else if (!hasSeparateTextLabel) {
        // Generic inspector / victory summary panel_box
        const infoLines =
          blueprint === 'quest_victory'
            ? ['STAGE CLEAR // RANK S+', 'CLEAR TIME  01:18  //  EXP +200']
            : ['CONSTELLATION // C6 MAX', 'CRIT DMG +60%', 'ENERGY RECHARGE +30%']
        const maxInfoY = blueprint === 'quest_victory' ? y0 + Math.round(lh * 0.45) : y1
        infoLines.forEach((line, idxLine) => {
          const ly = y0 + Math.round(((idxLine + 1) / (infoLines.length + 1)) * (maxInfoY - y0))
          drawUiTextOnBuffer(
            data,
            outW,
            outH,
            line,
            (x0 + x1) * 0.5,
            ly,
            idxLine === 0 ? textScale : 1,
            idxLine === 0 ? [255, 232, 142] : [224, 232, 248],
            [8, 10, 18],
            alphaMul
          )
        })
      }
    }
  }

  const baseTscn = exportGodotFullScreenUiTscn(
    blueprint,
    stylePreset,
    options?.resourceName ?? 'game_ui_screen'
  )
  const customNodes = orderedBottomToTop
    .map((l) =>
      [
        `[node name="${l.name.replace(/[^a-zA-Z0-9_-]/g, '_')}" type="Control" parent="."]`,
        `offset_left = ${Math.round(l.x)}.0`,
        `offset_top = ${Math.round(l.y)}.0`,
        `offset_right = ${Math.round(l.x + l.w)}.0`,
        `offset_bottom = ${Math.round(l.y + l.h)}.0`,
        `metadata/widget_kind = "${l.kind}"`
      ].join('\n')
    )
    .join('\n\n')

  return {
    width: outW,
    height: outH,
    data,
    layerCount: orderedBottomToTop.length,
    godotFullScreenTscn: customNodes ? `${baseTscn}\n${customNodes}\n` : baseTscn
  }
}

export const FULL_UI_SUITE_BLUEPRINTS: readonly Exclude<UiScreenBlueprintPreset, 'blank_canvas'>[] =
  [
    'combat_hud',
    'title_menu',
    'inventory_paperdoll',
    'skill_tree',
    'shop_gacha',
    'dialogue_vn',
    'quest_victory',
    'settings_form'
  ]

/**
 * Generates a complete 8-Screen PS Artboard JSON payload (`pages` + active `layers`)
 * tailored to a specific UI aesthetic preset (such as `'celestial_star_gold'` Genshin style,
 * `'persona_rebel_red'` P5 style, `'minimal_ark_tech'` Arknights style, `'cyber_holo_grid'`, etc.).
 */
export function buildThemedArtboardSuitePayload(
  stylePreset: UiStylePreset = 'celestial_star_gold',
  gameTitle = 'CELESTIAL CHRONICLES'
): {
  pages: Record<Exclude<UiScreenBlueprintPreset, 'blank_canvas'>, Array<Record<string, unknown>>>
  layers: Array<Record<string, unknown>>
  jsonString: string
} {
  const isGenshin = stylePreset === 'celestial_star_gold'
  const isP5 = stylePreset === 'persona_rebel_red'
  const isArk = stylePreset === 'minimal_ark_tech'
  const isCyber = stylePreset === 'cyber_holo_grid'
  const isInk = stylePreset === 'ink_paper_cel'
  const isRoyal = stylePreset === 'royal_gold_enamel'
  const isArcane = stylePreset === 'arcane_crystal'

  const skin = isGenshin
    ? {
        bgColor: '#1b2236',
        accentColor: '#e2c68a',
        textColor: '#fdf6e2',
        hpColor: '#96da5c',
        borderRadius: 14
      }
    : isP5
      ? {
          bgColor: '#0e0e12',
          accentColor: '#f22030',
          textColor: '#ffffff',
          hpColor: '#ff2a3c',
          borderRadius: 2
        }
      : isArk
        ? {
            bgColor: '#1c2026',
            accentColor: '#ff8418',
            textColor: '#f1f5f9',
            hpColor: '#38bdf8',
            borderRadius: 2
          }
        : isCyber
          ? {
              bgColor: '#061220',
              accentColor: '#18f2ff',
              textColor: '#cffafe',
              hpColor: '#ff2a94',
              borderRadius: 4
            }
          : isInk
            ? {
                bgColor: '#ece2ce',
                accentColor: '#2a2420',
                textColor: '#201a16',
                hpColor: '#cc2a2a',
                borderRadius: 10
              }
            : isRoyal
              ? {
                  bgColor: '#102c6c',
                  accentColor: '#f8cc48',
                  textColor: '#fef9c3',
                  hpColor: '#34d399',
                  borderRadius: 12
                }
              : isArcane
                ? {
                    bgColor: '#24104a',
                    accentColor: '#c45cff',
                    textColor: '#f3e8ff',
                    hpColor: '#56e8ff',
                    borderRadius: 12
                  }
                : {
                    bgColor: '#181411',
                    accentColor: '#b87634',
                    textColor: '#f5e6d3',
                    hpColor: '#f55c24',
                    borderRadius: 8
                  }

  const mk = (
    id: string,
    name: string,
    kind: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra?: Record<string, unknown>
  ): Record<string, unknown> => ({
    id,
    name,
    kind,
    x,
    y,
    w,
    h,
    visible: true,
    locked: false,
    opacity: 100,
    blendMode: 'normal',
    bgColor: skin.bgColor,
    accentColor: skin.accentColor,
    textColor: skin.textColor,
    borderRadius: skin.borderRadius,
    ...extra
  })

  const pages: Record<
    Exclude<UiScreenBlueprintPreset, 'blank_canvas'>,
    Array<Record<string, unknown>>
  > = {
    combat_hud: [
      mk('lyr_key_prompt', 'Interact_Key_Prompt', 'key_prompt', 1120, 560, 320, 56, {
        customText: 'F',
        subText: isGenshin ? '✦ 拾取星辉圣遗物' : isP5 ? '⚡ AMBUSH SHADOW' : 'INTERACT', // cjk-ok
        anchorPreset: 'cr'
      }),
      mk('lyr_skill_bar', 'Elemental_Burst_Skill_Bar', 'skill_bar', 1290, 884, 560, 152, {
        customText: isGenshin ? 'E · 元素战技,Q · 元素爆发,R · 幻影冲刺,SPACE' : 'Q,E,R,SPACE', // cjk-ok
        anchorPreset: 'br'
      }),
      mk('lyr_minimap', 'TopRight_Radar_Minimap', 'minimap_compass', 42, 36, 224, 224, {
        customText: isGenshin ? '✦ 提瓦特星盘 N 024°' : 'N 024°', // cjk-ok
        anchorPreset: 'tl'
      }),
      mk('lyr_boss_bar', 'TopCenter_Boss_HP_Bar', 'boss_bar', 580, 28, 760, 96, {
        customText: isGenshin
          ? '⚡ 雷电祸津御建鸣神命 · Lv.90' // cjk-ok
          : isP5
            ? '🃏 SHADOW PALACE RULER'
            : `🔥 ${gameTitle} · BOSS`,
        valuePct: 82,
        anchorPreset: 'tc'
      }),
      mk('lyr_buff_row', 'Elemental_Resonance_Buffs', 'buff_icons', 640, 902, 360, 52, {
        customText: isGenshin
          ? '🔥火元素共鸣+25%,🛡️玉璋护盾,⚡雷伤加成,❄️超导'
          : '⚔️+25%,🛡️12s,⚡HASTE,🔥BURN', // cjk-ok
        anchorPreset: 'bc'
      }),
      mk('lyr_hp_bar', 'BottomCenter_Player_HP_Bar', 'hp_bar', 640, 968, 520, 48, {
        customText: isGenshin ? '✦ 18,420 / 21,000' : 'HP 1,840 / 2,100',
        valuePct: 88,
        accentColor: skin.hpColor,
        anchorPreset: 'bc'
      }),
      mk('lyr_avatar_2', 'Party_Slot_2_Avatar', 'avatar_medallion', 1680, 460, 168, 168, {
        customText: 'Lv.90',
        anchorPreset: 'cr'
      }),
      mk('lyr_avatar', 'Party_Slot_1_Avatar', 'avatar_medallion', 1680, 260, 168, 168, {
        customText: 'Lv.90',
        anchorPreset: 'cr'
      })
    ],
    title_menu: [
      mk('lyr_title_logo', 'Main_Title_Logo', 'text_label', 410, 150, 1100, 140, {
        customText: isGenshin ? `✦ ${gameTitle} · 星轨幻想 ✦` : `⚔️ ${gameTitle} ⚔️`, // cjk-ok
        subText: isGenshin
          ? 'CELESTIAL ASTRAL FANTASY · PRESS ANY KEY TO ENTER'
          : 'INDIE GAME OFFICIAL BUILD',
        fontSize: 54,
        anchorPreset: 'tc'
      }),
      mk('lyr_btn_start', 'Btn_Enter_World', 'ui_button', 740, 520, 440, 86, {
        customText: isGenshin
          ? '✦ 点击进入星门 (START)'
          : isArk
            ? '▶ 唤醒终端 (PRTS LOGIN)'
            : '▶ START GAME', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_btn_continue', 'Btn_Continue_Save', 'ui_button', 740, 626, 440, 82, {
        customText: isGenshin ? '⏳ 继续旅途 (CONTINUE)' : '↻ CONTINUE', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_btn_settings', 'Btn_Options', 'ui_button', 740, 728, 440, 82, {
        customText: isGenshin ? '⚙️ 派蒙系统设置 (SETTINGS)' : '⚙️ SETTINGS', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_title_plate', 'Title_Backdrop_Frame', 'panel_box', 480, 120, 960, 250, {
        customText: '',
        subText: '',
        opacity: 82,
        anchorPreset: 'tc'
      })
    ],
    inventory_paperdoll: [
      mk('lyr_inv_curr', 'TopRight_Primogem_Bar', 'currency_bar', 1260, 36, 560, 62, {
        customText: isGenshin
          ? '🪙 摩拉 2,480,000,💎 原石 16,800,🌙 树脂 160/160' // cjk-ok
          : isArk
            ? '🪙 龙门币 840K,🔶 合成玉 24,600,⚡ 理智 135/135' // cjk-ok
            : '🪙 84,200,💎 6,400,⚡ 120/120',
        anchorPreset: 'tr'
      }),
      mk('lyr_inv_tabs', 'TopLeft_Bag_Tabs', 'tab_bar', 96, 36, 860, 62, {
        customText: isGenshin
          ? '⚔️ 武器,🏆 圣遗物,🧪 贵重道具,📜 任务文献' // cjk-ok
          : '⚔️ WEAPONS,🛡️ ARMOR,🧪 CONSUMABLES,✨ RELICS',
        anchorPreset: 'tl'
      }),
      mk('lyr_inv_bag', 'Right_Artifact_Grid', 'inventory_grid', 640, 120, 1180, 860, {
        anchorPreset: 'cr'
      }),
      mk('lyr_inv_card', 'Left_Character_Showcase', 'foil_card', 96, 120, 480, 860, {
        customText: isGenshin ? '✦ 5★ 星穹裁决者 · Lv.90' : 'SSR · HERO PAPERDOLL', // cjk-ok
        anchorPreset: 'cl'
      })
    ],
    skill_tree: [
      mk('lyr_tree_tabs', 'Skill_Constellation_Tabs', 'tab_bar', 120, 40, 960, 62, {
        customText: isGenshin
          ? '🌟 命之座 (CONSTELLATION),⚔️ 天赋技能,✨ 元素共鸣' // cjk-ok
          : '🌟 TALENT CONSTELLATION,🔥 ELEMENTAL,🛡️ PASSIVE',
        anchorPreset: 'tl'
      }),
      mk('lyr_tree_curr', 'Skill_Crown_Currency', 'currency_bar', 1280, 40, 520, 62, {
        customText: isGenshin
          ? '👑 智识之冕 ×3,✨ 星辉 ×45,🪙 摩拉 2.4M'
          : '✨ SP: 14,👑 CROWNS: 3', // cjk-ok
        anchorPreset: 'tr'
      }),
      mk('lyr_tree_detail', 'Constellation_Inspector', 'panel_box', 1260, 140, 540, 820, {
        customText: isGenshin ? '🌟 第六层 · 诸世星轨之落' : '🌟 ULTIMATE TALENT NODE', // cjk-ok
        subText: isGenshin
          ? '• 施放元素爆发后，全队暴击伤害提升 60%\n• 元素充能效率提升 30%，持续 12 秒\n• 已激活命之座：6 / 6' // cjk-ok
          : '• Crit Damage +60% for 12s\n• Energy Recharge +30%',
        anchorPreset: 'cr'
      }),
      mk('lyr_node_top', 'Constellation_Node_6', 'item_slot', 580, 160, 176, 176, {
        customText: 'C6 · MAX',
        subText: isGenshin ? '星轨之落' : 'NOVA', // cjk-ok
        anchorPreset: 'tc'
      }),
      mk('lyr_node_mid1', 'Constellation_Node_3', 'item_slot', 360, 440, 150, 150, {
        customText: 'C3 · ON',
        subText: isGenshin ? '天光裁决' : 'IGNITE+', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_node_mid2', 'Constellation_Node_4', 'item_slot', 820, 440, 150, 150, {
        customText: 'C4 · ON',
        subText: isGenshin ? '星誓守望' : 'CRIT DMG', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_node_root', 'Constellation_Node_1', 'item_slot', 595, 720, 150, 150, {
        customText: 'C1 · ON',
        subText: isGenshin ? '初曜之印' : 'CORE', // cjk-ok
        anchorPreset: 'bc'
      })
    ],
    shop_gacha: [
      mk('lyr_shop_curr', 'TopRight_Wish_Currency', 'currency_bar', 1240, 36, 580, 62, {
        customText: isGenshin
          ? '💎 原石 16,800,🌟 纠缠之缘 ×42,✨ 相遇之缘 ×15' // cjk-ok
          : isArk
            ? '🔶 合成玉 24,600,🎫 十连寻访凭证 ×3,💎 源石 88' // cjk-ok
            : '🪙 84,200,💎 6,400,🎟️ 12',
        anchorPreset: 'tr'
      }),
      mk('lyr_shop_tabs', 'Wish_Banner_Tabs', 'tab_bar', 100, 36, 920, 62, {
        customText: isGenshin
          ? '🌟 限定角色活动祈愿,⚔️ 神铸赋形武器祈愿,✨ 奔行世间常驻祈愿,💎 尘辉兑换' // cjk-ok
          : '✨ LIMITED BANNER,⚔️ WEAPON BANNER,🧪 STANDARD WISH,💎 VIP SHOP',
        anchorPreset: 'tl'
      }),
      mk('lyr_gacha_10x', 'Btn_Wish_10X', 'ui_button', 1120, 890, 460, 92, {
        customText: isGenshin
          ? '🌟 祈愿 ×10 (纠缠之缘 ×10)'
          : isArk
            ? '⚡ 寻访十次 (×6,000)'
            : '🌟 SUMMON ×10', // cjk-ok
        anchorPreset: 'br'
      }),
      mk('lyr_gacha_1x', 'Btn_Wish_1X', 'ui_button', 640, 890, 420, 92, {
        customText: isGenshin ? '✨ 祈愿 ×1 (纠缠之缘 ×1)' : '✨ SINGLE WISH ×1', // cjk-ok
        anchorPreset: 'bc'
      }),
      mk('lyr_card_3', 'Featured_4Star_Right', 'foil_card', 1320, 150, 460, 680, {
        customText: isGenshin ? '4★ · 星海占星师 (UP!)' : 'SR · VOID ARCHON', // cjk-ok
        anchorPreset: 'cr'
      }),
      mk('lyr_card_2', 'Featured_5Star_Center', 'foil_card', 730, 130, 500, 710, {
        customText: isGenshin ? '5★ · 苍穹神明 · 概率 UP!' : 'SSR · SOLARIS DRAGONBLADE', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_card_1', 'Featured_4Star_Left', 'foil_card', 180, 150, 460, 680, {
        customText: isGenshin ? '4★ · 凛风剑士 (UP!)' : 'SR · AEGIS OF DAWN', // cjk-ok
        anchorPreset: 'cl'
      })
    ],
    dialogue_vn: [
      mk('lyr_dlg_box', 'Dialogue_Bottom_Box', 'dialogue_box', 140, 690, 1640, 320, {
        customText: isGenshin
          ? '「跨越星海的旅人，当群星回归正确的命轨之时，这座神殿的封印便会为你开启。」' // cjk-ok
          : undefined,
        anchorPreset: 'bc'
      }),
      mk('lyr_choice_1', 'Choice_1_Top', 'ui_button', 1020, 320, 720, 82, {
        customText: isGenshin ? '✦ 「我准备好了，开启星门吧。」' : '✨ Shatter the Solar Core', // cjk-ok
        anchorPreset: 'cr'
      }),
      mk('lyr_choice_2', 'Choice_2_Mid', 'ui_button', 1020, 424, 720, 82, {
        customText: isGenshin
          ? '💬 「关于深渊与神之心，我还有疑问…」'
          : '⏳ Ask about the Chrono Seal', // cjk-ok
        anchorPreset: 'cr'
      }),
      mk('lyr_speaker_bust', 'Speaker_Avatar_Medallion', 'avatar_medallion', 140, 450, 210, 210, {
        customText: isGenshin ? '派蒙 / 向导' : 'SPEAKER', // cjk-ok
        anchorPreset: 'bl'
      })
    ],
    quest_victory: [
      mk('lyr_win_next', 'Btn_Leave_Domain', 'ui_button', 980, 860, 420, 88, {
        customText: isGenshin ? '▶ 退出秘境 (CLAIM & EXIT)' : '▶ CONTINUE EXPEDITION', // cjk-ok
        anchorPreset: 'bc'
      }),
      mk('lyr_win_retry', 'Btn_Retry_Domain', 'ui_button', 520, 860, 400, 88, {
        customText: isGenshin ? '↻ 再次挑战 (挑战消耗 20 树脂)' : '↻ REPLAY STAGE', // cjk-ok
        anchorPreset: 'bc'
      }),
      mk('lyr_loot_4', 'Reward_Slot_4', 'item_slot', 1200, 560, 170, 170, {
        customText: '×45,000',
        subText: isGenshin ? '摩拉' : 'GOLD', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_loot_3', 'Reward_Slot_3', 'item_slot', 990, 560, 170, 170, {
        customText: '×6',
        subText: isGenshin ? '大英雄的经验' : 'EXP TOME', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_loot_2', 'Reward_Slot_2', 'item_slot', 780, 560, 170, 170, {
        customText: '5★ +0',
        subText: isGenshin ? '理之冠·暴伤' : 'CROWN', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_loot_1', 'Reward_Slot_1_SSR', 'item_slot', 570, 560, 170, 170, {
        customText: '5★ +0',
        subText: isGenshin ? '空之杯·雷伤' : 'GOBLET', // cjk-ok
        anchorPreset: 'cc'
      }),
      mk('lyr_win_panel', 'Victory_Summary_Panel', 'panel_box', 420, 240, 1080, 560, {
        customText: isGenshin ? '🏆 秘境挑战成功 · 古树赐福' : '🏆 STAGE CLEAR · RANK S+', // cjk-ok
        subText: isGenshin
          ? '• 通关用时：01:18 (刷新纪录！)\n• 冒险阅历 +200 · 好感度经验 +40\n• 获得双倍圣遗物掉落' // cjk-ok
          : '• Clear Time: 01:18 (New Record!)\n• No Deaths Bonus: +50% EXP',
        anchorPreset: 'cc'
      }),
      mk('lyr_win_banner', 'Victory_Header_Title', 'text_label', 510, 90, 900, 130, {
        customText: isGenshin ? '✨ 挑战达成 · 秘境通关 ✨' : '✨ VICTORY ACHIEVED ✨', // cjk-ok
        subText: isGenshin ? 'DOMAIN CHALLENGE COMPLETED' : 'THE ASHEN CITADEL HAS FALLEN',
        fontSize: 52,
        anchorPreset: 'tc'
      })
    ],
    settings_form: [
      mk('lyr_cfg_tabs', 'Settings_Category_Tabs', 'tab_bar', 360, 96, 1200, 64, {
        customText: isGenshin
          ? '🖥️ 图像帧率,🔊 语音与音量,🎮 按键控制,🌐 语言与账号' // cjk-ok
          : '🔊 AUDIO,🖥️ GRAPHICS,🎮 CONTROLS,🌐 LANGUAGE',
        anchorPreset: 'tc'
      }),
      mk('lyr_cfg_modal', 'Settings_Controls_Panel', 'settings_panel', 360, 180, 1200, 620, {
        anchorPreset: 'cc'
      }),
      mk('lyr_cfg_apply', 'Btn_Apply_Settings', 'ui_button', 740, 840, 440, 92, {
        customText: isGenshin ? '✓ 保存并应用设置 (APPLY)' : '✓ APPLY SETTINGS', // cjk-ok
        anchorPreset: 'bc'
      })
    ]
  }

  const layers = pages.combat_hud
  return {
    pages,
    layers,
    jsonString: JSON.stringify({ stylePreset, pages, layers })
  }
}

// ============================================================================
// 9. Universal 2D Sprite Outer Stroke, Hover Shadow & Sharpened Mipmap Chain
// ============================================================================

export type SpriteStrokeColorPreset = 'gold' | 'white' | 'black' | 'cyan' | 'crimson'

export const SPRITE_STROKE_PRESET_COLORS: Record<
  SpriteStrokeColorPreset,
  [number, number, number, number]
> = {
  gold: [251, 191, 36, 255],
  white: [248, 250, 252, 255],
  black: [15, 23, 42, 255],
  cyan: [56, 189, 248, 255],
  crimson: [244, 63, 94, 255]
}

export interface SpriteStrokeMipChainResult {
  width: number
  height: number
  strokeWidthPx: number
  strokeColor: [number, number, number, number]
  strokedRgba: Uint8ClampedArray
  mip128: { width: number; height: number; rgba: Uint8ClampedArray }
  mip64: { width: number; height: number; rgba: Uint8ClampedArray }
  mip32: { width: number; height: number; rgba: Uint8ClampedArray }
}

function downsampleAndSharpenMip(
  srcRgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  targetSize: number,
  sharpenAmount = 0.35
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const dstW = Math.max(4, Math.floor(targetSize))
  const dstH = Math.max(4, Math.floor(targetSize))
  const box = new Uint8ClampedArray(dstW * dstH * 4)

  const scaleX = srcW / dstW
  const scaleY = srcH / dstH

  // Alpha-weighted area resampling so transparent edges never bleed dark fringes
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * scaleY)
    const sy1 = Math.min(srcH, Math.max(sy0 + 1, Math.ceil((dy + 1) * scaleY)))
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * scaleX)
      const sx1 = Math.min(srcW, Math.max(sx0 + 1, Math.ceil((dx + 1) * scaleX)))

      let sumR = 0
      let sumG = 0
      let sumB = 0
      let sumA = 0
      let count = 0

      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const sIdx = (sy * srcW + sx) * 4
          const a = srcRgba[sIdx + 3]! / 255
          sumR += srcRgba[sIdx]! * a
          sumG += srcRgba[sIdx + 1]! * a
          sumB += srcRgba[sIdx + 2]! * a
          sumA += a
          count++
        }
      }

      const dIdx = (dy * dstW + dx) * 4
      if (sumA > 1e-4 && count > 0) {
        box[dIdx] = clampByte(sumR / sumA)
        box[dIdx + 1] = clampByte(sumG / sumA)
        box[dIdx + 2] = clampByte(sumB / sumA)
        box[dIdx + 3] = clampByte((sumA / count) * 255)
      }
    }
  }

  // Unsharp mask on RGB where alpha > 32 to preserve crisp details at 64x64 / 32x32
  const out = new Uint8ClampedArray(box)
  for (let y = 1; y < dstH - 1; y++) {
    for (let x = 1; x < dstW - 1; x++) {
      const idx = (y * dstW + x) * 4
      if (box[idx + 3]! <= 32) continue
      const nIdx = ((y - 1) * dstW + x) * 4
      const sIdx = ((y + 1) * dstW + x) * 4
      const wIdx = (y * dstW + (x - 1)) * 4
      const eIdx = (y * dstW + (x + 1)) * 4
      for (let c = 0; c < 3; c++) {
        const center = box[idx + c]!
        const blur = (box[nIdx + c]! + box[sIdx + c]! + box[wIdx + c]! + box[eIdx + c]!) * 0.25
        out[idx + c] = clampByte(center + (center - blur) * sharpenAmount)
      }
    }
  }

  return { width: dstW, height: dstH, rgba: out }
}

/**
 * Universal 2D Sprite Outer Stroke, Hover Drop Shadow & Multi-Resolution Mipmap Chain.
 * Generates a smooth distance-field outer stroke (`strokeWidthPx`), soft drop shadow,
 * and alpha-weighted unsharp-masked Mipmap chain (`128x128`, `64x64`, `32x32`).
 */
export function processSpriteStrokeAndMipChain(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    strokeWidthPx?: number
    strokeColorPreset?: SpriteStrokeColorPreset
    strokeColor?: [number, number, number, number]
    shadowOpacity?: number
    autoKey?: boolean
  }
): SpriteStrokeMipChainResult {
  const w = Math.max(8, Math.floor(width))
  const h = Math.max(8, Math.floor(height))
  const strokeWidthPx = clamp(Math.round(options?.strokeWidthPx ?? 3), 1, 10)
  const preset = options?.strokeColorPreset ?? 'gold'
  const strokeColor: [number, number, number, number] =
    options?.strokeColor ?? SPRITE_STROKE_PRESET_COLORS[preset] ?? SPRITE_STROKE_PRESET_COLORS.gold
  const shadowOpacity = clamp(Number(options?.shadowOpacity ?? 0.35), 0, 0.85)
  const autoKey = options?.autoKey !== false

  const working = new Uint8ClampedArray(w * h * 4)
  working.set(rgba.subarray(0, w * h * 4))
  if (autoKey && !hasNativeTransparentPixels(working, w, h)) {
    applyBorderFloodColorKey(working, w, h)
  }

  const strokedRgba = new Uint8ClampedArray(w * h * 4)
  const rSearch = strokeWidthPx + 2
  const shadowOffsetX = Math.max(1, Math.round(strokeWidthPx * 0.5))
  const shadowOffsetY = Math.max(1, Math.round(strokeWidthPx * 0.75))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const srcA = working[idx + 3]! / 255
      if (srcA >= 0.98) {
        strokedRgba[idx] = working[idx]!
        strokedRgba[idx + 1] = working[idx + 1]!
        strokedRgba[idx + 2] = working[idx + 2]!
        strokedRgba[idx + 3] = 255
        continue
      }

      // Compute minimum distance to an opaque foreground pixel within rSearch
      let minDist = Infinity
      for (let dy = -rSearch; dy <= rSearch; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -rSearch; dx <= rSearch; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const nAlpha = working[(ny * w + nx) * 4 + 3]!
          if (nAlpha >= 96) {
            const d = Math.hypot(dx, dy)
            if (d < minDist) minDist = d
          }
        }
      }

      let outR = 0
      let outG = 0
      let outB = 0
      let outA = 0

      // 1. Soft offset drop shadow behind stroke
      const shX = x - shadowOffsetX
      const shY = y - shadowOffsetY
      if (shadowOpacity > 0 && shX >= 0 && shX < w && shY >= 0 && shY < h) {
        const shAlpha = (working[(shY * w + shX) * 4 + 3]! / 255) * shadowOpacity
        if (shAlpha > 0.01) {
          outR = 8
          outG = 12
          outB = 22
          outA = shAlpha
        }
      }

      // 2. Smooth anti-aliased outer stroke
      if (minDist <= strokeWidthPx + 0.65) {
        const strokeCoverage = clamp(strokeWidthPx + 0.65 - minDist, 0, 1) * (strokeColor[3] / 255)
        if (strokeCoverage > 0) {
          const newA = strokeCoverage + outA * (1 - strokeCoverage)
          outR = (strokeColor[0] * strokeCoverage + outR * outA * (1 - strokeCoverage)) / newA
          outG = (strokeColor[1] * strokeCoverage + outG * outA * (1 - strokeCoverage)) / newA
          outB = (strokeColor[2] * strokeCoverage + outB * outA * (1 - strokeCoverage)) / newA
          outA = newA
        }
      }

      // 3. Original sprite foreground over stroke
      if (srcA > 0) {
        const newA = srcA + outA * (1 - srcA)
        outR = (working[idx]! * srcA + outR * outA * (1 - srcA)) / newA
        outG = (working[idx + 1]! * srcA + outG * outA * (1 - srcA)) / newA
        outB = (working[idx + 2]! * srcA + outB * outA * (1 - srcA)) / newA
        outA = newA
      }

      strokedRgba[idx] = clampByte(outR)
      strokedRgba[idx + 1] = clampByte(outG)
      strokedRgba[idx + 2] = clampByte(outB)
      strokedRgba[idx + 3] = clampByte(outA * 255)
    }
  }

  return {
    width: w,
    height: h,
    strokeWidthPx,
    strokeColor,
    strokedRgba,
    mip128: downsampleAndSharpenMip(strokedRgba, w, h, 128, 0.28),
    mip64: downsampleAndSharpenMip(strokedRgba, w, h, 64, 0.36),
    mip32: downsampleAndSharpenMip(strokedRgba, w, h, 32, 0.44)
  }
}

// ============================================================================
// 11. Domain-Specific Procedural Sample Generators (UI / Sprite / VFX)
// ============================================================================

/**
 * Generates a stylized UI illustration or beveled control plate
 * when no upstream image is connected (avoiding dungeon brick/metal grid fallbacks).
 */
export function createProceduralUiSampleRgba(
  width = 64,
  height = 64,
  mode: 'composite_frame' | 'ui_kit' = 'composite_frame'
): { width: number; height: number; data: Uint8ClampedArray } {
  const w = Math.max(8, Math.floor(width))
  const h = Math.max(8, Math.floor(height))
  const data = new Uint8ClampedArray(w * h * 4)

  const cx = w * 0.5
  const cy = mode === 'composite_frame' ? h * 0.38 : h * 0.5
  const maxR = Math.min(w, h) * 0.45

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4

      if (mode === 'ui_kit') {
        // Ornamental beveled royal-blue & gold button plate
        const pad = Math.max(2, Math.round(Math.min(w, h) * 0.08))
        if (x < pad || x >= w - pad || y < pad || y >= h - pad) {
          data[idx] = 0
          data[idx + 1] = 0
          data[idx + 2] = 0
          data[idx + 3] = 0
          continue
        }
        const borderDist = Math.min(x - pad, w - 1 - pad - x, y - pad, h - 1 - pad - y)
        const bevelSize = Math.max(3, Math.round(Math.min(w, h) * 0.1))
        if (borderDist < bevelSize) {
          // Gold metallic rim with top-left highlight
          const isTopLeft = x - pad + (y - pad) < (w + h - pad * 4) * 0.5
          data[idx] = isTopLeft ? 242 : 168
          data[idx + 1] = isTopLeft ? 202 : 128
          data[idx + 2] = isTopLeft ? 98 : 48
          data[idx + 3] = 255
        } else {
          // Deep indigo interior with subtle vertical sheen
          const t = (y - pad) / Math.max(1, h - pad * 2)
          const radial = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (maxR * 1.1))
          data[idx] = clampByte(34 + (1 - t) * 26 + radial * 48)
          data[idx + 1] = clampByte(52 + (1 - t) * 38 + radial * 72)
          data[idx + 2] = clampByte(108 + (1 - t) * 54 + radial * 96)
          data[idx + 3] = 255
        }
        continue
      }

      // composite_frame: Fantasy Arcane Crystal & Starburst Illustration (for Card/Slot ArtViewport)
      const dx = x - cx
      const dy = y - cy
      const dist = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)

      // Starry night / twilight nebula backdrop
      const gradY = y / Math.max(1, h - 1)
      let r = 22 + (1 - gradY) * 28
      let g = 18 + (1 - gradY) * 34
      let b = 52 + (1 - gradY) * 68

      // Radial arcane aura + rays
      const aura = Math.max(0, 1 - dist / (maxR * 1.15))
      const ray = 0.5 + 0.5 * Math.cos(angle * 6)
      r += aura * aura * (85 + ray * 55)
      g += aura * (115 + ray * 65)
      b += aura * (165 + ray * 45)

      // Central diamond crystal silhouette (sub-pixel SDF anti-aliased)
      const diamondDist = Math.abs(dx) * 1.35 + Math.abs(dy) * 0.92
      const crystalRadius = maxR * 0.52
      const crystalAA = clamp((crystalRadius + 0.85 - diamondDist) / 1.5, 0, 1)
      if (crystalAA > 0) {
        // Smooth facet normal blending across horizontal & vertical crystal ridges
        const fx = 0.5 - 0.5 * Math.tanh(dx * 0.42)
        const fy = 0.5 - 0.5 * Math.tanh(dy * 0.42)
        const facet = 0.78 + fx * 0.17 + fy * 0.3
        const ridgeSpec =
          Math.exp(-Math.abs(dx) * 0.75) * 0.32 + Math.exp(-Math.abs(dy) * 0.85) * 0.22
        const coreGlow = Math.max(0, 1 - diamondDist / Math.max(1, crystalRadius))
        const cR = clampByte((75 + coreGlow * 165) * facet + ridgeSpec * 120)
        const cG = clampByte((195 + coreGlow * 60) * facet + ridgeSpec * 90)
        const cB = clampByte((245 + coreGlow * 10) * facet + ridgeSpec * 60)
        r = r * (1 - crystalAA) + cR * crystalAA
        g = g * (1 - crystalAA) + cG * crystalAA
        b = b * (1 - crystalAA) + cB * crystalAA
      }

      data[idx] = clampByte(r)
      data[idx + 1] = clampByte(g)
      data[idx + 2] = clampByte(b)
      data[idx + 3] = 255
    }
  }

  return { width: w, height: h, data }
}

/**
 * Generates a transparent-background (`alpha = 0` outside silhouette) fantasy relic/potion sprite
 * or grounded chest/crystal prop for `game.spriteProp` when no upstream image is connected.
 */
export function createProceduralSpriteSampleRgba(
  width = 64,
  height = 64,
  mode: 'sprite_stroke_mip' | 'scene_prop' = 'sprite_stroke_mip'
): { width: number; height: number; data: Uint8ClampedArray } {
  const w = Math.max(8, Math.floor(width))
  const h = Math.max(8, Math.floor(height))
  const data = new Uint8ClampedArray(w * h * 4)

  const cx = w * 0.5
  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const dx = (x - cx) / (w * 0.5)
      const idx = (y * w + x) * 4

      if (mode === 'scene_prop') {
        // Grounded arcane obelisk / treasure pedestal sitting at ny in [0.18, 0.84]
        const inPlinth = ny >= 0.72 && ny <= 0.84 && Math.abs(dx) <= 0.42
        const inPillar = ny >= 0.26 && ny < 0.72 && Math.abs(dx) <= 0.24 + (ny - 0.26) * 0.18
        const inCrown = ny >= 0.16 && ny < 0.26 && Math.abs(dx) <= Math.max(0.02, (ny - 0.16) * 2.4)

        if (!inPlinth && !inPillar && !inCrown) continue

        const shade = dx < 0 ? 1.12 : 0.82
        if (inPlinth) {
          data[idx] = clampByte(112 * shade)
          data[idx + 1] = clampByte(118 * shade)
          data[idx + 2] = clampByte(138 * shade)
          data[idx + 3] = 255
        } else {
          // Glowing cyan rune core inside stone obelisk
          const isRune = Math.abs(dx) < 0.08 && ny > 0.34 && ny < 0.64
          if (isRune) {
            data[idx] = 86
            data[idx + 1] = 238
            data[idx + 2] = 255
            data[idx + 3] = 255
          } else {
            data[idx] = clampByte(88 * shade)
            data[idx + 1] = clampByte(96 * shade)
            data[idx + 2] = clampByte(124 * shade)
            data[idx + 3] = 255
          }
        }
        continue
      }

      // sprite_stroke_mip: Transparent-background glowing potion / relic icon
      const bodyCy = 0.58
      const bodyR = 0.28
      const distBody = Math.hypot(nx - 0.5, ny - bodyCy)
      const inNeck = ny >= 0.22 && ny <= 0.36 && Math.abs(nx - 0.5) <= 0.09
      const inCork = ny >= 0.15 && ny < 0.22 && Math.abs(nx - 0.5) <= 0.07
      const inRim = ny >= 0.21 && ny <= 0.25 && Math.abs(nx - 0.5) <= 0.12

      if (distBody > bodyR && !inNeck && !inCork && !inRim) continue

      if (inCork) {
        data[idx] = 196
        data[idx + 1] = 138
        data[idx + 2] = 74
        data[idx + 3] = 255
      } else if (inRim || inNeck) {
        data[idx] = 185
        data[idx + 1] = 225
        data[idx + 2] = 250
        data[idx + 3] = 255
      } else {
        // Potion flask bulb with glowing crimson/gold liquid and specular highlight
        const isSpec = nx < 0.44 && ny < 0.52 && Math.hypot(nx - 0.4, ny - 0.48) < 0.08
        const liquidFill = ny >= 0.48
        if (isSpec) {
          data[idx] = 255
          data[idx + 1] = 250
          data[idx + 2] = 255
          data[idx + 3] = 255
        } else if (liquidFill) {
          const glow = Math.max(0, 1 - distBody / bodyR)
          data[idx] = clampByte(215 + glow * 40)
          data[idx + 1] = clampByte(52 + glow * 95)
          data[idx + 2] = clampByte(88 + glow * 45)
          data[idx + 3] = 255
        } else {
          data[idx] = 152
          data[idx + 1] = 204
          data[idx + 2] = 238
          data[idx + 3] = 255
        }
      }
    }
  }

  return { width: w, height: h, data }
}

/**
 * Generates a black-background (`#000000`) procedural 2D VFX seed texture for `game.vfxAlpha`
 * across 6 classic indie game VFX archetypes (`slash_arc`, `fire_explosion`, `arcane_vortex`,
 * `lightning_burst`, `heal_aura`, `poison_nova`).
 */
export function createProceduralVfxSampleRgba(
  width = 64,
  height = 64,
  archetype: VfxArchetypePreset = 'slash_arc'
): { width: number; height: number; data: Uint8ClampedArray } {
  const w = Math.max(8, Math.floor(width))
  const h = Math.max(8, Math.floor(height))
  const data = new Uint8ClampedArray(w * h * 4)

  const cx = w * 0.5
  const cy = h * 0.5
  const maxR = Math.min(w, h) * 0.45

  for (let y = 0; y < h; y++) {
    const ny = y / Math.max(1, h - 1)
    for (let x = 0; x < w; x++) {
      const nx = x / Math.max(1, w - 1)
      const idx = (y * w + x) * 4
      const dx = x - cx
      const dy = y - cy
      const dist = Math.hypot(dx, dy)
      const normDist = dist / Math.max(1, maxR)
      const angle = Math.atan2(dy, dx)

      let energy = 0
      let defaultRamp: Exclude<VfxElementalPalette, 'original'> = 'solar_fire'

      if (archetype === 'fire_explosion') {
        defaultRamp = 'solar_fire'
        const fbm = vfxFbmNoise2D(nx * 1.4, ny * 1.4, 307)
        const billow = Math.max(0, 1 - normDist * (0.72 + 0.55 * fbm))
        const shockRing = Math.max(0, 1 - Math.abs(normDist - 0.72) / 0.14) * 0.65
        energy = clamp(Math.pow(billow, 1.15) * 1.25 + shockRing * fbm, 0, 1)
      } else if (archetype === 'arcane_vortex') {
        defaultRamp = 'arcane_cyan'
        const spiral = Math.sin(angle * 4 - normDist * 9.5) * 0.5 + 0.5
        const outerRing = Math.max(0, 1 - Math.abs(normDist - 0.76) / 0.11)
        const innerRing = Math.max(0, 1 - Math.abs(normDist - 0.42) / 0.09)
        const radial = Math.max(0, 1 - normDist)
        energy = clamp(
          outerRing * 0.92 + innerRing * 0.78 + Math.pow(radial, 1.3) * spiral * 0.95,
          0,
          1
        )
      } else if (archetype === 'lightning_burst') {
        defaultRamp = 'arcane_cyan'
        const bolt1 = Math.max(
          0,
          1 -
            Math.abs(
              dy + dx * 0.55 + (vfxFbmNoise2D(nx * 2.2, ny * 2.2, 619) - 0.5) * maxR * 0.55
            ) /
              (maxR * 0.16)
        )
        const bolt2 = Math.max(
          0,
          1 -
            Math.abs(
              dy - dx * 0.75 + (vfxFbmNoise2D(nx * 2.5, ny * 2.5, 421) - 0.5) * maxR * 0.48
            ) /
              (maxR * 0.13)
        )
        const radialMask = Math.max(0, 1 - Math.pow(normDist, 1.8))
        energy = clamp(
          (Math.pow(bolt1, 1.6) + Math.pow(bolt2, 1.8) * 0.85) * radialMask * 1.2,
          0,
          1
        )
      } else if (archetype === 'heal_aura') {
        defaultRamp = 'holy_gold'
        const crossH =
          Math.max(0, 1 - Math.abs(dx) / (maxR * 0.18)) *
          Math.max(0, 1 - Math.abs(dy) / (maxR * 0.58))
        const crossV =
          Math.max(0, 1 - Math.abs(dy) / (maxR * 0.18)) *
          Math.max(0, 1 - Math.abs(dx) / (maxR * 0.58))
        const halo = Math.max(0, 1 - Math.abs(normDist - 0.68) / 0.16)
        const softCore = Math.pow(Math.max(0, 1 - normDist), 1.6) * 0.65
        energy = clamp(Math.max(crossH, crossV) * 1.1 + halo * 0.75 + softCore, 0, 1)
      } else if (archetype === 'poison_nova') {
        defaultRamp = 'fel_emerald'
        const fbm = vfxFbmNoise2D(nx * 1.8, ny * 1.8, 991)
        const sporeRing = Math.max(0, 1 - Math.abs(normDist - 0.58) / 0.24) * (0.45 + 0.75 * fbm)
        const toxicCore = Math.pow(Math.max(0, 1 - normDist * 1.15), 1.4)
        energy = clamp(sporeRing * 1.15 + toxicCore * 0.85, 0, 1)
      } else {
        // Default: 'slash_arc' — Crescent blade slash + central impact star
        defaultRamp = 'solar_fire'
        const radialFalloff = Math.max(0, 1 - normDist)
        const slashArc =
          Math.max(0, 1 - Math.abs(normDist - 0.56) / 0.22) * Math.max(0, Math.cos(angle + 0.65))
        const burstRays = Math.pow(radialFalloff, 1.5) * (0.55 + 0.45 * Math.cos(angle * 8))
        energy = clamp(slashArc * 1.15 + burstRays * 0.95, 0, 1)
      }

      // Soft outer vignette so raw seed fades to pure #000000 at borders
      const borderFade = clamp((1 - normDist) / 0.18, 0, 1)
      energy *= borderFade

      const [cr, cg, cb] = remapVfxThermalColor(energy, defaultRamp)
      data[idx] = clampByte(cr * energy)
      data[idx + 1] = clampByte(cg * energy)
      data[idx + 2] = clampByte(cb * energy)
      data[idx + 3] = 255
    }
  }

  return { width: w, height: h, data }
}
