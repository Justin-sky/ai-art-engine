<template>
  <div v-if="node" class="dive-view ui-comp-workbench">
    <header class="wb-topbar">
      <div class="wb-title-block">
        <div class="wb-title-row">
          <h2 class="wb-title">{{ displayTitle }}</h2>
          <span class="wb-count-pill">
            {{ t('graph.uiComponentLib.componentCount', { n: items.length }) }}
          </span>
        </div>
        <span class="wb-subtitle">{{ t('graph.uiComponentLib.workbenchSubtitle') }}</span>
      </div>

      <div class="wb-toolbar-actions">
        <div class="wb-run-wrap">
          <GraphNodeRunControl
            v-if="hasInPort"
            :status="runStatus"
            :is-running="isGraphRunning"
            :blocked="blocked"
            @toggle="toggleRun"
          />
        </div>

        <button
          v-if="items.length || node.params.uiComponentLibSourceHash"
          type="button"
          class="wb-btn"
          @click="forceReextract"
        >
          {{ t('graph.uiComponentLib.reextract') }}
        </button>

        <button
          type="button"
          class="wb-btn primary"
          :disabled="!items.length || exporting"
          @click="exportAllMasters"
        >
          {{ t('graph.uiComponentLib.exportAllPng') }}
        </button>
      </div>
    </header>

    <section class="wb-config-bar">
      <label class="wb-config-field">
        <span class="wb-config-label">{{ t('graph.uiComponentLib.extractMode') }}</span>
        <select class="wb-config-select" :value="extractMode" @change="onExtractModeChange">
          <option value="auto">{{ t('graph.uiComponentLib.extractModeAuto') }}</option>
          <option value="repeated">{{ t('graph.uiComponentLib.extractModeRepeated') }}</option>
          <option value="all-controls">
            {{ t('graph.uiComponentLib.extractModeAllControls') }}
          </option>
        </select>
      </label>

      <label class="wb-config-field" :title="t('graph.layerSplit.visionModelHint')">
        <span class="wb-config-label">{{ t('graph.layerSplit.visionModelLabel') }}</span>
        <select class="wb-config-select" :value="visionSelectionKey" @change="onVisionModelChange">
          <option value="">{{ t('graph.layerSplit.visionModelAuto') }}</option>
          <option v-for="opt in visionModelOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
      </label>

      <div class="wb-config-model-wrap">
        <ImageGenerateModelField
          :open="Boolean(node)"
          :generate-model="node.params.generateModel ?? ''"
          :generate-provider-instance-id="node.params.generateProviderInstanceId ?? ''"
          @change="onModelChange"
        />
      </div>
    </section>

    <div v-if="toastMessage" class="wb-toast" :class="{ error: toastError }">
      {{ toastMessage }}
    </div>

    <div class="wb-body">
      <!-- Left: Component Master Gallery -->
      <aside class="wb-left">
        <div class="wb-filter-bar">
          <input
            v-model.trim="searchQuery"
            type="text"
            class="wb-search"
            :placeholder="t('graph.uiComponentLib.searchPlaceholder')"
          />
          <select v-model="selectedKindFilter" class="wb-select compact">
            <option value="all">{{ t('graph.uiComponentLib.filterAll') }}</option>
            <option v-for="k in availableKinds" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>

        <div v-if="!items.length" class="wb-empty-list">
          <p class="wb-empty-text">{{ t('graph.uiComponentLib.emptyComponents') }}</p>
          <label class="wb-field">
            <span>{{ t('graph.uiComponentLib.extractHintLabel') }}</span>
            <textarea
              class="wb-textarea"
              rows="3"
              :value="node.params.generateInstruction ?? ''"
              :placeholder="t('graph.uiComponentLib.extractHintPlaceholder')"
              @change="onInstructionChange"
            />
          </label>
        </div>

        <div v-else class="wb-master-grid">
          <button
            v-for="item in filteredItems"
            :key="item.id"
            type="button"
            class="wb-master-card"
            :class="{ active: item.id === selectedId, locked: item.locked }"
            @click="selectComponent(item.id)"
          >
            <div class="wb-card-checker">
              <img
                v-if="thumbUrls[item.id]"
                :src="thumbUrls[item.id]"
                :alt="item.name"
                class="wb-card-thumb"
              />
              <span v-else class="wb-card-placeholder">🧩</span>
              <span v-if="item.locked" class="wb-lock-badge">🔒</span>
              <span v-if="(item.sourceCount ?? 1) > 1" class="wb-fuse-badge">
                {{ t('graph.uiComponentLib.sourceInstances', { n: item.sourceCount }) }}
              </span>
            </div>
            <div class="wb-card-meta">
              <div class="wb-card-name" :title="item.name">{{ item.name }}</div>
              <div class="wb-card-sub">
                <span class="mono">{{ item.canonicalWidth }}×{{ item.canonicalHeight }}</span>
                <span class="wb-policy-pill">{{ scalePolicyLabel(item.scalePolicy) }}</span>
              </div>
            </div>
          </button>
        </div>
      </aside>

      <!-- Center: Master 9-Slice Stage + Live Stretch Simulator -->
      <main class="wb-center">
        <template v-if="selectedItem">
          <section class="wb-stage-panel">
            <div class="wb-panel-head">
              <span class="wb-panel-title">{{ t('graph.uiComponentLib.masterStageTitle') }}</span>
              <div class="wb-zoom-pills">
                <button
                  type="button"
                  class="wb-pill-btn"
                  :class="{ active: masterZoom === 0 }"
                  @click="masterZoom = 0"
                >
                  {{ t('graph.uiComponentLib.zoomFit') }}
                </button>
                <button
                  v-for="z in [1, 2, 3]"
                  :key="z"
                  type="button"
                  class="wb-pill-btn"
                  :class="{ active: masterZoom === z }"
                  @click="masterZoom = z"
                >
                  {{ z }}×
                </button>
              </div>
            </div>

            <div class="wb-checker-stage">
              <div v-if="selectedThumbUrl" class="wb-master-frame" :style="masterFrameStyle">
                <img
                  :src="selectedThumbUrl"
                  :alt="selectedItem.name"
                  class="wb-master-img"
                  draggable="false"
                />
                <svg
                  v-if="selectedItem.scalePolicy === 'nine-slice'"
                  class="wb-nineslice-overlay"
                  :viewBox="`0 0 ${Math.max(1, selectedItem.canonicalWidth)} ${Math.max(1, selectedItem.canonicalHeight)}`"
                  preserveAspectRatio="none"
                >
                  <line
                    x1="0"
                    :y1="effectiveBorders[0]"
                    :x2="selectedItem.canonicalWidth"
                    :y2="effectiveBorders[0]"
                    class="ns-line"
                  />
                  <line
                    x1="0"
                    :y1="Math.max(0, selectedItem.canonicalHeight - effectiveBorders[2])"
                    :x2="selectedItem.canonicalWidth"
                    :y2="Math.max(0, selectedItem.canonicalHeight - effectiveBorders[2])"
                    class="ns-line"
                  />
                  <line
                    :x1="effectiveBorders[3]"
                    y1="0"
                    :x2="effectiveBorders[3]"
                    :y2="selectedItem.canonicalHeight"
                    class="ns-line"
                  />
                  <line
                    :x1="Math.max(0, selectedItem.canonicalWidth - effectiveBorders[1])"
                    y1="0"
                    :x2="Math.max(0, selectedItem.canonicalWidth - effectiveBorders[1])"
                    :y2="selectedItem.canonicalHeight"
                    class="ns-line"
                  />
                </svg>
              </div>
            </div>
          </section>

          <section class="wb-sim-panel">
            <div class="wb-panel-head">
              <span class="wb-panel-title">{{ t('graph.uiComponentLib.stretchSimTitle') }}</span>
              <div class="wb-zoom-pills">
                <button type="button" class="wb-pill-btn" @click="applySimPreset(1, 1)">
                  {{ t('graph.uiComponentLib.preset1x') }}
                </button>
                <button type="button" class="wb-pill-btn" @click="applySimPreset(1.8, 1)">
                  {{ t('graph.uiComponentLib.presetWideBtn') }}
                </button>
                <button type="button" class="wb-pill-btn" @click="applySimPreset(2.5, 1)">
                  {{ t('graph.uiComponentLib.presetBanner') }}
                </button>
                <button type="button" class="wb-pill-btn" @click="applySimPreset(2, 2)">
                  {{ t('graph.uiComponentLib.presetPanel') }}
                </button>
              </div>
            </div>

            <div class="wb-sim-sliders">
              <label class="wb-slider-item">
                <span>{{ t('graph.uiComponentLib.stretchWidth') }}</span>
                <input v-model.number="simScaleX" type="range" min="0.6" max="3.2" step="0.05" />
                <b class="mono">{{ simTargetWidth }}px ({{ simScaleX.toFixed(2) }}×)</b>
              </label>
              <label class="wb-slider-item">
                <span>{{ t('graph.uiComponentLib.stretchHeight') }}</span>
                <input v-model.number="simScaleY" type="range" min="0.6" max="2.8" step="0.05" />
                <b class="mono">{{ simTargetHeight }}px ({{ simScaleY.toFixed(2) }}×)</b>
              </label>
            </div>

            <div class="wb-checker-stage sim-stage">
              <canvas ref="simCanvasRef" class="wb-sim-canvas" />
            </div>
          </section>
        </template>

        <div v-else class="wb-center-empty">
          {{
            items.length
              ? t('graph.uiComponentLib.selectComponentHint')
              : t('graph.uiComponentLib.emptyComponents')
          }}
        </div>
      </main>

      <!-- Right: Component Properties & Smart Object Lineage -->
      <aside class="wb-right">
        <template v-if="selectedItem">
          <div class="wb-prop-group">
            <label class="wb-field">
              <span>{{ t('graph.uiComponentLib.propName') }}</span>
              <input
                type="text"
                class="wb-input"
                :value="selectedItem.name"
                @change="onSelectedNameChange"
              />
            </label>

            <label class="wb-field">
              <span>{{ t('graph.uiComponentLib.propExportName') }}</span>
              <input
                type="text"
                class="wb-input mono"
                :value="selectedItem.exportName"
                :placeholder="t('graph.uiComponentLib.exportNamePlaceholder')"
                @change="onSelectedExportNameChange"
              />
            </label>

            <label class="wb-field">
              <span>{{ t('graph.uiComponentLib.propKind') }}</span>
              <select class="wb-select" :value="selectedItem.kind" @change="onSelectedKindChange">
                <option v-for="k in KIND_OPTIONS" :key="k" :value="k">{{ k }}</option>
              </select>
            </label>

            <label class="wb-field">
              <span>{{ t('graph.uiComponentLib.propScalePolicy') }}</span>
              <select
                class="wb-select"
                :value="selectedItem.scalePolicy"
                @change="onSelectedScalePolicyChange"
              >
                <option value="exact">{{ t('graph.uiComponentLib.scaleExact') }}</option>
                <option value="uniform">{{ t('graph.uiComponentLib.scaleUniform') }}</option>
                <option value="nine-slice">{{ t('graph.uiComponentLib.scaleNineSlice') }}</option>
              </select>
            </label>
          </div>

          <div v-if="selectedItem.scalePolicy === 'nine-slice'" class="wb-prop-group">
            <div class="wb-group-head">
              <span>{{ t('graph.uiComponentLib.nineSliceTitle') }}</span>
              <button type="button" class="wb-link-btn" @click="autoDetectSelectedNineSlice">
                {{ t('graph.uiComponentLib.autoDetectNineSlice') }}
              </button>
            </div>
            <div class="wb-ns-grid">
              <label class="wb-field">
                <span>{{ t('graph.uiComponentLib.nineSliceTop') }}</span>
                <input
                  type="number"
                  min="0"
                  :max="Math.max(0, Math.floor(selectedItem.canonicalHeight / 2) - 1)"
                  class="wb-input mono"
                  :value="effectiveBorders[0]"
                  @change="onBorderInput(0, $event)"
                />
              </label>
              <label class="wb-field">
                <span>{{ t('graph.uiComponentLib.nineSliceRight') }}</span>
                <input
                  type="number"
                  min="0"
                  :max="Math.max(0, Math.floor(selectedItem.canonicalWidth / 2) - 1)"
                  class="wb-input mono"
                  :value="effectiveBorders[1]"
                  @change="onBorderInput(1, $event)"
                />
              </label>
              <label class="wb-field">
                <span>{{ t('graph.uiComponentLib.nineSliceBottom') }}</span>
                <input
                  type="number"
                  min="0"
                  :max="Math.max(0, Math.floor(selectedItem.canonicalHeight / 2) - 1)"
                  class="wb-input mono"
                  :value="effectiveBorders[2]"
                  @change="onBorderInput(2, $event)"
                />
              </label>
              <label class="wb-field">
                <span>{{ t('graph.uiComponentLib.nineSliceLeft') }}</span>
                <input
                  type="number"
                  min="0"
                  :max="Math.max(0, Math.floor(selectedItem.canonicalWidth / 2) - 1)"
                  class="wb-input mono"
                  :value="effectiveBorders[3]"
                  @change="onBorderInput(3, $event)"
                />
              </label>
            </div>
          </div>

          <div class="wb-prop-group">
            <div class="wb-group-head">
              <span>{{ t('graph.uiComponentLib.smartObjectGuidLabel') }}</span>
              <button type="button" class="wb-link-btn" @click="copyGuid(selectedItem.psdGuid)">
                {{
                  copiedGuidId === selectedItem.id
                    ? t('graph.uiComponentLib.copiedGuid')
                    : t('graph.uiComponentLib.copyGuid')
                }}
              </button>
            </div>
            <div class="wb-guid-box mono">{{ selectedItem.psdGuid }}</div>
          </div>

          <div class="wb-prop-actions">
            <button
              type="button"
              class="wb-btn"
              :class="{ active: selectedItem.locked }"
              @click="toggleLock(selectedItem.id)"
            >
              {{
                selectedItem.locked
                  ? `🔒 ${t('graph.uiComponentLib.unlockItem')}`
                  : `🔓 ${t('graph.uiComponentLib.lockItem')}`
              }}
            </button>

            <button
              type="button"
              class="wb-btn"
              :disabled="!selectedThumbUrl || exporting"
              @click="exportSingleMaster(selectedItem)"
            >
              {{ t('graph.uiComponentLib.exportSinglePng') }}
            </button>

            <button type="button" class="wb-btn danger" @click="removeItem(selectedItem.id)">
              {{ t('graph.uiComponentLib.removeItem') }}
            </button>
          </div>
        </template>

        <div class="wb-prop-group">
          <label class="wb-field">
            <span>{{ t('graph.uiComponentLib.extractHintLabel') }}</span>
            <textarea
              class="wb-textarea"
              rows="3"
              :value="node.params.generateInstruction ?? ''"
              :placeholder="t('graph.uiComponentLib.extractHintPlaceholder')"
              @change="onInstructionChange"
            />
          </label>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  computeNineSliceFromRgbaBuffer,
  decodeBase64ToUint8,
  emptyUiComponentLibrary,
  parseUiComponentLibrary,
  sanitizeComponentExportName,
  stringifyUiComponentLibrary,
  type UiComponentLibrary,
  type UiComponentScalePolicy,
  type UiSharedComponentItem
} from '@shared/graph'
import GraphNodeRunControl from '../GraphNodeRunControl.vue'
import ImageGenerateModelField from '../ImageGenerateModelField.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../../composables/useGraphNodeRun'
import {
  loadVisionModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../../features/graph/model/generateModelOptions'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'

const KIND_OPTIONS = [
  'button',
  'close-button',
  'item-slot',
  'tab',
  'badge',
  'frame',
  'panel',
  'banner',
  'card',
  'progress-bar',
  'slider',
  'icon',
  'other'
] as const

const props = defineProps<{
  frameKey?: string
  hostId: string
  nodeId: string
}>()

const { t, graphTypeLabel } = useStudioI18n()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'ui.componentLib' ? current : null
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(
  node,
  () => props.hostId
)
const typeLabel = computed(() => graphTypeLabel('ui.componentLib'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const extractMode = computed(() => {
  const raw = node.value?.params.uiComponentExtractMode
  return raw === 'repeated' || raw === 'all-controls' ? raw : 'auto'
})

const library = computed<UiComponentLibrary>(
  () =>
    parseUiComponentLibrary(node.value?.params.uiComponentLibrary ?? '') ??
    emptyUiComponentLibrary()
)
const items = computed<UiSharedComponentItem[]>(() => library.value.items)

const thumbUrls = reactive<Record<string, string>>({})
const visionModelOptions = ref<GenerateModelOption[]>([])
const visionSelectionKey = ref('')
const selectedId = ref('')
const searchQuery = ref('')
const selectedKindFilter = ref('all')
const masterZoom = ref<number>(0)
const simScaleX = ref<number>(1.8)
const simScaleY = ref<number>(1.0)
const simCanvasRef = ref<HTMLCanvasElement | null>(null)
const exporting = ref(false)
const toastMessage = ref('')
const toastError = ref(false)
const copiedGuidId = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function flashToast(msg: string, isErr = false): void {
  toastMessage.value = msg
  toastError.value = isErr
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 3200)
}

const availableKinds = computed<string[]>(() => {
  const s = new Set<string>()
  for (const item of items.value) {
    if (item.kind?.trim()) s.add(item.kind.trim())
  }
  return [...s]
})

const filteredItems = computed<UiSharedComponentItem[]>(() => {
  const q = searchQuery.value.toLowerCase()
  return items.value.filter((item) => {
    if (selectedKindFilter.value !== 'all' && item.kind !== selectedKindFilter.value) {
      return false
    }
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.exportName.toLowerCase().includes(q) ||
      item.kind.toLowerCase().includes(q)
    )
  })
})

const selectedItem = computed<UiSharedComponentItem | null>(
  () => items.value.find((i) => i.id === selectedId.value) ?? items.value[0] ?? null
)

watch(
  items,
  (list) => {
    if (!list.length) {
      selectedId.value = ''
      return
    }
    if (!list.some((i) => i.id === selectedId.value)) {
      selectedId.value = list[0]!.id
    }
  },
  { immediate: true }
)

const selectedThumbUrl = computed(() =>
  selectedItem.value ? (thumbUrls[selectedItem.value.id] ?? '') : ''
)

const effectiveBorders = computed<[number, number, number, number]>(() => {
  const item = selectedItem.value
  if (!item) return [0, 0, 0, 0]
  if (item.nineSliceBorders && item.nineSliceBorders.length === 4) {
    return item.nineSliceBorders
  }
  const bx = Math.max(2, Math.floor(item.canonicalWidth * 0.25))
  const by = Math.max(2, Math.floor(item.canonicalHeight * 0.25))
  return [by, bx, by, bx]
})

const masterFrameStyle = computed(() => {
  const item = selectedItem.value
  if (!item) return {}
  if (masterZoom.value > 0) {
    return {
      width: `${Math.max(1, item.canonicalWidth * masterZoom.value)}px`,
      height: `${Math.max(1, item.canonicalHeight * masterZoom.value)}px`
    }
  }
  const maxSide = 240
  const ratio = Math.min(
    maxSide / Math.max(1, item.canonicalWidth),
    maxSide / Math.max(1, item.canonicalHeight),
    2.5
  )
  return {
    width: `${Math.max(16, Math.round(item.canonicalWidth * ratio))}px`,
    height: `${Math.max(16, Math.round(item.canonicalHeight * ratio))}px`
  }
})

const simTargetWidth = computed(() =>
  Math.max(12, Math.round((selectedItem.value?.canonicalWidth ?? 64) * simScaleX.value))
)
const simTargetHeight = computed(() =>
  Math.max(12, Math.round((selectedItem.value?.canonicalHeight ?? 32) * simScaleY.value))
)

function scalePolicyLabel(policy: UiComponentScalePolicy): string {
  if (policy === 'nine-slice') return t('graph.uiComponentLib.scaleNineSlice')
  if (policy === 'exact') return t('graph.uiComponentLib.scaleExact')
  return t('graph.uiComponentLib.scaleUniform')
}

function selectComponent(id: string): void {
  selectedId.value = id
}

function applySimPreset(sx: number, sy: number): void {
  simScaleX.value = sx
  simScaleY.value = sy
}

async function refreshThumbUrls(): Promise<void> {
  const current = node.value
  if (!current) return
  const genById = new Map<string, { dataUrl?: string; relativePath?: string }>()
  for (const g of current.params.generatedImages ?? []) {
    if (g.id?.trim()) genById.set(g.id.trim(), g)
  }
  for (const item of items.value) {
    if (item.imageUrl?.startsWith('data:')) {
      thumbUrls[item.id] = item.imageUrl
      continue
    }
    const gen = item.imageId ? genById.get(item.imageId) : undefined
    if (gen?.dataUrl?.startsWith('data:')) {
      thumbUrls[item.id] = gen.dataUrl
      continue
    }
    const rel = item.imageRelativePath?.trim() || gen?.relativePath?.trim() || ''
    if (rel) {
      const url = await window.studio.getAssetFileUrl(rel).catch(() => '')
      if (url) thumbUrls[item.id] = url
    }
  }
}

watch(
  () => [
    node.value?.id ?? '',
    node.value?.params.uiComponentLibrary ?? '',
    node.value?.params.generatedImages?.length ?? 0
  ],
  () => {
    void refreshThumbUrls()
  },
  { immediate: true }
)

async function refreshVisionModels(): Promise<void> {
  const current = node.value
  if (!current) {
    visionModelOptions.value = []
    visionSelectionKey.value = ''
    return
  }
  const preferred = preferredModelKey(
    current.params.visionProviderInstanceId,
    current.params.visionModel
  )
  const { options, selectedKey } = await loadVisionModelOptions(preferred)
  visionModelOptions.value = options
  visionSelectionKey.value = selectedKey
}

watch(
  () => [
    node.value?.id ?? '',
    node.value?.params.visionProviderInstanceId ?? '',
    node.value?.params.visionModel ?? ''
  ],
  () => {
    void refreshVisionModels()
  },
  { immediate: true }
)

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

async function renderStretchSimulation(): Promise<void> {
  await nextTick()
  const canvas = simCanvasRef.value
  const item = selectedItem.value
  const url = selectedThumbUrl.value
  if (!canvas || !item || !url) return
  const img = await loadImageElement(url)
  if (!img) return

  const sw = Math.max(1, img.naturalWidth || item.canonicalWidth)
  const sh = Math.max(1, img.naturalHeight || item.canonicalHeight)
  const dw = simTargetWidth.value
  const dh = simTargetHeight.value
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (item.scalePolicy === 'exact') {
    const ox = Math.round((dw - sw) / 2)
    const oy = Math.round((dh - sh) / 2)
    ctx.drawImage(img, ox, oy, sw, sh)
    return
  }

  if (item.scalePolicy === 'uniform') {
    const scale = Math.min(dw / sw, dh / sh)
    const rw = Math.max(1, Math.round(sw * scale))
    const rh = Math.max(1, Math.round(sh * scale))
    const ox = Math.round((dw - rw) / 2)
    const oy = Math.round((dh - rh) / 2)
    ctx.drawImage(img, ox, oy, rw, rh)
    return
  }

  // 9-Slice live canvas composition
  const [rawT, rawR, rawB, rawL] = effectiveBorders.value
  const l = Math.min(Math.max(0, Math.round(rawL)), Math.floor(sw / 2) - 1, Math.floor(dw / 2))
  const r = Math.min(Math.max(0, Math.round(rawR)), Math.floor(sw / 2) - 1, Math.floor(dw / 2))
  const top = Math.min(Math.max(0, Math.round(rawT)), Math.floor(sh / 2) - 1, Math.floor(dh / 2))
  const bot = Math.min(Math.max(0, Math.round(rawB)), Math.floor(sh / 2) - 1, Math.floor(dh / 2))

  const scw = Math.max(1, sw - l - r)
  const sch = Math.max(1, sh - top - bot)
  const dcw = Math.max(0, dw - l - r)
  const dch = Math.max(0, dh - top - bot)

  const slices: Array<[number, number, number, number, number, number, number, number]> = [
    // Corners
    [0, 0, l, top, 0, 0, l, top],
    [sw - r, 0, r, top, dw - r, 0, r, top],
    [0, sh - bot, l, bot, 0, dh - bot, l, bot],
    [sw - r, sh - bot, r, bot, dw - r, dh - bot, r, bot],
    // Edges
    [l, 0, scw, top, l, 0, dcw, top],
    [l, sh - bot, scw, bot, l, dh - bot, dcw, bot],
    [0, top, l, sch, 0, top, l, dch],
    [sw - r, top, r, sch, dw - r, top, r, dch],
    // Center
    [l, top, scw, sch, l, top, dcw, dch]
  ]
  for (const [sx, sy, sW, sH, dx, dy, dW, dH] of slices) {
    if (sW > 0 && sH > 0 && dW > 0 && dH > 0) {
      ctx.drawImage(img, sx, sy, sW, sH, dx, dy, dW, dH)
    }
  }
}

watch(
  () => [
    selectedItem.value?.id ?? '',
    selectedItem.value?.scalePolicy ?? '',
    effectiveBorders.value.join(','),
    selectedThumbUrl.value,
    simScaleX.value,
    simScaleY.value
  ],
  () => {
    void renderStretchSimulation()
  },
  { immediate: true }
)

function persistLibrary(
  nextItems: UiSharedComponentItem[],
  extraPatch?: Record<string, unknown>
): void {
  const current = node.value
  if (!current || !props.hostId) return
  const nextDoc: UiComponentLibrary = {
    ...library.value,
    items: nextItems,
    updatedAt: new Date().toISOString()
  }
  graphEditorHosts.updateNode(props.hostId, current.id, {
    uiComponentLibrary: stringifyUiComponentLibrary(nextDoc),
    ...(extraPatch ?? {})
  })
}

function updateItem(
  itemId: string,
  updater: (item: UiSharedComponentItem) => UiSharedComponentItem
): void {
  persistLibrary(items.value.map((item) => (item.id === itemId ? updater(item) : item)))
}

function onExtractModeChange(event: Event): void {
  const current = node.value
  if (!current || !props.hostId) return
  const val = (event.target as HTMLSelectElement).value
  const mode = val === 'repeated' || val === 'all-controls' ? val : 'auto'
  graphEditorHosts.updateNode(props.hostId, current.id, {
    uiComponentExtractMode: mode,
    uiComponentLibSourceHash: ''
  })
}

function onVisionModelChange(event: Event): void {
  const current = node.value
  if (!current || !props.hostId) return
  const key = (event.target as HTMLSelectElement).value
  visionSelectionKey.value = key
  if (!key) {
    graphEditorHosts.updateNode(props.hostId, current.id, {
      visionModel: '',
      visionProviderInstanceId: '',
      uiComponentLibSourceHash: ''
    })
    return
  }
  const opt = visionModelOptions.value.find((o) => o.key === key)
  if (!opt) return
  graphEditorHosts.updateNode(props.hostId, current.id, {
    visionModel: opt.model,
    visionProviderInstanceId: opt.providerInstanceId,
    uiComponentLibSourceHash: ''
  })
}

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const current = node.value
  if (!current || !props.hostId) return
  const prevModel = current.params.generateModel ?? ''
  const prevProvider = current.params.generateProviderInstanceId ?? ''
  if (prevModel === payload.generateModel && prevProvider === payload.generateProviderInstanceId) {
    return
  }
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generateModel: payload.generateModel,
    generateProviderInstanceId: payload.generateProviderInstanceId,
    uiComponentLibSourceHash: ''
  })
}

function onInstructionChange(event: Event): void {
  const current = node.value
  if (!current || !props.hostId) return
  graphEditorHosts.updateNode(props.hostId, current.id, {
    generateInstruction: (event.target as HTMLTextAreaElement).value,
    uiComponentLibSourceHash: ''
  })
}

function onSelectedNameChange(event: Event): void {
  const cur = selectedItem.value
  const nextName = (event.target as HTMLInputElement).value.trim()
  if (!cur || !nextName) return
  updateItem(cur.id, (item) => ({ ...item, name: nextName }))
}

function onSelectedExportNameChange(event: Event): void {
  const cur = selectedItem.value
  if (!cur) return
  const raw = (event.target as HTMLInputElement).value.trim()
  const idx = items.value.findIndex((i) => i.id === cur.id)
  const sanitized = sanitizeComponentExportName(raw, idx + 1)
  updateItem(cur.id, (item) => ({ ...item, exportName: sanitized }))
}

function onSelectedKindChange(event: Event): void {
  const cur = selectedItem.value
  if (!cur) return
  const kind = (event.target as HTMLSelectElement).value.trim() || 'other'
  updateItem(cur.id, (item) => ({ ...item, kind }))
}

function onSelectedScalePolicyChange(event: Event): void {
  const cur = selectedItem.value
  if (!cur) return
  const val = (event.target as HTMLSelectElement).value
  const policy: UiComponentScalePolicy = val === 'exact' || val === 'nine-slice' ? val : 'uniform'
  updateItem(cur.id, (item) => ({
    ...item,
    scalePolicy: policy,
    nineSliceBorders:
      policy === 'nine-slice'
        ? (item.nineSliceBorders ?? effectiveBorders.value)
        : item.nineSliceBorders
  }))
}

function onBorderInput(index: 0 | 1 | 2 | 3, event: Event): void {
  const cur = selectedItem.value
  if (!cur) return
  const raw = Math.max(0, Math.round(Number((event.target as HTMLInputElement).value) || 0))
  const maxHalf =
    index === 0 || index === 2
      ? Math.max(0, Math.floor(cur.canonicalHeight / 2) - 1)
      : Math.max(0, Math.floor(cur.canonicalWidth / 2) - 1)
  const clamped = Math.min(raw, maxHalf)
  const next: [number, number, number, number] = [...effectiveBorders.value]
  next[index] = clamped
  updateItem(cur.id, (item) => ({
    ...item,
    scalePolicy: 'nine-slice',
    nineSliceBorders: next
  }))
}

async function autoDetectSelectedNineSlice(): Promise<void> {
  const cur = selectedItem.value
  const url = selectedThumbUrl.value
  if (!cur || !url) return
  const img = await loadImageElement(url)
  if (!img) return
  const w = Math.max(1, img.naturalWidth || cur.canonicalWidth)
  const h = Math.max(1, img.naturalHeight || cur.canonicalHeight)
  const offscreen = document.createElement('canvas')
  offscreen.width = w
  offscreen.height = h
  const ctx = offscreen.getContext('2d')
  if (!ctx) return
  ctx.drawImage(img, 0, 0, w, h)
  const rgba = ctx.getImageData(0, 0, w, h).data
  const detected = computeNineSliceFromRgbaBuffer(rgba, w, h)
  if (detected) {
    updateItem(cur.id, (item) => ({
      ...item,
      scalePolicy: 'nine-slice',
      nineSliceBorders: detected
    }))
    flashToast(t('graph.uiComponentLib.autoDetectSuccess', { borders: detected.join(' / ') }))
  } else {
    const fallback: [number, number, number, number] = [
      Math.max(2, Math.floor(h * 0.25)),
      Math.max(2, Math.floor(w * 0.25)),
      Math.max(2, Math.floor(h * 0.25)),
      Math.max(2, Math.floor(w * 0.25))
    ]
    updateItem(cur.id, (item) => ({
      ...item,
      scalePolicy: 'nine-slice',
      nineSliceBorders: fallback
    }))
    flashToast(t('graph.uiComponentLib.autoDetectFallback'))
  }
}

function toggleLock(itemId: string): void {
  updateItem(itemId, (item) => ({ ...item, locked: !item.locked }))
}

function removeItem(itemId: string): void {
  delete thumbUrls[itemId]
  persistLibrary(items.value.filter((item) => item.id !== itemId))
}

function forceReextract(): void {
  const lockedOnly = items.value.filter((item) => item.locked)
  persistLibrary(lockedOnly, { uiComponentLibSourceHash: '' })
}

async function copyGuid(guid: string): Promise<void> {
  const cur = selectedItem.value
  if (!cur || !guid) return
  try {
    await navigator.clipboard.writeText(guid)
    copiedGuidId.value = cur.id
    setTimeout(() => {
      if (copiedGuidId.value === cur.id) copiedGuidId.value = ''
    }, 1500)
  } catch {
    // Ignore clipboard permission failure
  }
}

async function itemToPngBytes(item: UiSharedComponentItem): Promise<Uint8Array | null> {
  const url = thumbUrls[item.id] || item.imageUrl || ''
  if (!url) return null
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma >= 0) return decodeBase64ToUint8(url.slice(comma + 1))
  }
  const img = await loadImageElement(url)
  if (!img) return null
  const c = document.createElement('canvas')
  c.width = Math.max(1, img.naturalWidth || item.canonicalWidth)
  c.height = Math.max(1, img.naturalHeight || item.canonicalHeight)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const dataUrl = c.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? decodeBase64ToUint8(dataUrl.slice(comma + 1)) : null
}

async function exportSingleMaster(item: UiSharedComponentItem): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    const bytes = await itemToPngBytes(item)
    if (!bytes?.length) return
    const saved = await window.studio.saveBinaryFile({
      data: bytes,
      defaultPath: `${item.exportName || item.id}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (saved) flashToast(t('graph.uiComponentLib.exportedToast', { n: 1 }))
  } finally {
    exporting.value = false
  }
}

async function exportAllMasters(): Promise<void> {
  if (exporting.value || !items.value.length) return
  exporting.value = true
  try {
    const files: Array<{ fileName: string; data: Uint8Array }> = []
    for (const [idx, item] of items.value.entries()) {
      const bytes = await itemToPngBytes(item)
      if (!bytes?.length) continue
      const safeName = sanitizeComponentExportName(item.exportName || item.name, idx + 1)
      files.push({ fileName: `${safeName}.png`, data: bytes })
    }
    if (!files.length) return
    const res = await window.studio.saveBinaryFilesToDirectory({ files })
    if (res?.written) {
      flashToast(t('graph.uiComponentLib.exportedToast', { n: res.written }))
    }
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.ui-comp-workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--text);
}

.wb-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-wrap: wrap;
}

.wb-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wb-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wb-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.wb-count-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.16);
  color: var(--accent, #818cf8);
}

.wb-subtitle {
  font-size: 11px;
  color: var(--text-muted);
}

.wb-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.wb-run-wrap :deep(.run-control) {
  margin: 0;
}

.wb-config-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

@media (max-width: 860px) {
  .wb-config-bar {
    grid-template-columns: 1fr;
  }
}

.wb-config-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.wb-config-label {
  font-size: 12px;
  color: var(--text-muted);
}

.wb-config-select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
  text-overflow: ellipsis;
}

.wb-config-model-wrap {
  min-width: 0;
}

.wb-config-model-wrap :deep(.model-field) {
  min-width: 0;
  gap: 6px;
}

.wb-config-model-wrap :deep(.label) {
  font-size: 12px;
  color: var(--text-muted);
}

.wb-config-model-wrap :deep(.select) {
  border-radius: 8px;
  background: var(--bg);
  padding: 8px 10px;
  font-size: 12px;
}

.wb-toast {
  padding: 6px 16px;
  font-size: 12px;
  background: rgba(16, 185, 129, 0.14);
  color: #34d399;
  border-bottom: 1px solid rgba(16, 185, 129, 0.3);
}

.wb-toast.error {
  background: rgba(239, 68, 68, 0.14);
  color: #f87171;
  border-bottom-color: rgba(239, 68, 68, 0.3);
}

.wb-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr) 290px;
}

.wb-left {
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-elevated);
}

.wb-filter-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}

.wb-search,
.wb-input,
.wb-select,
.wb-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  color: var(--text);
  padding: 6px 9px;
  font-size: 12px;
}

.wb-toolbar-actions .wb-select {
  width: auto;
  max-width: 240px;
}

.wb-empty-list {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wb-empty-text {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.wb-master-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  align-content: start;
}

.wb-master-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.wb-master-card:hover {
  border-color: rgba(129, 140, 248, 0.55);
}

.wb-master-card.active {
  border-color: var(--accent, #818cf8);
  box-shadow: 0 0 0 1px var(--accent, #818cf8);
}

.wb-card-checker,
.wb-checker-stage {
  background-color: #1c1f26;
  background-image:
    linear-gradient(45deg, #272b35 25%, transparent 25%),
    linear-gradient(-45deg, #272b35 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #272b35 75%),
    linear-gradient(-45deg, transparent 75%, #272b35 75%);
  background-size: 14px 14px;
  background-position:
    0 0,
    0 7px,
    7px -7px,
    -7px 0;
}

.wb-card-checker {
  position: relative;
  height: 76px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 4px;
}

.wb-card-thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.wb-card-placeholder {
  font-size: 20px;
  opacity: 0.6;
}

.wb-lock-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 11px;
}

.wb-fuse-badge {
  position: absolute;
  bottom: 4px;
  right: 4px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.82);
  color: #fbbf24;
}

.wb-card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wb-card-name {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wb-card-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-muted);
}

.wb-policy-pill {
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(129, 140, 248, 0.14);
  color: var(--accent, #818cf8);
}

.wb-center {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-height: 0;
  overflow-y: auto;
}

.wb-stage-panel,
.wb-sim-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wb-sim-panel {
  flex: 1;
  min-height: 240px;
}

.wb-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.wb-panel-title {
  font-size: 12px;
  font-weight: 600;
}

.wb-zoom-pills {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.wb-pill-btn {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
}

.wb-pill-btn:hover,
.wb-pill-btn.active {
  color: var(--text);
  border-color: var(--accent, #818cf8);
}

.wb-checker-stage {
  min-height: 210px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  overflow: auto;
}

.sim-stage {
  flex: 1;
}

.wb-master-frame {
  position: relative;
  display: inline-flex;
  box-shadow: 0 0 0 1px var(--border);
}

.wb-master-img {
  width: 100%;
  height: 100%;
  object-fit: fill;
  image-rendering: pixelated;
}

.wb-nineslice-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ns-line {
  stroke: #22d3ee;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 4 3;
}

.wb-sim-sliders {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}

.wb-slider-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wb-slider-item input[type='range'] {
  flex: 1;
}

.wb-sim-canvas {
  max-width: 100%;
  height: auto;
}

.wb-center-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.wb-right {
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  min-height: 0;
}

.wb-prop-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.wb-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
}

.wb-link-btn {
  border: none;
  background: transparent;
  color: var(--accent, #818cf8);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.wb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.wb-ns-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.wb-guid-box {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 11px;
  word-break: break-all;
  color: var(--text-muted);
}

.wb-prop-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wb-btn {
  padding: 7px 12px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.wb-btn:hover:not(:disabled) {
  border-color: var(--accent, #818cf8);
}

.wb-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wb-btn.primary {
  background: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  color: #fff;
}

.wb-btn.danger {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.35);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
