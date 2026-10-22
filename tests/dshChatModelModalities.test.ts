import { describe, expect, it } from 'vitest'
import {
  isKnownVisionModelId,
  resolveDshChatInputModalities,
  resolveDshChatInputModalitiesForProvider
} from '../src/shared/dshChatModelModalities'
import {
  isGoogleTextModelId,
  resolveGoogleChatModelId,
  resolveGoogleOpenAiBaseUrl
} from '../src/shared/modelProviders/google/modelCapabilities'
import { createProviderInstance } from '../src/shared/modelProvider'
import {
  normalizeGeminiChatModelId,
  sanitizeOpenAiChatPayload,
  transformGeminiSsePayload,
  unwrapJsonArrayErrorBody
} from '../src/main/services/aiartHeadlessRunner.template.mjs'

describe('resolveDshChatInputModalities', () => {
  it('目录声明 image 时放行 text+image', () => {
    expect(resolveDshChatInputModalities('openrouter', 'xiaomi/mimo-v2.6-flash', true)).toEqual([
      'text',
      'image'
    ])
  })

  it('目录明确无 image 时保持纯文本（未知 id）', () => {
    expect(resolveDshChatInputModalities('openrouter', 'some/text-only-model', false)).toEqual([
      'text'
    ])
  })

  it('OpenRouter DeepSeek V4.1 Flash 即使 catalog 误标无图也放行', () => {
    expect(
      resolveDshChatInputModalities('openrouter', 'deepseek/deepseek-v4.1-flash', false)
    ).toEqual(['text', 'image'])
  })

  it('OpenRouter 旧版 deepseek-v4-flash（非 4.1）尊重目录无图', () => {
    expect(
      resolveDshChatInputModalities('openrouter', 'deepseek/deepseek-v4-flash', false)
    ).toEqual(['text'])
  })

  it('OpenRouter 目录未标注时乐观放行图片（避免误拦多模态）', () => {
    expect(resolveDshChatInputModalities('openrouter', 'vendor/unknown-chat', null)).toEqual([
      'text',
      'image'
    ])
  })

  it('DeepSeek 官方仅内置 vision 模型放行', () => {
    expect(resolveDshChatInputModalities('deepseek', 'deepseek-flash', null)).toEqual([
      'text',
      'image'
    ])
    expect(resolveDshChatInputModalities('deepseek', 'deepseek-v4-flash', null)).toEqual(['text'])
  })
})

describe('isKnownVisionModelId', () => {
  it('识别 OpenRouter DeepSeek / MiMo 看图模型', () => {
    expect(isKnownVisionModelId('deepseek/deepseek-v4.1-flash')).toBe(true)
    expect(isKnownVisionModelId('deepseek/deepseek-flash-latest')).toBe(true)
    expect(isKnownVisionModelId('xiaomi/mimo-v2.6-flash')).toBe(true)
    expect(isKnownVisionModelId('deepseek/deepseek-v4-flash')).toBe(false)
  })
})

describe('resolveDshChatInputModalitiesForProvider', () => {
  it('读取 OpenRouter 已保存 catalog 的 architecture.input_modalities', () => {
    const provider = createProviderInstance('openrouter', {
      modalities: {
        text: {
          selectedModelIds: ['deepseek/deepseek-v4.1-flash'],
          defaultModelId: 'deepseek/deepseek-v4.1-flash',
          catalog: {
            'deepseek/deepseek-v4.1-flash': {
              id: 'deepseek/deepseek-v4.1-flash',
              name: 'DeepSeek: DeepSeek V4.1 Flash',
              capabilities: {
                architecture: {
                  input_modalities: ['text', 'image'],
                  modality: 'text+image->text'
                }
              }
            }
          }
        },
        image: { selectedModelIds: [], defaultModelId: '' },
        video: { selectedModelIds: [], defaultModelId: '' },
        audio: { selectedModelIds: [], defaultModelId: '' },
        model3d: { selectedModelIds: [], defaultModelId: '' }
      }
    })
    expect(
      resolveDshChatInputModalitiesForProvider(provider, 'deepseek/deepseek-v4.1-flash')
    ).toEqual(['text', 'image'])
  })

  it('仅有 modality 字符串时也能识别看图', () => {
    const provider = createProviderInstance('openrouter', {
      modalities: {
        text: {
          selectedModelIds: ['deepseek/deepseek-v4.1-flash'],
          defaultModelId: 'deepseek/deepseek-v4.1-flash',
          catalog: {
            'deepseek/deepseek-v4.1-flash': {
              id: 'deepseek/deepseek-v4.1-flash',
              name: 'DeepSeek V4.1 Flash',
              capabilities: {
                architecture: { modality: 'text+image->text' }
              }
            }
          }
        },
        image: { selectedModelIds: [], defaultModelId: '' },
        video: { selectedModelIds: [], defaultModelId: '' },
        audio: { selectedModelIds: [], defaultModelId: '' },
        model3d: { selectedModelIds: [], defaultModelId: '' }
      }
    })
    expect(
      resolveDshChatInputModalitiesForProvider(provider, 'deepseek/deepseek-v4.1-flash')
    ).toEqual(['text', 'image'])
  })
})

describe('Google Gemini chat compatibility & model normalization', () => {
  it('规范化 Google OpenAI 兼容端点并过滤 Live/Transcribe 非 HTTP 对话模型', () => {
    expect(resolveGoogleOpenAiBaseUrl('')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    )
    expect(resolveGoogleOpenAiBaseUrl('https://generativelanguage.googleapis.com')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    )
    expect(resolveGoogleOpenAiBaseUrl('https://generativelanguage.googleapis.com/v1beta/')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai'
    )

    expect(isGoogleTextModelId('models/gemini-3.6-flash')).toBe(true)
    expect(isGoogleTextModelId('models/gemini-3.8-live')).toBe(false)
    expect(isGoogleTextModelId('models/gemini-3.8-live-extended-thinking')).toBe(false)
    expect(isGoogleTextModelId('models/gemini-2.5-flash-transcribe')).toBe(false)

    expect(resolveGoogleChatModelId('models/gemini-3.8-live')).toBe('gemini-3.8-flash')
    expect(resolveGoogleChatModelId('models/gemini-3.8-live-extended-thinking')).toBe(
      'gemini-3.8-flash'
    )
    expect(resolveGoogleChatModelId('models/gemini-3.6-flash')).toBe('gemini-3.6-flash')
    expect(normalizeGeminiChatModelId('models/gemini-3.8-live')).toBe('gemini-3.8-flash')
    expect(normalizeGeminiChatModelId('deepseek-flash', true)).toBe('gemini-3.8-flash')
  })

  it('sanitizeOpenAiChatPayload 剥离 Gemini 不支持的 thinking / dsh_plugin_packages 等私有字段并补齐 tool_calls thought_signature', () => {
    const sigCache = new Map<string, string>([['call_1', 'sig_from_step_1']])
    const rawPayload = JSON.stringify({
      model: 'models/gemini-3.8-live',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      max_tokens: 256000,
      dsh_session_log: { version: 1 },
      dsh_plugin_packages: { version: 1, packages: [] },
      messages: [
        { role: 'system', content: 'You are AIArtEngine.' },
        { role: 'user', content: '生成一张海报' },
        { role: 'system', content: 'Current time: 12:00' },
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'thinking...',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'mcp__studio__graph_read', arguments: '{}' }
            },
            {
              id: 'call_unseen',
              type: 'function',
              function: { name: 'mcp__studio__graph_edit', arguments: '{}' }
            }
          ]
        }
      ]
    })

    const { body, isGemini } = sanitizeOpenAiChatPayload(
      rawPayload,
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      sigCache
    )
    expect(isGemini).toBe(true)
    const sanitized = JSON.parse(body)
    expect(sanitized.model).toBe('gemini-3.8-flash')
    expect(sanitized.thinking).toBeUndefined()
    expect(sanitized.dsh_session_log).toBeUndefined()
    expect(sanitized.dsh_plugin_packages).toBeUndefined()
    expect(sanitized.reasoning_effort).toBeUndefined()
    expect(sanitized.max_tokens).toBeUndefined()
    expect(sanitized.messages[2].role).toBe('user')
    expect(sanitized.messages[2].content).toContain('[System Reminder]')
    expect(sanitized.messages[3].reasoning_content).toBeUndefined()
    expect(sanitized.messages[3].tool_calls[0].extra_content.google.thought_signature).toBe(
      'sig_from_step_1'
    )
    expect(sanitized.messages[3].tool_calls[1].extra_content.google.thought_signature).toBe(
      'skip_thought_signature_validator'
    )
  })

  it('transformGeminiSsePayload 为缺失 index 的 tool_calls 分配递增索引并缓存 thought_signature 与归一化 usage', () => {
    const sigCache = new Map<string, string>()
    const state = {
      nextToolCallIndex: 0,
      toolIdToIndex: new Map<string, number>(),
      sawDone: false,
      sawFinishReason: false
    }
    const rawChunk = JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'function-call-101',
                type: 'function',
                extra_content: { google: { thought_signature: 'sig_abc_101' } },
                function: { name: 'mcp__studio__graph_edit', arguments: '{"ops":[]}' }
              },
              {
                id: 'function-call-102',
                type: 'function',
                function: { name: 'mcp__studio__task_run', arguments: '{}' }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 155
      }
    })

    const out = JSON.parse(transformGeminiSsePayload(rawChunk, state, sigCache))
    expect(out.choices[0].delta.tool_calls[0].index).toBe(0)
    expect(out.choices[0].delta.tool_calls[1].index).toBe(1)
    expect(sigCache.get('function-call-101')).toBe('sig_abc_101')
    expect(state.sawFinishReason).toBe(true)
    expect(out.usage.completion_tokens).toBe(55)
    expect(out.usage.completion_tokens_details.reasoning_tokens).toBe(35)
    expect(out.usage.prompt_tokens + out.usage.completion_tokens).toBe(out.usage.total_tokens)
  })

  it('unwrapJsonArrayErrorBody 解包 Google 返回的 JSON 数组错误响应', () => {
    const googleArrError = JSON.stringify([
      {
        error: {
          code: 400,
          message: 'Invalid JSON payload received. Unknown name "thinking": Cannot find field.',
          status: 'INVALID_ARGUMENT'
        }
      }
    ])
    const unwrapped = JSON.parse(unwrapJsonArrayErrorBody(googleArrError))
    expect(unwrapped.error.message).toContain('Unknown name "thinking"')
  })
})
