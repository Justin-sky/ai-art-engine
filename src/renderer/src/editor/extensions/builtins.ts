import { defineComponent, h, markRaw } from 'vue'
import type { VueComponent } from 'dockview-vue'
import { WORKSPACE_TOOLBAR_ITEMS } from '@shared/workspaceToolbar'
import { BUILTIN_NODE_TYPES } from '@shared/graph'
import AssetBrowser from '../../components/AssetBrowser.vue'
import AssetCanvasEditor from '../../components/AssetCanvasEditor.vue'
import AssetEditor from '../../components/AssetEditor.vue'
import DirectorEditor from '../../components/DirectorEditor.vue'
import InspectorPanel from '../../components/InspectorPanel.vue'
import ScriptEditor from '../../components/ScriptEditor.vue'
import WorldElementEditor from '../../components/WorldElementEditor.vue'
import BeatAssetEditor from '../../components/BeatAssetEditor.vue'
import WorkspaceMain from '../../components/WorkspaceMain.vue'
import WorkspaceToolbar from '../../components/WorkspaceToolbar.vue'
import { BUILTIN_INSPECTORS } from '../../inspector/builtins'
import { activateExtension, registerExtensionManifest } from './registry'
import { registerBuiltinGraphCards } from '../../graph/cards/builtins'
import type { EditorWindowDefinition } from './types'
import type {
  AssetImporterDefinition,
  EditorCommandContribution
} from './contributions'

function panel(
  name: string,
  render: (props: Record<string, unknown>) => ReturnType<typeof h>,
  className = 'panel-fill'
): VueComponent {
  return markRaw(
    defineComponent({
      name,
      props: {
        params: { type: Object, required: false, default: () => ({}) }
      },
      setup(props) {
        return () => h('div', { class: className }, [render(props.params as Record<string, unknown>)])
      }
    })
  ) as unknown as VueComponent
}

function readParam(params: Record<string, unknown>, key: string): string {
  const nested = params.params
  if (nested && typeof nested === 'object' && key in nested) {
    return String((nested as Record<string, unknown>)[key] ?? '')
  }
  return String(params[key] ?? '')
}

const BUILTIN_WINDOWS: EditorWindowDefinition[] = [
  {
    id: 'workspace',
    createComponent: () => panel('DockWorkspace', () => h(WorkspaceMain))
  },
  {
    id: 'workspaceToolbar',
    createComponent: () =>
      panel(
        'DockWorkspaceToolbar',
        () => h(WorkspaceToolbar),
        'panel-fill workspace-tools-shell'
      )
  },
  {
    id: 'assets',
    createComponent: () => panel('DockAssets', () => h(AssetBrowser))
  },
  {
    id: 'inspector',
    createComponent: ({ exportCanvas }) =>
      panel('DockInspector', () => h(InspectorPanel, { exportCanvas }))
  },
  {
    id: 'assetEditor',
    createComponent: () =>
      panel('DockAssetEditor', (params) =>
        h(AssetEditor, { assetId: readParam(params, 'assetId') })
      )
  },
  {
    id: 'scriptEditor',
    createComponent: () =>
      panel('DockScriptEditor', (params) =>
        h(ScriptEditor, { scriptAssetId: readParam(params, 'scriptAssetId') })
      )
  },
  {
    id: 'canvasEditor',
    createComponent: () =>
      panel('DockCanvasEditor', (params) =>
        h(AssetCanvasEditor, { canvasAssetId: readParam(params, 'canvasAssetId') })
      )
  },
  {
    id: 'worldEditor',
    createComponent: () =>
      panel('DockWorldEditor', (params) =>
        h(WorldElementEditor, { worldAssetId: readParam(params, 'worldAssetId') })
      )
  },
  {
    id: 'beatEditor',
    createComponent: () =>
      panel('DockBeatEditor', (params) =>
        h(BeatAssetEditor, { beatAssetId: readParam(params, 'beatAssetId') })
      )
  },
  {
    id: 'directorEditor',
    createComponent: () =>
      panel('DockDirectorEditor', (params) =>
        h(DirectorEditor, { directorAssetId: readParam(params, 'directorAssetId') })
      )
  }
]

const BUILTIN_COMMANDS: EditorCommandContribution[] = [
  {
    id: 'editor.undo',
    title: 'Undo',
    shortcut: 'Ctrl+Z',
    when: (kernel) => kernel.commands.canUndo.value,
    run: (kernel) => kernel.commands.undo()
  },
  {
    id: 'editor.redo',
    title: 'Redo',
    shortcut: 'Ctrl+Shift+Z',
    when: (kernel) => kernel.commands.canRedo.value,
    run: (kernel) => kernel.commands.redo()
  },
  {
    id: 'editor.saveAll',
    title: 'Save All',
    shortcut: 'Ctrl+S',
    when: (kernel) => kernel.documents.hasDirtyDocuments.value,
    run: (kernel) => kernel.documents.saveAll()
  }
]

const BUILTIN_IMPORTERS: AssetImporterDefinition[] = [
  { id: 'core.image', assetType: 'image', label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
  { id: 'core.video', assetType: 'video', label: 'Videos', extensions: ['mp4', 'mov', 'webm'] },
  { id: 'core.audio', assetType: 'voice', label: 'voice', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
  { id: 'core.model', assetType: 'model', label: 'Models', extensions: ['glb', 'gltf', 'fbx'] }
]

export const CORE_EDITOR_EXTENSION_ID = 'aiartengine.core'

let activated = false

export function activateBuiltinExtensions(): void {
  if (activated) return
  activated = true
  registerBuiltinGraphCards()
  registerExtensionManifest({
    id: CORE_EDITOR_EXTENSION_ID,
    version: '1.0.0',
    apiVersion: 1,
    displayName: 'AIArtEngine Core',
    inspectors: BUILTIN_INSPECTORS,
    windows: BUILTIN_WINDOWS,
    nodeTypes: BUILTIN_NODE_TYPES,
    toolbarItems: WORKSPACE_TOOLBAR_ITEMS,
    commands: BUILTIN_COMMANDS,
    importers: BUILTIN_IMPORTERS
  })
  activateExtension(CORE_EDITOR_EXTENSION_ID)
}
