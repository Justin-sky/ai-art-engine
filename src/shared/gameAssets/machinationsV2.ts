/**
 * Machinations v2 引擎（游戏经济系统动力学，完整复刻 Machinations.io 的核心语义）。
 *
 * 与 v1（machinationsEconomyEngine.ts）的区别：
 * - 文档模型 `MxDocument`（schema `mx@2`）：多资源类型、全局参数、场景（Scenarios）、图层、片段（Clips）、历史快照；
 * - 图元：Source / Drain / Pool / Gate / Trader / Converter / Register / Delay / Queue / End Condition / Note；
 * - 触发：Passive / Automatic / Interactive / Enabling；拉取/推送模式：pull any / pull all / push any / push all；
 * - 资源连线公式：常数、`all`、骰子 `2D6+1`、概率 `50%`、间隔 `3 every 2`、四则表达式（可引用参数 / 节点值 / step）；
 * - 状态连线：修改量 `+2` / `-0.5` / `+10%`、激活条件 `>5` `<=3` `==0` `!=1` `2..8`、触发器 `*`、反向触发 `!`；
 * - 运行：逐步快照（进度条回看）、事件日志（Runtime Debugger）、批量预测（Forecast，P10/P50/P90）、趋势摘要。
 *
 * 纯函数、无 DOM 依赖：主进程执行器、渲染进程工作台与单元测试共用。
 */
import {
  createMachinationsPresetDiagram,
  type MachinationsDiagram,
  type MachinationsPresetId
} from './machinationsEconomyEngine'
import {
  createMxWorkbenchPreset,
  mapMxTemplateToWorkbenchPreset,
  normalizeMxNumericalWorkbench,
  synthesizeMxWorkbenchFromPrompt,
  type MxNumericalWorkbench,
  type MxWorkbenchPresetId
} from './gameNumericalWorkbench'

// ───────────────────────────── 数据模型 ─────────────────────────────

export type MxNodeKind =
  | 'source'
  | 'drain'
  | 'pool'
  | 'gate'
  | 'trader'
  | 'converter'
  | 'register'
  | 'delay'
  | 'queue'
  | 'end'
  | 'note'

export type MxTrigger = 'passive' | 'automatic' | 'interactive' | 'enabling'
export type MxPullMode = 'pull_any' | 'pull_all' | 'push_any' | 'push_all'
export type MxEdgeKind = 'resource' | 'state'

export interface MxResource {
  id: string
  name: string
  color: string
}

export interface MxParam {
  id: string
  /** 公式里引用的标识符（字母 / 数字 / 下划线） */
  name: string
  value: number
  min?: number
  max?: number
  notes?: string
}

export interface MxScenario {
  id: string
  name: string
  /** 参数名 → 覆盖值 */
  params: Record<string, number>
}

export interface MxLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

export interface MxNode {
  id: string
  kind: MxNodeKind
  label: string
  notes?: string
  x: number
  y: number
  trigger: MxTrigger
  pullMode?: MxPullMode
  /** 资源类型（Pool 存储 / Source 产出 / Converter 输出） */
  resourceId?: string
  /** Pool 初始值 / Interactive Register 初始值 */
  initial?: number
  /** Pool 容量（<=0 或缺省为无限） */
  capacity?: number
  /** Pool 容量溢出处理：block（默认，阻塞上游）或 drain（接收并销毁溢出部分） */
  overflow?: 'block' | 'drain'
  /** Register 公式 / End 条件公式 / Delay 延迟步数公式 */
  formula?: string
  /** Register 交互模式下的最小/最大与步进值 */
  min?: number
  max?: number
  step?: number
  gateMode?: 'random' | 'deterministic' | 'dice'
  conversion?: 'single' | 'multiple'
  /** Delay / Queue 的等待步数 */
  delaySteps?: number
  ignoreDisabledInputs?: boolean
  showAs?: 'number' | 'tokens' | 'both'
  color?: string
  layerId?: string
  /** Note 便签文本 */
  text?: string
  width?: number
  height?: number
  /** 是否在结果面板中追踪曲线（Pool / Register 默认追踪） */
  tracked?: boolean
  /** Interactive 节点的 AI 自动代理策略（用于模拟玩家自动购买/升级/决策） */
  botPolicy?: 'inherit' | 'off' | 'greedy' | 'probabilistic' | 'condition'
  /** 当 botPolicy === 'probabilistic' 时每步触发概率（0~100） */
  botProbability?: number
  /** 当 botPolicy === 'condition' 或全局 smart 模式下触发的条件表达式（如 HP <= 40） */
  botCondition?: string
}

export interface MxEdge {
  id: string
  kind: MxEdgeKind
  from: string
  to: string
  /** 状态连线可直接指向另一条连线（Machinations 边速率修正器 / 边激活器） */
  targetEdgeId?: string
  /** 手动弧度控制量（正负像素偏移） */
  bend?: number
  /** 资源连线：流量公式；状态连线：修改量 / 激活条件 / 触发器 */
  formula: string
  label?: string
  resourceId?: string
  color?: string
  layerId?: string
}

export interface MxClip {
  id: string
  name: string
  nodes: MxNode[]
  edges: MxEdge[]
}

export interface MxGroup {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  layerId?: string
}

export interface MxSnapshot {
  id: string
  name: string
  createdAt: string
  json: string
}

export type MxAgentImportance = 'min' | 'low' | 'med' | 'high' | 'max'
export type MxAgentTrajectory = 'upwards' | 'downwards'
export type MxAgentPersonality = 'rational' | 'aggressive' | 'hoarder' | 'balanced' | 'chaotic'
export type MxAgentUtilityCurve = 'linear' | 'diminishing' | 'urgency' | 'step'

export interface MxAgentGoalAsset {
  id: string
  /** 绑定的画布节点 ID（Pool 或 Register） */
  nodeId: string
  /** 目标数值或公式（例如 "100" 或 "100 * level"） */
  targetFormula: string
  /** 重要度滑杆（Min / Low / Med / High / Max） */
  importance: MxAgentImportance
  /** 达到目标值后是否继续累积获取正向效用 */
  continuePastTarget: boolean
  /** 期望趋势方向：Upwards（越多越好）或 Downwards（越少越好） */
  trajectory: MxAgentTrajectory
  /** 效用响应曲线：linear=线性，diminishing=边际递减，urgency=危机指数放大，step=达标阶跃 */
  utilityCurve?: MxAgentUtilityCurve
}

export interface MxAgent {
  id: string
  name: string
  color?: string
  enabled: boolean
  /** 第 1 步：性格与决策偏好 */
  personality: MxAgentPersonality
  description?: string
  /** 第 2 步：目标资产与效用函数列表 */
  goals: MxAgentGoalAsset[]
  /** 第 3 步：接管控制的 Interactive 节点 ID 列表（为空则接管全部未分配的 Interactive 节点） */
  controlledNodeIds: string[]
  /** 每步最多可触发的交互动作次数（默认 1，支持回合内序贯连招） */
  actionsPerStep?: number
  /** 前瞻试算步数视野（1 ~ 5 步，默认 2） */
  lookaheadHorizon?: number
  /** 远期收益贴现率 γ（0.1 ~ 0.99，默认 0.7） */
  discount?: number
  /** 是否开启反向拓扑势能引导（解决超过前瞻步数的多级合成链死锁，默认 true） */
  shapingEnabled?: boolean
}

export interface MxSettings {
  steps: number
  runs: number
  seed: number
  speed: number
  actionMode?: 'simultaneous' | 'turn_based'
  /** 全局玩家 AI 代理模式：off=仅手动点击，greedy=可触发即自动执行，smart=按条件/概率智能执行 */
  botMode?: 'off' | 'greedy' | 'smart'
}

export interface MxDocument {
  schema: 'mx@2'
  title: string
  description?: string
  templateId?: string
  resources: MxResource[]
  params: MxParam[]
  scenarios: MxScenario[]
  activeScenarioId?: string
  layers: MxLayer[]
  nodes: MxNode[]
  edges: MxEdge[]
  groups?: MxGroup[]
  agents?: MxAgent[]
  clips: MxClip[]
  history: MxSnapshot[]
  settings: MxSettings
  /** 通用游戏数值与肉鸽/卡牌/回合制微观仿真工作台配置 */
  workbench?: MxNumericalWorkbench
}

// ───────────────────────────── 随机数 ─────────────────────────────

export function createMxRng(seed: number): () => number {
  let t = (Math.floor(seed) >>> 0) + 0x6d2b79f5
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ───────────────────────────── 表达式解析 ─────────────────────────────

type ExprNode =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string }
  | { t: 'dice'; count: number; sides: number }
  | { t: 'un'; op: '-' | '+'; a: ExprNode }
  | { t: 'bin'; op: string; a: ExprNode; b: ExprNode }
  | { t: 'call'; fn: string; args: ExprNode[] }

export interface MxExprContext {
  vars: Record<string, number>
  rng: () => number
}

const exprCache = new Map<string, ExprNode | null>()

function tokenizeExpr(src: string): string[] | null {
  const tokens: string[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // dice: 2D6 / D20
    const diceMatch = /^(\d*)[dD](\d+)/.exec(src.slice(i))
    if (diceMatch && (i === 0 || !/[A-Za-z0-9_.]/.test(src[i - 1]!))) {
      tokens.push(`#dice:${diceMatch[1] || '1'}:${diceMatch[2]}`)
      i += diceMatch[0].length
      continue
    }
    const numMatch = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i))
    if (numMatch) {
      tokens.push(numMatch[0])
      i += numMatch[0].length
      continue
    }
    const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (idMatch) {
      tokens.push(idMatch[0])
      i += idMatch[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (
      two === '>=' ||
      two === '<=' ||
      two === '==' ||
      two === '!=' ||
      two === '&&' ||
      two === '||'
    ) {
      tokens.push(two)
      i += 2
      continue
    }
    if ('+-*/%^(),<>'.includes(ch)) {
      tokens.push(ch)
      i++
      continue
    }
    return null
  }
  return tokens
}

function parseExprTokens(tokens: string[]): ExprNode | null {
  let pos = 0
  const peek = (): string | undefined => tokens[pos]
  const take = (): string | undefined => tokens[pos++]

  const PREC: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '>': 4,
    '<=': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6,
    '^': 7
  }

  function primary(): ExprNode | null {
    const tk = take()
    if (tk === undefined) return null
    if (tk === '(') {
      const inner = binary(0)
      if (take() !== ')') return null
      return inner
    }
    if (tk === '-' || tk === '+') {
      const a = primary()
      return a ? { t: 'un', op: tk, a } : null
    }
    if (tk.startsWith('#dice:')) {
      const [, c, s] = tk.split(':')
      return { t: 'dice', count: Number(c), sides: Number(s) }
    }
    if (/^[\d.]/.test(tk)) return { t: 'num', v: Number(tk) }
    if (/^[A-Za-z_]/.test(tk)) {
      if (peek() === '(') {
        take()
        const args: ExprNode[] = []
        if (peek() !== ')') {
          for (;;) {
            const arg = binary(0)
            if (!arg) return null
            args.push(arg)
            if (peek() === ',') {
              take()
              continue
            }
            break
          }
        }
        if (take() !== ')') return null
        return { t: 'call', fn: tk.toLowerCase(), args }
      }
      return { t: 'id', name: tk }
    }
    return null
  }

  function binary(minPrec: number): ExprNode | null {
    let left = primary()
    if (!left) return null
    for (;;) {
      const op = peek()
      if (op === undefined || PREC[op] === undefined || PREC[op]! < minPrec) break
      take()
      const nextMin = op === '^' ? PREC[op]! : PREC[op]! + 1
      const right = binary(nextMin)
      if (!right) return null
      left = { t: 'bin', op, a: left, b: right }
    }
    return left
  }

  const root = binary(0)
  if (!root || pos !== tokens.length) return null
  return root
}

export function parseMxExpression(src: string): ExprNode | null {
  const key = src.trim()
  if (exprCache.has(key)) return exprCache.get(key) ?? null
  const tokens = tokenizeExpr(key)
  const ast = tokens && tokens.length ? parseExprTokens(tokens) : null
  if (exprCache.size > 2000) exprCache.clear()
  exprCache.set(key, ast)
  return ast
}

function evalAst(node: ExprNode, ctx: MxExprContext): number {
  switch (node.t) {
    case 'num':
      return node.v
    case 'id': {
      const name = node.name
      if (name in ctx.vars) return ctx.vars[name]!
      const lower = name.toLowerCase()
      if (lower === 'pi') return Math.PI
      if (lower === 'e') return Math.E
      for (const k of Object.keys(ctx.vars)) if (k.toLowerCase() === lower) return ctx.vars[k]!
      return 0
    }
    case 'dice': {
      let sum = 0
      for (let i = 0; i < Math.min(100, node.count); i++) {
        sum += 1 + Math.floor(ctx.rng() * Math.max(1, node.sides))
      }
      return sum
    }
    case 'un': {
      const a = evalAst(node.a, ctx)
      return node.op === '-' ? -a : a
    }
    case 'bin': {
      const a = evalAst(node.a, ctx)
      const b = evalAst(node.b, ctx)
      switch (node.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          return b === 0 ? 0 : a / b
        case '%':
          return b === 0 ? 0 : a % b
        case '^':
          return Math.pow(a, b)
        case '<':
          return a < b ? 1 : 0
        case '>':
          return a > b ? 1 : 0
        case '<=':
          return a <= b ? 1 : 0
        case '>=':
          return a >= b ? 1 : 0
        case '==':
          return Math.abs(a - b) < 1e-9 ? 1 : 0
        case '!=':
          return Math.abs(a - b) >= 1e-9 ? 1 : 0
        case '&&':
          return a && b ? 1 : 0
        case '||':
          return a || b ? 1 : 0
        default:
          return 0
      }
    }
    case 'call': {
      const args = node.args.map((a) => evalAst(a, ctx))
      switch (node.fn) {
        case 'min':
          return args.length ? Math.min(...args) : 0
        case 'max':
          return args.length ? Math.max(...args) : 0
        case 'floor':
          return Math.floor(args[0] ?? 0)
        case 'ceil':
          return Math.ceil(args[0] ?? 0)
        case 'round':
          return Math.round(args[0] ?? 0)
        case 'abs':
          return Math.abs(args[0] ?? 0)
        case 'sqrt':
          return Math.sqrt(Math.max(0, args[0] ?? 0))
        case 'pow':
          return Math.pow(args[0] ?? 0, args[1] ?? 1)
        case 'log':
          return Math.log(Math.max(1e-9, args[0] ?? 1))
        case 'clamp':
          return Math.max(args[1] ?? 0, Math.min(args[2] ?? 0, args[0] ?? 0))
        case 'if':
          return (args[0] ?? 0) ? (args[1] ?? 0) : (args[2] ?? 0)
        case 'random': {
          const lo = args[0] ?? 0
          const hi = args[1] ?? 1
          return lo + ctx.rng() * (hi - lo)
        }
        case 'randint': {
          const lo = Math.ceil(args[0] ?? 0)
          const hi = Math.floor(args[1] ?? 1)
          return lo + Math.floor(ctx.rng() * (hi - lo + 1))
        }
        case 'lookup': {
          // 1-based 等级查表函数：lookup(level, v1, v2, v3, ...)
          if (args.length <= 1) return 0
          const table = args.slice(1)
          const idx = Math.max(0, Math.min(table.length - 1, Math.round(args[0] ?? 1) - 1))
          return table[idx] ?? 0
        }
        case 'lookup0': {
          // 0-based 索引查表函数：lookup0(idx, v0, v1, v2, ...)
          if (args.length <= 1) return 0
          const table = args.slice(1)
          const idx = Math.max(0, Math.min(table.length - 1, Math.round(args[0] ?? 0)))
          return table[idx] ?? 0
        }
        case 'lerp': {
          const a = args[0] ?? 0
          const b = args[1] ?? 0
          const tVal = Math.max(0, Math.min(1, args[2] ?? 0))
          return a + (b - a) * tVal
        }
        case 'smoothstep': {
          const e0 = args[0] ?? 0
          const e1 = args[1] ?? 1
          const x = args[2] ?? 0
          const span = Math.abs(e1 - e0) < 1e-9 ? 1 : e1 - e0
          const tVal = Math.max(0, Math.min(1, (x - e0) / span))
          return tVal * tVal * (3 - 2 * tVal)
        }
        case 'diminish': {
          // MOBA 护甲/暴击递减软上限公式：max * (x / (x + k))
          const x = Math.max(0, args[0] ?? 0)
          const k = Math.max(1e-6, args[1] ?? 100)
          const scale = args[2] ?? 1
          return scale * (x / (x + k))
        }
        default:
          return 0
      }
    }
  }
}

export interface MxFormulaValidation {
  valid: boolean
  error?: string
  referencedVars: string[]
}

const KNOWN_MX_FUNCTIONS = new Set([
  'min',
  'max',
  'floor',
  'ceil',
  'round',
  'abs',
  'sqrt',
  'pow',
  'log',
  'clamp',
  'if',
  'random',
  'randint',
  'lookup',
  'lookup0',
  'lerp',
  'smoothstep',
  'diminish'
])

/**
 * 实时校验公式语法并提取引用的变量名，供属性检查器提示语法错误或未定义标识符。
 */
export function validateMxFormula(
  formula: string | undefined,
  kind: 'resource' | 'state' | 'register' | 'end' = 'resource'
): MxFormulaValidation {
  const s = (formula ?? '').trim()
  if (!s) return { valid: true, referencedVars: [] }

  // 检查括号配对
  let depth = 0
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth < 0)
        return { valid: false, error: 'Unmatched closing parenthesis ")"', referencedVars: [] }
    }
  }
  if (depth !== 0) {
    return { valid: false, error: 'Unclosed parenthesis "("', referencedVars: [] }
  }

  let exprToCheck = s
  if (kind === 'resource') {
    const spec = parseMxFlowFormula(s)
    if (spec.type === 'all') return { valid: true, referencedVars: [] }
    exprToCheck = spec.expr
  } else if (kind === 'state' || kind === 'end') {
    const spec = parseMxStateFormula(s)
    if (spec.type !== 'expr') return { valid: true, referencedVars: [] }
    exprToCheck = spec.expr
  }

  const tokens = tokenizeExpr(exprToCheck)
  if (!tokens || !tokens.length) {
    return { valid: false, error: 'Invalid formula syntax', referencedVars: [] }
  }
  const ast = parseExprTokens(tokens)
  if (!ast) {
    return { valid: false, error: 'Incomplete or malformed expression', referencedVars: [] }
  }

  const vars = new Set<string>()
  let unknownFn: string | null = null
  const walk = (n: ExprNode): void => {
    if (n.t === 'id') {
      const low = n.name.toLowerCase()
      if (low !== 'pi' && low !== 'e' && low !== 'step' && low !== 't' && low !== 'self') {
        vars.add(n.name)
      }
    } else if (n.t === 'un') {
      walk(n.a)
    } else if (n.t === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'call') {
      if (!KNOWN_MX_FUNCTIONS.has(n.fn)) unknownFn = n.fn
      n.args.forEach(walk)
    }
  }
  walk(ast)
  if (unknownFn) {
    return {
      valid: false,
      error: `Unknown function "${unknownFn}()"`,
      referencedVars: [...vars]
    }
  }
  return { valid: true, referencedVars: [...vars] }
}

/** 求值任意表达式；语法错误返回 fallback */
export function evaluateMxExpression(
  src: string | undefined,
  ctx: MxExprContext,
  fallback = 0
): number {
  if (!src || !src.trim()) return fallback
  const ast = parseMxExpression(src)
  if (!ast) return fallback
  const v = evalAst(ast, ctx)
  return Number.isFinite(v) ? v : fallback
}

export function validateMxExpression(src: string): boolean {
  if (!src.trim()) return true
  return parseMxExpression(src) !== null
}

// ───────────────────────────── 连线公式 ─────────────────────────────

export type MxFlowSpec =
  { type: 'all' } | { type: 'expr'; expr: string; probability?: number; every?: number }

const flowSpecCache = new Map<string, MxFlowSpec>()

/**
 * 解析资源连线流量：
 * - `` / `1` / `Gold*0.1` → 表达式
 * - `all` → 全部
 * - `50%` → 概率 0.5 传 1 个；`3 50%` 或 `3@50%` → 概率 0.5 传 3 个
 * - `2 every 3` / `2|3` → 每 3 步传 2 个
 */
export function parseMxFlowFormula(raw: string | undefined): MxFlowSpec {
  const s = (raw ?? '').trim()
  const cached = flowSpecCache.get(s)
  if (cached) return cached
  let result: MxFlowSpec
  if (!s) {
    result = { type: 'expr', expr: '1' }
  } else if (/^all$/i.test(s)) {
    result = { type: 'all' }
  } else {
    let rest = s
    let every: number | undefined
    const everyMatch = /^(.*?)\s*(?:\bevery\b|\|)\s*(\d+)\s*$/i.exec(rest)
    if (everyMatch) {
      every = Math.max(1, Number(everyMatch[2]))
      rest = everyMatch[1]!.trim() || '1'
    }
    let probability: number | undefined
    const probOnly = /^(\d+(?:\.\d+)?)\s*%$/.exec(rest)
    if (probOnly) {
      result = { type: 'expr', expr: '1', probability: Number(probOnly[1]) / 100, every }
    } else {
      const probSuffix = /^(.*?)\s*@?\s*(\d+(?:\.\d+)?)\s*%$/.exec(rest)
      if (probSuffix && probSuffix[1]!.trim()) {
        probability = Number(probSuffix[2]) / 100
        rest = probSuffix[1]!.trim().replace(/@$/, '').trim()
      }
      result = { type: 'expr', expr: rest || '1', probability, every }
    }
  }
  if (flowSpecCache.size > 4000) flowSpecCache.clear()
  flowSpecCache.set(s, result)
  return result
}

export type MxStateSpec =
  | { type: 'modifier'; delta: number; percent: boolean }
  | { type: 'activator'; op: '>' | '<' | '>=' | '<=' | '==' | '!='; value: number }
  | { type: 'range'; lo: number; hi: number }
  | { type: 'trigger' }
  | { type: 'reverse_trigger' }
  | { type: 'expr'; expr: string }

const stateSpecCache = new Map<string, MxStateSpec>()

/** 解析状态连线标签 */
export function parseMxStateFormula(raw: string | undefined): MxStateSpec {
  const s = (raw ?? '').trim()
  const cached = stateSpecCache.get(s)
  if (cached) return cached
  let result: MxStateSpec
  if (!s || s === '*') {
    result = { type: 'trigger' }
  } else if (s === '!') {
    result = { type: 'reverse_trigger' }
  } else {
    const range = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/.exec(s)
    if (range) {
      result = { type: 'range', lo: Number(range[1]), hi: Number(range[2]) }
    } else {
      const act = /^(>=|<=|==|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(s)
      if (act) {
        const op = act[1] === '=' ? '==' : (act[1] as '>' | '<' | '>=' | '<=' | '==' | '!=')
        result = { type: 'activator', op, value: Number(act[2]) }
      } else {
        const mod = /^([+-])\s*(\d+(?:\.\d+)?)\s*(%?)$/.exec(s)
        if (mod) {
          const delta = Number(mod[2]) * (mod[1] === '-' ? -1 : 1)
          result = { type: 'modifier', delta, percent: mod[3] === '%' }
        } else {
          const actExpr = /^(>=|<=|==|!=|>|<|=)\s*(.+)$/.exec(s)
          if (actExpr && actExpr[2]!.trim()) {
            const op = actExpr[1] === '=' ? '==' : actExpr[1]!
            result = { type: 'expr', expr: `a ${op} (${actExpr[2]!.trim()})` }
          } else {
            result = { type: 'expr', expr: s }
          }
        }
      }
    }
  }
  if (stateSpecCache.size > 4000) stateSpecCache.clear()
  stateSpecCache.set(s, result)
  return result
}

// ───────────────────────────── 标识符 ─────────────────────────────

/** 节点 label → 公式标识符（`Gold Found` → `Gold_Found`） */
export function mxIdentifier(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return ''
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned
}

// ───────────────────────────── 运行时状态 ─────────────────────────────

export type MxEventType =
  | 'produce'
  | 'transfer'
  | 'consume'
  | 'convert'
  | 'trade'
  | 'trigger'
  | 'blocked'
  | 'activate'
  | 'deactivate'
  | 'release'
  | 'register'
  | 'end'

export interface MxEvent {
  step: number
  type: MxEventType
  nodeId: string
  edgeId?: string
  targetId?: string
  amount?: number
  resourceId?: string
  detail?: string
}

export interface MxRuntimeState {
  step: number
  /** Pool / Register / Delay / Queue / Converter 缓冲的数值 */
  values: Record<string, number>
  /** 上一步各节点是否处于激活状态 */
  active: Record<string, boolean>
  /** Gate 确定性分流游标 */
  gateCursor: Record<string, number>
  /** Delay / Queue 缓冲：[释放步, 数量] */
  buffers: Record<string, Array<{ release: number; amount: number }>>
  /** 每条边本步实际流量 */
  edgeFlows: Record<string, number>
  /** 本步触发 / 执行过的节点 */
  fired: Record<string, boolean>
  ended: boolean
  endReason?: string
  totalProduced: number
  totalConsumed: number
}

export interface MxRunOptions {
  seed?: number
  /** 场景 / 外部覆盖的参数值 */
  params?: Record<string, number>
  /** 本步手动点击的交互节点 */
  interactions?: string[]
  /** 内部前瞻试算（Lookahead Rollout）时跳过 Agent 递归调用 */
  skipAgents?: boolean
}

function capOf(node: MxNode, doc?: MxDocument, state?: MxRuntimeState): number {
  if (node.capacity == null || node.capacity <= 0) return Number.POSITIVE_INFINITY
  if (doc && state) {
    return Math.max(0, node.capacity + modifierBonus(doc, node.id, state, node.capacity))
  }
  return node.capacity
}

export function resolveMxParams(doc: MxDocument, scenarioId?: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of doc.params) {
    const name = mxIdentifier(p.name)
    if (name) out[name] = p.value
  }
  const sc = doc.scenarios.find((s) => s.id === (scenarioId ?? doc.activeScenarioId))
  if (sc) {
    for (const [k, v] of Object.entries(sc.params)) {
      const name = mxIdentifier(k)
      if (name && Number.isFinite(v)) out[name] = v
    }
  }
  return out
}

const EMPTY_EDGES: MxEdge[] = []

interface MxGraphIndex {
  byId: Map<string, MxNode>
  identEntries: Array<{ id: string; ident: string }>
  registers: MxNode[]
  delaysAndQueues: MxNode[]
  endNodes: MxNode[]
  nodesByKind: Map<MxNodeKind, MxNode[]>
  outResByNode: Map<string, MxEdge[]>
  inResByNode: Map<string, MxEdge[]>
  stateInByNode: Map<string, MxEdge[]>
  stateOutByNode: Map<string, MxEdge[]>
  stateInByEdge: Map<string, MxEdge[]>
  resEdgeById: Map<string, MxEdge>
}

const graphIndexCache = new WeakMap<
  MxDocument,
  { nodesRef: MxNode[]; edgesRef: MxEdge[]; countN: number; countE: number; idx: MxGraphIndex }
>()

function getMxGraphIndex(doc: MxDocument): MxGraphIndex {
  const cached = graphIndexCache.get(doc)
  if (
    cached &&
    cached.nodesRef === doc.nodes &&
    cached.edgesRef === doc.edges &&
    cached.countN === doc.nodes.length &&
    cached.countE === doc.edges.length
  ) {
    return cached.idx
  }
  const byId = new Map<string, MxNode>()
  const identEntries: Array<{ id: string; ident: string }> = []
  const registers: MxNode[] = []
  const delaysAndQueues: MxNode[] = []
  const endNodes: MxNode[] = []
  const nodesByKind = new Map<MxNodeKind, MxNode[]>()
  const outResByNode = new Map<string, MxEdge[]>()
  const inResByNode = new Map<string, MxEdge[]>()
  const stateInByNode = new Map<string, MxEdge[]>()
  const stateOutByNode = new Map<string, MxEdge[]>()
  const stateInByEdge = new Map<string, MxEdge[]>()
  const resEdgeById = new Map<string, MxEdge>()

  for (const n of doc.nodes) {
    byId.set(n.id, n)
    identEntries.push({ id: n.id, ident: mxIdentifier(n.label) })
    if (n.kind === 'register') registers.push(n)
    else if (n.kind === 'delay' || n.kind === 'queue') delaysAndQueues.push(n)
    else if (n.kind === 'end') endNodes.push(n)
    let kArr = nodesByKind.get(n.kind)
    if (!kArr) {
      kArr = []
      nodesByKind.set(n.kind, kArr)
    }
    kArr.push(n)
  }
  for (const e of doc.edges) {
    if (e.kind === 'resource') {
      resEdgeById.set(e.id, e)
      let outArr = outResByNode.get(e.from)
      if (!outArr) {
        outArr = []
        outResByNode.set(e.from, outArr)
      }
      outArr.push(e)

      let inArr = inResByNode.get(e.to)
      if (!inArr) {
        inArr = []
        inResByNode.set(e.to, inArr)
      }
      inArr.push(e)
    } else if (e.kind === 'state') {
      let sOut = stateOutByNode.get(e.from)
      if (!sOut) {
        sOut = []
        stateOutByNode.set(e.from, sOut)
      }
      sOut.push(e)

      if (e.targetEdgeId) {
        let sEdge = stateInByEdge.get(e.targetEdgeId)
        if (!sEdge) {
          sEdge = []
          stateInByEdge.set(e.targetEdgeId, sEdge)
        }
        sEdge.push(e)
      } else {
        let sIn = stateInByNode.get(e.to)
        if (!sIn) {
          sIn = []
          stateInByNode.set(e.to, sIn)
        }
        sIn.push(e)
      }
    }
  }
  const idx: MxGraphIndex = {
    byId,
    identEntries,
    registers,
    delaysAndQueues,
    endNodes,
    nodesByKind,
    outResByNode,
    inResByNode,
    stateInByNode,
    stateOutByNode,
    stateInByEdge,
    resEdgeById
  }
  graphIndexCache.set(doc, {
    nodesRef: doc.nodes,
    edgesRef: doc.edges,
    countN: doc.nodes.length,
    countE: doc.edges.length,
    idx
  })
  return idx
}

const exprHasIdCache = new Map<string, boolean>()
function exprNeedsVars(src: string | undefined): boolean {
  if (!src) return false
  const key = src.trim()
  if (!key || /^-?\d+(?:\.\d+)?$/.test(key)) return false
  const cached = exprHasIdCache.get(key)
  if (cached !== undefined) return cached
  const ast = parseMxExpression(key)
  let hasId = false
  const walk = (n: ExprNode | null): void => {
    if (!n || hasId) return
    if (n.t === 'id') {
      hasId = true
    } else if (n.t === 'un') {
      walk(n.a)
    } else if (n.t === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'call') {
      n.args.forEach(walk)
    }
  }
  walk(ast)
  if (exprHasIdCache.size > 4000) exprHasIdCache.clear()
  exprHasIdCache.set(key, hasId)
  return hasId
}

function buildVars(
  doc: MxDocument,
  values: Record<string, number>,
  params: Record<string, number>,
  step: number
): Record<string, number> {
  const vars: Record<string, number> = { ...params, step, t: step }
  const idx = getMxGraphIndex(doc)
  for (const entry of idx.identEntries) {
    const val = values[entry.id] ?? 0
    if (entry.ident && !(entry.ident in params)) vars[entry.ident] = val
    vars[entry.id] = val
  }
  return vars
}

export function createMxInitialState(
  doc: MxDocument,
  options: { params?: Record<string, number> } = {}
): MxRuntimeState {
  const values: Record<string, number> = {}
  const buffers: Record<string, Array<{ release: number; amount: number }>> = {}
  for (const n of doc.nodes) {
    if (n.kind === 'pool') values[n.id] = Math.min(capOf(n), Math.max(0, Number(n.initial ?? 0)))
    else if (n.kind === 'register') values[n.id] = Number(n.initial ?? 0)
    else values[n.id] = 0
    if (n.kind === 'delay' || n.kind === 'queue') buffers[n.id] = []
  }
  const params = options.params ?? resolveMxParams(doc)
  const state: MxRuntimeState = {
    step: 0,
    values,
    active: {},
    gateCursor: {},
    buffers,
    edgeFlows: {},
    fired: {},
    ended: false,
    totalProduced: 0,
    totalConsumed: 0
  }
  recomputeRegisters(doc, state, params, () => 0.5)
  for (const n of doc.nodes) state.active[n.id] = isNodeActive(doc, n, state, params)
  return state
}

function stateInputs(doc: MxDocument, nodeId: string): MxEdge[] {
  return getMxGraphIndex(doc).stateInByNode.get(nodeId) ?? EMPTY_EDGES
}

function recomputeRegisters(
  doc: MxDocument,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number
): void {
  const gIdx = getMxGraphIndex(doc)
  const regs = gIdx.registers
  if (!regs.length) return
  // 两遍，允许寄存器链式引用
  for (let pass = 0; pass < 2; pass++) {
    let sharedVars: Record<string, number> | null = null
    for (const n of regs) {
      if (n.trigger === 'interactive' && !n.formula?.trim()) continue
      const inputs = gIdx.stateInByNode.get(n.id) ?? EMPTY_EDGES
      const expr = n.formula || (inputs.length ? 'a' : String(n.initial ?? 0))
      let vars: Record<string, number> = params
      if (exprNeedsVars(expr)) {
        if (!sharedVars) sharedVars = buildVars(doc, state.values, params, state.step)
        vars = { ...sharedVars }
        const letters = 'abcdefgh'
        for (let idx = 0; idx < inputs.length && idx < letters.length; idx++) {
          vars[letters[idx]!] = state.values[inputs[idx]!.from] ?? 0
        }
      }
      let v = evaluateMxExpression(expr, { vars, rng }, n.initial ?? 0)
      if (n.min != null) v = Math.max(n.min, v)
      if (n.max != null) v = Math.min(n.max, v)
      state.values[n.id] = Math.round(v * 1000) / 1000
      if (sharedVars) {
        sharedVars[n.id] = state.values[n.id]!
        const ident = mxIdentifier(n.label)
        if (ident && !(ident in params)) sharedVars[ident] = state.values[n.id]!
      }
    }
  }
}

function checkActivator(
  spec: MxStateSpec,
  v: number,
  vars: Record<string, number>,
  rng: () => number
): boolean | null {
  switch (spec.type) {
    case 'activator':
      switch (spec.op) {
        case '>':
          return v > spec.value
        case '<':
          return v < spec.value
        case '>=':
          return v >= spec.value
        case '<=':
          return v <= spec.value
        case '==':
          return Math.abs(v - spec.value) < 1e-9
        case '!=':
          return Math.abs(v - spec.value) >= 1e-9
      }
      return null
    case 'range':
      return v >= spec.lo && v <= spec.hi
    case 'expr': {
      // 带比较运算符的表达式视为激活条件，用 `a` 代表源节点值
      if (!/[<>=!]/.test(spec.expr)) return null
      return evaluateMxExpression(spec.expr, { vars: { ...vars, a: v, self: v }, rng }, 0) !== 0
    }
    default:
      return null
  }
}

function isNodeActive(
  doc: MxDocument,
  node: MxNode,
  state: MxRuntimeState,
  params: Record<string, number>,
  sharedVars?: Record<string, number>
): boolean {
  const ins = stateInputs(doc, node.id)
  if (!ins.length) return true
  let vars: Record<string, number> | undefined = sharedVars
  for (const e of ins) {
    const spec = parseMxStateFormula(e.formula)
    if (spec.type === 'expr' && !vars) {
      vars = buildVars(doc, state.values, params, state.step)
    }
    const res = checkActivator(spec, state.values[e.from] ?? 0, vars ?? params, () => 0.5)
    if (res === false) return false
  }
  return true
}

/** 状态连线修改量：Σ delta × 源节点值（百分比修改量按比例放大） */
function modifierBonus(
  doc: MxDocument,
  nodeId: string,
  state: MxRuntimeState,
  base: number
): number {
  const ins = stateInputs(doc, nodeId)
  if (!ins.length) return 0
  let bonus = 0
  for (const e of ins) {
    const spec = parseMxStateFormula(e.formula)
    if (spec.type !== 'modifier') continue
    const src = state.values[e.from] ?? 0
    bonus += spec.percent ? (base * spec.delta * src) / 100 : spec.delta * src
  }
  return bonus
}

function evalFlowAmount(
  doc: MxDocument,
  edge: MxEdge,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number,
  available: number
): number {
  const gIdx = getMxGraphIndex(doc)
  const edgeStateIns = gIdx.stateInByEdge.get(edge.id) ?? EMPTY_EDGES
  let vars: Record<string, number> | null = null
  const ensureVars = (): Record<string, number> => {
    if (!vars) vars = buildVars(doc, state.values, params, state.step)
    return vars
  }

  // 检查直接指向该连线的状态边（Activator / Modifier）
  let edgeModifierBonus = 0
  for (const se of edgeStateIns) {
    const stSpec = parseMxStateFormula(se.formula)
    const srcVal = state.values[se.from] ?? 0
    const act = checkActivator(stSpec, srcVal, stSpec.type === 'expr' ? ensureVars() : params, rng)
    if (act === false) return 0
  }
  const spec = parseMxFlowFormula(edge.formula)
  if (spec.type === 'all') return available
  if (spec.every && state.step % spec.every !== 0) return 0
  if (spec.probability != null && rng() >= spec.probability) return 0
  const src = gIdx.byId.get(edge.from)
  const dst = gIdx.byId.get(edge.to)
  let base = 1
  if (exprNeedsVars(spec.expr)) {
    const v = ensureVars()
    if (src) v.self = state.values[src.id] ?? 0
    const nodeStateIns = src ? stateInputs(doc, src.id) : EMPTY_EDGES
    const combinedStateIns =
      edgeStateIns.length && nodeStateIns.length
        ? [...edgeStateIns, ...nodeStateIns]
        : edgeStateIns.length
          ? edgeStateIns
          : nodeStateIns
    const letters = 'abcdefgh'
    combinedStateIns.forEach((se, idx) => {
      if (idx < letters.length) v[letters[idx]!] = state.values[se.from] ?? 0
    })
    if (!('a' in v)) {
      v.a = src && src.kind !== 'source' ? (state.values[src.id] ?? 0) : state.step
    }
    base = evaluateMxExpression(spec.expr, { vars: v, rng }, 1)
  } else {
    base = evaluateMxExpression(spec.expr, { vars: params, rng }, 1)
  }
  for (const se of edgeStateIns) {
    const stSpec = parseMxStateFormula(se.formula)
    if (stSpec.type === 'modifier') {
      const srcVal = state.values[se.from] ?? 0
      edgeModifierBonus += stSpec.percent
        ? (base * stSpec.delta * srcVal) / 100
        : stSpec.delta * srcVal
    }
  }
  // 指向本连线源节点的修改量（Source / Converter 产出加成），或指向 Drain 终点节点的修改量
  const srcBonus = src ? modifierBonus(doc, src.id, state, base) : 0
  const dstBonus = dst?.kind === 'drain' ? modifierBonus(doc, dst.id, state, base) : 0
  const bonus = srcBonus + dstBonus + edgeModifierBonus
  return Math.max(0, Math.round((base + bonus) * 1000) / 1000)
}

const MX_AGENT_IMPORTANCE_WEIGHTS: Record<MxAgentImportance, number> = {
  min: 0.25,
  low: 0.5,
  med: 1.0,
  high: 2.0,
  max: 4.0
}

/**
 * 将归一化进度 ratio ∈ [0, 1] 映射到指定非线性效用响应曲线：
 * - linear:      f(r) = r
 * - diminishing: f(r) = sqrt(r)（边际效用递减，前期收益敏感，后期平缓）
 * - urgency:     f(r) = 1 - (1 - r)^3（生存危机曲线，低值时斜率高达 3x，安全区趋平）
 * - step:        f(r) = r >= 1 ? 1 : 0.25 * r（里程碑阶跃曲线，达标瞬间获得 +0.75 爆发效用）
 */
function applyMxUtilityCurve(ratio: number, curve: MxAgentUtilityCurve = 'linear'): number {
  const r = Math.max(0, Math.min(1, ratio))
  switch (curve) {
    case 'diminishing':
      return Math.sqrt(r)
    case 'urgency': {
      const inv = 1 - r
      return 1 - inv * inv * inv
    }
    case 'step':
      return r >= 1 - 1e-6 ? 1.0 : 0.25 * r
    case 'linear':
    default:
      return r
  }
}

function parseLeadingPositiveNum(formula: string | undefined, fallback = 1): number {
  if (!formula) return fallback
  const m = formula.trim().match(/^([0-9]+(?:\.[0-9]+)?)/)
  if (!m) return fallback
  const v = Number(m[1])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * 拓扑距离势能引导（Capped Topological Potential Shaping）：
 * 从未达标的 Upwards 目标节点沿资源/状态依赖链逆向回溯最多 4 级上游 Pool，
 * 按每级转换器的输入门槛 R_U 赋予封顶势能 0.35 * P_V * min(val_U, R_U) / R_U：
 * - 在攒够前置材料（0 -> R_U）的过程中每一步都有严格正的 ΔU > 0；
 * - 攒满 R_U 后继续空攒前置材料 ΔU = 0（防止无限囤积原材料）；
 * - 触发转换器消耗 R_U 产出下游资产时，净效用跃迁 +0.65 * P_V > 0（严格单调驱动长链路合成）。
 */
function computeMxTopologicalShapingUtility(
  doc: MxDocument,
  state: MxRuntimeState,
  unmetGoals: Array<{ nodeId: string; marginalUnitValue: number }>
): number {
  if (!unmetGoals.length) return 0
  const gIdx = getMxGraphIndex(doc)
  const byId = gIdx.byId
  let shapingSum = 0

  for (const g of unmetGoals) {
    const visitedPools = new Set<string>([g.nodeId])
    let frontier: Array<{ poolId: string; unitVal: number }> = [
      { poolId: g.nodeId, unitVal: g.marginalUnitValue }
    ]

    for (let stage = 0; stage < 4 && frontier.length > 0; stage++) {
      const nextFrontier: Array<{ poolId: string; unitVal: number }> = []
      for (const item of frontier) {
        const inEdges = gIdx.inResByNode.get(item.poolId) ?? EMPTY_EDGES
        for (const eOut of inEdges) {
          const midNode = byId.get(eOut.from)
          if (!midNode) continue
          const outRate = parseLeadingPositiveNum(eOut.formula, 1)

          if (midNode.kind === 'pool') {
            if (visitedPools.has(midNode.id)) continue
            visitedPools.add(midNode.id)
            const reqAmt = outRate
            const curVal = Math.max(0, state.values[midNode.id] ?? 0)
            const stagePotential = 0.35 * item.unitVal * outRate
            shapingSum += stagePotential * (Math.min(curVal, reqAmt) / reqAmt)
            const upstreamUnitVal = stagePotential / reqAmt
            if (curVal < reqAmt) {
              nextFrontier.push({ poolId: midNode.id, unitVal: upstreamUnitVal })
            }
          } else if (
            midNode.kind === 'converter' ||
            midNode.kind === 'trader' ||
            midNode.kind === 'gate' ||
            midNode.kind === 'delay' ||
            midNode.kind === 'queue'
          ) {
            const reqEdges = gIdx.inResByNode.get(midNode.id) ?? EMPTY_EDGES
            for (const eIn of reqEdges) {
              const upNode = byId.get(eIn.from)
              if (!upNode || upNode.kind !== 'pool' || visitedPools.has(upNode.id)) continue
              visitedPools.add(upNode.id)
              const reqAmt = parseLeadingPositiveNum(eIn.formula, 1)
              const curVal = Math.max(0, state.values[upNode.id] ?? 0)
              const stagePotential = 0.35 * item.unitVal * outRate
              shapingSum += stagePotential * (Math.min(curVal, reqAmt) / reqAmt)
              const upstreamUnitVal = stagePotential / reqAmt
              nextFrontier.push({ poolId: upNode.id, unitVal: upstreamUnitVal })
            }
          }

          // 同时检查激活该前置节点的 State Activator 连线（如 Pool --(>= 5)--> Converter/Source）
          const stEdges = gIdx.stateInByNode.get(midNode.id) ?? EMPTY_EDGES
          for (const se of stEdges) {
            const stSrc = byId.get(se.from)
            if (!stSrc || stSrc.kind !== 'pool' || visitedPools.has(stSrc.id)) continue
            const mAct = se.formula?.trim().match(/^(?:>=|>|==)\s*([0-9]+(?:\.[0-9]+)?)/)
            if (!mAct) continue
            const rawThresh = Number(mAct[1])
            const reqThresh =
              se.formula.trim().startsWith('>') && !se.formula.trim().startsWith('>=')
                ? rawThresh + 1
                : rawThresh
            if (!Number.isFinite(reqThresh) || reqThresh <= 0) continue
            visitedPools.add(stSrc.id)
            const curVal = Math.max(0, state.values[stSrc.id] ?? 0)
            const stagePotential = 0.3 * item.unitVal * outRate
            shapingSum += stagePotential * (Math.min(curVal, reqThresh) / reqThresh)
            nextFrontier.push({ poolId: stSrc.id, unitVal: stagePotential / reqThresh })
          }
        }
      }
      frontier = nextFrontier
    }
  }

  return shapingSum
}

/**
 * 计算某个 Agent 在给定运行时状态下的综合效用分（Utility Score）。
 */
export function evaluateMxAgentStateUtility(
  doc: MxDocument,
  state: MxRuntimeState,
  agent: MxAgent,
  params: Record<string, number>,
  rng: () => number
): number {
  let vars: Record<string, number> | null = null
  const ensureVars = (): Record<string, number> => {
    if (!vars) vars = buildVars(doc, state.values, params, state.step)
    return vars
  }

  if (!agent.goals.length) {
    // 若尚未配置目标资产，默认将所有 Pool / Register 的正向增长视为效用
    let fallbackSum = 0
    for (const n of doc.nodes) {
      if (n.kind === 'pool' || n.kind === 'register') {
        fallbackSum += (state.values[n.id] ?? 0) * 0.05
      }
    }
    return fallbackSum
  }

  let totalUtility = 0
  const unmetUpwardsGoals: Array<{ nodeId: string; marginalUnitValue: number }> = []

  for (const g of agent.goals) {
    if (!g.nodeId) continue
    const val = state.values[g.nodeId] ?? 0
    const rawTarget = g.targetFormula?.trim() || '100'
    const targetVal = exprNeedsVars(rawTarget)
      ? evaluateMxExpression(rawTarget, { vars: ensureVars(), rng }, 100)
      : evaluateMxExpression(rawTarget, { vars: params, rng }, 100)
    const scale = Math.max(1, Math.abs(targetVal))
    const weight = MX_AGENT_IMPORTANCE_WEIGHTS[g.importance] ?? 1.0
    const curve: MxAgentUtilityCurve = g.utilityCurve ?? 'linear'

    if (g.trajectory === 'downwards') {
      // 期望数值向 targetVal 降低（例如污染、冷却、负债）
      const mainProgress = -Math.max(val, targetVal)
      const extraPast = val < targetVal ? targetVal - val : 0
      const postFactor = g.continuePastTarget ? 0.85 : agent.personality === 'hoarder' ? 0.2 : 0
      const excessRatio = val > targetVal ? Math.min(1, (val - targetVal) / scale) : 0
      const curvePenalty =
        curve === 'urgency'
          ? excessRatio * excessRatio
          : curve === 'diminishing'
            ? Math.sqrt(excessRatio) - excessRatio
            : 0
      totalUtility +=
        weight * ((mainProgress + extraPast * postFactor) / scale - curvePenalty * 0.5)
    } else {
      // Upwards：期望数值向 targetVal 增长（例如金币、经验、生命值、高阶装备）
      const rawRatio =
        targetVal > 0 ? Math.max(0, Math.min(1, val / targetVal)) : val >= targetVal ? 1 : 0
      const curvedProgress = applyMxUtilityCurve(rawRatio, curve)
      const negPenalty = val < 0 ? val / scale : 0
      const extraPast = val > targetVal ? val - targetVal : 0
      const postFactor = g.continuePastTarget ? 0.85 : agent.personality === 'hoarder' ? 0.35 : 0
      totalUtility += weight * (curvedProgress + negPenalty + (extraPast * postFactor) / scale)

      if (val < targetVal || g.continuePastTarget) {
        unmetUpwardsGoals.push({
          nodeId: g.nodeId,
          marginalUnitValue: weight / scale
        })
      }
    }
  }

  if (agent.shapingEnabled !== false && unmetUpwardsGoals.length > 0) {
    totalUtility += computeMxTopologicalShapingUtility(doc, state, unmetUpwardsGoals)
  }

  return totalUtility
}

/**
 * 为所有启用的 Artificial Agents 执行前瞻试算（支持 1~5 步可配置 Horizon 束搜索 + 步内多动作序贯规划）并选出本步要触发的 Interactive 节点。
 */
function selectMxAgentActions(
  doc: MxDocument,
  prev: MxRuntimeState,
  nowActive: Record<string, boolean>,
  params: Record<string, number>,
  rng: () => number,
  baseSeed: number
): {
  chosenActions: Array<{ agent: MxAgent; nodeId: string; utilityDelta: number }>
  agentControlledIds: Set<string>
} {
  const activeAgents = (doc.agents ?? []).filter((a) => a.enabled)
  const agentControlledIds = new Set<string>()
  const chosenActions: Array<{ agent: MxAgent; nodeId: string; utilityDelta: number }> = []
  if (!activeAgents.length) return { chosenActions, agentControlledIds }

  const allInteractiveNodes = doc.nodes.filter((n) => n.trigger === 'interactive')
  if (!allInteractiveNodes.length) return { chosenActions, agentControlledIds }

  const explicitlyClaimed = new Set<string>()
  for (const ag of activeAgents) {
    for (const nid of ag.controlledNodeIds) explicitlyClaimed.add(nid)
  }

  const rolloutSeed = baseSeed + (prev.step + 1) * 31337

  for (const agent of activeAgents) {
    const candidates = allInteractiveNodes.filter((n) => {
      if (agent.controlledNodeIds.length > 0) {
        return agent.controlledNodeIds.includes(n.id)
      }
      return !explicitlyClaimed.has(n.id)
    })
    for (const c of candidates) agentControlledIds.add(c.id)

    const activeCandidates = candidates.filter((c) => nowActive[c.id] !== false)
    if (!activeCandidates.length) continue

    const maxActions = Math.max(
      1,
      Math.min(5, agent.actionsPerStep ?? (agent.personality === 'aggressive' ? 2 : 1))
    )
    const horizon = Math.max(1, Math.min(5, Math.round(agent.lookaheadHorizon ?? 2)))
    const discount = Math.max(0.1, Math.min(1.0, Number(agent.discount ?? 0.65)))
    const enableMultiStep = horizon > 1 && activeCandidates.length <= 12 && doc.nodes.length <= 250

    if (agent.personality === 'chaotic' && rng() < 0.35) {
      const pick = activeCandidates[Math.floor(rng() * activeCandidates.length)]
      if (pick) {
        chosenActions.push({ agent, nodeId: pick.id, utilityDelta: 0 })
      }
      continue
    }

    // 步内多动作序贯规划（Sequential Multi-Action within the same step）
    const pickedInThisStep: string[] = []
    for (let actionSlot = 0; actionSlot < maxActions; actionSlot++) {
      const baseStep1 = stepMxSimulation(doc, prev, {
        seed: rolloutSeed,
        params,
        interactions: pickedInThisStep,
        skipAgents: true
      }).state
      const baseU = evaluateMxAgentStateUtility(doc, baseStep1, agent, params, rng)

      // 计算未来步无额外动作的基准轨迹效用
      const futureBaseU: number[] = [baseU]
      if (enableMultiStep) {
        let curBase = baseStep1
        for (let h = 2; h <= horizon; h++) {
          if (curBase.ended) {
            futureBaseU.push(futureBaseU[futureBaseU.length - 1]!)
          } else {
            curBase = stepMxSimulation(doc, curBase, {
              seed: rolloutSeed + (h - 1) * 97,
              params,
              interactions: [],
              skipAgents: true
            }).state
            futureBaseU.push(evaluateMxAgentStateUtility(doc, curBase, agent, params, rng))
          }
        }
      }

      const scored: Array<{ nodeId: string; score: number; rawDelta: number }> = []
      for (const cand of activeCandidates) {
        const trialInteractions = [...pickedInThisStep, cand.id]
        const res1 = stepMxSimulation(doc, prev, {
          seed: rolloutSeed,
          params,
          interactions: trialInteractions,
          skipAgents: true
        })
        const u1 = evaluateMxAgentStateUtility(doc, res1.state, agent, params, rng)
        const delta1 = u1 - baseU

        // Check if clicking cand actually changed any state or edge flow compared to current slot baseline
        const hadEffect =
          Math.abs(delta1) > 1e-7 ||
          Object.keys(res1.state.edgeFlows).length > Object.keys(baseStep1.edgeFlows).length ||
          doc.nodes.some(
            (n) => Math.abs((res1.state.values[n.id] ?? 0) - (baseStep1.values[n.id] ?? 0)) > 1e-6
          )
        if (!hadEffect) continue

        let bestFutureDiscountedGain = 0
        if (enableMultiStep && !res1.state.ended) {
          // 束搜索（Beam Search, width = 3）向后展开 horizon - 1 步
          let beam: Array<{ state: MxRuntimeState; prevU: number; accGain: number }> = [
            { state: res1.state, prevU: u1, accGain: 0 }
          ]
          for (let h = 2; h <= horizon; h++) {
            const nextBeam: Array<{ state: MxRuntimeState; prevU: number; accGain: number }> = []
            const gammaH = Math.pow(discount, h - 1)
            const baseStepDelta = futureBaseU[h - 1]! - futureBaseU[h - 2]!
            for (const b of beam) {
              if (b.state.ended) continue
              for (const candH of activeCandidates) {
                const resH = stepMxSimulation(doc, b.state, {
                  seed: rolloutSeed + (h - 1) * 97,
                  params,
                  interactions: [candH.id],
                  skipAgents: true
                })
                const uH = evaluateMxAgentStateUtility(doc, resH.state, agent, params, rng)
                const stepNetGain = uH - b.prevU - baseStepDelta
                const totalGain = b.accGain + gammaH * stepNetGain
                if (totalGain > bestFutureDiscountedGain) {
                  bestFutureDiscountedGain = totalGain
                }
                nextBeam.push({ state: resH.state, prevU: uH, accGain: totalGain })
              }
            }
            nextBeam.sort((a, b) => b.accGain - a.accGain)
            beam = nextBeam.slice(0, 3)
            if (!beam.length) break
          }
        }

        const combinedDelta = delta1 + bestFutureDiscountedGain
        const jitter =
          agent.personality === 'balanced'
            ? (rng() - 0.5) * 0.08
            : agent.personality === 'chaotic'
              ? (rng() - 0.5) * 0.25
              : (rng() - 0.5) * 1e-4
        scored.push({
          nodeId: cand.id,
          score: combinedDelta + jitter,
          rawDelta: combinedDelta
        })
      }

      if (!scored.length) break
      scored.sort((a, b) => b.score - a.score)
      const best = scored[0]!

      // 第 1 个动作允许微弱中性探索（>= -1e-5），后续连击槽位必须带来正边际效用（> 1e-6）
      const minRequiredDelta = actionSlot === 0 ? -1e-5 : 1e-6
      if (best.rawDelta < minRequiredDelta && agent.personality !== 'chaotic') break

      pickedInThisStep.push(best.nodeId)
      chosenActions.push({
        agent,
        nodeId: best.nodeId,
        utilityDelta: Math.round(best.rawDelta * 1000) / 1000
      })
    }
  }

  return { chosenActions, agentControlledIds }
}

/**
 * 智能分析画布中的 Pool / Register 节点，自动推断推荐的 Agent 目标资产列表（供 "Add with AI" 与 "New Agent with AI" 调用）。
 */
export function suggestMxAgentGoalsWithAi(
  doc: MxDocument,
  personality: MxAgentPersonality = 'rational',
  prompt?: string
): MxAgentGoalAsset[] {
  const candidates = doc.nodes.filter((n) => n.kind === 'pool' || n.kind === 'register')
  if (!candidates.length) return []

  const cleanPrompt = (prompt ?? '').trim()
  const lowPrompt = cleanPrompt.toLowerCase()

  const goals: MxAgentGoalAsset[] = []
  const matchedInPrompt = new Set<string>()
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))

  // 拓扑角色识别：区分“终极合成/转化产物池”与“被交互转化器消耗的中间货币/原料池”
  const terminalCraftOutputs = new Set<string>()
  const consumedByInteractive = new Set<string>()
  const incomingCraftYield = new Map<string, number>()

  for (const n of candidates) {
    const inRes = doc.edges.filter((e) => e.kind === 'resource' && e.to === n.id)
    const outRes = doc.edges.filter((e) => e.kind === 'resource' && e.from === n.id)
    const fromConverter = inRes.some((e) => {
      const src = byId.get(e.from)
      return src?.kind === 'converter' || src?.kind === 'trader' || src?.kind === 'gate'
    })
    const feedsConverter = outRes.some((e) => {
      const dst = byId.get(e.to)
      return dst?.kind === 'converter' || dst?.kind === 'trader'
    })
    const feedsInteractiveConverter = outRes.some((e) => {
      const dst = byId.get(e.to)
      return (dst?.kind === 'converter' || dst?.kind === 'trader') && dst?.trigger === 'interactive'
    })
    if (fromConverter && !feedsConverter) {
      terminalCraftOutputs.add(n.id)
      const numFormula = Number(inRes[0]?.formula)
      incomingCraftYield.set(n.id, Number.isFinite(numFormula) && numFormula > 0 ? numFormula : 1)
    }
    if (feedsInteractiveConverter) {
      consumedByInteractive.add(n.id)
    }
  }

  for (const n of candidates) {
    const labelStr = (n.label || n.id).trim()
    const low = labelStr.toLowerCase()
    const isHazard =
      /(debt|heat|pollution|threat|fatigue|corruption|poison|curse|\u8d1f\u503a|\u6c61\u67d3|\u75b2\u52b3|\u5a01\u80c1|\u8150\u8680)/.test(
        low
      )
    const isSurvival =
      /(hp|health|life|shield|armor|stamina|mana|sanity|\u751f\u547d|\u8840|\u62a4\u76fe|\u4f53\u529b)/.test(
        low
      )
    const isPrimary =
      /(gold|coin|gem|diamond|xp|exp|level|lv|depth|score|power|atk|loot|ore|wood|sword|blade|iron|weapon|ssr|hero|tower|\u91d1\u5e01|\u5b9d\u77f3|\u94bb\u77f3|\u7ecf\u9a8c|\u7b49\u7ea7|\u5c42\u6570|\u6218\u529b|\u77ff|\u5251|\u5200|\u94c1|\u88c5\u5907|\u82f1\u96c4|\u5854)/.test(
        low
      )

    let importance: MxAgentImportance = 'med'
    let trajectory: MxAgentTrajectory = 'upwards'
    let continuePastTarget = true
    let utilityCurve: MxAgentUtilityCurve = 'linear'
    let targetVal =
      n.capacity && n.capacity > 0
        ? n.capacity
        : Math.max(50, Math.round((n.initial && n.initial > 0 ? n.initial : 20) * 4))

    if (isHazard) {
      trajectory = 'downwards'
      importance = 'high'
      targetVal = 0
      continuePastTarget = false
      utilityCurve = 'urgency'
    } else if (isSurvival) {
      trajectory = 'upwards'
      importance = personality === 'aggressive' ? 'med' : 'high'
      targetVal = n.capacity && n.capacity > 0 ? n.capacity : Math.max(100, n.initial || 100)
      continuePastTarget = false
      utilityCurve = 'urgency'
    } else if (terminalCraftOutputs.has(n.id)) {
      trajectory = 'upwards'
      importance = 'max'
      continuePastTarget = true
      const unitYield = incomingCraftYield.get(n.id) ?? 1
      targetVal = n.capacity && n.capacity > 0 ? n.capacity : Math.max(5, Math.round(unitYield * 5))
      utilityCurve = personality === 'balanced' ? 'diminishing' : 'linear'
    } else if (
      consumedByInteractive.has(n.id) &&
      terminalCraftOutputs.size > 0 &&
      personality !== 'hoarder'
    ) {
      trajectory = 'upwards'
      importance = 'low'
      continuePastTarget = true
    } else if (isPrimary) {
      trajectory = 'upwards'
      importance = 'max'
      continuePastTarget = true
      utilityCurve = personality === 'balanced' ? 'diminishing' : 'linear'
    } else if (personality === 'hoarder') {
      importance = 'high'
      continuePastTarget = true
    }

    // 自然语言 Prompt 语义匹配（提取节点提及、附近的数字阈值、保命/压低关键词）
    if (lowPrompt && (lowPrompt.includes(low) || lowPrompt.includes(n.id.toLowerCase()))) {
      matchedInPrompt.add(n.id)
      importance = 'max'
      const idx =
        lowPrompt.indexOf(low) >= 0 ? lowPrompt.indexOf(low) : lowPrompt.indexOf(n.id.toLowerCase())
      const afterSlice = lowPrompt.slice(
        idx + low.length,
        Math.min(lowPrompt.length, idx + low.length + 20)
      )
      const beforeSlice = lowPrompt.slice(Math.max(0, idx - 8), idx)
      const windowSlice = `${beforeSlice}${low}${afterSlice}`
      const numMatch =
        afterSlice.match(/([0-9]+(?:\.[0-9]+)?)/) ?? beforeSlice.match(/([0-9]+(?:\.[0-9]+)?)/)
      if (numMatch) {
        const parsed = Number(numMatch[1])
        if (Number.isFinite(parsed) && parsed >= 0) {
          targetVal = parsed
        }
      }
      if (
        /(low|reduce|minimize|clear|down|zero|\u538b\u4f4e|\u964d\u4f4e|\u6e05\u96f6|\u51cf\u5c11|\u63a7\u5236)/.test(
          windowSlice
        )
      ) {
        trajectory = 'downwards'
        if (!numMatch) targetVal = 0
      }
      if (
        /(survive|urgent|safe|keep|protect|\u4fdd\u547d|\u7d27\u6025|\u751f\u5b58|\u5b89\u5168|\u4e0d\u6b7b)/.test(
          windowSlice
        )
      ) {
        utilityCurve = 'urgency'
      } else if (
        /(milestone|unlock|reach|step|\u8fbe\u6807|\u91cc\u7a0b\u7891|\u89e3\u9501|\u7a81\u7834)/.test(
          windowSlice
        )
      ) {
        utilityCurve = 'step'
      }
    }

    goals.push({
      id: mxNewId('goal'),
      nodeId: n.id,
      targetFormula: String(targetVal),
      importance,
      continuePastTarget,
      trajectory,
      utilityCurve
    })
  }

  // 优先保留被 Prompt 显式点名的资产，再按重要度排序保留前 4 个目标资产
  const weightRank: Record<MxAgentImportance, number> = {
    max: 5,
    high: 4,
    med: 3,
    low: 2,
    min: 1
  }
  goals.sort((a, b) => {
    const aMatched = matchedInPrompt.has(a.nodeId) ? 10 : 0
    const bMatched = matchedInPrompt.has(b.nodeId) ? 10 : 0
    return bMatched + weightRank[b.importance] - (aMatched + weightRank[a.importance])
  })
  return goals.slice(0, 4)
}

/**
 * 一键通过 AI 自动构建完整配置的 Artificial Agent（含性格、目标资产、受控交互节点）。
 * 若当前画布尚无 Interactive 节点，会自动将上游入口 Source / Converter 设为 Interactive 以便 Agent 驱动。
 */
export function generateMxAgentWithAi(
  doc: MxDocument,
  hint?: { name?: string; personality?: MxAgentPersonality; prompt?: string }
): MxAgent {
  const existingCount = (doc.agents ?? []).length
  const archetypes: Array<{
    personality: MxAgentPersonality
    name: string
    color: string
    desc: string
  }> = [
    {
      personality: 'rational',
      name: 'Optimizer Bot',
      color: '#6366f1',
      desc: 'Maximizes multi-asset utility via topological shaping & lookahead.'
    },
    {
      personality: 'aggressive',
      name: 'Rusher Agent',
      color: '#ec4899',
      desc: 'Prioritizes rapid progression and high-tempo multi-action combos.'
    },
    {
      personality: 'hoarder',
      name: 'Hoarder Agent',
      color: '#f59e0b',
      desc: 'Accumulates resources well past target thresholds.'
    },
    {
      personality: 'balanced',
      name: 'Human-Like Player',
      color: '#10b981',
      desc: 'Balances survival urgency and wealth with natural decision variance.'
    }
  ]

  const cleanPrompt = hint?.prompt?.trim() || ''
  let inferredPersonality: MxAgentPersonality | undefined = hint?.personality
  let inferredName = hint?.name?.trim() || ''

  if (cleanPrompt && !inferredPersonality) {
    if (
      /(aggressive|rush|attack|combat|fast|speed|\u6fc0\u8fdb|\u8fdb\u653b|\u901f\u63a8|\u72c2\u66b4|\u6218\u6597|\u79d2\u6740)/i.test(
        cleanPrompt
      )
    ) {
      inferredPersonality = 'aggressive'
    } else if (
      /(hoard|save|greedy|farm|accumulate|wealth|\u56e4\u79ef|\u8d2a\u5a6a|\u6512|\u79ef\u7d2f|\u5b88\u8d22|\u79cd\u7530)/i.test(
        cleanPrompt
      )
    ) {
      inferredPersonality = 'hoarder'
    } else if (
      /(chaotic|random|monkey|fuzz|wild|\u6df7\u6c8c|\u968f\u673a|\u4e71\u6309|\u6363\u4e71)/i.test(
        cleanPrompt
      )
    ) {
      inferredPersonality = 'chaotic'
    } else if (
      /(human|balanced|casual|survive|safe|\u5747\u8861|\u62df\u4eba|\u4fdd\u547d|\u751f\u5b58|\u7a33\u5065|\u82df)/i.test(
        cleanPrompt
      )
    ) {
      inferredPersonality = 'balanced'
    } else {
      inferredPersonality = 'rational'
    }
  }

  const pick =
    archetypes.find((a) => a.personality === inferredPersonality) ??
    archetypes[existingCount % archetypes.length]!
  const personality = inferredPersonality ?? pick.personality
  if (!inferredName) {
    inferredName = cleanPrompt
      ? `${pick.name} (${cleanPrompt.slice(0, 14)}${cleanPrompt.length > 14 ? '...' : ''})`
      : `${pick.name} ${existingCount + 1}`
  }

  let interactiveIds = doc.nodes.filter((n) => n.trigger === 'interactive').map((n) => n.id)
  if (!interactiveIds.length) {
    // 若图中还没有任何 Interactive 节点，挑选前 2 个 Source / Converter 转为 Interactive 供 Agent 操控
    const actionable = doc.nodes.filter(
      (n) => n.kind === 'source' || n.kind === 'converter' || n.kind === 'trader'
    )
    for (const act of actionable.slice(0, 2)) {
      act.trigger = 'interactive'
      interactiveIds.push(act.id)
    }
  }

  return {
    id: mxNewId('agent'),
    name: inferredName,
    color: pick.color,
    enabled: true,
    personality,
    description: cleanPrompt || pick.desc,
    goals: suggestMxAgentGoalsWithAi(doc, personality, cleanPrompt),
    controlledNodeIds: interactiveIds,
    actionsPerStep: personality === 'aggressive' ? 2 : 1,
    lookaheadHorizon: 2,
    discount: 0.65,
    shapingEnabled: true
  }
}
export function stepMxSimulation(
  doc: MxDocument,
  prev: MxRuntimeState,
  options: MxRunOptions = {}
): { state: MxRuntimeState; events: MxEvent[] } {
  const params = options.params ?? resolveMxParams(doc)
  const step = prev.step + 1
  const rng = createMxRng((options.seed ?? doc.settings.seed ?? 1) * 7919 + step * 104729)
  const state: MxRuntimeState = {
    step,
    values: { ...prev.values },
    active: { ...prev.active },
    gateCursor: { ...prev.gateCursor },
    buffers: Object.fromEntries(
      Object.entries(prev.buffers).map(([k, v]) => [k, v.map((b) => ({ ...b }))])
    ),
    edgeFlows: {},
    fired: {},
    ended: prev.ended,
    endReason: prev.endReason,
    totalProduced: prev.totalProduced,
    totalConsumed: prev.totalConsumed
  }
  const events: MxEvent[] = []
  if (prev.ended) return { state, events }

  const gIdx = getMxGraphIndex(doc)
  const byId = gIdx.byId
  const outRes = (id: string): MxEdge[] => gIdx.outResByNode.get(id) ?? EMPTY_EDGES
  const inRes = (id: string): MxEdge[] => gIdx.inResByNode.get(id) ?? EMPTY_EDGES
  const orderedInteractions: string[] = [...(options.interactions ?? [])]
  const interactions = new Set(orderedInteractions)

  // 1) 激活状态
  const nowActive: Record<string, boolean> = {}
  for (const n of doc.nodes) {
    nowActive[n.id] = isNodeActive(doc, n, prev, params)
    if (nowActive[n.id] !== prev.active[n.id]) {
      events.push({ step, type: nowActive[n.id] ? 'activate' : 'deactivate', nodeId: n.id })
    }
  }

  const receivedResources = new Set<string>()

  const addTo = (targetId: string, amount: number, edge: MxEdge, depth: number): number => {
    if (amount <= 0) return 0
    const target = byId.get(targetId)
    if (!target) return 0
    switch (target.kind) {
      case 'pool': {
        const room = capOf(target, doc, state) - (state.values[target.id] ?? 0)
        const accepted = Math.max(0, Math.min(room, amount))
        state.values[target.id] =
          Math.round(((state.values[target.id] ?? 0) + accepted) * 1000) / 1000
        if (accepted > 0) receivedResources.add(target.id)
        if (target.overflow === 'drain' && amount > accepted) {
          const spilled = Math.round((amount - accepted) * 1000) / 1000
          state.totalConsumed += spilled
          events.push({
            step,
            type: 'consume',
            nodeId: target.id,
            edgeId: edge.id,
            amount: spilled,
            detail: 'overflow'
          })
          return amount
        }
        return accepted
      }
      case 'drain':
        state.totalConsumed += amount
        events.push({ step, type: 'consume', nodeId: target.id, edgeId: edge.id, amount })
        receivedResources.add(target.id)
        return amount
      case 'gate':
        if (!nowActive[target.id]) return 0
        receivedResources.add(target.id)
        distributeGate(target, amount, depth + 1)
        return amount
      case 'delay':
      case 'queue': {
        const baseWait = target.delaySteps ?? 1
        const wait = Math.max(
          0,
          Math.round(baseWait + modifierBonus(doc, target.id, state, baseWait))
        )
        state.buffers[target.id] ??= []
        state.buffers[target.id]!.push({ release: step + wait, amount })
        state.values[target.id] = (state.values[target.id] ?? 0) + amount
        receivedResources.add(target.id)
        return amount
      }
      case 'converter':
      case 'trader':
        state.values[target.id] = (state.values[target.id] ?? 0) + amount
        receivedResources.add(target.id)
        return amount
      case 'end':
      case 'register':
      case 'source':
      case 'note':
      default:
        return amount
    }
  }

  const sendAlong = (edge: MxEdge, amount: number, depth = 0): number => {
    if (amount <= 0 || depth > 8) return 0
    const moved = addTo(edge.to, amount, edge, depth)
    if (moved > 0) {
      state.edgeFlows[edge.id] = (state.edgeFlows[edge.id] ?? 0) + moved
      events.push({
        step,
        type: 'transfer',
        nodeId: edge.from,
        targetId: edge.to,
        edgeId: edge.id,
        amount: moved,
        resourceId: edge.resourceId
      })
    }
    return moved
  }

  function distributeGate(gate: MxNode, amount: number, depth: number): void {
    const outs = outRes(gate.id)
    if (!outs.length) return
    state.fired[gate.id] = true
    const vars = buildVars(doc, state.values, params, step)
    const weights = outs.map((e) => {
      const f = parseMxFlowFormula(e.formula)
      if (f.type === 'expr' && f.probability != null) return f.probability * 100
      if (f.type === 'all') return 1
      return Math.max(0, evaluateMxExpression(f.expr, { vars, rng }, 1))
    })
    // 状态修改量加在第一条输出（保底类设计）
    weights[0] = Math.max(
      0,
      (weights[0] ?? 0) + modifierBonus(doc, gate.id, state, weights[0] ?? 0)
    )
    const usesPercent = outs.some((e) => {
      const f = parseMxFlowFormula(e.formula)
      return f.type === 'expr' && f.probability != null
    })
    const units = Math.max(1, Math.round(amount))
    const perUnit = amount / units
    for (let u = 0; u < units; u++) {
      let idx = -1
      if (gate.gateMode === 'deterministic') {
        const total = weights.reduce((a, b) => a + b, 0) || outs.length
        const cursor = (state.gateCursor[gate.id] ?? 0) % Math.max(1, Math.round(total))
        state.gateCursor[gate.id] = cursor + 1
        let acc = 0
        for (let i = 0; i < weights.length; i++) {
          acc += weights[i] || (total === outs.length ? 1 : 0)
          if (cursor < acc) {
            idx = i
            break
          }
        }
      } else {
        const total = usesPercent
          ? Math.max(
              100,
              weights.reduce((a, b) => a + b, 0)
            )
          : weights.reduce((a, b) => a + b, 0)
        const roll = rng() * (total || 1)
        let acc = 0
        for (let i = 0; i < weights.length; i++) {
          acc += weights[i]!
          if (roll < acc) {
            idx = i
            break
          }
        }
      }
      if (idx < 0) continue
      const edge = outs[idx]!
      sendAlong(edge, perUnit, depth)
      // 第一条分支命中且有状态修改量时，把源 Pool 归零（保底重置语义）
      if (
        idx === 0 &&
        stateInputs(doc, gate.id).some((s) => parseMxStateFormula(s.formula).type === 'modifier')
      ) {
        for (const s of stateInputs(doc, gate.id)) {
          const srcNode = byId.get(s.from)
          if (srcNode?.kind === 'pool' && parseMxStateFormula(s.formula).type === 'modifier') {
            state.values[srcNode.id] = 0
          }
        }
      }
    }
  }

  /** 按拉取模式从输入 Pool / 被动 Source 拉资源。返回是否成功（pull_all 要求全部满足） */
  const pullInputs = (
    node: MxNode,
    mode: 'any' | 'all',
    times = 1
  ): { ok: boolean; pulled: number } => {
    const ins = inRes(node.id).filter((e) => {
      if (!node.ignoreDisabledInputs) return true
      return nowActive[e.from] !== false
    })
    if (!ins.length) return { ok: node.kind === 'pool' || node.kind === 'drain', pulled: 0 }
    const req = ins.map((e) => {
      const src = byId.get(e.from)
      const isPassiveSource =
        src?.kind === 'source' && src.trigger !== 'automatic' && !state.fired[src.id]
      const avail = isPassiveSource
        ? nowActive[src.id]
          ? Number.POSITIVE_INFINITY
          : 0
        : src?.kind === 'pool' || src?.kind === 'converter' || src?.kind === 'trader'
          ? (state.values[e.from] ?? 0)
          : 0
      return {
        e,
        src,
        isPassiveSource,
        avail,
        amount: evalFlowAmount(doc, e, state, params, rng, avail) * times
      }
    })
    // 自动 Source 作为输入：由 Source 自己推送；但在 pull_all 下若该自动 Source 未推送足够数量，则视为不满足
    const pushedSourceReqs = req.filter(
      (r) => r.src && r.src.kind === 'source' && !r.isPassiveSource
    )
    if (
      mode === 'all' &&
      pushedSourceReqs.some((r) => (state.edgeFlows[r.e.id] ?? 0) + 1e-9 < r.amount)
    ) {
      return { ok: false, pulled: 0 }
    }
    const pullableReqs = req.filter((r) => r.src && (r.src.kind !== 'source' || r.isPassiveSource))
    if (mode === 'all' && pullableReqs.some((r) => r.avail + 1e-9 < r.amount)) {
      return { ok: false, pulled: 0 }
    }
    let pulled = 0
    for (const r of pullableReqs) {
      const take = Math.min(r.avail, r.amount)
      if (take <= 0) continue
      if (r.isPassiveSource) {
        state.totalProduced += take
        events.push({
          step,
          type: 'produce',
          nodeId: r.e.from,
          edgeId: r.e.id,
          amount: take,
          resourceId: r.src?.resourceId
        })
      } else {
        state.values[r.e.from] = Math.round(((state.values[r.e.from] ?? 0) - take) * 1000) / 1000
      }
      state.edgeFlows[r.e.id] = (state.edgeFlows[r.e.id] ?? 0) + take
      pulled += take
      if (node.kind === 'pool') {
        const room = capOf(node, doc, state) - (state.values[node.id] ?? 0)
        const accepted = Math.min(room, take)
        state.values[node.id] = (state.values[node.id] ?? 0) + accepted
        if (accepted < take && !r.isPassiveSource) {
          state.values[r.e.from] = (state.values[r.e.from] ?? 0) + (take - accepted)
        }
      } else if (node.kind === 'drain') {
        state.totalConsumed += take
      }
      events.push({
        step,
        type: node.kind === 'drain' ? 'consume' : 'transfer',
        nodeId: r.e.from,
        targetId: node.id,
        edgeId: r.e.id,
        amount: take
      })
    }
    return { ok: pullableReqs.length === 0 || pulled > 0 || mode === 'all', pulled }
  }

  const fireNode = (node: MxNode): boolean => {
    if (!nowActive[node.id] && node.kind !== 'end') return false
    state.fired[node.id] = true
    switch (node.kind) {
      case 'source': {
        let any = false
        for (const e of outRes(node.id)) {
          const amt = evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY)
          if (amt <= 0) continue
          state.totalProduced += amt
          events.push({
            step,
            type: 'produce',
            nodeId: node.id,
            edgeId: e.id,
            amount: amt,
            resourceId: node.resourceId
          })
          if (sendAlong(e, amt) > 0) any = true
        }
        return any
      }
      case 'pool': {
        const mode = node.pullMode ?? 'pull_any'
        if (mode === 'push_any' || mode === 'push_all') {
          const outs = outRes(node.id)
          const req = outs.map((e) => ({
            e,
            amount: evalFlowAmount(doc, e, state, params, rng, state.values[node.id] ?? 0)
          }))
          const total = req.reduce((a, r) => a + r.amount, 0)
          if (mode === 'push_all' && total > (state.values[node.id] ?? 0) + 1e-9) return false
          let moved = 0
          for (const r of req) {
            const take = Math.min(state.values[node.id] ?? 0, r.amount)
            if (take <= 0) continue
            state.values[node.id] = (state.values[node.id] ?? 0) - take
            const accepted = sendAlong(r.e, take)
            if (accepted < take)
              state.values[node.id] = (state.values[node.id] ?? 0) + (take - accepted)
            moved += accepted
          }
          return moved > 0
        }
        return pullInputs(node, mode === 'pull_all' ? 'all' : 'any').pulled > 0
      }
      case 'drain': {
        const mode = node.pullMode === 'pull_all' ? 'all' : 'any'
        return pullInputs(node, mode).pulled > 0
      }
      case 'converter':
      case 'trader': {
        const multiple = node.conversion === 'multiple'
        let times = 0
        const maxTimes = multiple ? 50 : 1
        for (let k = 0; k < maxTimes; k++) {
          // 先用缓冲中被推入的资源
          const ins = inRes(node.id)
          const req = ins.map((e) =>
            evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY)
          )
          const needTotal = req.reduce((a, b) => a + b, 0)
          const buffered = state.values[node.id] ?? 0
          if (buffered + 1e-9 >= needTotal && needTotal > 0) {
            state.values[node.id] = buffered - needTotal
          } else {
            const res = pullInputs(node, node.pullMode === 'pull_any' ? 'any' : 'all')
            if (
              !res.ok ||
              (res.pulled <= 0 && ins.some((e) => byId.get(e.from)?.kind !== 'source'))
            )
              break
            state.values[node.id] = 0
          }
          times++
          for (const e of outRes(node.id)) {
            const amt = evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY)
            if (amt <= 0) continue
            events.push({
              step,
              type: node.kind === 'trader' ? 'trade' : 'convert',
              nodeId: node.id,
              edgeId: e.id,
              amount: amt,
              resourceId: node.resourceId ?? e.resourceId
            })
            sendAlong(e, amt)
          }
        }
        if (times === 0) {
          events.push({ step, type: 'blocked', nodeId: node.id })
          return false
        }
        return true
      }
      case 'gate': {
        // 自动 Gate：从输入 Pool 拉取后分流
        const res = pullInputs(node, 'any')
        if (res.pulled > 0) distributeGate(node, res.pulled, 0)
        return res.pulled > 0
      }
      case 'register':
        if (node.trigger === 'interactive' && !node.formula?.trim()) {
          state.values[node.id] = (state.values[node.id] ?? 0) + 1
          if (node.max != null) state.values[node.id] = Math.min(node.max, state.values[node.id]!)
          events.push({ step, type: 'register', nodeId: node.id, amount: state.values[node.id] })
        }
        return true
      default:
        return false
    }
  }

  // 2) Delay / Queue 释放
  for (const n of gIdx.delaysAndQueues) {
    const buf = state.buffers[n.id] ?? []
    const outs = outRes(n.id)
    if (!outs.length) continue
    if (n.kind === 'delay') {
      const due = buf.filter((b) => b.release <= step)
      state.buffers[n.id] = buf.filter((b) => b.release > step)
      for (const d of due) {
        state.values[n.id] = Math.max(0, (state.values[n.id] ?? 0) - d.amount)
        events.push({ step, type: 'release', nodeId: n.id, amount: d.amount })
        for (const e of outs) sendAlong(e, d.amount)
      }
    } else {
      const head = buf[0]
      if (head && head.release <= step) {
        const unit = Math.min(1, head.amount)
        head.amount -= unit
        if (head.amount <= 1e-9) buf.shift()
        state.values[n.id] = Math.max(0, (state.values[n.id] ?? 0) - unit)
        // 队列中的下一个从现在开始等待
        if (buf[0])
          buf[0].release = Math.max(
            buf[0].release,
            step + Math.max(1, Math.round(n.delaySteps ?? 1))
          )
        events.push({ step, type: 'release', nodeId: n.id, amount: unit })
        for (const e of outs) sendAlong(e, unit)
      }
    }
  }

  // 3) 决定本步触发的节点（支持 simultaneous 与 turn_based 两种步进模式 + Artificial Agents 效用智能体 + Player AI Bot 自动触发）
  let agentControlledIds = new Set<string>()
  if (!options.skipAgents && doc.agents && doc.agents.some((a) => a.enabled)) {
    const agentRes = selectMxAgentActions(
      doc,
      prev,
      nowActive,
      params,
      rng,
      options.seed ?? doc.settings.seed ?? 1
    )
    agentControlledIds = agentRes.agentControlledIds
    for (const act of agentRes.chosenActions) {
      orderedInteractions.push(act.nodeId)
      interactions.add(act.nodeId)
      events.push({
        step,
        type: 'trigger',
        nodeId: act.nodeId,
        detail: `Agent[${act.agent.name}] ΔU=${act.utilityDelta >= 0 ? '+' : ''}${act.utilityDelta}`
      })
    }
  }

  const autoCandidates: MxNode[] = []
  const immediateFiring: MxNode[] = []
  for (const id of orderedInteractions) {
    const clickedNode = byId.get(id)
    if (clickedNode) immediateFiring.push(clickedNode)
  }
  const order: MxNodeKind[] = ['source', 'pool', 'gate', 'converter', 'trader', 'drain', 'register']
  const globalBot = doc.settings.botMode ?? 'off'
  let botVars: Record<string, number> | null = null

  for (const kind of order) {
    const kNodes = gIdx.nodesByKind.get(kind) ?? []
    for (const n of kNodes) {
      const auto = n.trigger === 'automatic'
      const clicked = interactions.has(n.id)
      const enabling = n.trigger === 'enabling' && nowActive[n.id] && !prev.active[n.id]
      if (clicked) {
        // 已按 orderedInteractions 顺序压入 immediateFiring（支持步内连击与多次点击）
        continue
      } else if (enabling) {
        immediateFiring.push(n)
      } else if (auto) {
        autoCandidates.push(n)
      } else if (n.trigger === 'interactive' && !agentControlledIds.has(n.id)) {
        const effPolicy =
          n.botPolicy && n.botPolicy !== 'inherit'
            ? n.botPolicy
            : globalBot === 'greedy'
              ? 'greedy'
              : globalBot === 'smart'
                ? n.botCondition?.trim()
                  ? 'condition'
                  : 'greedy'
                : 'off'
        if (effPolicy === 'greedy') {
          autoCandidates.push(n)
        } else if (effPolicy === 'probabilistic') {
          const rawProb = n.botProbability ?? 50
          const p = rawProb > 1 ? rawProb / 100 : rawProb
          if (rng() < Math.max(0, Math.min(1, p))) autoCandidates.push(n)
        } else if (effPolicy === 'condition') {
          if (!botVars) botVars = buildVars(doc, state.values, params, step)
          const condExpr = n.botCondition?.trim() || '1'
          if (evaluateMxExpression(condExpr, { vars: botVars, rng }, 0) !== 0) {
            autoCandidates.push(n)
          }
        }
      }
    }
  }
  const firing: MxNode[] = [...immediateFiring]
  if (doc.settings.actionMode === 'turn_based' && autoCandidates.length > 0) {
    const turnNode = autoCandidates[(step - 1) % autoCandidates.length]
    if (turnNode) firing.push(turnNode)
  } else {
    firing.push(...autoCandidates)
  }

  const fireSingleResourceEdge = (resEdge: MxEdge): boolean => {
    const srcNode = byId.get(resEdge.from)
    if (!srcNode || !nowActive[srcNode.id]) return false
    if (srcNode.kind === 'source') {
      const amt = evalFlowAmount(doc, resEdge, state, params, rng, Number.POSITIVE_INFINITY)
      if (amt <= 0) return false
      state.totalProduced += amt
      events.push({
        step,
        type: 'produce',
        nodeId: srcNode.id,
        edgeId: resEdge.id,
        amount: amt,
        resourceId: srcNode.resourceId
      })
      return sendAlong(resEdge, amt) > 0
    }
    const avail = state.values[srcNode.id] ?? 0
    const amt = Math.min(avail, evalFlowAmount(doc, resEdge, state, params, rng, avail))
    if (amt <= 0) return false
    state.values[srcNode.id] = Math.round((avail - amt) * 1000) / 1000
    const moved = sendAlong(resEdge, amt)
    if (moved < amt)
      state.values[srcNode.id] =
        Math.round(((state.values[srcNode.id] ?? 0) + (amt - moved)) * 1000) / 1000
    return moved > 0
  }

  const triggered = new Set<string>()
  const triggeredEdges = new Set<string>()
  const propagateStateTriggersFrom = (sourceNodeId: string, ok: boolean, next: MxNode[]): void => {
    const outStates = gIdx.stateOutByNode.get(sourceNodeId) ?? EMPTY_EDGES
    for (const e of outStates) {
      const spec = parseMxStateFormula(e.formula)
      const fireIt = (spec.type === 'trigger' && ok) || (spec.type === 'reverse_trigger' && !ok)
      if (!fireIt) continue
      if (e.targetEdgeId) {
        if (triggeredEdges.has(e.targetEdgeId)) continue
        const targetEdge = gIdx.resEdgeById.get(e.targetEdgeId)
        if (!targetEdge) continue
        triggeredEdges.add(targetEdge.id)
        events.push({
          step,
          type: 'trigger',
          nodeId: sourceNodeId,
          targetId: targetEdge.to,
          edgeId: e.id
        })
        fireSingleResourceEdge(targetEdge)
        continue
      }
      const target = byId.get(e.to)
      if (!target || triggered.has(target.id)) continue
      triggered.add(target.id)
      events.push({
        step,
        type: 'trigger',
        nodeId: sourceNodeId,
        targetId: target.id,
        edgeId: e.id
      })
      next.push(target)
    }
  }

  const processedPassiveReceivers = new Set<string>()
  const runWave = (nodes: MxNode[], wave: number): void => {
    const next: MxNode[] = []
    for (const n of nodes) {
      const ok = fireNode(n)
      propagateStateTriggersFrom(n.id, ok, next)
    }
    // 被动接收了资源的 Pool / Gate / Converter / Trader 若满足条件，也在同波次执行与向后级联触发
    for (const recId of Array.from(receivedResources)) {
      if (processedPassiveReceivers.has(recId)) continue
      processedPassiveReceivers.add(recId)
      const recNode = byId.get(recId)
      if (recNode && recNode.trigger === 'passive') {
        if (recNode.kind === 'converter' || recNode.kind === 'trader') {
          const ins = inRes(recNode.id)
          const needTotal = ins.reduce(
            (acc, e) => acc + evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY),
            0
          )
          if (needTotal > 0 && (state.values[recNode.id] ?? 0) + 1e-9 >= needTotal) {
            const ok = fireNode(recNode)
            propagateStateTriggersFrom(recId, ok, next)
          }
        } else {
          propagateStateTriggersFrom(recId, true, next)
        }
      }
    }
    if (next.length && wave < 5) runWave(next, wave + 1)
  }
  runWave(firing, 0)

  // 4) 寄存器、激活、终止条件
  recomputeRegisters(doc, state, params, rng)
  state.active = nowActive
  let endSharedVars: Record<string, number> | null = null
  for (const n of gIdx.endNodes) {
    if (!endSharedVars) endSharedVars = buildVars(doc, state.values, params, step)
    const vars = { ...endSharedVars }
    let hit = false
    const inputs = stateInputs(doc, n.id)
    if (n.formula?.trim()) {
      const letters = 'abcdefgh'
      inputs.forEach((e, idx) => {
        if (idx < letters.length) vars[letters[idx]!] = state.values[e.from] ?? 0
      })
      const stSpec = parseMxStateFormula(n.formula)
      if (stSpec.type === 'activator' || stSpec.type === 'range') {
        const firstInputVal = inputs.length ? (state.values[inputs[0]!.from] ?? 0) : 0
        hit = checkActivator(stSpec, firstInputVal, vars, rng) === true
      } else {
        hit = evaluateMxExpression(n.formula, { vars, rng }, 0) !== 0
      }
    } else if (inputs.length) {
      hit = inputs.every((e) => {
        const res = checkActivator(
          parseMxStateFormula(e.formula),
          state.values[e.from] ?? 0,
          vars,
          rng
        )
        return res === true
      })
    }
    // 资源流入 End 节点也视为触发
    if (!hit && inRes(n.id).some((e) => (state.edgeFlows[e.id] ?? 0) > 0)) hit = true
    if (hit) {
      state.ended = true
      state.endReason = n.label || n.id
      events.push({ step, type: 'end', nodeId: n.id })
      break
    }
  }

  return { state, events }
}

// ───────────────────────────── 运行与预测 ─────────────────────────────

export interface MxRunResult {
  id: string
  name: string
  createdAt: string
  seed: number
  scenarioId?: string
  stepsRequested: number
  stepsRun: number
  ended: boolean
  endReason?: string
  /** snapshots[k] = 第 k 步结束时的节点数值（k=0 为初始） */
  snapshots: Array<Record<string, number>>
  edgeFlows: Array<Record<string, number>>
  events: MxEvent[]
  totalProduced: number
  totalConsumed: number
}

export function runMxSimulation(
  doc: MxDocument,
  options: {
    steps?: number
    seed?: number
    scenarioId?: string
    params?: Record<string, number>
    name?: string
    interactionsByStep?: Record<number, string[]>
  } = {}
): MxRunResult {
  const steps = Math.max(1, Math.min(2000, Math.round(options.steps ?? doc.settings.steps ?? 20)))
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 1)
  const params = options.params ?? resolveMxParams(doc, options.scenarioId)
  let state = createMxInitialState(doc, { params })
  const snapshots: Array<Record<string, number>> = [{ ...state.values }]
  const edgeFlows: Array<Record<string, number>> = [{}]
  const events: MxEvent[] = []
  for (let k = 1; k <= steps; k++) {
    const res = stepMxSimulation(doc, state, {
      seed,
      params,
      interactions: options.interactionsByStep?.[k]
    })
    state = res.state
    snapshots.push({ ...state.values })
    edgeFlows.push({ ...state.edgeFlows })
    events.push(...res.events)
    if (state.ended) break
  }
  return {
    id: `run_${seed}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: options.name ?? 'Play',
    createdAt: new Date().toISOString(),
    seed,
    scenarioId: options.scenarioId,
    stepsRequested: steps,
    stepsRun: snapshots.length - 1,
    ended: state.ended,
    endReason: state.endReason,
    snapshots,
    edgeFlows,
    events,
    totalProduced: Math.round(state.totalProduced * 100) / 100,
    totalConsumed: Math.round(state.totalConsumed * 100) / 100
  }
}

export function mxTrackedNodes(doc: MxDocument): MxNode[] {
  return doc.nodes.filter((n) =>
    n.tracked != null ? n.tracked : n.kind === 'pool' || n.kind === 'register'
  )
}

export function mxSeriesFromRun(run: MxRunResult, nodeId: string): number[] {
  return run.snapshots.map((s) => s[nodeId] ?? 0)
}

/**
 * 多 Agent 画像竞技场（Multi-Agent Persona Arena）：
 * 针对当前图中的每个 Agent 画像（分别单独启用，使用相同随机种子与初始环境）独立运行一次完整模拟，
 * 返回每个画像的 MxRunResult 列表，可直接叠加到底部 Results 图表的 Compare 模式对比不同玩家流派的曲线差异。
 */
export function runMxAgentArena(
  doc: MxDocument,
  options: { steps?: number; seed?: number; scenarioId?: string } = {}
): MxRunResult[] {
  const agents = doc.agents ?? []
  if (!agents.length) return []
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 1)
  const steps = Math.max(1, Math.min(2000, Math.round(options.steps ?? doc.settings.steps ?? 20)))

  const results: MxRunResult[] = []
  for (const targetAgent of agents) {
    const isolatedDoc: MxDocument = {
      ...doc,
      agents: agents.map((a) => ({
        ...a,
        // 在独立竞技场回合中，允许该 Agent 接管图中所有 Interactive 节点（除非已显式指定受控子集）
        enabled: a.id === targetAgent.id
      }))
    }
    const run = runMxSimulation(isolatedDoc, {
      steps,
      seed,
      scenarioId: options.scenarioId,
      name: `🤖 ${targetAgent.name}`
    })
    results.push(run)
  }
  return results
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return Math.round(sorted[idx]! * 100) / 100
}

export interface MxForecastSeries {
  nodeId: string
  label: string
  color: string
  p10: number[]
  p50: number[]
  p90: number[]
  mean: number[]
  finalValues: number[]
  histogram: Array<{ lo: number; hi: number; count: number }>
}

export interface MxForecastResult {
  runs: number
  steps: number
  seed: number
  scenarioId?: string
  series: MxForecastSeries[]
  endHitRate: number
  endStepP50: number | null
  endReasons: Record<string, number>
  sourceSinkRatio: number
}

export function runMxForecast(
  doc: MxDocument,
  options: { runs?: number; steps?: number; seed?: number; scenarioId?: string } = {}
): MxForecastResult {
  const runs = Math.max(1, Math.min(1000, Math.round(options.runs ?? doc.settings.runs ?? 50)))
  const steps = Math.max(1, Math.min(500, Math.round(options.steps ?? doc.settings.steps ?? 20)))
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 1)
  const tracked = mxTrackedNodes(doc)
  const params = resolveMxParams(doc, options.scenarioId)
  const matrix = tracked.map(() => Array.from({ length: steps + 1 }, () => [] as number[]))
  const endSteps: number[] = []
  const endReasons: Record<string, number> = {}
  let produced = 0
  let consumed = 0
  for (let r = 0; r < runs; r++) {
    const run = runMxSimulation(doc, { steps, seed: seed + r * 7919, params })
    produced += run.totalProduced
    consumed += run.totalConsumed
    if (run.ended) {
      endSteps.push(run.stepsRun)
      const key = run.endReason ?? 'end'
      endReasons[key] = (endReasons[key] ?? 0) + 1
    }
    tracked.forEach((n, i) => {
      for (let k = 0; k <= steps; k++) {
        const snap = run.snapshots[Math.min(k, run.snapshots.length - 1)]!
        matrix[i]![k]!.push(snap[n.id] ?? 0)
      }
    })
  }
  const palette = [
    '#2563eb',
    '#dc2626',
    '#d97706',
    '#16a34a',
    '#9333ea',
    '#0891b2',
    '#db2777',
    '#4f46e5',
    '#ca8a04',
    '#0d9488',
    '#ea580c'
  ]
  const usedColors = new Set<string>()
  const series: MxForecastSeries[] = tracked.map((n, i) => {
    const p10: number[] = []
    const p50: number[] = []
    const p90: number[] = []
    const mean: number[] = []
    for (let k = 0; k <= steps; k++) {
      const row = [...matrix[i]![k]!].sort((a, b) => a - b)
      p10.push(pct(row, 0.1))
      p50.push(pct(row, 0.5))
      p90.push(pct(row, 0.9))
      mean.push(Math.round((row.reduce((a, b) => a + b, 0) / Math.max(1, row.length)) * 100) / 100)
    }
    const finals = matrix[i]![steps]!
    const lo = Math.min(...finals)
    const hi = Math.max(...finals)
    const bins = 10
    const width = (hi - lo) / bins || 1
    const histogram = Array.from({ length: bins }, (_, b) => ({
      lo: Math.round((lo + b * width) * 100) / 100,
      hi: Math.round((lo + (b + 1) * width) * 100) / 100,
      count: 0
    }))
    for (const v of finals) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)))
      histogram[b]!.count++
    }
    const rawColor = mxNodeColor(doc, n)
    const lowerRaw = (rawColor || '').toLowerCase()
    let chosenColor = rawColor
    if (!chosenColor || usedColors.has(lowerRaw)) {
      chosenColor =
        palette.find((c) => !usedColors.has(c.toLowerCase())) ?? palette[i % palette.length]!
    }
    usedColors.add(chosenColor.toLowerCase())
    return {
      nodeId: n.id,
      label: n.label,
      color: chosenColor,
      p10,
      p50,
      p90,
      mean,
      finalValues: finals,
      histogram
    }
  })
  const sortedEnd = [...endSteps].sort((a, b) => a - b)
  return {
    runs,
    steps,
    seed,
    scenarioId: options.scenarioId,
    series,
    endHitRate: Math.round((endSteps.length / runs) * 1000) / 1000,
    endStepP50: sortedEnd.length ? pct(sortedEnd, 0.5) : null,
    endReasons,
    sourceSinkRatio:
      consumed > 0 ? Math.round((produced / consumed) * 100) / 100 : produced > 0 ? 99 : 1
  }
}

// ───────────────────────────── 趋势摘要 ─────────────────────────────

export type MxTrendPattern =
  'flat' | 'rose' | 'fell' | 'fell_then_rose' | 'rose_then_fell' | 'volatile'

export interface MxTrendSummary {
  initial: number
  final: number
  min: number
  max: number
  minStep: number
  maxStep: number
  changes: number
  avgDelta: number
  avgUp: number
  avgDown: number
  pattern: MxTrendPattern
}

export type MxSeriesSummary = MxTrendSummary

/** 生成节点卡片的趋势数据（UI 侧用 i18n 拼成自然语言） */
export function summarizeMxSeries(values: number[]): MxTrendSummary {
  const n = values.length
  const initial = values[0] ?? 0
  const final = values[n - 1] ?? 0
  let min = initial
  let max = initial
  let minStep = 0
  let maxStep = 0
  let changes = 0
  let upSum = 0
  let downSum = 0
  let ups = 0
  let downs = 0
  for (let i = 1; i < n; i++) {
    const v = values[i]!
    const d = v - values[i - 1]!
    if (Math.abs(d) > 1e-9) {
      changes++
      if (d > 0) {
        upSum += d
        ups++
      } else {
        downSum += -d
        downs++
      }
    }
    if (v < min) {
      min = v
      minStep = i
    }
    if (v > max) {
      max = v
      maxStep = i
    }
  }
  const steps = Math.max(1, n - 1)
  const range = Math.max(1e-9, max - min)
  let pattern: MxTrendPattern = 'flat'
  const minInside = minStep > 0 && minStep < n - 1
  const maxInside = maxStep > 0 && maxStep < n - 1
  if (changes === 0) pattern = 'flat'
  else if (
    minInside &&
    initial - min > range * 0.2 &&
    final - min > range * 0.2 &&
    (!maxInside || minStep < maxStep)
  )
    pattern = 'fell_then_rose'
  else if (maxInside && max - initial > range * 0.2 && max - final > range * 0.2)
    pattern = 'rose_then_fell'
  else if (ups > 0 && downs > 0 && Math.min(ups, downs) / changes > 0.4) pattern = 'volatile'
  else if (final > initial) pattern = 'rose'
  else if (final < initial) pattern = 'fell'
  else pattern = 'volatile'
  const r2 = (v: number): number => Math.round(v * 100) / 100
  return {
    initial: r2(initial),
    final: r2(final),
    min: r2(min),
    max: r2(max),
    minStep,
    maxStep,
    changes,
    avgDelta: r2((final - initial) / steps),
    avgUp: r2(upSum / steps),
    avgDown: r2(downSum / steps),
    pattern
  }
}

// ───────────────────────────── 经济系统健康度与瓶颈诊断 ─────────────────────────────

export type MxDiagnosticSeverity = 'ok' | 'info' | 'warn' | 'critical'
export type MxDiagnosticKind =
  | 'balanced'
  | 'inflation'
  | 'deflation'
  | 'starved_converter'
  | 'pool_capped'
  | 'pool_depleted'
  | 'exponential_runaway'
  | 'idle_node'

export interface MxDiagnosticFinding {
  id: string
  severity: MxDiagnosticSeverity
  kind: MxDiagnosticKind
  nodeId?: string
  nodeLabel?: string
  step?: number
  value?: number
  secondaryValue?: number
}

export interface MxEconomyHealthReport {
  score: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  faucetSinkRatio: number
  netFlowPerStep: number
  blockedCount: number
  cappedPoolsCount: number
  depletedPoolsCount: number
  findings: MxDiagnosticFinding[]
}

/**
 * 深度诊断当前 Machinations 经济图在运行后的数值健康度、瓶颈、爆仓、枯竭与指数失控点。
 */
export function analyzeMxEconomyHealth(
  doc: MxDocument,
  run?: MxRunResult | null
): MxEconomyHealthReport {
  const activeRun = run ?? runMxSimulation(doc)
  const steps = Math.max(1, activeRun.stepsRun)
  const produced = activeRun.totalProduced
  const consumed = activeRun.totalConsumed
  const faucetSinkRatio =
    consumed > 0 ? Math.round((produced / consumed) * 100) / 100 : produced > 0 ? 99 : 1
  const netFlowPerStep = Math.round(((produced - consumed) / steps) * 100) / 100

  const findings: MxDiagnosticFinding[] = []
  let penalty = 0

  // 1) 全局产出回收比诊断 (Inflation / Deflation)
  if (
    produced > 0 &&
    consumed === 0 &&
    doc.nodes.some((n) => n.kind === 'drain' || n.kind === 'converter')
  ) {
    penalty += 18
    findings.push({
      id: 'diag_inflation_nosink',
      severity: 'warn',
      kind: 'inflation',
      value: produced,
      secondaryValue: 0
    })
  } else if (faucetSinkRatio > 2.6 && produced > 15) {
    penalty += 15
    findings.push({
      id: 'diag_inflation_high',
      severity: 'warn',
      kind: 'inflation',
      value: faucetSinkRatio,
      secondaryValue: netFlowPerStep
    })
  } else if (faucetSinkRatio < 0.45 && consumed > 10) {
    penalty += 12
    findings.push({
      id: 'diag_deflation',
      severity: 'info',
      kind: 'deflation',
      value: faucetSinkRatio,
      secondaryValue: netFlowPerStep
    })
  }

  // 2) Converter / Trader 饥饿阻塞检测 (Starved / Blocked Converters)
  const blockedByNode = new Map<string, { count: number; firstStep: number }>()
  for (const ev of activeRun.events) {
    if (ev.type !== 'blocked') continue
    const prev = blockedByNode.get(ev.nodeId)
    if (prev) prev.count++
    else blockedByNode.set(ev.nodeId, { count: 1, firstStep: ev.step })
  }
  let blockedCount = 0
  for (const [nodeId, info] of blockedByNode.entries()) {
    blockedCount += info.count
    const node = doc.nodes.find((n) => n.id === nodeId)
    if (!node) continue
    const blockRatio = Math.round((info.count / steps) * 100)
    if (blockRatio >= 30) {
      penalty += blockRatio >= 75 ? 16 : 8
      findings.push({
        id: `diag_starved_${nodeId}`,
        severity: blockRatio >= 75 ? 'critical' : 'warn',
        kind: 'starved_converter',
        nodeId,
        nodeLabel: node.label || nodeId,
        step: info.firstStep,
        value: info.count,
        secondaryValue: blockRatio
      })
    }
  }

  // 3) Pool 爆仓封顶 / 枯竭归零 / 指数失控检测
  let cappedPoolsCount = 0
  let depletedPoolsCount = 0
  for (const n of doc.nodes) {
    if (n.kind !== 'pool' && n.kind !== 'register') continue
    const series = activeRun.snapshots.map((s) => s[n.id] ?? 0)
    if (series.length < 2) continue
    const sum = summarizeMxSeries(series)

    // 3a) Pool 触及容量上限 (Capacity Bottleneck)
    if (n.kind === 'pool' && n.capacity && n.capacity > 0) {
      const firstCapStep = series.findIndex((v, i) => i > 0 && v >= n.capacity! - 1e-6)
      if (firstCapStep > 0) {
        cappedPoolsCount++
        penalty += 8
        findings.push({
          id: `diag_cap_${n.id}`,
          severity: 'warn',
          kind: 'pool_capped',
          nodeId: n.id,
          nodeLabel: n.label || n.id,
          step: firstCapStep,
          value: n.capacity
        })
      }
    }

    // 3b) Pool 枯竭归零 (Pool Depleted)
    if (n.kind === 'pool' && (sum.initial > 0 || sum.max > 0)) {
      const firstZeroStep = series.findIndex(
        (v, i) => i > 0 && v <= 1e-6 && (series[i - 1] ?? 0) > 1e-6
      )
      if (firstZeroStep > 0) {
        depletedPoolsCount++
        penalty += 6
        findings.push({
          id: `diag_dep_${n.id}`,
          severity: 'info',
          kind: 'pool_depleted',
          nodeId: n.id,
          nodeLabel: n.label || n.id,
          step: firstZeroStep,
          value: sum.max
        })
      }
    }

    // 3c) 后半程增速远超前半程 (Exponential Runaway)
    if (series.length >= 8) {
      const mid = Math.floor(series.length / 2)
      const delta1 = (series[mid]! - series[0]!) / Math.max(1, mid)
      const delta2 =
        (series[series.length - 1]! - series[mid]!) / Math.max(1, series.length - 1 - mid)
      if (delta1 > 0.5 && delta2 > delta1 * 2.5 && sum.final > 30) {
        penalty += 10
        findings.push({
          id: `diag_exp_${n.id}`,
          severity: 'warn',
          kind: 'exponential_runaway',
          nodeId: n.id,
          nodeLabel: n.label || n.id,
          step: mid,
          value: Math.round((delta2 / delta1) * 10) / 10,
          secondaryValue: sum.final
        })
      }
    }

    // 3d) 全程死水无变化 (Idle / Dead Node)
    if (sum.changes === 0 && doc.edges.some((e) => e.from === n.id || e.to === n.id)) {
      penalty += 6
      findings.push({
        id: `diag_idle_${n.id}`,
        severity: 'info',
        kind: 'idle_node',
        nodeId: n.id,
        nodeLabel: n.label || n.id,
        step: 0,
        value: sum.final
      })
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: 'diag_balanced',
      severity: 'ok',
      kind: 'balanced',
      value: faucetSinkRatio,
      secondaryValue: netFlowPerStep
    })
  }

  const score = Math.max(25, Math.min(100, Math.round(100 - penalty)))
  const grade: MxEconomyHealthReport['grade'] =
    score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 68 ? 'B' : score >= 55 ? 'C' : 'D'

  return {
    score,
    grade,
    faucetSinkRatio,
    netFlowPerStep,
    blockedCount,
    cappedPoolsCount,
    depletedPoolsCount,
    findings
  }
}

// ───────────────────────────── 逆向目标求解器 (Goal-Seek) & 参数敏感度扫描 (Parameter Sweep) ─────────────────────────────

export type MxTunableKind = 'param' | 'edge' | 'node_initial'

export interface MxGoalSeekOptions {
  variableKind: MxTunableKind
  /** param.name | edge.id | node.id */
  variableId: string
  minVal: number
  maxVal: number
  goalMetric: 'node_value' | 'end_step'
  goalNodeId?: string
  atStep?: number
  targetValue: number
  samples?: number
  runsPerSample?: number
  seed?: number
}

export interface MxGoalSeekCandidate {
  variableValue: number
  achievedValue: number
  error: number
}

export interface MxGoalSeekResult {
  variableKind: MxTunableKind
  variableId: string
  bestValue: number
  achievedValue: number
  targetValue: number
  error: number
  candidates: MxGoalSeekCandidate[]
}

function applyTunableToDocClone(
  baseDoc: MxDocument,
  variableKind: MxTunableKind,
  variableId: string,
  val: number
): MxDocument {
  const clone: MxDocument = JSON.parse(JSON.stringify(baseDoc))
  const rounded = Math.round(val * 1000) / 1000
  if (variableKind === 'param') {
    const p = clone.params.find((x) => x.name === variableId || x.id === variableId)
    if (p) p.value = rounded
    else clone.params.push({ id: `p_${variableId}`, name: variableId, value: rounded })
    for (const sc of clone.scenarios ?? []) {
      if (variableId in sc.params) sc.params[variableId] = rounded
    }
  } else if (variableKind === 'edge') {
    const e = clone.edges.find((x) => x.id === variableId)
    if (e) {
      e.formula = e.kind === 'state' ? `${rounded >= 0 ? '+' : ''}${rounded}` : String(rounded)
    }
  } else if (variableKind === 'node_initial') {
    const n = clone.nodes.find((x) => x.id === variableId)
    if (n) n.initial = rounded
  }
  return clone
}

/**
 * 逆向目标求解（Goal-Seek / Auto-Balancer）：
 * 在 [minVal, maxVal] 区间内通过粗网格 + 局部加密搜索，自动找出让目标节点在指定步数最接近 targetValue（或在指定步数触发 End）的最优变量值。
 */
export function runMxGoalSeek(doc: MxDocument, options: MxGoalSeekOptions): MxGoalSeekResult {
  const lo = Math.min(options.minVal, options.maxVal)
  const hi = Math.max(options.minVal, options.maxVal)
  const samples = Math.max(5, Math.min(60, Math.round(options.samples ?? 21)))
  const runsPerSample = Math.max(1, Math.min(20, Math.round(options.runsPerSample ?? 3)))
  const atStep = Math.max(1, Math.min(500, Math.round(options.atStep ?? doc.settings.steps ?? 20)))
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 2026)
  const goalNodeId =
    options.goalNodeId ??
    doc.nodes.find((n) => n.kind === 'pool' || n.kind === 'register')?.id ??
    ''

  const evalAt = (val: number): MxGoalSeekCandidate => {
    const v = Math.round(val * 1000) / 1000
    const tunedDoc = applyTunableToDocClone(doc, options.variableKind, options.variableId, v)
    let sum = 0
    for (let r = 0; r < runsPerSample; r++) {
      const run = runMxSimulation(tunedDoc, { steps: atStep, seed: seed + r * 7919 })
      if (options.goalMetric === 'end_step') {
        sum += run.stepsRun
      } else {
        const snap = run.snapshots[Math.min(atStep, run.snapshots.length - 1)] ?? {}
        sum += snap[goalNodeId] ?? 0
      }
    }
    const achieved = Math.round((sum / runsPerSample) * 100) / 100
    const error = Math.round(Math.abs(achieved - options.targetValue) * 100) / 100
    return { variableValue: v, achievedValue: achieved, error }
  }

  // 第一阶段：均匀网格扫描
  const coarse: MxGoalSeekCandidate[] = []
  const span = Math.max(1e-6, hi - lo)
  for (let i = 0; i < samples; i++) {
    const val = lo + (span * i) / Math.max(1, samples - 1)
    coarse.push(evalAt(val))
  }

  let best = coarse.reduce((a, b) => (b.error < a.error ? b : a), coarse[0]!)

  // 第二阶段：在最优值邻域内做 9 点精细插值搜索
  const stepSize = span / Math.max(1, samples - 1)
  const fineLo = Math.max(lo, best.variableValue - stepSize)
  const fineHi = Math.min(hi, best.variableValue + stepSize)
  if (fineHi - fineLo > 1e-5) {
    for (let j = 1; j < 8; j++) {
      const val = fineLo + ((fineHi - fineLo) * j) / 8
      const cand = evalAt(val)
      if (cand.error < best.error) best = cand
    }
  }

  return {
    variableKind: options.variableKind,
    variableId: options.variableId,
    bestValue: best.variableValue,
    achievedValue: best.achievedValue,
    targetValue: options.targetValue,
    error: best.error,
    candidates: coarse
  }
}

export interface MxParamSweepPoint {
  paramValue: number
  nodeFinals: Record<string, number>
  endStep: number
  endedRate: number
  faucetSinkRatio: number
}

export interface MxParamSweepResult {
  variableKind: MxTunableKind
  variableId: string
  minVal: number
  maxVal: number
  points: MxParamSweepPoint[]
}

/**
 * 单变量敏感度扫描（Parameter Sweep / Sensitivity Analysis）：
 * 沿 [minVal, maxVal] 采样 stepsCount 个梯度点，计算各追踪节点的终值与产出回收比响应曲线。
 */
export function runMxParameterSweep(
  doc: MxDocument,
  options: {
    variableKind: MxTunableKind
    variableId: string
    minVal: number
    maxVal: number
    stepsCount?: number
    runsPerPoint?: number
    seed?: number
  }
): MxParamSweepResult {
  const lo = Math.min(options.minVal, options.maxVal)
  const hi = Math.max(options.minVal, options.maxVal)
  const count = Math.max(3, Math.min(25, Math.round(options.stepsCount ?? 9)))
  const runsPerPoint = Math.max(1, Math.min(20, Math.round(options.runsPerPoint ?? 3)))
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 2026)
  const tracked = mxTrackedNodes(doc)
  const points: MxParamSweepPoint[] = []

  for (let i = 0; i < count; i++) {
    const val = Math.round((lo + ((hi - lo) * i) / Math.max(1, count - 1)) * 1000) / 1000
    const tunedDoc = applyTunableToDocClone(doc, options.variableKind, options.variableId, val)
    const totals: Record<string, number> = {}
    for (const n of tracked) totals[n.id] = 0
    let endStepSum = 0
    let endedHits = 0
    let produced = 0
    let consumed = 0
    for (let r = 0; r < runsPerPoint; r++) {
      const run = runMxSimulation(tunedDoc, {
        steps: doc.settings.steps,
        seed: seed + r * 7919
      })
      endStepSum += run.stepsRun
      if (run.ended) endedHits++
      produced += run.totalProduced
      consumed += run.totalConsumed
      const lastSnap = run.snapshots[run.snapshots.length - 1] ?? {}
      for (const n of tracked) {
        totals[n.id] = (totals[n.id] ?? 0) + (lastSnap[n.id] ?? 0)
      }
    }
    const nodeFinals: Record<string, number> = {}
    for (const n of tracked) {
      nodeFinals[n.id] = Math.round(((totals[n.id] ?? 0) / runsPerPoint) * 100) / 100
    }
    points.push({
      paramValue: val,
      nodeFinals,
      endStep: Math.round((endStepSum / runsPerPoint) * 10) / 10,
      endedRate: Math.round((endedHits / runsPerPoint) * 100) / 100,
      faucetSinkRatio:
        consumed > 0 ? Math.round((produced / consumed) * 100) / 100 : produced > 0 ? 99 : 1
    })
  }

  return {
    variableKind: options.variableKind,
    variableId: options.variableId,
    minVal: lo,
    maxVal: hi,
    points
  }
}

export interface Mx2DMatrixCell {
  xVal: number
  yVal: number
  value: number
  faucetSinkRatio: number
  endStep: number
}

export interface Mx2DMatrixOptions {
  varXKind: MxTunableKind
  varXId: string
  minX: number
  maxX: number
  stepsX?: number
  varYKind: MxTunableKind
  varYId: string
  minY: number
  maxY: number
  stepsY?: number
  metric?: 'node_value' | 'end_step' | 'faucet_sink_ratio'
  targetNodeId?: string
  runsPerCell?: number
  seed?: number
}

export interface Mx2DMatrixResult {
  varXKind: MxTunableKind
  varXId: string
  varYKind: MxTunableKind
  varYId: string
  metric: 'node_value' | 'end_step' | 'faucet_sink_ratio'
  targetNodeId?: string
  xValues: number[]
  yValues: number[]
  /** cells[yIdx][xIdx] */
  cells: Mx2DMatrixCell[][]
  minValue: number
  maxValue: number
}

/**
 * 双变量正交参数热力矩阵（2D Parameter Matrix Heatmap）：
 * 在 X 变量 × Y 变量构成的二维网格中批量模拟，计算每个正交组合下的目标池终值、存活步数或通胀比。
 */
export function runMx2DParameterMatrix(
  doc: MxDocument,
  options: Mx2DMatrixOptions
): Mx2DMatrixResult {
  const stepsX = Math.max(2, Math.min(12, Math.round(options.stepsX ?? 6)))
  const stepsY = Math.max(2, Math.min(12, Math.round(options.stepsY ?? 6)))
  const runsPerCell = Math.max(1, Math.min(10, Math.round(options.runsPerCell ?? 2)))
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 2026)
  const metric = options.metric ?? 'node_value'
  const targetNodeId =
    options.targetNodeId ??
    doc.nodes.find((n) => n.kind === 'pool' || n.kind === 'register')?.id ??
    ''

  const loX = Math.min(options.minX, options.maxX)
  const hiX = Math.max(options.minX, options.maxX)
  const loY = Math.min(options.minY, options.maxY)
  const hiY = Math.max(options.minY, options.maxY)

  const xValues: number[] = []
  for (let i = 0; i < stepsX; i++) {
    xValues.push(Math.round((loX + ((hiX - loX) * i) / Math.max(1, stepsX - 1)) * 100) / 100)
  }
  const yValues: number[] = []
  for (let j = 0; j < stepsY; j++) {
    yValues.push(Math.round((loY + ((hiY - loY) * j) / Math.max(1, stepsY - 1)) * 100) / 100)
  }

  const cells: Mx2DMatrixCell[][] = []
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY

  for (let j = 0; j < yValues.length; j++) {
    const yVal = yValues[j]!
    const row: Mx2DMatrixCell[] = []
    for (let i = 0; i < xValues.length; i++) {
      const xVal = xValues[i]!
      const docX = applyTunableToDocClone(doc, options.varXKind, options.varXId, xVal)
      const docXY = applyTunableToDocClone(docX, options.varYKind, options.varYId, yVal)

      let nodeSum = 0
      let endStepSum = 0
      let produced = 0
      let consumed = 0
      for (let r = 0; r < runsPerCell; r++) {
        const run = runMxSimulation(docXY, {
          steps: doc.settings.steps,
          seed: seed + r * 7919
        })
        endStepSum += run.stepsRun
        produced += run.totalProduced
        consumed += run.totalConsumed
        const lastSnap = run.snapshots[run.snapshots.length - 1] ?? {}
        nodeSum += lastSnap[targetNodeId] ?? 0
      }
      const avgNode = Math.round((nodeSum / runsPerCell) * 100) / 100
      const avgEndStep = Math.round((endStepSum / runsPerCell) * 10) / 10
      const fsRatio =
        consumed > 0 ? Math.round((produced / consumed) * 100) / 100 : produced > 0 ? 99 : 1
      const val =
        metric === 'end_step' ? avgEndStep : metric === 'faucet_sink_ratio' ? fsRatio : avgNode
      if (val < minValue) minValue = val
      if (val > maxValue) maxValue = val
      row.push({
        xVal,
        yVal,
        value: val,
        faucetSinkRatio: fsRatio,
        endStep: avgEndStep
      })
    }
    cells.push(row)
  }

  if (!Number.isFinite(minValue)) minValue = 0
  if (!Number.isFinite(maxValue)) maxValue = 0

  return {
    varXKind: options.varXKind,
    varXId: options.varXId,
    varYKind: options.varYKind,
    varYId: options.varYId,
    metric,
    targetNodeId,
    xValues,
    yValues,
    cells,
    minValue,
    maxValue
  }
}

// ───────────────────────────── 文档工具 ─────────────────────────────

export const MX_DEFAULT_COLORS: Record<MxNodeKind, string> = {
  source: '#f59e0b',
  drain: '#ef4444',
  pool: '#3b82f6',
  gate: '#ec4899',
  trader: '#14b8a6',
  converter: '#8b5cf6',
  register: '#a855f7',
  delay: '#64748b',
  queue: '#64748b',
  end: '#6b7280',
  note: '#facc15'
}

export function mxNodeColor(doc: MxDocument, node: MxNode): string {
  if (node.color) return node.color
  const res = doc.resources.find((r) => r.id === node.resourceId)
  return res?.color ?? MX_DEFAULT_COLORS[node.kind]
}

export function createEmptyMxDocument(title = 'Untitled economy'): MxDocument {
  return {
    schema: 'mx@2',
    title,
    resources: [{ id: 'res_default', name: 'Resource', color: '#3b82f6' }],
    params: [],
    scenarios: [],
    layers: [{ id: 'layer_base', name: 'Base', visible: true, locked: false }],
    nodes: [],
    edges: [],
    groups: [],
    agents: [],
    clips: [],
    history: [],
    settings: { steps: 20, runs: 50, seed: 2026, speed: 1 }
  }
}

let idCounter = 0
export function mxNewId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function createMxNode(kind: MxNodeKind, x: number, y: number, label?: string): MxNode {
  const base: MxNode = {
    id: mxNewId(kind),
    kind,
    label: label ?? kind.charAt(0).toUpperCase() + kind.slice(1),
    x: Math.round(x),
    y: Math.round(y),
    trigger: kind === 'source' ? 'automatic' : 'passive'
  }
  if (kind === 'pool') {
    base.initial = 0
    base.pullMode = 'pull_any'
  }
  if (kind === 'converter' || kind === 'trader') {
    base.pullMode = 'pull_all'
    base.conversion = 'single'
    base.trigger = 'automatic'
  }
  if (kind === 'drain') base.pullMode = 'pull_any'
  if (kind === 'gate') base.gateMode = 'random'
  if (kind === 'delay' || kind === 'queue') base.delaySteps = 2
  if (kind === 'register') base.formula = ''
  if (kind === 'note') {
    base.text = 'Note'
    base.width = 160
    base.height = 80
  }
  return base
}

/** 规范化任意输入为合法 MxDocument（容错：缺字段补默认，兼容 AI 生成的常见字段别名，非法节点剔除） */
export function normalizeMxDocument(raw: unknown): MxDocument {
  const base = createEmptyMxDocument()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<MxDocument>
  const kinds: MxNodeKind[] = [
    'source',
    'drain',
    'pool',
    'gate',
    'trader',
    'converter',
    'register',
    'delay',
    'queue',
    'end',
    'note'
  ]
  const kindAliasMap: Record<string, MxNodeKind> = {
    end_condition: 'end',
    endcondition: 'end',
    faucet: 'source',
    sink: 'drain',
    storage: 'pool',
    stock: 'pool',
    craft: 'converter',
    exchange: 'trader',
    shop: 'trader',
    calc: 'register',
    formula: 'register'
  }
  const triggerAliasMap: Record<string, MxTrigger> = {
    on_start: 'enabling',
    onstart: 'enabling',
    auto: 'automatic',
    click: 'interactive',
    manual: 'interactive',
    user: 'interactive',
    player: 'interactive'
  }
  const nodes = (Array.isArray(r.nodes) ? r.nodes : [])
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null
      const n = item as Record<string, any>
      const rawKind = String(n.kind ?? n.type ?? '')
        .toLowerCase()
        .trim()
      const resolvedKind = (
        kinds.includes(rawKind as MxNodeKind) ? rawKind : kindAliasMap[rawKind]
      ) as MxNodeKind | undefined
      if (!resolvedKind) return null
      const id =
        typeof n.id === 'string' && n.id.trim() ? n.id.trim() : `${resolvedKind}_${idx + 1}`
      const rawTrig = String(n.trigger ?? n.activation ?? '')
        .toLowerCase()
        .trim()
      const explicitTrig = (
        ['passive', 'automatic', 'interactive', 'enabling'] as MxTrigger[]
      ).includes(rawTrig as MxTrigger)
        ? (rawTrig as MxTrigger)
        : triggerAliasMap[rawTrig]
      const defaultTrig: MxTrigger =
        resolvedKind === 'source' ||
        resolvedKind === 'converter' ||
        resolvedKind === 'trader' ||
        resolvedKind === 'drain'
          ? 'automatic'
          : 'passive'
      const initialVal = Number.isFinite(n.initial)
        ? Number(n.initial)
        : Number.isFinite(n.initialValue)
          ? Number(n.initialValue)
          : Number.isFinite(n.value)
            ? Number(n.value)
            : resolvedKind === 'pool'
              ? 0
              : undefined
      const capVal = Number.isFinite(n.capacity)
        ? Number(n.capacity)
        : Number.isFinite(n.maxCapacity)
          ? Number(n.maxCapacity)
          : undefined
      const rawGateMode = String(n.gateMode ?? '')
        .toLowerCase()
        .trim()
      const gateMode =
        rawGateMode === 'deterministic'
          ? 'deterministic'
          : rawGateMode === 'skill'
            ? 'skill'
            : rawGateMode === 'random' || rawGateMode === 'dice' || resolvedKind === 'gate'
              ? 'random'
              : undefined
      const defaultPullMode =
        resolvedKind === 'converter' || resolvedKind === 'trader'
          ? 'pull_all'
          : resolvedKind === 'pool' || resolvedKind === 'drain'
            ? 'pull_any'
            : undefined
      return {
        ...(n as unknown as MxNode),
        id,
        kind: resolvedKind,
        label: String(n.label ?? n.name ?? n.title ?? id),
        x: Number.isFinite(n.x) ? Number(n.x) : 0,
        y: Number.isFinite(n.y) ? Number(n.y) : 0,
        trigger: explicitTrig ?? defaultTrig,
        ...(initialVal !== undefined ? { initial: initialVal } : {}),
        ...(capVal !== undefined ? { capacity: capVal } : {}),
        ...(gateMode ? { gateMode } : {}),
        ...(n.pullMode
          ? { pullMode: n.pullMode }
          : defaultPullMode
            ? { pullMode: defaultPullMode }
            : {}),
        ...(resolvedKind === 'converter' || resolvedKind === 'trader'
          ? { conversion: n.conversion === 'multiple' ? 'multiple' : 'single' }
          : {})
      } as MxNode
    })
    .filter((n): n is MxNode => n !== null)
  const ids = new Set(nodes.map((n) => n.id))
  const rawEdges = Array.isArray(r.edges) ? r.edges : []
  const normalizedRawEdges = rawEdges
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null
      const e = item as Record<string, any>
      const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `e_${idx + 1}`
      const from = String(e.from ?? e.source ?? e.sourceId ?? '').trim()
      const to = String(e.to ?? e.target ?? e.targetId ?? '').trim()
      const rawKind = String(e.kind ?? e.type ?? 'resource')
        .toLowerCase()
        .trim()
      const kind: MxEdgeKind =
        rawKind === 'state' || rawKind === 'state_modifier' ? 'state' : 'resource'
      const rawFormula = e.formula ?? e.rate ?? e.value ?? e.weight ?? e.label
      const formula =
        rawFormula !== undefined && rawFormula !== null && String(rawFormula).trim() !== ''
          ? String(rawFormula)
          : kind === 'state'
            ? '+1'
            : '1'
      return {
        ...(e as unknown as MxEdge),
        id,
        from,
        to,
        kind,
        formula,
        bend: Number.isFinite(e.bend) ? Number(e.bend) : undefined
      } as MxEdge
    })
    .filter((e): e is MxEdge => e !== null)
  const edgeIdSet = new Set(normalizedRawEdges.map((e) => e.id))
  const edges = normalizedRawEdges.filter(
    (e) => ids.has(e.from) && (ids.has(e.to) || (!!e.targetEdgeId && edgeIdSet.has(e.targetEdgeId)))
  )
  const groups: MxGroup[] = (Array.isArray(r.groups) ? r.groups : [])
    .filter(
      (g): g is MxGroup => !!g && typeof g === 'object' && typeof (g as MxGroup).id === 'string'
    )
    .map((g) => ({
      id: g.id,
      label: String(g.label ?? 'Group'),
      x: Number.isFinite(g.x) ? g.x : 100,
      y: Number.isFinite(g.y) ? g.y : 100,
      width: Math.max(80, Number.isFinite(g.width) ? g.width : 260),
      height: Math.max(60, Number.isFinite(g.height) ? g.height : 180),
      color: g.color || '#3b82f6',
      layerId: g.layerId
    }))
  const agents: MxAgent[] = (Array.isArray(r.agents) ? r.agents : [])
    .filter(
      (a): a is MxAgent => !!a && typeof a === 'object' && typeof (a as MxAgent).id === 'string'
    )
    .map((a) => ({
      id: a.id,
      name: String(a.name ?? 'Agent'),
      color: a.color || '#6366f1',
      enabled: a.enabled !== false,
      personality: (
        ['rational', 'aggressive', 'hoarder', 'balanced', 'chaotic'] as MxAgentPersonality[]
      ).includes(a.personality)
        ? a.personality
        : 'rational',
      description: a.description,
      goals: (Array.isArray(a.goals) ? a.goals : [])
        .filter((g) => !!g && typeof g === 'object' && typeof g.nodeId === 'string')
        .map((g) => ({
          id: String(g.id || mxNewId('goal')),
          nodeId: g.nodeId,
          targetFormula: String(g.targetFormula ?? '100'),
          importance: (['min', 'low', 'med', 'high', 'max'] as MxAgentImportance[]).includes(
            g.importance
          )
            ? g.importance
            : 'med',
          continuePastTarget: Boolean(g.continuePastTarget),
          trajectory: g.trajectory === 'downwards' ? 'downwards' : 'upwards',
          utilityCurve: (
            ['linear', 'diminishing', 'urgency', 'step'] as MxAgentUtilityCurve[]
          ).includes(g.utilityCurve as MxAgentUtilityCurve)
            ? (g.utilityCurve as MxAgentUtilityCurve)
            : 'linear'
        })),
      controlledNodeIds: Array.isArray(a.controlledNodeIds)
        ? a.controlledNodeIds.filter((nid) => ids.has(nid))
        : [],
      actionsPerStep: Math.max(1, Math.min(5, Number(a.actionsPerStep ?? 1))),
      lookaheadHorizon: Math.max(1, Math.min(5, Math.round(Number(a.lookaheadHorizon ?? 2)))),
      discount: Math.max(0.1, Math.min(1.0, Number(a.discount ?? 0.65))),
      shapingEnabled: a.shapingEnabled !== false
    }))
  return {
    schema: 'mx@2',
    title: String(r.title ?? base.title),
    description: r.description,
    templateId: r.templateId,
    resources: Array.isArray(r.resources) && r.resources.length ? r.resources : base.resources,
    params: Array.isArray(r.params) ? r.params : [],
    scenarios: Array.isArray(r.scenarios) ? r.scenarios : [],
    activeScenarioId: r.activeScenarioId,
    layers: Array.isArray(r.layers) && r.layers.length ? r.layers : base.layers,
    nodes,
    edges,
    groups,
    agents,
    clips: Array.isArray(r.clips) ? r.clips : [],
    history: Array.isArray(r.history) ? r.history.slice(-15) : [],
    settings: {
      steps: Math.max(1, Math.min(2000, Number(r.settings?.steps ?? 20))),
      runs: Math.max(1, Math.min(1000, Number(r.settings?.runs ?? 50))),
      seed: Math.floor(Number(r.settings?.seed ?? 2026)),
      speed: Math.max(0.25, Math.min(8, Number(r.settings?.speed ?? 1))),
      actionMode: r.settings?.actionMode === 'turn_based' ? 'turn_based' : 'simultaneous',
      botMode:
        r.settings?.botMode === 'greedy' || r.settings?.botMode === 'smart'
          ? r.settings.botMode
          : 'off'
    },
    ...(r.workbench ? { workbench: normalizeMxNumericalWorkbench(r.workbench) } : {})
  }
}

/**
 * 自动按拓扑层级从左向右整理排版所有节点（Sugiyama 风格分层布局）。
 */
export function autoLayoutMxDocument(doc: MxDocument): void {
  const mainNodes = doc.nodes.filter((n) => n.kind !== 'note')
  const notes = doc.nodes.filter((n) => n.kind === 'note')
  if (!mainNodes.length) return

  const inDeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of mainNodes) {
    inDeg.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of doc.edges) {
    if (e.kind === 'resource' && inDeg.has(e.from) && inDeg.has(e.to)) {
      adj.get(e.from)!.push(e.to)
      inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
    }
  }

  // 计算拓扑层（Rank）
  const rank = new Map<string, number>()
  const queue: string[] = []
  for (const n of mainNodes) {
    if (n.kind === 'source' || (inDeg.get(n.id) ?? 0) === 0) {
      rank.set(n.id, 0)
      queue.push(n.id)
    }
  }
  while (queue.length) {
    const u = queue.shift()!
    const r = rank.get(u) ?? 0
    for (const v of adj.get(u) ?? []) {
      const nextR = Math.min(8, r + 1)
      if (!rank.has(v) || (rank.get(v) ?? 0) < nextR) {
        rank.set(v, nextR)
        queue.push(v)
      }
    }
  }
  // 状态边关联或未访问节点归入就近列
  for (const n of mainNodes) {
    if (!rank.has(n.id)) {
      if (n.kind === 'end' || n.kind === 'drain') rank.set(n.id, 4)
      else if (n.kind === 'register') rank.set(n.id, 2)
      else rank.set(n.id, 1)
    }
  }

  const columns = new Map<number, MxNode[]>()
  for (const n of mainNodes) {
    const col = rank.get(n.id) ?? 0
    const arr = columns.get(col) ?? []
    arr.push(n)
    columns.set(col, arr)
  }

  const sortedCols = [...columns.keys()].sort((a, b) => a - b)
  const startX = 180
  const gapX = 165
  const centerY = 270
  const gapY = 115

  sortedCols.forEach((colKey, colIdx) => {
    const list = columns.get(colKey)!
    list.sort((a, b) => a.y - b.y)
    const totalH = (list.length - 1) * gapY
    list.forEach((node, rowIdx) => {
      node.x = Math.round(startX + colIdx * gapX)
      node.y = Math.round(centerY - totalH / 2 + rowIdx * gapY)
    })
  })

  notes.forEach((nt, idx) => {
    nt.x = startX + idx * 220
    nt.y = 85
  })
}

/** v1 MachinationsDiagram → v2 文档 */
export function upgradeMachinationsDiagramToMx(v1: MachinationsDiagram): MxDocument {
  const doc = createEmptyMxDocument(v1.title)
  doc.description = v1.description
  doc.templateId = v1.presetId
  const resMap = new Map<string, string>()
  doc.resources = []
  const kindMap: Record<string, MxNodeKind> = {
    source: 'source',
    pool: 'pool',
    converter: 'converter',
    drain: 'drain',
    gate: 'gate',
    register: 'register',
    end_condition: 'end'
  }
  for (const n of v1.nodes) {
    const kind = kindMap[n.kind] ?? 'pool'
    let resourceId: string | undefined
    if (kind === 'pool' || kind === 'source') {
      const color = n.color ?? '#3b82f6'
      if (!resMap.has(color)) {
        const id = `res_${resMap.size + 1}`
        resMap.set(color, id)
        doc.resources.push({ id, name: n.label.split(' ')[0] || id, color })
      }
      resourceId = resMap.get(color)
    }
    doc.nodes.push({
      id: n.id,
      kind,
      label: n.label,
      x: Math.round(n.x * 1.4),
      y: Math.round(n.y * 1.4),
      trigger: n.activation === 'on_start' ? 'enabling' : n.activation,
      initial: n.initialValue,
      capacity: n.maxCapacity && n.maxCapacity > 0 ? n.maxCapacity : undefined,
      formula:
        kind === 'register'
          ? (n.formula ?? '').replace(/Math\.pow/g, 'pow')
          : kind === 'end'
            ? (n.formula ?? '').replace(/^a\s*/, 'a ')
            : undefined,
      gateMode: n.gateMode === 'deterministic' ? 'deterministic' : 'random',
      pullMode:
        kind === 'converter'
          ? 'pull_all'
          : kind === 'pool' || kind === 'drain'
            ? 'pull_any'
            : undefined,
      conversion: kind === 'converter' ? 'single' : undefined,
      resourceId,
      color: n.color
    })
  }
  if (!doc.resources.length)
    doc.resources.push({ id: 'res_default', name: 'Resource', color: '#3b82f6' })
  for (const e of v1.edges) {
    const srcNode = v1.nodes.find((n) => n.id === e.sourceId)
    let formula = String(e.rate)
    if (e.kind === 'state_modifier') {
      const tgt = v1.nodes.find((n) => n.id === e.targetId)
      if (tgt?.kind === 'register') formula = '+1'
      else if (tgt?.kind === 'end_condition')
        formula = (tgt.formula ?? '').replace(/^a\s*/, '') || '>=1'
      else if (tgt?.kind === 'converter') formula = '+0'
      else formula = `${e.rate >= 0 ? '+' : ''}${e.rate}`
    } else if (srcNode?.kind === 'gate') {
      formula = `${e.rate}%`
    }
    doc.edges.push({
      id: e.id,
      kind: e.kind === 'state_modifier' ? 'state' : 'resource',
      from: e.sourceId,
      to: e.targetId,
      formula
    })
  }
  // v1 寄存器驱动转化器费用：改写为直接引用寄存器值的公式
  for (const e of v1.edges) {
    if (e.kind !== 'state_modifier') continue
    const src = v1.nodes.find((n) => n.id === e.sourceId)
    const tgt = v1.nodes.find((n) => n.id === e.targetId)
    if (src?.kind === 'register' && tgt?.kind === 'converter') {
      const inEdge = doc.edges.find((x) => x.kind === 'resource' && x.to === tgt.id)
      if (inEdge) inEdge.formula = mxIdentifier(src.label) || src.id
      doc.edges = doc.edges.filter((x) => x.id !== e.id)
    }
  }
  return doc
}

// ───────────────────────────── 模板库 ─────────────────────────────

export type MxTemplateId =
  | MachinationsPresetId
  | 'roguelike_run'
  | 'simple_faucet_sink'
  | 'tower_defense_waves'
  | 'crafting_chain'
  | 'energy_stamina_timer'
  | 'hearthstone_mana_pack'
  | 'onmyoji_speed_orbs'
  | 'balatro_ante_jokers'
  | 'short_drama_reversal_loop'

export interface MxTemplateMeta {
  id: MxTemplateId
  /** i18n key 后缀 */
  key: string
  category: 'core' | 'rpg' | 'live_ops' | 'strategy'
  nameEn: string
  nameZh: string
  descEn: string
  descZh: string
  workbenchPreset?: MxWorkbenchPresetId
}

export const MX_TEMPLATES: MxTemplateMeta[] = [
  {
    id: 'roguelike_run',
    key: 'roguelikeRun',
    category: 'rpg',
    nameEn: 'Roguelike run: risk, reward, death',
    nameZh: 'Roguelike \u95ef\u5173\uff1a\u98ce\u9669\u3001\u6536\u76ca\u4e0e\u6b7b\u4ea1',
    descEn: 'Depth exploration, gold loot scaling, tavern heal converter, and lethal HP drain.',
    descZh:
      '\u5730\u7262\u5c42\u6570\u9012\u589e\u3001\u91d1\u5e01\u6389\u843d\u3001\u9152\u9986\u56de\u8840\u8f6c\u5316\u4e0e\u751f\u547d\u5f52\u96f6\u7ec8\u6b62',
    workbenchPreset: 'slay_the_spire_dbg'
  },
  {
    id: 'roguelike_mana_deck',
    key: 'deck',
    category: 'rpg',
    nameEn: 'Slay the Spire: Deckbuilder Mana & Vulnerable Loop',
    nameZh:
      '\u300a\u6740\u622e\u5c16\u5854\u300bDBG \u6d17\u62bd\u724c\u5e93\u4e0e\u529b\u91cf\u6613\u4f24\u5faa\u73af',
    descEn:
      'Turn mana generation, card play converter, Strength/Vulnerable multipliers, and discard cycle.',
    descZh:
      '\u6bcf\u56de\u5408\u80fd\u91cf\u6062\u590d\u3001\u6d17\u62bd\u724c\u6253\u724c\u8f6c\u5316\u3001\u529b\u91cf/\u6613\u4f24\u4e58\u533a\u4e0e\u722c\u5854\u6218\u635f',
    workbenchPreset: 'slay_the_spire_dbg'
  },
  {
    id: 'hearthstone_mana_pack',
    key: 'hearthstone',
    category: 'strategy',
    nameEn: 'Hearthstone: 1-10 Mana Tempo & Pack Dust Pity',
    nameZh:
      '\u300a\u7089\u77f3\u4f20\u8bf4\u300bTCG \u6cd5\u529b\u66f2\u7ebf\u4ea4\u6362\u4e0e\u5f00\u5305\u7c89\u5c18\u4fdd\u5e95',
    descEn:
      '1-10 Mana crystal ramp, minion board trade tempo, and 40-pack Legendary pity / Arcane Dust loop.',
    descZh:
      '1~10\u8d39\u6cd5\u529b\u6c34\u6676\u9012\u589e\u3001\u968f\u4ece\u7ad9\u573a\u4ea4\u6362\u8282\u594f\u4e0e40\u5305\u6a59\u5361\u4fdd\u5e95/\u5965\u672f\u4e4b\u5c18\u5408\u6210',
    workbenchPreset: 'hearthstone_tcg'
  },
  {
    id: 'onmyoji_speed_orbs',
    key: 'onmyoji',
    category: 'rpg',
    nameEn: 'Onmyoji: Speed Pull-Gauge, 8-Orb Bar & Soul +18 SPD',
    nameZh:
      '\u300a\u9634\u9633\u5e08\u300b\u53cc\u62c9\u884c\u52a8\u6761\u3001\u9b3c\u706b\u56de\u706b\u6761\u4e0e\u5fa1\u9b42\u6ee1\u901f\u7ecf\u6d4e',
    descEn:
      'Speed action-bar pull, 8-orb shared pool with 5-tick recovery, 300/(300+DEF) damage & Soul sub-stats.',
    descZh:
      '\u4e00\u901f\u62c9\u6761\u8dd1\u6761\u30018\u9b3c\u706b\u6c60+5\u683c\u884c\u52a8\u56de\u706b\u3001300/(300+DEF)\u51cf\u4f24\u4e0e\u9b42\u571f\u5fa1\u9b42\u5f3a\u5316',
    workbenchPreset: 'onmyoji_atb'
  },
  {
    id: 'balatro_ante_jokers',
    key: 'balatro',
    category: 'strategy',
    nameEn: 'Balatro: Chips × (+Mult) × (×Mult) & Ante Scaling',
    nameZh:
      '\u300a\u5c0f\u4e11\u724c Balatro\u300b\u7b79\u7801\u00d7\u500d\u7387\u4e58\u533a\u7206\u70b8\u4e0e\u5e95\u6ce8\u5546\u5e97 Reroll',
    descEn:
      'Chips × Additive Mult × Independent Mult exponential scoring vs. Ante blind scaling and shop rerolls.',
    descZh:
      '\u7b79\u7801\u00d7\u52a0\u7b97\u500d\u7387\u00d7\u72ec\u7acb\u500d\u7387\u6307\u6570\u7206\u70b8\u3001\u5229\u606f\u4e0a\u9650\u4e0e\u5546\u5e97 Reroll \u5c0f\u4e11\u724c\u6210\u578b',
    workbenchPreset: 'balatro_roguelike'
  },
  {
    id: 'simple_faucet_sink',
    key: 'faucetSink',
    category: 'core',
    nameEn: 'Core Faucet & Sink Loop',
    nameZh: '\u57fa\u7840\u4ea7\u51fa\u4e0e\u56de\u6536\u95ed\u73af (Faucet & Sink)',
    descEn: 'Minimalist source, wallet pool, and probabilistic shop sink.',
    descZh:
      '\u4efb\u52a1\u91d1\u5e01\u4ea7\u51fa\u3001\u94b1\u5305\u6c60\u4e0e\u5546\u5e97\u6982\u7387\u6d88\u8017'
  },
  {
    id: 'arpg_equipment_economy',
    key: 'arpg',
    category: 'rpg',
    nameEn: 'ARPG Loot & Blacksmith Economy',
    nameZh: 'ARPG \u5237\u5b9d\u6389\u843d\u4e0e\u94c1\u5320\u5f3a\u5316\u7ecf\u6d4e',
    descEn: 'Dungeon loot drops, gold conversion, equipment upgrade sink, and inflation control.',
    descZh:
      '\u602a\u7269\u6389\u843d\u3001\u88c5\u5907\u953b\u9020\u5347\u7ea7\u4e0e\u91d1\u5e01\u56de\u6536\u5e73\u8861',
    workbenchPreset: 'onmyoji_atb'
  },
  {
    id: 'gacha_pity_banner',
    key: 'gacha',
    category: 'live_ops',
    nameEn: 'Gacha Banner & Soft/Hard Pity',
    nameZh: '\u62bd\u5361\u5361\u6c60\u4e0e\u8f6f/\u786c\u4fdd\u5e95\u6982\u7387\u6a21\u578b',
    descEn: 'Pulls pool, probability gate, pity counter state modifier, and SSR drop tracking.',
    descZh:
      '\u62bd\u5361\u6982\u7387\u5206\u6d41\u95e8\u3001\u4fdd\u5e95\u8ba1\u6570\u5668\u72b6\u6001\u4fee\u6b63\u4e0e SSR \u4ea7\u51fa\u5203\u5e03',
    workbenchPreset: 'hearthstone_tcg'
  },
  {
    id: 'idle_exponential_tycoon',
    key: 'idle',
    category: 'live_ops',
    nameEn: 'Idle Tycoon Exponential Growth',
    nameZh: '\u653e\u7f6e\u5927\u4ea8\u6307\u6570\u6210\u957f\u4e0e\u4ea7\u7ebf\u5347\u7ea7',
    nameEnShort: 'Idle Tycoon',
    descEn: 'Generator upgrades boosting production rate against exponential upgrade costs.',
    descZh:
      '\u77ff\u673a\u4ea7\u51fa\u3001\u72b6\u6001\u52a0\u6210\u4e0e\u6307\u6570\u7ea7\u5347\u7ea7\u8d39\u7528\u516c\u5f0f'
  } as MxTemplateMeta,
  {
    id: 'survivor_xp_loop',
    key: 'survivor',
    category: 'rpg',
    nameEn: 'Brotato / Survivor: Wave XP & Reroll Shop Loop',
    nameZh:
      '\u300aBrotato / \u5e78\u5b58\u8005\u300b\u6ce2\u6b21\u7ecf\u9a8c\u3001EDPS \u4e58\u533a\u4e0e\u5546\u5e97\u5237\u65b0',
    descEn:
      'Enemy wave spawns, XP gem collection, escalating level-up thresholds, and shop rerolls.',
    descZh:
      '\u602a\u7269\u6ce2\u6b21\u7ecf\u9a8c\u5b9d\u77f3\u4ea7\u51fa\u3001\u7b49\u7ea7\u9608\u503c\u6210\u957f\u4e0e20\u6ce2\u5546\u5e97Reroll\u6784\u7b51',
    workbenchPreset: 'survivor_brotato'
  },
  {
    id: 'tower_defense_waves',
    key: 'towerDefense',
    category: 'strategy',
    nameEn: 'Tower Defense: Waves & Build Economy',
    nameZh: '\u7b56\u7565\u5854\u9632\uff1a\u6ce2\u6b21\u8d4f\u91d1\u4e0e\u5efa\u5854\u9632\u7ebf',
    descEn: 'Kill bounty, escalating tower build cost, wave leak pressure, and base HP loss.',
    descZh:
      '\u51fb\u6740\u8d4f\u91d1\u3001\u5efa\u5854\u8d39\u7528\u9012\u589e\u4e0e\u6f0f\u602a\u57fa\u5730\u751f\u547d\u5224\u5b9a'
  },
  {
    id: 'crafting_chain',
    key: 'crafting',
    category: 'core',
    nameEn: 'Crafting Chain: Ore \u2192 Ingot \u2192 Sword',
    nameZh:
      '\u751f\u4ea7\u5408\u6210\u94fe\uff1a\u77ff\u77f3 \u2192 \u952d \u2192 \u6b66\u5668\u51fa\u552e',
    descEn: 'Multi-stage mining, furnace delay queue, smithing converter, and trader sale.',
    descZh:
      '\u91c7\u77ff\u3001\u7194\u7089\u5ef6\u8fdf\u961f\u5217\u3001\u953b\u9020\u8f6c\u5316\u4e0e\u4ea4\u6613\u51fa\u552e'
  },
  {
    id: 'energy_stamina_timer',
    key: 'energy',
    category: 'live_ops',
    nameEn: 'Energy / Stamina Regen & Session Cap',
    nameZh: '\u4f53\u529b\u81ea\u7136\u6062\u590d\u4e0e\u5173\u5361\u6d88\u8017\u5faa\u73af',
    descEn: 'Capped stamina pool with interval regen, stage entry converter, and XP progression.',
    descZh:
      '\u5e26\u4e0a\u9650\u4f53\u529b\u6c60\u3001\u95f4\u9694\u6062\u590d\u3001\u95ef\u5173\u6d88\u8017\u4e0e\u7b49\u7ea7\u5bc4\u5b58\u5668'
  },
  {
    id: 'short_drama_reversal_loop',
    key: 'shortDrama',
    category: 'rpg',
    nameEn: 'Short Drama Progression: Humiliation Charge, System Multiplier & Climax Paywall',
    nameZh: '🎬《逆袭爽剧 / 系统流》80集角色成长、受辱蓄能与打脸付费卡点闭环', // cjk-ok
    descEn:
      'Villain provocation charge, system multiplier breakthrough, climax face-slapping, faction prestige & paywall conversion.',
    descZh: '反派打压蓄能、金手指返利/境界突破、名场面亮底牌打脸、红颜势力声望与付费卡点转化闭环', // cjk-ok
    workbenchPreset: 'short_drama_progression'
  }
]

function nd(
  id: string,
  kind: MxNodeKind,
  label: string,
  x: number,
  y: number,
  extra: Partial<MxNode> = {}
): MxNode {
  return { ...createMxNode(kind, x, y, label), id, ...extra }
}

function ed(
  id: string,
  kind: MxEdgeKind,
  from: string,
  to: string,
  formula: string,
  extra: Partial<MxEdge> = {}
): MxEdge {
  return { id, kind, from, to, formula, ...extra }
}

/** 创建模板文档 */
export function createMxTemplate(id: MxTemplateId, title?: string): MxDocument {
  const v1Ids: MachinationsPresetId[] = [
    'arpg_equipment_economy',
    'gacha_pity_banner',
    'idle_exponential_tycoon',
    'roguelike_mana_deck',
    'survivor_xp_loop'
  ]
  if ((v1Ids as string[]).includes(id)) {
    const doc = upgradeMachinationsDiagramToMx(
      createMachinationsPresetDiagram(id as MachinationsPresetId, title)
    )
    doc.templateId = id
    const meta = MX_TEMPLATES.find((t) => t.id === id)
    if (meta?.workbenchPreset) {
      doc.workbench = createMxWorkbenchPreset(meta.workbenchPreset)
    }
    return doc
  }
  const doc = createEmptyMxDocument(title)
  doc.templateId = id
  const meta = MX_TEMPLATES.find((t) => t.id === id)
  if (meta?.workbenchPreset) {
    doc.workbench = createMxWorkbenchPreset(meta.workbenchPreset)
  }
  switch (id) {
    case 'hearthstone_mana_pack': {
      doc.title = title || 'Hearthstone: 1-10 Mana Tempo & Pack Dust Pity'
      doc.resources = [
        { id: 'mana', name: 'Mana Crystal', color: '#3b82f6' },
        { id: 'board', name: 'Board Stats', color: '#f59e0b' },
        { id: 'dust', name: 'Arcane Dust', color: '#a855f7' },
        { id: 'hp', name: 'Enemy Hero HP', color: '#ef4444' }
      ]
      doc.params = [
        { id: 'p_curve', name: 'CurveEfficiency', value: 2.1 },
        { id: 'p_clear', name: 'EnemyBoardClear', value: 2.5 }
      ]
      doc.scenarios = [
        {
          id: 'sc_aggro',
          name: 'Fast Tempo',
          params: { CurveEfficiency: 2.8, EnemyBoardClear: 1.8 }
        },
        {
          id: 'sc_control',
          name: 'Heavy Clear',
          params: { CurveEfficiency: 1.7, EnemyBoardClear: 3.5 }
        }
      ]
      doc.nodes = [
        nd('ramp', 'source', 'Turn Mana (+1)', 140, 180, { resourceId: 'mana' }),
        nd('crystals', 'pool', 'Mana Crystals', 310, 180, {
          resourceId: 'mana',
          initial: 1,
          capacity: 10
        }),
        nd('summon', 'converter', 'Play Minion on Curve', 500, 180, {
          resourceId: 'board',
          trigger: 'automatic'
        }),
        nd('board_atk', 'pool', 'Board Attack', 700, 180, { resourceId: 'board', initial: 2 }),
        nd('trade_drain', 'drain', 'Enemy Clear / Trade', 700, 340, { trigger: 'automatic' }),
        nd('face_dmg', 'converter', 'Attack Enemy Hero', 890, 180, {
          resourceId: 'hp',
          trigger: 'automatic'
        }),
        nd('enemy_dmg', 'pool', 'Damage Dealt', 1060, 180, { resourceId: 'hp', initial: 0 }),
        nd('lethal', 'end', 'Lethal (30 DMG)', 1060, 340, {}),
        nd('pack_src', 'source', 'Open Pack', 140, 340, { resourceId: 'dust' }),
        nd('dust_pool', 'pool', 'Arcane Dust', 310, 340, { resourceId: 'dust', initial: 100 }),
        nd('craft_leg', 'converter', 'Craft Legendary (1600)', 500, 340, {
          resourceId: 'board',
          trigger: 'automatic'
        })
      ]
      doc.edges = [
        ed('e1', 'resource', 'ramp', 'crystals', '1'),
        ed('e2', 'resource', 'crystals', 'summon', '1'),
        ed('e3', 'resource', 'summon', 'board_atk', 'round(Crystals * CurveEfficiency)'),
        ed('e4', 'resource', 'board_atk', 'trade_drain', 'round(EnemyBoardClear)'),
        ed('e5', 'state', 'board_atk', 'face_dmg', '>=1'),
        ed('e6', 'resource', 'face_dmg', 'enemy_dmg', 'max(1, round(Board_Attack * 0.65))'),
        ed('e7', 'state', 'enemy_dmg', 'lethal', '>=30'),
        ed('e8', 'resource', 'pack_src', 'dust_pool', '105'),
        ed('e9', 'resource', 'dust_pool', 'craft_leg', '400'),
        ed('e10', 'resource', 'craft_leg', 'board_atk', '4')
      ]
      doc.settings.steps = 12
      break
    }
    case 'onmyoji_speed_orbs': {
      doc.title = title || 'Onmyoji: Speed Pull-Gauge, 8-Orb Bar & Soul +18 SPD'
      doc.resources = [
        { id: 'av', name: 'Action Bar', color: '#38bdf8' },
        { id: 'orb', name: 'Oni Orbs', color: '#6366f1' },
        { id: 'dmg', name: 'Burst DMG', color: '#ef4444' },
        { id: 'soul', name: '6★ Souls', color: '#f59e0b' }
      ]
      doc.params = [
        { id: 'p_spd', name: 'PullerSPD', value: 265 },
        { id: 'p_cdmg', name: 'NukerCritDmg', value: 2.85 },
        { id: 'p_def', name: 'BossDEF', value: 450 }
      ]
      doc.scenarios = [
        {
          id: 'sc_fast',
          name: 'Full +18 SPD',
          params: { PullerSPD: 278, NukerCritDmg: 3.25, BossDEF: 380 }
        },
        {
          id: 'sc_tank',
          name: 'High DEF Boss',
          params: { PullerSPD: 240, NukerCritDmg: 2.5, BossDEF: 680 }
        }
      ]
      doc.nodes = [
        nd('spd_run', 'source', 'Speed Tick', 140, 180, { resourceId: 'av' }),
        nd('action_bar', 'pool', 'Action Bar (100)', 310, 180, {
          resourceId: 'av',
          initial: 30,
          capacity: 100
        }),
        nd('pull_skill', 'converter', 'Kamaitachi Pull (+30%)', 500, 180, {
          resourceId: 'av',
          trigger: 'automatic'
        }),
        nd('orb_bar', 'source', '5-Action Orb Bar (+4)', 310, 340, { resourceId: 'orb' }),
        nd('orbs', 'pool', 'Shared Orbs (Max 8)', 500, 340, {
          resourceId: 'orb',
          initial: 6,
          capacity: 8
        }),
        nd('mitigation', 'register', 'Mitigation 300/(300+DEF)', 700, 340, {
          formula: '300 / (300 + BossDEF * 0.8)'
        }),
        nd('nuke_cast', 'converter', 'Asura 3-Orb AOE', 700, 180, {
          resourceId: 'dmg',
          trigger: 'automatic'
        }),
        nd('boss_dmg', 'pool', 'Total Boss DMG', 900, 180, { resourceId: 'dmg', initial: 0 }),
        nd('clear_end', 'end', 'Soul Stage 11 Cleared', 900, 340, {})
      ]
      doc.edges = [
        ed('e1', 'resource', 'spd_run', 'action_bar', 'round(PullerSPD * 0.15)'),
        ed('e2', 'resource', 'action_bar', 'pull_skill', '30'),
        ed('e3', 'resource', 'orb_bar', 'orbs', '4 every 2'),
        ed('e4', 'resource', 'orbs', 'nuke_cast', '3'),
        ed('e5', 'resource', 'pull_skill', 'nuke_cast', '1'),
        ed(
          'e6',
          'resource',
          'nuke_cast',
          'boss_dmg',
          'round(8800 * 3.15 * NukerCritDmg * (300 / (300 + BossDEF * 0.8)))'
        ),
        ed('e7', 'state', 'boss_dmg', 'clear_end', '>=68000')
      ]
      doc.settings.steps = 15
      break
    }
    case 'balatro_ante_jokers': {
      doc.title = title || 'Balatro: Chips × (+Mult) × (×Mult) & Ante Scaling'
      doc.resources = [
        { id: 'gold', name: 'Dollars ($)', color: '#f59e0b' },
        { id: 'joker', name: '×Mult Jokers', color: '#ec4899' },
        { id: 'score', name: 'Hand Score', color: '#3b82f6' }
      ]
      doc.params = [
        { id: 'p_chips', name: 'BaseChips', value: 140 },
        { id: 'p_mult', name: 'AddMult', value: 32 },
        { id: 'p_xmult', name: 'JokerXMult', value: 2.0 }
      ]
      doc.scenarios = [
        {
          id: 'sc_godrun',
          name: 'Polychrome XMult',
          params: { BaseChips: 180, AddMult: 45, JokerXMult: 2.6 }
        },
        {
          id: 'sc_goldstake',
          name: 'Gold Stake',
          params: { BaseChips: 110, AddMult: 22, JokerXMult: 1.6 }
        }
      ]
      doc.nodes = [
        nd('blind_reward', 'source', 'Blind Reward + Interest', 140, 200, { resourceId: 'gold' }),
        nd('wallet', 'pool', 'Dollars ($)', 330, 200, {
          resourceId: 'gold',
          initial: 10,
          capacity: 100
        }),
        nd('reroll_shop', 'converter', 'Shop Reroll & Buy Joker', 530, 200, {
          resourceId: 'joker',
          trigger: 'automatic'
        }),
        nd('xmult_jokers', 'pool', 'Active ×Mult Jokers', 730, 200, {
          resourceId: 'joker',
          initial: 1,
          capacity: 5
        }),
        nd('hand_score', 'register', 'Chips * (+Mult) * (×Mult^N)', 730, 350, {
          formula: 'round((BaseChips + step * 18) * (AddMult + step * 4) * pow(JokerXMult, a))'
        }),
        nd('ante_target', 'register', 'Ante Blind Target', 930, 350, {
          formula: 'round(300 * pow(1.55, step))'
        }),
        nd('score_pool', 'pool', 'Cumulative Score', 930, 200, { resourceId: 'score', initial: 0 }),
        nd('ante8_win', 'end', 'Ante 8 Cleared', 1100, 200, {})
      ]
      doc.edges = [
        ed('e1', 'resource', 'blind_reward', 'wallet', '5 + min(5, floor(Dollars___ / 5))'),
        ed('e2', 'resource', 'wallet', 'reroll_shop', '8'),
        ed('e3', 'resource', 'reroll_shop', 'xmult_jokers', '1 65%'),
        ed('e4', 'state', 'xmult_jokers', 'hand_score', '+1'),
        ed('e5', 'resource', 'reroll_shop', 'score_pool', 'Chips____Mult_____Mult_N_'),
        ed('e6', 'state', 'score_pool', 'ante8_win', '>=50000')
      ]
      doc.settings.steps = 16
      break
    }
    case 'roguelike_run': {
      // 复刻截图：Roguelike run: risk, reward, death
      doc.title = title || 'Roguelike run: risk, reward, death'
      doc.resources = [
        { id: 'depth', name: 'Depth', color: '#3b82f6' },
        { id: 'gold', name: 'Gold', color: '#ef4444' },
        { id: 'hp', name: 'HP', color: '#d97706' }
      ]
      doc.params = [
        { id: 'p_risk', name: 'DamagePerDepth', value: 1.5 },
        { id: 'p_reward', name: 'GoldPerDepth', value: 1.2 }
      ]
      doc.scenarios = [
        { id: 'sc_easy', name: 'Easy', params: { DamagePerDepth: 1, GoldPerDepth: 1.5 } },
        { id: 'sc_hard', name: 'Hard', params: { DamagePerDepth: 2.5, GoldPerDepth: 1 } }
      ]
      doc.nodes = [
        nd('explore', 'source', 'Explore', 160, 320, { resourceId: 'depth' }),
        nd('depth', 'pool', 'Depth', 300, 320, { resourceId: 'depth', initial: 0 }),
        nd('gold_found', 'register', 'Gold Found', 440, 330, {
          formula: 'round(a * GoldPerDepth)'
        }),
        nd('monster_dmg', 'register', 'Monster Damage', 520, 160, {
          formula: 'round(a * DamagePerDepth)'
        }),
        nd('earn_gold', 'source', 'Earn Gold', 420, 250, {
          resourceId: 'gold',
          trigger: 'passive'
        }),
        nd('gold', 'pool', 'Gold', 600, 250, { resourceId: 'gold', initial: 0 }),
        nd('rest', 'converter', 'Rest at Tavern', 730, 250, {
          resourceId: 'hp',
          conversion: 'single',
          pullMode: 'pull_all'
        }),
        nd('hp', 'pool', 'HP', 860, 250, { resourceId: 'hp', initial: 100, capacity: 100 }),
        nd('take_damage', 'drain', 'Take Damage', 1000, 250, { trigger: 'automatic' }),
        nd('death', 'end', 'Death', 1000, 330, {})
      ]
      doc.edges = [
        ed('e1', 'resource', 'explore', 'depth', '1'),
        ed('e2', 'state', 'depth', 'gold_found', '+1'),
        ed('e3', 'state', 'depth', 'monster_dmg', '+1'),
        ed('e4', 'state', 'explore', 'earn_gold', '*'),
        ed('e5', 'resource', 'earn_gold', 'gold', 'Gold_Found * 0.15 + 1'),
        ed('e6', 'resource', 'gold', 'rest', '5'),
        ed('e7', 'resource', 'rest', 'hp', '8'),
        ed('e8', 'resource', 'hp', 'take_damage', 'D6 + Monster_Damage * 0.12'),
        ed('e9', 'state', 'hp', 'death', '<=0')
      ]
      doc.settings.steps = 20
      break
    }
    case 'simple_faucet_sink': {
      doc.title = title || 'Faucet & Sink'
      doc.resources = [{ id: 'coin', name: 'Coin', color: '#f59e0b' }]
      doc.nodes = [
        nd('faucet', 'source', 'Quest Reward', 160, 240, { resourceId: 'coin' }),
        nd('wallet', 'pool', 'Wallet', 380, 240, { resourceId: 'coin', initial: 20 }),
        nd('shop', 'drain', 'Shop Purchase', 600, 240, { trigger: 'automatic' })
      ]
      doc.edges = [
        ed('e1', 'resource', 'faucet', 'wallet', 'D6 + 2'),
        ed('e2', 'resource', 'wallet', 'shop', '4 50%')
      ]
      break
    }
    case 'tower_defense_waves': {
      doc.title = title || 'Tower Defense: Waves & Build Economy'
      doc.resources = [
        { id: 'gold', name: 'Gold', color: '#f59e0b' },
        { id: 'tower', name: 'Tower', color: '#3b82f6' },
        { id: 'lives', name: 'Lives', color: '#ef4444' }
      ]
      doc.params = [{ id: 'p_wave', name: 'WaveGrowth', value: 0.35 }]
      doc.scenarios = [
        { id: 'sc_casual', name: 'Casual Wave', params: { WaveGrowth: 0.22 } },
        { id: 'sc_nightmare', name: 'Nightmare Wave', params: { WaveGrowth: 0.55 } }
      ]
      doc.nodes = [
        nd('kills', 'source', 'Enemy Kills', 140, 200, { resourceId: 'gold' }),
        nd('gold', 'pool', 'Gold', 320, 200, { resourceId: 'gold', initial: 30 }),
        nd('build', 'converter', 'Build Tower', 500, 200, { resourceId: 'tower' }),
        nd('towers', 'pool', 'Towers', 680, 200, { resourceId: 'tower', initial: 1 }),
        nd('leak', 'source', 'Wave Leak', 500, 360, { resourceId: 'lives', trigger: 'automatic' }),
        nd('leaks', 'pool', 'Leaked', 680, 360, { resourceId: 'lives' }),
        nd('lose', 'end', 'Base Destroyed', 860, 360, {})
      ]
      doc.edges = [
        ed('e1', 'resource', 'kills', 'gold', '4'),
        ed('e2', 'state', 'towers', 'kills', '+2'),
        ed('e3', 'resource', 'gold', 'build', '25 + Towers * 10'),
        ed('e4', 'resource', 'build', 'towers', '1'),
        ed(
          'e5',
          'resource',
          'leak',
          'leaks',
          'max(0, round(step * WaveGrowth - Towers * 0.8 + random(-1, 1)))'
        ),
        ed('e6', 'state', 'leaks', 'lose', '>=20')
      ]
      doc.settings.steps = 40
      break
    }
    case 'crafting_chain': {
      doc.title = title || 'Crafting Chain: Ore → Ingot → Sword'
      doc.resources = [
        { id: 'ore', name: 'Ore', color: '#78716c' },
        { id: 'ingot', name: 'Ingot', color: '#94a3b8' },
        { id: 'sword', name: 'Sword', color: '#3b82f6' },
        { id: 'gold', name: 'Gold', color: '#f59e0b' }
      ]
      doc.nodes = [
        nd('mine', 'source', 'Mine', 120, 220, { resourceId: 'ore' }),
        nd('ore', 'pool', 'Ore', 270, 220, { resourceId: 'ore' }),
        nd('smelt', 'converter', 'Smelt', 420, 220, { resourceId: 'ingot' }),
        nd('ingot', 'pool', 'Ingot', 570, 220, { resourceId: 'ingot' }),
        nd('forge', 'converter', 'Forge', 720, 220, { resourceId: 'sword' }),
        nd('sword', 'pool', 'Swords', 870, 220, { resourceId: 'sword' }),
        nd('sell', 'trader', 'Sell', 870, 380, { resourceId: 'gold' }),
        nd('gold', 'pool', 'Gold', 1020, 380, { resourceId: 'gold' }),
        nd('furnace', 'delay', 'Furnace Delay', 420, 360, { delaySteps: 2 })
      ]
      doc.edges = [
        ed('e1', 'resource', 'mine', 'ore', 'randint(2, 4)'),
        ed('e2', 'resource', 'ore', 'smelt', '3'),
        ed('e3', 'resource', 'smelt', 'furnace', '1'),
        ed('e4', 'resource', 'furnace', 'ingot', '1'),
        ed('e5', 'resource', 'ingot', 'forge', '2'),
        ed('e6', 'resource', 'forge', 'sword', '1'),
        ed('e7', 'resource', 'sword', 'sell', '1'),
        ed('e8', 'resource', 'sell', 'gold', '35')
      ]
      doc.settings.steps = 30
      break
    }
    case 'energy_stamina_timer': {
      doc.title = title || 'Energy / Stamina Timer'
      doc.resources = [
        { id: 'energy', name: 'Energy', color: '#22c55e' },
        { id: 'xp', name: 'XP', color: '#a855f7' }
      ]
      doc.nodes = [
        nd('regen', 'source', 'Regen', 140, 240, { resourceId: 'energy' }),
        nd('energy', 'pool', 'Energy', 320, 240, {
          resourceId: 'energy',
          initial: 20,
          capacity: 30
        }),
        nd('play', 'converter', 'Play Level', 500, 240, { resourceId: 'xp', trigger: 'automatic' }),
        nd('xp', 'pool', 'XP', 680, 240, { resourceId: 'xp' }),
        nd('lv', 'register', 'Level', 680, 380, { formula: 'floor(sqrt(a / 10)) + 1' })
      ]
      doc.edges = [
        ed('e1', 'resource', 'regen', 'energy', '1 every 2'),
        ed('e2', 'resource', 'energy', 'play', '6'),
        ed('e3', 'resource', 'play', 'xp', 'D10 + 5'),
        ed('e4', 'state', 'xp', 'lv', '+1')
      ]
      doc.settings.steps = 60
      break
    }
    case 'short_drama_reversal_loop': {
      doc.title = title || '🎬《逆袭爽剧 / 系统流》80集角色成长、受辱蓄能与打脸付费卡点闭环' // cjk-ok
      doc.resources = [
        { id: 'grievance', name: '受辱蓄能', color: '#f59e0b' }, // cjk-ok
        { id: 'power', name: '主角境界/身价', color: '#3b82f6' }, // cjk-ok
        { id: 'prestige', name: '震慑声望/好感', color: '#ec4899' } // cjk-ok
      ]
      doc.params = [
        { id: 'p_sys', name: 'SystemRebateMult', value: 2.2 },
        { id: 'p_slap', name: 'ClimaxSlapRatio', value: 1.8 }
      ]
      doc.scenarios = [
        {
          id: 'sc_god_rebate',
          name: '百倍神豪爽剧节奏', // cjk-ok
          params: { SystemRebateMult: 3.0, ClimaxSlapRatio: 2.4 }
        },
        {
          id: 'sc_slow_burn',
          name: '传统慢热隐忍节奏', // cjk-ok
          params: { SystemRebateMult: 1.5, ClimaxSlapRatio: 1.3 }
        }
      ]
      doc.nodes = [
        nd('villain_provoke', 'source', /* cjk-ok */ '反派挑衅/退婚受辱', 130, 190, {
          resourceId: 'grievance'
        }),
        nd('grievance_pool', 'pool', /* cjk-ok */ '受辱蓄能池 (压抑值)', 310, 190, {
          resourceId: 'grievance',
          initial: 6,
          capacity: 30
        }),
        nd('system_awaken', 'converter', /* cjk-ok */ '金手指/奇遇突破', 500, 190, {
          resourceId: 'power',
          trigger: 'automatic'
        }),
        nd('protagonist_power', 'pool', /* cjk-ok */ '主角境界/百亿身价池', 700, 190, {
          resourceId: 'power',
          initial: 24
        }),
        nd('climax_slap', 'converter', /* cjk-ok */ '名场面亮底牌打脸', 700, 350, {
          resourceId: 'prestige',
          trigger: 'automatic'
        }),
        nd('prestige_pool', 'pool', /* cjk-ok */ '家族声望 & 红颜倾心度', 910, 260, {
          resourceId: 'prestige',
          initial: 10
        }),
        nd('villain_tier', 'register', /* cjk-ok */ '反派换地图阶梯 (1~4阶)', 500, 350, {
          formula: 'min(4, floor(a / 25) + 1)'
        }),
        nd('finale_win', 'end', /* cjk-ok */ '80集登顶巅峰大结局', 1090, 260, {})
      ]
      doc.edges = [
        ed('e1', 'resource', 'villain_provoke', 'grievance_pool', '4'),
        ed('e2', 'resource', 'grievance_pool', 'system_awaken', '3'),
        ed('e3', 'resource', 'system_awaken', 'protagonist_power', 'round(4 * SystemRebateMult)'),
        ed('e4', 'resource', 'protagonist_power', 'climax_slap', '5'),
        ed('e5', 'resource', 'climax_slap', 'prestige_pool', 'round(6 * ClimaxSlapRatio)'),
        ed('e6', 'state', 'prestige_pool', 'villain_tier', '+1'),
        ed('e7', 'state', 'prestige_pool', 'finale_win', '>=120')
      ]
      doc.settings.steps = 20
      break
    }
    default:
      if (id !== ('roguelike_run' as MxTemplateId)) {
        return createMxTemplate('roguelike_run', title)
      }
      break
  }
  doc.workbench = createMxWorkbenchPreset(mapMxTemplateToWorkbenchPreset(id))
  return doc
}

export const createMxFromTemplate = createMxTemplate

function ensureMxAutoLayoutIfCollapsed(doc: MxDocument): MxDocument {
  if (doc.nodes.length >= 2) {
    const coords = new Set(doc.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`))
    if (coords.size < Math.ceil(doc.nodes.length / 2)) {
      autoLayoutMxDocument(doc)
    }
  }
  return doc
}

function tryExtractJsonObjectFromText(raw: string): Record<string, unknown> | null {
  let trimmed = raw.trim()
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenceMatch?.[1]) {
    trimmed = fenceMatch[1].trim()
  }
  if (!trimmed.startsWith('{')) {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      trimmed = trimmed.slice(firstBrace, lastBrace + 1)
    }
  }
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** 解析节点参数里保存的经济图（v2 JSON / v1 JSON / Markdown JSON / 对象 / 空）为 MxDocument */
export function parseMxDocumentJson(
  raw: unknown,
  fallbackTemplate: MxTemplateId = 'roguelike_run',
  title?: string
): MxDocument {
  const parsed: Record<string, unknown> | null =
    typeof raw === 'string' && raw.trim()
      ? tryExtractJsonObjectFromText(raw)
      : raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null

  if (parsed) {
    if (parsed.schema === 'mx@2') {
      const doc = ensureMxAutoLayoutIfCollapsed(normalizeMxDocument(parsed))
      if (title && (!doc.title || doc.title === 'Untitled diagram')) doc.title = title
      return doc
    }
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      const first = parsed.nodes[0] as { sourceId?: string; activation?: string } | undefined
      const firstEdge = parsed.edges[0] as { sourceId?: string; targetId?: string } | undefined
      if ((first && 'activation' in first) || (firstEdge && 'sourceId' in firstEdge)) {
        const upgraded = upgradeMachinationsDiagramToMx(parsed as unknown as MachinationsDiagram)
        if (title && (!upgraded.title || upgraded.title === 'Untitled diagram'))
          upgraded.title = title
        return ensureMxAutoLayoutIfCollapsed(upgraded)
      }
      const doc = ensureMxAutoLayoutIfCollapsed(normalizeMxDocument({ ...parsed, schema: 'mx@2' }))
      if (title && (!doc.title || doc.title === 'Untitled diagram')) doc.title = title
      return doc
    }
  }

  // 若未提供有效 JSON，但 fallbackTemplate 仍为默认且 title 或 raw 含明确经济类型提示词，自动匹配对应模板
  const promptText = [typeof raw === 'string' ? raw : '', title ?? ''].filter(Boolean).join(' ')
  if (fallbackTemplate === 'roguelike_run' && promptText.trim()) {
    const matched = matchMxTemplateFromPrompt(promptText)
    if (matched) return createMxTemplate(matched, title)
  }
  return createMxTemplate(fallbackTemplate, title)
}

const MX_PROMPT_TEMPLATE_RULES: Array<[RegExp, MxTemplateId]> = [
  [
    /short\s*drama|micro\s*drama|短剧|爽剧|逆袭|打脸|系统流|神豪|战神|赘婿|重生|女频|豪门|退婚|反派阶梯|付费卡点/, // cjk-ok
    'short_drama_reversal_loop'
  ],
  [
    /hearthstone|tcg|minion|dust|mulligan|\u7089\u77f3|\u968f\u4ece|\u6cd5\u529b\u6c34\u6676|\u5965\u672f\u4e4b\u5c18|\u5361\u5305|\u4e07\u667a\u724c/,
    'hearthstone_mana_pack'
  ],
  [
    /onmyoji|shikigami|atb|action\s*bar|pull\s*gauge|soul\s*11|\u9634\u9633\u5e08|\u5fa1\u9b42|\u9b3c\u706b|\u62c9\u6761|\u884c\u52a8\u6761|\u5f0f\u795e|\u9b42\u571f|\u661f\u7a79\u94c1\u9053|\u661f\u94c1/,
    'onmyoji_speed_orbs'
  ],
  [
    /balatro|joker|ante|blind|chips|\u5c0f\u4e11\u724c|\u7b79\u7801|\u5e95\u6ce8|\u76f2\u6ce8|\u500d\u7387/,
    'balatro_ante_jokers'
  ],
  [
    /gacha|pity|banner|wish|pull|\u62bd\u5361|\u4fdd\u5e95|\u7948\u613f|\u5361\u6c60|\u5bfb\u8bbf|\u5341\u8fde/,
    'gacha_pity_banner'
  ],
  [
    /idle|tycoon|clicker|prestige|\u653e\u7f6e|\u6302\u673a|\u5927\u4ea8|\u6a21\u62df\u7ecf\u8425|\u4fee\u4ed9|\u7075\u6c14|\u79bb\u7ebf\u6536\u76ca/,
    'idle_exponential_tycoon'
  ],
  [
    /deck|card|mana|hand|draw|\u5361\u724c|\u6cd5\u529b|\u6784\u7b51|\u62bd\u724c|\u8d39\u7528/,
    'roguelike_mana_deck'
  ],
  [
    /survivor|vampire|xp|level\s*up|\u5e78\u5b58\u8005|\u5272\u8349|\u7ecf\u9a8c|\u5347\u7ea7\u66f2\u7ebf/,
    'survivor_xp_loop'
  ],
  [
    /tower|td\b|wave|defense|\u5854\u9632|\u6ce2\u6b21|\u9020\u5854|\u9632\u5b88/,
    'tower_defense_waves'
  ],
  [
    /craft|smelt|forge|ore|ingot|alchemy|\u5408\u6210|\u953b\u9020|\u5236\u4f5c|\u77ff\u77f3|\u51b6\u70bc|\u70bc\u4e39|\u751f\u4ea7\u94fe/,
    'crafting_chain'
  ],
  [
    /energy|stamina|ap\b|regen|\u4f53\u529b|\u80fd\u91cf|\u8010\u529b|\u75b2\u52b3|\u884c\u52a8\u70b9/,
    'energy_stamina_timer'
  ],
  [
    /arpg|loot|equip|blacksmith|enhance|\u88c5\u5907|\u5f3a\u5316|\u94c1\u5320|\u5237\u5b9d|\u6389\u843d|\u517b\u6210/,
    'arpg_equipment_economy'
  ],
  [
    /roguelike|dungeon|death|explore|\u8089\u9e3d|\u5730\u7262|\u6b7b\u4ea1|\u95ef\u5173|\u5192\u9669/,
    'roguelike_run'
  ],
  [
    /faucet|sink|shop|wallet|\u4ea7\u51fa|\u56de\u6536|\u5546\u57ce|\u95ed\u73af|\u6c34\u9f99\u5934/,
    'simple_faucet_sink'
  ]
]

/** 若自然语言提示词明确命中某类经济系统模板，返回其 MxTemplateId，否则返回 null */
export function matchMxTemplateFromPrompt(prompt: string): MxTemplateId | null {
  const p = (prompt ?? '').toLowerCase()
  if (!p.trim()) return null
  for (const [re, id] of MX_PROMPT_TEMPLATE_RULES) {
    if (re.test(p)) return id
  }
  return null
}

/** 自然语言 → 模板（Agent 抽屉与节点执行的离线兜底） */
export function inferMxTemplateFromPrompt(prompt: string): MxTemplateId {
  return matchMxTemplateFromPrompt(prompt) ?? 'simple_faucet_sink'
}

/**
 * 根据自然语言提示词合成或定制完整的 MxDocument（含步数解析与交互节点 AI Agent 自动挂载）。
 */
export function synthesizeMxDiagramFromPrompt(
  prompt: string,
  fallbackTemplate: MxTemplateId = 'roguelike_run',
  customTitle?: string
): MxDocument {
  const matchedTpl = matchMxTemplateFromPrompt(prompt) ?? fallbackTemplate
  const cleanTitle =
    customTitle &&
    customTitle.trim() &&
    customTitle.trim() !== '\u6e38\u620f\u7ecf\u6d4e\u7cfb\u7edf' &&
    customTitle.trim().toLowerCase() !== 'game economy'
      ? customTitle.trim()
      : undefined
  const doc = createMxTemplate(matchedTpl, cleanTitle)

  // 解析自然语言中的模拟步数（如 "30步" / "40 steps" / "50回合"）
  const stepMatch = /(\d{1,4})\s*(?:steps?|\u6b65|\u56de\u5408|\u6ce2|\u5929)/i.exec(prompt)
  if (stepMatch?.[1]) {
    const parsedSteps = Number(stepMatch[1])
    if (parsedSteps >= 5 && parsedSteps <= 500) {
      doc.settings.steps = parsedSteps
    }
  }

  // 若图中包含 Interactive 交互节点，自动挂载与提示词匹配的效用智能体，确保无头运行（运行画布节点）也能驱动交互分支
  if (doc.nodes.some((n) => n.trigger === 'interactive')) {
    const agent = generateMxAgentWithAi(doc, { prompt })
    doc.agents = [agent]
  }
  doc.workbench = synthesizeMxWorkbenchFromPrompt(
    prompt,
    mapMxTemplateToWorkbenchPreset(matchedTpl)
  )
  return doc
}
