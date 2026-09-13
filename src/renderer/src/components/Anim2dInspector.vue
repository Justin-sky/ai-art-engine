<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.anim2d.inspectorHint') }}
    </p>

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
      <label class="field field-key">
        <span>{{ t('graph.anim2d.bgKey') }}</span>
        <select :value="keyColor" class="key-select" @change="onKeyColorChange">
          <option value="">
            {{ t('graph.anim2d.bgKeyNone') }}
          </option>
          <option value="black">
            {{ t('graph.anim2d.bgKeyBlack') }}
          </option>
          <option value="white">
            {{ t('graph.anim2d.bgKeyWhite') }}
          </option>
        </select>
      </label>
    </div>
    <p v-if="keyColor" class="hint">
      {{ t('graph.anim2d.bgKeyHint') }}
    </p>

    <label class="field field-key">
      <span>{{ t('graph.anim2d.runGifFps') }}</span>
      <select :value="gifFps" class="key-select" @change="onGifFpsChange">
        <option :value="0">
          {{ t('graph.anim2d.runGifOff') }}
        </option>
        <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ f }}</option>
      </select>
    </label>
    <p v-if="gifFps > 0" class="hint">
      {{ t('graph.anim2d.runGifHint') }}
    </p>
    <p v-if="gifOutput" class="hint">
      {{ gifOutput }}
    </p>

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
        <button
          type="button"
          class="anim-play"
          :disabled="gifBusy"
          :title="t('graph.anim2d.exportGifHint')"
          @click="exportGif"
        >
          {{ gifBusy ? t('graph.anim2d.exportGifBusy') : t('graph.anim2d.exportGif') }}
        </button>
      </div>
      <p v-if="gifError" class="hint err">
        {{ gifError }}
      </p>
      <p v-else class="hint">
        {{ gifStatus || t('graph.anim2d.exportGifNote', { fps }) }}
      </p>
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
    <p v-else-if="gridLoading" class="hint">
      {{ t('graph.anim2d.loading') }}
    </p>
    <p v-else class="hint">
      {{ t('graph.anim2d.emptyPreview') }}
    </p>

    <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>

  <SaveAssetDialog
    ref="gifSaveRef"
    :open="gifSaveOpen"
    :default-name="gifSaveDefaultName"
    :title="t('graph.anim2d.exportGifTitle')"
    :subtitle="t('graph.anim2d.exportGifSubtitle')"
    :z-index="2600"
    @confirm="onGifSaveConfirm"
    @cancel="closeGifSave"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ANIM2D_MAX_DIM,
  anim2dCellKeys,
  animGifFpsToNodePatch,
  readAnim2dFromNode,
  readAnimGifFpsFromNode,
  readAnimKeyColorFromNode
} from '@shared/graph'
import { resolveCacheOutputRoot } from '@shared/domain'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { useProjectStore } from '../stores/project'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
import { composeAnim2dGif, type Anim2dGifResult } from '../features/graph/model/composeAnim2dGif'

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
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('anim.2d'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value ? readAnim2dFromNode(node.value.params) : { rows: 1, cols: 4 }
)
const keyColor = computed(() => (node.value ? readAnimKeyColorFromNode(node.value.params) : ''))

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

function onKeyColorChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as '' | 'black' | 'white'
  patchParams({ animKeyColor: value === 'black' || value === 'white' ? value : '' })
}

/** 运行后输出 GIF 的帧率（0 = 关闭）：节点参数单一数据源 */
const gifFps = computed(() => (node.value ? readAnimGifFpsFromNode(node.value.params) : 0))

function onGifFpsChange(e: Event): void {
  patchParams(animGifFpsToNodePatch(Number((e.target as HTMLSelectElement).value)))
}

/** 上次运行产出的 GIF（落盘路径 + 规格）；未产出时为空串 */
const gifOutput = computed(() => {
  const current = node.value
  const relativePath = current?.params.animGifRelativePath?.trim()
  if (!current || !relativePath) return ''
  return t('graph.anim2d.runGifDone', {
    path: relativePath,
    frames: current.params.animGifFrameCount ?? 0,
    fps: current.params.animGifFps ?? 0
  })
})

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
  frameTimer = setInterval(
    () => {
      const count = cells.value.length
      if (!count) return
      if (activeIndex.value + 1 >= count) {
        if (loop.value) activeIndex.value = 0
        else stopPlayback()
      } else {
        activeIndex.value += 1
      }
    },
    Math.max(1, Math.round(1000 / fps.value))
  )
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

const gifBusy = ref(false)
const gifStatus = ref('')
const gifError = ref('')

/** 资源库保存对话框：目标文件夹（资产库目录）与文件名由用户在此选择 */
const project = useProjectStore()
const gifSaveOpen = ref(false)
const gifSaveDefaultName = ref('')
const gifSaveRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const gifSaving = ref(false)

/**
 * 用当前预览的同一份 cells 按面板帧率合成 GIF；帧序、透明键控结果与预览一致。
 * 合成不出帧时抛 `ANIM2D_GIF_NO_FRAMES`，由调用方转成可读提示。
 */
async function composeGifFromCells(): Promise<Anim2dGifResult> {
  const gif = await composeAnim2dGif({
    frameUrls: cells.value.map((cell) => cell.dataUrl),
    fps: fps.value,
    loop: loop.value
  })
  if (!gif) throw new Error('ANIM2D_GIF_NO_FRAMES')
  return gif
}

/**
 * 点「导出 GIF」：先弹资源库保存对话框（选目录 + 命名），确认后才合成落盘。
 * 帧序、透明键控结果取自预览用的同一份 cells，保证「所见即所得」。
 */
function exportGif(): void {
  if (!node.value || gifBusy.value || cells.value.length < 2) return
  gifError.value = ''
  gifSaveDefaultName.value = `anim2d-gif-${state.value.rows}x${state.value.cols}`
  gifSaveOpen.value = true
}

function closeGifSave(): void {
  if (gifSaving.value) return
  gifSaveOpen.value = false
}

/**
 * 保存对话框确认：合成 GIF → 落到缓存目录暂存（不进资产库）→ 交由
 * `saveProjectAsset` 复制进所选资源库文件夹并登记为图片资产 → 刷新素材库。
 * 合成或落盘失败时把错误留在对话框里，用户可改目录 / 名称重试。
 */
async function onGifSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  if (!node.value || gifSaving.value) return
  gifSaving.value = true
  gifBusy.value = true
  gifStatus.value = ''
  gifError.value = ''
  gifSaveRef.value?.setSaving(true)
  try {
    const gif = await composeGifFromCells()
    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const stagedPath = await window.studio.saveGraphRunMedia({
      dataUrl: gif.dataUrl,
      key: `anim2d-gif-${Date.now()}`,
      outputDir: `${cacheRoot}/Gifs`
    })
    const asset = await window.studio.saveProjectAsset({
      relativePath: stagedPath,
      name: payload.name,
      folderId: payload.folderId
    })
    await project.scheduleRefreshLibrary()
    gifSaveOpen.value = false
    gifStatus.value = t('graph.anim2d.exportGifDone', {
      path: asset.relativePath || asset.name
    })
  } catch (err) {
    gifSaveRef.value?.setError(err instanceof Error ? err.message : String(err))
  } finally {
    gifSaving.value = false
    gifBusy.value = false
    gifSaveRef.value?.setSaving(false)
  }
}

async function resolveGridImageUrl(): Promise<string> {
  const grid = node.value?.params?.animGridImage as
    { dataUrl?: string; relativePath?: string } | undefined
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
    const keyColorValue = readAnimKeyColorFromNode(current.params)
    for (const cell of anim2dCellKeys(s.rows, s.cols)) {
      if (token !== cellToken) return
      try {
        const composed = await composeImageGridCell({
          sourceDataUrl: sourceUrl,
          state: { rows: s.rows, cols: s.cols, selected: [] },
          cellKey: cell,
          edgeInset: 'auto',
          ...(keyColorValue ? { chromaKey: { color: keyColorValue } } : {})
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
    () => readAnimKeyColorFromNode(node.value?.params),
    () => {
      const grid = node.value?.params?.animGridImage as
        { dataUrl?: string; relativePath?: string } | undefined
      return grid?.dataUrl?.slice(0, 48) ?? grid?.relativePath ?? ''
    }
  ],
  () => {
    activeIndex.value = 0
    // 换节点即放弃未确认的导出：对话框里的目录 / 名称是给上一个节点选的
    if (!gifSaving.value) gifSaveOpen.value = false
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

.anim-play:hover:not(:disabled) {
  background: var(--bg-hover);
}

.anim-play:disabled {
  opacity: 0.6;
  cursor: default;
}

.hint.err {
  color: var(--danger);
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
  flex-wrap: wrap;
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input,
.field-key select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}

.field input {
  width: 76px;
}

.field-key select {
  min-width: 150px;
}
</style>
