import { onScopeDispose, watch, type ShallowRef } from 'vue'
import type { DockviewApi } from 'dockview-vue'
import {
  useWorkspaceStore,
  type CloseEditorsForAssetsResult
} from '../../stores/workspace'
import { isEditorPanelGraphRunning } from './canCloseEditorPanel'
import { editorPanelIdsForAsset, parseEditorPanelId } from './editorPanelIcon'
import type { EditorPanelKind } from './usePanelTitles'

export interface EditorPanelOpenerOptions {
  dockApi: ShallowRef<DockviewApi | null>
  centerReferenceId: (api: DockviewApi) => string
  title: (kind: EditorPanelKind, assetId: string) => string
}

const PANEL_DEFINITIONS = {
  asset: {
    panelPrefix: 'asset-editor-',
    component: 'assetEditor',
    param: 'assetId'
  },
  screenplay: {
    panelPrefix: 'screenplay-editor-',
    component: 'assetEditor',
    param: 'assetId'
  },
  script: {
    panelPrefix: 'script-editor-',
    component: 'scriptEditor',
    param: 'scriptAssetId'
  },
  canvas: {
    panelPrefix: 'canvas-editor-',
    component: 'canvasEditor',
    param: 'canvasAssetId'
  },
  world: {
    panelPrefix: 'world-editor-',
    component: 'worldEditor',
    param: 'worldAssetId'
  },
  beat: {
    panelPrefix: 'beat-editor-',
    component: 'beatEditor',
    param: 'beatAssetId'
  },
  director: {
    panelPrefix: 'director-editor-',
    component: 'directorEditor',
    param: 'directorAssetId'
  }
} as const

export function useEditorPanelOpener(options: EditorPanelOpenerOptions) {
  const workspace = useWorkspaceStore()

  function open(kind: EditorPanelKind, assetId: string): void {
    const api = options.dockApi.value
    if (!api) return
    const definition = PANEL_DEFINITIONS[kind]
    const panelId = `${definition.panelPrefix}${assetId}`
    const existing = api.getPanel(panelId)
    if (existing) {
      existing.api.setActive()
      // 已打开面板再次切入：重新注入外层输入到宿主编辑器
      workspace.requestHostInputSlotSync(assetId)
      return
    }
    api.addPanel({
      id: panelId,
      component: definition.component,
      title: options.title(kind, assetId),
      tabComponent: 'editorTab',
      params: { [definition.param]: assetId },
      position: {
        referencePanel: options.centerReferenceId(api),
        direction: 'within'
      }
    })
  }

  function openPending(): void {
    const groups: Array<[EditorPanelKind, string[]]> = [
      ['asset', workspace.openAssetEditorIds],
      ['screenplay', workspace.openScreenplayEditorIds],
      ['script', workspace.openScriptEditorIds],
      ['canvas', workspace.openCanvasEditorIds],
      ['world', workspace.openWorldEditorIds],
      ['beat', workspace.openBeatEditorIds],
      ['director', workspace.openDirectorEditorIds]
    ]
    for (const [kind, ids] of groups) {
      const latest = ids.at(-1)
      if (latest) open(kind, latest)
    }
  }

  watch(() => workspace.openAssetEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('asset', id)
  })
  watch(() => workspace.openScreenplayEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('screenplay', id)
  })
  watch(() => workspace.openScriptEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('script', id)
  })
  watch(() => workspace.openCanvasEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('canvas', id)
  })
  watch(() => workspace.openWorldEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('world', id)
  })
  watch(() => workspace.openBeatEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('beat', id)
  })
  watch(() => workspace.openDirectorEditorIds.slice(), (ids) => {
    const id = ids.at(-1)
    if (id) open('director', id)
  })

  function closeEditorsForAssetIds(assetIds: string[]): CloseEditorsForAssetsResult {
    const api = options.dockApi.value
    for (const assetId of assetIds) {
      for (const panelId of editorPanelIdsForAsset(assetId)) {
        if (isEditorPanelGraphRunning(panelId)) {
          return { ok: false, reason: 'graph-running' }
        }
      }
    }
    for (const assetId of assetIds) {
      if (api) {
        for (const panelId of editorPanelIdsForAsset(assetId)) {
          const panel = api.getPanel(panelId)
          if (panel) api.removePanel(panel)
        }
      }
      workspace.consumeEditorsForAsset(assetId)
    }
    return { ok: true }
  }

  /** 强制关闭全部文档编辑器面板（切换工程用） */
  function closeAllEditorPanels(): void {
    const api = options.dockApi.value
    if (api) {
      for (const panel of [...api.panels]) {
        if (!parseEditorPanelId(panel.id)) continue
        api.removePanel(panel)
      }
    }
    workspace.resetSession()
  }

  workspace.registerCloseEditorsForAssets(closeEditorsForAssetIds)
  workspace.registerCloseAllEditorPanels(closeAllEditorPanels)
  onScopeDispose(() => {
    workspace.registerCloseEditorsForAssets(null)
    workspace.registerCloseAllEditorPanels(null)
  })

  return { open, openPending, closeAllEditorPanels }
}
