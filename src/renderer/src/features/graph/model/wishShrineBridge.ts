import { reactive } from 'vue'

export interface WishShrineSessionEntry {
  sessionId: string
  sessionTitle: string
  promptText: string
  activityText: string
  running: boolean
  startedAt: number
  updatedAt: number
  outcome: 'idle' | 'success' | 'error'
}

export interface WishShrineCompanionView {
  sessionId: string
  sessionTitle: string
  promptText: string
}

export interface WishShrineMilestoneEvent {
  seq: number
  sessionId: string
  sessionTitle: string
  outcome: 'success' | 'error'
  remainingCount: number
  at: number
}

export interface WishShrineChatBridgeState {
  running: boolean
  sessionId: string
  sessionTitle: string
  promptText: string
  activityText: string
  outcome: 'idle' | 'success' | 'error'
  focusedSessionId: string
  activeCount: number
  waveCompletedCount: number
  waveHadSuccess: boolean
  companionSessions: WishShrineCompanionView[]
  latestMilestone: WishShrineMilestoneEvent | null
}

const sessionRegistry = reactive(new Map<string, WishShrineSessionEntry>())

let milestoneSeq = 0
let startOrderSeq = 0

export const wishShrineChatBridge = reactive<WishShrineChatBridgeState>({
  running: false,
  sessionId: '',
  sessionTitle: '',
  promptText: '',
  activityText: '',
  outcome: 'idle',
  focusedSessionId: '',
  activeCount: 0,
  waveCompletedCount: 0,
  waveHadSuccess: false,
  companionSessions: [],
  latestMilestone: null
})

function recomputeBridgeView(): void {
  const runningEntries: WishShrineSessionEntry[] = []
  for (const entry of sessionRegistry.values()) {
    if (entry.running) {
      runningEntries.push(entry)
    }
  }
  // 按启动先后排序（最新启动的排前，便于兜底接力）
  runningEntries.sort((a, b) => b.startedAt - a.startedAt)

  const wasRunning = wishShrineChatBridge.running
  const isNowRunning = runningEntries.length > 0
  wishShrineChatBridge.activeCount = runningEntries.length
  wishShrineChatBridge.running = isNowRunning

  const focusedId = wishShrineChatBridge.focusedSessionId.trim()
  const focusedEntry = focusedId ? sessionRegistry.get(focusedId) : undefined

  if (isNowRunning) {
    // 领衔仙子优先级：
    // 1. 当前前台选中的会话本身正在运行 → 由当前查看会话的仙子领衔；
    // 2. 当前前台会话空闲（例如刚新建空白会话准备输入，或前台会话已先跑完），但后台仍有会话在跑 → 自动接力给后台仍在运行的会话，绝不提前退场！
    const lead = (focusedEntry?.running ? focusedEntry : undefined) ?? runningEntries[0]!
    wishShrineChatBridge.sessionId = lead.sessionId
    wishShrineChatBridge.sessionTitle = lead.sessionTitle
    wishShrineChatBridge.promptText = lead.promptText
    wishShrineChatBridge.activityText = lead.activityText
    wishShrineChatBridge.outcome = 'idle'
    wishShrineChatBridge.companionSessions = runningEntries
      .filter((e) => e.sessionId !== lead.sessionId)
      .slice(0, 4)
      .map((e) => ({
        sessionId: e.sessionId,
        sessionTitle: e.sessionTitle,
        promptText: e.promptText
      }))
    return
  }

  wishShrineChatBridge.companionSessions = []
  if (wasRunning && !isNowRunning) {
    // 本波并行任务全部收官：保留最后一位收官会话的人设做谢幕动画
    return
  }

  if (focusedEntry) {
    wishShrineChatBridge.sessionId = focusedEntry.sessionId
    wishShrineChatBridge.sessionTitle = focusedEntry.sessionTitle
    wishShrineChatBridge.promptText = focusedEntry.promptText
    wishShrineChatBridge.activityText = focusedEntry.activityText
  }
}

/**
 * 登记某个会话开始执行（支持最多 6 路会话并发同屏祈福）。
 */
export function startWishShrineSession(input: {
  sessionId: string
  sessionTitle?: string
  promptText?: string
  activityText?: string
}): void {
  const sid = (input.sessionId ?? '').trim()
  if (!sid) return
  if (!wishShrineChatBridge.running) {
    // 新一波祈福周期开启：重置本波累计完成数
    wishShrineChatBridge.waveCompletedCount = 0
    wishShrineChatBridge.waveHadSuccess = false
    wishShrineChatBridge.latestMilestone = null
  }
  const prev = sessionRegistry.get(sid)
  const now = Date.now() + ++startOrderSeq * 0.001
  sessionRegistry.set(sid, {
    sessionId: sid,
    sessionTitle: input.sessionTitle ?? prev?.sessionTitle ?? '',
    promptText: input.promptText ?? prev?.promptText ?? '',
    activityText: input.activityText ?? prev?.activityText ?? '',
    running: true,
    startedAt: prev?.running ? prev.startedAt : now,
    updatedAt: Date.now(),
    outcome: 'idle'
  })
  recomputeBridgeView()
}

/**
 * 更新指定会话的标题、提示词或实时活动文案。
 */
export function updateWishShrineSession(
  sessionId: string,
  patch: Partial<
    Pick<WishShrineSessionEntry, 'sessionTitle' | 'promptText' | 'activityText' | 'outcome'>
  >
): void {
  const sid = (sessionId ?? '').trim()
  if (!sid) return
  const prev = sessionRegistry.get(sid)
  if (!prev) {
    sessionRegistry.set(sid, {
      sessionId: sid,
      sessionTitle: patch.sessionTitle ?? '',
      promptText: patch.promptText ?? '',
      activityText: patch.activityText ?? '',
      running: false,
      startedAt: 0,
      updatedAt: Date.now(),
      outcome: patch.outcome ?? 'idle'
    })
  } else {
    if (patch.sessionTitle !== undefined) prev.sessionTitle = patch.sessionTitle
    if (patch.promptText !== undefined) prev.promptText = patch.promptText
    if (patch.activityText !== undefined) prev.activityText = patch.activityText
    if (patch.outcome !== undefined) prev.outcome = patch.outcome
    prev.updatedAt = Date.now()
  }
  recomputeBridgeView()
}

/**
 * 标记指定会话执行结束（先后完成调度核心）：
 * - 若仍有其它会话在并行运行：触发一次 `latestMilestone` 阶段庆典并无缝接力给剩余运行会话，仙子不退场；
 * - 若这是最后一个运行中的会话：设置最终 `outcome` 并令 `running` 转为 `false`，进入圆满谢幕。
 */
export function completeWishShrineSession(
  sessionId: string,
  outcome: 'success' | 'error' | 'aborted',
  sessionTitle?: string
): void {
  const sid = (sessionId ?? '').trim()
  if (!sid) return
  const entry = sessionRegistry.get(sid)
  const wasEntryRunning = Boolean(entry?.running)
  const resolvedTitle = (sessionTitle ?? entry?.sessionTitle ?? '').trim()

  if (entry) {
    entry.running = false
    entry.updatedAt = Date.now()
    entry.outcome = outcome === 'aborted' ? 'idle' : outcome
    if (resolvedTitle) entry.sessionTitle = resolvedTitle
  }

  if (!wasEntryRunning) {
    recomputeBridgeView()
    return
  }

  let remainingRunning = 0
  for (const item of sessionRegistry.values()) {
    if (item.running) remainingRunning += 1
  }

  if (outcome !== 'aborted') {
    wishShrineChatBridge.waveCompletedCount += 1
    if (outcome === 'success') {
      wishShrineChatBridge.waveHadSuccess = true
    }
  }

  if (remainingRunning > 0) {
    if (outcome === 'success' || outcome === 'error') {
      wishShrineChatBridge.latestMilestone = {
        seq: ++milestoneSeq,
        sessionId: sid,
        sessionTitle: resolvedTitle,
        outcome,
        remainingCount: remainingRunning,
        at: Date.now()
      }
    }
    recomputeBridgeView()
    return
  }

  // 最后一个运行会话结束：保留它的会话标识做最终谢幕
  wishShrineChatBridge.sessionId = sid
  if (resolvedTitle) {
    wishShrineChatBridge.sessionTitle = resolvedTitle
  }
  if (entry?.promptText) {
    wishShrineChatBridge.promptText = entry.promptText
  }
  if (outcome === 'aborted') {
    wishShrineChatBridge.outcome = wishShrineChatBridge.waveHadSuccess ? 'success' : 'idle'
  } else if (outcome === 'error') {
    wishShrineChatBridge.outcome = 'error'
  } else {
    wishShrineChatBridge.outcome = 'success'
  }
  recomputeBridgeView()
}

/**
 * 同步当前用户在对话面板正在查看的焦点会话（不会误停后台仍在运行的其它会话）。
 */
export function setWishShrineFocusedSession(
  sessionId: string,
  meta?: {
    sessionTitle?: string
    promptText?: string
    activityText?: string
    running?: boolean
  }
): void {
  const sid = (sessionId ?? '').trim()
  wishShrineChatBridge.focusedSessionId = sid
  if (sid && meta) {
    const prev = sessionRegistry.get(sid)
    if (meta.running && !prev?.running) {
      startWishShrineSession({
        sessionId: sid,
        sessionTitle: meta.sessionTitle,
        promptText: meta.promptText,
        activityText: meta.activityText
      })
      return
    }
    updateWishShrineSession(sid, {
      sessionTitle: meta.sessionTitle,
      promptText: meta.promptText,
      activityText: meta.activityText
    })
    return
  }
  recomputeBridgeView()
}

/**
 * 与主进程实际运行列表对账（排除正在本地预检 `preparingIds` 的会话），防止异常断连残留僵尸运行态。
 */
export function reconcileWishShrineRunningSessions(
  mainRunningIds: readonly string[],
  preparingIds: readonly string[] = []
): void {
  const alive = new Set<string>([...mainRunningIds, ...preparingIds])
  let changed = false
  for (const [sid, entry] of sessionRegistry.entries()) {
    if (entry.running && !alive.has(sid)) {
      entry.running = false
      entry.outcome = 'success'
      entry.updatedAt = Date.now()
      changed = true
    }
  }
  if (changed) {
    if ([...sessionRegistry.values()].every((e) => !e.running)) {
      wishShrineChatBridge.outcome = 'success'
    }
    recomputeBridgeView()
  }
}

/**
 * 测试与卸载清理辅助：清空所有会话登记。
 */
export function resetWishShrineBridgeForTests(): void {
  sessionRegistry.clear()
  wishShrineChatBridge.running = false
  wishShrineChatBridge.sessionId = ''
  wishShrineChatBridge.sessionTitle = ''
  wishShrineChatBridge.promptText = ''
  wishShrineChatBridge.activityText = ''
  wishShrineChatBridge.outcome = 'idle'
  wishShrineChatBridge.focusedSessionId = ''
  wishShrineChatBridge.activeCount = 0
  wishShrineChatBridge.waveCompletedCount = 0
  wishShrineChatBridge.waveHadSuccess = false
  wishShrineChatBridge.companionSessions = []
  wishShrineChatBridge.latestMilestone = null
}

/**
 * 兼容旧版单会话同步入口：按 patch.sessionId 更新焦点会话，不再因切换空闲会话误杀后台运行会话。
 */
export function syncWishShrineChatBridge(
  patch: Partial<
    Pick<
      WishShrineChatBridgeState,
      'running' | 'sessionId' | 'sessionTitle' | 'promptText' | 'activityText' | 'outcome'
    >
  >
): void {
  const sid = (patch.sessionId ?? wishShrineChatBridge.focusedSessionId).trim()
  if (patch.sessionId !== undefined) {
    wishShrineChatBridge.focusedSessionId = sid
  }
  if (!sid) {
    if (patch.running !== undefined && !patch.running && sessionRegistry.size === 0) {
      wishShrineChatBridge.running = false
    }
    if (patch.outcome !== undefined && !wishShrineChatBridge.running) {
      wishShrineChatBridge.outcome = patch.outcome
    }
    return
  }
  if (patch.running === true) {
    startWishShrineSession({
      sessionId: sid,
      sessionTitle: patch.sessionTitle,
      promptText: patch.promptText,
      activityText: patch.activityText
    })
    return
  }
  if (patch.running === false && sessionRegistry.get(sid)?.running) {
    const out = patch.outcome === 'error' ? 'error' : 'success'
    completeWishShrineSession(sid, out, patch.sessionTitle)
    return
  }
  updateWishShrineSession(sid, {
    sessionTitle: patch.sessionTitle,
    promptText: patch.promptText,
    activityText: patch.activityText,
    outcome: patch.outcome
  })
}
