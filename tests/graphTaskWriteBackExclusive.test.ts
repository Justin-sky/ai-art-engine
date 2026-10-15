import { describe, expect, it } from 'vitest'
import { writeBackExclusiveKey, type GraphTaskTarget } from '../src/renderer/src/stores/graphTasks'

describe('writeBackExclusiveKey', () => {
  it('串行化同一世界资产下四类 element 写回', () => {
    const characters: GraphTaskTarget = {
      kind: 'world-element',
      worldAssetId: 'world-1',
      elementKind: 'characters',
      hostId: 'h-characters'
    }
    const scenes: GraphTaskTarget = {
      kind: 'world-element',
      worldAssetId: 'world-1',
      elementKind: 'scenes',
      hostId: 'h-scenes'
    }
    const otherWorld: GraphTaskTarget = {
      kind: 'world-element',
      worldAssetId: 'world-2',
      elementKind: 'props',
      hostId: 'h-props'
    }

    expect(writeBackExclusiveKey(characters)).toBe('world-element:world-1')
    expect(writeBackExclusiveKey(scenes)).toBe('world-element:world-1')
    expect(writeBackExclusiveKey(characters)).toBe(writeBackExclusiveKey(scenes))
    expect(writeBackExclusiveKey(otherWorld)).toBe('world-element:world-2')
  })
})
