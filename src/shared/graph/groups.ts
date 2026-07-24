import { getNodeSize, isNodeDeletable } from './create'
import type { GraphDocument, GraphGroup, GraphNode } from './types'

export const GRAPH_GROUP_PADDING = 14
/** 单次甩动所需最小速度（屏幕像素/秒） */
export const GROUP_EXIT_FLICK_SPEED = 520
/** 方向反转时两侧速度的最低要求 */
export const GROUP_EXIT_FLICK_REVERSAL_SPEED = 240
/** 脱离分组所需最少甩动次数 */
export const GROUP_EXIT_FLICK_MIN_COUNT = 2
const GROUP_DROP_IN_PADDING = 16
/** 组内自由移动时，在成员整体包围盒外扩的留白 */
const GROUP_STAY_PADDING = 24

function getGroupStayZone(
  members: GraphNode[]
): { x: number; y: number; w: number; h: number } | null {
  if (members.length === 0) return null
  const bounds = getNodesBounds(members, GRAPH_GROUP_PADDING)
  return bounds ? expandRect(bounds, GROUP_STAY_PADDING) : null
}

export function createGraphGroupId(): string {
  return `group-${crypto.randomUUID()}`
}

export function isNodeGroupable(node: GraphNode): boolean {
  return isNodeDeletable(node)
}

export function nodesInGroup(nodes: GraphNode[], groupId: string): GraphNode[] {
  return nodes.filter((node) => node.groupId === groupId)
}

export function getNodesBounds(
  nodes: GraphNode[],
  padding = GRAPH_GROUP_PADDING
): { x: number; y: number; w: number; h: number } | null {
  if (nodes.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const node of nodes) {
    const { w, h } = getNodeSize(node)
    left = Math.min(left, node.position.x)
    top = Math.min(top, node.position.y)
    right = Math.max(right, node.position.x + w)
    bottom = Math.max(bottom, node.position.y + h)
  }
  return {
    x: left - padding,
    y: top - padding,
    w: right - left + padding * 2,
    h: bottom - top + padding * 2
  }
}

export function getGroupBounds(
  nodes: GraphNode[],
  groupId: string,
  padding = GRAPH_GROUP_PADDING
): { x: number; y: number; w: number; h: number } | null {
  return getNodesBounds(nodesInGroup(nodes, groupId), padding)
}

function nodeBoundsRect(node: GraphNode): { x: number; y: number; w: number; h: number } {
  const { w, h } = getNodeSize(node)
  return { x: node.position.x, y: node.position.y, w, h }
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function expandRect(
  rect: { x: number; y: number; w: number; h: number },
  amount: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + amount * 2,
    h: rect.h + amount * 2
  }
}

/** 节点当前位置是否会脱离原分组（不含甩动判定）。 */
export function wouldLeaveCurrentGroup(
  document: GraphDocument,
  nodeId: string,
  dragStartPosition?: { x: number; y: number }
): boolean {
  const node = document.nodes.find((item) => item.id === nodeId)
  if (!node?.groupId || !dragStartPosition) return false
  const members = nodesInGroup(document.nodes, node.groupId)
  if (members.length <= 1) return false

  const referenceMembers = members.map((member) =>
    member.id === nodeId ? { ...member, position: { ...dragStartPosition } } : member
  )
  const stayZone = getGroupStayZone(referenceMembers)
  if (!stayZone) return false
  return !rectsOverlap(nodeBoundsRect(node), stayZone)
}

/** 根据节点与分组框重叠关系解析归属（拖入/拖出）。 */
export function resolveNodeGroupAfterMove(
  document: GraphDocument,
  nodeId: string,
  options?: { allowExit?: boolean }
): boolean {
  const node = document.nodes.find((item) => item.id === nodeId)
  if (!node || !isNodeGroupable(node)) return false
  const nodeRect = nodeBoundsRect(node)
  const previous = node.groupId

  if (previous && !options?.allowExit) {
    const members = nodesInGroup(document.nodes, previous)
    if (members.length <= 1) return false
    const stayZone = getGroupStayZone(members)
    if (stayZone && rectsOverlap(nodeRect, stayZone)) {
      return false
    }
  }

  let targetId: string | null = null
  let smallestArea = Infinity
  for (const group of document.groups ?? []) {
    if (group.id === previous) continue
    const members = document.nodes.filter(
      (item) => item.groupId === group.id && item.id !== nodeId
    )
    if (members.length === 0) continue
    const bounds = getNodesBounds(members, GRAPH_GROUP_PADDING)
    if (!bounds) continue
    const hit = expandRect(bounds, GROUP_DROP_IN_PADDING)
    if (!rectsOverlap(nodeRect, hit)) continue
    const area = bounds.w * bounds.h
    if (area < smallestArea) {
      smallestArea = area
      targetId = group.id
    }
  }

  if (targetId) node.groupId = targetId
  else delete node.groupId

  return previous !== node.groupId
}

export function sanitizeGraphGroups(document: GraphDocument): GraphGroup[] {
  const groups = Array.isArray(document.groups)
    ? document.groups.map((group) => ({ ...group }))
    : []
  const groupIds = new Set(groups.map((group) => group.id))
  for (const node of document.nodes) {
    if (node.groupId && !groupIds.has(node.groupId)) {
      delete node.groupId
    }
  }
  return groups.filter((group) => document.nodes.some((node) => node.groupId === group.id))
}

export function nextGraphGroupTitle(groups: GraphGroup[], fallback: string): string {
  const used = new Set(groups.map((group) => group.title?.trim()).filter(Boolean))
  if (!used.has(fallback)) return fallback
  let index = 2
  while (used.has(`${fallback} ${index}`)) index += 1
  return `${fallback} ${index}`
}
