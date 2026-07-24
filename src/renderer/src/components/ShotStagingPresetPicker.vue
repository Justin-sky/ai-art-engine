<template>
  <div v-if="field" class="staging-field-picker">
    <select v-model="selectedId" :aria-label="fieldSelectLabel">
      <option value="">{{ fieldSelectLabel }}</option>
      <option v-for="preset in fieldPresets" :key="preset.id" :value="preset.id">
        {{ t(preset.titleKey) }}
      </option>
    </select>
    <button type="button" :disabled="!selectedPreset" @click="applySelected">
      {{ t('shot.staging.apply') }}
    </button>
  </div>
  <div v-else class="staging-picker">
    <div class="staging-title">{{ t('shot.staging.title') }}</div>
    <div class="staging-row">
      <select v-model="selectedId" :aria-label="t('shot.staging.title')">
        <option value="">{{ t('shot.staging.select') }}</option>
        <optgroup
          v-for="group in groups"
          :key="group.id"
          :label="t(group.titleKey)"
        >
          <option v-for="preset in group.presets" :key="preset.id" :value="preset.id">
            {{ t(preset.titleKey) }}
          </option>
        </optgroup>
      </select>
      <button type="button" :disabled="!selectedPreset" @click="applySelected">
        {{ t('shot.staging.apply') }}
      </button>
    </div>
    <p class="staging-hint">{{ t('shot.staging.hint') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ShotStoryboard } from '@shared/domain'
import {
  SHOT_STAGING_PRESETS,
  applyShotStagingFieldPreset,
  applyShotStagingPreset,
  shotStagingGroupTitleKey,
  type ShotStagingGroup,
  type ShotStagingPreset,
  type ShotStagingTextField
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  storyboard: ShotStoryboard
  field?: ShotStagingTextField
  resolveInsertionPositions?: () => Partial<Record<ShotStagingTextField, number>>
}>()

const emit = defineEmits<{
  apply: [storyboard: ShotStoryboard]
}>()

const { t, locale } = useStudioI18n()
const selectedId = ref('')

const fieldNameKey = computed(() =>
  props.field === 'lighting' ? 'shot.field.lighting' : 'shot.field.cameraMove'
)
const fieldSelectLabel = computed(() =>
  t('shot.staging.selectField', { field: t(fieldNameKey.value) })
)
const fieldPresets = computed(() =>
  props.field
    ? SHOT_STAGING_PRESETS.filter((preset) => Boolean(preset[props.field!]))
    : []
)

const groupOrder: readonly ShotStagingGroup[] = [
  'cameraLanguage',
  'bodyFacing',
  'performance',
  'lighting',
  'advertising'
]

const groups = computed(() =>
  groupOrder
    .map((id) => ({
      id,
      titleKey: shotStagingGroupTitleKey(id),
      presets: SHOT_STAGING_PRESETS.filter((preset) => preset.group === id)
    }))
    .filter((group) => group.presets.length > 0)
)

const selectedPreset = computed<ShotStagingPreset | undefined>(() =>
  SHOT_STAGING_PRESETS.find((preset) => preset.id === selectedId.value)
)

function applySelected(): void {
  const preset = selectedPreset.value
  if (!preset) return
  const positions = props.resolveInsertionPositions?.()
  if (props.field) {
    emit(
      'apply',
      applyShotStagingFieldPreset(
        props.storyboard,
        preset,
        props.field,
        locale.value,
        positions?.[props.field]
      )
    )
    return
  }
  emit(
    'apply',
    applyShotStagingPreset(props.storyboard, preset, locale.value, {
      insertAt: positions
    })
  )
}
</script>

<style scoped>
.staging-picker {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
}

.staging-field-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  margin-top: 5px;
}

.staging-field-picker select {
  min-width: 0;
}

.staging-field-picker button {
  white-space: nowrap;
}

.staging-title {
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.staging-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}

.staging-row select {
  min-width: 0;
}

.staging-row button {
  white-space: nowrap;
}

.staging-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.35;
}
</style>
