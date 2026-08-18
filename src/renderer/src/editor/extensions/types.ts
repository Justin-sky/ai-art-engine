import type { Component } from 'vue'
import type { VueComponent } from 'dockview-vue'

export interface EditorWindowFactoryContext {
  t: (key: string, params?: Record<string, unknown>) => string
}

export interface EditorWindowDefinition {
  /** Dockview component id，布局文件会持久化该值。 */
  id: string
  createComponent: (context: EditorWindowFactoryContext) => VueComponent
  /** 允许布局兼容检查使用。 */
  persistent?: boolean
}

export type EditorPluginPermission =
  | 'workspace.read'
  | 'workspace.write'
  | 'filesystem.read'
  | 'generation.run'

export interface EditorPluginManifest {
  id: string
  version: string
  apiVersion: 1
  displayName?: string
  permissions?: EditorPluginPermission[]
}

/** 供 Feature 模块导出普通 Vue 组件时使用。 */
export type EditorComponent = Component
