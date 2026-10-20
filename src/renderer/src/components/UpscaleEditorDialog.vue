<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="720"
    :default-height="560"
    :min-width="560"
    :min-height="420"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="stage">
        <div v-if="sourceLoading" class="stage-empty">
          {{ t('graph.editor.loadingSource') }}
        </div>
        <div v-else-if="!sourceUrl" class="stage-empty">
          {{ t('graph.upscale.noSource') }}
        </div>
        <div v-else class="canvas-frame">
          <img class="source-img" :src="sourceUrl" alt="" decoding="async" />
          <div class="scale-badge">{{ draft.scale }}x</div>
        </div>
      </div>

      <div class="toolbar">
        <label class="tool tool-model">
          <span class="tool-label">{{ t('graph.inspector.generate.imageModel') }}</span>
          <select v-model="selectionKey" class="select" @change="onModelChange">
            <option v-for="opt in modelOptions" :key="opt.key" :value="opt.key">
              {{ opt.label }}
            </option>
            <option v-if="modelOptions.length === 0" value="">
              {{ t('graph.inspector.generate.noModels') }}
            </option>
          </select>
        </label>

        <label class="tool">
          <span class="tool-label">{{ t('graph.upscale.scale') }}</span>
          <select v-model.number="draft.scale" class="select" @change="markDirty">
            <option v-for="s in UPSCALE_SCALES" :key="s" :value="s">{{ s }}x</option>
          </select>
        </label>

        <label class="tool">
          <span class="tool-label">{{ t('graph.upscale.variant') }}</span>
          <select v-model="draft.variantId" class="select" @change="markDirty">
            <option v-for="v in UPSCALE_VARIANTS" :key="v.id" :value="v.id">
              {{ t(`graph.upscale.variants.${v.titleKey}`) }}
            </option>
          </select>
        </label>

        <label class="tool tool-instruction">
          <span class="tool-label">{{ t('graph.upscale.instruction') }}</span>
          <input
            v-model="instructionDraft"
            type="text"
            class="input"
            :placeholder="t('graph.upscale.instructionPlaceholder')"
            @input="markDirty"
          />
        </label>

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
  UPSCALE_VARIANTS,
  imageUpscaleToNodePatch,
  normalizeImageUpscale,
  type ImageUpscaleState
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
  generateInstruction: string
}

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageUpscaleState> | null
  sourceUrl?: string
  sourceLoading?: boolean
  generateModel?: string
  generateProviderInstanceId?: string
  generateInstruction?: string
}>()

const emit = defineEmits<{
  close: []
  update: [payload: UpscaleEditorSavePayload]
  save: [payload: UpscaleEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.upscale.appMark'))

const draft = reactive<ImageUpscaleState>(normalizeImageUpscale())
const instructionDraft = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')
const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

const dirty = computed(() => {
  const a = normalizeImageUpscale(props.setup)
  const b = normalizeImageUpscale(draft)
  const setupKey = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  const setupInstruction = (props.generateInstruction ?? '').trim()
  return (
    selectionKey.value !== setupKey ||
    instructionDraft.value.trim() !== setupInstruction ||
    JSON.stringify(a) !== JSON.stringify(b)
  )
})

function selectedModelOption(): GenerateModelOption | undefined {
  return modelOptions.value.find((o) => o.key === selectionKey.value)
}

function buildPayload(): UpscaleEditorSavePayload {
  const opt = selectedModelOption()
  return {
    ...imageUpscaleToNodePatch(draft),
    generateModel: opt ? opt.model : (props.generateModel?.trim() ?? ''),
    generateProviderInstanceId: opt
      ? opt.providerInstanceId
      : (props.generateProviderInstanceId?.trim() ?? ''),
    generateInstruction: instructionDraft.value.trim()
  }
}

async function hydrateFromProps(): Promise<void> {
  hydrating.value = true
  try {
    Object.assign(draft, normalizeImageUpscale(props.setup))
    instructionDraft.value = props.generateInstruction ?? ''
    const pref = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
    const { options, selectedKey } = await loadGenerateModelOptions('image', pref)
    modelOptions.value = options
    selectionKey.value = selectedKey || options[0]?.key || ''
  } finally {
    hydrating.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void hydrateFromProps()
    } else if (previewTimer) {
      clearTimeout(previewTimer)
      previewTimer = null
    }
  },
  { immediate: true }
)

watch(
  () => props.setup,
  (next) => {
    if (!props.open) return
    Object.assign(draft, normalizeImageUpscale(next))
  }
)

watch(
  () => props.generateInstruction,
  (next) => {
    if (!props.open) return
    instructionDraft.value = next ?? ''
  }
)

function schedulePreview(): void {
  if (hydrating.value || !props.open) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open) return
    emit('update', buildPayload())
  }, 80)
}

function markDirty(): void {
  schedulePreview()
}

function onModelChange(): void {
  schedulePreview()
}

function resetParams(): void {
  Object.assign(draft, normalizeImageUpscale(DEFAULT_IMAGE_UPSCALE))
  instructionDraft.value = ''
  schedulePreview()
}

function onClose(): void {
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  if (dirty.value) {
    emit('save', buildPayload())
  }
  emit('close')
}
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-canvas, #141416);
}

.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: hidden;
  background: var(--image-checker-bg);
}

.stage-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.canvas-frame {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--image-checker-bg);
}

.source-img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 240px);
  object-fit: contain;
}

.scale-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.tool {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.tool-model {
  min-width: 180px;
}

.tool-instruction {
  flex: 1;
  min-width: 200px;
}

.tool-label {
  white-space: nowrap;
}

.select,
.input {
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
}

.input {
  flex: 1;
  min-width: 120px;
}

.reset-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.reset-btn:hover {
  border-color: var(--accent);
}
</style>
