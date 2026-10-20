import { reactive } from 'vue'
import type { GraphDocument } from '@shared/graph'

export interface NodeToolDialogState<TSetup> {
  open: boolean
  nodeId: string
  setup: TSetup | null
  historyBefore: GraphDocument | null
  sourceUrl: string
  sourceLoading: boolean
  generateModel: string
  generateProviderInstanceId: string
}

export interface NodeToolDialogController<TSetup> {
  state: NodeToolDialogState<TSetup>
  beginOpen: (params: {
    nodeId: string
    setup: TSetup
    historyBefore: GraphDocument | null
    generateModel?: string
    generateProviderInstanceId?: string
  }) => void
  close: () => void
  consumeHistorySnapshot: () => GraphDocument | null
}

/**
 * 通用节点工具弹窗状态工厂（Node Tool State Factory）：
 * 统一封装 `open / nodeId / setup / historyBefore / sourceUrl / sourceLoading` 状态与生命周期，
 * 消除 `NodeGraphEditor.vue` 中十余个节点子工具编辑器的样板代码重复。
 */
export function createNodeToolDialogController<TSetup>(): NodeToolDialogController<TSetup> {
  const state = reactive<NodeToolDialogState<TSetup>>({
    open: false,
    nodeId: '',
    setup: null,
    historyBefore: null,
    sourceUrl: '',
    sourceLoading: false,
    generateModel: '',
    generateProviderInstanceId: ''
  }) as NodeToolDialogState<TSetup>

  function beginOpen(params: {
    nodeId: string
    setup: TSetup
    historyBefore: GraphDocument | null
    generateModel?: string
    generateProviderInstanceId?: string
  }): void {
    state.nodeId = params.nodeId
    state.setup = params.setup
    state.historyBefore = params.historyBefore
    state.sourceUrl = ''
    state.sourceLoading = true
    state.generateModel = params.generateModel ?? ''
    state.generateProviderInstanceId = params.generateProviderInstanceId ?? ''
    state.open = true
  }

  function close(): void {
    state.open = false
    state.nodeId = ''
    state.setup = null
    state.historyBefore = null
    state.sourceUrl = ''
    state.sourceLoading = false
    state.generateModel = ''
    state.generateProviderInstanceId = ''
  }

  function consumeHistorySnapshot(): GraphDocument | null {
    if (!state.open || !state.historyBefore) return null
    const snapshot = state.historyBefore
    state.historyBefore = null
    return snapshot
  }

  return {
    state,
    beginOpen,
    close,
    consumeHistorySnapshot
  }
}
