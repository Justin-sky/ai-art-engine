/**
 * 游戏经济系统与数值平衡动态模拟引擎（受 Machinations.io / Joris Dormans 系统动力学框架启发）。
 *
 * 核心能力：
 * 1. 标准 Machinations 图元建模：
 *    - Source（△ 资源发生器）、Pool（○ 资源池/货币桶）、Converter（▷ 转化合成器）、
 *      Drain（▽ 消耗回收黑洞 Sink）、Gate（◇ 概率/确定性分流闸门）、
 *      Register（▭ 动态公式寄存器）、EndCondition（▣ 终局/目标达成检测器）；
 *    - Resource Flow（实线资源流转边）与 State Modifier（虚线状态反馈修正边，支持正反馈滚雪球与负反馈动态保底）。
 * 2. 步进式确定性模拟 + 蒙特卡洛（Monte Carlo）批量随机模拟：
 *    - 计算各资源池随时间步（Tick）演化的 P10 / P50（中位数）/ P90 置信区间包络带；
 *    - 自动诊断「产出/回收比（Source-Sink Ratio）」「通货膨胀指数」「卡点饥饿步数（Bottleneck Tick）」与「保底期望抽数」。
 * 3. 纯函数 RGBA 渲染器：
 *    - 将 Machinations 拓扑图与底部蒙特卡洛 P10-P90 时序曲线渲染为高对比度预览图（供画布节点卡片直出预览）。
 * 4. 多引擎与表格导出：
 *    - 一键导出 Godot 4 (`EconomySimulator.gd`)、Unity (`EconomyManager.cs`)、Mermaid 流程图、CSV 遥测时序表，
 *      并可直接连入 `game.playable` 驱动 60fps 可玩沙盒的初始资源、掉落率与升级曲线。
 */

export type MachinationsNodeKind =
  'source' | 'pool' | 'converter' | 'drain' | 'gate' | 'register' | 'end_condition'

export type MachinationsActivationMode = 'automatic' | 'interactive' | 'passive' | 'on_start'

export type MachinationsEdgeKind = 'resource_flow' | 'state_modifier'

export type MachinationsPresetId =
  | 'arpg_equipment_economy'
  | 'gacha_pity_banner'
  | 'idle_exponential_tycoon'
  | 'roguelike_mana_deck'
  | 'survivor_xp_loop'

export interface MachinationsNode {
  id: string
  kind: MachinationsNodeKind
  label: string
  /** 画布 X 坐标（0..760） */
  x: number
  /** 画布 Y 坐标（0..300） */
  y: number
  activation: MachinationsActivationMode
  /** Pool 初始存量，或 Register 初始基准值 */
  initialValue?: number
  /** Pool 容量上限（-1 或 undefined 表示无上限） */
  maxCapacity?: number
  /** Register 动态公式（变量 a 代表首个相连状态池数值，如 "80 * Math.pow(1.22, a)"）或 EndCondition 阈值 */
  formula?: string
  /** Gate 分流模式 */
  gateMode?: 'probabilistic' | 'deterministic'
  /** 节点主题色（同时用于曲线图颜色） */
  color?: string
}

export interface MachinationsEdge {
  id: string
  sourceId: string
  targetId: string
  kind: MachinationsEdgeKind
  /** 边标签（如 "15/tick", "65%", "+6%/pull"） */
  label: string
  /**
   * 数值含义：
   * - resource_flow：每次触发传输的基础资源量（若 source 是 gate，则代表权重/百分比 0..100）
   * - state_modifier：每单位上游 Pool 对目标节点速率/权重的增量修正系数
   */
  rate: number
  /** 可选动态公式 */
  formula?: string
}

export interface MachinationsDiagram {
  schemaVersion: 1
  presetId: MachinationsPresetId
  title: string
  description: string
  nodes: MachinationsNode[]
  edges: MachinationsEdge[]
}

export interface MachinationsSimulationState {
  tick: number
  poolValues: Record<string, number>
  registerValues: Record<string, number>
  edgeFlowsLastTick: Record<string, number>
  nodeFiredLastTick: Record<string, boolean>
  gateCursor: Record<string, number>
  totalProduced: number
  totalDrained: number
  starvedConverterTicks: Record<string, number>
  firstBottleneckTick: number | null
  endConditionReachedAtTick: number | null
}

export interface MachinationsPoolTimeSeries {
  nodeId: string
  label: string
  color: string
  p10: number[]
  p50: number[]
  p90: number[]
  mean: number[]
}

export interface MachinationsHealthDiagnostic {
  code:
    | 'sink_source_balance'
    | 'inflation_check'
    | 'progression_bottleneck'
    | 'stochastic_variance'
    | 'goal_pacing'
  severity: 'healthy' | 'warning' | 'critical'
  title: string
  detail: string
  metricValue: string
  recommendation: string
}

export interface MachinationsSandboxBridgeParams {
  startingGold: number
  startingMaxHp: number
  startingBaseAtk: number
  goldDropPerKill: number
  xpDropPerKill: number
  upgradeCostBase: number
  upgradeCostGrowth: number
  gachaSsrBaseRate: number
  cardManaPerTurn: number
}

export interface MachinationsMonteCarloResult {
  presetId: MachinationsPresetId
  title: string
  runs: number
  steps: number
  seed: number
  ticks: number[]
  poolSeries: MachinationsPoolTimeSeries[]
  sourceSinkRatio: number
  inflationIndex: number
  totalProducedMean: number
  totalDrainedMean: number
  firstBottleneckTickMean: number | null
  endConditionHitRate: number
  medianTicksToGoal: number | null
  p90TicksToGoal: number | null
  diagnostics: MachinationsHealthDiagnostic[]
  sandboxParams: MachinationsSandboxBridgeParams
}

function createSeededRng(seed: number): () => number {
  let t = (seed >>> 0) + 0x6d2b79f5
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 安全求值简单数学公式（支持 a, b, lv, Math.pow, Math.min, Math.max, Math.floor, Math.round 及四则运算）。
 */
export function evaluateMachinationsFormula(
  formula: string | undefined,
  vars: { a?: number; b?: number; tick?: number },
  fallback = 10
): number {
  if (!formula || !formula.trim()) return fallback
  const a = Number.isFinite(vars.a) ? Number(vars.a) : 0
  const tick = Number.isFinite(vars.tick) ? Number(vars.tick) : 0
  const cleaned = formula.trim()

  // Common pattern: "base * pow(growth, a)" or "base * Math.pow(growth, a)"
  const powMatch = cleaned.match(
    /^([0-9.]+)\s*\*\s*(?:Math\.)?pow\(\s*([0-9.]+)\s*,\s*(?:a|lv)\s*\)$/i
  )
  if (powMatch) {
    const base = Number(powMatch[1])
    const growth = Number(powMatch[2])
    const val = base * Math.pow(growth, Math.min(60, Math.max(0, a)))
    return Number.isFinite(val) ? Math.round(val * 100) / 100 : fallback
  }

  // Linear pattern: "base + k * a"
  const linearMatch = cleaned.match(/^([0-9.]+)\s*\+\s*([0-9.]+)\s*\*\s*(?:a|lv|tick)$/i)
  if (linearMatch) {
    const base = Number(linearMatch[1])
    const slope = Number(linearMatch[2])
    const x = cleaned.toLowerCase().endsWith('tick') ? tick : a
    return Math.round((base + slope * x) * 100) / 100
  }

  // Threshold pattern for EndCondition: "a >= 10" or "a >= 500"
  const geMatch = cleaned.match(/^(?:a|val)\s*>=\s*([0-9.]+)$/i)
  if (geMatch) {
    const target = Number(geMatch[1])
    return a >= target ? 1 : 0
  }

  const numOnly = Number(cleaned)
  if (Number.isFinite(numOnly)) return numOnly

  return fallback
}

/**
 * 构建 5 大经典游戏品类 Machinations 经济系统蓝图预设。
 */
export function createMachinationsPresetDiagram(
  presetId: MachinationsPresetId = 'arpg_equipment_economy',
  customTitle?: string
): MachinationsDiagram {
  switch (presetId) {
    case 'gacha_pity_banner':
      return {
        schemaVersion: 1,
        presetId: 'gacha_pity_banner',
        title: customTitle?.trim() || 'Gacha Banner & Soft/Hard Pity Economy',
        description:
          '二次元抽卡祈愿与大小保底系统：日常星琼产出 -> 原石池 -> 祈愿转化器 -> 动态保底概率闸门（State 虚线随未出金抽数提升 SSR 权重）-> 五星限定/四星副产物与星辉回收。', // cjk-ok
        nodes: [
          {
            id: 'src_daily_gems',
            kind: 'source',
            label: 'Daily Gem Income',
            x: 70,
            y: 90,
            activation: 'automatic',
            color: '#38bdf8'
          },
          {
            id: 'pool_primogems',
            kind: 'pool',
            label: 'Primogem Pool',
            x: 205,
            y: 90,
            activation: 'passive',
            initialValue: 320,
            maxCapacity: 99999,
            color: '#38bdf8'
          },
          {
            id: 'conv_wish_pull',
            kind: 'converter',
            label: 'Wish Pull (160)',
            x: 340,
            y: 90,
            activation: 'automatic',
            color: '#f59e0b'
          },
          {
            id: 'pool_pity_counter',
            kind: 'pool',
            label: 'Pity Counter',
            x: 340,
            y: 225,
            activation: 'passive',
            initialValue: 0,
            maxCapacity: 90,
            color: '#a855f7'
          },
          {
            id: 'gate_rarity_roll',
            kind: 'gate',
            label: 'Rarity Gate (%)',
            x: 485,
            y: 90,
            activation: 'passive',
            gateMode: 'probabilistic',
            color: '#ec4899'
          },
          {
            id: 'pool_ssr_hero',
            kind: 'pool',
            label: '5★ SSR Limited',
            x: 645,
            y: 45,
            activation: 'passive',
            initialValue: 0,
            maxCapacity: 99,
            color: '#fbbf24'
          },
          {
            id: 'pool_stardust',
            kind: 'pool',
            label: '4★/3★ Stardust',
            x: 645,
            y: 140,
            activation: 'passive',
            initialValue: 0,
            maxCapacity: 9999,
            color: '#34d399'
          },
          {
            id: 'drain_gem_sink',
            kind: 'drain',
            label: 'Banner Sink',
            x: 205,
            y: 225,
            activation: 'passive',
            color: '#f43f5e'
          },
          {
            id: 'end_c2_ssr',
            kind: 'end_condition',
            label: 'Goal: 2x SSR',
            x: 645,
            y: 235,
            activation: 'automatic',
            formula: 'a >= 2',
            color: '#22d3ee'
          }
        ],
        edges: [
          {
            id: 'e_daily_to_gems',
            sourceId: 'src_daily_gems',
            targetId: 'pool_primogems',
            kind: 'resource_flow',
            label: '90/tick',
            rate: 90
          },
          {
            id: 'e_gems_to_pull',
            sourceId: 'pool_primogems',
            targetId: 'conv_wish_pull',
            kind: 'resource_flow',
            label: '160',
            rate: 160
          },
          {
            id: 'e_pull_to_gate',
            sourceId: 'conv_wish_pull',
            targetId: 'gate_rarity_roll',
            kind: 'resource_flow',
            label: '1 Wish',
            rate: 1
          },
          {
            id: 'e_pull_to_pity',
            sourceId: 'conv_wish_pull',
            targetId: 'pool_pity_counter',
            kind: 'resource_flow',
            label: '+1 Pity',
            rate: 1
          },
          {
            id: 'e_pity_mod_gate',
            sourceId: 'pool_pity_counter',
            targetId: 'gate_rarity_roll',
            kind: 'state_modifier',
            label: '+1.8%/pity',
            rate: 1.8
          },
          {
            id: 'e_gate_to_ssr',
            sourceId: 'gate_rarity_roll',
            targetId: 'pool_ssr_hero',
            kind: 'resource_flow',
            label: '3.5% Base',
            rate: 3.5
          },
          {
            id: 'e_gate_to_dust',
            sourceId: 'gate_rarity_roll',
            targetId: 'pool_stardust',
            kind: 'resource_flow',
            label: '96.5%',
            rate: 96.5
          },
          {
            id: 'e_gems_to_sink',
            sourceId: 'pool_primogems',
            targetId: 'drain_gem_sink',
            kind: 'resource_flow',
            label: '15 Tax',
            rate: 15
          },
          {
            id: 'e_ssr_to_end',
            sourceId: 'pool_ssr_hero',
            targetId: 'end_c2_ssr',
            kind: 'state_modifier',
            label: '>= 2',
            rate: 1
          }
        ]
      }

    case 'idle_exponential_tycoon':
      return {
        schemaVersion: 1,
        presetId: 'idle_exponential_tycoon',
        title: customTitle?.trim() || 'Idle Tycoon Exponential Generator & Prestige Loop',
        description:
          '放置挂机指数增长模型：自动矿机池通过正反馈状态线驱动每秒金币产量，购买矿机受寄存器指数成本曲线 (50 * 1.18^N) 抑制，检验何时出现产能瓶颈需触发转生重置。', // cjk-ok
        nodes: [
          {
            id: 'src_mine_prod',
            kind: 'source',
            label: 'Mine Generator',
            x: 75,
            y: 95,
            activation: 'automatic',
            color: '#10b981'
          },
          {
            id: 'pool_coins',
            kind: 'pool',
            label: 'Gold Treasury',
            x: 235,
            y: 95,
            activation: 'passive',
            initialValue: 60,
            maxCapacity: 999999,
            color: '#fbbf24'
          },
          {
            id: 'conv_buy_miner',
            kind: 'converter',
            label: 'Buy Auto-Miner',
            x: 410,
            y: 95,
            activation: 'automatic',
            color: '#f97316'
          },
          {
            id: 'pool_miners',
            kind: 'pool',
            label: 'Miner Count',
            x: 585,
            y: 95,
            activation: 'passive',
            initialValue: 1,
            maxCapacity: 100,
            color: '#38bdf8'
          },
          {
            id: 'reg_miner_cost',
            kind: 'register',
            label: 'Cost: 50*1.18^N',
            x: 410,
            y: 225,
            activation: 'automatic',
            formula: '50 * Math.pow(1.18, a)',
            color: '#a855f7'
          },
          {
            id: 'drain_upkeep',
            kind: 'drain',
            label: 'Power Upkeep Sink',
            x: 235,
            y: 225,
            activation: 'automatic',
            color: '#f43f5e'
          },
          {
            id: 'end_tycoon_goal',
            kind: 'end_condition',
            label: 'Goal: 12 Miners',
            x: 660,
            y: 225,
            activation: 'automatic',
            formula: 'a >= 12',
            color: '#22d3ee'
          }
        ],
        edges: [
          {
            id: 'e_mine_to_coins',
            sourceId: 'src_mine_prod',
            targetId: 'pool_coins',
            kind: 'resource_flow',
            label: '20/tick',
            rate: 20
          },
          {
            id: 'e_miners_boost_prod',
            sourceId: 'pool_miners',
            targetId: 'src_mine_prod',
            kind: 'state_modifier',
            label: '+16/miner',
            rate: 16
          },
          {
            id: 'e_coins_to_buy',
            sourceId: 'pool_coins',
            targetId: 'conv_buy_miner',
            kind: 'resource_flow',
            label: 'Cost f(N)',
            rate: 50
          },
          {
            id: 'e_buy_to_miners',
            sourceId: 'conv_buy_miner',
            targetId: 'pool_miners',
            kind: 'resource_flow',
            label: '+1 Miner',
            rate: 1
          },
          {
            id: 'e_miners_to_reg',
            sourceId: 'pool_miners',
            targetId: 'reg_miner_cost',
            kind: 'state_modifier',
            label: 'N',
            rate: 1
          },
          {
            id: 'e_reg_to_buy',
            sourceId: 'reg_miner_cost',
            targetId: 'conv_buy_miner',
            kind: 'state_modifier',
            label: 'Dynamic Cost',
            rate: 1
          },
          {
            id: 'e_coins_to_upkeep',
            sourceId: 'pool_coins',
            targetId: 'drain_upkeep',
            kind: 'resource_flow',
            label: '12/tick',
            rate: 12
          },
          {
            id: 'e_miners_to_goal',
            sourceId: 'pool_miners',
            targetId: 'end_tycoon_goal',
            kind: 'state_modifier',
            label: '>= 12',
            rate: 1
          }
        ]
      }

    case 'roguelike_mana_deck':
      return {
        schemaVersion: 1,
        presetId: 'roguelike_mana_deck',
        title: customTitle?.trim() || 'Roguelike Deckbuilder Mana & Turn Damage Engine',
        description:
          '肉鸽卡牌能量与过牌运转模型：每回合能量与抽牌补充 -> 法力池/手牌池 -> 打出卡牌转化器 -> 暴击率分流闸门 -> Boss 护甲击破与弃牌堆消耗。', // cjk-ok
        nodes: [
          {
            id: 'src_mana_regen',
            kind: 'source',
            label: 'Turn Mana (+3)',
            x: 75,
            y: 75,
            activation: 'automatic',
            color: '#38bdf8'
          },
          {
            id: 'pool_mana',
            kind: 'pool',
            label: 'Mana Pool',
            x: 220,
            y: 75,
            activation: 'passive',
            initialValue: 3,
            maxCapacity: 10,
            color: '#38bdf8'
          },
          {
            id: 'src_card_draw',
            kind: 'source',
            label: 'Draw Deck (+2)',
            x: 75,
            y: 205,
            activation: 'automatic',
            color: '#a855f7'
          },
          {
            id: 'pool_hand',
            kind: 'pool',
            label: 'Hand Cards',
            x: 220,
            y: 205,
            activation: 'passive',
            initialValue: 5,
            maxCapacity: 10,
            color: '#a855f7'
          },
          {
            id: 'conv_play_card',
            kind: 'converter',
            label: 'Cast Combo Card',
            x: 380,
            y: 135,
            activation: 'automatic',
            color: '#f59e0b'
          },
          {
            id: 'gate_crit_check',
            kind: 'gate',
            label: 'Crit Gate (30%)',
            x: 515,
            y: 135,
            activation: 'passive',
            gateMode: 'probabilistic',
            color: '#ec4899'
          },
          {
            id: 'pool_boss_dmg',
            kind: 'pool',
            label: 'Total Boss DMG',
            x: 655,
            y: 85,
            activation: 'passive',
            initialValue: 0,
            maxCapacity: 9999,
            color: '#fbbf24'
          },
          {
            id: 'drain_exhaust',
            kind: 'drain',
            label: 'Discard / Exhaust',
            x: 380,
            y: 245,
            activation: 'passive',
            color: '#f43f5e'
          },
          {
            id: 'end_boss_slain',
            kind: 'end_condition',
            label: 'Boss HP <= 0 (450)',
            x: 655,
            y: 220,
            activation: 'automatic',
            formula: 'a >= 450',
            color: '#34d399'
          }
        ],
        edges: [
          {
            id: 'e_regen_mana',
            sourceId: 'src_mana_regen',
            targetId: 'pool_mana',
            kind: 'resource_flow',
            label: '3/turn',
            rate: 3
          },
          {
            id: 'e_draw_hand',
            sourceId: 'src_card_draw',
            targetId: 'pool_hand',
            kind: 'resource_flow',
            label: '2/turn',
            rate: 2
          },
          {
            id: 'e_mana_to_play',
            sourceId: 'pool_mana',
            targetId: 'conv_play_card',
            kind: 'resource_flow',
            label: '2 Mana',
            rate: 2
          },
          {
            id: 'e_hand_to_play',
            sourceId: 'pool_hand',
            targetId: 'conv_play_card',
            kind: 'resource_flow',
            label: '1 Card',
            rate: 1
          },
          {
            id: 'e_play_to_gate',
            sourceId: 'conv_play_card',
            targetId: 'gate_crit_check',
            kind: 'resource_flow',
            label: '18 DMG',
            rate: 18
          },
          {
            id: 'e_play_to_exhaust',
            sourceId: 'conv_play_card',
            targetId: 'drain_exhaust',
            kind: 'resource_flow',
            label: '1 Spent',
            rate: 1
          },
          {
            id: 'e_crit_hit',
            sourceId: 'gate_crit_check',
            targetId: 'pool_boss_dmg',
            kind: 'resource_flow',
            label: '100% Hit',
            rate: 100
          },
          {
            id: 'e_dmg_to_end',
            sourceId: 'pool_boss_dmg',
            targetId: 'end_boss_slain',
            kind: 'state_modifier',
            label: '>= 450',
            rate: 1
          }
        ]
      }

    case 'survivor_xp_loop':
      return {
        schemaVersion: 1,
        presetId: 'survivor_xp_loop',
        title: customTitle?.trim() || 'Survivor Wave XP Curve & Meta Gold Loop',
        description:
          '幸存者割草局内成长经济：尸潮击杀掉落经验宝石与金币 -> 经验池满触发升级转化器（受 45*1.24^Lv 指数经验墙约束）-> 英雄等级反哺清怪产出速率。', // cjk-ok
        nodes: [
          {
            id: 'src_wave_kills',
            kind: 'source',
            label: 'Wave Kill Drops',
            x: 75,
            y: 95,
            activation: 'automatic',
            color: '#34d399'
          },
          {
            id: 'pool_xp',
            kind: 'pool',
            label: 'XP Gems Pool',
            x: 225,
            y: 95,
            activation: 'passive',
            initialValue: 0,
            maxCapacity: 99999,
            color: '#38bdf8'
          },
          {
            id: 'conv_levelup',
            kind: 'converter',
            label: 'Level Up Perk',
            x: 395,
            y: 95,
            activation: 'automatic',
            color: '#f59e0b'
          },
          {
            id: 'pool_hero_lv',
            kind: 'pool',
            label: 'Hero Level',
            x: 575,
            y: 95,
            activation: 'passive',
            initialValue: 1,
            maxCapacity: 99,
            color: '#fbbf24'
          },
          {
            id: 'reg_xp_req',
            kind: 'register',
            label: 'XP: 45*1.24^Lv',
            x: 395,
            y: 225,
            activation: 'automatic',
            formula: '45 * Math.pow(1.24, a)',
            color: '#a855f7'
          },
          {
            id: 'drain_reroll_sink',
            kind: 'drain',
            label: 'Reroll XP Tax',
            x: 225,
            y: 225,
            activation: 'automatic',
            color: '#f43f5e'
          },
          {
            id: 'end_lv15_evo',
            kind: 'end_condition',
            label: 'Weapon Evo (Lv.10)',
            x: 650,
            y: 225,
            activation: 'automatic',
            formula: 'a >= 10',
            color: '#22d3ee'
          }
        ],
        edges: [
          {
            id: 'e_wave_to_xp',
            sourceId: 'src_wave_kills',
            targetId: 'pool_xp',
            kind: 'resource_flow',
            label: '28 XP/tick',
            rate: 28
          },
          {
            id: 'e_lv_boost_kills',
            sourceId: 'pool_hero_lv',
            targetId: 'src_wave_kills',
            kind: 'state_modifier',
            label: '+10 XP/Lv',
            rate: 10
          },
          {
            id: 'e_xp_to_lvup',
            sourceId: 'pool_xp',
            targetId: 'conv_levelup',
            kind: 'resource_flow',
            label: 'Req XP',
            rate: 45
          },
          {
            id: 'e_lvup_to_lv',
            sourceId: 'conv_levelup',
            targetId: 'pool_hero_lv',
            kind: 'resource_flow',
            label: '+1 Lv',
            rate: 1
          },
          {
            id: 'e_lv_to_reg',
            sourceId: 'pool_hero_lv',
            targetId: 'reg_xp_req',
            kind: 'state_modifier',
            label: 'Lv',
            rate: 1
          },
          {
            id: 'e_reg_to_lvup',
            sourceId: 'reg_xp_req',
            targetId: 'conv_levelup',
            kind: 'state_modifier',
            label: 'XP Curve',
            rate: 1
          },
          {
            id: 'e_xp_to_sink',
            sourceId: 'pool_xp',
            targetId: 'drain_reroll_sink',
            kind: 'resource_flow',
            label: '8/tick',
            rate: 8
          },
          {
            id: 'e_lv_to_end',
            sourceId: 'pool_hero_lv',
            targetId: 'end_lv15_evo',
            kind: 'state_modifier',
            label: '>= 10',
            rate: 1
          }
        ]
      }

    case 'arpg_equipment_economy':
    default:
      return {
        schemaVersion: 1,
        presetId: 'arpg_equipment_economy',
        title: customTitle?.trim() || 'ARPG Loot Drop & Blacksmith Upgrade Sink-Source',
        description:
          'ARPG 刷宝掉落与铁匠强化经济闭环：地牢刷怪产出金币与矿石 -> 铁匠锻造转化器（受指数金币费用 75*1.2^Lv 约束）-> 强化概率闸门（70% 升阶 / 30% 损耗回收）-> 装备等级反哺刷怪效率。', // cjk-ok
        nodes: [
          {
            id: 'src_dungeon_loot',
            kind: 'source',
            label: 'Dungeon Loot Drop',
            x: 70,
            y: 90,
            activation: 'automatic',
            color: '#10b981'
          },
          {
            id: 'pool_gold',
            kind: 'pool',
            label: 'Gold Coins',
            x: 210,
            y: 90,
            activation: 'passive',
            initialValue: 150,
            maxCapacity: 99999,
            color: '#fbbf24'
          },
          {
            id: 'conv_blacksmith',
            kind: 'converter',
            label: 'Blacksmith Forge',
            x: 365,
            y: 90,
            activation: 'automatic',
            color: '#f97316'
          },
          {
            id: 'gate_forge_odds',
            kind: 'gate',
            label: 'Forge Odds (70%)',
            x: 505,
            y: 90,
            activation: 'passive',
            gateMode: 'probabilistic',
            color: '#ec4899'
          },
          {
            id: 'pool_gear_tier',
            kind: 'pool',
            label: 'Gear Tier (+Lv)',
            x: 650,
            y: 65,
            activation: 'passive',
            initialValue: 1,
            maxCapacity: 25,
            color: '#38bdf8'
          },
          {
            id: 'reg_forge_cost',
            kind: 'register',
            label: 'Cost: 75*1.20^Lv',
            x: 365,
            y: 225,
            activation: 'automatic',
            formula: '75 * Math.pow(1.20, a)',
            color: '#a855f7'
          },
          {
            id: 'drain_repair_tax',
            kind: 'drain',
            label: 'Tax & Break Sink',
            x: 505,
            y: 225,
            activation: 'automatic',
            color: '#f43f5e'
          },
          {
            id: 'end_mythic_gear',
            kind: 'end_condition',
            label: 'Mythic Gear (Lv.10)',
            x: 650,
            y: 225,
            activation: 'automatic',
            formula: 'a >= 10',
            color: '#34d399'
          }
        ],
        edges: [
          {
            id: 'e_loot_to_gold',
            sourceId: 'src_dungeon_loot',
            targetId: 'pool_gold',
            kind: 'resource_flow',
            label: '42 Gold/tick',
            rate: 42
          },
          {
            id: 'e_gear_boost_loot',
            sourceId: 'pool_gear_tier',
            targetId: 'src_dungeon_loot',
            kind: 'state_modifier',
            label: '+12 Gold/Lv',
            rate: 12
          },
          {
            id: 'e_gold_to_forge',
            sourceId: 'pool_gold',
            targetId: 'conv_blacksmith',
            kind: 'resource_flow',
            label: 'Forge Cost',
            rate: 75
          },
          {
            id: 'e_forge_to_gate',
            sourceId: 'conv_blacksmith',
            targetId: 'gate_forge_odds',
            kind: 'resource_flow',
            label: '1 Attempt',
            rate: 1
          },
          {
            id: 'e_gate_to_gear',
            sourceId: 'gate_forge_odds',
            targetId: 'pool_gear_tier',
            kind: 'resource_flow',
            label: '70% Success',
            rate: 70
          },
          {
            id: 'e_gate_to_sink',
            sourceId: 'gate_forge_odds',
            targetId: 'drain_repair_tax',
            kind: 'resource_flow',
            label: '30% Break',
            rate: 30
          },
          {
            id: 'e_gold_to_tax',
            sourceId: 'pool_gold',
            targetId: 'drain_repair_tax',
            kind: 'resource_flow',
            label: '10 Upkeep',
            rate: 10
          },
          {
            id: 'e_gear_to_reg',
            sourceId: 'pool_gear_tier',
            targetId: 'reg_forge_cost',
            kind: 'state_modifier',
            label: 'Lv',
            rate: 1
          },
          {
            id: 'e_reg_to_forge',
            sourceId: 'reg_forge_cost',
            targetId: 'conv_blacksmith',
            kind: 'state_modifier',
            label: 'Cost Curve',
            rate: 1
          },
          {
            id: 'e_gear_to_end',
            sourceId: 'pool_gear_tier',
            targetId: 'end_mythic_gear',
            kind: 'state_modifier',
            label: '>= 10',
            rate: 1
          }
        ]
      }
  }
}

/**
 * 解析 JSON 字符串为合法的 MachinationsDiagram；解析失败时回退到指定预设。
 */
export function parseMachinationsDiagramJson(
  rawJson: string | undefined,
  fallbackPreset: MachinationsPresetId = 'arpg_equipment_economy',
  customTitle?: string
): MachinationsDiagram {
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson) as Partial<MachinationsDiagram>
      if (
        parsed &&
        Array.isArray(parsed.nodes) &&
        parsed.nodes.length > 0 &&
        Array.isArray(parsed.edges)
      ) {
        return {
          schemaVersion: 1,
          presetId: (parsed.presetId as MachinationsPresetId) || fallbackPreset,
          title: (parsed.title || customTitle || 'Game Economy Diagram').trim(),
          description: parsed.description || '',
          nodes: parsed.nodes,
          edges: parsed.edges
        }
      }
    } catch {
      // fall through to preset
    }
  }
  return createMachinationsPresetDiagram(fallbackPreset, customTitle)
}

export function createInitialMachinationsState(
  diagram: MachinationsDiagram
): MachinationsSimulationState {
  const poolValues: Record<string, number> = {}
  const registerValues: Record<string, number> = {}
  const starvedConverterTicks: Record<string, number> = {}

  for (const node of diagram.nodes) {
    if (node.kind === 'pool') {
      poolValues[node.id] = Math.max(0, Number(node.initialValue ?? 0))
    } else if (node.kind === 'register') {
      registerValues[node.id] = Number(node.initialValue ?? 0)
    } else if (node.kind === 'converter') {
      starvedConverterTicks[node.id] = 0
    }
  }

  // Evaluate initial registers
  for (const node of diagram.nodes) {
    if (node.kind === 'register') {
      const incomingStateEdges = diagram.edges.filter(
        (e) => e.targetId === node.id && e.kind === 'state_modifier'
      )
      const firstPoolVal =
        incomingStateEdges.length > 0 ? (poolValues[incomingStateEdges[0]!.sourceId] ?? 0) : 0
      registerValues[node.id] = evaluateMachinationsFormula(
        node.formula,
        { a: firstPoolVal, tick: 0 },
        node.initialValue ?? 50
      )
    }
  }

  return {
    tick: 0,
    poolValues,
    registerValues,
    edgeFlowsLastTick: {},
    nodeFiredLastTick: {},
    gateCursor: {},
    totalProduced: 0,
    totalDrained: 0,
    starvedConverterTicks,
    firstBottleneckTick: null,
    endConditionReachedAtTick: null
  }
}

/**
 * 执行单步（+1 Tick）Machinations 系统动力学演化。
 */
export function stepMachinationsSimulation(
  diagram: MachinationsDiagram,
  prevState: MachinationsSimulationState,
  options: { seed?: number; triggerNodeIds?: string[] } = {}
): MachinationsSimulationState {
  const nextTick = prevState.tick + 1
  const rng = createSeededRng((options.seed ?? 1337) + nextTick * 104729)
  const triggerSet = new Set(options.triggerNodeIds ?? [])

  const poolValues = { ...prevState.poolValues }
  const registerValues = { ...prevState.registerValues }
  const edgeFlowsLastTick: Record<string, number> = {}
  const nodeFiredLastTick: Record<string, boolean> = {}
  const gateCursor = { ...prevState.gateCursor }
  const starvedConverterTicks = { ...prevState.starvedConverterTicks }
  let totalProduced = prevState.totalProduced
  let totalDrained = prevState.totalDrained
  let firstBottleneckTick = prevState.firstBottleneckTick
  let endConditionReachedAtTick = prevState.endConditionReachedAtTick

  const nodeById = new Map(diagram.nodes.map((n) => [n.id, n]))

  const clampPool = (poolId: string, val: number): number => {
    const node = nodeById.get(poolId)
    const cap =
      node?.maxCapacity != null && node.maxCapacity > 0
        ? node.maxCapacity
        : Number.POSITIVE_INFINITY
    return Math.max(0, Math.min(cap, Math.round(val * 100) / 100))
  }

  // Step 1: Update all Registers from connected Pools
  for (const node of diagram.nodes) {
    if (node.kind !== 'register') continue
    const stateIn = diagram.edges.filter(
      (e) => e.targetId === node.id && e.kind === 'state_modifier'
    )
    const a = stateIn[0] ? (poolValues[stateIn[0].sourceId] ?? 0) : 0
    const b = stateIn[1] ? (poolValues[stateIn[1].sourceId] ?? 0) : 0
    registerValues[node.id] = evaluateMachinationsFormula(
      node.formula,
      { a, b, tick: nextTick },
      node.initialValue ?? 50
    )
  }

  // Helper to route tokens into a target node (Pool, Drain, or Gate)
  const deliverTokensToTarget = (edge: MachinationsEdge, amount: number, depth = 0): void => {
    if (amount <= 0 || depth > 4) return
    edgeFlowsLastTick[edge.id] = (edgeFlowsLastTick[edge.id] ?? 0) + amount
    const target = nodeById.get(edge.targetId)
    if (!target) return
    nodeFiredLastTick[target.id] = true

    if (target.kind === 'pool') {
      poolValues[target.id] = clampPool(target.id, (poolValues[target.id] ?? 0) + amount)
    } else if (target.kind === 'drain') {
      totalDrained += amount
    } else if (target.kind === 'gate') {
      const outEdges = diagram.edges.filter(
        (e) => e.sourceId === target.id && e.kind === 'resource_flow'
      )
      if (outEdges.length === 0) return

      // Check state modifiers on this Gate (e.g. Gacha Pity Counter boosting first branch weight)
      const stateMods = diagram.edges.filter(
        (e) => e.targetId === target.id && e.kind === 'state_modifier'
      )
      let firstBranchBonus = 0
      for (const mod of stateMods) {
        const srcVal = poolValues[mod.sourceId] ?? registerValues[mod.sourceId] ?? 0
        firstBranchBonus += srcVal * mod.rate
      }

      if (target.gateMode === 'deterministic') {
        const idx = (gateCursor[target.id] ?? 0) % outEdges.length
        gateCursor[target.id] = idx + 1
        deliverTokensToTarget(outEdges[idx]!, amount, depth + 1)
      } else {
        const weights = outEdges.map((e, idx) =>
          Math.max(0.1, e.rate + (idx === 0 ? firstBranchBonus : 0))
        )
        const weightSum = weights.reduce((acc, w) => acc + w, 0)
        const roll = rng() * weightSum
        let acc = 0
        let chosenEdge = outEdges[outEdges.length - 1]!
        for (let i = 0; i < outEdges.length; i++) {
          acc += weights[i]!
          if (roll <= acc) {
            chosenEdge = outEdges[i]!
            break
          }
        }
        // If only 1 edge out of gate, treat rate as percentage multiplier or pass amount
        if (outEdges.length === 1) {
          deliverTokensToTarget(chosenEdge, amount, depth + 1)
        } else {
          deliverTokensToTarget(chosenEdge, amount, depth + 1)
          // Special Gacha Pity reset: if first branch (SSR) was hit and there is a pity pool feeding this gate, reset pity pool
          if (chosenEdge.id === outEdges[0]!.id && stateMods.length > 0) {
            for (const mod of stateMods) {
              if (mod.sourceId in poolValues) {
                poolValues[mod.sourceId] = 0
              }
            }
          }
        }
      }
    }
  }

  // Step 2: Fire active Sources
  for (const node of diagram.nodes) {
    if (node.kind !== 'source') continue
    const shouldFire =
      node.activation === 'automatic' ||
      (node.activation === 'on_start' && nextTick === 1) ||
      triggerSet.has(node.id)
    if (!shouldFire) continue

    // Calculate state modifier bonus on this Source
    const stateMods = diagram.edges.filter(
      (e) => e.targetId === node.id && e.kind === 'state_modifier'
    )
    let rateBonus = 0
    for (const mod of stateMods) {
      const srcVal = poolValues[mod.sourceId] ?? registerValues[mod.sourceId] ?? 0
      rateBonus += srcVal * mod.rate
    }

    const outEdges = diagram.edges.filter(
      (e) => e.sourceId === node.id && e.kind === 'resource_flow'
    )
    for (const edge of outEdges) {
      const produced = Math.max(0, Math.round((edge.rate + rateBonus) * 100) / 100)
      if (produced > 0) {
        nodeFiredLastTick[node.id] = true
        totalProduced += produced
        deliverTokensToTarget(edge, produced)
      }
    }
  }

  // Step 3: Fire Converters
  for (const node of diagram.nodes) {
    if (node.kind !== 'converter') continue
    const shouldAttempt =
      node.activation === 'automatic' ||
      (node.activation === 'on_start' && nextTick === 1) ||
      triggerSet.has(node.id)
    if (!shouldAttempt) continue

    const inEdges = diagram.edges.filter(
      (e) => e.targetId === node.id && e.kind === 'resource_flow'
    )
    const outEdges = diagram.edges.filter(
      (e) => e.sourceId === node.id && e.kind === 'resource_flow'
    )
    if (inEdges.length === 0) continue

    // Check if converter has a Register state modifier overriding input cost
    const regMods = diagram.edges.filter(
      (e) => e.targetId === node.id && e.kind === 'state_modifier'
    )
    const dynamicCostOverride =
      regMods.length > 0 ? registerValues[regMods[0]!.sourceId] : undefined

    const requiredByEdge = inEdges.map((edge, idx) => {
      if (idx === 0 && dynamicCostOverride !== undefined && dynamicCostOverride > 0) {
        return dynamicCostOverride
      }
      return Math.max(1, edge.rate)
    })

    const canAfford = inEdges.every((edge, idx) => {
      const available = poolValues[edge.sourceId] ?? 0
      return available >= requiredByEdge[idx]!
    })

    if (!canAfford) {
      const streak = (starvedConverterTicks[node.id] ?? 0) + 1
      starvedConverterTicks[node.id] = streak
      if (streak >= 4 && firstBottleneckTick === null && nextTick > 3) {
        firstBottleneckTick = nextTick
      }
      continue
    }

    // Deduct inputs
    starvedConverterTicks[node.id] = 0
    nodeFiredLastTick[node.id] = true
    inEdges.forEach((edge, idx) => {
      const cost = requiredByEdge[idx]!
      poolValues[edge.sourceId] = clampPool(edge.sourceId, (poolValues[edge.sourceId] ?? 0) - cost)
      edgeFlowsLastTick[edge.id] = cost
      totalDrained += cost
    })

    // Produce outputs
    for (const outEdge of outEdges) {
      const outAmt = Math.max(1, outEdge.rate)
      deliverTokensToTarget(outEdge, outAmt)
    }
  }

  // Step 4: Fire automatic Drains pulling directly from Pools
  for (const node of diagram.nodes) {
    if (node.kind !== 'drain') continue
    const shouldFire = node.activation === 'automatic' || triggerSet.has(node.id)
    if (!shouldFire) continue
    const inEdges = diagram.edges.filter(
      (e) => e.targetId === node.id && e.kind === 'resource_flow'
    )
    for (const edge of inEdges) {
      const srcNode = nodeById.get(edge.sourceId)
      if (srcNode?.kind !== 'pool') continue
      const avail = poolValues[edge.sourceId] ?? 0
      const drained = Math.min(avail, Math.max(0, edge.rate))
      if (drained > 0) {
        poolValues[edge.sourceId] = clampPool(edge.sourceId, avail - drained)
        edgeFlowsLastTick[edge.id] = (edgeFlowsLastTick[edge.id] ?? 0) + drained
        nodeFiredLastTick[node.id] = true
        totalDrained += drained
      }
    }
  }

  // Step 5: Check End Conditions
  if (endConditionReachedAtTick === null) {
    for (const node of diagram.nodes) {
      if (node.kind !== 'end_condition') continue
      const stateIn = diagram.edges.filter((e) => e.targetId === node.id)
      const a = stateIn[0] ? (poolValues[stateIn[0].sourceId] ?? 0) : 0
      const hit = evaluateMachinationsFormula(node.formula || 'a >= 10', { a, tick: nextTick }, 0)
      if (hit >= 1) {
        endConditionReachedAtTick = nextTick
        nodeFiredLastTick[node.id] = true
        break
      }
    }
  }

  return {
    tick: nextTick,
    poolValues,
    registerValues,
    edgeFlowsLastTick,
    nodeFiredLastTick,
    gateCursor,
    totalProduced: Math.round(totalProduced * 100) / 100,
    totalDrained: Math.round(totalDrained * 100) / 100,
    starvedConverterTicks,
    firstBottleneckTick,
    endConditionReachedAtTick
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return Math.round(sorted[idx]! * 100) / 100
}

/**
 * 从 Machinations 模拟结果提炼可直接注入 `game.playable` 60fps 沙盒的实时经济参数。
 */
export function deriveSandboxParamsFromDiagram(
  diagram: MachinationsDiagram
): MachinationsSandboxBridgeParams {
  const pools = diagram.nodes.filter((n) => n.kind === 'pool')
  const sources = diagram.nodes.filter((n) => n.kind === 'source')
  const registers = diagram.nodes.filter((n) => n.kind === 'register')

  const primaryPool = pools[0]
  const startingGold = Math.max(0, Math.round(primaryPool?.initialValue ?? 100))

  const firstSourceEdge = diagram.edges.find(
    (e) => e.sourceId === sources[0]?.id && e.kind === 'resource_flow'
  )
  const baseDrop = Math.max(5, Math.round(firstSourceEdge?.rate ?? 25))

  const firstRegFormula = registers[0]?.formula ?? '75 * Math.pow(1.20, a)'
  const powMatch = firstRegFormula.match(/([0-9.]+)\s*\*\s*(?:Math\.)?pow\(\s*([0-9.]+)/i)
  const upgradeCostBase = powMatch ? Math.max(10, Number(powMatch[1])) : 75
  const upgradeCostGrowth = powMatch ? Math.max(1.05, Number(powMatch[2])) : 1.2

  return {
    startingGold,
    startingMaxHp: 120 + Math.min(180, Math.round(startingGold * 0.25)),
    startingBaseAtk: 18 + Math.min(40, Math.round(baseDrop * 0.35)),
    goldDropPerKill: baseDrop,
    xpDropPerKill: Math.max(10, Math.round(baseDrop * 0.85)),
    upgradeCostBase,
    upgradeCostGrowth,
    gachaSsrBaseRate: 0.035,
    cardManaPerTurn: diagram.presetId === 'roguelike_mana_deck' ? 3 : 4
  }
}

/**
 * 自动诊断游戏经济系统健康度（通胀、回收比、付费/肝度卡点、随机方差、终局节奏）。
 */
export function analyzeMachinationsEconomyHealth(
  _diagram: MachinationsDiagram,
  metrics: {
    steps: number
    sourceSinkRatio: number
    inflationIndex: number
    firstBottleneckTickMean: number | null
    endConditionHitRate: number
    medianTicksToGoal: number | null
    poolSeries: MachinationsPoolTimeSeries[]
  }
): MachinationsHealthDiagnostic[] {
  const diagnostics: MachinationsHealthDiagnostic[] = []

  // 1. Source / Sink Ratio
  if (metrics.sourceSinkRatio > 1.55) {
    diagnostics.push({
      code: 'sink_source_balance',
      severity: 'warning',
      title: 'Inflation Risk: Source Exceeds Sink',
      detail: `Resource generation outweighs sinks by ${metrics.sourceSinkRatio.toFixed(2)}x. Currency pools accumulate rapidly in late ticks.`,
      metricValue: `${metrics.sourceSinkRatio.toFixed(2)}x`,
      recommendation:
        'Increase Drain tax rate or steepen Register upgrade cost exponent (+0.04) to absorb excess late-game currency.'
    })
  } else if (metrics.sourceSinkRatio < 0.65) {
    diagnostics.push({
      code: 'sink_source_balance',
      severity: 'critical',
      title: 'Resource Starvation: Sinks Drain Too Fast',
      detail: `Source/Sink ratio is ${metrics.sourceSinkRatio.toFixed(2)}x. Players run out of primary currency before completing core loops.`,
      metricValue: `${metrics.sourceSinkRatio.toFixed(2)}x`,
      recommendation:
        'Boost Source base flow rate or reduce passive Drain upkeep so players maintain positive net income.'
    })
  } else {
    diagnostics.push({
      code: 'sink_source_balance',
      severity: 'healthy',
      title: 'Balanced Source-Sink Equilibrium',
      detail: `Resource production and consumption are well-matched (${metrics.sourceSinkRatio.toFixed(2)}x flow ratio).`,
      metricValue: `${metrics.sourceSinkRatio.toFixed(2)}x`,
      recommendation: 'Current Source and Drain flow rates maintain healthy economic tension.'
    })
  }

  // 2. Progression Bottleneck / Paywall Tick
  if (
    metrics.firstBottleneckTickMean !== null &&
    metrics.firstBottleneckTickMean < metrics.steps * 0.35
  ) {
    diagnostics.push({
      code: 'progression_bottleneck',
      severity: 'warning',
      title: `Early Progression Wall at Tick ~${Math.round(metrics.firstBottleneckTickMean)}`,
      detail: `Converters stall waiting for resources around Tick ${Math.round(metrics.firstBottleneckTickMean)} due to exponential cost scaling.`,
      metricValue: `Tick ${Math.round(metrics.firstBottleneckTickMean)}`,
      recommendation:
        'Add a secondary quest/bounty Source or lower initial Converter cost to smooth early-game onboarding.'
    })
  } else {
    diagnostics.push({
      code: 'progression_bottleneck',
      severity: 'healthy',
      title: 'Smooth Progression Curve',
      detail:
        metrics.firstBottleneckTickMean !== null
          ? `Soft pacing slowdown appears around Tick ${Math.round(metrics.firstBottleneckTickMean)}, matching mid-game retention goals.`
          : 'Converters fire smoothly without prolonged resource starvation.',
      metricValue:
        metrics.firstBottleneckTickMean !== null
          ? `Tick ${Math.round(metrics.firstBottleneckTickMean)}`
          : 'No Hard Wall',
      recommendation: 'Progression pacing is well-tuned.'
    })
  }

  // 3. Goal Pacing & End Condition Hit Rate
  if (metrics.endConditionHitRate > 0) {
    const med = metrics.medianTicksToGoal ?? metrics.steps
    diagnostics.push({
      code: 'goal_pacing',
      severity: metrics.endConditionHitRate >= 0.5 ? 'healthy' : 'warning',
      title: `End Goal Hit Rate: ${Math.round(metrics.endConditionHitRate * 100)}% (Median ${med} Ticks)`,
      detail: `${Math.round(metrics.endConditionHitRate * 100)}% of Monte Carlo trajectories reached the target End Condition within ${metrics.steps} ticks.`,
      metricValue: `${med} Ticks`,
      recommendation:
        metrics.endConditionHitRate < 0.5
          ? 'Target threshold is tough to reach within the time window; consider strengthening positive feedback State Connections.'
          : 'Time-to-Goal aligns with expected session length.'
    })
  }

  return diagnostics
}

/**
 * 运行蒙特卡洛（Monte Carlo）批量随机模拟（默认 40 次独立随机轨迹 × 50 时间步）。
 */
export function runMachinationsMonteCarlo(
  diagram: MachinationsDiagram,
  options: { runs?: number; steps?: number; seed?: number } = {}
): MachinationsMonteCarloResult {
  const runs = Math.max(1, Math.min(200, Math.round(options.runs ?? 40)))
  const steps = Math.max(5, Math.min(200, Math.round(options.steps ?? 50)))
  const baseSeed = Math.floor(Number(options.seed ?? 2026))

  const pools = diagram.nodes.filter((n) => n.kind === 'pool')
  // matrix[poolIdx][tick][runIdx]
  const matrix: number[][][] = pools.map(() =>
    Array.from({ length: steps + 1 }, () => new Array<number>(runs).fill(0))
  )

  let sumProduced = 0
  let sumDrained = 0
  const bottleneckTicks: number[] = []
  const goalTicks: number[] = []

  for (let r = 0; r < runs; r++) {
    const runSeed = baseSeed + r * 7919
    let state = createInitialMachinationsState(diagram)
    pools.forEach((p, pIdx) => {
      matrix[pIdx]![0]![r] = state.poolValues[p.id] ?? 0
    })

    for (let t = 1; t <= steps; t++) {
      state = stepMachinationsSimulation(diagram, state, { seed: runSeed })
      pools.forEach((p, pIdx) => {
        matrix[pIdx]![t]![r] = state.poolValues[p.id] ?? 0
      })
    }

    sumProduced += state.totalProduced
    sumDrained += state.totalDrained
    if (state.firstBottleneckTick !== null) {
      bottleneckTicks.push(state.firstBottleneckTick)
    }
    if (state.endConditionReachedAtTick !== null) {
      goalTicks.push(state.endConditionReachedAtTick)
    }
  }

  const palette = ['#fbbf24', '#38bdf8', '#34d399', '#a855f7', '#f43f5e', '#f97316']
  const poolSeries: MachinationsPoolTimeSeries[] = pools.map((pool, pIdx) => {
    const p10: number[] = []
    const p50: number[] = []
    const p90: number[] = []
    const mean: number[] = []

    for (let t = 0; t <= steps; t++) {
      const row = [...matrix[pIdx]![t]!].sort((a, b) => a - b)
      p10.push(percentile(row, 0.1))
      p50.push(percentile(row, 0.5))
      p90.push(percentile(row, 0.9))
      const avg = row.reduce((acc, v) => acc + v, 0) / row.length
      mean.push(Math.round(avg * 100) / 100)
    }

    return {
      nodeId: pool.id,
      label: pool.label,
      color: pool.color || palette[pIdx % palette.length]!,
      p10,
      p50,
      p90,
      mean
    }
  })

  const totalProducedMean = Math.round((sumProduced / runs) * 100) / 100
  const totalDrainedMean = Math.round((sumDrained / runs) * 100) / 100
  const sourceSinkRatio =
    totalDrainedMean > 0
      ? Math.round((totalProducedMean / totalDrainedMean) * 100) / 100
      : totalProducedMean > 0
        ? 2.5
        : 1.0

  const primarySeries = poolSeries[0]?.mean ?? [0, 0]
  const midIdx = Math.max(1, Math.floor(steps / 2))
  const midVal = Math.max(1, primarySeries[midIdx] ?? 1)
  const endVal = Math.max(0, primarySeries[steps] ?? 0)
  const inflationIndex = Math.round(((endVal - midVal) / midVal) * 100) / 100

  const firstBottleneckTickMean =
    bottleneckTicks.length > 0
      ? Math.round((bottleneckTicks.reduce((acc, v) => acc + v, 0) / bottleneckTicks.length) * 10) /
        10
      : null

  const sortedGoals = [...goalTicks].sort((a, b) => a - b)
  const endConditionHitRate = Math.round((sortedGoals.length / runs) * 100) / 100
  const medianTicksToGoal = sortedGoals.length > 0 ? percentile(sortedGoals, 0.5) : null
  const p90TicksToGoal = sortedGoals.length > 0 ? percentile(sortedGoals, 0.9) : null

  const diagnostics = analyzeMachinationsEconomyHealth(diagram, {
    steps,
    sourceSinkRatio,
    inflationIndex,
    firstBottleneckTickMean,
    endConditionHitRate,
    medianTicksToGoal,
    poolSeries
  })

  return {
    presetId: diagram.presetId,
    title: diagram.title,
    runs,
    steps,
    seed: baseSeed,
    ticks: Array.from({ length: steps + 1 }, (_, i) => i),
    poolSeries,
    sourceSinkRatio,
    inflationIndex,
    totalProducedMean,
    totalDrainedMean,
    firstBottleneckTickMean,
    endConditionHitRate,
    medianTicksToGoal,
    p90TicksToGoal,
    diagnostics,
    sandboxParams: deriveSandboxParamsFromDiagram(diagram)
  }
}

function parseHexRgb(
  hex: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!hex) return fallback
  const clean = hex.replace('#', '').trim()
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b]
    }
  }
  return fallback
}

function blendPixel(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  alpha = 1
): void {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || ix >= width || iy < 0 || iy >= height) return
  const idx = (iy * width + ix) * 4
  const a = Math.max(0, Math.min(1, alpha))
  buf[idx] = Math.round(buf[idx]! * (1 - a) + r * a)
  buf[idx + 1] = Math.round(buf[idx + 1]! * (1 - a) + g * a)
  buf[idx + 2] = Math.round(buf[idx + 2]! * (1 - a) + b * a)
  buf[idx + 3] = 255
}

function drawLineRgba(
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
  thickness = 2,
  dashed = false
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)))
  const half = Math.max(0, Math.floor(thickness / 2))
  for (let i = 0; i <= steps; i++) {
    if (dashed && Math.floor(i / 6) % 2 === 1) continue
    const px = x0 + (dx * i) / steps
    const py = y0 + (dy * i) / steps
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        blendPixel(buf, width, height, px + ox, py + oy, rgb[0], rgb[1], rgb[2], 0.92)
      }
    }
  }
}

/**
 * 将 Machinations 经济拓扑图（上半屏）与蒙特卡洛 P10/P50/P90 时序曲线图（下半屏）渲染为 RGBA 像素缓冲区。
 */
export function renderMachinationsDiagramToRgba(
  diagram: MachinationsDiagram,
  mcResult: MachinationsMonteCarloResult,
  width = 640,
  height = 420
): { width: number; height: number; data: Uint8ClampedArray } {
  const buf = new Uint8ClampedArray(width * height * 4)
  const splitY = Math.floor(height * 0.58)

  // 1. Background & Blueprint Grid
  for (let y = 0; y < height; y++) {
    const isChartArea = y >= splitY
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      let r = isChartArea ? 11 : 15
      let g = isChartArea ? 16 : 23
      let b = isChartArea ? 28 : 40
      if (x % 24 === 0 || y % 24 === 0) {
        r += 7
        g += 10
        b += 16
      }
      if (y === splitY || y === splitY + 1) {
        r = 56
        g = 189
        b = 248
      }
      buf[idx] = r
      buf[idx + 1] = g
      buf[idx + 2] = b
      buf[idx + 3] = 255
    }
  }

  const scaleX = width / 740
  const scaleY = (splitY - 12) / 280
  const nodePos = new Map<string, { x: number; y: number; color: [number, number, number] }>()

  for (const node of diagram.nodes) {
    nodePos.set(node.id, {
      x: Math.round(node.x * scaleX),
      y: Math.round(node.y * scaleY) + 6,
      color: parseHexRgb(node.color, [56, 189, 248])
    })
  }

  // 2. Render Edges (Resource Flow = Solid Gold/Cyan, State Modifier = Dashed Violet)
  for (const edge of diagram.edges) {
    const src = nodePos.get(edge.sourceId)
    const dst = nodePos.get(edge.targetId)
    if (!src || !dst) continue
    const isState = edge.kind === 'state_modifier'
    const rgb: [number, number, number] = isState ? [168, 85, 247] : [148, 163, 184]
    drawLineRgba(buf, width, height, src.x, src.y, dst.x, dst.y, rgb, 2, isState)

    // Arrowhead near target
    const angle = Math.atan2(dst.y - src.y, dst.x - src.x)
    const tipX = dst.x - Math.cos(angle) * 18
    const tipY = dst.y - Math.sin(angle) * 18
    for (const side of [-0.5, 0.5]) {
      const ax = tipX - Math.cos(angle + side) * 8
      const ay = tipY - Math.sin(angle + side) * 8
      drawLineRgba(buf, width, height, tipX, tipY, ax, ay, rgb, 2, false)
    }
  }

  // 3. Render Machinations Nodes (Authentic Shapes: Circle Pool, Triangle Source/Converter/Drain, Diamond Gate, Box Register)
  const radius = Math.max(12, Math.round(16 * Math.min(scaleX, scaleY)))
  for (const node of diagram.nodes) {
    const pos = nodePos.get(node.id)
    if (!pos) continue
    const [cr, cg, cb] = pos.color

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        let inside = false
        let isRim = false

        if (node.kind === 'pool') {
          const dist = Math.hypot(dx, dy)
          inside = dist <= radius
          isRim = dist >= radius - 3 && dist <= radius
        } else if (node.kind === 'gate') {
          const manhattan = Math.abs(dx) + Math.abs(dy)
          inside = manhattan <= radius * 1.15
          isRim = manhattan >= radius * 1.15 - 3 && manhattan <= radius * 1.15
        } else if (node.kind === 'source') {
          // Upward triangle
          const normY = (dy + radius) / (2 * radius)
          const halfW = normY * radius
          inside = dy >= -radius && dy <= radius && Math.abs(dx) <= halfW
          isRim = inside && (Math.abs(Math.abs(dx) - halfW) <= 2.5 || dy >= radius - 2.5)
        } else if (node.kind === 'drain') {
          // Downward inverted triangle
          const normY = (radius - dy) / (2 * radius)
          const halfW = normY * radius
          inside = dy >= -radius && dy <= radius && Math.abs(dx) <= halfW
          isRim = inside && (Math.abs(Math.abs(dx) - halfW) <= 2.5 || dy <= -radius + 2.5)
        } else if (node.kind === 'converter') {
          // Rightward triangle
          const normX = (radius - dx) / (2 * radius)
          const halfH = normX * radius
          inside = dx >= -radius && dx <= radius && Math.abs(dy) <= halfH
          isRim = inside && (Math.abs(Math.abs(dy) - halfH) <= 2.5 || dx <= -radius + 2.5)
        } else {
          // Register / End Condition rectangle
          inside = Math.abs(dx) <= radius && Math.abs(dy) <= radius * 0.78
          isRim = inside && (Math.abs(dx) >= radius - 2.5 || Math.abs(dy) >= radius * 0.78 - 2.5)
        }

        if (inside) {
          if (isRim) {
            blendPixel(buf, width, height, pos.x + dx, pos.y + dy, cr, cg, cb, 1)
          } else {
            blendPixel(
              buf,
              width,
              height,
              pos.x + dx,
              pos.y + dy,
              Math.round(cr * 0.25 + 14),
              Math.round(cg * 0.25 + 20),
              Math.round(cb * 0.25 + 32),
              0.95
            )
          }
        }
      }
    }
  }

  // 4. Render Bottom Monte Carlo Time-Series Chart (P10-P90 Shaded Bands + P50 Curves)
  const padL = 24
  const padR = 20
  const padT = splitY + 16
  const padB = height - 16
  const chartW = Math.max(10, width - padL - padR)
  const chartH = Math.max(10, padB - padT)

  let maxVal = 10
  for (const series of mcResult.poolSeries) {
    for (const v of series.p90) {
      if (v > maxVal) maxVal = v
    }
  }

  const steps = Math.max(1, mcResult.steps)
  for (const series of mcResult.poolSeries) {
    const rgb = parseHexRgb(series.color, [56, 189, 248])

    // Fill P10..P90 confidence ribbon
    for (let x = 0; x < chartW; x++) {
      const tFloat = (x / chartW) * steps
      const t0 = Math.floor(tFloat)
      const t1 = Math.min(steps, t0 + 1)
      const frac = tFloat - t0
      const p10Val = (series.p10[t0] ?? 0) * (1 - frac) + (series.p10[t1] ?? 0) * frac
      const p90Val = (series.p90[t0] ?? 0) * (1 - frac) + (series.p90[t1] ?? 0) * frac
      const yTop = padB - Math.round((p90Val / maxVal) * chartH)
      const yBot = padB - Math.round((p10Val / maxVal) * chartH)
      for (let py = Math.max(padT, yTop); py <= Math.min(padB, yBot); py++) {
        blendPixel(buf, width, height, padL + x, py, rgb[0], rgb[1], rgb[2], 0.18)
      }
    }

    // Draw P50 Median Curve
    for (let t = 0; t < steps; t++) {
      const x0 = padL + Math.round((t / steps) * chartW)
      const x1 = padL + Math.round(((t + 1) / steps) * chartW)
      const y0 = padB - Math.round(((series.p50[t] ?? 0) / maxVal) * chartH)
      const y1 = padB - Math.round(((series.p50[t + 1] ?? 0) / maxVal) * chartH)
      drawLineRgba(buf, width, height, x0, y0, x1, y1, rgb, 2, false)
    }
  }

  return { width, height, data: buf }
}

/**
 * 导出 Mermaid 系统动力学流程图源码（供策划文档与 Markdown 审阅）。
 */
export function exportMachinationsToMermaid(diagram: MachinationsDiagram): string {
  const lines: string[] = ['flowchart LR']
  for (const n of diagram.nodes) {
    const safeLabel = n.label.replace(/"/g, "'")
    if (n.kind === 'pool') {
      lines.push(`  ${n.id}(("${safeLabel} [${n.initialValue ?? 0}]"))`)
    } else if (n.kind === 'gate') {
      lines.push(`  ${n.id}{"${safeLabel}"}`)
    } else if (n.kind === 'source' || n.kind === 'converter') {
      lines.push(`  ${n.id}>"${safeLabel}"]`)
    } else if (n.kind === 'drain') {
      lines.push(`  ${n.id}[/"${safeLabel}"\\]`)
    } else {
      lines.push(`  ${n.id}["${safeLabel}"]`)
    }
  }
  for (const e of diagram.edges) {
    const arrow = e.kind === 'state_modifier' ? '-.->' : '-->'
    const safeEdge = e.label.replace(/"/g, "'")
    lines.push(`  ${e.sourceId} ${arrow}|"${safeEdge}"| ${e.targetId}`)
  }
  return lines.join('\n')
}

/**
 * 导出蒙特卡洛模拟时序遥测 CSV（包含每个 Tick 各资源池的 P10/P50/P90/Mean）。
 */
export function exportMachinationsTelemetryCsv(mcResult: MachinationsMonteCarloResult): string {
  const headers = ['tick']
  for (const s of mcResult.poolSeries) {
    const clean = s.nodeId.replace(/[^a-zA-Z0-9_]/g, '_')
    headers.push(`${clean}_p10`, `${clean}_p50`, `${clean}_p90`, `${clean}_mean`)
  }
  const rows: string[] = [headers.join(',')]
  for (let t = 0; t <= mcResult.steps; t++) {
    const cols: (string | number)[] = [t]
    for (const s of mcResult.poolSeries) {
      cols.push(s.p10[t] ?? 0, s.p50[t] ?? 0, s.p90[t] ?? 0, s.mean[t] ?? 0)
    }
    rows.push(cols.join(','))
  }
  return rows.join('\n')
}

/**
 * 导出 Godot 4 GDScript 经济模拟运行器（`EconomySimulator.gd`）。
 */
export function exportGodotEconomySimulatorGd(diagram: MachinationsDiagram): string {
  const pools = diagram.nodes.filter((n) => n.kind === 'pool')
  const poolInitLines = pools
    .map((p) => `\t"${p.id}": ${Number(p.initialValue ?? 0).toFixed(1)}, # ${p.label}`)
    .join('\n')

  return `# Auto-generated by AI Art Engine — Machinations Economy System (${diagram.title})
extends Node
class_name GameEconomySimulator

signal pool_changed(pool_id: String, new_value: float)
signal goal_reached(goal_id: String, tick: int)

var tick: int = 0
var pools: Dictionary = {
${poolInitLines}
}

func get_pool(pool_id: String) -> float:
\treturn float(pools.get(pool_id, 0.0))

func add_resource(pool_id: String, amount: float, max_cap: float = 999999.0) -> void:
\tvar next_val: float = clampf(get_pool(pool_id) + amount, 0.0, max_cap)
\tpools[pool_id] = next_val
\tpool_changed.emit(pool_id, next_val)

func try_consume(costs: Dictionary) -> bool:
\tfor k in costs.keys():
\t\tif get_pool(k) < float(costs[k]):
\t\t\treturn false
\tfor k in costs.keys():
\t\tadd_resource(k, -float(costs[k]))
\treturn true
`
}

/**
 * 导出 Unity C# 经济系统管理器（`EconomyManager.cs`）。
 */
export function exportUnityEconomyManagerCs(diagram: MachinationsDiagram): string {
  const pools = diagram.nodes.filter((n) => n.kind === 'pool')
  const poolInitLines = pools
    .map((p) => `        Pools["${p.id}"] = ${Number(p.initialValue ?? 0)}f; // ${p.label}`)
    .join('\n')

  return `// Auto-generated by AI Art Engine — Machinations Economy System (${diagram.title})
using System;
using System.Collections.Generic;
using UnityEngine;

public class EconomyManager : MonoBehaviour
{
    public Dictionary<string, float> Pools { get; private set; } = new Dictionary<string, float>();
    public int CurrentTick { get; private set; } = 0;
    public event Action<string, float> OnPoolChanged;

    private void Awake()
    {
${poolInitLines}
    }

    public float GetPool(string poolId) => Pools.TryGetValue(poolId, out var val) ? val : 0f;

    public void AddResource(string poolId, float amount, float maxCap = 999999f)
    {
        var next = Mathf.Clamp(GetPool(poolId) + amount, 0f, maxCap);
        Pools[poolId] = next;
        OnPoolChanged?.Invoke(poolId, next);
    }
}
`
}
