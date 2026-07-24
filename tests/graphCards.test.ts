import { defineComponent, type Component } from 'vue'
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { createNodeFromType, registerNodeType, unregisterNodeType } from '../src/shared/graph'
import {
  DEFAULT_GRAPH_CARD_IDS,
  registerGraphCard,
  resolveGraphCard
} from '../src/renderer/src/graph/cards/registry'

const MockCard = defineComponent({ template: '<div />' }) as unknown as Component

const cardDisposers = [
  registerGraphCard({
    id: DEFAULT_GRAPH_CARD_IDS.note,
    order: 0,
    match: (_node, typeDef) => typeDef?.card === 'note',
    component: MockCard
  }),
  registerGraphCard({
    id: DEFAULT_GRAPH_CARD_IDS.media,
    order: 10,
    match: (_node, typeDef) => typeDef?.card === 'media',
    component: MockCard
  }),
  registerGraphCard({
    id: 'plugin.test.card',
    order: 5,
    match: () => true,
    component: MockCard
  })
]

beforeAll(() => {
  registerNodeType({
    typeId: 'plugin.test',
    category: 'note',
    label: 'Test',
    defaultTitle: 'Test',
    defaultSize: { w: 120, h: 80 },
    sizeLimits: { minW: 80, minH: 60, maxW: 400, maxH: 300 },
    ports: [],
    defaultParams: () => ({}),
    inspector: 'note',
    card: 'note',
    cardId: 'plugin.test.card',
    deletable: true
  })
})

afterAll(() => {
  for (const dispose of cardDisposers) dispose()
  unregisterNodeType('plugin.test')
})

describe('graph card registry', () => {
  it('resolves default cards by card kind', () => {
    const note = createNodeFromType('note.text', { x: 0, y: 0 })
    const image = createNodeFromType('asset.image', { x: 0, y: 0 })
    expect(resolveGraphCard(note)?.definition.id).toBe(DEFAULT_GRAPH_CARD_IDS.note)
    expect(resolveGraphCard(image)?.definition.id).toBe(DEFAULT_GRAPH_CARD_IDS.media)
  })

  it('prefers explicit cardId on node type', () => {
    const node = createNodeFromType('plugin.test', { x: 0, y: 0 })
    expect(resolveGraphCard(node)?.definition.id).toBe('plugin.test.card')
  })
})
