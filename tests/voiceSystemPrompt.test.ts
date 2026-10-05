import { describe, expect, it, vi } from 'vitest'
import { executeVoiceGenerateNode, type NodeExecuteContext } from '../src/shared/graph'
import { DEFAULT_VOICE_SYSTEM_PROMPT_EN } from '../src/shared/graph/systemPromptSchemes'
import type { GraphNode } from '../src/shared/graph/types'

function voiceNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'audio-sys-1',
    typeId: 'asset.voice',
    category: 'asset',
    title: '声音生成',
    x: 0,
    y: 0,
    w: 160,
    h: 120,
    params: { generateInstruction: '生成鸟叫声音', ...params }
  }
}

function ctxFor(node: GraphNode): { ctx: NodeExecuteContext; sent: () => string } {
  let sent = ''
  const ctx: NodeExecuteContext = {
    node,
    inputs: {},
    patchNode: vi.fn(),
    generateSpeech: async (input) => {
      sent = input.input
      return { assetId: 'v1', relativePath: 'Cache/Voices/a.mp3', model: 'tts-1', voice: 'alloy' }
    }
  }
  return { ctx, sent: () => sent }
}

/**
 * 声音节点的 input 是「要被合成的内容」，不是给对话模型的指令。
 *
 * 踩过的坑：声音节点默认系统提示词是「你是一名专业声音导演。请产出清晰自然的配音或
 * 声音设计说明…」，它被拼在 input 最前面一起发给了 TTS ——
 * OpenAI 兼容的 `POST /audio/speech` 会把 `input` 整段朗读，
 * 于是音频开头多出一段与内容无关的指令；ComfyUI / 方舟 openspeech / MiniMax
 * 也都是把 `input` 原样当内容（prompt / text_prompt）用。
 */
describe('声音生成不把系统提示词拼进朗读内容', () => {
  it('默认情况下：发给 TTS 的就是用户指令本身', async () => {
    const { ctx, sent } = ctxFor(voiceNode())
    await executeVoiceGenerateNode(ctx)
    expect(sent()).toBe('生成鸟叫声音')
  })

  it('即使节点上存了系统提示词，也不进朗读内容', async () => {
    // 旧节点里可能残留这句默认文案（或用户自己改过的）
    const { ctx, sent } = ctxFor(
      voiceNode({ generateSystemPrompt: DEFAULT_VOICE_SYSTEM_PROMPT_EN })
    )
    await executeVoiceGenerateNode(ctx)
    expect(sent()).not.toContain('professional audio')
    expect(sent()).toBe('生成鸟叫声音')
  })

  it('上游文本仍然会拼进来（那是要念的内容，与系统提示词不同）', async () => {
    const node = voiceNode()
    let sent = ''
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        'in-text': [{ kind: 'text', text: '第一段。第二段。' }]
      },
      patchNode: vi.fn(),
      generateSpeech: async (input) => {
        sent = input.input
        return { assetId: 'v1', relativePath: 'Cache/Voices/a.mp3', model: 'tts-1', voice: 'alloy' }
      }
    }
    await executeVoiceGenerateNode(ctx)
    expect(sent).toContain('生成鸟叫声音')
    expect(sent).toContain('第一段。第二段。')
  })

  it('指令为空时走默认用户提示词（不是系统提示词）', async () => {
    const { ctx, sent } = ctxFor(voiceNode({ generateInstruction: '' }))
    await executeVoiceGenerateNode(ctx)
    expect(sent()).not.toContain('professional audio')
    expect(sent().trim().length).toBeGreaterThan(0)
  })
})
