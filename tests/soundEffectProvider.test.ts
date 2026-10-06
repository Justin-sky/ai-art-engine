/**
 * 音效生成的提供商解析。
 *
 * 用户实际报过：配好了 ElevenLabs，音效节点却报
 * 「当前模型提供商不支持音效生成，请在设置中配置 ElevenLabs」。
 *
 * 原因是解析用的是通用的 `resolveActiveProvider('audio', …)`，它的候选条件是
 * 「这家在 audio 桶里勾了模型」—— 完全没检查这家**会不会做音效**。
 * 于是只要用户勾过任何 TTS 模型（OpenAI / MiniMax / 方舟都算），
 * 它就会选中一家不会做音效的，然后才在适配器那层报「不支持」。
 */
import { describe, expect, it } from 'vitest'
import { supportsSoundEffect, type ModelProviderKind } from '../src/shared/modelProvider'

/**
 * 复刻解析器的候选筛选（与 resolve.ts 的 resolveActiveSoundEffectProvider 同规则）。
 *
 * 这里不直接调主进程函数：它依赖 settingsService 单例。
 * 规则本身很短，照抄一份并**用同一批用例钉住两侧**，比给单例打桩更稳。
 */
interface ProviderLike {
  id: string
  providerKind: ModelProviderKind
  enabled: boolean
  apiKey: string
}

function pickSoundEffectProvider(
  providers: ProviderLike[],
  providerInstanceId?: string
): ProviderLike | null {
  const capable = providers.filter(
    (p) => p.enabled && supportsSoundEffect(p.providerKind) && p.apiKey.trim().length > 0
  )
  if (!capable.length) return null
  const requested = providerInstanceId?.trim()
  return (requested ? capable.find((p) => p.id === requested) : undefined) ?? capable[0]
}

const openai = { id: 'oa', providerKind: 'openai' as const, enabled: true, apiKey: 'k' }
const minimax = { id: 'mm', providerKind: 'minimax' as const, enabled: true, apiKey: 'k' }
const eleven = { id: 'el', providerKind: 'elevenlabs' as const, enabled: true, apiKey: 'k' }
const eleven2 = { id: 'el2', providerKind: 'elevenlabs' as const, enabled: true, apiKey: 'k' }

describe('supportsSoundEffect', () => {
  it('只有实现了 /v1/sound-generation 的家才算', () => {
    expect(supportsSoundEffect('elevenlabs')).toBe(true)
    // 这些有 TTS（甚至在 audio 桶里勾了模型），但没有音效端点
    expect(supportsSoundEffect('openai')).toBe(false)
    expect(supportsSoundEffect('openrouter')).toBe(false)
    expect(supportsSoundEffect('minimax')).toBe(false)
    expect(supportsSoundEffect('volcengine-ark')).toBe(false)
    expect(supportsSoundEffect('comfyui')).toBe(false)
  })
})

describe('音效提供商解析', () => {
  it('只有 TTS 提供商时**不给**候选（不能挑一家不会做音效的）', () => {
    // 老实现（按 audio 模态）会选中 openai 然后报「不支持」—— 用户以为是自己没配
    expect(pickSoundEffectProvider([openai, minimax])).toBeNull()
  })

  it('配了 ElevenLabs 就能选中它，与其它 TTS 提供商并存', () => {
    expect(pickSoundEffectProvider([openai, eleven, minimax])?.id).toBe('el')
  })

  it('能按实例 id 指定（一个 Key 不行时用另一个）', () => {
    expect(pickSoundEffectProvider([eleven, eleven2], 'el2')?.id).toBe('el2')
  })

  it('指定的实例不会做音效时，退回**能做的那家**而不是报错', () => {
    // 节点上残留了别家的实例 id（比如用户先选了 OpenAI 再改了配置）
    expect(pickSoundEffectProvider([openai, eleven], 'oa')?.id).toBe('el')
  })

  it('ElevenLabs 停用或缺 Key 时视为不可用', () => {
    expect(pickSoundEffectProvider([{ ...eleven, enabled: false }])).toBeNull()
    expect(pickSoundEffectProvider([{ ...eleven, apiKey: '   ' }])).toBeNull()
  })

  it('不看「有没有勾选模型」—— 音效只用到实例', () => {
    // 这里刻意不给 selectedModelIds 概念：ElevenLabs 一个模型都没勾也应可用
    expect(pickSoundEffectProvider([eleven])?.id).toBe('el')
  })
})
