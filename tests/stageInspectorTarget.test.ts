import { describe, expect, it } from 'vitest'
import type { InspectorTarget } from '../src/renderer/src/inspector/types'

function isStageInspectorTarget(kind: string): boolean {
  return (
    kind === 'stage.object' ||
    kind === 'stage.camera' ||
    kind === 'stage.scene' ||
    kind === 'stage.panorama'
  )
}

describe('stage inspector target kinds', () => {
  it('matches all stage.* kinds used by builtins', () => {
    const kinds = ['stage.object', 'stage.camera', 'stage.scene', 'stage.panorama'] as const
    for (const kind of kinds) {
      const target: InspectorTarget = { kind, key: kind, subject: null }
      expect(isStageInspectorTarget(target.kind)).toBe(true)
    }
  })

  it('does not match asset or graph kinds', () => {
    expect(isStageInspectorTarget('asset')).toBe(false)
    expect(isStageInspectorTarget('graph.node')).toBe(false)
    expect(isStageInspectorTarget('shot')).toBe(false)
  })
})
