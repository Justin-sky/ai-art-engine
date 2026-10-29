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
  type GameCardRow,
  type GameCharacterRow,
  type GameDataTableBundle,
  type GameItemRow,
  type GameWaveRow
} from './gameDataTables'
import { createMxRng, evaluateMxExpression } from './machinationsV2'

// ───────────────────────────── 1. 乘区公式与配表审计层 ─────────────────────────────

export type MxWorkbenchPresetId =
  | 'slay_the_spire_dbg'
  | 'hearthstone_tcg'
  | 'onmyoji_atb'
  | 'balatro_roguelike'
  | 'survivor_brotato'

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
  const rng = createMxRng(cfg.seed || 2026)

  if (cfg.mode === 'gacha_pity') {
    const pullsNeeded: number[] = []
    const dustsEarned: number[] = []
    const targetCopies = Math.max(1, Math.min(10, Math.round(cfg.targetCopies || 1)))
    const hardPity = Math.max(1, Math.round(cfg.hardPityPull || 90))
    const softStart = Math.max(1, Math.round(cfg.softPityStart || 74))
    const baseRate = Math.max(0.01, cfg.baseSsrRatePct) / 100
    const slope = Math.max(0, cfg.softPitySlopePct) / 100

    for (let r = 0; r < runs; r++) {
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
  /** 塞状态卡检定下每回合塞入抽弃牌堆的眩晕/伤口废牌数（默认 1） */
  statusCardsPerTurn?: number
  /** 出牌限制检定下每回合最多允许打出的卡牌张数（如时间吞噬者，默认 5） */
  cardPlayLimitPerTurn?: number
  /** 反伤检定下每次攻击命中受到的荆棘反伤（默认 2） */
  enemyThornsDamage?: number
  deckCards: MxDeckCardSpec[]
  /** 牌库表当前激活展示的列标识列表（可自由增删） */
  deckActiveColumns?: string[]

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
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
}

export function runMxCombatKernelSimulation(cfg: MxCombatKernelConfig): MxCombatKernelResult {
  const runs = Math.max(10, Math.min(2000, Math.round(cfg.runs || 200)))
  const maxTurns = Math.max(3, Math.min(40, Math.round(cfg.maxTurns || 12)))
  const rng = createMxRng(cfg.seed || 2026)

  // ───────── Kernel A: 《杀戮尖塔》洗抽牌库与能量回合内核 ─────────
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

    for (let r = 0; r < runs; r++) {
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
        let energy = Math.max(1, cfg.energyPerTurn || 3)
        totalEnergyAvailable += energy
        let turnDmg = 0
        let turnBlock = 0
        let cardsPlayedThisTurn = 0
        let enemyArmorThisTurn = mechanism === 'thorns_armor' ? 10 : 0

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

          if (mechanism === 'card_limit_punisher') {
            // 心脏律动/出牌惩罚：每打出一张牌受到 1 点穿甲反制伤害
            if (turnBlock > 0) {
              turnBlock = Math.max(0, turnBlock - 1)
            } else {
              playerHp -= 1
            }
          }

          if (card.energyGain > 0) {
            energy += card.energyGain
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
          const customFlatBonus = card.customStats
            ? Object.values(card.customStats).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)
            : 0
          if (card.damage > 0 || customFlatBonus > 0) {
            const vulnMult = enemyVuln > 0 ? 1.5 : 1.0
            const hits = Math.max(1, Math.round(card.hits || 1))
            const singleHit = Math.max(0, Math.floor((card.damage + playerStr) * vulnMult))
            let hitDmg = singleHit * hits + Math.max(0, Math.round(customFlatBonus))
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
            if (mechanism === 'thorns_armor') {
              const reflect = hits * thornsDmg
              if (turnBlock >= reflect) {
                turnBlock -= reflect
              } else {
                playerHp -= reflect - turnBlock
                turnBlock = 0
              }
            }
          }
          if (!card.exhaust) discardPile.push(card)
        }

        // 回合结束结算中毒/流血 DOT 伤害
        if (enemyPoison > 0 && enemyHp > 0) {
          turnDmg += enemyPoison
          enemyHp -= enemyPoison
          enemyPoison = Math.max(0, enemyPoison - 1)
        }

        // 回合结束弃置剩余手牌
        while (hand.length > 0) discardPile.push(hand.pop()!)

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

        if (enemyHp <= 0) {
          killedTurn = t
          wins++
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
      turnSeries
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

    for (let r = 0; r < runs; r++) {
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

          if (card.kind === 'minion') {
            board.push({
              attack: card.attack,
              health: card.health,
              ready: false,
              shield: Boolean(card.divineShield)
            })
          }
          if (card.directDamage > 0) oppHp -= card.directDamage
          if (card.drawCards > 0) {
            for (let d = 0; d < card.drawCards && deck.length > 0 && hand.length < 10; d++) {
              hand.push(deck.pop()!)
            }
          }
        }

        totalManaFloated += remMana
        if (remMana === 0) {
          curveOutHits++
          curveOutByTurn[t - 1] = (curveOutByTurn[t - 1] ?? 0) + 1
        }

        // 已就绪随从攻击对手
        for (const m of board) {
          if (m.ready && m.attack > 0) oppHp -= m.attack
        }

        const totalBoardStats = board.reduce((s, m) => s + m.attack + m.health, 0)
        boardPowerByTurn[t - 1]!.push(totalBoardStats)

        if (oppHp <= 0 && lethalTurn > maxTurns) {
          lethalTurn = t
          wins++
          break
        }

        // 对手解场交换
        let clearDmg = Math.max(0, (cfg.opponentClearPowerPerTurn || 2) * Math.ceil(t * 0.6))
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
      turnSeries
    }
  }

  // ───────── Kernel C: 《阴阳师》/《星铁》速度行动条（拉条/超车）与共享鬼火池内核 ─────────
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
  const rng = createMxRng(cfg.seed || 2026)

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

/**
 * 将数值工作台当前调平后的卡牌表、式神/角色属性、肉鸽词条遗物池与关卡波次曲线
 * 一键编译为符合 `game.data_table` 规范的全套结构化数据表（cards.csv / waves.csv / items.csv / characters.csv / localization.csv）。
 */
export function exportWorkbenchToGameDataTables(wb: MxNumericalWorkbench): GameDataTableBundle {
  const envelopeRes = runMxRoguelikeEnvelopeSimulation(wb.roguelikeEnvelope)
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

  return buildGameDataTableBundle({
    tableName: wb.multiplier.title || wb.activePresetId,
    genre: 'roguelike',
    characters,
    skills: [],
    items,
    cards,
    waves,
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
      'survivor_brotato'
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
        : base.roguelikeEnvelope
  }
}
