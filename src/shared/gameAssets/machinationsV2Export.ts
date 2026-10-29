/**
 * Machinations v2 导出与预览渲染：Mermaid / 遥测 CSV / Godot 4 GDScript / Unity C# / RGBA 预览图。
 */
import {
  mxIdentifier,
  mxNodeColor,
  parseMxFlowFormula,
  parseMxStateFormula,
  type MxDocument,
  type MxForecastResult,
  type MxRunResult
} from './machinationsV2'
import { createMxWorkbenchPreset } from './gameNumericalWorkbench'

export function exportMxToMermaid(doc: MxDocument): string {
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
    lines.push(`  ${e.from} ${arrow}|"${esc(e.formula || '1')}"| ${e.to}`)
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

/**
 * 将 Machinations 公式表达式编译为合法的 Godot 4 GDScript 数学表达式。
 * 支持骰子（2D6 -> roll_dice(2, 6)）、函数（pow, min, max, floor, ceil, round, abs, sqrt, clamp, if, diminish, lerp）与节点/参数引用。
 */
export function compileMxFormulaToGd(
  exprRaw: string | undefined,
  doc: MxDocument,
  aNodeId?: string
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

  // 替换骰子 2D6 / D6
  let out = raw.replace(/\b(\d*)[dD](\d+)\b/g, (_m, cnt, sides) => {
    const c = cnt ? Number(cnt) : 1
    return `roll_dice(${c}, ${Number(sides)})`
  })

  // 替换幂运算符 ^ 为 pow
  out = out.replace(/([A-Za-z0-9_.)]+)\s*\^\s*([A-Za-z0-9_(.]+)/g, 'pow($1, $2)')

  // 替换内置函数与标识符
  out = out.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*(\()?/g,
    (full, ident: string, openParen?: string) => {
      if (openParen === '(') {
        const fn = ident.toLowerCase()
        if (fn === 'if') return 'mx_if('
        if (fn === 'diminish') return 'mx_diminish('
        if (fn === 'random') return 'randf_range('
        if (fn === 'randint') return 'randi_range('
        if (
          [
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
            'lerp',
            'smoothstep',
            'roll_dice'
          ].includes(fn)
        ) {
          return `${fn}(`
        }
        return full
      }
      if (ident === 'step' || ident === 't') return 'float(step)'
      if ((ident === 'a' || ident === 'self') && aNodeId) return `get_val("${aNodeId}")`
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
  aNodeId?: string
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

  let out = raw.replace(/\b(\d*)[dD](\d+)\b/g, (_m, cnt, sides) => {
    const c = cnt ? Number(cnt) : 1
    return `RollDice(${c}, ${Number(sides)})`
  })

  out = out.replace(/([A-Za-z0-9_.)]+)\s*\^\s*([A-Za-z0-9_(.]+)/g, 'Mathf.Pow($1, $2)')

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
          sqrt: 'Mathf.Sqrt',
          pow: 'Mathf.Pow',
          log: 'Mathf.Log',
          clamp: 'Mathf.Clamp',
          lerp: 'Mathf.Lerp',
          if: 'MxIf',
          diminish: 'MxDiminish',
          random: 'UnityEngine.Random.Range',
          randint: 'RollRangeInt',
          roll_dice: 'RollDice',
          rolldice: 'RollDice'
        }
        if (csFnMap[fn]) return `${csFnMap[fn]}(`
        return full
      }
      if (ident === 'step' || ident === 't') return '((float)Step)'
      if ((ident === 'a' || ident === 'self') && aNodeId) return `GetVal("${aNodeId}")`
      if (paramNames.has(ident)) return `GetParam("${ident}")`
      const mappedId = nodeByIdent.get(ident)
      if (mappedId) return `GetVal("${mappedId}")`
      return `GetVar("${ident}")`
    }
  )

  return out
}

export function exportMxGodotGd(doc: MxDocument): string {
  const pools = doc.nodes.filter((n) => n.kind === 'pool')
  const registers = doc.nodes.filter((n) => n.kind === 'register')
  const converters = doc.nodes.filter((n) => n.kind === 'converter' || n.kind === 'trader')
  const gates = doc.nodes.filter((n) => n.kind === 'gate')
  const ends = doc.nodes.filter((n) => n.kind === 'end')
  const sources = doc.nodes.filter((n) => n.kind === 'source' && n.trigger === 'automatic')
  const drains = doc.nodes.filter((n) => n.kind === 'drain' && n.trigger === 'automatic')
  const params = doc.params
  const wb = doc.workbench ?? createMxWorkbenchPreset('slay_the_spire_dbg')

  const registerSteps = registers.map((r) => {
    const stIn = doc.edges.find((e) => e.kind === 'state' && e.to === r.id)
    const exprGd = compileMxFormulaToGd(r.formula || '0', doc, stIn?.from)
    return `\tregisters["${r.id}"] = ${exprGd} # ${r.label}`
  })

  const autoSourceSteps = sources.flatMap((s) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.from === s.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const exprGd = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, s.id)
        const conds: string[] = []
        if (spec.type === 'expr' && spec.every && spec.every > 1)
          conds.push(`step % ${spec.every} == 0`)
        if (spec.type === 'expr' && spec.probability != null)
          conds.push(`randf() < ${spec.probability}`)
        const prefix = conds.length ? `\tif ${conds.join(' and ')}:\n\t\t` : '\t'
        const targetNode = doc.nodes.find((n) => n.id === e.to)
        if (targetNode?.kind === 'gate') {
          return `${prefix}route_gate("${targetNode.id}", ${exprGd}) # ${s.label} -> ${targetNode.label}`
        }
        return `${prefix}add_resource("${e.to}", ${exprGd}) # ${s.label} -> ${e.to}`
      })
  )

  const autoDrainSteps = drains.flatMap((d) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.to === d.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const exprGd =
          spec.type === 'all'
            ? `get_pool("${e.from}")`
            : compileMxFormulaToGd(spec.expr, doc, e.from)
        const conds: string[] = []
        if (spec.type === 'expr' && spec.every && spec.every > 1)
          conds.push(`step % ${spec.every} == 0`)
        if (spec.type === 'expr' && spec.probability != null)
          conds.push(`randf() < ${spec.probability}`)
        const prefix = conds.length ? `\tif ${conds.join(' and ')}:\n\t\t` : '\t'
        return `${prefix}add_resource("${e.from}", -(${exprGd})) # ${e.from} -> ${d.label}`
      })
  )

  const converterCanChecks = converters.map((c) => {
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const checkLines = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const reqExpr = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, e.from)
      return `\t\tif get_pool("${e.from}") + 1e-6 < (${reqExpr}): return false`
    })
    return `\tif converter_id == "${c.id}": # ${c.label}
${checkLines.length ? checkLines.join('\n') : '\t\tpass'}
\t\treturn true`
  })

  const converterFuncs = converters.map((c) => {
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const outEdges = doc.edges.filter((e) => e.kind === 'resource' && e.from === c.id)
    const checkLines = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const reqExpr = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, e.from)
      return `\t\tif get_pool("${e.from}") + 1e-6 < (${reqExpr}): return false`
    })
    const consumeLines = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const reqExpr =
        spec.type === 'all' ? `get_pool("${e.from}")` : compileMxFormulaToGd(spec.expr, doc, e.from)
      return `\t\tadd_resource("${e.from}", -(${reqExpr}))`
    })
    const produceLines = outEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const outExpr = spec.type === 'all' ? '1.0' : compileMxFormulaToGd(spec.expr, doc, c.id)
      const tgt = doc.nodes.find((n) => n.id === e.to)
      if (tgt?.kind === 'gate') {
        return `\t\troute_gate("${tgt.id}", ${outExpr})`
      }
      return `\t\tadd_resource("${e.to}", ${outExpr})`
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

  const endCheckLines = ends.flatMap((endNode) =>
    doc.edges
      .filter((e) => e.kind === 'state' && e.to === endNode.id)
      .map((e) => {
        const spec = parseMxStateFormula(e.formula || endNode.formula || '>=1')
        let condExpr = `get_val("${e.from}") >= 1.0`
        if (spec.type === 'activator') {
          condExpr = `get_val("${e.from}") ${spec.op} ${spec.value}`
        } else if (spec.type === 'expr') {
          condExpr = compileMxFormulaToGd(spec.expr, doc, e.from)
        }
        return `\tif ${condExpr}:\n\t\tended = true\n\t\teconomy_ended.emit("${endNode.label.replace(/"/g, "'")}")\n\t\treturn`
      })
  )

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

export function exportMxUnityCs(doc: MxDocument): string {
  const pools = doc.nodes.filter((n) => n.kind === 'pool')
  const registers = doc.nodes.filter((n) => n.kind === 'register')
  const converters = doc.nodes.filter((n) => n.kind === 'converter' || n.kind === 'trader')
  const gates = doc.nodes.filter((n) => n.kind === 'gate')
  const ends = doc.nodes.filter((n) => n.kind === 'end')
  const sources = doc.nodes.filter((n) => n.kind === 'source' && n.trigger === 'automatic')
  const drains = doc.nodes.filter((n) => n.kind === 'drain' && n.trigger === 'automatic')
  const wb = doc.workbench ?? createMxWorkbenchPreset('slay_the_spire_dbg')

  const registerSteps = registers.map((r) => {
    const stIn = doc.edges.find((e) => e.kind === 'state' && e.to === r.id)
    const exprCs = compileMxFormulaToCs(r.formula || '0', doc, stIn?.from)
    return `        Registers["${r.id}"] = (float)(${exprCs}); // ${r.label}`
  })

  const autoSourceSteps = sources.flatMap((s) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.from === s.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const exprCs = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, s.id)
        const conds: string[] = []
        if (spec.type === 'expr' && spec.every && spec.every > 1)
          conds.push(`Step % ${spec.every} == 0`)
        if (spec.type === 'expr' && spec.probability != null)
          conds.push(`UnityEngine.Random.value < ${spec.probability}f`)
        const prefix = conds.length ? `        if (${conds.join(' && ')}) ` : '        '
        const targetNode = doc.nodes.find((n) => n.id === e.to)
        if (targetNode?.kind === 'gate') {
          return `${prefix}RouteGate("${targetNode.id}", (float)(${exprCs})); // ${s.label}`
        }
        return `${prefix}AddResource("${e.to}", (float)(${exprCs})); // ${s.label}`
      })
  )

  const autoDrainSteps = drains.flatMap((d) =>
    doc.edges
      .filter((e) => e.kind === 'resource' && e.to === d.id)
      .map((e) => {
        const spec = parseMxFlowFormula(e.formula)
        const exprCs =
          spec.type === 'all'
            ? `GetPool("${e.from}")`
            : compileMxFormulaToCs(spec.expr, doc, e.from)
        const conds: string[] = []
        if (spec.type === 'expr' && spec.every && spec.every > 1)
          conds.push(`Step % ${spec.every} == 0`)
        if (spec.type === 'expr' && spec.probability != null)
          conds.push(`UnityEngine.Random.value < ${spec.probability}f`)
        const prefix = conds.length ? `        if (${conds.join(' && ')}) ` : '        '
        return `${prefix}AddResource("${e.from}", -(float)(${exprCs})); // ${d.label}`
      })
  )

  const converterCanBlocks = converters.map((c) => {
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const checks = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const reqCs = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, e.from)
      return `            if (GetPool("${e.from}") + 1e-5f < (float)(${reqCs})) return false;`
    })
    return `        if (converterId == "${c.id}") // ${c.label}
        {
${checks.join('\n')}
            return true;
        }`
  })

  const converterBlocks = converters.map((c) => {
    const inEdges = doc.edges.filter((e) => e.kind === 'resource' && e.to === c.id)
    const outEdges = doc.edges.filter((e) => e.kind === 'resource' && e.from === c.id)
    const checks = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const reqCs = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, e.from)
      return `            if (GetPool("${e.from}") + 1e-5f < (float)(${reqCs})) return false;`
    })
    const consumes = inEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const reqCs =
        spec.type === 'all' ? `GetPool("${e.from}")` : compileMxFormulaToCs(spec.expr, doc, e.from)
      return `            AddResource("${e.from}", -(float)(${reqCs}));`
    })
    const produces = outEdges.map((e) => {
      const spec = parseMxFlowFormula(e.formula)
      const outCs = spec.type === 'all' ? '1f' : compileMxFormulaToCs(spec.expr, doc, c.id)
      const tgt = doc.nodes.find((n) => n.id === e.to)
      if (tgt?.kind === 'gate') {
        return `            RouteGate("${tgt.id}", (float)(${outCs}));`
      }
      return `            AddResource("${e.to}", (float)(${outCs}));`
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

  const endCheckBlocks = ends.flatMap((endNode) =>
    doc.edges
      .filter((e) => e.kind === 'state' && e.to === endNode.id)
      .map((e) => {
        const spec = parseMxStateFormula(e.formula || endNode.formula || '>=1')
        let condCs = `GetVal("${e.from}") >= 1f`
        if (spec.type === 'activator') {
          condCs = `GetVal("${e.from}") ${spec.op} ${spec.value}f`
        } else if (spec.type === 'expr') {
          condCs = `(${compileMxFormulaToCs(spec.expr, doc, e.from)}) != 0f`
        }
        return `        if (${condCs}) { Ended = true; OnEconomyEnded?.Invoke("${endNode.label.replace(/"/g, "'")}"); return; }`
      })
  )

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
