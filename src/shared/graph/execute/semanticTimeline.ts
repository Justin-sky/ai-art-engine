/**
 * Semantic Timeline 相关节点执行器。
 *
 * 真实管线（切镜 / 转写 / 实体 / 构建）在主进程，经 ctx 能力注入；
 * 能力缺失（单测 / 无工程）时退回纯启发式，并写 warn 日志说明。
 */
import type { GraphValue, GraphVideoItem, NodeExecuteContext } from './types'
import { videoPromptsValue } from './videoPromptsValue'
import {
  resolveVideoGenerateParamsForApi,
  supportedDurationsFromError
} from '../videoGenerateParams'
import { normalizeImageRedraw } from '../imageRedraw'
import {
  MASK_OVERLAP_WARN_RATIO,
  SOFT_MAX_REPLACEMENTS_PER_SHOT,
  buildEntityRedrawPrompt,
  overlappingReplacements,
  referenceLegend,
  replacementVideoNote,
  type EntityReplacementRef,
  type ShotReplacement
} from '../../semanticTimeline'
import {
  applyPromptOverrides,
  buildPromptPlan,
  combinePlanFullPrompt,
  parsePromptPlan,
  planRebuildClips,
  summarizePromptPlan,
  VIDEO_PROMPT_PLAN_SCHEMA,
  type RebuildMode,
  type VideoPromptPlan
} from '../../semanticTimeline'
import {
  assignBeatsHeuristic,
  collectRulePacks,
  compileDirectorCommands,
  createEmptySemanticTimeline,
  draftsToEvents,
  findVocabularyInPacks,
  heuristicEventsFromUtterances,
  keyframeProjectPath,
  ensureSemanticStructure,
  migrateSemanticTimeline,
  rebaselineSemanticTimeline,
  carryOverSemanticEdits,
  SEMANTIC_TRACK_KINDS,
  diffAgainstBaseline,
  inferIntentsFromEvents,
  intentId,
  parseEventDrafts,
  parseJsonArray,
  parseShotDescriptions,
  rebuildTracks,
  SEMANTIC_ENRICH_PROMPTS,
  singleShot,
  type BeatVocabulary,
  type DirectorIntent,
  type IntentTechnique,
  type RawEventDraft,
  type SemanticEnrichStepId,
  type SemanticPack,
  type SemanticShot,
  type SemanticTimeline,
  type SemanticTrackKind,
  type ShotDescription,
  type ShotEvidence,
  type UtteranceEvidence
} from '../../semanticTimeline'
import { validateSemanticTimeline } from '../../semanticTimeline'
import { semanticTimelineValue } from './semanticTimelineValue'

/** 镜头描述一次最多看的关键帧数 */
const MAX_DESCRIBE_SHOTS = 8

type GenerateVideoRequest = Parameters<NonNullable<NodeExecuteContext['generateVideo']>>[0]
type GenerateVideoResult = Awaited<ReturnType<NonNullable<NodeExecuteContext['generateVideo']>>>

const TRACK_KINDS: ReadonlySet<SemanticTrackKind> = new Set(SEMANTIC_TRACK_KINDS)

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

// ─── LLM enrichment (native semantic step prompts) ──────────────────────────

async function runSkill(
  ctx: NodeExecuteContext,
  stepId: SemanticEnrichStepId,
  prompt: string,
  images?: string[],
  onError?: (reason: string) => void
): Promise<string | null> {
  const stepPrompt = SEMANTIC_ENRICH_PROMPTS[stepId]
  if (!stepPrompt || !ctx.generateText) return null
  const en = isEn(ctx)
  const system = en
    ? stepPrompt.systemPromptEn || stepPrompt.systemPromptZh
    : stepPrompt.systemPromptZh || stepPrompt.systemPromptEn
  const instruction = en
    ? stepPrompt.instructionEn || stepPrompt.instructionZh
    : stepPrompt.instructionZh || stepPrompt.instructionEn
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
    say(ctx, `${stepId} 调用失败：${reason}`, `${stepId} failed: ${reason}`, 'warn') // cjk-ok
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
  /** 结构化镜头描述：写回 v2 镜头树（以前只拼成一句话、用完即丢） */
  const structured = new Map<string, ShotDescription>()
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
      structured.set(shot.id, d)
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
    ...(doc.shots?.length ? { shots: applyShotDescriptions(doc.shots, structured) } : {}),
    events: events.map((e) => ({
      ...e,
      intents: intents.filter((i) => i.trigger === e.id).map((i) => i.id)
    })),
    beats,
    intents,
    updatedAt: new Date().toISOString()
  })
}

/**
 * 把镜头描述写进结构化镜头树：**只填空字段**，用户改过 / 锁定的镜头不动
 * （富化是"补全事实"，不能覆盖修改）。
 */
function applyShotDescriptions(
  shots: SemanticShot[],
  descriptions: Map<string, ShotDescription>
): SemanticShot[] {
  if (descriptions.size === 0) return shots
  const pick = (cur: string | undefined, next: string | undefined): string | undefined =>
    cur?.trim() ? cur : next?.trim() || undefined
  return shots.map((shot) => {
    const d = descriptions.get(shot.id)
    if (!d || shot.locked || shot.origin === 'user') return shot
    const camera = {
      ...shot.camera,
      ...(pick(shot.camera?.shotSize, d.shotSize)
        ? { shotSize: pick(shot.camera?.shotSize, d.shotSize) }
        : {}),
      ...(pick(shot.camera?.angle, d.angle) ? { angle: pick(shot.camera?.angle, d.angle) } : {}),
      ...(pick(shot.camera?.motion, d.cameraMotion)
        ? { motion: pick(shot.camera?.motion, d.cameraMotion) }
        : {}),
      ...(pick(shot.camera?.lens, d.focalLengthHint)
        ? { lens: pick(shot.camera?.lens, d.focalLengthHint) }
        : {})
    }
    const subjects = [...(shot.subjects ?? [])]
    if (d.subject?.trim()) {
      const first = subjects[0]
      if (first) {
        subjects[0] = {
          ...first,
          ...(first.action?.trim() || !d.action?.trim() ? {} : { action: d.action.trim() }),
          ...(first.emotion?.trim() || !d.emotion?.trim() ? {} : { emotion: d.emotion.trim() })
        }
      } else {
        subjects.push({
          name: d.subject.trim(),
          ...(d.action?.trim() ? { action: d.action.trim() } : {}),
          ...(d.emotion?.trim() ? { emotion: d.emotion.trim() } : {})
        })
      }
    }
    const description = [d.subject, d.action].filter((s) => s?.trim()).join(' ')
    const visual = {
      ...shot.visual,
      ...(shot.visual?.description?.trim() || !description ? {} : { description })
    }
    return { ...shot, camera, visual, subjects }
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
      detectEntities: p.semanticDetectEntities !== false,
      // 实体检测（视觉大模型看关键帧）与三步富化共用节点上的「富化模型」选择
      entityModel: String(p.generateModel || '').trim() || undefined,
      entityProviderInstanceId: String(p.generateProviderInstanceId || '').trim() || undefined
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
      /**
       * 富化会重写事件 / 节拍 / 意图：用户在 dive 里改过、删过的语义层内容要再带回来，
       * 否则开着「理解」重跑一次，语义层修改就被模型产物覆盖了。
       */
      doc = carryOverSemanticEdits(res.timeline, doc)
      // 富化补全的镜头语言 / 画面描述属于"分析事实"：重设基线，之后的改动才算修改
      doc = rebaselineSemanticTimeline(
        ensureSemanticStructure(doc, { shots: res.shots, utterances: res.utterances })
      )
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

  /**
   * 走到这里就**没有真正做分析**：产出的是只有 id / 骨架的文档（事件来自节点参数，
   * 通常为空）。以前只在"有 assetId 或路径"时才打这条 warn，两者都没有时**完全静默** ——
   * 于是下游拿到 `events: []` 却不知道为什么（实测踩到）。现在一律告警。
   */
  say(
    ctx,
    assetId || relativePath
      ? '当前执行环境没有语义分析能力，已按参数生成启发式骨架' // cjk-ok
      : '没有解析到视频输入（上游视频口为空 / 该视频资产不可用），本次只产出空的时间线骨架', // cjk-ok
    'Semantic analysis is unavailable here; produced a heuristic skeleton from params',
    'warn'
  )
  const vocabDef = findVocabularyInPacks(await loadPacks(ctx), vocabulary)
  const base = heuristicTimeline(ctx, vocabulary, vocabDef)
  const structuredBase = {
    ...base,
    doc: ensureSemanticStructure(base.doc, { shots: base.shots, utterances: base.utterances })
  }
  const doc = useLlm
    ? await enrichTimelineWithLlm(ctx, { ...structuredBase, keyframes: {}, vocabulary: vocabDef })
    : structuredBase.doc
  return { out: semanticTimelineValue(rebaselineSemanticTimeline(doc)) }
}

// ─── Timeline consumers ─────────────────────────────────────────────────────

function readTimelineJson(ctx: NodeExecuteContext): string {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'semanticTimeline') return upstream.text
  if (upstream && upstream.kind === 'text' && upstream.text.trim()) return upstream.text.trim()
  return String(ctx.node.params?.timelineJson || '').trim()
}

/**
 * 取上游时间线文档；**空骨架时按 id 从磁盘兜底**。
 *
 * 为什么需要兜底：分析节点在"拿不到视频输入 / 当前环境没有分析能力"时会返回一份
 * **只有 id、没有事件**的骨架（沿用上一次的 `semanticTimelineId`）。此时下游拿到的是
 * `events: []`，看起来像过滤条件写错了 —— 实测踩到（触发节点输出两个空数组）。
 * 磁盘上那份文档通常是好的，所以这里按 id 读一次；读到了就用它并记一条日志。
 */
async function readTimeline(ctx: NodeExecuteContext): Promise<SemanticTimeline | null> {
  const doc = readTimelineStrict(ctx)
  if (!doc) return null
  if (!ctx.loadSemanticTimeline) return doc
  const id = typeof doc.id === 'string' ? doc.id.trim() : ''
  if (!id.startsWith('stl.')) return doc
  /**
   * 修改发生在 dive 里（直接落盘 `timeline.json`），而上游分析节点的运行输出还是修改**前**的那份。
   * 磁盘版本更新（或带着更多修改记录）时以磁盘为准 —— 否则用户改了半天，编译仍按原样出计划。
   */
  if (doc.events.length > 0) {
    try {
      const loaded = await ctx.loadSemanticTimeline(id)
      if (loaded && isNewerTimeline(loaded, doc)) {
        say(
          ctx,
          `使用磁盘上修改过的时间线（${loaded.edits?.length ?? 0} 处修改）`, // cjk-ok
          `Using the edited timeline on disk (${loaded.edits?.length ?? 0} edit(s))`
        )
        return migrateSemanticTimeline(loaded)
      }
    } catch {
      /* 读不到就用上游 */
    }
    return doc
  }
  try {
    const loaded = await ctx.loadSemanticTimeline(id)
    if (loaded && Array.isArray(loaded.events) && loaded.events.length > 0) {
      ctx.log?.(
        `上游给的时间线是空骨架（${id}），已按 id 从磁盘读到 ${loaded.events.length} 个事件`, // cjk-ok
        'warn'
      )
      return loaded
    }
  } catch (e) {
    ctx.log?.(`按 id 读取时间线失败：${errorText(e)}`, 'warn') // cjk-ok
  }
  return doc
}

/** 磁盘版本是否比上游给的新（修改记录更多，或更新时间更晚） */
function isNewerTimeline(disk: SemanticTimeline, upstream: SemanticTimeline): boolean {
  const diskEdits = disk.edits?.length ?? 0
  const upEdits = upstream.edits?.length ?? 0
  if (diskEdits !== upEdits) return diskEdits > upEdits
  const a = Date.parse(disk.updatedAt ?? '')
  const b = Date.parse(upstream.updatedAt ?? '')
  return Number.isFinite(a) && Number.isFinite(b) && a > b
}

/** 严格版本：只认上游传入的值（结构化文档 / JSON 文本），不做磁盘兜底 */
function readTimelineStrict(ctx: NodeExecuteContext): SemanticTimeline | null {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'semanticTimeline') {
    const doc = upstream.doc
    if (!doc || typeof doc !== 'object' || !doc.source || !Array.isArray(doc.events)) {
      throw new Error(
        isEn(ctx) ? 'Upstream is not a semantic timeline document' : '上游不是语义时间线文档' // cjk-ok
      )
    }
    // v1 → v2 自动迁移（镜头树等证据字段由编译在拿到证据后补齐）
    const migrated = migrateSemanticTimeline(doc)
    // schema 不匹配只告警不拦：启发式骨架等合法产物也可能不完全满足严格规则
    const check = validateSemanticTimeline(migrated)
    if (!check.ok) {
      ctx.log?.(
        (isEn(ctx) ? 'Semantic timeline schema warnings: ' : '语义时间线 schema 告警：') + // cjk-ok
          check.issues.map((i) => `${i.path} ${i.message}`).join('; '),
        'warn'
      )
    }
    return migrated
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
  return migrateSemanticTimeline(doc)
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
  let timeline = await readTimeline(ctx)
  if (!timeline) return { out: videoPromptsValue(emptyPromptPlan()) }
  const rulePacks = collectRulePacks(await loadPacks(ctx), rulePackIds(ctx))
  const shotCtx = await loadShotContext(ctx, timeline)
  /**
   * v2：只有**真实切镜证据**时才内联镜头树（整片单镜兜底没有可直通的原片段意义）。
   * 脏集合必须在富化**之前**算：富化会补镜头语言字段，之后算会把每一镜都误判为"改过"。
   */
  if (shotCtx.real) {
    timeline = ensureSemanticStructure(timeline, {
      shots: shotCtx.shots,
      utterances: shotCtx.utterances
    })
  }
  const diff = timeline.shots?.length ? diffAgainstBaseline(timeline) : undefined
  if (diff) {
    say(
      ctx,
      `修改检测：${diff.dirtyShots.size} 镜需重新生成 · ${diff.removedShots.size} 镜删除 · ${diff.dirtyDialogue.size} 句需重新配音`, // cjk-ok
      `Changes: ${diff.dirtyShots.size} shot(s) to regenerate · ${diff.removedShots.size} removed · ${diff.dirtyDialogue.size} line(s) to re-dub`
    )
  }

  /**
   * 可选：用模型写提示词。
   *
   * 复用**分析节点那套三步富化**（镜头描述 / 事件抽取 / 导演意图）来"把画面说清楚"，
   * 然后**仍然走规则拼装** —— 这样提示词结构稳定、可解释，模型只负责补描述性内容，
   * 不必让模型直接吐 JSON（那条路更容易崩且难排查）。
   */
  let modelAuthored = false
  if (ctx.node.params?.semanticLlm === true) {
    const vocabulary = String(ctx.node.params?.vocabulary || 'commerce.v1')
    const vocabDef = findVocabularyInPacks(await loadPacks(ctx), vocabulary)
    try {
      timeline = await enrichTimelineWithLlm(ctx, {
        doc: timeline,
        shots: shotCtx.shots,
        utterances: shotCtx.utterances,
        keyframes: Object.fromEntries(
          shotCtx.shots
            .map(
              (shot) =>
                [
                  shot.id,
                  keyframeProjectPath(timeline!.id, shot.keyframes?.middle ?? shot.keyframes?.first)
                ] as const
            )
            .filter((entry): entry is [string, string] => !!entry[1])
        ),
        vocabulary: vocabDef
      })
      modelAuthored = true
    } catch (e) {
      say(
        ctx,
        `用模型写提示词失败，已退回规则拼装：${errorText(e)}`, // cjk-ok
        `Model-authored prompts failed; fell back to rule-based: ${errorText(e)}`,
        'warn'
      )
    }
  }

  const commands = compileDirectorCommands(timeline, { rulePacks })
  const sourceRelativePath =
    String(ctx.node.params?.sourceRelativePath || '').trim() || shotCtx.sourceRelativePath || ''
  const plan = applyPromptOverrides(
    buildPromptPlan({
      timeline,
      shots: shotCtx.shots,
      utterances: shotCtx.utterances,
      commands,
      sourceRelativePath,
      lang: isEn(ctx) ? 'en' : 'zh',
      ...(diff ? { diff } : {})
    }),
    ctx.node.params?.promptOverridesJson
  )
  if (modelAuthored) {
    for (const shot of plan.shots) shot.modelAuthored = true
  }
  if (String(ctx.node.params?.promptOverridesJson ?? '').trim()) {
    say(
      ctx,
      '本节点带有旧版逐镜提示词覆盖（promptOverridesJson），仍然生效；新的修改请在分析节点时间线的「修改」面板里做', // cjk-ok
      'This node still carries legacy per-shot overrides (promptOverridesJson); they still apply. Make new edits in the Edit panel of the analyze timeline.',
      'warn'
    )
  }
  // 指令面板的「编译要求」：追加到每镜提示词末尾（整片提示词随之重算）
  const compileInstruction = String(ctx.node.params?.generateInstruction ?? '').trim()
  if (compileInstruction) {
    const sep = plan.lang === 'zh' ? '。' : '. '
    for (const shot of plan.shots) {
      if (!shot.prompt?.trim() || shot.prompt.includes(compileInstruction)) continue
      shot.prompt = `${shot.prompt}${sep}${compileInstruction}`
    }
    plan.fullPrompt = combinePlanFullPrompt(plan.shots, plan.lang)
  }

  const summary = summarizePromptPlan(plan)
  say(
    ctx,
    `语义编译：${summary.shots} 镜提示词（${summary.withFirstFrame} 镜带首帧${modelAuthored ? ' · 模型参与' : ''}）`, // cjk-ok
    `Semantic compile: ${summary.shots} shot prompts (${summary.withFirstFrame} with first frame${modelAuthored ? ' · model-authored' : ''})`
  )
  if (summary.shots === 0) {
    say(
      ctx,
      '没有镜头证据，提示词计划为空 —— 先运行上游「语义分析」', // cjk-ok
      'No shot evidence: the prompt plan is empty — run the upstream analyze node first',
      'warn'
    )
  }
  /**
   * 计划同时写进节点参数：运行态 outputs 会随存档/撤销/任务快照丢失，
   * 参数在图上，下游「语义重建」单独 Cook 时还能靠它把计划取回来（见 hostInput 软解析）。
   */
  ctx.patchNode?.({ params: { planJson: JSON.stringify(plan) } })
  const value: GraphValue = videoPromptsValue(plan)
  return { out: value }
}

/** 空计划（没有上游时间线时的占位）：schema 正确、零镜头，便于下游判断 */
function emptyPromptPlan(): VideoPromptPlan {
  return {
    schema: VIDEO_PROMPT_PLAN_SCHEMA,
    timelineId: '',
    sourceAssetId: '',
    lang: 'zh',
    shots: [],
    fullPrompt: '',
    settings: { width: 0, height: 0, fps: 30, durationSec: 0 }
  }
}

// ─── 语义重建（分析 → 编译 → 重建） ───────────────────────────────────────────

/** 逐镜头模式的上限（防误点一次跑几十次生成） */
const MAX_REBUILD_SHOTS = 12

/** 从输入口取提示词计划：结构化值优先，文本（agent 手写 / 上游转文本）走解析 */
function readPromptPlan(ctx: NodeExecuteContext): VideoPromptPlan | null {
  const upstream = ctx.inputs.in?.[0]
  if (upstream && upstream.kind === 'videoPrompts') return upstream.plan
  if (upstream && upstream.kind === 'text') return parsePromptPlan(upstream.text)
  return null
}

/**
 * 提交一次视频生成；上游以「时长档位」为由拒绝时，按它自己给出的档位**重试一次**。
 *
 * 这类拒绝发生在**提交前校验**（HTTP 400，不产生费用），而能力表未必覆盖该模型
 * （自建网关 / 刚上线的新模型）—— 不重试就是白丢一镜：实测 9 镜里 6 镜因为 1s / 2s
 * 不在模型的 4..15 档位内被拒，用户等了 4 分半只拿到 2 镜。
 */
async function generateClipVideo(
  ctx: NodeExecuteContext,
  request: Omit<GenerateVideoRequest, 'duration'>,
  duration: number
): Promise<GenerateVideoResult> {
  try {
    return await ctx.generateVideo!({ ...request, duration })
  } catch (e) {
    const supported = supportedDurationsFromError(errorText(e))
    const retry = supported.length ? pickGenerateDuration(duration, supported) : undefined
    if (retry == null || retry === duration) throw e
    say(
      ctx,
      `${request.name ?? '镜头'}：模型不接受 ${duration}s，改用 ${retry}s 重试一次`, // cjk-ok
      `${request.name ?? 'clip'}: ${duration}s rejected by the model, retrying with ${retry}s`,
      'warn'
    )
    return await ctx.generateVideo!({ ...request, duration: retry })
  }
}

/** 选一个模型支持的生成时长：≥ 镜头时长的最小档；没有更长的档就取最长档；无能力表时向上取整 */
function pickGenerateDuration(shotSec: number, durations: number[] | undefined): number {
  const want = Math.max(1, Math.ceil(shotSec - 1e-6))
  const options = (durations ?? []).filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b)
  if (options.length === 0) return want
  return options.find((d) => d >= shotSec - 1e-6) ?? options[options.length - 1]!
}

// ─── 实体局部替换：首帧逐个重绘 ─────────────────────────────────────────────────

interface FirstFrameEditResult {
  /** 重绘后的首帧（工程相对路径）；undefined = 没做 / 失败，调用方走兜底 */
  firstFrameRelativePath?: string
  /** 成功完成的重绘次数（= 图片模型调用次数） */
  redraws: number
  /** 首帧里已替换的实体名（写进视频提示词） */
  replacedNames: string[]
  /** 失败原因（有它时整镜走兜底，不混用半成品） */
  failure?: string
}

async function readReferenceUrl(
  ctx: NodeExecuteContext,
  ref: EntityReplacementRef
): Promise<string | undefined> {
  if (ref.assetId) return ctx.resolveAssetImageUrl?.(ref.assetId).catch(() => undefined)
  if (ref.relativePath)
    return ctx.readProjectImageDataUrl?.(ref.relativePath).catch(() => undefined)
  return undefined
}

/**
 * 首帧局部替换：以掩码所在关键帧为底图，按实体**逐个**重绘。
 *
 * 每一遍只带**这个实体自己的**参考图（避免多张参考图对错号），并把前面已换好的实体掩码
 * 作为保护区扣掉（避免后一遍把前一遍改回去）。每一遍的结果都落盘再读回：
 * 生成结果可能是远程 URL，直接进 canvas 会污染画布；落盘后也便于排查。
 *
 * 任一遍失败就整镜放弃首帧编辑（返回 failure），由调用方走参考图兜底 —— 不拿半成品出片。
 */
async function editFirstFrameForReplacements(
  ctx: NodeExecuteContext,
  input: {
    timelineId: string
    clipKey: string
    replacements: ShotReplacement[]
    imageModel?: string
    imageProviderInstanceId?: string
  }
): Promise<FirstFrameEditResult> {
  const masked = input.replacements.filter((r) => r.mask)
  const empty: FirstFrameEditResult = { redraws: 0, replacedNames: [] }
  if (masked.length === 0) return empty
  if (
    !ctx.generateImage ||
    !ctx.composeImageRedrawCanvas ||
    !ctx.composeEntityMask ||
    !ctx.readProjectImageDataUrl ||
    !ctx.saveRunMedia
  ) {
    return { ...empty, failure: 'no image redraw capability here' }
  }
  const keyframe = masked[0]!.mask!.keyframeRelativePath
  let current = await ctx.readProjectImageDataUrl(keyframe).catch(() => undefined)
  if (!current) return { ...empty, failure: `cannot read keyframe ${keyframe}` }
  if (masked.some((r) => r.mask!.keyframeRelativePath !== keyframe)) {
    say(
      ctx,
      `${input.clipKey}：各实体的目标点选在不同关键帧上，统一以 ${keyframe} 为底图`, // cjk-ok
      `${input.clipKey}: targets were picked on different keyframes; using ${keyframe}`,
      'warn'
    )
  }

  const protect: string[] = []
  let lastRel: string | undefined
  const replacedNames: string[] = []
  for (const [i, r] of masked.entries()) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const rawMask = await ctx.readProjectImageDataUrl(r.mask!.maskRelativePath)
      if (!rawMask) throw new Error(`cannot read mask ${r.mask!.maskRelativePath}`)
      const effective = await ctx.composeEntityMask({
        maskDataUrl: rawMask,
        // 传快照：后面还会往保护区里追加，不能让调用方拿到会变的数组
        protectMaskDataUrls: [...protect]
      })
      if (effective.coverage <= 0) {
        say(
          ctx,
          `${input.clipKey}：${r.entityName} 的目标区域被前面已替换的实体完全覆盖，跳过`, // cjk-ok
          `${input.clipKey}: ${r.entityName} is fully covered by earlier replacements; skipped`,
          'warn'
        )
        continue
      }
      if (effective.protectedRatio > MASK_OVERLAP_WARN_RATIO) {
        say(
          ctx,
          `${input.clipKey}：${r.entityName} 与前面的实体重叠 ${Math.round(effective.protectedRatio * 100)}%，重叠处保留前一个的结果`, // cjk-ok
          `${input.clipKey}: ${r.entityName} overlaps earlier replacements by ${Math.round(effective.protectedRatio * 100)}%; overlap keeps the earlier result`,
          'warn'
        )
      }
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: current,
        state: normalizeImageRedraw({ maskDataUrl: effective.dataUrl, aspectId: 'original' })
      })
      const refUrls: string[] = []
      for (const ref of r.references) {
        const url = await readReferenceUrl(ctx, ref)
        if (url) refUrls.push(url)
      }
      const res = await ctx.generateImage({
        prompt: buildEntityRedrawPrompt({
          entityName: r.entityName,
          instruction: r.instruction,
          referenceCount: refUrls.length
        }),
        model: input.imageModel,
        providerInstanceId: input.imageProviderInstanceId,
        quality: 'high',
        n: 1,
        inputReferences: [composed.dataUrl, composed.maskDataUrl ?? effective.dataUrl, ...refUrls]
      })
      const image = res.images[0]
      if (!image) throw new Error('image model returned no image')
      lastRel = await ctx.saveRunMedia({
        dataUrl: image,
        key: `replace-${input.clipKey}-${i + 1}`,
        outputDir: `Semantic/${input.timelineId}/replace`,
        node: ctx.node
      })
      const next = await ctx.readProjectImageDataUrl(lastRel)
      if (!next) throw new Error(`cannot read redrawn frame ${lastRel}`)
      current = next
      // 保护区用**原始**掩码（不是扣过的）：前一个实体的整块区域都不许再动
      protect.push(rawMask)
      replacedNames.push(r.entityName)
      say(
        ctx,
        `${input.clipKey}：首帧替换 ${r.entityName}（${i + 1}/${masked.length}）`, // cjk-ok
        `${input.clipKey}: replaced ${r.entityName} in the first frame (${i + 1}/${masked.length})`
      )
    } catch (e) {
      return {
        redraws: replacedNames.length,
        replacedNames,
        failure: `${r.entityName}: ${errorText(e)}`
      }
    }
  }
  return lastRel
    ? { firstFrameRelativePath: lastRel, redraws: replacedNames.length, replacedNames }
    : empty
}

/** 节点参数里的整片指令（指令面板写的）：追加到每镜提示词末尾 */
function withInstruction(prompt: string, instruction: string, lang: 'zh' | 'en'): string {
  const extra = instruction.trim()
  if (!extra) return prompt
  return prompt ? `${prompt}${lang === 'zh' ? '。' : '. '}${extra}` : extra
}

/** 清单写回节点参数（节点已没有文本输出口；Inspector 读它展示计划 / 结果） */
function writeRebuildReport(
  ctx: NodeExecuteContext,
  report: Record<string, unknown>,
  outputRelativePath?: string
): void {
  ctx.patchNode?.({
    params: {
      rebuildLastReport: JSON.stringify(report, null, 2),
      ...(outputRelativePath ? { rebuildLastOutput: outputRelativePath } : {})
    }
  })
}

/**
 * 语义重建：提示词计划 → 未改镜头直通原片 / 改过的镜头生成 / 改过的台词重新配音 → 本地拼接成片。
 *
 * - 输出**只有视频口**（`out-video`）；清单写进节点参数 `rebuildLastReport`（Inspector 展示）与日志。
 * - 成本可见：先把"生成几次、直通几镜、配音几句"打进日志；`semanticExecute=false` 时一次模型都不调。
 * - 零修改 + 有原片入出点时**零次生成**，成片 = 原片按镜头重新拼接（还原原片）。
 */
export async function executeSemanticRebuildNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const p = ctx.node.params ?? {}
  const plan = readPromptPlan(ctx)
  if (!plan) {
    say(
      ctx,
      '没有收到提示词计划 —— 上游请接「语义编译」', // cjk-ok
      'No prompt plan on the input — connect the Semantic compile node upstream',
      'warn'
    )
    return {}
  }
  /**
   * 空计划（编译没拿到镜头）：以前只说「没有可拼接的镜头」，看不出是上游的问题。
   * 这里把原因与下一步说清楚，避免又变成一次"点了没反应"。
   */
  if (plan.shots.length === 0 && !plan.fullPrompt?.trim()) {
    say(
      ctx,
      '上游提示词计划是空的（编译时没有镜头证据）—— 先运行上游「语义编译」；时间线没有镜头时先在分析节点里重新分析', // cjk-ok
      'The upstream prompt plan is empty (compile saw no shots) — run the upstream Semantic compile node first',
      'warn'
    )
  }

  const mode: RebuildMode = p.rebuildMode === 'full' ? 'full' : 'shots'
  const maxShots = Number(p.rebuildMaxShots) || MAX_REBUILD_SHOTS
  const regenerateAll = p.rebuildRegenerateAll === true
  const planned = planRebuildClips(plan, { mode, maxShots, regenerateAll })
  const dubEnabled = p.rebuildDub !== false && mode === 'shots'
  const dubs = dubEnabled ? planned.dubs : []
  const notes: string[] = []
  if (planned.skippedByLimit > 0) {
    notes.push(
      planned.passthrough > 0
        ? `超过每镜上限（${maxShots}），已跳过 ${planned.skippedByLimit} 镜的生成（改用原片段）` // cjk-ok
        : `超过每镜上限（${maxShots}），已跳过 ${planned.skippedByLimit} 镜` // cjk-ok
    )
  }
  if (planned.skippedEmpty > 0) {
    notes.push(`有 ${planned.skippedEmpty} 镜没有提示词，已跳过`) // cjk-ok
  }
  const modelLabel = String(p.generateModel || '').trim()
  say(
    ctx,
    `语义重建：${mode === 'full' ? '整片一次' : `生成 ${planned.clips.length} 镜 · 直通原片 ${planned.passthrough} 镜 · 配音 ${dubs.length} 句`} · 模型 ${modelLabel || '默认'}`, // cjk-ok
    `Semantic rebuild: ${mode === 'full' ? 'single full pass' : `${planned.clips.length} generated · ${planned.passthrough} passthrough · ${dubs.length} re-dubbed`}`
  )
  for (const note of notes) say(ctx, note, note, 'warn')
  const loggedNotes = notes.length

  const baseReport = {
    mode,
    regenerateAll,
    shots: plan.shots.length,
    generate: planned.clips.map((c) => c.key),
    passthrough: planned.segments.filter((s) => s.kind === 'source').map((s) => s.key),
    removed: plan.removedShotIds ?? [],
    dubs: dubs.map((d) => ({ id: d.id, text: d.text, sourceText: d.sourceText })),
    skippedByLimit: planned.skippedByLimit,
    skippedEmpty: planned.skippedEmpty,
    notes
  }

  const execute = p.semanticExecute !== false
  if (!execute || planned.segments.length === 0) {
    if (planned.segments.length === 0) {
      say(ctx, '没有可拼接的镜头，未出片', 'Nothing to rebuild', 'warn') // cjk-ok
    }
    writeRebuildReport(ctx, { ...baseReport, execute: false })
    return {}
  }
  if (planned.clips.length > 0 && !ctx.generateVideo) {
    throw new Error(
      isEn(ctx)
        ? 'This environment has no video generation capability'
        : '当前执行环境没有视频生成能力' // cjk-ok
    )
  }
  if (!ctx.rebuildSemanticVideo) {
    throw new Error(
      isEn(ctx)
        ? 'This environment cannot assemble the rebuilt video'
        : '当前执行环境没有成片拼接能力' // cjk-ok
    )
  }

  // ── 视频参数：指令面板写 generate*，旧节点写 rebuild*；按模型能力夹取 ─────────────
  const model = String(p.generateModel || '').trim() || undefined
  const providerInstanceId = String(p.generateProviderInstanceId || '').trim() || undefined
  let caps: import('../videoGenerateParams').VideoGenerateParamCapabilities | null = null
  if (ctx.resolveVideoGenerateCapabilities && planned.clips.length > 0) {
    try {
      caps =
        (await ctx.resolveVideoGenerateCapabilities({ model, providerInstanceId }))?.params ?? null
    } catch {
      caps = null
    }
  }
  const fixedDuration = Number(p.rebuildDurationSec) || 0
  const clamped = resolveVideoGenerateParamsForApi(
    {
      generateResolution:
        String(p.generateResolution || p.rebuildResolution || '').trim() || undefined,
      generateAspectRatio:
        String(p.generateAspectRatio || p.rebuildAspectRatio || '').trim() || undefined,
      ...(typeof p.generateSeed === 'number' ? { generateSeed: p.generateSeed } : {}),
      ...(typeof p.generateSeedUseGlobal === 'boolean'
        ? { generateSeedUseGlobal: p.generateSeedUseGlobal }
        : {})
    },
    caps
  )
  const frameSupport = caps?.supportedFrameImages ?? []
  // 能力表声明了帧能力但没有首帧：不发首帧（否则供应商直接 400）
  const firstFrameAllowed = frameSupport.length === 0 || frameSupport.includes('first_frame')
  if (!firstFrameAllowed && planned.clips.some((c) => c.firstFrameRelativePath)) {
    say(
      ctx,
      '所选视频模型不支持首帧，改为文生视频（构图可能与原片不一致）', // cjk-ok
      'The selected video model has no first-frame input; using text-to-video',
      'warn'
    )
  }
  const instruction = String(p.generateInstruction || '')

  const imageModel = String(p.replaceImageModel || '').trim() || undefined
  const imageProviderInstanceId = String(p.replaceImageProviderInstanceId || '').trim() || undefined

  // ── 成本可见：先列出每镜的局部替换开销（首帧重绘几次 + 视频一次） ─────────────────
  for (const clip of planned.clips) {
    const reps = clip.replacements ?? []
    if (!reps.length) continue
    const masked = reps.filter((r) => r.mask).length
    say(
      ctx,
      `${clip.key}：替换 ${reps.map((r) => r.entityName).join('、')} · ${masked} 次首帧重绘 + 1 次视频生成`, // cjk-ok
      `${clip.key}: replacing ${reps.map((r) => r.entityName).join(', ')} · ${masked} first-frame redraw(s) + 1 video generation`
    )
    if (reps.length > SOFT_MAX_REPLACEMENTS_PER_SHOT) {
      notes.push(
        `${clip.key} 同时替换 ${reps.length} 个实体，超过 ${SOFT_MAX_REPLACEMENTS_PER_SHOT} 个时效果可能不稳定，建议拆镜或分次处理` // cjk-ok
      )
    }
    for (const pair of overlappingReplacements(reps)) {
      notes.push(
        `${clip.key}：${pair.a} 与 ${pair.b} 的目标区域重叠约 ${Math.round(pair.ratio * 100)}%，重叠处以先处理的实体为准` // cjk-ok
      )
    }
    const unmasked = reps.filter((r) => !r.mask).map((r) => r.entityName)
    if (masked > 0 && unmasked.length) {
      notes.push(
        `${clip.key}：${unmasked.join('、')} 在这一镜没有点选目标，本镜不会替换它们（先在 Dive 里点选）` // cjk-ok
      )
    }
  }
  const replaceReport: Record<string, { redraws: number; mode: string; failure?: string }> = {}

  const generated = new Map<string, string>()
  const failures: Array<{ key: string; reason: string }> = []
  for (const clip of planned.clips) {
    if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const replacements = clip.replacements ?? []
    let prompt = withInstruction(clip.prompt, instruction, plan.lang)

    // ① 有掩码：首帧逐个重绘 → 图生视频（构图、其他实体、背景都由首帧锚住）
    let edited: FirstFrameEditResult = { redraws: 0, replacedNames: [] }
    if (replacements.some((r) => r.mask)) {
      if (!firstFrameAllowed) {
        edited.failure = 'video model has no first-frame input'
      } else {
        edited = await editFirstFrameForReplacements(ctx, {
          timelineId: plan.timelineId,
          clipKey: clip.key,
          replacements,
          imageModel,
          imageProviderInstanceId
        })
      }
      if (edited.failure) {
        notes.push(
          `${clip.key} 首帧局部替换失败，改用参考图生视频（构图可能与原片不一致）：${edited.failure}` // cjk-ok
        )
      }
    }

    // ② 兜底：参考图生视频。参考图按实体顺序排，提示词里写明"参考图 k 对应谁"
    const referenceUrls: string[] = []
    if (!edited.firstFrameRelativePath) {
      const groups: Array<{ name: string; count: number }> = []
      for (const r of replacements) {
        let count = 0
        for (const ref of r.references) {
          const url = await readReferenceUrl(ctx, ref)
          if (url) {
            referenceUrls.push(url)
            count += 1
          } else {
            notes.push(`${clip.key} 的 ${r.entityName} 参考图读不到，已忽略`) // cjk-ok
          }
        }
        groups.push({ name: r.entityName, count })
      }
      // 旧计划（只有无序的 referenceAssetIds）
      for (const assetId of replacements.length ? [] : (clip.referenceAssetIds ?? [])) {
        const url = await ctx.resolveAssetImageUrl?.(assetId).catch(() => undefined)
        if (url) referenceUrls.push(url)
        else notes.push(`${clip.key} 的参考资产 ${assetId} 读不到，已忽略`) // cjk-ok
      }
      const legend = referenceLegend(groups, plan.lang)
      if (legend) prompt = `${prompt}${plan.lang === 'zh' ? '。' : '. '}${legend}`
    } else {
      const note = replacementVideoNote(edited.replacedNames, plan.lang)
      if (note) prompt = `${prompt}${plan.lang === 'zh' ? '。' : '. '}${note}`
    }

    let firstFrameImageUrl: string | undefined
    const firstFrameRel = edited.firstFrameRelativePath ?? clip.firstFrameRelativePath
    if (
      referenceUrls.length === 0 &&
      firstFrameAllowed &&
      firstFrameRel &&
      ctx.resolveProjectMediaUrl
    ) {
      firstFrameImageUrl = await ctx.resolveProjectMediaUrl(firstFrameRel).catch(() => undefined)
    }
    if (replacements.length) {
      replaceReport[clip.key] = {
        redraws: edited.redraws,
        mode: edited.firstFrameRelativePath ? 'first-frame-edit' : 'reference',
        ...(edited.failure ? { failure: edited.failure } : {})
      }
    }
    const duration = fixedDuration || pickGenerateDuration(clip.durationSec, caps?.durations)
    const modeZh = edited.firstFrameRelativePath
      ? '（首帧替换 + 图生视频）' // cjk-ok
      : referenceUrls.length
        ? '（参考图生视频）' // cjk-ok
        : firstFrameImageUrl
          ? '（图生视频）' // cjk-ok
          : '（文生视频）' // cjk-ok
    const modeEn = edited.firstFrameRelativePath
      ? ' (first-frame replace + image-to-video)'
      : referenceUrls.length
        ? ' (reference-to-video)'
        : firstFrameImageUrl
          ? ' (image-to-video)'
          : ' (text-to-video)'
    say(
      ctx,
      `生成 ${clip.key}${modeZh} · ${duration}s`, // cjk-ok
      `Generating ${clip.key}${modeEn} · ${duration}s`
    )
    try {
      const res = await generateClipVideo(
        ctx,
        {
          prompt,
          model,
          providerInstanceId,
          ...(clamped.resolution ? { resolution: clamped.resolution } : {}),
          ...(clamped.aspectRatio ? { aspectRatio: clamped.aspectRatio } : {}),
          ...(typeof clamped.seed === 'number' ? { seed: clamped.seed } : {}),
          generateAudio: false,
          ...(firstFrameImageUrl ? { firstFrameImageUrl } : {}),
          ...(referenceUrls.length
            ? {
                inputReferences: referenceUrls.map((url) => ({ kind: 'image_url' as const, url }))
              }
            : {}),
          name: `rebuild-${clip.key}`,
          graphBinding: { nodeId: ctx.node.id }
        },
        duration
      )
      generated.set(clip.key, res.relativePath)
    } catch (e) {
      const reason = errorText(e)
      failures.push({ key: clip.key, reason })
      say(ctx, `${clip.key} 生成失败：${reason}`, `${clip.key} failed: ${reason}`, 'warn') // cjk-ok
    }
  }

  // 生成失败的镜头：有原片入出点就退回原片段（成片不缺镜），否则只能丢掉
  const segments: import('../../semanticTimeline').SemanticRebuildSegment[] = []
  for (const seg of planned.segments) {
    if (seg.kind === 'generate') {
      const rel = generated.get(seg.key)
      if (rel) {
        segments.push({ ...seg, relativePath: rel })
        continue
      }
      if (seg.sourceStartSec != null && seg.sourceEndSec != null) {
        segments.push({ ...seg, kind: 'source' })
        notes.push(`${seg.key} 生成失败，已用原片段代替`) // cjk-ok
      }
      continue
    }
    segments.push(seg)
  }
  if (segments.length === 0) {
    throw new Error(
      isEn(ctx)
        ? `all clip generations failed (first: ${failures[0]?.reason ?? 'unknown'})`
        : `所有镜头都生成失败（首个原因：${failures[0]?.reason ?? '未知'}）` // cjk-ok
    )
  }

  // ── 重新配音：改过的台词逐句 TTS（失败的句子保留原声） ─────────────────────────
  const dubbed: import('../../semanticTimeline').SemanticRebuildDub[] = []
  if (dubs.length > 0) {
    if (!ctx.generateSpeech) {
      notes.push('当前环境没有语音合成能力，改过的台词只更新字幕') // cjk-ok
    } else {
      const clone = p.rebuildDubClone !== false
      for (const line of dubs) {
        if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const voice = line.voice || String(p.dubVoice || '').trim() || undefined
        try {
          const res = await ctx.generateSpeech({
            input: line.text,
            model: String(p.dubModel || '').trim() || undefined,
            providerInstanceId: String(p.dubProviderInstanceId || '').trim() || undefined,
            ...(voice ? { voice } : {}),
            ...(!voice && clone && line.referenceAudio
              ? { referenceAudio: line.referenceAudio }
              : {}),
            name: `dub-${line.id}`
          })
          if (!res.relativePath) throw new Error('no audio file')
          dubbed.push({
            id: line.id,
            relativePath: res.relativePath,
            sourceStartSec: line.sourceStartSec,
            sourceEndSec: line.sourceEndSec
          })
          say(ctx, `配音 ${line.id}：${line.text}`, `Dubbed ${line.id}: ${line.text}`) // cjk-ok
        } catch (e) {
          const reason = errorText(e)
          notes.push(`${line.id} 配音失败，保留原声：${reason}`) // cjk-ok
        }
      }
    }
  }

  const rebuilt = await ctx.rebuildSemanticVideo({
    timelineId: plan.timelineId,
    clips: segments
      .filter((s) => s.kind === 'generate' && s.relativePath)
      .map((s) => ({ key: s.key, relativePath: s.relativePath! })),
    segments,
    ...(dubbed.length ? { dubs: dubbed } : {}),
    /**
     * 字幕**逐字段拍平**再交出去。
     *
     * 计划可能来自**运行态**（`priorNodeStates` 是会话的 `reactive(runStates)`），
     * 那时 `plan.subtitles` 是 Vue 代理；代理过 contextBridge / IPC 要结构化克隆，
     * Chromium 直接报 `An object could not be cloned.` —— 整趟跑了 4 分半、
     * 视频也生成成功了几镜，却在最后拼接这一步全丢（实测踩到）。
     */
    ...(plan.subtitles?.length
      ? {
          subtitles: plan.subtitles.map((subtitle) => ({
            sourceStartSec: subtitle.sourceStartSec,
            sourceEndSec: subtitle.sourceEndSec,
            text: subtitle.text
          }))
        }
      : {}),
    keepAudio: p.rebuildKeepAudio !== false,
    sourceRelativePath: plan.sourceRelativePath,
    burnSubtitles: p.rebuildBurnSubtitles !== false,
    ...(plan.settings.width ? { width: plan.settings.width } : {}),
    ...(plan.settings.height ? { height: plan.settings.height } : {}),
    ...(plan.settings.fps ? { fps: plan.settings.fps } : {})
  })
  // 生成 / 配音阶段新增的说明 + 拼接服务的说明（开头那批已经打过日志）
  for (const note of [...notes.slice(loggedNotes), ...(rebuilt.notes ?? [])]) {
    say(ctx, note, note, 'warn')
  }

  if (!rebuilt.ok || !rebuilt.outputRelativePath) {
    writeRebuildReport(ctx, {
      ...baseReport,
      execute: true,
      failures,
      replacements: replaceReport,
      error: rebuilt.error
    })
    throw new Error(rebuilt.error || (isEn(ctx) ? 'rebuild failed' : '重建拼接失败')) // cjk-ok
  }
  say(
    ctx,
    `重建完成：${rebuilt.outputRelativePath}（${rebuilt.clipCount} 段生成${rebuilt.passthroughCount ? ` · ${rebuilt.passthroughCount} 段原片` : ''}${rebuilt.dubCount ? ` · 配音 ${rebuilt.dubCount} 句` : ''}${rebuilt.keptAudio ? ' · 保留原音轨' : ''}${rebuilt.burnedSubtitles ? ` · 字幕 ${rebuilt.burnedSubtitles} 条` : ''}）`, // cjk-ok
    `Rebuilt ${rebuilt.outputRelativePath} (${rebuilt.clipCount} generated, ${rebuilt.passthroughCount ?? 0} passthrough${rebuilt.keptAudio ? ' + original audio' : ''})`
  )
  writeRebuildReport(
    ctx,
    {
      ...baseReport,
      execute: true,
      generated: [...generated.keys()],
      failures,
      replacements: replaceReport,
      dubbed: dubbed.map((d) => d.id),
      rebuild: rebuilt
    },
    rebuilt.outputRelativePath
  )
  return {
    'out-video': {
      kind: 'video',
      id: `rebuild.${plan.timelineId}`,
      relativePath: rebuilt.outputRelativePath,
      createdAt: new Date().toISOString()
    }
  }
}
