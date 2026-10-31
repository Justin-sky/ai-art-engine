/**
 * 卡牌效果引擎（Card Effect Engine）：
 *
 * 1. 卡牌效果脚本 DSL：触发时机（打出/抽到/回合开始/回合结束/消耗时）+ 条件（手牌数/已出牌数/能量/血量/敌方状态/首张）
 *    + 目标（单体/全体/随机/自身）+ 操作（伤害/格挡/抽牌/回能/状态/治疗/弃牌/预知/保留手牌/复制/状态翻倍）
 *    + 关键词（消耗/保留/固有/虚无/能力/X费/不能打出）+ 缩放（×X / ×已出牌数 / ×手牌数 / ×已消耗数）。
 * 2. 事件驱动的回合制战斗内核：多敌人、可编辑敌人意图表（循环/加权随机）、塞状态牌、荆棘、遗物触发器。
 * 3. 三种出牌策略：random（萌新乱出）/ greedy（优先级贪心）/ search（滚动时域有限深度搜索，不偷看牌库）。
 * 4. 卡组对卡组（PvP）真实对打模拟 → N×N 胜率矩阵 → 复制动态求天梯均衡占比。
 */
import { createMxRng, evaluateMxExpression, validateMxExpression } from './machinationsV2'
import type { MxDeckCardSpec } from './gameNumericalWorkbench'

// ───────────────────────────── 1. DSL 类型 ─────────────────────────────

export type MxEffectTrigger =
  | 'on_play'
  | 'on_draw'
  | 'turn_start'
  | 'turn_end'
  | 'on_exhaust'
  /** 亡语：附着在本卡召唤的随从上，随从死亡时结算 */
  | 'deathrattle'
export type MxEffectTarget = 'enemy' | 'all_enemies' | 'random_enemy' | 'self'
export type MxStatusId =
  'vulnerable' | 'weak' | 'poison' | 'strength' | 'dexterity' | 'frail' | 'thorns'
export type MxEffectScale = 'none' | 'x' | 'played' | 'hand' | 'exhausted'
export type MxCardKeyword =
  'exhaust' | 'retain' | 'innate' | 'ethereal' | 'power' | 'x_cost' | 'unplayable'

export interface MxEffectCondition {
  subject: 'hand' | 'played' | 'energy' | 'hp_pct' | 'enemy_hp_pct' | 'enemy_status' | 'first_card'
  cmp: '<=' | '>='
  value: number
  status?: MxStatusId
}

export type MxEffectOp =
  | { op: 'damage'; amount: number; hits: number; target: MxEffectTarget }
  | { op: 'block'; amount: number }
  | { op: 'draw'; amount: number }
  | { op: 'energy'; amount: number }
  | { op: 'status'; status: MxStatusId; amount: number; target: MxEffectTarget }
  | { op: 'heal'; amount: number }
  | { op: 'discard'; amount: number }
  | { op: 'scry'; amount: number }
  | { op: 'retain_all' }
  | { op: 'copy' }
  | { op: 'double_status'; status: MxStatusId; target: MxEffectTarget }
  /** 召唤随从（炉石式场面）：atk/hp，可带嘲讽/圣盾/冲锋/吸血 */
  | {
      op: 'summon'
      atk: number
      hp: number
      taunt: boolean
      divine?: boolean
      charge?: boolean
      lifesteal?: boolean
    }
  /** 重放：再结算一次来源卡牌的打出效果（回响/双发） */
  | { op: 'replay' }
  /** 生成：从己方牌组随机复制 N 张加入手牌 */
  | { op: 'generate'; amount: number }
  /** 发现：从候选池随机抽 choices 张，按估值挑最优 1 张加入手牌（可选本场减费 discount） */
  | { op: 'discover'; choices: number; discount: number }
  /** 定向检索：从抽牌堆找至多 amount 张最高价值可打出牌置入手牌 */
  | { op: 'tutor'; amount: number }
  /** 复活/打捞：有阵亡随从时优先复活至多 amount 个最高价值随从，否则从弃牌/消耗堆捞回高价值牌上手 */
  | { op: 'revive'; amount: number }
  /** 手牌减费：手牌最高费 1 张（或 @all 全部手牌）本场战斗费用 -amount */
  | { op: 'discount'; amount: number; all: boolean }
  /** 群体随从强化（咆哮/野性之力）：己方全场随从获得 +atk/+hp */
  | { op: 'buff_board'; atk: number; hp: number }
  /** 自定义公式逃生舱：按任意战斗状态表达式计算伤害/格挡/治疗/抽牌/能量/状态（如 expr dmg=block） */
  | {
      op: 'expr'
      stat: 'dmg' | 'blk' | 'heal' | 'draw' | 'nrg' | MxStatusId
      formula: string
      target: MxEffectTarget
    }

export interface MxEffectClause {
  trigger: MxEffectTrigger
  condition?: MxEffectCondition
  scale: MxEffectScale
  effect: MxEffectOp
}

export interface MxParsedCardEffects {
  clauses: MxEffectClause[]
  keywords: MxCardKeyword[]
  errors: string[]
}

const SELF_STATUSES: MxStatusId[] = ['strength', 'dexterity', 'thorns']

const OP_ALIASES: Record<string, string> = {
  dmg: 'dmg',
  damage: 'dmg',
  atk: 'dmg',
  attack: 'dmg',
  伤害: 'dmg', // cjk-ok
  伤: 'dmg', // cjk-ok
  攻击: 'dmg', // cjk-ok
  blk: 'blk',
  block: 'blk',
  armor: 'blk',
  格挡: 'blk', // cjk-ok
  护甲: 'blk', // cjk-ok
  甲: 'blk', // cjk-ok
  draw: 'draw',
  抽: 'draw', // cjk-ok
  抽牌: 'draw', // cjk-ok
  nrg: 'nrg',
  energy: 'nrg',
  能量: 'nrg', // cjk-ok
  回能: 'nrg', // cjk-ok
  vuln: 'vulnerable',
  vulnerable: 'vulnerable',
  易伤: 'vulnerable', // cjk-ok
  weak: 'weak',
  虚弱: 'weak', // cjk-ok
  poison: 'poison',
  中毒: 'poison', // cjk-ok
  毒: 'poison', // cjk-ok
  str: 'strength',
  strength: 'strength',
  力量: 'strength', // cjk-ok
  dex: 'dexterity',
  dexterity: 'dexterity',
  敏捷: 'dexterity', // cjk-ok
  frail: 'frail',
  脆弱: 'frail', // cjk-ok
  thorns: 'thorns',
  荆棘: 'thorns', // cjk-ok
  反伤: 'thorns', // cjk-ok
  heal: 'heal',
  治疗: 'heal', // cjk-ok
  回血: 'heal', // cjk-ok
  discard: 'discard',
  弃牌: 'discard', // cjk-ok
  scry: 'scry',
  预知: 'scry', // cjk-ok
  retain_all: 'retain_all',
  保留手牌: 'retain_all', // cjk-ok
  copy: 'copy',
  复制: 'copy', // cjk-ok
  double: 'double',
  翻倍: 'double', // cjk-ok
  summon: 'summon',
  召唤: 'summon', // cjk-ok
  replay: 'replay',
  重放: 'replay', // cjk-ok
  generate: 'generate',
  生成: 'generate', // cjk-ok
  discover: 'discover',
  发现: 'discover', // cjk-ok
  tutor: 'tutor',
  检索: 'tutor', // cjk-ok
  revive: 'revive',
  复活: 'revive', // cjk-ok
  打捞: 'revive', // cjk-ok
  discount: 'discount',
  减费: 'discount', // cjk-ok
  buff: 'buff_board',
  buff_board: 'buff_board',
  强化: 'buff_board', // cjk-ok
  expr: 'expr',
  formula: 'expr',
  公式: 'expr' // cjk-ok
}

const KEYWORD_ALIASES: Record<string, MxCardKeyword> = {
  exhaust: 'exhaust',
  消耗: 'exhaust', // cjk-ok
  retain: 'retain',
  保留: 'retain', // cjk-ok
  innate: 'innate',
  固有: 'innate', // cjk-ok
  ethereal: 'ethereal',
  虚无: 'ethereal', // cjk-ok
  power: 'power',
  能力: 'power', // cjk-ok
  x: 'x_cost',
  xcost: 'x_cost',
  x_cost: 'x_cost',
  x费: 'x_cost', // cjk-ok
  unplayable: 'unplayable',
  不能打出: 'unplayable' // cjk-ok
}

const TRIGGER_ALIASES: Record<string, MxEffectTrigger> = {
  on_play: 'on_play',
  on_draw: 'on_draw',
  turn_start: 'turn_start',
  turn_end: 'turn_end',
  on_exhaust: 'on_exhaust',
  deathrattle: 'deathrattle',
  亡语: 'deathrattle', // cjk-ok
  打出: 'on_play', // cjk-ok
  抽到: 'on_draw', // cjk-ok
  回合开始: 'turn_start', // cjk-ok
  回合结束: 'turn_end', // cjk-ok
  消耗时: 'on_exhaust' // cjk-ok
}

const STATUS_OPS = new Set<string>([
  'vulnerable',
  'weak',
  'poison',
  'strength',
  'dexterity',
  'frail',
  'thorns'
])

function parseTarget(rest: string, fallback: MxEffectTarget): MxEffectTarget {
  if (/@all\b|全体/i.test(rest)) return 'all_enemies' // cjk-ok
  if (/@random\b|随机/i.test(rest)) return 'random_enemy' // cjk-ok
  if (/@self\b|自身/i.test(rest)) return 'self' // cjk-ok
  if (/@enemy\b|单体/i.test(rest)) return 'enemy' // cjk-ok
  return fallback
}

function parseScale(rest: string): MxEffectScale {
  const m = rest.match(/(?:\*|per[:\s]+)\s*(x|played|hand|exhausted|已出牌|手牌|已消耗)/i) // cjk-ok
  if (!m) return 'none'
  const k = m[1]!.toLowerCase()
  if (k === 'x') return 'x'
  if (k === 'played' || k === '已出牌') return 'played' // cjk-ok
  if (k === 'hand' || k === '手牌') return 'hand' // cjk-ok
  return 'exhausted'
}

function parseCondition(src: string): MxEffectCondition | null {
  const s = src.trim().toLowerCase()
  const cmpNorm = (op: string, v: number): { cmp: '<=' | '>='; value: number } => {
    if (op === '<') return { cmp: '<=', value: v - 1 }
    if (op === '>') return { cmp: '>=', value: v + 1 }
    return { cmp: op === '>=' ? '>=' : '<=', value: v }
  }
  let m = s.match(/^(hand|手牌)\s*(<=|>=|<|>)\s*(\d+)$/) // cjk-ok
  if (m) return { subject: 'hand', ...cmpNorm(m[2]!, Number(m[3])) }
  m = s.match(/^(played|已出牌)\s*(<=|>=|<|>)\s*(\d+)$/) // cjk-ok
  if (m) return { subject: 'played', ...cmpNorm(m[2]!, Number(m[3])) }
  m = s.match(/^(energy|能量)\s*(<=|>=|<|>)\s*(\d+)$/) // cjk-ok
  if (m) return { subject: 'energy', ...cmpNorm(m[2]!, Number(m[3])) }
  m = s.match(/^(enemy\.?hp|敌方血量)\s*(<=|>=|<|>)\s*(\d+)%?$/) // cjk-ok
  if (m) return { subject: 'enemy_hp_pct', ...cmpNorm(m[2]!, Number(m[3])) }
  m = s.match(/^(hp|血量)\s*(<=|>=|<|>)\s*(\d+)%?$/) // cjk-ok
  if (m) return { subject: 'hp_pct', ...cmpNorm(m[2]!, Number(m[3])) }
  m = s.match(/^enemy\.(vuln|vulnerable|weak|poison|frail)$/)
  if (m) {
    const st = OP_ALIASES[m[1]!] as MxStatusId
    return { subject: 'enemy_status', cmp: '>=', value: 1, status: st }
  }
  m = s.match(/^敌方(易伤|虚弱|中毒|脆弱)$/) // cjk-ok
  if (m) {
    const st = OP_ALIASES[m[1]!] as MxStatusId
    return { subject: 'enemy_status', cmp: '>=', value: 1, status: st }
  }
  if (s === 'first' || s === '首张') return { subject: 'first_card', cmp: '>=', value: 1 } // cjk-ok
  return null
}

const parseCache = new Map<string, MxParsedCardEffects>()

/**
 * 解析卡牌效果脚本。语句以 `;` 或换行分隔，语法：
 * `[触发:] [if 条件:] 操作 数值[xN段] [@all|@random|@self] [*x|*played|*hand|*exhausted]`
 * 关键词：`kw exhaust, retain, innate, ethereal, power, x, unplayable`
 *
 * 示例：`dmg 6x2; if hand<=2: draw 2; kw exhaust`、`kw x; dmg 5 @all *x`、`kw power; turn_end: blk 3`
 */
export function parseMxCardEffectScript(script: string): MxParsedCardEffects {
  const cached = parseCache.get(script)
  if (cached) return cached
  const result: MxParsedCardEffects = { clauses: [], keywords: [], errors: [] }
  const statements = script
    .split(/[;\n；]/) // cjk-ok
    .map((x) => x.trim())
    .filter(Boolean)

  for (const raw of statements) {
    let stmt = raw
    // 关键词
    const kwMatch = stmt.match(/^(?:kw|keywords?|关键词)\s*[:：]?\s*(.+)$/i) // cjk-ok
    const soloKw = KEYWORD_ALIASES[stmt.toLowerCase()]
    if (kwMatch || soloKw) {
      const list = kwMatch ? kwMatch[1]!.split(/[,，\s]+/) : [stmt] // cjk-ok
      for (const k of list) {
        const kw = KEYWORD_ALIASES[k.trim().toLowerCase()]
        if (kw) {
          if (!result.keywords.includes(kw)) result.keywords.push(kw)
        } else if (k.trim()) {
          result.errors.push(`Unknown keyword "${k.trim()}"`)
        }
      }
      continue
    }

    let trigger: MxEffectTrigger = 'on_play'
    const trigMatch = stmt.match(/^([a-z_\u4e00-\u9fa5]+)\s*[:：]\s*(.+)$/i) // cjk-ok
    if (trigMatch && TRIGGER_ALIASES[trigMatch[1]!.toLowerCase()]) {
      trigger = TRIGGER_ALIASES[trigMatch[1]!.toLowerCase()]!
      stmt = trigMatch[2]!.trim()
    }

    let condition: MxEffectCondition | undefined
    const ifMatch = stmt.match(/^(?:if|若|如果)\s+(.+?)\s*[:：]\s*(.+)$/i) // cjk-ok
    if (ifMatch) {
      const cond = parseCondition(ifMatch[1]!)
      if (!cond) {
        result.errors.push(`Unknown condition "${ifMatch[1]}"`)
        continue
      }
      condition = cond
      stmt = ifMatch[2]!.trim()
    }

    const opMatch = stmt.match(/^([a-z_\u4e00-\u9fa5]+)\s*(.*)$/i) // cjk-ok
    if (!opMatch) {
      result.errors.push(`Cannot parse "${raw}"`)
      continue
    }
    const opKey = OP_ALIASES[opMatch[1]!.toLowerCase()]
    const rest = opMatch[2] ?? ''
    if (!opKey) {
      result.errors.push(`Unknown op "${opMatch[1]}" in "${raw}"`)
      continue
    }
    const numM = rest.match(/(-?\d+(?:\.\d+)?)/)
    const amount = numM ? Number(numM[1]) : 0
    const hitsM = rest.match(/-?\d+(?:\.\d+)?\s*[x×](\d+)/i)
    const hits = hitsM ? Math.max(1, Number(hitsM[1])) : 1
    const scale = parseScale(rest)

    let effect: MxEffectOp | null = null
    if (opKey === 'dmg') {
      effect = { op: 'damage', amount, hits, target: parseTarget(rest, 'enemy') }
    } else if (opKey === 'blk') {
      effect = { op: 'block', amount }
    } else if (opKey === 'draw') {
      effect = { op: 'draw', amount: Math.max(0, Math.round(amount)) }
    } else if (opKey === 'nrg') {
      effect = { op: 'energy', amount: Math.round(amount) }
    } else if (STATUS_OPS.has(opKey)) {
      const st = opKey as MxStatusId
      const fallback: MxEffectTarget = SELF_STATUSES.includes(st) ? 'self' : 'enemy'
      effect = { op: 'status', status: st, amount, target: parseTarget(rest, fallback) }
    } else if (opKey === 'heal') {
      effect = { op: 'heal', amount }
    } else if (opKey === 'discard') {
      effect = { op: 'discard', amount: Math.max(1, Math.round(amount) || 1) }
    } else if (opKey === 'scry') {
      effect = { op: 'scry', amount: Math.max(1, Math.round(amount) || 1) }
    } else if (opKey === 'retain_all') {
      effect = { op: 'retain_all' }
    } else if (opKey === 'copy') {
      effect = { op: 'copy' }
    } else if (opKey === 'summon') {
      const m = rest.match(/(\d+)\s*\/\s*(\d+)/)
      if (!m) {
        result.errors.push(`"summon" needs ATK/HP like "summon 3/2" in "${raw}"`)
        continue
      }
      effect = {
        op: 'summon',
        atk: Number(m[1]),
        hp: Math.max(1, Number(m[2])),
        taunt: /taunt|嘲讽/i.test(rest), // cjk-ok
        divine: /divine|圣盾/i.test(rest), // cjk-ok
        charge: /charge|冲锋/i.test(rest), // cjk-ok
        lifesteal: /lifesteal|吸血/i.test(rest) // cjk-ok
      }
    } else if (opKey === 'replay') {
      effect = { op: 'replay' }
    } else if (opKey === 'generate') {
      effect = { op: 'generate', amount: Math.max(1, Math.round(amount) || 1) }
    } else if (opKey === 'discover') {
      const nums = [...rest.matchAll(/-?\d+/g)].map((x) => Number(x[0]))
      const choices = Math.max(2, Math.min(5, nums[0] && nums[0] > 0 ? nums[0] : 3))
      const disc =
        nums.length >= 2 ? Math.abs(nums[1]!) : nums[0] && nums[0] < 0 ? Math.abs(nums[0]) : 0
      effect = { op: 'discover', choices, discount: disc }
    } else if (opKey === 'tutor') {
      effect = { op: 'tutor', amount: Math.max(1, Math.round(amount) || 1) }
    } else if (opKey === 'revive') {
      effect = { op: 'revive', amount: Math.max(1, Math.round(amount) || 1) }
    } else if (opKey === 'discount') {
      effect = {
        op: 'discount',
        amount: Math.max(1, Math.round(Math.abs(amount)) || 1),
        all: /@all\b|全体/i.test(rest) // cjk-ok
      }
    } else if (opKey === 'buff_board') {
      const m = rest.match(/(-?\d+)\s*\/\s*(-?\d+)/)
      if (!m) {
        result.errors.push(`"buff" needs +ATK/+HP like "buff 2/1" in "${raw}"`)
        continue
      }
      effect = { op: 'buff_board', atk: Number(m[1]), hp: Number(m[2]) }
    } else if (opKey === 'expr') {
      const cleaned = rest.replace(/@(?:all|random|self|enemy)\b|全体|随机|自身|单体/gi, '').trim() // cjk-ok
      const em = cleaned.match(/^([a-z_\u4e00-\u9fa5]+)\s*=\s*(.+)$/i) // cjk-ok
      if (!em) {
        result.errors.push(`"expr" needs STAT=FORMULA like "expr dmg=block" in "${raw}"`)
        continue
      }
      const statKey = OP_ALIASES[em[1]!.toLowerCase()]
      const validStats = new Set(['dmg', 'blk', 'heal', 'draw', 'nrg', ...STATUS_OPS])
      if (!statKey || !validStats.has(statKey)) {
        result.errors.push(`Unknown expr stat "${em[1]}" in "${raw}"`)
        continue
      }
      const formula = em[2]!.trim()
      if (!validateMxExpression(formula)) {
        result.errors.push(`Invalid formula "${formula}" in "${raw}"`)
        continue
      }
      const stTyped = statKey as 'dmg' | 'blk' | 'heal' | 'draw' | 'nrg' | MxStatusId
      const defTarget: MxEffectTarget =
        STATUS_OPS.has(statKey) && SELF_STATUSES.includes(statKey as MxStatusId) ? 'self' : 'enemy'
      effect = { op: 'expr', stat: stTyped, formula, target: parseTarget(rest, defTarget) }
    } else if (opKey === 'double') {
      const stWord = rest.trim().split(/\s+/)[0] ?? ''
      const st = OP_ALIASES[stWord.toLowerCase()]
      if (!st || !STATUS_OPS.has(st)) {
        result.errors.push(`"double" needs a status name in "${raw}"`)
        continue
      }
      const sid = st as MxStatusId
      effect = {
        op: 'double_status',
        status: sid,
        target: parseTarget(rest, SELF_STATUSES.includes(sid) ? 'self' : 'enemy')
      }
    }
    if (!effect) {
      result.errors.push(`Unsupported op in "${raw}"`)
      continue
    }
    result.clauses.push({ trigger, condition, scale, effect })
  }

  if (parseCache.size > 2000) parseCache.clear()
  parseCache.set(script, result)
  return result
}

/** 将基础字段（伤害/段数/格挡/抽牌/回能/力量/易伤/虚弱/中毒/治疗/消耗/额外平伤列）转换为等价效果脚本 */
export function mxLegacyCardToScript(card: MxDeckCardSpec): string {
  const parts: string[] = []
  const hits = Math.max(1, Math.round(card.hits ?? 1))
  if (card.damage > 0) parts.push(`dmg ${card.damage}${hits > 1 ? `x${hits}` : ''}`)
  const flat = legacyFlatDamage(card.customStats)
  if (flat > 0) parts.push(`dmg ${flat}`)
  if (card.block > 0) parts.push(`blk ${card.block}`)
  if (card.draw > 0) parts.push(`draw ${card.draw}`)
  if (card.energyGain > 0) parts.push(`nrg ${card.energyGain}`)
  if (card.applyStrength > 0) parts.push(`str ${card.applyStrength}`)
  if (card.applyVulnerable > 0) parts.push(`vuln ${card.applyVulnerable}`)
  if (card.applyWeak > 0) parts.push(`weak ${card.applyWeak}`)
  if ((card.poison ?? 0) > 0) parts.push(`poison ${card.poison}`)
  if ((card.heal ?? 0) > 0) parts.push(`heal ${card.heal}`)
  if (card.exhaust) parts.push('kw exhaust')
  return parts.join('; ')
}

const FLAT_KEYS = ['flatdamage', 'bonusdamage', 'dmgbonus', 'extradamage', 'flatdmg', 'bonusdmg']
function legacyFlatDamage(cs?: Record<string, number>): number {
  if (!cs) return 0
  let s = 0
  for (const [k, v] of Object.entries(cs)) {
    if (FLAT_KEYS.includes(k.toLowerCase().replace(/[_\s-]/g, '')) && Number.isFinite(v)) s += v
  }
  return s
}

/** 获取卡牌最终效果：优先使用 effectScript，否则由基础字段推导 */
export function mxResolveCardEffects(card: MxDeckCardSpec): MxParsedCardEffects {
  const script = card.effectScript?.trim() ? card.effectScript : mxLegacyCardToScript(card)
  return parseMxCardEffectScript(script)
}

function fmtCond(c: MxEffectCondition): string {
  if (c.subject === 'enemy_status') return `if enemy has ${c.status}`
  if (c.subject === 'first_card') return 'if first card'
  const label: Record<string, string> = {
    hand: 'hand',
    played: 'played',
    energy: 'energy',
    hp_pct: 'HP%',
    enemy_hp_pct: 'enemy HP%'
  }
  return `if ${label[c.subject]}${c.cmp === '<=' ? '≤' : '≥'}${c.value}`
}

/** 人类可读的效果摘要（英文符号化，供 UI 展示） */
export function formatMxCardEffectSummary(fx: MxParsedCardEffects): string {
  const tgt = (t: MxEffectTarget): string =>
    t === 'all_enemies' ? ' (ALL)' : t === 'random_enemy' ? ' (RND)' : ''
  const sc = (s: MxEffectScale): string => (s === 'none' ? '' : ` ×${s}`)
  const parts = fx.clauses.map((c) => {
    const e = c.effect
    let body = ''
    if (e.op === 'damage') body = `${e.amount}${e.hits > 1 ? `×${e.hits}` : ''} DMG${tgt(e.target)}`
    else if (e.op === 'block') body = `${e.amount} BLK`
    else if (e.op === 'draw') body = `Draw ${e.amount}`
    else if (e.op === 'energy') body = `+${e.amount} NRG`
    else if (e.op === 'status') body = `${e.amount} ${e.status}${tgt(e.target)}`
    else if (e.op === 'heal') body = e.amount >= 0 ? `Heal ${e.amount}` : `Lose ${-e.amount} HP`
    else if (e.op === 'discard') body = `Discard ${e.amount}`
    else if (e.op === 'scry') body = `Scry ${e.amount}`
    else if (e.op === 'retain_all') body = 'Retain hand'
    else if (e.op === 'copy') body = 'Copy self'
    else if (e.op === 'summon')
      body = `Summon ${e.atk}/${e.hp}${e.taunt ? ' Taunt' : ''}${e.divine ? ' Divine' : ''}${e.charge ? ' Charge' : ''}${e.lifesteal ? ' Lifesteal' : ''}`
    else if (e.op === 'replay') body = 'Replay card'
    else if (e.op === 'generate') body = `Generate ${e.amount}`
    else if (e.op === 'discover')
      body = `Discover(${e.choices})${e.discount > 0 ? ` -${e.discount}C` : ''}`
    else if (e.op === 'tutor') body = `Tutor ${e.amount}`
    else if (e.op === 'revive') body = `Revive ${e.amount}`
    else if (e.op === 'discount') body = `Cost -${e.amount}${e.all ? ' (ALL)' : ''}`
    else if (e.op === 'buff_board') body = `Board +${e.atk}/+${e.hp}`
    else if (e.op === 'expr') body = `${e.stat.toUpperCase()}=${e.formula}${tgt(e.target)}`
    else body = `Double ${e.status}`
    const pre = c.trigger === 'on_play' ? '' : `[${c.trigger}] `
    const cond = c.condition ? `${fmtCond(c.condition)}: ` : ''
    return `${pre}${cond}${body}${sc(c.scale)}`
  })
  if (fx.keywords.length) parts.push(`[${fx.keywords.join(', ')}]`)
  return parts.join(' · ') || '-'
}

const valueCache = new Map<string, number>()

/** 卡牌期望价值估算（HP 当量），用于奖励选择、商店购买、删卡与弃牌决策 */
export function mxEstimateCardValue(card: MxDeckCardSpec): number {
  const script = card.effectScript?.trim() ? card.effectScript : mxLegacyCardToScript(card)
  const cached = valueCache.get(script)
  if (cached !== undefined) return cached
  const v = estimateValueFromEffects(parseMxCardEffectScript(script))
  if (valueCache.size > 4000) valueCache.clear()
  valueCache.set(script, v)
  return v
}

function estimateValueFromEffects(fx: MxParsedCardEffects): number {
  if (fx.keywords.includes('unplayable')) return -6
  const isPower = fx.keywords.includes('power')
  let v = 0
  for (const c of fx.clauses) {
    const e = c.effect
    let x = 0
    if (e.op === 'damage') x = e.amount * e.hits * (e.target === 'all_enemies' ? 1.5 : 1)
    else if (e.op === 'block') x = e.amount * 0.9
    else if (e.op === 'draw') x = e.amount * 5
    else if (e.op === 'energy') x = e.amount * 7
    else if (e.op === 'status') {
      const w: Record<MxStatusId, number> = {
        vulnerable: 4,
        weak: 3.5,
        poison: 2.2,
        strength: 8,
        dexterity: 6,
        frail: 3,
        thorns: 3
      }
      x = e.amount * w[e.status]
    } else if (e.op === 'heal') x = e.amount * 1.2
    else if (e.op === 'discard') x = 0.5
    else if (e.op === 'scry') x = e.amount * 1.2
    else if (e.op === 'retain_all') x = 3
    else if (e.op === 'copy') x = 2
    else if (e.op === 'summon')
      x =
        e.atk * 2.5 +
        e.hp * 1.2 +
        (e.taunt ? 3 : 0) +
        (e.divine ? e.atk * 0.8 + 2 : 0) +
        (e.charge ? e.atk : 0) +
        (e.lifesteal ? e.atk * 0.8 : 0)
    else if (e.op === 'replay') x = 6
    else if (e.op === 'generate') x = e.amount * 4
    else if (e.op === 'discover') x = 5.5 + e.discount * 3.5
    else if (e.op === 'tutor') x = e.amount * 6.5
    else if (e.op === 'revive') x = e.amount * 6
    else if (e.op === 'discount') x = e.amount * (e.all ? 10 : 4.5)
    else if (e.op === 'buff_board') x = (e.atk * 2.2 + e.hp * 1.2) * 2.2
    else if (e.op === 'expr') {
      const sample = evaluateMxExpression(
        e.formula,
        {
          vars: {
            hp: 50,
            max_hp: 80,
            missing_hp: 30,
            block: 10,
            energy: 2,
            turn: 3,
            hand: 4,
            draw: 10,
            discard: 5,
            exhausted: 2,
            played: 2,
            attacks: 1,
            board: 2,
            board_atk: 5,
            dead: 1,
            str: 2,
            dex: 1,
            thorns: 0,
            enemy_hp: 40,
            enemy_block: 0,
            enemy_poison: 3,
            enemy_vuln: 1,
            x: 2
          },
          rng: () => 0.5
        },
        6
      )
      x = Math.max(2, Math.abs(sample)) * (e.stat === 'draw' ? 4 : e.stat === 'nrg' ? 6 : 1)
    } else x = 8
    if (c.scale === 'x') x *= 3
    else if (c.scale === 'played') x *= 2
    else if (c.scale === 'hand') x *= 4
    else if (c.scale === 'exhausted') x *= 1.5
    if (c.condition) x *= 0.6
    if (c.trigger === 'turn_start' || c.trigger === 'turn_end') x *= isPower ? 4 : 0.8
    if (c.trigger === 'on_draw') x *= 0.9
    if (c.trigger === 'deathrattle') x *= 0.7
    v += x
  }
  if (fx.keywords.includes('exhaust') && !isPower) v *= 0.85
  if (fx.keywords.includes('ethereal')) v *= 0.8
  if (fx.keywords.includes('innate')) v += 2
  if (fx.keywords.includes('retain')) v += 1.5
  return Math.round(v * 10) / 10
}

/** 单位费用价值（0 费按 0.5 费计） */
export function mxCardValuePerCost(card: MxDeckCardSpec): number {
  const fx = mxResolveCardEffects(card)
  const cost = fx.keywords.includes('x_cost') ? 2 : Math.max(0.5, card.cost)
  return mxEstimateCardValue(card) / cost
}

/** 攻击伤害公式：floor((base + 力量) × 虚弱0.75 × 易伤1.5) */
export function mxComputeAttackDamage(
  base: number,
  attackerStrength: number,
  attackerWeak: boolean,
  targetVulnerable: boolean
): number {
  const raw = Math.max(0, base + attackerStrength)
  return Math.floor(raw * (attackerWeak ? 0.75 : 1) * (targetVulnerable ? 1.5 : 1))
}

/** 格挡公式：floor((base + 敏捷) × 脆弱0.75) */
export function mxComputeBlockGain(base: number, dexterity: number, frail: boolean): number {
  return Math.floor(Math.max(0, base + dexterity) * (frail ? 0.75 : 1))
}

// ───────────────────────────── 2. 敌人 / 遭遇 / 遗物 表 ─────────────────────────────

export type MxStatusCardKind = 'dazed' | 'slimed' | 'burn' | 'wound'

export interface MxEnemyIntent {
  name: string
  damage: number
  hits: number
  block: number
  strengthGain: number
  applyStatus?: MxStatusId
  applyAmount?: number
  addStatusCards: number
  statusCardKind?: MxStatusCardKind
  /** 加权随机模式下的权重 */
  weight?: number
  /** 解场：对玩家场上随从造成的伤害总量（从前排依次结算，圣盾抵消 2 点） */
  clearBoard?: number
}

export interface MxEnemySpec {
  id: string
  name: string
  hp: number
  pattern: 'cycle' | 'random'
  thorns?: number
  intents: MxEnemyIntent[]
}

export interface MxEncounterSpec {
  id: string
  name: string
  tier: 'normal' | 'elite' | 'boss'
  enemyIds: string[]
}

export type MxRelicTrigger =
  | 'combat_start'
  | 'turn_start'
  | 'turn_end'
  | 'every_n_attacks'
  | 'every_n_turns'
  | 'on_exhaust'
  | 'combat_end'
  /** 每回合第一张费用 ≥ n 的攻击牌打出后触发（脚本可用 replay 实现死灵之书双发） */
  | 'first_attack_cost_gte'

export interface MxRelicSpec {
  id: string
  name: string
  trigger: MxRelicTrigger
  n?: number
  script: string
}

/** random 萌新 / greedy 贪心 / search 单回合+敌方回应搜索 / rollout 多回合蒙特卡洛前瞻（仅 PvE，最慢） */
export type MxPlayPolicy = 'random' | 'greedy' | 'search' | 'rollout'

const STATUS_CARD_SPECS: Record<MxStatusCardKind, MxDeckCardSpec> = {
  dazed: { ...makeScriptCard('status_dazed', 'Dazed', 0, 'kw unplayable, ethereal'), priority: -5 },
  slimed: { ...makeScriptCard('status_slimed', 'Slimed', 1, 'kw exhaust'), priority: -5 },
  burn: {
    ...makeScriptCard('status_burn', 'Burn', 0, 'kw unplayable; turn_end: heal -2'),
    priority: -5
  },
  wound: { ...makeScriptCard('status_wound', 'Wound', 0, 'kw unplayable'), priority: -5 }
}

/** 以效果脚本快速构造一张卡（基础字段置零） */
export function makeScriptCard(
  id: string,
  name: string,
  cost: number,
  script: string,
  rarity: 'common' | 'uncommon' | 'rare' = 'common',
  count = 1
): MxDeckCardSpec {
  return {
    id,
    name,
    cost,
    count,
    damage: 0,
    hits: 1,
    block: 0,
    draw: 0,
    energyGain: 0,
    applyStrength: 0,
    applyVulnerable: 0,
    applyWeak: 0,
    exhaust: false,
    priority: 5,
    effectScript: script,
    rarity
  }
}

// ───────────────────────────── 3. 战斗内核 ─────────────────────────────

interface MxMinion {
  atk: number
  hp: number
  maxHp: number
  taunt: boolean
  /** 冲锋：召唤/复活当回合可立即攻击 */
  charge: boolean
  /** 本回合刚召唤（召唤失调，回合结束前不攻击） */
  fresh: boolean
  /** 圣盾：完全抵消下一次伤害 */
  divine: boolean
  /** 吸血：造成伤害时为己方本体回复等量生命 */
  lifesteal: boolean
  /** 亡语效果（随从死亡时由其所属行动方结算；规划模拟中不结算） */
  deathrattle: MxEffectClause[]
  /** 所属行动方状态（规划克隆中置空） */
  owner: MxActorState | null
}

interface MxCombatant {
  id: string
  name: string
  hp: number
  maxHp: number
  block: number
  st: Partial<Record<MxStatusId, number>>
  alive: boolean
  thorns: number
  intents?: MxEnemyIntent[]
  pattern?: 'cycle' | 'random'
  intentIdx: number
  nextIntent: MxEnemyIntent | null
  dmgScale: number
  /** PvP 对手：对其下回合输出的估计值（无公开意图时用于规划防御） */
  incomingEstimate?: number
  /** 场上随从（炉石式场面） */
  board: MxMinion[]
  /** 该战斗单位所属的行动方状态（用于亡语结算） */
  ownerState?: MxActorState
}

interface MxCardInst {
  uid: number
  card: MxDeckCardSpec
  fx: MxParsedCardEffects
  /** 预计算的卡牌价值（排序/弃牌决策用） */
  value: number
}

function makeInst(uid: { v: number }, card: MxDeckCardSpec): MxCardInst {
  return { uid: uid.v++, card, fx: mxResolveCardEffects(card), value: mxEstimateCardValue(card) }
}

interface MxCardRunStat {
  drawn: number
  played: number
  damage: number
  block: number
  stranded: number
}

interface MxActorState {
  self: MxCombatant
  foes: MxCombatant[]
  draw: MxCardInst[]
  hand: MxCardInst[]
  discard: MxCardInst[]
  exhaustPile: MxCardInst[]
  energy: number
  baseEnergy: number
  drawPerTurn: number
  powers: MxEffectClause[]
  relics: Array<{ spec: MxRelicSpec; fx: MxParsedCardEffects }>
  playedThisTurn: number
  attacksThisTurn: number
  exhaustedCount: number
  retainAll: boolean
  turn: number
  planning: boolean
  pendingDraw: number
  rng: () => number
  stats: Map<string, MxCardRunStat> | null
  log: string[] | null
  turnDamage: number
  turnBlock: number
  nextUid: { v: number }
  /** 原始牌组（generate 生成卡牌的来源） */
  deckList: MxDeckCardSpec[]
  /** 每回合出牌上限（时间吞噬者式检定） */
  playLimit: number
  /** 每打出一张牌受到的反制伤害（心脏律动式检定） */
  playPunish: number
  firstBigAttackDone: boolean
  turnEnergyAvail: number
  turnEnergySpent: number
  energyAvailTotal: number
  energySpentTotal: number
  shuffles: number
  relicLog: string[]
  replayDepth?: number
  /** 法力水晶成长（炉石式）：第 t 回合能量 = min(start + t - 1, max) */
  energyRamp?: { start: number; max: number }
  /** 手牌跨回合保留（炉石式） */
  keepHand: boolean
  /** 起手牌数（首回合额外抽取） */
  openingHand: number
  /** 起手调度：高于该费用的起手牌洗回并重抽一次 */
  mulliganMaxCost?: number
  /** 疲劳（炉石式）：牌库抽空后不再洗回弃牌堆，每次空抽受到 1、2、3… 点伤害；手牌满 10 张时抽到的牌被烧毁 */
  fatigue: boolean
  fatigueCount: number
  fatigueDamage: number
  /** 本场战斗己方已阵亡随从墓地（供 revive 复活） */
  deadMinions: MxMinion[]
}

function makeCombatant(id: string, name: string, hp: number, maxHp = hp): MxCombatant {
  return {
    id,
    name,
    hp,
    maxHp,
    block: 0,
    st: {},
    alive: true,
    thorns: 0,
    intentIdx: 0,
    nextIntent: null,
    dmgScale: 1,
    board: []
  }
}

function newActorState(
  self: MxCombatant,
  foes: MxCombatant[],
  draw: MxCardInst[],
  deckList: MxDeckCardSpec[],
  opts: {
    energy: number
    draw: number
    relics: MxRelicSpec[]
    rng: () => number
    uid: { v: number }
    record: boolean
    playLimit?: number
    playPunish?: number
    energyRamp?: { start: number; max: number }
    keepHand?: boolean
    openingHand?: number
    mulliganMaxCost?: number
    fatigue?: boolean
  }
): MxActorState {
  const s: MxActorState = {
    self,
    foes,
    draw,
    hand: [],
    discard: [],
    exhaustPile: [],
    energy: 0,
    baseEnergy: Math.max(1, opts.energy),
    drawPerTurn: Math.max(1, opts.draw),
    powers: [],
    relics: opts.relics.map((spec) => ({ spec, fx: parseMxCardEffectScript(spec.script) })),
    playedThisTurn: 0,
    attacksThisTurn: 0,
    exhaustedCount: 0,
    retainAll: false,
    turn: 0,
    planning: false,
    pendingDraw: 0,
    rng: opts.rng,
    stats: new Map(),
    log: opts.record ? [] : null,
    turnDamage: 0,
    turnBlock: 0,
    nextUid: opts.uid,
    deckList,
    playLimit: Math.max(1, opts.playLimit ?? 99),
    playPunish: Math.max(0, opts.playPunish ?? 0),
    firstBigAttackDone: false,
    turnEnergyAvail: 0,
    turnEnergySpent: 0,
    energyAvailTotal: 0,
    energySpentTotal: 0,
    shuffles: 0,
    relicLog: [],
    energyRamp: opts.energyRamp,
    keepHand: Boolean(opts.keepHand),
    openingHand: Math.max(0, opts.openingHand ?? 0),
    mulliganMaxCost: opts.mulliganMaxCost,
    fatigue: Boolean(opts.fatigue),
    fatigueCount: 0,
    fatigueDamage: 0,
    deadMinions: []
  }
  self.ownerState = s
  return s
}

/** 对随从造成伤害（圣盾完全抵消一次）；返回实际扣除的生命 */
function damageMinion(m: MxMinion, dmg: number): number {
  if (dmg <= 0 || m.hp <= 0) return 0
  if (m.divine) {
    m.divine = false
    return 0
  }
  const dealt = Math.min(m.hp, dmg)
  m.hp -= dmg
  return dealt
}

/** 清理阵亡随从并结算亡语（规划克隆中随从 owner 为空，不结算） */
function cleanupBoard(c: MxCombatant, depth = 0): void {
  const dead = c.board.filter((m) => m.hp <= 0)
  if (!dead.length) return
  c.board = c.board.filter((m) => m.hp > 0)
  if (depth > 3) return
  for (const m of dead) {
    const owner = m.owner
    if (owner && !owner.planning && owner.deadMinions.length < 16) {
      owner.deadMinions.push({ ...m, hp: m.maxHp, fresh: true })
    }
    if (!owner || owner.planning || !m.deathrattle.length) continue
    for (const cl of m.deathrattle) resolveClause(owner, { ...cl, trigger: 'on_play' }, 0, null)
    cleanupBoard(owner.self, depth + 1)
    for (const f of owner.foes) cleanupBoard(f, depth + 1)
  }
}

/** 随从承伤：优先由嘲讽随从承受；返回未被吸收的伤害 */
function absorbByTaunt(target: MxCombatant, dmg: number): number {
  const taunt = target.board.find((m) => m.taunt && m.hp > 0)
  if (!taunt || dmg <= 0) return dmg
  damageMinion(taunt, dmg)
  cleanupBoard(target)
  return 0
}

function boardValue(c: MxCombatant): number {
  return c.board.reduce(
    (a, m) =>
      a +
      m.atk * 2 +
      m.hp * 0.6 +
      (m.taunt ? m.hp * 0.4 : 0) +
      (m.divine ? m.atk * 0.8 + 1 : 0) +
      (m.lifesteal ? m.atk * 0.6 : 0) +
      m.deathrattle.length * 2,
    0
  )
}

function st(c: MxCombatant, s: MxStatusId): number {
  return c.st[s] ?? 0
}

function addSt(c: MxCombatant, s: MxStatusId, n: number): void {
  c.st[s] = Math.max(0, (c.st[s] ?? 0) + n)
}

function decaySt(c: MxCombatant, s: MxStatusId): void {
  if ((c.st[s] ?? 0) > 0) c.st[s] = (c.st[s] ?? 0) - 1
}

function applyDamage(target: MxCombatant, dmg: number): number {
  if (!target.alive || dmg <= 0) return 0
  const absorbed = Math.min(target.block, dmg)
  target.block -= absorbed
  const hpDmg = dmg - absorbed
  target.hp -= hpDmg
  if (target.hp <= 0) {
    target.hp = 0
    target.alive = false
  }
  return hpDmg
}

function loseHp(target: MxCombatant, n: number): void {
  if (!target.alive || n <= 0) return
  target.hp -= n
  if (target.hp <= 0) {
    target.hp = 0
    target.alive = false
  }
}

function aliveFoes(s: MxActorState): MxCombatant[] {
  return s.foes.filter((f) => f.alive)
}

/** 单体目标选择：优先可被本次伤害斩杀的最低血量目标，否则最低有效血量目标 */
function chooseTarget(s: MxActorState, expectedDmg = 0): MxCombatant | null {
  const foes = aliveFoes(s)
  if (!foes.length) return null
  const killable = foes.filter((f) => f.hp + f.block <= expectedDmg)
  const pool = killable.length ? killable : foes
  return pool.reduce((a, b) => (a.hp + a.block <= b.hp + b.block ? a : b))
}

function checkCondition(s: MxActorState, cond: MxEffectCondition | undefined): boolean {
  if (!cond) return true
  let v = 0
  if (cond.subject === 'hand') v = s.hand.length
  else if (cond.subject === 'played') v = s.playedThisTurn
  else if (cond.subject === 'energy') v = s.energy
  else if (cond.subject === 'hp_pct') v = (s.self.hp / Math.max(1, s.self.maxHp)) * 100
  else if (cond.subject === 'enemy_hp_pct') {
    const t = chooseTarget(s)
    v = t ? (t.hp / Math.max(1, t.maxHp)) * 100 : 0
  } else if (cond.subject === 'enemy_status') {
    const t = chooseTarget(s)
    v = t && cond.status ? st(t, cond.status) : 0
  } else if (cond.subject === 'first_card') v = s.playedThisTurn === 0 ? 1 : 0
  return cond.cmp === '<=' ? v <= cond.value : v >= cond.value
}

function statFor(s: MxActorState, id: string): MxCardRunStat | null {
  if (!s.stats) return null
  let x = s.stats.get(id)
  if (!x) {
    x = { drawn: 0, played: 0, damage: 0, block: 0, stranded: 0 }
    s.stats.set(id, x)
  }
  return x
}

function drawCards(s: MxActorState, n: number): void {
  if (s.planning) {
    s.pendingDraw += n
    return
  }
  for (let i = 0; i < n; i++) {
    if (s.fatigue) {
      // 炉石式：空牌库受疲劳伤害；手牌已满则烧毁抽到的牌
      if (s.draw.length === 0) {
        s.fatigueCount++
        s.fatigueDamage += s.fatigueCount
        loseHp(s.self, s.fatigueCount)
        if (!s.self.alive) break
        continue
      }
      if (s.hand.length >= 10) {
        const burnt = s.draw.pop()
        if (burnt) s.exhaustPile.push(burnt)
        continue
      }
    }
    if (s.hand.length >= 10) break
    if (s.draw.length === 0) {
      if (s.discard.length === 0) break
      while (s.discard.length) s.draw.push(s.discard.pop()!)
      shuffle(s.draw, s.rng)
      s.shuffles++
    }
    const c = s.draw.pop()
    if (!c) break
    s.hand.push(c)
    const stt = statFor(s, c.card.id)
    if (stt) stt.drawn++
    for (const cl of c.fx.clauses) {
      if (cl.trigger === 'on_draw') resolveClause(s, cl, 0, c)
    }
  }
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]!
    arr[i] = arr[j]!
    arr[j] = t
  }
}

function resolveClause(
  s: MxActorState,
  cl: MxEffectClause,
  x: number,
  source: MxCardInst | null
): void {
  if (!s.self.alive) return
  if (!checkCondition(s, cl.condition)) return
  let mult = 1
  if (cl.scale === 'x') mult = x
  else if (cl.scale === 'played') mult = s.playedThisTurn
  else if (cl.scale === 'hand') mult = s.hand.length
  else if (cl.scale === 'exhausted') mult = s.exhaustedCount
  const e = cl.effect
  const srcStat = source ? statFor(s, source.card.id) : null

  if (e.op === 'damage') {
    const hits = Math.max(1, e.hits)
    const per = e.amount * mult
    for (let h = 0; h < hits; h++) {
      let targets: MxCombatant[] = []
      const foes = aliveFoes(s)
      if (!foes.length) break
      if (e.target === 'all_enemies') targets = foes
      else if (e.target === 'random_enemy') {
        targets = s.planning
          ? [foes.reduce((a, b) => (a.hp <= b.hp ? a : b))]
          : [foes[Math.floor(s.rng() * foes.length)]!]
      } else if (e.target === 'self') targets = [s.self]
      else {
        const t = chooseTarget(s, per + st(s.self, 'strength'))
        targets = t ? [t] : []
      }
      for (const t of targets) {
        const dmg = mxComputeAttackDamage(
          per,
          st(s.self, 'strength'),
          st(s.self, 'weak') > 0,
          st(t, 'vulnerable') > 0
        )
        const dealt = applyDamage(t, dmg)
        s.turnDamage += dealt
        if (srcStat) srcStat.damage += dealt
        if (t !== s.self && t.thorns + st(t, 'thorns') > 0) {
          applyDamage(s.self, t.thorns + st(t, 'thorns'))
        }
      }
      // 全体伤害同时波及敌方场上随从（不吃易伤）
      if (e.target === 'all_enemies') {
        for (const f of s.foes) {
          if (!f.board.length) continue
          const mdmg = mxComputeAttackDamage(
            per,
            st(s.self, 'strength'),
            st(s.self, 'weak') > 0,
            false
          )
          for (const m of f.board) damageMinion(m, mdmg)
          cleanupBoard(f)
        }
      }
    }
  } else if (e.op === 'block') {
    const g = mxComputeBlockGain(e.amount * mult, st(s.self, 'dexterity'), st(s.self, 'frail') > 0)
    s.self.block += g
    s.turnBlock += g
    if (srcStat) srcStat.block += g
  } else if (e.op === 'draw') {
    drawCards(s, Math.round(e.amount * mult))
  } else if (e.op === 'energy') {
    const gain = Math.round(e.amount * mult)
    s.energy = Math.max(0, s.energy + gain)
    if (!s.planning && gain > 0) {
      s.turnEnergyAvail += gain
      s.energyAvailTotal += gain
    }
  } else if (e.op === 'status') {
    const amt = Math.round(e.amount * mult)
    if (e.target === 'self') addSt(s.self, e.status, amt)
    else if (e.target === 'all_enemies') aliveFoes(s).forEach((f) => addSt(f, e.status, amt))
    else {
      const t = chooseTarget(s)
      if (t) addSt(t, e.status, amt)
    }
  } else if (e.op === 'heal') {
    const amt = e.amount * mult
    if (amt >= 0) s.self.hp = Math.min(s.self.maxHp, s.self.hp + amt)
    else loseHp(s.self, -amt)
  } else if (e.op === 'discard') {
    for (let i = 0; i < e.amount; i++) {
      if (!s.hand.length) break
      const worst = s.hand.reduce((a, b) => (a.value <= b.value ? a : b))
      s.hand.splice(s.hand.indexOf(worst), 1)
      s.discard.push(worst)
    }
  } else if (e.op === 'scry') {
    if (s.planning) {
      s.pendingDraw += 0.3 * e.amount
    } else {
      const top = s.draw.splice(Math.max(0, s.draw.length - e.amount), e.amount)
      for (const c of top) {
        if (c.fx.keywords.includes('unplayable')) s.discard.push(c)
        else s.draw.push(c)
      }
    }
  } else if (e.op === 'retain_all') {
    s.retainAll = true
  } else if (e.op === 'copy') {
    if (!s.planning && source) {
      s.discard.push(makeInst(s.nextUid, source.card))
    }
  } else if (e.op === 'double_status') {
    if (e.target === 'self') addSt(s.self, e.status, st(s.self, e.status))
    else {
      const targets = e.target === 'all_enemies' ? aliveFoes(s) : [chooseTarget(s)]
      for (const t of targets) if (t) addSt(t, e.status, st(t, e.status))
    }
  } else if (e.op === 'summon') {
    if (s.self.board.length < 7) {
      const dr = source ? source.fx.clauses.filter((c) => c.trigger === 'deathrattle') : []
      for (let i = 0; i < Math.max(1, Math.round(mult)); i++) {
        if (s.self.board.length >= 7) break
        s.self.board.push({
          atk: e.atk,
          hp: e.hp,
          maxHp: e.hp,
          taunt: e.taunt,
          charge: Boolean(e.charge),
          fresh: !e.charge,
          divine: Boolean(e.divine),
          lifesteal: Boolean(e.lifesteal),
          deathrattle: dr,
          owner: s.planning ? null : s
        })
      }
    }
  } else if (e.op === 'replay') {
    if (source && (s.replayDepth ?? 0) < 2) {
      s.replayDepth = (s.replayDepth ?? 0) + 1
      for (const c2 of source.fx.clauses) {
        if (c2.trigger === 'on_play' && c2.effect.op !== 'replay') resolveClause(s, c2, x, source)
      }
      s.replayDepth -= 1
    }
  } else if (e.op === 'generate') {
    const n = Math.max(1, Math.round(e.amount * mult))
    if (s.planning) {
      s.pendingDraw += n * 0.8
    } else {
      const pool = s.deckList.filter((c) => !c.effectScript?.includes('unplayable'))
      for (let i = 0; i < n && pool.length && s.hand.length < 10; i++) {
        s.hand.push(makeInst(s.nextUid, pool[Math.floor(s.rng() * pool.length)]!))
      }
    }
  } else if (e.op === 'discover') {
    if (s.planning) {
      s.pendingDraw += 1.1 + e.discount * 0.6
    } else if (s.hand.length < 10) {
      const pool = s.deckList.filter((c) => !c.effectScript?.includes('unplayable'))
      if (pool.length) {
        const cands: MxDeckCardSpec[] = []
        for (let i = 0; i < e.choices; i++) {
          cands.push(pool[Math.floor(s.rng() * pool.length)]!)
        }
        const best = cands.reduce((a, b) =>
          mxEstimateCardValue(a) >= mxEstimateCardValue(b) ? a : b
        )
        const discounted =
          e.discount > 0 ? { ...best, cost: Math.max(0, best.cost - e.discount) } : best
        s.hand.push(makeInst(s.nextUid, discounted))
      }
    }
  } else if (e.op === 'tutor') {
    const n = Math.max(1, Math.round(e.amount * mult))
    if (s.planning) {
      s.pendingDraw += n * 1.2
    } else {
      for (let i = 0; i < n && s.hand.length < 10 && s.draw.length > 0; i++) {
        const playable = s.draw.filter((c) => !c.fx.keywords.includes('unplayable'))
        if (!playable.length) break
        const best = playable.reduce((a, b) => (a.value >= b.value ? a : b))
        s.draw.splice(s.draw.indexOf(best), 1)
        s.hand.push(best)
        const stt = statFor(s, best.card.id)
        if (stt) stt.drawn++
        for (const cl of best.fx.clauses) {
          if (cl.trigger === 'on_draw') resolveClause(s, cl, 0, best)
        }
      }
    }
  } else if (e.op === 'revive') {
    const n = Math.max(1, Math.round(e.amount * mult))
    if (s.deadMinions.length > 0 && s.self.board.length < 7) {
      const sorted = [...s.deadMinions].sort((a, b) => b.atk * 2 + b.maxHp - (a.atk * 2 + a.maxHp))
      for (let i = 0; i < n && sorted.length && s.self.board.length < 7; i++) {
        const m = sorted.shift()!
        const idx = s.deadMinions.indexOf(m)
        if (idx >= 0) s.deadMinions.splice(idx, 1)
        s.self.board.push({ ...m, hp: m.maxHp, fresh: !m.charge, owner: s.planning ? null : s })
      }
    } else if (s.planning) {
      s.pendingDraw += n * 1.1
    } else {
      for (let i = 0; i < n && s.hand.length < 10; i++) {
        const pile = s.discard.some((c) => !c.fx.keywords.includes('unplayable'))
          ? s.discard
          : s.exhaustPile
        const cands = pile.filter((c) => !c.fx.keywords.includes('unplayable'))
        if (!cands.length) break
        const best = cands.reduce((a, b) => (a.value >= b.value ? a : b))
        pile.splice(pile.indexOf(best), 1)
        s.hand.push(best)
      }
    }
  } else if (e.op === 'discount') {
    const amt = Math.max(1, Math.round(e.amount * mult))
    if (e.all) {
      s.hand = s.hand.map((inst) =>
        inst.card.cost > 0
          ? { ...inst, card: { ...inst.card, cost: Math.max(0, inst.card.cost - amt) } }
          : inst
      )
    } else {
      const withCost = s.hand.filter(
        (inst) => inst.card.cost > 0 && !inst.fx.keywords.includes('unplayable')
      )
      if (withCost.length) {
        const target = withCost.reduce((a, b) =>
          a.card.cost > b.card.cost || (a.card.cost === b.card.cost && a.value >= b.value) ? a : b
        )
        const idx = s.hand.indexOf(target)
        if (idx >= 0) {
          s.hand[idx] = {
            ...target,
            card: { ...target.card, cost: Math.max(0, target.card.cost - amt) }
          }
        }
      }
    }
  } else if (e.op === 'buff_board') {
    const da = Math.round(e.atk * mult)
    const dh = Math.round(e.hp * mult)
    for (const m of s.self.board) {
      m.atk = Math.max(0, m.atk + da)
      m.hp += dh
      m.maxHp = Math.max(1, m.maxHp + dh)
    }
    if (dh < 0) cleanupBoard(s.self)
  } else if (e.op === 'expr') {
    const foe = chooseTarget(s)
    const rawVal = evaluateMxExpression(
      e.formula,
      {
        vars: {
          hp: s.self.hp,
          max_hp: s.self.maxHp,
          missing_hp: Math.max(0, s.self.maxHp - s.self.hp),
          block: s.self.block,
          energy: s.energy,
          turn: s.turn,
          hand: s.hand.length,
          draw: s.draw.length,
          discard: s.discard.length,
          exhausted: s.exhaustedCount,
          played: s.playedThisTurn,
          attacks: s.attacksThisTurn,
          board: s.self.board.length,
          board_atk: s.self.board.reduce((a, m) => a + m.atk, 0),
          dead: s.deadMinions.length,
          str: st(s.self, 'strength'),
          dex: st(s.self, 'dexterity'),
          thorns: st(s.self, 'thorns'),
          enemy_hp: foe?.hp ?? 0,
          enemy_block: foe?.block ?? 0,
          enemy_poison: foe ? st(foe, 'poison') : 0,
          enemy_vuln: foe ? st(foe, 'vulnerable') : 0,
          x
        },
        rng: s.rng
      },
      0
    )
    const val = Math.round(rawVal * mult)
    const subEffect: MxEffectOp =
      e.stat === 'dmg'
        ? { op: 'damage', amount: Math.max(0, val), hits: 1, target: e.target }
        : e.stat === 'blk'
          ? { op: 'block', amount: Math.max(0, val) }
          : e.stat === 'heal'
            ? { op: 'heal', amount: val }
            : e.stat === 'draw'
              ? { op: 'draw', amount: Math.max(0, val) }
              : e.stat === 'nrg'
                ? { op: 'energy', amount: val }
                : { op: 'status', status: e.stat, amount: Math.max(0, val), target: e.target }
    resolveClause(s, { trigger: 'on_play', scale: 'none', effect: subEffect }, x, source)
  }
}

function fireRelics(s: MxActorState, trig: MxRelicTrigger, source: MxCardInst | null = null): void {
  for (const r of s.relics) {
    if (r.spec.trigger !== trig) continue
    for (const cl of r.fx.clauses) resolveClause(s, { ...cl, trigger: 'on_play' }, 0, source)
    if (!s.planning) s.relicLog.push(r.spec.name)
  }
}

function isPlayable(s: MxActorState, c: MxCardInst): boolean {
  if (c.fx.keywords.includes('unplayable')) return false
  if (s.playedThisTurn >= s.playLimit) return false
  if (c.fx.keywords.includes('x_cost')) return true
  return c.card.cost <= s.energy
}

function playCard(s: MxActorState, inst: MxCardInst): boolean {
  if (!isPlayable(s, inst)) return false
  const idx = s.hand.indexOf(inst)
  if (idx < 0) return false
  const isX = inst.fx.keywords.includes('x_cost')
  const cost = isX ? s.energy : inst.card.cost
  s.energy -= cost
  if (!s.planning) {
    s.turnEnergySpent += cost
    s.energySpentTotal += cost
  }
  s.hand.splice(idx, 1)
  const stt = statFor(s, inst.card.id)
  if (stt) stt.played++
  const isAttack = inst.fx.clauses.some((c) => c.trigger === 'on_play' && c.effect.op === 'damage')
  for (const cl of inst.fx.clauses) {
    if (cl.trigger === 'on_play') resolveClause(s, cl, isX ? cost : 0, inst)
  }
  if (s.playPunish > 0) applyDamage(s.self, s.playPunish)
  const isPower = inst.fx.keywords.includes('power')
  if (isPower) {
    for (const cl of inst.fx.clauses) {
      if (cl.trigger === 'turn_start' || cl.trigger === 'turn_end') s.powers.push(cl)
    }
  } else if (inst.fx.keywords.includes('exhaust')) {
    exhaustCard(s, inst)
  } else {
    s.discard.push(inst)
  }
  if (isAttack) {
    s.attacksThisTurn++
    for (const r of s.relics) {
      if (
        r.spec.trigger === 'every_n_attacks' &&
        s.attacksThisTurn % Math.max(1, r.spec.n ?? 3) === 0
      ) {
        for (const cl of r.fx.clauses) resolveClause(s, { ...cl, trigger: 'on_play' }, 0, null)
        if (!s.planning) s.relicLog.push(r.spec.name)
      }
      if (
        r.spec.trigger === 'first_attack_cost_gte' &&
        !s.firstBigAttackDone &&
        cost >= Math.max(0, r.spec.n ?? 2)
      ) {
        s.firstBigAttackDone = true
        for (const cl of r.fx.clauses)
          resolveClause(s, { ...cl, trigger: 'on_play' }, isX ? cost : 0, inst)
        if (!s.planning) s.relicLog.push(r.spec.name)
      }
    }
  }
  s.playedThisTurn++
  if (s.log && !s.planning) s.log.push(`${inst.card.name}(${cost})`)
  return true
}

function exhaustCard(s: MxActorState, inst: MxCardInst): void {
  s.exhaustPile.push(inst)
  s.exhaustedCount++
  for (const cl of inst.fx.clauses) {
    if (cl.trigger === 'on_exhaust') resolveClause(s, cl, 0, inst)
  }
  fireRelics(s, 'on_exhaust')
}

// ───────────────────────────── 4. 出牌策略 ─────────────────────────────

function estimateIncoming(s: MxActorState): number {
  let total = 0
  for (const f of aliveFoes(s)) {
    // 敌方随从下回合的攻击
    total += f.board.reduce((a, m) => a + Math.max(0, m.atk), 0)
    if (f.incomingEstimate !== undefined) {
      total += f.incomingEstimate
      continue
    }
    const it = f.nextIntent
    if (!it) continue
    const per = mxComputeAttackDamage(
      it.damage * f.dmgScale,
      st(f, 'strength'),
      st(f, 'weak') > 0,
      st(s.self, 'vulnerable') > 0
    )
    total += per * Math.max(1, it.hits)
  }
  // 嘲讽随从在敌方回合优先承伤（近似：按嘲讽随从总血量抵扣）
  const tauntHp = s.self.board.filter((m) => m.taunt).reduce((a, m) => a + m.hp, 0)
  return Math.max(0, total - tauntHp)
}

function evaluatePlanningState(s: MxActorState): number {
  const foes = s.foes
  if (foes.every((f) => !f.alive)) return 100000 + s.self.hp * 10
  if (!s.self.alive) return -100000
  let v = 0
  for (const f of foes) {
    if (!f.alive) {
      v += 45
      continue
    }
    v -= f.hp + f.block * 0.3
    v -= boardValue(f)
    v += Math.min(3, st(f, 'vulnerable')) * 3
    v += Math.min(3, st(f, 'weak')) * (f.nextIntent?.damage || f.incomingEstimate ? 2.5 : 0.5)
    const p = st(f, 'poison')
    v += Math.min(p * (p + 1) * 0.5, f.hp) * 0.7
  }
  // 两层前瞻：按敌方已公开意图（PvP 用输出估计）推演敌方回合后的血量；会被斩杀的局面重罚
  const incoming = estimateIncoming(s)
  const unblocked = Math.max(0, incoming - s.self.block)
  const hpAfterEnemy = s.self.hp - unblocked
  if (hpAfterEnemy <= 0) v -= 50000
  v += hpAfterEnemy * 1.3 + Math.max(0, s.self.block - incoming) * 0.05
  v += boardValue(s.self)
  v += st(s.self, 'strength') * 5 + st(s.self, 'dexterity') * 4 + st(s.self, 'thorns') * 2
  v -= st(s.self, 'weak') * 1.5 + st(s.self, 'frail') * 1.5
  v += s.powers.length * 6
  v += s.pendingDraw * 3.5
  return v
}

function clonePlanning(s: MxActorState): MxActorState {
  const cloneC = (c: MxCombatant): MxCombatant => ({
    ...c,
    st: { ...c.st },
    board: c.board.map((m) => ({ ...m, owner: null }))
  })
  return {
    ...s,
    self: cloneC(s.self),
    foes: s.foes.map(cloneC),
    draw: [],
    hand: s.hand.slice(),
    discard: [],
    exhaustPile: [],
    powers: s.powers.slice(),
    deadMinions: s.deadMinions.map((m) => ({ ...m, owner: null })),
    planning: true,
    stats: null,
    log: null,
    relicLog: []
  }
}

const SEARCH_NODE_BUDGET = 260
const SEARCH_MAX_DEPTH = 6
const SEARCH_BRANCH = 6

/** 滚动时域搜索：枚举本回合后续出牌序列（抽牌效果按期望价值计，不偷看牌库），返回最优序列的第一张牌 */
function planBestFirstCard(s: MxActorState): MxCardInst | null {
  const root = clonePlanning(s)
  root.pendingDraw = 0
  let bestValue = evaluatePlanningState(root)
  let bestFirst: number | null = null
  let nodes = 0
  const dfs = (ps: MxActorState, depth: number, first: number | null): void => {
    if (nodes++ > SEARCH_NODE_BUDGET) return
    if (first !== null) {
      const v = evaluatePlanningState(ps)
      if (v > bestValue + 1e-6) {
        bestValue = v
        bestFirst = first
      }
    }
    if (depth >= SEARCH_MAX_DEPTH || ps.foes.every((f) => !f.alive)) return
    const seen = new Set<string>()
    const cands = ps.hand.filter((c) => isPlayable(ps, c)).sort((a, b) => b.value - a.value)
    let branches = 0
    for (const c of cands) {
      const key = `${c.card.id}|${c.card.cost}`
      if (seen.has(key)) continue
      seen.add(key)
      if (branches++ >= SEARCH_BRANCH) break
      const child = clonePlanning(ps)
      playCard(child, c)
      dfs(child, depth + 1, first ?? c.uid)
    }
  }
  dfs(root, 0, null)
  if (bestFirst === null) return null
  return s.hand.find((c) => c.uid === bestFirst) ?? null
}

function runPlayPhase(s: MxActorState, policy: MxPlayPolicy): void {
  let guard = 0
  while (s.self.alive && aliveFoes(s).length && guard++ < 40) {
    const playable = s.hand.filter((c) => isPlayable(s, c))
    if (!playable.length) break
    let pick: MxCardInst | null = null
    if (policy === 'random') {
      // 萌新：随机打出可用牌，X 费牌也随手打出
      pick = playable[Math.floor(s.rng() * playable.length)]!
    } else if (policy === 'greedy') {
      pick = playable
        .slice()
        .sort((a, b) => b.card.priority - a.card.priority || b.value - a.value)[0]!
    } else if (policy === 'rollout' && canRollout(s)) {
      pick = planRolloutFirstCard(s)
    } else {
      pick = planBestFirstCard(s)
    }
    if (!pick) break
    if (!playCard(s, pick)) break
  }
}

// ───────── 多回合蒙特卡洛前瞻（rollout 策略） ─────────

const ROLLOUT_CANDIDATES = 5
const ROLLOUT_SAMPLES = 4
const ROLLOUT_HORIZON = 3

/** 仅 PvE（敌人为意图驱动）支持多回合前瞻；PvP 对手是另一套牌组，回退为 search */
function canRollout(s: MxActorState): boolean {
  return !s.planning && s.foes.every((f) => !f.ownerState && f.incomingEstimate === undefined)
}

/** 完整深拷贝战斗状态（牌堆实例不可变可共享；未知牌序在每次采样时重新洗混，不偷看牌库） */
function cloneForRollout(s: MxActorState, rng: () => number): MxActorState {
  const c: MxActorState = {
    ...s,
    self: { ...s.self, st: { ...s.self.st }, board: [] },
    foes: s.foes.map((f) => ({
      ...f,
      st: { ...f.st },
      board: f.board.map((m) => ({ ...m, owner: null }))
    })),
    draw: s.draw.slice(),
    hand: s.hand.slice(),
    discard: s.discard.slice(),
    exhaustPile: s.exhaustPile.slice(),
    powers: s.powers.slice(),
    deadMinions: s.deadMinions.map((m) => ({ ...m, owner: null })),
    rng,
    stats: null,
    log: null,
    relicLog: [],
    nextUid: { v: s.nextUid.v }
  }
  c.self.ownerState = c
  c.self.board = s.self.board.map((m) => ({ ...m, owner: c }))
  shuffle(c.draw, rng)
  return c
}

function rolloutScore(c: MxActorState, turnsUsed: number): number {
  if (!c.self.alive) return -100000
  if (c.foes.every((f) => !f.alive)) return 100000 + c.self.hp * 10 - turnsUsed * 200
  let v = c.self.hp * 1.5 + boardValue(c.self) + st(c.self, 'strength') * 5 + c.powers.length * 6
  for (const f of c.foes) if (f.alive) v -= f.hp + f.block * 0.3 + boardValue(f)
  return v
}

/**
 * 多回合前瞻：对每个候选首张牌（以及「结束回合」）做若干次采样推演——
 * 打出该牌 → 本回合剩余按贪心 → 敌方回合 → 后续 HORIZON-1 个完整回合按贪心，
 * 以终局胜负/剩余血量/敌方血量评分，候选间使用共同随机数。
 */
function planRolloutFirstCard(s: MxActorState): MxCardInst | null {
  const playable = s.hand.filter((c) => isPlayable(s, c))
  if (!playable.length) return null
  const seen = new Set<string>()
  const cands: Array<MxCardInst | null> = [null]
  for (const c of playable.slice().sort((a, b) => b.value - a.value)) {
    const key = `${c.card.id}|${c.card.cost}`
    if (seen.has(key)) continue
    seen.add(key)
    cands.push(c)
    if (cands.length > ROLLOUT_CANDIDATES) break
  }
  const seeds = Array.from({ length: ROLLOUT_SAMPLES }, () => Math.floor(s.rng() * 2 ** 31))
  let best: MxCardInst | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const cand of cands) {
    let total = 0
    for (const seed of seeds) {
      const c = cloneForRollout(s, createMxRng(seed))
      if (cand) {
        const inst = c.hand.find((h) => h.uid === cand.uid)
        if (inst) playCard(c, inst)
        runPlayPhase(c, 'greedy')
      }
      let turns = 0
      if (c.self.alive && c.foes.some((f) => f.alive)) {
        endActorTurn(c)
        if (c.foes.some((f) => f.alive)) runEnemyPhase(c)
        turns = 1
        for (let h = 1; h < ROLLOUT_HORIZON && c.self.alive && c.foes.some((f) => f.alive); h++) {
          runActorTurn(c, 'greedy')
          if (c.self.alive && c.foes.some((f) => f.alive)) runEnemyPhase(c)
          turns++
        }
      }
      total += rolloutScore(c, turns)
    }
    const avg = total / seeds.length
    if (avg > bestScore + 1e-6) {
      bestScore = avg
      best = cand
    }
  }
  return best
}

/** 执行一个行动方的完整回合：清甲 → 中毒结算 → 回能 → 能力/遗物 → 抽牌 → 出牌 → 回合结束效果 → 手牌处理 → 状态衰减 */
function runActorTurn(s: MxActorState, policy: MxPlayPolicy): void {
  s.turn++
  s.self.block = 0
  const p = st(s.self, 'poison')
  if (p > 0) {
    loseHp(s.self, p)
    addSt(s.self, 'poison', -1)
  }
  if (!s.self.alive) return
  if (s.energyRamp) {
    s.baseEnergy = Math.max(1, Math.min(s.energyRamp.max, s.energyRamp.start + s.turn - 1))
  }
  s.energy = s.baseEnergy
  s.turnEnergyAvail = s.baseEnergy
  s.turnEnergySpent = 0
  s.energyAvailTotal += s.baseEnergy
  s.playedThisTurn = 0
  s.attacksThisTurn = 0
  s.retainAll = false
  s.firstBigAttackDone = false
  s.turnDamage = 0
  s.turnBlock = 0
  s.relicLog = []
  if (s.turn === 1) fireRelics(s, 'combat_start')
  fireRelics(s, 'turn_start')
  for (const r of s.relics) {
    if (r.spec.trigger === 'every_n_turns' && s.turn % Math.max(1, r.spec.n ?? 3) === 0) {
      for (const cl of r.fx.clauses) resolveClause(s, { ...cl, trigger: 'on_play' }, 0, null)
      s.relicLog.push(r.spec.name)
    }
  }
  for (const pw of s.powers) if (pw.trigger === 'turn_start') resolveClause(s, pw, 0, null)
  if (s.turn === 1 && s.openingHand > 0) drawOpeningHand(s)
  drawCards(s, s.drawPerTurn)

  runPlayPhase(s, policy)
  endActorTurn(s)
}

/** 回合结束阶段：随从攻击 → 回合结束效果/遗物 → 手牌处理 → 状态衰减 */
function endActorTurn(s: MxActorState): void {
  runMinionAttacks(s)
  for (const pw of s.powers) if (pw.trigger === 'turn_end') resolveClause(s, pw, 0, null)
  for (const c of s.hand.slice()) {
    for (const cl of c.fx.clauses) if (cl.trigger === 'turn_end') resolveClause(s, cl, 0, c)
  }
  fireRelics(s, 'turn_end')
  const keep: MxCardInst[] = []
  for (const c of s.hand) {
    if (c.fx.keywords.includes('ethereal')) {
      exhaustCard(s, c)
    } else if (s.keepHand || s.retainAll || c.fx.keywords.includes('retain')) {
      if (s.keepHand) {
        const stt = statFor(s, c.card.id)
        if (stt && !c.fx.keywords.includes('unplayable')) stt.stranded++
      }
      keep.push(c)
    } else {
      const stt = statFor(s, c.card.id)
      if (stt && !c.fx.keywords.includes('unplayable')) stt.stranded++
      s.discard.push(c)
    }
  }
  s.hand = keep
  decaySt(s.self, 'weak')
  decaySt(s.self, 'frail')
  for (const f of s.foes) decaySt(f, 'vulnerable')
}

function pickNextIntent(e: MxCombatant, rng: () => number): void {
  const list = e.intents ?? []
  if (!list.length) {
    e.nextIntent = null
    return
  }
  if (e.pattern === 'random') {
    const total = list.reduce((a, it) => a + Math.max(0.01, it.weight ?? 1), 0)
    let roll = rng() * total
    for (const it of list) {
      roll -= Math.max(0.01, it.weight ?? 1)
      if (roll <= 0) {
        e.nextIntent = it
        return
      }
    }
    e.nextIntent = list[list.length - 1]!
  } else {
    e.nextIntent = list[e.intentIdx % list.length]!
    e.intentIdx++
  }
}

/** 起手：抽 openingHand 张；高于调度费用上限的牌洗回牌库并重抽一次 */
function drawOpeningHand(s: MxActorState): void {
  drawCards(s, s.openingHand)
  if (s.mulliganMaxCost === undefined) return
  const cap = s.mulliganMaxCost
  const toss = s.hand.filter((c) => c.card.cost > cap && !c.fx.keywords.includes('innate'))
  if (!toss.length) return
  s.hand = s.hand.filter((c) => !toss.includes(c))
  s.draw.unshift(...toss)
  shuffle(s.draw, s.rng)
  drawCards(s, toss.length)
}

/**
 * 随从攻击阶段（行动方回合结束时）：非新召唤的随从依次攻击——
 * 敌方有嘲讽随从则必须先打嘲讽（互相交换伤害），否则打敌方本体（先扣格挡）。
 * 圣盾抵消一次伤害；吸血随从按造成的伤害为本体回血；阵亡随从结算亡语。
 */
function runMinionAttacks(s: MxActorState): void {
  for (const m of s.self.board.slice()) {
    if (m.fresh || m.atk <= 0 || m.hp <= 0) continue
    const foes = aliveFoes(s)
    if (!foes.length) break
    const tauntOwner = foes.find((f) => f.board.some((x) => x.taunt && x.hp > 0))
    let dealtTotal = 0
    if (tauntOwner) {
      const t = tauntOwner.board.find((x) => x.taunt && x.hp > 0)!
      dealtTotal += damageMinion(t, m.atk)
      damageMinion(m, t.atk)
      cleanupBoard(tauntOwner)
    } else {
      const target = chooseTarget(s, m.atk)
      if (target) {
        const dealt = applyDamage(target, m.atk)
        dealtTotal += m.atk
        s.turnDamage += dealt
        if (target.thorns + st(target, 'thorns') > 0) {
          damageMinion(m, target.thorns + st(target, 'thorns'))
        }
      }
    }
    if (m.lifesteal && dealtTotal > 0) {
      s.self.hp = Math.min(s.self.maxHp, s.self.hp + dealtTotal)
    }
  }
  cleanupBoard(s.self)
  for (const m of s.self.board) m.fresh = false
}

function runEnemyPhase(s: MxActorState): string[] {
  const actions: string[] = []
  for (const e of s.foes) {
    if (!e.alive) continue
    e.block = 0
    const p = st(e, 'poison')
    if (p > 0) {
      loseHp(e, p)
      addSt(e, 'poison', -1)
      if (!e.alive) continue
    }
    const it = e.nextIntent
    if (it) {
      if (it.block > 0) e.block += it.block
      if (it.strengthGain) addSt(e, 'strength', it.strengthGain)
      if (it.damage > 0) {
        const hits = Math.max(1, it.hits)
        for (let h = 0; h < hits; h++) {
          const dmg = mxComputeAttackDamage(
            it.damage * e.dmgScale,
            st(e, 'strength'),
            st(e, 'weak') > 0,
            st(s.self, 'vulnerable') > 0
          )
          const rest = absorbByTaunt(s.self, dmg)
          applyDamage(s.self, rest)
          if (st(s.self, 'thorns') > 0) applyDamage(e, st(s.self, 'thorns'))
          if (!s.self.alive) break
        }
      }
      if (it.applyStatus && (it.applyAmount ?? 0) > 0) {
        addSt(s.self, it.applyStatus, it.applyAmount ?? 0)
      }
      if (it.addStatusCards > 0) {
        const spec = STATUS_CARD_SPECS[it.statusCardKind ?? 'dazed']
        for (let i = 0; i < it.addStatusCards; i++) {
          s.discard.push(makeInst(s.nextUid, spec))
        }
      }
      if ((it.clearBoard ?? 0) > 0 && s.self.board.length) {
        // 解场：从前排开始逐个结算，圣盾抵消 2 点解场伤害
        let left = (it.clearBoard ?? 0) * e.dmgScale
        while (left > 0 && s.self.board.some((m) => m.hp > 0)) {
          const front = s.self.board.find((m) => m.hp > 0)!
          if (front.divine) {
            front.divine = false
            left = Math.max(0, left - 2)
          } else {
            const d = Math.min(front.hp, left)
            front.hp -= d
            left -= d
          }
          if (front.hp <= 0) cleanupBoard(s.self)
        }
        cleanupBoard(s.self)
      }
      actions.push(`${e.name}:${it.name}`)
    }
    decaySt(e, 'weak')
    decaySt(e, 'frail')
    pickNextIntent(e, s.rng)
    if (!s.self.alive) break
  }
  decaySt(s.self, 'vulnerable')
  return actions
}

function buildPiles(
  deck: MxDeckCardSpec[],
  rng: () => number,
  uid: { v: number }
): { draw: MxCardInst[]; hand: MxCardInst[] } {
  const all: MxCardInst[] = []
  for (const card of deck) {
    const n = Math.max(1, Math.round(card.count || 1))
    for (let i = 0; i < n; i++) all.push(makeInst(uid, card))
  }
  shuffle(all, rng)
  // 固有牌放到牌库顶，确保首回合抽到
  const innate = all.filter((c) => c.fx.keywords.includes('innate'))
  const rest = all.filter((c) => !c.fx.keywords.includes('innate'))
  return { draw: [...rest, ...innate], hand: [] }
}

function makeEnemy(spec: MxEnemySpec, hpScale: number, dmgScale: number, idx: number): MxCombatant {
  const hp = Math.max(1, Math.round(spec.hp * hpScale))
  const c = makeCombatant(`${spec.id}#${idx}`, spec.name, hp)
  c.thorns = spec.thorns ?? 0
  c.intents = spec.intents
  c.pattern = spec.pattern
  c.dmgScale = dmgScale
  return c
}

export interface MxBattleInput {
  deck: MxDeckCardSpec[]
  enemies: MxEnemySpec[]
  relics?: MxRelicSpec[]
  playerHp: number
  playerMaxHp?: number
  energyPerTurn: number
  drawPerTurn: number
  maxTurns: number
  policy: MxPlayPolicy
  enemyHpScale?: number
  enemyDmgScale?: number
  /** 每回合出牌上限 */
  playLimit?: number
  /** 每打出一张牌受到的反制伤害 */
  playPunish?: number
  /** 炉石式法力水晶成长 */
  energyRamp?: { start: number; max: number }
  /** 手牌跨回合保留 */
  keepHand?: boolean
  /** 起手牌数 */
  openingHand?: number
  /** 起手调度费用上限 */
  mulliganMaxCost?: number
  /** 疲劳：牌库抽空不洗回，空抽递增扣血（炉石式） */
  fatigue?: boolean
}

export interface MxBattleTurnLog {
  turn: number
  cardsPlayed: string[]
  energyUsed: string
  damageDealt: number
  blockGained: number
  relicsTriggered: string[]
  enemyActions: string[]
  playerHpAfter: number
  enemyHpAfter: number
  /** 敌方回合结束后己方存活随从数 */
  boardAlive?: number
}

export interface MxSingleBattleResult {
  won: boolean
  turns: number
  hpLeft: number
  hpLoss: number
  stats: Map<string, MxCardRunStat>
  replay: MxBattleTurnLog[]
  /** 逐回合输出伤害 / 获得格挡 */
  turnDamage: number[]
  turnBlock: number[]
  energySpent: number
  energyAvailable: number
  shuffles: number
  /** 逐回合己方场面身材总和（攻+血，敌方回合前） */
  boardStatsByTurn: number[]
  /** 逐回合剩余未用能量 / 当回合可用能量 */
  energyLeftByTurn: number[]
  energyAvailByTurn: number[]
  /** 疲劳累计伤害 */
  fatigueDamage: number
}

/** 运行一场完整 PvE 战斗（供蒙特卡洛与单局经济闭环调用） */
export function runMxSingleBattle(
  input: MxBattleInput,
  rng: () => number,
  record = false
): MxSingleBattleResult {
  const uid = { v: 1 }
  const maxHp = Math.max(1, input.playerMaxHp ?? input.playerHp)
  const self = makeCombatant('player', 'Player', Math.max(1, input.playerHp), maxHp)
  const foes = input.enemies.map((e, i) =>
    makeEnemy(e, input.enemyHpScale ?? 1, input.enemyDmgScale ?? 1, i)
  )
  foes.forEach((f) => pickNextIntent(f, rng))
  const piles = buildPiles(input.deck, rng, uid)
  const s = newActorState(self, foes, piles.draw, input.deck, {
    energy: input.energyPerTurn,
    draw: input.drawPerTurn,
    relics: input.relics ?? [],
    rng,
    uid,
    record,
    playLimit: input.playLimit,
    playPunish: input.playPunish,
    energyRamp: input.energyRamp,
    keepHand: input.keepHand,
    openingHand: input.openingHand,
    mulliganMaxCost: input.mulliganMaxCost,
    fatigue: input.fatigue
  })
  const startHp = self.hp
  const replay: MxBattleTurnLog[] = []
  const turnDamage: number[] = []
  const turnBlock: number[] = []
  const boardStatsByTurn: number[] = []
  const energyLeftByTurn: number[] = []
  const energyAvailByTurn: number[] = []
  let turns = 0
  for (let t = 1; t <= Math.max(1, input.maxTurns); t++) {
    turns = t
    if (s.log) s.log.length = 0
    runActorTurn(s, input.policy)
    const played = s.log ? s.log.slice() : []
    const dmg = s.turnDamage
    const blk = s.turnBlock
    turnDamage.push(dmg)
    turnBlock.push(blk)
    boardStatsByTurn.push(self.board.reduce((a, m) => a + m.atk + Math.max(0, m.hp), 0))
    energyLeftByTurn.push(Math.max(0, s.turnEnergyAvail - s.turnEnergySpent))
    energyAvailByTurn.push(s.turnEnergyAvail)
    let actions: string[] = []
    if (self.alive && aliveFoes(s).length) actions = runEnemyPhase(s)
    if (record) {
      replay.push({
        turn: t,
        cardsPlayed: played,
        energyUsed: `${s.turnEnergySpent}/${s.turnEnergyAvail}`,
        damageDealt: dmg,
        blockGained: blk,
        relicsTriggered: s.relicLog.slice(),
        enemyActions: actions,
        playerHpAfter: self.hp,
        enemyHpAfter: foes.reduce((a, f) => a + Math.max(0, f.hp), 0),
        boardAlive: self.board.filter((m) => m.hp > 0).length
      })
    }
    if (!self.alive || !aliveFoes(s).length) break
  }
  const won = self.alive && !aliveFoes(s).length
  if (won) {
    for (const r of s.relics) {
      if (r.spec.trigger === 'combat_end') {
        for (const cl of r.fx.clauses) resolveClause(s, { ...cl, trigger: 'on_play' }, 0, null)
      }
    }
  }
  return {
    won,
    turns,
    hpLeft: self.hp,
    hpLoss: Math.max(0, startHp - self.hp),
    stats: s.stats!,
    replay,
    turnDamage,
    turnBlock,
    energySpent: s.energySpentTotal,
    energyAvailable: s.energyAvailTotal,
    shuffles: s.shuffles,
    boardStatsByTurn,
    energyLeftByTurn,
    energyAvailByTurn,
    fatigueDamage: s.fatigueDamage
  }
}

export interface MxEngineCardStatRow {
  cardId: string
  cardName: string
  playsPerBattle: number
  damagePerBattle: number
  blockPerBattle: number
  strandedPct: number
}

export interface MxBattleSimConfig extends MxBattleInput {
  runs: number
  seed: number
}

export interface MxBattleSimResult {
  policy: MxPlayPolicy
  runs: number
  winRatePct: number
  ttkP50: number
  ttkMean: number
  avgHpLoss: number
  hpLossP90: number
  cardStats: MxEngineCardStatRow[]
  replay: MxBattleTurnLog[]
}

function pctl(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]!
}

const r1 = (n: number): number => Math.round(n * 10) / 10

/** 蒙特卡洛战斗模拟（共同随机数：同一 seed 下不同策略/参数抽到相同牌序） */
export function runMxBattleEngineSimulation(cfg: MxBattleSimConfig): MxBattleSimResult {
  const runs = Math.max(1, Math.round(cfg.runs))
  let wins = 0
  const ttk: number[] = []
  const losses: number[] = []
  const agg = new Map<string, MxCardRunStat>()
  let replay: MxBattleTurnLog[] = []
  for (let r = 0; r < runs; r++) {
    const rng = createMxRng(cfg.seed + (r + 1) * 7919)
    const res = runMxSingleBattle(cfg, rng, r === 0)
    if (r === 0) replay = res.replay
    if (res.won) {
      wins++
      ttk.push(res.turns)
    }
    losses.push(res.hpLoss)
    for (const [id, x] of res.stats) {
      const a = agg.get(id) ?? { drawn: 0, played: 0, damage: 0, block: 0, stranded: 0 }
      a.drawn += x.drawn
      a.played += x.played
      a.damage += x.damage
      a.block += x.block
      a.stranded += x.stranded
      agg.set(id, a)
    }
  }
  ttk.sort((a, b) => a - b)
  losses.sort((a, b) => a - b)
  const nameOf = new Map(cfg.deck.map((c) => [c.id, c.name]))
  const cardStats: MxEngineCardStatRow[] = [...agg.entries()]
    .filter(([id]) => nameOf.has(id))
    .map(([id, a]) => ({
      cardId: id,
      cardName: nameOf.get(id) ?? id,
      playsPerBattle: r1(a.played / runs),
      damagePerBattle: r1(a.damage / runs),
      blockPerBattle: r1(a.block / runs),
      strandedPct: a.drawn > 0 ? r1((a.stranded / a.drawn) * 100) : 0
    }))
    .sort((a, b) => b.damagePerBattle + b.blockPerBattle - (a.damagePerBattle + a.blockPerBattle))
  return {
    policy: cfg.policy,
    runs,
    winRatePct: r1((wins / runs) * 100),
    ttkP50: pctl(ttk, 0.5),
    ttkMean: ttk.length ? r1(ttk.reduce((a, b) => a + b, 0) / ttk.length) : 0,
    avgHpLoss: r1(losses.reduce((a, b) => a + b, 0) / runs),
    hpLossP90: pctl(losses, 0.9),
    cardStats,
    replay
  }
}

export interface MxPolicySkillGapResult {
  random: MxBattleSimResult
  greedy: MxBattleSimResult
  search: MxBattleSimResult
  /** 搜索策略 vs 萌新乱出 的胜率差（百分点） */
  skillGapWinPct: number
  /** 萌新平均战损 / 搜索平均战损 */
  hpLossRatio: number
  verdict: 'high_skill_ceiling' | 'moderate_tactics' | 'flat_brainless'
}

/** 用三种出牌策略在同一组随机数下对比，量化真实的「操作上限」 */
export function measureMxPolicySkillGap(
  cfg: Omit<MxBattleSimConfig, 'policy'>
): MxPolicySkillGapResult {
  const random = runMxBattleEngineSimulation({ ...cfg, policy: 'random' })
  const greedy = runMxBattleEngineSimulation({ ...cfg, policy: 'greedy' })
  const search = runMxBattleEngineSimulation({ ...cfg, policy: 'search' })
  const skillGapWinPct = r1(search.winRatePct - random.winRatePct)
  const hpLossRatio = r1(random.avgHpLoss / Math.max(1, search.avgHpLoss))
  const verdict: MxPolicySkillGapResult['verdict'] =
    skillGapWinPct >= 15 || hpLossRatio >= 1.5
      ? 'high_skill_ceiling'
      : skillGapWinPct >= 5 || hpLossRatio >= 1.15
        ? 'moderate_tactics'
        : 'flat_brainless'
  return { random, greedy, search, skillGapWinPct, hpLossRatio, verdict }
}

// ───────────────────────────── 5. PvP 卡组对打 ─────────────────────────────

export interface MxDuelOptions {
  runs: number
  seed: number
  hp: number
  energyPerTurn: number
  drawPerTurn: number
  maxTurnsPerSide: number
  policy: MxPlayPolicy
  /** 炉石式法力水晶成长（start → max，每回合 +1） */
  energyRamp?: { start: number; max: number }
  /** 回合结束保留手牌 */
  keepHand?: boolean
  /** 起手张数（含调度） */
  openingHand?: number
  mulliganMaxCost?: number
  /** 疲劳（牌库抽空不洗回） */
  fatigue?: boolean
}

export interface MxDuelResult {
  winRateAPct: number
  drawRatePct: number
  avgTurns: number
}

function estimateDeckTurnOutput(deck: MxDeckCardSpec[], energy: number, draw: number): number {
  let dmg = 0
  let cards = 0
  for (const c of deck) {
    const fx = mxResolveCardEffects(c)
    const n = Math.max(1, c.count || 1)
    cards += n
    let d = 0
    for (const cl of fx.clauses) {
      if (cl.trigger === 'on_play' && cl.effect.op === 'damage') {
        d += cl.effect.amount * cl.effect.hits * (cl.scale === 'x' ? energy : 1)
      }
    }
    dmg += (d / Math.max(0.5, c.cost)) * n
  }
  const perEnergy = dmg / Math.max(1, cards)
  return Math.round(perEnergy * Math.min(energy, draw))
}

function makeDuelSide(
  deck: MxDeckCardSpec[],
  o: MxDuelOptions,
  rng: () => number,
  uid: { v: number },
  name: string
): MxActorState {
  const self = makeCombatant(name, name, o.hp)
  self.incomingEstimate = estimateDeckTurnOutput(deck, o.energyPerTurn, o.drawPerTurn)
  const piles = buildPiles(deck, rng, uid)
  const s = newActorState(self, [], piles.draw, deck, {
    energy: o.energyPerTurn,
    draw: o.drawPerTurn,
    relics: [],
    rng,
    uid,
    record: false,
    energyRamp: o.energyRamp,
    keepHand: o.keepHand,
    openingHand: o.openingHand,
    mulliganMaxCost: o.mulliganMaxCost,
    fatigue: o.fatigue
  })
  s.stats = null
  return s
}

/** 两套卡组真实对打（交替先手，格挡保留到己方下回合开始） */
export function runMxDeckDuel(
  deckA: MxDeckCardSpec[],
  deckB: MxDeckCardSpec[],
  o: MxDuelOptions
): MxDuelResult {
  const runs = Math.max(2, Math.round(o.runs))
  let winA = 0
  let draws = 0
  let turnSum = 0
  for (let r = 0; r < runs; r++) {
    const rng = createMxRng(o.seed + (r + 1) * 7919)
    const uid = { v: 1 }
    const A = makeDuelSide(deckA, o, rng, uid, 'A')
    const B = makeDuelSide(deckB, o, rng, uid, 'B')
    A.foes = [B.self]
    B.foes = [A.self]
    const order = r % 2 === 0 ? [A, B] : [B, A]
    let t = 0
    let finished = false
    for (; t < o.maxTurnsPerSide * 2; t++) {
      const actor = order[t % 2]!
      runActorTurn(actor, o.policy)
      if (!A.self.alive || !B.self.alive) {
        finished = true
        break
      }
    }
    turnSum += Math.ceil((t + 1) / 2)
    if (finished && A.self.alive && !B.self.alive) winA++
    else if (!finished) draws++
  }
  return {
    winRateAPct: r1(((winA + draws * 0.5) / runs) * 100),
    drawRatePct: r1((draws / runs) * 100),
    avgTurns: r1(turnSum / runs)
  }
}

export interface MxDeckVsDeckMatrixResult {
  decks: Array<{ id: string; name: string }>
  /** W[i][j]：第 i 套卡组对第 j 套卡组的胜率（%） */
  matrix: number[][]
  nashSharesPct: number[]
  runsPerPair: number
}

/** 构建 N×N 卡组对打胜率矩阵，并以复制动态（Replicator Dynamics）求天梯均衡占比 */
export function simulateMxDeckVsDeckMatrix(
  decks: Array<{ id: string; name: string; cards: MxDeckCardSpec[] }>,
  o: MxDuelOptions
): MxDeckVsDeckMatrixResult {
  const n = decks.length
  const W: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 50))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const res = runMxDeckDuel(decks[i]!.cards, decks[j]!.cards, {
        ...o,
        seed: o.seed + i * 131 + j * 17
      })
      W[i]![j] = res.winRateAPct
      W[j]![i] = r1(100 - res.winRateAPct)
    }
  }
  let shares = Array.from({ length: n }, () => 1 / Math.max(1, n))
  for (let g = 0; g < 200; g++) {
    const fit = shares.map((_, i) => shares.reduce((a, sj, j) => a + (W[i]![j]! / 100) * sj, 0))
    const avg = fit.reduce((a, f, i) => a + f * shares[i]!, 0)
    const next = shares.map((sh, i) => Math.max(1e-4, sh * (1 + 1.5 * (fit[i]! - avg))))
    const sum = next.reduce((a, b) => a + b, 0)
    shares = next.map((x) => x / sum)
  }
  return {
    decks: decks.map((d) => ({ id: d.id, name: d.name })),
    matrix: W,
    nashSharesPct: shares.map((x) => r1(x * 100)),
    runsPerPair: Math.max(2, Math.round(o.runs))
  }
}

/** 卡牌升级：基础字段 +35%（至少 +3）；脚本卡把 dmg/blk 数值 ×1.3 向上取整 */
export function mxUpgradeCardSpec(card: MxDeckCardSpec): MxDeckCardSpec {
  if (card.name.trim().endsWith('+')) return card
  const up: MxDeckCardSpec = { ...card, name: `${card.name.trim()}+` }
  if (card.effectScript?.trim()) {
    up.effectScript = card.effectScript.replace(
      /\b(dmg|damage|blk|block)\s+(\d+)/gi,
      (_m, op: string, num: string) => `${op} ${Math.ceil(Number(num) * 1.3)}`
    )
  } else {
    if (up.damage > 0) up.damage += Math.max(3, Math.round(up.damage * 0.35))
    if (up.block > 0) up.block += Math.max(3, Math.round(up.block * 0.35))
  }
  return up
}

/**
 * 按系数整体缩放卡牌「数值强度」（用于数值重配平求解）：
 * 脚本卡缩放 dmg/blk/poison/heal(正值)/summon 的数值；基础字段卡缩放伤害/格挡/中毒/治疗。
 */
export function mxScaleCardSpec(card: MxDeckCardSpec, k: number): MxDeckCardSpec {
  const sc = (n: number): number => Math.max(1, Math.round(n * k))
  const out: MxDeckCardSpec = { ...card }
  if (card.effectScript?.trim()) {
    out.effectScript = mxScaleEffectScript(card.effectScript, k)
  } else {
    if (out.damage > 0) out.damage = sc(out.damage)
    if (out.block > 0) out.block = sc(out.block)
    if ((out.poison ?? 0) > 0) out.poison = sc(out.poison ?? 0)
    if ((out.heal ?? 0) > 0) out.heal = sc(out.heal ?? 0)
  }
  return out
}

/** 按系数缩放效果脚本中的 dmg/blk/poison/heal 数值与 summon 攻/血 */
export function mxScaleEffectScript(script: string, k: number): string {
  const sc = (n: number): number => Math.max(1, Math.round(n * k))
  return script
    .replace(
      /\b(dmg|damage|atk|blk|block|armor|poison|heal)\s+(\d+(?:\.\d+)?)/gi,
      (_m, op: string, num: string) => `${op} ${sc(Number(num))}`
    )
    .replace(
      /\b(summon|buff|buff_board)\s+(\d+)\s*\/\s*(\d+)/gi,
      (_m, op: string, a: string, h: string) =>
        `${op} ${Math.max(0, Math.round(Number(a) * k))}/${Number(h) > 0 ? sc(Number(h)) : 0}`
    )
}
