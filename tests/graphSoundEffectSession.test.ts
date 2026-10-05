import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createNodeFromType, type GraphDocument } from '../src/shared/graph'
import { useGraphRunSession } from '../src/renderer/src/features/graph/controllers/useGraphRunSession'

/**
 * 音效能力必须能从 session 选项一路传到节点执行器。
 *
 * 这条是端到端的：用户报过「音效节点生成的是把描述念一遍的语音」，
 * 而当时执行器里有个静默回退 `!ctx.generateSoundEffect → executeVoiceGenerateNode`。
 * 只测执行器不够 —— 还要证明 session 把能力**注入**了，否则回退照样会触发。
 */
function buildGraph(): GraphDocument {
  const sfx = createNodeFromType(
    'asset.sfx',
    { x: 0, y: 0 },
    { params: { generateInstruction: '雨落在铁皮屋顶上' } }
  )
  return { nodes: [sfx], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

describe('音效能力的 session 注入', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('runNodeOnly 把 generateSoundEffect 传到执行器（不再退回 TTS）', async () => {
    const graph = buildGraph()
    const generateSoundEffect = vi.fn(async () => ({
      assetId: 'sfx-1',
      relativePath: 'Cache/Sfx/sfx.mp3',
      model: 'eleven_text_to_sound_v2'
    }))
    const generateSpeech = vi.fn(async () => ({
      assetId: 'voice-1',
      relativePath: 'Cache/Voices/v.mp3',
      model: 'eleven_v3',
      voice: 'v1'
    }))
    const session = useGraphRunSession({
      buildGraph: () => graph,
      commitLocal: () => undefined,
      t: (key: string) => key,
      generateSoundEffect,
      generateSpeech
    })

    const result = await session.runNodeOnly(graph.nodes[0]!.id)
    expect(result, '会话没有返回运行结果').toBeTruthy()

    expect(generateSoundEffect).toHaveBeenCalledTimes(1)
    // 退回 TTS 就是把音效描述念出来 —— 这条是本次回归的核心
    expect(generateSpeech).not.toHaveBeenCalled()
  })

  it('对照：同样的接线给 generateSpeech 时声音节点能拿到能力', async () => {
    const graph: GraphDocument = {
      nodes: [
        createNodeFromType(
          'asset.voice',
          { x: 0, y: 0 },
          { params: { generateInstruction: '你好', generateSpeechVoice: 'v1' } }
        )
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const generateSpeech = vi.fn(async () => ({
      assetId: 'voice-1',
      relativePath: 'Cache/Voices/v.mp3',
      model: 'eleven_v3',
      voice: 'v1'
    }))
    const session = useGraphRunSession({
      buildGraph: () => graph,
      commitLocal: () => undefined,
      t: (key: string) => key,
      generateSpeech
    })

    const result = await session.runNodeOnly(graph.nodes[0]!.id)
    // 若这条也失败，说明问题在「session 传能力」的通用机制，而不在音效这一处
    expect(generateSpeech, JSON.stringify(result)).toHaveBeenCalledTimes(1)
  })

  it('session 没拿到音效能力时明确报错，不产出语音', async () => {
    const graph = buildGraph()
    const generateSpeech = vi.fn(async () => ({
      assetId: 'voice-1',
      relativePath: 'Cache/Voices/v.mp3',
      model: 'eleven_v3',
      voice: 'v1'
    }))
    const session = useGraphRunSession({
      buildGraph: () => graph,
      commitLocal: () => undefined,
      t: (key: string) => key,
      generateSpeech
    })

    const result = await session.runNodeOnly(graph.nodes[0]!.id)

    // 不再静默退回：宁可失败得清楚，也不要悄悄产出错误产物
    expect(generateSpeech).not.toHaveBeenCalled()
    expect(result?.ok).toBe(false)
    const states = Object.values(result?.states ?? {})
    expect(states[0]?.status).toBe('error')
    expect(String(states[0]?.error ?? '')).toMatch(/音效|sound/i)
  })
})
