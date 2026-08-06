<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.gridSplit.hint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <section class="preview-section" :aria-label="t('graph.gridSplit.cropPreview')">
      <div class="section-head">
        <span class="section-title">{{ t('graph.gridSplit.cropPreview') }}</span>
        <span v-if="cropCells.length" class="section-count">{{ cropCells.length }}</span>
      </div>
      <p class="section-hint">{{ t('graph.gridSplit.cropPreviewHint') }}</p>
      <div v-if="cropLoading" class="empty-shots">{{ t('graph.gridSplit.cropLoading') }}</div>
      <div v-else-if="!cropCells.length" class="empty-shots">
        {{ cropEmptyLabel }}
      </div>
      <div v-else class="shot-grid">
        <button
          v-for="cell in cropCells"
          :key="cell.key"
          type="button"
          class="shot-card"
          :title="cell.key"
          @dblclick="openCropPreview(cell)"
        >
          <img :src="cell.dataUrl" alt="" loading="lazy" decoding="async" />
          <span class="shot-index">{{ cell.key }}</span>
        </button>
      </div>
    </section>

    <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />

    <dl class="meta">
      <div>
        <dt>{{ t('graph.gridSplit.grid') }}</dt>
        <dd>{{ gridLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.gridSplit.selected') }}</dt>
        <dd>{{ selectedLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.gridSplit.scale') }}</dt>
        <dd>{{ scaleLabel }}</dd>
      </div>
    </dl>

    <label>
      {{ t('graph.gridSplit.systemPrompt') }}
      <ExpandableTextarea
        :key="`sys-${node.id}`"
        v-model="systemPrompt"
        :title="t('graph.gridSplit.systemPrompt')"
        :rows="4"
        :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_EN,
  DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_ZH,
  defaultGridSplitSystemPrompt,
  readImageGridSplitFromNode,
  resolveGridSplitSystemPrompt,
  resolveGridSplitTargets
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
import { resolveNodeUpstreamImageUrl } from '../features/graph/model/resolveNodeUpstreamImageUrl'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { useProjectStore } from '../stores/project'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.gridSplit' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('image.gridSplit'))

const grid = computed(() =>
  node.value ? readImageGridSplitFromNode(node.value.params) : null
)

const gridLabel = computed(() => {
  const g = grid.value
  if (!g) return '—'
  return `${g.rows}×${g.cols}`
})

const selectedLabel = computed(() => {
  const g = grid.value
  if (!g) return '—'
  if (!g.selected.length) return t('graph.gridSplit.allCells')
  return g.selected.join(', ')
})

const scaleLabel = computed(() => {
  const g = grid.value
  if (!g) return '—'
  return `${g.scale}×`
})

type CropCell = { key: string; dataUrl: string }
const cropCells = ref<CropCell[]>([])
const cropLoading = ref(false)
const cropEmptyReason = ref<'noSource' | 'failed' | 'idle'>('idle')
let cropToken = 0

const cropEmptyLabel = computed(() => {
  if (cropEmptyReason.value === 'noSource') return t('graph.gridSplit.noSource')
  if (cropEmptyReason.value === 'failed') return t('graph.gridSplit.cropFailed')
  return t('graph.gridSplit.cropEmpty')
})

async function refreshCropPreview(): Promise<void> {
  const current = node.value
  const hid = hostId.value
  const state = grid.value
  if (!current || !hid || !state) {
    cropCells.value = []
    cropLoading.value = false
    cropEmptyReason.value = 'idle'
    return
  }

  const token = ++cropToken
  cropLoading.value = true
  try {
    const document = graphEditorHosts.getDocument(hid)
    const runStates = graphRunHosts.get(hid)?.runStates
    const sourceUrl = await resolveNodeUpstreamImageUrl({
      document,
      nodeId: current.id,
      runStates,
      assets: project.assets
    })
    if (token !== cropToken) return
    if (!sourceUrl) {
      cropCells.value = []
      cropEmptyReason.value = 'noSource'
      return
    }

    const targets = resolveGridSplitTargets(state)
    const next: CropCell[] = []
    for (const cellKey of targets) {
      if (token !== cropToken) return
      try {
        const composed = await composeImageGridCell({
          sourceDataUrl: sourceUrl,
          state,
          cellKey
        })
        if (composed.dataUrl) next.push({ key: cellKey, dataUrl: composed.dataUrl })
      } catch {
        /* skip bad cell */
      }
    }
    if (token !== cropToken) return
    cropCells.value = next
    cropEmptyReason.value = next.length ? 'idle' : 'failed'
  } catch {
    if (token !== cropToken) return
    cropCells.value = []
    cropEmptyReason.value = 'failed'
  } finally {
    if (token === cropToken) cropLoading.value = false
  }
}

watch(
  [
    () => node.value?.id ?? '',
    () => hostId.value,
    () => {
      const g = grid.value
      if (!g) return ''
      return `${g.rows}x${g.cols}:${g.scale}:${g.selected.join(',')}`
    },
    () => graphEditorHosts.revision.value,
    () => project.assets.length,
    () => {
      const hid = hostId.value
      const current = node.value
      if (!hid || !current) return ''
      const doc = graphEditorHosts.getDocument(hid)
      const edges = (doc?.edges ?? [])
        .filter((e) => e.target === current.id)
        .map((e) => `${e.id}:${e.source}`)
        .join('|')
      const runStates = graphRunHosts.get(hid)?.runStates
      const upstreamIds = (doc?.edges ?? [])
        .filter((e) => e.target === current.id)
        .map((e) => e.source)
      const runSig = upstreamIds
        .map((id) => {
          const st = runStates?.[id]
          return `${id}:${st?.status ?? ''}:${st?.outputs?.out ? '1' : '0'}`
        })
        .join('|')
      return `${edges}#${runSig}`
    }
  ],
  () => {
    void refreshCropPreview()
  },
  { immediate: true }
)

function openCropPreview(cell: CropCell): void {
  void openFullImagePreview({ dataUrl: cell.dataUrl })
}

const systemPrompt = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

function loadSystemPrompt(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  systemPrompt.value = resolveGridSplitSystemPrompt(
    current.params.generateSystemPrompt,
    String(locale.value)
  )
}

watch(
  node,
  (current) => {
    if (!current) {
      systemPrompt.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadSystemPrompt(current)
  },
  { immediate: true }
)

watch(locale, (next) => {
  if (!node.value) return
  const cur = systemPrompt.value.trim()
  if (
    !cur ||
    cur === DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_EN ||
    cur === DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_ZH
  ) {
    systemPrompt.value = defaultGridSplitSystemPrompt(String(next))
  }
})

function persistSystemPrompt(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateSystemPrompt: systemPrompt.value
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.section-count {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.empty-shots {
  font-size: 12px;
  color: var(--text-muted);
  padding: 10px 0;
}

.shot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}

.shot-card {
  position: relative;
  margin: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
  cursor: zoom-in;
}

.shot-card img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--graph-preview-bg);
}

.shot-index {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 1.4;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.meta div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.meta dt {
  color: var(--text-muted);
}

.meta dd {
  margin: 0;
  color: var(--text);
  text-align: right;
  word-break: break-all;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
