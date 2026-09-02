/**
 * Orchestrator 草稿表单的撤销/重做栈：以「goal / jobTitle / nodes 整份快照」为最小撤销单位，
 * 供编排表单的离散编辑（增删节点、连线增删、一键修复、智能拆解写回、清空）与字段提交（blur）入栈。
 *
 * 纯函数、无 Vue 依赖：方便单测与复用。快照一律浅复制 + 数组复制，调用方保证传入的是普通值对象。
 */

/** 编排节点草稿（与 OrchestratorRunInput.nodes 形状一致的纯值形态） */
export interface DraftNode {
  id: string
  agentId: string
  instruction: string
  dependsOn: string[]
}

/** 一份可整体回滚的表单快照 */
export interface DraftSnapshot {
  goal: string
  jobTitle: string
  nodes: DraftNode[]
}

/** 撤销栈的历史容量：超出时丢弃最旧快照 */
export const DRAFT_HISTORY_LIMIT = 50

export interface DraftHistory {
  past: DraftSnapshot[]
  future: DraftSnapshot[]
}

export function createDraftHistory(): DraftHistory {
  return { past: [], future: [] }
}

/** 深度比较两份快照（字段少、规模小，直接逐项比较） */
export function equalsDraftSnapshot(a: DraftSnapshot, b: DraftSnapshot): boolean {
  if (a.goal !== b.goal || a.jobTitle !== b.jobTitle) return false
  if (a.nodes.length !== b.nodes.length) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    const na = a.nodes[i]
    const nb = b.nodes[i]
    if (na.id !== nb.id || na.agentId !== nb.agentId || na.instruction !== nb.instruction) {
      return false
    }
    if (na.dependsOn.length !== nb.dependsOn.length) return false
    for (let j = 0; j < na.dependsOn.length; j += 1) {
      if (na.dependsOn[j] !== nb.dependsOn[j]) return false
    }
  }
  return true
}

/**
 * 记录一次编辑：把「编辑前的当前快照」压入 past 并清空 future（新分支）。
 * 与栈顶重复时不重复入栈（避免同一状态多次入栈导致撤销空转）。
 */
export function pushDraftHistory(h: DraftHistory, current: DraftSnapshot): DraftHistory {
  const top = h.past[h.past.length - 1]
  if (top && equalsDraftSnapshot(top, current)) return h
  const past = [...h.past, current]
  if (past.length > DRAFT_HISTORY_LIMIT) past.splice(0, past.length - DRAFT_HISTORY_LIMIT)
  return { past, future: [] }
}

/** 撤销：恢复到 past 栈顶快照，当前状态转入 future */
export function draftUndo(
  h: DraftHistory,
  current: DraftSnapshot
): { history: DraftHistory; snapshot: DraftSnapshot } | null {
  if (!h.past.length) return null
  const snapshot = h.past[h.past.length - 1]
  const past = h.past.slice(0, -1)
  const future = [...h.future, current]
  return { history: { past, future }, snapshot }
}

/** 重做：恢复到 future 栈顶快照，当前状态压回 past */
export function draftRedo(
  h: DraftHistory,
  current: DraftSnapshot
): { history: DraftHistory; snapshot: DraftSnapshot } | null {
  if (!h.future.length) return null
  const snapshot = h.future[h.future.length - 1]
  const future = h.future.slice(0, -1)
  const past = [...h.past, current]
  return { history: { past, future }, snapshot }
}
