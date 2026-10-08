import { describe, expect, it } from 'vitest'
import { normalizeScopedGraph } from '../src/shared/graph/normalize'
import {
  DEFAULT_VOICE_SYSTEM_PROMPT_EN,
  DEFAULT_VOICE_SYSTEM_PROMPT_ZH,
  defaultSoundEffectSystemPrompt,
  resolveSoundEffectSystemPrompt
} from '../src/shared/graph/systemPromptSchemes'
import {
  buildInstructionFinalPromptPreview,
  resolveInstructionFinalPreviewKind
} from '../src/shared/graph/execute/context'
import { ELEVEN_SOUND_MODEL } from '../src/shared/modelProviders/elevenlabs/voice'
import type { GraphDocument } from '../src/shared/graph'

/**
 * 「音效生成的系统提示词不正确」。
 *
 * 根因：`asset.sfx` 节点的 `assetType` 就是 `voice`（产物是声音资产），于是预览种类解析
 * 落到 `voice` 分支，拿到的是**配音**口径的系统提示词（「专业声音导演…匹配语气、节奏与
 * 角色气质」）——而音效走 ElevenLabs `/v1/sound-generation`，只吃**非人声**的声音描述。
 *
 * 三层都要对：① 解析出的种类是音效自己的；② 那条提示词本身是音效口径；③ 工程里已经
 * 被灌成旧配音文案的节点，在规范化时被迁移过来（用户自己改过的句子必须保留）。
 */
describe('音效生成的系统提示词', () => {
  it('音效节点解析到自己的预览种类，而不是「声音」', () => {
    expect(resolveInstructionFinalPreviewKind({ typeId: 'asset.sfx', assetType: 'voice' })).toBe(
      'soundEffect'
    )
    // 声音节点仍然走 voice
    expect(
      resolveInstructionFinalPreviewKind({ typeId: 'asset.dialogue', assetType: 'voice' })
    ).toBe('voice')
    expect(resolveInstructionFinalPreviewKind({ typeId: 'asset.voice', assetType: 'voice' })).toBe(
      'voice'
    )
  })

  it('默认提示词是音效口径：只描述非人声事件，明确禁止台词/配音/音乐', () => {
    const zh = defaultSoundEffectSystemPrompt('zh-CN')
    expect(zh).toContain('音效设计师')
    expect(zh).toContain('非人声')
    expect(zh).not.toContain('配音或声音设计说明') // 旧配音口径的特征句
    for (const banned of ['不要写台词', '配音', '音乐编排']) expect(zh).toContain(banned)

    const en = defaultSoundEffectSystemPrompt('en-US')
    expect(en).toContain('sound designer')
    expect(en).toContain('non-speech')
  })

  it('resolve 只在空值时给默认，用户写过的原样保留', () => {
    expect(resolveSoundEffectSystemPrompt('', 'zh-CN')).toBe(
      defaultSoundEffectSystemPrompt('zh-CN')
    )
    expect(resolveSoundEffectSystemPrompt(undefined, 'zh-CN')).toBe(
      defaultSoundEffectSystemPrompt('zh-CN')
    )
    expect(resolveSoundEffectSystemPrompt('我自己的音效规则', 'zh-CN')).toBe('我自己的音效规则')
  })

  it('旧的配音提示词（中/英两条原文）会在规范化时迁移成音效口径', () => {
    for (const legacy of [DEFAULT_VOICE_SYSTEM_PROMPT_ZH, DEFAULT_VOICE_SYSTEM_PROMPT_EN]) {
      const doc: GraphDocument = {
        nodes: [
          {
            id: 'sfx',
            typeId: 'asset.sfx',
            category: 'asset',
            position: { x: 0, y: 0 },
            params: { generateModel: ELEVEN_SOUND_MODEL, generateSystemPrompt: legacy },
            title: '音效生成'
          }
        ],
        edges: [],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      }
      const out = normalizeScopedGraph('canvasAsset', doc, {})
      expect(out.nodes[0]!.params?.generateSystemPrompt).toBe(defaultSoundEffectSystemPrompt())
    }
  })

  it('用户自己写过的音效提示词不会被规范化改掉', () => {
    const custom = '只描述雨声，2 秒，不要人声'
    const doc: GraphDocument = {
      nodes: [
        {
          id: 'sfx',
          typeId: 'asset.sfx',
          category: 'asset',
          position: { x: 0, y: 0 },
          params: { generateModel: ELEVEN_SOUND_MODEL, generateSystemPrompt: custom },
          title: '音效生成'
        }
      ],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const out = normalizeScopedGraph('canvasAsset', doc, {})
    expect(out.nodes[0]!.params?.generateSystemPrompt).toBe(custom)
  })

  it('声音节点的配音提示词不受影响（迁移只认音效节点）', () => {
    const doc: GraphDocument = {
      nodes: [
        {
          id: 'voice',
          typeId: 'asset.dialogue',
          category: 'asset',
          position: { x: 0, y: 0 },
          params: { generateSystemPrompt: DEFAULT_VOICE_SYSTEM_PROMPT_ZH },
          title: '声音'
        }
      ],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const out = normalizeScopedGraph('canvasAsset', doc, {})
    expect(out.nodes[0]!.params?.generateSystemPrompt).toBe(DEFAULT_VOICE_SYSTEM_PROMPT_ZH)
  })

  /**
   * 端到端：节点 → 预览种类 → 最终提示词（系统段 + 用户段）。
   *
   * 用户段也要单独断言：音效种类若漏了 `case`，switch 的 default 会落到**剧本**模板 ——
   * 那比原来的配音模板更离谱（这是我在补这条时差点引入的回归）。
   */
  it('音效节点的最终预览：系统段是音效口径，用户段不是剧本/配音模板', () => {
    const kind = resolveInstructionFinalPreviewKind({ typeId: 'asset.sfx', assetType: 'voice' })
    expect(kind).toBe('soundEffect')

    const withInstruction = buildInstructionFinalPromptPreview({
      kind,
      instructionRaw: '雨打铁皮屋顶，两秒，由远及近',
      sources: [],
      includeSystem: true,
      locale: 'zh-CN'
    })
    expect(withInstruction).toContain('音效设计师')
    expect(withInstruction).toContain('雨打铁皮屋顶，两秒，由远及近')
    expect(withInstruction).not.toContain('剧本')
    expect(withInstruction).not.toContain('声音导演')

    const empty = buildInstructionFinalPromptPreview({
      kind,
      instructionRaw: '',
      sources: [],
      includeSystem: true,
      locale: 'zh-CN'
    })
    expect(empty).toContain('不要人声') // 音效的用户段兜底
  })
})
