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

export function syncWishShrineChatBridge(patch: Partial<WishShrineChatBridgeState>): void {
  if (patch.running !== undefined) wishShrineChatBridge.running = patch.running
  if (patch.sessionId !== undefined) wishShrineChatBridge.sessionId = patch.sessionId
  if (patch.sessionTitle !== undefined) wishShrineChatBridge.sessionTitle = patch.sessionTitle
  if (patch.promptText !== undefined) wishShrineChatBridge.promptText = patch.promptText
  if (patch.activityText !== undefined) wishShrineChatBridge.activityText = patch.activityText
  if (patch.outcome !== undefined) wishShrineChatBridge.outcome = patch.outcome
}
