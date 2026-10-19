<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
      <span class="frame-badge"
        >{{ state.rows }}×{{ state.cols }} · {{ activeCells.length }}/{{
          cells.length || state.rows * state.cols
        }}F</span
      >
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

    <!-- 0. 上游视频直抽转帧动画（当 in-video 接入视频时显示） -->
    <section v-if="upstreamVideoUrl" class="panel-card video-extract-card">
      <div class="section-header">
        <span class="section-title">{{ t('graph.anim2d.genModeVideoSheet') }}</span>
      </div>
      <video
        :src="upstreamVideoUrl"
        class="upstream-video-preview"
        controls
        muted
        playsinline
        preload="metadata"
      />
      <div class="grid2">
        <label class="field">
          <span
            >{{ t('graph.anim2d.videoStartRatio') }} ({{
              Math.round(videoRange.startRatio * 100)
            }}%)</span
          >
          <input
            type="range"
            min="0"
            max="0.9"
            step="0.05"
            :value="videoRange.startRatio"
            @change="onVideoRangeChange('start', $event)"
          />
        </label>
        <label class="field">
          <span
            >{{ t('graph.anim2d.videoEndRatio') }} ({{
              Math.round(videoRange.endRatio * 100)
            }}%)</span
          >
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            :value="videoRange.endRatio"
            @change="onVideoRangeChange('end', $event)"
          />
        </label>
      </div>
      <button
        type="button"
        class="anim-play primary"
        :disabled="videoExtractBusy"
        @click="extractVideoToAnim2dNow"
      >
        {{
          videoExtractBusy ? t('graph.anim2d.videoExtractBusy') : t('graph.anim2d.videoExtractNow')
        }}
      </button>
    </section>

    <!-- 1. 切格规格与防抖稳像参数 -->
    <section class="panel-card">
      <div class="chip-grid">
        <button
          v-for="preset in ANIM2D_GRID_PRESETS"
          :key="preset.id"
          type="button"
          class="chip"
          :class="{ active: state.rows === preset.rows && state.cols === preset.cols }"
          @click="applyGridPreset(preset.rows, preset.cols)"
        >
          {{ preset.rows }}×{{ preset.cols }}
        </button>
      </div>

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
        <label class="field field-grow">
          <span>{{ t('graph.anim2d.edgeInset') }}</span>
          <select :value="String(edgeInset)" @change="onEdgeInsetChange">
            <option value="auto">{{ t('graph.anim2d.edgeInsetAuto') }}</option>
            <option value="0">0 px</option>
            <option value="2">2 px</option>
            <option value="4">4 px</option>
            <option value="8">8 px</option>
            <option value="12">12 px</option>
          </select>
        </label>
      </div>

      <label class="field">
        <span>{{ t('graph.anim2d.stabilize') }}</span>
        <select :value="stabilize" @change="onStabilizeChange">
          <option value="off">{{ t('graph.anim2d.stabilizeOff') }}</option>
          <option value="ground">{{ t('graph.anim2d.stabilizeGround') }}</option>
          <option value="center">{{ t('graph.anim2d.stabilizeCenter') }}</option>
        </select>
      </label>

      <label class="field">
        <span>{{ t('graph.anim2d.bgKey') }}</span>
        <select :value="keyColor" @change="onKeyColorChange">
          <option value="">
            {{ t('graph.anim2d.bgKeyNone') }}
          </option>
          <option value="auto">
            {{ t('graph.anim2d.bgKeyAuto') }}
          </option>
          <option value="black">
            {{ t('graph.anim2d.bgKeyBlack') }}
          </option>
          <option value="white">
            {{ t('graph.anim2d.bgKeyWhite') }}
          </option>
        </select>
      </label>

      <label v-if="keyColor" class="slider-field">
        <div class="slider-head">
          <span>{{ t('graph.anim2d.keyThreshold') }}</span>
          <b>{{ keyThreshold }}</b>
        </div>
        <input
          type="range"
          min="5"
          max="160"
          step="1"
          :value="keyThreshold"
          @change="onKeyThresholdChange"
        />
      </label>
    </section>

    <!-- 2. 运行自动合成配置 -->
    <section class="panel-card">
      <div class="grid2">
        <label class="field">
          <span>{{ t('graph.anim2d.runGifFps') }}</span>
          <select :value="gifFps" @change="onGifFpsChange">
            <option :value="0">
              {{ t('graph.anim2d.runGifOff') }}
            </option>
            <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ f }} fps</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t('graph.anim2d.playMode') }}</span>
          <select :value="playMode" @change="onPlayModeChange">
            <option value="loop">{{ t('graph.anim2d.playModeLoop') }}</option>
            <option value="pingpong">{{ t('graph.anim2d.playModePingpong') }}</option>
          </select>
        </label>
      </div>
      <p v-if="gifFps > 0" class="hint">
        {{ t('graph.anim2d.runGifHint') }}
      </p>
      <p v-if="gifOutput" class="hint ok-text">
        {{ gifOutput }}
      </p>
    </section>

    <!-- 3. 逐帧播放与交互工作台 -->
    <section v-if="cells.length > 1" class="anim-section" :aria-label="t('graph.anim2d.preview')">
      <div class="preview-toolbar">
        <div class="backdrop-group">
          <button
            type="button"
            class="mini-btn"
            :class="{ active: backdrop === 'checker' }"
            @click="backdrop = 'checker'"
          >
            {{ t('graph.anim2d.backdropChecker') }}
          </button>
          <button
            type="button"
            class="mini-btn"
            :class="{ active: backdrop === 'dark' }"
            @click="backdrop = 'dark'"
          >
            {{ t('graph.anim2d.backdropDark') }}
          </button>
          <button
            type="button"
            class="mini-btn"
            :class="{ active: backdrop === 'light' }"
            @click="backdrop = 'light'"
          >
            {{ t('graph.anim2d.backdropLight') }}
          </button>
        </div>
        <label class="onion-toggle">
          <input v-model="onionSkin" type="checkbox" />
          <span>{{ t('graph.anim2d.onionSkin') }}</span>
        </label>
      </div>

      <div class="anim-preview" :class="`bg-${backdrop}`">
        <img
          v-if="onionSkin && prevActiveCell && prevActiveCell.key !== currentActiveCell?.key"
          :src="prevActiveCell.dataUrl"
          alt=""
          class="onion-ghost"
        />
        <img v-if="currentActiveCell" :src="currentActiveCell.dataUrl" alt="" class="main-frame" />
        <div v-if="stabilize === 'ground'" class="guide-line ground" />
        <div v-else-if="stabilize === 'center'" class="guide-line center-h" />
        <div v-if="stabilize !== 'off'" class="guide-line center-v" />
        <span class="anim-frame-badge">
          {{ activeIndex + 1 }}/{{ activeCells.length }} ({{ currentActiveCell?.key }})
        </span>
      </div>

      <div class="anim-bar">
        <button
          type="button"
          class="icon-step"
          :title="t('graph.anim2d.stepPrev')"
          @click="stepFrame(-1)"
        >
          ◀
        </button>
        <button type="button" class="anim-play primary" @click="togglePlay">
          {{ playing ? t('graph.anim2d.pause') : t('graph.anim2d.play') }}
        </button>
        <button
          type="button"
          class="icon-step"
          :title="t('graph.anim2d.stepNext')"
          @click="stepFrame(1)"
        >
          ▶
        </button>
        <label class="anim-field">
          <span>{{ t('graph.anim2d.fps') }}</span>
          <select :value="fps" class="anim-fps" @change="onFpsChange">
            <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>
        <label class="anim-loop">
          <input type="checkbox" :checked="loop" @change="onLoopChange" />
          <span>{{ t('graph.anim2d.loop') }}</span>
        </label>
      </div>

      <div class="export-row">
        <button
          type="button"
          class="anim-play"
          :disabled="gifBusy || activeCells.length < 2"
          :title="t('graph.anim2d.exportGifHint')"
          @click="exportGif"
        >
          {{ gifBusy ? t('graph.anim2d.exportGifBusy') : t('graph.anim2d.exportGif') }}
        </button>
        <button
          type="button"
          class="anim-play"
          :disabled="sheetBusy || activeCells.length < 1"
          :title="t('graph.anim2d.exportSheetSubtitle')"
          @click="exportSheet"
        >
          {{ sheetBusy ? t('graph.anim2d.exportSheetBusy') : t('graph.anim2d.exportSheet') }}
        </button>
      </div>

      <p v-if="gifError" class="hint err">
        {{ gifError }}
      </p>
      <p v-else class="hint">
        {{ gifStatus || t('graph.anim2d.exportGifNote', { fps }) }}
      </p>

      <p v-if="disabledCells.length > 0" class="hint warn-text">
        {{
          t('graph.anim2d.disabledFramesNote', {
            n: disabledCells.length,
            active: activeCells.length
          })
        }}
      </p>

      <div class="frame-grid">
        <div
          v-for="(cell, index) in cells"
          :key="cell.key"
          class="frame-card"
          :class="{
            active: currentActiveCell?.key === cell.key,
            disabled: isCellDisabled(cell.key)
          }"
          :title="cell.key"
          @click="seekToCellKey(cell.key)"
        >
          <img :src="cell.dataUrl" alt="" loading="lazy" decoding="async" />
          <span class="frame-index">#{{ index + 1 }}</span>
          <button
            type="button"
            class="frame-enable-btn"
            :title="t('graph.anim2d.toggleFrameHint')"
            @click.stop="toggleCellDisabled(cell.key)"
          >
            {{ isCellDisabled(cell.key) ? '✕' : '✓' }}
          </button>
        </div>
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
    :title="
      saveMode === 'sheet' ? t('graph.anim2d.exportSheetTitle') : t('graph.anim2d.exportGifTitle')
    "
    :subtitle="
      saveMode === 'sheet'
        ? t('graph.anim2d.exportSheetSubtitle')
        : t('graph.anim2d.exportGifSubtitle')
    "
    :z-index="2600"
    @confirm="onGifSaveConfirm"
    @cancel="closeGifSave"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ANIM2D_GRID_PRESETS,
  ANIM2D_MAX_DIM,
  anim2dCellKeys,
  animGifFpsToNodePatch,
  normalizeAnimVideoRange,
  readAnim2dFromNode,
  readAnimDisabledCellsFromNode,
  readAnimEdgeInsetFromNode,
  readAnimGifFpsFromNode,
  readAnimKeyColorFromNode,
  readAnimKeyThresholdFromNode,
  readAnimPlayModeFromNode,
  readAnimStabilizeFromNode,
  readAnimVideoRangeFromNode,
  type AnimKeyColor,
  type AnimPlayMode,
  type AnimStabilizeMode
} from '@shared/graph'
import { buildSpriteManifest } from '@shared/gameAssets'
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
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamImageUrl } from '../features/graph/model/resolveNodeUpstreamImageUrl'
import { resolveNodeUpstreamVideoUrl } from '../features/graph/model/resolveNodeUpstreamVideoUrl'
import { composeVideoFrameSheet } from '../features/graph/model/composeVideoFrameSheet'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
import { composeAnim2dGif, type Anim2dGifResult } from '../features/graph/model/composeAnim2dGif'
import {
  composeStage2dFrameSheet,
  type Stage2dFrameSheet
} from '../features/graph/model/composeStage2dFrameSheet'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

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
const videoRange = computed(() =>
  node.value ? readAnimVideoRangeFromNode(node.value.params) : { startRatio: 0, endRatio: 1 }
)
const keyColor = computed(() => (node.value ? readAnimKeyColorFromNode(node.value.params) : ''))
const keyThreshold = computed(() =>
  node.value ? readAnimKeyThresholdFromNode(node.value.params) : 60
)
const edgeInset = computed(() =>
  node.value ? readAnimEdgeInsetFromNode(node.value.params) : 'auto'
)
const stabilize = computed(() =>
  node.value ? readAnimStabilizeFromNode(node.value.params) : 'off'
)
const playMode = computed(() => (node.value ? readAnimPlayModeFromNode(node.value.params) : 'loop'))
const disabledCells = computed(() =>
  node.value ? readAnimDisabledCellsFromNode(node.value.params) : []
)

const backdrop = ref<'checker' | 'dark' | 'light'>('checker')
const onionSkin = ref(false)
const upstreamVideoUrl = ref('')
const upstreamVideoRel = ref('')
const videoExtractBusy = ref(false)

watch(
  () => [hostId.value, node.value?.id, graphEditorHosts.revision.value] as const,
  async ([hId, nId]) => {
    if (!hId || !nId) {
      upstreamVideoUrl.value = ''
      upstreamVideoRel.value = ''
      return
    }
    const document = graphEditorHosts.getDocument(hId)
    const runStates = graphRunHosts.get(hId)?.runStates
    const { url, relativePath } = await resolveNodeUpstreamVideoUrl({
      document,
      nodeId: nId,
      runStates,
      assets: project.assets
    })
    upstreamVideoUrl.value = url
    upstreamVideoRel.value = relativePath
  },
  { immediate: true }
)

function clampDim(n: number): number {
  return Math.min(ANIM2D_MAX_DIM, Math.max(1, Math.floor(n) || 1))
}

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onVideoRangeChange(which: 'start' | 'end', e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  const next = normalizeAnimVideoRange(
    which === 'start' ? v : videoRange.value.startRatio,
    which === 'end' ? v : videoRange.value.endRatio
  )
  patchParams({
    animVideoStartRatio: next.startRatio,
    animVideoEndRatio: next.endRatio
  })
}

async function extractVideoToAnim2dNow(): Promise<void> {
  if (videoExtractBusy.value || !node.value || !hostId.value || !upstreamVideoUrl.value) return
  videoExtractBusy.value = true
  try {
    const sheet = await composeVideoFrameSheet({
      videoUrl: upstreamVideoUrl.value,
      videoRelativePath: upstreamVideoRel.value,
      rows: state.value.rows,
      cols: state.value.cols,
      startRatio: videoRange.value.startRatio,
      endRatio: videoRange.value.endRatio,
      keyColor: keyColor.value,
      keyThreshold: keyThreshold.value,
      stabilize: stabilize.value
    })
    patchParams({
      animGridImage: { dataUrl: sheet.dataUrl }
    })
  } catch (err) {
    gifError.value = err instanceof Error ? err.message : String(err)
  } finally {
    videoExtractBusy.value = false
  }
}

function applyGridPreset(rows: number, cols: number): void {
  patchParams({ animRows: clampDim(rows), animCols: clampDim(cols), animDisabledCells: [] })
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
  const value = (e.target as HTMLSelectElement).value as AnimKeyColor
  patchParams({
    animKeyColor: value === 'black' || value === 'white' || value === 'auto' ? value : ''
  })
}

function onKeyThresholdChange(e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchParams({ animKeyThreshold: Math.max(5, Math.min(180, Math.round(n))) })
}

function onEdgeInsetChange(e: Event): void {
  const raw = (e.target as HTMLSelectElement).value
  patchParams({ animEdgeInset: raw === 'auto' ? 'auto' : Math.max(0, Number(raw) || 0) })
}

function onStabilizeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimStabilizeMode
  patchParams({ animStabilize: value })
}

function onPlayModeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimPlayMode
  patchParams({ animPlayMode: value })
}

function isCellDisabled(key: string): boolean {
  return disabledCells.value.includes(key)
}

function toggleCellDisabled(key: string): void {
  const current = [...disabledCells.value]
  const idx = current.indexOf(key)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    // 至少保留 1 帧有效
    if (cells.value.length - current.length <= 1) return
    current.push(key)
  }
  patchParams({ animDisabledCells: current })
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

const activeCells = computed(() => {
  const set = new Set(disabledCells.value)
  const filtered = cells.value.filter((c) => !set.has(c.key))
  return filtered.length > 0 ? filtered : cells.value
})

const currentActiveCell = computed(
  () => activeCells.value[activeIndex.value] ?? activeCells.value[0] ?? null
)
const prevActiveCell = computed(() => {
  if (activeCells.value.length < 2) return null
  const prevIdx = (activeIndex.value - 1 + activeCells.value.length) % activeCells.value.length
  return activeCells.value[prevIdx] ?? null
})

const FPS_OPTIONS = [2, 4, 6, 8, 12, 16, 24]
const FPS_STORAGE_KEY = 'ai-art-engine.anim2d.fps'
const FPS_DEFAULT = 8

const playing = ref(false)
const loop = ref(true)
const activeIndex = ref(0)
const playDirection = ref<1 | -1>(1)
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
  if (!activeCells.value.length) return
  playing.value = true
  clearFrameTimer()
  frameTimer = setInterval(
    () => {
      const count = activeCells.value.length
      if (count <= 1) return
      if (playMode.value === 'pingpong') {
        const next = activeIndex.value + playDirection.value
        if (next >= count) {
          playDirection.value = -1
          activeIndex.value = Math.max(0, count - 2)
        } else if (next < 0) {
          if (loop.value) {
            playDirection.value = 1
            activeIndex.value = Math.min(count - 1, 1)
          } else {
            stopPlayback()
          }
        } else {
          activeIndex.value = next
        }
        return
      }
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
  playDirection.value = 1
  startPlayback()
}

function stepFrame(delta: -1 | 1): void {
  stopPlayback()
  const count = activeCells.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

function seekToCellKey(key: string): void {
  const idx = activeCells.value.findIndex((c) => c.key === key)
  if (idx >= 0) {
    activeIndex.value = idx
    if (playing.value) {
      clearFrameTimer()
      startPlayback()
    }
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
  if (playing.value) {
    clearFrameTimer()
    startPlayback()
  }
}

function onLoopChange(e: Event): void {
  loop.value = (e.target as HTMLInputElement).checked
}

const gifBusy = ref(false)
const sheetBusy = ref(false)
const gifStatus = ref('')
const gifError = ref('')

const gifSaveOpen = ref(false)
const saveMode = ref<'gif' | 'sheet'>('gif')
const gifSaveDefaultName = ref('')
const gifSaveRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const gifSaving = ref(false)

async function composeGifFromCells(): Promise<Anim2dGifResult> {
  const baseUrls = activeCells.value.map((cell) => cell.dataUrl)
  const frameUrls =
    playMode.value === 'pingpong' && baseUrls.length > 2
      ? [...baseUrls, ...baseUrls.slice(1, -1).reverse()]
      : baseUrls
  const gif = await composeAnim2dGif({
    frameUrls,
    fps: fps.value,
    loop: loop.value
  })
  if (!gif) throw new Error('ANIM2D_GIF_NO_FRAMES')
  return gif
}

function exportGif(): void {
  if (!node.value || gifBusy.value || activeCells.value.length < 2) return
  gifError.value = ''
  saveMode.value = 'gif'
  gifSaveDefaultName.value = `anim2d-gif-${state.value.rows}x${state.value.cols}`
  gifSaveOpen.value = true
}

function exportSheet(): void {
  if (!node.value || sheetBusy.value || activeCells.value.length < 1) return
  gifError.value = ''
  saveMode.value = 'sheet'
  gifSaveDefaultName.value = `anim2d-sheet-${activeCells.value.length}f`
  gifSaveOpen.value = true
}

function closeGifSave(): void {
  if (gifSaving.value) return
  gifSaveOpen.value = false
}

async function onGifSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  if (!node.value || gifSaving.value) return
  gifSaving.value = true
  if (saveMode.value === 'sheet') sheetBusy.value = true
  else gifBusy.value = true
  gifStatus.value = ''
  gifError.value = ''
  gifSaveRef.value?.setSaving(true)
  try {
    let mediaDataUrl = ''
    let keyPrefix = 'anim2d-gif'
    let subFolder = 'Gifs'
    let sheetInfo: Stage2dFrameSheet | null = null
    if (saveMode.value === 'sheet') {
      const sheet = await composeStage2dFrameSheet({
        frameUrls: activeCells.value.map((c) => c.dataUrl)
      })
      if (!sheet?.dataUrl) throw new Error('ANIM2D_SHEET_EMPTY')
      sheetInfo = sheet
      mediaDataUrl = sheet.dataUrl
      keyPrefix = 'anim2d-sheet'
      subFolder = 'Sheets'
    } else {
      const gif = await composeGifFromCells()
      mediaDataUrl = gif.dataUrl
    }

    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const stagedPath = await window.studio.saveGraphRunMedia({
      dataUrl: mediaDataUrl,
      key: `${keyPrefix}-${Date.now()}`,
      outputDir: `${cacheRoot}/${subFolder}`
    })
    if (!(await window.studio.projectFileExists(stagedPath))) {
      const name = stagedPath.split('/').pop() || stagedPath
      gifSaveRef.value?.setSourceMissing(stagedPath)
      gifSaveRef.value?.setError(t('dialog.saveAsset.sourceMissing', { name }))
      return
    }
    const asset = await window.studio.saveProjectAsset({
      relativePath: stagedPath,
      name: payload.name,
      folderId: payload.folderId
    })
    if (saveMode.value === 'sheet' && sheetInfo && asset.relativePath) {
      const anchorMode = stabilize.value === 'center' ? 'center' : 'ground'
      const manifest = buildSpriteManifest({
        canvasWidth: sheetInfo.frameWidth,
        canvasHeight: sheetInfo.frameHeight,
        anchor: anchorMode,
        sprites: activeCells.value.map((cell, idx) => ({
          name: `${payload.name}-${cell.key || idx}`,
          fileName: asset.relativePath.split('/').pop() || `${payload.name}.png`,
          width: sheetInfo.frameWidth,
          height: sheetInfo.frameHeight
        }))
      })
      const manifestPath = asset.relativePath.replace(/\.png$/i, '.manifest.json')
      try {
        await window.studio.writeProjectFile({
          relativePath: manifestPath,
          content: JSON.stringify(manifest, null, 2)
        })
      } catch {
        /* ignore manifest write failure */
      }
    }
    await project.scheduleRefreshLibrary()
    gifSaveOpen.value = false
    gifStatus.value =
      saveMode.value === 'sheet'
        ? t('graph.anim2d.exportSheetDone', { path: asset.relativePath || asset.name })
        : t('graph.anim2d.exportGifDone', { path: asset.relativePath || asset.name })
  } catch (err) {
    gifSaveRef.value?.setError(err instanceof Error ? err.message : String(err))
  } finally {
    gifSaving.value = false
    gifBusy.value = false
    sheetBusy.value = false
    gifSaveRef.value?.setSaving(false)
  }
}

async function resolveGridImageUrl(): Promise<string> {
  const grid = node.value?.params?.animGridImage as
    { dataUrl?: string; relativePath?: string } | undefined
  if (grid?.dataUrl?.trim()) return grid.dataUrl.trim()
  if (grid?.relativePath?.trim()) {
    try {
      const url = await window.studio.getAssetMediaDataUrl(grid.relativePath.trim())
      if (url?.trim()) return url.trim()
    } catch {
      /* fallback to upstream */
    }
  }
  if (hostId.value && node.value?.id) {
    const document = graphEditorHosts.getDocument(hostId.value)
    const runStates = graphRunHosts.get(hostId.value)?.runStates
    const upstream = await resolveNodeUpstreamImageUrl({
      document,
      nodeId: node.value.id,
      runStates,
      assets: project.assets
    })
    if (upstream?.trim()) return upstream.trim()
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
    const thresholdValue = readAnimKeyThresholdFromNode(current.params)
    const insetValue = readAnimEdgeInsetFromNode(current.params)
    const stabilizeValue = readAnimStabilizeFromNode(current.params)
    for (const cell of anim2dCellKeys(s.rows, s.cols)) {
      if (token !== cellToken) return
      try {
        const composed = await composeImageGridCell({
          sourceDataUrl: sourceUrl,
          state: { rows: s.rows, cols: s.cols, selected: [] },
          cellKey: cell,
          edgeInset: insetValue,
          ...(keyColorValue
            ? { chromaKey: { color: keyColorValue, threshold: thresholdValue } }
            : {}),
          ...(stabilizeValue !== 'off' ? { stabilize: stabilizeValue } : {})
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
    () => readAnimKeyThresholdFromNode(node.value?.params),
    () => readAnimEdgeInsetFromNode(node.value?.params),
    () => readAnimStabilizeFromNode(node.value?.params),
    () => {
      const grid = node.value?.params?.animGridImage as
        { dataUrl?: string; relativePath?: string } | undefined
      return grid?.dataUrl?.slice(0, 48) ?? grid?.relativePath ?? ''
    }
  ],
  () => {
    activeIndex.value = 0
    if (!gifSaving.value) gifSaveOpen.value = false
    void refreshCells()
  },
  { immediate: true }
)

watch(activeCells, (next) => {
  if (activeIndex.value >= next.length) activeIndex.value = 0
})

onBeforeUnmount(stopPlayback)
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.frame-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.hint.ok-text {
  color: var(--accent);
}

.hint.warn-text {
  color: var(--warning, #d97706);
}

.hint.err {
  color: var(--danger);
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 60%, transparent);
}

.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}

.config-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  min-width: 0;
}

.field-grow {
  flex: 1;
}

.field select,
.field input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  min-width: 0;
}

.field input[type='number'] {
  width: 64px;
}

.slider-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.slider-head {
  display: flex;
  justify-content: space-between;
}

.anim-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.backdrop-group {
  display: flex;
  gap: 4px;
}

.mini-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.mini-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.onion-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.anim-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
}

.anim-preview.bg-checker {
  background-color: var(--bg-input);
  background-image:
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    ),
    linear-gradient(45deg, var(--wash-16) 25%, transparent 25%, transparent 75%, var(--wash-16) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    8px 8px;
}

.anim-preview.bg-dark {
  background: #121316;
}

.anim-preview.bg-light {
  background: #f3f4f6;
}

.anim-preview img.main-frame {
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
}

.anim-preview img.onion-ghost {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  max-height: 240px;
  object-fit: contain;
  opacity: 0.28;
  filter: hue-rotate(160deg) saturate(1.6);
  pointer-events: none;
}

.guide-line {
  position: absolute;
  z-index: 3;
  pointer-events: none;
}

.guide-line.ground {
  left: 0;
  right: 0;
  bottom: 6%;
  height: 1px;
  background: rgba(250, 204, 21, 0.75);
}

.guide-line.center-h {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(56, 189, 248, 0.65);
}

.guide-line.center-v {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: rgba(56, 189, 248, 0.55);
}

.anim-frame-badge {
  position: absolute;
  z-index: 4;
  right: 6px;
  bottom: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  font-variant-numeric: tabular-nums;
}

.anim-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.icon-step {
  height: 28px;
  width: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.anim-play {
  height: 28px;
  min-width: 56px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.anim-play.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}

.anim-play:hover:not(:disabled) {
  opacity: 0.92;
}

.anim-play:disabled {
  opacity: 0.5;
  cursor: default;
}

.export-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.anim-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
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

.anim-loop {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

.frame-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
}

.frame-card {
  position: relative;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.frame-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.frame-card.disabled {
  opacity: 0.35;
  filter: grayscale(1);
}

.frame-card img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.frame-index {
  position: absolute;
  left: 3px;
  bottom: 3px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  font-variant-numeric: tabular-nums;
}

.frame-enable-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
}

.frame-enable-btn:hover {
  background: var(--accent);
}

.video-extract-card {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.upstream-video-preview {
  width: 100%;
  max-height: 150px;
  border-radius: 6px;
  background: #0d0f12;
  object-fit: contain;
}
</style>
