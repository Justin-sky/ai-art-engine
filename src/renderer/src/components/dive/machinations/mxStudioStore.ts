/**
 * Machinations 工作台状态（provide / inject 共享给画布、属性面板、结果面板、抽屉）。
 */
import { computed, inject, provide, reactive, ref, shallowRef, type InjectionKey } from 'vue'
import {
  autoLayoutMxDocument,
  createMxFromTemplate,
  createMxInitialState,
  createMxNode,
  createMxWorkbenchPreset,
  generateMxAgentWithAi,
  mxNewId,
  normalizeMxDocument,
  runMxAgentArena,
  runMxForecast,
  runMxSimulation,
  stepMxSimulation,
  suggestMxAgentGoalsWithAi,
  type MxAgent,
  type MxDocument,
  type MxEdge,
  type MxEdgeKind,
  type MxEvent,
  type MxForecastResult,
  type MxGroup,
  type MxNode,
  type MxNodeKind,
  type MxNumericalWorkbench,
  type MxRunResult,
  type MxRuntimeState,
  type MxTemplateId,
  type MxTunableKind,
  type MxWorkbenchPresetId
} from '@shared/gameAssets'

export type MxTool = 'select' | MxNodeKind | 'resource_edge' | 'state_edge'
export type MxDrawer =
  '' | 'agents' | 'templates' | 'resources' | 'params' | 'layers' | 'clips' | 'history' | 'docs'
export type MxMode = 'build' | 'scenarios'
export type MxCanvasTheme = 'auto' | 'light' | 'dark'

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function createMxStudioStore(initial: MxDocument) {
  const doc = ref<MxDocument>(normalizeMxDocument(clone(initial)))
  const undoStack: string[] = []
  const redoStack: string[] = []
  const historyRev = ref(0)

  const selection = reactive<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] })
  const tool = ref<MxTool>('select')
  const drawer = ref<MxDrawer>('')
  const mode = ref<MxMode>('build')
  const inspectorOpen = ref(true)
  const resultsOpen = ref(true)
  const resultsTab = ref<'results' | 'diagnostics' | 'balancer' | 'workbench' | 'debugger'>(
    'results'
  )
  const canvasTheme = ref<MxCanvasTheme>('auto')
  const snapToGrid = ref(true)
  const flowHeatmap = ref(false)
  const view = reactive({ x: 0, y: 0, zoom: 0.8 })

  // 运行
  const runs = shallowRef<MxRunResult[]>([])
  const activeRunId = ref('')
  const compareRunIds = ref<string[]>([])
  const playStep = ref(0)
  const playing = ref(false)
  const liveState = shallowRef<MxRuntimeState | null>(null)
  const liveEvents = shallowRef<MxEvent[]>([])
  const liveSnapshots = shallowRef<Array<Record<string, number>>>([])
  const liveFlows = shallowRef<Array<Record<string, number>>>([])
  const forecast = shallowRef<MxForecastResult | null>(null)
  const forecastRuns = ref(50)
  const focusedSeriesId = ref('')
  const hoverStep = ref<number | null>(null)
  let playTimer: ReturnType<typeof setInterval> | null = null
  let pendingInteractions: string[] = []

  const activeRun = computed(() => runs.value.find((r) => r.id === activeRunId.value) ?? null)

  /** 当前在画布上显示的数值：正在播放 → 实时状态；否则 → 选中运行在 playStep 的快照 */
  const displayValues = computed<Record<string, number> | null>(() => {
    const run = activeRun.value
    if (run) return run.snapshots[Math.min(playStep.value, run.snapshots.length - 1)] ?? null
    if (liveSnapshots.value.length) {
      return (
        liveSnapshots.value[Math.min(playStep.value, liveSnapshots.value.length - 1)] ??
        liveState.value?.values ??
        null
      )
    }
    return liveState.value?.values ?? null
  })
  const previousStepValues = computed<Record<string, number> | null>(() => {
    const step = playStep.value
    if (step <= 0) return null
    const run = activeRun.value
    if (run) return run.snapshots[Math.max(0, Math.min(step - 1, run.snapshots.length - 1))] ?? null
    if (liveSnapshots.value.length >= 2) {
      const idx = Math.max(0, Math.min(step - 1, liveSnapshots.value.length - 2))
      return liveSnapshots.value[idx] ?? null
    }
    return null
  })
  const displayFlows = computed<Record<string, number>>(() => {
    const run = activeRun.value
    if (!run) {
      if (liveFlows.value.length) {
        const idx = Math.min(playStep.value, liveFlows.value.length - 1)
        return liveFlows.value[idx] ?? liveState.value?.edgeFlows ?? {}
      }
      return liveState.value?.edgeFlows ?? {}
    }
    const idx = Math.min(playStep.value, run.edgeFlows.length - 1)
    const direct = run.edgeFlows[idx] ?? {}
    if (Object.keys(direct).length > 0 || idx <= 0) return direct
    // 若最后一步因 End 条件终止导致当步无流量，回退展示最近一步的有效流量，保证画布流动动画可见
    for (let s = idx - 1; s >= 1; s--) {
      const prevFlow = run.edgeFlows[s]
      if (prevFlow && Object.keys(prevFlow).length > 0) return prevFlow
    }
    return direct
  })

  /** 截至当前步数的各连线累计流量与相对占比（供 Sankey 流量热力视图使用） */
  const edgeCumulativeFlows = computed<Record<string, { total: number; share: number }>>(() => {
    const run = activeRun.value
    const flowsArr = run ? run.edgeFlows : liveFlows.value
    const maxIdx = Math.min(playStep.value, flowsArr.length - 1)
    const totals: Record<string, number> = {}
    let maxTotal = 0
    for (let i = 1; i <= maxIdx; i++) {
      const f = flowsArr[i]
      if (!f) continue
      for (const [eid, amt] of Object.entries(f)) {
        const next = Math.round(((totals[eid] ?? 0) + amt) * 100) / 100
        totals[eid] = next
        if (next > maxTotal) maxTotal = next
      }
    }
    const out: Record<string, { total: number; share: number }> = {}
    for (const [eid, total] of Object.entries(totals)) {
      out[eid] = {
        total,
        share: maxTotal > 0 ? Math.min(1, total / maxTotal) : 0
      }
    }
    return out
  })

  /** 节点瓶颈徽章（饥饿阻塞的 Converter / 爆仓或枯竭的 Pool） */
  const nodeBottlenecks = computed<
    Record<string, { kind: 'blocked' | 'capped' | 'depleted'; badge: string }>
  >(() => {
    const out: Record<string, { kind: 'blocked' | 'capped' | 'depleted'; badge: string }> = {}
    const evs = activeRun.value ? activeRun.value.events : liveEvents.value
    const stepLimit = playStep.value
    const blockedCounts: Record<string, number> = {}
    for (const ev of evs) {
      if (ev.step <= stepLimit && ev.type === 'blocked' && ev.nodeId) {
        blockedCounts[ev.nodeId] = (blockedCounts[ev.nodeId] ?? 0) + 1
      }
    }
    for (const [nid, cnt] of Object.entries(blockedCounts)) {
      if (cnt > 0) out[nid] = { kind: 'blocked', badge: `⚠ ×${cnt}` }
    }
    const vals = displayValues.value
    if (vals && stepLimit > 0) {
      for (const n of doc.value.nodes) {
        if (n.kind !== 'pool') continue
        const v = vals[n.id] ?? 0
        if (n.capacity && n.capacity > 0 && v >= n.capacity) {
          out[n.id] = { kind: 'capped', badge: 'MAX' }
        } else if (v <= 0 && (n.initial ?? 0) > 0) {
          out[n.id] = { kind: 'depleted', badge: '0!' }
        }
      }
    }
    return out
  })

  // ───────── 编辑 ─────────
  function snapshotForUndo(): void {
    undoStack.push(JSON.stringify(doc.value))
    if (undoStack.length > 100) undoStack.shift()
    redoStack.length = 0
    historyRev.value++
  }

  /** 修改文档（自动入撤销栈）；coalesceKey 相同的连续修改合并为一次撤销 */
  let lastCoalesce = ''
  let lastCoalesceAt = 0
  function mutate(fn: (d: MxDocument) => void, coalesceKey = ''): void {
    const now = Date.now()
    if (!coalesceKey || coalesceKey !== lastCoalesce || now - lastCoalesceAt > 800)
      snapshotForUndo()
    lastCoalesce = coalesceKey
    lastCoalesceAt = now
    const next = clone(doc.value)
    fn(next)
    doc.value = next
  }

  function replaceDoc(next: MxDocument, recordUndo = true): void {
    if (recordUndo) snapshotForUndo()
    doc.value = normalizeMxDocument(clone(next))
    selection.nodes = []
    selection.edges = []
    resetPlayback()
    runs.value = []
    activeRunId.value = ''
    forecast.value = null
  }

  const canUndo = computed(() => (historyRev.value, undoStack.length > 0))
  const canRedo = computed(() => (historyRev.value, redoStack.length > 0))

  function undo(): void {
    const prev = undoStack.pop()
    if (!prev) return
    redoStack.push(JSON.stringify(doc.value))
    doc.value = JSON.parse(prev) as MxDocument
    historyRev.value++
    pruneSelection()
  }

  function redo(): void {
    const next = redoStack.pop()
    if (!next) return
    undoStack.push(JSON.stringify(doc.value))
    doc.value = JSON.parse(next) as MxDocument
    historyRev.value++
    pruneSelection()
  }

  function pruneSelection(): void {
    const nodeIds = new Set(doc.value.nodes.map((n) => n.id))
    const edgeIds = new Set(doc.value.edges.map((e) => e.id))
    selection.nodes = selection.nodes.filter((id) => nodeIds.has(id))
    selection.edges = selection.edges.filter((id) => edgeIds.has(id))
  }

  function select(nodes: string[], edges: string[] = [], additive = false): void {
    if (additive) {
      selection.nodes = Array.from(new Set([...selection.nodes, ...nodes]))
      selection.edges = Array.from(new Set([...selection.edges, ...edges]))
    } else {
      selection.nodes = nodes
      selection.edges = edges
    }
  }

  function addNode(kind: MxNodeKind, x: number, y: number): MxNode {
    const node = createMxNode(kind, x, y)
    const sameKind = doc.value.nodes.filter((n) => n.kind === kind).length
    node.label = `${node.label}${sameKind ? ` ${sameKind + 1}` : ''}`
    if (kind === 'pool' || kind === 'source') node.resourceId = doc.value.resources[0]?.id
    const layer = doc.value.layers.find((l) => l.visible && !l.locked)
    if (layer) node.layerId = layer.id
    mutate((d) => {
      d.nodes.push(node)
    })
    select([node.id])
    return node
  }

  function addEdge(kind: MxEdgeKind, from: string, to: string): MxEdge | null {
    if (from === to) return null
    const edge: MxEdge = {
      id: mxNewId(kind === 'state' ? 'st' : 'rs'),
      kind,
      from,
      to,
      formula: kind === 'state' ? '+1' : '1'
    }
    mutate((d) => {
      d.edges.push(edge)
    })
    select([], [edge.id])
    return edge
  }

  /** 状态边直接连向另一条连线的公式标签（边修饰器 / 边激活器） */
  function addEdgeToEdge(fromNodeId: string, targetEdgeId: string): MxEdge | null {
    const targetEdge = doc.value.edges.find((e) => e.id === targetEdgeId)
    if (!targetEdge || targetEdge.from === fromNodeId) return null
    const edge: MxEdge = {
      id: mxNewId('st'),
      kind: 'state',
      from: fromNodeId,
      to: targetEdge.from,
      targetEdgeId,
      formula: '+1'
    }
    mutate((d) => {
      d.edges.push(edge)
    })
    select([], [edge.id])
    return edge
  }

  function reverseEdge(id: string): void {
    mutate((d) => {
      const e = d.edges.find((x) => x.id === id)
      if (!e || e.targetEdgeId) return
      const tmp = e.from
      e.from = e.to
      e.to = tmp
      if (e.bend) e.bend = -e.bend
    })
  }

  function toggleEdgeKind(id: string): void {
    mutate((d) => {
      const e = d.edges.find((x) => x.id === id)
      if (!e) return
      e.kind = e.kind === 'state' ? 'resource' : 'state'
      if (e.kind === 'resource') e.targetEdgeId = undefined
      if (e.kind === 'state' && e.formula === '1') e.formula = '+1'
      if (e.kind === 'resource' && e.formula === '+1') e.formula = '1'
    })
  }

  function autoLayout(): void {
    mutate((d) => {
      autoLayoutMxDocument(d)
    })
  }

  function deleteSelection(): void {
    if (!selection.nodes.length && !selection.edges.length) return
    const nodeSet = new Set(selection.nodes)
    const edgeSet = new Set(selection.edges)
    mutate((d) => {
      d.nodes = d.nodes.filter((n) => !nodeSet.has(n.id))
      d.edges = d.edges.filter(
        (e) => !edgeSet.has(e.id) && !nodeSet.has(e.from) && !nodeSet.has(e.to)
      )
    })
    select([])
  }

  function updateNode(id: string, patch: Partial<MxNode>, coalesce = ''): void {
    mutate(
      (d) => {
        const n = d.nodes.find((x) => x.id === id)
        if (n) Object.assign(n, patch)
      },
      coalesce || `node:${id}:${Object.keys(patch).join(',')}`
    )
  }

  function updateEdge(id: string, patch: Partial<MxEdge>, coalesce = ''): void {
    mutate(
      (d) => {
        const e = d.edges.find((x) => x.id === id)
        if (e) Object.assign(e, patch)
      },
      coalesce || `edge:${id}:${Object.keys(patch).join(',')}`
    )
  }

  function moveNodes(ids: string[], dx: number, dy: number, coalesce: string): void {
    const set = new Set(ids)
    mutate((d) => {
      for (const n of d.nodes) {
        if (!set.has(n.id)) continue
        n.x = Math.round(n.x + dx)
        n.y = Math.round(n.y + dy)
      }
    }, coalesce)
  }

  // ───────── 子系统分组容器 (Groups / Subsystem Frames) ─────────
  function createGroupFromSelection(label?: string): MxGroup | null {
    const selectedNodes = doc.value.nodes.filter((n) => selection.nodes.includes(n.id))
    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4']
    const groupIdx = (doc.value.groups?.length ?? 0) + 1
    let x = 140
    let y = 120
    let width = 320
    let height = 200
    if (selectedNodes.length > 0) {
      const minX = Math.min(...selectedNodes.map((n) => n.x)) - 56
      const maxX = Math.max(...selectedNodes.map((n) => n.x)) + 56
      const minY = Math.min(...selectedNodes.map((n) => n.y)) - 54
      const maxY = Math.max(...selectedNodes.map((n) => n.y)) + 64
      x = Math.round(minX)
      y = Math.round(minY)
      width = Math.max(180, Math.round(maxX - minX))
      height = Math.max(130, Math.round(maxY - minY))
    }
    const grp: MxGroup = {
      id: mxNewId('grp'),
      label: label || `Subsystem ${groupIdx}`,
      x,
      y,
      width,
      height,
      color: colors[(groupIdx - 1) % colors.length]
    }
    mutate((d) => {
      d.groups = [...(d.groups ?? []), grp]
    })
    return grp
  }

  function moveGroup(groupId: string, dx: number, dy: number, coalesce: string): void {
    mutate((d) => {
      const g = d.groups?.find((x) => x.id === groupId)
      if (!g) return
      const x0 = g.x
      const y0 = g.y
      const x1 = g.x + g.width
      const y1 = g.y + g.height
      g.x = Math.round(g.x + dx)
      g.y = Math.round(g.y + dy)
      for (const n of d.nodes) {
        if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) {
          n.x = Math.round(n.x + dx)
          n.y = Math.round(n.y + dy)
        }
      }
    }, coalesce)
  }

  function updateGroup(id: string, patch: Partial<MxGroup>, coalesce = ''): void {
    mutate(
      (d) => {
        const g = d.groups?.find((x) => x.id === id)
        if (g) Object.assign(g, patch)
      },
      coalesce || `grp:${id}`
    )
  }

  function deleteGroup(id: string): void {
    mutate((d) => {
      d.groups = (d.groups ?? []).filter((g) => g.id !== id)
    })
  }

  /** 将 Goal-Seek 求解出的最优变量值一键回写到文档并立即重新运行模拟 */
  function applyTunableValue(kind: MxTunableKind, id: string, val: number): void {
    const rounded = Math.round(val * 1000) / 1000
    mutate((d) => {
      if (kind === 'param') {
        const p = d.params.find((x) => x.name === id || x.id === id)
        if (p) p.value = rounded
        else d.params.push({ id: mxNewId('p'), name: id, value: rounded })
      } else if (kind === 'edge') {
        const e = d.edges.find((x) => x.id === id)
        if (e)
          e.formula = e.kind === 'state' ? `${rounded >= 0 ? '+' : ''}${rounded}` : String(rounded)
      } else if (kind === 'node_initial') {
        const n = d.nodes.find((x) => x.id === id)
        if (n) n.initial = rounded
      }
    })
    playAgain()
  }

  function applyTunablePair(
    k1: MxTunableKind,
    id1: string,
    v1: number,
    k2: MxTunableKind,
    id2: string,
    v2: number
  ): void {
    const applyOne = (d: MxDocument, kind: MxTunableKind, id: string, val: number): void => {
      const rounded = Math.round(val * 1000) / 1000
      if (kind === 'param') {
        const p = d.params.find((x) => x.name === id || x.id === id)
        if (p) p.value = rounded
        else d.params.push({ id: mxNewId('p'), name: id, value: rounded })
      } else if (kind === 'edge') {
        const e = d.edges.find((x) => x.id === id)
        if (e)
          e.formula = e.kind === 'state' ? `${rounded >= 0 ? '+' : ''}${rounded}` : String(rounded)
      } else if (kind === 'node_initial') {
        const n = d.nodes.find((x) => x.id === id)
        if (n) n.initial = rounded
      }
    }
    mutate((d) => {
      applyOne(d, k1, id1, v1)
      applyOne(d, k2, id2, v2)
    })
    playAgain()
  }

  function alignSelection(
    mode:
      | 'left'
      | 'center_x'
      | 'right'
      | 'top'
      | 'center_y'
      | 'bottom'
      | 'distribute_h'
      | 'distribute_v'
  ): void {
    if (selection.nodes.length < 2) return
    const set = new Set(selection.nodes)
    mutate((d) => {
      const picked = d.nodes.filter((n) => set.has(n.id))
      if (picked.length < 2) return
      const xs = picked.map((n) => n.x)
      const ys = picked.map((n) => n.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const midX = Math.round((minX + maxX) / 2)
      const midY = Math.round((minY + maxY) / 2)

      switch (mode) {
        case 'left':
          picked.forEach((n) => (n.x = minX))
          break
        case 'center_x':
          picked.forEach((n) => (n.x = midX))
          break
        case 'right':
          picked.forEach((n) => (n.x = maxX))
          break
        case 'top':
          picked.forEach((n) => (n.y = minY))
          break
        case 'center_y':
          picked.forEach((n) => (n.y = midY))
          break
        case 'bottom':
          picked.forEach((n) => (n.y = maxY))
          break
        case 'distribute_h': {
          const sorted = [...picked].sort((a, b) => a.x - b.x)
          const span = maxX - minX
          sorted.forEach((n, idx) => {
            n.x = Math.round(minX + (span * idx) / Math.max(1, sorted.length - 1))
          })
          break
        }
        case 'distribute_v': {
          const sorted = [...picked].sort((a, b) => a.y - b.y)
          const span = maxY - minY
          sorted.forEach((n, idx) => {
            n.y = Math.round(minY + (span * idx) / Math.max(1, sorted.length - 1))
          })
          break
        }
      }
    })
  }

  function cycleBotMode(): void {
    const cur = doc.value.settings.botMode ?? 'off'
    const next = cur === 'off' ? 'greedy' : cur === 'greedy' ? 'smart' : 'off'
    mutate((d) => {
      d.settings.botMode = next
    })
    playAgain()
  }

  // 剪贴板
  let clipboard: { nodes: MxNode[]; edges: MxEdge[] } | null = null
  function copySelection(): void {
    const set = new Set(selection.nodes)
    if (!set.size) return
    clipboard = {
      nodes: clone(doc.value.nodes.filter((n) => set.has(n.id))),
      edges: clone(doc.value.edges.filter((e) => set.has(e.from) && set.has(e.to)))
    }
  }
  function pasteNodes(
    src: { nodes: MxNode[]; edges: MxEdge[] } | null = clipboard,
    offset = 40
  ): void {
    if (!src || !src.nodes.length) return
    const map = new Map<string, string>()
    const nodes = src.nodes.map((n) => {
      const id = mxNewId(n.kind)
      map.set(n.id, id)
      return { ...clone(n), id, x: n.x + offset, y: n.y + offset }
    })
    const edges = src.edges
      .filter((e) => map.has(e.from) && map.has(e.to))
      .map((e) => ({ ...clone(e), id: mxNewId('e'), from: map.get(e.from)!, to: map.get(e.to)! }))
    mutate((d) => {
      d.nodes.push(...nodes)
      d.edges.push(...edges)
    })
    select(nodes.map((n) => n.id))
  }
  function duplicateSelection(): void {
    copySelection()
    pasteNodes()
  }

  // ───────── 运行 ─────────
  function stopTimer(): void {
    if (playTimer) clearInterval(playTimer)
    playTimer = null
    playing.value = false
  }

  function resetPlayback(): void {
    stopTimer()
    liveState.value = null
    liveEvents.value = []
    liveSnapshots.value = []
    liveFlows.value = []
    playStep.value = 0
  }

  function scenarioId(): string | undefined {
    return mode.value === 'scenarios' ? doc.value.activeScenarioId : undefined
  }

  function finalizeLiveRun(): void {
    if (!liveState.value) return
    const run: MxRunResult = {
      id: mxNewId('run'),
      name: `Play ${runs.value.length + 1}`,
      createdAt: new Date().toISOString(),
      seed: doc.value.settings.seed + runs.value.length,
      scenarioId: scenarioId(),
      stepsRequested: doc.value.settings.steps,
      stepsRun: liveState.value.step,
      ended: liveState.value.ended,
      endReason: liveState.value.endReason,
      snapshots: liveSnapshots.value,
      edgeFlows: liveFlows.value,
      events: liveEvents.value,
      totalProduced: liveState.value.totalProduced,
      totalConsumed: liveState.value.totalConsumed
    }
    runs.value = [...runs.value, run]
    activeRunId.value = run.id
    playStep.value = run.stepsRun
    liveState.value = null
    liveSnapshots.value = []
    liveFlows.value = []
  }

  /** 逐步动画播放（新开一条运行记录） */
  function play(): void {
    if (playing.value) {
      stopTimer()
      return
    }
    if (!liveState.value) {
      activeRunId.value = ''
      const st = createMxInitialState(doc.value)
      liveState.value = st
      liveEvents.value = []
      liveSnapshots.value = [{ ...st.values }]
      liveFlows.value = [{}]
      playStep.value = 0
    }
    playing.value = true
    stepOnce()
    if (playing.value) {
      const interval = Math.max(60, Math.round(450 / Math.max(0.25, doc.value.settings.speed)))
      playTimer = setInterval(stepOnce, interval)
    }
  }

  function stepOnce(): void {
    if (!liveState.value) {
      activeRunId.value = ''
      const st = createMxInitialState(doc.value)
      liveState.value = st
      liveSnapshots.value = [{ ...st.values }]
      liveFlows.value = [{}]
      liveEvents.value = []
    }
    const cur = liveState.value!
    if (cur.ended || cur.step >= doc.value.settings.steps) {
      stopTimer()
      finalizeLiveRun()
      return
    }
    const seed = doc.value.settings.seed + runs.value.length
    const res = stepMxSimulation(doc.value, cur, {
      seed,
      interactions: pendingInteractions
    })
    pendingInteractions = []
    liveState.value = res.state
    liveSnapshots.value = [...liveSnapshots.value, { ...res.state.values }]
    liveFlows.value = [...liveFlows.value, { ...res.state.edgeFlows }]
    liveEvents.value = [...liveEvents.value, ...res.events]
    playStep.value = res.state.step
    if (res.state.ended || res.state.step >= doc.value.settings.steps) {
      stopTimer()
      finalizeLiveRun()
    }
  }

  /** 交互节点：点击后在下一步触发 */
  function interact(nodeId: string): void {
    pendingInteractions.push(nodeId)
    if (!playing.value) stepOnce()
  }

  /** 画布上直接微调 Interactive Register 的值（- / + 按钮） */
  function adjustRegisterValue(nodeId: string, delta: number): void {
    const node = doc.value.nodes.find((n) => n.id === nodeId)
    if (!node || node.kind !== 'register') return
    const curVal =
      (liveState.value ? liveState.value.values[nodeId] : undefined) ??
      (displayValues.value ? displayValues.value[nodeId] : undefined) ??
      node.initial ??
      Number(node.formula ?? 0) ??
      0
    const stepSize = node.step && node.step > 0 ? node.step : 1
    let nextVal = Math.round((curVal + delta * stepSize) * 1000) / 1000
    if (node.min != null) nextVal = Math.max(node.min, nextVal)
    if (node.max != null) nextVal = Math.min(node.max, nextVal)
    updateNode(
      nodeId,
      {
        initial: nextVal,
        ...(node.formula && /^-?\d+(\.\d+)?$/.test(node.formula.trim())
          ? { formula: String(nextVal) }
          : {})
      },
      `regAdj:${nodeId}`
    )
    if (liveState.value) {
      liveState.value = {
        ...liveState.value,
        values: { ...liveState.value.values, [nodeId]: nextVal }
      }
    } else if (runs.value.length > 0) {
      playAgain()
    }
  }

  /** 立即跑完整一次（Play again） */
  function playAgain(): void {
    resetPlayback()
    const sc = doc.value.scenarios.find((s) => s.id === scenarioId())
    const run = runMxSimulation(doc.value, {
      steps: doc.value.settings.steps,
      seed: doc.value.settings.seed + runs.value.length,
      scenarioId: scenarioId(),
      name: sc ? `${sc.name} #${runs.value.length + 1}` : `Play ${runs.value.length + 1}`
    })
    runs.value = [...runs.value, run]
    activeRunId.value = run.id
    playStep.value = run.stepsRun
  }

  /** 一键运行并叠加对比全部方案（Scenarios）或多种子轨迹 */
  function runAllScenariosCompare(): void {
    resetPlayback()
    const baseSeed = doc.value.settings.seed
    const steps = doc.value.settings.steps
    const newRuns: MxRunResult[] = []
    if (doc.value.scenarios.length > 0) {
      const baseRun = runMxSimulation(doc.value, {
        steps,
        seed: baseSeed,
        name: 'Baseline'
      })
      newRuns.push(baseRun)
      for (const sc of doc.value.scenarios) {
        newRuns.push(
          runMxSimulation(doc.value, {
            steps,
            seed: baseSeed,
            scenarioId: sc.id,
            name: sc.name
          })
        )
      }
    } else {
      for (let i = 0; i < 3; i++) {
        newRuns.push(
          runMxSimulation(doc.value, {
            steps,
            seed: baseSeed + i * 101,
            name: `Seed #${i + 1}`
          })
        )
      }
    }
    runs.value = newRuns
    activeRunId.value = newRuns[0]?.id ?? ''
    compareRunIds.value = newRuns.slice(1).map((r) => r.id)
    playStep.value = newRuns[0]?.stepsRun ?? steps
    resultsOpen.value = true
    resultsTab.value = 'results'
  }

  function runForecast(): void {
    forecast.value = runMxForecast(doc.value, {
      runs: forecastRuns.value,
      steps: doc.value.settings.steps,
      seed: doc.value.settings.seed,
      scenarioId: scenarioId()
    })
  }

  /** 修改模拟步数并即时刷新当前运行轨迹、进度条与预测置信带 */
  function setSteps(rawSteps: number): void {
    const nextSteps = Math.max(1, Math.min(500, Math.round(Number(rawSteps) || 20)))
    if (doc.value.settings.steps !== nextSteps) {
      mutate((d) => {
        d.settings.steps = nextSteps
      }, 'steps')
    }
    stopTimer()
    if (activeRun.value) {
      const cur = activeRun.value
      const updated = runMxSimulation(doc.value, {
        steps: nextSteps,
        seed: cur.seed,
        scenarioId: cur.scenarioId,
        name: cur.name
      })
      updated.id = cur.id
      runs.value = runs.value.map((r) => (r.id === cur.id ? updated : r))
      playStep.value = updated.stepsRun
    } else {
      playAgain()
    }
    if (forecast.value) {
      runForecast()
    }
  }

  /** 修改 Monte Carlo 预测次数并即时刷新预测带 */
  function setForecastRuns(rawRuns: number): void {
    const nextRuns = Math.max(5, Math.min(500, Math.round(Number(rawRuns) || 50)))
    forecastRuns.value = nextRuns
    runForecast()
  }

  function deleteRun(id: string): void {
    runs.value = runs.value.filter((r) => r.id !== id)
    compareRunIds.value = compareRunIds.value.filter((x) => x !== id)
    if (activeRunId.value === id) activeRunId.value = runs.value[runs.value.length - 1]?.id ?? ''
  }

  function clearRuns(): void {
    resetPlayback()
    runs.value = []
    activeRunId.value = ''
    compareRunIds.value = []
    forecast.value = null
  }

  // 历史快照
  function saveSnapshot(name: string): void {
    const snap = { id: mxNewId('snap'), name, createdAt: new Date().toISOString(), json: '' }
    const copy = clone(doc.value)
    copy.history = []
    snap.json = JSON.stringify(copy)
    mutate((d) => {
      d.history = [...d.history, snap].slice(-15)
    })
  }

  function restoreSnapshot(id: string): void {
    const snap = doc.value.history.find((h) => h.id === id)
    if (!snap) return
    const restored = normalizeMxDocument(JSON.parse(snap.json))
    restored.history = doc.value.history
    replaceDoc(restored)
  }

  // ───────── Artificial Agents（效用与前瞻试算智能体） ─────────
  function addAgent(partial?: Partial<MxAgent>): MxAgent {
    const existing = doc.value.agents ?? []
    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6']
    const firstPoolOrReg = doc.value.nodes.find((n) => n.kind === 'pool' || n.kind === 'register')
    const interactiveIds = doc.value.nodes
      .filter((n) => n.trigger === 'interactive')
      .map((n) => n.id)
    const created: MxAgent = {
      id: partial?.id || mxNewId('agent'),
      name: partial?.name?.trim() || `Agent ${existing.length + 1}`,
      color: partial?.color || colors[existing.length % colors.length],
      enabled: partial?.enabled ?? true,
      personality: partial?.personality ?? 'rational',
      description: partial?.description ?? '',
      goals:
        partial?.goals ??
        (firstPoolOrReg
          ? [
              {
                id: mxNewId('goal'),
                nodeId: firstPoolOrReg.id,
                targetFormula: String(
                  firstPoolOrReg.capacity && firstPoolOrReg.capacity > 0
                    ? firstPoolOrReg.capacity
                    : 100
                ),
                importance: 'med',
                continuePastTarget: true,
                trajectory: 'upwards',
                utilityCurve: 'linear'
              }
            ]
          : []),
      controlledNodeIds: partial?.controlledNodeIds ?? interactiveIds,
      actionsPerStep: partial?.actionsPerStep ?? 1,
      lookaheadHorizon: partial?.lookaheadHorizon ?? 2,
      discount: partial?.discount ?? 0.65,
      shapingEnabled: partial?.shapingEnabled ?? true
    }
    mutate((d) => {
      d.agents = [...(d.agents ?? []), created]
    }, 'addAgent')
    playAgain()
    return created
  }

  function addAgentWithAi(prompt?: string): MxAgent {
    let created: MxAgent | null = null
    mutate((d) => {
      const ag = generateMxAgentWithAi(d, prompt?.trim() ? { prompt: prompt.trim() } : undefined)
      d.agents = [...(d.agents ?? []), ag]
      created = ag
    }, 'addAgentAi')
    playAgain()
    return created!
  }

  function runAllAgentsArena(): MxRunResult[] {
    if ((doc.value.agents ?? []).length < 2) {
      mutate((d) => {
        const cur = d.agents ?? []
        const presets: Array<'rational' | 'aggressive' | 'hoarder'> = [
          'rational',
          'aggressive',
          'hoarder'
        ]
        for (const p of presets) {
          if (cur.length >= 3) break
          if (!cur.some((a) => a.personality === p)) {
            cur.push(generateMxAgentWithAi(d, { personality: p }))
          }
        }
        d.agents = cur
      }, 'ensureArenaAgents')
    }
    stopTimer()
    const arenaRuns = runMxAgentArena(doc.value)
    if (!arenaRuns.length) return []
    runs.value = [...arenaRuns, ...runs.value].slice(0, 12)
    activeRunId.value = arenaRuns[0]!.id
    compareRunIds.value = arenaRuns.map((r) => r.id)
    playStep.value = arenaRuns[0]!.stepsRun
    liveState.value = null
    liveEvents.value = []
    liveSnapshots.value = []
    liveFlows.value = []
    resultsOpen.value = true
    resultsTab.value = 'results'
    return arenaRuns
  }

  function updateAgent(id: string, patch: Partial<MxAgent>): void {
    mutate((d) => {
      const ag = (d.agents ?? []).find((x) => x.id === id)
      if (!ag) return
      Object.assign(ag, patch)
    }, `updAgent:${id}`)
    playAgain()
  }

  function deleteAgent(id: string): void {
    mutate((d) => {
      d.agents = (d.agents ?? []).filter((x) => x.id !== id)
    }, 'delAgent')
    playAgain()
  }

  function duplicateAgent(id: string): MxAgent | null {
    const src = (doc.value.agents ?? []).find((x) => x.id === id)
    if (!src) return null
    const copy: MxAgent = {
      ...clone(src),
      id: mxNewId('agent'),
      name: `${src.name} Copy`,
      goals: src.goals.map((g) => ({ ...clone(g), id: mxNewId('goal') }))
    }
    mutate((d) => {
      d.agents = [...(d.agents ?? []), copy]
    }, 'dupAgent')
    playAgain()
    return copy
  }

  function fillAgentGoalsWithAi(agentId: string): void {
    mutate((d) => {
      const ag = (d.agents ?? []).find((x) => x.id === agentId)
      if (!ag) return
      const suggested = suggestMxAgentGoalsWithAi(d, ag.personality)
      if (suggested.length) ag.goals = suggested
    }, 'aiGoals')
    playAgain()
  }

  function ensureWorkbench(): MxNumericalWorkbench {
    if (!doc.value.workbench) {
      doc.value.workbench = createMxWorkbenchPreset('slay_the_spire_dbg')
    }
    return doc.value.workbench
  }

  function applyWorkbenchPreset(presetId: MxWorkbenchPresetId, syncMacroCanvas = true): void {
    const presetToTemplate: Record<MxWorkbenchPresetId, MxTemplateId> = {
      slay_the_spire_dbg: 'roguelike_mana_deck',
      hearthstone_tcg: 'hearthstone_mana_pack',
      onmyoji_atb: 'onmyoji_speed_orbs',
      balatro_roguelike: 'balatro_ante_jokers',
      survivor_brotato: 'survivor_xp_loop'
    }
    if (syncMacroCanvas) {
      const nextDoc = createMxFromTemplate(presetToTemplate[presetId])
      nextDoc.workbench = createMxWorkbenchPreset(presetId)
      replaceDoc(nextDoc, true)
      playAgain()
      runForecast()
      return
    }
    mutate((d) => {
      d.workbench = createMxWorkbenchPreset(presetId)
    }, `wbPreset:${presetId}`)
  }

  function syncWorkbenchToMacroParams(metrics: Record<string, number>): string[] {
    const touchedNodeIds: string[] = []
    mutate((d) => {
      for (const [k, rawV] of Object.entries(metrics)) {
        const val = Math.round(rawV * 100) / 100
        const existing = d.params.find((p) => p.name === k)
        if (existing) {
          existing.value = val
        } else {
          d.params.push({ id: mxNewId('p'), name: k, value: val })
        }
      }

      // 1) 自动将核心仿真指标映射更新到画布已有的同名/同义参数与寄存器
      const winRate = metrics.CombatWinRate ?? 65
      const dmgOut = metrics.DamageOutput ?? 25
      const ttk = metrics.CombatTTK ?? 5
      const lootCost = metrics.LootExpectedCost ?? 40

      for (const p of d.params) {
        const low = p.name.toLowerCase()
        if (low.includes('win') || low.includes('rate')) p.value = Math.round(winRate * 10) / 10
        else if (low.includes('chip') || low.includes('dmg') || low.includes('atk'))
          p.value = Math.max(1, Math.round(dmgOut))
        else if (low.includes('stamina') || low.includes('energy'))
          p.value = Math.max(1, Math.round(ttk * 2))
      }

      // 2) 在画布上创建或更新可视化的联动状态寄存器节点（Register），并自动连线到核心资源节点
      const pools = d.nodes.filter((n) => n.kind === 'pool')
      const primaryPool =
        pools.find((p) => /power|战力|score|chips|筹码|atk|damage|hp|gold|金币/i.test(p.label)) ?? // cjk-ok
        pools[pools.length - 1]
      const baseX = primaryPool ? primaryPool.x : 560
      const baseY = primaryPool ? primaryPool.y + 135 : 340

      const upsertBridgeRegister = (
        regId: string,
        label: string,
        formula: string,
        val: number,
        offsetX: number
      ): MxNode => {
        let reg = d.nodes.find((n) => n.id === regId)
        if (!reg) {
          reg = {
            ...createMxNode('register', baseX + offsetX, baseY, label),
            id: regId,
            formula,
            initial: val,
            tracked: true
          }
          d.nodes.push(reg)
        } else {
          reg.label = label
          reg.formula = formula
          reg.initial = val
          reg.tracked = true
        }
        touchedNodeIds.push(reg.id)
        return reg
      }

      const regWin = upsertBridgeRegister(
        'wb_reg_winrate',
        `⚔ 胜率 WinRate (${Math.round(winRate)}%)`, // cjk-ok
        'CombatWinRate',
        Math.round(winRate * 10) / 10,
        -160
      )
      const regDmg = upsertBridgeRegister(
        'wb_reg_dmg',
        `💥 乘区产出 Output (${Math.round(dmgOut)})`, // cjk-ok
        'DamageOutput',
        Math.round(dmgOut * 10) / 10,
        0
      )
      const regCost = upsertBridgeRegister(
        'wb_reg_lootcost',
        `🎲 期望消耗 Cost (${Math.round(lootCost)})`, // cjk-ok
        'LootExpectedCost',
        Math.round(lootCost * 10) / 10,
        160
      )

      // 若画布存在主资源池，则建立从乘区产出寄存器到主资源池入向产出边（或源点）的状态修正边，避免直接连向 Pool 导致出向消耗边暴涨抽干资源池
      if (primaryPool) {
        touchedNodeIds.push(primaryPool.id)
        const hasLink = d.edges.some((e) => e.from === regDmg.id || e.from === regWin.id)
        if (!hasLink) {
          const incomingFeedEdge = d.edges.find(
            (e) => e.kind === 'resource' && e.to === primaryPool.id
          )
          if (incomingFeedEdge) {
            d.edges.push({
              id: 'wb_st_link_1',
              kind: 'state',
              from: regDmg.id,
              to: incomingFeedEdge.from,
              targetEdgeId: incomingFeedEdge.id,
              formula: '+1%'
            })
          } else {
            d.edges.push({
              id: 'wb_st_link_1',
              kind: 'state',
              from: regDmg.id,
              to: regWin.id,
              formula: '>0'
            })
          }
          d.edges.push({
            id: 'wb_st_link_2',
            kind: 'state',
            from: regWin.id,
            to: regCost.id,
            formula: '>0'
          })
        }
      }
    }, 'syncWbParams')
    if (touchedNodeIds.length) {
      select(touchedNodeIds)
    }
    playAgain()
    runForecast()
    return touchedNodeIds
  }

  function injectValueToCanvasNode(nodeId: string, rawVal: number, metricLabel?: string): void {
    const val = Math.round(rawVal * 100) / 100
    mutate((d) => {
      const target = d.nodes.find((n) => n.id === nodeId)
      if (!target) return
      if (target.kind === 'pool') {
        target.initial = Math.max(0, Math.round(val))
      } else if (target.kind === 'register') {
        target.initial = val
        target.formula = String(val)
      } else {
        const outEdge = d.edges.find((e) => e.kind === 'resource' && e.from === target.id)
        if (outEdge) outEdge.formula = String(Math.max(1, Math.round(val)))
      }
      if (metricLabel && !target.label.includes('[')) {
        target.notes = `Synced from Workbench: ${metricLabel} = ${val}`
      }
    }, `injectNode:${nodeId}`)
    select([nodeId])
    playAgain()
    runForecast()
  }

  return {
    doc,
    selection,
    tool,
    drawer,
    mode,
    inspectorOpen,
    resultsOpen,
    resultsTab,
    canvasTheme,
    snapToGrid,
    flowHeatmap,
    view,
    runs,
    activeRunId,
    activeRun,
    compareRunIds,
    playStep,
    playing,
    liveState,
    liveEvents,
    liveSnapshots,
    liveFlows,
    forecast,
    forecastRuns,
    focusedSeriesId,
    hoverStep,
    displayValues,
    previousStepValues,
    displayFlows,
    edgeCumulativeFlows,
    nodeBottlenecks,
    canUndo,
    canRedo,
    mutate,
    replaceDoc,
    undo,
    redo,
    select,
    addNode,
    addEdge,
    addEdgeToEdge,
    reverseEdge,
    toggleEdgeKind,
    autoLayout,
    deleteSelection,
    updateNode,
    updateEdge,
    moveNodes,
    createGroupFromSelection,
    moveGroup,
    updateGroup,
    deleteGroup,
    applyTunableValue,
    applyTunablePair,
    alignSelection,
    cycleBotMode,
    copySelection,
    pasteNodes,
    duplicateSelection,
    play,
    stepOnce,
    interact,
    adjustRegisterValue,
    playAgain,
    runAllScenariosCompare,
    resetPlayback,
    runForecast,
    setSteps,
    setForecastRuns,
    deleteRun,
    clearRuns,
    saveSnapshot,
    restoreSnapshot,
    addAgent,
    addAgentWithAi,
    runAllAgentsArena,
    updateAgent,
    deleteAgent,
    duplicateAgent,
    fillAgentGoalsWithAi,
    ensureWorkbench,
    applyWorkbenchPreset,
    syncWorkbenchToMacroParams,
    injectValueToCanvasNode,
    stopTimer
  }
}

export type MxStudioStore = ReturnType<typeof createMxStudioStore>

const MX_STORE_KEY: InjectionKey<MxStudioStore> = Symbol('mx-studio-store')

export function provideMxStudioStore(store: MxStudioStore): void {
  provide(MX_STORE_KEY, store)
}

export function useMxStudioStore(): MxStudioStore {
  const store = inject(MX_STORE_KEY)
  if (!store) throw new Error('MachinationsStudio store not provided')
  return store
}
