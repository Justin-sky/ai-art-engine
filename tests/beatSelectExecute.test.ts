import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSelectBeatNode,
  formatBeatRefText,
  getNodePorts,
  GraphPortType,
  stringifyBeatRows,
  type BeatRow,
  type NodeExecuteContext
} from '../src/shared/graph'

function unit(id: string, order: number, title: string): BeatRow {
  return {
    id,
    title,
    order,
    time: '',
    durationHint: '',
    location: '',
    locations: [],
    characters: [],
    action: `${title} action`,
    conflict: '',
    atmosphere: '',
    props: [],
    weapons: [],
    sourceExcerpt: '',
    status: '未审核'
  }
}

describe('beat.select node', () => {
  it('has beat in and text out', () => {
    const node = createNodeFromType('beat.select', { x: 0, y: 0 })
    expect(getNodePorts(node).map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.beat],
      ['out', GraphPortType.text]
    ])
  })

  it('connects catalog → select → text consumer', () => {
    const catalog = createNodeFromType('beat.table', { x: 0, y: 0 })
    const select = createNodeFromType('beat.select', { x: 120, y: 0 })
    const textSelect = createNodeFromType('text.select', { x: 240, y: 80 })
    expect(canConnectNodes(catalog, select)).toBe(true)
    expect(canConnectNodes(select, textSelect)).toBe(true)
  })

  it('picks selected unit as text', () => {
    const rows = [unit('u1', 1, '开场'), unit('u2', 2, '冲突')]
    const node = createNodeFromType('beat.select', { x: 0, y: 0 }, {
      params: { selectedBeatId: 'u2' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [{ kind: GraphPortType.beat, text: stringifyBeatRows(rows) }]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeSelectBeatNode(ctx)
    expect(result.out?.kind).toBe(GraphPortType.text)
    expect(result.out && 'text' in result.out ? result.out.text : '').toBe(
      formatBeatRefText(rows[1]!)
    )
    expect(result.out && 'text' in result.out ? result.out.text : '').not.toContain('"id"')
    expect(patched[0]).toMatchObject({ selectedBeatId: 'u2' })
  })

  it('defaults to first unit when none selected', () => {
    const rows = [unit('u1', 1, '开场'), unit('u2', 2, '冲突')]
    const node = createNodeFromType('beat.select', { x: 0, y: 0 })
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [{ kind: GraphPortType.beat, text: stringifyBeatRows(rows) }]
      }
    }
    const result = executeSelectBeatNode(ctx)
    expect(result.out?.kind).toBe(GraphPortType.text)
    expect(node.params.selectedBeatId).toBe('u1')
    expect(result.out && 'text' in result.out ? result.out.text : '').toBe(
      formatBeatRefText(rows[0]!)
    )
    expect(result.out && 'text' in result.out ? result.out.text : '').toContain('#1 开场')
  })

  it('accepts soft-snapshotted text catalog JSON', () => {
    const rows = [unit('u1', 1, '开场')]
    const node = createNodeFromType('beat.select', { x: 0, y: 0 })
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [{ kind: 'text', text: stringifyBeatRows(rows) }]
      }
    }
    const result = executeSelectBeatNode(ctx)
    expect(result.out && 'text' in result.out ? result.out.text : '').toBe(
      formatBeatRefText(rows[0]!)
    )
  })

  it('keeps existing preview when upstream catalog is missing', () => {
    const node = createNodeFromType('beat.select', { x: 0, y: 0 }, {
      params: { selectedBeatId: 'u1', text: '#1 开场\n动作' }
    })
    const ctx: NodeExecuteContext = {
      node,
      inputs: { in: [] }
    }
    const result = executeSelectBeatNode(ctx)
    expect(result.out).toEqual({ kind: 'text', text: '#1 开场\n动作' })
    expect(node.params.text).toBe('#1 开场\n动作')
    expect(node.params.selectedBeatId).toBe('u1')
  })
})
