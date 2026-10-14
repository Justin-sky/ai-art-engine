/**
 * 角色 / 实体的**局部替换**——纯函数（主进程、渲染进程、引擎共用）。
 *
 * 三件事分开管，互不污染：
 * - 换谁：各镜关键帧上点选 / 框选出的掩码（`EntityTargetMask`）；
 * - 换成什么：指令里 `@n` 引用的身份参考图（`EntityReplacementRef`）；
 * - 怎么换：指令文本。
 *
 * 原片帧只提供构图，**从不**当身份参考 —— 帧里有多个实体时，整帧当参考会让模型分不清谁是谁。
 * 同一镜换多个实体时按实体**逐个**重绘，每一遍只带该实体自己的参考图（见重建执行器）。
 */
import { normalizeProjectRelativePath } from '../mcpAssetWrite'
import { stableStringify } from './ids'
import type {
  Entity,
  EntityReplacement,
  EntityReplacementRef,
  EntityTargetMask,
  SemanticShot,
  SemanticTimeline
} from './types'

/** 单镜同时替换超过这个数就提示效果可能不稳定（不拦截） */
export const SOFT_MAX_REPLACEMENTS_PER_SHOT = 3
/** 同镜两个掩码外接框的重叠比例超过它就警告（以较小者面积为分母） */
export const MASK_OVERLAP_WARN_RATIO = 0.15

const MENTION_RE = /@(\d+)/g

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function safeRel(value: unknown, field: string): string {
  const rel = typeof value === 'string' ? normalizeProjectRelativePath(value) : null
  if (!rel) throw new Error(`${field} must be a project-relative path`)
  return rel
}

function unit(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/**
 * 实体当前生效的替换。旧文档只有 `reference.assetId` 时视作"只有一张参考图、没有掩码"，
 * 这样旧数据仍能走兜底的参考图生视频，第一次编辑时再迁移成 `replacement`。
 */
export function effectiveReplacement(
  entity: Entity | null | undefined
): EntityReplacement | undefined {
  if (!entity) return undefined
  if (entity.replacement) return entity.replacement
  const legacy = entity.reference?.assetId?.trim()
  return legacy ? { instruction: '', references: [{ assetId: legacy }], masks: [] } : undefined
}

/** 是否真的要换（有参考图或有指令；只有掩码没有内容不算） */
export function hasReplacementContent(rep: EntityReplacement | null | undefined): boolean {
  return !!rep && (arr(rep.references).length > 0 || !!rep.instruction?.trim())
}

/** 指令里引用到的 `@n`（去重、升序） */
export function replacementMentions(instruction: string): number[] {
  const out = new Set<number>()
  for (const m of (instruction ?? '').matchAll(MENTION_RE)) {
    const n = Number(m[1])
    if (Number.isInteger(n) && n > 0) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * 校验并规范化一份替换（`entity.replace` 用）。不合法就抛错：
 * 路径必须在工程内、掩码所在镜头必须存在、`@n` 不能超出参考图数量。
 * 同一镜的掩码只保留最后一份（重新点选 = 覆盖）。
 */
export function normalizeEntityReplacement(
  raw: unknown,
  doc: Pick<SemanticTimeline, 'shots'>
): EntityReplacement {
  if (!raw || typeof raw !== 'object') throw new Error('replacement must be an object')
  const input = raw as Record<string, unknown>
  const instruction = typeof input.instruction === 'string' ? input.instruction : ''

  const references: EntityReplacementRef[] = arr(input.references as unknown[]).map((item, i) => {
    const ref = (item ?? {}) as Record<string, unknown>
    const assetId = typeof ref.assetId === 'string' ? ref.assetId.trim() : ''
    const label = typeof ref.label === 'string' && ref.label.trim() ? ref.label.trim() : undefined
    if (assetId) return { assetId, ...(label ? { label } : {}) }
    const relativePath = safeRel(ref.relativePath, `references[${i}].relativePath`)
    return { relativePath, ...(label ? { label } : {}) }
  })

  const over = replacementMentions(instruction).filter((n) => n > references.length)
  if (over.length) {
    throw new Error(`instruction mentions @${over[0]} but only ${references.length} reference(s)`)
  }

  const shotIds = new Set(arr(doc.shots).map((s) => s.id))
  const byShot = new Map<string, EntityTargetMask>()
  arr(input.masks as unknown[]).forEach((item, i) => {
    const mask = (item ?? {}) as Record<string, unknown>
    const shotId = typeof mask.shotId === 'string' ? mask.shotId : ''
    if (!shotIds.has(shotId)) throw new Error(`masks[${i}].shotId is not a shot: ${shotId}`)
    const box = (mask.box ?? {}) as Record<string, unknown>
    const x = unit(box.x)
    const y = unit(box.y)
    const w = Math.min(unit(box.w), 1 - x)
    const h = Math.min(unit(box.h), 1 - y)
    if (w <= 0 || h <= 0) throw new Error(`masks[${i}].box is empty`)
    byShot.set(shotId, {
      shotId,
      keyframeRelativePath: safeRel(mask.keyframeRelativePath, `masks[${i}].keyframeRelativePath`),
      maskRelativePath: safeRel(mask.maskRelativePath, `masks[${i}].maskRelativePath`),
      box: { x, y, w, h },
      method: mask.method === 'rect' ? 'rect' : 'instance'
    })
  })

  return { instruction, references, masks: [...byShot.values()] }
}

function refKey(ref: EntityReplacementRef): string {
  return ref.assetId ? `asset:${ref.assetId}` : `path:${ref.relativePath ?? ''}`
}

/**
 * 本镜的替换指纹（进镜头指纹 → 脏检测）。
 * 只看会改变画面的内容：指令、参考图、**这一镜**的掩码；别的镜头的掩码变了不影响这一镜。
 * 没有 `replacement` 时返回 undefined —— 旧文档的镜头指纹保持不变。
 */
export function replacementSignatureForShot(entity: Entity, shotId: string): string | undefined {
  const rep = entity.replacement
  if (!rep) return undefined
  const mask = arr(rep.masks).find((m) => m.shotId === shotId)
  return stableStringify({
    i: rep.instruction?.trim() || undefined,
    r: arr(rep.references).map(refKey),
    m: mask ? `${mask.keyframeRelativePath}|${mask.maskRelativePath}` : undefined
  })
}

/** 一镜里要执行的一项替换（按实体列表顺序，即重绘顺序） */
export interface ShotReplacement {
  entityId: string
  entityName: string
  instruction: string
  references: EntityReplacementRef[]
  /** 没有掩码 = 这一镜没点选目标，只能走参考图生视频兜底 */
  mask?: EntityTargetMask
}

/**
 * 实体是否参与这一镜的替换：是本镜绑定的主体，或在这一镜点过掩码。
 * 与镜头指纹（`shotSignature`）的口径一致 —— 收集到的替换一定会让这一镜变脏，反之亦然。
 */
function entityInShot(entity: Entity, shot: SemanticShot): boolean {
  if (arr(shot.subjects).some((s) => s.entityId === entity.id)) return true
  return arr(entity.replacement?.masks).some((m) => m.shotId === shot.id)
}

/** 收集一镜的替换（有序、显式绑定），供提示词计划与重建使用 */
export function collectShotReplacements(
  doc: Pick<SemanticTimeline, 'entities'>,
  shot: SemanticShot
): ShotReplacement[] {
  const out: ShotReplacement[] = []
  for (const entity of arr(doc.entities)) {
    const rep = effectiveReplacement(entity)
    if (!hasReplacementContent(rep) || !entityInShot(entity, shot)) continue
    const mask = arr(rep!.masks).find((m) => m.shotId === shot.id)
    out.push({
      entityId: entity.id,
      entityName: entity.name,
      instruction: rep!.instruction ?? '',
      references: arr(rep!.references),
      ...(mask ? { mask } : {})
    })
  }
  return out
}

/** 两个归一化框的重叠比例（交集 / 较小者面积） */
export function maskBoxOverlap(a: EntityTargetMask['box'], b: EntityTargetMask['box']): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const smaller = Math.min(a.w * a.h, b.w * b.h)
  return smaller > 0 ? (ix * iy) / smaller : 0
}

/** 同镜里外接框重叠过多的实体对（提示用户：保护区会扣掉一部分，效果可能不理想） */
export function overlappingReplacements(
  items: ShotReplacement[]
): Array<{ a: string; b: string; ratio: number }> {
  const out: Array<{ a: string; b: string; ratio: number }> = []
  const masked = items.filter((r) => r.mask)
  for (let i = 0; i < masked.length; i += 1) {
    for (let j = i + 1; j < masked.length; j += 1) {
      const ratio = maskBoxOverlap(masked[i]!.mask!.box, masked[j]!.mask!.box)
      if (ratio > MASK_OVERLAP_WARN_RATIO) {
        out.push({ a: masked[i]!.entityName, b: masked[j]!.entityName, ratio })
      }
    }
  }
  return out
}

type Lang = 'zh' | 'en'

const REF_WORD: Record<Lang, (n: number) => string> = {
  zh: (n) => `参考图${n}`, // cjk-ok
  en: (n) => `reference image ${n}`
}

/** 把指令里的 `@n` 改写成发给模型时的图片编号（`offset` = 前面已占用的图片数） */
export function rewriteMentions(instruction: string, offset: number, lang: Lang): string {
  return (instruction ?? '').replace(MENTION_RE, (_m, n: string) =>
    REF_WORD[lang](Number(n) + offset)
  )
}

/**
 * 首帧局部重绘的提示词（单个实体一遍）。
 *
 * 图片顺序固定：1 = 挖空了目标区域的原帧，2 = 黑白掩码，3.. = **这个实体自己的**身份参考。
 * 没写指令时给一句默认的"换成参考图里的形象"。
 */
export function buildEntityRedrawPrompt(input: {
  entityName: string
  instruction: string
  referenceCount: number
}): string {
  const refs =
    input.referenceCount > 0
      ? Array.from({ length: input.referenceCount }, (_, i) => `image ${i + 3}`).join(', ')
      : ''
  const user = rewriteMentions(input.instruction, 2, 'en').trim()
  return [
    'Image 1 is a video frame with a transparent hole; image 2 is the black/white mask of that hole (white = replace).',
    `Replace only the masked subject "${input.entityName}"${refs ? ` with the person / object shown in ${refs}` : ''}.`,
    'Keep the original pose, position, scale, framing, lighting and camera angle; keep every unmasked pixel unchanged.',
    'Do not copy the background of the reference images; blend seamlessly; no text, borders or watermarks.',
    ...(user ? [`User request: ${user}`] : [])
  ].join(' ')
}

const VIDEO_NOTE: Record<Lang, (names: string) => string> = {
  zh: (names) => `首帧中的${names}已替换为新形象，保持原动作与走位`, // cjk-ok
  en: (names) =>
    `${names} in the first frame has been replaced; keep the original motion and blocking`
}

/** 首帧重绘之后给视频提示词追加的一句（不把重绘细节塞进 220 字的视频提示词） */
export function replacementVideoNote(names: string[], lang: Lang): string {
  return names.length ? VIDEO_NOTE[lang](names.join(lang === 'zh' ? '、' : ', ')) : ''
}

const LEGEND_PART: Record<Lang, (range: string, name: string) => string> = {
  zh: (range, name) => `参考图${range}：${name}`, // cjk-ok
  en: (range, name) => `reference image ${range}: ${name}`
}

/**
 * 兜底（参考图生视频）时的参考图编号说明：参考图按实体顺序排，提示词里写明谁是谁，
 * 修掉"多张参考图没有对应关系、模型对错号"的问题。
 */
export function referenceLegend(
  groups: Array<{ name: string; count: number }>,
  lang: Lang
): string {
  let next = 1
  const parts: string[] = []
  for (const group of groups) {
    if (group.count <= 0) continue
    const range = group.count === 1 ? `${next}` : `${next}-${next + group.count - 1}`
    parts.push(LEGEND_PART[lang](range, group.name))
    next += group.count
  }
  return parts.join(lang === 'zh' ? '；' : '; ')
}
