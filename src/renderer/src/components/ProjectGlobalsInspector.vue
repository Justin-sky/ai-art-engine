<template>
  <div v-if="config" class="inspector">
    <div class="head">
      <h2>{{ t('project.globals.title') }}</h2>
    </div>

    <StyleImagePicker
      :model-value="localImages"
      :label="t('project.globals.stylePreset')"
      :hint="t('project.globals.styleImagesHint')"
      @update:model-value="onImagesChange"
    />

    <label class="cache-field">
      {{ t('project.globals.generateSeed') }}
      <span class="seed-row">
        <input
          v-model="localSeed"
          type="number"
          min="0"
          :max="String(MAX_GENERATE_SEED)"
          step="1"
          :placeholder="t('project.globals.generateSeedPlaceholder')"
          @change="onSeedChange"
        />
        <button type="button" class="seed-clear" @click="clearSeed">
          {{ t('project.globals.generateSeedRandom') }}
        </button>
      </span>
      <span class="field-hint">{{ t('project.globals.generateSeedHint') }}</span>
    </label>

    <label class="cache-field">
      {{ t('project.globals.cacheOutputDir') }}
      <input v-model="localCacheDir" :placeholder="defaultCacheDir" @change="onCacheDirChange" />
      <span class="field-hint">{{ t('project.globals.cacheOutputDirHint') }}</span>
    </label>

    <div class="bible-card">
      <div class="bible-title">Game Art Bible Lock</div>
      <label class="cache-field">
        Camera Projection
        <select v-model="bibleCamera" @change="onBibleChange">
          <option value="free">Free / Unconstrained</option>
          <option value="side_scroller">2D Side-Scroller (Orthographic)</option>
          <option value="top_down_34">Top-Down 3/4 RPG (45° Tilt)</option>
          <option value="isometric">2:1 Isometric Strategy</option>
          <option value="first_person">First-Person / Dungeon Crawler</option>
        </select>
      </label>
      <label class="cache-field">
        Art Direction Lock
        <select v-model="bibleArt" @change="onBibleChange">
          <option value="free">Free / Unconstrained</option>
          <option value="pixel_16bit">16-Bit Pixel Art</option>
          <option value="cel_anime">Cel-Shaded Anime</option>
          <option value="hand_drawn_ink">Hand-Drawn Ink &amp; Paint</option>
          <option value="stylized_pbr">Stylized 3D PBR</option>
          <option value="dark_gothic">Dark Gothic Grimdark</option>
        </select>
      </label>
    </div>
  </div>
  <div v-else class="inspector empty">
    {{ t('project.globals.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_CACHE_OUTPUT_DIR,
  normalizeProjectRelativeDir,
  normalizeProjectStyleImages,
  styleImagesToPresetText,
  type ProjectConfig,
  type ProjectStyleImage
} from '@shared/domain'
import {
  compileGameArtBiblePromptClause,
  type GameArtDirectionPreset,
  type GameCameraProjectionLock
} from '@shared/gameAssets'
import { MAX_GENERATE_SEED, clampSeed } from '@shared/graph'
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
const localCacheDir = ref('')
const localSeed = ref('')
const bibleCamera = ref<GameCameraProjectionLock>('free')
const bibleArt = ref<GameArtDirectionPreset>('free')
const defaultCacheDir = DEFAULT_CACHE_OUTPUT_DIR

watch(
  () => config.value?.styleImages,
  (value) => {
    localImages.value = normalizeProjectStyleImages(value)
  },
  { immediate: true, deep: true }
)

watch(
  () => config.value?.generateSeed,
  (value) => {
    localSeed.value = clampSeed(value) != null ? String(clampSeed(value)) : ''
  },
  { immediate: true }
)

watch(
  () => config.value?.cacheOutputDir,
  (value) => {
    localCacheDir.value = normalizeProjectRelativeDir(value) || defaultCacheDir
  },
  { immediate: true }
)

async function onImagesChange(images: ProjectStyleImage[]): Promise<void> {
  const next = normalizeProjectStyleImages(images)
  localImages.value = next
  await project.updateConfig({
    styleImages: next,
    stylePreset: styleImagesToPresetText(next)
  })
}

async function onSeedChange(): Promise<void> {
  const text = localSeed.value.trim()
  const n = text ? Number(text) : NaN
  const next = clampSeed(n)
  localSeed.value = next != null ? String(next) : ''
  if (next === clampSeed(config.value?.generateSeed)) return
  await project.updateConfig({ generateSeed: next })
}

async function clearSeed(): Promise<void> {
  localSeed.value = ''
  await project.updateConfig({ generateSeed: undefined })
}

async function onCacheDirChange(): Promise<void> {
  const normalized = normalizeProjectRelativeDir(localCacheDir.value) || defaultCacheDir
  localCacheDir.value = normalized
  const current = normalizeProjectRelativeDir(config.value?.cacheOutputDir) || defaultCacheDir
  if (normalized === current) return
  await project.updateConfig({ cacheOutputDir: normalized })
}

async function onBibleChange(): Promise<void> {
  const baseText = styleImagesToPresetText(localImages.value)
  const clause = compileGameArtBiblePromptClause({
    cameraProjection: bibleCamera.value,
    artDirection: bibleArt.value
  })
  const combined = [baseText, clause].filter(Boolean).join('\n')
  await project.updateConfig({ stylePreset: combined })
}
</script>

<style scoped>
.bible-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg));
}
.bible-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.cache-field select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
  color: var(--text);
  font-size: 12px;
}
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

.cache-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.cache-field input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
  color: var(--text);
  font-size: 13px;
}

.seed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.seed-row input {
  flex: 1;
  min-width: 0;
}

.seed-clear {
  flex: none;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
</style>
