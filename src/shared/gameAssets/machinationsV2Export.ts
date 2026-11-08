/**
 * Machinations v2 导出与预览渲染：Mermaid / 遥测 CSV / Godot 4 GDScript / Unity C# / RGBA 预览图。
 */
import {
  getMxSimulationDoc,
  isMxBooleanStateExpr,
  mxIdentifier,
  mxNodeColor,
  parseMxFlowFormula,
  parseMxStateFormula,
  type MxDocument,
  type MxEdge,
  type MxForecastResult,
  type MxRunResult
} from './machinationsV2'
import { createMxWorkbenchPreset, mapMxTemplateToWorkbenchPreset } from './gameNumericalWorkbench'

export function exportMxToMermaid(rawDoc: MxDocument): string {
  const doc = getMxSimulationDoc(rawDoc)
  const lines = ['flowchart LR']
  const esc = (s: string): string => s.replace(/"/g, "'")
  for (const n of doc.nodes) {
    if (n.kind === 'note') continue
    const label = esc(n.label)
    switch (n.kind) {
      case 'pool':
        lines.push(`  ${n.id}(("${label} [${n.initial ?? 0}]"))`)
        break
      case 'gate':
        lines.push(`  ${n.id}{"${label}"}`)
        break
      case 'source':
        lines.push(`  ${n.id}[/"${label}"\\]`)
        break
      case 'drain':
        lines.push(`  ${n.id}[\\"${label}"/]`)
        break
      case 'converter':
      case 'trader':
        lines.push(`  ${n.id}>"${label}"]`)
        break
      default:
        lines.push(`  ${n.id}["${label}"]`)
    }
  }
  for (const e of doc.edges) {
    const arrow = e.kind === 'state' ? '-.->' : '-->'
    const baseFormula = e.formula || (e.kind === 'state' ? '*' : '1')
    const withIv =
      e.kind === 'resource' && e.interval?.trim() && !baseFormula.includes('|')
        ? `${baseFormula}|${e.interval.trim()}`
        : baseFormula
    const prefix = e.label?.trim() ? `${e.label.trim()}: ` : ''
    const targetNote = e.targetEdgeId ? ` [->${e.targetEdgeId}]` : ''
    lines.push(`  ${e.from} ${arrow}|"${esc(`${prefix}${withIv}${targetNote}`)}"| ${e.to}`)
  }
  return lines.join('\n')
}

export function exportMxForecastCsv(doc: MxDocument, fc: MxForecastResult): string {
  const header = ['step']
  for (const s of fc.series) {
    const id = mxIdentifier(s.label) || s.nodeId
    header.push(`${id}_p10`, `${id}_p50`, `${id}_p90`, `${id}_mean`)
  }
  const rows = [header.join(',')]
  for (let k = 0; k <= fc.steps; k++) {
    const cols: Array<string | number> = [k]
    for (const s of fc.series)
      cols.push(s.p10[k] ?? 0, s.p50[k] ?? 0, s.p90[k] ?? 0, s.mean[k] ?? 0)
    rows.push(cols.join(','))
  }
  void doc
  return rows.join('\n')
}

export function exportMxRunCsv(doc: MxDocument, run: MxRunResult): string {
  const tracked = doc.nodes.filter((n) => n.kind !== 'note')
  const header = ['step', ...tracked.map((n) => mxIdentifier(n.label) || n.id)]
  const rows = [header.join(',')]
  run.snapshots.forEach((snap, k) => {
    rows.push([k, ...tracked.map((n) => snap[n.id] ?? 0)].join(','))
  })
  return rows.join('\n')
}

const POSITIONAL_LETTERS_26 = 'abcdefghijklmnopqrstuvwxyz'

/**
 * 将 Machinations 公式表达式编译为合法的 Godot 4 GDScript 数学表达式。
 * 支持骰子（2D6 -> roll_dice(2, 6)）、区间（3..6 -> float(randi_range(3, 6))）、Math.js 函数集与节点/参数引用。
 */
export function compileMxFormulaToGd(
  exprRaw: string | undefined,
  doc: MxDocument,
  aNodeId?: string,
  stateInputFromIds?: string[]
): string {
  const raw = (exprRaw ?? '1').trim()
  if (!raw) return '1.0'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw).toFixed(2)

  const paramNames = new Set(doc.params.map((p) => mxIdentifier(p.name)).filter(Boolean))
  const nodeByIdent = new Map<string, string>()
  for (const n of doc.nodes) {
    const ident = mxIdentifier(n.label)
    if (ident) nodeByIdent.set(ident, n.id)
    nodeByIdent.set(n.id, n.id)
  }

  // 替换区间 3..6 -> float(randi_range(3, 6))
  let out = raw.replace(
    /(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/g,
    (_m, lo, hi) => `float(randi_range(int(${lo}), int(${hi})))`
  )

  // 替换骰子 2D6 / D6
  out = out.replace(/\b(\d*)[dD](\d+)\b/g, (_m, cnt, sides) => {
    const c = cnt ? Number(cnt) : 1
    return `roll_dice(${c}, ${Number(sides)})`
  })

  // 替换幂运算符 ^ 为 pow
  out = out.replace(/([A-Za-z0-9_.)]+)\s*\^\s*([A-Za-z0-9_(.]+)/g, 'pow($1, $2)')

  // 替换逻辑运算符 <> / && / || 为 GDScript 的 != / and / or
  out = out.replace(/<>/g, '!=').replace(/&&/g, ' and ').replace(/\|\|/g, ' or ')

  // 替换内置函数与标识符
  out = out.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*(\()?/g,
    (full, ident: string, openParen?: string) => {
      if (openParen === '(') {
        const fn = ident.toLowerCase()
        const gdFnMap: Record<string, string> = {
          if: 'mx_if',
          diminish: 'mx_diminish',
          random: 'randf_range',
          randint: 'randi_range',
          randomint: 'randi_range',
          norm: 'randfn',
          gaussian: 'randfn',
          normal: 'randfn',
          add: 'mx_add',
          subtract: 'mx_sub',
          multiply: 'mx_mul',
          divide: 'mx_div',
          mod: 'fposmod',
          square: 'mx_square',
          cube: 'mx_cube',
          cbrt: 'mx_cbrt',
          larger: 'mx_larger',
          largereq: 'mx_larger_eq',
          smaller: 'mx_smaller',
          smallereq: 'mx_smaller_eq',
          equal: 'mx_equal',
          unequal: 'mx_unequal',
          and: 'mx_and',
          or: 'mx_or',
          not: 'mx_not',
          xor: 'mx_xor',
          log10: 'mx_log10',
          log2: 'mx_log2'
        }
        if (gdFnMap[fn]) return `${gdFnMap[fn]}(`
        if (
          [
            'min',
            'max',
            'floor',
            'ceil',
            'round',
            'abs',
            'sign',
            'sqrt',
            'pow',
            'exp',
            'log',
            'sin',
            'cos',
            'tan',
            'asin',
            'acos',
            'atan',
            'atan2',
            'clamp',
            'lerp',
            'smoothstep',
            'roll_dice',
            'randi_range',
            'float',
            'int'
          ].includes(fn)
        ) {
          return `${fn}(`
        }
        return full
      }
      if (
        ident === 'and' ||
        ident === 'or' ||
        ident === 'not' ||
        ident === 'true' ||
        ident === 'false'
      ) {
        return ident
      }
      if (ident.toLowerCase() === 'pi') return 'PI'
      if (ident === 'step' || ident === 'STEP' || ident === 't') return 'float(step)'
      if (ident === 'self' && aNodeId) return `get_val("${aNodeId}")`
      if (ident.length === 1) {
        const letterIdx = POSITIONAL_LETTERS_26.indexOf(ident)
        if (letterIdx >= 0 && stateInputFromIds?.[letterIdx]) {
          return `get_val("${stateInputFromIds[letterIdx]}")`
        }
      }
      if (ident === 'a' && aNodeId) return `get_val("${aNodeId}")`
      if (paramNames.has(ident)) return `get_param("${ident}")`
      const mappedId = nodeByIdent.get(ident)
      if (mappedId) return `get_val("${mappedId}")`
      return `get_var("${ident}")`
    }
  )

  return out
}

/**
 * 将 Machinations 公式表达式编译为合法的 Unity C# 数学表达式。
 */
export function compileMxFormulaToCs(
  exprRaw: string | undefined,
  doc: MxDocument,
  aNodeId?: string,
  stateInputFromIds?: string[]
): string {
  const raw = (exprRaw ?? '1').trim()
  if (!raw) return '1f'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return `${Number(raw)}f`

  const paramNames = new Set(doc.params.map((p) => mxIdentifier(p.name)).filter(Boolean))
  const nodeByIdent = new Map<string, string>()
  for (const n of doc.nodes) {
    const ident = mxIdentifier(n.label)
    if (ident) nodeByIdent.set(ident, n.id)
    nodeByIdent.set(n.id, n.id)
  }

  let out = raw.replace(
    /(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/g,
    (_m, lo, hi) => `RollRangeInt(${lo}f, ${hi}f)`
  )

  out = out.replace(/\b(\d*)[dD](\d+)\b/g, (_m, cnt, sides) => {
    const c = cnt ? Number(cnt) : 1
    return `RollDice(${c}, ${Number(sides)})`
  })

  out = out
    .replace(/<>/g, '!=')
    .replace(/([A-Za-z0-9_.)]+)\s*\^\s*([A-Za-z0-9_(.]+)/g, 'Mathf.Pow($1, $2)')

  out = out.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*(\()?/g,
    (full, ident: string, openParen?: string) => {
      if (openParen === '(') {
        const fn = ident.toLowerCase()
        const csFnMap: Record<string, string> = {
          min: 'Mathf.Min',
          max: 'Mathf.Max',
          floor: 'Mathf.Floor',
          ceil: 'Mathf.Ceil',
          round: 'Mathf.Round',
          abs: 'Mathf.Abs',
          sign: 'Mathf.Sign',
          sqrt: 'Mathf.Sqrt',
          pow: 'Mathf.Pow',
          exp: 'Mathf.Exp',
          log: 'Mathf.Log',
          log10: 'Mathf.Log10',
          sin: 'Mathf.Sin',
          cos: 'Mathf.Cos',
          tan: 'Mathf.Tan',
          asin: 'Mathf.Asin',
          acos: 'Mathf.Acos',
          atan: 'Mathf.Atan',
          atan2: 'Mathf.Atan2',
          clamp: 'Mathf.Clamp',
          lerp: 'Mathf.Lerp',
          if: 'MxIf',
          diminish: 'MxDiminish',
          random: 'UnityEngine.Random.Range',
          randint: 'RollRangeInt',
          randomint: 'RollRangeInt',
          roll_dice: 'RollDice',
          rolldice: 'RollDice',
          rolldierangeint: 'RollRangeInt',
          rollrangeint: 'RollRangeInt',
          norm: 'MxNorm',
          gaussian: 'MxNorm',
          normal: 'MxNorm',
          add: 'MxAdd',
          subtract: 'MxSub',
          multiply: 'MxMul',
          divide: 'MxDiv',
          mod: 'MxMod',
          square: 'MxSquare',
          cube: 'MxCube',
          cbrt: 'MxCbrt',
          larger: 'MxLarger',
          largereq: 'MxLargerEq',
          smaller: 'MxSmaller',
          smallereq: 'MxSmallerEq',
          equal: 'MxEqual',
          unequal: 'MxUnequal',
          and: 'MxAnd',
          or: 'MxOr',
          not: 'MxNot',
          xor: 'MxXor'
        }
        if (csFnMap[fn]) return `${csFnMap[fn]}(`
        return full
      }
      if (ident === 'true' || ident === 'false') return ident
      if (ident.toLowerCase() === 'pi') return 'Mathf.PI'
      if (ident === 'step' || ident === 'STEP' || ident === 't') return '((float)Step)'
      if (ident === 'self' && aNodeId) return `GetVal("${aNodeId}")`
      if (ident.length === 1) {
        const letterIdx = POSITIONAL_LETTERS_26.indexOf(ident)
        if (letterIdx >= 0 && stateInputFromIds?.[letterIdx]) {
          return `GetVal("${stateInputFromIds[letterIdx]}")`
        }
      }
      if (ident === 'a' && aNodeId) return `GetVal("${aNodeId}")`
      if (paramNames.has(ident)) return `GetParam("${ident}")`
      const mappedId = nodeByIdent.get(ident)
      if (mappedId) return `GetVal("${mappedId}")`
      return `GetVar("${ident}")`
    }
  )

  return out
}

function compileStateConditionToGd(
  formulaRaw: string | undefined,
  fromNodeId: string,
  doc: MxDocument,
  forEndNode = false
): string | null {
  const raw = (formulaRaw ?? (forEndNode ? '>=1' : '')).trim()
  if (!raw) return null
  const spec = parseMxStateFormula(raw)
  switch (spec.type) {
    case 'activator':
      if (spec.op === '==') return `absf(get_val("${fromNodeId}") - ${spec.value}) < 1e-6`
      if (spec.op === '!=') return `absf(get_val("${fromNodeId}") - ${spec.value}) >= 1e-6`
      return `get_val("${fromNodeId}") ${spec.op} ${spec.value}`
    case 'range':
      return `(get_val("${fromNodeId}") >= ${spec.lo} and get_val("${fromNodeId}") <= ${spec.hi})`
    case 'expr': {
      if (!forEndNode && !isMxBooleanStateExpr(spec.expr)) return null
      const exprGd = compileMxFormulaToGd(spec.expr, doc, fromNodeId)
      return /[<>=!]/.test(spec.expr) ? `(${exprGd})` : `((${exprGd}) != 0.0)`
    }
    case 'trigger':
      return forEndNode ? `get_val("${fromNodeId}") > 0.0` : null
    case 'reverse_trigger':
      return forEndNode ? `get_val("${fromNodeId}") <= 0.0` : null
    default:
      return null
  }
}

function compileStateConditionToCs(
  formulaRaw: string | undefined,
  fromNodeId: string,
  doc: MxDocument,
  forEndNode = false
): string | null {
  const raw = (formulaRaw ?? (forEndNode ? '>=1' : '')).trim()
  if (!raw) return null
  const spec = parseMxStateFormula(raw)
  switch (spec.type) {
    case 'activator':
      if (spec.op === '==') return `Mathf.Abs(GetVal("${fromNodeId}") - ${spec.value}f) < 1e-5f`
      if (spec.op === '!=') return `Mathf.Abs(GetVal("${fromNodeId}") - ${spec.value}f) >= 1e-5f`
      return `GetVal("${fromNodeId}") ${spec.op} ${spec.value}f`
    case 'range':
      return `(GetVal("${fromNodeId}") >= ${spec.lo}f && GetVal("${fromNodeId}") <= ${spec.hi}f)`
    case 'expr': {
      if (!forEndNode && !isMxBooleanStateExpr(spec.expr)) return null
      const exprCs = compileMxFormulaToCs(spec.expr, doc, fromNodeId)
      return /[<>=!]/.test(spec.expr) ? `(${exprCs})` : `((${exprCs}) != 0f)`
    }
    case 'trigger':
      return forEndNode ? `GetVal("${fromNodeId}") > 0f` : null
    case 'reverse_trigger':
      return forEndNode ? `GetVal("${fromNodeId}") <= 0f` : null
    default:
      return null
  }
}

function collectNodeStateActivatorsGd(nodeId: string, doc: MxDocument, edgeId?: string): string[] {
  const conds: string[] = []
  for (const se of doc.edges) {
    if (se.kind !== 'state') continue
    if (!se.targetEdgeId && se.to === nodeId) {
      const c = compileStateConditionToGd(se.formula, se.from, doc, false)
      if (c) conds.push(c)
    } else if (edgeId && se.targetEdgeId === edgeId) {
      const c = compileStateConditionToGd(se.formula, se.from, doc, false)
      if (c) conds.push(c)
    }
  }
  return conds
}

function collectNodeStateActivatorsCs(nodeId: string, doc: MxDocument, edgeId?: string): string[] {
  const conds: string[] = []
  for (const se of doc.edges) {
    if (se.kind !== 'state') continue
    if (!se.targetEdgeId && se.to === nodeId) {
      const c = compileStateConditionToCs(se.formula, se.from, doc, false)
      if (c) conds.push(c)
    } else if (edgeId && se.targetEdgeId === edgeId) {
      const c = compileStateConditionToCs(se.formula, se.from, doc, false)
      if (c) conds.push(c)
    }
  }
  return conds
}

function applyFlowStateModifiersGd(baseExpr: string, edge: MxEdge, doc: MxDocument): string {
  const dstNode = doc.nodes.find((n) => n.id === edge.to)
  const modEdges = doc.edges.filter(
    (se) =>
      se.kind === 'state' &&
      (se.targetEdgeId === edge.id ||
        (!se.targetEdgeId && se.to === edge.from) ||
        (!se.targetEdgeId && dstNode?.kind === 'drain' && se.to === edge.to))
  )
  let effBase = baseExpr
  const bonusTerms: string[] = []
  for (const se of modEdges) {
    const st = parseMxStateFormula(se.formula)
    if (st.type === 'overwrite') {
      effBase = `get_val("${se.from}")`
    } else if (st.type === 'modifier') {
      if (st.percent) {
        bonusTerms.push(`((${effBase}) * (${st.delta} * get_val("${se.from}") / 100.0))`)
      } else {
        bonusTerms.push(`(${st.delta} * get_val("${se.from}"))`)
      }
    } else if (st.type === 'fraction_modifier' && st.denominator > 0) {
      bonusTerms.push(`(float(int(get_val("${se.from}") / ${st.denominator})) * ${st.numerator})`)
    }
  }
  let res = bonusTerms.length ? `maxf(0.0, (${effBase}) + ${bonusTerms.join(' + ')})` : effBase
  if (edge.minLimit != null && Number.isFinite(edge.minLimit)) {
    res = `maxf(${edge.minLimit}, ${res})`
  }
  if (edge.maxLimit != null && Number.isFinite(edge.maxLimit) && edge.maxLimit >= 0) {
    res = `minf(${edge.maxLimit}, ${res})`
  }
  if (edge.allowDecimals === false) {
    res = `floor(${res})`
  }
  return res
}

function applyFlowStateModifiersCs(baseExpr: string, edge: MxEdge, doc: MxDocument): string {
  const dstNode = doc.nodes.find((n) => n.id === edge.to)
  const modEdges = doc.edges.filter(
    (se) =>
      se.kind === 'state' &&
      (se.targetEdgeId === edge.id ||
        (!se.targetEdgeId && se.to === edge.from) ||
        (!se.targetEdgeId && dstNode?.kind === 'drain' && se.to === edge.to))
  )
  let effBase = baseExpr
  const bonusTerms: string[] = []
  for (const se of modEdges) {
    const st = parseMxStateFormula(se.formula)
    if (st.type === 'overwrite') {
      effBase = `GetVal("${se.from}")`
    } else if (st.type === 'modifier') {
      if (st.percent) {
        bonusTerms.push(`((${effBase}) * (${st.delta}f * GetVal("${se.from}") / 100f))`)
      } else {
        bonusTerms.push(`(${st.delta}f * GetVal("${se.from}"))`)
      }
    } else if (st.type === 'fraction_modifier' && st.denominator > 0) {
      bonusTerms.push(`(((int)(GetVal("${se.from}") / ${st.denominator}f)) * ${st.numerator}f)`)
    }
  }
  let res = bonusTerms.length
    ? `Mathf.Max(0f, (float)(${effBase}) + ${bonusTerms.join(' + ')})`
    : effBase
  if (edge.minLimit != null && Number.isFinite(edge.minLimit)) {
    res = `Mathf.Max(${edge.minLimit}f, (float)(${res}))`
  }
  if (edge.maxLimit != null && Number.isFinite(edge.maxLimit) && edge.maxLimit >= 0) {
    res = `Mathf.Min(${edge.maxLimit}f, (float)(${res}))`
  }
  if (edge.allowDecimals === false) {
    res = `Mathf.Floor((float)(${res}))`
  }
  return res
}

export function exportMxGodotGd(rawDoc: MxDocument): string {
  const doc = getMxSimulationDoc(rawDoc)
  const pools = doc.nodes.filter((n) => n.kind === 'pool')
  const registers = doc.nodes.filter((n) => n.kind === 'register')
  const converters = doc.nodes.filter((n) => n.kind === 'converter' || n.kind === 'trader')
  const gates = doc.nodes.filter((n) => n.kind === 'gate')
  const ends = doc.nodes.filter((n) => n.kind === 'end')
  const sources = doc.nodes.filter((n) => n.kind === 'source' && n.trigger === 'automatic')
  const drains = doc.nodes.filter((n) => n.kind === 'drain' && n.trigger === 'automatic')
  const params = doc.params
  const wb =
    doc.workbench ?? createMxWorkbenchPreset(mapMxTemplateToWorkbenchPreset(doc.templateId))

  const registerSteps = registers.map((r) => {
    const stIns = doc.edges
      .filter((e) => e.kind === 'state' && !e.targetEdgeId && e.to === r.id)
      .map((e) => e.from)
    let exprGd = compileMxFormulaToGd(r.formula || (stIns.length ? 'a' : '0'), doc, stIns[0], stIns)
    if (r.min != null && Number.isFinite(r.min)) exprGd = `maxf(${r.min}, ${exprGd})`
    if (r.max != null && Number.isFinite(r.max)) exprGd = `minf(${r.max}, ${exprGd})`
    return `\tregisters["${r.id}"] = ${exprGd} # ${r.label}`
  })

  const autoSourceSteps = sources.flatMap((s) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.from === s.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const baseGd = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, s.id)
        const exprGd = applyFlowStateModifiersGd(baseGd, e, doc)
        const conds: string[] = collectNodeStateActivatorsGd(s.id, doc, e.id)
        const effEvery =
          spec.every ??
          (e.interval && /^\d+$/.test(e.interval.trim()) ? Number(e.interval.trim()) : undefined)
        if (effEvery && effEvery > 1) conds.push(`step % ${effEvery} == 0`)
        let finalAmountGd = exprGd
        if (spec.type === 'expr' && spec.probability != null) {
          if (spec.probability <= 1) {
            conds.push(`randf() < ${spec.probability}`)
          } else {
            finalAmountGd = `((${exprGd}) * (floor(${spec.probability}) + (1.0 if randf() < fposmod(${spec.probability}, 1.0) else 0.0)))`
          }
        }
        const prefix = conds.length ? `\tif ${conds.join(' and ')}:\n\t\t` : '\t'
        const targetNode = doc.nodes.find((n) => n.id === e.to)
        if (targetNode?.kind === 'gate') {
          return `${prefix}route_gate("${targetNode.id}", ${finalAmountGd}) # ${s.label} -> ${targetNode.label}`
        }
        return `${prefix}add_resource("${e.to}", ${finalAmountGd}) # ${s.label} -> ${e.to}`
      })
  )

  const autoDrainSteps = drains.flatMap((d) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.to === d.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const baseGd =
          spec.type === 'all'
            ? `get_pool("${e.from}")`
            : compileMxFormulaToGd(spec.expr, doc, e.from)
        const exprGd = spec.type === 'all' ? baseGd : applyFlowStateModifiersGd(baseGd, e, doc)
        const conds: string[] = collectNodeStateActivatorsGd(d.id, doc, e.id)
        const effEvery =
          spec.every ??
          (e.interval && /^\d+$/.test(e.interval.trim()) ? Number(e.interval.trim()) : undefined)
        if (effEvery && effEvery > 1) conds.push(`step % ${effEvery} == 0`)
        if (spec.type === 'expr' && spec.probability != null)
          conds.push(`randf() < ${spec.probability}`)
        const prefix = conds.length ? `\tif ${conds.join(' and ')}:\n\t\t` : '\t'
        return `${prefix}add_resource("${e.from}", -(${exprGd})) # ${e.from} -> ${d.label}`
      })
  )

  const converterCanChecks = converters.map((c) => {
    const stateConds = collectNodeStateActivatorsGd(c.id, doc)
    const stateLines = stateConds.map((cond) => `\t\tif not (${cond}): return false`)
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const checkLines = [
      ...stateLines,
      ...inEdges.map((e) => {
        const edgeAct = collectNodeStateActivatorsGd('', doc, e.id)
        const spec = parseMxFlowFormula(e.formula)
        const baseReq = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, e.from)
        const reqExpr = spec.type === 'all' ? baseReq : applyFlowStateModifiersGd(baseReq, e, doc)
        const actPrefix = edgeAct.map((ac) => `\t\tif not (${ac}): return false\n`).join('')
        return `${actPrefix}\t\tif get_pool("${e.from}") + 1e-6 < (${reqExpr}): return false`
      })
    ]
    return `\tif converter_id == "${c.id}": # ${c.label}
${checkLines.length ? checkLines.join('\n') : '\t\tpass'}
\t\treturn true`
  })

  const converterFuncs = converters.map((c) => {
    const stateConds = collectNodeStateActivatorsGd(c.id, doc)
    const stateLines = stateConds.map((cond) => `\t\tif not (${cond}): return false`)
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const outEdges = doc.edges.filter((e) => e.kind === 'resource' && e.from === c.id)
    const checkLines = [
      ...stateLines,
      ...inEdges.map((e) => {
        const edgeAct = collectNodeStateActivatorsGd('', doc, e.id)
        const spec = parseMxFlowFormula(e.formula)
        const baseReq = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, e.from)
        const reqExpr = spec.type === 'all' ? baseReq : applyFlowStateModifiersGd(baseReq, e, doc)
        const actPrefix = edgeAct.map((ac) => `\t\tif not (${ac}): return false\n`).join('')
        return `${actPrefix}\t\tif get_pool("${e.from}") + 1e-6 < (${reqExpr}): return false`
      })
    ]
    const consumeLines = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const baseReq =
        spec.type === 'all' ? `get_pool("${e.from}")` : compileMxFormulaToGd(spec.expr, doc, e.from)
      const reqExpr = spec.type === 'all' ? baseReq : applyFlowStateModifiersGd(baseReq, e, doc)
      return `\t\tadd_resource("${e.from}", -(${reqExpr}))`
    })
    const produceLines = outEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const baseOut = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, c.id)
      const outExpr = spec.type === 'all' ? baseOut : applyFlowStateModifiersGd(baseOut, e, doc)
      const edgeAct = collectNodeStateActivatorsGd('', doc, e.id)
      const indent = edgeAct.length ? `\t\tif ${edgeAct.join(' and ')}:\n\t\t\t` : '\t\t'
      const tgt = doc.nodes.find((n) => n.id === e.to)
      if (tgt?.kind === 'gate') {
        return `${indent}route_gate("${tgt.id}", ${outExpr})`
      }
      return `${indent}add_resource("${e.to}", ${outExpr})`
    })
    return `\tif converter_id == "${c.id}": # ${c.label}
${checkLines.length ? checkLines.join('\n') : '\t\tpass'}
${consumeLines.join('\n')}
${produceLines.join('\n')}
\t\tconverter_executed.emit("${c.id}")
\t\treturn true`
  })

  const gateBranches = gates.map((g) => {
    const outs = doc.edges.filter((e) => e.kind === 'resource' && e.from === g.id)
    const weights = outs.map((e) => {
      const cleaned = e.formula.replace('%', '').trim()
      return compileMxFormulaToGd(cleaned || '1', doc, g.id)
    })
    const targets = outs.map((e) => `"${e.to}"`)
    return `\tif gate_id == "${g.id}": # ${g.label} (${g.gateMode ?? 'random'})
\t\tvar weights: Array[float] = [${weights.join(', ')}]
\t\tvar targets: Array[String] = [${targets.join(', ')}]
\t\t_dispatch_gate_weighted(gate_id, amount, weights, targets, "${g.gateMode ?? 'random'}")
\t\treturn`
  })

  const endCheckLines = ends.flatMap((endNode) => {
    const stInputs = doc.edges.filter(
      (e) => e.kind === 'state' && !e.targetEdgeId && e.to === endNode.id
    )
    const fromIds = stInputs.map((e) => e.from)
    let joinedCond = ''
    if (endNode.formula?.trim()) {
      const stSpec = parseMxStateFormula(endNode.formula)
      if ((stSpec.type === 'activator' || stSpec.type === 'range') && stInputs[0]) {
        joinedCond = compileStateConditionToGd(endNode.formula, stInputs[0].from, doc, true) ?? ''
      } else {
        const exprGd = compileMxFormulaToGd(endNode.formula, doc, stInputs[0]?.from, fromIds)
        joinedCond = /[<>=!]/.test(endNode.formula) ? `(${exprGd})` : `(${exprGd}) != 0.0`
      }
    } else if (stInputs.length > 0) {
      const conds = stInputs
        .map((e) => compileStateConditionToGd(e.formula || '>=1', e.from, doc, true))
        .filter((c): c is string => Boolean(c))
      if (conds.length > 0) {
        joinedCond = conds.map((c) => `(${c})`).join(endNode.endMode === 'any' ? ' or ' : ' and ')
      }
    }
    if (!joinedCond) return []
    return [
      `\tif ${joinedCond}:\n\t\tended = true\n\t\teconomy_ended.emit("${endNode.label.replace(/"/g, "'")}")\n\t\treturn`
    ]
  })

  const autoConverterSteps = converters
    .filter((c) => c.trigger === 'automatic')
    .map((c) => `\texecute_converter("${c.id}") # ${c.label}`)

  // 编译数值工作台的乘区公式管线
  const wbStageLines = wb.multiplier.stages.map(
    (st) => `\tvars["${st.name}"] = ${compileMxFormulaToGd(st.formula, doc)}`
  )
  const wbFinalExpr = compileMxFormulaToGd(wb.multiplier.finalFormula, doc)

  return `# Auto-generated by AI Art Engine — Machinations & Numerical Workbench "${doc.title}"
extends Node
class_name GameEconomySimulator

signal pool_changed(pool_id: String, value: float)
signal converter_executed(converter_id: String)
signal economy_ended(reason: String)

var step: int = 0
var ended: bool = false
var gate_cursors: Dictionary = {}
var params: Dictionary = {
${params.map((p) => `\t"${mxIdentifier(p.name)}": ${p.value},`).join('\n')}
}
var pools: Dictionary = {
${pools.map((p) => `\t"${p.id}": ${Number(p.initial ?? 0).toFixed(2)}, # ${p.label}`).join('\n')}
}
var registers: Dictionary = {
${registers.map((r) => `\t"${r.id}": ${Number(r.initial ?? 0).toFixed(2)}, # ${r.label} (${r.formula || '0'})`).join('\n')}
}
var capacity: Dictionary = {
${pools
  .filter((p) => p.capacity && p.capacity > 0)
  .map((p) => `\t"${p.id}": ${p.capacity},`)
  .join('\n')}
}
var workbench_attrs: Dictionary = {
${wb.multiplier.attributes.map((a) => `\t"${a.name}": ${a.value}, # ${a.label}`).join('\n')}
}

func roll_dice(count: int, sides: int) -> float:
\tvar total: float = 0.0
\tfor _i in range(max(1, count)):
\t\ttotal += float(randi_range(1, max(1, sides)))
\treturn total

func mx_if(cond: Variant, val_true: float, val_false: float) -> float:
\treturn val_true if bool(cond) else val_false

func mx_diminish(x: float, k: float = 100.0, scale: float = 1.0) -> float:
\tvar pos_x: float = maxf(0.0, x)
\treturn scale * (pos_x / (pos_x + maxf(0.0001, k)))

func mx_add(a: float, b: float) -> float: return a + b
func mx_sub(a: float, b: float) -> float: return a - b
func mx_mul(a: float, b: float) -> float: return a * b
func mx_div(a: float, b: float) -> float: return 0.0 if absf(b) < 1e-9 else a / b
func mx_square(x: float) -> float: return x * x
func mx_cube(x: float) -> float: return x * x * x
func mx_cbrt(x: float) -> float: return signf(x) * pow(absf(x), 1.0 / 3.0)
func mx_log10(x: float) -> float: return log(maxf(1e-9, x)) / log(10.0)
func mx_log2(x: float) -> float: return log(maxf(1e-9, x)) / log(2.0)
func mx_larger(a: float, b: float) -> float: return 1.0 if a > b else 0.0
func mx_larger_eq(a: float, b: float) -> float: return 1.0 if a >= b else 0.0
func mx_smaller(a: float, b: float) -> float: return 1.0 if a < b else 0.0
func mx_smaller_eq(a: float, b: float) -> float: return 1.0 if a <= b else 0.0
func mx_equal(a: float, b: float) -> float: return 1.0 if absf(a - b) < 1e-6 else 0.0
func mx_unequal(a: float, b: float) -> float: return 1.0 if absf(a - b) >= 1e-6 else 0.0
func mx_and(a: float, b: float) -> float: return 1.0 if (absf(a) > 1e-6 and absf(b) > 1e-6) else 0.0
func mx_or(a: float, b: float) -> float: return 1.0 if (absf(a) > 1e-6 or absf(b) > 1e-6) else 0.0
func mx_not(a: float) -> float: return 1.0 if absf(a) <= 1e-6 else 0.0
func mx_xor(a: float, b: float) -> float: return 1.0 if ((absf(a) > 1e-6) != (absf(b) > 1e-6)) else 0.0

func get_pool(id: String) -> float:
\treturn float(pools.get(id, 0.0))

func get_param(name: String) -> float:
\treturn float(params.get(name, workbench_attrs.get(name, 0.0)))

func get_val(id: String) -> float:
\tif pools.has(id):
\t\treturn float(pools[id])
\tif registers.has(id):
\t\treturn float(registers[id])
\treturn float(params.get(id, workbench_attrs.get(id, 0.0)))

func get_var(name: String) -> float:
\treturn get_val(name)

func add_resource(id: String, amount: float) -> float:
\tif not pools.has(id):
\t\treturn 0.0
\tvar cap: float = float(capacity.get(id, INF))
\tvar before: float = get_pool(id)
\tvar next_val: float = clampf(before + amount, 0.0, cap)
\tpools[id] = next_val
\tpool_changed.emit(id, next_val)
\treturn next_val - before

func _dispatch_gate_weighted(gate_id: String, amount: float, weights: Array[float], targets: Array[String], mode: String) -> void:
\tif targets.is_empty():
\t\treturn
\tvar sum_w: float = 0.0
\tfor w in weights:
\t\tsum_w += maxf(0.0, w)
\tif sum_w <= 0.0:
\t\tadd_resource(targets[0], amount)
\t\treturn
\tif mode == "deterministic":
\t\tvar cur: int = int(gate_cursors.get(gate_id, 0))
\t\tgate_cursors[gate_id] = cur + 1
\t\tadd_resource(targets[cur % targets.size()], amount)
\t\treturn
\tvar roll: float = randf() * sum_w
\tfor i in range(targets.size()):
\t\troll -= maxf(0.0, weights[i])
\t\tif roll <= 0.0:
\t\t\tadd_resource(targets[i], amount)
\t\t\treturn
\tadd_resource(targets[targets.size() - 1], amount)

func route_gate(gate_id: String, amount: float) -> void:
${gateBranches.length ? gateBranches.join('\n') : '\tpass'}

func recompute_registers() -> void:
${registerSteps.length ? registerSteps.join('\n') : '\tpass'}

func can_convert(converter_id: String) -> bool:
${converterCanChecks.length ? converterCanChecks.join('\n') : '\tpass'}
\treturn false

func execute_converter(converter_id: String) -> bool:
${converterFuncs.length ? converterFuncs.join('\n') : '\tpass'}
\treturn false

func evaluate_damage_pipeline(overrides: Dictionary = {}) -> float:
\tvar vars: Dictionary = workbench_attrs.duplicate()
\tfor k in overrides.keys():
\t\tvars[k] = overrides[k]
\tfor k in vars.keys():
\t\tparams[k] = vars[k]
${wbStageLines.map((l) => `${l}\n\tparams = vars`).join('\n')}
\treturn float(${wbFinalExpr})

func step_economy() -> void:
\tif ended:
\t\treturn
\tstep += 1
\trecompute_registers()
${autoSourceSteps.length ? autoSourceSteps.join('\n') : '\tpass'}
${autoConverterSteps.join('\n')}
${autoDrainSteps.join('\n')}
\trecompute_registers()
${endCheckLines.join('\n')}
`
}

export function exportMxUnityCs(rawDoc: MxDocument): string {
  const doc = getMxSimulationDoc(rawDoc)
  const pools = doc.nodes.filter((n) => n.kind === 'pool')
  const registers = doc.nodes.filter((n) => n.kind === 'register')
  const converters = doc.nodes.filter((n) => n.kind === 'converter' || n.kind === 'trader')
  const gates = doc.nodes.filter((n) => n.kind === 'gate')
  const ends = doc.nodes.filter((n) => n.kind === 'end')
  const sources = doc.nodes.filter((n) => n.kind === 'source' && n.trigger === 'automatic')
  const drains = doc.nodes.filter((n) => n.kind === 'drain' && n.trigger === 'automatic')
  const wb =
    doc.workbench ?? createMxWorkbenchPreset(mapMxTemplateToWorkbenchPreset(doc.templateId))

  const registerSteps = registers.map((r) => {
    const stIns = doc.edges
      .filter((e) => e.kind === 'state' && !e.targetEdgeId && e.to === r.id)
      .map((e) => e.from)
    let exprCs = compileMxFormulaToCs(r.formula || (stIns.length ? 'a' : '0'), doc, stIns[0], stIns)
    if (r.min != null && Number.isFinite(r.min)) exprCs = `Mathf.Max(${r.min}f, (float)(${exprCs}))`
    if (r.max != null && Number.isFinite(r.max)) exprCs = `Mathf.Min(${r.max}f, (float)(${exprCs}))`
    return `        Registers["${r.id}"] = (float)(${exprCs}); // ${r.label}`
  })

  const autoSourceSteps = sources.flatMap((s) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.from === s.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const baseCs = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, s.id)
        const exprCs = applyFlowStateModifiersCs(baseCs, e, doc)
        const conds: string[] = collectNodeStateActivatorsCs(s.id, doc, e.id)
        const effEvery =
          spec.every ??
          (e.interval && /^\d+$/.test(e.interval.trim()) ? Number(e.interval.trim()) : undefined)
        if (effEvery && effEvery > 1) conds.push(`Step % ${effEvery} == 0`)
        let finalAmountCs = exprCs
        if (spec.type === 'expr' && spec.probability != null) {
          if (spec.probability <= 1) {
            conds.push(`UnityEngine.Random.value < ${spec.probability}f`)
          } else {
            finalAmountCs = `((${exprCs}) * (Mathf.Floor(${spec.probability}f) + (UnityEngine.Random.value < (${spec.probability}f % 1f) ? 1f : 0f)))`
          }
        }
        const prefix = conds.length ? `        if (${conds.join(' && ')}) ` : '        '
        const targetNode = doc.nodes.find((n) => n.id === e.to)
        if (targetNode?.kind === 'gate') {
          return `${prefix}RouteGate("${targetNode.id}", (float)(${finalAmountCs})); // ${s.label}`
        }
        return `${prefix}AddResource("${e.to}", (float)(${finalAmountCs})); // ${s.label}`
      })
  )

  const autoDrainSteps = drains.flatMap((d) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.to === d.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const baseCs =
          spec.type === 'all'
            ? `GetPool("${e.from}")`
            : compileMxFormulaToCs(spec.expr, doc, e.from)
        const exprCs = spec.type === 'all' ? baseCs : applyFlowStateModifiersCs(baseCs, e, doc)
        const conds: string[] = collectNodeStateActivatorsCs(d.id, doc, e.id)
        const effEvery =
          spec.every ??
          (e.interval && /^\d+$/.test(e.interval.trim()) ? Number(e.interval.trim()) : undefined)
        if (effEvery && effEvery > 1) conds.push(`Step % ${effEvery} == 0`)
        if (spec.type === 'expr' && spec.probability != null)
          conds.push(`UnityEngine.Random.value < ${spec.probability}f`)
        const prefix = conds.length ? `        if (${conds.join(' && ')}) ` : '        '
        return `${prefix}AddResource("${e.from}", -(float)(${exprCs})); // ${d.label}`
      })
  )

  const converterCanBlocks = converters.map((c) => {
    const stateConds = collectNodeStateActivatorsCs(c.id, doc)
    const stateChecks = stateConds.map((cond) => `            if (!(${cond})) return false;`)
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const checks = [
      ...stateChecks,
      ...inEdges.map((e) => {
        const edgeAct = collectNodeStateActivatorsCs('', doc, e.id)
        const spec = parseMxFlowFormula(e.formula)
        const baseReq = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, e.from)
        const reqCs = spec.type === 'all' ? baseReq : applyFlowStateModifiersCs(baseReq, e, doc)
        const actPrefix = edgeAct.map((ac) => `            if (!(${ac})) return false;\n`).join('')
        return `${actPrefix}            if (GetPool("${e.from}") + 1e-5f < (float)(${reqCs})) return false;`
      })
    ]
    return `        if (converterId == "${c.id}") // ${c.label}
        {
${checks.join('\n')}
            return true;
        }`
  })

  const converterBlocks = converters.map((c) => {
    const stateConds = collectNodeStateActivatorsCs(c.id, doc)
    const stateChecks = stateConds.map((cond) => `            if (!(${cond})) return false;`)
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const outEdges = doc.edges.filter((e) => e.kind === 'resource' && e.from === c.id)
    const checks = [
      ...stateChecks,
      ...inEdges.map((e) => {
        const edgeAct = collectNodeStateActivatorsCs('', doc, e.id)
        const spec = parseMxFlowFormula(e.formula)
        const baseReq = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, e.from)
        const reqCs = spec.type === 'all' ? baseReq : applyFlowStateModifiersCs(baseReq, e, doc)
        const actPrefix = edgeAct.map((ac) => `            if (!(${ac})) return false;\n`).join('')
        return `${actPrefix}            if (GetPool("${e.from}") + 1e-5f < (float)(${reqCs})) return false;`
      })
    ]
    const consumes = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const baseReq =
        spec.type === 'all' ? `GetPool("${e.from}")` : compileMxFormulaToCs(spec.expr, doc, e.from)
      const reqCs = spec.type === 'all' ? baseReq : applyFlowStateModifiersCs(baseReq, e, doc)
      return `            AddResource("${e.from}", -(float)(${reqCs}));`
    })
    const produces = outEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const baseOut = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, c.id)
      const outCs = spec.type === 'all' ? baseOut : applyFlowStateModifiersCs(baseOut, e, doc)
      const edgeAct = collectNodeStateActivatorsCs('', doc, e.id)
      const prefix = edgeAct.length ? `            if (${edgeAct.join(' && ')}) ` : '            '
      const tgt = doc.nodes.find((n) => n.id === e.to)
      if (tgt?.kind === 'gate') {
        return `${prefix}RouteGate("${tgt.id}", (float)(${outCs}));`
      }
      return `${prefix}AddResource("${e.to}", (float)(${outCs}));`
    })
    return `        if (converterId == "${c.id}") // ${c.label}
        {
${checks.join('\n')}
${consumes.join('\n')}
${produces.join('\n')}
            OnConverterExecuted?.Invoke("${c.id}");
            return true;
        }`
  })

  const gateBlocks = gates.map((g) => {
    const outs = doc.edges.filter((e) => e.kind === 'resource' && e.from === g.id)
    const weights = outs.map((e) => {
      const cleaned = e.formula.replace('%', '').trim()
      return `(float)(${compileMxFormulaToCs(cleaned || '1', doc, g.id)})`
    })
    const targets = outs.map((e) => `"${e.to}"`)
    return `        if (gateId == "${g.id}")
        {
            DispatchGateWeighted(gateId, amount, new float[] { ${weights.join(', ')} }, new string[] { ${targets.join(', ')} }, "${g.gateMode ?? 'random'}");
            return;
        }`
  })

  const endCheckBlocks = ends.flatMap((endNode) => {
    const stInputs = doc.edges.filter(
      (e) => e.kind === 'state' && !e.targetEdgeId && e.to === endNode.id
    )
    const fromIds = stInputs.map((e) => e.from)
    let joinedCond = ''
    if (endNode.formula?.trim()) {
      const stSpec = parseMxStateFormula(endNode.formula)
      if ((stSpec.type === 'activator' || stSpec.type === 'range') && stInputs[0]) {
        joinedCond = compileStateConditionToCs(endNode.formula, stInputs[0].from, doc, true) ?? ''
      } else {
        const exprCs = compileMxFormulaToCs(endNode.formula, doc, stInputs[0]?.from, fromIds)
        joinedCond = /[<>=!]/.test(endNode.formula) ? `(${exprCs})` : `((${exprCs}) != 0f)`
      }
    } else if (stInputs.length > 0) {
      const conds = stInputs
        .map((e) => compileStateConditionToCs(e.formula || '>=1', e.from, doc, true))
        .filter((c): c is string => Boolean(c))
      if (conds.length > 0) {
        joinedCond = conds.map((c) => `(${c})`).join(endNode.endMode === 'any' ? ' || ' : ' && ')
      }
    }
    if (!joinedCond) return []
    return [
      `        if (${joinedCond}) { Ended = true; OnEconomyEnded?.Invoke("${endNode.label.replace(/"/g, "'")}"); return; }`
    ]
  })

  const autoConverterSteps = converters
    .filter((c) => c.trigger === 'automatic')
    .map((c) => `        ExecuteConverter("${c.id}"); // ${c.label}`)

  const wbStageLines = wb.multiplier.stages.map(
    (st) => `        Params["${st.name}"] = (float)(${compileMxFormulaToCs(st.formula, doc)});`
  )
  const wbFinalCs = compileMxFormulaToCs(wb.multiplier.finalFormula, doc)

  return `// Auto-generated by AI Art Engine — Machinations & Numerical Workbench "${doc.title}"
using System;
using System.Collections.Generic;
using UnityEngine;

public class EconomyManager : MonoBehaviour
{
    public int Step { get; private set; }
    public bool Ended { get; private set; }
    public Dictionary<string, float> Pools { get; } = new Dictionary<string, float>();
    public Dictionary<string, float> Registers { get; } = new Dictionary<string, float>();
    public Dictionary<string, float> Capacity { get; } = new Dictionary<string, float>();
    public Dictionary<string, float> Params { get; } = new Dictionary<string, float>();
    public Dictionary<string, int> GateCursors { get; } = new Dictionary<string, int>();
    public event Action<string, float> OnPoolChanged;
    public event Action<string> OnConverterExecuted;
    public event Action<string> OnEconomyEnded;

    private void Awake()
    {
${pools.map((p) => `        Pools["${p.id}"] = ${Number(p.initial ?? 0)}f; // ${p.label}`).join('\n')}
${registers.map((r) => `        Registers["${r.id}"] = ${Number(r.initial ?? 0)}f; // ${r.label}`).join('\n')}
${pools
  .filter((p) => p.capacity && p.capacity > 0)
  .map((p) => `        Capacity["${p.id}"] = ${p.capacity}f;`)
  .join('\n')}
${doc.params.map((p) => `        Params["${mxIdentifier(p.name)}"] = ${p.value}f;`).join('\n')}
${wb.multiplier.attributes.map((a) => `        Params["${a.name}"] = ${a.value}f; // ${a.label}`).join('\n')}
        RecomputeRegisters();
    }

    public float RollDice(int count, int sides)
    {
        float sum = 0f;
        for (int i = 0; i < Mathf.Max(1, count); i++)
            sum += UnityEngine.Random.Range(1, Mathf.Max(2, sides + 1));
        return sum;
    }

    public float RollRangeInt(float lo, float hi) => UnityEngine.Random.Range(Mathf.CeilToInt(lo), Mathf.FloorToInt(hi) + 1);
    public float MxIf(float cond, float tVal, float fVal) => Mathf.Abs(cond) > 1e-6f ? tVal : fVal;
    public float MxIf(bool cond, float tVal, float fVal) => cond ? tVal : fVal;
    public float MxDiminish(float x, float k = 100f, float scale = 1f) => scale * (Mathf.Max(0f, x) / (Mathf.Max(0f, x) + Mathf.Max(0.0001f, k)));
    public float MxNorm(float mean = 0f, float std = 1f)
    {
        float u1 = Mathf.Max(1e-7f, UnityEngine.Random.value);
        float u2 = UnityEngine.Random.value;
        return mean + std * Mathf.Sqrt(-2f * Mathf.Log(u1)) * Mathf.Cos(2f * Mathf.PI * u2);
    }
    public float MxAdd(float a, float b) => a + b;
    public float MxSub(float a, float b) => a - b;
    public float MxMul(float a, float b) => a * b;
    public float MxDiv(float a, float b) => Mathf.Abs(b) < 1e-9f ? 0f : a / b;
    public float MxMod(float a, float b) => Mathf.Abs(b) < 1e-9f ? 0f : ((a % b) + b) % b;
    public float MxSquare(float x) => x * x;
    public float MxCube(float x) => x * x * x;
    public float MxCbrt(float x) => Mathf.Sign(x) * Mathf.Pow(Mathf.Abs(x), 1f / 3f);
    public float MxLarger(float a, float b) => a > b ? 1f : 0f;
    public float MxLargerEq(float a, float b) => a >= b ? 1f : 0f;
    public float MxSmaller(float a, float b) => a < b ? 1f : 0f;
    public float MxSmallerEq(float a, float b) => a <= b ? 1f : 0f;
    public float MxEqual(float a, float b) => Mathf.Abs(a - b) < 1e-5f ? 1f : 0f;
    public float MxUnequal(float a, float b) => Mathf.Abs(a - b) >= 1e-5f ? 1f : 0f;
    public float MxAnd(float a, float b) => (Mathf.Abs(a) > 1e-5f && Mathf.Abs(b) > 1e-5f) ? 1f : 0f;
    public float MxOr(float a, float b) => (Mathf.Abs(a) > 1e-5f || Mathf.Abs(b) > 1e-5f) ? 1f : 0f;
    public float MxNot(float a) => Mathf.Abs(a) <= 1e-5f ? 1f : 0f;
    public float MxXor(float a, float b) => ((Mathf.Abs(a) > 1e-5f) != (Mathf.Abs(b) > 1e-5f)) ? 1f : 0f;

    public float GetPool(string id) => Pools.TryGetValue(id, out var v) ? v : 0f;
    public float GetParam(string id) => Params.TryGetValue(id, out var v) ? v : 0f;
    public float GetVal(string id)
    {
        if (Pools.TryGetValue(id, out var p)) return p;
        if (Registers.TryGetValue(id, out var r)) return r;
        return Params.TryGetValue(id, out var v) ? v : 0f;
    }
    public float GetVar(string id) => GetVal(id);

    public float AddResource(string id, float amount)
    {
        if (!Pools.ContainsKey(id)) return 0f;
        var cap = Capacity.TryGetValue(id, out var c) ? c : float.PositiveInfinity;
        var before = GetPool(id);
        var next = Mathf.Clamp(before + amount, 0f, cap);
        Pools[id] = next;
        OnPoolChanged?.Invoke(id, next);
        return next - before;
    }

    private void DispatchGateWeighted(string gateId, float amount, float[] weights, string[] targets, string mode)
    {
        if (targets.Length == 0) return;
        float sumW = 0f;
        foreach (var w in weights) sumW += Mathf.Max(0f, w);
        if (sumW <= 0f) { AddResource(targets[0], amount); return; }
        if (mode == "deterministic")
        {
            GateCursors.TryGetValue(gateId, out var cur);
            GateCursors[gateId] = cur + 1;
            AddResource(targets[cur % targets.Length], amount);
            return;
        }
        float roll = UnityEngine.Random.value * sumW;
        for (int i = 0; i < targets.Length; i++)
        {
            roll -= Mathf.Max(0f, weights[i]);
            if (roll <= 0f) { AddResource(targets[i], amount); return; }
        }
        AddResource(targets[targets.Length - 1], amount);
    }

    public void RouteGate(string gateId, float amount)
    {
${gateBlocks.join('\n')}
    }

    public void RecomputeRegisters()
    {
${registerSteps.join('\n')}
    }

    public bool CanConvert(string converterId)
    {
${converterCanBlocks.join('\n')}
        return false;
    }

    public bool ExecuteConverter(string converterId)
    {
${converterBlocks.join('\n')}
        return false;
    }

    public float EvaluateDamagePipeline(Dictionary<string, float> overrides = null)
    {
        if (overrides != null)
            foreach (var kv in overrides) Params[kv.Key] = kv.Value;
${wbStageLines.join('\n')}
        return (float)(${wbFinalCs});
    }

    public void StepEconomy()
    {
        if (Ended) return;
        Step++;
        RecomputeRegisters();
${autoSourceSteps.join('\n')}
${autoConverterSteps.join('\n')}
${autoDrainSteps.join('\n')}
        RecomputeRegisters();
${endCheckBlocks.join('\n')}
    }
}
`
}

// ───────────────────────────── 预览渲染 ─────────────────────────────

function hexRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  if (c.length !== 6) return [59, 130, 246]
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]
}

function px(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  a = 1
): void {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return
  const i = (iy * w + ix) * 4
  buf[i] = buf[i]! * (1 - a) + rgb[0] * a
  buf[i + 1] = buf[i + 1]! * (1 - a) + rgb[1] * a
  buf[i + 2] = buf[i + 2]! * (1 - a) + rgb[2] * a
  buf[i + 3] = 255
}

function line(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
  thick = 1.5,
  dashed = false
): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
  const r = Math.max(0, Math.floor(thick / 2))
  for (let i = 0; i <= n; i++) {
    if (dashed && Math.floor(i / 5) % 2 === 1) continue
    const x = x0 + ((x1 - x0) * i) / n
    const y = y0 + ((y1 - y0) * i) / n
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) px(buf, w, h, x + dx, y + dy, rgb, 0.9)
  }
}

/** 预览图：上半部分为经济图（白底，Machinations 风格），下半部分为预测曲线（P10–P90 带 + P50 线） */
export function renderMxPreviewRgba(
  doc: MxDocument,
  fc: MxForecastResult,
  width = 640,
  height = 400
): { width: number; height: number; data: Uint8ClampedArray } {
  const buf = new Uint8ClampedArray(width * height * 4)
  const split = Math.floor(height * 0.6)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const dot = y < split && x % 16 === 0 && y % 16 === 0
      const v = y < split ? (dot ? 214 : 250) : 255
      buf[i] = v
      buf[i + 1] = v
      buf[i + 2] = y < split ? v : 255
      buf[i + 3] = 255
    }
  }
  for (let x = 0; x < width; x++) px(buf, width, height, x, split, [226, 232, 240])

  const nodes = doc.nodes.filter((n) => n.kind !== 'note')
  if (nodes.length) {
    const minX = Math.min(...nodes.map((n) => n.x))
    const maxX = Math.max(...nodes.map((n) => n.x))
    const minY = Math.min(...nodes.map((n) => n.y))
    const maxY = Math.max(...nodes.map((n) => n.y))
    const pad = 28
    const sx = (width - pad * 2) / Math.max(1, maxX - minX)
    const sy = (split - pad * 2) / Math.max(1, maxY - minY)
    const s = Math.min(sx, sy, 1.2)
    const ox = (width - (maxX - minX) * s) / 2
    const oy = (split - (maxY - minY) * s) / 2
    const pos = new Map(
      nodes.map((n) => [n.id, { x: ox + (n.x - minX) * s, y: oy + (n.y - minY) * s }])
    )
    for (const e of doc.edges) {
      const a = pos.get(e.from)
      const b = pos.get(e.to)
      if (!a || !b) continue
      const col: [number, number, number] = e.kind === 'state' ? [96, 165, 250] : [148, 163, 184]
      line(buf, width, height, a.x, a.y, b.x, b.y, col, 1.5, e.kind === 'state')
    }
    const r = 9
    for (const n of nodes) {
      const p = pos.get(n.id)!
      const rgb = hexRgb(mxNodeColor(doc, n))
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          let inside = false
          let rim = false
          switch (n.kind) {
            case 'pool': {
              const d = Math.hypot(dx, dy)
              inside = d <= r
              rim = d >= r - 2
              break
            }
            case 'source': {
              const half = ((dy + r) / (2 * r)) * r
              inside = Math.abs(dx) <= half
              rim = inside && (Math.abs(dx) >= half - 2 || dy >= r - 2)
              break
            }
            case 'drain': {
              const half = ((r - dy) / (2 * r)) * r
              inside = Math.abs(dx) <= half
              rim = inside && (Math.abs(dx) >= half - 2 || dy <= -r + 2)
              break
            }
            case 'gate': {
              const m = Math.abs(dx) + Math.abs(dy)
              inside = m <= r
              rim = m >= r - 2
              break
            }
            case 'converter':
            case 'trader': {
              const half = ((r - dx) / (2 * r)) * r
              inside = Math.abs(dy) <= half
              rim = inside && (Math.abs(dy) >= half - 2 || dx <= -r + 2)
              break
            }
            default:
              inside = true
              rim = Math.abs(dx) >= r - 2 || Math.abs(dy) >= r - 2
          }
          if (!inside) continue
          const filled = n.kind === 'register' || n.kind === 'end'
          px(buf, width, height, p.x + dx, p.y + dy, rim || filled ? rgb : [255, 255, 255], 1)
        }
      }
    }
  }

  // 曲线
  const left = 30
  const right = width - 14
  const top = split + 14
  const bottom = height - 16
  let maxV = 1
  for (const s of fc.series) for (const v of s.p90) if (v > maxV) maxV = v
  for (let x = left; x <= right; x++) px(buf, width, height, x, bottom, [203, 213, 225])
  const steps = Math.max(1, fc.steps)
  for (const s of fc.series) {
    const rgb = hexRgb(s.color)
    for (let x = left; x <= right; x++) {
      const t = ((x - left) / (right - left)) * steps
      const k0 = Math.floor(t)
      const k1 = Math.min(steps, k0 + 1)
      const f = t - k0
      const hi = (s.p90[k0] ?? 0) * (1 - f) + (s.p90[k1] ?? 0) * f
      const lo = (s.p10[k0] ?? 0) * (1 - f) + (s.p10[k1] ?? 0) * f
      const yHi = bottom - (hi / maxV) * (bottom - top)
      const yLo = bottom - (lo / maxV) * (bottom - top)
      for (let y = Math.floor(yHi); y <= yLo; y++) px(buf, width, height, x, y, rgb, 0.14)
    }
    for (let k = 0; k < steps; k++) {
      const x0 = left + (k / steps) * (right - left)
      const x1 = left + ((k + 1) / steps) * (right - left)
      const y0 = bottom - ((s.p50[k] ?? 0) / maxV) * (bottom - top)
      const y1 = bottom - ((s.p50[k + 1] ?? 0) / maxV) * (bottom - top)
      line(buf, width, height, x0, y0, x1, y1, rgb, 2)
    }
  }
  return { width, height, data: buf }
}
