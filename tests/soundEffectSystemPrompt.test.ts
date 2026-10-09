import { describe, expect, it } from 'vitest'
import { normalizeScopedGraph } from '../src/shared/graph/normalize'
import {
  DEFAULT_VOICE_SYSTEM_PROMPT_EN,
  DEFAULT_VOICE_SYSTEM_PROMPT_ZH,
  defaultSoundEffectSystemPrompt
} from '../src/shared/graph/systemPromptSchemes'
import {
  buildInstructionFinalPromptPreview,
  resolveInstructionFinalPreviewKind
} from '../src/shared/graph/execute/context'
import { ELEVEN_SOUND_MODEL } from '../src/shared/modelProviders/elevenlabs/voice'
import type { GraphDocument } from '../src/shared/graph'

/**
 * 声音相关节点（voice / dialogue / sfx / music）不使用系统提示词：
 * 端点把文本当朗读或描述内容；预览也不展示系统段。
 */
describe('声音相关节点无系统提示词', () => {
  it('音效节点解析到自己的预览种类，而不是「声音」', () => {
    expect(resolveInstructionFinalPreviewKind({ typeId: 'asset.sfx', assetType: 'voice' })).toBe(
      'soundEffect'
    )
    expect(
      resolveInstructionFinalPreviewKind({ typeId: 'asset.dialogue', assetType: 'voice' })
    ).toBe('voice')
    expect(resolveInstructionFinalPreviewKind({ typeId: 'asset.voice', assetType: 'voice' })).toBe(
      'voice'
    )
    expect(resolveInstructionFinalPreviewKind({ typeId: 'asset.music', assetType: 'voice' })).toBe(
      'voice'
    )
  })

  it('规范化时清空声音相关节点上残留的系统提示词', () => {
    for (const typeId of ['asset.sfx', 'asset.voice', 'asset.dialogue', 'asset.music'] as const) {
      for (const legacy of [
        DEFAULT_VOICE_SYSTEM_PROMPT_ZH,
        DEFAULT_VOICE_SYSTEM_PROMPT_EN,
        defaultSoundEffectSystemPrompt(),
        '用户自己写的规则'
      ]) {
        const doc: GraphDocument = {
          nodes: [
            {
              id: 'n1',
              typeId,
              category: 'asset',
              position: { x: 0, y: 0 },
              params: {
                ...(typeId === 'asset.sfx' ? { generateModel: ELEVEN_SOUND_MODEL } : {}),
                generateSystemPrompt: legacy
              },
              title: typeId
            }
          ],
          edges: [],
          groups: [],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
        const out = normalizeScopedGraph('canvasAsset', doc, {})
        expect(out.nodes[0]!.params?.generateSystemPrompt, typeId).toBe('')
      }
    }
  })

  it('音效预览只有用户段：无系统提示词区块，也不回落成剧本/配音模板', () => {
    const kind = resolveInstructionFinalPreviewKind({ typeId: 'asset.sfx', assetType: 'voice' })
    expect(kind).toBe('soundEffect')

    const withInstruction = buildInstructionFinalPromptPreview({
      kind,
      instructionRaw: '雨打铁皮屋顶，两秒，由远及近',
      sources: [],
      includeSystem: true,
      locale: 'zh-CN'
    })
    expect(withInstruction).toBe('雨打铁皮屋顶，两秒，由远及近')
    expect(withInstruction).not.toContain('系统提示词')
    expect(withInstruction).not.toContain('音效设计师')
    expect(withInstruction).not.toContain('声音导演')
    expect(withInstruction).not.toContain('剧本')

    const empty = buildInstructionFinalPromptPreview({
      kind,
      instructionRaw: '',
      sources: [],
      includeSystem: true,
      locale: 'zh-CN'
    })
    expect(empty).not.toContain('系统提示词')
    expect(empty).toContain('不要人声') // 音效的用户段兜底
  })

  it('声音节点预览同样不带系统提示词区块', () => {
    const preview = buildInstructionFinalPromptPreview({
      kind: 'voice',
      instructionRaw: '你好世界',
      sources: [],
      systemPrompt: DEFAULT_VOICE_SYSTEM_PROMPT_ZH,
      includeSystem: true,
      locale: 'zh-CN'
    })
    expect(preview).toBe('你好世界')
    expect(preview).not.toContain('系统提示词')
    expect(preview).not.toContain('声音导演')
  })
})
