/**
 * AI 对话「一句话生成游戏」主进程编排（MCP 工具 `game_one_sentence_create` 的实现体）。
 *
 * 流程：Agent 传入的规格 → normalizeGameSpec（关键词兜底补全）→ 探测音效 / 音乐模型 →
 * buildGameGraphPlanFromSpec（确定性搭图）→ commitAiWorkflow 落成子图资产 →
 * 仅当用户在对话游戏卡上勾选了「生成后自动运行」（AppSettings.gameOneSentenceAutoRun）才派发整图运行。
 *
 * 依赖全部可注入：单测不需要 Electron / 模型提供商 / MCP 服务。
 */
import {
  buildGameGraphPlanFromSpec,
  buildUiSuiteGraphPlanFromPrompt,
  isOneSentenceUiSuitePrompt,
  normalizeGameSpec,
  ONE_SENTENCE_GAME_NODE_KEYS,
  type GameSpec,
  type PartialGameSpecInput
} from '@shared/gameAssets/oneSentenceGameSpec'
import type { GraphPlan, GraphPlanMediaModelDefaults } from '@shared/graph'
import {
  allowsEmptyApiKey,
  pickActiveProvider,
  supportsSoundEffect,
  type ModelProviderInstance
} from '@shared/modelProvider'
import type { CommitAiWorkflowInput, CommitAiWorkflowResult } from './graphPlanService'

export type OneSentenceGameAudioSource = 'ai' | 'procedural'

export interface OneSentenceGameAudioAvailability {
  aiSfx: boolean
  aiMusic: boolean
  /** 已配置但已知不可用（额度耗尽 / 免费套餐不开放）而改用程序化合成的说明 */
  notes?: string[]
}

export interface CreateOneSentenceGameDeps {
  commit: (input: CommitAiWorkflowInput) => Promise<CommitAiWorkflowResult>
  detectAudio: () => OneSentenceGameAudioAvailability
  /** 读用户设置：是否在建图后自动整图运行（默认 false） */
  getAutoRun: () => boolean
  /** 派发整图运行，返回 mcpTaskId */
  dispatchRun: (assetId: string) => string
  /** 图片模型默认值（不含统一宽高比：精灵必须保持 1:1） */
  mediaDefaults?: () => Omit<GraphPlanMediaModelDefaults, 'generateAspectRatio'>
}

export interface CreateOneSentenceGameResult {
  ok: boolean
  assetId?: string
  title?: string
  gameSpec?: GameSpec
  audioSource?: { sfx: OneSentenceGameAudioSource; bgm: OneSentenceGameAudioSource }
  autoRun?: boolean
  mcpTaskId?: string
  nodeKeys?: typeof ONE_SENTENCE_GAME_NODE_KEYS
  warnings: string[]
  /** 给 Agent 的下一步指引（英文：会原样进入模型上下文） */
  nextStep?: string
  error?: string
}

/** 规格 + 音频可用性 → GraphPlan（纯函数，便于单测与工具共用） */
export function planOneSentenceGame(
  specInput: PartialGameSpecInput | null | undefined,
  prompt: string,
  audio: OneSentenceGameAudioAvailability
): { spec: GameSpec; plan: GraphPlan } {
  const spec = normalizeGameSpec(specInput, prompt)
  const rawObj = (specInput ?? {}) as Record<string, unknown>
  if (rawObj.uiSuiteOnly === true || isOneSentenceUiSuitePrompt(prompt)) {
    const uiBuilt = buildUiSuiteGraphPlanFromPrompt(prompt, {
      title: typeof rawObj.title === 'string' ? rawObj.title : undefined,
      stylePreset: typeof rawObj.stylePreset === 'string' ? rawObj.stylePreset : undefined,
      artStyle: typeof rawObj.artStyle === 'string' ? rawObj.artStyle : undefined
    })
    spec.title = uiBuilt.title
    return { spec, plan: uiBuilt.plan }
  }
  const plan = buildGameGraphPlanFromSpec(spec, {
    aiSfx: audio.aiSfx,
    aiMusic: audio.aiMusic
  })
  return { spec, plan }
}

export async function createOneSentenceGame(
  input: { prompt: string; spec?: PartialGameSpecInput | null; folderId?: string | null },
  deps: CreateOneSentenceGameDeps
): Promise<CreateOneSentenceGameResult> {
  const prompt = String(input.prompt ?? '').trim()
  if (!prompt) {
    return { ok: false, warnings: [], error: 'prompt is required' }
  }

  let audio: OneSentenceGameAudioAvailability = { aiSfx: false, aiMusic: false }
  try {
    audio = deps.detectAudio()
  } catch {
    // 探测失败按「没有音频模型」处理：程序化合成永远可用
  }

  const { spec, plan } = planOneSentenceGame(input.spec, prompt, audio)
  const committed = await deps.commit({
    plan,
    folderId: input.folderId ?? null,
    name: spec.title,
    ...(deps.mediaDefaults?.() ?? {})
  })
  if (!committed.ok || !committed.assetId) {
    return {
      ok: false,
      gameSpec: spec,
      warnings: committed.warnings ?? [],
      error: committed.error || 'failed to create the game workflow'
    }
  }

  const warnings = [
    ...(committed.warnings ?? []),
    ...spec.scopeNotes.map((n) => `scope: ${n}`),
    ...(audio.notes ?? []).map((n) => `audio: ${n}`)
  ]
  const autoRun = deps.getAutoRun() === true
  let mcpTaskId: string | undefined
  if (autoRun) {
    try {
      mcpTaskId = deps.dispatchRun(committed.assetId)
    } catch (err) {
      warnings.push(`auto-run dispatch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const nextStep = mcpTaskId
    ? 'The whole game graph is now running on the canvas (auto-run is enabled by the user). Tell the user it is generating; when it finishes they can press "Play" on the game card. Do not call task_run again.'
    : 'The game graph has been created but NOT run (auto-run is off by default to avoid model costs). Tell the user to press "Run" on the game card, or tick "Auto-run after generation" there. Do NOT call task_run yourself.'

  return {
    ok: true,
    assetId: committed.assetId,
    title: committed.title ?? spec.title,
    gameSpec: spec,
    audioSource: {
      sfx: audio.aiSfx ? 'ai' : 'procedural',
      bgm: audio.aiMusic ? 'ai' : 'procedural'
    },
    autoRun: Boolean(mcpTaskId),
    ...(mcpTaskId ? { mcpTaskId } : {}),
    nodeKeys: ONE_SENTENCE_GAME_NODE_KEYS,
    warnings,
    nextStep
  }
}

/**
 * 探测音效 / 音乐模型是否可用（「有模型用 AI，否则程序化合成」）。
 * - 音效：已启用、带凭据、且提供商种类支持音效端点（与 resolveActiveSoundEffectProvider 同口径）；
 * - 音乐：只认 **music 模态**里勾过的模型——不退回 audio 桶，那里多半是 TTS，
 *   拿来生成 BGM 会变成「念描述」。
 */
export function detectOneSentenceGameAudio(
  providers: ModelProviderInstance[],
  unavailable: Partial<Record<'sfx' | 'music', string | null>> = {}
): OneSentenceGameAudioAvailability {
  const sfxConfigured = providers.some(
    (p) =>
      p.enabled &&
      supportsSoundEffect(p.providerKind) &&
      (p.apiKey.trim().length > 0 || allowsEmptyApiKey(p))
  )
  const musicConfigured = !!pickActiveProvider(providers, 'music')
  const notes: string[] = []
  // 配置了但已知账号级不可用（额度 / 套餐）：改用程序化合成，别再白调一次
  const sfxBlocked = sfxConfigured && !!unavailable.sfx
  const musicBlocked = musicConfigured && !!unavailable.music
  if (sfxBlocked)
    notes.push(`SFX model unavailable (${unavailable.sfx}); using procedural synthesis`)
  if (musicBlocked) {
    notes.push(`Music model unavailable (${unavailable.music}); using procedural synthesis`)
  }
  return {
    aiSfx: sfxConfigured && !sfxBlocked,
    aiMusic: musicConfigured && !musicBlocked,
    ...(notes.length ? { notes } : {})
  }
}
