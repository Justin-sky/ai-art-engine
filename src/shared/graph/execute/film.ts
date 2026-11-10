/**
 * 影视流水线节点执行（film.*）。
 *
 * 闭环设计（不靠图里画环，环在节点内部）：
 * - film.review：审核 → 只重写失败镜头 → 再审核，最多 N 轮；输出修订后的分镜 + 审核报告。
 * - film.render：逐镜关键帧 → （可选）视觉质检不合格自动重拍 → （可选）图生视频；
 *   按提示词指纹增量缓存，改一镜只重拍一镜。
 * - film.breakdown：重新拆解时锁定 / 已确认镜头原样保留，人工修改不会被 AI 冲掉。
 *
 * 所有中间产物都是结构化文档（storyboard / filmCast 口），agent 可以直接读写节点 params
 * （filmStoryboard / filmCast JSON），不需要解析 Markdown。
 */
import type { GraphNodeParams } from '../types'
import type {
  GraphFilmCastValue,
  GraphFilmStoryboardValue,
  GraphImageItem,
  GraphTimelineVisualItem,
  GraphValue,
  GraphVideoItem,
  GraphVoiceItem,
  NodeExecuteContext
} from './types'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import { resolveMentionSources } from './context'
import { materializeGeneratedBatch } from './materialize'
import {
  clampVideoGenerateParams,
  hasAnyVideoGenerateCapability,
  supportedDurationsFromError,
  type VideoGenerateParamCapabilities
} from '../videoGenerateParams'
import type { VideoGeneratePortLimits } from '../portInputLimits'
import {
  applyFilmReview,
  buildFilmContinuityChains,
  composeFilmShotImagePrompt,
  composeFilmShotVideoPrompt,
  deriveFilmCast,
  deriveManjuPublishPack,
  enrichStoryboardFromScreenplayText,
  filmBaseEntityName,
  filmCastEntryImage,
  filmCastSummary,
  filmHash,
  filmNameKey,
  filmStoryboardSummary,
  filmStoryboardToMarkdown,
  findPrevSameSceneShot,
  inferDefaultCharacterVoicePreset,
  isFilmShotLocked,
  matchFilmCastForShot,
  mergeFilmCasts,
  mergeFilmStoryboards,
  parseFilmCast,
  parseFilmCastKinds,
  parseFilmReview,
  parseFilmRevisedShots,
  parseFilmShotRange,
  parseFilmStoryboard,
  replaceFilmShots,
  resolveFilmDirectorStage,
  resolveFilmShotPrevizCinematography,
  resolveFilmShotPrevizMediaFromStage,
  runManjuContinuityAudit,
  selectFilmShot,
  stringifyFilmCast,
  stringifyFilmStoryboard,
  type FilmCast,
  type FilmCastEntry,
  type FilmEntity,
  type FilmShot,
  type FilmStoryboard
} from '../film/storyboard'
import { resolveManjuGenre } from '../film/manjuGenres'
import {
  buildManjuBreakdownSystemPrompt,
  buildManjuCastCardPrompt,
  buildManjuGenreDirective,
  FILM_BREAKDOWN_SYSTEM,
  FILM_FRAME_QC_SYSTEM,
  FILM_JSON_REPAIR,
  FILM_REVIEW_SYSTEM,
  FILM_REVISE_SYSTEM,
  pickFilmPrompt
} from '../film/prompts'

// ─── 值构造 ─────────────────────────────────────────────────────────────

export function filmStoryboardValue(doc: FilmStoryboard): GraphFilmStoryboardValue {
  return { kind: 'storyboard', doc, text: stringifyFilmStoryboard(doc) }
}

export function filmCastValue(doc: FilmCast): GraphFilmCastValue {
  return { kind: 'filmCast', doc, text: stringifyFilmCast(doc) }
}

// ─── 共用 ───────────────────────────────────────────────────────────────

function isEn(ctx: NodeExecuteContext): boolean {
  return (ctx.locale ?? '').toLowerCase().startsWith('en')
}

/** 日志双语选择（一行一对，便于硬编码中文守卫识别为双语数据） */
function pickLogBi(ctx: NodeExecuteContext, zh: string, en: string): string {
  return isEn(ctx) ? en : zh
}

function checkAbort(ctx: NodeExecuteContext): void {
  if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

function patch(ctx: NodeExecuteContext, params: Partial<GraphNodeParams>): void {
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
}

export function clampFilmConcurrency(raw: unknown): number {
  const n = Math.round(Number(raw ?? 3))
  if (!Number.isFinite(n) || n <= 0) return 3
  return Math.min(8, Math.max(1, n))
}

function createConcurrencyLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, Math.floor(limit))
  let active = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    if (active >= max || !queue.length) return
    active += 1
    const run = queue.shift()!
    run()
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            next()
          })
      })
      next()
    })
}

function requireTextModel(
  ctx: NodeExecuteContext
): NonNullable<NodeExecuteContext['generateText']> {
  if (!ctx.generateText) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: {
        zh: '可用的文本模型（请在设置中配置文本模型）',
        en: 'an available text model (configure one in Settings)'
      }
    })
  }
  return ctx.generateText
}

/** 取上游分镜文档：结构化值优先；文本口里贴的 JSON 也认（方便 agent / 人工粘贴） */
function storyboardFromInputs(values: GraphValue[] | undefined): FilmStoryboard | null {
  for (const value of values ?? []) {
    if (value.kind === 'storyboard' && value.doc?.shots?.length) return value.doc
  }
  for (const value of values ?? []) {
    if (value.kind === 'text') {
      const doc = parseFilmStoryboard(value.text)
      if (doc) return doc
    }
  }
  return null
}

/** 取上游设定库：支持多条 `in-cast` 边按接入顺序融合（如全剧角色圣经 + 场景圣经 + 上一集设定库） */
function castFromInputs(values: GraphValue[] | undefined): FilmCast | null {
  const found: FilmCast[] = []
  for (const value of values ?? []) {
    if (value.kind === 'filmCast' && value.doc) found.push(value.doc)
    else if (value.kind === 'text') {
      const cast = parseFilmCast(value.text)
      if (cast) found.push(cast)
    }
  }
  return mergeFilmCasts(...found)
}

/**
 * 解析当前节点的上游或全剧共享设定库（Series Bible Cast）：
 * - 优先读取显式连线的 `in-cast`；
 * - 若未禁用 `filmUseSharedCast` 且画布中存在其他已生成设定图的 `film.workbench` / `film.cast` 节点
 *   （优先读取标记了 `filmIsSeriesBibleCast` 的节点），免连线自动继承其全剧角色/场景/道具资产与配音音色。
 */
function resolveUpstreamOrSharedCast(ctx: NodeExecuteContext): FilmCast | null {
  const explicit = castFromInputs(ctx.inputs['in-cast'])
  if (ctx.node.params.filmUseSharedCast === false || !ctx.document?.nodes?.length) {
    return explicit
  }
  const sharedCasts: FilmCast[] = []
  const candidates = ctx.document.nodes.filter(
    (n) =>
      n.id !== ctx.node.id &&
      (n.typeId === 'film.workbench' || n.typeId === 'film.cast') &&
      typeof n.params?.filmCast === 'string' &&
      n.params.filmCast.trim().length > 0
  )
  candidates.sort((a, b) => {
    const aBible = a.params.filmIsSeriesBibleCast === true ? 0 : 1
    const bBible = b.params.filmIsSeriesBibleCast === true ? 0 : 1
    return aBible - bBible
  })
  for (const other of candidates) {
    const parsed = parseFilmCast(other.params.filmCast)
    if (parsed && parsed.entries.some((e) => !!filmCastEntryImage(e) || !!e.voicePreset)) {
      sharedCasts.push(parsed)
    }
  }
  return mergeFilmCasts(...sharedCasts, explicit)
}

function formatSeriesCastDirective(cast: FilmCast, en: boolean): string {
  const chars = cast.entries.filter((e) => e.kind === 'character')
  const locs = cast.entries.filter((e) => e.kind === 'location')
  const props = cast.entries.filter((e) => e.kind === 'prop')
  const fmt = (list: FilmCastEntry[]): string =>
    list
      .map((e) => {
        const desc = e.description?.trim().slice(0, 60)
        return desc ? `${e.name}（${desc}）` : e.name
      })
      .join(en ? '; ' : '；')
  const parts: string[] = []
  if (chars.length) parts.push(`${en ? 'Characters' : '角色'}: ${fmt(chars)}`)
  if (locs.length) parts.push(`${en ? 'Locations' : '地点'}: ${fmt(locs)}`)
  if (props.length) parts.push(`${en ? 'Props' : '道具'}: ${fmt(props)}`)
  if (!parts.length) return ''
  return en
    ? `Series Bible / Canonical Entities (MUST reuse these exact names in entities[].name and shot characters/location/props whenever the same recurring character, location, or prop appears in this episode; if a recurring character wears a new outfit or state in this episode, name it "BaseName#Variant", e.g. "${chars[0]?.name ?? 'Hero'}#EveningGown"):\n${parts.join('\n')}`
    : `全剧既有设定名录（本集若出现同一人物/地点/道具或其简称，entities[].name 与镜头里的 characters / location / props 必须严格沿用以下标准名称；若常驻角色在本集换了新服装或新状态，请命名为「角色名#新造型」，如「${chars[0]?.name ?? '林夏'}#晚礼服」，以便自动继承主角色面部参考图）：\n${parts.join('\n')}`
}

/** 收集上游剧本正文（文本 / 文本组 / 落盘路径 / 剧本资产引用） */
async function collectScriptText(ctx: NodeExecuteContext, values: GraphValue[]): Promise<string> {
  const parts: string[] = []
  const pushPath = async (text: string | undefined, rel: string | undefined): Promise<void> => {
    const body = text?.trim()
    if (body) {
      parts.push(body)
      return
    }
    const path = rel?.trim()
    if (path && ctx.readRunText) {
      const fromFile = (await ctx.readRunText(path))?.trim()
      if (fromFile) parts.push(fromFile)
    }
  }
  for (const value of values) {
    if (value.kind === 'text') await pushPath(value.text, value.relativePath)
    else if (value.kind === 'texts') {
      for (const item of value.items) await pushPath(item.text, item.relativePath)
    } else if (value.kind === 'output') {
      for (const note of value.notes) await pushPath(note.text, note.relativePath)
      for (const item of value.texts ?? []) await pushPath(item.text, item.relativePath)
    } else if (value.kind === 'asset' && value.assetType === 'screenplay' && value.assetId) {
      const body = (await ctx.resolveAssetText?.(value.assetId))?.trim()
      if (body) parts.push(body)
    }
  }
  if (!parts.length && values.length) {
    for (const source of resolveMentionSources(ctx)) {
      const body = source.text?.trim()
      if (body) parts.push(body)
    }
  }
  return parts.join('\n\n')
}

/**
 * 调文本模型拿 JSON：解析失败时带修复指令重试一次（模型偶尔夹解释或截断围栏）。
 */
async function generateJson<T>(
  ctx: NodeExecuteContext,
  input: { prompt: string; system: string },
  parse: (text: string) => T | null,
  what: { zh: string; en: string }
): Promise<{ value: T; raw: string }> {
  const generateText = requireTextModel(ctx)
  const textModel =
    ctx.node.params.filmTextModel?.trim() ||
    (ctx.node.typeId !== 'film.workbench' ? ctx.node.params.generateModel?.trim() : '') ||
    undefined
  const textProviderId =
    ctx.node.params.filmTextProviderInstanceId?.trim() ||
    (ctx.node.typeId !== 'film.workbench'
      ? ctx.node.params.generateProviderInstanceId?.trim()
      : '') ||
    undefined
  const call = (prompt: string): ReturnType<typeof generateText> =>
    generateText({
      prompt,
      system: input.system,
      model: textModel,
      providerInstanceId: textProviderId
    })
  const first = await call(input.prompt)
  checkAbort(ctx)
  const parsed = parse(first.text)
  if (parsed) return { value: parsed, raw: first.text }
  ctx.log?.(
    pickLogBi(
      ctx,
      '模型输出不是合法 JSON，自动请求修复一次',
      'Model output was not valid JSON; requesting one repair'
    ),
    'warn'
  )
  const retry = await call(
    `${input.prompt}\n\n---\n${first.text.slice(0, 12000)}\n---\n${pickFilmPrompt(FILM_JSON_REPAIR, ctx.locale)}`
  )
  checkAbort(ctx)
  const repaired = parse(retry.text)
  if (repaired) return { value: repaired, raw: retry.text }
  throw fail(SHARED_ERRORS.resultMissing, { what })
}

function storyboardOutputs(
  ctx: NodeExecuteContext,
  doc: FilmStoryboard
): Record<string, GraphValue> {
  return {
    out: filmStoryboardValue(doc),
    'out-text': { kind: 'text', text: filmStoryboardToMarkdown(doc, ctx.locale) }
  }
}

// ─── film.breakdown 分镜拆解 ─────────────────────────────────────────────

export async function executeFilmBreakdownNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const values = ctx.inputs.in ?? []
  const previous = parseFilmStoryboard(node.params.filmStoryboard ?? '')

  // 上游直接给了结构化分镜（或文本口贴的分镜 JSON）：规范化后透传，不调模型
  const upstreamDoc = storyboardFromInputs(values)
  if (upstreamDoc) {
    const merged = mergeFilmStoryboards(previous, upstreamDoc)
    patch(ctx, {
      filmStoryboard: stringifyFilmStoryboard(merged),
      text: filmStoryboardSummary(merged, ctx.locale)
    })
    return storyboardOutputs(ctx, merged)
  }

  const script = (await collectScriptText(ctx, values)) || node.params.text?.trim() || ''
  if (!script) {
    // 没有上游剧本：已有分镜则原样输出（人工编辑过的文档可单独驱动下游）
    if (previous) return storyboardOutputs(ctx, previous)
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (!ctx.generateText && previous) return storyboardOutputs(ctx, previous)

  const en = isEn(ctx)
  const directives: string[] = []
  const target = Math.max(0, Math.round(Number(node.params.filmTargetShots ?? 0)))
  if (target > 0)
    directives.push(en ? `Target shot count: about ${target}.` : `目标镜头数：约 ${target} 镜。`)
  const shotDuration = Math.min(
    60,
    Math.max(0, Math.round(Number(node.params.filmShotDurationSec ?? 0)))
  )
  if (shotDuration > 0) {
    if (shotDuration >= 8) {
      const seg1 = Math.max(1, Math.round(shotDuration * 0.15))
      const seg2 = Math.max(seg1 + 2, Math.round(shotDuration * 0.45))
      const seg3 = Math.max(seg2 + 2, Math.round(shotDuration * 0.75))
      directives.push(
        en
          ? `Target duration per shot: ${shotDuration}s (long-shot mode). Set each shot's durationSec to ${shotDuration} (do NOT split into short ~3s clips). Pack a continuous multi-beat sequence into each shot, and write videoPrompt in explicit time segments covering the full 0–${shotDuration}s timeline (e.g. 0-${seg1}s: ...; ${seg1}-${seg2}s: ...; ${seg2}-${seg3}s: ...; ${seg3}-${shotDuration}s: ...).`
          : `单镜目标时长：${shotDuration} 秒（长分镜模式）。严禁拆成 3 秒左右的短镜头，每个镜头的 durationSec 必须设为 ${shotDuration} 左右，承载连续的多阶段剧情动作；videoPrompt 必须按时间段（如 0-${seg1}s：…；${seg1}-${seg2}s：…；${seg2}-${seg3}s：…；${seg3}-${shotDuration}s：…）完整覆盖 0~${shotDuration} 秒内的每段动作演变、表情转折与运镜轨迹。`
      )
    } else {
      const mid = Math.max(1, Math.round(shotDuration * 0.4))
      directives.push(
        en
          ? `Target duration per shot: ${shotDuration}s. Set each shot's durationSec to ${shotDuration}, and write videoPrompt in explicit time segments (e.g. 0-${mid}s: ...; ${mid}-${shotDuration}s: ...).`
          : `单镜目标时长：${shotDuration} 秒。每个镜头的 durationSec 设为 ${shotDuration} 左右，且 videoPrompt 必须按时间段（如 0-${mid}s：…；${mid}-${shotDuration}s：…）分段写清动作与运镜。`
      )
    }
  }
  const aspect = node.params.filmAspectRatio?.trim()
  if (aspect) directives.push(en ? `Aspect ratio: ${aspect}.` : `画幅：${aspect}。`)
  const upstreamGenreFromDoc = (() => {
    const doc = ctx.document
    if (!doc?.edges?.length || !doc?.nodes?.length) return ''
    const visited = new Set<string>()
    const queue = [node.id]
    while (queue.length) {
      const cur = queue.shift()!
      if (visited.has(cur)) continue
      visited.add(cur)
      for (const edge of doc.edges) {
        if (edge.target !== cur) continue
        const src = doc.nodes.find((n) => n.id === edge.source)
        if (!src) continue
        const g = src.params.filmGenre?.trim()
        if (g && g !== 'auto') return g
        queue.push(src.id)
      }
    }
    return ''
  })()
  const scriptExplicitGenreMatch = script.match(/\b([a-z]{3,16}-manju)\b/i)
  const rawGenreParam =
    upstreamGenreFromDoc ||
    (scriptExplicitGenreMatch?.[1] ? scriptExplicitGenreMatch[1].toLowerCase() : '') ||
    node.params.filmGenre?.trim() ||
    ''
  const explicitGenre = rawGenreParam ? resolveManjuGenre(rawGenreParam, script) : null
  const style = node.params.filmStyle?.trim() || explicitGenre?.visualStyleZh || ''
  if (style) directives.push(en ? `Visual style: ${style}.` : `视觉风格：${style}。`)
  if (explicitGenre) {
    const genreDirective = buildManjuGenreDirective(explicitGenre.id, ctx.locale)
    if (genreDirective) directives.push(genreDirective)
  }
  const upstreamCast = resolveUpstreamOrSharedCast(ctx)
  if (upstreamCast?.entries.length) {
    const castDirective = formatSeriesCastDirective(upstreamCast, en)
    if (castDirective) directives.push(castDirective)
  }
  const extra = (
    node.params.filmBreakdownInstruction ??
    (node.typeId !== 'film.workbench' ? node.params.generateInstruction : '')
  )?.trim()
  if (extra) directives.push(extra)
  const system =
    node.params.generateSystemPrompt?.trim() ||
    (explicitGenre
      ? buildManjuBreakdownSystemPrompt(explicitGenre.id, ctx.locale)
      : pickFilmPrompt(FILM_BREAKDOWN_SYSTEM, ctx.locale))
  const textModelKey =
    node.params.filmTextModel?.trim() ||
    (node.typeId !== 'film.workbench' ? node.params.generateModel?.trim() : '') ||
    ''
  // 指纹只看剧本 + 选项 + 模型（不含锁定清单）：锁定 / 人工改镜头不应触发重新拆解
  const sourceHash = filmHash(`${directives.join('\n')}|${script}|${system}|${textModelKey}`)
  const locked = previous?.shots.filter(isFilmShotLocked) ?? []
  if (locked.length) {
    const list = locked
      .map((shot) => `${shot.id} ${shot.title || shot.action.slice(0, 24)}`)
      .join('; ')
    directives.push(
      en
        ? `These shots are locked by the director; keep their ids and place them in story order: ${list}`
        : `以下镜头已被导演锁定，保留其 id 并放在剧情对应位置：${list}`
    )
  }
  const prompt = [directives.length ? directives.join('\n') : '', en ? 'Script:' : '剧本：', script]
    .filter(Boolean)
    .join('\n\n')

  // 剧本与选项都没变：复用已有分镜（含人工修改 / 锁定），不重复调模型
  if (previous && node.params.filmForce !== true && node.params.filmSourceHash === sourceHash) {
    ctx.log?.(
      pickLogBi(
        ctx,
        '剧本未变化，复用已有分镜（勾选「强制重新生成」可重拆）',
        'Script unchanged; reusing the storyboard (enable Force to re-break down)'
      )
    )
    return storyboardOutputs(ctx, previous)
  }

  ctx.log?.(pickLogBi(ctx, '分镜拆解：请求文本模型…', 'Storyboard breakdown: calling text model…'))
  const { value } = await generateJson(ctx, { prompt, system }, parseFilmStoryboard, {
    zh: '可解析的分镜 JSON',
    en: 'a parseable storyboard JSON'
  })
  const normalizedShots =
    shotDuration > 0
      ? value.shots.map((shot) =>
          shot.durationSec === 4 ||
          (shotDuration >= 8 && shot.durationSec < Math.round(shotDuration * 0.6))
            ? { ...shot, durationSec: shotDuration }
            : shot
        )
      : value.shots
  const upstreamByKey = new Map(
    (upstreamCast?.entries ?? []).map((e) => [`${e.kind}:${filmNameKey(e.name)}`, e])
  )
  const enrichedEntities: FilmEntity[] = value.entities.map((entity) => {
    const exact = upstreamByKey.get(`${entity.kind}:${filmNameKey(entity.name)}`)
    const base = filmBaseEntityName(entity.name)
    const baseEntry = base ? upstreamByKey.get(`${entity.kind}:${filmNameKey(base)}`) : undefined
    const ref = exact ?? baseEntry
    if (!ref) return entity
    return {
      ...entity,
      description: entity.description?.trim() ? entity.description : ref.description,
      ...(ref.voicePreset && !entity.voicePreset ? { voicePreset: ref.voicePreset } : {}),
      ...(ref.heightCm && !entity.heightCm ? { heightCm: ref.heightCm } : {}),
      ...(ref.consistencyAnchors?.length && !entity.consistencyAnchors?.length
        ? { consistencyAnchors: [...ref.consistencyAnchors] }
        : {}),
      ...(ref.dimensions && !entity.dimensions ? { dimensions: ref.dimensions } : {}),
      ...(ref.worldLightDirection && !entity.worldLightDirection
        ? { worldLightDirection: ref.worldLightDirection }
        : {})
    }
  })
  const inferredGenre =
    explicitGenre ??
    resolveManjuGenre(value.genreId || 'auto', `${script}\n${value.title}\n${value.logline}`)
  const next: FilmStoryboard = {
    ...value,
    ...(inferredGenre?.id || value.genreId
      ? { genreId: explicitGenre?.id || value.genreId || inferredGenre?.id }
      : {}),
    entities: enrichedEntities,
    shots: normalizedShots,
    style: style || value.style || upstreamCast?.style || inferredGenre?.visualStyleZh || '',
    aspectRatio: aspect || value.aspectRatio
  }
  const mergedBase = enrichStoryboardFromScreenplayText(
    mergeFilmStoryboards(previous, next),
    script
  )
  const continuityAudit = runManjuContinuityAudit(mergedBase, upstreamCast, inferredGenre)
  const publishPack = mergedBase.publishPack ?? deriveManjuPublishPack(mergedBase, ctx.locale)
  const merged: FilmStoryboard = {
    ...mergedBase,
    continuityAudit,
    publishPack
  }
  patch(ctx, {
    filmStoryboard: stringifyFilmStoryboard(merged),
    filmSourceHash: sourceHash,
    text: filmStoryboardSummary(merged, ctx.locale)
  })
  ctx.log?.(filmStoryboardSummary(merged, ctx.locale))
  return storyboardOutputs(ctx, merged)
}

// ─── film.review 导演审核（自动修订闭环 + 11 项连续性审计） ───────────────────

interface ReviewRound {
  round: number
  verdict: string
  score: number
  failed: number
}

function reviewReportMarkdown(
  ctx: NodeExecuteContext,
  doc: FilmStoryboard,
  history: ReviewRound[]
): string {
  const en = isEn(ctx)
  const lines: string[] = []
  const review = doc.review
  lines.push(
    en
      ? `## Director review: ${review?.verdict ?? '—'} (${review?.score ?? 0}/100)`
      : `## 导演审核：${review?.verdict ?? '—'}（${review?.score ?? 0}/100）`
  )
  for (const row of history) {
    lines.push(
      en
        ? `- Round ${row.round}: ${row.verdict} · score ${row.score} · ${row.failed} shot(s) failing`
        : `- 第 ${row.round} 轮：${row.verdict} · ${row.score} 分 · ${row.failed} 镜不通过`
    )
  }
  if (doc.continuityAudit?.items.length) {
    lines.push(
      '',
      en
        ? `### 11-Point Continuity & Logic Audit (${doc.continuityAudit.score}/100)`
        : `### 11 项工业连续性审计（${doc.continuityAudit.score}/100）`
    )
    for (const item of doc.continuityAudit.items) {
      const badge = item.passed ? 'PASS' : 'FAIL'
      const label = en ? item.labelEn : item.labelZh
      lines.push(`- **[${badge}] ${label}**: ${item.detail}`)
    }
  }
  if (review?.notes.length) {
    lines.push('', en ? '### Global notes' : '### 全局意见')
    for (const note of review.notes) lines.push(`- ${note}`)
  }
  const failing = doc.shots.filter((shot) => shot.review?.verdict === 'fail')
  if (failing.length) {
    lines.push('', en ? '### Remaining issues' : '### 待处理镜头')
    for (const shot of failing) lines.push(`- **${shot.id}** ${shot.review?.notes ?? ''}`)
  }
  return lines.join('\n')
}

export async function executeFilmReviewNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const input =
    storyboardFromInputs(ctx.inputs.in) || parseFilmStoryboard(node.params.filmStoryboard ?? '')
  if (!input) throw new Error('GRAPH_PROCESS_NO_INPUT')
  const script =
    (await collectScriptText(ctx, ctx.inputs['in-script'] ?? ctx.inputs.in ?? [])) ||
    (node.typeId === 'film.workbench' ? node.params.text?.trim() || '' : '')
  const upstreamCast = mergeFilmCasts(
    castFromInputs(ctx.inputs['in-cast']),
    parseFilmCast(node.params.filmCast ?? '')
  )
  const en = isEn(ctx)
  const maxRounds = Math.min(
    5,
    Math.max(0, Math.round(Number(node.params.filmReviewMaxRounds ?? 2)))
  )
  const criteria = (
    node.params.filmReviewInstruction ??
    (node.typeId !== 'film.workbench' ? node.params.generateInstruction : '')
  )?.trim()
  const reviewSystem =
    node.params.generateSystemPrompt?.trim() || pickFilmPrompt(FILM_REVIEW_SYSTEM, ctx.locale)

  let doc = mergeFilmStoryboards(parseFilmStoryboard(node.params.filmStoryboard ?? ''), input)
  const history: ReviewRound[] = []
  for (let round = 1; round <= maxRounds + 1; round++) {
    checkAbort(ctx)
    ctx.log?.(pickLogBi(ctx, `导演审核：第 ${round} 轮`, `Director review: round ${round}`))
    const resolvedGenre = resolveManjuGenre(
      node.params.filmGenre || doc.genreId,
      `${doc.title} ${doc.logline} ${doc.style}`
    )
    const audit = runManjuContinuityAudit(doc, upstreamCast, resolvedGenre)
    doc = { ...doc, continuityAudit: audit }
    const auditWarnings = audit.items
      .filter((c) => !c.passed)
      .map((c) => `[FAIL] ${en ? c.labelEn : c.labelZh}: ${c.detail}`)
      .join('\n')
    const prompt = [
      criteria ? (en ? `Extra criteria: ${criteria}` : `额外审核标准：${criteria}`) : '',
      auditWarnings
        ? en
          ? `Automated 11-Point Continuity Audit findings:\n${auditWarnings}`
          : `程序化 11 项连续性审计发现项：\n${auditWarnings}`
        : '',
      script ? `${en ? 'Original script' : '原剧本'}:\n${script}` : '',
      `${en ? 'Storyboard' : '分镜文档'}:\n${stringifyFilmStoryboard({ ...doc, review: undefined, continuityAudit: undefined })}`
    ]
      .filter(Boolean)
      .join('\n\n')
    const { value: review } = await generateJson(
      ctx,
      { prompt, system: reviewSystem },
      parseFilmReview,
      { zh: '可解析的审核 JSON', en: 'a parseable review JSON' }
    )
    doc = applyFilmReview(doc, review, round)
    const failing = doc.shots.filter(
      (shot) => shot.review?.verdict === 'fail' && !isFilmShotLocked(shot)
    )
    history.push({ round, verdict: review.verdict, score: review.score, failed: failing.length })
    patch(ctx, {
      filmStoryboard: stringifyFilmStoryboard(doc),
      filmReviewReport: reviewReportMarkdown(ctx, doc, history),
      filmReviewVerdict: doc.review?.verdict ?? '',
      text: filmStoryboardSummary(doc, ctx.locale)
    })
    if (review.verdict === 'PASS' || round > maxRounds) break
    if (!failing.length && !review.notes.length) break

    // 修订：只重写失败镜头（没有逐镜问题、只有全局意见时，把未锁定镜头交给模型按意见修）
    ctx.log?.(
      pickLogBi(
        ctx,
        `自动修订 ${failing.length || '全局'} 处问题…`,
        `Auto-revising ${failing.length || 'global'} issue(s)…`
      )
    )
    const targets = failing.length ? failing : doc.shots.filter((shot) => !isFilmShotLocked(shot))
    const notes = failing.length
      ? failing.map((shot) => `${shot.id}: ${shot.review?.notes ?? ''}`).join('\n')
      : review.notes.join('\n')
    const revisePrompt = [
      `${en ? 'Review notes' : '审片意见'}:\n${notes}`,
      `${en ? 'Entities' : '实体表'}:\n${JSON.stringify(doc.entities)}`,
      `${en ? 'Shots to revise' : '待修改镜头'}:\n${JSON.stringify(
        targets.map(({ media: _media, review: _review, ...rest }) => rest)
      )}`
    ].join('\n\n')
    const { value: revised } = await generateJson(
      ctx,
      { prompt: revisePrompt, system: pickFilmPrompt(FILM_REVISE_SYSTEM, ctx.locale) },
      (text) => {
        const shots = parseFilmRevisedShots(text)
        return shots.length ? shots : null
      },
      { zh: '可解析的修订镜头 JSON', en: 'parseable revised shots JSON' }
    )
    doc = replaceFilmShots(doc, revised)
    patch(ctx, {
      filmStoryboard: stringifyFilmStoryboard(doc),
      text: filmStoryboardSummary(doc, ctx.locale)
    })
  }

  const report = reviewReportMarkdown(ctx, doc, history)
  patch(ctx, {
    filmStoryboard: stringifyFilmStoryboard(doc),
    filmReviewReport: report,
    filmReviewVerdict: doc.review?.verdict ?? '',
    text: filmStoryboardSummary(doc, ctx.locale)
  })
  return {
    out: filmStoryboardValue(doc),
    'out-text': { kind: 'text', text: report }
  }
}

// ─── film.cast 角色场景设定 ─────────────────────────────────────────────

async function resolveRefUrls(
  ctx: NodeExecuteContext,
  refs: Array<{ relativePath?: string; dataUrl?: string }>
): Promise<string[]> {
  if (!refs.length) return []
  if (ctx.resolveImageUrls) return (await ctx.resolveImageUrls(refs)).filter(Boolean)
  return refs
    .map((ref) => ref.dataUrl?.trim() || '')
    .filter((url) => url.startsWith('data:') || /^https?:\/\//i.test(url))
}

function entryRefItem(entry: FilmCastEntry): { relativePath?: string; dataUrl?: string } {
  if (entry.imageRelativePath) return { relativePath: entry.imageRelativePath }
  return { dataUrl: entry.imageUrl }
}

/** 用户接进来的参考图：标题与实体名匹配的作为该实体设定图；不匹配的作为全局风格参考 */
function splitUserRefs(
  values: GraphValue[] | undefined,
  entries: readonly FilmCastEntry[]
): { byKey: Map<string, GraphImageItem>; style: GraphImageItem[] } {
  const items: GraphImageItem[] = []
  for (const value of values ?? []) {
    if (value.kind === 'image') items.push(value)
    else if (value.kind === 'images') items.push(...value.items)
  }
  const names = new Set(entries.map((entry) => filmNameKey(entry.name)))
  const byKey = new Map<string, GraphImageItem>()
  const style: GraphImageItem[] = []
  for (const item of items) {
    const key = filmNameKey(item.title ?? '')
    if (key && names.has(key)) byKey.set(key, item)
    else style.push(item)
  }
  return { byKey, style }
}

function castImageItems(cast: FilmCast): GraphImageItem[] {
  return cast.entries
    .filter((entry) => filmCastEntryImage(entry))
    .map((entry) => ({
      id: `cast:${entry.id}`,
      title: entry.name,
      dataUrl: entry.imageUrl ?? '',
      ...(entry.imageRelativePath ? { relativePath: entry.imageRelativePath } : {})
    }))
}

export async function executeFilmCastNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const onlyId = node.params.filmCastOnlyId?.trim() || ''
  if (onlyId) patch(ctx, { filmCastOnlyId: '' })
  const storyboard =
    storyboardFromInputs(ctx.inputs.in) || parseFilmStoryboard(node.params.filmStoryboard ?? '')
  const upstreamCast = resolveUpstreamOrSharedCast(ctx)
  const localPrev = parseFilmCast(node.params.filmCast ?? '')
  const previous = mergeFilmCasts(upstreamCast, localPrev)
  if (!storyboard && !previous?.entries.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  const kinds = parseFilmCastKinds(node.params.filmCastKinds)
  const cast = storyboard ? deriveFilmCast(storyboard, previous, kinds) : previous!
  if (
    node.params.filmEnableStyleAnchor === true &&
    !cast.entries.some((entry) => entry.kind === 'style')
  ) {
    cast.entries.unshift({
      id: 'style-anchor-1',
      code: 'STYLE01',
      kind: 'style',
      name: isEn(ctx) ? 'STYLE01 Visual Style Anchor' : 'STYLE01 视觉风格定调图',
      description: storyboard?.bible?.colorScheme || cast.style || storyboard?.style || ''
    })
  }
  const persistCast = (): void => {
    patch(ctx, { filmCast: stringifyFilmCast(cast), text: filmCastSummary(cast, ctx.locale) })
  }
  persistCast()
  if (!storyboard && !onlyId && previous?.entries.length) {
    return {
      out: filmCastValue(previous),
      'out-sheets': { kind: 'images', items: castImageItems(previous) }
    }
  }
  const upstreamImageKeys = new Set(
    (upstreamCast?.entries ?? [])
      .filter((entry) => filmCastEntryImage(entry))
      .map((entry) => `${entry.kind}:${filmNameKey(entry.name)}`)
  )
  const { byKey, style } = splitUserRefs(ctx.inputs['in-image'], cast.entries)
  const styleUrls = await resolveRefUrls(ctx, style.slice(0, 2))
  const force = node.params.filmForce === true
  const extra = (
    node.params.filmCastInstruction ??
    (node.typeId !== 'film.workbench' ? node.params.generateInstruction : '')
  )?.trim()
  const aspect = node.params.generateAspectRatio?.trim() || undefined
  const concurrency = clampFilmConcurrency(node.params.filmRenderConcurrency)
  const castLimiter = createConcurrencyLimiter(concurrency)
  let generated = 0

  const findBaseCastEntry = (entry: FilmCastEntry): FilmCastEntry | null => {
    const baseName = filmBaseEntityName(entry.name)
    if (!baseName) return null
    const key = `${entry.kind}:${filmNameKey(baseName)}`
    return (
      cast.entries.find((item) => `${item.kind}:${filmNameKey(item.name)}` === key) ??
      previous?.entries.find((item) => `${item.kind}:${filmNameKey(item.name)}` === key) ??
      null
    )
  }

  const processEntry = async (entry: FilmCastEntry): Promise<void> => {
    checkAbort(ctx)
    if (onlyId) {
      const isTarget = entry.id === onlyId || filmNameKey(entry.name) === filmNameKey(onlyId)
      if (!isTarget) return
    } else if (entry.locked) {
      return
    }
    const forceEntry = force || !!onlyId
    const entryKey = `${entry.kind}:${filmNameKey(entry.name)}`
    // 全剧设定库（in-cast）已带设定图的常驻实体直接复用，避免跨集重画导致换脸
    if (!forceEntry && upstreamImageKeys.has(entryKey) && filmCastEntryImage(entry)) {
      return
    }
    // 用户直接给了该实体的图：作为设定图，不再生成
    const userRef = byKey.get(filmNameKey(entry.name))
    if (userRef) {
      if (userRef.relativePath) {
        entry.imageRelativePath = userRef.relativePath
        delete entry.imageUrl
      } else if (userRef.dataUrl) {
        const saved = await materializeGeneratedBatch(ctx, [userRef], `cast:${entry.id}`)
        if (saved[0]?.relativePath) entry.imageRelativePath = saved[0].relativePath
        else entry.imageUrl = userRef.dataUrl
      }
      entry.promptHash = 'user'
      persistCast()
      return
    }
    const baseEntry = findBaseCastEntry(entry)
    const baseHasImg = !!baseEntry && !!filmCastEntryImage(baseEntry)
    const baseUrls =
      baseHasImg && baseEntry ? await resolveRefUrls(ctx, [entryRefItem(baseEntry)]) : []
    const variantRefLine =
      baseUrls.length && baseEntry
        ? isEn(ctx)
          ? `Identity reference: keep the exact facial features, bone structure and core identity of reference @1 (${baseEntry.name}), changing only the outfit or state as described below.`
          : `角色基底参考：人物面部五官、骨相与核心特征严格继承参考图@1（${baseEntry.name}），仅按以下描述更换服装、造型或状态。`
        : ''
    const prompt = buildManjuCastCardPrompt(entry, cast, ctx.locale, {
      genreId: node.params.filmGenre || storyboard?.genreId,
      variantRefLine,
      extra
    })
    const imageSeed =
      node.params.generateSeedUseGlobal === false ? node.params.generateSeed : undefined
    const baseImgKey = baseHasImg && baseEntry ? filmCastEntryImage(baseEntry) : ''
    const hash = filmHash(
      `${prompt}|${baseImgKey}|${node.params.generateModel ?? ''}|${aspect ?? ''}|${node.params.generateResolution ?? ''}|${node.params.generateQuality ?? ''}|${imageSeed ?? ''}`
    )
    if (!forceEntry && filmCastEntryImage(entry) && entry.promptHash === hash) return
    if (!ctx.generateImage) return
    ctx.log?.(pickLogBi(ctx, `设定图：${entry.name}`, `Design sheet: ${entry.name}`))
    const refList = [...baseUrls, ...styleUrls]
    const result = await ctx.generateImage({
      prompt,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined,
      aspectRatio: aspect ?? (entry.kind === 'location' ? '16:9' : '4:3'),
      resolution: node.params.generateResolution || undefined,
      quality: node.params.generateQuality || undefined,
      ...(imageSeed != null ? { seed: imageSeed } : {}),
      n: 1,
      inputReferences: refList.length ? refList : undefined
    })
    checkAbort(ctx)
    const dataUrl = result.images?.[0]?.trim()
    if (!dataUrl) return
    const saved = await materializeGeneratedBatch(
      ctx,
      [{ id: `cast:${entry.id}`, dataUrl, createdAt: new Date().toISOString() }],
      `cast:${entry.id}`
    )
    if (saved[0]?.relativePath) {
      entry.imageRelativePath = saved[0].relativePath
      delete entry.imageUrl
    } else {
      entry.imageUrl = dataUrl
    }
    entry.promptHash = hash
    generated += 1
    persistCast()
  }

  // 第一阶段并发生成主实体，第二阶段并发生成依赖主实体设定图的 #造型 变体实体
  const baseEntries: FilmCastEntry[] = []
  const variantEntries: FilmCastEntry[] = []
  for (const entry of cast.entries) {
    if (findBaseCastEntry(entry)) variantEntries.push(entry)
    else baseEntries.push(entry)
  }
  await Promise.all(baseEntries.map((entry) => castLimiter(() => processEntry(entry))))
  if (variantEntries.length) {
    await Promise.all(variantEntries.map((entry) => castLimiter(() => processEntry(entry))))
  }

  const missing = cast.entries.filter((entry) => !filmCastEntryImage(entry))
  if (missing.length && !ctx.generateImage) {
    ctx.log?.(
      pickLogBi(
        ctx,
        `未配置图片模型：${missing.length} 个设定没有设定图`,
        `No image model: ${missing.length} entries have no design sheet`
      ),
      'warn'
    )
  }
  patch(ctx, { filmCast: stringifyFilmCast(cast), text: filmCastSummary(cast, ctx.locale) })
  ctx.log?.(
    pickLogBi(ctx, `设定库：新生成 ${generated} 张`, `Cast: ${generated} new design sheet(s)`)
  )
  return {
    out: filmCastValue(cast),
    'out-sheets': { kind: 'images', items: castImageItems(cast) }
  }
}

// ─── film.shot 镜头装配（精修单镜） ─────────────────────────────────────

export async function executeFilmShotNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const storyboard = storyboardFromInputs(ctx.inputs.in)
  if (!storyboard) throw new Error('GRAPH_PROCESS_NO_INPUT')
  const ref = ctx.node.params.filmShotRef
  const shot = selectFilmShot(storyboard, ref)
  if (!shot) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: {
        zh: `镜头「${ref ?? ''}」（请填 1 起序号或镜头 id）`,
        en: `shot "${ref ?? ''}" (use a 1-based index or shot id)`
      }
    })
  }
  const cast = resolveUpstreamOrSharedCast(ctx)
  const refs = matchFilmCastForShot(cast, shot)
  const prevShot = findPrevSameSceneShot(storyboard, shot)
  const prevKeyframe = prevShot?.media?.keyframe?.trim() || ''
  const previzKeyframe = shot.media?.previzKeyframe?.trim() || ''
  const prevKeyframeRefIndex = prevKeyframe ? refs.length + 1 : undefined
  const previzRefIndex = previzKeyframe ? refs.length + (prevKeyframe ? 2 : 1) : undefined
  const imagePrompt = composeFilmShotImagePrompt(storyboard, shot, refs, ctx.locale, {
    prevShot,
    prevKeyframeRefIndex,
    previzRefIndex
  })
  const videoPrompt = composeFilmShotVideoPrompt(shot, ctx.locale, {
    prevShot,
    castRefs: refs,
    storyboard
  })
  const refItems: GraphImageItem[] = [
    ...refs.map((entry) => ({
      id: `cast:${entry.id}`,
      title: entry.name,
      dataUrl: entry.imageUrl ?? '',
      ...(entry.imageRelativePath ? { relativePath: entry.imageRelativePath } : {})
    })),
    ...(prevKeyframe && prevShot
      ? [
          {
            id: `prev:${prevShot.id}`,
            title: prevShot.id,
            dataUrl: prevKeyframe.startsWith('data:') ? prevKeyframe : '',
            ...(prevKeyframe.startsWith('data:') ? {} : { relativePath: prevKeyframe })
          }
        ]
      : []),
    ...(previzKeyframe
      ? [
          {
            id: `previz:${shot.id}`,
            title: `3D Previz ${shot.id}`,
            dataUrl: previzKeyframe.startsWith('data:') ? previzKeyframe : '',
            ...(previzKeyframe.startsWith('data:') ? {} : { relativePath: previzKeyframe })
          }
        ]
      : [])
  ]
  patch(ctx, { text: `${shot.id} · ${shot.title || shot.action}`.slice(0, 200) })
  return {
    out: { kind: 'text', text: imagePrompt },
    'out-motion': { kind: 'text', text: videoPrompt },
    'out-refs': { kind: 'images', items: refItems }
  }
}

// ─── film.render 批量拍摄 ───────────────────────────────────────────────

export interface FilmRenderEntry {
  keyframe?: string
  keyframeHash?: string
  video?: string
  videoHash?: string
  voice?: string
  voiceHash?: string
  qc?: { pass: boolean; issues: string }
  error?: string
}

export type FilmRenderCache = Record<string, FilmRenderEntry>

export function parseFilmRenderCache(raw: string | undefined | null): FilmRenderCache {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as FilmRenderCache)
      : {}
  } catch {
    return {}
  }
}

function parseQc(text: string): { pass: boolean; issues: string } | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const row = JSON.parse(match[0]) as Record<string, unknown>
    const pass = row.pass === true || String(row.pass).toLowerCase() === 'true'
    return { pass, issues: typeof row.issues === 'string' ? row.issues.trim() : '' }
  } catch {
    return null
  }
}

function shotSpecForQc(ctx: NodeExecuteContext, shot: FilmShot): string {
  const en = isEn(ctx)
  return [
    `${en ? 'Shot' : '镜头'} ${shot.id}: ${shot.shotSize} ${shot.angle}`.trim(),
    `${en ? 'Characters' : '角色'}: ${shot.characters.join(', ') || '—'}`,
    `${en ? 'Location' : '地点'}: ${shot.location || '—'}`,
    `${en ? 'Action' : '画面'}: ${shot.action || shot.imagePrompt}`
  ].join('\n')
}

function mediaRefItem(path: string): { relativePath?: string; dataUrl?: string } {
  return path.startsWith('data:') ? { dataUrl: path } : { relativePath: path }
}

/** 选一个视频模型支持的生成时长：优先 ≥ 镜头时长的最小档；无更长档时取最大档 */
export function pickFilmVideoDuration(shotSec: number, durations?: number[]): number {
  const want = Math.max(2, Math.round(shotSec))
  if (!durations?.length) return want
  const sorted = [
    ...new Set(durations.map((n) => Math.round(n)).filter((n) => Number.isFinite(n) && n > 0))
  ].sort((a, b) => a - b)
  if (!sorted.length) return want
  return sorted.find((d) => d >= want) ?? sorted[sorted.length - 1]!
}

export async function executeFilmRenderNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const onlyShotId = node.params.filmRenderOnlyShotId?.trim() || ''
  if (onlyShotId) patch(ctx, { filmRenderOnlyShotId: '' })
  const input =
    storyboardFromInputs(ctx.inputs.in) || parseFilmStoryboard(node.params.filmStoryboard ?? '')
  if (!input) throw new Error('GRAPH_PROCESS_NO_INPUT')
  const cast = mergeFilmCasts(
    resolveUpstreamOrSharedCast(ctx),
    parseFilmCast(node.params.filmCast ?? '')
  )
  const cache = parseFilmRenderCache(node.params.filmRenders)
  const mode = node.params.filmRenderMode === 'video' ? 'video' : 'keyframe'
  const forceAll = node.params.filmForce === true
  const continuityOn = node.params.filmRenderContinuity !== false
  const previzVideoRefOn = node.params.filmRenderPrevizVideoRef !== false
  const qcOn = node.params.filmRenderQc === true && !!ctx.generateText
  const audioOn = node.params.filmRenderAudio !== false && !!ctx.generateSpeech
  const maxRetries = Math.min(
    3,
    Math.max(0, Math.round(Number(node.params.filmRenderMaxRetries ?? 1)))
  )
  const concurrency = clampFilmConcurrency(node.params.filmRenderConcurrency)
  const aspect = node.params.generateAspectRatio?.trim() || input.aspectRatio || undefined
  const indexes = parseFilmShotRange(onlyShotId || node.params.filmShotRange, input.shots)
  if (!ctx.generateImage) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: '可用的图片模型（关键帧）', en: 'an available image model (keyframes)' }
    })
  }
  if (mode === 'video' && !ctx.generateVideo) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: '可用的视频模型', en: 'an available video model' }
    })
  }
  const generateImage = ctx.generateImage
  const generateVideo = ctx.generateVideo
  const generateText = ctx.generateText
  const generateSpeech = ctx.generateSpeech

  let videoCaps: VideoGenerateParamCapabilities | null = null
  let videoPortLimits: VideoGeneratePortLimits | null = null
  if (mode === 'video' && ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.filmVideoModel || undefined,
        providerInstanceId: node.params.filmVideoProviderInstanceId || undefined
      })
      if (bundle) {
        videoCaps = bundle.params
        videoPortLimits = bundle.portLimits
      }
    } catch {
      /* 能力查询失败时沿用镜头参数，遇时长 400 自动按返回档位重试 */
    }
  }

  const shots = input.shots.map((shot) => ({ ...shot }))
  let rendered = 0
  let reused = 0
  const failures: string[] = []
  const persist = (): void => {
    const ordered: FilmRenderCache = {}
    for (const s of shots) {
      if (cache[s.id]) ordered[s.id] = cache[s.id]
    }
    for (const [k, v] of Object.entries(cache)) {
      if (!(k in ordered)) ordered[k] = v
    }
    patch(ctx, { filmRenders: JSON.stringify(ordered) })
  }

  const hostAssetId = ctx.resolveHostAssetId?.()?.trim()
  const hostGenParams = hostAssetId ? ctx.resolveAssetGenParams?.(hostAssetId) : undefined
  const directorStage = resolveFilmDirectorStage({
    node,
    document: ctx.document,
    genParams: hostGenParams,
    storyboard: input
  })

  // 从 3D 分镜白模预演舞台同步已有的抓拍图/录制视频；若尚未录制则离屏自动渲染每镜 3D 白模预演关键帧与运镜视频
  if (directorStage) {
    let storyboardMediaPatched = false
    const missingPrevizShotIds: string[] = []
    for (const idx of indexes) {
      const s = shots[idx]
      if (!s) continue
      const fromStage = resolveFilmShotPrevizMediaFromStage(directorStage, s.id)
      const nextKeyframe = s.media?.previzKeyframe?.trim() || fromStage.previzKeyframe
      const nextVideo = s.media?.previzVideo?.trim() || fromStage.previzVideo
      if (
        (nextKeyframe && nextKeyframe !== s.media?.previzKeyframe) ||
        (nextVideo && nextVideo !== s.media?.previzVideo)
      ) {
        s.media = {
          ...s.media,
          ...(nextKeyframe ? { previzKeyframe: nextKeyframe } : {}),
          ...(nextVideo ? { previzVideo: nextVideo } : {})
        }
        storyboardMediaPatched = true
      }
      const needsKf = !s.media?.previzKeyframe?.trim()
      const needsVid = mode === 'video' && previzVideoRefOn && !s.media?.previzVideo?.trim()
      if (needsKf || needsVid) {
        missingPrevizShotIds.push(s.id)
      }
    }

    if (missingPrevizShotIds.length > 0 && ctx.renderDirectorStagePreviz) {
      try {
        ctx.log?.(
          pickLogBi(
            ctx,
            previzVideoRefOn && mode === 'video'
              ? `正在从 3D 分镜白模预演离屏渲染 ${missingPrevizShotIds.length} 镜运镜视频与构图参考图…`
              : `正在从 3D 分镜白模预演离屏渲染 ${missingPrevizShotIds.length} 镜构图参考图…`,
            previzVideoRefOn && mode === 'video'
              ? `Rendering 3D white-box previz videos & keyframes for ${missingPrevizShotIds.length} shot(s)…`
              : `Rendering 3D white-box previz keyframes for ${missingPrevizShotIds.length} shot(s)…`
          )
        )
        const renderedPreviz = await ctx.renderDirectorStagePreviz({
          stage: directorStage.stage,
          shots,
          onlyShotIds: missingPrevizShotIds,
          node,
          hostAssetId,
          hostAssetName: ctx.resolveHostAssetName?.(),
          includeKeyframe: true,
          includeVideo: mode === 'video' && previzVideoRefOn
        })
        const byShotId = new Map(
          renderedPreviz.map((item) => [item.shotId.trim().toLowerCase(), item])
        )
        for (const idx of indexes) {
          const s = shots[idx]
          if (!s) continue
          const hit = byShotId.get(s.id.trim().toLowerCase())
          if (!hit) continue
          const kf = hit.keyframePath || hit.keyframeDataUrl
          const vid = hit.videoPath || hit.videoDataUrl
          if (kf || vid) {
            s.media = {
              ...s.media,
              ...(kf && !s.media?.previzKeyframe ? { previzKeyframe: kf } : {}),
              ...(vid && !s.media?.previzVideo ? { previzVideo: vid } : {})
            }
            storyboardMediaPatched = true
          }
        }
      } catch (previzErr) {
        console.warn('[film] offscreen 3D previz render failed:', previzErr)
      }
    }

    if (storyboardMediaPatched) {
      patch(ctx, { filmStoryboard: stringifyFilmStoryboard(replaceFilmShots(input, shots)) })
    }
  }

  const stepByIndex = new Map(indexes.map((idx, step) => [idx, step]))
  const chains = buildFilmContinuityChains(input, indexes, continuityOn)
  const chainLimiter = createConcurrencyLimiter(concurrency)
  const videoLimiter = createConcurrencyLimiter(concurrency)
  const videoTasks: Promise<void>[] = []
  const voiceTasks: Promise<void>[] = []

  const resolveShotVoiceSpec = (
    shot: FilmShot
  ): { spokenText: string; voice: string; speaker: string } | null => {
    if (!shot.dialogue?.length) return null
    const lines = shot.dialogue.filter((item) => item.line?.trim())
    if (!lines.length) return null
    const primary = lines[0]!
    const speaker = primary.speaker?.trim() || ''
    const speakerKey = filmNameKey(speaker)
    const baseName = speaker ? filmBaseEntityName(speaker) : null
    const baseKey = baseName ? filmNameKey(baseName) : ''
    const castChar = cast?.entries.find(
      (e) =>
        e.kind === 'character' &&
        (filmNameKey(e.name) === speakerKey || (baseKey && filmNameKey(e.name) === baseKey))
    )
    const entityChar = input.entities.find(
      (e) =>
        e.kind === 'character' &&
        (filmNameKey(e.name) === speakerKey || (baseKey && filmNameKey(e.name) === baseKey))
    )
    const voice =
      castChar?.voicePreset?.trim() ||
      entityChar?.voicePreset?.trim() ||
      (primary.mode === 'vo'
        ? 'alloy'
        : inferDefaultCharacterVoicePreset(
            speaker,
            castChar?.description || entityChar?.description || '',
            0
          ))
    const spokenText = lines.map((item) => item.line.trim()).join(' ')
    return spokenText ? { spokenText, voice, speaker: speaker || 'VO' } : null
  }

  const runShotVoice = async (
    shot: FilmShot,
    entry: FilmRenderEntry,
    forceVoice: boolean,
    progress: string
  ): Promise<void> => {
    if (!audioOn || !generateSpeech) return
    const spec = resolveShotVoiceSpec(shot)
    if (!spec) return
    const voiceHash = filmHash(`${shot.id}|${spec.spokenText}|${spec.voice}|${spec.speaker}`)
    if (!forceVoice && entry.voice && entry.voiceHash === voiceHash) return
    try {
      checkAbort(ctx)
      ctx.log?.(
        pickLogBi(
          ctx,
          `${progress} 合成角色配音（${spec.speaker} · ${spec.voice}）`,
          `${progress} synthesizing dialogue voice (${spec.speaker} · ${spec.voice})`
        )
      )
      const speech = await generateSpeech({
        input: spec.spokenText,
        voice: spec.voice,
        outputDir: node.params.mediaOutputDir?.trim() || undefined,
        name: `${ctx.resolveHostAssetName?.() || input.title || 'film'}_${shot.id}_voice`
      })
      checkAbort(ctx)
      const voicePath = speech.relativePath?.trim() || ''
      if (!voicePath) return
      entry.voice = voicePath
      entry.voiceHash = voiceHash
      cache[shot.id] = entry
      persist()
    } catch (voiceErr) {
      if ((voiceErr as Error)?.name === 'AbortError') throw voiceErr
      const msg = voiceErr instanceof Error ? voiceErr.message : String(voiceErr)
      ctx.log?.(
        pickLogBi(
          ctx,
          `${progress} 配音合成未完成（${msg}），已跳过该镜配音`,
          `${progress} voice synthesis skipped (${msg})`
        ),
        'warn'
      )
    }
  }

  const runShotVideo = async (
    shot: FilmShot,
    prevShot: FilmShot | null,
    entry: FilmRenderEntry,
    forceVideo: boolean,
    progress: string
  ): Promise<void> => {
    const keyframe = entry.keyframe
    if (mode !== 'video' || !generateVideo || !keyframe) return
    try {
      const shotPreviz = resolveFilmShotPrevizCinematography(directorStage, shot.id)
      const previzVideoSpec = shotPreviz
        ? isEn(ctx)
          ? shotPreviz.videoSpecEn
          : shotPreviz.videoSpecZh
        : undefined
      const previzVideoRaw = previzVideoRefOn ? shot.media?.previzVideo?.trim() || '' : ''
      const modelAllowsVideoRef =
        videoPortLimits == null ||
        videoPortLimits.maxVideos == null ||
        videoPortLimits.maxVideos > 0
      const wantPrevizVideoRef = previzVideoRefOn && Boolean(previzVideoRaw) && modelAllowsVideoRef
      const shotRefs = matchFilmCastForShot(cast, shot)
      const videoPromptFallback = composeFilmShotVideoPrompt(shot, ctx.locale, {
        ...(prevShot ? { prevShot } : {}),
        ...(previzVideoSpec ? { previzVideoSpec } : {}),
        castRefs: shotRefs,
        storyboard: input
      })
      const videoPrompt = wantPrevizVideoRef
        ? composeFilmShotVideoPrompt(shot, ctx.locale, {
            ...(prevShot ? { prevShot } : {}),
            ...(previzVideoSpec ? { previzVideoSpec } : {}),
            hasPrevizVideoRef: true,
            castRefs: shotRefs,
            storyboard: input
          })
        : videoPromptFallback
      const fallbackShotSec =
        typeof node.params.filmShotDurationSec === 'number' &&
        Number.isFinite(node.params.filmShotDurationSec) &&
        node.params.filmShotDurationSec > 0
          ? Math.round(node.params.filmShotDurationSec)
          : 5
      const targetVideoDuration =
        typeof node.params.filmVideoDuration === 'number' &&
        Number.isFinite(node.params.filmVideoDuration) &&
        node.params.filmVideoDuration > 0
          ? Math.round(node.params.filmVideoDuration)
          : shot.durationSec > 0
            ? shot.durationSec
            : fallbackShotSec
      const rawVideoAspect =
        node.params.filmVideoAspectRatio?.trim() || (aspect === '2.39:1' ? '16:9' : aspect)
      const rawVideoResolution = node.params.filmVideoResolution?.trim() || undefined
      const rawVideoAudio =
        typeof node.params.filmVideoAudio === 'boolean' ? node.params.filmVideoAudio : undefined
      const videoSeed =
        node.params.filmVideoSeedUseGlobal === false ? node.params.filmVideoSeed : undefined
      const videoHash = filmHash(
        `${keyframe}|${previzVideoRaw}|${videoPrompt}|${node.params.filmVideoModel ?? ''}|${targetVideoDuration}|${rawVideoResolution ?? ''}|${rawVideoAspect ?? ''}|${rawVideoAudio ?? ''}|${videoSeed ?? ''}`
      )
      if (!forceVideo && entry.video && entry.videoHash === videoHash) return
      checkAbort(ctx)
      const [firstFrame] = await resolveRefUrls(ctx, [mediaRefItem(keyframe)])
      const useMultimodalVideoRef = Boolean(wantPrevizVideoRef && firstFrame)
      ctx.log?.(
        pickLogBi(
          ctx,
          useMultimodalVideoRef
            ? `${progress} 生成视频（参考首帧 @1 + 3D 白模预演视频 @2）`
            : `${progress} 生成视频`,
          useMultimodalVideoRef
            ? `${progress} video (keyframe @1 + 3D previz video @2)`
            : `${progress} video`
        )
      )
      const clamped =
        videoCaps != null && hasAnyVideoGenerateCapability(videoCaps)
          ? clampVideoGenerateParams(
              {
                aspectRatio: rawVideoAspect,
                resolution: rawVideoResolution || node.params.generateResolution || undefined,
                duration: pickFilmVideoDuration(targetVideoDuration, videoCaps.durations),
                generateAudio: rawVideoAudio,
                frameMode: firstFrame ? 'first' : 'none'
              },
              videoCaps
            )
          : null
      const requestDuration =
        clamped?.duration ?? pickFilmVideoDuration(targetVideoDuration, videoCaps?.durations)
      const requestAspect = clamped ? clamped.aspectRatio : rawVideoAspect
      const requestResolution = clamped ? clamped.resolution : rawVideoResolution
      const requestAudio = clamped ? clamped.generateAudio : rawVideoAudio
      const useFirstFrame =
        firstFrame &&
        (!clamped ||
          !videoCaps?.supportedFrameImages?.length ||
          clamped.frameMode === 'first' ||
          clamped.frameMode === 'first_last')
          ? firstFrame
          : undefined
      const fallbackRefs =
        firstFrame && !useFirstFrame ? [{ kind: 'image_url' as const, url: firstFrame }] : undefined
      const normalizedPrevizVideoUrl =
        previzVideoRaw.startsWith('data:') || /^https?:\/\//i.test(previzVideoRaw)
          ? previzVideoRaw
          : previzVideoRaw.replace(/\\/g, '/')
      const multimodalRefs =
        useMultimodalVideoRef && firstFrame
          ? [
              { kind: 'image_url' as const, url: firstFrame },
              { kind: 'video_url' as const, url: normalizedPrevizVideoUrl }
            ]
          : undefined
      const commonVideoFields = {
        model: node.params.filmVideoModel || undefined,
        providerInstanceId: node.params.filmVideoProviderInstanceId || undefined,
        aspectRatio: requestAspect,
        resolution: requestResolution,
        ...(typeof requestAudio === 'boolean' ? { generateAudio: requestAudio } : {}),
        ...(videoSeed != null ? { seed: videoSeed } : {}),
        outputDir: node.params.mediaOutputDir?.trim() || undefined,
        name: `${ctx.resolveHostAssetName?.() || input.title || 'film'}_${shot.id}`,
        graphBinding: {
          hostId: ctx.resolveHostAssetId?.(),
          nodeId: node.id,
          shotId: shot.id
        }
      }
      const fallbackFrameVideoInput = {
        ...commonVideoFields,
        prompt: videoPromptFallback,
        ...(useFirstFrame ? { firstFrameImageUrl: useFirstFrame } : {}),
        ...(fallbackRefs ? { inputReferences: fallbackRefs } : {})
      }
      const primaryVideoInput = multimodalRefs
        ? {
            ...commonVideoFields,
            prompt: videoPrompt,
            inputReferences: multimodalRefs
          }
        : fallbackFrameVideoInput

      const invokeWithDurationRetry = async (
        payload: Omit<Parameters<typeof generateVideo>[0], 'duration'>
      ): Promise<Awaited<ReturnType<typeof generateVideo>>> => {
        try {
          return await generateVideo({
            ...payload,
            duration: requestDuration
          })
        } catch (videoErr) {
          if ((videoErr as Error)?.name === 'AbortError') throw videoErr
          const errMsg = videoErr instanceof Error ? videoErr.message : String(videoErr)
          const supported = supportedDurationsFromError(errMsg)
          const retryDuration = supported.length
            ? pickFilmVideoDuration(targetVideoDuration, supported)
            : undefined
          if (retryDuration == null || retryDuration === requestDuration) throw videoErr
          ctx.log?.(
            pickLogBi(
              ctx,
              `${progress} 模型不支持 ${requestDuration}s，改用 ${retryDuration}s 重试一次`,
              `${progress} ${requestDuration}s rejected by model, retrying with ${retryDuration}s`
            ),
            'warn'
          )
          return await generateVideo({
            ...payload,
            duration: retryDuration
          })
        }
      }

      let video: Awaited<ReturnType<typeof generateVideo>>
      try {
        video = await invokeWithDurationRetry(primaryVideoInput)
      } catch (primaryErr) {
        if ((primaryErr as Error)?.name === 'AbortError' || !multimodalRefs) throw primaryErr
        const reason = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
        ctx.log?.(
          pickLogBi(
            ctx,
            `${progress} 3D 预演参考视频多模态直传未生效（${reason}），自动回退为「首帧图 + 3D 运镜轨迹指令」继续生成`,
            `${progress} 3D previz reference video multimodal call failed (${reason}), falling back to first-frame + 3D trajectory prompt`
          ),
          'warn'
        )
        video = await invokeWithDurationRetry(fallbackFrameVideoInput)
      }
      checkAbort(ctx)
      entry.video = video.relativePath
      entry.videoHash = videoHash
      cache[shot.id] = entry
      persist()
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      const message = err instanceof Error ? err.message : String(err)
      entry.error = message
      failures.push(`${shot.id}: ${message}`)
      ctx.log?.(`${progress} ${message}`, 'error')
      cache[shot.id] = entry
      persist()
    }
  }

  // 按场次连续性链并发拍关键帧（同场次内顺序承接上一镜关键帧，跨场次并发）；
  // 每镜关键帧就绪后立即送入视频并发池，无需阻塞同场下一镜关键帧生成。
  await Promise.all(
    chains.map((chain) =>
      chainLimiter(async () => {
        for (const index of chain) {
          checkAbort(ctx)
          const step = stepByIndex.get(index) ?? 0
          const shot = shots[index]
          const entry: FilmRenderEntry = { ...(cache[shot.id] ?? {}) }
          delete entry.error
          const refs = matchFilmCastForShot(cast, shot)
          const prevShot = continuityOn ? findPrevSameSceneShot(input, shot) : null
          const prevKeyframe = prevShot
            ? (cache[prevShot.id]?.keyframe || prevShot.media?.keyframe || '').trim()
            : ''
          const previzKeyframe = shot.media?.previzKeyframe?.trim() || ''
          const prevKeyframeRefIndex = prevKeyframe ? refs.length + 1 : undefined
          const previzRefIndex = previzKeyframe ? refs.length + (prevKeyframe ? 2 : 1) : undefined
          const shotPreviz = resolveFilmShotPrevizCinematography(directorStage, shot.id)
          const previzImageSpec = shotPreviz
            ? isEn(ctx)
              ? shotPreviz.imageSpecEn
              : shotPreviz.imageSpecZh
            : undefined
          const extra = node.params.generateInstruction?.trim()
          const composed = composeFilmShotImagePrompt(
            input,
            shot,
            refs,
            ctx.locale,
            prevShot || previzRefIndex || previzImageSpec
              ? {
                  ...(prevShot ? { prevShot, prevKeyframeRefIndex } : {}),
                  ...(previzRefIndex ? { previzRefIndex } : {}),
                  ...(previzImageSpec ? { previzImageSpec } : {})
                }
              : undefined
          )
          const basePrompt = extra ? `${composed}\n${extra}` : composed
          const imageSeed =
            node.params.generateSeedUseGlobal === false ? node.params.generateSeed : undefined
          const keyHash = filmHash(
            `${basePrompt}|${refs.map(filmCastEntryImage).join(',')}|${prevKeyframe}|${previzKeyframe}|${node.params.generateModel ?? ''}|${aspect ?? ''}|${node.params.generateResolution ?? ''}|${node.params.generateQuality ?? ''}|${imageSeed ?? ''}`
          )
          const hasValidKeyframe = !!entry.keyframe && entry.keyframeHash === keyHash
          // 单镜执行且处于「关键帧 + 视频」模式：若关键帧已就绪且尚未生成视频，直接复用关键帧补拍视频
          const onlyNeedsVideo =
            !!onlyShotId && mode === 'video' && hasValidKeyframe && !entry.video && !forceAll
          const forceKeyframe = (forceAll || !!onlyShotId) && !onlyNeedsVideo
          const forceVideo = forceAll || !!onlyShotId
          const progress = `[${step + 1}/${indexes.length}] ${shot.id}`
          try {
            // ① 关键帧（指纹未变 → 复用）
            if (forceKeyframe || !hasValidKeyframe) {
              const refItems = [
                ...refs.map(entryRefItem),
                ...(prevKeyframe ? [mediaRefItem(prevKeyframe)] : []),
                ...(previzKeyframe ? [mediaRefItem(previzKeyframe)] : [])
              ]
              const refUrls = await resolveRefUrls(ctx, refItems)
              const refMeta = [
                ...refs.map((ref) => ({
                  source: 'character' as const,
                  name: ref.name,
                  ...(ref.imageRelativePath ? { relativePath: ref.imageRelativePath } : {})
                })),
                ...(prevKeyframe && prevShot
                  ? [
                      {
                        source: 'character' as const,
                        name: prevShot.id,
                        ...(prevKeyframe.startsWith('data:') ? {} : { relativePath: prevKeyframe })
                      }
                    ]
                  : []),
                ...(previzKeyframe
                  ? [
                      {
                        source: 'character' as const,
                        name: `3D Previz ${shot.id}`,
                        ...(previzKeyframe.startsWith('data:')
                          ? {}
                          : { relativePath: previzKeyframe })
                      }
                    ]
                  : [])
              ].slice(0, refUrls.length)
              let prompt = basePrompt
              let attempt = 0
              for (;;) {
                checkAbort(ctx)
                ctx.log?.(
                  pickLogBi(
                    ctx,
                    `${progress} 拍摄关键帧${attempt ? `（重拍 ${attempt}）` : ''}`,
                    `${progress} keyframe${attempt ? ` (retake ${attempt})` : ''}`
                  )
                )
                const result = await generateImage({
                  prompt,
                  model: node.params.generateModel || undefined,
                  providerInstanceId: node.params.generateProviderInstanceId || undefined,
                  aspectRatio: aspect,
                  resolution: node.params.generateResolution || undefined,
                  quality: node.params.generateQuality || undefined,
                  ...(imageSeed != null ? { seed: imageSeed } : {}),
                  n: 1,
                  inputReferences: refUrls.length ? refUrls : undefined,
                  inputReferenceMeta: refMeta.length ? refMeta : undefined
                })
                checkAbort(ctx)
                let dataUrl = result.images?.[0]?.trim() ?? ''
                if (!dataUrl) throw fail(SHARED_ERRORS.noModelImage)
                if (aspect && ctx.normalizeImageAspectRatio && dataUrl.startsWith('data:image/')) {
                  try {
                    dataUrl =
                      (await ctx.normalizeImageAspectRatio({ dataUrl, aspectRatio: aspect })) ||
                      dataUrl
                  } catch {
                    /* 裁正失败保留原图 */
                  }
                }
                const saved = await materializeGeneratedBatch(
                  ctx,
                  [
                    {
                      id: `film:${shot.id}`,
                      title: shot.id,
                      dataUrl,
                      createdAt: new Date().toISOString()
                    }
                  ],
                  `film:${shot.id}`
                )
                const keyframe = saved[0]?.relativePath || dataUrl
                entry.keyframe = keyframe
                entry.keyframeHash = keyHash
                delete entry.video
                delete entry.videoHash
                delete entry.qc

                // ② 视觉质检：不合格带问题重拍
                if (!qcOn || !generateText) break
                const frameUrls = await resolveRefUrls(ctx, [mediaRefItem(keyframe)])
                const qcResult = await generateText({
                  prompt: shotSpecForQc(ctx, shot),
                  system: pickFilmPrompt(FILM_FRAME_QC_SYSTEM, ctx.locale),
                  model: node.params.filmQcModel || undefined,
                  providerInstanceId: node.params.filmQcProviderInstanceId || undefined,
                  images: [...frameUrls, ...refUrls.slice(0, 3)]
                })
                checkAbort(ctx)
                const qc = parseQc(qcResult.text) ?? { pass: true, issues: '' }
                entry.qc = qc
                if (qc.pass || attempt >= maxRetries) {
                  if (!qc.pass) {
                    ctx.log?.(
                      pickLogBi(
                        ctx,
                        `${progress} 质检仍未通过：${qc.issues}`,
                        `${progress} QC still failing: ${qc.issues}`
                      ),
                      'warn'
                    )
                  }
                  break
                }
                attempt += 1
                prompt = `${basePrompt}\n${isEn(ctx) ? 'Reshoot fixes' : '重拍修正'}: ${qc.issues}`
              }
              rendered += 1
            } else {
              reused += 1
            }

            cache[shot.id] = entry
            persist()

            // ③ 图生视频（首帧 = 关键帧）：投入视频并发池，不阻塞同场下一镜关键帧生成
            if (mode === 'video' && generateVideo && entry.keyframe) {
              videoTasks.push(
                videoLimiter(() => runShotVideo(shot, prevShot, entry, forceVideo, progress))
              )
            }
            // ④ 多角色台词配音（TTS）：按角色绑定音色自动合成单镜台词语音
            if (audioOn && generateSpeech && shot.dialogue?.length) {
              voiceTasks.push(videoLimiter(() => runShotVoice(shot, entry, forceVideo, progress)))
            }
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') throw err
            const message = err instanceof Error ? err.message : String(err)
            entry.error = message
            failures.push(`${shot.id}: ${message}`)
            ctx.log?.(`${progress} ${message}`, 'error')
            cache[shot.id] = entry
            persist()
          }
        }
      })
    )
  )

  if (videoTasks.length || voiceTasks.length) {
    await Promise.all([...videoTasks, ...voiceTasks])
  }

  // 产物回写进分镜文档（下游 / agent 读一份文档即可拿到每镜关键帧、视频与配音）
  for (const shot of shots) {
    const entry = cache[shot.id]
    if (!entry?.keyframe && !entry?.video && !entry?.voice) continue
    shot.media = {
      ...shot.media,
      ...(entry.keyframe ? { keyframe: entry.keyframe } : {}),
      ...(entry.video ? { video: entry.video } : {}),
      ...(entry.voice ? { voice: entry.voice } : {})
    }
  }
  const doc: FilmStoryboard = { ...input, shots }
  const images: GraphImageItem[] = []
  const videos: GraphVideoItem[] = []
  const voices: GraphVoiceItem[] = []
  for (const shot of shots) {
    const keyframe = shot.media?.keyframe
    if (keyframe) {
      const inline = keyframe.startsWith('data:')
      images.push({
        id: `film:${shot.id}`,
        title: shot.id,
        dataUrl: inline ? keyframe : '',
        ...(inline ? {} : { relativePath: keyframe })
      })
    }
    if (shot.media?.video) videos.push({ id: `film:${shot.id}`, relativePath: shot.media.video })
    const voicePath = shot.media?.voice?.trim() || ''
    if (voicePath) {
      const spec = resolveShotVoiceSpec(shot)
      voices.push({
        id: `film:${shot.id}`,
        relativePath: voicePath,
        ...(spec?.spokenText ? { text: spec.spokenText } : {}),
        ...(spec?.voice ? { voice: spec.voice } : {})
      })
    }
  }
  patch(ctx, {
    text: filmStoryboardSummary(doc, ctx.locale),
    ...(node.typeId === 'film.workbench' || node.params.filmStoryboard?.trim()
      ? { filmStoryboard: stringifyFilmStoryboard(doc) }
      : {})
  })
  ctx.log?.(
    pickLogBi(
      ctx,
      `批量拍摄完成：新拍 ${rendered} 镜，复用 ${reused} 镜，失败 ${failures.length} 镜`,
      `Render done: ${rendered} new, ${reused} reused, ${failures.length} failed`
    )
  )
  if (failures.length && (!images.length || (mode === 'video' && !videos.length) || !!onlyShotId)) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: `镜头拍摄产物（${failures[0]}）`, en: `shot render output (${failures[0]})` }
    })
  }
  return {
    out: filmStoryboardValue(doc),
    'out-images': { kind: 'images', items: images },
    'out-videos': { kind: 'videos', items: videos },
    'out-voices': { kind: 'voices', items: voices }
  }
}

// ─── film.workbench 影视工作台（五阶段合一节点） ─────────────────────────

async function composeWorkbenchEpisodeVideo(
  ctx: NodeExecuteContext,
  storyboard: FilmStoryboard,
  cache: FilmRenderCache
): Promise<{
  composedVideoPath?: string
  composedShotCount: number
  composedVoiceCount: number
}> {
  if (!ctx.composeTimelineVideo) {
    return { composedShotCount: 0, composedVoiceCount: 0 }
  }
  const visuals: GraphTimelineVisualItem[] = []
  const videos: GraphVideoItem[] = []
  const images: GraphImageItem[] = []
  const voices: Array<GraphVoiceItem & { text?: string; title?: string; trackKind?: 'voice' }> = []
  const subtitles: string[] = []

  storyboard.shots.forEach((shot, index) => {
    const entry = cache[shot.id]
    const videoPath = (entry?.video || shot.media?.video || '').trim()
    const keyframePath = (entry?.keyframe || shot.media?.keyframe || '').trim()
    const voicePath = (entry?.voice || shot.media?.voice || '').trim()
    const shotTitle = `Shot ${index + 1}`
    if (!videoPath && !keyframePath) return

    const dialogueText = (shot.dialogue ?? [])
      .map((item) => {
        const txt = item.line?.trim() || ''
        if (!txt) return ''
        return item.speaker?.trim() ? `${item.speaker.trim()}：${txt}` : txt
      })
      .filter(Boolean)
      .join(' ')
    const spokenText = (shot.dialogue ?? [])
      .map((item) => item.line?.trim() || '')
      .filter(Boolean)
      .join(' ')
    const cardText = shot.productionInfo?.subtitleCard?.trim() || ''
    const subtitleLine = [cardText ? `【${cardText}】` : '', dialogueText || spokenText]
      .filter(Boolean)
      .join(' ')

    if (videoPath) {
      visuals.push({
        id: `film:${shot.id}`,
        kind: 'video',
        title: shotTitle,
        relativePath: videoPath
      })
      videos.push({
        id: `film:${shot.id}`,
        relativePath: videoPath
      })
    } else if (keyframePath) {
      const inline = keyframePath.startsWith('data:')
      visuals.push({
        id: `film:${shot.id}`,
        kind: 'image',
        title: shotTitle,
        ...(inline ? { dataUrl: keyframePath } : { relativePath: keyframePath })
      })
      images.push({
        id: `film:${shot.id}`,
        title: shotTitle,
        dataUrl: inline ? keyframePath : '',
        ...(inline ? {} : { relativePath: keyframePath })
      })
    }
    subtitles.push(subtitleLine)

    if (voicePath) {
      voices.push({
        id: `film:${shot.id}:voice`,
        title: shotTitle,
        relativePath: voicePath,
        text: spokenText || subtitleLine,
        trackKind: 'voice'
      })
    }
  })

  if (!visuals.length) {
    return { composedShotCount: 0, composedVoiceCount: voices.length }
  }

  try {
    ctx.log?.(
      pickLogBi(
        ctx,
        `正在自动合成单集完整成片（${visuals.length} 镜画面 / ${voices.length} 镜配音）…`,
        `Composing full-episode video (${visuals.length} shot(s) / ${voices.length} voice track(s))…`
      )
    )
    const composed = await ctx.composeTimelineVideo({
      nodeId: ctx.node.id,
      document: ctx.document,
      videos,
      images,
      visuals,
      voices,
      subtitles
    })
    const composedVideoPath = composed?.relativePath?.trim() || undefined
    if (composedVideoPath) {
      ctx.log?.(
        pickLogBi(
          ctx,
          `单集完整成片合成完成：${composedVideoPath}`,
          `Full-episode video composed: ${composedVideoPath}`
        )
      )
    }
    return {
      ...(composedVideoPath ? { composedVideoPath } : {}),
      composedShotCount: visuals.length,
      composedVoiceCount: voices.length
    }
  } catch (composeErr) {
    if ((composeErr as Error)?.name === 'AbortError') throw composeErr
    const msg = composeErr instanceof Error ? composeErr.message : String(composeErr)
    ctx.log?.(
      pickLogBi(
        ctx,
        `单集完整成片自动合成未完成（${msg}）`,
        `Full-episode video composition skipped (${msg})`
      ),
      'warn'
    )
    return { composedShotCount: visuals.length, composedVoiceCount: voices.length }
  }
}

function collectWorkbenchOutputs(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const { node } = ctx
  const doc = parseFilmStoryboard(node.params.filmStoryboard ?? '')
  const cast = mergeFilmCasts(
    resolveUpstreamOrSharedCast(ctx),
    parseFilmCast(node.params.filmCast ?? '')
  )
  const cache = parseFilmRenderCache(node.params.filmRenders)
  const shotIds = doc?.shots.map((shot) => shot.id) ?? Object.keys(cache)
  const images: GraphImageItem[] = []
  const videos: GraphVideoItem[] = []
  const voices: GraphVoiceItem[] = []
  for (const shotId of shotIds) {
    const entry = cache[shotId]
    const shotObj = doc?.shots.find((s) => s.id === shotId)
    const kf = (entry?.keyframe ?? shotObj?.media?.keyframe ?? '').trim()
    if (kf) {
      const inline = kf.startsWith('data:')
      images.push({
        id: `film:${shotId}`,
        title: shotId,
        dataUrl: inline ? kf : '',
        ...(inline ? {} : { relativePath: kf })
      })
    }
    const vid = (entry?.video ?? shotObj?.media?.video ?? '').trim()
    if (vid) videos.push({ id: `film:${shotId}`, relativePath: vid })
    const vo = (entry?.voice ?? shotObj?.media?.voice ?? '').trim()
    if (vo) {
      const spokenText = (shotObj?.dialogue ?? [])
        .map((item) => item.line?.trim() || '')
        .filter(Boolean)
        .join(' ')
      voices.push({
        id: `film:${shotId}`,
        relativePath: vo,
        ...(spokenText ? { text: spokenText } : {})
      })
    }
  }
  const composedVideoPath =
    doc?.publishPack?.composedVideoPath?.trim() || node.params.filmComposedVideoPath?.trim() || ''
  if (composedVideoPath && !videos.some((v) => v.relativePath === composedVideoPath)) {
    videos.unshift({
      id: `film:${node.id}:episode`,
      relativePath: composedVideoPath
    })
  }
  return {
    ...(doc
      ? {
          out: filmStoryboardValue(doc),
          'out-text': { kind: 'text', text: filmStoryboardToMarkdown(doc, ctx.locale) }
        }
      : {}),
    ...(cast
      ? {
          'out-cast': filmCastValue(cast),
          'out-sheets': { kind: 'images', items: castImageItems(cast) }
        }
      : {}),
    'out-images': { kind: 'images', items: images },
    'out-videos': { kind: 'videos', items: videos },
    'out-voices': { kind: 'voices', items: voices }
  }
}

export async function executeFilmWorkbenchNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const onlyCastId = node.params.filmCastOnlyId?.trim() || ''
  const onlyShotId = node.params.filmRenderOnlyShotId?.trim() || ''
  const rawMode = node.params.filmWorkbenchRunMode?.trim() || ''
  if (rawMode) patch(ctx, { filmWorkbenchRunMode: '' })

  const runTarget: 'all' | 'breakdown' | 'review' | 'cast' | 'render' | 'publish' = onlyCastId
    ? 'cast'
    : onlyShotId
      ? 'render'
      : rawMode === 'breakdown' ||
          rawMode === 'review' ||
          rawMode === 'cast' ||
          rawMode === 'render' ||
          rawMode === 'publish'
        ? rawMode
        : 'all'

  // 1) 分镜拆解（或者单跑后续阶段但尚无分镜时自动补拆解）
  let storyboard = parseFilmStoryboard(node.params.filmStoryboard ?? '')
  if (runTarget === 'breakdown' || runTarget === 'all' || !storyboard) {
    await executeFilmBreakdownNode(ctx)
    storyboard = parseFilmStoryboard(node.params.filmStoryboard ?? '')
  }

  if (runTarget === 'publish' && storyboard) {
    const upstreamCast = mergeFilmCasts(
      resolveUpstreamOrSharedCast(ctx),
      parseFilmCast(node.params.filmCast ?? '')
    )
    const resolvedGenre = resolveManjuGenre(
      node.params.filmGenre || storyboard.genreId,
      `${storyboard.title} ${storyboard.logline} ${storyboard.style}`
    )
    const cache = parseFilmRenderCache(node.params.filmRenders)
    const composedResult = await composeWorkbenchEpisodeVideo(ctx, storyboard, cache)
    const basePack = deriveManjuPublishPack(storyboard, ctx.locale)
    const composedVideoPath =
      composedResult.composedVideoPath ||
      storyboard.publishPack?.composedVideoPath ||
      node.params.filmComposedVideoPath?.trim() ||
      undefined
    const updated: FilmStoryboard = {
      ...storyboard,
      continuityAudit: runManjuContinuityAudit(storyboard, upstreamCast, resolvedGenre),
      publishPack: {
        ...basePack,
        ...(composedVideoPath ? { composedVideoPath } : {}),
        ...(composedResult.composedShotCount > 0
          ? { composedShotCount: composedResult.composedShotCount }
          : {}),
        ...(composedResult.composedVoiceCount > 0
          ? { composedVoiceCount: composedResult.composedVoiceCount }
          : {})
      }
    }
    patch(ctx, {
      filmStoryboard: stringifyFilmStoryboard(updated),
      ...(composedVideoPath ? { filmComposedVideoPath: composedVideoPath } : {}),
      text: filmStoryboardSummary(updated, ctx.locale)
    })
    return collectWorkbenchOutputs(ctx)
  }

  // 2) 导演审核（显式单跑审核，或全流程开启了审核且当前未 PASS / 强制重跑）
  const maxReviewRounds = Math.min(
    5,
    Math.max(0, Math.round(Number(node.params.filmReviewMaxRounds ?? 2)))
  )
  const shouldReview =
    runTarget === 'review' ||
    (runTarget === 'all' &&
      maxReviewRounds > 0 &&
      !!ctx.generateText &&
      !!storyboard &&
      (node.params.filmForce === true || storyboard.review?.verdict !== 'PASS'))
  if (shouldReview && storyboard) {
    await executeFilmReviewNode({
      ...ctx,
      inputs: {
        ...ctx.inputs,
        in: [filmStoryboardValue(storyboard)],
        'in-script': ctx.inputs['in-script'] ?? ctx.inputs.in ?? []
      }
    })
    storyboard = parseFilmStoryboard(node.params.filmStoryboard ?? '') ?? storyboard
  }

  // 3) 角色场景设定
  if ((runTarget === 'cast' || runTarget === 'all') && storyboard) {
    await executeFilmCastNode({
      ...ctx,
      inputs: {
        ...ctx.inputs,
        in: [filmStoryboardValue(storyboard)]
      }
    })
  }

  // 4) 批量拍摄
  if (
    (runTarget === 'render' ||
      (runTarget === 'all' && (!!ctx.generateImage || !!ctx.generateVideo))) &&
    storyboard
  ) {
    const cast = mergeFilmCasts(
      resolveUpstreamOrSharedCast(ctx),
      parseFilmCast(node.params.filmCast ?? '')
    )
    await executeFilmRenderNode({
      ...ctx,
      inputs: {
        ...ctx.inputs,
        in: [filmStoryboardValue(storyboard)],
        'in-cast': cast ? [filmCastValue(cast)] : (ctx.inputs['in-cast'] ?? [])
      }
    })
  }

  // 5) 刷新 11 项一致性审计与 Stage 5 发布包（包含刚生成的设定图资产、最新分镜状态与单集完整成片合成）
  const latestStoryboard = parseFilmStoryboard(node.params.filmStoryboard ?? '') ?? storyboard
  if (latestStoryboard && (runTarget === 'all' || runTarget === 'cast' || runTarget === 'render')) {
    const mergedCast = mergeFilmCasts(
      resolveUpstreamOrSharedCast(ctx),
      parseFilmCast(node.params.filmCast ?? '')
    )
    const resolvedGenre = resolveManjuGenre(
      node.params.filmGenre || latestStoryboard.genreId,
      `${latestStoryboard.title} ${latestStoryboard.logline} ${latestStoryboard.style}`
    )
    const cache = parseFilmRenderCache(node.params.filmRenders)
    const shouldAutoCompose =
      (runTarget === 'all' || (runTarget === 'render' && !onlyShotId)) &&
      Boolean(ctx.composeTimelineVideo)
    const composedResult = shouldAutoCompose
      ? await composeWorkbenchEpisodeVideo(ctx, latestStoryboard, cache)
      : { composedShotCount: 0, composedVoiceCount: 0 }
    const basePack =
      latestStoryboard.publishPack ?? deriveManjuPublishPack(latestStoryboard, ctx.locale)
    const composedVideoPath =
      composedResult.composedVideoPath ||
      latestStoryboard.publishPack?.composedVideoPath ||
      node.params.filmComposedVideoPath?.trim() ||
      undefined
    const finalized: FilmStoryboard = {
      ...latestStoryboard,
      continuityAudit: runManjuContinuityAudit(latestStoryboard, mergedCast, resolvedGenre),
      publishPack: {
        ...basePack,
        ...(composedVideoPath ? { composedVideoPath } : {}),
        ...(composedResult.composedShotCount > 0
          ? { composedShotCount: composedResult.composedShotCount }
          : {}),
        ...(composedResult.composedVoiceCount > 0
          ? { composedVoiceCount: composedResult.composedVoiceCount }
          : {})
      }
    }
    patch(ctx, {
      filmStoryboard: stringifyFilmStoryboard(finalized),
      ...(composedVideoPath ? { filmComposedVideoPath: composedVideoPath } : {}),
      text: filmStoryboardSummary(finalized, ctx.locale)
    })
  }

  return collectWorkbenchOutputs(ctx)
}
