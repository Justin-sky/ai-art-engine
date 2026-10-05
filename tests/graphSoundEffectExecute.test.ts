import { describe, expect, it, vi } from 'vitest'
import {
  executeSoundEffectNode,
  executeVoiceGenerateNode,
  type NodeExecuteContext
} from '../src/shared/graph'
import type { GraphNode } from '../src/shared/graph/types'

/**
 * 音效节点必须走**音效端点**，绝不能退回文本转语音。
 *
 * 踩过的坑：`executeSoundEffectNode` 原本在 `ctx.generateSoundEffect` 缺失时
 * `return executeVoiceGenerateNode(ctx)`，而节点 def 的 `execute` 就在这个函数上 ——
 * 结果音效节点把描述**念了一遍**，产出的是语音而不是音效。
 * 这种「静默回退到另一个能力」的做法必须由测试钉死。
 */
function sfxNode(partial?: Partial<GraphNode>): GraphNode {
  return {
    id: 'sfx-1',
    typeId: 'asset.sfx',
    category: 'asset',
    title: '音效生成',
    x: 0,
    y: 0,
    w: 160,
    h: 120,
    // assetType 与声音节点相同 —— 这正是它容易被误路由的原因
    assetType: 'voice',
    params: { generateInstruction: '雨落在铁皮屋顶上，远处有闷雷' },
    ...partial
  }
}

function ctxWith(node: GraphNode, overrides: Partial<NodeExecuteContext>): NodeExecuteContext {
  return {
    node,
    inputs: {},
    patchNode: vi.fn(),
    ...overrides
  }
}

describe('音效节点执行', () => {
  it('两者都可用时走音效端点，绝不调用 generateSpeech', async () => {
    const generateSoundEffect = vi.fn(async () => ({
      assetId: 'sfx-asset-1',
      relativePath: 'Cache/Sfx/sfx.mp3',
      model: 'eleven_text_to_sound_v2'
    }))
    const generateSpeech = vi.fn(async () => ({
      assetId: 'voice-1',
      relativePath: 'Cache/Voices/voice.mp3',
      model: 'eleven_v3',
      voice: 'v1'
    }))

    await executeSoundEffectNode(ctxWith(sfxNode(), { generateSoundEffect, generateSpeech }))

    expect(generateSoundEffect).toHaveBeenCalledTimes(1)
    // 这条是关键：退回 TTS 就是把音效描述念出来
    expect(generateSpeech).not.toHaveBeenCalled()
    // 描述原样发给音效端点；系统提示词绝不能拼进去（否则会进音频）
    expect(generateSoundEffect.mock.calls[0]![0]).toMatchObject({
      prompt: '雨落在铁皮屋顶上，远处有闷雷'
    })
  })

  it('把音效专用参数传给端点（循环 / 时长 / 影响力）', async () => {
    const generateSoundEffect = vi.fn(async () => ({
      assetId: 'sfx-2',
      relativePath: 'Cache/Sfx/sfx2.mp3',
      model: 'eleven_text_to_sound_v2'
    }))
    await executeSoundEffectNode(
      ctxWith(
        sfxNode({
          params: {
            generateInstruction: '脚步声',
            generateSoundLoop: true,
            generateSoundDurationSec: 4,
            generateSoundPromptInfluence: 0.6
          }
        }),
        { generateSoundEffect }
      )
    )
    expect(generateSoundEffect.mock.calls[0]![0]).toMatchObject({
      prompt: '脚步声',
      loop: true,
      durationSeconds: 4,
      promptInfluence: 0.6
    })
  })

  /**
   * 这条守卫比"行为正确"更重要：能力缺失时必须**明确失败**，
   * 而不是悄悄换一个能力产出错误结果。
   */
  it('没有音效能力时不静默退回 TTS', async () => {
    const generateSpeech = vi.fn(async () => ({
      assetId: 'voice-x',
      relativePath: 'Cache/Voices/x.mp3',
      model: 'eleven_v3',
      voice: 'v1'
    }))
    await expect(executeSoundEffectNode(ctxWith(sfxNode(), { generateSpeech }))).rejects.toThrow()
    expect(generateSpeech).not.toHaveBeenCalled()
  })

  it('空描述明确报错', async () => {
    const generateSoundEffect = vi.fn()
    await expect(
      executeSoundEffectNode(
        ctxWith(sfxNode({ params: { generateInstruction: '   ' } }), { generateSoundEffect })
      )
    ).rejects.toThrow(/GRAPH_PROCESS_NO_INPUT/)
    expect(generateSoundEffect).not.toHaveBeenCalled()
  })
})

describe('声音节点与音效节点互不串味', () => {
  it('纯声音节点仍然调 generateSpeech', async () => {
    const generateSpeech = vi.fn(async () => ({
      assetId: 'voice-2',
      relativePath: 'Cache/Voices/v2.mp3',
      model: 'eleven_v3',
      voice: 'v1'
    }))
    const generateSoundEffect = vi.fn()
    await executeVoiceGenerateNode(
      ctxWith(
        sfxNode({
          id: 'voice-1',
          typeId: 'asset.voice',
          params: { generateInstruction: '你好' }
        }),
        { generateSpeech, generateSoundEffect }
      )
    )
    expect(generateSpeech).toHaveBeenCalledTimes(1)
    expect(generateSoundEffect).not.toHaveBeenCalled()
  })
})
