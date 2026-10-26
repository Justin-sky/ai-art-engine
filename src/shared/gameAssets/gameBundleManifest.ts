/**
 * 全品类独立游戏资产工程包（Game Engine Bundle）分类与清单纯函数层。
 *
 * 支持将项目中的 2D 精灵、序列帧/特效图集、无缝瓦片、UI 九宫格、PBR 贴图、3D 模型（GLB/FBX/OBJ）、
 * Spine 骨骼包与 BGM/SFX/语音资产按目标引擎（Godot / Unity / Cocos / Web / Generic）组织为标准化目录结构，
 * 并生成 `game-asset-manifest.json`。
 */

export type GameBundleTargetEngine = 'godot' | 'unity' | 'cocos' | 'web' | 'generic'

export type GameBundleCategory =
  | 'sprites'
  | 'vfx'
  | 'tilesets'
  | 'ui'
  | 'pbr_maps'
  | 'models3d'
  | 'spine'
  | 'audio_bgm'
  | 'audio_sfx'
  | 'audio_voice'
  | 'data'

export interface GameBundleInputItem {
  id: string
  name: string
  sourcePath: string
  type?: string
  tags?: string[]
  meta?: Record<string, unknown>
}

export interface GameBundleMappedFile {
  id: string
  name: string
  category: GameBundleCategory
  sourcePath: string
  /** 相对于导出工程包根目录的路径（使用正斜杠 `/`） */
  bundleRelativePath: string
  extension: string
  meta?: Record<string, unknown>
}

export interface GameBundleManifest {
  schemaVersion: 1
  bundleName: string
  targetEngine: GameBundleTargetEngine
  exportedAt: string
  totalAssets: number
  countsByCategory: Record<GameBundleCategory, number>
  engineConventions: {
    rootFolder: string
    coordinateSystem: string
    normalMapFormat: 'opengl' | 'directx'
    importNotes: string[]
  }
  assets: GameBundleMappedFile[]
}

const CATEGORY_SUBDIRS: Record<GameBundleTargetEngine, Record<GameBundleCategory, string>> = {
  godot: {
    sprites: 'assets/sprites',
    vfx: 'assets/vfx',
    tilesets: 'assets/tilesets',
    ui: 'assets/ui',
    pbr_maps: 'assets/materials/textures',
    models3d: 'assets/models3d',
    spine: 'assets/spine',
    audio_bgm: 'assets/audio/bgm',
    audio_sfx: 'assets/audio/sfx',
    audio_voice: 'assets/audio/voice',
    data: 'assets/data'
  },
  unity: {
    sprites: 'Assets/GameArt/Sprites',
    vfx: 'Assets/GameArt/VFX',
    tilesets: 'Assets/GameArt/Tilemaps',
    ui: 'Assets/GameArt/UI',
    pbr_maps: 'Assets/GameArt/Materials/Textures',
    models3d: 'Assets/GameArt/Models',
    spine: 'Assets/GameArt/Spine',
    audio_bgm: 'Assets/GameArt/Audio/BGM',
    audio_sfx: 'Assets/GameArt/Audio/SFX',
    audio_voice: 'Assets/GameArt/Audio/Voice',
    data: 'Assets/GameArt/Data'
  },
  cocos: {
    sprites: 'assets/resources/sprites',
    vfx: 'assets/resources/vfx',
    tilesets: 'assets/resources/tilesets',
    ui: 'assets/resources/ui',
    pbr_maps: 'assets/resources/textures/pbr',
    models3d: 'assets/resources/models',
    spine: 'assets/resources/spine',
    audio_bgm: 'assets/resources/audio/bgm',
    audio_sfx: 'assets/resources/audio/sfx',
    audio_voice: 'assets/resources/audio/voice',
    data: 'assets/resources/data'
  },
  web: {
    sprites: 'public/assets/sprites',
    vfx: 'public/assets/vfx',
    tilesets: 'public/assets/tilesets',
    ui: 'public/assets/ui',
    pbr_maps: 'public/assets/pbr',
    models3d: 'public/assets/models',
    spine: 'public/assets/spine',
    audio_bgm: 'public/assets/audio/bgm',
    audio_sfx: 'public/assets/audio/sfx',
    audio_voice: 'public/assets/audio/voice',
    data: 'public/assets/data'
  },
  generic: {
    sprites: 'sprites',
    vfx: 'vfx',
    tilesets: 'tilesets',
    ui: 'ui',
    pbr_maps: 'pbr_maps',
    models3d: 'models3d',
    spine: 'spine',
    audio_bgm: 'audio/bgm',
    audio_sfx: 'audio/sfx',
    audio_voice: 'audio/voice',
    data: 'data'
  }
}

function sanitizeFileStem(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\.[^/.\\]+$/, '')
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'asset'
}

function extractExt(filePath: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filePath.trim())
  return m ? `.${m[1]!.toLowerCase()}` : ''
}

/**
 * 根据文件名、扩展名、标签与元数据自动推断游戏资产所属分类。
 */
export function classifyGameBundleItem(item: GameBundleInputItem): GameBundleCategory {
  const ext = extractExt(item.sourcePath)
  const hay =
    `${item.name} ${item.type ?? ''} ${(item.tags ?? []).join(' ')} ${item.sourcePath}`.toLowerCase()

  if (ext === '.glb' || ext === '.gltf' || ext === '.fbx' || ext === '.obj') {
    return 'models3d'
  }
  if (hay.includes('spine') || ext === '.skel' || ext === '.atlas') {
    return 'spine'
  }
  if (
    ext === '.mp3' ||
    ext === '.wav' ||
    ext === '.ogg' ||
    ext === '.flac' ||
    ext === '.m4a' ||
    item.type === 'audio'
  ) {
    if (
      hay.includes('bgm') ||
      hay.includes('music') ||
      hay.includes('loop') ||
      hay.includes('配乐') // cjk-ok
    ) {
      return 'audio_bgm'
    }
    if (
      hay.includes('voice') ||
      hay.includes('tts') ||
      hay.includes('vocal') ||
      hay.includes('配音') || // cjk-ok
      hay.includes('台词') // cjk-ok
    ) {
      return 'audio_voice'
    }
    return 'audio_sfx'
  }
  if (ext === '.json') {
    return 'data'
  }
  if (
    hay.includes('_normal') ||
    hay.includes('_roughness') ||
    hay.includes('_metallic') ||
    hay.includes('_height') ||
    hay.includes('_ao') ||
    hay.includes('_orm') ||
    hay.includes('pbr')
  ) {
    return 'pbr_maps'
  }
  if (
    hay.includes('tile') ||
    hay.includes('parallax') ||
    hay.includes('瓦片') || // cjk-ok
    hay.includes('地表') // cjk-ok
  ) {
    return 'tilesets'
  }
  if (
    hay.includes('9slice') ||
    hay.includes('nineslice') ||
    hay.includes('ui_') ||
    hay.includes('icon') ||
    hay.includes('card') ||
    hay.includes('button') ||
    hay.includes('panel') ||
    hay.includes('边框') || // cjk-ok
    hay.includes('图标') // cjk-ok
  ) {
    return 'ui'
  }
  if (
    hay.includes('vfx') ||
    hay.includes('flipbook') ||
    hay.includes('特效') || // cjk-ok
    hay.includes('粒子') // cjk-ok
  ) {
    return 'vfx'
  }
  return 'sprites'
}

/**
 * 规划全品类独立游戏工程包导出结构与 Manifest。
 */
export function buildGameBundleManifest(options: {
  bundleName?: string
  targetEngine?: GameBundleTargetEngine
  items: GameBundleInputItem[]
  exportedAt?: string
}): GameBundleManifest {
  const bundleName = (options.bundleName || 'indie-game-bundle').trim() || 'indie-game-bundle'
  const targetEngine: GameBundleTargetEngine =
    options.targetEngine === 'godot' ||
    options.targetEngine === 'unity' ||
    options.targetEngine === 'cocos' ||
    options.targetEngine === 'web'
      ? options.targetEngine
      : 'generic'
  const subdirs = CATEGORY_SUBDIRS[targetEngine]

  const countsByCategory: Record<GameBundleCategory, number> = {
    sprites: 0,
    vfx: 0,
    tilesets: 0,
    ui: 0,
    pbr_maps: 0,
    models3d: 0,
    spine: 0,
    audio_bgm: 0,
    audio_sfx: 0,
    audio_voice: 0,
    data: 0
  }

  const usedRelativePaths = new Set<string>()
  const assets: GameBundleMappedFile[] = options.items.map((item, idx) => {
    const category = classifyGameBundleItem(item)
    countsByCategory[category]++
    const ext = extractExt(item.sourcePath) || '.png'
    const baseStem = sanitizeFileStem(item.name || `asset_${idx + 1}`)
    const folder = subdirs[category]
    let relPath = `${folder}/${baseStem}${ext}`
    let dup = 2
    while (usedRelativePaths.has(relPath.toLowerCase())) {
      relPath = `${folder}/${baseStem}_${dup}${ext}`
      dup++
    }
    usedRelativePaths.add(relPath.toLowerCase())

    return {
      id: item.id || `item_${idx + 1}`,
      name: item.name || baseStem,
      category,
      sourcePath: item.sourcePath,
      bundleRelativePath: relPath,
      extension: ext,
      meta: item.meta
    }
  })

  const engineConventions = {
    godot: {
      rootFolder: 'assets',
      coordinateSystem: '2D: +X Right, +Y Down | 3D: Right-Handed +Y Up (-Z Forward)',
      normalMapFormat: 'opengl' as const,
      importNotes: [
        'Copy `assets/` into your Godot 4 project root (`res://assets/`).',
        'Tilemaps use `autotile-manifest.json` terrain peering bits.',
        'UI panels use `StyleBoxTexture` margins from `nine-slice-manifest.json`.'
      ]
    },
    unity: {
      rootFolder: 'Assets/GameArt',
      coordinateSystem: '2D/3D: Left-Handed +Y Up (+Z Forward)',
      normalMapFormat: 'opengl' as const,
      importNotes: [
        'Copy `Assets/GameArt/` into your Unity project `Assets/` directory.',
        'Set Sprites Texture Type to `Sprite (2D and UI)` and apply `borderLBRT` for 9-slice UI.',
        'Set Normal maps Texture Type to `Normal map`.'
      ]
    },
    cocos: {
      rootFolder: 'assets/resources',
      coordinateSystem: '2D/3D: Right-Handed +Y Up',
      normalMapFormat: 'opengl' as const,
      importNotes: [
        'Copy `assets/resources/` into your Cocos Creator 3.x project.',
        'Sprites and Spine skeletons can be loaded dynamically via `resources.load`.'
      ]
    },
    web: {
      rootFolder: 'public/assets',
      coordinateSystem: 'PixiJS / Phaser / Three.js WebGL Standard',
      normalMapFormat: 'opengl' as const,
      importNotes: [
        'Serve `public/assets/` statically and load `game-asset-manifest.json` at boot.',
        'Compatible with Phaser 3, PixiJS v8, and Three.js `GLTFLoader`.'
      ]
    },
    generic: {
      rootFolder: '.',
      coordinateSystem: 'Standard RGBA / glTF 2.0 Right-Handed +Y Up',
      normalMapFormat: 'opengl' as const,
      importNotes: [
        'All assets are organized by functional category with metadata in `game-asset-manifest.json`.'
      ]
    }
  }[targetEngine]

  return {
    schemaVersion: 1,
    bundleName,
    targetEngine,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    totalAssets: assets.length,
    countsByCategory,
    engineConventions,
    assets
  }
}
