/**
 * Machinations 工作台状态（provide / inject 共享给画布、属性面板、结果面板、抽屉）。
 */
import { computed, inject, provide, reactive, ref, shallowRef, watch, type InjectionKey } from 'vue'
import {
  autoLayoutMxDocument,
  createMxDocumentFromBuildingBlock,
  createMxFromTemplate,
  createMxInitialState,
  createMxNode,
  createMxWorkbenchPreset,
  formatMxTunableEdgeFormula,
  generateMxAgentWithAi,
  getMxBuildingBlockById,
  insertMxBuildingBlockIntoDocument,
  mxIdentifier,
  mxNewId,
  normalizeMxDocument,
  rewriteMxFormulaIdentifiers,
  runMxAgentArena,
  runMxForecast,
  runMxSimulation,
  stepMxSimulation,
  suggestMxAgentGoalsWithAi,
  synthesizeMxWorkbenchFromPrompt,
  type MxAgent,
  type MxDocument,
  type MxEdge,
  type MxEdgeKind,
  type MxEvent,
  type MxForecastResult,
  type MxGroup,
  type MxInsertBuildingBlockResult,
  type MxNode,
  type MxNodeKind,
  type MxNumericalWorkbench,
  type MxPoolTokenStackItem,
  type MxRunResult,
  type MxRuntimeState,
  type MxTemplateId,
  type MxTunableKind,
  type MxWorkbenchPresetId
} from '@shared/gameAssets'

export type MxTool = 'select' | MxNodeKind | 'resource_edge' | 'state_edge'
export type MxDrawer =
  | ''
  | 'agents'
  | 'templates'
  | 'blocks'
  | 'resources'
  | 'params'
  | 'layers'
  | 'clips'
  | 'history'
  | 'docs'
export type MxMode = 'build' | 'scenarios' | 'workbench'
export type MxCanvasTheme = 'auto' | 'light' | 'dark'
export type MxFormulaModalTarget =
  | {
      targetType: 'edge'
      edgeId: string
      field: 'formula' | 'interval'
    }
  | {
      targetType: 'node'
      nodeId: string
      field: 'formula' | 'botCondition'
    }
  | {
      targetType: 'param'
      paramId: string
    }

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function createMxStudioStore(initial: MxDocument) {
  const initialDoc = normalizeMxDocument(clone(initial))
  const doc = ref<MxDocument>(initialDoc)
  let rawDocSnapshot: MxDocument = initialDoc
  const undoStack: string[] = []
  const redoStack: string[] = []
  const historyRev = ref(0)
  /** 任意文档变更递增（含几何位移与语义变更），用于轻量持久化监听 */
  const docRevision = ref(0)
  /** 仅拓扑/公式/参数/资源/图层/配置等语义变更递增，纯坐标拖拽不递增，避免下游公式与健康度陪跑重算 */
  const topologyRevision = ref(0)
  /** 画布节点/分组/连线弧度正在实时指针拖拽中 */
  const isCanvasDragging = ref(false)
  /** 不收集 doc Ref 依赖地读取当前文档（配合 topologyRevision 实现纯拓扑计算零坐标陪跑） */
  function peekDoc(): MxDocument {
    return rawDocSnapshot
  }

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
  const showNodeLabels = ref(true)
  const compactEdgeFormulas = ref(true)
  const view = reactive({ x: 0, y: 0, zoom: 0.8 })
  const activeLayerId = ref<string>('')
  const formulaModal = ref<MxFormulaModalTarget | null>(null)

  watch(
    () => doc.value.layers,
    (layers) => {
      if (!layers?.length) return
      const baseLayer =
        layers.find((l) => l.id === 'layer_base' || l.name.toLowerCase() === 'base') || layers[0]
      if (!activeLayerId.value || !layers.some((l) => l.id === activeLayerId.value)) {
        activeLayerId.value = baseLayer.id
      }
    },
    { immediate: true }
  )

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
  const livePoolTokens = shallowRef<Array<Record<string, MxPoolTokenStackItem[]>>>([])
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
  const displayPoolTokens = computed<Record<string, MxPoolTokenStackItem[]> | null>(() => {
    const run = activeRun.value
    if (run) {
      if (run.poolTokensHistory?.length) {
        const idx = Math.min(playStep.value, run.poolTokensHistory.length - 1)
        return run.poolTokensHistory[idx] ?? run.finalPoolTokens ?? null
      }
      return run.finalPoolTokens ?? null
    }
    if (livePoolTokens.value.length) {
      const idx = Math.min(playStep.value, livePoolTokens.value.length - 1)
      return livePoolTokens.value[idx] ?? liveState.value?.poolTokens ?? null
    }
    return liveState.value?.poolTokens ?? null
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
  function recordUndoWithCoalesce(coalesceKey = ''): void {
    const now = Date.now()
    if (!coalesceKey || coalesceKey !== lastCoalesce || now - lastCoalesceAt > 800) {
      snapshotForUndo()
    }
    lastCoalesce = coalesceKey
    lastCoalesceAt = now
  }

  function mutate(fn: (d: MxDocument) => void, coalesceKey = ''): void {
    recordUndoWithCoalesce(coalesceKey)
    const next = clone(doc.value)
    fn(next)
    rawDocSnapshot = next
    doc.value = next
    docRevision.value++
    topologyRevision.value++
  }

  /**
   * 纯几何属性变更（坐标 x/y、尺寸 width/height、连线弧度 bend）：
   * 仅浅拷贝受影响的数组与图元对象，跳过整份文档（含 workbench/history）的 JSON 序列化深拷贝，
   * 且不递增 topologyRevision，避免触发无关的公式词法分析与经济健康度诊断。
   */
  function mutateGeometry(fn: (d: MxDocument) => void, coalesceKey = ''): void {
    recordUndoWithCoalesce(coalesceKey)
    const next: MxDocument = { ...doc.value }
    fn(next)
    rawDocSnapshot = next
    doc.value = next
    docRevision.value++
  }

  function replaceDoc(next: MxDocument, recordUndo = true): void {
    if (recordUndo) snapshotForUndo()
    const normalized = normalizeMxDocument(clone(next))
    rawDocSnapshot = normalized
    doc.value = normalized
    docRevision.value++
    topologyRevision.value++
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
    const parsed = JSON.parse(prev) as MxDocument
    rawDocSnapshot = parsed
    doc.value = parsed
    historyRev.value++
    docRevision.value++
    topologyRevision.value++
    pruneSelection()
  }

  function redo(): void {
    const next = redoStack.pop()
    if (!next) return
    undoStack.push(JSON.stringify(doc.value))
    const parsed = JSON.parse(next) as MxDocument
    rawDocSnapshot = parsed
    doc.value = parsed
    historyRev.value++
    docRevision.value++
    topologyRevision.value++
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
    const baseLayer =
      doc.value.layers.find((l) => l.id === 'layer_base' || l.name.toLowerCase() === 'base') ||
      doc.value.layers[0]
    const targetLayer =
      (activeLayerId.value &&
        doc.value.layers.find((l) => l.id === activeLayerId.value && l.visible && !l.locked)) ||
      (baseLayer && baseLayer.visible && !baseLayer.locked ? baseLayer : undefined) ||
      doc.value.layers.find((l) => l.visible && !l.locked) ||
      baseLayer ||
      doc.value.layers[0]
    if (targetLayer) node.layerId = targetLayer.id
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
    mutateGeometry((d) => {
      d.nodes = d.nodes.map((n) => ({ ...n }))
      d.edges = d.edges.map((e) => ({ ...e }))
      if (d.groups) d.groups = d.groups.map((g) => ({ ...g }))
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
        (e) =>
          !edgeSet.has(e.id) &&
          !(e.targetEdgeId && edgeSet.has(e.targetEdgeId)) &&
          !nodeSet.has(e.from) &&
          !nodeSet.has(e.to)
      )
    })
    select([])
  }

  const NODE_GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height'])

  function updateNode(id: string, patch: Partial<MxNode>, coalesce = ''): void {
    const keys = Object.keys(patch)
    if (!keys.length) return
    const key = coalesce || `node:${id}:${keys.join(',')}`
    if (keys.every((k) => NODE_GEOMETRY_KEYS.has(k))) {
      mutateGeometry((d) => {
        d.nodes = d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
      }, key)
      return
    }
    mutate((d) => {
      const n = d.nodes.find((x) => x.id === id)
      if (n) Object.assign(n, patch)
    }, key)
  }

  function updateEdge(id: string, patch: Partial<MxEdge>, coalesce = ''): void {
    const keys = Object.keys(patch)
    if (!keys.length) return
    const key = coalesce || `edge:${id}:${keys.join(',')}`
    if (keys.length === 1 && keys[0] === 'bend') {
      mutateGeometry((d) => {
        d.edges = d.edges.map((e) => (e.id === id ? { ...e, bend: patch.bend } : e))
      }, key)
      return
    }
    mutate((d) => {
      const e = d.edges.find((x) => x.id === id)
      if (e) Object.assign(e, patch)
    }, key)
  }

  /**
   * 拖拽连线端点（起点 from 或终点 to）重连到其他节点，或将状态边终点重连到另一条连线的公式胶囊。
   * 完整保留原连线的公式、间隔、传输模式与全部配置参数。
   */
  function reconnectEdge(
    edgeId: string,
    end: 'from' | 'to',
    target: { nodeId?: string; targetEdgeId?: string }
  ): boolean {
    const curEdge = doc.value.edges.find((x) => x.id === edgeId)
    if (!curEdge) return false

    if (end === 'from') {
      const nextFromId = target.nodeId
      if (!nextFromId) return false
      const nextFromNode = doc.value.nodes.find((n) => n.id === nextFromId)
      if (!nextFromNode || nextFromNode.kind === 'note') return false
      if (curEdge.targetEdgeId) {
        const tgtEdge = doc.value.edges.find((e) => e.id === curEdge.targetEdgeId)
        if (!tgtEdge || tgtEdge.from === nextFromId) return false
      } else if (nextFromId === curEdge.to) {
        return false
      }
      if (doc.value.edges.some((dep) => dep.targetEdgeId === edgeId && dep.from === nextFromId)) {
        return false
      }
      if (nextFromId === curEdge.from) {
        select([], [edgeId])
        return false
      }
      mutate((d) => {
        const e = d.edges.find((x) => x.id === edgeId)
        if (e) {
          e.from = nextFromId
          for (const dep of d.edges) {
            if (dep.targetEdgeId === edgeId) {
              dep.to = nextFromId
            }
          }
        }
      })
      select([], [edgeId])
      return true
    }

    if (target.targetEdgeId) {
      if (curEdge.kind !== 'state' || target.targetEdgeId === edgeId) return false
      const tgtEdge = doc.value.edges.find((e) => e.id === target.targetEdgeId)
      if (!tgtEdge || tgtEdge.from === curEdge.from) return false
      let cursor: MxEdge | undefined = tgtEdge
      const visited = new Set<string>([edgeId])
      while (cursor?.targetEdgeId) {
        if (visited.has(cursor.targetEdgeId)) return false
        visited.add(cursor.targetEdgeId)
        cursor = doc.value.edges.find((e) => e.id === cursor!.targetEdgeId)
      }
      if (curEdge.targetEdgeId === target.targetEdgeId) {
        select([], [edgeId])
        return false
      }
      mutate((d) => {
        const e = d.edges.find((x) => x.id === edgeId)
        if (e) {
          e.to = tgtEdge.from
          e.targetEdgeId = target.targetEdgeId
        }
      })
      select([], [edgeId])
      return true
    }

    const nextToId = target.nodeId
    if (!nextToId) return false
    const nextToNode = doc.value.nodes.find((n) => n.id === nextToId)
    if (!nextToNode || nextToNode.kind === 'note') return false
    if (nextToId === curEdge.from) return false
    if (!curEdge.targetEdgeId && nextToId === curEdge.to) {
      select([], [edgeId])
      return false
    }
    mutate((d) => {
      const e = d.edges.find((x) => x.id === edgeId)
      if (e) {
        e.to = nextToId
        e.targetEdgeId = undefined
      }
    })
    select([], [edgeId])
    return true
  }

  function moveNodes(ids: string[], dx: number, dy: number, coalesce: string): void {
    if (!ids.length || (dx === 0 && dy === 0)) return
    const set = new Set(ids)
    mutateGeometry((d) => {
      d.nodes = d.nodes.map((n) =>
        set.has(n.id) ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : n
      )
    }, coalesce)
  }

  /** 拖拽结束时一次性提交节点最终坐标（零深拷贝，无实际位移则不污染撤销栈） */
  function commitNodePositions(
    positions: ReadonlyMap<string, { x: number; y: number }>,
    coalesce = ''
  ): void {
    if (!positions.size) return
    let changed = false
    for (const n of doc.value.nodes) {
      const next = positions.get(n.id)
      if (!next) continue
      if (n.x !== Math.round(next.x) || n.y !== Math.round(next.y)) {
        changed = true
        break
      }
    }
    if (!changed) return
    mutateGeometry((d) => {
      d.nodes = d.nodes.map((n) => {
        const next = positions.get(n.id)
        return next ? { ...n, x: Math.round(next.x), y: Math.round(next.y) } : n
      })
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
    if (dx === 0 && dy === 0) return
    const curGrp = doc.value.groups?.find((x) => x.id === groupId)
    if (!curGrp) return
    const x0 = curGrp.x
    const y0 = curGrp.y
    const x1 = curGrp.x + curGrp.width
    const y1 = curGrp.y + curGrp.height
    mutateGeometry((d) => {
      d.groups = (d.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, x: Math.round(g.x + dx), y: Math.round(g.y + dy) } : g
      )
      d.nodes = d.nodes.map((n) =>
        n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1
          ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }
          : n
      )
    }, coalesce)
  }

  /** 分组拖拽结束时一次性提交分组及组内节点的最终坐标 */
  function commitGroupMove(
    groupId: string,
    nextX: number,
    nextY: number,
    movedNodes: ReadonlyMap<string, { x: number; y: number }>,
    coalesce = ''
  ): void {
    const curGrp = doc.value.groups?.find((x) => x.id === groupId)
    if (!curGrp) return
    const rx = Math.round(nextX)
    const ry = Math.round(nextY)
    let changed = curGrp.x !== rx || curGrp.y !== ry
    if (!changed && movedNodes.size > 0) {
      for (const n of doc.value.nodes) {
        const p = movedNodes.get(n.id)
        if (p && (n.x !== Math.round(p.x) || n.y !== Math.round(p.y))) {
          changed = true
          break
        }
      }
    }
    if (!changed) return
    mutateGeometry((d) => {
      d.groups = (d.groups ?? []).map((g) => (g.id === groupId ? { ...g, x: rx, y: ry } : g))
      if (movedNodes.size > 0) {
        d.nodes = d.nodes.map((n) => {
          const p = movedNodes.get(n.id)
          return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n
        })
      }
    }, coalesce)
  }

  /** 分组缩放结束时一次性提交尺寸 */
  function commitGroupResize(groupId: string, width: number, height: number, coalesce = ''): void {
    const curGrp = doc.value.groups?.find((x) => x.id === groupId)
    if (!curGrp) return
    const rw = Math.round(width)
    const rh = Math.round(height)
    if (curGrp.width === rw && curGrp.height === rh) return
    mutateGeometry((d) => {
      d.groups = (d.groups ?? []).map((g) =>
        g.id === groupId ? { ...g, width: rw, height: rh } : g
      )
    }, coalesce)
  }

  /** 连线弧度拖拽结束时一次性提交弧度 */
  function commitEdgeBend(edgeId: string, bend: number, coalesce = ''): void {
    const curEdge = doc.value.edges.find((x) => x.id === edgeId)
    if (!curEdge) return
    const rb = Math.round(bend)
    if ((curEdge.bend ?? 0) === rb && curEdge.bend !== undefined) return
    mutateGeometry((d) => {
      d.edges = d.edges.map((e) => (e.id === edgeId ? { ...e, bend: rb } : e))
    }, coalesce)
  }

  const GROUP_GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height'])

  function updateGroup(id: string, patch: Partial<MxGroup>, coalesce = ''): void {
    const keys = Object.keys(patch)
    if (!keys.length) return
    const key = coalesce || `grp:${id}`
    if (keys.every((k) => GROUP_GEOMETRY_KEYS.has(k))) {
      mutateGeometry((d) => {
        d.groups = (d.groups ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g))
      }, key)
      return
    }
    mutate((d) => {
      const g = d.groups?.find((x) => x.id === id)
      if (g) Object.assign(g, patch)
    }, key)
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
        if (e) e.formula = formatMxTunableEdgeFormula(e, rounded)
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
        if (e) e.formula = formatMxTunableEdgeFormula(e, rounded)
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
    mutateGeometry((d) => {
      d.nodes = d.nodes.map((n) => (set.has(n.id) ? { ...n } : n))
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

  function setBotMode(next: 'off' | 'greedy' | 'smart'): void {
    mutate((d) => {
      d.settings.botMode = next
      if (next === 'off') {
        // 切为「手动 Off」时同步停用后台自动代点的效用智能体（Agents）并归位单节点自动策略
        if (d.agents?.length) {
          for (const ag of d.agents) {
            ag.enabled = false
          }
        }
        for (const n of d.nodes) {
          if (
            n.trigger === 'interactive' &&
            n.botPolicy &&
            n.botPolicy !== 'inherit' &&
            n.botPolicy !== 'off'
          ) {
            n.botPolicy = 'inherit'
          }
        }
      }
    }, 'botMode')
    if (next === 'off') {
      resetPlayback()
      activeRunId.value = ''
    } else {
      playAgain()
    }
  }

  function cycleBotMode(): void {
    const cur = doc.value.settings.botMode ?? 'off'
    const hasActiveAgent = (doc.value.agents ?? []).some((a) => a.enabled)
    const next =
      cur === 'off' && hasActiveAgent
        ? 'off'
        : cur === 'off'
          ? 'greedy'
          : cur === 'greedy'
            ? 'smart'
            : 'off'
    setBotMode(next)
  }

  // 剪贴板
  function collectSelectionEdges(edges: MxEdge[], nodeSet: Set<string>): MxEdge[] {
    const keptIds = new Set<string>()
    for (const e of edges) {
      if (!e.targetEdgeId && nodeSet.has(e.from) && nodeSet.has(e.to)) {
        keptIds.add(e.id)
      }
    }
    for (let pass = 0; pass < 5; pass++) {
      let added = false
      for (const e of edges) {
        if (
          e.targetEdgeId &&
          !keptIds.has(e.id) &&
          nodeSet.has(e.from) &&
          keptIds.has(e.targetEdgeId)
        ) {
          keptIds.add(e.id)
          added = true
        }
      }
      if (!added) break
    }
    return edges.filter((e) => keptIds.has(e.id))
  }

  let clipboard: { nodes: MxNode[]; edges: MxEdge[] } | null = null
  function copySelection(): void {
    const set = new Set(selection.nodes)
    if (!set.size) return
    clipboard = {
      nodes: clone(doc.value.nodes.filter((n) => set.has(n.id))),
      edges: clone(collectSelectionEdges(doc.value.edges, set))
    }
  }
  function pasteNodes(
    src: { nodes: MxNode[]; edges: MxEdge[] } | null = clipboard,
    offset = 40
  ): void {
    if (!src || !src.nodes.length) return
    const map = new Map<string, string>()
    const rawNodes = src.nodes.map((n) => {
      const id = mxNewId(n.kind)
      map.set(n.id, id)
      return { ...clone(n), id, x: n.x + offset, y: n.y + offset }
    })
    const nodes = rawNodes.map((n) => ({
      ...n,
      formula: rewriteMxFormulaIdentifiers(n.formula, map),
      botCondition: rewriteMxFormulaIdentifiers(n.botCondition, map)
    }))
    const edgeMap = new Map<string, string>()
    const validEdges = collectSelectionEdges(src.edges, new Set(map.keys()))
    const srcEdgeById = new Map(validEdges.map((e) => [e.id, e]))
    for (const e of validEdges) {
      edgeMap.set(e.id, mxNewId('e'))
    }
    const edges = validEdges.map((e) => {
      const fallbackToNode =
        e.targetEdgeId && !map.has(e.to) ? srcEdgeById.get(e.targetEdgeId)?.from : undefined
      return {
        ...clone(e),
        id: edgeMap.get(e.id)!,
        from: map.get(e.from)!,
        to:
          map.get(e.to) ??
          (fallbackToNode ? map.get(fallbackToNode) : undefined) ??
          map.get(e.from)!,
        targetEdgeId: e.targetEdgeId ? (edgeMap.get(e.targetEdgeId) ?? e.targetEdgeId) : undefined,
        formula: rewriteMxFormulaIdentifiers(e.formula, map) ?? e.formula,
        interval: rewriteMxFormulaIdentifiers(e.interval, map)
      }
    })
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

  /**
   * 将官方 Building Block 模块无冲突插入当前经济系统图，并自动选中新插入的节点与连线。
   */
  function insertBuildingBlock(
    blockId: string,
    options: {
      wrapInGroup?: boolean
      locale?: 'zh' | 'en'
      anchorX?: number
      anchorY?: number
    } = {}
  ): MxInsertBuildingBlockResult | null {
    let inserted: MxInsertBuildingBlockResult | null = null
    mutate((d) => {
      inserted = insertMxBuildingBlockIntoDocument(d, blockId, {
        ...options,
        layerId: activeLayerId.value || undefined
      })
    })
    if (inserted) {
      const res = inserted as MxInsertBuildingBlockResult
      select(res.insertedNodeIds, res.insertedEdgeIds)
    }
    return inserted
  }

  /**
   * 将指定 Building Block 作为独立画布打开并立即运行模拟预览。
   */
  function loadBuildingBlockAsDoc(blockId: string, locale: 'zh' | 'en' = 'zh'): void {
    const nextDoc = createMxDocumentFromBuildingBlock(blockId, locale)
    replaceDoc(nextDoc)
    playAgain()
  }

  /**
   * 将指定 Building Block 复制到工作台剪贴板（便于 Ctrl+V 或右键粘贴到任意位置）。
   */
  function copyBuildingBlock(blockId: string): boolean {
    const blk = getMxBuildingBlockById(blockId)
    if (!blk || !blk.nodes.length) return false
    clipboard = {
      nodes: clone(blk.nodes),
      edges: clone(blk.edges)
    }
    return true
  }

  function selectLayer(layerId: string): void {
    activeLayerId.value = layerId
    const nodeIds = doc.value.nodes.filter((n) => n.layerId === layerId).map((n) => n.id)
    select(nodeIds, [])
  }

  function removeLayer(layerId: string): void {
    if (doc.value.layers.length <= 1) return
    mutate((d) => {
      d.layers = d.layers.filter((l) => l.id !== layerId)
      const fallbackId = d.layers[0]?.id
      for (const n of d.nodes) {
        if (n.layerId === layerId) n.layerId = fallbackId
      }
    })
    if (activeLayerId.value === layerId) {
      activeLayerId.value = doc.value.layers[0]?.id ?? ''
    }
  }

  function assignNodesToLayer(nodeIds: string[], layerId: string | undefined): void {
    const set = new Set(nodeIds)
    mutate((d) => {
      for (const n of d.nodes) {
        if (set.has(n.id)) {
          n.layerId = layerId
        }
      }
    })
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
    livePoolTokens.value = []
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
      totalConsumed: liveState.value.totalConsumed,
      finalPoolTokens: liveState.value.poolTokens,
      poolTokensHistory: livePoolTokens.value
    }
    runs.value = [...runs.value, run]
    activeRunId.value = run.id
    playStep.value = run.stepsRun
    liveState.value = null
    liveSnapshots.value = []
    liveFlows.value = []
    livePoolTokens.value = []
  }

  /** 逐步动画播放（新开一条运行记录） */
  function play(): void {
    if (playing.value) {
      stopTimer()
      return
    }
    if (!liveState.value) {
      activeRunId.value = ''
      const seed = doc.value.settings.seed + runs.value.length
      const st = createMxInitialState(doc.value, { seed, scenarioId: scenarioId() })
      liveState.value = st
      liveEvents.value = []
      liveSnapshots.value = [{ ...st.values }]
      liveFlows.value = [{}]
      livePoolTokens.value = [clone(st.poolTokens ?? {})]
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
      const seed = doc.value.settings.seed + runs.value.length
      const st = createMxInitialState(doc.value, { seed, scenarioId: scenarioId() })
      liveState.value = st
      liveSnapshots.value = [{ ...st.values }]
      liveFlows.value = [{}]
      livePoolTokens.value = [clone(st.poolTokens ?? {})]
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
      params: cur.runtimeParams,
      interactions: pendingInteractions
    })
    pendingInteractions = []
    liveState.value = res.state
    liveSnapshots.value = [...liveSnapshots.value, { ...res.state.values }]
    liveFlows.value = [...liveFlows.value, { ...res.state.edgeFlows }]
    livePoolTokens.value = [...livePoolTokens.value, clone(res.state.poolTokens ?? {})]
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

  /** 确保当前文档具备全局变量 Params 与至少 2 套可对比的数值方案 Scenarios */
  function ensureScenariosReady(): void {
    if (doc.value.params.length > 0 && doc.value.scenarios.length > 0) return
    mutate((d) => {
      if (d.params.length === 0) {
        const resEdges = d.edges.filter((e) => e.kind === 'resource')
        const nodeMap = new Map(d.nodes.map((n) => [n.id, n]))
        const faucetEdge =
          resEdges.find((e) => nodeMap.get(e.from)?.kind === 'source') ?? resEdges[0]
        if (faucetEdge) {
          const f = faucetEdge.formula.trim()
          if (/^\d+(\.\d+)?$/.test(f)) {
            d.params.push({ id: mxNewId('p'), name: 'FaucetRate', value: Number(f) })
            faucetEdge.formula = 'FaucetRate'
          } else if (!/%|\bevery\b|\|/i.test(f)) {
            d.params.push({ id: mxNewId('p'), name: 'FaucetMult', value: 1 })
            faucetEdge.formula = `round((${f}) * FaucetMult)`
          }
        }
        const sinkEdge = resEdges.find(
          (e) =>
            e.id !== faucetEdge?.id &&
            ['drain', 'converter', 'trader'].includes(nodeMap.get(e.to)?.kind ?? '')
        )
        if (sinkEdge) {
          const f = sinkEdge.formula.trim()
          if (/^\d+(\.\d+)?$/.test(f)) {
            d.params.push({ id: mxNewId('p'), name: 'SinkCost', value: Number(f) })
            sinkEdge.formula = 'SinkCost'
          } else if (!/%|\bevery\b|\|/i.test(f)) {
            d.params.push({ id: mxNewId('p'), name: 'SinkMult', value: 1 })
            sinkEdge.formula = `round((${f}) * SinkMult)`
          }
        }
        if (d.params.length === 0) {
          d.params.push({ id: mxNewId('p'), name: 'FlowRate', value: 1 })
        }
      }

      if (d.scenarios.length === 0) {
        const easyParams: Record<string, number> = {}
        const hardParams: Record<string, number> = {}
        d.params.forEach((p, idx) => {
          const base = Number(p.value) || 1
          if (idx === 0) {
            easyParams[p.name] = Math.round(base * 1.4 * 100) / 100
            hardParams[p.name] = Math.round(base * 0.7 * 100) / 100
          } else {
            easyParams[p.name] = Math.round(base * 0.75 * 100) / 100
            hardParams[p.name] = Math.round(base * 1.4 * 100) / 100
          }
        })
        d.scenarios.push(
          { id: mxNewId('sc'), name: 'Easy / Boost', params: easyParams },
          { id: mxNewId('sc'), name: 'Hard / Strict', params: hardParams }
        )
      }
    }, 'initScenarios')
  }

  /** 一键运行并叠加对比全部方案（Scenarios）或多种子轨迹 */
  function runAllScenariosCompare(): void {
    ensureScenariosReady()
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
    const activeScId = doc.value.activeScenarioId
    const primaryRun =
      (activeScId ? newRuns.find((r) => r.scenarioId === activeScId) : newRuns[0]) ?? newRuns[0]
    activeRunId.value = primaryRun?.id ?? ''
    compareRunIds.value = newRuns.filter((r) => r.id !== primaryRun?.id).map((r) => r.id)
    playStep.value = primaryRun?.stepsRun ?? steps
    resultsOpen.value = true
    if (resultsTab.value === 'workbench') {
      resultsTab.value = 'results'
    }
  }

  function enterScenariosMode(): void {
    mode.value = 'scenarios'
    ensureScenariosReady()
    drawer.value = 'params'
    runAllScenariosCompare()
  }

  function enterBuildMode(): void {
    mode.value = 'build'
    if (resultsTab.value === 'workbench') {
      resultsTab.value = 'results'
    }
    if (drawer.value === 'params') {
      drawer.value = ''
    }
    compareRunIds.value = []
    playAgain()
  }

  function selectScenario(scId: string | undefined): void {
    mode.value = 'scenarios'
    mutate((d) => {
      d.activeScenarioId = scId || undefined
    }, 'selScenario')
    runAllScenariosCompare()
  }

  function addScenario(customName?: string): void {
    ensureScenariosReady()
    let createdId = ''
    mutate((d) => {
      const idx = d.scenarios.length + 1
      const scParams: Record<string, number> = {}
      d.params.forEach((p, pIdx) => {
        const mult = pIdx === 0 ? 1 + idx * 0.15 : Math.max(0.4, 1 - idx * 0.1)
        scParams[p.name] = Math.round((Number(p.value) || 1) * mult * 100) / 100
      })
      const sc = {
        id: mxNewId('sc'),
        name: customName || `Scenario ${idx}`,
        params: scParams
      }
      d.scenarios.push(sc)
      d.activeScenarioId = sc.id
      createdId = sc.id
    }, 'addScenario')
    if (createdId) {
      selectScenario(createdId)
    }
  }

  function removeScenario(scId: string): void {
    mutate((d) => {
      d.scenarios = d.scenarios.filter((s) => s.id !== scId)
      if (d.activeScenarioId === scId) {
        d.activeScenarioId = d.scenarios[0]?.id
      }
    }, 'delScenario')
    if (mode.value === 'scenarios') {
      runAllScenariosCompare()
    }
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
      docRevision.value++
    }
    return doc.value.workbench
  }

  function applyWorkbenchPreset(presetId: MxWorkbenchPresetId, syncMacroCanvas = true): void {
    const presetToTemplate: Record<MxWorkbenchPresetId, MxTemplateId> = {
      slay_the_spire_dbg: 'roguelike_mana_deck',
      hearthstone_tcg: 'hearthstone_mana_pack',
      onmyoji_atb: 'onmyoji_speed_orbs',
      balatro_roguelike: 'balatro_ante_jokers',
      survivor_brotato: 'survivor_xp_loop',
      short_drama_progression: 'short_drama_reversal_loop'
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

  function applyWorkbenchPrompt(prompt: string, syncMacroCanvas = true): MxNumericalWorkbench {
    const presetToTemplate: Record<MxWorkbenchPresetId, MxTemplateId> = {
      slay_the_spire_dbg: 'roguelike_mana_deck',
      hearthstone_tcg: 'hearthstone_mana_pack',
      onmyoji_atb: 'onmyoji_speed_orbs',
      balatro_roguelike: 'balatro_ante_jokers',
      survivor_brotato: 'survivor_xp_loop',
      short_drama_progression: 'short_drama_reversal_loop'
    }
    const synthesized = synthesizeMxWorkbenchFromPrompt(
      prompt,
      doc.value.workbench?.activePresetId ?? 'slay_the_spire_dbg'
    )
    if (syncMacroCanvas) {
      const nextDoc = createMxFromTemplate(presetToTemplate[synthesized.activePresetId])
      nextDoc.workbench = synthesized
      replaceDoc(nextDoc, true)
      playAgain()
      runForecast()
      return synthesized
    }
    mutate((d) => {
      d.workbench = synthesized
    }, `wbPrompt:${synthesized.activePresetId}`)
    return synthesized
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

  function upsertParam(rawName: string, initialValue = 1): string {
    const cleanName = mxIdentifier(rawName) || `param_${doc.value.params.length + 1}`
    const existing = doc.value.params.find(
      (p) => mxIdentifier(p.name).toLowerCase() === cleanName.toLowerCase()
    )
    if (existing) {
      return mxIdentifier(existing.name) || existing.name
    }
    const safeVal = Number.isFinite(initialValue) ? initialValue : 1
    mutate((d) => {
      d.params.push({
        id: mxNewId('p'),
        name: cleanName,
        value: safeVal,
        varKind: 'number'
      })
      for (const sc of d.scenarios) {
        if (!(cleanName in sc.params)) {
          sc.params[cleanName] = safeVal
        }
      }
    }, `upsertParam:${cleanName}`)
    return cleanName
  }

  function setParamValue(paramId: string, nextValue: number): void {
    if (!Number.isFinite(nextValue)) return
    mutate((d) => {
      const target = d.params.find((p) => p.id === paramId)
      if (!target) return
      target.value = nextValue
      const key = mxIdentifier(target.name) || target.name
      if (d.activeScenarioId) {
        const sc = d.scenarios.find((s) => s.id === d.activeScenarioId)
        if (sc) sc.params[key] = nextValue
      }
    }, `paramVal:${paramId}`)
  }

  function openFormulaModal(target: MxFormulaModalTarget): void {
    if (target.targetType === 'edge') {
      const exists = doc.value.edges.some((e) => e.id === target.edgeId)
      if (!exists) return
      if (!(selection.edges.length === 1 && selection.edges[0] === target.edgeId)) {
        select([], [target.edgeId])
      }
    } else if (target.targetType === 'node') {
      const exists = doc.value.nodes.some((n) => n.id === target.nodeId)
      if (!exists) return
      if (!(selection.nodes.length === 1 && selection.nodes[0] === target.nodeId)) {
        select([target.nodeId], [])
      }
    } else if (target.targetType === 'param') {
      const exists = doc.value.params.some((p) => p.id === target.paramId)
      if (!exists) return
    }
    formulaModal.value = target
  }

  function closeFormulaModal(): void {
    formulaModal.value = null
  }

  function commitFormulaModal(rawFormula: string): void {
    const t = formulaModal.value
    if (!t) return
    // Collapse newlines/tabs into clean spaces so SVG pills & single-line inputs stay tidy
    const normalized = rawFormula
      .replace(/\s*\r?\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (t.targetType === 'edge') {
      const e = doc.value.edges.find((x) => x.id === t.edgeId)
      if (!e) return
      if (t.field === 'interval') {
        const nextPatch: { interval?: string; formula?: string } = {
          interval: normalized || undefined
        }
        if (normalized && /\|/.test(e.formula)) {
          nextPatch.formula = e.formula.replace(/\s*\|.*$/, '').trim() || '1'
        }
        updateEdge(e.id, nextPatch)
      } else {
        updateEdge(e.id, { formula: normalized })
      }
    } else if (t.targetType === 'node') {
      const n = doc.value.nodes.find((x) => x.id === t.nodeId)
      if (!n) return
      if (t.field === 'botCondition') {
        updateNode(n.id, { botCondition: normalized })
      } else if (n.kind === 'gate') {
        updateNode(n.id, { formula: normalized || undefined })
      } else {
        updateNode(n.id, { formula: normalized })
      }
    } else if (t.targetType === 'param') {
      mutate((d) => {
        const p = d.params.find((x) => x.id === t.paramId)
        if (p) p.formula = normalized
      }, `paramFormula:${t.paramId}`)
    }
    formulaModal.value = null
  }

  return {
    doc,
    peekDoc,
    docRevision,
    topologyRevision,
    isCanvasDragging,
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
    showNodeLabels,
    compactEdgeFormulas,
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
    displayPoolTokens,
    previousStepValues,
    displayFlows,
    edgeCumulativeFlows,
    nodeBottlenecks,
    activeLayerId,
    selectLayer,
    removeLayer,
    assignNodesToLayer,
    canUndo,
    canRedo,
    mutate,
    mutateGeometry,
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
    reconnectEdge,
    moveNodes,
    commitNodePositions,
    createGroupFromSelection,
    moveGroup,
    commitGroupMove,
    commitGroupResize,
    commitEdgeBend,
    updateGroup,
    deleteGroup,
    applyTunableValue,
    applyTunablePair,
    alignSelection,
    setBotMode,
    cycleBotMode,
    copySelection,
    pasteNodes,
    duplicateSelection,
    insertBuildingBlock,
    loadBuildingBlockAsDoc,
    copyBuildingBlock,
    play,
    stepOnce,
    interact,
    adjustRegisterValue,
    playAgain,
    ensureScenariosReady,
    enterScenariosMode,
    enterBuildMode,
    selectScenario,
    addScenario,
    removeScenario,
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
    applyWorkbenchPrompt,
    syncWorkbenchToMacroParams,
    injectValueToCanvasNode,
    upsertParam,
    setParamValue,
    formulaModal,
    openFormulaModal,
    closeFormulaModal,
    commitFormulaModal,
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
