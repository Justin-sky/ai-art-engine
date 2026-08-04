import { describe, expect, it } from 'vitest'
import {
  classifyVolcengineArkModelModality,
  createEmptyModelsSettings,
  createProviderInstance,
  findProviderById,
  isKlingProvider,
  isMiniMaxProvider,
  isVolcengineArkProvider,
  DASHSCOPE_DEFAULT_BASE_URL,
  isDashScopeProvider,
  isModelScopeProvider,
  KLING_DEFAULT_BASE_URL,
  MINIMAX_DEFAULT_BASE_URL,
  MODELSCOPE_DEFAULT_BASE_URL,
  normalizeModelsSettings,
  pickActiveProvider,
  VOLCENGINE_ARK_DEFAULT_BASE_URL
} from '../src/shared/modelProvider'

describe('normalizeModelsSettings', () => {
  it('normalizes providers list', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'p1',
          providerKind: 'openrouter',
          label: 'OR',
          apiKey: 'sk-test',
          baseUrl: 'https://openrouter.ai/api/v1',
          enabled: true,
          modalities: {
            text: { selectedModelIds: ['a'], defaultModelId: 'a' },
            image: { selectedModelIds: [], defaultModelId: '' },
            video: { selectedModelIds: [], defaultModelId: '' },
            audio: { selectedModelIds: [], defaultModelId: '' }
          }
        }
      ]
    })
    expect(next.providers).toHaveLength(1)
    expect(next.providers[0].modalities.text.selectedModelIds).toEqual(['a'])
  })

  it('persists video catalog capabilities including supported_frame_images', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'p1',
          providerKind: 'openrouter',
          apiKey: 'sk',
          modalities: {
            video: {
              selectedModelIds: ['bytedance/seedance-2.0'],
              defaultModelId: 'bytedance/seedance-2.0',
              catalog: {
                'bytedance/seedance-2.0': {
                  id: 'bytedance/seedance-2.0',
                  name: 'Seedance 2.0',
                  capabilities: {
                    supported_resolutions: ['720p', '1080p'],
                    supported_frame_images: ['first_frame', 'last_frame']
                  }
                },
                orphan: {
                  id: 'orphan',
                  name: 'gone',
                  capabilities: { supported_resolutions: ['480p'] }
                }
              }
            }
          }
        }
      ]
    })
    const video = next.providers[0].modalities.video
    expect(video.catalog?.['bytedance/seedance-2.0']?.capabilities).toEqual({
      supported_resolutions: ['720p', '1080p'],
      supported_frame_images: ['first_frame', 'last_frame']
    })
    expect(video.catalog?.orphan).toBeUndefined()
  })

  it('keeps volcengine-ark provider kind and default base url', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'ark1',
          providerKind: 'volcengine-ark',
          label: '',
          apiKey: 'ark-key',
          baseUrl: '',
          enabled: true
        }
      ]
    })
    expect(next.providers[0].providerKind).toBe('volcengine-ark')
    expect(next.providers[0].label).toBe('火山方舟')
    expect(next.providers[0].baseUrl).toBe(VOLCENGINE_ARK_DEFAULT_BASE_URL)
  })

  it('keeps kling provider kind and default base url', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'kling1',
          providerKind: 'kling',
          label: '',
          apiKey: 'ak',
          baseUrl: '',
          enabled: true
        }
      ]
    })
    expect(next.providers[0].providerKind).toBe('kling')
    expect(next.providers[0].label).toBe('可灵')
    expect(next.providers[0].baseUrl).toBe(KLING_DEFAULT_BASE_URL)
    expect(isKlingProvider(next.providers[0])).toBe(true)
  })

  it('keeps minimax provider kind and default base url', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'mm1',
          providerKind: 'minimax',
          label: '',
          apiKey: 'mm-key',
          baseUrl: '',
          enabled: true
        }
      ]
    })
    expect(next.providers[0].providerKind).toBe('minimax')
    expect(next.providers[0].label).toBe('MiniMax')
    expect(next.providers[0].baseUrl).toBe(MINIMAX_DEFAULT_BASE_URL)
    expect(isMiniMaxProvider(next.providers[0])).toBe(true)
  })

  it('keeps dashscope provider kind and default base url', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'ds1',
          providerKind: 'dashscope',
          label: '',
          apiKey: 'sk-ds',
          baseUrl: '',
          enabled: true
        }
      ]
    })
    expect(next.providers[0].providerKind).toBe('dashscope')
    expect(next.providers[0].label).toBe('通义千问')
    expect(next.providers[0].baseUrl).toBe(DASHSCOPE_DEFAULT_BASE_URL)
    expect(isDashScopeProvider(next.providers[0])).toBe(true)
  })

  it('keeps modelscope provider kind and default base url', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'ms1',
          providerKind: 'modelscope',
          label: '',
          apiKey: 'ms-token',
          baseUrl: '',
          enabled: true
        }
      ]
    })
    expect(next.providers[0].providerKind).toBe('modelscope')
    expect(next.providers[0].label).toBe('魔塔')
    expect(next.providers[0].baseUrl).toBe(MODELSCOPE_DEFAULT_BASE_URL)
    expect(isModelScopeProvider(next.providers[0])).toBe(true)
  })

  it('drops unknown provider kinds and does not map aliases', () => {
    const next = normalizeModelsSettings({
      providers: [
        { id: 'a', providerKind: 'hailuo', apiKey: 'x' },
        { id: 'b', providerKind: 'qwen', apiKey: 'x' },
        { id: 'c', providerKind: '魔搭', apiKey: 'x' },
        { id: 'd', providerKind: 'minimax', apiKey: 'mm' }
      ]
    })
    expect(next.providers).toHaveLength(1)
    expect(next.providers[0].id).toBe('d')
    expect(next.providers[0].providerKind).toBe('minimax')
  })

  it('does not migrate modalities.voice into audio', () => {
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'p1',
          providerKind: 'openrouter',
          apiKey: 'sk',
          modalities: {
            voice: { selectedModelIds: ['old-voice'], defaultModelId: 'old-voice' }
          } as never
        }
      ]
    })
    expect(next.providers[0].modalities.audio.selectedModelIds).toEqual([])
  })

  it('drops unknown legacy shapes', () => {
    const next = normalizeModelsSettings({
      text: [{ id: 'old', apiKey: 'sk', selectedModelIds: ['x'] }],
      image: []
    })
    expect(next).toEqual(createEmptyModelsSettings())
  })
})

describe('volcengine ark helpers', () => {
  it('createProviderInstance defaults for ark', () => {
    const p = createProviderInstance('volcengine-ark')
    expect(isVolcengineArkProvider(p)).toBe(true)
    expect(p.baseUrl).toBe(VOLCENGINE_ARK_DEFAULT_BASE_URL)
  })

  it('classifies modality by model id', () => {
    expect(classifyVolcengineArkModelModality({ id: 'doubao-seed-1-8' })).toBe('text')
    expect(classifyVolcengineArkModelModality({ id: 'doubao-seedream-4-5' })).toBe('image')
    expect(classifyVolcengineArkModelModality({ id: 'doubao-seedance-2-0' })).toBe('video')
    expect(classifyVolcengineArkModelModality({ id: 'doubao-tts' })).toBe('audio')
    expect(classifyVolcengineArkModelModality({ id: 'seed-tts-2.0' })).toBe('audio')
  })
})

describe('pickActiveProvider', () => {
  const provider = createProviderInstance('openrouter', {
    id: 'p1',
    apiKey: 'sk',
    modalities: {
      text: { selectedModelIds: ['t1'], defaultModelId: 't1' },
      image: { selectedModelIds: ['i1'], defaultModelId: 'i1' },
      video: { selectedModelIds: [], defaultModelId: '' },
      audio: { selectedModelIds: [], defaultModelId: '' }
    }
  })

  it('finds by id', () => {
    expect(findProviderById([provider], 'p1')?.id).toBe('p1')
  })

  it('picks modality-specific model', () => {
    const picked = pickActiveProvider([provider], 'text')
    expect(picked?.modelId).toBe('t1')
  })

  it('picks kling with apiKey only', () => {
    const kling = createProviderInstance('kling', {
      id: 'k1',
      apiKey: '',
      modalities: {
        text: { selectedModelIds: [], defaultModelId: '' },
        image: { selectedModelIds: ['kling-v2'], defaultModelId: 'kling-v2' },
        video: { selectedModelIds: [], defaultModelId: '' },
        audio: { selectedModelIds: [], defaultModelId: '' }
      }
    })
    expect(pickActiveProvider([kling], 'image')).toBeNull()
    kling.apiKey = 'key'
    expect(pickActiveProvider([kling], 'image')?.modelId).toBe('kling-v2')
  })
})
