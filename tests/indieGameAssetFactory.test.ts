import { describe, expect, it } from 'vitest'
import {
  analyzeSeamlessTile,
  applySeamlessTileBlend,
  BLOB_47_BITMASKS,
  buildAutoTileAtlasManifest,
  buildGameBundleManifest,
  buildGameDataTableBundle,
  buildNineSliceManifest,
  buildSeamlessLoopBgmFfmpegArgs,
  buildSfxVariantFfmpegArgs,
  buildSpritePhysicsManifest,
  classifyGameBundleItem,
  deriveCombatBoxesFromAlpha,
  derivePbrMapsFromRgba,
  detectNineSliceBorders,
  extractSpriteCollisionHull,
  generateEngineImporterScript,
  planSfxVariantMatrix
} from '../src/shared/gameAssets'

describe('Phase 1: 2D Seamless Tilemap & UI 9-Slice Operators', () => {
  it('applySeamlessTileBlend eliminates horizontal and vertical border seams while keeping center intact', () => {
    const width = 32
    const height = 32
    const raw = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        raw[idx] = Math.round((x / (width - 1)) * 240)
        raw[idx + 1] = Math.round((y / (height - 1)) * 220)
        raw[idx + 2] = 100
        raw[idx + 3] = 255
      }
    }

    const before = analyzeSeamlessTile(raw, width, height)
    expect(before.isSeamless).toBe(false)
    expect(before.horizontalEdgeDelta).toBeGreaterThan(50)
    expect(before.verticalEdgeDelta).toBeGreaterThan(50)

    const blended = applySeamlessTileBlend(raw, width, height, {
      blendRatio: 0.2,
      wrapX: true,
      wrapY: true
    })
    const after = analyzeSeamlessTile(blended, width, height)
    expect(after.horizontalEdgeDelta).toBe(0)
    expect(after.verticalEdgeDelta).toBe(0)
    expect(after.cornerDelta).toBe(0)
    expect(after.isSeamless).toBe(true)
    expect(after.score).toBe(100)

    // Center pixel should remain untouched
    const centerIdx = (16 * width + 16) * 4
    expect(blended[centerIdx]).toBe(raw[centerIdx])
    expect(blended[centerIdx + 1]).toBe(raw[centerIdx + 1])
  })

  it('buildAutoTileAtlasManifest generates valid bitmask manifests for grid3x3, wang16, and blob47', () => {
    const grid3x3 = buildAutoTileAtlasManifest({
      terrainName: 'forest_grass',
      layout: 'grid3x3',
      tileWidth: 32,
      tileHeight: 32
    })
    expect(grid3x3.cells).toHaveLength(9)
    expect(grid3x3.atlasWidth).toBe(96)
    expect(grid3x3.atlasHeight).toBe(96)
    expect(grid3x3.cells[4]?.role).toBe('center_fill')

    const wang16 = buildAutoTileAtlasManifest({
      terrainName: 'dungeon_wall',
      layout: 'wang16',
      tileWidth: 64,
      tileHeight: 64
    })
    expect(wang16.cells).toHaveLength(16)
    expect(wang16.cells[0]?.role).toBe('isolated_island')
    expect(wang16.cells[15]?.role).toBe('center_fill')

    const blob47 = buildAutoTileAtlasManifest({
      terrainName: 'cave_rock',
      layout: 'blob47',
      tileWidth: 48,
      tileHeight: 48
    })
    expect(blob47.cells).toHaveLength(BLOB_47_BITMASKS.length)
    expect(blob47.engineHints.godot.terrainSetMode).toBe('match_corners_and_sides')
  })

  it('detectNineSliceBorders accurately identifies UI frame borders and center stretch rect', () => {
    const width = 40
    const height = 30
    const borderThick = 6
    const rgba = new Uint8ClampedArray(width * height * 4)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const isBorder =
          x < borderThick ||
          x >= width - borderThick ||
          y < borderThick ||
          y >= height - borderThick
        if (isBorder) {
          // Gold metallic border
          rgba[idx] = 230
          rgba[idx + 1] = 185
          rgba[idx + 2] = 60
          rgba[idx + 3] = 255
        } else {
          // Dark parchment center
          rgba[idx] = 40
          rgba[idx + 1] = 35
          rgba[idx + 2] = 30
          rgba[idx + 3] = 255
        }
      }
    }

    const detection = detectNineSliceBorders(rgba, width, height)
    expect(detection.borders).toEqual({
      top: borderThick,
      right: borderThick,
      bottom: borderThick,
      left: borderThick
    })
    expect(detection.centerRect).toEqual({
      x: borderThick,
      y: borderThick,
      width: width - borderThick * 2,
      height: height - borderThick * 2
    })

    const manifest = buildNineSliceManifest('dialog_box', detection)
    expect(manifest.engineConfigs.unity.borderLBRT).toEqual([6, 6, 6, 6])
    expect(manifest.engineConfigs.godot.textureMarginTop).toBe(6)
    expect(manifest.engineConfigs.css.borderImageSlice).toBe('6 6 6 6 fill')
  })
})

describe('Phase 2: 3D PBR Map Derivation & Game Audio Engineering Operators', () => {
  it('derivePbrMapsFromRgba generates normal (OpenGL & DirectX), height, roughness, ao, metallic, and packed ORM', () => {
    const width = 16
    const height = 16
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        // Horizontal + vertical ramp
        const v = Math.min(255, x * 16 + y * 8)
        rgba[idx] = v
        rgba[idx + 1] = v
        rgba[idx + 2] = v
        rgba[idx + 3] = 255
      }
    }

    const glMaps = derivePbrMapsFromRgba(rgba, width, height, {
      normalFormat: 'opengl',
      normalStrength: 3,
      wrapTiling: false
    })
    const dxMaps = derivePbrMapsFromRgba(rgba, width, height, {
      normalFormat: 'directx',
      normalStrength: 3,
      wrapTiling: false
    })

    const sampleIdx = (8 * width + 8) * 4
    // X normal component is identical between OpenGL and DirectX
    expect(glMaps.normal[sampleIdx]).toBe(dxMaps.normal[sampleIdx])
    // Y (green) normal component is inverted around 128 between OpenGL and DirectX
    expect(glMaps.normal[sampleIdx + 1]! + dxMaps.normal[sampleIdx + 1]!).toBeCloseTo(255, -1)
    // Z (blue) normal component is positive (> 128)
    expect(glMaps.normal[sampleIdx + 2]).toBeGreaterThan(128)

    // ORM packing matches R=AO, G=Roughness, B=Metallic, A=255
    expect(glMaps.orm[sampleIdx]).toBe(glMaps.ao[sampleIdx])
    expect(glMaps.orm[sampleIdx + 1]).toBe(glMaps.roughness[sampleIdx])
    expect(glMaps.orm[sampleIdx + 2]).toBe(glMaps.metallic[sampleIdx])
    expect(glMaps.orm[sampleIdx + 3]).toBe(255)
  })

  it('planSfxVariantMatrix and ffmpeg builders construct zero-latency SFX variants and phase-continuous BGM loops', () => {
    const variants = planSfxVariantMatrix({
      count: 4,
      pitchSpreadSemitones: 2.0,
      tempoSpread: 0.08,
      timbreSpreadDb: 1.5
    })
    expect(variants).toHaveLength(4)
    expect(variants[0]?.variantId).toBe('v01')
    expect(variants[0]?.semitoneOffset).toBeLessThan(0)
    expect(variants[3]?.semitoneOffset).toBeGreaterThan(0)

    const sfxArgs = buildSfxVariantFfmpegArgs('in.wav', 'out_v01.wav', variants[0]!, {
      trimSilence: true
    })
    const afArg = sfxArgs[sfxArgs.indexOf('-af') + 1] ?? ''
    expect(afArg).toContain('silenceremove=')
    expect(afArg).toContain('asetrate=')
    expect(afArg).toContain('aresample=44100')
    expect(afArg).toContain('atempo=')

    const bgmArgs = buildSeamlessLoopBgmFfmpegArgs('bgm.mp3', 'bgm_loop.mp3', {
      crossfadeSec: 3.0,
      curve: 'qsin'
    })
    const fcArg = bgmArgs[bgmArgs.indexOf('-filter_complex') + 1] ?? ''
    expect(fcArg).toContain('asplit=2')
    expect(fcArg).toContain('atrim=0:3')
    expect(fcArg).toContain('atrim=start=3')
    expect(fcArg).toContain('acrossfade=d=3:c1=qsin:c2=qsin')
  })
})

describe('Phase 3: All-Genre Game Engine Bundle Exporter Manifest', () => {
  it('classifies multi-genre game assets and maps them to Godot and Unity directory conventions', () => {
    const items = [
      { id: '1', name: 'hero_walk', sourcePath: 'Assets/Sprites/hero_walk.png', type: 'image' },
      { id: '2', name: 'slash_vfx', sourcePath: 'Assets/VFX/slash_vfx.gif', type: 'image' },
      { id: '3', name: 'grass_tile', sourcePath: 'Assets/Tiles/grass_tile.png', type: 'image' },
      { id: '4', name: 'dialog_9slice', sourcePath: 'Assets/UI/dialog_9slice.png', type: 'image' },
      { id: '5', name: 'stone_normal', sourcePath: 'Assets/PBR/stone_normal.png', type: 'image' },
      { id: '6', name: 'knight_rigged', sourcePath: 'Assets/Models/knight.glb', type: 'model' },
      { id: '7', name: 'boss_spine', sourcePath: 'Assets/Spine/boss.skel' },
      {
        id: '8',
        name: 'battle_bgm_loop',
        sourcePath: 'Assets/Audio/battle_bgm_loop.mp3',
        type: 'audio'
      },
      {
        id: '9',
        name: 'sword_hit_v01',
        sourcePath: 'Assets/Audio/sword_hit_v01.wav',
        type: 'audio'
      },
      {
        id: '10',
        name: 'heroine_voice_01',
        sourcePath: 'Assets/Audio/heroine_voice_01.mp3',
        type: 'audio'
      }
    ]

    expect(classifyGameBundleItem(items[0]!)).toBe('sprites')
    expect(classifyGameBundleItem(items[1]!)).toBe('vfx')
    expect(classifyGameBundleItem(items[2]!)).toBe('tilesets')
    expect(classifyGameBundleItem(items[3]!)).toBe('ui')
    expect(classifyGameBundleItem(items[4]!)).toBe('pbr_maps')
    expect(classifyGameBundleItem(items[5]!)).toBe('models3d')
    expect(classifyGameBundleItem(items[6]!)).toBe('spine')
    expect(classifyGameBundleItem(items[7]!)).toBe('audio_bgm')
    expect(classifyGameBundleItem(items[8]!)).toBe('audio_sfx')
    expect(classifyGameBundleItem(items[9]!)).toBe('audio_voice')

    const godotBundle = buildGameBundleManifest({
      bundleName: 'my-indie-game',
      targetEngine: 'godot',
      items
    })
    expect(godotBundle.totalAssets).toBe(10)
    expect(godotBundle.countsByCategory.sprites).toBe(1)
    expect(godotBundle.countsByCategory.models3d).toBe(1)
    expect(godotBundle.countsByCategory.audio_bgm).toBe(1)
    expect(godotBundle.assets[0]?.bundleRelativePath).toBe('assets/sprites/hero_walk.png')

    const unityBundle = buildGameBundleManifest({
      bundleName: 'my-indie-game',
      targetEngine: 'unity',
      items
    })
    expect(unityBundle.assets[0]?.bundleRelativePath).toBe('Assets/GameArt/Sprites/hero_walk.png')
    expect(unityBundle.assets[5]?.bundleRelativePath).toBe(
      'Assets/GameArt/Models/knight_rigged.glb'
    )
  })
})

describe('Phase 4: 2D Sprite Physics Hull, Game Data Tables & Engine Importer Scripts', () => {
  it('extractSpriteCollisionHull & deriveCombatBoxesFromAlpha extract simplified convex hull and hurtbox/hitbox', () => {
    const width = 48
    const height = 48
    const rgba = new Uint8ClampedArray(width * height * 4)

    // Draw an asymmetric character facing right:
    // Core torso from x=[14..26], y=[12..40]
    // Extended sword/weapon protrusion to the right x=[27..42], y=[20..26]
    for (let y = 12; y <= 40; y++) {
      for (let x = 14; x <= 26; x++) {
        const idx = (y * width + x) * 4
        rgba[idx] = 200
        rgba[idx + 1] = 180
        rgba[idx + 2] = 150
        rgba[idx + 3] = 255
      }
    }
    for (let y = 20; y <= 26; y++) {
      for (let x = 27; x <= 42; x++) {
        const idx = (y * width + x) * 4
        rgba[idx] = 120
        rgba[idx + 1] = 220
        rgba[idx + 2] = 255
        rgba[idx + 3] = 255
      }
    }

    const hull = extractSpriteCollisionHull(rgba, width, height, {
      maxVertices: 8,
      pivotMode: 'bottom_center'
    })
    expect(hull.bounds).toEqual({
      x: 14,
      y: 12,
      width: 29,
      height: 29
    })
    expect(hull.verticesPx.length).toBeGreaterThanOrEqual(3)
    expect(hull.verticesPx.length).toBeLessThanOrEqual(8)

    const combat = deriveCombatBoxesFromAlpha(rgba, width, height)
    expect(combat.inferredFacing).toBe('right')
    expect(combat.hurtbox.width).toBeGreaterThan(0)
    expect(combat.hitbox.x).toBeGreaterThan(combat.hurtbox.x)
    expect(combat.groundSensor.y).toBeGreaterThanOrEqual(36)

    const manifest = buildSpritePhysicsManifest('hero_attack', rgba, width, height, {
      maxVertices: 8,
      pivotMode: 'bottom_center'
    })
    expect(manifest.engineSnippets.godotPackedVector2Array).toContain('PackedVector2Array(')
    expect(manifest.engineSnippets.unityLocalPointsPpu100).toHaveLength(
      hull.verticesRelativeToPivot.length
    )
  })

  it('buildGameDataTableBundle generates typed tables, CSVs, and RFC-4180 multi-language localization.csv', () => {
    const bundle = buildGameDataTableBundle({
      tableName: 'Chrono Blade',
      genre: 'roguelike_survivor',
      characters: [
        {
          id: 'char_hero',
          name: '猎魔游侠, 艾琳',
          nameEn: 'Demon Hunter, Eilin',
          nameJa: 'デーモンハンター・エイリン',
          role: 'hero',
          hp: 150,
          atk: 24,
          def: 8,
          spd: 140
        }
      ],
      skills: [
        {
          id: 'skill_crossbow_burst',
          name: '连珠圣弩',
          nameEn: 'Holy Crossbow Burst',
          description: '发射穿透 3 名敌人的圣光弩箭',
          descriptionEn: 'Fires holy bolts piercing 3 enemies',
          cooldownSec: 1.8,
          damageMultiplier: 1.65
        }
      ],
      waves: [
        {
          waveIndex: 1,
          enemyId: 'mob_skeleton',
          count: 25,
          spawnIntervalSec: 0.6,
          durationSec: 30
        }
      ]
    })

    expect(bundle.characters).toHaveLength(1)
    expect(bundle.skills).toHaveLength(1)
    expect(bundle.waves).toHaveLength(1)
    expect(bundle.localization.length).toBeGreaterThanOrEqual(3)

    // Comma in name/nameEn must be properly RFC-4180 quoted in localizationCsv
    expect(bundle.localizationCsv).toContain('key,zh-CN,en-US,ja-JP')
    expect(bundle.localizationCsv).toContain('"猎魔游侠, 艾琳"')
    expect(bundle.localizationCsv).toContain('"Demon Hunter, Eilin"')
    expect(bundle.tableCsvs['waves.csv']).toContain('waveIndex,durationSec,spawnIntervalSec')
  })

  it('generateEngineImporterScript outputs Godot 4 GDScript, Unity C# AssetPostprocessor, and Web ESM loader', () => {
    const items = [
      { id: '1', name: 'hero_walk', sourcePath: 'Assets/Sprites/hero_walk.png', type: 'image' },
      { id: '2', name: 'dialog_9slice', sourcePath: 'Assets/UI/dialog_9slice.png', type: 'image' },
      { id: '3', name: 'stone_normal', sourcePath: 'Assets/PBR/stone_normal.png', type: 'image' }
    ]

    const godotManifest = buildGameBundleManifest({
      bundleName: 'my-indie-game',
      targetEngine: 'godot',
      items
    })
    const godotScript = generateEngineImporterScript(godotManifest)
    expect(godotScript.relativePath).toBe('import_game_bundle.gd')
    expect(godotScript.language).toBe('gdscript')
    expect(godotScript.content).toContain('@tool')
    expect(godotScript.content).toContain('extends EditorScript')
    expect(godotScript.content).toContain('StyleBoxTexture')
    expect(godotScript.content).toContain('AudioStreamRandomizer')

    const unityManifest = buildGameBundleManifest({
      bundleName: 'my-indie-game',
      targetEngine: 'unity',
      items
    })
    const unityScript = generateEngineImporterScript(unityManifest)
    expect(unityScript.relativePath).toBe('Assets/GameArt/Editor/AiArtBundlePostprocessor.cs')
    expect(unityScript.language).toBe('csharp')
    expect(unityScript.content).toContain('class AiArtBundlePostprocessor : AssetPostprocessor')
    expect(unityScript.content).toContain('TextureImporterType.NormalMap')
    expect(unityScript.content).toContain('spriteBorder')

    const webManifest = buildGameBundleManifest({
      bundleName: 'my-indie-game',
      targetEngine: 'web',
      items
    })
    const webScript = generateEngineImporterScript(webManifest)
    expect(webScript.relativePath).toBe('loadGameBundle.mjs')
    expect(webScript.language).toBe('javascript')
    expect(webScript.content).toContain('export function pickRandomSfxVariant')
    expect(webScript.content).toContain('export async function fetchGameBundleManifest')
  })
})
