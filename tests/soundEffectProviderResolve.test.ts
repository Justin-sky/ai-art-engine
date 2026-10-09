import { describe, expect, it, vi } from 'vitest'

/**
 * 音效解析必须返回**固定的音效模型**，不能回落到语音 / TTS 桶。
 *
 * 这是「音效生成变成 TTS」的**源头**：旧实现读 `modalityConfig(picked, 'audio')`，
 * 而 `audio` 桶里放的是 `eleven_v4`、`microsoft/mai-voice-2.1-flash` 这类语音模型 ——
 * 于是音效节点被写上语音模型名（用户工程里实测就是 `generateModel: "eleven_v4"`）。
 *
 * 用替身注入一个「audio 桶默认是 TTS 模型」的设置，直接断言解析结果。
 */
const settings = {
  models: {
    providers: [
      {
        id: 'el-1',
        name: 'ElevenLabs',
        providerKind: 'elevenlabs' as const,
        enabled: true,
        apiKey: 'sk-test',
        baseUrl: 'https://api.elevenlabs.io',
        modalities: {
          audio: {
            defaultModelId: 'eleven_v4',
            selectedModelIds: ['eleven_v4', 'eleven_multilingual_v2'],
            catalog: []
          },
          // sfx 桶故意不写：解析必须退回固定音效模型，绝不能读到上面的 TTS
          sfx: {
            defaultModelId: '',
            selectedModelIds: [],
            catalog: []
          }
        }
      },
      {
        id: 'or-1',
        name: 'OpenRouter',
        providerKind: 'openrouter' as const,
        enabled: true,
        apiKey: 'sk-test',
        baseUrl: 'https://openrouter.ai/api/v1',
        modalities: {
          audio: {
            defaultModelId: 'microsoft/mai-voice-2.1-flash',
            selectedModelIds: ['microsoft/mai-voice-2.1-flash'],
            catalog: []
          }
        }
      }
    ]
  }
}

vi.mock('../src/main/services/settingsService', () => ({
  settingsService: { get: () => settings }
}))

const { resolveActiveSoundEffectProvider } =
  await import('../src/main/services/modelProviders/resolve')
const { ELEVEN_SOUND_MODEL } = await import('../src/shared/modelProviders/elevenlabs/voice')

describe('音效提供商解析', () => {
  it('返回固定音效模型，而不是 audio 桶里的 TTS 模型', () => {
    const { provider, modelId } = resolveActiveSoundEffectProvider()
    expect(provider.providerKind).toBe('elevenlabs')
    expect(modelId).toBe(ELEVEN_SOUND_MODEL)
    expect(modelId).not.toBe('eleven_v4')
    expect(modelId).not.toContain('mai-voice')
  })

  it('指定了非音效能力的实例时不会退化到别家（也不会带回 TTS 模型）', () => {
    // OpenRouter 不做音效：给了它的 id，仍应落在能做音效的 ElevenLabs 上
    const { provider, modelId } = resolveActiveSoundEffectProvider('or-1')
    expect(provider.providerKind).toBe('elevenlabs')
    expect(modelId).toBe(ELEVEN_SOUND_MODEL)
  })

  it('显式指定 ElevenLabs 实例时用它，并给出固定模型', () => {
    const { provider, modelId } = resolveActiveSoundEffectProvider('el-1')
    expect(provider.id).toBe('el-1')
    expect(modelId).toBe(ELEVEN_SOUND_MODEL)
  })
})
