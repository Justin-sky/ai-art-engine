<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="520"
    :default-height="420"
    :min-width="420"
    :min-height="360"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div
        v-for="row in fields"
        :key="row.field"
        class="option-row"
      >
        <span class="row-label">{{ t(`graph.portraitTexture.fields.${row.labelKey}`) }}</span>
        <div class="seg">
          <button
            v-for="opt in row.options"
            :key="opt.id"
            type="button"
            class="seg-btn"
            :class="{ active: draft[row.field] === opt.id }"
            :aria-pressed="draft[row.field] === opt.id"
            @click="setField(row.field, opt.id)"
          >
            {{ t(`graph.portraitTexture.options.${row.field}.${opt.titleKey}`) }}
          </button>
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
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.portraitTexture.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  DEFAULT_PORTRAIT_TEXTURE,
  PORTRAIT_TEXTURE_FIELDS,
  normalizePortraitTexture,
  portraitTextureToNodePatch,
  type PortraitTextureField,
  type PortraitTextureState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: Partial<PortraitTextureState> | null
  generateModel?: string
  generateProviderInstanceId?: string
}>()

export type PortraitTextureEditorSavePayload = ReturnType<typeof portraitTextureToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

const emit = defineEmits<{
  close: []
  update: [payload: PortraitTextureEditorSavePayload]
  save: [payload: PortraitTextureEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.portraitTexture.appMark'))
const fields = PORTRAIT_TEXTURE_FIELDS

const draft = reactive<PortraitTextureState>(normalizePortraitTexture())
const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
} | null>(null)
const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})

const dirty = computed(() => {
  const a = normalizePortraitTexture(props.setup)
  const b = normalizePortraitTexture(draft)
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
let previewTimer: ReturnType<typeof setTimeout> | null = null

function buildSavePayload(): PortraitTextureEditorSavePayload {
  const model = modelFieldEl.value?.currentSelection() ?? { ...modelDraft }
  return {
    ...portraitTextureToNodePatch(normalizePortraitTexture(draft)),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, normalizePortraitTexture(props.setup))
    modelDraft.generateModel = props.generateModel ?? ''
    modelDraft.generateProviderInstanceId = props.generateProviderInstanceId ?? ''
    void nextTick(() => {
      hydrating.value = false
      emitPreview()
    })
  },
  { immediate: true }
)

watch(draft, () => emitPreview(), { deep: true })
watch(modelDraft, () => emitPreview(), { deep: true })

function setField(field: PortraitTextureField, id: string): void {
  switch (field) {
    case 'personScene':
      draft.personScene = id as PortraitTextureState['personScene']
      break
    case 'lightShadow':
      draft.lightShadow = id as PortraitTextureState['lightShadow']
      break
    case 'skin':
      draft.skin = id as PortraitTextureState['skin']
      break
    case 'texture':
      draft.texture = id as PortraitTextureState['texture']
      break
    case 'sharpness':
      draft.sharpness = id as PortraitTextureState['sharpness']
      break
  }
}

function resetParams(): void {
  Object.assign(draft, normalizePortraitTexture(DEFAULT_PORTRAIT_TEXTURE))
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

.option-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-label {
  font-size: 12px;
  color: var(--text-muted);
}

.seg {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.seg-btn {
  position: relative;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 28px 8px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
}

.seg-btn:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.seg-btn.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
  border-color: var(--accent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent),
    0 2px 8px color-mix(in srgb, var(--accent) 18%, transparent);
  font-weight: 600;
}

.seg-btn.active::after {
  content: '✓';
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
}

.seg-btn:active {
  transform: translateY(1px);
}

.seg-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 2px;
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

.reset-btn:hover {
  background: var(--bg-hover);
}
</style>
