<script setup lang="ts">
/**
 * 独立「数值系统」（`game.numerical`）全屏 Dive 工作台：
 *  - 专职负责微观战斗调度内核（洗抽牌库 / 法力节奏 / ATB 行动条）、等级与境界成长包络线 vs 怪物膨胀墙、
 *    伤害乘区公式边际收益、抽卡与词条强化期望、以及卡牌/技能/装备超模审计。
 *  - 支持通过 `in-economy` 端口自动感知上游 `game.economy`（经济系统）节点的宏观资源产出，
 *    并支持一键派生或跳转下游「小说大纲」「创建小说」「策划案生成」节点。
 */
import { computed, inject, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GraphNode } from '@shared/graph'
import {
  createMxFromTemplate,
  createMxWorkbenchPreset,
  MX_WORKBENCH_PRESETS,
  normalizeMxDocument,
  type MxDocument,
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

const upstreamEconomyNode = computed<GraphNode | null>(() => {
  const hostId = props.hostId
  if (!hostId) return null
  const doc = graphEditorHosts.getDocument(hostId)
  if (!doc?.edges) return null
  for (const edge of doc.edges) {
    if (edge.target === props.node.id) {
      const src = graphEditorHosts.getNode(hostId, edge.source)
      if (src?.typeId === 'game.economy') return src
    }
  }
  return null
})

function persistNodeParams(patch: Record<string, unknown>): void {
  if (!props.hostId) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, patch)
  graphEditorHosts.bumpRevision()
}

function persistTitle(rawTitle: string): void {
  if (!props.hostId) return
  const clean = rawTitle.trim() || (isEn.value ? 'Numerical System' : '数值系统') // cjk-ok
  graphEditorHosts.updateNode(props.hostId, props.node.id, {}, clean)
  graphEditorHosts.bumpRevision()
}

function resolveInitialWorkbench(): MxNumericalWorkbench {
  const presetRaw = String(
    props.node.params.gameNumericalPreset ??
      props.node.params.gameEconomyPreset ??
      'slay_the_spire_dbg'
  )
  const validPreset: MxWorkbenchPresetId = (
    MX_WORKBENCH_PRESETS.some((p) => p.id === presetRaw) ? presetRaw : 'slay_the_spire_dbg'
  ) as MxWorkbenchPresetId
  const baseWb = createMxWorkbenchPreset(validPreset)

  const rawWbJson = String(props.node.params.gameNumericalWorkbenchJson ?? '').trim()
  if (rawWbJson) {
    try {
      const parsed = JSON.parse(rawWbJson) as Partial<MxNumericalWorkbench>
      if (parsed && typeof parsed === 'object' && parsed.multiplier && parsed.combatKernel) {
        return { ...baseWb, ...parsed }
      }
    } catch {
      // ignore invalid json
    }
  }
  return baseWb
}

function loadInitialDoc(): MxDocument {
  let doc: MxDocument | null = null
  const upEcon = upstreamEconomyNode.value
  const rawEconDiagram = String(
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
    doc = createMxFromTemplate('roguelike_run')
  }
  doc.title = props.node.title?.trim() || (isEn.value ? 'Numerical System' : '数值系统') // cjk-ok
  doc.workbench = resolveInitialWorkbench()
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
            d.workbench = {
              ...createMxWorkbenchPreset(
                (parsed.activePresetId as MxWorkbenchPresetId) || 'slay_the_spire_dbg'
              ),
              ...parsed
            }
          }, 'externalWbSync')
          return
        }
      } catch {
        // ignore
      }
    }
    const presetStr = String(rawPreset ?? '').trim()
    if (
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

onMounted(() => {
  unregisterHistory = diveEditorHistory.register({
    canUndo: () => store.canUndo.value,
    canRedo: () => store.canRedo.value,
    undo: () => store.undo(),
    redo: () => store.redo()
  })
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
  switchToDive(
    'game.workbench',
    up.id,
    up.title?.trim() || (isEn.value ? 'Economy System' : '经济系统') // cjk-ok
  )
}

function pushAndOpenDownstreamOutline(): void {
  flushToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  let outlineNode = graphEditorHosts.findNode(hostId, (n) => n.typeId === 'novel.outline')
  if (!outlineNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'novel.outline',
      title: isEn.value ? 'Novel Outline' : '小说大纲', // cjk-ok
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: (props.node.position?.y ?? 200) - 120
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text' }]
    })
    if (newId) outlineNode = graphEditorHosts.getNode(hostId, newId)
  } else {
    const edges = graphEditorHosts.getDocument(hostId)?.edges ?? []
    if (!edges.some((e) => e.source === props.node.id && e.target === outlineNode!.id)) {
      graphEditorHosts.connectNodes(
        hostId,
        props.node.id,
        outlineNode.id,
        'out-text',
        'in-numerical'
      )
    }
  }
  if (!outlineNode) return
  switchToDive(
    'novel.workbench',
    outlineNode.id,
    outlineNode.title?.trim() || (isEn.value ? 'Novel Outline' : '小说大纲') // cjk-ok
  )
}

function pushAndOpenDownstreamNovel(): void {
  flushToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  let novelNode = graphEditorHosts.findNode(hostId, (n) => n.typeId === 'asset.novel')
  if (!novelNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'asset.novel',
      title: isEn.value ? 'Novel · Ch.1' : '小说 · 第1章', // cjk-ok
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: props.node.position?.y ?? 200
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text' }]
    })
    if (newId) novelNode = graphEditorHosts.getNode(hostId, newId)
  } else {
    const edges = graphEditorHosts.getDocument(hostId)?.edges ?? []
    if (!edges.some((e) => e.source === props.node.id && e.target === novelNode!.id)) {
      graphEditorHosts.connectNodes(hostId, props.node.id, novelNode.id, 'out-text', 'in-numerical')
    }
  }
  if (!novelNode) return
  switchToDive(
    'novel.workbench',
    novelNode.id,
    novelNode.title?.trim() || (isEn.value ? 'Novel Studio' : '创建小说') // cjk-ok
  )
}

function pushAndOpenDownstreamGameSystem(): void {
  flushToNodeParams()
  const hostId = props.hostId
  if (!hostId) return
  let gsNode = graphEditorHosts.findNode(hostId, (n) => n.typeId === 'asset.gameSystem')
  if (!gsNode) {
    const newId = graphEditorHosts.addNode(hostId, {
      typeId: 'asset.gameSystem',
      title: isEn.value ? 'Game System Plan' : '策划案生成', // cjk-ok
      position: {
        x: (props.node.position?.x ?? 260) + 380,
        y: (props.node.position?.y ?? 200) + 120
      },
      linkFrom: [{ nodeId: props.node.id, portId: 'out-text' }]
    })
    if (newId) gsNode = graphEditorHosts.getNode(hostId, newId)
  } else {
    const edges = graphEditorHosts.getDocument(hostId)?.edges ?? []
    if (!edges.some((e) => e.source === props.node.id && e.target === gsNode!.id)) {
      graphEditorHosts.connectNodes(hostId, props.node.id, gsNode.id, 'out-text', 'in-numerical')
    }
  }
  if (!gsNode) return
  switchToDive(
    'gameSystem.workbench',
    gsNode.id,
    gsNode.title?.trim() || (isEn.value ? 'Game System Plan' : '策划案生成') // cjk-ok
  )
}
</script>

<template>
  <div class="num-studio">
    <!-- ═════════════ 顶部导航栏 ═════════════ -->
    <header class="num-topbar">
      <div class="num-topbar-left">
        <div class="num-brand" :title="isEn ? 'Numerical System Studio' : '数值系统工作台'">⚔️</div>
        <input
          type="text"
          class="num-title-input"
          :value="props.node.title || (isEn ? 'Numerical System' : '数值系统')"
          @change="persistTitle(($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="upstreamEconomyNode"
          type="button"
          class="num-econ-badge is-connected"
          :title="
            isEn
              ? 'Connected to upstream Economy System — click to inspect'
              : '已接入上游「经济系统」宏观资源参数（点击跳转查看）'
          "
          @click="openUpstreamEconomyDive"
        >
          ⚖️
          {{
            isEn
              ? `Economy: ${upstreamEconomyNode.title || 'Connected'}`
              : `已连经济系统：${upstreamEconomyNode.title || '经济系统'}`
          }}
        </button>
        <span v-else class="num-econ-badge">
          {{
            isEn ? 'Standalone Numerical Mode' : '独立数值配表模式（可从 in-economy 接入经济系统）'
          }}
        </span>
      </div>

      <div class="num-topbar-right">
        <button
          v-if="props.hostId"
          type="button"
          class="num-top-btn"
          :title="isEn ? 'Connect to Novel Outline' : '自动连接或创建下游「小说大纲」节点'"
          @click="pushAndOpenDownstreamOutline"
        >
          🗺️ {{ isEn ? 'Outline' : '小说大纲' }}
        </button>

        <button
          v-if="props.hostId"
          type="button"
          class="num-top-btn"
          :title="isEn ? 'Connect to Novel Chapter' : '自动连接或创建下游「创建小说」节点'"
          @click="pushAndOpenDownstreamNovel"
        >
          📚 {{ isEn ? 'Novel Studio' : '创建小说' }}
        </button>

        <button
          v-if="props.hostId"
          type="button"
          class="num-top-btn"
          :title="isEn ? 'Connect to Game System Plan' : '自动连接或创建下游「策划案生成」节点'"
          @click="pushAndOpenDownstreamGameSystem"
        >
          🕹️ {{ isEn ? 'GDD Studio' : '策划案生成' }}
        </button>

        <button type="button" class="num-top-btn is-run" @click="runGraphNode">
          ⚡ {{ t('mx.top.bakeToNode') }}
        </button>

        <button type="button" class="num-top-btn is-done" @click="emit('close')">
          {{ t('mx.top.done') }}
        </button>
      </div>
    </header>

    <!-- ═════════════ 全屏数值与战力配表工作台主体 ═════════════ -->
    <div class="num-main">
      <MxNumericalWorkbenchPanel />
    </div>
  </div>
</template>

<style scoped>
.num-studio {
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
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  gap: 12px;
}

.num-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.num-brand {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(168, 85, 247, 0.14);
  border: 1px solid rgba(168, 85, 247, 0.35);
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

.num-econ-badge {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--bg);
  white-space: nowrap;
}

.num-econ-badge.is-connected {
  cursor: pointer;
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(16, 185, 129, 0.1);
}

.num-econ-badge.is-connected:hover {
  background: rgba(16, 185, 129, 0.18);
}

.num-topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
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
  color: #c084fc;
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
</style>
