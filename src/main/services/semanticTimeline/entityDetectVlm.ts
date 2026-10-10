/**
 * 关键帧 → **多模态大模型**抽实体（人 / 商品 / 物体 / 文字 / logo / 背景 / 声音）。
 *
 * 取代原先的本地 YOLO 检测 + IoU 跟踪（`entityDetect.ts` 已删除）：YOLO 只能给 COCO 标签与框，
 * 认不出「带货话术里的商品」「品牌 logo」「画面里的价格文字」这类**语义实体**，跨镜头身份也归并不了。
 * 代价是每次分析多一次视觉模型调用（由节点的 `semanticDetectEntities` 开关与富化模型选择控制）。
 *
 * 注意 `pixelEditable` 一律为 false：像素级替换需要框/掩码，而视觉模型给的框不足以为凭
 * （掩码走构建阶段的 SAM2 路径）。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { modelProviderFacade } from '../modelProviders/facade'
import { kindOfLabel } from '@shared/semanticTimeline'
import type { Entity, EntityKind, ShotEvidence } from '@shared/semanticTimeline'

/** 送进模型的关键帧上限：与镜头描述同量级，避免一次请求塞几十张图 */
export const MAX_ENTITY_KEYFRAMES = 12

const ENTITY_KINDS: ReadonlySet<string> = new Set<EntityKind>([
  'person',
  'product',
  'object',
  'text',
  'logo',
  'background',
  'voice'
])

const SYSTEM_PROMPT = [
  '你是视频语义标注员。根据镜头关键帧，列出画面中出现的**实体**（人物、商品、物体、画面文字/价格、品牌 logo、背景场景、声音主体）。', // cjk-ok
  '只输出 JSON 数组，每项含 name（画面里的称呼，用画面语言）、kind（person|product|object|text|logo|background|voice）、shots（出现该实体的镜头 id 数组，只能用给定 id）。', // cjk-ok
  '同一个实体在多个镜头出现时只输出一项，shots 里列出全部镜头。看不清或不确定的不要输出。不要输出解释文字。', // cjk-ok
  '',
  'You label video entities from shot keyframes. Output a JSON array only; each item: name, kind (person|product|object|text|logo|background|voice), shots (ids of shots where it appears, from the given list).',
  'Merge repeated appearances of the same entity into one item. Skip anything you are unsure about. No prose.'
].join('\n')

function slug(text: string): string {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 24) || 'entity'
}

interface RawEntity {
  name?: unknown
  kind?: unknown
  label?: unknown
  shots?: unknown
  shotId?: unknown
}

/**
 * 视觉模型的 JSON 文本 → `Entity[]`（**纯函数**，便于把解析/归并规则钉住）。
 *
 * 容忍常见偏差：`kind` 给了未知值就用 `kindOfLabel(label)` 兜；`shots` 给成单个字符串也认；
 * 认不出的镜头 id 直接丢弃（不能让证据指向不存在的镜头）；同名同类型跨镜头合并。
 */
export function entitiesFromVlmResponse(text: string, shots: ShotEvidence[]): Entity[] {
  const parsed = parseJsonArray(text)
  const byShot = new Map(shots.map((s) => [s.id, s]))
  const merged = new Map<string, { kind: EntityKind; name: string; shotIds: string[] }>()

  for (const raw of parsed) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) continue
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const kindRaw = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : ''
    const kind: EntityKind = ENTITY_KINDS.has(kindRaw)
      ? (kindRaw as EntityKind)
      : kindOfLabel(label || name)
    const shotField = raw.shots ?? raw.shotId
    const shotIds = (Array.isArray(shotField) ? shotField : [shotField])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((id) => id && byShot.has(id))
    if (shotIds.length === 0) continue

    const key = `${kind}::${name.toLowerCase()}`
    const entry = merged.get(key) ?? { kind, name, shotIds: [] }
    for (const id of shotIds) if (!entry.shotIds.includes(id)) entry.shotIds.push(id)
    merged.set(key, entry)
  }

  const usedIds = new Set<string>()
  const entities: Entity[] = []
  for (const entry of merged.values()) {
    entities.push({
      id: uniqueId(`ent.${entry.kind}.${slug(entry.name)}`, usedIds),
      kind: entry.kind,
      name: entry.name,
      appearances: entry.shotIds
        .map((id) => byShot.get(id))
        .filter((shot): shot is ShotEvidence => Boolean(shot))
        .map((shot) => ({ shotId: shot.id, range: shot.range })),
      // 视觉模型不给框/掩码，不能声称可做像素级替换（掩码走构建阶段 SAM2）
      pixelEditable: false
    })
  }
  return entities
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

function parseJsonArray(text: string): RawEntity[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const candidates: string[] = [trimmed]
  // 模型爱套 ```json 围栏或前后加解释 → 抠出第一个数组
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (Array.isArray(parsed))
        return parsed.filter((x): x is RawEntity => !!x && typeof x === 'object')
    } catch {
      /* 试下一个 */
    }
  }
  return []
}

function keyframeAbs(
  projectRoot: string,
  timelineId: string,
  rel: string | undefined
): string | null {
  if (!rel) return null
  const abs = join(projectRoot, 'Semantic', timelineId, ...rel.split('/'))
  return existsSync(abs) ? abs : null
}

/**
 * 对每个镜头取中帧（缺省首帧）送视觉模型，抽实体。
 *
 * 模型/实例可指定（节点上的富化模型选择）；不指定就用应用默认文本模型。
 */
export async function detectEntitiesViaVisionModel(input: {
  projectRoot: string
  timelineId: string
  shots: ShotEvidence[]
  /** 权威的 shotId → 关键帧相对路径映射；缺省回落到每个 shot 自带的 keyframes */
  keyframes?: Record<string, string>
  model?: string
  providerInstanceId?: string
}): Promise<{ entities: Entity[]; notes: string[]; imageCount: number }> {
  const notes: string[] = []
  const images: string[] = []
  const usedShots: ShotEvidence[] = []
  for (const shot of input.shots) {
    if (images.length >= MAX_ENTITY_KEYFRAMES) break
    const rel = input.keyframes?.[shot.id] ?? shot.keyframes?.middle ?? shot.keyframes?.first
    const abs = keyframeAbs(input.projectRoot, input.timelineId, rel)
    if (!abs) continue
    images.push(abs)
    usedShots.push(shot)
  }
  if (images.length === 0) {
    notes.push('entity detect: no keyframes available')
    return { entities: [], notes, imageCount: 0 }
  }

  const res = await modelProviderFacade.generateText({
    system: SYSTEM_PROMPT,
    prompt: [
      'Images are in this order (one keyframe per shot):',
      ...usedShots.map(
        (s, i) => `${i + 1}. ${s.id} ${s.range.start.toFixed(2)}-${s.range.end.toFixed(2)}s`
      ),
      'Use only the shot ids above in "shots".'
    ].join('\n'),
    images,
    model: input.model?.trim() || undefined,
    providerInstanceId: input.providerInstanceId?.trim() || undefined
  })
  const entities = entitiesFromVlmResponse(res.text, usedShots)
  return { entities, notes, imageCount: images.length }
}
