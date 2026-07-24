<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="420"
    :default-height="240"
    :min-width="360"
    :min-height="200"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <label class="field">
        <span class="label">{{ t('graph.upscale.engine') }}</span>
        <select v-model="selectionKey" class="select" @change="markDirty">
          <option v-for="opt in selectionOptions" :key="opt.key" :value="opt.key">
            {{ opt.label }}
          </option>
        </select>
      </label>

      <div class="field">
        <span class="label">{{ t('graph.upscale.scale') }}</span>
        <div class="seg">
          <button
            v-for="s in scales"
            :key="s"
            type="button"
            class="seg-btn"
            :class="{ active: draft.scale === s }"
            @click="setScale(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <p class="hint">{{ t('graph.upscale.hintRun') }}</p>

      <div class="editor-footer">
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.upscale.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_UPSCALE,
  UPSCALE_SCALES,
  imageUpscaleToNodePatch,
  normalizeImageUpscale,
  type ImageUpscaleState,
  type UpscaleScale
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type UpscaleEditorSavePayload = ReturnType<typeof imageUpscaleToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageUpscaleState> | null
  generateModel?: string
  generateProviderInstanceId?: string
}>()

const emit = defineEmits<{
  close: []
  save: [payload: UpscaleEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.upscale.appMark'))
const scales = UPSCALE_SCALES

const draft = reactive<ImageUpscaleState>(normalizeImageUpscale())
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')

const selectionOptions = computed(() => {
  const models = modelOptions.value.map((opt) => ({ key: opt.key, label: opt.label }))
  if (models.length === 0) {
    return [{ key: '', label: t('graph.inspector.generate.noModels') }]
  }
  return models
})

const dirty = computed(() => {
  const a = normalizeImageUpscale(props.setup)
  const b = normalizeImageUpscale(draft)
  const setupKey = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  return selectionKey.value !== setupKey || a.scale !== b.scale
})

watch(
  () => [props.open, props.setup, props.generateModel, props.generateProviderInstanceId] as const,
  ([open]) => {
    if (!open) return
    Object.assign(draft, normalizeImageUpscale(props.setup))
    // 不挡窗口首帧
    void reloadSelection()
  },
  { immediate: true, deep: true }
)

async function reloadSelection(): Promise<void> {
  const preferred = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  const { options, selectedKey } = await loadGenerateModelOptions('image', preferred)
  modelOptions.value = options
  draft.engineId = 'imageApi'
  selectionKey.value = selectedKey || options[0]?.key || ''
}

function markDirty(): void {
  /* v-model updates selectionKey; dirty computed tracks it */
}

function setScale(scale: UpscaleScale): void {
  draft.scale = scale
}

async function resetParams(): Promise<void> {
  Object.assign(draft, normalizeImageUpscale(DEFAULT_IMAGE_UPSCALE))
  const { options, selectedKey } = await loadGenerateModelOptions('image')
  modelOptions.value = options
  selectionKey.value = selectedKey || options[0]?.key || ''
}

function buildSavePayload(): UpscaleEditorSavePayload {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  return {
    ...imageUpscaleToNodePatch(normalizeImageUpscale(draft)),
    generateModel: opt?.model ?? '',
    generateProviderInstanceId: opt?.providerInstanceId ?? ''
  }
}

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (dirty.value) save()
  emit('close')
}
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 18px 12px;
  box-sizing: border-box;
  height: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  color: var(--text-muted, #9aa3ad);
}

.select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border, #3a4048);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  padding: 8px 10px;
  font-size: 13px;
}

.seg {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.seg-btn {
  border: 1px solid var(--border, #3a4048);
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  cursor: pointer;
}

.seg-btn:hover {
  background: var(--bg-hover);
}

.seg-btn.active {
  background: var(--bg-hover);
  border-color: #5a6570;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted, #9aa3ad);
  line-height: 1.4;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 4px;
}

.reset-btn {
  border: 1px solid var(--border, #3a4048);
  background: var(--bg-hover);
  color: var(--text, #e8eaed);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
}

.reset-btn:hover {
  background: var(--bg-hover);
}
</style>
