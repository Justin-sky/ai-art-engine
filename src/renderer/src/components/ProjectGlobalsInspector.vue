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
      <div class="bible-title">{{ t('gameToolbox.bible.title') }}</div>
      <label class="cache-field">
        {{ t('gameToolbox.bible.cameraLabel') }}
        <select v-model="bibleCamera" @change="onBibleChange">
          <option value="free">{{ t('gameToolbox.bible.cameraFree') }}</option>
          <option value="side_scroller">{{ t('gameToolbox.bible.cameraSide') }}</option>
          <option value="top_down_34">{{ t('gameToolbox.bible.cameraTopDown') }}</option>
          <option value="isometric">{{ t('gameToolbox.bible.cameraIso') }}</option>
          <option value="first_person">{{ t('gameToolbox.bible.cameraFps') }}</option>
        </select>
      </label>
      <label class="cache-field">
        {{ t('gameToolbox.bible.artLabel') }}
        <select v-model="bibleArt" @change="onBibleChange">
          <option value="free">{{ t('gameToolbox.bible.artFree') }}</option>
          <option value="pixel_16bit">{{ t('gameToolbox.bible.artPixel') }}</option>
          <option value="cel_anime">{{ t('gameToolbox.bible.artCel') }}</option>
          <option value="hand_drawn_ink">{{ t('gameToolbox.bible.artInk') }}</option>
          <option value="stylized_pbr">{{ t('gameToolbox.bible.artPbr') }}</option>
          <option value="dark_gothic">{{ t('gameToolbox.bible.artGothic') }}</option>
        </select>
      </label>
    </div>

    <div class="bible-card">
      <div class="bible-title">{{ t('gameToolbox.production.title') }}</div>
      <label class="cache-field">
        {{ t('gameToolbox.production.levelAlgoLabel') }}
        <select v-model="levelAlgo">
          <option value="bsp_dungeon">{{ t('gameToolbox.production.algoBsp') }}</option>
          <option value="cellular_cave">{{ t('gameToolbox.production.algoCave') }}</option>
          <option value="platformer_course">
            {{ t('gameToolbox.production.algoPlatformer') }}
          </option>
          <option value="arena_waves">{{ t('gameToolbox.production.algoArena') }}</option>
        </select>
      </label>
      <div class="prod-btn-group">
        <button
          type="button"
          class="prod-btn primary"
          :disabled="prodBusy"
          @click="openPlayableDemoModal"
        >
          {{ t('gameToolbox.production.playDemoBtn') }}
        </button>
        <button
          type="button"
          class="prod-btn"
          :disabled="prodBusy"
          @click="generateTiledLevelFromGlobals"
        >
          {{ t('gameToolbox.production.genLevelBtn') }}
        </button>
        <button
          type="button"
          class="prod-btn"
          :disabled="prodBusy"
          @click="exportAllShadersFromGlobals"
        >
          {{ t('gameToolbox.production.exportShadersBtn') }}
        </button>
      </div>
      <pre v-if="levelAsciiPreview" class="ascii-map-preview">{{ levelAsciiPreview }}</pre>
      <div v-if="prodSavedNote" class="prod-saved-note">{{ prodSavedNote }}</div>
    </div>

    <Teleport to="body">
      <div
        v-if="playableModalOpen && playableSandboxHtml"
        class="playable-modal-backdrop"
        @click.self="playableModalOpen = false"
      >
        <div class="playable-modal-window">
          <div class="playable-modal-header">
            <div>
              <div class="playable-modal-title">
                {{ t('gameToolbox.production.playableModalTitle') }}
              </div>
              <div class="playable-modal-hint">
                {{ t('gameToolbox.production.playableModalHint') }}
              </div>
            </div>
            <button type="button" class="prod-btn" @click="playableModalOpen = false">
              {{ t('gameToolbox.production.closeDemoBtn') }}
            </button>
          </div>
          <iframe
            :srcdoc="playableSandboxHtml"
            class="playable-iframe"
            sandbox="allow-scripts"
            title="Playable Game Sandbox"
          />
        </div>
      </div>
    </Teleport>
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
  buildGameShaderParticleBundle,
  compileGameArtBiblePromptClause,
  compilePlayableGameSandboxHtml,
  generateProceduralLevelMap,
  type GameArtDirectionPreset,
  type GameCameraProjectionLock,
  type LevelGeneratorAlgorithm
} from '@shared/gameAssets'
import { MAX_GENERATE_SEED, clampSeed } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveAssetFileUrl } from '../features/media/assetUrlCache'
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
const levelAlgo = ref<LevelGeneratorAlgorithm>('bsp_dungeon')
const prodBusy = ref(false)
const levelAsciiPreview = ref('')
const prodSavedNote = ref('')
const playableModalOpen = ref(false)
const playableSandboxHtml = ref('')
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

async function generateTiledLevelFromGlobals(): Promise<void> {
  prodBusy.value = true
  try {
    const seedNum = clampSeed(Number(localSeed.value)) ?? 42
    const map = generateProceduralLevelMap({
      width: 36,
      height: 22,
      tileWidth: 32,
      tileHeight: 32,
      algorithm: levelAlgo.value,
      seed: seedNum
    })
    levelAsciiPreview.value = map.asciiPreview
    const relPath = `Assets/GameLevels/level_${levelAlgo.value}_${seedNum}.tmj`
    await window.studio.writeProjectFile({
      relativePath: relPath,
      content: map.tiledTmjText
    })
    prodSavedNote.value = `Saved Tiled Map (${map.rooms.length} rooms, ${map.entities.length} entities): ${relPath}`
  } finally {
    prodBusy.value = false
  }
}

async function exportAllShadersFromGlobals(): Promise<void> {
  prodBusy.value = true
  try {
    const bundle = buildGameShaderParticleBundle()
    for (const s of bundle.shaders) {
      await window.studio.writeProjectFile({
        relativePath: `Assets/GameShaders/${s.presetId}.gdshader`,
        content: s.godotGdShader
      })
      await window.studio.writeProjectFile({
        relativePath: `Assets/GameShaders/${s.presetId}.shader`,
        content: s.unityShaderLab
      })
      await window.studio.writeProjectFile({
        relativePath: `Assets/GameShaders/${s.presetId}.frag.glsl`,
        content: s.webglGlslFrag
      })
    }
    await window.studio.writeProjectFile({
      relativePath: 'Assets/GameShaders/particle_presets.json',
      content: JSON.stringify(bundle.particles, null, 2)
    })
    prodSavedNote.value = `Saved ${bundle.shaders.length} Godot/Unity/WebGL shaders + ${bundle.particles.length} particle presets -> Assets/GameShaders/`
  } finally {
    prodBusy.value = false
  }
}

async function openPlayableDemoModal(): Promise<void> {
  prodBusy.value = true
  try {
    const imageAssets = project.assets.filter((a) => a.type === 'image' && a.relativePath?.trim())
    const findAssetUrl = async (
      pattern: RegExp,
      fallbackIdx: number
    ): Promise<string | undefined> => {
      const matched =
        imageAssets.find((a) => pattern.test(a.name) || pattern.test(a.relativePath || '')) ??
        imageAssets[fallbackIdx]
      if (!matched?.relativePath) return undefined
      return (await resolveAssetFileUrl(matched.relativePath)) || undefined
    }
    const [heroUrl, enemyUrl, tileUrl] = await Promise.all([
      findAssetUrl(/hero|player|char|knight|warrior|protagonist/i, 0),
      findAssetUrl(/enemy|monster|slime|boss|goblin|skeleton/i, 1),
      findAssetUrl(/tile|floor|ground|grass|stone|brick/i, 2)
    ])
    const seedNum = clampSeed(Number(localSeed.value)) ?? 1337
    const mode =
      levelAlgo.value === 'platformer_course' || bibleCamera.value === 'side_scroller'
        ? 'platformer'
        : 'survivor'
    const map = generateProceduralLevelMap({
      width: 36,
      height: 22,
      tileWidth: 32,
      tileHeight: 32,
      algorithm: levelAlgo.value,
      seed: seedNum
    })
    const compiled = compilePlayableGameSandboxHtml({
      title: 'Indie Game Playable Sandbox',
      mode,
      levelSeed: seedNum,
      playerSpriteDataUrl: heroUrl,
      enemySpriteDataUrl: enemyUrl,
      tileSpriteDataUrl: tileUrl,
      levelMap: map
    })
    const relPath = 'Assets/GamePlayable/playable_demo.html'
    await window.studio.writeProjectFile({
      relativePath: relPath,
      content: compiled.html
    })
    playableSandboxHtml.value = compiled.html
    playableModalOpen.value = true
    prodSavedNote.value = `Saved Playable HTML5 Sandbox -> ${relPath}`
  } finally {
    prodBusy.value = false
  }
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
.prod-btn-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prod-btn {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel, var(--bg));
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.prod-btn.primary {
  background: #2563eb;
  border-color: #3b82f6;
  color: #fff;
  font-weight: 600;
  text-align: center;
}
.prod-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
.prod-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ascii-map-preview {
  margin: 0;
  padding: 6px;
  border-radius: 6px;
  background: #090d16;
  color: #38bdf8;
  font-family: monospace;
  font-size: 9px;
  line-height: 1.15;
  overflow-x: auto;
  max-height: 150px;
}
.prod-saved-note {
  font-size: 11px;
  color: #22c55e;
  word-break: break-all;
}
.playable-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(4px);
}
.playable-modal-window {
  width: min(940px, 94vw);
  height: min(680px, 90vh);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #0b0f19;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
}
.playable-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  background: #111827;
}
.playable-modal-title {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
}
.playable-modal-hint {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}
.playable-iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: #090d16;
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
