/**
 * 速度行动条（ATB，《阴阳师》/《崩坏：星穹铁道》式）效果引擎：
 * - 双方单位都有真实血量/防御/速度，敌方同样会出手，单位可阵亡（旧内核中敌方只占行动次序、不造成伤害）
 * - 技能/普攻用一套小型脚本描述：伤害倍率、治疗、护盾、拉条、推条、回火、加速、加攻、眩晕
 * - 双方各自的共享鬼火池 + 每 5 次行动回火（与旧内核一致）
 * 由 action_bar 内核在任一单位填写 skillScript（或显式开启 useEffectEngine）时调用。
 */
import { createMxRng } from './machinationsV2'
import type {
  MxActionBarTurnEvent,
  MxActionBarUnitSpec,
  MxCombatKernelConfig,
  MxCombatKernelResult,
  MxTurnMetricPoint
} from './gameNumericalWorkbench'

// ───────────────────────────── 1. 脚本 ─────────────────────────────

export type MxAtbTarget = 'single' | 'all' | 'random' | 'lowest' | 'self' | 'allies' | 'ally_lowest'

export type MxAtbOp =
  | { op: 'dmg'; ratio: number; hits: number; target: MxAtbTarget }
  | { op: 'heal'; pct: number; target: MxAtbTarget }
  | { op: 'shield'; pct: number; target: MxAtbTarget }
  | { op: 'pull'; pct: number; target: MxAtbTarget }
  | { op: 'push'; pct: number; target: MxAtbTarget }
  | { op: 'orb'; n: number }
  | { op: 'spd'; pct: number; target: MxAtbTarget }
  | { op: 'atk'; pct: number; target: MxAtbTarget }
  | { op: 'stun'; chance: number; target: MxAtbTarget }

export interface MxAtbParsed {
  ops: MxAtbOp[]
  errors: string[]
}

const ATB_OP_ALIASES: Record<string, MxAtbOp['op']> = {
  dmg: 'dmg',
  damage: 'dmg',
  伤害: 'dmg', // cjk-ok
  heal: 'heal',
  治疗: 'heal', // cjk-ok
  shield: 'shield',
  护盾: 'shield', // cjk-ok
  pull: 'pull',
  拉条: 'pull', // cjk-ok
  push: 'push',
  推条: 'push', // cjk-ok
  orb: 'orb',
  鬼火: 'orb', // cjk-ok
  spd: 'spd',
  加速: 'spd', // cjk-ok
  atk: 'atk',
  加攻: 'atk', // cjk-ok
  stun: 'stun',
  眩晕: 'stun' // cjk-ok
}

const ATB_TARGET_ALIASES: Record<string, MxAtbTarget> = {
  '@all': 'all',
  '@random': 'random',
  '@lowest': 'lowest',
  '@self': 'self',
  '@allies': 'allies',
  '@ally_lowest': 'ally_lowest',
  '@single': 'single'
}

/** 默认目标：伤害/推条/眩晕打敌方单体；治疗/护盾给己方最低血；拉条/加速/加攻给己方全体（拉条不含自己） */
function defaultTarget(op: MxAtbOp['op']): MxAtbTarget {
  if (op === 'heal' || op === 'shield') return 'ally_lowest'
  if (op === 'pull' || op === 'spd' || op === 'atk') return 'allies'
  return 'single'
}

/**
 * 解析 ATB 技能脚本，语句以 ; 分隔：
 * `dmg 3.15x2 @all` 伤害倍率×段数 / `heal 15%` / `shield 20% @allies` / `pull 30` / `push 20 @all`
 * / `orb 3` / `spd 20` / `atk 25 @self` / `stun 35%`
 */
export function parseMxAtbScript(script: string): MxAtbParsed {
  const ops: MxAtbOp[] = []
  const errors: string[] = []
  for (const raw of (script ?? '').split(/[;；]/)) {
    const s = raw.trim()
    if (!s) continue
    const toks = s.split(/\s+/)
    const op = ATB_OP_ALIASES[toks[0]!.toLowerCase()] ?? ATB_OP_ALIASES[toks[0]!]
    if (!op) {
      errors.push(`unknown op "${toks[0]}" in "${s}"`)
      continue
    }
    const numTok = toks[1] ?? ''
    const m = /^(-?\d+(?:\.\d+)?)%?(?:x(\d+))?$/i.exec(numTok)
    if (!m) {
      errors.push(`"${op}" needs a number in "${s}"`)
      continue
    }
    const n = Number(m[1])
    const hits = Math.max(1, Number(m[2] ?? 1))
    const tTok = toks.slice(2).find((t) => t.startsWith('@'))
    const target = (tTok && ATB_TARGET_ALIASES[tTok.toLowerCase()]) || defaultTarget(op)
    if (op === 'dmg') ops.push({ op, ratio: n, hits, target })
    else if (op === 'orb') ops.push({ op, n: Math.round(n) })
    else if (op === 'stun') ops.push({ op, chance: Math.max(0, Math.min(100, n)), target })
    else ops.push({ op, pct: n, target } as MxAtbOp)
  }
  return { ops, errors }
}

export function formatMxAtbSummary(p: MxAtbParsed): string {
  return p.ops
    .map((o) => {
      if (o.op === 'dmg') return `DMG ${o.ratio}x${o.hits > 1 ? `×${o.hits}` : ''} ${o.target}`
      if (o.op === 'orb') return `+${o.n} Orb`
      if (o.op === 'stun') return `Stun ${o.chance}% ${o.target}`
      return `${o.op.toUpperCase()} ${o.pct}% ${o.target}`
    })
    .join(' · ')
}

/** 由旧内核字段生成技能脚本（倍率 + 拉条 + 推条） */
export function mxAtbLegacySkillScript(u: MxActionBarUnitSpec): string {
  const parts: string[] = []
  if (u.skillRatio > 0) parts.push(`dmg ${u.skillRatio}`)
  if (u.pullGaugePct > 0) parts.push(`pull ${u.pullGaugePct}`)
  if (u.pushGaugePct > 0) parts.push(`push ${u.pushGaugePct} @all`)
  return parts.join('; ')
}

/** 按系数缩放 ATB 脚本中的 dmg 倍率与 heal/shield 百分比（用于敏感度龙卷风） */
export function mxScaleAtbScript(script: string, k: number): string {
  return script.replace(
    /\b(dmg|damage|heal|shield)\s+(-?\d+(?:\.\d+)?)(%?)/gi,
    (_m, op: string, num: string, pct: string) =>
      `${op} ${Math.round(Number(num) * k * 100) / 100}${pct}`
  )
}

// ───────────────────────────── 2. 战斗 ─────────────────────────────

interface AtbUnit {
  spec: MxActionBarUnitSpec
  team: 'ally' | 'enemy'
  hp: number
  maxHp: number
  def: number
  shield: number
  gauge: number
  alive: boolean
  stunned: boolean
  spdBuff: { pct: number; left: number }
  atkBuff: { pct: number; left: number }
  skill: MxAtbParsed
  basic: MxAtbParsed
  dmgDealt: number
  actions: number
  skillCasts: number
}

export interface MxAtbBattleInput {
  units: MxActionBarUnitSpec[]
  trackDistance: number
  maxActions: number
  initialOrbs: number
  maxOrbs: number
  orbRecoveryPer5Actions: number
  /** 未填写血量/防御时的默认值 */
  defaultAllyHp: number
  defaultAllyDef: number
  defaultEnemyHp: number
  defaultEnemyDef: number
}

export interface MxAtbBattleResult {
  won: boolean
  /** 结束时的行动序号（未分胜负 = maxActions） */
  actions: number
  allyDeaths: number
  orbChecks: number
  orbStarved: number
  /** 逐行动己方累计伤害 */
  cumAllyDmgByAction: number[]
  timeline: MxActionBarTurnEvent[]
  unitStats: Array<{
    id: string
    name: string
    team: 'ally' | 'enemy'
    actions: number
    skillCasts: number
    dmg: number
    alive: boolean
  }>
}

function mkUnit(spec: MxActionBarUnitSpec, inp: MxAtbBattleInput): AtbUnit {
  const ally = spec.team === 'ally'
  const hp = Math.max(1, spec.hp ?? (ally ? inp.defaultAllyHp : inp.defaultEnemyHp))
  const skillSrc = spec.skillScript?.trim() ? spec.skillScript : mxAtbLegacySkillScript(spec)
  const basicSrc = spec.basicScript?.trim()
    ? spec.basicScript
    : `dmg ${Math.max(0, Math.min(1, spec.skillRatio || 1))}`
  return {
    spec,
    team: spec.team,
    hp,
    maxHp: hp,
    def: Math.max(0, spec.def ?? (ally ? inp.defaultAllyDef : inp.defaultEnemyDef)),
    shield: 0,
    gauge: 0,
    alive: true,
    stunned: false,
    spdBuff: { pct: 0, left: 0 },
    atkBuff: { pct: 0, left: 0 },
    skill: parseMxAtbScript(skillSrc),
    basic: parseMxAtbScript(basicSrc),
    dmgDealt: 0,
    actions: 0,
    skillCasts: 0
  }
}

const speedOf = (u: AtbUnit): number =>
  Math.max(1, u.spec.speed * (1 + (u.spdBuff.left > 0 ? u.spdBuff.pct : 0) / 100))

/** 运行一场完整 ATB 战斗 */
export function runMxAtbBattle(
  inp: MxAtbBattleInput,
  rng: () => number,
  record = false
): MxAtbBattleResult {
  const track = Math.max(100, inp.trackDistance)
  const maxOrbs = Math.max(1, inp.maxOrbs)
  const units = inp.units.map((u) => mkUnit(u, inp))
  const orbs = {
    ally: Math.min(maxOrbs, Math.max(0, inp.initialOrbs)),
    enemy: Math.min(maxOrbs, Math.max(0, inp.initialOrbs))
  }
  const teamActions = { ally: 0, enemy: 0 }
  const barStage = { ally: 0, enemy: 0 }
  let orbChecks = 0
  let orbStarved = 0
  let cum = 0
  const cumAllyDmgByAction: number[] = []
  const timeline: MxActionBarTurnEvent[] = []
  const aliveOf = (team: 'ally' | 'enemy'): AtbUnit[] =>
    units.filter((u) => u.alive && u.team === team)
  let step = 0
  let won = false

  const pickTargets = (actor: AtbUnit, t: MxAtbTarget): AtbUnit[] => {
    const foes = aliveOf(actor.team === 'ally' ? 'enemy' : 'ally')
    const mates = aliveOf(actor.team)
    switch (t) {
      case 'all':
        return foes
      case 'random':
        return foes.length ? [foes[Math.floor(rng() * foes.length)]!] : []
      case 'lowest':
        return foes.length ? [foes.reduce((a, b) => (a.hp <= b.hp ? a : b))] : []
      case 'self':
        return [actor]
      case 'allies':
        return mates
      case 'ally_lowest':
        return mates.length
          ? [mates.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b))]
          : []
      default:
        // 单体：敌方当前血量最低者（集火）
        return foes.length
          ? [foes.reduce((a, b) => (a.hp + a.shield <= b.hp + b.shield ? a : b))]
          : []
    }
  }

  const hit = (actor: AtbUnit, target: AtbUnit, ratio: number): number => {
    const atk = actor.spec.attack * (1 + (actor.atkBuff.left > 0 ? actor.atkBuff.pct : 0) / 100)
    const mitig = 300 / (300 + target.def)
    let dmg = Math.round(
      atk * ratio * Math.max(1, actor.spec.critDamageMult || 1) * mitig * (0.96 + rng() * 0.08)
    )
    const absorbed = Math.min(target.shield, dmg)
    target.shield -= absorbed
    dmg -= absorbed
    const dealt = Math.min(target.hp, dmg)
    target.hp -= dmg
    if (target.hp <= 0) {
      target.hp = 0
      target.alive = false
    }
    return dealt + absorbed
  }

  const resolve = (actor: AtbUnit, p: MxAtbParsed): number => {
    let dealt = 0
    let pulled = 0
    for (const o of p.ops) {
      if (o.op === 'orb') {
        orbs[actor.team] = Math.min(maxOrbs, orbs[actor.team] + o.n)
        continue
      }
      const ts = pickTargets(actor, o.target)
      for (const t of ts) {
        if (o.op === 'dmg') {
          for (let h = 0; h < o.hits && t.alive; h++) dealt += hit(actor, t, o.ratio)
        } else if (o.op === 'heal') {
          t.hp = Math.min(t.maxHp, t.hp + Math.round((t.maxHp * o.pct) / 100))
        } else if (o.op === 'shield') {
          t.shield += Math.round((actor.maxHp * o.pct) / 100)
        } else if (o.op === 'pull') {
          if (t === actor && o.target === 'allies') continue
          t.gauge = Math.min(track, t.gauge + (o.pct / 100) * track)
          pulled = Math.max(pulled, o.pct)
        } else if (o.op === 'push') {
          t.gauge = Math.max(0, t.gauge - (o.pct / 100) * track)
        } else if (o.op === 'spd') {
          t.spdBuff = { pct: o.pct, left: 2 }
        } else if (o.op === 'atk') {
          t.atkBuff = { pct: o.pct, left: 2 }
        } else if (o.op === 'stun') {
          if (rng() * 100 < o.chance) t.stunned = true
        }
      }
    }
    lastPulled = pulled
    return dealt
  }
  let lastPulled = 0

  /** 简单 AI：治疗型技能仅在有队友血量 < 70% 时使用；鬼火够则放技能，否则普攻 */
  const wantsSkill = (u: AtbUnit): boolean => {
    if (!u.skill.ops.length) return false
    const pureSupport = u.skill.ops.every((o) => o.op === 'heal' || o.op === 'shield')
    if (pureSupport) return aliveOf(u.team).some((m) => m.hp / m.maxHp < 0.7)
    return true
  }

  while (step < inp.maxActions) {
    const live = units.filter((u) => u.alive)
    if (!aliveOf('enemy').length) {
      won = true
      break
    }
    if (!aliveOf('ally').length) break
    let next = live[0]!
    let minDt = Number.POSITIVE_INFINITY
    for (const u of live) {
      const dt = Math.max(0, track - u.gauge) / speedOf(u)
      if (dt < minDt) {
        minDt = dt
        next = u
      }
    }
    for (const u of live) u.gauge = Math.min(track, u.gauge + speedOf(u) * minDt)
    next.gauge = 0
    step++
    next.actions++
    teamActions[next.team]++
    const orbsBefore = orbs[next.team]
    let skillCast = false
    let starved = false
    let dealt = 0
    lastPulled = 0
    if (next.stunned) {
      next.stunned = false
    } else {
      if ((next.spec.orbGain ?? 0) > 0)
        orbs[next.team] = Math.min(maxOrbs, orbs[next.team] + next.spec.orbGain)
      const cost = Math.max(0, next.spec.orbCost || 0)
      if (wantsSkill(next)) {
        if (cost > 0 && next.team === 'ally') orbChecks++
        if (orbs[next.team] >= cost) {
          orbs[next.team] -= cost
          skillCast = true
        } else {
          starved = true
          if (next.team === 'ally') orbStarved++
        }
      }
      dealt = resolve(next, skillCast ? next.skill : next.basic)
      if (skillCast) next.skillCasts++
      next.dmgDealt += dealt
    }
    if (next.spdBuff.left > 0) next.spdBuff.left--
    if (next.atkBuff.left > 0) next.atkBuff.left--
    if (teamActions[next.team] % 5 === 0) {
      const amt = Math.min(5, Math.max(0, inp.orbRecoveryPer5Actions) + barStage[next.team])
      orbs[next.team] = Math.min(maxOrbs, orbs[next.team] + amt)
      barStage[next.team] = Math.min(2, barStage[next.team] + 1)
    }
    if (next.team === 'ally') cum += dealt
    cumAllyDmgByAction.push(cum)
    if (record && timeline.length < 14) {
      timeline.push({
        actionIndex: step,
        unitName: next.spec.name,
        team: next.team,
        speed: Math.round(speedOf(next)),
        orbsBefore,
        orbsAfter: orbs[next.team],
        skillCast,
        starvedOrb: starved,
        damageDealt: dealt,
        pulledGaugePct: lastPulled
      })
    }
  }
  if (!won && !aliveOf('enemy').length) won = true
  return {
    won,
    actions: step,
    allyDeaths: units.filter((u) => u.team === 'ally' && !u.alive).length,
    orbChecks,
    orbStarved,
    cumAllyDmgByAction,
    timeline,
    unitStats: units.map((u) => ({
      id: u.spec.id,
      name: u.spec.name,
      team: u.team,
      actions: u.actions,
      skillCasts: u.skillCasts,
      dmg: u.dmgDealt,
      alive: u.alive
    }))
  }
}

// ───────────────────────────── 3. action_bar 内核桥接 ─────────────────────────────

export function mxShouldUseAtbEngine(cfg: MxCombatKernelConfig): boolean {
  return (
    Boolean(cfg.useEffectEngine) ||
    (cfg.actionUnits ?? []).some((u) => Boolean(u.skillScript?.trim()))
  )
}

const pctl = (sorted: number[], p: number): number =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))]!
    : 0
const r1 = (n: number): number => Math.round(n * 10) / 10

/**
 * 以 ATB 效果引擎运行 action_bar 内核：返回与旧内核相同的结构
 * （胜率 / 击杀行动序号 TTK / 不断火率 / 二速安全线 / 累计爆发伤害 / 排轴时间线）。
 * 未填写血量的敌方单位平分「目标敌人血量」，未填写防御的敌方使用「目标敌人防御」。
 */
export function runMxActionBarKernelViaAtbEngine(cfg: MxCombatKernelConfig): MxCombatKernelResult {
  const runs = Math.max(10, Math.min(2000, Math.round(cfg.runs || 200)))
  const maxActions = Math.max(3, Math.min(200, Math.round(cfg.maxTurns || 12)))
  const units = cfg.actionUnits ?? []
  const enemyCount = Math.max(1, units.filter((u) => u.team === 'enemy').length)
  const inp: MxAtbBattleInput = {
    units,
    trackDistance: cfg.trackDistance || 1000,
    maxActions,
    initialOrbs: cfg.initialOrbs ?? 4,
    maxOrbs: Math.max(1, Math.min(12, Math.round(cfg.maxOrbs || 8))),
    orbRecoveryPer5Actions: cfg.orbRecoveryPer5Actions || 3,
    defaultAllyHp: 12000,
    defaultAllyDef: 400,
    defaultEnemyHp: Math.max(1, Math.round((cfg.targetEnemyHp || 65000) / enemyCount)),
    defaultEnemyDef: Math.max(0, cfg.targetEnemyDef ?? 450)
  }
  const ttk: number[] = []
  const cumByStep: number[][] = Array.from({ length: maxActions }, () => [])
  let wins = 0
  let checks = 0
  let starved = 0
  let deaths = 0
  let timeline: MxActionBarTurnEvent[] = []
  for (let r = 0; r < runs; r++) {
    const res = runMxAtbBattle(inp, createMxRng((cfg.seed || 2026) + (r + 1) * 7919), r === 0)
    if (res.won) wins++
    ttk.push(res.won ? res.actions : maxActions + 1)
    checks += res.orbChecks
    starved += res.orbStarved
    deaths += res.allyDeaths
    for (let i = 0; i < maxActions; i++) {
      cumByStep[i]!.push(
        res.cumAllyDmgByAction[Math.min(i, res.cumAllyDmgByAction.length - 1)] ?? 0
      )
    }
    if (r === 0) timeline = res.timeline
  }
  const sortedTtk = [...ttk].sort((a, b) => a - b)
  const pullers = units
    .filter((u) => u.team === 'ally' && u.pullGaugePct > 0)
    .sort((a, b) => b.speed - a.speed)
  const top = pullers[0]
  const safe2nd = top ? Math.ceil(top.speed * Math.max(0.1, 1 - top.pullGaugePct / 100)) : 0
  const firstEnemyIdx = timeline.findIndex((e) => e.team === 'enemy')
  const allyCount = units.filter((u) => u.team === 'ally').length
  const cutIn = firstEnemyIdx >= 0 && firstEnemyIdx < allyCount
  const finalCum = cumByStep[maxActions - 1] ?? []
  const turnSeries: MxTurnMetricPoint[] = Array.from({ length: maxActions }, (_, i) => {
    const d = [...cumByStep[i]!].sort((a, b) => a - b)
    const kill = r1((ttk.filter((t) => t <= i + 1).length / runs) * 100)
    return {
      turn: i + 1,
      primaryP10: pctl(d, 0.1),
      primaryP50: pctl(d, 0.5),
      primaryP90: pctl(d, 0.9),
      secondaryMean: kill,
      ratePct: kill
    }
  })
  const avgDeaths = r1(deaths / runs)
  return {
    kernel: 'action_bar',
    runs,
    winRatePct: r1((wins / runs) * 100),
    ttkP10: pctl(sortedTtk, 0.1),
    ttkP50: pctl(sortedTtk, 0.5),
    ttkP90: pctl(sortedTtk, 0.9),
    ttkMean: r1(ttk.reduce((a, b) => a + b, 0) / runs),
    kpi1Label: 'Orb Sufficiency %',
    kpi1Value: checks > 0 ? r1(((checks - starved) / checks) * 100) : 100,
    kpi2Label: 'Safe 2nd SPD >=',
    kpi2Value: safe2nd,
    kpi3Label: 'Cycle Burst DMG',
    kpi3Value: finalCum.length
      ? Math.round(finalCum.reduce((a, b) => a + b, 0) / finalCum.length)
      : 0,
    turnSeries,
    actionTimeline: timeline,
    speedTuneAdvisory:
      `${cutIn ? `Cut-in: enemy acted at #${firstEnemyIdx + 1}` : 'Speed lock OK'}` +
      `${top ? `; safe 2nd SPD >= ${safe2nd}` : ''}; avg ally deaths ${avgDeaths}/${allyCount} (ATB engine, enemies fight back)`
  }
}
