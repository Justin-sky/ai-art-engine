import { describe, expect, it } from 'vitest'
import {
  createOutputGraphNode,
  ASSET_TIMELINE_OUTPUT_TITLE,
  EPISODE_AGENT_STOCK_TITLES
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import {
  isStockGraphOutputTitle,
  resolveGraphNodeDisplayTitle
} from '../src/renderer/src/features/graph/model/graphNodeDisplayTitle'

describe('resolveGraphNodeDisplayTitle', () => {
  it('maps timeline stock output title to i18n 成片时间线', () => {
    const node = createOutputGraphNode('image', { x: 0, y: 0 }, {
      id: graphOutputNodeId('timeline'),
      title: ASSET_TIMELINE_OUTPUT_TITLE,
      params: { outputKind: 'video' }
    })
    const title = resolveGraphNodeDisplayTitle(node, {
      scope: 'canvasAsset',
      t: (key) => (key === 'graph.titles.timelineOutput' ? '成片时间线' : key),
      graphTypeLabel: (typeId) => typeId,
      fallbackId: node.id
    })
    expect(title).toBe('成片时间线')
  })

  it('keeps user-customized output titles', () => {
    const node = createOutputGraphNode('image', { x: 0, y: 0 }, {
      id: graphOutputNodeId('image'),
      title: '我的输出',
      params: { outputKind: 'image' }
    })
    const title = resolveGraphNodeDisplayTitle(node, {
      scope: 'canvasAsset',
      t: (key) => key,
      graphTypeLabel: (typeId) => typeId,
      fallbackId: node.id
    })
    expect(title).toBe('我的输出')
  })

  it('maps new English stock stage titles to i18n keys', () => {
    const node = {
      id: 'n1',
      typeId: 'prompt.optimize',
      category: 'tool',
      title: EPISODE_AGENT_STOCK_TITLES.breakdown
    }
    const title = resolveGraphNodeDisplayTitle(node as never, {
      t: (key) => key,
      graphTypeLabel: (typeId) => typeId,
      fallbackId: 'n1'
    })
    expect(title).toBe('graph.episodeAgent.title.beatBreakdown')
  })

  it('maps legacy chinese stage titles to i18n keys', () => {
    const node = {
      id: 'n2',
      typeId: 'prompt.optimize',
      category: 'tool',
      title: '分镜师·9宫格分镜表'
    }
    const title = resolveGraphNodeDisplayTitle(node as never, {
      t: (key) => key,
      graphTypeLabel: (typeId) => typeId,
      fallbackId: 'n2'
    })
    expect(title).toBe('graph.episodeAgent.title.grid9Storyboard')
  })

  it('composes legacy and new director review compound titles', () => {
    const make = (title: string) => ({
      id: 'n3',
      typeId: 'prompt.optimize',
      category: 'tool',
      title
    })
    const resolve = (title: string): string =>
      resolveGraphNodeDisplayTitle(make(title) as never, {
        t: (key) => key,
        graphTypeLabel: (typeId) => typeId,
        fallbackId: 'n3'
      })
    // 新一代复合标题
    expect(resolve(`${EPISODE_AGENT_STOCK_TITLES.directorReview} · ${EPISODE_AGENT_STOCK_TITLES.motion}`)).toBe(
      'graph.episodeAgent.title.directorReview · graph.episodeAgent.title.motionPrompt'
    )
    // 旧版中文复合标题
    expect(resolve('导演审核·节拍拆解表')).toBe(
      'graph.episodeAgent.title.directorReview · graph.episodeAgent.title.beatBreakdown'
    )
  })

  it('treats both generations of stage titles as stock', () => {
    expect(isStockGraphOutputTitle(EPISODE_AGENT_STOCK_TITLES.beatboard)).toBe(true)
    expect(isStockGraphOutputTitle('动画师·动态提示词表')).toBe(true)
    expect(isStockGraphOutputTitle('我的私有拆解表')).toBe(false)
  })
})
