import { describe, expect, it } from 'vitest'
import {
  analyzeMultiplierPipeline,
  compileMxFormulaToCs,
  compileMxFormulaToGd,
  createMxFromTemplate,
  createMxWorkbenchPreset,
  evaluateMultiplierPipeline,
  exportMxGodotGd,
  exportMxUnityCs,
  inferMxTemplateFromPrompt,
  MX_WORKBENCH_PRESETS,
  runMxCombatKernelSimulation,
  runMxLootAndSubstatSimulation,
  runMxRoguelikeEnvelopeSimulation,
  runMxSimulation
} from '../src/shared/gameAssets'
import {
  applySmartNodePatch,
  createNodeFromType,
  executeGameEconomyNode
} from '../src/shared/graph'

describe('Universal Game Numerical & Roguelike Workbench', () => {
  it('provides 5 flagship genre presets with valid configurations', () => {
    expect(MX_WORKBENCH_PRESETS.map((p) => p.id)).toEqual([
      'slay_the_spire_dbg',
      'hearthstone_tcg',
      'onmyoji_atb',
      'balatro_roguelike',
      'survivor_brotato'
    ])

    for (const meta of MX_WORKBENCH_PRESETS) {
      const wb = createMxWorkbenchPreset(meta.id)
      expect(wb.activePresetId).toBe(meta.id)
      expect(wb.multiplier.attributes.length).toBeGreaterThanOrEqual(4)
      expect(wb.multiplier.entities.length).toBeGreaterThanOrEqual(4)
      expect(wb.roguelikeEnvelope.floors).toBeGreaterThanOrEqual(8)
    }
  })

  it('Layer 1: evaluates multiplier pipelines, marginal ROI per stat, and entity budget audit', () => {
    const stsWb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const baseEval = evaluateMultiplierPipeline(stsWb.multiplier)
    expect(baseEval.finalOutput).toBeGreaterThan(0)

    const report = analyzeMultiplierPipeline(stsWb.multiplier)
    expect(report.finalOutput).toBeCloseTo(baseEval.finalOutput, 1)
    expect(report.marginalReturns.some((m) => m.isOptimalNextPick)).toBe(true)
    expect(report.marginalReturns.length).toBe(stsWb.multiplier.attributes.length)
    expect(report.optimalProgression.length).toBeGreaterThan(5)
    expect(
      report.optimalProgression[report.optimalProgression.length - 1]!.totalOutput
    ).toBeGreaterThan(report.optimalProgression[0]!.totalOutput)
    expect(report.entityAudits.length).toBe(stsWb.multiplier.entities.length)

    // Balatro independent multiplier pipeline check
    const balatroWb = createMxWorkbenchPreset('balatro_roguelike')
    const balatroReport = analyzeMultiplierPipeline(balatroWb.multiplier)
    expect(balatroReport.finalOutput).toBeGreaterThan(10000)
  })

  it('Layer 2: simulates Onmyoji Soul sub-stat rolls, Hearthstone Gacha pity, and Roguelike Tag-Affinity Draft', () => {
    // Hearthstone 40-pack legendary hard pity & dust yield
    const hsWb = createMxWorkbenchPreset('hearthstone_tcg')
    const hsLoot = runMxLootAndSubstatSimulation({ ...hsWb.lootRoll, runs: 120, seed: 2026 })
    expect(hsLoot.mode).toBe('gacha_pity')
    expect(hsLoot.attemptsMean).toBeGreaterThan(10)
    expect(hsLoot.attemptsMean).toBeLessThanOrEqual(80)
    expect(hsLoot.secondaryMetricMean).toBeGreaterThan(0)

    // Onmyoji +16/18 SPD sub-stat roll
    const onmyojiWb = createMxWorkbenchPreset('onmyoji_atb')
    const onmyojiLoot = runMxLootAndSubstatSimulation({
      ...onmyojiWb.lootRoll,
      runs: 150,
      seed: 2026
    })
    expect(onmyojiLoot.mode).toBe('substat_enhance')
    expect(onmyojiLoot.histogram.length).toBeGreaterThan(0)
    expect(onmyojiLoot.costMean).toBeGreaterThan(0)

    // Slay the Spire / Balatro roguelike draft pool with prerequisites & tag affinity
    const stsWb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const stsLoot = runMxLootAndSubstatSimulation({ ...stsWb.lootRoll, runs: 120, seed: 2026 })
    expect(stsLoot.mode).toBe('roguelike_draft')
    expect(stsLoot.successRatePct).toBeGreaterThanOrEqual(0)
    expect(stsLoot.cumulativeCurve.length).toBe(stsWb.lootRoll.draftWaves)
  })

  it('Layer 3A: simulates Slay the Spire Deck-Cycle combat kernel (without-replacement shuffle & energy)', () => {
    const stsWb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const res = runMxCombatKernelSimulation({ ...stsWb.combatKernel, runs: 80, seed: 2026 })
    expect(res.kernel).toBe('deck_cycle')
    expect(res.winRatePct).toBeGreaterThan(0)
    expect(res.ttkP50).toBeGreaterThanOrEqual(res.ttkP10)
    expect(res.ttkP90).toBeGreaterThanOrEqual(res.ttkP50)
    expect(res.kpi2Value).toBeGreaterThan(50) // Energy Utilization %
    expect(res.kpi3Value).toBeGreaterThan(1) // Deck Cycle Turns
  })

  it('Layer 3B: simulates Hearthstone Mana-Tempo combat kernel (1->10 Mana ramp & Mulligan curve)', () => {
    const hsWb = createMxWorkbenchPreset('hearthstone_tcg')
    const res = runMxCombatKernelSimulation({ ...hsWb.combatKernel, runs: 80, seed: 2026 })
    expect(res.kernel).toBe('mana_tempo')
    expect(res.kpi1Value).toBeGreaterThan(0) // Curve-Out Rate %
    expect(res.kpi2Value).toBeGreaterThanOrEqual(0) // Mana Float %
    expect(res.kpi3Value).toBeGreaterThan(0) // Turn 5 Board Stats
    expect(res.ttkP50).toBeGreaterThan(3)
  })

  it('Layer 3C: simulates Onmyoji Action-Bar (ATB 1000 distance + Pull Gauge + Shared 0..8 Orbs)', () => {
    const onmyojiWb = createMxWorkbenchPreset('onmyoji_atb')
    const res = runMxCombatKernelSimulation({ ...onmyojiWb.combatKernel, runs: 40, seed: 2026 })
    expect(res.kernel).toBe('action_bar')
    // Kamaitachi 265 SPD with +30% pull requires 2nd puller >= ceil(265 * 0.7) = 186 SPD
    expect(res.kpi2Value).toBeCloseTo(186, 0)
    expect(res.kpi1Value).toBeGreaterThan(50) // Orb Sufficiency %
    expect(res.actionTimeline?.length).toBeGreaterThan(5)
    expect(res.kpi3Value).toBeGreaterThan(10000) // Cycle Burst DMG
  })

  it('Layer 4: simulates Roguelike Floor 1..N Player Power Envelope vs Enemy Scaling Wall', () => {
    const balatroWb = createMxWorkbenchPreset('balatro_roguelike')
    const env = runMxRoguelikeEnvelopeSimulation({
      ...balatroWb.roguelikeEnvelope,
      runs: 80,
      seed: 2026
    })
    expect(env.floorSeries.length).toBe(balatroWb.roguelikeEnvelope.floors)
    expect(env.floorSeries[0]!.floor).toBe(1)
    expect(env.floorSeries[env.floorSeries.length - 1]!.enemyPower).toBeGreaterThan(
      env.floorSeries[0]!.enemyPower
    )
    expect(env.firstRunClearRatePct).toBeGreaterThanOrEqual(0)
    expect(env.firstRunClearRatePct).toBeLessThanOrEqual(100)
    expect(env.metaRunsTo50PctClear).toBeGreaterThanOrEqual(1)
  })

  it('supports new macro templates (Hearthstone, Onmyoji, Balatro) and prompt inference', () => {
    expect(inferMxTemplateFromPrompt('炉石传说法力曲线与开包尘分解')).toBe('hearthstone_mana_pack') // cjk-ok
    expect(inferMxTemplateFromPrompt('阴阳师拉条速度行动条与鬼火御魂')).toBe('onmyoji_speed_orbs') // cjk-ok
    expect(inferMxTemplateFromPrompt('Balatro 小丑牌倍率与盲注底注')).toBe('balatro_ante_jokers') // cjk-ok

    for (const tplId of [
      'hearthstone_mana_pack',
      'onmyoji_speed_orbs',
      'balatro_ante_jokers'
    ] as const) {
      const doc = createMxFromTemplate(tplId)
      expect(doc.workbench).toBeDefined()
      const sim = runMxSimulation(doc, { steps: 15, seed: 2026 })
      expect(sim.stepsRun).toBeGreaterThan(0)
    }
  })

  it('compiles full Machinations formulas and damage pipelines to Godot 4 GDScript and Unity C#', () => {
    const doc = createMxFromTemplate('onmyoji_speed_orbs')
    const gdFormula = compileMxFormulaToGd('min(8, 2D6 + PullBonus * 2)', doc)
    expect(gdFormula).toContain('min(')
    expect(gdFormula).toContain('roll_dice(2, 6)')

    const csFormula = compileMxFormulaToCs('max(1, pow(BaseChips, 2) + 50%)', doc)
    expect(csFormula).toContain('Mathf.Max(')
    expect(csFormula).toContain('Mathf.Pow(')

    const gdScript = exportMxGodotGd(doc)
    expect(gdScript).toContain('func recompute_registers()')
    expect(gdScript).toContain('func route_gate(')
    expect(gdScript).toContain('func can_convert(')
    expect(gdScript).toContain('func evaluate_damage_pipeline(')

    const csScript = exportMxUnityCs(doc)
    expect(csScript).toContain('public void RecomputeRegisters()')
    expect(csScript).toContain('public void RouteGate(')
    expect(csScript).toContain('public bool CanConvert(')
    expect(csScript).toContain('public float EvaluateDamagePipeline(')
  })

  it('embeds workbenchReport into executeGameEconomyNode output payload', async () => {
    const node = createNodeFromType('game.economy', 0, 0)
    node.params.gameEconomyPreset = 'onmyoji_speed_orbs'
    const out = await executeGameEconomyNode({
      node,
      inputs: {}
    })
    const outText = out['out-text']
    expect(outText?.kind).toBe('text')
    const parsed = JSON.parse(outText && outText.kind === 'text' ? outText.text : '{}')
    expect(parsed.workbenchReport).toBeDefined()
    expect(parsed.workbenchReport.activePresetId).toBe('onmyoji_atb')
    expect(parsed.workbenchReport.combatKernel.kernel).toBe('action_bar')
    expect(parsed.workbenchReport.combatKernel.kpi2Value).toBeCloseTo(186, 0)
  })

  it('supports AI Chat smartPatch preset switching and shorthand dot-path tuning on workbench', () => {
    const node = createNodeFromType('game.economy', 0, 0)
    const patched1 = applySmartNodePatch(node, {
      preset: '小丑牌 Balatro', // cjk-ok
      params: {
        'roguelikeEnvelope.floors': 12,
        'roguelikeEnvelope.enemyGrowthRate': 1.21,
        'multiplier.attributes[0].value': 50
      }
    })
    node.params = patched1.params
    expect(node.params.gameEconomyPreset).toBe('balatro_ante_jokers')
    const doc = JSON.parse(String(node.params.gameEconomyDiagramJson))
    expect(doc.workbench.activePresetId).toBe('balatro_roguelike')
    expect(doc.workbench.roguelikeEnvelope.floors).toBe(12)
    expect(doc.workbench.roguelikeEnvelope.enemyGrowthRate).toBe(1.21)
    expect(doc.workbench.multiplier.attributes[0].value).toBe(50)
  })
})
