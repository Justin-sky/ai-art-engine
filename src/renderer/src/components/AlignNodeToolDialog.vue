<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('align.title')"
    :z-index="1200"
    :default-width="980"
    :default-height="720"
    :min-width="720"
    :min-height="520"
    body-class="pad-none align-body"
    @close="emit('close')"
  >
    <div v-if="open" class="align">
      <section class="pane">
        <div class="section-label">
          {{ t('align.source') }}
        </div>
        <div class="stage checker">
          <img v-if="ready && sourceUrl" :src="sourceUrl" alt="" crossorigin="anonymous" />
          <p v-else-if="sourceLoading || !sourceUrl" class="hint">
            {{ sourceLoading ? t('align.loadingSource') : t('align.noSource') }}
          </p>
        </div>
        <p class="apply-hint">
          {{ t('align.sourceHint') }}
        </p>
      </section>

      <section class="pane">
        <div class="section-label">
          {{ t('align.params') }}
        </div>
        <div class="grid2">
          <label class="field">
            <span>{{ t('graph.align.canvasWidth') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="canvasWidth"
              @change="patchCanvas('canvasWidth', $event)"
            />
          </label>
          <label class="field">
            <span>{{ t('graph.align.canvasHeight') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="canvasHeight"
              @change="patchCanvas('canvasHeight', $event)"
            />
          </label>
        </div>

        <label class="field">
          <span>{{ t('graph.align.anchor') }}</span>
          <select :value="anchor" @change="patchAnchor($event)">
            <option value="center">
              {{ t('graph.align.anchorCenter') }}
            </option>
            <option value="ground">
              {{ t('graph.align.anchorGround') }}
            </option>
          </select>
        </label>

        <label class="slider">
          <span>
            {{ t('graph.align.subjectHeight') }}<b>{{ Math.round(contentHeightRatio * 100) }}%</b>
          </span>
          <input v-model.number="contentHeightRatio" type="range" min="0.1" max="1" step="0.05" />
        </label>

        <label v-if="anchor === 'ground'" class="slider">
          <span>
            {{ t('graph.align.groundGap') }}<b>{{ Math.round(groundRatio * 100) }}%</b>
          </span>
          <input v-model.number="groundRatio" type="range" min="0" max="0.5" step="0.01" />
        </label>

        <label class="check">
          <input v-model="fitWithinWidth" type="checkbox" />
          <span>{{ t('graph.align.fitWidth') }}</span>
        </label>

        <div class="section-label">
          {{ t('align.result') }}
        </div>
        <div class="stage checker result-stage">
          <img v-if="resultUrl" :src="resultUrl" alt="" />
          <p v-else class="hint">
            {{ t('align.resultEmpty') }}
          </p>
        </div>
        <div class="row">
          <span v-if="resultUrl" class="hint">{{ resultWidth }}×{{ resultHeight }}</span>
          <button type="button" class="primary" :disabled="!resultUrl || !ready" @click="save">
            {{ t('align.apply') }}
          </button>
        </div>
        <p v-if="error" class="error">
          {{ error }}
        </p>
        <p class="apply-hint">
          {{ t('align.applyHint') }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { normalizeImageAlign, type ImageAlignState } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { composeImageAlignCanvas } from '../features/graph/model/composeImageAlignCanvas'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: ImageAlignState | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { imageAlign: ImageAlignState; dataUrl?: string }]
}>()

const { t } = useStudioI18n()

const ready = computed(() => props.open && !!props.sourceUrl && !props.sourceLoading)

const canvasWidth = ref(1024)
const canvasHeight = ref(1024)
const anchor = ref<'center' | 'ground'>('ground')
const contentHeightRatio = ref(0.9)
const groundRatio = ref(0.06)
const fitWithinWidth = ref(true)

const resultUrl = ref('')
const resultWidth = ref(0)
const resultHeight = ref(0)
const error = ref('')
/** 渲染请求递增号：快速连续调参时丢弃过期结果 */
let renderToken = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null

/** 每次会话开始前把滑杆参数对准当前节点 imageAlign 参数 */
function applySetup(): void {
  const s = props.setup
  canvasWidth.value = s?.canvasWidth ?? 1024
  canvasHeight.value = s?.canvasHeight ?? 1024
  anchor.value = s?.anchor ?? 'ground'
  contentHeightRatio.value = s?.contentHeightRatio ?? 0.9
  groundRatio.value = s?.groundRatio ?? 0.06
  fitWithinWidth.value = s?.fitWithinWidth ?? true
}

function buildState(): ImageAlignState {
  return normalizeImageAlign({
    canvasWidth: canvasWidth.value,
    canvasHeight: canvasHeight.value,
    anchor: anchor.value,
    contentHeightRatio: contentHeightRatio.value,
    groundRatio: groundRatio.value,
    fitWithinWidth: fitWithinWidth.value
  })
}

function patchCanvas(key: 'canvasWidth' | 'canvasHeight', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const clamped = Math.min(8192, Math.max(16, Math.round(raw)))
  if (key === 'canvasWidth') canvasWidth.value = clamped
  else canvasHeight.value = clamped
}

function patchAnchor(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  anchor.value = value === 'center' ? 'center' : 'ground'
}

async function render(): Promise<void> {
  const url = props.sourceUrl?.trim()
  if (!url) {
    resultUrl.value = ''
    resultWidth.value = 0
    resultHeight.value = 0
    error.value = ''
    return
  }
  const token = ++renderToken
  try {
    const out = await composeImageAlignCanvas({ sourceDataUrl: url, state: buildState() })
    if (token !== renderToken) return
    resultUrl.value = out.dataUrl
    resultWidth.value = out.width
    resultHeight.value = out.height
    error.value = ''
  } catch (err) {
    if (token !== renderToken) return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function reset(): void {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  resultUrl.value = ''
  resultWidth.value = 0
  resultHeight.value = 0
  error.value = ''
}

function save(): void {
  if (!resultUrl.value) {
    error.value = t('align.resultEmpty')
    return
  }
  // 产物与参数一起交还宿主：宿主物化后写回节点，卡片立即显示，无需再手动执行
  emit('save', {
    imageAlign: buildState(),
    dataUrl: resultUrl.value
  })
}

watch(
  ready,
  (ok) => {
    if (!props.open) {
      reset()
      return
    }
    if (!ok) return
    applySetup()
    void render()
  },
  { immediate: true }
)

// 参数连续变化时合并为一次渲染：逐像素 alpha 求框 + PNG 编码是重活
watch([canvasWidth, canvasHeight, anchor, contentHeightRatio, groundRatio, fitWithinWidth], () => {
  if (!ready.value) return
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    void render()
  }, 120)
})
</script>

<style scoped>
.align {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.section-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  max-height: 320px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-input);
}

.stage img {
  max-width: 100%;
  max-height: 320px;
  object-fit: contain;
}

.result-stage {
  min-height: 220px;
}

/* 透明 PNG 棋盘底：wash 叠色跨主题自适应 */
.checker {
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

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.field input[type='number'] {
  width: 84px;
}

.field select {
  min-width: 120px;
}

.slider {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.slider span {
  display: flex;
  justify-content: space-between;
}

.slider b {
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row .hint {
  margin-right: auto;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.apply-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--bg-hover);
}

button.primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
