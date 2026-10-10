/**
 * 编辑草稿规范化 / 结构性编辑落到镜头序列 / 市场包查找与配方展开 — 纯函数。
 */
import { editId } from './ids'
import { expandRecipeEditMatrix } from './packs'
import { assertValidEdit } from './validate'
import { BUILTIN_VOCABULARIES } from './vocabulary'
import { BUILTIN_DIRECTOR_RULES } from './compiler'
import type {
  BeatVocabulary,
  DirectorRulePack,
  Origin,
  SemanticEdit,
  SemanticEditKind,
  SemanticPack,
  SemanticTimeline,
  ShotEvidence,
  VariantRecipe
} from './types'

const EDIT_KINDS: ReadonlySet<SemanticEditKind> = new Set<SemanticEditKind>([
  'replaceEntity',
  'removeEntity',
  'rewriteUtterance',
  'revoice',
  'editText',
  'retimeBeat',
  'reorderBeats',
  'dropBeat',
  'regenerateShot',
  'fixFrames',
  'grade',
  'audioFix',
  'applyIntent'
])

export interface NormalizedEdits {
  edits: SemanticEdit[]
  /** 被丢弃的草稿原因（索引 + 校验信息） */
  issues: string[]
}

/**
 * 用户/配方/智能体给的编辑草稿 → 合法 SemanticEdit：补 id / origin / createdAt，丢弃非法项。
 * 接受数组或 `{ edits: [...] }`。
 */
export function normalizeSemanticEdits(raw: unknown, origin: Origin = 'user'): NormalizedEdits {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { edits?: unknown }).edits)
      ? (raw as { edits: unknown[] }).edits
      : []
  const edits: SemanticEdit[] = []
  const issues: string[] = []
  const now = new Date().toISOString()
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      issues.push(`#${index}: not an object`)
      return
    }
    const draft = item as Record<string, unknown>
    const kind = draft.kind as SemanticEditKind
    if (!EDIT_KINDS.has(kind)) {
      issues.push(`#${index}: unknown kind ${String(draft.kind)}`)
      return
    }
    const edit = {
      ...draft,
      id:
        typeof draft.id === 'string' && draft.id
          ? draft.id
          : editId(kind, `${index}|${JSON.stringify(draft)}`),
      origin: (draft.origin as Origin) || origin,
      createdAt: typeof draft.createdAt === 'string' && draft.createdAt ? draft.createdAt : now
    } as SemanticEdit
    const v = assertValidEdit(edit)
    if (!v.ok) {
      issues.push(`#${index} ${kind}: ${v.issues.map((i) => `${i.path} ${i.message}`).join(', ')}`)
      return
    }
    edits.push(edit)
  })
  return { edits, issues }
}

function beatOfShot(timeline: SemanticTimeline, shot: ShotEvidence): string | undefined {
  const mid = (shot.range.start + shot.range.end) / 2
  return timeline.beats.find((b) => b.timeRange.start <= mid && mid < b.timeRange.end)?.id
}

/**
 * dropBeat / reorderBeats → 输出镜头序列（按镜头中点归属节拍）。
 * 镜头不切分：一个镜头只跟随其中点所在的节拍。
 */
export function applyStructuralEdits(
  timeline: SemanticTimeline,
  shots: ShotEvidence[],
  edits: SemanticEdit[]
): ShotEvidence[] {
  const dropped = new Set<string>()
  let order: string[] | undefined
  for (const edit of edits) {
    if (edit.kind === 'dropBeat') dropped.add(edit.beatId)
    else if (edit.kind === 'reorderBeats' && edit.beatIds.length > 0) order = edit.beatIds
  }
  if (dropped.size === 0 && !order) return shots
  const kept = shots.filter((s) => {
    const beat = beatOfShot(timeline, s)
    return !beat || !dropped.has(beat)
  })
  if (!order) return kept
  const rank = new Map(order.map((id, i) => [id, i]))
  // 未列出的节拍保持原相对顺序排在后面
  return kept
    .map((shot, index) => {
      const beat = beatOfShot(timeline, shot)
      const r = beat !== undefined && rank.has(beat) ? rank.get(beat)! : order!.length
      return { shot, index, r }
    })
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map((x) => x.shot)
}

/** 实体 → 出现镜头索引（规划器与执行器共用） */
export function buildEntityShotIndex(timeline: SemanticTimeline): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const ent of timeline.entities) {
    index.set(ent.id, [...new Set(ent.appearances.map((a) => a.shotId))])
  }
  return index
}

// ─── Packs ──────────────────────────────────────────────────────────────────

export function findVocabularyInPacks(
  packs: SemanticPack[],
  id: string | undefined
): BeatVocabulary | undefined {
  if (!id) return undefined
  for (const p of packs) {
    if (p.kind === 'vocabulary' && p.vocabulary && (p.vocabulary.id === id || p.id === id)) {
      return p.vocabulary
    }
  }
  return BUILTIN_VOCABULARIES.find((v) => v.id === id)
}

export function listVocabularies(packs: SemanticPack[]): BeatVocabulary[] {
  const out = [...BUILTIN_VOCABULARIES]
  for (const p of packs) {
    if (p.kind === 'vocabulary' && p.vocabulary && !out.some((v) => v.id === p.vocabulary!.id)) {
      out.push(p.vocabulary)
    }
  }
  return out
}

/**
 * 内置规则 + 市场规则包；ids 非空时只取命中的包（按包 id 或规则包 id）。
 */
export function collectRulePacks(packs: SemanticPack[], ids?: string[]): DirectorRulePack[] {
  const all: Array<{ packId: string; rules: DirectorRulePack }> = [
    { packId: BUILTIN_DIRECTOR_RULES.id, rules: BUILTIN_DIRECTOR_RULES }
  ]
  for (const p of packs) {
    if (p.kind === 'rules' && p.rules) all.push({ packId: p.id, rules: p.rules })
  }
  const wanted = (ids ?? []).map((s) => s.trim()).filter(Boolean)
  if (wanted.length === 0) return all.map((x) => x.rules)
  return all
    .filter((x) => wanted.includes(x.packId) || wanted.includes(x.rules.id))
    .map((x) => x.rules)
}

export function listRecipes(
  packs: SemanticPack[]
): Array<{ packId: string; recipe: VariantRecipe }> {
  const out: Array<{ packId: string; recipe: VariantRecipe }> = []
  for (const p of packs) {
    if (p.kind === 'recipe' && p.recipe) out.push({ packId: p.id, recipe: p.recipe })
  }
  return out
}

export function findRecipe(
  packs: SemanticPack[],
  id: string | undefined
): VariantRecipe | undefined {
  const key = id?.trim()
  if (!key) return undefined
  return listRecipes(packs).find((r) => r.recipe.id === key || r.packId === key)?.recipe
}

export interface RecipeVariantRow {
  slots: Record<string, unknown>
  edits: Record<string, unknown>[]
}

/**
 * 配方 × 槽位值 → 每个变体的编辑草稿。
 * 槽位值可为单值或数组（数组做笛卡尔积）；缺失槽位直接报错而不是生成空替换。
 */
export function instantiateRecipe(
  recipe: VariantRecipe,
  slotValues: Record<string, unknown>
): { rows: RecipeVariantRow[]; missingSlots: string[] } {
  const missingSlots: string[] = []
  const slots = recipe.slots.map((slot) => {
    const raw = slotValues[slot.key]
    const values = (
      Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
    ).filter((v) => v !== '' && v !== undefined && v !== null)
    if (values.length === 0) missingSlots.push(slot.key)
    return { key: slot.key, values }
  })
  if (missingSlots.length > 0) return { rows: [], missingSlots }
  const templates = recipe.editTemplates as Array<Record<string, unknown>>
  const editRows = expandRecipeEditMatrix(templates, slots)
  const slotRows = slots.reduce<Record<string, unknown>[]>(
    (rows, slot) => rows.flatMap((row) => slot.values.map((v) => ({ ...row, [slot.key]: v }))),
    [{}]
  )
  return {
    rows: editRows.map((edits, i) => ({ slots: slotRows[i] ?? {}, edits })),
    missingSlots
  }
}
