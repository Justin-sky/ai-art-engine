<script setup lang="ts">
/**
 * Machinations.io 1:1 完整复刻工作台（6 大区域组装）：
 *  ① 顶部导航栏：Logo + 可编辑标题 + Build | Scenarios 切换 + Export 下拉 + 运行节点 + 完成返回
 *  ② 左侧图标导航栏（Agent / Templates / Resources / Params / Layers / Clips / History / Docs）+ 滑出抽屉 MxDrawer
 *  ③ 中央无限白底点阵画布 MxCanvas（悬浮 13 按钮工具栏 + 缩放控制 + 动态资源球动画）
 *  ④ 右侧属性检查器 MxInspector
 *  ⑤ 底部 Results 折线图与节点自然语言趋势卡片 + Runtime Debugger
 *  ⑥ 最底部播放控制栏（Play / Step / Play again / Scrubber / Forecast）
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GraphNode } from '@shared/graph'
import {
  createMxFromTemplate,
  exportMxForecastCsv,
  exportMxGodotGd,
  exportMxRunCsv,
  exportMxToMermaid,
  exportMxUnityCs,
  normalizeMxDocument,
  type MxDocument,
  type MxTemplateId
} from '@shared/gameAssets'
import { useGraphNodeRun } from '../../../composables/useGraphNodeRun'
import { editorDiveKey } from '../../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../../features/graph/model/graphEditorHosts'
import { diveEditorHistory } from '../../../features/graph/ui/diveEditorHistory'
import { useWorkspaceStore } from '../../../stores/workspace'
import {
  createMxStudioStore,
  provideMxStudioStore,
  type MxDrawer as MxDrawerKind
} from './mxStudioStore'
import MxCanvas from './MxCanvas.vue'
import MxInspector from './MxInspector.vue'
import MxResultsPanel from './MxResultsPanel.vue'
import MxDrawer from './MxDrawer.vue'

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

const pipelineUi = computed(() =>
  isEn.value
    ? {
        pushNovelBtn: 'Novel Studio',
        pushNovelTip: 'Create or connect downstream Novel Generator and open its Dive workbench',
        pushGameSystemBtn: 'GDD Studio',
        pushGameSystemTip:
          'Create or connect downstream Game System Plan and open its Dive workbench'
      }
    : {
        pushNovelBtn: '创建小说', // cjk-ok
        pushNovelTip: '自动创建或连接下游「创建小说」节点并进入连载小说工作台', // cjk-ok
        pushGameSystemBtn: '策划案生成', // cjk-ok
        pushGameSystemTip: '自动创建或连接下游「策划案生成」节点并进入游戏策划案工作台' // cjk-ok
      }
)

function persistNodeParams(patch: Record<string, unknown>): void {
  if (!props.hostId) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, patch)
  graphEditorHosts.bumpRevision()
}

function loadInitialDoc(): MxDocument {
  const raw = String(props.node.params.gameEconomyDiagramJson ?? '').trim()
  if (raw) {
    try {
      return normalizeMxDocument(JSON.parse(raw))
    } catch {
      // ignore invalid json
    }
  }
  const preset = String(props.node.params.gameEconomyPreset ?? 'roguelike_run') as MxTemplateId
  return createMxFromTemplate(preset)
}

const store = createMxStudioStore(loadInitialDoc())
const initialRunsParam = Number(props.node.params.gameEconomyMonteCarloRuns)
if (initialRunsParam >= 5) {
  store.forecastRuns.value = Math.min(500, Math.round(initialRunsParam))
}
provideMxStudioStore(store)

const canvasRef = ref<InstanceType<typeof MxCanvas> | null>(null)
const exportOpen = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

let lastPersistedJson = JSON.stringify(store.doc.value)
let lastSeenPreset = String(props.node.params.gameEconomyPreset ?? '')

// 同步画布内部改动回 GraphNode.params
let syncTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [store.doc.value, store.forecastRuns.value] as const,
  ([doc, runsCount]) => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      const serialized = JSON.stringify(doc)
      lastPersistedJson = serialized
      persistNodeParams({
        gameEconomyDiagramJson: serialized,
        gameEconomySteps: doc.settings.steps,
        gameEconomyMonteCarloRuns: runsCount,
        gameEconomyRuns: runsCount,
        gameEconomySeed: doc.settings.seed
      })
    }, 180)
  },
  { deep: true }
)

// 监听来自右侧 AI 会话面板（mcp__studio__graph_edit）或属性检查器的外部参数热更新
watch(
  () => [props.node.params.gameEconomyDiagramJson, props.node.params.gameEconomyPreset] as const,
  ([rawJson, rawPreset]) => {
    const jsonStr = String(rawJson ?? '').trim()
    const presetStr = String(rawPreset ?? '').trim()
    if (jsonStr && jsonStr !== lastPersistedJson) {
      try {
        const nextDoc = normalizeMxDocument(JSON.parse(jsonStr))
        lastPersistedJson = JSON.stringify(nextDoc)
        lastSeenPreset = presetStr
        store.replaceDoc(nextDoc)
        store.playAgain()
        setTimeout(() => canvasRef.value?.fitToScreen(), 40)
        return
      } catch {
        // ignore invalid json
      }
    }
    if (presetStr && presetStr !== lastSeenPreset && !jsonStr) {
      lastSeenPreset = presetStr
      const nextDoc = createMxFromTemplate(presetStr as MxTemplateId)
      lastPersistedJson = JSON.stringify(nextDoc)
      store.replaceDoc(nextDoc)
      store.playAgain()
      setTimeout(() => canvasRef.value?.fitToScreen(), 40)
    }
  }
)

let unregisterHistory: (() => void) | null = null

onMounted(() => {
  unregisterHistory = diveEditorHistory.register({
    canUndo: () => store.canUndo.value,
    canRedo: () => store.canRedo.value,
    undo: () => store.undo(),
    redo: () => store.redo()
  })
  // 首次打开自动执行一次 Play again 填充底部图表与趋势卡片（与截图一致）
  if (!store.runs.value.length) {
    store.playAgain()
  }
})

onBeforeUnmount(() => {
  unregisterHistory?.()
  unregisterHistory = null
  store.stopTimer()
  if (syncTimer) clearTimeout(syncTimer)
})

const navItems: Array<{ id: Exclude<MxDrawerKind, ''>; icon: string; labelKey: string }> = [
  { id: 'agents', icon: '🤖', labelKey: 'mx.nav.agents' },
  { id: 'templates', icon: '⊞', labelKey: 'mx.nav.templates' },
  { id: 'resources', icon: '◉', labelKey: 'mx.nav.resources' },
  { id: 'params', icon: '(x)', labelKey: 'mx.nav.params' },
  { id: 'layers', icon: '☰', labelKey: 'mx.nav.layers' },
  { id: 'clips', icon: '⧉', labelKey: 'mx.nav.clips' },
  { id: 'history', icon: '⟲', labelKey: 'mx.nav.history' },
  { id: 'docs', icon: '?', labelKey: 'mx.nav.docs' }
]

function toggleDrawer(id: Exclude<MxDrawerKind, ''>): void {
  store.drawer.value = store.drawer.value === id ? '' : id
  if (store.drawer.value === 'params') {
    store.ensureScenariosReady()
  }
}

const activeScenario = computed(
  () => store.doc.value.scenarios.find((sc) => sc.id === store.doc.value.activeScenarioId) ?? null
)

function getScenarioParamVal(paramName: string, fallback: number): number {
  if (!activeScenario.value) return fallback
  const ov = activeScenario.value.params[paramName]
  return Number.isFinite(ov) ? ov! : fallback
}

function updateScenarioParamVal(paramName: string, rawVal: string): void {
  const num = Number(rawVal)
  const val = Number.isFinite(num) ? num : 0
  store.mutate((d) => {
    if (d.activeScenarioId) {
      const sc = d.scenarios.find((x) => x.id === d.activeScenarioId)
      if (sc) sc.params[paramName] = val
    } else {
      const p = d.params.find((x) => x.name === paramName)
      if (p) p.value = val
    }
  }, `scParam:${paramName}`)
  store.runAllScenariosCompare()
}

function formatScenarioDelta(paramName: string, baseVal: number): string {
  if (!activeScenario.value || !baseVal) return ''
  const cur = getScenarioParamVal(paramName, baseVal)
  const diffPct = Math.round(((cur - baseVal) / Math.abs(baseVal)) * 100)
  if (diffPct === 0) return ''
  return diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`
}

function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  exportOpen.value = false
}

const safeSlug = computed(
  () =>
    (store.doc.value.title || 'machinations')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'diagram'
)

function exportFormat(
  fmt: 'svg' | 'png' | 'gd' | 'cs' | 'mmd' | 'run_csv' | 'fc_csv' | 'json'
): void {
  const doc = store.doc.value
  if (fmt === 'svg') {
    canvasRef.value?.exportSvgDiagram(safeSlug.value)
    exportOpen.value = false
  } else if (fmt === 'png') {
    canvasRef.value?.exportPngDiagram(safeSlug.value)
    exportOpen.value = false
  } else if (fmt === 'gd') {
    downloadFile(`${safeSlug.value}_economy.gd`, exportMxGodotGd(doc))
  } else if (fmt === 'cs') {
    downloadFile(`${safeSlug.value}Economy.cs`, exportMxUnityCs(doc))
  } else if (fmt === 'mmd') {
    downloadFile(`${safeSlug.value}.mmd`, exportMxToMermaid(doc))
  } else if (fmt === 'run_csv') {
    if (!store.activeRun.value) store.playAgain()
    if (store.activeRun.value) {
      downloadFile(
        `${safeSlug.value}_play.csv`,
        exportMxRunCsv(doc, store.activeRun.value),
        'text/csv'
      )
    }
  } else if (fmt === 'fc_csv') {
    if (!store.forecast.value) store.runForecast()
    if (store.forecast.value) {
      downloadFile(
        `${safeSlug.value}_forecast.csv`,
        exportMxForecastCsv(doc, store.forecast.value),
        'text/csv'
      )
    }
  } else if (fmt === 'json') {
    downloadFile(`${safeSlug.value}.mx.json`, JSON.stringify(doc, null, 2), 'application/json')
  }
}

function triggerImportJson(): void {
  exportOpen.value = false
  fileInputRef.value?.click()
}

function onImportFile(e: Event): void {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = normalizeMxDocument(JSON.parse(String(reader.result ?? '')))
      store.replaceDoc(parsed)
      store.playAgain()
      setTimeout(() => canvasRef.value?.fitToScreen(), 30)
    } catch {
      // ignore invalid file
    }
  }
  reader.readAsText(file)
}

async function runGraphNode(): Promise<void> {
  persistNodeParams({
    gameEconomyDiagramJson: JSON.stringify(store.doc.value),
    gameEconomySteps: store.doc.value.settings.steps,
    gameEconomyMonteCarloRuns: store.forecastRuns.value,
    gameEconomyRuns: store.forecastRuns.value,
    gameEconomySeed: store.doc.value.settings.seed
  })
  await toggleRun()
}

function flushDocToNodeParams(): void {
  persistNodeParams({
    gameEconomyDiagramJson: JSON.stringify(store.doc.value),
    gameEconomySteps: store.doc.value.settings.steps,
    gameEconomyMonteCarloRuns: store.forecastRuns.value,
    gameEconomyRuns: store.forecastRuns.value,
    gameEconomySeed: store.doc.value.settings.seed
  })
}

async function switchToDownstreamDive(
  viewId: 'novel.workbench' | 'gameSystem.workbench',
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

function pushAndOpenDownstreamNovel(): void {
  flushDocToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  const doc = graphEditorHosts.getDocument(hostId)
  let novelNode: GraphNode | null = null
  if (doc?.edges) {
    for (const edge of doc.edges) {
      if (edge.source === props.node.id) {
        const tgt = graphEditorHosts.getNode(hostId, edge.target)
        if (tgt?.typeId === 'asset.novel') {
          novelNode = tgt
          break
        }
      }
    }
  }
  if (!novelNode) {
    novelNode = graphEditorHosts.findNode(hostId, (n) => n.typeId === 'asset.novel')
  }
  if (!novelNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'asset.novel',
      title: isEn.value ? 'Novel Studio' : '创建小说', // cjk-ok
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: (props.node.position?.y ?? 200) - 60
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text' }]
    })
    if (newId) {
      novelNode = graphEditorHosts.getNode(hostId, newId)
    }
  } else {
    const edges = graphEditorHosts.getDocument(hostId)?.edges ?? []
    if (!edges.some((e) => e.source === props.node.id && e.target === novelNode!.id)) {
      graphEditorHosts.connectNodes(hostId, props.node.id, novelNode.id, 'out-text', 'in')
    }
  }
  if (!novelNode) return
  switchToDownstreamDive(
    'novel.workbench',
    novelNode.id,
    novelNode.title?.trim() || (isEn.value ? 'Novel Studio' : '创建小说') // cjk-ok
  )
}

function pushAndOpenDownstreamGameSystem(): void {
  flushDocToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  const doc = graphEditorHosts.getDocument(hostId)
  let gsNode: GraphNode | null = null
  if (doc?.edges) {
    for (const edge of doc.edges) {
      if (edge.source === props.node.id) {
        const tgt = graphEditorHosts.getNode(hostId, edge.target)
        if (tgt?.typeId === 'asset.gameSystem') {
          gsNode = tgt
          break
        }
      }
    }
  }
  if (!gsNode) {
    gsNode = graphEditorHosts.findNode(hostId, (n) => n.typeId === 'asset.gameSystem')
  }
  const existingNovel = graphEditorHosts.findNode(hostId, (n) => n.typeId === 'asset.novel')
  if (!gsNode) {
    const linkSources: { nodeId: string; portId?: string }[] = [
      { nodeId: props.node.id, portId: 'out-text' }
    ]
    if (existingNovel) {
      linkSources.push({ nodeId: existingNovel.id, portId: 'out' })
    }
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'asset.gameSystem',
      title: isEn.value ? 'Game System Plan' : '策划案生成', // cjk-ok
      position: {
        x: (props.node.position?.x ?? 260) + (existingNovel ? 760 : 380),
        y: (props.node.position?.y ?? 200) + 120
      },
      linkFrom: linkSources
    })
    if (newId) {
      gsNode = graphEditorHosts.getNode(hostId, newId)
    }
  } else {
    const edges = graphEditorHosts.getDocument(hostId)?.edges ?? []
    if (!edges.some((e) => e.source === props.node.id && e.target === gsNode!.id)) {
      graphEditorHosts.connectNodes(hostId, props.node.id, gsNode.id, 'out-text', 'in')
    }
    if (
      existingNovel &&
      !edges.some((e) => e.source === existingNovel.id && e.target === gsNode!.id)
    ) {
      graphEditorHosts.connectNodes(hostId, existingNovel.id, gsNode.id, 'out', 'in')
    }
  }
  if (!gsNode) return
  switchToDownstreamDive(
    'gameSystem.workbench',
    gsNode.id,
    gsNode.title?.trim() || (isEn.value ? 'Game System Plan' : '策划案生成') // cjk-ok
  )
}
</script>

<template>
  <div class="mx-studio" @click="exportOpen = false">
    <!-- ═════════════ ① 顶部导航栏 ═════════════ -->
    <header class="mx-topbar">
      <div class="mx-topbar-left">
        <div class="mx-brand" title="Machinations Studio">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <polygon points="12,3 21,19 3,19" fill="none" stroke="#dc2626" stroke-width="2.2" />
            <circle cx="12" cy="14" r="3.2" fill="#2563eb" />
          </svg>
        </div>
        <input
          type="text"
          class="mx-title-input"
          :value="store.doc.value.title"
          @input="
            store.mutate((d) => {
              d.title = ($event.target as HTMLInputElement).value
            }, 'title')
          "
        />
      </div>

      <!-- 中央 Build | Scenarios | Numerical Lab 模式切换胶囊 -->
      <div class="mx-topbar-center">
        <div class="mx-mode-pill">
          <button
            type="button"
            class="mx-mode-btn"
            :class="{
              'is-active': store.mode.value === 'build' && store.resultsTab.value !== 'workbench'
            }"
            @click="store.enterBuildMode()"
          >
            {{ t('mx.top.build') }}
          </button>
          <button
            type="button"
            class="mx-mode-btn"
            :class="{
              'is-active':
                store.mode.value === 'scenarios' && store.resultsTab.value !== 'workbench'
            }"
            @click="store.enterScenariosMode()"
          >
            {{ t('mx.top.scenarios') }}
          </button>
          <button
            type="button"
            class="mx-mode-btn"
            :class="{
              'is-active':
                store.mode.value === 'workbench' || store.resultsTab.value === 'workbench'
            }"
            @click="
              () => {
                store.drawer.value = ''
                store.mode.value = 'workbench'
                store.resultsOpen.value = true
                store.resultsTab.value = 'workbench'
              }
            "
          >
            ⚔ Numerical Lab
          </button>
        </div>

        <select
          v-if="store.mode.value === 'scenarios' && store.doc.value.scenarios.length"
          class="mx-scenario-select"
          :value="store.doc.value.activeScenarioId ?? ''"
          @change="store.selectScenario(($event.target as HTMLSelectElement).value || undefined)"
        >
          <option value="">Baseline</option>
          <option v-for="sc in store.doc.value.scenarios" :key="sc.id" :value="sc.id">
            {{ sc.name }}
          </option>
        </select>

        <button
          v-if="store.mode.value === 'scenarios'"
          type="button"
          class="mx-top-btn"
          :title="t('mx.results.compareAllTip')"
          @click="store.runAllScenariosCompare()"
        >
          ⇄ {{ t('mx.results.compare') }}
        </button>
      </div>

      <!-- 右侧导出与执行 -->
      <div class="mx-topbar-right">
        <div class="mx-export-wrap" @click.stop>
          <button type="button" class="mx-top-btn" @click="exportOpen = !exportOpen">
            ⇣ {{ t('mx.top.export') }} ▾
          </button>
          <div v-if="exportOpen" class="mx-export-menu">
            <button type="button" @click="exportFormat('png')">
              🖼 {{ t('mx.top.exportPng') }}
            </button>
            <button type="button" @click="exportFormat('svg')">
              📐 {{ t('mx.top.exportSvg') }}
            </button>
            <hr />
            <button type="button" @click="exportFormat('gd')">Godot 4 (.gd)</button>
            <button type="button" @click="exportFormat('cs')">Unity C# (.cs)</button>
            <button type="button" @click="exportFormat('mmd')">Mermaid (.mmd)</button>
            <button type="button" @click="exportFormat('run_csv')">Play CSV (.csv)</button>
            <button type="button" @click="exportFormat('fc_csv')">Forecast CSV (.csv)</button>
            <button type="button" @click="exportFormat('json')">Machinations JSON (.json)</button>
            <hr />
            <button type="button" @click="triggerImportJson">⇡ {{ t('mx.top.importJson') }}</button>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept=".json"
            style="display: none"
            @change="onImportFile"
          />
        </div>

        <button
          v-if="props.hostId"
          type="button"
          class="mx-top-btn"
          :title="pipelineUi.pushNovelTip"
          @click="pushAndOpenDownstreamNovel"
        >
          📚 {{ pipelineUi.pushNovelBtn }}
        </button>

        <button
          v-if="props.hostId"
          type="button"
          class="mx-top-btn"
          :title="pipelineUi.pushGameSystemTip"
          @click="pushAndOpenDownstreamGameSystem"
        >
          🕹️ {{ pipelineUi.pushGameSystemBtn }}
        </button>

        <button type="button" class="mx-top-btn is-run" @click="runGraphNode">
          ⚡ {{ t('mx.top.bakeToNode') }}
        </button>

        <button type="button" class="mx-top-btn is-done" @click="emit('close')">
          {{ t('mx.top.done') }}
        </button>
      </div>
    </header>

    <!-- ═════════════ 主工作区（左栏 + 抽屉 + 画布/结果 + 右侧检查器） ═════════════ -->
    <div class="mx-main">
      <!-- ② 左侧图标导航栏 -->
      <nav v-show="store.mode.value !== 'workbench'" class="mx-left-rail">
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="mx-rail-btn"
          :class="{ 'is-active': store.drawer.value === item.id }"
          @click="toggleDrawer(item.id)"
        >
          <span class="mx-rail-ico">{{ item.icon }}</span>
          <span class="mx-rail-lbl">{{ t(item.labelKey) }}</span>
        </button>
      </nav>

      <!-- 滑出抽屉 -->
      <MxDrawer v-show="store.mode.value !== 'workbench'" @fit-view="canvasRef?.fitToScreen()" />

      <!-- ③ 中央画布 + ⑤⑥ 底部结果与播放栏 -->
      <div class="mx-center-col">
        <!-- 方案模式专属：多方案参数矩阵与实时切换对比条 -->
        <div
          v-if="store.mode.value === 'scenarios' && store.resultsTab.value !== 'workbench'"
          class="mx-scenarios-bar"
        >
          <div class="mx-sc-bar-left">
            <span class="mx-sc-bar-tag">⇄ {{ t('mx.top.scenarios') }}</span>
            <button
              type="button"
              class="mx-sc-pill"
              :class="{ 'is-active': !store.doc.value.activeScenarioId }"
              @click="store.selectScenario(undefined)"
            >
              Baseline
            </button>
            <button
              v-for="sc in store.doc.value.scenarios"
              :key="sc.id"
              type="button"
              class="mx-sc-pill"
              :class="{ 'is-active': store.doc.value.activeScenarioId === sc.id }"
              @click="store.selectScenario(sc.id)"
            >
              {{ sc.name }}
            </button>
            <button type="button" class="mx-sc-pill is-add" @click="store.addScenario()">
              + Scenario
            </button>
          </div>

          <div class="mx-sc-bar-params">
            <label v-for="p in store.doc.value.params" :key="p.id" class="mx-sc-param-chip">
              <span class="mx-sc-param-name">{{ p.name }}</span>
              <input
                type="number"
                step="0.1"
                class="mx-sc-param-input"
                :value="getScenarioParamVal(p.name, p.value)"
                @input="updateScenarioParamVal(p.name, ($event.target as HTMLInputElement).value)"
              />
              <span
                v-if="formatScenarioDelta(p.name, p.value)"
                class="mx-sc-delta"
                :class="formatScenarioDelta(p.name, p.value).startsWith('+') ? 'is-pos' : 'is-neg'"
              >
                {{ formatScenarioDelta(p.name, p.value) }}
              </span>
            </label>
          </div>

          <button type="button" class="mx-sc-compare-btn" @click="store.runAllScenariosCompare()">
            ⇄ {{ t('mx.results.compare') }} ({{ store.doc.value.scenarios.length + 1 }})
          </button>
        </div>

        <MxCanvas v-show="store.mode.value !== 'workbench'" ref="canvasRef" />
        <MxResultsPanel />
      </div>

      <!-- ④ 右侧属性检查器 -->
      <MxInspector v-show="store.mode.value !== 'workbench'" />
    </div>
  </div>
</template>

<style scoped>
.mx-studio {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
}

.mx-topbar {
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  z-index: 25;
}
.mx-topbar-left,
.mx-topbar-center,
.mx-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mx-brand {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mx-title-input {
  min-width: 240px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  background: transparent;
}
.mx-title-input:hover {
  background: var(--bg-hover);
  border-color: var(--border);
}
.mx-title-input:focus {
  background: var(--bg-input);
  border-color: var(--accent);
  outline: none;
}

.mx-mode-pill {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.mx-mode-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.mx-mode-btn.is-active {
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}
.mx-scenario-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}

.mx-export-wrap {
  position: relative;
}
.mx-export-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 190px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  z-index: 40;
}
.mx-export-menu button {
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.mx-export-menu button:hover {
  background: var(--accent-12);
  color: var(--accent);
}
.mx-export-menu hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 3px 0;
}

.mx-top-btn {
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.mx-top-btn:hover {
  background: var(--bg-hover);
}
.mx-top-btn.is-run {
  background: var(--accent-12);
  border-color: var(--accent);
  color: var(--accent);
}
.mx-top-btn.is-done {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}
.mx-top-btn.is-done:hover {
  background: var(--accent-hover, #1d4ed8);
}

.mx-main {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.mx-left-rail {
  width: 56px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  user-select: none;
}
.mx-rail-btn {
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}
.mx-rail-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.mx-rail-btn.is-active {
  background: var(--accent-12);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.mx-rail-ico {
  font-size: 14px;
  line-height: 1.1;
  font-weight: 700;
}
.mx-rail-lbl {
  font-size: 9px;
  text-align: center;
  line-height: 1.1;
}

.mx-center-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mx-scenarios-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.mx-sc-bar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mx-sc-bar-tag {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  padding-right: 4px;
}

.mx-sc-pill {
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.mx-sc-pill:hover {
  color: var(--text);
  border-color: var(--accent);
}
.mx-sc-pill.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
}
.mx-sc-pill.is-add {
  border-style: dashed;
  color: var(--accent);
}

.mx-sc-bar-params {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}

.mx-sc-param-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  font-size: 11px;
}

.mx-sc-param-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  color: var(--text-muted);
}

.mx-sc-param-input {
  width: 58px;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.mx-sc-delta {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
}
.mx-sc-delta.is-pos {
  background: rgba(16, 185, 129, 0.14);
  color: #10b981;
}
.mx-sc-delta.is-neg {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}

.mx-sc-compare-btn {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-12);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.mx-sc-compare-btn:hover {
  background: var(--accent);
  color: #ffffff;
}
</style>
