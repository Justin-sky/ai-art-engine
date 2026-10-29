import { describe, expect, it } from 'vitest'
import {
  analyzeMxEconomyHealth,
  autoLayoutMxDocument,
  createMxFromTemplate,
  createMxInitialState,
  createMxTemplate,
  evaluateMxExpression,
  inferMxTemplateFromPrompt,
  MX_TEMPLATES,
  normalizeMxDocument,
  parseMxDocumentJson,
  parseMxFlowFormula,
  parseMxStateFormula,
  runMxForecast,
  runMx2DParameterMatrix,
  runMxGoalSeek,
  runMxParameterSweep,
  runMxSimulation,
  stepMxSimulation,
  summarizeMxSeries,
  validateMxFormula,
  createEmptyMxDocument,
  createMxNode,
  createMachinationsPresetDiagram,
  exportMxCommercialQaReportMarkdown,
  exportMxGodotGd,
  exportMxUnityCs,
  exportWorkbenchToGameDataTables,
  createMxWorkbenchPreset,
  runMxArchetypeBalanceMatrix,
  runMxCombatKernelSimulation,
  runMxCommercialCohortAnalysis,
  runMxDeckRemovalRoiAnalysis,
  runMxEncounterCounterMatrix,
  runMxPoolDilutionAnalysis,
  runMxRoguelikeEnvelopeSimulation,
  solveMxCombatTargetGoalSeek,
  solveMxEnvelopeTargetGoalSeek,
  generateMxAgentWithAi,
  runMxAgentArena,
  suggestMxAgentGoalsWithAi,
  type MxDocument,
  type MxNode
} from '../src/shared/gameAssets'
import {
  createNodeFromType,
  executeGameEconomyNode,
  executeGamePlayAssetNode,
  introspectNodeType,
  mergeSmartNodeParams,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('Machinations v2 expression & formula parsing', () => {
  it('evaluates arithmetic, functions, dice and variables', () => {
    const rng = (): number => 0.5
    expect(evaluateMxExpression('1 + 2 * 3', { vars: {}, rng })).toBe(7)
    expect(evaluateMxExpression('(1 + 2) * 3 ^ 2', { vars: {}, rng })).toBe(27)
    expect(evaluateMxExpression('max(2, Gold / 2)', { vars: { Gold: 10 }, rng })).toBe(5)
    expect(evaluateMxExpression('2D6 + 1', { vars: {}, rng })).toBe(9)
    expect(evaluateMxExpression('Gold >= 5', { vars: { Gold: 6 }, rng })).toBe(1)
    expect(evaluateMxExpression('bad ) expr', { vars: {}, rng }, -1)).toBe(-1)
  })

  it('parses resource flow formulas', () => {
    expect(parseMxFlowFormula('all')).toEqual({ type: 'all' })
    expect(parseMxFlowFormula('50%')).toMatchObject({ probability: 0.5, expr: '1' })
    expect(parseMxFlowFormula('3 50%')).toMatchObject({ probability: 0.5, expr: '3' })
    expect(parseMxFlowFormula('2 every 3')).toMatchObject({ every: 3, expr: '2' })
    expect(parseMxFlowFormula('D6+2')).toMatchObject({ expr: 'D6+2' })
  })

  it('parses state connection labels', () => {
    expect(parseMxStateFormula('*')).toEqual({ type: 'trigger' })
    expect(parseMxStateFormula('!')).toEqual({ type: 'reverse_trigger' })
    expect(parseMxStateFormula('+2')).toEqual({ type: 'modifier', delta: 2, percent: false })
    expect(parseMxStateFormula('-10%')).toEqual({ type: 'modifier', delta: -10, percent: true })
    expect(parseMxStateFormula('>=5')).toEqual({ type: 'activator', op: '>=', value: 5 })
    expect(parseMxStateFormula('2..8')).toEqual({ type: 'range', lo: 2, hi: 8 })
  })
})

describe('Machinations v2 simulation', () => {
  it('source → pool → drain with capacity, activators and end condition', () => {
    const doc: MxDocument = createEmptyMxDocument('t')
    const src = { ...createMxNode('source', 0, 0, 'Src'), id: 'src' }
    const pool = { ...createMxNode('pool', 0, 0, 'Pool'), id: 'pool', capacity: 10 }
    const end = { ...createMxNode('end', 0, 0, 'End'), id: 'end' }
    doc.nodes = [src, pool, end]
    doc.edges = [
      { id: 'e1', kind: 'resource', from: 'src', to: 'pool', formula: '3' },
      { id: 'e2', kind: 'state', from: 'pool', to: 'end', formula: '>=9' }
    ]
    const run = runMxSimulation(doc, { steps: 10 })
    expect(run.snapshots[1]!.pool).toBe(3)
    expect(run.ended).toBe(true)
    expect(run.stepsRun).toBe(3)
    expect(run.snapshots[run.stepsRun]!.pool).toBe(9)
  })

  it('converter pull_all only converts when all inputs are satisfied, trigger fires passive nodes', () => {
    const doc = createEmptyMxDocument('t')
    doc.nodes = [
      { ...createMxNode('pool', 0, 0, 'A'), id: 'a', initial: 5 },
      { ...createMxNode('pool', 0, 0, 'B'), id: 'b', initial: 1 },
      { ...createMxNode('converter', 0, 0, 'Conv'), id: 'c' },
      { ...createMxNode('pool', 0, 0, 'Out'), id: 'out' },
      { ...createMxNode('source', 0, 0, 'Bonus'), id: 'bonus', trigger: 'passive' },
      { ...createMxNode('pool', 0, 0, 'BonusPool'), id: 'bp' }
    ]
    doc.edges = [
      { id: 'e1', kind: 'resource', from: 'a', to: 'c', formula: '2' },
      { id: 'e2', kind: 'resource', from: 'b', to: 'c', formula: '1' },
      { id: 'e3', kind: 'resource', from: 'c', to: 'out', formula: '1' },
      { id: 'e4', kind: 'state', from: 'c', to: 'bonus', formula: '*' },
      { id: 'e5', kind: 'resource', from: 'bonus', to: 'bp', formula: '10' }
    ]
    let state = createMxInitialState(doc)
    const r1 = stepMxSimulation(doc, state)
    state = r1.state
    expect(state.values.out).toBe(1)
    expect(state.values.a).toBe(3)
    expect(state.values.b).toBe(0)
    expect(state.values.bp).toBe(10)
    const r2 = stepMxSimulation(doc, state)
    expect(r2.state.values.out).toBe(1)
    expect(r2.events.some((e) => e.type === 'blocked' && e.nodeId === 'c')).toBe(true)
  })

  it('delay releases resources after N steps and gate distributes deterministically', () => {
    const doc = createEmptyMxDocument('t')
    doc.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 's' },
      { ...createMxNode('delay', 0, 0, 'D'), id: 'd', delaySteps: 2 },
      { ...createMxNode('gate', 0, 0, 'G'), id: 'g', gateMode: 'deterministic' },
      { ...createMxNode('pool', 0, 0, 'L'), id: 'l' },
      { ...createMxNode('pool', 0, 0, 'R'), id: 'r' }
    ]
    doc.edges = [
      { id: 'e1', kind: 'resource', from: 's', to: 'd', formula: '2' },
      { id: 'e2', kind: 'resource', from: 'd', to: 'g', formula: '1' },
      { id: 'e3', kind: 'resource', from: 'g', to: 'l', formula: '1' },
      { id: 'e4', kind: 'resource', from: 'g', to: 'r', formula: '1' }
    ]
    const run = runMxSimulation(doc, { steps: 4 })
    expect(run.snapshots[2]!.l ?? 0).toBe(0)
    expect((run.snapshots[3]!.l ?? 0) + (run.snapshots[3]!.r ?? 0)).toBe(2)
    expect(run.snapshots[3]!.l).toBe(1)
    expect(run.snapshots[3]!.r).toBe(1)
  })

  it('all templates simulate, forecast and produce trend summaries', () => {
    for (const t of MX_TEMPLATES) {
      const doc = createMxTemplate(t.id)
      expect(doc.nodes.length).toBeGreaterThanOrEqual(3)
      const run = runMxSimulation(doc, { steps: 15, seed: 7 })
      expect(run.snapshots.length).toBeGreaterThan(1)
      const fc = runMxForecast(doc, { runs: 8, steps: 15, seed: 3 })
      expect(fc.series.length).toBeGreaterThan(0)
      expect(fc.series[0]!.p50).toHaveLength(16)
    }
    const roguelike = createMxTemplate('roguelike_run')
    const run = runMxSimulation(roguelike, { steps: 20, seed: 11 })
    const depth = run.snapshots.map((s) => s.depth ?? 0)
    expect(depth[depth.length - 1]).toBeGreaterThan(0)
    expect(summarizeMxSeries(depth).pattern).toBe('rose')
    expect(summarizeMxSeries([100, 90, 76, 80, 93]).pattern).toBe('fell_then_rose')
  })

  it('normalizes, upgrades v1 diagrams, and infers templates from prompts', () => {
    const v1 = createMachinationsPresetDiagram('gacha_pity_banner')
    const doc = parseMxDocumentJson(JSON.stringify(v1))
    expect(doc.schema).toBe('mx@2')
    expect(doc.nodes.some((n) => n.kind === 'gate')).toBe(true)
    const back = parseMxDocumentJson(JSON.stringify(doc))
    expect(back.nodes.length).toBe(doc.nodes.length)
    expect(normalizeMxDocument({ nodes: [{ id: 'x', kind: 'bogus' }] }).nodes).toHaveLength(0)
    expect(inferMxTemplateFromPrompt('gacha banner with pity')).toBe('gacha_pity_banner')
    expect(inferMxTemplateFromPrompt('tower defense waves')).toBe('tower_defense_waves')
  })

  it('supports state edges targeting another edge (targetEdgeId modifiers/activators), bend, and autoLayoutMxDocument', () => {
    const doc = createEmptyMxDocument('edge-mod')
    doc.nodes = [
      { ...createMxNode('source', 0, 0, 'Src'), id: 'src' },
      { ...createMxNode('pool', 0, 0, 'Gold'), id: 'gold' },
      { ...createMxNode('pool', 0, 0, 'UpgradeLevel'), id: 'lvl', initial: 3 }
    ]
    doc.edges = [
      { id: 'eFlow', kind: 'resource', from: 'src', to: 'gold', formula: '2', bend: 24 },
      { id: 'eMod', kind: 'state', from: 'lvl', to: 'gold', targetEdgeId: 'eFlow', formula: '+2' }
    ]
    const norm = normalizeMxDocument(JSON.parse(JSON.stringify(doc)))
    expect(norm.edges[0]!.bend).toBe(24)
    expect(norm.edges[1]!.targetEdgeId).toBe('eFlow')

    // Base rate 2 + (UpgradeLevel=3 * +2) = 8 per step
    const run = runMxSimulation(norm, { steps: 2 })
    expect(run.snapshots[1]!.gold).toBe(8)
    expect(run.snapshots[2]!.gold).toBe(16)

    const tpl = createMxFromTemplate('roguelike_run', 'Custom Run')
    expect(tpl.title).toBe('Custom Run')
    autoLayoutMxDocument(tpl)
    expect(tpl.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
  })

  it('integrates with AI Chat Panel smartPatch (preset switching, full diagram generation with auto-layout, and dot-path tweaks)', () => {
    const node = createNodeFromType('game.economy', { x: 0, y: 0 })

    // 1. Preset switching via AI Chat Panel
    const p1 = mergeSmartNodeParams(node, { preset: 'gacha_pity_banner' })
    expect(p1.gameEconomyPreset).toBe('gacha_pity_banner')
    const doc1 = parseMxDocumentJson(String(p1.gameEconomyDiagramJson ?? ''))
    expect(doc1.nodes.some((n) => n.kind === 'gate')).toBe(true)

    // 2. Full custom diagram generation from AI Chat Panel (without x/y coordinates -> auto-layout)
    node.params = p1
    const p2 = mergeSmartNodeParams(node, {
      gameEconomyDiagramJson: {
        title: 'AI Crafted Survival Economy',
        nodes: [
          { id: 'mine', kind: 'source', label: 'Gold Mine', trigger: 'automatic' },
          { id: 'gold', kind: 'pool', label: 'Gold Bag', initial: 50, capacity: 200 },
          { id: 'shop', kind: 'converter', label: 'Buy Potion', trigger: 'interactive' },
          { id: 'hp', kind: 'pool', label: 'Hero HP', initial: 100 }
        ],
        edges: [
          { id: 'e1', kind: 'resource', from: 'mine', to: 'gold', formula: '5' },
          { id: 'e2', kind: 'resource', from: 'gold', to: 'shop', formula: '20' },
          { id: 'e3', kind: 'resource', from: 'shop', to: 'hp', formula: '15' }
        ]
      }
    })
    const doc2 = parseMxDocumentJson(String(p2.gameEconomyDiagramJson ?? ''))
    expect(doc2.title).toBe('AI Crafted Survival Economy')
    expect(doc2.nodes).toHaveLength(4)
    // Auto-layout assigned distinct x positions across topological columns
    const distinctX = new Set(doc2.nodes.map((n) => n.x))
    expect(distinctX.size).toBeGreaterThanOrEqual(3)

    // 3. Incremental dot-path tweak from AI Chat Panel
    node.params = p2
    const p3 = mergeSmartNodeParams(node, {
      'gameEconomyDiagramJson.nodes[id=gold].initial': 120,
      'gameEconomyDiagramJson.edges[id=e1].formula': '2D6'
    })
    const doc3 = parseMxDocumentJson(String(p3.gameEconomyDiagramJson ?? ''))
    expect(doc3.nodes.find((n) => n.id === 'gold')?.initial).toBe(120)
    expect(doc3.edges.find((e) => e.id === 'e1')?.formula).toBe('2D6')
  })

  it('supports turn_based actionMode, pool overflow drain, edge-targeted triggers (*), and analyzeMxEconomyHealth', () => {
    // 1. turn_based mode fires 1 automatic node per step in round-robin order
    const tbDoc = createEmptyMxDocument('turn-based')
    tbDoc.settings.actionMode = 'turn_based'
    tbDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'S1'), id: 's1', trigger: 'automatic' },
      { ...createMxNode('source', 0, 0, 'S2'), id: 's2', trigger: 'automatic' },
      { ...createMxNode('pool', 0, 0, 'P'), id: 'p', capacity: 5, overflow: 'drain' }
    ]
    tbDoc.edges = [
      { id: 'e1', kind: 'resource', from: 's1', to: 'p', formula: '3' },
      { id: 'e2', kind: 'resource', from: 's2', to: 'p', formula: '4' }
    ]
    const tbRun = runMxSimulation(tbDoc, { steps: 2 })
    // Step 1: only s1 fires (+3 -> 3); Step 2: only s2 fires (+4 -> capped at 5, 2 drained via overflow: 'drain')
    expect(tbRun.snapshots[1]!.p).toBe(3)
    expect(tbRun.snapshots[2]!.p).toBe(5)
    expect(tbRun.totalConsumed).toBe(2)

    // 2. Passive pool receiving resources fires outgoing `*` state trigger targeting a resource edge
    const trigDoc = createEmptyMxDocument('edge-trig')
    trigDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Src'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 0, 0, 'XP'), id: 'xp', trigger: 'passive' },
      {
        ...createMxNode('pool', 0, 0, 'Treasury'),
        id: 'treasury',
        initial: 20,
        trigger: 'passive'
      },
      { ...createMxNode('pool', 0, 0, 'Wallet'), id: 'wallet', trigger: 'passive' }
    ]
    trigDoc.edges = [
      { id: 'r1', kind: 'resource', from: 'src', to: 'xp', formula: '1' },
      { id: 'r2', kind: 'resource', from: 'treasury', to: 'wallet', formula: '5' },
      { id: 'st1', kind: 'state', from: 'xp', to: 'treasury', targetEdgeId: 'r2', formula: '*' }
    ]
    const trigRun = runMxSimulation(trigDoc, { steps: 1 })
    expect(trigRun.snapshots[1]!.xp).toBe(1)
    expect(trigRun.snapshots[1]!.wallet).toBe(5)
    expect(trigRun.snapshots[1]!.treasury).toBe(15)

    // 3. Economy Health & Bottleneck Diagnostics
    const roguelike = createMxTemplate('roguelike_run')
    const rogueRun = runMxSimulation(roguelike, { steps: 20, seed: 42 })
    const health = analyzeMxEconomyHealth(roguelike, rogueRun)
    expect(health.score).toBeGreaterThanOrEqual(25)
    expect(health.score).toBeLessThanOrEqual(100)
    expect(['S', 'A', 'B', 'C', 'D']).toContain(health.grade)
    expect(health.findings.length).toBeGreaterThan(0)
  })

  it('supports Goal-Seek auto-balancing, Parameter Sweep, Group frames, and full Godot/Unity logic codegen', () => {
    const doc = createEmptyMxDocument('balancer-test')
    doc.settings.steps = 10
    doc.params = [{ id: 'p_rate', name: 'rate', value: 2 }]
    doc.groups = [
      { id: 'g1', label: 'Core Loop', x: 40, y: 40, width: 320, height: 220, color: '#2563eb' }
    ]
    doc.nodes = [
      { ...createMxNode('source', 80, 100, 'Mine'), id: 'mine', trigger: 'automatic' },
      {
        ...createMxNode('pool', 220, 100, 'Gold'),
        id: 'gold',
        initial: 0,
        capacity: -1,
        tracked: true
      },
      { ...createMxNode('converter', 360, 100, 'Forge'), id: 'forge', trigger: 'interactive' },
      { ...createMxNode('pool', 500, 100, 'Sword'), id: 'sword', initial: 0, tracked: true }
    ]
    doc.edges = [
      { id: 'e1', kind: 'resource', from: 'mine', to: 'gold', formula: 'rate' },
      { id: 'e2', kind: 'resource', from: 'gold', to: 'forge', formula: '10' },
      { id: 'e3', kind: 'resource', from: 'forge', to: 'sword', formula: '1' }
    ]

    // 1. Goal-Seek: find `rate` in [1, 10] so that `gold` reaches 50 at step 10 (exact solution: rate = 5)
    const gs = runMxGoalSeek(doc, {
      variableKind: 'param',
      variableId: 'rate',
      minVal: 1,
      maxVal: 10,
      goalMetric: 'node_value',
      goalNodeId: 'gold',
      atStep: 10,
      targetValue: 50,
      samples: 10,
      runsPerSample: 1
    })
    expect(gs.bestValue).toBeCloseTo(5, 0)
    expect(gs.achievedValue).toBeCloseTo(50, 0)
    expect(gs.error).toBeLessThanOrEqual(1)

    // 2. Parameter Sweep across rate in [2, 6]
    const sweep = runMxParameterSweep(doc, {
      variableKind: 'param',
      variableId: 'rate',
      minVal: 2,
      maxVal: 6,
      stepsCount: 5,
      runsPerPoint: 1
    })
    expect(sweep.points).toHaveLength(5)
    expect(sweep.points[0]!.nodeFinals.gold).toBe(20)
    expect(sweep.points[4]!.nodeFinals.gold).toBe(60)

    // 3. Full logic codegen for Godot 4 (.gd) and Unity (.cs)
    const gd = exportMxGodotGd(doc)
    expect(gd).toContain('func can_convert(converter_id: String)')
    expect(gd).toContain('func execute_converter(converter_id: String)')
    expect(gd).toContain('func step_economy()')

    const cs = exportMxUnityCs(doc)
    expect(cs).toContain('public bool CanConvert(string converterId)')
    expect(cs).toContain('public bool ExecuteConverter(string converterId)')
    expect(cs).toContain('public void StepEconomy()')

    // 4. Groups preserved through normalizeMxDocument
    const norm = normalizeMxDocument(doc)
    expect(norm.groups).toHaveLength(1)
    expect(norm.groups![0]!.label).toBe('Core Loop')
  })

  it('supports Player AI Bot policies, lookup/diminish/lerp functions, formula validation, and 2D Parameter Matrix', () => {
    const rng = (): number => 0.5
    // 1. Game math functions: lookup (1-based), lookup0 (0-based), diminish, lerp, smoothstep
    expect(evaluateMxExpression('lookup(1, 10, 25, 60)', { vars: {}, rng })).toBe(10)
    expect(evaluateMxExpression('lookup(3, 10, 25, 60)', { vars: {}, rng })).toBe(60)
    expect(evaluateMxExpression('lookup(99, 10, 25, 60)', { vars: {}, rng })).toBe(60)
    expect(evaluateMxExpression('lookup0(0, 5, 15)', { vars: {}, rng })).toBe(5)
    expect(evaluateMxExpression('diminish(100, 100, 100)', { vars: {}, rng })).toBeCloseTo(50, 2)
    expect(evaluateMxExpression('lerp(10, 20, 0.5)', { vars: {}, rng })).toBeCloseTo(15, 2)
    expect(evaluateMxExpression('smoothstep(0, 10, 5)', { vars: {}, rng })).toBeCloseTo(0.5, 2)

    // 2. Formula validation
    expect(validateMxFormula('lookup(lv, 10, 20) + rate', 'register')).toEqual({
      valid: true,
      referencedVars: ['lv', 'rate']
    })
    expect(validateMxFormula('lookup(lv, 10', 'register').valid).toBe(false)
    expect(validateMxFormula('unknown_fn(1, 2)', 'register').valid).toBe(false)

    // 3. Player AI Bot automatically firing Interactive nodes + 2D Parameter Matrix
    const doc = createEmptyMxDocument('bot-matrix-test')
    doc.settings.steps = 5
    doc.settings.botMode = 'greedy'
    doc.params = [
      { id: 'p1', name: 'income', value: 10 },
      { id: 'p2', name: 'cost', value: 15 }
    ]
    doc.nodes = [
      { ...createMxNode('source', 0, 0, 'Job'), id: 'job', trigger: 'automatic' },
      { ...createMxNode('pool', 100, 0, 'Gold'), id: 'gold', initial: 0, tracked: true },
      {
        ...createMxNode('converter', 200, 0, 'BuyGem'),
        id: 'buy',
        trigger: 'interactive',
        pullMode: 'pull_all'
      },
      { ...createMxNode('pool', 300, 0, 'Gem'), id: 'gem', initial: 0, tracked: true }
    ]
    doc.edges = [
      { id: 'e1', kind: 'resource', from: 'job', to: 'gold', formula: 'income' },
      { id: 'e2', kind: 'resource', from: 'gold', to: 'buy', formula: 'cost' },
      { id: 'e3', kind: 'resource', from: 'buy', to: 'gem', formula: '1' }
    ]

    // With botMode='greedy', the interactive converter `buy` automatically fires whenever Gold >= cost
    const run = runMxSimulation(doc, { steps: 5 })
    expect(run.snapshots[5]!.gem).toBeGreaterThanOrEqual(2)

    // 4. 2D Parameter Matrix across income (X) and cost (Y)
    const mat = runMx2DParameterMatrix(doc, {
      varXKind: 'param',
      varXId: 'income',
      minX: 10,
      maxX: 20,
      stepsX: 3,
      varYKind: 'param',
      varYId: 'cost',
      minY: 10,
      maxY: 20,
      stepsY: 3,
      metric: 'node_value',
      targetNodeId: 'gem',
      runsPerCell: 1
    })
    expect(mat.xValues).toEqual([10, 15, 20])
    expect(mat.yValues).toEqual([10, 15, 20])
    expect(mat.cells).toHaveLength(3)
    expect(mat.cells[0]).toHaveLength(3)
    // High income (20) + Low cost (10) produces more gems than Low income (10) + High cost (20)
    expect(mat.cells[0]![2]!.value).toBeGreaterThan(mat.cells[2]![0]!.value)
  })

  it('thoroughly verifies all 11 node types, resource formulas, state connections, and edge cases', () => {
    // 1. Edge-targeted state modifier & activator do NOT leak onto the source node itself
    const edgeScopeDoc = createEmptyMxDocument('edge-scope')
    edgeScopeDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Src'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 0, 0, 'PoolA'), id: 'pa' },
      { ...createMxNode('pool', 0, 0, 'PoolB'), id: 'pb' },
      { ...createMxNode('pool', 0, 0, 'Buff'), id: 'buff', initial: 2 }
    ]
    edgeScopeDoc.edges = [
      { id: 'eA', kind: 'resource', from: 'src', to: 'pa', formula: '3' },
      { id: 'eB', kind: 'resource', from: 'src', to: 'pb', formula: '3' },
      // State modifier targeting ONLY eA (note: `to` is `src`, `targetEdgeId` is `eA`)
      { id: 'stMod', kind: 'state', from: 'buff', to: 'src', targetEdgeId: 'eA', formula: '+2' },
      // State activator `>10` (false since buff=2) targeting ONLY eB (`to` is `src`, `targetEdgeId` is `eB`)
      { id: 'stAct', kind: 'state', from: 'buff', to: 'src', targetEdgeId: 'eB', formula: '>10' }
    ]
    const edgeScopeRun = runMxSimulation(edgeScopeDoc, { steps: 1 })
    // eA gets 3 + (2 * 2) = 7 (not double-counted to 11!), and src is NOT disabled by stAct on eB!
    expect(edgeScopeRun.snapshots[1]!.pa).toBe(7)
    // eB is disabled by stAct (>10 is false) -> 0
    expect(edgeScopeRun.snapshots[1]!.pb).toBe(0)

    // 2. Passive Source pulled by downstream automatic Pool & Converter + passive Converter pushed into
    const passiveDoc = createEmptyMxDocument('passive-source-and-converter')
    passiveDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'PassiveMine'), id: 'pmine', trigger: 'passive' },
      {
        ...createMxNode('pool', 0, 0, 'Ore'),
        id: 'ore',
        trigger: 'automatic',
        pullMode: 'pull_any'
      },
      { ...createMxNode('source', 0, 0, 'AutoWood'), id: 'awood', trigger: 'automatic' },
      { ...createMxNode('converter', 0, 0, 'PassiveSmelt'), id: 'smelt', trigger: 'passive' },
      { ...createMxNode('pool', 0, 0, 'Ingot'), id: 'ingot', trigger: 'passive' }
    ]
    passiveDoc.edges = [
      { id: 'e1', kind: 'resource', from: 'pmine', to: 'ore', formula: '4' },
      { id: 'e2', kind: 'resource', from: 'awood', to: 'smelt', formula: '2' },
      { id: 'e3', kind: 'resource', from: 'smelt', to: 'ingot', formula: '1' }
    ]
    const passiveRun = runMxSimulation(passiveDoc, { steps: 2 })
    expect(passiveRun.snapshots[2]!.ore).toBe(8)
    expect(passiveRun.snapshots[2]!.ingot).toBe(2)

    // 3. Queue (1-by-1 FIFO release) vs Delay (batch release) + Trader atomic swap + Drain with state modifier
    const queueTraderDoc = createEmptyMxDocument('queue-trader-drain')
    queueTraderDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Spawner'), id: 'sp', trigger: 'automatic' },
      { ...createMxNode('queue', 0, 0, 'CraftQueue'), id: 'q', delaySteps: 1 },
      { ...createMxNode('pool', 0, 0, 'QueueOut'), id: 'qout' },
      { ...createMxNode('pool', 0, 0, 'BuyerGold'), id: 'bg', initial: 10 },
      { ...createMxNode('pool', 0, 0, 'SellerHerb'), id: 'sh', initial: 3 },
      {
        ...createMxNode('trader', 0, 0, 'Market'),
        id: 'mkt',
        trigger: 'automatic',
        pullMode: 'pull_all'
      },
      { ...createMxNode('pool', 0, 0, 'BuyerHerb'), id: 'bh', initial: 0 },
      { ...createMxNode('pool', 0, 0, 'SellerGold'), id: 'sg', initial: 0 },
      { ...createMxNode('drain', 0, 0, 'TaxDrain'), id: 'tax', trigger: 'automatic' },
      { ...createMxNode('register', 0, 0, 'TaxLv'), id: 'taxlv', formula: '2' }
    ]
    queueTraderDoc.edges = [
      { id: 'qe1', kind: 'resource', from: 'sp', to: 'q', formula: '3' },
      { id: 'qe2', kind: 'resource', from: 'q', to: 'qout', formula: '1' },
      { id: 'te1', kind: 'resource', from: 'bg', to: 'mkt', formula: '5' },
      { id: 'te2', kind: 'resource', from: 'sh', to: 'mkt', formula: '1' },
      { id: 'te3', kind: 'resource', from: 'mkt', to: 'bh', formula: '1' },
      { id: 'te4', kind: 'resource', from: 'mkt', to: 'sg', formula: '5' },
      { id: 'de1', kind: 'resource', from: 'sg', to: 'tax', formula: '1' },
      { id: 'de2', kind: 'state', from: 'taxlv', to: 'tax', formula: '+1' }
    ]
    const qtRun = runMxSimulation(queueTraderDoc, { steps: 2 })
    // Queue received 3 on step 1 (release at step 2), and releases at most 1 unit per step starting step 2
    expect(qtRun.snapshots[1]!.qout).toBe(0)
    expect(qtRun.snapshots[2]!.qout).toBe(1)
    // Trader traded twice (5 Gold <-> 1 Herb per step): BuyerGold = 0, BuyerHerb = 2
    expect(qtRun.snapshots[2]!.bg).toBe(0)
    expect(qtRun.snapshots[2]!.bh).toBe(2)
    // SellerGold received 5 per step, and TaxDrain pulled 1 + (TaxLv=2 * +1) = 3 per step -> 10 - 6 = 4
    expect(qtRun.snapshots[2]!.sg).toBe(4)

    // 4. End condition shorthand (`<=0`) + State Activator comparing against parameter (`>=Price`) + Reverse trigger (`!`)
    const endDoc = createEmptyMxDocument('end-shorthand')
    endDoc.params = [{ id: 'p_price', name: 'Price', value: 5 }]
    endDoc.nodes = [
      { ...createMxNode('pool', 0, 0, 'HP'), id: 'hp', initial: 6 },
      { ...createMxNode('drain', 0, 0, 'Bleed'), id: 'bleed', trigger: 'automatic' },
      { ...createMxNode('end', 0, 0, 'GameOver'), id: 'over', formula: '<=0' },
      { ...createMxNode('converter', 0, 0, 'EmptyConv'), id: 'econv', trigger: 'automatic' },
      { ...createMxNode('source', 0, 0, 'FallbackSrc'), id: 'fsrc', trigger: 'passive' },
      { ...createMxNode('pool', 0, 0, 'FallbackPool'), id: 'fp', initial: 0 }
    ]
    endDoc.edges = [
      { id: 'e1', kind: 'resource', from: 'hp', to: 'bleed', formula: '3' },
      { id: 'e2', kind: 'state', from: 'hp', to: 'over', formula: '*' },
      { id: 'e3', kind: 'resource', from: 'fp', to: 'econv', formula: '10' },
      // Reverse trigger `!`: fires FallbackSrc whenever EmptyConv is blocked!
      { id: 'e4', kind: 'state', from: 'econv', to: 'fsrc', formula: '!' },
      { id: 'e5', kind: 'resource', from: 'fsrc', to: 'fp', formula: '2' }
    ]
    expect(validateMxFormula('<=0', 'end').valid).toBe(true)
    expect(validateMxFormula('>=Price', 'state').valid).toBe(true)
    const endRun = runMxSimulation(endDoc, { steps: 5 })
    expect(endRun.ended).toBe(true)
    expect(endRun.stepsRun).toBe(2)
    expect(endRun.snapshots[2]!.hp).toBe(0)
    // Reverse trigger `!` fired FallbackSrc on both steps because EmptyConv was blocked (needed 10 from fp)
    expect(endRun.snapshots[2]!.fp).toBe(4)
  })

  it('scales to 1,200 nodes and 1,600 edges (resource + state) across 20 steps in <500ms', () => {
    const doc = createEmptyMxDocument('scale-1200-nodes-1600-edges')
    doc.nodes = []
    doc.edges = []

    // Construct 200 parallel economy clusters:
    // Each cluster has 6 nodes (1,200 total) and 8 edges (1,600 total: 5 resource + 3 state)
    const clusters = 200
    for (let i = 0; i < clusters; i++) {
      const p = `c${i}_`
      doc.nodes.push(
        { ...createMxNode('source', i * 50, 0, `Src${i}`), id: `${p}src`, trigger: 'automatic' },
        { ...createMxNode('pool', i * 50, 60, `Ore${i}`), id: `${p}ore`, initial: 4 },
        {
          ...createMxNode('converter', i * 50, 120, `Smelt${i}`),
          id: `${p}conv`,
          trigger: 'automatic'
        },
        { ...createMxNode('pool', i * 50, 180, `Gold${i}`), id: `${p}gold`, initial: 0 },
        { ...createMxNode('register', i * 50, 240, `Lv${i}`), id: `${p}reg`, formula: '1' },
        { ...createMxNode('drain', i * 50, 300, `Sink${i}`), id: `${p}sink`, trigger: 'automatic' }
      )
      doc.edges.push(
        { id: `${p}e1`, kind: 'resource', from: `${p}src`, to: `${p}ore`, formula: '2' },
        { id: `${p}e2`, kind: 'resource', from: `${p}ore`, to: `${p}conv`, formula: '2' },
        { id: `${p}e3`, kind: 'resource', from: `${p}conv`, to: `${p}gold`, formula: '3' },
        { id: `${p}e4`, kind: 'resource', from: `${p}gold`, to: `${p}sink`, formula: '1' },
        {
          id: `${p}e5`,
          kind: 'state',
          from: `${p}reg`,
          to: `${p}src`,
          targetEdgeId: `${p}e1`,
          formula: '+1'
        },
        { id: `${p}e6`, kind: 'state', from: `${p}ore`, to: `${p}conv`, formula: '>=2' },
        { id: `${p}e7`, kind: 'state', from: `${p}gold`, to: `${p}sink`, formula: '>0' },
        { id: `${p}e8`, kind: 'resource', from: `${p}src`, to: `${p}gold`, formula: '1' }
      )
    }

    expect(doc.nodes.length).toBe(1200)
    expect(doc.edges.length).toBe(1600)

    const t0 = performance.now()
    const run = runMxSimulation(doc, { steps: 20, seed: 42 })
    const elapsedMs = performance.now() - t0

    expect(run.stepsRun).toBe(20)
    expect(run.snapshots).toHaveLength(21)
    // Verify cluster 0 and cluster 199 both computed accurately:
    // Each step: Src outputs (2 + 1) = 3 to Ore and 1 to Gold; Conv consumes 2 Ore -> 3 Gold; Sink drains 1 Gold (when Gold > 0)
    expect(run.snapshots[20]!.c0_ore).toBe(24)
    expect(run.snapshots[20]!.c199_ore).toBe(24)
    expect(run.snapshots[20]!.c0_gold).toBeGreaterThan(50)
    expect(run.snapshots[20]!.c199_gold).toBe(run.snapshots[20]!.c0_gold)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('supports Artificial Agents (Personality -> Goals -> Control) with 2-step lookahead utility optimization', () => {
    const doc = createEmptyMxDocument('agent-utility-lookahead')
    doc.nodes = [
      // Interactive Action 1: Mine Ore -> Ore Pool
      { ...createMxNode('source', 0, 0, 'Mine Ore'), id: 'act_mine', trigger: 'interactive' },
      { ...createMxNode('pool', 80, 0, 'Ore'), id: 'pool_ore', initial: 0 },
      // Interactive Action 2: Smelt Gold (requires 2 Ore -> produces 10 Gold)
      {
        ...createMxNode('converter', 160, 0, 'Smelt Gold'),
        id: 'act_smelt',
        trigger: 'interactive',
        pullMode: 'pull_all'
      },
      { ...createMxNode('pool', 240, 0, 'Gold'), id: 'pool_gold', initial: 0 },
      // Interactive Action 3: Train XP -> XP Pool
      { ...createMxNode('source', 0, 100, 'Train XP'), id: 'act_xp', trigger: 'interactive' },
      { ...createMxNode('pool', 80, 100, 'XP'), id: 'pool_xp', initial: 0 },
      // Interactive Action 4: Cleanse Pollution -> Drains Pollution Pool
      { ...createMxNode('pool', 0, 200, 'Pollution'), id: 'pool_pol', initial: 0 },
      { ...createMxNode('drain', 80, 200, 'Cleanse'), id: 'act_cleanse', trigger: 'interactive' }
    ]
    doc.edges = [
      { id: 'e_mine', kind: 'resource', from: 'act_mine', to: 'pool_ore', formula: '2' },
      { id: 'e_in', kind: 'resource', from: 'pool_ore', to: 'act_smelt', formula: '2' },
      { id: 'e_out', kind: 'resource', from: 'act_smelt', to: 'pool_gold', formula: '10' },
      { id: 'e_xp', kind: 'resource', from: 'act_xp', to: 'pool_xp', formula: '5' },
      { id: 'e_pol', kind: 'resource', from: 'pool_pol', to: 'act_cleanse', formula: '5' }
    ]

    // Configure an Agent whose primary goal is 10 Gold (continuePastTarget: false) and secondary goal is 50 XP
    doc.agents = [
      {
        id: 'ag_1',
        name: 'aa',
        enabled: true,
        personality: 'rational',
        goals: [
          {
            id: 'g_gold',
            nodeId: 'pool_gold',
            targetFormula: '10',
            importance: 'max',
            continuePastTarget: false,
            trajectory: 'upwards'
          },
          {
            id: 'g_xp',
            nodeId: 'pool_xp',
            targetFormula: '50',
            importance: 'low',
            continuePastTarget: true,
            trajectory: 'upwards'
          }
        ],
        controlledNodeIds: ['act_mine', 'act_smelt', 'act_xp', 'act_cleanse'],
        actionsPerStep: 1
      }
    ]

    const run = runMxSimulation(doc, { steps: 4, seed: 7 })
    // Step 1: Ore is 0 so Smelt Gold is blocked, but 2-step lookahead sees Mine Ore -> Smelt Gold yields +10 Gold (Max importance), beating Train XP (Low importance)!
    expect(run.snapshots[1]!.pool_ore).toBe(2)
    // Step 2: Agent fires Smelt Gold -> Gold reaches 10 (target reached!)
    expect(run.snapshots[2]!.pool_gold).toBe(10)
    // Step 3 & 4: Since Gold has continuePastTarget: false and is already at target 10, Agent automatically pivots to Train XP!
    expect(run.snapshots[4]!.pool_xp).toBe(10)

    // Test AI Agent generator & Downwards trajectory
    const aiAgent = generateMxAgentWithAi(doc)
    expect(aiAgent.goals.length).toBeGreaterThan(0)
    const polGoal = suggestMxAgentGoalsWithAi(doc).find((g) => g.nodeId === 'pool_pol')
    expect(polGoal?.trajectory).toBe('downwards')
  })

  it('solves deep multi-stage crafting chains via Topological Shaping, Urgency curves, Intra-Step Combos, Prompt AI & Arena', () => {
    // 1. Deep 3-stage crafting chain:
    // Mine Ore (+1 Ore) -> need 3 Ore -> Smelt Iron (+1 Iron) -> need 2 Iron -> Forge Sword (+1 Sword)
    // Total 9 sequential interactive clicks required to forge 1 Sword!
    const craftDoc = createEmptyMxDocument('deep-crafting-shaping')
    craftDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Mine Ore'), id: 'act_mine', trigger: 'interactive' },
      { ...createMxNode('pool', 60, 0, 'Ore'), id: 'p_ore', initial: 0 },
      {
        ...createMxNode('converter', 120, 0, 'Smelt Iron'),
        id: 'act_smelt',
        trigger: 'interactive',
        pullMode: 'pull_all'
      },
      { ...createMxNode('pool', 180, 0, 'Iron'), id: 'p_iron', initial: 0 },
      {
        ...createMxNode('converter', 240, 0, 'Forge Sword'),
        id: 'act_forge',
        trigger: 'interactive',
        pullMode: 'pull_all'
      },
      { ...createMxNode('pool', 300, 0, 'Sword'), id: 'p_sword', initial: 0 }
    ]
    craftDoc.edges = [
      { id: 'c1', kind: 'resource', from: 'act_mine', to: 'p_ore', formula: '1' },
      { id: 'c2', kind: 'resource', from: 'p_ore', to: 'act_smelt', formula: '3' },
      { id: 'c3', kind: 'resource', from: 'act_smelt', to: 'p_iron', formula: '1' },
      { id: 'c4', kind: 'resource', from: 'p_iron', to: 'act_forge', formula: '2' },
      { id: 'c5', kind: 'resource', from: 'act_forge', to: 'p_sword', formula: '1' }
    ]
    craftDoc.agents = [
      {
        id: 'ag_crafter',
        name: 'Blacksmith AI',
        enabled: true,
        personality: 'rational',
        goals: [
          {
            id: 'g_sword',
            nodeId: 'p_sword',
            targetFormula: '1',
            importance: 'max',
            continuePastTarget: true,
            trajectory: 'upwards',
            utilityCurve: 'linear'
          }
        ],
        controlledNodeIds: ['act_mine', 'act_smelt', 'act_forge'],
        actionsPerStep: 1,
        lookaheadHorizon: 1,
        shapingEnabled: true
      }
    ]

    const craftRun = runMxSimulation(craftDoc, { steps: 9, seed: 1 })
    // Steps 1..3: Mine 3 Ore -> Step 4: Smelt 1st Iron -> Steps 5..7: Mine 3 Ore -> Step 8: Smelt 2nd Iron -> Step 9: Forge 1 Sword!
    expect(craftRun.snapshots[3]!.p_ore).toBe(3)
    expect(craftRun.snapshots[4]!.p_iron).toBe(1)
    expect(craftRun.snapshots[8]!.p_iron).toBe(2)
    expect(craftRun.snapshots[9]!.p_sword).toBe(1)

    // 2. Non-Linear Urgency Curve: Survival (HP) vs Greed (Gold)
    const survDoc = createEmptyMxDocument('urgency-curve-survival')
    survDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Heal'), id: 'act_heal', trigger: 'interactive' },
      { ...createMxNode('pool', 80, 0, 'HP'), id: 'p_hp', initial: 15, capacity: 100 },
      { ...createMxNode('source', 0, 80, 'Farm Gold'), id: 'act_gold', trigger: 'interactive' },
      { ...createMxNode('pool', 80, 80, 'Gold'), id: 'p_gold', initial: 20, capacity: 100 }
    ]
    survDoc.edges = [
      { id: 's1', kind: 'resource', from: 'act_heal', to: 'p_hp', formula: '20' },
      { id: 's2', kind: 'resource', from: 'act_gold', to: 'p_gold', formula: '20' }
    ]
    survDoc.agents = [
      {
        id: 'ag_surv',
        name: 'Survivor',
        enabled: true,
        personality: 'rational',
        goals: [
          {
            id: 'g_hp',
            nodeId: 'p_hp',
            targetFormula: '100',
            importance: 'high',
            continuePastTarget: false,
            trajectory: 'upwards',
            utilityCurve: 'urgency'
          },
          {
            id: 'g_gold',
            nodeId: 'p_gold',
            targetFormula: '100',
            importance: 'high',
            continuePastTarget: true,
            trajectory: 'upwards',
            utilityCurve: 'linear'
          }
        ],
        controlledNodeIds: ['act_heal', 'act_gold'],
        actionsPerStep: 1,
        lookaheadHorizon: 1
      }
    ]
    const survRun = runMxSimulation(survDoc, { steps: 4, seed: 1 })
    // Step 1: HP is critically low (15/100), so Urgency gain (+0.34) overrides linear Gold (+0.20) -> Agent heals first!
    expect(survRun.snapshots[1]!.p_hp).toBe(35)
    // Steps 2..4: Once HP is out of critical danger (35/100), Urgency marginal gain (+0.183) drops below linear Gold (+0.20) -> Agent farms Gold 3 times (20 -> 80)!
    expect(survRun.snapshots[4]!.p_gold).toBe(80)

    // 3. Intra-Step Sequential Multi-Action Combo (actionsPerStep = 2): Earn Gold + Buy Sword in 1 single step!
    const comboDoc = createEmptyMxDocument('intra-step-combo')
    comboDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Earn Gold'), id: 'act_earn', trigger: 'interactive' },
      { ...createMxNode('pool', 80, 0, 'Gold'), id: 'c_gold', initial: 0 },
      {
        ...createMxNode('converter', 160, 0, 'Buy Sword'),
        id: 'act_buy',
        trigger: 'interactive',
        pullMode: 'pull_all'
      },
      { ...createMxNode('pool', 240, 0, 'Sword'), id: 'c_sword', initial: 0 }
    ]
    comboDoc.edges = [
      { id: 'cb1', kind: 'resource', from: 'act_earn', to: 'c_gold', formula: '10' },
      { id: 'cb2', kind: 'resource', from: 'c_gold', to: 'act_buy', formula: '10' },
      { id: 'cb3', kind: 'resource', from: 'act_buy', to: 'c_sword', formula: '1' }
    ]
    comboDoc.agents = [
      {
        id: 'ag_combo',
        name: 'Combo Rusher',
        enabled: true,
        personality: 'aggressive',
        goals: [
          {
            id: 'g_sw',
            nodeId: 'c_sword',
            targetFormula: '5',
            importance: 'max',
            continuePastTarget: true,
            trajectory: 'upwards'
          }
        ],
        controlledNodeIds: ['act_earn', 'act_buy'],
        actionsPerStep: 2
      }
    ]
    const comboRun = runMxSimulation(comboDoc, { steps: 1, seed: 1 })
    // Within step 1 alone, Agent fires Earn Gold (+10 Gold) AND Buy Sword (-10 Gold, +1 Sword)!
    expect(comboRun.snapshots[1]!.c_sword).toBe(1)
    expect(comboRun.snapshots[1]!.c_gold).toBe(0)

    // 4. Natural-Language Prompt AI Agent + Multi-Agent Arena
    const customAgent = generateMxAgentWithAi(survDoc, {
      prompt: '激进速推，保命 HP 80，囤积 Gold 500'
    })
    expect(customAgent.personality).toBe('aggressive')
    const hpG = customAgent.goals.find((g) => g.nodeId === 'p_hp')
    const goldG = customAgent.goals.find((g) => g.nodeId === 'p_gold')
    expect(hpG?.targetFormula).toBe('80')
    expect(hpG?.utilityCurve).toBe('urgency')
    expect(goldG?.targetFormula).toBe('500')

    survDoc.agents.push(customAgent)
    const arenaRuns = runMxAgentArena(survDoc, { steps: 3, seed: 1 })
    expect(arenaRuns).toHaveLength(2)
    expect(arenaRuns[0]!.name).toContain('Survivor')
    expect(arenaRuns[1]!.name).toContain('Rusher Agent')
  })

  it('verifies game.economy node schema introspection, LLM alias tolerance, and headless executeGameEconomyNode', async () => {
    // 1. Node schema introspection exposes gameEconomyDiagramJson sub-document & all 10 templates
    const schema = introspectNodeType('game.economy')
    expect(schema).toBeDefined()
    expect(schema?.fields.gameEconomyDiagramJson?.type).toBe('json-string')
    expect(schema?.fields.gameEconomyPreset?.enumValues).toContain('gacha_pity_banner')
    expect(schema?.presets.length).toBeGreaterThanOrEqual(10)

    // 2. Top-level nodes + edges in params with LLM field aliases (type, source/target, rate, omitted trigger)
    const node = createNodeFromType('game.economy', { x: 0, y: 0 })
    const patched = mergeSmartNodeParams(node, {
      title: 'AI Top-Level Alias Economy',
      nodes: [
        { id: 'faucet_1', type: 'faucet', name: 'Daily Quest' },
        { id: 'wallet_1', type: 'storage', name: 'Gold Wallet', initialValue: 10 },
        { id: 'craft_1', type: 'craft', name: 'Forge Blade', activation: 'manual' },
        { id: 'blade_1', type: 'pool', name: 'Magic Blade', value: 0 }
      ],
      edges: [
        { source: 'faucet_1', target: 'wallet_1', rate: 5 },
        { source: 'wallet_1', target: 'craft_1', rate: 10 },
        { source: 'craft_1', target: 'blade_1', rate: 1 }
      ]
    })
    const docFromAliases = parseMxDocumentJson(patched.gameEconomyDiagramJson)
    expect(docFromAliases.nodes).toHaveLength(4)
    expect(docFromAliases.nodes.find((n) => n.id === 'faucet_1')?.trigger).toBe('automatic')
    expect(docFromAliases.nodes.find((n) => n.id === 'craft_1')?.trigger).toBe('interactive')
    expect(docFromAliases.edges).toHaveLength(3)

    // 3. Headless execution (executeGameEconomyNode) auto-attaches an AI Agent to drive Interactive nodes!
    node.params = patched
    const out1 = await executeGameEconomyNode({
      node,
      inputs: {},
      get abortSignal() {
        return new AbortController().signal
      }
    } as unknown as NodeExecuteContext)
    expect(out1.out?.kind).toBe('image')
    expect(out1['out-text']?.kind).toBe('text')
    const bundle1 = JSON.parse((out1['out-text'] as { text: string }).text)
    expect(bundle1.kind).toBe('machinations_economy_bundle')
    expect(bundle1.document.agents.length).toBeGreaterThanOrEqual(1)
    // Because the auto-attached AI Agent clicked `Forge Blade` (`craft_1`), `blade_1` increased above 0!
    expect(bundle1.play.final.blade_1).toBeGreaterThan(0)
    expect(bundle1.healthReport.grade).toBeDefined()

    // 4. Natural-language prompt on an unconfigured game.economy node synthesizes the matching Gacha economy
    const promptNode = createNodeFromType(
      'game.economy',
      { x: 0, y: 0 },
      {
        title: '原神风格抽卡软硬保底系统',
        params: {
          ...createNodeFromType('game.economy', { x: 0, y: 0 }).params,
          prompt: '设计一个抽卡祈愿软保底经济系统，运行 25 步'
        }
      }
    )
    const out2 = await executeGameEconomyNode({
      node: promptNode,
      inputs: {},
      get abortSignal() {
        return new AbortController().signal
      }
    } as unknown as NodeExecuteContext)
    const bundle2 = JSON.parse((out2['out-text'] as { text: string }).text)
    expect(bundle2.document.templateId).toBe('gacha_pity_banner')
    expect(bundle2.forecast.steps).toBe(25)
    expect(bundle2.document.nodes.some((n: MxNode) => n.kind === 'gate')).toBe(true)
  })

  it('verifies all 6 advanced Roguelike numerical capabilities (Counter Matrix, Deck Removal ROI, Pool Dilution & Ban, Branching Map + Interest, DataTable Export)', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')

    // 1. 6-Boss Mechanism Counter Matrix
    const matrix = runMxEncounterCounterMatrix(wb.combatKernel)
    expect(matrix).toHaveLength(6)
    expect(matrix.map((r) => r.mechanism)).toEqual([
      'standard',
      'aoe_swarm',
      'status_polluter',
      'card_limit_punisher',
      'thorns_armor',
      'berserk_race'
    ])
    expect(matrix.every((r) => r.winRatePct >= 0 && r.winRatePct <= 100)).toBe(true)

    // 2. Deck Thinning (Card Removal) & Curse Pollution Marginal ROI + Shop Pricing
    const roi = runMxDeckRemovalRoiAnalysis(wb.combatKernel)
    expect(roi).toHaveLength(6)
    const curseRow = roi.find((r) => r.deltaCards === 2)!
    const baseRow = roi.find((r) => r.deltaCards === 0)!
    const thinRow = roi.find((r) => r.deltaCards === -3)!
    expect(thinRow.deckSize).toBeLessThan(baseRow.deckSize)
    expect(thinRow.turn1CoreDrawPct).toBeGreaterThan(curseRow.turn1CoreDrawPct)
    expect(thinRow.fairShopGoldPrice).toBeGreaterThanOrEqual(45)

    // 3. Multi-Archetype Pool Dilution & Ban-Slot / Pity Matrix
    const dilution = runMxPoolDilutionAnalysis(wb.lootRoll)
    expect(dilution).toHaveLength(6)
    // Diluting from 3 archetypes to 8 archetypes lowers raw completion rate, while Ban slots lift it
    expect(dilution[0]!.noBanCompletionPct).toBeGreaterThanOrEqual(dilution[5]!.noBanCompletionPct)
    expect(dilution[3]!.withBanCompletionPct).toBeGreaterThanOrEqual(
      dilution[3]!.noBanCompletionPct
    )

    // 4. Branching Map Pathing (Elite / Campfire Rest vs Smith Upgrade / Shop) & Compound Interest Economy
    const envRes = runMxRoguelikeEnvelopeSimulation({
      ...wb.roguelikeEnvelope,
      eliteRoomRatePct: 30,
      campfireRestHpThresholdPct: 55,
      interestPer10Gold: 1.5,
      interestCapPerFloor: 8
    })
    expect(envRes.floorSeries.some((f) => f.roomType === 'campfire')).toBe(true)
    expect(envRes.floorSeries.some((f) => f.roomType === 'shop')).toBe(true)
    expect(envRes.floorSeries.some((f) => f.roomType === 'boss')).toBe(true)
    expect(envRes.avgInterestGoldEarned).toBeGreaterThan(0)
    expect(envRes.snowballPolarizationIndex).toBeGreaterThanOrEqual(1)

    // 5. One-Click Export to GameDataTableBundle
    const dataBundle = exportWorkbenchToGameDataTables(wb)
    expect(dataBundle.cards.length).toBeGreaterThan(0)
    expect(dataBundle.waves.length).toBe(wb.roguelikeEnvelope.floors)
    expect(dataBundle.items.length).toBeGreaterThan(0)
    expect(dataBundle.characters.length).toBeGreaterThan(0)
    expect(dataBundle.tableCsvs['cards.csv']).toContain('id,name')
  })

  it('verifies CRN monotonicity, Relic Passive Trigger Hooks, Reverse Goal-Seek, Commercial Archetype/Cohort/QA Report & game.economy -> asset.gamePlay wiring', async () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')

    // 1. Common Random Numbers (CRN) monotonicity: lowering enemyHp must never lower winRatePct
    const highHpRes = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: 120,
      enemyHp: 220,
      relicTriggerPreset: 'none'
    })
    const lowHpRes = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: 120,
      enemyHp: 170,
      relicTriggerPreset: 'none'
    })
    expect(lowHpRes.winRatePct).toBeGreaterThanOrEqual(highHpRes.winRatePct)

    // 2. Relic Passive Trigger Hooks (shuriken_kunai / necronomicon / dead_branch / all_synergy)
    const allRelicsRes = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: 120,
      enemyHp: 220,
      relicTriggerPreset: 'all_synergy'
    })
    expect(allRelicsRes.winRatePct).toBeGreaterThan(highHpRes.winRatePct)

    // 3. Reverse Goal-Seek Auto-Tuners (Combat & Roguelike Envelope)
    const combatGoal = solveMxCombatTargetGoalSeek(wb.combatKernel, 70)
    expect(combatGoal.recommendedEnemyHp).toBeGreaterThan(20)
    expect(Math.abs(combatGoal.achievedWinRatePct - 70)).toBeLessThanOrEqual(20)

    const envGoal = solveMxEnvelopeTargetGoalSeek(wb.roguelikeEnvelope, 35)
    expect(envGoal.recommendedGrowthRate).toBeGreaterThanOrEqual(1.03)
    expect(envGoal.recommendedGrowthRate).toBeLessThanOrEqual(1.65)
    expect(Math.abs(envGoal.achievedClearRatePct - 35)).toBeLessThanOrEqual(20)

    // 4. Commercial Product-Grade: Multi-Archetype Meta-Balance Matrix & Commercial Cohort Telemetry & QA Report
    const archetypeRes = runMxArchetypeBalanceMatrix(wb.combatKernel)
    expect(archetypeRes.rows).toHaveLength(4)
    expect(archetypeRes.metaDiversityScore).toBeGreaterThanOrEqual(0)
    expect(archetypeRes.metaDiversityScore).toBeLessThanOrEqual(100)

    const cohortRes = runMxCommercialCohortAnalysis(wb.lootRoll)
    expect(cohortRes.cohorts).toHaveLength(4)
    expect(cohortRes.whaleToF2pProgressRatio).toBeGreaterThanOrEqual(1)
    expect(cohortRes.cohorts[3]!.day30GraduationRatePct).toBeGreaterThanOrEqual(
      cohortRes.cohorts[0]!.day30GraduationRatePct
    )

    const qaMd = exportMxCommercialQaReportMarkdown(wb)
    expect(qaMd).toContain('# Commercial Numerical & Roguelike QA Audit Report')
    expect(qaMd).toContain('Multi-Archetype Meta-Balance Matrix')
    expect(qaMd).toContain('Player Spending Cohort Graduation Telemetry')

    // 5. Headless executeGameEconomyNode -> executeGamePlayAssetNode direct port wiring
    const econNode = createNodeFromType('game.economy', { x: 0, y: 0 })
    const econOut = await executeGameEconomyNode({
      node: econNode,
      inputs: {},
      get abortSignal() {
        return new AbortController().signal
      }
    } as unknown as NodeExecuteContext)
    const econJson = (econOut['out-text'] as { text: string }).text
    const econParsed = JSON.parse(econJson)
    expect(econParsed.workbenchReport.counterMatrix).toHaveLength(6)
    expect(econParsed.workbenchReport.deckRemovalRoi).toHaveLength(6)
    expect(econParsed.workbenchReport.poolDilution).toHaveLength(6)
    expect(econParsed.workbenchReport.archetypeBalance.rows).toHaveLength(4)
    expect(econParsed.workbenchReport.commercialCohorts.cohorts).toHaveLength(4)
    expect(econParsed.qaReportMarkdown).toContain(
      'Commercial Numerical & Roguelike QA Audit Report'
    )
    expect(econParsed.dataTableBundle.cards.length).toBeGreaterThan(0)

    const playNode = createNodeFromType('asset.gamePlay', { x: 300, y: 0 })
    await executeGamePlayAssetNode({
      node: playNode,
      inputs: {
        in: [{ kind: 'text', text: econJson }]
      },
      get abortSignal() {
        return new AbortController().signal
      }
    } as unknown as NodeExecuteContext)
    expect(playNode.params.gamePlayHtml).toContain('card_dbg')
    expect(playNode.params.gamePlayHtml).toContain('Pommel Strike')
  })
})
