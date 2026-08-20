type ComfyApiNode = {
  class_type?: string
  inputs?: Record<string, unknown>
  _meta?: { title?: string }
}

type ComfyApiWorkflow = Record<string, ComfyApiNode>

const SKIP_TYPES = new Set(['note', 'markdownnote', 'reroute'])

type UiLink = {
  id: number
  origin_id: number
  origin_slot: number
  target_id: number
  target_slot: number
}

type UiSlot = { name?: string; link?: number | null }

type UiNode = {
  id: number
  type: string
  mode?: number
  title?: string
  inputs?: UiSlot[]
  widgets_values_named?: Record<string, unknown>
  widgets_values?: unknown
}

type SubgraphDef = {
  id: string
  inputs?: Array<{ name?: string }>
  outputs?: Array<{ name?: string }>
  nodes?: UiNode[]
  links?: unknown[]
  definitions?: { subgraphs?: SubgraphDef[] }
}

function isMuted(node: UiNode): boolean {
  return node.mode === 2 || node.mode === 4
}

function prefixId(prefix: string, id: number | string): string {
  return prefix ? `${prefix}${id}` : String(id)
}

function parseLink(raw: unknown): UiLink | null {
  if (Array.isArray(raw) && raw.length >= 5) {
    return {
      id: Number(raw[0]),
      origin_id: Number(raw[1]),
      origin_slot: Number(raw[2]),
      target_id: Number(raw[3]),
      target_slot: Number(raw[4])
    }
  }
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>
    if (rec.origin_id == null || rec.target_id == null) return null
    return {
      id: Number(rec.id ?? 0),
      origin_id: Number(rec.origin_id),
      origin_slot: Number(rec.origin_slot ?? 0),
      target_id: Number(rec.target_id),
      target_slot: Number(rec.target_slot ?? 0)
    }
  }
  return null
}

function wrapWidgetValue(value: unknown): unknown {
  return Array.isArray(value) ? { __value__: value } : value
}

function collectSubgraphs(raw: unknown, into: Map<string, SubgraphDef>): void {
  if (!raw || typeof raw !== 'object') return
  const obj = raw as { definitions?: { subgraphs?: SubgraphDef[] }; subgraphs?: SubgraphDef[] }
  const list = obj.definitions?.subgraphs ?? obj.subgraphs ?? []
  for (const sg of list) {
    if (!sg?.id) continue
    into.set(String(sg.id), sg)
    collectSubgraphs(sg, into)
  }
}

function widgetInputs(node: UiNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const named = node.widgets_values_named
  if (named && typeof named === 'object') {
    for (const [key, value] of Object.entries(named)) {
      if (key === 'control_after_generate') continue
      out[key] = wrapWidgetValue(value)
    }
    return out
  }
  const values = node.widgets_values
  if (!Array.isArray(values)) return out
  let index = 0
  for (const slot of node.inputs ?? []) {
    if (!slot.name || slot.link != null) continue
    if (index >= values.length) break
    out[slot.name] = wrapWidgetValue(values[index])
    index += 1
  }
  return out
}

function resolveOrigin(
  originId: number,
  originSlot: number,
  prefix: string,
  outputSlots: Map<string, Array<[string, number] | undefined>>
): [string, number] {
  const id = prefixId(prefix, originId)
  const mapped = outputSlots.get(id)?.[originSlot]
  return mapped ?? [id, originSlot]
}

function convertGraph(
  graph: { nodes?: UiNode[]; links?: unknown[]; definitions?: { subgraphs?: SubgraphDef[] } },
  defs: Map<string, SubgraphDef>,
  prefix: string,
  outputSlots: Map<string, Array<[string, number] | undefined>>
): ComfyApiWorkflow {
  collectSubgraphs(graph, defs)
  const prompt: ComfyApiWorkflow = {}
  const links = (graph.links ?? []).map(parseLink).filter((row): row is UiLink => Boolean(row))
  const nodes = (graph.nodes ?? []).filter((node): node is UiNode => Boolean(node?.type))

  for (const node of nodes) {
    if (isMuted(node)) continue
    const def = defs.get(String(node.type))
    if (!def) continue
    const instanceId = prefixId(prefix, node.id)
    const expanded = expandSubgraph(node, def, defs, instanceId, prefix, links, outputSlots)
    Object.assign(prompt, expanded.prompt)
    outputSlots.set(instanceId, expanded.outputs)
  }

  for (const node of nodes) {
    if (isMuted(node)) continue
    if (defs.has(String(node.type))) continue
    if (SKIP_TYPES.has(String(node.type).toLowerCase())) continue
    if (node.id === -10 || node.id === -20) continue
    const id = prefixId(prefix, node.id)
    prompt[id] = {
      class_type: node.type,
      inputs: buildInputs(node, links, prefix, outputSlots),
      _meta: { title: String(node.title || node.type) }
    }
  }
  return prompt
}

function buildInputs(
  node: UiNode,
  links: UiLink[],
  prefix: string,
  outputSlots: Map<string, Array<[string, number] | undefined>>
): Record<string, unknown> {
  const inputs = widgetInputs(node)
  for (const slot of node.inputs ?? []) {
    if (!slot.name || slot.link == null) continue
    const link = links.find((row) => row.id === slot.link)
    if (!link) continue
    if (link.origin_id === -10) {
      inputs[slot.name] = ['-10', link.origin_slot]
      continue
    }
    inputs[slot.name] = resolveOrigin(link.origin_id, link.origin_slot, prefix, outputSlots)
  }
  return inputs
}

function expandSubgraph(
  instance: UiNode,
  def: SubgraphDef,
  defs: Map<string, SubgraphDef>,
  instanceId: string,
  outerPrefix: string,
  outerLinks: UiLink[],
  outerOutputSlots: Map<string, Array<[string, number] | undefined>>
): { prompt: ComfyApiWorkflow; outputs: Array<[string, number] | undefined> } {
  const innerPrefix = `${instanceId}:`
  const innerOutputSlots = new Map<string, Array<[string, number] | undefined>>()
  const prompt = convertGraph(def, defs, innerPrefix, innerOutputSlots)

  const inputValues: Array<unknown> = []
  for (let i = 0; i < (def.inputs ?? []).length; i++) {
    const spec = def.inputs![i]!
    const slot =
      (instance.inputs ?? []).find((row) => row.name === spec.name) ?? instance.inputs?.[i]
    if (slot?.link != null) {
      const link = outerLinks.find((row) => row.id === slot.link)
      if (link) {
        inputValues[i] = resolveOrigin(
          link.origin_id,
          link.origin_slot,
          outerPrefix,
          outerOutputSlots
        )
        continue
      }
    }
    const named = instance.widgets_values_named?.[spec.name ?? '']
    if (named !== undefined) inputValues[i] = wrapWidgetValue(named)
  }

  for (const node of Object.values(prompt)) {
    const inputs = (node.inputs ??= {})
    for (const [key, value] of Object.entries(inputs)) {
      if (!Array.isArray(value) || value.length !== 2) continue
      const origin = String(value[0])
      if (origin !== '-10' && !origin.endsWith(':-10')) continue
      const replacement = inputValues[Number(value[1])]
      if (replacement === undefined) delete inputs[key]
      else inputs[key] = replacement
    }
  }

  const outputs: Array<[string, number] | undefined> = []
  for (const link of (def.links ?? []).map(parseLink).filter((row): row is UiLink => Boolean(row))) {
    if (link.target_id !== -20) continue
    outputs[link.target_slot] = resolveOrigin(
      link.origin_id,
      link.origin_slot,
      innerPrefix,
      innerOutputSlots
    )
  }
  return { prompt, outputs }
}

export function isComfyUiGraphWorkflow(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && Array.isArray((raw as { nodes?: unknown }).nodes))
}

/** 把画布保存的 UI JSON（含 subgraph）转成 API prompt。 */
export function convertComfyUiWorkflowToApi(raw: unknown): ComfyApiWorkflow {
  if (!isComfyUiGraphWorkflow(raw)) {
    throw new Error('不是 ComfyUI UI 格式 workflow')
  }
  const graph = raw as {
    nodes?: UiNode[]
    links?: unknown[]
    definitions?: { subgraphs?: SubgraphDef[] }
  }
  const prompt = convertGraph(graph, new Map(), '', new Map())
  if (!Object.keys(prompt).length) {
    throw new Error('UI workflow 转换后没有可执行节点')
  }
  for (const node of Object.values(prompt)) {
    const inputs = node.inputs ?? {}
    for (const [key, value] of Object.entries(inputs)) {
      if (Array.isArray(value) && value.length === 2 && !prompt[String(value[0])]) {
        delete inputs[key]
      }
    }
  }
  return prompt
}
