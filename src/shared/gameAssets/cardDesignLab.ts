/**
 * 卡牌数值设计实验室（Card Design Lab）：
 * - 可编辑的敌人 / 意图 / 遭遇 / 遗物 / 卡池表（默认提供一套可运行的基准数据）
 * - 「金币 → 卡牌奖励/商店 → 删卡 → 篝火 → 卡组」的单局经济闭环蒙特卡洛
 * - 试玩日志（CSV）导入与模型校准（对比预测 vs 实测，二分反推敌方血量缩放系数）
 */
import { createMxRng } from './machinationsV2'
import {
  makeScriptCard,
  mxCardValuePerCost,
  mxLegacyCardToScript,
  mxScaleCardSpec,
  mxUpgradeCardSpec,
  runMxBattleEngineSimulation,
  runMxSingleBattle,
  type MxBattleSimResult,
  type MxEncounterSpec,
  type MxEnemySpec,
  type MxPlayPolicy,
  type MxRelicSpec
} from './cardEffectEngine'
import type { MxDeckCardSpec, MxNumericalWorkbench } from './gameNumericalWorkbench'

export interface MxRunEconomyConfig {
  floors: number
  runs: number
  seed: number
  startGold: number
  goldPerNormal: number
  goldPerElite: number
  cardRewardChoices: number
  rarityWeights: { common: number; uncommon: number; rare: number }
  /** 每层稀有卡权重增量 */
  rareWeightGrowthPerFloor: number
  shopEveryNFloors: number
  cardPrice: { common: number; uncommon: number; rare: number }
  removePrice: number
  removePriceGrowth: number
  restEveryNFloors: number
  restHealPct: number
  eliteEveryNFloors: number
  enemyHpGrowthPerFloor: number
  enemyDmgGrowthPerFloor: number
  policy: MxPlayPolicy
  /**
   * 选卡方式：formula = 按线性估值/费用比较；simulated = 对每个候选（含跳过）
   * 用共同随机数各跑 pickSimRuns 场下一类战斗，按「胜场剩余血量」实测择优（更慢但不被估值公式误导）
   */
  pickMode?: 'formula' | 'simulated'
  pickSimRuns?: number
  /** 分叉地图选路：开启后每层生成 2~3 条候选分支，AI 按实时血量/金币动态避险或冲精英 */
  branchingMap?: boolean
  /** 分叉地图中问号随机事件分支出现概率 (%) */
  eventRatePct?: number
  /** 药水栏槽位数（0 = 关闭药水） */
  potionSlots?: number
  /** 战斗胜利掉落药水概率 (%) */
  potionDropRatePct?: number
}

export interface MxCardDesignLabConfig {
  playerHp: number
  maxTurns: number
  policy: MxPlayPolicy
  battleRuns: number
  selectedEncounterId: string
  enemies: MxEnemySpec[]
  encounters: MxEncounterSpec[]
  relics: MxRelicSpec[]
  activeRelicIds: string[]
  cardPool: MxDeckCardSpec[]
  economy: MxRunEconomyConfig
}

export function createDefaultMxEnemies(): MxEnemySpec[] {
  return [
    {
      id: 'cultist',
      name: 'Cultist',
      hp: 50,
      pattern: 'cycle',
      intents: [
        { name: 'Incantation', damage: 0, hits: 1, block: 0, strengthGain: 3, addStatusCards: 0 },
        { name: 'Dark Strike', damage: 6, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 },
        { name: 'Dark Strike', damage: 6, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    },
    {
      id: 'jaw_worm',
      name: 'Jaw Worm',
      hp: 42,
      pattern: 'random',
      intents: [
        {
          name: 'Chomp',
          damage: 11,
          hits: 1,
          block: 0,
          strengthGain: 0,
          addStatusCards: 0,
          weight: 45
        },
        {
          name: 'Thrash',
          damage: 7,
          hits: 1,
          block: 5,
          strengthGain: 0,
          addStatusCards: 0,
          weight: 30
        },
        {
          name: 'Bellow',
          damage: 0,
          hits: 1,
          block: 6,
          strengthGain: 3,
          addStatusCards: 0,
          weight: 25
        }
      ]
    },
    {
      id: 'acid_slime',
      name: 'Acid Slime',
      hp: 30,
      pattern: 'cycle',
      intents: [
        {
          name: 'Corrosive Spit',
          damage: 7,
          hits: 1,
          block: 0,
          strengthGain: 0,
          addStatusCards: 1,
          statusCardKind: 'slimed'
        },
        {
          name: 'Lick',
          damage: 0,
          hits: 1,
          block: 0,
          strengthGain: 0,
          applyStatus: 'weak',
          applyAmount: 1,
          addStatusCards: 0
        },
        { name: 'Tackle', damage: 10, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    },
    {
      id: 'gremlin_nob',
      name: 'Gremlin Nob',
      hp: 82,
      pattern: 'cycle',
      intents: [
        { name: 'Bellow', damage: 0, hits: 1, block: 0, strengthGain: 2, addStatusCards: 0 },
        {
          name: 'Skull Bash',
          damage: 6,
          hits: 1,
          block: 0,
          strengthGain: 0,
          applyStatus: 'vulnerable',
          applyAmount: 2,
          addStatusCards: 0
        },
        { name: 'Rush', damage: 14, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 },
        { name: 'Rush', damage: 14, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    },
    {
      id: 'hexa_warden',
      name: 'Hexa Warden',
      hp: 220,
      pattern: 'cycle',
      intents: [
        {
          name: 'Charge',
          damage: 0,
          hits: 1,
          block: 15,
          strengthGain: 0,
          applyStatus: 'frail',
          applyAmount: 2,
          addStatusCards: 0
        },
        { name: 'Heavy Slam', damage: 30, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 },
        {
          name: 'Sear',
          damage: 8,
          hits: 1,
          block: 0,
          strengthGain: 0,
          addStatusCards: 3,
          statusCardKind: 'burn'
        },
        { name: 'Frenzy', damage: 6, hits: 4, block: 0, strengthGain: 1, addStatusCards: 0 }
      ]
    }
  ]
}

export function createDefaultMxEncounters(): MxEncounterSpec[] {
  return [
    { id: 'n_cultist', name: 'Cultist', tier: 'normal', enemyIds: ['cultist'] },
    { id: 'n_jaw', name: 'Jaw Worm', tier: 'normal', enemyIds: ['jaw_worm'] },
    {
      id: 'n_slimes',
      name: '2x Acid Slime',
      tier: 'normal',
      enemyIds: ['acid_slime', 'acid_slime']
    },
    { id: 'e_nob', name: 'Gremlin Nob', tier: 'elite', enemyIds: ['gremlin_nob'] },
    { id: 'b_hexa', name: 'Hexa Warden', tier: 'boss', enemyIds: ['hexa_warden'] }
  ]
}

export function createDefaultMxRelics(): MxRelicSpec[] {
  return [
    { id: 'burning_blood', name: 'Burning Blood', trigger: 'combat_end', script: 'heal 6' },
    { id: 'anchor', name: 'Anchor', trigger: 'combat_start', script: 'blk 10' },
    { id: 'lantern', name: 'Lantern', trigger: 'combat_start', script: 'nrg 1' },
    { id: 'bag_of_prep', name: 'Bag of Preparation', trigger: 'combat_start', script: 'draw 2' },
    { id: 'kunai', name: 'Kunai', trigger: 'every_n_attacks', n: 3, script: 'dex 1' },
    { id: 'happy_flower', name: 'Happy Flower', trigger: 'every_n_turns', n: 3, script: 'nrg 1' }
  ]
}

export function createDefaultMxCardPool(): MxDeckCardSpec[] {
  const c = makeScriptCard
  return [
    c('pool_pommel', 'Pommel Strike', 1, 'dmg 9; draw 1', 'common'),
    c('pool_shrug', 'Shrug It Off', 1, 'blk 8; draw 1', 'common'),
    c('pool_clothesline', 'Clothesline', 2, 'dmg 12; weak 2', 'common'),
    c('pool_twin', 'Twin Strike', 1, 'dmg 5x2', 'common'),
    c('pool_ironwave', 'Iron Wave', 1, 'dmg 5; blk 5', 'common'),
    c('pool_cleave', 'Cleave', 1, 'dmg 8 @all', 'common'),
    c('pool_backflip', 'Backflip', 1, 'blk 5; draw 2', 'common'),
    c('pool_poison', 'Deadly Poison', 1, 'poison 5', 'common'),
    c('pool_uppercut', 'Uppercut', 2, 'dmg 13; weak 1; vuln 1', 'uncommon'),
    c(
      'pool_dropkick',
      'Dropkick',
      1,
      'dmg 5; if enemy.vuln: nrg 1; if enemy.vuln: draw 1',
      'uncommon'
    ),
    c('pool_whirlwind', 'Whirlwind', 0, 'kw x; dmg 5 @all *x', 'uncommon'),
    c('pool_inflame', 'Inflame', 1, 'kw power; str 2', 'uncommon'),
    c('pool_metallicize', 'Metallicize', 1, 'kw power; turn_end: blk 3', 'uncommon'),
    c('pool_finisher', 'Finisher', 1, 'dmg 6 *played', 'uncommon'),
    c('pool_catalyst', 'Catalyst', 1, 'double poison; kw exhaust', 'uncommon'),
    c('pool_trance', 'Battle Trance', 0, 'draw 3', 'uncommon'),
    c('pool_wolf', 'Summon Wolf', 2, 'summon 4/3', 'uncommon'),
    c('pool_guardian', 'Stone Guardian', 1, 'summon 1/8 taunt', 'common'),
    c('pool_bludgeon', 'Bludgeon', 3, 'dmg 32', 'rare'),
    c('pool_impervious', 'Impervious', 2, 'blk 30; kw exhaust', 'rare'),
    c('pool_adrenaline', 'Adrenaline', 0, 'nrg 1; draw 2; kw exhaust', 'rare'),
    c('pool_demonform', 'Demon Form', 3, 'kw power; turn_start: str 2', 'rare'),
    c('pool_offering', 'Offering', 0, 'heal -6; nrg 2; draw 3; kw exhaust', 'rare')
  ]
}

export function createDefaultMxRunEconomy(): MxRunEconomyConfig {
  return {
    floors: 15,
    runs: 40,
    seed: 2026,
    startGold: 99,
    goldPerNormal: 15,
    goldPerElite: 30,
    cardRewardChoices: 3,
    rarityWeights: { common: 60, uncommon: 37, rare: 3 },
    rareWeightGrowthPerFloor: 0.6,
    shopEveryNFloors: 5,
    cardPrice: { common: 50, uncommon: 75, rare: 150 },
    removePrice: 75,
    removePriceGrowth: 25,
    restEveryNFloors: 6,
    restHealPct: 30,
    eliteEveryNFloors: 4,
    enemyHpGrowthPerFloor: 0.04,
    enemyDmgGrowthPerFloor: 0.03,
    policy: 'greedy',
    pickMode: 'formula',
    pickSimRuns: 6,
    branchingMap: false,
    eventRatePct: 25,
    potionSlots: 2,
    potionDropRatePct: 0
  }
}

export function createDefaultMxCardDesignLab(wb?: MxNumericalWorkbench): MxCardDesignLabConfig {
  return {
    playerHp: Math.max(20, wb?.combatKernel.playerHp ?? 80),
    maxTurns: Math.max(8, wb?.combatKernel.maxTurns ?? 20),
    policy: 'greedy',
    battleRuns: 120,
    selectedEncounterId: 'n_jaw',
    enemies: createDefaultMxEnemies(),
    encounters: createDefaultMxEncounters(),
    relics: createDefaultMxRelics(),
    activeRelicIds: ['burning_blood'],
    cardPool: createDefaultMxCardPool(),
    economy: createDefaultMxRunEconomy()
  }
}

/** 读取工作台中的设计实验室配置（缺失字段以默认值补齐） */
export function ensureMxCardDesignLab(wb: MxNumericalWorkbench): MxCardDesignLabConfig {
  const def = createDefaultMxCardDesignLab(wb)
  const raw = wb.designLab
  if (!raw || typeof raw !== 'object') return def
  return {
    ...def,
    ...raw,
    economy: { ...def.economy, ...(raw.economy ?? {}) },
    enemies: Array.isArray(raw.enemies) ? raw.enemies : def.enemies,
    encounters: Array.isArray(raw.encounters) ? raw.encounters : def.encounters,
    relics: Array.isArray(raw.relics) ? raw.relics : def.relics,
    activeRelicIds: Array.isArray(raw.activeRelicIds) ? raw.activeRelicIds : def.activeRelicIds,
    cardPool: Array.isArray(raw.cardPool) ? raw.cardPool : def.cardPool
  }
}

export function resolveMxEncounterEnemies(
  lab: MxCardDesignLabConfig,
  encounterId: string
): MxEnemySpec[] {
  const enc = lab.encounters.find((e) => e.id === encounterId) ?? lab.encounters[0]
  if (!enc) return []
  return enc.enemyIds
    .map((id) => lab.enemies.find((e) => e.id === id))
    .filter((e): e is MxEnemySpec => Boolean(e))
}

function activeRelics(lab: MxCardDesignLabConfig): MxRelicSpec[] {
  return lab.relics.filter((r) => lab.activeRelicIds.includes(r.id))
}

/** 以工作台当前牌库 + 实验室选中遭遇运行一次效果引擎战斗模拟 */
export function runMxLabEncounterSimulation(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig,
  opts: { encounterId?: string; policy?: MxPlayPolicy; runs?: number; enemyHpScale?: number } = {}
): MxBattleSimResult {
  return runMxBattleEngineSimulation({
    deck: wb.combatKernel.deckCards,
    enemies: resolveMxEncounterEnemies(lab, opts.encounterId ?? lab.selectedEncounterId),
    relics: activeRelics(lab),
    playerHp: lab.playerHp,
    energyPerTurn: wb.combatKernel.energyPerTurn || 3,
    drawPerTurn: wb.combatKernel.drawPerTurn || 5,
    maxTurns: lab.maxTurns,
    policy: opts.policy ?? lab.policy,
    runs: opts.runs ?? lab.battleRuns,
    seed: wb.combatKernel.seed || 1,
    enemyHpScale: opts.enemyHpScale
  })
}

// ───────────────────────────── 单局经济闭环 ─────────────────────────────

export type MxRunNodeKind = 'normal' | 'elite' | 'boss' | 'shop' | 'rest' | 'event'

export interface MxRunFloorRow {
  floor: number
  node: MxRunNodeKind
  aliveRatePct: number
  avgHp: number
  avgGold: number
  avgDeckSize: number
}

export interface MxRunEconomyResult {
  runs: number
  clearRatePct: number
  deathFloorHistogram: Array<{ floor: number; deaths: number }>
  floorRows: MxRunFloorRow[]
  avgCardsAdded: number
  avgCardsRemoved: number
  avgUpgrades: number
  avgGoldEarned: number
  avgGoldSpent: number
  avgFinalDeckSize: number
  rewardSkipRatePct: number
  /** 本次使用的选卡方式与为选卡额外运行的战斗数 */
  pickMode: 'formula' | 'simulated'
  pickSimBattles: number
  /** 按层级统计：战斗场数、胜率、平均战损（占最大血量 %） */
  tierStats: Array<{
    tier: 'normal' | 'elite' | 'boss'
    fights: number
    winRatePct: number
    avgHpLossPct: number
  }>
  /** 分叉地图与药水遥测：访问问号事件数 / 残血绕开精英次数 / 消耗药水瓶数（场均） */
  avgEventsVisited: number
  avgElitesAvoided: number
  avgPotionsUsed: number
}

export function mxRunNodeKindAt(floor: number, eco: MxRunEconomyConfig): MxRunNodeKind {
  if (floor >= eco.floors) return 'boss'
  if (eco.restEveryNFloors > 0 && floor % eco.restEveryNFloors === 0) return 'rest'
  if (eco.shopEveryNFloors > 0 && floor % eco.shopEveryNFloors === 0) return 'shop'
  if (eco.eliteEveryNFloors > 0 && floor % eco.eliteEveryNFloors === 0) return 'elite'
  return 'normal'
}

function rollRarity(
  eco: MxRunEconomyConfig,
  floor: number,
  rng: () => number
): 'common' | 'uncommon' | 'rare' {
  const w = {
    common: Math.max(0, eco.rarityWeights.common),
    uncommon: Math.max(0, eco.rarityWeights.uncommon),
    rare: Math.max(0, eco.rarityWeights.rare + eco.rareWeightGrowthPerFloor * (floor - 1))
  }
  const total = w.common + w.uncommon + w.rare || 1
  let r = rng() * total
  if ((r -= w.common) < 0) return 'common'
  if ((r -= w.uncommon) < 0) return 'uncommon'
  return 'rare'
}

function rarityOf(card: MxDeckCardSpec): 'common' | 'uncommon' | 'rare' {
  if (card.rarity) return card.rarity
  return card.cost >= 3 ? 'rare' : card.cost >= 2 ? 'uncommon' : 'common'
}

function offerCards(
  pool: MxDeckCardSpec[],
  n: number,
  eco: MxRunEconomyConfig,
  floor: number,
  rng: () => number
): MxDeckCardSpec[] {
  const picks: MxDeckCardSpec[] = []
  for (let i = 0; i < n && pool.length; i++) {
    const rar = rollRarity(eco, floor, rng)
    let cands = pool.filter((c) => rarityOf(c) === rar && !picks.includes(c))
    if (!cands.length) cands = pool.filter((c) => !picks.includes(c))
    if (!cands.length) break
    picks.push(cands[Math.floor(rng() * cands.length)]!)
  }
  return picks
}

function deckAvgValuePerCost(deck: MxDeckCardSpec[]): number {
  let sum = 0
  let n = 0
  for (const c of deck) {
    const k = Math.max(1, c.count || 1)
    sum += mxCardValuePerCost(c) * k
    n += k
  }
  return n ? sum / n : 0
}

function deckSize(deck: MxDeckCardSpec[]): number {
  return deck.reduce((a, c) => a + Math.max(1, c.count || 1), 0)
}

function addCard(deck: MxDeckCardSpec[], card: MxDeckCardSpec): void {
  const existing = deck.find((c) => c.id === card.id && c.name === card.name)
  if (existing) existing.count = Math.max(1, existing.count || 1) + 1
  else deck.push({ ...card, count: 1 })
}

function removeWorstCard(deck: MxDeckCardSpec[]): boolean {
  if (deckSize(deck) <= 5) return false
  const worst = deck.reduce((a, b) => (mxCardValuePerCost(a) <= mxCardValuePerCost(b) ? a : b))
  if ((worst.count || 1) > 1) worst.count = (worst.count || 1) - 1
  else deck.splice(deck.indexOf(worst), 1)
  return true
}

/**
 * 单局经济闭环蒙特卡洛：逐层「战斗（真实效果引擎）→ 金币 → 三选一卡牌奖励/跳过 → 商店买卡/删卡 → 篝火回血/升级」，
 * 战损血量跨层继承，统计通关率、死亡层分布、逐层血量/金币/卡组规模。
 */
export function simulateMxRunEconomyLoop(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig
): MxRunEconomyResult {
  const eco = lab.economy
  const floors = Math.max(1, Math.round(eco.floors))
  const runs = Math.max(1, Math.round(eco.runs))
  const pool = lab.cardPool.length ? lab.cardPool : wb.combatKernel.deckCards
  const relics = activeRelics(lab)
  const byTier = (tier: MxEncounterSpec['tier']): MxEncounterSpec[] => {
    const list = lab.encounters.filter((e) => e.tier === tier)
    return list.length ? list : lab.encounters
  }

  const aliveAt = new Array<number>(floors).fill(0)
  const hpAt = new Array<number>(floors).fill(0)
  const goldAt = new Array<number>(floors).fill(0)
  const deckAt = new Array<number>(floors).fill(0)
  const deaths = new Array<number>(floors).fill(0)
  let clears = 0
  let added = 0
  let removed = 0
  let upgrades = 0
  let goldEarned = 0
  let goldSpent = 0
  let finalDeck = 0
  let offers = 0
  let skips = 0
  let eventsVisited = 0
  let elitesAvoided = 0
  let potionsUsed = 0
  const maxPotionSlots = Math.max(0, Math.min(5, Math.round(eco.potionSlots ?? 2)))
  const potionDropPct = Math.max(0, Math.min(100, eco.potionDropRatePct ?? 0))
  const POTION_RELICS: MxRelicSpec[] = [
    { id: 'pot_fire', name: 'Fire Potion', trigger: 'combat_start', script: 'dmg 20' },
    { id: 'pot_block', name: 'Block Potion', trigger: 'combat_start', script: 'blk 14' },
    { id: 'pot_str', name: 'Strength Potion', trigger: 'combat_start', script: 'str 2' },
    { id: 'pot_regen', name: 'Regen Potion', trigger: 'combat_start', script: 'heal 12' }
  ]

  /** 分叉地图选路：返回本层候选分支及 AI 选中的节点 */
  const pickFloorNode = (
    f: number,
    hpNow: number,
    goldNow: number,
    remCost: number,
    deckNow: MxDeckCardSpec[],
    rng: () => number
  ): MxRunNodeKind => {
    const primary = mxRunNodeKindAt(f, eco)
    if (!eco.branchingMap || f <= 1 || f >= floors) return primary
    const evRate = Math.max(0, Math.min(100, eco.eventRatePct ?? 25)) / 100
    const alt1: MxRunNodeKind =
      primary === 'elite'
        ? rng() < evRate
          ? 'event'
          : 'normal'
        : primary === 'normal'
          ? rng() < evRate
            ? 'event'
            : rng() < 0.35
              ? 'elite'
              : 'rest'
          : 'normal'
    const alt2: MxRunNodeKind =
      primary !== 'rest' && alt1 !== 'rest' && rng() < 0.35
        ? 'rest'
        : primary !== 'shop' && rng() < 0.3
          ? 'shop'
          : 'event'
    const cands = Array.from(new Set<MxRunNodeKind>([primary, alt1, alt2]))
    const hpPct = hpNow / Math.max(1, lab.playerHp)
    const hasUnupgraded = deckNow.some((c) => !c.name.trim().endsWith('+'))
    const scoreNode = (n: MxRunNodeKind): number => {
      if (n === 'rest') return hpPct < 0.48 ? 95 : hasUnupgraded ? 55 : 15
      if (n === 'shop') return goldNow >= Math.max(remCost, 110) ? 82 : goldNow >= 60 ? 45 : 10
      if (n === 'elite') return hpPct >= 0.65 ? 85 : hpPct < 0.48 ? -50 : 40
      if (n === 'event') return hpPct < 0.52 ? 68 : 52
      return 50
    }
    const chosen = cands.reduce((a, b) => (scoreNode(a) >= scoreNode(b) ? a : b))
    if (cands.includes('elite') && chosen !== 'elite') elitesAvoided++
    return chosen
  }
  const tierAgg = {
    normal: { fights: 0, wins: 0, lossPct: 0 },
    elite: { fights: 0, wins: 0, lossPct: 0 },
    boss: { fights: 0, wins: 0, lossPct: 0 }
  }
  const simPick = eco.pickMode === 'simulated'
  const pickRuns = Math.max(2, Math.min(40, Math.round(eco.pickSimRuns ?? 6)))
  let pickBattles = 0

  /** 下一个战斗节点的遭遇（用于实测选卡） */
  const nextCombatEncounter = (
    fromFloor: number,
    salt: number
  ): { encId: string; floor: number } | null => {
    for (let f2 = fromFloor + 1; f2 <= floors; f2++) {
      const k = mxRunNodeKindAt(f2, eco)
      if (k === 'normal' || k === 'elite' || k === 'boss') {
        const list = byTier(k)
        if (!list.length) return null
        return { encId: list[salt % list.length]!.id, floor: f2 }
      }
    }
    return null
  }

  /** 共同随机数下评估一套牌组：胜场计剩余血量，败场计 -最大血量 */
  const scoreCandidate = (
    cand: MxDeckCardSpec[],
    hpNow: number,
    encId: string,
    f2: number,
    seed: number
  ): number => {
    const enemies = resolveMxEncounterEnemies(lab, encId)
    let sum = 0
    for (let k = 0; k < pickRuns; k++) {
      pickBattles++
      const res = runMxSingleBattle(
        {
          deck: cand,
          enemies,
          relics,
          playerHp: hpNow,
          playerMaxHp: lab.playerHp,
          energyPerTurn: wb.combatKernel.energyPerTurn || 3,
          drawPerTurn: wb.combatKernel.drawPerTurn || 5,
          maxTurns: lab.maxTurns,
          policy: eco.policy === 'search' || eco.policy === 'rollout' ? 'greedy' : eco.policy,
          enemyHpScale: 1 + eco.enemyHpGrowthPerFloor * (f2 - 1),
          enemyDmgScale: 1 + eco.enemyDmgGrowthPerFloor * (f2 - 1)
        },
        createMxRng(seed + (k + 1) * 7919)
      )
      sum += res.won ? res.hpLeft : -lab.playerHp
    }
    return sum / pickRuns
  }

  /** 实测选卡：返回最佳候选下标（-1 = 跳过/不买） */
  const simulatedPick = (
    deck: MxDeckCardSpec[],
    cands: MxDeckCardSpec[],
    hpNow: number,
    f: number,
    seed: number
  ): number =>
    bestVariant(
      deck,
      cands.map((c) => withExtraCopy(deck, c)),
      hpNow,
      f,
      seed
    )

  /** 实测删卡：在价值最低的至多 8 种牌中找「删 1 张后表现最好」的一种（-1 = 不删） */
  const simulatedRemove = (
    deck: MxDeckCardSpec[],
    hpNow: number,
    f: number,
    seed: number
  ): string | null => {
    if (deckSize(deck) <= 5) return null
    const cands = [...deck]
      .sort((a, b) => mxCardValuePerCost(a) - mxCardValuePerCost(b))
      .slice(0, 8)
    const idx = bestVariant(
      deck,
      cands.map((c) => withoutOneCopy(deck, c.id)),
      hpNow,
      f,
      seed + 3
    )
    return idx >= 0 ? cands[idx]!.id : null
  }

  /** 共同随机数比较「原牌组」与若干变体：返回严格优于原牌组的最佳变体下标 */
  const bestVariant = (
    deck: MxDeckCardSpec[],
    variants: MxDeckCardSpec[][],
    hpNow: number,
    f: number,
    seed: number
  ): number => {
    const nxt = nextCombatEncounter(f, seed)
    if (!nxt || !variants.length) return -1
    // 兼顾眼前与长线：下一场战斗 + 终局 Boss（满血、终局层成长）各占一半
    const bossList = byTier('boss')
    const boss = bossList.length
      ? { encId: bossList[seed % bossList.length]!.id, floor: floors }
      : null
    const evalDeck = (d: MxDeckCardSpec[]): number =>
      scoreCandidate(d, hpNow, nxt.encId, nxt.floor, seed) +
      (boss && boss.encId !== nxt.encId
        ? scoreCandidate(d, lab.playerHp, boss.encId, boss.floor, seed + 1)
        : 0)
    let best = -1
    let bestScore = evalDeck(deck)
    variants.forEach((v, i) => {
      const sc = evalDeck(v)
      if (sc > bestScore) {
        bestScore = sc
        best = i
      }
    })
    return best
  }
  for (let r = 0; r < runs; r++) {
    const rng = createMxRng(eco.seed + (r + 1) * 7919)
    const deck: MxDeckCardSpec[] = wb.combatKernel.deckCards.map((c) => ({ ...c }))
    let hp = lab.playerHp
    let gold = eco.startGold
    let removeCost = eco.removePrice
    let alive = true
    const potions: MxRelicSpec[] = []
    for (let f = 1; f <= floors && alive; f++) {
      const node = pickFloorNode(f, hp, gold, removeCost, deck, rng)
      if (node === 'rest') {
        if (hp < lab.playerHp * 0.5) {
          hp = Math.min(lab.playerHp, hp + Math.round((lab.playerHp * eco.restHealPct) / 100))
        } else if (deck.length) {
          const best = deck
            .filter((c) => !c.name.trim().endsWith('+'))
            .sort((a, b) => mxCardValuePerCost(b) - mxCardValuePerCost(a))[0]
          if (best) {
            const up = mxUpgradeCardSpec(best)
            if ((best.count || 1) > 1) {
              best.count = (best.count || 1) - 1
              deck.push({ ...up, id: `${best.id}_up`, count: 1 })
            } else {
              deck[deck.indexOf(best)] = up
            }
            upgrades++
          }
        }
      } else if (node === 'shop') {
        const avg = deckAvgValuePerCost(deck)
        const offersShop = offerCards(pool, 3, eco, f, rng)
          .map((c) => ({ c, price: eco.cardPrice[rarityOf(c)], vpc: mxCardValuePerCost(c) }))
          .sort((a, b) => b.vpc - a.vpc)
        const buy = simPick
          ? (() => {
              const affordable = offersShop.filter((o) => o.price <= gold)
              const idx = simulatedPick(
                deck,
                affordable.map((o) => o.c),
                hp,
                f,
                eco.seed + r * 131 + f * 17
              )
              return idx >= 0 ? affordable[idx] : undefined
            })()
          : offersShop.find((o) => o.price <= gold && o.vpc >= avg)
        if (buy) {
          gold -= buy.price
          goldSpent += buy.price
          addCard(deck, buy.c)
          added++
        }
        if (gold >= removeCost) {
          let didRemove = false
          if (simPick) {
            const rid = simulatedRemove(deck, hp, f, eco.seed + r * 131 + f * 17)
            if (rid) {
              const next = withoutOneCopy(deck, rid)
              deck.length = 0
              deck.push(...next)
              didRemove = true
            }
          } else {
            didRemove = removeWorstCard(deck)
          }
          if (didRemove) {
            gold -= removeCost
            goldSpent += removeCost
            removeCost += eco.removePriceGrowth
            removed++
          }
        }
      } else if (node === 'event') {
        eventsVisited++
        const roll = rng()
        if (roll < 0.28) {
          // 净化学坛：免费删 1 张最差牌
          if (removeWorstCard(deck)) removed++
        } else if (roll < 0.55) {
          // 远古石碑：免费升级最佳未升级牌
          const best = deck
            .filter((c) => !c.name.trim().endsWith('+'))
            .sort((a, b) => mxCardValuePerCost(b) - mxCardValuePerCost(a))[0]
          if (best) {
            const up = mxUpgradeCardSpec(best)
            if ((best.count || 1) > 1) {
              best.count = (best.count || 1) - 1
              deck.push({ ...up, id: `${best.id}_up`, count: 1 })
            } else {
              deck[deck.indexOf(best)] = up
            }
            upgrades++
          }
        } else if (roll < 0.8) {
          // 流浪炼金师：回血 15% 并赠予 1 瓶药水
          hp = Math.min(lab.playerHp, hp + Math.round(lab.playerHp * 0.15))
          if (potions.length < maxPotionSlots) {
            potions.push(POTION_RELICS[Math.floor(rng() * POTION_RELICS.length)]!)
          }
        } else if (hp > lab.playerHp * 0.45) {
          // 鲜血神像：血量安全时献祭 10% 生命换取 70 金币
          hp = Math.max(1, hp - Math.round(lab.playerHp * 0.1))
          gold += 70
          goldEarned += 70
        } else {
          // 残血保守选择：包扎回血 20%
          hp = Math.min(lab.playerHp, hp + Math.round(lab.playerHp * 0.2))
        }
      } else {
        const list = byTier(node)
        const enc = list[Math.floor(rng() * list.length)]!
        const enemies = resolveMxEncounterEnemies(lab, enc.id)
        // 药水使用策略：Boss 战倾泻全部药水；精英战或残血（<50%）使用 1 瓶药水
        const battleRelics = relics.slice()
        if (
          potions.length > 0 &&
          (node === 'boss' || node === 'elite' || hp < lab.playerHp * 0.5)
        ) {
          const useCount = node === 'boss' ? potions.length : 1
          for (let pi = 0; pi < useCount && potions.length > 0; pi++) {
            const pot = potions.shift()!
            battleRelics.push({ ...pot, id: `${pot.id}_${f}_${pi}` })
            potionsUsed++
          }
        }
        const res = runMxSingleBattle(
          {
            deck,
            enemies,
            relics: battleRelics,
            playerHp: hp,
            playerMaxHp: lab.playerHp,
            energyPerTurn: wb.combatKernel.energyPerTurn || 3,
            drawPerTurn: wb.combatKernel.drawPerTurn || 5,
            maxTurns: lab.maxTurns,
            policy: eco.policy,
            enemyHpScale: 1 + eco.enemyHpGrowthPerFloor * (f - 1),
            enemyDmgScale: 1 + eco.enemyDmgGrowthPerFloor * (f - 1)
          },
          rng
        )
        const ts = tierAgg[node as 'normal' | 'elite' | 'boss']
        ts.fights++
        if (res.won) ts.wins++
        ts.lossPct += (Math.max(0, res.hpLoss) / Math.max(1, lab.playerHp)) * 100
        if (!res.won) {
          alive = false
          deaths[f - 1]!++
          break
        }
        hp = res.hpLeft
        if (node !== 'boss') {
          const g = Math.round(
            (node === 'elite' ? eco.goldPerElite : eco.goldPerNormal) * (0.8 + rng() * 0.4)
          )
          gold += g
          goldEarned += g
          const choices = offerCards(pool, eco.cardRewardChoices, eco, f, rng)
          offers++
          const avg = deckAvgValuePerCost(deck)
          let best: MxDeckCardSpec | undefined
          if (simPick) {
            const idx = simulatedPick(deck, choices, hp, f, eco.seed + r * 131 + f * 17)
            best = idx >= 0 ? choices[idx] : undefined
          } else {
            const top = choices.sort((a, b) => mxCardValuePerCost(b) - mxCardValuePerCost(a))[0]
            best = top && mxCardValuePerCost(top) >= avg * 0.9 ? top : undefined
          }
          if (best) {
            addCard(deck, best)
            added++
          } else {
            skips++
          }
          if (potions.length < maxPotionSlots && rng() * 100 < potionDropPct) {
            potions.push(POTION_RELICS[Math.floor(rng() * POTION_RELICS.length)]!)
          }
        }
      }
      aliveAt[f - 1]!++
      hpAt[f - 1]! += hp
      goldAt[f - 1]! += gold
      deckAt[f - 1]! += deckSize(deck)
    }
    if (alive) clears++
    finalDeck += deckSize(deck)
  }

  const r1 = (n: number): number => Math.round(n * 10) / 10
  return {
    runs,
    clearRatePct: r1((clears / runs) * 100),
    deathFloorHistogram: deaths
      .map((d, i) => ({ floor: i + 1, deaths: d }))
      .filter((x) => x.deaths > 0),
    floorRows: aliveAt.map((a, i) => ({
      floor: i + 1,
      node: mxRunNodeKindAt(i + 1, eco),
      aliveRatePct: r1((a / runs) * 100),
      avgHp: a ? r1(hpAt[i]! / a) : 0,
      avgGold: a ? r1(goldAt[i]! / a) : 0,
      avgDeckSize: a ? r1(deckAt[i]! / a) : 0
    })),
    avgCardsAdded: r1(added / runs),
    avgCardsRemoved: r1(removed / runs),
    avgUpgrades: r1(upgrades / runs),
    avgGoldEarned: r1(goldEarned / runs),
    avgGoldSpent: r1(goldSpent / runs),
    avgFinalDeckSize: r1(finalDeck / runs),
    rewardSkipRatePct: offers ? r1((skips / offers) * 100) : 0,
    tierStats: (['normal', 'elite', 'boss'] as const).map((tier) => {
      const a = tierAgg[tier]
      return {
        tier,
        fights: a.fights,
        winRatePct: a.fights ? r1((a.wins / a.fights) * 100) : 0,
        avgHpLossPct: a.fights ? r1(a.lossPct / a.fights) : 0
      }
    }),
    pickMode: simPick ? 'simulated' : 'formula',
    pickSimBattles: pickBattles,
    avgEventsVisited: r1(eventsVisited / runs),
    avgElitesAvoided: r1(elitesAvoided / runs),
    avgPotionsUsed: r1(potionsUsed / runs)
  }
}

// ───────────────────────────── 目标通关率反解敌人血量/伤害 ─────────────────────────────

export interface MxTierHpSolveResult {
  tier: MxEncounterSpec['tier']
  targetClearRatePct: number
  /** 可选第二目标：该层级战斗的平均战损（占最大血量 %） */
  targetTierHpLossPct?: number
  /** 求得的血量缩放系数 */
  scale: number
  /** 求得的伤害缩放系数（单目标模式恒为 1） */
  dmgScale: number
  achievedClearRatePct: number
  achievedTierHpLossPct: number
  /** 所有目标均在容差内 */
  converged: boolean
  /** 目标不可达（单目标模式）：too_hard = 最小缩放仍低于目标；too_easy = 最大缩放仍高于目标 */
  bound: 'too_hard' | 'too_easy' | null
  enemyRows: Array<{ id: string; name: string; hpBefore: number; hpAfter: number; cloned: boolean }>
  iterations: Array<{
    scale: number
    dmgScale: number
    clearRatePct: number
    tierHpLossPct: number
  }>
  /** 一键写回：替换实验室的敌人表与遭遇表（共用敌人已拆分为本层级专属副本） */
  labPatch: { enemies: MxEnemySpec[]; encounters: MxEncounterSpec[] }
}

/**
 * 按层级缩放敌人血量与意图伤害（返回新实验室配置，不修改原对象）。
 * isolate=true（默认）时，若某敌人同时出现在其他层级的遭遇中，会为本层级克隆一份专属副本
 * （id 加 `__tier` 后缀）并改写本层级遭遇的引用，避免误改其他层级。
 */
export function mxScaleTierEnemies(
  lab: MxCardDesignLabConfig,
  tier: MxEncounterSpec['tier'],
  k: { hp?: number; dmg?: number; isolate?: boolean }
): MxCardDesignLabConfig & { clonedIds: string[] } {
  const hpK = k.hp ?? 1
  const dmgK = k.dmg ?? 1
  const isolate = k.isolate ?? true
  const tierIds = new Set(lab.encounters.filter((e) => e.tier === tier).flatMap((e) => e.enemyIds))
  const otherIds = new Set(lab.encounters.filter((e) => e.tier !== tier).flatMap((e) => e.enemyIds))
  const scaleEnemy = (e: MxEnemySpec, id: string): MxEnemySpec => ({
    ...e,
    id,
    hp: Math.max(1, Math.round(e.hp * hpK)),
    intents:
      dmgK === 1
        ? e.intents
        : e.intents.map((it) => ({ ...it, damage: Math.max(0, Math.round(it.damage * dmgK)) }))
  })
  const remap = new Map<string, string>()
  if (isolate) for (const id of tierIds) if (otherIds.has(id)) remap.set(id, `${id}__${tier}`)
  const targets = new Set<string>([...tierIds].filter((id) => !remap.has(id)))
  for (const cid of remap.values()) targets.add(cid)
  const enemies: MxEnemySpec[] = lab.enemies.map((e) =>
    targets.has(e.id) ? scaleEnemy(e, e.id) : e
  )
  const clonedIds: string[] = []
  for (const [baseId, cid] of remap) {
    if (lab.enemies.some((x) => x.id === cid)) continue
    const base = lab.enemies.find((x) => x.id === baseId)
    if (!base) continue
    enemies.push({ ...scaleEnemy(base, cid), name: `${base.name} (${tier})` })
    clonedIds.push(cid)
  }
  const encounters = remap.size
    ? lab.encounters.map((enc) =>
        enc.tier === tier
          ? { ...enc, enemyIds: enc.enemyIds.map((id) => remap.get(id) ?? id) }
          : enc
      )
    : lab.encounters
  return { ...lab, enemies, encounters, clonedIds }
}

/** 兼容旧接口：仅缩放某一层级敌人血量 */
export function mxScaleTierEnemyHp(
  lab: MxCardDesignLabConfig,
  tier: MxEncounterSpec['tier'],
  k: number
): MxCardDesignLabConfig {
  return mxScaleTierEnemies(lab, tier, { hp: k })
}

/**
 * 以单局经济闭环为评估函数反解某一层级（默认 Boss）的敌人强度：
 * - 只给目标通关率：二分血量缩放（共同随机数保证近似单调）；
 * - 同时给「该层级平均战损 %」：在（血量 × 伤害）二维空间做粗网格 + 模式搜索，最小化加权误差。
 * 默认用估值公式选卡以保证速度；共用敌人自动拆分为本层级专属副本。
 */
export function solveMxTierHpForClearRate(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig,
  opts: {
    targetClearRatePct: number
    targetTierHpLossPct?: number
    tier?: MxEncounterSpec['tier']
    minScale?: number
    maxScale?: number
    iterations?: number
    runs?: number
    pickMode?: 'formula' | 'simulated'
    tolerancePct?: number
    isolateShared?: boolean
  }
): MxTierHpSolveResult {
  const tier = opts.tier ?? 'boss'
  const target = Math.max(0, Math.min(100, opts.targetClearRatePct))
  const lossTarget =
    opts.targetTierHpLossPct === undefined || !Number.isFinite(opts.targetTierHpLossPct)
      ? undefined
      : Math.max(0, Math.min(100, opts.targetTierHpLossPct))
  const tol = Math.max(0.5, opts.tolerancePct ?? 3)
  const minS = Math.max(0.05, opts.minScale ?? 0.3)
  const maxS = Math.max(minS + 0.05, opts.maxScale ?? 3)
  const iters = Math.max(3, Math.min(20, Math.round(opts.iterations ?? 10)))
  const isolate = opts.isolateShared ?? true
  const eco: MxRunEconomyConfig = {
    ...lab.economy,
    runs: Math.max(10, Math.round(opts.runs ?? Math.max(lab.economy.runs, 60))),
    pickMode: opts.pickMode ?? 'formula'
  }
  const iterations: MxTierHpSolveResult['iterations'] = []
  const cache = new Map<string, { clear: number; loss: number }>()
  const evalAt = (hpK: number, dmgK: number): { clear: number; loss: number } => {
    const key = `${r1s(hpK)}|${r1s(dmgK)}`
    const hit = cache.get(key)
    if (hit) return hit
    const scaled = mxScaleTierEnemies(lab, tier, { hp: hpK, dmg: dmgK, isolate })
    const res = simulateMxRunEconomyLoop(wb, { ...scaled, economy: eco })
    const loss = res.tierStats.find((t) => t.tier === tier)?.avgHpLossPct ?? 0
    const out = { clear: res.clearRatePct, loss }
    cache.set(key, out)
    iterations.push({
      scale: r1s(hpK),
      dmgScale: r1s(dmgK),
      clearRatePct: out.clear,
      tierHpLossPct: loss
    })
    return out
  }
  const finish = (
    hpK: number,
    dmgK: number,
    m: { clear: number; loss: number },
    bound: MxTierHpSolveResult['bound']
  ): MxTierHpSolveResult => {
    const scaled = mxScaleTierEnemies(lab, tier, { hp: hpK, dmg: dmgK, isolate })
    const tierIds = new Set(
      scaled.encounters.filter((e) => e.tier === tier).flatMap((e) => e.enemyIds)
    )
    const okClear = Math.abs(m.clear - target) <= tol
    const okLoss = lossTarget === undefined || Math.abs(m.loss - lossTarget) <= Math.max(tol, 5)
    return {
      tier,
      targetClearRatePct: target,
      targetTierHpLossPct: lossTarget,
      scale: Math.round(hpK * 1000) / 1000,
      dmgScale: Math.round(dmgK * 1000) / 1000,
      achievedClearRatePct: m.clear,
      achievedTierHpLossPct: m.loss,
      converged: okClear && okLoss,
      bound,
      enemyRows: scaled.enemies
        .filter((e) => tierIds.has(e.id))
        .map((e) => {
          const baseId = scaled.clonedIds.includes(e.id)
            ? e.id.replace(new RegExp(`__${tier}$`), '')
            : e.id
          const before =
            lab.enemies.find((x) => x.id === e.id) ?? lab.enemies.find((x) => x.id === baseId)
          return {
            id: e.id,
            name: e.name,
            hpBefore: before?.hp ?? e.hp,
            hpAfter: e.hp,
            cloned: scaled.clonedIds.includes(e.id)
          }
        }),
      iterations,
      labPatch: { enemies: scaled.enemies, encounters: scaled.encounters }
    }
  }

  // ── 单目标：二分血量 ──
  if (lossTarget === undefined) {
    let lo = minS
    let hi = maxS
    const mLo = evalAt(lo, 1)
    if (mLo.clear < target - tol) return finish(lo, 1, mLo, 'too_hard')
    const mHi = evalAt(hi, 1)
    if (mHi.clear > target + tol) return finish(hi, 1, mHi, 'too_easy')
    let bestK = Math.abs(mLo.clear - target) <= Math.abs(mHi.clear - target) ? lo : hi
    let best = bestK === lo ? mLo : mHi
    for (let i = 0; i < iters; i++) {
      const mid = (lo + hi) / 2
      const m = evalAt(mid, 1)
      if (Math.abs(m.clear - target) < Math.abs(best.clear - target)) {
        bestK = mid
        best = m
      }
      if (Math.abs(m.clear - target) <= tol / 2) break
      // 通关率随血量递减：偏高 → 加血；偏低 → 减血
      if (m.clear > target) lo = mid
      else hi = mid
    }
    return finish(bestK, 1, best, null)
  }

  // ── 双目标：通关率 + 层级战损，在 (血量, 伤害) 对数空间搜索 ──
  const err = (m: { clear: number; loss: number }): number =>
    ((m.clear - target) / 10) ** 2 + ((m.loss - lossTarget) / 6) ** 2
  const lmin = Math.log(minS)
  const lmax = Math.log(maxS)
  const grid = [0, 1 / 3, 2 / 3, 1].map((t) => Math.exp(lmin + (lmax - lmin) * t))
  let bx = 1
  let by = 1
  let bm = evalAt(1, 1)
  let be = err(bm)
  for (const hx of grid) {
    for (const dy of grid) {
      const m = evalAt(hx, dy)
      const e = err(m)
      if (e < be) {
        be = e
        bm = m
        bx = hx
        by = dy
      }
    }
  }
  let step = (lmax - lmin) / 6
  for (let round = 0; round < iters && step > 0.01; round++) {
    let improved = false
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step]
    ] as const) {
      const nx = Math.exp(Math.min(lmax, Math.max(lmin, Math.log(bx) + dx)))
      const ny = Math.exp(Math.min(lmax, Math.max(lmin, Math.log(by) + dy)))
      const m = evalAt(nx, ny)
      const e = err(m)
      if (e < be) {
        be = e
        bm = m
        bx = nx
        by = ny
        improved = true
      }
    }
    if (!improved) step /= 2
  }
  return finish(bx, by, bm, null)
}

const r1s = (n: number): number => Math.round(n * 1000) / 1000

// ───────────────────────────── 试玩日志校准 ─────────────────────────────

export interface MxPlaytestLogRow {
  encounterId: string
  won: boolean
  turns: number
  hpLoss: number
}

/**
 * 解析试玩日志 CSV。表头需包含：`encounter,won,turns,hp_loss`（列顺序不限，大小写不敏感；
 * won 支持 1/0/true/false/win/lose）。
 */
export function parseMxPlaytestLogCsv(text: string): {
  rows: MxPlaytestLogRow[]
  errors: string[]
} {
  const errors: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return { rows: [], errors: ['Empty CSV'] }
  const header = lines[0]!.split(/[,\t]/).map((h) => h.trim().toLowerCase())
  const iEnc = header.findIndex((h) => h === 'encounter' || h === 'encounter_id')
  const iWon = header.findIndex((h) => h === 'won' || h === 'win' || h === 'result')
  const iTurns = header.findIndex((h) => h === 'turns' || h === 'ttk')
  const iHp = header.findIndex((h) => h === 'hp_loss' || h === 'hploss' || h === 'damage_taken')
  if (iEnc < 0 || iWon < 0) {
    return { rows: [], errors: ['Header must contain "encounter" and "won" columns'] }
  }
  const rows: MxPlaytestLogRow[] = []
  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li]!.split(/[,\t]/).map((c) => c.trim())
    const enc = cols[iEnc]
    const wonRaw = (cols[iWon] ?? '').toLowerCase()
    if (!enc) {
      errors.push(`Line ${li + 1}: missing encounter`)
      continue
    }
    const won = ['1', 'true', 'win', 'won', 'yes', 'y'].includes(wonRaw)
    rows.push({
      encounterId: enc,
      won,
      turns: iTurns >= 0 ? Number(cols[iTurns]) || 0 : 0,
      hpLoss: iHp >= 0 ? Number(cols[iHp]) || 0 : 0
    })
  }
  return { rows, errors }
}

export interface MxCalibrationRow {
  encounterId: string
  samples: number
  observedWinPct: number
  predictedWinPct: number
  calibratedWinPct: number
  observedHpLoss: number
  predictedHpLoss: number
  calibratedHpLoss: number
  observedTurns: number
  predictedTurns: number
}

export interface MxCalibrationResult {
  rows: MxCalibrationRow[]
  /** 校准目标：有战损数据时用连续的平均战损，否则用胜率 */
  calibrationTarget: 'hp_loss' | 'win_rate'
  meanAbsWinErrBefore: number
  meanAbsWinErrAfter: number
  meanAbsHpLossErrBefore: number
  meanAbsHpLossErrAfter: number
  suggestedEnemyHpScale: number
  unmatchedEncounters: string[]
}

/**
 * 模型校准：按遭遇聚合实测胜率/战损/回合数，与效果引擎预测对比；
 * 再在 [0.4, 2.5] 区间二分搜索「敌方血量缩放系数」，使样本加权的预测战损（无战损数据时用胜率）与实测一致。
 */
export function calibrateMxBattleModel(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig,
  logs: MxPlaytestLogRow[],
  runs = 80
): MxCalibrationResult {
  const groups = new Map<string, MxPlaytestLogRow[]>()
  const unmatched = new Set<string>()
  for (const row of logs) {
    const enc =
      lab.encounters.find((e) => e.id === row.encounterId) ??
      lab.encounters.find((e) => e.name.toLowerCase() === row.encounterId.toLowerCase())
    if (!enc) {
      unmatched.add(row.encounterId)
      continue
    }
    const list = groups.get(enc.id) ?? []
    list.push(row)
    groups.set(enc.id, list)
  }
  const entries = [...groups.entries()]
  const simAt = (encId: string, scale: number): MxBattleSimResult =>
    runMxLabEncounterSimulation(wb, lab, { encounterId: encId, runs, enemyHpScale: scale })

  const weightedPred = (scale: number): { win: number; hpLoss: number } => {
    let win = 0
    let loss = 0
    let den = 0
    for (const [id, rows] of entries) {
      const sim = simAt(id, scale)
      win += sim.winRatePct * rows.length
      loss += sim.avgHpLoss * rows.length
      den += rows.length
    }
    return den ? { win: win / den, hpLoss: loss / den } : { win: 0, hpLoss: 0 }
  }
  let obsWin = 0
  let obsLoss = 0
  let obsDen = 0
  for (const [, rows] of entries) {
    obsWin += rows.filter((x) => x.won).length * 100
    obsLoss += rows.reduce((a, x) => a + x.hpLoss, 0)
    obsDen += rows.length
  }
  const observedWin = obsDen ? obsWin / obsDen : 0
  const observedLoss = obsDen ? obsLoss / obsDen : 0
  // 胜率接近 0%/100% 时信息量饱和，优先以连续的「平均战损」作为校准目标（战损随敌方血量单调上升）
  const hasHpLoss = logs.some((x) => x.hpLoss > 0)
  const useHpLoss = hasHpLoss

  let lo = 0.4
  let hi = 2.5
  for (let i = 0; i < 14 && entries.length; i++) {
    const mid = (lo + hi) / 2
    const pred = weightedPred(mid)
    const tooEasy = useHpLoss ? pred.hpLoss < observedLoss : pred.win > observedWin
    if (tooEasy) lo = mid
    else hi = mid
  }
  const suggested = entries.length ? Math.round(((lo + hi) / 2) * 100) / 100 : 1

  const r1 = (n: number): number => Math.round(n * 10) / 10
  const rows: MxCalibrationRow[] = entries.map(([id, list]) => {
    const base = simAt(id, 1)
    const cal = simAt(id, suggested)
    const wins = list.filter((x) => x.won)
    return {
      encounterId: id,
      samples: list.length,
      observedWinPct: r1((wins.length / list.length) * 100),
      predictedWinPct: base.winRatePct,
      calibratedWinPct: cal.winRatePct,
      observedHpLoss: r1(list.reduce((a, x) => a + x.hpLoss, 0) / list.length),
      predictedHpLoss: base.avgHpLoss,
      calibratedHpLoss: cal.avgHpLoss,
      observedTurns: wins.length ? r1(wins.reduce((a, x) => a + x.turns, 0) / wins.length) : 0,
      predictedTurns: base.ttkMean
    }
  })
  const mae = (f: (r: MxCalibrationRow) => number): number =>
    rows.length ? r1(rows.reduce((a, r) => a + Math.abs(f(r)), 0) / rows.length) : 0
  return {
    rows,
    calibrationTarget: useHpLoss ? 'hp_loss' : 'win_rate',
    meanAbsWinErrBefore: mae((r) => r.predictedWinPct - r.observedWinPct),
    meanAbsWinErrAfter: mae((r) => r.calibratedWinPct - r.observedWinPct),
    meanAbsHpLossErrBefore: mae((r) => r.predictedHpLoss - r.observedHpLoss),
    meanAbsHpLossErrAfter: mae((r) => r.calibratedHpLoss - r.observedHpLoss),
    suggestedEnemyHpScale: suggested,
    unmatchedEncounters: [...unmatched]
  }
}

// ───────────────────────────── 模拟驱动的卡牌真实边际价值 & 重配平求解 ─────────────────────────────

export interface MxCardMarginalValueRow {
  cardId: string
  cardName: string
  cost: number
  source: 'pool_add' | 'deck_remove'
  /** 加入（或保留）这张卡带来的胜率变化（百分点） */
  deltaWinPct: number
  /** 加入（或保留）这张卡节省的平均战损（HP） */
  hpSaved: number
  /** 模拟价值（HP 当量）= 节省战损 + 胜率变化 × 0.8 */
  simValue: number
  simValuePerCost: number
  linearValuePerCost: number
  simRank: number
  linearRank: number
  verdict: 'undervalued_by_formula' | 'overvalued_by_formula' | 'consistent'
}

export interface MxCardMarginalValueResult {
  baselineWinPct: number
  baselineHpLoss: number
  encounterIds: string[]
  runsPerEncounter: number
  poolRows: MxCardMarginalValueRow[]
  deckRows: MxCardMarginalValueRow[]
  medianPoolValuePerCost: number
}

interface MxDeckScore {
  win: number
  hpLoss: number
}

function scoreDeck(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig,
  deck: MxDeckCardSpec[],
  encounterIds: string[],
  runs: number
): MxDeckScore {
  let win = 0
  let loss = 0
  const relics = activeRelics(lab)
  for (const encId of encounterIds) {
    const res = runMxBattleEngineSimulation({
      deck,
      enemies: resolveMxEncounterEnemies(lab, encId),
      relics,
      playerHp: lab.playerHp,
      energyPerTurn: wb.combatKernel.energyPerTurn || 3,
      drawPerTurn: wb.combatKernel.drawPerTurn || 5,
      maxTurns: lab.maxTurns,
      policy: lab.policy === 'search' || lab.policy === 'rollout' ? 'greedy' : lab.policy,
      runs,
      seed: (wb.combatKernel.seed || 1) + 101
    })
    win += res.winRatePct
    loss += res.avgHpLoss
  }
  const n = Math.max(1, encounterIds.length)
  return { win: win / n, hpLoss: loss / n }
}

function withExtraCopy(deck: MxDeckCardSpec[], card: MxDeckCardSpec): MxDeckCardSpec[] {
  const out = deck.map((c) => ({ ...c }))
  const ex = out.find((c) => c.id === card.id)
  if (ex) ex.count = Math.max(1, ex.count || 1) + 1
  else out.push({ ...card, count: 1 })
  return out
}

function withoutOneCopy(deck: MxDeckCardSpec[], cardId: string): MxDeckCardSpec[] {
  const out: MxDeckCardSpec[] = []
  for (const c of deck) {
    if (c.id !== cardId) out.push({ ...c })
    else if ((c.count || 1) > 1) out.push({ ...c, count: (c.count || 1) - 1 })
  }
  return out
}

const r1v = (n: number): number => Math.round(n * 10) / 10
const simValueOf = (hpSaved: number, deltaWin: number): number => hpSaved + deltaWin * 0.8

function rankDesc(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
  const ranks = new Array<number>(values.length).fill(0)
  order.forEach((o, r) => (ranks[o.i] = r + 1))
  return ranks
}

function defaultValueEncounters(lab: MxCardDesignLabConfig): string[] {
  const ids = lab.encounters.filter((e) => e.tier !== 'boss').map((e) => e.id)
  return ids.length ? ids : lab.encounters.map((e) => e.id)
}

/**
 * 卡牌「真实边际价值」：
 * - 卡池卡：在当前牌组中「多加 1 张」后，跨多个遭遇（共同随机数）模拟的胜率/战损变化；
 * - 牌组卡：「去掉 1 张」后的变化（负值 = 这张卡在拖后腿，建议删除）。
 * 并与线性估值公式的排名对比，标出被公式高估/低估的卡。
 */
export function measureMxCardMarginalValues(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig,
  opts: { runs?: number; encounterIds?: string[] } = {}
): MxCardMarginalValueResult {
  const runs = Math.max(10, Math.round(opts.runs ?? 40))
  const encounterIds = opts.encounterIds?.length ? opts.encounterIds : defaultValueEncounters(lab)
  const deck = wb.combatKernel.deckCards
  const base = scoreDeck(wb, lab, deck, encounterIds, runs)

  const buildRows = (
    cards: MxDeckCardSpec[],
    source: MxCardMarginalValueRow['source']
  ): MxCardMarginalValueRow[] => {
    const raw = cards.map((card) => {
      const sc =
        source === 'pool_add'
          ? scoreDeck(wb, lab, withExtraCopy(deck, card), encounterIds, runs)
          : scoreDeck(wb, lab, withoutOneCopy(deck, card.id), encounterIds, runs)
      const deltaWin = source === 'pool_add' ? sc.win - base.win : base.win - sc.win
      const hpSaved = source === 'pool_add' ? base.hpLoss - sc.hpLoss : sc.hpLoss - base.hpLoss
      const simValue = simValueOf(hpSaved, deltaWin)
      const costDen = Math.max(0.5, card.cost)
      return {
        card,
        deltaWin,
        hpSaved,
        simValue,
        simVpc: simValue / costDen,
        linVpc: mxCardValuePerCost(card)
      }
    })
    const simRanks = rankDesc(raw.map((x) => x.simVpc))
    const linRanks = rankDesc(raw.map((x) => x.linVpc))
    const gapThreshold = Math.max(3, Math.ceil(raw.length / 4))
    return raw
      .map((x, i) => {
        const gap = linRanks[i]! - simRanks[i]!
        return {
          cardId: x.card.id,
          cardName: x.card.name,
          cost: x.card.cost,
          source,
          deltaWinPct: r1v(x.deltaWin),
          hpSaved: r1v(x.hpSaved),
          simValue: r1v(x.simValue),
          simValuePerCost: r1v(x.simVpc),
          linearValuePerCost: r1v(x.linVpc),
          simRank: simRanks[i]!,
          linearRank: linRanks[i]!,
          verdict:
            gap >= gapThreshold
              ? ('undervalued_by_formula' as const)
              : gap <= -gapThreshold
                ? ('overvalued_by_formula' as const)
                : ('consistent' as const)
        }
      })
      .sort((a, b) => b.simValuePerCost - a.simValuePerCost)
  }

  const poolRows = buildRows(lab.cardPool, 'pool_add')
  const deckRows = buildRows(deck, 'deck_remove')
  const sortedVpc = poolRows.map((r) => r.simValuePerCost).sort((a, b) => a - b)
  const median = sortedVpc.length ? sortedVpc[Math.floor(sortedVpc.length / 2)]! : 0
  return {
    baselineWinPct: r1v(base.win),
    baselineHpLoss: r1v(base.hpLoss),
    encounterIds,
    runsPerEncounter: runs,
    poolRows,
    deckRows,
    medianPoolValuePerCost: median
  }
}

export interface MxCardRebalanceSuggestion {
  cardId: string
  cardName: string
  targetValuePerCost: number
  scaleFactor: number
  achievedValuePerCost: number
  beforeScript: string
  afterScript: string
  suggestedCard: MxDeckCardSpec
}

/**
 * 数值重配平求解：在 [0.3, 3] 区间二分搜索整体数值缩放系数，
 * 使这张卡的「模拟单费价值」逼近目标（默认取卡池中位数），给出建议的新数值脚本。
 */
export function suggestMxCardRebalance(
  wb: MxNumericalWorkbench,
  lab: MxCardDesignLabConfig,
  card: MxDeckCardSpec,
  opts: { targetValuePerCost: number; runs?: number; encounterIds?: string[] }
): MxCardRebalanceSuggestion {
  const runs = Math.max(10, Math.round(opts.runs ?? 40))
  const encounterIds = opts.encounterIds?.length ? opts.encounterIds : defaultValueEncounters(lab)
  const deck = wb.combatKernel.deckCards
  const base = scoreDeck(wb, lab, deck, encounterIds, runs)
  const vpcAt = (k: number): number => {
    const scaled = mxScaleCardSpec(card, k)
    const sc = scoreDeck(wb, lab, withExtraCopy(deck, scaled), encounterIds, runs)
    return simValueOf(base.hpLoss - sc.hpLoss, sc.win - base.win) / Math.max(0.5, card.cost)
  }
  let lo = 0.3
  let hi = 3
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2
    if (vpcAt(mid) < opts.targetValuePerCost) lo = mid
    else hi = mid
  }
  const k = Math.round(((lo + hi) / 2) * 100) / 100
  const suggested = mxScaleCardSpec(card, k)
  return {
    cardId: card.id,
    cardName: card.name,
    targetValuePerCost: r1v(opts.targetValuePerCost),
    scaleFactor: k,
    achievedValuePerCost: r1v(vpcAt(k)),
    beforeScript: card.effectScript?.trim() ? card.effectScript : mxLegacyCardToScript(card),
    afterScript: suggested.effectScript?.trim()
      ? suggested.effectScript
      : mxLegacyCardToScript(suggested),
    suggestedCard: suggested
  }
}
