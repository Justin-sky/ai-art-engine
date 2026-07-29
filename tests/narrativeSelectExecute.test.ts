import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createAssetGraphNode,
  createNodeFromType,
  executeSelectNarrativeNode,
  formatNarrativeUnitRefText,
  getNodePorts,
  GraphPortType,
  stringifyNarrativeUnitRows,
  type NarrativeUnitRow,
  type NodeExecuteContext
} from '../src/shared/graph'

function unit(id: string, order: number, title: string): NarrativeUnitRow {
  return {
    id,
    title,
    order,
    summary: `${title} summary`,
    dramaticFunction: '',
    characters: [],
    scenes: [],
    props: [],
    weapons: [],
    sourceExcerpt: '',
    emotionalBeat: '',
    durationHint: '',
    status: '未审核'
  }
}

describe('narrative.select node', () => {
  it('has narrative in and text out', () => {
    const node = createNodeFromType('narrative.select', { x: 0, y: 0 })
    expect(getNodePorts(node).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.narrative],
      ['out', GraphPortType.text]
    ])
  })

  it('connects catalog → select → shotSplit / script host', () => {
    const catalog = createNodeFromType('narrative.table', { x: 0, y: 0 })
    const select = createNodeFromType('narrative.select', { x: 120, y: 0 })
    const split = createNodeFromType('script.shotSplit', { x: 240, y: 0 })
    const script = createAssetGraphNode(
      '00000000-0000-4000-8000-000000000801',
      'script',
      'Shot',
      { x: 240, y: 80 },
      { assetHost: true }
    )
    expect(canConnectNodes(catalog, select)).toBe(true)
    expect(canConnectNodes(select, split)).toBe(true)
    expect(canConnectNodes(select, script, { targetPort: 'in-narrativeEntity' })).toBe(true)
  })

  it('picks selected unit as text', () => {
    const rows = [unit('u1', 1, '开场'), unit('u2', 2, '冲突')]
    const node = createNodeFromType('narrative.select', { x: 0, y: 0 }, {
      params: { selectedUnitId: 'u2' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [{ kind: GraphPortType.narrative, text: stringifyNarrativeUnitRows(rows) }]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeSelectNarrativeNode(ctx)
    expect(result.out?.kind).toBe(GraphPortType.text)
    expect(result.out && 'text' in result.out ? result.out.text : '').toBe(
      formatNarrativeUnitRefText(rows[1]!)
    )
    expect(result.out && 'text' in result.out ? result.out.text : '').not.toContain('"id"')
    expect(patched[0]).toMatchObject({ selectedUnitId: 'u2' })
  })

  it('defaults to first unit when none selected', () => {
    const rows = [unit('u1', 1, '开场'), unit('u2', 2, '冲突')]
    const node = createNodeFromType('narrative.select', { x: 0, y: 0 })
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [{ kind: GraphPortType.narrative, text: stringifyNarrativeUnitRows(rows) }]
      }
    }
    const result = executeSelectNarrativeNode(ctx)
    expect(result.out?.kind).toBe(GraphPortType.text)
    expect(node.params.selectedUnitId).toBe('u1')
    expect(result.out && 'text' in result.out ? result.out.text : '').toBe(
      formatNarrativeUnitRefText(rows[0]!)
    )
    expect(result.out && 'text' in result.out ? result.out.text : '').toContain('#1 开场')
  })
})
