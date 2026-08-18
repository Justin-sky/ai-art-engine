import { Service, type Context } from '@cordisjs/core'
import { shallowRef } from 'vue'
import {
  mergeGraphPolicy,
  registerExecutor,
  registerGraphScope,
  registerGraphScopeHost,
  registerGraphSkill,
  registerNodeType,
  unregisterNodeType,
  type GraphPolicyPartial,
  type GraphScopeDefinition,
  type GraphScopeHostBinding,
  type GraphSkill,
  type NodeExecuteFn,
  type NodeTypeDefinition
} from '@shared/graph'
import type { WorkspaceToolbarItem } from '@shared/workspaceToolbar'
import { registerGraphCard } from '../../graph/cards/registry'
import type { GraphCardDefinition } from '../../graph/cards/types'
import { registerInspector } from '../../inspector/registry'
import type { InspectorDefinition } from '../../inspector/types'
import {
  registerAssetImporter,
  registerEditorCommand,
  registerPropertyDrawer,
  type AssetImporterDefinition,
  type EditorCommandContribution,
  type PropertyDrawerDefinition
} from '../extensions/contributions'
import { registerEditorWindow, registerToolbarItem } from '../extensions/slots'
import type { EditorWindowDefinition } from '../extensions/types'
import type { EditorPluginInfo } from './types'

/** 用调用方 ctx 收集副作用，插件 dispose 时自动回滚。 */
function bind(ctx: Context, setup: () => () => void): () => void {
  return ctx.effect(setup)
}

export class EditorHub extends Service {
  static inject = ['kernel']

  readonly plugins = shallowRef<EditorPluginInfo[]>([])

  constructor(ctx: Context) {
    super(ctx, 'editor', true)
  }

  record(info: EditorPluginInfo): () => void {
    return bind(this.ctx, () => {
      this.plugins.value = [...this.plugins.value.filter((item) => item.id !== info.id), info]
      return () => {
        this.plugins.value = this.plugins.value.filter((item) => item.id !== info.id)
      }
    })
  }

  window(definition: EditorWindowDefinition): () => void {
    return bind(this.ctx, () => registerEditorWindow(definition))
  }

  toolbarItem(item: WorkspaceToolbarItem): () => void {
    return bind(this.ctx, () => registerToolbarItem(item))
  }

  inspector(definition: InspectorDefinition): () => void {
    return bind(this.ctx, () => registerInspector(definition))
  }

  graphCard(definition: GraphCardDefinition): () => void {
    return bind(this.ctx, () => registerGraphCard(definition))
  }

  nodeType(definition: NodeTypeDefinition): () => void {
    return bind(this.ctx, () => {
      registerNodeType(definition)
      return () => unregisterNodeType(definition.typeId)
    })
  }

  /** 覆盖某 typeId 的执行器；卸载插件时回落到 NodeTypeDefinition.execute。 */
  executor(typeId: string, execute: NodeExecuteFn): () => void {
    return bind(this.ctx, () => registerExecutor(typeId, execute))
  }

  /** 登记 / 覆盖 GraphSkill；卸载插件时回落到内置目录。 */
  skill(definition: GraphSkill): () => void {
    return bind(this.ctx, () => registerGraphSkill(definition))
  }

  graphScope(definition: GraphScopeDefinition): () => void {
    return bind(this.ctx, () => registerGraphScope(definition))
  }

  graphScopeHost(binding: GraphScopeHostBinding): () => void {
    return bind(this.ctx, () => registerGraphScopeHost(binding))
  }

  graphPolicy(overlayId: string, partial: GraphPolicyPartial): () => void {
    return bind(this.ctx, () => mergeGraphPolicy(overlayId, partial))
  }

  propertyDrawer(definition: PropertyDrawerDefinition): () => void {
    return bind(this.ctx, () => registerPropertyDrawer(definition))
  }

  importer(definition: AssetImporterDefinition): () => void {
    return bind(this.ctx, () => registerAssetImporter(definition))
  }

  command(contribution: EditorCommandContribution): () => void {
    return bind(this.ctx, () => registerEditorCommand(contribution))
  }
}
