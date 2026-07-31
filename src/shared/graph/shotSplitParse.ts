import {
  DEFAULT_SHOT_REVIEW_STATUS,
  asWorldRefList,
  createEmptyStoryboard,
  normalizeShotReviewStatus,
  type Shot,
  type ShotReviewStatus,
  type ShotStoryboard,
  type WorldEntityRef
} from '../domain'
import type { GraphDocument } from './types'

/** 分镜拆分 JSON 一行，字段对齐分镜表格 / ShotStoryboard */
export interface ShotSplitRow {
  title: string
  durationSec: number
  visualDescription: string
  shotSize: string
  lighting: string
  dialogue: string
  soundFx: string
  cameraMove: string
  /** 审核状态：未审核 | 已审核 */
  status: ShotReviewStatus
  /** 画面输出物化后的图片资产 id（生成分镜图聚合用，可选） */
  imageAssetIds?: string[]
  characters: WorldEntityRef[]
  scenes: WorldEntityRef[]
  props: WorldEntityRef[]
  weapons: WorldEntityRef[]
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function clampDurationSec(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN
  if (!Number.isFinite(n)) return 5
  return Math.min(60, Math.max(1, Math.round(n)))
}

/** 去掉模型常见的 markdown 代码围栏 */
export function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed
}

function normalizeRow(item: unknown, index: number): ShotSplitRow | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const title = asString(row.title).trim() || `分镜 ${index + 1}`
  const imageAssetIds = Array.isArray(row.imageAssetIds)
    ? row.imageAssetIds.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : undefined
  return {
    title,
    durationSec: clampDurationSec(row.durationSec),
    visualDescription: asString(row.visualDescription).trim(),
    shotSize: asString(row.shotSize).trim(),
    lighting: asString(row.lighting).trim(),
    dialogue: asString(row.dialogue).trim(),
    soundFx: asString(row.soundFx).trim(),
    cameraMove: asString(row.cameraMove).trim(),
    status: normalizeShotReviewStatus(row.status),
    characters: asWorldRefList(row.characters ?? row['角色']),
    scenes: asWorldRefList(row.scenes ?? row['场景']),
    props: asWorldRefList(row.props ?? row['道具']),
    weapons: asWorldRefList(row.weapons ?? row['武器']),
    ...(imageAssetIds?.length ? { imageAssetIds } : {})
  }
}

/**
 * 解析分镜拆分节点输出。成功返回至少 1 行；失败返回 null。
 */
export function parseShotSplitJson(raw: string | null | undefined): ShotSplitRow[] | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 容错：截取首个 [ ... ] 再试
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const rows: ShotSplitRow[] = []
  for (let i = 0; i < parsed.length; i++) {
    const row = normalizeRow(parsed[i], i)
    if (row) rows.push(row)
  }
  return rows.length ? rows : null
}

/** 将分镜列表序列化为拆分 JSON（供表格节点输出 / 再次拆分输入） */
export function shotsToShotSplitRows(shots: Shot[]): ShotSplitRow[] {
  return shots.map((shot, index) => {
    const sb = shot.storyboard
    const imageAssetIds = (shot.genRefs ?? [])
      .filter((ref) => ref.assetId)
      .map((ref) => ref.assetId)
    const uniqueIds = [...new Set(imageAssetIds)]
    return {
      title: shot.title?.trim() || `分镜 ${index + 1}`,
      durationSec: clampDurationSec(shot.camera?.durationSec),
      visualDescription: sb?.visualDescription?.trim() ?? '',
      shotSize: sb?.shotSize?.trim() ?? '',
      lighting: sb?.lighting?.trim() ?? '',
      dialogue: sb?.dialogue?.trim() ?? '',
      soundFx: sb?.soundFx?.trim() ?? '',
      cameraMove: sb?.cameraMove?.trim() ?? '',
      status: normalizeShotReviewStatus(shot.reviewStatus),
      characters: asWorldRefList(sb?.characters),
      scenes: asWorldRefList(sb?.scenes),
      props: asWorldRefList(sb?.props),
      weapons: asWorldRefList(sb?.weapons),
      ...(uniqueIds.length ? { imageAssetIds: uniqueIds } : {})
    }
  })
}

export function stringifyShotSplitRows(rows: ShotSplitRow[]): string {
  return JSON.stringify(rows, null, 2)
}

/**
 * 再次拆分时：按索引保留上游「已审核」行，防止模型改写。
 * 若新列表更短，把剩余已审核行追加到末尾。
 */
export function mergeShotSplitRowsPreservingReviewed(
  previous: ShotSplitRow[] | null | undefined,
  next: ShotSplitRow[] | null | undefined
): ShotSplitRow[] | null {
  if (!next?.length) return previous?.length ? [...previous] : null
  if (!previous?.length) {
    return next.map((row) => ({
      ...row,
      status: normalizeShotReviewStatus(row.status)
    }))
  }

  const result: ShotSplitRow[] = next.map((row, index) => {
    const prev = previous[index]
    if (prev?.status === '已审核') return { ...prev }
    return {
      ...row,
      status: normalizeShotReviewStatus(row.status) || DEFAULT_SHOT_REVIEW_STATUS
    }
  })

  for (let i = next.length; i < previous.length; i++) {
    const prev = previous[i]
    if (prev?.status === '已审核') result.push({ ...prev })
  }
  return result
}

function nodeCatalogPayload(doc: GraphDocument, nodeId: string): string | null {
  const node = doc.nodes.find((item) => item.id === nodeId)
  const fromParams = node?.params?.text?.trim()
  if (fromParams) return fromParams
  const out = doc.runStates?.[nodeId]?.outputs?.out
  if (out && typeof out === 'object' && out.kind === 'shots' && typeof out.text === 'string') {
    const live = out.text.trim()
    if (live) return live
  }
  return null
}

/** 从分镜资产图中取出连到「分镜表格」的上游文本，否则用分镜拆分节点正文 */
export function extractShotSplitJsonText(doc: GraphDocument | null | undefined): string | null {
  if (!doc?.nodes?.length) return null

  const table = doc.nodes.find((node) => node.typeId === 'script.shotTable')
  if (table) {
    for (const edge of doc.edges) {
      if (edge.target !== table.id) continue
      if ((edge.targetPort ?? 'in') !== 'in') continue
      const text = nodeCatalogPayload(doc, edge.source)
      if (text) return text
    }
    // 表格节点自身缓存
    const own = nodeCatalogPayload(doc, table.id)
    if (own) return own
  }

  const split = doc.nodes.find((node) => node.typeId === 'script.shotSplit')
  return (split && nodeCatalogPayload(doc, split.id)) || null
}

/**
 * 分镜表格节点自身缓存的 JSON（含用户在表格里绑定的角色/场景图）。
 * 与 extractShotSplitJsonText 不同：不优先上游拆分（上游通常无绑定图）。
 */
export function extractShotTableCachedJsonText(
  doc: GraphDocument | null | undefined
): string | null {
  if (!doc?.nodes?.length) return null
  const table = doc.nodes.find((node) => node.typeId === 'script.shotTable')
  if (!table) return null
  return nodeCatalogPayload(doc, table.id)
}

function refHasBindingImage(ref: WorldEntityRef): boolean {
  const url = (ref.imageUrl ?? '').trim()
  return !!url && !url.startsWith('data:')
}

/** 绑定列表里带 imageUrl 的数量（用于判断表格缓存是否比 Shot 更完整） */
export function countShotSplitBindingImages(
  row: Pick<ShotSplitRow, 'characters' | 'scenes' | 'props' | 'weapons'> | null | undefined
): number {
  if (!row) return 0
  let n = 0
  for (const list of [row.characters, row.scenes, row.props, row.weapons]) {
    for (const ref of asWorldRefList(list)) {
      if (refHasBindingImage(ref)) n++
    }
  }
  return n
}

/**
 * 合并两份世界元素引用：同名保留带 imageUrl 的；顺序以 primary 为主，再追加 secondary 独有项。
 */
export function mergeWorldRefListsPreferImages(
  primary: WorldEntityRef[] | undefined | null,
  secondary: WorldEntityRef[] | undefined | null
): WorldEntityRef[] {
  const a = asWorldRefList(primary)
  const b = asWorldRefList(secondary)
  if (!a.length) return b.map((ref) => ({ ...ref }))
  if (!b.length) return a.map((ref) => ({ ...ref }))

  const keyOf = (ref: WorldEntityRef): string => {
    const name = ref.name?.trim().toLowerCase()
    if (name) return `n:${name}`
    const url = (ref.imageUrl ?? '').trim().replace(/\\/g, '/').toLowerCase()
    return url ? `u:${url}` : ''
  }

  const chosen = new Map<string, WorldEntityRef>()
  for (const ref of [...a, ...b]) {
    const key = keyOf(ref)
    if (!key) continue
    const prev = chosen.get(key)
    if (!prev || (!refHasBindingImage(prev) && refHasBindingImage(ref))) {
      chosen.set(key, ref)
    }
  }

  const out: WorldEntityRef[] = []
  const seen = new Set<string>()
  for (const ref of [...a, ...b]) {
    const key = keyOf(ref)
    if (!key || seen.has(key)) continue
    const pick = chosen.get(key)
    if (!pick) continue
    out.push({ ...pick })
    seen.add(key)
  }
  return out
}

/** 用 overlay 行补齐 base 行的角色/场景/道具/武器绑定（优先保留带图项） */
export function mergeShotSplitRowBindings(base: ShotSplitRow, overlay: ShotSplitRow): ShotSplitRow {
  return {
    ...base,
    characters: mergeWorldRefListsPreferImages(base.characters, overlay.characters),
    scenes: mergeWorldRefListsPreferImages(base.scenes, overlay.scenes),
    props: mergeWorldRefListsPreferImages(base.props, overlay.props),
    weapons: mergeWorldRefListsPreferImages(base.weapons, overlay.weapons)
  }
}

/**
 * 将表格节点缓存里的绑定图合并进 live 分镜行。
 * 避免 resolveShotSplitTableJson 只有 Shot（绑定为空）时覆盖掉表格 params.text 里已有的绑定。
 */
export function mergeShotSplitRowsWithCachedBindings(
  live: ShotSplitRow[],
  cachedText: string | null | undefined
): ShotSplitRow[] {
  const cached = parseShotSplitJson(cachedText)
  if (!cached?.length) return live
  return live.map((row, index) => {
    const byIndex = cached[index]
    const title = row.title.trim()
    const byTitle = title ? cached.find((item) => item.title.trim() === title) : undefined
    const overlay =
      byIndex && (!title || byIndex.title.trim() === title || !byTitle)
        ? byIndex
        : (byTitle ?? byIndex)
    return overlay ? mergeShotSplitRowBindings(row, overlay) : row
  })
}

/** 按顺序 id / 标题匹配表格行 */
export function findShotSplitRowForShot(
  rows: ShotSplitRow[] | null | undefined,
  shot: Pick<Shot, 'id' | 'title'>,
  orderedShotIds?: string[]
): ShotSplitRow | null {
  if (!rows?.length) return null
  if (orderedShotIds?.length) {
    const index = orderedShotIds.indexOf(shot.id)
    if (index >= 0 && rows[index]) return rows[index]!
  }
  const title = shot.title?.trim()
  if (title) {
    const hit = rows.find((row) => row.title.trim() === title)
    if (hit) return hit
  }
  return null
}

/** 仅提取表格行上的绑定列表为 storyboard 片段 */
export function bindingStoryboardFromShotSplitRow(row: ShotSplitRow): ShotStoryboard {
  return {
    ...createEmptyStoryboard(),
    characters: asWorldRefList(row.characters).map((ref) => ({ ...ref })),
    scenes: asWorldRefList(row.scenes).map((ref) => ({ ...ref })),
    props: asWorldRefList(row.props).map((ref) => ({ ...ref })),
    weapons: asWorldRefList(row.weapons).map((ref) => ({ ...ref }))
  }
}

/**
 * 从剧本图文档的分镜表格缓存解析指定镜的绑定 storyboard。
 * Shot.storyboard 为空、表格 params.text 仍有绑定时用此补齐。
 */
export function resolveShotTableBindingStoryboard(
  docs: Array<GraphDocument | null | undefined>,
  shot: Pick<Shot, 'id' | 'title'>,
  orderedShotIds?: string[]
): ShotStoryboard | null {
  for (const doc of docs) {
    if (!doc) continue
    // 必须读表格自身缓存；上游拆分 JSON 通常没有 imageUrl
    const rows = parseShotSplitJson(extractShotTableCachedJsonText(doc))
    const row = findShotSplitRowForShot(rows, shot, orderedShotIds)
    if (!row || countShotSplitBindingImages(row) <= 0) continue
    return bindingStoryboardFromShotSplitRow(row)
  }
  return null
}

/** 合并 Shot live storyboard 与表格绑定（优先带 imageUrl） */
export function mergeStoryboardBindings(
  ...storyboards: Array<ShotStoryboard | null | undefined>
): ShotStoryboard {
  const base = createEmptyStoryboard()
  let merged: ShotStoryboard = { ...base, characters: [], scenes: [], props: [], weapons: [] }
  let textSeed: ShotStoryboard | null = null
  for (const sb of storyboards) {
    if (!sb) continue
    if (!textSeed) textSeed = sb
    merged = {
      ...merged,
      characters: mergeWorldRefListsPreferImages(merged.characters, sb.characters),
      scenes: mergeWorldRefListsPreferImages(merged.scenes, sb.scenes),
      props: mergeWorldRefListsPreferImages(merged.props, sb.props),
      weapons: mergeWorldRefListsPreferImages(merged.weapons, sb.weapons)
    }
  }
  if (textSeed) {
    return {
      ...createEmptyStoryboard(),
      ...textSeed,
      characters: merged.characters,
      scenes: merged.scenes,
      props: merged.props,
      weapons: merged.weapons
    }
  }
  return { ...createEmptyStoryboard(), ...merged }
}
