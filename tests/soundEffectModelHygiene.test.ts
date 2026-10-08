import { describe, expect, it } from 'vitest'
import { normalizeScopedGraph } from '../src/shared/graph/normalize'
import { ELEVEN_SOUND_MODEL } from '../src/shared/modelProviders/elevenlabs/voice'
import type { GraphDocument } from '../src/shared/graph'

/**
 * 音效节点上的**语音模型残留**必须被纠正。
 *
 * 用户真实反馈：「音效生成怎么又变成 tts 了」。原因：旧版解析从 `audio`（语音/TTS）桶
 * 取默认模型，于是音效节点被写上 `eleven_v4` / `microsoft/mai-voice-2.1-flash` 这类
 * **语音模型**（工程里实测就有 `generateModel: "eleven_v4"`）。
 *
 * 规范化在打开图时把它们纠回固定的音效模型，工程自愈、不必手改 JSON。
 */

const MODEL = ELEVEN_SOUND_MODEL

function graphWith(params: Record<string, unknown>, typeId = 'asset.sfx'): GraphDocument {
  return {
    nodes: [
      {
        id: 'node-sfx',
        typeId,
        category: 'asset',
        position: { x: 0, y: 0 },
        params: { ...params },
        title: '音效生成'
      }
    ],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

function normalize(raw: GraphDocument): GraphDocument {
  // canvas 资产的 scope id 是 `canvasAsset`（见 scopes.ts）
  return normalizeScopedGraph('canvasAsset', raw, {})
}

describe('音效节点的模型纠正', () => {
  it('把残留的语音模型（eleven_v4）纠成固定音效模型', () => {
    const out = normalize(graphWith({ generateModel: 'eleven_v4' }))
    expect(out.nodes[0]!.params?.generateModel).toBe(MODEL)
  })

  it('把方舟/微软那类语音模型也纠过来（不是只认一个字符串）', () => {
    for (const stale of [
      'microsoft/mai-voice-2.1-flash',
      'eleven_multilingual_v2',
      'gpt-4o-audio'
    ]) {
      const out = normalize(graphWith({ generateModel: stale }))
      expect(out.nodes[0]!.params?.generateModel, `残留 ${stale} 未被纠正`).toBe(MODEL)
    }
  })

  it('空模型也补成固定值（音效本来就没有可选项）', () => {
    const out = normalize(graphWith({ generateModel: '' }))
    expect(out.nodes[0]!.params?.generateModel).toBe(MODEL)
  })

  it('已经是固定音效模型时保持原对象（不做无谓改写）', () => {
    const raw = graphWith({ generateModel: MODEL })
    const out = normalize(raw)
    expect(out.nodes[0]!.params?.generateModel).toBe(MODEL)
  })

  it('**只碰音效节点**：声音/音乐等节点的模型一律不动', () => {
    const raw: GraphDocument = {
      nodes: [
        {
          id: 'node-voice',
          typeId: 'asset.dialogue',
          category: 'asset',
          position: { x: 0, y: 0 },
          params: { generateModel: 'eleven_v4' },
          title: '声音'
        },
        {
          id: 'node-music',
          typeId: 'asset.music',
          category: 'asset',
          position: { x: 0, y: 0 },
          params: { generateModel: 'music_v2_5' },
          title: '音乐'
        }
      ],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const out = normalize(raw)
    const byId = new Map(out.nodes.map((n) => [n.id, n]))
    expect(byId.get('node-voice')!.params?.generateModel).toBe('eleven_v4')
    expect(byId.get('node-music')!.params?.generateModel).toBe('music_v2_5')
  })

  it('纠正后其它参数原样保留（不能顺手把用户的音效参数弄丢）', () => {
    const out = normalize(
      graphWith({
        generateModel: 'eleven_v4',
        generateSoundDurationSec: 3,
        generateSoundLoop: true,
        generateSoundPromptInfluence: 0.4,
        text: '雨声'
      })
    )
    const params = out.nodes[0]!.params as Record<string, unknown>
    expect(params.generateModel).toBe(MODEL)
    expect(params.generateSoundDurationSec).toBe(3)
    expect(params.generateSoundLoop).toBe(true)
    expect(params.generateSoundPromptInfluence).toBe(0.4)
    expect(params.text).toBe('雨声')
  })
})
