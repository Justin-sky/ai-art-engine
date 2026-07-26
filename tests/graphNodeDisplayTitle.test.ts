import { describe, expect, it } from 'vitest'
import { createOutputGraphNode, SHOT_VISUAL_OUTPUT_TITLE } from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import { resolveGraphNodeDisplayTitle } from '../src/renderer/src/features/graph/model/graphNodeDisplayTitle'

describe('resolveGraphNodeDisplayTitle', () => {
  it('maps visual stock output title to i18n 图片输出', () => {
    const node = createOutputGraphNode('image', { x: 0, y: 0 }, {
      id: graphOutputNodeId('image'),
      title: SHOT_VISUAL_OUTPUT_TITLE,
      params: { outputKind: 'image' }
    })
    const title = resolveGraphNodeDisplayTitle(node, {
      scope: 'visual',
      t: (key) => (key === 'graph.titles.shotVisualOutput' ? '图片输出' : key),
      graphTypeLabel: (typeId) => typeId,
      fallbackId: node.id
    })
    expect(title).toBe('图片输出')
  })

  it('keeps user-customized output titles', () => {
    const node = createOutputGraphNode('image', { x: 0, y: 0 }, {
      id: graphOutputNodeId('image'),
      title: '我的输出',
      params: { outputKind: 'image' }
    })
    const title = resolveGraphNodeDisplayTitle(node, {
      scope: 'visual',
      t: (key) => key,
      graphTypeLabel: (typeId) => typeId,
      fallbackId: node.id
    })
    expect(title).toBe('我的输出')
  })
})
