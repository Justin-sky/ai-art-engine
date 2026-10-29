import { describe, expect, it, vi } from 'vitest'
import {
  buildGameGraphPlanFromSpec,
  buildSpritePrompt,
  buildUiSuiteGraphPlanFromPrompt,
  inferGameSpecFromKeywords,
  inferUiStylePresetFromPrompt,
  isOneSentenceUiSuitePrompt,
  normalizeGameSpec,
  ONE_SENTENCE_GAME_GENRES,
  ONE_SENTENCE_GAME_NODE_KEYS,
  ONE_SENTENCE_UI_SUITE_NODE_KEYS,
  type GameSpec
} from '../src/shared/gameAssets/oneSentenceGameSpec'
import { materializeGraphPlan } from '../src/shared/graph'
import { compilePlayableGameSandboxHtml } from '../src/shared/gameAssets'
import {
  autoKeySpriteBackground,
  downscaleRgbaToMaxEdge,
  executeGamePbrTileNode,
  PLAYABLE_SPRITE_MAX_EDGE,
  prepareSandboxSprite
} from '../src/shared/graph/execute/gameNodes'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'
import {
  createOneSentenceGame,
  detectOneSentenceGameAudio,
  type CreateOneSentenceGameDeps
} from '../src/main/services/oneSentenceGameService'
import { toolAccessOf } from '../src/shared/mcpModeAccess'
import {
  audioProviderUnavailableReason,
  recordAudioProviderFailure,
  recordAudioProviderSuccess,
  resetAudioProviderHealth
} from '../src/main/services/audioProviderHealth'

/**
 * 「一句话生成游戏」契约：
 * - 关键词兜底：Agent 漏填规格时也能得到正确玩法；
 * - 规格展开的 GraphPlan 必须**零警告**物化（不丢参数、不连错口）——
 *   这是两段式设计的核心保证，丢一个参数就会出现「生成跑完但难度 / 卡牌 / 对白全是默认值」的假成功；
 * - 沙盒执行器：专用角色口优先、白底精灵自动抠底、自定义对白生效；
 * - 自动运行只听用户设置，Agent 无法绕过。
 */

function materialize(spec: GameSpec, opts: { aiSfx?: boolean; aiMusic?: boolean } = {}) {
  const plan = buildGameGraphPlanFromSpec(spec, opts)
  return {
    plan,
    result: materializeGraphPlan(plan, { scope: 'subgraphAsset', assetType: 'subgraph' })
  }
}

describe('inferGameSpecFromKeywords', () => {
  it.each([
    ['做一个塔防游戏，守护水晶', 'tower_defense'], // cjk-ok
    ['a tower defense game with goblins', 'tower_defense'],
    ['横版跳跃闯关的小骑士', 'platformer'], // cjk-ok
    ['side-scrolling platformer about a fox', 'platformer'],
    ['元素魔法卡牌对战', 'card_dbg'], // cjk-ok
    ['deck builder roguelike', 'card_dbg'],
    ['校园恋爱视觉小说，有分支剧情', 'avg_dialogue'], // cjk-ok
    ['a galgame about time travel', 'avg_dialogue'],
    ['像素风吸血鬼幸存者', 'survivor'], // cjk-ok
    ['something fun', 'survivor']
  ])('%s → %s', (prompt, genre) => {
    expect(inferGameSpecFromKeywords(prompt).genre).toBe(genre)
  })

  it('infers difficulty, art style, camera and out-of-scope notes', () => {
    const hints = inferGameSpecFromKeywords('像素风开放世界赛车，难一点') // cjk-ok
    expect(hints.difficulty).toBe('hard')
    expect(hints.artStyle).toMatch(/pixel/i)
    expect(hints.scopeNotes.length).toBeGreaterThanOrEqual(2)
    expect(inferGameSpecFromKeywords('platformer').camera).toBe('side_view')
    expect(inferGameSpecFromKeywords('tower defense').levelAlgorithm).toBe('tower_defense')
    expect(inferGameSpecFromKeywords('dungeon survivor maze').levelAlgorithm).toBe('labyrinth_maze')
  })
})

describe('normalizeGameSpec', () => {
  it('fills a complete spec from the prompt alone', () => {
    const spec = normalizeGameSpec({}, '休闲的横版跳跃游戏') // cjk-ok
    expect(spec.genre).toBe('platformer')
    expect(spec.camera).toBe('side_view')
    expect(spec.levelAlgorithm).toBe('platformer_course')
    expect(spec.difficulty).toBe('easy')
    expect(spec.hero.look.length).toBeGreaterThan(0)
    expect(spec.title.length).toBeGreaterThan(0)
  })

  it('prefers valid agent fields, rejects invalid enums and clamps numbers', () => {
    const spec = normalizeGameSpec(
      {
        title: 'Slime Siege',
        genre: 'survivor',
        camera: 'not_a_camera',
        difficulty: 'nightmare',
        hero: { name: 'Aria', look: 'silver knight', hp: 99999, atk: -5 },
        tile: { look: 'mossy bricks', pbrPreset: 'unobtainium' }
      },
      'tower defense'
    )
    expect(spec.genre).toBe('survivor')
    // 玩法被 Agent 改成 survivor：镜头 / 关卡默认值跟随 survivor，而不是关键词推断出的塔防
    expect(spec.camera).toBe('topdown_34')
    expect(spec.levelAlgorithm).toBe('arena_waves')
    expect(spec.difficulty).toBe('normal')
    expect(spec.hero.hp).toBe(999)
    expect(spec.hero.atk).toBe(1)
    expect(spec.tile.pbrPreset).toBe('stone_dungeon')
  })

  it('forces genre-locked camera / level for platformer and tower defense', () => {
    expect(normalizeGameSpec({ genre: 'platformer', camera: 'topdown_90' }, '').camera).toBe(
      'side_view'
    )
    expect(
      normalizeGameSpec({ genre: 'tower_defense', levelAlgorithm: 'cellular_cave' }, '')
        .levelAlgorithm
    ).toBe('tower_defense')
  })

  it('keeps cards only for card_dbg and limits them', () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({
      name: `Fire ${i}`,
      cost: 9,
      cardType: 'attack',
      damage: 500
    }))
    const card = normalizeGameSpec({ genre: 'card_dbg', cards }, '')
    expect(card.cards).toHaveLength(12)
    expect(card.cards[0]!.cost).toBe(3)
    expect(card.cards[0]!.damage).toBe(99)
    expect(new Set(card.cards.map((c) => c.id)).size).toBe(12)
    expect(normalizeGameSpec({ genre: 'survivor', cards }, '').cards).toHaveLength(0)
  })

  it('repairs dangling dialogue links so the AVG story graph is always walkable', () => {
    const spec = normalizeGameSpec(
      {
        genre: 'avg_dialogue',
        dialogues: [
          { id: 'a', speaker: 'Mei', text: 'Hello', choices: [{ label: 'Go', nextId: 'missing' }] },
          { id: 'b', text: 'World' },
          { id: 'a', text: 'duplicate id' },
          { text: '' }
        ]
      },
      ''
    )
    const ids = new Set(spec.dialogues.map((d) => d.id))
    expect(spec.dialogues).toHaveLength(3)
    expect(ids.size).toBe(3)
    for (const node of spec.dialogues) {
      for (const choice of node.choices ?? []) expect(ids.has(choice.nextId)).toBe(true)
    }
    expect(spec.dialogues[0]!.choices![0]!.nextId).toBe('b')
  })
})

describe('buildGameGraphPlanFromSpec', () => {
  for (const genre of ONE_SENTENCE_GAME_GENRES) {
    for (const audio of [{}, { aiSfx: true, aiMusic: true }]) {
      it(`materializes ${genre} (${audio && 'aiSfx' in audio ? 'AI audio' : 'procedural audio'}) with zero warnings`, () => {
        const spec = normalizeGameSpec(
          {
            genre,
            cards: [{ name: 'Fireball', cost: 1, cardType: 'attack', damage: 9 }],
            dialogues: [
              { id: 'd1', text: 'Hi', choices: [{ label: 'Next', nextId: 'd2' }] },
              { id: 'd2', text: 'Bye' }
            ]
          },
          'test game'
        )
        const { plan, result } = materialize(spec, audio)
        expect(result.ok).toBe(true)
        expect(result.warnings).toEqual([])
        const withAudio = 'aiSfx' in audio
        expect(plan.nodes.some((n) => n.typeId === 'asset.sfx')).toBe(withAudio)
        expect(plan.nodes.some((n) => n.typeId === 'asset.music')).toBe(withAudio)
        // 每条计划边都落成了文档边（没有因端口不兼容被丢弃）
        const businessEdges = result.document!.edges.filter((e) => e.id.startsWith('edge-ai-'))
        expect(businessEdges).toHaveLength(plan.edges.length)
      })
    }
  }

  it('builds sprite, tile PBR, level map and audio DSP nodes for the game workflow', () => {
    const spec = normalizeGameSpec(
      {
        genre: 'avg_dialogue',
        difficulty: 'hard',
        hero: { name: 'Mei', look: 'anime girl', hp: 321, atk: 42 },
        dialogues: [{ id: 'd1', text: 'Hello there' }]
      },
      ''
    )
    const { result } = materialize(spec)
    const doc = result.document!
    const sprites = doc.nodes.filter((n) => n.typeId === 'asset.image')
    expect(sprites).toHaveLength(3)
    for (const sprite of sprites) expect(sprite.params.generateAspectRatio).toBe('1:1')
    expect(doc.nodes.some((n) => n.typeId === 'game.pbrTile')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'game.levelMap')).toBe(true)
    expect(doc.nodes.some((n) => n.typeId === 'game.audioDsp')).toBe(true)
  })

  it('appends the white-background / single-sprite clause to sprite prompts', () => {
    const spec = normalizeGameSpec({ artStyle: 'neon cyberpunk', camera: 'isometric_45' }, '')
    const prompt = buildSpritePrompt(spec, 'robot ninja')
    expect(prompt).toContain('neon cyberpunk')
    expect(prompt).toContain('robot ninja')
    expect(prompt).toMatch(/plain solid white background/)
    expect(prompt).toMatch(/isometric/)
  })
})

// ── 执行器：专用口 / 抠底 / 对白 ──

/** w×h 白底，中间 (w/2)×(h/2) 红色方块 */
function whiteSpriteRgba(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inside = x >= w / 4 && x < (w * 3) / 4 && y >= h / 4 && y < (h * 3) / 4
      data[i] = 255
      data[i + 1] = inside ? 0 : 255
      data[i + 2] = inside ? 0 : 255
      data[i + 3] = 255
    }
  }
  return data
}

function makeCodec() {
  const encoded: Array<{ width: number; height: number; data: Uint8ClampedArray }> = []
  const codec = {
    decodeImageRgba: vi.fn(async (url: string) => {
      if (url.includes('TRANSPARENT')) {
        const data = whiteSpriteRgba(32, 32)
        for (let i = 3; i < data.length; i += 4) data[i] = 0
        return { width: 32, height: 32, data }
      }
      return { width: 32, height: 32, data: whiteSpriteRgba(32, 32) }
    }),
    encodeRgbaPng: vi.fn(
      async (img: { width: number; height: number; data: Uint8ClampedArray }) => {
        encoded.push({
          width: img.width,
          height: img.height,
          data: new Uint8ClampedArray(img.data)
        })
        return `data:image/png;base64,KEYED${encoded.length}`
      }
    )
  }
  return { codec, encoded }
}

describe('autoKeySpriteBackground', () => {
  it('keys a white background to transparent and crops to the subject', async () => {
    const { codec, encoded } = makeCodec()
    const result = await autoKeySpriteBackground(
      codec as unknown as NodeExecuteContext['uiRgbaCodec'],
      'data:image/png;base64,WHITE'
    )
    expect(result.keyed).toBe(true)
    expect(result.url).toBe('data:image/png;base64,KEYED1')
    const img = encoded[0]!
    // 16×16 主体 + 2px 留边
    expect(img.width).toBeLessThanOrEqual(20)
    expect(img.height).toBeLessThanOrEqual(20)
    expect(img.data[3]).toBe(0) // 左上角已透明
    const center = ((img.height >> 1) * img.width + (img.width >> 1)) * 4
    expect(img.data[center + 3]).toBe(255) // 主体保留
  })

  it('shrinks large AI sprites before embedding so the playable HTML stays small', async () => {
    const encoded: Array<{ width: number; height: number }> = []
    const codec = {
      decodeImageRgba: async () => ({
        width: 1024,
        height: 1024,
        data: whiteSpriteRgba(1024, 1024)
      }),
      encodeRgbaPng: async (img: { width: number; height: number }) => {
        encoded.push({ width: img.width, height: img.height })
        return 'data:image/png;base64,SMALL'
      }
    }
    const keyed = await prepareSandboxSprite(codec as never, 'data:image/png;base64,BIG', {
      maxEdge: PLAYABLE_SPRITE_MAX_EDGE,
      key: true
    })
    expect(keyed).toEqual({ url: 'data:image/png;base64,SMALL', keyed: true })
    expect(Math.max(encoded[0]!.width, encoded[0]!.height)).toBeLessThanOrEqual(
      PLAYABLE_SPRITE_MAX_EDGE
    )

    // 不抠底时也要缩（地砖 / 原生透明精灵）
    const tile = await prepareSandboxSprite(codec as never, 'data:image/png;base64,BIG', {
      maxEdge: 128,
      key: false
    })
    expect(tile.keyed).toBe(false)
    expect(tile.url).toBe('data:image/png;base64,SMALL')
    expect(encoded[1]).toEqual({ width: 128, height: 128 })
  })

  it('keeps the subject color when area-downscaling', () => {
    const small = downscaleRgbaToMaxEdge(whiteSpriteRgba(64, 64), 64, 64, 16)
    expect(small.width).toBe(16)
    const center = (8 * 16 + 8) * 4
    expect(small.data[center]).toBe(255)
    expect(small.data[center + 1]).toBe(0)
  })

  it('leaves natively transparent sprites and missing codecs untouched', async () => {
    const { codec } = makeCodec()
    const native = await autoKeySpriteBackground(
      codec as unknown as NodeExecuteContext['uiRgbaCodec'],
      'data:image/png;base64,TRANSPARENT'
    )
    expect(native).toEqual({ url: 'data:image/png;base64,TRANSPARENT', keyed: false })
    expect(await autoKeySpriteBackground(undefined, 'x')).toEqual({ url: 'x', keyed: false })
  })
})

// ── 主进程编排：音频探测 / 自动运行开关 ──

function fakeDeps(overrides: Partial<CreateOneSentenceGameDeps> = {}): CreateOneSentenceGameDeps & {
  commit: ReturnType<typeof vi.fn>
  dispatchRun: ReturnType<typeof vi.fn>
} {
  return {
    commit: vi.fn(async () => ({ ok: true, assetId: 'asset-1', title: 'T', warnings: [] })),
    detectAudio: () => ({ aiSfx: false, aiMusic: false }),
    getAutoRun: () => false,
    dispatchRun: vi.fn(() => 'mcp-task-1'),
    ...overrides
  } as never
}

describe('createOneSentenceGame', () => {
  it('builds the graph but does NOT run it when auto-run is off (default)', async () => {
    const deps = fakeDeps()
    const result = await createOneSentenceGame({ prompt: '像素风吸血鬼幸存者' }, deps) // cjk-ok
    expect(result.ok).toBe(true)
    expect(result.autoRun).toBe(false)
    expect(deps.dispatchRun).not.toHaveBeenCalled()
    expect(result.nextStep).toMatch(/NOT run/)
    expect(result.audioSource).toEqual({ sfx: 'procedural', bgm: 'procedural' })
    const plan = deps.commit.mock.calls[0]![0].plan
    expect(plan.nodes.some((n: { typeId: string }) => n.typeId === 'asset.sfx')).toBe(false)
    expect(result.nodeKeys).toEqual(ONE_SENTENCE_GAME_NODE_KEYS)
  })

  it('dispatches exactly one run when the user enabled auto-run', async () => {
    const deps = fakeDeps({ getAutoRun: () => true })
    const result = await createOneSentenceGame({ prompt: 'tower defense' }, deps)
    expect(deps.dispatchRun).toHaveBeenCalledTimes(1)
    expect(deps.dispatchRun).toHaveBeenCalledWith('asset-1')
    expect(result.autoRun).toBe(true)
    expect(result.mcpTaskId).toBe('mcp-task-1')
  })

  it('uses AI audio nodes only when models are detected', async () => {
    const deps = fakeDeps({ detectAudio: () => ({ aiSfx: true, aiMusic: false }) })
    const result = await createOneSentenceGame({ prompt: 'platformer' }, deps)
    expect(result.audioSource).toEqual({ sfx: 'ai', bgm: 'procedural' })
    const plan = deps.commit.mock.calls[0]![0].plan
    expect(plan.nodes.some((n: { typeId: string }) => n.typeId === 'asset.sfx')).toBe(true)
    expect(plan.nodes.some((n: { typeId: string }) => n.typeId === 'asset.music')).toBe(false)
  })

  it('falls back to procedural audio when detection throws, and surfaces scope notes', async () => {
    const deps = fakeDeps({
      detectAudio: () => {
        throw new Error('settings unavailable')
      }
    })
    const result = await createOneSentenceGame({ prompt: 'open world racing' }, deps)
    expect(result.ok).toBe(true)
    expect(result.audioSource).toEqual({ sfx: 'procedural', bgm: 'procedural' })
    expect(result.warnings.some((w) => w.startsWith('scope:'))).toBe(true)
  })

  it('rejects an empty prompt and reports commit failures', async () => {
    expect((await createOneSentenceGame({ prompt: '  ' }, fakeDeps())).ok).toBe(false)
    const failing = fakeDeps({
      commit: vi.fn(async () => ({
        ok: false,
        warnings: [],
        error: 'Open a project first'
      })) as never
    })
    const result = await createOneSentenceGame({ prompt: 'survivor' }, failing)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Open a project first')
    expect(failing.dispatchRun).not.toHaveBeenCalled()
  })
})

describe('detectOneSentenceGameAudio', () => {
  const base = {
    id: 'p',
    name: 'p',
    enabled: true,
    apiKey: 'k',
    baseUrl: '',
    modalities: {}
  }
  it('reports no AI audio when no capable provider is configured', () => {
    expect(detectOneSentenceGameAudio([])).toEqual({ aiSfx: false, aiMusic: false })
  })
  it('detects ElevenLabs as an SFX-capable provider', () => {
    const result = detectOneSentenceGameAudio([{ ...base, providerKind: 'elevenlabs' } as never])
    expect(result.aiSfx).toBe(true)
  })
  it('falls back to procedural when the configured provider is known to be out of quota / plan', () => {
    const result = detectOneSentenceGameAudio([{ ...base, providerKind: 'elevenlabs' } as never], {
      sfx: 'This request exceeds your quota of 10000'
    })
    expect(result.aiSfx).toBe(false)
    expect(result.notes?.[0]).toMatch(/quota/)
  })
})

describe('audioProviderHealth', () => {
  it('records only account-level failures, clears on success and expires', () => {
    resetAudioProviderHealth()
    expect(recordAudioProviderFailure('sfx', 'el-1', 'ETIMEDOUT socket hang up')).toBe(false)
    expect(audioProviderUnavailableReason('sfx')).toBeNull()

    expect(
      recordAudioProviderFailure(
        'music',
        'el-1',
        'Music API is not available for free users. Please upgrade to a paid plan to use the API.',
        1000
      )
    ).toBe(true)
    expect(audioProviderUnavailableReason('music', 2000)).toMatch(/free users/)
    // 6 小时后过期（用户可能已升级套餐）
    expect(audioProviderUnavailableReason('music', 1000 + 7 * 60 * 60 * 1000)).toBeNull()

    recordAudioProviderFailure('sfx', 'el-1', 'You have 0 credits remaining, exceeds your quota')
    recordAudioProviderSuccess('sfx', 'other-provider')
    expect(audioProviderUnavailableReason('sfx')).not.toBeNull()
    recordAudioProviderSuccess('sfx', 'el-1')
    expect(audioProviderUnavailableReason('sfx')).toBeNull()
  })

  it('surfaces audio fallback notes as tool warnings', async () => {
    const deps = fakeDeps({
      detectAudio: () => ({ aiSfx: false, aiMusic: false, notes: ['Music model unavailable'] })
    })
    const result = await createOneSentenceGame({ prompt: 'survivor' }, deps)
    expect(result.warnings).toContain('audio: Music model unavailable')
  })
})

describe('MCP access', () => {
  it('classifies game_one_sentence_create as a generate tool (gated in Plan / hidden in Ask)', () => {
    expect(toolAccessOf('game_one_sentence_create')).toBe('generate')
  })
})

describe('sandbox & UI suite contracts', () => {
  it('includes aiart:playable-lifecycle and visibilitychange auto-pause in compiled sandbox HTML', () => {
    const compiled = compilePlayableGameSandboxHtml({
      title: 'Lifecycle Test',
      mode: 'survivor',
      levelSeed: 42
    })
    expect(compiled.html).toContain('aiart:playable-lifecycle')
    expect(compiled.html).toContain('visibilitychange')
    expect(compiled.html).toContain('syncSandboxPaused')
    expect(compiled.html).toContain('cancelAnimationFrame(rafId)')
  })

  it('materializes a Genshin-style UI suite pipeline (ui.split -> ui.gen -> image.layerSplit) from a single sentence ("生成原神风格全套UI")', async () => {
    const prompt = '生成原神风格全套UI' // cjk-ok
    expect(isOneSentenceUiSuitePrompt(prompt)).toBe(true)
    expect(inferUiStylePresetFromPrompt(prompt)).toBe('celestial_star_gold')

    const deps = fakeDeps()
    const created = await createOneSentenceGame({ prompt }, deps)
    expect(created.ok).toBe(true)
    const plan = deps.commit.mock.calls[0]![0].plan
    const mat = materializeGraphPlan(plan)
    expect(mat.ok).toBe(true)
    expect(mat.warnings).toEqual([])

    const uiBuilt = buildUiSuiteGraphPlanFromPrompt(prompt)
    expect(uiBuilt.stylePreset).toBe('celestial_star_gold')
    expect(ONE_SENTENCE_UI_SUITE_NODE_KEYS.uiLayerSplit).toBe('ui_layer_split')

    const sysNodes = mat.document!.nodes.filter((n) => n.typeId === 'asset.gameSystem')
    const uiSplitNodes = mat.document!.nodes.filter((n) => n.typeId === 'ui.split')
    const uiGenNodes = mat.document!.nodes.filter((n) => n.typeId === 'ui.gen')
    const layerSplitNodes = mat.document!.nodes.filter((n) => n.typeId === 'image.layerSplit')

    expect(sysNodes).toHaveLength(1)
    expect(uiSplitNodes).toHaveLength(1)
    expect(uiGenNodes).toHaveLength(1)
    expect(layerSplitNodes).toHaveLength(1)

    expect(uiGenNodes[0]!.params.generateTransparentBg).toBe(true)
    expect(mat.document!.edges).toHaveLength(3)
  })
})
