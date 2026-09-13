<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('cutout.title')"
    :z-index="1200"
    :default-width="980"
    :default-height="720"
    :min-width="720"
    :min-height="520"
    body-class="pad-none cutout-body"
    @close="emit('close')"
  >
    <div v-if="open" class="cutout">
      <section class="pane">
        <div class="section-label">
          {{ t('cutout.source') }}
        </div>
        <div class="stage">
          <img v-if="ready && sourceUrl" :src="sourceUrl" alt="" />
          <p v-else-if="sourceLoading || !sourceUrl" class="hint">
            {{ sourceLoading ? t('cutout.loadingSource') : t('cutout.noSource') }}
          </p>
        </div>
        <div class="row">
          <button type="button" class="primary" :disabled="busy || !sourceUrl" @click="analyze">
            {{ busy ? t('cutout.analyzing') : analysis ? t('cutout.rerun') : t('cutout.analyze') }}
          </button>
          <span v-if="analysis" class="hint">{{
            t('cutout.inferenceMs', { ms: analysis.inferenceMs })
          }}</span>
        </div>

        <div class="section-label">
          {{ t('cutout.subjects', { n: instances.length }) }}
        </div>
        <ul v-if="instances.length" class="instances">
          <li v-for="it in instances" :key="it.index">
            <label>
              <input
                type="checkbox"
                :checked="selected.includes(it.index)"
                @change="toggle(it.index)"
              />
              <span>{{ it.labelZh }}</span>
              <span class="conf">{{ Math.round(it.confidence * 100) }}%</span>
            </label>
          </li>
        </ul>
        <p v-else class="hint">
          {{ analysis ? t('cutout.empty') : t('cutout.notAnalyzed') }}
        </p>
      </section>

      <section class="pane">
        <div class="section-label">
          {{ t('cutout.params') }}
        </div>
        <label class="slider">
          <span
            >{{ t('cutout.detectConf') }}<b>{{ Math.round(detectConf * 100) }}%</b></span
          >
          <input
            v-model.number="detectConf"
            type="range"
            min="0.1"
            max="0.9"
            step="0.05"
            @change="analyze"
          />
        </label>
        <label class="slider">
          <span
            >{{ t('cutout.threshold') }}<b>{{ Math.round(threshold * 100) }}%</b></span
          >
          <input v-model.number="threshold" type="range" min="0.1" max="1" step="0.05" />
        </label>
        <label class="slider">
          <span
            >{{ t('cutout.feather') }}<b>{{ feather }}px</b></span
          >
          <input v-model.number="feather" type="range" min="0" max="12" step="1" />
        </label>
        <label class="check">
          <input v-model="cropToSubject" type="checkbox" />
          <span>{{ t('cutout.crop') }}</span>
        </label>

        <div class="section-label">
          {{ t('cutout.result') }}
        </div>
        <div class="stage checker">
          <img v-if="resultUrl" :src="resultUrl" alt="" />
          <p v-else class="hint">
            {{ t('cutout.resultEmpty') }}
          </p>
        </div>
        <div class="row">
          <span v-if="resultUrl" class="hint">{{ resultWidth }}×{{ resultHeight }}</span>
          <button type="button" class="primary" :disabled="!resultUrl" @click="save">
            {{ t('cutout.apply') }}
          </button>
        </div>
        <p v-if="error" class="error">
          {{ error }}
        </p>
        <p class="apply-hint">
          {{ t('cutout.applyHint') }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { normalizeImageCutout, type ImageCutoutState } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { analyzeCutout, renderCutoutPng, type CutoutAnalysis } from '../features/yolo/cutout'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: ImageCutoutState | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { imageCutout: ImageCutoutState; dataUrl?: string }]
}>()

const { t } = useStudioI18n()

/** 源图与节点参数就绪后自动开始识别 */
const ready = computed(() => props.open && !!props.sourceUrl && !props.sourceLoading)

const analysis = ref<CutoutAnalysis | null>(null)
const image = ref<HTMLImageElement | null>(null)
const selected = ref<number[]>([])
const detectConf = ref(0.25)
const threshold = ref(0.5)
const feather = ref(2)
const cropToSubject = ref(true)
const busy = ref(false)
const error = ref('')
const resultUrl = ref('')
const resultWidth = ref(0)
const resultHeight = ref(0)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
/** 渲染请求递增号：快速连续切换时丢弃过期结果并释放其 blob */
let renderToken = 0

const instances = computed(() => analysis.value?.instances ?? [])

/** 每次会话开始前把滑杆参数对准当前节点 imageCutout 参数 */
function applySetup(): void {
  const s = props.setup
  detectConf.value = s?.confThreshold ?? 0.25
  threshold.value = s?.threshold ?? 0.5
  feather.value = s?.feather ?? 2
  cropToSubject.value = s?.cropToSubject ?? true
}

function toggle(index: number): void {
  selected.value = selected.value.includes(index)
    ? selected.value.filter((i) => i !== index)
    : [...selected.value, index]
}

async function render(): Promise<void> {
  const a = analysis.value
  const img = image.value
  if (!a || !img || selected.value.length === 0) {
    resultUrl.value = ''
    resultCanvas.value = null
    return
  }
  const token = ++renderToken
  try {
    const out = await renderCutoutPng({
      image: img,
      analysis: a,
      selected: selected.value,
      threshold: threshold.value,
      feather: feather.value,
      cropToSubject: cropToSubject.value
    })
    if (token !== renderToken) {
      URL.revokeObjectURL(out.url)
      return
    }
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = out.url
    resultWidth.value = out.width
    resultHeight.value = out.height
    resultCanvas.value = out.canvas
    error.value = ''
  } catch (err) {
    if (token !== renderToken) return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function analyze(): Promise<void> {
  if (!props.sourceUrl || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await analyzeCutout({ url: props.sourceUrl }, detectConf.value)
    analysis.value = res.analysis
    image.value = res.image
    // 勾选恢复策略：沿用上次显式勾选；否则按节点 personOnly 语义只留人物；
    // 都不是则全选（与素材一键抠图一致）
    const picked = props.setup?.selected ?? []
    const next = res.analysis.instances
    if (picked.length) {
      selected.value = next.filter((it) => picked.includes(it.index)).map((it) => it.index)
    } else if (props.setup?.personOnly) {
      selected.value = next.filter((it) => it.label === 'person').map((it) => it.index)
    } else {
      selected.value = next.map((it) => it.index)
    }
    render()
  } catch (err) {
    analysis.value = null
    resultUrl.value = ''
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

function save(): void {
  if (!resultCanvas.value || !resultUrl.value) {
    error.value = t('cutout.resultEmpty')
    return
  }
  // 产物随参数一并交还宿主：宿主物化后写回节点，卡片立即显示，无需再手动执行
  const dataUrl = resultCanvas.value.toDataURL('image/png')
  emit('save', {
    imageCutout: normalizeImageCutout({
      confThreshold: detectConf.value,
      threshold: threshold.value,
      feather: feather.value,
      cropToSubject: cropToSubject.value,
      personOnly: false,
      selected: selected.value
    }),
    dataUrl
  })
}

function reset(): void {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  analysis.value = null
  image.value = null
  selected.value = []
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  resultCanvas.value = null
  resultWidth.value = 0
  resultHeight.value = 0
  error.value = ''
}

watch(ready, (ok) => {
  if (!props.open) {
    reset()
    return
  }
  if (!ok) return
  applySetup()
  void analyze()
})

// 参数（阈值/羽化/裁剪/选区）连续变化时合并为一次渲染：
// 全量合成是逐像素 + PNG 编码的重活，无防抖会导致滑块拖动时主线程被反复阻塞。
let renderTimer: ReturnType<typeof setTimeout> | null = null
watch([threshold, feather, cropToSubject, selected], () => {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    void render()
  }, 120)
})
</script>

<style scoped>
.cutout {
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

/* 透明 PNG 棋盘底：wash 叠色跨主题自适应，浅色主题不会糊成一片 */
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

.instances {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.instances label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.instances label:hover {
  background: var(--bg-hover);
}

.conf {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
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
