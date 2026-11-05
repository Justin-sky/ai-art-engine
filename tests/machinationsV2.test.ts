import { describe, expect, it } from 'vitest'
import {
  analyzeMxEconomyHealth,
  autoLayoutMxDocument,
  computeMxDiagramBounds,
  createMxFromTemplate,
  createMxInitialState,
  createMxTemplate,
  evaluateMxExpression,
  exportMxDiagramSvg,
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
  exportMxToMermaid,
  exportMxUnityCs,
  extractMxTunableEdgeNumericValue,
  formatMxTunableEdgeFormula,
  exportMxWorkbenchRuntimeCode,
  exportWorkbenchToGameDataTables,
  generateMxBattlePassAndPackTable,
  generateMxEquipmentUpgradeMatrix,
  generateMxLevelProgressionTable,
  autoBalanceWorkbenchEntities,
  analyzeMultiplierPipeline,
  analyzeMxCardUpgradeRoiAndDeckDoctor,
  analyzeMxHypergeometricDrawAndComboOdds,
  analyzeMxSynergyAndInfiniteLoopRisk,
  applyMxInfiniteLoopCircuitBreaker,
  applyMxTopCardUpgrades,
  applyMxWorkbenchDeltaPatchFromPrompt,
  computeMxWorkbenchSnapshotDiff,
  createMxWorkbenchPreset,
  getMxCanonicalArchetypeDeck,
  isMxDeltaPatchPrompt,
  runMxArchetypeBalanceMatrix,
  runMxAscensionLadderAudit,
  runMxCombatKernelSimulation,
  runMxCommercialCohortAnalysis,
  runMxDeckRemovalRoiAnalysis,
  runMxEncounterCounterMatrix,
  runMxPoolDilutionAnalysis,
  runMxRoguelikeEnvelopeSimulation,
  runMxSensitivityTornado,
  simulateMxExtendedCardGenreMatrices,
  simulateMxBossIntentTimelineAndPollution,
  simulateMxJokerSlotOrderAndPlanetTable,
  simulateMxPvpMatchupAndNashEquilibrium,
  solveMxCombatTargetGoalSeek,
  solveMxEnvelopeTargetGoalSeek,
  solveMxSingleTurnLethalAndOrderSkill,
  synthesizeMxDiagramFromPrompt,
  synthesizeMxWorkbenchFromPrompt,
  generateMxAgentWithAi,
  lintMxDocumentTopology,
  runMxAgentArena,
  suggestMxAgentGoalsWithAi,
  type MxDocument,
  type MxNode
} from '../src/shared/gameAssets'
import {
  applyGraphEditOps,
  createNodeFromType,
  executeGameEconomyNode,
  executeGamePlayAssetNode,
  introspectNodeType,
  mergeSmartNodeParams,
  type GraphDocument,
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

    // 2. Relic Passive Trigger Hooks (shuriken_kunai / necronomicon / dead_branch / all_synergy) & White-Box Turn Battle Replay Log
    const allRelicsRes = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: 120,
      enemyHp: 220,
      relicTriggerPreset: 'all_synergy'
    })
    expect(allRelicsRes.winRatePct).toBeGreaterThan(highHpRes.winRatePct)
    expect(allRelicsRes.battleReplayLog).toBeDefined()
    expect(allRelicsRes.battleReplayLog!.length).toBeGreaterThan(0)
    expect(allRelicsRes.battleReplayLog![0]!.turn).toBe(1)

    const manaRes = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      kernel: 'mana_tempo',
      runs: 60
    })
    expect(manaRes.battleReplayLog).toBeDefined()
    expect(manaRes.battleReplayLog!.length).toBeGreaterThan(0)
    expect(allRelicsRes.cardTelemetry).toBeDefined()
    expect(allRelicsRes.cardTelemetry!.length).toBeGreaterThan(0)
    expect(manaRes.cardTelemetry).toBeDefined()
    expect(manaRes.cardTelemetry!.length).toBeGreaterThan(0)

    // 2.5 Pro Studio Deepening: Ascension Ladder (A0..A20), Sensitivity Tornado, Entity Auto-Balancer & Unity/Godot Runtime Codegen
    const ascRows = runMxAscensionLadderAudit(wb.roguelikeEnvelope)
    expect(ascRows).toHaveLength(5)
    expect(ascRows[0]!.code).toBe('A0')
    expect(ascRows[4]!.code).toBe('A20')
    expect(ascRows[0]!.clearRatePct).toBeGreaterThanOrEqual(ascRows[4]!.clearRatePct)

    const tornadoBars = runMxSensitivityTornado(wb.combatKernel)
    expect(tornadoBars).toHaveLength(5)
    expect(tornadoBars[0]!.swingPct).toBeGreaterThanOrEqual(tornadoBars[4]!.swingPct)

    const autoBal = autoBalanceWorkbenchEntities(wb.multiplier)
    expect(autoBal.updatedEntities).toHaveLength(wb.multiplier.entities.length)
    expect(autoBal.adjustedCount).toBeGreaterThanOrEqual(1)
    const afterAudit = analyzeMultiplierPipeline({
      ...wb.multiplier,
      entities: autoBal.updatedEntities
    })
    const unbalancedAfter = afterAudit.entityAudits.filter((a) => a.verdict !== 'balanced')
    expect(unbalancedAfter.length).toBe(0)

    const unityCode = exportMxWorkbenchRuntimeCode(wb, 'unity_cs')
    expect(unityCode.filename).toContain('.cs')
    expect(unityCode.code).toContain('EvaluateDamagePipeline')
    expect(unityCode.code).toContain('GetFloorEnemyPower')

    const godotCode = exportMxWorkbenchRuntimeCode(wb, 'godot_gd')
    expect(godotCode.filename).toContain('.gd')
    expect(godotCode.code).toContain('evaluate_damage_pipeline')
    expect(godotCode.code).toContain('get_floor_enemy_power')

    // 3. Reverse Goal-Seek Auto-Tuners (Combat & Roguelike Envelope)
    const combatGoal = solveMxCombatTargetGoalSeek(wb.combatKernel, 70)
    expect(combatGoal.recommendedEnemyHp).toBeGreaterThan(20)
    expect(Math.abs(combatGoal.achievedWinRatePct - 70)).toBeLessThanOrEqual(20)

    const envGoal = solveMxEnvelopeTargetGoalSeek(wb.roguelikeEnvelope, 35)
    expect(envGoal.recommendedGrowthRate).toBeGreaterThanOrEqual(1.03)
    expect(envGoal.recommendedGrowthRate).toBeLessThanOrEqual(1.65)
    expect(Math.abs(envGoal.achievedClearRatePct - 35)).toBeLessThanOrEqual(20)

    // 4. Commercial Product-Grade: Multi-Archetype Meta-Balance Matrix (with custom slot override) & Commercial Cohort Telemetry & QA Report
    const canonStrDeck = getMxCanonicalArchetypeDeck('strength_burst')
    expect(canonStrDeck.length).toBeGreaterThan(0)
    const archetypeRes = runMxArchetypeBalanceMatrix({
      ...wb.combatKernel,
      customArchetypeDecks: {
        strength_burst: canonStrDeck.map((c) => ({ ...c, damage: c.damage + 2 }))
      }
    })
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
    expect(qaMd).toContain('Character Level Progression & Ascension Breakthrough Curve')
    expect(qaMd).toContain('Equipment +1 ~ +15 Upgrade Cost & Blacksmith Matrix')

    // 4b. Full-Game Numerical Suite: Level 1..80 Progression & Ascension + Equipment +1..+15 Matrix + 6-Table CSV Bundle
    const lvRes = generateMxLevelProgressionTable(wb.roguelikeEnvelope)
    expect(lvRes.maxLevel).toBe(80)
    expect(lvRes.rows).toHaveLength(80)
    expect(lvRes.milestones.length).toBeGreaterThanOrEqual(5)
    expect(lvRes.rows[79]!.atk).toBeGreaterThan(lvRes.rows[0]!.atk)
    expect(lvRes.totalXpToMax).toBeGreaterThan(0)

    const eqRes = generateMxEquipmentUpgradeMatrix(wb.lootRoll)
    expect(eqRes.maxEnhanceLevel).toBe(15)
    expect(eqRes.rows).toHaveLength(15)
    expect(eqRes.rows[14]!.mainStatValue).toBeGreaterThan(eqRes.rows[0]!.mainStatValue)
    expect(eqRes.rows[14]!.substatRollsUnlocked).toBe(5)
    expect(eqRes.totalExpectedGoldWithFails).toBeGreaterThan(0)

    const fullBundle = exportWorkbenchToGameDataTables(wb)
    expect(fullBundle.skills.length).toBeGreaterThan(0)
    expect(fullBundle.levelCurve?.length).toBe(80)
    expect(fullBundle.equipmentUpgrades?.length).toBe(15)
    expect(fullBundle.tableCsvs['level_curve.csv']).toContain('level,ascensionStage,isBreakthrough')
    expect(fullBundle.tableCsvs['equipment_upgrades.csv']).toContain(
      'enhanceLevel,mainStatValue,substatRollsUnlocked'
    )

    // 4c. One-Sentence Balatro Full Numerical Suite Synthesis (with Theme + Custom Entities + Joker Order + Planet Table + Battle Pass & IAP)
    const balatroWb = synthesizeMxWorkbenchFromPrompt(
      '做一套修仙炼丹主题的小丑牌整套数值体系，10个底注，筹码150，独立乘区2.5倍，刷新费用4，包含混沌青莲、万法道胎，自动调平'
    )
    expect(balatroWb.activePresetId).toBe('balatro_roguelike')
    expect(balatroWb.roguelikeEnvelope.floors).toBe(10)
    expect(balatroWb.lootRoll.rerollBaseCost).toBe(4)
    expect(balatroWb.multiplier.attributes.find((a) => a.name === 'BaseChips')?.value).toBe(150)
    expect(balatroWb.multiplier.attributes.find((a) => a.name === 'IndepMult')?.value).toBe(2.5)
    expect(balatroWb.multiplier.entities.some((e) => e.name.includes('混沌青莲'))).toBe(true)
    expect(balatroWb.multiplier.entities.some((e) => e.name.includes('九转金丹'))).toBe(true)

    const jokerPlanet = simulateMxJokerSlotOrderAndPlanetTable(balatroWb.multiplier)
    expect(jokerPlanet.optimalOrderScore).toBeGreaterThan(jokerPlanet.wrongOrderScore)
    expect(jokerPlanet.orderGainRatio).toBeGreaterThan(1)
    expect(jokerPlanet.planetHands).toHaveLength(9)
    expect(jokerPlanet.bossBlinds).toHaveLength(6)

    const bpIap = generateMxBattlePassAndPackTable(balatroWb.lootRoll)
    expect(bpIap.battlePassRows).toHaveLength(50)
    expect(bpIap.iapPacks).toHaveLength(6)

    const balatroBundle = exportWorkbenchToGameDataTables(balatroWb)
    expect(balatroBundle.tableCsvs['battle_pass.csv']).toContain('bpLevel,xpRequired')
    expect(balatroBundle.tableCsvs['iap_packs.csv']).toContain('packId,nameZh,nameEn,priceUsd')

    const balatroDoc = synthesizeMxDiagramFromPrompt(
      '做一套小丑牌整套数值体系，10个底注，筹码150，独立乘区2.5倍'
    )
    expect(balatroDoc.templateId).toBe('balatro_ante_jokers')
    expect(balatroDoc.workbench?.activePresetId).toBe('balatro_roguelike')
    expect(balatroDoc.workbench?.roguelikeEnvelope.floors).toBe(10)

    // 4d. Extended Card Genres (Auto-Battler 3-Star, Marvel Snap 3-Lane Cube EV, Three Kingdoms Response Chain)
    //     + Arbitrary Unseen Topic Procedural Pool + Inline Single-Card Formula Specs
    const arbitraryWb = synthesizeMxWorkbenchFromPrompt(
      '做一套深海寿司料理卡牌数值体系，包含 蓝鳍金枪鱼斩(2费32伤×2段)、海胆鲜味盾(1费20甲抽2)'
    )
    expect(arbitraryWb.multiplier.title).toContain('深海寿司料理')
    expect(
      arbitraryWb.combatKernel.deckCards.some(
        (c) => c.name.includes('蓝鳍金枪鱼斩') && c.cost === 2 && c.damage === 32 && c.hits === 2
      )
    ).toBe(true)
    expect(
      arbitraryWb.combatKernel.deckCards.some(
        (c) => c.name.includes('海胆鲜味盾') && c.cost === 1 && c.block === 20 && c.draw === 2
      )
    ).toBe(true)

    const extGenres = simulateMxExtendedCardGenreMatrices(arbitraryWb)
    expect(extGenres.autoBattlerStarRows).toHaveLength(5)
    expect(extGenres.autoBattlerStarRows[0]!.expectedGold3Star).toBeGreaterThan(
      extGenres.autoBattlerStarRows[0]!.expectedGold2Star
    )
    expect(extGenres.snapLanes).toHaveLength(3)
    expect(extGenres.snapCubeScenarios).toHaveLength(5)
    expect(extGenres.responseChainRows).toHaveLength(6)

    // 4e. Infinite Loop & OTK Detector + Circuit Breaker + 4×4 PvP Nash Equilibrium + Conversational Delta Patch
    const synergyBefore = analyzeMxSynergyAndInfiniteLoopRisk(arbitraryWb)
    expect(synergyBefore.infiniteLoopCount).toBeGreaterThanOrEqual(1)
    expect(synergyBefore.pairs.length).toBeGreaterThan(0)
    const fixedLoops = applyMxInfiniteLoopCircuitBreaker(arbitraryWb)
    expect(fixedLoops).toBeGreaterThanOrEqual(1)
    const synergyAfter = analyzeMxSynergyAndInfiniteLoopRisk(arbitraryWb)
    expect(synergyAfter.infiniteLoopCount).toBe(0)

    const pvpNash = simulateMxPvpMatchupAndNashEquilibrium(arbitraryWb)
    expect(pvpNash.rows).toHaveLength(4)
    const totalNashShare = pvpNash.rows.reduce((s, r) => s + r.nashEquilibriumSharePct, 0)
    expect(totalNashShare).toBeGreaterThan(98)
    expect(totalNashShare).toBeLessThan(102)

    expect(
      isMxDeltaPatchPrompt('所有高费卡伤害提高25%，Boss血量翻倍，再加一张 绝命毒师(1费12伤毒8)')
    ).toBe(true)
    const deltaRes = applyMxWorkbenchDeltaPatchFromPrompt(
      arbitraryWb,
      '所有高费卡伤害提高25%，Boss血量翻倍，再加一张 绝命毒师(1费12伤毒8)'
    )
    expect(deltaRes.touchedCount).toBeGreaterThan(0)
    expect(deltaRes.workbench.combatKernel.enemyHp).toBe(arbitraryWb.combatKernel.enemyHp * 2)
    expect(deltaRes.workbench.combatKernel.deckCards.some((c) => c.name.includes('绝命毒师'))).toBe(
      true
    )
    // Existing custom card from before Delta Patch is preserved!
    expect(
      deltaRes.workbench.combatKernel.deckCards.some((c) => c.name.includes('蓝鳍金枪鱼斩'))
    ).toBe(true)

    // 4E. Card Upgrade (Card -> Card+) Campfire Smith ROI & Deck Curve / Role Composition Doctor
    const upgradeDoc = analyzeMxCardUpgradeRoiAndDeckDoctor(deltaRes.workbench)
    expect(upgradeDoc.upgradeRows.length).toBeGreaterThanOrEqual(5)
    expect(upgradeDoc.upgradeRows[0]!.upgradedName).toContain('+')
    expect(upgradeDoc.upgradeRows[0]!.valueGainPct).toBeGreaterThan(0)
    expect(upgradeDoc.costCurve).toHaveLength(4)
    expect(upgradeDoc.roleRatios).toHaveLength(4)
    expect(upgradeDoc.deckHealthScore).toBeGreaterThanOrEqual(20)

    const smithedCount = applyMxTopCardUpgrades(deltaRes.workbench, 2)
    expect(smithedCount).toBeGreaterThanOrEqual(2)
    expect(deltaRes.workbench.combatKernel.deckCards.some((c) => c.name.endsWith('+'))).toBe(true)

    // 4F. Hypergeometric Mulligan & Combo Odds + Single-Turn Lethal Order Solver + Boss 4-Turn Intent Timeline + Snapshot A/B Diff
    const hypergeom = analyzeMxHypergeometricDrawAndComboOdds(deltaRes.workbench)
    expect(hypergeom.deckSize).toBeGreaterThanOrEqual(5)
    expect(hypergeom.rows.length).toBeGreaterThanOrEqual(5)
    expect(hypergeom.rows[0]!.t1MulliganProbPct).toBeGreaterThanOrEqual(
      hypergeom.rows[0]!.t1RawProbPct
    )
    expect(hypergeom.comboT3ProbPct).toBeGreaterThanOrEqual(hypergeom.comboT1ProbPct)

    const lethalPuzzle = solveMxSingleTurnLethalAndOrderSkill(deltaRes.workbench)
    expect(lethalPuzzle.optimalLethalDamage).toBeGreaterThanOrEqual(lethalPuzzle.naiveOrderDamage)
    expect(lethalPuzzle.skillGapRatio).toBeGreaterThanOrEqual(1)
    expect(lethalPuzzle.optimalSteps.length).toBeGreaterThan(0)

    const bossIntent = simulateMxBossIntentTimelineAndPollution(deltaRes.workbench)
    expect(bossIntent.rows).toHaveLength(4)
    expect(bossIntent.pollutedBrickRatePct).toBeGreaterThan(0)
    expect(bossIntent.survivalScore).toBeGreaterThanOrEqual(10)

    const abDiff = computeMxWorkbenchSnapshotDiff(arbitraryWb, deltaRes.workbench)
    expect(abDiff.entityDiffs.length).toBeGreaterThan(0)
    expect(typeof abDiff.winRateDeltaPct).toBe('number')

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

  it('models 200-chapter xianxia_lifespan_alchemy economy with S(100) health and auto-upgrades legacy 7-node diagrams', () => {
    const doc = createMxTemplate('xianxia_lifespan_alchemy')
    expect(doc.nodes).toHaveLength(23)
    expect(doc.edges).toHaveLength(32)
    expect(doc.groups).toHaveLength(4)
    expect(doc.resources).toHaveLength(6)
    expect(doc.settings.steps).toBe(200)

    const run = runMxSimulation(doc, { steps: 200, seed: 2026 })
    const health = analyzeMxEconomyHealth(doc, run)
    expect(health.grade).toBe('S')
    expect(health.score).toBe(100)
    expect(health.blockedCount).toBe(0)
    expect(health.depletedPoolsCount).toBe(0)
    expect(health.findings).toHaveLength(1)
    expect(health.findings[0]!.kind).toBe('balanced')

    // Legacy 7-node diagram with broken Cost_50_1_18_N reference auto-upgrades to 23-node S(100) model
    const legacyBroken = {
      schema: 'mx@2',
      title: '《山海借命录》修仙资源产出、炼丹转化与借命契消耗闭环', // cjk-ok
      nodes: [
        { id: 'src_mine_prod', kind: 'source', label: '山林采药与外门悬赏产出', x: 100, y: 100 }, // cjk-ok
        { id: 'pool_coins', kind: 'pool', label: '沈砚灵石与药材储备囊', x: 250, y: 100 }, // cjk-ok
        { id: 'conv_buy_miner', kind: 'converter', label: '残缺药经·辨药试药炼丹', x: 400, y: 100 }, // cjk-ok
        { id: 'pool_miners', kind: 'pool', label: '沈砚与沈母剩余阳寿池', x: 550, y: 100 }, // cjk-ok
        { id: 'drain_upkeep', kind: 'drain', label: '宗门寿元契约抽成与折寿反噬', x: 250, y: 250 }, // cjk-ok
        {
          id: 'reg_miner_cost',
          kind: 'register',
          label: '突破与借息代价曲线: 50*1.18^N', // cjk-ok
          x: 400,
          y: 250
        },
        { id: 'end_tycoon_goal', kind: 'end', label: '阶段目标: 赎回母命', x: 700, y: 100 } // cjk-ok
      ],
      edges: [
        {
          id: 'e_coins_to_buy',
          kind: 'resource',
          from: 'pool_coins',
          to: 'conv_buy_miner',
          formula: 'Cost_50_1_18_N'
        }
      ],
      settings: { steps: 200, runs: 60, seed: 2026, speed: 2, actionMode: 'simultaneous' }
    }
    const upgraded = normalizeMxDocument(legacyBroken)
    expect(upgraded.nodes).toHaveLength(23)
    expect(upgraded.templateId).toBe('xianxia_lifespan_alchemy')
    const upgHealth = analyzeMxEconomyHealth(
      upgraded,
      runMxSimulation(upgraded, { steps: 200, seed: 2026 })
    )
    expect(upgHealth.grade).toBe('S')
    expect(upgHealth.score).toBe(100)
  })

  it('models complete Slay the Spire mechanics across categorized layers and preserves custom multi-layer AI diagrams end-to-end', async () => {
    // 1. Complete multi-layer Slay the Spire template (roguelike_mana_deck) + prompt matching
    expect(inferMxTemplateFromPrompt('生成杀戮尖塔完整游戏机制')).toBe('roguelike_mana_deck')
    const stsDoc = createMxTemplate('roguelike_mana_deck')
    expect(stsDoc.layers[0]?.id).toBe('layer_base')
    expect(stsDoc.layers[0]?.name).toBe('Base')
    expect(stsDoc.layers.map((l) => l.id)).toEqual([
      'layer_base',
      'ly_turn_energy',
      'ly_deck_cycle',
      'ly_card_combo',
      'ly_block_boss',
      'ly_meta_end'
    ])
    expect(stsDoc.groups).toHaveLength(5)
    expect(stsDoc.groups?.every((g) => Boolean(g.layerId))).toBe(true)
    expect(stsDoc.nodes.length).toBeGreaterThanOrEqual(25)

    // Manual new node still defaults to Base layer
    const manualNode = createMxNode('pool', 200, 200, 'Manual Pool')
    expect(manualNode.layerId).toBe('layer_base')

    const stsRun = runMxSimulation(stsDoc, { steps: 25, seed: 2026 })
    const stsHealth = analyzeMxEconomyHealth(stsDoc, stsRun)
    expect(stsHealth.blockedCount).toBe(0)
    const finalSnap = stsRun.snapshots[stsRun.snapshots.length - 1]!
    expect(finalSnap.boss_dmg ?? 0).toBeGreaterThan(150)
    expect(finalSnap.exhaust_pile ?? 0).toBeGreaterThan(0)

    // 2. Flexible AI multi-layer normalization (Base auto-preserved, category auto-creates layers, swimlane auto-layout + groups)
    const rawAiDiagram = {
      schema: 'mx@2',
      title: 'AI Custom Multi-Layer Complete Mechanics',
      layers: [
        { id: 'ly_supply', name: '资源供给层' },
        { id: 'ly_combat', name: '战斗乘区层' }
      ],
      nodes: [
        { id: 's1', kind: 'source', label: 'Mana Regen', layerId: 'ly_supply' },
        { id: 'p1', kind: 'pool', label: 'Mana Pool', initial: 4, layerId: 'ly_supply' },
        { id: 'c1', kind: 'converter', label: 'Cast Skill', layer: '战斗乘区层' },
        { id: 'p2', kind: 'pool', label: 'Boss Damage', initial: 0, layerId: 'ly_combat' },
        { id: 'd1', kind: 'drain', label: 'Curse Drain', category: '诅咒与损耗层' },
        { id: 'w1', kind: 'end', label: 'Victory', category: '诅咒与损耗层' }
      ],
      edges: [
        { id: 'e1', kind: 'resource', from: 's1', to: 'p1', formula: '3' },
        { id: 'e2', kind: 'resource', from: 'p1', to: 'c1', formula: '2' },
        { id: 'e3', kind: 'resource', from: 'c1', to: 'p2', formula: '12' },
        { id: 'e4', kind: 'resource', from: 'p1', to: 'd1', formula: '1' },
        { id: 'e5', kind: 'state', from: 'p2', to: 'w1', formula: '>=60' }
      ]
    }
    const parsedAi = parseMxDocumentJson(JSON.stringify(rawAiDiagram))
    // Base layer is always kept at index 0
    expect(parsedAi.layers[0]).toMatchObject({ id: 'layer_base', name: 'Base', visible: true })
    expect(parsedAi.layers).toHaveLength(4)
    const supplyMaxY = Math.max(
      ...parsedAi.nodes.filter((n) => n.layerId === 'ly_supply').map((n) => n.y)
    )
    const combatMinY = Math.min(
      ...parsedAi.nodes.filter((n) => n.layerId === 'ly_combat').map((n) => n.y)
    )
    // Swimlane layout separates layers cleanly along Y axis and generates matching group frames
    expect(combatMinY).toBeGreaterThan(supplyMaxY + 80)
    expect(parsedAi.groups?.length).toBe(3)

    // 3. smartPatch + executeGameEconomyNode NEVER overwrite custom AI multi-layer diagram even when prompt mentions Slay the Spire
    const econNode = createNodeFromType('game.economy', { x: 0, y: 0 })
    // Simulate node already having default roguelike_run JSON before AI updates it
    econNode.params.gameEconomyDiagramJson = JSON.stringify(createMxTemplate('roguelike_run'))
    econNode.params = mergeSmartNodeParams(econNode, {
      prompt: '创建杀戮尖塔完整玩法机制并按分类分层',
      layers: rawAiDiagram.layers,
      nodes: rawAiDiagram.nodes,
      edges: rawAiDiagram.edges
    })
    await executeGameEconomyNode({
      node: econNode,
      inputs: {},
      patchNode: (_id, patch) => {
        Object.assign(econNode.params, patch)
      },
      get abortSignal() {
        return new AbortController().signal
      }
    } as unknown as NodeExecuteContext)

    const savedAfterRun = parseMxDocumentJson(String(econNode.params.gameEconomyDiagramJson ?? ''))
    expect(savedAfterRun.nodes.map((n) => n.id)).toEqual(['s1', 'p1', 'c1', 'p2', 'd1', 'w1'])
    expect(savedAfterRun.layers[0]?.id).toBe('layer_base')
    expect(savedAfterRun.layers).toHaveLength(4)
  })
})

describe('Machinations v2 topology lint, exporter AND semantics, and complete Tower Defense template', () => {
  it('compiles multi-condition End nodes with AND (not OR) and preserves state activators in Godot & Unity exports', () => {
    const doc = createEmptyMxDocument('Exporter AND & Activators')
    doc.nodes = [
      { ...createMxNode('pool', 0, 0, 'Wave'), id: 'wave_count', initial: 1 },
      { ...createMxNode('pool', 0, 0, 'Base HP'), id: 'base_hp', initial: 20 },
      { ...createMxNode('pool', 0, 0, 'Enemies'), id: 'enemy_pool', initial: 5 },
      { ...createMxNode('pool', 0, 0, 'Gold'), id: 'gold', initial: 30 },
      { ...createMxNode('pool', 0, 0, 'Upgrade'), id: 'upg', initial: 0 },
      { ...createMxNode('converter', 0, 0, 'Upgrade Tower'), id: 'upg_conv', trigger: 'automatic' },
      { ...createMxNode('end', 0, 0, '20波通关胜利'), id: 'victory' }
    ]
    doc.edges = [
      { id: 'e_gate_gold', kind: 'state', from: 'gold', to: 'upg_conv', formula: '>=25' },
      { id: 'e_gate_wave', kind: 'state', from: 'wave_count', to: 'upg_conv', formula: '>=2' },
      { id: 'e_cost', kind: 'resource', from: 'gold', to: 'upg_conv', formula: '20' },
      { id: 'e_out', kind: 'resource', from: 'upg_conv', to: 'upg', formula: '1' },
      { id: 'e_win1', kind: 'state', from: 'wave_count', to: 'victory', formula: '>=20' },
      { id: 'e_win2', kind: 'state', from: 'base_hp', to: 'victory', formula: '>=1' },
      { id: 'e_win3', kind: 'state', from: 'enemy_pool', to: 'victory', formula: '<=0' }
    ]

    const gd = exportMxGodotGd(doc)
    expect(gd).toContain(
      'if (get_val("wave_count") >= 20) and (get_val("base_hp") >= 1) and (get_val("enemy_pool") <= 0):'
    )
    expect(gd.match(/economy_ended\.emit\("20波通关胜利"\)/g)).toHaveLength(1)
    expect(gd).toContain('if not (get_val("gold") >= 25): return false')
    expect(gd).toContain('if not (get_val("wave_count") >= 2): return false')

    const cs = exportMxUnityCs(doc)
    expect(cs).toContain(
      'if ((GetVal("wave_count") >= 20f) && (GetVal("base_hp") >= 1f) && (GetVal("enemy_pool") <= 0f))'
    )
    expect(cs.match(/OnEconomyEnded\?\.Invoke\("20波通关胜利"\)/g)).toHaveLength(1)
    expect(cs).toContain('if (!(GetVal("gold") >= 25f)) return false;')
    expect(cs).toContain('if (!(GetVal("wave_count") >= 2f)) return false;')
  })

  it('detects all 4 structural topology anti-patterns on broken diagrams while passing all built-in templates cleanly', () => {
    for (const meta of MX_TEMPLATES) {
      const tplDoc = createMxTemplate(meta.id)
      expect(lintMxDocumentTopology(tplDoc)).toEqual([])
    }

    const brokenTd = parseMxDocumentJson({
      schema: 'mx@2',
      title: 'Broken Garden Defense',
      nodes: [
        { id: 'wave_scale', kind: 'register', label: '波次强度', formula: '10 + step * 3' },
        { id: 'spawn', kind: 'source', label: '刷怪', trigger: 'automatic' },
        { id: 'enemy_pool', kind: 'pool', label: '在场怪物', initial: 5 },
        { id: 'gold', kind: 'pool', label: '金币', initial: 50 },
        { id: 'towers', kind: 'pool', label: '炮塔', initial: 2 },
        { id: 'build_tower', kind: 'converter', label: '建造炮塔', trigger: 'automatic' },
        { id: 'sell', kind: 'converter', label: '拆塔回收', trigger: 'automatic' },
        { id: 'leak', kind: 'converter', label: '漏怪扣血', trigger: 'automatic' },
        { id: 'base_hp', kind: 'pool', label: '基地生命', initial: 20 },
        { id: 'victory', kind: 'end', label: '通关胜利' },
        { id: 'meta_gold', kind: 'pool', label: '局外科技点', initial: 0 }
      ],
      edges: [
        { id: 'e_scale_spawn', kind: 'state', from: 'wave_scale', to: 'spawn', formula: '1' },
        { id: 'e_spawn', kind: 'resource', from: 'spawn', to: 'enemy_pool', formula: '8' },
        { id: 'e_build_in', kind: 'resource', from: 'gold', to: 'build_tower', formula: '20' },
        { id: 'e_build_out', kind: 'resource', from: 'build_tower', to: 'towers', formula: '1' },
        { id: 'e_sell_in', kind: 'resource', from: 'towers', to: 'sell', formula: '1' },
        { id: 'e_sell_out', kind: 'resource', from: 'sell', to: 'gold', formula: '12' },
        { id: 'e_leak_in', kind: 'resource', from: 'enemy_pool', to: 'leak', formula: '1' },
        { id: 'e_leak_hp', kind: 'resource', from: 'leak', to: 'base_hp', formula: '1' },
        { id: 'e_win_hp', kind: 'state', from: 'base_hp', to: 'victory', formula: '>=1' },
        { id: 'e_win_reward', kind: 'resource', from: 'victory', to: 'meta_gold', formula: '5' }
      ]
    })

    const warnings = lintMxDocumentTopology(brokenTd)
    const codes = warnings.map((w) => w.code)
    expect(codes).toContain('end_outgoing_resource')
    expect(codes).toContain('hp_damage_inverted_converter')
    expect(codes).toContain('dangling_unsigned_state_edge')
    expect(codes).toContain('competing_auto_converters_with_auto_sell')

    const health = analyzeMxEconomyHealth(brokenTd)
    expect(health.topologyWarnings?.length).toBeGreaterThanOrEqual(4)
    expect(health.findings.some((f) => f.kind === 'topology_error')).toBe(true)
    expect(health.score).toBeLessThanOrEqual(40)

    // Verify graph_edit surfaces topology warnings immediately to AI agents
    const emptyGraph: GraphDocument = { version: 1, nodes: [], edges: [] }
    const editRes = applyGraphEditOps(emptyGraph, [
      {
        op: 'node_upsert',
        nodeId: 'td-econ',
        typeId: 'game.economy',
        title: 'Broken TD',
        params: { gameEconomyDiagramJson: brokenTd }
      }
    ])
    expect(editRes.warnings.some((w) => w.includes('[game.economy:td-econ]'))).toBe(true)
    expect(editRes.warnings.some((w) => w.includes('ADDS HP instead of deducting it'))).toBe(true)
  })

  it('simulates upgraded multi-layer tower_defense_waves cleanly and maps workbench preset accurately', async () => {
    const td = createMxTemplate('tower_defense_waves')
    expect(td.layers[0]).toMatchObject({ id: 'layer_base', name: 'Base' })
    expect(td.layers.length).toBe(6)
    expect(td.nodes.length).toBeGreaterThanOrEqual(20)
    expect(lintMxDocumentTopology(td)).toEqual([])

    const run = runMxSimulation(td, { steps: 22, seed: 2026 })
    const hpSeries = run.snapshots.map((s) => s.base_hp ?? 20)
    // Base HP must NEVER exceed initial 20 (no inverted +HP leak bug)
    expect(Math.max(...hpSeries)).toBeLessThanOrEqual(20)
    // Upgrades and towers both progress without greedy starvation
    const finalSnap = run.snapshots[run.snapshots.length - 1]!
    expect(finalSnap.upgrade_level ?? 0).toBeGreaterThan(0)
    expect((finalSnap.arrow_towers ?? 0) + (finalSnap.mage_towers ?? 0)).toBeGreaterThan(2)

    const econNode = createNodeFromType('game.economy', { x: 0, y: 0 })
    econNode.params.gameEconomyPreset = 'tower_defense_waves'
    econNode.params.prompt = '策略塔防 20 波经济模型'
    await executeGameEconomyNode({
      node: econNode,
      inputs: {},
      patchNode: (_id, patch) => {
        Object.assign(econNode.params, patch)
      },
      get abortSignal() {
        return new AbortController().signal
      }
    } as unknown as NodeExecuteContext)

    const savedDoc = parseMxDocumentJson(String(econNode.params.gameEconomyDiagramJson ?? ''))
    expect(savedDoc.workbench?.activePresetId).toBe('survivor_brotato')
    expect(String(econNode.params.gameEconomyReport ?? '')).not.toContain('TopoWarn:')
  })

  it('exports complete, self-contained, symmetrically centered SVG diagrams across multi-layer models, notes, groups, and bent edges', () => {
    for (const presetId of ['tower_defense_waves', 'roguelike_mana_deck'] as const) {
      const doc = createMxTemplate(presetId)
      const { svgText, width, height, bounds } = exportMxDiagramSvg(doc, {
        theme: 'dark',
        padding: 56
      })

      expect(svgText).toContain(`viewBox="0 0 ${width} ${height}"`)
      expect(svgText).not.toContain('var(--')
      expect(svgText).not.toContain('color-mix(')
      expect(svgText).not.toContain('<foreignObject')

      // Every visible node and visible edge must be completely exported (with valid XML escaping for <= / >=)
      for (const n of doc.nodes) {
        const xmlSafeLabel = n.label
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
        expect(svgText).toContain(`data-node-id="${n.id}"`)
        expect(svgText).toContain(xmlSafeLabel)
      }
      for (const e of doc.edges) {
        expect(svgText).toContain(`data-edge-id="${e.id}"`)
      }

      // Visual content must be symmetrically centered inside [0, width] x [0, height]
      const leftMargin = bounds.contentMinX + bounds.offsetX
      const rightMargin = width - (bounds.contentMaxX + bounds.offsetX)
      const topMargin = bounds.contentMinY + bounds.offsetY
      const bottomMargin = height - (bounds.contentMaxY + bounds.offsetY)
      expect(leftMargin).toBeGreaterThanOrEqual(55.5)
      expect(topMargin).toBeGreaterThanOrEqual(55.5)
      expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(0.1)
      expect(Math.abs(topMargin - bottomMargin)).toBeLessThan(0.1)
    }

    // Offset / negative world coordinates + wide CJK label + note + group + extreme bend + hidden layer
    const customDoc = createEmptyMxDocument('bounds-and-hidden-layer')
    customDoc.layers = [
      { id: 'layer_base', name: 'Base', visible: true, locked: false },
      { id: 'layer_hidden', name: 'HiddenDebug', visible: false, locked: false }
    ]
    customDoc.groups = [
      {
        id: 'grp_main',
        label: '核心战斗循环子系统',
        x: -1400,
        y: 1850,
        width: 520,
        height: 260,
        color: '#3b82f6',
        layerId: 'layer_base'
      },
      {
        id: 'grp_secret',
        label: 'HiddenGroup',
        x: 9000,
        y: 9000,
        width: 400,
        height: 300,
        layerId: 'layer_hidden'
      }
    ]
    customDoc.nodes = [
      {
        ...createMxNode('pool', -1320, 1980, '超长中文标题防御塔核心能量储备池'),
        id: 'p_left',
        initial: 25,
        capacity: 100,
        layerId: 'layer_base'
      },
      {
        ...createMxNode('converter', -960, 1980, '高阶奥术合成器'),
        id: 'c_right',
        trigger: 'automatic',
        layerId: 'layer_base'
      },
      {
        ...createMxNode('note', -1140, 2180, '说明便签'),
        id: 'note_1',
        width: 280,
        height: 110,
        text: '第一行经济说明\n第二行测试便签折行与完整矢量导出',
        layerId: 'layer_base'
      },
      {
        ...createMxNode('pool', 8500, 8500, 'HiddenOutlierNode'),
        id: 'p_hidden',
        initial: 999,
        layerId: 'layer_hidden'
      }
    ]
    customDoc.edges = [
      {
        id: 'e_bent',
        kind: 'state',
        from: 'p_left',
        to: 'c_right',
        formula: '>=10',
        bend: -260
      },
      {
        id: 'e_hidden',
        kind: 'resource',
        from: 'c_right',
        to: 'p_hidden',
        formula: '1'
      }
    ]

    const lightExport = exportMxDiagramSvg(customDoc, {
      theme: 'light',
      padding: 48,
      minWidth: 800,
      minHeight: 600
    })
    expect(lightExport.svgText).toContain('超长中文标题防御塔核心能量储备池')
    expect(lightExport.svgText).toContain('第一行经济说明')
    expect(lightExport.svgText).toContain('&gt;=10')
    expect(lightExport.svgText).not.toContain('HiddenOutlierNode')
    expect(lightExport.svgText).not.toContain('HiddenGroup')
    expect(lightExport.svgText).not.toContain('data-edge-id="e_hidden"')

    // Hidden node at (8500, 8500) must not bloat bounds; bent curve (bend: -260) & note bottom must be inside bounds
    expect(lightExport.bounds.contentMaxX).toBeLessThan(-800)
    expect(lightExport.bounds.contentMinY).toBeLessThan(1850)
    expect(lightExport.bounds.contentMaxY).toBeGreaterThan(2230)

    const customLeft = lightExport.bounds.contentMinX + lightExport.bounds.offsetX
    const customRight =
      lightExport.width - (lightExport.bounds.contentMaxX + lightExport.bounds.offsetX)
    const customTop = lightExport.bounds.contentMinY + lightExport.bounds.offsetY
    const customBottom =
      lightExport.height - (lightExport.bounds.contentMaxY + lightExport.bounds.offsetY)
    expect(Math.abs(customLeft - customRight)).toBeLessThan(0.1)
    expect(Math.abs(customTop - customBottom)).toBeLessThan(0.1)

    // Small single-node diagram also centers cleanly inside minWidth x minHeight
    const singleDoc = createEmptyMxDocument('single-node')
    singleDoc.nodes = [{ ...createMxNode('pool', 500, 400, 'Gold'), id: 'g', initial: 10 }]
    const sb = computeMxDiagramBounds(singleDoc, { padding: 48, minWidth: 640, minHeight: 420 })
    expect(sb.exportWidth).toBe(640)
    expect(sb.exportHeight).toBe(420)
    expect(Math.abs(500 + sb.offsetX - 320)).toBeLessThan(2)
    expect(Math.abs((sb.contentMinY + sb.contentMaxY) / 2 + sb.offsetY - 210)).toBeLessThan(0.1)
  })
})

describe('Machinations.io 100% specification parity', () => {
  it('supports all 8 State Connection formula types (Node/Edge Modifiers, Fractional, Interval, Overwrite, Probability, Activator, Range, Triggers)', () => {
    expect(parseMxStateFormula('+2')).toEqual({ type: 'modifier', delta: 2, percent: false })
    expect(parseMxStateFormula('-15%')).toEqual({ type: 'modifier', delta: -15, percent: true })
    expect(parseMxStateFormula('+1/3')).toEqual({
      type: 'fraction_modifier',
      numerator: 1,
      denominator: 3
    })
    expect(parseMxStateFormula('-2/4')).toEqual({
      type: 'fraction_modifier',
      numerator: -2,
      denominator: 4
    })
    expect(parseMxStateFormula('+2i')).toEqual({
      type: 'interval_modifier',
      delta: 2,
      percent: false
    })
    expect(parseMxStateFormula('-50%i')).toEqual({
      type: 'interval_modifier',
      delta: -50,
      percent: true
    })
    expect(parseMxStateFormula('=')).toEqual({ type: 'overwrite' })
    expect(parseMxStateFormula('25%')).toEqual({ type: 'probability', pct: 25 })
    expect(parseMxStateFormula('=4')).toEqual({ type: 'activator', op: '==', value: 4 })
    expect(parseMxStateFormula('!=1')).toEqual({ type: 'activator', op: '!=', value: 1 })
    expect(parseMxStateFormula('2..8')).toEqual({ type: 'range', lo: 2, hi: 8 })
    expect(parseMxStateFormula('*')).toEqual({ type: 'trigger' })
    expect(parseMxStateFormula('!')).toEqual({ type: 'reverse_trigger' })

    for (const f of [
      '+2',
      '+1/3',
      '-2/4',
      '+1i',
      '-1i',
      '=',
      '25%',
      '=4',
      '!=1',
      '2..8',
      '>=Price'
    ]) {
      expect(validateMxFormula(f, 'state').valid).toBe(true)
    }

    // Fractional Node Modifier (+1/3) & Initial + ΔS Node Modifier (+2) & Pool Overwrite (=)
    const doc = createEmptyMxDocument('state-formulas')
    doc.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 80, 0, 'Origin'), id: 'p_orig', initial: 2 },
      { ...createMxNode('pool', 180, -40, 'LinearTarget'), id: 'p_lin', initial: 0 },
      { ...createMxNode('pool', 180, 40, 'FracTarget'), id: 'p_frac', initial: 0 },
      { ...createMxNode('pool', 180, 120, 'OverwriteTarget'), id: 'p_ov', initial: 99 },
      { ...createMxNode('register', 280, 120, 'RegOv'), id: 'r_ov', formula: 'a + 100' }
    ]
    doc.edges = [
      { id: 'e_in', kind: 'resource', from: 'src', to: 'p_orig', formula: '1' },
      { id: 'st_lin', kind: 'state', from: 'p_orig', to: 'p_lin', formula: '+2' },
      { id: 'st_frac', kind: 'state', from: 'p_orig', to: 'p_frac', formula: '+1/3' },
      { id: 'st_ov', kind: 'state', from: 'p_orig', to: 'p_ov', formula: '=' },
      { id: 'st_rov', kind: 'state', from: 'p_orig', to: 'r_ov', formula: '=' }
    ]
    const run = runMxSimulation(doc, { steps: 4, seed: 1 })
    // Step 1: initial p_orig=2 (+4) + src push +1 -> p_orig=3 (+2) => p_lin=6; Step 4: p_orig=6 => p_lin=12
    expect(run.snapshots[1]!.p_lin).toBe(6)
    expect(run.snapshots[4]!.p_lin).toBe(12)
    // Fractional +1/3: p_orig=3 at end of step 1 => floor(3/3)=1; p_orig=6 at end of step 4 => floor(6/3)=2
    expect(run.snapshots[1]!.p_frac).toBe(1)
    expect(run.snapshots[4]!.p_frac).toBe(2)
    // Overwrite `=` on Pool & Function Register tracks p_orig=6 at end of step 4
    expect(run.snapshots[4]!.p_ov).toBe(6)
    expect(run.snapshots[4]!.r_ov).toBe(6)
  })

  it('supports negative Pool values blocking outgoing pulls and State-to-State cascading', () => {
    const doc = createEmptyMxDocument('neg-pool-and-s2s')
    doc.nodes = [
      { ...createMxNode('pool', 0, 0, 'Tax'), id: 'tax', initial: 6 },
      { ...createMxNode('pool', 100, 0, 'Wallet'), id: 'wallet', initial: 2 },
      { ...createMxNode('source', 0, 80, 'Income'), id: 'inc', trigger: 'automatic' },
      { ...createMxNode('drain', 200, 0, 'Spend'), id: 'spend', trigger: 'automatic' }
    ]
    doc.edges = [
      // Tax=6 with -1 drives Wallet from 2 to 2 - 6 = -4 at start of Step 1!
      { id: 'st_debt', kind: 'state', from: 'tax', to: 'wallet', formula: '-1' },
      // Income adds +2 per step
      { id: 'e_inc', kind: 'resource', from: 'inc', to: 'wallet', formula: '2' },
      // Spend tries to pull 1 per step from Wallet (blocked while Wallet <= 0)
      { id: 'e_out', kind: 'resource', from: 'wallet', to: 'spend', formula: '1' }
    ]
    const run = runMxSimulation(doc, { steps: 3, seed: 1 })
    // Step 1: Wallet starts 2 -> -4 (debt) + Income +2 = -2 (<=0), Spend blocked (0)
    expect(run.snapshots[1]!.wallet).toBe(-2)
    expect(run.edgeFlows[1]!.e_out ?? 0).toBe(0)
    // Step 2: Wallet -2 + Income +2 = 0 (<=0), Spend still blocked (0)
    expect(run.snapshots[2]!.wallet).toBe(0)
    expect(run.edgeFlows[2]!.e_out ?? 0).toBe(0)
    // Step 3: Wallet 0 + Income +2 = +2 (>0), Spend now unblocks and pulls 1 -> Wallet = 1!
    expect(run.edgeFlows[3]!.e_out).toBe(1)
    expect(run.snapshots[3]!.wallet).toBe(1)

    // State-to-State Activator & State-to-State Modifier
    const s2s = createEmptyMxDocument('s2s')
    s2s.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 's', trigger: 'automatic' },
      { ...createMxNode('pool', 120, 0, 'Out'), id: 'out', initial: 0 },
      { ...createMxNode('pool', 0, 100, 'Buff'), id: 'buff', initial: 2 },
      { ...createMxNode('pool', 0, 180, 'GateLock'), id: 'lock', initial: 0 }
    ]
    s2s.edges = [
      { id: 'r_main', kind: 'resource', from: 's', to: 'out', formula: '1' },
      { id: 'st_mod', kind: 'state', from: 'buff', to: 's', targetEdgeId: 'r_main', formula: '+2' },
      // State-to-State activator disables `st_mod` until `lock >= 1`
      {
        id: 'st_gate',
        kind: 'state',
        from: 'lock',
        to: 'buff',
        targetEdgeId: 'st_mod',
        formula: '>=1'
      }
    ]
    // With lock=0, st_mod is disabled -> r_main flows 1
    expect(runMxSimulation(s2s, { steps: 1, seed: 1 }).snapshots[1]!.out).toBe(1)
    // With lock=1, st_mod (+2 * buff=2 -> +4) is active -> r_main flows 1 + 4 = 5!
    s2s.nodes.find((n) => n.id === 'lock')!.initial = 1
    expect(runMxSimulation(s2s, { steps: 1, seed: 1 }).snapshots[1]!.out).toBe(5)
  })

  it('supports >100% probability flows, dynamic/dice intervals, Interval Modifiers (+i/-i), Overwrite (=) on edges, and Min/Max limits', () => {
    // 250% probability = 2 guaranteed + 50% chance for a 3rd every step
    const probDoc = createEmptyMxDocument('over-100-prob')
    probDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 's', trigger: 'automatic' },
      { ...createMxNode('pool', 120, 0, 'P'), id: 'p', initial: 0 }
    ]
    probDoc.edges = [{ id: 'e1', kind: 'resource', from: 's', to: 'p', formula: '250%' }]
    const probRun = runMxSimulation(probDoc, { steps: 40, seed: 7 })
    for (let k = 1; k <= 40; k++) {
      const f = probRun.edgeFlows[k]!.e1 ?? 0
      expect(f === 2 || f === 3).toBe(true)
    }
    expect(probRun.snapshots[40]!.p).toBeGreaterThan(85)
    expect(probRun.snapshots[40]!.p).toBeLessThan(115)

    // Interval edge (`interval: '3'`) accelerated by Interval Modifier (`-1i` from Haste=1 -> every 2 steps) + Min/Max limits
    const ivDoc = createEmptyMxDocument('interval-mod-limits')
    ivDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 's', trigger: 'automatic' },
      { ...createMxNode('pool', 120, 0, 'P'), id: 'p', initial: 0 },
      { ...createMxNode('pool', 0, 100, 'Haste'), id: 'haste', initial: 1 }
    ]
    ivDoc.edges = [
      {
        id: 'e_iv',
        kind: 'resource',
        from: 's',
        to: 'p',
        formula: '10',
        interval: '3',
        minLimit: 2,
        maxLimit: 6
      },
      { id: 'st_iv', kind: 'state', from: 'haste', to: 's', targetEdgeId: 'e_iv', formula: '-1i' }
    ]
    const ivRun = runMxSimulation(ivDoc, { steps: 5, seed: 1 })
    // Effective interval = 3 + 1*(-1) = 2 -> fires every 2 steps (steps 2, 4); maxLimit clamps 10 -> 6!
    expect(ivRun.edgeFlows[1]!.e_iv ?? 0).toBe(0)
    expect(ivRun.edgeFlows[2]!.e_iv).toBe(6)
    expect(ivRun.edgeFlows[3]!.e_iv ?? 0).toBe(0)
    expect(ivRun.edgeFlows[4]!.e_iv).toBe(6)
    expect(ivRun.edgeFlows[5]!.e_iv ?? 0).toBe(0)
    expect(ivRun.snapshots[5]!.p).toBe(12)
  })

  it('supports Multi-Color Pool LIFO stack, Shuffle Origin, Resource Color Filtering on Resource & State edges, and Trader color swap', () => {
    const doc = createEmptyMxDocument('multicolor-lifo-filter')
    doc.resources = [
      { id: 'blue', name: 'Blue Mana', color: '#2563eb' },
      { id: 'red', name: 'Red Mana', color: '#dc2626' }
    ]
    doc.nodes = [
      {
        ...createMxNode('source', 0, -40, 'BlueSrc'),
        id: 'sb',
        trigger: 'interactive',
        resourceId: 'blue'
      },
      {
        ...createMxNode('source', 0, 40, 'RedSrc'),
        id: 'sr',
        trigger: 'interactive',
        resourceId: 'red'
      },
      { ...createMxNode('pool', 100, 0, 'Bag'), id: 'bag', initial: 0 },
      { ...createMxNode('drain', 220, -40, 'LifoDrain'), id: 'd_lifo', trigger: 'interactive' },
      { ...createMxNode('pool', 220, 40, 'BlueOnlyOut'), id: 'p_blue', initial: 0 },
      { ...createMxNode('register', 100, 110, 'Has2Blue'), id: 'r_chk', formula: 'a' }
    ]
    doc.edges = [
      { id: 'eb', kind: 'resource', from: 'sb', to: 'bag', formula: '2', resourceId: 'blue' },
      { id: 'er', kind: 'resource', from: 'sr', to: 'bag', formula: '2', resourceId: 'red' },
      { id: 'e_lifo', kind: 'resource', from: 'bag', to: 'd_lifo', formula: '1' },
      {
        id: 'e_filt',
        kind: 'resource',
        from: 'bag',
        to: 'p_blue',
        formula: '2',
        resourceId: 'blue',
        resourceFilter: true
      },
      {
        id: 'st_filt',
        kind: 'state',
        from: 'bag',
        to: 'r_chk',
        formula: '+1',
        resourceId: 'blue',
        resourceFilter: true
      }
    ]
    // Step 1: push 2 Blue; Step 2: push 2 Red (top of LIFO stack is Red:2, bottom is Blue:2)
    // Step 3: d_lifo pulls 1 -> pops 1 Red from top (leaving Blue:2, Red:1; r_chk still reads 2 Blue!)
    // Step 4: p_blue pulls 2 with resourceFilter='blue' -> extracts the 2 Blue beneath Red, leaving Red:1!
    const run = runMxSimulation(doc, {
      steps: 4,
      seed: 1,
      interactionsByStep: { 1: ['sb'], 2: ['sr'], 3: ['d_lifo'], 4: ['p_blue'] }
    })
    expect(run.snapshots[3]!.bag).toBe(3)
    expect(run.snapshots[3]!.r_chk).toBe(2)
    expect(run.snapshots[4]!.p_blue).toBe(2)
    expect(run.snapshots[4]!.bag).toBe(1)
    expect(run.snapshots[4]!.r_chk).toBe(0)
    expect(run.finalPoolTokens?.bag).toEqual([{ resId: 'red', count: 1 }])

    // Trader atomic color-preserving swap
    const trDoc = createEmptyMxDocument('trader-swap')
    trDoc.resources = doc.resources
    trDoc.nodes = [
      { ...createMxNode('pool', 0, -40, 'SellerBlue'), id: 'in_a', initial: 2, resourceId: 'blue' },
      { ...createMxNode('pool', 0, 40, 'BuyerRed'), id: 'in_b', initial: 3, resourceId: 'red' },
      { ...createMxNode('trader', 100, 0, 'Market'), id: 'tr', trigger: 'automatic' },
      { ...createMxNode('pool', 200, -40, 'SellerGot'), id: 'out_a', initial: 0 },
      { ...createMxNode('pool', 200, 40, 'BuyerGot'), id: 'out_b', initial: 0 }
    ]
    trDoc.edges = [
      { id: 'ta1', kind: 'resource', from: 'in_a', to: 'tr', formula: '2' },
      { id: 'tb1', kind: 'resource', from: 'in_b', to: 'tr', formula: '3' },
      { id: 'ta2', kind: 'resource', from: 'tr', to: 'out_a', formula: '1' },
      { id: 'tb2', kind: 'resource', from: 'tr', to: 'out_b', formula: '1' }
    ]
    const trRun = runMxSimulation(trDoc, { steps: 1, seed: 1 })
    // Channel 0 input (2 Blue) swaps to Channel 1 output (out_b = 2 Blue); Channel 1 input (3 Red) swaps to out_a (3 Red)!
    expect(trRun.snapshots[1]!.out_a).toBe(3)
    expect(trRun.snapshots[1]!.out_b).toBe(2)
    expect(trRun.finalPoolTokens?.out_a).toEqual([{ resId: 'red', count: 3 }])
    expect(trRun.finalPoolTokens?.out_b).toEqual([{ resId: 'blue', count: 2 }])
  })

  it('supports Conditional Gates (<4, >=4, 0-match destroy, overlap duplicate) and Trigger Gates with cycle-without-replacement urn', () => {
    // 1. Deterministic Conditional Gate: cumulative pass count (1, 2, 3 -> <4; 4, 5 -> >=4)
    const cgDoc = createEmptyMxDocument('cond-gate')
    cgDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 's', trigger: 'automatic' },
      { ...createMxNode('gate', 100, 0, 'CondGate'), id: 'g', gateMode: 'deterministic' },
      { ...createMxNode('pool', 220, -40, 'Low'), id: 'p_low', initial: 0 },
      { ...createMxNode('pool', 220, 40, 'High'), id: 'p_high', initial: 0 }
    ]
    cgDoc.edges = [
      { id: 'e_in', kind: 'resource', from: 's', to: 'g', formula: '1' },
      { id: 'e_lo', kind: 'resource', from: 'g', to: 'p_low', formula: '<4' },
      { id: 'e_hi', kind: 'resource', from: 'g', to: 'p_high', formula: '>=4' }
    ]
    const cgRun = runMxSimulation(cgDoc, { steps: 5, seed: 1 })
    expect(cgRun.snapshots[5]!.p_low).toBe(3)
    expect(cgRun.snapshots[5]!.p_high).toBe(2)

    // 2. Random Trigger Gate with weights [2, 3]: cycle-without-replacement guarantees exact 2+3 per 5 steps!
    const tgDoc = createEmptyMxDocument('trigger-gate-urn')
    tgDoc.nodes = [
      {
        ...createMxNode('gate', 0, 0, 'TrigGate'),
        id: 'tg',
        trigger: 'automatic',
        gateMode: 'random'
      },
      { ...createMxNode('source', 120, -40, 'S2'), id: 's_a', trigger: 'passive' },
      { ...createMxNode('source', 120, 40, 'S3'), id: 's_b', trigger: 'passive' },
      { ...createMxNode('pool', 240, -40, 'PA'), id: 'pa', initial: 0 },
      { ...createMxNode('pool', 240, 40, 'PB'), id: 'pb', initial: 0 }
    ]
    tgDoc.edges = [
      { id: 'st_a', kind: 'state', from: 'tg', to: 's_a', formula: '2' },
      { id: 'st_b', kind: 'state', from: 'tg', to: 's_b', formula: '3' },
      { id: 'r_a', kind: 'resource', from: 's_a', to: 'pa', formula: '1' },
      { id: 'r_b', kind: 'resource', from: 's_b', to: 'pb', formula: '1' }
    ]
    const tgRun = runMxSimulation(tgDoc, { steps: 10, seed: 42 })
    // After 1 cycle (step 5): exact 2 + 3; after 2 cycles (step 10): exact 4 + 6!
    expect(tgRun.snapshots[5]!.pa).toBe(2)
    expect(tgRun.snapshots[5]!.pb).toBe(3)
    expect(tgRun.snapshots[10]!.pa).toBe(4)
    expect(tgRun.snapshots[10]!.pb).toBe(6)
  })

  it('supports Source push_all blocking, Passive push-only Pool auto-push, Enabling rising-edge, Drain ! Reverse Trigger, and End ANY/ALL modes', () => {
    // 1. Source `push_all` blocks ALL outputs if ANY output Pool lacks capacity
    const paDoc = createEmptyMxDocument('source-push-all')
    paDoc.nodes = [
      {
        ...createMxNode('source', 0, 0, 'Src'),
        id: 's',
        trigger: 'automatic',
        pullMode: 'push_all'
      },
      { ...createMxNode('pool', 120, -40, 'SmallCap'), id: 'p_small', initial: 0, capacity: 1 },
      { ...createMxNode('pool', 120, 40, 'BigCap'), id: 'p_big', initial: 0, capacity: 100 }
    ]
    paDoc.edges = [
      { id: 'e1', kind: 'resource', from: 's', to: 'p_small', formula: '1' },
      { id: 'e2', kind: 'resource', from: 's', to: 'p_big', formula: '1' }
    ]
    const paRun = runMxSimulation(paDoc, { steps: 3, seed: 1 })
    // Step 1 succeeds (both -> 1); Steps 2 & 3 blocked on BOTH because p_small is full!
    expect(paRun.snapshots[3]!.p_small).toBe(1)
    expect(paRun.snapshots[3]!.p_big).toBe(1)

    // 2. Enabling trigger fires on Step 1 when active, stays quiet on Step 2, and re-fires on rising edge when re-enabled!
    const enDoc = createEmptyMxDocument('enabling-rising-edge')
    enDoc.nodes = [
      { ...createMxNode('register', 0, 0, 'Wave'), id: 'r_wave', formula: 'STEP != 2 ? 1 : 0' },
      { ...createMxNode('source', 120, 0, 'Banner'), id: 's_en', trigger: 'enabling' },
      { ...createMxNode('pool', 240, 0, 'Spawns'), id: 'p_sp', initial: 0 }
    ]
    enDoc.edges = [
      { id: 'st_en', kind: 'state', from: 'r_wave', to: 's_en', formula: '>=1' },
      { id: 'r_en', kind: 'resource', from: 's_en', to: 'p_sp', formula: '1' }
    ]
    const enRun = runMxSimulation(enDoc, { steps: 4, seed: 1 })
    // Step 1: active -> fires (1); Step 2: disabled (1); Step 3: rising edge 0->1 -> fires again (2); Step 4: stays active -> doesn't fire (2)!
    expect(enRun.snapshots[1]!.p_sp).toBe(1)
    expect(enRun.snapshots[2]!.p_sp).toBe(1)
    expect(enRun.snapshots[3]!.p_sp).toBe(2)
    expect(enRun.snapshots[4]!.p_sp).toBe(2)

    // 3. Drain `!` Reverse Trigger directly terminating an End node + End `endMode: 'any'` vs `'all'`
    const bangDoc = createEmptyMxDocument('drain-bang-end')
    bangDoc.nodes = [
      { ...createMxNode('pool', 0, 0, 'Ammo'), id: 'ammo', initial: 2 },
      {
        ...createMxNode('drain', 100, 0, 'Upkeep'),
        id: 'upkeep',
        trigger: 'automatic',
        pullMode: 'pull_all'
      },
      { ...createMxNode('end', 200, 0, 'StarvedEnd'), id: 'end_1', formula: '' }
    ]
    bangDoc.edges = [
      { id: 'e_up', kind: 'resource', from: 'ammo', to: 'upkeep', formula: '2' },
      { id: 'st_bang', kind: 'state', from: 'upkeep', to: 'end_1', formula: '!' }
    ]
    const bangRun = runMxSimulation(bangDoc, { steps: 5, seed: 1 })
    // Step 1 pulls 2 (ok); Step 2 ammo=0 < 2 -> upkeep fails -> `!` fires -> StarvedEnd ends run at step 2!
    expect(bangRun.ended).toBe(true)
    expect(bangRun.stepsRun).toBe(2)

    const endOrDoc = createEmptyMxDocument('end-any-vs-all')
    endOrDoc.nodes = [
      { ...createMxNode('source', 0, -30, 'Fast'), id: 'sf', trigger: 'automatic' },
      { ...createMxNode('pool', 90, -30, 'PFast'), id: 'pf', initial: 0 },
      { ...createMxNode('pool', 90, 30, 'PSlow'), id: 'ps', initial: 0 },
      { ...createMxNode('end', 200, 0, 'Victory'), id: 'end_v', formula: '', endMode: 'any' }
    ]
    endOrDoc.edges = [
      { id: 'ef', kind: 'resource', from: 'sf', to: 'pf', formula: '2' },
      { id: 'st1', kind: 'state', from: 'pf', to: 'end_v', formula: '>=4' },
      { id: 'st2', kind: 'state', from: 'ps', to: 'end_v', formula: '>=10' }
    ]
    expect(runMxSimulation(endOrDoc, { steps: 5, seed: 1 }).ended).toBe(true)
    endOrDoc.nodes.find((n) => n.id === 'end_v')!.endMode = 'all'
    expect(runMxSimulation(endOrDoc, { steps: 5, seed: 1 }).ended).toBe(false)
  })

  it('supports full Math.js functions, 26 a..z & custom edge.label Register vars, Custom Variables (STEP, 0-based 1D/2D arrays), and Mermaid/Godot/Unity exporters', () => {
    const rng = (): number => 0.5
    expect(evaluateMxExpression('largerEq(a, 2) * (b + 4)', { vars: { a: 2, b: 3 }, rng })).toBe(7)
    expect(evaluateMxExpression('and(1, 0) + or(0, 1) * 10 + xor(1, 1)', { vars: {}, rng })).toBe(
      10
    )
    expect(evaluateMxExpression('mod(-1, 3)', { vars: {}, rng })).toBe(2)
    expect(evaluateMxExpression('square(4) + cube(2) + cbrt(27)', { vars: {}, rng })).toBe(27)
    expect(evaluateMxExpression('hypot(3, 4) + log2(8) + log10(100)', { vars: {}, rng })).toBe(10)
    expect(evaluateMxExpression('randomInt(4, 4) + norm(10, 0)', { vars: {}, rng })).toBe(14)
    expect(evaluateMxExpression('!0 ? (5..5) : 0', { vars: {}, rng })).toBe(5)

    // Custom Variables (0-based 1D & 2D Arrays + STEP + named Register State Edge label)
    const doc = createEmptyMxDocument('vars-arrays-exporters')
    doc.params = [
      { id: 'p_arr', name: 'tierTable', value: 0, varKind: 'array', formula: '[10, 25, 60, 100]' },
      { id: 'p_mat', name: 'grid', value: 0, varKind: 'array', formula: '[[1, 2], [3, 4]]' }
    ]
    doc.nodes = [
      { ...createMxNode('pool', 0, 0, 'HeroLv'), id: 'lv', initial: 2 },
      {
        ...createMxNode('register', 140, 0, 'DmgFormula'),
        id: 'reg_dmg',
        formula: 'tierTable[hero_lv] + grid[1, 0] + STEP'
      },
      { ...createMxNode('source', 0, 90, 'LootSrc'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 140, 90, 'Gold'), id: 'gold', initial: 0 },
      { ...createMxNode('end', 260, 90, 'Goal'), id: 'goal', formula: '', endMode: 'any' }
    ]
    doc.edges = [
      {
        id: 'st_named',
        kind: 'state',
        from: 'lv',
        to: 'reg_dmg',
        label: 'hero_lv',
        formula: '+1'
      },
      {
        id: 'r_loot',
        kind: 'resource',
        from: 'src',
        to: 'gold',
        formula: '250%',
        interval: '2',
        minLimit: 1,
        maxLimit: 5
      },
      { id: 'st_goal', kind: 'state', from: 'gold', to: 'goal', formula: '>=10' }
    ]
    const run = runMxSimulation(doc, { steps: 2, seed: 1 })
    // tierTable[2] = 60 (0-based!), grid[1, 0] = 3, STEP = 2 -> 65!
    expect(run.snapshots[2]!.reg_dmg).toBe(65)

    // Exporters (Mermaid, Godot GDScript, Unity C#) compile cleanly with all new constructs
    const mmd = exportMxToMermaid(doc)
    expect(mmd).toContain('hero_lv')
    expect(mmd).toContain('250%|2')

    const gd = exportMxGodotGd(doc)
    expect(gd).toContain('class_name GameEconomySimulator')
    expect(gd).toContain('+ float(step)')
    expect(gd).toContain('minf(5, maxf(1,')

    const cs = exportMxUnityCs(doc)
    expect(cs).toContain('public class EconomyManager : MonoBehaviour')
    expect(cs).toContain('(float)Step')
    expect(cs).toContain('Mathf.Min(5f, (float)(Mathf.Max(1f,')
  })

  it('supports Allow decimals=false truncation, Transfer flow vs instant propagation, and Influencer tuning', () => {
    // 1) Allow decimals: default (true) vs false (whole integers only)
    const decDoc = createEmptyMxDocument()
    decDoc.nodes = [
      { ...createMxNode('source', 40, 40, 'Src'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 160, 40, 'DecPool'), id: 'p_dec', initial: 0 },
      { ...createMxNode('pool', 160, 120, 'IntPool'), id: 'p_int', initial: 0 }
    ]
    decDoc.edges = [
      {
        id: 'e_dec',
        kind: 'resource',
        from: 'src',
        to: 'p_dec',
        formula: '10 / 3',
        allowDecimals: true
      },
      {
        id: 'e_int',
        kind: 'resource',
        from: 'src',
        to: 'p_int',
        formula: '10 / 3',
        allowDecimals: false,
        influencer: true
      }
    ]
    const decRun = runMxSimulation(decDoc, { steps: 1, seed: 1 })
    expect(decRun.snapshots[1]!.p_dec).toBeCloseTo(3.333, 2)
    expect(decRun.snapshots[1]!.p_int).toBe(3)

    const gd = exportMxGodotGd(decDoc)
    expect(gd).toContain('floor(')
    const cs = exportMxUnityCs(decDoc)
    expect(cs).toContain('Mathf.Floor(')

    // 2) Transfer: 'flow' (next-step state activation) vs 'instant' (same-step zero-delay activation, regardless of node order)
    for (const reverseOrder of [false, true]) {
      const makeTransferDoc = (transferMode: 'flow' | 'instant') => {
        const d = createEmptyMxDocument()
        const src = {
          ...createMxNode('source', 40, 40, 'Src'),
          id: 'src',
          trigger: 'automatic' as const
        }
        const bonus = {
          ...createMxNode('source', 260, 40, 'Bonus'),
          id: 'bonus',
          trigger: 'automatic' as const
        }
        const pool = { ...createMxNode('pool', 140, 40, 'Gold'), id: 'gold', initial: 0 }
        const out = { ...createMxNode('pool', 380, 40, 'Reward'), id: 'reward', initial: 0 }
        d.nodes = reverseOrder ? [bonus, src, pool, out] : [src, bonus, pool, out]
        d.edges = [
          { id: 'e_in', kind: 'resource', from: 'src', to: 'gold', formula: '5', transferMode },
          { id: 'st_act', kind: 'state', from: 'gold', to: 'bonus', formula: '>=5' },
          { id: 'e_bonus', kind: 'resource', from: 'bonus', to: 'reward', formula: '10' }
        ]
        return d
      }

      const flowRun = runMxSimulation(makeTransferDoc('flow'), { steps: 2, seed: 1 })
      expect(flowRun.snapshots[1]!.reward).toBe(0)
      expect(flowRun.snapshots[2]!.reward).toBe(10)

      const instantRun = runMxSimulation(makeTransferDoc('instant'), { steps: 2, seed: 1 })
      expect(instantRun.snapshots[1]!.reward).toBe(10)
      expect(instantRun.snapshots[2]!.reward).toBe(20)
    }

    // 3) Influencer persistence & tunable formula formatting
    const norm = normalizeMxDocument(JSON.parse(JSON.stringify(decDoc)))
    expect(norm.edges.find((e) => e.id === 'e_int')?.influencer).toBe(true)
    expect(norm.edges.find((e) => e.id === 'e_int')?.allowDecimals).toBe(false)

    expect(
      extractMxTunableEdgeNumericValue({
        id: 'c',
        kind: 'resource',
        from: 'a',
        to: 'b',
        formula: '35%'
      })
    ).toBe(35)
    expect(
      formatMxTunableEdgeFormula(
        { id: 'c', kind: 'resource', from: 'a', to: 'b', formula: '35%' },
        60
      )
    ).toBe('60%')
    expect(
      formatMxTunableEdgeFormula({ id: 's', kind: 'state', from: 'a', to: 'b', formula: '>=5' }, 12)
    ).toBe('>=12')
    expect(
      formatMxTunableEdgeFormula({ id: 'i', kind: 'state', from: 'a', to: 'b', formula: '+2i' }, 4)
    ).toBe('+4i')
    expect(
      formatMxTunableEdgeFormula(
        { id: 'n', kind: 'resource', from: 'a', to: 'b', formula: '10|3' },
        15
      )
    ).toBe('15|3')
    expect(
      formatMxTunableEdgeFormula(
        { id: 'ni', kind: 'resource', from: 'a', to: 'b', formula: '10', allowDecimals: false },
        7.8
      )
    ).toBe('8')
  })

  it('enforces Pool overflow=block on Converters & push_all Pools, Skill Gates, multi-wave triggerOn, and exporter Register limits', () => {
    // 1) Converter blocked by full downstream Pool (overflow: 'block') must NOT waste input resources
    const makeCraftDoc = (overflow: 'block' | 'drain') => {
      const d = createEmptyMxDocument()
      d.nodes = [
        { ...createMxNode('pool', 40, 40, 'Wood'), id: 'wood', initial: 10 },
        { ...createMxNode('converter', 160, 40, 'Craft'), id: 'craft', trigger: 'automatic' },
        {
          ...createMxNode('pool', 280, 40, 'Shield'),
          id: 'shield',
          initial: 4,
          capacity: 5,
          overflow
        }
      ]
      d.edges = [
        { id: 'e_in', kind: 'resource', from: 'wood', to: 'craft', formula: '3' },
        { id: 'e_out', kind: 'resource', from: 'craft', to: 'shield', formula: '2' }
      ]
      return d
    }
    const blockedCraft = runMxSimulation(makeCraftDoc('block'), { steps: 1, seed: 1 })
    expect(blockedCraft.snapshots[1]!.wood).toBe(10)
    expect(blockedCraft.snapshots[1]!.shield).toBe(4)

    const drainedCraft = runMxSimulation(makeCraftDoc('drain'), { steps: 1, seed: 1 })
    expect(drainedCraft.snapshots[1]!.wood).toBe(7)
    expect(drainedCraft.snapshots[1]!.shield).toBe(5)
    expect(drainedCraft.totalConsumed).toBe(1)

    // 2) Pool push_all blocked if any output Pool (overflow: 'block') lacks room
    const pushAllDoc = createEmptyMxDocument()
    pushAllDoc.nodes = [
      {
        ...createMxNode('pool', 40, 40, 'Origin'),
        id: 'orig',
        initial: 10,
        trigger: 'automatic',
        pullMode: 'push_all'
      },
      {
        ...createMxNode('pool', 180, 20, 'FullDst'),
        id: 'full',
        initial: 5,
        capacity: 5,
        overflow: 'block'
      },
      {
        ...createMxNode('pool', 180, 80, 'OpenDst'),
        id: 'open',
        initial: 0,
        capacity: 10,
        overflow: 'block'
      }
    ]
    pushAllDoc.edges = [
      { id: 'p1', kind: 'resource', from: 'orig', to: 'full', formula: '2' },
      { id: 'p2', kind: 'resource', from: 'orig', to: 'open', formula: '2' }
    ]
    const pushAllRun = runMxSimulation(pushAllDoc, { steps: 1, seed: 1 })
    expect(pushAllRun.snapshots[1]!.orig).toBe(10)
    expect(pushAllRun.snapshots[1]!.open).toBe(0)

    // 3) Skill Gate responds to player skill modifier significantly vs low skill
    const makeSkillGateDoc = (skillVal: number) => {
      const d = createEmptyMxDocument()
      d.params = [{ id: 'p_sk', name: 'skill', value: skillVal }]
      d.nodes = [
        { ...createMxNode('source', 40, 40, 'Try'), id: 'try', trigger: 'automatic' },
        { ...createMxNode('gate', 150, 40, 'SkillCheck'), id: 'g_sk', gateMode: 'skill' },
        { ...createMxNode('pool', 280, 20, 'Crit'), id: 'crit', initial: 0 },
        { ...createMxNode('pool', 280, 80, 'Miss'), id: 'miss', initial: 0 }
      ]
      d.edges = [
        { id: 'e_t', kind: 'resource', from: 'try', to: 'g_sk', formula: '1' },
        { id: 'e_hi', kind: 'resource', from: 'g_sk', to: 'crit', formula: '>=5' },
        { id: 'e_lo', kind: 'resource', from: 'g_sk', to: 'miss', formula: '<5' }
      ]
      return d
    }
    const lowSkill = runMxSimulation(makeSkillGateDoc(-2), { steps: 40, seed: 7 })
    const highSkill = runMxSimulation(makeSkillGateDoc(2.5), { steps: 40, seed: 7 })
    expect(highSkill.snapshots[40]!.crit).toBeGreaterThan(lowSkill.snapshots[40]!.crit + 15)

    // 4) Multi-wave Pool triggerOn='decrease' fires `*` even when drained in wave 1 via `*` trigger
    const waveDecDoc = createEmptyMxDocument()
    waveDecDoc.nodes = [
      { ...createMxNode('source', 40, 20, 'Pulse'), id: 'pulse', trigger: 'automatic' },
      { ...createMxNode('pool', 140, 20, 'Dummy'), id: 'dummy', initial: 0 },
      {
        ...createMxNode('pool', 40, 100, 'HP'),
        id: 'hp',
        initial: 10,
        trigger: 'passive',
        triggerOn: 'decrease'
      },
      { ...createMxNode('drain', 160, 100, 'Hit'), id: 'hit', trigger: 'passive' },
      { ...createMxNode('source', 280, 100, 'Rage'), id: 'rage', trigger: 'passive' },
      { ...createMxNode('pool', 390, 100, 'RagePool'), id: 'rage_pool', initial: 0 }
    ]
    waveDecDoc.edges = [
      { id: 'e_p', kind: 'resource', from: 'pulse', to: 'dummy', formula: '1' },
      { id: 'st_hit', kind: 'state', from: 'pulse', to: 'hit', formula: '*' },
      { id: 'e_dmg', kind: 'resource', from: 'hp', to: 'hit', formula: '2' },
      { id: 'st_rage', kind: 'state', from: 'hp', to: 'rage', formula: '*' },
      { id: 'e_rg', kind: 'resource', from: 'rage', to: 'rage_pool', formula: '5' }
    ]
    const waveDecRun = runMxSimulation(waveDecDoc, { steps: 1, seed: 1 })
    expect(waveDecRun.snapshots[1]!.hp).toBe(8)
    expect(waveDecRun.snapshots[1]!.rage_pool).toBe(5)

    // 5) Exporters include standalone edge.interval and Register min/max limits
    const expDoc = createEmptyMxDocument()
    expDoc.nodes = [
      { ...createMxNode('source', 40, 40, 'Src'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 160, 40, 'Gold'), id: 'gold', initial: 0 },
      {
        ...createMxNode('register', 280, 40, 'ClampReg'),
        id: 'reg_c',
        formula: 'Gold * 2',
        min: 5,
        max: 50
      }
    ]
    expDoc.edges = [
      { id: 'e_iv', kind: 'resource', from: 'src', to: 'gold', formula: '10', interval: '3' }
    ]
    const gdCode = exportMxGodotGd(expDoc)
    expect(gdCode).toContain('step % 3 == 0')
    expect(gdCode).toContain('minf(50, maxf(5,')
    const csCode = exportMxUnityCs(expDoc)
    expect(csCode).toContain('Step % 3 == 0')
    expect(csCode).toContain('Mathf.Min(50f, (float)(Mathf.Max(5f,')
  })

  it('covers deep audit edge cases across State Connections, Resource Connections, and Resource Parameters', () => {
    // 0) Formula validation parity: <> operator, Gate conditions with |interval, and parameterized +Var / +Var% / +Vari state modifiers
    expect(validateMxFormula('<>0', 'state').valid).toBe(true)
    expect(validateMxFormula('>=4|2', 'resource').valid).toBe(true)
    expect(validateMxFormula('+BonusRate', 'state').valid).toBe(true)
    expect(validateMxFormula('-PenaltyPct%', 'state').valid).toBe(true)
    expect(validateMxFormula('+Hastei', 'state').valid).toBe(true)

    // 1) State Connections: Math.js boolean activator (largerEq), <> activator, +Param modifier, dynamic fx Formula modifier, and custom edge.label on Resource Edge & End Node
    const stDoc = createEmptyMxDocument('state-deep-audit')
    stDoc.params = [{ id: 'p_br', name: 'BonusRate', value: 2 }]
    stDoc.nodes = [
      { ...createMxNode('pool', 0, 0, 'Power'), id: 'pwr', initial: 6 },
      { ...createMxNode('source', 120, 0, 'Gen'), id: 'gen', trigger: 'automatic' },
      { ...createMxNode('pool', 260, 0, 'Score'), id: 'score', initial: 0 },
      { ...createMxNode('end', 380, 0, 'Win'), id: 'win', formula: 'win_score >= 10' }
    ]
    stDoc.edges = [
      // Base 1 + (+BonusRate=2 * Power=6 -> 12) + fx Formula floor(a / 2)=3 => 16!
      { id: 'r_gen', kind: 'resource', from: 'gen', to: 'score', formula: '1 + pwr_lv' },
      { id: 'st_act_fn', kind: 'state', from: 'pwr', to: 'gen', formula: 'largerEq(a, 5)' },
      { id: 'st_act_neq', kind: 'state', from: 'pwr', to: 'gen', formula: '<>0' },
      {
        id: 'st_var_mod',
        kind: 'state',
        from: 'pwr',
        to: 'gen',
        targetEdgeId: 'r_gen',
        label: 'pwr_lv',
        formula: '+BonusRate'
      },
      {
        id: 'st_fx_mod',
        kind: 'state',
        from: 'pwr',
        to: 'gen',
        targetEdgeId: 'r_gen',
        formula: 'floor(a / 2)'
      },
      { id: 'st_end', kind: 'state', from: 'score', to: 'win', label: 'win_score', formula: '*' }
    ]
    const stRun = runMxSimulation(stDoc, { steps: 3, seed: 1 })
    // Base expr `1 + pwr_lv` = 1 + 6 = 7; +BonusRate*pwr = +12; +floor(6/2) = +3 => 22 on step 1 -> Win triggers!
    expect(stRun.snapshots[1]!.score).toBe(22)
    expect(stRun.ended).toBe(true)
    expect(stRun.stepsRun).toBe(1)

    const stGd = exportMxGodotGd(stDoc)
    expect(stGd).toContain('mx_larger_eq(')
    expect(stGd).toContain('!= 0.0')
    const stCs = exportMxUnityCs(stDoc)
    expect(stCs).toContain('MxLargerEq(')
    expect(stCs).toContain('!= 0f')

    // When Power=4, largerEq(a, 5) is false -> Gen disabled -> Score stays 0
    stDoc.nodes[0]!.initial = 4
    const stBlockedRun = runMxSimulation(stDoc, { steps: 2, seed: 1 })
    expect(stBlockedRun.snapshots[2]!.score).toBe(0)

    // 2) Resource Connections: % Chance failed roll (0) is NOT clamped up to minLimit, while positive roll IS clamped
    const chanceDoc = createEmptyMxDocument('chance-minlimit')
    chanceDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'Src'), id: 'src', trigger: 'automatic' },
      { ...createMxNode('pool', 140, -30, 'ZeroChance'), id: 'p_zero', initial: 0 },
      { ...createMxNode('pool', 140, 30, 'HitChance'), id: 'p_hit', initial: 0 }
    ]
    chanceDoc.edges = [
      { id: 'e_0', kind: 'resource', from: 'src', to: 'p_zero', formula: '0%', minLimit: 3 },
      { id: 'e_100', kind: 'resource', from: 'src', to: 'p_hit', formula: '100%', minLimit: 3 }
    ]
    const chanceRun = runMxSimulation(chanceDoc, { steps: 2, seed: 1 })
    expect(chanceRun.snapshots[2]!.p_zero).toBe(0)
    expect(chanceRun.snapshots[2]!.p_hit).toBe(6)

    // 3) Instant Transfer from Pool updates origin Pool BEFORE mid-step state activator (<=0) checks origin Pool!
    const instOriginDoc = createEmptyMxDocument('instant-origin-deplete')
    instOriginDoc.nodes = [
      { ...createMxNode('source', 0, 80, 'Refill'), id: 'refill', trigger: 'automatic' },
      {
        ...createMxNode('pool', 0, 0, 'Ammo'),
        id: 'ammo',
        initial: 5,
        trigger: 'automatic',
        pullMode: 'push_any'
      },
      { ...createMxNode('drain', 140, 0, 'Fire'), id: 'fire', trigger: 'passive' },
      { ...createMxNode('pool', 140, 80, 'Backup'), id: 'backup', initial: 0 }
    ]
    instOriginDoc.edges = [
      {
        id: 'e_spend',
        kind: 'resource',
        from: 'ammo',
        to: 'fire',
        formula: '5',
        transferMode: 'instant'
      },
      { id: 'st_empty', kind: 'state', from: 'ammo', to: 'refill', formula: '<=0' },
      { id: 'e_bak', kind: 'resource', from: 'refill', to: 'backup', formula: '10' }
    ]
    const instOriginRun = runMxSimulation(instOriginDoc, { steps: 1, seed: 1 })
    // Refill was ordered BEFORE Ammo in doc.nodes (inactive at start of Step 1 because Ammo=5),
    // then Ammo pushed 5 instantly -> Ammo became 0 -> Refill woke up in the SAME step and produced 10!
    expect(instOriginRun.snapshots[1]!.ammo).toBe(0)
    expect(instOriginRun.snapshots[1]!.backup).toBe(10)

    // 4) Gate outgoing branch interval: branch with interval='2' only opens on even steps
    const gateIvDoc = createEmptyMxDocument('gate-interval')
    gateIvDoc.nodes = [
      { ...createMxNode('source', 0, 0, 'S'), id: 's', trigger: 'automatic' },
      { ...createMxNode('gate', 100, 0, 'G'), id: 'g', gateMode: 'deterministic' },
      { ...createMxNode('pool', 220, -30, 'EvenOnly'), id: 'p_even', initial: 0 },
      { ...createMxNode('pool', 220, 30, 'Fallback'), id: 'p_fb', initial: 0 }
    ]
    gateIvDoc.edges = [
      { id: 'e_in', kind: 'resource', from: 's', to: 'g', formula: '1' },
      { id: 'e_ev', kind: 'resource', from: 'g', to: 'p_even', formula: '100%', interval: '2' },
      { id: 'e_fb', kind: 'resource', from: 'g', to: 'p_fb', formula: '0%' }
    ]
    const gateIvRun = runMxSimulation(gateIvDoc, { steps: 3, seed: 1 })
    // Step 1 & Step 3: e_ev closed by interval='2' (dropped); Step 2: e_ev open -> p_even = 1!
    expect(gateIvRun.snapshots[1]!.p_even).toBe(0)
    expect(gateIvRun.snapshots[2]!.p_even).toBe(1)
    expect(gateIvRun.snapshots[3]!.p_even).toBe(1)

    // 5) Resource Parameters: Source color vs edge Resource Filter, colorless token blocking, Any-Resource Converter color pass-through, color-filtered `*` trigger, orphaned filter normalization, and poolTokensHistory
    const resDoc = createEmptyMxDocument('resource-params-audit')
    resDoc.resources = [
      { id: 'blue', name: 'Blue', color: '#2563eb' },
      { id: 'red', name: 'Red', color: '#dc2626' }
    ]
    resDoc.nodes = [
      {
        ...createMxNode('source', 0, -60, 'BlueSrc'),
        id: 'sb',
        trigger: 'automatic',
        resourceId: 'blue'
      },
      { ...createMxNode('source', 0, 0, 'PlainSrc'), id: 'sp', trigger: 'automatic' },
      { ...createMxNode('pool', 140, -60, 'WrongRedDst'), id: 'p_wrong', initial: 0 },
      { ...createMxNode('pool', 140, 0, 'PlainBlockedDst'), id: 'p_plain_blk', initial: 0 },
      { ...createMxNode('converter', 140, 60, 'PassConv'), id: 'conv_any', trigger: 'automatic' },
      { ...createMxNode('pool', 280, 60, 'OutBag'), id: 'bag', initial: 0 },
      { ...createMxNode('source', 280, -60, 'BlueBonus'), id: 's_b_trig', trigger: 'passive' },
      { ...createMxNode('source', 280, 0, 'RedBonus'), id: 's_r_trig', trigger: 'passive' },
      { ...createMxNode('pool', 400, -60, 'BlueTrigCount'), id: 'p_bt', initial: 0 },
      { ...createMxNode('pool', 400, 0, 'RedTrigCount'), id: 'p_rt', initial: 0 }
    ]
    resDoc.edges = [
      // BlueSrc -> Red-filtered edge MUST BE BLOCKED (0), never repainted Red!
      {
        id: 'e_blk_blue',
        kind: 'resource',
        from: 'sb',
        to: 'p_wrong',
        formula: '3',
        resourceFilter: true,
        resourceId: 'red'
      },
      // PlainSrc ('default' colorless) -> Blue-filtered edge MUST BE BLOCKED (0)!
      {
        id: 'e_blk_plain',
        kind: 'resource',
        from: 'sp',
        to: 'p_plain_blk',
        formula: '3',
        resourceFilter: true,
        resourceId: 'blue'
      },
      // BlueSrc -> Any-Resource Converter -> OutBag: preserves 'blue' token color!
      { id: 'e_sb_conv', kind: 'resource', from: 'sb', to: 'conv_any', formula: '2' },
      { id: 'e_conv_bag', kind: 'resource', from: 'conv_any', to: 'bag', formula: '2' },
      // Color-filtered `*` triggers on Converter: Blue fires, Red does NOT fire!
      {
        id: 'st_conv_b',
        kind: 'state',
        from: 'conv_any',
        to: 's_b_trig',
        formula: '*',
        resourceFilter: true,
        resourceId: 'blue'
      },
      {
        id: 'st_conv_r',
        kind: 'state',
        from: 'conv_any',
        to: 's_r_trig',
        formula: '*',
        resourceFilter: true,
        resourceId: 'red'
      },
      { id: 'e_bt', kind: 'resource', from: 's_b_trig', to: 'p_bt', formula: '1' },
      { id: 'e_rt', kind: 'resource', from: 's_r_trig', to: 'p_rt', formula: '1' }
    ]
    const resRun = runMxSimulation(resDoc, { steps: 2, seed: 1 })
    expect(resRun.snapshots[2]!.p_wrong).toBe(0)
    expect(resRun.snapshots[2]!.p_plain_blk).toBe(0)
    expect(resRun.snapshots[2]!.bag).toBe(4)
    expect(resRun.finalPoolTokens?.bag).toEqual([{ resId: 'blue', count: 4 }])
    expect(resRun.poolTokensHistory?.[1]?.bag).toEqual([{ resId: 'blue', count: 2 }])
    expect(resRun.poolTokensHistory?.[2]?.bag).toEqual([{ resId: 'blue', count: 4 }])
    expect(resRun.snapshots[2]!.p_bt).toBe(2)
    expect(resRun.snapshots[2]!.p_rt).toBe(0)

    // Orphaned resourceFilter pointing to a deleted resource is cleaned by normalizeMxDocument
    const rawOrphan = JSON.parse(JSON.stringify(resDoc)) as MxDocument
    rawOrphan.edges.push({
      id: 'e_zombie_filter',
      kind: 'resource',
      from: 'sp',
      to: 'bag',
      formula: '1',
      resourceFilter: true,
      resourceId: 'deleted_res_999'
    })
    const cleaned = normalizeMxDocument(rawOrphan)
    const zombieEdge = cleaned.edges.find((e) => e.id === 'e_zombie_filter')!
    expect(zombieEdge.resourceFilter).toBe(false)
    expect(zombieEdge.resourceId).toBeUndefined()
  })
})
