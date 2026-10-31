import { describe, expect, it } from 'vitest'
import {
  calibrateMxBattleModel,
  computeMxWorkbenchSnapshotDiff,
  createDefaultMxCardDesignLab,
  createMxWorkbenchPreset,
  ensureMxCardDesignLab,
  formatMxCardEffectSummary,
  makeScriptCard,
  measureMxPolicySkillGap,
  mxComputeAttackDamage,
  mxComputeBlockGain,
  mxCustomStatsFlatDamage,
  mxHypergeomAtLeastOne,
  mxHypergeomBothAtLeastOne,
  mxLegacyCardToScript,
  parseMxCardEffectScript,
  runMxBattleEngineSimulation,
  runMxCombatKernelSimulation,
  runMxDeckDuel,
  runMxLabEncounterSimulation,
  simulateMxDeckVsDeckMatrix,
  simulateMxPvpMatchupAndNashEquilibrium,
  simulateMxRunEconomyLoop,
  solveMxSingleTurnLethalAndOrderSkill,
  measureMxCardMarginalValues,
  mxLegacyKernelToEnemies,
  mxLegacyRelicPresetToRelics,
  mxScaleCardSpec,
  mxShouldUseEffectEngine,
  mxShouldUseEffectEngineForMana,
  mxManaCardToScript,
  mxScaleAtbScript,
  mxScaleTierEnemies,
  mxScaleTierEnemyHp,
  mxShouldUseAtbEngine,
  parseMxAtbScript,
  runMxAtbBattle,
  solveMxTierHpForClearRate,
  runMxSingleBattle,
  createMxRng,
  suggestMxCardRebalance,
  type MxDeckCardSpec,
  type MxEnemySpec,
  type MxPlaytestLogRow
} from '../src/shared/gameAssets'
import { cardLabCompute } from '../src/renderer/src/components/dive/machinations/cardLabWorkerClient'

/** 独立实现的组合数（用于与被测实现交叉验证） */
function nCk(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

const dummy: MxEnemySpec = {
  id: 'dummy',
  name: 'Dummy',
  hp: 60,
  pattern: 'cycle',
  intents: [{ name: 'Hit', damage: 8, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
}

describe('Hypergeometric known answers', () => {
  it('P(at least one of 3 copies in 7 cards from 40) = 1 - C(37,7)/C(40,7) ≈ 44.78%', () => {
    const expected = 1 - nCk(37, 7) / nCk(40, 7)
    expect(expected).toBeCloseTo(0.44777, 4)
    expect(mxHypergeomAtLeastOne(40, 3, 7)).toBeCloseTo(expected, 10)
    // 1 copy in 30, draw 5 → exactly 5/30
    expect(mxHypergeomAtLeastOne(30, 1, 5)).toBeCloseTo(5 / 30, 10)
    // drawing more than non-target cards guarantees a hit
    expect(mxHypergeomAtLeastOne(10, 3, 8)).toBe(1)
  })

  it('combo inclusion–exclusion matches independent combinatorics', () => {
    const N = 40
    const n = 7
    const expected = 1 - (2 * nCk(N - 3, n)) / nCk(N, n) + nCk(N - 6, n) / nCk(N, n)
    expect(mxHypergeomBothAtLeastOne(N, 3, 3, n)).toBeCloseTo(expected, 10)
  })
})

describe('Card effect DSL', () => {
  it('parses triggers, conditions, multi-hit, targets, scaling and keywords', () => {
    const fx = parseMxCardEffectScript('dmg 6x2; if hand<=2: draw 2; kw exhaust')
    expect(fx.errors).toEqual([])
    expect(fx.clauses).toHaveLength(2)
    expect(fx.clauses[0]!.effect).toMatchObject({
      op: 'damage',
      amount: 6,
      hits: 2,
      target: 'enemy'
    })
    expect(fx.clauses[1]!.condition).toMatchObject({ subject: 'hand', cmp: '<=', value: 2 })
    expect(fx.keywords).toContain('exhaust')

    const ww = parseMxCardEffectScript('kw x; dmg 5 @all *x')
    expect(ww.keywords).toContain('x_cost')
    expect(ww.clauses[0]).toMatchObject({ scale: 'x', effect: { target: 'all_enemies' } })

    const pw = parseMxCardEffectScript('kw power; turn_end: blk 3')
    expect(pw.clauses[0]!.trigger).toBe('turn_end')

    const zh = parseMxCardEffectScript('伤害 8; 易伤 2; 若 敌方易伤: 抽 1') // cjk-ok
    expect(zh.errors).toEqual([])
    expect(zh.clauses.map((c) => c.effect.op)).toEqual(['damage', 'status', 'draw'])

    const bad = parseMxCardEffectScript('fireball 9')
    expect(bad.errors.length).toBe(1)
    expect(formatMxCardEffectSummary(fx)).toContain('6×2 DMG')
  })

  it('applies exact damage/block formulas', () => {
    expect(mxComputeAttackDamage(6, 0, false, true)).toBe(9)
    expect(mxComputeAttackDamage(6, 2, true, false)).toBe(6)
    expect(mxComputeAttackDamage(6, 2, true, true)).toBe(9)
    expect(mxComputeBlockGain(5, 1, true)).toBe(4)
  })

  it('legacy fields convert to an equivalent script with identical simulation results', () => {
    const legacy: MxDeckCardSpec = {
      id: 'bash',
      name: 'Bash',
      cost: 2,
      count: 2,
      damage: 8,
      block: 0,
      draw: 0,
      energyGain: 0,
      applyStrength: 0,
      applyVulnerable: 2,
      applyWeak: 0,
      exhaust: false,
      priority: 5
    }
    const strike: MxDeckCardSpec = {
      ...legacy,
      id: 'strike',
      name: 'Strike',
      cost: 1,
      count: 5,
      damage: 6,
      applyVulnerable: 0
    }
    const defend: MxDeckCardSpec = {
      ...strike,
      id: 'defend',
      name: 'Defend',
      damage: 0,
      block: 5,
      count: 5
    }
    expect(mxLegacyCardToScript(legacy)).toBe('dmg 8; vuln 2')
    const deckA = [legacy, strike, defend]
    const deckB = deckA.map((c) => ({ ...c, effectScript: mxLegacyCardToScript(c) }))
    const base = {
      enemies: [dummy],
      playerHp: 80,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 20,
      policy: 'greedy' as const,
      runs: 60,
      seed: 7
    }
    const a = runMxBattleEngineSimulation({ ...base, deck: deckA })
    const b = runMxBattleEngineSimulation({ ...base, deck: deckB })
    expect(a.winRatePct).toBe(b.winRatePct)
    expect(a.avgHpLoss).toBe(b.avgHpLoss)
  })

  it('X-cost hits all enemies X times; powers persist each turn', () => {
    const ww = makeScriptCard('ww', 'Whirlwind', 0, 'kw x; dmg 5 @all *x', 'uncommon', 10)
    const two: MxEnemySpec[] = [
      {
        ...dummy,
        id: 'a',
        hp: 15,
        intents: [
          { name: 'Idle', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
        ]
      },
      {
        ...dummy,
        id: 'b',
        hp: 15,
        intents: [
          { name: 'Idle', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
        ]
      }
    ]
    // 3 energy → X=3 → 15 to each enemy → both die on turn 1
    const res = runMxBattleEngineSimulation({
      deck: [ww],
      enemies: two,
      playerHp: 50,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 3,
      policy: 'greedy',
      runs: 5,
      seed: 1
    })
    expect(res.winRatePct).toBe(100)
    expect(res.ttkP50).toBe(1)

    const metal = makeScriptCard(
      'metal',
      'Metallicize',
      1,
      'kw power; turn_end: blk 3',
      'uncommon',
      1
    )
    const filler = makeScriptCard('wait', 'Wait', 0, 'kw unplayable', 'common', 4)
    const hitter: MxEnemySpec = {
      ...dummy,
      hp: 999,
      intents: [{ name: 'Poke', damage: 3, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const pw = runMxBattleEngineSimulation({
      deck: [metal, filler],
      enemies: [hitter],
      playerHp: 50,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 6,
      policy: 'greedy',
      runs: 3,
      seed: 3
    })
    // Metallicize played turn 1 → 3 block every turn-end fully absorbs the 3-dmg poke
    expect(pw.avgHpLoss).toBe(0)
  })

  it('enemy status-card injection pollutes the deck (Burn self-damage at turn end)', () => {
    const blocker = makeScriptCard('blk', 'Defend', 1, 'blk 5', 'common', 6)
    const burner: MxEnemySpec = {
      id: 'burner',
      name: 'Burner',
      hp: 999,
      pattern: 'cycle',
      intents: [
        {
          name: 'Sear',
          damage: 0,
          hits: 1,
          block: 0,
          strengthGain: 0,
          addStatusCards: 3,
          statusCardKind: 'burn'
        }
      ]
    }
    const res = runMxBattleEngineSimulation({
      deck: [blocker],
      enemies: [burner],
      playerHp: 60,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 8,
      policy: 'greedy',
      runs: 10,
      seed: 5
    })
    expect(res.avgHpLoss).toBeGreaterThan(0)
  })
})

describe('Play policies, PvP duels and matrix', () => {
  const orderDeck = (): MxDeckCardSpec[] => [
    makeScriptCard('bash', 'Bash', 2, 'dmg 8; vuln 2', 'common', 2),
    makeScriptCard('inflame', 'Inflame', 1, 'kw power; str 2', 'uncommon', 1),
    makeScriptCard('twin', 'Twin Strike', 1, 'dmg 5x2', 'common', 4),
    makeScriptCard('defend', 'Defend', 1, 'blk 5', 'common', 4),
    makeScriptCard('adren', 'Adrenaline', 0, 'nrg 1; draw 2; kw exhaust', 'rare', 1)
  ]
  const brute: MxEnemySpec = {
    id: 'brute',
    name: 'Brute',
    hp: 110,
    pattern: 'cycle',
    intents: [
      { name: 'Smash', damage: 14, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 },
      { name: 'Roar', damage: 0, hits: 1, block: 8, strengthGain: 2, addStatusCards: 0 }
    ]
  }

  it('search policy beats random play on an order-sensitive deck', () => {
    const gap = measureMxPolicySkillGap({
      deck: orderDeck(),
      enemies: [brute],
      playerHp: 70,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 20,
      runs: 40,
      seed: 11
    })
    expect(gap.search.avgHpLoss).toBeLessThanOrEqual(gap.random.avgHpLoss)
    expect(gap.search.winRatePct).toBeGreaterThanOrEqual(gap.random.winRatePct)
    expect(['high_skill_ceiling', 'moderate_tactics', 'flat_brainless']).toContain(gap.verdict)
  })

  it('mirror duel is ~50%, a strictly stronger deck wins more', () => {
    const deck = orderDeck()
    const o = {
      runs: 120,
      seed: 9,
      hp: 60,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurnsPerSide: 25,
      policy: 'greedy' as const
    }
    const mirror = runMxDeckDuel(deck, deck, o)
    expect(mirror.winRateAPct).toBeGreaterThan(35)
    expect(mirror.winRateAPct).toBeLessThan(65)
    const stronger = deck.map((c) => ({
      ...c,
      effectScript: c.effectScript!.replace(/dmg (\d+)/g, (_m, n: string) => `dmg ${Number(n) * 2}`)
    }))
    expect(runMxDeckDuel(stronger, deck, o).winRateAPct).toBeGreaterThan(65)
  })

  it('deck-vs-deck matrix is antisymmetric and Nash shares sum to 100', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const pvp = simulateMxPvpMatchupAndNashEquilibrium(wb, { runsPerPair: 10 })
    expect(pvp.matrixSource).toBe('deck_vs_deck_simulation')
    expect(pvp.rows).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i === j) continue
        expect(pvp.rows[i]!.vsPcts[j]! + pvp.rows[j]!.vsPcts[i]!).toBeCloseTo(100, 0)
      }
    }
    const total = pvp.rows.reduce((s, r) => s + r.nashEquilibriumSharePct, 0)
    expect(total).toBeGreaterThan(99)
    expect(total).toBeLessThan(101)

    const m = simulateMxDeckVsDeckMatrix(
      [
        { id: 'a', name: 'A', cards: orderDeck() },
        { id: 'b', name: 'B', cards: orderDeck() }
      ],
      {
        runs: 10,
        seed: 1,
        hp: 50,
        energyPerTurn: 3,
        drawPerTurn: 5,
        maxTurnsPerSide: 20,
        policy: 'greedy'
      }
    )
    expect(m.matrix[0]![1]! + m.matrix[1]![0]!).toBeCloseTo(100, 0)
  })
})

describe('Run economy loop & calibration', () => {
  it('runs the gold → reward/shop → removal → rest → deck loop', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.economy.runs = 12
    lab.economy.floors = 10
    const res = simulateMxRunEconomyLoop(wb, lab)
    expect(res.floorRows).toHaveLength(10)
    expect(res.clearRatePct).toBeGreaterThanOrEqual(0)
    expect(res.clearRatePct).toBeLessThanOrEqual(100)
    expect(res.avgCardsAdded).toBeGreaterThan(0)
    expect(res.floorRows[0]!.aliveRatePct).toBeGreaterThanOrEqual(res.floorRows[9]!.aliveRatePct)
    const deaths = res.deathFloorHistogram.reduce((a, d) => a + d.deaths, 0)
    expect(Math.round((deaths / res.runs) * 1000) / 10).toBeCloseTo(100 - res.clearRatePct, 0)
  })

  it('calibration recovers a known enemy-HP scale from synthetic playtest logs', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = ensureMxCardDesignLab(wb)
    const trueScale = 1.4
    const logs: MxPlaytestLogRow[] = []
    for (const encId of ['n_jaw', 'n_cultist']) {
      const truth = runMxLabEncounterSimulation(wb, lab, {
        encounterId: encId,
        runs: 80,
        enemyHpScale: trueScale
      })
      const n = 80
      const wins = Math.round((truth.winRatePct / 100) * n)
      for (let i = 0; i < n; i++)
        logs.push({
          encounterId: encId,
          won: i < wins,
          turns: truth.ttkMean,
          hpLoss: truth.avgHpLoss
        })
    }
    const cal = calibrateMxBattleModel(wb, lab, logs, 80)
    expect(cal.rows).toHaveLength(2)
    expect(cal.calibrationTarget).toBe('hp_loss')
    expect(cal.meanAbsHpLossErrAfter).toBeLessThanOrEqual(cal.meanAbsHpLossErrBefore)
    expect(Math.abs(cal.suggestedEnemyHpScale - trueScale)).toBeLessThan(0.25)
  })
})

describe('Regression fixes', () => {
  it('unrelated custom columns are no longer summed into damage', () => {
    expect(mxCustomStatsFlatDamage({ costReduction: 3, poisonOnCrit: 5 })).toBe(0)
    expect(mxCustomStatsFlatDamage({ bonus_dmg: 4, flatDamage: 2 })).toBe(6)
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const base = runMxCombatKernelSimulation({ ...wb.combatKernel, runs: 80 })
    const withJunk = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: 80,
      deckCards: wb.combatKernel.deckCards.map((c) => ({ ...c, customStats: { costReduction: 9 } }))
    })
    expect(withJunk.winRatePct).toBe(base.winRatePct)
  })

  it('lethal solver no longer fabricates vulnerable/strength for flat decks', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    wb.combatKernel.deckCards = [1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      name: `Strike${i}`,
      cost: 1,
      count: 2,
      damage: 6,
      block: 0,
      draw: 0,
      energyGain: 0,
      applyStrength: 0,
      applyVulnerable: 0,
      applyWeak: 0,
      exhaust: false,
      priority: 5
    }))
    const res = solveMxSingleTurnLethalAndOrderSkill(wb)
    expect(res.skillGapRatio).toBe(1)
    expect(res.skillCeilingVerdict).toBe('flat_brainless')
  })

  it('snapshot diff aligns by entity id after removing a card', () => {
    const base = createMxWorkbenchPreset('slay_the_spire_dbg')
    const cur = JSON.parse(JSON.stringify(base)) as typeof base
    const removed = cur.multiplier.entities.shift()!
    const diff = computeMxWorkbenchSnapshotDiff(base, cur)
    expect(diff.entityDiffs).toHaveLength(1)
    expect(diff.entityDiffs[0]!.entityId).toBe(removed.id)
    expect(diff.entityDiffs[0]!.afterSummary).toBe('(Removed)')
  })
})

describe('Round 2: kernel bridge, minions, replay, marginal value, rebalance', () => {
  it('deck_cycle kernel delegates to the effect engine when cards have scripts (same result shape)', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const scripted = {
      ...wb.combatKernel,
      runs: 60,
      deckCards: wb.combatKernel.deckCards.map((c) => ({
        ...c,
        effectScript: mxLegacyCardToScript(c)
      }))
    }
    expect(mxShouldUseEffectEngine(scripted)).toBe(true)
    const res = runMxCombatKernelSimulation(scripted)
    expect(res.kernel).toBe('deck_cycle')
    expect(res.turnSeries).toHaveLength(
      Math.max(3, Math.min(40, Math.round(scripted.maxTurns || 12)))
    )
    expect(res.cardTelemetry!.length).toBe(scripted.deckCards.filter((c) => c.count > 0).length)
    expect(res.battleReplayLog!.length).toBeGreaterThan(0)
    expect(res.kpi2Value).toBeGreaterThan(0)
    expect(res.kpi2Value).toBeLessThanOrEqual(100)
    // 更高的敌方血量 → 胜率不升（共同随机数下单调）
    const harder = runMxCombatKernelSimulation({
      ...scripted,
      enemyHp: (scripted.enemyHp || 60) * 2
    })
    expect(harder.winRatePct).toBeLessThanOrEqual(res.winRatePct)
  })

  it('legacy enemy schedule maps mechanisms (swarm splits, polluter injects wounds, thorns)', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const swarm = mxLegacyKernelToEnemies({ ...wb.combatKernel, enemyMechanism: 'aoe_swarm' })
    expect(swarm).toHaveLength(3)
    const pol = mxLegacyKernelToEnemies({
      ...wb.combatKernel,
      enemyMechanism: 'status_polluter',
      statusCardsPerTurn: 2
    })
    expect(pol[0]!.intents[0]!.addStatusCards).toBe(2)
    const th = mxLegacyKernelToEnemies({
      ...wb.combatKernel,
      enemyMechanism: 'thorns_armor',
      enemyThornsDamage: 3
    })
    expect(th[0]!.thorns).toBe(3)
    expect(
      mxLegacyRelicPresetToRelics({ ...wb.combatKernel, relicTriggerPreset: 'all_synergy' })
    ).toHaveLength(3)
  })

  it('taunt minions absorb enemy attacks; minions attack at end of turn', () => {
    const wall = makeScriptCard('wall', 'Stone Wall', 1, 'summon 0/60 taunt', 'common', 5)
    const poker: MxEnemySpec = {
      ...dummy,
      hp: 999,
      intents: [{ name: 'Hit', damage: 8, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const res = runMxBattleEngineSimulation({
      deck: [wall],
      enemies: [poker],
      playerHp: 50,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 5,
      policy: 'greedy',
      runs: 5,
      seed: 2
    })
    expect(res.avgHpLoss).toBe(0)

    const wolf = makeScriptCard('wolf', 'Wolf', 1, 'summon 5/5', 'common', 6)
    const idle: MxEnemySpec = {
      ...dummy,
      hp: 40,
      intents: [{ name: 'Idle', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const kill = runMxBattleEngineSimulation({
      deck: [wolf],
      enemies: [idle],
      playerHp: 50,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 6,
      policy: 'greedy',
      runs: 5,
      seed: 4
    })
    // T1 召唤 3 只（召唤失调不攻击），T2 起每回合至少 15 伤 → 40 血在第 3~4 回合内击杀
    expect(kill.winRatePct).toBe(100)
    expect(kill.ttkMean).toBeLessThanOrEqual(4)
    expect(parseMxCardEffectScript('召唤 2/3 嘲讽').clauses[0]!.effect).toMatchObject({
      op: 'summon',
      atk: 2,
      hp: 3,
      taunt: true
    }) // cjk-ok
  })

  it('replay re-resolves the card; generate adds cards to hand', () => {
    const echo = makeScriptCard('echo', 'Echo Slash', 1, 'dmg 5; replay', 'rare', 1)
    const target: MxEnemySpec = {
      ...dummy,
      hp: 10,
      intents: [{ name: 'Idle', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const r = runMxBattleEngineSimulation({
      deck: [echo],
      enemies: [target],
      playerHp: 30,
      energyPerTurn: 1,
      drawPerTurn: 1,
      maxTurns: 2,
      policy: 'greedy',
      runs: 3,
      seed: 1
    })
    expect(r.ttkP50).toBe(1)

    const gen = makeScriptCard('gen', 'Conjure', 0, 'generate 2; kw exhaust', 'rare', 1)
    const strike = makeScriptCard('strk', 'Strike', 1, 'dmg 6', 'common', 1)
    const g = runMxBattleEngineSimulation({
      deck: [gen, strike],
      enemies: [{ ...target, hp: 18 }],
      playerHp: 30,
      energyPerTurn: 3,
      drawPerTurn: 2,
      maxTurns: 1,
      policy: 'greedy',
      runs: 5,
      seed: 3
    })
    // 1 张 Strike + 生成的 2 张 → 本回合 18 伤击杀（生成可能复制到 Conjure 自身，故只要求有胜场）
    expect(g.winRatePct).toBeGreaterThan(0)
  })

  it('card-limit punisher caps plays per turn and punishes each play', () => {
    const tap = makeScriptCard('tap', 'Tap', 0, 'dmg 1', 'common', 10)
    const idle: MxEnemySpec = {
      ...dummy,
      hp: 999,
      intents: [{ name: 'Idle', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const res = runMxBattleEngineSimulation({
      deck: [tap],
      enemies: [idle],
      playerHp: 50,
      energyPerTurn: 3,
      drawPerTurn: 5,
      maxTurns: 1,
      policy: 'greedy',
      runs: 2,
      seed: 1,
      playLimit: 3,
      playPunish: 1
    })
    expect(res.cardStats[0]!.playsPerBattle).toBe(3)
    expect(res.avgHpLoss).toBe(3)
  })

  it('simulation-based marginal value ranks a strong card above a brick, rebalance moves toward target', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.cardPool = [
      makeScriptCard('p_strong', 'Big Hit', 1, 'dmg 20', 'rare'),
      makeScriptCard('p_mid', 'Mid Hit', 1, 'dmg 8', 'common'),
      makeScriptCard('p_brick', 'Brick', 3, 'blk 1', 'common')
    ]
    const mv = measureMxCardMarginalValues(wb, lab, {
      runs: 20,
      encounterIds: ['n_jaw', 'n_cultist']
    })
    expect(mv.poolRows[0]!.cardId).toBe('p_strong')
    expect(mv.poolRows[mv.poolRows.length - 1]!.cardId).toBe('p_brick')
    expect(mv.deckRows.length).toBe(wb.combatKernel.deckCards.length)

    const weak = makeScriptCard('p_weak', 'Weak Hit', 1, 'dmg 3', 'common')
    const sug = suggestMxCardRebalance(wb, lab, weak, {
      targetValuePerCost: mv.poolRows.find((r) => r.cardId === 'p_mid')!.simValuePerCost,
      runs: 20,
      encounterIds: ['n_jaw', 'n_cultist']
    })
    expect(sug.scaleFactor).toBeGreaterThan(1)
    expect(sug.afterScript).not.toBe(sug.beforeScript)
    expect(mxScaleCardSpec(weak, 2).effectScript).toBe('dmg 6')
  })

  const idleFoe = (hp: number): MxEnemySpec => ({
    ...dummy,
    hp,
    intents: [{ name: 'Idle', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
  })
  const one = (script: string, cost = 1, count = 1): MxDeckCardSpec[] => [
    makeScriptCard('c', 'C', cost, script, 'common', count)
  ]

  it('divine shield absorbs one hit; charge attacks the turn it is summoned; lifesteal heals', () => {
    const hitter: MxEnemySpec = {
      ...dummy,
      hp: 999,
      intents: [{ name: 'Hit', damage: 5, hits: 2, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const base = {
      enemies: [hitter],
      playerHp: 30,
      energyPerTurn: 1,
      drawPerTurn: 1,
      maxTurns: 1,
      policy: 'greedy' as const
    }
    const shield = runMxSingleBattle(
      { ...base, deck: one('summon 0/1 taunt divine') },
      createMxRng(1)
    )
    const plain = runMxSingleBattle({ ...base, deck: one('summon 0/1 taunt') }, createMxRng(1))
    expect(shield.hpLoss).toBe(0)
    expect(plain.hpLoss).toBe(5)

    const fast = runMxSingleBattle(
      { ...base, enemies: [idleFoe(7)], deck: one('summon 7/1 charge') },
      createMxRng(2)
    )
    const slow = runMxSingleBattle(
      { ...base, enemies: [idleFoe(7)], deck: one('summon 7/1') },
      createMxRng(2)
    )
    expect(fast.won).toBe(true)
    expect(slow.won).toBe(false)

    const leech = runMxSingleBattle(
      {
        ...base,
        enemies: [idleFoe(999)],
        playerHp: 20,
        playerMaxHp: 30,
        deck: one('summon 3/3 charge lifesteal')
      },
      createMxRng(3)
    )
    expect(leech.hpLeft).toBe(23)
  })

  it('deathrattle fires when the minion dies; enemy clearBoard wipes minions front-first', () => {
    const poke: MxEnemySpec = {
      ...dummy,
      hp: 5,
      intents: [{ name: 'Poke', damage: 3, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const dr = runMxSingleBattle(
      {
        deck: one('summon 1/1 taunt; deathrattle: dmg 5'),
        enemies: [poke],
        playerHp: 30,
        energyPerTurn: 1,
        drawPerTurn: 1,
        maxTurns: 2,
        policy: 'greedy'
      },
      createMxRng(4)
    )
    expect(dr.won).toBe(true)
    expect(dr.turns).toBe(1)
    expect(dr.hpLoss).toBe(0)
    expect(parseMxCardEffectScript('亡语: 抽 1').clauses[0]!.trigger).toBe('deathrattle') // cjk-ok

    const sweeper: MxEnemySpec = {
      ...dummy,
      hp: 999,
      intents: [
        {
          name: 'Sweep',
          damage: 0,
          hits: 1,
          block: 0,
          strengthGain: 0,
          addStatusCards: 0,
          clearBoard: 10
        }
      ]
    }
    const wiped = runMxSingleBattle(
      {
        deck: one('summon 2/3', 1, 6),
        enemies: [sweeper],
        playerHp: 30,
        energyPerTurn: 3,
        drawPerTurn: 3,
        maxTurns: 1,
        policy: 'greedy'
      },
      createMxRng(5),
      true
    )
    expect(wiped.boardStatsByTurn[0]).toBe(15)
    expect(wiped.replay[0]!.boardAlive).toBe(0)
  })

  it('mana ramp + keep-hand: crystals grow 1/2/3 and expensive cards wait in hand', () => {
    const res = runMxSingleBattle(
      {
        deck: one('dmg 1', 3, 10),
        enemies: [idleFoe(999)],
        playerHp: 30,
        energyPerTurn: 1,
        drawPerTurn: 1,
        maxTurns: 3,
        policy: 'greedy',
        energyRamp: { start: 1, max: 10 },
        keepHand: true,
        openingHand: 3
      },
      createMxRng(6)
    )
    expect(res.energyAvailByTurn).toEqual([1, 2, 3])
    expect(res.turnDamage[0]).toBe(0)
    expect(res.turnDamage[2]).toBe(1)
    expect(res.energyLeftByTurn[2]).toBe(0)
    const duel = runMxDeckDuel(one('summon 2/2', 2, 10), one('dmg 2', 2, 10), {
      runs: 6,
      seed: 1,
      hp: 20,
      energyPerTurn: 1,
      drawPerTurn: 1,
      maxTurnsPerSide: 15,
      policy: 'greedy',
      energyRamp: { start: 1, max: 10 },
      keepHand: true,
      openingHand: 3
    })
    expect(duel.winRateAPct).toBeGreaterThanOrEqual(0)
    expect(duel.avgTurns).toBeGreaterThan(1)
  })

  it('mana_tempo kernel delegates to the effect engine with comparable KPIs', () => {
    const wb = createMxWorkbenchPreset('hearthstone_tcg')
    const legacy = runMxCombatKernelSimulation({ ...wb.combatKernel, runs: 200 })
    expect(mxShouldUseEffectEngineForMana(wb.combatKernel)).toBe(false)
    const cfg = { ...wb.combatKernel, runs: 200, useEffectEngine: true }
    expect(mxShouldUseEffectEngineForMana(cfg)).toBe(true)
    const eng = runMxCombatKernelSimulation(cfg)
    expect(eng.kernel).toBe('mana_tempo')
    expect(eng.kpi1Label).toBe(legacy.kpi1Label)
    expect(Math.abs(eng.kpi1Value - legacy.kpi1Value)).toBeLessThan(30)
    expect(Math.abs(eng.kpi2Value - legacy.kpi2Value)).toBeLessThan(30)
    expect(eng.kpi3Value).toBeGreaterThan(0)
    expect(eng.cardTelemetry!.length).toBe(
      wb.combatKernel.manaCurveDeck.filter((c) => c.count > 0).length
    )
    expect(
      mxManaCardToScript({
        id: 'x',
        name: 'X',
        manaCost: 2,
        count: 2,
        kind: 'minion',
        attack: 2,
        health: 3,
        directDamage: 1,
        drawCards: 1,
        taunt: true,
        divineShield: true
      })
    ).toBe('summon 2/3 taunt divine; dmg 1; draw 1')
    // 任意一张填写效果脚本 → 自动走引擎；冲锋随从提高斩杀速度
    const charged = {
      ...wb.combatKernel,
      runs: 200,
      manaCurveDeck: wb.combatKernel.manaCurveDeck.map((c) =>
        c.kind === 'minion' ? { ...c, effectScript: `summon ${c.attack}/${c.health} charge` } : c
      )
    }
    expect(mxShouldUseEffectEngineForMana(charged)).toBe(true)
    expect(runMxCombatKernelSimulation(charged).ttkMean).toBeLessThanOrEqual(eng.ttkMean)
  })

  it('economy loop simulated pick mode evaluates offers with real battles', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.economy = { ...lab.economy, floors: 6, runs: 4, pickMode: 'simulated', pickSimRuns: 3 }
    const sim = simulateMxRunEconomyLoop(wb, lab)
    expect(sim.pickMode).toBe('simulated')
    expect(sim.pickSimBattles).toBeGreaterThan(0)
    const formula = simulateMxRunEconomyLoop(wb, {
      ...lab,
      economy: { ...lab.economy, pickMode: 'formula' }
    })
    expect(formula.pickSimBattles).toBe(0)
    expect(sim.clearRatePct).toBeGreaterThanOrEqual(0)
  })

  it('2-ply search still beats random under lethal pressure', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    const random = runMxLabEncounterSimulation(wb, lab, { policy: 'random', runs: 40 })
    const search = runMxLabEncounterSimulation(wb, lab, { policy: 'search', runs: 40 })
    expect(search.avgHpLoss).toBeLessThanOrEqual(random.avgHpLoss)
  })

  it('fatigue: empty deck does not reshuffle and deals 1,2,3… damage', () => {
    const base = {
      deck: one('dmg 1', 0, 2),
      enemies: [idleFoe(999)],
      playerHp: 30,
      energyPerTurn: 1,
      drawPerTurn: 1,
      maxTurns: 4,
      policy: 'greedy' as const,
      keepHand: true
    }
    const tired = runMxSingleBattle({ ...base, fatigue: true }, createMxRng(7))
    // T1、T2 抽到 2 张，T3 空抽 1 点，T4 空抽 2 点
    expect(tired.fatigueDamage).toBe(3)
    expect(tired.hpLoss).toBe(3)
    expect(tired.shuffles).toBe(0)
    const loop = runMxSingleBattle(base, createMxRng(7))
    expect(loop.fatigueDamage).toBe(0)
    expect(loop.shuffles).toBeGreaterThan(0)
  })

  it('tier HP solver hits a target clear rate and scales only that tier', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.economy = { ...lab.economy, floors: 8 }
    const scaled = mxScaleTierEnemyHp(lab, 'boss', 0.5)
    expect(scaled.enemies.find((e) => e.id === 'hexa_warden')!.hp).toBe(110)
    expect(scaled.enemies.find((e) => e.id === 'jaw_worm')!.hp).toBe(42)
    const res = solveMxTierHpForClearRate(wb, lab, {
      targetClearRatePct: 50,
      tier: 'boss',
      runs: 40,
      tolerancePct: 8
    })
    expect(res.iterations.length).toBeGreaterThan(1)
    if (!res.bound) expect(Math.abs(res.achievedClearRatePct - 50)).toBeLessThanOrEqual(15)
    expect(res.enemyRows.map((r) => r.id)).toEqual(['hexa_warden'])
  })

  it('simulated mode also chooses card removals by real battles', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.economy = {
      ...lab.economy,
      floors: 6,
      runs: 4,
      startGold: 400,
      pickMode: 'simulated',
      pickSimRuns: 2
    }
    const sim = simulateMxRunEconomyLoop(wb, lab)
    expect(sim.pickSimBattles).toBeGreaterThan(0)
    expect(sim.avgCardsRemoved).toBeGreaterThanOrEqual(0)
  })

  it('rollout multi-turn lookahead solves a delayed-payoff puzzle that 1-turn search/greedy lose', () => {
    const setup: MxDeckCardSpec = {
      ...makeScriptCard(
        'setup',
        'Demon Ritual',
        2,
        'kw innate, power; turn_start: str 15',
        'rare',
        1
      ),
      priority: 1
    }
    const poke: MxDeckCardSpec = {
      ...makeScriptCard('poke', 'Quick Poke', 2, 'kw innate, exhaust; dmg 12', 'common', 1),
      priority: 10
    }
    const twin: MxDeckCardSpec = {
      ...makeScriptCard('twin', 'Twin Hit', 1, 'dmg 3x2', 'common', 4),
      priority: 5
    }
    const boss: MxEnemySpec = {
      id: 'doomsday',
      name: 'Doomsday Clock',
      hp: 65,
      pattern: 'cycle',
      intents: [
        { name: 'Tick 1', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 },
        { name: 'Tick 2', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 },
        { name: 'Execute', damage: 999, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    }
    const base = {
      deck: [setup, poke, twin],
      enemies: [boss],
      playerHp: 50,
      energyPerTurn: 2,
      drawPerTurn: 2,
      maxTurns: 3
    }
    // greedy 与 1-turn search 在 T1 都会打即时 12 伤的 Quick Poke，导致 T3 伤害不够被处决
    const greedyRes = runMxSingleBattle({ ...base, policy: 'greedy' }, createMxRng(11))
    const searchRes = runMxSingleBattle({ ...base, policy: 'search' }, createMxRng(11))
    const rolloutRes = runMxSingleBattle({ ...base, policy: 'rollout' }, createMxRng(11))
    expect(greedyRes.won).toBe(false)
    expect(searchRes.won).toBe(false)
    expect(rolloutRes.won).toBe(true)
  })

  it('mxScaleTierEnemies isolates shared enemies across tiers; dual-objective solver tunes HP and damage', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    // 让 cultist 同时出现在 normal 与 elite 遭遇中
    lab.encounters = [
      ...lab.encounters,
      {
        id: 'e_cultist_pair',
        name: 'Elite Cultists',
        tier: 'elite',
        enemyIds: ['cultist', 'gremlin_nob']
      }
    ]
    const scaled = mxScaleTierEnemies(lab, 'elite', { hp: 2, dmg: 1.5, isolate: true })
    // 原 cultist 保持 50 血不变，normal 遭遇仍引用原 cultist
    expect(scaled.enemies.find((e) => e.id === 'cultist')!.hp).toBe(50)
    expect(scaled.encounters.find((e) => e.id === 'n_cultist')!.enemyIds).toEqual(['cultist'])
    // elite 遭遇自动切换到专属副本 cultist__elite（100 血）
    expect(scaled.clonedIds).toContain('cultist__elite')
    expect(scaled.enemies.find((e) => e.id === 'cultist__elite')!.hp).toBe(100)
    expect(scaled.encounters.find((e) => e.id === 'e_cultist_pair')!.enemyIds).toContain(
      'cultist__elite'
    )

    // 双目标反解：同时约束通关率与层级战损 %
    lab.economy = { ...lab.economy, floors: 8 }
    const dual = solveMxTierHpForClearRate(wb, lab, {
      tier: 'boss',
      targetClearRatePct: 50,
      targetTierHpLossPct: 35,
      runs: 20,
      iterations: 4
    })
    expect(dual.targetTierHpLossPct).toBe(35)
    expect(dual.scale).toBeGreaterThan(0)
    expect(dual.dmgScale).toBeGreaterThan(0)
    expect(dual.labPatch.enemies.length).toBeGreaterThanOrEqual(lab.enemies.length)
  })

  it('ATB effect engine parses scripts, models enemy counter-attacks/deaths, and delegates action_bar kernel', () => {
    const parsed = parseMxAtbScript('伤害 1.5x2 @all; 拉条 25; 治疗 20% @ally_lowest; 眩晕 50%') // cjk-ok
    expect(parsed.errors).toEqual([])
    expect(parsed.ops.map((o) => o.op)).toEqual(['dmg', 'pull', 'heal', 'stun'])
    expect(mxScaleAtbScript('dmg 2.5x2 @all; heal 20%', 1.2)).toBe('dmg 3x2 @all; heal 24%')

    // 脆皮队友（100 血）面对高攻敌人（5000 攻）：无控制必死，100% 眩晕控制可 0 阵亡获胜
    const mkUnits = (stunScript: string) => [
      {
        id: 'ctrl',
        name: 'Controller',
        team: 'ally' as const,
        speed: 240,
        attack: 3000,
        critDamageMult: 1.5,
        skillRatio: 2,
        orbCost: 0,
        pullGaugePct: 0,
        pushGaugePct: 0,
        orbGain: 0,
        hp: 100,
        skillScript: stunScript
      },
      {
        id: 'boss',
        name: 'Boss',
        team: 'enemy' as const,
        speed: 180,
        attack: 5000,
        critDamageMult: 1.5,
        skillRatio: 2,
        orbCost: 0,
        pullGaugePct: 0,
        pushGaugePct: 0,
        orbGain: 0,
        hp: 6000,
        skillScript: 'dmg 2'
      }
    ]
    const baseAtb = {
      trackDistance: 1000,
      maxActions: 12,
      initialOrbs: 4,
      maxOrbs: 8,
      orbRecoveryPer5Actions: 3,
      defaultAllyHp: 100,
      defaultAllyDef: 0,
      defaultEnemyHp: 6000,
      defaultEnemyDef: 0
    }
    const noStun = runMxAtbBattle({ ...baseAtb, units: mkUnits('dmg 1') }, createMxRng(1))
    const withStun = runMxAtbBattle(
      { ...baseAtb, units: mkUnits('dmg 1.5; stun 100%') },
      createMxRng(1)
    )
    expect(noStun.allyDeaths).toBe(1)
    expect(noStun.won).toBe(false)
    expect(withStun.allyDeaths).toBe(0)
    expect(withStun.won).toBe(true)

    const wb = createMxWorkbenchPreset('onmyoji_atb')
    expect(mxShouldUseAtbEngine(wb.combatKernel)).toBe(false)
    const delegated = runMxCombatKernelSimulation({
      ...wb.combatKernel,
      runs: 40,
      useEffectEngine: true
    })
    expect(delegated.kernel).toBe('action_bar')
    expect(delegated.actionTimeline!.length).toBeGreaterThan(0)
    expect(delegated.speedTuneAdvisory).toContain('ATB engine')
  })

  it('high-order DSL primitives (discover, tutor, revive, discount, buff) and expr custom formula escape hatch work in combat', () => {
    const parsed = parseMxCardEffectScript(
      'discover 3 -1; tutor 1; revive 1; discount 2 @all; buff 2/3; expr dmg=block+str*2 @all'
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.clauses.map((c) => c.effect.op)).toEqual([
      'discover',
      'tutor',
      'revive',
      'discount',
      'buff_board',
      'expr'
    ])
    const badExpr = parseMxCardEffectScript('expr dmg=10+')
    expect(badExpr.errors.length).toBeGreaterThan(0)

    // 1) Body Slam (expr dmg=block) + Reaper-style heal (expr heal=missing_hp*0.5)
    const blockCard = makeScriptCard('blk', 'Fortify', 1, 'blk 20', 'common', 1)
    const slamCard = makeScriptCard(
      'slam',
      'Body Slam',
      1,
      'expr dmg=block; expr heal=missing_hp*0.5',
      'rare',
      1
    )
    const dummy: MxEnemySpec = {
      id: 'dummy',
      name: 'Dummy',
      hp: 20,
      pattern: 'cycle',
      intents: [
        { name: 'Hit 10', damage: 10, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    }
    const slamBattle = runMxSingleBattle(
      {
        deck: [blockCard, slamCard],
        enemies: [dummy],
        playerHp: 50,
        playerMaxHp: 80,
        energyPerTurn: 2,
        drawPerTurn: 2,
        maxTurns: 2,
        policy: 'search'
      },
      createMxRng(7)
    )
    expect(slamBattle.won).toBe(true)
    expect(slamBattle.turns).toBe(1)
    // missing_hp = 30 -> heal 15 -> 65 HP
    expect(slamBattle.hpLeft).toBe(65)

    // 2) Summon charge minion (T1) -> enemy clears board -> revive resurrects dead minion + buff 2/2 boosts board (T2)
    const footman = makeScriptCard(
      'footman',
      'Footman',
      1,
      'summon 3/2 charge; kw innate, exhaust',
      'common',
      1
    )
    const rezAndBuff = makeScriptCard(
      'rez',
      'Resurrect & Rally',
      1,
      'revive 1; buff 2/2; kw exhaust',
      'rare',
      1
    )
    const cleaver: MxEnemySpec = {
      id: 'cleaver',
      name: 'Cleaver',
      hp: 10,
      pattern: 'cycle',
      intents: [
        {
          name: 'Clear 5',
          damage: 0,
          hits: 1,
          block: 0,
          strengthGain: 0,
          addStatusCards: 0,
          clearBoard: 5
        },
        { name: 'Wait', damage: 0, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    }
    const rezBattle = runMxSingleBattle(
      {
        deck: [footman, rezAndBuff],
        enemies: [cleaver],
        playerHp: 60,
        energyPerTurn: 1,
        drawPerTurn: 1,
        maxTurns: 3,
        policy: 'greedy'
      },
      createMxRng(3)
    )
    expect(rezBattle.won).toBe(true)

    // 3) tutor + discount lets player draw and play an expensive finisher on turn 1
    const filler = makeScriptCard('poke', 'Poke', 1, 'dmg 1', 'common', 4)
    const tutorDiscount = makeScriptCard(
      'tutor',
      'Seek & Discount',
      0,
      'tutor 1; discount 3 @all; kw innate, exhaust',
      'rare',
      1
    )
    const meteor = makeScriptCard('meteor', 'Meteor', 3, 'dmg 40', 'rare', 1)
    const boss35: MxEnemySpec = {
      id: 'b35',
      name: 'Boss 35',
      hp: 35,
      pattern: 'cycle',
      intents: [{ name: 'Smack', damage: 5, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }]
    }
    const tutorBattle = runMxSingleBattle(
      {
        deck: [filler, tutorDiscount, meteor],
        enemies: [boss35],
        playerHp: 50,
        energyPerTurn: 1,
        drawPerTurn: 2,
        maxTurns: 1,
        policy: 'search'
      },
      createMxRng(5)
    )
    expect(tutorBattle.won).toBe(true)
  })

  it('branching map, random events, and potions work in simulateMxRunEconomyLoop', () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.economy = {
      ...lab.economy,
      floors: 12,
      runs: 30,
      branchingMap: true,
      eventRatePct: 45,
      potionSlots: 2,
      potionDropRatePct: 100
    }
    const res = simulateMxRunEconomyLoop(wb, lab, createMxRng(19))
    expect(res.avgEventsVisited).toBeGreaterThan(0)
    expect(res.avgPotionsUsed).toBeGreaterThan(0)
    expect(res.avgElitesAvoided).toBeGreaterThanOrEqual(0)
    expect(res.floorRows.length).toBe(12)
  })

  it('cardLabCompute client runs economy, solveHp, marginal, and rebalance end-to-end', async () => {
    const wb = createMxWorkbenchPreset('slay_the_spire_dbg')
    const lab = createDefaultMxCardDesignLab(wb)
    lab.economy = { ...lab.economy, floors: 8, runs: 16 }

    const eco = await cardLabCompute.economy(wb, lab)
    expect(eco.floorRows.length).toBe(8)
    expect(eco.avgPotionsUsed).toBeGreaterThanOrEqual(0)

    const solved = await cardLabCompute.solveHp(wb, lab, {
      tier: 'boss',
      targetClearRatePct: 50,
      runs: 16,
      iterations: 4
    })
    expect(solved.scale).toBeGreaterThan(0)

    const marginal = await cardLabCompute.marginal(wb, lab, { runs: 12 })
    expect(marginal.poolRows.length).toBe(lab.cardPool.length)

    const targetCard = lab.cardPool[0]!
    const rebalanced = await cardLabCompute.rebalance(wb, lab, targetCard, {
      targetValuePerCost: marginal.medianPoolValuePerCost,
      runs: 12,
      iterations: 4
    })
    expect(rebalanced.cardId).toBe(targetCard.id)
    expect(rebalanced.scaleFactor).toBeGreaterThan(0)
  })
})
