/**
 * VSIR v2：迁移 / 结构化内联 / 基线与脏检测 / 修改操作 —— 纯函数（主进程、渲染进程、引擎共用）。
 *
 * 编译原理的对应关系：
 * - `ensureSemanticStructure`：把证据（切镜 / 转写 / OCR）"语法分析"成镜头树与台词表；
 * - `captureBaseline`：分析结束时给每个镜头 / 台词打内容哈希（相当于"原始 AST 的指纹"）；
 * - `diffAgainstBaseline`：编译时比对指纹，得出需要重新生成的镜头与需要重新配音的台词；
 *   未改动的镜头在重建时直通原片段 —— 零修改即还原原片。
 * - `applySemanticEdit`：修改操作（UI / agent 共用），改字段并记审计。
 */
import { shortHash } from './ids'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  SEMANTIC_TIMELINE_SCHEMA_V1,
  type DialogueLine,
  type Entity,
  type OcrRegion,
  type SemanticBaseline,
  type SemanticEdit,
  type SemanticEditOp,
  type SemanticShot,
  type SemanticTimeline,
  type ShotEvidence,
  type UtteranceEvidence
} from './types'

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
}

/** 稳定序列化（键排序），哈希用 */
function stableStringify(value: unknown): string {
  if (value === undefined) return ''
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== '')
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`
}

export function isSemanticTimelineV1(doc: unknown): boolean {
  return (
    !!doc &&
    typeof doc === 'object' &&
    (doc as { schema?: unknown }).schema === SEMANTIC_TIMELINE_SCHEMA_V1
  )
}

// ─── 结构化内联 ───────────────────────────────────────────────────────────────

/** 证据镜头 → 结构化镜头节点（字段空着，等富化 / 用户填） */
export function shotFromEvidence(
  shot: ShotEvidence,
  dialogue: DialogueLine[],
  textLayers: OcrRegion[],
  entities: Entity[]
): SemanticShot {
  const subjects = entities
    .filter((ent) => arr(ent.appearances).some((app) => app?.shotId === shot.id))
    .filter((ent) => ent.kind !== 'voice' && ent.kind !== 'text')
    .map((ent) => ({ entityId: ent.id, name: ent.name }))
  return {
    id: shot.id,
    range: { ...shot.range },
    sourceSegment: { start: shot.range.start, end: shot.range.end },
    keyframes: { ...(shot.keyframes ?? {}) },
    transitionIn: 'cut',
    camera: {},
    visual: {},
    subjects,
    dialogueIds: dialogue.filter((d) => overlaps(d.range, shot.range)).map((d) => d.id),
    textLayerIds: textLayers
      .filter((t) => t.shotId === shot.id || (!t.shotId && overlaps(t.range, shot.range)))
      .map((t) => t.id),
    origin: 'analysis'
  }
}

export function dialogueFromUtterance(utt: UtteranceEvidence): DialogueLine {
  return {
    id: utt.id,
    range: { ...utt.range },
    text: utt.text,
    sourceText: utt.text,
    ...(utt.speaker ? { speaker: utt.speaker } : {}),
    ...(utt.words?.length ? { words: utt.words } : {}),
    granularity: utt.granularity,
    confidence: utt.confidence,
    origin: 'analysis'
  }
}

export interface StructureEvidence {
  shots?: ShotEvidence[]
  utterances?: UtteranceEvidence[]
  ocr?: OcrRegion[]
}

/**
 * 补齐 v2 结构：没有镜头树 / 台词表时从证据内联；已有的**不覆盖**（用户修改优先）。
 * 补完后若没有基线，则以当前内容为基线（迁移来的旧文档 = "什么都没改"）。
 */
export function ensureSemanticStructure(
  doc: SemanticTimeline,
  evidence: StructureEvidence = {}
): SemanticTimeline {
  let dialogue = arr(doc.dialogue)
  if (dialogue.length === 0 && arr(evidence.utterances).length > 0) {
    dialogue = arr(evidence.utterances).map(dialogueFromUtterance)
  }
  let textLayers = arr(doc.textLayers)
  if (textLayers.length === 0 && arr(evidence.ocr).length > 0) textLayers = arr(evidence.ocr)
  let shots = arr(doc.shots)
  if (shots.length === 0 && arr(evidence.shots).length > 0) {
    shots = arr(evidence.shots).map((s) =>
      shotFromEvidence(s, dialogue, textLayers, arr(doc.entities))
    )
  }
  const next: SemanticTimeline = {
    ...doc,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    shots,
    dialogue,
    textLayers,
    speakers: arr(doc.speakers),
    edits: arr(doc.edits)
  }
  const baseline = doc.baseline
  const needsBaseline =
    !baseline ||
    shots.some((s) => !(s.id in (baseline.shots ?? {}))) ||
    dialogue.some((d) => !(d.id in (baseline.dialogue ?? {})))
  if (!needsBaseline) return next
  // 只给**新出现**的节点补指纹；已有指纹保持（否则用户修改会被当成新基线吞掉）
  const fresh = captureBaseline(next)
  return {
    ...next,
    baseline: {
      shots: { ...fresh.shots, ...(baseline?.shots ?? {}) },
      dialogue: { ...fresh.dialogue, ...(baseline?.dialogue ?? {}) },
      createdAt: baseline?.createdAt ?? fresh.createdAt
    }
  }
}

/**
 * v1 → v2 自动迁移（读入任何时间线文档时调用；v2 文档原样补齐缺省字段）。
 * 有证据就顺手内联镜头树；没有证据时先迁 schema，编译拿到证据后再内联。
 */
export function migrateSemanticTimeline(
  raw: SemanticTimeline,
  evidence: StructureEvidence = {}
): SemanticTimeline {
  if (!raw || typeof raw !== 'object') return raw
  return ensureSemanticStructure(raw, evidence)
}

// ─── 指纹 / 基线 / 脏检测 ──────────────────────────────────────────────────────

/** 镜头画面相关内容的指纹：范围、镜头语言、画面、主体、提示词覆盖、删除，以及本镜实体的定义 */
export function shotSignature(doc: SemanticTimeline, shot: SemanticShot): string {
  const entityIds = new Set(
    arr(shot.subjects)
      .map((s) => s.entityId)
      .filter(Boolean)
  )
  const entities = arr(doc.entities)
    .filter((e) => entityIds.has(e.id))
    .map((e) => ({ id: e.id, kind: e.kind, name: e.name, ref: e.reference?.assetId }))
  return shortHash(
    stableStringify({
      d: Number(((shot.range?.end ?? 0) - (shot.range?.start ?? 0)).toFixed(3)),
      src: shot.sourceSegment,
      camera: shot.camera,
      visual: shot.visual,
      subjects: shot.subjects,
      prompt: shot.promptOverride?.trim() || undefined,
      removed: shot.removed === true ? true : undefined,
      entities
    }),
    16
  )
}

export function dialogueSignature(line: DialogueLine): string {
  return shortHash(stableStringify({ text: line.text?.trim(), speaker: line.speaker }), 16)
}

export function captureBaseline(doc: SemanticTimeline): SemanticBaseline {
  const shots: Record<string, string> = {}
  for (const shot of arr(doc.shots)) shots[shot.id] = shotSignature(doc, shot)
  const dialogue: Record<string, string> = {}
  for (const line of arr(doc.dialogue)) dialogue[line.id] = dialogueSignature(line)
  return { shots, dialogue, createdAt: new Date().toISOString() }
}

/** 这个镜头是否带着用户修改（重设基线时不能把它的修改吞掉） */
function shotCarriesUserEdit(shot: SemanticShot): boolean {
  return shot.origin === 'user' || shot.removed === true || !!shot.promptOverride?.trim()
}

/**
 * 以当前内容重设基线（分析 / 富化结束时调用；之后的改动才算修改）。
 * **带用户修改的镜头 / 台词保留旧指纹**：富化只补事实，不能把用户的修改变成"原样"。
 */
export function rebaselineSemanticTimeline(doc: SemanticTimeline): SemanticTimeline {
  const fresh = captureBaseline(doc)
  const prev = doc.baseline
  if (prev) {
    for (const shot of arr(doc.shots)) {
      if (shotCarriesUserEdit(shot) && prev.shots?.[shot.id])
        fresh.shots[shot.id] = prev.shots[shot.id]!
    }
    for (const line of arr(doc.dialogue)) {
      if (line.origin === 'user' && prev.dialogue?.[line.id]) {
        fresh.dialogue[line.id] = prev.dialogue[line.id]!
      }
    }
    // 改过名 / 换过参考的实体：它出现的镜头也保留旧指纹
    const editedEntities = new Set(
      arr(doc.edits)
        .filter((e) => e.op === 'entity.update')
        .map((e) => e.target)
    )
    for (const shot of arr(doc.shots)) {
      const touched = arr(shot.subjects).some((s) => s.entityId && editedEntities.has(s.entityId))
      if (touched && prev.shots?.[shot.id]) fresh.shots[shot.id] = prev.shots[shot.id]!
    }
  }
  return { ...doc, baseline: fresh }
}

/**
 * 重新分析时把**上一版的用户修改**带到新文档上（同 id 的镜头 / 台词 / 实体）。
 *
 * 不带的话：整图重跑会把分析节点也重跑一遍，用户在 dive 里做的修改全部被新分析覆盖。
 * 新文档的基线是新的分析结果；带过来的修改相对它仍然是"改过"，编译照样识别为脏。
 */
export function carryOverSemanticEdits(
  prev: SemanticTimeline | null | undefined,
  next: SemanticTimeline
): SemanticTimeline {
  if (!prev || arr(prev.edits).length === 0) return next
  const prevShots = new Map(arr(prev.shots).map((s) => [s.id, s]))
  const prevLines = new Map(arr(prev.dialogue).map((d) => [d.id, d]))
  const prevEntities = new Map(arr(prev.entities).map((e) => [e.id, e]))
  const editedEntityIds = new Set(
    arr(prev.edits)
      .filter((e) => e.op === 'entity.update')
      .map((e) => e.target)
  )
  const entities = arr(next.entities).map((ent) => {
    const old = prevEntities.get(ent.id)
    if (!old || !editedEntityIds.has(ent.id)) return ent
    return { ...ent, name: old.name, ...(old.reference ? { reference: old.reference } : {}) }
  })
  const shots = arr(next.shots).map((shot) => {
    const old = prevShots.get(shot.id)
    if (!old || !shotCarriesUserEdit(old)) {
      // 主体名跟着带过来的实体改名走
      return {
        ...shot,
        subjects: arr(shot.subjects).map((s) => {
          const ent = s.entityId ? entities.find((e) => e.id === s.entityId) : undefined
          return ent && editedEntityIds.has(ent.id) ? { ...s, name: ent.name } : s
        })
      }
    }
    return {
      ...shot,
      camera: old.camera,
      visual: old.visual,
      subjects: old.subjects,
      ...(old.transitionIn ? { transitionIn: old.transitionIn } : {}),
      ...(old.promptOverride ? { promptOverride: old.promptOverride } : {}),
      ...(old.removed ? { removed: true } : {}),
      origin: old.origin
    }
  })
  const dialogue = arr(next.dialogue).map((line) => {
    const old = prevLines.get(line.id)
    if (!old || old.origin !== 'user') return line
    return {
      ...line,
      text: old.text,
      ...(old.speaker ? { speaker: old.speaker } : {}),
      origin: 'user' as const
    }
  })
  return {
    ...next,
    entities,
    shots,
    dialogue,
    speakers: arr(prev.speakers).length ? arr(prev.speakers) : arr(next.speakers),
    edits: arr(prev.edits)
  }
}

export interface SemanticDiff {
  /** 需要重新生成画面的镜头 id → 原因 */
  dirtyShots: Map<string, string[]>
  /** 被删除的镜头 */
  removedShots: Set<string>
  /** 需要重新配音的台词 id */
  dirtyDialogue: Set<string>
}

/** 改动原因（便于在 UI / 日志里解释"这一镜为什么要重新生成"） */
function shotChangeReasons(doc: SemanticTimeline, shot: SemanticShot): string[] {
  const reasons: string[] = []
  if (shot.promptOverride?.trim()) reasons.push('prompt')
  const entityIds = new Set(
    arr(shot.subjects)
      .map((s) => s.entityId)
      .filter(Boolean)
  )
  const touchedEntity = arr(doc.edits).some(
    (e) => e.op === 'entity.update' && entityIds.has(e.target)
  )
  if (touchedEntity) reasons.push('entity')
  const touchedShot = arr(doc.edits).filter((e) => e.target === shot.id && e.op === 'shot.update')
  for (const e of touchedShot) for (const key of Object.keys(e.patch ?? {})) reasons.push(key)
  return [...new Set(reasons.length ? reasons : ['content'])]
}

export function diffAgainstBaseline(doc: SemanticTimeline): SemanticDiff {
  const dirtyShots = new Map<string, string[]>()
  const removedShots = new Set<string>()
  const dirtyDialogue = new Set<string>()
  const base = doc.baseline
  for (const shot of arr(doc.shots)) {
    if (shot.removed) {
      removedShots.add(shot.id)
      continue
    }
    const before = base?.shots?.[shot.id]
    // 没有基线的镜头（用户插入 / 基线缺失）：有提示词覆盖就生成，否则视作未改
    if (!before) {
      if (shot.promptOverride?.trim()) dirtyShots.set(shot.id, ['prompt'])
      continue
    }
    if (before !== shotSignature(doc, shot)) dirtyShots.set(shot.id, shotChangeReasons(doc, shot))
  }
  for (const line of arr(doc.dialogue)) {
    const before = base?.dialogue?.[line.id]
    const changed = before
      ? before !== dialogueSignature(line)
      : (line.text ?? '').trim() !== (line.sourceText ?? '').trim()
    if (changed) dirtyDialogue.add(line.id)
  }
  return { dirtyShots, removedShots, dirtyDialogue }
}

// ─── 修改操作 ─────────────────────────────────────────────────────────────────

export interface SemanticEditInput {
  op: SemanticEditOp
  target: string
  patch?: Record<string, unknown>
  origin?: SemanticEdit['origin']
}

const SHOT_EDITABLE = ['camera', 'visual', 'subjects', 'transitionIn', 'promptOverride'] as const

function pickShotPatch(patch: Record<string, unknown>): Partial<SemanticShot> {
  const out: Record<string, unknown> = {}
  for (const key of SHOT_EDITABLE) if (key in patch) out[key] = patch[key]
  return out as Partial<SemanticShot>
}

/**
 * 应用一次修改（纯函数，返回新文档）。目标不存在时抛错 —— 宁可让调用方看到，
 * 也不要静默产出"看起来改了、其实没改"的文档。
 */
export function applySemanticEdit(
  doc: SemanticTimeline,
  input: SemanticEditInput
): SemanticTimeline {
  const patch = input.patch ?? {}
  const now = new Date().toISOString()
  const edit: SemanticEdit = {
    id: `edit.${shortHash(`${input.op}|${input.target}|${now}|${stableStringify(patch)}`)}`,
    op: input.op,
    target: input.target,
    patch,
    origin: input.origin ?? 'user',
    at: now
  }
  const shots = arr(doc.shots)
  const findShot = (): number => {
    const index = shots.findIndex((s) => s.id === input.target)
    if (index < 0) throw new Error(`shot not found: ${input.target}`)
    return index
  }
  let next: SemanticTimeline = doc
  switch (input.op) {
    case 'shot.update':
    case 'shot.prompt': {
      const index = findShot()
      const shotPatch =
        input.op === 'shot.prompt'
          ? { promptOverride: String(patch.prompt ?? patch.promptOverride ?? '') }
          : pickShotPatch(patch)
      const merged: SemanticShot = { ...shots[index]!, ...shotPatch, origin: edit.origin }
      next = { ...doc, shots: shots.map((s, i) => (i === index ? merged : s)) }
      break
    }
    case 'shot.remove':
    case 'shot.restore': {
      const index = findShot()
      const merged: SemanticShot = { ...shots[index]!, removed: input.op === 'shot.remove' }
      next = { ...doc, shots: shots.map((s, i) => (i === index ? merged : s)) }
      break
    }
    case 'dialogue.update': {
      const lines = arr(doc.dialogue)
      const index = lines.findIndex((d) => d.id === input.target)
      if (index < 0) throw new Error(`dialogue line not found: ${input.target}`)
      const line = lines[index]!
      const merged: DialogueLine = {
        ...line,
        ...(typeof patch.text === 'string' ? { text: patch.text } : {}),
        ...(typeof patch.speaker === 'string' ? { speaker: patch.speaker } : {}),
        origin: edit.origin
      }
      next = { ...doc, dialogue: lines.map((d, i) => (i === index ? merged : d)) }
      break
    }
    case 'entity.update': {
      const entities = arr(doc.entities)
      const index = entities.findIndex((e) => e.id === input.target)
      if (index < 0) throw new Error(`entity not found: ${input.target}`)
      const ent = entities[index]!
      const merged: Entity = {
        ...ent,
        ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
        ...(typeof patch.referenceAssetId === 'string'
          ? patch.referenceAssetId
            ? { reference: { assetId: patch.referenceAssetId } }
            : { reference: undefined }
          : {})
      }
      // 镜头里的主体名跟着实体改（提示词用的是主体名）
      const nextShots = shots.map((s) => ({
        ...s,
        subjects: arr(s.subjects).map((sub) =>
          sub.entityId === ent.id ? { ...sub, name: merged.name } : sub
        )
      }))
      next = {
        ...doc,
        entities: entities.map((e, i) => (i === index ? merged : e)),
        shots: nextShots
      }
      break
    }
    case 'speaker.update': {
      const speakers = arr(doc.speakers)
      const index = speakers.findIndex((s) => s.id === input.target)
      const base = index >= 0 ? speakers[index]! : { id: input.target, name: input.target }
      const merged = {
        ...base,
        ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
        ...(typeof patch.voice === 'string' ? { voice: patch.voice } : {}),
        ...(typeof patch.referenceAudio === 'string'
          ? { referenceAudio: patch.referenceAudio }
          : {})
      }
      next = {
        ...doc,
        speakers:
          index >= 0 ? speakers.map((s, i) => (i === index ? merged : s)) : [...speakers, merged]
      }
      break
    }
    default:
      throw new Error(`unknown edit op: ${String(input.op)}`)
  }
  return { ...next, edits: [...arr(doc.edits), edit], updatedAt: now }
}

/** 文档里有多少处修改（UI 摘要用） */
export function summarizeSemanticDiff(doc: SemanticTimeline): {
  dirtyShots: number
  removedShots: number
  dirtyDialogue: number
} {
  const diff = diffAgainstBaseline(doc)
  return {
    dirtyShots: diff.dirtyShots.size,
    removedShots: diff.removedShots.size,
    dirtyDialogue: diff.dirtyDialogue.size
  }
}
