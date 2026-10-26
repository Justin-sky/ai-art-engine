/**
 * Phase 6 Product-Grade Game Art Bible Lock, Deterministic Unity .meta GUID Preservation,
 * and Incremental Engine Sync Pure Functions.
 */

import type { GameBundleMappedFile, GameBundleManifest } from './gameBundleManifest'

export type GameCameraProjectionLock =
  'free' | 'side_scroller' | 'top_down_34' | 'isometric' | 'first_person'

export type GameArtDirectionPreset =
  'free' | 'pixel_16bit' | 'cel_anime' | 'hand_drawn_ink' | 'stylized_pbr' | 'dark_gothic'

export interface GameArtBibleConfig {
  cameraProjection: GameCameraProjectionLock
  artDirection: GameArtDirectionPreset
  masterPaletteHex?: string[]
  pixelsPerUnit?: number
}

const CAMERA_PROJECTION_CLAUSES: Record<GameCameraProjectionLock, string> = {
  free: '',
  side_scroller:
    'strictly 2D side-scrolling orthographic profile view, flat horizontal ground plane, zero perspective tilt',
  top_down_34:
    'strictly 3/4 top-down RPG camera angle (45-degree overhead tilt), consistent ground shadow plane',
  isometric:
    'strictly 2:1 dimetric isometric projection (30-degree axes), crisp geometric grid alignment, zero perspective foreshortening',
  first_person:
    'strictly first-person eye-level perspective, centered composition for dungeon crawler / FPS HUD'
}

const ART_DIRECTION_CLAUSES: Record<GameArtDirectionPreset, string> = {
  free: '',
  pixel_16bit:
    '16-bit SNES/GBA era pixel art aesthetic, crisp pixel clusters, limited color ramps, no blurry anti-aliasing',
  cel_anime:
    'high-contrast Japanese cel-shaded anime game art, clean bold ink lineart, flat cel shadow blocks with vibrant rim light',
  hand_drawn_ink:
    'stylized hand-drawn indie game illustration (Hollow Knight / Hades inspired), expressive brush linework and rich painted lighting',
  stylized_pbr:
    'stylized 3D hand-painted PBR game asset (Overwatch / Genshin / Sea of Thieves aesthetic), clean silhouette and readable material roughness',
  dark_gothic:
    'dark gothic fantasy grimdark game art (Darkest Dungeon / Blasphemous inspired), heavy dramatic chiaroscuro shadows and weathered metallic textures'
}

/**
 * Compiles a deterministic prompt lock clause from the project's Game Art Bible settings.
 */
export function compileGameArtBiblePromptClause(bible: Partial<GameArtBibleConfig>): string {
  const parts: string[] = []
  const cam = bible.cameraProjection ?? 'free'
  const art = bible.artDirection ?? 'free'

  if (CAMERA_PROJECTION_CLAUSES[cam]) {
    parts.push(`[Camera Lock: ${CAMERA_PROJECTION_CLAUSES[cam]}]`)
  }
  if (ART_DIRECTION_CLAUSES[art]) {
    parts.push(`[Art Style Lock: ${ART_DIRECTION_CLAUSES[art]}]`)
  }
  if (Array.isArray(bible.masterPaletteHex) && bible.masterPaletteHex.length > 0) {
    const cleanHex = bible.masterPaletteHex
      .map((h) => h.trim())
      .filter((h) => /^#?[0-9a-fA-F]{6}$/.test(h))
      .slice(0, 12)
      .map((h) => (h.startsWith('#') ? h.toLowerCase() : `#${h.toLowerCase()}`))
    if (cleanHex.length > 0) {
      parts.push(`[Master Color Palette: ${cleanHex.join(', ')}]`)
    }
  }
  return parts.join(' ')
}

/**
 * Derives a deterministic 32-character lowercase hexadecimal Unity GUID from a stable string key.
 * Uses 4 rounds of 32-bit FNV-1a / Murmur-style mixing so the same asset always gets the same GUID.
 */
export function deriveDeterministicUnityGuid(stableKey: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  const hexParts: string[] = []

  for (let s = 0; s < 4; s++) {
    let h = seeds[s]! >>> 0
    for (let i = 0; i < stableKey.length; i++) {
      h ^= stableKey.charCodeAt(i) + s * 31
      h = Math.imul(h, 0x01000193) >>> 0
      h = (h ^ (h >>> 13)) >>> 0
    }
    hexParts.push((h >>> 0).toString(16).padStart(8, '0'))
  }
  return hexParts.join('').toLowerCase()
}

/**
 * Extracts an existing 32-hex GUID from a Unity `.meta` file on disk so re-exporting never breaks Unity prefab references.
 */
export function extractGuidFromUnityMeta(existingMetaText?: string | null): string | null {
  if (!existingMetaText) return null
  const match = /\bguid:\s*([0-9a-fA-F]{32})\b/.exec(existingMetaText)
  return match ? match[1]!.toLowerCase() : null
}

export interface UnityMetaSpriteBorders {
  left: number
  bottom: number
  right: number
  top: number
}

/**
 * Generates a Unity `.meta` file (`fileFormatVersion: 2`) for an exported bundle asset,
 * preserving the existing GUID if the `.meta` file already exists in the Unity project.
 */
export function generateUnityMetaFile(
  entry: GameBundleMappedFile,
  options?: {
    existingMetaText?: string | null
    spriteBorders?: UnityMetaSpriteBorders
    pixelsPerUnit?: number
  }
): { guid: string; metaText: string } {
  const preservedGuid = extractGuidFromUnityMeta(options?.existingMetaText)
  const guid =
    preservedGuid ?? deriveDeterministicUnityGuid(`${entry.id}:${entry.bundleRelativePath}`)
  const ppu = Math.max(1, Math.round(options?.pixelsPerUnit ?? 100))
  const lowerPath = entry.bundleRelativePath.toLowerCase()

  if (
    entry.category === 'sprites' ||
    entry.category === 'ui' ||
    entry.category === 'vfx' ||
    entry.category === 'tilesets' ||
    entry.category === 'pbr_maps'
  ) {
    const isNormal = lowerPath.includes('_normal.')
    const textureType = isNormal ? 1 : 8 // 1 = NormalMap, 8 = Sprite (2D and UI)
    const border = options?.spriteBorders ?? { left: 0, bottom: 0, right: 0, top: 0 }

    const metaText = `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 12
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: ${isNormal ? 0 : 1}
    linearTexture: ${isNormal ? 1 : 0}
    fadeOut: 0
    borderMipMap: 0
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
  isReadable: 0
  spriteMode: 1
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: ${ppu}
  spriteBorder: {x: ${border.left}, y: ${border.bottom}, z: ${border.right}, w: ${border.top}}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: ${isNormal ? 0 : 1}
  textureType: ${textureType}
  textureShape: 1
  singleChannelComponent: 0
  maxTextureSize: 2048
`
    return { guid, metaText }
  }

  if (
    entry.category === 'audio_bgm' ||
    entry.category === 'audio_sfx' ||
    entry.category === 'audio_voice'
  ) {
    const isBgm = entry.category === 'audio_bgm'
    // loadType: 0 = DecompressOnLoad (zero latency for SFX), 2 = Streaming (for BGM)
    const loadType = isBgm ? 2 : 0
    const metaText = `fileFormatVersion: 2
guid: ${guid}
AudioImporter:
  externalObjects: {}
  serializedVersion: 6
  defaultSettings:
    loadType: ${loadType}
    sampleRateSetting: 0
    sampleRateOverride: 44100
    compressionFormat: 1
    quality: 0.75
    conversionMode: 0
    preloadAudioData: ${isBgm ? 0 : 1}
  forceToMono: 0
  normalize: 1
  loadInBackground: ${isBgm ? 1 : 0}
  ambisonic: 0
`
    return { guid, metaText }
  }

  return {
    guid,
    metaText: `fileFormatVersion: 2
guid: ${guid}
DefaultImporter:
  externalObjects: {}
  userData: 
  assetBundleName: 
  assetBundleVariant: 
`
  }
}

export interface IncrementalSyncDiff {
  added: GameBundleMappedFile[]
  modified: GameBundleMappedFile[]
  unchanged: GameBundleMappedFile[]
  nextFingerprints: Record<string, string>
}

/**
 * Plans an incremental sync diff by comparing current asset fingerprints (`size:mtime`) against previously synced fingerprints.
 */
export function planIncrementalBundleSync(
  manifest: GameBundleManifest,
  currentFingerprints: Record<string, string>,
  previousFingerprints: Record<string, string> = {}
): IncrementalSyncDiff {
  const added: GameBundleMappedFile[] = []
  const modified: GameBundleMappedFile[] = []
  const unchanged: GameBundleMappedFile[] = []
  const nextFingerprints: Record<string, string> = {}

  for (const entry of manifest.assets) {
    const key = entry.bundleRelativePath
    const currFp = currentFingerprints[key] ?? `${entry.id}:unknown`
    nextFingerprints[key] = currFp
    const prevFp = previousFingerprints[key]

    if (!prevFp) {
      added.push(entry)
    } else if (prevFp !== currFp) {
      modified.push(entry)
    } else {
      unchanged.push(entry)
    }
  }

  return {
    added,
    modified,
    unchanged,
    nextFingerprints
  }
}
