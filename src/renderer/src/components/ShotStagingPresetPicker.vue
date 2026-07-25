<template>
  <!-- 表格：浮动 tip（与指令窗口预设菜单同形态） -->
  <div v-if="variant === 'cards'" class="staging-cards-anchor">
    <button
      ref="presetBtnEl"
      type="button"
      class="preset-btn"
      :title="t('shot.staging.showPresets')"
      :aria-expanded="menuOpen"
      :aria-label="t('shot.staging.showPresets')"
      @click.stop="toggleMenu"
    >
      <span class="preset-icon" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="presetMenuEl"
        class="staging-preset-menu"
        :style="presetMenuStyle"
        @mousedown.stop
        @click.stop
      >
        <div class="preset-menu-title">{{ menuTitle }}</div>
        <div v-if="!field" class="group-tabs" role="tablist">
          <button
            v-for="group in groups"
            :key="group.id"
            type="button"
            class="group-tab"
            role="tab"
            :aria-selected="activeGroup === group.id"
            :class="{ active: activeGroup === group.id }"
            @click="activeGroup = group.id"
          >
            {{ t(group.titleKey) }}
          </button>
        </div>
        <div class="preset-grid" role="listbox" :aria-label="menuTitle">
          <button
            v-for="preset in menuPresets"
            :key="preset.id"
            type="button"
            class="preset-card"
            role="option"
            :title="t(preset.titleKey)"
            @click="applyById(preset.id)"
          >
            <PresetVisualGlyph class="preset-glyph" :visual="visualFor(preset)" />
            <span class="preset-card-title">{{ t(preset.titleKey) }}</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>

  <!-- Inspector：紧凑下拉 -->
  <div v-else-if="field" class="staging-field-picker select">
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
  <div v-else class="staging-picker select">
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ShotStoryboard } from '@shared/domain'
import {
  SHOT_STAGING_PRESETS,
  applyShotStagingFieldPreset,
  applyShotStagingPreset,
  resolveShotStagingVisual,
  shotStagingGroupTitleKey,
  type PresetVisual,
  type ShotStagingGroup,
  type ShotStagingPreset,
  type ShotStagingTextField
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import PresetVisualGlyph from './PresetVisualGlyph.vue'

const props = withDefaults(
  defineProps<{
    storyboard: ShotStoryboard
    field?: ShotStagingTextField
    variant?: 'select' | 'cards'
    resolveInsertionPositions?: () => Partial<Record<ShotStagingTextField, number>>
  }>(),
  {
    variant: 'select'
  }
)

const emit = defineEmits<{
  apply: [storyboard: ShotStoryboard]
}>()

const { t, locale } = useStudioI18n()
const selectedId = ref('')
const activeGroup = ref<ShotStagingGroup>('cameraLanguage')
const menuOpen = ref(false)
const presetBtnEl = ref<HTMLButtonElement | null>(null)
const presetMenuEl = ref<HTMLElement | null>(null)
const presetMenuStyle = ref<Record<string, string>>({
  position: 'fixed',
  top: '-9999px',
  left: '-9999px',
  zIndex: '4100',
  visibility: 'hidden'
})

const fieldNameKey = computed(() =>
  props.field === 'lighting' ? 'shot.field.lighting' : 'shot.field.cameraMove'
)
const fieldSelectLabel = computed(() =>
  t('shot.staging.selectField', { field: t(fieldNameKey.value) })
)
const menuTitle = computed(() =>
  props.field ? fieldSelectLabel.value : t('shot.staging.title')
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

watch(
  groups,
  (next) => {
    if (!next.some((g) => g.id === activeGroup.value) && next[0]) {
      activeGroup.value = next[0].id
    }
  },
  { immediate: true }
)

const activePresets = computed(
  () => groups.value.find((g) => g.id === activeGroup.value)?.presets ?? []
)

const menuPresets = computed(() => (props.field ? fieldPresets.value : activePresets.value))

const selectedPreset = computed<ShotStagingPreset | undefined>(() =>
  SHOT_STAGING_PRESETS.find((preset) => preset.id === selectedId.value)
)

function visualFor(preset: ShotStagingPreset): PresetVisual {
  return resolveShotStagingVisual(preset)
}

function updatePresetMenuPosition(): void {
  const anchor = presetBtnEl.value
  const menu = presetMenuEl.value
  if (!anchor) return

  const rect = anchor.getBoundingClientRect()
  const gap = 6
  const menuW = menu?.offsetWidth || 320
  const menuH = menu?.offsetHeight || 280

  let top = rect.bottom + gap
  let left = rect.right - menuW

  if (left < 8) left = 8
  if (left + menuW > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuW - 8)
  }
  if (top + menuH > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuH - gap)
  }

  presetMenuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    right: 'auto',
    zIndex: '4100',
    visibility: 'visible'
  }
}

async function openPresetMenu(): Promise<void> {
  if (!menuPresets.value.length && !props.value.length) return
  presetMenuStyle.value = {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    zIndex: '4100',
    visibility: 'hidden'
  }
  menuOpen.value = true
  await nextTick()
  updatePresetMenuPosition()
  requestAnimationFrame(() => updatePresetMenuPosition())
}

function toggleMenu(): void {
  if (menuOpen.value) {
    closeMenu()
    return
  }
  void openPresetMenu()
}

function closeMenu(): void {
  menuOpen.value = false
}

function onPresetMenuReposition(): void {
  if (!menuOpen.value) return
  updatePresetMenuPosition()
}

function onWindowPointerDown(e: PointerEvent): void {
  if (!menuOpen.value) return
  const target = e.target as Node | null
  if (!target) {
    closeMenu()
    return
  }
  if (presetBtnEl.value?.contains(target) || presetMenuEl.value?.contains(target)) return
  closeMenu()
}

watch(activeGroup, () => {
  if (!menuOpen.value) return
  void nextTick(() => {
    updatePresetMenuPosition()
    requestAnimationFrame(() => updatePresetMenuPosition())
  })
})

watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener('scroll', onPresetMenuReposition, true)
    window.addEventListener('resize', onPresetMenuReposition)
  } else {
    window.removeEventListener('scroll', onPresetMenuReposition, true)
    window.removeEventListener('resize', onPresetMenuReposition)
  }
})

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('scroll', onPresetMenuReposition, true)
  window.removeEventListener('resize', onPresetMenuReposition)
})

function applyPreset(preset: ShotStagingPreset): void {
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
  } else {
    emit(
      'apply',
      applyShotStagingPreset(props.storyboard, preset, locale.value, {
        insertAt: positions
      })
    )
  }
  closeMenu()
}

function applySelected(): void {
  const preset = selectedPreset.value
  if (preset) applyPreset(preset)
}

function applyById(id: string): void {
  selectedId.value = id
  const preset = SHOT_STAGING_PRESETS.find((item) => item.id === id)
  if (preset) applyPreset(preset)
}
</script>

<style scoped>
.staging-cards-anchor {
  display: inline-flex;
  flex-shrink: 0;
  margin-top: 2px;
}

.preset-btn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-glass, var(--bg-elevated, var(--bg)));
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preset-btn:hover,
.preset-btn[aria-expanded='true'] {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.preset-icon {
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  background:
    linear-gradient(currentColor, currentColor) 2px 3px / 8px 1.5px no-repeat,
    linear-gradient(currentColor, currentColor) 2px 6px / 8px 1.5px no-repeat,
    linear-gradient(currentColor, currentColor) 2px 9px / 5px 1.5px no-repeat;
}

.staging-preset-menu {
  position: fixed;
  z-index: 4100;
  width: min(320px, calc(100vw - 16px));
  max-height: min(360px, calc(100vh - 16px));
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 10px 28px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-sizing: border-box;
}

.preset-menu-title {
  padding: 4px 8px 2px;
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.group-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 0 2px;
}

.group-tab {
  appearance: none;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  cursor: pointer;
}

.group-tab.active {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  font-weight: 600;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel, var(--bg));
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.preset-card:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.preset-glyph {
  height: 48px;
  min-height: 48px;
}

.preset-card-title {
  font-size: 11px;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.staging-picker.select {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
}

.staging-field-picker.select {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  margin-top: 5px;
}

.staging-field-picker.select select {
  min-width: 0;
}

.staging-field-picker.select button {
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
