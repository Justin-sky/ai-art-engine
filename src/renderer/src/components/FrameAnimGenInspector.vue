<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
      <span class="frame-badge"
        >{{ state.rows }}×{{ state.cols }} · {{ state.rows * state.cols }}F</span
      >
    </div>
    <p class="hint">
      {{ t('graph.anim2d.genInspectorHint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <!-- 0. 序列图合成通道（解决纯提示词不可控问题） -->
    <section class="panel-card">
      <label class="field">
        <span>{{ t('graph.anim2d.genMode') }}</span>
        <select :value="genMode" @change="onGenModeChange">
          <option value="auto">{{ t('graph.anim2d.genModeAuto') }}</option>
          <option value="video-sheet">{{ t('graph.anim2d.genModeVideoSheet') }}</option>
          <option value="video-restyle">{{ t('graph.anim2d.genModeVideoRestyle') }}</option>
          <option value="frames-sheet">{{ t('graph.anim2d.genModeFramesSheet') }}</option>
          <option value="ai-sheet">{{ t('graph.anim2d.genModeAiSheet') }}</option>
        </select>
        <small class="field-note">{{ t('graph.anim2d.genModeHint') }}</small>
      </label>

      <!-- 视频抽帧控制与实时预览（接了上游视频或选择了视频模式时展示） -->
      <div
        v-if="upstreamVideoUrl || genMode === 'video-sheet' || genMode === 'video-restyle'"
        class="video-extract-box"
      >
        <video
          v-if="upstreamVideoUrl"
          :src="upstreamVideoUrl"
          class="upstream-video-preview"
          controls
          muted
          playsinline
          preload="metadata"
        />
        <p v-else class="hint">
          {{ t('graph.anim2d.videoNoUpstream') }}
        </p>

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

        <label class="field">
          <span>{{ t('graph.anim2d.stabilize') }}</span>
          <select :value="stabilize" @change="onStabilizeChange">
            <option value="ground">{{ t('graph.anim2d.stabilizeGround') }}</option>
            <option value="center">{{ t('graph.anim2d.stabilizeCenter') }}</option>
            <option value="off">{{ t('graph.anim2d.stabilizeOff') }}</option>
          </select>
        </label>

        <button
          v-if="upstreamVideoUrl"
          type="button"
          class="extract-btn"
          :disabled="extractBusy"
          @click="extractVideoSheetNow"
        >
          {{ extractBusy ? t('graph.anim2d.videoExtractBusy') : t('graph.anim2d.videoExtractNow') }}
        </button>
        <p v-if="extractMsg" class="hint ok-text">
          {{ extractMsg }}
        </p>
      </div>
    </section>

    <!-- 1. 分格规格预设与行列数 -->
    <section class="panel-card">
      <div class="section-header">
        <span class="section-title">{{ t('graph.anim2d.gridPresets') }}</span>
      </div>
      <div class="chip-grid">
        <button
          v-for="preset in ANIM2D_GRID_PRESETS"
          :key="preset.id"
          type="button"
          class="chip"
          :class="{ active: state.rows === preset.rows && state.cols === preset.cols }"
          @click="applyGridPreset(preset)"
        >
          <b>{{ preset.rows }}×{{ preset.cols }}</b>
          <small>{{ preset.frames }}F</small>
        </button>
      </div>
      <div class="config-row">
        <label class="field">
          <span>{{ t('graph.anim2d.rows') }}</span>
          <input
            v-model="rowsDraft"
            type="number"
            min="1"
            step="1"
            @focus="rowsFocused = true"
            @input="onRowsInput"
            @change="commitRows"
            @blur="onRowsBlur"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
        </label>
        <label class="field">
          <span>{{ t('graph.anim2d.cols') }}</span>
          <input
            v-model="colsDraft"
            type="number"
            min="1"
            step="1"
            @focus="colsFocused = true"
            @input="onColsInput"
            @change="commitCols"
            @blur="onColsBlur"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
        </label>
      </div>
      <label class="check-row">
        <input v-model="autoMatchAspect" type="checkbox" />
        <span>{{ t('graph.anim2d.autoMatchRatio') }}</span>
      </label>
    </section>

    <!-- 2. 动作预设与动作描述 -->
    <section class="panel-card">
      <div class="section-header">
        <span class="section-title">{{ t('graph.anim2d.preset') }}</span>
        <div class="cat-tabs">
          <button
            v-for="cat in presetCategories"
            :key="cat.id"
            type="button"
            class="cat-tab"
            :class="{ active: activeCategory === cat.id }"
            @click="activeCategory = cat.id"
          >
            {{ cat.label }}
          </button>
        </div>
      </div>
      <div class="chip-grid preset-chips">
        <button
          v-for="p in filteredPresets"
          :key="p.id"
          type="button"
          class="chip"
          :class="{ active: currentPresetId === p.id }"
          @click="selectActionPreset(p)"
        >
          {{ t(`graph.anim2d.presets.${p.labelKey}`) }}
        </button>
      </div>
      <label class="field">
        <span>{{ t('graph.anim2d.action') }}</span>
        <textarea
          v-model="actionInstruction"
          class="instruction"
          rows="3"
          :placeholder="t('graph.anim2d.actionPlaceholder')"
          @change="persistActionInstruction"
        />
      </label>
    </section>

    <!-- 3. 视角锁定 / 画风锁定 / 背景透明化 -->
    <section class="panel-card">
      <div class="grid2">
        <label class="field">
          <span>{{ t('graph.anim2d.viewAngle') }}</span>
          <select :value="viewAngle" @change="onViewAngleChange">
            <option value="">{{ t('graph.anim2d.viewAuto') }}</option>
            <option value="side">{{ t('graph.anim2d.viewSide') }}</option>
            <option value="iso">{{ t('graph.anim2d.viewIso') }}</option>
            <option value="front">{{ t('graph.anim2d.viewFront') }}</option>
            <option value="top">{{ t('graph.anim2d.viewTop') }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t('graph.anim2d.styleLock') }}</span>
          <select :value="styleLock" @change="onStyleLockChange">
            <option value="">{{ t('graph.anim2d.styleAuto') }}</option>
            <option value="cel">{{ t('graph.anim2d.styleCel') }}</option>
            <option value="pixel">{{ t('graph.anim2d.stylePixel') }}</option>
            <option value="hd2d">{{ t('graph.anim2d.styleHd2d') }}</option>
            <option value="vfx">{{ t('graph.anim2d.styleVfx') }}</option>
          </select>
        </label>
      </div>

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
        <small class="field-note">{{ t('graph.anim2d.bgKeyHint') }}</small>
      </label>
    </section>

    <!-- 4. 序列图切格校准预览 -->
    <section v-if="sheetPreviewUrl" class="panel-card">
      <div class="section-header">
        <span class="section-title">{{ t('graph.anim2d.gridOverlay') }}</span>
        <label class="check-row compact">
          <input v-model="showGridOverlay" type="checkbox" />
          <span>{{ state.rows }}×{{ state.cols }}</span>
        </label>
      </div>
      <div class="sheet-calibrator">
        <img :src="sheetPreviewUrl" alt="" />
        <div
          v-if="showGridOverlay"
          class="grid-overlay"
          :style="{
            gridTemplateRows: `repeat(${state.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${state.cols}, 1fr)`
          }"
        >
          <div v-for="idx in state.rows * state.cols" :key="idx" class="grid-cell-guide">
            <span class="cell-num">#{{ idx }}</span>
            <div class="cell-ground-line" />
          </div>
        </div>
      </div>
    </section>

    <label class="field">
      <span>{{ t('graph.anim2d.systemPrompt') }}</span>
      <textarea
        v-model="systemPrompt"
        class="instruction"
        rows="4"
        :placeholder="t('graph.anim2d.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>

    <GraphNodeOutputPreview
      v-if="hostId"
      :node="node"
      :host-id="hostId"
      clearable
      @clear-output="onClearOutput"
    />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ANIM2D_GRID_PRESETS,
  ANIM2D_PRESETS,
  normalizeAnimVideoRange,
  readAnim2dFromNode,
  readAnimGenModeFromNode,
  readAnimKeyColorFromNode,
  readAnimStabilizeFromNode,
  readAnimStyleLockFromNode,
  readAnimVideoRangeFromNode,
  readAnimViewAngleFromNode,
  resolveAnim2dPreset,
  resolveFrameAnimGenSystemPrompt,
  type Anim2dGridPreset,
  type Anim2dPreset,
  type Anim2dPresetCategory,
  type AnimGenMode,
  type AnimKeyColor,
  type AnimStabilizeMode,
  type AnimStyleLock,
  type AnimViewAngle
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamVideoUrl } from '../features/graph/model/resolveNodeUpstreamVideoUrl'
import { composeVideoFrameSheet } from '../features/graph/model/composeVideoFrameSheet'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
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
  return current?.typeId === 'frame.animGen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('frame.animGen'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value ? readAnim2dFromNode(node.value.params) : { rows: 1, cols: 4 }
)
const genMode = computed(() => (node.value ? readAnimGenModeFromNode(node.value.params) : 'auto'))
const videoRange = computed(() =>
  node.value ? readAnimVideoRangeFromNode(node.value.params) : { startRatio: 0, endRatio: 1 }
)
const stabilize = computed(() =>
  node.value ? readAnimStabilizeFromNode(node.value.params) : 'ground'
)
const keyColor = computed(() => (node.value ? readAnimKeyColorFromNode(node.value.params) : ''))
const viewAngle = computed(() => (node.value ? readAnimViewAngleFromNode(node.value.params) : ''))
const styleLock = computed(() => (node.value ? readAnimStyleLockFromNode(node.value.params) : ''))
const currentPresetId = computed(() => node.value?.params.animPresetId?.trim() || '')

const autoMatchAspect = ref(true)
const showGridOverlay = ref(true)
const activeCategory = ref<Anim2dPresetCategory>('locomotion')
const actionInstruction = ref('')
const systemPrompt = ref('')
const sheetPreviewUrl = ref('')
const upstreamVideoUrl = ref('')
const upstreamVideoRel = ref('')
const extractBusy = ref(false)
const extractMsg = ref('')

const presetCategories = computed(() => [
  { id: 'locomotion' as const, label: t('graph.anim2d.catLocomotion') },
  { id: 'combat' as const, label: t('graph.anim2d.catCombat') },
  { id: 'vfx' as const, label: t('graph.anim2d.catVfx') },
  { id: 'turnaround' as const, label: t('graph.anim2d.catTurnaround') },
  { id: 'expression' as const, label: t('graph.anim2d.catExpression') },
  { id: 'tile' as const, label: t('graph.anim2d.catTile') }
])

const filteredPresets = computed(() =>
  ANIM2D_PRESETS.filter((p) => (p.category ?? 'locomotion') === activeCategory.value)
)

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

watch(
  () =>
    [
      node.value?.id,
      node.value?.params.generateInstruction,
      node.value?.params.animPresetId,
      locale.value
    ] as const,
  ([, storedInstruction, presetId]) => {
    const preset = resolveAnim2dPreset(presetId)
    if (preset?.category) {
      activeCategory.value = preset.category
    }
    const isEn = String(locale.value).startsWith('en')
    const fallback = preset ? (isEn ? preset.promptEn || preset.prompt : preset.prompt) : ''
    actionInstruction.value =
      typeof storedInstruction === 'string' && storedInstruction.trim()
        ? storedInstruction
        : fallback
  },
  { immediate: true }
)

watch(
  () => [node.value?.params.generateSystemPrompt, locale.value] as const,
  ([stored]) => {
    systemPrompt.value = resolveFrameAnimGenSystemPrompt(stored, String(locale.value))
  },
  { immediate: true }
)

watch(
  () =>
    [
      node.value?.params.previewDataUrl,
      node.value?.params.previewRelativePath,
      node.value?.params.generatedImages?.[0]?.dataUrl,
      node.value?.params.generatedImages?.[0]?.relativePath
    ] as const,
  async ([pData, pRel, gData, gRel]) => {
    const direct = (pData || gData || '').trim()
    if (direct) {
      sheetPreviewUrl.value = direct
      return
    }
    const rel = (pRel || gRel || '').trim()
    if (rel) {
      try {
        sheetPreviewUrl.value = await resolveAssetPreviewUrl(rel)
      } catch {
        sheetPreviewUrl.value = ''
      }
      return
    }
    sheetPreviewUrl.value = ''
  },
  { immediate: true }
)

function clampDim(n: number): number {
  return Math.max(1, Math.floor(n) || 1)
}

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onGenModeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimGenMode
  patchParams({ animGenMode: value })
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

function onStabilizeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimStabilizeMode
  patchParams({ animStabilize: value })
}

async function extractVideoSheetNow(): Promise<void> {
  if (extractBusy.value || !node.value || !hostId.value || !upstreamVideoUrl.value) return
  extractBusy.value = true
  extractMsg.value = ''
  try {
    const sheet = await composeVideoFrameSheet({
      videoUrl: upstreamVideoUrl.value,
      videoRelativePath: upstreamVideoRel.value,
      rows: state.value.rows,
      cols: state.value.cols,
      startRatio: videoRange.value.startRatio,
      endRatio: videoRange.value.endRatio,
      keyColor: keyColor.value,
      stabilize: stabilize.value
    })
    const stamp = Date.now()
    const itemId = `videoSheet:${node.value.id}:${stamp}`
    const item = {
      id: itemId,
      dataUrl: sheet.dataUrl,
      createdAt: new Date().toISOString()
    }
    patchParams({
      generatedImages: [item],
      selectedImageId: itemId,
      previewDataUrl: sheet.dataUrl,
      previewRelativePath: '',
      animRows: state.value.rows,
      animCols: state.value.cols
    })
    sheetPreviewUrl.value = sheet.dataUrl
    extractMsg.value = t('graph.anim2d.videoExtractDone', {
      frames: sheet.frameCount,
      w: sheet.width,
      h: sheet.height
    })
  } catch (err) {
    extractMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    extractBusy.value = false
  }
}

const rowsDraft = ref(String(state.value.rows))
const colsDraft = ref(String(state.value.cols))
const rowsFocused = ref(false)
const colsFocused = ref(false)

watch(
  () => state.value.rows,
  (r) => {
    if (!rowsFocused.value) {
      rowsDraft.value = String(r)
    }
  },
  { immediate: true }
)

watch(
  () => state.value.cols,
  (c) => {
    if (!colsFocused.value) {
      colsDraft.value = String(c)
    }
  },
  { immediate: true }
)

function applyGridPreset(preset: Anim2dGridPreset): void {
  rowsDraft.value = String(preset.rows)
  colsDraft.value = String(preset.cols)
  const patch: Record<string, unknown> = {
    animRows: preset.rows,
    animCols: preset.cols
  }
  if (autoMatchAspect.value) {
    patch.imageAspectRatio = preset.aspectRatio
  }
  patchParams(patch)
}

function selectActionPreset(preset: Anim2dPreset): void {
  const isEn = String(locale.value).startsWith('en')
  const promptText = isEn ? preset.promptEn || preset.prompt : preset.prompt
  actionInstruction.value = promptText
  const patch: Record<string, unknown> = {
    animPresetId: preset.id,
    generateInstruction: promptText
  }
  if (preset.recommendedGrid) {
    rowsDraft.value = String(preset.recommendedGrid.rows)
    colsDraft.value = String(preset.recommendedGrid.cols)
    patch.animRows = preset.recommendedGrid.rows
    patch.animCols = preset.recommendedGrid.cols
    if (autoMatchAspect.value) {
      patch.imageAspectRatio = preset.recommendedGrid.aspectRatio
    }
  }
  if (preset.category === 'vfx') {
    if (!styleLock.value) patch.animStyleLock = 'vfx'
    if (!keyColor.value) patch.animKeyColor = 'black'
  } else if (preset.category === 'tile') {
    if (!viewAngle.value) patch.animViewAngle = 'top'
  } else if (preset.id === 'dir8') {
    if (!viewAngle.value) patch.animViewAngle = 'iso'
  }
  patchParams(patch)
}

function persistActionInstruction(): void {
  patchParams({ generateInstruction: actionInstruction.value.trim() })
}

function onRowsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  rowsDraft.value = raw
  const trimmed = raw.trim()
  if (!trimmed) return
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 1) return
  patchParams({ animRows: clampDim(n) })
}

function commitRows(): void {
  const n = Number(rowsDraft.value.trim())
  const next = Number.isFinite(n) && n >= 1 ? clampDim(n) : state.value.rows
  patchParams({ animRows: next })
  rowsDraft.value = String(next)
}

function onRowsBlur(): void {
  rowsFocused.value = false
  commitRows()
}

function onColsInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  colsDraft.value = raw
  const trimmed = raw.trim()
  if (!trimmed) return
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 1) return
  patchParams({ animCols: clampDim(n) })
}

function commitCols(): void {
  const n = Number(colsDraft.value.trim())
  const next = Number.isFinite(n) && n >= 1 ? clampDim(n) : state.value.cols
  patchParams({ animCols: next })
  colsDraft.value = String(next)
}

function onColsBlur(): void {
  colsFocused.value = false
  commitCols()
}

function onViewAngleChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimViewAngle
  patchParams({ animViewAngle: value })
}

function onStyleLockChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimStyleLock
  patchParams({ animStyleLock: value })
}

function onKeyColorChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value as AnimKeyColor
  patchParams({
    animKeyColor: value === 'black' || value === 'white' || value === 'auto' ? value : ''
  })
}

function persistSystemPrompt(): void {
  patchParams({ generateSystemPrompt: systemPrompt.value })
}

/** 删除已生成的输出：清空运行态与该节点的输出参数，便于重新生成 */
function onClearOutput(): void {
  if (!node.value || !hostId.value) return
  const host = graphRunHosts.get(hostId.value)
  if (host && !host.activeRunNodeIds.value.has(node.value.id)) {
    delete host.runStates[node.value.id]
  }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generatedImages: [],
    selectedImageId: '',
    previewDataUrl: undefined,
    previewRelativePath: '',
    animGridImage: undefined
  })
}
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

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 60%, transparent);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-secondary, var(--text));
}

.cat-tabs {
  display: flex;
  gap: 4px;
}

.cat-tab {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.cat-tab.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.chip:hover {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}

.chip small {
  font-size: 10px;
  opacity: 0.78;
}

.config-row {
  display: flex;
  gap: 12px;
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
  width: 72px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.check-row.compact {
  font-size: 11px;
}

.field-note {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.field textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.45;
}

.sheet-calibrator {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--image-checker-bg);
}

.sheet-calibrator img {
  display: block;
  width: 100%;
  height: auto;
  background: var(--image-checker-bg);
}

.grid-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  pointer-events: none;
}

.grid-cell-guide {
  position: relative;
  border: 1px dashed rgba(56, 189, 248, 0.65);
}

.cell-num {
  position: absolute;
  top: 3px;
  left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}

.cell-ground-line {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: 6%;
  height: 1px;
  background: rgba(250, 204, 21, 0.8);
}

.video-extract-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
  padding: 8px;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.upstream-video-preview {
  width: 100%;
  max-height: 160px;
  border-radius: 6px;
  background: #0d0f12;
  object-fit: contain;
}

.extract-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent, #fff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.extract-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ok-text {
  color: var(--success, #22c55e);
}
</style>
