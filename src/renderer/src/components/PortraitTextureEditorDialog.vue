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
            @click="setField(row.field, opt.id)"
          >
            {{ t(`graph.portraitTexture.options.${row.field}.${opt.titleKey}`) }}
          </button>
        </div>
      </div>

      <div class="editor-footer">
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.portraitTexture.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  DEFAULT_PORTRAIT_TEXTURE,
  PORTRAIT_TEXTURE_FIELDS,
  normalizePortraitTexture,
  portraitTextureToNodePatch,
  type PortraitTextureField,
  type PortraitTextureState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: Partial<PortraitTextureState> | null
}>()

const emit = defineEmits<{
  close: []
  save: [payload: ReturnType<typeof portraitTextureToNodePatch>]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.portraitTexture.appMark'))
const fields = PORTRAIT_TEXTURE_FIELDS

const draft = reactive<PortraitTextureState>(normalizePortraitTexture())

const dirty = computed(() => {
  const a = normalizePortraitTexture(props.setup)
  const b = normalizePortraitTexture(draft)
  return JSON.stringify(a) !== JSON.stringify(b)
})

watch(
  () => [props.open, props.setup] as const,
  ([open]) => {
    if (!open) return
    Object.assign(draft, normalizePortraitTexture(props.setup))
  },
  { immediate: true, deep: true }
)

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
  emit('save', portraitTextureToNodePatch(normalizePortraitTexture(draft)))
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
  color: var(--text-muted, #9aa3ad);
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
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.seg-btn:hover {
  background: var(--bg-hover);
}

.seg-btn.active {
  background: var(--bg-hover);
  border-color: #5a6570;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 8px;
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
