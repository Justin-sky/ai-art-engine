import { describe, expect, it } from 'vitest'
import {
  analyzeSeamlessTile,
  applyEqualPowerLoopCrossfadePcm,
  applySeamlessTileBlend,
  BLOB_47_BITMASKS,
  buildAutoTileAtlasManifest,
  buildBitmapFontManifest,
  buildGameBundleManifest,
  buildGameDataTableBundle,
  buildGameplaySystemsBundle,
  buildGameShaderParticleBundle,
  buildNineSliceManifest,
  buildSeamlessLoopBgmFfmpegArgs,
  buildSfxVariantFfmpegArgs,
  buildSpritePhysicsManifest,
  classifyGameBundleItem,
  compileGameArtBiblePromptClause,
  compilePlayableGameSandboxHtml,
  createProceduralStoneTileRgba,
  decodeWavBytesToPcm,
  deriveCombatBoxesFromAlpha,
  deriveDeterministicUnityGuid,
  derivePbrMapsFromRgba,
  detectNineSliceBorders,
  encodePcmToWavBytes,
  encodePcmToWavDataUrl,
  encodeRgbaToPngDataUrl,
  extractGuidFromUnityMeta,
  extractSpriteCollisionHull,
  generateEngineImporterScript,
  generateProceduralLevelMap,
  generateUnityMetaFile,
  planIncrementalBundleSync,
  planSfxVariantMatrix,
  renderProceduralLevelToPng,
  resamplePitchShiftPcm,
  synthesizeGameSeedPcm,
  trimSilencePcm,
  validateSkillTreeDag
} from '../src/shared/gameAssets'
import {
  executeGameAudioDspNode,
  executeGameLevelMapNode,
  executeGamePbrTileNode,
  executeGamePlayableNode
} from '../src/shared/graph/execute/gameNodes'
import { getNodeTypeOrThrow } from '../src/shared/graph'

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

describe('Phase 5: Procedural Tiled (.tmj) Level Maps, Shaders/Particles, Gameplay DAG Systems & BMFont', () => {
  it('generateProceduralLevelMap supports bsp_dungeon, cellular_cave, platformer_course, and arena_waves with Tiled .tmj output', () => {
    const bsp = generateProceduralLevelMap({
      levelName: 'crypt_01',
      algorithm: 'bsp_dungeon',
      width: 36,
      height: 24,
      seed: 101
    })
    expect(bsp.rooms.length).toBeGreaterThanOrEqual(2)
    expect(bsp.entities.some((e) => e.type === 'player_spawn')).toBe(true)
    expect(bsp.entities.some((e) => e.type === 'boss_spawn')).toBe(true)
    expect(bsp.tiledMap.layers).toHaveLength(3)
    expect(bsp.tiledMap.layers[0]?.name).toBe('Ground')
    expect(bsp.tiledMap.layers[2]?.type).toBe('objectgroup')
    expect(bsp.asciiPreview).toContain('P')
    expect(bsp.asciiPreview).toContain('B')

    const cave = generateProceduralLevelMap({
      levelName: 'cavern_01',
      algorithm: 'cellular_cave',
      width: 32,
      height: 22,
      seed: 7
    })
    expect(cave.rooms).toHaveLength(3)
    expect(cave.entities.some((e) => e.type === 'treasure_chest')).toBe(true)

    const plat = generateProceduralLevelMap({
      levelName: 'world_1_1',
      algorithm: 'platformer_course',
      width: 40,
      height: 20,
      seed: 19
    })
    expect(plat.entities.some((e) => e.type === 'exit_portal')).toBe(true)

    const arena = generateProceduralLevelMap({
      levelName: 'survivor_stage',
      algorithm: 'arena_waves',
      width: 30,
      height: 20,
      seed: 1
    })
    expect(arena.rooms[0]?.role).toBe('arena')
    expect(arena.entities.filter((e) => e.type === 'enemy_spawn').length).toBeGreaterThanOrEqual(4)
  })

  it('buildGameShaderParticleBundle generates Godot .gdshader, Unity .shader, WebGL GLSL, and GPU particle presets', () => {
    const bundle = buildGameShaderParticleBundle()
    expect(bundle.shaders).toHaveLength(8)
    expect(bundle.particles).toHaveLength(8)

    const hitFlash = bundle.shaders.find((s) => s.presetId === 'hit_flash')!
    expect(hitFlash.godotGdShader).toContain('shader_type canvas_item;')
    expect(hitFlash.unityShaderLab).toContain('Shader "AIArtEngine/2D/HitFlash"')
    expect(hitFlash.webglGlslFrag).toContain('gl_FragColor')

    const coinBurst = bundle.particles.find((p) => p.presetId === 'coin_burst')!
    expect(coinBurst.oneShot).toBe(true)
    expect(coinBurst.godotTresSnippet).toContain('ParticleProcessMaterial')
    expect(coinBurst.phaserEmitterConfig).toHaveProperty('lifespan', 900)
  })

  it('buildGameplaySystemsBundle & buildBitmapFontManifest validate DAG skill trees, AI FSMs, and AngelCode .fnt', () => {
    const sys = buildGameplaySystemsBundle({
      systemName: 'arpg_core',
      skillTree: [
        { id: 'slash_1', name: '基础斩击', tier: 1, prerequisiteIds: [] },
        { id: 'whirlwind_2', name: '旋风斩', tier: 2, prerequisiteIds: ['slash_1'] },
        { id: 'bladestorm_3', name: '剑刃风暴', tier: 3, prerequisiteIds: ['whirlwind_2'] }
      ],
      craftingRecipes: [
        {
          id: 'craft_fire_sword',
          name: '烈焰魔剑',
          station: 'anvil',
          ingredients: [
            { itemId: 'iron_ingot', count: 5 },
            { itemId: 'fire_core', count: 1 }
          ],
          resultItemId: 'weapon_fire_sword',
          resultCount: 1
        }
      ],
      aiBehaviors: [{ id: 'boss_dk', enemyName: 'DeathKnight' }]
    })

    expect(sys.skillTreeValidation.valid).toBe(true)
    expect(sys.skillTreeValidation.topologicalOrder).toEqual([
      'slash_1',
      'whirlwind_2',
      'bladestorm_3'
    ])
    expect(sys.mermaidDiagram).toContain('slash_1 --> whirlwind_2')
    expect(sys.mermaidDiagram).toContain('boss_dk_idle')

    // Cycle detection test
    const cyclic = validateSkillTreeDag([
      {
        id: 'a',
        name: 'A',
        tier: 1,
        maxRank: 1,
        costPoints: 1,
        prerequisiteIds: ['b'],
        statModifiers: {},
        description: ''
      },
      {
        id: 'b',
        name: 'B',
        tier: 2,
        maxRank: 1,
        costPoints: 1,
        prerequisiteIds: ['a'],
        statModifiers: {},
        description: ''
      }
    ])
    expect(cyclic.valid).toBe(false)
    expect(cyclic.cycleNodeIds).toEqual(['a', 'b'])

    // BMFont test
    const bm = buildBitmapFontManifest({
      fontName: 'crit_font',
      atlasWidth: 1024,
      atlasHeight: 1024,
      rows: 4,
      cols: 4,
      charset: '0123456789+-!%CM'
    })
    expect(bm.glyphs).toHaveLength(16)
    expect(bm.cellWidth).toBe(256)
    expect(bm.fntText).toContain('info face="crit_font"')
    expect(bm.fntText).toContain('chars count=16')
    expect(bm.fntText).toContain('char id=48') // '0'
  })
})

describe('Phase 6: Product-Grade Art Bible Lock, Unity .meta GUID Preservation & Playable Sandbox Compiler', () => {
  it('compileGameArtBiblePromptClause locks camera projection, art direction, and master palette hex', () => {
    const clause = compileGameArtBiblePromptClause({
      cameraProjection: 'top_down_34',
      artDirection: 'cel_anime',
      masterPaletteHex: ['#09101D', '38bdf8', '#fbbf24']
    })
    expect(clause).toContain('[Camera Lock:')
    expect(clause).toContain('3/4 top-down RPG')
    expect(clause).toContain('[Art Style Lock:')
    expect(clause).toContain('cel-shaded anime')
    expect(clause).toContain('[Master Color Palette: #09101d, #38bdf8, #fbbf24]')
  })

  it('generateUnityMetaFile & planIncrementalBundleSync preserve existing Unity .meta GUIDs and diff unchanged files', () => {
    const manifest = buildGameBundleManifest({
      bundleName: 'unity-game',
      targetEngine: 'unity',
      items: [
        { id: '1', name: 'hero', sourcePath: 'Assets/Sprites/hero.png', type: 'image' },
        { id: '2', name: 'stone_normal', sourcePath: 'Assets/PBR/stone_normal.png', type: 'image' },
        { id: '3', name: 'hit_sfx', sourcePath: 'Assets/Audio/hit.wav', type: 'audio' }
      ]
    })

    const spriteEntry = manifest.assets[0]!
    const normalEntry = manifest.assets[1]!
    const sfxEntry = manifest.assets[2]!

    const generated = generateUnityMetaFile(spriteEntry, {
      spriteBorders: { left: 8, bottom: 8, right: 8, top: 8 }
    })
    expect(generated.guid).toMatch(/^[0-9a-f]{32}$/)
    expect(generated.metaText).toContain(`guid: ${generated.guid}`)
    expect(generated.metaText).toContain('textureType: 8')
    expect(generated.metaText).toContain('spriteBorder: {x: 8, y: 8, z: 8, w: 8}')

    // Preserving an existing Unity .meta GUID on disk so Prefabs never lose reference
    const existingUnityGuid = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const existingMetaOnDisk = `fileFormatVersion: 2\nguid: ${existingUnityGuid}\nTextureImporter:\n`
    const reExported = generateUnityMetaFile(spriteEntry, {
      existingMetaText: existingMetaOnDisk
    })
    expect(extractGuidFromUnityMeta(existingMetaOnDisk)).toBe(existingUnityGuid)
    expect(reExported.guid).toBe(existingUnityGuid)
    expect(reExported.metaText).toContain(`guid: ${existingUnityGuid}`)

    // Normal map gets textureType: 1 and sRGBTexture: 0
    const normalMeta = generateUnityMetaFile(normalEntry)
    expect(normalMeta.metaText).toContain('textureType: 1')
    expect(normalMeta.metaText).toContain('sRGBTexture: 0')

    // SFX gets DecompressOnLoad (loadType: 0)
    const sfxMeta = generateUnityMetaFile(sfxEntry)
    expect(sfxMeta.metaText).toContain('AudioImporter:')
    expect(sfxMeta.metaText).toContain('loadType: 0')

    // Incremental sync diff
    const prevFp = {
      [spriteEntry.bundleRelativePath]: '1024:1000',
      [normalEntry.bundleRelativePath]: '2048:2000'
    }
    const currFp = {
      [spriteEntry.bundleRelativePath]: '1024:1000', // unchanged
      [normalEntry.bundleRelativePath]: '2048:9999', // modified
      [sfxEntry.bundleRelativePath]: '512:3000' // added
    }
    const diff = planIncrementalBundleSync(manifest, currFp, prevFp)
    expect(diff.unchanged).toHaveLength(1)
    expect(diff.modified).toHaveLength(1)
    expect(diff.added).toHaveLength(1)
    expect(deriveDeterministicUnityGuid('stable_key')).toBe(
      deriveDeterministicUnityGuid('stable_key')
    )
  })

  it('compilePlayableGameSandboxHtml produces a self-contained playable HTML5 micro-game for survivor and platformer modes', () => {
    const survivor = compilePlayableGameSandboxHtml({
      title: 'Vampire Blade Demo',
      mode: 'survivor',
      levelSeed: 77
    })
    expect(survivor.levelAlgorithm).toBe('arena_waves')
    expect(survivor.html).toContain('<!DOCTYPE html>')
    expect(survivor.html).toContain('Vampire Blade Demo')
    expect(survivor.html).toContain('Survivor Mode')
    expect(survivor.html).toContain('Platformer Mode')

    const platformer = compilePlayableGameSandboxHtml({
      title: 'Knight Jump Demo',
      mode: 'platformer',
      levelSeed: 88
    })
    expect(platformer.levelAlgorithm).toBe('platformer_course')
    expect(platformer.html).toContain('Knight Jump Demo')
  })

  it('gameAudioWavDSP trims silence, applies equal-power loop crossfades, pitch-shifts SFX, and encodes valid RIFF WAVE', () => {
    const sampleRate = 8000
    const raw = new Float32Array(sampleRate * 2) // 2.0s
    // 0.25s silence at head, 1.25s sine wave, 0.5s silence at tail
    for (let i = 2000; i < 12000; i++) {
      raw[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8
    }

    const trimmed = trimSilencePcm(raw, sampleRate, { thresholdDb: -45 })
    expect(trimmed.length).toBeLessThan(raw.length - 5000)
    expect(trimmed.length).toBeGreaterThan(9500)

    // Equal-power loop crossfade (0.3s crossfade on ~1.25s signal)
    const looped = applyEqualPowerLoopCrossfadePcm(trimmed, sampleRate, 0.3)
    expect(looped.length).toBe(trimmed.length - Math.round(0.3 * sampleRate))
    expect(Number.isFinite(looped[0])).toBe(true)
    expect(Number.isFinite(looped[looped.length - 1])).toBe(true)

    // Pitch shift +3 semitones and encode to WAV
    const shifted = resamplePitchShiftPcm(trimmed, 3, 1.5)
    expect(shifted.length).toBeLessThan(trimmed.length)

    const wavBytes = encodePcmToWavBytes([shifted], sampleRate)
    const header = String.fromCharCode(wavBytes[0]!, wavBytes[1]!, wavBytes[2]!, wavBytes[3]!)
    const waveTag = String.fromCharCode(wavBytes[8]!, wavBytes[9]!, wavBytes[10]!, wavBytes[11]!)
    expect(header).toBe('RIFF')
    expect(waveTag).toBe('WAVE')
    expect(wavBytes.byteLength).toBe(44 + shifted.length * 2)

    const dataUrl = encodePcmToWavDataUrl([shifted], sampleRate)
    expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true)
  })
})

describe('Phase 7: Dedicated Game Graph Nodes (game.pbrTile, game.audioDsp, game.levelMap, game.playable)', () => {
  it('registers all 4 game graph node types in built-in node registry with connectable ports', () => {
    const pbrDef = getNodeTypeOrThrow('game.pbrTile')
    expect(pbrDef).toBeDefined()
    expect(pbrDef.ports.map((p) => p.id)).toEqual(
      expect.arrayContaining(['in', 'out', 'out-all', 'out-meta'])
    )

    const audioDef = getNodeTypeOrThrow('game.audioDsp')
    expect(audioDef).toBeDefined()
    expect(audioDef.ports.map((p) => p.id)).toEqual(
      expect.arrayContaining(['in', 'out', 'out-all'])
    )

    const levelDef = getNodeTypeOrThrow('game.levelMap')
    expect(levelDef).toBeDefined()
    expect(levelDef.ports.map((p) => p.id)).toEqual(
      expect.arrayContaining(['out', 'out-all', 'out-text'])
    )

    const playableDef = getNodeTypeOrThrow('game.playable')
    expect(playableDef).toBeDefined()
    expect(playableDef.ports.map((p) => p.id)).toEqual(
      expect.arrayContaining(['in-image', 'in-text', 'in-voice', 'out', 'out-all'])
    )
  })

  it('executes game.pbrTile, game.audioDsp, game.levelMap, and game.playable end-to-end as graph nodes', async () => {
    // 1. game.pbrTile standalone execution
    const pbrNode = {
      id: 'n_pbr',
      typeId: 'game.pbrTile' as const,
      title: 'DungeonBrick',
      x: 0,
      y: 0,
      w: 260,
      h: 220,
      params: {
        gameTileSeamless: true,
        gameTileBlendRatio: 0.2,
        gamePbrNormalStrength: 3.0,
        gamePbrInvertRoughness: false
      }
    }
    const pbrOutputs = await executeGamePbrTileNode({ node: pbrNode, inputs: {} })
    expect(pbrNode.params.generatedImages).toHaveLength(5)
    expect(pbrOutputs['out-all']?.kind).toBe('images')
    expect(pbrOutputs['out-meta']?.kind).toBe('text')
    const metaJson = JSON.parse(
      pbrOutputs['out-meta']?.kind === 'text' ? pbrOutputs['out-meta'].text : '{}'
    )
    expect(metaJson.summary?.seamScoreAfter).toBe(100)
    expect(metaJson.nineSlice?.borders).toBeDefined()
    expect(metaJson.physics?.hull?.verticesPx?.length).toBeGreaterThanOrEqual(3)

    // 2. game.audioDsp standalone execution (loop_bgm & sfx_variants)
    const audioLoopNode = {
      id: 'n_audio_loop',
      typeId: 'game.audioDsp' as const,
      title: 'BattleBgm',
      x: 0,
      y: 0,
      w: 260,
      h: 220,
      params: {
        gameAudioDspMode: 'loop_bgm' as const,
        gameAudioCrossfadeSec: 0.25
      }
    }
    const loopOutputs = await executeGameAudioDspNode({ node: audioLoopNode, inputs: {} })
    expect(audioLoopNode.params.generatedVoices).toHaveLength(1)
    expect(loopOutputs.out?.kind).toBe('voice')

    const audioSfxNode = {
      id: 'n_audio_sfx',
      typeId: 'game.audioDsp' as const,
      title: 'SwordHit',
      x: 0,
      y: 0,
      w: 260,
      h: 220,
      params: {
        gameAudioDspMode: 'sfx_variants' as const,
        gameAudioTrimThresholdDb: -42
      }
    }
    const sfxOutputs = await executeGameAudioDspNode({ node: audioSfxNode, inputs: {} })
    expect(audioSfxNode.params.generatedVoices).toHaveLength(4)
    expect(sfxOutputs['out-all']?.kind).toBe('voices')

    // 3. game.levelMap execution
    const levelNode = {
      id: 'n_level',
      typeId: 'game.levelMap' as const,
      title: 'CryptLevel',
      x: 0,
      y: 0,
      w: 260,
      h: 220,
      params: {
        gameLevelAlgorithm: 'bsp_dungeon' as const,
        gameLevelWidth: 28,
        gameLevelHeight: 18,
        gameLevelSeed: 1234
      }
    }
    const levelOutputs = await executeGameLevelMapNode({ node: levelNode, inputs: {} })
    expect(levelNode.params.generatedImages).toHaveLength(1)
    expect(levelOutputs.out?.kind).toBe('image')
    if (levelOutputs.out?.kind === 'image') {
      expect(levelOutputs.out.dataUrl).toMatch(/^data:image\/png;base64,/)
    }
    expect(levelOutputs['out-text']?.kind).toBe('text')
    if (levelOutputs['out-text']?.kind === 'text') {
      expect(levelOutputs['out-text'].text).toContain('"tiledversion"')
    }

    // 4. game.playable connected to upstream image, level text, and audio
    const playableNode = {
      id: 'n_playable',
      typeId: 'game.playable' as const,
      title: 'DungeonPlayable',
      x: 0,
      y: 0,
      w: 260,
      h: 220,
      params: {
        gamePlayableGenre: 'roguelike_action' as const,
        gamePlayableCameraMode: 'topdown_34' as const,
        gamePlayableTitle: 'Node Graph Dungeon Demo'
      }
    }
    const playableOutputs = await executeGamePlayableNode({
      node: playableNode,
      inputs: {
        'in-image': [pbrOutputs.out!],
        'in-text': [levelOutputs['out-text']!],
        'in-voice': [sfxOutputs.out!]
      }
    })
    expect(playableNode.params.gamePlayableHtml).toContain('<!DOCTYPE html>')
    expect(playableNode.params.gamePlayableHtml).toContain('Node Graph Dungeon Demo')
    expect(playableOutputs.out?.kind).toBe('text')
  })
})
