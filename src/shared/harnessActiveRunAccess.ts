/**
 * 常驻 harness 回合的 MCP 授权视图：优先于 sticky request headers。
 * 主进程 set/clear；单测可直接驱动。
 */
import type { ChatMode } from './ipc'
import type { McpAccessView } from './mcpModeAccess'

export type HarnessRunAccessState = { mode: ChatMode; confirmed: boolean }

export interface WorkerSlotHarnessRunState {
  slotId: string
  runId: string
  mode: ChatMode
  sessionId?: string
  workspace?: string
}

let activeHarnessRun: { runId: string; mode: ChatMode; sessionId?: string } | null = null
const workerSlotRuns = new Map<string, WorkerSlotHarnessRunState>()

export function getActiveHarnessRun(): {
  runId: string
  mode: ChatMode
  sessionId?: string
} | null {
  return activeHarnessRun
}

export function setActiveHarnessRunState(runId: string, mode: ChatMode, sessionId?: string): void {
  activeHarnessRun = {
    runId: String(runId),
    mode,
    ...(sessionId ? { sessionId } : {})
  }
}

export function clearActiveHarnessRunState(): void {
  activeHarnessRun = null
}

export function setWorkerSlotHarnessRunState(
  slotId: string,
  state: { runId: string; mode: ChatMode; sessionId?: string; workspace?: string }
): void {
  const normalizedSlot = String(slotId || '').trim()
  if (!normalizedSlot) return
  workerSlotRuns.set(normalizedSlot, {
    slotId: normalizedSlot,
    runId: String(state.runId),
    mode: state.mode,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.workspace ? { workspace: state.workspace } : {})
  })
}

export function clearWorkerSlotHarnessRunState(slotId: string): void {
  const normalizedSlot = String(slotId || '').trim()
  if (!normalizedSlot) return
  workerSlotRuns.delete(normalizedSlot)
}

export function clearAllWorkerSlotHarnessRunStates(): void {
  workerSlotRuns.clear()
}

export function getWorkerSlotHarnessRunState(
  slotId: string
): WorkerSlotHarnessRunState | undefined {
  const normalizedSlot = String(slotId || '').trim()
  if (!normalizedSlot) return undefined
  return workerSlotRuns.get(normalizedSlot)
}

/**
 * 根据请求上下文解析所属的活跃 Harness 运行记录（用于归属 sessionId / runId / mode）。
 * 多会话并行时优先按 `workerSlot` 精确匹配对应 worker 槽位。
 */
export function resolveHarnessRunForContext(ctx?: {
  mode?: ChatMode
  runId?: string
  workerSlot?: string
}): { runId: string; mode: ChatMode; sessionId?: string; workspace?: string } | null {
  const slotKey = typeof ctx?.workerSlot === 'string' ? ctx.workerSlot.trim() : ''
  if (slotKey) {
    return workerSlotRuns.get(slotKey) ?? null
  }
  return activeHarnessRun
}

/**
 * 授权视图：
 * 1. 若携带 `workerSlot`，严格按该 worker 槽位当前运行态解析（空闲预热列工具时回退其自身 headers，绝不串用其他并行会话的 Ask/Plan 锁）；
 * 2. 未携带 `workerSlot` 时，若有单实例 active harness 回合则用其 mode + Map 里的 confirmed；
 * 3. 否则回退请求头（外部 Agent / 旧 one-shot headers）。
 */
export function resolveHarnessAwareAccessView(
  ctx: { mode?: ChatMode; runId?: string; workerSlot?: string } | undefined,
  harnessRunAccess: ReadonlyMap<string, HarnessRunAccessState>
): McpAccessView {
  const slotKey = typeof ctx?.workerSlot === 'string' ? ctx.workerSlot.trim() : ''
  if (slotKey) {
    const slotRun = workerSlotRuns.get(slotKey)
    if (slotRun) {
      const state = harnessRunAccess.get(slotRun.runId)
      return { mode: slotRun.mode, confirmed: state?.confirmed ?? false }
    }
    if (!ctx?.mode) return {}
    const state = ctx.runId ? harnessRunAccess.get(ctx.runId) : undefined
    return { mode: ctx.mode, confirmed: state?.confirmed ?? false }
  }
  if (activeHarnessRun) {
    const state = harnessRunAccess.get(activeHarnessRun.runId)
    return { mode: activeHarnessRun.mode, confirmed: state?.confirmed ?? false }
  }
  if (!ctx?.mode) return {}
  const state = ctx.runId ? harnessRunAccess.get(ctx.runId) : undefined
  return { mode: ctx.mode, confirmed: state?.confirmed ?? false }
}
