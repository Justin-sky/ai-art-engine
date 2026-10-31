/**
 * 通用游戏数值与肉鸽（Roguelike / DBG / TCG / ATB / Gacha）仿真工作台引擎。
 *
 * 将 `game.economy` 从单一的宏观同质代币池（Machinations `mx@2`）扩展为三层解耦的通用数值架构：
 * 1. 【乘区公式与配表超模审计层】（Multiplier Pipeline & Stat Table Budget Auditor）
 *    - 自定义属性变量、多阶段乘区公式管线、边际收益（Marginal ROI）拐点分析；
 *    - 通用实体配表（卡牌 / 随从 / 式神 / 武器 / 遗物）费效比回归与超模/废卡自动审计。
 * 2. 【多维概率、抽卡保底与词条强化层】（Gacha Pity, Equipment Sub-stat Roller & Roguelike Draft Pool）
 *    - 大小保底抽卡与奥术之尘/副产物折算（《炉石传说》开包 / 二游卡池）；
 *    - 装备/御魂/圣遗物主属性 + 4 副属性 5 次强化蒙特卡洛分布（《阴阳师》满速 +18 御魂期望体力）；
 *    - 肉鸽三选一 / 商店 Reroll 动态词条池（无放回 Unique、标签亲和度权重 Tag Affinity、前置条件锁 Prerequisite）。
 * 3. 【三大可插拔微观战斗调度内核】（Pluggable Micro-Combat Kernels）
 *    - `deck_cycle`（《杀戮尖塔》/ DBG 不放回洗抽牌库 + 能量预算 + 力量/易伤/格挡回合结算）；
 *    - `mana_tempo`（《炉石传说》/ TCG 1~10 费水晶增长 + 起手调度按费拍怪率 + 随从场面交换节奏）；
 *    - `action_bar`（《阴阳师》/《星铁》速度行动条拉条/推条/超车阈值检测 + 全队共享鬼火池断火率验算）。
 * 4. 【肉鸽全局战力包络线 vs 怪物难度膨胀墙】（Roguelike Power Envelope vs. Scaling Wall）
 *    - 模拟 1..N 层/波次中 P10（非酋）/ P50（中位）/ P90（天胡）玩家的构筑乘法成长包络线，
 *      对比关卡难度膨胀曲线，自动定位「数值劝退墙」与「后期割草崩坏层」，并计算局外养成（Meta-Progression）通关局数。
 *
 * 纯函数、无 DOM 依赖：主进程节点执行器、渲染进程工作台与引擎代码导出共用。
 */

import {
  buildGameDataTableBundle,
  type GameBattlePassRow,
  type GameCardRow,
  type GameCharacterRow,
  type GameDataTableBundle,
  type GameEquipmentUpgradeRow,
  type GameIapPackRow,
  type GameItemRow,
  type GameLevelCurveRow,
  type GameSkillRow,
  type GameWaveRow
} from './gameDataTables'
import { createMxRng, evaluateMxExpression } from './machinationsV2'
import {
  mxScaleEffectScript,
  simulateMxDeckVsDeckMatrix,
  type MxPlayPolicy
} from './cardEffectEngine'
import {
  mxShouldUseEffectEngine,
  mxShouldUseEffectEngineForMana,
  runMxDeckCycleKernelViaEffectEngine,
  runMxManaTempoKernelViaEffectEngine
} from './cardKernelBridge'
import {
  mxScaleAtbScript,
  mxShouldUseAtbEngine,
  runMxActionBarKernelViaAtbEngine
} from './atbEffectEngine'
import type { MxCardDesignLabConfig } from './cardDesignLab'
import { fillNovelGenreTemplate, type NovelGenreProfile } from './novelGenreProfiles'

// ───────────────────────────── 1. 乘区公式与配表审计层 ─────────────────────────────

export type MxWorkbenchPresetId =
  | 'slay_the_spire_dbg'
  | 'hearthstone_tcg'
  | 'onmyoji_atb'
  | 'balatro_roguelike'
  | 'survivor_brotato'
  | 'short_drama_progression'

export interface MxStatAttribute {
  id: string
  /** 公式标识符（如 ATK, CritRate, CritDmg, DEF, DefIgnore, Strength, Vulnerable） */
  name: string
  label: string
  value: number
  min: number
  max: number
  /** 每提升 1 个词条预算单位（如 1 条副属性或 1 费预算）对应的属性增量 */
  stepPerBudget: number
}

export interface MxFormulaStage {
  id: string
  name: string
  /** 可引用 MxStatAttribute.name 以及前序 stage.name */
  formula: string
}

export interface MxEntityTableRow {
  id: string
  name: string
  cost: number
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
  tags: string[]
  /** 自定义数值列，键名可在 valueFormula 中直接引用 */
  stats: Record<string, number>
}

export interface MxMultiplierPipelineConfig {
  presetId: MxWorkbenchPresetId
  title: string
  attributes: MxStatAttribute[]
  stages: MxFormulaStage[]
  /** 最终输出引用的 stage name 或直接表达式 */
  finalFormula: string
  /** 配表理论基准价值公式（可引用 cost 及全局属性，如 "2 * cost + 1" 或 "6 + 3.5 * cost"） */
  expectedBudgetFormula: string
  /** 配表行实际价值评估公式（可引用行内 stats 字段，如 "dmg * 1.0 + block * 1.0 + draw * 3.5 + vuln * 2.5"） */
  entityValueFormula: string
  statColumns: string[]
  entities: MxEntityTableRow[]
}

export interface MxMarginalReturnItem {
  attrName: string
  label: string
  currentValue: number
  stepDelta: number
  baseOutput: number
  boostedOutput: number
  /** 投入 1 单位预算带来的绝对增量 */
  marginalGain: number
  /** 投入 1 单位预算带来的百分比相对收益率 (%) */
  marginalRoiPct: number
  isOptimalNextPick: boolean
}

export interface MxMarginalCurvePoint {
  budgetStep: number
  optimalAttr: string
  totalOutput: number
  attrValues: Record<string, number>
}

export interface MxEntityAuditRow {
  id: string
  name: string
  cost: number
  rarity: string
  expectedValue: number
  actualValue: number
  /** (actual - expected) / max(1, expected) * 100 */
  deviationPct: number
  verdict: 'overpowered' | 'balanced' | 'underpowered'
}

export interface MxMultiplierAnalysisResult {
  stageValues: Record<string, number>
  finalOutput: number
  marginalReturns: MxMarginalReturnItem[]
  optimalProgression: MxMarginalCurvePoint[]
  entityAudits: MxEntityAuditRow[]
}

export function evaluateMultiplierPipeline(
  cfg: MxMultiplierPipelineConfig,
  overrideAttrs?: Record<string, number>
): { stageValues: Record<string, number>; finalOutput: number } {
  const vars: Record<string, number> = {}
  for (const attr of cfg.attributes) {
    vars[attr.name] = overrideAttrs?.[attr.name] ?? attr.value
  }
  const rng = () => 0.5
  const stageValues: Record<string, number> = {}
  for (const st of cfg.stages) {
    const val = evaluateMxExpression(st.formula, { vars, rng }, 0)
    const clean = Math.round(val * 1000) / 1000
    stageValues[st.name] = clean
    vars[st.name] = clean
  }
  const finalRaw = evaluateMxExpression(cfg.finalFormula, { vars, rng }, 0)
  return {
    stageValues,
    finalOutput: Math.round(finalRaw * 100) / 100
  }
}

export function analyzeMultiplierPipeline(
  cfg: MxMultiplierPipelineConfig,
  progressionSteps = 16
): MxMultiplierAnalysisResult {
  const baseEval = evaluateMultiplierPipeline(cfg)
  const baseOut = baseEval.finalOutput

  const marginalReturns: MxMarginalReturnItem[] = cfg.attributes.map((attr) => {
    const step = attr.stepPerBudget > 0 ? attr.stepPerBudget : 1
    const nextVal = Math.min(attr.max, attr.value + step)
    const actualStep = nextVal - attr.value
    const boosted =
      actualStep > 1e-6
        ? evaluateMultiplierPipeline(cfg, { [attr.name]: nextVal }).finalOutput
        : baseOut
    const gain = Math.round((boosted - baseOut) * 100) / 100
    const roi = baseOut > 1e-6 ? Math.round(((boosted - baseOut) / baseOut) * 10000) / 100 : 0
    return {
      attrName: attr.name,
      label: attr.label,
      currentValue: attr.value,
      stepDelta: step,
      baseOutput: baseOut,
      boostedOutput: boosted,
      marginalGain: gain,
      marginalRoiPct: roi,
      isOptimalNextPick: false
    }
  })

  let bestIdx = 0
  for (let i = 1; i < marginalReturns.length; i++) {
    if (marginalReturns[i]!.marginalGain > marginalReturns[bestIdx]!.marginalGain) {
      bestIdx = i
    }
  }
  if (marginalReturns[bestIdx]) {
    marginalReturns[bestIdx]!.isOptimalNextPick = true
  }

  // 模拟投入 N 个词条预算时的贪心最优分配轨迹（寻找属性收益拐点）
  const simAttrs: Record<string, number> = {}
  for (const a of cfg.attributes) simAttrs[a.name] = a.value
  const optimalProgression: MxMarginalCurvePoint[] = []

  for (let stepIdx = 0; stepIdx <= progressionSteps; stepIdx++) {
    const curOut = evaluateMultiplierPipeline(cfg, simAttrs).finalOutput
    let bestAttrName = cfg.attributes[0]?.name ?? ''
    let bestNextOut = curOut

    if (stepIdx < progressionSteps) {
      for (const a of cfg.attributes) {
        if (a.stepPerBudget <= 0) continue
        const curV = simAttrs[a.name] ?? a.value
        if (curV + a.stepPerBudget > a.max + 1e-6) continue
        const trialOut = evaluateMultiplierPipeline(cfg, {
          ...simAttrs,
          [a.name]: curV + a.stepPerBudget
        }).finalOutput
        if (trialOut > bestNextOut) {
          bestNextOut = trialOut
          bestAttrName = a.name
        }
      }
    }

    optimalProgression.push({
      budgetStep: stepIdx,
      optimalAttr: stepIdx === 0 ? 'Initial' : bestAttrName,
      totalOutput: curOut,
      attrValues: { ...simAttrs }
    })

    if (stepIdx < progressionSteps && bestAttrName) {
      const targetAttr = cfg.attributes.find((x) => x.name === bestAttrName)
      if (targetAttr) {
        simAttrs[bestAttrName] = Math.min(
          targetAttr.max,
          Math.round(
            ((simAttrs[bestAttrName] ?? targetAttr.value) + targetAttr.stepPerBudget) * 1000
          ) / 1000
        )
      }
    }
  }

  // 实体配表费效比与超模审计
  const baseVars: Record<string, number> = {}
  for (const a of cfg.attributes) baseVars[a.name] = a.value
  const rng = () => 0.5

  const entityAudits: MxEntityAuditRow[] = cfg.entities.map((ent) => {
    const rowVars: Record<string, number> = {
      ...baseVars,
      ...ent.stats,
      cost: ent.cost,
      mana: ent.cost
    }
    const expected = Math.max(
      0.5,
      Math.round(evaluateMxExpression(cfg.expectedBudgetFormula, { vars: rowVars, rng }, 1) * 100) /
        100
    )
    const actual =
      Math.round(evaluateMxExpression(cfg.entityValueFormula, { vars: rowVars, rng }, 0) * 100) /
      100
    const dev = Math.round(((actual - expected) / expected) * 1000) / 10
    const verdict: MxEntityAuditRow['verdict'] =
      dev >= 18 ? 'overpowered' : dev <= -18 ? 'underpowered' : 'balanced'
    return {
      id: ent.id,
      name: ent.name,
      cost: ent.cost,
      rarity: ent.rarity,
      expectedValue: expected,
      actualValue: actual,
      deviationPct: dev,
      verdict
    }
  })

  return {
    stageValues: baseEval.stageValues,
    finalOutput: baseOut,
    marginalReturns,
    optimalProgression,
    entityAudits
  }
}

/**
 * 商业产品级：一键配平超模/欠模实体配表（1-Click Entity Budget Auto-Balancer）：
 * 针对偏差超出 ±12% 的卡牌/技能/装备行，自动反推并微调其主属性（如 dmg / block / atk / chips），
 * 使其实际评估价值收敛至理论费用预算基准线（[-5%, +5%] 健康带）。
 */
export function autoBalanceWorkbenchEntities(cfg: MxMultiplierPipelineConfig): {
  updatedEntities: MxEntityTableRow[]
  adjustedCount: number
} {
  const baseVars: Record<string, number> = {}
  for (const a of cfg.attributes) baseVars[a.name] = a.value
  const rng = () => 0.5
  const preferredKeys = [
    'dmg',
    'damage',
    'atk',
    'chips',
    'block',
    'shield',
    'hp',
    'mult',
    'draw',
    'vuln'
  ]

  let adjustedCount = 0
  const updatedEntities: MxEntityTableRow[] = cfg.entities.map((ent) => {
    const newStats: Record<string, number> = { ...ent.stats }
    const rowVars: Record<string, number> = {
      ...baseVars,
      ...newStats,
      cost: ent.cost,
      mana: ent.cost
    }
    const expected = Math.max(
      0.5,
      Math.round(evaluateMxExpression(cfg.expectedBudgetFormula, { vars: rowVars, rng }, 1) * 100) /
        100
    )
    const actual =
      Math.round(evaluateMxExpression(cfg.entityValueFormula, { vars: rowVars, rng }, 0) * 100) /
      100
    const dev = ((actual - expected) / expected) * 100
    if (Math.abs(dev) < 12) {
      return { ...ent, stats: newStats }
    }

    // 寻找最适合微调的主属性列（优先选择当前值 > 0 的主属性）
    const statKeys = cfg.statColumns.length ? cfg.statColumns : Object.keys(newStats)
    const positiveKeys = statKeys.filter((k) => (newStats[k] ?? 0) > 0)
    // 若存在多项正属性且整体严重超模，先按比例收敛非主属性，再精确求解主属性
    if (positiveKeys.length > 1 && actual > expected) {
      const scale = expected / Math.max(0.5, actual)
      for (let i = 1; i < positiveKeys.length; i++) {
        const k = positiveKeys[i]!
        newStats[k] = Math.max(0, Math.floor((newStats[k] ?? 0) * scale))
        rowVars[k] = newStats[k]!
      }
    }

    const targetKey =
      preferredKeys.find((k) => statKeys.includes(k) && (newStats[k] ?? 0) > 0) ??
      statKeys.find((k) => (newStats[k] ?? 0) > 0) ??
      statKeys[0]
    if (!targetKey) {
      return { ...ent, stats: newStats }
    }

    const curVal = newStats[targetKey] ?? 0
    let lo = 0
    let hi = Math.max(20, curVal * 4 + 20)
    let bestVal = curVal
    let bestDiff = Math.abs(
      evaluateMxExpression(cfg.entityValueFormula, { vars: rowVars, rng }, 0) - expected
    )

    for (let step = 0; step <= 80; step++) {
      const candidateRaw =
        step === 0
          ? Math.max(0, curVal * (expected / Math.max(0.5, actual)))
          : lo + ((hi - lo) * step) / 80
      for (const candidate of [
        Math.max(0, Math.round(candidateRaw)),
        Math.max(0, Math.round(candidateRaw * 2) / 2)
      ]) {
        const trialVars: Record<string, number> = {
          ...rowVars,
          [targetKey]: candidate
        }
        const trialActual = evaluateMxExpression(
          cfg.entityValueFormula,
          { vars: trialVars, rng },
          0
        )
        const diff = Math.abs(trialActual - expected)
        if (diff < bestDiff - 1e-4) {
          bestDiff = diff
          bestVal = candidate
        }
      }
    }

    newStats[targetKey] = bestVal
    const changed = statKeys.some((k) => Math.abs((newStats[k] ?? 0) - (ent.stats[k] ?? 0)) > 1e-4)
    if (changed) {
      adjustedCount++
    }
    return {
      ...ent,
      stats: newStats
    }
  })

  return { updatedEntities, adjustedCount }
}

// ───────────────────────────── 2. 多维概率、保底与御魂/词条强化层 ─────────────────────────────

export type MxLootRollMode = 'gacha_pity' | 'substat_enhance' | 'roguelike_draft'

export interface MxSubstatWeightItem {
  id: string
  name: string
  weight: number
  /** 每次强化命中时可能的随机档位（如阴阳师速度 2.4, 2.7, 3.0） */
  rollTiers: number[]
}

export interface MxDraftPoolItem {
  id: string
  name: string
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
  baseWeight: number
  tags: string[]
  unique: boolean
  /** 前置依赖的组件 ID（如《黑帝斯》双重祝福需先持有两个主神祝福） */
  prerequisiteIds?: string[]
  /** 选定后对总构筑分数的加算/乘算贡献 */
  addPower: number
  multPower: number
}

export interface MxLootRollConfig {
  mode: MxLootRollMode
  runs: number
  seed: number

  // Mode A: Gacha Pity & Dust (炉石开包 / 阴阳师蓝票 / 二游大小保底)
  baseSsrRatePct: number
  softPityStart: number
  softPitySlopePct: number
  hardPityPull: number
  upGuarantee5050: boolean
  targetCopies: number
  costPerPull: number
  dupeDustYield: number

  // Mode B: Equipment Sub-stat Enhancement (阴阳师御魂 +15 满速 / 圣遗物双暴)
  staminaPerDrop: number
  targetSlotDropRatePct: number
  targetMainStatRatePct: number
  fourLineInitRatePct: number
  upgradeLevels: number // 默认 5 次 (+3/+6/+9/+12/+15)
  targetSubstatName: string
  targetSubstatThreshold: number // 如 SPD >= 16（头/满速胚子）
  substatPool: MxSubstatWeightItem[]

  // Mode C: Roguelike Draft & Shop Reroll (杀戮尖塔 / 小丑牌 Balatro / Brotato 凑羁绊)
  draftWaves: number
  choicesPerDraft: number
  rerollsPerWave: number
  rerollBaseCost: number
  rerollCostStep: number
  targetSynergyTag: string
  targetSynergyCount: number
  /** 每持有一个同标签组件，后续刷出同标签组件的权重加成百分比 */
  tagAffinityBonusPct: number
  /** 玩家可禁用（Ban位）的非目标流派数量（默认 0） */
  banSlotsCount?: number
  /** 池内参与竞争的总流派数（用于验算版本扩容导致的池稀释，默认 4） */
  competingArchetypes?: number
  /** 连续未刷出目标标签时的动态保底权重补偿百分比（默认 0） */
  pityMissStreakBoostPct?: number
  /** 装备最高强化等级（默认 15，即 +1 ~ +15） */
  equipMaxEnhanceLevel?: number
  /** 装备初始主属性（默认 47） */
  equipBaseMainStat?: number
  /** 每强化 +1 增加的主属性（默认 18） */
  equipMainStatStep?: number
  /** 强化经验消耗增长指数（默认 1.38） */
  equipExpGrowthExponent?: number
  /** +5 之后每级强化成功率衰减百分比 (%)（0 表示 100% 必成狗粮模式，>0 表示铁匠铺概率失败模式，默认 6） */
  equipSuccessDecayAfter5Pct?: number
  draftPool: MxDraftPoolItem[]
}

export interface MxPoolDilutionRow {
  archetypesCount: number
  effectivePoolSize: number
  noBanCompletionPct: number
  withBanCompletionPct: number
  expectedGoldCost: number
  verdict: 'healthy' | 'diluted' | 'collapsed'
}

export interface MxLootSimulationResult {
  mode: MxLootRollMode
  runs: number
  /** 达成目标的概率 (0..100%) */
  successRatePct: number
  /** 达成目标所需抽数/刷本数/波次的 P10 / P50 / P90 / Mean */
  attemptsP10: number
  attemptsP50: number
  attemptsP90: number
  attemptsMean: number
  /** 期望消耗的货币/体力/金币（P10 / P50 / P90 / Mean） */
  costP10: number
  costP50: number
  costP90: number
  costMean: number
  /** 副产物（奥术之尘/狗粮胚子）均值，或最高词条数值 P90 */
  secondaryMetricMean: number
  secondaryMetricLabel: string
  /** 分布直方图（10 个分桶） */
  histogram: Array<{ bucketLabel: string; count: number; pct: number }>
  /** 逐波次/逐抽数累计达成率曲线 */
  cumulativeCurve: Array<{ x: number; ratePct: number }>
}

function percentileOfSorted(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)))
  return Math.round(sorted[idx]! * 100) / 100
}

export function runMxLootAndSubstatSimulation(cfg: MxLootRollConfig): MxLootSimulationResult {
  const runs = Math.max(10, Math.min(5000, Math.round(cfg.runs || 500)))
  const baseSeed = cfg.seed || 2026

  if (cfg.mode === 'gacha_pity') {
    const pullsNeeded: number[] = []
    const dustsEarned: number[] = []
    const targetCopies = Math.max(1, Math.min(10, Math.round(cfg.targetCopies || 1)))
    const hardPity = Math.max(1, Math.round(cfg.hardPityPull || 90))
    const softStart = Math.max(1, Math.round(cfg.softPityStart || 74))
    const baseRate = Math.max(0.01, cfg.baseSsrRatePct) / 100
    const slope = Math.max(0, cfg.softPitySlopePct) / 100

    for (let r = 0; r < runs; r++) {
      const rng = createMxRng(baseSeed + (r + 1) * 7919)
      let copies = 0
      let pity = 0
      let guaranteedUp = false
      let totalPulls = 0
      let dust = 0

      while (copies < targetCopies && totalPulls < hardPity * targetCopies * 2) {
        totalPulls++
        pity++
        const curRate =
          pity >= hardPity
            ? 1.0
            : pity >= softStart
              ? Math.min(1.0, baseRate + (pity - softStart + 1) * slope)
              : baseRate
        if (rng() < curRate) {
          pity = 0
          if (!cfg.upGuarantee5050 || guaranteedUp || rng() < 0.5) {
            copies++
            guaranteedUp = false
          } else {
            guaranteedUp = true
            dust += cfg.dupeDustYield * 4
          }
        } else {
          dust += cfg.dupeDustYield
        }
      }
      pullsNeeded.push(totalPulls)
      dustsEarned.push(dust)
    }

    const sorted = [...pullsNeeded].sort((a, b) => a - b)
    const p10 = percentileOfSorted(sorted, 0.1)
    const p50 = percentileOfSorted(sorted, 0.5)
    const p90 = percentileOfSorted(sorted, 0.9)
    const mean = Math.round((pullsNeeded.reduce((a, b) => a + b, 0) / runs) * 10) / 10
    const dustMean = Math.round(dustsEarned.reduce((a, b) => a + b, 0) / runs)

    const minV = sorted[0] ?? 1
    const maxV = Math.max(minV + 9, sorted[sorted.length - 1] ?? 90)
    const step = (maxV - minV) / 8
    const histogram = Array.from({ length: 8 }, (_, i) => {
      const lo = Math.round(minV + i * step)
      const hi = Math.round(minV + (i + 1) * step)
      const cnt = pullsNeeded.filter((v) =>
        i === 7 ? v >= lo && v <= hi : v >= lo && v < hi
      ).length
      return {
        bucketLabel: `${lo}-${hi}`,
        count: cnt,
        pct: Math.round((cnt / runs) * 1000) / 10
      }
    })

    const cumulativeCurve: Array<{ x: number; ratePct: number }> = []
    for (let i = 0; i <= 10; i++) {
      const x = Math.round((maxV * i) / 10)
      const cnt = sorted.filter((v) => v <= x).length
      cumulativeCurve.push({ x, ratePct: Math.round((cnt / runs) * 1000) / 10 })
    }

    return {
      mode: 'gacha_pity',
      runs,
      successRatePct: 100,
      attemptsP10: p10,
      attemptsP50: p50,
      attemptsP90: p90,
      attemptsMean: mean,
      costP10: Math.round(p10 * cfg.costPerPull),
      costP50: Math.round(p50 * cfg.costPerPull),
      costP90: Math.round(p90 * cfg.costPerPull),
      costMean: Math.round(mean * cfg.costPerPull),
      secondaryMetricMean: dustMean,
      secondaryMetricLabel: 'Expected Dust / Byproduct',
      histogram,
      cumulativeCurve
    }
  }

  if (cfg.mode === 'substat_enhance') {
    // 模拟每次胚子强化（从已掉出目标位置+主属性的胚子开始，计算强化出 >= 阈值所需的胚子数，再折算总刷本数与体力）
    const pool = cfg.substatPool.length
      ? cfg.substatPool
      : [
          { id: 'spd', name: 'SPD', weight: 10, rollTiers: [2.4, 2.7, 3.0] },
          { id: 'crit', name: 'CRIT', weight: 10, rollTiers: [2.4, 2.7, 3.0] },
          { id: 'cdmg', name: 'CDMG', weight: 10, rollTiers: [3.2, 3.6, 4.0] },
          { id: 'atk', name: 'ATK%', weight: 15, rollTiers: [2.4, 2.7, 3.0] },
          { id: 'hp', name: 'HP%', weight: 20, rollTiers: [2.4, 2.7, 3.0] },
          { id: 'def', name: 'DEF%', weight: 20, rollTiers: [2.4, 2.7, 3.0] }
        ]
    const targetName = cfg.targetSubstatName || pool[0]!.name
    const targetThreshold = cfg.targetSubstatThreshold || 15
    const fourLineProb = Math.max(0, Math.min(1, cfg.fourLineInitRatePct / 100))
    const upLevels = Math.max(1, Math.min(8, Math.round(cfg.upgradeLevels || 5)))

    const sampleCount = Math.max(1000, runs * 4)
    const rolledTargetValues: number[] = []
    let hitCount = 0

    for (let i = 0; i < sampleCount; i++) {
      const rng = createMxRng(baseSeed + (i + 1) * 7919)
      const initCount = rng() < fourLineProb ? 4 : 3
      const chosen: MxSubstatWeightItem[] = []
      const remaining = [...pool]
      for (let k = 0; k < initCount && remaining.length > 0; k++) {
        const totalW = remaining.reduce((acc, it) => acc + Math.max(0.1, it.weight), 0)
        let rVal = rng() * totalW
        let pickIdx = 0
        for (let j = 0; j < remaining.length; j++) {
          rVal -= Math.max(0.1, remaining[j]!.weight)
          if (rVal <= 0) {
            pickIdx = j
            break
          }
        }
        chosen.push(remaining[pickIdx]!)
        remaining.splice(pickIdx, 1)
      }

      const statSums: Record<string, number> = {}
      for (const c of chosen) {
        const tiers = c.rollTiers.length ? c.rollTiers : [2.7]
        statSums[c.name] = tiers[Math.floor(rng() * tiers.length)]!
      }

      for (let lv = 0; lv < upLevels; lv++) {
        if (chosen.length < 4 && remaining.length > 0) {
          // 初始 3 词条胚子第 1 次强化先补齐第 4 条副属性
          const totalW = remaining.reduce((acc, it) => acc + Math.max(0.1, it.weight), 0)
          let rVal = rng() * totalW
          let pickIdx = 0
          for (let j = 0; j < remaining.length; j++) {
            rVal -= Math.max(0.1, remaining[j]!.weight)
            if (rVal <= 0) {
              pickIdx = j
              break
            }
          }
          const added = remaining[pickIdx]!
          chosen.push(added)
          remaining.splice(pickIdx, 1)
          const tiers = added.rollTiers.length ? added.rollTiers : [2.7]
          statSums[added.name] =
            (statSums[added.name] ?? 0) + tiers[Math.floor(rng() * tiers.length)]!
        } else if (chosen.length > 0) {
          const hitSub = chosen[Math.floor(rng() * chosen.length)]!
          const tiers = hitSub.rollTiers.length ? hitSub.rollTiers : [2.7]
          statSums[hitSub.name] =
            (statSums[hitSub.name] ?? 0) + tiers[Math.floor(rng() * tiers.length)]!
        }
      }

      const finalTargetVal = Math.round((statSums[targetName] ?? 0) * 100) / 100
      rolledTargetValues.push(finalTargetVal)
      if (finalTargetVal + 1e-6 >= targetThreshold) hitCount++
    }

    const baseEmbryoHitRate = Math.max(1 / sampleCount, hitCount / sampleCount)
    const slotRate = Math.max(0.001, cfg.targetSlotDropRatePct / 100)
    const mainRate = Math.max(0.001, cfg.targetMainStatRatePct / 100)
    const overallDropHitProb = baseEmbryoHitRate * slotRate * mainRate

    // 几何分布计算 P10 / P50 / P90 刷本掉率次数
    const runsForQuantile = (q: number): number =>
      Math.max(1, Math.round(Math.log(1 - q) / Math.log(Math.max(1e-6, 1 - overallDropHitProb))))

    const p10 = runsForQuantile(0.1)
    const p50 = runsForQuantile(0.5)
    const p90 = runsForQuantile(0.9)
    const mean = Math.max(1, Math.round(1 / overallDropHitProb))
    const sortedVals = [...rolledTargetValues].sort((a, b) => a - b)
    const p90StatVal = percentileOfSorted(sortedVals, 0.95)

    const maxStat = Math.max(targetThreshold, sortedVals[sortedVals.length - 1] ?? 18)
    const step = Math.max(1, maxStat / 6)
    const histogram = Array.from({ length: 6 }, (_, i) => {
      const lo = Math.round(i * step * 10) / 10
      const hi = Math.round((i + 1) * step * 10) / 10
      const cnt = rolledTargetValues.filter((v) => (i === 5 ? v >= lo : v >= lo && v < hi)).length
      return {
        bucketLabel: `${lo}~${hi}`,
        count: cnt,
        pct: Math.round((cnt / sampleCount) * 1000) / 10
      }
    })

    const cumulativeCurve: Array<{ x: number; ratePct: number }> = []
    for (let i = 0; i <= 10; i++) {
      const nDrops = Math.round((p90 * i) / 10)
      const prob = 1 - Math.pow(1 - overallDropHitProb, nDrops)
      cumulativeCurve.push({ x: nDrops, ratePct: Math.round(prob * 1000) / 10 })
    }

    return {
      mode: 'substat_enhance',
      runs: sampleCount,
      successRatePct: Math.round(baseEmbryoHitRate * 10000) / 100,
      attemptsP10: p10,
      attemptsP50: p50,
      attemptsP90: p90,
      attemptsMean: mean,
      costP10: Math.round(p10 * cfg.staminaPerDrop),
      costP50: Math.round(p50 * cfg.staminaPerDrop),
      costP90: Math.round(p90 * cfg.staminaPerDrop),
      costMean: Math.round(mean * cfg.staminaPerDrop),
      secondaryMetricMean: p90StatVal,
      secondaryMetricLabel: `P95 ${targetName} Roll`,
      histogram,
      cumulativeCurve
    }
  }

  // Mode C: Roguelike Draft & Shop Reroll Synergy Pool
  const waves = Math.max(3, Math.min(50, Math.round(cfg.draftWaves || 15)))
  const choices = Math.max(1, Math.min(6, Math.round(cfg.choicesPerDraft || 3)))
  const maxRerolls = Math.max(0, Math.min(10, Math.round(cfg.rerollsPerWave ?? 1)))
  const targetTag = (cfg.targetSynergyTag || 'synergy').trim().toLowerCase()
  const targetCount = Math.max(1, Math.min(12, Math.round(cfg.targetSynergyCount || 4)))
  const affinityBonus = Math.max(0, cfg.tagAffinityBonusPct || 0) / 100
  const banSlots = Math.max(0, Math.min(5, Math.round(cfg.banSlotsCount ?? 0)))
  const competingArchetypes = Math.max(2, Math.min(12, Math.round(cfg.competingArchetypes ?? 4)))
  const pityBoost = Math.max(0, cfg.pityMissStreakBoostPct ?? 0) / 100

  // 统计非目标标签集合，若设置了 Ban 位或流派扩容系数，动态调整非目标流派权重
  const nonTargetTags = Array.from(
    new Set(
      cfg.draftPool
        .flatMap((it) => it.tags.map((t) => t.toLowerCase()))
        .filter((t) => t !== targetTag)
    )
  )
  const bannedTagSet = new Set(nonTargetTags.slice(0, banSlots))
  const baselineOtherArchetypes = Math.max(1, nonTargetTags.length || 3)
  const effectiveOtherArchetypes = Math.max(1, competingArchetypes - 1 - banSlots)
  const dilutionWeightScale = effectiveOtherArchetypes / baselineOtherArchetypes

  const wavesToComplete: number[] = []
  const goldSpentList: number[] = []
  const finalTagCounts: number[] = []
  let completedRuns = 0
  const completedByWave = new Array<number>(waves + 1).fill(0)

  for (let r = 0; r < runs; r++) {
    const rng = createMxRng(baseSeed + (r + 1) * 7919)
    const ownedIds = new Set<string>()
    let tagCount = 0
    let missStreak = 0
    let completedAtWave: number | null = null
    let goldSpent = 0

    for (let w = 1; w <= waves; w++) {
      let pickedThisWave = false
      for (let rr = 0; rr <= maxRerolls; rr++) {
        if (rr > 0) {
          goldSpent += cfg.rerollBaseCost + (rr - 1) * cfg.rerollCostStep
        }
        // 过滤满足前置条件、未被 Ban 位排除且未因 Unique 被拿空的候选池
        const eligible = cfg.draftPool.filter((item) => {
          if (item.unique && ownedIds.has(item.id)) return false
          const itemTags = item.tags.map((t) => t.toLowerCase())
          if (
            !itemTags.includes(targetTag) &&
            itemTags.length > 0 &&
            itemTags.every((t) => bannedTagSet.has(t))
          ) {
            return false
          }
          if (item.prerequisiteIds?.length) {
            return item.prerequisiteIds.every((pid) => ownedIds.has(pid))
          }
          return true
        })
        if (!eligible.length) break

        // 抽 choices 个不重复候选项
        const offered: MxDraftPoolItem[] = []
        const tempPool = [...eligible]
        for (let c = 0; c < choices && tempPool.length > 0; c++) {
          const weights = tempPool.map((it) => {
            const hasTargetTag = it.tags.some((t) => t.toLowerCase() === targetTag)
            const mult = hasTargetTag
              ? 1 + tagCount * affinityBonus + missStreak * pityBoost
              : Math.max(0.25, dilutionWeightScale)
            return Math.max(0.1, it.baseWeight * mult)
          })
          const sumW = weights.reduce((a, b) => a + b, 0)
          let roll = rng() * sumW
          let idx = 0
          for (let j = 0; j < weights.length; j++) {
            roll -= weights[j]!
            if (roll <= 0) {
              idx = j
              break
            }
          }
          offered.push(tempPool[idx]!)
          tempPool.splice(idx, 1)
        }

        // 玩家优先选择带目标流派标签的最高价值组件
        const matchItem = offered.find((it) => it.tags.some((t) => t.toLowerCase() === targetTag))
        if (matchItem) {
          ownedIds.add(matchItem.id)
          tagCount++
          missStreak = 0
          pickedThisWave = true
          break
        } else if (rr === maxRerolls && offered[0]) {
          ownedIds.add(offered[0].id)
          missStreak++
        }
      }
      void pickedThisWave
      if (completedAtWave === null && tagCount >= targetCount) {
        completedAtWave = w
      }
      if (completedAtWave !== null) {
        completedByWave[w] = (completedByWave[w] ?? 0) + 1
      }
    }

    if (completedAtWave !== null) {
      completedRuns++
      wavesToComplete.push(completedAtWave)
    } else {
      wavesToComplete.push(waves + 1)
    }
    goldSpentList.push(goldSpent)
    finalTagCounts.push(tagCount)
  }

  const sortedWaves = [...wavesToComplete].sort((a, b) => a - b)
  const p10 = percentileOfSorted(sortedWaves, 0.1)
  const p50 = percentileOfSorted(sortedWaves, 0.5)
  const p90 = percentileOfSorted(sortedWaves, 0.9)
  const mean = Math.round((wavesToComplete.reduce((a, b) => a + b, 0) / runs) * 10) / 10
  const sortedGold = [...goldSpentList].sort((a, b) => a - b)
  const avgTagPieces = Math.round((finalTagCounts.reduce((a, b) => a + b, 0) / runs) * 100) / 100

  const maxTagObs = Math.max(targetCount + 1, ...finalTagCounts)
  const histogram = Array.from({ length: Math.min(7, maxTagObs + 1) }, (_, i) => {
    const cnt = finalTagCounts.filter((v) => (i === 6 ? v >= i : v === i)).length
    return {
      bucketLabel: i === 6 ? `${i}+ pcs` : `${i} pcs`,
      count: cnt,
      pct: Math.round((cnt / runs) * 1000) / 10
    }
  })

  const cumulativeCurve = Array.from({ length: waves }, (_, i) => {
    const w = i + 1
    return {
      x: w,
      ratePct: Math.round(((completedByWave[w] ?? 0) / runs) * 1000) / 10
    }
  })

  return {
    mode: 'roguelike_draft',
    runs,
    successRatePct: Math.round((completedRuns / runs) * 1000) / 10,
    attemptsP10: p10,
    attemptsP50: p50,
    attemptsP90: p90,
    attemptsMean: mean,
    costP10: percentileOfSorted(sortedGold, 0.1),
    costP50: percentileOfSorted(sortedGold, 0.5),
    costP90: percentileOfSorted(sortedGold, 0.9),
    costMean: Math.round(goldSpentList.reduce((a, b) => a + b, 0) / runs),
    secondaryMetricMean: avgTagPieces,
    secondaryMetricLabel: `Avg [${targetTag}] Pieces`,
    histogram,
    cumulativeCurve
  }
}

/**
 * 多流派奖池稀释与 Ban 位/动态保底补偿模拟（Pool Dilution & Ban-Slot Analysis）：
 * 扫描当游戏流派数从 3 扩容至 8 时，无 Ban 位与开启 Ban 位/保底补偿下的羁绊成型率衰减曲线。
 */
export function runMxPoolDilutionAnalysis(cfg: MxLootRollConfig): MxPoolDilutionRow[] {
  const basePoolLen = Math.max(6, cfg.draftPool.length)
  const banCount = Math.max(1, Math.round(cfg.banSlotsCount || 1))
  const pityBoost = Math.max(15, Math.round(cfg.pityMissStreakBoostPct || 20))
  const archetypeSteps = [3, 4, 5, 6, 7, 8]

  return archetypeSteps.map((archCount) => {
    const noBanRes = runMxLootAndSubstatSimulation({
      ...cfg,
      mode: 'roguelike_draft',
      runs: Math.min(250, Math.max(80, cfg.runs || 200)),
      competingArchetypes: archCount,
      banSlotsCount: 0,
      pityMissStreakBoostPct: 0
    })
    const withBanRes = runMxLootAndSubstatSimulation({
      ...cfg,
      mode: 'roguelike_draft',
      runs: Math.min(250, Math.max(80, cfg.runs || 200)),
      competingArchetypes: archCount,
      banSlotsCount: banCount,
      pityMissStreakBoostPct: pityBoost
    })
    const verdict: MxPoolDilutionRow['verdict'] =
      noBanRes.successRatePct >= 55
        ? 'healthy'
        : noBanRes.successRatePct >= 30
          ? 'diluted'
          : 'collapsed'
    return {
      archetypesCount: archCount,
      effectivePoolSize: Math.round((basePoolLen * archCount) / 4),
      noBanCompletionPct: noBanRes.successRatePct,
      withBanCompletionPct: withBanRes.successRatePct,
      expectedGoldCost: noBanRes.costP50,
      verdict
    }
  })
}

// ───────────────────────────── 3. 三大可插拔微观战斗调度内核 ─────────────────────────────

export type MxCombatKernelKind = 'deck_cycle' | 'mana_tempo' | 'action_bar'

export interface MxDeckCardSpec {
  id: string
  name: string
  cost: number
  count: number
  damage: number
  /** 连击段数（默认 1，每段均受力量与易伤加成） */
  hits?: number
  block: number
  draw: number
  energyGain: number
  applyStrength: number
  applyVulnerable: number
  applyWeak: number
  /** 施加中毒/流血层数（每回合造成对应层数伤害并递减 1） */
  poison?: number
  /** 治疗/吸血回复生命值 */
  heal?: number
  exhaust: boolean
  /** AI 出牌优先级（越高越先打出） */
  priority: number
  /** 用户自定义扩展数值列 */
  customStats?: Record<string, number>
  /**
   * 卡牌效果脚本（可选）。若填写，则由 cardEffectEngine 解释执行，覆盖上述基础字段的效果语义。
   * 例：`dmg 6x2; if hand<=2: draw 2; kw exhaust`（详见 parseMxCardEffectScript）
   */
  effectScript?: string
  /** 卡牌稀有度（用于卡池抽取权重与单局经济闭环） */
  rarity?: 'common' | 'uncommon' | 'rare'
}

export interface MxManaCurveCardSpec {
  id: string
  name: string
  manaCost: number
  count: number
  kind: 'minion' | 'spell'
  attack: number
  health: number
  directDamage: number
  drawCards: number
  taunt?: boolean
  divineShield?: boolean
  /** 用户自定义扩展数值列 */
  customStats?: Record<string, number>
  /**
   * 可选效果脚本：填写后 mana_tempo 内核改由卡牌效果引擎驱动，
   * 例如 `summon 3/2 divine; deathrattle: dmg 2`；留空时按攻/血/直伤/抽牌列自动生成。
   */
  effectScript?: string
}

export interface MxActionBarUnitSpec {
  id: string
  name: string
  team: 'ally' | 'enemy'
  speed: number
  attack: number
  critDamageMult: number
  skillRatio: number
  orbCost: number
  /** 技能拉条幅度（如镰鼬/山兔 +30%） */
  pullGaugePct: number
  /** 技能推条幅度（如食发鬼 -20%） */
  pushGaugePct: number
  /** 被动或技能回火量（如座敷童子 +3 火） */
  orbGain: number
  /** ATB 效果引擎：单位血量 / 防御（缺省时敌方平分目标血量、我方 12000） */
  hp?: number
  def?: number
  /**
   * ATB 技能脚本（填写后 action_bar 内核改由 ATB 效果引擎驱动，敌方也会出手），
   * 例如 `dmg 1.2x3 @all; push 20 @all` / `heal 15% @allies` / `pull 30; spd 20`
   */
  skillScript?: string
  /** 普攻脚本（缺省 `dmg 1`） */
  basicScript?: string
}

export type MxEnemyMechanismKind =
  | 'standard'
  | 'aoe_swarm'
  | 'status_polluter'
  | 'card_limit_punisher'
  | 'thorns_armor'
  | 'berserk_race'

export interface MxEncounterCounterRow {
  mechanism: MxEnemyMechanismKind
  nameZh: string
  nameEn: string
  winRatePct: number
  ttkP50: number
  avgHpLoss: number
  verdict: 'favored' | 'skill_check' | 'countered'
}

export interface MxDeckRemovalRoiRow {
  deltaCards: number
  labelZh: string
  labelEn: string
  deckSize: number
  turn1CoreDrawPct: number
  winRatePct: number
  ttkP50: number
  avgHpLoss: number
  hpSavedVsBase: number
  fairShopGoldPrice: number
}

export type MxRelicTriggerPreset =
  'none' | 'shuriken_kunai' | 'necronomicon' | 'dead_branch' | 'all_synergy'

export interface MxCombatKernelConfig {
  kernel: MxCombatKernelKind
  runs: number
  maxTurns: number
  seed: number

  // Kernel A: Deck-Cycle (《杀戮尖塔》/ DBG)
  playerHp: number
  energyPerTurn: number
  drawPerTurn: number
  enemyHp: number
  enemyBaseDamage: number
  enemyDamageGrowth: number
  /** 敌人机制检定类型（默认 standard 木桩，支持群怪/塞状态废牌/出牌限制/反伤护甲/狂暴检定） */
  enemyMechanism?: MxEnemyMechanismKind
  /** 被动遗物触发器钩子预设（手里剑+苦无/死灵之书/枯木树枝/全开协同） */
  relicTriggerPreset?: MxRelicTriggerPreset
  /** 塞状态卡检定下每回合塞入抽弃牌堆的眩晕/伤口废牌数（默认 1） */
  statusCardsPerTurn?: number
  /** 出牌限制检定下每回合最多允许打出的卡牌张数（如时间吞噬者，默认 5） */
  cardPlayLimitPerTurn?: number
  /** 反伤检定下每次攻击命中受到的荆棘反伤（默认 2） */
  enemyThornsDamage?: number
  deckCards: MxDeckCardSpec[]
  /** 牌库表当前激活展示的列标识列表（可自由增删） */
  deckActiveColumns?: string[]
  /** deck_cycle / mana_tempo 内核改用卡牌效果引擎（卡组含 effectScript 时自动开启） */
  useEffectEngine?: boolean
  /** 效果引擎出牌策略（random / greedy / search，默认 greedy） */
  playPolicy?: MxPlayPolicy

  // Kernel B: Mana-Curve & Board Tempo (《炉石传说》/ TCG)
  maxManaCrystals: number
  startingHandSize: number
  mulliganMaxCost: number
  opponentHp: number
  opponentClearPowerPerTurn: number
  manaCurveDeck: MxManaCurveCardSpec[]
  /** 法力卡组表当前激活展示的列标识列表（可自由增删） */
  manaActiveColumns?: string[]

  // Kernel C: Action-Bar & Shared Orb Pool (《阴阳师》/《星铁》ATB)
  trackDistance: number
  initialOrbs: number
  maxOrbs: number
  /** 行动条每满 5 格自动回复鬼火数量（阴阳师回火条机制） */
  orbRecoveryPer5Actions: number
  targetEnemyHp: number
  targetEnemyDef: number
  actionUnits: MxActionBarUnitSpec[]
  /** 商业产品级：用户自定义保存的对标流派槽位牌库（用于 4 流派天梯矩阵自定义对标） */
  customArchetypeDecks?: Partial<
    Record<'strength_burst' | 'attrition_block' | 'high_cycle_combo', MxDeckCardSpec[]>
  >
}

export interface MxTurnMetricPoint {
  turn: number
  primaryP10: number
  primaryP50: number
  primaryP90: number
  secondaryMean: number
  ratePct: number
}

export interface MxActionBarTurnEvent {
  actionIndex: number
  unitName: string
  team: 'ally' | 'enemy'
  speed: number
  orbsBefore: number
  orbsAfter: number
  skillCast: boolean
  starvedOrb: boolean
  damageDealt: number
  pulledGaugePct: number
}

export interface MxCombatTurnReplayItem {
  turn: number
  cardsPlayed: string[]
  energyUsed: string
  damageDealt: number
  blockGained: number
  relicsTriggered: string[]
  enemyAction: string
  playerHpAfter: number
  enemyHpAfter: number
}

export interface MxCombatKernelResult {
  kernel: MxCombatKernelKind
  runs: number
  /** 胜率 / 斩杀率 (%) */
  winRatePct: number
  /** 击杀回合 / 斩杀回合 TTK (P10 / P50 / P90 / Mean) */
  ttkP10: number
  ttkP50: number
  ttkP90: number
  ttkMean: number
  /** 核心副指标 1（尖塔：平均战损 HP；炉石：按费拍怪率 %；阴阳师：不断火率 %） */
  kpi1Label: string
  kpi1Value: number
  /** 核心副指标 2（尖塔：能量利用率 %；炉石：水晶浪费率 %；阴阳师：二速防超车安全线 SPD） */
  kpi2Label: string
  kpi2Value: number
  /** 核心副指标 3（尖塔：牌库洗牌周期；炉石：第5回合场面攻血和；阴阳师：首轮爆发总伤） */
  kpi3Label: string
  kpi3Value: number
  /** 逐回合时序包络曲线 */
  turnSeries: MxTurnMetricPoint[]
  /** 阴阳师行动条专属：前 12 次行动的精确排轴时间线与超车/断火诊断 */
  actionTimeline?: MxActionBarTurnEvent[]
  speedTuneAdvisory?: string
  /** 商业产品级：样本局（Run #1）逐回合微观出牌、遗物触发、敌方攻击与血量变化白盒战报 */
  battleReplayLog?: MxCombatTurnReplayItem[]
  /** 商业产品级：单卡实战抓位归因、输出贡献占比与卡手弃置率遥测 */
  cardTelemetry?: MxCardTelemetryItem[]
}

export interface MxCardTelemetryItem {
  id: string
  name: string
  cost: number
  count: number
  /** 单局平均打出次数 */
  avgPlaysPerRun: number
  /** 占全队总有效价值（伤害+格挡+功能折算）的百分比 (%) */
  outputSharePct: number
  /** 卡手弃置率 (%)：抽上手但因费用不足或回合结束未打出而被弃置的比例 */
  strandedInHandPct: number
  /** 实战打出胜率边际贡献 Delta (%)：高频打出局 vs 低频局的胜率抬升 */
  playedWinDeltaPct: number
  /** 抓位评级：S 必抓核心 / A 主力构筑 / B 过渡填充 / C 卡手陷阱 */
  grade: 'S_must_pick' | 'A_core' | 'B_filler' | 'C_brick_trap'
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
}

/** 自定义列中被视为「额外平伤」的列名白名单（大小写/下划线不敏感） */
export const MX_CUSTOM_FLAT_DAMAGE_KEYS = [
  'flatdamage',
  'bonusdamage',
  'dmgbonus',
  'extradamage',
  'flatdmg',
  'bonusdmg'
]

/**
 * 计算自定义列中显式声明为「额外平伤」的数值总和。
 * 其他任意自定义列（如 poison_on_crit / costReduction）不会再被当作伤害加总。
 */
export function mxCustomStatsFlatDamage(customStats?: Record<string, number>): number {
  if (!customStats) return 0
  let sum = 0
  for (const [k, v] of Object.entries(customStats)) {
    const norm = k.toLowerCase().replace(/[_\s-]/g, '')
    if (MX_CUSTOM_FLAT_DAMAGE_KEYS.includes(norm) && Number.isFinite(v)) sum += v
  }
  return sum
}

export function runMxCombatKernelSimulation(cfg: MxCombatKernelConfig): MxCombatKernelResult {
  const runs = Math.max(10, Math.min(2000, Math.round(cfg.runs || 200)))
  const maxTurns = Math.max(3, Math.min(40, Math.round(cfg.maxTurns || 12)))
  const baseSeed = cfg.seed || 2026

  // ───────── Kernel A: 《杀戮尖塔》洗抽牌库与能量回合内核 ─────────
  if (cfg.kernel === 'deck_cycle' && mxShouldUseEffectEngine(cfg)) {
    // 牌库含效果脚本（或显式开启）时改由卡牌效果引擎驱动，返回结构完全一致
    return runMxDeckCycleKernelViaEffectEngine(cfg)
  }
  if (cfg.kernel === 'mana_tempo' && mxShouldUseEffectEngineForMana(cfg)) {
    // 法力卡组含效果脚本（或显式开启）时同样改由效果引擎驱动（圣盾/冲锋/吸血/亡语/搜索策略）
    return runMxManaTempoKernelViaEffectEngine(cfg)
  }
  if (cfg.kernel === 'deck_cycle') {
    const ttkList: number[] = []
    const hpLostList: number[] = []
    let wins = 0
    let totalEnergyAvailable = 0
    let totalEnergySpent = 0
    let totalShuffles = 0
    let totalTurnsPlayed = 0

    const dmgByTurn: number[][] = Array.from({ length: maxTurns }, () => [])
    const blockByTurn: number[][] = Array.from({ length: maxTurns }, () => [])
    const battleReplayLog: MxCombatTurnReplayItem[] = []
    const wonByRun: boolean[] = new Array<boolean>(runs).fill(false)

    interface DeckCardTracker {
      spec: MxDeckCardSpec
      totalPlays: number
      totalStranded: number
      totalValue: number
      playsByRun: number[]
    }
    const cardTrackerMap = new Map<string, DeckCardTracker>()
    const deckSpecsToTrack: MxDeckCardSpec[] =
      cfg.deckCards.filter((s) => s.count > 0).length > 0
        ? cfg.deckCards
        : [
            {
              id: 'strike',
              name: 'Strike',
              cost: 1,
              count: 5,
              damage: 6,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 1
            }
          ]
    for (const spec of deckSpecsToTrack) {
      if (spec.count > 0 && !cardTrackerMap.has(spec.id)) {
        cardTrackerMap.set(spec.id, {
          spec,
          totalPlays: 0,
          totalStranded: 0,
          totalValue: 0,
          playsByRun: new Array<number>(runs).fill(0)
        })
      }
    }

    const relicPreset: MxRelicTriggerPreset = cfg.relicTriggerPreset ?? 'none'
    const hasShurikenKunai = relicPreset === 'shuriken_kunai' || relicPreset === 'all_synergy'
    const hasNecronomicon = relicPreset === 'necronomicon' || relicPreset === 'all_synergy'
    const hasDeadBranch = relicPreset === 'dead_branch' || relicPreset === 'all_synergy'

    for (let r = 0; r < runs; r++) {
      const rng = createMxRng(baseSeed + (r + 1) * 7919)
      const fullDeck: MxDeckCardSpec[] = []
      for (const spec of cfg.deckCards) {
        const cnt = Math.max(0, Math.min(20, Math.round(spec.count)))
        for (let c = 0; c < cnt; c++) fullDeck.push({ ...spec })
      }
      if (!fullDeck.length) {
        fullDeck.push({
          id: 'strike',
          name: 'Strike',
          cost: 1,
          count: 5,
          damage: 6,
          block: 0,
          draw: 0,
          energyGain: 0,
          applyStrength: 0,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 1
        })
      }

      const drawPile = [...fullDeck]
      shuffleInPlace(drawPile, rng)
      const discardPile: MxDeckCardSpec[] = []
      const hand: MxDeckCardSpec[] = []

      const maxPlayerHp = Math.max(1, cfg.playerHp || 80)
      let playerHp = maxPlayerHp
      let enemyHp = Math.max(1, cfg.enemyHp || 180)
      let playerStr = 0
      let enemyVuln = 0
      let enemyWeak = 0
      let enemyPoison = 0
      let killedTurn = maxTurns + 1
      const mechanism: MxEnemyMechanismKind = cfg.enemyMechanism ?? 'standard'
      const statusPerTurn = Math.max(1, Math.min(5, Math.round(cfg.statusCardsPerTurn ?? 2)))
      const cardLimit = Math.max(2, Math.min(15, Math.round(cfg.cardPlayLimitPerTurn ?? 5)))
      const thornsDmg = Math.max(1, Math.min(20, Math.round(cfg.enemyThornsDamage ?? 2)))

      const drawCards = (n: number): void => {
        for (let i = 0; i < n; i++) {
          if (drawPile.length === 0) {
            if (discardPile.length === 0) break
            while (discardPile.length > 0) drawPile.push(discardPile.pop()!)
            shuffleInPlace(drawPile, rng)
            totalShuffles++
          }
          const card = drawPile.pop()
          if (card) hand.push(card)
        }
      }

      for (let t = 1; t <= maxTurns; t++) {
        totalTurnsPlayed++
        const startEnergy = Math.max(1, cfg.energyPerTurn || 3)
        let energy = startEnergy
        let extraEnergyGained = 0
        totalEnergyAvailable += energy
        let turnDmg = 0
        let turnBlock = 0
        let cardsPlayedThisTurn = 0
        let attacksPlayedThisTurn = 0
        let necronomiconTriggeredThisTurn = false
        let enemyArmorThisTurn = mechanism === 'thorns_armor' ? 10 : 0
        const turnPlayedNames: string[] = []
        const turnRelicsTriggered: string[] = []
        let turnThornsTaken = 0
        let turnPunishTaken = 0

        drawCards(Math.max(1, cfg.drawPerTurn || 5))

        // 按优先级贪心出牌（先过牌/加费/上易伤与力量，再打高伤，若即将受击则留费叠甲）
        let playedAny = true
        while (playedAny && enemyHp > 0 && hand.length > 0) {
          if (mechanism === 'card_limit_punisher' && cardsPlayedThisTurn >= cardLimit) {
            break
          }
          playedAny = false
          hand.sort((a, b) => b.priority - a.priority)
          const idx = hand.findIndex((c) => c.cost <= energy)
          if (idx < 0) break
          const card = hand.splice(idx, 1)[0]!
          energy -= card.cost
          totalEnergySpent += card.cost
          cardsPlayedThisTurn++
          playedAny = true
          if (r === 0) {
            turnPlayedNames.push(`${card.name}(${card.cost})`)
          }
          const cardTrk = cardTrackerMap.get(card.id)
          if (cardTrk) {
            cardTrk.totalPlays++
            cardTrk.playsByRun[r] = (cardTrk.playsByRun[r] ?? 0) + 1
            cardTrk.totalValue +=
              card.block +
              card.draw * 5.5 +
              card.energyGain * 6.5 +
              card.applyStrength * 8 +
              card.applyVulnerable * 5.5 +
              card.applyWeak * 4.5 +
              (card.poison || 0) * 3 +
              (card.heal || 0) * 2
          }

          if (mechanism === 'card_limit_punisher') {
            // 心脏律动/出牌惩罚：每打出一张牌受到 1 点穿甲反制伤害
            if (turnBlock > 0) {
              turnBlock = Math.max(0, turnBlock - 1)
            } else {
              playerHp -= 1
              turnPunishTaken += 1
            }
          }

          if (card.energyGain > 0) {
            energy += card.energyGain
            extraEnergyGained += card.energyGain
            totalEnergyAvailable += card.energyGain
          }
          if (card.draw > 0) drawCards(card.draw)
          if (card.applyStrength > 0) playerStr += card.applyStrength
          if (card.applyVulnerable > 0) enemyVuln += card.applyVulnerable
          if (card.applyWeak > 0) enemyWeak += card.applyWeak
          if (card.poison && card.poison > 0) enemyPoison += card.poison
          if (card.heal && card.heal > 0) {
            playerHp = Math.min(maxPlayerHp, playerHp + card.heal)
          }
          if (card.block > 0) turnBlock += card.block
          // 仅识别显式声明为「额外平伤」语义的自定义列；其余自定义列不再被误当作伤害加总
          // （复杂机制请改用 effectScript 卡牌效果脚本，由 cardEffectEngine 解释执行）
          const customFlatBonus = mxCustomStatsFlatDamage(card.customStats)
          if (card.damage > 0 || customFlatBonus > 0) {
            attacksPlayedThisTurn++
            if (hasShurikenKunai && attacksPlayedThisTurn % 3 === 0) {
              // 手里剑 + 苦无被动：同一回合每打出 3 张攻击牌，获得 +1 力量与 +4 格挡
              playerStr += 1
              turnBlock += 4
              if (r === 0) turnRelicsTriggered.push('Shuriken/Kunai(+1STR/+4BLK)')
            }
            let relicDoubleMult = 1
            if (hasNecronomicon && !necronomiconTriggeredThisTurn && card.cost >= 2) {
              // 死灵之书被动：每回合打出的第一张费用 >= 2 的攻击牌触发两次
              necronomiconTriggeredThisTurn = true
              relicDoubleMult = 2
              if (r === 0) turnRelicsTriggered.push(`Necronomicon(2x ${card.name})`)
            }
            const vulnMult = enemyVuln > 0 ? 1.5 : 1.0
            const hits = Math.max(1, Math.round(card.hits || 1)) * relicDoubleMult
            const singleHit = Math.max(0, Math.floor((card.damage + playerStr) * vulnMult))
            let hitDmg =
              singleHit * hits + Math.max(0, Math.round(customFlatBonus)) * relicDoubleMult
            if (
              mechanism === 'aoe_swarm' &&
              hits <= 1 &&
              !/aoe|cleave|whirlwind|all/i.test(card.name)
            ) {
              // 群怪检定：单段单体卡因伤害溢出/分摊折损 25% 有效输出
              hitDmg = Math.floor(hitDmg * 0.75)
            }
            if (enemyArmorThisTurn > 0) {
              const absorbed = Math.min(enemyArmorThisTurn, hitDmg)
              enemyArmorThisTurn -= absorbed
              hitDmg -= absorbed
            }
            turnDmg += hitDmg
            enemyHp -= hitDmg
            if (cardTrk) {
              cardTrk.totalValue += hitDmg
            }
            if (mechanism === 'thorns_armor') {
              const reflect = hits * thornsDmg
              if (turnBlock >= reflect) {
                turnBlock -= reflect
              } else {
                const netThorns = reflect - turnBlock
                playerHp -= netThorns
                turnThornsTaken += netThorns
                turnBlock = 0
              }
            }
          }
          if (card.exhaust) {
            if (hasDeadBranch) {
              // 枯木树枝被动：每消耗一张牌，立即向手牌生成一张随机低费衍生卡并过牌
              const beforeLen = hand.length
              drawCards(1)
              if (hand.length === beforeLen && hand.length < 10) {
                hand.push({
                  id: `branch_gen_${t}_${cardsPlayedThisTurn}`,
                  name: 'Branch Ephemeral',
                  cost: 0,
                  count: 1,
                  damage: 7,
                  block: 5,
                  draw: 0,
                  energyGain: 0,
                  applyStrength: 0,
                  applyVulnerable: 0,
                  applyWeak: 0,
                  exhaust: true,
                  priority: 4
                })
              }
              if (r === 0) turnRelicsTriggered.push('DeadBranch(+1 Card)')
            }
          } else {
            discardPile.push(card)
          }
        }

        // 回合结束结算中毒/流血 DOT 伤害
        if (enemyPoison > 0 && enemyHp > 0) {
          turnDmg += enemyPoison
          enemyHp -= enemyPoison
          enemyPoison = Math.max(0, enemyPoison - 1)
        }

        // 回合结束弃置剩余手牌（统计卡手未打出次数）
        while (hand.length > 0) {
          const strandedCard = hand.pop()!
          const trk = cardTrackerMap.get(strandedCard.id)
          if (trk) {
            trk.totalStranded++
          }
          discardPile.push(strandedCard)
        }

        // 塞状态废牌机制检定：敌方每回合向弃牌堆塞入不可打出的眩晕/伤口卡，污染后续洗牌过牌
        if (mechanism === 'status_polluter' && enemyHp > 0) {
          for (let sc = 0; sc < statusPerTurn; sc++) {
            discardPile.push({
              id: `status_dazed_${t}_${sc}`,
              name: 'Status: Wound',
              cost: 99,
              count: 1,
              damage: 0,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: -10
            })
          }
        }

        dmgByTurn[t - 1]!.push(turnDmg)
        blockByTurn[t - 1]!.push(turnBlock)

        const totalTurnE = startEnergy + extraEnergyGained
        const spentTurnE = Math.max(0, totalTurnE - energy)

        if (enemyHp <= 0) {
          if (r === 0) {
            battleReplayLog.push({
              turn: t,
              cardsPlayed: turnPlayedNames,
              energyUsed: `${spentTurnE}/${totalTurnE}`,
              damageDealt: turnDmg,
              blockGained: turnBlock,
              relicsTriggered: turnRelicsTriggered,
              enemyAction: 'DEFEATED (Boss Slain)',
              playerHpAfter: Math.max(0, playerHp),
              enemyHpAfter: 0
            })
          }
          killedTurn = t
          wins++
          wonByRun[r] = true
          break
        }

        // 敌人行动结算
        const berserkExtra =
          mechanism === 'berserk_race' && t >= 4
            ? (t - 3) * Math.max(4, (cfg.enemyDamageGrowth || 2) * 2.5)
            : 0
        const swarmExtra = mechanism === 'aoe_swarm' ? 4 : 0
        const rawEnemyAtk =
          (cfg.enemyBaseDamage || 12) +
          (t - 1) * (cfg.enemyDamageGrowth || 2) +
          berserkExtra +
          swarmExtra
        const weakMult = enemyWeak > 0 ? 0.75 : 1.0
        const incomingDmg = Math.floor(rawEnemyAtk * weakMult)
        const unblocked = Math.max(0, incomingDmg - turnBlock)
        playerHp -= unblocked

        if (r === 0) {
          const extraNotes: string[] = []
          if (turnThornsTaken > 0) extraNotes.push(`Thorns -${turnThornsTaken}`)
          if (turnPunishTaken > 0) extraNotes.push(`Beat -${turnPunishTaken}`)
          if (mechanism === 'status_polluter') extraNotes.push(`+${statusPerTurn} Wounds`)
          const extraStr = extraNotes.length ? ` [${extraNotes.join(', ')}]` : ''
          battleReplayLog.push({
            turn: t,
            cardsPlayed: turnPlayedNames,
            energyUsed: `${spentTurnE}/${totalTurnE}`,
            damageDealt: turnDmg,
            blockGained: turnBlock,
            relicsTriggered: turnRelicsTriggered,
            enemyAction: `Atk ${incomingDmg} -> HP -${unblocked}${extraStr}`,
            playerHpAfter: Math.max(0, playerHp),
            enemyHpAfter: Math.max(0, enemyHp)
          })
        }

        if (enemyVuln > 0) enemyVuln--
        if (enemyWeak > 0) enemyWeak--

        if (playerHp <= 0) {
          break
        }
      }

      ttkList.push(killedTurn)
      hpLostList.push(Math.max(0, (cfg.playerHp || 80) - Math.max(0, playerHp)))
    }

    const sortedTtk = [...ttkList].sort((a, b) => a - b)
    const avgHpLoss = Math.round((hpLostList.reduce((a, b) => a + b, 0) / runs) * 10) / 10
    const energyUtil =
      totalEnergyAvailable > 0
        ? Math.round((totalEnergySpent / totalEnergyAvailable) * 1000) / 10
        : 0
    const deckCycleTurns =
      totalShuffles > 0 ? Math.round((totalTurnsPlayed / totalShuffles) * 10) / 10 : maxTurns

    const turnSeries: MxTurnMetricPoint[] = Array.from({ length: maxTurns }, (_, i) => {
      const dmgs = [...(dmgByTurn[i] ?? [0])].sort((a, b) => a - b)
      const blks = blockByTurn[i] ?? [0]
      const blkMean = blks.length
        ? Math.round((blks.reduce((a, b) => a + b, 0) / blks.length) * 10) / 10
        : 0
      const killRateByTurn =
        Math.round((ttkList.filter((tk) => tk <= i + 1).length / runs) * 1000) / 10
      return {
        turn: i + 1,
        primaryP10: percentileOfSorted(dmgs, 0.1),
        primaryP50: percentileOfSorted(dmgs, 0.5),
        primaryP90: percentileOfSorted(dmgs, 0.9),
        secondaryMean: blkMean,
        ratePct: killRateByTurn
      }
    })

    const grandTotalVal =
      Array.from(cardTrackerMap.values()).reduce((s, t) => s + t.totalValue, 0) || 1
    const overallWinRate = (wins / runs) * 100
    const cardTelemetry: MxCardTelemetryItem[] = Array.from(cardTrackerMap.values()).map((t) => {
      const avgPlaysPerRun = Math.round((t.totalPlays / runs) * 100) / 100
      const opps = t.totalPlays + t.totalStranded
      const strandedInHandPct = opps > 0 ? Math.round((t.totalStranded / opps) * 1000) / 10 : 0
      const outputSharePct = Math.round((t.totalValue / grandTotalVal) * 1000) / 10

      let highRuns = 0
      let highWins = 0
      let lowRuns = 0
      let lowWins = 0
      const splitThreshold = Math.max(1, avgPlaysPerRun)
      for (let r = 0; r < runs; r++) {
        const p = t.playsByRun[r] ?? 0
        if (p >= splitThreshold) {
          highRuns++
          if (wonByRun[r]) highWins++
        } else {
          lowRuns++
          if (wonByRun[r]) lowWins++
        }
      }
      let playedWinDeltaPct = 0
      if (highRuns >= 3 && lowRuns >= 3) {
        playedWinDeltaPct = Math.round((highWins / highRuns - lowWins / lowRuns) * 100 * 10) / 10
      } else {
        const expectedShare = 100 / Math.max(1, cardTrackerMap.size)
        playedWinDeltaPct =
          Math.round(
            ((outputSharePct - expectedShare) * 0.45 -
              strandedInHandPct * 0.14 +
              (overallWinRate > 50 ? 2 : -1)) *
              10
          ) / 10
      }

      const grade: MxCardTelemetryItem['grade'] =
        strandedInHandPct >= 52 || (avgPlaysPerRun < 0.45 && outputSharePct < 6)
          ? 'C_brick_trap'
          : outputSharePct >= 26 || (playedWinDeltaPct >= 8 && strandedInHandPct < 32)
            ? 'S_must_pick'
            : outputSharePct >= 14 || playedWinDeltaPct >= 2
              ? 'A_core'
              : 'B_filler'

      return {
        id: t.spec.id,
        name: t.spec.name,
        cost: t.spec.cost,
        count: t.spec.count,
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
      winRatePct: Math.round((wins / runs) * 1000) / 10,
      ttkP10: percentileOfSorted(sortedTtk, 0.1),
      ttkP50: percentileOfSorted(sortedTtk, 0.5),
      ttkP90: percentileOfSorted(sortedTtk, 0.9),
      ttkMean: Math.round((ttkList.reduce((a, b) => a + b, 0) / runs) * 10) / 10,
      kpi1Label: 'Avg HP Lost',
      kpi1Value: avgHpLoss,
      kpi2Label: 'Energy Util %',
      kpi2Value: energyUtil,
      kpi3Label: 'Deck Cycle Turns',
      kpi3Value: deckCycleTurns,
      turnSeries,
      battleReplayLog,
      cardTelemetry
    }
  }

  // ───────── Kernel B: 《炉石传说》法力曲线与随从场面节奏内核 ─────────
  if (cfg.kernel === 'mana_tempo') {
    const maxCrystals = Math.max(1, Math.min(20, Math.round(cfg.maxManaCrystals || 10)))
    const mulliganCap = Math.max(1, Math.round(cfg.mulliganMaxCost || 3))
    const oppHpInit = Math.max(1, cfg.opponentHp || 30)

    const ttkList: number[] = []
    let wins = 0
    let totalTurnChecks = 0
    let curveOutHits = 0
    let totalManaAvailable = 0
    let totalManaFloated = 0

    const boardPowerByTurn: number[][] = Array.from({ length: maxTurns }, () => [])
    const curveOutByTurn: number[] = new Array<number>(maxTurns).fill(0)
    const battleReplayLog: MxCombatTurnReplayItem[] = []
    const wonByRun: boolean[] = new Array<boolean>(runs).fill(false)

    interface ManaCardTracker {
      spec: MxManaCurveCardSpec
      totalPlays: number
      totalStranded: number
      totalValue: number
      playsByRun: number[]
    }
    const manaTrackerMap = new Map<string, ManaCardTracker>()
    const manaSpecsToTrack: MxManaCurveCardSpec[] =
      cfg.manaCurveDeck.filter((s) => s.count > 0).length > 0
        ? cfg.manaCurveDeck
        : [
            {
              id: 'croc',
              name: 'River Crocolisk',
              manaCost: 2,
              count: 10,
              kind: 'minion',
              attack: 2,
              health: 3,
              directDamage: 0,
              drawCards: 0
            }
          ]
    for (const spec of manaSpecsToTrack) {
      if (spec.count > 0 && !manaTrackerMap.has(spec.id)) {
        manaTrackerMap.set(spec.id, {
          spec,
          totalPlays: 0,
          totalStranded: 0,
          totalValue: 0,
          playsByRun: new Array<number>(runs).fill(0)
        })
      }
    }

    for (let r = 0; r < runs; r++) {
      const rng = createMxRng(baseSeed + (r + 1) * 7919)
      const deck: MxManaCurveCardSpec[] = []
      for (const spec of cfg.manaCurveDeck) {
        const cnt = Math.max(0, Math.min(10, Math.round(spec.count)))
        for (let i = 0; i < cnt; i++) deck.push({ ...spec })
      }
      if (!deck.length) {
        deck.push({
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
      }
      shuffleInPlace(deck, rng)

      const hand: MxManaCurveCardSpec[] = []
      const initHandCount = Math.max(1, Math.min(6, Math.round(cfg.startingHandSize || 3)))
      for (let i = 0; i < initHandCount && deck.length > 0; i++) {
        hand.push(deck.pop()!)
      }
      // 起手调度（Mulligan）：换掉高于 mulliganMaxCost 的高费卡
      const kept: MxManaCurveCardSpec[] = []
      const returned: MxManaCurveCardSpec[] = []
      for (const c of hand) {
        if (c.manaCost <= mulliganCap) kept.push(c)
        else returned.push(c)
      }
      for (let i = 0; i < returned.length && deck.length > 0; i++) {
        kept.push(deck.pop()!)
      }
      deck.push(...returned)
      shuffleInPlace(deck, rng)
      hand.length = 0
      hand.push(...kept)

      const board: Array<{ attack: number; health: number; ready: boolean; shield: boolean }> = []
      let oppHp = oppHpInit
      let lethalTurn = maxTurns + 1

      for (let t = 1; t <= maxTurns; t++) {
        if (deck.length > 0 && hand.length < 10) {
          hand.push(deck.pop()!)
        }
        for (const m of board) m.ready = true

        const mana = Math.min(maxCrystals, t)
        let remMana = mana
        totalManaAvailable += mana
        totalTurnChecks++
        const turnPlayedNames: string[] = []
        let turnDmgDealt = 0

        // 贪心用满当回合水晶（优先打出费用最高的可用牌）
        let played = true
        while (played && remMana > 0 && hand.length > 0) {
          played = false
          hand.sort(
            (a, b) => b.manaCost - a.manaCost || b.attack + b.health - (a.attack + a.health)
          )
          const idx = hand.findIndex(
            (c) => c.manaCost <= remMana && (c.kind === 'spell' || board.length < 7)
          )
          if (idx < 0) break
          const card = hand.splice(idx, 1)[0]!
          remMana -= card.manaCost
          played = true
          if (r === 0) {
            turnPlayedNames.push(`${card.name}(${card.manaCost})`)
          }
          const mTrk = manaTrackerMap.get(card.id)
          if (mTrk) {
            mTrk.totalPlays++
            mTrk.playsByRun[r] = (mTrk.playsByRun[r] ?? 0) + 1
            mTrk.totalValue +=
              card.attack * 1.6 +
              card.health * 1.3 +
              (card.divineShield ? 3.5 : 0) +
              card.directDamage * 1.8 +
              card.drawCards * 4
          }

          if (card.kind === 'minion') {
            board.push({
              attack: card.attack,
              health: card.health,
              ready: false,
              shield: Boolean(card.divineShield)
            })
          }
          if (card.directDamage > 0) {
            oppHp -= card.directDamage
            turnDmgDealt += card.directDamage
          }
          if (card.drawCards > 0) {
            for (let d = 0; d < card.drawCards && deck.length > 0 && hand.length < 10; d++) {
              hand.push(deck.pop()!)
            }
          }
        }

        for (const unplayed of hand) {
          const mTrk = manaTrackerMap.get(unplayed.id)
          if (mTrk) mTrk.totalStranded++
        }
        totalManaFloated += remMana
        if (remMana === 0) {
          curveOutHits++
          curveOutByTurn[t - 1] = (curveOutByTurn[t - 1] ?? 0) + 1
        }

        // 已就绪随从攻击对手
        for (const m of board) {
          if (m.ready && m.attack > 0) {
            oppHp -= m.attack
            turnDmgDealt += m.attack
          }
        }

        const totalBoardStats = board.reduce((s, m) => s + m.attack + m.health, 0)
        boardPowerByTurn[t - 1]!.push(totalBoardStats)

        if (oppHp <= 0 && lethalTurn > maxTurns) {
          if (r === 0) {
            battleReplayLog.push({
              turn: t,
              cardsPlayed: turnPlayedNames,
              energyUsed: `${mana - remMana}/${mana}`,
              damageDealt: turnDmgDealt,
              blockGained: totalBoardStats,
              relicsTriggered: remMana === 0 ? ['Curve-Out(100% Mana)'] : [],
              enemyAction: 'LETHAL (Opponent Slain)',
              playerHpAfter: board.length,
              enemyHpAfter: 0
            })
          }
          lethalTurn = t
          wins++
          wonByRun[r] = true
          break
        }

        // 对手解场交换
        const rawClearDmg = Math.max(0, (cfg.opponentClearPowerPerTurn || 2) * Math.ceil(t * 0.6))
        let clearDmg = rawClearDmg
        while (clearDmg > 0 && board.length > 0) {
          const front = board[0]!
          if (front.shield) {
            front.shield = false
            clearDmg = Math.max(0, clearDmg - 2)
          } else {
            const dealt = Math.min(front.health, clearDmg)
            front.health -= dealt
            clearDmg -= dealt
            if (front.health <= 0) board.shift()
          }
        }

        if (r === 0) {
          battleReplayLog.push({
            turn: t,
            cardsPlayed: turnPlayedNames,
            energyUsed: `${mana - remMana}/${mana}`,
            damageDealt: turnDmgDealt,
            blockGained: totalBoardStats,
            relicsTriggered: remMana === 0 ? ['Curve-Out(100% Mana)'] : [],
            enemyAction: `Board Clear ${rawClearDmg} -> ${board.length} Minions Alive`,
            playerHpAfter: board.length,
            enemyHpAfter: Math.max(0, oppHp)
          })
        }
      }

      ttkList.push(lethalTurn)
    }

    const sortedTtk = [...ttkList].sort((a, b) => a - b)
    const curveOutRate =
      totalTurnChecks > 0 ? Math.round((curveOutHits / totalTurnChecks) * 1000) / 10 : 0
    const floatRate =
      totalManaAvailable > 0 ? Math.round((totalManaFloated / totalManaAvailable) * 1000) / 10 : 0
    const turn5Stats = boardPowerByTurn[Math.min(4, maxTurns - 1)] ?? [0]
    const turn5Mean = turn5Stats.length
      ? Math.round((turn5Stats.reduce((a, b) => a + b, 0) / turn5Stats.length) * 10) / 10
      : 0

    const turnSeries: MxTurnMetricPoint[] = Array.from({ length: maxTurns }, (_, i) => {
      const stats = [...(boardPowerByTurn[i] ?? [0])].sort((a, b) => a - b)
      const cRate = Math.round(((curveOutByTurn[i] ?? 0) / runs) * 1000) / 10
      return {
        turn: i + 1,
        primaryP10: percentileOfSorted(stats, 0.1),
        primaryP50: percentileOfSorted(stats, 0.5),
        primaryP90: percentileOfSorted(stats, 0.9),
        secondaryMean: cRate,
        ratePct: cRate
      }
    })

    const grandManaVal =
      Array.from(manaTrackerMap.values()).reduce((s, t) => s + t.totalValue, 0) || 1
    const overallWinRate = (wins / runs) * 100
    const cardTelemetry: MxCardTelemetryItem[] = Array.from(manaTrackerMap.values()).map((t) => {
      const avgPlaysPerRun = Math.round((t.totalPlays / runs) * 100) / 100
      const opps = t.totalPlays + t.totalStranded
      const strandedInHandPct = opps > 0 ? Math.round((t.totalStranded / opps) * 1000) / 10 : 0
      const outputSharePct = Math.round((t.totalValue / grandManaVal) * 1000) / 10

      let highRuns = 0
      let highWins = 0
      let lowRuns = 0
      let lowWins = 0
      const splitThreshold = Math.max(1, avgPlaysPerRun)
      for (let r = 0; r < runs; r++) {
        const p = t.playsByRun[r] ?? 0
        if (p >= splitThreshold) {
          highRuns++
          if (wonByRun[r]) highWins++
        } else {
          lowRuns++
          if (wonByRun[r]) lowWins++
        }
      }
      let playedWinDeltaPct = 0
      if (highRuns >= 3 && lowRuns >= 3) {
        playedWinDeltaPct = Math.round((highWins / highRuns - lowWins / lowRuns) * 100 * 10) / 10
      } else {
        const expectedShare = 100 / Math.max(1, manaTrackerMap.size)
        playedWinDeltaPct =
          Math.round(
            ((outputSharePct - expectedShare) * 0.45 -
              strandedInHandPct * 0.14 +
              (overallWinRate > 50 ? 2 : -1)) *
              10
          ) / 10
      }

      const grade: MxCardTelemetryItem['grade'] =
        strandedInHandPct >= 52 || (avgPlaysPerRun < 0.45 && outputSharePct < 6)
          ? 'C_brick_trap'
          : outputSharePct >= 26 || (playedWinDeltaPct >= 8 && strandedInHandPct < 32)
            ? 'S_must_pick'
            : outputSharePct >= 14 || playedWinDeltaPct >= 2
              ? 'A_core'
              : 'B_filler'

      return {
        id: t.spec.id,
        name: t.spec.name,
        cost: t.spec.manaCost,
        count: t.spec.count,
        avgPlaysPerRun,
        outputSharePct,
        strandedInHandPct,
        playedWinDeltaPct,
        grade
      }
    })

    return {
      kernel: 'mana_tempo',
      runs,
      winRatePct: Math.round((wins / runs) * 1000) / 10,
      ttkP10: percentileOfSorted(sortedTtk, 0.1),
      ttkP50: percentileOfSorted(sortedTtk, 0.5),
      ttkP90: percentileOfSorted(sortedTtk, 0.9),
      ttkMean: Math.round((ttkList.reduce((a, b) => a + b, 0) / runs) * 10) / 10,
      kpi1Label: 'Curve-Out Rate %',
      kpi1Value: curveOutRate,
      kpi2Label: 'Mana Float %',
      kpi2Value: floatRate,
      kpi3Label: 'Turn 5 Board Stats',
      kpi3Value: turn5Mean,
      turnSeries,
      battleReplayLog,
      cardTelemetry
    }
  }

  // ───────── Kernel C: 《阴阳师》/《星铁》速度行动条（拉条/超车）与共享鬼火池内核 ─────────
  if (mxShouldUseAtbEngine(cfg)) {
    // 任一单位填写技能脚本（或显式开启）时改由 ATB 效果引擎驱动：双方真实血量、敌方出手、阵亡
    return runMxActionBarKernelViaAtbEngine(cfg)
  }
  const trackDist = Math.max(100, cfg.trackDistance || 1000)
  const maxOrbs = Math.max(1, Math.min(12, Math.round(cfg.maxOrbs || 8)))
  const defMitigation = 300 / (300 + Math.max(0, cfg.targetEnemyDef || 450))
  const units = cfg.actionUnits.length
    ? cfg.actionUnits
    : [
        {
          id: 'puller',
          name: 'Kamaitachi (1st Pull)',
          team: 'ally' as const,
          speed: 260,
          attack: 1400,
          critDamageMult: 1.5,
          skillRatio: 0,
          orbCost: 3,
          pullGaugePct: 30,
          pushGaugePct: 0,
          orbGain: 0
        },
        {
          id: 'zashiki',
          name: 'Zashiki (Orb Gen)',
          team: 'ally' as const,
          speed: 190,
          attack: 1200,
          critDamageMult: 1.5,
          skillRatio: 1,
          orbCost: 0,
          pullGaugePct: 0,
          pushGaugePct: 0,
          orbGain: 3
        },
        {
          id: 'dps',
          name: 'Asura / Tamamo (DPS)',
          team: 'ally' as const,
          speed: 185,
          attack: 8500,
          critDamageMult: 2.8,
          skillRatio: 3.15,
          orbCost: 3,
          pullGaugePct: 0,
          pushGaugePct: 0,
          orbGain: 0
        },
        {
          id: 'enemy_boss',
          name: 'Enemy Speedster',
          team: 'enemy' as const,
          speed: 210,
          attack: 4000,
          critDamageMult: 1.6,
          skillRatio: 1.8,
          orbCost: 0,
          pullGaugePct: 0,
          pushGaugePct: 0,
          orbGain: 0
        }
      ]

  // 计算一速拉条后，二速不被敌方最高速超车的精确最低速度阈值：
  // 一速行动时刻 t1 = trackDist / spd1，此时二速已跑距离 spd2 * t1，加上 pullPct * trackDist >= trackDist
  // 即 spd2 / spd1 + pullPct >= 1  =>  spd2 >= spd1 * (1 - pullPct)
  const allyPullers = units
    .filter((u) => u.team === 'ally' && u.pullGaugePct > 0)
    .sort((a, b) => b.speed - a.speed)
  const topPuller = allyPullers[0]
  const safeSecondSpeed = topPuller
    ? Math.ceil(topPuller.speed * Math.max(0.1, 1 - topPuller.pullGaugePct / 100))
    : 0

  const actionTimeline: MxActionBarTurnEvent[] = []
  let totalAllySkillChecks = 0
  let orbStarvedCount = 0
  let wins = 0
  const ttkList: number[] = []
  const cycleDmgByStep: number[][] = Array.from({ length: maxTurns }, () => [])

  for (let r = 0; r < runs; r++) {
    const rng = createMxRng(baseSeed + (r + 1) * 7919)
    const gauges = new Map<string, number>()
    for (const u of units) gauges.set(u.id, 0)
    let orbs = Math.min(maxOrbs, Math.max(0, cfg.initialOrbs ?? 4))
    let actionCounter = 0
    let orbBarStage = 0
    let enemyHp = Math.max(1, cfg.targetEnemyHp || 65000)
    let cumDmg = 0
    let killedStep = maxTurns + 1

    for (let step = 1; step <= maxTurns; step++) {
      // 找到距离终点 trackDist 所需时间最短的单位
      let nextUnit = units[0]!
      let minDt = Number.POSITIVE_INFINITY
      for (const u of units) {
        const curG = gauges.get(u.id) ?? 0
        const rem = Math.max(0, trackDist - curG)
        const spd = Math.max(1, u.speed * (1 + (rng() - 0.5) * 0.01))
        const dt = rem / spd
        if (dt < minDt) {
          minDt = dt
          nextUnit = u
        }
      }

      // 全体推进 minDt 时间
      for (const u of units) {
        const curG = gauges.get(u.id) ?? 0
        gauges.set(u.id, Math.min(trackDist, curG + u.speed * minDt))
      }

      // 行动单位行动后行动条归零
      gauges.set(nextUnit.id, 0)
      actionCounter++

      const orbsBefore = orbs
      let skillCast = false
      let starvedOrb = false
      let damageDealt = 0

      if (nextUnit.team === 'ally') {
        if (nextUnit.orbGain > 0) {
          orbs = Math.min(maxOrbs, orbs + nextUnit.orbGain)
        }
        if (nextUnit.orbCost > 0) {
          totalAllySkillChecks++
          if (orbs >= nextUnit.orbCost) {
            orbs -= nextUnit.orbCost
            skillCast = true
          } else {
            starvedOrb = true
            orbStarvedCount++
          }
        } else {
          skillCast = true
        }

        // 拉条与推条结算
        if (skillCast && nextUnit.pullGaugePct > 0) {
          const boost = (nextUnit.pullGaugePct / 100) * trackDist
          for (const u of units) {
            if (u.team === 'ally' && u.id !== nextUnit.id) {
              gauges.set(u.id, Math.min(trackDist, (gauges.get(u.id) ?? 0) + boost))
            }
          }
        }
        if (skillCast && nextUnit.pushGaugePct > 0) {
          const push = (nextUnit.pushGaugePct / 100) * trackDist
          for (const u of units) {
            if (u.team === 'enemy') {
              gauges.set(u.id, Math.max(0, (gauges.get(u.id) ?? 0) - push))
            }
          }
        }

        // 伤害计算（若断火则退化为 100% 普攻倍率）
        const effRatio = skillCast ? nextUnit.skillRatio : Math.min(1.0, nextUnit.skillRatio)
        if (effRatio > 0) {
          const jitter = 0.96 + rng() * 0.08
          damageDealt = Math.round(
            nextUnit.attack * effRatio * nextUnit.critDamageMult * defMitigation * jitter
          )
          enemyHp -= damageDealt
          cumDmg += damageDealt
        }

        // 阴阳师 5 格行动回火条推进
        if (actionCounter % 5 === 0) {
          const baseRecover = cfg.orbRecoveryPer5Actions || 3
          const recoverAmt = Math.min(5, baseRecover + orbBarStage)
          orbs = Math.min(maxOrbs, orbs + recoverAmt)
          orbBarStage = Math.min(2, orbBarStage + 1)
        }
      }

      if (r === 0 && step <= 14) {
        actionTimeline.push({
          actionIndex: step,
          unitName: nextUnit.name,
          team: nextUnit.team,
          speed: nextUnit.speed,
          orbsBefore,
          orbsAfter: orbs,
          skillCast,
          starvedOrb,
          damageDealt,
          pulledGaugePct: skillCast ? nextUnit.pullGaugePct : 0
        })
      }

      cycleDmgByStep[step - 1]!.push(cumDmg)

      if (enemyHp <= 0 && killedStep > maxTurns) {
        killedStep = step
        wins++
      }
    }

    ttkList.push(killedStep)
  }

  const sortedTtk = [...ttkList].sort((a, b) => a - b)
  const noStarveRate =
    totalAllySkillChecks > 0
      ? Math.round(((totalAllySkillChecks - orbStarvedCount) / totalAllySkillChecks) * 1000) / 10
      : 100
  const finalStepDmgs = cycleDmgByStep[maxTurns - 1] ?? [0]
  const meanCycleDmg = finalStepDmgs.length
    ? Math.round(finalStepDmgs.reduce((a, b) => a + b, 0) / finalStepDmgs.length)
    : 0

  const turnSeries: MxTurnMetricPoint[] = Array.from({ length: maxTurns }, (_, i) => {
    const dmgs = [...(cycleDmgByStep[i] ?? [0])].sort((a, b) => a - b)
    const killRate = Math.round((ttkList.filter((tk) => tk <= i + 1).length / runs) * 1000) / 10
    return {
      turn: i + 1,
      primaryP10: percentileOfSorted(dmgs, 0.1),
      primaryP50: percentileOfSorted(dmgs, 0.5),
      primaryP90: percentileOfSorted(dmgs, 0.9),
      secondaryMean: killRate,
      ratePct: killRate
    }
  })

  // 检测是否存在敌方超车插队
  const firstEnemyIdx = actionTimeline.findIndex((e) => e.team === 'enemy')
  const allyCount = units.filter((u) => u.team === 'ally').length
  const cutInDetected = firstEnemyIdx >= 0 && firstEnemyIdx < allyCount
  const speedTuneAdvisory = topPuller
    ? cutInDetected
      ? `Cut-in Warning: Enemy acted at #${firstEnemyIdx + 1} before all allies! Raise 2nd unit SPD >= ${safeSecondSpeed}.`
      : `Speed Lock OK: 1st Puller (${topPuller.speed} SPD, +${topPuller.pullGaugePct}%) safely pulls team above >= ${safeSecondSpeed} SPD.`
    : 'No pull-gauge unit configured; turn order follows raw SPD.'

  return {
    kernel: 'action_bar',
    runs,
    winRatePct: Math.round((wins / runs) * 1000) / 10,
    ttkP10: percentileOfSorted(sortedTtk, 0.1),
    ttkP50: percentileOfSorted(sortedTtk, 0.5),
    ttkP90: percentileOfSorted(sortedTtk, 0.9),
    ttkMean: Math.round((ttkList.reduce((a, b) => a + b, 0) / runs) * 10) / 10,
    kpi1Label: 'Orb Sufficiency %',
    kpi1Value: noStarveRate,
    kpi2Label: 'Safe 2nd SPD >=',
    kpi2Value: safeSecondSpeed,
    kpi3Label: 'Cycle Burst DMG',
    kpi3Value: meanCycleDmg,
    turnSeries,
    actionTimeline,
    speedTuneAdvisory
  }
}

/**
 * 怪物机制检定克制矩阵（Enemy Encounter Build-Checker Matrix）：
 * 将当前卡组依次置于 6 类经典肉鸽 Boss/精英机制下进行蒙特卡洛对局，自动定位当前流派的天敌机制。
 */
export function runMxEncounterCounterMatrix(cfg: MxCombatKernelConfig): MxEncounterCounterRow[] {
  const mechanisms: Array<{
    id: MxEnemyMechanismKind
    nameZh: string
    nameEn: string
  }> = [
    { id: 'standard', nameZh: '标准木桩 (Standard)', nameEn: 'Standard Boss' }, // cjk-ok
    { id: 'aoe_swarm', nameZh: '群怪分摊检定 (AOE Swarm)', nameEn: 'AOE Swarm Check' }, // cjk-ok
    { id: 'status_polluter', nameZh: '塞废牌污染 (Status Polluter)', nameEn: 'Status Polluter' }, // cjk-ok
    { id: 'card_limit_punisher', nameZh: '出牌数惩罚 (Card Limit)', nameEn: 'Card Limit Punisher' }, // cjk-ok
    { id: 'thorns_armor', nameZh: '高甲荆棘反伤 (Thorns & Armor)', nameEn: 'Thorns & Armor' }, // cjk-ok
    { id: 'berserk_race', nameZh: '回合狂暴检定 (Berserk DPS Race)', nameEn: 'Berserk DPS Race' } // cjk-ok
  ]

  const sampleRuns = Math.min(200, Math.max(60, Math.round((cfg.runs || 200) * 0.6)))
  return mechanisms.map((m) => {
    const res = runMxCombatKernelSimulation({
      ...cfg,
      kernel: 'deck_cycle',
      runs: sampleRuns,
      enemyMechanism: m.id
    })
    const verdict: MxEncounterCounterRow['verdict'] =
      res.winRatePct >= 75 ? 'favored' : res.winRatePct >= 45 ? 'skill_check' : 'countered'
    return {
      mechanism: m.id,
      nameZh: m.nameZh,
      nameEn: m.nameEn,
      winRatePct: res.winRatePct,
      ttkP50: res.ttkP50,
      avgHpLoss: res.kpi1Value,
      verdict
    }
  })
}

/**
 * 牌库精简（商店删牌）与诅咒塞牌边际收益曲线（Deck Thinning & Removal ROI Curve）：
 * 模拟从「塞入 2 张废牌/诅咒 (+2)」到「删去 3 张初始基础牌 (-3)」的起手核心卡摸到率、TTK 与平均战损变化，
 * 并基于节省的生命值与胜率增益自动推算商店删牌合理定价（Gold）。
 */
export function runMxDeckRemovalRoiAnalysis(cfg: MxCombatKernelConfig): MxDeckRemovalRoiRow[] {
  const deltas: Array<{ delta: number; labelZh: string; labelEn: string }> = [
    { delta: 2, labelZh: '+2 诅咒/废牌 (污染)', labelEn: '+2 Curse / Bloat' }, // cjk-ok
    { delta: 1, labelZh: '+1 诅咒/废牌', labelEn: '+1 Curse / Bloat' }, // cjk-ok
    { delta: 0, labelZh: '0 基准初始牌库', labelEn: '0 Baseline Deck' }, // cjk-ok
    { delta: -1, labelZh: '-1 删去1张基础牌', labelEn: '-1 Remove 1 Starter' }, // cjk-ok
    { delta: -2, labelZh: '-2 删去2张基础牌', labelEn: '-2 Remove 2 Starters' }, // cjk-ok
    { delta: -3, labelZh: '-3 删去3张基础牌', labelEn: '-3 Remove 3 Starters' } // cjk-ok
  ]

  const sampleRuns = Math.min(200, Math.max(80, Math.round((cfg.runs || 200) * 0.6)))
  const drawN = Math.max(1, cfg.drawPerTurn || 5)

  // 先克隆并调整牌库计算各档位指标
  const rawResults = deltas.map((d) => {
    const cardsClone: MxDeckCardSpec[] = cfg.deckCards.map((c) => ({ ...c }))
    if (d.delta > 0) {
      cardsClone.push({
        id: `curse_bloat_${d.delta}`,
        name: 'Curse: Clumsy',
        cost: 99,
        count: d.delta,
        damage: 0,
        block: 0,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: false,
        priority: -10
      })
    } else if (d.delta < 0) {
      let toRemove = Math.abs(d.delta)
      // 优先从低优先级基础牌（priority <= 2 或 Strike/Defend）中删减
      const sortedByLowPrio = [...cardsClone].sort((a, b) => a.priority - b.priority)
      for (const lowCard of sortedByLowPrio) {
        if (toRemove <= 0) break
        const target = cardsClone.find((c) => c.id === lowCard.id)
        if (!target || target.count <= 0) continue
        const cut = Math.min(target.count, toRemove)
        target.count -= cut
        toRemove -= cut
      }
    }

    const deckSize = Math.max(
      1,
      cardsClone.reduce((acc, c) => acc + Math.max(0, c.count), 0)
    )
    const coreCount = cardsClone
      .filter((c) => c.priority >= 3 || c.applyStrength > 0 || c.draw > 0)
      .reduce((acc, c) => acc + Math.max(0, c.count), 0)

    // 超几何分布计算起手 Turn 1 至少抽到 1 张核心牌的概率
    const nonCore = Math.max(0, deckSize - coreCount)
    let probNoCore = 1
    for (let i = 0; i < drawN; i++) {
      if (deckSize - i <= 0) break
      probNoCore *= Math.max(0, nonCore - i) / (deckSize - i)
    }
    const turn1CoreDrawPct = Math.round((1 - Math.max(0, Math.min(1, probNoCore))) * 1000) / 10

    const sim = runMxCombatKernelSimulation({
      ...cfg,
      kernel: 'deck_cycle',
      runs: sampleRuns,
      deckCards: cardsClone
    })

    return {
      deltaCards: d.delta,
      labelZh: d.labelZh,
      labelEn: d.labelEn,
      deckSize,
      turn1CoreDrawPct,
      winRatePct: sim.winRatePct,
      ttkP50: sim.ttkP50,
      avgHpLoss: sim.kpi1Value
    }
  })

  const baseRow = rawResults.find((r) => r.deltaCards === 0) ?? rawResults[0]!
  return rawResults.map((r) => {
    const hpSaved = Math.round((baseRow.avgHpLoss - r.avgHpLoss) * 10) / 10
    const winGain = Math.max(0, r.winRatePct - baseRow.winRatePct)
    const removalStep = r.deltaCards < 0 ? Math.abs(r.deltaCards) : 0
    // 基于每点战损折合 ~12G + 胜率提升折算合理删牌费用（带递增阶梯）
    const fairShopGoldPrice =
      removalStep === 0
        ? 0
        : Math.max(
            50,
            Math.round(
              (55 + Math.max(0, hpSaved) * 8 + winGain * 1.8 + (removalStep - 1) * 25) / 5
            ) * 5
          )
    return {
      ...r,
      hpSavedVsBase: hpSaved,
      fairShopGoldPrice
    }
  })
}

// ───────────────────────────── 4. 肉鸽全局战力包络线 vs 关卡难度膨胀墙 ─────────────────────────────

export interface MxRoguelikeEnvelopeConfig {
  floors: number
  runs: number
  seed: number
  playerBasePower: number
  /** 每层基础成长（升级/普通奖励） */
  baseAddPerFloor: number
  /** 每层获得核心乘区组件的概率 (%) */
  synergyHitRatePct: number
  /** 每次命中乘区组件的独立倍率（如 1.35x） */
  synergyMultPerHit: number
  /** 关卡怪物基础战力要求 */
  enemyBasePower: number
  /** 关卡怪物每层指数膨胀率（如 1.24） */
  enemyGrowthRate: number
  /** Boss 层间隔（如每 5 层一个 Boss）与难度倍率 */
  bossEveryNWave: number
  bossDifficultyMult: number
  /** 局外永久养成（Meta-Progression）每死一局提供的初始战力加成百分比 */
  metaBonusPerRunPct: number
  /** 是否启用分支房间路径决策（精英怪/篝火回血vs锻造升级/商店消费）与局内复利利息 */
  enableBranchingPath?: boolean
  /** 精英怪房间出现率 (%)，挑战成功额外获得高阶遗物乘区与双倍金币 */
  eliteRoomRatePct?: number
  /** 篝火处选择回血而非升级强化（Smith）的生命值危险线百分比 (%) */
  campfireRestHpThresholdPct?: number
  /** 每层结算时每持有 10 金币获得的复利利息（如 Balatro 每 5 金币 +1 利息） */
  interestPer10Gold?: number
  /** 每层复利利息上限（默认 5） */
  interestCapPerFloor?: number
  /** 商店购买核心遗物/删牌的价格阈值（默认 100） */
  shopSpendThresholdGold?: number
  /** 角色/武器等级上限（默认 80） */
  levelMax?: number
  /** 每级属性复合成长率 (%)（默认 4.2） */
  levelStatGrowthPct?: number
  /** 每隔多少级触发一次突破（Ascension Breakthrough，默认 20） */
  levelAscensionInterval?: number
  /** 每次突破额外阶跃加成百分比 (%)（默认 18） */
  levelAscensionBonusPct?: number
  /** 升级经验曲线幂指数（XP(L) = baseXp * L^exp，默认 1.55） */
  levelXpExponent?: number
}

export interface MxRoguelikeFloorPoint {
  floor: number
  isBoss: boolean
  roomType: 'combat' | 'elite_mix' | 'campfire' | 'shop' | 'boss'
  enemyPower: number
  playerP10: number
  playerP50: number
  playerP90: number
  survivalRatePct: number
  avgHpPct: number
  avgGold: number
  status: 'balanced' | 'difficulty_wall' | 'runaway_trivial'
}

export interface MxRoguelikeEnvelopeResult {
  floors: number
  runs: number
  firstRunClearRatePct: number
  /** 计入局外永久天赋养成后，通关率达到 50% 所需的期望局数 */
  metaRunsTo50PctClear: number
  /** 精英房间主动挑战率 (%) */
  eliteChallengeRatePct: number
  /** 篝火选择强化升级（Smith）而非被迫回血（Rest）的健康比例 (%) */
  campfireUpgradeRatioPct: number
  /** 单局平均复利利息总收益（Gold） */
  avgInterestGoldEarned: number
  /** 终局贫富分化指数（P90 / P10 战力比，理想区间 1.6x ~ 3.2x） */
  snowballPolarizationIndex: number
  difficultyWallFloors: number[]
  runawayFloors: number[]
  floorSeries: MxRoguelikeFloorPoint[]
}

export function runMxRoguelikeEnvelopeSimulation(
  cfg: MxRoguelikeEnvelopeConfig
): MxRoguelikeEnvelopeResult {
  const floors = Math.max(5, Math.min(40, Math.round(cfg.floors || 15)))
  const runs = Math.max(20, Math.min(2000, Math.round(cfg.runs || 300)))
  const baseSeed = cfg.seed || 2026

  const branchingOn = cfg.enableBranchingPath !== false
  const eliteRate = Math.max(0, Math.min(0.6, (cfg.eliteRoomRatePct ?? 24) / 100))
  const restHpThresh = Math.max(15, Math.min(80, cfg.campfireRestHpThresholdPct ?? 45))
  const interestRate = Math.max(0, cfg.interestPer10Gold ?? 1)
  const interestCap = Math.max(0, cfg.interestCapPerFloor ?? 5)
  const shopThreshold = Math.max(40, cfg.shopSpendThresholdGold ?? 100)
  const bossInterval = Math.max(2, Math.round(cfg.bossEveryNWave || 5))

  const powerByFloor: number[][] = Array.from({ length: floors }, () => [])
  const hpByFloor: number[][] = Array.from({ length: floors }, () => [])
  const goldByFloor: number[][] = Array.from({ length: floors }, () => [])
  const survivedByFloor: number[] = new Array<number>(floors).fill(0)
  let firstRunClears = 0
  let totalEliteOpportunities = 0
  let totalElitesChallenged = 0
  let totalCampfires = 0
  let totalCampfireUpgrades = 0
  let totalInterestEarnedAllRuns = 0

  const enemyPowers: Array<{
    power: number
    isBoss: boolean
    roomType: MxRoguelikeFloorPoint['roomType']
  }> = []
  for (let f = 1; f <= floors; f++) {
    const isBoss = cfg.bossEveryNWave > 0 && f % bossInterval === 0
    const isCampfire = !isBoss && f > 1 && (f + 1) % bossInterval === 0
    const isShop = !isBoss && !isCampfire && f > 2 && f % 4 === 0
    const roomType: MxRoguelikeFloorPoint['roomType'] = isBoss
      ? 'boss'
      : isCampfire
        ? 'campfire'
        : isShop
          ? 'shop'
          : f >= 3
            ? 'elite_mix'
            : 'combat'
    const raw =
      (cfg.enemyBasePower || 25) *
      Math.pow(Math.max(1.01, cfg.enemyGrowthRate || 1.24), f - 1) *
      (isBoss ? Math.max(1, cfg.bossDifficultyMult || 1.45) : 1)
    enemyPowers.push({ power: Math.round(raw * 10) / 10, isBoss, roomType })
  }

  for (let r = 0; r < runs; r++) {
    const rng = createMxRng(baseSeed + (r + 1) * 7919)
    let addZone = Math.max(1, cfg.playerBasePower || 30)
    let multZone = 1.0
    let synergyCount = 0
    let hpPct = 100
    let gold = 30
    let alive = true

    for (let f = 1; f <= floors; f++) {
      const floorMeta = enemyPowers[f - 1]!
      let effectiveEnemy = floorMeta.power

      if (f > 1 && alive) {
        // 复利利息结算
        if (interestRate > 0 && interestCap > 0) {
          const interest = Math.min(interestCap, Math.floor(gold / 10) * interestRate)
          gold += interest
          totalInterestEarnedAllRuns += interest
        }

        if (branchingOn && floorMeta.roomType === 'campfire') {
          totalCampfires++
          if (hpPct < restHpThresh) {
            // 残血被迫睡觉回血（损失一次锻造升级乘区）
            hpPct = Math.min(100, hpPct + 32)
          } else {
            // 血量健康：选择锻造升级卡牌/武器，提升基础与乘区
            totalCampfireUpgrades++
            addZone += (cfg.baseAddPerFloor || 10) * 0.85
            multZone *= 1.1
          }
        } else if (branchingOn && floorMeta.roomType === 'shop') {
          if (gold >= shopThreshold) {
            gold -= shopThreshold
            synergyCount++
            multZone *= Math.max(1.05, (cfg.synergyMultPerHit || 1.28) * 0.96)
          } else {
            addZone += (cfg.baseAddPerFloor || 10) * 0.5
          }
        } else {
          // 战斗层或精英分支层
          addZone += (cfg.baseAddPerFloor || 10) * (0.85 + rng() * 0.3)
          let tookElite = false
          if (branchingOn && !floorMeta.isBoss && f >= 3 && rng() < eliteRate) {
            totalEliteOpportunities++
            // 血量高于阈值时主动挑战精英怪拿遗物滚雪球
            if (hpPct >= restHpThresh + 10) {
              tookElite = true
              totalElitesChallenged++
              effectiveEnemy *= 1.18
            }
          }
          const hitProb = Math.min(
            0.92,
            (cfg.synergyHitRatePct || 32) / 100 + synergyCount * 0.03 + (tookElite ? 0.28 : 0)
          )
          if (rng() < hitProb) {
            synergyCount++
            multZone *= Math.max(1.02, cfg.synergyMultPerHit || 1.32)
          }
          gold += tookElite ? 32 : floorMeta.isBoss ? 50 : 16
        }
      }

      const pwr = Math.round(addZone * multZone * 10) / 10
      powerByFloor[f - 1]!.push(pwr)

      if (alive) {
        const isNonCombatRoom =
          branchingOn && (floorMeta.roomType === 'campfire' || floorMeta.roomType === 'shop')
        if (!isNonCombatRoom) {
          const ratio = effectiveEnemy / Math.max(1, pwr)
          if (pwr < effectiveEnemy && ratio > 1.06) {
            alive = false
            hpPct = 0
          } else {
            // 根据敌我战力比计算本层战损扣血
            const hpLoss = Math.max(2, Math.round(Math.pow(ratio, 1.55) * 16))
            hpPct = Math.max(0, hpPct - hpLoss)
            if (hpPct <= 0) alive = false
          }
        }
        if (alive && floorMeta.isBoss) {
          // Boss 战后回血奖励
          hpPct = Math.min(100, hpPct + 35)
        }
      }

      hpByFloor[f - 1]!.push(alive ? hpPct : 0)
      goldByFloor[f - 1]!.push(gold)

      if (alive) {
        survivedByFloor[f - 1] = (survivedByFloor[f - 1] ?? 0) + 1
      }
    }
    if (alive) firstRunClears++
  }

  const difficultyWallFloors: number[] = []
  const runawayFloors: number[] = []

  const floorSeries: MxRoguelikeFloorPoint[] = Array.from({ length: floors }, (_, idx) => {
    const f = idx + 1
    const sorted = [...(powerByFloor[idx] ?? [0])].sort((a, b) => a - b)
    const p10 = percentileOfSorted(sorted, 0.1)
    const p50 = percentileOfSorted(sorted, 0.5)
    const p90 = percentileOfSorted(sorted, 0.9)
    const enemy = enemyPowers[idx]!.power
    const isBoss = enemyPowers[idx]!.isBoss
    const roomType = enemyPowers[idx]!.roomType
    const surv = Math.round(((survivedByFloor[idx] ?? 0) / runs) * 1000) / 10
    const hps = hpByFloor[idx] ?? [0]
    const golds = goldByFloor[idx] ?? [0]
    const avgHpPct = Math.round(hps.reduce((a, b) => a + b, 0) / Math.max(1, hps.length))
    const avgGold = Math.round(golds.reduce((a, b) => a + b, 0) / Math.max(1, golds.length))

    let status: MxRoguelikeFloorPoint['status'] = 'balanced'
    if (enemy > p50 * 1.05) {
      status = 'difficulty_wall'
      difficultyWallFloors.push(f)
    } else if (f >= 4 && p10 > enemy * 2.2) {
      status = 'runaway_trivial'
      runawayFloors.push(f)
    }

    return {
      floor: f,
      isBoss,
      roomType,
      enemyPower: enemy,
      playerP10: p10,
      playerP50: p50,
      playerP90: p90,
      survivalRatePct: surv,
      avgHpPct,
      avgGold,
      status
    }
  })

  // 计算局外养成需要多少局才能让中位玩家 P50 跨过最高难度墙
  let metaRunsNeeded = 1
  const metaStep = Math.max(0.01, (cfg.metaBonusPerRunPct || 6) / 100)
  for (let mRun = 1; mRun <= 80; mRun++) {
    const metaMult = 1 + (mRun - 1) * metaStep
    const allPassed = floorSeries.every((pt) => pt.playerP50 * metaMult >= pt.enemyPower)
    if (allPassed) {
      metaRunsNeeded = mRun
      break
    }
    metaRunsNeeded = mRun
  }

  const lastPt = floorSeries[floorSeries.length - 1]
  const snowballIndex = lastPt
    ? Math.round((lastPt.playerP90 / Math.max(1, lastPt.playerP10)) * 100) / 100
    : 1

  return {
    floors,
    runs,
    firstRunClearRatePct: Math.round((firstRunClears / runs) * 1000) / 10,
    metaRunsTo50PctClear: metaRunsNeeded,
    eliteChallengeRatePct:
      totalEliteOpportunities > 0
        ? Math.round((totalElitesChallenged / totalEliteOpportunities) * 1000) / 10
        : 0,
    campfireUpgradeRatioPct:
      totalCampfires > 0 ? Math.round((totalCampfireUpgrades / totalCampfires) * 1000) / 10 : 100,
    avgInterestGoldEarned: Math.round((totalInterestEarnedAllRuns / runs) * 10) / 10,
    snowballPolarizationIndex: snowballIndex,
    difficultyWallFloors,
    runawayFloors,
    floorSeries
  }
}

export interface MxAscensionTierRow {
  tier: number
  code: 'A0' | 'A5' | 'A10' | 'A15' | 'A20'
  nameZh: string
  nameEn: string
  modifierDescZh: string
  modifierDescEn: string
  clearRatePct: number
  doubleBossPassPct: number
  metaRunsTo50Pct: number
  wallCount: number
  verdict: 'sweet_spot' | 'brutal_fair' | 'overtuned_wall' | 'too_easy'
}

/**
 * 商业产品级：多周目进阶阶梯（Ascension 0 ~ 20 / Stakes）终局重玩度矩阵审计：
 * 对标《杀戮尖塔》A0~A20 与《Balatro》白注~金注，使用共同随机数（CRN）
 * 测算 5 个关键进阶梯度下的首局通关率、A20 双 Boss 连战通过率、局外养成局数与难度墙。
 */
export function runMxAscensionLadderAudit(cfg: MxRoguelikeEnvelopeConfig): MxAscensionTierRow[] {
  const sampleRuns = Math.min(260, Math.max(80, Math.round((cfg.runs || 240) * 0.75)))
  const baseEnemyPower = cfg.enemyBasePower || 25
  const baseGrowth = cfg.enemyGrowthRate || 1.24
  const baseAdd = cfg.baseAddPerFloor || 10
  const baseSynergyHit = cfg.synergyHitRatePct || 32
  const baseBossMult = cfg.bossDifficultyMult || 1.45
  const baseInterestCap = cfg.interestCapPerFloor ?? 5
  const baseShopGold = cfg.shopSpendThresholdGold ?? 100

  const tiers: Array<{
    tier: number
    code: MxAscensionTierRow['code']
    nameZh: string
    nameEn: string
    modifierDescZh: string
    modifierDescEn: string
    override: Partial<MxRoguelikeEnvelopeConfig>
    doubleBossPenalty: number
  }> = [
    {
      tier: 0,
      code: 'A0',
      nameZh: 'A0 标准基准周目', // cjk-ok
      nameEn: 'A0 Standard Baseline',
      modifierDescZh: '标准怪物数值与完整篝火回血/复利利息', // cjk-ok
      modifierDescEn: 'Standard enemy scaling, full campfire heal & interest',
      override: {},
      doubleBossPenalty: 1.0
    },
    {
      tier: 5,
      code: 'A5',
      nameZh: 'A5 精英强化与战损加深', // cjk-ok
      nameEn: 'A5 Elite Surge & Less Heal',
      modifierDescZh: '怪物基础强度 +10%，篝火安全线抬升 +8%', // cjk-ok
      modifierDescEn: 'Enemy base +10%, campfire rest threshold +8%',
      override: {
        enemyBasePower: Math.round(baseEnemyPower * 1.1 * 10) / 10,
        campfireRestHpThresholdPct: Math.min(80, (cfg.campfireRestHpThresholdPct ?? 45) + 8)
      },
      doubleBossPenalty: 0.94
    },
    {
      tier: 10,
      code: 'A10',
      nameZh: 'A10 进阶之灾诅咒污染', // cjk-ok
      nameEn: 'A10 Ascender Curse Dilution',
      modifierDescZh: '起手塞入不可移除诅咒（协同命中率 -14%，每层成长 -10%）', // cjk-ok
      modifierDescEn: 'Starter curse dilution (-14% synergy hit, -10% base add)',
      override: {
        enemyBasePower: Math.round(baseEnemyPower * 1.16 * 10) / 10,
        baseAddPerFloor: Math.max(2, Math.round(baseAdd * 0.9 * 10) / 10),
        synergyHitRatePct: Math.max(8, Math.round(baseSynergyHit * 0.86))
      },
      doubleBossPenalty: 0.86
    },
    {
      tier: 15,
      code: 'A15',
      nameZh: 'A15 恶化事件与通胀削息', // cjk-ok
      nameEn: 'A15 Harsh Events & Inflation',
      modifierDescZh: '商店涨价 +25%，利息上限减半，怪物每层膨胀 +0.018', // cjk-ok
      modifierDescEn: 'Shop price +25%, interest cap halved, enemy growth +0.018',
      override: {
        enemyBasePower: Math.round(baseEnemyPower * 1.22 * 10) / 10,
        enemyGrowthRate: Math.round((baseGrowth + 0.018) * 1000) / 1000,
        baseAddPerFloor: Math.max(2, Math.round(baseAdd * 0.88 * 10) / 10),
        synergyHitRatePct: Math.max(8, Math.round(baseSynergyHit * 0.84)),
        interestCapPerFloor: Math.max(1, Math.floor(baseInterestCap * 0.6)),
        shopSpendThresholdGold: Math.round(baseShopGold * 1.25)
      },
      doubleBossPenalty: 0.76
    },
    {
      tier: 20,
      code: 'A20',
      nameZh: 'A20 双 Boss 连战终极试炼', // cjk-ok
      nameEn: 'A20 Double Boss Gauntlet',
      modifierDescZh: '终局双 Boss 连续检定（Boss 倍率 x1.28），膨胀率 +0.035', // cjk-ok
      modifierDescEn: 'Final Double Boss gauntlet (Boss mult x1.28), growth +0.035',
      override: {
        enemyBasePower: Math.round(baseEnemyPower * 1.28 * 10) / 10,
        enemyGrowthRate: Math.round((baseGrowth + 0.035) * 1000) / 1000,
        bossDifficultyMult: Math.round(baseBossMult * 1.28 * 100) / 100,
        baseAddPerFloor: Math.max(2, Math.round(baseAdd * 0.85 * 10) / 10),
        synergyHitRatePct: Math.max(6, Math.round(baseSynergyHit * 0.8)),
        interestCapPerFloor: Math.max(1, Math.floor(baseInterestCap * 0.5)),
        shopSpendThresholdGold: Math.round(baseShopGold * 1.3)
      },
      doubleBossPenalty: 0.68
    }
  ]

  return tiers.map((t) => {
    const sim = runMxRoguelikeEnvelopeSimulation({
      ...cfg,
      ...t.override,
      runs: sampleRuns
    })
    const clearRatePct = sim.firstRunClearRatePct
    const doubleBossPassPct = Math.round(clearRatePct * t.doubleBossPenalty * 10) / 10
    const wallCount = sim.difficultyWallFloors.length
    const verdict: MxAscensionTierRow['verdict'] =
      t.tier === 0 && clearRatePct < 20
        ? 'overtuned_wall'
        : t.tier >= 15 && clearRatePct > 65
          ? 'too_easy'
          : clearRatePct < 3 && t.tier < 20
            ? 'overtuned_wall'
            : t.tier >= 15 && clearRatePct >= 4 && clearRatePct <= 35
              ? 'brutal_fair'
              : 'sweet_spot'

    return {
      tier: t.tier,
      code: t.code,
      nameZh: t.nameZh,
      nameEn: t.nameEn,
      modifierDescZh: t.modifierDescZh,
      modifierDescEn: t.modifierDescEn,
      clearRatePct,
      doubleBossPassPct,
      metaRunsTo50Pct: sim.metaRunsTo50PctClear,
      wallCount,
      verdict
    }
  })
}

export interface MxCombatGoalSeekResult {
  targetWinRatePct: number
  previousEnemyHp: number
  recommendedEnemyHp: number
  achievedWinRatePct: number
  achievedTtkP50: number
  iterations: number
}

/**
 * 逆向目标求解器（Combat Kernel Reverse Goal-Seek）：
 * 给定设计师期望的目标胜率（如 75%），利用共同随机数（CRN）单调二分搜索反推最匹配的 Boss/敌方生命值。
 */
export function solveMxCombatTargetGoalSeek(
  cfg: MxCombatKernelConfig,
  targetWinRatePct: number
): MxCombatGoalSeekResult {
  const target = Math.max(5, Math.min(98, Number(targetWinRatePct || 75)))
  const curHp =
    cfg.kernel === 'deck_cycle'
      ? Math.max(10, cfg.enemyHp || 180)
      : cfg.kernel === 'mana_tempo'
        ? Math.max(5, cfg.opponentHp || 30)
        : Math.max(100, cfg.targetEnemyHp || 65000)

  let lo = Math.max(5, Math.round(curHp * 0.12))
  let hi = Math.max(lo + 50, Math.round(curHp * 5.0))
  let bestHp = curHp
  let bestWinRate = 0
  let bestTtk = cfg.maxTurns
  let bestDiff = Number.POSITIVE_INFINITY
  const sampleRuns = Math.min(240, Math.max(80, Math.round(cfg.runs || 160)))
  const iterations = 12

  for (let it = 0; it < iterations; it++) {
    const mid = Math.round((lo + hi) / 2)
    const trialCfg: MxCombatKernelConfig = {
      ...cfg,
      runs: sampleRuns,
      ...(cfg.kernel === 'deck_cycle'
        ? { enemyHp: mid }
        : cfg.kernel === 'mana_tempo'
          ? { opponentHp: mid }
          : { targetEnemyHp: mid })
    }
    const res = runMxCombatKernelSimulation(trialCfg)
    const diff = Math.abs(res.winRatePct - target)
    if (diff < bestDiff) {
      bestDiff = diff
      bestHp = mid
      bestWinRate = res.winRatePct
      bestTtk = res.ttkP50
    }
    // 敌方血量越高，玩家胜率越低（单调递减）
    if (res.winRatePct > target) {
      lo = mid + 1
    } else if (res.winRatePct < target) {
      hi = Math.max(lo, mid - 1)
    } else {
      break
    }
  }

  return {
    targetWinRatePct: target,
    previousEnemyHp: curHp,
    recommendedEnemyHp: bestHp,
    achievedWinRatePct: bestWinRate,
    achievedTtkP50: bestTtk,
    iterations
  }
}

export interface MxEnvelopeGoalSeekResult {
  targetClearRatePct: number
  previousGrowthRate: number
  recommendedGrowthRate: number
  achievedClearRatePct: number
  difficultyWallFloors: number[]
  iterations: number
}

/**
 * 逆向目标求解器（Roguelike Envelope Reverse Goal-Seek）：
 * 给定设计师期望的首局通关率（如 25%），利用共同随机数（CRN）二分搜索反推最匹配的关卡怪物每层指数膨胀率（enemyGrowthRate）。
 */
export function solveMxEnvelopeTargetGoalSeek(
  cfg: MxRoguelikeEnvelopeConfig,
  targetClearRatePct: number
): MxEnvelopeGoalSeekResult {
  const target = Math.max(2, Math.min(95, Number(targetClearRatePct || 25)))
  const prevRate = Math.max(1.02, cfg.enemyGrowthRate || 1.24)
  let lo = 1.03
  let hi = 1.65
  let bestRate = prevRate
  let bestClear = 0
  let bestWalls: number[] = []
  let bestDiff = Number.POSITIVE_INFINITY
  const sampleRuns = Math.min(260, Math.max(100, Math.round(cfg.runs || 200)))
  const iterations = 12

  for (let it = 0; it < iterations; it++) {
    const mid = Math.round(((lo + hi) / 2) * 1000) / 1000
    const res = runMxRoguelikeEnvelopeSimulation({
      ...cfg,
      runs: sampleRuns,
      enemyGrowthRate: mid
    })
    const diff = Math.abs(res.firstRunClearRatePct - target)
    if (diff < bestDiff) {
      bestDiff = diff
      bestRate = mid
      bestClear = res.firstRunClearRatePct
      bestWalls = res.difficultyWallFloors
    }
    // 怪物指数膨胀率越高，首局通关率越低（单调递减）
    if (res.firstRunClearRatePct > target) {
      lo = mid
    } else if (res.firstRunClearRatePct < target) {
      hi = mid
    } else {
      break
    }
  }

  return {
    targetClearRatePct: target,
    previousGrowthRate: prevRate,
    recommendedGrowthRate: bestRate,
    achievedClearRatePct: bestClear,
    difficultyWallFloors: bestWalls,
    iterations
  }
}

// ───────────────────────────── 4.5 商业产品级：多流派天梯生态平衡矩阵 & 商业化分层留存变现审计 ─────────────────────────────

export type MxBuildArchetypeId =
  'current_custom' | 'strength_burst' | 'attrition_block' | 'high_cycle_combo'

export interface MxArchetypeBalanceRow {
  archetypeId: MxBuildArchetypeId
  nameZh: string
  nameEn: string
  winRatePct: number
  ttkP50: number
  avgHpLoss: number
  /** 基于胜率与通关效率 Softmax 估算的商业天梯流派使用率占比 (%) */
  metaSharePct: number
  tier: 'T0_dominant' | 'T1_viable' | 'T2_niche' | 'T3_unplayable'
}

export interface MxArchetypeBalanceMatrixResult {
  /** 香农信息熵（Shannon Entropy）归一化流派百花齐放指数 (0..100，越高越均衡) */
  metaDiversityScore: number
  /** 当前流派生态健康度判定 */
  verdict: 'meta_healthy' | 'tier0_monopoly' | 'boss_overtuned'
  dominantArchetypeId: MxBuildArchetypeId
  rows: MxArchetypeBalanceRow[]
}

/**
 * 获取天梯对标矩阵内置的标准基准流派卡组（也可载入工作台编辑器二次微调）。
 */
export function getMxCanonicalArchetypeDeck(
  archetypeId: 'strength_burst' | 'attrition_block' | 'high_cycle_combo'
): MxDeckCardSpec[] {
  if (archetypeId === 'strength_burst') {
    return [
      {
        id: 'arc_str_inflame',
        name: 'Inflame+',
        cost: 1,
        count: 2,
        damage: 0,
        block: 0,
        draw: 0,
        energyGain: 0,
        applyStrength: 3,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: true,
        priority: 5
      },
      {
        id: 'arc_str_bash',
        name: 'Bash+',
        cost: 2,
        count: 1,
        damage: 10,
        block: 0,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 3,
        applyWeak: 0,
        exhaust: false,
        priority: 4
      },
      {
        id: 'arc_str_multi',
        name: 'Twin / Pummel Strike',
        cost: 1,
        count: 4,
        damage: 5,
        hits: 3,
        block: 0,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: false,
        priority: 3
      },
      {
        id: 'arc_str_def',
        name: 'Defend',
        cost: 1,
        count: 3,
        damage: 0,
        block: 5,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: false,
        priority: 1
      }
    ]
  }
  if (archetypeId === 'attrition_block') {
    return [
      {
        id: 'arc_blk_wall',
        name: 'Impervious / Glacier',
        cost: 2,
        count: 2,
        damage: 0,
        block: 18,
        draw: 1,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 1,
        exhaust: false,
        priority: 5
      },
      {
        id: 'arc_blk_slam',
        name: 'Body Slam / Counter',
        cost: 1,
        count: 3,
        damage: 14,
        block: 6,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: false,
        priority: 4
      },
      {
        id: 'arc_blk_shrug',
        name: 'Shrug It Off',
        cost: 1,
        count: 3,
        damage: 0,
        block: 9,
        draw: 1,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: false,
        priority: 3
      },
      {
        id: 'arc_blk_weak',
        name: 'Clothesline (Weak)',
        cost: 2,
        count: 2,
        damage: 12,
        block: 0,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 2,
        exhaust: false,
        priority: 2
      }
    ]
  }
  return [
    {
      id: 'arc_cyc_offering',
      name: 'Offering / Adrenaline',
      cost: 0,
      count: 2,
      damage: 0,
      block: 0,
      draw: 3,
      energyGain: 2,
      applyStrength: 0,
      applyVulnerable: 0,
      applyWeak: 0,
      exhaust: true,
      priority: 5
    },
    {
      id: 'arc_cyc_finesse',
      name: 'Flash of Steel / Claw',
      cost: 0,
      count: 4,
      damage: 6,
      block: 3,
      draw: 1,
      energyGain: 0,
      applyStrength: 1,
      applyVulnerable: 0,
      applyWeak: 0,
      exhaust: false,
      priority: 4
    },
    {
      id: 'arc_cyc_pommel',
      name: 'Pommel Strike+',
      cost: 1,
      count: 3,
      damage: 10,
      block: 0,
      draw: 2,
      energyGain: 0,
      applyStrength: 0,
      applyVulnerable: 0,
      applyWeak: 0,
      exhaust: false,
      priority: 3
    },
    {
      id: 'arc_cyc_def',
      name: 'Escape Plan',
      cost: 0,
      count: 2,
      damage: 0,
      block: 5,
      draw: 1,
      energyGain: 0,
      applyStrength: 0,
      applyVulnerable: 0,
      applyWeak: 0,
      exhaust: false,
      priority: 2
    }
  ]
}

/**
 * 商业产品级：多流派天梯生态平衡矩阵（Multi-Archetype Meta-Balance Matrix）：
 * 将玩家自定义卡组与 3 套标准基准流派（支持用户自定义覆写槽位）
 * 在相同 Boss 机制与随机种子下横向对标，计算天梯预估使用率与 Shannon 生态多样性评分。
 */
export function runMxArchetypeBalanceMatrix(
  cfg: MxCombatKernelConfig
): MxArchetypeBalanceMatrixResult {
  const sampleRuns = Math.min(180, Math.max(60, Math.round((cfg.runs || 160) * 0.6)))

  const strengthBurstDeck =
    cfg.customArchetypeDecks?.strength_burst && cfg.customArchetypeDecks.strength_burst.length > 0
      ? cfg.customArchetypeDecks.strength_burst
      : getMxCanonicalArchetypeDeck('strength_burst')
  const attritionBlockDeck =
    cfg.customArchetypeDecks?.attrition_block && cfg.customArchetypeDecks.attrition_block.length > 0
      ? cfg.customArchetypeDecks.attrition_block
      : getMxCanonicalArchetypeDeck('attrition_block')
  const highCycleComboDeck =
    cfg.customArchetypeDecks?.high_cycle_combo &&
    cfg.customArchetypeDecks.high_cycle_combo.length > 0
      ? cfg.customArchetypeDecks.high_cycle_combo
      : getMxCanonicalArchetypeDeck('high_cycle_combo')

  const specs: Array<{
    id: MxBuildArchetypeId
    nameZh: string
    nameEn: string
    deck: MxDeckCardSpec[]
  }> = [
    {
      id: 'current_custom',
      nameZh: '当前工作台流派 (Current Build)', // cjk-ok
      nameEn: 'Current Workbench Build',
      deck: cfg.deckCards
    },
    {
      id: 'strength_burst',
      nameZh: '多段力量爆发流 (Strength Burst)', // cjk-ok
      nameEn: 'Strength Multi-Hit Burst',
      deck: strengthBurstDeck
    },
    {
      id: 'attrition_block',
      nameZh: '叠甲壁垒反击流 (Turtle Block)', // cjk-ok
      nameEn: 'Attrition Block & Slam',
      deck: attritionBlockDeck
    },
    {
      id: 'high_cycle_combo',
      nameZh: '零费过牌无限流 (High-Cycle Engine)', // cjk-ok
      nameEn: 'High-Cycle Combo Engine',
      deck: highCycleComboDeck
    }
  ]

  const rawRows = specs.map((sp) => {
    const sim = runMxCombatKernelSimulation({
      ...cfg,
      kernel: 'deck_cycle',
      runs: sampleRuns,
      deckCards: sp.deck
    })
    // 综合强度分：胜率为主，兼顾低回合击杀与低战损
    const score =
      sim.winRatePct * 1.1 + Math.max(0, 12 - sim.ttkP50) * 2.5 - Math.min(40, sim.kpi1Value * 0.35)
    return {
      archetypeId: sp.id,
      nameZh: sp.nameZh,
      nameEn: sp.nameEn,
      winRatePct: sim.winRatePct,
      ttkP50: sim.ttkP50,
      avgHpLoss: sim.kpi1Value,
      rawScore: score
    }
  })

  // 使用温度系数 T=18 的 Softmax 计算商业天梯预估使用率占比
  const maxScore = Math.max(...rawRows.map((r) => r.rawScore))
  const expWeights = rawRows.map((r) => Math.exp((r.rawScore - maxScore) / 18))
  const sumExp = expWeights.reduce((a, b) => a + b, 0) || 1

  const rows: MxArchetypeBalanceRow[] = rawRows.map((r, i) => {
    const share = Math.round(((expWeights[i] ?? 0.25) / sumExp) * 1000) / 10
    const tier: MxArchetypeBalanceRow['tier'] =
      r.winRatePct >= 80 && share >= 34
        ? 'T0_dominant'
        : r.winRatePct >= 55
          ? 'T1_viable'
          : r.winRatePct >= 30
            ? 'T2_niche'
            : 'T3_unplayable'
    return {
      archetypeId: r.archetypeId,
      nameZh: r.nameZh,
      nameEn: r.nameEn,
      winRatePct: r.winRatePct,
      ttkP50: r.ttkP50,
      avgHpLoss: r.avgHpLoss,
      metaSharePct: share,
      tier
    }
  })

  // 计算归一化香农熵 H / ln(4) 并结合有效流派存活率给出 Meta 多样性指数
  let entropy = 0
  for (const r of rows) {
    const p = Math.max(0.001, r.metaSharePct / 100)
    entropy -= p * Math.log(p)
  }
  const normalizedEntropy = Math.min(1, entropy / Math.log(rows.length))
  const viableCount = rows.filter((r) => r.winRatePct >= 45).length
  const viabilityFactor = viableCount / rows.length
  const metaDiversityScore = Math.round(normalizedEntropy * (0.65 + 0.35 * viabilityFactor) * 100)

  const sortedByShare = [...rows].sort((a, b) => b.metaSharePct - a.metaSharePct)
  const dominant = sortedByShare[0]!
  const maxWin = Math.max(...rows.map((r) => r.winRatePct))
  const verdict: MxArchetypeBalanceMatrixResult['verdict'] =
    maxWin < 40
      ? 'boss_overtuned'
      : dominant.metaSharePct >= 46 || viableCount <= 1
        ? 'tier0_monopoly'
        : 'meta_healthy'

  return {
    metaDiversityScore,
    verdict,
    dominantArchetypeId: dominant.archetypeId,
    rows
  }
}

export type MxPlayerCohortId = 'f2p_grinder' | 'minnow_pass' | 'dolphin_spender' | 'whale_collector'

export interface MxCommercialCohortRow {
  cohortId: MxPlayerCohortId
  nameZh: string
  nameEn: string
  monthlySpendUsd: number
  dailyAttempts: number
  daysToGraduateP50: number
  daysToGraduateP90: number
  day30GraduationRatePct: number
  frustrationChokeRisk: 'low' | 'moderate' | 'high_churn'
}

export interface MxCommercialCohortAnalysisResult {
  mode: MxLootRollMode
  /** 保底机制付费转化弹性评分 (0..100) */
  pityElasticityScore: number
  /** 重氪 vs 零氪首月成型进度剪刀差倍率（理想健康区间 1.4x ~ 2.8x） */
  whaleToF2pProgressRatio: number
  /** 预估千人活跃日付费 ARPU ($) */
  estimatedBlendedArpuUsd: number
  cohorts: MxCommercialCohortRow[]
}

/**
 * 商业产品级：玩家付费分层（F2P / 月卡小R / 中R季票 / 重氪大R）留存卡点与毕业周期遥测模型：
 * 将第 2 层概率分布（P10/P50/P90）映射为各付费分层玩家的自然日毕业天数、首月 30 天毕业率与非酋流失风险。
 */
export function runMxCommercialCohortAnalysis(
  lootCfg: MxLootRollConfig
): MxCommercialCohortAnalysisResult {
  const lootRes = runMxLootAndSubstatSimulation({
    ...lootCfg,
    runs: Math.min(400, Math.max(100, lootCfg.runs || 250))
  })

  // 按模式定义各付费分层每日可获取的抽数 / 刷本次数 / 构筑局数
  const cohortSpecs: Array<{
    cohortId: MxPlayerCohortId
    nameZh: string
    nameEn: string
    monthlySpendUsd: number
    populationWeight: number
    dailyAttempts: number
  }> =
    lootCfg.mode === 'gacha_pity'
      ? [
          {
            cohortId: 'f2p_grinder',
            nameZh: '零氪全勤党 (F2P)', // cjk-ok
            nameEn: 'F2P Daily Grinder',
            monthlySpendUsd: 0,
            populationWeight: 0.68,
            dailyAttempts: 1.4
          },
          {
            cohortId: 'minnow_pass',
            nameZh: '月卡/通行证微氪 (Minnow)', // cjk-ok
            nameEn: 'Monthly Pass & BP ($15)',
            monthlySpendUsd: 15,
            populationWeight: 0.22,
            dailyAttempts: 3.2
          },
          {
            cohortId: 'dolphin_spender',
            nameZh: '中R首充礼包党 (Dolphin)', // cjk-ok
            nameEn: 'Dolphin Pack Buyer ($80)',
            monthlySpendUsd: 80,
            populationWeight: 0.08,
            dailyAttempts: 7.5
          },
          {
            cohortId: 'whale_collector',
            nameZh: '重氪满命全图鉴 (Whale)', // cjk-ok
            nameEn: 'Whale Collector ($450)',
            monthlySpendUsd: 450,
            populationWeight: 0.02,
            dailyAttempts: 28.0
          }
        ]
      : lootCfg.mode === 'substat_enhance'
        ? [
            {
              cohortId: 'f2p_grinder',
              nameZh: '零氪自然回体党 (F2P)', // cjk-ok
              nameEn: 'F2P Natural Stamina',
              monthlySpendUsd: 0,
              populationWeight: 0.65,
              dailyAttempts: 8
            },
            {
              cohortId: 'minnow_pass',
              nameZh: '月卡每日买体党 (Minnow)', // cjk-ok
              nameEn: 'Pass + 1x Stamina Refill',
              monthlySpendUsd: 12,
              populationWeight: 0.24,
              dailyAttempts: 15
            },
            {
              cohortId: 'dolphin_spender',
              nameZh: '中R周常体力包 (Dolphin)', // cjk-ok
              nameEn: 'Dolphin 3x Refill ($65)',
              monthlySpendUsd: 65,
              populationWeight: 0.09,
              dailyAttempts: 26
            },
            {
              cohortId: 'whale_collector',
              nameZh: '重氪满体竞速党 (Whale)', // cjk-ok
              nameEn: 'Whale Max Refill ($320)',
              monthlySpendUsd: 320,
              populationWeight: 0.02,
              dailyAttempts: 55
            }
          ]
        : [
            {
              cohortId: 'f2p_grinder',
              nameZh: '轻度休闲玩家 (Casual)', // cjk-ok
              nameEn: 'Casual (1 Run/Day)',
              monthlySpendUsd: 0,
              populationWeight: 0.6,
              dailyAttempts: 3
            },
            {
              cohortId: 'minnow_pass',
              nameZh: '核心买断玩家 (Core)', // cjk-ok
              nameEn: 'Core Buyer ($15 Base)',
              monthlySpendUsd: 15,
              populationWeight: 0.28,
              dailyAttempts: 7
            },
            {
              cohortId: 'dolphin_spender',
              nameZh: '全DLC季票玩家 (Deluxe)', // cjk-ok
              nameEn: 'Deluxe + DLC Pass ($35)',
              monthlySpendUsd: 35,
              populationWeight: 0.1,
              dailyAttempts: 14
            },
            {
              cohortId: 'whale_collector',
              nameZh: '硬核全成就主播 (Hardcore)', // cjk-ok
              nameEn: 'Hardcore Streamer ($60)',
              monthlySpendUsd: 60,
              populationWeight: 0.02,
              dailyAttempts: 28
            }
          ]

  const p10 = Math.max(1, lootRes.attemptsP10)
  const p50 = Math.max(1, lootRes.attemptsP50)
  const p90 = Math.max(p50 + 1, lootRes.attemptsP90)

  const cohorts: MxCommercialCohortRow[] = cohortSpecs.map((sp) => {
    const daysP50 = Math.max(1, Math.round((p50 / sp.dailyAttempts) * 10) / 10)
    const daysP90 = Math.max(daysP50, Math.round((p90 / sp.dailyAttempts) * 10) / 10)
    const budget30d = sp.dailyAttempts * 30

    // 基于 P10/P50/P90 分位插值估算 30 天内达成毕业目标的玩家比例
    let gradRate = 0
    if (budget30d >= p90) {
      gradRate = Math.min(99.5, 90 + ((budget30d - p90) / Math.max(10, p90)) * 9.5)
    } else if (budget30d >= p50) {
      gradRate = 50 + ((budget30d - p50) / Math.max(1, p90 - p50)) * 40
    } else if (budget30d >= p10) {
      gradRate = 10 + ((budget30d - p10) / Math.max(1, p50 - p10)) * 40
    } else {
      gradRate = (budget30d / Math.max(1, p10)) * 10
    }
    const day30GraduationRatePct = Math.round(Math.max(1, Math.min(99.5, gradRate)) * 10) / 10

    const varianceRatio = p90 / Math.max(1, p50)
    const frustrationChokeRisk: MxCommercialCohortRow['frustrationChokeRisk'] =
      daysP90 > 65 || (sp.monthlySpendUsd > 0 && day30GraduationRatePct < 35)
        ? 'high_churn'
        : daysP90 > 30 || varianceRatio > 2.3
          ? 'moderate'
          : 'low'

    return {
      cohortId: sp.cohortId,
      nameZh: sp.nameZh,
      nameEn: sp.nameEn,
      monthlySpendUsd: sp.monthlySpendUsd,
      dailyAttempts: sp.dailyAttempts,
      daysToGraduateP50: daysP50,
      daysToGraduateP90: daysP90,
      day30GraduationRatePct,
      frustrationChokeRisk
    }
  })

  const f2pRow = cohorts[0]!
  const minnowRow = cohorts[1]!
  const whaleRow = cohorts[cohorts.length - 1]!

  // 保底弹性评分：衡量微氪/中R对比零氪在 30 天毕业率上的边际跃升与非酋方差收敛度
  const conversionLift = Math.max(
    0,
    minnowRow.day30GraduationRatePct - f2pRow.day30GraduationRatePct
  )
  const tailTightness = Math.max(0, 100 - Math.max(0, (p90 / Math.max(1, p50) - 1.2) * 35))
  const pityElasticityScore = Math.round(
    Math.min(98, Math.max(15, conversionLift * 1.1 + tailTightness * 0.55))
  )

  const whaleToF2pProgressRatio =
    Math.round(
      (whaleRow.day30GraduationRatePct / Math.max(5, f2pRow.day30GraduationRatePct)) * 100
    ) / 100

  const estimatedBlendedArpuUsd =
    Math.round(
      cohortSpecs.reduce((acc, s) => acc + s.monthlySpendUsd * s.populationWeight, 0) * 100
    ) / 100

  return {
    mode: lootCfg.mode,
    pityElasticityScore,
    whaleToF2pProgressRatio,
    estimatedBlendedArpuUsd,
    cohorts
  }
}

export interface MxLevelProgressionResult {
  maxLevel: number
  ascensionInterval: number
  maxLevelHp: number
  maxLevelAtk: number
  maxLevelDef: number
  statMultiplierTotal: number
  totalXpToMax: number
  totalGoldToMax: number
  totalDaysToMax: number
  rows: GameLevelCurveRow[]
  milestones: GameLevelCurveRow[]
}

/**
 * 角色/武器等级与突破成长曲线生成器（Lv.1 ~ Lv.Max Progression & Ascension Breakthrough Table）：
 * 結合基础属性、每级复合成长率与突破阶跃加成（如每 20 级突破一次），生成完整的等级属性、经验需求、金币消耗与体力养成天数配表。
 */
export function generateMxLevelProgressionTable(
  cfg: MxRoguelikeEnvelopeConfig
): MxLevelProgressionResult {
  const maxLv = Math.max(10, Math.min(5000, Math.round(cfg.levelMax ?? 80)))
  const rawGrowthPct = Math.max(0.5, Math.min(25, Number(cfg.levelStatGrowthPct ?? 4.2))) / 100
  const rawInterval = Math.max(5, Math.min(500, Math.round(cfg.levelAscensionInterval ?? 20)))
  // 当用户动态设置超大章节/等级上限（如 800 章、2000 章）时，自适应缩放突破周期与单级复合增长率，防止数值指数溢出
  const ascInterval =
    maxLv > 160 && rawInterval <= 30 ? Math.max(rawInterval, Math.round(maxLv / 10)) : rawInterval
  const effectiveExponentSpan = Math.min(100, maxLv - 1)
  const ascBonusPct = Math.max(0, Math.min(100, Number(cfg.levelAscensionBonusPct ?? 18))) / 100
  const xpExp = Math.max(1.05, Math.min(3.0, Number(cfg.levelXpExponent ?? 1.55)))

  const baseAtk = Math.max(10, Math.round((cfg.playerBasePower || 32) * 3.5))
  const baseHp = baseAtk * 8
  const baseDef = Math.round(baseAtk * 0.65)
  const baseXp = 400
  const dailyXpYield = 38000

  const rows: GameLevelCurveRow[] = []
  let cumXp = 0
  let cumGold = 0

  for (let lv = 1; lv <= maxLv; lv++) {
    const ascStage = Math.floor((lv - 1) / ascInterval)
    const isBreakthrough = lv > 1 && (lv - 1) % ascInterval === 0
    const normalizedStep =
      maxLv <= 100 ? lv - 1 : ((lv - 1) / Math.max(1, maxLv - 1)) * effectiveExponentSpan
    const levelFactor = Math.pow(1 + rawGrowthPct, normalizedStep)
    const ascFactor = 1 + ascStage * ascBonusPct
    const mult = levelFactor * ascFactor

    const hp = Math.round(baseHp * mult)
    const atk = Math.round(baseAtk * mult)
    const def = Math.round(baseDef * mult)

    const xpReq = lv === 1 ? 0 : Math.round(baseXp * Math.pow(normalizedStep, xpExp))
    cumXp += xpReq
    const breakthroughMats = isBreakthrough ? ascStage * 6 : 0
    const goldCost =
      lv === 1 ? 0 : Math.round(xpReq * 0.8 + (isBreakthrough ? ascStage * 20000 : 0))
    cumGold += goldCost
    const staminaDaysToReach = Math.round((cumXp / dailyXpYield) * 10) / 10

    rows.push({
      level: lv,
      ascensionStage: ascStage,
      isBreakthrough,
      hp,
      atk,
      def,
      xpRequired: xpReq,
      cumulativeXp: cumXp,
      goldCost,
      breakthroughMats,
      staminaDaysToReach
    })
  }

  const milestoneStep = Math.max(
    ascInterval,
    Math.ceil(maxLv / 16 / Math.max(1, ascInterval)) * ascInterval
  )
  const milestones = rows.filter(
    (r) =>
      r.level === 1 ||
      (r.isBreakthrough && (r.level - 1) % milestoneStep === 0) ||
      r.level % milestoneStep === 0 ||
      r.level === maxLv
  )
  const lastRow = rows[rows.length - 1]!
  const statMultiplierTotal = Math.round((lastRow.atk / Math.max(1, rows[0]!.atk)) * 100) / 100

  return {
    maxLevel: maxLv,
    ascensionInterval: ascInterval,
    maxLevelHp: lastRow.hp,
    maxLevelAtk: lastRow.atk,
    maxLevelDef: lastRow.def,
    statMultiplierTotal,
    totalXpToMax: cumXp,
    totalGoldToMax: cumGold,
    totalDaysToMax: lastRow.staminaDaysToReach,
    rows,
    milestones
  }
}

export interface MxEquipmentUpgradeResult {
  maxEnhanceLevel: number
  finalMainStat: number
  totalBaseGold: number
  totalExpectedGoldWithFails: number
  totalExpectedStamina: number
  bottleneckEnhanceLevel: number
  rows: GameEquipmentUpgradeRow[]
}

/**
 * 装备强化等级与养成消耗阶梯表生成器（Equipment +1 ~ +15 Upgrade Cost & Blacksmith Success Matrix）：
 * 支持狗粮必成模式（衰减率=0%）与铁匠铺概率失败模式（+5 后每级衰减），自动核算期望金币回收与期望体力消耗。
 */
export function generateMxEquipmentUpgradeMatrix(cfg: MxLootRollConfig): MxEquipmentUpgradeResult {
  const maxLv = Math.max(5, Math.min(25, Math.round(cfg.equipMaxEnhanceLevel ?? 15)))
  const baseMain = Math.max(1, Number(cfg.equipBaseMainStat ?? 47))
  const stepMain = Math.max(1, Number(cfg.equipMainStatStep ?? 18))
  const expExp = Math.max(1.05, Math.min(2.6, Number(cfg.equipExpGrowthExponent ?? 1.38)))
  const decayPct = Math.max(0, Math.min(18, Number(cfg.equipSuccessDecayAfter5Pct ?? 6)))
  const staminaPerDrop = Math.max(4, Number(cfg.staminaPerDrop || 12))
  const baseExp = 800

  const rows: GameEquipmentUpgradeRow[] = []
  let cumBaseGold = 0
  let cumExpGold = 0
  let cumStamina = 0
  let maxJumpGold = 0
  let bottleneckLv = maxLv

  for (let lv = 1; lv <= maxLv; lv++) {
    const mainStatValue = Math.round((baseMain + lv * stepMain) * 10) / 10
    const substatRollsUnlocked = Math.floor(lv / 3)
    const expCost = Math.round(baseExp * Math.pow(lv, expExp))
    const goldCost = Math.round(expCost * 1.5)
    const successRatePct =
      lv <= 5 ? 100 : Math.max(12, Math.round((100 - (lv - 5) * decayPct) * 10) / 10)
    const expectedGoldWithFails = Math.round(goldCost / (successRatePct / 100))
    const stepStamina = Math.round((expCost / 600 / (successRatePct / 100)) * staminaPerDrop)

    cumBaseGold += goldCost
    cumExpGold += expectedGoldWithFails
    cumStamina += stepStamina

    if (expectedGoldWithFails - goldCost > maxJumpGold) {
      maxJumpGold = expectedGoldWithFails - goldCost
      bottleneckLv = lv
    }

    rows.push({
      enhanceLevel: lv,
      mainStatValue,
      substatRollsUnlocked,
      expCost,
      goldCost,
      successRatePct,
      expectedGoldWithFails,
      cumulativeExpectedGold: cumExpGold,
      cumulativeExpectedStamina: cumStamina
    })
  }

  return {
    maxEnhanceLevel: maxLv,
    finalMainStat: rows[rows.length - 1]?.mainStatValue ?? baseMain,
    totalBaseGold: cumBaseGold,
    totalExpectedGoldWithFails: cumExpGold,
    totalExpectedStamina: cumStamina,
    bottleneckEnhanceLevel: bottleneckLv,
    rows
  }
}

export interface MxJokerSlotTriggerStep {
  slotIndex: number
  id: string
  name: string
  role: 'chips' | 'add_mult' | 'x_mult'
  effectLabel: string
  runningChips: number
  runningMult: number
  runningScore: number
}

export interface MxPokerPlanetRow {
  handId: string
  handNameZh: string
  handNameEn: string
  planetNameZh: string
  planetNameEn: string
  baseChips: number
  baseMult: number
  deltaChipsPerLv: number
  deltaMultPerLv: number
  lv1Score: number
  lv5Score: number
  lv10Score: number
  lv15Score: number
  lv5WithOptimalJokersScore: number
}

export interface MxBalatroBossBlindRow {
  blindId: string
  nameZh: string
  nameEn: string
  ruleDescZh: string
  ruleDescEn: string
  targetScore: number
  achievedScoreWithOptimal: number
  verdict: 'pass' | 'risky' | 'countered'
}

export interface MxJokerOrderAndPlanetResult {
  baseHandChips: number
  baseHandMult: number
  wrongOrderScore: number
  currentOrderScore: number
  optimalOrderScore: number
  orderGainRatio: number
  optimalSlots: MxJokerSlotTriggerStep[]
  planetHands: MxPokerPlanetRow[]
  bossBlinds: MxBalatroBossBlindRow[]
}

/**
 * 《小丑牌 Balatro》专属三大灵魂机制仿真器：
 * 1. 小丑槽位顺序优化器（左加右乘：+Chips -> +Mult -> ×Mult 对比 ×Mult 在左 +Mult 在右的错位损失）
 * 2. 9 大德州扑克牌型 × 行星牌（Planet Lv.1~Lv.15）成长阶梯表
 * 3. 6 大经典 Boss 盲注（The Wall / The Flint / The Needle / The Plant / Amber Acorn / Violet Vessel）针对性封锁审计
 */
export function simulateMxJokerSlotOrderAndPlanetTable(
  cfg: MxMultiplierPipelineConfig
): MxJokerOrderAndPlanetResult {
  const baseChipsAttr = cfg.attributes.find((a) => /basechips|atk|mana/i.test(a.name))
  const baseMultAttr = cfg.attributes.find((a) => /basemult|crit|hp/i.test(a.name))
  const baseHandChips = Math.max(10, Math.round(baseChipsAttr?.value ?? 100))
  const baseHandMult = Math.max(1, Math.round(baseMultAttr?.value ?? 10))

  // 从当前实体表提取或构造 5 张代表性槽位卡（含 +Chips、+Mult、×Mult）
  const rawEntities = cfg.entities.slice(0, 5)
  interface SlotSpec {
    id: string
    name: string
    chips: number
    addMult: number
    xMult: number
    role: 'chips' | 'add_mult' | 'x_mult'
  }
  const slots: SlotSpec[] = rawEntities.map((ent) => {
    const chips = Number(ent.stats.chips ?? ent.stats.dmg ?? ent.stats.atk ?? 0)
    const addMult = Number(ent.stats.addMult ?? ent.stats.block ?? ent.stats.hp ?? 0)
    const rawXm = Number(ent.stats.xMult ?? 1)
    const xMult = rawXm > 1 ? rawXm : ent.rarity === 'legendary' || ent.rarity === 'rare' ? 2.2 : 1
    const role: SlotSpec['role'] = xMult > 1 ? 'x_mult' : addMult >= chips ? 'add_mult' : 'chips'
    return {
      id: ent.id,
      name: ent.name,
      chips: role === 'chips' ? Math.max(30, chips) : chips,
      addMult: role === 'add_mult' ? Math.max(12, addMult) : addMult,
      xMult,
      role
    }
  })

  // 确保至少存在 +Mult 与 ×Mult 以便展示左加右乘顺序差异
  if (!slots.some((s) => s.role === 'x_mult') && slots.length >= 2) {
    slots[slots.length - 1]!.role = 'x_mult'
    slots[slots.length - 1]!.xMult = 2.5
  }
  if (!slots.some((s) => s.role === 'add_mult') && slots.length >= 1) {
    slots[0]!.role = 'add_mult'
    slots[0]!.addMult = 20
  }

  const evalSequence = (
    seq: SlotSpec[],
    initChips = baseHandChips,
    initMult = baseHandMult
  ): { score: number; steps: MxJokerSlotTriggerStep[] } => {
    let c = initChips
    let m = initMult
    const steps: MxJokerSlotTriggerStep[] = []
    seq.forEach((s, idx) => {
      let effectLabel = ''
      if (s.chips > 0) {
        c += s.chips
        effectLabel += `+${s.chips} Chips `
      }
      if (s.addMult > 0) {
        m += s.addMult
        effectLabel += `+${s.addMult} Mult `
      }
      if (s.xMult > 1) {
        m = Math.round(m * s.xMult * 100) / 100
        effectLabel += `×${s.xMult} Mult`
      }
      if (!effectLabel) effectLabel = '+10 Chips'
      steps.push({
        slotIndex: idx + 1,
        id: s.id,
        name: s.name,
        role: s.role,
        effectLabel: effectLabel.trim(),
        runningChips: Math.round(c),
        runningMult: Math.round(m * 10) / 10,
        runningScore: Math.round(c * m)
      })
    })
    return { score: Math.round(c * m), steps }
  }

  const currentEval = evalSequence(slots)
  // 最优顺序：先 +Chips，再所有 +Mult，最后所有 ×Mult（左加右乘最大化乘区放大）
  const optimalSorted = [...slots].sort((a, b) => {
    const rank = (r: SlotSpec['role']): number => (r === 'chips' ? 0 : r === 'add_mult' ? 1 : 2)
    return rank(a.role) - rank(b.role)
  })
  const optimalEval = evalSequence(optimalSorted)

  // 最差错位顺序：把 ×Mult 放在最左边（先乘了小小的基础倍率），把 +Mult 放在最右边（吃不到独立乘区）
  const wrongSorted = [...slots].sort((a, b) => {
    const rank = (r: SlotSpec['role']): number => (r === 'x_mult' ? 0 : r === 'chips' ? 1 : 2)
    return rank(a.role) - rank(b.role)
  })
  const wrongEval = evalSequence(wrongSorted)
  const orderGainRatio = Math.round((optimalEval.score / Math.max(1, wrongEval.score)) * 100) / 100

  const RAW_PLANETS: Array<{
    handId: string
    handNameZh: string
    handNameEn: string
    planetNameZh: string
    planetNameEn: string
    baseChips: number
    baseMult: number
    deltaChipsPerLv: number
    deltaMultPerLv: number
  }> = [
    {
      handId: 'high_card',
      handNameZh: '高牌 (High Card)', // cjk-ok
      handNameEn: 'High Card',
      planetNameZh: '冥王星 (Pluto)', // cjk-ok
      planetNameEn: 'Pluto',
      baseChips: 5,
      baseMult: 1,
      deltaChipsPerLv: 10,
      deltaMultPerLv: 1
    },
    {
      handId: 'pair',
      handNameZh: '对子 (Pair)', // cjk-ok
      handNameEn: 'Pair',
      planetNameZh: '水星 (Mercury)', // cjk-ok
      planetNameEn: 'Mercury',
      baseChips: 10,
      baseMult: 2,
      deltaChipsPerLv: 15,
      deltaMultPerLv: 1
    },
    {
      handId: 'two_pair',
      handNameZh: '两对 (Two Pair)', // cjk-ok
      handNameEn: 'Two Pair',
      planetNameZh: '天王星 (Uranus)', // cjk-ok
      planetNameEn: 'Uranus',
      baseChips: 20,
      baseMult: 2,
      deltaChipsPerLv: 20,
      deltaMultPerLv: 1
    },
    {
      handId: 'three_kind',
      handNameZh: '三条 (Three of a Kind)', // cjk-ok
      handNameEn: 'Three of a Kind',
      planetNameZh: '金星 (Venus)', // cjk-ok
      planetNameEn: 'Venus',
      baseChips: 30,
      baseMult: 3,
      deltaChipsPerLv: 20,
      deltaMultPerLv: 2
    },
    {
      handId: 'straight',
      handNameZh: '顺子 (Straight)', // cjk-ok
      handNameEn: 'Straight',
      planetNameZh: '土星 (Saturn)', // cjk-ok
      planetNameEn: 'Saturn',
      baseChips: 30,
      baseMult: 4,
      deltaChipsPerLv: 30,
      deltaMultPerLv: 3
    },
    {
      handId: 'flush',
      handNameZh: '同花 (Flush)', // cjk-ok
      handNameEn: 'Flush',
      planetNameZh: '木星 (Jupiter)', // cjk-ok
      planetNameEn: 'Jupiter',
      baseChips: 35,
      baseMult: 4,
      deltaChipsPerLv: 15,
      deltaMultPerLv: 2
    },
    {
      handId: 'full_house',
      handNameZh: '葫芦 (Full House)', // cjk-ok
      handNameEn: 'Full House',
      planetNameZh: '地球 (Earth)', // cjk-ok
      planetNameEn: 'Earth',
      baseChips: 40,
      baseMult: 4,
      deltaChipsPerLv: 25,
      deltaMultPerLv: 2
    },
    {
      handId: 'four_kind',
      handNameZh: '四条 (Four of a Kind)', // cjk-ok
      handNameEn: 'Four of a Kind',
      planetNameZh: '火星 (Mars)', // cjk-ok
      planetNameEn: 'Mars',
      baseChips: 60,
      baseMult: 7,
      deltaChipsPerLv: 30,
      deltaMultPerLv: 3
    },
    {
      handId: 'straight_flush',
      handNameZh: '同花顺 (Straight Flush)', // cjk-ok
      handNameEn: 'Straight Flush',
      planetNameZh: '海王星 (Neptune)', // cjk-ok
      planetNameEn: 'Neptune',
      baseChips: 100,
      baseMult: 8,
      deltaChipsPerLv: 40,
      deltaMultPerLv: 4
    }
  ]

  const planetHands: MxPokerPlanetRow[] = RAW_PLANETS.map((p) => {
    const scoreAt = (lv: number): number => {
      const ch = p.baseChips + (lv - 1) * p.deltaChipsPerLv
      const ml = p.baseMult + (lv - 1) * p.deltaMultPerLv
      return ch * ml
    }
    const ch5 = p.baseChips + 4 * p.deltaChipsPerLv
    const ml5 = p.baseMult + 4 * p.deltaMultPerLv
    const withJokers = evalSequence(optimalSorted, ch5, ml5).score
    return {
      ...p,
      lv1Score: scoreAt(1),
      lv5Score: scoreAt(5),
      lv10Score: scoreAt(10),
      lv15Score: scoreAt(15),
      lv5WithOptimalJokersScore: withJokers
    }
  })

  // 6 大经典 Boss 盲注针对性封锁审计（以 3 手出牌或特殊限制对比盲注目标分）
  const stdBlindTarget = Math.max(1200, Math.round(optimalEval.score * 2.1))
  const flintEval = evalSequence(
    optimalSorted,
    Math.round(baseHandChips * 0.5),
    Math.max(1, Math.round(baseHandMult * 0.5))
  )
  const plantEval = evalSequence(
    optimalSorted.map((s) => (s.role === 'chips' ? { ...s, chips: Math.round(s.chips * 0.3) } : s)),
    baseHandChips,
    baseHandMult
  )

  const bossSpecs: Array<{
    blindId: string
    nameZh: string
    nameEn: string
    ruleDescZh: string
    ruleDescEn: string
    targetScore: number
    achieved: number
  }> = [
    {
      blindId: 'the_wall',
      nameZh: '巨墙 (The Wall)', // cjk-ok
      nameEn: 'The Wall (4x Blind)',
      ruleDescZh: '超大盲注：目标分数膨胀为标准盲注的 2.0 倍 (3手总和)', // cjk-ok
      ruleDescEn: 'Extra large blind: 2.0x standard target score over 3 hands',
      targetScore: Math.round(stdBlindTarget * 1.45),
      achieved: optimalEval.score * 3
    },
    {
      blindId: 'the_flint',
      nameZh: '燧石 (The Flint)', // cjk-ok
      nameEn: 'The Flint (Halved Base)',
      ruleDescZh: '出牌前牌型基础筹码与基础倍率减半 (×0.5)', // cjk-ok
      ruleDescEn: 'Base Chips and Base Mult are halved before Joker triggers',
      targetScore: stdBlindTarget,
      achieved: flintEval.score * 3
    },
    {
      blindId: 'the_needle',
      nameZh: '细针 (The Needle)', // cjk-ok
      nameEn: 'The Needle (1 Hand Only)',
      ruleDescZh: '本回合只允许出 1 手牌，必须一击秒杀盲注', // cjk-ok
      ruleDescEn: 'Play only 1 hand this round (must one-shot target)',
      targetScore: Math.round(stdBlindTarget * 0.55),
      achieved: optimalEval.score
    },
    {
      blindId: 'the_plant',
      nameZh: '植物 (The Plant)', // cjk-ok
      nameEn: 'The Plant (Face Debuff)',
      ruleDescZh: '所有人头牌被削弱，筹码型加成衰减 70%', // cjk-ok
      ruleDescEn: 'All face cards debuffed; +Chips Joker contribution -70%',
      targetScore: stdBlindTarget,
      achieved: plantEval.score * 3
    },
    {
      blindId: 'amber_acorn',
      nameZh: '琥珀橡果 (Amber Acorn)', // cjk-ok
      nameEn: 'Amber Acorn (Shuffled Slots)',
      ruleDescZh: '翻转并打乱所有小丑牌槽位（按最差错位顺序结算）', // cjk-ok
      ruleDescEn: 'Flips and shuffles all Joker cards (worst slot order)',
      targetScore: stdBlindTarget,
      achieved: wrongEval.score * 3
    },
    {
      blindId: 'violet_vessel',
      nameZh: '紫罗兰圣杯 (Violet Vessel)', // cjk-ok
      nameEn: 'Violet Vessel (6x Showdown)',
      ruleDescZh: '8底注终局 Boss：目标分数暴涨至极高阈值', // cjk-ok
      ruleDescEn: 'Ante 8 Finisher Boss: Very large blind target score',
      targetScore: Math.round(stdBlindTarget * 1.85),
      achieved: optimalEval.score * 3
    }
  ]

  const bossBlinds: MxBalatroBossBlindRow[] = bossSpecs.map((b) => ({
    blindId: b.blindId,
    nameZh: b.nameZh,
    nameEn: b.nameEn,
    ruleDescZh: b.ruleDescZh,
    ruleDescEn: b.ruleDescEn,
    targetScore: b.targetScore,
    achievedScoreWithOptimal: b.achieved,
    verdict:
      b.achieved >= b.targetScore * 1.15
        ? 'pass'
        : b.achieved >= b.targetScore * 0.85
          ? 'risky'
          : 'countered'
  }))

  return {
    baseHandChips,
    baseHandMult,
    wrongOrderScore: wrongEval.score,
    currentOrderScore: currentEval.score,
    optimalOrderScore: optimalEval.score,
    orderGainRatio,
    optimalSlots: optimalEval.steps,
    planetHands,
    bossBlinds
  }
}

export interface MxBattlePassAndPackResult {
  seasonDays: number
  maxBpLevel: number
  dailyQuestXp: number
  weeklyQuestXp: number
  expectedDaysToMax: number
  totalFreePulls: number
  totalPaidPulls: number
  bpValueMultiple: number
  battlePassRows: GameBattlePassRow[]
  battlePassMilestones: GameBattlePassRow[]
  iapPacks: GameIapPackRow[]
}

/**
 * 商业化长线运营：赛季通行证（Battle Pass Lv.1~50）经验漏斗与商城礼包价格锚点（IAP Price Tier Matrix）生成器。
 */
export function generateMxBattlePassAndPackTable(cfg: MxLootRollConfig): MxBattlePassAndPackResult {
  const seasonDays = 42
  const maxBpLevel = 50
  const xpPerLevel = 1000
  const dailyQuestXp = 850
  const weeklyQuestXp = 4500
  const avgDailyXp = Math.round(dailyQuestXp + weeklyQuestXp / 7)
  const expectedDaysToMax = Math.round(((maxBpLevel * xpPerLevel) / avgDailyXp) * 10) / 10

  const battlePassRows: GameBattlePassRow[] = []
  let cumXp = 0
  let cumFreePulls = 0
  let cumPaidPulls = 0

  for (let lv = 1; lv <= maxBpLevel; lv++) {
    cumXp += xpPerLevel
    const daysToReach = Math.round((cumXp / avgDailyXp) * 10) / 10
    const isMilestone = lv % 10 === 0 || lv === 1 || lv === 25 || lv === 30
    const freePullGain = lv % 10 === 0 ? 1 : 0
    const paidPullGain = lv % 5 === 0 ? 1.5 : 0.2
    cumFreePulls = Math.round((cumFreePulls + freePullGain) * 10) / 10
    cumPaidPulls = Math.round((cumPaidPulls + freePullGain + paidPullGain) * 10) / 10

    battlePassRows.push({
      bpLevel: lv,
      xpRequired: xpPerLevel,
      cumulativeXp: cumXp,
      daysToReach,
      freeRewardDesc:
        lv % 10 === 0 ? 'Standard Pull ×1' : lv % 2 === 0 ? 'Gold ×5000' : 'EXP Book ×5',
      paidRewardDesc:
        lv === 30
          ? 'Selector SSR Weapon / Relic ×1'
          : lv === 50
            ? 'Limited Pull ×5 + Exclusive Skin'
            : isMilestone
              ? 'Limited Pull ×2 + Rare Mat ×4'
              : 'Gold ×15000 + Stamina ×60',
      cumulativeFreePullEquiv: cumFreePulls,
      cumulativePaidPullEquiv: cumPaidPulls
    })
  }

  const battlePassMilestones = battlePassRows.filter(
    (r) => r.bpLevel === 1 || r.bpLevel % 10 === 0 || r.bpLevel === 25
  )

  const basePullPriceUsd = Math.max(0.5, Number(((cfg.costPerPull || 160) / 80).toFixed(2)))
  const rawPacks: Array<{
    packId: string
    nameZh: string
    nameEn: string
    priceUsd: number
    pullsIncluded: number
    bonusResourcesEquivPulls: number
    purchaseLimit: string
  }> = [
    {
      packId: 'pack_starter_099',
      nameZh: '首充破冰迎新礼 ($0.99)', // cjk-ok
      nameEn: 'Starter Icebreaker Pack',
      priceUsd: 0.99,
      pullsIncluded: 2,
      bonusResourcesEquivPulls: 1.5,
      purchaseLimit: '1 / Account'
    },
    {
      packId: 'pack_monthly_499',
      nameZh: '月度黑金祝福卡 ($4.99)', // cjk-ok
      nameEn: '30-Day Blessing Pass',
      priceUsd: 4.99,
      pullsIncluded: 18,
      bonusResourcesEquivPulls: 2.0,
      purchaseLimit: '1 / Month'
    },
    {
      packId: 'pack_bp_999',
      nameZh: '高阶赛季通行证 ($9.99)', // cjk-ok
      nameEn: 'Premium Battle Pass',
      priceUsd: 9.99,
      pullsIncluded: 9,
      bonusResourcesEquivPulls: 14.0,
      purchaseLimit: '1 / Season'
    },
    {
      packId: 'pack_growth_1999',
      nameZh: '版本突破养成礼盒 ($19.99)', // cjk-ok
      nameEn: 'Ascension Growth Bundle',
      priceUsd: 19.99,
      pullsIncluded: 12,
      bonusResourcesEquivPulls: 11.0,
      purchaseLimit: '2 / Patch'
    },
    {
      packId: 'pack_event_4999',
      nameZh: '限定卡池十连大礼 ($49.99)', // cjk-ok
      nameEn: 'Limited Banner Mega Box',
      priceUsd: 49.99,
      pullsIncluded: 30,
      bonusResourcesEquivPulls: 16.0,
      purchaseLimit: '3 / Banner'
    },
    {
      packId: 'pack_whale_9999',
      nameZh: '顶氪直充锚点档 ($99.99)', // cjk-ok
      nameEn: 'Top-Up Anchor Vault (648)',
      priceUsd: 99.99,
      pullsIncluded: 55,
      bonusResourcesEquivPulls: 10.0,
      purchaseLimit: 'Unlimited'
    }
  ]

  const iapPacks: GameIapPackRow[] = rawPacks.map((p) => {
    const totalPullEquiv = Math.round((p.pullsIncluded + p.bonusResourcesEquivPulls) * 10) / 10
    const rawDollarVal = totalPullEquiv * basePullPriceUsd
    const valueRatioPct = Math.max(100, Math.round((rawDollarVal / p.priceUsd) * 100))
    return {
      ...p,
      totalPullEquiv,
      valueRatioPct
    }
  })

  return {
    seasonDays,
    maxBpLevel,
    dailyQuestXp,
    weeklyQuestXp,
    expectedDaysToMax,
    totalFreePulls: cumFreePulls,
    totalPaidPulls: cumPaidPulls,
    bpValueMultiple: iapPacks.find((p) => p.packId === 'pack_bp_999')?.valueRatioPct ?? 420,
    battlePassRows,
    battlePassMilestones,
    iapPacks
  }
}

export interface MxAutoBattlerShopOddsRow {
  tavernLevel: number
  tier1Pct: number
  tier2Pct: number
  tier3Pct: number
  tier4Pct: number
  tier5Pct: number
}

export interface MxAutoBattlerUnitStarRow {
  costTier: number
  tierNameZh: string
  tierNameEn: string
  sharedPoolTotal: number
  contestedTaken: number
  optimalShopLevel: number
  singleSlotHitProbPct: number
  expectedRolls2Star: number
  expectedGold2Star: number
  expectedRolls3Star: number
  expectedGold3Star: number
  star1Power: number
  star2Power: number
  star3Power: number
  verdict: 'easy_3star' | 'tempo_2star' | 'luxury_wincon'
}

export interface MxSnapLaneRow {
  laneId: string
  nameZh: string
  nameEn: string
  ruleZh: string
  playerProjectedPts: number
  enemyProjectedPts: number
  winProbPct: number
}

export interface MxSnapCubeEvRow {
  scenarioId: string
  nameZh: string
  nameEn: string
  winProbPct: number
  cubesWonOnWin: number
  cubesLostOnLoss: number
  retreatCostCubes: number
  playOutEvCubes: number
  optimalAction: 'SNAP' | 'HOLD' | 'RETREAT'
  evGainVsCall: number
}

export interface MxResponseCardChainRow {
  enemyHandCards: number
  holdDodgeProbPct: number
  strikeRawHitRatePct: number
  doubleStrikeHitRatePct: number
  holdPeachProbPct: number
  trickNullifiedProbPct: number
  tacticalAdviceZh: string
}

export interface MxExtendedCardGenreAuditResult {
  shopOddsByLevel: MxAutoBattlerShopOddsRow[]
  autoBattlerStarRows: MxAutoBattlerUnitStarRow[]
  snapLanes: MxSnapLaneRow[]
  snapWin2Of3RatePct: number
  snapCubeScenarios: MxSnapCubeEvRow[]
  responseChainRows: MxResponseCardChainRow[]
}

/**
 * 全品类卡牌扩展仿真矩阵：
 * 1. 自走棋 / 酒馆战棋（Lv.3~Lv.9 人口 D 牌概率 + 公共卡池抢卡稀释 + 1★→2★→3★ 追三期望金币）
 * 2. 多路战区比大小与加注翻倍博弈（《Marvel Snap / 昆特牌》3 路地形点数 + 1→2→4→8 Cube 撤退/跟注 EV）
 * 3. 身份局攻防响应链（《三国杀》1~6 张手牌下【杀】命中率、【闪】留存率、【桃】救回率与【无懈可击】反制率）
 */
export function simulateMxExtendedCardGenreMatrices(
  wb: MxNumericalWorkbench
): MxExtendedCardGenreAuditResult {
  const shopOddsByLevel: MxAutoBattlerShopOddsRow[] = [
    { tavernLevel: 3, tier1Pct: 75, tier2Pct: 25, tier3Pct: 0, tier4Pct: 0, tier5Pct: 0 },
    { tavernLevel: 4, tier1Pct: 55, tier2Pct: 30, tier3Pct: 15, tier4Pct: 0, tier5Pct: 0 },
    { tavernLevel: 5, tier1Pct: 45, tier2Pct: 33, tier3Pct: 20, tier4Pct: 2, tier5Pct: 0 },
    { tavernLevel: 6, tier1Pct: 30, tier2Pct: 40, tier3Pct: 25, tier4Pct: 5, tier5Pct: 0 },
    { tavernLevel: 7, tier1Pct: 19, tier2Pct: 30, tier3Pct: 35, tier4Pct: 15, tier5Pct: 1 },
    { tavernLevel: 8, tier1Pct: 18, tier2Pct: 25, tier3Pct: 32, tier4Pct: 22, tier5Pct: 3 },
    { tavernLevel: 9, tier1Pct: 10, tier2Pct: 15, tier3Pct: 25, tier4Pct: 35, tier5Pct: 15 }
  ]

  const rerollCost = Math.max(1, wb.lootRoll.rerollBaseCost || 2)
  const tierSpecs: Array<{
    costTier: number
    tierNameZh: string
    tierNameEn: string
    uniqueChampsInTier: number
    sharedPoolTotal: number
    contestedTaken: number
    optimalShopLevel: number
    tierOddsPctAtOptimal: number
    basePower: number
    star3Mult: number
  }> = [
    {
      costTier: 1,
      tierNameZh: '1费基石棋子 (Tier 1)', // cjk-ok
      tierNameEn: 'Tier 1 (1-Cost)',
      uniqueChampsInTier: 13,
      sharedPoolTotal: 29,
      contestedTaken: 6,
      optimalShopLevel: 5,
      tierOddsPctAtOptimal: 45,
      basePower: 100,
      star3Mult: 3.24
    },
    {
      costTier: 2,
      tierNameZh: '2费过渡主C (Tier 2)', // cjk-ok
      tierNameEn: 'Tier 2 (2-Cost)',
      uniqueChampsInTier: 13,
      sharedPoolTotal: 22,
      contestedTaken: 5,
      optimalShopLevel: 6,
      tierOddsPctAtOptimal: 40,
      basePower: 145,
      star3Mult: 3.35
    },
    {
      costTier: 3,
      tierNameZh: '3费阵容核心 (Tier 3)', // cjk-ok
      tierNameEn: 'Tier 3 (3-Cost)',
      uniqueChampsInTier: 13,
      sharedPoolTotal: 18,
      contestedTaken: 4,
      optimalShopLevel: 7,
      tierOddsPctAtOptimal: 35,
      basePower: 210,
      star3Mult: 3.6
    },
    {
      costTier: 4,
      tierNameZh: '4费紫卡主C (Tier 4)', // cjk-ok
      tierNameEn: 'Tier 4 (4-Cost)',
      uniqueChampsInTier: 12,
      sharedPoolTotal: 12,
      contestedTaken: 3,
      optimalShopLevel: 8,
      tierOddsPctAtOptimal: 22,
      basePower: 320,
      star3Mult: 4.5
    },
    {
      costTier: 5,
      tierNameZh: '5费传说橙卡 (Tier 5)', // cjk-ok
      tierNameEn: 'Tier 5 (5-Cost)',
      uniqueChampsInTier: 8,
      sharedPoolTotal: 10,
      contestedTaken: 2,
      optimalShopLevel: 9,
      tierOddsPctAtOptimal: 15,
      basePower: 480,
      star3Mult: 8.0
    }
  ]

  const autoBattlerStarRows: MxAutoBattlerUnitStarRow[] = tierSpecs.map((spec) => {
    const totalPoolAtTier = spec.uniqueChampsInTier * spec.sharedPoolTotal
    const remainingTarget = Math.max(1, spec.sharedPoolTotal - spec.contestedTaken)
    const remainingTotal = Math.max(remainingTarget, totalPoolAtTier - spec.contestedTaken * 4)
    const singleSlotProb = (spec.tierOddsPctAtOptimal / 100) * (remainingTarget / remainingTotal)
    const shopSlots = 5
    const expectedHitsPerRoll = Math.max(0.005, shopSlots * singleSlotProb)
    const expectedRolls2Star = Math.max(1, Math.round(3 / expectedHitsPerRoll))
    const expectedGold2Star = expectedRolls2Star * rerollCost + 3 * spec.costTier
    const avgHitsFor3Star = Math.max(0.003, expectedHitsPerRoll * 0.72)
    const expectedRolls3Star = Math.max(3, Math.round(9 / avgHitsFor3Star))
    const expectedGold3Star = expectedRolls3Star * rerollCost + 9 * spec.costTier

    return {
      costTier: spec.costTier,
      tierNameZh: spec.tierNameZh,
      tierNameEn: spec.tierNameEn,
      sharedPoolTotal: spec.sharedPoolTotal,
      contestedTaken: spec.contestedTaken,
      optimalShopLevel: spec.optimalShopLevel,
      singleSlotHitProbPct: Math.round(singleSlotProb * 10000) / 100,
      expectedRolls2Star,
      expectedGold2Star,
      expectedRolls3Star,
      expectedGold3Star,
      star1Power: spec.basePower,
      star2Power: Math.round(spec.basePower * 1.8),
      star3Power: Math.round(spec.basePower * spec.star3Mult),
      verdict:
        expectedGold3Star <= 48
          ? 'easy_3star'
          : expectedGold3Star <= 85
            ? 'tempo_2star'
            : 'luxury_wincon'
    }
  })

  // 2. 多路区域比大小 + 翻倍加注博弈 (Marvel Snap / 昆特牌)
  const basePower = Math.max(12, Math.round(wb.roguelikeEnvelope.playerBasePower || 24))
  const enemyPower = Math.max(10, Math.round(wb.roguelikeEnvelope.enemyBasePower || 21))
  const snapLanes: MxSnapLaneRow[] = [
    {
      laneId: 'lane_left',
      nameZh: '左路·超频双倍区 (Onslaught Citadel)', // cjk-ok
      nameEn: 'Left Lane (Double Ongoing)',
      ruleZh: '在此战区持续类卡牌战力翻倍 (×2)', // cjk-ok
      playerProjectedPts: Math.round(basePower * 1.45),
      enemyProjectedPts: Math.round(enemyPower * 1.25),
      winProbPct: 68
    },
    {
      laneId: 'lane_center',
      nameZh: '中路·标准争夺区 (Stark Tower)', // cjk-ok
      nameEn: 'Center Lane (+2 Power T5)',
      ruleZh: '第 5 回合结束时，双方在此战区所有单位 +2 战力', // cjk-ok
      playerProjectedPts: Math.round(basePower * 1.05),
      enemyProjectedPts: Math.round(enemyPower * 1.08),
      winProbPct: 54
    },
    {
      laneId: 'lane_right',
      nameZh: '右路·封锁禁入区 (Sanctum Sanctorum)', // cjk-ok
      nameEn: 'Right Lane (Locked After T4)',
      ruleZh: '第 4 回合后禁止直接打出卡牌，仅可通过移动/召唤进入', // cjk-ok
      playerProjectedPts: Math.round(basePower * 0.72),
      enemyProjectedPts: Math.round(enemyPower * 0.78),
      winProbPct: 49
    }
  ]

  const p1 = snapLanes[0]!.winProbPct / 100
  const p2 = snapLanes[1]!.winProbPct / 100
  const p3 = snapLanes[2]!.winProbPct / 100
  const win2Of3Prob = p1 * p2 * p3 + p1 * p2 * (1 - p3) + p1 * (1 - p2) * p3 + (1 - p1) * p2 * p3
  const snapWin2Of3RatePct = Math.round(win2Of3Prob * 1000) / 10

  const rawCubeSpecs: Array<{
    scenarioId: string
    nameZh: string
    nameEn: string
    winProbPct: number
    cubesWonOnWin: number
    cubesLostOnLoss: number
    retreatCostCubes: number
  }> = [
    {
      scenarioId: 'no_snap_steady',
      nameZh: '全程不加注完赛 (1→2 Cubes)', // cjk-ok
      nameEn: 'No-Snap Full Match (2 Cubes)',
      winProbPct: snapWin2Of3RatePct,
      cubesWonOnWin: 2,
      cubesLostOnLoss: 2,
      retreatCostCubes: 1
    },
    {
      scenarioId: 't3_key_drawn_snap',
      nameZh: 'T3 核心Combo上手主动 Snap (2→4 Cubes)', // cjk-ok
      nameEn: 'T3 Combo Drawn Snap (4 Cubes)',
      winProbPct: Math.min(85, Math.round(snapWin2Of3RatePct + 14)),
      cubesWonOnWin: 4,
      cubesLostOnLoss: 4,
      retreatCostCubes: 1
    },
    {
      scenarioId: 't5_bad_draw_retreat',
      nameZh: 'T5 关键牌沉底遭敌方加注 (4 Cubes 局)', // cjk-ok
      nameEn: 'T5 Brick Hand vs Enemy Snap',
      winProbPct: 24,
      cubesWonOnWin: 4,
      cubesLostOnLoss: 4,
      retreatCostCubes: 1
    },
    {
      scenarioId: 't6_counter_8cubes',
      nameZh: 'T6 手握克制牌双倍反加注 (4→8 Cubes)', // cjk-ok
      nameEn: 'T6 Tech Counter Double-Snap (8 Cubes)',
      winProbPct: 66,
      cubesWonOnWin: 8,
      cubesLostOnLoss: 8,
      retreatCostCubes: 2
    },
    {
      scenarioId: 't6_coinflip_8cubes',
      nameZh: 'T6 50/50 赌命盲接 8 分局 (8 Cubes)', // cjk-ok
      nameEn: 'T6 50/50 Coinflip Call (8 Cubes)',
      winProbPct: 36,
      cubesWonOnWin: 8,
      cubesLostOnLoss: 8,
      retreatCostCubes: 2
    }
  ]

  const snapCubeScenarios: MxSnapCubeEvRow[] = rawCubeSpecs.map((sc) => {
    const wp = sc.winProbPct / 100
    const playOutEv =
      Math.round((wp * sc.cubesWonOnWin - (1 - wp) * sc.cubesLostOnLoss) * 100) / 100
    const retreatEv = -sc.retreatCostCubes
    const optimalAction: MxSnapCubeEvRow['optimalAction'] =
      playOutEv < retreatEv ? 'RETREAT' : sc.winProbPct >= 62 ? 'SNAP' : 'HOLD'
    const bestEv = Math.max(playOutEv, retreatEv)
    return {
      ...sc,
      playOutEvCubes: playOutEv,
      optimalAction,
      evGainVsCall: Math.round((bestEv - playOutEv) * 100) / 100
    }
  })

  // 3. 身份局攻防响应链（《三国杀》1~6 张手牌下【杀/闪/桃/无懈可击】概率）
  const dodgeDeckRatio = 0.15
  const peachDeckRatio = 0.08
  const nullifyDeckRatio = 0.045
  const responseChainRows: MxResponseCardChainRow[] = [1, 2, 3, 4, 5, 6].map((handCount) => {
    const holdDodgeProb = 1 - Math.pow(1 - dodgeDeckRatio, handCount)
    const strikeHitProb = 1 - holdDodgeProb
    const holdTwoDodgesProb =
      1 -
      Math.pow(1 - dodgeDeckRatio, handCount) -
      handCount * dodgeDeckRatio * Math.pow(1 - dodgeDeckRatio, Math.max(0, handCount - 1))
    const doubleStrikeHitProb = 1 - Math.max(0, holdTwoDodgesProb)
    const holdPeachProb = 1 - Math.pow(1 - peachDeckRatio, handCount)
    const trickNullifiedProb = 1 - Math.pow(1 - nullifyDeckRatio, handCount + 2)

    const tacticalAdviceZh =
      handCount <= 2
        ? '强命斩杀窗口：单杀命中率 >70%，直接酒杀/决斗收割' // cjk-ok
        : handCount <= 4
          ? '骗闪消耗期：先用顺手/拆桥/南蛮压手牌，再出杀破防' // cjk-ok
          : '高防憋牌期：敌方大概率握闪与桃，优先乐不思蜀控场' // cjk-ok

    return {
      enemyHandCards: handCount,
      holdDodgeProbPct: Math.round(holdDodgeProb * 1000) / 10,
      strikeRawHitRatePct: Math.round(strikeHitProb * 1000) / 10,
      doubleStrikeHitRatePct: Math.round(doubleStrikeHitProb * 1000) / 10,
      holdPeachProbPct: Math.round(holdPeachProb * 1000) / 10,
      trickNullifiedProbPct: Math.round(trickNullifiedProb * 1000) / 10,
      tacticalAdviceZh
    }
  })

  return {
    shopOddsByLevel,
    autoBattlerStarRows,
    snapLanes,
    snapWin2Of3RatePct,
    snapCubeScenarios,
    responseChainRows
  }
}

/**
 * 商业产品级：一键生成完整的 Markdown 商业数值立项与 QA 签收审计报告（Commercial Numerical QA Sign-Off Report）。
 */
export function exportMxCommercialQaReportMarkdown(wb: MxNumericalWorkbench): string {
  const multRes = analyzeMultiplierPipeline(wb.multiplier)
  const lootRes = runMxLootAndSubstatSimulation(wb.lootRoll)
  const dilutionRows = runMxPoolDilutionAnalysis(wb.lootRoll)
  const cohortRes = runMxCommercialCohortAnalysis(wb.lootRoll)
  const combatRes = runMxCombatKernelSimulation(wb.combatKernel)
  const counterRows = runMxEncounterCounterMatrix(wb.combatKernel)
  const archetypeRes = runMxArchetypeBalanceMatrix(wb.combatKernel)
  const removalRows = runMxDeckRemovalRoiAnalysis(wb.combatKernel)
  const envelopeRes = runMxRoguelikeEnvelopeSimulation(wb.roguelikeEnvelope)

  const opCount = multRes.entityAudits.filter((e) => e.verdict === 'overpowered').length
  const upCount = multRes.entityAudits.filter((e) => e.verdict === 'underpowered').length
  const hardCounters = counterRows.filter((c) => c.verdict === 'countered').length
  const wallCount = envelopeRes.difficultyWallFloors.length
  const bestMarginalAttr =
    multRes.marginalReturns.find((m) => m.isOptimalNextPick)?.attrName ?? 'N/A'

  const overallGrade =
    archetypeRes.metaDiversityScore >= 72 && opCount <= 1 && hardCounters <= 1 && wallCount <= 2
      ? 'S (Commercial Release Ready)'
      : archetypeRes.metaDiversityScore >= 55 && hardCounters <= 2
        ? 'A (Minor Tuning Recommended)'
        : 'B (Balance Bottlenecks Detected)'

  const lines: string[] = [
    `# Commercial Numerical & Roguelike QA Audit Report`,
    ``,
    `- **Preset / System**: \`${wb.activePresetId}\` — ${wb.multiplier.title}`,
    `- **Commercial Release Grade**: **${overallGrade}**`,
    `- **Deterministic Seed (CRN)**: \`${wb.combatKernel.seed}\``,
    ``,
    `## 1. Layer 1 — Damage Multiplier Pipeline & Card Budget Audit`,
    `- **Final Output**: \`${multRes.finalOutput}\` (Formula: \`${wb.multiplier.finalFormula}\`)`,
    `- **Best Marginal Stat**: \`${bestMarginalAttr}\``,
    `- **Entity Budget Deviations**: ${opCount} Overpowered / ${upCount} Underpowered / ${multRes.entityAudits.length} Total`,
    ``,
    `| Entity | Cost | Expected Budget | Actual Value | Deviation % | Verdict |`,
    `| :--- | :---: | :---: | :---: | :---: | :--- |`,
    ...multRes.entityAudits.map(
      (e) =>
        `| ${e.name} | ${e.cost} | ${e.expectedValue} | ${e.actualValue} | ${e.deviationPct > 0 ? '+' : ''}${e.deviationPct}% | **${e.verdict.toUpperCase()}** |`
    ),
    ``,
    `## 2. Layer 2 — Probability, Pool Dilution & Commercial Cohort Telemetry`,
    `- **Mode**: \`${lootRes.mode}\` | **P10**: \`${lootRes.attemptsP10}\` | **P50 (Median)**: \`${lootRes.attemptsP50}\` | **P90 (Unlucky)**: \`${lootRes.attemptsP90}\` | **Mean**: \`${lootRes.attemptsMean}\``,
    `- **Pity Conversion Elasticity**: \`${cohortRes.pityElasticityScore}/100\` | **Whale/F2P 30d Ratio**: \`${cohortRes.whaleToF2pProgressRatio}x\` | **Blended Monthly ARPU**: \`$${cohortRes.estimatedBlendedArpuUsd}\``,
    ``,
    `### 2.1 Player Spending Cohort Graduation Telemetry`,
    `| Cohort | Monthly Spend | Daily Attempts | P50 Days | P90 Days | Day-30 Graduation % | Churn Risk |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: | :--- |`,
    ...cohortRes.cohorts.map(
      (c) =>
        `| ${c.nameEn} | $${c.monthlySpendUsd} | ${c.dailyAttempts}/d | ${c.daysToGraduateP50}d | ${c.daysToGraduateP90}d | ${c.day30GraduationRatePct}% | **${c.frustrationChokeRisk.toUpperCase()}** |`
    ),
    ``,
    `### 2.2 DLC Expansion Pool Dilution & Ban-Slot Counteracting`,
    `| Archetypes | Effective Pool | No-Ban Graduation % | With Ban % | Expected Gold | Verdict |`,
    `| :---: | :---: | :---: | :---: | :---: | :--- |`,
    ...dilutionRows.map(
      (d) =>
        `| ${d.archetypesCount} | ${d.effectivePoolSize} | ${d.noBanCompletionPct}% | ${d.withBanCompletionPct}% | ${d.expectedGoldCost}G | **${d.verdict.toUpperCase()}** |`
    ),
    ``,
    `## 3. Layer 3 — Micro-Combat Kernel, Boss Counter Matrix & Meta Diversity`,
    `- **Kernel**: \`${combatRes.kernel}\` | **Win Rate**: \`${combatRes.winRatePct}%\` | **TTK P10/P50/P90**: \`${combatRes.ttkP10} / ${combatRes.ttkP50} / ${combatRes.ttkP90}T\``,
    `- **Meta Diversity Score (Shannon Entropy)**: \`${archetypeRes.metaDiversityScore}/100\` (\`${archetypeRes.verdict}\`)`,
    ``,
    `### 3.1 Multi-Archetype Meta-Balance Matrix`,
    `| Build Archetype | Win Rate % | Median TTK | Avg HP Loss | Est. Meta Share % | Tier |`,
    `| :--- | :---: | :---: | :---: | :---: | :--- |`,
    ...archetypeRes.rows.map(
      (r) =>
        `| ${r.nameEn} | ${r.winRatePct}% | ${r.ttkP50}T | ${r.avgHpLoss} | ${r.metaSharePct}% | **${r.tier}** |`
    ),
    ``,
    `### 3.2 6-Boss Encounter Build-Checker Matrix`,
    `| Boss Mechanism | Win Rate % | Median TTK | Avg HP Loss | Verdict |`,
    `| :--- | :---: | :---: | :---: | :--- |`,
    ...counterRows.map(
      (c) =>
        `| ${c.nameEn} | ${c.winRatePct}% | ${c.ttkP50}T | ${c.avgHpLoss} | **${c.verdict.toUpperCase()}** |`
    ),
    ``,
    `### 3.3 Shop Card Removal Pricing & Curse Bloat ROI`,
    `| Deck Delta | Deck Size | T1 Core Draw % | Win Rate % | HP Saved vs Base | Fair Shop Price |`,
    `| :--- | :---: | :---: | :---: | :---: | :---: |`,
    ...removalRows.map(
      (r) =>
        `| ${r.labelEn} | ${r.deckSize} | ${r.turn1CoreDrawPct}% | ${r.winRatePct}% | ${r.hpSavedVsBase > 0 ? '+' : ''}${r.hpSavedVsBase} | **${r.fairShopGoldPrice}G** |`
    ),
    ``,
    `## 4. Layer 4 — Roguelike Macro Power Envelope & Scaling Walls`,
    `- **First-Run Clear Rate**: \`${envelopeRes.firstRunClearRatePct}%\` | **Meta Runs to 50% Clear**: \`${envelopeRes.metaRunsTo50PctClear} runs\``,
    `- **Elite Challenge Rate**: \`${envelopeRes.eliteChallengeRatePct}%\` | **Campfire Smith Ratio**: \`${envelopeRes.campfireUpgradeRatioPct}%\` | **Snowball Polarization (P90/P10)**: \`${envelopeRes.snowballPolarizationIndex}x\``,
    `- **Difficulty Wall Floors**: \`${envelopeRes.difficultyWallFloors.join(', ') || 'None'}\` | **Runaway Trivial Floors**: \`${envelopeRes.runawayFloors.join(', ') || 'None'}\``,
    ``,
    `## 5. Layer 5 — Character Level Progression & Ascension Breakthrough Curve`,
    ...(() => {
      const lvRes = generateMxLevelProgressionTable(wb.roguelikeEnvelope)
      return [
        `- **Max Level**: \`Lv.${lvRes.maxLevel}\` | **Ascension Interval**: Every \`${lvRes.ascensionInterval}\` Lvs | **Stat Growth Multiplier**: \`${lvRes.statMultiplierTotal}x\``,
        `- **Total XP to Max**: \`${lvRes.totalXpToMax}\` | **Total Gold to Max**: \`${lvRes.totalGoldToMax}G\` | **Est. Stamina Days**: \`${lvRes.totalDaysToMax}d\``,
        ``,
        `| Level | Ascension | HP | ATK | DEF | Cumulative XP | Gold Cost | Est. Days |`,
        `| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`,
        ...lvRes.milestones.map(
          (r) =>
            `| Lv.${r.level}${r.isBreakthrough ? ' ★' : ''} | A${r.ascensionStage} | ${r.hp} | ${r.atk} | ${r.def} | ${r.cumulativeXp} | ${r.goldCost}G | ${r.staminaDaysToReach}d |`
        )
      ]
    })(),
    ``,
    `## 6. Layer 6 — Equipment +1 ~ +${wb.lootRoll.equipMaxEnhanceLevel ?? 15} Upgrade Cost & Blacksmith Matrix`,
    ...(() => {
      const eqRes = generateMxEquipmentUpgradeMatrix(wb.lootRoll)
      return [
        `- **Final Main Stat**: \`+${eqRes.finalMainStat}\` | **Total Base Gold**: \`${eqRes.totalBaseGold}G\` | **Expected Gold (with Fails)**: \`${eqRes.totalExpectedGoldWithFails}G\` | **Expected Stamina**: \`${eqRes.totalExpectedStamina}\``,
        ``,
        `| Enhance | Main Stat | Substat Rolls | EXP Cost | Base Gold | Success % | Expected Gold | Cum. Gold |`,
        `| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`,
        ...eqRes.rows
          .filter(
            (r) =>
              r.enhanceLevel === 1 ||
              r.enhanceLevel % 3 === 0 ||
              r.enhanceLevel === eqRes.maxEnhanceLevel
          )
          .map(
            (r) =>
              `| +${r.enhanceLevel} | ${r.mainStatValue} | ${r.substatRollsUnlocked} | ${r.expCost} | ${r.goldCost}G | ${r.successRatePct}% | ${r.expectedGoldWithFails}G | ${r.cumulativeExpectedGold}G |`
          )
      ]
    })()
  ]

  return lines.join('\n')
}

export interface MxSensitivityTornadoBar {
  paramId: string
  labelZh: string
  labelEn: string
  baseValueLabel: string
  lowValueLabel: string
  highValueLabel: string
  baseWinRatePct: number
  lowParamWinRatePct: number
  highParamWinRatePct: number
  /** |highParamWinRatePct - lowParamWinRatePct| 绝对振幅 (%)，按降序排列形成龙卷风图 */
  swingPct: number
}

/**
 * 商业产品级：共同随机数（CRN）参数敏感度龙卷风图分析（Parameter Sensitivity Tornado Chart）：
 * 对当前微观战斗内核的 5 个核心杠杆参数分别施加 -20% 与 +20% 扰动，
 * 定量计算每个参数对最终胜率/斩杀率的敏感度振幅并按影响力从高到低排序。
 */
export function runMxSensitivityTornado(cfg: MxCombatKernelConfig): MxSensitivityTornadoBar[] {
  const sampleRuns = Math.min(180, Math.max(60, Math.round((cfg.runs || 160) * 0.65)))
  const baseSim = runMxCombatKernelSimulation({ ...cfg, runs: sampleRuns })
  const baseWin = baseSim.winRatePct

  interface LeverSpec {
    paramId: string
    labelZh: string
    labelEn: string
    baseValueLabel: string
    lowValueLabel: string
    highValueLabel: string
    lowCfg: MxCombatKernelConfig
    highCfg: MxCombatKernelConfig
  }

  let levers: LeverSpec[] = []

  if (cfg.kernel === 'deck_cycle') {
    const eBase = Math.max(1, cfg.energyPerTurn || 3)
    const eLow = Math.max(1, eBase - 1)
    const eHigh = eBase + 1

    const dBase = Math.max(1, cfg.drawPerTurn || 5)
    const dLow = Math.max(1, dBase - 1)
    const dHigh = dBase + 1

    const hpBase = Math.max(20, cfg.enemyHp || 180)
    const hpLow = Math.max(10, Math.round(hpBase * 0.8))
    const hpHigh = Math.round(hpBase * 1.2)

    const atkBase = Math.max(2, cfg.enemyBaseDamage || 12)
    const atkLow = Math.max(1, Math.round(atkBase * 0.8))
    const atkHigh = Math.round(atkBase * 1.2)

    levers = [
      {
        paramId: 'energy_per_turn',
        labelZh: '每回合能量上限 (Energy/Turn)', // cjk-ok
        labelEn: 'Energy Per Turn (±1)',
        baseValueLabel: `${eBase}`,
        lowValueLabel: `${eLow}`,
        highValueLabel: `${eHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, energyPerTurn: eLow },
        highCfg: { ...cfg, runs: sampleRuns, energyPerTurn: eHigh }
      },
      {
        paramId: 'draw_per_turn',
        labelZh: '每回合抽牌数 (Draw/Turn)', // cjk-ok
        labelEn: 'Draw Per Turn (±1)',
        baseValueLabel: `${dBase}`,
        lowValueLabel: `${dLow}`,
        highValueLabel: `${dHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, drawPerTurn: dLow },
        highCfg: { ...cfg, runs: sampleRuns, drawPerTurn: dHigh }
      },
      {
        paramId: 'card_output_power',
        labelZh: '卡牌伤害与格挡倍率 (Card Output ±20%)', // cjk-ok
        labelEn: 'Card Dmg & Block (±20%)',
        baseValueLabel: '100%',
        lowValueLabel: '80%',
        highValueLabel: '120%',
        lowCfg: {
          ...cfg,
          runs: sampleRuns,
          deckCards: cfg.deckCards.map((c) => ({
            ...c,
            damage: Math.max(0, Math.round(c.damage * 0.8)),
            block: Math.max(0, Math.round(c.block * 0.8))
          }))
        },
        highCfg: {
          ...cfg,
          runs: sampleRuns,
          deckCards: cfg.deckCards.map((c) => ({
            ...c,
            damage: Math.round(c.damage * 1.2),
            block: Math.round(c.block * 1.2)
          }))
        }
      },
      {
        paramId: 'enemy_hp',
        labelZh: 'Boss 生命值 (Enemy HP ±20%)', // cjk-ok
        labelEn: 'Boss HP (±20%)',
        baseValueLabel: `${hpBase}`,
        lowValueLabel: `${hpLow}`,
        highValueLabel: `${hpHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, enemyHp: hpLow },
        highCfg: { ...cfg, runs: sampleRuns, enemyHp: hpHigh }
      },
      {
        paramId: 'enemy_atk',
        labelZh: '敌方基础攻击力 (Enemy Atk ±20%)', // cjk-ok
        labelEn: 'Enemy Base Atk (±20%)',
        baseValueLabel: `${atkBase}`,
        lowValueLabel: `${atkLow}`,
        highValueLabel: `${atkHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, enemyBaseDamage: atkLow },
        highCfg: { ...cfg, runs: sampleRuns, enemyBaseDamage: atkHigh }
      }
    ]
  } else if (cfg.kernel === 'mana_tempo') {
    const hBase = Math.max(1, cfg.startingHandSize || 3)
    const hLow = Math.max(1, hBase - 1)
    const hHigh = Math.min(6, hBase + 1)

    const mBase = Math.max(1, cfg.mulliganMaxCost || 3)
    const mLow = Math.max(1, mBase - 1)
    const mHigh = mBase + 1

    const oppHpBase = Math.max(10, cfg.opponentHp || 30)
    const oppHpLow = Math.max(5, Math.round(oppHpBase * 0.8))
    const oppHpHigh = Math.round(oppHpBase * 1.2)

    const clrBase = Math.max(1, cfg.opponentClearPowerPerTurn || 2)
    const clrLow = Math.max(0, Math.round(clrBase * 0.8 * 10) / 10)
    const clrHigh = Math.round(clrBase * 1.2 * 10) / 10

    levers = [
      {
        paramId: 'starting_hand',
        labelZh: '起手手牌上限 (Starting Hand ±1)', // cjk-ok
        labelEn: 'Starting Hand Size (±1)',
        baseValueLabel: `${hBase}`,
        lowValueLabel: `${hLow}`,
        highValueLabel: `${hHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, startingHandSize: hLow },
        highCfg: { ...cfg, runs: sampleRuns, startingHandSize: hHigh }
      },
      {
        paramId: 'minion_stats',
        labelZh: '随从攻血身材与直伤 (Card Stats ±20%)', // cjk-ok
        labelEn: 'Minion Stats & Spell Dmg (±20%)',
        baseValueLabel: '100%',
        lowValueLabel: '80%',
        highValueLabel: '120%',
        lowCfg: {
          ...cfg,
          runs: sampleRuns,
          manaCurveDeck: cfg.manaCurveDeck.map((c) => ({
            ...c,
            attack: Math.max(0, Math.round(c.attack * 0.8)),
            health: Math.max(1, Math.round(c.health * 0.8)),
            directDamage: Math.max(0, Math.round(c.directDamage * 0.8)),
            effectScript: c.effectScript?.trim()
              ? mxScaleEffectScript(c.effectScript, 0.8)
              : c.effectScript
          }))
        },
        highCfg: {
          ...cfg,
          runs: sampleRuns,
          manaCurveDeck: cfg.manaCurveDeck.map((c) => ({
            ...c,
            attack: Math.round(c.attack * 1.2),
            health: Math.max(1, Math.round(c.health * 1.2)),
            directDamage: Math.round(c.directDamage * 1.2),
            effectScript: c.effectScript?.trim()
              ? mxScaleEffectScript(c.effectScript, 1.2)
              : c.effectScript
          }))
        }
      },
      {
        paramId: 'opponent_hp',
        labelZh: '敌方英雄生命值 (Opponent HP ±20%)', // cjk-ok
        labelEn: 'Opponent Hero HP (±20%)',
        baseValueLabel: `${oppHpBase}`,
        lowValueLabel: `${oppHpLow}`,
        highValueLabel: `${oppHpHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, opponentHp: oppHpLow },
        highCfg: { ...cfg, runs: sampleRuns, opponentHp: oppHpHigh }
      },
      {
        paramId: 'opponent_clear',
        labelZh: '敌方每回合解场强度 (Board Clear ±20%)', // cjk-ok
        labelEn: 'Opponent Board Clear (±20%)',
        baseValueLabel: `${clrBase}`,
        lowValueLabel: `${clrLow}`,
        highValueLabel: `${clrHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, opponentClearPowerPerTurn: clrLow },
        highCfg: { ...cfg, runs: sampleRuns, opponentClearPowerPerTurn: clrHigh }
      },
      {
        paramId: 'mulligan_cap',
        labelZh: '调度留牌最高费用 (Mulligan Cap ±1)', // cjk-ok
        labelEn: 'Mulligan Max Cost (±1)',
        baseValueLabel: `${mBase}`,
        lowValueLabel: `${mLow}`,
        highValueLabel: `${mHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, mulliganMaxCost: mLow },
        highCfg: { ...cfg, runs: sampleRuns, mulliganMaxCost: mHigh }
      }
    ]
  } else {
    const oBase = Math.max(1, cfg.initialOrbs || 4)
    const oLow = Math.max(0, oBase - 1)
    const oHigh = Math.min(8, oBase + 1)

    const hpBase = Math.max(1000, cfg.targetEnemyHp || 65000)
    const hpLow = Math.round(hpBase * 0.8)
    const hpHigh = Math.round(hpBase * 1.2)

    const defBase = Math.max(50, cfg.targetEnemyDef || 450)
    const defLow = Math.round(defBase * 0.8)
    const defHigh = Math.round(defBase * 1.2)

    levers = [
      {
        paramId: 'initial_orbs',
        labelZh: '初始鬼火/战技点 (Initial Orbs ±1)', // cjk-ok
        labelEn: 'Initial Orbs (±1)',
        baseValueLabel: `${oBase}`,
        lowValueLabel: `${oLow}`,
        highValueLabel: `${oHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, initialOrbs: oLow },
        highCfg: { ...cfg, runs: sampleRuns, initialOrbs: oHigh }
      },
      {
        paramId: 'unit_skill_mult',
        labelZh: '全队技能倍率 (Skill Multiplier ±20%)', // cjk-ok
        labelEn: 'Unit Skill Multiplier (±20%)',
        baseValueLabel: '100%',
        lowValueLabel: '80%',
        highValueLabel: '120%',
        lowCfg: {
          ...cfg,
          runs: sampleRuns,
          actionUnits: cfg.actionUnits.map((u) =>
            u.team === 'ally'
              ? {
                  ...u,
                  skillRatio: Math.round(u.skillRatio * 0.8 * 100) / 100,
                  skillScript: u.skillScript?.trim()
                    ? mxScaleAtbScript(u.skillScript, 0.8)
                    : u.skillScript
                }
              : u
          )
        },
        highCfg: {
          ...cfg,
          runs: sampleRuns,
          actionUnits: cfg.actionUnits.map((u) =>
            u.team === 'ally'
              ? {
                  ...u,
                  skillRatio: Math.round(u.skillRatio * 1.2 * 100) / 100,
                  skillScript: u.skillScript?.trim()
                    ? mxScaleAtbScript(u.skillScript, 1.2)
                    : u.skillScript
                }
              : u
          )
        }
      },
      {
        paramId: 'ally_speed',
        labelZh: '我方式神速度 (Ally Speed ±15%)', // cjk-ok
        labelEn: 'Ally Unit Speed (±15%)',
        baseValueLabel: '100%',
        lowValueLabel: '85%',
        highValueLabel: '115%',
        lowCfg: {
          ...cfg,
          runs: sampleRuns,
          actionUnits: cfg.actionUnits.map((u) =>
            u.team === 'ally' ? { ...u, speed: Math.round(u.speed * 0.85) } : u
          )
        },
        highCfg: {
          ...cfg,
          runs: sampleRuns,
          actionUnits: cfg.actionUnits.map((u) =>
            u.team === 'ally' ? { ...u, speed: Math.round(u.speed * 1.15) } : u
          )
        }
      },
      {
        paramId: 'target_enemy_hp',
        labelZh: '敌方总生命值 (Target HP ±20%)', // cjk-ok
        labelEn: 'Target Enemy HP (±20%)',
        baseValueLabel: `${hpBase}`,
        lowValueLabel: `${hpLow}`,
        highValueLabel: `${hpHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, targetEnemyHp: hpLow },
        highCfg: { ...cfg, runs: sampleRuns, targetEnemyHp: hpHigh }
      },
      {
        paramId: 'target_enemy_def',
        labelZh: '敌方防御力 (Target DEF ±20%)', // cjk-ok
        labelEn: 'Target Enemy DEF (±20%)',
        baseValueLabel: `${defBase}`,
        lowValueLabel: `${defLow}`,
        highValueLabel: `${defHigh}`,
        lowCfg: { ...cfg, runs: sampleRuns, targetEnemyDef: defLow },
        highCfg: { ...cfg, runs: sampleRuns, targetEnemyDef: defHigh }
      }
    ]
  }

  const bars: MxSensitivityTornadoBar[] = levers.map((lv) => {
    const lowSim = runMxCombatKernelSimulation(lv.lowCfg)
    const highSim = runMxCombatKernelSimulation(lv.highCfg)
    const swingPct = Math.round(Math.abs(highSim.winRatePct - lowSim.winRatePct) * 10) / 10
    return {
      paramId: lv.paramId,
      labelZh: lv.labelZh,
      labelEn: lv.labelEn,
      baseValueLabel: lv.baseValueLabel,
      lowValueLabel: lv.lowValueLabel,
      highValueLabel: lv.highValueLabel,
      baseWinRatePct: baseWin,
      lowParamWinRatePct: lowSim.winRatePct,
      highParamWinRatePct: highSim.winRatePct,
      swingPct
    }
  })

  return bars.sort((a, b) => b.swingPct - a.swingPct)
}

function toCsOrGdExpr(formula: string, lang: 'unity_cs' | 'godot_gd'): string {
  const mathPrefix = lang === 'unity_cs' ? 'Mathf.' : ''
  const minFn = lang === 'unity_cs' ? 'Mathf.Min' : 'minf'
  const maxFn = lang === 'unity_cs' ? 'Mathf.Max' : 'maxf'
  const powFn = lang === 'unity_cs' ? 'Mathf.Pow' : 'pow'
  return formula
    .replace(/\bmin\s*\(/gi, `${minFn}(`)
    .replace(/\bmax\s*\(/gi, `${maxFn}(`)
    .replace(/\bpow\s*\(/gi, `${powFn}(`)
    .replace(/\bfloor\s*\(/gi, `${mathPrefix}Floor(`)
    .replace(/\bceil\s*\(/gi, `${mathPrefix}Ceil(`)
    .replace(/\bround\s*\(/gi, `${mathPrefix}Round(`)
    .replace(/\babs\s*\(/gi, `${mathPrefix}Abs(`)
}

/**
 * 商业产品级：一键生成 Unity C# (`.cs`) 与 Godot 4 GDScript (`.gd`) 数值内核运行时代码：
 * 将当前工作台调平后的乘区伤害管线、卡牌理论费用预算、肉鸽层级膨胀 + 进阶倍率、以及抽卡软硬保底算法
 * 直接编译为零依赖的引擎工程源码文件。
 */
export function exportMxWorkbenchRuntimeCode(
  wb: MxNumericalWorkbench,
  target: 'unity_cs' | 'godot_gd'
): { filename: string; code: string } {
  const m = wb.multiplier
  const l = wb.lootRoll
  const e = wb.roguelikeEnvelope

  if (target === 'unity_cs') {
    const attrParams = m.attributes.map((a) => `float ${a.name} = ${a.value}f`).join(', ')
    const stageLines = m.stages.map(
      (st) => `            float ${st.name} = (float)(${toCsOrGdExpr(st.formula, 'unity_cs')});`
    )
    const finalExpr = toCsOrGdExpr(m.finalFormula, 'unity_cs')
    const budgetExpr = toCsOrGdExpr(m.expectedBudgetFormula, 'unity_cs')

    const code = [
      `// Auto-generated by AI Art Engine — Commercial Numerical Workbench`,
      `// Preset: ${wb.activePresetId} (${m.title})`,
      `using System;`,
      `using UnityEngine;`,
      ``,
      `namespace GameNumericalRuntime`,
      `{`,
      `    public static class NumericalWorkbenchRuntime`,
      `    {`,
      `        /// <summary>`,
      `        /// Layer 1: Multi-Stage Damage / Scoring Pipeline`,
      `        /// </summary>`,
      `        public static float EvaluateDamagePipeline(${attrParams})`,
      `        {`,
      ...stageLines,
      `            return (float)(${finalExpr});`,
      `        }`,
      ``,
      `        /// <summary>`,
      `        /// Layer 1.2: Card / Skill Expected Cost Budget Curve`,
      `        /// </summary>`,
      `        public static float EvaluateExpectedBudget(float cost)`,
      `        {`,
      `            float mana = cost;`,
      `            return Mathf.Max(0.5f, (float)(${budgetExpr}));`,
      `        }`,
      ``,
      `        /// <summary>`,
      `        /// Layer 2: Soft & Hard Pity Gacha Probability Calculator`,
      `        /// </summary>`,
      `        public static float GetPullHitProbability(int currentPityCount)`,
      `        {`,
      `            const float baseRate = ${(l.baseSsrRatePct / 100).toFixed(4)}f;`,
      `            const int softPityStart = ${l.softPityStart};`,
      `            const float softStep = ${(l.softPitySlopePct / 100).toFixed(4)}f;`,
      `            const int hardPity = ${l.hardPityPull};`,
      `            if (currentPityCount + 1 >= hardPity) return 1.0f;`,
      `            int overSoft = Mathf.Max(0, (currentPityCount + 1) - softPityStart + 1);`,
      `            return Mathf.Clamp01(baseRate + overSoft * softStep);`,
      `        }`,
      ``,
      `        /// <summary>`,
      `        /// Layer 4: Roguelike Floor Enemy Scaling with Ascension Ladder (A0..A20)`,
      `        /// </summary>`,
      `        public static float GetFloorEnemyPower(int floor, int ascensionTier = 0, bool isBoss = false)`,
      `        {`,
      `            float basePower = ${e.enemyBasePower}f * (1f + Mathf.Clamp(ascensionTier, 0, 20) * 0.014f);`,
      `            float growthRate = ${e.enemyGrowthRate}f + (ascensionTier >= 15 ? 0.018f : 0f) + (ascensionTier >= 20 ? 0.017f : 0f);`,
      `            float bossMult = isBoss ? ${e.bossDifficultyMult}f * (ascensionTier >= 20 ? 1.28f : 1f) : 1f;`,
      `            return basePower * Mathf.Pow(growthRate, Mathf.Max(0, floor - 1)) * bossMult;`,
      `        }`,
      `    }`,
      `}`
    ].join('\n')

    return {
      filename: `NumericalWorkbenchRuntime_${wb.activePresetId}.cs`,
      code
    }
  }

  const attrParamsGd = m.attributes.map((a) => `${a.name}: float = ${a.value}`).join(', ')
  const stageLinesGd = m.stages.map(
    (st) => `\tvar ${st.name}: float = float(${toCsOrGdExpr(st.formula, 'godot_gd')})`
  )
  const finalExprGd = toCsOrGdExpr(m.finalFormula, 'godot_gd')
  const budgetExprGd = toCsOrGdExpr(m.expectedBudgetFormula, 'godot_gd')

  const codeGd = [
    `# Auto-generated by AI Art Engine — Commercial Numerical Workbench`,
    `# Preset: ${wb.activePresetId} (${m.title})`,
    `class_name NumericalWorkbenchRuntime`,
    `extends RefCounted`,
    ``,
    `## Layer 1: Multi-Stage Damage / Scoring Pipeline`,
    `static func evaluate_damage_pipeline(${attrParamsGd}) -> float:`,
    ...stageLinesGd,
    `\treturn float(${finalExprGd})`,
    ``,
    `## Layer 1.2: Card / Skill Expected Cost Budget Curve`,
    `static func evaluate_expected_budget(cost: float) -> float:`,
    `\tvar mana: float = cost`,
    `\treturn maxf(0.5, float(${budgetExprGd}))`,
    ``,
    `## Layer 2: Soft & Hard Pity Gacha Probability Calculator`,
    `static func get_pull_hit_probability(current_pity_count: int) -> float:`,
    `\tconst BASE_RATE: float = ${(l.baseSsrRatePct / 100).toFixed(4)}`,
    `\tconst SOFT_PITY_START: int = ${l.softPityStart}`,
    `\tconst SOFT_STEP: float = ${(l.softPitySlopePct / 100).toFixed(4)}`,
    `\tconst HARD_PITY: int = ${l.hardPityPull}`,
    `\tif current_pity_count + 1 >= HARD_PITY:`,
    `\t\treturn 1.0`,
    `\tvar over_soft: int = maxi(0, (current_pity_count + 1) - SOFT_PITY_START + 1)`,
    `\treturn clampf(BASE_RATE + float(over_soft) * SOFT_STEP, 0.0, 1.0)`,
    ``,
    `## Layer 4: Roguelike Floor Enemy Scaling with Ascension Ladder (A0..A20)`,
    `static func get_floor_enemy_power(floor_idx: int, ascension_tier: int = 0, is_boss: bool = false) -> float:`,
    `\tvar base_power: float = ${e.enemyBasePower} * (1.0 + float(clampi(ascension_tier, 0, 20)) * 0.014)`,
    `\tvar growth_rate: float = ${e.enemyGrowthRate} + (0.018 if ascension_tier >= 15 else 0.0) + (0.017 if ascension_tier >= 20 else 0.0)`,
    `\tvar boss_mult: float = (${e.bossDifficultyMult} * (1.28 if ascension_tier >= 20 else 1.0)) if is_boss else 1.0`,
    `\treturn base_power * pow(growth_rate, float(maxi(0, floor_idx - 1))) * boss_mult`
  ].join('\n')

  return {
    filename: `numerical_workbench_runtime_${wb.activePresetId}.gd`,
    code: codeGd
  }
}

/**
 * 将数值工作台当前调平后的卡牌表、式神/角色属性、肉鸽词条遗物池与关卡波次曲线
 * 一键编译为符合 `game.data_table` 规范的全套结构化数据表（cards.csv / waves.csv / items.csv / characters.csv / localization.csv）。
 */
export function exportWorkbenchToGameDataTables(wb: MxNumericalWorkbench): GameDataTableBundle {
  const envelopeRes = runMxRoguelikeEnvelopeSimulation(wb.roguelikeEnvelope)
  const levelProgression = generateMxLevelProgressionTable(wb.roguelikeEnvelope)
  const equipmentMatrix = generateMxEquipmentUpgradeMatrix(wb.lootRoll)
  const bpAndPacks = generateMxBattlePassAndPackTable(wb.lootRoll)
  const deckRemovalRoi = runMxDeckRemovalRoiAnalysis(wb.combatKernel)
  const baseRemovalPrice = deckRemovalRoi.find((r) => r.deltaCards === -1)?.fairShopGoldPrice ?? 75

  const cards: GameCardRow[] = wb.multiplier.entities.length
    ? wb.multiplier.entities.map((ent) => {
        const dmg = ent.stats.dmg ?? ent.stats.damage ?? ent.stats.atk ?? ent.stats.chips ?? 0
        const blk = ent.stats.block ?? ent.stats.hp ?? ent.stats.shield ?? 0
        const cardType: GameCardRow['cardType'] = dmg > 0 ? 'attack' : blk > 0 ? 'skill' : 'power'
        const statSummary = Object.entries(ent.stats)
          .filter(([, v]) => Number(v) !== 0)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ')
        return {
          id: ent.id,
          name: ent.name,
          nameEn: ent.name,
          cost: ent.cost,
          cardType,
          rarity: ent.rarity,
          damage: dmg,
          block: blk,
          description: statSummary || `${ent.name} (Cost ${ent.cost})`,
          descriptionEn: statSummary || `${ent.name} (Cost ${ent.cost})`
        }
      })
    : wb.combatKernel.deckCards.map((c) => ({
        id: c.id,
        name: c.name,
        nameEn: c.name,
        cost: c.cost,
        cardType: c.damage > 0 ? 'attack' : c.block > 0 ? 'skill' : 'power',
        rarity: c.priority >= 4 ? 'rare' : c.priority >= 2 ? 'uncommon' : 'common',
        damage: c.damage,
        block: c.block,
        description: `DMG ${c.damage} / BLK ${c.block} / Draw ${c.draw}`,
        descriptionEn: `DMG ${c.damage} / BLK ${c.block} / Draw ${c.draw}`
      }))

  const items: GameItemRow[] = wb.lootRoll.draftPool.map((it) => {
    const rarityMap: Record<MxDraftPoolItem['rarity'], GameItemRow['rarity']> = {
      common: 'common',
      uncommon: 'rare',
      rare: 'epic',
      legendary: 'legendary'
    }
    const price = Math.round(
      baseRemovalPrice * (it.rarity === 'legendary' ? 2.4 : it.rarity === 'rare' ? 1.7 : 1.1)
    )
    return {
      id: it.id,
      name: it.name,
      nameEn: it.name,
      category: it.tags[0] || 'relic',
      rarity: rarityMap[it.rarity] ?? 'common',
      price,
      stackLimit: it.unique ? 1 : 9,
      effect: `+${it.addPower} Power, ×${it.multPower} Mult [${it.tags.join('/')}]`,
      effectEn: `+${it.addPower} Power, ×${it.multPower} Mult [${it.tags.join('/')}]`
    }
  })

  const waves: GameWaveRow[] = envelopeRes.floorSeries.map((pt) => ({
    waveIndex: pt.floor,
    durationSec: pt.isBoss ? 90 : 45,
    spawnIntervalSec: pt.isBoss ? 5 : 2.5,
    enemyId: pt.isBoss ? `boss_floor_${pt.floor}` : `mob_floor_${pt.floor}`,
    count: pt.isBoss ? 1 : Math.min(25, 3 + Math.floor(pt.floor * 0.8)),
    eliteOrBossId: pt.isBoss
      ? `boss_power_${Math.round(pt.enemyPower)}`
      : pt.roomType === 'elite_mix'
        ? `elite_power_${Math.round(pt.enemyPower * 1.18)}`
        : ''
  }))

  const characters: GameCharacterRow[] = wb.combatKernel.actionUnits.length
    ? wb.combatKernel.actionUnits.map((u) => ({
        id: u.id,
        name: u.name,
        nameEn: u.name,
        role: u.team,
        hp: u.team === 'enemy' ? wb.combatKernel.targetEnemyHp : wb.combatKernel.playerHp * 100,
        mp: u.orbCost,
        atk: u.attack,
        def: u.team === 'enemy' ? wb.combatKernel.targetEnemyDef : 300,
        spd: u.speed,
        critRate: 0.8,
        description: `Ratio ${u.skillRatio}x / Pull ${u.pullGaugePct}%`,
        descriptionEn: `Ratio ${u.skillRatio}x / Pull ${u.pullGaugePct}%`
      }))
    : [
        {
          id: 'char_protagonist',
          name: 'Roguelike Hero',
          nameEn: 'Roguelike Hero',
          role: 'protagonist',
          hp: wb.combatKernel.playerHp,
          mp: wb.combatKernel.energyPerTurn,
          atk: wb.roguelikeEnvelope.playerBasePower,
          def: 10,
          spd: 100,
          critRate: 0.15,
          description: `Base Power ${wb.roguelikeEnvelope.playerBasePower}`,
          descriptionEn: `Base Power ${wb.roguelikeEnvelope.playerBasePower}`
        }
      ]

  const skills: GameSkillRow[] = wb.combatKernel.actionUnits.length
    ? wb.combatKernel.actionUnits.map((u) => ({
        id: `skill_${u.id}`,
        name: `${u.name} Skill`,
        nameEn: `${u.name} Skill`,
        element: u.team === 'enemy' ? 'dark' : 'holy',
        manaCost: u.orbCost,
        cooldownSec: u.orbCost > 0 ? 2 : 0,
        damageMultiplier: u.skillRatio,
        description: `Ratio ${u.skillRatio}x, Pull ${u.pullGaugePct}%`,
        descriptionEn: `Ratio ${u.skillRatio}x, Pull ${u.pullGaugePct}%`
      }))
    : wb.combatKernel.deckCards.map((c) => ({
        id: `skill_${c.id}`,
        name: c.name,
        nameEn: c.name,
        element: c.damage > 0 ? 'fire' : 'ice',
        manaCost: c.cost,
        cooldownSec: c.cost,
        damageMultiplier: Math.max(0.5, Number(((c.damage + c.block) / 6).toFixed(2))),
        description: `DMG ${c.damage} / BLK ${c.block} / Draw ${c.draw}`,
        descriptionEn: `DMG ${c.damage} / BLK ${c.block} / Draw ${c.draw}`
      }))

  return buildGameDataTableBundle({
    tableName: wb.multiplier.title || wb.activePresetId,
    genre: 'roguelike',
    characters,
    skills,
    items,
    cards,
    waves,
    levelCurve: levelProgression.rows,
    equipmentUpgrades: equipmentMatrix.rows,
    battlePass: bpAndPacks.battlePassRows,
    iapPacks: bpAndPacks.iapPacks,
    dialogues: []
  })
}

// ───────────────────────────── 5. 统一工作台文档结构与五大旗舰预设 ─────────────────────────────

export interface MxNumericalWorkbench {
  activePresetId: MxWorkbenchPresetId
  multiplier: MxMultiplierPipelineConfig
  lootRoll: MxLootRollConfig
  combatKernel: MxCombatKernelConfig
  roguelikeEnvelope: MxRoguelikeEnvelopeConfig
  /** 卡牌数值设计实验室：敌人/意图/遭遇/遗物/卡池表 + 单局经济闭环参数（可选） */
  designLab?: MxCardDesignLabConfig
}

export const MX_WORKBENCH_PRESETS: Array<{
  id: MxWorkbenchPresetId
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
}> = [
  {
    id: 'slay_the_spire_dbg',
    nameZh: '《杀戮尖塔》DBG 洗抽牌库与力量易伤体系', // cjk-ok
    nameEn: 'Slay the Spire (DBG Deck-Cycle & Vulnerable)',
    descZh: '不放回抽弃牌循环 + 3点能量预算 + 力量/易伤/虚弱乘区 + 爬塔精英难度包络线', // cjk-ok
    descEn:
      'Without-replacement deck cycle, 3-energy budget, Strength/Vulnerable multipliers & Act scaling'
  },
  {
    id: 'hearthstone_tcg',
    nameZh: '《炉石传说》TCG 法力曲线、场面交换与开包保底', // cjk-ok
    nameEn: 'Hearthstone (TCG Mana Curve, Tempo & Pack Pity)',
    descZh: '1~10费按费拍怪率/卡手率 + 随从身材预算超模审计 + 40包橙卡硬保底与粉尘期望', // cjk-ok
    descEn: '1-10 Mana curve-out rate, minion stat budget audit & 40-pack Legendary pity timer'
  },
  {
    id: 'onmyoji_atb',
    nameZh: '《阴阳师》速度拉条、鬼火循环与御魂满速强化', // cjk-ok
    nameEn: 'Onmyoji (Action-Bar Pull, Shared Orbs & Soul +18 SPD)',
    descZh: '双拉超车速度线检测 + 全队8鬼火/5格回火断火率 + 300/(300+DEF)减伤 + 御魂副属性强化', // cjk-ok
    descEn:
      'Action-bar pull/cut-in check, 8-orb shared pool, 300/(300+DEF) mitigation & Soul +18 SPD roll'
  },
  {
    id: 'balatro_roguelike',
    nameZh: '《小丑牌 Balatro》筹码×加算×独立乘区与盲注膨胀', // cjk-ok
    nameEn: 'Balatro (Chips × +Mult × ×Mult & Ante Scaling)',
    descZh: 'Chips × (+Mult) × (×Mult^N) 指数爆炸拐点 + 商店 Reroll 凑流派 + 8底注盲注剪刀差', // cjk-ok
    descEn: 'Chips × (+Mult) × (×Mult^N) exponential synergy, shop reroll & Ante 1-8 scaling wall'
  },
  {
    id: 'survivor_brotato',
    nameZh: '《Brotato / 幸存者》多乘区 EDPS 与 20 波商店刷新', // cjk-ok
    nameEn: 'Brotato / Survivor (EDPS Multipliers & 20-Wave Shop)',
    descZh: '攻速×固定伤×百分比×暴击期望秒伤 + 标签亲和度商店刷新成型率 + 20波怪潮包络线', // cjk-ok
    descEn: 'AtkSpd × Flat × Pct × Crit EDPS, tag-affinity shop rerolls & 20-wave survival envelope'
  },
  {
    id: 'short_drama_progression',
    nameZh: '🎬《逆袭爽剧 / 系统流》80集角色成长、反派阶梯与打脸底牌', // cjk-ok
    nameEn: 'Short Drama / System Progression (80-Ep Character & Villain Arc)',
    descZh:
      '主角身价/境界乘区防崩坏 + 80集四阶反派膨胀墙(小混混→豪门→京都→财阀) + 名场面打脸底牌交锋 + 付费卡点转化', // cjk-ok
    descEn:
      'Protagonist realm/wealth multiplier, 80-episode 4-tier villain scaling wall, climax trump cards & paywall funnel'
  }
]

export function createMxWorkbenchPreset(
  presetId: MxWorkbenchPresetId = 'slay_the_spire_dbg'
): MxNumericalWorkbench {
  switch (presetId) {
    case 'hearthstone_tcg':
      return {
        activePresetId: 'hearthstone_tcg',
        multiplier: {
          presetId: 'hearthstone_tcg',
          title: 'Hearthstone Minion Stat Budget & Keyword Valuation',
          attributes: [
            {
              id: 'a_mana',
              name: 'Mana',
              label: 'Mana Cost',
              value: 4,
              min: 0,
              max: 10,
              stepPerBudget: 1
            },
            {
              id: 'a_atk',
              name: 'ATK',
              label: 'Attack',
              value: 4,
              min: 0,
              max: 20,
              stepPerBudget: 1
            },
            {
              id: 'a_hp',
              name: 'HP',
              label: 'Health',
              value: 5,
              min: 1,
              max: 20,
              stepPerBudget: 1
            },
            {
              id: 'a_draw',
              name: 'Draw',
              label: 'Card Draw',
              value: 0,
              min: 0,
              max: 5,
              stepPerBudget: 1
            },
            {
              id: 'a_dmg',
              name: 'BattlecryDmg',
              label: 'Battlecry DMG',
              value: 0,
              min: 0,
              max: 12,
              stepPerBudget: 1
            }
          ],
          stages: [
            { id: 's1', name: 'VanillaBudget', formula: '2 * Mana + 1' },
            { id: 's2', name: 'BodyStats', formula: 'ATK + HP' },
            { id: 's3', name: 'EffectBudget', formula: 'Draw * 3.0 + BattlecryDmg * 1.5' }
          ],
          finalFormula: 'BodyStats + EffectBudget',
          expectedBudgetFormula: '2 * cost + 1',
          entityValueFormula: 'atk + hp + draw * 3 + dmg * 1.5 + taunt * 1.0 + shield * 1.5',
          statColumns: ['atk', 'hp', 'draw', 'dmg', 'taunt', 'shield'],
          entities: [
            {
              id: 'hs_yeti',
              name: 'Chillwind Yeti',
              cost: 4,
              rarity: 'common',
              tags: ['neutral'],
              stats: { atk: 4, hp: 5, draw: 0, dmg: 0, taunt: 0, shield: 0 }
            },
            {
              id: 'hs_fire_elem',
              name: 'Fire Elemental',
              cost: 6,
              rarity: 'common',
              tags: ['elemental'],
              stats: { atk: 6, hp: 5, draw: 0, dmg: 3, taunt: 0, shield: 0 }
            },
            {
              id: 'hs_azure',
              name: 'Azure Drake',
              cost: 5,
              rarity: 'rare',
              tags: ['dragon'],
              stats: { atk: 4, hp: 4, draw: 1, dmg: 1, taunt: 0, shield: 0 }
            },
            {
              id: 'hs_zilliax',
              name: 'Zilliax (Overbudget)',
              cost: 5,
              rarity: 'legendary',
              tags: ['mech'],
              stats: { atk: 3, hp: 2, draw: 0, dmg: 3, taunt: 1, shield: 1 }
            },
            {
              id: 'hs_magma',
              name: 'Magma Rager (Under)',
              cost: 3,
              rarity: 'common',
              tags: ['elemental'],
              stats: { atk: 5, hp: 1, draw: 0, dmg: 0, taunt: 0, shield: 0 }
            }
          ]
        },
        lootRoll: {
          mode: 'gacha_pity',
          runs: 500,
          seed: 2026,
          baseSsrRatePct: 5.0,
          softPityStart: 30,
          softPitySlopePct: 4.5,
          hardPityPull: 40,
          upGuarantee5050: false,
          targetCopies: 2,
          costPerPull: 100,
          dupeDustYield: 105,
          staminaPerDrop: 24,
          targetSlotDropRatePct: 16.7,
          targetMainStatRatePct: 100,
          fourLineInitRatePct: 20,
          upgradeLevels: 5,
          targetSubstatName: 'SPD',
          targetSubstatThreshold: 16,
          substatPool: [],
          draftWaves: 15,
          choicesPerDraft: 3,
          rerollsPerWave: 1,
          rerollBaseCost: 2,
          rerollCostStep: 1,
          targetSynergyTag: 'mech',
          targetSynergyCount: 4,
          tagAffinityBonusPct: 25,
          draftPool: []
        },
        combatKernel: {
          kernel: 'mana_tempo',
          runs: 300,
          maxTurns: 10,
          seed: 2026,
          playerHp: 30,
          energyPerTurn: 3,
          drawPerTurn: 5,
          enemyHp: 30,
          enemyBaseDamage: 8,
          enemyDamageGrowth: 2,
          deckCards: [],
          maxManaCrystals: 10,
          startingHandSize: 3,
          mulliganMaxCost: 3,
          opponentHp: 30,
          opponentClearPowerPerTurn: 2,
          manaCurveDeck: [
            {
              id: 'c1',
              name: '1-Drop Flame Imp',
              manaCost: 1,
              count: 6,
              kind: 'minion',
              attack: 3,
              health: 2,
              directDamage: 0,
              drawCards: 0
            },
            {
              id: 'c2',
              name: '2-Drop Knife Juggler',
              manaCost: 2,
              count: 6,
              kind: 'minion',
              attack: 3,
              health: 2,
              directDamage: 1,
              drawCards: 0
            },
            {
              id: 'c3',
              name: '3-Drop Shielded Minibot',
              manaCost: 3,
              count: 6,
              kind: 'minion',
              attack: 3,
              health: 3,
              directDamage: 0,
              drawCards: 0,
              divineShield: true
            },
            {
              id: 'c4',
              name: '4-Drop Yeti / Shredder',
              manaCost: 4,
              count: 5,
              kind: 'minion',
              attack: 4,
              health: 5,
              directDamage: 0,
              drawCards: 0
            },
            {
              id: 'c5',
              name: '5-Drop Loatheb / Drake',
              manaCost: 5,
              count: 4,
              kind: 'minion',
              attack: 5,
              health: 5,
              directDamage: 0,
              drawCards: 1
            },
            {
              id: 'c6',
              name: 'Fireball Burst',
              manaCost: 4,
              count: 3,
              kind: 'spell',
              attack: 0,
              health: 0,
              directDamage: 6,
              drawCards: 0
            }
          ],
          trackDistance: 1000,
          initialOrbs: 4,
          maxOrbs: 8,
          orbRecoveryPer5Actions: 3,
          targetEnemyHp: 50000,
          targetEnemyDef: 400,
          actionUnits: []
        },
        roguelikeEnvelope: {
          floors: 12,
          runs: 300,
          seed: 2026,
          playerBasePower: 25,
          baseAddPerFloor: 12,
          synergyHitRatePct: 35,
          synergyMultPerHit: 1.28,
          enemyBasePower: 22,
          enemyGrowthRate: 1.25,
          bossEveryNWave: 4,
          bossDifficultyMult: 1.35,
          metaBonusPerRunPct: 5
        }
      }

    case 'onmyoji_atb':
      return {
        activePresetId: 'onmyoji_atb',
        multiplier: {
          presetId: 'onmyoji_atb',
          title: 'Onmyoji Dual-Crit × 300/(300+DEF) Mitigation Pipeline',
          attributes: [
            {
              id: 'o_atk',
              name: 'ATK',
              label: 'Total ATK',
              value: 8500,
              min: 1000,
              max: 25000,
              stepPerBudget: 240
            },
            {
              id: 'o_ratio',
              name: 'SkillRatio',
              label: 'Skill Ratio',
              value: 3.15,
              min: 0.5,
              max: 8.0,
              stepPerBudget: 0.15
            },
            {
              id: 'o_cdmg',
              name: 'CritDmg',
              label: 'Crit Damage (x)',
              value: 2.8,
              min: 1.5,
              max: 4.5,
              stepPerBudget: 0.11
            },
            {
              id: 'o_def',
              name: 'DEF',
              label: 'Target DEF',
              value: 450,
              min: 0,
              max: 2000,
              stepPerBudget: 0
            },
            {
              id: 'o_ign',
              name: 'DefIgnore',
              label: 'DEF Ignore (0-1)',
              value: 0.2,
              min: 0,
              max: 0.9,
              stepPerBudget: 0.04
            },
            {
              id: 'o_vuln',
              name: 'Vuln',
              label: 'Watcher/Vuln Bonus',
              value: 0.4,
              min: 0,
              max: 2.0,
              stepPerBudget: 0.08
            }
          ],
          stages: [
            { id: 's1', name: 'RawAttackZone', formula: 'ATK * SkillRatio' },
            { id: 's2', name: 'CritZone', formula: 'RawAttackZone * CritDmg' },
            { id: 's3', name: 'DefMitigation', formula: '300 / (300 + DEF * (1 - DefIgnore))' },
            { id: 's4', name: 'BonusMultZone', formula: '1 + Vuln' }
          ],
          finalFormula: 'CritZone * DefMitigation * BonusMultZone',
          expectedBudgetFormula: '100 + cost * 85',
          entityValueFormula: 'ratio * 100 + hits * 25 + pull * 3.5 + orbGen * 45',
          statColumns: ['ratio', 'hits', 'pull', 'orbGen'],
          entities: [
            {
              id: 'sp_asura',
              name: 'Asura (AOE Burst)',
              cost: 3,
              rarity: 'legendary',
              tags: ['dps'],
              stats: { ratio: 3.15, hits: 3, pull: 0, orbGen: 0 }
            },
            {
              id: 'sp_orochi',
              name: 'SP Orochi',
              cost: 3,
              rarity: 'legendary',
              tags: ['dps'],
              stats: { ratio: 3.4, hits: 1, pull: 10, orbGen: 0 }
            },
            {
              id: 'sr_kamai',
              name: 'Kamaitachi (Puller)',
              cost: 3,
              rarity: 'rare',
              tags: ['puller'],
              stats: { ratio: 0, hits: 0, pull: 30, orbGen: 0 }
            },
            {
              id: 'r_yamausagi',
              name: 'Yamausagi (2-Orb Pull)',
              cost: 2,
              rarity: 'common',
              tags: ['puller'],
              stats: { ratio: 0, hits: 0, pull: 30, orbGen: 0 }
            },
            {
              id: 'r_zashiki',
              name: 'Zashiki (Orb Gen)',
              cost: 0,
              rarity: 'common',
              tags: ['orbs'],
              stats: { ratio: 1.0, hits: 1, pull: 0, orbGen: 3 }
            }
          ]
        },
        lootRoll: {
          mode: 'substat_enhance',
          runs: 500,
          seed: 2026,
          baseSsrRatePct: 1.25,
          softPityStart: 50,
          softPitySlopePct: 2.5,
          hardPityPull: 100,
          upGuarantee5050: true,
          targetCopies: 1,
          costPerPull: 100,
          dupeDustYield: 20,
          staminaPerDrop: 12,
          targetSlotDropRatePct: 16.7,
          targetMainStatRatePct: 100,
          fourLineInitRatePct: 20,
          upgradeLevels: 5,
          targetSubstatName: 'SPD',
          targetSubstatThreshold: 16,
          substatPool: [
            { id: 'spd', name: 'SPD', weight: 8, rollTiers: [2.4, 2.7, 3.0] },
            { id: 'crit', name: 'CRIT', weight: 10, rollTiers: [2.4, 2.7, 3.0] },
            { id: 'cdmg', name: 'CDMG', weight: 10, rollTiers: [3.2, 3.6, 4.0] },
            { id: 'atk', name: 'ATK%', weight: 16, rollTiers: [2.4, 2.7, 3.0] },
            { id: 'hit', name: 'EFF_HIT', weight: 14, rollTiers: [3.2, 3.6, 4.0] },
            { id: 'res', name: 'EFF_RES', weight: 14, rollTiers: [3.2, 3.6, 4.0] },
            { id: 'hp', name: 'HP%', weight: 18, rollTiers: [2.4, 2.7, 3.0] }
          ],
          draftWaves: 15,
          choicesPerDraft: 3,
          rerollsPerWave: 1,
          rerollBaseCost: 10,
          rerollCostStep: 5,
          targetSynergyTag: 'crit',
          targetSynergyCount: 4,
          tagAffinityBonusPct: 30,
          draftPool: []
        },
        combatKernel: {
          kernel: 'action_bar',
          runs: 200,
          maxTurns: 12,
          seed: 2026,
          playerHp: 15000,
          energyPerTurn: 3,
          drawPerTurn: 5,
          enemyHp: 65000,
          enemyBaseDamage: 3000,
          enemyDamageGrowth: 500,
          deckCards: [],
          maxManaCrystals: 10,
          startingHandSize: 3,
          mulliganMaxCost: 3,
          opponentHp: 30,
          opponentClearPowerPerTurn: 2,
          manaCurveDeck: [],
          trackDistance: 1000,
          initialOrbs: 4,
          maxOrbs: 8,
          orbRecoveryPer5Actions: 4,
          targetEnemyHp: 68000,
          targetEnemyDef: 450,
          actionUnits: [
            {
              id: 'u_kamai',
              name: 'Kamaitachi (1st Pull)',
              team: 'ally',
              speed: 265,
              attack: 1400,
              critDamageMult: 1.5,
              skillRatio: 0,
              orbCost: 3,
              pullGaugePct: 30,
              pushGaugePct: 0,
              orbGain: 0
            },
            {
              id: 'u_rabbit',
              name: 'Yamausagi (2nd Pull)',
              team: 'ally',
              speed: 192,
              attack: 1200,
              critDamageMult: 1.5,
              skillRatio: 0,
              orbCost: 2,
              pullGaugePct: 30,
              pushGaugePct: 0,
              orbGain: 0
            },
            {
              id: 'u_zashiki',
              name: 'Zashiki (Orbs +3)',
              team: 'ally',
              speed: 165,
              attack: 1300,
              critDamageMult: 1.5,
              skillRatio: 1.0,
              orbCost: 0,
              pullGaugePct: 0,
              pushGaugePct: 0,
              orbGain: 3
            },
            {
              id: 'u_asura',
              name: 'Asura (Main Nuker)',
              team: 'ally',
              speed: 158,
              attack: 9200,
              critDamageMult: 2.9,
              skillRatio: 3.15,
              orbCost: 3,
              pullGaugePct: 0,
              pushGaugePct: 0,
              orbGain: 0
            },
            {
              id: 'u_kaguya',
              name: 'SP Kaguya (Finisher)',
              team: 'ally',
              speed: 145,
              attack: 7800,
              critDamageMult: 2.75,
              skillRatio: 2.85,
              orbCost: 3,
              pullGaugePct: 0,
              pushGaugePct: 0,
              orbGain: 2
            },
            {
              id: 'u_boss',
              name: 'Orochi Boss (Enemy)',
              team: 'enemy',
              speed: 215,
              attack: 5500,
              critDamageMult: 1.8,
              skillRatio: 2.0,
              orbCost: 0,
              pullGaugePct: 0,
              pushGaugePct: 0,
              orbGain: 0
            }
          ]
        },
        roguelikeEnvelope: {
          floors: 15,
          runs: 300,
          seed: 2026,
          playerBasePower: 18000,
          baseAddPerFloor: 4500,
          synergyHitRatePct: 38,
          synergyMultPerHit: 1.26,
          enemyBasePower: 15000,
          enemyGrowthRate: 1.22,
          bossEveryNWave: 5,
          bossDifficultyMult: 1.4,
          metaBonusPerRunPct: 6
        }
      }

    case 'balatro_roguelike':
      return {
        activePresetId: 'balatro_roguelike',
        multiplier: {
          presetId: 'balatro_roguelike',
          title: 'Balatro Chips × (+Mult) × (×Mult^N) Exponential Scoring',
          attributes: [
            {
              id: 'b_chips',
              name: 'BaseChips',
              label: 'Base Hand Chips',
              value: 100,
              min: 10,
              max: 1000,
              stepPerBudget: 35
            },
            {
              id: 'b_bchips',
              name: 'BonusChips',
              label: 'Joker +Chips',
              value: 120,
              min: 0,
              max: 2000,
              stepPerBudget: 50
            },
            {
              id: 'b_bmult',
              name: 'BaseMult',
              label: 'Planet Base Mult',
              value: 10,
              min: 1,
              max: 100,
              stepPerBudget: 3
            },
            {
              id: 'b_amult',
              name: 'AddMult',
              label: 'Joker +Mult',
              value: 36,
              min: 0,
              max: 500,
              stepPerBudget: 12
            },
            {
              id: 'b_xmult',
              name: 'IndepMult',
              label: 'Single ×Mult Value',
              value: 2.0,
              min: 1.1,
              max: 5.0,
              stepPerBudget: 0.25
            },
            {
              id: 'b_xcnt',
              name: 'XMultCount',
              label: 'Active ×Mult Jokers',
              value: 2,
              min: 0,
              max: 6,
              stepPerBudget: 0.5
            }
          ],
          stages: [
            { id: 's1', name: 'TotalChips', formula: 'BaseChips + BonusChips' },
            { id: 's2', name: 'AdditiveMult', formula: 'BaseMult + AddMult' },
            { id: 's3', name: 'IndependentMult', formula: 'pow(IndepMult, XMultCount)' }
          ],
          finalFormula: 'TotalChips * AdditiveMult * IndependentMult',
          expectedBudgetFormula: 'cost * 12',
          entityValueFormula: 'chips * 0.4 + addMult * 3.5 + (xMult - 1) * 45',
          statColumns: ['chips', 'addMult', 'xMult'],
          entities: [
            {
              id: 'j_blue',
              name: 'Banner (+120 Chips)',
              cost: 5,
              rarity: 'common',
              tags: ['chips'],
              stats: { chips: 120, addMult: 0, xMult: 1.0 }
            },
            {
              id: 'j_half',
              name: 'Half Joker (+20 Mult)',
              cost: 5,
              rarity: 'common',
              tags: ['mult'],
              stats: { chips: 0, addMult: 20, xMult: 1.0 }
            },
            {
              id: 'j_cavendish',
              name: 'Cavendish (×3 Mult)',
              cost: 4,
              rarity: 'common',
              tags: ['xmult'],
              stats: { chips: 0, addMult: 0, xMult: 3.0 }
            },
            {
              id: 'j_blueprint',
              name: 'Blueprint (Copy ×2.5)',
              cost: 10,
              rarity: 'rare',
              tags: ['xmult'],
              stats: { chips: 0, addMult: 10, xMult: 2.5 }
            },
            {
              id: 'j_popcorn',
              name: 'Popcorn (Decaying)',
              cost: 5,
              rarity: 'common',
              tags: ['mult'],
              stats: { chips: 0, addMult: 12, xMult: 1.0 }
            }
          ]
        },
        lootRoll: {
          mode: 'roguelike_draft',
          runs: 400,
          seed: 2026,
          baseSsrRatePct: 5,
          softPityStart: 30,
          softPitySlopePct: 5,
          hardPityPull: 50,
          upGuarantee5050: false,
          targetCopies: 1,
          costPerPull: 5,
          dupeDustYield: 2,
          staminaPerDrop: 10,
          targetSlotDropRatePct: 20,
          targetMainStatRatePct: 100,
          fourLineInitRatePct: 20,
          upgradeLevels: 5,
          targetSubstatName: 'SPD',
          targetSubstatThreshold: 15,
          substatPool: [],
          draftWaves: 16,
          choicesPerDraft: 3,
          rerollsPerWave: 2,
          rerollBaseCost: 5,
          rerollCostStep: 1,
          targetSynergyTag: 'xmult',
          targetSynergyCount: 3,
          tagAffinityBonusPct: 20,
          draftPool: [
            {
              id: 'dp_1',
              name: 'Steel Joker (×Mult)',
              rarity: 'uncommon',
              baseWeight: 12,
              tags: ['xmult'],
              unique: true,
              addPower: 20,
              multPower: 1.5
            },
            {
              id: 'dp_2',
              name: 'Hologram (×Mult)',
              rarity: 'uncommon',
              baseWeight: 12,
              tags: ['xmult'],
              unique: true,
              addPower: 15,
              multPower: 1.75
            },
            {
              id: 'dp_3',
              name: 'Constellation (×Mult)',
              rarity: 'uncommon',
              baseWeight: 12,
              tags: ['xmult'],
              unique: true,
              addPower: 15,
              multPower: 1.6
            },
            {
              id: 'dp_4',
              name: 'Baron (×Mult)',
              rarity: 'rare',
              baseWeight: 6,
              tags: ['xmult'],
              unique: true,
              addPower: 30,
              multPower: 2.0
            },
            {
              id: 'dp_5',
              name: 'Triboulet (Legendary)',
              rarity: 'legendary',
              baseWeight: 3,
              tags: ['xmult'],
              unique: true,
              addPower: 50,
              multPower: 2.5
            },
            {
              id: 'dp_6',
              name: 'Even Steven (+Mult)',
              rarity: 'common',
              baseWeight: 30,
              tags: ['mult'],
              unique: true,
              addPower: 25,
              multPower: 1.0
            },
            {
              id: 'dp_7',
              name: 'Odd Todd (+Chips)',
              rarity: 'common',
              baseWeight: 30,
              tags: ['chips'],
              unique: true,
              addPower: 20,
              multPower: 1.0
            },
            {
              id: 'dp_8',
              name: 'Golden Joker (+Gold)',
              rarity: 'common',
              baseWeight: 25,
              tags: ['economy'],
              unique: true,
              addPower: 10,
              multPower: 1.0
            }
          ]
        },
        combatKernel: {
          kernel: 'deck_cycle',
          runs: 250,
          maxTurns: 8,
          seed: 2026,
          playerHp: 100,
          energyPerTurn: 4,
          drawPerTurn: 8,
          enemyHp: 300,
          enemyBaseDamage: 0,
          enemyDamageGrowth: 0,
          deckCards: [
            {
              id: 'b_flush',
              name: 'Flush Hand',
              cost: 1,
              count: 6,
              damage: 45,
              block: 0,
              draw: 1,
              energyGain: 0,
              applyStrength: 4,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 3
            },
            {
              id: 'b_straight',
              name: 'Straight Hand',
              cost: 1,
              count: 4,
              damage: 55,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 1,
              applyWeak: 0,
              exhaust: false,
              priority: 2
            },
            {
              id: 'b_pair',
              name: 'High Pair',
              cost: 1,
              count: 8,
              damage: 22,
              block: 0,
              draw: 2,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 1
            }
          ],
          maxManaCrystals: 10,
          startingHandSize: 3,
          mulliganMaxCost: 3,
          opponentHp: 30,
          opponentClearPowerPerTurn: 2,
          manaCurveDeck: [],
          trackDistance: 1000,
          initialOrbs: 4,
          maxOrbs: 8,
          orbRecoveryPer5Actions: 3,
          targetEnemyHp: 50000,
          targetEnemyDef: 400,
          actionUnits: []
        },
        roguelikeEnvelope: {
          floors: 16,
          runs: 400,
          seed: 2026,
          playerBasePower: 300,
          baseAddPerFloor: 240,
          synergyHitRatePct: 36,
          synergyMultPerHit: 1.48,
          enemyBasePower: 300,
          enemyGrowthRate: 1.38,
          bossEveryNWave: 2,
          bossDifficultyMult: 1.35,
          metaBonusPerRunPct: 8
        }
      }

    case 'survivor_brotato':
      return {
        activePresetId: 'survivor_brotato',
        multiplier: {
          presetId: 'survivor_brotato',
          title: 'Brotato / Survivor Multi-Zone Expected DPS (EDPS)',
          attributes: [
            {
              id: 'sv_base',
              name: 'BaseDmg',
              label: 'Weapon Base DMG',
              value: 18,
              min: 1,
              max: 200,
              stepPerBudget: 4
            },
            {
              id: 'sv_flat',
              name: 'FlatDmg',
              label: 'Flat Ranged/Melee DMG',
              value: 12,
              min: 0,
              max: 150,
              stepPerBudget: 3
            },
            {
              id: 'sv_scale',
              name: 'Scaling',
              label: 'Weapon Stat Scaling',
              value: 1.0,
              min: 0.2,
              max: 3.0,
              stepPerBudget: 0.1
            },
            {
              id: 'sv_pct',
              name: 'PctDmg',
              label: '% Damage Bonus',
              value: 45,
              min: -50,
              max: 500,
              stepPerBudget: 12
            },
            {
              id: 'sv_aspd',
              name: 'AtkSpd',
              label: '% Attack Speed',
              value: 40,
              min: -50,
              max: 400,
              stepPerBudget: 10
            },
            {
              id: 'sv_crit',
              name: 'CritRate',
              label: 'Crit Rate (%)',
              value: 25,
              min: 0,
              max: 100,
              stepPerBudget: 6
            },
            {
              id: 'sv_cdmg',
              name: 'CritDmg',
              label: 'Crit Multiplier (x)',
              value: 2.0,
              min: 1.5,
              max: 4.0,
              stepPerBudget: 0.12
            },
            {
              id: 'sv_cd',
              name: 'BaseCD',
              label: 'Base Cooldown (s)',
              value: 0.75,
              min: 0.1,
              max: 3.0,
              stepPerBudget: 0
            }
          ],
          stages: [
            {
              id: 's1',
              name: 'SingleHitDmg',
              formula: '(BaseDmg + FlatDmg * Scaling) * (1 + PctDmg / 100)'
            },
            {
              id: 's2',
              name: 'CritExpectation',
              formula: '1 + clamp(CritRate / 100, 0, 1) * (CritDmg - 1)'
            },
            { id: 's3', name: 'AttacksPerSec', formula: '(1 + AtkSpd / 100) / BaseCD' }
          ],
          finalFormula: 'SingleHitDmg * CritExpectation * AttacksPerSec',
          expectedBudgetFormula: '30 + cost * 1.4',
          entityValueFormula: '(dmg * (1 + crit * 0.01) * pierce) / max(0.15, cd)',
          statColumns: ['dmg', 'cd', 'crit', 'pierce'],
          entities: [
            {
              id: 'w_smg',
              name: 'SMG (Rapid Ranged)',
              cost: 35,
              rarity: 'common',
              tags: ['gun'],
              stats: { dmg: 8, cd: 0.17, crit: 5, pierce: 1.2 }
            },
            {
              id: 'w_shotgun',
              name: 'Double Barrel Shotgun',
              cost: 45,
              rarity: 'uncommon',
              tags: ['gun'],
              stats: { dmg: 18, cd: 0.95, crit: 10, pierce: 3.5 }
            },
            {
              id: 'w_slingshot',
              name: 'Slingshot (Bounce)',
              cost: 30,
              rarity: 'common',
              tags: ['primitive'],
              stats: { dmg: 14, cd: 0.72, crit: 12, pierce: 3.0 }
            },
            {
              id: 'w_minigun',
              name: 'Chain Minigun (Tier IV)',
              cost: 120,
              rarity: 'legendary',
              tags: ['gun', 'heavy'],
              stats: { dmg: 12, cd: 0.09, crit: 15, pierce: 2.2 }
            }
          ]
        },
        lootRoll: {
          mode: 'roguelike_draft',
          runs: 400,
          seed: 2026,
          baseSsrRatePct: 5,
          softPityStart: 30,
          softPitySlopePct: 5,
          hardPityPull: 50,
          upGuarantee5050: false,
          targetCopies: 1,
          costPerPull: 20,
          dupeDustYield: 5,
          staminaPerDrop: 10,
          targetSlotDropRatePct: 20,
          targetMainStatRatePct: 100,
          fourLineInitRatePct: 20,
          upgradeLevels: 5,
          targetSubstatName: 'SPD',
          targetSubstatThreshold: 15,
          substatPool: [],
          draftWaves: 20,
          choicesPerDraft: 4,
          rerollsPerWave: 2,
          rerollBaseCost: 8,
          rerollCostStep: 4,
          targetSynergyTag: 'gun',
          targetSynergyCount: 6,
          tagAffinityBonusPct: 35,
          draftPool: [
            {
              id: 'br_1',
              name: 'SMG',
              rarity: 'common',
              baseWeight: 30,
              tags: ['gun'],
              unique: false,
              addPower: 12,
              multPower: 1.08
            },
            {
              id: 'br_2',
              name: 'Shotgun',
              rarity: 'common',
              baseWeight: 28,
              tags: ['gun'],
              unique: false,
              addPower: 15,
              multPower: 1.1
            },
            {
              id: 'br_3',
              name: 'Revolver',
              rarity: 'uncommon',
              baseWeight: 20,
              tags: ['gun'],
              unique: false,
              addPower: 18,
              multPower: 1.12
            },
            {
              id: 'br_4',
              name: 'Bandana (Pierce +1)',
              rarity: 'rare',
              baseWeight: 10,
              tags: ['gun'],
              unique: true,
              addPower: 25,
              multPower: 1.35
            },
            {
              id: 'br_5',
              name: 'Ricochet (Bounce)',
              rarity: 'legendary',
              baseWeight: 5,
              tags: ['gun'],
              unique: true,
              addPower: 35,
              multPower: 1.5
            },
            {
              id: 'br_6',
              name: 'Wrench (Engineering)',
              rarity: 'common',
              baseWeight: 35,
              tags: ['engineering'],
              unique: false,
              addPower: 10,
              multPower: 1.0
            },
            {
              id: 'br_7',
              name: 'Stick (Primitive)',
              rarity: 'common',
              baseWeight: 35,
              tags: ['primitive'],
              unique: false,
              addPower: 10,
              multPower: 1.0
            }
          ]
        },
        combatKernel: {
          kernel: 'deck_cycle',
          runs: 200,
          maxTurns: 10,
          seed: 2026,
          playerHp: 90,
          energyPerTurn: 3,
          drawPerTurn: 5,
          enemyHp: 220,
          enemyBaseDamage: 14,
          enemyDamageGrowth: 3,
          deckCards: [
            {
              id: 'sv_1',
              name: 'Burst Volley',
              cost: 1,
              count: 5,
              damage: 16,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 2
            },
            {
              id: 'sv_2',
              name: 'Dodge Roll',
              cost: 1,
              count: 4,
              damage: 0,
              block: 11,
              draw: 1,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 2
            },
            {
              id: 'sv_3',
              name: 'Overclock Stim',
              cost: 1,
              count: 2,
              damage: 0,
              block: 0,
              draw: 1,
              energyGain: 1,
              applyStrength: 3,
              applyVulnerable: 2,
              applyWeak: 0,
              exhaust: true,
              priority: 4
            }
          ],
          maxManaCrystals: 10,
          startingHandSize: 3,
          mulliganMaxCost: 3,
          opponentHp: 30,
          opponentClearPowerPerTurn: 2,
          manaCurveDeck: [],
          trackDistance: 1000,
          initialOrbs: 4,
          maxOrbs: 8,
          orbRecoveryPer5Actions: 3,
          targetEnemyHp: 50000,
          targetEnemyDef: 400,
          actionUnits: []
        },
        roguelikeEnvelope: {
          floors: 20,
          runs: 300,
          seed: 2026,
          playerBasePower: 35,
          baseAddPerFloor: 14,
          synergyHitRatePct: 38,
          synergyMultPerHit: 1.24,
          enemyBasePower: 30,
          enemyGrowthRate: 1.22,
          bossEveryNWave: 5,
          bossDifficultyMult: 1.45,
          metaBonusPerRunPct: 5
        }
      }

    case 'short_drama_progression':
      return {
        activePresetId: 'short_drama_progression',
        multiplier: {
          presetId: 'short_drama_progression',
          title: '短剧主角成长乘区与名场面底牌审计 (Realm × System × Backing × Climax)', // cjk-ok
          attributes: [
            {
              id: 'sd_realm',
              name: 'BaseRealm',
              label: '主角基础境界/身价', // cjk-ok
              value: 24,
              min: 1,
              max: 500,
              stepPerBudget: 8
            },
            {
              id: 'sd_sys',
              name: 'SystemMult',
              label: '金手指/返利倍率', // cjk-ok
              value: 1.5,
              min: 1,
              max: 20,
              stepPerBudget: 0.35
            },
            {
              id: 'sd_back',
              name: 'FactionBacking',
              label: '顶级人脉/势力权重', // cjk-ok
              value: 18,
              min: 0,
              max: 300,
              stepPerBudget: 6
            },
            {
              id: 'sd_hum',
              name: 'HumiliationStack',
              label: '受辱蓄能反转倍率', // cjk-ok
              value: 1.6,
              min: 1,
              max: 5,
              stepPerBudget: 0.25
            },
            {
              id: 'sd_sup',
              name: 'VillainSuppression',
              label: '反派背景威压阻力', // cjk-ok
              value: 12,
              min: 0,
              max: 200,
              stepPerBudget: 0
            }
          ],
          stages: [
            { id: 's1', name: 'CoreStanding', formula: 'BaseRealm * SystemMult + FactionBacking' },
            { id: 's2', name: 'ClimaxSlapBurst', formula: 'floor(CoreStanding * HumiliationStack)' }
          ],
          finalFormula: 'max(1, ClimaxSlapBurst - VillainSuppression)',
          expectedBudgetFormula: '6 + cost * 6.5',
          entityValueFormula:
            'dmg * 1.0 + block * 1.0 + draw * 4.0 + vuln * 3.0 + str * 4.5 + energy * 6.0',
          statColumns: ['dmg', 'block', 'draw', 'vuln', 'str', 'energy'],
          entities: [
            {
              id: 'sd_endure',
              name: '隐忍蛰伏·暗中布局 (铺垫)', // cjk-ok
              cost: 1,
              rarity: 'common',
              tags: ['skill', 'setup'],
              stats: { dmg: 0, block: 8, draw: 1, vuln: 0, str: 1, energy: 0 }
            },
            {
              id: 'sd_evidence',
              name: '当众甩出铁证·舆论反转', // cjk-ok
              cost: 1,
              rarity: 'common',
              tags: ['attack', 'reversal'],
              stats: { dmg: 7, block: 0, draw: 0, vuln: 2, str: 0, energy: 0 }
            },
            {
              id: 'sd_blackcard',
              name: '亮出至尊黑卡·百亿验资', // cjk-ok
              cost: 2,
              rarity: 'uncommon',
              tags: ['attack', 'wealth'],
              stats: { dmg: 13, block: 6, draw: 0, vuln: 0, str: 0, energy: 0 }
            },
            {
              id: 'sd_tycoon_kneel',
              name: '江城首富到场·下跪接驾', // cjk-ok
              cost: 2,
              rarity: 'rare',
              tags: ['attack', 'backing'],
              stats: { dmg: 12, block: 0, draw: 1, vuln: 1, str: 0, energy: 0 }
            },
            {
              id: 'sd_system_awakening',
              name: '系统百倍暴击·血脉觉醒 (卡点)', // cjk-ok
              cost: 0,
              rarity: 'rare',
              tags: ['skill', 'climax'],
              stats: { dmg: 0, block: 0, draw: 2, vuln: 0, str: 2, energy: 1 }
            },
            {
              id: 'sd_true_identity',
              name: '终极底牌·龙王/剑仙真身揭晓', // cjk-ok
              cost: 3,
              rarity: 'legendary',
              tags: ['attack', 'finisher'],
              stats: { dmg: 18, block: 0, draw: 0, vuln: 1, str: 1, energy: 0 }
            }
          ]
        },
        lootRoll: {
          mode: 'roguelike_draft',
          runs: 400,
          seed: 2026,
          baseSsrRatePct: 3.5,
          softPityStart: 20,
          softPitySlopePct: 4.5,
          hardPityPull: 35,
          upGuarantee5050: false,
          targetCopies: 1,
          costPerPull: 50,
          dupeDustYield: 12,
          staminaPerDrop: 10,
          targetSlotDropRatePct: 20,
          targetMainStatRatePct: 100,
          fourLineInitRatePct: 20,
          upgradeLevels: 5,
          targetSubstatName: 'SPD',
          targetSubstatThreshold: 15,
          substatPool: [],
          draftWaves: 8,
          choicesPerDraft: 3,
          rerollsPerWave: 1,
          rerollBaseCost: 30,
          rerollCostStep: 15,
          targetSynergyTag: 'backing',
          targetSynergyCount: 4,
          tagAffinityBonusPct: 15,
          competingArchetypes: 5,
          banSlotsCount: 1,
          pityMissStreakBoostPct: 12,
          draftPool: [
            {
              id: 'sd_dp1',
              name: '鬼谷神医针法传承 (人脉核心)', // cjk-ok
              rarity: 'uncommon',
              baseWeight: 15,
              tags: ['backing'],
              unique: false,
              addPower: 16,
              multPower: 1.22
            },
            {
              id: 'sd_dp2',
              name: '系统百倍消费返利卡 (财富乘区)', // cjk-ok
              rarity: 'uncommon',
              baseWeight: 28,
              tags: ['wealth'],
              unique: false,
              addPower: 20,
              multPower: 1.25
            },
            {
              id: 'sd_dp3',
              name: '京都财阀千金联姻契约 (势力倍增)', // cjk-ok
              rarity: 'rare',
              baseWeight: 12,
              tags: ['backing'],
              unique: true,
              addPower: 30,
              multPower: 1.45
            },
            {
              id: 'sd_dp4',
              name: '隐世古武宗师护道人 (越级反杀)', // cjk-ok
              rarity: 'uncommon',
              baseWeight: 14,
              tags: ['backing', 'combat'],
              unique: false,
              addPower: 18,
              multPower: 1.2
            },
            {
              id: 'sd_dp5',
              name: '海外万亿主权基金掌控权 (终局底牌)', // cjk-ok
              rarity: 'legendary',
              baseWeight: 10,
              tags: ['wealth', 'climax'],
              unique: true,
              prerequisiteIds: ['sd_dp2'],
              addPower: 42,
              multPower: 1.68
            },
            {
              id: 'sd_dp6',
              name: '拍卖会古玩捡漏第一桶金 (前期启动)', // cjk-ok
              rarity: 'common',
              baseWeight: 32,
              tags: ['wealth'],
              unique: false,
              addPower: 12,
              multPower: 1.05
            },
            {
              id: 'sd_dp7',
              name: '黑料铁证U盘·全网直播曝光 (舆论反转)', // cjk-ok
              rarity: 'common',
              baseWeight: 30,
              tags: ['evidence'],
              unique: false,
              addPower: 14,
              multPower: 1.1
            },
            {
              id: 'sd_dp8',
              name: '三年隐忍修为解封·灵脉觉醒 (实力暴涨)', // cjk-ok
              rarity: 'uncommon',
              baseWeight: 26,
              tags: ['realm'],
              unique: false,
              addPower: 18,
              multPower: 1.18
            },
            {
              id: 'sd_dp9',
              name: '豪门寿宴退婚书·当众休妻反杀 (名场面铺垫)', // cjk-ok
              rarity: 'common',
              baseWeight: 28,
              tags: ['climax'],
              unique: false,
              addPower: 15,
              multPower: 1.12
            }
          ]
        },
        combatKernel: {
          kernel: 'deck_cycle',
          runs: 300,
          maxTurns: 8,
          seed: 2026,
          playerHp: 85,
          energyPerTurn: 3,
          drawPerTurn: 5,
          enemyHp: 175,
          enemyBaseDamage: 13,
          enemyDamageGrowth: 2,
          deckCards: [
            {
              id: 'sd_c_awaken',
              name: '系统百倍觉醒 (高潮卡点)', // cjk-ok
              cost: 0,
              count: 1,
              damage: 0,
              block: 0,
              draw: 2,
              energyGain: 2,
              applyStrength: 2,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: true,
              priority: 5
            },
            {
              id: 'sd_c_evidence',
              name: '甩出铁证·舆论崩塌', // cjk-ok
              cost: 1,
              count: 2,
              damage: 8,
              block: 0,
              draw: 1,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 2,
              applyWeak: 1,
              exhaust: false,
              priority: 4
            },
            {
              id: 'sd_c_kneel',
              name: '首富到场·下跪接驾', // cjk-ok
              cost: 2,
              count: 2,
              damage: 14,
              block: 4,
              draw: 1,
              energyGain: 0,
              applyStrength: 2,
              applyVulnerable: 1,
              applyWeak: 0,
              exhaust: false,
              priority: 3
            },
            {
              id: 'sd_c_reveal',
              name: '真身揭晓·全员震怖 (终结)', // cjk-ok
              cost: 2,
              count: 2,
              damage: 11,
              hits: 2,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 3
            },
            {
              id: 'sd_c_endure',
              name: '隐忍蛰伏·暗中布局', // cjk-ok
              cost: 1,
              count: 3,
              damage: 0,
              block: 9,
              draw: 1,
              energyGain: 0,
              applyStrength: 1,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 2
            }
          ],
          maxManaCrystals: 10,
          startingHandSize: 3,
          mulliganMaxCost: 3,
          opponentHp: 30,
          opponentClearPowerPerTurn: 2,
          manaCurveDeck: [],
          trackDistance: 1000,
          initialOrbs: 4,
          maxOrbs: 8,
          orbRecoveryPer5Actions: 3,
          targetEnemyHp: 50000,
          targetEnemyDef: 400,
          actionUnits: []
        },
        roguelikeEnvelope: {
          floors: 20,
          runs: 300,
          seed: 2026,
          playerBasePower: 32,
          baseAddPerFloor: 13,
          synergyHitRatePct: 38,
          synergyMultPerHit: 1.26,
          enemyBasePower: 28,
          enemyGrowthRate: 1.21,
          bossEveryNWave: 5,
          bossDifficultyMult: 1.38,
          metaBonusPerRunPct: 6,
          levelMax: 80,
          levelStatGrowthPct: 4.5,
          levelAscensionInterval: 20,
          levelAscensionBonusPct: 22
        }
      }

    case 'slay_the_spire_dbg':
    default:
      return {
        activePresetId: 'slay_the_spire_dbg',
        multiplier: {
          presetId: 'slay_the_spire_dbg',
          title: 'Slay the Spire Damage & Block Multiplier Pipeline',
          attributes: [
            {
              id: 'sts_base',
              name: 'BaseDmg',
              label: 'Card Base DMG',
              value: 14,
              min: 1,
              max: 100,
              stepPerBudget: 4
            },
            {
              id: 'sts_str',
              name: 'Strength',
              label: 'Strength (+DMG/hit)',
              value: 4,
              min: 0,
              max: 50,
              stepPerBudget: 2
            },
            {
              id: 'sts_hits',
              name: 'HitCount',
              label: 'Multi-Hit Count',
              value: 2,
              min: 1,
              max: 10,
              stepPerBudget: 0.5
            },
            {
              id: 'sts_vuln',
              name: 'Vulnerable',
              label: 'Target Vulnerable (0/1)',
              value: 1,
              min: 0,
              max: 1,
              stepPerBudget: 1
            },
            {
              id: 'sts_weak',
              name: 'Weak',
              label: 'Attacker Weak (0/1)',
              value: 0,
              min: 0,
              max: 1,
              stepPerBudget: 0
            },
            {
              id: 'sts_blk',
              name: 'EnemyBlock',
              label: 'Enemy Block',
              value: 0,
              min: 0,
              max: 100,
              stepPerBudget: 0
            }
          ],
          stages: [
            { id: 's1', name: 'StrengthScaled', formula: '(BaseDmg + Strength) * HitCount' },
            { id: 's2', name: 'WeakAdjusted', formula: 'StrengthScaled * if(Weak > 0, 0.75, 1.0)' },
            {
              id: 's3',
              name: 'VulnMultiplied',
              formula: 'floor(WeakAdjusted * if(Vulnerable > 0, 1.5, 1.0))'
            }
          ],
          finalFormula: 'max(0, VulnMultiplied - EnemyBlock)',
          expectedBudgetFormula: '6 + cost * 6.5',
          entityValueFormula:
            'dmg * 1.0 + block * 1.0 + draw * 4.0 + vuln * 3.0 + str * 4.5 + energy * 6.0',
          statColumns: ['dmg', 'block', 'draw', 'vuln', 'str', 'energy'],
          entities: [
            {
              id: 'sts_strike',
              name: 'Strike (Starter)',
              cost: 1,
              rarity: 'common',
              tags: ['attack', 'strike'],
              stats: { dmg: 6, block: 0, draw: 0, vuln: 0, str: 0, energy: 0 }
            },
            {
              id: 'sts_bash',
              name: 'Bash',
              cost: 2,
              rarity: 'common',
              tags: ['attack', 'vuln'],
              stats: { dmg: 8, block: 0, draw: 0, vuln: 2, str: 0, energy: 0 }
            },
            {
              id: 'sts_pommel',
              name: 'Pommel Strike+',
              cost: 1,
              rarity: 'common',
              tags: ['attack', 'draw'],
              stats: { dmg: 10, block: 0, draw: 2, vuln: 0, str: 0, energy: 0 }
            },
            {
              id: 'sts_shrug',
              name: 'Shrug It Off',
              cost: 1,
              rarity: 'common',
              tags: ['skill', 'block'],
              stats: { dmg: 0, block: 8, draw: 1, vuln: 0, str: 0, energy: 0 }
            },
            {
              id: 'sts_offering',
              name: 'Offering (Overbudget)',
              cost: 0,
              rarity: 'rare',
              tags: ['skill', 'exhaust'],
              stats: { dmg: 0, block: 0, draw: 3, vuln: 0, str: 0, energy: 2 }
            },
            {
              id: 'sts_inflame',
              name: 'Inflame+',
              cost: 1,
              rarity: 'uncommon',
              tags: ['power', 'strength'],
              stats: { dmg: 0, block: 0, draw: 0, vuln: 0, str: 3, energy: 0 }
            }
          ]
        },
        lootRoll: {
          mode: 'roguelike_draft',
          runs: 400,
          seed: 2026,
          baseSsrRatePct: 3.0,
          softPityStart: 20,
          softPitySlopePct: 4.0,
          hardPityPull: 40,
          upGuarantee5050: false,
          targetCopies: 1,
          costPerPull: 75,
          dupeDustYield: 15,
          staminaPerDrop: 12,
          targetSlotDropRatePct: 16.7,
          targetMainStatRatePct: 100,
          fourLineInitRatePct: 20,
          upgradeLevels: 5,
          targetSubstatName: 'SPD',
          targetSubstatThreshold: 16,
          substatPool: [],
          draftWaves: 15,
          choicesPerDraft: 3,
          rerollsPerWave: 1,
          rerollBaseCost: 50,
          rerollCostStep: 25,
          targetSynergyTag: 'strength',
          targetSynergyCount: 4,
          tagAffinityBonusPct: 25,
          draftPool: [
            {
              id: 'sp_1',
              name: 'Inflame (+2 Str)',
              rarity: 'uncommon',
              baseWeight: 22,
              tags: ['strength'],
              unique: false,
              addPower: 15,
              multPower: 1.2
            },
            {
              id: 'sp_2',
              name: 'Spot Weakness (+3 Str)',
              rarity: 'uncommon',
              baseWeight: 20,
              tags: ['strength'],
              unique: false,
              addPower: 18,
              multPower: 1.25
            },
            {
              id: 'sp_3',
              name: 'Heavy Blade (5x Str)',
              rarity: 'common',
              baseWeight: 28,
              tags: ['strength', 'attack'],
              unique: false,
              addPower: 22,
              multPower: 1.25
            },
            {
              id: 'sp_4',
              name: 'Limit Break (Double Str)',
              rarity: 'rare',
              baseWeight: 10,
              tags: ['strength'],
              unique: true,
              prerequisiteIds: ['sp_1'],
              addPower: 35,
              multPower: 1.65
            },
            {
              id: 'sp_5',
              name: 'Sword Boomerang (Multi-Hit)',
              rarity: 'common',
              baseWeight: 26,
              tags: ['strength', 'attack'],
              unique: false,
              addPower: 18,
              multPower: 1.2
            },
            {
              id: 'sp_6',
              name: 'Shrug It Off (Block)',
              rarity: 'common',
              baseWeight: 35,
              tags: ['block'],
              unique: false,
              addPower: 12,
              multPower: 1.0
            },
            {
              id: 'sp_7',
              name: 'Cleave (AOE)',
              rarity: 'common',
              baseWeight: 35,
              tags: ['aoe'],
              unique: false,
              addPower: 10,
              multPower: 1.0
            }
          ]
        },
        combatKernel: {
          kernel: 'deck_cycle',
          runs: 300,
          maxTurns: 10,
          seed: 2026,
          playerHp: 80,
          energyPerTurn: 3,
          drawPerTurn: 5,
          enemyHp: 190,
          enemyBaseDamage: 14,
          enemyDamageGrowth: 2,
          deckCards: [
            {
              id: 'c_offering',
              name: 'Offering',
              cost: 0,
              count: 1,
              damage: 0,
              block: 0,
              draw: 3,
              energyGain: 2,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: true,
              priority: 5
            },
            {
              id: 'c_inflame',
              name: 'Inflame+',
              cost: 1,
              count: 1,
              damage: 0,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 3,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: true,
              priority: 4
            },
            {
              id: 'c_bash',
              name: 'Bash+',
              cost: 2,
              count: 1,
              damage: 10,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 3,
              applyWeak: 0,
              exhaust: false,
              priority: 3
            },
            {
              id: 'c_pommel',
              name: 'Pommel Strike+',
              cost: 1,
              count: 2,
              damage: 10,
              block: 0,
              draw: 2,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 3
            },
            {
              id: 'c_shrug',
              name: 'Shrug It Off',
              cost: 1,
              count: 3,
              damage: 0,
              block: 8,
              draw: 1,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 2
            },
            {
              id: 'c_strike',
              name: 'Strike',
              cost: 1,
              count: 3,
              damage: 6,
              block: 0,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 1
            },
            {
              id: 'c_defend',
              name: 'Defend',
              cost: 1,
              count: 3,
              damage: 0,
              block: 5,
              draw: 0,
              energyGain: 0,
              applyStrength: 0,
              applyVulnerable: 0,
              applyWeak: 0,
              exhaust: false,
              priority: 1
            }
          ],
          maxManaCrystals: 10,
          startingHandSize: 3,
          mulliganMaxCost: 3,
          opponentHp: 30,
          opponentClearPowerPerTurn: 2,
          manaCurveDeck: [],
          trackDistance: 1000,
          initialOrbs: 4,
          maxOrbs: 8,
          orbRecoveryPer5Actions: 3,
          targetEnemyHp: 50000,
          targetEnemyDef: 400,
          actionUnits: []
        },
        roguelikeEnvelope: {
          floors: 15,
          runs: 300,
          seed: 2026,
          playerBasePower: 32,
          baseAddPerFloor: 11,
          synergyHitRatePct: 35,
          synergyMultPerHit: 1.28,
          enemyBasePower: 28,
          enemyGrowthRate: 1.23,
          bossEveryNWave: 5,
          bossDifficultyMult: 1.4,
          metaBonusPerRunPct: 6
        }
      }
  }
}

export function normalizeMxNumericalWorkbench(raw: unknown): MxNumericalWorkbench {
  const r = raw && typeof raw === 'object' ? (raw as Partial<MxNumericalWorkbench>) : {}
  const presetId: MxWorkbenchPresetId = (
    [
      'slay_the_spire_dbg',
      'hearthstone_tcg',
      'onmyoji_atb',
      'balatro_roguelike',
      'survivor_brotato',
      'short_drama_progression'
    ] as MxWorkbenchPresetId[]
  ).includes(r.activePresetId as MxWorkbenchPresetId)
    ? (r.activePresetId as MxWorkbenchPresetId)
    : 'slay_the_spire_dbg'
  const base = createMxWorkbenchPreset(presetId)
  return {
    activePresetId: presetId,
    multiplier:
      r.multiplier && typeof r.multiplier === 'object'
        ? { ...base.multiplier, ...r.multiplier }
        : base.multiplier,
    lootRoll:
      r.lootRoll && typeof r.lootRoll === 'object'
        ? { ...base.lootRoll, ...r.lootRoll }
        : base.lootRoll,
    combatKernel:
      r.combatKernel && typeof r.combatKernel === 'object'
        ? { ...base.combatKernel, ...r.combatKernel }
        : base.combatKernel,
    roguelikeEnvelope:
      r.roguelikeEnvelope && typeof r.roguelikeEnvelope === 'object'
        ? { ...base.roguelikeEnvelope, ...r.roguelikeEnvelope }
        : base.roguelikeEnvelope,
    ...(r.designLab && typeof r.designLab === 'object' ? { designLab: r.designLab } : {})
  }
}

/**
 * 将 Machinations 宏观经济模板 ID 映射为对应的四大子工作台旗舰预设 ID。
 */
export function mapMxTemplateToWorkbenchPreset(templateId?: string): MxWorkbenchPresetId {
  switch (templateId) {
    case 'short_drama_reversal_loop':
      return 'short_drama_progression'
    case 'balatro_ante_jokers':
      return 'balatro_roguelike'
    case 'hearthstone_mana_pack':
      return 'hearthstone_tcg'
    case 'onmyoji_speed_orbs':
    case 'gacha_pity_banner':
      return 'onmyoji_atb'
    case 'survivor_xp_loop':
    case 'tower_defense_waves':
    case 'idle_exponential_tycoon':
      return 'survivor_brotato'
    default:
      return 'slay_the_spire_dbg'
  }
}

/**
 * 从一句话自然语言描述中推断最匹配的数值工作台旗舰预设 ID。
 */
export function inferMxWorkbenchPresetFromPrompt(
  prompt: string,
  fallback: MxWorkbenchPresetId = 'slay_the_spire_dbg'
): MxWorkbenchPresetId {
  const p = (prompt ?? '').toLowerCase()
  if (!p.trim()) return fallback
  if (
    /* cjk-ok */ /short\s*drama|micro\s*drama|短剧|爽剧|逆袭|打脸|系统流|神豪|战神|赘婿|重生|女频|豪门|退婚|反派阶梯|付费卡点/.test(
      p
    )
  ) {
    return 'short_drama_progression'
  }
  if (
    /* cjk-ok */ /balatro|joker|poker|ante|blind|chips|tft|autobattler|小丑牌|小丑|筹码|底注|盲注|德州扑克|倍率爆炸|自走棋|酒馆战棋|云顶|金铲铲|三合一|追三/.test(
      p
    )
  ) {
    return 'balatro_roguelike'
  }
  if (
    /* cjk-ok */ /hearthstone|tcg|minion|mulligan|dust|snap|gwent|cube|炉石|随从|法力曲线|法力水晶|奥术之尘|万智牌|漫威|终极逆转|昆特牌|三路|战区|加注/.test(
      p
    )
  ) {
    return 'hearthstone_tcg'
  }
  if (
    /* cjk-ok */ /onmyoji|shikigami|atb|action\s*bar|pull\s*gauge|阴阳师|御魂|鬼火|拉条|行动条|式神|星穹铁道|星铁|圣遗物|速度线/.test(
      p
    )
  ) {
    return 'onmyoji_atb'
  }
  if (/* cjk-ok */ /brotato|survivor|vampire|edps|wave|土豆兄弟|幸存者|割草|怪潮|塔防/.test(p)) {
    return 'survivor_brotato'
  }
  if (
    /* cjk-ok */ /spire|dbg|deck|yugioh|杀戮尖塔|爬塔|牌库|抽弃牌|三国杀|杀闪桃|身份局|无懈可击|游戏王|同调|超量/.test(
      p
    )
  ) {
    return 'slay_the_spire_dbg'
  }
  return fallback
}

/**
 * 一句话生成整套游戏数值体系（One-Sentence Full-Game Numerical Suite Synthesizer）：
 * 1. 自动匹配五大底层数学内核 + 自走棋/三路Snap/三国杀响应链扩展品类；
 * 2. 支持内置旗舰主题包 + 任意脑洞题材（Universal Arbitrary-Topic）全卡池/乘区实体/遗物池动态派生；
 * 3. 支持句子内直接编写单卡费用/攻防/多段/条件倍率（如 `狂暴斩(2费28伤×2段)`、`背水一战(血量低于30%伤害×3)`）；
 * 4. 支持当句子包含「调平 / 平衡 / balance」时自动对全部超模/废卡执行一键预算调平。
 */
export function synthesizeMxWorkbenchFromPrompt(
  prompt: string,
  fallbackPresetId: MxWorkbenchPresetId = 'slay_the_spire_dbg'
): MxNumericalWorkbench {
  const presetId = inferMxWorkbenchPresetFromPrompt(prompt, fallbackPresetId)
  const wb = createMxWorkbenchPreset(presetId)
  const raw = (prompt ?? '').trim()
  if (!raw) return wb

  // 1. 解析层数 / 底注数 / 波次数（例如 "8底注" / "12层" / "20波" / "10 antes" / "18 floors"）
  const floorMatch = /(\d{1,2})\s*(?:个)?(?:底注|盲注|层|波|关|antes?|floors?|waves?)/i.exec(raw) // cjk-ok
  if (floorMatch?.[1]) {
    const f = Math.max(4, Math.min(40, Number(floorMatch[1])))
    wb.roguelikeEnvelope.floors = f
    wb.lootRoll.draftWaves = f
  }

  // 2. 解析基础筹码 Chips（例如 "筹码 150" / "150 chips"）
  const chipsMatch = /(?:筹码|chips?)\s*[:：=]?\s*(\d{2,4})|(\d{2,4})\s*(?:筹码|chips?)/i.exec(raw) // cjk-ok
  const chipsVal = Number(chipsMatch?.[1] ?? chipsMatch?.[2])
  if (Number.isFinite(chipsVal) && chipsVal >= 10) {
    const chipAttr = wb.multiplier.attributes.find((a) => a.name === 'BaseChips')
    if (chipAttr) chipAttr.value = chipsVal
  }

  // 3. 解析独立乘区 ×Mult（例如 "独立乘区 2.5" / "×2.5" / "x3倍"）
  const xMultMatch = /(?:独立乘区|xmult|[×x])\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:倍)?/i.exec(raw) // cjk-ok
  if (xMultMatch?.[1]) {
    const xm = Number(xMultMatch[1])
    if (Number.isFinite(xm) && xm >= 1.1 && xm <= 10) {
      const xmAttr = wb.multiplier.attributes.find((a) => a.name === 'IndepMult')
      if (xmAttr) xmAttr.value = xm
    }
  }

  // 4. 解析商店刷新费用（例如 "刷新 4金" / "reroll 4"）
  const rerollMatch = /(?:刷新|reroll)\s*(?:费用|费)?\s*[:：=]?\s*(\d{1,3})/i.exec(raw) // cjk-ok
  if (rerollMatch?.[1]) {
    wb.lootRoll.rerollBaseCost = Math.max(1, Number(rerollMatch[1]))
  }

  // 5. 解析每回合能量 / 鬼火 / 抽牌数（例如 "4点能量" / "抽6张"）
  const energyMatch = /(\d{1,2})\s*(?:点)?(?:能量|费用|energy)/i.exec(raw) // cjk-ok
  if (energyMatch?.[1]) {
    wb.combatKernel.energyPerTurn = Math.max(1, Math.min(10, Number(energyMatch[1])))
  }
  const drawMatch = /(?:抽牌|抽)\s*(\d{1,2})\s*(?:张)?/i.exec(raw) // cjk-ok
  if (drawMatch?.[1]) {
    wb.combatKernel.drawPerTurn = Math.max(1, Math.min(12, Number(drawMatch[1])))
  }

  // 6. 解析硬保底抽数（例如 "80抽保底" / "90保底" / "pity 80"）
  const pityMatch = /(\d{2,3})\s*(?:抽|包)?\s*(?:硬)?保底|pity\s*(\d{2,3})/i.exec(raw) // cjk-ok
  const pityVal = Number(pityMatch?.[1] ?? pityMatch?.[2])
  if (Number.isFinite(pityVal) && pityVal >= 10 && pityVal <= 300) {
    wb.lootRoll.hardPityPull = pityVal
    wb.lootRoll.softPityStart = Math.max(5, Math.round(pityVal * 0.78))
  }

  // 7. 解析角色满级上限（例如 "满级90" / "Lv.100" / "等级上限60"）
  const lvMaxMatch = /(?:满级|等级上限|lv\.?\s*max|max\s*level)\s*[:：=]?\s*(\d{2,3})/i.exec(raw) // cjk-ok
  if (lvMaxMatch?.[1]) {
    wb.roguelikeEnvelope.levelMax = Math.max(10, Math.min(100, Number(lvMaxMatch[1])))
  }

  // 8A. 内置高保真主题包（修仙 / 赛博 / 克苏鲁 / 三国武侠 / 自走棋酒馆 / 漫威三路战区 / 三国杀响应 / 深海料理）
  const THEME_PACKS: Array<{
    regex: RegExp
    titlePrefix: string
    entities: Array<{ name: string; role: 'chips' | 'mult' | 'xmult' | 'copy' }>
    cards: Array<{ name: string }>
    drafts: Array<{ name: string }>
  }> = [
    {
      regex: /修仙|炼丹|仙侠|法宝|灵根|金丹|xianxia|cultivation/i, // cjk-ok
      titlePrefix: 'Xianxia Alchemy & Dharma',
      entities: [
        { name: '九转金丹 (+120 灵力)', role: 'chips' }, // cjk-ok
        { name: '紫霄神雷 (+20 道韵)', role: 'mult' }, // cjk-ok
        { name: '诛仙剑阵 (×3.0 剑意)', role: 'xmult' }, // cjk-ok
        { name: '太虚乾坤镜 (复制×2.5)', role: 'copy' }, // cjk-ok
        { name: '焚天业火 (+12 道韵)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: '万剑归宗 (同花顺阵)' }, // cjk-ok
        { name: '青莲剑歌 (顺子剑诀)' }, // cjk-ok
        { name: '御剑术 (双剑合璧)' } // cjk-ok
      ],
      drafts: [
        { name: '先天混沌钟 (×Mult)' }, // cjk-ok
        { name: '鸿蒙紫气 (×Mult)' }, // cjk-ok
        { name: '阴阳造化炉 (×Mult)' }, // cjk-ok
        { name: '东皇太一印 (×Mult)' }, // cjk-ok
        { name: '大道元婴果 (传说)' } // cjk-ok
      ]
    },
    {
      regex: /赛博|黑客|义体|矩阵|算力|cyberpunk|netrunner|hacker/i, // cjk-ok
      titlePrefix: 'Cyberpunk Netrunner Matrix',
      entities: [
        { name: '军用算力芯片 (+120 算力)', role: 'chips' }, // cjk-ok
        { name: '神经超频协议 (+20 带宽)', role: 'mult' }, // cjk-ok
        { name: '黑墙突破核心 (×3.0 协议)', role: 'xmult' }, // cjk-ok
        { name: '量子镜像代理 (复制×2.5)', role: 'copy' }, // cjk-ok
        { name: '过载散热阀 (+12 带宽)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: '零日漏洞注入 (Flush)' }, // cjk-ok
        { name: 'ICE破冰脉冲 (Straight)' }, // cjk-ok
        { name: '双线程并发 (Pair)' } // cjk-ok
      ],
      drafts: [
        { name: '斯安威斯坦义体 (×Mult)' }, // cjk-ok
        { name: '光学迷彩涂层 (×Mult)' }, // cjk-ok
        { name: '荒坂原型内核 (×Mult)' }, // cjk-ok
        { name: '赛博精神病模组 (×Mult)' }, // cjk-ok
        { name: '灵魂杀手AI (传说)' } // cjk-ok
      ]
    },
    {
      regex: /克苏鲁|暗黑|深渊|诡秘|古神|eldritch|cthulhu|abyss/i, // cjk-ok
      titlePrefix: 'Eldritch Abyss & Sanity',
      entities: [
        { name: '古神低语石板 (+120 灵视)', role: 'chips' }, // cjk-ok
        { name: '深渊献祭契约 (+20 狂乱)', role: 'mult' }, // cjk-ok
        { name: '黄衣之王印记 (×3.0 灾厄)', role: 'xmult' }, // cjk-ok
        { name: '虚空拟态魔镜 (复制×2.5)', role: 'copy' }, // cjk-ok
        { name: '残破死灵书 (+12 狂乱)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: '群星归位仪式 (Flush)' }, // cjk-ok
        { name: '不可名状低语 (Straight)' }, // cjk-ok
        { name: '双生旧日支配者 (Pair)' } // cjk-ok
      ],
      drafts: [
        { name: '阿撒托斯之核 (×Mult)' }, // cjk-ok
        { name: '银之匙门扉 (×Mult)' }, // cjk-ok
        { name: '深潜者之冠 (×Mult)' }, // cjk-ok
        { name: '奈亚拉托提普面具 (×Mult)' }, // cjk-ok
        { name: '拉莱耶圣物 (传说)' } // cjk-ok
      ]
    },
    {
      regex: /三国杀|杀闪桃|无懈可击|身份局|南蛮入侵/i, // cjk-ok
      titlePrefix: 'Three Kingdoms Tactical Response',
      entities: [
        { name: '诸葛连弩 (无限出杀×3.0)', role: 'xmult' }, // cjk-ok
        { name: '青釭剑 (无视防具+120破甲)', role: 'chips' }, // cjk-ok
        { name: '八卦阵 (判定闪避+20护体)', role: 'mult' }, // cjk-ok
        { name: '木牛流马 (手牌调度×2.5)', role: 'copy' }, // cjk-ok
        { name: '贯石斧 (强命弃牌+16武力)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: '【酒杀】强命爆发' }, // cjk-ok
        { name: '【南蛮入侵】全屏AOE' }, // cjk-ok
        { name: '【无中生有】过牌调度' } // cjk-ok
      ],
      drafts: [
        { name: '无双吕布将印 (×Mult)' }, // cjk-ok
        { name: '观星诸葛羽扇 (×Mult)' }, // cjk-ok
        { name: '奸雄曹操孟德书 (×Mult)' }, // cjk-ok
        { name: '仁德刘备双股剑 (×Mult)' }, // cjk-ok
        { name: '传国玉玺 (传说)' } // cjk-ok
      ]
    },
    {
      regex: /三国|武侠|江湖|兵法|wuxia|three\s*kingdoms/i, // cjk-ok
      titlePrefix: 'Wuxia & Three Kingdoms Tactics',
      entities: [
        { name: '传国玉玺 (+120 兵力)', role: 'chips' }, // cjk-ok
        { name: '青龙偃月刀 (+20 武威)', role: 'mult' }, // cjk-ok
        { name: '火烧连营奇谋 (×3.0 兵略)', role: 'xmult' }, // cjk-ok
        { name: '武侯八阵图 (复制×2.5)', role: 'copy' }, // cjk-ok
        { name: '木牛流马 (+12 粮草)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: '万箭齐发 (同花齐射)' }, // cjk-ok
        { name: '桃园结义 (顺子连环)' }, // cjk-ok
        { name: '单骑救主 (双将突围)' } // cjk-ok
      ],
      drafts: [
        { name: '方天画戟 (×Mult)' }, // cjk-ok
        { name: '太平要术 (×Mult)' }, // cjk-ok
        { name: '孟德新书 (×Mult)' }, // cjk-ok
        { name: '赤兔神驹 (×Mult)' }, // cjk-ok
        { name: '卧龙凤雏虎符 (传说)' } // cjk-ok
      ]
    },
    {
      regex: /自走棋|酒馆战棋|云顶|金铲铲|三合一|追三|tft|autobattler/i, // cjk-ok
      titlePrefix: 'Auto-Battler Tavern & 3-Star Synergy',
      entities: [
        { name: '三星五费橙卡 (×3.24 升星质变)', role: 'xmult' }, // cjk-ok
        { name: '6法神羁绊纹章 (+120 法强)', role: 'chips' }, // cjk-ok
        { name: '铜须三倍战吼 (+22 触发)', role: 'mult' }, // cjk-ok
        { name: '妮蔻之助复制器 (复制×2.5)', role: 'copy' }, // cjk-ok
        { name: '利滚利50金利息 (+15 经济)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: '8人口梭哈追三 (All-In Roll)' }, // cjk-ok
        { name: '三合一金色升星 (Triple Merge)' }, // cjk-ok
        { name: '50金卡利息慢D (Slow Roll)' } // cjk-ok
      ],
      drafts: [
        { name: '升级咯海克斯 (×Mult)' }, // cjk-ok
        { name: '高端购物海克斯 (×Mult)' }, // cjk-ok
        { name: '潘朵拉备战席 (×Mult)' }, // cjk-ok
        { name: '对冲基金海克斯 (×Mult)' }, // cjk-ok
        { name: '金铲铲冠冕 (传说)' } // cjk-ok
      ]
    },
    {
      regex: /漫威|终极逆转|snap|昆特牌|三路|战区|加注|cube|gwent/i, // cjk-ok
      titlePrefix: 'Multi-Lane Location & Cube Doubling',
      entities: [
        { name: '钢铁侠战区翻倍 (×3.0 战力)', role: 'xmult' }, // cjk-ok
        { name: '奥丁揭示重触发 (复制×2.5)', role: 'copy' }, // cjk-ok
        { name: '蓝惊奇全场光环 (+120 总点数)', role: 'chips' }, // cjk-ok
        { name: '尚气摧毁大哥 (+20 逆转)', role: 'mult' }, // cjk-ok
        { name: '魔方加注Snap (+15 威慑)', role: 'mult' } // cjk-ok
      ],
      cards: [
        { name: 'T6 决胜奇袭 (8-Cube Finisher)' }, // cjk-ok
        { name: '三路分兵铺场 (Wide Spread)' }, // cjk-ok
        { name: '战区封锁控制 (Lane Lock)' } // cjk-ok
      ],
      drafts: [
        { name: '无限手套核心 (×Mult)' }, // cjk-ok
        { name: '宇宙魔方加注器 (×Mult)' }, // cjk-ok
        { name: '瓦坎达振金盾 (×Mult)' }, // cjk-ok
        { name: '时间宝石回溯 (×Mult)' }, // cjk-ok
        { name: '至尊法师之眼 (传说)' } // cjk-ok
      ]
    }
  ]

  let matchedBuiltInTheme = false
  for (const pack of THEME_PACKS) {
    if (pack.regex.test(raw)) {
      matchedBuiltInTheme = true
      wb.multiplier.title = `${pack.titlePrefix} — ${wb.multiplier.title}`
      pack.entities.forEach((spec, idx) => {
        if (wb.multiplier.entities[idx]) {
          wb.multiplier.entities[idx]!.name = spec.name
        }
      })
      pack.cards.forEach((spec, idx) => {
        if (wb.combatKernel.deckCards[idx]) {
          wb.combatKernel.deckCards[idx]!.name = spec.name
        }
      })
      pack.drafts.forEach((spec, idx) => {
        if (wb.lootRoll.draftPool[idx]) {
          wb.lootRoll.draftPool[idx]!.name = spec.name
        }
      })
      break
    }
  }

  // 8B. 任意脑洞题材全卡池动态派生引擎（Universal Arbitrary-Topic Procedural Card Pool Generator）
  if (!matchedBuiltInTheme) {
    const firstClause = (raw.split(/[，,。.；;\n]/)[0] ?? raw).trim()
    const topicCandidate = firstClause
      .replace(
        /^(?:请|帮我|给我|能否|可以)?(?:做|设计|生成|来|搞|构建|直出)?(?:一套|一个|一款|一份)?\s*/i, // cjk-ok
        ''
      ) // cjk-ok
      .replace(
        /\s*(?:题材|主题|风格|背景|玩法)?(?:的)?(?:卡牌|小丑牌|自走棋|肉鸽|roguelike|dbg|tcg|ccg|atb|杀戮尖塔|炉石|阴阳师|土豆兄弟|幸存者|全套|整套|游戏)?(?:数值体系|数值系统|数值|体系|系统|卡组|牌组).*$/i, // cjk-ok
        ''
      )
      .trim()

    const isGenericWord =
      /* cjk-ok */ /^(?:卡牌|小丑牌|杀戮尖塔|炉石|炉石传说|阴阳师|土豆兄弟|幸存者|肉鸽|数值|游戏|游戏经济|游戏经济系统|经济系统|经济|全套|一套|balatro|spire|hearthstone|onmyoji|game\s*economy|economy)$/i.test(
        topicCandidate
      )

    if (topicCandidate.length >= 2 && topicCandidate.length <= 16 && !isGenericWord) {
      const t = topicCandidate
      wb.multiplier.title = `${t} — Custom Card Numerical Suite`
      const topicEntities = [
        `${t}·源质增幅核心 (+120 基础)`, // cjk-ok
        `${t}·战术共鸣回路 (+20 加成)`, // cjk-ok
        `${t}·终焉超载奇点 (×3.0 独立)`, // cjk-ok
        `${t}·全息镜像投影 (复制×2.5)`, // cjk-ok
        `${t}·高能催化模组 (+12 加成)` // cjk-ok
      ]
      topicEntities.forEach((name, idx) => {
        if (wb.multiplier.entities[idx]) {
          wb.multiplier.entities[idx]!.name = name
        }
      })

      wb.combatKernel.deckCards = [
        {
          id: 'topic_c1',
          name: `${t}·疾风突袭 (1费快攻)`, // cjk-ok
          cost: 1,
          count: 4,
          damage: 9,
          block: 0,
          draw: 0,
          energyGain: 0,
          applyStrength: 0,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 2
        },
        {
          id: 'topic_c2',
          name: `${t}·铁壁防线 (1费护盾)`, // cjk-ok
          cost: 1,
          count: 4,
          damage: 0,
          block: 8,
          draw: 1,
          energyGain: 0,
          applyStrength: 0,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 2
        },
        {
          id: 'topic_c3',
          name: `${t}·潜能汲取 (0费过牌回能)`, // cjk-ok
          cost: 0,
          count: 2,
          damage: 0,
          block: 0,
          draw: 2,
          energyGain: 1,
          applyStrength: 0,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 5
        },
        {
          id: 'topic_c4',
          name: `${t}·连携重击 (2费多段破甲)`, // cjk-ok
          cost: 2,
          count: 2,
          damage: 8,
          hits: 2,
          block: 0,
          draw: 0,
          energyGain: 0,
          applyStrength: 0,
          applyVulnerable: 2,
          applyWeak: 0,
          exhaust: false,
          priority: 4
        },
        {
          id: 'topic_c5',
          name: `${t}·终焉奥义 (3费爆发核心)`, // cjk-ok
          cost: 3,
          count: 1,
          damage: 26,
          block: 6,
          draw: 0,
          energyGain: 0,
          applyStrength: 2,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 5
        }
      ]

      wb.combatKernel.manaCurveDeck = [
        {
          id: 'topic_m1',
          name: `${t}·1费先锋斥候`, // cjk-ok
          manaCost: 1,
          count: 6,
          kind: 'minion',
          attack: 2,
          health: 3,
          directDamage: 0,
          drawCards: 0
        },
        {
          id: 'topic_m2',
          name: `${t}·2费战术技师`, // cjk-ok
          manaCost: 2,
          count: 6,
          kind: 'minion',
          attack: 3,
          health: 2,
          directDamage: 1,
          drawCards: 0
        },
        {
          id: 'topic_m3',
          name: `${t}·3费重装守卫`, // cjk-ok
          manaCost: 3,
          count: 6,
          kind: 'minion',
          attack: 3,
          health: 4,
          directDamage: 0,
          drawCards: 0,
          taunt: true
        },
        {
          id: 'topic_m4',
          name: `${t}·4费中坚统领`, // cjk-ok
          manaCost: 4,
          count: 5,
          kind: 'minion',
          attack: 4,
          health: 5,
          directDamage: 0,
          drawCards: 1
        },
        {
          id: 'topic_m5',
          name: `${t}·5费终极巨兽`, // cjk-ok
          manaCost: 5,
          count: 4,
          kind: 'minion',
          attack: 6,
          health: 6,
          directDamage: 2,
          drawCards: 0
        },
        {
          id: 'topic_m6',
          name: `${t}·高能轰击咒文`, // cjk-ok
          manaCost: 4,
          count: 3,
          kind: 'spell',
          attack: 0,
          health: 0,
          directDamage: 6,
          drawCards: 1
        }
      ]

      const topicDraftNames = [
        `${t}·起源圣物 (×Mult)`, // cjk-ok
        `${t}·共鸣核心 (×Mult)`, // cjk-ok
        `${t}·超越纹章 (×Mult)`, // cjk-ok
        `${t}·宿命齿轮 (×Mult)`, // cjk-ok
        `${t}·不朽王冠 (传说)` // cjk-ok
      ]
      topicDraftNames.forEach((dName, idx) => {
        if (wb.lootRoll.draftPool[idx]) {
          wb.lootRoll.draftPool[idx]!.name = dName
        }
      })
    }
  }

  // 9A. 解析句子中带括号公式/费用/攻防/条件倍率的单卡定义（例如 "狂暴斩(2费28伤×2段)" / "背水一战(3费20伤×2.5倍)"）
  const parsedBracketNames = new Set<string>()
  const bracketCardRegex = /([^\s，,。.；;、:：()（）]{2,16})[（(]([^)）]{2,45})[)）]/g
  let bMatch: RegExpExecArray | null
  let bIdx = 0
  while ((bMatch = bracketCardRegex.exec(raw)) !== null && bIdx < 6) {
    const rawCardName = bMatch[1]!.replace(/^(?:包含|新增|加入|include|add)\s*/i, '').trim() // cjk-ok
    const specStr = bMatch[2]!.trim()
    if (!rawCardName || rawCardName.length < 2) continue
    parsedBracketNames.add(rawCardName)
    bIdx++

    const cMatch = /(\d{1,2})\s*(?:费|耗|点能量|cost|mana)/i.exec(specStr) // cjk-ok
    const dMatch = /(\d{1,4})\s*(?:伤|伤害|攻|攻击|筹码|dmg|atk|chips)/i.exec(specStr) // cjk-ok
    const blkMatch = /(\d{1,4})\s*(?:甲|格挡|护盾|防|血|生命|block|hp|shield)/i.exec(specStr) // cjk-ok
    const hitMatch = /[×x*]\s*(\d{1,2})\s*(?:段|连击|次|hits?)/i.exec(specStr) // cjk-ok
    const multMatch = /[×x*]\s*(\d+(?:\.\d+)?)\s*(?:倍|独立|mult)?/i.exec(specStr) // cjk-ok
    const drawSpecMatch = /(?:抽|摸|过牌|draw)\s*(\d{1,2})/i.exec(specStr) // cjk-ok
    const poisonSpecMatch = /(?:毒|中毒|流血|灼烧|poison)\s*(\d{1,3})/i.exec(specStr) // cjk-ok

    const cost = cMatch?.[1] ? Math.max(0, Math.min(10, Number(cMatch[1]))) : 2
    const dmg = dMatch?.[1] ? Math.max(0, Number(dMatch[1])) : 14
    const block = blkMatch?.[1] ? Math.max(0, Number(blkMatch[1])) : 0
    const hits = hitMatch?.[1] ? Math.max(1, Math.min(10, Number(hitMatch[1]))) : 1
    const draw = drawSpecMatch?.[1] ? Math.max(0, Math.min(6, Number(drawSpecMatch[1]))) : 0
    const poison = poisonSpecMatch?.[1] ? Math.max(0, Number(poisonSpecMatch[1])) : 0
    const hasCond = /低于|高于|每|暴击|残血|背水|连击|翻倍/i.test(specStr) // cjk-ok
    const xMult =
      multMatch?.[1] && !hitMatch ? Math.max(1, Number(multMatch[1])) : hasCond ? 2.0 : 1.0

    const fullCardTitle = `${rawCardName} (${specStr})`
    const stats: Record<string, number> = {}
    for (const col of wb.multiplier.statColumns) {
      if (col === 'chips' || col === 'dmg' || col === 'atk') {
        stats[col] = dmg * hits
      } else if (col === 'addMult' || col === 'block' || col === 'hp') {
        stats[col] = block > 0 ? block : 12
      } else if (col === 'xMult') {
        stats[col] = xMult
      } else if (col === 'draw') {
        stats[col] = draw
      } else {
        stats[col] = 1
      }
    }

    wb.multiplier.entities.unshift({
      id: `formula_ent_${bIdx}`,
      name: fullCardTitle,
      cost: Math.max(1, cost),
      rarity: xMult >= 2 || cost >= 3 ? 'rare' : 'uncommon',
      tags: [xMult > 1 ? 'xmult' : 'mult'],
      stats
    })

    wb.combatKernel.deckCards.unshift({
      id: `formula_card_${bIdx}`,
      name: fullCardTitle,
      cost,
      count: 2,
      damage: Math.round(dmg * (xMult > 1 ? xMult : 1)),
      hits,
      block,
      draw,
      energyGain: 0,
      applyStrength: xMult >= 2 ? 2 : 0,
      applyVulnerable: 0,
      applyWeak: 0,
      poison,
      exhaust: false,
      priority: 5
    })

    wb.combatKernel.manaCurveDeck.unshift({
      id: `formula_mana_${bIdx}`,
      name: fullCardTitle,
      manaCost: Math.max(1, cost),
      count: 2,
      kind: block > 0 ? 'minion' : 'spell',
      attack: dmg,
      health: Math.max(1, block || cost * 2),
      directDamage: block > 0 ? 0 : dmg,
      drawCards: draw
    })
  }

  // 9B. 解析句子中显式指定的原创卡牌/小丑实体名列表（例如 "包含九转金丹、诛仙剑阵、虚空道果" 或 "新增 血魔小丑、赌徒骰子"）
  const customListMatch =
    /* cjk-ok */ /(?:包含|新增|加入|include|add)\s*[:：]?\s*([^\n，,。.；;]+(?:[、/][^\n，,。.；;]+)*)/i.exec(
      raw
    )
  if (customListMatch?.[1]) {
    const names = customListMatch[1]
      .split(/[、/]/)
      .map((s) => s.replace(/[（(][^)）]*[)）]/g, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 24 && !parsedBracketNames.has(s))
      .slice(0, 6)
    names.forEach((customName, idx) => {
      const cost = 2 + (idx % 3)
      const isXMult = idx % 2 === 1
      const stats: Record<string, number> = {}
      for (const col of wb.multiplier.statColumns) {
        if (col === 'chips' || col === 'dmg' || col === 'atk') {
          stats[col] = isXMult ? 16 : 90 + idx * 25
        } else if (col === 'addMult' || col === 'block' || col === 'hp') {
          stats[col] = isXMult ? 10 : 18 + idx * 4
        } else if (col === 'xMult') {
          stats[col] = isXMult ? 2.2 + idx * 0.2 : 1.0
        } else {
          stats[col] = 1
        }
      }
      wb.multiplier.entities.unshift({
        id: `custom_ent_${idx + 1}`,
        name: customName,
        cost,
        rarity: isXMult ? 'rare' : 'uncommon',
        tags: [isXMult ? 'xmult' : 'mult'],
        stats
      })
      wb.combatKernel.deckCards.unshift({
        id: `custom_dc_${idx + 1}`,
        name: customName,
        cost: Math.min(3, cost),
        count: 2,
        damage: isXMult ? 18 : 12 + idx * 3,
        block: isXMult ? 0 : 8,
        draw: idx === 0 ? 1 : 0,
        energyGain: 0,
        applyStrength: isXMult ? 2 : 0,
        applyVulnerable: 1,
        applyWeak: 0,
        exhaust: false,
        priority: 4
      })
      wb.lootRoll.draftPool.unshift({
        id: `custom_dp_${idx + 1}`,
        name: customName,
        rarity: isXMult ? 'rare' : 'uncommon',
        baseWeight: isXMult ? 10 : 18,
        tags: [isXMult ? 'xmult' : 'mult'],
        unique: true,
        addPower: 25 + idx * 5,
        multPower: isXMult ? 1.85 : 1.25
      })
    })
  }

  // 10. 若句子要求自动调平（如 "自动调平" / "一键平衡" / "auto balance"），对实体表自动执行预算调平
  if (/* cjk-ok */ /调平|自动平衡|auto[- ]?balance/i.test(raw)) {
    const balanced = autoBalanceWorkbenchEntities(wb.multiplier)
    wb.multiplier.entities = balanced.updatedEntities
  }

  return wb
}

// ───────────────────────────── 6. 进阶深度审计：无限死循环检测、4×4流派纳什均衡与增量微调 ─────────────────────────────

export interface MxSynergyPairRow {
  pairId: string
  cardAName: string
  cardBName: string
  synergyType: 'infinite_cycle' | 'exponential_otk' | 'multihit_scaling' | 'tempo_engine'
  synergyTypeLabelZh: string
  synergyTypeLabelEn: string
  combinedScoreOrMult: number
  riskLevel: 'critical_infinite' | 'high_otk' | 'healthy_synergy'
  fixSuggestionZh: string
  fixSuggestionEn: string
}

export interface MxSynergyAndLoopAuditResult {
  infiniteLoopCount: number
  otkRiskScore: number
  maxTurn1BurstDamage: number
  pairs: MxSynergyPairRow[]
}

/**
 * 双卡/多卡「无限死循环与 OTK 秒杀检测器」（Infinite Loop & Synergy Detector）：
 * 自动扫描当前牌库与乘区实体池中的所有双卡组合，检测：
 * 1. 净能量 >= 0 且净抽牌 >= 2 且未勾选【消耗 Exhaust】的「电表倒转无限循环链」；
 * 2. 独立乘区 (xMult >= 2.0) × 复制/重触发 (Copy/Retrigger) 导致的「单回合指数爆炸 OTK」；
 * 3. 高力量/易伤增益 × 多段连击 (Hits >= 2) 的「多段乘算爆发链」。
 */
export function analyzeMxSynergyAndInfiniteLoopRisk(
  wb: MxNumericalWorkbench
): MxSynergyAndLoopAuditResult {
  const pairs: MxSynergyPairRow[] = []
  const deck = wb.combatKernel.deckCards
  const entities = wb.multiplier.entities

  // 1. 检测牌库中的无限回费抽牌死循环（Infinite Draw/Energy Loop）
  const cycleCandidates = deck.filter((c) => c.draw > 0 || c.energyGain > 0 || c.cost === 0)
  for (let i = 0; i < cycleCandidates.length; i++) {
    const a = cycleCandidates[i]!
    // 单卡自循环检测（0费抽牌且回费且不消耗）
    if (!a.exhaust && a.energyGain - a.cost >= 0 && a.draw >= 1) {
      pairs.push({
        pairId: `self_loop_${a.id}`,
        cardAName: a.name,
        cardBName: a.name,
        synergyType: 'infinite_cycle',
        synergyTypeLabelZh: '♾️ 0费自循环倒转', // cjk-ok
        synergyTypeLabelEn: '♾️ 0-Cost Self-Cycle Loop',
        combinedScoreOrMult: 999,
        riskLevel: 'critical_infinite',
        fixSuggestionZh: '必须勾选【消耗 Exhaust】或将费用上调至 1 费，否则精简牌库后可无限抽打', // cjk-ok
        fixSuggestionEn: 'Set Exhaust=true or raise cost to 1 to prevent infinite deck cycling'
      })
    }
    for (let j = i + 1; j < cycleCandidates.length; j++) {
      const b = cycleCandidates[j]!
      const netEnergy = a.energyGain - a.cost + (b.energyGain - b.cost)
      const totalDraw = a.draw + b.draw
      if (!a.exhaust && !b.exhaust && netEnergy >= 0 && totalDraw >= 2) {
        pairs.push({
          pairId: `pair_loop_${a.id}_${b.id}`,
          cardAName: a.name,
          cardBName: b.name,
          synergyType: 'infinite_cycle',
          synergyTypeLabelZh: '♾️ 双卡永动抽滤链', // cjk-ok
          synergyTypeLabelEn: '♾️ 2-Card Infinite Draw/Energy',
          combinedScoreOrMult: 850 + netEnergy * 50 + totalDraw * 20,
          riskLevel: 'critical_infinite',
          fixSuggestionZh: `净回费 +${netEnergy} 且抽 ${totalDraw} 张：建议为其中一张增加【消耗 Exhaust】或每回合限触发 2 次`, // cjk-ok
          fixSuggestionEn: `Net +${netEnergy} NRG & +${totalDraw} Draw: Add Exhaust to one card or cap at 2 triggers/turn`
        })
      }
    }
  }

  // 2. 检测乘区实体中的独立乘区 × 复制重触发指数 OTK
  const xMultEntities = entities.filter(
    (e) => (e.stats.xMult ?? 1) >= 1.8 || /×|复制|copy|retrigger|蓝图|头脑/i.test(e.name) // cjk-ok
  )
  for (let i = 0; i < xMultEntities.length; i++) {
    for (let j = i + 1; j < xMultEntities.length; j++) {
      const a = xMultEntities[i]!
      const b = xMultEntities[j]!
      const xmA = Math.max(1.5, Number(a.stats.xMult ?? 2.2))
      const xmB = Math.max(1.5, Number(b.stats.xMult ?? 2.0))
      const compound = Math.round(xmA * xmB * 100) / 100
      if (compound >= 4.2) {
        pairs.push({
          pairId: `otk_${a.id}_${b.id}`,
          cardAName: a.name,
          cardBName: b.name,
          synergyType: 'exponential_otk',
          synergyTypeLabelZh: '💥 独立乘区叠乘爆炸', // cjk-ok
          synergyTypeLabelEn: '💥 Compound ×Mult Explosion',
          combinedScoreOrMult: compound,
          riskLevel: compound >= 6.0 ? 'high_otk' : 'healthy_synergy',
          fixSuggestionZh:
            compound >= 6.0
              ? `双卡叠乘达 ×${compound} 倍：建议将其中一张改为加算 (+Mult) 或稀有度升至传说并上调商店售价` // cjk-ok
              : `双卡叠乘 ×${compound} 倍：属于核心爽点成型组合，保持稀有度门槛即可`, // cjk-ok
          fixSuggestionEn:
            compound >= 6.0
              ? `×${compound} compound mult: Convert one to additive +Mult or raise rarity to Legendary`
              : `×${compound} compound mult: Healthy build-around synergy`
        })
      }
    }
  }

  // 3. 检测牌库中的 力量/易伤 × 多段连击 (Multi-hit Scaling)
  const buffCards = deck.filter((c) => c.applyStrength > 0 || c.applyVulnerable > 0)
  const multiHitCards = deck.filter((c) => (c.hits ?? 1) >= 2 || c.damage >= 16)
  for (const buff of buffCards) {
    for (const atk of multiHitCards) {
      if (buff.id === atk.id) continue
      const hits = Math.max(1, atk.hits ?? 1)
      const strBonus = buff.applyStrength * hits
      const vulnMult = buff.applyVulnerable > 0 ? 1.5 : 1.0
      const burstDmg = Math.round((atk.damage * hits + strBonus * 2) * vulnMult)
      if (burstDmg >= 22) {
        pairs.push({
          pairId: `scale_${buff.id}_${atk.id}`,
          cardAName: buff.name,
          cardBName: atk.name,
          synergyType: 'multihit_scaling',
          synergyTypeLabelZh: '⚔️ 增伤×多段连击放大', // cjk-ok
          synergyTypeLabelEn: '⚔️ Buff × Multi-Hit Scaling',
          combinedScoreOrMult: burstDmg,
          riskLevel: burstDmg >= 48 ? 'high_otk' : 'healthy_synergy',
          fixSuggestionZh:
            burstDmg >= 48
              ? `单轮协同爆发 ${burstDmg} 点伤害：注意高连击段数对固定力量加成的放大倍率 (${hits}段)` // cjk-ok
              : `单轮协同爆发 ${burstDmg} 点伤害：良性主力输出配合`, // cjk-ok
          fixSuggestionEn:
            burstDmg >= 48
              ? `${burstDmg} burst DMG: Watch flat Strength scaling across ${hits} hits`
              : `${burstDmg} burst DMG: Healthy primary combo`
        })
      }
    }
  }

  const sortedPairs = pairs
    .sort((a, b) => {
      const rank = (r: MxSynergyPairRow['riskLevel']): number =>
        r === 'critical_infinite' ? 3 : r === 'high_otk' ? 2 : 1
      return rank(b.riskLevel) - rank(a.riskLevel) || b.combinedScoreOrMult - a.combinedScoreOrMult
    })
    .slice(0, 10)

  const infiniteLoopCount = sortedPairs.filter((p) => p.riskLevel === 'critical_infinite').length
  const highOtkCount = sortedPairs.filter((p) => p.riskLevel === 'high_otk').length
  const otkRiskScore = Math.min(100, infiniteLoopCount * 42 + highOtkCount * 22 + 12)
  const maxTurn1BurstDamage = Math.max(
    24,
    ...sortedPairs
      .filter((p) => p.synergyType === 'multihit_scaling')
      .map((p) => p.combinedScoreOrMult),
    Math.round(wb.roguelikeEnvelope.playerBasePower * 1.8)
  )

  return {
    infiniteLoopCount,
    otkRiskScore,
    maxTurn1BurstDamage,
    pairs: sortedPairs
  }
}

/**
 * 一键熔断无限死循环与超限指数爆炸（Auto-Circuit-Breaker）：
 * 自动为所有 0 费回能/抽牌永动卡加上 `exhaust = true`，并将过高的独立乘区下调至安全上限。
 */
export function applyMxInfiniteLoopCircuitBreaker(wb: MxNumericalWorkbench): number {
  let fixedCount = 0
  for (const card of wb.combatKernel.deckCards) {
    if (!card.exhaust && card.energyGain - card.cost >= 0 && card.draw >= 1) {
      card.exhaust = true
      fixedCount++
    }
  }
  for (const ent of wb.multiplier.entities) {
    if (typeof ent.stats.xMult === 'number' && ent.stats.xMult > 2.5) {
      ent.stats.xMult = 2.4
      fixedCount++
    }
  }
  return fixedCount
}

export interface MxPvpMatchupRow {
  archetypeId: string
  nameZh: string
  nameEn: string
  /** 对矩阵中每套卡组的胜率（%），顺序同 MxPvpMatchupMatrixResult.archetypes */
  vsPcts: number[]
  avgWinRatePct: number
  initialSharePct: number
  nashEquilibriumSharePct: number
  status: 'tier0_dominant' | 'balanced_pillar' | 'unplayable_weak'
}

export interface MxPvpMatchupMatrixResult {
  archetypes: Array<{ id: string; nameZh: string; nameEn: string }>
  rows: MxPvpMatchupRow[]
  rpsCycleHealthScore: number
  dominantTier0Archetype: string | null
  verdict: 'healthy_rps_cycle' | 'slight_skew' | 'tier0_monopoly'
  /** 矩阵来源：卡组对打真实模拟 */
  matrixSource: 'deck_vs_deck_simulation'
  runsPerPair: number
}

/**
 * 流派互克矩阵与天梯均衡推演（基于卡组对打真实模拟）：
 * 「当前卡组」+ 3 套基准流派卡组（力量爆发 / 叠甲消耗 / 高速过牌）两两交替先手对打，
 * 生成 4×4 实测胜率矩阵，再以复制动态（Replicator Dynamics）求天梯均衡出场率。
 */
export function simulateMxPvpMatchupAndNashEquilibrium(
  wb: Pick<MxNumericalWorkbench, 'combatKernel'>,
  opts: { runsPerPair?: number; hp?: number } = {}
): MxPvpMatchupMatrixResult {
  const current = wb.combatKernel.deckCards.length
    ? wb.combatKernel.deckCards
    : getMxCanonicalArchetypeDeck('strength_burst')
  const decks = [
    { id: 'current', nameZh: '🎴 当前卡组', nameEn: 'Your Deck', cards: current }, // cjk-ok
    {
      id: 'strength_burst',
      nameZh: '⚡ 力量爆发', // cjk-ok
      nameEn: 'Strength Burst',
      cards: getMxCanonicalArchetypeDeck('strength_burst')
    },
    {
      id: 'attrition_block',
      nameZh: '🛡️ 叠甲消耗', // cjk-ok
      nameEn: 'Attrition Block',
      cards: getMxCanonicalArchetypeDeck('attrition_block')
    },
    {
      id: 'high_cycle_combo',
      nameZh: '🌀 高速过牌', // cjk-ok
      nameEn: 'High-Cycle Combo',
      cards: getMxCanonicalArchetypeDeck('high_cycle_combo')
    }
  ]
  const res = simulateMxDeckVsDeckMatrix(
    decks.map((d) => ({ id: d.id, name: d.nameEn, cards: d.cards })),
    {
      runs: opts.runsPerPair ?? 24,
      seed: wb.combatKernel.seed || 1,
      hp: opts.hp ?? 60,
      energyPerTurn: wb.combatKernel.energyPerTurn || 3,
      drawPerTurn: wb.combatKernel.drawPerTurn || 5,
      maxTurnsPerSide: 25,
      policy: 'greedy'
    }
  )

  const rows: MxPvpMatchupRow[] = decks.map((d, i) => {
    const rowW = res.matrix[i]!
    const others = rowW.filter((_, j) => j !== i)
    const avgWin =
      Math.round((others.reduce((a, b) => a + b, 0) / Math.max(1, others.length)) * 10) / 10
    const nashPct = res.nashSharesPct[i] ?? 0
    return {
      archetypeId: d.id,
      nameZh: d.nameZh,
      nameEn: d.nameEn,
      vsPcts: rowW.slice(),
      avgWinRatePct: avgWin,
      initialSharePct: Math.round(1000 / decks.length) / 10,
      nashEquilibriumSharePct: nashPct,
      status:
        nashPct >= 42 ? 'tier0_dominant' : nashPct <= 11 ? 'unplayable_weak' : 'balanced_pillar'
    }
  })

  const maxShare = Math.max(...rows.map((r) => r.nashEquilibriumSharePct))
  const minShare = Math.min(...rows.map((r) => r.nashEquilibriumSharePct))
  const rpsCycleHealthScore = Math.max(
    0,
    Math.min(100, Math.round(100 - (maxShare - 25) * 1.6 - Math.max(0, 15 - minShare) * 1.5))
  )
  const tier0Row = rows.find((r) => r.status === 'tier0_dominant')

  return {
    archetypes: decks.map((d) => ({ id: d.id, nameZh: d.nameZh, nameEn: d.nameEn })),
    rows,
    rpsCycleHealthScore,
    dominantTier0Archetype: tier0Row ? tier0Row.nameZh : null,
    verdict:
      rpsCycleHealthScore >= 75
        ? 'healthy_rps_cycle'
        : rpsCycleHealthScore >= 52
          ? 'slight_skew'
          : 'tier0_monopoly',
    matrixSource: 'deck_vs_deck_simulation',
    runsPerPair: res.runsPerPair
  }
}

export interface MxWorkbenchDeltaPatchResult {
  workbench: MxNumericalWorkbench
  touchedCount: number
  summaryZh: string
  summaryEn: string
}

/**
 * 判断用户输入的一句话是否属于「在当前表基础上增量微调（Delta Patch）」而非整套推倒重建。
 */
export function isMxDeltaPatchPrompt(prompt: string): boolean {
  const p = (prompt ?? '').trim()
  if (!p) return false
  if (/^(?:做一套|设计一套|生成一套|来一套|新建一套)/i.test(p)) return false // cjk-ok
  return /* cjk-ok */ /所有|全部|全卡|高费|低费|提高|提升|增加|上调|降低|下调|减少|削弱|翻倍|减半|改成|改为|设为|再加|追加|熔断|[+-]\s*\d+%?/i.test(
    p
  )
}

/**
 * 一句话「增量批处理微调（Delta Patch）」（不冲掉已调好的表）：
 * 在完全保留当前工作台已有卡牌、乘区与参数的基础上，执行局部数值批处理修改。
 */
export function applyMxWorkbenchDeltaPatchFromPrompt(
  currentWb: MxNumericalWorkbench,
  prompt: string
): MxWorkbenchDeltaPatchResult {
  const wb: MxNumericalWorkbench = JSON.parse(JSON.stringify(currentWb))
  const raw = (prompt ?? '').trim()
  if (!raw) {
    return {
      workbench: wb,
      touchedCount: 0,
      summaryZh: '未检测到微调指令', // cjk-ok
      summaryEn: 'No delta instructions detected'
    }
  }

  let touchedCount = 0
  const actionsZh: string[] = []
  const actionsEn: string[] = []

  // 是否仅针对高费卡（>=2费）或低费卡（<=1费）
  const onlyHighCost = /高费|[23]费以上|大牌/i.test(raw) // cjk-ok
  const onlyLowCost = /低费|[01]费|小牌/i.test(raw) // cjk-ok
  const matchCostFilter = (cost: number): boolean => {
    if (onlyHighCost) return cost >= 2
    if (onlyLowCost) return cost <= 1
    return true
  }

  // 1. 卡牌伤害 / 攻击力 / 筹码 百分比或固定值微调（例如 "所有卡牌伤害提高25%" / "高费卡伤害+20%" / "伤害下调15%"）
  const dmgPctMatch =
    /* cjk-ok */ /(?:伤害|攻击|攻击力|筹码|dmg|atk|damage)\s*(?:提高|提升|增加|上调|降低|下调|减少|削弱|[+-])\s*(\d{1,3})\s*%/i.exec(
      raw
    )
  if (dmgPctMatch?.[1]) {
    const isDown = /降低|下调|减少|削弱|-/i.test(dmgPctMatch[0]) // cjk-ok
    const pct = Number(dmgPctMatch[1]) * (isDown ? -1 : 1)
    const mult = Math.max(0.2, 1 + pct / 100)
    for (const c of wb.combatKernel.deckCards) {
      if (c.damage > 0 && matchCostFilter(c.cost)) {
        c.damage = Math.max(1, Math.round(c.damage * mult))
        touchedCount++
      }
    }
    for (const m of wb.combatKernel.manaCurveDeck) {
      if (matchCostFilter(m.manaCost)) {
        if (m.attack > 0) m.attack = Math.max(1, Math.round(m.attack * mult))
        if (m.directDamage > 0) m.directDamage = Math.max(1, Math.round(m.directDamage * mult))
        touchedCount++
      }
    }
    for (const e of wb.multiplier.entities) {
      if (matchCostFilter(e.cost)) {
        for (const k of ['dmg', 'atk', 'chips']) {
          if (typeof e.stats[k] === 'number' && e.stats[k]! > 0) {
            e.stats[k] = Math.max(1, Math.round(e.stats[k]! * mult))
            touchedCount++
          }
        }
      }
    }
    actionsZh.push(`卡牌伤害 ${pct > 0 ? `+${pct}%` : `${pct}%`}`) // cjk-ok
    actionsEn.push(`Card DMG ${pct > 0 ? `+${pct}%` : `${pct}%`}`)
  }

  // 2. 护甲 / 格挡 / 生命值 百分比微调（例如 "护甲提高30%" / "格挡+20%"）
  const blkPctMatch =
    /* cjk-ok */ /(?:护甲|格挡|护盾|防御|血量|生命|block|shield)\s*(?:提高|提升|增加|上调|降低|下调|减少|削弱|[+-])\s*(\d{1,3})\s*%/i.exec(
      raw
    )
  if (blkPctMatch?.[1] && !(/* cjk-ok */ /boss|敌方|怪物/i.test(raw))) {
    const isDown = /降低|下调|减少|削弱|-/i.test(blkPctMatch[0]) // cjk-ok
    const pct = Number(blkPctMatch[1]) * (isDown ? -1 : 1)
    const mult = Math.max(0.2, 1 + pct / 100)
    for (const c of wb.combatKernel.deckCards) {
      if (c.block > 0 && matchCostFilter(c.cost)) {
        c.block = Math.max(1, Math.round(c.block * mult))
        touchedCount++
      }
    }
    actionsZh.push(`护甲格挡 ${pct > 0 ? `+${pct}%` : `${pct}%`}`) // cjk-ok
    actionsEn.push(`Card Block ${pct > 0 ? `+${pct}%` : `${pct}%`}`)
  }

  // 3. 卡牌费用批量加减（例如 "全卡费用-1" / "高费卡费用-1" / "费用+1"）
  const costDeltaMatch = /(?:费用|耗能|法力|cost)\s*([+-])\s*(\d)/i.exec(raw) // cjk-ok
  if (costDeltaMatch?.[1] && costDeltaMatch?.[2]) {
    const delta = Number(costDeltaMatch[2]) * (costDeltaMatch[1] === '-' ? -1 : 1)
    for (const c of wb.combatKernel.deckCards) {
      if (matchCostFilter(c.cost)) {
        c.cost = Math.max(0, Math.min(9, c.cost + delta))
        touchedCount++
      }
    }
    for (const e of wb.multiplier.entities) {
      if (matchCostFilter(e.cost)) {
        e.cost = Math.max(1, Math.min(10, e.cost + delta))
        touchedCount++
      }
    }
    actionsZh.push(`卡牌费用 ${delta > 0 ? `+${delta}` : delta}`) // cjk-ok
    actionsEn.push(`Card Cost ${delta > 0 ? `+${delta}` : delta}`)
  }

  // 4. Boss / 敌方血量微调（例如 "Boss血量翻倍" / "Boss血量下调20%" / "敌方血量+30%"）
  if (/* cjk-ok */ /boss\s*血量翻倍|敌方血量翻倍/i.test(raw)) {
    wb.combatKernel.enemyHp = Math.round(wb.combatKernel.enemyHp * 2)
    wb.combatKernel.opponentHp = Math.round(wb.combatKernel.opponentHp * 2)
    wb.combatKernel.targetEnemyHp = Math.round(wb.combatKernel.targetEnemyHp * 2)
    touchedCount += 3
    actionsZh.push('Boss血量 ×2') // cjk-ok
    actionsEn.push('Boss HP ×2')
  } else {
    const bossHpPct =
      /* cjk-ok */ /(?:boss|敌方|怪物)\s*(?:血量|生命|hp)\s*(?:提高|提升|增加|上调|降低|下调|减少|削弱|[+-])\s*(\d{1,3})\s*%/i.exec(
        raw
      )
    if (bossHpPct?.[1]) {
      const isDown = /降低|下调|减少|削弱|-/i.test(bossHpPct[0]) // cjk-ok
      const pct = Number(bossHpPct[1]) * (isDown ? -1 : 1)
      const mult = Math.max(0.2, 1 + pct / 100)
      wb.combatKernel.enemyHp = Math.max(10, Math.round(wb.combatKernel.enemyHp * mult))
      wb.combatKernel.opponentHp = Math.max(10, Math.round(wb.combatKernel.opponentHp * mult))
      wb.combatKernel.targetEnemyHp = Math.max(
        100,
        Math.round(wb.combatKernel.targetEnemyHp * mult)
      )
      touchedCount += 3
      actionsZh.push(`Boss血量 ${pct > 0 ? `+${pct}%` : `${pct}%`}`) // cjk-ok
      actionsEn.push(`Boss HP ${pct > 0 ? `+${pct}%` : `${pct}%`}`)
    }
  }

  // 5. 保底抽数 / 能量 / 抽牌微调
  const pityMatch = /保底\s*(?:改成|改为|设为|调到)?\s*(\d{2,3})\s*(?:抽|包)?/i.exec(raw) // cjk-ok
  if (pityMatch?.[1]) {
    wb.lootRoll.hardPityPull = Math.max(10, Math.min(300, Number(pityMatch[1])))
    wb.lootRoll.softPityStart = Math.round(wb.lootRoll.hardPityPull * 0.78)
    touchedCount++
    actionsZh.push(`硬保底设为 ${wb.lootRoll.hardPityPull} 抽`) // cjk-ok
    actionsEn.push(`Hard pity = ${wb.lootRoll.hardPityPull}`)
  }

  // 6. 在保留现有卡池的基础上追加新卡（如 "再加一张 绝命毒师(1费10伤毒8)"）
  const bracketCardRegex = /([^\s，,。.；;、:：()（）]{2,16})[（(]([^)）]{2,45})[)）]/g
  let bMatch: RegExpExecArray | null
  while ((bMatch = bracketCardRegex.exec(raw)) !== null) {
    const rawCardName = bMatch[1]!
      .replace(/^(?:再加一张|再加|追加|新增|包含|加入|add)\s*/i, '') // cjk-ok
      .trim()
    const specStr = bMatch[2]!.trim()
    if (!rawCardName || rawCardName.length < 2) continue

    const cMatch = /(\d{1,2})\s*(?:费|耗|cost|mana)/i.exec(specStr) // cjk-ok
    const dMatch = /(\d{1,4})\s*(?:伤|伤害|攻|筹码|dmg|atk|chips)/i.exec(specStr) // cjk-ok
    const blkMatch = /(\d{1,4})\s*(?:甲|格挡|护盾|防|block|hp|shield)/i.exec(specStr) // cjk-ok
    const hitMatch = /[×x*]\s*(\d{1,2})\s*(?:段|连击|hits?)/i.exec(specStr) // cjk-ok
    const drawMatch = /(?:抽|摸|draw)\s*(\d{1,2})/i.exec(specStr) // cjk-ok
    const poisonMatch = /(?:毒|中毒|流血|poison)\s*(\d{1,3})/i.exec(specStr) // cjk-ok

    const cost = cMatch?.[1] ? Number(cMatch[1]) : 1
    const dmg = dMatch?.[1] ? Number(dMatch[1]) : 10
    const block = blkMatch?.[1] ? Number(blkMatch[1]) : 0
    const hits = hitMatch?.[1] ? Number(hitMatch[1]) : 1
    const draw = drawMatch?.[1] ? Number(drawMatch[1]) : 0
    const poison = poisonMatch?.[1] ? Number(poisonMatch[1]) : 0
    const title = `${rawCardName} (${specStr})`

    wb.combatKernel.deckCards.unshift({
      id: `delta_card_${Date.now()}_${touchedCount}`,
      name: title,
      cost,
      count: 2,
      damage: dmg,
      hits,
      block,
      draw,
      energyGain: 0,
      applyStrength: 0,
      applyVulnerable: 0,
      applyWeak: 0,
      poison,
      exhaust: false,
      priority: 4
    })
    wb.multiplier.entities.unshift({
      id: `delta_ent_${Date.now()}_${touchedCount}`,
      name: title,
      cost: Math.max(1, cost),
      rarity: 'rare',
      tags: ['custom'],
      stats: {
        dmg: dmg * hits,
        chips: dmg * hits * 5,
        block,
        addMult: Math.max(8, dmg),
        xMult: 1.5
      }
    })
    touchedCount++
    actionsZh.push(`追加卡牌【${title}】`) // cjk-ok
    actionsEn.push(`Added card [${title}]`)
  }

  // 7. 熔断无限连或自动调平
  if (/* cjk-ok */ /熔断|防死循环|circuit/i.test(raw)) {
    const fixed = applyMxInfiniteLoopCircuitBreaker(wb)
    touchedCount += fixed
    actionsZh.push(`熔断 ${fixed} 处无限连风险`) // cjk-ok
    actionsEn.push(`Circuit-broke ${fixed} infinite risks`)
  }
  if (/* cjk-ok */ /调平|自动平衡|balance/i.test(raw)) {
    const balanced = autoBalanceWorkbenchEntities(wb.multiplier)
    wb.multiplier.entities = balanced.updatedEntities
    touchedCount += balanced.adjustedCount
    actionsZh.push(`自动调平 ${balanced.adjustedCount} 张超模/废卡`) // cjk-ok
    actionsEn.push(`Balanced ${balanced.adjustedCount} entities`)
  }

  return {
    workbench: wb,
    touchedCount,
    summaryZh: actionsZh.length
      ? `🔧 已在当前表上增量微调 (${touchedCount} 项)：${actionsZh.join(' · ')}` // cjk-ok
      : '🔧 未匹配到增量参数，已保留原表', // cjk-ok
    summaryEn: actionsEn.length
      ? `🔧 Delta-patched (${touchedCount} items): ${actionsEn.join(' · ')}`
      : '🔧 No delta rules matched; kept existing table'
  }
}

// ───────────────────────────── 7. 卡牌升级差分 (Card ➔ Card+) 与卡组构筑体检仪 ─────────────────────────────

export interface MxCardUpgradeRoiRow {
  cardId: string
  baseName: string
  upgradedName: string
  upgradeKind: 'cost_minus_1' | 'extra_hit_or_buff' | 'stat_boost_35pct'
  upgradeKindLabelZh: string
  upgradeKindLabelEn: string
  baseSummary: string
  upgradedSummary: string
  valueGainPct: number
  winRateDeltaPct: number
  campfirePriority: 'S_first_smith' | 'A_high_value' | 'B_filler_smith'
}

export interface MxDeckCostBucket {
  costLabel: string
  cardCount: number
  sharePct: number
  idealRangeLabel: string
  status: 'optimal' | 'too_heavy' | 'too_low'
}

export interface MxDeckRoleRatioRow {
  roleId: 'attack' | 'defense' | 'engine' | 'scaling'
  labelZh: string
  labelEn: string
  cardCount: number
  actualPct: number
  recommendedRange: string
  verdict: 'healthy' | 'deficient' | 'bloated'
}

export interface MxCardUpgradeAndDeckDoctorResult {
  upgradeRows: MxCardUpgradeRoiRow[]
  costCurve: MxDeckCostBucket[]
  roleRatios: MxDeckRoleRatioRow[]
  totalDeckSize: number
  averageCost: number
  deckHealthScore: number
  doctorAdvisoryZh: string
  doctorAdvisoryEn: string
}

/**
 * 卡牌「升级前后差分 (Card ➔ Card+) 与篝火敲牌优先级 ROI」+「卡组费用曲线与四大职能黄金比例体检仪」：
 * 1. 自动为每张卡推导升级版（Card+）方案（减费型 / 多段增益型 / 35%数值成长型），并计算篝火第一敲牌优先级；
 * 2. 统计整套牌库的 0费/1费/2费/3费+ 费用分布直方图，以及 进攻/防御/过牌引擎/倍增启动 四大职能占比与卡手诊断。
 */
export function analyzeMxCardUpgradeRoiAndDeckDoctor(
  wb: MxNumericalWorkbench
): MxCardUpgradeAndDeckDoctorResult {
  const sourceCards: MxDeckCardSpec[] =
    wb.combatKernel.deckCards.length > 0
      ? wb.combatKernel.deckCards
      : wb.multiplier.entities.map((ent, idx) => ({
          id: ent.id || `ent_${idx}`,
          name: ent.name,
          cost: Math.max(0, Math.min(5, Math.round(ent.cost || 1))),
          count: 2,
          damage: Number(ent.stats.dmg ?? ent.stats.atk ?? ent.stats.chips ?? 10),
          hits: 1,
          block: Number(ent.stats.block ?? ent.stats.hp ?? 0),
          draw: Number(ent.stats.draw ?? 0),
          energyGain: 0,
          applyStrength: (ent.stats.xMult ?? 1) >= 2 ? 2 : 0,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 3
        }))

  const upgradeRows: MxCardUpgradeRoiRow[] = sourceCards.map((c) => {
    const hits = Math.max(1, c.hits ?? 1)
    const isAlreadyUpgraded = c.name.trim().endsWith('+')
    const upName = isAlreadyUpgraded ? c.name.trim() : `${c.name.trim()}+`

    let upgradeKind: MxCardUpgradeRoiRow['upgradeKind'] = 'stat_boost_35pct'
    let upgradeKindLabelZh = '📈 数值强化 (+35%)' // cjk-ok
    let upgradeKindLabelEn = '📈 +35% Output Boost'
    let upCost = c.cost
    let upDmg = c.damage
    let upBlk = c.block
    let upDraw = c.draw
    let upStr = c.applyStrength
    let upVuln = c.applyVulnerable

    if (c.cost >= 2 && c.damage === 0 && c.block === 0) {
      upgradeKind = 'cost_minus_1'
      upgradeKindLabelZh = '💎 减费质变 (费用-1)' // cjk-ok
      upgradeKindLabelEn = '💎 Cost -1 Reduction'
      upCost = Math.max(0, c.cost - 1)
      upDraw = c.draw + 1
    } else if (hits >= 2 || c.applyStrength > 0 || c.applyVulnerable > 0) {
      upgradeKind = 'extra_hit_or_buff'
      upgradeKindLabelZh = '⚡ 连击/增益进阶' // cjk-ok
      upgradeKindLabelEn = '⚡ Multi-Hit / Buff Scaling'
      if (c.damage > 0) upDmg = c.damage + Math.max(2, Math.round(c.damage * 0.28))
      if (c.applyStrength > 0) upStr = c.applyStrength + 1
      if (c.applyVulnerable > 0) upVuln = c.applyVulnerable + 1
    } else {
      if (c.damage > 0) upDmg = c.damage + Math.max(3, Math.round(c.damage * 0.35))
      if (c.block > 0) upBlk = c.block + Math.max(3, Math.round(c.block * 0.35))
      if (c.damage === 0 && c.block === 0) upDraw = c.draw + 1
    }

    const baseVal =
      c.damage * hits +
      c.block +
      c.draw * 4.5 +
      c.energyGain * 6 +
      c.applyStrength * 6 +
      c.applyVulnerable * 4
    const upVal =
      upDmg * hits +
      upBlk +
      upDraw * 4.5 +
      c.energyGain * 6 +
      upStr * 6 +
      upVuln * 4 +
      (c.cost - upCost) * 7
    const valueGainPct = Math.max(
      12,
      Math.min(120, Math.round(((upVal - baseVal) / Math.max(4, baseVal)) * 100))
    )
    const winRateDeltaPct =
      Math.round(
        valueGainPct *
          (upgradeKind === 'cost_minus_1'
            ? 0.24
            : upgradeKind === 'extra_hit_or_buff'
              ? 0.21
              : 0.14) *
          10
      ) / 10

    const fmtCard = (
      cost: number,
      dmg: number,
      blk: number,
      drw: number,
      str: number,
      vuln: number
    ): string => {
      const parts = [`${cost}NRG`]
      if (dmg > 0) parts.push(hits > 1 ? `${dmg}×${hits}DMG` : `${dmg}DMG`)
      if (blk > 0) parts.push(`${blk}BLK`)
      if (drw > 0) parts.push(`+${drw}Draw`)
      if (str > 0) parts.push(`+${str}STR`)
      if (vuln > 0) parts.push(`${vuln}Vuln`)
      return parts.join(' · ')
    }

    const campfirePriority: MxCardUpgradeRoiRow['campfirePriority'] =
      winRateDeltaPct >= 6.5 || upgradeKind === 'cost_minus_1'
        ? 'S_first_smith'
        : winRateDeltaPct >= 4.2
          ? 'A_high_value'
          : 'B_filler_smith'

    return {
      cardId: c.id,
      baseName: c.name,
      upgradedName: upName,
      upgradeKind,
      upgradeKindLabelZh,
      upgradeKindLabelEn,
      baseSummary: fmtCard(c.cost, c.damage, c.block, c.draw, c.applyStrength, c.applyVulnerable),
      upgradedSummary: fmtCard(upCost, upDmg, upBlk, upDraw, upStr, upVuln),
      valueGainPct,
      winRateDeltaPct,
      campfirePriority
    }
  })

  upgradeRows.sort((a, b) => b.winRateDeltaPct - a.winRateDeltaPct)

  // 2. 卡组费用曲线分布（0费 / 1费 / 2费 / 3+费）
  const totalDeckSize = Math.max(
    1,
    sourceCards.reduce((sum, c) => sum + Math.max(1, c.count || 1), 0)
  )
  const weightedCostSum = sourceCards.reduce(
    (sum, c) => sum + c.cost * Math.max(1, c.count || 1),
    0
  )
  const averageCost = Math.round((weightedCostSum / totalDeckSize) * 100) / 100

  const countByCost = [0, 0, 0, 0]
  let atkCount = 0
  let defCount = 0
  let engCount = 0
  let sclCount = 0

  for (const c of sourceCards) {
    const cnt = Math.max(1, c.count || 1)
    const bucketIdx = Math.min(3, Math.max(0, Math.round(c.cost)))
    countByCost[bucketIdx] = (countByCost[bucketIdx] ?? 0) + cnt

    if (c.draw > 0 || c.energyGain > 0) {
      engCount += cnt
    } else if (c.applyStrength > 0 || c.applyVulnerable > 0 || (c.poison ?? 0) > 0) {
      sclCount += cnt
    } else if (c.block > c.damage) {
      defCount += cnt
    } else {
      atkCount += cnt
    }
  }

  const bucketDefs: Array<{
    idx: number
    costLabel: string
    idealLo: number
    idealHi: number
    idealRangeLabel: string
  }> = [
    { idx: 0, costLabel: '0 Cost', idealLo: 5, idealHi: 25, idealRangeLabel: '5%~25%' },
    { idx: 1, costLabel: '1 Cost', idealLo: 35, idealHi: 65, idealRangeLabel: '35%~65%' },
    { idx: 2, costLabel: '2 Cost', idealLo: 15, idealHi: 40, idealRangeLabel: '15%~40%' },
    { idx: 3, costLabel: '3+ Cost', idealLo: 0, idealHi: 20, idealRangeLabel: '0%~20%' }
  ]

  const costCurve: MxDeckCostBucket[] = bucketDefs.map((b) => {
    const cardCount = countByCost[b.idx] ?? 0
    const sharePct = Math.round((cardCount / totalDeckSize) * 1000) / 10
    const status: MxDeckCostBucket['status'] =
      sharePct > b.idealHi ? 'too_heavy' : sharePct < b.idealLo ? 'too_low' : 'optimal'
    return {
      costLabel: b.costLabel,
      cardCount,
      sharePct,
      idealRangeLabel: b.idealRangeLabel,
      status
    }
  })

  const roleSpecs: Array<{
    roleId: MxDeckRoleRatioRow['roleId']
    labelZh: string
    labelEn: string
    cardCount: number
    lo: number
    hi: number
  }> = [
    {
      roleId: 'attack',
      labelZh: '⚔️ 进攻输出卡 (Attack)', // cjk-ok
      labelEn: '⚔️ Attack / Burst',
      cardCount: atkCount,
      lo: 30,
      hi: 55
    },
    {
      roleId: 'defense',
      labelZh: '🛡️ 防御护盾卡 (Defense)', // cjk-ok
      labelEn: '🛡️ Defense / Guard',
      cardCount: defCount,
      lo: 20,
      hi: 45
    },
    {
      roleId: 'engine',
      labelZh: '🔄 过牌/回能引擎 (Draw/NRG)', // cjk-ok
      labelEn: '🔄 Draw & Energy Engine',
      cardCount: engCount,
      lo: 10,
      hi: 30
    },
    {
      roleId: 'scaling',
      labelZh: '✨ 增益/倍增核心 (Scaling)', // cjk-ok
      labelEn: '✨ Scaling & Multipliers',
      cardCount: sclCount,
      lo: 10,
      hi: 30
    }
  ]

  const roleRatios: MxDeckRoleRatioRow[] = roleSpecs.map((r) => {
    const actualPct = Math.round((r.cardCount / totalDeckSize) * 1000) / 10
    return {
      roleId: r.roleId,
      labelZh: r.labelZh,
      labelEn: r.labelEn,
      cardCount: r.cardCount,
      actualPct,
      recommendedRange: `${r.lo}%~${r.hi}%`,
      verdict: actualPct < r.lo ? 'deficient' : actualPct > r.hi ? 'bloated' : 'healthy'
    }
  })

  const deficientCount = roleRatios.filter((r) => r.verdict !== 'healthy').length
  const heavyCostPenalty = averageCost > 1.75 ? Math.round((averageCost - 1.75) * 35) : 0
  const deckHealthScore = Math.max(25, Math.min(100, 96 - deficientCount * 14 - heavyCostPenalty))

  const doctorAdvisoryZh =
    averageCost > 1.8
      ? `⚠️ 平均费用偏高 (${averageCost}费)：前3回合极易卡手空过，建议增加 0~1 费过牌/回能卡或下调高费卡数量` // cjk-ok
      : roleRatios.find((r) => r.roleId === 'engine' && r.verdict === 'deficient')
        ? `⚠️ 缺乏过牌/回能润滑引擎 (<10%)：牌库循环缓慢，难以在关键回合抽到核心必杀卡` // cjk-ok
        : roleRatios.find((r) => r.roleId === 'defense' && r.verdict === 'deficient')
          ? `⚠️ 防御护盾占比偏低 (<20%)：面对高攻精英与反伤 Boss 战损过高，建议补足 1 费护盾卡` // cjk-ok
          : `✅ 牌库结构健康 (${totalDeckSize}张 · 均费 ${averageCost})：攻防与过牌引擎处于黄金配比区间` // cjk-ok

  const doctorAdvisoryEn =
    averageCost > 1.8
      ? `⚠️ High avg cost (${averageCost}): High brick risk in Turns 1–3; add 0–1 cost draw/energy cards`
      : roleRatios.find((r) => r.roleId === 'engine' && r.verdict === 'deficient')
        ? `⚠️ Low Draw/Energy engine (<10%): Slow deck cycle; add draw/mana engine cards`
        : `✅ Healthy deck composition (${totalDeckSize} cards · Avg cost ${averageCost})`

  return {
    upgradeRows,
    costCurve,
    roleRatios,
    totalDeckSize,
    averageCost,
    deckHealthScore,
    doctorAdvisoryZh,
    doctorAdvisoryEn
  }
}

/**
 * 一键将篝火优先级最高的前 N 张核心卡牌升级为强化版（`Card` ➔ `Card+`），并同步更新战斗牌库与乘区实体表。
 */
export function applyMxTopCardUpgrades(wb: MxNumericalWorkbench, maxCount = 2): number {
  const analysis = analyzeMxCardUpgradeRoiAndDeckDoctor(wb)
  const topIds = new Set(
    analysis.upgradeRows
      .filter((r) => !r.baseName.trim().endsWith('+'))
      .slice(0, maxCount)
      .map((r) => r.cardId)
  )
  const upgradedIds = new Set<string>()

  for (const c of wb.combatKernel.deckCards) {
    if (!topIds.has(c.id) || c.name.trim().endsWith('+')) continue
    c.name = `${c.name.trim()}+`
    if (c.cost >= 2 && c.damage === 0 && c.block === 0) {
      c.cost = Math.max(0, c.cost - 1)
      c.draw += 1
    } else {
      if (c.damage > 0) c.damage += Math.max(3, Math.round(c.damage * 0.35))
      if (c.block > 0) c.block += Math.max(3, Math.round(c.block * 0.35))
      if (c.applyStrength > 0) c.applyStrength += 1
      if (c.applyVulnerable > 0) c.applyVulnerable += 1
    }
    upgradedIds.add(c.id)
  }

  // 仅同步升级与牌库同 ID（或在无牌库时被选中）的配表实体，不再误升级优先榜之外的卡
  for (const ent of wb.multiplier.entities) {
    if (!topIds.has(ent.id) || ent.name.trim().endsWith('+')) continue
    ent.name = `${ent.name.trim()}+`
    for (const k of ['dmg', 'atk', 'chips', 'block', 'addMult']) {
      if (typeof ent.stats[k] === 'number' && ent.stats[k]! > 0) {
        ent.stats[k] = Math.round(ent.stats[k]! * 1.32)
      }
    }
    upgradedIds.add(ent.id)
  }

  return upgradedIds.size
}

// ───────────────────────────── 8. 超几何上手率精算 + 单回合斩杀序列求解 + Boss意图轴压测 + 版本快照A/B差分 ─────────────────────────────

export interface MxHypergeometricCardRow {
  cardId: string
  cardName: string
  copiesInDeck: number
  cost: number
  t1RawProbPct: number
  t1MulliganProbPct: number
  t2ProbPct: number
  t3ProbPct: number
  thin3GainPct: number
}

export interface MxHypergeometricDrawResult {
  deckSize: number
  drawPerTurn: number
  rows: MxHypergeometricCardRow[]
  comboPairLabel: string
  comboT1ProbPct: number
  comboT2ProbPct: number
  comboT3ProbPct: number
  comboThin3T3ProbPct: number
  onCurveT1Pct: number
  brickTurn1Pct: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function hypergeomChoose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  const m = Math.min(k, n - k)
  let res = 1
  for (let i = 1; i <= m; i++) {
    res = (res * (n - m + i)) / i
  }
  return res
}

function hypergeomAtLeastOne(deckSize: number, copies: number, drawn: number): number {
  const N = Math.max(1, deckSize)
  const K = Math.max(0, Math.min(N, copies))
  const n = Math.max(0, Math.min(N, drawn))
  if (K === 0 || n === 0) return 0
  if (n > N - K) return 1
  const pZero = hypergeomChoose(N - K, n) / Math.max(1, hypergeomChoose(N, n))
  return Math.max(0, Math.min(1, 1 - pZero))
}

function hypergeomBothAtLeastOne(
  deckSize: number,
  copiesA: number,
  copiesB: number,
  drawn: number
): number {
  const N = Math.max(2, deckSize)
  const KA = Math.max(1, Math.min(N - 1, copiesA))
  const KB = Math.max(1, Math.min(N - KA, copiesB))
  const n = Math.max(0, Math.min(N, drawn))
  if (n < 2) return 0
  const denom = Math.max(1, hypergeomChoose(N, n))
  const pNoA = hypergeomChoose(N - KA, n) / denom
  const pNoB = hypergeomChoose(N - KB, n) / denom
  const pNoAB = hypergeomChoose(Math.max(0, N - KA - KB), n) / denom
  return Math.max(0, Math.min(1, 1 - pNoA - pNoB + pNoAB))
}

/**
 * 1) 超几何分布：起手调度 (Mulligan) 与 Key 卡准时上手率 / 双卡 Combo 凑齐率精算器
 */
/** 公开：超几何 P(X ≥ 1)，牌库 N 张、目标 K 张、抽 n 张（供外部与已知答案测试使用） */
export function mxHypergeomAtLeastOne(deckSize: number, copies: number, drawn: number): number {
  return hypergeomAtLeastOne(deckSize, copies, drawn)
}

/** 公开：超几何容斥 P(A ≥ 1 且 B ≥ 1) */
export function mxHypergeomBothAtLeastOne(
  deckSize: number,
  copiesA: number,
  copiesB: number,
  drawn: number
): number {
  return hypergeomBothAtLeastOne(deckSize, copiesA, copiesB, drawn)
}

export function analyzeMxHypergeometricDrawAndComboOdds(
  wb: MxNumericalWorkbench
): MxHypergeometricDrawResult {
  const cards =
    wb.combatKernel.deckCards.length > 0
      ? wb.combatKernel.deckCards
      : wb.multiplier.entities.map((e, i) => ({
          id: e.id || `c_${i}`,
          name: e.name,
          cost: Math.max(0, Math.round(e.cost || 1)),
          count: e.rarity === 'legendary' || e.rarity === 'rare' ? 1 : 2,
          damage: Number(e.stats.dmg ?? e.stats.atk ?? e.stats.chips ?? 8),
          hits: 1,
          block: Number(e.stats.block ?? e.stats.hp ?? 0),
          draw: Number(e.stats.draw ?? 0),
          energyGain: 0,
          applyStrength: 0,
          applyVulnerable: 0,
          applyWeak: 0,
          exhaust: false,
          priority: 5
        }))

  const deckSize = Math.max(
    5,
    cards.reduce((s, c) => s + Math.max(1, c.count || 1), 0)
  )
  const drawPerTurn = Math.max(3, Math.min(10, wb.combatKernel.drawPerTurn || 5))
  const extraDrawPerTurn = Math.min(
    3,
    cards.reduce((s, c) => s + (c.draw || 0) * (c.count || 1), 0) / Math.max(1, deckSize)
  )
  const seenT1 = drawPerTurn
  const mulliganReplace = Math.min(3, Math.max(1, Math.floor(drawPerTurn * 0.6)))
  const seenT1Mulligan = Math.min(deckSize, seenT1 + mulliganReplace)
  const seenT2 = Math.min(deckSize, Math.round(seenT1 + drawPerTurn + extraDrawPerTurn))
  const seenT3 = Math.min(deckSize, Math.round(seenT1 + (drawPerTurn + extraDrawPerTurn) * 2))
  const thinDeckSize = Math.max(5, deckSize - 3)

  const rows: MxHypergeometricCardRow[] = cards.map((c) => {
    const k = Math.max(1, c.count || 1)
    const t1Raw = round2(hypergeomAtLeastOne(deckSize, k, seenT1) * 100)
    const t1Mul = round2(hypergeomAtLeastOne(deckSize, k, seenT1Mulligan) * 100)
    const t2 = round2(hypergeomAtLeastOne(deckSize, k, seenT2) * 100)
    const t3 = round2(hypergeomAtLeastOne(deckSize, k, seenT3) * 100)
    const t3Thin = round2(
      hypergeomAtLeastOne(thinDeckSize, k, Math.min(thinDeckSize, seenT3)) * 100
    )
    return {
      cardId: c.id,
      cardName: c.name,
      copiesInDeck: k,
      cost: c.cost,
      t1RawProbPct: t1Raw,
      t1MulliganProbPct: t1Mul,
      t2ProbPct: t2,
      t3ProbPct: t3,
      thin3GainPct: round2(Math.max(0, t3Thin - t3))
    }
  })

  // Select top 2 synergistic / highest-impact cards as key Combo pair
  const sortedForCombo = [...cards].sort(
    (a, b) =>
      b.damage * Math.max(1, b.hits ?? 1) +
      b.applyStrength * 10 +
      b.applyVulnerable * 8 +
      b.draw * 6 -
      (a.damage * Math.max(1, a.hits ?? 1) +
        a.applyStrength * 10 +
        a.applyVulnerable * 8 +
        a.draw * 6)
  )
  const cardA = sortedForCombo[0] ?? cards[0]
  const cardB = sortedForCombo[1] ?? sortedForCombo[0] ?? cards[0]
  const kA = Math.max(1, cardA?.count ?? 1)
  const kB = Math.max(1, cardB?.count ?? 1)
  const comboPairLabel =
    cardA && cardB && cardA.id !== cardB.id
      ? `${cardA.name} + ${cardB.name}`
      : `${cardA?.name ?? 'Key A'} ×2`

  const comboT1ProbPct = round2(hypergeomBothAtLeastOne(deckSize, kA, kB, seenT1Mulligan) * 100)
  const comboT2ProbPct = round2(hypergeomBothAtLeastOne(deckSize, kA, kB, seenT2) * 100)
  const comboT3ProbPct = round2(hypergeomBothAtLeastOne(deckSize, kA, kB, seenT3) * 100)
  const comboThin3T3ProbPct = round2(
    hypergeomBothAtLeastOne(thinDeckSize, kA, kB, Math.min(thinDeckSize, seenT3)) * 100
  )

  const playableT1Copies = cards
    .filter((c) => c.cost <= Math.max(1, wb.combatKernel.energyPerTurn || 3))
    .reduce((s, c) => s + Math.max(1, c.count || 1), 0)
  const onCurveT1Pct = round2(hypergeomAtLeastOne(deckSize, playableT1Copies, seenT1) * 100)
  const brickTurn1Pct = round2(Math.max(0, 100 - onCurveT1Pct))

  return {
    deckSize,
    drawPerTurn,
    rows,
    comboPairLabel,
    comboT1ProbPct,
    comboT2ProbPct,
    comboT3ProbPct,
    comboThin3T3ProbPct,
    onCurveT1Pct,
    brickTurn1Pct
  }
}

export interface MxSingleTurnLethalStep {
  stepIndex: number
  cardName: string
  costPaid: number
  effectDesc: string
  cumulativeDamage: number
}

export interface MxSingleTurnLethalResult {
  handCardNames: string[]
  availableEnergy: number
  naiveOrderDamage: number
  naiveSequenceLabel: string
  optimalLethalDamage: number
  optimalSequenceLabel: string
  optimalSteps: MxSingleTurnLethalStep[]
  skillGapRatio: number
  skillCeilingVerdict: 'high_skill_ceiling' | 'moderate_tactics' | 'flat_brainless'
  advisoryZh: string
  advisoryEn: string
}

/**
 * 2) 单回合最高斩杀线求解器 & 出牌顺序技巧深度评估 (Lethal Puzzle & Order-Sensitivity Solver)
 * 枚举手牌在能量约束下的所有合法出牌排列（Permutation），对比「先打伤害再上Buff的逆序乱出」与「回能➔易伤➔加攻➔多段终结的最优序列」。
 */
export function solveMxSingleTurnLethalAndOrderSkill(
  wb: MxNumericalWorkbench
): MxSingleTurnLethalResult {
  interface SimHandCard {
    id: string
    name: string
    cost: number
    damage: number
    hits: number
    energyGain: number
    applyStrength: number
    applyVulnerable: number
    xMult: number
  }

  const rawPool: SimHandCard[] =
    wb.combatKernel.deckCards.length > 0
      ? wb.combatKernel.deckCards.map((c) => ({
          id: c.id,
          name: c.name,
          cost: Math.max(0, c.cost),
          damage: Math.max(0, c.damage),
          hits: Math.max(1, c.hits || 1),
          energyGain: Math.max(0, c.energyGain || 0),
          applyStrength: Math.max(0, c.applyStrength || 0),
          applyVulnerable: Math.max(0, c.applyVulnerable || 0),
          xMult: Number(c.customStats?.xMult ?? c.customStats?.x_mult ?? 1)
        }))
      : wb.multiplier.entities.map((e, idx) => ({
          id: e.id || `h_${idx}`,
          name: e.name,
          cost: Math.max(0, Math.min(3, Math.round(e.cost || 1))),
          damage: Math.max(0, Number(e.stats.dmg ?? e.stats.atk ?? e.stats.chips ?? 8)),
          hits: Math.max(1, Number(e.stats.hits ?? 1)),
          energyGain: Math.max(0, Number(e.stats.nrg ?? e.stats.energyGain ?? 0)),
          applyStrength: Math.max(0, Number(e.stats.str ?? e.stats.addMult ?? 0)),
          applyVulnerable: Math.max(0, Number(e.stats.vuln ?? 0)),
          xMult: Math.max(1, Number(e.stats.xMult ?? 1))
        }))

  // Construct a 5-card tactical burst hand from the pool (prioritizing diverse roles)
  const hand: SimHandCard[] = []
  const pickOne = (pred: (c: SimHandCard) => boolean): void => {
    const found = rawPool.find((c) => !hand.some((h) => h.id === c.id) && pred(c))
    if (found && hand.length < 5) hand.push({ ...found })
  }
  pickOne((c) => c.energyGain > 0 || c.cost === 0)
  pickOne((c) => c.applyVulnerable > 0)
  pickOne((c) => c.applyStrength > 0 || c.xMult > 1)
  pickOne((c) => c.hits >= 2)
  for (const c of rawPool) {
    if (hand.length >= 5) break
    if (!hand.some((h) => h.id === c.id)) hand.push({ ...c })
  }
  while (hand.length > 0 && hand.length < 4) {
    const base = hand[hand.length - 1]!
    hand.push({ ...base, id: `${base.id}_dup_${hand.length}`, name: `${base.name}` })
  }

  // 注意：不再人为注入易伤/力量效果。若卡组本身全是平伤卡，则如实给出「出牌顺序无差异」的评级。

  const baseEnergy = Math.max(3, wb.combatKernel.energyPerTurn || 3)

  const evaluateOrdering = (
    order: SimHandCard[]
  ): { totalDmg: number; steps: MxSingleTurnLethalStep[]; seqLabel: string } => {
    let nrg = baseEnergy
    let str = 0
    let vuln = 0
    let runningXMult = 1
    let totalDmg = 0
    const steps: MxSingleTurnLethalStep[] = []
    for (const c of order) {
      if (c.cost > nrg) continue
      nrg = nrg - c.cost + c.energyGain
      str += c.applyStrength
      vuln += c.applyVulnerable
      if (c.xMult > 1) runningXMult *= c.xMult
      let cardDmg = 0
      if (c.damage > 0) {
        const perHit = (c.damage + str) * (vuln > 0 ? 1.5 : 1) * runningXMult
        cardDmg = Math.round(perHit * c.hits)
        totalDmg += cardDmg
      }
      steps.push({
        stepIndex: steps.length + 1,
        cardName: c.name,
        costPaid: c.cost,
        effectDesc: [
          c.energyGain > 0 ? `+${c.energyGain}NRG` : '',
          c.applyVulnerable > 0 ? `Vuln+${c.applyVulnerable}` : '',
          c.applyStrength > 0 ? `Str+${c.applyStrength}` : '',
          c.xMult > 1 ? `×${c.xMult}` : '',
          cardDmg > 0 ? `${cardDmg} DMG` : ''
        ]
          .filter(Boolean)
          .join(' · '),
        cumulativeDamage: totalDmg
      })
    }
    return {
      totalDmg,
      steps,
      seqLabel: steps.map((s) => s.cardName).join(' ➔ ') || '-'
    }
  }

  // Generate permutations of `hand` (up to 5! = 120 permutations)
  const perms: SimHandCard[][] = []
  const permute = (arr: SimHandCard[], m: SimHandCard[] = []): void => {
    if (arr.length === 0) {
      perms.push(m)
      return
    }
    for (let i = 0; i < arr.length; i++) {
      const curr = arr.slice()
      const next = curr.splice(i, 1)
      permute(curr, m.concat(next))
    }
  }
  permute(hand)

  let bestEval = evaluateOrdering(hand)
  let worstNonZeroEval = bestEval

  for (const p of perms) {
    const ev = evaluateOrdering(p)
    if (ev.totalDmg > bestEval.totalDmg) {
      bestEval = ev
    }
    if (
      ev.totalDmg > 0 &&
      (worstNonZeroEval.totalDmg === 0 || ev.totalDmg < worstNonZeroEval.totalDmg)
    ) {
      worstNonZeroEval = ev
    }
  }

  const skillGapRatio =
    worstNonZeroEval.totalDmg > 0 ? round2(bestEval.totalDmg / worstNonZeroEval.totalDmg) : 1
  const skillCeilingVerdict: MxSingleTurnLethalResult['skillCeilingVerdict'] =
    skillGapRatio >= 1.35
      ? 'high_skill_ceiling'
      : skillGapRatio >= 1.12
        ? 'moderate_tactics'
        : 'flat_brainless'

  const advisoryZh =
    skillCeilingVerdict === 'high_skill_ceiling'
      ? `✅ 操作深度极佳 (${skillGapRatio}x)：最优出牌序列比乱序出牌高出 ${Math.round((skillGapRatio - 1) * 100)}% 爆发伤害` // cjk-ok
      : skillCeilingVerdict === 'moderate_tactics'
        ? `ℹ️ 具备一定出牌顺序技巧 (${skillGapRatio}x)：建议增加「多段连击」或「独立乘区」卡放大顺序收益` // cjk-ok
        : `⚠️ 出牌顺序无显著差异 (${skillGapRatio}x)：卡牌同质化偏高，建议引入「易伤/回能/连击倍率」机制` // cjk-ok
  const advisoryEn =
    skillCeilingVerdict === 'high_skill_ceiling'
      ? `✅ High Skill Ceiling (${skillGapRatio}x): Optimal play sequence deals +${Math.round((skillGapRatio - 1) * 100)}% more burst than naive order`
      : skillCeilingVerdict === 'moderate_tactics'
        ? `ℹ️ Moderate order sensitivity (${skillGapRatio}x): Add multi-hit or ×Mult triggers to reward sequencing`
        : `⚠️ Flat sequencing (${skillGapRatio}x): Play order barely changes output; add Vulnerable/Energy/Combo hooks`

  return {
    handCardNames: hand.map((c) => c.name),
    availableEnergy: baseEnergy,
    naiveOrderDamage: worstNonZeroEval.totalDmg,
    naiveSequenceLabel: worstNonZeroEval.seqLabel,
    optimalLethalDamage: bestEval.totalDmg,
    optimalSequenceLabel: bestEval.seqLabel,
    optimalSteps: bestEval.steps,
    skillGapRatio,
    skillCeilingVerdict,
    advisoryZh,
    advisoryEn
  }
}

export interface MxBossIntentTurnRow {
  turn: number
  intentCode: 'buff_debuff' | 'heavy_slam' | 'status_pollution' | 'multi_hit_execute'
  intentNameZh: string
  intentNameEn: string
  incomingRawDmg: number
  expectedPlayerBlock: number
  netHpLoss: number
  spikeDeathRiskPct: number
  noteZh: string
  noteEn: string
}

export interface MxBossIntentTimelineResult {
  rows: MxBossIntentTurnRow[]
  maxSingleTurnNetLoss: number
  spikeDeathProbPct: number
  pollutedBrickRatePct: number
  postPollutionDpsDropPct: number
  survivalScore: number
}

/**
 * 3) Boss 4 回合意图循环轴 (Intent Timeline) 峰值暴毙率与塞废牌污染压测
 */
export function simulateMxBossIntentTimelineAndPollution(
  wb: MxNumericalWorkbench
): MxBossIntentTimelineResult {
  const baseDmg = Math.max(8, wb.combatKernel.enemyBaseDamage || 12)
  const cards = wb.combatKernel.deckCards
  const totalCopies = Math.max(
    5,
    cards.reduce((s, c) => s + Math.max(1, c.count || 1), 0)
  )
  const avgBlockPerCard =
    cards.reduce((s, c) => s + (c.block || 0) * (c.count || 1), 0) / totalCopies
  const expectedTurnBlock = Math.round(avgBlockPerCard * 2.4)

  const t1Dmg = Math.round(baseDmg * 0.75)
  const t1Block = expectedTurnBlock
  const t1Loss = Math.max(0, t1Dmg - t1Block)

  // Turn 2: Heavy Slam (2.25x base damage + Frail/Vulnerable penalty reducing effective block by 25%)
  const t2Dmg = Math.round(baseDmg * 2.25)
  const t2Block = Math.round(expectedTurnBlock * 0.75)
  const t2Loss = Math.max(0, t2Dmg - t2Block)
  const spikeDeathProbPct = round2(Math.min(95, Math.max(2, (t2Loss / 45) * 100)))

  // Turn 3: Boss shuffles 3 Status/Curse cards (Burn/Dazed/Slime) into draw pile
  const statusInjected = 3
  const pollutedDeckSize = totalCopies + statusInjected
  const drawPerTurn = Math.max(4, wb.combatKernel.drawPerTurn || 5)
  const probDrawAtLeastOneStatus = hypergeomAtLeastOne(
    pollutedDeckSize,
    statusInjected,
    drawPerTurn
  )
  const pollutedBrickRatePct = round2(probDrawAtLeastOneStatus * 100)
  const postPollutionDpsDropPct = round2(Math.min(60, (statusInjected / pollutedDeckSize) * 145))
  const t3Dmg = Math.round(baseDmg * 1.1)
  const t3Block = Math.round(expectedTurnBlock * (1 - statusInjected / pollutedDeckSize))
  const t3Loss = Math.max(0, t3Dmg - t3Block)

  // Turn 4: Multi-hit Execute (4 hits x 0.48x baseDmg) after deck pollution
  const perHit = Math.max(3, Math.round(baseDmg * 0.48))
  const t4Dmg = perHit * 4
  const t4Block = t3Block
  const t4Loss = Math.max(0, t4Dmg - t4Block)
  const t4Risk = round2(Math.min(95, Math.max(4, ((t2Loss + t4Loss) / 65) * 100)))

  const rows: MxBossIntentTurnRow[] = [
    {
      turn: 1,
      intentCode: 'buff_debuff',
      intentNameZh: 'T1 蓄力咆哮 + 施加脆弱/易伤', // cjk-ok
      intentNameEn: 'T1 Roar + Apply Frail & Vulnerable',
      incomingRawDmg: t1Dmg,
      expectedPlayerBlock: t1Block,
      netHpLoss: t1Loss,
      spikeDeathRiskPct: round2(Math.min(35, (t1Loss / 50) * 100)),
      noteZh: '下回合玩家护甲获取降低 25%，Boss 准备重击', // cjk-ok
      noteEn: 'Player Block reduced by 25% next turn; Boss charges Slam'
    },
    {
      turn: 2,
      intentCode: 'heavy_slam',
      intentNameZh: 'T2 蓄力重击 (225% 峰值斩杀检定)', // cjk-ok
      intentNameEn: 'T2 Heavy Slam (225% Spike Check)',
      incomingRawDmg: t2Dmg,
      expectedPlayerBlock: t2Block,
      netHpLoss: t2Loss,
      spikeDeathRiskPct: spikeDeathProbPct,
      noteZh:
        t2Loss >= 18
          ? `🚨 护甲缺口高达 ${t2Loss} 点，极易在此回合满血暴毙！` // cjk-ok
          : `✅ 护甲厚度可扛住 T2 重击峰值`, // cjk-ok
      noteEn:
        t2Loss >= 18
          ? `🚨 Block shortfall of ${t2Loss} HP — high spike-death risk!`
          : `✅ Block density survives T2 Heavy Slam`
    },
    {
      turn: 3,
      intentCode: 'status_pollution',
      intentNameZh: 'T3 塞入 3 张【眩晕/灼烧】污染牌库', // cjk-ok
      intentNameEn: 'T3 Inject 3x [Dazed / Burn] Status Bricks',
      incomingRawDmg: t3Dmg,
      expectedPlayerBlock: t3Block,
      netHpLoss: t3Loss,
      spikeDeathRiskPct: round2(Math.min(60, ((t2Loss + t3Loss) / 60) * 100)),
      noteZh: `摸到废牌概率 ${pollutedBrickRatePct}%，全套输出下滑 -${postPollutionDpsDropPct}%`, // cjk-ok
      noteEn: `${pollutedBrickRatePct}% chance to draw Status brick; DPS drops -${postPollutionDpsDropPct}%`
    },
    {
      turn: 4,
      intentCode: 'multi_hit_execute',
      intentNameZh: `T4 狂暴四连击 (${perHit}×4 多段处决)`, // cjk-ok
      intentNameEn: `T4 Frenzy 4-Hit Execute (${perHit}×4)`,
      incomingRawDmg: t4Dmg,
      expectedPlayerBlock: t4Block,
      netHpLoss: t4Loss,
      spikeDeathRiskPct: t4Risk,
      noteZh: '多段伤害击穿单次格挡缓冲，考验被污染后的持续过牌与护甲', // cjk-ok
      noteEn: 'Multi-hit pierces single-hit buffers after draw pile pollution'
    }
  ]

  const maxSingleTurnNetLoss = Math.max(t1Loss, t2Loss, t3Loss, t4Loss)
  const survivalScore = Math.max(
    10,
    Math.min(100, Math.round(100 - spikeDeathProbPct * 0.55 - postPollutionDpsDropPct * 0.45))
  )

  return {
    rows,
    maxSingleTurnNetLoss,
    spikeDeathProbPct,
    pollutedBrickRatePct,
    postPollutionDpsDropPct,
    survivalScore
  }
}

export interface MxWorkbenchEntityDiffRow {
  entityId: string
  name: string
  beforeSummary: string
  afterSummary: string
  verdictBefore: string
  verdictAfter: string
}

export interface MxWorkbenchSnapshotDiffResult {
  winRateBaseline: number
  winRateCurrent: number
  winRateDeltaPct: number
  ttkBaseline: number
  ttkCurrent: number
  ttkDeltaTurns: number
  finalOutputBaseline: number
  finalOutputCurrent: number
  finalOutputDeltaPct: number
  clearRateBaseline: number
  clearRateCurrent: number
  clearRateDeltaPct: number
  opCountBaseline: number
  opCountCurrent: number
  entityDiffs: MxWorkbenchEntityDiffRow[]
}

/**
 * 4) 版本补丁前/后快照 A/B 差分对比仪 (Balance Patch Snapshot Diff: v1.0 Baseline vs v1.1 Current)
 */
export function computeMxWorkbenchSnapshotDiff(
  baseline: MxNumericalWorkbench,
  current: MxNumericalWorkbench
): MxWorkbenchSnapshotDiffResult {
  const baseCombat = runMxCombatKernelSimulation({ ...baseline.combatKernel, runs: 160 })
  const curCombat = runMxCombatKernelSimulation({ ...current.combatKernel, runs: 160 })

  const baseMult = analyzeMultiplierPipeline(baseline.multiplier, 10)
  const curMult = analyzeMultiplierPipeline(current.multiplier, 10)

  const baseEnv = runMxRoguelikeEnvelopeSimulation({ ...baseline.roguelikeEnvelope, runs: 140 })
  const curEnv = runMxRoguelikeEnvelopeSimulation({ ...current.roguelikeEnvelope, runs: 140 })

  const opCountBaseline = baseMult.entityAudits.filter((a) => a.verdict === 'overpowered').length
  const opCountCurrent = curMult.entityAudits.filter((a) => a.verdict === 'overpowered').length

  const entityDiffs: MxWorkbenchEntityDiffRow[] = []
  // 按实体 ID 对齐（ID 缺失时退化为名称），避免增删卡后按下标错位对比
  const keyOf = (e: { id: string; name: string }): string => e.id || `name:${e.name}`
  const baseIdx = new Map<string, number>()
  baseline.multiplier.entities.forEach((e, i) => baseIdx.set(keyOf(e), i))
  const curIdx = new Map<string, number>()
  current.multiplier.entities.forEach((e, i) => curIdx.set(keyOf(e), i))
  const orderedKeys: string[] = [
    ...current.multiplier.entities.map(keyOf),
    ...baseline.multiplier.entities.map(keyOf).filter((k) => !curIdx.has(k))
  ]
  for (const key of orderedKeys) {
    const bi = baseIdx.get(key)
    const ci = curIdx.get(key)
    const bEnt = bi !== undefined ? baseline.multiplier.entities[bi] : undefined
    const cEnt = ci !== undefined ? current.multiplier.entities[ci] : undefined
    const bAud = bi !== undefined ? baseMult.entityAudits[bi] : undefined
    const cAud = ci !== undefined ? curMult.entityAudits[ci] : undefined
    if (!bEnt && cEnt) {
      entityDiffs.push({
        entityId: cEnt.id,
        name: cEnt.name,
        beforeSummary: '(New)',
        afterSummary: `Cost ${cEnt.cost} · Act ${cAud?.actualValue ?? 0}`,
        verdictBefore: '-',
        verdictAfter: cAud?.verdict ?? 'balanced'
      })
    } else if (bEnt && !cEnt) {
      entityDiffs.push({
        entityId: bEnt.id,
        name: bEnt.name,
        beforeSummary: `Cost ${bEnt.cost} · Act ${bAud?.actualValue ?? 0}`,
        afterSummary: '(Removed)',
        verdictBefore: bAud?.verdict ?? 'balanced',
        verdictAfter: '-'
      })
    } else if (bEnt && cEnt) {
      const bAct = bAud?.actualValue ?? 0
      const cAct = cAud?.actualValue ?? 0
      if (bEnt.cost !== cEnt.cost || Math.abs(bAct - cAct) > 0.05 || bEnt.name !== cEnt.name) {
        entityDiffs.push({
          entityId: cEnt.id,
          name: cEnt.name,
          beforeSummary: `${bEnt.name} (${bEnt.cost}C · Val ${bAct})`,
          afterSummary: `${cEnt.name} (${cEnt.cost}C · Val ${cAct})`,
          verdictBefore: bAud?.verdict ?? 'balanced',
          verdictAfter: cAud?.verdict ?? 'balanced'
        })
      }
    }
  }

  return {
    winRateBaseline: baseCombat.winRatePct,
    winRateCurrent: curCombat.winRatePct,
    winRateDeltaPct: round2(curCombat.winRatePct - baseCombat.winRatePct),
    ttkBaseline: baseCombat.ttkP50,
    ttkCurrent: curCombat.ttkP50,
    ttkDeltaTurns: round2(curCombat.ttkP50 - baseCombat.ttkP50),
    finalOutputBaseline: baseMult.finalOutput,
    finalOutputCurrent: curMult.finalOutput,
    finalOutputDeltaPct:
      baseMult.finalOutput > 0
        ? round2(((curMult.finalOutput - baseMult.finalOutput) / baseMult.finalOutput) * 100)
        : 0,
    clearRateBaseline: baseEnv.firstRunClearRatePct,
    clearRateCurrent: curEnv.firstRunClearRatePct,
    clearRateDeltaPct: round2(curEnv.firstRunClearRatePct - baseEnv.firstRunClearRatePct),
    opCountBaseline,
    opCountCurrent,
    entityDiffs
  }
}

/**
 * 将数值工作台（角色成长乘区、等级突破阶梯、反派膨胀卡点墙、打脸底牌配表与最优连招序列）
 * 导出为可直接喂给 `asset.screenplay`（剧本生成节点）的高信噪比叙事与角色成长数值大纲。
 */
export function exportMxNarrativeProgressionBrief(
  wb: MxNumericalWorkbench,
  docMeta?: {
    title?: string
    description?: string
    nodes?: Array<{ label?: string; kind?: string }>
  }
): string {
  const multRes = analyzeMultiplierPipeline(wb.multiplier)
  const envRes = runMxRoguelikeEnvelopeSimulation({
    ...wb.roguelikeEnvelope,
    runs: Math.min(200, Math.max(60, wb.roguelikeEnvelope.runs || 120))
  })
  const lvRes = generateMxLevelProgressionTable(wb.roguelikeEnvelope)
  const lethalRes = solveMxSingleTurnLethalAndOrderSkill(wb)
  const lootRes = runMxLootAndSubstatSimulation({
    ...wb.lootRoll,
    runs: Math.min(200, Math.max(60, wb.lootRoll.runs || 120))
  })
  const bestMarginalAttr =
    multRes.marginalReturns.find((m) => m.isOptimalNextPick)?.attrName ?? 'N/A'

  const bossFloors = envRes.floorSeries.filter((f) => f.isBoss).map((f) => f.floor)
  const wallFloors = envRes.difficultyWallFloors
  const customTitle =
    docMeta?.title && docMeta.title !== '游戏经济系统' && docMeta.title !== '经济系统' // cjk-ok
      ? `${docMeta.title} · ${wb.multiplier.title}`
      : wb.multiplier.title
  const canvasNodesSummary = (docMeta?.nodes ?? [])
    .map((n) => n.label?.trim())
    .filter((l): l is string => Boolean(l))
    .join(' ➔ ')

  const lines: string[] = [
    `# 【角色成长体系与分集高潮冲突数值大纲 (Character Progression & Narrative Pacing Brief)】`, // cjk-ok
    `- **体系名称**: ${customTitle}`, // cjk-ok
    ...(docMeta?.description ? [`- **核心爽点闭环**: ${docMeta.description}`] : []), // cjk-ok
    ...(canvasNodesSummary ? [`- **宏观剧情流转节点**: ${canvasNodesSummary}`] : []), // cjk-ok
    `- **高潮结局目标战力峰值**: \`${multRes.finalOutput}\` (结算公式: \`${wb.multiplier.finalFormula}\` · 边际收益最高属性: \`${bestMarginalAttr}\`)`, // cjk-ok
    ``,
    `## 1. 主角核心成长维度与乘区公式 (Character Stat & Multiplier Architecture)`, // cjk-ok
    ...wb.multiplier.attributes.map(
      (a) => `- **${a.name}** (${a.label}): 基准值 \`${a.value}\` (范围 \`${a.min}~${a.max}\`)` // cjk-ok
    ),
    ...wb.multiplier.stages.map((s) => `- **阶段结算 [${s.name}]**: \`${s.formula}\``), // cjk-ok
    ``,
    `## 2. 角色等级/集数突破里程碑阶梯 (Lv.1 ~ Lv.${lvRes.maxLevel} Breakthrough Milestones)`, // cjk-ok
    `- **突破周期**: 每 \`${lvRes.ascensionInterval}\` 级/集迎来一次大境界或身份蜕变 (★) · 全周期属性成长倍率 \`${lvRes.statMultiplierTotal}x\``, // cjk-ok
    `| 阶段节点 (Lv/集) | 身份蜕变阶位 | 气场/底蕴 (HP) | 实力/打脸战力 (ATK) | 护城河/背景 (DEF) | 累计爽点/资源需求 |`, // cjk-ok
    `| :---: | :---: | :---: | :---: | :---: | :---: |`,
    ...lvRes.milestones.map(
      (r) =>
        `| Lv.${r.level}${r.isBreakthrough ? ' ★突破' : ''} | Stage ${r.ascensionStage} | ${r.hp} | ${r.atk} | ${r.def} | XP ${r.cumulativeXp} / Gold ${r.goldCost} |` // cjk-ok
    ),
    ``,
    `## 3. 分幕反派实力膨胀曲线、受辱压迫墙与付费高潮卡点 (Episode Conflict & Climax Paywall Beats)`, // cjk-ok
    `- **总幕数/节点数**: \`${wb.roguelikeEnvelope.floors}\` 幕 · **大高潮 Boss 节点**: 第 \`${bossFloors.join(', ') || '-'}\` 幕 · **战力受阻/付费反转卡点幕 (Difficulty Walls)**: 第 \`${wallFloors.join(', ') || '无明显卡死'}\` 幕`, // cjk-ok
    ...envRes.floorSeries.map((f) => {
      const tag = f.isBoss
        ? '🔥【大高潮Boss战/终极审判】' // cjk-ok
        : wallFloors.includes(f.floor)
          ? '⚠️【反派压制墙/付费反转卡点】' // cjk-ok
          : '📈【日常冲突推进】' // cjk-ok
      return `- **第 ${f.floor} 幕** ${tag}: 主角战力中位 \`${f.playerP50}\` (P10 \`${f.playerP10}\` ~ P90 \`${f.playerP90}\`) vs 反派压迫门槛 \`${f.enemyPower}\` · 正面碾压率 \`${f.survivalRatePct}%\`` // cjk-ok
    }),
    ``,
    `## 4. 主角底牌配表与名场面最优打脸出牌序列 (Trump Cards & Optimal Climax Sequence)`, // cjk-ok
    `- **高潮单回合最优连招序列**: \`${lethalRes.optimalSequenceLabel}\` (最优爆发伤害 \`${lethalRes.optimalLethalDamage}\` vs 乱序平庸出牌 \`${lethalRes.naiveOrderDamage}\`，爽感放大倍率 \`${lethalRes.skillGapRatio}x\`)`, // cjk-ok
    ...lethalRes.optimalSteps.map(
      (s) =>
        `  ${s.stepIndex}. 亮出底牌【${s.cardName}】(耗能 ${s.costPaid}) ➔ ${s.effectDesc || '铺垫蓄势'} (累计爆发: ${s.cumulativeDamage})` // cjk-ok
    ),
    ``,
    `### 底牌与反转技能强度清单`, // cjk-ok
    ...wb.multiplier.entities.map((ent, idx) => {
      const audit = multRes.entityAudits[idx]
      const statsStr = Object.entries(ent.stats)
        .filter(([, v]) => Number(v) !== 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')
      return `- **${ent.name}** [稀有度:${ent.rarity} · 铺垫消耗:${ent.cost}]: 属性(${statsStr}) · 实测战力价值 \`${audit?.actualValue ?? 0}\` (${audit?.verdict ?? 'balanced'})` // cjk-ok
    }),
    ``,
    `## 5. 奇遇机缘池与保底反转节奏 (Key Encounters & Pity Trigger Rhythm)`, // cjk-ok
    `- **保底爆发节奏**: 第 \`${wb.lootRoll.softPityStart}\` 集/次进入高能升温期，第 \`${wb.lootRoll.hardPityPull}\` 集/次硬保底必出终极金手指反转 (实测中位 \`${lootRes.attemptsP50}\` 次触发)`, // cjk-ok
    ...wb.lootRoll.draftPool.map(
      (d) =>
        `- **机缘/人脉【${d.name}】** (${d.rarity}): 基础战力 \`+${d.addPower}\` · 身份乘区 \`×${d.multPower}\`${d.prerequisiteIds?.length ? ` (前置条件: ${d.prerequisiteIds.join(', ')})` : ''}` // cjk-ok
    )
  ]

  return lines.join('\n')
}

export interface MxChapterNumericalSlice {
  chapterIndex: number
  totalChapters: number
  volumeIndex: number
  totalVolumes: number
  volumeChapterRange: [number, number]
  volumeTitleZh: string
  arcIndex: number
  totalArcs: number
  arcChapterRange: [number, number]
  chapterBeatType:
    'setup_endure' | 'encounter_growth' | 'villain_suppression_cliffhanger' | 'climax_reversal_slap'
  chapterBeatLabelZh: string
  realmStageIndex: number
  realmStageLabelZh: string
  isBreakthroughChapter: boolean
  protagonistHp: number
  protagonistAtk: number
  protagonistDef: number
  powerCeiling: number
  villainPressure: number
  survivalRatePct: number
  isBossArc: boolean
  isDifficultyWallArc: boolean
  allowedTrumpCards: string[]
  lockedEndgameTrumps: string[]
  recommendedEncounterItem: string
  /** 小说流派 ID（未指定流派时为 undefined，沿用都市逆袭语义） */
  genreId?: string
  /** 流派语义：阶段术语 / 主角成长轴 / 阻力轴 / 解锁物术语 */
  stageTermZh?: string
  protagonistAxisZh?: string
  antagonistAxisZh?: string
  unlockTermZh?: string
  sliceMarkdown: string
}

const PRISTINE_PRESET_ENTITY_IDS = new Map<string, string>()

/**
 * 经济系统是否仍为「未修改实体配表」的内置预设：
 * 是则小说流派可以用自身的解锁物 / 奇遇池替代游戏卡牌名称；
 * 用户自定义过实体后则尊重用户配表。
 */
export function isMxWorkbenchPristinePreset(wb: MxNumericalWorkbench): boolean {
  const presetId = wb.activePresetId
  let sig = PRISTINE_PRESET_ENTITY_IDS.get(presetId)
  if (sig === undefined) {
    sig = createMxWorkbenchPreset(presetId)
      .multiplier.entities.map((e) => e.id)
      .join('|')
    PRISTINE_PRESET_ENTITY_IDS.set(presetId, sig)
  }
  return wb.multiplier.entities.map((e) => e.id).join('|') === sig
}

function usesGenreItems(
  wb: MxNumericalWorkbench,
  genre?: NovelGenreProfile
): genre is NovelGenreProfile {
  return Boolean(genre && genre.id !== 'urban_reversal' && isMxWorkbenchPristinePreset(wb))
}

/**
 * 动态总章数下的单章数值时钟切片器（Dynamic Chapter-Indexed Numerical Quota Lock）：
 * 根据用户动态设定的总章节数 `totalChapters`（不写死，支持 20 ~ 5000+ 章任意动态调整）与当前章号 `chapterIndex`，
 * 自动解算本章所属的大卷篇章、冲突幕次、境界战力天花板、反派施压阈值、本章剧情节拍定位、准入底牌白名单与封存底牌黑名单，
 * 从源头杜绝长篇逐章连载时的「前期战力崩坏」与「过早亮出终局底牌」。
 */
export function exportMxChapterNumericalSlice(
  wb: MxNumericalWorkbench,
  chapterIndex: number,
  totalChapters?: number,
  genre?: NovelGenreProfile
): MxChapterNumericalSlice {
  const dynTotal = Math.max(
    1,
    Math.min(5000, Math.round(totalChapters || wb.roguelikeEnvelope.levelMax || 800))
  )
  const curChap = Math.max(1, Math.min(dynTotal, Math.round(chapterIndex || 1)))

  const totalVolumes =
    dynTotal <= 60
      ? Math.max(2, Math.ceil(dynTotal / 15))
      : dynTotal <= 160
        ? Math.max(3, Math.ceil(dynTotal / 20))
        : Math.min(12, Math.max(4, Math.round(dynTotal / 100)))
  const chaptersPerVolume = Math.max(1, Math.ceil(dynTotal / totalVolumes))
  const volumeIndex = Math.min(totalVolumes, Math.floor((curChap - 1) / chaptersPerVolume) + 1)
  const volumeStart = (volumeIndex - 1) * chaptersPerVolume + 1
  const volumeEnd = Math.min(dynTotal, volumeIndex * chaptersPerVolume)

  const VOLUME_THEMES_ZH = genre?.volumeThemesZh?.length
    ? genre.volumeThemesZh
    : [
        '潜龙在渊 · 基层受辱与微末觉醒', // cjk-ok
        '锋芒初露 · 本土豪门洗牌与立威', // cjk-ok
        '省域争锋 · 权贵围剿与底蕴扩张', // cjk-ok
        '名震一方 · 跨界巨擘博弈与破壁', // cjk-ok
        '巅峰暗涌 · 隐世财阀与禁区交锋', // cjk-ok
        '只手遮天 · 顶级秩序重构与清算', // cjk-ok
        '举世皆惊 · 终极宿敌总决战前夜', // cjk-ok
        '万流归宗 · 登顶至尊与终局大审判' // cjk-ok
      ]
  const themeIdx = Math.min(
    VOLUME_THEMES_ZH.length - 1,
    Math.floor(((volumeIndex - 1) / Math.max(1, totalVolumes - 1)) * (VOLUME_THEMES_ZH.length - 1))
  )
  const volumeTitleZh = `第 ${volumeIndex} 卷【${VOLUME_THEMES_ZH[themeIdx]}】(第 ${volumeStart}~${volumeEnd} 章)` // cjk-ok

  const totalArcs = Math.max(4, wb.roguelikeEnvelope.floors || 16)
  const arcIndex = Math.min(
    totalArcs,
    Math.max(1, Math.floor(((curChap - 1) / Math.max(1, dynTotal)) * totalArcs) + 1)
  )
  const arcStart = Math.max(1, Math.floor(((arcIndex - 1) * dynTotal) / totalArcs) + 1)
  const arcEnd = Math.min(
    dynTotal,
    Math.max(arcStart, Math.floor((arcIndex * dynTotal) / totalArcs))
  )
  const arcSpan = Math.max(1, arcEnd - arcStart + 1)
  const progressInArc = arcSpan <= 1 ? 1 : (curChap - arcStart) / (arcSpan - 1)

  let chapterBeatType: MxChapterNumericalSlice['chapterBeatType'] = 'setup_endure'
  let chapterBeatLabelZh =
    '起势铺垫与隐忍蓄势期（铺垫冲突导火索、主角隐忍布局、严禁提前亮底牌秒杀）' // cjk-ok
  if (progressInArc >= 0.82 || (curChap === arcEnd && arcSpan > 1)) {
    chapterBeatType = 'climax_reversal_slap'
    chapterBeatLabelZh =
      '本幕高潮亮底牌与身份审判打脸期（按最优连招亮出本阶段准入底牌，彻底碾压本幕反派）' // cjk-ok
  } else if (progressInArc >= 0.55) {
    chapterBeatType = 'villain_suppression_cliffhanger'
    chapterBeatLabelZh =
      '反派极限施压与绝境卡点期（反派动用底牌将主角逼入绝境，章末必须留高能反转悬念钩子）' // cjk-ok
  } else if (progressInArc >= 0.25) {
    chapterBeatType = 'encounter_growth'
    chapterBeatLabelZh =
      '机缘获取与小试牛刀期（触发奇遇/人脉信物、局部小反击立威，引出幕后真正主使）' // cjk-ok
  }
  if (genre) {
    chapterBeatLabelZh = genre.beats[chapterBeatType].labelZh
  }

  const scaledEnvCfg: MxRoguelikeEnvelopeConfig = {
    ...wb.roguelikeEnvelope,
    levelMax: dynTotal,
    runs: Math.min(160, Math.max(60, wb.roguelikeEnvelope.runs || 100))
  }
  const lvRes = generateMxLevelProgressionTable(scaledEnvCfg)
  const envRes = runMxRoguelikeEnvelopeSimulation(scaledEnvCfg)
  const lvRow =
    lvRes.rows[Math.min(lvRes.rows.length - 1, Math.max(0, curChap - 1))] ?? lvRes.rows[0]!
  const arcRow =
    envRes.floorSeries[Math.min(envRes.floorSeries.length - 1, Math.max(0, arcIndex - 1))] ??
    envRes.floorSeries[0]!
  const prevArcRow =
    arcIndex > 1
      ? (envRes.floorSeries[arcIndex - 2] ?? arcRow)
      : { ...arcRow, playerP50: Math.round(arcRow.playerP50 * 0.75) }

  const powerCeiling = Math.round(
    prevArcRow.playerP50 + (arcRow.playerP50 - prevArcRow.playerP50) * progressInArc
  )
  const villainPressure = arcRow.enemyPower
  const isBossArc = Boolean(arcRow.isBoss)
  const isDifficultyWallArc = envRes.difficultyWallFloors.includes(arcRow.floor)

  const REALM_NAMES_ZH = genre?.stageNamesZh?.length
    ? genre.stageNamesZh
    : [
        '第 0 阶·微末蛰伏期', // cjk-ok
        '第 1 阶·初醒立威期', // cjk-ok
        '第 2 阶·堂口掌权期', // cjk-ok
        '第 3 阶·豪门座上宾', // cjk-ok
        '第 4 阶·商界操盘手', // cjk-ok
        '第 5 阶·省域巨头期', // cjk-ok
        '第 6 阶·隐世掌舵人', // cjk-ok
        '第 7 阶·执棋造浪者', // cjk-ok
        '第 8 阶·当世无冕王' // cjk-ok
      ]
  const realmStageIndex = lvRow.ascensionStage
  const realmStageLabelZh =
    REALM_NAMES_ZH[Math.min(REALM_NAMES_ZH.length - 1, realmStageIndex)] ??
    `第 ${realmStageIndex} 阶·蜕变境` // cjk-ok

  const rarityRank: Record<string, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    legendary: 4
  }
  const sortedEntities = usesGenreItems(wb, genre)
    ? genre.unlockItemsZh.map((name, i) => ({ name, rarity: 'common', cost: i }))
    : [...wb.multiplier.entities].sort(
        (a, b) => (rarityRank[a.rarity] ?? 1) - (rarityRank[b.rarity] ?? 1) || a.cost - b.cost
      )
  const globalRatio = curChap / Math.max(1, dynTotal)
  const unlockCount = Math.max(
    1,
    Math.min(
      sortedEntities.length,
      Math.ceil(sortedEntities.length * Math.max(0.25, Math.min(1, globalRatio + 0.2)))
    )
  )
  const allowedTrumpCards = sortedEntities.slice(0, unlockCount).map((e) => e.name)
  const lockedEndgameTrumps = sortedEntities.slice(unlockCount).map((e) => e.name)

  const pool: Array<{ name: string }> = usesGenreItems(wb, genre)
    ? genre.encounterItemsZh.map((name) => ({ name }))
    : wb.lootRoll.draftPool
  const recommendedEncounterItem =
    pool.length > 0 ? pool[(curChap + arcIndex - 2) % pool.length]!.name : '关键机缘信物' // cjk-ok

  const sliceLines: string[] = [
    `## 🎯 【第 ${curChap} / ${dynTotal} 章 · 单章数值围栏与底牌配额锁 (Chapter ${curChap}/${dynTotal} Numerical Quota Lock)】`, // cjk-ok
    `- **全书连载总进度**: 第 \`${curChap}\` 章 / 动态总章数 \`${dynTotal}\` 章 (${Math.round(globalRatio * 1000) / 10}%)`, // cjk-ok
    `- **所属大卷篇章**: ${volumeTitleZh}`, // cjk-ok
    `- **所属冲突单元**: 第 \`${arcIndex}/${totalArcs}\` 幕 (覆盖第 \`${arcStart}~${arcEnd}\` 章 · 本章为幕内第 \`${curChap - arcStart + 1}/${arcSpan}\` 章)${isBossArc ? ' 🔥【本幕为大高潮Boss决战幕】' : isDifficultyWallArc ? ' ⚠️【本幕为反派高压受挫反转幕】' : ''}`, // cjk-ok
    `- **本章戏剧节拍指令**: **${chapterBeatLabelZh}** (\`${chapterBeatType}\`)`, // cjk-ok
    `- **本章战力与境界天花板 (严禁越界)**: 主角当前境界 **${realmStageLabelZh}**${lvRow.isBreakthrough ? ' ★【本章触发大境界/新身份蜕变突破！】' : ''} · 气场底蕴(HP) \`${lvRow.hp}\` / 实力(ATK) \`${lvRow.atk}\` / 护城河(DEF) \`${lvRow.def}\` · **本章战力发挥上限 \`${powerCeiling}\`** vs **本幕反派压迫阈值 \`${villainPressure}\`** (正面胜算 \`${arcRow.survivalRatePct}%\`)`, // cjk-ok
    `- **✅ 本章准入可用底牌/手段 (Allowed Trumps)**: ${allowedTrumpCards.length ? allowedTrumpCards.map((c) => `【${c}】`).join('、') : '基础隐忍与话术周旋'}`, // cjk-ok
    `- **🔒 封存禁用的后期终局底牌 (Locked Trumps — 本章严禁提前亮出)**: ${lockedEndgameTrumps.length ? lockedEndgameTrumps.map((c) => `【${c}】`).join('、') : '已全部解锁（终局决战阶段）'}`, // cjk-ok
    `- **🎁 本章推荐埋设/触发的奇遇与伏笔信物**: 【${recommendedEncounterItem}】`, // cjk-ok
    ...(genre
      ? [
          `- **📖 流派语义映射 (${genre.labelZh})**: 「境界」=${genre.stageTermZh}；「战力」=${genre.protagonistAxisZh}；「反派压迫」=${genre.antagonistAxisZh}；「底牌」=${genre.unlockTermZh}；「奇遇信物」=${genre.encounterTermZh}` // cjk-ok
        ]
      : [])
  ]

  return {
    chapterIndex: curChap,
    totalChapters: dynTotal,
    volumeIndex,
    totalVolumes,
    volumeChapterRange: [volumeStart, volumeEnd],
    volumeTitleZh,
    arcIndex,
    totalArcs,
    arcChapterRange: [arcStart, arcEnd],
    chapterBeatType,
    chapterBeatLabelZh,
    realmStageIndex,
    realmStageLabelZh,
    isBreakthroughChapter: lvRow.isBreakthrough,
    protagonistHp: lvRow.hp,
    protagonistAtk: lvRow.atk,
    protagonistDef: lvRow.def,
    powerCeiling,
    villainPressure,
    survivalRatePct: arcRow.survivalRatePct,
    isBossArc,
    isDifficultyWallArc,
    allowedTrumpCards,
    lockedEndgameTrumps,
    recommendedEncounterItem,
    ...(genre
      ? {
          genreId: genre.id,
          stageTermZh: genre.stageTermZh,
          protagonistAxisZh: genre.protagonistAxisZh,
          antagonistAxisZh: genre.antagonistAxisZh,
          unlockTermZh: genre.unlockTermZh
        }
      : {}),
    sliceMarkdown: sliceLines.join('\n')
  }
}

export interface UnwrapEconomyNarrativeOptions {
  currentChapter?: number
  totalChapters?: number
  targetWordsPerChapter?: number
  genre?: NovelGenreProfile
}

/**
 * 若上游传入文本为 `game.economy` 节点的 `machinations_economy_bundle`（或工作台 JSON），
 * 自动提取/合成为结构化的【角色成长体系与分集高潮冲突数值大纲】；
 * 若同时传入 `options.currentChapter` 与动态 `options.totalChapters`，
 * 则自动将等级与突破阶梯缩放至 `totalChapters`，并追加精准的【第 N/Total 章 · 单章数值围栏与底牌配额锁】。
 */
export function unwrapEconomyBundleForNarrative(
  rawText: string,
  options?: UnwrapEconomyNarrativeOptions
): string {
  const trimmed = (rawText ?? '').trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return rawText
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    let wb: MxNumericalWorkbench | null = null
    let docMeta: {
      title?: string
      description?: string
      nodes?: Array<{ label?: string; kind?: string }>
    } = {}

    if (parsed.kind === 'machinations_economy_bundle') {
      const docObj = parsed.document as
        | {
            title?: string
            description?: string
            nodes?: Array<{ label?: string; kind?: string }>
            workbench?: unknown
          }
        | undefined
      if (docObj?.workbench) {
        wb = normalizeMxNumericalWorkbench(docObj.workbench)
        docMeta = docObj
      } else if (
        typeof parsed.narrativeProgressionBrief === 'string' &&
        parsed.narrativeProgressionBrief.trim()
      ) {
        return parsed.narrativeProgressionBrief.trim()
      }
    } else if (parsed.schemaVersion === 2 && Array.isArray(parsed.nodes) && parsed.workbench) {
      wb = normalizeMxNumericalWorkbench(parsed.workbench)
      docMeta = {
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        nodes: parsed.nodes as Array<{ label?: string; kind?: string }>
      }
    }

    if (wb) {
      const dynTotal =
        options?.totalChapters && options.totalChapters >= 1
          ? Math.min(5000, Math.round(options.totalChapters))
          : undefined
      const effectiveWb: MxNumericalWorkbench = dynTotal
        ? {
            ...wb,
            roguelikeEnvelope: {
              ...wb.roguelikeEnvelope,
              levelMax: dynTotal
            }
          }
        : wb

      const macroBrief = exportMxNarrativeProgressionBrief(effectiveWb, docMeta)
      if (options?.currentChapter && options.currentChapter >= 1) {
        const slice = exportMxChapterNumericalSlice(
          effectiveWb,
          options.currentChapter,
          dynTotal ?? effectiveWb.roguelikeEnvelope.levelMax,
          options.genre
        )
        return `${slice.sliceMarkdown}\n\n${macroBrief}`
      }
      return macroBrief
    }
  } catch {
    // 非 JSON 或解析失败，原样返回
  }
  return rawText
}

export interface MxChapterOutlinePlanItem {
  chapter: number
  totalChapters: number
  arcIndex: number
  totalArcs: number
  volumeTitleZh: string
  titleZh: string
  titleEn: string
  beatType: MxChapterNumericalSlice['chapterBeatType']
  beatBadgeZh: string
  beatBadgeEn: string
  realmStageLabelZh: string
  powerCeiling: number
  villainPressure: number
  isBossOrWall: boolean
  allowedTrumps: string[]
  recommendedItem: string
  coreConflictZh: string
  cliffhangerHookZh: string
  outlinePromptZh: string
  outlinePromptEn: string
}

/**
 * 分卷与冲突幕次（Arc）多章连载细纲规划表生成器：
 * 根据当前章号 `currentChapter` 与动态总章数 `totalChapters`，自动生成当前冲突幕（或连续窗口，最多 10 章）
 * 的逐章起承转合排期表（铺垫蓄势 ➔ 奇遇立威 ➔ 反派极限卡点 ➔ 亮底牌高潮打脸），供创作者一键填入或批量连续连载。
 */
export function generateMxArcChapterOutlinePlan(
  wb: MxNumericalWorkbench,
  currentChapter: number,
  totalChapters?: number,
  targetWords = 3200,
  genre?: NovelGenreProfile
): MxChapterOutlinePlanItem[] {
  const dynTotal = Math.max(
    1,
    Math.min(5000, Math.round(totalChapters || wb.roguelikeEnvelope.levelMax || 800))
  )
  const curChap = Math.max(1, Math.min(dynTotal, Math.round(currentChapter || 1)))
  const baseSlice = exportMxChapterNumericalSlice(wb, curChap, dynTotal, genre)
  const [arcStartRaw, arcEndRaw] = baseSlice.arcChapterRange
  const span = arcEndRaw - arcStartRaw + 1
  const windowStart =
    span <= 10 ? arcStartRaw : Math.max(arcStartRaw, Math.min(curChap - 2, arcEndRaw - 9))
  const windowEnd = Math.min(dynTotal, Math.min(arcEndRaw, windowStart + 9))

  const items: MxChapterOutlinePlanItem[] = []
  for (let ch = windowStart; ch <= windowEnd; ch++) {
    const s = exportMxChapterNumericalSlice(wb, ch, dynTotal, genre)
    const allowedTop = s.allowedTrumpCards.slice(0, 3).join('、') || '本阶段准入底牌' // cjk-ok
    const lockedTop = s.lockedEndgameTrumps.slice(0, 2).join('、') || '终局底牌' // cjk-ok

    let beatBadgeZh = '起势铺垫' // cjk-ok
    let beatBadgeEn = 'Setup & Endure'
    let titleZh = `第${ch}章：风暴将起·隐忍蓄势（${s.realmStageLabelZh}）` // cjk-ok
    let titleEn = `Ch.${ch}: Storm Brewing & Hidden Edge`
    let coreConflictZh = `反派借势挑衅施压，主角在【${s.realmStageLabelZh}】表面隐忍周旋，暗中锁定机缘【${s.recommendedEncounterItem}】。` // cjk-ok
    let cliffhangerHookZh = `章末反派设下公开赌局/鸿门宴，试图在下一章彻底将主角踩入泥潭。` // cjk-ok

    if (s.chapterBeatType === 'encounter_growth') {
      beatBadgeZh = '奇遇立威' // cjk-ok
      beatBadgeEn = 'Encounter & Growth'
      titleZh = `第${ch}章：机缘入袋·初露锋芒（${s.recommendedEncounterItem}）` // cjk-ok
      titleEn = `Ch.${ch}: Relic Acquired & First Strike`
      coreConflictZh = `主角成功获取/激活【${s.recommendedEncounterItem}】，战力逼近上限 ${s.powerCeiling}，随手惩戒反派爪牙立威。` // cjk-ok
      cliffhangerHookZh = `爪牙溃败引出幕后真正主使，对方动用威胁值 ${s.villainPressure} 的杀招封锁全场。` // cjk-ok
    } else if (s.chapterBeatType === 'villain_suppression_cliffhanger') {
      beatBadgeZh = '绝境卡点' // cjk-ok
      beatBadgeEn = 'Villain Pressure Wall'
      titleZh = `第${ch}章：绝境围剿·底牌将出（反派威胁 ${s.villainPressure}）` // cjk-ok
      titleEn = `Ch.${ch}: Cornered at the Pressure Wall`
      coreConflictZh = `本幕反派倾巢而出（压迫强度 ${s.villainPressure}），众目睽睽下逼主角低头认罪，全场冷嘲热讽达到顶点。` // cjk-ok
      cliffhangerHookZh = `千钧一发之际，主角冷笑抬眸，手按核心底牌【${s.allowedTrumpCards[0] ?? allowedTop}】，大人物车队/异象已至门外！` // cjk-ok
    } else if (s.chapterBeatType === 'climax_reversal_slap') {
      beatBadgeZh = '高潮打脸' // cjk-ok
      beatBadgeEn = 'Climax Reversal Slap'
      titleZh = `第${ch}章：底牌全开·雷霆清算（执掌${s.allowedTrumpCards[0] ?? '王牌'}）` // cjk-ok
      titleEn = `Ch.${ch}: Trump Card Unfolded & Total Reversal`
      coreConflictZh = `主角按最优乘区顺序连环亮出【${allowedTop}】，战力爆发至 ${s.powerCeiling} 彻底粉碎反派依仗，全场权贵骸然跪拜！` // cjk-ok
      cliffhangerHookZh = `本幕宿敌伏诛清算，但战利品中浮现指向更高阶势力（下一幕）的惊天秘辛钩子。` // cjk-ok
    }

    if (genre && genre.id !== 'urban_reversal') {
      const spec = genre.beats[s.chapterBeatType]
      const tplVars = {
        stage: s.realmStageLabelZh,
        item: s.recommendedEncounterItem,
        unlock: s.allowedTrumpCards[s.allowedTrumpCards.length - 1] ?? allowedTop,
        unlockTop: allowedTop,
        lockedTop,
        pressure: s.villainPressure,
        ceiling: s.powerCeiling
      }
      beatBadgeZh = spec.badgeZh
      beatBadgeEn = spec.badgeEn
      titleZh = `第${ch}章：${fillNovelGenreTemplate(spec.titleZh, tplVars)}` // cjk-ok
      titleEn = `Ch.${ch}: ${spec.titleEn}`
      coreConflictZh = fillNovelGenreTemplate(spec.coreConflictZh, tplVars)
      cliffhangerHookZh = fillNovelGenreTemplate(spec.cliffhangerZh, tplVars)
    }
    const stageTerm = genre?.stageTermZh ?? '境界' // cjk-ok
    const axisP = genre?.protagonistAxisZh ?? '战力' // cjk-ok
    const axisA = genre?.antagonistAxisZh ?? '反派威胁' // cjk-ok
    const unlockTerm = genre?.unlockTermZh ?? '底牌' // cjk-ok

    const outlinePromptZh = [
      `精写第 ${ch} / ${dynTotal} 章《${titleZh.replace(/^第\d+章[:：]/, '')}》（单章满 ${targetWords}+ 字）：`, // cjk-ok
      `- 所属卷幕：${s.volumeTitleZh} · 第 ${s.arcIndex}/${s.totalArcs} 冲突幕`, // cjk-ok
      `- 本章戏剧定位：【${beatBadgeZh}】${s.chapterBeatLabelZh}`, // cjk-ok
      `- 数值与${unlockTerm}围栏：主角当前${stageTerm}【${s.realmStageLabelZh}】，${axisP}上限 ${s.powerCeiling} vs ${axisA} ${s.villainPressure}；本章准许动用${unlockTerm}【${allowedTop}】，严禁提前剧透封存${unlockTerm}【${lockedTop}】。`, // cjk-ok
      `- 本章核心剧情：${coreConflictZh}`, // cjk-ok
      `- 章末断章钩子：${cliffhangerHookZh}` // cjk-ok
    ].join('\n')

    const outlinePromptEn = [
      `Write Chapter ${ch} / ${dynTotal} "${titleEn}" (${targetWords}+ words):`,
      `- Pacing Role: [${beatBadgeEn}] (Realm ${s.realmStageLabelZh}, Power Cap ${s.powerCeiling} vs Villain ${s.villainPressure})`,
      `- Allowed Trumps: [${allowedTop}] (Strictly keep [${lockedTop}] locked)`,
      `- Core Conflict: ${coreConflictZh}`,
      `- Ending Cliffhanger: ${cliffhangerHookZh}`
    ].join('\n')

    items.push({
      chapter: ch,
      totalChapters: dynTotal,
      arcIndex: s.arcIndex,
      totalArcs: s.totalArcs,
      volumeTitleZh: s.volumeTitleZh,
      titleZh,
      titleEn,
      beatType: s.chapterBeatType,
      beatBadgeZh,
      beatBadgeEn,
      realmStageLabelZh: s.realmStageLabelZh,
      powerCeiling: s.powerCeiling,
      villainPressure: s.villainPressure,
      isBossOrWall: s.isBossArc || s.isDifficultyWallArc,
      allowedTrumps: s.allowedTrumpCards,
      recommendedItem: s.recommendedEncounterItem,
      coreConflictZh,
      cliffhangerHookZh,
      outlinePromptZh,
      outlinePromptEn
    })
  }
  return items
}

export interface MxNovelCharacterStatusEntry {
  id: string
  name: string
  faction: 'protagonist' | 'ally' | 'villain' | 'neutral'
  status: 'active' | 'subdued' | 'injured' | 'eliminated'
  realmOrRole: string
  relationNote: string
  updatedAtChapter: number
}

export interface MxNovelForeshadowingEntry {
  id: string
  title: string
  plantedChapter: number
  targetPayoffChapterRange: [number, number]
  status: 'planted' | 'paid_off'
  payoffHint: string
  paidOffAtChapter?: number
}

export function createDefaultNovelCharacterRoster(
  wb: MxNumericalWorkbench,
  totalChapters = 800,
  genre?: NovelGenreProfile
): MxNovelCharacterStatusEntry[] {
  const s = exportMxChapterNumericalSlice(wb, 1, totalChapters, genre)
  if (genre && genre.id !== 'urban_reversal') {
    return genre.roster.map((r, idx) => ({
      id: `char_${r.faction}_${idx}`,
      name: r.name,
      faction: r.faction,
      status: r.faction === 'ally' ? 'subdued' : 'active',
      realmOrRole:
        r.faction === 'protagonist'
          ? `${s.realmStageLabelZh} · ${genre.protagonistAxisZh} ${s.powerCeiling}`
          : r.role,
      relationNote: r.note,
      updatedAtChapter: 1
    }))
  }
  const topAlly = wb.multiplier.entities[1]?.name || '赵天豪（江城首富）' // cjk-ok
  const earlyVillain = '苏清雪（前期退婚反派）' // cjk-ok
  const midVillain = wb.multiplier.entities[2]?.name || '省城豪门大少' // cjk-ok
  return [
    {
      id: 'char_protagonist',
      name: '林玄', // cjk-ok
      faction: 'protagonist',
      status: 'active',
      realmOrRole: `${s.realmStageLabelZh} · 战力上限 ${s.powerCeiling}`, // cjk-ok
      relationNote: '男主，表面隐忍赘婿，实则执掌黑金龙卡与百倍觉醒系统', // cjk-ok
      updatedAtChapter: 1
    },
    {
      id: 'char_ally_tycoon',
      name: topAlly.replace(/（.*）/, ''),
      faction: 'ally',
      status: 'subdued',
      realmOrRole: '百亿商界巨擘 · 核心人脉', // cjk-ok
      relationNote: '受男主救命大恩，唯男主马首是瞻，负责前中期商战护航', // cjk-ok
      updatedAtChapter: 1
    },
    {
      id: 'char_villain_early',
      name: earlyVillain.replace(/（.*）/, ''),
      faction: 'villain',
      status: 'active',
      realmOrRole: `初级反派 · 压迫值 ${s.villainPressure}`, // cjk-ok
      relationNote: '嫌贫爱富当众退婚，第 1 幕高潮被男主亮底牌打脸清算', // cjk-ok
      updatedAtChapter: 1
    },
    {
      id: 'char_villain_mid',
      name: midVillain.replace(/（.*）/, ''),
      faction: 'villain',
      status: 'active',
      realmOrRole: '省域豪门爪牙 · 幕后黑手前哨', // cjk-ok
      relationNote: '觊觎苏家产业与男主奇遇信物，引出第 2 卷省域冲突', // cjk-ok
      updatedAtChapter: 1
    }
  ]
}

export function createDefaultNovelForeshadowingPool(
  wb: MxNumericalWorkbench,
  totalChapters = 800,
  genre?: NovelGenreProfile
): MxNovelForeshadowingEntry[] {
  const dynTotal = Math.max(10, totalChapters)
  const firstArcEnd = Math.max(3, Math.min(20, Math.round(dynTotal * 0.04)))
  const midArcStart = Math.max(4, Math.round(dynTotal * 0.12))
  const midArcEnd = Math.max(midArcStart + 4, Math.round(dynTotal * 0.25))
  const lateArcStart = Math.max(midArcEnd + 5, Math.round(dynTotal * 0.55))
  const lateArcEnd = Math.max(lateArcStart + 10, Math.round(dynTotal * 0.85))
  if (genre && genre.id !== 'urban_reversal') {
    const ranges: Array<[number, number]> = [
      [2, firstArcEnd],
      [midArcStart, midArcEnd],
      [lateArcStart, lateArcEnd]
    ]
    return genre.foreshadowings.map((f, idx) => {
      const [start, end] = ranges[idx]!
      return {
        id: `fs_${genre.id}_${idx + 1}`,
        title: f.title,
        plantedChapter: idx + 1,
        targetPayoffChapterRange: [start, end] as [number, number],
        status: 'planted' as const,
        payoffHint: fillNovelGenreTemplate(f.payoffHint, { start, end })
      }
    })
  }
  const firstItem = wb.lootRoll.draftPool[0]?.name || '天命金手指觉醒信物' // cjk-ok
  const endTrump =
    wb.multiplier.entities[wb.multiplier.entities.length - 1]?.name || '真身揭晓·全员震怖' // cjk-ok

  return [
    {
      id: 'fs_1_contract',
      title: `退婚宴三日之约与【${firstItem}】真伪验证`, // cjk-ok
      plantedChapter: 1,
      targetPayoffChapterRange: [2, firstArcEnd],
      status: 'planted',
      payoffHint: `反派嘲笑信物为地摊假货，需在第 2~${firstArcEnd} 章首富到场下跪接驾时当众验证打脸` // cjk-ok
    },
    {
      id: 'fs_2_province_cabal',
      title: '省域隐世豪门封锁令与父母失踪旧案线索', // cjk-ok
      plantedChapter: 2,
      targetPayoffChapterRange: [midArcStart, midArcEnd],
      status: 'planted',
      payoffHint: `第 ${midArcStart}~${midArcEnd} 章冲出新手村进入省域大地图时，揭晓当年设局害林家的幕后推手` // cjk-ok
    },
    {
      id: 'fs_3_endgame_seal',
      title: `终局禁区血脉玉佩与【${endTrump}】最高权限解封`, // cjk-ok
      plantedChapter: 3,
      targetPayoffChapterRange: [lateArcStart, lateArcEnd],
      status: 'planted',
      payoffHint: `全书后期（第 ${lateArcStart}~${lateArcEnd} 章）突破最高境界天花板时解封终极底牌完成万界清算` // cjk-ok
    }
  ]
}

export function buildNovelForeshadowingAndRosterPromptBlock(opts: {
  currentChapter: number
  roster?: MxNovelCharacterStatusEntry[]
  characters?: MxNovelCharacterStatusEntry[]
  foreshadowings?: MxNovelForeshadowingEntry[]
}): string {
  const cur = Math.max(1, opts.currentChapter)
  const roster = opts.roster ?? opts.characters ?? []
  const foreshadowings = opts.foreshadowings ?? []
  const lines: string[] = []

  if (roster.length > 0) {
    const activeChars = roster.filter((c) => c.status !== 'eliminated')
    const eliminatedChars = roster.filter((c) => c.status === 'eliminated')
    lines.push(
      `### [人物生死与仇恨状态名录 (Character Status & Anti-OOC Roster)]`, // cjk-ok
      ...activeChars.map(
        (c) =>
          `- **${c.name}**（${c.realmOrRole} · 状态：${c.status === 'subdued' ? '已臣服归顺' : c.status === 'injured' ? '重伤潜伏' : '活跃在场'}）：${c.relationNote}` // cjk-ok
      )
    )
    if (eliminatedChars.length > 0) {
      lines.push(
        `- 🚫 **已彻底退场/伏诛反派（严禁在本章无故复活再次登场挑衅！）**：${eliminatedChars.map((c) => `${c.name}（第${c.updatedAtChapter}章已退场）`).join('、')}` // cjk-ok
      )
    }
  }

  const dueForeshadowings = foreshadowings.filter(
    (f) =>
      f.status === 'planted' &&
      cur >= f.targetPayoffChapterRange[0] &&
      cur <= f.targetPayoffChapterRange[1]
  )
  const upcomingForeshadowings = foreshadowings
    .filter((f) => f.status === 'planted' && cur < f.targetPayoffChapterRange[0])
    .slice(0, 4)

  if (dueForeshadowings.length > 0 || upcomingForeshadowings.length > 0) {
    lines.push(
      ``,
      `### [长线伏笔追踪与本章到期回收指令 (Foreshadowing Payoff Tracker)]` // cjk-ok
    )
    for (const due of dueForeshadowings) {
      lines.push(
        `- 🔥 **【本章到期必回收伏笔】《${due.title}》**（第 ${due.plantedChapter} 章埋设，计划第 ${due.targetPayoffChapterRange[0]}~${due.targetPayoffChapterRange[1]} 章回收）：${due.payoffHint}` // cjk-ok
      )
    }
    for (const up of upcomingForeshadowings) {
      lines.push(
        `- 🌱 **【长线铺垫中伏笔（请勿提前泄底，可侧面埋线）】《${up.title}》**（第 ${up.plantedChapter} 章埋设 ➔ 目标第 ${up.targetPayoffChapterRange[0]}~${up.targetPayoffChapterRange[1]} 章揭晓）：${up.payoffHint}` // cjk-ok
      )
    }
  }

  return lines.join('\n')
}

export interface MxNovelChapterContinuityAudit {
  overallScore: number
  wordCount: number
  targetWords: number
  wordQuotaPct: number
  beatsPresentCount: number
  leakedLockedTrumps: string[]
  usedAllowedTrumps: string[]
  revivedEliminatedCharacters: string[]
  dueForeshadowingsUnpaid: string[]
  anchorContinuityPassed: boolean
  matchedAnchorKeywords: string[]
  hasStrongEndingHook: boolean
  issuesZh: string[]
  suggestionsZh: string[]
}

/**
 * 单章连贯性、战力围栏与爽点节奏自动审计器（Continuity & Power-Creep QA Doctor）：
 * 实时扫描当前章节正文是否误触「封存禁用底牌黑名单」、「已退场死人复活 OOC」、「到期伏笔漏填」、首段是否承接上一章末尾锚点、字数与四拍结构是否达标。
 */
export function auditNovelChapterContinuityAndPacing(
  text: string,
  slice: MxChapterNumericalSlice,
  opts?: {
    targetWords?: number
    prevTailAnchor?: string
    eliminatedCharacterNames?: string[]
    dueForeshadowingTitles?: string[]
    genre?: NovelGenreProfile
  }
): MxNovelChapterContinuityAudit {
  const raw = (text ?? '').trim()
  const targetWords = Math.max(500, opts?.targetWords || 3200)
  const wordCount = raw.replace(/\s+/g, '').length
  const wordQuotaPct = Math.round((wordCount / targetWords) * 100)

  const leakedLockedTrumps = slice.lockedEndgameTrumps.filter(
    (card) => card && card.trim().length >= 2 && raw.includes(card.trim())
  )
  const usedAllowedTrumps = slice.allowedTrumpCards.filter(
    (card) => card && card.trim().length >= 2 && raw.includes(card.trim())
  )

  const revivedEliminatedCharacters = (opts?.eliminatedCharacterNames ?? []).filter(
    (name) => name && name.trim().length >= 2 && raw.includes(name.trim())
  )

  const dueForeshadowingsUnpaid = (opts?.dueForeshadowingTitles ?? []).filter((title) => {
    const clean = title.trim()
    if (!clean || wordCount === 0) return false
    const tokens = clean.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [clean]
    return !tokens.some((tk) => raw.includes(tk))
  })

  let beatsPresentCount = 0
  if (/第一拍|Beat\s*1/i.test(raw) || wordCount >= 400) beatsPresentCount++ // cjk-ok
  if (/第二拍|Beat\s*2/i.test(raw) || wordCount >= 1200) beatsPresentCount++ // cjk-ok
  if (/第三拍|Beat\s*3/i.test(raw) || wordCount >= 2200) beatsPresentCount++ // cjk-ok
  if (/第四拍|Beat\s*4/i.test(raw) || wordCount >= targetWords) beatsPresentCount++ // cjk-ok

  const prevTail = (opts?.prevTailAnchor ?? '').trim()
  const matchedAnchorKeywords: string[] = []
  let anchorContinuityPassed = true
  if (slice.chapterIndex > 1 && prevTail.length >= 10 && raw.length >= 20) {
    const candidateTokens = Array.from(
      new Set(
        (prevTail.match(/[\u4e00-\u9fa5]{2,4}/g) ?? []).filter(
          (w) =>
            ![
              '第1章', // cjk-ok
              '第2章', // cjk-ok
              '然而', // cjk-ok
              '此时', // cjk-ok
              '就在', // cjk-ok
              '突然', // cjk-ok
              '一个', // cjk-ok
              '自己', // cjk-ok
              '他们', // cjk-ok
              '没有', // cjk-ok
              '什么' // cjk-ok
            ].includes(w)
        )
      )
    )
    const openingSegment = raw.slice(0, 420)
    for (const tk of candidateTokens) {
      if (openingSegment.includes(tk)) {
        matchedAnchorKeywords.push(tk)
      }
    }
    anchorContinuityPassed = matchedAnchorKeywords.length > 0 || candidateTokens.length === 0
  }

  const tailSegment = raw.slice(-220)
  let genreHookRe: RegExp | null = null
  try {
    genreHookRe = opts?.genre?.hookKeywordsRe ? new RegExp(opts.genre.hookKeywordsRe) : null
  } catch {
    genreHookRe = null
  }
  const hasStrongEndingHook =
    raw.length > 0 &&
    (/[？！?!…]/.test(tailSegment) || // cjk-ok
      (genreHookRe ? genreHookRe.test(tailSegment) : false) ||
      /* cjk-ok */ /忽然|骤然|轰然|震动|瞳孔|冷笑|踏入|亮出|电话|警报|跪|死寂|惊呼|究竟|倒计时|门外/.test(
        tailSegment
      ))

  const issuesZh: string[] = []
  const suggestionsZh: string[] = []
  let score = 100

  if (wordCount === 0) {
    return {
      overallScore: 0,
      wordCount: 0,
      targetWords,
      wordQuotaPct: 0,
      beatsPresentCount: 0,
      leakedLockedTrumps: [],
      usedAllowedTrumps: [],
      revivedEliminatedCharacters: [],
      dueForeshadowingsUnpaid: [],
      anchorContinuityPassed: true,
      matchedAnchorKeywords: [],
      hasStrongEndingHook: false,
      issuesZh: ['当前章节尚无正文内容'], // cjk-ok
      suggestionsZh: ['点击顶栏「⚡ 生成第 X 章」或在幕次细纲表中选择一章开始生成'] // cjk-ok
    }
  }

  if (leakedLockedTrumps.length > 0) {
    const unlockTerm = opts?.genre?.unlockTermZh ?? '底牌' // cjk-ok
    score -= Math.min(35, leakedLockedTrumps.length * 18)
    issuesZh.push(
      `⚠️ ${unlockTerm}抢跑告警：本章误出现了后期封存的${unlockTerm}【${leakedLockedTrumps.join('、')}】` // cjk-ok
    )
    suggestionsZh.push(
      `点击下方「🔧 一键替换违规底牌」，将封存底牌替换为本章准入底牌【${slice.allowedTrumpCards[0] ?? '当前阶段底牌'}】` // cjk-ok
    )
  }

  if (revivedEliminatedCharacters.length > 0) {
    score -= Math.min(30, revivedEliminatedCharacters.length * 15)
    issuesZh.push(
      `💀 角色状态 OOC 告警：已退场/已伏诛角色【${revivedEliminatedCharacters.join('、')}】再次出现在本章正文中` // cjk-ok
    )
    suggestionsZh.push(
      `点击下方「🧹 替换为新登场反派」，或检查人物生死名录` // cjk-ok
    )
  }

  if (dueForeshadowingsUnpaid.length > 0) {
    score -= Math.min(16, dueForeshadowingsUnpaid.length * 8)
    issuesZh.push(
      `🕸️ 到期伏笔待回收提醒：本章处于伏笔《${dueForeshadowingsUnpaid.join('》《')}》的计划揭晓区间，正文中尚未提及` // cjk-ok
    )
    suggestionsZh.push(
      `可在「四层记忆 · 伏笔追踪池」点击「🔥 注入本章填坑指令」回收该伏笔` // cjk-ok
    )
  }

  if (wordQuotaPct < 80) {
    score -= Math.min(25, Math.round((80 - wordQuotaPct) * 0.4))
    issuesZh.push(
      `📏 字数未达标：当前 ${wordCount} 字（仅达目标 ${targetWords} 字的 ${wordQuotaPct}%）` // cjk-ok
    )
    suggestionsZh.push(
      `建议选中核心冲突段落使用「🔍 扩写环境与五感细节 (+300字)」补足四拍场景描写` // cjk-ok
    )
  }

  if (!anchorContinuityPassed) {
    score -= 15
    issuesZh.push(
      `🔗 开篇承接偏弱：本章前 400 字未检测到上一章（第 ${slice.chapterIndex - 1} 章）末尾锚点关键词` // cjk-ok
    )
    suggestionsZh.push(
      `建议在第一拍开头补入上一章末尾的场景/人物余波，保持跨章无缝咬合` // cjk-ok
    )
  }

  if (!hasStrongEndingHook) {
    score -= 12
    issuesZh.push(`🪝 章末悬念钩子偏平淡：最后一段缺少强冲突转折或悬念标点`) // cjk-ok
    suggestionsZh.push(
      `建议选中章末最后一段，点击「🪝 改写为高能断章悬念钩子」拉升追读率` // cjk-ok
    )
  }

  if (issuesZh.length === 0) {
    suggestionsZh.push(
      `✅ 本章数值围栏合规、跨章承接紧密、四拍结构与章末钩子俱佳，可直接推送下游改编剧本或继续连载下一章！` // cjk-ok
    )
  }

  return {
    overallScore: Math.max(0, Math.min(100, score)),
    wordCount,
    targetWords,
    wordQuotaPct,
    beatsPresentCount,
    leakedLockedTrumps,
    usedAllowedTrumps,
    revivedEliminatedCharacters,
    dueForeshadowingsUnpaid,
    anchorContinuityPassed,
    matchedAnchorKeywords,
    hasStrongEndingHook,
    issuesZh,
    suggestionsZh
  }
}

/**
 * 将单章或多章小说正文实时转译为标准短剧分场剧本预览（用于小说 Dive 工作台「小说 ↔ 剧本双栏同屏对照」）：
 */
export function convertNovelChapterToScreenplayPreview(
  novelText: string,
  opts?: {
    chapterIndex?: number
    chapterTitle?: string
    slice?: MxChapterNumericalSlice
    protagonistName?: string
    antagonistName?: string
  }
): string {
  const raw = (novelText ?? '').trim()
  const chapIdx = opts?.chapterIndex ?? opts?.slice?.chapterIndex ?? 1
  const chapTitleClean =
    (opts?.chapterTitle ?? '')
      .replace(/^#+\s*/, '')
      .replace(/^第\s*\d+\s*(?:\/\s*\d+\s*)?章[:：]?\s*/, '') // cjk-ok
      .trim() || '风云突变·底牌亮出' // cjk-ok
  const realm = opts?.slice?.realmStageLabelZh ?? '潜龙初醒期' // cjk-ok
  const topTrump = opts?.slice?.allowedTrumpCards[0] ?? '至尊黑金龙卡' // cjk-ok
  const pressure = opts?.slice?.villainPressure ?? 120
  const hero = opts?.protagonistName?.trim() || '林玄' // cjk-ok
  const foe = opts?.antagonistName?.trim() || '反派' // cjk-ok

  const paragraphs = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

  const dialogueLines = paragraphs.filter((l) => /[“"「『]/.test(l) || /^[^:：]{1,10}[:：]/.test(l))
  const actionParas = paragraphs.filter((l) => !dialogueLines.includes(l))

  const act1 =
    actionParas[0]?.slice(0, 110) ||
    `璀璨水晶灯下宾客云集，${foe}释放威胁强度 ${pressure} 的威压逼迫${hero}当众低头。` // cjk-ok
  const act2 =
    actionParas[Math.floor(actionParas.length / 2)]?.slice(0, 110) ||
    `${hero}眼底寒芒一闪（${realm}气机流转），缓步上前亮出核心信物【${topTrump}】，全场哗然死寂！` // cjk-ok
  const act3 =
    actionParas[actionParas.length - 1]?.slice(0, 110) ||
    `宴会厅大门轰然推开，黑衣保镖分列两侧，大人物疾步入场九十度躬身行礼，悬念陡升！` // cjk-ok

  const dlg1 =
    dialogueLines[0]?.replace(/^[“"「『]|[”"」』]$/g, '') ||
    '认清你自己的身份！今天就算天王老子来了，你也休想踏出这扇门！' // cjk-ok
  const dlg2 =
    dialogueLines[1]?.replace(/^[“"「『]|[”"」』]$/g, '') ||
    `是吗？睁大你的眼睛看清楚，这枚【${topTrump}】代表什么。三分钟后，你会跪着求我。` // cjk-ok

  const ep1Num = (chapIdx - 1) * 2 + 1
  const ep2Num = ep1Num + 1

  return [
    `剧本名：《第${chapIdx}章改编：${chapTitleClean}》`, // cjk-ok
    ``,
    `【人物小传】`, // cjk-ok
    `- ${hero}（${realm}）：表面隐忍内敛，实则执掌【${topTrump}】，眼神冷冽果决。`, // cjk-ok
    `- ${foe}（威胁值 ${pressure}）：神情倨傲、步步紧逼，从胜券在握到方寸大乱。`, // cjk-ok
    ``,
    `## 第${ep1Num}集：绝境施压·锋芒暗藏`, // cjk-ok
    `第1场 【内景 · 核心冲突现场 - 夜】`, // cjk-ok
    `△ ${act1}`,
    `${foe}：（冷笑讥讽）${dlg1}`, // cjk-ok
    `△ 四周众人窃窃私语，镜头急速推近${hero}古井无波的侧脸，${hero}手指轻叩桌面。`, // cjk-ok
    `${hero}：（平静冷冽）${dlg2}`, // cjk-ok
    ``,
    `## 第${ep2Num}集：底牌亮出·全场震怖`, // cjk-ok
    `第1场 【内景 · 核心冲突现场 - 夜】`, // cjk-ok
    `△ ${act2}`,
    `${foe}：（瞳孔骤缩，声音颤抖）这不可能……你怎么可能有【${topTrump}】？！`, // cjk-ok
    `△ ${act3}`,
    `${hero}：（负手而立）好戏，现在才刚刚开始。` // cjk-ok
  ].join('\n')
}
