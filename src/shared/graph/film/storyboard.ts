/**
 * 影视流水线数据模型（单一来源）。
 *
 * 旧体系的问题是三套互不兼容的中间格式（剧集 Markdown 表格 / 场 JSON / 世界元素目录）
 * 各自靠正则切文本，结构一变就静默退回全文。这里统一成两份结构化文档：
 *
 * - `FilmStoryboard`（schema `aiart.film-storyboard@1`）：场 → 镜头（任意数量）+ 实体名单 + 审核结论 + 每镜产物
 * - `FilmCast`（schema `aiart.film-cast@1`）：角色 / 场景 / 道具设定图（按名字与镜头出场名单对位）
 *
 * 所有解析都是**宽容读、严格写**：模型输出的中文键、代码围栏、缺字段都能读，
 * 写回一律规范英文键 + 稳定 id，便于 agent 直接读写（graph_edit 改 params.filmStoryboard 即可）。
 */
import { stripJsonCodeFence } from '../jsonFence'

export const FILM_STORYBOARD_SCHEMA = 'aiart.film-storyboard@1'
export const FILM_CAST_SCHEMA = 'aiart.film-cast@1'

export type FilmEntityKind = 'character' | 'location' | 'prop'
export const FILM_ENTITY_KINDS: readonly FilmEntityKind[] = ['character', 'location', 'prop']

export interface FilmEntity {
  id: string
  kind: FilmEntityKind
  /** 全片唯一称呼；镜头里的 characters / location / props 必须引用这个名字 */
  name: string
  /** 视觉设定（外貌 / 服装 / 材质 / 空间结构）：只在设定库生成设定图时使用 */
  description: string
}

export interface FilmScene {
  id: string
  order: number
  /** 场景标题（INT./EXT. 地点 - 时间） */
  heading: string
  /** 地点实体名 */
  location: string
  time: string
  summary: string
}

export interface FilmDialogueLine {
  speaker: string
  line: string
  /** 语气 / 表演提示 */
  tone?: string
}

/** draft = AI 产出待定；approved = 人工确认（AI 不再改写）；revise = 审核要求返工 */
export type FilmShotStatus = 'draft' | 'approved' | 'revise'

export interface FilmShotReview {
  verdict: 'pass' | 'fail'
  notes: string
}

export interface FilmShotMedia {
  keyframe?: string
  video?: string
}

export interface FilmShot {
  id: string
  order: number
  sceneId: string
  title: string
  /** 景别：ELS / LS / MLS / MS / MCU / CU / ECU / INSERT */
  shotSize: string
  /** 机位角度：平视 / 俯拍 / 仰拍 / 过肩 / 主观 … */
  angle: string
  /** 运镜：固定 / 推 / 拉 / 摇 / 移 / 跟 / 升降 / 手持 */
  cameraMove: string
  durationSec: number
  characters: string[]
  location: string
  props: string[]
  /** 画面动作（可见、可拍） */
  action: string
  dialogue: FilmDialogueLine[]
  /** 环境声 / 音效 */
  sound: string
  /** 与下一镜的转场 */
  transition: string
  /** 关键帧（首帧）生图提示词：只写可见内容，外观靠设定图锁定 */
  imagePrompt: string
  /** 图生视频提示词：时间轴动作 + 运镜 + 对白 */
  videoPrompt: string
  status: FilmShotStatus
  /** 人工锁定：AI 拆解 / 审核修订都不会改写该镜（approved 视同锁定） */
  locked?: boolean
  review?: FilmShotReview
  media?: FilmShotMedia
}

export interface FilmStoryboardReview {
  verdict: 'PASS' | 'FAIL'
  /** 0~100 */
  score: number
  rounds: number
  notes: string[]
  at: string
}

export interface FilmStoryboard {
  schema: typeof FILM_STORYBOARD_SCHEMA
  title: string
  logline: string
  style: string
  aspectRatio: string
  entities: FilmEntity[]
  scenes: FilmScene[]
  shots: FilmShot[]
  review?: FilmStoryboardReview
}

export interface FilmCastEntry {
  id: string
  kind: FilmEntityKind
  name: string
  description: string
  /** 设定图（工程相对路径） */
  imageRelativePath?: string
  /** 设定图（外链 / data URL，人工指定时） */
  imageUrl?: string
  /** 生成设定图时的提示词指纹：描述没变就不重画 */
  promptHash?: string
  /** 人工锁定：不再重画 */
  locked?: boolean
}

export interface FilmCast {
  schema: typeof FILM_CAST_SCHEMA
  style: string
  entries: FilmCastEntry[]
}

// ─── 小工具 ─────────────────────────────────────────────────────────────

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'object' && item ? str((item as Record<string, unknown>).name) : str(item)
      )
      .filter(Boolean)
  }
  const raw = str(value)
  if (!raw) return []
  return raw
    .split(/[,，;；、/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return Number.isFinite(n) ? n : fallback
}

/** FNV-1a 32 位指纹（缓存键；不做安全用途） */
export function filmHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 名字匹配键：去空白、小写、去括注 */
export function filmNameKey(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function parseJsonLoose(raw: string): unknown {
  const text = stripJsonCodeFence(raw)
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        /* fallthrough */
      }
    }
    const aStart = text.indexOf('[')
    const aEnd = text.lastIndexOf(']')
    if (aStart >= 0 && aEnd > aStart) {
      try {
        return JSON.parse(text.slice(aStart, aEnd + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function normalizeEntityKind(value: unknown): FilmEntityKind | null {
  const raw = str(value).toLowerCase()
  if (!raw) return null
  if (['character', 'characters', 'role', '角色', '人物'].includes(raw)) return 'character'
  if (['location', 'locations', 'scene', 'set', '场景', '地点'].includes(raw)) return 'location'
  if (['prop', 'props', 'weapon', 'item', '道具', '武器', '物品'].includes(raw)) return 'prop'
  return null
}

function normalizeStatus(value: unknown): FilmShotStatus {
  const raw = str(value).toLowerCase()
  if (raw === 'approved' || raw === '已确认' || raw === '已审核') return 'approved'
  if (raw === 'revise' || raw === '返工' || raw === 'fail') return 'revise'
  return 'draft'
}

function shotCode(sceneOrder: number, shotIndexInScene: number): string {
  return `S${String(sceneOrder).padStart(2, '0')}-${String(shotIndexInScene).padStart(2, '0')}`
}

// ─── 解析 / 规范化 ──────────────────────────────────────────────────────

function normalizeEntities(raw: unknown): FilmEntity[] {
  const out: FilmEntity[] = []
  const seen = new Set<string>()
  const push = (item: unknown, fallbackKind?: FilmEntityKind): void => {
    if (!item) return
    const row: Record<string, unknown> =
      typeof item === 'string' ? { name: item } : (item as Record<string, unknown>)
    const name = str(pick(row, 'name', '名称', '名字'))
    const kind = normalizeEntityKind(pick(row, 'kind', 'type', '类型')) ?? fallbackKind
    if (!name || !kind) return
    const key = `${kind}:${filmNameKey(name)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: str(row.id) || `${kind}-${filmHash(filmNameKey(name))}`,
      kind,
      name,
      description: str(
        pick(row, 'description', 'desc', 'appearance', 'prompt', '描述', '外观', '设定')
      )
    })
  }
  if (Array.isArray(raw)) {
    for (const item of raw) push(item)
  } else if (raw && typeof raw === 'object') {
    // 兼容 { characters: [...], locations: [...], props: [...] } 分组写法
    const grouped = raw as Record<string, unknown>
    const groups: Array<[FilmEntityKind, string[]]> = [
      ['character', ['characters', '角色', '人物']],
      ['location', ['locations', 'scenes', '场景', '地点']],
      ['prop', ['props', 'weapons', '道具', '武器']]
    ]
    for (const [kind, keys] of groups) {
      for (const key of keys) {
        const list = grouped[key]
        if (Array.isArray(list)) for (const item of list) push(item, kind)
      }
    }
  }
  return out
}

function normalizeDialogue(raw: unknown): FilmDialogueLine[] {
  if (!raw) return []
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^([^:：]{1,24})[:：]\s*(.+)$/)
        return m ? { speaker: m[1].trim(), line: m[2].trim() } : { speaker: '', line }
      })
  }
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): FilmDialogueLine | null => {
      if (typeof item === 'string') return normalizeDialogue(item)[0] ?? null
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const line = str(pick(row, 'line', 'text', 'content', '台词', '对白'))
      if (!line) return null
      const tone = str(pick(row, 'tone', 'emotion', '语气'))
      return {
        speaker: str(pick(row, 'speaker', 'character', 'name', '说话人', '角色')),
        line,
        ...(tone ? { tone } : {})
      }
    })
    .filter((item): item is FilmDialogueLine => !!item)
}

function normalizeScenes(raw: unknown): FilmScene[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item, index): FilmScene | null => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const order = Math.max(1, Math.round(num(pick(row, 'order', '顺序'), index + 1)))
      return {
        id: str(row.id) || `scene-${order}`,
        order,
        heading: str(pick(row, 'heading', 'title', '标题', '场景标题')),
        location: str(pick(row, 'location', '地点', '场景')),
        time: str(pick(row, 'time', '时间')),
        summary: str(pick(row, 'summary', 'description', '概要', '剧情'))
      }
    })
    .filter((item): item is FilmScene => !!item)
    .sort((a, b) => a.order - b.order)
}

function normalizeShot(item: unknown, index: number): FilmShot | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const media =
    row.media && typeof row.media === 'object' ? (row.media as Record<string, unknown>) : null
  const review =
    row.review && typeof row.review === 'object' ? (row.review as Record<string, unknown>) : null
  const verdict = str(review?.verdict).toLowerCase()
  const locked = row.locked === true
  const shot: FilmShot = {
    id: str(row.id),
    order: Math.max(1, Math.round(num(pick(row, 'order', '序号'), index + 1))),
    sceneId: str(pick(row, 'sceneId', 'scene', '场次')),
    title: str(pick(row, 'title', '标题', '镜头名')),
    shotSize: str(pick(row, 'shotSize', 'size', '景别')),
    angle: str(pick(row, 'angle', '角度', '机位')),
    cameraMove: str(pick(row, 'cameraMove', 'camera', 'movement', '运镜')),
    durationSec: Math.min(30, Math.max(1, num(pick(row, 'durationSec', 'duration', '时长'), 4))),
    characters: strList(pick(row, 'characters', '角色', '人物')),
    location: str(pick(row, 'location', '地点', '场景')),
    props: strList(pick(row, 'props', '道具')),
    action: str(pick(row, 'action', '动作', '画面')),
    dialogue: normalizeDialogue(pick(row, 'dialogue', 'lines', '对白', '台词')),
    sound: str(pick(row, 'sound', 'sfx', '音效', '声音')),
    transition: str(pick(row, 'transition', '转场')),
    imagePrompt: str(pick(row, 'imagePrompt', 'keyframePrompt', '画面提示词', '首帧提示词')),
    videoPrompt: str(pick(row, 'videoPrompt', 'motionPrompt', '视频提示词', '动态提示词')),
    status: normalizeStatus(row.status),
    ...(locked ? { locked } : {}),
    ...(review && (verdict === 'pass' || verdict === 'fail')
      ? { review: { verdict, notes: str(review.notes) } }
      : {}),
    ...(media && (str(media.keyframe) || str(media.video))
      ? {
          media: {
            ...(str(media.keyframe) ? { keyframe: str(media.keyframe) } : {}),
            ...(str(media.video) ? { video: str(media.video) } : {})
          }
        }
      : {})
  }
  if (!shot.action && !shot.imagePrompt && !shot.videoPrompt && !shot.dialogue.length) return null
  return shot
}

/**
 * 补齐派生字段：缺场景时按地点自动归场；缺 id 时按「场序-镜序」编号（S01-03）；
 * 镜头引用但实体表里没有的名字自动补进实体表（描述留空，设定库会提示补全）。
 */
export function finalizeFilmStoryboard(doc: FilmStoryboard): FilmStoryboard {
  const shots = doc.shots.map((shot) => ({ ...shot })).sort((a, b) => a.order - b.order)
  let scenes = [...doc.scenes]
  if (!scenes.length) {
    // 没有场信息：按连续地点切场
    let current: FilmScene | null = null
    for (const shot of shots) {
      const loc = shot.location || current?.location || ''
      if (
        !current ||
        (shot.location && filmNameKey(shot.location) !== filmNameKey(current.location))
      ) {
        current = {
          id: `scene-${scenes.length + 1}`,
          order: scenes.length + 1,
          heading: loc,
          location: loc,
          time: '',
          summary: ''
        }
        scenes.push(current)
      }
      shot.sceneId = current.id
    }
  }
  scenes = scenes.map((scene, index) => ({ ...scene, order: index + 1 }))
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))
  const sceneByAlias = new Map<string, FilmScene>()
  for (const scene of scenes) {
    sceneByAlias.set(String(scene.order), scene)
    if (scene.heading) sceneByAlias.set(filmNameKey(scene.heading), scene)
  }
  const fallbackScene = scenes[0]
  const perScene = new Map<string, number>()
  const usedIds = new Set<string>()
  const normalizedShots = shots.map((shot, index) => {
    const scene =
      sceneById.get(shot.sceneId) ??
      sceneByAlias.get(shot.sceneId.replace(/^\D+/, '')) ??
      sceneByAlias.get(filmNameKey(shot.sceneId)) ??
      fallbackScene
    const sceneId = scene?.id ?? ''
    const n = (perScene.get(sceneId) ?? 0) + 1
    perScene.set(sceneId, n)
    let id = shot.id || shotCode(scene?.order ?? 1, n)
    while (usedIds.has(id)) id = `${id}b`
    usedIds.add(id)
    return {
      ...shot,
      id,
      order: index + 1,
      sceneId,
      location: shot.location || scene?.location || ''
    }
  })

  const entities = [...doc.entities]
  const known = new Set(entities.map((e) => `${e.kind}:${filmNameKey(e.name)}`))
  const ensure = (kind: FilmEntityKind, name: string): void => {
    if (!name) return
    const key = `${kind}:${filmNameKey(name)}`
    if (known.has(key)) return
    known.add(key)
    entities.push({ id: `${kind}-${filmHash(filmNameKey(name))}`, kind, name, description: '' })
  }
  for (const shot of normalizedShots) {
    for (const name of shot.characters) ensure('character', name)
    ensure('location', shot.location)
    for (const name of shot.props) ensure('prop', name)
  }

  return { ...doc, scenes, shots: normalizedShots, entities }
}

/** 解析分镜文档：接受完整对象、只有 shots 数组、或模型输出（带围栏 / 中文键）。失败返回 null。 */
export function parseFilmStoryboard(raw: unknown): FilmStoryboard | null {
  const parsed = typeof raw === 'string' ? (raw.trim() ? parseJsonLoose(raw) : null) : raw
  if (!parsed || typeof parsed !== 'object') return null
  const row: Record<string, unknown> = Array.isArray(parsed)
    ? { shots: parsed }
    : (parsed as Record<string, unknown>)
  const shotsRaw = pick(row, 'shots', '镜头', 'storyboard')
  if (!Array.isArray(shotsRaw)) return null
  const shots = shotsRaw
    .map((item, index) => normalizeShot(item, index))
    .filter((shot): shot is FilmShot => !!shot)
  if (!shots.length) return null
  const reviewRaw =
    row.review && typeof row.review === 'object' ? (row.review as Record<string, unknown>) : null
  const reviewVerdict = str(reviewRaw?.verdict).toUpperCase()
  const doc: FilmStoryboard = {
    schema: FILM_STORYBOARD_SCHEMA,
    title: str(pick(row, 'title', '片名', '剧名')),
    logline: str(pick(row, 'logline', 'summary', '一句话梗概', '梗概')),
    style: str(pick(row, 'style', '风格', '视觉风格')),
    aspectRatio: str(pick(row, 'aspectRatio', '画幅')),
    entities: normalizeEntities(pick(row, 'entities', 'cast', '实体')),
    scenes: normalizeScenes(pick(row, 'scenes', '场次')),
    shots,
    ...(reviewRaw && (reviewVerdict === 'PASS' || reviewVerdict === 'FAIL')
      ? {
          review: {
            verdict: reviewVerdict,
            score: num(reviewRaw.score, 0),
            rounds: Math.max(0, Math.round(num(reviewRaw.rounds, 0))),
            notes: strList(reviewRaw.notes),
            at: str(reviewRaw.at)
          }
        }
      : {})
  }
  return finalizeFilmStoryboard(doc)
}

export function stringifyFilmStoryboard(doc: FilmStoryboard): string {
  return JSON.stringify(doc, null, 2)
}

export function emptyFilmStoryboard(): FilmStoryboard {
  return {
    schema: FILM_STORYBOARD_SCHEMA,
    title: '',
    logline: '',
    style: '',
    aspectRatio: '',
    entities: [],
    scenes: [],
    shots: []
  }
}

export function isFilmShotLocked(shot: Pick<FilmShot, 'locked' | 'status'>): boolean {
  return shot.locked === true || shot.status === 'approved'
}

/**
 * 重新拆解时合并：锁定 / 已确认的镜头按 id 原样保留（位置跟随新顺序；新稿里没有的追加回原位附近），
 * 未锁定镜头若 id 相同且画面提示词未变，保留已有产物（避免白白重拍）。
 * 实体描述：新稿为空时沿用旧描述（人工补写的设定不被冲掉）。
 */
export function mergeFilmStoryboards(
  previous: FilmStoryboard | null | undefined,
  next: FilmStoryboard
): FilmStoryboard {
  if (!previous?.shots.length) return next
  const prevById = new Map(previous.shots.map((shot) => [shot.id, shot]))
  const used = new Set<string>()
  const shots: FilmShot[] = next.shots.map((shot) => {
    const prev = prevById.get(shot.id)
    if (!prev) return shot
    used.add(prev.id)
    if (isFilmShotLocked(prev)) return { ...prev }
    const samePrompt =
      prev.imagePrompt === shot.imagePrompt && prev.videoPrompt === shot.videoPrompt
    return samePrompt && prev.media ? { ...shot, media: prev.media } : shot
  })
  for (const prev of previous.shots) {
    if (used.has(prev.id) || !isFilmShotLocked(prev)) continue
    const at = shots.findIndex((shot) => shot.order > prev.order)
    if (at < 0) shots.push({ ...prev })
    else shots.splice(at, 0, { ...prev })
  }
  const prevEntities = new Map(
    previous.entities.map((e) => [`${e.kind}:${filmNameKey(e.name)}`, e])
  )
  const entities = next.entities.map((entity) => {
    const prev = prevEntities.get(`${entity.kind}:${filmNameKey(entity.name)}`)
    return prev && !entity.description && prev.description
      ? { ...entity, description: prev.description }
      : entity
  })
  return finalizeFilmStoryboard({
    ...next,
    entities,
    shots: shots.map((shot, index) => ({ ...shot, order: index + 1 }))
  })
}

// ─── 设定库 ─────────────────────────────────────────────────────────────

export function parseFilmCast(raw: unknown): FilmCast | null {
  const parsed = typeof raw === 'string' ? (raw.trim() ? parseJsonLoose(raw) : null) : raw
  if (!parsed || typeof parsed !== 'object') return null
  const row: Record<string, unknown> = Array.isArray(parsed)
    ? { entries: parsed }
    : (parsed as Record<string, unknown>)
  const list = pick(row, 'entries', 'cast', 'items')
  if (!Array.isArray(list)) return null
  const entries: FilmCastEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = str(pick(r, 'name', '名称'))
    const kind = normalizeEntityKind(pick(r, 'kind', 'type', '类型'))
    if (!name || !kind) continue
    const imageRelativePath = str(r.imageRelativePath)
    const imageUrl = str(r.imageUrl)
    const promptHash = str(r.promptHash)
    entries.push({
      id: str(r.id) || `${kind}-${filmHash(filmNameKey(name))}`,
      kind,
      name,
      description: str(pick(r, 'description', '描述')),
      ...(imageRelativePath ? { imageRelativePath } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(promptHash ? { promptHash } : {}),
      ...(r.locked === true ? { locked: true } : {})
    })
  }
  return { schema: FILM_CAST_SCHEMA, style: str(row.style), entries }
}

export function stringifyFilmCast(cast: FilmCast): string {
  return JSON.stringify(cast, null, 2)
}

export function parseFilmCastKinds(raw: string | undefined | null): FilmEntityKind[] {
  const kinds = strList(raw ?? '')
    .map((part) => normalizeEntityKind(part))
    .filter((kind): kind is FilmEntityKind => !!kind)
  return kinds.length ? [...new Set(kinds)] : ['character', 'location']
}

/**
 * 由分镜实体表派生设定库：同名同类条目沿用旧图（描述没变时），锁定条目原样保留；
 * 只收 `kinds` 指定的种类。
 */
export function deriveFilmCast(
  storyboard: FilmStoryboard,
  previous: FilmCast | null | undefined,
  kinds: readonly FilmEntityKind[]
): FilmCast {
  const prevByKey = new Map(
    (previous?.entries ?? []).map((entry) => [`${entry.kind}:${filmNameKey(entry.name)}`, entry])
  )
  const entries: FilmCastEntry[] = []
  for (const entity of storyboard.entities) {
    if (!kinds.includes(entity.kind)) continue
    const prev = prevByKey.get(`${entity.kind}:${filmNameKey(entity.name)}`)
    if (prev?.locked) {
      entries.push({ ...prev })
      continue
    }
    entries.push({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      description: entity.description || prev?.description || '',
      ...(prev?.imageRelativePath ? { imageRelativePath: prev.imageRelativePath } : {}),
      ...(prev?.imageUrl ? { imageUrl: prev.imageUrl } : {}),
      ...(prev?.promptHash ? { promptHash: prev.promptHash } : {})
    })
  }
  return { schema: FILM_CAST_SCHEMA, style: storyboard.style, entries }
}

export function filmCastEntryImage(entry: FilmCastEntry): string {
  return entry.imageRelativePath?.trim() || entry.imageUrl?.trim() || ''
}

/** 该镜出场的设定条目（角色在前、地点、道具），只返回有设定图的 */
export function matchFilmCastForShot(
  cast: FilmCast | null | undefined,
  shot: Pick<FilmShot, 'characters' | 'location' | 'props'>
): FilmCastEntry[] {
  if (!cast?.entries.length) return []
  const byKey = new Map(
    cast.entries.map((entry) => [`${entry.kind}:${filmNameKey(entry.name)}`, entry])
  )
  const out: FilmCastEntry[] = []
  const add = (kind: FilmEntityKind, name: string): void => {
    const entry = byKey.get(`${kind}:${filmNameKey(name)}`)
    if (entry && filmCastEntryImage(entry) && !out.includes(entry)) out.push(entry)
  }
  for (const name of shot.characters) add('character', name)
  if (shot.location) add('location', shot.location)
  for (const name of shot.props) add('prop', name)
  return out
}

// ─── 提示词合成 ─────────────────────────────────────────────────────────

function isEnglish(locale?: string): boolean {
  return (locale ?? '').toLowerCase().startsWith('en')
}

/**
 * 关键帧（首帧）生图提示词：风格 + 景别机位 + 地点 + 出场角色 + 画面 + 镜头自带 imagePrompt。
 * 参考图按出场顺序编号（@1 起），提示词里点名「角色 X 以参考图 @n 为准」锁一致性。
 */
export function composeFilmShotImagePrompt(
  storyboard: Pick<FilmStoryboard, 'style' | 'aspectRatio'>,
  shot: FilmShot,
  refs: readonly FilmCastEntry[] = [],
  locale?: string
): string {
  const en = isEnglish(locale)
  const lines: string[] = []
  if (storyboard.style)
    lines.push(en ? `Visual style: ${storyboard.style}` : `视觉风格：${storyboard.style}`)
  const camera = [shot.shotSize, shot.angle].filter(Boolean).join(' / ')
  if (camera) lines.push(en ? `Shot: ${camera}` : `镜头：${camera}`)
  if (shot.location) lines.push(en ? `Location: ${shot.location}` : `地点：${shot.location}`)
  if (shot.characters.length) {
    lines.push(
      en ? `Characters: ${shot.characters.join(', ')}` : `出场角色：${shot.characters.join('、')}`
    )
  }
  if (shot.props.length)
    lines.push(en ? `Props: ${shot.props.join(', ')}` : `道具：${shot.props.join('、')}`)
  if (shot.imagePrompt) lines.push(shot.imagePrompt)
  else if (shot.action) lines.push(shot.action)
  if (refs.length) {
    const mapping = refs
      .map((ref, index) =>
        en ? `${ref.name} = reference @${index + 1}` : `${ref.name}以参考图@${index + 1}为准`
      )
      .join(en ? '; ' : '；')
    lines.push(
      en
        ? `Consistency: ${mapping}. Keep identity, outfit, hairstyle and set design exactly as in the references.`
        : `一致性：${mapping}，人物长相、服装、发型与场景陈设严格保持一致。`
    )
  }
  lines.push(
    en
      ? 'Single cinematic frame, no text, no subtitles, no watermark, no split panels.'
      : '单幅电影画面，无文字、无字幕、无水印、不分格。'
  )
  return lines.join('\n')
}

/** 图生视频提示词：运镜 + 时长 + 动作时间轴 + 对白（逐字）+ 声音 */
export function composeFilmShotVideoPrompt(shot: FilmShot, locale?: string): string {
  const en = isEnglish(locale)
  const lines: string[] = []
  if (shot.videoPrompt) lines.push(shot.videoPrompt)
  else if (shot.action) lines.push(shot.action)
  if (shot.cameraMove)
    lines.push(en ? `Camera move: ${shot.cameraMove}` : `运镜：${shot.cameraMove}`)
  if (shot.dialogue.length) {
    const said = shot.dialogue
      .map((d) => {
        const who = d.speaker ? `${d.speaker}${d.tone ? `（${d.tone}）` : ''}` : ''
        return who ? `${who}：“${d.line}”` : `“${d.line}”`
      })
      .join(' ')
    lines.push(en ? `Dialogue (verbatim, lip-synced): ${said}` : `对白（逐字、口型同步）：${said}`)
  }
  if (shot.sound) lines.push(en ? `Sound: ${shot.sound}` : `声音：${shot.sound}`)
  lines.push(
    en
      ? `Duration about ${shot.durationSec}s. Keep the first frame's identity, outfit, set and key light. No subtitles, no background music.`
      : `时长约 ${shot.durationSec} 秒。保持首帧的人物身份、服装、场景与主光方向；无字幕、无背景音乐。`
  )
  return lines.join('\n')
}

// ─── 选择 / 范围 ────────────────────────────────────────────────────────

/** 按镜头 id 或 1 起序号取镜头；缺省第 1 镜 */
export function selectFilmShot(
  storyboard: FilmStoryboard | null | undefined,
  ref: string | number | undefined | null
): FilmShot | null {
  const shots = storyboard?.shots ?? []
  if (!shots.length) return null
  const raw = String(ref ?? '').trim()
  if (!raw) return shots[0]
  const byId = shots.find((shot) => shot.id.toLowerCase() === raw.toLowerCase())
  if (byId) return byId
  const n = parseInt(raw, 10)
  if (Number.isFinite(n) && String(n) === raw)
    return shots[Math.min(shots.length, Math.max(1, n)) - 1]
  return null
}

/** 解析镜头范围 `1-5,8,S02-01`；空 = 全部。返回 0 起下标（去重、按序）。 */
export function parseFilmShotRange(
  spec: string | undefined | null,
  shots: readonly FilmShot[]
): number[] {
  const raw = (spec ?? '').trim()
  if (!raw) return shots.map((_, index) => index)
  const picked = new Set<number>()
  for (const part of raw.split(/[,，\s]+/).filter(Boolean)) {
    const byId = shots.findIndex((shot) => shot.id.toLowerCase() === part.toLowerCase())
    if (byId >= 0) {
      picked.add(byId)
      continue
    }
    const m = part.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) continue
    const from = parseInt(m[1], 10)
    const to = m[2] ? parseInt(m[2], 10) : from
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
      if (n >= 1 && n <= shots.length) picked.add(n - 1)
    }
  }
  return [...picked].sort((a, b) => a - b)
}

// ─── 审核 ───────────────────────────────────────────────────────────────

export interface FilmReviewIssue {
  shotId: string
  verdict: 'pass' | 'fail'
  notes: string
}

export interface FilmReviewResult {
  verdict: 'PASS' | 'FAIL'
  score: number
  notes: string[]
  issues: FilmReviewIssue[]
}

/** 解析审核 JSON：{ verdict, score, notes[], shots:[{ id, verdict, notes }] } */
export function parseFilmReview(raw: string): FilmReviewResult | null {
  const parsed = parseJsonLoose(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const row = parsed as Record<string, unknown>
  const verdictRaw = str(pick(row, 'verdict', 'result', '结论')).toUpperCase()
  const list = pick(row, 'shots', 'issues', '镜头')
  const issues: FilmReviewIssue[] = Array.isArray(list)
    ? list
        .map((item): FilmReviewIssue | null => {
          if (!item || typeof item !== 'object') return null
          const r = item as Record<string, unknown>
          const shotId = str(pick(r, 'id', 'shotId', '镜头'))
          if (!shotId) return null
          const v = str(pick(r, 'verdict', 'result', '结论')).toLowerCase()
          return {
            shotId,
            verdict: v === 'fail' || v === '不通过' ? 'fail' : 'pass',
            notes: str(pick(r, 'notes', 'issue', 'fix', '问题', '修改意见'))
          }
        })
        .filter((item): item is FilmReviewIssue => !!item)
    : []
  const anyFail = issues.some((issue) => issue.verdict === 'fail')
  const verdict: 'PASS' | 'FAIL' =
    verdictRaw === 'FAIL' || verdictRaw.includes('不通过') || anyFail ? 'FAIL' : 'PASS'
  return {
    verdict,
    score: Math.min(100, Math.max(0, num(row.score, verdict === 'PASS' ? 80 : 50))),
    notes: strList(pick(row, 'notes', 'summary', '总评')),
    issues
  }
}

/** 把审核结论写回文档：逐镜 review + 状态（fail → revise；锁定镜头只记录不改状态） */
export function applyFilmReview(
  storyboard: FilmStoryboard,
  review: FilmReviewResult,
  rounds: number
): FilmStoryboard {
  const byId = new Map(review.issues.map((issue) => [issue.shotId.toLowerCase(), issue]))
  const shots = storyboard.shots.map((shot) => {
    const issue = byId.get(shot.id.toLowerCase())
    if (!issue) {
      const { review: _drop, ...rest } = shot
      return { ...rest, status: shot.status === 'revise' ? 'draft' : shot.status } as FilmShot
    }
    const status: FilmShotStatus = isFilmShotLocked(shot)
      ? shot.status
      : issue.verdict === 'fail'
        ? 'revise'
        : shot.status === 'revise'
          ? 'draft'
          : shot.status
    return { ...shot, status, review: { verdict: issue.verdict, notes: issue.notes } }
  })
  return {
    ...storyboard,
    shots,
    review: {
      verdict: review.verdict,
      score: review.score,
      rounds,
      notes: review.notes,
      at: new Date().toISOString()
    }
  }
}

/** 用修订稿替换指定镜头（锁定镜头不动；id 不在原稿里的修订忽略） */
export function replaceFilmShots(
  storyboard: FilmStoryboard,
  revised: readonly FilmShot[]
): FilmStoryboard {
  const byId = new Map(revised.map((shot) => [shot.id.toLowerCase(), shot]))
  const shots = storyboard.shots.map((shot) => {
    const next = byId.get(shot.id.toLowerCase())
    if (!next || isFilmShotLocked(shot)) return shot
    return {
      ...next,
      id: shot.id,
      order: shot.order,
      sceneId: next.sceneId || shot.sceneId,
      status: 'draft' as const
    }
  })
  return finalizeFilmStoryboard({ ...storyboard, shots })
}

/** 解析修订稿：接受 { shots:[...] } 或镜头数组 */
export function parseFilmRevisedShots(raw: string): FilmShot[] {
  const parsed = parseJsonLoose(raw)
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).shots
      : null
  if (!Array.isArray(list)) return []
  return list
    .map((item, index) => normalizeShot(item, index))
    .filter((shot): shot is FilmShot => !!shot && !!shot.id)
}

// ─── 展示 ───────────────────────────────────────────────────────────────

function cell(text: string): string {
  return text.replace(/\|/g, '｜').replace(/\r?\n/g, ' ').trim() || '—'
}

/** 人读 Markdown（卡片预览 / 文本口 / agent 快速浏览） */
export function filmStoryboardToMarkdown(doc: FilmStoryboard, locale?: string): string {
  const en = isEnglish(locale)
  const out: string[] = []
  out.push(`# ${doc.title || (en ? 'Storyboard' : '分镜')}`)
  if (doc.logline) out.push(`> ${doc.logline}`)
  const meta = [
    doc.style && (en ? `Style: ${doc.style}` : `风格：${doc.style}`),
    doc.aspectRatio && (en ? `Aspect: ${doc.aspectRatio}` : `画幅：${doc.aspectRatio}`)
  ]
    .filter(Boolean)
    .join(' · ')
  if (meta) out.push(meta)
  const totalSec = doc.shots.reduce((sum, shot) => sum + shot.durationSec, 0)
  out.push(
    en
      ? `${doc.scenes.length} scenes · ${doc.shots.length} shots · ~${Math.round(totalSec)}s`
      : `${doc.scenes.length} 场 · ${doc.shots.length} 镜 · 约 ${Math.round(totalSec)} 秒`
  )
  if (doc.review) {
    out.push(
      en
        ? `Director review: **${doc.review.verdict}** (${doc.review.score}/100, ${doc.review.rounds} round(s))`
        : `导演审核：**${doc.review.verdict}**（${doc.review.score}/100，${doc.review.rounds} 轮）`
    )
  }
  out.push('')
  out.push(
    en
      ? '| Shot | Size/Angle | Move | Sec | Characters | Location | Action | Dialogue | Status |'
      : '| 镜号 | 景别/角度 | 运镜 | 秒 | 角色 | 地点 | 画面 | 对白 | 状态 |'
  )
  out.push('|---|---|---|---|---|---|---|---|---|')
  for (const shot of doc.shots) {
    const dialogue = shot.dialogue
      .map((d) => (d.speaker ? `${d.speaker}: ${d.line}` : d.line))
      .join(' / ')
    const status = `${shot.status}${isFilmShotLocked(shot) ? '🔒' : ''}${shot.review?.verdict === 'fail' ? ' ⚠' : ''}`
    out.push(
      `| ${cell(shot.id)} | ${cell([shot.shotSize, shot.angle].filter(Boolean).join(' / '))} | ${cell(shot.cameraMove)} | ${shot.durationSec} | ${cell(shot.characters.join(', '))} | ${cell(shot.location)} | ${cell(shot.action)} | ${cell(dialogue)} | ${status} |`
    )
  }
  return out.join('\n')
}

/** 卡片一行摘要 */
export function filmStoryboardSummary(
  doc: FilmStoryboard | null | undefined,
  locale?: string
): string {
  if (!doc?.shots.length) return ''
  const en = isEnglish(locale)
  const totalSec = Math.round(doc.shots.reduce((sum, shot) => sum + shot.durationSec, 0))
  const rendered = doc.shots.filter((shot) => shot.media?.keyframe).length
  const videos = doc.shots.filter((shot) => shot.media?.video).length
  const parts = [
    doc.title,
    en
      ? `${doc.scenes.length} scenes / ${doc.shots.length} shots / ~${totalSec}s`
      : `${doc.scenes.length} 场 / ${doc.shots.length} 镜 / 约 ${totalSec} 秒`,
    en
      ? `${doc.entities.filter((e) => e.kind === 'character').length} characters`
      : `${doc.entities.filter((e) => e.kind === 'character').length} 个角色`
  ]
  if (doc.review) parts.push(`${en ? 'Review' : '审核'} ${doc.review.verdict} ${doc.review.score}`)
  if (rendered) parts.push(en ? `${rendered} keyframes` : `${rendered} 张关键帧`)
  if (videos) parts.push(en ? `${videos} clips` : `${videos} 条视频`)
  return parts.filter(Boolean).join(' · ')
}

export function filmCastSummary(cast: FilmCast | null | undefined, locale?: string): string {
  if (!cast?.entries.length) return ''
  const en = isEnglish(locale)
  const withImage = cast.entries.filter((entry) => filmCastEntryImage(entry)).length
  const names = cast.entries
    .map((entry) => entry.name)
    .slice(0, 8)
    .join(en ? ', ' : '、')
  return en
    ? `${cast.entries.length} entries (${withImage} with design sheet): ${names}`
    : `${cast.entries.length} 个设定（${withImage} 张设定图）：${names}`
}
