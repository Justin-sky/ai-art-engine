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
  GraphValue,
  GraphVideoItem,
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
import {
  applyFilmReview,
  composeFilmShotImagePrompt,
  composeFilmShotVideoPrompt,
  deriveFilmCast,
  filmCastEntryImage,
  filmCastSummary,
  filmHash,
  filmNameKey,
  filmStoryboardSummary,
  filmStoryboardToMarkdown,
  findPrevSameSceneShot,
  isFilmShotLocked,
  matchFilmCastForShot,
  mergeFilmStoryboards,
  parseFilmCast,
  parseFilmCastKinds,
  parseFilmReview,
  parseFilmRevisedShots,
  parseFilmShotRange,
  parseFilmStoryboard,
  replaceFilmShots,
  selectFilmShot,
  stringifyFilmCast,
  stringifyFilmStoryboard,
  type FilmCast,
  type FilmCastEntry,
  type FilmShot,
  type FilmStoryboard
} from '../film/storyboard'
import {
  FILM_BREAKDOWN_SYSTEM,
  FILM_CAST_IMAGE,
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

function castFromInputs(values: GraphValue[] | undefined): FilmCast | null {
  for (const value of values ?? []) {
    if (value.kind === 'filmCast' && value.doc) return value.doc
  }
  for (const value of values ?? []) {
    if (value.kind === 'text') {
      const cast = parseFilmCast(value.text)
      if (cast) return cast
    }
  }
  return null
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
  const style = node.params.filmStyle?.trim()
  if (style) directives.push(en ? `Visual style: ${style}.` : `视觉风格：${style}。`)
  const extra = (
    node.params.filmBreakdownInstruction ??
    (node.typeId !== 'film.workbench' ? node.params.generateInstruction : '')
  )?.trim()
  if (extra) directives.push(extra)
  const system =
    node.params.generateSystemPrompt?.trim() || pickFilmPrompt(FILM_BREAKDOWN_SYSTEM, ctx.locale)
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
  const next: FilmStoryboard = {
    ...value,
    shots: normalizedShots,
    style: style || value.style,
    aspectRatio: aspect || value.aspectRatio
  }
  const merged = mergeFilmStoryboards(previous, next)
  patch(ctx, {
    filmStoryboard: stringifyFilmStoryboard(merged),
    filmSourceHash: sourceHash,
    text: filmStoryboardSummary(merged, ctx.locale)
  })
  ctx.log?.(filmStoryboardSummary(merged, ctx.locale))
  return storyboardOutputs(ctx, merged)
}

// ─── film.review 导演审核（自动修订闭环） ───────────────────────────────

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
    const prompt = [
      criteria ? (en ? `Extra criteria: ${criteria}` : `额外审核标准：${criteria}`) : '',
      script ? `${en ? 'Original script' : '原剧本'}:\n${script}` : '',
      `${en ? 'Storyboard' : '分镜文档'}:\n${stringifyFilmStoryboard({ ...doc, review: undefined })}`
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
  const previous = parseFilmCast(node.params.filmCast ?? '')
  if (!storyboard && !previous?.entries.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  const kinds = parseFilmCastKinds(node.params.filmCastKinds)
  const cast = storyboard ? deriveFilmCast(storyboard, previous, kinds) : previous!
  if (!storyboard && !onlyId && previous?.entries.length) {
    return {
      out: filmCastValue(previous),
      'out-sheets': { kind: 'images', items: castImageItems(previous) }
    }
  }
  const { byKey, style } = splitUserRefs(ctx.inputs['in-image'], cast.entries)
  const styleUrls = await resolveRefUrls(ctx, style.slice(0, 2))
  const force = node.params.filmForce === true
  const extra = (
    node.params.filmCastInstruction ??
    (node.typeId !== 'film.workbench' ? node.params.generateInstruction : '')
  )?.trim()
  const aspect = node.params.generateAspectRatio?.trim() || undefined
  let generated = 0

  for (const entry of cast.entries) {
    checkAbort(ctx)
    if (onlyId) {
      const isTarget = entry.id === onlyId || filmNameKey(entry.name) === filmNameKey(onlyId)
      if (!isTarget) continue
    } else if (entry.locked) {
      continue
    }
    const forceEntry = force || !!onlyId
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
      continue
    }
    const prompt = [
      cast.style ? (isEn(ctx) ? `Visual style: ${cast.style}` : `视觉风格：${cast.style}`) : '',
      pickFilmPrompt(FILM_CAST_IMAGE[entry.kind], ctx.locale),
      `${entry.name}${entry.description ? `: ${entry.description}` : ''}`,
      extra ?? ''
    ]
      .filter(Boolean)
      .join('\n')
    const imageSeed =
      node.params.generateSeedUseGlobal === false ? node.params.generateSeed : undefined
    const hash = filmHash(
      `${prompt}|${node.params.generateModel ?? ''}|${aspect ?? ''}|${node.params.generateResolution ?? ''}|${node.params.generateQuality ?? ''}|${imageSeed ?? ''}`
    )
    if (!forceEntry && filmCastEntryImage(entry) && entry.promptHash === hash) continue
    if (!ctx.generateImage) continue
    ctx.log?.(pickLogBi(ctx, `设定图：${entry.name}`, `Design sheet: ${entry.name}`))
    const result = await ctx.generateImage({
      prompt,
      model: node.params.generateModel || undefined,
      providerInstanceId: node.params.generateProviderInstanceId || undefined,
      aspectRatio: aspect ?? (entry.kind === 'location' ? '16:9' : '4:3'),
      resolution: node.params.generateResolution || undefined,
      quality: node.params.generateQuality || undefined,
      ...(imageSeed != null ? { seed: imageSeed } : {}),
      n: 1,
      inputReferences: styleUrls.length ? styleUrls : undefined
    })
    checkAbort(ctx)
    const dataUrl = result.images?.[0]?.trim()
    if (!dataUrl) continue
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
  const cast = castFromInputs(ctx.inputs['in-cast'])
  const refs = matchFilmCastForShot(cast, shot)
  const prevShot = findPrevSameSceneShot(storyboard, shot)
  const prevKeyframe = prevShot?.media?.keyframe?.trim() || ''
  const imagePrompt = composeFilmShotImagePrompt(storyboard, shot, refs, ctx.locale, {
    prevShot,
    prevKeyframeRefIndex: prevKeyframe ? refs.length + 1 : undefined
  })
  const videoPrompt = composeFilmShotVideoPrompt(shot, ctx.locale, { prevShot })
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
  const cast = castFromInputs(ctx.inputs['in-cast']) || parseFilmCast(node.params.filmCast ?? '')
  const cache = parseFilmRenderCache(node.params.filmRenders)
  const mode = node.params.filmRenderMode === 'video' ? 'video' : 'keyframe'
  const forceAll = node.params.filmForce === true
  const continuityOn = node.params.filmRenderContinuity !== false
  const qcOn = node.params.filmRenderQc === true && !!ctx.generateText
  const maxRetries = Math.min(
    3,
    Math.max(0, Math.round(Number(node.params.filmRenderMaxRetries ?? 1)))
  )
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

  let videoCaps: VideoGenerateParamCapabilities | null = null
  if (mode === 'video' && ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.filmVideoModel || undefined,
        providerInstanceId: node.params.filmVideoProviderInstanceId || undefined
      })
      if (bundle) videoCaps = bundle.params
    } catch {
      /* 能力查询失败时沿用镜头参数，遇时长 400 自动按返回档位重试 */
    }
  }

  const shots = input.shots.map((shot) => ({ ...shot }))
  let rendered = 0
  let reused = 0
  const failures: string[] = []
  const persist = (): void => patch(ctx, { filmRenders: JSON.stringify(cache) })

  for (const [step, index] of indexes.entries()) {
    checkAbort(ctx)
    const shot = shots[index]
    const entry: FilmRenderEntry = { ...(cache[shot.id] ?? {}) }
    delete entry.error
    const refs = matchFilmCastForShot(cast, shot)
    const prevShot = continuityOn ? findPrevSameSceneShot(input, shot) : null
    const prevKeyframe = prevShot
      ? (cache[prevShot.id]?.keyframe || prevShot.media?.keyframe || '').trim()
      : ''
    const extra = node.params.generateInstruction?.trim()
    const composed = composeFilmShotImagePrompt(
      input,
      shot,
      refs,
      ctx.locale,
      prevShot
        ? {
            prevShot,
            prevKeyframeRefIndex: prevKeyframe ? refs.length + 1 : undefined
          }
        : undefined
    )
    const basePrompt = extra ? `${composed}\n${extra}` : composed
    const imageSeed =
      node.params.generateSeedUseGlobal === false ? node.params.generateSeed : undefined
    const keyHash = filmHash(
      `${basePrompt}|${refs.map(filmCastEntryImage).join(',')}|${prevKeyframe}|${node.params.generateModel ?? ''}|${aspect ?? ''}|${node.params.generateResolution ?? ''}|${node.params.generateQuality ?? ''}|${imageSeed ?? ''}`
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
          ...(prevKeyframe ? [mediaRefItem(prevKeyframe)] : [])
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
                (await ctx.normalizeImageAspectRatio({ dataUrl, aspectRatio: aspect })) || dataUrl
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

      // ③ 图生视频（首帧 = 关键帧）
      const keyframe = entry.keyframe
      if (mode === 'video' && generateVideo && keyframe) {
        const videoPrompt = composeFilmShotVideoPrompt(
          shot,
          ctx.locale,
          prevShot ? { prevShot } : undefined
        )
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
          `${keyframe}|${videoPrompt}|${node.params.filmVideoModel ?? ''}|${targetVideoDuration}|${rawVideoResolution ?? ''}|${rawVideoAspect ?? ''}|${rawVideoAudio ?? ''}|${videoSeed ?? ''}`
        )
        if (forceVideo || !entry.video || entry.videoHash !== videoHash) {
          ctx.log?.(pickLogBi(ctx, `${progress} 生成视频`, `${progress} video`))
          const [firstFrame] = await resolveRefUrls(ctx, [mediaRefItem(keyframe)])
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
            firstFrame && !useFirstFrame
              ? [{ kind: 'image_url' as const, url: firstFrame }]
              : undefined
          const baseVideoInput = {
            prompt: videoPrompt,
            model: node.params.filmVideoModel || undefined,
            providerInstanceId: node.params.filmVideoProviderInstanceId || undefined,
            aspectRatio: requestAspect,
            resolution: requestResolution,
            ...(typeof requestAudio === 'boolean' ? { generateAudio: requestAudio } : {}),
            ...(videoSeed != null ? { seed: videoSeed } : {}),
            ...(useFirstFrame ? { firstFrameImageUrl: useFirstFrame } : {}),
            ...(fallbackRefs ? { inputReferences: fallbackRefs } : {}),
            outputDir: node.params.mediaOutputDir?.trim() || undefined,
            name: `${ctx.resolveHostAssetName?.() || input.title || 'film'}_${shot.id}`,
            graphBinding: {
              hostId: ctx.resolveHostAssetId?.(),
              nodeId: node.id,
              shotId: shot.id
            }
          }
          let video: Awaited<ReturnType<typeof generateVideo>>
          try {
            video = await generateVideo({
              ...baseVideoInput,
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
            video = await generateVideo({
              ...baseVideoInput,
              duration: retryDuration
            })
          }
          checkAbort(ctx)
          entry.video = video.relativePath
          entry.videoHash = videoHash
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      const message = err instanceof Error ? err.message : String(err)
      entry.error = message
      failures.push(`${shot.id}: ${message}`)
      ctx.log?.(`${progress} ${message}`, 'error')
    }
    cache[shot.id] = entry
    persist()
  }

  // 产物回写进分镜文档（下游 / agent 读一份文档即可拿到每镜关键帧与视频）
  for (const shot of shots) {
    const entry = cache[shot.id]
    if (!entry?.keyframe && !entry?.video) continue
    shot.media = {
      ...(entry.keyframe ? { keyframe: entry.keyframe } : {}),
      ...(entry.video ? { video: entry.video } : {})
    }
  }
  const doc: FilmStoryboard = { ...input, shots }
  const images: GraphImageItem[] = []
  const videos: GraphVideoItem[] = []
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
    'out-videos': { kind: 'videos', items: videos }
  }
}

// ─── film.workbench 影视工作台（四阶段合一节点） ─────────────────────────

function collectWorkbenchOutputs(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const { node } = ctx
  const doc = parseFilmStoryboard(node.params.filmStoryboard ?? '')
  const cast = parseFilmCast(node.params.filmCast ?? '')
  const cache = parseFilmRenderCache(node.params.filmRenders)
  const shotIds = doc?.shots.map((shot) => shot.id) ?? Object.keys(cache)
  const images: GraphImageItem[] = []
  const videos: GraphVideoItem[] = []
  for (const shotId of shotIds) {
    const entry = cache[shotId]
    const kf = entry?.keyframe?.trim() ?? ''
    if (kf) {
      const inline = kf.startsWith('data:')
      images.push({
        id: `film:${shotId}`,
        title: shotId,
        dataUrl: inline ? kf : '',
        ...(inline ? {} : { relativePath: kf })
      })
    }
    const vid = entry?.video?.trim() ?? ''
    if (vid) videos.push({ id: `film:${shotId}`, relativePath: vid })
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
    'out-videos': { kind: 'videos', items: videos }
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

  const runTarget: 'all' | 'breakdown' | 'review' | 'cast' | 'render' = onlyCastId
    ? 'cast'
    : onlyShotId
      ? 'render'
      : rawMode === 'breakdown' ||
          rawMode === 'review' ||
          rawMode === 'cast' ||
          rawMode === 'render'
        ? rawMode
        : 'all'

  // 1) 分镜拆解（或者单跑后续阶段但尚无分镜时自动补拆解）
  let storyboard = parseFilmStoryboard(node.params.filmStoryboard ?? '')
  if (runTarget === 'breakdown' || runTarget === 'all' || !storyboard) {
    await executeFilmBreakdownNode(ctx)
    storyboard = parseFilmStoryboard(node.params.filmStoryboard ?? '')
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
    const cast = parseFilmCast(node.params.filmCast ?? '')
    await executeFilmRenderNode({
      ...ctx,
      inputs: {
        ...ctx.inputs,
        in: [filmStoryboardValue(storyboard)],
        'in-cast': cast ? [filmCastValue(cast)] : (ctx.inputs['in-cast'] ?? [])
      }
    })
  }

  return collectWorkbenchOutputs(ctx)
}
