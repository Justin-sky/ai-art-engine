<template>
  <div class="inspector" v-if="config">
    <div class="head">
      <h2>{{ t('project.globals.title') }}</h2>
    </div>

    <StyleImagePicker
      :model-value="localImages"
      :label="t('project.globals.stylePreset')"
      :hint="t('project.globals.styleImagesHint')"
      @update:model-value="onImagesChange"
    />
  </div>
  <div v-else class="inspector empty">{{ t('project.globals.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  normalizeProjectStyleImages,
  styleImagesToPresetText,
  type ProjectConfig,
  type ProjectStyleImage
} from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import StyleImagePicker from './StyleImagePicker.vue'

const props = defineProps<{
  config: ProjectConfig | null
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

/** 以 store 为准，保证保存后展示即时刷新 */
const config = computed(() => project.config ?? props.config)

const localImages = ref<ProjectStyleImage[]>([])

watch(
  () => config.value?.styleImages,
  (value) => {
    localImages.value = normalizeProjectStyleImages(value)
  },
  { immediate: true, deep: true }
)

async function onImagesChange(images: ProjectStyleImage[]): Promise<void> {
  const next = normalizeProjectStyleImages(images)
  localImages.value = next
  await project.updateConfig({
    styleImages: next,
    stylePreset: styleImagesToPresetText(next)
  })
}
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}
</style>
