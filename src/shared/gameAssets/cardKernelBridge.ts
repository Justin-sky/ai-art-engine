/**
 * 工作台「① 战斗调度内核 · 牌库洗抽 (deck_cycle)」与卡牌效果引擎的桥接层：
 * 当牌库中任意卡牌填写了效果脚本（或显式开启 useEffectEngine）时，
 * 工作台原有的战斗模拟、逆向求解、敏感度龙卷风、单卡遥测、战报等全部改由效果引擎驱动，
 * 并把旧内核的敌人参数（血量/基础伤害/成长/6 种机制）与遗物预设映射为效果引擎的敌人意图表与遗物表。
 */
import { createMxRng } from './machinationsV2'
import {
  mxEstimateCardValue,
  mxResolveCardEffects,
  runMxSingleBattle,
  type MxBattleInput,
  type MxEnemyIntent,
  type MxEnemySpec,
  type MxPlayPolicy,
  type MxRelicSpec
} from './cardEffectEngine'
import type {
  MxCardTelemetryItem,
  MxCombatKernelConfig,
  MxCombatKernelResult,
  MxCombatTurnReplayItem,
  MxDeckCardSpec,
  MxManaCurveCardSpec,
  MxTurnMetricPoint
} from './gameNumericalWorkbench'

/** 判断 deck_cycle 内核是否应改由效果引擎驱动 */
export function mxShouldUseEffectEngine(cfg: MxCombatKernelConfig): boolean {
  return Boolean(cfg.useEffectEngine) || cfg.deckCards.some((c) => Boolean(c.effectScript?.trim()))
}

/** 把旧内核的敌人参数映射为逐回合意图表（完整复刻旧内核的伤害时间表与机制检定） */
export function mxLegacyKernelToEnemies(cfg: MxCombatKernelConfig): MxEnemySpec[] {
  const maxTurns = Math.max(3, Math.min(40, Math.round(cfg.maxTurns || 12)))
  const mech = cfg.enemyMechanism ?? 'standard'
  const base = cfg.enemyBaseDamage || 12
  const growth = cfg.enemyDamageGrowth || 2
  const statusPerTurn = Math.max(1, Math.min(5, Math.round(cfg.statusCardsPerTurn ?? 2)))
  const swarm = mech === 'aoe_swarm'
  const intents: MxEnemyIntent[] = []
  for (let t = 1; t <= maxTurns; t++) {
    const berserk = mech === 'berserk_race' && t >= 4 ? (t - 3) * Math.max(4, growth * 2.5) : 0
    const raw = base + (t - 1) * growth + berserk + (swarm ? 4 : 0)
    intents.push({
      name: `Atk T${t}`,
      damage: Math.round(swarm ? raw / 3 : raw),
      hits: 1,
      block: mech === 'thorns_armor' ? 10 : 0,
      strengthGain: 0,
      addStatusCards: mech === 'status_polluter' ? statusPerTurn : 0,
      statusCardKind: 'wound'
    })
  }
  const hp = Math.max(1, cfg.enemyHp || 60)
  const thorns =
    mech === 'thorns_armor' ? Math.max(1, Math.min(20, Math.round(cfg.enemyThornsDamage ?? 2))) : 0
  if (swarm) {
    return [0, 1, 2].map((i) => ({
      id: `swarm_${i}`,
      name: `Swarm ${i + 1}`,
      hp: Math.max(1, Math.round(hp / 3)),
      pattern: 'cycle' as const,
      thorns,
      intents
    }))
  }
  return [{ id: 'kernel_enemy', name: 'Enemy', hp, pattern: 'cycle', thorns, intents }]
}

/** 把旧内核的遗物预设映射为效果引擎遗物 */
export function mxLegacyRelicPresetToRelics(cfg: MxCombatKernelConfig): MxRelicSpec[] {
  const p = cfg.relicTriggerPreset ?? 'none'
  const all = p === 'all_synergy'
  const out: MxRelicSpec[] = []
  if (all || p === 'shuriken_kunai') {
    out.push({
      id: 'shuriken_kunai',
      name: 'Shuriken/Kunai',
      trigger: 'every_n_attacks',
      n: 3,
      script: 'str 1; blk 4'
    })
  }
  if (all || p === 'necronomicon') {
    out.push({
      id: 'necronomicon',
      name: 'Necronomicon',
      trigger: 'first_attack_cost_gte',
      n: 2,
      script: 'replay'
    })
  }
  if (all || p === 'dead_branch') {
    out.push({
      id: 'dead_branch',
      name: 'Dead Branch',
      trigger: 'on_exhaust',
      script: 'generate 1'
    })
  }
  return out
}

function pctl(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]!
}

const r1 = (n: number): number => Math.round(n * 10) / 10

function directDmgBlkValue(card: MxDeckCardSpec): number {
  let v = 0
  for (const cl of mxResolveCardEffects(card).clauses) {
    if (cl.trigger !== 'on_play') continue
    if (cl.effect.op === 'damage') v += cl.effect.amount * cl.effect.hits
    else if (cl.effect.op === 'block') v += cl.effect.amount * 0.9
  }
  return v
}

/**
 * 以效果引擎运行 deck_cycle 内核，返回与旧内核完全相同的结果结构
 * （胜率 / TTK 分位 / 战损 / 能量利用率 / 洗牌周期 / 逐回合包络 / 战报 / 单卡遥测）。
 */
export function runMxDeckCycleKernelViaEffectEngine(
  cfg: MxCombatKernelConfig
): MxCombatKernelResult {
  const runs = Math.max(10, Math.min(2000, Math.round(cfg.runs || 200)))
  const maxTurns = Math.max(3, Math.min(40, Math.round(cfg.maxTurns || 12)))
  const baseSeed = cfg.seed || 2026
  const deck = cfg.deckCards.filter((c) => c.count > 0)
  const policy: MxPlayPolicy = cfg.playPolicy ?? 'greedy'
  const input: MxBattleInput = {
    deck,
    enemies: mxLegacyKernelToEnemies(cfg),
    relics: mxLegacyRelicPresetToRelics(cfg),
    playerHp: cfg.playerHp || 80,
    energyPerTurn: cfg.energyPerTurn || 3,
    drawPerTurn: cfg.drawPerTurn || 5,
    maxTurns,
    policy,
    playLimit:
      cfg.enemyMechanism === 'card_limit_punisher'
        ? Math.max(2, Math.min(15, Math.round(cfg.cardPlayLimitPerTurn ?? 5)))
        : undefined,
    playPunish: cfg.enemyMechanism === 'card_limit_punisher' ? 1 : undefined
  }

  const ttkList: number[] = []
  const hpLost: number[] = []
  const dmgByTurn: number[][] = Array.from({ length: maxTurns }, () => [])
  const blkByTurn: number[][] = Array.from({ length: maxTurns }, () => [])
  const wonByRun: boolean[] = []
  let wins = 0
  let eSpent = 0
  let eAvail = 0
  let shuffles = 0
  let turnsPlayed = 0
  let replay: MxCombatTurnReplayItem[] = []
  interface Trk {
    plays: number
    stranded: number
    value: number
    playsByRun: number[]
  }
  const trk = new Map<string, Trk>()
  for (const c of deck) trk.set(c.id, { plays: 0, stranded: 0, value: 0, playsByRun: [] })

  for (let r = 0; r < runs; r++) {
    const res = runMxSingleBattle(input, createMxRng(baseSeed + (r + 1) * 7919), r === 0)
    if (res.won) wins++
    wonByRun.push(res.won)
    ttkList.push(res.won ? res.turns : maxTurns + 1)
    hpLost.push(res.hpLoss)
    eSpent += res.energySpent
    eAvail += res.energyAvailable
    shuffles += res.shuffles
    turnsPlayed += res.turns
    for (let t = 0; t < maxTurns; t++) {
      dmgByTurn[t]!.push(res.turnDamage[t] ?? 0)
      blkByTurn[t]!.push(res.turnBlock[t] ?? 0)
    }
    for (const c of deck) {
      const st = res.stats.get(c.id)
      const tk = trk.get(c.id)!
      const plays = st?.played ?? 0
      tk.plays += plays
      tk.stranded += st?.stranded ?? 0
      tk.playsByRun.push(plays)
      const utility = Math.max(0, mxEstimateCardValue(c) - directDmgBlkValue(c))
      tk.value += (st?.damage ?? 0) + (st?.block ?? 0) + plays * utility
    }
    if (r === 0) {
      replay = res.replay.map((t) => ({
        turn: t.turn,
        cardsPlayed: t.cardsPlayed,
        energyUsed: t.energyUsed,
        damageDealt: t.damageDealt,
        blockGained: t.blockGained,
        relicsTriggered: t.relicsTriggered,
        enemyAction: t.enemyActions.join(', ') || (t.enemyHpAfter <= 0 ? 'DEFEATED' : '-'),
        playerHpAfter: t.playerHpAfter,
        enemyHpAfter: t.enemyHpAfter
      }))
    }
  }

  const sortedTtk = [...ttkList].sort((a, b) => a - b)
  const turnSeries: MxTurnMetricPoint[] = Array.from({ length: maxTurns }, (_, i) => {
    const d = [...dmgByTurn[i]!].sort((a, b) => a - b)
    const b = blkByTurn[i]!
    return {
      turn: i + 1,
      primaryP10: pctl(d, 0.1),
      primaryP50: pctl(d, 0.5),
      primaryP90: pctl(d, 0.9),
      secondaryMean: b.length ? r1(b.reduce((x, y) => x + y, 0) / b.length) : 0,
      ratePct: r1((ttkList.filter((tk) => tk <= i + 1).length / runs) * 100)
    }
  })

  const totalValue = [...trk.values()].reduce((a, t) => a + t.value, 0) || 1
  const overallWin = (wins / runs) * 100
  const cardTelemetry: MxCardTelemetryItem[] = deck.map((c) => {
    const t = trk.get(c.id)!
    const avgPlaysPerRun = Math.round((t.plays / runs) * 100) / 100
    const opps = t.plays + t.stranded
    const strandedInHandPct = opps > 0 ? r1((t.stranded / opps) * 100) : 0
    const outputSharePct = r1((t.value / totalValue) * 100)
    let hi = 0
    let hiW = 0
    let lo = 0
    let loW = 0
    const split = Math.max(1, avgPlaysPerRun)
    t.playsByRun.forEach((p, ri) => {
      if (p >= split) {
        hi++
        if (wonByRun[ri]) hiW++
      } else {
        lo++
        if (wonByRun[ri]) loW++
      }
    })
    const playedWinDeltaPct =
      hi >= 3 && lo >= 3
        ? r1((hiW / hi - loW / lo) * 100)
        : r1(
            (outputSharePct - 100 / Math.max(1, deck.length)) * 0.45 -
              strandedInHandPct * 0.14 +
              (overallWin > 50 ? 2 : -1)
          )
    const grade: MxCardTelemetryItem['grade'] =
      strandedInHandPct >= 52 || (avgPlaysPerRun < 0.45 && outputSharePct < 6)
        ? 'C_brick_trap'
        : outputSharePct >= 26 || (playedWinDeltaPct >= 8 && strandedInHandPct < 32)
          ? 'S_must_pick'
          : outputSharePct >= 14 || playedWinDeltaPct >= 2
            ? 'A_core'
            : 'B_filler'
    return {
      id: c.id,
      name: c.name,
      cost: c.cost,
      count: c.count,
      avgPlaysPerRun,
      outputSharePct,
      strandedInHandPct,
      playedWinDeltaPct,
      grade
    }
  })

  return {
    kernel: 'deck_cycle',
    runs,
    winRatePct: r1((wins / runs) * 100),
    ttkP10: pctl(sortedTtk, 0.1),
    ttkP50: pctl(sortedTtk, 0.5),
    ttkP90: pctl(sortedTtk, 0.9),
    ttkMean: r1(ttkList.reduce((a, b) => a + b, 0) / runs),
    kpi1Label: 'Avg HP Lost',
    kpi1Value: r1(hpLost.reduce((a, b) => a + b, 0) / runs),
    kpi2Label: 'Energy Util %',
    kpi2Value: eAvail > 0 ? r1((eSpent / eAvail) * 100) : 0,
    kpi3Label: 'Deck Cycle Turns',
    kpi3Value: shuffles > 0 ? r1(turnsPlayed / shuffles) : maxTurns,
    turnSeries,
    battleReplayLog: replay,
    cardTelemetry
  }
}

// ───────────────────────── mana_tempo（炉石式法力曲线）桥接 ─────────────────────────

/** 判断 mana_tempo 内核是否应改由效果引擎驱动 */
export function mxShouldUseEffectEngineForMana(cfg: MxCombatKernelConfig): boolean {
  return (
    Boolean(cfg.useEffectEngine) ||
    (cfg.manaCurveDeck ?? []).some((c) => Boolean(c.effectScript?.trim()))
  )
}

/** 把法力卡组的攻/血/直伤/抽牌列转换为效果脚本（已有 effectScript 时原样使用） */
export function mxManaCardToScript(card: MxManaCurveCardSpec): string {
  if (card.effectScript?.trim()) return card.effectScript.trim()
  const parts: string[] = []
  if (card.kind === 'minion' && (card.attack > 0 || card.health > 0)) {
    const kws = [card.taunt ? 'taunt' : '', card.divineShield ? 'divine' : ''].filter(Boolean)
    parts.push(
      `summon ${Math.max(0, card.attack)}/${Math.max(1, card.health)}${kws.length ? ' ' + kws.join(' ') : ''}`
    )
  }
  if (card.directDamage > 0) parts.push(`dmg ${card.directDamage}`)
  if (card.drawCards > 0) parts.push(`draw ${card.drawCards}`)
  return parts.join('; ')
}

/** 法力卡 → 效果引擎卡牌（费用=法力，脚本按上方规则生成） */
export function mxManaCardToDeckCard(card: MxManaCurveCardSpec): MxDeckCardSpec {
  return {
    id: card.id,
    name: card.name,
    cost: Math.max(0, card.manaCost),
    count: Math.max(0, Math.min(10, Math.round(card.count))),
    damage: 0,
    block: 0,
    draw: 0,
    energyGain: 0,
    applyStrength: 0,
    applyVulnerable: 0,
    applyWeak: 0,
    exhaust: false,
    priority: 0,
    effectScript: mxManaCardToScript(card) || 'kw unplayable'
  }
}

/**
 * 把旧内核的「对手解场」参数映射为逐回合意图：第 t 回合解场 clearPower×ceil(0.6t)，
 * 对手不打脸（与旧内核一致：只比拼己方抢血速度与场面存活）。
 */
export function mxLegacyManaOpponent(cfg: MxCombatKernelConfig, maxTurns: number): MxEnemySpec {
  const clear = Math.max(0, cfg.opponentClearPowerPerTurn || 2)
  const intents: MxEnemyIntent[] = []
  for (let t = 1; t <= maxTurns; t++) {
    intents.push({
      name: `Clear ${Math.round(clear * Math.ceil(t * 0.6))}`,
      damage: 0,
      hits: 1,
      block: 0,
      strengthGain: 0,
      addStatusCards: 0,
      clearBoard: Math.round(clear * Math.ceil(t * 0.6))
    })
  }
  return {
    id: 'mana_opponent',
    name: 'Opponent',
    hp: Math.max(1, cfg.opponentHp || 30),
    pattern: 'cycle',
    intents
  }
}

/**
 * 以效果引擎运行 mana_tempo 内核：法力水晶 1→上限逐回合成长、手牌保留、起手调度、
 * 随从（嘲讽/圣盾/冲锋/吸血/亡语）真实上场与解场交换；返回与旧内核相同的 KPI 结构
 * （按费拍怪率 / 水晶浪费率 / 第 5 回合场面攻血和）。
 */
export function runMxManaTempoKernelViaEffectEngine(
  cfg: MxCombatKernelConfig
): MxCombatKernelResult {
  const runs = Math.max(10, Math.min(2000, Math.round(cfg.runs || 200)))
  const maxTurns = Math.max(3, Math.min(40, Math.round(cfg.maxTurns || 12)))
  const baseSeed = cfg.seed || 2026
  const maxCrystals = Math.max(1, Math.min(20, Math.round(cfg.maxManaCrystals || 10)))
  const manaDeck = (cfg.manaCurveDeck ?? []).filter((c) => c.count > 0)
  const deck = manaDeck.map(mxManaCardToDeckCard)
  if (!deck.length) {
    deck.push(
      mxManaCardToDeckCard({
        id: 'croc',
        name: 'River Crocolisk',
        manaCost: 2,
        count: 10,
        kind: 'minion',
        attack: 2,
        health: 3,
        directDamage: 0,
        drawCards: 0
      })
    )
  }
  const input: MxBattleInput = {
    deck,
    enemies: [mxLegacyManaOpponent(cfg, maxTurns)],
    playerHp: 30,
    energyPerTurn: 1,
    drawPerTurn: 1,
    maxTurns,
    policy: cfg.playPolicy ?? 'greedy',
    energyRamp: { start: 1, max: maxCrystals },
    keepHand: true,
    fatigue: true,
    openingHand: Math.max(1, Math.min(6, Math.round(cfg.startingHandSize || 3))),
    mulliganMaxCost: Math.max(1, Math.round(cfg.mulliganMaxCost || 3))
  }

  const ttkList: number[] = []
  const wonByRun: boolean[] = []
  const boardByTurn: number[][] = Array.from({ length: maxTurns }, () => [])
  const curveOutByTurn: number[] = new Array<number>(maxTurns).fill(0)
  let wins = 0
  let turnChecks = 0
  let curveOuts = 0
  let manaAvail = 0
  let manaFloat = 0
  let replay: MxCombatTurnReplayItem[] = []
  const trk = new Map<
    string,
    { plays: number; stranded: number; value: number; playsByRun: number[] }
  >()
  for (const c of deck) trk.set(c.id, { plays: 0, stranded: 0, value: 0, playsByRun: [] })

  for (let r = 0; r < runs; r++) {
    const res = runMxSingleBattle(input, createMxRng(baseSeed + (r + 1) * 7919), r === 0)
    if (res.won) wins++
    wonByRun.push(res.won)
    ttkList.push(res.won ? res.turns : maxTurns + 1)
    for (let t = 0; t < res.energyAvailByTurn.length; t++) {
      const avail = res.energyAvailByTurn[t] ?? 0
      const left = res.energyLeftByTurn[t] ?? 0
      turnChecks++
      manaAvail += avail
      manaFloat += left
      if (left === 0) {
        curveOuts++
        curveOutByTurn[t] = (curveOutByTurn[t] ?? 0) + 1
      }
      if (t < maxTurns) boardByTurn[t]!.push(res.boardStatsByTurn[t] ?? 0)
    }
    for (const c of deck) {
      const st = res.stats.get(c.id)
      const tk = trk.get(c.id)!
      const plays = st?.played ?? 0
      tk.plays += plays
      tk.stranded += st?.stranded ?? 0
      tk.playsByRun.push(plays)
      tk.value +=
        (st?.damage ?? 0) + plays * Math.max(0, mxEstimateCardValue(c) - directDmgBlkValue(c))
    }
    if (r === 0) {
      replay = res.replay.map((t) => ({
        turn: t.turn,
        cardsPlayed: t.cardsPlayed,
        energyUsed: t.energyUsed,
        damageDealt: t.damageDealt,
        blockGained: res.boardStatsByTurn[t.turn - 1] ?? 0,
        relicsTriggered:
          (res.energyLeftByTurn[t.turn - 1] ?? 1) === 0 ? ['Curve-Out(100% Mana)'] : [],
        enemyAction:
          t.enemyHpAfter <= 0
            ? 'LETHAL (Opponent Slain)'
            : `${t.enemyActions.join(', ') || '-'} -> ${t.boardAlive ?? 0} Minions Alive`,
        playerHpAfter: t.boardAlive ?? 0,
        enemyHpAfter: t.enemyHpAfter
      }))
    }
  }

  const sortedTtk = [...ttkList].sort((a, b) => a - b)
  const t5 = boardByTurn[Math.min(4, maxTurns - 1)] ?? []
  const turnSeries: MxTurnMetricPoint[] = Array.from({ length: maxTurns }, (_, i) => {
    const s = [...boardByTurn[i]!].sort((a, b) => a - b)
    const rate = r1(((curveOutByTurn[i] ?? 0) / runs) * 100)
    return {
      turn: i + 1,
      primaryP10: pctl(s, 0.1),
      primaryP50: pctl(s, 0.5),
      primaryP90: pctl(s, 0.9),
      secondaryMean: rate,
      ratePct: rate
    }
  })

  return {
    kernel: 'mana_tempo',
    runs,
    winRatePct: r1((wins / runs) * 100),
    ttkP10: pctl(sortedTtk, 0.1),
    ttkP50: pctl(sortedTtk, 0.5),
    ttkP90: pctl(sortedTtk, 0.9),
    ttkMean: r1(ttkList.reduce((a, b) => a + b, 0) / runs),
    kpi1Label: 'Curve-Out Rate %',
    kpi1Value: turnChecks > 0 ? r1((curveOuts / turnChecks) * 100) : 0,
    kpi2Label: 'Mana Float %',
    kpi2Value: manaAvail > 0 ? r1((manaFloat / manaAvail) * 100) : 0,
    kpi3Label: 'Turn 5 Board Stats',
    kpi3Value: t5.length ? r1(t5.reduce((a, b) => a + b, 0) / t5.length) : 0,
    turnSeries,
    battleReplayLog: replay,
    cardTelemetry: gradeTelemetry(
      deck.map((c) => ({ id: c.id, name: c.name, cost: c.cost, count: c.count })),
      trk,
      wonByRun,
      runs
    )
  }
}

function gradeTelemetry(
  rows: Array<{ id: string; name: string; cost: number; count: number }>,
  trk: Map<string, { plays: number; stranded: number; value: number; playsByRun: number[] }>,
  wonByRun: boolean[],
  runs: number
): MxCardTelemetryItem[] {
  const totalValue = [...trk.values()].reduce((a, t) => a + t.value, 0) || 1
  const overallWin = (wonByRun.filter(Boolean).length / Math.max(1, runs)) * 100
  return rows.map((c) => {
    const t = trk.get(c.id) ?? { plays: 0, stranded: 0, value: 0, playsByRun: [] }
    const avgPlaysPerRun = Math.round((t.plays / runs) * 100) / 100
    const opps = t.plays + t.stranded
    const strandedInHandPct = opps > 0 ? r1((t.stranded / opps) * 100) : 0
    const outputSharePct = r1((t.value / totalValue) * 100)
    let hi = 0
    let hiW = 0
    let lo = 0
    let loW = 0
    const split = Math.max(1, avgPlaysPerRun)
    t.playsByRun.forEach((p, ri) => {
      if (p >= split) {
        hi++
        if (wonByRun[ri]) hiW++
      } else {
        lo++
        if (wonByRun[ri]) loW++
      }
    })
    const playedWinDeltaPct =
      hi >= 3 && lo >= 3
        ? r1((hiW / hi - loW / lo) * 100)
        : r1(
            (outputSharePct - 100 / Math.max(1, rows.length)) * 0.45 -
              strandedInHandPct * 0.14 +
              (overallWin > 50 ? 2 : -1)
          )
    const grade: MxCardTelemetryItem['grade'] =
      strandedInHandPct >= 52 || (avgPlaysPerRun < 0.45 && outputSharePct < 6)
        ? 'C_brick_trap'
        : outputSharePct >= 26 || (playedWinDeltaPct >= 8 && strandedInHandPct < 32)
          ? 'S_must_pick'
          : outputSharePct >= 14 || playedWinDeltaPct >= 2
            ? 'A_core'
            : 'B_filler'
    return { ...c, avgPlaysPerRun, outputSharePct, strandedInHandPct, playedWinDeltaPct, grade }
  })
}
