<script setup lang="ts">
/**
 * Standalone Numerical System (`game.numerical`) Dive Studio:
 *  - Mode A (Domain Spec Data Tables): For non-combat GDDs (TCM virtual teaching, medical simulation,
 *    digital twin, VR/XR training, enterprise tools), renders pure domain configuration & tolerance
 *    data tables + scoring/SLA formulas aligned 1:1 with the GDD, with zero combat/novel/gacha pollution.
 *  - Mode B (Combat & Progression Workbench): Micro-combat kernel, level/realm power envelope,
 *    damage multiplier pipeline, entity budget audit, and loot/substat Monte Carlo.
 *  - Strict edge-only topology: only reads upstream/downstream nodes that are actually wired on canvas.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GraphEdge, GraphNode } from '@shared/graph'
import {
  buildDomainNumericalSuiteFromContext,
  createMxFromTemplate,
  createMxWorkbenchPreset,
  createXianxia200LifespanWorkbench,
  exportDomainNumericalSuiteMarkdown,
  exportDomainTableCsv,
  isNonCombatDomainContext,
  MX_WORKBENCH_PRESETS,
  normalizeMxDocument,
  type MxDocument,
  type MxDomainDataTable,
  type MxDomainNumericalSuite,
  type MxNumericalWorkbench,
  type MxWorkbenchPresetId
} from '@shared/gameAssets'
import { useGraphNodeRun } from '../../../composables/useGraphNodeRun'
import { editorDiveKey } from '../../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../../features/graph/model/graphEditorHosts'
import { diveEditorHistory } from '../../../features/graph/ui/diveEditorHistory'
import { useWorkspaceStore } from '../../../stores/workspace'
import { createMxStudioStore, provideMxStudioStore } from './mxStudioStore'
import MxNumericalWorkbenchPanel from './MxNumericalWorkbenchPanel.vue'
import MxFloatingTip from './MxFloatingTip.vue'

const props = defineProps<{
  node: GraphNode
  hostId?: string | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t, locale } = useI18n()
const isEn = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('en')
)
const editorDive = inject(editorDiveKey, null)
const workspace = useWorkspaceStore()
const nodeRef = computed(() => props.node)
const hostIdRef = computed(() => props.hostId ?? '')
const { toggleRun } = useGraphNodeRun(nodeRef, hostIdRef)

const selectedTableId = ref<string>('')
const tableSearchQuery = ref<string>('')
const copyFeedback = ref<string>('')
const loadedGddCacheText = ref<string>('')
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

const ui = computed(() => {
  if (isEn.value) {
    return {
      defaultNodeTitle: 'Numerical System',
      studioBrandTip: 'Numerical System Studio',
      modeDomainTables: '📋 Spec Data Tables',
      modeCombatSim: '⚔️ Combat Sim',
      modeDomainTip: 'Pure GDD parameter, tolerance & schema tables (no combat/novel presets)',
      modeCombatTip: 'Game combat kernel, progression envelope & multiplier simulation',
      unwantedEconBadge: (name: string) =>
        `⚠️ Unrelated Mechanics Linked: ${name} · Click to Disconnect`,
      unwantedEconTip:
        'This Mechanics node appears unrelated to your non-combat GDD. Click to remove the edge.',
      econConnectedBadge: (name: string) => `⚖️ Mechanics: ${name}`,
      econConnectedTip: 'Connected to upstream Mechanics Design — click to inspect',
      disconnectShortTip: 'Disconnect upstream Mechanics edge',
      domainStandaloneBadge: '🌿 Clean GDD Spec Tables Mode (Zero Novel/Combat Pollution)',
      combatStandaloneBadge: 'Standalone Numerical Mode (optional in-economy input)',
      outlineBtn: 'Outline',
      outlineTip: 'Connect or create downstream Novel Outline node',
      novelBtn: 'Novel Studio',
      novelTip: 'Connect or create downstream Novel Chapter node',
      gddBtn: 'GDD Studio',
      gddLinkedBtn: (name: string) => `GDD: ${name}`,
      gddTip: 'Connect & open Game System Design Document (GDD) Studio',
      syncGddBtn: 'Sync GDD Tables',
      syncGddTip: 'Rebuild / sync tables and thresholds from the GDD specification',
      exportCsvBtn: 'Export CSV',
      copyMdBtn: 'Copy Markdown',
      copiedToast: 'Copied Markdown',
      syncedToast: 'Synced from GDD',
      disconnectedToast: 'Disconnected Mechanics edge',
      statTables: (n: number) => `${n} Data Tables`,
      statRows: (n: number) => `${n} Spec Rows`,
      statFormulas: (n: number) => `${n} Core Formulas`,
      formulasHeader: '📐 Core Scoring Formulas & SLA Red-Line Constraints',
      addFormulaBtn: '+ Add Formula',
      formulaNamePlaceholder: 'Formula name',
      formulaExprPlaceholder: 'Mathematical / engineering expression',
      formulaThresholdPlaceholder: 'SLA / Red-line threshold',
      formulaDescPlaceholder: 'Engineering / domain note',
      addTableBtn: '+ New Table',
      searchPlaceholder: 'Filter rows by key, code, acupoint, herb, field...',
      addRowBtn: '+ Add Row',
      deleteRowTip: 'Delete row',
      deleteFormulaTip: 'Delete formula',
      emptyRowsHint: 'No matching rows under current filter.',
      newTableName: (idx: number) => `Custom Spec Table #${idx}`,
      newTableCategory: 'Custom Config',
      newTableDesc: 'Custom domain parameter & configuration table',
      colKey: 'Key / ID',
      colName: 'Parameter Name',
      colValue: 'Default / Range',
      colNote: 'Constraint & Note',
      defaultOutlineTitle: 'Novel Outline',
      defaultNovelTitle: 'Novel · Ch.1',
      defaultNovelStudioTitle: 'Novel Studio',
      defaultGddTitle: 'Game System Plan',
      defaultEconTitle: 'Mechanics Design'
    }
  }
  return {
    defaultNodeTitle: '数值系统', // cjk-ok
    studioBrandTip: '数值系统工作台', // cjk-ok
    modeDomainTables: '📋 策划案专属数值表', // cjk-ok
    modeCombatSim: '⚔️ 游戏战斗数值仿真', // cjk-ok
    modeDomainTip: '纯粹面向教学/医疗/仿真/工具类策划案的参数阈值、实训容差与数据字典配表模式', // cjk-ok
    modeCombatTip: '面向战斗与数值成长类项目的牌库内核、战力包络、伤害乘区与掉落仿真模式', // cjk-ok
    unwantedEconBadge: (name: string) => `⚠️ 误连无关机制节点：${name} · ✂️ 点击一键断开`, // cjk-ok
    unwantedEconTip: '检测到该机制设计节点属于其他小说/游戏链路，点击即可断开连线并消除污染', // cjk-ok
    econConnectedBadge: (name: string) => `⚖️ 已连机制设计：${name}`, // cjk-ok
    econConnectedTip: '已通过连线接入上游「机制设计」节点（点击跳转查看）', // cjk-ok
    disconnectShortTip: '断开与上游机制设计节点的连线', // cjk-ok
    domainStandaloneBadge: '🌿 纯净策划案配表模式（已隔离无关小说与战斗预设）', // cjk-ok
    combatStandaloneBadge: '独立数值配表模式（可从 in-economy 端口连入机制设计）', // cjk-ok
    outlineBtn: '小说大纲', // cjk-ok
    outlineTip: '连接或创建下游「小说大纲」节点', // cjk-ok
    novelBtn: '创建小说', // cjk-ok
    novelTip: '连接或创建下游「创建小说」节点', // cjk-ok
    gddBtn: '策划案生成', // cjk-ok
    gddLinkedBtn: (name: string) => `策划案：${name}`, // cjk-ok
    gddTip: '连接并打开「策划案生成」工作台同步数值配表', // cjk-ok
    syncGddBtn: '同步策划案配表', // cjk-ok
    syncGddTip: '根据关联策划案内容重新提取/对齐专属数值参数表与计分公式', // cjk-ok
    exportCsvBtn: '导出当前表 CSV', // cjk-ok
    copyMdBtn: '复制全套 Markdown', // cjk-ok
    copiedToast: '已复制全套 Markdown 数值表', // cjk-ok
    syncedToast: '已对齐策划案专属数值表', // cjk-ok
    disconnectedToast: '已断开误连的机制设计连线', // cjk-ok
    statTables: (n: number) => `${n} 张核心数值表`, // cjk-ok
    statRows: (n: number) => `${n} 条配置参数`, // cjk-ok
    statFormulas: (n: number) => `${n} 条计分与性能公式`, // cjk-ok
    formulasHeader: '📐 核心计分权重、误差容差与性能验收公式', // cjk-ok
    addFormulaBtn: '+ 新增公式', // cjk-ok
    formulaNamePlaceholder: '公式名称', // cjk-ok
    formulaExprPlaceholder: '计算表达式 / 判定规则', // cjk-ok
    formulaThresholdPlaceholder: '红线阈值 / 验收指标', // cjk-ok
    formulaDescPlaceholder: '工程实现与业务约束说明', // cjk-ok
    addTableBtn: '+ 新建配表', // cjk-ok
    searchPlaceholder: '搜索参数键、穴位编码、中药饮片、题型或表字段...', // cjk-ok
    addRowBtn: '+ 新增配置行', // cjk-ok
    deleteRowTip: '删除该行', // cjk-ok
    deleteFormulaTip: '删除该公式', // cjk-ok
    emptyRowsHint: '当前筛选条件下暂无匹配记录。', // cjk-ok
    newTableName: (idx: number) => `自定义业务数值配表 #${idx}`, // cjk-ok
    newTableCategory: '自定义业务配置', // cjk-ok
    newTableDesc: '自定义策划案参数阈值与规则配置表', // cjk-ok
    colKey: '参数键 / 编码', // cjk-ok
    colName: '配置项名称', // cjk-ok
    colValue: '标准值 / 区间', // cjk-ok
    colNote: '约束与业务说明', // cjk-ok
    defaultOutlineTitle: '小说大纲', // cjk-ok
    defaultNovelTitle: '小说 · 第1章', // cjk-ok
    defaultNovelStudioTitle: '创建小说', // cjk-ok
    defaultGddTitle: '策划案生成', // cjk-ok
    defaultEconTitle: '机制设计' // cjk-ok
  }
})

function flashFeedback(msg: string): void {
  copyFeedback.value = msg
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
  copyFeedbackTimer = setTimeout(() => {
    copyFeedback.value = ''
  }, 2400)
}

/** Strict edge-only lookup: ONLY edges actually wired to `props.node.id` */
const incomingEconomyEdge = computed<GraphEdge | null>(() => {
  void graphEditorHosts.revision.value
  const hostId = props.hostId
  if (!hostId) return null
  const edges = graphEditorHosts.listEdges(hostId)
  for (const edge of edges) {
    if (edge.target === props.node.id) {
      const src = graphEditorHosts.getNode(hostId, edge.source)
      if (src?.typeId === 'game.economy') return edge
    }
  }
  return null
})

const upstreamEconomyNode = computed<GraphNode | null>(() => {
  const hostId = props.hostId
  const edge = incomingEconomyEdge.value
  if (!hostId || !edge) return null
  return graphEditorHosts.getNode(hostId, edge.source)
})

const connectedNovelNode = computed<GraphNode | null>(() => {
  void graphEditorHosts.revision.value
  const hostId = props.hostId
  if (!hostId) return null
  const edges = graphEditorHosts.listEdges(hostId)
  for (const edge of edges) {
    const peerId =
      edge.source === props.node.id
        ? edge.target
        : edge.target === props.node.id
          ? edge.source
          : null
    if (!peerId) continue
    const peer = graphEditorHosts.getNode(hostId, peerId)
    if (peer?.typeId === 'novel.outline' || peer?.typeId === 'asset.novel') {
      return peer
    }
  }
  return null
})

const connectedGameSystemNode = computed<GraphNode | null>(() => {
  void graphEditorHosts.revision.value
  const hostId = props.hostId
  if (!hostId) return null
  const edges = graphEditorHosts.listEdges(hostId)
  for (const edge of edges) {
    const peerId =
      edge.source === props.node.id
        ? edge.target
        : edge.target === props.node.id
          ? edge.source
          : null
    if (!peerId) continue
    const peer = graphEditorHosts.getNode(hostId, peerId)
    if (peer?.typeId === 'asset.gameSystem') return peer
  }
  return null
})

/** Same-canvas GDD node matching domain context (used for GDD table sync & 1-click connect, never novel/economy) */
const candidateDomainGddNode = computed<GraphNode | null>(() => {
  if (connectedGameSystemNode.value) return connectedGameSystemNode.value
  void graphEditorHosts.revision.value
  const hostId = props.hostId
  if (!hostId) return null
  const allNodes = graphEditorHosts.listNodes(hostId)
  const gsNodes = allNodes.filter((n) => n.typeId === 'asset.gameSystem')
  if (gsNodes.length === 0) return null
  const myTitle = (props.node.title ?? '').trim()
  const prefix = myTitle.split(/[·\-_\s]/)[0]?.trim() ?? ''
  if (prefix.length >= 2) {
    const matched = gsNodes.find((n) => (n.title ?? '').includes(prefix))
    if (matched) return matched
  }
  const nonCombatGs = gsNodes.find((n) => isNonCombatDomainContext(n.title ?? ''))
  return nonCombatGs ?? gsNodes[gsNodes.length - 1] ?? null
})

function extractGddNodeInlineText(n: GraphNode | null): string {
  if (!n) return ''
  const genList = n.params?.generatedTexts ?? []
  const selId = n.params?.selectedTextId
  const selItem = genList.find((it) => it.id === selId) ?? genList[genList.length - 1]
  if (selItem?.text?.trim()) return selItem.text.trim()
  if (n.params?.text?.trim()) return n.params.text.trim()
  return ''
}

function getEffectiveGddText(): string {
  return (
    loadedGddCacheText.value.trim() || extractGddNodeInlineText(candidateDomainGddNode.value).trim()
  )
}

function detectDomainModeContext(parsedWb?: Partial<MxNumericalWorkbench> | null): boolean {
  if (connectedNovelNode.value) return false
  const primaryProbe = [
    props.node.title ?? '',
    String(props.node.params.generateInstruction ?? ''),
    connectedGameSystemNode.value?.title ?? ''
  ].join(' ')
  if (isNonCombatDomainContext(primaryProbe)) return true
  return isNonCombatDomainContext(parsedWb?.multiplier?.title ?? '')
}

const linkedNovelChapters = computed<number>(() => {
  const nChap = Number(connectedNovelNode.value?.params.novelTotalChapters)
  if (Number.isFinite(nChap) && nChap >= 20) return Math.round(nChap)
  if (!detectDomainModeContext(null)) {
    const eSteps = Number(upstreamEconomyNode.value?.params.gameEconomySteps)
    if (Number.isFinite(eSteps) && eSteps >= 100) return Math.round(eSteps)
  }
  return 200
})

function isXianxiaLifespanContext(upDoc?: MxDocument | null): boolean {
  if (detectDomainModeContext(null)) return false
  const combined = [
    props.node.title ?? '',
    upstreamEconomyNode.value?.title ?? '',
    connectedNovelNode.value?.title ?? '',
    String(connectedNovelNode.value?.params.text ?? '').slice(0, 400),
    upDoc?.title ?? '',
    upDoc?.description ?? ''
  ].join(' ')
  return (
    upDoc?.templateId === 'xianxia_lifespan_alchemy' ||
    /* cjk-ok */ /山海借命|借命契|残缺药经|沈砚/.test(combined)
  )
}

function persistNodeParams(patch: Record<string, unknown>): void {
  if (!props.hostId) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, patch)
  graphEditorHosts.bumpRevision()
}

function persistTitle(rawTitle: string): void {
  if (!props.hostId) return
  const clean = rawTitle.trim() || ui.value.defaultNodeTitle
  graphEditorHosts.updateNode(props.hostId, props.node.id, {}, clean)
  graphEditorHosts.bumpRevision()
}

function buildFreshDomainSuite(): MxDomainNumericalSuite {
  const gddNode = candidateDomainGddNode.value
  return buildDomainNumericalSuiteFromContext({
    title: props.node.title || gddNode?.title || ui.value.defaultNodeTitle,
    prompt: String(
      props.node.params.generateInstruction ?? gddNode?.params.generateInstruction ?? ''
    ),
    gddText: getEffectiveGddText()
  })
}

function resolveInitialWorkbench(upDoc?: MxDocument | null): MxNumericalWorkbench {
  const xianxiaCtx = isXianxiaLifespanContext(upDoc)
  const hasNovelCtx = Boolean(connectedNovelNode.value) || xianxiaCtx
  const targetChapters = linkedNovelChapters.value
  const domainCtx = detectDomainModeContext(null)

  const presetRaw = String(
    props.node.params.gameNumericalPreset ??
      props.node.params.gameEconomyPreset ??
      (hasNovelCtx ? 'short_drama_progression' : 'slay_the_spire_dbg')
  )
  const validPreset: MxWorkbenchPresetId = (
    !domainCtx && MX_WORKBENCH_PRESETS.some((p) => p.id === presetRaw)
      ? presetRaw
      : hasNovelCtx
        ? 'short_drama_progression'
        : 'slay_the_spire_dbg'
  ) as MxWorkbenchPresetId
  const baseWb = xianxiaCtx
    ? createXianxia200LifespanWorkbench()
    : createMxWorkbenchPreset(validPreset)

  const rawWbJson = String(props.node.params.gameNumericalWorkbenchJson ?? '').trim()
  if (rawWbJson) {
    try {
      const parsed = JSON.parse(rawWbJson) as Partial<MxNumericalWorkbench>
      if (parsed && typeof parsed === 'object' && parsed.multiplier && parsed.combatKernel) {
        let merged: MxNumericalWorkbench = { ...baseWb, ...parsed }
        // Auto-upgrade existing non-combat GDD node that was previously saved without domainTables
        if (!merged.domainTables && detectDomainModeContext(parsed)) {
          const cleanWb = createMxWorkbenchPreset('slay_the_spire_dbg')
          cleanWb.domainTables = buildFreshDomainSuite()
          return cleanWb
        }
        if (merged.domainTables?.enabled) {
          return merged
        }
        const oldLvMax = merged.roguelikeEnvelope?.levelMax ?? 80
        if (
          xianxiaCtx &&
          (merged.activePresetId === 'slay_the_spire_dbg' ||
            oldLvMax <= 80 ||
            !merged.multiplier.title.includes('山海借命录')) // cjk-ok
        ) {
          merged = createXianxia200LifespanWorkbench()
          merged.roguelikeEnvelope.levelMax = Math.max(200, targetChapters)
        } else if (hasNovelCtx && oldLvMax <= 80 && targetChapters > 80) {
          merged = {
            ...merged,
            activePresetId: 'short_drama_progression',
            roguelikeEnvelope: {
              ...merged.roguelikeEnvelope,
              levelMax: targetChapters
            }
          }
        }
        return merged
      }
    } catch {
      // ignore invalid json
    }
  }
  if (domainCtx) {
    baseWb.domainTables = buildFreshDomainSuite()
    return baseWb
  }
  if (hasNovelCtx && (baseWb.roguelikeEnvelope.levelMax ?? 80) <= 80 && targetChapters > 80) {
    baseWb.roguelikeEnvelope.levelMax = targetChapters
  }
  return baseWb
}

function loadInitialDoc(): MxDocument {
  let doc: MxDocument | null = null
  const upEcon = upstreamEconomyNode.value
  const ignoreUnrelatedEcon =
    detectDomainModeContext(null) && (!upEcon || !isNonCombatDomainContext(upEcon.title ?? ''))
  const rawEconDiagram = ignoreUnrelatedEcon
    ? ''
    : String(
        upEcon?.params.gameEconomyDiagramJson ?? props.node.params.gameEconomyDiagramJson ?? ''
      ).trim()
  if (rawEconDiagram) {
    try {
      doc = normalizeMxDocument(JSON.parse(rawEconDiagram))
    } catch {
      doc = null
    }
  }
  if (!doc) {
    doc = createMxFromTemplate(
      isXianxiaLifespanContext(null) ? 'xianxia_lifespan_alchemy' : 'roguelike_run'
    )
  }
  doc.title = props.node.title?.trim() || ui.value.defaultNodeTitle
  doc.workbench = resolveInitialWorkbench(doc)
  return doc
}

const store = createMxStudioStore(loadInitialDoc())
store.mode.value = 'workbench'
store.resultsTab.value = 'workbench'
store.resultsOpen.value = true
const initialRunsParam = Number(props.node.params.gameEconomyMonteCarloRuns)
if (initialRunsParam >= 5) {
  store.forecastRuns.value = Math.min(500, Math.round(initialRunsParam))
}
provideMxStudioStore(store)

const domainSuite = computed<MxDomainNumericalSuite | null>(
  () => store.doc.value.workbench?.domainTables ?? null
)
const isDomainMode = computed<boolean>(() => Boolean(domainSuite.value?.enabled))

const isUnwantedEconomyEdge = computed<boolean>(() => {
  const up = upstreamEconomyNode.value
  if (!up || !isDomainMode.value) return false
  return !isNonCombatDomainContext(up.title ?? '')
})

const activeDomainTable = computed<MxDomainDataTable | null>(() => {
  const tables = domainSuite.value?.tables ?? []
  if (tables.length === 0) return null
  return tables.find((tb) => tb.id === selectedTableId.value) ?? tables[0] ?? null
})

watch(
  () => domainSuite.value?.tables,
  (tables) => {
    if (tables && tables.length > 0 && !tables.some((tb) => tb.id === selectedTableId.value)) {
      selectedTableId.value = tables[0]!.id
    }
  },
  { immediate: true }
)

const totalDomainRows = computed<number>(() =>
  (domainSuite.value?.tables ?? []).reduce((acc, tb) => acc + tb.rows.length, 0)
)

const filteredRowIndices = computed<number[]>(() => {
  const tb = activeDomainTable.value
  if (!tb) return []
  const q = tableSearchQuery.value.trim().toLowerCase()
  if (!q) return tb.rows.map((_, idx) => idx)
  const indices: number[] = []
  tb.rows.forEach((row, idx) => {
    const matched = Object.values(row).some((val) =>
      String(val ?? '')
        .toLowerCase()
        .includes(q)
    )
    if (matched) indices.push(idx)
  })
  return indices
})

function switchStudioMode(target: 'domain' | 'combat'): void {
  store.mutate((d) => {
    if (!d.workbench) d.workbench = resolveInitialWorkbench(d)
    if (target === 'domain') {
      if (!d.workbench.domainTables || d.workbench.domainTables.tables.length === 0) {
        d.workbench.domainTables = buildFreshDomainSuite()
      } else {
        d.workbench.domainTables.enabled = true
      }
    } else if (d.workbench.domainTables) {
      d.workbench.domainTables.enabled = false
    }
  }, 'switchNumericalMode')
  flushToNodeParams()
}

function disconnectEconomyEdge(): void {
  const hostId = props.hostId
  const edge = incomingEconomyEdge.value
  if (!hostId || !edge) return
  graphEditorHosts.removeEdge(hostId, edge.id)
  graphEditorHosts.bumpRevision()
  flashFeedback(ui.value.disconnectedToast)
}

async function tryLoadCandidateGddFileText(): Promise<string> {
  const gddNode = candidateDomainGddNode.value
  if (!gddNode) return ''
  const inline = extractGddNodeInlineText(gddNode)
  if (inline) {
    loadedGddCacheText.value = inline
    return inline
  }
  const genList = gddNode.params?.generatedTexts ?? []
  const selId = gddNode.params?.selectedTextId
  const selItem = genList.find((it) => it.id === selId) ?? genList[genList.length - 1]
  const relPath = (selItem?.relativePath ?? gddNode.params?.previewRelativePath ?? '').trim()
  if (!relPath) return ''
  try {
    const url = await window.studio.getAssetFileUrl(relPath)
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    const txt = await res.text()
    if (txt.trim()) {
      loadedGddCacheText.value = txt
      return txt
    }
  } catch {
    // ignore file fetch errors
  }
  return ''
}

async function syncTablesFromGdd(): Promise<void> {
  await tryLoadCandidateGddFileText()
  const nextSuite = buildFreshDomainSuite()
  store.mutate((d) => {
    if (!d.workbench) d.workbench = resolveInitialWorkbench(d)
    d.workbench.domainTables = nextSuite
  }, 'syncDomainTablesFromGdd')
  if (nextSuite.tables[0]) {
    selectedTableId.value = nextSuite.tables[0].id
  }
  flushToNodeParams()
  flashFeedback(ui.value.syncedToast)
}

function updateCell(tableId: string, rowIdx: number, colKey: string, val: string): void {
  store.mutate((d) => {
    const tb = d.workbench?.domainTables?.tables.find((tItem) => tItem.id === tableId)
    if (tb && tb.rows[rowIdx]) {
      tb.rows[rowIdx]![colKey] = val
    }
  }, 'editDomainTableCell')
}

function updateTableMeta(tableId: string, field: 'title' | 'description', val: string): void {
  store.mutate((d) => {
    const tb = d.workbench?.domainTables?.tables.find((tItem) => tItem.id === tableId)
    if (tb) tb[field] = val
  }, 'editDomainTableMeta')
}

function addRowToActiveTable(): void {
  const tb = activeDomainTable.value
  if (!tb) return
  tableSearchQuery.value = ''
  store.mutate((d) => {
    const target = d.workbench?.domainTables?.tables.find((tItem) => tItem.id === tb.id)
    if (!target) return
    const emptyRow: Record<string, string> = {}
    for (const col of target.columns) {
      emptyRow[col.key] = ''
    }
    target.rows.push(emptyRow)
  }, 'addDomainTableRow')
}

function deleteRowFromActiveTable(rowIdx: number): void {
  const tb = activeDomainTable.value
  if (!tb) return
  store.mutate((d) => {
    const target = d.workbench?.domainTables?.tables.find((tItem) => tItem.id === tb.id)
    if (!target) return
    target.rows.splice(rowIdx, 1)
  }, 'deleteDomainTableRow')
}

function addNewDomainTable(): void {
  const newId = `custom_table_${Date.now().toString(36)}`
  store.mutate((d) => {
    const suite = d.workbench?.domainTables
    if (!suite) return
    const idx = suite.tables.length + 1
    suite.tables.push({
      id: newId,
      title: ui.value.newTableName(idx),
      category: ui.value.newTableCategory,
      description: ui.value.newTableDesc,
      columns: [
        { key: 'key', label: ui.value.colKey, kind: 'text' },
        { key: 'name', label: ui.value.colName, kind: 'text' },
        { key: 'value', label: ui.value.colValue, kind: 'text' },
        { key: 'note', label: ui.value.colNote, kind: 'text' }
      ],
      rows: [{ key: 'param.example', name: '', value: '100', note: '' }]
    })
  }, 'addCustomDomainTable')
  selectedTableId.value = newId
}

function updateFormulaField(
  formulaId: string,
  field: 'name' | 'expression' | 'threshold' | 'description',
  val: string
): void {
  store.mutate((d) => {
    const f = d.workbench?.domainTables?.formulas.find((item) => item.id === formulaId)
    if (f) f[field] = val
  }, 'editDomainFormula')
}

function addDomainFormula(): void {
  store.mutate((d) => {
    const suite = d.workbench?.domainTables
    if (!suite) return
    suite.formulas.push({
      id: `formula_${Date.now().toString(36)}`,
      name: '',
      expression: 'Score = clamp(0, 100, w1 * A + w2 * B)',
      threshold: 'P95 <= 100ms',
      description: ''
    })
  }, 'addDomainFormula')
}

function deleteDomainFormula(formulaId: string): void {
  store.mutate((d) => {
    const suite = d.workbench?.domainTables
    if (!suite) return
    suite.formulas = suite.formulas.filter((item) => item.id !== formulaId)
  }, 'deleteDomainFormula')
}

function downloadActiveTableCsv(): void {
  const tb = activeDomainTable.value
  if (!tb) return
  const csv = exportDomainTableCsv(tb)
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tb.id || 'numerical_table'}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function copyFullDomainMarkdown(): Promise<void> {
  const suite = domainSuite.value
  if (!suite) return
  const md = exportDomainNumericalSuiteMarkdown(suite)
  try {
    await navigator.clipboard.writeText(md)
    flashFeedback(ui.value.copiedToast)
  } catch {
    // ignore clipboard restrictions
  }
}

let lastPersistedWbJson = JSON.stringify(store.doc.value.workbench)
let syncTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [store.doc.value.workbench, store.forecastRuns.value] as const,
  ([wb, runsCount]) => {
    if (!wb) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      const serialized = JSON.stringify(wb)
      lastPersistedWbJson = serialized
      persistNodeParams({
        gameNumericalPreset: wb.activePresetId,
        gameNumericalWorkbenchJson: serialized,
        gameEconomyMonteCarloRuns: runsCount,
        gameEconomySeed: store.doc.value.settings.seed
      })
    }, 180)
  },
  { deep: true }
)

watch(
  () =>
    [props.node.params.gameNumericalWorkbenchJson, props.node.params.gameNumericalPreset] as const,
  ([rawWbJson, rawPreset]) => {
    const jsonStr = String(rawWbJson ?? '').trim()
    if (jsonStr && jsonStr !== lastPersistedWbJson) {
      try {
        const parsed = JSON.parse(jsonStr) as Partial<MxNumericalWorkbench>
        if (parsed && typeof parsed === 'object' && parsed.multiplier) {
          lastPersistedWbJson = jsonStr
          store.mutate((d) => {
            const nextWb: MxNumericalWorkbench = {
              ...createMxWorkbenchPreset(
                (parsed.activePresetId as MxWorkbenchPresetId) || 'slay_the_spire_dbg'
              ),
              ...parsed
            }
            if (!nextWb.domainTables && detectDomainModeContext(parsed)) {
              nextWb.domainTables = buildFreshDomainSuite()
            }
            d.workbench = nextWb
          }, 'externalWbSync')
          return
        }
      } catch {
        // ignore
      }
    }
    const presetStr = String(rawPreset ?? '').trim()
    if (
      !isDomainMode.value &&
      presetStr &&
      MX_WORKBENCH_PRESETS.some((p) => p.id === presetStr) &&
      presetStr !== store.doc.value.workbench?.activePresetId &&
      !jsonStr
    ) {
      const nextWb = createMxWorkbenchPreset(presetStr as MxWorkbenchPresetId)
      lastPersistedWbJson = JSON.stringify(nextWb)
      store.mutate((d) => {
        d.workbench = nextWb
      }, 'externalPresetSync')
    }
  }
)

let unregisterHistory: (() => void) | null = null

onMounted(async () => {
  unregisterHistory = diveEditorHistory.register({
    canUndo: () => store.canUndo.value,
    canRedo: () => store.canRedo.value,
    undo: () => store.undo(),
    redo: () => store.redo()
  })
  const rawSaved = String(props.node.params.gameNumericalWorkbenchJson ?? '').trim()
  if (rawSaved !== lastPersistedWbJson) {
    flushToNodeParams()
  }
  if (!isDomainMode.value && !store.runs.value.length) {
    store.playAgain()
  }
  if (isDomainMode.value && domainSuite.value?.domainId === 'custom_gdd_tables') {
    const fetched = await tryLoadCandidateGddFileText()
    if (fetched) {
      const enriched = buildFreshDomainSuite()
      store.mutate((d) => {
        if (d.workbench) d.workbench.domainTables = enriched
      }, 'hydrateGddTablesOnMount')
      flushToNodeParams()
    }
  }
})

const showNovelProgressionBadge = computed<boolean>(() => {
  if (isDomainMode.value) return false
  return (
    Boolean(connectedNovelNode.value) ||
    store.doc.value.workbench?.activePresetId === 'short_drama_progression'
  )
})

const currentMaxChapterScale = computed(
  () => store.doc.value.workbench?.roguelikeEnvelope.levelMax || 200
)

const novelScaleBadgeLabel = computed(() => {
  const chaps = currentMaxChapterScale.value
  return isEn.value
    ? `📖 ${chaps}-Ch Full Progression (4 Vols)`
    : `📖 已对齐 ${chaps} 章四卷十阶完整数值体系` // cjk-ok
})

const novelScaleBadgeTip = computed(
  () =>
    isEn.value
      ? 'Click to rebuild / align full 200-chapter novel progression & realm ladder'
      : '点击一键重构/对齐 200 章四卷十阶完整小说数值体系（含修为乘区、6大底牌与1~200章突破阶梯）' // cjk-ok
)

function syncFullNovelProgressionSystem(): void {
  const targetChaps = Math.max(200, linkedNovelChapters.value)
  const xianxiaCtx = isXianxiaLifespanContext(store.doc.value)
  const nextWb = xianxiaCtx
    ? createXianxia200LifespanWorkbench()
    : createMxWorkbenchPreset('short_drama_progression')
  nextWb.roguelikeEnvelope.levelMax = targetChaps
  nextWb.roguelikeEnvelope.floors = 20
  nextWb.roguelikeEnvelope.levelAscensionInterval = Math.max(10, Math.round(targetChaps / 10))
  store.mutate((d) => {
    d.workbench = nextWb
  }, 'sync200ChapSystem')
  flushToNodeParams()
}

onBeforeUnmount(() => {
  unregisterHistory?.()
  unregisterHistory = null
  store.stopTimer()
  if (syncTimer) clearTimeout(syncTimer)
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
})

function flushToNodeParams(): void {
  const wb = store.doc.value.workbench ?? resolveInitialWorkbench()
  persistNodeParams({
    gameNumericalPreset: wb.activePresetId,
    gameNumericalWorkbenchJson: JSON.stringify(wb),
    gameEconomyMonteCarloRuns: store.forecastRuns.value,
    gameEconomySeed: store.doc.value.settings.seed
  })
}

async function runGraphNode(): Promise<void> {
  flushToNodeParams()
  await toggleRun()
}

async function switchToDive(
  viewId: 'novel.workbench' | 'gameSystem.workbench' | 'game.workbench',
  targetNodeId: string,
  title: string
): Promise<void> {
  const hostId = props.hostId
  if (!hostId) return
  workspace.selectGraphNode(targetNodeId, hostId)
  const meta = { viewId, hostId, nodeId: targetNodeId }
  if (editorDive) {
    await editorDive.popTo(Math.max(-1, editorDive.frames.length - 2))
    await editorDive.diveView(meta, title)
    return
  }
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (rootKey) {
    workspace.divePopTo(rootKey, -1)
    workspace.diveIntoView(rootKey, meta, title)
  }
}

function openUpstreamEconomyDive(): void {
  const up = upstreamEconomyNode.value
  if (!up) return
  flushToNodeParams()
  switchToDive('game.workbench', up.id, up.title?.trim() || ui.value.defaultEconTitle)
}

function pushAndOpenDownstreamOutline(): void {
  flushToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  let outlineNode: GraphNode | null = null
  for (const edge of graphEditorHosts.listEdges(hostId)) {
    if (edge.source === props.node.id) {
      const tgt = graphEditorHosts.getNode(hostId, edge.target)
      if (tgt?.typeId === 'novel.outline') {
        outlineNode = tgt
        break
      }
    }
  }
  if (!outlineNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'novel.outline',
      title: ui.value.defaultOutlineTitle,
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: (props.node.position?.y ?? 200) - 120
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text', targetPort: 'in-numerical' }]
    })
    if (newId) outlineNode = graphEditorHosts.getNode(hostId, newId)
  }
  if (!outlineNode) return
  switchToDive(
    'novel.workbench',
    outlineNode.id,
    outlineNode.title?.trim() || ui.value.defaultOutlineTitle
  )
}

function pushAndOpenDownstreamNovel(): void {
  flushToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  let novelNode: GraphNode | null = null
  for (const edge of graphEditorHosts.listEdges(hostId)) {
    if (edge.source === props.node.id) {
      const tgt = graphEditorHosts.getNode(hostId, edge.target)
      if (tgt?.typeId === 'asset.novel') {
        novelNode = tgt
        break
      }
    }
  }
  if (!novelNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'asset.novel',
      title: ui.value.defaultNovelTitle,
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: props.node.position?.y ?? 200
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text', targetPort: 'in-numerical' }]
    })
    if (newId) novelNode = graphEditorHosts.getNode(hostId, newId)
  }
  if (!novelNode) return
  switchToDive(
    'novel.workbench',
    novelNode.id,
    novelNode.title?.trim() || ui.value.defaultNovelStudioTitle
  )
}

function pushAndOpenDownstreamGameSystem(): void {
  flushToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  let gsNode = connectedGameSystemNode.value ?? candidateDomainGddNode.value
  if (!gsNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'asset.gameSystem',
      title: ui.value.defaultGddTitle,
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: (props.node.position?.y ?? 200) + 120
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text', targetPort: 'in-numerical' }]
    })
    if (newId) gsNode = graphEditorHosts.getNode(hostId, newId)
  } else {
    const edges = graphEditorHosts.listEdges(hostId)
    if (!edges.some((e) => e.source === props.node.id && e.target === gsNode!.id)) {
      graphEditorHosts.connectNodes(hostId, props.node.id, gsNode.id, 'out-text', 'in-numerical')
    }
  }
  if (!gsNode) return
  switchToDive('gameSystem.workbench', gsNode.id, gsNode.title?.trim() || ui.value.defaultGddTitle)
}
</script>

<template>
  <div class="num-studio">
    <!-- Top navigation bar -->
    <header class="num-topbar">
      <div class="num-topbar-left">
        <div class="num-brand" :title="ui.studioBrandTip">{{ isDomainMode ? '📋' : '⚔️' }}</div>
        <input
          type="text"
          class="num-title-input"
          :value="props.node.title || ui.defaultNodeTitle"
          @change="persistTitle(($event.target as HTMLInputElement).value)"
        />

        <!-- Mode toggle: Domain Spec Data Tables vs Combat Simulation -->
        <div class="num-mode-switch">
          <button
            type="button"
            class="num-mode-pill"
            :class="{ 'is-active': isDomainMode }"
            :title="ui.modeDomainTip"
            @click="switchStudioMode('domain')"
          >
            {{ ui.modeDomainTables }}
          </button>
          <button
            type="button"
            class="num-mode-pill"
            :class="{ 'is-active': !isDomainMode }"
            :title="ui.modeCombatTip"
            @click="switchStudioMode('combat')"
          >
            {{ ui.modeCombatSim }}
          </button>
        </div>

        <!-- Warning pill if an unrelated novel/game Economy node was auto-wired earlier -->
        <button
          v-if="upstreamEconomyNode && isUnwantedEconomyEdge"
          type="button"
          class="num-econ-badge is-warning"
          :title="ui.unwantedEconTip"
          @click="disconnectEconomyEdge"
        >
          {{ ui.unwantedEconBadge(upstreamEconomyNode.title || ui.defaultEconTitle) }}
        </button>

        <span v-else-if="upstreamEconomyNode" class="num-econ-group">
          <button
            type="button"
            class="num-econ-badge is-connected"
            :title="ui.econConnectedTip"
            @click="openUpstreamEconomyDive"
          >
            {{ ui.econConnectedBadge(upstreamEconomyNode.title || ui.defaultEconTitle) }}
          </button>
          <button
            type="button"
            class="num-econ-disconnect"
            :title="ui.disconnectShortTip"
            @click="disconnectEconomyEdge"
          >
            ×
          </button>
        </span>

        <span v-else class="num-econ-badge" :class="{ 'is-clean': isDomainMode }">
          {{ isDomainMode ? ui.domainStandaloneBadge : ui.combatStandaloneBadge }}
        </span>

        <button
          v-if="showNovelProgressionBadge"
          type="button"
          class="num-econ-badge is-connected"
          :title="novelScaleBadgeTip"
          @click="syncFullNovelProgressionSystem"
        >
          {{ novelScaleBadgeLabel }}
        </button>
      </div>

      <div class="num-topbar-right">
        <span v-if="copyFeedback" class="num-toast">✅ {{ copyFeedback }}</span>

        <template v-if="isDomainMode">
          <button
            type="button"
            class="num-top-btn"
            :title="ui.syncGddTip"
            @click="syncTablesFromGdd"
          >
            🔄 {{ ui.syncGddBtn }}
          </button>
          <button type="button" class="num-top-btn" @click="downloadActiveTableCsv">
            📥 {{ ui.exportCsvBtn }}
          </button>
          <button type="button" class="num-top-btn" @click="copyFullDomainMarkdown">
            📋 {{ ui.copyMdBtn }}
          </button>
        </template>

        <template v-else-if="props.hostId">
          <button
            type="button"
            class="num-top-btn"
            :title="ui.outlineTip"
            @click="pushAndOpenDownstreamOutline"
          >
            🗺️ {{ ui.outlineBtn }}
          </button>
          <button
            type="button"
            class="num-top-btn"
            :title="ui.novelTip"
            @click="pushAndOpenDownstreamNovel"
          >
            📚 {{ ui.novelBtn }}
          </button>
        </template>

        <button
          v-if="props.hostId"
          type="button"
          class="num-top-btn"
          :title="ui.gddTip"
          @click="pushAndOpenDownstreamGameSystem"
        >
          🕹️
          {{
            connectedGameSystemNode
              ? ui.gddLinkedBtn(connectedGameSystemNode.title || ui.gddBtn)
              : ui.gddBtn
          }}
        </button>

        <button type="button" class="num-top-btn is-run" @click="runGraphNode">
          ⚡ {{ t('mx.top.bakeToNode') }}
        </button>

        <button type="button" class="num-top-btn is-done" @click="emit('close')">
          {{ t('mx.top.done') }}
        </button>
      </div>
    </header>

    <!-- Mode A: Domain Spec Data Tables Workbench -->
    <div v-if="isDomainMode && domainSuite" class="domain-workbench">
      <!-- Banner & Stats -->
      <section class="domain-hero">
        <div class="domain-hero-main">
          <div class="domain-hero-title">{{ domainSuite.title }}</div>
          <div class="domain-hero-sub">{{ domainSuite.summary }}</div>
        </div>
        <div class="domain-hero-stats">
          <span class="domain-stat-chip">📊 {{ ui.statTables(domainSuite.tables.length) }}</span>
          <span class="domain-stat-chip">🔢 {{ ui.statRows(totalDomainRows) }}</span>
          <span class="domain-stat-chip"
            >📐 {{ ui.statFormulas(domainSuite.formulas.length) }}</span
          >
        </div>
      </section>

      <!-- Formulas & Red-Line Thresholds -->
      <section class="domain-formulas-panel">
        <div class="domain-section-head">
          <span class="domain-section-title">{{ ui.formulasHeader }}</span>
          <button type="button" class="domain-mini-btn" @click="addDomainFormula">
            {{ ui.addFormulaBtn }}
          </button>
        </div>
        <div class="domain-formulas-grid">
          <div v-for="f in domainSuite.formulas" :key="f.id" class="domain-formula-card">
            <div class="domain-formula-top">
              <input
                type="text"
                class="domain-formula-name"
                :value="f.name"
                :placeholder="ui.formulaNamePlaceholder"
                @change="
                  updateFormulaField(f.id, 'name', ($event.target as HTMLInputElement).value)
                "
              />
              <input
                type="text"
                class="domain-formula-threshold"
                :value="f.threshold"
                :placeholder="ui.formulaThresholdPlaceholder"
                @change="
                  updateFormulaField(f.id, 'threshold', ($event.target as HTMLInputElement).value)
                "
              />
              <button
                type="button"
                class="domain-icon-del"
                :title="ui.deleteFormulaTip"
                @click="deleteDomainFormula(f.id)"
              >
                ×
              </button>
            </div>
            <input
              type="text"
              class="domain-formula-expr"
              :value="f.expression"
              :placeholder="ui.formulaExprPlaceholder"
              @change="
                updateFormulaField(f.id, 'expression', ($event.target as HTMLInputElement).value)
              "
            />
            <input
              type="text"
              class="domain-formula-desc"
              :value="f.description"
              :placeholder="ui.formulaDescPlaceholder"
              @change="
                updateFormulaField(f.id, 'description', ($event.target as HTMLInputElement).value)
              "
            />
          </div>
        </div>
      </section>

      <!-- Table selector tabs -->
      <section class="domain-tables-panel">
        <div class="domain-tabs-bar">
          <div class="domain-tabs-scroll">
            <button
              v-for="(tb, idx) in domainSuite.tables"
              :key="tb.id"
              type="button"
              class="domain-tab-btn"
              :class="{ 'is-active': activeDomainTable?.id === tb.id }"
              @click="selectedTableId = tb.id"
            >
              <span class="domain-tab-idx">{{ idx + 1 }}</span>
              <span class="domain-tab-label">{{ tb.title }}</span>
              <span class="domain-tab-count">{{ tb.rows.length }}</span>
            </button>
            <button type="button" class="domain-tab-add" @click="addNewDomainTable">
              {{ ui.addTableBtn }}
            </button>
          </div>
        </div>

        <!-- Active table toolbar & editable grid -->
        <div v-if="activeDomainTable" class="domain-active-table">
          <div class="domain-table-toolbar">
            <div class="domain-table-meta">
              <input
                type="text"
                class="domain-table-title-input"
                :value="activeDomainTable.title"
                @change="
                  updateTableMeta(
                    activeDomainTable.id,
                    'title',
                    ($event.target as HTMLInputElement).value
                  )
                "
              />
              <input
                type="text"
                class="domain-table-desc-input"
                :value="activeDomainTable.description"
                @change="
                  updateTableMeta(
                    activeDomainTable.id,
                    'description',
                    ($event.target as HTMLInputElement).value
                  )
                "
              />
            </div>
            <div class="domain-table-actions">
              <input
                v-model="tableSearchQuery"
                type="search"
                class="domain-search-input"
                :placeholder="ui.searchPlaceholder"
              />
              <button type="button" class="domain-add-row-btn" @click="addRowToActiveTable">
                {{ ui.addRowBtn }}
              </button>
            </div>
          </div>

          <div class="domain-grid-wrap">
            <table class="domain-grid">
              <thead>
                <tr>
                  <th class="col-idx">#</th>
                  <th v-for="col in activeDomainTable.columns" :key="col.key">
                    {{ col.label }}
                  </th>
                  <th class="col-act"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="rIdx in filteredRowIndices" :key="`${activeDomainTable.id}_${rIdx}`">
                  <td class="col-idx">{{ rIdx + 1 }}</td>
                  <td
                    v-for="(col, cIdx) in activeDomainTable.columns"
                    :key="col.key"
                    :class="{ 'is-code-col': cIdx === 0 }"
                  >
                    <input
                      type="text"
                      class="domain-cell-input"
                      :class="{ 'is-mono': cIdx === 0 }"
                      :value="activeDomainTable.rows[rIdx]?.[col.key] ?? ''"
                      @change="
                        updateCell(
                          activeDomainTable.id,
                          rIdx,
                          col.key,
                          ($event.target as HTMLInputElement).value
                        )
                      "
                    />
                  </td>
                  <td class="col-act">
                    <button
                      type="button"
                      class="domain-icon-del"
                      :title="ui.deleteRowTip"
                      @click="deleteRowFromActiveTable(rIdx)"
                    >
                      ×
                    </button>
                  </td>
                </tr>
                <tr v-if="filteredRowIndices.length === 0">
                  <td :colspan="activeDomainTable.columns.length + 2" class="domain-empty-cell">
                    {{ ui.emptyRowsHint }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <!-- Mode B: Combat & Progression Simulation Workbench -->
    <div v-else class="num-main">
      <MxNumericalWorkbenchPanel />
    </div>
    <MxFloatingTip />
  </div>
</template>

<style scoped>
.num-studio {
  --bg-elev: var(--bg-elevated);
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
}

.num-topbar {
  min-height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  gap: 10px;
  flex-wrap: wrap;
}

.num-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.num-brand {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.num-title-input {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 3px 7px;
  width: 190px;
}

.num-title-input:hover,
.num-title-input:focus {
  border-color: var(--border);
  background: var(--bg);
  outline: none;
}

.num-mode-switch {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 7px;
  background: var(--bg);
  border: 1px solid var(--border);
  gap: 2px;
}

.num-mode-pill {
  height: 24px;
  padding: 0 9px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.num-mode-pill.is-active {
  background: rgba(16, 185, 129, 0.18);
  color: color-mix(in srgb, #059669 78%, var(--text));
}

.num-econ-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.num-econ-badge {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--bg);
  white-space: nowrap;
}

.num-econ-badge.is-clean {
  color: color-mix(in srgb, #059669 78%, var(--text));
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.08);
}

.num-econ-badge.is-connected {
  cursor: pointer;
  color: color-mix(in srgb, #059669 78%, var(--text));
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.1);
}

.num-econ-badge.is-connected:hover {
  background: rgba(16, 185, 129, 0.18);
}

.num-econ-badge.is-warning {
  cursor: pointer;
  color: color-mix(in srgb, #d97706 78%, var(--text));
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.14);
  font-weight: 600;
}

.num-econ-badge.is-warning:hover {
  background: rgba(245, 158, 11, 0.24);
}

.num-econ-disconnect {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.num-econ-disconnect:hover {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.5);
}

.num-topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.num-toast {
  font-size: 11px;
  color: color-mix(in srgb, #059669 78%, var(--text));
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.35);
  white-space: nowrap;
}

.num-top-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.num-top-btn:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.06));
}

.num-top-btn.is-run {
  background: rgba(168, 85, 247, 0.15);
  border-color: rgba(168, 85, 247, 0.45);
  color: color-mix(in srgb, #9333ea 78%, var(--text));
}

.num-top-btn.is-run:hover {
  background: rgba(168, 85, 247, 0.25);
}

.num-top-btn.is-done {
  background: var(--accent, #2563eb);
  border-color: transparent;
  color: #fff;
}

.num-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Domain Spec Data Tables Workbench */
.domain-workbench {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 12px;
  overflow-y: auto;
}

.domain-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(16, 185, 129, 0.28);
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.06));
  flex-wrap: wrap;
}

.domain-hero-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.domain-hero-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 3px;
}

.domain-hero-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.domain-stat-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  color: var(--text);
}

.domain-formulas-panel {
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  padding: 10px 12px;
}

.domain-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.domain-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.domain-mini-btn {
  height: 24px;
  padding: 0 9px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.domain-mini-btn:hover {
  border-color: rgba(16, 185, 129, 0.5);
  color: color-mix(in srgb, #059669 78%, var(--text));
}

.domain-formulas-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 8px;
}

.domain-formula-card {
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.domain-formula-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.domain-formula-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 5px;
}

.domain-formula-threshold {
  width: 155px;
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in srgb, #059669 78%, var(--text));
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 4px;
  padding: 2px 6px;
}

.domain-formula-expr {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  color: color-mix(in srgb, #2563eb 78%, var(--text));
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 7px;
}

.domain-formula-desc {
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 5px;
}

.domain-formula-name:focus,
.domain-formula-desc:focus,
.domain-formula-expr:focus,
.domain-formula-threshold:focus {
  border-color: rgba(59, 130, 246, 0.55);
  outline: none;
}

.domain-tables-panel {
  flex: 1;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  overflow: hidden;
}

.domain-tabs-bar {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  padding: 6px 10px;
}

.domain-tabs-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}

.domain-tab-btn {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.domain-tab-btn.is-active {
  background: rgba(37, 99, 235, 0.16);
  border-color: rgba(59, 130, 246, 0.55);
  color: color-mix(in srgb, #2563eb 78%, var(--text));
  font-weight: 600;
}

.domain-tab-idx {
  width: 17px;
  height: 17px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.domain-tab-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.domain-tab-add {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.domain-tab-add:hover {
  color: var(--text);
  border-color: rgba(16, 185, 129, 0.5);
}

.domain-active-table {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.domain-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.domain-table-meta {
  flex: 1;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.domain-table-title-input {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 5px;
}

.domain-table-desc-input {
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 1px 5px;
}

.domain-table-title-input:focus,
.domain-table-desc-input:focus {
  border-color: var(--border);
  background: var(--bg);
  outline: none;
}

.domain-table-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.domain-search-input {
  width: 260px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  padding: 0 9px;
}

.domain-search-input:focus {
  border-color: rgba(59, 130, 246, 0.55);
  outline: none;
}

.domain-add-row-btn {
  height: 28px;
  padding: 0 11px;
  border-radius: 6px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  background: rgba(16, 185, 129, 0.14);
  color: color-mix(in srgb, #059669 78%, var(--text));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.domain-add-row-btn:hover {
  background: rgba(16, 185, 129, 0.24);
}

.domain-grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.domain-grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.domain-grid thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  white-space: nowrap;
}

.domain-grid tbody tr {
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.domain-grid tbody tr:hover {
  background: rgba(148, 163, 184, 0.08);
}

.domain-grid td {
  padding: 4px 6px;
  vertical-align: middle;
}

.col-idx {
  width: 36px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}

.col-act {
  width: 32px;
  text-align: center;
}

.domain-cell-input {
  width: 100%;
  min-width: 90px;
  font-size: 12px;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 6px;
}

.domain-cell-input.is-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: color-mix(in srgb, #2563eb 78%, var(--text));
  font-size: 11.5px;
}

.domain-cell-input:hover {
  border-color: rgba(148, 163, 184, 0.22);
}

.domain-cell-input:focus {
  border-color: rgba(59, 130, 246, 0.65);
  background: var(--bg);
  outline: none;
}

.domain-icon-del {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.domain-icon-del:hover {
  background: rgba(239, 68, 68, 0.16);
  color: #f87171;
}

.domain-empty-cell {
  text-align: center;
  padding: 28px 12px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
