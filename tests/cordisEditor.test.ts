import { Context } from '@cordisjs/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  executePassthrough,
  getExecutor,
  getGraphSkill,
  getNodeType,
  GraphPortType,
  listGraphScopes
} from '../src/shared/graph'
import { createEditorKernel } from '../src/renderer/src/editor/kernel'
import { EditorHub } from '../src/renderer/src/editor/runtime/hub'
import '../src/renderer/src/editor/runtime/types'

const DEMO_TYPE = 'plugin.test.cordis.node'
const DEMO_SCOPE = 'plugin.test.cordis.scope'

function demoPlugin(ctx: Context): void {
  ctx.editor.record({
    id: 'plugin.test.cordis',
    version: '1.0.0',
    displayName: 'Cordis Test',
    source: 'demo'
  })
  ctx.editor.nodeType({
    typeId: DEMO_TYPE,
    category: 'note',
    label: 'Cordis',
    defaultTitle: 'Cordis',
    defaultSize: { w: 160, h: 100 },
    sizeLimits: { minW: 80, minH: 60, maxW: 400, maxH: 300 },
    ports: [{ id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true }],
    defaultParams: () => ({ text: '' }),
    addable: true,
    inspector: 'note',
    card: 'note',
    execute: executePassthrough
  })
  ctx.editor.graphScope({
    id: DEMO_SCOPE,
    output: { kind: 'image', title: 'Test' }
  })
}

demoPlugin.inject = ['editor']

async function boot(): Promise<Context> {
  const ctx = new Context()
  ctx.set('kernel', createEditorKernel())
  ctx.plugin(EditorHub)
  await ctx.start()
  return ctx
}

describe('Cordis editor runtime', () => {
  let ctx: Context | null = null

  afterEach(async () => {
    if (ctx) {
      await ctx.stop()
      ctx = null
    }
  })

  it('exposes kernel as a service', async () => {
    ctx = await boot()
    expect(ctx.kernel.commands).toBeTruthy()
    expect(ctx.editor).toBeInstanceOf(EditorHub)
  })

  it('registers contributions through a plugin and rolls them back on dispose', async () => {
    ctx = await boot()
    const fork = ctx.plugin(demoPlugin)
    expect(getNodeType(DEMO_TYPE)?.label).toBe('Cordis')
    expect(listGraphScopes().some((scope) => scope.id === DEMO_SCOPE)).toBe(true)
    expect(ctx.editor.plugins.value.some((plugin) => plugin.id === 'plugin.test.cordis')).toBe(true)

    fork.dispose()
    expect(getNodeType(DEMO_TYPE)).toBeUndefined()
    expect(listGraphScopes().some((scope) => scope.id === DEMO_SCOPE)).toBe(false)
    expect(ctx.editor.plugins.value.some((plugin) => plugin.id === 'plugin.test.cordis')).toBe(false)
  })

  it('overlays a node executor through ctx.editor.executor and rolls it back', async () => {
    ctx = await boot()
    const overlayType = 'plugin.test.cordis.executor'
    const overlay = Object.assign(
      () => ({ out: { kind: 'text' as const, text: 'from-plugin' } }),
      { tag: 'cordis-executor-overlay' as const }
    )
    function overlayPlugin(pluginCtx: Context): void {
      pluginCtx.editor.executor(overlayType, overlay)
    }
    overlayPlugin.inject = ['editor']
    const fork = ctx.plugin(overlayPlugin)
    expect(getExecutor(overlayType)).toBeTruthy()
    expect((getExecutor(overlayType) as { tag?: string } | undefined)?.tag).toBe(
      'cordis-executor-overlay'
    )
    fork.dispose()
    expect(getExecutor(overlayType)).toBeUndefined()
  })

  it('registers a GraphSkill through ctx.editor.skill and rolls it back', async () => {
    ctx = await boot()
    const skillId = 'plugin.test.cordis.skill'
    function skillPlugin(pluginCtx: Context): void {
      pluginCtx.editor.skill({
        id: skillId,
        kind: 'system',
        titleZh: 'Cordis Skill',
        titleEn: 'Cordis Skill',
        instructionZh: 'from-plugin'
      })
    }
    skillPlugin.inject = ['editor']
    const fork = ctx.plugin(skillPlugin)
    expect(getGraphSkill(skillId)?.instructionZh).toBe('from-plugin')
    fork.dispose()
    expect(getGraphSkill(skillId)).toBeUndefined()
  })
})
