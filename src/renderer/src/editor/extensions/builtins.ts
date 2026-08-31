import { defineAsyncComponent, defineComponent, h, markRaw } from 'vue'
import type { VueComponent } from 'dockview-vue'
import { WORKSPACE_TOOLBAR_ITEMS } from '@shared/workspaceToolbar'
import AssetBrowser from '../../components/AssetBrowser.vue'
import AssetCanvasEditor from '../../components/AssetCanvasEditor.vue'
import ChatPanel from '../../components/ChatPanel.vue'
import InspectorPanel from '../../components/InspectorPanel.vue'
import WorkspaceMain from '../../components/WorkspaceMain.vue'
import WorkspaceToolbar from '../../components/WorkspaceToolbar.vue'

/**
 * 各资源编辑器体积大且依赖 editor/graph 模型，必须异步加载：
 * 1) 避免与主编辑器互相静态引用形成循环依赖；
 * 2) 打开对应 dock 面板时才加载，减小首屏体积。
 * 注意：不得改回静态 import，否则 EditorDiveChildHost / EditorDiveUiSplitView
 * 中的动态导入将无法拆包。
 */
const AssetEditor = defineAsyncComponent(() => import('../../components/AssetEditor.vue'))
const DirectorEditor = defineAsyncComponent(() => import('../../components/DirectorEditor.vue'))
const WorldElementEditor = defineAsyncComponent(() => import('../../components/WorldElementEditor.vue'))
const BeatAssetEditor = defineAsyncComponent(() => import('../../components/BeatAssetEditor.vue'))
import { BUILTIN_INSPECTORS } from '../../inspector/builtins'
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

export const BUILTIN_WINDOWS: EditorWindowDefinition[] = [
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
    createComponent: () => panel('DockInspector', () => h(InspectorPanel))
  },
  {
    id: 'chat',
    createComponent: () => panel('DockChat', () => h(ChatPanel))
  },
  {
    id: 'assetEditor',
    createComponent: () =>
      panel('DockAssetEditor', (params) =>
        h(AssetEditor, { assetId: readParam(params, 'assetId') })
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

export const BUILTIN_COMMANDS: EditorCommandContribution[] = [
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

export const BUILTIN_IMPORTERS: AssetImporterDefinition[] = [
  { id: 'core.image', assetType: 'image', label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
  { id: 'core.video', assetType: 'video', label: 'Videos', extensions: ['mp4', 'mov', 'webm'] },
  { id: 'core.audio', assetType: 'voice', label: 'voice', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
  { id: 'core.model', assetType: 'model', label: 'Models', extensions: ['glb', 'gltf', 'fbx'] }
]

export const CORE_EDITOR_PLUGIN_ID = 'aiartengine.core'
export const CORE_EDITOR_EXTENSION_ID = CORE_EDITOR_PLUGIN_ID

export {
  BUILTIN_INSPECTORS,
  WORKSPACE_TOOLBAR_ITEMS
}
