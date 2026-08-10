<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.anim2d.inspectorHint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <div class="config-row">
      <label class="field">
        <span>{{ t('graph.anim2d.rows') }}</span>
        <input
          type="number"
          min="1"
          :max="String(ANIM2D_MAX_DIM)"
          step="1"
          :value="state.rows"
          @change="onRowsChange"
        />
      </label>
      <label class="field">
        <span>{{ t('graph.anim2d.cols') }}</span>
        <input
          type="number"
          min="1"
          :max="String(ANIM2D_MAX_DIM)"
          step="1"
          :value="state.cols"
          @change="onColsChange"
        />
      </label>
    </div>

    <section v-if="cells.length > 1" class="anim-section" :aria-label="t('graph.anim2d.preview')">
      <div class="anim-preview">
        <img :src="cells[activeIndex]?.dataUrl" alt="" />
        <span class="anim-frame-badge">{{ activeIndex + 1 }}/{{ cells.length }}</span>
      </div>
      <div class="anim-bar">
        <button type="button" class="anim-play" @click="togglePlay">
          {{ playing ? t('graph.anim2d.pause') : t('graph.anim2d.play') }}
        </button>
        <label class="anim-field">
          <span>{{ t('graph.anim2d.fps') }}</span>
          <select :value="fps" class="anim-fps" :disabled="playing" @change="onFpsChange">
            <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>
        <label class="anim-loop">
          <input type="checkbox" :checked="loop" :disabled="playing" @change="onLoopChange" />
          <span>{{ t('graph.anim2d.loop') }}</span>
        </label>
      </div>
      <div class="frame-grid">
        <button
          v-for="(cell, index) in cells"
          :key="cell.key"
          type="button"
          class="frame-card"
          :class="{ active: playing && index === activeIndex }"
          :title="cell.key"
          @click="seekTo(index)"
        >
          <img :src="cell.dataUrl" alt="" loading="lazy" decoding="async" />
          <span class="frame-index">{{ index + 1 }}</span>
        </button>
      </div>
    </section>
    <p v-else-if="gridLoading" class="hint">{{ t('graph.anim2d.loading') }}</p>
    <p v-else class="hint">{{ t('graph.anim2d.emptyPreview') }}</p>

    <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ANIM2D_MAX_DIM,
  anim2dCellKeys,
  readAnim2dFromNode
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'anim.2d' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('anim.2d'))

const state = computed(() =>
  node.value ? readAnim2dFromNode(node.value.params) : { rows: 1, cols: 4 }
)

function clampDim(n: number): number {
  return Math.min(ANIM2D_MAX_DIM, Math.max(1, Math.floor(n) || 1))
}

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onRowsChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ animRows: clampDim(n) })
}

function onColsChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ animCols: clampDim(n) })
}

type AnimCell = { key: string; dataUrl: string }
const cells = ref<AnimCell[]>([])
const gridLoading = ref(false)
let cellToken = 0

const FPS_OPTIONS = [2, 4, 6, 8, 12, 24]
const FPS_STORAGE_KEY = 'ai-art-engine.anim2d.fps'
const FPS_DEFAULT = 8

const playing = ref(false)
const loop = ref(true)
const activeIndex = ref(0)
const fps = ref(FPS_DEFAULT)

function readStoredFps(): number {
  try {
    const n = Number(localStorage.getItem(FPS_STORAGE_KEY))
    if (Number.isFinite(n) && FPS_OPTIONS.includes(n)) return n
  } catch {
    /* ignore */
  }
  return FPS_DEFAULT
}
fps.value = readStoredFps()

let frameTimer: ReturnType<typeof setInterval> | null = null

function clearFrameTimer(): void {
  if (frameTimer) {
    clearInterval(frameTimer)
    frameTimer = null
  }
}

function stopPlayback(): void {
  clearFrameTimer()
  playing.value = false
}

function startPlayback(): void {
  if (!cells.value.length) return
  playing.value = true
  clearFrameTimer()
  frameTimer = setInterval(() => {
    const count = cells.value.length
    if (!count) return
    if (activeIndex.value + 1 >= count) {
      if (loop.value) activeIndex.value = 0
      else stopPlayback()
    } else {
      activeIndex.value += 1
    }
  }, Math.max(1, Math.round(1000 / fps.value)))
}

function togglePlay(): void {
  if (playing.value) {
    stopPlayback()
    return
  }
  startPlayback()
}

function seekTo(index: number): void {
  activeIndex.value = index
  if (playing.value) {
    clearFrameTimer()
    startPlayback()
  }
}

function onFpsChange(e: Event): void {
  const n = Number((e.target as HTMLSelectElement).value)
  if (!Number.isFinite(n) || n <= 0) return
  fps.value = n
  try {
    localStorage.setItem(FPS_STORAGE_KEY, String(n))
  } catch {
    /* ignore */
  }
}

function onLoopChange(e: Event): void {
  loop.value = (e.target as HTMLInputElement).checked
}

async function resolveGridImageUrl(): Promise<string> {
  const grid = node.value?.params?.animGridImage as
    | { dataUrl?: string; relativePath?: string }
    | undefined
  if (!grid) return ''
  if (grid.dataUrl?.trim()) return grid.dataUrl.trim()
  if (grid.relativePath?.trim()) {
    try {
      return (await window.studio.getAssetMediaDataUrl(grid.relativePath.trim())) ?? ''
    } catch {
      return ''
    }
  }
  return ''
}

async function refreshCells(): Promise<void> {
  const current = node.value
  const s = state.value
  if (!current) {
    cells.value = []
    gridLoading.value = false
    return
  }
  const token = ++cellToken
  gridLoading.value = true
  try {
    const sourceUrl = await resolveGridImageUrl()
    if (token !== cellToken) return
    if (!sourceUrl) {
      cells.value = []
      return
    }
    const next: AnimCell[] = []
    for (const cell of anim2dCellKeys(s.rows, s.cols)) {
      if (token !== cellToken) return
      try {
        const composed = await composeImageGridCell({
          sourceDataUrl: sourceUrl,
          state: { rows: s.rows, cols: s.cols, selected: [] },
          cellKey: cell
        })
        if (composed.dataUrl) next.push({ key: cell, dataUrl: composed.dataUrl })
      } catch {
        /* skip bad cell */
      }
    }
    if (token !== cellToken) return
    cells.value = next
  } catch {
    if (token === cellToken) cells.value = []
  } finally {
    if (token === cellToken) gridLoading.value = false
  }
}

watch(
  [
    () => node.value?.id ?? '',
    () => hostId.value,
    () => `${state.value.rows}x${state.value.cols}`,
    () => {
      const grid = node.value?.params?.animGridImage as
        | { dataUrl?: string; relativePath?: string }
        | undefined
      return grid?.dataUrl?.slice(0, 48) ?? grid?.relativePath ?? ''
    }
  ],
  () => {
    activeIndex.value = 0
    void refreshCells()
  },
  { immediate: true }
)

watch(cells, (next) => {
  if (activeIndex.value >= next.length) activeIndex.value = 0
})

onBeforeUnmount(stopPlayback)
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

.anim-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.anim-preview {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
}

.anim-preview img {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  background: var(--graph-preview-bg);
}

.anim-frame-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  font-variant-numeric: tabular-nums;
}

.anim-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.anim-play {
  height: 28px;
  min-width: 52px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.anim-play:hover {
  background: var(--bg-hover);
}

.anim-field,
.anim-loop {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-direction: row;
  font-size: 12px;
  color: var(--text-muted);
}

.anim-field span {
  flex: none;
  white-space: nowrap;
}

.anim-loop {
  color: var(--text);
  cursor: pointer;
}

.anim-fps {
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}

.frame-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}

.frame-card {
  position: relative;
  margin: 0;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 6px;
  overflow: hidden;
  background: var(--graph-preview-bg);
  cursor: pointer;
}

.frame-card img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--graph-preview-bg);
}

.frame-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.frame-index {
  position: absolute;
  left: 3px;
  bottom: 3px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  line-height: 1.4;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.config-row {
  display: flex;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input {
  width: 76px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}
</style>
