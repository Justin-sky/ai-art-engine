import { describe, expect, it } from 'vitest'
import {
  analyzeMultiplierPipeline,
  auditGameSystemDocument,
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
  exportMxGodotGd,
  exportMxUnityCs,
  extractNovelIpContextForGameSystem,
  GAME_SYSTEM_ARCHETYPES,
  generateMxArcChapterOutlinePlan,
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
  applySmartNodePatch,
  createNodeFromType,
  executeGameEconomyNode,
  executeGameSystemGenerateNode,
  executeNovelGenerateNode,
  executeScreenplayGenerateNode
} from '../src/shared/graph'

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
})
