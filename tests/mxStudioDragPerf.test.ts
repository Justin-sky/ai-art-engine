import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { createEmptyMxDocument, createMxNode } from '../src/shared/gameAssets'
import { createMxStudioStore } from '../src/renderer/src/components/dive/machinations/mxStudioStore'

describe('MxStudioStore zero-clone geometry drag & topologyRevision isolation', () => {
  it('commits node drag positions without deep-cloning untouched subtrees or bumping topologyRevision', () => {
    const initDoc = createEmptyMxDocument('drag-perf-doc')
    const n1 = { ...createMxNode('source', 100, 120, 'Mine'), id: 'n1' }
    const n2 = { ...createMxNode('pool', 260, 120, 'Gold'), id: 'n2', initial: 10 }
    const n3 = { ...createMxNode('drain', 420, 120, 'Shop'), id: 'n3' }
    initDoc.nodes = [n1, n2, n3]
    initDoc.edges = [
      { id: 'e1', kind: 'resource', from: 'n1', to: 'n2', formula: '2' },
      { id: 'e2', kind: 'resource', from: 'n2', to: 'n3', formula: '1' }
    ]

    const store = createMxStudioStore(initDoc)
    const beforeDocRev = store.docRevision.value
    const beforeTopoRev = store.topologyRevision.value
    const untouchedNodeRef = store.doc.value.nodes[2]!
    const untouchedEdgesRef = store.doc.value.edges
    const untouchedWorkbenchRef = store.doc.value.workbench

    // Track how many times a topology-only computed (like formula/health/consumer analysis) re-runs
    let topologyEvalCount = 0
    const formulaSummary = computed(() => {
      void store.topologyRevision.value
      topologyEvalCount++
      const raw = store.peekDoc()
      return raw.edges.map((e) => `${e.id}:${e.formula}`).join('|')
    })
    expect(formulaSummary.value).toBe('e1:2|e2:1')
    expect(topologyEvalCount).toBe(1)

    // No-op commit should not bump revisions or push undo history
    store.commitNodePositions(new Map([['n1', { x: 100, y: 120 }]]), 'drag:noop')
    expect(store.docRevision.value).toBe(beforeDocRev)
    expect(store.canUndo.value).toBe(false)

    // Real drag commit on n1
    store.commitNodePositions(new Map([['n1', { x: 180, y: 200 }]]), 'drag:1')
    expect(store.doc.value.nodes[0]!.x).toBe(180)
    expect(store.doc.value.nodes[0]!.y).toBe(200)
    expect(store.docRevision.value).toBe(beforeDocRev + 1)
    expect(store.topologyRevision.value).toBe(beforeTopoRev)

    // Untouched node, edges array, and workbench retain exact object identity (zero deep clone)
    expect(store.doc.value.nodes[2]).toBe(untouchedNodeRef)
    expect(store.doc.value.edges).toBe(untouchedEdgesRef)
    expect(store.doc.value.workbench).toBe(untouchedWorkbenchRef)

    // Reading topology computed again incurs zero re-evaluation
    expect(formulaSummary.value).toBe('e1:2|e2:1')
    expect(topologyEvalCount).toBe(1)

    // Updating a formula DOES bump topologyRevision and invalidates topology computed
    store.updateEdge('e1', { formula: '5' })
    expect(store.topologyRevision.value).toBe(beforeTopoRev + 1)
    expect(formulaSummary.value).toBe('e1:5|e2:1')
    expect(topologyEvalCount).toBe(2)

    // Undo formula edit -> back to dragged position; Undo drag -> back to original position
    store.undo()
    expect(formulaSummary.value).toBe('e1:2|e2:1')
    expect(store.doc.value.nodes[0]!.x).toBe(180)

    store.undo()
    expect(store.doc.value.nodes[0]!.x).toBe(100)
    expect(store.doc.value.nodes[0]!.y).toBe(120)

    store.redo()
    expect(store.doc.value.nodes[0]!.x).toBe(180)
    expect(store.doc.value.nodes[0]!.y).toBe(200)
  })

  it('commits group move, group resize, and edge bend atomically without bumping topologyRevision', () => {
    const initDoc = createEmptyMxDocument('group-and-bend-doc')
    initDoc.nodes = [
      { ...createMxNode('source', 60, 60, 'Src'), id: 'n_in' },
      { ...createMxNode('pool', 500, 500, 'Outside'), id: 'n_out' }
    ]
    initDoc.edges = [{ id: 'e_arc', kind: 'resource', from: 'n_in', to: 'n_out', formula: '3' }]
    initDoc.groups = [
      {
        id: 'grp_1',
        label: 'Core Loop',
        x: 20,
        y: 20,
        width: 200,
        height: 160,
        color: '#3b82f6'
      }
    ]

    const store = createMxStudioStore(initDoc)
    const initialTopo = store.topologyRevision.value

    store.commitGroupMove('grp_1', 120, 100, new Map([['n_in', { x: 160, y: 140 }]]), 'grpDrag:1')
    expect(store.doc.value.groups![0]!.x).toBe(120)
    expect(store.doc.value.groups![0]!.y).toBe(100)
    expect(store.doc.value.nodes[0]!.x).toBe(160)
    expect(store.doc.value.nodes[0]!.y).toBe(140)
    expect(store.doc.value.nodes[1]!.x).toBe(500)
    expect(store.topologyRevision.value).toBe(initialTopo)

    store.commitGroupResize('grp_1', 320, 240, 'grpResize:1')
    expect(store.doc.value.groups![0]!.width).toBe(320)
    expect(store.doc.value.groups![0]!.height).toBe(240)
    expect(store.topologyRevision.value).toBe(initialTopo)

    store.commitEdgeBend('e_arc', 48, 'bend:1')
    expect(store.doc.value.edges[0]!.bend).toBe(48)
    expect(store.topologyRevision.value).toBe(initialTopo)

    // Undo all 3 geometry commits cleanly in reverse order
    store.undo()
    expect(store.doc.value.edges[0]!.bend).toBeUndefined()
    store.undo()
    expect(store.doc.value.groups![0]!.width).toBe(200)
    store.undo()
    expect(store.doc.value.groups![0]!.x).toBe(20)
    expect(store.doc.value.nodes[0]!.x).toBe(60)
  })
})
