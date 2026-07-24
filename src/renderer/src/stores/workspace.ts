import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  shotScriptAssetId,
  isDraftAssetId,
  isDirectorDeck,
  isCanvasAsset,
  isImportedMediaRefAsset,
  isScreenplayAsset,
  isStoryboardScript,
  isWorldElementAsset,
  isNarrativeAsset,
  type AssetInfo
} from '@shared/domain'
import { parseGraphHostContext } from '@shared/editorGlobals'
import { useEditorKernel } from '../editor/kernel'
import { draftToAssetInfo, useDraftStore } from './drafts'
import { useProjectStore } from './project'

export type InspectorFocus = 'shot' | 'asset'

export type CloseEditorsForAssetsResult =
  | { ok: true }
  | { ok: false; reason: 'graph-running' }

type CloseEditorsForAssetsFn = (assetIds: string[]) => CloseEditorsForAssetsResult

export const STUDIO_ASSET_DRAG_MIME = 'application/x-studio-asset'
export const STUDIO_ASSET_ID_DRAG_MIME = 'application/x-studio-asset-id'
export const STUDIO_ASSET_IDS_DRAG_MIME = 'application/x-studio-asset-ids'
/** 分镜栏 → 画布：拖入创建分镜参数节点 */
export const STUDIO_SHOT_DRAG_MIME = 'application/x-studio-shot'
export const STUDIO_SHOT_ID_DRAG_MIME = 'application/x-studio-shot-id'

/** Workspace UI intents (selection, open editors, etc.) */
export const useWorkspaceStore = defineStore('workspace', () => {
  const editor = useEditorKernel()
  const openAssetEditorIds = ref<string[]>([])
  const openScreenplayEditorIds = ref<string[]>([])
  const openScriptEditorIds = ref<string[]>([])
  const openCanvasEditorIds = ref<string[]>([])
  const openWorldEditorIds = ref<string[]>([])
  const openNarrativeEditorIds = ref<string[]>([])
  const openDirectorEditorIds = ref<string[]>([])
  const selectedAssetId = computed(() =>
    editor.selection.current.value.kind === 'asset'
      ? (editor.selection.current.value.id ?? null)
      : null
  )
  const inspectorFocus = computed<InspectorFocus>(() =>
    editor.selection.current.value.kind === 'asset' ? 'asset' : 'shot'
  )
  const scriptCanvasExporters = ref(new Map<string, () => Promise<string | null>>())
  const scriptGraphGetters = ref(new Map<string, () => import('@shared/graph').GraphDocument | null>())
  /** 资产库拖出时缓存，跨面板拖放时 dataTransfer 可能读不到自定义 MIME */
  const draggingAsset = ref<AssetInfo | null>(null)
  /** 节点图选中的节点 id（null = 当前编辑器全局参数） */
  const selectedGraphNodeId = computed(() =>
    editor.selection.current.value.kind === 'graph.node'
      ? (editor.selection.current.value.id ?? null)
      : null
  )
  /** 节点图选中的分组 id */
  const selectedGraphGroupId = computed(() =>
    editor.selection.current.value.kind === 'graph.group'
      ? (editor.selection.current.value.id ?? null)
      : null
  )
  /** 当前选中节点或分组所属图；避免多个编辑器打开时读写到另一张图。 */
  const selectedGraphHostId = computed(() => {
    const kind = editor.selection.current.value.kind
    if (kind === 'graph.node' || kind === 'graph.group') {
      return editor.selection.current.value.hostId ?? null
    }
    return null
  })

  const selectedAsset = computed(() => {
    if (!selectedAssetId.value) return null
    const drafts = useDraftStore()
    if (isDraftAssetId(selectedAssetId.value)) {
      const draft = drafts.getDraft(selectedAssetId.value)
      return draft ? draftToAssetInfo(draft) : null
    }
    return useProjectStore().assets.find((a) => a.id === selectedAssetId.value) ?? null
  })

  function bumpOpenId(list: string[], id: string): string[] {
    if (!list.includes(id)) return [...list, id]
    return [...list.filter((item) => item !== id), id]
  }

  /** 资产浏览器定位请求（nonce 保证重复打开同一资产也会触发） */
  const assetBrowserReveal = ref<{ assetId: string; nonce: number } | null>(null)

  function resolveAssetById(assetId: string): AssetInfo | null {
    if (isDraftAssetId(assetId)) {
      const draft = useDraftStore().getDraft(assetId)
      return draft ? draftToAssetInfo(draft) : null
    }
    return useProjectStore().assets.find((a) => a.id === assetId) ?? null
  }

  /** 模型 / 导入的图声视引用：仅 Inspector，无独立编辑窗口。 */
  function canOpenEditorForAssetId(assetId: string): boolean {
    const asset = resolveAssetById(assetId)
    if (!asset) return true
    if (asset.type === 'model') return false
    if (isImportedMediaRefAsset(asset)) return false
    return true
  }

  /** 让资产浏览器跳到该资产所在文件夹并选中（草稿忽略） */
  function revealAssetInBrowser(assetId: string): void {
    if (!assetId || isDraftAssetId(assetId)) return
    if (!useProjectStore().assets.some((a) => a.id === assetId)) return
    assetBrowserReveal.value = {
      assetId,
      nonce: (assetBrowserReveal.value?.nonce ?? 0) + 1
    }
  }

  function openEditorForAssetId(assetId: string): void {
    const asset = resolveAssetById(assetId)
    if (!asset) {
      openAssetEditor(assetId)
      return
    }
    // 引用型媒体 / 模型：选中并显示 Inspector，不打开编辑页
    if (asset.type === 'model' || isImportedMediaRefAsset(asset)) {
      selectAsset(assetId)
      revealAssetInBrowser(assetId)
      return
    }
    if (isStoryboardScript(asset.type)) {
      openScriptEditor(assetId)
    } else if (isCanvasAsset(asset.type)) {
      openCanvasEditor(assetId)
    } else if (isWorldElementAsset(asset.type)) {
      openWorldEditor(assetId)
    } else if (isNarrativeAsset(asset.type)) {
      openNarrativeEditor(assetId)
    } else if (isDirectorDeck(asset.type)) {
      openDirectorEditor(assetId)
    } else if (isScreenplayAsset(asset.type)) {
      openScreenplayEditor(assetId)
    } else {
      openAssetEditor(assetId)
    }
    revealAssetInBrowser(assetId)
  }

  function openAssetEditor(assetId: string): void {
    if (!canOpenEditorForAssetId(assetId)) return
    openAssetEditorIds.value = bumpOpenId(openAssetEditorIds.value, assetId)
    focusEditorGlobalsForAsset(assetId)
  }

  function openScreenplayEditor(screenplayAssetId: string): void {
    openScreenplayEditorIds.value = bumpOpenId(openScreenplayEditorIds.value, screenplayAssetId)
    focusEditorGlobalsForAsset(screenplayAssetId)
  }

  function openScriptEditor(scriptAssetId: string): void {
    openScriptEditorIds.value = bumpOpenId(openScriptEditorIds.value, scriptAssetId)
    focusEditorGlobalsForAsset(scriptAssetId)
  }

  function openCanvasEditor(canvasAssetId: string): void {
    openCanvasEditorIds.value = bumpOpenId(openCanvasEditorIds.value, canvasAssetId)
    focusEditorGlobalsForAsset(canvasAssetId)
  }

  function openWorldEditor(worldAssetId: string): void {
    openWorldEditorIds.value = bumpOpenId(openWorldEditorIds.value, worldAssetId)
    focusEditorGlobalsForAsset(worldAssetId)
  }

  function openNarrativeEditor(narrativeAssetId: string): void {
    openNarrativeEditorIds.value = bumpOpenId(openNarrativeEditorIds.value, narrativeAssetId)
    focusEditorGlobalsForAsset(narrativeAssetId)
  }

  function openDirectorEditor(directorAssetId: string): void {
    openDirectorEditorIds.value = bumpOpenId(openDirectorEditorIds.value, directorAssetId)
    focusEditorGlobalsForAsset(directorAssetId)
  }

  function clearInspectorForClosedEditor(assetId: string): void {
    const sel = editor.selection.current.value
    if (sel.kind === 'asset' && sel.id === assetId) {
      editor.selection.clear()
      return
    }
    if (sel.kind === 'graph.node' || sel.kind === 'graph.group') {
      const ctx = parseGraphHostContext(sel.hostId)
      if (
        (ctx.kind === 'asset' || ctx.kind === 'script') &&
        ctx.id === assetId
      ) {
        editor.selection.clear()
        return
      }
    }
    if (sel.kind === 'shot') {
      const project = useProjectStore()
      const shot = project.activeShot
      if (shot && shotScriptAssetId(shot) === assetId) {
        editor.selection.clear()
      }
    }
  }

  function consumeAssetEditor(assetId: string): void {
    openAssetEditorIds.value = openAssetEditorIds.value.filter((id) => id !== assetId)
    clearInspectorForClosedEditor(assetId)
  }

  function consumeScreenplayEditor(screenplayAssetId: string): void {
    openScreenplayEditorIds.value = openScreenplayEditorIds.value.filter((id) => id !== screenplayAssetId)
    clearInspectorForClosedEditor(screenplayAssetId)
  }

  function consumeCanvasEditor(canvasAssetId: string): void {
    openCanvasEditorIds.value = openCanvasEditorIds.value.filter((id) => id !== canvasAssetId)
    clearInspectorForClosedEditor(canvasAssetId)
  }

  function consumeWorldEditor(worldAssetId: string): void {
    openWorldEditorIds.value = openWorldEditorIds.value.filter((id) => id !== worldAssetId)
    clearInspectorForClosedEditor(worldAssetId)
  }

  function consumeNarrativeEditor(narrativeAssetId: string): void {
    openNarrativeEditorIds.value = openNarrativeEditorIds.value.filter((id) => id !== narrativeAssetId)
    clearInspectorForClosedEditor(narrativeAssetId)
  }

  function consumeDirectorEditor(directorAssetId: string): void {
    openDirectorEditorIds.value = openDirectorEditorIds.value.filter((id) => id !== directorAssetId)
    clearInspectorForClosedEditor(directorAssetId)
  }

  function consumeScriptEditor(scriptAssetId: string): void {
    openScriptEditorIds.value = openScriptEditorIds.value.filter((id) => id !== scriptAssetId)
    unregisterScriptCanvasExporter(scriptAssetId)
    unregisterScriptGraphGetter(scriptAssetId)
    clearInspectorForClosedEditor(scriptAssetId)
  }

  /** 从所有打开列表中移除该资产（面板未挂载时的兜底） */
  function consumeEditorsForAsset(assetId: string): void {
    consumeAssetEditor(assetId)
    consumeScreenplayEditor(assetId)
    consumeScriptEditor(assetId)
    consumeCanvasEditor(assetId)
    consumeWorldEditor(assetId)
    consumeNarrativeEditor(assetId)
    consumeDirectorEditor(assetId)
  }

  /** 切换工程时清空会话态（打开的编辑器意图、拖拽、草稿导出器等） */
  function resetSession(): void {
    openAssetEditorIds.value = []
    openScreenplayEditorIds.value = []
    openScriptEditorIds.value = []
    openCanvasEditorIds.value = []
    openWorldEditorIds.value = []
    openNarrativeEditorIds.value = []
    openDirectorEditorIds.value = []
    scriptCanvasExporters.value = new Map()
    scriptGraphGetters.value = new Map()
    draggingAsset.value = null
    assetBrowserReveal.value = null
    clearAssetSelection()
  }

  let closeEditorsForAssetsImpl: CloseEditorsForAssetsFn | null = null
  let closeAllEditorPanelsImpl: (() => void) | null = null

  function registerCloseEditorsForAssets(fn: CloseEditorsForAssetsFn | null): void {
    closeEditorsForAssetsImpl = fn
  }

  function registerCloseAllEditorPanels(fn: (() => void) | null): void {
    closeAllEditorPanelsImpl = fn
  }

  /** 关闭资产对应编辑器面板；有节点图在跑时返回失败，调用方应中止删除 */
  function closeEditorsForAssetIds(assetIds: string[]): CloseEditorsForAssetsResult {
    const unique = [...new Set(assetIds)].filter(Boolean)
    if (!unique.length) return { ok: true }
    if (closeEditorsForAssetsImpl) return closeEditorsForAssetsImpl(unique)
    for (const id of unique) consumeEditorsForAsset(id)
    return { ok: true }
  }

  /** 切换工程：关掉全部文档编辑器面板并清空会话（强制，不因图在跑而中止） */
  function prepareProjectSwitch(): void {
    if (closeAllEditorPanelsImpl) closeAllEditorPanelsImpl()
    else resetSession()
  }

  function registerScriptCanvasExporter(
    scriptAssetId: string,
    fn: () => Promise<string | null>
  ): void {
    scriptCanvasExporters.value.set(scriptAssetId, fn)
  }

  function unregisterScriptCanvasExporter(scriptAssetId: string): void {
    scriptCanvasExporters.value.delete(scriptAssetId)
  }

  function registerScriptGraphGetter(
    scriptAssetId: string,
    fn: () => import('@shared/graph').GraphDocument | null
  ): void {
    scriptGraphGetters.value.set(scriptAssetId, fn)
  }

  function unregisterScriptGraphGetter(scriptAssetId: string): void {
    scriptGraphGetters.value.delete(scriptAssetId)
  }

  function getActiveGraph(): import('@shared/graph').GraphDocument | null {
    const project = useProjectStore()
    const shot = project.activeShot
    const ownerId = shot ? shotScriptAssetId(shot) : undefined
    if (ownerId) {
      return scriptGraphGetters.value.get(ownerId)?.() ?? null
    }
    for (const fn of scriptGraphGetters.value.values()) {
      const g = fn()
      if (g) return g
    }
    return null
  }

  async function exportCanvasForActiveShot(): Promise<string | null> {
    const project = useProjectStore()
    const shot = project.activeShot
    const ownerId = shot ? shotScriptAssetId(shot) : undefined
    if (ownerId) {
      return (await scriptCanvasExporters.value.get(ownerId)?.()) ?? null
    }
    for (const fn of scriptCanvasExporters.value.values()) {
      const dataUrl = await fn()
      if (dataUrl) return dataUrl
    }
    return null
  }

  function selectAsset(assetId: string | null): void {
    if (assetId) {
      editor.selection.select({
        kind: 'asset',
        key: `asset:${assetId}`,
        id: assetId
      })
      editor.commands.setActiveScope(`document:asset:${assetId}`)
    } else if (editor.selection.is('asset')) {
      focusProjectGlobals()
    }
  }

  function focusShot(): void {
    const project = useProjectStore()
    const shotId = project.activeShotId
    editor.selection.select({
      kind: 'shot',
      key: shotId ? `shot:${shotId}` : 'shot:none',
      id: shotId ?? undefined
    })
    editor.commands.setActiveScope(
      shotId
        ? `document:shot:${shotId}`
        : `selection:shot:${shotId ?? 'none'}`
    )
  }

  /** 任意画布空白处 / 打开编辑器：统一工程全局参数（含普通图片/视频/声音资产） */
  function focusProjectGlobals(): void {
    editor.selection.select({
      kind: 'project',
      key: 'project:globals'
    })
    editor.commands.setActiveScope('document:project')
  }

  /** 打开编辑器或清空图选中时，统一切到工程全局参数 */
  function focusEditorGlobalsForAsset(_assetId: string): void {
    focusProjectGlobals()
  }

  function focusEditorGlobals(_hostId?: string | null): void {
    focusProjectGlobals()
  }

  function setGraphEditorScope(host: string): void {
    const shotId = useProjectStore().activeShotId
    editor.commands.setActiveScope(
      host.startsWith('asset:')
        ? `document:graph:${host}`
        : `document:graph:${host}:shot:${shotId ?? 'none'}`
    )
  }

  function selectGraphNode(nodeId: string | null, hostId?: string): void {
    if (nodeId) {
      const selectedHost = hostId ?? selectedGraphHostId.value
      editor.selection.select({
        kind: 'graph.node',
        key: `graph:${selectedHost ?? 'unknown'}:${nodeId}`,
        id: nodeId,
        hostId: selectedHost ?? undefined
      })
      setGraphEditorScope(selectedHost ?? 'unknown')
      return
    }
    // 画布空白 / 清空图选中：所有图宿主统一工程全局参数
    focusProjectGlobals()
  }

  function selectGraphGroup(groupId: string | null, hostId?: string): void {
    if (groupId) {
      const selectedHost = hostId ?? selectedGraphHostId.value
      editor.selection.select({
        kind: 'graph.group',
        key: `graph-group:${selectedHost ?? 'unknown'}:${groupId}`,
        id: groupId,
        hostId: selectedHost ?? undefined
      })
      setGraphEditorScope(selectedHost ?? 'unknown')
      return
    }
    focusProjectGlobals()
  }

  function setAssetMultiSelection(count: number): void {
    editor.selection.select({
      kind: 'asset.multi',
      key: `asset:multi:${count}`,
      meta: { count }
    })
  }

  function clearAssetInspectorFocus(): void {
    editor.selection.clear()
  }

  function clearAssetSelection(): void {
    if (editor.selection.is('asset')) focusProjectGlobals()
  }

  function setDraggingAsset(asset: AssetInfo | null): void {
    draggingAsset.value = asset
  }

  function resolveDraggedAsset(e?: DragEvent): AssetInfo | null {
    if (draggingAsset.value) return draggingAsset.value
    const raw = e?.dataTransfer?.getData(STUDIO_ASSET_DRAG_MIME)
    if (raw) {
      try {
        return JSON.parse(raw) as AssetInfo
      } catch {
        /* fall through */
      }
    }
    const id =
      e?.dataTransfer?.getData(STUDIO_ASSET_ID_DRAG_MIME) ||
      (() => {
        const idsRaw = e?.dataTransfer?.getData(STUDIO_ASSET_IDS_DRAG_MIME)
        if (!idsRaw) return ''
        try {
          const ids = JSON.parse(idsRaw) as unknown
          return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : ''
        } catch {
          return ''
        }
      })() ||
      e?.dataTransfer?.getData('text/plain') ||
      ''
    if (id) {
      return useProjectStore().assets.find((a) => a.id === id) ?? null
    }
    return null
  }

  return {
    openAssetEditorIds,
    openScreenplayEditorIds,
    openScriptEditorIds,
    openCanvasEditorIds,
    openWorldEditorIds,
    openNarrativeEditorIds,
    openDirectorEditorIds,
    selectedAssetId,
    selectedAsset,
    inspectorFocus,
    openAssetEditor,
    openEditorForAssetId,
    canOpenEditorForAssetId,
    openScreenplayEditor,
    openScriptEditor,
    openCanvasEditor,
    openWorldEditor,
    openNarrativeEditor,
    openDirectorEditor,
    consumeAssetEditor,
    consumeScreenplayEditor,
    consumeScriptEditor,
    consumeCanvasEditor,
    consumeWorldEditor,
    consumeNarrativeEditor,
    consumeDirectorEditor,
    consumeEditorsForAsset,
    resetSession,
    prepareProjectSwitch,
    registerCloseEditorsForAssets,
    registerCloseAllEditorPanels,
    closeEditorsForAssetIds,
    registerScriptCanvasExporter,
    unregisterScriptCanvasExporter,
    registerScriptGraphGetter,
    unregisterScriptGraphGetter,
    getActiveGraph,
    exportCanvasForActiveShot,
    selectAsset,
    focusShot,
    focusProjectGlobals,
    focusEditorGlobals,
    focusEditorGlobalsForAsset,
    setAssetMultiSelection,
    clearAssetSelection,
    clearAssetInspectorFocus,
    draggingAsset,
    setDraggingAsset,
    resolveDraggedAsset,
    resolveAssetById,
    selectedGraphNodeId,
    selectedGraphGroupId,
    selectedGraphHostId,
    selectGraphNode,
    selectGraphGroup,
    assetBrowserReveal,
    revealAssetInBrowser
  }
})
