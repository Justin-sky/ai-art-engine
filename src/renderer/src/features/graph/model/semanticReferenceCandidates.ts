/**
 * 实体替换的参考图候选（指令框 `@` 的菜单）：**只来自**语义分析节点「参考图」端口上游的图片
 *（图流进来的新形象），不列资产库 —— 换什么形象由图上的连线决定。
 *
 * 纯函数：只做"从值 / 节点里抽出可引用的图片"，不碰 store / DOM，便于单测。
 */
import type { EntityReplacementRef } from '@shared/semanticTimeline'
import type { GraphNode } from '@shared/graph/types'
import type { GraphNodeRunState, GraphValue } from '@shared/graph/execute/types'

export interface ReferenceCandidate {
  /** 去重键（asset:… / path:… / data:<节点>#<序号>） */
  key: string
  label: string
  origin: 'port' | 'asset'
  /** 已落盘的引用；只有 data URL（未落盘的生成图）时为 null，选中时再落盘 */
  ref: EntityReplacementRef | null
  /** 未落盘图片的 data URL（选中时据此落盘） */
  dataUrl?: string
  /** 缩略图来源（工程相对路径）；data URL 候选直接用 dataUrl */
  thumbRelativePath?: string
}

const IMAGE_PATH_RE = /\.(png|jpe?g|webp|gif|bmp)$/i

function fromItem(
  item: { id?: string; dataUrl?: string; relativePath?: string; assetId?: string },
  label: string,
  fallbackKey: string
): ReferenceCandidate | null {
  const assetId = item.assetId?.trim()
  if (assetId) {
    return {
      key: `asset:${assetId}`,
      label,
      origin: 'port',
      ref: { assetId, label },
      ...(item.relativePath ? { thumbRelativePath: item.relativePath } : {})
    }
  }
  const rel = item.relativePath?.trim().replace(/\\/g, '/')
  if (rel) {
    return {
      key: `path:${rel}`,
      label,
      origin: 'port',
      ref: { relativePath: rel, label },
      thumbRelativePath: rel
    }
  }
  const dataUrl = item.dataUrl?.trim()
  if (dataUrl?.startsWith('data:image')) {
    return { key: `data:${fallbackKey}`, label, origin: 'port', ref: null, dataUrl }
  }
  return null
}

/** 一个端口值里能当参考图的图片（图片 / 图片组 / 图片资产 / 输出节点里的图片） */
export function candidatesFromValue(
  value: GraphValue | undefined,
  label: string,
  keyPrefix: string
): ReferenceCandidate[] {
  if (!value) return []
  const out: ReferenceCandidate[] = []
  const push = (c: ReferenceCandidate | null) => {
    if (c) out.push(c)
  }
  switch (value.kind) {
    case 'image':
      push(fromItem(value, label, `${keyPrefix}#0`))
      break
    case 'images':
      value.items.forEach((item, i) =>
        push(fromItem(item, item.title || `${label} ${i + 1}`, `${keyPrefix}#${i}`))
      )
      break
    case 'asset':
      if (value.assetType === 'image') {
        push(
          fromItem(
            { assetId: value.assetId, relativePath: value.relativePath },
            value.label || label,
            keyPrefix
          )
        )
      }
      break
    case 'output':
      value.items
        .filter((item) => item.assetType === 'image')
        .forEach((item, i) =>
          push(
            fromItem(
              { assetId: item.assetId, relativePath: item.relativePath },
              item.label || `${label} ${i + 1}`,
              `${keyPrefix}#${i}`
            )
          )
        )
      break
    default:
      break
  }
  return out
}

/**
 * 上游节点能给出的图片：优先运行输出（端口对应的出口），没有运行过就看节点自身
 * （图片资产节点 / 选中的生成图 / 预览路径）。
 */
export function candidatesFromSourceNode(
  source: GraphNode,
  runState: GraphNodeRunState | null | undefined,
  sourcePort: string | undefined
): ReferenceCandidate[] {
  const label = source.title?.trim() || source.id
  const outputs = runState?.outputs ?? {}
  const fromRun = candidatesFromValue(outputs[sourcePort || 'out'], label, source.id)
  if (fromRun.length) return fromRun
  if (source.assetId && (source.assetType === 'image' || !source.assetType)) {
    return [
      {
        key: `asset:${source.assetId}`,
        label,
        origin: 'port',
        ref: { assetId: source.assetId, label }
      }
    ]
  }
  const images = source.params?.generatedImages
  if (Array.isArray(images) && images.length) {
    const selectedId = source.params?.selectedImageId?.trim()
    const item =
      (selectedId ? images.find((row) => row.id === selectedId) : undefined) ??
      images[images.length - 1]
    const c = item ? fromItem(item, label, `${source.id}#sel`) : null
    if (c) return [c]
  }
  const preview = source.params?.previewRelativePath?.trim().replace(/\\/g, '/')
  if (preview && IMAGE_PATH_RE.test(preview)) {
    return [
      {
        key: `path:${preview}`,
        label,
        origin: 'port',
        ref: { relativePath: preview, label },
        thumbRelativePath: preview
      }
    ]
  }
  return []
}

/** 合并候选（去重，端口上的排前面） */
export function mergeCandidates(...lists: ReferenceCandidate[][]): ReferenceCandidate[] {
  const seen = new Set<string>()
  const out: ReferenceCandidate[] = []
  for (const list of lists) {
    for (const c of list) {
      if (seen.has(c.key)) continue
      seen.add(c.key)
      out.push(c)
    }
  }
  return out
}

/** 已引用的参考图 → 候选键（让菜单与已选列表用同一套键） */
export function refKey(ref: EntityReplacementRef): string {
  return ref.assetId ? `asset:${ref.assetId}` : `path:${ref.relativePath ?? ''}`
}

/** 已引用的参考图转成候选（显示用；ref 原样保留） */
export function candidateFromRef(
  ref: EntityReplacementRef,
  fallbackLabel: string
): ReferenceCandidate {
  return {
    key: refKey(ref),
    label: ref.label || fallbackLabel,
    origin: ref.assetId ? 'asset' : 'port',
    ref,
    ...(ref.relativePath ? { thumbRelativePath: ref.relativePath } : {})
  }
}

/**
 * `@` 菜单：**已引用的排最前**（编号 = 它们在 references 里的序号，文本里的 `@n` 始终对得上），
 * 其余候选依次往后编号。
 */
export function buildMentionMenu(
  current: EntityReplacementRef[],
  candidates: ReferenceCandidate[],
  fallbackLabel: (n: number) => string
): ReferenceCandidate[] {
  return mergeCandidates(
    current.map((ref, i) => candidateFromRef(ref, fallbackLabel(i + 1))),
    candidates
  )
}

const MENTION_RE = /@(\d+)/g

/**
 * 指令提交时，把文本里的 `@n`（按菜单编号）落成参考图列表，并把编号**压实**成 1..k：
 * - 文本里没有任何 `@`：保留原来的参考图（只改了措辞）；
 * - 有 `@`：参考图 = 被引用的那些（按首次出现顺序），没被引用的去掉；
 * - 引用了菜单里不存在的编号：原样保留该 token（不吞用户的字），不加参考图。
 */
export function resolveInstructionReferences(
  instruction: string,
  menu: ReferenceCandidate[],
  current: EntityReplacementRef[]
): { instruction: string; picks: ReferenceCandidate[] } {
  const text = instruction ?? ''
  const mentioned = [...text.matchAll(MENTION_RE)].map((m) => Number(m[1]))
  if (mentioned.length === 0) {
    return {
      instruction: text,
      picks: current.map((ref, i) => candidateFromRef(ref, `@${i + 1}`))
    }
  }
  const picks: ReferenceCandidate[] = []
  const renumber = new Map<number, number>()
  for (const n of mentioned) {
    if (renumber.has(n)) continue
    const candidate = menu[n - 1]
    if (!candidate) continue
    const existing = picks.findIndex((p) => p.key === candidate.key)
    if (existing >= 0) {
      renumber.set(n, existing + 1)
      continue
    }
    picks.push(candidate)
    renumber.set(n, picks.length)
  }
  return {
    instruction: text.replace(MENTION_RE, (token, raw: string) => {
      const next = renumber.get(Number(raw))
      return next ? `@${next}` : token
    }),
    picks
  }
}
