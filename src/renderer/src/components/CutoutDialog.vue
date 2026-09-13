<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="t('cutout.title')"
    :z-index="2200"
    :default-width="980"
    :default-height="720"
    :min-width="720"
    :min-height="520"
    body-class="pad-none cutout-body"
    @close="closeCutoutDialog"
  >
    <div v-if="state.open" class="cutout">
      <section class="pane">
        <div class="section-label">
          {{ t('cutout.source') }}
        </div>
        <div class="stage">
          <img v-if="state.url" :src="state.url" alt="" />
          <p v-else class="hint">
            {{ t('cutout.noSource') }}
          </p>
        </div>
        <div class="row">
          <button type="button" class="primary" :disabled="busy || !state.url" @click="analyze">
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
          <button type="button" class="primary" :disabled="!resultUrl || saving" @click="save">
            {{ saving ? t('cutout.saving') : t('cutout.save') }}
          </button>
        </div>
        <p v-if="error" class="error">
          {{ error }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>

  <SaveAssetDialog
    ref="saveAssetRef"
    :open="saveAssetOpen"
    :default-name="saveAssetDefaultName"
    :title="t('cutout.saveToTitle')"
    :subtitle="t('cutout.saveToSubtitle')"
    :z-index="2400"
    @confirm="onSaveToLibraryConfirm"
    @cancel="saveAssetOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolveCacheOutputRoot } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { closeCutoutDialog, cutoutDialogState } from '../features/yolo/cutoutDialog'
import { analyzeCutout, renderCutoutPng, type CutoutAnalysis } from '../features/yolo/cutout'
import { useProjectStore } from '../stores/project'
import SaveAssetDialog from './SaveAssetDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const state = cutoutDialogState
const project = useProjectStore()

const analysis = ref<CutoutAnalysis | null>(null)
const image = ref<HTMLImageElement | null>(null)
const selected = ref<number[]>([])
const detectConf = ref(0.25)
const threshold = ref(0.5)
const feather = ref(2)
const cropToSubject = ref(true)
const busy = ref(false)
const saving = ref(false)
const error = ref('')
const saveAssetOpen = ref(false)
const saveAssetDefaultName = ref('')
const saveAssetRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const resultUrl = ref('')
const resultWidth = ref(0)
const resultHeight = ref(0)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
/** 渲染请求递增号：快速连续切换时丢弃过期结果并释放其 blob */
let renderToken = 0

const instances = computed(() => analysis.value?.instances ?? [])

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
  if (!state.url || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await analyzeCutout(
      { url: state.url, relativePath: state.relativePath, name: state.name },
      detectConf.value
    )
    analysis.value = res.analysis
    image.value = res.image
    selected.value = res.analysis.instances.map((i) => i.index)
    render()
  } catch (err) {
    analysis.value = null
    resultUrl.value = ''
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

/** 点「保存到资产库」：先弹出选择目标文件夹与命名对话框 */
function save(): void {
  if (saving.value) return
  if (!resultUrl.value) {
    error.value = t('cutout.resultEmpty')
    return
  }
  error.value = ''
  saveAssetDefaultName.value = `${state.name || 'cutout'}-cutout`
  saveAssetOpen.value = true
}

/**
 * 保存对话框确认：先把结果 data URL 落到 Cache 临时文件（不进资产库），
 * 再交由 saveProjectAsset 复制到用户所选文件夹并登记为资产。
 */
async function onSaveToLibraryConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = ''
  saveAssetRef.value?.setSaving(true)
  try {
    const dataUrl = await resultToDataUrl(resultCanvas.value, resultUrl.value)
    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const tmpRel = await window.studio.saveGraphRunMedia({
      dataUrl,
      key: `cutout-${Date.now()}`,
      outputDir: `${cacheRoot}/Cutouts`
    })
    console.log('[cutout] staged to', tmpRel)
    await window.studio.saveProjectAsset({
      relativePath: tmpRel,
      name: payload.name,
      folderId: payload.folderId
    })
    await project.scheduleRefreshLibrary()
    saveAssetOpen.value = false
    closeCutoutDialog()
  } catch (err) {
    saveAssetRef.value?.setError(err instanceof Error ? err.message : String(err))
    console.error('[cutout] save failed', err)
  } finally {
    saving.value = false
  }
}

/**
 * 生成保存用 data URL。
 * 渲染画布仍持有则直接编码（快）；个别场景画布引用可能已丢失
 * （异步渲染竞态等），此时从结果 blob 读回字节，保证保存可用。
 */
async function resultToDataUrl(canvas: HTMLCanvasElement | null, url: string): Promise<string> {
  if (canvas) return canvas.toDataURL('image/png')
  const res = await fetch(url)
  if (!res.ok) throw new Error('YOLO: failed to read result image')
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('YOLO: failed to read result image'))
    reader.readAsDataURL(blob)
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
  saveAssetOpen.value = false
  error.value = ''
}

watch(
  () => state.open,
  (open) => {
    if (!open) {
      reset()
      return
    }
    void analyze()
  }
)

// 参数（阈值/羽化/裁剪/选区）连续变化时合并为一次渲染：
// 全量合成是逐像素 + PNG 编码的重活，无防抖会导致滑块拖动时主线程被反复阻塞，
// 表现为「拖动没反应 / 边缘变化不明显」。
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
