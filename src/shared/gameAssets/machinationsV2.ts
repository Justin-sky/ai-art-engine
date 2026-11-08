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
  createXianxia200LifespanWorkbench,
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
  /** Machinations Custom Variable 类型：数值 / 随机区间 / 数组随机抽样 / 数学表达式 / 多维数组表 */
  varKind?: 'number' | 'random_range' | 'random_array' | 'expr' | 'array'
  /** 随机区间分布：均匀分布 uniform（默认）或高斯正态分布 gaussian */
  distribution?: 'uniform' | 'gaussian'
  /** 高斯分布均值与标准差（缺省时由 min/max 自动推导） */
  mean?: number
  std?: number
  /** 随机区间是否取整（默认 false，若 min/max 均为整数且显式开启则取整） */
  integerOnly?: boolean
  /** 1D 或 2D 数组（用于 array / random_array 自定义变量，如 [10, 20, 50] 或 [[1,2],[3,4]]） */
  values?: number[] | number[][]
  /** 自定义变量表达式（用于 expr 或数组字面量文本，如 "[100, 250, 500]" 或 "D6 + 2"） */
  formula?: string
  /** 更新时机：on_play（开局第 0 步求值一次）或 each_step（每步重新采样/求值） */
  updateMode?: 'on_play' | 'each_step'
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
  /** Pool 节点内圆点显示上限（默认 25，-1 表示仅显示数字，对齐 Machinations Display Capacity） */
  displayCapacity?: number
  /** Pool 容量溢出处理：block（默认，阻塞上游）或 drain（接收并销毁溢出部分） */
  overflow?: 'block' | 'drain'
  /** Register 公式 / End 条件公式 / Delay 延迟步数公式 */
  formula?: string
  /** Register 交互模式下的最小/最大与步进值 */
  min?: number
  max?: number
  step?: number
  gateMode?: 'random' | 'deterministic' | 'dice' | 'skill'
  conversion?: 'single' | 'multiple'
  /** Delay / Queue 的等待步数 */
  delaySteps?: number
  /** End 节点多输入条件聚合逻辑：all（默认 AND）或 any（OR） */
  endMode?: 'all' | 'any'
  /** 状态触发器（*）响应事件过滤 */
  triggerOn?: 'any' | 'send' | 'receive' | 'increase' | 'decrease' | 'any_change'
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
  /** 是否标记为调平影响因子（Mark as influencer，供 Auto-Balancer 优先选为调优自变量） */
  influencer?: boolean
}

export interface MxEdge {
  id: string
  kind: MxEdgeKind
  from: string
  to: string
  /** 状态连线可直接指向另一条连线（Machinations 边速率修正器 / 边激活器，支持指向资源边或状态边） */
  targetEdgeId?: string
  /** 手动弧度控制量（正负像素偏移） */
  bend?: number
  /** 资源连线：流量公式；状态连线：修改量 / 激活条件 / 触发器 / 覆盖符(=) / 间隔修正(+xi) / 分数修正(+n/d) / 概率权重 */
  formula: string
  /** 资源连线是否允许小数流转（Allow decimals，默认 true；设为 false 时向下取整为整数） */
  allowDecimals?: boolean
  /** 资源连线独立间隔公式（如 "2"、"D6"、"3..6"，等价于 formula 中的 "| interval"） */
  interval?: string
  /** 资源连线传输模式：flow / interval（默认，常规流动）或 instant（零延迟步内即时传导并立刻刷新下游激活与触发） */
  transferMode?: 'flow' | 'interval' | 'instant'
  /** 资源连线单次传输下限与上限（Limits） */
  minLimit?: number
  maxLimit?: number
  /** 是否启用按 resourceId 颜色过滤（仅拉取/传递/监听匹配颜色的资源 Token） */
  resourceFilter?: boolean
  /** 多色资源池随机抽取（Shuffle Source/Origin，默认 false 为 LIFO 后进先出） */
  shuffleOrigin?: boolean
  /** 是否标记为调平影响因子（Mark as influencer，供 Auto-Balancer 优先选为调优自变量） */
  influencer?: boolean
  label?: string
  notes?: string
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
  | { t: 'arr'; items: ExprNode[] }
  | { t: 'idx'; target: ExprNode; indices: ExprNode[] }
  | { t: 'un'; op: '-' | '+' | '!'; a: ExprNode }
  | { t: 'bin'; op: string; a: ExprNode; b: ExprNode }
  | { t: 'tern'; cond: ExprNode; a: ExprNode; b: ExprNode }
  | { t: 'call'; fn: string; args: ExprNode[] }

export interface MxExprContext {
  vars: Record<string, number>
  arrays?: Record<string, number[] | number[][]>
  rng: () => number
}

const exprCache = new Map<string, ExprNode | null>()

function sampleBoxMullerGaussian(rng: () => number, mean: number, std: number): number {
  const u1 = Math.max(1e-12, rng())
  const u2 = rng()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z0 * std
}

function tokenizeExpr(src: string): string[] | null {
  const tokens: string[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // 优先检查双字符运算符（特别是 '..' 必须在数字小数点之前匹配，防止 '3..6' 被拆成 '3.' 和 '.6'）
    const two = src.slice(i, i + 2)
    if (two === '<>') {
      tokens.push('!=')
      i += 2
      continue
    }
    if (
      two === '..' ||
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
    // dice: 2D6 / D20
    const diceMatch = /^(\d*)[dD](\d+)/.exec(src.slice(i))
    if (diceMatch && (i === 0 || !/[A-Za-z0-9_.]/.test(src[i - 1]!))) {
      tokens.push(`#dice:${diceMatch[1] || '1'}:${diceMatch[2]}`)
      i += diceMatch[0].length
      continue
    }
    const numMatch = /^(\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i))
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
    if ('+-*/%^(),<>!?:[]'.includes(ch)) {
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
    '..': 5,
    '+': 6,
    '-': 6,
    '*': 7,
    '/': 7,
    '%': 7,
    '^': 8
  }

  function attachSubscripts(base: ExprNode): ExprNode | null {
    let cur = base
    while (peek() === '[') {
      take()
      const indices: ExprNode[] = []
      if (peek() === ']') return null
      for (;;) {
        const idxExpr = ternary()
        if (!idxExpr) return null
        indices.push(idxExpr)
        if (peek() === ',') {
          take()
          continue
        }
        break
      }
      if (take() !== ']') return null
      cur = { t: 'idx', target: cur, indices }
    }
    return cur
  }

  function primary(): ExprNode | null {
    const tk = take()
    if (tk === undefined) return null
    if (tk === '(') {
      const inner = ternary()
      if (!inner || take() !== ')') return null
      return attachSubscripts(inner)
    }
    if (tk === '[') {
      const items: ExprNode[] = []
      if (peek() !== ']') {
        for (;;) {
          const item = ternary()
          if (!item) return null
          items.push(item)
          if (peek() === ',') {
            take()
            continue
          }
          break
        }
      }
      if (take() !== ']') return null
      return attachSubscripts({ t: 'arr', items })
    }
    if (tk === '-' || tk === '+' || tk === '!') {
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
            const arg = ternary()
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
        return attachSubscripts({ t: 'call', fn: tk.toLowerCase(), args })
      }
      return attachSubscripts({ t: 'id', name: tk })
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

  function ternary(): ExprNode | null {
    const cond = binary(0)
    if (!cond) return null
    if (peek() === '?') {
      take()
      const tBranch = ternary()
      if (!tBranch || take() !== ':') return null
      const fBranch = ternary()
      if (!fBranch) return null
      return { t: 'tern', cond, a: tBranch, b: fBranch }
    }
    return cond
  }

  const root = ternary()
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

function resolveArrayFromNode(node: ExprNode, ctx: MxExprContext): number[] | number[][] | null {
  if (node.t === 'id' && ctx.arrays) {
    if (node.name in ctx.arrays) return ctx.arrays[node.name]!
    const lower = node.name.toLowerCase()
    for (const k of Object.keys(ctx.arrays)) {
      if (k.toLowerCase() === lower) return ctx.arrays[k]!
    }
  } else if (node.t === 'arr') {
    if (node.items.length > 0 && node.items.every((it) => it.t === 'arr')) {
      return node.items.map((it) =>
        (it as { t: 'arr'; items: ExprNode[] }).items.map((sub) => evalAst(sub, ctx))
      )
    }
    return node.items.map((it) => evalAst(it, ctx))
  } else if (node.t === 'idx' && node.indices.length === 1) {
    const parentArr = resolveArrayFromNode(node.target, ctx)
    if (parentArr && parentArr.length > 0 && Array.isArray(parentArr[0])) {
      const rIdx = Math.max(
        0,
        Math.min(parentArr.length - 1, Math.round(evalAst(node.indices[0]!, ctx)))
      )
      return (parentArr as number[][])[rIdx] ?? null
    }
  }
  return null
}

function evalFlatValues(args: ExprNode[], ctx: MxExprContext): number[] {
  const out: number[] = []
  for (const arg of args) {
    const arr = resolveArrayFromNode(arg, ctx)
    if (arr) {
      for (const item of arr) {
        if (Array.isArray(item)) out.push(...item)
        else out.push(item)
      }
    } else {
      out.push(evalAst(arg, ctx))
    }
  }
  return out
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
      if (lower === 'true') return 1
      if (lower === 'false') return 0
      for (const k of Object.keys(ctx.vars)) if (k.toLowerCase() === lower) return ctx.vars[k]!
      const arr = resolveArrayFromNode(node, ctx)
      if (arr && arr.length > 0) {
        const first = arr[0]
        return Array.isArray(first) ? (first[0] ?? 0) : (first ?? 0)
      }
      return 0
    }
    case 'arr': {
      if (!node.items.length) return 0
      return evalAst(node.items[0]!, ctx)
    }
    case 'idx': {
      const arr = resolveArrayFromNode(node.target, ctx)
      if (!arr || !arr.length) return 0
      if (Array.isArray(arr[0])) {
        const mat = arr as number[][]
        const r = Math.max(0, Math.min(mat.length - 1, Math.round(evalAst(node.indices[0]!, ctx))))
        const row = mat[r] ?? []
        if (!row.length) return 0
        const c =
          node.indices.length >= 2
            ? Math.max(0, Math.min(row.length - 1, Math.round(evalAst(node.indices[1]!, ctx))))
            : 0
        return row[c] ?? 0
      }
      const vec = arr as number[]
      const i = Math.max(0, Math.min(vec.length - 1, Math.round(evalAst(node.indices[0]!, ctx))))
      return vec[i] ?? 0
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
      if (node.op === '!') return a === 0 ? 1 : 0
      return node.op === '-' ? -a : a
    }
    case 'tern': {
      const c = evalAst(node.cond, ctx)
      return c !== 0 ? evalAst(node.a, ctx) : evalAst(node.b, ctx)
    }
    case 'bin': {
      if (node.op === '&&') {
        return evalAst(node.a, ctx) !== 0 && evalAst(node.b, ctx) !== 0 ? 1 : 0
      }
      if (node.op === '||') {
        return evalAst(node.a, ctx) !== 0 || evalAst(node.b, ctx) !== 0 ? 1 : 0
      }
      const a = evalAst(node.a, ctx)
      const b = evalAst(node.b, ctx)
      switch (node.op) {
        case '..': {
          const lo = Math.ceil(Math.min(a, b))
          const hi = Math.floor(Math.max(a, b))
          if (hi <= lo) return lo
          return lo + Math.floor(ctx.rng() * (hi - lo + 1))
        }
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
        default:
          return 0
      }
    }
    case 'call': {
      // Lazy-evaluated conditional functions
      if (node.fn === 'if') {
        const cond = node.args[0] ? evalAst(node.args[0], ctx) : 0
        return cond !== 0
          ? node.args[1]
            ? evalAst(node.args[1], ctx)
            : 0
          : node.args[2]
            ? evalAst(node.args[2], ctx)
            : 0
      }
      // Array-aware Math.js functions
      if (
        node.fn === 'min' ||
        node.fn === 'max' ||
        node.fn === 'sum' ||
        node.fn === 'mean' ||
        node.fn === 'avg' ||
        node.fn === 'median' ||
        node.fn === 'std' ||
        node.fn === 'variance' ||
        node.fn === 'pickrandom'
      ) {
        const vals = evalFlatValues(node.args, ctx)
        if (!vals.length) return 0
        switch (node.fn) {
          case 'min':
            return Math.min(...vals)
          case 'max':
            return Math.max(...vals)
          case 'sum':
            return vals.reduce((s, x) => s + x, 0)
          case 'mean':
          case 'avg':
            return vals.reduce((s, x) => s + x, 0) / vals.length
          case 'median': {
            const sorted = [...vals].sort((x, y) => x - y)
            const mid = Math.floor(sorted.length / 2)
            return sorted.length % 2 === 1
              ? sorted[mid]!
              : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
          }
          case 'variance':
          case 'std': {
            if (vals.length <= 1) return 0
            const mu = vals.reduce((s, x) => s + x, 0) / vals.length
            const sq = vals.reduce((s, x) => s + (x - mu) * (x - mu), 0) / vals.length
            return node.fn === 'std' ? Math.sqrt(sq) : sq
          }
          case 'pickrandom':
            return vals[Math.floor(ctx.rng() * vals.length)] ?? 0
        }
      }

      const args = node.args.map((a) => evalAst(a, ctx))
      switch (node.fn) {
        // Math.js arithmetic & algebraic
        case 'add':
          return (args[0] ?? 0) + (args[1] ?? 0)
        case 'subtract':
          return (args[0] ?? 0) - (args[1] ?? 0)
        case 'multiply':
          return (args[0] ?? 0) * (args[1] ?? 0)
        case 'divide':
          return (args[1] ?? 0) === 0 ? 0 : (args[0] ?? 0) / (args[1] ?? 1)
        case 'mod': {
          const b = args[1] ?? 0
          if (b === 0) return 0
          const a = args[0] ?? 0
          return ((a % b) + b) % b
        }
        case 'sign':
          return Math.sign(args[0] ?? 0)
        case 'square': {
          const x = args[0] ?? 0
          return x * x
        }
        case 'cube': {
          const x = args[0] ?? 0
          return x * x * x
        }
        case 'cbrt':
          return Math.cbrt(args[0] ?? 0)
        case 'hypot':
          return Math.hypot(...args)
        case 'floor':
          return Math.floor(args[0] ?? 0)
        case 'ceil':
          return Math.ceil(args[0] ?? 0)
        case 'round': {
          const decimals = args[1] != null ? Math.max(0, Math.min(8, Math.round(args[1]))) : 0
          if (decimals === 0) return Math.round(args[0] ?? 0)
          const f = Math.pow(10, decimals)
          return Math.round((args[0] ?? 0) * f) / f
        }
        case 'abs':
          return Math.abs(args[0] ?? 0)
        case 'sqrt':
          return Math.sqrt(Math.max(0, args[0] ?? 0))
        case 'pow':
          return Math.pow(args[0] ?? 0, args[1] ?? 1)
        case 'exp':
          return Math.exp(Math.min(80, args[0] ?? 0))
        case 'log':
          return args[1] != null
            ? Math.log(Math.max(1e-9, args[0] ?? 1)) / Math.log(Math.max(1e-9, args[1] || Math.E))
            : Math.log(Math.max(1e-9, args[0] ?? 1))
        case 'log10':
          return Math.log10(Math.max(1e-9, args[0] ?? 1))
        case 'log2':
          return Math.log2(Math.max(1e-9, args[0] ?? 1))
        case 'clamp':
          return Math.max(args[1] ?? 0, Math.min(args[2] ?? 0, args[0] ?? 0))
        // Math.js relational & logical functions (used in Machinations Combining Conditions: largerEq(a,2)*(c+4))
        case 'larger':
          return (args[0] ?? 0) > (args[1] ?? 0) ? 1 : 0
        case 'largereq':
          return (args[0] ?? 0) >= (args[1] ?? 0) ? 1 : 0
        case 'smaller':
          return (args[0] ?? 0) < (args[1] ?? 0) ? 1 : 0
        case 'smallereq':
          return (args[0] ?? 0) <= (args[1] ?? 0) ? 1 : 0
        case 'equal':
          return Math.abs((args[0] ?? 0) - (args[1] ?? 0)) < 1e-9 ? 1 : 0
        case 'unequal':
          return Math.abs((args[0] ?? 0) - (args[1] ?? 0)) >= 1e-9 ? 1 : 0
        case 'and':
          return args.length ? (args.every((v) => v !== 0) ? 1 : 0) : 0
        case 'or':
          return args.some((v) => v !== 0) ? 1 : 0
        case 'not':
          return (args[0] ?? 0) === 0 ? 1 : 0
        case 'xor':
          return ((args[0] ?? 0) !== 0) !== ((args[1] ?? 0) !== 0) ? 1 : 0
        // Trigonometry
        case 'sin':
          return Math.sin(args[0] ?? 0)
        case 'cos':
          return Math.cos(args[0] ?? 0)
        case 'tan':
          return Math.tan(args[0] ?? 0)
        case 'asin':
          return Math.asin(Math.max(-1, Math.min(1, args[0] ?? 0)))
        case 'acos':
          return Math.acos(Math.max(-1, Math.min(1, args[0] ?? 0)))
        case 'atan':
          return Math.atan(args[0] ?? 0)
        case 'atan2':
          return Math.atan2(args[0] ?? 0, args[1] ?? 1)
        // Randomness & distributions
        case 'random': {
          const lo = args[0] ?? 0
          const hi = args[1] ?? 1
          return lo + ctx.rng() * (hi - lo)
        }
        case 'randint':
        case 'randomint': {
          const lo = Math.ceil(Math.min(args[0] ?? 0, args[1] ?? 1))
          const hi = Math.floor(Math.max(args[0] ?? 0, args[1] ?? 1))
          return lo + Math.floor(ctx.rng() * Math.max(1, hi - lo + 1))
        }
        case 'norm':
        case 'gaussian':
        case 'normal': {
          const mean = args[0] ?? 0
          const std = Math.max(0, args[1] ?? 1)
          return sampleBoxMullerGaussian(ctx.rng, mean, std)
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
  'sum',
  'mean',
  'avg',
  'median',
  'std',
  'variance',
  'pickrandom',
  'add',
  'subtract',
  'multiply',
  'divide',
  'mod',
  'sign',
  'square',
  'cube',
  'cbrt',
  'hypot',
  'floor',
  'ceil',
  'round',
  'abs',
  'sqrt',
  'pow',
  'exp',
  'log',
  'log10',
  'log2',
  'clamp',
  'larger',
  'largereq',
  'smaller',
  'smallereq',
  'equal',
  'unequal',
  'and',
  'or',
  'not',
  'xor',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'if',
  'random',
  'randint',
  'randomint',
  'norm',
  'gaussian',
  'normal',
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

  // 检查圆括号与方括号配对
  let depthParen = 0
  let depthBracket = 0
  for (const ch of s) {
    if (ch === '(') depthParen++
    else if (ch === ')') {
      depthParen--
      if (depthParen < 0)
        return { valid: false, error: 'Unmatched closing parenthesis ")"', referencedVars: [] }
    } else if (ch === '[') depthBracket++
    else if (ch === ']') {
      depthBracket--
      if (depthBracket < 0)
        return { valid: false, error: 'Unmatched closing bracket "]"', referencedVars: [] }
    }
  }
  if (depthParen !== 0) {
    return { valid: false, error: 'Unclosed parenthesis "("', referencedVars: [] }
  }
  if (depthBracket !== 0) {
    return { valid: false, error: 'Unclosed bracket "["', referencedVars: [] }
  }

  const exprsToCheck: string[] = []
  if (kind === 'resource') {
    // Gate 分流资源边支持条件公式（如 "<4", ">=4", "<>1", "1..2"，且允许附带 "|interval"）
    const spec = parseMxFlowFormula(s)
    const coreRaw = s.replace(/\s*(?:\bevery\b|(?<!\|)\|(?!\|)).*$/i, '').trim()
    const asGateCond = parseMxStateFormula(coreRaw)
    if (asGateCond.type === 'activator' || asGateCond.type === 'range') {
      if (spec.intervalExpr) exprsToCheck.push(spec.intervalExpr)
      else return { valid: true, referencedVars: [] }
    } else if (asGateCond.type === 'expr' && /^(?:>=|<=|==|!=|<>|>|<|=)/.test(coreRaw)) {
      exprsToCheck.push(asGateCond.expr)
      if (spec.intervalExpr) exprsToCheck.push(spec.intervalExpr)
    } else {
      if (spec.type === 'all') {
        if (spec.intervalExpr) exprsToCheck.push(spec.intervalExpr)
        else return { valid: true, referencedVars: [] }
      } else {
        exprsToCheck.push(spec.expr)
        if (spec.intervalExpr) exprsToCheck.push(spec.intervalExpr)
      }
    }
  } else if (kind === 'state' || kind === 'end') {
    const spec = parseMxStateFormula(s)
    if (spec.type !== 'expr') return { valid: true, referencedVars: [] }
    const signedVarMod =
      kind === 'state' ? /^[+-]\s*([A-Za-z_][A-Za-z0-9_]*)\s*%?\s*i?$/i.exec(spec.expr) : null
    if (signedVarMod) {
      exprsToCheck.push(signedVarMod[1]!)
    } else {
      exprsToCheck.push(spec.expr)
    }
  } else {
    exprsToCheck.push(s)
  }

  const vars = new Set<string>()
  let unknownFn: string | null = null
  const walk = (n: ExprNode): void => {
    if (n.t === 'id') {
      const low = n.name.toLowerCase()
      if (
        low !== 'pi' &&
        low !== 'e' &&
        low !== 'step' &&
        low !== 't' &&
        low !== 'self' &&
        low !== 'true' &&
        low !== 'false'
      ) {
        vars.add(n.name)
      }
    } else if (n.t === 'arr') {
      n.items.forEach(walk)
    } else if (n.t === 'idx') {
      walk(n.target)
      n.indices.forEach(walk)
    } else if (n.t === 'un') {
      walk(n.a)
    } else if (n.t === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'tern') {
      walk(n.cond)
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'call') {
      if (!KNOWN_MX_FUNCTIONS.has(n.fn)) unknownFn = n.fn
      n.args.forEach(walk)
    }
  }

  for (const exprStr of exprsToCheck) {
    const tokens = tokenizeExpr(exprStr)
    if (!tokens || !tokens.length) {
      return { valid: false, error: 'Invalid formula syntax', referencedVars: [] }
    }
    const ast = parseExprTokens(tokens)
    if (!ast) {
      return { valid: false, error: 'Incomplete or malformed expression', referencedVars: [] }
    }
    walk(ast)
  }
  if (unknownFn) {
    return {
      valid: false,
      error: `Unknown function "${unknownFn}()"`,
      referencedVars: [...vars]
    }
  }
  return { valid: true, referencedVars: [...vars] }
}

const PURE_DECIMAL_LITERAL_RE = /^-?\d{1,15}(?:\.\d{1,15})?$/

/** 求值任意表达式；语法错误返回 fallback */
export function evaluateMxExpression(
  src: string | undefined,
  ctx: MxExprContext,
  fallback = 0
): number {
  if (!src) return fallback
  const trimmed = src.trim()
  if (!trimmed) return fallback
  if (PURE_DECIMAL_LITERAL_RE.test(trimmed)) return Number(trimmed)
  const ast = parseMxExpression(trimmed)
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
  | { type: 'all'; every?: number; intervalExpr?: string }
  | {
      type: 'expr'
      expr: string
      probability?: number
      every?: number
      intervalExpr?: string
    }

const flowSpecCache = new Map<string, MxFlowSpec>()

/**
 * 解析资源连线流量：
 * - `` / `1` / `Gold*0.1` → 表达式
 * - `all` / `all|3` → 全部
 * - `50%` → 概率 0.5 传 1 个；`250%` → 保底传 2 个 + 50% 概率额外传第 3 个；`3 50%` 或 `3@50%` → 概率 0.5 传 3 个
 * - `2 every 3` / `2|3` / `D6|D6` / `1|3..6` → 支持常数、随机区间、骰子与表达式间隔
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
    let intervalExpr: string | undefined
    // 匹配单竖线 `|`（排除逻辑或 `||`）或关键字 `every`
    const intervalSplit = /^(.*?)\s*(?:\bevery\b|(?<!\|)\|(?!\|))\s*(.+)$/i.exec(rest)
    if (intervalSplit && intervalSplit[2]!.trim()) {
      const rawIv = intervalSplit[2]!.trim()
      intervalExpr = rawIv
      if (/^\d+$/.test(rawIv)) {
        every = Math.max(1, Number(rawIv))
      }
      rest = intervalSplit[1]!.trim() || '1'
    }
    if (/^all$/i.test(rest)) {
      result = {
        type: 'all',
        ...(every !== undefined ? { every } : {}),
        ...(intervalExpr !== undefined ? { intervalExpr } : {})
      }
    } else {
      const probOnly = /^(\d+(?:\.\d+)?)\s*%$/.exec(rest)
      if (probOnly) {
        result = {
          type: 'expr',
          expr: '1',
          probability: Number(probOnly[1]) / 100,
          ...(every !== undefined ? { every } : {}),
          ...(intervalExpr !== undefined ? { intervalExpr } : {})
        }
      } else {
        let probability: number | undefined
        const probSuffix = /^(.*?)\s*@?\s*(\d+(?:\.\d+)?)\s*%$/.exec(rest)
        if (probSuffix && probSuffix[1]!.trim()) {
          probability = Number(probSuffix[2]) / 100
          rest = probSuffix[1]!.trim().replace(/@$/, '').trim()
        }
        result = {
          type: 'expr',
          expr: rest || '1',
          ...(probability !== undefined ? { probability } : {}),
          ...(every !== undefined ? { every } : {}),
          ...(intervalExpr !== undefined ? { intervalExpr } : {})
        }
      }
    }
  }
  if (flowSpecCache.size > 4000) flowSpecCache.clear()
  flowSpecCache.set(s, result)
  return result
}

export type MxStateSpec =
  | { type: 'modifier'; delta: number; percent: boolean }
  | { type: 'fraction_modifier'; numerator: number; denominator: number }
  | { type: 'interval_modifier'; delta: number; percent: boolean }
  | { type: 'overwrite' }
  | { type: 'probability'; pct: number }
  | { type: 'activator'; op: '>' | '<' | '>=' | '<=' | '==' | '!='; value: number }
  | { type: 'range'; lo: number; hi: number }
  | { type: 'trigger' }
  | { type: 'reverse_trigger' }
  | { type: 'expr'; expr: string }

const stateSpecCache = new Map<string, MxStateSpec>()

/**
 * 解析状态连线标签（对齐 Machinations.io 全部 8 类 State Connection 公式）：
 * - `*` / 空 → Trigger
 * - `!` → Reverse Trigger
 * - `=` → Overwrite（节点值覆盖 / 连线公式值覆盖）
 * - `+2i` / `-1i` / `+50%i` → Interval Modifier（动态修改资源连线间隔）
 * - `+1/3` / `-2/4` → Fractional Node Modifier（每满 denominator 步进修改 numerator）
 * - `+2` / `-0.5` / `+10%` → Node / Formula Modifier
 * - `20%` → Probability（用于 Trigger Gate / Mixed Gate 状态触发概率）
 * - `>=5` / `==0` / `=4` / `!=1` / `>=Price` → Condition Activator
 * - `2..8` → Range Condition
 */
export function parseMxStateFormula(raw: string | undefined): MxStateSpec {
  const s = (raw ?? '').trim()
  const cached = stateSpecCache.get(s)
  if (cached) return cached
  let result: MxStateSpec
  if (!s || s === '*') {
    result = { type: 'trigger' }
  } else if (s === '!') {
    result = { type: 'reverse_trigger' }
  } else if (s === '=') {
    result = { type: 'overwrite' }
  } else {
    const ivMod = /^([+-])\s*(\d+(?:\.\d+)?)\s*(%?)\s*i$/i.exec(s)
    if (ivMod) {
      const delta = Number(ivMod[2]) * (ivMod[1] === '-' ? -1 : 1)
      result = { type: 'interval_modifier', delta, percent: ivMod[3] === '%' }
    } else {
      const fracMod = /^([+-])\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s)
      if (fracMod && Number(fracMod[3]) > 0) {
        const numerator = Number(fracMod[2]) * (fracMod[1] === '-' ? -1 : 1)
        result = { type: 'fraction_modifier', numerator, denominator: Number(fracMod[3]) }
      } else {
        const probState = /^(\d+(?:\.\d+)?)\s*%$/.exec(s)
        if (probState) {
          result = { type: 'probability', pct: Number(probState[1]) }
        } else {
          const range = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/.exec(s)
          if (range) {
            result = { type: 'range', lo: Number(range[1]), hi: Number(range[2]) }
          } else {
            const act = /^(>=|<=|==|!=|<>|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(s)
            if (act) {
              const op =
                act[1] === '='
                  ? '=='
                  : act[1] === '<>'
                    ? '!='
                    : (act[1] as '>' | '<' | '>=' | '<=' | '==' | '!=')
              result = { type: 'activator', op, value: Number(act[2]) }
            } else {
              const mod = /^([+-])\s*(\d+(?:\.\d+)?)\s*(%?)$/.exec(s)
              if (mod) {
                const delta = Number(mod[2]) * (mod[1] === '-' ? -1 : 1)
                result = { type: 'modifier', delta, percent: mod[3] === '%' }
              } else {
                const actExpr = /^(>=|<=|==|!=|<>|>|<|=)\s*(.+)$/.exec(s)
                if (actExpr && actExpr[2]!.trim()) {
                  const op = actExpr[1] === '=' ? '==' : actExpr[1] === '<>' ? '!=' : actExpr[1]!
                  result = { type: 'expr', expr: `a ${op} (${actExpr[2]!.trim()})` }
                } else {
                  result = { type: 'expr', expr: s }
                }
              }
            }
          }
        }
      }
    }
  }
  if (stateSpecCache.size > 4000) stateSpecCache.clear()
  stateSpecCache.set(s, result)
  return result
}

const MX_BOOLEAN_STATE_EXPR_RE =
  /[<>=!]|(?:\b(?:larger|largereq|smaller|smallereq|equal|unequal|and|or|not|xor)\s*\()/i

/** 判断状态连线 `expr` 公式是否为布尔激活条件（含比较运算符或 Math.js 关系/逻辑函数） */
export function isMxBooleanStateExpr(expr: string): boolean {
  return MX_BOOLEAN_STATE_EXPR_RE.test(expr)
}

function parseSignedVarStateModifier(
  expr: string
): { sign: 1 | -1; ident: string; percent: boolean; interval: boolean } | null {
  const m = /^([+-])\s*([A-Za-z_][A-Za-z0-9_]*)\s*(%?)\s*(i?)$/i.exec(expr.trim())
  if (!m) return null
  const ident = m[2]!
  const low = ident.toLowerCase()
  if (
    low === 'a' ||
    low === 'self' ||
    low === 'step' ||
    low === 't' ||
    low === 'true' ||
    low === 'false'
  ) {
    return null
  }
  return {
    sign: m[1] === '-' ? -1 : 1,
    ident,
    percent: m[3] === '%',
    interval: m[4]?.toLowerCase() === 'i'
  }
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

export interface MxPoolTokenStackItem {
  resId: string
  count: number
}

export interface MxBufferItem {
  release: number
  amount: number
  resourceId?: string
}

export interface MxRuntimeState {
  step: number
  /** Pool / Register / Delay / Queue / Converter 缓冲的数值 */
  values: Record<string, number>
  /** 上一步各节点是否处于激活状态 */
  active: Record<string, boolean>
  /** Gate 确定性分流游标 */
  gateCursor: Record<string, number>
  /** Delay / Queue 缓冲：[释放步, 数量, 资源颜色] */
  buffers: Record<string, MxBufferItem[]>
  /** 每条边本步实际流量 */
  edgeFlows: Record<string, number>
  /** 本步触发 / 执行过的节点 */
  fired: Record<string, boolean>
  ended: boolean
  endReason?: string
  totalProduced: number
  totalConsumed: number
  /** Node Modifier 状态边上一次已传导的源节点数值（按状态边 ID 追踪 ΔS） */
  prevEdgeOrigin?: Record<string, number>
  /** 资源边上次成功触发的步数与当前采样的等待间隔（支持 1|3..6、D6|D6 与 +xi 动态间隔） */
  edgeLastStep?: Record<string, number>
  edgeWaitSteps?: Record<string, number>
  /** Gate 触发计数、配额计数与随机周期剩余配额 */
  gateTrigCount?: Record<string, number>
  gateQuotaSent?: Record<string, number>
  gateLastRoll?: Record<string, number>
  /** 多色资源池 Token 栈（LIFO 默认，支持按颜色过滤与 shuffleOrigin 随机抽取） */
  poolTokens?: Record<string, MxPoolTokenStackItem[]>
  /** 运行时采样的 Custom Variables 参数值 */
  runtimeParams?: Record<string, number>
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

function capOf(node: MxNode): number {
  if (node.capacity == null || node.capacity <= 0) return Number.POSITIVE_INFINITY
  return node.capacity
}

function parseNumericArrayLiteral(raw: string | undefined): number[] | number[][] | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s.startsWith('[') || !s.endsWith(']')) return null
  try {
    const parsed = JSON.parse(s)
    if (!Array.isArray(parsed) || !parsed.length) return null
    if (Array.isArray(parsed[0])) {
      return parsed.map((row) =>
        Array.isArray(row) ? row.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) : [0]
      )
    }
    return parsed.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
  } catch {
    return null
  }
}

function buildParamArrays(doc: MxDocument): Record<string, number[] | number[][]> | undefined {
  let out: Record<string, number[] | number[][]> | undefined
  for (const p of doc.params) {
    const name = mxIdentifier(p.name)
    if (!name) continue
    const arr =
      p.values && Array.isArray(p.values) && p.values.length
        ? p.values
        : parseNumericArrayLiteral(p.formula)
    if (arr) {
      if (!out) out = {}
      out[name] = arr
    }
  }
  return out
}

function sampleCustomParamValue(
  p: MxParam,
  rng: () => number,
  scalars: Record<string, number>,
  arrays?: Record<string, number[] | number[][]>
): number {
  const kind = p.varKind ?? 'number'
  if (kind === 'random_range') {
    const lo = p.min ?? 0
    const hi = p.max ?? lo + 10
    if (p.distribution === 'gaussian') {
      const mean = p.mean ?? (lo + hi) / 2
      const std = p.std ?? Math.max(1e-6, Math.abs(hi - lo) / 6)
      let v = sampleBoxMullerGaussian(rng, mean, std)
      if (p.min != null) v = Math.max(p.min, v)
      if (p.max != null) v = Math.min(p.max, v)
      return p.integerOnly ? Math.round(v) : Math.round(v * 1000) / 1000
    }
    if (p.integerOnly) {
      const ilo = Math.ceil(Math.min(lo, hi))
      const ihi = Math.floor(Math.max(lo, hi))
      return ilo + Math.floor(rng() * Math.max(1, ihi - ilo + 1))
    }
    return Math.round((lo + rng() * (hi - lo)) * 1000) / 1000
  }
  if (kind === 'random_array') {
    const arr =
      (p.values && Array.isArray(p.values) ? p.values : parseNumericArrayLiteral(p.formula)) ?? []
    const flat: number[] = []
    for (const item of arr) {
      if (Array.isArray(item)) flat.push(...item)
      else if (Number.isFinite(item)) flat.push(item)
    }
    if (!flat.length) return p.value
    return flat[Math.floor(rng() * flat.length)] ?? p.value
  }
  if (kind === 'expr' && p.formula?.trim() && !p.formula.trim().startsWith('[')) {
    return evaluateMxExpression(p.formula, { vars: scalars, arrays, rng }, p.value)
  }
  return p.value
}

export function resolveMxParams(
  doc: MxDocument,
  scenarioId?: string,
  rng?: () => number
): Record<string, number> {
  const out: Record<string, number> = {}
  const arrays = buildParamArrays(doc)
  for (const p of doc.params) {
    const name = mxIdentifier(p.name)
    if (!name) continue
    if (rng && p.varKind && p.varKind !== 'number' && p.varKind !== 'array') {
      out[name] = sampleCustomParamValue(p, rng, out, arrays)
    } else {
      out[name] = p.value
    }
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
const POSITIONAL_LETTERS = 'abcdefghijklmnopqrstuvwxyz'

interface MxGraphIndex {
  byId: Map<string, MxNode>
  edgeById: Map<string, MxEdge>
  identEntries: Array<{ id: string; ident: string }>
  registers: MxNode[]
  delaysAndQueues: MxNode[]
  endNodes: MxNode[]
  nodeModTargets: MxNode[]
  triggerOnPools: MxNode[]
  nodesByKind: Map<MxNodeKind, MxNode[]>
  outResByNode: Map<string, MxEdge[]>
  inResByNode: Map<string, MxEdge[]>
  stateInByNode: Map<string, MxEdge[]>
  stateOutByNode: Map<string, MxEdge[]>
  stateInByEdge: Map<string, MxEdge[]>
  resEdgeById: Map<string, MxEdge>
  hasMultiColorResources: boolean
  paramArrays?: Record<string, number[] | number[][]>
}

const graphIndexCache = new WeakMap<
  MxDocument,
  {
    nodesRef: MxNode[]
    edgesRef: MxEdge[]
    paramsRef: MxParam[]
    countN: number
    countE: number
    countP: number
    idx: MxGraphIndex
  }
>()

function isFunctionRegisterNode(node: MxNode): boolean {
  if (node.kind !== 'register') return false
  const f = (node.formula ?? '').trim()
  if (!f) return false
  // 纯常数（如 "10"）且带有状态修改输入时可作为被修改的值寄存器；含变量/运算符则为函数寄存器
  return !/^-?\d+(?:\.\d+)?$/.test(f)
}

function getMxGraphIndex(doc: MxDocument): MxGraphIndex {
  const cached = graphIndexCache.get(doc)
  if (
    cached &&
    cached.nodesRef === doc.nodes &&
    cached.edgesRef === doc.edges &&
    cached.paramsRef === doc.params &&
    cached.countN === doc.nodes.length &&
    cached.countE === doc.edges.length &&
    cached.countP === doc.params.length
  ) {
    return cached.idx
  }
  const byId = new Map<string, MxNode>()
  const edgeById = new Map<string, MxEdge>()
  const identEntries: Array<{ id: string; ident: string }> = []
  const registers: MxNode[] = []
  const delaysAndQueues: MxNode[] = []
  const endNodes: MxNode[] = []
  const triggerOnPools: MxNode[] = []
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
    else if (n.kind === 'pool' && n.triggerOn) triggerOnPools.push(n)
    let kArr = nodesByKind.get(n.kind)
    if (!kArr) {
      kArr = []
      nodesByKind.set(n.kind, kArr)
    }
    kArr.push(n)
  }
  for (const e of doc.edges) {
    edgeById.set(e.id, e)
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

  const nodeModTargets: MxNode[] = []
  for (const n of doc.nodes) {
    if (n.kind !== 'pool' && n.kind !== 'register') continue
    const sIns = stateInByNode.get(n.id)
    if (!sIns || !sIns.length) continue
    const isFuncReg = isFunctionRegisterNode(n)
    const hasNodeMod = sIns.some((se) => {
      const sp = parseMxStateFormula(se.formula)
      if (sp.type === 'overwrite') return true
      if (isFuncReg) return false
      if (sp.type === 'modifier' || sp.type === 'fraction_modifier') return true
      if (sp.type === 'expr') {
        const sv = parseSignedVarStateModifier(sp.expr)
        if (sv && !sv.interval) return true
      }
      return false
    })
    if (hasNodeMod) nodeModTargets.push(n)
  }

  const usedResIds = new Set<string>()
  let hasResourceFilter = false
  for (const n of doc.nodes) {
    if (n.resourceId && n.resourceId !== 'default') usedResIds.add(n.resourceId)
  }
  for (const e of doc.edges) {
    if (e.resourceFilter) hasResourceFilter = true
    if (e.resourceId && e.resourceId !== 'default') usedResIds.add(e.resourceId)
  }
  const hasMultiColorResources = hasResourceFilter || usedResIds.size > 1

  const idx: MxGraphIndex = {
    byId,
    edgeById,
    identEntries,
    registers,
    delaysAndQueues,
    endNodes,
    nodeModTargets,
    triggerOnPools,
    nodesByKind,
    outResByNode,
    inResByNode,
    stateInByNode,
    stateOutByNode,
    stateInByEdge,
    resEdgeById,
    hasMultiColorResources,
    paramArrays: buildParamArrays(doc)
  }
  graphIndexCache.set(doc, {
    nodesRef: doc.nodes,
    edgesRef: doc.edges,
    paramsRef: doc.params,
    countN: doc.nodes.length,
    countE: doc.edges.length,
    countP: doc.params.length,
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
    } else if (n.t === 'arr') {
      n.items.forEach(walk)
    } else if (n.t === 'idx') {
      walk(n.target)
      n.indices.forEach(walk)
    } else if (n.t === 'un') {
      walk(n.a)
    } else if (n.t === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'tern') {
      walk(n.cond)
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
  const vars: Record<string, number> = { ...params, step, STEP: step, t: step }
  const idx = getMxGraphIndex(doc)
  for (const entry of idx.identEntries) {
    const val = values[entry.id] ?? 0
    if (entry.ident && !(entry.ident in params)) vars[entry.ident] = val
    vars[entry.id] = val
  }
  return vars
}

export interface MxEdgeNodeReference {
  nodeId: string
  token: string
}

export interface MxNodeFormulaReference extends MxEdgeNodeReference {
  sourceField: 'formula' | 'botCondition'
  formula: string
}

export interface MxNodeConsumerNodeHit {
  consumerNodeId: string
  sourceNodeId: string
  token: string
  sourceField: 'formula' | 'botCondition'
  formula: string
}

export interface MxNodeConsumerEdgeHit {
  consumerEdgeId: string
  sourceNodeId: string
  token: string
  formula: string
  /** 从被选节点直接发出的状态激活条件边或条件门分支（已有实体连线，仅高亮条件胶囊而不重复绘制虚线） */
  isDirectStateCondition?: boolean
}

export interface MxNodeConsumerParamHit {
  consumerParamId: string
  paramName: string
  sourceNodeId: string
  token: string
  formula: string
}

export interface MxNodeConsumersResult {
  nodes: MxNodeConsumerNodeHit[]
  edges: MxNodeConsumerEdgeHit[]
  params: MxNodeConsumerParamHit[]
}

function extractMxFormulaNodeRefsFromSegments(
  doc: MxDocument,
  exprSegments: string[],
  rawTextForUnicode: string,
  localBindings?: ReadonlyMap<string, string>,
  allowParamBridge = true
): MxEdgeNodeReference[] {
  const gIdx = getMxGraphIndex(doc)
  const paramNames = new Set<string>()
  const paramLower = new Set<string>()
  const exprParamByKey = new Map<string, MxParam>()
  for (const p of doc.params) {
    const pk = mxIdentifier(p.name)
    if (pk) {
      paramNames.add(pk)
      paramLower.add(pk.toLowerCase())
      if (p.varKind === 'expr' && p.formula?.trim()) {
        exprParamByKey.set(pk, p)
        exprParamByKey.set(pk.toLowerCase(), p)
      }
    }
  }

  const varToNodeId = new Map<string, string>()
  for (const entry of gIdx.identEntries) {
    const node = gIdx.byId.get(entry.id)
    if (!node || node.kind === 'note') continue
    if (entry.ident && !paramNames.has(entry.ident)) {
      varToNodeId.set(entry.ident, entry.id)
    }
    varToNodeId.set(entry.id, entry.id)
  }
  if (localBindings) {
    for (const [k, nid] of localBindings.entries()) {
      varToNodeId.set(k, nid)
    }
  }

  const lowerVarToNodeId = new Map<string, string>()
  for (const [k, nid] of varToNodeId.entries()) {
    lowerVarToNodeId.set(k.toLowerCase(), nid)
  }

  const extractedTokens: string[] = []
  const skipBuiltins = new Set(['pi', 'step', 't', 'true', 'false', 'all', 'every'])

  const walkAst = (n: ExprNode): void => {
    if (n.t === 'id') {
      const low = n.name.toLowerCase()
      if (skipBuiltins.has(low)) return
      if (low === 'e' && !varToNodeId.has('e')) return
      extractedTokens.push(n.name)
    } else if (n.t === 'arr') {
      n.items.forEach(walkAst)
    } else if (n.t === 'idx') {
      walkAst(n.target)
      n.indices.forEach(walkAst)
    } else if (n.t === 'un') {
      walkAst(n.a)
    } else if (n.t === 'bin') {
      walkAst(n.a)
      walkAst(n.b)
    } else if (n.t === 'tern') {
      walkAst(n.cond)
      walkAst(n.a)
      walkAst(n.b)
    } else if (n.t === 'call') {
      n.args.forEach(walkAst)
    }
  }

  for (const seg of exprSegments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    const toks = tokenizeExpr(trimmed)
    const ast = toks && toks.length ? parseExprTokens(toks) : null
    if (ast) {
      walkAst(ast)
    } else {
      const re = /([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g
      let m: RegExpExecArray | null
      while ((m = re.exec(trimmed)) !== null) {
        if (m[2]) continue
        const ident = m[1]!
        if (/^\d*[dD]\d+$/.test(ident)) continue
        const low = ident.toLowerCase()
        if (skipBuiltins.has(low)) continue
        if (low === 'e' && !varToNodeId.has('e')) continue
        if (
          KNOWN_MX_FUNCTIONS.has(low) &&
          !varToNodeId.has(ident) &&
          !lowerVarToNodeId.has(low) &&
          !exprParamByKey.has(low)
        ) {
          continue
        }
        extractedTokens.push(ident)
      }
    }
  }

  const byNodeId = new Map<string, Set<string>>()
  const orderedNodeIds: string[] = []
  const addRef = (nodeId: string, token: string): void => {
    let set = byNodeId.get(nodeId)
    if (!set) {
      set = new Set<string>()
      byNodeId.set(nodeId, set)
      orderedNodeIds.push(nodeId)
    }
    set.add(token)
  }

  for (const tok of extractedTokens) {
    const exact = varToNodeId.get(tok)
    const resolved =
      exact ??
      (!paramLower.has(tok.toLowerCase()) ? lowerVarToNodeId.get(tok.toLowerCase()) : undefined)
    if (resolved && gIdx.byId.has(resolved)) {
      addRef(resolved, tok)
      continue
    }
    if (allowParamBridge) {
      const bridgedParam = exprParamByKey.get(tok) ?? exprParamByKey.get(tok.toLowerCase())
      if (bridgedParam) {
        const innerRefs = resolveMxParamReferencedNodes(doc, bridgedParam)
        for (const ir of innerRefs) {
          addRef(ir.nodeId, tok)
        }
      }
    }
  }

  // 支持直接书写含中文/非 ASCII 节点标题的公式定位（按标题长度降序匹配，防止子串误命中）
  const combinedRaw = rawTextForUnicode.trim()
  if (/[^\x00-\x7f]/.test(combinedRaw)) {
    const unicodeNodes = doc.nodes
      .filter((n) => n.kind !== 'note' && /[^\x00-\x7f]/.test(n.label.trim()))
      .sort((a, b) => b.label.trim().length - a.label.trim().length)
    const occupiedSpans: Array<[number, number]> = []
    for (const n of unicodeNodes) {
      const lbl = n.label.trim()
      if (!lbl) continue
      let searchFrom = 0
      while (searchFrom < combinedRaw.length) {
        const idx = combinedRaw.indexOf(lbl, searchFrom)
        if (idx < 0) break
        const end = idx + lbl.length
        const overlaps = occupiedSpans.some(([s, e]) => idx < e && end > s)
        if (!overlaps) {
          occupiedSpans.push([idx, end])
          addRef(n.id, lbl)
          break
        }
        searchFrom = idx + 1
      }
    }
  }

  return orderedNodeIds.map((nodeId) => ({
    nodeId,
    token: Array.from(byNodeId.get(nodeId) ?? []).join(', ')
  }))
}

/**
 * 解析自定义动态变量（`varKind === 'expr'`）公式中引用的所有节点。
 */
export function resolveMxParamReferencedNodes(
  doc: MxDocument,
  param: MxParam
): MxEdgeNodeReference[] {
  if (param.varKind !== 'expr') return []
  const rawF = (param.formula ?? '').trim()
  if (!rawF || rawF.startsWith('[')) return []
  return extractMxFormulaNodeRefsFromSegments(doc, [rawF], rawF, undefined, false)
}

/**
 * 解析节点自身条件或公式（`Register` / `Gate` / `End` / `Delay` / `Queue` 的 `formula` 以及任意节点的 `botCondition`）中引用的节点。
 */
export function resolveMxNodeReferencedNodes(
  doc: MxDocument,
  node: MxNode
): MxNodeFormulaReference[] {
  if (node.kind === 'note') return []
  const gIdx = getMxGraphIndex(doc)
  const out: MxNodeFormulaReference[] = []

  const paramNames = new Set<string>()
  for (const p of doc.params) {
    const pk = mxIdentifier(p.name)
    if (pk) paramNames.add(pk)
  }

  const localStateBindings = new Map<string, string>()
  const stateIns = gIdx.stateInByNode.get(node.id) ?? EMPTY_EDGES
  stateIns.forEach((se, idx) => {
    const originNode = gIdx.byId.get(se.from)
    if (!originNode || originNode.kind === 'note') return
    if (idx < POSITIONAL_LETTERS.length && !paramNames.has(POSITIONAL_LETTERS[idx]!)) {
      localStateBindings.set(POSITIONAL_LETTERS[idx]!, se.from)
    }
    if (se.label?.trim()) {
      const customVar = mxIdentifier(se.label.trim())
      if (customVar && !paramNames.has(customVar)) {
        localStateBindings.set(customVar, se.from)
      }
    }
  })

  if (
    node.kind === 'register' ||
    node.kind === 'gate' ||
    node.kind === 'end' ||
    node.kind === 'delay' ||
    node.kind === 'queue'
  ) {
    const rawF = (node.formula ?? '').trim()
    if (rawF) {
      if (node.kind === 'end') {
        const stSpec = parseMxStateFormula(rawF)
        if (stSpec.type === 'activator' || stSpec.type === 'range') {
          if (stateIns.length > 0) {
            const firstFrom = stateIns[0]!.from
            const originNode = gIdx.byId.get(firstFrom)
            if (originNode && originNode.kind !== 'note') {
              out.push({
                nodeId: firstFrom,
                token: rawF,
                sourceField: 'formula',
                formula: rawF
              })
            }
          }
        } else {
          const exprPart = rawF.replace(/^(?:>=|<=|==|!=|<>|>|<|=)\s*/, '')
          const refs = extractMxFormulaNodeRefsFromSegments(
            doc,
            [exprPart],
            rawF,
            localStateBindings
          )
          for (const r of refs) {
            out.push({ ...r, sourceField: 'formula', formula: rawF })
          }
        }
      } else {
        const refs = extractMxFormulaNodeRefsFromSegments(doc, [rawF], rawF, localStateBindings)
        for (const r of refs) {
          out.push({ ...r, sourceField: 'formula', formula: rawF })
        }
      }
    } else if (node.kind === 'register' && node.trigger !== 'interactive' && stateIns.length > 0) {
      const drivenByConstMod = stateIns.some((se) => {
        const sp = parseMxStateFormula(se.formula)
        return sp.type === 'modifier' || sp.type === 'fraction_modifier' || sp.type === 'overwrite'
      })
      if (!drivenByConstMod) {
        const firstFrom = stateIns[0]!.from
        const originNode = gIdx.byId.get(firstFrom)
        if (originNode && originNode.kind !== 'note') {
          out.push({
            nodeId: firstFrom,
            token: 'a',
            sourceField: 'formula',
            formula: 'a'
          })
        }
      }
    }
  }

  const rawBotCond = (node.botCondition ?? '').trim()
  if (rawBotCond) {
    const botBindings = new Map(localStateBindings)
    botBindings.set('self', node.id)
    const refs = extractMxFormulaNodeRefsFromSegments(doc, [rawBotCond], rawBotCond, botBindings)
    for (const r of refs) {
      out.push({
        ...r,
        sourceField: 'botCondition',
        formula: rawBotCond
      })
    }
  }

  return out
}

/**
 * 解析一条连接线的公式（及动态间隔 `interval`）中引用的所有节点，
 * 供画布在点击/编辑连线时绘制“公式胶囊 ╌╌► 被引用节点”的快速定位虚线。
 */
export function resolveMxEdgeReferencedNodes(doc: MxDocument, edge: MxEdge): MxEdgeNodeReference[] {
  const gIdx = getMxGraphIndex(doc)
  const paramNames = new Set<string>()
  for (const p of doc.params) {
    const pk = mxIdentifier(p.name)
    if (pk) paramNames.add(pk)
  }

  const localBindings = new Map<string, string>()
  const srcNode = gIdx.byId.get(edge.from)
  if (srcNode && srcNode.kind !== 'note') {
    localBindings.set('self', srcNode.id)
  }

  if (edge.kind === 'resource') {
    const edgeStateIns = gIdx.stateInByEdge.get(edge.id) ?? EMPTY_EDGES
    const nodeStateIns = gIdx.stateInByNode.get(edge.from) ?? EMPTY_EDGES
    const combinedStateIns =
      edgeStateIns.length && nodeStateIns.length
        ? [...edgeStateIns, ...nodeStateIns]
        : edgeStateIns.length
          ? edgeStateIns
          : nodeStateIns
    combinedStateIns.forEach((se, idx) => {
      const originNode = gIdx.byId.get(se.from)
      if (!originNode || originNode.kind === 'note') return
      if (idx < POSITIONAL_LETTERS.length && !paramNames.has(POSITIONAL_LETTERS[idx]!)) {
        localBindings.set(POSITIONAL_LETTERS[idx]!, se.from)
      }
      if (se.label?.trim()) {
        const customVar = mxIdentifier(se.label.trim())
        if (customVar && !paramNames.has(customVar)) localBindings.set(customVar, se.from)
      }
    })
    if (
      !localBindings.has('a') &&
      !paramNames.has('a') &&
      srcNode &&
      srcNode.kind !== 'source' &&
      srcNode.kind !== 'note' &&
      !doc.nodes.some((n) => n.kind !== 'note' && (n.id === 'a' || mxIdentifier(n.label) === 'a'))
    ) {
      localBindings.set('a', srcNode.id)
    }
  } else if (edge.kind === 'state') {
    if (
      !localBindings.has('a') &&
      !paramNames.has('a') &&
      srcNode &&
      srcNode.kind !== 'note' &&
      !doc.nodes.some((n) => n.kind !== 'note' && (n.id === 'a' || mxIdentifier(n.label) === 'a'))
    ) {
      localBindings.set('a', srcNode.id)
    }
  }

  const exprSegments: string[] = []
  const rawF = (edge.formula ?? '').trim()
  if (rawF) {
    if (edge.kind === 'resource') {
      const spec = parseMxFlowFormula(rawF)
      const coreRaw = rawF.replace(/\s*(?:\bevery\b|(?<!\|)\|(?!\|)).*$/i, '').trim()
      const asGateCond = parseMxStateFormula(coreRaw)
      if (asGateCond.type === 'activator' || asGateCond.type === 'range') {
        if (spec.intervalExpr) exprSegments.push(spec.intervalExpr)
      } else if (asGateCond.type === 'expr' && /^(?:>=|<=|==|!=|<>|>|<|=)/.test(coreRaw)) {
        exprSegments.push(coreRaw.replace(/^(?:>=|<=|==|!=|<>|>|<|=)\s*/, ''))
        if (spec.intervalExpr) exprSegments.push(spec.intervalExpr)
      } else {
        if (spec.type !== 'all') exprSegments.push(spec.expr)
        if (spec.intervalExpr) exprSegments.push(spec.intervalExpr)
      }
    } else {
      const sv = parseSignedVarStateModifier(rawF)
      if (sv) {
        exprSegments.push(sv.ident)
      } else {
        const stSpec = parseMxStateFormula(rawF)
        if (stSpec.type === 'expr') {
          exprSegments.push(rawF.replace(/^(?:>=|<=|==|!=|<>|>|<|=)\s*/, ''))
        }
      }
    }
  }
  if (edge.kind === 'resource' && edge.interval?.trim()) {
    const iv = edge.interval.trim()
    if (!/^-?\d+(?:\.\d+)?$/.test(iv)) {
      exprSegments.push(iv)
    }
  }

  const combinedRaw = `${rawF} ${edge.kind === 'resource' ? (edge.interval ?? '') : ''}`.trim()
  return extractMxFormulaNodeRefsFromSegments(doc, exprSegments, combinedRaw, localBindings)
}

/**
 * 反向查找图表中所有“使用了指定节点作为条件或公式变量”的节点（Register / End / Delay / botCondition）、
 * 连接线公式（含直接状态激活条件胶囊）以及自定义动态变量（`params` `expr`）。
 */
export function resolveMxNodeConsumers(
  doc: MxDocument,
  targetNodeIds: Iterable<string>
): MxNodeConsumersResult {
  const gIdx = getMxGraphIndex(doc)
  const targetSet = new Set<string>()
  for (const id of targetNodeIds) {
    const n = gIdx.byId.get(id)
    if (n && n.kind !== 'note') targetSet.add(id)
  }
  if (targetSet.size === 0) {
    return { nodes: [], edges: [], params: [] }
  }

  const nodes: MxNodeConsumerNodeHit[] = []
  for (const n of doc.nodes) {
    if (n.kind === 'note' || targetSet.has(n.id)) continue
    const refs = resolveMxNodeReferencedNodes(doc, n)
    for (const r of refs) {
      if (!targetSet.has(r.nodeId)) continue
      nodes.push({
        consumerNodeId: n.id,
        sourceNodeId: r.nodeId,
        token: r.token,
        sourceField: r.sourceField,
        formula: r.formula
      })
    }
  }

  const edges: MxNodeConsumerEdgeHit[] = []
  const matchedEdgePairs = new Set<string>()
  for (const e of doc.edges) {
    const refs = resolveMxEdgeReferencedNodes(doc, e)
    for (const r of refs) {
      if (!targetSet.has(r.nodeId)) continue
      matchedEdgePairs.add(`${e.id}::${r.nodeId}`)
      edges.push({
        consumerEdgeId: e.id,
        sourceNodeId: r.nodeId,
        token: r.token,
        formula: (e.formula ?? '').trim() || (e.interval ?? '').trim(),
        isDirectStateCondition: false
      })
    }

    if (targetSet.has(e.from) && !matchedEdgePairs.has(`${e.id}::${e.from}`)) {
      const rawF = (e.formula ?? '').trim()
      if (!rawF) continue
      if (e.kind === 'state') {
        const stSpec = parseMxStateFormula(rawF)
        if (
          stSpec.type === 'activator' ||
          stSpec.type === 'range' ||
          (stSpec.type === 'expr' && /^(?:>=|<=|==|!=|<>|>|<|=)/.test(rawF))
        ) {
          edges.push({
            consumerEdgeId: e.id,
            sourceNodeId: e.from,
            token: rawF,
            formula: rawF,
            isDirectStateCondition: true
          })
        }
      } else {
        const fromNode = gIdx.byId.get(e.from)
        if (fromNode?.kind === 'gate') {
          const coreRaw = rawF.replace(/\s*(?:\bevery\b|(?<!\|)\|(?!\|)).*$/i, '').trim()
          const gateSpec = parseMxStateFormula(coreRaw)
          if (
            gateSpec.type === 'activator' ||
            gateSpec.type === 'range' ||
            (gateSpec.type === 'expr' && /^(?:>=|<=|==|!=|<>|>|<|=)/.test(coreRaw))
          ) {
            edges.push({
              consumerEdgeId: e.id,
              sourceNodeId: e.from,
              token: coreRaw,
              formula: rawF,
              isDirectStateCondition: true
            })
          }
        }
      }
    }
  }

  const params: MxNodeConsumerParamHit[] = []
  for (const p of doc.params) {
    const refs = resolveMxParamReferencedNodes(doc, p)
    for (const r of refs) {
      if (!targetSet.has(r.nodeId)) continue
      params.push({
        consumerParamId: p.id,
        paramName: p.name,
        sourceNodeId: r.nodeId,
        token: r.token,
        formula: (p.formula ?? '').trim()
      })
    }
  }

  return { nodes, edges, params }
}

// ───────── 公式编辑器上下文内省与变量来源目录 (Formula Context Inspector) ─────────

export type MxFormulaContextKind = 'resource' | 'state' | 'register' | 'end' | 'expr'

export type MxFormulaSymbolSource = 'param' | 'state_input' | 'node' | 'builtin_var' | 'unknown'

export interface MxFormulaSymbolRef {
  token: string
  source: MxFormulaSymbolSource
  value?: number
  valueText?: string
  paramId?: string
  paramName?: string
  paramVarKind?: MxParam['varKind']
  paramFormula?: string
  nodeId?: string
  nodeKind?: MxNodeKind
  nodeLabel?: string
  edgeId?: string
}

export interface MxFormulaCatalogItem {
  key: string
  insertText: string
  cursorBackOffset?: number
  source: 'param' | 'state_input' | 'node' | 'builtin_var' | 'dice' | 'function'
  title: string
  subtitle?: string
  valueText?: string
  fnId?: string
  paramId?: string
  nodeId?: string
  nodeKind?: MxNodeKind
}

export interface MxFormulaInspectOptions {
  contextKind?: MxFormulaContextKind
  ownerNodeId?: string
  edgeId?: string
  values?: Record<string, number> | null
  step?: number
}

export interface MxFormulaInspectionResult {
  referencedSymbols: MxFormulaSymbolRef[]
  previewText: string | null
  isStochastic: boolean
  catalog: MxFormulaCatalogItem[]
}

const MX_FORMULA_BUILTIN_FUNCTIONS: ReadonlyArray<{
  fnId: string
  insertText: string
  cursorBackOffset: number
  signature: string
}> = [
  { fnId: 'if', insertText: 'if(, 1, 0)', cursorBackOffset: 7, signature: 'if(cond, a, b)' },
  { fnId: 'min', insertText: 'min(, )', cursorBackOffset: 3, signature: 'min(a, b)' },
  { fnId: 'max', insertText: 'max(, )', cursorBackOffset: 3, signature: 'max(a, b)' },
  { fnId: 'round', insertText: 'round()', cursorBackOffset: 1, signature: 'round(x)' },
  { fnId: 'floor', insertText: 'floor()', cursorBackOffset: 1, signature: 'floor(x)' },
  { fnId: 'ceil', insertText: 'ceil()', cursorBackOffset: 1, signature: 'ceil(x)' },
  {
    fnId: 'clamp',
    insertText: 'clamp(, 0, 100)',
    cursorBackOffset: 9,
    signature: 'clamp(x, lo, hi)'
  },
  { fnId: 'pow', insertText: 'pow(, 2)', cursorBackOffset: 4, signature: 'pow(base, exp)' },
  {
    fnId: 'diminish',
    insertText: 'diminish(, 100)',
    cursorBackOffset: 6,
    signature: 'diminish(x, k)'
  },
  {
    fnId: 'lookup',
    insertText: 'lookup(, 10, 25, 60)',
    cursorBackOffset: 13,
    signature: 'lookup(idx, v0, v1, ...)'
  },
  { fnId: 'lerp', insertText: 'lerp(0, 100, )', cursorBackOffset: 1, signature: 'lerp(a, b, t)' },
  { fnId: 'mod', insertText: 'mod(STEP, 5)', cursorBackOffset: 1, signature: 'mod(a, b)' },
  {
    fnId: 'randomInt',
    insertText: 'randomInt(1, 10)',
    cursorBackOffset: 1,
    signature: 'randomInt(min, max)'
  },
  { fnId: 'abs', insertText: 'abs()', cursorBackOffset: 1, signature: 'abs(x)' },
  { fnId: 'sin', insertText: 'sin(STEP)', cursorBackOffset: 1, signature: 'sin(rad)' }
]

function formatMxCompactNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 1000) / 1000)
}

/**
 * 解析任意公式（资源边 / 状态边 / Register / End / 动态参数）内引用的标识符来源、实时预览值与可插入变量目录。
 */
export function inspectMxFormulaContext(
  doc: MxDocument,
  formula: string | undefined,
  options: MxFormulaInspectOptions = {}
): MxFormulaInspectionResult {
  const gIdx = getMxGraphIndex(doc)
  const step = Math.max(0, Math.floor(options.step ?? 0))
  const contextKind = options.contextKind ?? 'expr'

  // 1. 构建有效节点数值表（若尚未运行快照，则回退节点 initial 并试算纯表达式寄存器）
  const effectiveValues: Record<string, number> = {}
  for (const n of doc.nodes) {
    if (n.kind === 'note') continue
    effectiveValues[n.id] =
      options.values && n.id in options.values ? (options.values[n.id] ?? 0) : (n.initial ?? 0)
  }

  const arrays = buildParamArrays(doc)
  const baseParams = resolveMxParams(doc)
  const sharedVars = buildVars(doc, effectiveValues, baseParams, step)

  // 对 `varKind === 'expr'` 的动态参数按当前上下文求值
  const paramByIdent = new Map<
    string,
    { param: MxParam; ident: string; value: number; valueText: string }
  >()
  const paramLowerMap = new Map<
    string,
    { param: MxParam; ident: string; value: number; valueText: string }
  >()
  for (const p of doc.params) {
    const ident = mxIdentifier(p.name)
    if (!ident) continue
    let val = baseParams[ident] ?? p.value ?? 0
    let valueText = formatMxCompactNum(val)
    if (p.varKind === 'expr' && p.formula?.trim() && !p.formula.trim().startsWith('[')) {
      val = evaluateMxExpression(
        p.formula,
        { vars: sharedVars, arrays, rng: () => 0.5 },
        p.value ?? 0
      )
      sharedVars[ident] = val
      valueText = `${formatMxCompactNum(val)} (${p.formula.trim()})`
    } else if (p.varKind === 'array') {
      valueText = (p.formula ?? '[]').trim()
    } else if (p.varKind === 'random_range') {
      valueText = `${p.min ?? 1}..${p.max ?? 6}`
    }
    const rec = { param: p, ident, value: val, valueText }
    paramByIdent.set(ident, rec)
    paramLowerMap.set(ident.toLowerCase(), rec)
  }

  // 若无快照，粗略预求值一次无状态输入的公式型 Register，使预览值更准确
  if (!options.values) {
    for (const reg of gIdx.registers) {
      if (reg.formula?.trim()) {
        const rv = evaluateMxExpression(
          reg.formula,
          { vars: sharedVars, arrays, rng: () => 0.5 },
          reg.initial ?? 0
        )
        effectiveValues[reg.id] = Math.round(rv * 1000) / 1000
        sharedVars[reg.id] = effectiveValues[reg.id]!
        const rIdent = mxIdentifier(reg.label)
        if (rIdent && !paramByIdent.has(rIdent)) sharedVars[rIdent] = effectiveValues[reg.id]!
      }
    }
  }

  // 2. 构建局部状态输入绑定（`a..z`、自定义状态边 label、`self`）
  const localStateMap = new Map<
    string,
    {
      token: string
      edgeId?: string
      nodeId: string
      nodeKind: MxNodeKind
      nodeLabel: string
      value: number
    }
  >()
  const bindLocal = (token: string, targetNodeId: string, edgeId?: string): void => {
    const originNode = gIdx.byId.get(targetNodeId)
    if (!originNode || originNode.kind === 'note') return
    if (paramByIdent.has(token)) return
    const val = effectiveValues[originNode.id] ?? 0
    localStateMap.set(token, {
      token,
      edgeId,
      nodeId: originNode.id,
      nodeKind: originNode.kind,
      nodeLabel: originNode.label || originNode.id,
      value: val
    })
  }

  if (options.ownerNodeId && (contextKind === 'register' || contextKind === 'end')) {
    const inEdges = gIdx.stateInByNode.get(options.ownerNodeId) ?? EMPTY_EDGES
    inEdges.forEach((se, idx) => {
      if (idx < POSITIONAL_LETTERS.length) {
        bindLocal(POSITIONAL_LETTERS[idx]!, se.from, se.id)
      }
      if (se.label?.trim()) {
        const customVar = mxIdentifier(se.label.trim())
        if (customVar) bindLocal(customVar, se.from, se.id)
      }
    })
  } else if (options.edgeId) {
    const edge = gIdx.edgeById.get(options.edgeId)
    if (edge) {
      const srcNode = gIdx.byId.get(edge.from)
      if (srcNode && srcNode.kind !== 'note') {
        bindLocal('self', srcNode.id, edge.id)
      }
      if (edge.kind === 'resource') {
        const edgeStateIns = gIdx.stateInByEdge.get(edge.id) ?? EMPTY_EDGES
        const nodeStateIns = gIdx.stateInByNode.get(edge.from) ?? EMPTY_EDGES
        const combined =
          edgeStateIns.length && nodeStateIns.length
            ? [...edgeStateIns, ...nodeStateIns]
            : edgeStateIns.length
              ? edgeStateIns
              : nodeStateIns
        combined.forEach((se, idx) => {
          if (idx < POSITIONAL_LETTERS.length) {
            bindLocal(POSITIONAL_LETTERS[idx]!, se.from, se.id)
          }
          if (se.label?.trim()) {
            const customVar = mxIdentifier(se.label.trim())
            if (customVar) bindLocal(customVar, se.from, se.id)
          }
        })
        if (
          !localStateMap.has('a') &&
          srcNode &&
          srcNode.kind !== 'source' &&
          srcNode.kind !== 'note' &&
          !doc.nodes.some(
            (n) => n.kind !== 'note' && (n.id === 'a' || mxIdentifier(n.label) === 'a')
          )
        ) {
          bindLocal('a', srcNode.id, edge.id)
        }
      } else if (
        edge.kind === 'state' &&
        srcNode &&
        srcNode.kind !== 'note' &&
        !doc.nodes.some((n) => n.kind !== 'note' && (n.id === 'a' || mxIdentifier(n.label) === 'a'))
      ) {
        bindLocal('a', srcNode.id, edge.id)
      }
    }
  }

  const evalVars: Record<string, number> = { ...sharedVars }
  for (const [k, b] of localStateMap.entries()) {
    evalVars[k] = b.value
  }

  // 3. 构建节点变量查找表
  const nodeByVar = new Map<string, MxNode>()
  const nodeByLowerVar = new Map<string, MxNode>()
  for (const entry of gIdx.identEntries) {
    const n = gIdx.byId.get(entry.id)
    if (!n || n.kind === 'note') continue
    nodeByVar.set(entry.id, n)
    nodeByLowerVar.set(entry.id.toLowerCase(), n)
    if (entry.ident && !paramByIdent.has(entry.ident)) {
      nodeByVar.set(entry.ident, n)
      nodeByLowerVar.set(entry.ident.toLowerCase(), n)
    }
  }

  // 4. 提取公式中的表达式片段并扫描标识符
  const raw = (formula ?? '').trim()
  const exprSegments: string[] = []
  if (raw) {
    if (contextKind === 'resource') {
      const spec = parseMxFlowFormula(raw)
      const coreRaw = raw.replace(/\s*(?:\bevery\b|(?<!\|)\|(?!\|)).*$/i, '').trim()
      if (/^(?:>=|<=|==|!=|<>|>|<|=)/.test(coreRaw)) {
        const rhs = coreRaw.replace(/^(?:>=|<=|==|!=|<>|>|<|=)\s*/, '').trim()
        if (rhs) exprSegments.push(rhs)
      } else if (spec.type !== 'all' && !(spec.probability !== undefined && spec.expr === '1')) {
        exprSegments.push(spec.expr)
      }
      if (spec.intervalExpr) exprSegments.push(spec.intervalExpr)
    } else if (contextKind === 'state') {
      const sv = parseSignedVarStateModifier(raw)
      if (sv) {
        exprSegments.push(sv.ident)
      } else {
        const sp = parseMxStateFormula(raw)
        if (sp.type === 'expr') {
          exprSegments.push(raw.replace(/^(?:>=|<=|==|!=|<>|>|<|=)\s*/, ''))
        }
      }
    } else {
      exprSegments.push(raw.replace(/^(?:>=|<=|==|!=|<>|>|<|=)\s*/, ''))
    }
  }

  const orderedTokens: string[] = []
  const seenTokens = new Set<string>()
  const pushToken = (tok: string): void => {
    if (!tok || seenTokens.has(tok)) return
    const low = tok.toLowerCase()
    if (low === 'true' || low === 'false' || low === 'all' || low === 'every') return
    seenTokens.add(tok)
    orderedTokens.push(tok)
  }

  const walkTokens = (astNode: ExprNode): void => {
    switch (astNode.t) {
      case 'id':
        pushToken(astNode.name)
        break
      case 'arr':
        astNode.items.forEach(walkTokens)
        break
      case 'idx':
        walkTokens(astNode.target)
        astNode.indices.forEach(walkTokens)
        break
      case 'un':
        walkTokens(astNode.a)
        break
      case 'bin':
        walkTokens(astNode.a)
        walkTokens(astNode.b)
        break
      case 'tern':
        walkTokens(astNode.cond)
        walkTokens(astNode.a)
        walkTokens(astNode.b)
        break
      case 'call':
        astNode.args.forEach(walkTokens)
        break
    }
  }

  let hasStochasticAst = false
  const detectStochastic = (astNode: ExprNode | null): void => {
    if (!astNode || hasStochasticAst) return
    if (astNode.t === 'dice') {
      hasStochasticAst = true
      return
    }
    if (astNode.t === 'bin' && astNode.op === '..') {
      hasStochasticAst = true
      return
    }
    if (astNode.t === 'call') {
      const fnLow = astNode.fn.toLowerCase()
      if (fnLow === 'random' || fnLow === 'randomint' || fnLow === 'normal') {
        hasStochasticAst = true
        return
      }
      astNode.args.forEach(detectStochastic)
      return
    }
    if (astNode.t === 'un') detectStochastic(astNode.a)
    else if (astNode.t === 'bin') {
      detectStochastic(astNode.a)
      detectStochastic(astNode.b)
    } else if (astNode.t === 'tern') {
      detectStochastic(astNode.cond)
      detectStochastic(astNode.a)
      detectStochastic(astNode.b)
    } else if (astNode.t === 'arr') astNode.items.forEach(detectStochastic)
    else if (astNode.t === 'idx') {
      detectStochastic(astNode.target)
      astNode.indices.forEach(detectStochastic)
    }
  }

  for (const seg of exprSegments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    const ast = parseMxExpression(trimmed)
    if (ast) {
      walkTokens(ast)
      detectStochastic(ast)
    } else {
      const re = /([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g
      let m: RegExpExecArray | null
      while ((m = re.exec(trimmed)) !== null) {
        if (m[2]) continue
        const ident = m[1]!
        if (/^\d*[dD]\d+$/.test(ident)) {
          hasStochasticAst = true
          continue
        }
        const low = ident.toLowerCase()
        if (
          KNOWN_MX_FUNCTIONS.has(low) &&
          !paramLowerMap.has(low) &&
          !nodeByLowerVar.has(low) &&
          !localStateMap.has(ident)
        ) {
          continue
        }
        pushToken(ident)
      }
    }
  }

  // 5. 为每个引用到的标识符归类来源与实时值
  const referencedSymbols: MxFormulaSymbolRef[] = orderedTokens.map((tok) => {
    const low = tok.toLowerCase()
    const localHit = localStateMap.get(tok)
    if (localHit) {
      return {
        token: tok,
        source: 'state_input',
        value: localHit.value,
        valueText: formatMxCompactNum(localHit.value),
        nodeId: localHit.nodeId,
        nodeKind: localHit.nodeKind,
        nodeLabel: localHit.nodeLabel,
        edgeId: localHit.edgeId
      }
    }

    const pHit = paramByIdent.get(tok) ?? paramLowerMap.get(low)
    if (pHit) {
      if (pHit.param.varKind === 'random_range') hasStochasticAst = true
      return {
        token: tok,
        source: 'param',
        value: pHit.value,
        valueText: pHit.valueText,
        paramId: pHit.param.id,
        paramName: pHit.param.name,
        paramVarKind: pHit.param.varKind ?? 'number',
        paramFormula: pHit.param.formula
      }
    }

    const nHit = nodeByVar.get(tok) ?? nodeByLowerVar.get(low)
    if (nHit) {
      const nv = effectiveValues[nHit.id] ?? 0
      return {
        token: tok,
        source: 'node',
        value: nv,
        valueText: formatMxCompactNum(nv),
        nodeId: nHit.id,
        nodeKind: nHit.kind,
        nodeLabel: nHit.label || nHit.id
      }
    }

    if (low === 'step' || low === 't') {
      return {
        token: tok,
        source: 'builtin_var',
        value: step,
        valueText: String(step)
      }
    }
    if (low === 'pi') {
      return {
        token: tok,
        source: 'builtin_var',
        value: Math.PI,
        valueText: '3.142'
      }
    }
    if (low === 'e') {
      return {
        token: tok,
        source: 'builtin_var',
        value: Math.E,
        valueText: '2.718'
      }
    }

    return {
      token: tok,
      source: 'unknown'
    }
  })

  // 6. 计算当前公式实时预览文本
  let previewText: string | null = null
  if (raw) {
    const primarySeg = exprSegments[0]?.trim() ?? ''
    const ast = primarySeg ? parseMxExpression(primarySeg) : null
    if (ast) {
      if (hasStochasticAst) {
        const v0 = evalAst(ast, { vars: evalVars, arrays, rng: () => 0 })
        const v1 = evalAst(ast, { vars: evalVars, arrays, rng: () => 0.999999 })
        const lo = Math.min(v0, v1)
        const hi = Math.max(v0, v1)
        previewText =
          Math.abs(hi - lo) < 1e-6
            ? `= ${formatMxCompactNum(lo)}`
            : `🎲 ${formatMxCompactNum(lo)} ~ ${formatMxCompactNum(hi)}`
      } else {
        const val = evalAst(ast, { vars: evalVars, arrays, rng: () => 0.5 })
        previewText = `= ${formatMxCompactNum(val)}`
      }
    }
  }

  // 7. 构建完整可点选插入目录（状态输入 -> 全局参数 -> Pool/Register 节点 -> 内置变量/骰子/函数）
  const catalog: MxFormulaCatalogItem[] = []
  for (const [tok, lb] of localStateMap.entries()) {
    if (tok === 'self') continue
    catalog.push({
      key: `st:${tok}`,
      insertText: tok,
      source: 'state_input',
      title: tok,
      subtitle: lb.nodeLabel,
      valueText: formatMxCompactNum(lb.value),
      nodeId: lb.nodeId,
      nodeKind: lb.nodeKind
    })
  }

  for (const p of doc.params) {
    const ident = mxIdentifier(p.name)
    if (!ident) continue
    const pRec = paramByIdent.get(ident)
    catalog.push({
      key: `param:${p.id}`,
      insertText: p.varKind === 'array' ? `${ident}[0]` : ident,
      cursorBackOffset: p.varKind === 'array' ? 1 : 0,
      source: 'param',
      title: ident,
      subtitle: p.varKind && p.varKind !== 'number' ? p.varKind : undefined,
      valueText: pRec ? pRec.valueText : formatMxCompactNum(p.value),
      paramId: p.id
    })
  }

  const candidateNodes = doc.nodes.filter((n) => n.kind === 'pool' || n.kind === 'register')
  for (const n of candidateNodes) {
    const nv = effectiveValues[n.id] ?? 0
    catalog.push({
      key: `node:${n.id}`,
      insertText: n.id,
      source: 'node',
      title: n.id,
      subtitle: n.label && n.label !== n.id ? n.label : undefined,
      valueText: formatMxCompactNum(nv),
      nodeId: n.id,
      nodeKind: n.kind
    })
  }

  catalog.push({
    key: 'builtin:STEP',
    insertText: 'STEP',
    source: 'builtin_var',
    title: 'STEP',
    fnId: 'STEP',
    valueText: String(step)
  })

  for (const dice of [
    { d: 'D6', range: '1..6' },
    { d: '2D6', range: '2..12' },
    { d: 'D20', range: '1..20' },
    { d: 'D100', range: '1..100' }
  ]) {
    catalog.push({
      key: `dice:${dice.d}`,
      insertText: dice.d,
      source: 'dice',
      title: dice.d,
      fnId: dice.d,
      valueText: dice.range
    })
  }

  for (const fn of MX_FORMULA_BUILTIN_FUNCTIONS) {
    catalog.push({
      key: `fn:${fn.fnId}`,
      insertText: fn.insertText,
      cursorBackOffset: fn.cursorBackOffset,
      source: 'function',
      title: fn.signature,
      fnId: fn.fnId
    })
  }

  return {
    referencedSymbols,
    previewText,
    isStochastic: hasStochasticAst,
    catalog
  }
}

export interface MxEdgeCompactDisplay {
  /** 精简后的左侧主胶囊文本（若速率段本身为简单字面量而仅间隔段复杂，则保留原简单速率） */
  compactRateText: string
  /** 精简后的右侧间隔文本（无间隔为空串；简单间隔保留原文本；复杂间隔显示 `ƒx·N`） */
  compactIntervalText: string
  /** 当前求值结果摘要 */
  valuePreview: string
  /** 悬停完整公式与实时求值提示文案 */
  tooltipText: string
}

const SIMPLE_RES_NUMBER_RE = /^[+-]?\d+(?:\.\d+)?$/
const SIMPLE_RES_PROB_RE = /^(?:\d+(?:\.\d+)?\s*@?\s*)?\d+(?:\.\d+)?\s*%$/
const SIMPLE_RES_ALL_RE = /^all$/i
const SIMPLE_RES_DICE_RE = /^(?:\d+)?[dD]\d+(?:\s*[+-]\s*\d+(?:\.\d+)?)?$/
const SIMPLE_RES_RANGE_RE = /^-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?$/
const SIMPLE_RES_CMP_RE = /^(?:>=|<=|==|!=|<>|[><=≥≤≠])\s*[+-]?\d+(?:\.\d+)?%?$/
const SIMPLE_STATE_MULT_MOD_RE = /^[*/]\s*\d+(?:\.\d+)?$/
const SIMPLE_STATE_UNICODE_CMP_RE = /^[≥≤≠]\s*-?\d+(?:\.\d+)?%?$/

/**
 * 判断连线上的单段公式 token 是否为无需折叠的原味短记号（如 `5`、`80%`、`D6+1`、`>=15`、`+1`、`+1i`、`*`、`all` 等）。
 */
export function isSimpleMxEdgeToken(kind: 'resource' | 'state', rawToken: string): boolean {
  const s = rawToken.trim()
  if (!s) return true
  if (kind === 'state') {
    const spec = parseMxStateFormula(s)
    if (spec.type !== 'expr') return true
    return SIMPLE_STATE_MULT_MOD_RE.test(s) || SIMPLE_STATE_UNICODE_CMP_RE.test(s)
  }
  return (
    SIMPLE_RES_NUMBER_RE.test(s) ||
    SIMPLE_RES_PROB_RE.test(s) ||
    SIMPLE_RES_ALL_RE.test(s) ||
    SIMPLE_RES_DICE_RE.test(s) ||
    SIMPLE_RES_RANGE_RE.test(s) ||
    SIMPLE_RES_CMP_RE.test(s)
  )
}

function normalizeMxDisplayCmpOp(op: string): string {
  if (op === '>=') return '≥'
  if (op === '<=') return '≤'
  if (op === '!=' || op === '<>') return '≠'
  if (op === '==') return '='
  return op
}

function isAstStochasticWithParams(
  astNode: ExprNode | null,
  randomRangeParamLowers: Set<string>
): boolean {
  if (!astNode) return false
  switch (astNode.t) {
    case 'dice':
      return true
    case 'id':
      return randomRangeParamLowers.has(astNode.name.toLowerCase())
    case 'un':
      return isAstStochasticWithParams(astNode.a, randomRangeParamLowers)
    case 'bin':
      if (astNode.op === '..') return true
      return (
        isAstStochasticWithParams(astNode.a, randomRangeParamLowers) ||
        isAstStochasticWithParams(astNode.b, randomRangeParamLowers)
      )
    case 'tern':
      return (
        isAstStochasticWithParams(astNode.cond, randomRangeParamLowers) ||
        isAstStochasticWithParams(astNode.a, randomRangeParamLowers) ||
        isAstStochasticWithParams(astNode.b, randomRangeParamLowers)
      )
    case 'arr':
      return astNode.items.some((it) => isAstStochasticWithParams(it, randomRangeParamLowers))
    case 'idx':
      return (
        isAstStochasticWithParams(astNode.target, randomRangeParamLowers) ||
        astNode.indices.some((ix) => isAstStochasticWithParams(ix, randomRangeParamLowers))
      )
    case 'call': {
      const fnLow = astNode.fn.toLowerCase()
      if (
        fnLow === 'random' ||
        fnLow === 'randint' ||
        fnLow === 'randomint' ||
        fnLow === 'norm' ||
        fnLow === 'gaussian' ||
        fnLow === 'normal' ||
        fnLow === 'pickrandom'
      ) {
        return true
      }
      return astNode.args.some((arg) => isAstStochasticWithParams(arg, randomRangeParamLowers))
    }
    default:
      return false
  }
}

/**
 * 批量将图中包含复杂表达式（含函数、标识符运算或多条件组合）的连线公式求值为紧凑胶囊文案 `ƒx · <当前值>`。
 * 若整张图均为简单字面量记号，立即返回空 Map（零上下文分配开销）。
 */
export function formatMxCompactEdgeFormulas(
  doc: MxDocument,
  options: {
    values?: Record<string, number> | null
    step?: number
    params?: Record<string, number>
  } = {}
): Map<string, MxEdgeCompactDisplay> {
  const result = new Map<string, MxEdgeCompactDisplay>()
  const candidates: Array<{
    edge: MxEdge
    authoredFull: string
    rawRate: string
    rawIv: string
    rateComplex: boolean
    ivComplex: boolean
  }> = []

  for (const e of doc.edges) {
    const rawFormula = (e.formula || (e.kind === 'state' ? '*' : '1')).trim()
    const authoredFull =
      e.kind === 'resource' &&
      e.interval?.trim() &&
      e.interval.trim() !== '1' &&
      !/\bevery\b|(?<!\|)\|(?!\|)/i.test(rawFormula)
        ? `${rawFormula}|${e.interval.trim()}`
        : rawFormula

    let rawRate = authoredFull
    let rawIv = ''
    if (e.kind === 'resource') {
      const ivMatch = /^(.*?)\s*(?:\bevery\b|(?<!\|)\|(?!\|))\s*(.+)$/i.exec(authoredFull)
      if (ivMatch) {
        rawRate = ivMatch[1]!.trim() || '1'
        const ivPart = ivMatch[2]!.trim()
        rawIv = ivPart === '1' ? '' : ivPart
      }
    }

    const rateComplex = !isSimpleMxEdgeToken(e.kind, rawRate)
    const ivComplex = Boolean(rawIv && !isSimpleMxEdgeToken('resource', rawIv))
    if (rateComplex || ivComplex) {
      candidates.push({
        edge: e,
        authoredFull,
        rawRate,
        rawIv,
        rateComplex,
        ivComplex
      })
    }
  }

  if (candidates.length === 0) return result

  const gIdx = getMxGraphIndex(doc)
  const step = Math.max(0, Math.floor(options.step ?? 0))
  const effectiveValues: Record<string, number> = {}
  for (const n of doc.nodes) {
    if (n.kind === 'note') continue
    effectiveValues[n.id] =
      options.values && n.id in options.values ? (options.values[n.id] ?? 0) : (n.initial ?? 0)
  }

  const arrays = gIdx.paramArrays ?? buildParamArrays(doc)
  const baseParams = options.params ?? resolveMxParams(doc)
  const sharedVars = buildVars(doc, effectiveValues, baseParams, step)

  const paramNames = new Set<string>()
  const randomRangeParamLowers = new Set<string>()
  for (const p of doc.params) {
    const ident = mxIdentifier(p.name)
    if (!ident) continue
    paramNames.add(ident)
    if (p.varKind === 'random_range') {
      randomRangeParamLowers.add(ident.toLowerCase())
    } else if (p.varKind === 'expr' && p.formula?.trim() && !p.formula.trim().startsWith('[')) {
      const val = evaluateMxExpression(
        p.formula,
        { vars: sharedVars, arrays, rng: () => 0.5 },
        p.value ?? 0
      )
      sharedVars[ident] = val
    }
  }

  if (!options.values) {
    for (const reg of gIdx.registers) {
      if (reg.formula?.trim()) {
        const rv = evaluateMxExpression(
          reg.formula,
          { vars: sharedVars, arrays, rng: () => 0.5 },
          reg.initial ?? 0
        )
        const rounded = Math.round(rv * 1000) / 1000
        effectiveValues[reg.id] = rounded
        sharedVars[reg.id] = rounded
        const rIdent = mxIdentifier(reg.label)
        if (rIdent && !paramNames.has(rIdent)) sharedVars[rIdent] = rounded
      }
    }
  }

  const hasExplicitNodeA = doc.nodes.some(
    (n) => n.kind !== 'note' && (n.id === 'a' || mxIdentifier(n.label) === 'a')
  )

  const evalSegmentPreview = (
    exprSrc: string,
    evalVars: Record<string, number>
  ): { ok: boolean; text: string; num: number; stochastic: boolean } => {
    const ast = parseMxExpression(exprSrc.trim())
    if (!ast) return { ok: false, text: '', num: 0, stochastic: false }
    const stochastic = isAstStochasticWithParams(ast, randomRangeParamLowers)
    if (stochastic) {
      const v0 = evalAst(ast, { vars: evalVars, arrays, rng: () => 0 })
      const v1 = evalAst(ast, { vars: evalVars, arrays, rng: () => 0.999999 })
      const lo = Math.min(v0, v1)
      const hi = Math.max(v0, v1)
      if (Math.abs(hi - lo) >= 1e-6) {
        return {
          ok: true,
          text: `${formatMxCompactNum(lo)}~${formatMxCompactNum(hi)}`,
          num: (lo + hi) / 2,
          stochastic: true
        }
      }
      return { ok: true, text: formatMxCompactNum(lo), num: lo, stochastic: false }
    }
    const val = evalAst(ast, { vars: evalVars, arrays, rng: () => 0.5 })
    return { ok: true, text: formatMxCompactNum(val), num: val, stochastic: false }
  }

  for (const cand of candidates) {
    const { edge: e, authoredFull, rawRate, rawIv, rateComplex, ivComplex } = cand
    const evalVars: Record<string, number> = { ...sharedVars }
    let boundLocalA = false
    const bindLocalVar = (token: string, targetNodeId: string): void => {
      const originNode = gIdx.byId.get(targetNodeId)
      if (!originNode || originNode.kind === 'note') return
      if (paramNames.has(token)) return
      evalVars[token] = effectiveValues[originNode.id] ?? 0
      if (token === 'a') boundLocalA = true
    }

    const srcNode = gIdx.byId.get(e.from)
    if (srcNode && srcNode.kind !== 'note') {
      bindLocalVar('self', srcNode.id)
    }
    if (e.kind === 'resource') {
      const edgeStateIns = gIdx.stateInByEdge.get(e.id) ?? EMPTY_EDGES
      const nodeStateIns = gIdx.stateInByNode.get(e.from) ?? EMPTY_EDGES
      const combined =
        edgeStateIns.length && nodeStateIns.length
          ? [...edgeStateIns, ...nodeStateIns]
          : edgeStateIns.length
            ? edgeStateIns
            : nodeStateIns
      combined.forEach((se, idx) => {
        if (idx < POSITIONAL_LETTERS.length) {
          bindLocalVar(POSITIONAL_LETTERS[idx]!, se.from)
        }
        if (se.label?.trim()) {
          const customVar = mxIdentifier(se.label.trim())
          if (customVar) bindLocalVar(customVar, se.from)
        }
      })
      if (
        !boundLocalA &&
        srcNode &&
        srcNode.kind !== 'source' &&
        srcNode.kind !== 'note' &&
        !hasExplicitNodeA
      ) {
        bindLocalVar('a', srcNode.id)
      }
    } else if (e.kind === 'state' && srcNode && srcNode.kind !== 'note' && !hasExplicitNodeA) {
      bindLocalVar('a', srcNode.id)
    }

    let compactRateText = rawRate
    let rateValSummary = rawRate

    if (rateComplex) {
      if (e.kind === 'resource') {
        const cmpMatch = /^(>=|<=|==|!=|<>|[><=≥≤≠])\s*(.+)$/.exec(rawRate)
        if (cmpMatch && !/&&|\|\|/.test(cmpMatch[2]!)) {
          const normOp = normalizeMxDisplayCmpOp(cmpMatch[1]!)
          const ev = evalSegmentPreview(cmpMatch[2]!, evalVars)
          rateValSummary = ev.ok ? `${normOp}${ev.text}` : normOp
          compactRateText = ev.ok ? `ƒx · ${rateValSummary}` : 'ƒx'
        } else {
          const atProbMatch = /^(.*?)\s*@\s*(\d+(?:\.\d+)?)\s*%$/.exec(rawRate)
          const pctSuffixMatch = !atProbMatch ? /^(.+?)\s*%$/.exec(rawRate) : null
          if (atProbMatch && atProbMatch[1]!.trim()) {
            const ev = evalSegmentPreview(atProbMatch[1]!, evalVars)
            rateValSummary = ev.ok ? `${ev.text}@${atProbMatch[2]}%` : '?'
            compactRateText = ev.ok ? `ƒx · ${rateValSummary}` : 'ƒx'
          } else if (pctSuffixMatch && pctSuffixMatch[1]!.trim()) {
            const ev = evalSegmentPreview(pctSuffixMatch[1]!, evalVars)
            rateValSummary = ev.ok ? `${ev.text}%` : '?'
            compactRateText = ev.ok ? `ƒx · ${rateValSummary}` : 'ƒx'
          } else {
            const ev = evalSegmentPreview(rawRate, evalVars)
            rateValSummary = ev.ok ? ev.text : '?'
            compactRateText = ev.ok ? `ƒx · ${ev.text}` : 'ƒx'
          }
        }
      } else {
        const sv = parseSignedVarStateModifier(rawRate)
        if (sv) {
          const ev = evalSegmentPreview(sv.ident, evalVars)
          if (ev.ok) {
            const delta = sv.sign * ev.num
            const prefix = delta >= 0 ? '+' : ''
            const suffix = `${sv.percent ? '%' : ''}${sv.interval ? 'i' : ''}`
            rateValSummary = `${prefix}${formatMxCompactNum(delta)}${suffix}`
            compactRateText = `ƒx · ${rateValSummary}`
          } else {
            rateValSummary = '?'
            compactRateText = 'ƒx'
          }
        } else {
          const cmpMatch = /^(>=|<=|==|!=|<>|[><=≥≤≠])\s*(.+)$/.exec(rawRate)
          if (cmpMatch && !/&&|\|\|/.test(cmpMatch[2]!)) {
            const normOp = normalizeMxDisplayCmpOp(cmpMatch[1]!)
            const ev = evalSegmentPreview(cmpMatch[2]!, evalVars)
            rateValSummary = ev.ok ? `${normOp}${ev.text}` : normOp
            compactRateText = ev.ok ? `ƒx · ${rateValSummary}` : 'ƒx'
          } else {
            const stSpec = parseMxStateFormula(rawRate)
            const exprStr = stSpec.type === 'expr' ? stSpec.expr : rawRate
            const ev = evalSegmentPreview(exprStr, evalVars)
            if (!ev.ok) {
              rateValSummary = '?'
              compactRateText = 'ƒx'
            } else if (isMxBooleanStateExpr(exprStr)) {
              const pass = Math.abs(ev.num) > 1e-9
              rateValSummary = pass ? '✓' : '×'
              compactRateText = `ƒx · ${rateValSummary}`
            } else {
              const plusPrefix = rawRate.startsWith('+') && ev.num >= 0 ? '+' : ''
              rateValSummary = `${plusPrefix}${ev.text}`
              compactRateText = `ƒx · ${rateValSummary}`
            }
          }
        }
      }
    }

    let compactIntervalText = rawIv
    let ivValSummary = rawIv
    if (ivComplex) {
      const ivEv = evalSegmentPreview(rawIv, evalVars)
      if (ivEv.ok) {
        ivValSummary = ivEv.stochastic
          ? ivEv.text
          : formatMxCompactNum(Math.max(1, Math.round(ivEv.num)))
        compactIntervalText = `ƒx·${ivValSummary}`
      } else {
        ivValSummary = '?'
        compactIntervalText = 'ƒx'
      }
    }

    const valuePreview = rawIv ? `${rateValSummary} | ${ivValSummary}` : rateValSummary
    const tooltipText = `ƒx: ${authoredFull}  ⇒  ${valuePreview}`

    result.set(e.id, {
      compactRateText,
      compactIntervalText,
      valuePreview,
      tooltipText
    })
  }

  return result
}

// ───────── 多色资源池（LIFO / Shuffle / Color Filter）辅助函数 ─────────

function countPoolTokensByColor(state: MxRuntimeState, poolId: string, resId?: string): number {
  const totalVal = state.values[poolId] ?? 0
  if (totalVal <= 0) return 0
  if (!resId) return totalVal
  const stack = state.poolTokens?.[poolId]
  if (!stack || !stack.length) return 0
  let sum = 0
  for (const item of stack) {
    if (item.resId === resId && item.count > 0) sum += item.count
  }
  return Math.round(sum * 1000) / 1000
}

function pushPoolTokens(
  state: MxRuntimeState,
  pool: MxNode,
  positiveAdded: number,
  resId: string | undefined
): void {
  if (positiveAdded <= 0 || !state.poolTokens) return
  const color = resId || pool.resourceId || 'default'
  const stack = (state.poolTokens[pool.id] ??= [])
  const top = stack[stack.length - 1]
  if (top && top.resId === color) {
    top.count = Math.round((top.count + positiveAdded) * 1000) / 1000
  } else {
    stack.push({ resId: color, count: Math.round(positiveAdded * 1000) / 1000 })
  }
}

function popPoolTokens(
  state: MxRuntimeState,
  pool: MxNode,
  amount: number,
  options: { filterResId?: string; shuffle?: boolean; rng: () => number }
): MxPoolTokenStackItem[] {
  if (amount <= 0) return []
  const stack = state.poolTokens?.[pool.id]
  const fallbackColor = options.filterResId || pool.resourceId || 'default'
  if (!stack || !stack.length) {
    return [{ resId: fallbackColor, count: amount }]
  }

  // 指定颜色过滤：从栈顶向栈底后进先出抽取对应颜色
  if (options.filterResId) {
    let rem = amount
    let taken = 0
    for (let i = stack.length - 1; i >= 0 && rem > 1e-9; i--) {
      const it = stack[i]!
      if (it.resId !== options.filterResId || it.count <= 0) continue
      const c = Math.min(it.count, rem)
      it.count = Math.round((it.count - c) * 1000) / 1000
      rem -= c
      taken += c
    }
    state.poolTokens![pool.id] = stack.filter((x) => x.count > 1e-9)
    return taken > 0 ? [{ resId: options.filterResId, count: Math.round(taken * 1000) / 1000 }] : []
  }

  // Shuffle Origin：在存在多种颜色时按存量权重随机无放回抽取
  const distinctColors = new Set(stack.filter((x) => x.count > 1e-9).map((x) => x.resId))
  if (options.shuffle && distinctColors.size > 1) {
    const discreteUnits = Math.max(1, Math.min(64, Math.round(amount)))
    const unitSize = amount / discreteUnits
    const takenByColor = new Map<string, number>()
    for (let u = 0; u < discreteUnits; u++) {
      let totalPos = 0
      for (const it of stack) if (it.count > 1e-9) totalPos += it.count
      if (totalPos <= 1e-9) break
      const roll = options.rng() * totalPos
      let acc = 0
      let picked = stack[stack.length - 1]!
      for (const it of stack) {
        if (it.count <= 1e-9) continue
        acc += it.count
        if (roll <= acc) {
          picked = it
          break
        }
      }
      const c = Math.min(picked.count, unitSize)
      picked.count = Math.round((picked.count - c) * 1000) / 1000
      takenByColor.set(picked.resId, (takenByColor.get(picked.resId) ?? 0) + c)
    }
    state.poolTokens![pool.id] = stack.filter((x) => x.count > 1e-9)
    return Array.from(takenByColor.entries()).map(([resId, count]) => ({
      resId,
      count: Math.round(count * 1000) / 1000
    }))
  }

  // 默认 LIFO 后进先出抽取
  let rem = amount
  const out: MxPoolTokenStackItem[] = []
  while (rem > 1e-9 && stack.length > 0) {
    const top = stack[stack.length - 1]!
    if (top.count <= 1e-9) {
      stack.pop()
      continue
    }
    const c = Math.min(top.count, rem)
    top.count = Math.round((top.count - c) * 1000) / 1000
    rem -= c
    const prevOut = out[out.length - 1]
    if (prevOut && prevOut.resId === top.resId) {
      prevOut.count = Math.round((prevOut.count + c) * 1000) / 1000
    } else {
      out.push({ resId: top.resId, count: Math.round(c * 1000) / 1000 })
    }
    if (top.count <= 1e-9) stack.pop()
  }
  if (rem > 1e-6) {
    out.push({ resId: fallbackColor, count: Math.round(rem * 1000) / 1000 })
  }
  return out
}

function getStateEdgeOriginValue(
  doc: MxDocument,
  stateEdge: MxEdge,
  state: MxRuntimeState
): number {
  const src = getMxGraphIndex(doc).byId.get(stateEdge.from)
  if (stateEdge.resourceFilter && stateEdge.resourceId && src?.kind === 'pool') {
    return countPoolTokensByColor(state, src.id, stateEdge.resourceId)
  }
  if (src?.kind === 'gate' && state.gateLastRoll && stateEdge.from in state.gateLastRoll) {
    return state.gateLastRoll[stateEdge.from]!
  }
  return state.values[stateEdge.from] ?? 0
}

export function createMxInitialState(
  doc: MxDocument,
  options: { params?: Record<string, number>; seed?: number; scenarioId?: string } = {}
): MxRuntimeState {
  const gIdx = getMxGraphIndex(doc)
  const values: Record<string, number> = {}
  const buffers: Record<string, MxBufferItem[]> = {}
  const poolTokens: Record<string, MxPoolTokenStackItem[]> | undefined = gIdx.hasMultiColorResources
    ? {}
    : undefined
  for (const n of doc.nodes) {
    if (n.kind === 'pool') {
      const initVal = Math.min(capOf(n), Math.max(0, Number(n.initial ?? 0)))
      values[n.id] = initVal
      if (poolTokens && initVal > 0) {
        poolTokens[n.id] = [{ resId: n.resourceId || 'default', count: initVal }]
      }
    } else if (n.kind === 'register') {
      values[n.id] = Number(n.initial ?? 0)
    } else {
      values[n.id] = 0
    }
    if (n.kind === 'delay' || n.kind === 'queue') buffers[n.id] = []
  }
  const initRng = createMxRng((options.seed ?? doc.settings.seed ?? 1) * 3571 + 17)
  const params = options.params ?? resolveMxParams(doc, options.scenarioId, initRng)
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
    totalConsumed: 0,
    prevEdgeOrigin: {},
    edgeLastStep: {},
    edgeWaitSteps: {},
    gateTrigCount: {},
    gateQuotaSent: {},
    gateLastRoll: {},
    poolTokens,
    runtimeParams: { ...params }
  }
  recomputeRegisters(doc, state, params, initRng)
  for (const n of doc.nodes) state.active[n.id] = isNodeActive(doc, n, state, params)
  return state
}

function stateInputs(doc: MxDocument, nodeId: string): MxEdge[] {
  return getMxGraphIndex(doc).stateInByNode.get(nodeId) ?? EMPTY_EDGES
}

/** 判断任意资源边或状态边是否处于激活态（支持 State-to-State Activators） */
function isEdgeActive(
  doc: MxDocument,
  edge: MxEdge,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number,
  sharedVars?: Record<string, number>,
  depth = 0
): boolean {
  if (depth > 4) return true
  const gIdx = getMxGraphIndex(doc)
  const ins = gIdx.stateInByEdge.get(edge.id) ?? EMPTY_EDGES
  if (!ins.length) return true
  let vars = sharedVars
  for (const se of ins) {
    if (!isEdgeActive(doc, se, state, params, rng, vars, depth + 1)) continue
    const spec = getEffectiveStateSpec(doc, se, state, params, rng, vars, depth + 1)
    if (spec.type === 'expr' && !vars) {
      vars = buildVars(doc, state.values, params, state.step)
    }
    const srcVal = getStateEdgeOriginValue(doc, se, state)
    const act = checkActivator(spec, srcVal, vars ?? params, rng, gIdx.paramArrays)
    if (act === false) return false
  }
  return true
}

function evalArithmeticStateExprBonus(
  doc: MxDocument,
  gIdx: MxGraphIndex,
  expr: string,
  srcVal: number,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number,
  sharedVars?: Record<string, number>
): number {
  const trimmed = expr.trim()
  if (!trimmed || /^\d+(?:\.\d+)?$/.test(trimmed) || isMxBooleanStateExpr(trimmed)) return 0
  const baseVars = sharedVars ?? buildVars(doc, state.values, params, state.step)
  return evaluateMxExpression(
    trimmed,
    { vars: { ...baseVars, a: srcVal, self: srcVal }, arrays: gIdx.paramArrays, rng },
    0
  )
}

/** 计算经过 State-to-State Formula Modifiers / Overwrite 修正后的状态边有效语义 */
function getEffectiveStateSpec(
  doc: MxDocument,
  stateEdge: MxEdge,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number,
  sharedVars?: Record<string, number>,
  depth = 0
): MxStateSpec {
  let baseSpec = parseMxStateFormula(stateEdge.formula)
  const gIdx = getMxGraphIndex(doc)
  if (baseSpec.type === 'expr') {
    const sv = parseSignedVarStateModifier(baseSpec.expr)
    if (sv) {
      const v = sharedVars ?? buildVars(doc, state.values, params, state.step)
      const resolvedDelta =
        sv.sign * evaluateMxExpression(sv.ident, { vars: v, arrays: gIdx.paramArrays, rng }, 0)
      baseSpec = sv.interval
        ? { type: 'interval_modifier', delta: resolvedDelta, percent: sv.percent }
        : { type: 'modifier', delta: resolvedDelta, percent: sv.percent }
    }
  }
  if (depth > 4) return baseSpec
  const modEdges = gIdx.stateInByEdge.get(stateEdge.id) ?? EMPTY_EDGES
  if (!modEdges.length) return baseSpec

  let overwrittenVal: number | null = null
  let addBonus = 0
  let pctBonus = 0
  let lazyVars = sharedVars
  for (const me of modEdges) {
    if (!isEdgeActive(doc, me, state, params, rng, lazyVars, depth + 1)) continue
    const mSpec = getEffectiveStateSpec(doc, me, state, params, rng, lazyVars, depth + 1)
    const mOrigin = getStateEdgeOriginValue(doc, me, state)
    if (mSpec.type === 'overwrite') {
      overwrittenVal = mOrigin
    } else if (mSpec.type === 'modifier') {
      if (mSpec.percent) pctBonus += (mSpec.delta * mOrigin) / 100
      else addBonus += mSpec.delta * mOrigin
    } else if (mSpec.type === 'fraction_modifier' && mSpec.denominator > 0) {
      addBonus += Math.trunc(mOrigin / mSpec.denominator) * mSpec.numerator
    } else if (mSpec.type === 'expr') {
      if (!lazyVars) lazyVars = buildVars(doc, state.values, params, state.step)
      addBonus += evalArithmeticStateExprBonus(
        doc,
        gIdx,
        mSpec.expr,
        mOrigin,
        state,
        params,
        rng,
        lazyVars
      )
    }
  }
  if (overwrittenVal === null && addBonus === 0 && pctBonus === 0) return baseSpec

  if (baseSpec.type === 'modifier') {
    const start = overwrittenVal !== null ? overwrittenVal : baseSpec.delta
    return {
      type: 'modifier',
      delta: start * (1 + pctBonus) + addBonus,
      percent: overwrittenVal !== null ? false : baseSpec.percent
    }
  }
  if (baseSpec.type === 'interval_modifier') {
    const start = overwrittenVal !== null ? overwrittenVal : baseSpec.delta
    return {
      type: 'interval_modifier',
      delta: start * (1 + pctBonus) + addBonus,
      percent: overwrittenVal !== null ? false : baseSpec.percent
    }
  }
  if (baseSpec.type === 'probability') {
    const start = overwrittenVal !== null ? overwrittenVal : baseSpec.pct
    return {
      type: 'probability',
      pct: Math.max(0, start * (1 + pctBonus) + addBonus)
    }
  }
  if (baseSpec.type === 'activator') {
    const start = overwrittenVal !== null ? overwrittenVal : baseSpec.value
    return {
      type: 'activator',
      op: baseSpec.op,
      value: start * (1 + pctBonus) + addBonus
    }
  }
  return baseSpec
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
  // 两遍，允许寄存器链式引用；若第一遍全部为无输入纯常数寄存器，则无需重复第二遍
  for (let pass = 0; pass < 2; pass++) {
    let sharedVars: Record<string, number> | null = null
    let allPureConst = true
    for (const n of regs) {
      const inputs = gIdx.stateInByNode.get(n.id) ?? EMPTY_EDGES
      if (inputs.length === 0) {
        const rawF = n.formula?.trim()
        if (!rawF && n.trigger === 'interactive') continue
        const constStr = rawF || String(n.initial ?? 0)
        if (PURE_DECIMAL_LITERAL_RE.test(constStr)) {
          let cv = Number(constStr)
          if (n.min != null) cv = Math.max(n.min, cv)
          if (n.max != null) cv = Math.min(n.max, cv)
          state.values[n.id] = Math.round(cv * 1000) / 1000
          continue
        }
      }
      allPureConst = false
      const isFuncReg = isFunctionRegisterNode(n)
      // 若为无公式交互寄存器，或由 Node Modifier (+2 / -1 / +1/3 / =) 直接驱动的数值寄存器，保留其状态值（不在函数求值阶段重置）
      if (!isFuncReg) {
        if (n.trigger === 'interactive' && !n.formula?.trim()) continue
        const drivenByNodeMod = inputs.some((se) => {
          const sp = parseMxStateFormula(se.formula)
          if (
            sp.type === 'modifier' ||
            sp.type === 'fraction_modifier' ||
            sp.type === 'overwrite'
          ) {
            return true
          }
          if (sp.type === 'expr') {
            const sv = parseSignedVarStateModifier(sp.expr)
            return Boolean(sv && !sv.interval)
          }
          return false
        })
        if (drivenByNodeMod) continue
      }

      // 检查是否有激活的 Overwrite `=` 状态边覆盖该函数寄存器
      let overwrittenByEdge: number | null = null
      for (const se of inputs) {
        if (!isEdgeActive(doc, se, state, params, rng, sharedVars ?? undefined)) continue
        if (parseMxStateFormula(se.formula).type === 'overwrite') {
          overwrittenByEdge = getStateEdgeOriginValue(doc, se, state)
        }
      }

      let v: number
      if (overwrittenByEdge !== null) {
        v = overwrittenByEdge
      } else {
        const expr = n.formula || (inputs.length ? 'a' : String(n.initial ?? 0))
        let vars: Record<string, number> = params
        if (exprNeedsVars(expr)) {
          if (!sharedVars) sharedVars = buildVars(doc, state.values, params, state.step)
          vars = { ...sharedVars }
          for (let idx = 0; idx < inputs.length && idx < POSITIONAL_LETTERS.length; idx++) {
            const inEdge = inputs[idx]!
            const srcEnabled = !n.ignoreDisabledInputs || state.active[inEdge.from] !== false
            const val =
              srcEnabled && isEdgeActive(doc, inEdge, state, params, rng, sharedVars)
                ? getStateEdgeOriginValue(doc, inEdge, state)
                : 0
            vars[POSITIONAL_LETTERS[idx]!] = val
            if (inEdge.label?.trim()) {
              const customVar = mxIdentifier(inEdge.label)
              if (customVar) vars[customVar] = val
            }
          }
        }
        v = evaluateMxExpression(expr, { vars, arrays: gIdx.paramArrays, rng }, n.initial ?? 0)
      }
      if (n.min != null) v = Math.max(n.min, v)
      if (n.max != null) v = Math.min(n.max, v)
      state.values[n.id] = Math.round(v * 1000) / 1000
      if (sharedVars) {
        sharedVars[n.id] = state.values[n.id]!
        const ident = mxIdentifier(n.label)
        if (ident && !(ident in params)) sharedVars[ident] = state.values[n.id]!
      }
    }
    if (allPureConst) break
  }
}

function checkActivator(
  spec: MxStateSpec,
  v: number,
  vars: Record<string, number>,
  rng: () => number,
  arrays?: Record<string, number[] | number[][]>
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
      // 带比较运算符或 Math.js 关系/逻辑函数的表达式视为激活条件，用 `a` 代表源节点值
      if (!isMxBooleanStateExpr(spec.expr)) return null
      return (
        evaluateMxExpression(spec.expr, { vars: { ...vars, a: v, self: v }, arrays, rng }, 0) !== 0
      )
    }
    default:
      return null
  }
}

const SHARED_NOP_RNG = (): number => 0.5

function isNodeActive(
  doc: MxDocument,
  node: MxNode,
  state: MxRuntimeState,
  params: Record<string, number>,
  sharedVars?: Record<string, number>
): boolean {
  const gIdx = getMxGraphIndex(doc)
  const ins = gIdx.stateInByNode.get(node.id)
  if (!ins || !ins.length) return true
  let vars: Record<string, number> | undefined = sharedVars
  for (const e of ins) {
    if (!isEdgeActive(doc, e, state, params, SHARED_NOP_RNG, vars)) continue
    const spec = getEffectiveStateSpec(doc, e, state, params, SHARED_NOP_RNG, vars)
    if (spec.type === 'expr' && !vars) {
      vars = buildVars(doc, state.values, params, state.step)
    }
    const res = checkActivator(
      spec,
      getStateEdgeOriginValue(doc, e, state),
      vars ?? params,
      SHARED_NOP_RNG,
      gIdx.paramArrays
    )
    if (res === false) return false
  }
  return true
}

const NO_MOD_RESULT = { bonus: 0, overwrite: null } as const

const MX_COND_GATE_OUT_EXPR_RE =
  /^(?:>=|<=|==|!=|<>|>|<|=|-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?$)/
const MX_STOCHASTIC_FLOW_EXPR_RE = /\b\d*[dD]\d+\b|\.\.|random|rand/i

function formatModNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function isActiveFormulaModifierSpec(spec: MxStateSpec): boolean {
  if (spec.type === 'overwrite' || spec.type === 'modifier' || spec.type === 'fraction_modifier') {
    return true
  }
  if (spec.type === 'expr') {
    const trimmed = spec.expr.trim()
    return Boolean(trimmed && !/^\d+(?:\.\d+)?$/.test(trimmed) && !isMxBooleanStateExpr(trimmed))
  }
  return false
}

export interface MxEdgeRuntimeGateSnapshot {
  /** 条件型状态边当前求值为 false（未满足条件，处于静默待命态） */
  dormantStateEdgeIds: Set<string>
  /** 资源边或状态边因入向条件状态边（或节点级条件状态边）未满足而被门控关断 */
  gatedOffEdgeIds: Set<string>
  /** 运行时因状态修正器（+1 / -2 / +50% / +1/3 / = / +1i 等）生效而动态改变的有效公式文本 */
  modifiedEdgeFormulas: Map<string, string>
}

/**
 * 根据当前画布节点快照数值，评估所有条件状态边的激活真值、被门控关断的资源边集合，
 * 以及受状态修正器（Formula / Interval Modifiers）动态改写后的连线实时有效公式，
 * 供实时画布与 SVG/PNG 架构图导出统一渲染运行态开关状态、`→ 0` 锁止提示与动态公式值。
 */
export function evaluateMxEdgeRuntimeGates(
  doc: MxDocument,
  options: {
    values?: Record<string, number> | null
    poolTokens?: Record<string, MxPoolTokenStackItem[]> | null
    step?: number
    params?: Record<string, number>
  } = {}
): MxEdgeRuntimeGateSnapshot {
  const dormantStateEdgeIds = new Set<string>()
  const gatedOffEdgeIds = new Set<string>()
  const modifiedEdgeFormulas = new Map<string, string>()
  if (!doc.edges.some((e) => e.kind === 'state')) {
    return { dormantStateEdgeIds, gatedOffEdgeIds, modifiedEdgeFormulas }
  }

  const gIdx = getMxGraphIndex(doc)
  const values: Record<string, number> = {}
  for (const n of doc.nodes) {
    if (options.values && n.id in options.values) {
      values[n.id] = options.values[n.id] ?? 0
    } else if (n.kind === 'pool') {
      values[n.id] = Math.min(capOf(n), Math.max(0, Number(n.initial ?? 0)))
    } else if (n.kind === 'register') {
      values[n.id] = Number(n.initial ?? 0)
    } else {
      values[n.id] = 0
    }
  }

  const step = options.step ?? 0
  const params = options.params ?? resolveMxParams(doc)
  const state: MxRuntimeState = {
    step,
    values,
    active: {},
    gateCursor: {},
    buffers: {},
    edgeFlows: {},
    fired: {},
    ended: false,
    totalProduced: 0,
    totalConsumed: 0,
    poolTokens: options.poolTokens ?? undefined
  }
  const vars = buildVars(doc, values, params, step)

  const nodeActiveById = new Map<string, boolean>()
  const checkNodeActiveCached = (n: MxNode | undefined): boolean => {
    if (!n) return true
    const cached = nodeActiveById.get(n.id)
    if (cached !== undefined) return cached
    const active = isNodeActive(doc, n, state, params, vars)
    nodeActiveById.set(n.id, active)
    return active
  }

  const hasNodeActiveFormulaMod = (nodeId: string): boolean => {
    const ins = gIdx.stateInByNode.get(nodeId)
    if (!ins || !ins.length) return false
    for (const se of ins) {
      if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
      const sp = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
      if (isActiveFormulaModifierSpec(sp)) return true
    }
    return false
  }

  for (const e of doc.edges) {
    const edgeOpen = isEdgeActive(doc, e, state, params, SHARED_NOP_RNG, vars)
    if (!edgeOpen) {
      gatedOffEdgeIds.add(e.id)
    }

    if (e.kind === 'state') {
      const srcNode = gIdx.byId.get(e.from)
      const incomingStateMods = gIdx.stateInByEdge.get(e.id) ?? EMPTY_EDGES
      const effSpec = getEffectiveStateSpec(doc, e, state, params, SHARED_NOP_RNG, vars)

      if (incomingStateMods.length > 0) {
        let hasActiveModOnState = false
        for (const me of incomingStateMods) {
          if (!isEdgeActive(doc, me, state, params, SHARED_NOP_RNG, vars)) continue
          const mSpec = getEffectiveStateSpec(doc, me, state, params, SHARED_NOP_RNG, vars)
          if (isActiveFormulaModifierSpec(mSpec)) {
            hasActiveModOnState = true
            break
          }
        }
        if (hasActiveModOnState) {
          let nextStateStr: string | null = null
          if (effSpec.type === 'modifier') {
            nextStateStr = `${effSpec.delta >= 0 ? '+' : ''}${formatModNum(effSpec.delta)}${effSpec.percent ? '%' : ''}`
          } else if (effSpec.type === 'interval_modifier') {
            nextStateStr = `${effSpec.delta >= 0 ? '+' : ''}${formatModNum(effSpec.delta)}${effSpec.percent ? '%' : ''}i`
          } else if (effSpec.type === 'probability') {
            nextStateStr = `${formatModNum(effSpec.pct)}%`
          } else if (effSpec.type === 'activator') {
            nextStateStr = `${effSpec.op}${formatModNum(effSpec.value)}`
          }
          const authoredState = (e.formula || '*').trim()
          if (nextStateStr !== null && nextStateStr !== authoredState) {
            modifiedEdgeFormulas.set(e.id, nextStateStr)
          }
        }
      }

      if (srcNode?.kind === 'gate') continue
      if (!edgeOpen) {
        dormantStateEdgeIds.add(e.id)
        continue
      }
      const act = checkActivator(
        effSpec,
        getStateEdgeOriginValue(doc, e, state),
        vars,
        SHARED_NOP_RNG,
        gIdx.paramArrays
      )
      if (act === false) {
        dormantStateEdgeIds.add(e.id)
      }
    } else if (e.kind === 'resource') {
      const srcNode = gIdx.byId.get(e.from)
      const dstNode = gIdx.byId.get(e.to)
      if (edgeOpen) {
        if (!checkNodeActiveCached(srcNode)) {
          gatedOffEdgeIds.add(e.id)
        } else if (dstNode) {
          const defaultSrcTrigger =
            srcNode?.kind === 'source' || srcNode?.kind === 'drain' || srcNode?.kind === 'converter'
              ? 'automatic'
              : 'passive'
          const srcTrigger = srcNode?.trigger ?? defaultSrcTrigger
          const blockedByDst =
            dstNode.kind === 'gate' ||
            (srcTrigger === 'passive' &&
              (dstNode.kind === 'converter' ||
                dstNode.kind === 'drain' ||
                dstNode.kind === 'trader'))
          if (blockedByDst && !checkNodeActiveCached(dstNode)) {
            gatedOffEdgeIds.add(e.id)
          }
        }
      }

      // 计算状态修正器（+1 / -2 / +50% / +1/3 / = / +1i）对资源边显示公式的实时修正值
      const edgeStateIns = gIdx.stateInByEdge.get(e.id) ?? EMPTY_EDGES
      const isGateOut = srcNode?.kind === 'gate'
      const isFirstGateOut = isGateOut && gIdx.outResByNode.get(srcNode.id)?.[0]?.id === e.id
      const srcModEligible = Boolean(
        srcNode &&
        srcNode.kind !== 'pool' &&
        srcNode.kind !== 'register' &&
        (!isGateOut || isFirstGateOut)
      )
      const srcIntervalEligible = Boolean(
        srcNode && srcNode.kind !== 'pool' && srcNode.kind !== 'register'
      )
      const dstModEligible = Boolean(dstNode?.kind === 'drain')

      const hasCandidateStateIns =
        edgeStateIns.length > 0 ||
        (srcIntervalEligible && gIdx.stateInByNode.has(srcNode!.id)) ||
        (dstModEligible && gIdx.stateInByNode.has(dstNode!.id))
      if (!hasCandidateStateIns) continue

      const spec = parseMxFlowFormula(e.formula)
      const strippedCore = e.formula.replace(/\s*(?:\||every\b).*$/i, '').trim()
      const isCondGateBranch = isGateOut && MX_COND_GATE_OUT_EXPR_RE.test(strippedCore)

      let hasIntervalMod = false
      let ivAddBonus = 0
      let ivPctBonus = 0
      for (const se of edgeStateIns) {
        if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
        const sp = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
        if (sp.type === 'interval_modifier') {
          hasIntervalMod = true
          const originVal = getStateEdgeOriginValue(doc, se, state)
          if (sp.percent) ivPctBonus += (sp.delta * originVal) / 100
          else ivAddBonus += sp.delta * originVal
        }
      }
      if (srcIntervalEligible) {
        const srcIns = gIdx.stateInByNode.get(srcNode!.id) ?? EMPTY_EDGES
        for (const se of srcIns) {
          if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
          const sp = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
          if (sp.type === 'interval_modifier') {
            hasIntervalMod = true
            const originVal = getStateEdgeOriginValue(doc, se, state)
            if (sp.percent) ivPctBonus += (sp.delta * originVal) / 100
            else ivAddBonus += sp.delta * originVal
          }
        }
      }

      let hasDirectFormulaMod = false
      let edgeOverwrite: number | null = null
      let edgeAddBonus = 0
      let edgePctBonus = 0
      if (!isCondGateBranch && spec.type !== 'all') {
        for (const se of edgeStateIns) {
          if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
          const stSpec = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
          if (!isActiveFormulaModifierSpec(stSpec)) continue
          hasDirectFormulaMod = true
          const srcVal = getStateEdgeOriginValue(doc, se, state)
          if (stSpec.type === 'overwrite') {
            edgeOverwrite = srcVal
          } else if (stSpec.type === 'modifier') {
            if (stSpec.percent) edgePctBonus += (stSpec.delta * srcVal) / 100
            else edgeAddBonus += stSpec.delta * srcVal
          } else if (stSpec.type === 'fraction_modifier' && stSpec.denominator > 0) {
            edgeAddBonus += Math.trunc(srcVal / stSpec.denominator) * stSpec.numerator
          } else if (stSpec.type === 'expr') {
            edgeAddBonus += evalArithmeticStateExprBonus(
              doc,
              gIdx,
              stSpec.expr,
              srcVal,
              state,
              params,
              SHARED_NOP_RNG,
              vars
            )
          }
        }
      }

      const hasSrcFormulaMod =
        !isCondGateBranch &&
        spec.type !== 'all' &&
        srcModEligible &&
        hasNodeActiveFormulaMod(srcNode!.id)
      const hasDstFormulaMod =
        !isCondGateBranch &&
        spec.type !== 'all' &&
        dstModEligible &&
        hasNodeActiveFormulaMod(dstNode!.id)
      const hasFormulaMod = hasDirectFormulaMod || hasSrcFormulaMod || hasDstFormulaMod

      if (!hasFormulaMod && !hasIntervalMod) continue

      const rawAuthorFormula = (e.formula || '1').trim()
      const rawIvExpr = spec.intervalExpr ?? e.interval?.trim()
      const authoredBaseText = strippedCore || '1'
      const authoredWithIv =
        e.interval?.trim() && e.interval.trim() !== '1' && !/\bevery\b|\|/i.test(rawAuthorFormula)
          ? `${rawAuthorFormula}|${e.interval.trim()}`
          : rawAuthorFormula

      let effectiveBaseText = authoredBaseText
      if (hasFormulaMod && spec.type !== 'all') {
        const isStochasticBase =
          spec.probability == null && MX_STOCHASTIC_FLOW_EXPR_RE.test(spec.expr)
        if (isGateOut) {
          // 严格对齐 distributeGate -> computeGateWeights 权重修正语义
          if (isStochasticBase && edgeOverwrite === null) {
            let mult = 1 + edgePctBonus
            let add = edgeAddBonus
            if (isFirstGateOut && hasSrcFormulaMod) {
              const gIns = gIdx.stateInByNode.get(srcNode!.id) ?? EMPTY_EDGES
              let gOverwrite: number | null = null
              for (const se of gIns) {
                if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
                const sp = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
                const sv = getStateEdgeOriginValue(doc, se, state)
                if (sp.type === 'overwrite') gOverwrite = Math.max(0, sv)
                else if (sp.type === 'modifier') {
                  if (sp.percent) mult *= 1 + (sp.delta * sv) / 100
                  else add += sp.delta * sv
                } else if (sp.type === 'fraction_modifier' && sp.denominator > 0) {
                  add += Math.trunc(sv / sp.denominator) * sp.numerator
                } else if (sp.type === 'expr') {
                  add += evalArithmeticStateExprBonus(
                    doc,
                    gIdx,
                    sp.expr,
                    sv,
                    state,
                    params,
                    SHARED_NOP_RNG,
                    vars
                  )
                }
              }
              if (gOverwrite !== null) {
                effectiveBaseText = formatModNum(gOverwrite)
              } else {
                const wrap = /^[a-zA-Z0-9_.]+$/.test(spec.expr.trim())
                  ? spec.expr.trim()
                  : `(${spec.expr.trim()})`
                const scaled =
                  Math.abs(mult - 1) > 1e-9 ? `${wrap}*${formatModNum(Math.max(0, mult))}` : wrap
                effectiveBaseText =
                  Math.abs(add) > 1e-9
                    ? `${scaled}${add > 0 ? '+' : ''}${formatModNum(add)}`
                    : scaled
              }
            } else {
              const wrap = /^[a-zA-Z0-9_.]+$/.test(spec.expr.trim())
                ? spec.expr.trim()
                : `(${spec.expr.trim()})`
              const scaled =
                Math.abs(edgePctBonus) > 1e-9
                  ? `${wrap}*${formatModNum(Math.max(0, 1 + edgePctBonus))}`
                  : wrap
              effectiveBaseText =
                Math.abs(edgeAddBonus) > 1e-9
                  ? `${scaled}${edgeAddBonus > 0 ? '+' : ''}${formatModNum(edgeAddBonus)}`
                  : scaled
            }
          } else {
            let w =
              spec.probability != null
                ? spec.probability * 100
                : Math.max(
                    0,
                    evaluateMxExpression(
                      spec.expr,
                      { vars, arrays: gIdx.paramArrays, rng: SHARED_NOP_RNG },
                      1
                    )
                  )
            let hadOverwrite = false
            for (const se of edgeStateIns) {
              if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
              const sp = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
              const sv = getStateEdgeOriginValue(doc, se, state)
              if (sp.type === 'overwrite') {
                w = Math.max(0, sv)
                hadOverwrite = true
              } else if (sp.type === 'modifier') {
                w = Math.max(0, sp.percent ? w * (1 + (sp.delta * sv) / 100) : w + sp.delta * sv)
              } else if (sp.type === 'fraction_modifier' && sp.denominator > 0) {
                w = Math.max(0, w + Math.trunc(sv / sp.denominator) * sp.numerator)
              } else if (sp.type === 'expr') {
                w = Math.max(
                  0,
                  w +
                    evalArithmeticStateExprBonus(
                      doc,
                      gIdx,
                      sp.expr,
                      sv,
                      state,
                      params,
                      SHARED_NOP_RNG,
                      vars
                    )
                )
              }
            }
            if (isFirstGateOut && hasSrcFormulaMod) {
              const gateMod = modifierBonus(doc, srcNode!.id, state, w, params, SHARED_NOP_RNG)
              if (gateMod.overwrite !== null) {
                w = Math.max(0, gateMod.overwrite)
                hadOverwrite = true
              } else {
                w = Math.max(0, w + gateMod.bonus)
              }
            }
            effectiveBaseText =
              spec.probability != null && !hadOverwrite ? `${formatModNum(w)}%` : formatModNum(w)
          }
        } else if (spec.probability != null && spec.expr === '1' && edgeOverwrite === null) {
          // 百分比概率资源边（如 50% 被 +10 修正为 60%）
          const srcMod = hasSrcFormulaMod
            ? modifierBonus(doc, srcNode!.id, state, spec.probability * 100, params, SHARED_NOP_RNG)
            : NO_MOD_RESULT
          const basePct = srcMod.overwrite !== null ? srcMod.overwrite : spec.probability * 100
          const effPct = Math.max(0, basePct * (1 + edgePctBonus) + edgeAddBonus + srcMod.bonus)
          effectiveBaseText =
            srcMod.overwrite !== null ? formatModNum(effPct) : `${formatModNum(effPct)}%`
        } else if (isStochasticBase && edgeOverwrite === null) {
          const srcMod = hasSrcFormulaMod
            ? modifierBonus(doc, srcNode!.id, state, 1, params, SHARED_NOP_RNG)
            : NO_MOD_RESULT
          const dstMod = hasDstFormulaMod
            ? modifierBonus(doc, dstNode!.id, state, 1, params, SHARED_NOP_RNG)
            : NO_MOD_RESULT
          if (srcMod.overwrite !== null || dstMod.overwrite !== null) {
            const ovBase = srcMod.overwrite ?? dstMod.overwrite ?? 0
            const total =
              ovBase + srcMod.bonus + dstMod.bonus + ovBase * edgePctBonus + edgeAddBonus
            effectiveBaseText = formatModNum(
              applyEdgeLimits(e, Math.max(0, Math.round(total * 1000) / 1000))
            )
          } else {
            let nodePct = 0
            let nodeAdd = 0
            const collectNodeStochastic = (nId: string): void => {
              const ins = gIdx.stateInByNode.get(nId) ?? EMPTY_EDGES
              for (const se of ins) {
                if (!isEdgeActive(doc, se, state, params, SHARED_NOP_RNG, vars)) continue
                const sp = getEffectiveStateSpec(doc, se, state, params, SHARED_NOP_RNG, vars)
                const sv = getStateEdgeOriginValue(doc, se, state)
                if (sp.type === 'modifier') {
                  if (sp.percent) nodePct += (sp.delta * sv) / 100
                  else nodeAdd += sp.delta * sv
                } else if (sp.type === 'fraction_modifier' && sp.denominator > 0) {
                  nodeAdd += Math.trunc(sv / sp.denominator) * sp.numerator
                } else if (sp.type === 'expr') {
                  nodeAdd += evalArithmeticStateExprBonus(
                    doc,
                    gIdx,
                    sp.expr,
                    sv,
                    state,
                    params,
                    SHARED_NOP_RNG,
                    vars
                  )
                }
              }
            }
            if (hasSrcFormulaMod) collectNodeStochastic(srcNode!.id)
            if (hasDstFormulaMod) collectNodeStochastic(dstNode!.id)
            const totalMult = 1 + edgePctBonus + nodePct
            const totalAdd = edgeAddBonus + nodeAdd
            const wrap = /^[a-zA-Z0-9_.]+$/.test(spec.expr.trim())
              ? spec.expr.trim()
              : `(${spec.expr.trim()})`
            const scaled =
              Math.abs(totalMult - 1) > 1e-9
                ? `${wrap}*${formatModNum(Math.max(0, totalMult))}`
                : wrap
            effectiveBaseText =
              Math.abs(totalAdd) > 1e-9
                ? `${scaled}${totalAdd > 0 ? '+' : ''}${formatModNum(totalAdd)}`
                : scaled
          }
        } else {
          // 常规数值/变量公式边（严格对齐 evalFlowAmount）
          let base = 1
          if (edgeOverwrite !== null) {
            base = edgeOverwrite
          } else if (exprNeedsVars(spec.expr)) {
            const evalVars: Record<string, number> = { ...vars }
            if (srcNode) evalVars.self = state.values[srcNode.id] ?? 0
            const nodeStateIns = srcNode
              ? (gIdx.stateInByNode.get(srcNode.id) ?? EMPTY_EDGES)
              : EMPTY_EDGES
            const combinedStateIns =
              edgeStateIns.length && nodeStateIns.length
                ? [...edgeStateIns, ...nodeStateIns]
                : edgeStateIns.length
                  ? edgeStateIns
                  : nodeStateIns
            combinedStateIns.forEach((se, idx) => {
              const originVal = getStateEdgeOriginValue(doc, se, state)
              if (idx < POSITIONAL_LETTERS.length) {
                evalVars[POSITIONAL_LETTERS[idx]!] = originVal
              }
              if (se.label?.trim()) {
                const customVar = mxIdentifier(se.label.trim())
                if (customVar) evalVars[customVar] = originVal
              }
            })
            if (!('a' in evalVars)) {
              evalVars.a =
                srcNode && srcNode.kind !== 'source' ? (state.values[srcNode.id] ?? 0) : state.step
            }
            base = evaluateMxExpression(
              spec.expr,
              { vars: evalVars, arrays: gIdx.paramArrays, rng: SHARED_NOP_RNG },
              1
            )
          } else {
            base = evaluateMxExpression(
              spec.expr,
              { vars: params, arrays: gIdx.paramArrays, rng: SHARED_NOP_RNG },
              1
            )
          }

          const srcMod = hasSrcFormulaMod
            ? modifierBonus(doc, srcNode!.id, state, base, params, SHARED_NOP_RNG)
            : NO_MOD_RESULT
          const dstMod = hasDstFormulaMod
            ? modifierBonus(doc, dstNode!.id, state, base, params, SHARED_NOP_RNG)
            : NO_MOD_RESULT
          if (edgeOverwrite === null) {
            if (srcMod.overwrite !== null) base = srcMod.overwrite
            else if (dstMod.overwrite !== null) base = dstMod.overwrite
          }
          const total = base + srcMod.bonus + dstMod.bonus + base * edgePctBonus + edgeAddBonus
          const clamped = applyEdgeLimits(e, Math.max(0, Math.round(total * 1000) / 1000))
          effectiveBaseText = formatModNum(clamped)
        }
      }

      let intervalSuffix = ''
      if (hasIntervalMod) {
        if (rawIvExpr && MX_STOCHASTIC_FLOW_EXPR_RE.test(rawIvExpr)) {
          const wrapIv = /^[a-zA-Z0-9_.]+$/.test(rawIvExpr) ? rawIvExpr : `(${rawIvExpr})`
          const scaledIv =
            Math.abs(ivPctBonus) > 1e-9
              ? `${wrapIv}*${formatModNum(Math.max(0, 1 + ivPctBonus))}`
              : wrapIv
          const modIv =
            Math.abs(ivAddBonus) > 1e-9
              ? `${scaledIv}${ivAddBonus > 0 ? '+' : ''}${formatModNum(ivAddBonus)}`
              : scaledIv
          intervalSuffix = `|${modIv}`
        } else {
          const baseIv = rawIvExpr
            ? /^\d+$/.test(rawIvExpr)
              ? Math.max(1, Number(rawIvExpr))
              : Math.max(
                  1,
                  Math.round(
                    evaluateMxExpression(
                      rawIvExpr,
                      {
                        vars: exprNeedsVars(rawIvExpr) ? vars : params,
                        arrays: gIdx.paramArrays,
                        rng: SHARED_NOP_RNG
                      },
                      1
                    )
                  )
                )
            : 1
          const effIv = Math.max(1, Math.round(baseIv * (1 + ivPctBonus) + ivAddBonus))
          if (effIv > 1 || Boolean(rawIvExpr && rawIvExpr !== '1')) {
            intervalSuffix = `|${effIv}`
          }
        }
      } else if (rawIvExpr && rawIvExpr !== '1') {
        intervalSuffix = `|${rawIvExpr}`
      }

      const nextFormulaStr = `${effectiveBaseText}${intervalSuffix}`
      if (nextFormulaStr !== authoredWithIv) {
        modifiedEdgeFormulas.set(e.id, nextFormulaStr)
      }
    }
  }

  return { dormantStateEdgeIds, gatedOffEdgeIds, modifiedEdgeFormulas }
}

/**
 * 执行 Node Modifiers（Pool / Register --(+x / -x / +x% / +n/d / =)--> Target Pool / Register）：
 * - 严格按源节点状态增量 ΔS 触发修改（Step 1 初值传导 + 步内任意状态变化传导）；
 * - 支持分数修改器（如 +1/3, -2/4：每跨过一个分母倍数步进修改分子）；
 * - 支持 Overwrite `=` 直接同步覆盖目标节点值；
 * - 允许目标 Pool 被负向 Node Modifier 扣成负数（负数期间阻塞出向资源流，直至回正）。
 */
function applyNodeStateModifiers(
  doc: MxDocument,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number
): void {
  const gIdx = getMxGraphIndex(doc)
  if (!gIdx.nodeModTargets.length) return
  state.prevEdgeOrigin ??= {}

  for (const target of gIdx.nodeModTargets) {
    const ins = gIdx.stateInByNode.get(target.id) ?? EMPTY_EDGES
    const isFuncReg = isFunctionRegisterNode(target)
    for (const se of ins) {
      if (!isEdgeActive(doc, se, state, params, rng)) continue
      const spec = getEffectiveStateSpec(doc, se, state, params, rng)
      const curOrigin = getStateEdgeOriginValue(doc, se, state)
      const prevOrigin = state.prevEdgeOrigin[se.id] ?? 0

      if (spec.type === 'overwrite') {
        let nextVal = curOrigin
        if (target.kind === 'pool') {
          const prevVal = state.values[target.id] ?? 0
          nextVal = Math.min(capOf(target), nextVal)
          if (nextVal > Math.max(0, prevVal)) {
            pushPoolTokens(state, target, nextVal - Math.max(0, prevVal), se.resourceId)
          } else if (nextVal < prevVal && nextVal >= 0) {
            popPoolTokens(state, target, prevVal - nextVal, { rng })
          } else if (nextVal <= 0 && state.poolTokens?.[target.id]) {
            state.poolTokens[target.id] = []
          }
        } else if (target.kind === 'register') {
          if (target.min != null) nextVal = Math.max(target.min, nextVal)
          if (target.max != null) nextVal = Math.min(target.max, nextVal)
        }
        state.values[target.id] = Math.round(nextVal * 1000) / 1000
        state.prevEdgeOrigin[se.id] = curOrigin
        continue
      }

      if (isFuncReg) continue

      let deltaTarget = 0
      if (spec.type === 'modifier') {
        const dS = curOrigin - prevOrigin
        if (Math.abs(dS) > 1e-9) {
          const curTarget = state.values[target.id] ?? 0
          deltaTarget = spec.percent ? (curTarget * spec.delta * dS) / 100 : spec.delta * dS
        }
      } else if (spec.type === 'fraction_modifier' && spec.denominator > 0) {
        const qNow =
          curOrigin >= 0
            ? Math.floor((curOrigin + 1e-9) / spec.denominator)
            : Math.ceil((curOrigin - 1e-9) / spec.denominator)
        const qPrev =
          prevOrigin >= 0
            ? Math.floor((prevOrigin + 1e-9) / spec.denominator)
            : Math.ceil((prevOrigin - 1e-9) / spec.denominator)
        if (qNow !== qPrev) {
          deltaTarget = spec.numerator * (qNow - qPrev)
        }
      } else {
        continue
      }

      state.prevEdgeOrigin[se.id] = curOrigin
      if (Math.abs(deltaTarget) <= 1e-9) continue

      const prevTargetVal = state.values[target.id] ?? 0
      let nextVal = prevTargetVal + deltaTarget
      if (target.kind === 'pool') {
        if (deltaTarget > 0) {
          nextVal = Math.min(capOf(target), nextVal)
          const posGain = Math.max(0, nextVal) - Math.max(0, prevTargetVal)
          if (posGain > 0) pushPoolTokens(state, target, posGain, se.resourceId)
        } else {
          // 负向 Node Modifier 允许 Pool 变为负数；同步削减池内正数 Token 栈
          const posLoss = Math.max(0, prevTargetVal) - Math.max(0, nextVal)
          if (posLoss > 0) popPoolTokens(state, target, posLoss, { rng })
        }
      } else if (target.kind === 'register') {
        if (target.min != null) nextVal = Math.max(target.min, nextVal)
        if (target.max != null) nextVal = Math.min(target.max, nextVal)
      }
      state.values[target.id] = Math.round(nextVal * 1000) / 1000
    }
  }
}

/** 状态连线对节点（Source / Drain / Gate / Delay）公式速率的修改量 */
function modifierBonus(
  doc: MxDocument,
  nodeId: string,
  state: MxRuntimeState,
  base: number,
  params: Record<string, number> = {},
  rng: () => number = SHARED_NOP_RNG
): { bonus: number; overwrite: number | null } {
  const gIdx = getMxGraphIndex(doc)
  const ins = gIdx.stateInByNode.get(nodeId)
  if (!ins || !ins.length) return NO_MOD_RESULT
  let sharedVars: Record<string, number> | undefined
  let bonus = 0
  let overwrite: number | null = null
  for (const e of ins) {
    if (!isEdgeActive(doc, e, state, params, rng, sharedVars)) continue
    const spec = getEffectiveStateSpec(doc, e, state, params, rng, sharedVars)
    const src = getStateEdgeOriginValue(doc, e, state)
    if (spec.type === 'overwrite') {
      overwrite = src
    } else if (spec.type === 'modifier') {
      bonus += spec.percent ? (base * spec.delta * src) / 100 : spec.delta * src
    } else if (spec.type === 'fraction_modifier' && spec.denominator > 0) {
      bonus += Math.trunc(src / spec.denominator) * spec.numerator
    } else if (spec.type === 'expr') {
      if (!sharedVars) sharedVars = buildVars(doc, state.values, params, state.step)
      bonus += evalArithmeticStateExprBonus(
        doc,
        gIdx,
        spec.expr,
        src,
        state,
        params,
        rng,
        sharedVars
      )
    }
  }
  return { bonus, overwrite }
}

/** 检查并推进资源连线的触发间隔（支持常数 `3|2`、随机区间 `1|3..6`、骰子 `D6|D6`、`edge.interval` 及 `+xi` 间隔修正器） */
function checkAndAdvanceEdgeInterval(
  doc: MxDocument,
  edge: MxEdge,
  spec: MxFlowSpec,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number,
  ensureVars: () => Record<string, number>,
  commitFire: boolean
): boolean {
  const gIdx = getMxGraphIndex(doc)
  const edgeStateIns = gIdx.stateInByEdge.get(edge.id) ?? EMPTY_EDGES
  const edgeSrcNode = gIdx.byId.get(edge.from)
  const srcStateIns =
    edgeSrcNode && edgeSrcNode.kind !== 'pool' && edgeSrcNode.kind !== 'register'
      ? stateInputs(doc, edge.from)
      : EMPTY_EDGES
  const rawIvExpr = spec.intervalExpr ?? edge.interval?.trim()

  // 计算 Interval Modifiers (+xi / -xi / +x%i)
  let ivAddBonus = 0
  let ivPctBonus = 0
  for (const se of edgeStateIns) {
    if (!isEdgeActive(doc, se, state, params, rng)) continue
    const sp = getEffectiveStateSpec(doc, se, state, params, rng)
    if (sp.type === 'interval_modifier') {
      const originVal = getStateEdgeOriginValue(doc, se, state)
      if (sp.percent) ivPctBonus += (sp.delta * originVal) / 100
      else ivAddBonus += sp.delta * originVal
    }
  }
  for (const se of srcStateIns) {
    if (!isEdgeActive(doc, se, state, params, rng)) continue
    const sp = getEffectiveStateSpec(doc, se, state, params, rng)
    if (sp.type === 'interval_modifier') {
      const originVal = getStateEdgeOriginValue(doc, se, state)
      if (sp.percent) ivPctBonus += (sp.delta * originVal) / 100
      else ivAddBonus += sp.delta * originVal
    }
  }

  const hasIntervalModifier = Math.abs(ivAddBonus) > 1e-9 || Math.abs(ivPctBonus) > 1e-9
  if (!rawIvExpr && !hasIntervalModifier) return true

  // 纯常数且无间隔修正器：快速路径
  if (rawIvExpr && /^\d+$/.test(rawIvExpr) && !hasIntervalModifier) {
    const fixedIv = Math.max(1, Number(rawIvExpr))
    return fixedIv <= 1 || state.step % fixedIv === 0
  }

  state.edgeLastStep ??= {}
  state.edgeWaitSteps ??= {}
  const lastStep = state.edgeLastStep[edge.id] ?? 0

  const sampleBaseIv = (): number => {
    if (!rawIvExpr) return 1
    if (/^\d+$/.test(rawIvExpr)) return Math.max(1, Number(rawIvExpr))
    const v = exprNeedsVars(rawIvExpr) ? ensureVars() : params
    return Math.max(
      1,
      Math.round(evaluateMxExpression(rawIvExpr, { vars: v, arrays: gIdx.paramArrays, rng }, 1))
    )
  }

  let baseWait = state.edgeWaitSteps[edge.id]
  if (baseWait == null) {
    baseWait = sampleBaseIv()
    state.edgeWaitSteps[edge.id] = baseWait
  }
  const effWait = Math.max(1, Math.round(baseWait * (1 + ivPctBonus) + ivAddBonus))
  if (state.step - lastStep < effWait) return false

  if (commitFire) {
    state.edgeLastStep[edge.id] = state.step
    state.edgeWaitSteps[edge.id] = sampleBaseIv()
  }
  return true
}

function applyEdgeLimits(edge: MxEdge, amount: number): number {
  if (amount <= 0 && (edge.minLimit == null || edge.minLimit <= 0)) return 0
  let res = amount
  if (edge.minLimit != null && Number.isFinite(edge.minLimit)) {
    res = Math.max(edge.minLimit, res)
  }
  if (edge.maxLimit != null && Number.isFinite(edge.maxLimit) && edge.maxLimit >= 0) {
    res = Math.min(edge.maxLimit, res)
  }
  res = Math.max(0, res)
  if (edge.allowDecimals === false) {
    res = Math.floor(res + 1e-9)
  }
  return res
}

function evalFlowAmount(
  doc: MxDocument,
  edge: MxEdge,
  state: MxRuntimeState,
  params: Record<string, number>,
  rng: () => number,
  available: number,
  commitInterval = true
): number {
  const gIdx = getMxGraphIndex(doc)
  const edgeStateIns = gIdx.stateInByEdge.get(edge.id) ?? EMPTY_EDGES

  // 1) 检查直接指向该连线的状态边（Activator，支持 State-to-State 级联）
  if (edgeStateIns.length > 0 && !isEdgeActive(doc, edge, state, params, rng)) return 0

  const spec = parseMxFlowFormula(edge.formula)
  const src = gIdx.byId.get(edge.from)
  const dst = gIdx.byId.get(edge.to)
  const srcModEligible = Boolean(src && src.kind !== 'pool' && src.kind !== 'register')
  const hasSrcStateIns = srcModEligible && gIdx.stateInByNode.has(src!.id)

  let vars: Record<string, number> | null = null
  const ensureVars = (): Record<string, number> => {
    if (!vars) vars = buildVars(doc, state.values, params, state.step)
    return vars
  }

  // 2) 检查并推进间隔（支持 `3|2`、`1|3..6`、`D6|D6`、`edge.interval` 与 `+xi`）
  if (
    (spec.intervalExpr || edge.interval || edgeStateIns.length > 0 || hasSrcStateIns) &&
    !checkAndAdvanceEdgeInterval(doc, edge, spec, state, params, rng, ensureVars, commitInterval)
  ) {
    return 0
  }

  if (spec.type === 'all') {
    return applyEdgeLimits(edge, available)
  }

  // 收集指向该连线本身的 Formula Modifiers / Overwrite
  let edgeOverwrite: number | null = null
  let edgeAddBonus = 0
  let edgePctBonus = 0
  for (const se of edgeStateIns) {
    if (!isEdgeActive(doc, se, state, params, rng)) continue
    const stSpec = getEffectiveStateSpec(doc, se, state, params, rng)
    const srcVal = getStateEdgeOriginValue(doc, se, state)
    if (stSpec.type === 'overwrite') {
      edgeOverwrite = srcVal
    } else if (stSpec.type === 'modifier') {
      if (stSpec.percent) edgePctBonus += (stSpec.delta * srcVal) / 100
      else edgeAddBonus += stSpec.delta * srcVal
    } else if (stSpec.type === 'fraction_modifier' && stSpec.denominator > 0) {
      edgeAddBonus += Math.trunc(srcVal / stSpec.denominator) * stSpec.numerator
    } else if (stSpec.type === 'expr') {
      edgeAddBonus += evalArithmeticStateExprBonus(
        doc,
        gIdx,
        stSpec.expr,
        srcVal,
        state,
        params,
        rng,
        ensureVars()
      )
    }
  }

  // 3) 百分比 / 概率型资源边（含 >100% 官方规则：如 250% = 保底 2 个 + 50% 概率额外第 3 个；概率未命中 0 时不受 minLimit 抬升）
  if (spec.probability != null && spec.expr === '1' && edgeOverwrite === null) {
    const srcMod = hasSrcStateIns
      ? modifierBonus(doc, src!.id, state, spec.probability * 100, params, rng)
      : NO_MOD_RESULT
    const basePct = srcMod.overwrite !== null ? srcMod.overwrite : spec.probability * 100
    const effPct = basePct * (1 + edgePctBonus) + edgeAddBonus + srcMod.bonus
    if (effPct <= 0) return 0
    const guaranteed = Math.floor((effPct + 1e-9) / 100)
    const remProb = (effPct - guaranteed * 100) / 100
    const rolled = guaranteed + (remProb > 1e-9 && rng() < remProb ? 1 : 0)
    return rolled <= 0 ? 0 : applyEdgeLimits(edge, rolled)
  }

  if (spec.probability != null && edgeOverwrite === null) {
    if (spec.probability <= 1) {
      if (rng() >= spec.probability) return 0
    }
  }

  let base = 1
  if (edgeOverwrite !== null) {
    base = edgeOverwrite
  } else if (exprNeedsVars(spec.expr)) {
    const v = ensureVars()
    if (src) v.self = state.values[src.id] ?? 0
    const nodeStateIns = src ? (gIdx.stateInByNode.get(src.id) ?? EMPTY_EDGES) : EMPTY_EDGES
    const combinedStateIns =
      edgeStateIns.length && nodeStateIns.length
        ? [...edgeStateIns, ...nodeStateIns]
        : edgeStateIns.length
          ? edgeStateIns
          : nodeStateIns
    combinedStateIns.forEach((se, idx) => {
      const originVal = getStateEdgeOriginValue(doc, se, state)
      if (idx < POSITIONAL_LETTERS.length) {
        v[POSITIONAL_LETTERS[idx]!] = originVal
      }
      if (se.label?.trim()) {
        const customVar = mxIdentifier(se.label.trim())
        if (customVar) v[customVar] = originVal
      }
    })
    if (!('a' in v)) {
      v.a = src && src.kind !== 'source' ? (state.values[src.id] ?? 0) : state.step
    }
    base = evaluateMxExpression(spec.expr, { vars: v, arrays: gIdx.paramArrays, rng }, 1)
  } else {
    base = evaluateMxExpression(spec.expr, { vars: params, arrays: gIdx.paramArrays, rng }, 1)
  }

  if (spec.probability != null && spec.probability > 1 && edgeOverwrite === null) {
    const mult = Math.floor(spec.probability + 1e-9) + (rng() < spec.probability % 1 ? 1 : 0)
    base *= mult
  }

  // 指向本连线源节点的修改量（Source / Converter / Gate / Delay 产出加成；排除 Pool/Register Node Modifier），或指向 Drain 终点节点的修改量
  const srcMod = hasSrcStateIns
    ? modifierBonus(doc, src!.id, state, base, params, rng)
    : NO_MOD_RESULT
  const dstMod =
    dst?.kind === 'drain' && gIdx.stateInByNode.has(dst.id)
      ? modifierBonus(doc, dst.id, state, base, params, rng)
      : NO_MOD_RESULT
  if (edgeOverwrite === null) {
    if (srcMod.overwrite !== null) base = srcMod.overwrite
    else if (dstMod.overwrite !== null) base = dstMod.overwrite
  }
  const edgeModifierBonus = base * edgePctBonus + edgeAddBonus
  const total = base + srcMod.bonus + dstMod.bonus + edgeModifierBonus
  return applyEdgeLimits(edge, Math.max(0, Math.round(total * 1000) / 1000))
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
  const step = prev.step + 1
  const rng = createMxRng((options.seed ?? doc.settings.seed ?? 1) * 7919 + step * 104729)
  const gIdx = getMxGraphIndex(doc)
  const baseParams = options.params ?? prev.runtimeParams ?? resolveMxParams(doc, undefined, rng)
  let params = baseParams
  for (const p of doc.params) {
    if (p.updateMode === 'each_step') {
      if (params === baseParams) params = { ...baseParams }
      const k = mxIdentifier(p.name)
      if (k) {
        params[k] = sampleCustomParamValue(
          p,
          rng,
          { ...params, step, STEP: step, t: step },
          gIdx.paramArrays
        )
      }
    }
  }

  let clonedPoolTokens: Record<string, MxPoolTokenStackItem[]> | undefined
  if (prev.poolTokens) {
    clonedPoolTokens = {}
    for (const k in prev.poolTokens) {
      const arr = prev.poolTokens[k]!
      const copy = new Array<MxPoolTokenStackItem>(arr.length)
      for (let i = 0; i < arr.length; i++) {
        copy[i] = { resId: arr[i]!.resId, count: arr[i]!.count }
      }
      clonedPoolTokens[k] = copy
    }
  }

  const cloneNonEmpty = <T extends Record<string, number>>(src?: T): Record<string, number> => {
    if (!src) return {}
    for (const _k in src) return { ...src }
    return {}
  }

  const state: MxRuntimeState = {
    step,
    values: { ...prev.values },
    active: prev.ended ? { ...prev.active } : prev.active,
    gateCursor: cloneNonEmpty(prev.gateCursor),
    buffers: gIdx.delaysAndQueues.length
      ? Object.fromEntries(
          Object.entries(prev.buffers).map(([k, v]) => [k, v.map((b) => ({ ...b }))])
        )
      : {},
    edgeFlows: {},
    fired: {},
    ended: prev.ended,
    endReason: prev.endReason,
    totalProduced: prev.totalProduced,
    totalConsumed: prev.totalConsumed,
    prevEdgeOrigin: cloneNonEmpty(prev.prevEdgeOrigin),
    edgeLastStep: cloneNonEmpty(prev.edgeLastStep),
    edgeWaitSteps: cloneNonEmpty(prev.edgeWaitSteps),
    gateTrigCount: cloneNonEmpty(prev.gateTrigCount),
    gateQuotaSent: cloneNonEmpty(prev.gateQuotaSent),
    gateLastRoll: cloneNonEmpty(prev.gateLastRoll),
    poolTokens: clonedPoolTokens,
    runtimeParams: params
  }
  const events: MxEvent[] = []
  if (prev.ended) return { state, events }

  const byId = gIdx.byId
  const outRes = (id: string): MxEdge[] => gIdx.outResByNode.get(id) ?? EMPTY_EDGES
  const inRes = (id: string): MxEdge[] => gIdx.inResByNode.get(id) ?? EMPTY_EDGES
  const orderedInteractions: string[] = [...(options.interactions ?? [])]
  const interactions = new Set(orderedInteractions)

  // Step 1 起始：按 Machinations Node Modifier 规范将源节点初始状态传导至目标节点，并在激活判定前刷新寄存器（使 STEP 等步变量即时生效）
  if (step === 1 && gIdx.nodeModTargets.length > 0) {
    applyNodeStateModifiers(doc, state, params, rng)
  }
  if (gIdx.registers.length > 0) {
    recomputeRegisters(doc, state, params, rng)
  }

  // 1) 激活状态
  const nowActive: Record<string, boolean> = {}
  for (const n of doc.nodes) {
    const act = gIdx.stateInByNode.has(n.id) ? isNodeActive(doc, n, state, params) : true
    nowActive[n.id] = act
    if (act !== prev.active[n.id]) {
      events.push({ step, type: act ? 'activate' : 'deactivate', nodeId: n.id })
    }
  }

  const receivedResources = new Set<string>()
  const receivedColorsByNode = new Map<string, Set<string>>()
  const recordNodeColor = (nodeId: string, color?: string): void => {
    if (!color || color === 'default') return
    let s = receivedColorsByNode.get(nodeId)
    if (!s) {
      s = new Set()
      receivedColorsByNode.set(nodeId, s)
    }
    s.add(color)
  }

  let currentWaveNext: MxNode[] = []
  const triggered = new Set<string>()
  const triggeredEdges = new Set<string>()
  const triggeredEndEdges = new Set<string>()

  const computeDelayOrQueueWait = (target: MxNode): number => {
    const outs = outRes(target.id)
    const out0 = outs[0]
    const out0Raw = out0?.formula?.trim() ?? ''
    const out0HasEdgeMod = out0 ? (gIdx.stateInByEdge.get(out0.id)?.length ?? 0) > 0 : false
    let baseWait: number
    if (out0 && ((out0Raw !== '' && out0Raw !== '1') || out0HasEdgeMod)) {
      baseWait = evalFlowAmount(doc, out0, state, params, rng, 1, false)
    } else if (target.formula?.trim()) {
      const vars = exprNeedsVars(target.formula)
        ? buildVars(doc, state.values, params, step)
        : params
      baseWait = evaluateMxExpression(
        target.formula,
        { vars, arrays: gIdx.paramArrays, rng },
        target.delaySteps ?? 1
      )
    } else {
      baseWait = target.delaySteps ?? 1
    }
    const mod = modifierBonus(doc, target.id, state, baseWait, params, rng)
    return Math.max(0, Math.round(mod.overwrite !== null ? mod.overwrite : baseWait + mod.bonus))
  }

  const addTo = (
    targetId: string,
    amount: number,
    edge: MxEdge,
    depth: number,
    tokenResId?: string
  ): number => {
    if (amount <= 0) return 0
    const target = byId.get(targetId)
    if (!target) return 0
    const normalizedTok = tokenResId && tokenResId !== 'default' ? tokenResId : undefined
    const effColor =
      normalizedTok || (!edge.resourceFilter ? edge.resourceId : undefined) || target.resourceId
    switch (target.kind) {
      case 'pool': {
        const prevVal = state.values[target.id] ?? 0
        const room = capOf(target) - prevVal
        const accepted = Math.max(0, Math.min(room, amount))
        const nextVal = Math.round((prevVal + accepted) * 1000) / 1000
        state.values[target.id] = nextVal
        const posGain = Math.max(0, nextVal) - Math.max(0, prevVal)
        if (posGain > 0) {
          pushPoolTokens(state, target, posGain, effColor)
        }
        if (accepted > 0) {
          receivedResources.add(target.id)
          recordNodeColor(target.id, effColor)
        }
        if (target.overflow === 'drain' && amount > accepted) {
          const spilled = Math.round((amount - accepted) * 1000) / 1000
          state.totalConsumed += spilled
          events.push({
            step,
            type: 'consume',
            nodeId: target.id,
            edgeId: edge.id,
            amount: spilled,
            resourceId: effColor,
            detail: 'overflow'
          })
          return amount
        }
        return accepted
      }
      case 'drain':
        state.totalConsumed += amount
        events.push({
          step,
          type: 'consume',
          nodeId: target.id,
          edgeId: edge.id,
          amount,
          resourceId: effColor
        })
        receivedResources.add(target.id)
        recordNodeColor(target.id, effColor)
        return amount
      case 'gate':
        if (!nowActive[target.id]) return 0
        receivedResources.add(target.id)
        recordNodeColor(target.id, effColor)
        distributeGate(target, amount, depth + 1, effColor)
        return amount
      case 'delay':
      case 'queue': {
        const wait = computeDelayOrQueueWait(target)
        state.buffers[target.id] ??= []
        state.buffers[target.id]!.push({
          release: step + wait,
          amount,
          resourceId: effColor
        })
        state.values[target.id] = (state.values[target.id] ?? 0) + amount
        receivedResources.add(target.id)
        recordNodeColor(target.id, effColor)
        return amount
      }
      case 'converter':
      case 'trader':
        state.values[target.id] = (state.values[target.id] ?? 0) + amount
        receivedResources.add(target.id)
        recordNodeColor(target.id, effColor)
        return amount
      case 'end':
      case 'register':
      case 'source':
      case 'note':
      default:
        return amount
    }
  }

  const instantWoken = new Set<string>()
  const scheduledRemaining = new Set<string>()
  const propagateInstantStateUpdate = (changedNodeId: string, originNodeId?: string): void => {
    if (gIdx.nodeModTargets.length > 0) {
      applyNodeStateModifiers(doc, state, params, rng)
    }
    if (gIdx.registers.length > 0) {
      recomputeRegisters(doc, state, params, rng)
    }
    for (const [nid] of gIdx.stateInByNode) {
      const n = byId.get(nid)
      if (!n) continue
      const wasActive = nowActive[n.id]
      const nextActive = isNodeActive(doc, n, state, params)
      if (nextActive !== wasActive) {
        nowActive[n.id] = nextActive
        events.push({ step, type: nextActive ? 'activate' : 'deactivate', nodeId: n.id })
        if (
          nextActive &&
          !instantWoken.has(n.id) &&
          !scheduledRemaining.has(n.id) &&
          (n.trigger === 'enabling' || (n.trigger === 'automatic' && !state.fired[n.id]))
        ) {
          instantWoken.add(n.id)
          currentWaveNext.push(n)
        }
      }
    }
    const wakeDownstreamOf = (nid: string): void => {
      const downRes = outRes(nid)
      for (const de of downRes) {
        const dn = byId.get(de.to)
        if (
          dn &&
          dn.trigger === 'automatic' &&
          nowActive[dn.id] &&
          !instantWoken.has(dn.id) &&
          !scheduledRemaining.has(dn.id) &&
          state.fired[dn.id] &&
          (state.edgeFlows[de.id] ?? 0) <= 0
        ) {
          instantWoken.add(dn.id)
          currentWaveNext.push(dn)
        }
      }
    }
    wakeDownstreamOf(changedNodeId)
    if (originNodeId && originNodeId !== changedNodeId) {
      wakeDownstreamOf(originNodeId)
    }
  }

  const sendAlong = (
    edge: MxEdge,
    amount: number,
    depth = 0,
    tokenResId?: string,
    deferInstant = false
  ): number => {
    if (amount <= 0 || depth > 8) return 0
    const normTok = tokenResId && tokenResId !== 'default' ? tokenResId : undefined
    if (edge.resourceFilter && edge.resourceId && edge.resourceId !== normTok) {
      return 0
    }
    const effColor = normTok || (!edge.resourceFilter ? edge.resourceId : undefined)
    const moved = addTo(edge.to, amount, edge, depth, effColor)
    if (moved > 0) {
      state.edgeFlows[edge.id] = (state.edgeFlows[edge.id] ?? 0) + moved
      events.push({
        step,
        type: 'transfer',
        nodeId: edge.from,
        targetId: edge.to,
        edgeId: edge.id,
        amount: moved,
        resourceId: effColor
      })
      if (edge.transferMode === 'instant' && !deferInstant) {
        propagateInstantStateUpdate(edge.to, edge.from)
      }
    }
    return moved
  }

  const fireSingleResourceEdge = (resEdge: MxEdge): boolean => {
    const srcNode = byId.get(resEdge.from)
    if (!srcNode || !nowActive[srcNode.id]) return false
    if (!isEdgeActive(doc, resEdge, state, params, rng)) return false
    if (srcNode.kind === 'source') {
      const amt = evalFlowAmount(doc, resEdge, state, params, rng, Number.POSITIVE_INFINITY)
      if (amt <= 0) return false
      const color =
        !resEdge.resourceFilter && resEdge.resourceId
          ? resEdge.resourceId
          : srcNode.resourceId || 'default'
      const moved = sendAlong(resEdge, amt, 0, color)
      if (moved > 0) {
        const evColor = color === 'default' ? undefined : color
        state.totalProduced += moved
        recordNodeColor(srcNode.id, evColor)
        events.push({
          step,
          type: 'produce',
          nodeId: srcNode.id,
          edgeId: resEdge.id,
          amount: moved,
          resourceId: evColor
        })
      }
      return moved > 0
    }
    const rawAvail =
      srcNode.kind === 'pool' && resEdge.resourceFilter && resEdge.resourceId
        ? countPoolTokensByColor(state, srcNode.id, resEdge.resourceId)
        : Math.max(0, state.values[srcNode.id] ?? 0)
    const amt = Math.min(rawAvail, evalFlowAmount(doc, resEdge, state, params, rng, rawAvail))
    if (amt <= 0) return false
    if (srcNode.kind === 'pool') {
      const targetNode = byId.get(resEdge.to)
      const maxAccept =
        targetNode?.kind === 'pool' && targetNode.overflow !== 'drain'
          ? Math.max(0, Math.min(amt, capOf(targetNode) - (state.values[targetNode.id] ?? 0)))
          : amt
      if (maxAccept <= 0) return false
      const popped = popPoolTokens(state, srcNode, maxAccept, {
        filterResId: resEdge.resourceFilter ? resEdge.resourceId : undefined,
        shuffle: resEdge.shuffleOrigin,
        rng
      })
      let moved = 0
      for (const seg of popped) {
        const segMoved = sendAlong(resEdge, seg.count, 0, seg.resId, true)
        if (segMoved > 0 && seg.resId && seg.resId !== 'default') {
          recordNodeColor(srcNode.id, seg.resId)
        }
        moved += segMoved
      }
      state.values[srcNode.id] = Math.round(((state.values[srcNode.id] ?? 0) - moved) * 1000) / 1000
      if (moved > 0 && resEdge.transferMode === 'instant') {
        propagateInstantStateUpdate(resEdge.to, srcNode.id)
      }
      return moved > 0
    }
    state.values[srcNode.id] = Math.round((rawAvail - amt) * 1000) / 1000
    const nonPoolColor =
      (!resEdge.resourceFilter ? resEdge.resourceId : undefined) || srcNode.resourceId || 'default'
    const moved = sendAlong(resEdge, amt, 0, nonPoolColor, true)
    if (moved < amt) {
      state.values[srcNode.id] =
        Math.round(((state.values[srcNode.id] ?? 0) + (amt - moved)) * 1000) / 1000
    }
    if (moved > 0) {
      if (nonPoolColor !== 'default') recordNodeColor(srcNode.id, nonPoolColor)
      if (resEdge.transferMode === 'instant') {
        propagateInstantStateUpdate(resEdge.to, srcNode.id)
      }
    }
    return moved > 0
  }

  const dispatchStateTriggerEdge = (e: MxEdge, sourceNodeId: string, nextWave: MxNode[]): void => {
    if (e.targetEdgeId) {
      if (triggeredEdges.has(e.targetEdgeId)) return
      const targetEdge = gIdx.resEdgeById.get(e.targetEdgeId)
      if (!targetEdge) return
      triggeredEdges.add(targetEdge.id)
      events.push({
        step,
        type: 'trigger',
        nodeId: sourceNodeId,
        targetId: targetEdge.to,
        edgeId: e.id
      })
      fireSingleResourceEdge(targetEdge)
      return
    }
    const target = byId.get(e.to)
    if (!target) return
    if (target.kind === 'end') {
      triggeredEndEdges.add(e.id)
      events.push({
        step,
        type: 'trigger',
        nodeId: sourceNodeId,
        targetId: target.id,
        edgeId: e.id
      })
      return
    }
    if (triggered.has(target.id)) return
    triggered.add(target.id)
    events.push({
      step,
      type: 'trigger',
      nodeId: sourceNodeId,
      targetId: target.id,
      edgeId: e.id
    })
    nextWave.push(target)
  }

  const getGateSkillBonus = (gate: MxNode): number => {
    const mod = modifierBonus(doc, gate.id, state, 0, params, rng)
    const baseSkill = params.skill ?? params.SKILL ?? 0
    return (mod.overwrite !== null ? mod.overwrite : mod.bonus) + baseSkill
  }

  const rollGateTestValue = (gate: MxNode, count: number): number => {
    if (gate.gateMode === 'deterministic') return count
    if (gate.gateMode === 'skill') {
      const skillBonus = getGateSkillBonus(gate)
      return Math.max(
        1,
        Math.min(6, Math.round(sampleBoxMullerGaussian(rng, 3.5 + skillBonus, 1.1)))
      )
    }
    const mod = modifierBonus(doc, gate.id, state, 0, params, rng)
    if (mod.overwrite !== null) {
      return mod.overwrite + mod.bonus
    }
    const rawRollFormula = gate.formula?.trim()
    if (rawRollFormula) {
      const vars = exprNeedsVars(rawRollFormula)
        ? buildVars(doc, state.values, params, step)
        : params
      const baseRoll = evaluateMxExpression(
        rawRollFormula,
        { vars, arrays: gIdx.paramArrays, rng },
        1
      )
      return baseRoll + mod.bonus
    }
    return 1 + Math.floor(rng() * 6) + mod.bonus
  }

  const rollGateUnitFraction = (gate: MxNode): number => {
    if (gate.gateMode === 'skill') {
      const skillBonus = getGateSkillBonus(gate)
      const mean = 0.5 - Math.tanh(skillBonus * 0.25) * 0.35
      return Math.max(0, Math.min(0.999999, sampleBoxMullerGaussian(rng, mean, 0.22)))
    }
    return rng()
  }

  /**
   * 触发器门（Trigger Gate / Mixed Gate）出向状态连线分发：
   * 支持 `*` 直通触发、条件门（`<4`, `>=4`, `1..2`，随机掷 D6 / Skill 正态检定 / 确定性按计数）、
   * 百分比门（`20%`, `80%`）以及数值权重门（`2`, `3`：随机无放回周期抽样 / Skill 偏置 / 确定性顺序轮询）。
   */
  function fireTriggerGateOutputs(gate: MxNode, nextWave: MxNode[]): boolean {
    const rawOuts = gIdx.stateOutByNode.get(gate.id) ?? EMPTY_EDGES
    if (!rawOuts.length) return false
    const activeOuts = rawOuts.filter((e) => isEdgeActive(doc, e, state, params, rng))
    if (!activeOuts.length) return false

    state.fired[gate.id] = true
    state.gateTrigCount ??= {}
    state.gateQuotaSent ??= {}
    state.gateLastRoll ??= {}
    const trigCount = (state.gateTrigCount[gate.id] ?? 0) + 1
    state.gateTrigCount[gate.id] = trigCount

    let anyFired = false
    const condOuts: Array<{ e: MxEdge; spec: MxStateSpec }> = []
    const pctOuts: Array<{ e: MxEdge; pct: number }> = []
    const weightOuts: Array<{ e: MxEdge; w: number }> = []

    for (const e of activeOuts) {
      const spec = getEffectiveStateSpec(doc, e, state, params, rng)
      if (spec.type === 'trigger') {
        dispatchStateTriggerEdge(e, gate.id, nextWave)
        anyFired = true
      } else if (spec.type === 'probability') {
        pctOuts.push({ e, pct: Math.max(0, spec.pct) })
      } else if (
        spec.type === 'activator' ||
        spec.type === 'range' ||
        (spec.type === 'expr' && isMxBooleanStateExpr(spec.expr))
      ) {
        condOuts.push({ e, spec })
      } else if (spec.type === 'expr' && /^\d+(?:\.\d+)?$/.test(spec.expr.trim())) {
        weightOuts.push({ e, w: Math.max(0, Number(spec.expr.trim())) })
      }
    }

    if (condOuts.length > 0) {
      const vars = buildVars(doc, state.values, params, step)
      const testVal = rollGateTestValue(gate, trigCount)
      state.gateLastRoll[gate.id] = testVal
      for (const c of condOuts) {
        if (checkActivator(c.spec, testVal, vars, rng, gIdx.paramArrays) === true) {
          dispatchStateTriggerEdge(c.e, gate.id, nextWave)
          anyFired = true
        }
      }
    }

    if (pctOuts.length > 0) {
      const gateMod = modifierBonus(doc, gate.id, state, pctOuts[0]!.pct, params, rng)
      pctOuts[0]!.pct = Math.max(
        0,
        gateMod.overwrite !== null ? gateMod.overwrite : pctOuts[0]!.pct + gateMod.bonus
      )
      const sumPct = pctOuts.reduce((a, b) => a + b.pct, 0)
      if (sumPct > 0) {
        if (gate.gateMode === 'deterministic') {
          const denom = Math.max(100, sumPct)
          const entries: Array<{ key: string; pct: number; edge: MxEdge | null }> = pctOuts.map(
            (p) => ({
              key: `pct:${gate.id}:${p.e.id}`,
              pct: p.pct,
              edge: p.e
            })
          )
          if (sumPct < 100) {
            entries.push({
              key: `pct:${gate.id}:__drop__`,
              pct: 100 - sumPct,
              edge: null
            })
          }
          let best = entries[0]!
          let bestDeficit = Number.NEGATIVE_INFINITY
          for (const ent of entries) {
            const sent = state.gateQuotaSent[ent.key] ?? 0
            const deficit = (trigCount * ent.pct) / denom - sent
            if (deficit > bestDeficit + 1e-9) {
              bestDeficit = deficit
              best = ent
            }
          }
          state.gateQuotaSent[best.key] = (state.gateQuotaSent[best.key] ?? 0) + 1
          if (best.edge) {
            dispatchStateTriggerEdge(best.edge, gate.id, nextWave)
            anyFired = true
          }
        } else {
          const roll = rollGateUnitFraction(gate) * Math.max(100, sumPct)
          let acc = 0
          for (const p of pctOuts) {
            acc += p.pct
            if (roll < acc) {
              dispatchStateTriggerEdge(p.e, gate.id, nextWave)
              anyFired = true
              break
            }
          }
        }
      }
    }

    if (weightOuts.length > 0) {
      const gateMod = modifierBonus(doc, gate.id, state, weightOuts[0]!.w, params, rng)
      weightOuts[0]!.w = Math.max(
        0,
        gateMod.overwrite !== null ? gateMod.overwrite : weightOuts[0]!.w + gateMod.bonus
      )
      const totalW = weightOuts.reduce((a, b) => a + b.w, 0)
      if (totalW > 0) {
        if (gate.gateMode === 'deterministic') {
          const totInt = Math.max(1, Math.round(totalW))
          const cursor = (state.gateCursor[gate.id] ?? 0) % totInt
          state.gateCursor[gate.id] = cursor + 1
          let acc = 0
          for (const wItem of weightOuts) {
            acc += wItem.w
            if (cursor < acc) {
              dispatchStateTriggerEdge(wItem.e, gate.id, nextWave)
              anyFired = true
              break
            }
          }
        } else if (gate.gateMode === 'skill') {
          const roll = rollGateUnitFraction(gate) * totalW
          let acc = 0
          for (const wItem of weightOuts) {
            acc += wItem.w
            if (roll < acc) {
              dispatchStateTriggerEdge(wItem.e, gate.id, nextWave)
              anyFired = true
              break
            }
          }
        } else {
          // 随机数值权重触发门：按 Machinations 规范在每个周期内无放回抽样（Cycle without replacement）
          let remSum = 0
          for (const wItem of weightOuts) {
            remSum += state.gateQuotaSent[`urn:${gate.id}:${wItem.e.id}`] ?? 0
          }
          if (remSum <= 1e-9) {
            for (const wItem of weightOuts) {
              state.gateQuotaSent[`urn:${gate.id}:${wItem.e.id}`] = wItem.w
              remSum += wItem.w
            }
          }
          const roll = rng() * remSum
          let acc = 0
          let chosen = weightOuts[weightOuts.length - 1]!
          for (const wItem of weightOuts) {
            const rem = state.gateQuotaSent[`urn:${gate.id}:${wItem.e.id}`] ?? 0
            if (rem <= 1e-9) continue
            acc += rem
            if (roll <= acc) {
              chosen = wItem
              break
            }
          }
          const cKey = `urn:${gate.id}:${chosen.e.id}`
          state.gateQuotaSent[cKey] = Math.max(0, (state.gateQuotaSent[cKey] ?? 1) - 1)
          dispatchStateTriggerEdge(chosen.e, gate.id, nextWave)
          anyFired = true
        }
      }
    }

    return anyFired
  }

  function distributeGate(gate: MxNode, amount: number, depth: number, tokenResId?: string): void {
    const outs = outRes(gate.id)
    state.fired[gate.id] = true
    state.gateTrigCount ??= {}
    state.gateQuotaSent ??= {}
    state.gateLastRoll ??= {}

    if (outs.length > 0) {
      let vars = buildVars(doc, state.values, params, step)
      const normTok = tokenResId && tokenResId !== 'default' ? tokenResId : undefined
      const intervalOpen = outs.map((e) =>
        checkAndAdvanceEdgeInterval(
          doc,
          e,
          parseMxFlowFormula(e.formula),
          state,
          params,
          rng,
          () => vars,
          true
        )
      )
      const isConditionalGate = outs.some((e) => {
        const s = e.formula.replace(/\s*(?:\||every\b).*$/i, '').trim()
        return /^(?:>=|<=|==|!=|<>|>|<|=|-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?$)/.test(s)
      })

      const units = Math.max(1, Math.round(amount))
      const perUnit = amount / units

      if (isConditionalGate) {
        for (let u = 0; u < units; u++) {
          const count = (state.gateTrigCount[gate.id] ?? 0) + 1
          state.gateTrigCount[gate.id] = count
          const testVal = rollGateTestValue(gate, count)
          state.gateLastRoll[gate.id] = testVal
          const matched: MxEdge[] = []
          for (let ei = 0; ei < outs.length; ei++) {
            const e = outs[ei]!
            if (!intervalOpen[ei]) continue
            if (!isEdgeActive(doc, e, state, params, rng)) continue
            if (e.resourceFilter && e.resourceId && e.resourceId !== normTok) {
              continue
            }
            const coreFormula = e.formula.replace(/\s*(?:\||every\b).*$/i, '').trim()
            const condEdge = coreFormula === e.formula ? e : { ...e, formula: coreFormula }
            const condSpec = getEffectiveStateSpec(doc, condEdge, state, params, rng, vars)
            if (checkActivator(condSpec, testVal, vars, rng, gIdx.paramArrays) === true) {
              matched.push(e)
            }
          }
          if (matched.length === 0) {
            // 条件门未命中任何分支：按 Machinations 规范销毁该单位资源
            state.totalConsumed += perUnit
          } else {
            if (matched.length > 1) {
              state.totalProduced += (matched.length - 1) * perUnit
            }
            for (const me of matched) {
              sendAlong(me, perUnit, depth, tokenResId)
            }
          }
        }
      } else {
        const computeGateWeights = (): number[] => {
          const ws = outs.map((e, ei) => {
            if (!intervalOpen[ei]) return 0
            if (!isEdgeActive(doc, e, state, params, rng)) return 0
            if (e.resourceFilter && e.resourceId && e.resourceId !== normTok) {
              return 0
            }
            const f = parseMxFlowFormula(e.formula)
            let w =
              f.type === 'expr' && f.probability != null
                ? f.probability * 100
                : f.type === 'all'
                  ? 1
                  : Math.max(
                      0,
                      evaluateMxExpression(f.expr, { vars, arrays: gIdx.paramArrays, rng }, 1)
                    )
            const edgeMods = gIdx.stateInByEdge.get(e.id) ?? EMPTY_EDGES
            for (const se of edgeMods) {
              if (!isEdgeActive(doc, se, state, params, rng)) continue
              const sp = getEffectiveStateSpec(doc, se, state, params, rng, vars)
              const sv = getStateEdgeOriginValue(doc, se, state)
              if (sp.type === 'overwrite') w = Math.max(0, sv)
              else if (sp.type === 'modifier') {
                w = Math.max(0, sp.percent ? w * (1 + (sp.delta * sv) / 100) : w + sp.delta * sv)
              } else if (sp.type === 'fraction_modifier' && sp.denominator > 0) {
                w = Math.max(0, w + Math.trunc(sv / sp.denominator) * sp.numerator)
              } else if (sp.type === 'expr') {
                w = Math.max(
                  0,
                  w + evalArithmeticStateExprBonus(doc, gIdx, sp.expr, sv, state, params, rng, vars)
                )
              }
            }
            return w
          })
          // 状态修改量加在第一条输出（保底类设计）
          if (ws.length > 0) {
            const gateMod = modifierBonus(doc, gate.id, state, ws[0] ?? 0, params, rng)
            ws[0] = Math.max(
              0,
              gateMod.overwrite !== null ? gateMod.overwrite : (ws[0] ?? 0) + gateMod.bonus
            )
          }
          return ws
        }
        const recomputeWeightsPerUnit =
          units > 1 &&
          ((gIdx.stateInByNode.get(gate.id)?.length ?? 0) > 0 ||
            outs.some((e) => (gIdx.stateInByEdge.get(e.id)?.length ?? 0) > 0))
        let weights = computeGateWeights()
        const usesPercent = outs.some((e) => {
          const f = parseMxFlowFormula(e.formula)
          return f.type === 'expr' && f.probability != null
        })
        for (let u = 0; u < units; u++) {
          if (u > 0 && recomputeWeightsPerUnit) {
            vars = buildVars(doc, state.values, params, step)
            weights = computeGateWeights()
          }
          let idx = -1
          if (gate.gateMode === 'deterministic') {
            if (usesPercent) {
              const count = (state.gateTrigCount[gate.id] ?? 0) + 1
              state.gateTrigCount[gate.id] = count
              const sumW = weights.reduce((a, b) => a + b, 0)
              const denom = Math.max(100, sumW)
              let bestIdx = -1
              let bestDeficit = Number.NEGATIVE_INFINITY
              for (let i = 0; i < weights.length; i++) {
                if (weights[i]! <= 0) continue
                const qKey = `spct:${gate.id}:${outs[i]!.id}`
                const sent = state.gateQuotaSent[qKey] ?? 0
                const deficit = (count * weights[i]!) / denom - sent
                if (deficit > bestDeficit + 1e-9) {
                  bestDeficit = deficit
                  bestIdx = i
                }
              }
              if (sumW < 100) {
                const dropKey = `spct:${gate.id}:__drop__`
                const dropSent = state.gateQuotaSent[dropKey] ?? 0
                const dropDef = (count * (100 - sumW)) / denom - dropSent
                if (dropDef > bestDeficit + 1e-9) {
                  state.gateQuotaSent[dropKey] = dropSent + 1
                  state.totalConsumed += perUnit
                  continue
                }
              }
              if (bestIdx >= 0) {
                const qKey = `spct:${gate.id}:${outs[bestIdx]!.id}`
                state.gateQuotaSent[qKey] = (state.gateQuotaSent[qKey] ?? 0) + 1
                idx = bestIdx
              }
            } else {
              const sumW = weights.reduce((a, b) => a + b, 0)
              if (sumW <= 0) {
                state.totalConsumed += perUnit
                continue
              }
              const cursor = (state.gateCursor[gate.id] ?? 0) % Math.max(1, Math.round(sumW))
              state.gateCursor[gate.id] = cursor + 1
              let acc = 0
              for (let i = 0; i < weights.length; i++) {
                acc += weights[i]!
                if (cursor < acc) {
                  idx = i
                  break
                }
              }
            }
          } else {
            const sumW = weights.reduce((a, b) => a + b, 0)
            const total = usesPercent ? Math.max(100, sumW) : sumW
            if (total <= 0) {
              state.totalConsumed += perUnit
              continue
            }
            const roll = rollGateUnitFraction(gate) * total
            let acc = 0
            for (let i = 0; i < weights.length; i++) {
              acc += weights[i]!
              if (roll < acc) {
                idx = i
                break
              }
            }
            if (idx < 0 && usesPercent && sumW < 100) {
              state.totalConsumed += perUnit
              continue
            }
          }
          if (idx < 0) continue
          const edge = outs[idx]!
          sendAlong(edge, perUnit, depth, tokenResId)
          // 第一条分支命中且有状态修改量时，把源 Pool 归零（保底重置语义）
          if (
            idx === 0 &&
            stateInputs(doc, gate.id).some(
              (s) => parseMxStateFormula(s.formula).type === 'modifier'
            )
          ) {
            for (const s of stateInputs(doc, gate.id)) {
              const srcNode = byId.get(s.from)
              if (srcNode?.kind === 'pool' && parseMxStateFormula(s.formula).type === 'modifier') {
                state.values[srcNode.id] = 0
                if (state.poolTokens?.[srcNode.id]) state.poolTokens[srcNode.id] = []
              }
            }
          }
        }
      }
    }

    // Mixed Gate：在接收并分流资源的同时，同步触发出向状态连线
    if ((gIdx.stateOutByNode.get(gate.id)?.length ?? 0) > 0) {
      fireTriggerGateOutputs(gate, currentWaveNext)
    }
  }

  /** 按拉取模式从输入 Pool / 被动 Source 拉资源。返回是否成功、拉取总量、短缺标记与各输入抽取的颜色信息 */
  const pullInputs = (
    node: MxNode,
    mode: 'any' | 'all',
    times = 1
  ): {
    ok: boolean
    pulled: number
    shortfall: boolean
    pulledByInput: Array<{ edge: MxEdge; amount: number; colors: MxPoolTokenStackItem[] }>
  } => {
    const ins = inRes(node.id).filter((e) => {
      if (!node.ignoreDisabledInputs) return true
      return nowActive[e.from] !== false
    })
    if (!ins.length) {
      return {
        ok: node.kind === 'pool' || node.kind === 'drain',
        pulled: 0,
        shortfall: false,
        pulledByInput: []
      }
    }
    const req = ins.map((e) => {
      const src = byId.get(e.from)
      const isPassiveSource =
        src?.kind === 'source' && src.trigger !== 'automatic' && !state.fired[src.id]
      const passiveSrcColor =
        !e.resourceFilter && e.resourceId ? e.resourceId : src?.resourceId || 'default'
      const passiveFilterBlocked = Boolean(
        isPassiveSource && e.resourceFilter && e.resourceId && passiveSrcColor !== e.resourceId
      )
      const avail = isPassiveSource
        ? nowActive[src.id] && !passiveFilterBlocked
          ? Number.POSITIVE_INFINITY
          : 0
        : src?.kind === 'pool'
          ? e.resourceFilter && e.resourceId
            ? countPoolTokensByColor(state, src.id, e.resourceId)
            : Math.max(0, state.values[e.from] ?? 0)
          : src?.kind === 'converter' || src?.kind === 'trader'
            ? Math.max(0, state.values[e.from] ?? 0)
            : 0
      return {
        e,
        src,
        isPassiveSource,
        avail,
        amount: evalFlowAmount(doc, e, state, params, rng, avail, false) * times
      }
    })
    // 自动 Source 作为输入：由 Source 自己推送；但在 pull_all 下若该自动 Source 未推送足够数量，则视为不满足
    const pushedSourceReqs = req.filter(
      (r) => r.src && r.src.kind === 'source' && !r.isPassiveSource
    )
    const pushedShortfall = pushedSourceReqs.some(
      (r) => r.amount > 0 && (state.edgeFlows[r.e.id] ?? 0) + 1e-9 < r.amount
    )
    const pullableReqs = req.filter((r) => r.src && (r.src.kind !== 'source' || r.isPassiveSource))
    const pullShortfall = pullableReqs.some((r) => r.amount > 0 && r.avail + 1e-9 < r.amount)
    const shortfall = pushedShortfall || pullShortfall

    if (mode === 'all' && shortfall) {
      return { ok: false, pulled: 0, shortfall: true, pulledByInput: [] }
    }

    // 提交实际生效的资源边动态间隔
    let sharedIvVars: Record<string, number> | null = null
    const ensureIvVars = (): Record<string, number> => {
      if (!sharedIvVars) sharedIvVars = buildVars(doc, state.values, params, step)
      return sharedIvVars
    }
    for (const r of pullableReqs) {
      if (r.amount > 0) {
        const spec = parseMxFlowFormula(r.e.formula)
        if (
          spec.intervalExpr ||
          r.e.interval ||
          gIdx.stateInByEdge.has(r.e.id) ||
          gIdx.stateInByNode.has(r.e.from)
        ) {
          checkAndAdvanceEdgeInterval(doc, r.e, spec, state, params, rng, ensureIvVars, true)
        }
      }
    }

    let pulled = 0
    const pulledByInput: Array<{ edge: MxEdge; amount: number; colors: MxPoolTokenStackItem[] }> =
      []
    for (const r of pullableReqs) {
      let take = Math.min(r.avail, r.amount)
      if (take <= 0) continue
      if (node.kind === 'pool' && node.overflow !== 'drain') {
        const room = capOf(node) - (state.values[node.id] ?? 0)
        take = Math.max(0, Math.min(room, take))
        if (take <= 0) continue
      }

      let pulledColors: MxPoolTokenStackItem[] = []
      if (r.isPassiveSource) {
        const srcColor =
          !r.e.resourceFilter && r.e.resourceId ? r.e.resourceId : r.src?.resourceId || 'default'
        const evColor = srcColor === 'default' ? undefined : srcColor
        pulledColors = [{ resId: srcColor, count: take }]
        state.totalProduced += take
        recordNodeColor(r.e.from, evColor)
        events.push({
          step,
          type: 'produce',
          nodeId: r.e.from,
          edgeId: r.e.id,
          amount: take,
          resourceId: evColor
        })
      } else if (r.src?.kind === 'pool') {
        pulledColors = popPoolTokens(state, r.src, take, {
          filterResId: r.e.resourceFilter ? r.e.resourceId : undefined,
          shuffle: r.e.shuffleOrigin,
          rng
        })
        const actualPopped = pulledColors.reduce((a, b) => a + b.count, 0)
        take = Math.min(take, actualPopped)
        if (take <= 0) continue
        for (const seg of pulledColors) {
          if (seg.resId && seg.resId !== 'default') recordNodeColor(r.e.from, seg.resId)
        }
        state.values[r.e.from] = Math.round(((state.values[r.e.from] ?? 0) - take) * 1000) / 1000
      } else {
        const nonPoolColor =
          (!r.e.resourceFilter ? r.e.resourceId : undefined) || r.src?.resourceId || 'default'
        if (r.e.resourceFilter && r.e.resourceId && nonPoolColor !== r.e.resourceId) continue
        pulledColors = [{ resId: nonPoolColor, count: take }]
        if (nonPoolColor !== 'default') recordNodeColor(r.e.from, nonPoolColor)
        state.values[r.e.from] = Math.round(((state.values[r.e.from] ?? 0) - take) * 1000) / 1000
      }

      pulledByInput.push({ edge: r.e, amount: take, colors: pulledColors })
      state.edgeFlows[r.e.id] = (state.edgeFlows[r.e.id] ?? 0) + take
      pulled += take

      if (node.kind === 'pool') {
        const prevVal = state.values[node.id] ?? 0
        const room = capOf(node) - prevVal
        const accepted = Math.max(0, Math.min(room, take))
        const nextVal = Math.round((prevVal + accepted) * 1000) / 1000
        state.values[node.id] = nextVal
        let remAccept = Math.max(0, nextVal) - Math.max(0, prevVal)
        for (const seg of pulledColors) {
          if (remAccept <= 1e-9) break
          const g = Math.min(remAccept, seg.count)
          const segColor =
            (seg.resId && seg.resId !== 'default' ? seg.resId : undefined) ||
            (!r.e.resourceFilter ? r.e.resourceId : undefined) ||
            node.resourceId
          pushPoolTokens(state, node, g, segColor)
          recordNodeColor(node.id, segColor)
          remAccept -= g
        }
        if (node.overflow === 'drain' && take > accepted) {
          state.totalConsumed += Math.round((take - accepted) * 1000) / 1000
        }
      } else if (node.kind === 'drain') {
        state.totalConsumed += take
        for (const seg of pulledColors) {
          if (seg.resId && seg.resId !== 'default') recordNodeColor(node.id, seg.resId)
        }
      }

      events.push({
        step,
        type: node.kind === 'drain' ? 'consume' : 'transfer',
        nodeId: r.e.from,
        targetId: node.id,
        edgeId: r.e.id,
        amount: take,
        resourceId: pulledColors[0]?.resId === 'default' ? undefined : pulledColors[0]?.resId
      })
      if (r.e.transferMode === 'instant') {
        propagateInstantStateUpdate(node.id, r.e.from)
      }
    }
    const anyPushed = pushedSourceReqs.some((r) => (state.edgeFlows[r.e.id] ?? 0) > 0)
    const ok =
      (pullableReqs.length === 0 && anyPushed) ||
      pulled > 0 ||
      (mode === 'all' && !shortfall && (pulled > 0 || anyPushed))
    return { ok, pulled, shortfall, pulledByInput }
  }

  const fireNode = (node: MxNode): { okStar: boolean; okBang: boolean } => {
    if (!nowActive[node.id] && node.kind !== 'end') return { okStar: false, okBang: false }
    state.fired[node.id] = true
    switch (node.kind) {
      case 'source': {
        const outs = outRes(node.id)
        if (node.pullMode === 'push_all') {
          const reqs = outs.map((e) => ({
            e,
            amt: evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY, false)
          }))
          const neededByPool = new Map<string, number>()
          let blocked = false
          for (const r of reqs) {
            if (r.amt <= 0) continue
            const prodColor =
              !r.e.resourceFilter && r.e.resourceId ? r.e.resourceId : node.resourceId || 'default'
            const normProd = prodColor === 'default' ? undefined : prodColor
            if (r.e.resourceFilter && r.e.resourceId && r.e.resourceId !== normProd) {
              blocked = true
              break
            }
            const dst = byId.get(r.e.to)
            if (!dst) continue
            if (dst.kind === 'gate' && !nowActive[dst.id]) {
              blocked = true
              break
            }
            if (dst.kind === 'pool' && dst.overflow !== 'drain') {
              const nextNeed = (neededByPool.get(dst.id) ?? 0) + r.amt
              neededByPool.set(dst.id, nextNeed)
              if (capOf(dst) - (state.values[dst.id] ?? 0) + 1e-9 < nextNeed) {
                blocked = true
                break
              }
            }
          }
          if (blocked) {
            events.push({ step, type: 'blocked', nodeId: node.id })
            return { okStar: false, okBang: true }
          }
          let sharedIvVars: Record<string, number> | null = null
          const ensureIvVars = (): Record<string, number> => {
            if (!sharedIvVars) sharedIvVars = buildVars(doc, state.values, params, step)
            return sharedIvVars
          }
          let any = false
          for (const r of reqs) {
            if (r.amt <= 0) continue
            checkAndAdvanceEdgeInterval(
              doc,
              r.e,
              parseMxFlowFormula(r.e.formula),
              state,
              params,
              rng,
              ensureIvVars,
              true
            )
            const color =
              !r.e.resourceFilter && r.e.resourceId ? r.e.resourceId : node.resourceId || 'default'
            const moved = sendAlong(r.e, r.amt, 0, color)
            if (moved > 0) {
              const evColor = color === 'default' ? undefined : color
              state.totalProduced += moved
              recordNodeColor(node.id, evColor)
              events.push({
                step,
                type: 'produce',
                nodeId: node.id,
                edgeId: r.e.id,
                amount: moved,
                resourceId: evColor
              })
              any = true
            }
          }
          return { okStar: any, okBang: !any && reqs.some((r) => r.amt > 0) }
        }

        let any = false
        for (const e of outs) {
          const amt = evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY)
          if (amt <= 0) continue
          const color =
            !e.resourceFilter && e.resourceId ? e.resourceId : node.resourceId || 'default'
          const moved = sendAlong(e, amt, 0, color)
          if (moved > 0) {
            const evColor = color === 'default' ? undefined : color
            state.totalProduced += moved
            recordNodeColor(node.id, evColor)
            events.push({
              step,
              type: 'produce',
              nodeId: node.id,
              edgeId: e.id,
              amount: moved,
              resourceId: evColor
            })
            any = true
          }
        }
        return { okStar: any, okBang: !any && outs.length > 0 }
      }
      case 'pool': {
        const hasIn = inRes(node.id).length > 0
        const hasOut = outRes(node.id).length > 0
        const mode =
          !hasIn && hasOut && (!node.pullMode || node.pullMode === 'pull_any')
            ? 'push_any'
            : (node.pullMode ?? 'pull_any')
        if (mode === 'push_any' || mode === 'push_all') {
          const outs = outRes(node.id)
          const posAvail = Math.max(0, state.values[node.id] ?? 0)
          const req = outs.map((e) => {
            const edgeAvail =
              e.resourceFilter && e.resourceId
                ? countPoolTokensByColor(state, node.id, e.resourceId)
                : posAvail
            return {
              e,
              edgeAvail,
              amount: evalFlowAmount(doc, e, state, params, rng, edgeAvail, false)
            }
          })
          const total = req.reduce((a, r) => a + r.amount, 0)
          const neededByDstPool = new Map<string, number>()
          let dstBlocked = false
          if (mode === 'push_all') {
            for (const r of req) {
              if (r.amount <= 0) continue
              const dst = byId.get(r.e.to)
              if (!dst) continue
              if (dst.kind === 'gate' && !nowActive[dst.id]) {
                dstBlocked = true
                break
              }
              if (dst.kind === 'pool' && dst.overflow !== 'drain') {
                const nextNeed = (neededByDstPool.get(dst.id) ?? 0) + r.amount
                neededByDstPool.set(dst.id, nextNeed)
                if (capOf(dst) - (state.values[dst.id] ?? 0) + 1e-9 < nextNeed) {
                  dstBlocked = true
                  break
                }
              }
            }
          }
          const shortfall =
            total > posAvail + 1e-9 || req.some((r) => r.amount > r.edgeAvail + 1e-9)
          if (mode === 'push_all' && (shortfall || dstBlocked)) {
            if (dstBlocked) events.push({ step, type: 'blocked', nodeId: node.id })
            return { okStar: false, okBang: true }
          }
          let sharedIvVars: Record<string, number> | null = null
          const ensureIvVars = (): Record<string, number> => {
            if (!sharedIvVars) sharedIvVars = buildVars(doc, state.values, params, step)
            return sharedIvVars
          }
          let moved = 0
          for (const r of req) {
            const curAvail =
              r.e.resourceFilter && r.e.resourceId
                ? countPoolTokensByColor(state, node.id, r.e.resourceId)
                : Math.max(0, state.values[node.id] ?? 0)
            let take = Math.min(curAvail, r.amount)
            if (take <= 0) continue
            checkAndAdvanceEdgeInterval(
              doc,
              r.e,
              parseMxFlowFormula(r.e.formula),
              state,
              params,
              rng,
              ensureIvVars,
              true
            )
            const dst = byId.get(r.e.to)
            if (dst?.kind === 'pool' && dst.overflow !== 'drain') {
              take = Math.max(0, Math.min(take, capOf(dst) - (state.values[dst.id] ?? 0)))
              if (take <= 0) continue
            }
            const popped = popPoolTokens(state, node, take, {
              filterResId: r.e.resourceFilter ? r.e.resourceId : undefined,
              shuffle: r.e.shuffleOrigin,
              rng
            })
            let edgeMoved = 0
            for (const seg of popped) {
              const segMoved = sendAlong(r.e, seg.count, 0, seg.resId, true)
              if (segMoved > 0 && seg.resId && seg.resId !== 'default') {
                recordNodeColor(node.id, seg.resId)
              }
              edgeMoved += segMoved
            }
            state.values[node.id] =
              Math.round(((state.values[node.id] ?? 0) - edgeMoved) * 1000) / 1000
            if (edgeMoved > 0 && r.e.transferMode === 'instant') {
              propagateInstantStateUpdate(r.e.to, node.id)
            }
            moved += edgeMoved
          }
          return { okStar: moved > 0, okBang: shortfall || (moved <= 0 && total > 0) }
        }
        const res = pullInputs(node, mode === 'pull_all' ? 'all' : 'any')
        return { okStar: res.pulled > 0, okBang: res.shortfall }
      }
      case 'drain': {
        const mode = node.pullMode === 'pull_all' ? 'all' : 'any'
        const res = pullInputs(node, mode)
        return { okStar: res.pulled > 0, okBang: res.shortfall || !res.ok }
      }
      case 'converter':
      case 'trader': {
        const multiple = node.conversion === 'multiple'
        let times = 0
        const maxTimes = multiple ? 50 : 1
        for (let k = 0; k < maxTimes; k++) {
          const outs = outRes(node.id)
          const hasCappedBlockOut = outs.some((oe) => {
            const dst = byId.get(oe.to)
            if (!dst) return false
            if (dst.kind === 'gate' && !nowActive[dst.id]) return true
            return (
              dst.kind === 'pool' &&
              dst.overflow !== 'drain' &&
              capOf(dst) < Number.POSITIVE_INFINITY
            )
          })
          if (hasCappedBlockOut) {
            const neededByDst = new Map<string, number>()
            let outBlocked = false
            for (const oe of outs) {
              const dst = byId.get(oe.to)
              if (!dst) continue
              if (dst.kind === 'gate' && !nowActive[dst.id]) {
                outBlocked = true
                break
              }
              if (
                dst.kind === 'pool' &&
                dst.overflow !== 'drain' &&
                capOf(dst) < Number.POSITIVE_INFINITY
              ) {
                const rawOut = (oe.formula ?? '').trim()
                const isStochastic = /(?:\d*[dD]\d+|\.\.|%|random|pickrandom|norm|gaussian)/i.test(
                  rawOut
                )
                const estOut = isStochastic
                  ? Math.max(1e-9, oe.minLimit ?? 1)
                  : evalFlowAmount(doc, oe, state, params, rng, Number.POSITIVE_INFINITY, false)
                if (estOut > 0) {
                  const nextNeed = (neededByDst.get(dst.id) ?? 0) + estOut
                  neededByDst.set(dst.id, nextNeed)
                  if (capOf(dst) - (state.values[dst.id] ?? 0) + 1e-9 < nextNeed) {
                    outBlocked = true
                    break
                  }
                }
              }
            }
            if (outBlocked) break
          }

          const ins = inRes(node.id)
          const buffered = state.values[node.id] ?? 0
          let pulledByInput: Array<{
            edge: MxEdge
            amount: number
            colors: MxPoolTokenStackItem[]
          }> = []
          const effPullMode =
            node.pullMode === 'pull_any' || node.pullMode === 'push_any' ? 'any' : 'all'
          if (buffered > 1e-9 && ins.length > 0) {
            const req = ins.map((e) =>
              byId.get(e.from)?.kind === 'gate'
                ? 1
                : evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY, false)
            )
            const needTotal = req.reduce((a, b) => a + b, 0)
            if (needTotal > 0 && buffered + 1e-9 >= needTotal) {
              state.values[node.id] = buffered - needTotal
            } else {
              const res = pullInputs(node, effPullMode)
              if (
                !res.ok ||
                (res.pulled <= 0 && ins.some((e) => byId.get(e.from)?.kind !== 'source'))
              ) {
                break
              }
              pulledByInput = res.pulledByInput
              state.values[node.id] = 0
            }
          } else {
            const res = pullInputs(node, effPullMode)
            if (
              !res.ok ||
              (res.pulled <= 0 && ins.some((e) => byId.get(e.from)?.kind !== 'source'))
            ) {
              break
            }
            pulledByInput = res.pulledByInput
            state.values[node.id] = 0
          }
          times++
          const allTraderOutsDefault =
            node.kind === 'trader' &&
            pulledByInput.length >= 2 &&
            outs.every((oe) => !oe.formula?.trim() || oe.formula.trim() === '1') &&
            pulledByInput.some((p) => Math.abs(p.amount - 1) > 1e-6)
          for (let outIdx = 0; outIdx < outs.length; outIdx++) {
            const e = outs[outIdx]!
            const swappedInput =
              node.kind === 'trader' && pulledByInput.length >= 2
                ? pulledByInput[pulledByInput.length - 1 - (outIdx % pulledByInput.length)]
                : pulledByInput[0]
            const amt =
              allTraderOutsDefault && swappedInput
                ? swappedInput.amount
                : evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY)
            if (amt <= 0) continue
            let outColor = (!e.resourceFilter ? e.resourceId : undefined) ?? node.resourceId
            if (!outColor) {
              if (pulledByInput.length > 0) {
                if (node.kind === 'trader') {
                  const amtMatch = !allTraderOutsDefault
                    ? pulledByInput.find((p) => Math.abs(p.amount - amt) < 1e-6)
                    : undefined
                  const cand = (amtMatch ?? swappedInput)?.colors[0]?.resId
                  if (cand && cand !== 'default') outColor = cand
                } else if (pulledByInput.length === 1) {
                  const cand = pulledByInput[0]?.colors[0]?.resId
                  if (cand && cand !== 'default') outColor = cand
                }
              } else if (ins.length === 1) {
                const seen = receivedColorsByNode.get(node.id)
                if (seen && seen.size === 1) {
                  const cand = Array.from(seen)[0]
                  if (cand && cand !== 'default') outColor = cand
                }
              }
            }
            const sent = sendAlong(e, amt, 0, outColor || 'default')
            if (sent > 0) {
              recordNodeColor(node.id, outColor)
              events.push({
                step,
                type: node.kind === 'trader' ? 'trade' : 'convert',
                nodeId: node.id,
                edgeId: e.id,
                amount: sent,
                resourceId: outColor
              })
            }
          }
        }
        if (times === 0) {
          events.push({ step, type: 'blocked', nodeId: node.id })
          return { okStar: false, okBang: true }
        }
        return { okStar: true, okBang: false }
      }
      case 'gate': {
        // Trigger Gate（无出向资源边，仅有出向状态边）
        if (outRes(node.id).length === 0 && (gIdx.stateOutByNode.get(node.id)?.length ?? 0) > 0) {
          if (inRes(node.id).length > 0) {
            const res = pullInputs(node, node.pullMode === 'pull_all' ? 'all' : 'any')
            if (res.pulled <= 0) return { okStar: false, okBang: true }
          }
          const ok = fireTriggerGateOutputs(node, currentWaveNext)
          return { okStar: ok, okBang: !ok }
        }
        // 自动 / 交互分流 Gate：从输入拉取资源并分流
        const res = pullInputs(node, node.pullMode === 'pull_all' ? 'all' : 'any')
        if (res.pulled > 0) {
          for (const inp of res.pulledByInput) {
            for (const seg of inp.colors) {
              if (seg.count > 0) distributeGate(node, seg.count, 0, seg.resId)
            }
          }
        }
        return { okStar: res.pulled > 0, okBang: res.shortfall || res.pulled <= 0 }
      }
      case 'delay':
      case 'queue': {
        const res = pullInputs(node, node.pullMode === 'pull_all' ? 'all' : 'any')
        if (res.pulled > 0) {
          const wait = computeDelayOrQueueWait(node)
          state.buffers[node.id] ??= []
          for (const inp of res.pulledByInput) {
            for (const seg of inp.colors) {
              if (seg.count <= 0) continue
              state.buffers[node.id]!.push({
                release: step + wait,
                amount: seg.count,
                resourceId: seg.resId
              })
            }
          }
          state.values[node.id] = (state.values[node.id] ?? 0) + res.pulled
        }
        return { okStar: res.pulled > 0, okBang: res.shortfall }
      }
      case 'register':
        if (node.trigger === 'interactive' && !node.formula?.trim()) {
          const delta = node.step ?? 1
          let nextV = (state.values[node.id] ?? 0) + delta
          if (node.min != null) nextV = Math.max(node.min, nextV)
          if (node.max != null) nextV = Math.min(node.max, nextV)
          state.values[node.id] = nextV
          events.push({ step, type: 'register', nodeId: node.id, amount: state.values[node.id] })
        }
        return { okStar: true, okBang: false }
      default:
        return { okStar: false, okBang: false }
    }
  }

  const propagateStateTriggersFrom = (
    sourceNodeId: string,
    okStar: boolean,
    okBang: boolean,
    next: MxNode[]
  ): void => {
    const srcNode = byId.get(sourceNodeId)
    // Gate 的状态输出已由 fireTriggerGateOutputs / distributeGate 统一按概率/权重/条件处理（仅传播 `!` 反向触发器）
    const outStates = gIdx.stateOutByNode.get(sourceNodeId) ?? EMPTY_EDGES
    for (const e of outStates) {
      if (!isEdgeActive(doc, e, state, params, rng)) continue
      if (e.resourceFilter && e.resourceId) {
        const seenColors = receivedColorsByNode.get(sourceNodeId)
        if (!seenColors || !seenColors.has(e.resourceId)) continue
      }
      const spec = getEffectiveStateSpec(doc, e, state, params, rng)
      if (srcNode?.kind === 'gate' && spec.type !== 'reverse_trigger') continue
      const fireIt =
        (spec.type === 'trigger' && okStar) || (spec.type === 'reverse_trigger' && okBang)
      if (!fireIt) continue
      dispatchStateTriggerEdge(e, sourceNodeId, next)
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
        if (d.resourceId && d.resourceId !== 'default') recordNodeColor(n.id, d.resourceId)
        events.push({
          step,
          type: 'release',
          nodeId: n.id,
          amount: d.amount,
          resourceId: d.resourceId
        })
        for (const e of outs) sendAlong(e, d.amount, 0, d.resourceId)
        propagateStateTriggersFrom(n.id, true, false, currentWaveNext)
      }
    } else {
      const head = buf[0]
      if (head && head.release <= step) {
        const unit = Math.min(1, head.amount)
        const relColor = head.resourceId
        head.amount -= unit
        if (head.amount <= 1e-9) buf.shift()
        state.values[n.id] = Math.max(0, (state.values[n.id] ?? 0) - unit)
        // 队列中的下一个从现在开始等待
        if (buf[0]) {
          buf[0].release = Math.max(buf[0].release, step + Math.max(1, computeDelayOrQueueWait(n)))
        }
        if (relColor && relColor !== 'default') recordNodeColor(n.id, relColor)
        events.push({ step, type: 'release', nodeId: n.id, amount: unit, resourceId: relColor })
        for (const e of outs) sendAlong(e, unit, 0, relColor)
        propagateStateTriggersFrom(n.id, true, false, currentWaveNext)
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
  const immediateFiring: MxNode[] = [...currentWaveNext]
  currentWaveNext = []
  for (const id of orderedInteractions) {
    const clickedNode = byId.get(id)
    if (clickedNode) immediateFiring.push(clickedNode)
  }
  const order: MxNodeKind[] = [
    'source',
    'pool',
    'gate',
    'delay',
    'queue',
    'converter',
    'trader',
    'drain',
    'register'
  ]
  const globalBot = doc.settings.botMode ?? 'off'
  let botVars: Record<string, number> | null = null

  for (const kind of order) {
    const kNodes = gIdx.nodesByKind.get(kind) ?? []
    for (const n of kNodes) {
      const auto = n.trigger === 'automatic'
      const clicked = interactions.has(n.id)
      // Enabling (On Start) 触发模式：在 Step 1 若已处于激活态立即触发一次，之后每次从失活重新变为激活时再次触发一次
      const enabling =
        n.trigger === 'enabling' && nowActive[n.id] && (step === 1 || !prev.active[n.id])
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
          if (
            evaluateMxExpression(condExpr, { vars: botVars, arrays: gIdx.paramArrays, rng }, 0) !==
            0
          ) {
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

  for (const fn of firing) scheduledRemaining.add(fn.id)
  const processedPassiveReceivers = new Set<string>()
  const wavePrevPoolValues: Record<string, number> = {}
  for (const tp of gIdx.triggerOnPools) {
    wavePrevPoolValues[tp.id] = state.values[tp.id] ?? 0
  }
  const runWave = (nodes: MxNode[], wave: number): void => {
    const next: MxNode[] = []
    currentWaveNext = next
    for (const n of nodes) {
      if (wave === 0) scheduledRemaining.delete(n.id)
      const poolBefore = n.kind === 'pool' && n.triggerOn ? (wavePrevPoolValues[n.id] ?? 0) : 0
      const res = fireNode(n)
      let allowStar = res.okStar
      if (n.kind === 'pool' && n.triggerOn) {
        const poolAfter = state.values[n.id] ?? 0
        if (n.triggerOn === 'decrease' || n.triggerOn === 'send') {
          allowStar = poolAfter < poolBefore - 1e-9
        } else if (n.triggerOn === 'increase' || n.triggerOn === 'receive') {
          allowStar = poolAfter > poolBefore + 1e-9
        }
        if (allowStar) {
          processedPassiveReceivers.add(n.id)
          wavePrevPoolValues[n.id] = poolAfter
        }
      }
      propagateStateTriggersFrom(n.id, allowStar, res.okBang, next)
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
            (acc, e) =>
              acc +
              (byId.get(e.from)?.kind === 'gate'
                ? 1
                : evalFlowAmount(doc, e, state, params, rng, Number.POSITIVE_INFINITY, false)),
            0
          )
          if (needTotal > 0 && (state.values[recNode.id] ?? 0) + 1e-9 >= needTotal) {
            const res = fireNode(recNode)
            propagateStateTriggersFrom(recId, res.okStar, res.okBang, next)
          }
        } else if (
          !recNode.triggerOn ||
          recNode.triggerOn === 'increase' ||
          recNode.triggerOn === 'receive' ||
          recNode.triggerOn === 'any_change' ||
          recNode.triggerOn === 'any'
        ) {
          if (recNode.kind === 'pool' && recNode.triggerOn) {
            wavePrevPoolValues[recId] = state.values[recId] ?? 0
          }
          propagateStateTriggersFrom(recId, true, false, next)
        }
      }
    }
    // 支持任意波次（含交互级联 / 瞬时传导）中 Pool 设置 triggerOn = 'decrease'/'send' 或 'any_change'/'any' 时在池存量减少时发射 `*` 触发器
    for (const n of gIdx.triggerOnPools) {
      const before = wavePrevPoolValues[n.id] ?? 0
      const after = state.values[n.id] ?? 0
      wavePrevPoolValues[n.id] = after
      if (!n.triggerOn || n.triggerOn === 'increase' || n.triggerOn === 'receive') {
        continue
      }
      if (processedPassiveReceivers.has(n.id)) continue
      if (
        ((n.triggerOn === 'decrease' || n.triggerOn === 'send') && after < before - 1e-9) ||
        ((n.triggerOn === 'any_change' || n.triggerOn === 'any') && Math.abs(after - before) > 1e-9)
      ) {
        processedPassiveReceivers.add(n.id)
        propagateStateTriggersFrom(n.id, true, false, next)
      }
    }
    if (next.length && wave < 5) runWave(next, wave + 1)
  }
  runWave(firing, 0)

  // 4) 寄存器、Node Modifiers 状态传导、激活、终止条件
  recomputeRegisters(doc, state, params, rng)
  if (gIdx.nodeModTargets.length > 0) {
    applyNodeStateModifiers(doc, state, params, rng)
    if (gIdx.registers.length > 0) recomputeRegisters(doc, state, params, rng)
  }
  state.active = nowActive
  let endSharedVars: Record<string, number> | null = null
  for (const n of gIdx.endNodes) {
    if (!endSharedVars) endSharedVars = buildVars(doc, state.values, params, step)
    const vars = { ...endSharedVars }
    let hit = false
    const inputs = stateInputs(doc, n.id).filter(
      (e) =>
        (!n.ignoreDisabledInputs || nowActive[e.from] !== false) &&
        isEdgeActive(doc, e, state, params, rng)
    )
    if (n.formula?.trim()) {
      inputs.forEach((e, idx) => {
        const originVal = getStateEdgeOriginValue(doc, e, state)
        if (idx < POSITIONAL_LETTERS.length) {
          vars[POSITIONAL_LETTERS[idx]!] = originVal
        }
        if (e.label?.trim()) {
          const customVar = mxIdentifier(e.label.trim())
          if (customVar) vars[customVar] = originVal
        }
      })
      const stSpec = parseMxStateFormula(n.formula)
      if (stSpec.type === 'activator' || stSpec.type === 'range') {
        const firstInputVal = inputs.length ? getStateEdgeOriginValue(doc, inputs[0]!, state) : 0
        hit = checkActivator(stSpec, firstInputVal, vars, rng, gIdx.paramArrays) === true
      } else {
        hit = evaluateMxExpression(n.formula, { vars, arrays: gIdx.paramArrays, rng }, 0) !== 0
      }
    } else if (inputs.length) {
      const evalInput = (e: MxEdge): boolean => {
        if (triggeredEndEdges.has(e.id)) return true
        const sp = getEffectiveStateSpec(doc, e, state, params, rng)
        if (sp.type === 'trigger' || sp.type === 'reverse_trigger') {
          return triggeredEndEdges.has(e.id)
        }
        return (
          checkActivator(
            sp,
            getStateEdgeOriginValue(doc, e, state),
            vars,
            rng,
            gIdx.paramArrays
          ) === true
        )
      }
      hit = n.endMode === 'any' ? inputs.some(evalInput) : inputs.every(evalInput)
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
  finalPoolTokens?: Record<string, MxPoolTokenStackItem[]>
  poolTokensHistory?: Array<Record<string, MxPoolTokenStackItem[]>>
}

function clonePoolTokensMap(
  src?: Record<string, MxPoolTokenStackItem[]>
): Record<string, MxPoolTokenStackItem[]> {
  if (!src) return {}
  const out: Record<string, MxPoolTokenStackItem[]> = {}
  for (const [k, arr] of Object.entries(src)) {
    if (arr.length > 0) out[k] = arr.map((it) => ({ resId: it.resId, count: it.count }))
  }
  return out
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
    skipTokenHistory?: boolean
  } = {}
): MxRunResult {
  const steps = Math.max(1, Math.min(2000, Math.round(options.steps ?? doc.settings.steps ?? 20)))
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 1)
  const initRng = createMxRng(seed * 3571 + 17)
  const params = options.params ?? resolveMxParams(doc, options.scenarioId, initRng)
  let state = createMxInitialState(doc, { params, seed })
  const snapshots: Array<Record<string, number>> = [{ ...state.values }]
  const edgeFlows: Array<Record<string, number>> = [{}]
  const poolTokensHistory =
    !options.skipTokenHistory && doc.nodes.length <= 300
      ? [clonePoolTokensMap(state.poolTokens)]
      : undefined
  const events: MxEvent[] = []
  for (let k = 1; k <= steps; k++) {
    const res = stepMxSimulation(doc, state, {
      seed,
      params,
      interactions: options.interactionsByStep?.[k]
    })
    state = res.state
    snapshots.push({ ...state.values })
    edgeFlows.push(state.edgeFlows)
    if (poolTokensHistory) poolTokensHistory.push(clonePoolTokensMap(state.poolTokens))
    for (let ei = 0; ei < res.events.length; ei++) {
      events.push(res.events[ei]!)
    }
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
    totalConsumed: Math.round(state.totalConsumed * 100) / 100,
    finalPoolTokens: state.poolTokens,
    ...(poolTokensHistory ? { poolTokensHistory } : {})
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
    const run = runMxSimulation(doc, {
      steps,
      seed: seed + r * 7919,
      params,
      skipTokenHistory: true
    })
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
  | 'topology_error'

export type MxTopologyWarningCode =
  | 'end_outgoing_resource'
  | 'hp_damage_inverted_converter'
  | 'dangling_unsigned_state_edge'
  | 'competing_auto_converters_with_auto_sell'

export interface MxTopologyWarning {
  code: MxTopologyWarningCode
  severity: 'warn' | 'critical'
  edgeId?: string
  nodeId?: string
  message: string
}

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
  topologyWarnings?: MxTopologyWarning[]
}

const HP_POOL_RE =
  /(?:^|[\s_\-/])(hp|base_hp|player_hp|hero_hp|core_hp|nexus_hp|health|life|lives)(?:$|[\s_\-/])|(\u751f\u547d|\u8840\u91cf|\u57fa\u5730\u751f\u547d|\u89d2\u8272\u751f\u547d)/i
const NON_SURVIVAL_HP_POOL_RE =
  /(?:^|[\s_\-/])(leaked|leaks|leak_count|enemy|enemies|monster|boss|mob|shield|armor|block|max_hp|dmg_dealt|enemy_dmg|enemy_hp|boss_hp)(?:$|[\s_\-/])|(\u5df2\u6f0f|\u6f0f\u602a\u6570|\u654c\u65b9|\u654c\u4eba|\u602a\u7269|\u62a4\u76fe|\u62a4\u7532|\u683c\u6321)/i
const DAMAGE_OR_LEAK_NODE_RE =
  /(?:^|[\s_\-/])(leak|wave_leak|dmg|damage|hurt|take_damage|hit|bleed|burn|poison|corrode)(?:$|[\s_\-/])|(\u6f0f\u602a|\u6263\u8840|\u6263\u751f\u547d|\u53d7\u4f24|\u6389\u8840|\u7834\u9632|\u53cd\u566c)/i
const HEAL_OR_RECOVERY_NODE_RE =
  /(?:^|[\s_\-/])(heal|regen|rest|recover|restore|potion|revive|lifesteal|leech|camp|campfire|tavern|medkit)(?:$|[\s_\-/])|(\u56de\u8840|\u6cbb\u7597|\u6062\u590d|\u4f11\u606f|\u836f\u6c34|\u5438\u8840|\u590d\u6d3b|\u8425\u5730|\u9152\u9986)/i

/**
 * 静态检查 mx@2 经济图中的常见拓扑反模式（方向接反、无效状态边、终局节点外流、无条件自动建卖死循环）。
 */
export function lintMxDocumentTopology(doc: MxDocument): MxTopologyWarning[] {
  const warnings: MxTopologyWarning[] = []
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const edgeById = new Map(doc.edges.map((e) => [e.id, e]))

  for (const edge of doc.edges) {
    const src = byId.get(edge.from)
    const dst = edge.targetEdgeId ? undefined : byId.get(edge.to)

    if (edge.kind === 'resource') {
      // 1) End 节点发出资源边（End 仅终止仿真，永远不会产出资源）
      if (src?.kind === 'end') {
        warnings.push({
          code: 'end_outgoing_resource',
          severity: 'critical',
          edgeId: edge.id,
          nodeId: src.id,
          message: `End node "${src.label || src.id}" (${src.id}) has outgoing resource edge "${edge.id}" -> "${edge.to}". End nodes only terminate simulation and never emit resources; use a state-gated Source/Converter instead.`
        })
      }

      // 2) 伤害/漏怪节点把资源推入生命池（mx@2 中 converter/source -> pool 恒为加法 +，扣血必须用 hp_pool -> drain）
      if ((src?.kind === 'converter' || src?.kind === 'source') && dst?.kind === 'pool') {
        const dstKey = `${dst.id} ${dst.label || ''}`
        const srcKey = `${src.id} ${src.label || ''}`
        if (
          HP_POOL_RE.test(dstKey) &&
          !NON_SURVIVAL_HP_POOL_RE.test(dstKey) &&
          DAMAGE_OR_LEAK_NODE_RE.test(srcKey) &&
          !HEAL_OR_RECOVERY_NODE_RE.test(srcKey)
        ) {
          warnings.push({
            code: 'hp_damage_inverted_converter',
            severity: 'critical',
            edgeId: edge.id,
            nodeId: src.id,
            message: `Damage/leak node "${src.label || src.id}" (${src.id}) pushes resources INTO health pool "${dst.label || dst.id}" (${dst.id}) via edge "${edge.id}", which ADDS HP instead of deducting it. Wire "${dst.id}" -> a Drain node to subtract HP.`
          })
        }
      }
    } else if (edge.kind === 'state') {
      // 3) 无符号纯数字状态边（如 "1"）：既不是带符号修正量 ("+1"/"-2")，也不是比较激活器 (">=1")
      // 例外：源节点为 Gate（Trigger Gate 支持无符号数值权重，如 "2", "5"）或目标公式显式引用位置变量 a..z / 自定义边标签变量
      const rawFormula = (edge.formula ?? '').trim()
      if (/^\d+(\.\d+)?$/.test(rawFormula) && src?.kind !== 'gate') {
        let usesPositionalLetter = false
        const customEdgeVar = edge.label?.trim() ? mxIdentifier(edge.label) : ''
        const matchesPositional = (f: string): boolean =>
          /\b[a-z]\b/.test(f) || (!!customEdgeVar && f.includes(customEdgeVar))
        if (edge.targetEdgeId) {
          const tgtEdge = edgeById.get(edge.targetEdgeId)
          if (tgtEdge && matchesPositional(tgtEdge.formula ?? '')) {
            usesPositionalLetter = true
          }
        } else if (dst) {
          if (dst.kind === 'register' && !dst.formula?.trim()) {
            usesPositionalLetter = true
          } else if (dst.formula && matchesPositional(dst.formula)) {
            usesPositionalLetter = true
          } else {
            const outResFormulas = doc.edges
              .filter((oe) => oe.kind === 'resource' && oe.from === dst.id)
              .map((oe) => oe.formula ?? '')
            if (outResFormulas.some((f) => matchesPositional(f))) {
              usesPositionalLetter = true
            }
          }
        }
        if (!usesPositionalLetter) {
          warnings.push({
            code: 'dangling_unsigned_state_edge',
            severity: 'warn',
            edgeId: edge.id,
            nodeId: edge.from,
            message: `State edge "${edge.id}" (${edge.from} -> ${edge.targetEdgeId || edge.to}) uses unsigned number "${rawFormula}", which is a no-op in mx@2. Use a signed modifier ("+1", "-2", "+20%"), a comparison activator (">=1", "<=0"), or reference "${edge.from}" directly in the formula.`
          })
        }
      }
    }
  }

  // 4) 无条件自动 Converter 同一回合“自动建造 + 自动折旧出售”循环抢占
  const autoConverters = doc.nodes.filter(
    (n) => (n.kind === 'converter' || n.kind === 'trader') && n.trigger === 'automatic'
  )
  const hasStateActivator = (nodeId: string): boolean =>
    doc.edges.some((se) => {
      if (se.kind !== 'state' || se.targetEdgeId || se.to !== nodeId) return false
      const sp = parseMxStateFormula(se.formula)
      return (
        sp.type === 'activator' ||
        sp.type === 'range' ||
        (sp.type === 'expr' && isMxBooleanStateExpr(sp.expr))
      )
    })

  const poolPairsByAutoConv = autoConverters.map((conv) => {
    const inPools = doc.edges
      .filter((e) => e.kind === 'resource' && e.to === conv.id && byId.get(e.from)?.kind === 'pool')
      .map((e) => e.from)
    const outPools = doc.edges
      .filter((e) => e.kind === 'resource' && e.from === conv.id && byId.get(e.to)?.kind === 'pool')
      .map((e) => e.to)
    return { conv, inPools, outPools, gated: hasStateActivator(conv.id) }
  })

  const reportedSellIds = new Set<string>()
  for (const sellEntry of poolPairsByAutoConv) {
    if (sellEntry.gated || reportedSellIds.has(sellEntry.conv.id)) continue
    const sellKey = `${sellEntry.conv.id} ${sellEntry.conv.label || ''}`.toLowerCase()
    const looksLikeSellOrRefund =
      /(?:^|[\s_\-/])(sell|salvage|dismantle|recycle|refund|disenchant)(?:$|[\s_\-/])|(\u51fa\u552e|\u5356\u5854|\u62c6\u9664|\u62c6\u5854|\u56de\u6536|\u6298\u65e7|\u5206\u89e3)/.test(
        sellKey
      )
    if (!looksLikeSellOrRefund) continue
    for (const assetPoolId of sellEntry.inPools) {
      for (const currencyPoolId of sellEntry.outPools) {
        if (assetPoolId === currencyPoolId) continue
        const builder = poolPairsByAutoConv.find(
          (b) =>
            b.conv.id !== sellEntry.conv.id &&
            b.inPools.includes(currencyPoolId) &&
            b.outPools.includes(assetPoolId)
        )
        if (builder) {
          reportedSellIds.add(sellEntry.conv.id)
          warnings.push({
            code: 'competing_auto_converters_with_auto_sell',
            severity: 'warn',
            nodeId: sellEntry.conv.id,
            message: `Automatic sell/refund converter "${sellEntry.conv.label || sellEntry.conv.id}" (${sellEntry.conv.id}) unconditionally recycles "${assetPoolId}" -> "${currencyPoolId}" every step alongside automatic builder "${builder.conv.id}", causing per-step lossy churn. Set "${sellEntry.conv.id}" to trigger: "interactive" (with botCondition) or gate it with a state activator.`
          })
          break
        }
      }
      if (reportedSellIds.has(sellEntry.conv.id)) break
    }
  }

  return warnings
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
  let conversionFaucet = 0
  let conversionSink = 0
  if (activeRun.edgeFlows && activeRun.edgeFlows.length > 0) {
    const cumByEdge = new Map<string, number>()
    for (const stepFlows of activeRun.edgeFlows) {
      for (const [eid, amt] of Object.entries(stepFlows)) {
        if (amt > 0) cumByEdge.set(eid, (cumByEdge.get(eid) ?? 0) + amt)
      }
    }
    const firstSnap = activeRun.snapshots[0] ?? {}
    const lastSnap = activeRun.snapshots[activeRun.snapshots.length - 1] ?? {}
    for (const n of doc.nodes) {
      if (n.kind !== 'converter' && n.kind !== 'trader') continue
      let inFlow = 0
      let outFlow = 0
      for (const e of doc.edges) {
        if (e.kind !== 'resource' || e.targetEdgeId) continue
        const f = cumByEdge.get(e.id) ?? 0
        if (f <= 0) continue
        if (e.to === n.id) inFlow += f
        if (e.from === n.id) outFlow += f
      }
      const bufferedDelta = Math.max(0, (lastSnap[n.id] ?? 0) - (firstSnap[n.id] ?? 0))
      const usedIn = Math.max(0, inFlow - bufferedDelta)
      if (usedIn > outFlow + 1e-6) {
        conversionSink += usedIn - outFlow
      } else if (outFlow > usedIn + 1e-6) {
        conversionFaucet += outFlow - usedIn
      }
    }
  }
  const produced = Math.round((activeRun.totalProduced + conversionFaucet) * 100) / 100
  const consumed = Math.round((activeRun.totalConsumed + conversionSink) * 100) / 100
  const faucetSinkRatio =
    consumed > 0 ? Math.round((produced / consumed) * 100) / 100 : produced > 0 ? 99 : 1
  const netFlowPerStep = Math.round(((produced - consumed) / steps) * 100) / 100

  const findings: MxDiagnosticFinding[] = []
  let penalty = 0

  // 0) 静态拓扑反模式检查 (Topology Lint)
  const topologyWarnings = lintMxDocumentTopology(doc)
  for (const tw of topologyWarnings) {
    penalty += tw.severity === 'critical' ? 25 : 12
    findings.push({
      id: `diag_topo_${tw.code}_${tw.edgeId || tw.nodeId || findings.length}`,
      severity: tw.severity,
      kind: 'topology_error',
      nodeId: tw.nodeId,
      nodeLabel: tw.message
    })
  }

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
      value: Math.round(produced * 100) / 100,
      secondaryValue: netFlowPerStep
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
    findings,
    ...(topologyWarnings.length ? { topologyWarnings } : {})
  }
}

// ───────────────────────────── 逆向目标求解器 (Goal-Seek) & 参数敏感度扫描 (Parameter Sweep) ─────────────────────────────

export type MxTunableKind = 'param' | 'edge' | 'node_initial'

export type MxGoalSeekMetric = 'node_value' | 'end_step' | 'health_score'

export interface MxGoalSeekOptions {
  variableKind: MxTunableKind
  /** param.name | edge.id | node.id */
  variableId: string
  minVal: number
  maxVal: number
  goalMetric: MxGoalSeekMetric
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

/** 提取连线公式中的主数值，供 Auto-Balancer (Mark as influencer) 初始化搜索区间 */
export function extractMxTunableEdgeNumericValue(edge: MxEdge): number {
  const raw = (edge.formula ?? '').trim()
  if (!raw) return 1
  const core = raw.replace(/\s*(?:\||every\b).*$/i, '').trim()
  const direct = Number(core)
  if (Number.isFinite(direct)) return direct
  const pct = /^([+-]?\d+(?:\.\d+)?)\s*%$/.exec(core)
  if (pct) return Number(pct[1])
  const ivMod = /^([+-]?\d+(?:\.\d+)?)\s*(%?)\s*i$/i.exec(core)
  if (ivMod) return Number(ivMod[1])
  const act = /^(?:>=|<=|==|!=|<>|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(core)
  if (act) return Number(act[1])
  const dice = /^(\d+)[dD]\d+/.exec(core)
  if (dice) return Number(dice[1])
  return 1
}

/** 将调平数值写回连线公式，同时完整保留 `%`、`>=`、`+xi`、`+x%` 或 `|interval` 语法结构 */
export function formatMxTunableEdgeFormula(edge: MxEdge, val: number): string {
  const rounded = edge.allowDecimals === false ? Math.round(val) : Math.round(val * 1000) / 1000
  const raw = (edge.formula ?? '').trim()
  if (edge.kind === 'state') {
    const act = /^(>=|<=|==|!=|<>|>|<|=)\s*-?\d+(?:\.\d+)?$/.exec(raw)
    if (act) return `${act[1]}${rounded}`
    const ivMod = /^[+-]?\s*\d+(?:\.\d+)?\s*(%?)\s*i$/i.exec(raw)
    if (ivMod) return `${rounded >= 0 ? '+' : ''}${rounded}${ivMod[1] ?? ''}i`
    if (/^\d+(?:\.\d+)?\s*%$/.test(raw)) return `${Math.max(0, rounded)}%`
    if (/^[+-]\s*\d+(?:\.\d+)?\s*%$/.test(raw)) return `${rounded >= 0 ? '+' : ''}${rounded}%`
    return `${rounded >= 0 ? '+' : ''}${rounded}`
  }
  const pipeMatch = /^([^|]+)\|(.+)$/.exec(raw)
  const core = pipeMatch ? pipeMatch[1]!.trim() : raw
  const suffix = pipeMatch ? `|${pipeMatch[2]!.trim()}` : ''
  if (/^\d+(?:\.\d+)?\s*%$/.test(core)) {
    return `${Math.max(0, rounded)}%${suffix}`
  }
  return `${rounded}${suffix}`
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
      e.formula = formatMxTunableEdgeFormula(e, rounded)
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
  const isHealthMetric = options.goalMetric === 'health_score'
  const effectiveTarget = isHealthMetric ? 100 : options.targetValue
  const atStep = Math.max(
    1,
    Math.min(
      500,
      Math.round(
        isHealthMetric ? (doc.settings.steps ?? 20) : (options.atStep ?? doc.settings.steps ?? 20)
      )
    )
  )
  const seed = Math.floor(options.seed ?? doc.settings.seed ?? 2026)
  const goalNodeId =
    options.goalNodeId ??
    doc.nodes.find((n) => n.kind === 'pool' || n.kind === 'register')?.id ??
    ''

  interface RankedCandidate extends MxGoalSeekCandidate {
    rankCost: number
  }

  const evalAt = (val: number): RankedCandidate => {
    const v = Math.round(val * 1000) / 1000
    const tunedDoc = applyTunableToDocClone(doc, options.variableKind, options.variableId, v)
    let sum = 0
    let tiePenaltySum = 0
    for (let r = 0; r < runsPerSample; r++) {
      const run = runMxSimulation(tunedDoc, {
        steps: atStep,
        seed: seed + r * 7919,
        skipTokenHistory: true
      })
      if (isHealthMetric) {
        const health = analyzeMxEconomyHealth(tunedDoc, run)
        sum += health.score
        const warnCount = health.findings.filter(
          (f) => f.severity === 'warn' || f.severity === 'critical'
        ).length
        const ratioDist = Math.abs(
          Math.log(Math.max(0.05, Math.min(50, health.faucetSinkRatio || 1)) / 1.15)
        )
        tiePenaltySum += warnCount * 0.25 + Math.min(2, ratioDist * 0.15)
      } else if (options.goalMetric === 'end_step') {
        sum += run.stepsRun
      } else {
        const snap = run.snapshots[Math.min(atStep, run.snapshots.length - 1)] ?? {}
        sum += snap[goalNodeId] ?? 0
      }
    }
    const achieved = Math.round((sum / runsPerSample) * 100) / 100
    const error = Math.round(Math.abs(achieved - effectiveTarget) * 100) / 100
    const rankCost = error + (isHealthMetric ? tiePenaltySum / runsPerSample : 0)
    return { variableValue: v, achievedValue: achieved, error, rankCost }
  }

  // 第一阶段：均匀网格扫描
  const coarseRanked: RankedCandidate[] = []
  const span = Math.max(1e-6, hi - lo)
  for (let i = 0; i < samples; i++) {
    const val = lo + (span * i) / Math.max(1, samples - 1)
    coarseRanked.push(evalAt(val))
  }

  let best = coarseRanked.reduce((a, b) => (b.rankCost < a.rankCost ? b : a), coarseRanked[0]!)

  // 第二阶段：在最优值邻域内做 9 点精细插值搜索
  const stepSize = span / Math.max(1, samples - 1)
  const fineLo = Math.max(lo, best.variableValue - stepSize)
  const fineHi = Math.min(hi, best.variableValue + stepSize)
  if (fineHi - fineLo > 1e-5) {
    for (let j = 1; j < 8; j++) {
      const val = fineLo + ((fineHi - fineLo) * j) / 8
      const cand = evalAt(val)
      if (cand.rankCost < best.rankCost) best = cand
    }
  }

  return {
    variableKind: options.variableKind,
    variableId: options.variableId,
    bestValue: best.variableValue,
    achievedValue: best.achievedValue,
    targetValue: effectiveTarget,
    error: best.error,
    candidates: coarseRanked.map(({ variableValue, achievedValue, error }) => ({
      variableValue,
      achievedValue,
      error
    }))
  }
}

export interface MxDiagnosticQuickFixOptions {
  sinkLabel?: string
  run?: MxRunResult | null
  seed?: number
  scenarioId?: string
}

export interface MxDiagnosticQuickFixResult {
  changed: boolean
  focusNodeId?: string
  focusEdgeId?: string
}

function extractEdgeThresholdExpr(edge: MxEdge): { expr: string; numeric?: number } {
  const core = (edge.formula ?? '').replace(/\s*(?:\||every\b).*$/i, '').trim()
  if (!core || core === '1') return { expr: '1', numeric: 1 }
  const direct = Number(core)
  if (Number.isFinite(direct)) {
    const v = Math.max(1, Math.round(direct * 1000) / 1000)
    return { expr: String(v), numeric: v }
  }
  const dice = /^(\d*)[dD](\d+)$/.exec(core)
  if (dice) {
    const count = Math.max(1, Number(dice[1] || '1'))
    const sides = Math.max(1, Number(dice[2]))
    const maxRoll = count * sides
    return { expr: String(maxRoll), numeric: maxRoll }
  }
  const range = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/.exec(core)
  if (range) {
    const hi = Math.max(1, Number(range[1]), Number(range[2]))
    return { expr: String(hi), numeric: hi }
  }
  if (/^\d+(?:\.\d+)?\s*%$/.test(core)) {
    return { expr: '1', numeric: 1 }
  }
  return { expr: core }
}

function isSimpleNumericEdge(edge: MxEdge): boolean {
  const core = (edge.formula ?? '').replace(/\s*(?:\||every\b).*$/i, '').trim()
  return !core || Number.isFinite(Number(core))
}

export function canQuickFixMxDiagnosticFinding(finding: MxDiagnosticFinding): boolean {
  return finding.severity !== 'ok' && finding.kind !== 'balanced'
}

/**
 * 针对单条经济诊断警告就地修复 `doc`（拓扑补边 / 容量扩容 / Sink 均衡 / 拓扑反模式修正）。
 */
export function applyMxDiagnosticQuickFixInPlace(
  doc: MxDocument,
  finding: MxDiagnosticFinding,
  options: MxDiagnosticQuickFixOptions = {}
): MxDiagnosticQuickFixResult {
  if (!canQuickFixMxDiagnosticFinding(finding)) return { changed: false }
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const sinkLabel = options.sinkLabel?.trim() || 'Upkeep Sink'

  if (finding.kind === 'starved_converter' && finding.nodeId) {
    const target = byId.get(finding.nodeId)
    if (!target) return { changed: false }

    // 1) 从上游 Pool / Register 入边自动补齐 `>=消耗阈值` 状态激活边
    const inResEdges = doc.edges.filter(
      (e) => e.kind === 'resource' && !e.targetEdgeId && e.to === target.id
    )
    const poolReqs = new Map<string, { numerics: number[]; exprs: string[]; edges: MxEdge[] }>()
    for (const e of inResEdges) {
      const src = byId.get(e.from)
      if (!src || (src.kind !== 'pool' && src.kind !== 'register')) continue
      const th = extractEdgeThresholdExpr(e)
      const cur = poolReqs.get(src.id) ?? { numerics: [], exprs: [], edges: [] }
      if (th.numeric !== undefined) cur.numerics.push(th.numeric)
      else cur.exprs.push(th.expr)
      cur.edges.push(e)
      poolReqs.set(src.id, cur)
    }

    let changed = false
    let focusEdgeId: string | undefined

    if (poolReqs.size > 0) {
      const reqEntries = Array.from(poolReqs.entries()).map(([poolId, info]) => {
        const numSum = info.numerics.reduce((a, b) => a + b, 0)
        let thresholdExpr: string
        if (info.exprs.length === 0) {
          thresholdExpr = String(Math.max(1, Math.round(numSum * 1000) / 1000))
        } else {
          const parts = [...info.exprs.map((x) => `(${x})`)]
          if (numSum > 0) parts.push(String(Math.round(numSum * 1000) / 1000))
          thresholdExpr = parts.join(' + ')
        }
        return { poolId, thresholdExpr, numericTotal: info.exprs.length === 0 ? numSum : undefined }
      })

      if (target.pullMode === 'pull_any' && reqEntries.length >= 2) {
        const firstPoolId = reqEntries[0]!.poolId
        let condExpr = '0'
        for (let i = reqEntries.length - 1; i >= 0; i--) {
          const item = reqEntries[i]!
          condExpr = `if(${item.poolId} >= (${item.thresholdExpr}), 1, ${condExpr})`
        }
        const formula = `${condExpr} >= 1`
        const existing = doc.edges.find(
          (e) =>
            e.kind === 'state' && !e.targetEdgeId && e.from === firstPoolId && e.to === target.id
        )
        if (existing) {
          if (existing.formula !== formula) {
            existing.formula = formula
            changed = true
            focusEdgeId = existing.id
          }
        } else {
          const eid = mxNewId('e')
          doc.edges.push({
            id: eid,
            kind: 'state',
            from: firstPoolId,
            to: target.id,
            formula,
            bend: -28
          })
          changed = true
          focusEdgeId = eid
        }
      } else {
        for (const item of reqEntries) {
          const desiredFormula = `>=${item.thresholdExpr}`
          const existing = doc.edges.find((e) => {
            if (
              e.kind !== 'state' ||
              e.targetEdgeId ||
              e.from !== item.poolId ||
              e.to !== target.id
            ) {
              return false
            }
            const sp = parseMxStateFormula(e.formula)
            return sp.type === 'activator' || sp.type === 'expr' || sp.type === 'range'
          })
          if (existing) {
            const sp = parseMxStateFormula(existing.formula)
            const needsRaise =
              sp.type !== 'activator' ||
              sp.op !== '>=' ||
              item.numericTotal === undefined ||
              sp.value < item.numericTotal
            if (needsRaise && existing.formula !== desiredFormula) {
              existing.formula = desiredFormula
              changed = true
              focusEdgeId = existing.id
            }
          } else {
            const eid = mxNewId('e')
            doc.edges.push({
              id: eid,
              kind: 'state',
              from: item.poolId,
              to: target.id,
              formula: desiredFormula,
              bend: -28
            })
            changed = true
            focusEdgeId = eid
          }

          // 若同一上游池同时喂给多个自动节点，将该池所有出向资源边设为 instant，避免先触发节点扣空库存后晚触发节点在同一拍发生饥饿阻塞
          const siblingAutoEdges = doc.edges.filter((e) => {
            if (e.kind !== 'resource' || e.targetEdgeId || e.from !== item.poolId) return false
            const dst = byId.get(e.to)
            return dst && dst.id !== target.id && dst.trigger === 'automatic'
          })
          if (siblingAutoEdges.length > 0) {
            for (const se of doc.edges) {
              if (se.kind === 'resource' && !se.targetEdgeId && se.from === item.poolId) {
                if (se.transferMode !== 'instant') {
                  se.transferMode = 'instant'
                  changed = true
                }
              }
            }
          }
        }
      }
    }

    // 2) 若下游存在容量封顶的阻塞池导致 Converter/Source 被反压阻塞，扩容或开启溢出回收
    const outResEdges = doc.edges.filter(
      (e) => e.kind === 'resource' && !e.targetEdgeId && e.from === target.id
    )
    for (const oe of outResEdges) {
      const dst = byId.get(oe.to)
      if (dst?.kind === 'pool' && dst.capacity && dst.capacity > 0 && dst.overflow !== 'drain') {
        if (!changed) {
          dst.capacity = Math.max(dst.capacity + 20, Math.ceil((dst.capacity * 2.5) / 10) * 10)
          changed = true
        }
      }
    }

    // 3) 兜底验证：若因非池入边（如直连未激活节点或区间限流）仍阻塞，将触发器降为按需触发或扩容下游
    const verifyHealth = analyzeMxEconomyHealth(doc)
    const stillStarved = verifyHealth.findings.some(
      (x) => x.kind === 'starved_converter' && x.nodeId === target.id
    )
    if (stillStarved) {
      for (const oe of outResEdges) {
        const dst = byId.get(oe.to)
        if (dst?.kind === 'pool' && dst.capacity && dst.capacity > 0 && dst.overflow !== 'drain') {
          dst.overflow = 'drain'
          changed = true
        }
      }
      const recheck = analyzeMxEconomyHealth(doc)
      if (
        recheck.findings.some((x) => x.kind === 'starved_converter' && x.nodeId === target.id) &&
        target.trigger === 'automatic'
      ) {
        target.trigger = 'passive'
        for (const ie of inResEdges) {
          const src = byId.get(ie.from)
          if (src?.kind === 'source' && src.trigger === 'passive') {
            src.trigger = 'automatic'
          }
        }
        changed = true
      }
    }

    return { changed, focusNodeId: target.id, focusEdgeId }
  }

  if (finding.kind === 'inflation') {
    const activeRun = options.run ?? runMxSimulation(doc)
    const steps = Math.max(1, activeRun.stepsRun)
    const firstSnap = activeRun.snapshots[0] ?? {}
    const lastSnap = activeRun.snapshots[activeRun.snapshots.length - 1] ?? {}

    // 优先调优已有的活跃数值型 Drain 入边
    const drainEdges = doc.edges.filter((e) => {
      if (e.kind !== 'resource' || e.targetEdgeId || !isSimpleNumericEdge(e)) return false
      const dst = byId.get(e.to)
      const src = byId.get(e.from)
      if (dst?.kind !== 'drain' || src?.kind !== 'pool') return false
      const srcKey = `${src.id} ${src.label || ''}`
      return !HP_POOL_RE.test(srcKey) && (lastSnap[src.id] ?? 0) > (firstSnap[src.id] ?? 0)
    })

    const curHealth = analyzeMxEconomyHealth(doc, activeRun)
    if (finding.id !== 'diag_inflation_nosink' && drainEdges.length > 0) {
      const scale = Math.min(8, Math.max(1.5, curHealth.faucetSinkRatio / 1.35))
      let focusEdgeId: string | undefined
      for (const de of drainEdges) {
        const dstDrain = byId.get(de.to)
        if (dstDrain && dstDrain.trigger === 'passive') dstDrain.trigger = 'automatic'
        const curVal = Math.max(0.5, extractMxTunableEdgeNumericValue(de))
        const nextVal = Math.max(1, Math.round(curVal * scale * 10) / 10)
        de.formula = formatMxTunableEdgeFormula(de, nextVal)
        focusEdgeId = de.id
      }
      return { changed: true, focusEdgeId, focusNodeId: drainEdges[0]!.to }
    }

    // 零回收或现有 Drain 无源可抽：定位净堆积最大的非生命池，自动挂载 Drain 消耗节点
    const candidatePools = doc.nodes
      .filter((n) => {
        if (n.kind !== 'pool') return false
        const key = `${n.id} ${n.label || ''}`
        if (HP_POOL_RE.test(key) && !NON_SURVIVAL_HP_POOL_RE.test(key)) return false
        return true
      })
      .map((n) => {
        const delta = (lastSnap[n.id] ?? 0) - (firstSnap[n.id] ?? 0)
        const isTerminal = !doc.edges.some(
          (e) => e.kind === 'resource' && !e.targetEdgeId && e.from === n.id
        )
        return { node: n, delta, isTerminal }
      })
      .sort((a, b) => {
        if (a.delta > 0 !== b.delta > 0) return b.delta - a.delta
        if (a.isTerminal !== b.isTerminal) return Number(b.isTerminal) - Number(a.isTerminal)
        return b.delta - a.delta
      })

    const targetPool = candidatePools[0]?.node
    if (!targetPool) return { changed: false }

    const poolDeltaPerStep = Math.max(
      0.5,
      ((lastSnap[targetPool.id] ?? 0) - (firstSnap[targetPool.id] ?? 0)) / steps
    )
    const targetNetPerStep = Math.max(0.5, curHealth.netFlowPerStep * 0.65)
    const rawRate = Math.min(poolDeltaPerStep * 0.85, targetNetPerStep)
    const drainRate =
      rawRate >= 2 ? Math.round(rawRate) : Math.max(0.5, Math.round(rawRate * 2) / 2)

    const drainId = mxNewId('drain')
    const drainNode: MxNode = {
      ...createMxNode('drain', targetPool.x + 150, targetPool.y + 56, sinkLabel),
      id: drainId,
      trigger: 'automatic',
      ...(targetPool.layerId ? { layerId: targetPool.layerId } : {})
    }
    const edgeId = mxNewId('e')
    doc.nodes.push(drainNode)
    doc.edges.push({
      id: edgeId,
      kind: 'resource',
      from: targetPool.id,
      to: drainId,
      formula: String(drainRate)
    })
    return { changed: true, focusNodeId: drainId, focusEdgeId: edgeId }
  }

  if (finding.kind === 'deflation') {
    const drainEdges = doc.edges.filter(
      (e) =>
        e.kind === 'resource' &&
        !e.targetEdgeId &&
        byId.get(e.to)?.kind === 'drain' &&
        isSimpleNumericEdge(e)
    )
    if (drainEdges.length > 0) {
      for (const de of drainEdges) {
        const curVal = Math.max(0.5, extractMxTunableEdgeNumericValue(de))
        de.formula = formatMxTunableEdgeFormula(
          de,
          Math.max(0.5, Math.round(curVal * 0.45 * 10) / 10)
        )
      }
      return { changed: true, focusEdgeId: drainEdges[0]!.id }
    }
    const sourceEdges = doc.edges.filter(
      (e) =>
        e.kind === 'resource' &&
        !e.targetEdgeId &&
        byId.get(e.from)?.kind === 'source' &&
        isSimpleNumericEdge(e)
    )
    if (sourceEdges.length > 0) {
      for (const se of sourceEdges) {
        const curVal = Math.max(1, extractMxTunableEdgeNumericValue(se))
        se.formula = formatMxTunableEdgeFormula(se, Math.round(curVal * 2.2 * 10) / 10)
      }
      return { changed: true, focusEdgeId: sourceEdges[0]!.id }
    }
    return { changed: false }
  }

  if (finding.kind === 'pool_capped' && finding.nodeId) {
    const pool = byId.get(finding.nodeId)
    if (!pool || pool.kind !== 'pool') return { changed: false }
    const curCap = Math.max(10, pool.capacity ?? 20)
    pool.capacity = Math.ceil((curCap * 2.2) / 10) * 10
    return { changed: true, focusNodeId: pool.id }
  }

  if (finding.kind === 'pool_depleted' && finding.nodeId) {
    const pool = byId.get(finding.nodeId)
    if (!pool || pool.kind !== 'pool') return { changed: false }
    const boost = Math.max(10, Math.ceil((finding.value ?? 10) * 0.6))
    pool.initial = Math.round(((pool.initial ?? 0) + boost) * 10) / 10
    if (pool.capacity && pool.capacity > 0 && pool.capacity < pool.initial) {
      pool.capacity = Math.ceil((pool.initial * 1.5) / 10) * 10
    }
    return { changed: true, focusNodeId: pool.id }
  }

  if (finding.kind === 'exponential_runaway' && finding.nodeId) {
    const node = byId.get(finding.nodeId)
    if (!node || (node.kind !== 'pool' && node.kind !== 'register')) return { changed: false }

    const activeRun =
      options.run ??
      runMxSimulation(doc, {
        seed: options.seed ?? doc.settings.seed,
        scenarioId: options.scenarioId
      })
    const baselineHealth = analyzeMxEconomyHealth(doc, activeRun)
    const baselineWarnIds = new Set(
      baselineHealth.findings
        .filter(
          (f) => f.severity === 'warn' || f.severity === 'critical' || f.kind === 'pool_depleted'
        )
        .map((f) => f.id)
    )
    const series = activeRun.snapshots.map((s) => s[node.id] ?? 0)
    const mid = Math.max(1, Math.floor(series.length / 2))
    const delta1 =
      series.length >= 2 ? Math.max(0.5, ((series[mid] ?? 0) - (series[0] ?? 0)) / mid) : 1

    const verifySeeds = Array.from(
      new Set([doc.settings.seed, ...(options.seed != null ? [options.seed] : [])])
    )
    const fallbackBox: {
      best: { doc: MxDocument; res: MxDiagnosticQuickFixResult; score: number } | null
    } = { best: null }

    const dampenStateModifierEdge = (se: MxEdge, factor: number): boolean => {
      const sp = parseMxStateFormula(se.formula)
      if (sp.type === 'modifier' && sp.delta > 0) {
        const nextDelta = Math.max(0.1, Math.round(sp.delta * factor * 100) / 100)
        const nextFormula = `+${nextDelta}${sp.percent ? '%' : ''}`
        if (nextFormula !== se.formula) {
          se.formula = nextFormula
          return true
        }
      } else if (sp.type === 'fraction_modifier' && sp.numerator > 0 && sp.denominator > 0) {
        const nextDen = Math.max(2, Math.round(sp.denominator / factor))
        const nextFormula = `+${sp.numerator}/${nextDen}`
        if (nextFormula !== se.formula) {
          se.formula = nextFormula
          return true
        }
      }
      return false
    }

    const tryCandidate = (
      mutateCand: (cand: MxDocument) => MxDiagnosticQuickFixResult | null
    ): MxDiagnosticQuickFixResult | null => {
      const cand: MxDocument = JSON.parse(JSON.stringify(doc))
      const res = mutateCand(cand)
      if (!res || !res.changed) return null

      let minScore = 100
      let hasNewSideEffect = false
      for (const sd of verifySeeds) {
        const sim = runMxSimulation(cand, { seed: sd, scenarioId: options.scenarioId })
        const h = analyzeMxEconomyHealth(cand, sim)
        if (h.findings.some((f) => f.kind === 'exponential_runaway' && f.nodeId === node.id)) {
          return null
        }
        if (
          h.findings.some(
            (f) => f.kind === 'pool_capped' && f.nodeId === node.id && !baselineWarnIds.has(f.id)
          )
        ) {
          return null
        }
        const sideEffects = h.findings.some(
          (f) =>
            (f.severity === 'warn' ||
              f.severity === 'critical' ||
              (f.kind === 'pool_depleted' && f.nodeId === node.id)) &&
            !baselineWarnIds.has(f.id)
        )
        if (sideEffects) hasNewSideEffect = true
        if (h.score < minScore) minScore = h.score
      }

      if (!hasNewSideEffect) {
        doc.nodes = cand.nodes
        doc.edges = cand.edges
        doc.params = cand.params
        return res
      }
      if (!fallbackBox.best || minScore > fallbackBox.best.score) {
        fallbackBox.best = { doc: cand, res, score: minScore }
      }
      return null
    }

    if (node.kind === 'register') {
      const origFormula = (node.formula ?? '').trim()
      if (origFormula) {
        for (const k of [0.1, 0.2, 0.35, 0.6, 1.0]) {
          const hit = tryCandidate((cand) => {
            const rn = cand.nodes.find((x) => x.id === node.id)
            if (!rn) return null
            rn.formula = `round(((${origFormula}) / (1 + step * ${k})) * 10) / 10`
            return { changed: true, focusNodeId: rn.id }
          })
          if (hit) return hit
        }
      }

      for (const factor of [0.4, 0.2]) {
        const hit = tryCandidate((cand) => {
          let modChanged = false
          let focusEdgeId: string | undefined
          for (const se of cand.edges) {
            if (se.kind === 'state' && !se.targetEdgeId && se.to === node.id) {
              if (dampenStateModifierEdge(se, factor)) {
                modChanged = true
                focusEdgeId = se.id
              }
            }
          }
          return modChanged ? { changed: true, focusEdgeId, focusNodeId: node.id } : null
        })
        if (hit) return hit
      }

      const safeCeil = Math.max(
        12,
        Math.round(((series[0] ?? 0) + delta1 * Math.max(8, activeRun.stepsRun) * 1.8) * 10) / 10
      )
      const capHit = tryCandidate((cand) => {
        const rn = cand.nodes.find((x) => x.id === node.id)
        if (!rn) return null
        rn.formula = origFormula ? `min(${safeCeil}, ${origFormula})` : `min(${safeCeil}, a)`
        return { changed: true, focusNodeId: rn.id }
      })
      if (capHit) return capHit
    } else {
      // 1) 若该池自身发出了正反馈状态修正边（如复利自激 Pool --(+25%)--> Source），优先收敛正反馈增益
      for (const factor of [0.35, 0.15, 0.05]) {
        const hit = tryCandidate((cand) => {
          let modChanged = false
          let focusEdgeId: string | undefined
          for (const se of cand.edges) {
            if (se.kind === 'state' && se.from === node.id) {
              if (dampenStateModifierEdge(se, factor)) {
                modChanged = true
                focusEdgeId = se.id
              }
            }
          }
          return modChanged ? { changed: true, focusEdgeId, focusNodeId: node.id } : null
        })
        if (hit) return hit
      }

      const inResIds = doc.edges
        .filter((e) => e.kind === 'resource' && !e.targetEdgeId && e.to === node.id)
        .map((e) => e.id)

      // 2) 为入向资源边设置平滑单步流量上限 maxLimit（保留前期曲线不变，抑制后半程陡增且不触发池爆仓警告）
      if (inResIds.length > 0) {
        for (const mult of [2.0, 1.65, 1.35, 1.05, 0.8]) {
          const perEdgeCap = Math.max(1, Math.round(((delta1 * mult) / inResIds.length) * 2) / 2)
          const hit = tryCandidate((cand) => {
            let limChanged = false
            for (const eid of inResIds) {
              const ce = cand.edges.find((x) => x.id === eid)
              if (!ce) continue
              const nextLim =
                ce.maxLimit != null && ce.maxLimit > 0
                  ? Math.min(ce.maxLimit, perEdgeCap)
                  : perEdgeCap
              if (ce.maxLimit !== nextLim) {
                ce.maxLimit = nextLim
                limChanged = true
              }
            }
            return limChanged
              ? { changed: true, focusEdgeId: inResIds[0], focusNodeId: node.id }
              : null
          })
          if (hit) return hit
        }

        // 3) 渐进随步数衰减入边增速（应对前半程被门控、后半程高频触发的累积陡增）
        for (const k of [0.12, 0.25, 0.45, 0.8]) {
          const hit = tryCandidate((cand) => {
            let exprChanged = false
            for (const eid of inResIds) {
              const ce = cand.edges.find((x) => x.id === eid)
              if (!ce) continue
              const raw = (ce.formula ?? '').trim()
              const ivMatch = /^(.+?)(\s*(?:\||every\b).+)$/i.exec(raw)
              const core = ivMatch ? ivMatch[1]!.trim() : raw
              const suffix = ivMatch ? ivMatch[2]! : ''
              if (/^all$/i.test(core) || /%\s*$/.test(core)) continue
              ce.formula = `round(((${core || '1'}) / (1 + step * ${k})) * 10) / 10${suffix}`
              exprChanged = true
            }
            return exprChanged
              ? { changed: true, focusEdgeId: inResIds[0], focusNodeId: node.id }
              : null
          })
          if (hit) return hit
        }
      }

      // 4) 兜底：挂载与当前库存成比例的负反馈衰减 Drain（`round(self * rate * 10) / 10`），渐近收敛且不触碰容量上限
      for (const rate of [0.18, 0.28, 0.4, 0.55]) {
        const hit = tryCandidate((cand) => {
          const cp = cand.nodes.find((x) => x.id === node.id)
          if (!cp) return null
          const candById = new Map(cand.nodes.map((x) => [x.id, x]))
          const existingDrainEdge = cand.edges.find(
            (e) =>
              e.kind === 'resource' &&
              !e.targetEdgeId &&
              e.from === cp.id &&
              candById.get(e.to)?.kind === 'drain'
          )
          const formula = `round(self * ${rate} * 10) / 10`
          if (existingDrainEdge) {
            const dn = candById.get(existingDrainEdge.to)
            if (dn && dn.trigger === 'passive') dn.trigger = 'automatic'
            existingDrainEdge.formula = formula
            return {
              changed: true,
              focusNodeId: existingDrainEdge.to,
              focusEdgeId: existingDrainEdge.id
            }
          }
          const drainId = mxNewId('drain')
          cand.nodes.push({
            ...createMxNode('drain', cp.x + 150, cp.y + 56, sinkLabel),
            id: drainId,
            trigger: 'automatic',
            ...(cp.layerId ? { layerId: cp.layerId } : {})
          })
          const eid = mxNewId('e')
          cand.edges.push({
            id: eid,
            kind: 'resource',
            from: cp.id,
            to: drainId,
            formula
          })
          return { changed: true, focusNodeId: drainId, focusEdgeId: eid }
        })
        if (hit) return hit
      }
    }

    if (fallbackBox.best) {
      doc.nodes = fallbackBox.best.doc.nodes
      doc.edges = fallbackBox.best.doc.edges
      doc.params = fallbackBox.best.doc.params
      return fallbackBox.best.res
    }
    return { changed: false }
  }

  if (finding.kind === 'idle_node' && finding.nodeId) {
    const node = byId.get(finding.nodeId)
    if (!node) return { changed: false }
    const inEdges = doc.edges.filter((e) => !e.targetEdgeId && e.to === node.id)
    for (const ie of inEdges) {
      const src = byId.get(ie.from)
      if (src && (src.kind === 'source' || src.kind === 'converter') && src.trigger === 'passive') {
        src.trigger = 'automatic'
        return { changed: true, focusNodeId: src.id }
      }
    }
    if (node.trigger === 'passive') {
      node.trigger = 'automatic'
      return { changed: true, focusNodeId: node.id }
    }
    return { changed: false }
  }

  if (finding.kind === 'topology_error') {
    const tws = lintMxDocumentTopology(doc)
    const matched =
      tws.find(
        (w) => finding.id.includes(w.code) && (!finding.nodeId || w.nodeId === finding.nodeId)
      ) ?? tws[0]
    if (!matched) return { changed: false }
    if (matched.code === 'end_outgoing_resource' && matched.edgeId) {
      doc.edges = doc.edges.filter((e) => e.id !== matched.edgeId)
      return { changed: true, focusNodeId: matched.nodeId }
    }
    if (matched.code === 'dangling_unsigned_state_edge' && matched.edgeId) {
      const e = doc.edges.find((x) => x.id === matched.edgeId)
      if (e) {
        e.formula = `+${(e.formula ?? '1').trim()}`
        return { changed: true, focusEdgeId: e.id }
      }
    }
    if (matched.code === 'competing_auto_converters_with_auto_sell' && matched.nodeId) {
      const sellNode = byId.get(matched.nodeId)
      if (sellNode) {
        sellNode.trigger = 'interactive'
        return { changed: true, focusNodeId: sellNode.id }
      }
    }
    if (matched.code === 'hp_damage_inverted_converter' && matched.edgeId) {
      const badEdge = doc.edges.find((x) => x.id === matched.edgeId)
      if (badEdge) {
        const hpPool = byId.get(badEdge.to)
        const dmgFormula = badEdge.formula || '1'
        doc.edges = doc.edges.filter((x) => x.id !== badEdge.id)
        if (hpPool) {
          const drainId = mxNewId('drain')
          doc.nodes.push({
            ...createMxNode('drain', hpPool.x + 140, hpPool.y + 50, sinkLabel),
            id: drainId,
            trigger: 'automatic',
            ...(hpPool.layerId ? { layerId: hpPool.layerId } : {})
          })
          const eid = mxNewId('e')
          doc.edges.push({
            id: eid,
            kind: 'resource',
            from: hpPool.id,
            to: drainId,
            formula: dmgFormula
          })
          return { changed: true, focusNodeId: drainId, focusEdgeId: eid }
        }
      }
    }
  }

  return { changed: false }
}

export function applyMxDiagnosticQuickFix(
  doc: MxDocument,
  finding: MxDiagnosticFinding,
  options: MxDiagnosticQuickFixOptions = {}
): { doc: MxDocument; result: MxDiagnosticQuickFixResult } {
  const clone: MxDocument = JSON.parse(JSON.stringify(doc))
  const result = applyMxDiagnosticQuickFixInPlace(clone, finding, options)
  return { doc: clone, result }
}

/**
 * 一键批量修复当前经济图中的全部可修复警告（先修拓扑与饥饿门控，重算模拟后再按最新流量修通胀/爆仓）。
 */
export function applyAllMxDiagnosticQuickFixes(
  doc: MxDocument,
  options: MxDiagnosticQuickFixOptions = {}
): { doc: MxDocument; fixedCount: number; focusNodeId?: string; focusEdgeId?: string } {
  const clone: MxDocument = JSON.parse(JSON.stringify(doc))
  let fixedCount = 0
  let focusNodeId: string | undefined
  let focusEdgeId: string | undefined
  const visitedIds = new Set<string>()

  // 最多 4 轮迭代：先处理拓扑、转化器饥饿门控与指数失控，再基于最新模拟结果校准爆仓/通胀/枯竭
  for (let pass = 0; pass < 4; pass++) {
    const run = runMxSimulation(clone, {
      seed: options.seed ?? clone.settings.seed,
      scenarioId: options.scenarioId
    })
    const health = analyzeMxEconomyHealth(clone, run)
    const actionable = health.findings
      .filter((f) => canQuickFixMxDiagnosticFinding(f) && !visitedIds.has(`${pass}:${f.id}`))
      .sort((a, b) => {
        const order = (k: MxDiagnosticKind): number =>
          k === 'topology_error'
            ? 0
            : k === 'starved_converter'
              ? 1
              : k === 'exponential_runaway'
                ? 2
                : k === 'pool_capped'
                  ? 3
                  : k === 'inflation' || k === 'deflation'
                    ? 4
                    : 5
        return order(a.kind) - order(b.kind)
      })
    if (actionable.length === 0) break

    let passChanged = false
    for (const f of actionable) {
      visitedIds.add(`${pass}:${f.id}`)
      // 若本轮已修改过饥饿转化器或指数失控，通胀放到下一轮基于最新模拟流量再修，避免过度加 Sink
      if (passChanged && (f.kind === 'inflation' || f.kind === 'deflation')) {
        break
      }
      const res = applyMxDiagnosticQuickFixInPlace(clone, f, {
        ...options,
        run: passChanged ? undefined : run
      })
      if (res.changed) {
        fixedCount++
        passChanged = true
        if (res.focusNodeId) focusNodeId = res.focusNodeId
        if (res.focusEdgeId) focusEdgeId = res.focusEdgeId
      }
    }
    if (!passChanged) break
  }

  return { doc: clone, fixedCount, focusNodeId, focusEdgeId }
}

/**
 * 为单条诊断警告推荐最相关的待调优变量（边速率 / 初始值 / 参数）及搜索区间，供「🎯 智能调参」直达调平器。
 */
export function suggestMxBalancerTargetForFinding(
  doc: MxDocument,
  finding: MxDiagnosticFinding
): { kind: MxTunableKind; id: string; minVal: number; maxVal: number } | null {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const makeRange = (cur: number, minFloor = 0): { minVal: number; maxVal: number } => {
    const base = Math.max(1, Math.abs(cur))
    return {
      minVal: Math.max(minFloor, Math.round((cur - base * 0.8) * 10) / 10),
      maxVal: Math.max(minFloor + 5, Math.round((cur + base * 3 + 6) * 10) / 10)
    }
  }

  if (finding.kind === 'starved_converter' && finding.nodeId) {
    // 优先选喂给上游池的 Source 出边或转化器自身的消耗入边
    const inRes = doc.edges.filter(
      (e) => e.kind === 'resource' && !e.targetEdgeId && e.to === finding.nodeId
    )
    for (const ie of inRes) {
      const feeder = doc.edges.find(
        (fe) =>
          fe.kind === 'resource' && !fe.targetEdgeId && fe.to === ie.from && isSimpleNumericEdge(fe)
      )
      if (feeder) {
        const v = extractMxTunableEdgeNumericValue(feeder)
        return { kind: 'edge', id: feeder.id, ...makeRange(v, 1) }
      }
      if (isSimpleNumericEdge(ie)) {
        const v = extractMxTunableEdgeNumericValue(ie)
        return { kind: 'edge', id: ie.id, ...makeRange(v, 1) }
      }
    }
  }

  if (finding.kind === 'inflation' || finding.kind === 'deflation') {
    const drainEdge = doc.edges.find(
      (e) =>
        e.kind === 'resource' &&
        !e.targetEdgeId &&
        byId.get(e.to)?.kind === 'drain' &&
        isSimpleNumericEdge(e)
    )
    if (drainEdge) {
      const v = extractMxTunableEdgeNumericValue(drainEdge)
      return { kind: 'edge', id: drainEdge.id, ...makeRange(v, 0.5) }
    }
    const srcEdge = doc.edges.find(
      (e) =>
        e.kind === 'resource' &&
        !e.targetEdgeId &&
        byId.get(e.from)?.kind === 'source' &&
        isSimpleNumericEdge(e)
    )
    if (srcEdge) {
      const v = extractMxTunableEdgeNumericValue(srcEdge)
      return { kind: 'edge', id: srcEdge.id, ...makeRange(v, 0.5) }
    }
  }

  if (finding.kind === 'exponential_runaway' && finding.nodeId) {
    const targetNode = byId.get(finding.nodeId)
    const formulaTexts = [
      targetNode?.formula ?? '',
      ...doc.edges
        .filter((e) => e.to === finding.nodeId || e.from === finding.nodeId)
        .map((e) => e.formula ?? '')
    ].join(' ')
    for (const p of doc.params) {
      const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (esc && new RegExp(`\\b${esc}\\b`).test(formulaTexts)) {
        return { kind: 'param', id: p.name, ...makeRange(Number(p.value) || 1, 0) }
      }
    }
    const outDrain = doc.edges.find(
      (e) =>
        e.kind === 'resource' &&
        !e.targetEdgeId &&
        e.from === finding.nodeId &&
        byId.get(e.to)?.kind === 'drain' &&
        isSimpleNumericEdge(e)
    )
    if (outDrain) {
      const v = extractMxTunableEdgeNumericValue(outDrain)
      return { kind: 'edge', id: outDrain.id, ...makeRange(v, 0.5) }
    }
    const selfMod = doc.edges.find((e) => e.kind === 'state' && e.from === finding.nodeId)
    if (selfMod) {
      const sp = parseMxStateFormula(selfMod.formula)
      if (sp.type === 'modifier') {
        return { kind: 'edge', id: selfMod.id, ...makeRange(sp.delta, 0) }
      }
    }
    const inNumeric = doc.edges.find(
      (e) =>
        e.kind === 'resource' &&
        !e.targetEdgeId &&
        e.to === finding.nodeId &&
        isSimpleNumericEdge(e)
    )
    if (inNumeric) {
      const v = extractMxTunableEdgeNumericValue(inNumeric)
      return { kind: 'edge', id: inNumeric.id, ...makeRange(v, 0.5) }
    }
  }

  if (finding.kind === 'pool_depleted' && finding.nodeId) {
    const pool = byId.get(finding.nodeId)
    if (pool && (pool.kind === 'pool' || pool.kind === 'register')) {
      const cur = Number(pool.initial ?? 0)
      return {
        kind: 'node_initial',
        id: pool.id,
        minVal: Math.max(0, cur),
        maxVal: Math.max(30, cur * 3 + 20)
      }
    }
  }

  if (finding.nodeId) {
    const linkedEdge = doc.edges.find(
      (e) =>
        !e.targetEdgeId &&
        (e.to === finding.nodeId || e.from === finding.nodeId) &&
        isSimpleNumericEdge(e)
    )
    if (linkedEdge) {
      const v = extractMxTunableEdgeNumericValue(linkedEdge)
      return { kind: 'edge', id: linkedEdge.id, ...makeRange(v, 0.5) }
    }
  }

  if (doc.params.length > 0) {
    const p = doc.params[0]!
    return { kind: 'param', id: p.name, ...makeRange(Number(p.value) || 1, 0) }
  }
  const firstEdge = doc.edges.find((e) => !e.targetEdgeId && isSimpleNumericEdge(e))
  if (firstEdge) {
    const v = extractMxTunableEdgeNumericValue(firstEdge)
    return { kind: 'edge', id: firstEdge.id, ...makeRange(v, 0.5) }
  }
  return null
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
    trigger: kind === 'source' ? 'automatic' : 'passive',
    layerId: 'layer_base'
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
  const seenLayerIds = new Set<string>()
  const layers: MxLayer[] = []
  for (const [idx, l] of (Array.isArray(r.layers) && r.layers.length
    ? r.layers
    : base.layers
  ).entries()) {
    let lid = typeof l?.id === 'string' && l.id.trim() ? l.id.trim() : `ly_${idx + 1}`
    if (seenLayerIds.has(lid)) lid = `${lid}_${idx + 1}`
    seenLayerIds.add(lid)
    layers.push({
      id: lid,
      name: typeof l?.name === 'string' && l.name.trim() ? l.name.trim() : `Layer ${idx + 1}`,
      visible: l?.visible !== false,
      locked: Boolean(l?.locked)
    })
  }
  let baseLayer = layers.find(
    (l) => l.id === 'layer_base' || l.name.trim().toLowerCase() === 'base'
  )
  if (!baseLayer) {
    baseLayer = { id: 'layer_base', name: 'Base', visible: true, locked: false }
    layers.unshift(baseLayer)
    seenLayerIds.add(baseLayer.id)
  }
  const baseLayerId = baseLayer.id

  const resolveOrCreateLayerId = (rawRef: unknown, fallbackToBase: boolean): string | undefined => {
    const rawStr = typeof rawRef === 'string' ? rawRef.trim() : ''
    if (!rawStr) return fallbackToBase ? baseLayerId : undefined
    const byId = layers.find((l) => l.id === rawStr)
    if (byId) return byId.id
    const lower = rawStr.toLowerCase()
    const byName = layers.find((l) => l.name.trim().toLowerCase() === lower)
    if (byName) return byName.id
    const looksLikeId = /^(?:ly|layer)_[a-z0-9_]+$/i.test(rawStr)
    const slug = rawStr
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
    let newId = looksLikeId ? rawStr : `ly_${slug || layers.length + 1}`
    let suffix = 2
    while (seenLayerIds.has(newId)) {
      newId = `${looksLikeId ? rawStr : `ly_${slug || 'cat'}`}_${suffix++}`
    }
    seenLayerIds.add(newId)
    const newName = looksLikeId
      ? rawStr.replace(/^(?:ly|layer)_/i, '').replace(/_/g, ' ') || rawStr
      : rawStr
    layers.push({
      id: newId,
      name: newName,
      visible: true,
      locked: false
    })
    return newId
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
      const rawLayerRef = n.layerId ?? n.layer ?? n.layerName ?? n.category ?? n.subsystem
      return {
        ...(n as unknown as MxNode),
        id,
        kind: resolvedKind,
        label: String(n.label ?? n.name ?? n.title ?? id),
        x: Number.isFinite(n.x) ? Number(n.x) : 0,
        y: Number.isFinite(n.y) ? Number(n.y) : 0,
        trigger: explicitTrig ?? defaultTrig,
        layerId: resolveOrCreateLayerId(rawLayerRef, true) ?? baseLayerId,
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
    .map((g) => {
      const gRec = g as unknown as Record<string, unknown>
      const rawGrpLayer =
        gRec.layerId ?? gRec.layer ?? gRec.layerName ?? gRec.category ?? gRec.subsystem
      const resolvedGrpLayerId = resolveOrCreateLayerId(rawGrpLayer, false)
      return {
        id: g.id,
        label: String(g.label ?? 'Group'),
        x: Number.isFinite(g.x) ? g.x : 100,
        y: Number.isFinite(g.y) ? g.y : 100,
        width: Math.max(80, Number.isFinite(g.width) ? g.width : 260),
        height: Math.max(60, Number.isFinite(g.height) ? g.height : 180),
        color: g.color || '#3b82f6',
        ...(resolvedGrpLayerId ? { layerId: resolvedGrpLayerId } : {})
      }
    })
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
  const isXianxiaLifespanDoc =
    r.templateId === 'xianxia_lifespan_alchemy' ||
    String(r.title ?? '').includes('山海借命录') || // cjk-ok
    nodes.some(
      (n) =>
        n.label.includes('沈砚') || // cjk-ok
        n.label.includes('残缺药经') || // cjk-ok
        n.label.includes('宗门寿元契约') || // cjk-ok
        n.label.includes('借命契') // cjk-ok
    )

  const hasLegacyXianxiaEdges =
    isXianxiaLifespanDoc &&
    (nodes.length <= 8 ||
      edges.some(
        (e) =>
          e.id === 'e_lifespan_to_upkeep' ||
          e.id === 'e_cult_to_poison' ||
          e.formula.includes('Cost_50_1_18_N') ||
          e.formula.includes('min(120')
      ))

  if (hasLegacyXianxiaEdges) {
    const upgraded = createMxTemplate(
      'xianxia_lifespan_alchemy',
      String(r.title ?? '').trim() || undefined
    )
    if (r.description) upgraded.description = r.description
    if (Number(r.settings?.steps) > 20) {
      upgraded.settings.steps = Math.max(1, Math.min(2000, Number(r.settings?.steps)))
    }
    return upgraded
  }

  const normalizedSteps = Math.max(1, Math.min(2000, Number(r.settings?.steps ?? 20)))
  let normalizedWb = r.workbench ? normalizeMxNumericalWorkbench(r.workbench) : undefined
  if (isXianxiaLifespanDoc) {
    const existingLvMax = normalizedWb?.roguelikeEnvelope?.levelMax ?? 80
    if (
      !normalizedWb ||
      normalizedWb.activePresetId === 'slay_the_spire_dbg' ||
      existingLvMax <= 80 ||
      !normalizedWb.multiplier?.title?.includes('山海借命录') // cjk-ok
    ) {
      const targetLvMax = existingLvMax > 80 ? existingLvMax : Math.max(200, normalizedSteps)
      normalizedWb = createXianxia200LifespanWorkbench()
      normalizedWb.roguelikeEnvelope.levelMax = targetLvMax
    }
  } else if (
    normalizedWb &&
    normalizedSteps >= 100 &&
    (normalizedWb.roguelikeEnvelope.levelMax ?? 80) === 80
  ) {
    normalizedWb = {
      ...normalizedWb,
      roguelikeEnvelope: {
        ...normalizedWb.roguelikeEnvelope,
        levelMax: normalizedSteps
      }
    }
  }

  const resolvedResources =
    Array.isArray(r.resources) && r.resources.length ? r.resources : base.resources
  const validResourceIds = new Set(resolvedResources.map((res) => res.id))
  for (const n of nodes) {
    if (n.resourceId) validResourceIds.add(n.resourceId)
  }
  for (const e of edges) {
    if (!e.resourceFilter && e.resourceId) validResourceIds.add(e.resourceId)
  }
  for (const e of edges) {
    if (e.resourceFilter && e.resourceId && !validResourceIds.has(e.resourceId)) {
      e.resourceFilter = false
      delete e.resourceId
    }
  }

  return {
    schema: 'mx@2',
    title: String(r.title ?? base.title),
    description: r.description,
    templateId: isXianxiaLifespanDoc ? 'xianxia_lifespan_alchemy' : r.templateId,
    resources: resolvedResources,
    params: Array.isArray(r.params) ? r.params : [],
    scenarios: Array.isArray(r.scenarios) ? r.scenarios : [],
    activeScenarioId: r.activeScenarioId,
    layers,
    nodes,
    edges,
    groups,
    agents,
    clips: Array.isArray(r.clips) ? r.clips : [],
    history: Array.isArray(r.history) ? r.history.slice(-15) : [],
    settings: {
      steps: isXianxiaLifespanDoc && normalizedSteps < 200 ? 200 : normalizedSteps,
      runs: Math.max(1, Math.min(1000, Number(r.settings?.runs ?? 50))),
      seed: Math.floor(Number(r.settings?.seed ?? 2026)),
      speed: Math.max(0.25, Math.min(8, Number(r.settings?.speed ?? 1))),
      actionMode: r.settings?.actionMode === 'turn_based' ? 'turn_based' : 'simultaneous',
      botMode:
        r.settings?.botMode === 'greedy' || r.settings?.botMode === 'smart'
          ? r.settings.botMode
          : 'off'
    },
    ...(normalizedWb ? { workbench: normalizedWb } : {})
  }
}

/**
 * 自动按拓扑层级从左向右整理排版所有节点（Sugiyama 风格分层布局；多图层文档自动启用横向分类泳道排版并对齐分组框）。
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

  const baseLayerId =
    doc.layers.find((l) => l.id === 'layer_base' || l.name.trim().toLowerCase() === 'base')?.id ??
    doc.layers[0]?.id ??
    'layer_base'
  const nodesByLayer = new Map<string, MxNode[]>()
  for (const n of mainNodes) {
    const lid = n.layerId || baseLayerId
    const list = nodesByLayer.get(lid) ?? []
    list.push(n)
    nodesByLayer.set(lid, list)
  }

  const orderedLayerIds: string[] = []
  for (const l of doc.layers) {
    if (nodesByLayer.has(l.id)) orderedLayerIds.push(l.id)
  }
  for (const lid of nodesByLayer.keys()) {
    if (!orderedLayerIds.includes(lid)) orderedLayerIds.push(lid)
  }

  if (orderedLayerIds.length >= 2) {
    const startX = 180
    const gapX = 185
    const gapY = 115
    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f43f5e']
    let currentTopY = notes.length ? 150 : 90
    const shouldAutoCreateGroups = !doc.groups || doc.groups.length === 0
    if (shouldAutoCreateGroups) doc.groups = []

    orderedLayerIds.forEach((lid, layerIdx) => {
      const layerNodes = nodesByLayer.get(lid)!
      const cols = new Map<number, MxNode[]>()
      for (const n of layerNodes) {
        const col = rank.get(n.id) ?? 0
        const arr = cols.get(col) ?? []
        arr.push(n)
        cols.set(col, arr)
      }
      const sortedCols = [...cols.keys()].sort((a, b) => a - b)
      const maxRows = Math.max(1, ...sortedCols.map((c) => cols.get(c)!.length))
      const bandInnerH = (maxRows - 1) * gapY
      const centerY = currentTopY + 62 + bandInnerH / 2

      sortedCols.forEach((colKey, colIdx) => {
        const list = cols.get(colKey)!
        list.sort((a, b) => a.y - b.y)
        const totalH = (list.length - 1) * gapY
        list.forEach((node, rowIdx) => {
          node.x = Math.round(startX + colIdx * gapX)
          node.y = Math.round(centerY - totalH / 2 + rowIdx * gapY)
        })
      })

      const minX = Math.min(...layerNodes.map((n) => n.x))
      const maxX = Math.max(...layerNodes.map((n) => n.x))
      const minY = Math.min(...layerNodes.map((n) => n.y))
      const maxY = Math.max(...layerNodes.map((n) => n.y))
      const grpX = Math.round(minX - 80)
      const grpY = Math.round(minY - 62)
      const grpW = Math.max(340, Math.round(maxX - minX + 160))
      const grpH = Math.max(145, Math.round(maxY - minY + 125))

      const existingGrp = doc.groups?.find((g) => g.layerId === lid)
      if (existingGrp) {
        existingGrp.x = grpX
        existingGrp.y = grpY
        existingGrp.width = grpW
        existingGrp.height = grpH
      } else if (shouldAutoCreateGroups) {
        const layerMeta = doc.layers.find((l) => l.id === lid)
        doc.groups!.push({
          id: `grp_${lid}`,
          label: layerMeta?.name || lid,
          x: grpX,
          y: grpY,
          width: grpW,
          height: grpH,
          color: palette[layerIdx % palette.length]!,
          layerId: lid
        })
      }

      currentTopY = grpY + grpH + 42
    })

    notes.forEach((nt, idx) => {
      nt.x = startX + idx * 220
      nt.y = 65
    })
    return
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
  | 'xianxia_lifespan_alchemy'

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
    nameEn: 'Tower Defense: 20-Wave Obstacles, Multi-Tower Synergy & Base Defense',
    nameZh:
      '\u7b56\u7565\u5854\u9632\uff1a20\u6ce2\u6e05\u969c\u8d4f\u91d1\u3001\u5f02\u6784\u5854\u9632\u5347\u7ea7\u4e0e\u57fa\u5730\u9632\u7ebf',
    descEn:
      'Multi-layer wave scaling, obstacle clearing, arrow/mage tower build & upgrades, tactical sell, leak HP drain, and win/loss finale.',
    descZh:
      '\u4e94\u56fe\u5c42\u6ce2\u6b21\u9012\u589e\u3001\u573a\u5730\u6e05\u969c\u7206\u91d1\u3001\u5355\u4f53/\u7fa4\u4f24\u5efa\u5854\u5347\u7ea7\u3001\u6f0f\u602a\u6263\u8840\u4e0e20\u6ce2\u80dc\u8d1f\u7ec8\u5c40',
    workbenchPreset: 'survivor_brotato'
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
  },
  {
    id: 'xianxia_lifespan_alchemy',
    key: 'xianxiaLifespan',
    category: 'rpg',
    nameEn:
      'Xianxia 200-Ch Full Lifecycle: Herb Alchemy, Black Market, Lifespan Contract & 4-Volume Reckoning',
    nameZh:
      '📜《山海借命录 / 凡人仙侠》200章四象限全生命周期经济系统（采药炼丹·黑市置换·借命契剥削·四卷破契清算）', // cjk-ok
    descEn:
      '4-subsystem 23-node closed-loop economy: cliff herb gathering, sect bounty, black market trading, medicine canon alchemy, realm breakthrough, sect lifespan contract exploitation, and 4-volume boss reckoning.',
    descZh:
      '四象限23节点完整经济闭环：断魂崖采药与外门悬赏、黑市药石置换、残缺药经炼丹与成丹率分流、太虚引气破境、青岚宗借命契剥削与丹毒反噬、寒门同盟与四卷破契总清算', // cjk-ok
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

function assignDefaultCategoryLayersToTemplate(doc: MxDocument): MxDocument {
  if (!doc.layers.some((l) => l.id === 'layer_base' || l.name.trim().toLowerCase() === 'base')) {
    doc.layers.unshift({ id: 'layer_base', name: 'Base', visible: true, locked: false })
  }
  const populatedLayers = new Set(doc.nodes.map((n) => n.layerId).filter(Boolean))
  if (doc.layers.length > 1 && populatedLayers.size > 1) {
    return doc
  }
  if (doc.nodes.length < 5) {
    return doc
  }
  const faucetNodes = doc.nodes.filter((n) => n.kind === 'source')
  const sinkEndNodes = doc.nodes.filter((n) => n.kind === 'drain' || n.kind === 'end')
  const coreNodes = doc.nodes.filter(
    (n) => n.kind !== 'source' && n.kind !== 'drain' && n.kind !== 'end'
  )
  const nextLayers: MxLayer[] = [{ id: 'layer_base', name: 'Base', visible: true, locked: false }]
  if (faucetNodes.length) {
    nextLayers.push({
      id: 'ly_faucet',
      name: '产出与资源供给 (Faucets)', // cjk-ok
      visible: true,
      locked: false
    })
    for (const n of faucetNodes) n.layerId = 'ly_faucet'
  }
  if (coreNodes.length) {
    nextLayers.push({
      id: 'ly_core_loop',
      name: '核心池与转化机制 (Core Loop)', // cjk-ok
      visible: true,
      locked: false
    })
    for (const n of coreNodes) n.layerId = 'ly_core_loop'
  }
  if (sinkEndNodes.length) {
    nextLayers.push({
      id: 'ly_sink_goal',
      name: '消耗回收与终局判定 (Sinks & Finale)', // cjk-ok
      visible: true,
      locked: false
    })
    for (const n of sinkEndNodes) n.layerId = 'ly_sink_goal'
  }
  doc.layers = nextLayers
  return doc
}

/** 创建模板文档 */
export function createMxTemplate(id: MxTemplateId, title?: string): MxDocument {
  const v1Ids: MachinationsPresetId[] = [
    'arpg_equipment_economy',
    'gacha_pity_banner',
    'idle_exponential_tycoon',
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
    return assignDefaultCategoryLayersToTemplate(doc)
  }
  const doc = createEmptyMxDocument(title)
  doc.templateId = id
  const meta = MX_TEMPLATES.find((t) => t.id === id)
  if (meta?.workbenchPreset) {
    doc.workbench = createMxWorkbenchPreset(meta.workbenchPreset)
  }
  switch (id) {
    case 'roguelike_mana_deck': {
      doc.title =
        title ||
        '《杀戮尖塔》完整玩法机制：能量回合·抽弃洗消耗牌库·异构卡牌与力量易伤乘区·护甲格挡与Boss意图·遗物经济' // cjk-ok
      doc.description =
        '按五大玩法子系统分图层构建的完整 DBG 卡牌构筑动力学模型：覆盖每回合能量补给与清空、抽牌堆→手牌→弃牌堆→洗牌重抽与能力牌消耗（Exhaust）守恒闭环、打击/重锤/能力/防御异构出牌、力量（Strength）与易伤（Vulnerable 1.5x）乘区寄存器、护甲格挡衰减与 Boss 多段递增意图破盾伤血、爬塔金币商店遗物提纯及胜负双终局。' // cjk-ok
      doc.layers = [
        { id: 'layer_base', name: 'Base', visible: true, locked: false },
        {
          id: 'ly_turn_energy',
          name: '回合与能量系统 (Turn & Energy)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_deck_cycle',
          name: '牌库抽弃洗与消耗循环 (Deck Cycle)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_card_combo',
          name: '异构卡牌与力量易伤乘区 (Cards & Buffs)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_block_boss',
          name: '护甲格挡与Boss意图反击 (Block & Boss)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_meta_end',
          name: '遗物商店经济与胜负终局 (Relics & Finale)', // cjk-ok
          visible: true,
          locked: false
        }
      ]
      doc.resources = [
        { id: 'energy', name: '回合能量 (Energy)', color: '#38bdf8' }, // cjk-ok
        { id: 'card', name: '构筑卡牌 (Cards)', color: '#a855f7' }, // cjk-ok
        { id: 'dmg', name: '战斗伤害 (Damage)', color: '#f59e0b' }, // cjk-ok
        { id: 'block', name: '护甲格挡 (Block)', color: '#3b82f6' }, // cjk-ok
        { id: 'buff', name: '力量/易伤层数 (Buffs)', color: '#ec4899' }, // cjk-ok
        { id: 'hp', name: '角色生命 (Player HP)', color: '#ef4444' }, // cjk-ok
        { id: 'gold', name: '爬塔金币 (Gold)', color: '#10b981' } // cjk-ok
      ]
      doc.params = [
        { id: 'p_energy', name: 'TurnEnergy', value: 3 },
        { id: 'p_draw', name: 'TurnDraw', value: 5 },
        { id: 'p_strike', name: 'BaseStrike', value: 6 },
        { id: 'p_bash', name: 'BaseBash', value: 8 },
        { id: 'p_block', name: 'BaseBlock', value: 6 },
        { id: 'p_boss', name: 'BossBaseAtk', value: 10 }
      ]
      doc.scenarios = [
        {
          id: 'sc_asc0',
          name: '标准进阶0·铁甲战士 (Ascension 0)', // cjk-ok
          params: {
            TurnEnergy: 3,
            TurnDraw: 5,
            BaseStrike: 6,
            BaseBash: 8,
            BaseBlock: 6,
            BossBaseAtk: 10
          }
        },
        {
          id: 'sc_str_limit',
          name: '突破极限·高力量遗物成型流', // cjk-ok
          params: {
            TurnEnergy: 4,
            TurnDraw: 5,
            BaseStrike: 9,
            BaseBash: 12,
            BaseBlock: 7,
            BossBaseAtk: 11
          }
        },
        {
          id: 'sc_asc20_heart',
          name: '进阶20·关底高伤高压测试', // cjk-ok
          params: {
            TurnEnergy: 3,
            TurnDraw: 5,
            BaseStrike: 6,
            BaseBash: 8,
            BaseBlock: 5,
            BossBaseAtk: 15
          }
        }
      ]
      doc.groups = [
        {
          id: 'grp_sts_energy',
          label: '图层 1：回合开始能量补给、Boss遗物回能与残余清空 (Turn & Energy)', // cjk-ok
          x: 40,
          y: 40,
          width: 570,
          height: 250,
          color: '#38bdf8',
          layerId: 'ly_turn_energy'
        },
        {
          id: 'grp_sts_deck',
          label: '图层 2：抽牌堆 → 手牌 → 弃牌堆 → 空库洗牌与能力牌消耗守恒 (Deck Cycle)', // cjk-ok
          x: 640,
          y: 40,
          width: 680,
          height: 250,
          color: '#a855f7',
          layerId: 'ly_deck_cycle'
        },
        {
          id: 'grp_sts_combo',
          label:
            '图层 3：异构卡牌出牌（打击/重锤/能力）与力量×易伤 1.5x 乘区 (Cards & Multipliers)', // cjk-ok
          x: 40,
          y: 325,
          width: 780,
          height: 280,
          color: '#f59e0b',
          layerId: 'ly_card_combo'
        },
        {
          id: 'grp_sts_block_boss',
          label: '图层 4：防御牌叠甲、下回合护甲衰减与 Boss 递增意图破盾伤血 (Block & Boss Intent)', // cjk-ok
          x: 850,
          y: 325,
          width: 470,
          height: 280,
          color: '#3b82f6',
          layerId: 'ly_block_boss'
        },
        {
          id: 'grp_sts_meta_end',
          label: '图层 5：战斗赏金、商店删牌/遗物提纯与斩杀/阵亡双终局 (Relics, Shop & Finale)', // cjk-ok
          x: 40,
          y: 640,
          width: 1280,
          height: 200,
          color: '#10b981',
          layerId: 'ly_meta_end'
        }
      ]
      doc.nodes = [
        // ── 图层 1：回合与能量系统 (ly_turn_energy) ──
        nd('turn_energy_src', 'source', /* cjk-ok */ '回合开始恢复 (+3能量)', 130, 120, {
          resourceId: 'energy',
          layerId: 'ly_turn_energy',
          color: '#38bdf8'
        }),
        nd('relic_energy_src', 'source', /* cjk-ok */ '能量遗物额外补给 (+1)', 130, 225, {
          resourceId: 'energy',
          layerId: 'ly_turn_energy',
          color: '#0ea5e9'
        }),
        nd('energy_pool', 'pool', /* cjk-ok */ '当前能量池 (Energy)', 335, 170, {
          resourceId: 'energy',
          initial: 5,
          capacity: 8,
          layerId: 'ly_turn_energy',
          color: '#38bdf8'
        }),
        nd('energy_flush', 'drain', /* cjk-ok */ '回合末溢出能量清空', 520, 170, {
          trigger: 'automatic',
          layerId: 'ly_turn_energy',
          color: '#64748b'
        }),

        // ── 图层 2：牌库抽弃洗与消耗循环 (ly_deck_cycle) ──
        nd('draw_pile', 'pool', /* cjk-ok */ '抽牌堆 (Draw Pile)', 725, 120, {
          resourceId: 'card',
          initial: 10,
          capacity: 30,
          layerId: 'ly_deck_cycle',
          color: '#a855f7'
        }),
        nd('turn_draw_conv', 'converter', /* cjk-ok */ '每回合抽牌 (Draw)', 895, 120, {
          resourceId: 'card',
          trigger: 'automatic',
          layerId: 'ly_deck_cycle',
          color: '#c084fc'
        }),
        nd('hand_pool', 'pool', /* cjk-ok */ '手牌区 (Hand Max 10)', 1070, 120, {
          resourceId: 'card',
          initial: 5,
          capacity: 10,
          layerId: 'ly_deck_cycle',
          color: '#a855f7'
        }),
        nd('discard_pile', 'pool', /* cjk-ok */ '弃牌堆 (Discard Pile)', 1070, 225, {
          resourceId: 'card',
          initial: 4,
          capacity: 30,
          layerId: 'ly_deck_cycle',
          color: '#8b5cf6'
        }),
        nd('reshuffle_conv', 'converter', /* cjk-ok */ '空库洗牌重抽 (Reshuffle)', 860, 225, {
          resourceId: 'card',
          trigger: 'automatic',
          layerId: 'ly_deck_cycle',
          color: '#7c3aed'
        }),
        nd('exhaust_pile', 'pool', /* cjk-ok */ '消耗堆 (Exhaust)', 1235, 170, {
          resourceId: 'card',
          initial: 0,
          capacity: 20,
          layerId: 'ly_deck_cycle',
          color: '#f43f5e'
        }),

        // ── 图层 3：异构卡牌与力量易伤乘区 (ly_card_combo) ──
        nd('play_strike', 'converter', /* cjk-ok */ '打出1费攻击牌 (Strike)', 150, 405, {
          resourceId: 'dmg',
          trigger: 'automatic',
          layerId: 'ly_card_combo',
          color: '#f59e0b'
        }),
        nd('play_bash', 'converter', /* cjk-ok */ '打出2费痛击·挂易伤 (Bash)', 150, 525, {
          resourceId: 'dmg',
          trigger: 'automatic',
          layerId: 'ly_card_combo',
          color: '#ea580c'
        }),
        nd('play_power', 'converter', /* cjk-ok */ '打出能力牌·燃烧 (Exhaust)', 365, 405, {
          resourceId: 'buff',
          trigger: 'automatic',
          layerId: 'ly_card_combo',
          color: '#ec4899'
        }),
        nd('strength_pool', 'pool', /* cjk-ok */ '力量层数 (Strength)', 560, 405, {
          resourceId: 'buff',
          initial: 2,
          capacity: 30,
          layerId: 'ly_card_combo',
          color: '#ec4899'
        }),
        nd('vuln_pool', 'pool', /* cjk-ok */ '敌方易伤层数 (Vulnerable)', 365, 525, {
          resourceId: 'buff',
          initial: 1,
          capacity: 12,
          layerId: 'ly_card_combo',
          color: '#f43f5e'
        }),
        nd('vuln_decay', 'drain', /* cjk-ok */ '回合末易伤层数衰减 (-1)', 560, 525, {
          trigger: 'automatic',
          layerId: 'ly_card_combo',
          color: '#fb7185'
        }),
        nd('dmg_mult_reg', 'register', /* cjk-ok */ '单卡伤害结算 (攻+力)×易伤1.5x', 725, 465, {
          formula: 'round((BaseStrike + strength_pool) * if(vuln_pool > 0, 1.5, 1))',
          layerId: 'ly_card_combo',
          color: '#f59e0b'
        }),

        // ── 图层 4：护甲格挡与 Boss 意图反击 (ly_block_boss) ──
        nd('play_defend', 'converter', /* cjk-ok */ '打出1费防御牌 (Defend)', 935, 405, {
          resourceId: 'block',
          trigger: 'automatic',
          layerId: 'ly_block_boss',
          color: '#3b82f6'
        }),
        nd('block_pool', 'pool', /* cjk-ok */ '当前护甲池 (Block)', 1090, 405, {
          resourceId: 'block',
          initial: 6,
          capacity: 99,
          layerId: 'ly_block_boss',
          color: '#3b82f6'
        }),
        nd('block_decay', 'drain', /* cjk-ok */ '回合开始护甲清空衰减', 1240, 405, {
          trigger: 'automatic',
          layerId: 'ly_block_boss',
          color: '#60a5fa'
        }),
        nd('boss_intent_reg', 'register', /* cjk-ok */ 'Boss多段意图攻击曲线', 935, 525, {
          formula: 'round(BossBaseAtk + step * 0.75)',
          layerId: 'ly_block_boss',
          color: '#ef4444'
        }),
        nd('player_hp', 'pool', /* cjk-ok */ '玩家生命值 (HP 80)', 1090, 525, {
          resourceId: 'hp',
          initial: 80,
          capacity: 80,
          layerId: 'ly_block_boss',
          color: '#ef4444'
        }),
        nd('boss_unblocked_drain', 'drain', /* cjk-ok */ 'Boss破盾贯通扣血', 1240, 525, {
          trigger: 'automatic',
          layerId: 'ly_block_boss',
          color: '#dc2626'
        }),

        // ── 图层 5：遗物商店经济与胜负终局 (ly_meta_end) ──
        nd('combat_gold_src', 'source', /* cjk-ok */ '爬塔战斗赏金产出', 150, 745, {
          resourceId: 'gold',
          layerId: 'ly_meta_end',
          color: '#10b981'
        }),
        nd('gold_pool', 'pool', /* cjk-ok */ '爬塔金币袋 (Gold)', 355, 745, {
          resourceId: 'gold',
          initial: 60,
          capacity: 999,
          layerId: 'ly_meta_end',
          color: '#10b981'
        }),
        nd('shop_relic_conv', 'converter', /* cjk-ok */ '商店购遗物/删牌提纯 (75G)', 565, 745, {
          resourceId: 'buff',
          trigger: 'automatic',
          layerId: 'ly_meta_end',
          color: '#14b8a6'
        }),
        nd('boss_dmg', 'pool', /* cjk-ok */ 'Boss累计承受伤害 (HP 320)', 835, 745, {
          resourceId: 'dmg',
          initial: 0,
          capacity: 9999,
          layerId: 'ly_meta_end',
          color: '#f59e0b'
        }),
        nd('boss_slain', 'end', /* cjk-ok */ '胜利终局: 斩杀关底Boss (>=320)', 1060, 745, {
          formula: 'a >= 320',
          layerId: 'ly_meta_end',
          color: '#22c55e'
        }),
        nd('player_dead', 'end', /* cjk-ok */ '败局红线: 角色阵亡 (HP<=0)', 1235, 745, {
          formula: 'a <= 0',
          layerId: 'ly_meta_end',
          color: '#ef4444'
        })
      ]
      doc.edges = [
        // 图层 1：能量恢复与残余清空
        ed('e_turn_energy', 'resource', 'turn_energy_src', 'energy_pool', 'TurnEnergy'),
        ed('e_relic_energy', 'resource', 'relic_energy_src', 'energy_pool', '1'),
        ed(
          'e_energy_flush',
          'resource',
          'energy_pool',
          'energy_flush',
          'if(energy_pool >= 6, 1, 0)'
        ),

        // 图层 2：抽牌、弃牌洗回与守恒激活门控
        ed('e_draw_gate', 'state', 'draw_pile', 'turn_draw_conv', '>=3'),
        ed('e_draw_pull', 'resource', 'draw_pile', 'turn_draw_conv', '3'),
        ed('e_draw_push', 'resource', 'turn_draw_conv', 'hand_pool', '3'),
        ed('e_reshuffle_gate', 'state', 'discard_pile', 'reshuffle_conv', '>=4'),
        ed('e_reshuffle_pull', 'resource', 'discard_pile', 'reshuffle_conv', '4'),
        ed('e_reshuffle_push', 'resource', 'reshuffle_conv', 'draw_pile', '4'),

        // 图层 3：异构出牌（打击 / 2费痛击挂易伤 / 能力牌消耗叠力量）与乘区结算
        ed('e_strike_act_e', 'state', 'energy_pool', 'play_strike', '>=1'),
        ed('e_strike_act_h', 'state', 'hand_pool', 'play_strike', '>=1'),
        ed('e_strike_cost_e', 'resource', 'energy_pool', 'play_strike', '1'),
        ed('e_strike_cost_c', 'resource', 'hand_pool', 'play_strike', '1'),
        ed('e_strike_discard', 'resource', 'play_strike', 'discard_pile', '1'),
        ed('e_strike_dmg', 'resource', 'play_strike', 'boss_dmg', 'dmg_mult_reg'),

        ed('e_bash_act_e', 'state', 'energy_pool', 'play_bash', '>=2'),
        ed('e_bash_act_h', 'state', 'hand_pool', 'play_bash', '>=2'),
        ed('e_bash_cost_e', 'resource', 'energy_pool', 'play_bash', '2'),
        ed('e_bash_cost_c', 'resource', 'hand_pool', 'play_bash', '1'),
        ed('e_bash_discard', 'resource', 'play_bash', 'discard_pile', '1'),
        ed('e_bash_vuln', 'resource', 'play_bash', 'vuln_pool', '2'),
        ed(
          'e_bash_dmg',
          'resource',
          'play_bash',
          'boss_dmg',
          'round((BaseBash + strength_pool) * if(vuln_pool > 0, 1.5, 1))'
        ),

        ed('e_power_cap', 'state', 'exhaust_pile', 'play_power', '<3'),
        ed('e_power_act_e', 'state', 'energy_pool', 'play_power', '>=2'),
        ed('e_power_act_h', 'state', 'hand_pool', 'play_power', '>=2'),
        ed('e_power_cost_e', 'resource', 'energy_pool', 'play_power', '1'),
        ed('e_power_cost_c', 'resource', 'hand_pool', 'play_power', '1'),
        ed('e_power_exhaust', 'resource', 'play_power', 'exhaust_pile', '1'),
        ed('e_power_str', 'resource', 'play_power', 'strength_pool', '2'),

        ed('e_vuln_decay', 'resource', 'vuln_pool', 'vuln_decay', 'if(vuln_pool > 0, 1, 0)'),
        ed('e_str_to_reg', 'state', 'strength_pool', 'dmg_mult_reg', '+1'),
        ed('e_vuln_to_reg', 'state', 'vuln_pool', 'dmg_mult_reg', '+1'),

        // 图层 4：防御牌叠甲、护甲衰减与 Boss 破盾结算
        ed('e_def_act_e', 'state', 'energy_pool', 'play_defend', '>=1'),
        ed('e_def_act_h', 'state', 'hand_pool', 'play_defend', '>=1'),
        ed('e_def_cost_e', 'resource', 'energy_pool', 'play_defend', '1'),
        ed('e_def_cost_c', 'resource', 'hand_pool', 'play_defend', '1'),
        ed('e_def_discard', 'resource', 'play_defend', 'discard_pile', '1'),
        ed('e_def_block', 'resource', 'play_defend', 'block_pool', 'BaseBlock'),
        ed('e_block_decay', 'resource', 'block_pool', 'block_decay', 'min(block_pool, 4)'),
        ed(
          'e_boss_pierce',
          'resource',
          'player_hp',
          'boss_unblocked_drain',
          'max(1, round(boss_intent_reg - block_pool * 0.75))'
        ),

        // 图层 5：战斗赏金、商店遗物提纯与双终局判定
        ed('e_gold_loot', 'resource', 'combat_gold_src', 'gold_pool', '18'),
        ed('e_shop_act', 'state', 'gold_pool', 'shop_relic_conv', '>=75'),
        ed('e_shop_cost', 'resource', 'gold_pool', 'shop_relic_conv', '75'),
        ed('e_shop_str', 'resource', 'shop_relic_conv', 'strength_pool', '1'),
        ed('e_shop_heal', 'resource', 'shop_relic_conv', 'player_hp', '5'),
        ed('e_win_boss', 'state', 'boss_dmg', 'boss_slain', '>=320'),
        ed('e_lose_hp', 'state', 'player_hp', 'player_dead', '<=0')
      ]
      doc.settings.steps = 25
      doc.settings.runs = 50
      break
    }
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
      doc.title =
        title || '策略塔防完整玩法机制：20波敌潮·清障赏金·异构建塔与火力升级·基地扣血与终局结算' // cjk-ok
      doc.description =
        '按五大塔防子系统分图层构建的 20 波策略塔防动力学闭环：覆盖波次计数与每 5 波精英潮强度寄存器、击杀赏金与地图障碍物清理（额外爆金币并解锁建塔空位）、箭塔/法师塔异构建造与条件紧急拆塔折旧、科技等级递增强化与防线总 DPS 结算、未击杀残余怪物经 Drain 扣减基地生命（绝不反向加血）、单局体力入场门控及 20 波通关/破防双终局。' // cjk-ok
      doc.layers = [
        { id: 'layer_base', name: 'Base', visible: true, locked: false },
        {
          id: 'ly_wave_enemy',
          name: '波次推进与敌潮压力 (Waves & Enemy Tide)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_gold_map',
          name: '赏金经济与场地清障 (Gold & Map Clearing)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_tower_build',
          name: '异构建塔与战术拆塔 (Towers & Build Slots)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_combat_upg',
          name: '火力升级与防线清怪 (Upgrades & Defense DPS)', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_meta_finale',
          name: '基地生命、单局结算与胜负终局 (Base HP & Finale)', // cjk-ok
          visible: true,
          locked: false
        }
      ]
      doc.resources = [
        { id: 'gold', name: '战术金币 (Gold)', color: '#f59e0b' }, // cjk-ok
        { id: 'slot', name: '建塔空位 (Build Slots)', color: '#10b981' }, // cjk-ok
        { id: 'tower', name: '防御塔与科技 (Towers)', color: '#3b82f6' }, // cjk-ok
        { id: 'enemy', name: '敌潮兵力 (Enemies)', color: '#a855f7' }, // cjk-ok
        { id: 'lives', name: '基地生命 (Base HP)', color: '#ef4444' }, // cjk-ok
        { id: 'meta', name: '体力与局外科技 (Meta Tech)', color: '#06b6d4' } // cjk-ok
      ]
      doc.params = [{ id: 'p_wave', name: 'WaveGrowth', value: 0.35 }]
      doc.scenarios = [
        { id: 'sc_casual', name: 'Casual Wave', params: { WaveGrowth: 0.2 } },
        { id: 'sc_nightmare', name: 'Nightmare Wave', params: { WaveGrowth: 0.62 } }
      ]
      doc.nodes = [
        // ── 图层 1：波次推进与敌潮压力 (ly_wave_enemy) ──
        nd('wave_tick', 'source', /* cjk-ok */ '波次推进 (+1/波)', 120, 120, {
          resourceId: 'enemy',
          trigger: 'automatic',
          layerId: 'ly_wave_enemy',
          color: '#6366f1'
        }),
        nd('wave_count', 'pool', /* cjk-ok */ '当前波次 (Wave)', 300, 120, {
          resourceId: 'enemy',
          initial: 0,
          capacity: 30,
          tracked: true,
          layerId: 'ly_wave_enemy',
          color: '#6366f1'
        }),
        nd('wave_scale', 'register', /* cjk-ok */ '敌潮强度 (含每5波精英潮)', 490, 120, {
          formula:
            'round((9 + wave_count * 3.2 * (1 + WaveGrowth)) * if(wave_count > 0 && wave_count % 5 == 0, 1.35, 1))',
          layerId: 'ly_wave_enemy',
          color: '#a855f7'
        }),
        nd('enemy_spawn', 'source', /* cjk-ok */ '敌潮刷怪口 (Wave Spawn)', 680, 120, {
          resourceId: 'enemy',
          trigger: 'automatic',
          layerId: 'ly_wave_enemy',
          color: '#a855f7'
        }),
        nd('enemy_pool', 'pool', /* cjk-ok */ '在场敌军池 (Active Enemies)', 870, 120, {
          resourceId: 'enemy',
          initial: 6,
          capacity: 200,
          tracked: true,
          layerId: 'ly_wave_enemy',
          color: '#9333ea'
        }),

        // ── 图层 2：赏金经济与场地清障 (ly_gold_map) ──
        nd('kill_bounty', 'source', /* cjk-ok */ '击杀赏金结算 (Kill Bounty)', 120, 280, {
          resourceId: 'gold',
          trigger: 'automatic',
          layerId: 'ly_gold_map',
          color: '#f59e0b'
        }),
        nd('gold', 'pool', /* cjk-ok */ '局内金币池 (Gold)', 320, 280, {
          resourceId: 'gold',
          initial: 48,
          capacity: 500,
          tracked: true,
          layerId: 'ly_gold_map',
          color: '#f59e0b'
        }),
        nd('obstacles', 'pool', /* cjk-ok */ '场地障碍物 (Obstacles)', 520, 280, {
          resourceId: 'slot',
          initial: 6,
          capacity: 10,
          layerId: 'ly_gold_map',
          color: '#84cc16'
        }),
        nd('clear_obstacle', 'converter', /* cjk-ok */ '清理障碍爆金开位', 710, 280, {
          resourceId: 'gold',
          trigger: 'automatic',
          layerId: 'ly_gold_map',
          color: '#10b981'
        }),
        nd('build_slots', 'pool', /* cjk-ok */ '可用建塔空位 (Build Slots)', 900, 280, {
          resourceId: 'slot',
          initial: 7,
          capacity: 16,
          layerId: 'ly_gold_map',
          color: '#10b981'
        }),

        // ── 图层 3：异构建塔与战术拆塔 (ly_tower_build) ──
        nd('build_arrow', 'converter', /* cjk-ok */ '建造速射箭塔 (Arrow)', 320, 440, {
          resourceId: 'tower',
          trigger: 'automatic',
          pullMode: 'pull_all',
          layerId: 'ly_tower_build',
          color: '#3b82f6'
        }),
        nd('arrow_towers', 'pool', /* cjk-ok */ '速射箭塔数 (Arrow Towers)', 520, 440, {
          resourceId: 'tower',
          initial: 2,
          capacity: 10,
          tracked: true,
          layerId: 'ly_tower_build',
          color: '#3b82f6'
        }),
        nd('build_mage', 'converter', /* cjk-ok */ '建造群伤法师塔 (Mage)', 710, 440, {
          resourceId: 'tower',
          trigger: 'automatic',
          pullMode: 'pull_all',
          layerId: 'ly_tower_build',
          color: '#0ea5e9'
        }),
        nd('mage_towers', 'pool', /* cjk-ok */ '群伤法师塔数 (Mage Towers)', 900, 440, {
          resourceId: 'tower',
          initial: 0,
          capacity: 8,
          tracked: true,
          layerId: 'ly_tower_build',
          color: '#0ea5e9'
        }),
        nd('sell_tower', 'converter', /* cjk-ok */ '紧急拆塔折旧回血换位', 520, 560, {
          resourceId: 'gold',
          trigger: 'interactive',
          botPolicy: 'condition',
          botCondition: 'base_hp <= 6 && arrow_towers >= 3 && gold < 24',
          layerId: 'ly_tower_build',
          color: '#f97316'
        }),

        // ── 图层 4：火力升级与防线清怪 (ly_combat_upg) ──
        nd('upgrade_tower', 'converter', /* cjk-ok */ '升级炮塔科技等级', 320, 700, {
          resourceId: 'tower',
          trigger: 'automatic',
          layerId: 'ly_combat_upg',
          color: '#8b5cf6'
        }),
        nd('upgrade_level', 'pool', /* cjk-ok */ '炮塔强化等级 (Upgrade Lv)', 520, 700, {
          resourceId: 'tower',
          initial: 0,
          capacity: 12,
          tracked: true,
          layerId: 'ly_combat_upg',
          color: '#8b5cf6'
        }),
        nd('defense_dps', 'register', /* cjk-ok */ '防线总火力 (Defense DPS)', 710, 700, {
          formula:
            'round((arrow_towers * 5 + mage_towers * 9.5) * (1 + upgrade_level * 0.18) * (1 + meta_tech * 0.06))',
          layerId: 'ly_combat_upg',
          color: '#f43f5e'
        }),
        nd('kill_drain', 'drain', /* cjk-ok */ '炮塔集火歼灭敌军', 900, 700, {
          trigger: 'automatic',
          layerId: 'ly_combat_upg',
          color: '#ec4899'
        }),

        // ── 图层 5：基地生命、单局结算与胜负终局 (ly_meta_finale) ──
        nd('stamina_pool', 'pool', /* cjk-ok */ '局外体力池 (Stamina)', 120, 860, {
          resourceId: 'meta',
          initial: 30,
          capacity: 30,
          layerId: 'ly_meta_finale',
          color: '#06b6d4'
        }),
        nd('match_entry', 'converter', /* cjk-ok */ '单局开战耗体授印 (首波触发)', 320, 860, {
          resourceId: 'meta',
          trigger: 'automatic',
          layerId: 'ly_meta_finale',
          color: '#06b6d4'
        }),
        nd('meta_tech', 'pool', /* cjk-ok */ '局外科技天赋 (Meta Tech)', 520, 860, {
          resourceId: 'meta',
          initial: 1,
          capacity: 20,
          tracked: true,
          layerId: 'ly_meta_finale',
          color: '#0891b2'
        }),
        nd('base_hp', 'pool', /* cjk-ok */ '基地生命 (Base HP)', 710, 860, {
          resourceId: 'lives',
          initial: 20,
          capacity: 20,
          tracked: true,
          layerId: 'ly_meta_finale',
          color: '#ef4444'
        }),
        nd('leak_hp_drain', 'drain', /* cjk-ok */ '漏怪突破防线扣血 (-HP)', 900, 860, {
          trigger: 'automatic',
          layerId: 'ly_meta_finale',
          color: '#dc2626'
        }),
        nd('despawn_leaked', 'drain', /* cjk-ok */ '已撞击漏怪离场清零', 1080, 700, {
          trigger: 'automatic',
          layerId: 'ly_meta_finale',
          color: '#64748b'
        }),
        nd('lose', 'end', /* cjk-ok */ '防线失守失败 (Base Destroyed)', 1080, 820, {
          layerId: 'ly_meta_finale',
          color: '#ef4444'
        }),
        nd('victory', 'end', /* cjk-ok */ '20波坚守胜利 (20 Waves Cleared)', 1080, 920, {
          layerId: 'ly_meta_finale',
          color: '#22c55e'
        })
      ]
      doc.edges = [
        // 波次推进与敌潮生成
        ed('e_wave_tick', 'resource', 'wave_tick', 'wave_count', '1'),
        ed('e_spawn', 'resource', 'enemy_spawn', 'enemy_pool', 'wave_scale'),

        // 赏金与清障
        ed(
          'e_bounty_gold',
          'resource',
          'kill_bounty',
          'gold',
          'round(min(wave_scale + 4, defense_dps) * 1.25)'
        ),
        ed('e_obs_gate', 'state', 'obstacles', 'clear_obstacle', '>=1'),
        ed('e_wave_obs_gate', 'state', 'wave_count', 'clear_obstacle', '>=1'),
        ed('e_obs_in', 'resource', 'obstacles', 'clear_obstacle', '1 every 2'),
        ed('e_obs_gold', 'resource', 'clear_obstacle', 'gold', '14'),
        ed('e_obs_slot', 'resource', 'clear_obstacle', 'build_slots', '1'),

        // 异构建塔（箭塔 + 法师塔）与条件拆塔
        ed('e_arrow_gold_gate', 'state', 'gold', 'build_arrow', '>=26'),
        ed('e_arrow_slot_gate', 'state', 'build_slots', 'build_arrow', '>=1'),
        ed('e_arrow_cap_gate', 'state', 'arrow_towers', 'build_arrow', '<=8'),
        ed('e_arrow_cost', 'resource', 'gold', 'build_arrow', '18 + arrow_towers * 4'),
        ed('e_arrow_slot', 'resource', 'build_slots', 'build_arrow', '1'),
        ed('e_arrow_out', 'resource', 'build_arrow', 'arrow_towers', '1'),

        ed('e_mage_wave_gate', 'state', 'wave_count', 'build_mage', '>=2'),
        ed('e_mage_gold_gate', 'state', 'gold', 'build_mage', '>=34'),
        ed('e_mage_slot_gate', 'state', 'build_slots', 'build_mage', '>=1'),
        ed('e_mage_cap_gate', 'state', 'mage_towers', 'build_mage', '<=6'),
        ed('e_mage_cost', 'resource', 'gold', 'build_mage', '28 + mage_towers * 6'),
        ed('e_mage_slot', 'resource', 'build_slots', 'build_mage', '1'),
        ed('e_mage_out', 'resource', 'build_mage', 'mage_towers', '1'),

        ed('e_sell_in', 'resource', 'arrow_towers', 'sell_tower', '1'),
        ed('e_sell_gold', 'resource', 'sell_tower', 'gold', '12'),
        ed('e_sell_slot', 'resource', 'sell_tower', 'build_slots', '1'),

        // 科技升级与防线歼敌
        ed('e_upg_gold_gate', 'state', 'gold', 'upgrade_tower', '>=28'),
        ed('e_upg_cap_gate', 'state', 'upgrade_level', 'upgrade_tower', '<=11'),
        ed('e_upg_cost', 'resource', 'gold', 'upgrade_tower', '22 + upgrade_level * 5'),
        ed('e_upg_out', 'resource', 'upgrade_tower', 'upgrade_level', '1'),

        ed(
          'e_kill_enemies',
          'resource',
          'enemy_pool',
          'kill_drain',
          'min(enemy_pool, defense_dps)'
        ),

        // 漏怪扣血（严格使用 base_hp -> Drain 减法！）与残怪离场
        ed(
          'e_leak_hp',
          'resource',
          'base_hp',
          'leak_hp_drain',
          'min(base_hp, max(0, ceil((enemy_pool - 1) * 0.4)))'
        ),
        ed(
          'e_despawn_leaked',
          'resource',
          'enemy_pool',
          'despawn_leaked',
          'max(0, enemy_pool - 2)'
        ),

        // 单局首波体力入场与胜负双终局（AND 多条件胜利）
        ed('e_entry_wave_gate', 'state', 'wave_count', 'match_entry', '<=1'),
        ed('e_entry_stam_gate', 'state', 'stamina_pool', 'match_entry', '>=6'),
        ed('e_entry_stam_in', 'resource', 'stamina_pool', 'match_entry', '6'),
        ed('e_entry_tech_out', 'resource', 'match_entry', 'meta_tech', '1'),

        ed('e_defeat_hp', 'state', 'base_hp', 'lose', '<=0'),
        ed('e_win_wave', 'state', 'wave_count', 'victory', '>=20'),
        ed('e_win_hp', 'state', 'base_hp', 'victory', '>=1'),
        ed('e_win_clear', 'state', 'enemy_pool', 'victory', '<=3')
      ]
      doc.settings.steps = 22
      doc.settings.runs = 50
      doc.settings.botMode = 'smart'
      autoLayoutMxDocument(doc)
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
    case 'xianxia_lifespan_alchemy': {
      doc.title =
        title ||
        '《山海借命录》200章四象限全生命周期经济系统（采药炼丹·黑市置换·借命契剥削·四卷清算）' // cjk-ok
      doc.description =
        '覆盖《山海借命录》第1~200章四卷（凡尘问道➔秘境争锋➔中州风云➔仙路尽头）的完整系统动力学模型：包含4大子系统象限、6类核心战略资源、23个动态图元与29条资源/状态反馈闭环，实现产出/消耗动态紧平衡（Source/Sink ≈ 1.08x）。' // cjk-ok
      doc.resources = [
        { id: 'res_stones', name: '下品/中品灵石', color: '#10b981' }, // cjk-ok
        { id: 'res_herbs', name: '百年灵药与奇珍', color: '#fbbf24' }, // cjk-ok
        { id: 'res_elixirs', name: '续命/破境灵丹', color: '#38bdf8' }, // cjk-ok
        { id: 'res_lifespan', name: '母子剩余阳寿', color: '#f43f5e' }, // cjk-ok
        { id: 'res_insight', name: '药经医道感悟', color: '#a855f7' }, // cjk-ok
        { id: 'res_alliance', name: '寒门同盟声望', color: '#ec4899' } // cjk-ok
      ]
      doc.params = [
        { id: 'p_herb', name: 'HerbYieldBase', value: 18 },
        { id: 'p_bounty', name: 'SectBountyBase', value: 26 },
        { id: 'p_tax', name: 'ContractTaxBase', value: 16 },
        { id: 'p_growth', name: 'BreakthroughGrowth', value: 1.12 },
        { id: 'p_alchemy', name: 'AlchemyYield', value: 4 },
        { id: 'p_reckon', name: 'ReckoningLifespan', value: 1 }
      ]
      doc.scenarios = [
        {
          id: 'sc_vol1_survival',
          name: '第一卷·凡尘外门求生期 (Ch.1-50)', // cjk-ok
          params: {
            HerbYieldBase: 14,
            SectBountyBase: 20,
            ContractTaxBase: 20,
            BreakthroughGrowth: 1.15,
            AlchemyYield: 3,
            ReckoningLifespan: 1
          }
        },
        {
          id: 'sc_vol23_ascend',
          name: '第二三卷·秘境与中州破契期 (Ch.51-150)', // cjk-ok
          params: {
            HerbYieldBase: 16,
            SectBountyBase: 24,
            ContractTaxBase: 18,
            BreakthroughGrowth: 1.12,
            AlchemyYield: 4,
            ReckoningLifespan: 1
          }
        },
        {
          id: 'sc_vol4_reckoning',
          name: '第四卷·仙路尽头总清算 (Ch.151-200)', // cjk-ok
          params: {
            HerbYieldBase: 20,
            SectBountyBase: 30,
            ContractTaxBase: 15,
            BreakthroughGrowth: 1.09,
            AlchemyYield: 5,
            ReckoningLifespan: 2
          }
        }
      ]
      doc.layers = [
        { id: 'layer_base', name: 'Base', visible: true, locked: false },
        {
          id: 'ly_faucet_market',
          name: '第一层：采药悬赏与黑市开源', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_alchemy_realm',
          name: '第二层：药经炼丹与太虚破境', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_lifespan_sink',
          name: '第三层：借命契剥削与阳寿闭环', // cjk-ok
          visible: true,
          locked: false
        },
        {
          id: 'ly_alliance_reckon',
          name: '第四层：寒门同盟与终局清算', // cjk-ok
          visible: true,
          locked: false
        }
      ]
      doc.groups = [
        {
          id: 'grp_faucet_market',
          label: '第一层：山林采药、外门悬赏与坊市黑市开源层 (Faucets & Black Market)', // cjk-ok
          x: 40,
          y: 40,
          width: 550,
          height: 320,
          color: '#10b981',
          layerId: 'ly_faucet_market'
        },
        {
          id: 'grp_alchemy_realm',
          label: '第二层：残缺药经炼丹、品阶分流与太虚破境引擎 (Alchemy & Cultivation)', // cjk-ok
          x: 630,
          y: 40,
          width: 630,
          height: 320,
          color: '#3b82f6',
          layerId: 'ly_alchemy_realm'
        },
        {
          id: 'grp_lifespan_sink',
          label: '第三层：宗门借命契剥削、丹毒反噬与母子阳寿生死闭环 (Lifespan & Sinks)', // cjk-ok
          x: 40,
          y: 400,
          width: 550,
          height: 320,
          color: '#f43f5e',
          layerId: 'ly_lifespan_sink'
        },
        {
          id: 'grp_alliance_reckon',
          label: '第四层：寒门同盟声望、四卷破契反杀与山海终局清算 (Alliance & Finale)', // cjk-ok
          x: 630,
          y: 400,
          width: 630,
          height: 320,
          color: '#a855f7',
          layerId: 'ly_alliance_reckon'
        }
      ]
      doc.nodes = [
        // ── 象限 I：山林采药、外门悬赏与黑市置换 ──
        nd('src_mine_prod', 'source', /* cjk-ok */ '断魂崖采药与药庐灵田', 130, 130, {
          resourceId: 'res_herbs',
          layerId: 'ly_faucet_market',
          color: '#fbbf24'
        }),
        nd('pool_herbs', 'pool', /* cjk-ok */ '百年灵药与奇珍储备囊', 330, 130, {
          resourceId: 'res_herbs',
          initial: 45,
          capacity: 9999,
          layerId: 'ly_faucet_market',
          color: '#fbbf24'
        }),
        nd('src_sect_bounty', 'source', /* cjk-ok */ '外门悬赏与除妖历练', 130, 275, {
          resourceId: 'res_stones',
          layerId: 'ly_faucet_market',
          color: '#10b981'
        }),
        nd('pool_coins', 'pool', /* cjk-ok */ '沈砚灵石与药材储备囊', 330, 275, {
          resourceId: 'res_stones',
          initial: 80,
          capacity: 999999,
          layerId: 'ly_faucet_market',
          color: '#10b981'
        }),
        nd('trader_black_market', 'converter', /* cjk-ok */ '坊市黑市·药石置换与秘闻', 510, 200, {
          resourceId: 'res_herbs',
          trigger: 'automatic',
          layerId: 'ly_faucet_market',
          color: '#f59e0b'
        }),

        // ── 象限 II：残缺药经炼丹、品阶分流与修为破境 ──
        nd('conv_buy_miner', 'converter', /* cjk-ok */ '残缺药经·辨药试药炼丹', 715, 130, {
          resourceId: 'res_elixirs',
          trigger: 'automatic',
          layerId: 'ly_alchemy_realm',
          color: '#38bdf8'
        }),
        nd('gate_pill_quality', 'gate', /* cjk-ok */ '成丹品阶闸 (75%灵丹/25%丹毒)', 885, 130, {
          gateMode: 'random',
          layerId: 'ly_alchemy_realm',
          color: '#ec4899'
        }),
        nd('pool_elixirs', 'pool', /* cjk-ok */ '续命灵丹与破境灵丹池', 1055, 130, {
          resourceId: 'res_elixirs',
          initial: 28,
          capacity: 2000,
          layerId: 'ly_alchemy_realm',
          color: '#38bdf8'
        }),
        nd('pool_canon_insight', 'pool', /* cjk-ok */ '药经残卷与医道感悟池', 715, 275, {
          resourceId: 'res_insight',
          initial: 24,
          capacity: 5000,
          layerId: 'ly_alchemy_realm',
          color: '#a855f7'
        }),
        nd('conv_realm_break', 'converter', /* cjk-ok */ '太虚引气·淬脉冲关破境', 885, 275, {
          resourceId: 'res_insight',
          trigger: 'automatic',
          layerId: 'ly_alchemy_realm',
          color: '#6366f1'
        }),
        nd('pool_cultivation', 'pool', /* cjk-ok */ '沈砚修为境界池 (凡人➔大乘)', 1055, 275, {
          resourceId: 'res_insight',
          initial: 1,
          capacity: 500,
          layerId: 'ly_alchemy_realm',
          color: '#6366f1'
        }),
        nd('reg_miner_cost', 'register', /* cjk-ok */ '突破与借息代价曲线: 50+1.8*N', 1190, 200, {
          formula: 'round(50 + a * 1.8 + step * 0.25)',
          layerId: 'ly_alchemy_realm',
          color: '#a855f7'
        }),

        // ── 象限 III：宗门借命契剥削、丹毒反噬与母子阳寿生死闭环 ──
        nd('drain_upkeep', 'drain', /* cjk-ok */ '宗门寿元契约抽成与折寿反噬', 130, 495, {
          trigger: 'automatic',
          layerId: 'ly_lifespan_sink',
          color: '#f43f5e'
        }),
        nd('drain_poison_backlash', 'drain', /* cjk-ok */ '试药丹毒淤积与借息损耗', 330, 495, {
          trigger: 'automatic',
          layerId: 'ly_lifespan_sink',
          color: '#fb7185'
        }),
        nd('conv_lifespan_heal', 'converter', /* cjk-ok */ '服食续命丹·修补母子阳寿', 510, 495, {
          resourceId: 'res_lifespan',
          trigger: 'automatic',
          layerId: 'ly_lifespan_sink',
          color: '#34d399'
        }),
        nd('reg_contract_pressure', 'register', /* cjk-ok */ '四卷宿敌压迫与催缴强度', 130, 640, {
          formula: 'round(15 + step * 0.45 + a * 1.6)',
          layerId: 'ly_lifespan_sink',
          color: '#f43f5e'
        }),
        nd('pool_miners', 'pool', /* cjk-ok */ '沈砚与沈母剩余阳寿池', 330, 640, {
          resourceId: 'res_lifespan',
          initial: 32,
          capacity: 500,
          layerId: 'ly_lifespan_sink',
          color: '#f43f5e'
        }),
        nd('end_lifespan_exhausted', 'end', /* cjk-ok */ '败局红线: 母子阳寿断绝', 510, 640, {
          formula: 'a <= 0',
          layerId: 'ly_lifespan_sink',
          color: '#ef4444'
        }),

        // ── 象限 IV：寒门同盟声望、四卷破契反杀与终局清算 ──
        nd('pool_alliance', 'pool', /* cjk-ok */ '林照月/苏若雪·寒门同盟声望池', 715, 495, {
          resourceId: 'res_alliance',
          initial: 24,
          capacity: 2000,
          layerId: 'ly_alliance_reckon',
          color: '#ec4899'
        }),
        nd('conv_arc_reckoning', 'converter', /* cjk-ok */ '卷末大高潮·破契反杀与清算', 905, 495, {
          resourceId: 'res_lifespan',
          trigger: 'automatic',
          layerId: 'ly_alliance_reckon',
          color: '#f59e0b'
        }),
        nd('reg_volume_tier', 'register', /* cjk-ok */ '四卷换地图阶梯与天道威压', 715, 640, {
          formula: 'round(10 + a * 1.5 + floor(step / 50) * 12)',
          layerId: 'ly_alliance_reckon',
          color: '#38bdf8'
        }),
        nd('pool_primordial_seals', 'pool', /* cjk-ok */ '山海古印与本源借契碎片池', 905, 640, {
          resourceId: 'res_alliance',
          initial: 2,
          capacity: 500,
          layerId: 'ly_alliance_reckon',
          color: '#fbbf24'
        }),
        nd('end_tycoon_goal', 'end', /* cjk-ok */ '阶段目标: 赎回母命·执掌山海总纲', 1140, 565, {
          formula: 'a >= 225',
          layerId: 'ly_alliance_reckon',
          color: '#22d3ee'
        })
      ]
      doc.edges = [
        // 象限 I 内部与跨象限输出
        ed('e_herb_gather', 'resource', 'src_mine_prod', 'pool_herbs', 'HerbYieldBase'),
        ed('e_bounty_stones', 'resource', 'src_sect_bounty', 'pool_coins', 'SectBountyBase'),
        ed('e_stones_to_market', 'resource', 'pool_coins', 'trader_black_market', '6'),
        ed('e_market_to_herbs', 'resource', 'trader_black_market', 'pool_herbs', '4'),
        ed('e_market_to_insight', 'resource', 'trader_black_market', 'pool_canon_insight', '2'),

        // 象限 I -> 象限 II（药材与灵石进入残缺药经炼丹炉）
        ed('e_herbs_to_alchemy', 'resource', 'pool_herbs', 'conv_buy_miner', '10'),
        ed('e_coins_to_buy', 'resource', 'pool_coins', 'conv_buy_miner', '8'),
        ed('e_alchemy_to_gate', 'resource', 'conv_buy_miner', 'gate_pill_quality', 'AlchemyYield'),
        ed('e_alchemy_to_insight', 'resource', 'conv_buy_miner', 'pool_canon_insight', '3'),
        ed('e_gate_to_elixirs', 'resource', 'gate_pill_quality', 'pool_elixirs', '75%'),
        ed('e_gate_to_poison', 'resource', 'gate_pill_quality', 'drain_poison_backlash', '25%'),
        ed('e_insight_boost_herb', 'state', 'pool_cultivation', 'src_mine_prod', '+0.06', {
          targetEdgeId: 'e_herb_gather'
        }),

        // 象限 II 内部（破境冲关与指数代价曲线）
        ed('e_elixirs_to_break', 'resource', 'pool_elixirs', 'conv_realm_break', '1'),
        ed('e_insight_to_break', 'resource', 'pool_canon_insight', 'conv_realm_break', '2'),
        ed('e_break_to_cult', 'resource', 'conv_realm_break', 'pool_cultivation', '1'),
        ed('e_break_to_alliance', 'resource', 'conv_realm_break', 'pool_alliance', '3'),
        ed('e_cult_boost_bounty', 'state', 'pool_cultivation', 'src_sect_bounty', '+0.12', {
          targetEdgeId: 'e_bounty_stones'
        }),
        ed('e_miners_to_reg', 'state', 'pool_cultivation', 'reg_miner_cost', '+1'),

        // 象限 II -> 象限 III（续命灵丹修补母子阳寿 & 宗门借命契剥削与丹毒回收）
        ed('e_elixirs_to_heal', 'resource', 'pool_elixirs', 'conv_lifespan_heal', '1'),
        ed('e_buy_to_miners', 'resource', 'conv_lifespan_heal', 'pool_miners', '1 every 2'),
        ed('e_coins_to_upkeep', 'resource', 'pool_coins', 'drain_upkeep', 'ContractTaxBase'),
        ed('e_herbs_to_poison', 'resource', 'pool_herbs', 'drain_poison_backlash', '10'),
        ed('e_insight_to_poison', 'resource', 'pool_canon_insight', 'drain_poison_backlash', '2'),
        ed('e_cult_to_upkeep', 'state', 'pool_cultivation', 'pool_coins', '+0.1', {
          targetEdgeId: 'e_coins_to_upkeep'
        }),
        ed('e_cult_to_pressure', 'state', 'pool_cultivation', 'reg_contract_pressure', '+1'),
        ed('e_lifespan_to_death', 'state', 'pool_miners', 'end_lifespan_exhausted', '<=0'),

        // 象限 IV（寒门同盟声望、四卷破契清算回补阳寿与终局目标）
        ed('e_alliance_to_reckon', 'resource', 'pool_alliance', 'conv_arc_reckoning', '2'),
        ed('e_reckon_to_lifespan', 'resource', 'conv_arc_reckoning', 'pool_miners', '1 every 2'),
        ed('e_reckon_to_seals', 'resource', 'conv_arc_reckoning', 'pool_primordial_seals', '1'),
        ed('e_reckon_to_stones', 'resource', 'conv_arc_reckoning', 'pool_coins', '6'),
        ed('e_seals_to_vol', 'state', 'pool_primordial_seals', 'reg_volume_tier', '+1'),
        ed('e_miners_to_goal', 'state', 'pool_miners', 'end_tycoon_goal', '>=225')
      ]
      doc.settings.steps = 200
      doc.settings.runs = 60
      break
    }
    default:
      if (id !== ('roguelike_run' as MxTemplateId)) {
        return createMxTemplate('roguelike_run', title)
      }
      break
  }
  doc.workbench =
    id === 'xianxia_lifespan_alchemy'
      ? createXianxia200LifespanWorkbench()
      : createMxWorkbenchPreset(mapMxTemplateToWorkbenchPreset(id))
  return assignDefaultCategoryLayersToTemplate(doc)
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
    /山海借命|借命契|残缺药经|寿元契约|阳寿池|外门采药|仙侠经济|灵石.*药材.*丹药/, // cjk-ok
    'xianxia_lifespan_alchemy'
  ],
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
    /slay\s*the\s*spire|spire|\bdbg\b|deck|card|mana|hand|draw|杀戮尖塔|尖塔|遗物|易伤|\u5361\u724c|\u6cd5\u529b|\u6784\u7b51|\u62bd\u724c|\u8d39\u7528/, // cjk-ok
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
  if (
    doc.nodes.some((n) => n.trigger === 'interactive') &&
    (doc.settings.botMode ?? 'off') === 'off' &&
    !(Array.isArray(doc.agents) && doc.agents.some((a) => a.enabled))
  ) {
    const agent = generateMxAgentWithAi(doc, { prompt })
    doc.agents = [agent]
  }
  doc.workbench = synthesizeMxWorkbenchFromPrompt(
    prompt,
    mapMxTemplateToWorkbenchPreset(matchedTpl)
  )
  return doc
}
