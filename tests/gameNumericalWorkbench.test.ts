import { describe, expect, it } from 'vitest'
import {
  analyzeMultiplierPipeline,
  auditGameSystemDocument,
  autoCompleteGameSystemDocument,
  auditNovelChapterContinuityAndPacing,
  buildNovelForeshadowingAndRosterPromptBlock,
  compileMxFormulaToCs,
  compileMxFormulaToGd,
  convertNovelChapterToScreenplayPreview,
  createDefaultNovelCharacterRoster,
  createDefaultNovelForeshadowingPool,
  createMxFromTemplate,
  createMxWorkbenchPreset,
  evaluateMultiplierPipeline,
  exportMxChapterNumericalSlice,
  exportMxEconomyResourceNarrativeSpec,
  exportMxGodotGd,
  exportMxUnityCs,
  extractCustomNarrativeOverridesFromText,
  extractNovelIpContextForGameSystem,
  GAME_SYSTEM_ARCHETYPES,
  generateMxArcChapterOutlinePlan,
  generateMxFullLifecycleArcScheduleMarkdown,
  inferGameSystemArchetypeFromContext,
  inferMxTemplateFromPrompt,
  inferNovelGenreFromText,
  MX_WORKBENCH_PRESETS,
  NOVEL_GENRE_PROFILES,
  resolveNovelGenreProfile,
  runMxCombatKernelSimulation,
  runMxLootAndSubstatSimulation,
  runMxRoguelikeEnvelopeSimulation,
  runMxSimulation,
  synthesizeGameSystemDocOffline,
  unwrapEconomyBundleForGameSystem
} from '../src/shared/gameAssets'
import {
  applyGraphEditOps,
  applySmartNodePatch,
  createNodeFromType,
  executeGameEconomyNode,
  executeGameNumericalNode,
  executeGameSystemGenerateNode,
  executeNovelGenerateNode,
  executeScreenplayGenerateNode,
  executeSelectTextNode,
  getNodePorts,
  narrowOutlineTextForChapter,
  normalizeGraph,
  resolveNodeTextContent,
  resolvePreferredNovelTargetPort,
  runGraph
} from '../src/shared/graph'
import {
  deduplicateNovelParagraphsAgainstPrevious,
  sanitizeNovelChapterGeneratedText
} from '../src/shared/graph/execute/generateText'
import { DEFAULT_NOVEL_SYSTEM_PROMPT_ZH } from '../src/shared/graph/systemPromptSchemes'

describe('Universal Game Numerical & Roguelike Workbench', () => {
  it('provides 6 flagship genre presets with valid configurations', () => {
    expect(MX_WORKBENCH_PRESETS.map((p) => p.id)).toEqual([
      'slay_the_spire_dbg',
      'hearthstone_tcg',
      'onmyoji_atb',
      'balatro_roguelike',
      'survivor_brotato',
      'short_drama_progression'
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

  it('wires game.economy (out-text) -> asset.novel (in -> out) -> asset.screenplay (in -> out) to create a progression-driven novel and adapt it into a screenplay', async () => {
    const econNode = createNodeFromType('game.economy', 0, 0)
    econNode.params.gameEconomyPreset = 'short_drama_reversal_loop'
    const econOut = await executeGameEconomyNode({
      node: econNode,
      inputs: {}
    })
    const economyJsonVal = econOut['out-text']
    expect(economyJsonVal?.kind).toBe('text')

    // Stage 2: Create Novel (asset.novel) driven by the numerical progression brief
    const novelNode = createNodeFromType('asset.novel', 260, 0)
    novelNode.params.generateInstruction = '请根据 @1 的角色成长数值体系创作一部三章逆袭爽文小说' // cjk-ok

    let capturedNovelPrompt = ''
    let capturedNovelSystem = ''
    const novelOut = await executeNovelGenerateNode({
      node: novelNode,
      inputs: {
        in: economyJsonVal ? [economyJsonVal] : []
      },
      generateText: async ({ prompt, system }) => {
        capturedNovelPrompt = prompt
        capturedNovelSystem = system ?? ''
        return {
          text: [
            '小说名：《潜龙出渊：百倍返利震江城》', // cjk-ok
            '',
            '【核心设定与人物档案】', // cjk-ok
            '林玄：24岁，潜龙赘婿，觉醒百倍返利与黑金龙卡系统。', // cjk-ok
            '苏清雪：23岁，高傲势利的苏家千金。', // cjk-ok
            '',
            '第1章：退婚受辱与系统觉醒（Lv.1 -> Lv.21 ★突破）', // cjk-ok
            '订婚宴上苏清雪当众撕毁婚书，林玄受辱蓄能满格激活系统，身价暴涨百倍。', // cjk-ok
            '',
            '第2章：首富下跪接驾·黑卡验资打脸（Lv.21 -> Lv.80 巅峰）', // cjk-ok
            '江城首富赵天豪率众躬身行礼，林玄亮出至尊黑卡完成百亿验资，全场震怖。' // cjk-ok
          ].join('\n')
        }
      }
    })

    expect(capturedNovelSystem).toContain('白金级网文作家') // cjk-ok
    expect(capturedNovelPrompt).toContain('角色成长体系与分集高潮冲突数值大纲') // cjk-ok
    expect(capturedNovelPrompt).toContain('Lv.80')
    expect(capturedNovelPrompt).toContain('亮出至尊黑卡·百亿验资') // cjk-ok
    expect(capturedNovelPrompt).not.toContain('public void RecomputeRegisters()')
    const novelTextVal = novelOut.out
    expect(novelTextVal?.kind).toBe('text')

    // Stage 3: Create Screenplay (asset.screenplay) adapted from the novel output
    const screenplayNode = createNodeFromType('asset.screenplay', 520, 0)
    screenplayNode.params.generateInstruction = '请将上游原著小说 @1 改编为2集标准短剧剧本' // cjk-ok

    let capturedScreenplayPrompt = ''
    const spOut = await executeScreenplayGenerateNode({
      node: screenplayNode,
      inputs: {
        in: novelTextVal ? [novelTextVal] : []
      },
      generateText: async ({ prompt }) => {
        capturedScreenplayPrompt = prompt
        return {
          text: [
            '剧本名：潜龙出渊', // cjk-ok
            '',
            '【人物小传】', // cjk-ok
            '林玄：24岁，男，深色风衣，手握黑金龙卡，隐忍果决。', // cjk-ok
            '',
            '第1集：退婚受辱与系统觉醒', // cjk-ok
            '第1场 【内景 · 江城酒店宴会厅 - 夜】', // cjk-ok
            '△ 苏清雪甩出退婚书，林玄眼底金芒一闪完成突破。', // cjk-ok
            '林玄：三分钟后，你会跪着求我。', // cjk-ok
            '',
            '第2集：首富接驾与黑卡打脸', // cjk-ok
            '第1场 【内景 · 江城酒店宴会厅 - 夜】', // cjk-ok
            '△ 江城首富躬身行礼，林玄亮出至尊黑卡。' // cjk-ok
          ].join('\n')
        }
      }
    })

    expect(capturedScreenplayPrompt).toContain('小说名：《潜龙出渊：百倍返利震江城》') // cjk-ok
    expect(capturedScreenplayPrompt).toContain('第1章：退婚受辱与系统觉醒') // cjk-ok
    expect(spOut.out?.kind).toBe('text')
    expect(spOut['out-all']?.kind).toBe('texts')
    if (spOut['out-all']?.kind === 'texts') {
      expect(spOut['out-all'].items.length).toBe(2)
    }
  })

  it('supports dynamic totalChapters (e.g. 800 -> 1200) and stateful chapter-by-chapter serialization with 4-tier memory', async () => {
    const economyNode = createNodeFromType('game.economy', 0, 0)
    economyNode.params.gameEconomyPreset = 'short_drama_reversal_loop'
    const economyOut = await executeGameEconomyNode({
      node: economyNode,
      inputs: {}
    })
    const economyJsonVal = economyOut['out-text']
    expect(economyJsonVal?.kind).toBe('text')

    const novelNode = createNodeFromType('asset.novel', 260, 0)
    novelNode.params.novelTotalChapters = 800
    novelNode.params.novelCurrentChapter = 1
    novelNode.params.novelTargetWords = 3200
    novelNode.params.novelAutoAdvanceChapter = true

    // Run 1: Generate Chapter 1 / 800 (offline deterministic synthesizer)
    const ch1Out = await executeNovelGenerateNode({
      node: novelNode,
      inputs: {
        in: economyJsonVal ? [economyJsonVal] : []
      }
    })
    expect(ch1Out.out?.kind).toBe('text')
    const ch1Text = ch1Out.out?.kind === 'text' ? ch1Out.out.text : ''
    expect(ch1Text).toContain('第1章：') // cjk-ok
    expect(ch1Text).toContain('第 1/800 章') // cjk-ok
    // Cursor automatically advanced to Chapter 2
    expect(novelNode.params.novelCurrentChapter).toBe(2)
    expect(novelNode.params.novelTotalChapters).toBe(800)
    expect(novelNode.params.novelWorldBible).toBeTruthy()
    expect(novelNode.params.novelStateLedger).toContain('已完成第 1 / 800 章') // cjk-ok
    expect(novelNode.params.novelRollingSummary).toContain('第1章《') // cjk-ok

    // Dynamically change totalChapters from 800 to 1200 before generating Chapter 2!
    novelNode.params.novelTotalChapters = 1200

    // Run 2: Generate Chapter 2 / 1200 (automatically pulls L4 tail anchor from Chapter 1)
    const ch2Out = await executeNovelGenerateNode({
      node: novelNode,
      inputs: {
        in: economyJsonVal ? [economyJsonVal] : []
      }
    })
    const ch2Text = ch2Out.out?.kind === 'text' ? ch2Out.out.text : ''
    expect(ch2Text).toContain('第2章：') // cjk-ok
    expect(ch2Text).toContain('第 2/1200 章') // cjk-ok
    expect(ch2Text).toContain('承接第 1 章末尾余波') // cjk-ok
    expect(novelNode.params.novelCurrentChapter).toBe(3)
    expect(novelNode.params.novelStateLedger).toContain('已完成第 2 / 1200 章') // cjk-ok
    expect(novelNode.params.novelRollingSummary).toContain('第2章《') // cjk-ok
    expect(ch2Out['out-all']?.kind).toBe('texts')
    if (ch2Out['out-all']?.kind === 'texts') {
      expect(ch2Out['out-all'].items.length).toBe(2)
    }

    // Feed Chapter 2 into downstream asset.screenplay
    const spNode = createNodeFromType('asset.screenplay', 520, 0)
    const spOut = await executeScreenplayGenerateNode({
      node: spNode,
      inputs: {
        in: ch2Out.out ? [ch2Out.out] : []
      }
    })
    const spText = spOut.out?.kind === 'text' ? spOut.out.text : ''
    expect(spText).toContain('剧本名：') // cjk-ok
    expect(spText).toContain('第1场') // cjk-ok
    expect(spOut['out-all']?.kind).toBe('texts')
  })

  it('registers novel.workbench Dive multi-chapter workbench and wires GraphNodeCard + ShotNodeInspector', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const diveModel = readFileSync(
      join(process.cwd(), 'src/renderer/src/features/graph/model/editorDive.ts'),
      'utf8'
    )
    expect(diveModel).toContain("'novel.workbench'")

    const hostCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/EditorDiveChildHost.vue'),
      'utf8'
    )
    expect(hostCode).toContain("'novel.workbench'")
    expect(hostCode).toContain('./dive/EditorDiveNovelView.vue')

    const cardCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
      'utf8'
    )
    expect(cardCode).toContain("viewId: 'novel.workbench'")

    const inspectorCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/ShotNodeInspector.vue'),
      'utf8'
    )
    expect(inspectorCode).toContain("'novel.workbench'")

    const novelDiveCode = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/dive/EditorDiveNovelView.vue'),
      'utf8'
    )
    expect(novelDiveCode).toContain(
      'graphEditorHosts.listIncomingEdges(props.hostId, node.value.id)'
    )
    expect(novelDiveCode).toContain('graphEditorHosts.getNode(props.hostId, props.nodeId)')
    expect(novelDiveCode).not.toContain('graphEditorHosts.get(props.hostId)')
  })

  it('generates Arc Multi-Chapter Outline Plans, audits leaked endgame trumps, and overwrites existing chapters in-place on re-run', async () => {
    const wb = createMxWorkbenchPreset('short_drama_progression')
    const arcPlan = generateMxArcChapterOutlinePlan(wb, 1, 800, 3200)
    expect(arcPlan.length).toBeGreaterThanOrEqual(4)
    expect(arcPlan[0]!.chapter).toBe(1)
    expect(arcPlan[0]!.outlinePromptZh).toContain('第 1 / 800 章') // cjk-ok

    const sliceCh1 = exportMxChapterNumericalSlice(wb, 1, 800)
    expect(sliceCh1.lockedEndgameTrumps.length).toBeGreaterThan(0)
    const leakedCard = sliceCh1.lockedEndgameTrumps[0]!

    // Audit a manuscript that accidentally leaks a locked endgame trump card
    const badText = `第1章：退婚风波\n林玄在宴会厅冷笑一声，提前亮出了终局底牌【${leakedCard}】！` // cjk-ok
    const badAudit = auditNovelChapterContinuityAndPacing(badText, sliceCh1, {
      targetWords: 3200
    })
    expect(badAudit.leakedLockedTrumps).toContain(leakedCard)
    expect(badAudit.overallScore).toBeLessThan(85)

    // Verify in-place chapter overwrite when re-running Chapter 1 after Chapter 2 was already generated
    const novelNode = createNodeFromType('asset.novel', 0, 0)
    novelNode.params.novelTotalChapters = 800
    novelNode.params.novelCurrentChapter = 1
    await executeNovelGenerateNode({ node: novelNode, inputs: {} })
    // Now novelCurrentChapter is 2; run Chapter 2
    await executeNovelGenerateNode({ node: novelNode, inputs: {} })
    expect(novelNode.params.generatedTexts?.length).toBe(2)

    // Re-set cursor to Chapter 1 and re-run Chapter 1 -> should overwrite Chapter 1 in-place (still length 2, sorted Ch.1 then Ch.2)
    novelNode.params.novelCurrentChapter = 1
    await executeNovelGenerateNode({ node: novelNode, inputs: {} })
    expect(novelNode.params.generatedTexts?.length).toBe(2)
    expect(novelNode.params.generatedTexts?.[0]?.title).toContain('第1/800章') // cjk-ok
    expect(novelNode.params.generatedTexts?.[1]?.title).toContain('第2/800章') // cjk-ok
    expect(novelNode.params.novelCharacterRosterJson).toBeTruthy()
    expect(novelNode.params.novelForeshadowingJson).toBeTruthy()

    // Verify character roster & foreshadowing prompt block + eliminated character revival detection + screenplay live preview
    const roster = createDefaultNovelCharacterRoster(wb, 800)
    const fsPool = createDefaultNovelForeshadowingPool(wb, 800)
    expect(roster.length).toBeGreaterThanOrEqual(4)
    expect(fsPool.length).toBeGreaterThanOrEqual(3)

    // Mark a villain as eliminated and verify prompt block & QA detection
    roster[2]!.status = 'eliminated'
    const deadVillainName = roster[2]!.name
    const promptBlock = buildNovelForeshadowingAndRosterPromptBlock({
      currentChapter: 5,
      roster,
      foreshadowings: fsPool
    })
    expect(promptBlock).toContain(deadVillainName)
    expect(promptBlock).toContain('已彻底退场/伏诛反派') // cjk-ok

    const revivedAudit = auditNovelChapterContinuityAndPacing(
      `第5章：风云再起\n原本已经伏诛的${deadVillainName}竟然再次大摇大摆走进宴会厅挑衅！`, // cjk-ok
      sliceCh1,
      {
        targetWords: 3200,
        eliminatedCharacterNames: [deadVillainName],
        dueForeshadowingTitles: ['神秘身世信物'] // cjk-ok
      }
    )
    expect(revivedAudit.revivedEliminatedCharacters).toContain(deadVillainName)
    expect(revivedAudit.dueForeshadowingsUnpaid).toContain('神秘身世信物') // cjk-ok

    const spPreview = convertNovelChapterToScreenplayPreview(
      novelNode.params.generatedTexts?.[0]?.text ?? '',
      {
        chapterIndex: 1,
        chapterTitle: '订婚宴受辱', // cjk-ok
        slice: sliceCh1
      }
    )
    expect(spPreview).toContain('第1集') // cjk-ok
    expect(spPreview).toContain('第1场') // cjk-ok
  })

  it('supports multi-genre adaptive novel narrative engine across xianxia, mystery, romance, lovecraft, and custom stage ladders', async () => {
    expect(NOVEL_GENRE_PROFILES.length).toBeGreaterThanOrEqual(8)
    expect(inferNovelGenreFromText('凡人筑基修仙传')).toBe('xianxia_cultivation') // cjk-ok
    expect(inferNovelGenreFromText('暴风雪山庄密室刑侦推理')).toBe('mystery_detective') // cjk-ok
    expect(inferNovelGenreFromText('规则怪谈与理智值san值')).toBe('lovecraft_rules') // cjk-ok

    const wb = createMxWorkbenchPreset('short_drama_progression')

    // 1. Xianxia cultivation genre slice & arc plan
    const xianxia = resolveNovelGenreProfile('xianxia_cultivation')!
    const xianxiaSlice = exportMxChapterNumericalSlice(wb, 1, 600, xianxia)
    expect(xianxiaSlice.realmStageLabelZh).toContain('凡人') // cjk-ok
    const xianxiaMidSlice = exportMxChapterNumericalSlice(wb, 250, 600, xianxia)
    expect(xianxiaMidSlice.realmStageLabelZh).toContain('元婴期') // cjk-ok
    expect(xianxiaSlice.sliceMarkdown).toContain('修为境界') // cjk-ok
    expect(xianxiaSlice.sliceMarkdown).toContain('法宝神通') // cjk-ok
    const xianxiaPlan = generateMxArcChapterOutlinePlan(wb, 1, 600, 3200, xianxia)
    expect(xianxiaPlan.length).toBeGreaterThanOrEqual(3)
    expect(xianxiaPlan[0]?.beatBadgeZh).toBe('潜修蓄势') // cjk-ok

    // 2. Mystery detective genre slice & roster
    const mystery = resolveNovelGenreProfile('mystery_detective')!
    const mysterySlice = exportMxChapterNumericalSlice(wb, 1, 120, mystery)
    expect(mysterySlice.realmStageLabelZh).toContain('案发迷雾期') // cjk-ok
    expect(mysterySlice.sliceMarkdown).toContain('关键证据') // cjk-ok
    const mysteryRoster = createDefaultNovelCharacterRoster(wb, 120, mystery)
    expect(mysteryRoster[0]?.name).toBe('沈默') // cjk-ok

    // 3. Custom literary genre with user-defined stage ladder & axes
    const customGenre = resolveNovelGenreProfile('custom_literary', {
      stagesText: '懵懂少年, 远行求学, 时代洪流, 精神觉醒, 返璞归真', // cjk-ok
      axisProtagonist: '精神独立度', // cjk-ok
      axisAntagonist: '世俗礼教阻力', // cjk-ok
      unlockTerm: '思想信物' // cjk-ok
    })!
    const customSlice = exportMxChapterNumericalSlice(wb, 50, 100, customGenre)
    expect(customSlice.realmStageLabelZh).toContain('时代洪流') // cjk-ok
    expect(customSlice.sliceMarkdown).toContain('精神独立度') // cjk-ok
    expect(customSlice.sliceMarkdown).toContain('思想信物') // cjk-ok

    // 4. Execute asset.novel node with mystery_detective genre
    const econNode = createNodeFromType('game.economy', { x: 0, y: 0 })
    econNode.params.gameEconomyPreset = 'short_drama_reversal_loop'
    const econOut = await executeGameEconomyNode({ node: econNode, inputs: {} })

    const novelNode = createNodeFromType('asset.novel', { x: 320, y: 0 })
    novelNode.params.novelGenre = 'mystery_detective'
    novelNode.params.novelTotalChapters = 120
    novelNode.params.novelCurrentChapter = 1
    novelNode.params.novelTargetWords = 3200
    novelNode.params.generateInstruction = '生成第1章刑侦推理开篇' // cjk-ok

    const out = await executeNovelGenerateNode({
      node: novelNode,
      inputs: {},
      incomingValues: [econOut.out]
    })
    const ch1Text = (out.out as { kind: 'text'; text: string }).text
    expect(ch1Text).toContain('悬疑刑侦') // cjk-ok
    expect(ch1Text).toContain('沈默') // cjk-ok
    expect(ch1Text).toContain('案发迷雾期') // cjk-ok
    expect(novelNode.params.novelWorldBible).toContain('推理铁律') // cjk-ok
    expect(novelNode.params.novelStateLedger).toContain('关键证据') // cjk-ok
  })

  it('closes the loop from game.economy + asset.novel into asset.gameSystem and audits UI split readiness', async () => {
    expect(GAME_SYSTEM_ARCHETYPES.length).toBe(8)
    expect(inferGameSystemArchetypeFromContext({ prompt: '杀戮尖塔DBG卡牌构筑' })).toBe(
      'card_dbg_combat'
    ) // cjk-ok
    expect(inferGameSystemArchetypeFromContext({ novelGenre: 'mystery_detective' })).toBe(
      'avg_mystery_branch'
    )
    expect(inferGameSystemArchetypeFromContext({ novelGenre: 'lovecraft_rules' })).toBe(
      'rule_horror_sanity'
    )

    // 1. Upstream Economy Node -> Unwrap for Game System GDD
    const econNode = createNodeFromType('game.economy', 0, 0)
    econNode.params.gameEconomyPreset = 'short_drama_reversal_loop'
    const econOut = await executeGameEconomyNode({ node: econNode, inputs: {} })
    const econTextVal = econOut['out-text'] as { kind: 'text'; text: string }
    const econUnwrapped = unwrapEconomyBundleForGameSystem(econTextVal.text)
    expect(econUnwrapped).toContain('【上游经济系统（game.economy）➔ 游戏系统策划案') // cjk-ok
    expect(econUnwrapped).toContain('核心乘区结算公式') // cjk-ok
    expect(econUnwrapped).toContain('抽卡/掉宝概率与软硬保底规则') // cjk-ok

    // 2. Upstream Novel Node -> Extract IP Context for Game System GDD
    const novelNode = createNodeFromType('asset.novel', 0, 240)
    novelNode.params.novelGenre = 'xianxia_cultivation'
    novelNode.params.novelTotalChapters = 600
    novelNode.params.novelCurrentChapter = 1
    const novelOut = await executeNovelGenerateNode({
      node: novelNode,
      inputs: { in: [econTextVal] }
    })
    const novelText = (novelOut.out as { kind: 'text'; text: string }).text
    const ipBlock = extractNovelIpContextForGameSystem({
      novelText,
      novelGenreId: novelNode.params.novelGenre,
      worldBible: novelNode.params.novelWorldBible,
      stateLedger: novelNode.params.novelStateLedger,
      characterRosterJson: novelNode.params.novelCharacterRosterJson
    })
    expect(ipBlock).toContain('【上游小说 IP（asset.novel）➔ 游戏系统策划案') // cjk-ok
    expect(ipBlock).toContain('修仙长生') // cjk-ok
    expect(ipBlock).toContain('法宝神通') // cjk-ok

    // 3. Execute asset.gameSystem Node combining Economy + Novel IP
    const gsNode = createNodeFromType('asset.gameSystem', 360, 120)
    gsNode.params.gameSystemArchetype = 'rpg_progression'
    gsNode.params.gameSystemTargetAspect = '16:9'
    const gsOut = await executeGameSystemGenerateNode({
      node: gsNode,
      inputs: { in: [econTextVal, novelOut.out] }
    })
    const gddText = (gsOut.out as { kind: 'text'; text: string }).text
    expect(gddText).toContain('# 系统概述') // cjk-ok
    expect(gddText).toContain('# 功能点设计') // cjk-ok
    expect(gddText).toContain('# UI 布局设计') // cjk-ok
    expect(gddText).toContain('# 数据与配置') // cjk-ok
    expect(gddText).toContain('9-slice')

    // 4. Audit GDD for 6-dimension engineering completeness & downstream ui.split readiness
    const audit = auditGameSystemDocument(gddText)
    expect(audit.overallScore).toBeGreaterThanOrEqual(85)
    expect(audit.uiScreens.length).toBeGreaterThanOrEqual(3)
    expect(audit.uiScreens.every((s) => s.hasWireframe && s.hasPsdSpec)).toBe(true)

    // 5. Verify gameSystem.workbench Dive view registration
    const fs = await import('node:fs')
    const path = await import('node:path')
    const diveModel = fs.readFileSync(
      path.join(process.cwd(), 'src/renderer/src/features/graph/model/editorDive.ts'),
      'utf8'
    )
    const hostCode = fs.readFileSync(
      path.join(process.cwd(), 'src/renderer/src/components/EditorDiveChildHost.vue'),
      'utf8'
    )
    const cardCode = fs.readFileSync(
      path.join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue'),
      'utf8'
    )
    expect(diveModel).toContain("'gameSystem.workbench'")
    expect(hostCode).toContain("'gameSystem.workbench'")
    expect(cardCode).toContain("viewId: 'gameSystem.workbench'")
  })

  it('supports Short-Drama-Style Per-Chapter Chained Novel Workflow (Outline -> Ch.1 -> Ch.2 + text.select chap:N) with saveRunText hydration and L1-L4 memory inheritance', async () => {
    const savedTexts = new Map<string, string>()

    const econNode = createNodeFromType('game.economy', 0, 0)
    econNode.id = 'econ-1'
    econNode.params.gameEconomyPreset = 'short_drama_progression'

    const outlineNode = createNodeFromType('asset.novel', 260, 0)
    outlineNode.id = 'novel-outline'
    outlineNode.title = '《熵债》868章分卷总纲' // cjk-ok
    outlineNode.params.novelGenre = 'scifi_apocalypse'
    outlineNode.params.novelTotalChapters = 868
    outlineNode.params.generateInstruction = '设计《熵债》五卷总纲与第1章、第2章分章细纲' // cjk-ok

    const selectCh2Node = createNodeFromType('text.select', 520, -140)
    selectCh2Node.id = 'select-ch2'
    selectCh2Node.params.selectedTextId = 'chap:2'

    const ch1Node = createNodeFromType('asset.novel', 520, 0)
    ch1Node.id = 'novel-ch1'
    ch1Node.title = '《熵债》第1章：灰区钟摆' // cjk-ok
    ch1Node.params.novelGenre = 'scifi_apocalypse'
    ch1Node.params.novelTotalChapters = 868
    ch1Node.params.novelCurrentChapter = 1
    ch1Node.params.novelAutoAdvanceChapter = false
    ch1Node.params.generateInstruction = '撰写第1章正文：陈默在第七号蜂巢灰区拆解旧怀表' // cjk-ok

    const ch2Node = createNodeFromType('asset.novel', 780, 0)
    ch2Node.id = 'novel-ch2'
    ch2Node.title = '《熵债》续写下一章' // cjk-ok
    ch2Node.params.novelGenre = 'scifi_apocalypse'
    ch2Node.params.novelTotalChapters = 868
    // Leave novelCurrentChapter at default 1 to verify automatic upstream chapter + 1 resolution!
    ch2Node.params.novelCurrentChapter = 1
    ch2Node.params.generateInstruction = '紧接上一章末尾悬念继续撰写下一章正文：清道夫机甲封锁街区' // cjk-ok

    const graph = {
      version: 1 as const,
      nodes: [econNode, outlineNode, selectCh2Node, ch1Node, ch2Node],
      edges: [
        {
          id: 'e1',
          source: 'econ-1',
          sourcePort: 'out-text',
          target: 'novel-outline',
          targetPort: 'in'
        },
        {
          id: 'e2',
          source: 'novel-outline',
          sourcePort: 'out-all',
          target: 'select-ch2',
          targetPort: 'in'
        },
        {
          id: 'e3',
          source: 'novel-outline',
          sourcePort: 'out',
          target: 'novel-ch1',
          targetPort: 'in'
        },
        {
          id: 'e4',
          source: 'novel-ch1',
          sourcePort: 'out',
          target: 'novel-ch2',
          targetPort: 'in'
        }
      ]
    }

    const capturedPrompts: Record<string, string> = {}
    let seq = 0

    const runRes = await runGraph(graph, {
      targetNodeIds: ['select-ch2', 'novel-ch2'],
      saveRunText: async ({ content, node }) => {
        seq += 1
        const rel = `Cache/Texts/${node.id}-${seq}.md`
        savedTexts.set(rel, content)
        return rel
      },
      readRunText: async (relativePath) => savedTexts.get(relativePath) ?? '',
      generateText: async ({ prompt }) => {
        if (prompt.includes('长篇小说世界观圣经与分卷分章总纲任务')) {
          capturedPrompts['novel-outline'] = prompt
          return {
            model: 'mock-llm',
            text: [
              '# 《熵债》世界观圣经与分卷总纲', // cjk-ok
              '【核心法则】任何逆熵行为都会产生等量熵债，由清道夫仲裁庭强制征收。', // cjk-ok
              '',
              '第1章：灰区钟摆', // cjk-ok
              '陈默在地下灰区维修旧时代机械怀表，意外触发逆熵回响。', // cjk-ok
              '',
              '第2章：清缴令降临', // cjk-ok
              '仲裁庭侦测到熵值异常，派出清道夫封锁第七街区，陈默被迫反击。' // cjk-ok
            ].join('\n')
          }
        }
        if (prompt.includes('当前连载章号**: 第 `1` 章 / 动态总章数 `868` 章')) {
          capturedPrompts['novel-ch1'] = prompt
          return {
            model: 'mock-llm',
            text: [
              '# 第1/868章 灰区钟摆', // cjk-ok
              '',
              '酸雨顺着第七号蜂巢的锈蚀排气管滑落，陈默坐在昏暗的工作台前，指尖捏着一枚布满裂纹的青铜齿轮。', // cjk-ok
              '',
              '腕表屏幕上的生存配额只剩最后三小时，窗外突然亮起刺目的猩红探照灯，刺耳的防空警报瞬间撕裂雨夜！' // cjk-ok
            ].join('\n')
          }
        }
        capturedPrompts['novel-ch2'] = prompt
        return {
          model: 'mock-llm',
          text: [
            '# 第2/868章 清缴令降临', // cjk-ok
            '',
            '探照灯的光柱穿透铁窗，清道夫机甲沉重的脚步声在巷口回荡，陈默迅速扣紧怀表底盖。', // cjk-ok
            '',
            '逆熵齿轮骤然逆转三秒，袭来的高能弹幕在半空凝滞，他在火光中撞碎后窗跃入深巷！' // cjk-ok
          ].join('\n')
        }
      }
    })

    // 1. Outline node ran in 'outline' mode without injecting single-chapter 3200-word 4-beat prose lock
    expect(capturedPrompts['novel-outline']).toContain('长篇小说世界观圣经与分卷分章总纲任务') // cjk-ok
    expect(capturedPrompts['novel-outline']).not.toContain('当前连载章号**: 第 `1` 章') // cjk-ok
    expect(outlineNode.params.novelWorldBible).toContain('任何逆熵行为都会产生等量熵债') // cjk-ok

    // 2. text.select node extracted Chapter 2 outline via symbolic selector `chap:2`
    const selectedCh2Out = runRes.states['select-ch2']?.outputs?.out
    expect(selectedCh2Out?.kind).toBe('text')
    if (selectedCh2Out?.kind === 'text') {
      expect(selectedCh2Out.text).toContain('任何逆熵行为都会产生等量熵债') // cjk-ok
      expect(selectedCh2Out.text).toContain('派出清道夫封锁第七街区') // cjk-ok
      expect(selectedCh2Out.text).not.toContain('维修旧时代机械怀表') // cjk-ok
    }

    // 3. Ch.1 node hydrated path-only outline text and ancestor game.economy numerical slice
    expect(capturedPrompts['novel-ch1']).toContain('任何逆熵行为都会产生等量熵债') // cjk-ok
    expect(capturedPrompts['novel-ch1']).toContain(
      '当前连载章号**: 第 `1` 章 / 动态总章数 `868` 章'
    ) // cjk-ok
    expect(capturedPrompts['novel-ch1']).toContain('单章数值围栏与底牌配额锁') // cjk-ok

    // 4. Ch.2 node auto-resolved chapter = 2 from upstream Ch.1 + title, inherited L1/L2/L3/L4 memory and ancestor economy slice for Chapter 2, and merged cumulative chapters into generatedTexts
    expect(capturedPrompts['novel-ch2']).toContain(
      '当前连载章号**: 第 `2` 章 / 动态总章数 `868` 章'
    ) // cjk-ok
    expect(capturedPrompts['novel-ch2']).toContain('任何逆熵行为都会产生等量熵债') // cjk-ok
    expect(capturedPrompts['novel-ch2']).toContain('刺耳的防空警报瞬间撕裂雨夜') // cjk-ok
    expect(ch2Node.params.novelCurrentChapter).toBe(2)
    expect(ch2Node.params.novelWorldBible).toContain('任何逆熵行为都会产生等量熵债') // cjk-ok
    expect(ch2Node.params.generatedTexts?.length).toBe(2)
    expect(ch2Node.params.generatedTexts?.map((item) => item.title)).toEqual([
      '第1/868章：灰区钟摆', // cjk-ok
      '第2/868章：清缴令降临' // cjk-ok
    ])
  })

  it('prevents previous chapter body from leaking as draft when re-running a single asset.novel node with saveRunText', async () => {
    const savedTexts = new Map<string, string>()
    const novelNode = createNodeFromType('asset.novel', 0, 0)
    novelNode.id = 'single-novel'
    novelNode.params.novelGenre = 'scifi_apocalypse'
    novelNode.params.novelTotalChapters = 100
    novelNode.params.novelCurrentChapter = 1
    novelNode.params.novelAutoAdvanceChapter = true
    novelNode.params.generateInstruction = '撰写第1章正文' // cjk-ok

    let capturedCh2Prompt = ''
    let seq = 0

    // Run 1: Chapter 1 with saveRunText (sets generatedTexts[0].text = '' and relativePath = 'Cache/Texts/...')
    await executeNovelGenerateNode({
      node: novelNode,
      inputs: {},
      saveRunText: async ({ content, node }) => {
        seq += 1
        const rel = `Cache/Texts/${node.id}-${seq}.md`
        savedTexts.set(rel, content)
        return rel
      },
      readRunText: async (rel) => savedTexts.get(rel) ?? '',
      generateText: async () => ({
        model: 'mock-llm',
        text: '# 第1/100章 灰区钟摆\n\n第一段：陈默在雨夜修理怀表。\n\n尾段：窗外警报骤响。' // cjk-ok
      })
    })

    expect(novelNode.params.novelCurrentChapter).toBe(2)
    expect(novelNode.params.generatedTexts?.[0]?.text).toBe('')
    expect(novelNode.params.generatedTexts?.[0]?.relativePath).toBeTruthy()
    // When saveRunText is provided, node.params.text is offloaded to disk and previewRelativePath is set
    expect(novelNode.params.text).toBe('')
    expect(novelNode.params.previewRelativePath).toBeTruthy()

    // Run 2: Chapter 2 on the same node
    novelNode.params.generateInstruction = '撰写第2章正文' // cjk-ok
    await executeNovelGenerateNode({
      node: novelNode,
      inputs: {},
      saveRunText: async ({ content, node }) => {
        seq += 1
        const rel = `Cache/Texts/${node.id}-${seq}.md`
        savedTexts.set(rel, content)
        return rel
      },
      readRunText: async (rel) => savedTexts.get(rel) ?? '',
      generateText: async ({ prompt }) => {
        capturedCh2Prompt = prompt
        return {
          model: 'mock-llm',
          text: '# 第2/100章 极夜突围\n\n陈默翻窗跃入暗巷。' // cjk-ok
        }
      }
    })

    // Chapter 1's full body must NOT be injected as `当前已有小说底稿`! Only L4 tail anchor is allowed.
    expect(capturedCh2Prompt).not.toContain('当前已有小说底稿（请在此基础上续写、润色或扩写）') // cjk-ok
    expect(capturedCh2Prompt).toContain('当前连载章号**: 第 `2` 章 / 动态总章数 `100` 章') // cjk-ok
    expect(novelNode.params.generatedTexts?.length).toBe(2)
  })

  it('executes 3-Way Conditioned Markov-Chain pipeline (novel.outline + game.economy + Ch.1 -> Ch.2 -> Ch.3) with O(1) context slicing', async () => {
    const savedTexts = new Map<string, string>()

    const econNode = createNodeFromType('game.economy', 0, 0)
    econNode.id = 'econ-1'
    econNode.title = '熵债数值系统' // cjk-ok
    econNode.params.gameEconomyPreset = 'short_drama_progression'

    const outlineNode = createNodeFromType('novel.outline', 300, 0)
    outlineNode.id = 'outline-1'
    outlineNode.title = '《熵债》总纲与分章细纲' // cjk-ok
    outlineNode.params.novelGenre = 'scifi_apocalypse'
    outlineNode.params.novelTotalChapters = 868

    const ch1Node = createNodeFromType('asset.novel', 600, 0)
    ch1Node.id = 'ch-1'
    ch1Node.title = '第1章：灰区钟摆' // cjk-ok
    ch1Node.params.novelCurrentChapter = 1
    ch1Node.params.novelAutoAdvanceChapter = false

    const ch2Node = createNodeFromType('asset.novel', 900, 0)
    ch2Node.id = 'ch-2'
    ch2Node.title = '第2章：极夜猎杀' // cjk-ok
    ch2Node.params.novelCurrentChapter = 2
    ch2Node.params.novelAutoAdvanceChapter = false

    const ch3Node = createNodeFromType('asset.novel', 1200, 0)
    ch3Node.id = 'ch-3'
    ch3Node.title = '第3章：黑塔觉醒' // cjk-ok
    ch3Node.params.novelCurrentChapter = 3
    ch3Node.params.novelAutoAdvanceChapter = false

    // 3-Way Markov-Chain edges into every chapter node:
    // (1) game.economy -> novel.outline & every chapter node
    // (2) novel.outline -> every chapter node
    // (3) C_{t-1} -> C_t sequential Markov transition
    const doc = {
      version: 1 as const,
      nodes: [econNode, outlineNode, ch1Node, ch2Node, ch3Node],
      edges: [
        {
          id: 'e-econ-out',
          source: 'econ-1',
          target: 'outline-1',
          sourcePort: 'out-text',
          targetPort: 'in'
        },
        {
          id: 'e-out-c1',
          source: 'outline-1',
          target: 'ch-1',
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e-econ-c1',
          source: 'econ-1',
          target: 'ch-1',
          sourcePort: 'out-text',
          targetPort: 'in'
        },
        { id: 'e-c1-c2', source: 'ch-1', target: 'ch-2', sourcePort: 'out', targetPort: 'in' },
        {
          id: 'e-out-c2',
          source: 'outline-1',
          target: 'ch-2',
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e-econ-c2',
          source: 'econ-1',
          target: 'ch-2',
          sourcePort: 'out-text',
          targetPort: 'in'
        },
        { id: 'e-c2-c3', source: 'ch-2', target: 'ch-3', sourcePort: 'out', targetPort: 'in' },
        {
          id: 'e-out-c3',
          source: 'outline-1',
          target: 'ch-3',
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e-econ-c3',
          source: 'econ-1',
          target: 'ch-3',
          sourcePort: 'out-text',
          targetPort: 'in'
        }
      ]
    }

    const capturedPrompts: Record<string, string> = {}
    let seq = 0

    const runRes = await runGraph(doc, {
      targetNodeIds: ['ch-3'],
      saveRunText: async ({ content, node }) => {
        seq += 1
        const rel = `Cache/Texts/${node.id}-${seq}.md`
        savedTexts.set(rel, content)
        return rel
      },
      readRunText: async (rel) => savedTexts.get(rel) ?? '',
      generateText: async ({ prompt }) => {
        if (prompt.includes('长篇小说世界观圣经与分卷分章总纲任务')) {
          capturedPrompts['outline-1'] = prompt
          return {
            model: 'mock-llm',
            text: [
              '小说名：《熵债》',
              '',
              '【核心设定与人物档案】',
              '- 恒定世界观：冰封废土下人类靠时之沙维持体温与算力。',
              '- 陈默（核心主角）：灰区钟表匠，执掌逆熵怀表。',
              '',
              '第1章：灰区钟摆',
              '- 细纲：陈默在废土钟表铺遭遇收债人围堵，首次激活逆熵怀表。',
              '',
              '第2章：极夜猎杀',
              '- 细纲：陈默潜入地下黑市拍卖场，夺取时之沙核心并击退机械猎犬。',
              '',
              '第3章：黑塔觉醒',
              '- 细纲：陈默引爆黑塔底层反应炉，当众震慑灰区执政官。'
            ].join('\n') // cjk-ok
          }
        }
        if (prompt.includes('当前连载章号**: 第 `1` 章')) {
          capturedPrompts['ch-1'] = prompt
          return {
            model: 'mock-llm',
            text: [
              '# 第1/868章 灰区钟摆',
              '',
              '第一段（第1章独有正文段落）：冰冷的酸雨敲打着灰区第13号钟表铺的铅玻璃。',
              '',
              '第二段（第1章独有中段博弈）：收债人撞开铁门，枪口抵住陈默眉心。',
              '',
              '第三段：陈默平静地吹去工作台上的铁屑，指尖悄然扣住暗格里的铜壳。',
              '',
              '第四段：收债人冷笑一声扣动扳机，火药在潮湿空气中炸开刺目火星。',
              '',
              '第五段：铅弹停滞在陈默眉心前半寸，周围雨滴尽数悬停。',
              '',
              '尾段（第1章末尾锚点）：陈默指尖捏碎铜壳，逆熵怀表的蓝光瞬间吞没了整条暗巷！'
            ].join('\n') // cjk-ok
          }
        }
        if (prompt.includes('当前连载章号**: 第 `2` 章')) {
          capturedPrompts['ch-2'] = prompt
          return {
            model: 'mock-llm',
            text: [
              '# 第2/868章 极夜猎杀',
              '',
              '第一段（第2章独有正文段落）：蓝光散尽后，陈默踏过结霜的铁门残骸潜入地下黑市。',
              '',
              '第二段：黑市穹顶悬挂着生锈的铁笼，拍卖师正高举盛满时之沙的水晶瓶。',
              '',
              '第三段：三头机械猎犬嗅到逆熵波纹，嘶吼着扑向二楼暗廊。',
              '',
              '第四段：陈默反手甩出两枚齿轮刀片，精准切断机械猎犬的液压颈管。',
              '',
              '第五段：水晶瓶应声坠落，被陈默凌空抄入怀中。',
              '',
              '尾段（第2章末尾锚点）：黑塔底层的警报骤然拉响，执政官的装甲列车已封锁出口！'
            ].join('\n') // cjk-ok
          }
        }
        capturedPrompts['ch-3'] = prompt
        return {
          model: 'mock-llm',
          text: [
            '# 第3/868章 黑塔觉醒',
            '',
            '第一段：面对呼啸而来的装甲列车，陈默将时之沙核心按入黑塔反应炉。',
            '',
            '尾段：整座灰区穹顶轰然亮起金色矩阵，黑塔正式易主！'
          ].join('\n') // cjk-ok
        }
      }
    })

    // 1. Verify Chapter 2 prompt received 3-way Markov inputs with O(1) slicing:
    const p2 = capturedPrompts['ch-2'] ?? ''
    // (a) Outline slice for Ch.2 is present, Ch.3 transition preview is present, Ch.1 outline body is excluded
    expect(p2).toContain('来自小说大纲节点的第 2 章专属细纲切片') // cjk-ok
    expect(p2).toContain('陈默潜入地下黑市拍卖场，夺取时之沙核心并击退机械猎犬') // cjk-ok
    expect(p2).toContain('下一章（第 3 章）衔接方向预告') // cjk-ok
    expect(p2).not.toContain('陈默在废土钟表铺遭遇收债人围堵，首次激活逆熵怀表') // cjk-ok
    // (b) Economy slice for Ch.2 is present
    expect(p2).toContain('第 2 / 868 章 · 单章数值围栏与底牌配额锁') // cjk-ok
    // (c) Markov state from Ch.1 (L2 State Ledger + L4 Tail Anchor) is present, while Ch.1's early paragraphs are stripped
    expect(p2).toContain('L4 · 上一章（第 1 章）末尾原文无缝承接锚点') // cjk-ok
    expect(p2).toContain('逆熵怀表的蓝光瞬间吞没了整条暗巷') // cjk-ok
    expect(p2).not.toContain(
      '第一段（第1章独有正文段落）：冰冷的酸雨敲打着灰区第13号钟表铺的铅玻璃'
    ) // cjk-ok

    // 2. Verify Chapter 3 prompt received Ch.3 outline slice + Ch.3 economy lock + Ch.2 Markov state (and stripped Ch.2 early prose):
    const p3 = capturedPrompts['ch-3'] ?? ''
    expect(p3).toContain('来自小说大纲节点的第 3 章专属细纲切片') // cjk-ok
    expect(p3).toContain('陈默引爆黑塔底层反应炉，当众震慑灰区执政官') // cjk-ok
    expect(p3).toContain('第 3 / 868 章 · 单章数值围栏与底牌配额锁') // cjk-ok
    expect(p3).toContain('L4 · 上一章（第 2 章）末尾原文无缝承接锚点') // cjk-ok
    expect(p3).toContain('执政官的装甲列车已封锁出口') // cjk-ok
    expect(p3).not.toContain('第一段（第2章独有正文段落）：蓝光散尽后') // cjk-ok

    // 3. Verify cumulative chapter gallery & out-all port on each node (Ch.1 -> [1], Ch.2 -> [1,2], Ch.3 -> [1,2,3])
    expect(ch1Node.params.generatedTexts?.map((item) => item.title)).toEqual([
      '第1/868章：灰区钟摆' // cjk-ok
    ])
    expect(ch2Node.params.generatedTexts?.map((item) => item.title)).toEqual([
      '第1/868章：灰区钟摆', // cjk-ok
      '第2/868章：极夜猎杀' // cjk-ok
    ])
    expect(ch3Node.params.generatedTexts?.length).toBe(3)
    expect(ch3Node.params.generatedTexts?.map((item) => item.title)).toEqual([
      '第1/868章：灰区钟摆', // cjk-ok
      '第2/868章：极夜猎杀', // cjk-ok
      '第3/868章：黑塔觉醒' // cjk-ok
    ])
    const ch3Out = runRes.states['ch-3']?.outputs?.out
    const ch3OutAll = runRes.states['ch-3']?.outputs?.['out-all']
    expect(ch3Out?.kind).toBe('text')
    if (ch3Out?.kind === 'text') {
      expect(ch3Out.title).toBe('第3/868章：黑塔觉醒') // cjk-ok
    }
    expect(ch3OutAll?.kind).toBe('texts')
    if (ch3OutAll?.kind === 'texts') {
      expect(ch3OutAll.items.map((item) => item.title)).toEqual([
        '第1/868章：灰区钟摆', // cjk-ok
        '第2/868章：极夜猎杀', // cjk-ok
        '第3/868章：黑塔觉醒' // cjk-ok
      ])
    }
    // 4. Verify semantic multi-beat summary ([破局] -> [钩子]) and L3.5 Skip-Connection recall
    expect(ch2Node.params.novelRollingSummary).toContain('[破局]')
    expect(ch2Node.params.novelRollingSummary).toContain('[钩子]')
    expect(p3).toContain('L3.5 · 跨章伏笔与远期关键章节靶向闪回') // cjk-ok
  })

  it('supports Two-Tier Hierarchical Outline Slicing (Volume/Range fallback) and Semantic Character/Foreshadowing Evolution', async () => {
    const outlineNode = createNodeFromType('novel.outline', { x: 80, y: 100 })
    outlineNode.id = 'outline-hier'
    outlineNode.params.novelGenre = 'scifi_apocalypse'
    outlineNode.params.novelTotalChapters = 120
    outlineNode.params.text = [
      '小说名：《熵债》',
      '【核心设定与人物档案】',
      '- 陈默（核心主角）：灰区钟表匠，执掌逆熵怀表。',
      '- 莫里斯（首卷宿敌）：灰区收债统领，掌控机械猎犬军团。',
      '',
      '【全书分卷与长线大纲】',
      '- 第一卷（第1~30章）：灰区觉醒与黑塔突围（主角在灰区底层打破算力垄断，正面击溃收债统领莫里斯）',
      '- 第二卷（第31~120章）：轨道天梯与母体清算（冲出地表进入近地轨道空间站）',
      '',
      '第1章：灰区钟摆',
      '- 细纲：陈默在钟表铺首次激活逆熵怀表。',
      '',
      '第2章：黑市截胡',
      '- 细纲：陈默夺取时之沙核心。'
    ].join('\n') // cjk-ok

    // Chapter 1 -> Chapter 25 (testing both villain elimination in Ch.1 and Volume Range fallback in Ch.25)
    const ch1Node = createNodeFromType('asset.novel', { x: 400, y: 100 })
    ch1Node.id = 'ch-1'
    ch1Node.title = '第1章' // cjk-ok

    const ch25Node = createNodeFromType('asset.novel', { x: 720, y: 100 })
    ch25Node.id = 'ch-25'
    ch25Node.title = '第25章' // cjk-ok
    ch25Node.params.generateInstruction = '请精写第25章正文，并呼应第1章逆熵怀表的觉醒伏笔。' // cjk-ok

    const doc = {
      version: 2 as const,
      nodes: [outlineNode, ch1Node, ch25Node],
      edges: [
        {
          id: 'e-o-1',
          source: 'outline-hier',
          sourcePort: 'out',
          target: 'ch-1',
          targetPort: 'in'
        },
        {
          id: 'e-o-25',
          source: 'outline-hier',
          sourcePort: 'out',
          target: 'ch-25',
          targetPort: 'in'
        },
        { id: 'e-1-25', source: 'ch-1', sourcePort: 'out', target: 'ch-25', targetPort: 'in' }
      ]
    }

    let capturedCh25Prompt = ''
    await runGraph(doc, {
      targetNodeIds: ['ch-25'],
      generateText: async ({ prompt }) => {
        if (prompt.includes('长篇小说世界观圣经与分卷分章总纲任务')) {
          return { model: 'mock-llm', text: outlineNode.params.text ?? '' }
        }
        if (prompt.includes('当前连载章号**: 第 `1` 章')) {
          return {
            model: 'mock-llm',
            text: [
              '# 第1/120章 灰区钟摆',
              '',
              '第一段：酸雨倾盆而下，莫里斯率领机械猎犬将钟表铺团团围住。',
              '',
              '第二段：陈默激活逆熵怀表，时间乱流瞬间席卷全场，莫里斯在逆熵冲击下当场毙命伏诛，彻底覆灭！',
              '',
              '尾段：怀表内侧浮现出一行通往黑塔顶层的神秘坐标。'
            ].join('\n') // cjk-ok
          }
        }
        capturedCh25Prompt = prompt
        return {
          model: 'mock-llm',
          text: '# 第25/120章 黑塔决战\n\n第一段：陈默踏入黑塔核心。' // cjk-ok
        }
      }
    })

    // 1. Verify Tier-2 Volume/Range Outline Slicing + 4-Step Micro-Beat Rotation for Ch.25:
    expect(capturedCh25Prompt).toContain('来自小说大纲节点的第 25 章所属分卷/区间细纲切片') // cjk-ok
    expect(capturedCh25Prompt).toContain('第一卷（第1~30章）：灰区觉醒与黑塔突围') // cjk-ok
    expect(capturedCh25Prompt).toContain('区间高潮破局期（位于第 1~30 章区间的 83% 进度') // cjk-ok
    expect(capturedCh25Prompt).toContain('四章微循环节拍【1/4 · 切入立规拍】') // cjk-ok
    expect(capturedCh25Prompt).toContain('后续区间远景预告（第 31~120 章') // cjk-ok
    // Individual Ch.1 and Ch.2 outline bodies are excluded from the outline slice
    expect(capturedCh25Prompt).not.toContain('细纲：陈默夺取时之沙核心') // cjk-ok

    // 2. Verify Semantic Character Evolution: '莫里斯' was killed in Ch.1 -> marked as 'eliminated' in Ch.25's Anti-OOC Roster!
    expect(capturedCh25Prompt).toContain(
      '**已彻底退场/伏诛反派（严禁在本章无故复活再次登场挑衅！）**：莫里斯（第1章已退场）' // cjk-ok
    )

    // 3. Verify L3.5 Skip-Connection Recall recalled Ch.1 because Ch.25 instruction referenced '第1章':
    expect(capturedCh25Prompt).toContain('L3.5 · 跨章伏笔与远期关键章节靶向闪回') // cjk-ok
    expect(capturedCh25Prompt).toContain('第 1 章《灰区钟摆》') // cjk-ok
  })

  it('parses and strips NOVEL_STATE_DELTA comments and auto-heals leaked locked trumps and revived dead villains', async () => {
    const econNode = createNodeFromType('game.economy', { x: 80, y: 80 })
    econNode.id = 'econ-guard'
    econNode.params.gameEconomyPreset = 'short_drama_reversal_loop'

    const ch1Node = createNodeFromType('asset.novel', { x: 420, y: 80 })
    ch1Node.id = 'ch-1'
    ch1Node.title = '第1章' // cjk-ok
    ch1Node.params.novelGenre = 'scifi_apocalypse'
    ch1Node.params.novelTotalChapters = 100

    const ch2Node = createNodeFromType('asset.novel', { x: 760, y: 80 })
    ch2Node.id = 'ch-2'
    ch2Node.title = '第2章' // cjk-ok
    ch2Node.params.novelGenre = 'scifi_apocalypse'
    ch2Node.params.novelTotalChapters = 100

    const doc = {
      version: 2 as const,
      nodes: [econNode, ch1Node, ch2Node],
      edges: [
        {
          id: 'e-ec-1',
          source: 'econ-guard',
          sourcePort: 'out-text',
          target: 'ch-1',
          targetPort: 'in'
        },
        {
          id: 'e-ec-2',
          source: 'econ-guard',
          sourcePort: 'out-text',
          target: 'ch-2',
          targetPort: 'in'
        },
        { id: 'e-1-2', source: 'ch-1', sourcePort: 'out', target: 'ch-2', targetPort: 'in' }
      ]
    }

    await runGraph(doc, {
      targetNodeIds: ['ch-2'],
      generateText: async ({ prompt }) => {
        if (prompt.includes('当前连载章号**: 第 `1` 章')) {
          return {
            model: 'mock-llm',
            // Ch.1 introduces new ally '白夜' and marks villain '莫里斯' as eliminated via NOVEL_STATE_DELTA (even without standard regex death keywords in prose!)
            text: [
              '# 第1/100章 灰区暗影',
              '',
              '第一段：陈默在黑塔底层遇见了首席机械师白夜，两人联手关闭了通风阀。',
              '',
              '尾段：莫里斯坠入万丈冷却井再无声息，井底浮现出一块刻满古星图的青铜残片。',
              '<!-- NOVEL_STATE_DELTA: {"summary":"陈默联手新盟友白夜解决莫里斯并发现青铜残片","characters":[{"name":"白夜","faction":"ally","status":"subdued","role":"黑塔首席机械师","note":"第1章与陈默结盟"},{"name":"莫里斯","faction":"villain","status":"eliminated","role":"灰区统领","note":"坠入冷却井身亡"}],"newForeshadowing":{"title":"冷却井青铜残片古星图","payoffSpan":12,"hint":"指向轨道空间站核心密钥"}} -->'
            ].join('\n') // cjk-ok
          }
        }
        // Ch.2 intentionally hallucinates locked endgame trump '聚变反应堆核心' and revives dead villain '莫里斯'
        return {
          model: 'mock-llm',
          text: [
            '# 第2/100章 禁区反击',
            '',
            '第一段：莫里斯竟然再次率众拦路，陈默当场掏出聚变反应堆核心轰碎路障！',
            '',
            '尾段：远方天际传来低沉的轨道轰鸣。'
          ].join('\n') // cjk-ok
        }
      }
    })

    // 1. Verify NOVEL_STATE_DELTA comment was stripped from Ch.1 prose
    expect(ch1Node.params.text).not.toContain('NOVEL_STATE_DELTA')
    expect(ch1Node.params.novelRollingSummary).toContain(
      '[核心推进] 陈默联手新盟友白夜解决莫里斯并发现青铜残片'
    ) // cjk-ok

    // 2. Verify new character '白夜' and new foreshadowing '冷却井青铜残片古星图' were added to Markov state
    expect(ch1Node.params.novelCharacterRosterJson).toContain('白夜') // cjk-ok
    expect(ch1Node.params.novelForeshadowingJson).toContain('冷却井青铜残片古星图') // cjk-ok

    // 3. Verify Ch.2 Closed-Loop Guardrail Sanitizer auto-healed leaked locked trump ('聚变反应堆核心' -> '改装电磁步枪') and revived villain ('莫里斯' -> '莫里斯旧部残党')
    expect(ch2Node.params.text).not.toContain('聚变反应堆核心') // cjk-ok
    expect(ch2Node.params.text).toContain('改装电磁步枪') // cjk-ok
    expect(ch2Node.params.text).toContain('莫里斯旧部残党') // cjk-ok
    expect(ch2Node.params.novelStateLedger).toContain('🛡️ 数值围栏自愈记录') // cjk-ok
    expect(ch2Node.params.novelStateLedger).toContain('🛡️ 角色生死防穿帮自愈') // cjk-ok
  })

  it('auto-routes novel.outline to in-outline, game.economy to in-economy, and previous chapter to in', () => {
    const outlineNode = createNodeFromType('novel.outline', { x: 80, y: 40 })
    outlineNode.id = 'outline-1'
    outlineNode.title = '小说大纲' // cjk-ok

    const legacyOutlineAssetNode = createNodeFromType('asset.novel', { x: 80, y: 180 })
    legacyOutlineAssetNode.id = 'legacy-outline-1'
    legacyOutlineAssetNode.title = '小说大纲' // cjk-ok
    legacyOutlineAssetNode.params.novelNodeMode = 'outline'

    const econNode = createNodeFromType('game.economy', { x: 80, y: 320 })
    econNode.id = 'econ-1'

    const ch2Node = createNodeFromType('asset.novel', { x: 380, y: 180 })
    ch2Node.id = 'ch-2'
    ch2Node.title = '小说 · 第2章' // cjk-ok
    ch2Node.params.novelNodeMode = 'chapter'
    ch2Node.params.novelCurrentChapter = 2

    const ch3Node = createNodeFromType('asset.novel', { x: 700, y: 180 })
    ch3Node.id = 'ch-3'
    ch3Node.title = '小说 · 第3章' // cjk-ok
    ch3Node.params.novelNodeMode = 'chapter'
    ch3Node.params.novelCurrentChapter = 3

    const gsNode = createNodeFromType('asset.gameSystem', { x: 1020, y: 180 })
    gsNode.id = 'gs-1'

    expect(resolvePreferredNovelTargetPort(outlineNode, ch3Node, 'in')).toBe('in-outline')
    expect(resolvePreferredNovelTargetPort(legacyOutlineAssetNode, ch3Node, 'in')).toBe(
      'in-outline'
    )
    expect(resolvePreferredNovelTargetPort(econNode, ch3Node, 'in')).toBe('in-economy')
    expect(resolvePreferredNovelTargetPort(ch2Node, ch3Node, 'in')).toBe('in')
    expect(resolvePreferredNovelTargetPort(econNode, gsNode, 'in')).toBe('in-economy')
    expect(resolvePreferredNovelTargetPort(ch3Node, gsNode, 'in')).toBe('in')

    const normalized = normalizeGraph({
      nodes: [outlineNode, econNode, ch2Node, ch3Node, gsNode],
      edges: [
        { id: 'e-out-3', source: 'outline-1', sourcePort: 'out', target: 'ch-3', targetPort: 'in' },
        {
          id: 'e-eco-3',
          source: 'econ-1',
          sourcePort: 'out-text',
          target: 'ch-3',
          targetPort: 'in'
        },
        { id: 'e-2-3', source: 'ch-2', sourcePort: 'out', target: 'ch-3', targetPort: 'in' },
        {
          id: 'e-eco-gs',
          source: 'econ-1',
          sourcePort: 'out-text',
          target: 'gs-1',
          targetPort: 'in'
        },
        { id: 'e-3-gs', source: 'ch-3', sourcePort: 'out-all', target: 'gs-1', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    })

    expect(normalized.edges.find((e) => e.id === 'e-out-3')?.targetPort).toBe('in-outline')
    expect(normalized.edges.find((e) => e.id === 'e-eco-3')?.targetPort).toBe('in-economy')
    expect(normalized.edges.find((e) => e.id === 'e-2-3')?.targetPort).toBe('in')
    expect(normalized.edges.find((e) => e.id === 'e-eco-gs')?.targetPort).toBe('in-economy')
    expect(normalized.edges.find((e) => e.id === 'e-3-gs')?.targetPort).toBe('in')
  })

  it('fuses in-economy and out-all cumulative chapters + structured metadata in executeGameSystemGenerateNode', async () => {
    const econNode = createNodeFromType('game.economy', { x: 80, y: 80 })
    econNode.id = 'econ-1'
    econNode.params.gameEconomyPreset = 'short_drama_reversal_loop'
    const econOut = await executeGameEconomyNode({ node: econNode, inputs: {} })
    const econTextVal = econOut['out-text']!

    const ch3Node = createNodeFromType('asset.novel', { x: 400, y: 80 })
    ch3Node.id = 'ch-3'
    ch3Node.title = '小说 · 第3章' // cjk-ok
    ch3Node.params.novelGenre = 'xianxia_cultivation'
    ch3Node.params.novelTotalChapters = 600
    ch3Node.params.novelCurrentChapter = 3
    ch3Node.params.novelWorldBible = '九天玄界恒定法则：唯持太古剑印者可破天门。' // cjk-ok
    ch3Node.params.novelStateLedger = '当前境界：筑基圆满，已解锁底牌：青莲剑阵。' // cjk-ok

    const ch3OutAll = {
      kind: 'texts' as const,
      items: [
        { id: 'c1', title: '第1/600章：寒门剑骨', text: '第1章：林玄于寒潭觉醒太古剑印。' }, // cjk-ok
        {
          id: 'c2',
          title: '第2/600章：青莲初绽',
          text: '第2章：林玄在演武场以青莲剑气震退外门执事。'
        }, // cjk-ok
        {
          id: 'c3',
          title: '第3/600章：剑斩天骄',
          text: '第3章：林玄祭出青莲剑阵正面击溃内门首席！'
        } // cjk-ok
      ]
    }

    const gsNode = createNodeFromType('asset.gameSystem', { x: 760, y: 80 })
    gsNode.id = 'gs-1'

    const doc = {
      version: 2 as const,
      nodes: [econNode, ch3Node, gsNode],
      edges: [
        {
          id: 'e-eco-gs',
          source: 'econ-1',
          sourcePort: 'out-text',
          target: 'gs-1',
          targetPort: 'in-economy'
        },
        { id: 'e-c3-gs', source: 'ch-3', sourcePort: 'out-all', target: 'gs-1', targetPort: 'in' }
      ]
    }

    let capturedPrompt = ''
    await executeGameSystemGenerateNode({
      node: gsNode,
      document: doc,
      inputs: {
        'in-economy': [econTextVal],
        in: [ch3OutAll]
      },
      generateText: async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          model: 'mock-llm',
          text: '# 系统概述\n修仙长生GDD\n# 功能点设计\n- 青莲剑阵\n# UI 布局设计\n- 9-slice\n# 数据与配置\n- ATK' // cjk-ok
        }
      }
    })

    // Both in-economy formulas AND cumulative Ch.1..3 + structured World Bible/State Ledger from ch-3 are fused!
    expect(capturedPrompt).toContain('【上游经济系统（game.economy）➔ 游戏系统策划案') // cjk-ok
    expect(capturedPrompt).toContain('核心乘区结算公式') // cjk-ok
    expect(capturedPrompt).toContain('【上游小说 IP（asset.novel）➔ 游戏系统策划案') // cjk-ok
    expect(capturedPrompt).toContain('修仙长生') // cjk-ok
    expect(capturedPrompt).toContain('唯持太古剑印者可破天门') // cjk-ok
    expect(capturedPrompt).toContain('当前境界：筑基圆满，已解锁底牌：青莲剑阵') // cjk-ok
    expect(capturedPrompt).toContain('林玄于寒潭觉醒太古剑印') // cjk-ok
    expect(capturedPrompt).toContain('林玄祭出青莲剑阵正面击溃内门首席') // cjk-ok
  })

  it('executes full real-world 7-node pipeline (game.economy -> novel.outline + Ch.1 -> Ch.2 -> Ch.3 -> asset.gameSystem -> ui.split -> ui.gen) in both full-graph and step-by-step onlyTargetNode modes with disk persistence', async () => {
    const buildPipelineGraph = () => {
      const econ = createNodeFromType('game.economy', { x: 80, y: 200 })
      econ.id = 'node-econ'
      econ.title = '经济系统' // cjk-ok
      econ.params.gameEconomyPreset = 'short_drama_reversal_loop'

      const outline = createNodeFromType('novel.outline', { x: 420, y: 80 })
      outline.id = 'node-outline'
      outline.title = '小说大纲' // cjk-ok
      outline.params.novelGenre = 'xianxia_cultivation'
      outline.params.novelTotalChapters = 800

      const ch1 = createNodeFromType('asset.novel', { x: 820, y: 120 })
      ch1.id = 'node-ch1'
      ch1.title = '小说 · 第1章' // cjk-ok
      ch1.params.novelCurrentChapter = 1
      ch1.params.novelTotalChapters = 800

      const ch2 = createNodeFromType('asset.novel', { x: 820, y: 340 })
      ch2.id = 'node-ch2'
      ch2.title = '小说 · 第2章' // cjk-ok
      ch2.params.novelCurrentChapter = 2
      ch2.params.novelTotalChapters = 800

      const ch3 = createNodeFromType('asset.novel', { x: 820, y: 560 })
      ch3.id = 'node-ch3'
      ch3.title = '小说 · 第3章' // cjk-ok
      ch3.params.novelCurrentChapter = 3
      ch3.params.novelTotalChapters = 800

      const gdd = createNodeFromType('asset.gameSystem', { x: 260, y: 620 })
      gdd.id = 'node-gdd'
      gdd.title = '策划案生成' // cjk-ok

      const uiSplit = createNodeFromType('ui.split', { x: 640, y: 760 })
      uiSplit.id = 'node-ui-split'
      uiSplit.title = 'UI 界面拆分' // cjk-ok

      const uiGen = createNodeFromType('ui.gen', { x: 1020, y: 760 })
      uiGen.id = 'node-ui-gen'
      uiGen.title = 'UI 界面生成' // cjk-ok

      // Verify newly created nodes do NOT leak placeholder '…' as real card preview text
      expect(resolveNodeTextContent(outline)?.text).toBe('')
      expect(resolveNodeTextContent(ch1)?.text).toBe('')
      expect(resolveNodeTextContent(gdd)?.text).toBe('')

      return normalizeGraph({
        version: 2 as const,
        nodes: [econ, outline, ch1, ch2, ch3, gdd, uiSplit, uiGen],
        edges: [
          // 经济系统 -> 小说大纲 & 第1~3章 & 策划案生成
          {
            id: 'e-eco-out',
            source: 'node-econ',
            sourcePort: 'out-text',
            target: 'node-outline',
            targetPort: 'in-economy'
          },
          {
            id: 'e-eco-c1',
            source: 'node-econ',
            sourcePort: 'out-text',
            target: 'node-ch1',
            targetPort: 'in-economy'
          },
          {
            id: 'e-eco-c2',
            source: 'node-econ',
            sourcePort: 'out-text',
            target: 'node-ch2',
            targetPort: 'in-economy'
          },
          {
            id: 'e-eco-c3',
            source: 'node-econ',
            sourcePort: 'out-text',
            target: 'node-ch3',
            targetPort: 'in-economy'
          },
          {
            id: 'e-eco-gdd',
            source: 'node-econ',
            sourcePort: 'out-text',
            target: 'node-gdd',
            targetPort: 'in-economy'
          },
          // 小说大纲 -> 第1~3章
          {
            id: 'e-out-c1',
            source: 'node-outline',
            sourcePort: 'out',
            target: 'node-ch1',
            targetPort: 'in-outline'
          },
          {
            id: 'e-out-c2',
            source: 'node-outline',
            sourcePort: 'out',
            target: 'node-ch2',
            targetPort: 'in-outline'
          },
          {
            id: 'e-out-c3',
            source: 'node-outline',
            sourcePort: 'out',
            target: 'node-ch3',
            targetPort: 'in-outline'
          },
          // 章节链：第1章 -> 第2章 -> 第3章
          {
            id: 'e-c1-c2',
            source: 'node-ch1',
            sourcePort: 'out',
            target: 'node-ch2',
            targetPort: 'in'
          },
          {
            id: 'e-c2-c3',
            source: 'node-ch2',
            sourcePort: 'out',
            target: 'node-ch3',
            targetPort: 'in'
          },
          // 第3章（全部章节汇总 out-all）-> 策划案生成（文本 in）
          {
            id: 'e-c3-gdd',
            source: 'node-ch3',
            sourcePort: 'out-all',
            target: 'node-gdd',
            targetPort: 'in'
          },
          // 策划案生成（文本 out）-> UI 界面拆分（in）-> UI 界面生成（in）
          {
            id: 'e-gdd-split',
            source: 'node-gdd',
            sourcePort: 'out',
            target: 'node-ui-split',
            targetPort: 'in'
          },
          {
            id: 'e-split-gen',
            source: 'node-ui-split',
            sourcePort: 'out',
            target: 'node-ui-gen',
            targetPort: 'in'
          }
        ]
      })
    }

    // ─── Mode A: Full-Graph Wave Execution (runGraph) with Disk Persistence ───
    const diskFilesA = new Map<string, string>()
    const graphA = buildPipelineGraph()
    const fullRunRes = await runGraph(graphA, {
      targetNodeId: 'node-ui-gen',
      saveRunText: async ({ content, key }) => {
        const rel = `Assets/Texts/${key}_${diskFilesA.size + 1}.txt`
        diskFilesA.set(rel, content)
        return rel
      },
      readRunText: async (rel) => diskFilesA.get(rel) ?? '',
      onNodePatch: (nodeId, patch) => {
        const n = graphA.nodes.find((item) => item.id === nodeId)
        if (n && patch.params) {
          n.params = { ...n.params, ...patch.params }
        }
      }
    })

    expect(fullRunRes.ok).toBe(true)
    for (const n of graphA.nodes) {
      expect(fullRunRes.states[n.id]?.status).toBe('done')
    }

    const ch3NodeA = graphA.nodes.find((n) => n.id === 'node-ch3')!
    expect(ch3NodeA.params.generatedTexts?.length).toBe(3)
    expect(ch3NodeA.params.novelGenre).toBe('xianxia_cultivation')

    const gddNodeA = graphA.nodes.find((n) => n.id === 'node-gdd')!
    expect(gddNodeA.params.text).toBe('')
    expect(gddNodeA.params.previewRelativePath).toBeTruthy()
    const gddTextA = diskFilesA.get(gddNodeA.params.previewRelativePath!) ?? ''
    expect(gddTextA).toContain('# 系统概述') // cjk-ok
    expect(gddTextA).toContain('# UI 布局设计') // cjk-ok
    expect(gddTextA).toContain('【上游经济系统（game.economy）➔ 游戏系统策划案') // cjk-ok
    expect(gddTextA).toContain('【上游小说 IP（asset.novel）➔ 游戏系统策划案') // cjk-ok
    expect(auditGameSystemDocument(gddTextA).overallScore).toBeGreaterThanOrEqual(85)

    const splitNodeA = graphA.nodes.find((n) => n.id === 'node-ui-split')!
    const splitScreensA = splitNodeA.params.uiScreens ?? []
    expect(splitScreensA.length).toBeGreaterThanOrEqual(3)
    // Must extract real UI screens under # UI 布局设计, NOT bullet lines from # 系统概述
    expect(splitScreensA.some((s) => s.title.includes('系统名称与品类定位'))).toBe(false) // cjk-ok
    expect(splitScreensA[0]?.cleanPrompt).toBeTruthy()
    expect(splitScreensA[0]?.screenKind).toBeTruthy()
    expect(splitScreensA[0]?.aspectRatio).toBeTruthy()
    expect(splitScreensA[0]?.layerPrompt).toContain('图层') // cjk-ok

    const genNodeA = graphA.nodes.find((n) => n.id === 'node-ui-gen')!
    expect(genNodeA.params.uiScreens?.length).toBe(splitScreensA.length)
    expect(genNodeA.params.uiSelectedLayerPrompt).toContain('图层') // cjk-ok

    // ─── Mode B: Step-by-Step Single-Node Execution (onlyTargetNode: true) ───
    const diskFilesB = new Map<string, string>()
    const graphB = buildPipelineGraph()
    const stepOrder = [
      'node-econ',
      'node-outline',
      'node-ch1',
      'node-ch2',
      'node-ch3',
      'node-gdd',
      'node-ui-split',
      'node-ui-gen'
    ]
    for (const targetNodeId of stepOrder) {
      const stepRes = await runGraph(graphB, {
        targetNodeId,
        onlyTargetNode: true,
        saveRunText: async ({ content, key }) => {
          const rel = `Assets/Texts/${key}_${diskFilesB.size + 1}.txt`
          diskFilesB.set(rel, content)
          return rel
        },
        readRunText: async (rel) => diskFilesB.get(rel) ?? '',
        onNodePatch: (nodeId, patch) => {
          const n = graphB.nodes.find((item) => item.id === nodeId)
          if (n && patch.params) {
            n.params = { ...n.params, ...patch.params }
          }
        }
      })
      expect(stepRes.ok).toBe(true)
      expect(stepRes.states[targetNodeId]?.status).toBe('done')
    }

    const gddNodeB = graphB.nodes.find((n) => n.id === 'node-gdd')!
    // Even without priorNodeStates passed between steps, softSnapshotOutputs + resolveGalleryOutputsFromNodeParams
    // must preserve game.economy's out-text AND hydrate ch3's out-all relativePaths from disk!
    expect(gddNodeB.params.text).toBe('')
    expect(gddNodeB.params.previewRelativePath).toBeTruthy()
    const gddTextB = diskFilesB.get(gddNodeB.params.previewRelativePath!) ?? ''
    expect(gddTextB).toContain('【上游经济系统（game.economy）➔ 游戏系统策划案') // cjk-ok
    expect(gddTextB).toContain('【上游小说 IP（asset.novel）➔ 游戏系统策划案') // cjk-ok
    expect(gddTextB).toContain('第1/800章') // cjk-ok
    expect(gddTextB).toContain('第2/800章') // cjk-ok
    expect(gddTextB).toContain('第3/800章') // cjk-ok

    const splitNodeB = graphB.nodes.find((n) => n.id === 'node-ui-split')!
    expect(splitNodeB.params.uiScreens?.length).toBeGreaterThanOrEqual(3)
    expect(splitNodeB.params.uiScreens?.[0]?.cleanPrompt).toBeTruthy()
    expect(splitNodeB.params.uiScreens?.[0]?.layerPrompt).toContain('图层') // cjk-ok

    const genNodeB = graphB.nodes.find((n) => n.id === 'node-ui-gen')!
    expect(genNodeB.params.uiScreens?.length).toBe(splitNodeB.params.uiScreens?.length)
    expect(genNodeB.params.uiScreens?.[0]?.cleanPrompt).toBeTruthy()
    expect(genNodeB.params.uiSelectedLayerPrompt).toContain('图层') // cjk-ok

    // ─── Mode C: Online LLM Mode on asset.gameSystem (verifies archetype inference & prompt cleanliness) ───
    let gddOnlinePrompt = ''
    const onlineStepRes = await runGraph(graphB, {
      targetNodeId: 'node-gdd',
      onlyTargetNode: true,
      readRunText: async (rel) => diskFilesB.get(rel) ?? '',
      generateText: async ({ prompt }) => {
        gddOnlinePrompt = prompt
        return {
          model: 'mock-online-gdd',
          text: [
            '# 系统概述',
            '- 系统定位：都市神豪突破养成系统。',
            '# 详细规则',
            '- 消耗黑金提升声望等级。',
            '# 数值与公式',
            '$$Cost(L) = 100 \\times 1.18^{L-1}$$',
            '# UI 布局设计',
            '- 角色属性养成主界面：左侧境界突破立绘，右侧四维属性雷达与突破按钮。',
            '- 境界突破与底牌解锁弹窗：中央境界晋升徽章动效，底部底牌解锁卡片。',
            '- 背包与战利品清点弹窗：网格展示战利品图标、稀有度角标与一键分解按钮。',
            '# 跨系统耦合与边界异常防護',
            '- 服务端幂等锁校验。',
            '# 验收标准与埋点指标',
            '- 埋点上报 `gdd_level_up`。'
          ].join('\n') // cjk-ok
        }
      },
      onNodePatch: (nodeId, patch) => {
        const n = graphB.nodes.find((item) => item.id === nodeId)
        if (n && patch.params) {
          n.params = { ...n.params, ...patch.params }
        }
      }
    })
    expect(onlineStepRes.ok).toBe(true)
    expect(gddOnlinePrompt).toContain('rpg_progression')
    expect(gddOnlinePrompt).toContain('必备 UI 界面清单（供下游 ui.split 拆分）') // cjk-ok
    expect(gddOnlinePrompt).toContain('【上游经济系统（game.economy）➔ 游戏系统策划案') // cjk-ok
  })

  it('splits game.economy (Economy System) and game.numerical (Numerical System) into independent nodes and streams through in-economy / in-numerical ports', async () => {
    const econNode = createNodeFromType('game.economy', { x: 0, y: 100 }, { id: 'node-econ' })
    econNode.title = '修仙宗门资源循环' // cjk-ok
    econNode.params.gameEconomyPreset = 'short_drama_reversal_loop'
    econNode.params.gameEconomySteps = 30
    econNode.params.gameEconomyMonteCarloRuns = 20

    const numNode = createNodeFromType('game.numerical', { x: 260, y: 100 }, { id: 'node-num' })
    numNode.title = '九境战力与乘区配表' // cjk-ok
    numNode.params.gameNumericalPreset = 'short_drama_progression'

    const outlineNode = createNodeFromType(
      'novel.outline',
      { x: 520, y: 40 },
      { id: 'node-outline' }
    )
    outlineNode.params.novelGenre = 'xianxia_cultivation'
    outlineNode.params.novelTotalChapters = 600

    const ch1Node = createNodeFromType('asset.novel', { x: 780, y: 40 }, { id: 'node-ch1' })
    ch1Node.params.novelNodeMode = 'chapter'
    ch1Node.params.novelCurrentChapter = 1
    ch1Node.params.novelTotalChapters = 600
    ch1Node.params.novelGenre = 'xianxia_cultivation'

    const gddNode = createNodeFromType('asset.gameSystem', { x: 780, y: 240 }, { id: 'node-gdd' })
    gddNode.params.gameSystemArchetype = 'rpg_progression'

    // Verify port definitions on game.numerical and downstream nodes
    const numPorts = getNodePorts(numNode)
    expect(numPorts.filter((p) => p.direction === 'in').map((p) => p.id)).toEqual([
      'in',
      'in-economy'
    ])
    expect(numPorts.filter((p) => p.direction === 'out').map((p) => p.id)).toEqual([
      'out',
      'out-all',
      'out-text'
    ])

    const outlinePorts = getNodePorts(outlineNode)
    expect(outlinePorts.filter((p) => p.direction === 'in').map((p) => p.id)).toEqual([
      'in',
      'in-economy',
      'in-numerical'
    ])

    const ch1Ports = getNodePorts(ch1Node)
    expect(ch1Ports.filter((p) => p.direction === 'in').map((p) => p.id)).toEqual([
      'in',
      'in-outline',
      'in-economy',
      'in-numerical'
    ])

    const gddPorts = getNodePorts(gddNode)
    expect(gddPorts.filter((p) => p.direction === 'in').map((p) => p.id)).toEqual([
      'in',
      'in-economy',
      'in-numerical'
    ])

    // Verify automatic port routing via normalizeGraph
    const rawGraph: GraphDocument = {
      version: 2,
      nodes: [econNode, numNode, outlineNode, ch1Node, gddNode],
      edges: [
        // game.economy -> game.numerical (should route out-text -> in-economy)
        { id: 'e-econ-num', source: econNode.id, target: numNode.id },
        // game.numerical -> novel.outline (should route out-text -> in-numerical)
        { id: 'e-num-out', source: numNode.id, target: outlineNode.id },
        // novel.outline -> ch1 (should route out -> in-outline)
        { id: 'e-out-ch1', source: outlineNode.id, target: ch1Node.id },
        // game.numerical -> ch1 (should route out-text -> in-numerical)
        { id: 'e-num-ch1', source: numNode.id, target: ch1Node.id },
        // game.economy -> gdd (should route out-text -> in-economy)
        { id: 'e-econ-gdd', source: econNode.id, target: gddNode.id },
        // game.numerical -> gdd (should route out-text -> in-numerical)
        { id: 'e-num-gdd', source: numNode.id, target: gddNode.id },
        // ch1 -> gdd (should route out-all -> in)
        {
          id: 'e-ch1-gdd',
          source: ch1Node.id,
          target: gddNode.id,
          sourcePort: 'out-all',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const graph = normalizeGraph(rawGraph)
    expect(graph.edges.find((e) => e.id === 'e-econ-num')).toMatchObject({
      sourcePort: 'out-text',
      targetPort: 'in-economy'
    })
    expect(graph.edges.find((e) => e.id === 'e-num-out')).toMatchObject({
      sourcePort: 'out-text',
      targetPort: 'in-numerical'
    })
    expect(graph.edges.find((e) => e.id === 'e-num-ch1')).toMatchObject({
      sourcePort: 'out-text',
      targetPort: 'in-numerical'
    })
    expect(graph.edges.find((e) => e.id === 'e-econ-gdd')).toMatchObject({
      sourcePort: 'out-text',
      targetPort: 'in-economy'
    })
    expect(graph.edges.find((e) => e.id === 'e-num-gdd')).toMatchObject({
      sourcePort: 'out-text',
      targetPort: 'in-numerical'
    })

    // Run the full pipeline end-to-end
    const runRes = await runGraph(graph, {
      targetNodeId: 'node-gdd',
      onNodePatch: (nodeId, patch) => {
        const n = graph.nodes.find((item) => item.id === nodeId)
        if (n && patch.params) {
          n.params = { ...n.params, ...patch.params }
        }
      }
    })
    expect(runRes.ok).toBe(true)

    const numAfter = graph.nodes.find((n) => n.id === 'node-num')!
    expect(numAfter.params.gameNumericalReport).toContain('short_drama_progression')
    expect(numAfter.params.text).toContain('"subKind": "numerical_workbench_bundle"')

    const ch1After = graph.nodes.find((n) => n.id === 'node-ch1')!
    expect(ch1After.params.text).toContain('第1章') // cjk-ok

    const gddAfter = graph.nodes.find((n) => n.id === 'node-gdd')!
    expect(gddAfter.params.text).toContain('# 系统概述') // cjk-ok
    expect(gddAfter.params.text).toContain('# UI 布局设计') // cjk-ok
    expect(gddAfter.params.text).toContain('【上游经济系统（game.economy）➔ 游戏系统策划案') // cjk-ok
  })

  it('covers 100% of totalChapters across Outline, Economy Resource Flow, and Custom Narrative Trumps', () => {
    const customBrief = `请创作《山海借命录》。成长轴：借命修为、药道造诣、山海残卷执掌度。阻力轴：折寿反噬、宗门围剿强度。主角沈砚只允许动用“残缺药经·第一页借息术”与凡俗医毒手段，严禁提前解锁终局底牌“山海借命总纲”或“九幽黄泉印”。核心流通资源：下品灵石、百年血参药材、阳寿寿元。` // cjk-ok
    const extracted = extractCustomNarrativeOverridesFromText(customBrief)
    expect(extracted.axisProtagonist).toContain('借命修为') // cjk-ok
    expect(extracted.axisAntagonist).toContain('折寿反噬') // cjk-ok
    expect(extracted.earlyUnlockItems[0]).toContain('残缺药经·第一页借息术') // cjk-ok
    expect(extracted.lateLockedItems).toContain('山海借命总纲') // cjk-ok

    const profile = resolveNovelGenreProfile('xianxia_cultivation', {
      sourceContextText: customBrief
    })
    expect(profile.unlockItemsZh[0]).toContain('残缺药经·第一页借息术') // cjk-ok
    expect(profile.unlockItemsZh).toContain('山海借命总纲') // cjk-ok

    const wb = createMxWorkbenchPreset('short_drama_progression')
    const ch1Slice = exportMxChapterNumericalSlice(wb, 1, 200, profile)
    const ch8Slice = exportMxChapterNumericalSlice(wb, 8, 200, profile)
    const ch11Slice = exportMxChapterNumericalSlice(wb, 11, 200, profile)
    expect(ch1Slice.allowedTrumpCards).toContain('残缺药经·第一页借息术') // cjk-ok
    expect(ch1Slice.lockedEndgameTrumps).toContain('山海借命总纲') // cjk-ok
    expect(ch1Slice.villainPressure).toBeLessThan(ch8Slice.villainPressure)
    expect(ch11Slice.trumpCooldownStatusZh).toContain('高潮反噬与调息冷却窗口') // cjk-ok

    const fullSchedule = generateMxFullLifecycleArcScheduleMarkdown(wb, 200, profile)
    expect(fullSchedule).toContain('第 1~10 章') // cjk-ok
    expect(fullSchedule).toContain('第 61~70 章') // cjk-ok
    expect(fullSchedule).toContain('第 191~200 章') // cjk-ok

    const slicedCh68 = narrowOutlineTextForChapter(fullSchedule, 68, 'zh-CN', {
      totalChapters: 200,
      targetWords: 3200,
      genre: profile
    })
    expect(slicedCh68).toContain('第 61~70 章') // cjk-ok
    expect(slicedCh68).toContain('第 68/200 章确定性单章执行细纲卡') // cjk-ok

    const mxDoc = createMxFromTemplate('short_drama_reversal_loop')
    mxDoc.description = customBrief
    const econSpec = exportMxEconomyResourceNarrativeSpec(
      mxDoc,
      { sourceSinkRatio: 1.04 },
      { currentChapter: 4, totalChapters: 200, genre: profile }
    )
    expect(econSpec).toContain('全书经济系统与核心资源供需法则') // cjk-ok
    expect(econSpec).toContain('第 4/200 章时间完备经济切片') // cjk-ok
    expect(econSpec).toContain('定量收支预算锁') // cjk-ok
  })

  it('wraps multi-chapter novel chains into a 10-chapters-per-row 2D grid and creates Arc GraphGroups', async () => {
    const {
      autoLayoutNodes,
      createNodeFromType,
      getNodePorts,
      optimizeNovelChapterPassthroughEdges
    } = await import('../src/shared/graph')
    const outline = createNodeFromType('novel.outline', { x: 0, y: 0 }, { title: '小说大纲' }) // cjk-ok
    const economy = createNodeFromType('game.economy', { x: 0, y: 200 }, { title: '经济系统' }) // cjk-ok
    const numerical = createNodeFromType('game.numerical', { x: 0, y: 400 }, { title: '数值系统' }) // cjk-ok
    const chapters = Array.from({ length: 25 }, (_, i) => {
      const chapNo = i + 1
      return createNodeFromType(
        'asset.novel',
        { x: chapNo * 400, y: 0 },
        {
          title: `第${chapNo}章`, // cjk-ok
          params: {
            novelNodeMode: 'chapter',
            novelCurrentChapter: chapNo,
            novelTotalChapters: 200
          }
        }
      )
    })

    // Verify each chapter node has the 5 output ports: out, out-outline, out-economy, out-numerical, out-all
    const outPortIds = getNodePorts(chapters[0]!)
      .filter((p) => p.direction === 'out')
      .map((p) => p.id)
    expect(outPortIds).toEqual(['out', 'out-outline', 'out-economy', 'out-numerical', 'out-all'])

    const nodes = [economy, numerical, outline, ...chapters]
    // Simulate legacy broadcast edges where outline/economy/numerical connect to all 25 chapters
    const edges = [
      ...chapters.map((ch) => ({
        id: `e-out-${ch.id}`,
        source: outline.id,
        sourcePort: 'out',
        target: ch.id,
        targetPort: 'in-outline'
      })),
      ...chapters.map((ch) => ({
        id: `e-econ-${ch.id}`,
        source: economy.id,
        sourcePort: 'out-text',
        target: ch.id,
        targetPort: 'in-economy'
      })),
      ...chapters.map((ch) => ({
        id: `e-num-${ch.id}`,
        source: numerical.id,
        sourcePort: 'out-text',
        target: ch.id,
        targetPort: 'in-numerical'
      }))
    ]
    optimizeNovelChapterPassthroughEdges(nodes, edges)

    // Outline, Economy, and Numerical only connect to Chapter 1
    expect(edges.filter((e) => e.source === outline.id).map((e) => e.target)).toEqual([
      chapters[0]!.id
    ])
    expect(edges.filter((e) => e.source === economy.id).map((e) => e.target)).toEqual([
      chapters[0]!.id
    ])
    expect(edges.filter((e) => e.source === numerical.id).map((e) => e.target)).toEqual([
      chapters[0]!.id
    ])

    // Chapter 1 passes out, out-outline, out-economy, out-numerical to Chapter 2
    const ch1ToCh2 = edges
      .filter((e) => e.source === chapters[0]!.id && e.target === chapters[1]!.id)
      .map((e) => `${e.sourcePort}->${e.targetPort}`)
    expect(ch1ToCh2).toEqual([
      'out->in',
      'out-outline->in-outline',
      'out-economy->in-economy',
      'out-numerical->in-numerical'
    ])

    const groups: Array<{ id: string; title?: string }> = []
    autoLayoutNodes(nodes, edges, { groups })

    // Chapter 1 and Chapter 11 and Chapter 21 should be aligned on the same X column, on 3 distinct Y rows
    expect(chapters[0]!.position.x).toBe(chapters[10]!.position.x)
    expect(chapters[10]!.position.x).toBe(chapters[20]!.position.x)
    expect(chapters[10]!.position.y).toBeGreaterThan(chapters[0]!.position.y)
    expect(chapters[20]!.position.y).toBeGreaterThan(chapters[10]!.position.y)

    // 3 Arc groups created
    expect(groups.map((g) => g.id)).toEqual([
      'group-novel-arc-1',
      'group-novel-arc-2',
      'group-novel-arc-3'
    ])
    expect(groups[0]!.title).toContain('第一幕（第1~10章）') // cjk-ok
    expect(groups[1]!.title).toContain('第二幕（第11~20章）') // cjk-ok
    expect(groups[2]!.title).toContain('第三幕（第21~30章）') // cjk-ok
    expect(chapters[0]!.groupId).toBe('group-novel-arc-1')
    expect(chapters[10]!.groupId).toBe('group-novel-arc-2')
    expect(chapters[24]!.groupId).toBe('group-novel-arc-3')
  })

  it('builds a complete 200-chapter numerical system (4 Volumes × 50 Chapters, 10 Realm Stages, 20 Conflict Arcs) and auto-upgrades legacy 80-cap workbenches', async () => {
    const {
      createXianxia200LifespanWorkbench,
      generateMxLevelProgressionTable,
      normalizeMxDocument,
      resolveNovelChapterStageMeta
    } = await import('../src/shared/gameAssets')

    const wb = createXianxia200LifespanWorkbench()
    expect(wb.roguelikeEnvelope.levelMax).toBe(200)
    expect(wb.roguelikeEnvelope.floors).toBe(20)
    expect(wb.roguelikeEnvelope.levelAscensionInterval).toBe(20)

    const lvTable = generateMxLevelProgressionTable(wb.roguelikeEnvelope)
    expect(lvTable.maxLevel).toBe(200)
    expect(lvTable.rows.length).toBe(200)
    expect(lvTable.rows[0]!.level).toBe(1)
    expect(lvTable.rows[199]!.level).toBe(200)

    const s1 = resolveNovelChapterStageMeta(1, 200, true, 20)
    const s85 = resolveNovelChapterStageMeta(85, 200, true, 20)
    const s145 = resolveNovelChapterStageMeta(145, 200, true, 20)
    const s200 = resolveNovelChapterStageMeta(200, 200, true, 20)
    expect(s1.volumeBadgeZh).toContain('第一卷') // cjk-ok
    expect(s1.realmNameZh).toContain('凡尘采药徒') // cjk-ok
    expect(s85.volumeBadgeZh).toContain('第二卷') // cjk-ok
    expect(s145.volumeBadgeZh).toContain('第三卷') // cjk-ok
    expect(s200.volumeBadgeZh).toContain('第四卷') // cjk-ok
    expect(s200.realmNameZh).toContain('渡劫执道') // cjk-ok

    // Legacy saved diagram with 80-cap workbench should auto-upgrade to 200 chapters
    const tplDoc = createMxFromTemplate('xianxia_lifespan_alchemy')
    expect(tplDoc.workbench?.roguelikeEnvelope.levelMax).toBe(200)

    const legacyDoc = {
      ...tplDoc,
      workbench: {
        ...createMxWorkbenchPreset('slay_the_spire_dbg'),
        roguelikeEnvelope: {
          ...createMxWorkbenchPreset('slay_the_spire_dbg').roguelikeEnvelope,
          levelMax: 80
        }
      }
    }
    const upgraded = normalizeMxDocument(legacyDoc)
    expect(upgraded.workbench?.roguelikeEnvelope.levelMax).toBe(200)
    expect(upgraded.workbench?.activePresetId).toBe('short_drama_progression')
  })

  it('recognizes numbered Chinese GDD headings and auto-completes all 6 engineering dimensions to 100/100', () => {
    const numberedGdd = [
      '# 一、系统概述',
      '- 中医药沉浸式虚拟交互教学空间。',
      '# 二、系统目标',
      '- 首版不少于 30 个穴位、100 道题库，计分规则全量可测。',
      '# 三、功能点设计',
      '## F01 中医馆数字孪生场景｜P0',
      '- **边界与异常**：300ms 防抖、断线保留草稿、资源不足前拦截。',
      '# 四、界面清单与 UI 布局设计',
      '## 4.1 全局布局、状态与拆分规范',
      '- 面板底框采用九宫格，每屏 PSD 组名含 Frame_9Slice。',
      '## UI-01 沉浸式主场景 HUD',
      '- **形态/比例**：`hud / 16:9`',
      '```text',
      '┌──────────────────────────────┐',
      '│ 顶部状态栏           账号信息│',
      '│       3D 主场景与数字人      │',
      '└──────────────────────────────┘',
      '```',
      '- **拆分**：场景独立渲染；顶部/底部 HUD 九宫格。',
      '## UI-06 题库答题',
      '- **形态/比例**：`fullscreen / 16:9`',
      '```text',
      '┌──────────────────────────────┐',
      '│ 题干区 74%        │ 答题卡26%│',
      '│ 选项与交卷按钮    │ 计时器   │',
      '└──────────────────────────────┘',
      '```',
      '- **拆分**：题干底框、选项七态、答题卡格子分别成组。',
      '# 五、交互与反馈规范',
      '- 最小热区 48×48px，点击反馈 ≤50ms。',
      '# 六、数据与配置',
      '| 字段名 | 类型 | 说明 |',
      '| --- | --- | --- |',
      '| score | number | 计分规则分值 |'
    ].join('\n')

    const auditNumbered = auditGameSystemDocument(numberedGdd)
    expect(auditNumbered.sectionChecks).toEqual({
      overview: true,
      goals: true,
      features: true,
      uiLayout: true,
      uiRequirements: true,
      dataConfig: true
    })
    expect(auditNumbered.uiScreens.length).toBe(2)
    expect(auditNumbered.overallScore).toBe(100)
    expect(auditNumbered.warningsZh).toEqual([])

    // Partial GDD missing overview/goals/features and having bare UI screens without wireframes
    const partialGdd = [
      '# UI 布局设计',
      '## 主界面',
      '- 展示角色与按钮',
      '# 数据与配置',
      '- 待补充'
    ].join('\n')
    const beforeAudit = auditGameSystemDocument(partialGdd)
    expect(beforeAudit.overallScore).toBeLessThan(100)

    const fixed = autoCompleteGameSystemDocument(partialGdd, {
      archetypeId: 'rpg_progression',
      targetAspect: '16:9'
    })
    expect(fixed.changed).toBe(true)
    const afterAudit = auditGameSystemDocument(fixed.text)
    expect(afterAudit.overallScore).toBe(100)
    expect(Object.values(afterAudit.sectionChecks).every(Boolean)).toBe(true)
    expect(afterAudit.uiScreens.length).toBeGreaterThanOrEqual(2)
    expect(afterAudit.uiScreens.every((s) => s.hasWireframe && s.hasPsdSpec)).toBe(true)
    expect(afterAudit.warningsZh).toEqual([])

    // Non-combat teaching/simulation GDD never injects combat/RPG/short-drama stats
    expect(inferGameSystemArchetypeFromContext({ prompt: '中医药沉浸式虚拟交互教学空间' })).toBe(
      'universal_full_ui'
    )
    const teachingFixed = autoCompleteGameSystemDocument('', {
      customInstruction: '中医药沉浸式虚拟交互教学空间：经络穴位、药材辨识与实训考核',
      targetAspect: '16:9'
    })
    expect(teachingFixed.text).not.toContain('sd_endure')
    expect(teachingFixed.text).not.toContain('至尊黑卡')
    expect(teachingFixed.text).not.toContain('角色境界突破')
    expect(teachingFixed.text).not.toContain('寻访卡池')
    expect(auditGameSystemDocument(teachingFixed.text).overallScore).toBe(100)

    // Polluted legacy RPG/short-drama duplicate tail is detected and stripped cleanly
    const pollutedGdd = [
      numberedGdd,
      '',
      '# UI 布局设计',
      '',
      '## 4.1 角色境界突破与属性总览主界面（`ui_rpg_realm_main`）',
      '- **界面规格**：界面形态 `screenKind: fullscreen` · 建议画幅比例 `aspectRatio: 16:9`',
      '# 数据与配置',
      '## 6.1 标准角色与宿敌属性配置表（源自经济系统工作台）',
      '| 实体ID | 名称 | 稀有度 | 费用/阶位 | 核心属性明细 |',
      '| :--- | :--- | :--- | :--- | :--- |',
      '| `sd_endure` | 隐忍蛰伏·暗中布局 (铺垫) | common | 1 | dmg:0 / block:8 |'
    ].join('\n')
    const pollutedAudit = auditGameSystemDocument(pollutedGdd)
    expect(pollutedAudit.overallScore).toBeLessThan(100)
    expect(pollutedAudit.warningsZh.some((w) => w.includes('误追加'))).toBe(true)

    const cleaned = autoCompleteGameSystemDocument(pollutedGdd, {
      customInstruction: '中医药沉浸式虚拟交互教学空间'
    })
    expect(cleaned.changed).toBe(true)
    expect(cleaned.text).not.toContain('sd_endure')
    expect(cleaned.text).not.toContain('ui_rpg_realm_main')
    expect(auditGameSystemDocument(cleaned.text).overallScore).toBe(100)
  })

  it('isolates TCM / non-combat game.numerical nodes from unrelated novel & economy nodes on the same canvas and outputs pure GDD domain tables', async () => {
    const econNode = createNodeFromType('game.economy', 0, 0)
    econNode.id = 'novel-econ'
    econNode.title = '经济系统'
    econNode.params.gameEconomyPreset = 'xianxia_lifespan_alchemy'

    const outlineNode = createNodeFromType('novel.outline', 300, 0)
    outlineNode.id = 'novel-outline'
    outlineNode.title = '山海借命录·小说大纲'
    outlineNode.params.novelTotalChapters = 200

    const gddNode = createNodeFromType('asset.gameSystem', 0, 500)
    gddNode.id = 'tcm-gdd'
    gddNode.title = '中医药沉浸式虚拟教学系统·策划案'
    gddNode.params.text =
      '# 一、概述\n中医药沉浸式虚拟交互教学空间，含十二正经穴位实训与中药饮片鉴别。'

    const initialGraph = normalizeGraph({
      nodes: [econNode, outlineNode, gddNode],
      edges: [
        {
          id: 'e-novel-1',
          source: econNode.id,
          sourcePort: 'out-text',
          target: outlineNode.id,
          targetPort: 'in-economy'
        }
      ],
      groups: [],
      runStates: {}
    })

    // Adding a TCM numerical node and connecting it ONLY to tcm-gdd must NOT auto-wire novel-econ or novel-outline!
    const editRes = applyGraphEditOps(initialGraph, [
      {
        op: 'node_add',
        nodeId: 'tcm-num',
        typeId: 'game.numerical',
        title: '中医药沉浸式教学系统·数值系统',
        params: {
          prompt: '生成中医十二正经取穴容差表、中药饮片剂量配伍表与端云交互性能阈值表'
        }
      },
      {
        op: 'edge_connect',
        fromNodeId: 'tcm-num',
        fromPort: 'out-text',
        toNodeId: 'tcm-gdd',
        toPort: 'in-numerical'
      }
    ])

    const edgesTouchingTcmNum = editRes.graph.edges.filter(
      (e) => e.source === 'tcm-num' || e.target === 'tcm-num'
    )
    expect(edgesTouchingTcmNum).toHaveLength(1)
    expect(edgesTouchingTcmNum[0]?.target).toBe('tcm-gdd')
    expect(
      editRes.graph.edges.some((e) => e.source === 'novel-econ' && e.target === 'tcm-num')
    ).toBe(false)

    // Executing tcm-num on the mixed canvas produces pure TCM domain tables (zero 200-chapter / short-drama / SSR pollution)
    const tcmNumNode = editRes.graph.nodes.find((n) => n.id === 'tcm-num')!
    const numOut = await executeGameNumericalNode({
      node: tcmNumNode,
      inputs: {},
      document: editRes.graph
    })
    const outText = numOut['out-text']
    expect(outText?.kind).toBe('text')
    const rawBundle = outText && outText.kind === 'text' ? outText.text : ''
    const parsedBundle = JSON.parse(rawBundle)
    expect(parsedBundle.subKind).toBe('domain_numerical_tables_bundle')
    expect(parsedBundle.domainTables?.enabled).toBe(true)
    expect(parsedBundle.domainTables?.domainId).toBe('tcm_virtual_teaching')
    expect(parsedBundle.domainTables?.tables.length).toBeGreaterThanOrEqual(5)
    expect(parsedBundle.domainTables?.tables.map((t: { id: string }) => t.id)).toEqual(
      expect.arrayContaining([
        'tcm_runtime_params',
        'tcm_acupoint_rules',
        'tcm_herb_catalog',
        'tcm_exam_quota',
        'tcm_data_schema'
      ])
    )

    const unwrappedMd = unwrapEconomyBundleForGameSystem(rawBundle)
    expect(unwrappedMd).toContain('十二正经核心腧穴三维定位与取穴实训容差配表')
    expect(unwrappedMd).toContain('中药饮片三维鉴别、剂量区间与配伍禁忌权重表')
    expect(unwrappedMd).toContain('LU7')
    expect(unwrappedMd).toContain('十八反')
    expect(unwrappedMd).not.toContain('sd_endure')
    expect(unwrappedMd).not.toContain('标准角色与宿敌属性配置表')
    expect(unwrappedMd).not.toContain('200 章')
  })

  it('enforces diegetic ("藏数于戏") numerical & economy translation in prompts, offline synthesis, and post-generation sanitizer', async () => {
    expect(DEFAULT_NOVEL_SYSTEM_PROMPT_ZH).toContain('藏数于戏')
    expect(DEFAULT_NOVEL_SYSTEM_PROMPT_ZH).toContain('严禁面板数字直出正文')

    const wb = createMxWorkbenchPreset('short_drama_progression')
    const slice36 = exportMxChapterNumericalSlice(wb, 36, 200)
    expect(slice36.sliceMarkdown).toContain('藏数于戏·正文隐形转译红线')

    const econSpec36 = exportMxEconomyResourceNarrativeSpec(
      {
        title: '山海借命录经济系统',
        resources: [
          { id: 'stone', name: '下品灵石' },
          { id: 'life', name: '母子剩余阳寿' }
        ],
        nodes: [{ kind: 'Pool', label: '灵石囊', initial: 80 }]
      },
      { steps: 200, sourceSinkRatio: 1.58 },
      { currentChapter: 36, totalChapters: 200 }
    )
    expect(econSpec36).toContain('藏数于戏·去报表化铁律')

    const leakedExcerpt = [
      '# 第36章：水牢伏击·血战突围',
      '',
      '沈砚立于风雪廊下，体内【第 1 阶·引气入体】的气机平稳流转（当前气血底蕴 `2519`、实测战力 `315`、护体底蕴 `204`，本章战力发挥上限锁定为 `91`）。【临界蓄满待发窗口】随身账册上的【下品/中品灵石】期初储备定格在 `119` 单位（映射全书经济仿真步 `Step 36/200` · 幕末前夜）。他运转【残缺药经·去毒提纯反手打脸 (第1卷反转)】与【林照月·青云内门剑帖与寒门同盟契 (势力倍增)】，按照 $E(t=36)$ 将根基（Lv.36/200）打磨圆融（契约反噬压力指数控制在 `91`）。'
    ].join('\n')

    const cleaned = sanitizeNovelChapterGeneratedText(leakedExcerpt)
    expect(cleaned).not.toContain('当前气血底蕴')
    expect(cleaned).not.toContain('2519')
    expect(cleaned).not.toContain('映射全书经济仿真步')
    expect(cleaned).not.toContain('Step 36/200')
    expect(cleaned).not.toContain('临界蓄满待发窗口')
    expect(cleaned).not.toContain('$E(t=36)$')
    expect(cleaned).not.toContain('(第1卷反转)')
    expect(cleaned).not.toContain('(势力倍增)')
    expect(cleaned).not.toContain('(Lv.36/200)')
    expect(cleaned).toContain('【残缺药经·去毒提纯】')
    expect(cleaned).toContain('【林照月·青云内门剑帖与寒门同盟契】')
    expect(DEFAULT_NOVEL_SYSTEM_PROMPT_ZH).toContain('跨章零复读')

    const ch1Sample = [
      '# 第1章：风雪催命·三日绝契',
      '',
      '朔风卷着鹅毛大雪拍打东崖药庐单薄的木窗，小泥炉上的粗陶药罐咕嘟冒着苦涩白气。',
      '',
      '夜色间隙里，沈砚下意识摸了摸腰间那只洗得发白的粗布药囊，囊底仅剩的几块下品灵石磕碰在一起发出清冷脆响。',
      '',
      '风雪拍打木窗，一行血字骤然映入眼帘！'
    ].join('\n')
    const ch2WithDup = [
      '# 第2章：残经借息·古鼎微温',
      '',
      '沈砚指尖抚过泛黄残经，趁着风雪夜色悄然掩上药庐后院暗室的木门，取出巴掌大的青铜古药铫。',
      '',
      '夜色间隙里，沈砚下意识摸了摸腰间那只洗得发白的粗布药囊，囊底仅剩的几块下品灵石磕碰在一起发出清冷脆响。',
      '',
      '药铫底部浮现出一道指向断魂崖第三裂谷的微弱红芒，那是林听潮留下的血息烙印！'
    ].join('\n')
    const dedupedCh2 = deduplicateNovelParagraphsAgainstPrevious(ch2WithDup, ch1Sample)
    expect(dedupedCh2).toContain('青铜古药铫')
    expect(dedupedCh2).not.toContain('洗得发白的粗布药囊')
    expect(dedupedCh2).toContain('指向断魂崖第三裂谷的微弱红芒')
  })
})
