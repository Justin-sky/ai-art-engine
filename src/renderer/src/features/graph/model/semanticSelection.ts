/**
 * 语义时间线 dive 的**选中模型**：轨道上点中的是谁、它管着哪段时间、动它会波及哪些镜头。
 *
 * 纯函数（不碰 DOM / i18n），编辑器与右侧检查器共用，单测直接覆盖。
 */
import {
  diffAgainstBaseline,
  type DialogueLine,
  type DirectorIntent,
  type Entity,
  type SemanticEvent,
  type SemanticShot,
  type SemanticTimeline,
  type StoryBeat
} from '@shared/semanticTimeline'
import { resolveTriggerRange } from './semanticTimelineView'

export type SemanticSelectionKind = 'shot' | 'dialogue' | 'event' | 'beat' | 'intent' | 'entity'

/**
 * 选中项。`clip` 区分同一对象的多个片段：实体＝第几次出现，意图＝哪条制作轨道。
 * 高亮按片段算（点一个片段不让整行亮），编辑按对象算（改的是同一个实体 / 意图）。
 */
export interface SemanticSelection {
  kind: SemanticSelectionKind
  id: string
  clip?: string | number
}

export type ResolvedSelection =
  | { kind: 'shot'; item: SemanticShot; index: number }
  | { kind: 'dialogue'; item: DialogueLine }
  | { kind: 'event'; item: SemanticEvent }
  | { kind: 'beat'; item: StoryBeat }
  | { kind: 'intent'; item: DirectorIntent; track?: string }
  | { kind: 'entity'; item: Entity; appearance: number }

export interface TimeSpan {
  start: number
  end: number
}

/** 片段键：与轨道块的高亮比对用（`id` 或 `id#clip`） */
export function selectionClipKey(selection: SemanticSelection | null | undefined): string | null {
  if (!selection) return null
  return selection.clip == null ? selection.id : `${selection.id}#${selection.clip}`
}

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

/** 在当前文档里找回选中对象；对象已被删除（或文档换了）时返回 null */
export function resolveSelection(
  doc: SemanticTimeline | null | undefined,
  selection: SemanticSelection | null | undefined
): ResolvedSelection | null {
  if (!doc || !selection) return null
  const { id } = selection
  switch (selection.kind) {
    case 'shot': {
      const index = arr(doc.shots).findIndex((s) => s.id === id)
      return index < 0 ? null : { kind: 'shot', item: doc.shots![index]!, index }
    }
    case 'dialogue': {
      const item = arr(doc.dialogue).find((d) => d.id === id)
      return item ? { kind: 'dialogue', item } : null
    }
    case 'event': {
      const item = arr(doc.events).find((e) => e.id === id)
      return item ? { kind: 'event', item } : null
    }
    case 'beat': {
      const item = arr(doc.beats).find((b) => b.id === id)
      return item ? { kind: 'beat', item } : null
    }
    case 'intent': {
      const item = arr(doc.intents).find((i) => i.id === id)
      if (!item) return null
      return {
        kind: 'intent',
        item,
        ...(typeof selection.clip === 'string' ? { track: selection.clip } : {})
      }
    }
    case 'entity': {
      const item = arr(doc.entities).find((e) => e.id === id)
      if (!item) return null
      const n = Number(selection.clip ?? 0)
      const appearance = Number.isInteger(n) && n >= 0 && n < arr(item.appearances).length ? n : 0
      return { kind: 'entity', item, appearance }
    }
  }
}

/** 选中对象占据的时间（实体＝被点的那次出现；意图＝触发事件的时间） */
export function selectionSpan(doc: SemanticTimeline, resolved: ResolvedSelection): TimeSpan | null {
  switch (resolved.kind) {
    case 'shot':
    case 'dialogue':
      return resolved.item.range ?? null
    case 'event':
    case 'beat':
      return resolved.item.timeRange ?? null
    case 'intent':
      return resolveTriggerRange(arr(doc.events), resolved.item.trigger)
    case 'entity':
      return arr(resolved.item.appearances)[resolved.appearance]?.range ?? null
  }
}

function overlaps(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && a.end > b.start
}

/** 镜头的展示编号（S1、S2 …，按镜头树顺序；找不到时回退原 id） */
export function shotLabel(doc: SemanticTimeline, shotId: string): string {
  const index = arr(doc.shots).findIndex((s) => s.id === shotId)
  return index < 0 ? shotId : `S${index + 1}`
}

export interface ShotImpact {
  shotId: string
  label: string
  /** 'regenerate'＝当前内容下会重新生成；'removed'＝已删；'passthrough'＝直通原片 */
  status: 'regenerate' | 'removed' | 'passthrough'
}

/**
 * 选中对象**覆盖**的镜头及其当前重建状态。
 *
 * 修改会立即应用到文档，所以这里看到的就是"改完之后"的结果：
 * 改一下意图，覆盖的镜头立刻从「直通」变成「将重新生成」。
 */
export function selectionImpact(doc: SemanticTimeline, resolved: ResolvedSelection): ShotImpact[] {
  const diff = diffAgainstBaseline(doc)
  const shots = arr(doc.shots)
  let covered: SemanticShot[]
  if (resolved.kind === 'shot') {
    covered = [resolved.item]
  } else if (resolved.kind === 'entity') {
    const ids = new Set(arr(resolved.item.appearances).map((a) => a.shotId))
    covered = shots.filter(
      (s) => ids.has(s.id) || arr(s.subjects).some((sub) => sub.entityId === resolved.item.id)
    )
  } else {
    const span = selectionSpan(doc, resolved)
    covered = span ? shots.filter((s) => s.range && overlaps(s.range, span)) : []
  }
  return covered.map((s) => ({
    shotId: s.id,
    label: shotLabel(doc, s.id),
    status: diff.removedShots.has(s.id)
      ? 'removed'
      : diff.dirtyShots.has(s.id)
        ? 'regenerate'
        : 'passthrough'
  }))
}

/** 修改后保持选中：对象还在就留着，被删了就清空 */
export function keepSelection(
  doc: SemanticTimeline | null | undefined,
  selection: SemanticSelection | null
): SemanticSelection | null {
  return resolveSelection(doc, selection) ? selection : null
}
