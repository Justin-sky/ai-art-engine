import type { GraphClipboardPayload } from '@shared/graph'

/** 跨图编辑器实例共享的节点剪贴板（同应用会话） */
let memoryPayload: GraphClipboardPayload | null = null
let pasteGeneration = 0

export function getMemoryGraphClipboard(): GraphClipboardPayload | null {
  return memoryPayload
}

export function setMemoryGraphClipboard(payload: GraphClipboardPayload | null): void {
  memoryPayload = payload
  pasteGeneration = 0
}

/** 连续粘贴累加偏移代数；返回当前代数（从 1 起） */
export function bumpGraphPasteGeneration(): number {
  pasteGeneration += 1
  return pasteGeneration
}
