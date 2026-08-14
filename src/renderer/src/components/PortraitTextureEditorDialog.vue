<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="720"
    :default-height="500"
    :min-width="560"
    :min-height="400"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="editor-body">
        <div class="preview-pane">
          <div
            v-if="sourceLoading"
            class="preview-empty"
          >
            {{ t('graph.editor.loadingSource') }}
          </div>
          <img
            v-else-if="sourceUrl"
            :src="sourceUrl"
            alt=""
            class="preview-img"
            draggable="false"
          >
          <div
            v-else
            class="preview-empty"
          >
            {{ t('graph.portraitTexture.previewEmpty') }}
          </div>
        </div>

        <div class="params-pane">
          <div
            v-for="row in fields"
            :key="row.field"
            class="option-row"
          >
            <span class="row-label">{{ t(`graph.portraitTexture.fields.${row.labelKey}`) }}</span>
            <div class="seg">
              <button
                v-for="(opt, idx) in row.options"
                :key="opt.id"
                type="button"
                class="seg-btn"
                :class="[
                  { active: draft[row.field] === opt.id },
                  `level-${idx}`
                ]"
                :aria-pressed="draft[row.field] === opt.id"
                @click="setField(row.field, opt.id)"
              >
                <span class="opt-swatch" />
                <span class="opt-label">{{ t(`graph.portraitTexture.options.${row.field}.${opt.titleKey}`) }}</span>
              </button>
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
  sourceUrl?: string
  sourceLoading?: boolean
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
  flex: 0 0 240px;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  overflow: hidden;
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 9px;
  padding: 10px 8px;
  font-size: 12px;
  cursor: pointer;
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
  right: 6px;
  top: 6px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

.seg-btn:active {
  transform: translateY(1px);
}

.seg-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 2px;
}

.opt-swatch {
  display: block;
  width: 38px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  transition: background 140ms ease;
}

.level-0 .opt-swatch {
  background: linear-gradient(90deg, var(--accent, #6aa8ff) 33%, var(--bg-input) 33%);
}

.level-1 .opt-swatch {
  background: linear-gradient(90deg, var(--accent, #6aa8ff) 66%, var(--bg-input) 66%);
}

.level-2 .opt-swatch {
  background: linear-gradient(90deg, var(--accent, #6aa8ff) 100%, var(--bg-input) 100%);
}

.opt-label {
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  white-space: normal;
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
