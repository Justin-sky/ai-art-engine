<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="780"
    :default-height="560"
    :min-width="620"
    :min-height="440"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="editor-body">
        <div class="preview-pane">
          <div
            ref="compareEl"
            class="compare-pane"
            @pointermove="onComparePointerMove"
            @pointerup="onComparePointerUp"
            @pointercancel="onComparePointerUp"
          >
            <template v-if="sourceUrl && previewUrl">
              <img
                :src="previewUrl"
                alt=""
                class="compare-img"
                draggable="false"
              >
              <img
                :src="sourceUrl"
                alt=""
                class="compare-img before"
                :style="{ clipPath: `inset(0 ${100 - splitPos}% 0 0)` }"
                draggable="false"
              >
              <div
                class="compare-divider"
                :style="{ left: `${splitPos}%` }"
                @pointerdown="onComparePointerDown"
              >
                <span class="compare-handle" />
              </div>
              <span class="compare-tag before">{{ t('graph.portraitQuality.before') }}</span>
              <span class="compare-tag after">{{ t('graph.portraitQuality.after') }}</span>
            </template>
            <div
              v-else-if="sourceLoading"
              class="preview-empty"
            >
              {{ t('graph.editor.loadingSource') }}
            </div>
            <div
              v-else
              class="preview-empty"
            >
              {{ t('graph.portraitQuality.previewEmpty') }}
            </div>
          </div>
        </div>

        <div class="params-pane">
          <div class="preset-row">
            <button
              v-for="preset in presets"
              :key="preset.id"
              type="button"
              class="preset-btn"
              :class="{ active: isPresetActive(preset) }"
              @click="applyPreset(preset)"
            >
              {{ t(`graph.portraitQuality.presets.${preset.labelKey}`) }}
            </button>
          </div>

          <div
            v-for="group in groupedParams"
            :key="group.id"
            class="param-group"
          >
            <div class="group-title">
              {{ t(`graph.portraitQuality.groups.${group.id}`) }}
            </div>
            <div class="slider-list">
              <label
                v-for="spec in group.specs"
                :key="spec.key"
                class="slider-row"
              >
                <span class="slider-label">{{ t(`graph.portraitQuality.fields.${spec.labelKey}`) }}</span>
                <input
                  type="range"
                  :min="spec.min"
                  :max="spec.max"
                  :step="spec.step"
                  :value="draft[spec.key]"
                  @input="setParam(spec, ($event.target as HTMLInputElement).value)"
                >
                <span class="slider-value">{{ displayValue(spec, draft[spec.key]) }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <ImageGenerateModelField
          ref="modelFieldEl"
          :open="open"
          :generate-model="generateModel"
          :generate-provider-instance-id="generateProviderInstanceId"
          @change="onModelChange"
        />
        <button
          type="button"
          class="reset-btn"
          @click="resetParams"
        >
          {{ t('graph.portraitQuality.reset') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  DEFAULT_PORTRAIT_QUALITY,
  PORTRAIT_QUALITY_PARAMS,
  PORTRAIT_QUALITY_PRESETS,
  normalizePortraitQuality,
  portraitQualityToNodePatch,
  type PortraitQualityGroup,
  type PortraitQualityParamSpec,
  type PortraitQualityPreset,
  type PortraitQualityState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { renderPortraitQualityPreview } from '../features/graph/portraitQualityPreview'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: Partial<PortraitQualityState> | null
  sourceUrl?: string
  sourceLoading?: boolean
  generateModel?: string
  generateProviderInstanceId?: string
}>()

export type PortraitTextureEditorSavePayload = ReturnType<typeof portraitQualityToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

const emit = defineEmits<{
  close: []
  update: [payload: PortraitTextureEditorSavePayload]
  save: [payload: PortraitTextureEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.portraitQuality.appMark'))
const presets = PORTRAIT_QUALITY_PRESETS

const GROUP_ORDER: PortraitQualityGroup[] = ['skin', 'light', 'blend', 'color', 'detail']
const groupedParams = computed(() =>
  GROUP_ORDER.map((id) => ({
    id,
    specs: PORTRAIT_QUALITY_PARAMS.filter((spec) => spec.group === id)
  })).filter((group) => group.specs.length)
)

const draft = reactive<PortraitQualityState>(normalizePortraitQuality())
const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
} | null>(null)
const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})

const previewUrl = ref('')
let previewTimer: ReturnType<typeof setTimeout> | null = null
let previewToken = 0

const compareEl = ref<HTMLElement | null>(null)
const splitPos = ref(50)
let compareDragging = false

function setSplitFromClientX(clientX: number): void {
  const el = compareEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (!rect.width) return
  const ratio = (clientX - rect.left) / rect.width
  splitPos.value = Math.min(100, Math.max(0, ratio * 100))
}

function onComparePointerDown(e: PointerEvent): void {
  compareDragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setSplitFromClientX(e.clientX)
}

function onComparePointerMove(e: PointerEvent): void {
  if (!compareDragging) return
  setSplitFromClientX(e.clientX)
}

function onComparePointerUp(): void {
  compareDragging = false
}

const dirty = computed(() => {
  const a = normalizePortraitQuality(props.setup)
  const b = normalizePortraitQuality(draft)
  const modelDirty =
    modelDraft.generateModel !== (props.generateModel ?? '') ||
    modelDraft.generateProviderInstanceId !== (props.generateProviderInstanceId ?? '')
  return JSON.stringify(a) !== JSON.stringify(b) || modelDirty
})

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  modelDraft.generateModel = payload.generateModel
  modelDraft.generateProviderInstanceId = payload.generateProviderInstanceId
}

const hydrating = ref(false)
let emitTimer: ReturnType<typeof setTimeout> | null = null

function buildSavePayload(): PortraitTextureEditorSavePayload {
  const model = modelFieldEl.value?.currentSelection() ?? { ...modelDraft }
  return {
    ...portraitQualityToNodePatch(normalizePortraitQuality(draft)),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value) return
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = setTimeout(() => {
    emitTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

function setParam(spec: PortraitQualityParamSpec, raw: string): void {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  draft[spec.key] = Math.min(spec.max, Math.max(spec.min, value))
}

function displayValue(_spec: PortraitQualityParamSpec, value: number): string {
  return String(Math.round(value))
}

function applyPreset(preset: PortraitQualityPreset): void {
  Object.assign(draft, normalizePortraitQuality(preset.state))
}

function isPresetActive(preset: PortraitQualityPreset): boolean {
  return JSON.stringify(normalizePortraitQuality(preset.state)) === JSON.stringify(normalizePortraitQuality(draft))
}

function resetParams(): void {
  Object.assign(draft, normalizePortraitQuality(DEFAULT_PORTRAIT_QUALITY))
}

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (dirty.value) save()
  emit('close')
}

async function refreshPreview(): Promise<void> {
  const token = ++previewToken
  if (!props.sourceUrl) {
    previewUrl.value = ''
    return
  }
  try {
    const url = await renderPortraitQualityPreview(
      props.sourceUrl,
      normalizePortraitQuality(draft)
    )
    if (token === previewToken) previewUrl.value = url
  } catch {
    if (token === previewToken) previewUrl.value = props.sourceUrl
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, normalizePortraitQuality(props.setup))
    modelDraft.generateModel = props.generateModel ?? ''
    modelDraft.generateProviderInstanceId = props.generateProviderInstanceId ?? ''
    void nextTick(() => {
      hydrating.value = false
      emitPreview()
      void refreshPreview()
    })
  },
  { immediate: true }
)

watch(draft, () => {
  emitPreview()
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    void refreshPreview()
  }, 120)
}, { deep: true })

watch(
  () => props.sourceUrl,
  () => {
    if (!props.open || hydrating.value) return
    void refreshPreview()
  }
)

watch(modelDraft, () => emitPreview(), { deep: true })
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 12px;
  box-sizing: border-box;
  height: 100%;
}

.editor-body {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.preview-pane {
  flex: 0 0 260px;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  overflow: hidden;
}

.compare-pane {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}

.compare-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
}

.compare-img.before {
  z-index: 1;
}

.compare-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent);
  z-index: 2;
  cursor: col-resize;
}

.compare-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid #fff;
  box-shadow: 0 1px 5px rgb(0 0 0 / 35%);
}

.compare-tag {
  position: absolute;
  top: 8px;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-elevated) 78%, transparent);
  color: var(--text);
  z-index: 3;
  pointer-events: none;
}

.compare-tag.before {
  left: 8px;
}

.compare-tag.after {
  right: 8px;
}

.preview-empty {
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 20px;
  line-height: 1.5;
}

.params-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 12px;
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}

.preset-btn.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
  border-color: var(--accent);
}

.param-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.slider-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-row {
  display: grid;
  grid-template-columns: 84px 1fr 34px;
  align-items: center;
  gap: 8px;
}

.slider-label {
  font-size: 12px;
  color: var(--text-muted);
}

.slider-row input[type='range'] {
  width: 100%;
}

.slider-value {
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
}

.editor-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 8px;
}

.reset-btn {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
}
</style>
