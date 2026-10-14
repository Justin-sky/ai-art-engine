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
import { makeTimeRange, shortHash, stableStringify } from './ids'
import { rebuildTracks } from './document'
import { SEMANTIC_EVENT_TYPES, isKnownTechniqueTrack, shotSemanticSignature } from './shotSemantics'
import {
  hasReplacementContent,
  normalizeEntityReplacement,
  replacementSignatureForShot
} from './entityReplace'

/** 改过实体（改名 / 换参考 / 局部替换）的修改操作 */
const ENTITY_EDIT_OPS: ReadonlySet<SemanticEditOp> = new Set<SemanticEditOp>([
  'entity.update',
  'entity.replace'
])
import {
  SEMANTIC_TIMELINE_SCHEMA,
  SEMANTIC_TIMELINE_SCHEMA_V1,
  type DialogueLine,
  type DirectorIntent,
  type Entity,
  type IntentTechnique,
  type OcrRegion,
  type SemanticBaseline,
  type SemanticEdit,
  type SemanticEditOp,
  type SemanticEvent,
  type SemanticEventType,
  type SemanticShot,
  type SemanticTimeline,
  type ShotEvidence,
  type StoryBeat,
  type UtteranceEvidence
} from './types'

/** 语义层修改（事件 / 节拍 / 意图）：经语义指纹驱动重生成 */
const SEMANTIC_LAYER_OPS: ReadonlySet<SemanticEditOp> = new Set<SemanticEditOp>([
  'event.update',
  'event.remove',
  'beat.update',
  'intent.update',
  'intent.remove'
])

export function isSemanticLayerOp(op: SemanticEditOp): boolean {
  return SEMANTIC_LAYER_OPS.has(op)
}

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
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
  /**
   * 语义指纹缺失（旧文档）时补齐 —— 但只在**还没有任何语义层修改**时补：
   * 那时文档内容就是分析结果，补出来的指纹等于"什么都没改"；有了语义层修改再补，
   * 会把修改当成原样吞掉（宁可这些修改不触发重生成，也不误判）。
   */
  const canBackfillSemantic =
    !!baseline && !baseline.semantic && !arr(doc.edits).some((e) => isSemanticLayerOp(e.op))
  const needsBaseline =
    !baseline ||
    canBackfillSemantic ||
    shots.some((s) => !(s.id in (baseline.shots ?? {}))) ||
    dialogue.some((d) => !(d.id in (baseline.dialogue ?? {})))
  if (!needsBaseline) return next
  // 只给**新出现**的节点补指纹；已有指纹保持（否则用户修改会被当成新基线吞掉）
  const fresh = captureBaseline(next)
  const semantic =
    baseline && !baseline.semantic && !canBackfillSemantic
      ? undefined
      : { ...fresh.semantic, ...(baseline?.semantic ?? {}) }
  return {
    ...next,
    baseline: {
      shots: { ...fresh.shots, ...(baseline?.shots ?? {}) },
      dialogue: { ...fresh.dialogue, ...(baseline?.dialogue ?? {}) },
      ...(semantic ? { semantic } : {}),
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

/** 在这一镜点选过替换目标（有掩码）的实体 */
function shotReplacementEntityIds(doc: SemanticTimeline, shot: SemanticShot): string[] {
  return arr(doc.entities)
    .filter((e) => arr(e.replacement?.masks).some((m) => m.shotId === shot.id))
    .map((e) => e.id)
}

/** 镜头画面相关内容的指纹：范围、镜头语言、画面、主体、提示词覆盖、删除，以及本镜实体的定义 */
export function shotSignature(doc: SemanticTimeline, shot: SemanticShot): string {
  const entityIds = new Set(
    arr(shot.subjects)
      .map((s) => s.entityId)
      .filter(Boolean)
  )
  // 主体绑定的实体 + 在这一镜点过替换掩码的实体（替换没绑主体也要算进来）
  for (const id of shotReplacementEntityIds(doc, shot)) entityIds.add(id)
  const entities = arr(doc.entities)
    .filter((e) => entityIds.has(e.id))
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      ref: e.reference?.assetId,
      // 没设置替换时为 undefined（稳定序列化会丢掉）→ 旧文档指纹不变
      rep: replacementSignatureForShot(e, shot.id)
    }))
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
  const semantic: Record<string, string> = {}
  for (const shot of arr(doc.shots)) {
    if (shot.range) semantic[shot.id] = shotSemanticSignature(doc, shot.range)
  }
  return { shots, dialogue, semantic, createdAt: new Date().toISOString() }
}

/** 语义层修改波及过的镜头（来自修改审计） */
function semanticallyEditedShots(doc: SemanticTimeline): Set<string> {
  const out = new Set<string>()
  for (const edit of arr(doc.edits)) {
    if (!isSemanticLayerOp(edit.op)) continue
    for (const id of arr(edit.affectedShots)) out.add(id)
  }
  return out
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
        .filter((e) => ENTITY_EDIT_OPS.has(e.op))
        .map((e) => e.target)
    )
    for (const shot of arr(doc.shots)) {
      const touched =
        arr(shot.subjects).some((s) => s.entityId && editedEntities.has(s.entityId)) ||
        shotReplacementEntityIds(doc, shot).some((id) => editedEntities.has(id))
      if (touched && prev.shots?.[shot.id]) fresh.shots[shot.id] = prev.shots[shot.id]!
    }
    // 语义层修改波及的镜头：保留旧语义指纹（没有旧指纹就不记 —— 未知基线视作未改，不误判）
    for (const id of semanticallyEditedShots(doc)) {
      const before = prev.semantic?.[id]
      if (before) fresh.semantic![id] = before
      else delete fresh.semantic![id]
    }
  }
  return { ...doc, baseline: fresh }
}

/**
 * 把上一版里**用户改过 / 删掉**的事件、节拍、意图带到新文档上。
 *
 * - 改过的事件 / 意图：同 id 用旧值覆盖；新分析里没有这个 id 时**追加**（用户写的内容不丢，
 *   重复了用户能在轨道上看到并删掉；静默丢掉则无从察觉）。意图的触发事件不在了就不带。
 * - 改过的节拍：只按 id 覆盖（节拍由启发式按时间重新切分，追加会叠出重叠段落）。
 * - 删掉的事件 / 意图：在新文档上同样删除（含级联）。
 */
function carryOverSemanticLayer(prev: SemanticTimeline, next: SemanticTimeline): SemanticTimeline {
  const edits = arr(prev.edits).filter((e) => isSemanticLayerOp(e.op))
  if (edits.length === 0) return next
  const targets = (op: SemanticEditOp): Set<string> =>
    new Set(edits.filter((e) => e.op === op).map((e) => e.target))
  const removedEvents = targets('event.remove')
  const removedIntents = targets('intent.remove')
  const editedEvents = targets('event.update')
  const editedBeats = targets('beat.update')
  const editedIntents = targets('intent.update')

  const mergeById = <T extends { id: string }>(
    base: T[],
    previous: T[],
    ids: Set<string>,
    append: boolean
  ): T[] => {
    const prevById = new Map(previous.filter((x) => ids.has(x.id)).map((x) => [x.id, x]))
    const out = base.map((x) => prevById.get(x.id) ?? x)
    if (append) {
      for (const [id, item] of prevById) if (!base.some((x) => x.id === id)) out.push(item)
    }
    return out
  }

  let doc: SemanticTimeline = {
    ...next,
    events: mergeById(arr(next.events), arr(prev.events), editedEvents, true),
    beats: mergeById(arr(next.beats), arr(prev.beats), editedBeats, false)
  }
  const eventIds = new Set(arr(doc.events).map((e) => e.id))
  const carriedIntents = arr(prev.intents).filter(
    (i) => editedIntents.has(i.id) && eventIds.has(i.trigger)
  )
  doc = {
    ...doc,
    intents: mergeById(arr(doc.intents), carriedIntents, editedIntents, true)
  }
  for (const id of removedEvents) {
    if (arr(doc.events).some((e) => e.id === id)) doc = removeEventCascade(doc, id)
  }
  for (const id of removedIntents) doc = removeIntent(doc, id)
  return rebuildTracks(linkIntentsToEvents(doc))
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
      .filter((e) => ENTITY_EDIT_OPS.has(e.op))
      .map((e) => e.target)
  )
  const shotIds = new Set(arr(next.shots).map((s) => s.id))
  const entities = arr(next.entities).map((ent) => {
    const old = prevEntities.get(ent.id)
    if (!old || !editedEntityIds.has(ent.id)) return ent
    // 局部替换跟着带过来；新分析里已经没有的镜头，其掩码丢掉（掩码只对那一镜的关键帧有效）
    const replacement = old.replacement
      ? {
          ...old.replacement,
          masks: arr(old.replacement.masks).filter((m) => shotIds.has(m.shotId))
        }
      : undefined
    return {
      ...ent,
      name: old.name,
      ...(old.reference ? { reference: old.reference } : {}),
      ...(replacement ? { replacement } : {})
    }
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
  return carryOverSemanticLayer(prev, {
    ...next,
    entities,
    shots,
    dialogue,
    speakers: arr(prev.speakers).length ? arr(prev.speakers) : arr(next.speakers),
    edits: arr(prev.edits)
  })
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
  for (const id of shotReplacementEntityIds(doc, shot)) entityIds.add(id)
  const entityEdits = arr(doc.edits).filter(
    (e) => ENTITY_EDIT_OPS.has(e.op) && entityIds.has(e.target)
  )
  if (entityEdits.some((e) => e.op === 'entity.update')) reasons.push('entity')
  if (entityEdits.some((e) => e.op === 'entity.replace')) reasons.push('replace')
  const touchedShot = arr(doc.edits).filter((e) => e.target === shot.id && e.op === 'shot.update')
  for (const e of touchedShot) for (const key of Object.keys(e.patch ?? {})) reasons.push(key)
  // 语义层：'event' / 'beat' / 'intent'（由修改审计里的 affectedShots 得出）
  for (const e of arr(doc.edits)) {
    if (isSemanticLayerOp(e.op) && arr(e.affectedShots).includes(shot.id)) {
      reasons.push(e.op.slice(0, e.op.indexOf('.')))
    }
  }
  return [...new Set(reasons.length ? reasons : ['content'])]
}

/** 本镜语义输入是否偏离基线（基线里没有语义指纹时视作未改） */
function semanticChanged(doc: SemanticTimeline, shot: SemanticShot): boolean {
  const before = doc.baseline?.semantic?.[shot.id]
  return !!before && !!shot.range && before !== shotSemanticSignature(doc, shot.range)
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
    // 镜头自身内容变了，或覆盖它的事件 / 节拍 / 意图变了（提示词会跟着变）
    if (before !== shotSignature(doc, shot) || semanticChanged(doc, shot)) {
      dirtyShots.set(shot.id, shotChangeReasons(doc, shot))
    }
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
    case 'entity.replace': {
      const entities = arr(doc.entities)
      const index = entities.findIndex((e) => e.id === input.target)
      if (index < 0) throw new Error(`entity not found: ${input.target}`)
      const { reference: _legacy, replacement: _old, ...rest } = entities[index]!
      const raw = patch.replacement
      const replacement = raw == null ? null : normalizeEntityReplacement(raw, doc)
      // 写入新结构即完成迁移：旧的 reference.assetId 不再保留（避免两处来源打架）
      const merged: Entity = {
        ...rest,
        ...(replacement && (hasReplacementContent(replacement) || replacement.masks.length)
          ? { replacement }
          : {})
      }
      next = { ...doc, entities: entities.map((e, i) => (i === index ? merged : e)) }
      break
    }
    case 'event.update':
      next = updateEvent(doc, input.target, patch, edit.origin)
      break
    case 'event.remove':
      if (!arr(doc.events).some((e) => e.id === input.target)) {
        throw new Error(`event not found: ${input.target}`)
      }
      next = rebuildTracks(removeEventCascade(doc, input.target))
      break
    case 'beat.update':
      next = updateBeat(doc, input.target, patch, edit.origin)
      break
    case 'intent.update':
      next = rebuildTracks(updateIntent(doc, input.target, patch, edit.origin))
      break
    case 'intent.remove':
      if (!arr(doc.intents).some((i) => i.id === input.target)) {
        throw new Error(`intent not found: ${input.target}`)
      }
      next = rebuildTracks(removeIntent(doc, input.target))
      break
    default:
      throw new Error(`unknown edit op: ${String(input.op)}`)
  }
  if (isSemanticLayerOp(input.op)) edit.affectedShots = affectedShots(doc, next)
  return { ...next, edits: [...arr(doc.edits), edit], updatedAt: now }
}

// ─── 语义层修改（事件 / 节拍 / 意图） ─────────────────────────────────────────────

/** 前后语义指纹不同的镜头 = 这次修改波及的镜头 */
function affectedShots(before: SemanticTimeline, after: SemanticTimeline): string[] {
  return arr(after.shots)
    .filter((s) => !!s.range)
    .filter((s) => shotSemanticSignature(before, s.range) !== shotSemanticSignature(after, s.range))
    .map((s) => s.id)
}

function has(patch: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${field} must be a non-empty string`)
  return text
}

function unitInterval(value: unknown, field: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${field} must be within 0..1`)
  return n
}

function updateEvent(
  doc: SemanticTimeline,
  id: string,
  patch: Record<string, unknown>,
  origin: SemanticEdit['origin']
): SemanticTimeline {
  const events = arr(doc.events)
  const index = events.findIndex((e) => e.id === id)
  if (index < 0) throw new Error(`event not found: ${id}`)
  const ev = events[index]!
  const merged: SemanticEvent = { ...ev, origin }
  if (has(patch, 'label')) merged.label = requiredText(patch.label, 'event label')
  if (has(patch, 'description')) merged.description = String(patch.description ?? '')
  if (has(patch, 'type')) {
    if (!(SEMANTIC_EVENT_TYPES as readonly unknown[]).includes(patch.type)) {
      throw new Error(`unknown event type: ${String(patch.type)}`)
    }
    merged.type = patch.type as SemanticEventType
  }
  if (has(patch, 'importance')) merged.importance = unitInterval(patch.importance, 'importance')
  if (has(patch, 'start') || has(patch, 'end')) {
    const start = has(patch, 'start') ? Number(patch.start) : ev.timeRange.start
    const end = has(patch, 'end') ? Number(patch.end) : ev.timeRange.end
    const duration = Number(doc.source?.duration)
    const limit = Number.isFinite(duration) && duration > 0 ? duration : Infinity
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error('event time range must satisfy 0 <= start < end')
    }
    if (end > limit + 1e-3) throw new Error('event time range exceeds the video duration')
    merged.timeRange = makeTimeRange(start, Math.min(end, limit), Number(doc.source?.fps) || 30)
  }
  // 改名后，按旧 label 触发的意图改为按 id 触发（否则改名会让意图悄悄脱钩）
  const renamed = merged.label !== ev.label
  const intents = renamed
    ? arr(doc.intents).map((i) => (i.trigger === ev.label ? { ...i, trigger: ev.id } : i))
    : arr(doc.intents)
  return {
    ...doc,
    events: events.map((e, i) => (i === index ? merged : e)),
    intents
  }
}

function updateBeat(
  doc: SemanticTimeline,
  id: string,
  patch: Record<string, unknown>,
  origin: SemanticEdit['origin']
): SemanticTimeline {
  const beats = arr(doc.beats)
  const index = beats.findIndex((b) => b.id === id)
  if (index < 0) throw new Error(`beat not found: ${id}`)
  const beat = beats[index]!
  const merged: StoryBeat = { ...beat, emotion: { ...beat.emotion }, origin }
  if (has(patch, 'type')) merged.type = requiredText(patch.type, 'beat type')
  if (has(patch, 'description')) merged.description = String(patch.description ?? '')
  if (has(patch, 'emotionLabel')) merged.emotion.label = String(patch.emotionLabel ?? '').trim()
  if (has(patch, 'emotionIntensity')) {
    merged.emotion.intensity = unitInterval(patch.emotionIntensity, 'emotion intensity')
  }
  return { ...doc, beats: beats.map((b, i) => (i === index ? merged : b)) }
}

function parseTechniques(value: unknown): IntentTechnique[] {
  if (!Array.isArray(value)) throw new Error('techniques must be an array')
  return value.map((raw, i) => {
    const tech = (raw ?? {}) as Record<string, unknown>
    if (!isKnownTechniqueTrack(tech.track)) {
      throw new Error(`techniques[${i}].track is not a known track: ${String(tech.track)}`)
    }
    const action = requiredText(tech.action, `techniques[${i}].action`)
    const params =
      tech.params && typeof tech.params === 'object' && !Array.isArray(tech.params)
        ? (tech.params as Record<string, unknown>)
        : undefined
    return {
      track: tech.track as IntentTechnique['track'],
      action,
      ...(params ? { params } : {})
    }
  })
}

function updateIntent(
  doc: SemanticTimeline,
  id: string,
  patch: Record<string, unknown>,
  origin: SemanticEdit['origin']
): SemanticTimeline {
  const intents = arr(doc.intents)
  const index = intents.findIndex((i) => i.id === id)
  if (index < 0) throw new Error(`intent not found: ${id}`)
  const intent = intents[index]!
  const merged: DirectorIntent = { ...intent, origin }
  if (has(patch, 'goal')) merged.goal = requiredText(patch.goal, 'intent goal')
  if (has(patch, 'reason')) merged.reason = String(patch.reason ?? '')
  if (has(patch, 'techniques')) merged.techniques = parseTechniques(patch.techniques)
  if (has(patch, 'trigger')) {
    const trigger = requiredText(patch.trigger, 'intent trigger')
    if (!arr(doc.events).some((e) => e.id === trigger)) {
      throw new Error(`intent trigger must be an existing event id: ${trigger}`)
    }
    merged.trigger = trigger
  }
  const next = { ...doc, intents: intents.map((x, i) => (i === index ? merged : x)) }
  return merged.trigger === intent.trigger ? next : linkIntentsToEvents(next)
}

/** 删一个意图，并清掉事件上对它的引用 */
function removeIntent(doc: SemanticTimeline, id: string): SemanticTimeline {
  return {
    ...doc,
    intents: arr(doc.intents).filter((i) => i.id !== id),
    events: arr(doc.events).map((e) =>
      arr(e.intents).includes(id) ? { ...e, intents: arr(e.intents).filter((x) => x !== id) } : e
    )
  }
}

/**
 * 删一个事件并级联：以它为触发的意图一起删（按 id 触发；按 label 触发且再没有同名事件时也删），
 * 节拍里对它的引用一并清掉。
 */
function removeEventCascade(doc: SemanticTimeline, id: string): SemanticTimeline {
  const target = arr(doc.events).find((e) => e.id === id)
  const events = arr(doc.events).filter((e) => e.id !== id)
  const labelStillUsed = !!target && events.some((e) => e.label === target.label)
  const orphaned = new Set(
    arr(doc.intents)
      .filter(
        (i) => i.trigger === id || (!!target && i.trigger === target.label && !labelStillUsed)
      )
      .map((i) => i.id)
  )
  return {
    ...doc,
    events: events.map((e) =>
      arr(e.intents).some((x) => orphaned.has(x))
        ? { ...e, intents: arr(e.intents).filter((x) => !orphaned.has(x)) }
        : e
    ),
    intents: arr(doc.intents).filter((i) => !orphaned.has(i.id)),
    beats: arr(doc.beats).map((b) =>
      arr(b.events).includes(id) ? { ...b, events: arr(b.events).filter((x) => x !== id) } : b
    )
  }
}

/**
 * 删除事件时会被一起删掉的意图（UI 在提交前预演、提示用户）。
 */
export function intentsRemovedWithEvent(doc: SemanticTimeline, eventId: string): DirectorIntent[] {
  const before = new Set(arr(doc.intents).map((i) => i.id))
  const after = new Set(arr(removeEventCascade(doc, eventId).intents).map((i) => i.id))
  return arr(doc.intents).filter((i) => before.has(i.id) && !after.has(i.id))
}

/** 事件上的 `intents[]` 按 trigger 重新对齐（trigger 是事件 id 或 label） */
function linkIntentsToEvents(doc: SemanticTimeline): SemanticTimeline {
  const intents = arr(doc.intents)
  return {
    ...doc,
    events: arr(doc.events).map((e) => ({
      ...e,
      intents: intents.filter((i) => i.trigger === e.id || i.trigger === e.label).map((i) => i.id)
    }))
  }
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
