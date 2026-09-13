<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.svgAnim.inspectorHint') }}
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
        <span>{{ t('graph.svgAnim.frames') }}</span>
        <input
          type="number"
          :min="String(SVG_ANIM_FRAMES_MIN)"
          :max="String(SVG_ANIM_FRAMES_MAX)"
          step="1"
          :value="state.frames"
          @change="onFramesChange"
        >
      </label>
      <label class="field">
        <span>{{ t('graph.svgAnim.duration') }}</span>
        <input
          type="number"
          min="0"
          :max="String(SVG_ANIM_DURATION_MAX)"
          step="0.1"
          :value="state.durationSec"
          @change="onDurationChange"
        >
      </label>
      <label class="field">
        <span>{{ t('graph.svgAnim.width') }}</span>
        <input
          type="number"
          min="0"
          :max="String(SVG_ANIM_SIZE_MAX)"
          step="1"
          :value="state.width"
          @change="onWidthChange"
        >
      </label>
      <label class="field">
        <span>{{ t('graph.svgAnim.height') }}</span>
        <input
          type="number"
          min="0"
          :max="String(SVG_ANIM_SIZE_MAX)"
          step="1"
          :value="state.height"
          @change="onHeightChange"
        >
      </label>
      <label class="field field-key">
        <span>{{ t('graph.svgAnim.background') }}</span>
        <select
          :value="state.background"
          class="bg-select"
          @change="onBackgroundChange"
        >
          <option value="">
            {{ t('graph.svgAnim.bgNone') }}
          </option>
          <option value="white">
            {{ t('graph.svgAnim.bgWhite') }}
          </option>
          <option value="black">
            {{ t('graph.svgAnim.bgBlack') }}
          </option>
        </select>
      </label>
    </div>
    <p class="hint">
      {{ t('graph.svgAnim.zeroHint') }}
    </p>
    <p
      v-if="runSummary"
      class="hint"
    >
      {{ runSummary }}
    </p>
    <p
      v-if="gifOutput"
      class="hint"
    >
      {{ gifOutput }}
    </p>

    <section
      v-if="frames.length > 1"
      class="anim-section"
      :aria-label="t('graph.svgAnim.preview')"
    >
      <div class="anim-preview">
        <img
          :src="frames[activeIndex]?.dataUrl"
          alt=""
        >
        <span class="anim-frame-badge">{{ activeIndex + 1 }}/{{ frames.length }}</span>
      </div>
      <div class="anim-bar">
        <button
          type="button"
          class="anim-play"
          @click="togglePlay"
        >
          {{ playing ? t('graph.svgAnim.pause') : t('graph.svgAnim.play') }}
        </button>
        <label class="anim-loop">
          <input
            type="checkbox"
            :checked="loop"
            @change="onLoopChange"
          >
          <span>{{ t('graph.svgAnim.loop') }}</span>
        </label>
        <button
          type="button"
          class="anim-play"
          :disabled="gifBusy || exportFps <= 0"
          :title="t('graph.svgAnim.exportGifHint')"
          @click="exportGif"
        >
          {{ gifBusy ? t('graph.svgAnim.exportGifBusy') : t('graph.svgAnim.exportGif') }}
        </button>
      </div>
      <p
        v-if="gifError"
        class="hint err"
      >
        {{ gifError }}
      </p>
      <p
        v-else
        class="hint"
      >
        {{ gifStatus || t('graph.svgAnim.exportGifNote', { fps: previewFpsText }) }}
      </p>
      <div class="frame-grid">
        <button
          v-for="(frame, index) in frames"
          :key="frame.key"
          type="button"
          class="frame-card"
          :class="{ active: playing && index === activeIndex }"
          :title="frame.key"
          @click="seekTo(index)"
        >
          <img
            :src="frame.dataUrl"
            alt=""
            loading="lazy"
            decoding="async"
          >
          <span class="frame-index">{{ index + 1 }}</span>
        </button>
      </div>
    </section>
    <p
      v-else-if="framesLoading"
      class="hint"
    >
      {{ t('graph.svgAnim.loading') }}
    </p>
    <p
      v-else
      class="hint"
    >
      {{ t('graph.svgAnim.emptyPreview') }}
    </p>

    <GraphNodeOutputPreview
      v-if="hostId"
      :node="node"
      :host-id="hostId"
    />
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>

  <SaveAssetDialog
    ref="gifSaveRef"
    :open="gifSaveOpen"
    :default-name="gifSaveDefaultName"
    :title="t('graph.svgAnim.exportGifTitle')"
    :subtitle="t('graph.svgAnim.exportGifSubtitle')"
    :z-index="2600"
    @confirm="onGifSaveConfirm"
    @cancel="closeGifSave"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  DEFAULT_SVG_ANIM_STATE,
  readSvgAnimFromNode,
  svgAnimToNodePatch,
  SVG_ANIM_DURATION_MAX,
  SVG_ANIM_FRAMES_MAX,
  SVG_ANIM_FRAMES_MIN,
  SVG_ANIM_SIZE_MAX,
  type SvgAnimState
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
import { composeAnim2dGif, type Anim2dGifResult } from '../features/graph/model/composeAnim2dGif'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'svg.anim' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('svg.anim'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed<SvgAnimState>(() =>
  node.value ? readSvgAnimFromNode(node.value.params) : DEFAULT_SVG_ANIM_STATE
)

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function patchState(next: Partial<SvgAnimState>): void {
  patchParams(svgAnimToNodePatch({ ...state.value, ...next }))
}

function onFramesChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchState({ frames: n })
}

function onDurationChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchState({ durationSec: n })
}

function onWidthChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchState({ width: n })
}

function onHeightChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchState({ height: n })
}

function onBackgroundChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  patchState({ background: value === 'white' || value === 'black' ? value : '' })
}

/** 上次运行的实际取样周期与帧数：参数改了要重跑才生效 */
const runSummary = computed(() => {
  const params = node.value?.params
  const seconds = params?.svgDetectedPeriodSec ?? 0
  if (!seconds) return ''
  return t('graph.svgAnim.runSummary', {
    frames: params?.svgFrames ?? 0,
    seconds: Number(seconds.toFixed(2))
  })
})

/** 上次运行落盘的 GIF 路径（未产出时为空串） */
const gifOutput = computed(() => {
  const params = node.value?.params
  const relativePath = params?.svgGifRelativePath?.trim()
  if (!relativePath) return ''
  return t('graph.svgAnim.runGifDone', {
    path: relativePath,
    frames: params?.svgGifFrameCount ?? 0,
    fps: Math.round((params?.svgGifFps ?? 0) * 100) / 100
  })
})

type SvgFrame = { key: string; dataUrl: string }
const frames = ref<SvgFrame[]>([])
const framesLoading = ref(false)
let frameToken = 0

const playing = ref(false)
const loop = ref(true)
const activeIndex = ref(0)

/**
 * GIF 时序由 SVG 自身动效决定：帧数 ÷ 取样周期。
 * 手册里改帧数/时长只影响下次运行，导出始终按上次运行的实际时序，避免「预览速度 ≠ 导出速度」。
 */
const exportFps = computed(() => {
  const params = node.value?.params
  const gifFps = params?.svgGifFps ?? 0
  if (gifFps > 0) return gifFps
  const seconds = params?.svgDetectedPeriodSec ?? 0
  const count = params?.svgFrames ?? 0
  if (seconds > 0 && count > 0) return count / seconds
  return 0
})

const previewFps = computed(() => {
  const fps = exportFps.value
  return fps > 0 ? fps : 8
})

const previewFpsText = computed(() => String(Math.round(previewFps.value * 100) / 100))

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
  if (!frames.value.length) return
  playing.value = true
  clearFrameTimer()
  frameTimer = setInterval(() => {
    const count = frames.value.length
    if (!count) return
    if (activeIndex.value + 1 >= count) {
      if (loop.value) activeIndex.value = 0
      else stopPlayback()
    } else {
      activeIndex.value += 1
    }
  }, Math.max(1, Math.round(1000 / previewFps.value)))
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

/** 用当前预览的同一份帧按导出帧率合成 GIF；帧序与预览完全一致 */
async function composeGifFromFrames(): Promise<Anim2dGifResult> {
  const gif = await composeAnim2dGif({
    frameUrls: frames.value.map((frame) => frame.dataUrl),
    fps: exportFps.value,
    loop: loop.value
  })
  if (!gif) throw new Error('SVG_ANIM_GIF_NO_FRAMES')
  return gif
}

/**
 * 点「导出 GIF」：先选资源库目录与文件名，确认后才合成落盘
 * （帧取自预览用的同一份产物，保证所见即所得）。
 */
function exportGif(): void {
  if (!node.value || gifBusy.value || frames.value.length < 2 || exportFps.value <= 0) return
  gifError.value = ''
  gifSaveDefaultName.value = 'svg-anim-gif'
  gifSaveOpen.value = true
}

function closeGifSave(): void {
  if (gifSaving.value) return
  gifSaveOpen.value = false
}

async function onGifSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  if (!node.value || gifSaving.value) return
  gifSaving.value = true
  gifBusy.value = true
  gifStatus.value = ''
  gifError.value = ''
  gifSaveRef.value?.setSaving(true)
  try {
    const gif = await composeGifFromFrames()
    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const stagedPath = await window.studio.saveGraphRunMedia({
      dataUrl: gif.dataUrl,
      key: `svg-anim-gif-${Date.now()}`,
      outputDir: `${cacheRoot}/Gifs`
    })
    const asset = await window.studio.saveProjectAsset({
      relativePath: stagedPath,
      name: payload.name,
      folderId: payload.folderId
    })
    await project.scheduleRefreshLibrary()
    gifSaveOpen.value = false
    gifStatus.value = t('graph.svgAnim.exportGifDone', {
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

/** 预览帧来自上次运行的产物（PNG 已落盘，按相对路径取回） */
async function refreshFrames(): Promise<void> {
  const current = node.value
  if (!current) {
    frames.value = []
    framesLoading.value = false
    return
  }
  const token = ++frameToken
  framesLoading.value = true
  try {
    const items = current.params.generatedImages ?? []
    const next: SvgFrame[] = []
    for (const [index, item] of items.entries()) {
      if (token !== frameToken) return
      let url = item.dataUrl?.trim() ?? ''
      const relativePath = item.relativePath?.trim()
      if (!url && relativePath) {
        try {
          url = (await window.studio.getAssetMediaDataUrl(relativePath)) ?? ''
        } catch {
          url = ''
        }
      }
      if (url) next.push({ key: item.id || `frame-${index}`, dataUrl: url })
    }
    if (token !== frameToken) return
    frames.value = next
  } catch {
    if (token === frameToken) frames.value = []
  } finally {
    if (token === frameToken) framesLoading.value = false
  }
}

watch(
  [
    () => node.value?.id ?? '',
    () => hostId.value,
    () => (node.value?.params.generatedImages ?? []).map((item) => item.relativePath ?? '').join('|')
  ],
  () => {
    activeIndex.value = 0
    // 换节点即放弃未确认的导出：对话框里的目录 / 名称是给上一个节点选的
    if (!gifSaving.value) gifSaveOpen.value = false
    void refreshFrames()
  },
  { immediate: true }
)

watch(frames, (next) => {
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

.hint.err {
  color: var(--danger);
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

.anim-loop {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
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

.bg-select {
  min-width: 120px;
}
</style>
