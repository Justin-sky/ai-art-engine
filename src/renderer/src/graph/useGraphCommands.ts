import type { GraphDocument } from '@shared/graph'
import { graphDocumentsEqual } from '@shared/graph'
import { useEditorKernel } from '../editor/kernel'

export interface GraphCommandOptions {
  scope: () => string
  buildSnapshot: () => GraphDocument
  applySnapshot: (snapshot: GraphDocument) => void
}

/** 节点图快照命令适配器；组件只负责描述一次交互的 before/after。 */
export function useGraphCommands(options: GraphCommandOptions) {
  const editor = useEditorKernel()

  function recordGraphChange(label: string, before: GraphDocument): void {
    const after = options.buildSnapshot()
    if (graphDocumentsEqual(before, after)) return
    const scope = options.scope()
    editor.commands.setActiveScope(scope)
    editor.commands.recordExecuted({
      id: `graph.${label}.${crypto.randomUUID()}`,
      label,
      scope,
      execute: () => options.applySnapshot(after),
      undo: () => options.applySnapshot(before)
    })
  }

  return { recordGraphChange }
}
