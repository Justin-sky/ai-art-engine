import { Context, type ForkScope } from '@cordisjs/core'
import { bindEditorKernel, createEditorKernel } from '../kernel'
import { corePlugin } from '../plugins/core'
import { loadExternalPlugins } from '../plugins/external'
import { EditorHub } from './hub'
import './types'

let root: Context | null = null

export function useEditorContext(): Context {
  if (!root) throw new Error('Editor Cordis runtime has not started')
  return root
}

export function isEditorRuntimeStarted(): boolean {
  return root !== null
}

export async function startEditorRuntime(): Promise<Context> {
  if (root) return root
  const ctx = new Context()
  const kernel = createEditorKernel()
  bindEditorKernel(kernel)
  ctx.set('kernel', kernel)
  ctx.plugin(EditorHub)
  ctx.plugin(corePlugin)
  await ctx.start()
  await loadExternalPlugins(ctx)
  root = ctx
  return ctx
}

export async function stopEditorRuntime(): Promise<void> {
  if (!root) return
  const ctx = root
  root = null
  await ctx.stop()
}

export function loadEditorPlugin(plugin: Parameters<Context['plugin']>[0], config?: unknown): ForkScope {
  return useEditorContext().plugin(plugin, config)
}
