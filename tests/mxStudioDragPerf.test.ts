import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  createEmptyMxDocument,
  createMxDocumentFromBuildingBlock,
  createMxNode,
  evaluateMxEdgeRuntimeGates,
  exportMxDiagramSvg,
  runMxSimulation
} from '../src/shared/gameAssets'
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

  it('separates Overflow Spillway Router state pills cleanly and surfaces gated-off -> 0 runtime labels', () => {
    const doc = createMxDocumentFromBuildingBlock('bb_overflow_spillway', 'zh')
    const run = runMxSimulation(doc, { steps: 6 })

    const ePrimary = doc.edges.find((e) => e.id.endsWith('_e2'))!
    const eOverflow = doc.edges.find((e) => e.id.endsWith('_e3'))!
    const eLess15 = doc.edges.find((e) => e.id.endsWith('_e4'))!
    const eGe15 = doc.edges.find((e) => e.id.endsWith('_e5'))!

    // Step 1: primary_pool is 11 (< 15) -> primary open, overflow gated off
    const step1Gates = evaluateMxEdgeRuntimeGates(doc, {
      values: run.snapshots[1],
      step: 1
    })
    expect(step1Gates.dormantStateEdgeIds.has(eLess15.id)).toBe(false)
    expect(step1Gates.dormantStateEdgeIds.has(eGe15.id)).toBe(true)
    expect(step1Gates.gatedOffEdgeIds.has(ePrimary.id)).toBe(false)
    expect(step1Gates.gatedOffEdgeIds.has(eOverflow.id)).toBe(true)

    // Step 4: primary_pool is 15 (>= 15) -> primary gated off (1 -> 0), overflow open (1 -> 3)
    const step4Gates = evaluateMxEdgeRuntimeGates(doc, {
      values: run.snapshots[4],
      step: 4
    })
    expect(step4Gates.dormantStateEdgeIds.has(eLess15.id)).toBe(true)
    expect(step4Gates.dormantStateEdgeIds.has(eGe15.id)).toBe(false)
    expect(step4Gates.gatedOffEdgeIds.has(ePrimary.id)).toBe(true)
    expect(step4Gates.gatedOffEdgeIds.has(eOverflow.id)).toBe(false)

    const svgStep4 = exportMxDiagramSvg(doc, {
      displayValues: run.snapshots[4],
      displayFlows: run.edgeFlows[4],
      playStep: 4
    })
    // Machinations-authentic pills show pure formula/rate ('3', '1') without '-> flow' suffix, while dimming gated-off edges
    expect(svgStep4.svgText).not.toContain('-&gt;')
    expect(svgStep4.svgText).toContain('>3</text>')
    expect(svgStep4.svgText).toContain('>1</text>')
    expect(svgStep4.svgText).toContain('stroke-dasharray="3 2"')

    // Extract pill translate(x, y) coordinates and ensure all 5 edge pills have >= 45px pairwise separation
    const pillCoords = Array.from(
      svgStep4.svgText.matchAll(
        /<g class="mx-edge-pill"[^>]*transform="translate\(([-\d.]+),\s*([-\d.]+)\)"/g
      )
    ).map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    expect(pillCoords).toHaveLength(5)
    for (let i = 0; i < pillCoords.length; i++) {
      for (let j = i + 1; j < pillCoords.length; j++) {
        const dist = Math.hypot(
          pillCoords[i]!.x - pillCoords[j]!.x,
          pillCoords[i]!.y - pillCoords[j]!.y
        )
        expect(dist).toBeGreaterThanOrEqual(45)
      }
    }
  })

  it('surfaces real-time modified edge formulas (+1, %, D6, +1i, state-to-state) on runtime pills', () => {
    // 1) User scenario: Overflow Spillway Router with e5 changed from >=15 to +1
    const spillwayDoc = createMxDocumentFromBuildingBlock('bb_overflow_spillway', 'zh')
    const eOverflow = spillwayDoc.edges.find((e) => e.id.endsWith('_e3'))!
    const eStateMod = spillwayDoc.edges.find((e) => e.id.endsWith('_e5'))!
    eStateMod.formula = '+1'

    const spillwayRun = runMxSimulation(spillwayDoc, { steps: 45 })
    // Early step (step 4): primary_pool is 10 -> eOverflow weight 1 + 1 * 10 = 11
    const gatesStep4 = evaluateMxEdgeRuntimeGates(spillwayDoc, {
      values: spillwayRun.snapshots[4],
      step: 4
    })
    expect(gatesStep4.modifiedEdgeFormulas.get(eOverflow.id)).toBe('11')

    // Once primary_pool reaches capacity 15 (step 45) -> eOverflow weight 1 + 1 * 15 = 16
    const gatesAtFull = evaluateMxEdgeRuntimeGates(spillwayDoc, {
      values: spillwayRun.snapshots[45],
      step: 45
    })
    expect(gatesAtFull.modifiedEdgeFormulas.get(eOverflow.id)).toBe('16')

    // Edit mode (playStep = 0) preserves authored formula '1'
    const svgEditMode = exportMxDiagramSvg(spillwayDoc, { playStep: 0 })
    expect(svgEditMode.svgText).not.toContain('>16</text>')

    // Runtime (playStep = 45) renders Machinations-style '16' directly inside the overflow branch pill
    const svgRuntime = exportMxDiagramSvg(spillwayDoc, {
      displayValues: spillwayRun.snapshots[45],
      displayFlows: spillwayRun.edgeFlows[45],
      playStep: 45
    })
    expect(svgRuntime.svgText).toContain('>16</text>')
    expect(svgRuntime.svgText).not.toContain('-&gt;')

    // 2) Node-level Source modifier, % probability modifier, D6 dice modifier, +1i interval, and state-to-state cascade
    const custom = createEmptyMxDocument('runtime-mod-formulas')
    const src = { ...createMxNode('source', 80, 100, 'Mine'), id: 'src', color: '#8b5cf6' }
    const boostPool = { ...createMxNode('pool', 80, 240, 'Boost'), id: 'p_boost', initial: 3 }
    const scalePool = { ...createMxNode('pool', 240, 240, 'Scale'), id: 'p_scale', initial: 2 }
    const sink = { ...createMxNode('pool', 320, 100, 'Vault'), id: 'p_vault', initial: 0 }
    custom.nodes = [src, boostPool, scalePool, sink]
    custom.edges = [
      // Outgoing from Source (affected by node-level +2 on src -> 2 + 2*3 = 8, plus +1i -> |4)
      {
        id: 'e_node_mod',
        kind: 'resource',
        from: 'src',
        to: 'p_vault',
        formula: '2|1',
        label: 'Frequency Flow'
      },
      { id: 's_on_src', kind: 'state', from: 'p_boost', to: 'src', formula: '+2' },
      { id: 's_iv_on_src', kind: 'state', from: 'p_boost', to: 'src', formula: '+1i' },
      // Probability resource edge: 30% + 10 * 3 = 60%
      { id: 'e_prob', kind: 'resource', from: 'p_scale', to: 'p_vault', formula: '30%' },
      {
        id: 's_prob',
        kind: 'state',
        from: 'p_boost',
        to: 'p_scale',
        targetEdgeId: 'e_prob',
        formula: '+10'
      },
      // Stochastic dice edge: D6 + 2 * 3 = D6+6
      { id: 'e_dice', kind: 'resource', from: 'p_scale', to: 'p_vault', formula: 'D6' },
      {
        id: 's_dice',
        kind: 'state',
        from: 'p_boost',
        to: 'p_scale',
        targetEdgeId: 'e_dice',
        formula: '+2'
      },
      // State-to-State cascade: p_boost(3) --(+2)--> s_base(+1 => +7) ----> e_casc(1 + 7*2 = 15)
      { id: 'e_casc', kind: 'resource', from: 'p_scale', to: 'p_vault', formula: '1' },
      {
        id: 's_base',
        kind: 'state',
        from: 'p_scale',
        to: 'p_scale',
        targetEdgeId: 'e_casc',
        formula: '+1'
      },
      {
        id: 's_meta',
        kind: 'state',
        from: 'p_boost',
        to: 'p_scale',
        targetEdgeId: 's_base',
        formula: '+2'
      }
    ]

    const snap = evaluateMxEdgeRuntimeGates(custom, {
      values: { p_boost: 3, p_scale: 2, p_vault: 0 },
      step: 1
    })
    expect(snap.modifiedEdgeFormulas.get('e_node_mod')).toBe('8|4')
    expect(snap.modifiedEdgeFormulas.get('e_prob')).toBe('60%')
    expect(snap.modifiedEdgeFormulas.get('e_dice')).toBe('D6+6')
    expect(snap.modifiedEdgeFormulas.get('s_base')).toBe('+7')
    expect(snap.modifiedEdgeFormulas.get('e_casc')).toBe('15')

    // Verify split interval pill (8 | 4 + hourglass), top caption ('Frequency Flow'), and origin color inheritance (#8b5cf6)
    const customSvg = exportMxDiagramSvg(custom, {
      theme: 'light',
      displayValues: { p_boost: 3, p_scale: 2, p_vault: 0 },
      playStep: 1
    }).svgText
    expect(customSvg).toContain('>Frequency Flow</text>')
    expect(customSvg).toContain('>8</text>')
    expect(customSvg).toContain('>4</text>')
    expect(customSvg).toContain('stroke="#8b5cf6"')
    expect(customSvg).not.toContain('var(--')
    expect(customSvg).not.toContain('color-mix(')
  })

  it('keeps tooltips and tips theme-synced across Machinations/Numerical studios and global components', () => {
    const root = resolve(__dirname, '..')
    const settingsSrc = readFileSync(resolve(root, 'src/main/services/settingsService.ts'), 'utf8')
    expect(settingsSrc).toContain('nativeTheme.themeSource = theme')

    const floatingTipSrc = readFileSync(
      resolve(root, 'src/renderer/src/components/dive/machinations/MxFloatingTip.vue'),
      'utf8'
    )
    expect(floatingTipSrc).toContain('e.buttons !== 0')
    expect(floatingTipSrc).toContain("closest('[data-theme]')")
    expect(floatingTipSrc).toContain(':data-theme="tipTheme"')

    const mxStudioSrc = readFileSync(
      resolve(root, 'src/renderer/src/components/dive/machinations/MachinationsStudio.vue'),
      'utf8'
    )
    expect(mxStudioSrc).toContain('<MxFloatingTip />')

    const numStudioSrc = readFileSync(
      resolve(root, 'src/renderer/src/components/dive/machinations/NumericalStudio.vue'),
      'utf8'
    )
    expect(numStudioSrc).toContain('<MxFloatingTip />')
    expect(numStudioSrc).toContain('--bg-elev: var(--bg-elevated)')

    const overflowTipSrc = readFileSync(
      resolve(root, 'src/renderer/src/components/OverflowTip.vue'),
      'utf8'
    )
    expect(overflowTipSrc).not.toContain('#1b2230')
    expect(overflowTipSrc).not.toContain('#b8e0ff')
    expect(overflowTipSrc).toContain(':data-theme="resolvedTheme"')
  })
})
