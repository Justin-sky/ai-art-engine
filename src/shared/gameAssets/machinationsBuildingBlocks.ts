/**
 * Machinations Building Blocks Catalog (`https://my.machinations.io/building-blocks`)
 *
 * 完整覆盖 Machinations 官方 Building Blocks 模块的 7 大领域（Domains）、 // cjk-ok
 * 6 个快捷筛选货架（Shelves）与全部 21 个细分品类（Categories）， // cjk-ok
 * 每个积木均为独立可运行、亦可无冲突嵌入任意既有经济系统图的模块化机制子图。 // cjk-ok
 */
import {
  createEmptyMxDocument,
  mxNewId,
  normalizeMxDocument,
  type MxDocument,
  type MxEdge,
  type MxEdgeKind,
  type MxGroup,
  type MxNode,
  type MxNodeKind,
  type MxParam,
  type MxResource
} from './machinationsV2'

export type MxBuildingBlockDomain =
  'generic' | 'games' | 'business' | 'tokenomics' | 'economy' | 'nature' | 'teaching'

export type MxBuildingBlockShelf =
  'progression' | 'combat' | 'economy' | 'chance' | 'time' | 'players'

export type MxBuildingBlockCategory =
  | 'chance'
  | 'flow'
  | 'dynamics'
  | 'measure'
  | 'progression'
  | 'combat'
  | 'game_economy'
  | 'liveops'
  | 'operations'
  | 'supply_chain'
  | 'business_money'
  | 'token_supply'
  | 'defi'
  | 'public_finance'
  | 'population_social'
  | 'personal'
  | 'epidemiology'
  | 'ecology'
  | 'climate_resources'
  | 'tool_basics'
  | 'systems_lessons'

export interface MxBuildingBlockDomainMeta {
  id: MxBuildingBlockDomain
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
  color: string
}

export interface MxBuildingBlockShelfMeta {
  id: MxBuildingBlockShelf
  nameZh: string
  nameEn: string
  icon: string
}

export interface MxBuildingBlockCategoryMeta {
  id: MxBuildingBlockCategory
  domain: MxBuildingBlockDomain
  nameZh: string
  nameEn: string
  color: string
}

export interface MxBuildingBlock {
  id: string
  domain: MxBuildingBlockDomain
  category: MxBuildingBlockCategory
  shelves: MxBuildingBlockShelf[]
  nameZh: string
  nameEn: string
  descZh: string
  descEn: string
  tags: string[]
  steps?: number
  resources?: MxResource[]
  params?: MxParam[]
  nodes: MxNode[]
  edges: MxEdge[]
}

export interface MxInsertBuildingBlockOptions {
  anchorX?: number
  anchorY?: number
  wrapInGroup?: boolean
  locale?: 'zh' | 'en'
  layerId?: string
}

export interface MxInsertBuildingBlockResult {
  blockId: string
  insertedNodeIds: string[]
  insertedEdgeIds: string[]
  groupId?: string
  bounds: { x: number; y: number; width: number; height: number }
}

export const MX_BUILDING_BLOCK_DOMAINS: MxBuildingBlockDomainMeta[] = [
  {
    id: 'generic',
    nameZh: '通用原语', // cjk-ok
    nameEn: 'Universal',
    descZh: '适用于任何领域的底层原语：随机概率、流量阀门、反馈闭环与数值测量。', // cjk-ok
    descEn: 'Primitives for any field: chance, flow, feedback and measurement.',
    color: '#6366f1'
  },
  {
    id: 'games',
    nameZh: '游戏系统', // cjk-ok
    nameEn: 'Games',
    descZh: '经验升级、战斗技能、商店合成与商业化长线留存机制。', // cjk-ok
    descEn: 'Progression, combat, economy and live-ops mechanics.',
    color: '#3b82f6'
  },
  {
    id: 'business',
    nameZh: '商业运营', // cjk-ok
    nameEn: 'Business',
    descZh: '服务排队、库存供应链与企业现金流单位经济模型。', // cjk-ok
    descEn: 'Queues, supply chains and the money a business runs on.',
    color: '#0ea5e9'
  },
  {
    id: 'tokenomics',
    nameZh: '代币经济', // cjk-ok
    nameEn: 'Tokenomics',
    descZh: '代币增发销毁、线性解锁、质押稀释与流动性池定价。', // cjk-ok
    descEn: 'Supply, emissions, staking and governance.',
    color: '#8b5cf6'
  },
  {
    id: 'economy',
    nameZh: '宏观与个人经济', // cjk-ok
    nameEn: 'Economy',
    descZh: '公共财政、人口社会传播与个人收支精力管理闭环。', // cjk-ok
    descEn: 'Public finance, population and household money.',
    color: '#f59e0b'
  },
  {
    id: 'nature',
    nameZh: '自然与生态', // cjk-ok
    nameEn: 'Nature',
    descZh: '传染病传播、捕食者种群平衡、可再生资源与能源气候系统。', // cjk-ok
    descEn: 'Epidemics, ecosystems, climate and resources.',
    color: '#10b981'
  },
  {
    id: 'teaching',
    nameZh: '教学与入门', // cjk-ok
    nameEn: 'Teaching',
    descZh: '核心图元交互入门与经典系统动力学思维实验。', // cjk-ok
    descEn: 'How the tool works, and lessons that demonstrate one idea.',
    color: '#ec4899'
  }
]

export const MX_BUILDING_BLOCK_SHELVES: MxBuildingBlockShelfMeta[] = [
  { id: 'progression', nameZh: '进程', nameEn: 'Progression', icon: '⬆' }, // cjk-ok
  { id: 'combat', nameZh: '战斗', nameEn: 'Combat', icon: '⚔' }, // cjk-ok
  { id: 'economy', nameZh: '经济与商店', nameEn: 'Economy & shop', icon: '◈' }, // cjk-ok
  { id: 'chance', nameZh: '概率', nameEn: 'Chance', icon: '🎲' }, // cjk-ok
  { id: 'time', nameZh: '时间与触发', nameEn: 'Time & triggers', icon: '⏱' }, // cjk-ok
  { id: 'players', nameZh: '玩家与留存', nameEn: 'Players & retention', icon: '👥' } // cjk-ok
]

export const MX_BUILDING_BLOCK_CATEGORIES: MxBuildingBlockCategoryMeta[] = [
  // Universal
  {
    id: 'chance',
    domain: 'generic',
    nameZh: '概率与随机', // cjk-ok
    nameEn: 'Chance & randomness',
    color: '#8b5cf6'
  },
  {
    id: 'flow',
    domain: 'generic',
    nameZh: '流量控制', // cjk-ok
    nameEn: 'Flow control',
    color: '#06b6d4'
  },
  {
    id: 'dynamics',
    domain: 'generic',
    nameZh: '循环与动态', // cjk-ok
    nameEn: 'Loops & dynamics',
    color: '#6366f1'
  },
  {
    id: 'measure',
    domain: 'generic',
    nameZh: '测量与比较', // cjk-ok
    nameEn: 'Measure & compare',
    color: '#64748b'
  },
  // Games
  {
    id: 'progression',
    domain: 'games',
    nameZh: '进程与升级', // cjk-ok
    nameEn: 'Progression & levelling',
    color: '#3b82f6'
  },
  {
    id: 'combat',
    domain: 'games',
    nameZh: '战斗与技能', // cjk-ok
    nameEn: 'Combat & abilities',
    color: '#ef4444'
  },
  {
    id: 'game_economy',
    domain: 'games',
    nameZh: '游戏经济与变现', // cjk-ok
    nameEn: 'Game economy & monetisation',
    color: '#f59e0b'
  },
  {
    id: 'liveops',
    domain: 'games',
    nameZh: '玩家与商业化运营', // cjk-ok
    nameEn: 'Players & live ops',
    color: '#ec4899'
  },
  // Business
  {
    id: 'operations',
    domain: 'business',
    nameZh: '运营与排队', // cjk-ok
    nameEn: 'Operations & queues',
    color: '#0284c7'
  },
  {
    id: 'supply_chain',
    domain: 'business',
    nameZh: '供应链与生产', // cjk-ok
    nameEn: 'Supply chain & production',
    color: '#0d9488'
  },
  {
    id: 'business_money',
    domain: 'business',
    nameZh: '资金流与单位经济', // cjk-ok
    nameEn: 'Money & unit economics',
    color: '#16a34a'
  },
  // Tokenomics
  {
    id: 'token_supply',
    domain: 'tokenomics',
    nameZh: '代币供给', // cjk-ok
    nameEn: 'Token supply',
    color: '#7c3aed'
  },
  {
    id: 'defi',
    domain: 'tokenomics',
    nameZh: '质押、流动性与治理', // cjk-ok
    nameEn: 'Staking, liquidity & governance',
    color: '#9333ea'
  },
  // Economy
  {
    id: 'public_finance',
    domain: 'economy',
    nameZh: '公共财政与宏观经济', // cjk-ok
    nameEn: 'Public finance & macro',
    color: '#d97706'
  },
  {
    id: 'population_social',
    domain: 'economy',
    nameZh: '人口与社会', // cjk-ok
    nameEn: 'Population & society',
    color: '#ea580c'
  },
  {
    id: 'personal',
    domain: 'economy',
    nameZh: '个人生活系统', // cjk-ok
    nameEn: 'Personal life systems',
    color: '#ca8a04'
  },
  // Nature
  {
    id: 'epidemiology',
    domain: 'nature',
    nameZh: '流行病学与健康', // cjk-ok
    nameEn: 'Epidemiology & health',
    color: '#e11d48'
  },
  {
    id: 'ecology',
    domain: 'nature',
    nameZh: '生态与种群', // cjk-ok
    nameEn: 'Ecology & populations',
    color: '#10b981'
  },
  {
    id: 'climate_resources',
    domain: 'nature',
    nameZh: '气候、能源与资源', // cjk-ok
    nameEn: 'Climate, energy & resources',
    color: '#059669'
  },
  // Teaching
  {
    id: 'tool_basics',
    domain: 'teaching',
    nameZh: '工具基础', // cjk-ok
    nameEn: 'Tool basics',
    color: '#db2777'
  },
  {
    id: 'systems_lessons',
    domain: 'teaching',
    nameZh: '系统思维课程', // cjk-ok
    nameEn: 'Systems lessons',
    color: '#be185d'
  }
]

// ───────────────────────────── Builder Helpers ─────────────────────────────

function bn(
  id: string,
  kind: MxNodeKind,
  label: string,
  x: number,
  y: number,
  extra: Partial<MxNode> = {}
): MxNode {
  const defaultTrigger =
    kind === 'source' ? 'automatic' : kind === 'converter' ? 'automatic' : 'passive'
  return {
    id,
    kind,
    label,
    x,
    y,
    trigger: extra.trigger ?? defaultTrigger,
    pullMode: extra.pullMode ?? (kind === 'converter' ? 'pull_all' : 'pull_any'),
    tracked: extra.tracked ?? (kind === 'pool' || kind === 'register'),
    ...extra
  }
}

function be(
  id: string,
  kind: MxEdgeKind,
  from: string,
  to: string,
  formula: string,
  extra: Partial<MxEdge> = {}
): MxEdge {
  return {
    id,
    kind,
    from,
    to,
    formula,
    ...extra
  }
}

// ───────────────────────────── Complete Catalog (58 Blocks) ─────────────────────────────

export const MX_BUILDING_BLOCKS: MxBuildingBlock[] = [
  // ═══════════════════ 1. Universal · Chance & randomness (4) ═══════════════════
  {
    id: 'bb_coin_flip_50_50',
    domain: 'generic',
    category: 'chance',
    shelves: ['chance'],
    nameZh: '50/50 抛硬币随机分流门', // cjk-ok
    nameEn: '50/50 Coin Flip Gate',
    descZh: '使用概率型 Gate 将每次流入的资源按 50% / 50% 等概率路由到正反两个结果池。', // cjk-ok
    descEn:
      'Splits each incoming resource token evenly between Heads and Tails via a 50% random Gate.',
    tags: ['coin', 'flip', '50%', 'gate', 'random', '抛硬币', '随机分流'], // cjk-ok
    nodes: [
      bn('flip_src', 'source', /* cjk-ok */ '投币次数 Trials', 0, 80),
      bn('coin_gate', 'gate', /* cjk-ok */ '50/50 分流', 160, 80, { gateMode: 'random' }),
      bn('heads_pool', 'pool', /* cjk-ok */ '正面 Heads', 340, 20, { initial: 0 }),
      bn('tails_pool', 'pool', /* cjk-ok */ '反面 Tails', 340, 140, { initial: 0 })
    ],
    edges: [
      be('e1', 'resource', 'flip_src', 'coin_gate', '1'),
      be('e2', 'resource', 'coin_gate', 'heads_pool', '50%'),
      be('e3', 'resource', 'coin_gate', 'tails_pool', '50%')
    ]
  },
  {
    id: 'bb_weighted_loot_table',
    domain: 'generic',
    category: 'chance',
    shelves: ['chance', 'economy'],
    nameZh: '稀有度权重战利品掉落表', // cjk-ok
    nameEn: 'Weighted Loot Drop Table',
    descZh: '模拟开箱掉落：70% 普通、25% 稀有、5% 传说三档权重分流，可直接接入怪物击杀或宝箱出口。', // cjk-ok
    descEn: 'Routes chest opens across Common (70%), Rare (25%), and Legendary (5%) loot pools.',
    tags: ['loot', 'drop', 'rarity', 'chest', 'gacha', '掉落表', '开箱', '稀有度'], // cjk-ok
    resources: [
      { id: 'res_common', name: 'Common', color: '#64748b' },
      { id: 'res_rare', name: 'Rare', color: '#3b82f6' },
      { id: 'res_legend', name: 'Legendary', color: '#f59e0b' }
    ],
    nodes: [
      bn('chest_src', 'source', /* cjk-ok */ '开启宝箱 Chests', 0, 100),
      bn('loot_gate', 'gate', /* cjk-ok */ '掉落权重表', 170, 100, { gateMode: 'random' }),
      bn('loot_common', 'pool', /* cjk-ok */ '普通掉落 (70%)', 360, 0, {
        resourceId: 'res_common',
        initial: 0
      }),
      bn('loot_rare', 'pool', /* cjk-ok */ '稀有掉落 (25%)', 360, 100, {
        resourceId: 'res_rare',
        initial: 0
      }),
      bn('loot_legend', 'pool', /* cjk-ok */ '传说掉落 (5%)', 360, 200, {
        resourceId: 'res_legend',
        initial: 0
      })
    ],
    edges: [
      be('e1', 'resource', 'chest_src', 'loot_gate', '1'),
      be('e2', 'resource', 'loot_gate', 'loot_common', '70%'),
      be('e3', 'resource', 'loot_gate', 'loot_rare', '25%'),
      be('e4', 'resource', 'loot_gate', 'loot_legend', '5%')
    ]
  },
  {
    id: 'bb_dice_bell_curve_2d6',
    domain: 'generic',
    category: 'chance',
    shelves: ['chance', 'combat'],
    nameZh: '2D6 钟形正态掷骰与条件检定', // cjk-ok
    nameEn: '2D6 Bell-Curve Roll & Skill Check',
    descZh: '每步投掷 2D6 并通过条件门检定是否 >=8（约 41.7% 成功率），用于桌游或 CRPG 属性检定。', // cjk-ok
    descEn: 'Rolls 2D6 into a check gate (>=8 passes, <8 fails) for tabletop and RPG skill checks.',
    tags: ['2D6', 'dice', 'bell curve', 'skill check', '掷骰', '属性检定'], // cjk-ok
    nodes: [
      bn('roll_src', 'source', /* cjk-ok */ '2D6 检定投掷', 0, 80),
      bn('check_gate', 'gate', /* cjk-ok */ '检定门 >=8', 180, 80, {
        gateMode: 'random',
        formula: '2D6'
      }),
      bn('check_pass', 'pool', /* cjk-ok */ '检定成功 Pass', 360, 20, {
        initial: 0,
        color: '#10b981'
      }),
      bn('check_fail', 'pool', /* cjk-ok */ '检定失败 Fail', 360, 140, {
        initial: 0,
        color: '#ef4444'
      })
    ],
    edges: [
      be('e1', 'resource', 'roll_src', 'check_gate', '1'),
      be('e2', 'resource', 'check_gate', 'check_pass', '>=8'),
      be('e3', 'resource', 'check_gate', 'check_fail', '<8')
    ]
  },
  {
    id: 'bb_pity_timer_guaranteed',
    domain: 'generic',
    category: 'chance',
    shelves: ['chance', 'economy', 'players'],
    nameZh: '抽卡软/硬保底计数器', // cjk-ok
    nameEn: 'Gacha Pity Counter & Guaranteed SSR',
    descZh: '未抽中大奖时累计保底计数，满 10 抽强制兑换 1 个保底大奖并清空保底池。', // cjk-ok
    descEn: 'Accumulates pity tokens on misses and guarantees an SSR drop every 10 misses.',
    tags: ['pity', 'gacha', 'guaranteed', 'ssr', '抽卡', '保底'], // cjk-ok
    resources: [
      { id: 'res_pull', name: 'Pulls', color: '#6366f1' },
      { id: 'res_ssr', name: 'SSR Prize', color: '#f59e0b' }
    ],
    nodes: [
      bn('pull_src', 'source', /* cjk-ok */ '抽卡投入 Pulls', 0, 90, { resourceId: 'res_pull' }),
      bn('gacha_gate', 'gate', /* cjk-ok */ '基础出率 10%', 160, 90, { gateMode: 'random' }),
      bn('pity_counter', 'pool', /* cjk-ok */ '保底计数 Pity', 320, 160, {
        initial: 0
      }),
      bn('pity_exchange', 'converter', /* cjk-ok */ '10连硬保底触发', 480, 160, {
        resourceId: 'res_ssr',
        trigger: 'automatic'
      }),
      bn('ssr_inventory', 'pool', /* cjk-ok */ 'SSR 获得总数', 480, 20, {
        resourceId: 'res_ssr',
        initial: 0
      })
    ],
    edges: [
      be('e1', 'resource', 'pull_src', 'gacha_gate', '1'),
      be('e2', 'resource', 'gacha_gate', 'ssr_inventory', '10%'),
      be('e3', 'resource', 'gacha_gate', 'pity_counter', '90%'),
      be('e4', 'resource', 'pity_counter', 'pity_exchange', '10'),
      be('e5', 'resource', 'pity_exchange', 'ssr_inventory', '1'),
      be('e6', 'state', 'pity_counter', 'pity_exchange', '>=10', { bend: -45 })
    ]
  },

  // ═══════════════════ 2. Universal · Flow control (4) ═══════════════════
  {
    id: 'bb_conditional_valve',
    domain: 'generic',
    category: 'flow',
    shelves: ['time'],
    nameZh: '库存阈值自动断流阀', // cjk-ok
    nameEn: 'Threshold Shutoff Valve',
    descZh: '当蓄水池低于上限 20 时自动开启上游注入，满 20 时由状态线关闭产水源头防止溢出。', // cjk-ok
    descEn: 'Uses a state activator (<20) to automatically shut off the upstream source when full.',
    tags: ['valve', 'threshold', 'shutoff', 'activator', '阀门', '阈值开关'], // cjk-ok
    nodes: [
      bn('valve_src', 'source', '受控产水源', 0, 60), // cjk-ok
      bn('buffer_tank', 'pool', '水位缓冲池', 200, 60, { initial: 0, capacity: 25 }), // cjk-ok
      bn('consumer_drain', 'drain', '下游间歇消耗', 400, 60, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'valve_src', 'buffer_tank', '4'),
      be('e2', 'resource', 'buffer_tank', 'consumer_drain', '5|3'),
      be('e3', 'state', 'buffer_tank', 'valve_src', '<20', { bend: -55 })
    ]
  },
  {
    id: 'bb_rate_limiter_cap',
    domain: 'generic',
    category: 'flow',
    shelves: ['time', 'economy'],
    nameZh: '突发脉冲削峰限流器', // cjk-ok
    nameEn: 'Burst Absorber & Rate Limiter',
    descZh: '吸收上游高波动随机脉冲（2D6），并以恒定速率（每步上限 3）平滑释放给下游系统。', // cjk-ok
    descEn: 'Buffers spiky 2D6 upstream bursts and releases a smooth, rate-limited flow of 3/step.',
    tags: ['rate limit', 'throttle', 'buffer', 'smoothing', '限流', '削峰填谷'], // cjk-ok
    nodes: [
      bn('burst_src', 'source', /* cjk-ok */ '随机脉冲流入', 0, 60),
      bn('surge_buffer', 'pool', /* cjk-ok */ '削峰缓冲池', 180, 60, {
        initial: 5,
        capacity: 40,
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('smooth_out', 'pool', /* cjk-ok */ '平滑输出池', 380, 60, { initial: 0 })
    ],
    edges: [
      be('e1', 'resource', 'burst_src', 'surge_buffer', '2D6|2'),
      be('e2', 'resource', 'surge_buffer', 'smooth_out', '3', {
        maxLimit: 3,
        notes: 'Rate limited to 3/step'
      })
    ]
  },
  {
    id: 'bb_overflow_spillway',
    domain: 'generic',
    category: 'flow',
    shelves: ['economy'],
    nameZh: '主池满仓溢流分流道', // cjk-ok
    nameEn: 'Overflow Spillway Router',
    descZh: '主储蓄池未满 15 时优先存入主池；一旦满 15，超出资源自动改道流入次级溢流金库。', // cjk-ok
    descEn:
      'Fills Primary Storage up to 15 first, then routes excess resources into an Overflow Vault.',
    tags: ['overflow', 'spillway', 'cap', 'vault', '溢出', '分流道'], // cjk-ok
    nodes: [
      bn('inflow_src', 'source', '总收益流入', 0, 110), // cjk-ok
      bn('split_gate', 'gate', '满仓检测分流', 160, 110, { gateMode: 'deterministic' }), // cjk-ok
      bn('primary_pool', 'pool', '主背包池 (上限15)', 380, 30, { initial: 8, capacity: 15 }), // cjk-ok
      bn('overflow_vault', 'pool', '溢流邮箱暂存池', 380, 190, { initial: 0 }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'inflow_src', 'split_gate', '3'),
      be('e2', 'resource', 'split_gate', 'primary_pool', '1'),
      be('e3', 'resource', 'split_gate', 'overflow_vault', '1'),
      be('e4', 'state', 'primary_pool', 'split_gate', '<15', { targetEdgeId: 'e2', bend: 42 }),
      be('e5', 'state', 'primary_pool', 'split_gate', '>=15', { targetEdgeId: 'e3', bend: -26 })
    ]
  },
  {
    id: 'bb_cooldown_delay_pipe',
    domain: 'generic',
    category: 'flow',
    shelves: ['time', 'combat'],
    nameZh: '冷却延迟与管道队列', // cjk-ok
    nameEn: 'Cooldown Delay & FIFO Queue Pipe',
    descZh: '每次触发动作消耗 1 个冷却令牌，经 3 步 Delay 冷却管线后自动归还就绪池。', // cjk-ok
    descEn: 'Consumes a ready charge on fire and recycles it through a 3-step Delay cooldown.',
    tags: ['cooldown', 'delay', 'queue', 'charge', '冷却', '延迟充能'], // cjk-ok
    nodes: [
      bn('ready_charges', 'pool', '可用充能数 Charges', 0, 40, { initial: 2, capacity: 2 }), // cjk-ok
      bn('cast_action', 'converter', '释放充能动作', 200, 40, { trigger: 'automatic' }), // cjk-ok
      bn('cd_delay', 'delay', '3步冷却恢复', 100, 150, { delaySteps: 3 }), // cjk-ok
      bn('effect_count', 'pool', '累计生效次数', 380, 40, { initial: 0 }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'ready_charges', 'cast_action', '1'),
      be('e2', 'resource', 'cast_action', 'effect_count', '1'),
      be('e3', 'resource', 'cast_action', 'cd_delay', '1'),
      be('e4', 'resource', 'cd_delay', 'ready_charges', '1'),
      be('e5', 'state', 'ready_charges', 'cast_action', '>=1', { bend: -40 })
    ]
  },

  // ═══════════════════ 3. Universal · Loops & dynamics (4) ═══════════════════
  {
    id: 'bb_reinforcing_compound_loop',
    domain: 'generic',
    category: 'dynamics',
    shelves: ['progression', 'economy'],
    nameZh: '正反馈复利增长飞轮 (R-Loop)', // cjk-ok
    nameEn: 'Reinforcing Compounding Loop',
    descZh: '存量越多，每步按比例衍生的利息/增量越高，展示指数滚雪球效应。', // cjk-ok
    descEn:
      'Classic reinforcing loop where a stock grows proportionally to its own size each step.',
    tags: ['reinforcing', 'compound', 'exponential', 'snowball', '正反馈', '复利', '滚雪球'], // cjk-ok
    params: [{ id: 'p_comp_rate', name: 'CompoundRate', value: 0.15 }],
    nodes: [
      bn('comp_src', 'source', '复利增值源', 0, 70), // cjk-ok
      bn('capital_pool', 'pool', '本金存量池 Capital', 200, 70, { initial: 20 }), // cjk-ok
      bn('yield_reg', 'register', /* cjk-ok */ '当步复利增量', 100, 180, {
        formula: 'max(1, round(capital_pool * CompoundRate))'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'comp_src', 'capital_pool', 'yield_reg'),
      be('e2', 'state', 'capital_pool', 'yield_reg', '+1')
    ]
  },
  {
    id: 'bb_balancing_thermostat_loop',
    domain: 'generic',
    category: 'dynamics',
    shelves: ['time'],
    nameZh: '负反馈恒温稳态调节环 (B-Loop)', // cjk-ok
    nameEn: 'Balancing Thermostat Loop',
    descZh: '根据当前值与目标值（Target=50）的差距自动调节注入与排出，使系统收敛稳定在目标水位。', // cjk-ok
    descEn:
      'Self-correcting balancing loop that drives a stock smoothly toward a target equilibrium.',
    tags: ['balancing', 'equilibrium', 'thermostat', 'negative feedback', '负反馈', '动态平衡'], // cjk-ok
    params: [{ id: 'p_target_eq', name: 'EquilibriumTarget', value: 50 }],
    nodes: [
      bn('heat_src', 'source', /* cjk-ok */ '补偿注入', 0, 50),
      bn('spike_src', 'source', /* cjk-ok */ '单次过热冲击', 0, 170),
      bn('temp_pool', 'pool', /* cjk-ok */ '系统状态值 Stock', 190, 50, { initial: 12 }),
      bn('cool_drain', 'drain', /* cjk-ok */ '超额泄压', 380, 50, { trigger: 'automatic' }),
      bn('gap_reg', 'register', /* cjk-ok */ '调节速率', 240, 170, {
        formula:
          'if(temp_pool < EquilibriumTarget, max(1, round((EquilibriumTarget - temp_pool) * 0.25)), 0)'
      })
    ],
    edges: [
      be('e1', 'resource', 'heat_src', 'temp_pool', 'gap_reg'),
      be(
        'e2',
        'resource',
        'temp_pool',
        'cool_drain',
        'max(1, round((temp_pool - EquilibriumTarget) * 0.35))'
      ),
      be('e3', 'state', 'temp_pool', 'gap_reg', '+1'),
      be('e4', 'resource', 'spike_src', 'temp_pool', 'if(STEP == 10, 28, 0)'),
      be('e5', 'state', 'temp_pool', 'cool_drain', '>50', { bend: -40 })
    ]
  },
  {
    id: 'bb_diminishing_returns_curve',
    domain: 'generic',
    category: 'dynamics',
    shelves: ['progression', 'combat'],
    nameZh: '边际收益递减软上限抑制器', // cjk-ok
    nameEn: 'Diminishing Returns Soft-Cap Damper',
    descZh: '采用双曲递减公式 diminish(x, cap) 将无限堆叠的属性收敛至软上限（如减伤率不超 80%）。', // cjk-ok
    descEn:
      'Maps raw stacked stats through a hyperbolic soft-cap curve so bonuses never reach 100%.',
    tags: ['diminishing returns', 'soft cap', 'hyperbolic', '边际递减', '软上限'], // cjk-ok
    nodes: [
      bn('stat_src', 'source', '堆叠原始属性', 0, 60), // cjk-ok
      bn('raw_stat_pool', 'pool', '原始堆叠点数', 180, 60, { initial: 10 }), // cjk-ok
      bn('eff_bonus_reg', 'register', /* cjk-ok */ '实际生效加成(%)', 380, 60, {
        formula: 'round(80 * diminish(raw_stat_pool, 70) * 10) / 10'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'stat_src', 'raw_stat_pool', '8'),
      be('e2', 'state', 'raw_stat_pool', 'eff_bonus_reg', '+1')
    ]
  },
  {
    id: 'bb_catchup_rubberband',
    domain: 'generic',
    category: 'dynamics',
    shelves: ['progression', 'players'],
    nameZh: '落后追赶橡皮筋补偿机制', // cjk-ok
    nameEn: 'Catch-Up Rubberband Booster',
    descZh: '对比领先基准线与玩家当前进度，落后差距越大时给予越高的追赶速率加成。', // cjk-ok
    descEn: 'Boosts player gain rate proportionally whenever behind the benchmark pace.',
    tags: ['catch up', 'rubberband', 'comeback', '追赶机制', '橡皮筋'], // cjk-ok
    nodes: [
      bn('pace_src', 'source', '基准进度推进', 0, 20), // cjk-ok
      bn('leader_score', 'pool', '基准领先分 Leader', 190, 20, { initial: 30 }), // cjk-ok
      bn('player_src', 'source', '玩家追赶产出', 0, 150), // cjk-ok
      bn('player_score', 'pool', '玩家当前分 Player', 190, 150, { initial: 5 }), // cjk-ok
      bn('boost_reg', 'register', /* cjk-ok */ '橡皮筋追赶速率', 380, 90, {
        formula: '3 + max(0, floor((leader_score - player_score) * 0.25))'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'pace_src', 'leader_score', '4'),
      be('e2', 'resource', 'player_src', 'player_score', 'boost_reg'),
      be('e3', 'state', 'leader_score', 'boost_reg', '+1'),
      be('e4', 'state', 'player_score', 'boost_reg', '+1')
    ]
  },

  // ═══════════════════ 4. Universal · Measure & compare (3) ═══════════════════
  {
    id: 'bb_step_counter_clock',
    domain: 'generic',
    category: 'measure',
    shelves: ['time'],
    nameZh: '回合时钟与周期里程碑脉冲', // cjk-ok
    nameEn: 'Step Clock & Periodic Wave Trigger',
    descZh: '记录全局回合数并每 5 步释放一次周期奖励/波次事件（mod(STEP, 5) == 0）。', // cjk-ok
    descEn: 'Tracks elapsed steps and fires a periodic wave/reward pulse every 5 ticks.',
    tags: ['clock', 'timer', 'wave', 'periodic', 'step', '时钟', '周期触发'], // cjk-ok
    nodes: [
      bn('tick_clock', 'register', /* cjk-ok */ '当前周期波次 Wave', 0, 60, {
        formula: 'floor(STEP / 5) + 1'
      }), // cjk-ok
      bn('wave_src', 'source', '每5步周期发放', 190, 60), // cjk-ok
      bn('wave_rewards', 'pool', '周期脉冲累计池', 380, 60, { initial: 0 }) // cjk-ok
    ],
    edges: [be('e1', 'resource', 'wave_src', 'wave_rewards', '5|5')]
  },
  {
    id: 'bb_ratio_efficiency_meter',
    domain: 'generic',
    category: 'measure',
    shelves: ['economy'],
    nameZh: '产消比与通胀率监控仪表', // cjk-ok
    nameEn: 'Faucet-to-Sink Ratio Telemetry Meter',
    descZh: '双路镜像统计总产出与总消耗，由寄存器实时输出产消比（>1 通胀，<1 紧缩）。', // cjk-ok
    descEn: 'Tracks cumulative inflow vs outflow and computes live Faucet/Sink ratio.',
    tags: ['meter', 'ratio', 'telemetry', 'faucet', 'sink', '产消比', '监控仪表'], // cjk-ok
    nodes: [
      bn('faucet_in', 'source', '样本产出流入', 0, 20), // cjk-ok
      bn('total_minted', 'pool', '累计总产出 Minted', 180, 20, { initial: 10 }), // cjk-ok
      bn('sink_in', 'source', '样本消耗记录', 0, 140), // cjk-ok
      bn('total_burned', 'pool', '累计总回收 Burned', 180, 140, { initial: 10 }), // cjk-ok
      bn('fs_ratio_reg', 'register', /* cjk-ok */ '产消比 Faucet/Sink', 380, 80, {
        formula: 'round((total_minted / max(1, total_burned)) * 100) / 100'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'faucet_in', 'total_minted', '6'),
      be('e2', 'resource', 'sink_in', 'total_burned', '5'),
      be('e3', 'state', 'total_minted', 'fs_ratio_reg', '+1'),
      be('e4', 'state', 'total_burned', 'fs_ratio_reg', '+1')
    ]
  },
  {
    id: 'bb_high_water_mark_tracker',
    domain: 'generic',
    category: 'measure',
    shelves: ['progression'],
    nameZh: '历史最高战力/峰值水位锁存器', // cjk-ok
    nameEn: 'High-Water Mark Peak Tracker',
    descZh: '即使当前资源池上下波动，峰值池只增不减，精准记录历史达到过的最高水位。', // cjk-ok
    descEn: 'Latches the highest value ever reached by a fluctuating resource pool.',
    tags: ['peak', 'high score', 'watermark', 'max', '历史最高', '峰值记录'], // cjk-ok
    nodes: [
      bn('fluct_src', 'source', /* cjk-ok */ '波动流入', 0, 50),
      bn('live_stock', 'pool', /* cjk-ok */ '实时波动存量', 170, 50, { initial: 10 }),
      bn('fluct_drain', 'drain', /* cjk-ok */ '随机流失', 340, 50, { trigger: 'automatic' }),
      bn('peak_src', 'source', /* cjk-ok */ '刷新纪录补差', 0, 170, { trigger: 'passive' }),
      bn('peak_record', 'pool', /* cjk-ok */ '历史最高峰值 Peak', 220, 170, { initial: 10 })
    ],
    edges: [
      be('e1', 'resource', 'fluct_src', 'live_stock', '2D6'),
      be('e2', 'resource', 'live_stock', 'fluct_drain', '2D6'),
      be('e3', 'resource', 'peak_src', 'peak_record', 'max(0, live_stock - peak_record)', {
        transferMode: 'instant'
      }),
      be('e4', 'state', 'fluct_drain', 'peak_src', '*', { bend: 35 })
    ]
  },

  // ═══════════════════ 5. Games · Progression & levelling (4) ═══════════════════
  {
    id: 'bb_xp_level_up_curve',
    domain: 'games',
    category: 'progression',
    shelves: ['progression'],
    nameZh: '经验值累积与递增升级曲线', // cjk-ok
    nameEn: 'XP Pool & Scaling Level-Up Curve',
    descZh:
      /* cjk-ok */ '战斗获取 XP，攒够当前等级阈值（40 * 1.25^(Lv-1)）后自动消耗 XP 升 1 级并抬高下一级门槛。',
    descEn:
      'Accumulates XP and triggers level-ups against an exponentially scaling XP requirement.',
    tags: ['xp', 'level up', 'curve', 'rpg', '经验值', '升级曲线', '等级'], // cjk-ok
    resources: [
      { id: 'res_xp', name: 'XP', color: '#3b82f6' },
      { id: 'res_lvl', name: 'Level', color: '#f59e0b' }
    ],
    nodes: [
      bn('xp_gain', 'source', '战斗经验产出', 0, 60, { resourceId: 'res_xp' }), // cjk-ok
      bn('xp_pool', 'pool', '当前经验池 XP', 170, 60, { resourceId: 'res_xp', initial: 0 }), // cjk-ok
      bn('lvl_up_conv', 'converter', /* cjk-ok */ '消耗XP升级', 340, 60, {
        resourceId: 'res_lvl',
        trigger: 'automatic'
      }), // cjk-ok
      bn('hero_level', 'pool', '角色等级 Level', 500, 60, { resourceId: 'res_lvl', initial: 1 }), // cjk-ok
      bn('req_xp_reg', 'register', /* cjk-ok */ '下级所需XP阈值', 340, 180, {
        formula: 'round(40 * pow(1.25, max(0, hero_level - 1)))'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'xp_gain', 'xp_pool', '18'),
      be('e2', 'resource', 'xp_pool', 'lvl_up_conv', 'req_xp_reg'),
      be('e3', 'resource', 'lvl_up_conv', 'hero_level', '1'),
      be('e4', 'state', 'hero_level', 'req_xp_reg', '+1'),
      be('e5', 'state', 'xp_pool', 'lvl_up_conv', 'xp_pool >= req_xp_reg', { bend: -45 })
    ]
  },
  {
    id: 'bb_prestige_rebirth_loop',
    domain: 'games',
    category: 'progression',
    shelves: ['progression', 'economy'],
    nameZh: '放置转生重置与声望永久乘区', // cjk-ok
    nameEn: 'Idle Prestige Reset & Rebirth Multiplier',
    descZh: '挂机金币满阈值后清空当前周目金币，结算转生魂石并永久倍增下一周目挂机产速。', // cjk-ok
    descEn:
      'Resets run currency at threshold in exchange for permanent prestige production multipliers.',
    tags: ['idle', 'prestige', 'rebirth', 'ascension', '放置', '转生', '声望重置'], // cjk-ok
    resources: [
      { id: 'res_coins', name: 'Coins', color: '#eab308' },
      { id: 'res_shards', name: 'Prestige Shards', color: '#a855f7' }
    ],
    nodes: [
      bn('idle_gen', 'source', '挂机产金', 0, 50, { resourceId: 'res_coins' }), // cjk-ok
      bn('run_coins', 'pool', '本周目金币', 180, 50, { resourceId: 'res_coins', initial: 0 }), // cjk-ok
      bn('rebirth_conv', 'converter', /* cjk-ok */ '转生飞升重置', 360, 50, {
        resourceId: 'res_shards',
        trigger: 'automatic'
      }), // cjk-ok
      bn('prestige_shards', 'pool', /* cjk-ok */ '永久转生魂石', 520, 50, {
        resourceId: 'res_shards',
        initial: 0
      }), // cjk-ok
      bn('prod_mult', 'register', /* cjk-ok */ '全局产速倍率', 180, 170, {
        formula: 'round(10 * (1 + prestige_shards * 0.6))'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'idle_gen', 'run_coins', 'prod_mult'),
      be('e2', 'resource', 'run_coins', 'rebirth_conv', 'all'),
      be('e3', 'resource', 'rebirth_conv', 'prestige_shards', '2'),
      be('e4', 'state', 'prestige_shards', 'prod_mult', '+1'),
      be('e5', 'state', 'run_coins', 'rebirth_conv', '>=60', { bend: -45 })
    ]
  },
  {
    id: 'bb_skill_tree_branch_unlock',
    domain: 'games',
    category: 'progression',
    shelves: ['progression', 'combat'],
    nameZh: '技能树前置点数与终极天赋解锁', // cjk-ok
    nameEn: 'Skill Tree Tier Gate & Ultimate Unlock',
    descZh: '升级获取技能点，必须先点满 3 层基础天赋后，终极奥义分支才自动解锁可投入。', // cjk-ok
    descEn: 'Requires investing 3 points in Core Talents before unlocking the Ultimate skill node.',
    tags: ['skill tree', 'talent', 'unlock', 'tech tree', '技能树', '天赋解锁'], // cjk-ok
    nodes: [
      bn('sp_src', 'source', '技能点获取 SP', 0, 80), // cjk-ok
      bn('sp_pool', 'pool', '可用技能点', 160, 80, { initial: 1 }), // cjk-ok
      bn('core_talent', 'pool', '基础天赋层 (满3)', 360, 20, { initial: 0, capacity: 3 }), // cjk-ok
      bn('ult_talent', 'pool', '终极奥义层 (满2)', 360, 150, { initial: 0, capacity: 2 }), // cjk-ok
      bn('pull_core', 'converter', '加点基础天赋', 260, 20, { trigger: 'automatic' }), // cjk-ok
      bn('pull_ult', 'converter', '解锁终极奥义', 260, 150, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'sp_src', 'sp_pool', '1|2'),
      be('e2', 'resource', 'sp_pool', 'pull_core', '1'),
      be('e3', 'resource', 'pull_core', 'core_talent', '1'),
      be('e4', 'resource', 'sp_pool', 'pull_ult', '1'),
      be('e5', 'resource', 'pull_ult', 'ult_talent', '1'),
      be('e6', 'state', 'core_talent', 'pull_core', '<3'),
      be('e7', 'state', 'core_talent', 'pull_ult', '>=3'),
      be('e8', 'state', 'ult_talent', 'pull_ult', '<2')
    ]
  },
  {
    id: 'bb_gear_tier_merge_upgrade',
    domain: 'games',
    category: 'progression',
    shelves: ['progression', 'chance', 'economy'],
    nameZh: '装备三合一升阶与强化成功率', // cjk-ok
    nameEn: '3-to-1 Gear Merge & Upgrade Risk',
    descZh: '每收集 3 件低阶装备自动尝试锻造升星：70% 成功晋升紫装，30% 锻造失败返还粉尘。', // cjk-ok
    descEn: 'Merges 3 base items with a 70% upgrade success rate and 30% salvage dust fallback.',
    tags: ['merge', 'gear', 'upgrade', 'blacksmith', '三合一', '装备强化', '升星'], // cjk-ok
    nodes: [
      bn('drop_gear', 'source', /* cjk-ok */ '掉落白装胚子', 0, 80),
      bn('tier1_gear', 'pool', /* cjk-ok */ '一阶装备池', 150, 80, { initial: 2 }),
      bn('forge_merge', 'converter', /* cjk-ok */ '3合1锻造炉', 300, 80, { trigger: 'automatic' }),
      bn('forge_gate', 'gate', /* cjk-ok */ '成功率 70%', 430, 80, { gateMode: 'random' }),
      bn('epic_gear', 'pool', /* cjk-ok */ '二阶史诗装备', 580, 20, {
        initial: 0,
        color: '#a855f7'
      }),
      bn('salvage_dust', 'pool', /* cjk-ok */ '失败返还强化尘', 580, 150, {
        initial: 0,
        color: '#64748b'
      })
    ],
    edges: [
      be('e1', 'resource', 'drop_gear', 'tier1_gear', '2'),
      be('e2', 'resource', 'tier1_gear', 'forge_merge', '3'),
      be('e3', 'resource', 'forge_merge', 'forge_gate', '1'),
      be('e4', 'resource', 'forge_gate', 'epic_gear', '70%'),
      be('e5', 'resource', 'forge_gate', 'salvage_dust', '30%'),
      be('e6', 'state', 'tier1_gear', 'forge_merge', '>=3', { bend: -45 })
    ]
  },

  // ═══════════════════ 6. Games · Combat & abilities (5) ═══════════════════
  {
    id: 'bb_hp_armor_mitigation',
    domain: 'games',
    category: 'combat',
    shelves: ['combat'],
    nameZh: '护甲减伤公式与生命结算池', // cjk-ok
    nameEn: 'HP Pool & Armor Mitigation Formula',
    descZh:
      '采用经典 RPG 护甲公式 RawDmg * (100 / (100 + Armor)) 计算折后伤害扣减 HP，归零触发战败。', // cjk-ok
    descEn: 'Applies standard RPG armor mitigation to incoming DPS and triggers defeat at 0 HP.',
    tags: ['hp', 'armor', 'mitigation', 'damage', 'dps', '护甲减伤', '生命值'], // cjk-ok
    params: [
      { id: 'p_raw_dps', name: 'EnemyRawDmg', value: 18 },
      { id: 'p_armor', name: 'HeroArmor', value: 50 }
    ],
    nodes: [
      bn('hero_hp', 'pool', /* cjk-ok */ '英雄生命值 HP', 40, 60, {
        initial: 120,
        capacity: 120,
        color: '#ef4444'
      }), // cjk-ok
      bn('dmg_drain', 'drain', '折后受击扣血', 240, 60, { trigger: 'automatic' }), // cjk-ok
      bn('mit_dmg_reg', 'register', /* cjk-ok */ '折后实际伤害', 240, 175, {
        formula: 'max(1, round(EnemyRawDmg * (100 / (100 + HeroArmor))))'
      }), // cjk-ok
      bn('ko_end', 'end', '英雄阵亡 KO', 40, 175, {}) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'hero_hp', 'dmg_drain', 'mit_dmg_reg'),
      be('e2', 'state', 'hero_hp', 'ko_end', '<=0')
    ]
  },
  {
    id: 'bb_shield_absorb_regen',
    domain: 'games',
    category: 'combat',
    shelves: ['combat', 'time'],
    nameZh: '能量护盾优先吸收与自动充能', // cjk-ok
    nameEn: 'Energy Shield Absorption & Recharge',
    descZh: '护盾 >0 时优先扣减护盾层；仅当护盾击破归零时，敌人伤害才穿透扣减本体生命值。', // cjk-ok
    descEn: 'Absorbs hits into Shield while >0; spillover hits HP only when Shield is depleted.',
    tags: ['shield', 'absorb', 'regen', 'barrier', 'hp', '护盾', '破盾穿透'], // cjk-ok
    nodes: [
      bn('shield_regen', 'source', '护盾周期回充', 0, 20), // cjk-ok
      bn('shield_pool', 'pool', /* cjk-ok */ '能量护盾 Shield', 180, 20, {
        initial: 30,
        capacity: 30,
        color: '#06b6d4'
      }), // cjk-ok
      bn('shield_hit', 'drain', '护盾承伤', 370, 20, { trigger: 'automatic' }), // cjk-ok
      bn('core_hp', 'pool', /* cjk-ok */ '本体生命 Core HP', 180, 145, {
        initial: 120,
        capacity: 120,
        color: '#ef4444'
      }), // cjk-ok
      bn('hp_hit', 'drain', '破盾本体承伤', 370, 145, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'shield_regen', 'shield_pool', '16|4', { transferMode: 'instant' }),
      be('e2', 'resource', 'shield_pool', 'shield_hit', '10'),
      be('e3', 'resource', 'core_hp', 'hp_hit', '10'),
      be('e4', 'state', 'shield_pool', 'shield_regen', '<30'),
      be('e5', 'state', 'shield_pool', 'shield_hit', '>0'),
      be('e6', 'state', 'shield_pool', 'hp_hit', '<=0')
    ]
  },
  {
    id: 'bb_mana_ability_cooldown',
    domain: 'games',
    category: 'combat',
    shelves: ['combat', 'time'],
    nameZh: '法力回蓝与大招消耗施放闭环', // cjk-ok
    nameEn: 'Mana Regen & Ultimate Cast Loop',
    descZh: /* cjk-ok */ '每步自然回蓝 +12，攒满 40 法力时自动消耗法力施放大招造成高额爆发伤害。',
    descEn: 'Regenerates Mana each tick and casts a burst ability whenever 40 Mana is available.',
    tags: ['mana', 'mp', 'spell', 'ability', 'cast', '法力', '回蓝', '大招'], // cjk-ok
    resources: [
      { id: 'res_mp', name: 'Mana', color: '#3b82f6' },
      { id: 'res_dmg', name: 'Burst Damage', color: '#f97316' }
    ],
    nodes: [
      bn('mp_regen', 'source', '自然回蓝 +12', 0, 70, { resourceId: 'res_mp' }), // cjk-ok
      bn('mana_pool', 'pool', /* cjk-ok */ '法力池 Mana', 170, 70, {
        resourceId: 'res_mp',
        initial: 20,
        capacity: 100
      }), // cjk-ok
      bn('cast_spell', 'converter', /* cjk-ok */ '施放奥术冲击(-40MP)', 350, 70, {
        resourceId: 'res_dmg',
        trigger: 'automatic'
      }), // cjk-ok
      bn('total_spell_dmg', 'pool', /* cjk-ok */ '累计技能总伤害', 530, 70, {
        resourceId: 'res_dmg',
        initial: 0
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'mp_regen', 'mana_pool', '12'),
      be('e2', 'resource', 'mana_pool', 'cast_spell', '40'),
      be('e3', 'resource', 'cast_spell', 'total_spell_dmg', '95'),
      be('e4', 'state', 'mana_pool', 'mp_regen', '<100', { bend: -45 }),
      be('e5', 'state', 'mana_pool', 'cast_spell', '>=40', { bend: 45 })
    ]
  },
  {
    id: 'bb_crit_hit_multiplier',
    domain: 'games',
    category: 'combat',
    shelves: ['combat', 'chance'],
    nameZh: '暴击率分流与暴击伤害倍增器', // cjk-ok
    nameEn: 'Critical Hit Chance & Crit Multiplier',
    descZh: '每次普攻经暴击判定门分流：75% 造成基础伤害，25% 触发 200% 双倍暴击伤害汇入总输出池。', // cjk-ok
    descEn: 'Splits each attack into 75% Normal Hit (1x) and 25% Critical Strike (2x) damage.',
    tags: ['crit', 'critical', 'damage', 'dps', 'multiplier', '暴击', '暴伤'], // cjk-ok
    params: [
      { id: 'p_base_atk', name: 'BaseAtk', value: 20 },
      { id: 'p_crit_mult', name: 'CritMult', value: 2 }
    ],
    nodes: [
      bn('atk_src', 'source', /* cjk-ok */ '普攻出手 Attacks', 0, 85),
      bn('crit_gate', 'gate', /* cjk-ok */ '暴击率 25%', 160, 85, { gateMode: 'random' }),
      bn('norm_conv', 'converter', /* cjk-ok */ '普通命中 (1x)', 330, 25, { trigger: 'passive' }),
      bn('crit_conv', 'converter', /* cjk-ok */ '暴击命中 (2x)', 330, 145, { trigger: 'passive' }),
      bn('dps_total', 'pool', /* cjk-ok */ '累计造成总伤害', 520, 85, {
        initial: 0,
        color: '#ef4444'
      })
    ],
    edges: [
      be('e1', 'resource', 'atk_src', 'crit_gate', '1'),
      be('e2', 'resource', 'crit_gate', 'norm_conv', '75%'),
      be('e3', 'resource', 'crit_gate', 'crit_conv', '25%'),
      be('e4', 'resource', 'norm_conv', 'dps_total', 'BaseAtk'),
      be('e5', 'resource', 'crit_conv', 'dps_total', 'round(BaseAtk * CritMult)')
    ]
  },
  {
    id: 'bb_dot_poison_bleed_stack',
    domain: 'games',
    category: 'combat',
    shelves: ['combat', 'time'],
    nameZh: '中毒/流血叠层与持续跳字衰减', // cjk-ok
    nameEn: 'DoT Poison Stack & Tick Decay',
    descZh: '周期性叠加毒伤层数，每步按当前层数造成持续伤害并自然消退 1 层。', // cjk-ok
    descEn:
      'Applies poison stacks periodically; each tick deals stack-scaled DoT damage and decays.',
    tags: ['dot', 'poison', 'bleed', 'debuff', 'stack', '持续伤害', '叠毒', '流血'], // cjk-ok
    nodes: [
      bn('apply_poison', 'source', '施加毒刃叠层', 0, 40), // cjk-ok
      bn('poison_stacks', 'pool', /* cjk-ok */ '当前中毒层数', 180, 40, {
        initial: 3,
        capacity: 10,
        color: '#10b981'
      }), // cjk-ok
      bn('stack_decay', 'drain', '层数自然消退', 360, 40, { trigger: 'automatic' }), // cjk-ok
      bn('dot_tick_src', 'source', '每步毒伤跳字', 0, 155), // cjk-ok
      bn('dot_damage', 'pool', '累计DoT总伤害', 240, 155, { initial: 0, color: '#a855f7' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'apply_poison', 'poison_stacks', '3|3'),
      be('e2', 'resource', 'poison_stacks', 'stack_decay', '1'),
      be('e3', 'resource', 'dot_tick_src', 'dot_damage', 'poison_stacks * 4'),
      be('e4', 'state', 'poison_stacks', 'dot_tick_src', '>0')
    ]
  },

  // ═══════════════════ 7. Games · Game economy & monetisation (4) ═══════════════════
  {
    id: 'bb_faucet_sink_core_loop',
    domain: 'games',
    category: 'game_economy',
    shelves: ['economy', 'progression'],
    nameZh: '软硬双货币核心产消闭环', // cjk-ok
    nameEn: 'Soft & Hard Currency Core Loop',
    descZh: '刷本产出金币（软货币）用于强化回收，里程碑与付费补充钻石（硬货币）兑换稀缺加速。', // cjk-ok
    descEn: 'Balances soft-currency grind & upgrade sinks alongside hard-currency gem exchanges.',
    tags: [
      'soft currency',
      'hard currency',
      'gold',
      'gems',
      'faucet',
      'sink',
      /* cjk-ok */ '双货币',
      /* cjk-ok */ '金币钻石'
    ], // cjk-ok
    resources: [
      { id: 'res_gold', name: 'Gold', color: '#f59e0b' },
      { id: 'res_gems', name: 'Gems', color: '#06b6d4' }
    ],
    nodes: [
      bn('quest_gold', 'source', '关卡金币掉落', 0, 30, { resourceId: 'res_gold' }), // cjk-ok
      bn('wallet_gold', 'pool', '金币钱包 Gold', 180, 30, { resourceId: 'res_gold', initial: 30 }), // cjk-ok
      bn('upgrade_sink', 'drain', '装备强化回收', 370, 30, { trigger: 'automatic' }), // cjk-ok
      bn('gem_faucet', 'source', '日常任务钻石', 0, 150, { resourceId: 'res_gems' }), // cjk-ok
      bn('wallet_gems', 'pool', '钻石钱包 Gems', 180, 150, { resourceId: 'res_gems', initial: 10 }), // cjk-ok
      bn('gem_pack_conv', 'converter', /* cjk-ok */ '钻石兑换金币袋', 370, 150, {
        resourceId: 'res_gold',
        trigger: 'automatic'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'quest_gold', 'wallet_gold', '15'),
      be('e2', 'resource', 'wallet_gold', 'upgrade_sink', '18'),
      be('e3', 'resource', 'gem_faucet', 'wallet_gems', '2'),
      be('e4', 'resource', 'wallet_gems', 'gem_pack_conv', '6'),
      be('e5', 'resource', 'gem_pack_conv', 'wallet_gold', '25'),
      be('e6', 'state', 'wallet_gems', 'gem_pack_conv', '>=6', { bend: -40 })
    ]
  },
  {
    id: 'bb_shop_escalating_price',
    domain: 'games',
    category: 'game_economy',
    shelves: ['economy', 'progression'],
    nameZh: '商店动态涨价购买曲线', // cjk-ok
    nameEn: 'Escalating Shop Price Curve',
    descZh: '每次购买道具后持有数 +1，由寄存器实时按 BasePrice * 1.3^Owned 调高下次售价抑制通胀。', // cjk-ok
    descEn:
      'Raises item cost exponentially with each purchase to absorb late-game currency inflation.',
    tags: ['shop', 'price', 'inflation', 'cost scaling', '商店涨价', '递增价格'], // cjk-ok
    params: [{ id: 'p_shop_base', name: 'ShopBaseCost', value: 20 }],
    nodes: [
      bn('earn_gold', 'source', '金币收入', 0, 55), // cjk-ok
      bn('buyer_gold', 'pool', '玩家金币池', 165, 55, { initial: 25 }), // cjk-ok
      bn('buy_item', 'converter', '商店购买按钮', 340, 55, { trigger: 'automatic' }), // cjk-ok
      bn('items_owned', 'pool', '已购建筑/道具数', 510, 55, { initial: 0 }), // cjk-ok
      bn('item_price_reg', 'register', /* cjk-ok */ '当前售价 Price', 340, 175, {
        formula: 'round(ShopBaseCost * pow(1.3, items_owned))'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'earn_gold', 'buyer_gold', '15'),
      be('e2', 'resource', 'buyer_gold', 'buy_item', 'item_price_reg'),
      be('e3', 'resource', 'buy_item', 'items_owned', '1'),
      be('e4', 'state', 'items_owned', 'item_price_reg', '+1'),
      be('e5', 'state', 'buyer_gold', 'buy_item', 'buyer_gold >= item_price_reg', { bend: -45 })
    ]
  },
  {
    id: 'bb_crafting_2to1_workbench',
    domain: 'games',
    category: 'game_economy',
    shelves: ['economy'],
    nameZh: '双原料配方合成工坊 (Pull All)', // cjk-ok
    nameEn: 'Multi-Ingredient Crafting Workbench',
    descZh:
      '同时集齐 2 份铁矿与 1 份木材时才原子扣减并锻造出 1 把精铁长剑（pull_all 防半成品吞料）。', // cjk-ok
    descEn: 'Atomically pulls 2 Iron Ore + 1 Wood (pull_all) to craft 1 Iron Sword.',
    tags: ['crafting', 'recipe', 'workbench', 'pull_all', '配方合成', '锻造台'], // cjk-ok
    resources: [
      { id: 'res_ore', name: 'Iron Ore', color: '#64748b' },
      { id: 'res_wood', name: 'Wood', color: '#92400e' },
      { id: 'res_sword', name: 'Iron Sword', color: '#3b82f6' }
    ],
    nodes: [
      bn('mine_ore', 'source', /* cjk-ok */ '采集铁矿', 0, 20, { resourceId: 'res_ore' }),
      bn('ore_stock', 'pool', /* cjk-ok */ '铁矿库存 Ore', 165, 20, {
        resourceId: 'res_ore',
        initial: 1
      }),
      bn('chop_wood', 'source', /* cjk-ok */ '伐木产出', 0, 150, { resourceId: 'res_wood' }),
      bn('wood_stock', 'pool', /* cjk-ok */ '木材库存 Wood', 165, 150, {
        resourceId: 'res_wood',
        initial: 1
      }),
      bn('workbench', 'converter', /* cjk-ok */ '铁匠合成台 (2矿+1木)', 350, 85, {
        resourceId: 'res_sword',
        trigger: 'automatic',
        pullMode: 'pull_all'
      }),
      bn('sword_stock', 'pool', /* cjk-ok */ '成品铁剑池', 530, 85, {
        resourceId: 'res_sword',
        initial: 0
      })
    ],
    edges: [
      be('e1', 'resource', 'mine_ore', 'ore_stock', '3'),
      be('e2', 'resource', 'chop_wood', 'wood_stock', '1|2'),
      be('e3', 'resource', 'ore_stock', 'workbench', '2'),
      be('e4', 'resource', 'wood_stock', 'workbench', '1'),
      be('e5', 'resource', 'workbench', 'sword_stock', '1'),
      be('e6', 'state', 'ore_stock', 'workbench', '>=2', { bend: -35 }),
      be('e7', 'state', 'wood_stock', 'workbench', '>=1', { bend: 35 })
    ]
  },
  {
    id: 'bb_trader_barter_fee',
    domain: 'games',
    category: 'game_economy',
    shelves: ['economy'],
    nameZh: '拍卖行买卖撮合与交易税抽水', // cjk-ok
    nameEn: 'Marketplace Trade & Tax Sink',
    descZh: '买家支付 10 金币购买药水，卖家实收 9 金币，系统自动抽取 10%（1 金币）交易税销毁回收。', // cjk-ok
    descEn: 'Executes player-to-seller item trades while burning a 10% marketplace tax sink.',
    tags: ['marketplace', 'auction', 'tax', 'fee', 'trader', '拍卖行', '交易税', '抽水'], // cjk-ok
    nodes: [
      bn('buyer_funds', 'pool', '买家金币池', 0, 50, { initial: 100, color: '#f59e0b' }), // cjk-ok
      bn('trade_desk', 'converter', '成交结算 (10G)', 190, 50, { trigger: 'automatic' }), // cjk-ok
      bn('seller_funds', 'pool', '卖家实收池 (90%)', 400, 15, { initial: 0, color: '#10b981' }), // cjk-ok
      bn('tax_sink', 'drain', '系统交易税销毁 (10%)', 400, 115, { color: '#ef4444' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'buyer_funds', 'trade_desk', '10'),
      be('e2', 'resource', 'trade_desk', 'seller_funds', '9'),
      be('e3', 'resource', 'trade_desk', 'tax_sink', '1'),
      be('e4', 'state', 'buyer_funds', 'trade_desk', '>=10', { bend: -40 })
    ]
  },

  // ═══════════════════ 8. Games · Players & live ops (4) ═══════════════════
  {
    id: 'bb_energy_stamina_regen',
    domain: 'games',
    category: 'liveops',
    shelves: ['players', 'time'],
    nameZh: '体力自然恢复与副本次数门槛', // cjk-ok
    nameEn: 'Stamina Regeneration & Session Gate',
    descZh:
      /* cjk-ok */ '体力上限 60，未满时每步恢复 +6；每次刷本消耗 15 体力产出战利品，控制单次游玩时长节奏。',
    descEn: 'Caps Stamina at 60 with +6/tick natural regen while gating 15-Stamina dungeon runs.',
    tags: ['stamina', 'energy', 'session', 'f2p', '体力系统', '自然恢复', '防沉迷'], // cjk-ok
    nodes: [
      bn('stamina_regen', 'source', '自然恢复体力', 0, 60), // cjk-ok
      bn('stamina_pool', 'pool', /* cjk-ok */ '当前体力 Stamina', 175, 60, {
        initial: 45,
        capacity: 60,
        color: '#10b981'
      }),
      bn('run_stage', 'converter', /* cjk-ok */ '挑战副本 (-15体力)', 355, 60, {
        trigger: 'automatic'
      }),
      bn('stage_clears', 'pool', /* cjk-ok */ '通关战利品数', 525, 60, {
        initial: 0,
        color: '#f59e0b'
      })
    ],
    edges: [
      be('e1', 'resource', 'stamina_regen', 'stamina_pool', '6'),
      be('e2', 'resource', 'stamina_pool', 'run_stage', '15'),
      be('e3', 'resource', 'run_stage', 'stage_clears', '1'),
      be('e4', 'state', 'stamina_pool', 'stamina_regen', '<60', { bend: -45 }),
      be('e5', 'state', 'stamina_pool', 'run_stage', '>=15', { bend: 45 })
    ]
  },
  {
    id: 'bb_daily_login_streak',
    domain: 'games',
    category: 'liveops',
    shelves: ['players', 'time', 'economy'],
    nameZh: '每日连续签到递增奖励池', // cjk-ok
    nameEn: 'Daily Login Streak Escalator',
    descZh: '连续登录天数每 +1（最高 7 天封顶奖励档），当日发放奖励随连签天数阶梯递增。', // cjk-ok
    descEn:
      'Increments login streak up to Day 7 and scales daily reward payout with streak length.',
    tags: ['daily login', 'streak', 'retention', 'checkin', '每日签到', '连续登录'], // cjk-ok
    nodes: [
      bn('day_src', 'source', '每日签到打卡', 0, 35), // cjk-ok
      bn('streak_days', 'pool', '连签天数 Streak', 180, 35, { initial: 1, capacity: 7 }), // cjk-ok
      bn('reward_src', 'source', '连签档位发奖', 0, 155), // cjk-ok
      bn('login_gems', 'pool', '签到累计宝石', 220, 155, { initial: 0, color: '#3b82f6' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'day_src', 'streak_days', '1'),
      be('e2', 'resource', 'reward_src', 'login_gems', 'streak_days * 10'),
      be('e3', 'state', 'streak_days', 'day_src', '<7')
    ]
  },
  {
    id: 'bb_battle_pass_dual_track',
    domain: 'games',
    category: 'liveops',
    shelves: ['players', 'progression', 'economy'],
    nameZh: '赛季通行证免费/豪华双轨发奖', // cjk-ok
    nameEn: 'Battle Pass Free & Premium Dual Track',
    descZh: '完成日常任务积累通行证经验提升赛季阶数，同步触发免费轨与付费豪华轨里程碑奖励。', // cjk-ok
    descEn: 'Advances Battle Pass tiers from quest XP and unlocks Free + Premium track rewards.',
    tags: ['battle pass', 'season pass', 'monetisation', 'tiers', '通行证', '战令'], // cjk-ok
    params: [{ id: 'p_has_prem', name: 'PremiumUnlocked', value: 1 }],
    nodes: [
      bn('quest_xp', 'source', '日常周常经验', 0, 80), // cjk-ok
      bn('bp_xp', 'pool', '战令经验池', 155, 80, { initial: 0 }), // cjk-ok
      bn('tier_up', 'converter', '升阶 (100XP/阶)', 315, 80, { trigger: 'automatic' }), // cjk-ok
      bn('bp_tier', 'pool', '当前战令阶数 Tier', 485, 80, { initial: 1, capacity: 50 }), // cjk-ok
      bn('free_rewards', 'pool', '免费轨奖励累计', 485, 0, { initial: 0, color: '#64748b' }), // cjk-ok
      bn('prem_rewards', 'pool', '豪华轨奖励累计', 485, 175, { initial: 0, color: '#f59e0b' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'quest_xp', 'bp_xp', '45'),
      be('e2', 'resource', 'bp_xp', 'tier_up', '100'),
      be('e3', 'resource', 'tier_up', 'bp_tier', '1'),
      be('e4', 'resource', 'tier_up', 'free_rewards', '1'),
      be('e5', 'resource', 'tier_up', 'prem_rewards', 'if(PremiumUnlocked > 0, 3, 0)'),
      be('e6', 'state', 'bp_xp', 'tier_up', '>=100', { bend: -45 })
    ]
  },
  {
    id: 'bb_dau_retention_churn_funnel',
    domain: 'games',
    category: 'liveops',
    shelves: ['players'],
    nameZh: '买量新增、活跃留存与召回漏斗 (DAU)', // cjk-ok
    nameEn: 'UA Acquisition, DAU Retention & Win-Back Funnel',
    descZh: '模拟每日买量新增进入活跃玩家池，按流失率进入沉默池，并通过版本活动召回部分老玩家。', // cjk-ok
    descEn: 'Models daily UA installs, active DAU churn into dormant users, and live-ops win-back.',
    tags: ['dau', 'retention', 'churn', 'ua', 'cohort', '留存率', '流失召回', '买量'], // cjk-ok
    nodes: [
      bn('ua_installs', 'source', /* cjk-ok */ '每日买量新增 UA', 0, 65),
      bn('active_dau', 'pool', /* cjk-ok */ '活跃玩家池 DAU', 180, 65, {
        initial: 200,
        color: '#3b82f6',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('dormant_users', 'pool', /* cjk-ok */ '沉默流失池 Dormant', 390, 65, {
        initial: 50,
        color: '#64748b',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('perm_churn', 'drain', /* cjk-ok */ '永久流失卸载', 570, 65, { trigger: 'automatic' })
    ],
    edges: [
      be('e1', 'resource', 'ua_installs', 'active_dau', '30'),
      be('e2', 'resource', 'active_dau', 'dormant_users', 'round(active_dau * 0.12)', {
        bend: -35
      }),
      be('e3', 'resource', 'dormant_users', 'active_dau', 'round(dormant_users * 0.08)', {
        bend: -35
      }),
      be('e4', 'resource', 'dormant_users', 'perm_churn', 'round(dormant_users * 0.05)')
    ]
  },

  // ═══════════════════ 9. Business · Operations & queues (2) ═══════════════════
  {
    id: 'bb_support_ticket_sla_queue',
    domain: 'business',
    category: 'operations',
    shelves: ['time'],
    nameZh: '客服工单队列积压与席位并发吞吐', // cjk-ok
    nameEn: 'Support Ticket Backlog & Agent Capacity',
    descZh: '随机客户工单进入待处理积压池，按在岗客服人数 * 人均处理效率消化并统计已结单量。', // cjk-ok
    descEn:
      'Queues incoming customer tickets against agent staffing throughput to spot SLA backlogs.',
    tags: ['queue', 'support', 'sla', 'backlog', 'staffing', '工单排队', '客服吞吐'], // cjk-ok
    params: [{ id: 'p_agents', name: 'SupportAgents', value: 4 }],
    nodes: [
      bn('ticket_in', 'source', /* cjk-ok */ '新进客诉工单', 0, 65),
      bn('ticket_backlog', 'pool', /* cjk-ok */ '待处理积压队列', 185, 65, {
        initial: 12,
        color: '#f59e0b',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('resolve_pipe', 'delay', /* cjk-ok */ '席位并发处理 (1步)', 365, 65, { delaySteps: 1 }),
      bn('resolved_pool', 'pool', /* cjk-ok */ '已结案工单数', 535, 65, {
        initial: 0,
        color: '#10b981'
      })
    ],
    edges: [
      be('e1', 'resource', 'ticket_in', 'ticket_backlog', '2D6+1'),
      be('e2', 'resource', 'ticket_backlog', 'resolve_pipe', 'SupportAgents * 2'),
      be('e3', 'resource', 'resolve_pipe', 'resolved_pool', 'all')
    ]
  },
  {
    id: 'bb_kanban_wip_bottleneck',
    domain: 'business',
    category: 'operations',
    shelves: ['time', 'progression'],
    nameZh: '敏捷看板在制品 WIP 限制流水线', // cjk-ok
    nameEn: 'Kanban Dev Pipeline with WIP Limit',
    descZh: '需求从 Backlog 进入开发与 QA 测试阶段，QA 在制品达上限 6 时自动反向阻塞上游拉取。', // cjk-ok
    descEn:
      'Models Backlog -> Dev -> QA -> Done with a strict QA WIP cap that reveals bottlenecks.',
    tags: ['kanban', 'wip', 'bottleneck', 'agile', 'pipeline', '看板', '在制品限制'], // cjk-ok
    nodes: [
      bn('backlog_src', 'source', /* cjk-ok */ '新增需求池', 0, 65),
      bn('dev_wip', 'pool', /* cjk-ok */ '开发中 Dev WIP', 165, 65, {
        initial: 4,
        capacity: 8,
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('qa_wip', 'pool', /* cjk-ok */ '测试中 QA (上限6)', 345, 65, {
        initial: 2,
        capacity: 6,
        overflow: 'block',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('shipped_done', 'pool', /* cjk-ok */ '已发布上线 Done', 525, 65, {
        initial: 0,
        color: '#10b981'
      })
    ],
    edges: [
      be('e1', 'resource', 'backlog_src', 'dev_wip', '4'),
      be('e2', 'resource', 'dev_wip', 'qa_wip', '3'),
      be('e3', 'resource', 'qa_wip', 'shipped_done', '3|2'),
      be('e4', 'state', 'qa_wip', 'dev_wip', '<6', { targetEdgeId: 'e2', bend: 45 })
    ]
  },

  // ═══════════════════ 10. Business · Supply chain & production (2) ═══════════════════
  {
    id: 'bb_reorder_point_safety_stock',
    domain: 'business',
    category: 'supply_chain',
    shelves: ['economy', 'time'],
    nameZh: '安全库存水位与提前期自动补货 (s, Q)', // cjk-ok
    nameEn: 'Safety Stock Reorder Point & Lead Time',
    descZh: '门店库存跌破补货线（<=15）时向工厂下达补货单，经 2 步物流运输延迟后入库上架。', // cjk-ok
    descEn:
      'Triggers a batch factory order when inventory drops <=15, arriving after a 2-step transit delay.',
    tags: ['inventory', 'reorder', 'lead time', 'safety stock', '补货点', '安全库存', '物流延迟'], // cjk-ok
    nodes: [
      bn('factory_order', 'source', '工厂批量发货', 0, 60), // cjk-ok
      bn('transit_delay', 'delay', '在途物流 (2步)', 170, 60, { delaySteps: 2 }), // cjk-ok
      bn('shelf_stock', 'pool', '仓库现货库存', 350, 60, { initial: 24, capacity: 50 }), // cjk-ok
      bn('retail_sales', 'drain', '每日零售出库', 520, 60, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'factory_order', 'transit_delay', '18|2'),
      be('e2', 'resource', 'transit_delay', 'shelf_stock', 'all'),
      be('e3', 'resource', 'shelf_stock', 'retail_sales', '5'),
      be('e4', 'state', 'shelf_stock', 'factory_order', '<=15', { bend: -55 })
    ]
  },
  {
    id: 'bb_perishable_shelf_spoilage',
    domain: 'business',
    category: 'supply_chain',
    shelves: ['economy'],
    nameZh: '生鲜货架销售周转与临期损耗漏出', // cjk-ok
    nameEn: 'Perishable Shelf Sales vs Spoilage Waste',
    descZh: '模拟每日进货后同时面临顾客随机购买与未售库存按比例腐损报废的损耗权衡。', // cjk-ok
    descEn: 'Balances daily fresh restocking against customer demand variance and spoilage waste.',
    tags: ['perishable', 'spoilage', 'waste', 'retail', '生鲜损耗', '临期报废'], // cjk-ok
    nodes: [
      bn('daily_restock', 'source', /* cjk-ok */ '每日清晨进货', 0, 75),
      bn('fresh_stock', 'pool', /* cjk-ok */ '货架鲜品库存', 180, 75, {
        initial: 20,
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('sold_units', 'pool', /* cjk-ok */ '售出盈利件数', 380, 20, {
        initial: 0,
        color: '#10b981'
      }),
      bn('spoiled_waste', 'pool', /* cjk-ok */ '过期报废件数', 380, 140, {
        initial: 0,
        color: '#ef4444'
      })
    ],
    edges: [
      be('e1', 'resource', 'daily_restock', 'fresh_stock', '12'),
      be('e2', 'resource', 'fresh_stock', 'sold_units', '2D6+2'),
      be('e3', 'resource', 'fresh_stock', 'spoiled_waste', 'max(1, floor(fresh_stock * 0.15))')
    ]
  },

  // ═══════════════════ 11. Business · Money & unit economics (2) ═══════════════════
  {
    id: 'bb_saas_mrr_churn_ltv',
    domain: 'business',
    category: 'business_money',
    shelves: ['economy', 'players'],
    nameZh: 'SaaS 订阅客户池、月经常性收入与流失', // cjk-ok
    nameEn: 'SaaS Subscribers, MRR & Churn Flywheel',
    descZh: '新增订阅客户沉淀至付费席位池，每步按 ARPU 贡献 MRR 现金流并扣除月度退订流失。', // cjk-ok
    descEn:
      'Tracks active SaaS subscribers, monthly recurring revenue (MRR) cash inflow, and churn.',
    tags: ['saas', 'mrr', 'arpu', 'churn', 'ltv', '订阅制', '经常性收入'], // cjk-ok
    params: [{ id: 'p_arpu', name: 'MonthlyArpu', value: 10 }],
    nodes: [
      bn('new_signups', 'source', '新增付费转化', 0, 35), // cjk-ok
      bn('active_subs', 'pool', '在订付费客户数', 180, 35, { initial: 20, color: '#3b82f6' }), // cjk-ok
      bn('sub_churn', 'drain', '月度退订流失(8%)', 380, 35, { trigger: 'automatic' }), // cjk-ok
      bn('mrr_src', 'source', '订阅续费入账', 0, 155), // cjk-ok
      bn('arr_cash_pool', 'pool', '累计营收现金池', 220, 155, { initial: 0, color: '#16a34a' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'new_signups', 'active_subs', '4'),
      be('e2', 'resource', 'active_subs', 'sub_churn', 'max(1, round(active_subs * 0.08))'),
      be('e3', 'resource', 'mrr_src', 'arr_cash_pool', 'active_subs * MonthlyArpu')
    ]
  },
  {
    id: 'bb_startup_cash_runway_burn',
    domain: 'business',
    category: 'business_money',
    shelves: ['economy', 'time'],
    nameZh: '创业现金跑道、固定烧钱率与破产线', // cjk-ok
    nameEn: 'Startup Cash Runway & Net Burn Rate',
    descZh: '营收随步数爬坡增长，同时每步扣除固定研发人力成本，实时计算剩余可存活月数 Runway。', // cjk-ok
    descEn:
      'Simulates cash reserves under fixed operating burn vs growing revenue, plus Runway months.',
    tags: ['runway', 'burn rate', 'cashflow', 'break even', '现金流', '烧钱率', '盈亏平衡'], // cjk-ok
    params: [{ id: 'p_opex', name: 'MonthlyBurn', value: 25 }],
    nodes: [
      bn('rev_growth', 'source', '爬坡营业收入', 0, 55), // cjk-ok
      bn('cash_bank', 'pool', '账面现金储备 Cash', 190, 55, { initial: 160, color: '#16a34a' }), // cjk-ok
      bn('opex_drain', 'drain', '固定运营烧钱 Opex', 390, 55, { trigger: 'automatic' }), // cjk-ok
      bn('runway_reg', 'register', /* cjk-ok */ '剩余现金跑道(步)', 190, 170, {
        formula: 'round(cash_bank / max(1, MonthlyBurn))'
      }), // cjk-ok
      bn('bankrupt_end', 'end', '资金链断裂', 390, 170, {}) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'rev_growth', 'cash_bank', '8 + STEP * 2'),
      be('e2', 'resource', 'cash_bank', 'opex_drain', 'MonthlyBurn'),
      be('e3', 'state', 'cash_bank', 'runway_reg', '+1'),
      be('e4', 'state', 'cash_bank', 'bankrupt_end', '<=0')
    ]
  },

  // ═══════════════════ 12. Tokenomics · Token supply (3) ═══════════════════
  {
    id: 'bb_mint_burn_equilibrium',
    domain: 'tokenomics',
    category: 'token_supply',
    shelves: ['economy'],
    nameZh: '代币区块增发与手续费销毁平衡 (BME)', // cjk-ok
    nameEn: 'Burn-and-Mint Equilibrium (EIP-1559 Style)',
    descZh: '协议固定增发奖励给验证者，同时按链上活跃度比例销毁流通代币，使总流通量趋于动态稳态。', // cjk-ok
    descEn:
      'Balances fixed block emissions against usage-proportional token burns toward equilibrium.',
    tags: ['tokenomics', 'mint', 'burn', 'eip1559', 'supply', '增发销毁', '流通量'], // cjk-ok
    nodes: [
      bn('block_mint', 'source', '区块奖励增发 Mint', 0, 60), // cjk-ok
      bn('circ_supply', 'pool', /* cjk-ok */ '流通代币总量 Supply', 195, 60, {
        initial: 100,
        color: '#8b5cf6'
      }), // cjk-ok
      bn('fee_burn', 'drain', '协议销毁黑洞 Burn', 400, 60, { trigger: 'automatic' }), // cjk-ok
      bn('net_inf_reg', 'register', /* cjk-ok */ '当步净通胀量', 195, 170, {
        formula: '12 - round(circ_supply * 0.08)'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'block_mint', 'circ_supply', '12'),
      be('e2', 'resource', 'circ_supply', 'fee_burn', 'round(circ_supply * 0.08)'),
      be('e3', 'state', 'circ_supply', 'net_inf_reg', '+1')
    ]
  },
  {
    id: 'bb_vesting_cliff_linear_unlock',
    domain: 'tokenomics',
    category: 'token_supply',
    shelves: ['time', 'economy'],
    nameZh: '锁仓悬崖期与线性解锁时间表 (Cliff + Vesting)', // cjk-ok
    nameEn: 'Token Vesting Cliff & Linear Unlock Schedule',
    descZh: '前 4 步处于 Cliff 锁仓冻结期（0 释放），第 5 步起按每步固定份额线性解锁进入流通市场。', // cjk-ok
    descEn:
      'Holds locked allocation through a 4-step cliff, then unlocks linearly into circulating supply.',
    tags: ['vesting', 'cliff', 'unlock', 'token', '锁仓解锁', '悬崖期', '代币释放'], // cjk-ok
    nodes: [
      bn('locked_vault', 'pool', /* cjk-ok */ '团队/投资人锁仓池', 20, 60, {
        initial: 100,
        color: '#6366f1',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('unlocked_wallet', 'pool', /* cjk-ok */ '已解锁可流通池', 280, 60, {
        initial: 0,
        color: '#10b981'
      }),
      bn('cliff_gate_reg', 'register', /* cjk-ok */ '当前步解锁额', 150, 165, {
        formula: 'if(STEP >= 5, 10, 0)'
      }),
      bn('vest_done_end', 'end', /* cjk-ok */ '全额解锁完成', 440, 60, {})
    ],
    edges: [
      be('e1', 'resource', 'locked_vault', 'unlocked_wallet', 'cliff_gate_reg'),
      be('e2', 'state', 'unlocked_wallet', 'vest_done_end', '>=100')
    ]
  },
  {
    id: 'bb_halving_epoch_emission',
    domain: 'tokenomics',
    category: 'token_supply',
    shelves: ['time', 'economy'],
    nameZh: '比特币式周期减半区块产出模型', // cjk-ok
    nameEn: 'Halving Epoch Block Emission Curve',
    descZh:
      '每经过 6 个时间步进入下一个减半纪元（Epoch），单步区块产出按 32 -> 16 -> 8 -> 4 阶梯减半。', // cjk-ok
    descEn: 'Halves block emission rate every 6-step epoch (32 -> 16 -> 8 -> 4) toward a hard cap.',
    tags: ['halving', 'bitcoin', 'emission', 'epoch', '减半周期', '通缩模型'], // cjk-ok
    nodes: [
      bn('miner_emit', 'source', '矿工区块产出', 0, 60), // cjk-ok
      bn('mined_supply', 'pool', /* cjk-ok */ '已挖出总供应量', 220, 60, {
        initial: 0,
        capacity: 500,
        color: '#f59e0b'
      }), // cjk-ok
      bn('halving_rate', 'register', /* cjk-ok */ '当前纪元区块奖励', 110, 165, {
        formula: 'max(1, floor(32 / pow(2, floor(max(0, STEP - 1) / 6))))'
      }) // cjk-ok
    ],
    edges: [be('e1', 'resource', 'miner_emit', 'mined_supply', 'halving_rate')]
  },

  // ═══════════════════ 13. Tokenomics · Staking, liquidity & governance (2) ═══════════════════
  {
    id: 'bb_staking_apy_dilution',
    domain: 'tokenomics',
    category: 'defi',
    shelves: ['economy'],
    nameZh: '质押奖池分配与动态 APY 稀释模型', // cjk-ok
    nameEn: 'Staking Reward Pool & Dynamic APY Dilution',
    descZh: '固定每步释放质押奖励，质押总锁仓量（TVL）越高，单位质押分得的年化收益率自动稀释下降。', // cjk-ok
    descEn: 'Distributes fixed epoch rewards across growing staked TVL, dynamically diluting APY.',
    tags: ['staking', 'apy', 'tvl', 'yield', 'dilution', '质押收益', '年化稀释'], // cjk-ok
    params: [{ id: 'p_epoch_rew', name: 'EpochReward', value: 12 }],
    nodes: [
      bn('stake_in', 'source', /* cjk-ok */ '新增用户质押', 0, 35),
      bn('staked_tvl', 'pool', /* cjk-ok */ '总质押锁仓量 TVL', 190, 35, {
        initial: 100,
        color: '#8b5cf6'
      }),
      bn('reward_vault', 'pool', /* cjk-ok */ '激励金库剩余额度', 0, 155, {
        initial: 300,
        color: '#f59e0b',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('apy_meter', 'register', /* cjk-ok */ '实时单步收益率(%)', 390, 95, {
        formula: 'round((EpochReward / max(1, staked_tvl)) * 1000) / 10'
      })
    ],
    edges: [
      be('e1', 'resource', 'stake_in', 'staked_tvl', '15'),
      be('e2', 'resource', 'reward_vault', 'staked_tvl', 'EpochReward'),
      be('e3', 'state', 'staked_tvl', 'apy_meter', '+1')
    ]
  },
  {
    id: 'bb_amm_constant_product_swap',
    domain: 'tokenomics',
    category: 'defi',
    shelves: ['economy'],
    nameZh: 'AMM 恒定乘积池与买盘滑点现价 (x*y=k)', // cjk-ok
    nameEn: 'AMM Liquidity Pool & Spot Price Impact',
    descZh:
      '买盘持续向池内注入 USDC 并按恒定乘积抽走代币，直观展示池内储备变化引发的现货价格拉升。', // cjk-ok
    descEn:
      'Simulates swap buy pressure into a Token/USDC liquidity pool and tracks live spot price.',
    tags: ['amm', 'dex', 'uniswap', 'liquidity', 'slippage', '流动性池', '恒定乘积', '滑点'], // cjk-ok
    nodes: [
      bn('buy_usdc', 'source', '买盘注入 USDC', 0, 25), // cjk-ok
      bn('reserve_usdc', 'pool', '池内 USDC 储备', 190, 25, { initial: 200, color: '#10b981' }), // cjk-ok
      bn('reserve_tok', 'pool', '池内 Token 储备', 190, 145, { initial: 200, color: '#6366f1' }), // cjk-ok
      bn('swap_out', 'drain', '买走提出 Token', 390, 145, { trigger: 'automatic' }), // cjk-ok
      bn('spot_price', 'register', /* cjk-ok */ 'Token 现价 (USDC)', 390, 25, {
        formula: 'round((reserve_usdc / max(1, reserve_tok)) * 100) / 100'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'buy_usdc', 'reserve_usdc', '20'),
      be(
        'e2',
        'resource',
        'reserve_tok',
        'swap_out',
        'max(1, reserve_tok - round(40000 / max(1, reserve_usdc)))'
      ),
      be('e3', 'state', 'reserve_usdc', 'spot_price', '+1'),
      be('e4', 'state', 'reserve_tok', 'spot_price', '+1')
    ]
  },

  // ═══════════════════ 14. Economy · Public finance & macro (2) ═══════════════════
  {
    id: 'bb_tax_treasury_spending_debt',
    domain: 'economy',
    category: 'public_finance',
    shelves: ['economy'],
    nameZh: '财政税收、公共基建乘数与国库结余', // cjk-ok
    nameEn: 'Tax Revenue, Public Spending & GDP Feedback',
    descZh: '经济产出按税率汇入国库，国库再通过基建支出反哺放大社会总产出形成宏观乘数闭环。', // cjk-ok
    descEn: 'Collects tax from GDP into Treasury and reinvests public spending to grow output.',
    tags: ['tax', 'treasury', 'gdp', 'fiscal', 'macro', '财政税收', '国库支出'], // cjk-ok
    params: [{ id: 'p_tax_rate', name: 'TaxRate', value: 0.2 }],
    nodes: [
      bn('gdp_pool', 'pool', /* cjk-ok */ '经济总产值 GDP', 30, 50, {
        initial: 100,
        color: '#3b82f6',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('treasury_pool', 'pool', /* cjk-ok */ '政府国库储备', 270, 50, {
        initial: 20,
        color: '#f59e0b',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('infra_boost', 'source', /* cjk-ok */ '基建乘数增值', 30, 165)
    ],
    edges: [
      be('e1', 'resource', 'gdp_pool', 'treasury_pool', 'round(gdp_pool * TaxRate)', { bend: -35 }),
      be('e2', 'resource', 'treasury_pool', 'gdp_pool', 'round(treasury_pool * 0.6)', {
        bend: -35
      }),
      be('e3', 'resource', 'infra_boost', 'gdp_pool', 'round(treasury_pool * 0.3)')
    ]
  },
  {
    id: 'bb_central_bank_rate_inflation',
    domain: 'economy',
    category: 'public_finance',
    shelves: ['economy', 'time'],
    nameZh: '货币流动性增发与央行加息降温模型', // cjk-ok
    nameEn: 'Money Supply Expansion & Interest Rate Brake',
    descZh: '信贷扩张推高流动性与物价热度；当流动性突破警戒线（>140）时自动触发加息回笼货币。', // cjk-ok
    descEn:
      'Expands credit liquidity until overheating (>140) triggers an interest-rate tightening drain.',
    tags: ['inflation', 'interest rate', 'central bank', 'money supply', '通胀加息', '货币回笼'], // cjk-ok
    nodes: [
      bn('credit_mint', 'source', '信贷宽松放水', 0, 60), // cjk-ok
      bn('money_m2', 'pool', '市场流动性 M2', 190, 60, { initial: 90, color: '#eab308' }), // cjk-ok
      bn('rate_hike_sink', 'drain', '加息缩表回笼', 390, 60, { trigger: 'automatic' }), // cjk-ok
      bn('cpi_index', 'register', /* cjk-ok */ '物价指数 CPI', 190, 170, {
        formula: 'round(100 * (money_m2 / 90))'
      }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'credit_mint', 'money_m2', '14'),
      be('e2', 'resource', 'money_m2', 'rate_hike_sink', '22'),
      be('e3', 'state', 'money_m2', 'rate_hike_sink', '>140'),
      be('e4', 'state', 'money_m2', 'cpi_index', '+1')
    ]
  },

  // ═══════════════════ 15. Economy · Population & society (2) ═══════════════════
  {
    id: 'bb_demographic_birth_aging',
    domain: 'economy',
    category: 'population_social',
    shelves: ['players', 'time'],
    nameZh: '人口代际出生、劳动力成长与老龄化转移', // cjk-ok
    nameEn: 'Demographic Youth, Workforce & Aging Cohort Chain',
    descZh: '人口依次经历青少年、青壮年劳动力与退休老年三阶段池，用于模拟社会抚养比演变。', // cjk-ok
    descEn: 'Flows population cohorts from Youth -> Workforce -> Retirees with birth feedback.',
    tags: ['population', 'demographics', 'aging', 'workforce', '人口结构', '老龄化'], // cjk-ok
    nodes: [
      bn('births_src', 'source', /* cjk-ok */ '新生儿出生', 0, 60),
      bn('youth_pop', 'pool', /* cjk-ok */ '青少年人口', 155, 60, {
        initial: 40,
        color: '#38bdf8',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('workforce_pop', 'pool', /* cjk-ok */ '青壮劳动力', 330, 60, {
        initial: 100,
        color: '#3b82f6',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('retiree_pop', 'pool', /* cjk-ok */ '退休老年人口', 505, 60, {
        initial: 30,
        color: '#94a3b8'
      })
    ],
    edges: [
      be('e1', 'resource', 'births_src', 'youth_pop', 'max(1, round(workforce_pop * 0.05))'),
      be('e2', 'resource', 'youth_pop', 'workforce_pop', 'round(youth_pop * 0.12)'),
      be('e3', 'resource', 'workforce_pop', 'retiree_pop', 'round(workforce_pop * 0.06)')
    ]
  },
  {
    id: 'bb_word_of_mouth_viral_adoption',
    domain: 'economy',
    category: 'population_social',
    shelves: ['players'],
    nameZh: '口碑裂变传播与市场饱和 S 曲线 (Bass 扩散)', // cjk-ok
    nameEn: 'Viral Word-of-Mouth S-Curve Adoption (Bass Model)',
    descZh: '潜在用户受自然广告与已采纳者口碑接触双重驱动转化为活跃用户，呈现典型先快后缓 S 曲线。', // cjk-ok
    descEn: 'Converts potential market into adopters via Bass innovation + word-of-mouth S-curve.',
    tags: ['viral', 's-curve', 'bass', 'adoption', 'word of mouth', '口碑裂变', 'S曲线'], // cjk-ok
    nodes: [
      bn('potential_mkt', 'pool', /* cjk-ok */ '潜在未转化人群', 30, 60, {
        initial: 200,
        color: '#64748b',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('adopted_users', 'pool', /* cjk-ok */ '已采纳用户群', 310, 60, {
        initial: 5,
        color: '#10b981'
      }),
      bn('adopt_rate', 'register', /* cjk-ok */ '当步口碑转化数', 170, 165, {
        formula:
          'min(potential_mkt, max(1, round(potential_mkt * (0.02 + 0.35 * (adopted_users / 205)))))'
      }),
      bn('market_sat_end', 'end', /* cjk-ok */ '市场饱和达成', 480, 60, {})
    ],
    edges: [
      be('e1', 'resource', 'potential_mkt', 'adopted_users', 'adopt_rate'),
      be('e2', 'state', 'potential_mkt', 'adopt_rate', '+1'),
      be('e3', 'state', 'adopted_users', 'adopt_rate', '+1'),
      be('e4', 'state', 'adopted_users', 'market_sat_end', '>=205')
    ]
  },

  // ═══════════════════ 16. Economy · Personal life systems (2) ═══════════════════
  {
    id: 'bb_income_savings_compound',
    domain: 'economy',
    category: 'personal',
    shelves: ['economy', 'progression'],
    nameZh: '个人月薪预算、生活开支与定投复利池', // cjk-ok
    nameEn: 'Paycheck Budget, Living Expenses & Compounding Savings',
    descZh: '每步工资入账扣除生活刚需开销后，结余转入理财账户并产生被动复利收益。', // cjk-ok
    descEn: 'Splits paycheck inflow between living expenses and an interest-bearing savings pool.',
    tags: ['personal finance', 'savings', 'budget', 'compound', '个人理财', '定投复利'], // cjk-ok
    nodes: [
      bn('salary_in', 'source', /* cjk-ok */ '月度薪资入账', 0, 50),
      bn('checking_acct', 'pool', /* cjk-ok */ '活期账户 Checking', 175, 50, { initial: 30 }),
      bn('living_cost', 'drain', /* cjk-ok */ '房租日常开销', 360, 15, { trigger: 'automatic' }),
      bn('invest_pool', 'pool', /* cjk-ok */ '理财复利资产池', 360, 130, {
        initial: 50,
        color: '#10b981',
        trigger: 'automatic',
        pullMode: 'pull_any'
      }),
      bn('passive_div', 'source', /* cjk-ok */ '被动理财收益(5%)', 175, 160)
    ],
    edges: [
      be('e1', 'resource', 'salary_in', 'checking_acct', '25'),
      be('e2', 'resource', 'checking_acct', 'living_cost', '15'),
      be('e3', 'resource', 'checking_acct', 'invest_pool', '8'),
      be('e4', 'resource', 'passive_div', 'invest_pool', 'max(1, round(invest_pool * 0.05))')
    ]
  },
  {
    id: 'bb_energy_work_burnout_recovery',
    domain: 'economy',
    category: 'personal',
    shelves: ['time', 'players'],
    nameZh: '个人精力、高效产出与过劳休息闭环', // cjk-ok
    nameEn: 'Personal Energy, Deep Work & Burnout Recovery',
    descZh: '精力充足（>=25）时高效推进任务产出；精力过低时自动暂停透支并进入睡眠恢复。', // cjk-ok
    descEn: 'Converts personal energy into work output while preventing burnout via rest recovery.',
    tags: ['energy', 'burnout', 'productivity', 'rest', '精力管理', '防过劳'], // cjk-ok
    nodes: [
      bn('rest_regen', 'source', '睡眠休息恢复', 0, 60), // cjk-ok
      bn('body_energy', 'pool', /* cjk-ok */ '身心精力值 Energy', 175, 60, {
        initial: 80,
        capacity: 100,
        color: '#10b981'
      }), // cjk-ok
      bn('deep_work', 'converter', '专注工作投入', 355, 60, { trigger: 'automatic' }), // cjk-ok
      bn('work_done', 'pool', '累计交付成果', 525, 60, { initial: 0, color: '#3b82f6' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'rest_regen', 'body_energy', '12'),
      be('e2', 'resource', 'body_energy', 'deep_work', '20'),
      be('e3', 'resource', 'deep_work', 'work_done', '5'),
      be('e4', 'state', 'body_energy', 'deep_work', '>=25', { bend: -45 }),
      be('e5', 'state', 'body_energy', 'rest_regen', '<100', { bend: 45 })
    ]
  },

  // ═══════════════════ 17. Nature · Epidemiology & health (2) ═══════════════════
  {
    id: 'bb_sir_infection_recovery',
    domain: 'nature',
    category: 'epidemiology',
    shelves: ['players'],
    nameZh: '经典 SIR 易感-感染-康复传染病模型', // cjk-ok
    nameEn: 'SIR Susceptible-Infected-Recovered Epidemic Model',
    descZh: '易感人群（S）按接触传染率转化为感染者（I），随后按康复率获得免疫进入康复池（R）。', // cjk-ok
    descEn: 'Canonical SIR compartment dynamics tracking infection peak load and herd immunity.',
    tags: ['sir', 'epidemic', 'virus', 'infection', 'recovery', '传染病', 'SIR模型'], // cjk-ok
    params: [
      { id: 'p_beta', name: 'ContactBeta', value: 0.45 },
      { id: 'p_gamma', name: 'RecoveryGamma', value: 0.15 }
    ],
    nodes: [
      bn('susceptible_s', 'pool', /* cjk-ok */ '易感人群 S', 20, 60, {
        initial: 190,
        color: '#3b82f6',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('infected_i', 'pool', /* cjk-ok */ '当前感染者 I', 220, 60, {
        initial: 10,
        color: '#ef4444',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('recovered_r', 'pool', /* cjk-ok */ '康复免疫人群 R', 420, 60, {
        initial: 0,
        color: '#10b981'
      }),
      bn('herd_end', 'end', /* cjk-ok */ '群体免疫终结', 420, 165, {})
    ],
    edges: [
      be(
        'e1',
        'resource',
        'susceptible_s',
        'infected_i',
        'min(susceptible_s, max(if(infected_i > 0 && susceptible_s > 0, 1, 0), round(ContactBeta * susceptible_s * infected_i / 200)))'
      ),
      be(
        'e2',
        'resource',
        'infected_i',
        'recovered_r',
        'min(infected_i, max(if(infected_i > 0, 1, 0), round(infected_i * RecoveryGamma)))'
      ),
      be('e3', 'state', 'recovered_r', 'herd_end', '>=200')
    ]
  },
  {
    id: 'bb_hospital_surge_triage',
    domain: 'nature',
    category: 'epidemiology',
    shelves: ['time'],
    nameZh: '医院重症床位承载上限与医疗挤兑分流', // cjk-ok
    nameEn: 'Hospital ICU Bed Capacity & Triage Overflow',
    descZh:
      '病患入院优先占用有限 ICU 床位（上限 20）并在 2 步治疗后出院，超负荷时自动分流至方舱候诊。', // cjk-ok
    descEn:
      'Routes admissions into capped ICU beds first and diverts surge overflow when beds fill up.',
    tags: ['hospital', 'icu', 'triage', 'capacity', 'healthcare', '医疗床位', '分诊挤兑'], // cjk-ok
    nodes: [
      bn('admit_src', 'source', '新增急诊病患', 0, 110), // cjk-ok
      bn('triage_gate', 'gate', '分诊台 Triage', 160, 110, { gateMode: 'deterministic' }), // cjk-ok
      bn('icu_beds', 'pool', /* cjk-ok */ '在院床位 (上限20)', 380, 30, {
        initial: 10,
        capacity: 20,
        color: '#0ea5e9',
        trigger: 'automatic',
        pullMode: 'push_any'
      }),
      bn('discharged', 'pool', '治愈出院人数', 560, 30, { initial: 0, color: '#10b981' }), // cjk-ok
      bn('surge_wait', 'pool', '超载外溢候诊池', 380, 190, { initial: 0, color: '#ef4444' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'admit_src', 'triage_gate', '6'),
      be('e2', 'resource', 'triage_gate', 'icu_beds', '1'),
      be('e3', 'resource', 'triage_gate', 'surge_wait', '1'),
      be('e4', 'resource', 'icu_beds', 'discharged', '5|2'),
      be('e5', 'state', 'icu_beds', 'triage_gate', '<20', { targetEdgeId: 'e2', bend: 42 }),
      be('e6', 'state', 'icu_beds', 'triage_gate', '>=20', { targetEdgeId: 'e3', bend: -26 })
    ]
  },

  // ═══════════════════ 18. Nature · Ecology & populations (2) ═══════════════════
  {
    id: 'bb_predator_prey_lotka',
    domain: 'nature',
    category: 'ecology',
    shelves: [],
    nameZh: '捕食者与猎物种群动态平衡 (鹿与狼)', // cjk-ok
    nameEn: 'Predator-Prey Population Balance (Wolves & Deer)',
    descZh: '草场野鹿自然繁殖，狼群数量决定捕食消耗量并依赖猎物充裕度增减种群。', // cjk-ok
    descEn: 'Couples prey reproduction against predator hunting pressure and starvation.',
    tags: ['ecology', 'predator', 'prey', 'lotka volterra', '捕食者', '生态平衡'], // cjk-ok
    nodes: [
      bn('deer_birth', 'source', /* cjk-ok */ '野鹿自然繁殖', 0, 30),
      bn('deer_pop', 'pool', /* cjk-ok */ '野鹿种群 Deer', 190, 30, {
        initial: 100,
        capacity: 400,
        color: '#10b981'
      }),
      bn('hunted_drain', 'drain', /* cjk-ok */ '被捕食损耗', 390, 30, { trigger: 'automatic' }),
      bn('wolf_birth', 'source', /* cjk-ok */ '狼群繁衍', 0, 155),
      bn('wolf_pop', 'pool', /* cjk-ok */ '狼群种群 Wolves', 190, 155, {
        initial: 10,
        color: '#ef4444'
      }),
      bn('wolf_starve', 'drain', /* cjk-ok */ '食物短缺减员', 390, 155, { trigger: 'automatic' })
    ],
    edges: [
      be('e1', 'resource', 'deer_birth', 'deer_pop', 'max(1, round(deer_pop * 0.28))'),
      be(
        'e2',
        'resource',
        'deer_pop',
        'hunted_drain',
        'min(deer_pop, round(deer_pop * wolf_pop * 0.018))'
      ),
      be('e3', 'resource', 'wolf_birth', 'wolf_pop', 'round(deer_pop * wolf_pop * 0.005)'),
      be('e4', 'resource', 'wolf_pop', 'wolf_starve', 'max(1, round(wolf_pop * 0.35))')
    ]
  },
  {
    id: 'bb_renewable_harvest_regrowth',
    domain: 'nature',
    category: 'ecology',
    shelves: ['economy'],
    nameZh: '可再生森林承载力与可持续采伐阈值', // cjk-ok
    nameEn: 'Renewable Forest Regrowth vs Harvest Yield',
    descZh:
      '森林按 Logistic 承载力曲线自然再生（中段再生最快），对比商业采伐速率验证是否竭泽而渔。', // cjk-ok
    descEn:
      'Models logistic forest regeneration against harvest extraction to test sustainability.',
    tags: ['renewable', 'forestry', 'carrying capacity', 'harvest', '可再生资源', '承载力'], // cjk-ok
    params: [{ id: 'p_harvest', name: 'HarvestQuota', value: 6 }],
    nodes: [
      bn('regrowth_src', 'source', '生态自然再生', 0, 60), // cjk-ok
      bn('forest_stock', 'pool', /* cjk-ok */ '森林蓄积量 (上限120)', 195, 60, {
        initial: 70,
        capacity: 120,
        color: '#16a34a'
      }), // cjk-ok
      bn('timber_yard', 'pool', /* cjk-ok */ '采伐木材收益池', 410, 60, {
        initial: 0,
        color: '#d97706',
        trigger: 'automatic',
        pullMode: 'pull_any'
      })
    ],
    edges: [
      be(
        'e1',
        'resource',
        'regrowth_src',
        'forest_stock',
        'max(0, round(0.28 * forest_stock * (1 - forest_stock / 120)))'
      ),
      be('e2', 'resource', 'forest_stock', 'timber_yard', 'HarvestQuota')
    ]
  },

  // ═══════════════════ 19. Nature · Climate, energy & resources (2) ═══════════════════
  {
    id: 'bb_grid_solar_battery_storage',
    domain: 'nature',
    category: 'climate_resources',
    shelves: ['time'],
    nameZh: '昼夜光伏发电、储能电池与电网负荷供电', // cjk-ok
    nameEn: 'Solar Day/Night Cycle, Battery Storage & Grid Load',
    descZh: '利用正弦波模拟昼夜光照波动发电，优先充入储能电池并持续稳定供给城市用电负荷。', // cjk-ok
    descEn:
      'Buffers cyclical day/night solar generation in a battery bank to serve steady grid load.',
    tags: ['solar', 'battery', 'grid', 'energy', '气候能源', '储能削峰'], // cjk-ok
    nodes: [
      bn('solar_gen', 'source', '昼夜光伏阵列', 0, 60), // cjk-ok
      bn('battery_bank', 'pool', /* cjk-ok */ '储能电池电量 MWh', 200, 60, {
        initial: 40,
        capacity: 100,
        color: '#eab308'
      }), // cjk-ok
      bn('city_load', 'drain', '城市恒定用电负荷', 405, 60, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'solar_gen', 'battery_bank', 'max(0, round(10 + 10 * sin(STEP * 0.9)))'),
      be('e2', 'resource', 'battery_bank', 'city_load', '9')
    ]
  },
  {
    id: 'bb_carbon_emissions_sink',
    domain: 'nature',
    category: 'climate_resources',
    shelves: [],
    nameZh: '大气碳排放存量与海洋森林碳汇净零平衡', // cjk-ok
    nameEn: 'Atmospheric Carbon Stock & Natural Sink Net-Zero',
    descZh:
      '工业碳排放持续注入大气碳库，只有将排放压低至自然碳汇吸收速率以下，大气浓度才会真正拐头下降。', // cjk-ok
    descEn:
      'Demonstrates why atmospheric CO2 keeps rising until emissions fall below sink absorption.',
    tags: ['carbon', 'climate', 'net zero', 'emissions', 'sink', '碳中和', '碳汇'], // cjk-ok
    params: [{ id: 'p_emit_rate', name: 'CarbonEmissions', value: 12 }],
    nodes: [
      bn('ind_emit', 'source', '工业碳排放通量', 0, 60), // cjk-ok
      bn('atmo_co2', 'pool', '大气碳存量池 CO2', 195, 60, { initial: 100, color: '#64748b' }), // cjk-ok
      bn('biosphere_sink', 'drain', '森林海洋碳汇吸收', 400, 60, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'ind_emit', 'atmo_co2', 'CarbonEmissions'),
      be('e2', 'resource', 'atmo_co2', 'biosphere_sink', '8')
    ]
  },

  // ═══════════════════ 20. Teaching · Tool basics (2) ═══════════════════
  {
    id: 'bb_basics_source_pool_drain',
    domain: 'teaching',
    category: 'tool_basics',
    shelves: ['economy'],
    nameZh: '入门第一课：产出源 → 资源池 → 消耗汇', // cjk-ok
    nameEn: 'Tool Basics: Source, Pool & Drain Triad',
    descZh: '最经典的最小可运行系统：Source 每步生产 5，Drain 每步消耗 3，Pool 每步净累积 +2。', // cjk-ok
    descEn:
      'The fundamental 3-node triad: Source (+5/step) -> Pool -> Drain (-3/step) = +2 net growth.',
    tags: ['basics', 'source', 'pool', 'drain', 'tutorial', '基础入门', '三元组'], // cjk-ok
    nodes: [
      bn('basic_src', 'source', '产出源 Source (+5)', 0, 60), // cjk-ok
      bn('basic_pool', 'pool', '资源池 Pool', 190, 60, { initial: 10, color: '#3b82f6' }), // cjk-ok
      bn('basic_drain', 'drain', '消耗汇 Drain (-3)', 380, 60, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'basic_src', 'basic_pool', '5'),
      be('e2', 'resource', 'basic_pool', 'basic_drain', '3')
    ]
  },
  {
    id: 'bb_basics_activators_triggers',
    domain: 'teaching',
    category: 'tool_basics',
    shelves: ['time'],
    nameZh: '状态线入门：条件激活器 (>=) 与星号触发器 (*)', // cjk-ok
    nameEn: 'State Connections: Activators (>=) & Star Triggers (*)',
    descZh:
      '演示虚线状态连接的两大核心用法：>=5 条件激活下游转化，以及转化成功瞬间通过 * 触发额外赠礼。', // cjk-ok
    descEn:
      'Shows state activator (>=5) enabling a converter and star trigger (*) firing a bonus source.',
    tags: ['activator', 'trigger', 'state connection', 'tutorial', '条件激活', '星号触发器'], // cjk-ok
    nodes: [
      bn('ore_faucet', 'source', '充能积累', 0, 40), // cjk-ok
      bn('charge_pool', 'pool', '能量池 (>=5激活)', 170, 40, { initial: 2 }), // cjk-ok
      bn('craft_conv', 'converter', '激活合成器', 350, 40, { trigger: 'automatic' }), // cjk-ok
      bn('bonus_src', 'source', /* cjk-ok */ '联动赠礼源 (*)', 350, 160, { trigger: 'passive' }),
      bn('prize_pool', 'pool', '成品与赠礼池', 525, 100, { initial: 0, color: '#10b981' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'ore_faucet', 'charge_pool', '2'),
      be('e2', 'resource', 'charge_pool', 'craft_conv', '5'),
      be('e3', 'resource', 'craft_conv', 'prize_pool', '1'),
      be('e4', 'state', 'charge_pool', 'craft_conv', '>=5', { bend: -45 }),
      be('e5', 'state', 'craft_conv', 'bonus_src', '*'),
      be('e6', 'resource', 'bonus_src', 'prize_pool', '2')
    ]
  },

  // ═══════════════════ 21. Teaching · Systems lessons (2) ═══════════════════
  {
    id: 'bb_lesson_bathtub_stock_flow',
    domain: 'teaching',
    category: 'systems_lessons',
    shelves: ['time'],
    nameZh: '系统思维课：浴缸水龙头与排水口实验', // cjk-ok
    nameEn: 'Systems Lesson: The Bathtub Stock & Flow Intuition',
    descZh: '唐娜·梅多斯《系统之美》经典第一课：水龙头关小但仍大于排水速时，浴缸水位依然继续上涨。', // cjk-ok
    descEn:
      'Donella Meadows’ classic stock-and-flow lesson: inflow vs outflow determines water level.',
    tags: ['meadows', 'bathtub', 'stock and flow', 'systems thinking', '系统之美', '存量与流量'], // cjk-ok
    params: [
      { id: 'p_faucet_tap', name: 'FaucetTapRate', value: 8 },
      { id: 'p_plug_drain', name: 'DrainPlugRate', value: 5 }
    ],
    nodes: [
      bn('tap_faucet', 'source', '水龙头进水 Faucet', 0, 60), // cjk-ok
      bn('bathtub_water', 'pool', /* cjk-ok */ '浴缸存水量 Water', 195, 60, {
        initial: 20,
        capacity: 100,
        color: '#0ea5e9'
      }), // cjk-ok
      bn('plug_drain', 'drain', '排水口流出 Drain', 390, 60, { trigger: 'automatic' }) // cjk-ok
    ],
    edges: [
      be('e1', 'resource', 'tap_faucet', 'bathtub_water', 'FaucetTapRate'),
      be('e2', 'resource', 'bathtub_water', 'plug_drain', 'DrainPlugRate')
    ]
  },
  {
    id: 'bb_lesson_tragedy_of_commons',
    domain: 'teaching',
    category: 'systems_lessons',
    shelves: ['economy', 'players'],
    nameZh: '系统思维课：公地悲剧（双渔船竞相捕捞）', // cjk-ok
    nameEn: 'Systems Lesson: Tragedy of the Commons',
    descZh: '两支独立扩编的船队从同一片公共渔场竞争捕捞，个体理性增产最终导致公共鱼群加速枯竭。', // cjk-ok
    descEn:
      'Two competing fleets harvest from a shared fishery, illustrating shared-resource collapse.',
    tags: ['commons', 'tragedy', 'shared pool', 'competition', '公地悲剧', '共享资源枯竭'], // cjk-ok
    nodes: [
      bn('fish_spawn', 'source', '鱼群自然繁衍', 0, 80), // cjk-ok
      bn('shared_fishery', 'pool', /* cjk-ok */ '公共渔场存量', 180, 80, {
        initial: 90,
        capacity: 120,
        color: '#06b6d4'
      }), // cjk-ok
      bn('fleet_a_catch', 'pool', /* cjk-ok */ 'A船队渔获池', 395, 20, {
        initial: 0,
        color: '#3b82f6',
        trigger: 'automatic',
        pullMode: 'pull_any'
      }),
      bn('fleet_b_catch', 'pool', /* cjk-ok */ 'B船队渔获池', 395, 145, {
        initial: 0,
        color: '#f59e0b',
        trigger: 'automatic',
        pullMode: 'pull_any'
      })
    ],
    edges: [
      be(
        'e1',
        'resource',
        'fish_spawn',
        'shared_fishery',
        'max(0, round(0.22 * shared_fishery * (1 - shared_fishery / 120)))'
      ),
      be('e2', 'resource', 'shared_fishery', 'fleet_a_catch', '5 + floor(STEP / 3)'),
      be('e3', 'resource', 'shared_fishery', 'fleet_b_catch', '5 + floor(STEP / 3)')
    ]
  }
]

// ───────────────────────────── Lookup & Insertion Engine ─────────────────────────────

export function getMxBuildingBlockById(id: string): MxBuildingBlock | undefined {
  return MX_BUILDING_BLOCKS.find((b) => b.id === id)
}

export function getMxBuildingBlockCategoryMeta(
  category: MxBuildingBlockCategory
): MxBuildingBlockCategoryMeta | undefined {
  return MX_BUILDING_BLOCK_CATEGORIES.find((c) => c.id === category)
}

/**
 * 在公式文本中按标识符词边界替换旧 ID -> 新 ID（避免误伤子串，例如 `a` 不影响 `max`）。 // cjk-ok
 */
export function rewriteMxFormulaIdentifiers(
  formula: string | undefined,
  identMap: ReadonlyMap<string, string>
): string | undefined {
  if (!formula || identMap.size === 0) return formula
  return formula.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (tok) => identMap.get(tok) ?? tok)
}

function snap20(v: number): number {
  return Math.round(v / 20) * 20
}

function allocUniqueIdent(base: string, taken: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9_]/g, '_') || 'item'
  if (!taken.has(clean)) {
    taken.add(clean)
    return clean
  }
  let idx = 2
  while (taken.has(`${clean}_${idx}`)) idx++
  const next = `${clean}_${idx}`
  taken.add(next)
  return next
}

/**
 * 计算在现有文档中无重叠放置新积木的左上角锚点坐标。 // cjk-ok
 */
function computeNonOverlappingPlacement(
  doc: MxDocument,
  blockW: number
): { anchorX: number; anchorY: number } {
  if (doc.nodes.length === 0) {
    return { anchorX: 140, anchorY: 140 }
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of doc.nodes) {
    minX = Math.min(minX, n.x - 60)
    maxX = Math.max(maxX, n.x + 60)
    minY = Math.min(minY, n.y - 60)
    maxY = Math.max(maxY, n.y + 70)
  }
  for (const g of doc.groups ?? []) {
    minX = Math.min(minX, g.x)
    maxX = Math.max(maxX, g.x + g.width)
    minY = Math.min(minY, g.y)
    maxY = Math.max(maxY, g.y + g.height)
  }
  const rightCandidateX = snap20(maxX + 100)
  if (rightCandidateX + blockW <= 1680) {
    return { anchorX: rightCandidateX, anchorY: snap20(Math.max(100, minY + 50)) }
  }
  return {
    anchorX: snap20(Math.max(120, minX + 60)),
    anchorY: snap20(maxY + 110)
  }
}

/**
 * 将指定 Building Block 模块无冲突嵌入当前 `MxDocument`（就地修改 `doc`，供 `store.mutate` 直接调用）： // cjk-ok
 * 1. 自动合并资源颜色与全局参数，若标识符冲突自动编号消歧（如 `xp_pool_2`）； // cjk-ok
 * 2. 自动重写新插入节点/连线/参数公式中的内部标识符引用与 `targetEdgeId`； // cjk-ok
 * 3. 自动计算不与现有图元重叠的网格位置，并可选包裹带标题颜色的 `MxGroup` 子系统框。 // cjk-ok
 */
export function insertMxBuildingBlockIntoDocument(
  doc: MxDocument,
  blockId: string,
  options: MxInsertBuildingBlockOptions = {}
): MxInsertBuildingBlockResult | null {
  const block = getMxBuildingBlockById(blockId)
  if (!block || block.nodes.length === 0) return null

  const takenIdents = new Set<string>()
  for (const n of doc.nodes) takenIdents.add(n.id)
  for (const p of doc.params) {
    takenIdents.add(p.id)
    takenIdents.add(p.name)
  }
  const takenEdgeIds = new Set<string>(doc.edges.map((e) => e.id))
  const takenResIds = new Set<string>(doc.resources.map((r) => r.id))

  // 1. 合并资源定义
  const resMap = new Map<string, string>()
  for (const r of block.resources ?? []) {
    const existing = doc.resources.find(
      (x) =>
        x.id === r.id ||
        (x.name.toLowerCase() === r.name.toLowerCase() &&
          x.color.toLowerCase() === r.color.toLowerCase())
    )
    if (existing) {
      resMap.set(r.id, existing.id)
    } else {
      const nextResId = allocUniqueIdent(r.id, takenResIds)
      doc.resources.push({ ...r, id: nextResId })
      resMap.set(r.id, nextResId)
    }
  }

  // 2. 预分配所有节点与参数的新标识符，建立统一重写映射表
  const identMap = new Map<string, string>()
  const nodeIdMap = new Map<string, string>()
  for (const n of block.nodes) {
    const nextId = allocUniqueIdent(n.id, takenIdents)
    nodeIdMap.set(n.id, nextId)
    if (nextId !== n.id) identMap.set(n.id, nextId)
  }

  const insertedParams: MxParam[] = []
  for (const p of block.params ?? []) {
    const sameExisting = doc.params.find(
      (x) =>
        x.name === p.name &&
        x.value === p.value &&
        (x.varKind ?? 'number') === (p.varKind ?? 'number') &&
        (x.formula ?? '') === (p.formula ?? '')
    )
    if (sameExisting) {
      continue
    }
    const nextName = allocUniqueIdent(p.name, takenIdents)
    const nextParamId = allocUniqueIdent(p.id || `p_${nextName}`, takenIdents)
    if (nextName !== p.name) identMap.set(p.name, nextName)
    insertedParams.push({
      ...JSON.parse(JSON.stringify(p)),
      id: nextParamId,
      name: nextName
    })
  }
  for (const p of insertedParams) {
    if (p.formula) {
      p.formula = rewriteMxFormulaIdentifiers(p.formula, identMap)
    }
    doc.params.push(p)
  }

  // 3. 计算包围盒与锚点偏移
  const rawMinX = Math.min(...block.nodes.map((n) => n.x))
  const rawMaxX = Math.max(...block.nodes.map((n) => n.x))
  const rawMinY = Math.min(...block.nodes.map((n) => n.y))
  const blockW = Math.max(200, rawMaxX - rawMinX + 120)
  const autoPos =
    options.anchorX !== undefined && options.anchorY !== undefined
      ? { anchorX: snap20(options.anchorX), anchorY: snap20(options.anchorY) }
      : computeNonOverlappingPlacement(doc, blockW)

  const dx = autoPos.anchorX - rawMinX
  const dy = autoPos.anchorY - rawMinY

  // 4. 克隆并重写节点
  const insertedNodeIds: string[] = []
  const newNodes: MxNode[] = block.nodes.map((srcNode) => {
    const cloned: MxNode = JSON.parse(JSON.stringify(srcNode))
    const newId = nodeIdMap.get(srcNode.id)!
    cloned.id = newId
    cloned.x = snap20(srcNode.x + dx)
    cloned.y = snap20(srcNode.y + dy)
    if (cloned.resourceId && resMap.has(cloned.resourceId)) {
      cloned.resourceId = resMap.get(cloned.resourceId)
    }
    if (cloned.formula) {
      cloned.formula = rewriteMxFormulaIdentifiers(cloned.formula, identMap)
    }
    if (cloned.botCondition) {
      cloned.botCondition = rewriteMxFormulaIdentifiers(cloned.botCondition, identMap)
    }
    if (options.layerId) {
      cloned.layerId = options.layerId
    }
    insertedNodeIds.push(newId)
    return cloned
  })

  // 5. 预分配连线 ID 并重写连线端点、`targetEdgeId` 与公式
  const edgeIdMap = new Map<string, string>()
  for (const e of block.edges) {
    const baseEdgeId = `${block.id.replace(/^bb_/, '')}_${e.id}`
    const nextEdgeId = allocUniqueIdent(baseEdgeId, takenEdgeIds)
    edgeIdMap.set(e.id, nextEdgeId)
  }

  const blockEdgeById = new Map(block.edges.map((e) => [e.id, e]))
  const insertedEdgeIds: string[] = []
  const newEdges: MxEdge[] = block.edges.map((srcEdge) => {
    const cloned: MxEdge = JSON.parse(JSON.stringify(srcEdge))
    const newEdgeId = edgeIdMap.get(srcEdge.id)!
    cloned.id = newEdgeId
    cloned.from = nodeIdMap.get(srcEdge.from) ?? srcEdge.from
    if (cloned.targetEdgeId) {
      const targetBlockEdge = blockEdgeById.get(cloned.targetEdgeId)
      cloned.to =
        nodeIdMap.get(srcEdge.to) ??
        (targetBlockEdge ? nodeIdMap.get(targetBlockEdge.from) : undefined) ??
        cloned.from
      cloned.targetEdgeId = edgeIdMap.get(cloned.targetEdgeId) ?? cloned.targetEdgeId
    } else {
      cloned.to = nodeIdMap.get(srcEdge.to) ?? srcEdge.to
    }
    if (cloned.resourceId && resMap.has(cloned.resourceId)) {
      cloned.resourceId = resMap.get(cloned.resourceId)
    }
    cloned.formula = rewriteMxFormulaIdentifiers(cloned.formula, identMap) ?? cloned.formula
    if (cloned.interval) {
      cloned.interval = rewriteMxFormulaIdentifiers(cloned.interval, identMap)
    }
    if (options.layerId) {
      cloned.layerId = options.layerId
    }
    insertedEdgeIds.push(newEdgeId)
    return cloned
  })

  doc.nodes.push(...newNodes)
  doc.edges.push(...newEdges)

  // 6. 计算外框并可选创建子系统分组框（方便用户整体拖拽移动）
  const gMinX = Math.min(...newNodes.map((n) => n.x)) - 58
  const gMaxX = Math.max(...newNodes.map((n) => n.x)) + 66
  const gMinY = Math.min(...newNodes.map((n) => n.y)) - 54
  const gMaxY = Math.max(...newNodes.map((n) => n.y)) + 68
  const bounds = {
    x: Math.round(gMinX),
    y: Math.round(gMinY),
    width: Math.max(220, Math.round(gMaxX - gMinX)),
    height: Math.max(140, Math.round(gMaxY - gMinY))
  }

  let groupId: string | undefined
  if (options.wrapInGroup !== false) {
    const catMeta = getMxBuildingBlockCategoryMeta(block.category)
    const isEn = options.locale === 'en'
    const grp: MxGroup = {
      id: mxNewId('grp'),
      label: isEn ? block.nameEn : `${block.nameZh} · ${block.nameEn}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      color: catMeta?.color ?? '#6366f1',
      layerId: options.layerId
    }
    doc.groups = [...(doc.groups ?? []), grp]
    groupId = grp.id
  }

  return {
    blockId: block.id,
    insertedNodeIds,
    insertedEdgeIds,
    groupId,
    bounds
  }
}

/**
 * 将单个 Building Block 创建为独立可运行的 `MxDocument`，用于一键单模块试跑预览。 // cjk-ok
 */
export function createMxDocumentFromBuildingBlock(
  blockId: string,
  locale: 'zh' | 'en' = 'zh'
): MxDocument {
  const block = getMxBuildingBlockById(blockId)
  const doc = createEmptyMxDocument(
    block ? (locale === 'en' ? block.nameEn : block.nameZh) : 'Building Block'
  )
  if (!block) return doc
  doc.description = locale === 'en' ? block.descEn : block.descZh
  doc.settings.steps = block.steps ?? 25
  insertMxBuildingBlockIntoDocument(doc, block.id, {
    anchorX: 160,
    anchorY: 140,
    wrapInGroup: true,
    locale
  })
  return normalizeMxDocument(doc)
}
