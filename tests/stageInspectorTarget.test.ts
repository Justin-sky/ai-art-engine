import { describe, expect, it } from 'vitest'
import type { InspectorTarget } from '../src/renderer/src/inspector/types'
import {
  bindLiveDirectorStageScene,
  clearActiveDirectorStageScene,
  setActiveDirectorStageScene
} from '../src/renderer/src/features/director/activeDirectorStageScene'
import type { DirectorStageSceneApi } from '../src/renderer/src/features/director/useDirectorStageScene'

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

  it('does not throw during dive exit teardown after clearActiveDirectorStageScene', () => {
    let skeletonCleared = false
    const mockScene = {
      directorAssetId: 'dir-1',
      setPoseSkeletonVisible: (id: string | null) => {
        if (id === null) skeletonCleared = true
      }
    } as unknown as DirectorStageSceneApi

    setActiveDirectorStageScene(mockScene)
    const live = bindLiveDirectorStageScene(null)
    expect(live.directorAssetId).toBe('dir-1')

    // Simulate EditorDiveDirectorStageView unmounting before DirectorStageInspector finishes unmounting
    clearActiveDirectorStageScene(mockScene)
    expect(() => live.setPoseSkeletonVisible(null)).not.toThrow()
    expect(skeletonCleared).toBe(true)
  })
})
