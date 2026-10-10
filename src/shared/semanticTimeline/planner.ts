/**
 * 失效规划器：从成片往回推导依赖，给出保留 / 替换 / 重算计划与费用估算。
 * 纯函数，可单测；不启动任何付费生成。
 */
import { buildId, editId } from './ids'
import type {
  BuildDefinition,
  CostEstimate,
  FidelityLevel,
  InvalidationPlan,
  PlanItem,
  SemanticEdit,
  SemanticTimeline,
  ShotEvidence
} from './types'

export interface PlannerInput {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  edits: SemanticEdit[]
  /** 可选：实体 → 出现的 shotId 列表（缺省从 timeline.entities 推导） */
  entityShotIndex?: Map<string, string[]>
}

function product(shotId: string, kind: string): string {
  return `${shotId}.${kind}`
}

function ensureItem(
  map: Map<string, PlanItem>,
  id: string,
  action: PlanItem['action'],
  reason: string
): void {
  const prev = map.get(id)
  // replace > recompute > keep
  const rank = { keep: 0, recompute: 1, replace: 2 }
  if (!prev || rank[action] > rank[prev.action]) {
    map.set(id, { productId: id, action, reason })
  } else if (prev && action === prev.action && !prev.reason.includes(reason)) {
    prev.reason = `${prev.reason}; ${reason}`
  }
}

function entityShots(timeline: SemanticTimeline, entityId: string): string[] {
  const ent = timeline.entities.find((e) => e.id === entityId)
  if (!ent) return []
  return [...new Set(ent.appearances.map((a) => a.shotId))]
}

function shotDuration(shot: ShotEvidence): number {
  return Math.max(0, shot.range.end - shot.range.start)
}

/**
 * 根据 edits 生成失效计划。
 * 默认所有 shot.video / shot.audio / final.video 为 keep；按规则升级。
 */
export function planInvalidation(input: PlannerInput): InvalidationPlan {
  const { timeline, shots, edits } = input
  const items = new Map<string, PlanItem>()

  for (const shot of shots) {
    ensureItem(items, product(shot.id, 'video'), 'keep', 'unchanged')
    ensureItem(items, product(shot.id, 'audio'), 'keep', 'unchanged')
  }
  ensureItem(items, 'final.video', 'keep', 'unchanged')
  ensureItem(items, 'final.audio', 'keep', 'unchanged')
  ensureItem(items, 'captions', 'keep', 'unchanged')

  let targetLevel: FidelityLevel = 'L0'
  let paidSeconds = 0
  let paidShotCount = 0
  const paidShots = new Set<string>()

  for (const edit of edits) {
    switch (edit.kind) {
      case 'replaceEntity':
      case 'removeEntity': {
        targetLevel = maxLevel(targetLevel, 'L1')
        const shotIds =
          input.entityShotIndex?.get(edit.entityId) ?? entityShots(timeline, edit.entityId)
        for (const sid of shotIds) {
          ensureItem(items, product(sid, 'video'), 'recompute', `${edit.kind}:${edit.entityId}`)
          if (!paidShots.has(sid)) {
            const sh = shots.find((s) => s.id === sid)
            if (sh) {
              paidSeconds += shotDuration(sh)
              paidShotCount += 1
              paidShots.add(sid)
            }
          }
        }
        ensureItem(items, 'final.video', 'recompute', `${edit.kind} affects final`)
        break
      }
      case 'rewriteUtterance': {
        targetLevel = maxLevel(targetLevel, edit.lipSync ? 'L1' : 'L3')
        ensureItem(items, `utt.${edit.utteranceId}.speech`, 'replace', 'rewrite utterance')
        ensureItem(items, 'captions', 'recompute', 'utterance text changed')
        ensureItem(items, 'final.audio', 'recompute', 'speech replaced')
        if (edit.lipSync) {
          // 口型：仅标记受影响镜头（此处按整段保守处理；执行器可再收窄）
          for (const shot of shots) {
            ensureItem(items, product(shot.id, 'video'), 'recompute', 'lipSync')
            if (!paidShots.has(shot.id)) {
              paidSeconds += shotDuration(shot)
              paidShotCount += 1
              paidShots.add(shot.id)
            }
          }
          ensureItem(items, 'final.video', 'recompute', 'lipSync')
        }
        break
      }
      case 'revoice': {
        targetLevel = maxLevel(targetLevel, 'L3')
        ensureItem(items, 'final.audio', 'replace', 'revoice')
        ensureItem(items, 'captions', 'recompute', 'revoice may change timing')
        if (edit.lipSync) {
          targetLevel = maxLevel(targetLevel, 'L1')
          for (const shot of shots) {
            ensureItem(items, product(shot.id, 'video'), 'recompute', 'revoice lipSync')
          }
          ensureItem(items, 'final.video', 'recompute', 'revoice lipSync')
        }
        break
      }
      case 'editText': {
        targetLevel = maxLevel(targetLevel, 'L1')
        ensureItem(items, `ocr.${edit.regionId}`, 'replace', 'edit text overlay')
        ensureItem(items, 'final.video', 'recompute', 'text overlay')
        break
      }
      case 'dropBeat':
      case 'retimeBeat':
      case 'reorderBeats': {
        targetLevel = maxLevel(targetLevel, 'L3')
        ensureItem(items, 'final.video', 'recompute', edit.kind)
        ensureItem(items, 'final.audio', 'recompute', edit.kind)
        ensureItem(items, 'captions', 'recompute', edit.kind)
        break
      }
      case 'regenerateShot': {
        targetLevel = maxLevel(targetLevel, 'L2')
        ensureItem(items, product(edit.shotId, 'video'), 'replace', 'regenerate shot')
        ensureItem(items, 'final.video', 'recompute', 'shot regenerated')
        const sh = shots.find((s) => s.id === edit.shotId)
        if (sh && !paidShots.has(edit.shotId)) {
          paidSeconds += shotDuration(sh)
          paidShotCount += 1
          paidShots.add(edit.shotId)
        }
        break
      }
      case 'fixFrames': {
        targetLevel = maxLevel(targetLevel, 'L1')
        ensureItem(items, product(edit.shotId, 'video'), 'recompute', 'fix frames')
        ensureItem(items, 'final.video', 'recompute', 'fix frames')
        break
      }
      case 'grade':
      case 'audioFix': {
        targetLevel = maxLevel(targetLevel, 'L3')
        ensureItem(items, 'final.video', 'recompute', edit.kind)
        if (edit.kind === 'audioFix') ensureItem(items, 'final.audio', 'recompute', edit.kind)
        break
      }
      case 'applyIntent': {
        targetLevel = maxLevel(targetLevel, 'L3')
        ensureItem(items, 'final.video', 'recompute', 'director intent')
        break
      }
      default:
        break
    }
  }

  const cost: CostEstimate = {
    paidSeconds: Math.round(paidSeconds * 1000) / 1000,
    localShotCount: shots.length - paidShotCount,
    paidShotCount,
    note:
      paidSeconds > 0
        ? `将调用付费模型约 ${paidSeconds.toFixed(1)}s；确认前不产生费用`
        : '仅本地处理，无付费生成'
  }

  return {
    items: [...items.values()],
    cost,
    targetLevel
  }
}

function maxLevel(a: FidelityLevel, b: FidelityLevel): FidelityLevel {
  const order: FidelityLevel[] = ['L0', 'L1', 'L2', 'L3']
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!
}

/** 冻结计划为不可变 BuildDefinition */
export function freezeBuildDefinition(
  timeline: SemanticTimeline,
  edits: SemanticEdit[],
  plan: InvalidationPlan,
  versionHash: string
): BuildDefinition {
  const ids = edits.map((e) => e.id)
  return {
    id: buildId(timeline.id, ids),
    timelineId: timeline.id,
    timelineVersionHash: versionHash,
    editIds: ids,
    plan,
    frozenAt: new Date().toISOString()
  }
}

export function createEditId(kind: string, seed?: string): string {
  return editId(kind, seed)
}

/** 文档版本哈希（用于冻结） */
export function timelineVersionHash(timeline: SemanticTimeline): string {
  const payload = JSON.stringify({
    id: timeline.id,
    updatedAt: timeline.updatedAt,
    editIds: timeline.edits.map((e) => e.id),
    eventIds: timeline.events.map((e) => e.id),
    beatIds: timeline.beats.map((b) => b.id)
  })
  // 与 ids.shortHash 同算法，内联避免循环依赖观感
  let h = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
