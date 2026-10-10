import { describe, expect, it } from 'vitest'
import { pickTranscribeProvider } from '../src/shared/modelProvider'
import type { ModelProviderInstance, ModelProviderKind } from '../src/shared/modelProvider'

/**
 * 转写实例解析：**指定了就必须用它**，不能用时报错而不是偷偷换一家。
 *
 * 实测踩过：语义分析节点跑完，用户以为在用自己的实例，实际请求发去了另一家
 * （旧代码 `if (found && usable(found)) … else providers.find(usable)`）。
 */
function inst(
  id: string,
  providerKind: ModelProviderKind,
  patch: Partial<ModelProviderInstance> = {}
): ModelProviderInstance {
  return {
    id,
    providerKind,
    label: id,
    apiKey: 'sk-test',
    baseUrl: '',
    enabled: true,
    modalities: {},
    ...patch
  } as ModelProviderInstance
}

const supports = (kind: ModelProviderKind): boolean => kind === 'openai' || kind === 'elevenlabs'

describe('pickTranscribeProvider', () => {
  it('没指定实例：取第一个「启用 + 有 Key + 能转写」的实例', () => {
    const providers = [
      inst('a', 'deepseek'), // 不能转写
      inst('b', 'openai'),
      inst('c', 'elevenlabs')
    ]
    const picked = pickTranscribeProvider(providers, undefined, supports)
    expect('provider' in picked && picked.provider.id).toBe('b')
  })

  it('指定了能用的实例：就用它（哪怕不是第一个）', () => {
    const providers = [inst('b', 'openai'), inst('c', 'elevenlabs')]
    const picked = pickTranscribeProvider(providers, 'c', supports)
    expect('provider' in picked && picked.provider.id).toBe('c')
  })

  it('指定了停用的实例：报错，不偷偷换一家', () => {
    const providers = [inst('b', 'openai'), inst('c', 'elevenlabs', { enabled: false })]
    const picked = pickTranscribeProvider(providers, 'c', supports)
    expect('reason' in picked).toBe(true)
    expect('reason' in picked && picked.reason).toContain('instance disabled')
    // 关键：绝不能返回 b
    expect('provider' in picked).toBe(false)
  })

  it('指定了不支持转写的实例：报错，不偷偷换一家', () => {
    const providers = [inst('b', 'openai'), inst('x', 'deepseek')]
    const picked = pickTranscribeProvider(providers, 'x', supports)
    expect('reason' in picked && picked.reason).toContain('no transcribeAudio')
    expect('provider' in picked).toBe(false)
  })

  it('指定了没 Key 的实例：报错，不偷偷换一家', () => {
    const providers = [inst('b', 'openai'), inst('c', 'openai', { apiKey: '   ' })]
    const picked = pickTranscribeProvider(providers, 'c', supports)
    expect('reason' in picked).toBe(true)
    if ('reason' in picked) expect(picked.reason).toContain('missing api key')
    // 关键：绝不能返回 b
    expect('provider' in picked).toBe(false)
  })

  it('ElevenLabs 空 Key 仍算可用（目录公开可读，允许先配置后补 Key）', () => {
    const providers = [inst('e', 'elevenlabs', { apiKey: '   ' })]
    const picked = pickTranscribeProvider(providers, 'e', supports)
    expect('provider' in picked).toBe(true)
  })

  it('指定了不存在的实例：报错，不退化到别的实例', () => {
    const providers = [inst('b', 'openai')]
    const picked = pickTranscribeProvider(providers, 'nope', supports)
    expect('reason' in picked && picked.reason).toContain('instance not found')
    expect('provider' in picked).toBe(false)
  })

  it('没指定且没人能转写：给出原因', () => {
    const providers = [inst('a', 'deepseek'), inst('b', 'minimax', { enabled: false })]
    const picked = pickTranscribeProvider(providers, undefined, supports)
    expect('reason' in picked && picked.reason).toContain('no configured provider')
  })
})
