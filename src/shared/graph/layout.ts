import { getNodeSize } from './create'
import { getNodesBounds } from './groups'
import type { GraphEdge, GraphGroup, GraphNode } from './types'

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'
export type DistributeMode = 'horizontal' | 'vertical'

export const GRAPH_LAYOUT_GRID_STEP = 40
export const NOVEL_CHAPTERS_PER_ARC_ROW = 10
export const NOVEL_ARC_ROW_GAP = 84

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] // cjk-ok

function toChineseOrdinal(n: number): string {
  const num = Math.max(1, Math.floor(n))
  if (num < 10) return ZH_DIGITS[num]!
  if (num === 10) return '十' // cjk-ok
  if (num < 20) return `十${ZH_DIGITS[num % 10]!}` // cjk-ok
  if (num < 100) {
    const tens = Math.floor(num / 10)
    const ones = num % 10
    return `${ZH_DIGITS[tens]!}十${ones > 0 ? ZH_DIGITS[ones]! : ''}` // cjk-ok
  }
  return String(num)
}

export function formatNovelArcGroupTitle(
  arcNo: number,
  startChap: number,
  endChap: number
): string {
  return `第${toChineseOrdinal(arcNo)}幕（第${startChap}~${endChap}章）` // cjk-ok
}

export function resolveNovelChapterIndexForLayout(node: GraphNode): number | null {
  const title = (node.title ?? '').trim()
  const zhTitleMatch = title.match(/第\s*(\d{1,4})\s*[章节回]/) // cjk-ok
  if (zhTitleMatch) {
    const n = Number(zhTitleMatch[1])
    if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  }
  const enTitleMatch = title.match(/\b(?:ch|chap|chapter)\.?\s*(\d{1,4})\b/i)
  if (enTitleMatch) {
    const n = Number(enTitleMatch[1])
    if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  }
  const idMatch = (node.id ?? '').trim().match(/^chapter[_-]?(\d{1,4})$/i)
  if (idMatch) {
    const n = Number(idMatch[1])
    if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  }
  const curParam = Number(node.params?.novelCurrentChapter)
  if (Number.isFinite(curParam) && curParam >= 1) {
    return Math.floor(curParam)
  }
  const inst = String(node.params?.generateInstruction ?? '')
  const instMatch = inst.match(/撰写第\s*(\d{1,4})\s*章|第\s*(\d{1,4})\s*章完整正文/) // cjk-ok
  if (instMatch) {
    const n = Number(instMatch[1] ?? instMatch[2])
    if (Number.isFinite(n) && n >= 1) return Math.floor(n)
  }
  return null
}

export function isNovelChapterLayoutNode(node: GraphNode): boolean {
  if (node.typeId !== 'asset.novel') return false
  if (node.params?.novelNodeMode === 'outline') return false
  if (node.params?.novelNodeMode === 'chapter') return true
  return resolveNovelChapterIndexForLayout(node) !== null
}

/**
 * 按「每 10 章一幕」自动同步小说章节节点的画布分组（GraphGroup）。
 * 仅在存在 >= 2 个章节节点时启用，确保单节点连载模式不会产生多余分组框。
 */
export function syncNovelChapterArcGroups(
  nodes: GraphNode[],
  existingGroups?: GraphGroup[],
  options?: { chaptersPerArc?: number }
): GraphGroup[] {
  const chaptersPerArc = Math.max(1, options?.chaptersPerArc ?? NOVEL_CHAPTERS_PER_ARC_ROW)
  const chapterNodes = nodes.filter(isNovelChapterLayoutNode)
  const baseGroups = Array.isArray(existingGroups) ? existingGroups.map((g) => ({ ...g })) : []
  if (chapterNodes.length < 2) {
    return baseGroups
  }

  const sortedChapters = [...chapterNodes].sort((a, b) => {
    const ca = resolveNovelChapterIndexForLayout(a) ?? Infinity
    const cb = resolveNovelChapterIndexForLayout(b) ?? Infinity
    if (ca !== cb) return ca - cb
    if (a.position.y !== b.position.y) return a.position.y - b.position.y
    return a.position.x - b.position.x
  })

  const activeArcMap = new Map<number, GraphGroup>()
  const existingById = new Map(baseGroups.map((g) => [g.id, g]))

  for (let i = 0; i < sortedChapters.length; i++) {
    const node = sortedChapters[i]!
    const chapNum = resolveNovelChapterIndexForLayout(node) ?? i + 1
    const arcNo = Math.floor((chapNum - 1) / chaptersPerArc) + 1
    const startChap = (arcNo - 1) * chaptersPerArc + 1
    const endChap = arcNo * chaptersPerArc
    const groupId = `group-novel-arc-${arcNo}`
    if (!node.groupId || node.groupId.startsWith('group-novel-arc-')) {
      node.groupId = groupId
    }
    if (!activeArcMap.has(arcNo)) {
      const prev = existingById.get(groupId)
      activeArcMap.set(arcNo, {
        id: groupId,
        title: prev?.title?.trim() || formatNovelArcGroupTitle(arcNo, startChap, endChap)
      })
    }
  }

  const nonArcGroups = baseGroups.filter(
    (g) => !g.id.startsWith('group-novel-arc-') && nodes.some((n) => n.groupId === g.id)
  )
  const arcGroups = [...activeArcMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group)
  const nextGroups = [...nonArcGroups, ...arcGroups]

  if (Array.isArray(existingGroups)) {
    existingGroups.splice(0, existingGroups.length, ...nextGroups)
  }
  return nextGroups
}

/**
 * 将小说多章节点的放射状广播连线（outline / economy / numerical 直连所有章节）
 * 自动优化为「首章接入 + 逐章端口级联透传（out / out-outline / out-economy / out-numerical -> in / in-outline / in-economy / in-numerical）」。
 */
export function optimizeNovelChapterPassthroughEdges(
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphEdge[] {
  const chapterNodes = nodes.filter(isNovelChapterLayoutNode)
  if (chapterNodes.length < 2) return edges

  const sortedChapters = [...chapterNodes].sort((a, b) => {
    const ca = resolveNovelChapterIndexForLayout(a) ?? Infinity
    const cb = resolveNovelChapterIndexForLayout(b) ?? Infinity
    if (ca !== cb) return ca - cb
    if (a.position.y !== b.position.y) return a.position.y - b.position.y
    return a.position.x - b.position.x
  })

  const chapterIdSet = new Set(sortedChapters.map((n) => n.id))
  const headChap = sortedChapters[0]!
  const tailChapterIds = new Set(sortedChapters.slice(1).map((n) => n.id))

  const outlineNode =
    nodes.find((n) => n.typeId === 'novel.outline') ??
    nodes.find((n) => n.typeId === 'asset.novel' && n.params?.novelNodeMode === 'outline')
  const economyNode = nodes.find((n) => n.typeId === 'game.economy')
  const numericalNode = nodes.find((n) => n.typeId === 'game.numerical')

  if (!outlineNode && !economyNode && !numericalNode) return edges

  const broadcastSourceIds = new Set<string>(
    [outlineNode?.id, economyNode?.id, numericalNode?.id].filter((id): id is string => Boolean(id))
  )

  // 移除大纲/经济/数值节点向第 2..N 章的放射状直连边，以及章节间旧的重复边
  const keptEdges = edges.filter((e) => {
    if (broadcastSourceIds.has(e.source) && tailChapterIds.has(e.target)) {
      return false
    }
    if (chapterIdSet.has(e.source) && chapterIdSet.has(e.target)) {
      return false
    }
    return true
  })

  const seen = new Set(
    keptEdges.map(
      (e) => `${e.source}:${e.sourcePort ?? 'out'}->${e.target}:${e.targetPort ?? 'in'}`
    )
  )
  const addEdgeOnce = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string
  ): void => {
    const key = `${source}:${sourcePort}->${target}:${targetPort}`
    if (seen.has(key)) return
    seen.add(key)
    keptEdges.push({
      id: `edge-pass-${source}-${sourcePort}-${target}-${targetPort}`,
      source,
      sourcePort,
      target,
      targetPort
    })
  }

  if (outlineNode) {
    addEdgeOnce(outlineNode.id, 'out', headChap.id, 'in-outline')
  }
  if (economyNode) {
    addEdgeOnce(economyNode.id, 'out-text', headChap.id, 'in-economy')
  }
  if (numericalNode) {
    addEdgeOnce(numericalNode.id, 'out-text', headChap.id, 'in-numerical')
  }

  const chaptersPerRow = NOVEL_CHAPTERS_PER_ARC_ROW
  for (let i = 0; i < sortedChapters.length - 1; i++) {
    const prev = sortedChapters[i]!
    const next = sortedChapters[i + 1]!
    addEdgeOnce(prev.id, 'out', next.id, 'in')
    // 换行首章（如第11、21、31章）：大纲/经济/数值从正上方的上一幕首章（第1、11、21章）垂直向下透传，避免从行尾跨整行斜拉 3 条长线；同行内章节则从左侧相邻章水平平行透传
    const isNextRowStart = (i + 1) % chaptersPerRow === 0 && i + 1 >= chaptersPerRow
    const passSource = isNextRowStart ? sortedChapters[i + 1 - chaptersPerRow]! : prev
    if (outlineNode) {
      addEdgeOnce(passSource.id, 'out-outline', next.id, 'in-outline')
    }
    if (economyNode) {
      addEdgeOnce(passSource.id, 'out-economy', next.id, 'in-economy')
    }
    if (numericalNode) {
      addEdgeOnce(passSource.id, 'out-numerical', next.id, 'in-numerical')
    }
  }

  edges.splice(0, edges.length, ...keptEdges)
  return keptEdges
}

export function snapToGrid(value: number, step = GRAPH_LAYOUT_GRID_STEP): number {
  return Math.round(value / step) * step
}

export function snapPositionToGrid(
  position: { x: number; y: number },
  step = GRAPH_LAYOUT_GRID_STEP
): { x: number; y: number } {
  return {
    x: snapToGrid(position.x, step),
    y: snapToGrid(position.y, step)
  }
}

/** 对齐选中节点（至少 2 个） */
export function alignNodes(nodes: GraphNode[], mode: AlignMode): void {
  if (nodes.length < 2) return
  const items = nodes.map((node) => {
    const size = getNodeSize(node)
    return { node, w: size.w, h: size.h, x: node.position.x, y: node.position.y }
  })
  const left = Math.min(...items.map((item) => item.x))
  const right = Math.max(...items.map((item) => item.x + item.w))
  const top = Math.min(...items.map((item) => item.y))
  const bottom = Math.max(...items.map((item) => item.y + item.h))
  const midX = (left + right) / 2
  const midY = (top + bottom) / 2

  for (const item of items) {
    if (mode === 'left') item.node.position.x = left
    else if (mode === 'right') item.node.position.x = right - item.w
    else if (mode === 'top') item.node.position.y = top
    else if (mode === 'bottom') item.node.position.y = bottom - item.h
    else if (mode === 'centerX') item.node.position.x = midX - item.w / 2
    else if (mode === 'centerY') item.node.position.y = midY - item.h / 2
  }
}

/** 等距分布（至少 3 个）；按包围盒间隙均分 */
export function distributeNodes(nodes: GraphNode[], mode: DistributeMode): void {
  if (nodes.length < 3) return

  if (mode === 'horizontal') {
    const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x)
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    const firstW = getNodeSize(first).w
    const lastW = getNodeSize(last).w
    const start = first.position.x
    const end = last.position.x + lastW
    const middleWidth = sorted.slice(1, -1).reduce((sum, node) => sum + getNodeSize(node).w, 0)
    const free = end - start - firstW - middleWidth - lastW
    const gap = free / (sorted.length - 1)
    let x = start + firstW + gap
    for (let i = 1; i < sorted.length - 1; i++) {
      const node = sorted[i]!
      node.position.x = x
      x += getNodeSize(node).w + gap
    }
    return
  }

  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const firstH = getNodeSize(first).h
  const lastH = getNodeSize(last).h
  const start = first.position.y
  const end = last.position.y + lastH
  const middleHeight = sorted.slice(1, -1).reduce((sum, node) => sum + getNodeSize(node).h, 0)
  const free = end - start - firstH - middleHeight - lastH
  const gap = free / (sorted.length - 1)
  let y = start + firstH + gap
  for (let i = 1; i < sorted.length - 1; i++) {
    const node = sorted[i]!
    node.position.y = y
    y += getNodeSize(node).h + gap
  }
}

/**
 * 按连线拓扑做左→右分层自动布局。
 * 当存在 >= 2 个小说章节节点（asset.novel）时，自动将章节序列按每行 10 章（一幕）折行为二维矩阵，
 * 并同步生成「第N幕（第x~y章）」画布分组框（GraphGroup）。
 */
export function autoLayoutNodes(
  nodes: GraphNode[],
  edges: Pick<GraphEdge, 'source' | 'target'>[],
  options?: {
    columnGap?: number
    rowGap?: number
    novelChaptersPerRow?: number
    groups?: GraphGroup[]
  }
): void {
  if (nodes.length === 0) return
  if (nodes.length === 1) return

  const ids = new Set(nodes.map((node) => node.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const id of ids) {
    outgoing.set(id, [])
    indegree.set(id, 0)
  }

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    if (edge.source === edge.target) continue
    outgoing.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const layer = new Map<string, number>()
  const queue = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0)
  for (const id of queue) layer.set(id, 0)

  const remaining = new Map(indegree)
  const walk = [...queue]
  while (walk.length) {
    const id = walk.shift()!
    const current = layer.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, current + 1))
      const nextDegree = (remaining.get(next) ?? 1) - 1
      remaining.set(next, nextDegree)
      if (nextDegree === 0) walk.push(next)
    }
  }

  let maxLayer = 0
  for (const id of ids) {
    if (!layer.has(id)) layer.set(id, 0)
    maxLayer = Math.max(maxLayer, layer.get(id)!)
  }

  const columnGap = options?.columnGap ?? 96
  const rowGap = options?.rowGap ?? 56
  const origin = getNodesBounds(nodes, 0) ?? { x: 0, y: 0, w: 0, h: 0 }

  const chapterNodes = nodes.filter(isNovelChapterLayoutNode)
  if (chapterNodes.length >= 2) {
    const chaptersPerRow = Math.max(1, options?.novelChaptersPerRow ?? NOVEL_CHAPTERS_PER_ARC_ROW)
    const chapterIdSet = new Set(chapterNodes.map((n) => n.id))

    // BFS 找出位于章节节点下游的非章节节点；其余非章节节点视为上游基座节点（立项/角色/经济/数值/大纲）
    const downstreamNonChapterIds = new Set<string>()
    const bfsQueue = [...chapterIdSet]
    const visited = new Set<string>(chapterIdSet)
    while (bfsQueue.length > 0) {
      const curId = bfsQueue.shift()!
      for (const nextId of outgoing.get(curId) ?? []) {
        if (visited.has(nextId)) continue
        visited.add(nextId)
        if (!chapterIdSet.has(nextId)) {
          downstreamNonChapterIds.add(nextId)
        }
        bfsQueue.push(nextId)
      }
    }

    const upstreamColumns: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
    const downstreamColumns: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
    for (const id of ids) {
      if (chapterIdSet.has(id)) continue
      const l = layer.get(id) ?? 0
      if (downstreamNonChapterIds.has(id)) {
        downstreamColumns[l]!.push(id)
      } else {
        upstreamColumns[l]!.push(id)
      }
    }

    let x = origin.x
    for (const column of upstreamColumns) {
      if (column.length === 0) continue
      column.sort((a, b) => (byId.get(a)?.position.y ?? 0) - (byId.get(b)?.position.y ?? 0))
      let maxWidth = 0
      let y = origin.y
      for (const id of column) {
        const node = byId.get(id)
        if (!node) continue
        const size = getNodeSize(node)
        node.position.x = x
        node.position.y = y
        y += size.h + rowGap
        maxWidth = Math.max(maxWidth, size.w)
      }
      x += maxWidth + columnGap
    }

    // 章节节点按章号与拓扑序排列，并按每 10 章（一幕）折行为二维矩阵
    const sortedChapters = [...chapterNodes].sort((a, b) => {
      const ca = resolveNovelChapterIndexForLayout(a) ?? Infinity
      const cb = resolveNovelChapterIndexForLayout(b) ?? Infinity
      if (ca !== cb) return ca - cb
      const la = layer.get(a.id) ?? 0
      const lb = layer.get(b.id) ?? 0
      if (la !== lb) return la - lb
      if (a.position.y !== b.position.y) return a.position.y - b.position.y
      return a.position.x - b.position.x
    })

    const arcBuckets = new Map<number, GraphNode[]>()
    for (let i = 0; i < sortedChapters.length; i++) {
      const node = sortedChapters[i]!
      const chapNum = resolveNovelChapterIndexForLayout(node) ?? i + 1
      const arcNo = Math.floor((chapNum - 1) / chaptersPerRow) + 1
      let bucket = arcBuckets.get(arcNo)
      if (!bucket) {
        bucket = []
        arcBuckets.set(arcNo, bucket)
      }
      bucket.push(node)
    }

    const arcRows: GraphNode[][] = []
    for (const [, bucket] of [...arcBuckets.entries()].sort((a, b) => a[0] - b[0])) {
      for (let offset = 0; offset < bucket.length; offset += chaptersPerRow) {
        arcRows.push(bucket.slice(offset, offset + chaptersPerRow))
      }
    }

    const maxCols = Math.max(1, ...arcRows.map((row) => row.length))
    const colWidths = Array.from({ length: maxCols }, (_, colIdx) => {
      let w = 0
      for (const row of arcRows) {
        const node = row[colIdx]
        if (node) w = Math.max(w, getNodeSize(node).w)
      }
      return w || 260
    })

    const colX: number[] = []
    let cursorX = x
    for (let c = 0; c < maxCols; c++) {
      colX.push(cursorX)
      cursorX += colWidths[c]! + columnGap
    }

    const arcRowGap = Math.max(rowGap, NOVEL_ARC_ROW_GAP)
    let rowY = origin.y
    for (const row of arcRows) {
      let rowMaxH = 0
      for (let c = 0; c < row.length; c++) {
        const node = row[c]!
        const size = getNodeSize(node)
        node.position.x = colX[c]!
        node.position.y = rowY
        rowMaxH = Math.max(rowMaxH, size.h)
      }
      rowY += (rowMaxH || 180) + arcRowGap
    }

    x = cursorX

    for (const column of downstreamColumns) {
      if (column.length === 0) continue
      column.sort((a, b) => (byId.get(a)?.position.y ?? 0) - (byId.get(b)?.position.y ?? 0))
      let maxWidth = 0
      let y = origin.y
      for (const id of column) {
        const node = byId.get(id)
        if (!node) continue
        const size = getNodeSize(node)
        node.position.x = x
        node.position.y = y
        y += size.h + rowGap
        maxWidth = Math.max(maxWidth, size.w)
      }
      x += maxWidth + columnGap
    }

    syncNovelChapterArcGroups(nodes, options?.groups, { chaptersPerArc: chaptersPerRow })
    return
  }

  const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const id of ids) {
    columns[layer.get(id)!]!.push(id)
  }
  for (const column of columns) {
    column.sort((a, b) => (byId.get(a)?.position.y ?? 0) - (byId.get(b)?.position.y ?? 0))
  }

  let x = origin.x

  for (const column of columns) {
    let maxWidth = 0
    let y = origin.y
    for (const id of column) {
      const node = byId.get(id)
      if (!node) continue
      const size = getNodeSize(node)
      node.position.x = x
      node.position.y = y
      y += size.h + rowGap
      maxWidth = Math.max(maxWidth, size.w)
    }
    x += maxWidth + columnGap
  }
}
