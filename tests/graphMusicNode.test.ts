import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  createNodeFromType,
  executeMusicGenerateNode,
  executeSoundEffectNode,
  type GraphDocument,
  type NodeExecuteContext
} from '../src/shared/graph'
import {
  createEmptyModalityMap,
  createEmptyModelsSettings,
  normalizeModelsSettings,
  supportsMusicModality
} from '../src/shared/modelProvider'
import { useGraphRunSession } from '../src/renderer/src/features/graph/controllers/useGraphRunSession'
import {
  listMiniMaxCatalogModels,
  resolveMiniMaxModelCapabilities
} from '../src/shared/modelProviders/minimax/modelCapabilities'
import { listDashScopeCatalogModels } from '../src/shared/modelProviders/dashscope/modelCapabilities'

/**
 * 音乐生成：模态 + 节点。
 *
 * 这条链路与音效节点同构，而音效节点此前连踩三个坑（模型透传坏值 → 静默回退 TTS
 * → 能力没进引擎白名单）。所以这里**同时**测执行器与端到端 session，
 * 并用对照例区分「接线错了」与「能力压根没传」。
 */
function musicNode(partial?: Record<string, unknown>): ReturnType<typeof createNodeFromType> {
  return createNodeFromType(
    'asset.music',
    { x: 0, y: 0 },
    { params: { generateInstruction: '轻快的电子配乐', ...partial } }
  )
}

function ctxWith(
  node: ReturnType<typeof createNodeFromType>,
  overrides: Partial<NodeExecuteContext>
): NodeExecuteContext {
  return { node, inputs: {}, patchNode: vi.fn(), ...overrides }
}

describe('音乐模态', () => {
  it('谁支持音乐生成（与「声音」的 TTS 分开）', () => {
    const kind = (value: string) => value as Parameters<typeof supportsMusicModality>[0]
    expect(supportsMusicModality(kind('elevenlabs'))).toBe(true)
    expect(supportsMusicModality(kind('minimax'))).toBe(true)
    expect(supportsMusicModality(kind('dashscope'))).toBe(true)
    // OpenAI 有 TTS 但没有音乐端点 —— 两个模态必须能区分开
    expect(supportsMusicModality(kind('openai'))).toBe(false)
    expect(supportsMusicModality(kind('openrouter'))).toBe(false)
  })

  it('音乐模型已从 audio 迁到 music 模态（否则音乐页签会是空的）', () => {
    const miniMaxMusic = listMiniMaxCatalogModels('music').map((m) => m.id)
    expect(miniMaxMusic).toContain('music-3.0')
    expect(miniMaxMusic).toContain('music-2.6')
    // 迁走之后不该再出现在声音页签
    expect(listMiniMaxCatalogModels('audio').map((m) => m.id)).not.toContain('music-3.0')

    const dashMusic = listDashScopeCatalogModels('music').map((m) => m.id)
    expect(dashMusic).toEqual(['fun-music-v1', 'fun-music-preview'])
    expect(listDashScopeCatalogModels('audio').map((m) => m.id)).not.toContain('fun-music-v1')
  })

  it('音乐模型的能力档仍能解析（模态改名不丢参数）', () => {
    expect(resolveMiniMaxModelCapabilities('music-3.0', 'music')).toBeTruthy()
    // 启发式分支也要认得 music
    expect(resolveMiniMaxModelCapabilities('music-future-9', 'music')).toBeTruthy()
  })

  it('createEmptyModalityMap 带上 music 桶', () => {
    expect(createEmptyModalityMap().music).toEqual({ selectedModelIds: [], defaultModelId: '' })
  })

  it('旧设置里勾在 audio 桶的音乐模型会迁到 music 桶（不让用户以为选择丢了）', () => {
    const settings = createEmptyModelsSettings()
    // 模拟升级前落盘的数据：music 拆出去之前，音乐模型借用 audio 模态
    const legacy = {
      providers: [
        {
          id: 'mm-1',
          providerKind: 'minimax',
          label: 'MiniMax',
          apiKey: 'k',
          baseUrl: 'https://api.minimaxi.com',
          enabled: true,
          modalities: {
            audio: {
              selectedModelIds: ['music-3.0', 'voice-design'],
              defaultModelId: 'music-3.0'
            }
          }
        }
      ]
    }
    // normalizeModelsSettings 是读盘入口，迁移逻辑就在这里
    const normalized = normalizeModelsSettings(legacy)
    const provider = normalized.providers[0]!
    expect(provider.modalities.music.selectedModelIds).toEqual(['music-3.0'])
    expect(provider.modalities.music.defaultModelId).toBe('music-3.0')
    // 音乐模型**故意留在** audio 桶里：万一它是用户特意在声音页签勾的，
    // 移除会让它彻底不可选；留在两处无害（声音节点的目录按 TTS 类别过滤，
    // 不依赖勾选项），所以这里只断言原来的选择没被动过
    expect(provider.modalities.audio.selectedModelIds).toEqual(['music-3.0', 'voice-design'])
    expect(settings.providers).toEqual([])
  })
})

describe('音乐生成节点执行', () => {
  it('调 generateMusic，且不碰 generateSpeech / generateSoundEffect', async () => {
    const generateMusic = vi.fn(async () => ({
      assetId: 'music-1',
      relativePath: 'Cache/Music/bgm.mp3',
      model: 'music_v2_5'
    }))
    const generateSpeech = vi.fn()
    const generateSoundEffect = vi.fn()

    await executeMusicGenerateNode(
      ctxWith(musicNode(), { generateMusic, generateSpeech, generateSoundEffect })
    )

    expect(generateMusic).toHaveBeenCalledTimes(1)
    // 换能力产出错误产物是本项目踩过的坑，这里三条互不串味
    expect(generateSpeech).not.toHaveBeenCalled()
    expect(generateSoundEffect).not.toHaveBeenCalled()
    expect(generateMusic.mock.calls[0]![0]).toMatchObject({
      prompt: '轻快的电子配乐',
      instrumental: true
    })
  })

  it('歌词与纯音乐开关透传（歌词为空时不传该字段）', async () => {
    const generateMusic = vi.fn(async () => ({
      assetId: 'm',
      relativePath: 'Cache/Music/m.mp3',
      model: 'music_v2_5'
    }))
    await executeMusicGenerateNode(
      ctxWith(
        musicNode({ generateMusicLyrics: '  第一句\n第二句  ', generateMusicInstrumental: false }),
        { generateMusic }
      )
    )
    expect(generateMusic.mock.calls[0]![0]).toMatchObject({
      lyrics: '第一句\n第二句',
      instrumental: false
    })

    generateMusic.mockClear()
    await executeMusicGenerateNode(ctxWith(musicNode(), { generateMusic }))
    expect(generateMusic.mock.calls[0]![0]).not.toHaveProperty('lyrics')
  })

  it('没有音乐能力时明确报错，不换成其它能力', async () => {
    const generateSpeech = vi.fn()
    await expect(
      executeMusicGenerateNode(ctxWith(musicNode(), { generateSpeech }))
    ).rejects.toThrow(/音乐生成/)
    expect(generateSpeech).not.toHaveBeenCalled()
  })

  it('空描述明确报错', async () => {
    const generateMusic = vi.fn()
    await expect(
      executeMusicGenerateNode(
        ctxWith(musicNode({ generateInstruction: '   ' }), { generateMusic })
      )
    ).rejects.toThrow(/描述/)
    expect(generateMusic).not.toHaveBeenCalled()
  })

  it('音效与音乐节点不互相串味', async () => {
    const generateMusic = vi.fn()
    const generateSoundEffect = vi.fn(async () => ({
      assetId: 's',
      relativePath: 'Cache/Sfx/s.mp3',
      model: 'eleven_text_to_sound_v2'
    }))
    await executeSoundEffectNode(
      ctxWith(
        createNodeFromType(
          'asset.sfx',
          { x: 0, y: 0 },
          { params: { generateInstruction: '雨声' } }
        ),
        {
          generateMusic,
          generateSoundEffect
        }
      )
    )
    expect(generateSoundEffect).toHaveBeenCalledTimes(1)
    expect(generateMusic).not.toHaveBeenCalled()
  })
})

/**
 * 端到端：能力必须穿过 session → wrapper → runGraph → **引擎白名单** 四层。
 * 音效节点就是栽在最后一层（session 接线正确但引擎没转发），
 * 所以音乐这条必须用同样的方式守住。
 */
describe('音乐能力的 session 注入（端到端）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function sessionFor(graph: GraphDocument, options: Record<string, unknown>) {
    return useGraphRunSession({
      buildGraph: () => graph,
      commitLocal: () => undefined,
      t: (key: string) => key,
      ...options
    })
  }

  it('runNodeOnly 把 generateMusic 传到执行器', async () => {
    const node = musicNode()
    const graph: GraphDocument = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const generateMusic = vi.fn(async () => ({
      assetId: 'm1',
      relativePath: 'Cache/Music/m1.mp3',
      model: 'music_v2_5'
    }))
    const generateSpeech = vi.fn()

    const result = await sessionFor(graph, { generateMusic, generateSpeech }).runNodeOnly(node.id)

    expect(result, '会话没有返回运行结果').toBeTruthy()
    expect(generateMusic).toHaveBeenCalledTimes(1)
    expect(generateSpeech).not.toHaveBeenCalled()
  })

  it('session 没拿到音乐能力时明确报错（引擎白名单漏转发会在这里暴露）', async () => {
    const node = musicNode()
    const graph: GraphDocument = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const result = await sessionFor(graph, {}).runNodeOnly(node.id)

    expect(result?.ok).toBe(false)
    const states = Object.values(result?.states ?? {})
    expect(states[0]?.status).toBe('error')
    expect(String(states[0]?.error ?? '')).toMatch(/音乐生成/)
  })
})
