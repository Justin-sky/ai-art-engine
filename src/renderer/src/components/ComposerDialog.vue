<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="t('compose.title')"
    :z-index="2200"
    :default-width="1120"
    :default-height="720"
    :min-width="860"
    :min-height="560"
    body-class="pad-none compose-body"
    @close="closeComposerDialog"
  >
    <div
      v-if="state.open"
      class="compose"
    >
      <section class="pane">
        <div class="section-label">
          {{ t('compose.subjects', { n: persons.length }) }}
        </div>
        <template v-if="persons.length">
          <ul class="subjects">
            <li
              v-for="(p, i) in persons"
              :key="i"
            >
              <label>
                <input
                  type="radio"
                  name="compose-subject"
                  :checked="i === activeIndex"
                  @change="activeIndex = i"
                >
                <span>{{ p.labelZh || p.label }}</span>
                <span class="conf">{{ Math.round(p.confidence * 100) }}%</span>
              </label>
            </li>
          </ul>
          <div class="section-label">
            {{ t('compose.source') }}
          </div>
          <div class="stage comp-stage">
            <div class="wrap">
              <img
                v-if="state.url"
                :src="state.url"
                alt=""
              >
              <div class="overlay">
                <div
                  v-for="(p, i) in persons"
                  :key="i"
                  class="subject-box"
                  :class="{ active: i === activeIndex }"
                  :style="boxStyle(p)"
                  :title="boxTitle(p)"
                />
                <div
                  v-if="geometry"
                  class="crop-frame"
                  :style="cropStyle"
                />
                <div
                  v-if="geometry && showSafe"
                  class="safe-frame"
                  :style="safeCropStyle"
                />
              </div>
            </div>
          </div>
          <p class="hint">
            {{ t('compose.sourceLegend') }}
          </p>
        </template>
        <p
          v-else-if="state.tagged"
          class="hint"
        >
          {{ t('compose.noPerson') }}
        </p>
        <p
          v-else
          class="hint"
        >
          {{ t('compose.noTags') }}
        </p>
      </section>

      <section class="pane">
        <template v-if="geometry">
          <div class="section-label">
            {{ t('compose.frame') }}
          </div>
          <div class="frames">
            <button
              v-for="f in frames"
              :key="f.id"
              type="button"
              :class="{ active: frameId === f.id }"
              @click="frameId = f.id"
            >
              {{ frameLabel(f.id) }}
            </button>
          </div>

          <div class="section-label">
            {{ t('compose.strategy') }}
          </div>
          <label class="radio">
            <input
              v-model="strategy"
              type="radio"
              value="headroom"
            >
            <span>
              {{ t('compose.strategyHeadroom') }}
              <small>{{ t('compose.strategyHeadroomHint') }}</small>
            </span>
          </label>
          <label class="radio">
            <input
              v-model="strategy"
              type="radio"
              value="center"
            >
            <span>
              {{ t('compose.strategyCenter') }}
              <small>{{ t('compose.strategyCenterHint') }}</small>
            </span>
          </label>
          <label class="check">
            <input
              v-model="showSafe"
              type="checkbox"
            >
            <span>{{ t('compose.safeArea') }}</span>
          </label>
          <p
            v-if="!geometry.subjectFullyVisible"
            class="hint warn"
          >
            {{ t('compose.clipped') }}
          </p>

          <div class="section-label">
            {{ t('compose.output') }}
          </div>
          <div class="stage out-stage">
            <div class="wrap">
              <img
                v-if="resultUrl"
                :src="resultUrl"
                alt=""
              >
              <div
                v-if="resultUrl && showSafe"
                class="safe-line"
                :style="safeLineStyle"
              />
            </div>
            <p
              v-if="!resultUrl"
              class="hint empty-hint"
            >
              {{ t('compose.outputEmpty') }}
            </p>
          </div>
          <div class="row">
            <span
              v-if="resultUrl"
              class="hint"
            >{{ resultWidth }}×{{ resultHeight }}</span>
            <button
              type="button"
              class="primary"
              :disabled="!resultUrl || saving"
              @click="save"
            >
              {{ saving ? t('compose.saving') : t('compose.save') }}
            </button>
          </div>
        </template>
        <p
          v-else
          class="hint"
        >
          {{ t('compose.outputEmpty') }}
        </p>
        <p
          v-if="error"
          class="error"
        >
          {{ error }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>

  <SaveAssetDialog
    ref="saveAssetRef"
    :open="saveAssetOpen"
    :default-name="saveAssetDefaultName"
    :title="t('compose.saveToTitle')"
    :subtitle="t('compose.saveToSubtitle')"
    :z-index="2400"
    @confirm="onSaveToLibraryConfirm"
    @cancel="saveAssetOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { resolveCacheOutputRoot } from '@shared/domain'
import {
  composeSubjectCrop,
  COMPOSE_FRAME_PRESETS,
  DEFAULT_COMPOSE_FRAME,
  type ComposeCropRect,
  type ComposeStrategy,
  type ComposeSubjectBox
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import { loadImageElement } from '../features/yolo/cutout'
import {
  closeComposerDialog,
  composerDialogState
} from '../features/composition/compositionDialog'
import SaveAssetDialog from './SaveAssetDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const state = composerDialogState
const project = useProjectStore()

const frames = COMPOSE_FRAME_PRESETS
const persons = computed(() => state.persons)
const activeIndex = ref(0)
const frameId = ref<string>(DEFAULT_COMPOSE_FRAME)
const strategy = ref<ComposeStrategy>('headroom')
const showSafe = ref(true)

const resultUrl = ref('')
const resultWidth = ref(0)
const resultHeight = ref(0)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const saving = ref(false)
const error = ref('')
const saveAssetOpen = ref(false)
const saveAssetDefaultName = ref('')
const saveAssetRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
/** 渲染请求递增号：连续切换时丢弃过期结果并释放其 blob */
let renderToken = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null

const frame = computed(
  () => frames.find((f) => f.id === frameId.value) ?? frames[0]!
)

function frameLabel(id: string): string {
  const map: Record<string, string> = {
    '9:16': t('compose.frame9_16'),
    '1:1': t('compose.frame1_1'),
    '16:9': t('compose.frame16_9')
  }
  return map[id] ?? id
}

/** 取面积最大的主体为默认构图对象（通常即画面主角） */
function defaultPersonIndex(list: readonly { width: number; height: number }[]): number {
  let best = 0
  let bestArea = -1
  list.forEach((p, i) => {
    const area = p.width * p.height
    if (area > bestArea) {
      bestArea = area
      best = i
    }
  })
  return best
}

const activePerson = computed((): ComposeSubjectBox | null => {
  const p = persons.value[activeIndex.value]
  if (!p) return null
  return { x: p.x, y: p.y, width: p.width, height: p.height }
})

const geometry = computed(() => {
  const subj = activePerson.value
  if (!subj || state.imageWidth <= 0 || state.imageHeight <= 0) return null
  return composeSubjectCrop({
    imageWidth: state.imageWidth,
    imageHeight: state.imageHeight,
    subject: subj,
    target: frame.value,
    strategy: strategy.value
  })
})

function boxStyle(p: ComposeSubjectBox): Record<string, string> {
  const iw = state.imageWidth || 1
  const ih = state.imageHeight || 1
  return {
    left: `${(p.x / iw) * 100}%`,
    top: `${(p.y / ih) * 100}%`,
    width: `${(p.width / iw) * 100}%`,
    height: `${(p.height / ih) * 100}%`
  }
}

function boxTitle(p: { label?: string; labelZh?: string; confidence: number }): string {
  const name = p.labelZh || p.label || ''
  return `${name} · ${Math.round(p.confidence * 100)}%`
}

const cropStyle = computed(() => {
  const g = geometry.value
  if (!g) return {}
  return {
    left: `${g.crop.cropX * 100}%`,
    top: `${g.crop.cropY * 100}%`,
    width: `${g.crop.cropW * 100}%`,
    height: `${g.crop.cropH * 100}%`
  }
})

/** 安全区（crop 框内的虚线矩形），叠在源图 crop 框之上 */
const safeCropStyle = computed(() => {
  const g = geometry.value
  if (!g) return {}
  const r = Math.min(0.5, Math.max(0, frame.value.safeAreaRatio))
  return {
    left: `${(g.crop.cropX + g.crop.cropW * r) * 100}%`,
    top: `${(g.crop.cropY + g.crop.cropH * r) * 100}%`,
    width: `${g.crop.cropW * (1 - 2 * r) * 100}%`,
    height: `${g.crop.cropH * (1 - 2 * r) * 100}%`
  }
})

/** 输出结果图上的安全区（输出即目标画幅，四周同比例内缩） */
const safeLineStyle = computed(() => {
  const r = Math.min(0.5, Math.max(0, frame.value.safeAreaRatio)) * 100
  return { left: `${r}%`, top: `${r}%`, right: `${r}%`, bottom: `${r}%` }
})

/** 按归一化裁剪框裁出新 PNG（blob object URL + canvas，供保存编码） */
async function cropCanvas(
  url: string,
  rect: ComposeCropRect
): Promise<{ url: string; canvas: HTMLCanvasElement; width: number; height: number }> {
  const img = await loadImageElement(url)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const sx = Math.max(0, Math.min(sw, Math.round(rect.cropX * sw)))
  const sy = Math.max(0, Math.min(sh, Math.round(rect.cropY * sh)))
  const cw = Math.max(1, Math.min(sw - sx, Math.round(rect.cropW * sw)))
  const ch = Math.max(1, Math.min(sh - sy, Math.round(rect.cropH * sh)))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('COMPOSE: canvas 2d context unavailable')
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('COMPOSE: failed to encode PNG'))),
      'image/png'
    )
  })
  return { url: URL.createObjectURL(blob), canvas, width: cw, height: ch }
}

async function render(): Promise<void> {
  const g = geometry.value
  if (!g || !state.url) {
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = ''
    resultCanvas.value = null
    resultWidth.value = 0
    resultHeight.value = 0
    return
  }
  const token = ++renderToken
  try {
    const out = await cropCanvas(state.url, g.crop)
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

function reset(): void {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  resultCanvas.value = null
  resultWidth.value = 0
  resultHeight.value = 0
  error.value = ''
  saveAssetOpen.value = false
}

watch(
  () => state.open,
  (open) => {
    if (!open) {
      reset()
      return
    }
    activeIndex.value = defaultPersonIndex(persons.value)
    error.value = ''
    void render()
  }
)

/** 主体 / 画幅 / 策略变化：合并为一次渲染，避免连续裁剪卡顿 */
watch([activeIndex, frameId, strategy], () => {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    void render()
  }, 80)
})

/** 点「保存到资产库」：先弹选择目标文件夹与命名对话框 */
function save(): void {
  if (saving.value) return
  if (!resultCanvas.value) {
    error.value = t('compose.outputEmpty')
    return
  }
  error.value = ''
  const suffix = frameId.value.replace(':', '')
  saveAssetDefaultName.value = `${state.name || 'frame'}-${suffix}`
  saveAssetOpen.value = true
}

/** 保存对话框确认：把裁剪结果先落到 Cache 临时文件，再复制进所选文件夹登记 */
async function onSaveToLibraryConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  const canvas = resultCanvas.value
  if (!canvas || saving.value) return
  saving.value = true
  error.value = ''
  saveAssetRef.value?.setSaving(true)
  try {
    const dataUrl = canvas.toDataURL('image/png')
    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const tmpRel = await window.studio.saveGraphRunMedia({
      dataUrl,
      key: `compose-${Date.now()}`,
      outputDir: `${cacheRoot}/Composed`
    })
    console.log('[compose] staged to', tmpRel)
    await window.studio.saveProjectAsset({
      relativePath: tmpRel,
      name: payload.name,
      folderId: payload.folderId
    })
    await project.scheduleRefreshLibrary()
    saveAssetOpen.value = false
    closeComposerDialog()
  } catch (err) {
    saveAssetRef.value?.setError(err instanceof Error ? err.message : String(err))
    console.error('[compose] save failed', err)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.compose {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
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

.subjects {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.subjects label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.subjects label:hover {
  background: var(--bg-hover);
}

.conf {
  color: var(--text-muted);
}

.stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 1 auto;
  min-height: 120px;
  max-height: 380px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-input);
}

/* wrap 与 img 同尺寸，overlay 用百分比对齐图片真实渲染区域 */
.wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
  line-height: 0;
}

.wrap img {
  display: block;
  max-width: 100%;
  max-height: 360px;
  object-fit: contain;
}

.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.subject-box {
  position: absolute;
  border: 1px solid rgba(255, 200, 60, 0.65);
  border-radius: 2px;
  box-sizing: border-box;
}

.subject-box.active {
  border: 2px solid #ffc400;
}

.crop-frame {
  position: absolute;
  border: 2px solid #4caf50;
  box-sizing: border-box;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.35),
    0 0 0 9999px rgba(0, 0, 0, 0.22);
}

.safe-frame {
  position: absolute;
  border: 1px dashed rgba(200, 200, 200, 0.85);
  box-sizing: border-box;
}

.frames {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.frames button {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.frames button.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.radio,
.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.radio input,
.check input {
  margin-top: 3px;
}

.radio small {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.hint.warn {
  color: #d89b2b;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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

.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
}

.safe-line {
  position: absolute;
  border: 1px dashed rgba(200, 200, 200, 0.85);
  pointer-events: none;
}
</style>
