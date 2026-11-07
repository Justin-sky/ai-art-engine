/**
 * 四轴语义时间线：结构化内联 / 基线与脏检测 / 修改操作 —— 纯函数（主进程、渲染进程、引擎共用）。
 */
import { makeTimeRange, shortHash, stableStringify } from './ids'
import {
  hasReplacementContent,
  normalizeEntityReplacement,
  replacementSignatureForShot
} from './entityReplace'
import { finalizeSemanticBreakdown } from './reaPlan'
import {
  BASE_PRODUCTION_LABELS,
  type ProductionBaseLabel,
  type UnitPromptOverride
} from './reaTypes'
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

const ENTITY_EDIT_OPS: ReadonlySet<SemanticEditOp> = new Set<SemanticEditOp>([
  'entity.update',
  'entity.replace'
])

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

/** 证据镜头 → 结构化镜头节点 */
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
    transitionIn: shot.transitionIn ?? 'cut',
    camera: {},
    visual: {},
    subjects,
    dialogueIds: dialogue.filter((d) => overlaps(d.range, shot.range)).map((d) => d.id),
    textLayerIds: textLayers
      .filter((t) => t.shotId === shot.id || (!t.shotId && overlaps(t.range, shot.range)))
      .map((t) => t.id),
    origin: 'analysis',
    ...(shot.forensics ? { forensics: shot.forensics } : {})
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
 * 补齐结构：没有镜头树 / 台词表时从证据内联；已有的不覆盖（用户修改优先）。
 * 补完后若没有基线，则以当前内容为基线。
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
    entities: arr(doc.entities),
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

export function migrateSemanticTimeline(
  raw: SemanticTimeline,
  evidence: StructureEvidence = {}
): SemanticTimeline {
  if (!raw || typeof raw !== 'object') return raw
  // Strip any legacy fields cleanly on load
  const cleaned = { ...(raw as unknown as Record<string, unknown>) }
  delete cleaned.events
  delete cleaned.beats
  delete cleaned.intents
  delete cleaned.tracks
  delete cleaned.vocabulary
  return ensureSemanticStructure(cleaned as unknown as SemanticTimeline, evidence)
}

// ─── 指纹 / 基线 / 脏检测 ──────────────────────────────────────────────────────

function shotReplacementEntityIds(doc: SemanticTimeline, shot: SemanticShot): string[] {
  return arr(doc.entities)
    .filter((e) => arr(e.replacement?.masks).some((m) => m.shotId === shot.id))
    .map((e) => e.id)
}

/** 镜头画面相关内容的指纹：范围、镜头语言、画面、主体、提示词覆盖、单元覆盖、删除及实体替换 */
export function shotSignature(doc: SemanticTimeline, shot: SemanticShot): string {
  const entityIds = new Set(
    arr(shot.subjects)
      .map((s) => s.entityId)
      .filter(Boolean)
  )
  for (const id of shotReplacementEntityIds(doc, shot)) entityIds.add(id)
  const entities = arr(doc.entities)
    .filter((e) => entityIds.has(e.id))
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      ref: e.reference?.assetId,
      rep: replacementSignatureForShot(e, shot.id)
    }))
  const unitId = shot.replication?.unitId
  const unitOverride = unitId ? doc.breakdown?.unitPromptOverrides?.[unitId] : undefined
  return shortHash(
    stableStringify({
      d: Number(((shot.range?.end ?? 0) - (shot.range?.start ?? 0)).toFixed(3)),
      src: shot.sourceSegment,
      camera: shot.camera,
      visual: shot.visual,
      subjects: shot.subjects,
      prompt: shot.promptOverride?.trim() || undefined,
      unitPrompt:
        unitOverride && (unitOverride.imagePrompt?.trim() || unitOverride.videoPrompt?.trim())
          ? {
              img: unitOverride.imagePrompt?.trim() || undefined,
              vid: unitOverride.videoPrompt?.trim() || undefined
            }
          : undefined,
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

function shotCarriesUserEdit(doc: SemanticTimeline, shot: SemanticShot): boolean {
  const unitId = shot.replication?.unitId
  const hasUnitOverride = Boolean(
    unitId &&
    (doc.breakdown?.unitPromptOverrides?.[unitId]?.imagePrompt?.trim() ||
      doc.breakdown?.unitPromptOverrides?.[unitId]?.videoPrompt?.trim())
  )
  return (
    shot.origin === 'user' ||
    shot.removed === true ||
    !!shot.promptOverride?.trim() ||
    hasUnitOverride
  )
}

/**
 * 以当前内容重设基线（分析 / 富化结束时调用；之后的改动才算修改）。
 * 带用户修改的镜头 / 台词保留旧指纹。
 */
export function rebaselineSemanticTimeline(doc: SemanticTimeline): SemanticTimeline {
  const fresh = captureBaseline(doc)
  const prev = doc.baseline
  if (prev) {
    for (const shot of arr(doc.shots)) {
      if (shotCarriesUserEdit(doc, shot) && prev.shots?.[shot.id]) {
        fresh.shots[shot.id] = prev.shots[shot.id]!
      }
    }
    for (const line of arr(doc.dialogue)) {
      if (line.origin === 'user' && prev.dialogue?.[line.id]) {
        fresh.dialogue[line.id] = prev.dialogue[line.id]!
      }
    }
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
  }
  return { ...doc, baseline: fresh }
}

/** 重新分析时把上一版的用户修改带到新文档上（同 id 的镜头 / 台词 / 实体 / 单元提示词） */
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
    if (!old || !shotCarriesUserEdit(prev, old)) {
      return {
        ...shot,
        ...(old?.base?.reviewOverrideLabel
          ? {
              base: {
                ...(shot.base ?? old.base),
                label: old.base.reviewOverrideLabel,
                decidedBy: 'review_override' as const,
                reviewOverrideLabel: old.base.reviewOverrideLabel
              }
            }
          : {}),
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
      ...(old.base?.reviewOverrideLabel ? { base: old.base } : {}),
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
  const prevUnitOverrides = prev.breakdown?.unitPromptOverrides
  return {
    ...next,
    entities,
    shots,
    dialogue,
    ...(next.breakdown && prevUnitOverrides
      ? {
          breakdown: {
            ...next.breakdown,
            unitPromptOverrides: { ...prevUnitOverrides }
          }
        }
      : {}),
    speakers: arr(prev.speakers).length ? arr(prev.speakers) : arr(next.speakers),
    edits: arr(prev.edits)
  }
}

export interface SemanticDiff {
  dirtyShots: Map<string, string[]>
  removedShots: Set<string>
  dirtyDialogue: Set<string>
}

function shotChangeReasons(doc: SemanticTimeline, shot: SemanticShot): string[] {
  const reasons: string[] = []
  if (shot.promptOverride?.trim()) reasons.push('prompt')
  const unitId = shot.replication?.unitId
  if (
    unitId &&
    (doc.breakdown?.unitPromptOverrides?.[unitId]?.imagePrompt?.trim() ||
      doc.breakdown?.unitPromptOverrides?.[unitId]?.videoPrompt?.trim())
  ) {
    reasons.push('unit_prompt')
  }
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
    if (!before) {
      if (shot.promptOverride?.trim()) dirtyShots.set(shot.id, ['prompt'])
      continue
    }
    if (before !== shotSignature(doc, shot)) {
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
      const currentShot = shots[index]!
      const shotPatch =
        input.op === 'shot.prompt'
          ? { promptOverride: String(patch.prompt ?? patch.promptOverride ?? '') }
          : pickShotPatch(patch)
      let nextBase = currentShot.base
      if (input.op === 'shot.update' && 'reviewOverrideLabel' in patch) {
        const rawLabel = patch.reviewOverrideLabel
        if (rawLabel === null || rawLabel === '') {
          if (nextBase) {
            const { reviewOverrideLabel: _drop, ...restBase } = nextBase
            nextBase = { ...restBase, decidedBy: nextBase.vlmProbs ? 'vlm_fused' : 'deterministic' }
          }
        } else if (
          typeof rawLabel === 'string' &&
          (BASE_PRODUCTION_LABELS as readonly string[]).includes(rawLabel)
        ) {
          nextBase = {
            label: rawLabel as ProductionBaseLabel,
            probs: nextBase?.probs ?? { [rawLabel]: 1 },
            confidence: 0.96,
            decidedBy: 'review_override',
            reviewOverrideLabel: rawLabel as ProductionBaseLabel,
            ...(nextBase?.vlmProbs ? { vlmProbs: nextBase.vlmProbs } : {}),
            ...(nextBase?.vlmEvidence ? { vlmEvidence: nextBase.vlmEvidence } : {}),
            ...(nextBase?.aiEdits ? { aiEdits: nextBase.aiEdits } : {}),
            evidence: nextBase?.evidence ?? []
          }
        } else {
          throw new Error(`invalid reviewOverrideLabel: ${String(rawLabel)}`)
        }
      }
      const onlyReviewOverride =
        input.op === 'shot.update' &&
        Object.keys(shotPatch).length === 0 &&
        'reviewOverrideLabel' in patch
      const merged: SemanticShot = {
        ...currentShot,
        ...shotPatch,
        ...(nextBase ? { base: nextBase } : {}),
        origin: onlyReviewOverride ? currentShot.origin : edit.origin
      }
      next = { ...doc, shots: shots.map((s, i) => (i === index ? merged : s)) }
      break
    }
    case 'unit.prompt': {
      const unitId = String(input.target ?? '').trim()
      if (!unitId) throw new Error('unitId is required')
      const baseDoc = doc.breakdown ? doc : finalizeSemanticBreakdown(doc)
      const prevOverrides: Record<string, UnitPromptOverride> = {
        ...(baseDoc.breakdown?.unitPromptOverrides ?? {})
      }
      const cur = prevOverrides[unitId] ?? {}
      const nextImg =
        'imagePrompt' in patch
          ? typeof patch.imagePrompt === 'string'
            ? patch.imagePrompt.trim()
            : ''
          : (cur.imagePrompt ?? '')
      const nextVid =
        'videoPrompt' in patch
          ? typeof patch.videoPrompt === 'string'
            ? patch.videoPrompt.trim()
            : ''
          : (cur.videoPrompt ?? '')
      if (!nextImg && !nextVid) {
        delete prevOverrides[unitId]
      } else {
        prevOverrides[unitId] = {
          ...(nextImg ? { imagePrompt: nextImg } : {}),
          ...(nextVid ? { videoPrompt: nextVid } : {})
        }
      }
      next = {
        ...baseDoc,
        breakdown: {
          ...baseDoc.breakdown!,
          unitPromptOverrides: Object.keys(prevOverrides).length ? prevOverrides : undefined
        }
      }
      break
    }
    case 'shot.split': {
      const index = findShot()
      const targetShot = shots[index]!
      const splitAt = Number(patch.splitAtSec ?? patch.atSec)
      const minGap = 0.2
      if (
        !Number.isFinite(splitAt) ||
        splitAt < targetShot.range.start + minGap ||
        splitAt > targetShot.range.end - minGap
      ) {
        throw new Error(
          `splitAtSec must be strictly inside (${(targetShot.range.start + minGap).toFixed(2)}, ${(targetShot.range.end - minGap).toFixed(2)})`
        )
      }
      const fps = Number(doc.source?.fps) || 30
      const srcOffset = splitAt - targetShot.range.start
      const srcSplit = targetShot.sourceSegment.start + srcOffset
      const dialogue = arr(doc.dialogue)
      const textLayers = arr(doc.textLayers)
      const rangeA = makeTimeRange(targetShot.range.start, splitAt, fps)
      const rangeB = makeTimeRange(splitAt, targetShot.range.end, fps)
      const shotBId = `shot.${shortHash(`${targetShot.id}|${splitAt.toFixed(3)}|${shots.length}`)}`
      const shotA: SemanticShot = {
        ...targetShot,
        range: rangeA,
        sourceSegment: { start: targetShot.sourceSegment.start, end: srcSplit },
        keyframes: {
          ...(targetShot.keyframes?.first ? { first: targetShot.keyframes.first } : {}),
          ...(targetShot.keyframes?.middle ? { middle: targetShot.keyframes.middle } : {})
        },
        dialogueIds: dialogue.filter((d) => overlaps(d.range, rangeA)).map((d) => d.id),
        textLayerIds: textLayers.filter((t) => overlaps(t.range, rangeA)).map((t) => t.id)
      }
      const shotB: SemanticShot = {
        ...targetShot,
        id: shotBId,
        range: rangeB,
        sourceSegment: { start: srcSplit, end: targetShot.sourceSegment.end },
        transitionIn: 'cut',
        keyframes: {
          ...(targetShot.keyframes?.middle ? { first: targetShot.keyframes.middle } : {}),
          ...(targetShot.keyframes?.last ? { last: targetShot.keyframes.last } : {})
        },
        dialogueIds: dialogue.filter((d) => overlaps(d.range, rangeB)).map((d) => d.id),
        textLayerIds: textLayers.filter((t) => overlaps(t.range, rangeB)).map((t) => t.id)
      }
      const wasClean =
        !!doc.baseline?.shots?.[targetShot.id] &&
        doc.baseline.shots[targetShot.id] === shotSignature(doc, targetShot)
      const nextShots = [...shots.slice(0, index), shotA, shotB, ...shots.slice(index + 1)]
      next = { ...doc, shots: nextShots }
      if (wasClean && doc.baseline) {
        next = {
          ...next,
          baseline: {
            ...doc.baseline,
            shots: {
              ...doc.baseline.shots,
              [shotA.id]: shotSignature(next, shotA),
              [shotB.id]: shotSignature(next, shotB)
            }
          }
        }
      }
      break
    }
    case 'shot.merge': {
      const index = findShot()
      if (index + 1 >= shots.length) {
        throw new Error(`cannot merge last shot: ${input.target}`)
      }
      const a = shots[index]!
      const b = shots[index + 1]!
      const fps = Number(doc.source?.fps) || 30
      const mergedRange = makeTimeRange(a.range.start, b.range.end, fps)
      const mergedSubjects = [...arr(a.subjects)]
      for (const sub of arr(b.subjects)) {
        if (!mergedSubjects.some((x) => x.entityId === sub.entityId && x.name === sub.name)) {
          mergedSubjects.push(sub)
        }
      }
      const mergedShot: SemanticShot = {
        ...a,
        range: mergedRange,
        sourceSegment: {
          start: a.sourceSegment.start,
          end: b.sourceSegment.end
        },
        keyframes: {
          ...(a.keyframes?.first ? { first: a.keyframes.first } : {}),
          ...((a.keyframes?.middle ?? b.keyframes?.middle)
            ? { middle: a.keyframes?.middle ?? b.keyframes?.middle }
            : {}),
          ...((b.keyframes?.last ?? a.keyframes?.last)
            ? { last: b.keyframes?.last ?? a.keyframes?.last }
            : {})
        },
        subjects: mergedSubjects,
        dialogueIds: [...new Set([...arr(a.dialogueIds), ...arr(b.dialogueIds)])],
        textLayerIds: [...new Set([...arr(a.textLayerIds), ...arr(b.textLayerIds)])]
      }
      const bothClean =
        !!doc.baseline?.shots?.[a.id] &&
        !!doc.baseline?.shots?.[b.id] &&
        doc.baseline.shots[a.id] === shotSignature(doc, a) &&
        doc.baseline.shots[b.id] === shotSignature(doc, b)
      const nextShots = [...shots.slice(0, index), mergedShot, ...shots.slice(index + 2)]
      next = { ...doc, shots: nextShots }
      if (bothClean && doc.baseline) {
        const nextBaseShots = { ...doc.baseline.shots }
        delete nextBaseShots[b.id]
        nextBaseShots[mergedShot.id] = shotSignature(next, mergedShot)
        next = {
          ...next,
          baseline: {
            ...doc.baseline,
            shots: nextBaseShots
          }
        }
      }
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
      const merged: Entity = {
        ...rest,
        ...(replacement && (hasReplacementContent(replacement) || replacement.masks.length)
          ? { replacement }
          : {})
      }
      next = { ...doc, entities: entities.map((e, i) => (i === index ? merged : e)) }
      break
    }
    default:
      throw new Error(`unknown edit op: ${String(input.op)}`)
  }
  if (next.breakdown) {
    next = finalizeSemanticBreakdown(next)
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
