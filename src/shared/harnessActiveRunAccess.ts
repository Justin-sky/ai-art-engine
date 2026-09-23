/**
 * 常驻 harness 回合的 MCP 授权视图：优先于 sticky request headers。
 * 主进程 set/clear；单测可直接驱动。
 */
import type { ChatMode } from './ipc'
import type { McpAccessView } from './mcpModeAccess'

export type HarnessRunAccessState = { mode: ChatMode; confirmed: boolean }

let activeHarnessRun: { runId: string; mode: ChatMode } | null = null

export function getActiveHarnessRun(): { runId: string; mode: ChatMode } | null {
  return activeHarnessRun
}

export function setActiveHarnessRunState(runId: string, mode: ChatMode): void {
  activeHarnessRun = { runId: String(runId), mode }
}

export function clearActiveHarnessRunState(): void {
  activeHarnessRun = null
}

/**
 * 授权视图：有 active harness 回合时用其 mode + Map 里的 confirmed；
 * 否则回退请求头（外部 Agent / 旧 one-shot headers）。
 */
export function resolveHarnessAwareAccessView(
  ctx: { mode?: ChatMode; runId?: string } | undefined,
  harnessRunAccess: ReadonlyMap<string, HarnessRunAccessState>
): McpAccessView {
  if (activeHarnessRun) {
    const state = harnessRunAccess.get(activeHarnessRun.runId)
    return { mode: activeHarnessRun.mode, confirmed: state?.confirmed ?? false }
  }
  if (!ctx?.mode) return {}
  const state = ctx.runId ? harnessRunAccess.get(ctx.runId) : undefined
  return { mode: ctx.mode, confirmed: state?.confirmed ?? false }
}
