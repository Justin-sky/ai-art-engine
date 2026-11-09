import { reactive } from 'vue'

export interface WishShrineChatBridgeState {
  running: boolean
  sessionId: string
  sessionTitle: string
  promptText: string
  activityText: string
  outcome: 'idle' | 'success' | 'error'
}

export const wishShrineChatBridge = reactive<WishShrineChatBridgeState>({
  running: false,
  sessionId: '',
  sessionTitle: '',
  promptText: '',
  activityText: '',
  outcome: 'idle'
})

let watchdogTimer: number | null = null
let runningStartedAt = 0
let consecutiveIdlePolls = 0

function stopWishShrineWatchdog(): void {
  if (watchdogTimer !== null && typeof window !== 'undefined') {
    window.clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  consecutiveIdlePolls = 0
}

function startWishShrineWatchdog(): void {
  if (typeof window === 'undefined' || watchdogTimer !== null) return
  runningStartedAt = Date.now()
  consecutiveIdlePolls = 0
  watchdogTimer = window.setInterval(async () => {
    if (!wishShrineChatBridge.running) {
      stopWishShrineWatchdog()
      return
    }
    // 预留启动准备窗口（3.5s），避免 runTask 预检阶段误判
    if (Date.now() - runningStartedAt < 3500) return
    try {
      const getStatus = (
        window as Window & {
          studio?: { getHarnessStatus?: () => Promise<{ running?: boolean }> }
        }
      ).studio?.getHarnessStatus
      if (typeof getStatus !== 'function') return
      const status = await getStatus()
      if (status && status.running === false) {
        consecutiveIdlePolls += 1
        if (consecutiveIdlePolls >= 2) {
          wishShrineChatBridge.running = false
          if (wishShrineChatBridge.outcome === 'idle') {
            wishShrineChatBridge.outcome = 'success'
          }
          stopWishShrineWatchdog()
        }
      } else {
        consecutiveIdlePolls = 0
      }
    } catch {
      /* ignore */
    }
  }, 2000)
}

export function syncWishShrineChatBridge(patch: Partial<WishShrineChatBridgeState>): void {
  if (patch.running !== undefined) {
    wishShrineChatBridge.running = patch.running
    if (patch.running) {
      startWishShrineWatchdog()
    } else {
      stopWishShrineWatchdog()
    }
  }
  if (patch.sessionId !== undefined) wishShrineChatBridge.sessionId = patch.sessionId
  if (patch.sessionTitle !== undefined) wishShrineChatBridge.sessionTitle = patch.sessionTitle
  if (patch.promptText !== undefined) wishShrineChatBridge.promptText = patch.promptText
  if (patch.activityText !== undefined) wishShrineChatBridge.activityText = patch.activityText
  if (patch.outcome !== undefined) wishShrineChatBridge.outcome = patch.outcome
}
