/**
 * Semantic Timeline 相关节点执行器。
 *
 * 真实管线（切镜 / 转写 / 实体 / 构建）在主进程，经 ctx 能力注入；
 * 能力缺失（单测 / 无工程）时退回纯启发式，并写 warn 日志说明。
 */
import type { GraphValue, GraphVideoItem, NodeExecuteContext } from './types'
import {
  assignBeatsHeuristic,
  buildEntityShotIndex,
  collectRulePacks,
  compileDirectorCommands,
  createEmptySemanticTimeline,
  draftsToEvents,
  findRecipe,
  findVocabularyInPacks,
  freezeBuildDefinition,
  heuristicEventsFromUtterances,
  inferIntentsFromEvents,
  instantiateRecipe,
  intentId,
  normalizeSemanticEdits,
  parseEventDrafts,
  parseJsonArray,
  parseShotDescriptions,
  planInvalidation,
  rebuildTracks,
  semanticToScriptTimeline,
  singleShot,
  timelineVersionHash,
  type BeatVocabulary,
  type DirectorIntent,
  type IntentTechnique,
  type RawEventDraft,
  type SemanticBuildResponse,
  type SemanticEdit,
  type SemanticPack,
  type SemanticTimeline,
  type SemanticTrackKind,
  type ShotEvidence,
  type UtteranceEvidence
} from '../../semanticTimeline'
import { validateSemanticTimeline } from '../../semanticTimeline'
import { semanticTimelineValue } from './semanticTimelineValue'

/** 变体批量构建上限（防配方槽位笛卡尔积爆炸） */
const MAX_VARIANTS = 12
/** 镜头描述一次最多看的关键帧数 */
const MAX_DESCRIBE_SHOTS = 8

const TRACK_KINDS: ReadonlySet<SemanticTrackKind> = new Set<SemanticTrackKind>([
  'story',
  'character',
  'camera',
  'emotion',
  'audio',
  'text',
  'vfx',
  'edit'
])

function outText(text: string): Record<string, GraphValue> {
  return { out: { kind: 'text', text } }
}

function isEn(ctx: NodeExecuteContext): boolean {
  return (ctx.locale ?? '').toLowerCase().startsWith('en')
}

function say(
  ctx: NodeExecuteContext,
  zh: string,
  en: string,
  level?: 'info' | 'warn' | 'error'
): void {
  ctx.log?.(isEn(ctx) ? en : zh, level)
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function parseJsonParam<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function loadPacks(ctx: NodeExecuteContext): Promise<SemanticPack[]> {
  if (!ctx.listSemanticPacks) return []
  try {
    return await ctx.listSemanticPacks()
  } catch (e) {
    say(
      ctx,
      `读取语义市场包失败：${errorText(e)}`, // cjk-ok
      `Failed to list semantic packs: ${errorText(e)}`,
      'warn'
    )
    return []
  }
}

// ─── Upstream video ─────────────────────────────────────────────────────────

interface UpstreamVideo {
  assetId?: string
  relativePath?: string
}

function fromVideoItem(item: GraphVideoItem | undefined, ctx: NodeExecuteContext): UpstreamVideo {
  if (!item) return {}
  const rel = item.relativePath?.trim()
  const id = item.id?.trim()
  const isAsset = !!id && (ctx.hasAsset?.(id) ?? false)
  return { assetId: isAsset ? id : undefined, relativePath: rel || undefined }
}

/** in-video 端口：单视频 / 视频数组 / 资产 / 输出节点 */
function resolveUpstreamVideo(ctx: NodeExecuteContext): UpstreamVideo {
  for (const value of ctx.inputs['in-video'] ?? []) {
    if (value.kind === 'video') return fromVideoItem(value, ctx)
    if (value.kind === 'videos') return fromVideoItem(value.items[0], ctx)
    if (value.kind === 'asset' && value.assetType === 'video') {
      return { assetId: value.assetId, relativePath: value.relativePath }
    }
    if (value.kind === 'output') {
      const asset = value.items.find((i) => i.assetType === 'video')
      if (asset) return { assetId: asset.assetId, relativePath: asset.relativePath }
      if (value.videos?.length) return fromVideoItem(value.videos[0], ctx)
    }
  }
  return {}
}

// ─── LLM enrichment (GraphSkill) ────────────────────────────────────────────

async function runSkill(
  ctx: NodeExecuteContext,
  skillId: string,
  prompt: string,
  images?: string[],
  onError?: (reason: string) => void
): Promise<string | null> {
  // 动态导入：graphSkills → anim2d 等会经 builtins 回到本模块，静态导入会触发循环初始化
  const { getGraphSkill } = await import('../graphSkills')
  const skill = getGraphSkill(skillId)
  if (!skill || !ctx.generateText) return null
  const en = isEn(ctx)
  const system = en
    ? skill.systemPromptEn || skill.systemPromptZh
    : skill.systemPromptZh || skill.systemPromptEn
  const instruction = en
    ? skill.instructionEn || skill.instructionZh
    : skill.instructionZh || skill.instructionEn
  try {
    const res = await ctx.generateText({
      prompt: instruction ? `${instruction}\n\n${prompt}` : prompt,
      system,
      images: images?.length ? images : undefined,
      model: ctx.node.params?.generateModel || undefined,
      providerInstanceId: ctx.node.params?.generateProviderInstanceId || undefined
    })
    return res.text
  } catch (e) {
    const reason = errorText(e)
    say(ctx, `${skillId} 调用失败：${reason}`, `${skillId} failed: ${reason}`, 'warn') // cjk-ok
    onError?.(reason)
    return null
  }
}

function fmtRange(r: { start: number; end: number }): string {
  return `${r.start.toFixed(2)}-${r.end.toFixed(2)}s`
}

interface EnrichInput {
  doc: SemanticTimeline
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
  keyframes: Record<string, string>
  vocabulary?: BeatVocabulary
}

/**
 * 三步 LLM 理解：镜头描述（看关键帧）→ 事件抽取（强制证据）→ 导演意图。
 * 任何一步失败都保留启发式结果，不中断分析。
 */
async function enrichTimelineWithLlm(
  ctx: NodeExecuteContext,
  input: EnrichInput
): Promise<SemanticTimeline> {
  const { doc, shots, utterances, keyframes } = input
  const fps = doc.source.fps
  const shotById = new Map(shots.map((s) => [s.id, s]))
  /**
   * 三步富化各自的失败原因（同一步失败只记第一条）。
   *
   * 为什么要收集：这一步失败是**静默降级**——节点仍然 `done`、时间线照样有启发式事件，
   * 用户从结果上看不出「镜头描述/导演意图是空的」。三条分散的 warn 也拼不出「富化整体没
   * 生效、原因是模型不可用」。这里汇总成一条可执行的提示（含模型/提供商线索）。
   */
  const failures: Array<{ skillId: string; reason: string }> = []
  const trackFailure = (skillId: string) => (reason: string) => {
    if (!failures.some((f) => f.skillId === skillId)) failures.push({ skillId, reason })
  }

  // 1) 镜头描述
  const describeShots = shots.filter((s) => keyframes[s.id]).slice(0, MAX_DESCRIBE_SHOTS)
  const images: string[] = []
  const imageShots: ShotEvidence[] = []
  if (ctx.resolveProjectMediaUrl) {
    for (const s of describeShots) {
      const url = await ctx.resolveProjectMediaUrl(keyframes[s.id]!).catch(() => undefined)
      if (url) {
        images.push(url)
        imageShots.push(s)
      }
    }
  }
  const descriptions = new Map<string, string>()
  const cameraDrafts: RawEventDraft[] = []
  if (images.length > 0) {
    say(ctx, `镜头描述：${images.length} 个关键帧`, `Shot describe: ${images.length} keyframes`) // cjk-ok
    const text = await runSkill(
      ctx,
      'semantic.shotDescribe',
      `Images are in this order (one keyframe per shot):\n${imageShots.map((s, i) => `${i + 1}. ${s.id} ${fmtRange(s.range)}`).join('\n')}`,
      images,
      trackFailure('semantic.shotDescribe')
    )
    for (const d of text ? parseShotDescriptions(text) : []) {
      const shot = shotById.get(d.shotId)
      if (!shot) continue
      const desc = [d.subject, d.action, d.emotion, d.shotSize, d.angle, d.cameraMotion]
        .filter(Boolean)
        .join(' / ')
      descriptions.set(shot.id, desc)
      if (d.cameraMotion || d.shotSize) {
        cameraDrafts.push({
          label: (d.cameraMotion || d.shotSize || 'shot').toLowerCase().replace(/\s+/g, '_'),
          type: 'camera',
          description: desc,
          start: shot.range.start,
          end: shot.range.end,
          evidence: [shot.id],
          importance: 0.4
        })
      }
    }
  }
  const cameraEvents = draftsToEvents(cameraDrafts, fps, doc.events)

  // 2) 事件抽取
  const knownIds = new Set<string>([
    ...shots.map((s) => s.id),
    ...utterances.map((u) => u.id),
    ...doc.entities.map((e) => e.id)
  ])
  const evidencePrompt = [
    `Video duration ${doc.source.duration.toFixed(2)}s, fps ${fps}.`,
    'Shots:',
    ...shots.map(
      (s) =>
        `- ${s.id} ${fmtRange(s.range)}${descriptions.has(s.id) ? ` ${descriptions.get(s.id)}` : ''}`
    ),
    'Utterances:',
    ...(utterances.length
      ? utterances.map((u) => `- ${u.id} ${fmtRange(u.range)} ${u.text}`)
      : ['(none)']),
    'Entities:',
    ...(doc.entities.length
      ? doc.entities.map((e) => `- ${e.id} ${e.kind} ${e.name}`)
      : ['(none)']),
    'Use only the ids above as evidence. start/end are seconds.'
  ].join('\n')
  let storyEvents = doc.events
  const eventText = await runSkill(
    ctx,
    'semantic.eventExtract',
    evidencePrompt,
    undefined,
    trackFailure('semantic.eventExtract')
  )
  if (eventText) {
    const drafts = parseEventDrafts(eventText).map((d) => ({
      ...d,
      evidence: d.evidence.filter((id) => knownIds.has(id))
    }))
    const extracted = draftsToEvents(drafts, fps, doc.events)
    if (extracted.length > 0) {
      storyEvents = extracted
      say(
        ctx,
        `事件抽取：${extracted.length} 个有证据事件`, // cjk-ok
        `Event extract: ${extracted.length} evidenced events`
      )
    } else {
      say(
        ctx,
        '事件抽取没有返回带证据的事件，保留启发式结果', // cjk-ok
        'Event extract returned no evidenced events; kept heuristics',
        'warn'
      )
    }
  }
  const events = [
    ...storyEvents,
    ...cameraEvents.filter((c) => !storyEvents.some((e) => e.id === c.id))
  ]
  const beats = assignBeatsHeuristic(
    events,
    doc.source.duration,
    fps,
    input.vocabulary ?? doc.vocabulary
  )

  // 3) 导演意图
  let intents = inferIntentsFromEvents(events)
  if (events.length > 0) {
    const intentText = await runSkill(
      ctx,
      'semantic.directorInfer',
      [
        'Events:',
        ...events.map(
          (e) => `- ${e.id} [${e.type}] ${e.label} ${fmtRange(e.timeRange)} ${e.description}`
        ),
        `Allowed tracks: ${[...TRACK_KINDS].join(', ')}. trigger must be an event id above.`
      ].join('\n'),
      undefined,
      trackFailure('semantic.directorInfer')
    )
    const parsed = intentText
      ? parseJsonArray<{
          trigger?: string
          goal?: string
          techniques?: IntentTechnique[]
          reason?: string
        }>(intentText)
      : []
    const agentIntents: DirectorIntent[] = []
    for (const raw of parsed) {
      const event = events.find((e) => e.id === raw.trigger || e.label === raw.trigger)
      const techniques = (raw.techniques ?? []).filter(
        (t) => t && TRACK_KINDS.has(t.track) && typeof t.action === 'string' && t.action
      )
      if (!event || techniques.length === 0) continue
      const goal = String(raw.goal || 'emphasize')
      agentIntents.push({
        id: intentId(event.id, goal),
        trigger: event.id,
        goal,
        techniques,
        reason: String(raw.reason || ''),
        origin: 'agent'
      })
    }
    if (agentIntents.length > 0) {
      intents = [
        ...agentIntents,
        ...intents.filter((i) => !agentIntents.some((a) => a.id === i.id))
      ]
    }
  }

  /**
   * 富化整体失败时给一条**可执行**的汇总提示。
   *
   * 这一步失败不会让节点报错（时间线仍有启发式事件/节拍），所以必须把「哪些步没产出、
   * 大概为什么」讲清楚，否则用户看到的是「跑成功了但镜头描述与导演意图是空的」。
   * 原因里通常带着模型名与提供商的原始报错（如方舟的「模型未开通」），一并带出来。
   */
  if (failures.length > 0) {
    const steps = failures.map((f) => f.skillId).join(' / ')
    const reason = failures[0]!.reason
    say(
      ctx,
      `语义富化有 ${failures.length}/3 步没产出（${steps}）：本节点只保留启发式事件与节拍，镜头描述/导演意图可能为空。` + // cjk-ok
        `常见原因是文本模型不可用（未开通 / Key 失效 / 未勾选）：${reason}` + // cjk-ok
        '——请在 设置 → 提供商 里换一个可用的文本模型后重跑。', // cjk-ok
      `Semantic enrichment failed for ${failures.length}/3 step(s) (${steps}): this run keeps heuristic events/beats only, shot descriptions and director intents may be empty. ` +
        `Usual cause is an unusable text model (not activated / bad key / not selected): ${reason} — pick a working text model in Settings → Providers and re-run.`,
      'warn'
    )
  }

  return rebuildTracks({
    ...doc,
    events: events.map((e) => ({
      ...e,
      intents: intents.filter((i) => i.trigger === e.id).map((i) => i.id)
    })),
    beats,
    intents,
    updatedAt: new Date().toISOString()
  })
}

// ─── semantic.analyze ─────────────────────────────────────────────────

/** 无主进程能力时：按参数旁路 JSON 出启发式骨架 */
function heuristicTimeline(
  ctx: NodeExecuteContext,
  vocabulary: string,
  vocabDef?: BeatVocabulary
): {
  doc: SemanticTimeline
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
} {
  const p = ctx.node.params ?? {}
  const fps = Number(p.semanticFps) || 30
  const duration = Number(p.semanticDuration) || 60
  const extra = p as { width?: number; height?: number }
  const doc = createEmptySemanticTimeline(
    String(p.sourceAssetId || 'video'),
    {
      durationSec: duration,
      fps,
      width: Number(extra.width) || 1080,
      height: Number(extra.height) || 1920,
      hasAudio: true
    },
    vocabulary
  )
  const shots = parseJsonParam<ShotEvidence[]>(p.shotsJson, []).filter((s) => s?.id && s.range)
  const finalShots = shots.length > 0 ? shots : singleShot(duration, fps)
  const utterances = parseJsonParam<UtteranceEvidence[]>(p.utterancesJson, []).filter(
    (u) => u?.id && u.range
  )
  const events = heuristicEventsFromUtterances(utterances, finalShots, fps)
  return {
    doc: rebuildTracks({
      ...doc,
      events,
      beats: assignBeatsHeuristic(events, duration, fps, vocabDef ?? vocabulary),
      intents: inferIntentsFromEvents(events),
      updatedAt: new Date().toISOString()
    }),
    shots: finalShots,
    utterances
  }
}

export async function executeSemanticAnalyzeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const p = ctx.node.params ?? {}
  const vocabulary = String(p.vocabulary || 'commerce.v1')
  const useLlm = p.semanticLlm === true
  const upstream = resolveUpstreamVideo(ctx)
  const assetId = upstream.assetId || String(p.sourceAssetId || '').trim() || undefined
  const relativePath = upstream.relativePath

  if (ctx.analyzeSemanticVideo && (assetId || relativePath)) {
    say(
      ctx,
      '语义分析：切镜 / 关键帧 / 转写 / 人声 / 实体…', // cjk-ok
      'Semantic analyze: shots / keyframes / transcript / stems / entities…'
    )
    const res = await ctx.analyzeSemanticVideo({
      sourceAssetId: assetId,
      videoRelativePath: relativePath,
      vocabulary,
      transcribe: p.semanticTranscribe !== false,
      // 转写覆盖：给了就严格用指定实例/模型；不给沿用「首个支持转写的实例」
      transcribeProviderInstanceId:
        String(p.transcribeProviderInstanceId || '').trim() || undefined,
      transcribeModel: String(p.transcribeModel || '').trim() || undefined,
      separateAudio: p.semanticSeparateAudio !== false,
      detectEntities: p.semanticDetectEntities !== false
    })
    for (const note of res.notes) ctx.log?.(note, 'warn')
    say(
      ctx,
      `镜头 ${res.shots.length}（${res.method}）· 话语 ${res.utterances.length} · 实体 ${res.timeline.entities.length}`, // cjk-ok
      `${res.shots.length} shots (${res.method}) · ${res.utterances.length} utterances · ${res.timeline.entities.length} entities`
    )
    let doc = res.timeline
    if (useLlm) {
      const vocabDef = findVocabularyInPacks(await loadPacks(ctx), vocabulary)
      doc = await enrichTimelineWithLlm(ctx, {
        doc,
        shots: res.shots,
        utterances: res.utterances,
        keyframes: res.keyframes,
        vocabulary: vocabDef
      })
      if (ctx.saveSemanticTimeline) {
        try {
          await ctx.saveSemanticTimeline(doc)
        } catch (e) {
          say(
            ctx,
            `保存语义时间线失败：${errorText(e)}`, // cjk-ok
            `Failed to save timeline: ${errorText(e)}`,
            'warn'
          )
        }
      }
    }
    ctx.patchNode?.({
      params: {
        semanticTimelineId: doc.id,
        sourceRelativePath: res.sourceRelativePath,
        ...(upstream.assetId ? { sourceAssetId: upstream.assetId } : {})
      }
    })
    return { out: semanticTimelineValue(doc) }
  }

  if (assetId || relativePath) {
    say(
      ctx,
      '当前执行环境没有语义分析能力，已按参数生成启发式骨架', // cjk-ok
      'Semantic analysis is unavailable here; produced a heuristic skeleton from params',
      'warn'
    )
  }
  const vocabDef = findVocabularyInPacks(await loadPacks(ctx), vocabulary)
  const base = heuristicTimeline(ctx, vocabulary, vocabDef)
  const doc = useLlm
    ? await enrichTimelineWithLlm(ctx, { ...base, keyframes: {}, vocabulary: vocabDef })
    : base.doc
  return { out: semanticTimelineValue(doc) }
}

// ─── Timeline consumers ─────────────────────────────────────────────────────

function readTimelineJson(ctx: NodeExecuteContext): string {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'semanticTimeline') return upstream.text
  if (upstream && upstream.kind === 'text' && upstream.text.trim()) return upstream.text.trim()
  return String(ctx.node.params?.timelineJson || '').trim()
}

/**
 * 取上游时间线文档。
 *
 * 上游是**结构化值**时直接用 `doc`（不再 JSON.parse，也不再有「字符串里塞了坏 JSON」这类
 * 只在解析时才暴露的问题）；文本值仍走解析 —— 那条路是给节点参数 `timelineJson`
 * 与 agent 手写 JSON 用的，必须继续支持。
 */
function readTimeline(ctx: NodeExecuteContext): SemanticTimeline | null {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'semanticTimeline') {
    const doc = upstream.doc
    if (!doc || typeof doc !== 'object' || !doc.source || !Array.isArray(doc.events)) {
      throw new Error(
        isEn(ctx) ? 'Upstream is not a semantic timeline document' : '上游不是语义时间线文档' // cjk-ok
      )
    }
    // schema 不匹配只告警不拦：启发式骨架等合法产物也可能不完全满足严格规则
    const check = validateSemanticTimeline(doc)
    if (!check.ok) {
      ctx.log?.(
        (isEn(ctx) ? 'Semantic timeline schema warnings: ' : '语义时间线 schema 告警：') + // cjk-ok
          check.issues.map((i) => `${i.path} ${i.message}`).join('; '),
        'warn'
      )
    }
    return doc
  }
  const raw = readTimelineJson(ctx)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(isEn(ctx) ? 'Timeline input is not valid JSON' : '时间线输入不是合法 JSON') // cjk-ok
  }
  const doc = parsed as SemanticTimeline
  if (!doc || typeof doc !== 'object' || !doc.source || !Array.isArray(doc.events)) {
    throw new Error(
      isEn(ctx) ? 'Input is not a semantic timeline document' : '输入不是语义时间线文档' // cjk-ok
    )
  }
  return doc
}

interface ShotContext {
  shots: ShotEvidence[]
  utterances: UtteranceEvidence[]
  sourceRelativePath?: string
  /** 镜头来自真实切镜证据（而非整片单镜头兜底） */
  real: boolean
}

async function loadShotContext(
  ctx: NodeExecuteContext,
  timeline: SemanticTimeline
): Promise<ShotContext> {
  if (ctx.loadSemanticEvidence && timeline.id) {
    try {
      const ev = await ctx.loadSemanticEvidence(timeline.id)
      if (ev.shots.length > 0) {
        return {
          shots: ev.shots,
          utterances: ev.utterances,
          sourceRelativePath: ev.sourceRelativePath,
          real: true
        }
      }
    } catch (e) {
      say(
        ctx,
        `读取镜头证据失败：${errorText(e)}`, // cjk-ok
        `Failed to load shot evidence: ${errorText(e)}`,
        'warn'
      )
    }
  }
  const fromParam = parseJsonParam<ShotEvidence[]>(ctx.node.params?.shotsJson, []).filter(
    (s) => s?.id && s.range
  )
  return {
    shots:
      fromParam.length > 0 ? fromParam : singleShot(timeline.source.duration, timeline.source.fps),
    utterances: [],
    real: fromParam.length > 0
  }
}

function rulePackIds(ctx: NodeExecuteContext): string[] {
  return String(ctx.node.params?.rulePackIds || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function executeSemanticCompileNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const timeline = readTimeline(ctx)
  if (!timeline) return outText('{}')
  const rulePacks = collectRulePacks(await loadPacks(ctx), rulePackIds(ctx))
  const shotCtx = await loadShotContext(ctx, timeline)
  const commands = compileDirectorCommands(timeline, { rulePacks })
  const sourceRelativePath =
    String(ctx.node.params?.sourceRelativePath || '').trim() || shotCtx.sourceRelativePath || ''
  const scriptTimeline = semanticToScriptTimeline({
    timeline,
    shots: shotCtx.shots,
    utterances: shotCtx.utterances,
    commands,
    sourceRelativePath
  })
  say(
    ctx,
    `语义编译：${commands.length} 条命令 · 规则包 ${rulePacks.map((p) => p.id).join(', ')}`, // cjk-ok
    `Semantic compile: ${commands.length} commands · rule packs ${rulePacks.map((p) => p.id).join(', ')}`
  )
  return outText(
    JSON.stringify({ rulePacks: rulePacks.map((p) => p.id), commands, scriptTimeline }, null, 2)
  )
}

export async function executeSemanticTriggerNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const timeline = readTimeline(ctx)
  if (!timeline) return outText('{}')
  const eventLabel = String(ctx.node.params?.eventLabel || '').trim()
  const rulePacks = collectRulePacks(await loadPacks(ctx), rulePackIds(ctx))
  const all = compileDirectorCommands(timeline, { rulePacks })
  if (!eventLabel) {
    return outText(
      JSON.stringify({ eventLabel: '', events: timeline.events, commands: all }, null, 2)
    )
  }
  const events = timeline.events.filter(
    (e) => e.label === eventLabel || e.id === eventLabel || e.type === eventLabel
  )
  const eventIds = new Set(events.map((e) => e.id))
  const commands = all.filter((c) => {
    const intent = c.sourceIntentId
      ? timeline.intents.find((i) => i.id === c.sourceIntentId)
      : undefined
    if (intent && (eventIds.has(intent.trigger) || intent.trigger === eventLabel)) return true
    return events.some((e) => c.start < e.timeRange.end && c.end > e.timeRange.start)
  })
  if (events.length === 0) {
    say(
      ctx,
      `时间线里没有「${eventLabel}」事件`, // cjk-ok
      `No "${eventLabel}" event in the timeline`,
      'warn'
    )
  }
  return outText(JSON.stringify({ eventLabel, events, commands }, null, 2))
}

// ─── semantic.repair / semantic.variant ──────────────────────────────────────────

function readEdits(ctx: NodeExecuteContext): SemanticEdit[] {
  const raw = parseJsonParam<unknown>(ctx.node.params?.editsJson, [])
  const { edits, issues } = normalizeSemanticEdits(raw, 'user')
  for (const issue of issues) say(ctx, `已忽略编辑 ${issue}`, `Ignored edit ${issue}`, 'warn') // cjk-ok
  return edits
}

function planFor(timeline: SemanticTimeline, shots: ShotEvidence[], edits: SemanticEdit[]) {
  const plan = planInvalidation({
    timeline,
    shots,
    edits,
    entityShotIndex: buildEntityShotIndex(timeline)
  })
  const definition = freezeBuildDefinition(timeline, edits, plan, timelineVersionHash(timeline))
  return { plan, definition }
}

async function buildOnce(
  ctx: NodeExecuteContext,
  timeline: SemanticTimeline,
  edits: SemanticEdit[],
  label?: string
): Promise<SemanticBuildResponse> {
  const res = await ctx.buildSemanticVideo!({
    timeline,
    edits,
    sourceRelativePath: String(ctx.node.params?.sourceRelativePath || '').trim() || undefined,
    label
  })
  for (const note of res.notes) ctx.log?.(note, 'warn')
  if (res.manifest.status !== 'done' || !res.outputRelativePath) {
    throw new Error(res.manifest.error || (isEn(ctx) ? 'Semantic build failed' : '语义构建失败')) // cjk-ok
  }
  const qc = res.manifest.qc
  if (qc) {
    say(
      ctx,
      `构建完成 ${res.outputRelativePath} · QC ${qc.level} ${qc.passed ? '通过' : '未通过'}`, // cjk-ok
      `Built ${res.outputRelativePath} · QC ${qc.level} ${qc.passed ? 'passed' : 'failed'}`,
      qc.passed ? 'info' : 'warn'
    )
  }
  return res
}

function shouldExecute(ctx: NodeExecuteContext): boolean {
  if (ctx.node.params?.semanticExecute === false) return false
  if (!ctx.buildSemanticVideo) {
    say(
      ctx,
      '当前执行环境没有语义构建能力，只输出计划', // cjk-ok
      'Semantic build is unavailable here; plan only',
      'warn'
    )
    return false
  }
  return true
}

/** semantic.repair：编辑 → 失效计划 → 本地构建成片 */
export async function executeSemanticRepairNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const timeline = readTimeline(ctx)
  if (!timeline) return outText('{}')
  const edits = readEdits(ctx)
  const shotCtx = await loadShotContext(ctx, timeline)
  const { plan, definition } = planFor(timeline, shotCtx.shots, edits)
  say(
    ctx,
    `修复计划：${edits.length} 条编辑 · 目标 ${plan.targetLevel} · ${plan.cost.note ?? ''}`, // cjk-ok
    `Repair plan: ${edits.length} edits · target ${plan.targetLevel} · ${plan.cost.note ?? ''}`
  )
  if (edits.length === 0 || !shouldExecute(ctx)) {
    return outText(JSON.stringify({ plan, definition }, null, 2))
  }
  const res = await buildOnce(ctx, timeline, edits)
  return {
    out: { kind: 'text', text: JSON.stringify(res, null, 2) },
    'out-video': {
      kind: 'video',
      id: res.definition.id,
      relativePath: res.outputRelativePath,
      createdAt: res.manifest.finishedAt
    }
  }
}

/** semantic.variant：配方 × 槽位矩阵 → 多个变体成片 */
export async function executeSemanticVariantNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const timeline = readTimeline(ctx)
  if (!timeline) return outText('{}')
  const p = ctx.node.params ?? {}
  const recipeId = String(p.recipeId || '').trim()
  const userEdits = readEdits(ctx)
  const shotCtx = await loadShotContext(ctx, timeline)

  let rows: Array<{ slots: Record<string, unknown>; edits: SemanticEdit[] }> = [
    { slots: {}, edits: [] }
  ]
  if (recipeId) {
    const recipe = findRecipe(await loadPacks(ctx), recipeId)
    if (!recipe) {
      throw new Error(isEn(ctx) ? `Recipe not found: ${recipeId}` : `找不到变体配方：${recipeId}`) // cjk-ok
    }
    const slotValues = parseJsonParam<Record<string, unknown>>(p.recipeSlotsJson, {})
    const inst = instantiateRecipe(recipe, slotValues)
    if (inst.missingSlots.length > 0) {
      throw new Error(
        isEn(ctx)
          ? `Recipe slots missing: ${inst.missingSlots.join(', ')}`
          : `配方槽位未填写：${inst.missingSlots.join(', ')}` // cjk-ok
      )
    }
    rows = inst.rows.map((row) => ({
      slots: row.slots,
      edits: normalizeSemanticEdits(row.edits, 'agent').edits
    }))
  }
  if (rows.length > MAX_VARIANTS) {
    say(
      ctx,
      `变体 ${rows.length} 个，只构建前 ${MAX_VARIANTS} 个`, // cjk-ok
      `${rows.length} variants; building first ${MAX_VARIANTS}`,
      'warn'
    )
    rows = rows.slice(0, MAX_VARIANTS)
  }

  const execute = shouldExecute(ctx)
  const variants: unknown[] = []
  const items: GraphVideoItem[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const edits = [...row.edits, ...userEdits]
    const { plan, definition } = planFor(timeline, shotCtx.shots, edits)
    if (!execute || edits.length === 0) {
      variants.push({ slots: row.slots, plan, definition })
      continue
    }
    say(ctx, `构建变体 ${i + 1}/${rows.length}`, `Building variant ${i + 1}/${rows.length}`) // cjk-ok
    const res = await buildOnce(ctx, timeline, edits, `v${i + 1}`)
    variants.push({ slots: row.slots, ...res })
    items.push({
      id: `${res.definition.id}.v${i + 1}`,
      relativePath: res.outputRelativePath,
      createdAt: res.manifest.finishedAt
    })
  }
  const outputs: Record<string, GraphValue> = {
    out: { kind: 'text', text: JSON.stringify({ recipeId, variants }, null, 2) }
  }
  if (items.length > 0) outputs['out-videos'] = { kind: 'videos', items }
  return outputs
}
