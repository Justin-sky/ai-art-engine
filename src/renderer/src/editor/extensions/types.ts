import type { Component } from 'vue'
import type { VueComponent } from 'dockview-vue'
import type {
  NodeTypeDefinition,
  GraphScopeDefinition,
  GraphScopeHostBinding,
  GraphPolicyPartial
} from '@shared/graph'
import type { GraphCardDefinition } from '../../graph/cards/types'
import type { WorkspaceToolbarItem } from '@shared/workspaceToolbar'
import type { InspectorDefinition } from '../../inspector/types'
import type { EditorKernel } from '../kernel'
import type {
  AssetImporterDefinition,
  EditorCommandContribution,
  PropertyDrawerDefinition
} from './contributions'

export interface EditorWindowFactoryContext {
  t: (key: string, params?: Record<string, unknown>) => string
  exportCanvas: () => Promise<string | null>
}

export interface EditorWindowDefinition {
  /** Dockview component id，布局文件会持久化该值。 */
  id: string
  createComponent: (context: EditorWindowFactoryContext) => VueComponent
  /** 允许布局兼容检查使用。 */
  persistent?: boolean
}

export interface EditorExtensionContext {
  kernel: EditorKernel
  registerInspector: (definition: InspectorDefinition) => () => void
  registerWindow: (definition: EditorWindowDefinition) => () => void
  registerPropertyDrawer: (definition: PropertyDrawerDefinition) => () => void
  registerImporter: (definition: AssetImporterDefinition) => () => void
  registerCommand: (definition: EditorCommandContribution) => () => void
  registerGraphScope: (definition: GraphScopeDefinition) => () => void
  registerGraphScopeHost: (binding: GraphScopeHostBinding) => () => void
  registerGraphCard: (definition: GraphCardDefinition) => () => void
}

export interface EditorExtensionManifest {
  id: string
  version: string
  apiVersion: 1
  displayName: string
  dependencies?: string[]
  activationOrder?: number
  permissions?: EditorPluginPermission[]
  inspectors?: InspectorDefinition[]
  windows?: EditorWindowDefinition[]
  nodeTypes?: NodeTypeDefinition[]
  graphScopes?: GraphScopeDefinition[]
  graphScopeHosts?: GraphScopeHostBinding[]
  /** 合并到内置图策略（可添加节点 + 连线白名单） */
  graphPolicy?: GraphPolicyPartial
  toolbarItems?: WorkspaceToolbarItem[]
  propertyDrawers?: PropertyDrawerDefinition[]
  importers?: AssetImporterDefinition[]
  commands?: EditorCommandContribution[]
  activate?: (context: EditorExtensionContext) => void | (() => void)
}

export type EditorPluginPermission =
  | 'workspace.read'
  | 'workspace.write'
  | 'filesystem.read'
  | 'generation.run'

export interface ActiveEditorExtension {
  manifest: EditorExtensionManifest
  deactivate: () => void
}

/** 供 Feature 模块导出普通 Vue 组件时使用。 */
export type EditorComponent = Component
