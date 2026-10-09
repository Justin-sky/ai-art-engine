import type {
  ModalityModelConfig,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind
} from '@shared/modelProvider'
import { ELEVEN_SOUND_MODEL } from '@shared/modelProviders/elevenlabs/voice'
import {
  allowsEmptyApiKey,
  isDecisionProviderKind,
  isLocalOpenAiProvider,
  isModel3dProviderKind,
  isVllmProvider,
  isWorldProviderKind,
  modalityConfig,
  providerModelDisplayName,
  requiresSpeechVoice,
  resolveAvailableVoices,
  supportsAudioModality,
  supportsMusicModality,
  supportsSoundEffect
} from '@shared/modelProvider'

export interface GenerateModelOption {
  key: string
  label: string
  providerInstanceId: string
  providerKind: ModelProviderKind
  model: string
}

/**
 * 生成模型下拉的展示名：优先设置里缓存的目录名（拉取目录时写入），
 * 其次 provider 内置展示名（目录只返回 id 的 provider，如 DeepSeek 的 deepseek-flash），
 * 最后回退 id。
 *
 * **始终** `提供商 · 模型`（只一项时也不省略提供商），与声音 / 音乐等下拉同口径。
 */
function resolveModelOptionLabel(
  provider: ModelProviderInstance,
  config: ModalityModelConfig,
  modelId: string
): string {
  const cachedName = config.catalog?.[modelId]?.name?.trim()
  const display = cachedName || providerModelDisplayName(provider.providerKind, modelId)
  const providerLabel = provider.label.trim() || provider.providerKind
  // 模型展示名已以提供商名开头时不再重复拼（避免「ElevenLabs · ElevenLabs xxx」）
  if (display.toLowerCase().startsWith(providerLabel.toLowerCase())) {
    return display
  }
  return `${providerLabel} · ${display}`
}

/** 音效模型 id：桶里可能混进 TTS，只放行 sound 系 */
function isSoundEffectModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  return id === ELEVEN_SOUND_MODEL || id.startsWith('eleven_text_to_sound')
}

/** 读 sfx 桶勾选；空或全是 TTS 残留时退回固定音效模型 */
function resolveSoundEffectModelIds(config: ModalityModelConfig): string[] {
  const selected = config.selectedModelIds.filter(
    (id): id is string => typeof id === 'string' && Boolean(id.trim()) && isSoundEffectModelId(id)
  )
  return selected.length ? selected : [ELEVEN_SOUND_MODEL]
}

export function modelKey(providerInstanceId: string, model: string): string {
  return `${providerInstanceId}::${model}`
}

export function parseModelKey(key: string): { providerInstanceId: string; model: string } | null {
  const idx = key.indexOf('::')
  if (idx <= 0) return null
  return { providerInstanceId: key.slice(0, idx), model: key.slice(idx + 2) }
}

/**
 * 音效节点的模型选项：与其它模态同形 —— 读设置 **sfx** 桶勾选，
 * 标签恒为 `提供商 · 模型`（只一项也不省略提供商）。
 *
 * 桶里若混进 TTS id（旧设置 / 手动误加）会滤掉；全空时退回 `eleven_text_to_sound_v2`。
 */
export function buildSoundEffectOptions(providers: ModelProviderInstance[]): GenerateModelOption[] {
  const options: GenerateModelOption[] = []
  for (const provider of providers) {
    if (!provider.enabled) continue
    if (!supportsSoundEffect(provider.providerKind)) continue
    if (!provider.apiKey.trim() && !allowsEmptyApiKey(provider)) continue
    const config = modalityConfig(provider, 'sfx')
    for (const model of resolveSoundEffectModelIds(config)) {
      options.push({
        key: modelKey(provider.id, model),
        model,
        providerInstanceId: provider.id,
        providerKind: provider.providerKind,
        label: resolveModelOptionLabel(provider, config, model)
      })
    }
  }
  return options
}

/**
 * 当前设置里的全部提供商实例。
 *
 * 给音效节点用：它的模型是固定的，需要的是**提供商清单**本身
 * （走 loadGenerateModelOptions 会被音频模态的模型过滤挡掉）。
 */
export async function loadAllProviders(): Promise<ModelProviderInstance[]> {
  try {
    const settings = await getSettingsCached()
    return settings.models?.providers ?? []
  } catch {
    return []
  }
}

/**
 * 谁能做音效生成 —— 事实来源已上移到 `@shared/modelProvider`。
 *
 * 原先这里各写了一份（渲染层 `kind === 'elevenlabs'`、主进程按 audio 模态猜），
 * 两边不一致的直接后果是「节点下拉能选 ElevenLabs，主进程却挑到别家然后报不支持」。
 * 这里只做转发，**不要再往里加判断**。
 */
export { supportsSoundEffect }

export function buildModelOptions(
  providers: ModelProviderInstance[],
  modality: ModelModality
): GenerateModelOption[] {
  const options: GenerateModelOption[] = []
  for (const provider of providers) {
    if (!provider.enabled) continue
    // 声音 / 音乐 / 音效：ElevenLabs 的目录公开可读（无 Key 也能先配）
    if (
      provider.providerKind === 'elevenlabs' &&
      modality !== 'audio' &&
      modality !== 'music' &&
      modality !== 'sfx'
    ) {
      continue
    }
    // 本地 OpenAI 兼容服务与 ComfyUI 无需 API Key
    if (!provider.apiKey.trim() && !allowsEmptyApiKey(provider)) continue
    // 本地服务仅文本（多模态理解可在文本节点传图）
    if (isVllmProvider(provider) && modality !== 'text' && modality !== 'video') continue
    if (isLocalOpenAiProvider(provider) && !isVllmProvider(provider) && modality !== 'text') {
      continue
    }
    // 声音（audio）一家一家认：火山方舟 voice_design / MiniMax 音色设计 /
    // ComfyUI 音频工作流，以及走 OpenAI 兼容 `POST /audio/speech` 的 OpenAI 与 OpenRouter
    // （聚合器）。**不要**退回成「只认某几家」的白名单：新增 TTS 提供商时这里必须同步，
    // 否则设置里勾了模型、声音节点的下拉依然是空的。
    if (modality === 'audio' && !supportsAudioModality(provider.providerKind)) {
      continue
    }
    // 音乐（music）同理，走同一份事实来源：OpenAI 有 TTS 但**没有**音乐端点，
    // 不放行的话它会掉进末尾的「文本 + 图片」默认分支，音乐下拉里出现不能编曲的模型
    if (modality === 'music' && !supportsMusicModality(provider.providerKind)) {
      continue
    }
    // 音效：只认有 sound-generation 端点的家；勾选与标签口径见 buildSoundEffectOptions
    if (modality === 'sfx') {
      if (!supportsSoundEffect(provider.providerKind)) continue
      const sfxConfig = modalityConfig(provider, 'sfx')
      for (const model of resolveSoundEffectModelIds(sfxConfig)) {
        options.push({
          key: modelKey(provider.id, model),
          label: resolveModelOptionLabel(provider, sfxConfig, model),
          providerInstanceId: provider.id,
          providerKind: provider.providerKind,
          model
        })
      }
      continue
    }
    if (provider.providerKind === 'comfyui' && modality === 'text') continue
    // 可灵仅图片/视频
    if (provider.providerKind === 'kling' && modality !== 'image' && modality !== 'video') continue
    // MiniMax：文本 / 图片 / 视频 / 声音设计 / 音乐
    if (
      provider.providerKind === 'minimax' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'video' &&
      modality !== 'audio' &&
      modality !== 'music'
    ) {
      continue
    }
    // 魔塔：文本 + 图片
    if (provider.providerKind === 'modelscope' && modality !== 'text' && modality !== 'image') {
      continue
    }
    // OpenAI：文本 + 图片 + 声音（POST /audio/speech）
    if (
      provider.providerKind === 'openai' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'audio'
    ) {
      continue
    }
    // DeepSeek：仅文本
    if (provider.providerKind === 'deepseek' && modality !== 'text') {
      continue
    }
    // Anthropic（Claude）：仅文本
    if (provider.providerKind === 'anthropic' && modality !== 'text') {
      continue
    }
    // 智谱：文本 + 图片
    if (provider.providerKind === 'zhipu' && modality !== 'text' && modality !== 'image') {
      continue
    }
    // Kimi（月之暗面）：仅文本
    if (provider.providerKind === 'moonshot' && modality !== 'text') {
      continue
    }
    // Google（Gemini）：文本 / 图片 / 视频
    if (
      provider.providerKind === 'google' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'video'
    ) {
      continue
    }
    // xAI（Grok）：文本 / 图片 / 视频
    if (
      provider.providerKind === 'xai' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'video'
    ) {
      continue
    }
    // 3D 模型生成：仅支持 3D 供应商
    if (modality === 'model3d' && !isModel3dProviderKind(provider.providerKind)) {
      continue
    }
    // 空间世界生成：仅支持空间世界供应商（World Labs Marble）
    if (modality === 'spatialWorld' && !isWorldProviderKind(provider.providerKind)) {
      continue
    }
    // 反向约束：空间世界供应商只做世界生成，不出现在图片 / 视频 / 文本等其它模态的下拉里
    if (isWorldProviderKind(provider.providerKind) && modality !== 'spatialWorld') {
      continue
    }
    // 决策：只有提供决策协议的供应商（OpenRouter Decisions API / TypeSafe System One）
    if (modality === 'decisions' && !isDecisionProviderKind(provider.providerKind)) {
      continue
    }
    const sel = modalityConfig(provider, modality)
    const models =
      sel.selectedModelIds.length > 0
        ? sel.selectedModelIds
        : sel.defaultModelId
          ? [sel.defaultModelId]
          : []
    for (const model of models) {
      if (!model.trim()) continue
      options.push({
        key: modelKey(provider.id, model),
        label: resolveModelOptionLabel(provider, sel, model),
        providerInstanceId: provider.id,
        providerKind: provider.providerKind,
        model
      })
    }
  }
  return options
}

export function pickDefaultModelKey(
  providers: ModelProviderInstance[],
  modality: ModelModality,
  options: GenerateModelOption[]
): string {
  if (options.length === 0) return ''
  for (const provider of providers) {
    if (!provider.enabled) continue
    if (!provider.apiKey.trim() && !allowsEmptyApiKey(provider)) continue
    const defaultModelId = modalityConfig(provider, modality).defaultModelId
    if (defaultModelId) {
      const key = modelKey(provider.id, defaultModelId)
      if (options.some((o) => o.key === key)) return key
    }
  }
  return options[0]?.key ?? ''
}

export function preferredModelKey(providerInstanceId?: string, model?: string): string {
  if (!providerInstanceId || !model) return ''
  return modelKey(providerInstanceId, model)
}

export type GenerateModelModality =
  'text' | 'image' | 'video' | 'audio' | 'music' | 'sfx' | 'model3d' | 'spatialWorld' | 'decisions'

/** 打开编辑窗时会连打 getSettings；短缓存避免同一次打开多 Dialog 重复 IPC */
let settingsCache: {
  at: number
  value: Awaited<ReturnType<typeof window.studio.getSettings>>
} | null = null
const SETTINGS_CACHE_TTL_MS = 15_000

export function invalidateGenerateModelSettingsCache(): void {
  settingsCache = null
}

async function getSettingsCached(): Promise<Awaited<ReturnType<typeof window.studio.getSettings>>> {
  const now = Date.now()
  if (settingsCache && now - settingsCache.at < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.value
  }
  const value = await window.studio.getSettings()
  settingsCache = { at: now, value }
  return value
}

/** 可选项为空的成因：用于在选择器旁说明「为什么是空的」，而不是干瞪一个空下拉 */
export type EmptyModelOptionsReason =
  'noProvider' | 'providerDisabled' | 'missingApiKey' | 'noSelection' | 'unknown'

/**
 * 未产出任何选项时判定成因。
 *
 * `buildModelOptions` 会跳过「未启用 / 缺 Key / 该模态没勾模型」的提供商，
 * 所以空列表有三种完全不同的解释；这里按最可操作的一条给出结论。
 * 只考虑**支持该模态**的提供商（例如 decisions 只有 OpenRouter 与 TypeSafe），
 * 否则别的提供商的启用状态会把结论带偏。
 */
export function resolveEmptyModelOptionsReason(
  providers: ModelProviderInstance[],
  modality: ModelModality
): EmptyModelOptionsReason {
  const supports = (kind: ModelProviderKind): boolean => {
    // 决策协议供应商（OpenRouter / TypeSafe）：支持 decisions，且各自另有能力
    if (isDecisionProviderKind(kind)) return modality === 'decisions' || kind === 'openrouter'
    if (modality === 'decisions') return false
    if (kind === 'comfyui')
      return modality === 'image' || modality === 'video' || modality === 'audio'
    // 声音按同一份事实来源判定：否则设置里勾好了，节点还在说「没有可用提供商」
    if (modality === 'audio') return supportsAudioModality(kind)
    // 音乐同理，且**必须排在下面那条 elevenlabs 否掉之前** ——
    // ElevenLabs 有音乐端点（/v1/music），音乐节点不能因为「它只有语音合成」而被判成没提供商
    if (modality === 'music') return supportsMusicModality(kind)
    // 音效同理：必须排在 elevenlabs 否掉之前
    if (modality === 'sfx') return supportsSoundEffect(kind)
    // ElevenLabs 只有语音 / 音乐 / 音效 —— 其它模态到不了上面几行，必须显式否掉，
    // 否则会掉进末尾的「文本 + 图片」默认分支被误判为支持
    if (kind === 'elevenlabs') return false
    if (isVllmProvider(kind)) return modality === 'text' || modality === 'video'
    if (isLocalOpenAiProvider(kind)) return modality === 'text'
    if (isWorldProviderKind(kind)) return modality === 'spatialWorld'
    if (isModel3dProviderKind(kind)) return modality === 'model3d'
    if (kind === 'volcengine-ark' || kind === 'dashscope' || kind === 'minimax') {
      return modality !== 'model3d'
    }
    if (kind === 'kling') return modality === 'image' || modality === 'video'
    if (kind === 'custom') return modality === 'text' || modality === 'image'
    // 其余（openai / deepseek / moonshot / anthropic / zhipu / google / xai / modelscope …）：文本 + 部分图片
    return modality === 'text' || modality === 'image'
  }

  const candidates = providers.filter((p) => supports(p.providerKind))
  if (!candidates.length) return 'noProvider'
  if (candidates.every((p) => !p.enabled)) return 'providerDisabled'
  if (candidates.some((p) => !p.apiKey.trim() && !allowsEmptyApiKey(p))) return 'missingApiKey'
  return 'noSelection'
}

/**
 * 每个模型选项可用的声音（仅 audio 模态非空）。
 *
 * 只认**该模型自己**的目录条目：不能用「提供商里任意模型声明的音色」兜底 ——
 * 那正是踩过的坑：给 seed-audio-1-0（无音色）选模型时，面板列出了同一提供商下
 * 微软模型的音色，用户选了它，请求就变成「微软音色 + 字节模型」→ 400。
 *
 * 单独成函数：调用方（指令面板）需要它，而这层的输入就是 providers + options，
 * 不需要再碰 window.studio —— 也就能脱离渲染环境单测。
 */
export function buildModelVoiceOptions(
  providers: ModelProviderInstance[],
  modality: GenerateModelModality,
  options: GenerateModelOption[]
): Record<string, string[]> {
  if (modality !== 'audio') return {}
  const out: Record<string, string[]> = {}
  for (const option of options) {
    const provider = providers.find((p) => p.id === option.providerInstanceId)
    if (!provider) continue
    // 与主进程的 resolveDefaultVoice 共用同一套优先级（模型声明 → 供应商音色目录），
    // 两边不一致就会出现「面板列出音色、生成说没音色」的错位
    const voices = resolveAvailableVoices(provider, option.model)
    if (voices.length) out[option.key] = voices
  }
  return out
}

/**
 * 音色 id → 展示名（跨模型，来自 provider 的 audio.voiceLabels）。
 *
 * 与 buildModelVoiceOptions 分开：候选列表按模型变，音色名不变
 * （ElevenLabs 的音色属于账号），所以标签不需要按模型各存一份。
 */
export function buildVoiceLabels(
  providers: ModelProviderInstance[],
  options: GenerateModelOption[]
): Record<string, string> {
  const providerIds = new Set(options.map((o) => o.providerInstanceId))
  const out: Record<string, string> = {}
  for (const provider of providers) {
    if (!providerIds.has(provider.id)) continue
    Object.assign(out, modalityConfig(provider, 'audio').voiceLabels ?? {})
  }
  return out
}

/** 供应商 kind 可能拿不到（选中项不在列表里），此时按「不必须」处理 */
function voiceRequiredFor(kind: ModelProviderKind | undefined): boolean {
  return kind ? requiresSpeechVoice(kind) : false
}

export async function loadGenerateModelOptions(
  modality: GenerateModelModality,
  preferredKey?: string,
  currentKey?: string
): Promise<{
  options: GenerateModelOption[]
  selectedKey: string
  emptyReason: EmptyModelOptionsReason | null
  /**
   * 每个模型选项可用的声音（仅 audio 模态非空）。
   * 只在这里算：providers 已经从设置里取出来了，再让调用方自己去查一遍
   * 等于重复读设置，还会把「模型 key → 提供商的 audio 目录」这层耦合漏到 UI 里。
   */
  voicesByModelKey: Record<string, string[]>
  /** 音色 id → 展示名（仅不透明 id 的供应商有内容，如 ElevenLabs） */
  voiceLabels: Record<string, string>
  /**
   * 所选模型是否**必须**带音色（ElevenLabs 的 voice_id 在请求路径里）。
   * 为真时面板收起「默认音色」选项 —— 对这类供应商它等于「不选」，选了必然报错。
   */
  voiceRequired: boolean
}> {
  try {
    const settings = await getSettingsCached()
    const providers = settings.models?.providers ?? []
    // 音效：端点模型固定，下拉只表达提供商实例（见 buildSoundEffectOptions）
    // 不能走 buildModelOptions —— 它会读 sfx 桶勾选，旧设置里可能混进 TTS 模型 id
    const options =
      modality === 'sfx'
        ? buildSoundEffectOptions(providers)
        : buildModelOptions(providers, modality)
    const voicesByModelKey = buildModelVoiceOptions(providers, modality, options)
    const voiceLabels = buildVoiceLabels(providers, options)
    // voiceRequired 按最终选中的那个模型判定（入参 preferred/current 可能都没命中）
    const done = (selectedKey: string) => ({
      options,
      selectedKey,
      emptyReason: options.length ? null : resolveEmptyModelOptionsReason(providers, modality),
      voicesByModelKey,
      voiceLabels,
      voiceRequired: voiceRequiredFor(options.find((o) => o.key === selectedKey)?.providerKind)
    })
    if (preferredKey && options.some((o) => o.key === preferredKey)) {
      return done(preferredKey)
    }
    // 音效：preferred 可能带着旧的 TTS 模型 id（providerId::eleven_v3），按实例对齐
    if (modality === 'sfx' && preferredKey) {
      const preferredProvider = parseModelKey(preferredKey)?.providerInstanceId
      const byProvider = preferredProvider
        ? options.find((o) => o.providerInstanceId === preferredProvider)
        : undefined
      if (byProvider) return done(byProvider.key)
    }
    if (currentKey && options.some((o) => o.key === currentKey)) {
      return done(currentKey)
    }
    if (modality === 'sfx' && currentKey) {
      const currentProvider = parseModelKey(currentKey)?.providerInstanceId
      const byProvider = currentProvider
        ? options.find((o) => o.providerInstanceId === currentProvider)
        : undefined
      if (byProvider) return done(byProvider.key)
    }
    return done(
      modality === 'sfx'
        ? (options[0]?.key ?? '')
        : pickDefaultModelKey(providers, modality, options)
    )
  } catch {
    return {
      options: [],
      selectedKey: '',
      emptyReason: 'unknown',
      voicesByModelKey: {},
      voiceLabels: {},
      voiceRequired: false
    }
  }
}
