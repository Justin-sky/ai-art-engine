import {
  MODEL_MODALITIES,
  isComfyUiProvider,
  isCustomProvider,
  isLocalOpenAiProvider,
  isModel3dProviderKind,
  isVllmProvider,
  isWorldProviderKind,
  resolveCustomApiStyle,
  supportsAudioModality,
  supportsMusicModality,
  supportsSoundEffectModality
} from '../modelProvider'
import type { ModelModality, ModelProviderInstance } from '../modelProvider'

/**
 * 各提供商在设置页显示哪些模态页签（纯函数：从组件里提出来才能单测）。
 *
 * 结构是「基准列表 + 能力来源合并」：
 * - 基准列表只写该家的**主要**模态（阅读友好，且能表达 home 能力）
 * - 声音 / 音乐 / 音效再按能力表合并进来
 *
 * 为什么不把声音 / 音乐 / 音效也写进基准列表：新增一个模态时（如 music / sfx 从 audio 拆出来）
 * 要挨个改这份列表，而漏改的表现是「某个提供商的页签凭空消失」——
 * 很难在测试里发现，用户只会觉得功能没了。踩过两次：
 * - ElevenLabs 写死 `['audio']`，拆出 music 后它的音乐页签没了
 * - MiniMax / DashScope 同理，导致这两家的音乐模型取不到
 */
export function settingsModalitiesFor(provider: ModelProviderInstance): ModelModality[] {
  return withCapabilityModalities(provider, settingsModalitiesBase(provider))
}

/** 把提供商实际具备的声音 / 音乐 / 音效模态并进基准列表（按 MODEL_MODALITIES 的既有顺序） */
function withCapabilityModalities(
  provider: ModelProviderInstance,
  base: ModelModality[]
): ModelModality[] {
  const merged = new Set<ModelModality>(base)
  if (supportsAudioModality(provider.providerKind)) merged.add('audio')
  if (supportsMusicModality(provider.providerKind)) merged.add('music')
  if (supportsSoundEffectModality(provider.providerKind)) merged.add('sfx')
  return MODEL_MODALITIES.filter((m) => merged.has(m))
}

/** 各家的基准页签（不含按能力来源补齐的声音 / 音乐） */
function settingsModalitiesBase(provider: ModelProviderInstance): ModelModality[] {
  if (isCustomProvider(provider)) {
    // Anthropic Messages API 无统一图片生成协议，仅开放文本；
    // OpenAI 兼容 / Gemini 走 /images/generations
    return resolveCustomApiStyle(provider) === 'anthropic' ? ['text'] : ['text', 'image']
  }
  if (provider.providerKind === 'moonshot') return ['text']
  if (provider.providerKind === 'google') return ['text', 'image', 'video']
  if (provider.providerKind === 'xai') return ['text', 'image', 'video']
  if (isComfyUiProvider(provider)) return ['image', 'video', 'audio']
  if (isVllmProvider(provider)) return ['text', 'video']
  if (isLocalOpenAiProvider(provider)) return ['text']
  if (provider.providerKind === 'zhipu') return ['text', 'image']
  if (provider.providerKind === 'deepseek') return ['text']
  if (provider.providerKind === 'anthropic') return ['text']
  if (provider.providerKind === 'openai') {
    // 声音：POST /audio/speech（model + input + voice），聚合器同协议
    return ['text', 'image', 'audio']
  }
  if (provider.providerKind === 'elevenlabs') {
    // 语音合成（/v1/text-to-speech/{voice_id}）；音乐 / 音效由能力来源补齐
    return ['audio']
  }
  if (provider.providerKind === 'kling') return ['image', 'video']
  if (provider.providerKind === 'minimax') return ['text', 'image', 'video', 'audio']
  if (provider.providerKind === 'modelscope') return ['text', 'image']
  if (provider.providerKind === 'dashscope') return ['text', 'image', 'video', 'audio']
  if (provider.providerKind === 'volcengine-ark') return ['text', 'image', 'video', 'audio']
  if (provider.providerKind === 'magicrouter') return ['text', 'image', 'video']
  if (isModel3dProviderKind(provider.providerKind)) return ['model3d']
  if (isWorldProviderKind(provider.providerKind)) return ['spatialWorld']
  if (provider.providerKind === 'openrouter') {
    // audio：TTS 走 /audio/speech，目录走 /models?output_modalities=speech。
    // **没有音乐端点**（/v1/music 是 ElevenLabs 的），所以不合并 music
    return ['text', 'image', 'video', 'audio', 'decisions']
  }
  if (provider.providerKind === 'typesafe') {
    // 决策模型厂商：只做决策判定，没有文本 / 图片 / 视频生成
    return ['decisions']
  }
  // 兜底：除 3D / 空间世界 / 决策外都列出来，声音与音乐由能力来源过滤
  return MODEL_MODALITIES.filter(
    (m) => m !== 'model3d' && m !== 'spatialWorld' && m !== 'decisions'
  )
}
