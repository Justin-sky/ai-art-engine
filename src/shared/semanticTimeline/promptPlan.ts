/**
 * 视频生成提示词计划（`aiart.video-prompts@1`）—— 语义编译的产物、语义重建的输入。
 *
 * 为什么单独一个契约（而不是塞进 SemanticTimeline 文档）：
 * - 时间线文档记录的是**媒体事实与导演意图**（谁在哪一秒做了什么），改动它要动 schema；
 * - 提示词是**给生成模型的指令**，随模型能力与措辞习惯变化，且允许人工逐镜修改；
 * - 两者生命周期不同：同一份时间线可以派生出多版提示词计划（不同风格/不同模型），
 *   而时间线不该被生成参数污染。
 *
 * 计划里每一镜都带 **首帧相对路径**（来自分析证据的 keyframe）——语义重建用它做图生视频的
 * 首帧，这样"重建"不是凭空文生视频，而是沿用原片的构图与主体。
 */
import type {
  DirectorIntent,
  Entity,
  SemanticEvent,
  SemanticTimeline,
  ShotEvidence,
  UtteranceEvidence
} from './types'
import type { ProductionCommand } from './compiler'
import { keyframeProjectPath } from './storage'
import { diffAgainstBaseline, type SemanticDiff } from './migrate'
import type { SemanticShot } from './types'

export const VIDEO_PROMPT_PLAN_SCHEMA = 'aiart.video-prompts@1'

/** 生成一句话的语言（跟随界面语言：模型对同语言指令更稳） */
export type PromptLang = 'zh' | 'en'

export interface VideoPromptShot {
  shotId: string
  startSec: number
  durationSec: number
  /** 首帧 / 尾帧（相对工程根）：重建时首帧喂图生视频 */
  firstFrameRelativePath?: string
  lastFrameRelativePath?: string
  prompt: string
  negativePrompt?: string
  /** 拼装来源（便于在编辑器里解释"这句提示词为什么长这样"） */
  camera?: string
  entities: string[]
  eventLabels: string[]
  sourceIntentIds: string[]
  /** 是否由文本模型撰写（false = 规则拼装） */
  modelAuthored?: boolean
  /**
   * 重建策略（v2）：`passthrough` = 未修改，直接裁原片段；`regenerate` = 改过，交给视频模型。
   * 缺省（旧计划 / 无镜头树的时间线）按 `regenerate` 处理，与旧行为一致。
   */
  strategy?: ShotRebuildStrategy
  /** 原片入/出点（秒）：直通裁切与音轨对齐用 */
  sourceStartSec?: number
  sourceEndSec?: number
  /** 为什么要重新生成（prompt / camera / visual / subjects / entity …） */
  changeReasons?: string[]
  /**
   * 本镜主体绑定的参考资产（换人 / 换商品）：重建时作为参考图喂给视频模型，
   * 并且**不再用原片首帧**（原首帧里是被换掉的那个人 / 商品）。
   */
  referenceAssetIds?: string[]
}

export type ShotRebuildStrategy = 'passthrough' | 'regenerate'

/** 需要重新配音的一句台词（时间均为**原片时间**） */
export interface DubLine {
  id: string
  sourceStartSec: number
  sourceEndSec: number
  text: string
  sourceText: string
  speaker?: string
  /** 说话人档案里的音色 / 克隆参考音频 */
  voice?: string
  referenceAudio?: string
}

/** 字幕（用修改后的台词；时间为原片时间） */
export interface PlanSubtitle {
  sourceStartSec: number
  sourceEndSec: number
  text: string
}

export interface VideoPromptPlan {
  schema: typeof VIDEO_PROMPT_PLAN_SCHEMA
  timelineId: string
  sourceAssetId: string
  sourceRelativePath?: string
  lang: PromptLang
  shots: VideoPromptShot[]
  /** 整片模式的合成提示词（重建节点的 full 模式用） */
  fullPrompt: string
  settings: { width: number; height: number; fps: number; durationSec: number }
  /** v2：需要重新配音的台词 */
  dubs?: DubLine[]
  /** v2：字幕（修改后的台词） */
  subtitles?: PlanSubtitle[]
  /** v2：被删除的镜头 */
  removedShotIds?: string[]
}

export interface BuildPromptPlanInput {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  utterances?: UtteranceEvidence[]
  commands?: ProductionCommand[]
  sourceAssetId?: string
  sourceRelativePath?: string
  lang?: PromptLang
  /**
   * 预先算好的脏集合（编译在 LLM 富化**之前**算：富化会补字段，之后再算会把所有镜头误判为改过）。
   * 缺省时按时间线自身的基线现算。
   */
  diff?: SemanticDiff
}

// ─── 规则拼装 ────────────────────────────────────────────────────────────────

/** 命令类型 → 提示词片段（未知类型退化成 `kind`，不丢信息） */
const COMMAND_PHRASES: Record<string, { zh: string; en: string }> = {
  'camera.pushIn': { zh: '镜头缓慢推进', en: 'slow push-in' },
  'camera.pullOut': { zh: '镜头缓慢拉远', en: 'slow pull-out' },
  'camera.panLeft': { zh: '镜头向左摇', en: 'pan left' },
  'camera.panRight': { zh: '镜头向右摇', en: 'pan right' },
  'camera.tiltUp': { zh: '镜头上摇', en: 'tilt up' },
  'camera.tiltDown': { zh: '镜头下摇', en: 'tilt down' },
  'camera.trackIn': { zh: '跟拍靠近', en: 'tracking in' },
  'camera.trackOut': { zh: '跟拍拉远', en: 'tracking out' },
  'camera.handheld': { zh: '手持轻微晃动', en: 'handheld camera' },
  'camera.static': { zh: '固定机位', en: 'static camera' },
  'camera.pan': { zh: '镜头平摇', en: 'camera pan' },
  'camera.tilt': { zh: '镜头上下摇', en: 'camera tilt' },
  'camera.zoom': { zh: '镜头变焦推近', en: 'zoom in' },
  'camera.dolly': { zh: '移动机位推轨', en: 'dolly shot' },
  'camera.orbit': { zh: '环绕运镜', en: 'orbit shot' },
  'camera.rackFocus': { zh: '焦点转移', en: 'rack focus' },
  'light.brighten': { zh: '画面提亮', en: 'brighter lighting' },
  'light.darken': { zh: '画面压暗', en: 'darker, moodier lighting' },
  'grade.eq': { zh: '对比与饱和略增强', en: 'slightly richer contrast and saturation' },
  'light.soften': { zh: '柔光', en: 'soft light' },
  'light.contrastUp': { zh: '加强对比', en: 'higher contrast lighting' },
  'light.warm': { zh: '暖调灯光', en: 'warm lighting' },
  'light.cool': { zh: '冷调灯光', en: 'cool lighting' },
  'grade.warm': { zh: '整体暖色调', en: 'warm color grade' },
  'grade.cool': { zh: '整体冷色调', en: 'cool color grade' },
  'grade.film': { zh: '胶片质感', en: 'film look' },
  'grade.bright': { zh: '明亮通透', en: 'bright and clean' }
}

const NEGATIVE_PROMPT: Record<PromptLang, string> = {
  zh: '画面模糊、变形、多手多指、文字水印、过曝', // cjk-ok
  en: 'blurry, distorted, extra fingers, watermark, overexposed'
}

/** 实体类别在提示词里的说法（中英成对，缺省沿用 kind 原值） */
const ENTITY_KIND_LABEL: Record<string, Record<PromptLang, string>> = {
  person: { zh: '人物', en: 'person' },
  product: { zh: '商品', en: 'product' },
  logo: { zh: '标识', en: 'logo' }
}

/** 台词前缀（中英成对） */
const DIALOGUE_PREFIX: Record<PromptLang, string> = { zh: '台词：', en: 'dialogue: ' }

/**
 * 提示词长度上限（字符）。
 *
 * 实测（用户真实工程，9 镜 / 129 命令）：无上限时单镜贴近千字、整片 5313 字 ——
 * 视频模型会直接截断，等于最要紧的信息（主体 / 动作）反而可能被切掉。宁可我们自己
 * 按优先级截断，也不要让模型随机截断。
 */
const MAX_SHOT_PROMPT_CHARS = 220
const MAX_FULL_PROMPT_CHARS = 600

/** 单镜最多纳入几个事件（按重要度×重叠时长排序取前几个，避免"整镜全塞"） */
const MAX_EVENTS_PER_SHOT = 3

/** 能进**画面**提示词的意图轨道：其余（audio/text/edit/story/emotion）属于声音与剪辑，不该进 prompt */
const PICTURE_TRACKS = new Set(['camera', 'light', 'vfx'])

/**
 * 能进**画面**提示词的实体类别（数组顺序即优先级）。
 *
 * 实测：用户那支片子一镜挂 11 个实体（含 `text` 的 OCR 文字、`logo`、`voice` 音色），
 * 全塞进去会把 220 字预算吃光，动作与运镜反被截断 —— 而 OCR 文字/logo 本来就在画面里，
 * `voice` 更不是画面内容，都不该占提示词。
 */
const PICTURE_ENTITY_KINDS: readonly string[] = ['person', 'product', 'object', 'background']
/** 单镜最多列几个实体（主体优先） */
const MAX_ENTITIES_PER_SHOT = 3

/** 各字段的空值/默认：缺字段的时间线（空骨架、手写 JSON）也要能算 */
function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
}

/** 重叠时长（秒）：事件排序用（"重要且占了这镜大半"的排前面） */
function overlapSeconds(
  a: { start: number; end: number },
  b: { start: number; end: number }
): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/** 去重：丢掉完全重复的片段，以及已被更长片段包含的片段（"固定中景" vs "固定中景平视"） */
function dedupeParts(parts: string[]): string[] {
  const out: string[] = []
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    if (out.some((kept) => kept === part || kept.includes(part))) continue
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (part.includes(out[i]!)) out.splice(i, 1)
    }
    out.push(part)
  }
  return out
}

/** 按分隔符边界截断（不把词切一半；超出部分丢弃） */
function truncateAtSeparator(text: string, max: number, sep: string): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const cut = head.lastIndexOf(sep)
  return (cut > max * 0.5 ? head.slice(0, cut) : head).trim()
}

/**
 * 命令名规范化：规则引擎产出 snake_case（`camera.push_in` / `light.brighten`），
 * 提示词表用 camelCase（`camera.pushIn`）。以前两边对不上，内置规则（价格推镜、
 * 报价提亮）在 `COMMAND_PHRASES[kind]` 处被整条过滤掉。`vfx.*` 的光影动作也归到 `light.*`。
 */
export function normalizeCommandKind(kind: string): string {
  const raw = String(kind ?? '').trim()
  const dot = raw.indexOf('.')
  if (dot <= 0) return raw
  let ns = raw.slice(0, dot)
  const action = raw.slice(dot + 1).replace(/[_-]+([a-z0-9])/gi, (_m, c: string) => c.toUpperCase())
  if (ns === 'vfx' && /^(brighten|darken|soften|warm|cool|contrastUp)$/.test(action)) ns = 'light'
  return `${ns}.${action}`
}

function phraseOf(kind: string, lang: PromptLang): string {
  const hit = COMMAND_PHRASES[normalizeCommandKind(kind)]
  if (hit) return lang === 'zh' ? hit.zh : hit.en
  // 未知命令：保留 kind（下游执行器本来就按 kind 前缀分派），不硬编造中文
  return kind
}

function entityLabel(entity: Entity, lang: PromptLang): string {
  const kind = ENTITY_KIND_LABEL[entity.kind]?.[lang] ?? entity.kind
  return lang === 'zh' ? `${entity.name}（${kind}）` : `${entity.name} (${kind})`
}

/**
 * 规则拼装一镜的提示词。
 *
 * 组成（顺序固定，便于人工比对与稳定 diff）：实体主体 → 事件动作/情绪 → 台词 → 运镜/光影/色调。
 * 所有片段来自**时间线已有的事实**，不调用模型，因此可离线、可复现、零成本。
 */
function buildShotPrompt(input: {
  shot: ShotEvidence
  events: SemanticEvent[]
  intents: DirectorIntent[]
  entities: Entity[]
  commands: ProductionCommand[]
  utterances: UtteranceEvidence[]
  lang: PromptLang
  /** v2 结构化镜头（有就优先用：主体动作 / 镜头语言 / 画面风格都来自它） */
  structured?: SemanticShot
}): {
  prompt: string
  camera?: string
  eventLabels: string[]
  entities: string[]
  sourceIntentIds: string[]
} {
  const { shot, lang, structured } = input
  const sep = lang === 'zh' ? '，' : ', '
  const parts: string[] = []

  // 人工覆盖（结构化镜头上的 promptOverride）：原样作为本镜提示词
  const override = structured?.promptOverride?.trim()
  if (override) {
    return {
      prompt: override,
      eventLabels: [],
      entities: arr(structured?.subjects).map((s) => s.name),
      sourceIntentIds: []
    }
  }

  // 结构化主体 + 动作（"主播（人物）举起托特包"）优先于只列实体名
  const subjectTexts = arr(structured?.subjects)
    .filter((s) => s?.name?.trim())
    .slice(0, MAX_ENTITIES_PER_SHOT)
    .map((s) => {
      const ent = s.entityId ? input.entities.find((e) => e.id === s.entityId) : undefined
      const label = ent ? entityLabel({ ...ent, name: s.name }, lang) : s.name.trim()
      return [label, s.action?.trim(), s.emotion?.trim()]
        .filter(Boolean)
        .join(lang === 'zh' ? '' : ' ')
    })

  const entityNames = subjectTexts.length
    ? subjectTexts
    : input.entities
        .filter((ent) => arr(ent.appearances).some((app) => app?.shotId === shot.id))
        // 只留画面主体类，并按优先级（人物/商品/物体/背景）取前几个
        .filter((ent) => PICTURE_ENTITY_KINDS.includes(String(ent.kind ?? '')))
        .sort(
          (a, b) =>
            PICTURE_ENTITY_KINDS.indexOf(String(a.kind ?? '')) -
            PICTURE_ENTITY_KINDS.indexOf(String(b.kind ?? ''))
        )
        .slice(0, MAX_ENTITIES_PER_SHOT)
        .map((ent) => entityLabel(ent, lang))
  if (entityNames.length) parts.push(dedupeParts(entityNames).join(lang === 'zh' ? '、' : ', '))
  const visualDescription = structured?.visual?.description?.trim()
  if (visualDescription) parts.push(visualDescription)

  /**
   * 事件：**按重要度 × 重叠时长排序后只取前几个**。
   *
   * 真实数据上"整镜全塞"是最主要的质量问题：一镜 14 秒会和 6 个事件重叠，
   * 全拼进去近千字，模型只会截断 —— 主体与动作反而被切掉。
   */
  const rankedEvents = [...input.events]
    .sort(
      (a, b) =>
        (b.importance ?? 0) * overlapSeconds(b.timeRange, shot.range) -
        (a.importance ?? 0) * overlapSeconds(a.timeRange, shot.range)
    )
    .slice(0, MAX_EVENTS_PER_SHOT)
  const eventTexts = rankedEvents
    .map((event) => [event.description?.trim(), event.label?.trim()].filter(Boolean).join(' / '))
    .filter(Boolean)
  const eventLabels = rankedEvents.map((event) => event.label).filter(Boolean)
  if (eventTexts.length) parts.push(dedupeParts(eventTexts).join(sep))

  const lines = input.utterances.map((utt) => utt.text?.trim()).filter(Boolean)
  if (lines.length) parts.push(`${DIALOGUE_PREFIX[lang]}${lines[0]}`)

  const cameraKinds: string[] = []
  const intentTexts: string[] = []
  const sourceIntentIds: string[] = []
  for (const command of input.commands) {
    const kind = normalizeCommandKind(String(command.kind))
    /**
     * 只翻**认识**的命令：规则包会把中文动作塞进 `kind`（`light.价格弹跳与箭头`、
     * `camera.固定中景`），原样拼进提示词等于把执行清单喂给模型 —— 直接跳过。
     */
    if (!COMMAND_PHRASES[kind]) continue
    if (kind.startsWith('camera.')) {
      cameraKinds.push(phraseOf(kind, lang))
      continue
    }
    if (kind.startsWith('light.') || kind.startsWith('grade.')) {
      parts.push(phraseOf(kind, lang))
    }
  }
  // 结构化镜头语言（景别 / 角度 / 运镜 / 焦段）排在命令推导的运镜之前：它是"原片事实"
  const cam = structured?.camera
  const structuredCamera = [cam?.shotSize, cam?.angle, cam?.motion, cam?.lens]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  const cameraPhrases = dedupeParts([...structuredCamera, ...cameraKinds])
  if (cameraPhrases.length) parts.push(cameraPhrases.join(sep))
  const vis = structured?.visual
  const visualStyle = [vis?.style, vis?.lighting, vis?.grade, ...arr(vis?.palette)]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (visualStyle.length) parts.push(dedupeParts(visualStyle).join(sep))

  for (const intent of input.intents) {
    sourceIntentIds.push(intent.id)
    // 只取**画面**轨道的技术动作：声音 / 字幕 / 剪辑类（口播重音、拉链音效、硬切、长镜不切）
    // 属于后期与声音设计，不该进画面生成提示词
    const techniques = arr(intent.techniques)
      .filter((tech) => PICTURE_TRACKS.has(String(tech?.track ?? '')))
      .map((tech) => String(tech?.action ?? '').trim())
      .filter(Boolean)
    const goal = String(intent.goal ?? '').trim()
    const text = techniques.length ? dedupeParts(techniques).join(sep) : goal
    if (text) intentTexts.push(text)
  }
  if (intentTexts.length) parts.push(dedupeParts(intentTexts).join(sep))

  const prompt = truncateAtSeparator(parts.filter(Boolean).join(sep), MAX_SHOT_PROMPT_CHARS, sep)
  return {
    prompt,
    ...(cameraPhrases.length ? { camera: cameraPhrases.join(sep) } : {}),
    eventLabels,
    entities: entityNames,
    sourceIntentIds
  }
}

/** 计划里的每镜提示词被改过（如编译要求追加）后，重算整片提示词 */
export function combinePlanFullPrompt(shots: VideoPromptShot[], lang: PromptLang): string {
  return combineFullPrompt(shots, lang)
}

/** 整片提示词：按镜头顺序把每镜提示词接起来（给 full 模式用），并做长度上限 */
function combineFullPrompt(shots: VideoPromptShot[], lang: PromptLang): string {
  const sep = lang === 'zh' ? '；' : '; '
  const joined = shots
    .map((shot) => shot.prompt?.trim())
    .filter(Boolean)
    .join(sep)
  return truncateAtSeparator(joined, MAX_FULL_PROMPT_CHARS, sep)
}

export function buildPromptPlan(input: BuildPromptPlanInput): VideoPromptPlan {
  const { timeline } = input
  const lang: PromptLang = input.lang ?? 'zh'
  const shots = arr(input.shots).filter((shot) => !!shot?.id && !!shot.range)
  const events = arr(timeline?.events)
  const intents = arr(timeline?.intents)
  const entities = arr(timeline?.entities)
  const commands = arr(input.commands)
  const timelineId = String(timeline?.id ?? '')
  /**
   * v2：有结构化镜头树就以它为准（顺序、删镜、修改后的字段）；台词用修改后的 `dialogue`。
   * 没有（旧计划 / 手写时间线）时退回证据镜头，`strategy` 不填 = 旧行为（全部重新生成）。
   */
  const structuredShots = arr(timeline?.shots)
  const isV2 = structuredShots.length > 0
  const dialogue = arr(timeline?.dialogue)
  const utterances: UtteranceEvidence[] = dialogue.length
    ? dialogue.map((d) => ({
        id: d.id,
        range: d.range,
        text: d.text,
        granularity: d.granularity,
        confidence: d.confidence
      }))
    : arr(input.utterances)
  const diff: SemanticDiff | undefined = isV2
    ? (input.diff ?? diffAgainstBaseline(timeline))
    : undefined
  const structuredById = new Map(structuredShots.map((s) => [s.id, s]))
  const removedShotIds = structuredShots.filter((s) => s.removed).map((s) => s.id)
  const walk: ShotEvidence[] = isV2
    ? structuredShots
        .filter((s) => !s.removed && s.range)
        .map((s) => ({ id: s.id, range: s.range, keyframes: s.keyframes ?? {}, confidence: 1 }))
    : shots

  const promptShots: VideoPromptShot[] = walk.map((shot) => {
    const structured = structuredById.get(shot.id)
    const inShotEvents = events.filter((event) => overlaps(event.timeRange, shot.range))
    const eventIds = new Set(inShotEvents.map((event) => event.id))
    const inShotIntents = intents.filter((intent) => {
      const trigger = String(intent.trigger ?? '')
      if (!trigger) return false
      if (eventIds.has(trigger)) return true
      const hit = inShotEvents.find((event) => event.label === trigger)
      if (hit) return true
      // 兜底：意图按时间落在这镜里（事件 label 手写过、对不上时仍能带上）
      const range = (intent as { timeRange?: { start: number; end: number } }).timeRange
      return !!range && overlaps(range, shot.range)
    })
    const inShotCommands = commands.filter((command) =>
      overlaps({ start: command.start, end: command.end }, shot.range)
    )
    const inShotUtterances = utterances.filter((utt) => overlaps(utt.range, shot.range))

    const built = buildShotPrompt({
      shot,
      events: inShotEvents,
      intents: inShotIntents,
      entities,
      commands: inShotCommands,
      utterances: inShotUtterances,
      lang,
      ...(structured ? { structured } : {})
    })
    const reasons = diff?.dirtyShots.get(shot.id)
    const referenceAssetIds = [
      ...new Set(
        arr(structured?.subjects)
          .map((s) => (s.entityId ? entities.find((e) => e.id === s.entityId) : undefined))
          .map((e) => e?.reference?.assetId?.trim() ?? '')
          .filter(Boolean)
      )
    ]
    return {
      shotId: shot.id,
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(structured
        ? {
            strategy: (reasons ? 'regenerate' : 'passthrough') as ShotRebuildStrategy,
            sourceStartSec: structured.sourceSegment?.start ?? shot.range.start,
            sourceEndSec: structured.sourceSegment?.end ?? shot.range.end,
            ...(reasons ? { changeReasons: reasons } : {})
          }
        : {}),
      startSec: shot.range.start,
      durationSec: Math.max(0.05, shot.range.end - shot.range.start),
      // 证据路径相对 `Semantic/<id>/`；计划里统一成工程相对路径（重建按工程根解析首帧）
      ...(shot.keyframes?.middle || shot.keyframes?.first
        ? {
            firstFrameRelativePath: keyframeProjectPath(
              timelineId,
              shot.keyframes.middle ?? shot.keyframes.first
            )
          }
        : {}),
      ...(shot.keyframes?.last
        ? { lastFrameRelativePath: keyframeProjectPath(timelineId, shot.keyframes.last) }
        : {}),
      prompt: built.prompt,
      negativePrompt: NEGATIVE_PROMPT[lang],
      ...(built.camera ? { camera: built.camera } : {}),
      entities: built.entities,
      eventLabels: built.eventLabels,
      sourceIntentIds: built.sourceIntentIds
    }
  })

  const source = timeline?.source
  return {
    schema: VIDEO_PROMPT_PLAN_SCHEMA,
    timelineId: String(timeline?.id ?? ''),
    sourceAssetId: String(input.sourceAssetId || source?.assetId || ''),
    ...(input.sourceRelativePath?.trim()
      ? { sourceRelativePath: input.sourceRelativePath.trim() }
      : {}),
    lang,
    shots: promptShots,
    fullPrompt: combineFullPrompt(promptShots, lang),
    settings: {
      width: Number(source?.width) || 0,
      height: Number(source?.height) || 0,
      fps: Number(source?.fps) || 30,
      durationSec: Number(source?.duration) || 0
    },
    ...(isV2
      ? {
          dubs: buildDubLines(timeline, diff!),
          subtitles: dialogue
            .filter((d) => d.text?.trim())
            .map((d) => ({
              sourceStartSec: d.range.start,
              sourceEndSec: d.range.end,
              text: d.text.trim()
            })),
          removedShotIds
        }
      : {})
  }
}

/** 改过的台词 → 配音清单（带说话人档案里的音色 / 克隆参考） */
function buildDubLines(timeline: SemanticTimeline, diff: SemanticDiff): DubLine[] {
  const speakers = new Map(arr(timeline.speakers).map((s) => [s.id, s]))
  const vocals = timeline.evidence?.stems?.vocals?.trim() || undefined
  return arr(timeline.dialogue)
    .filter((d) => diff.dirtyDialogue.has(d.id) && d.text?.trim())
    .map((d) => {
      const profile = d.speaker ? speakers.get(d.speaker) : undefined
      return {
        id: d.id,
        sourceStartSec: d.range.start,
        sourceEndSec: d.range.end,
        text: d.text.trim(),
        sourceText: d.sourceText,
        ...(d.speaker ? { speaker: d.speaker } : {}),
        ...(profile?.voice ? { voice: profile.voice } : {}),
        // 克隆参考：说话人档案优先，否则用分析时分离出的原人声（工程相对路径）
        ...(profile?.referenceAudio || vocals
          ? { referenceAudio: profile?.referenceAudio || vocals }
          : {})
      }
    })
}

// ─── 人工覆盖 / 序列化 / 摘要 ────────────────────────────────────────────────

/**
 * 把 dive 里人工改过的提示词并回计划（按 `shotId`）。
 *
 * 接受 `{"<shotId>": "提示词"}` 或 `[{shotId, prompt, negativePrompt?}]`：
 * 前者是 UI 写的紧凑格式，后者便于 agent/手写；两种都容忍字段缺失。
 */
export function applyPromptOverrides(plan: VideoPromptPlan, raw: unknown): VideoPromptPlan {
  const text = typeof raw === 'string' ? raw.trim() : ''
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    if (!text) return plan
    try {
      parsed = JSON.parse(text)
    } catch {
      return plan
    }
  }
  const byId = new Map<string, { prompt?: string; negativePrompt?: string }>()
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const row = item as { shotId?: unknown; prompt?: unknown; negativePrompt?: unknown }
      const id = typeof row?.shotId === 'string' ? row.shotId.trim() : ''
      if (!id) continue
      byId.set(id, {
        ...(typeof row.prompt === 'string' ? { prompt: row.prompt } : {}),
        ...(typeof row.negativePrompt === 'string' ? { negativePrompt: row.negativePrompt } : {})
      })
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') byId.set(id, { prompt: value })
      else if (value && typeof value === 'object') {
        const row = value as { prompt?: unknown; negativePrompt?: unknown }
        byId.set(id, {
          ...(typeof row.prompt === 'string' ? { prompt: row.prompt } : {}),
          ...(typeof row.negativePrompt === 'string' ? { negativePrompt: row.negativePrompt } : {})
        })
      }
    }
  }
  if (!byId.size) return plan

  const shots = plan.shots.map((shot) => {
    const override = byId.get(shot.shotId)
    if (!override) return shot
    return {
      ...shot,
      ...(override.prompt != null ? { prompt: override.prompt } : {}),
      ...(override.negativePrompt != null ? { negativePrompt: override.negativePrompt } : {}),
      // 覆盖后不再是模型原文：标出来，便于 UI 提示"这条被改过"
      modelAuthored: false,
      // 人工改了提示词 = 想要不同的画面：这一镜改为重新生成
      ...(override.prompt != null && override.prompt.trim() && shot.strategy
        ? {
            strategy: 'regenerate' as const,
            changeReasons: [...new Set([...(shot.changeReasons ?? []), 'prompt'])]
          }
        : {})
    }
  })
  return { ...plan, shots, fullPrompt: combineFullPrompt(shots, plan.lang) }
}

export function serializePromptPlan(plan: VideoPromptPlan): string {
  return JSON.stringify(plan, null, 2)
}

export function parsePromptPlan(raw: unknown): VideoPromptPlan | null {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null
  try {
    const doc = JSON.parse(text) as VideoPromptPlan
    if (!doc || doc.schema !== VIDEO_PROMPT_PLAN_SCHEMA || !Array.isArray(doc.shots)) return null
    return doc
  } catch {
    return null
  }
}

export interface PromptPlanSummary {
  shots: number
  withFirstFrame: number
  withPrompt: number
  modelAuthored: number
}

export function summarizePromptPlan(plan: VideoPromptPlan | null | undefined): PromptPlanSummary {
  const shots = arr(plan?.shots)
  return {
    shots: shots.length,
    withFirstFrame: shots.filter((shot) => !!shot.firstFrameRelativePath).length,
    withPrompt: shots.filter((shot) => !!shot.prompt?.trim()).length,
    modelAuthored: shots.filter((shot) => shot.modelAuthored === true).length
  }
}

// ─── 重建计划（决定"要生成几次"） ────────────────────────────────────────────

export type RebuildMode = 'shots' | 'full'

export interface RebuildClip {
  /** shots 模式 = shotId；full 模式 = 'full' */
  key: string
  prompt: string
  negativePrompt?: string
  durationSec: number
  firstFrameRelativePath?: string
  lastFrameRelativePath?: string
  /** 参考资产（换人 / 换商品）；有它时不用原片首帧 */
  referenceAssetIds?: string[]
}

/**
 * 成片里的一段（按输出顺序）：`source` 直通原片入/出点，`generate` 用对应的生成片段。
 * 生成段也带原片入/出点（若有）：拼接时把生成片段对齐到原镜头时长，音轨才不错位。
 */
export interface RebuildSegment {
  key: string
  kind: 'source' | 'generate'
  durationSec: number
  sourceStartSec?: number
  sourceEndSec?: number
}

export interface RebuildPlan {
  mode: RebuildMode
  /** 需要调用视频模型的片段（= 要花钱的次数） */
  clips: RebuildClip[]
  /** 成片的全部段（含直通段），按输出顺序 */
  segments: RebuildSegment[]
  /** 直通原片的镜头数 */
  passthrough: number
  /** 需要重新配音的台词 */
  dubs: DubLine[]
  /** 因为超过上限被跳过的镜头数（只可能出现在 shots 模式） */
  skippedByLimit: number
  /** 没有提示词、无法生成的镜头数 */
  skippedEmpty: number
}

/**
 * 决定重建要生成几次。**纯函数**：UI 能先算"这次会调用几次生成"，不必真的跑。
 *
 * - `shots`：每镜一次（首帧 = 该镜关键帧），受 `maxShots` 截断；
 * - `full`：整片一次（提示词 = `fullPrompt`，时长 = 时间线总时长）。
 */
export function planRebuildClips(
  plan: VideoPromptPlan | null | undefined,
  options: { mode?: RebuildMode; maxShots?: number; regenerateAll?: boolean } = {}
): RebuildPlan {
  const mode: RebuildMode = options.mode === 'full' ? 'full' : 'shots'
  const shots = arr(plan?.shots)
  const dubs = arr(plan?.dubs)
  if (mode === 'full') {
    const prompt = plan?.fullPrompt?.trim() || combineFullPrompt(shots, plan?.lang ?? 'zh')
    const durationSec = Number(plan?.settings?.durationSec) || 5
    return {
      mode,
      clips: prompt ? [{ key: 'full', prompt, durationSec }] : [],
      segments: prompt ? [{ key: 'full', kind: 'generate', durationSec }] : [],
      passthrough: 0,
      dubs,
      skippedByLimit: 0,
      skippedEmpty: prompt ? 0 : 1
    }
  }

  const max = Math.max(1, Number(options.maxShots) || shots.length || 1)
  const clips: RebuildClip[] = []
  const segments: RebuildSegment[] = []
  let passthrough = 0
  let skippedByLimit = 0
  let skippedEmpty = 0
  for (const shot of shots) {
    const hasSource =
      Number.isFinite(shot.sourceStartSec) &&
      Number.isFinite(shot.sourceEndSec) &&
      (shot.sourceEndSec as number) > (shot.sourceStartSec as number)
    const source = hasSource
      ? { sourceStartSec: shot.sourceStartSec as number, sourceEndSec: shot.sourceEndSec as number }
      : {}
    // 旧计划没有 strategy：一律重新生成（旧行为）
    const wantsGenerate = options.regenerateAll === true || shot.strategy !== 'passthrough'
    const prompt = shot.prompt?.trim() ?? ''
    if (wantsGenerate && prompt && clips.length < max) {
      clips.push({
        key: shot.shotId,
        prompt,
        ...(shot.negativePrompt ? { negativePrompt: shot.negativePrompt } : {}),
        durationSec: shot.durationSec,
        ...(shot.firstFrameRelativePath
          ? { firstFrameRelativePath: shot.firstFrameRelativePath }
          : {}),
        ...(shot.lastFrameRelativePath
          ? { lastFrameRelativePath: shot.lastFrameRelativePath }
          : {}),
        ...(shot.referenceAssetIds?.length ? { referenceAssetIds: shot.referenceAssetIds } : {})
      })
      segments.push({
        key: shot.shotId,
        kind: 'generate',
        durationSec: shot.durationSec,
        ...source
      })
      continue
    }
    if (wantsGenerate) {
      if (!prompt) skippedEmpty += 1
      else skippedByLimit += 1
    }
    // 未改 / 超上限 / 无提示词：有原片入出点就直通原片（成片不缺镜），否则只能跳过
    if (hasSource) {
      passthrough += 1
      segments.push({ key: shot.shotId, kind: 'source', durationSec: shot.durationSec, ...source })
    }
  }
  return { mode, clips, segments, passthrough, dubs, skippedByLimit, skippedEmpty }
}
