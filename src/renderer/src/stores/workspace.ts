import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  isDraftAssetId,
  isDirectorDeck,
  isCanvasAsset,
  isImportedMediaRefAsset,
  isScreenplayAsset,
  isWorldElementAsset,
  isBeatAsset,
  type AssetInfo
} from '@shared/domain'
import { parseGraphHostContext } from '@shared/editorGlobals'
import { useEditorKernel } from '../editor/kernel'
import {
  editorDiveAssetFrameKey,
  editorDiveViewFrameKey,
  isEditorDiveAssetFrame,
  type EditorDiveFrame,
  type EditorDiveKind,
  type EditorDiveViewMeta
} from '../features/graph/model/editorDive'
import { draftToAssetInfo, useDraftStore } from './drafts'
import { useProjectStore } from './project'

export type {
  EditorDiveFrame,
  EditorDiveKind,
  EditorDiveViewId,
  EditorDiveViewMeta
} from '../features/graph/model/editorDive'

export type CloseEditorsForAssetsResult =
  | { ok: true }
  | { ok: false; reason: 'graph-running' }

type CloseEditorsForAssetsFn = (assetIds: string[]) => CloseEditorsForAssetsResult

export const STUDIO_ASSET_DRAG_MIME = 'application/x-studio-asset'
export const STUDIO_ASSET_ID_DRAG_MIME = 'application/x-studio-asset-id'
export const STUDIO_ASSET_IDS_DRAG_MIME = 'application/x-studio-asset-ids'
/** 场栏 → 画布：拖入创建场参考节点 */
export const STUDIO_BEAT_UNIT_DRAG_MIME = 'application/x-studio-beat-unit'
export const STUDIO_BEAT_UNIT_ID_DRAG_MIME = 'application/x-studio-beat-unit-id'

/** Workspace UI intents (selection, open editors, etc.) */
export const useWorkspaceStore = defineStore('workspace', () => {
  const editor = useEditorKernel()
  const openAssetEditorIds = ref<string[]>([])
  const openScreenplayEditorIds = ref<string[]>([])
  const openCanvasEditorIds = ref<string[]>([])
  const openWorldEditorIds = ref<string[]>([])
  const openBeatEditorIds = ref<string[]>([])
  const openDirectorEditorIds = ref<string[]>([])
  /** 场细化底栏当前选中单元 */
  const activeBeatId = ref<string | null>(null)
  const activeBeatAssetId = ref<string | null>(null)
  const selectedAssetId = computed(() =>
    editor.selection.current.value.kind === 'asset'
      ? (editor.selection.current.value.id ?? null)
      : null
  )
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

  /**
   * 已打开的宿主编辑器再次激活时递增，驱动内层重新注入父图输入接口预览。
   * key = assetId，value = 单调 nonce。
   */
  const hostInputSlotSyncNonce = ref<Record<string, number>>({})

  function requestHostInputSlotSync(assetId: string): void {
    const id = assetId?.trim()
    if (!id) return
    hostInputSlotSyncNonce.value = {
      ...hostInputSlotSyncNonce.value,
      [id]: (hostInputSlotSyncNonce.value[id] ?? 0) + 1
    }
  }

  /**
   * Houdini 式 dive 栈：rootKey → 资产帧 / 逻辑视图帧。
   * 空数组 / 缺省 = 只显示根图。
   */
  const editorDives = ref<Record<string, EditorDiveFrame[]>>({})
  /** 当前焦点编辑器 dive 根（媒体预览等无 inject 场景） */
  const activeDiveRootKey = ref<string | null>(null)

  function setActiveDiveRootKey(rootKey: string | null): void {
    activeDiveRootKey.value = rootKey?.trim() || null
  }

  function diveStack(rootKey: string): EditorDiveFrame[] {
    return editorDives.value[rootKey] ?? []
  }

  function resolveDiveKind(asset: AssetInfo): EditorDiveKind {
    if (isScreenplayAsset(asset.type)) return 'screenplay'
    if (isBeatAsset(asset.type)) return 'beat'
    if (isWorldElementAsset(asset.type)) return 'world'
    if (isDirectorDeck(asset.type)) return 'director'
    if (isCanvasAsset(asset.type)) return 'canvas'
    return 'asset'
  }

  function defaultViewTitle(meta: EditorDiveViewMeta): string {
    switch (meta.viewId) {
      case 'script.timeline':
        return 'Timeline'
      case 'world.editor':
        return 'World editor'
      case 'world.table':
        return 'World table'
      case 'beat.gen':
        return 'Beat units'
      case 'beat.table':
        return 'Beat table'
      case 'director.stage':
        return 'Director stage'
      case 'media.preview':
        return meta.title?.trim() || 'Preview'
      default:
        return meta.viewId
    }
  }

  function pushDiveFrame(rootKey: string, frame: EditorDiveFrame): boolean {
    const key = rootKey?.trim()
    if (!key || !frame.key) return false
    const stack = diveStack(key)
    const top = stack[stack.length - 1]
    if (top?.key === frame.key) {
      if (isEditorDiveAssetFrame(frame)) requestHostInputSlotSync(frame.assetId)
      return true
    }
    editorDives.value = { ...editorDives.value, [key]: [...stack, frame] }
    if (isEditorDiveAssetFrame(frame)) requestHostInputSlotSync(frame.assetId)
    return true
  }

  /** 同面板 dive 进入子宿主；已在栈顶则只刷新输入接口 */
  function diveIntoAsset(rootKey: string, assetId: string): boolean {
    const key = rootKey?.trim()
    const id = assetId?.trim()
    if (!key || !id) return false
    const asset = resolveAssetById(id)
    if (!asset) return false
    const kind = resolveDiveKind(asset)
    return pushDiveFrame(key, {
      type: 'asset',
      key: editorDiveAssetFrameKey(kind, id),
      assetId: id,
      kind,
      title: asset.name?.trim() || id.slice(0, 8)
    })
  }

  /** 同面板 dive 进入逻辑视图 */
  function diveIntoView(
    rootKey: string,
    meta: EditorDiveViewMeta,
    title?: string
  ): boolean {
    const key = rootKey?.trim()
    if (!key) return false
    const frameKey = editorDiveViewFrameKey(key, meta)
    return pushDiveFrame(key, {
      type: 'view',
      key: frameKey,
      viewId: meta.viewId,
      title: title?.trim() || defaultViewTitle(meta),
      meta
    })
  }

  /**
   * 回退到指定帧：index=-1 回到根图；index>=0 保留 stack[0..index]。
   */
  function divePopTo(rootKey: string, index: number): void {
    const key = rootKey?.trim()
    if (!key) return
    const stack = diveStack(key)
    if (!stack.length) return
    if (index >= stack.length - 1) return
    const next = index < 0 ? [] : stack.slice(0, index + 1)
    if (!next.length) {
      const { [key]: _removed, ...rest } = editorDives.value
      editorDives.value = rest
      return
    }
    editorDives.value = { ...editorDives.value, [key]: next }
    const top = next[next.length - 1]
    if (isEditorDiveAssetFrame(top)) requestHostInputSlotSync(top.assetId)
  }

  function diveClear(rootKey: string): void {
    const key = rootKey?.trim()
    if (!key || !(key in editorDives.value)) return
    const { [key]: _removed, ...rest } = editorDives.value
    editorDives.value = rest
  }

  function diveClearAll(): void {
    editorDives.value = {}
  }

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
    if (isCanvasAsset(asset.type)) {
      openCanvasEditor(assetId)
    } else if (isWorldElementAsset(asset.type)) {
      openWorldEditor(assetId)
    } else if (isBeatAsset(asset.type)) {
      openBeatEditor(assetId)
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

  function openCanvasEditor(canvasAssetId: string): void {
    openCanvasEditorIds.value = bumpOpenId(openCanvasEditorIds.value, canvasAssetId)
    focusEditorGlobalsForAsset(canvasAssetId)
  }

  function openWorldEditor(worldAssetId: string): void {
    openWorldEditorIds.value = bumpOpenId(openWorldEditorIds.value, worldAssetId)
    focusEditorGlobalsForAsset(worldAssetId)
  }

  function openBeatEditor(beatAssetId: string): void {
    openBeatEditorIds.value = bumpOpenId(openBeatEditorIds.value, beatAssetId)
    focusEditorGlobalsForAsset(beatAssetId)
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
        ctx.kind === 'asset' &&
        ctx.id === assetId
      ) {
        editor.selection.clear()
        return
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

  function consumeBeatEditor(beatAssetId: string): void {
    openBeatEditorIds.value = openBeatEditorIds.value.filter((id) => id !== beatAssetId)
    clearInspectorForClosedEditor(beatAssetId)
  }

  function consumeDirectorEditor(directorAssetId: string): void {
    openDirectorEditorIds.value = openDirectorEditorIds.value.filter((id) => id !== directorAssetId)
    clearInspectorForClosedEditor(directorAssetId)
  }

  /** 从所有打开列表中移除该资产（面板未挂载时的兜底） */
  function consumeEditorsForAsset(assetId: string): void {
    consumeAssetEditor(assetId)
    consumeScreenplayEditor(assetId)
    consumeCanvasEditor(assetId)
    consumeWorldEditor(assetId)
    consumeBeatEditor(assetId)
    consumeDirectorEditor(assetId)
  }

  /** 切换工程时清空会话态（打开的编辑器意图、拖拽、草稿导出器等） */
  function resetSession(): void {
    openAssetEditorIds.value = []
    openScreenplayEditorIds.value = []
    openCanvasEditorIds.value = []
    openWorldEditorIds.value = []
    openBeatEditorIds.value = []
    openDirectorEditorIds.value = []
    activeBeatId.value = null
    activeBeatAssetId.value = null
    draggingAsset.value = null
    assetBrowserReveal.value = null
    diveClearAll()
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

  function selectBeatUnit(beatId: string | null, beatAssetId?: string | null): void {
    activeBeatId.value = beatId
    if (beatAssetId !== undefined) {
      activeBeatAssetId.value = beatAssetId
    }
  }

  function focusBeatUnit(): void {
    const beatId = activeBeatId.value
    editor.selection.select({
      kind: 'beatUnit',
      key: beatId ? `beatUnit:${beatId}` : 'beatUnit:none',
      id: beatId ?? undefined
    })
    editor.commands.setActiveScope(
      beatId
        ? `document:beatUnit:${beatId}`
        : 'selection:beatUnit:none'
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
    editor.commands.setActiveScope(`document:graph:${host}`)
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
    openCanvasEditorIds,
    openWorldEditorIds,
    openBeatEditorIds,
    openDirectorEditorIds,
    activeBeatId,
    activeBeatAssetId,
    selectedAssetId,
    selectedAsset,
    openAssetEditor,
    openEditorForAssetId,
    canOpenEditorForAssetId,
    openScreenplayEditor,
    openCanvasEditor,
    openWorldEditor,
    openBeatEditor,
    openDirectorEditor,
    consumeAssetEditor,
    consumeScreenplayEditor,
    consumeCanvasEditor,
    consumeWorldEditor,
    consumeBeatEditor,
    consumeDirectorEditor,
    consumeEditorsForAsset,
    resetSession,
    prepareProjectSwitch,
    registerCloseEditorsForAssets,
    registerCloseAllEditorPanels,
    closeEditorsForAssetIds,
    selectAsset,
    selectBeatUnit,
    focusBeatUnit,
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
    hostInputSlotSyncNonce,
    requestHostInputSlotSync,
    editorDives,
    activeDiveRootKey,
    setActiveDiveRootKey,
    diveStack,
    diveIntoAsset,
    diveIntoView,
    divePopTo,
    diveClear,
    diveClearAll,
    revealAssetInBrowser
  }
})
