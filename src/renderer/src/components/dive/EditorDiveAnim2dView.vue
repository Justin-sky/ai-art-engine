<template>
  <div class="dive-view anim2d-dive">
    <!-- 顶部全屏工作台工具栏 -->
    <header class="toolbar">
      <div class="toolbar-group">
        <span class="tb-title">🎞️ {{ displayTitle }}</span>
        <div class="preset-pills">
          <button
            v-for="p in GRID_PRESETS"
            :key="`${p.rows}x${p.cols}`"
            type="button"
            class="tb-pill"
            :class="{ active: state.rows === p.rows && state.cols === p.cols }"
            @click="applyGridPreset(p.rows, p.cols)"
          >
            {{ p.rows }}×{{ p.cols }}
          </button>
        </div>
        <div class="dim-inline">
          <label>
            <span>{{ t('graph.anim2d.rows') }}</span>
            <input
              type="number"
              min="1"
              :max="ANIM2D_MAX_DIM"
              :value="state.rows"
              @change="onRowsChange"
            />
          </label>
          <span class="mul">×</span>
          <label>
            <span>{{ t('graph.anim2d.cols') }}</span>
            <input
              type="number"
              min="1"
              :max="ANIM2D_MAX_DIM"
              :value="state.cols"
              @change="onColsChange"
            />
          </label>
        </div>
      </div>

      <span class="tb-divider" />

      <div class="toolbar-group">
        <button
          v-if="upstreamVideoUrl"
          type="button"
          class="tb-btn tb-btn--accent"
          :disabled="videoExtractBusy"
          @click="extractVideoToAnim2dNow"
        >
          {{
            videoExtractBusy
              ? t('graph.anim2d.videoExtractBusy')
              : t('graph.anim2d.videoExtractNow')
          }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': onionSkin }"
          @click="onionSkin = !onionSkin"
        >
          🧅 {{ t('graph.anim2d.onionSkin') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': showGuide }"
          @click="showGuide = !showGuide"
        >
          🎯 {{ pickBi('基准线', 'Guides') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :class="{ 'tb-btn--active': pixelated }"
          @click="pixelated = !pixelated"
        >
          👾 {{ pickBi('像素锐利', 'Pixelated') }}
        </button>
        <div class="zoom-pills">
          <button
            v-for="z in [1, 2, 3] as const"
            :key="z"
            type="button"
            class="tb-pill"
            :class="{ active: stageZoom === z }"
            @click="stageZoom = z"
          >
            {{ z }}x
          </button>
        </div>
        <div class="backdrop-pills">
          <button
            type="button"
            class="tb-pill"
            :class="{ active: backdrop === 'checker' }"
            @click="backdrop = 'checker'"
          >
            🏁
          </button>
          <button
            type="button"
            class="tb-pill"
            :class="{ active: backdrop === 'dark' }"
            @click="backdrop = 'dark'"
          >
            🌑
          </button>
          <button
            type="button"
            class="tb-pill"
            :class="{ active: backdrop === 'light' }"
            @click="backdrop = 'light'"
          >
            🌕
          </button>
        </div>
      </div>

      <span class="spacer" />

      <div class="toolbar-group">
        <button
          type="button"
          class="tb-btn"
          :disabled="gifBusy || activeCells.length < 2"
          @click="exportGif"
        >
          📤 {{ gifBusy ? t('graph.anim2d.exportGifBusy') : t('graph.anim2d.exportGif') }}
        </button>
        <button
          type="button"
          class="tb-btn"
          :disabled="sheetBusy || activeCells.length < 1"
          @click="exportSheet"
        >
          🖼️ {{ sheetBusy ? t('graph.anim2d.exportSheetBusy') : t('graph.anim2d.exportSheet') }}
        </button>
        <button type="button" class="tb-btn done" @click="onClose">
          ✓ {{ pickBi('完成', 'Done') }}
        </button>
      </div>
    </header>

    <div class="body">
      <!-- 左侧：源序列图交互切格 + 上游视频抽帧 + 抠图/防抖参数 -->
      <aside class="left-sidebar">
        <!-- 源序列图交互式网格叠层 -->
        <section class="panel-card">
          <div class="panel-head">
            <span class="panel-title">{{
              pickBi('源序列图切格预览', 'Source Sprite Sheet Grid')
            }}</span>
            <span class="panel-badge"
              >{{ state.rows }}×{{ state.cols }} ({{ state.rows * state.cols }}
              {{ pickBi('格', 'cells') }})</span
            >
          </div>
          <div v-if="sourceSheetUrl" class="sheet-overlay-wrap" :class="`bg-${backdrop}`">
            <div class="sheet-stage">
              <img :src="sourceSheetUrl" alt="" class="sheet-img" draggable="false" />
              <div
                class="sheet-grid-overlay"
                :style="{
                  gridTemplateRows: `repeat(${state.rows}, 1fr)`,
                  gridTemplateColumns: `repeat(${state.cols}, 1fr)`
                }"
              >
                <div
                  v-for="(cellKey, idx) in allCellKeys"
                  :key="cellKey"
                  class="sheet-grid-cell"
                  :class="{
                    active: currentActiveCell?.key === cellKey && !isCellDisabled(cellKey),
                    disabled: isCellDisabled(cellKey)
                  }"
                  @click="seekToCellKey(cellKey)"
                >
                  <span class="cell-num">#{{ idx + 1 }}</span>
                  <button
                    type="button"
                    class="cell-mute-btn"
                    :title="t('graph.anim2d.toggleFrameHint')"
                    @click.stop="toggleCellDisabled(cellKey)"
                  >
                    {{ isCellDisabled(cellKey) ? '🚫' : '✓' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty-box">
            {{ t('graph.anim2d.emptyPreview') }}
          </div>
        </section>

        <!-- 上游视频区间截取与直抽面板 -->
        <section v-if="upstreamVideoUrl" class="panel-card">
          <div class="panel-head">
            <span class="panel-title">🎬 {{ t('graph.anim2d.genModeVideoSheet') }}</span>
            <span class="panel-badge">
              {{ Math.round(videoRange.startRatio * 100) }}% –
              {{ Math.round(videoRange.endRatio * 100) }}%
            </span>
          </div>
          <video :src="upstreamVideoUrl" class="video-preview" controls muted loop playsinline />
          <div class="range-row">
            <span>{{ t('graph.anim2d.videoStartRatio') }}</span>
            <input
              type="range"
              min="0"
              max="0.95"
              step="0.01"
              :value="videoRange.startRatio"
              @input="onVideoRangeChange('start', $event)"
            />
          </div>
          <div class="range-row">
            <span>{{ t('graph.anim2d.videoEndRatio') }}</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.01"
              :value="videoRange.endRatio"
              @input="onVideoRangeChange('end', $event)"
            />
          </div>
          <button
            type="button"
            class="extract-btn"
            :disabled="videoExtractBusy"
            @click="extractVideoToAnim2dNow"
          >
            {{
              videoExtractBusy
                ? t('graph.anim2d.videoExtractBusy')
                : t('graph.anim2d.videoExtractNow')
            }}
          </button>
        </section>

        <!-- 抠图 / 内缩 / 原地防抖对齐 / GIF 输出参数 -->
        <section class="panel-card">
          <div class="panel-head">
            <span class="panel-title">{{
              pickBi('切帧清理与防抖对齐', 'Cleanup & Stabilization')
            }}</span>
          </div>

          <label class="field">
            <span class="field-label">{{ t('graph.anim2d.bgKey') }}</span>
            <select class="select" :value="keyColor" @change="onKeyColorChange">
              <option value="">{{ t('graph.anim2d.bgKeyNone') }}</option>
              <option value="auto">{{ t('graph.anim2d.bgKeyAuto') }}</option>
              <option value="black">{{ t('graph.anim2d.bgKeyBlack') }}</option>
              <option value="white">{{ t('graph.anim2d.bgKeyWhite') }}</option>
            </select>
          </label>

          <label v-if="keyColor" class="field">
            <div class="field-row">
              <span class="field-label">{{ t('graph.anim2d.keyThreshold') }}</span>
              <span class="field-val">{{ keyThreshold }}</span>
            </div>
            <input
              type="range"
              min="10"
              max="150"
              step="2"
              :value="keyThreshold"
              @input="onKeyThresholdChange"
            />
          </label>

          <div class="two-col">
            <label class="field">
              <span class="field-label">{{ t('graph.anim2d.edgeInset') }}</span>
              <select class="select" :value="String(edgeInset)" @change="onEdgeInsetChange">
                <option value="auto">{{ t('graph.anim2d.edgeInsetAuto') }}</option>
                <option value="0">0 px</option>
                <option value="1">1 px</option>
                <option value="2">2 px</option>
                <option value="4">4 px</option>
                <option value="8">8 px</option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">{{ t('graph.anim2d.stabilize') }}</span>
              <select class="select" :value="stabilize" @change="onStabilizeChange">
                <option value="off">{{ t('graph.anim2d.stabilizeOff') }}</option>
                <option value="ground">{{ t('graph.anim2d.stabilizeGround') }}</option>
                <option value="center">{{ t('graph.anim2d.stabilizeCenter') }}</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span class="field-label">{{ t('graph.anim2d.runGifFps') }}</span>
            <select class="select" :value="gifFps" @change="onGifFpsChange">
              <option :value="0">{{ t('graph.anim2d.runGifOff') }}</option>
              <option v-for="option in FPS_OPTIONS" :key="option" :value="option">
                {{ option }} fps
              </option>
            </select>
          </label>

          <p v-if="gifStatus" class="status-ok">{{ gifStatus }}</p>
          <p v-if="gifError" class="status-err">{{ gifError }}</p>
        </section>
      </aside>

      <!-- 右侧主工作区：大画布动画舞台 + 底部时间轴胶片条 -->
      <main class="stage-main">
        <div class="stage-viewport" :class="`bg-${backdrop}`" @click="togglePlay">
          <div v-if="gridLoading" class="stage-empty">
            {{ t('graph.anim2d.loading') }}
          </div>
          <div v-else-if="activeCells.length === 0" class="stage-empty">
            {{ t('graph.anim2d.emptyPreview') }}
          </div>
          <div v-else class="stage-canvas-box" :style="{ transform: `scale(${stageZoom})` }">
            <!-- 洋葱皮上一帧叠影 -->
            <img
              v-if="onionSkin && prevActiveCell && prevActiveCell.key !== currentActiveCell?.key"
              :src="prevActiveCell.dataUrl"
              alt=""
              class="stage-frame onion-prev"
              :class="{ pixelated }"
              draggable="false"
            />
            <!-- 当前帧 -->
            <img
              v-if="currentActiveCell"
              :src="currentActiveCell.dataUrl"
              alt=""
              class="stage-frame"
              :class="{ pixelated }"
              draggable="false"
            />
            <!-- 十字基准线与脚底接地线 -->
            <template v-if="showGuide">
              <div class="guide-v" />
              <div class="guide-h-center" />
              <div class="guide-h-ground" />
            </template>
          </div>

          <!-- 左上角帧信息 HUD -->
          <div v-if="activeCells.length > 0" class="stage-hud">
            <span class="hud-pill"> #{{ activeIndex + 1 }} / {{ activeCells.length }} </span>
            <span v-if="currentActiveCell" class="hud-pill subtle">
              Cell {{ currentActiveCell.key }}
            </span>
            <span v-if="stabilize !== 'off'" class="hud-pill accent">
              {{
                stabilize === 'ground'
                  ? t('graph.anim2d.stabilizeGround')
                  : t('graph.anim2d.stabilizeCenter')
              }}
            </span>
          </div>
        </div>

        <!-- 播放传输控制栏 -->
        <div class="transport-bar">
          <div class="transport-left">
            <button
              type="button"
              class="ctrl-btn"
              :disabled="activeCells.length <= 1"
              @click="stepFrame(-1)"
            >
              ⏮
            </button>
            <button
              type="button"
              class="ctrl-btn primary"
              :disabled="activeCells.length <= 1"
              @click="togglePlay"
            >
              {{ playing ? `⏸ ${t('graph.anim2d.pause')}` : `▶ ${t('graph.anim2d.play')}` }}
            </button>
            <button
              type="button"
              class="ctrl-btn"
              :disabled="activeCells.length <= 1"
              @click="stepFrame(1)"
            >
              ⏭
            </button>
          </div>

          <div class="transport-center">
            <label class="inline-ctrl">
              <span>{{ t('graph.anim2d.playMode') }}</span>
              <select class="select compact" :value="playMode" @change="onPlayModeChange">
                <option value="loop">{{ t('graph.anim2d.playModeLoop') }}</option>
                <option value="pingpong">{{ t('graph.anim2d.playModePingpong') }}</option>
              </select>
            </label>
            <label class="inline-ctrl">
              <span>{{ t('graph.anim2d.fps') }}</span>
              <select class="select compact" :value="fps" @change="onFpsChange">
                <option v-for="option in FPS_OPTIONS" :key="option" :value="option">
                  {{ option }} fps
                </option>
              </select>
            </label>
            <label class="inline-ctrl">
              <input type="checkbox" :checked="loop" @change="onLoopChange" />
              <span>{{ t('graph.anim2d.loop') }}</span>
            </label>
          </div>

          <div class="transport-right">
            <span class="muted-count">
              {{ pickBi('有效帧', 'Active') }} {{ activeCells.length }} / {{ cells.length }}
            </span>
          </div>
        </div>

        <!-- 底部逐帧胶片时间轴 -->
        <div class="filmstrip">
          <div
            v-for="(cell, idx) in cells"
            :key="cell.key"
            class="film-cell"
            :class="{
              active: currentActiveCell?.key === cell.key && !isCellDisabled(cell.key),
              disabled: isCellDisabled(cell.key)
            }"
            @click="seekToCellKey(cell.key)"
          >
            <div class="film-thumb" :class="`bg-${backdrop}`">
              <img :src="cell.dataUrl" alt="" :class="{ pixelated }" draggable="false" />
            </div>
            <div class="film-foot">
              <span class="film-idx">#{{ idx + 1 }}</span>
              <span class="film-key">{{ cell.key }}</span>
              <button
                type="button"
                class="film-toggle"
                :title="t('graph.anim2d.toggleFrameHint')"
                @click.stop="toggleCellDisabled(cell.key)"
              >
                {{ isCellDisabled(cell.key) ? '🚫' : '✓' }}
              </button>
            </div>
          </div>
        </div>
      </main>
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
      @confirm="onSaveConfirm"
      @cancel="closeGifSave"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import {
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
import SaveAssetDialog from '../SaveAssetDialog.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../../composables/useNodeDisplayTitle'
import { useProjectStore } from '../../stores/project'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamImageUrl } from '../../features/graph/model/resolveNodeUpstreamImageUrl'
import { resolveNodeUpstreamVideoUrl } from '../../features/graph/model/resolveNodeUpstreamVideoUrl'
import { composeVideoFrameSheet } from '../../features/graph/model/composeVideoFrameSheet'
import { composeImageGridCell } from '../../features/graph/model/composeImageGridCell'
import { composeAnim2dGif, type Anim2dGifResult } from '../../features/graph/model/composeAnim2dGif'
import {
  composeStage2dFrameSheet,
  type Stage2dFrameSheet
} from '../../features/graph/model/composeStage2dFrameSheet'

const props = defineProps<{
  frameKey?: string
  hostId: string
  nodeId: string
}>()

const GRID_PRESETS = [
  { rows: 1, cols: 4 },
  { rows: 1, cols: 6 },
  { rows: 1, cols: 8 },
  { rows: 2, cols: 2 },
  { rows: 2, cols: 3 },
  { rows: 2, cols: 4 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 }
] as const

const FPS_OPTIONS = [2, 4, 6, 8, 12, 16, 24]
const FPS_STORAGE_KEY = 'ai-art-engine.anim2d.fps'
const FPS_DEFAULT = 8

const { t, locale, graphTypeLabel } = useStudioI18n()
const project = useProjectStore()
const diveCtx = inject(editorDiveKey, null)

function pickBi(zh: string, en: string): string {
  return locale.value === 'en-US' ? en : zh
}

const node = computed(() => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !props.nodeId) return null
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'anim.2d' ? current : null
})

const typeLabel = computed(() => graphTypeLabel('anim.2d'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value ? readAnim2dFromNode(node.value.params) : { rows: 1, cols: 4 }
)
const allCellKeys = computed(() => anim2dCellKeys(state.value.rows, state.value.cols))
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
const gifFps = computed(() => (node.value ? readAnimGifFpsFromNode(node.value.params) : 0))

const backdrop = ref<'checker' | 'dark' | 'light'>('checker')
const onionSkin = ref(false)
const showGuide = ref(true)
const pixelated = ref(false)
const stageZoom = ref<1 | 2 | 3>(1)

const sourceSheetUrl = ref('')
const upstreamVideoUrl = ref('')
const upstreamVideoRel = ref('')
const videoExtractBusy = ref(false)

watch(
  () => [props.hostId, props.nodeId, graphEditorHosts.revision.value] as const,
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
  if (!node.value || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, node.value.id, patch)
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
  if (videoExtractBusy.value || !node.value || !props.hostId || !upstreamVideoUrl.value) return
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

function onGifFpsChange(e: Event): void {
  patchParams(animGifFpsToNodePatch(Number((e.target as HTMLSelectElement).value)))
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
    if (cells.value.length - current.length <= 1) return
    current.push(key)
  }
  patchParams({ animDisabledCells: current })
}

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

const playing = ref(true)
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

async function onSaveConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
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
        /* ignore */
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
  if (props.hostId && node.value?.id) {
    const document = graphEditorHosts.getDocument(props.hostId)
    const runStates = graphRunHosts.get(props.hostId)?.runStates
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
    sourceSheetUrl.value = ''
    gridLoading.value = false
    return
  }
  const token = ++cellToken
  gridLoading.value = true
  try {
    const sourceUrl = await resolveGridImageUrl()
    if (token !== cellToken) return
    sourceSheetUrl.value = sourceUrl
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
        /* skip */
      }
    }
    if (token !== cellToken) return
    cells.value = next
    if (next.length > 1) {
      startPlayback()
    }
  } catch {
    if (token === cellToken) cells.value = []
  } finally {
    if (token === cellToken) gridLoading.value = false
  }
}

watch(
  [
    () => node.value?.id ?? '',
    () => props.hostId,
    () => graphEditorHosts.revision.value,
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
    void refreshCells()
  },
  { immediate: true }
)

watch(activeCells, (next) => {
  if (activeIndex.value >= next.length) activeIndex.value = 0
})

function onClose(): void {
  if (!diveCtx) return
  const idx = diveCtx.frames.findIndex((f) => f.key === props.frameKey)
  diveCtx.popTo(idx > 0 ? idx - 1 : -1)
}

onBeforeUnmount(stopPlayback)
</script>

<style scoped>
.anim2d-dive {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tb-title {
  font-size: 13px;
  font-weight: 600;
  margin-right: 4px;
}

.tb-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}

.spacer {
  flex: 1;
}

.preset-pills,
.zoom-pills,
.backdrop-pills {
  display: flex;
  gap: 3px;
  background: var(--bg-input);
  padding: 2px;
  border-radius: 6px;
}

.tb-pill {
  padding: 3px 7px;
  font-size: 11px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.tb-pill.active {
  background: rgba(99, 102, 241, 0.25);
  color: #a5b4fc;
  font-weight: 600;
}

.dim-inline {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.dim-inline label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dim-inline input {
  width: 44px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  font-size: 12px;
  text-align: center;
}

.tb-btn {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  cursor: pointer;
}

.tb-btn--active {
  border-color: rgba(99, 102, 241, 0.65);
  background: rgba(99, 102, 241, 0.2);
  color: #c7d2fe;
}

.tb-btn--accent {
  border-color: rgba(56, 189, 248, 0.55);
  background: rgba(56, 189, 248, 0.16);
  color: #bae6fd;
}

.tb-btn.done {
  border-color: rgba(34, 197, 94, 0.5);
  background: rgba(34, 197, 94, 0.18);
  color: #bbf7d0;
  font-weight: 600;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 340px 1fr;
}

.left-sidebar {
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
  border: 1px solid var(--border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
}

.panel-badge {
  font-size: 11px;
  color: var(--text-muted);
}

.sheet-overlay-wrap {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
}

.sheet-stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.sheet-img {
  display: block;
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
}

.sheet-grid-overlay {
  position: absolute;
  inset: 0;
  display: grid;
}

.sheet-grid-cell {
  position: relative;
  border: 1px dashed rgba(99, 102, 241, 0.55);
  cursor: pointer;
  transition: background 0.12s;
}

.sheet-grid-cell:hover {
  background: rgba(99, 102, 241, 0.16);
}

.sheet-grid-cell.active {
  border: 2px solid #fbbf24;
  background: rgba(251, 191, 36, 0.14);
}

.sheet-grid-cell.disabled {
  background: rgba(0, 0, 0, 0.65);
}

.cell-num {
  position: absolute;
  top: 2px;
  left: 3px;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  color: #f9fafb;
}

.cell-mute-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 10px;
  padding: 0 3px;
  border: none;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
}

.video-preview {
  width: 100%;
  max-height: 150px;
  border-radius: 6px;
  background: #000;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.range-row input[type='range'] {
  flex: 1;
}

.extract-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.15);
  color: #e0f2fe;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.field-label {
  font-size: 11px;
  color: var(--text-muted);
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.select {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  font-size: 12px;
}

.select.compact {
  padding: 3px 6px;
}

.stage-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.stage-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
}

.bg-checker {
  background-color: #1e222a;
  background-image:
    linear-gradient(45deg, #282d37 25%, transparent 25%),
    linear-gradient(-45deg, #282d37 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #282d37 75%),
    linear-gradient(-45deg, transparent 75%, #282d37 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0;
}

.bg-dark {
  background: #0d0f13;
}

.bg-light {
  background: #e5e7eb;
}

.stage-canvas-box {
  position: relative;
  width: 320px;
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
}

.stage-frame {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.stage-frame.onion-prev {
  position: absolute;
  opacity: 0.32;
  filter: hue-rotate(150deg) saturate(1.6);
  pointer-events: none;
}

.pixelated {
  image-rendering: pixelated;
}

.guide-v {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: rgba(56, 189, 248, 0.45);
  pointer-events: none;
}

.guide-h-center {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: rgba(56, 189, 248, 0.35);
  pointer-events: none;
}

.guide-h-ground {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 6%;
  height: 2px;
  background: rgba(251, 191, 36, 0.65);
  pointer-events: none;
}

.stage-hud {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 6px;
  pointer-events: none;
}

.hud-pill {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.65);
  color: #f9fafb;
}

.hud-pill.subtle {
  color: #9ca3af;
}

.hud-pill.accent {
  background: rgba(99, 102, 241, 0.35);
  color: #e0e7ff;
}

.transport-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.transport-left,
.transport-center,
.transport-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ctrl-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}

.ctrl-btn.primary {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.55);
  font-weight: 600;
}

.inline-ctrl {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.filmstrip {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  overflow-x: auto;
  background: rgba(0, 0, 0, 0.25);
  min-height: 116px;
}

.film-cell {
  flex: 0 0 88px;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  overflow: hidden;
  cursor: pointer;
}

.film-cell.active {
  border-color: #fbbf24;
  box-shadow: 0 0 0 1px #fbbf24;
}

.film-cell.disabled {
  opacity: 0.4;
}

.film-thumb {
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.film-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.film-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 5px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.4);
}

.film-toggle {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
}

.empty-box,
.stage-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
}

.status-ok {
  font-size: 11px;
  color: #4ade80;
  margin: 0;
}

.status-err {
  font-size: 11px;
  color: #f87171;
  margin: 0;
}
</style>
