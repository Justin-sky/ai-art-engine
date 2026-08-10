<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('stylePicker.libraryTitle')"
    :subtitle="t('stylePicker.librarySubtitle', { max: remaining })"
    :z-index="2600"
    :default-width="720"
    :default-height="560"
    :min-width="480"
    :min-height="360"
    @close="emit('cancel')"
  >
    <div class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ active: activeCategory === tab.id }"
        :aria-selected="activeCategory === tab.id"
        @click="activeCategory = tab.id"
      >
        {{ tab.label }}
        <span class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <div class="library">
      <button
        v-for="style in visibleLibrary"
        :key="style.id"
        type="button"
        class="card"
        :class="{
          selected: pending.has(style.id),
          disabled: isLocked(style.id),
          full: !pending.has(style.id) && !canToggle(style.id)
        }"
        :disabled="isLocked(style.id) || (!pending.has(style.id) && !canToggle(style.id))"
        :title="stylePresetDisplayName(style, locale)"
        @click="toggle(style.id)"
      >
        <img :src="style.imageUrl" :alt="stylePresetDisplayName(style, locale)" />
        <span class="caption">
          <span class="idx">{{ style.index }}.</span>
          {{ stylePresetDisplayName(style, locale) }}
        </span>
        <span v-if="isLocked(style.id)" class="badge">{{ t('stylePicker.alreadySelected') }}</span>
      </button>
    </div>

    <template #footer>
      <span class="footer-hint">
        {{ t('stylePicker.libraryPicked', { n: pending.size, max: remaining }) }}
      </span>
      <button type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button
        type="button"
        class="primary"
        :disabled="!pending.size"
        @click="confirm"
      >
        {{ t('common.confirm') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_STYLE_IMAGE_WEIGHT,
  createStyleImageId,
  type ProjectStyleImage,
  type StylePresetCategory
} from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  DEFAULT_STYLE_PRESET_LIBRARY,
  listStylePresetsByCategory,
  stylePresetDisplayName,
  stylePresetPromptText
} from '../features/stylePresets/defaultLibrary'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  /** 当前已选中的库 id（不可再选） */
  selectedLibraryIds: string[]
  /** 本次还可新增的数量 */
  remaining: number
}>()

const emit = defineEmits<{
  confirm: [items: ProjectStyleImage[]]
  cancel: []
}>()

const { t, locale } = useStudioI18n()
const activeCategory = ref<StylePresetCategory>('character')
const pending = ref<Set<string>>(new Set())

const tabs = computed(() => [
  {
    id: 'character' as const,
    label: t('stylePicker.categoryCharacter'),
    count: listStylePresetsByCategory('character').length
  },
  {
    id: 'scene' as const,
    label: t('stylePicker.categoryScene'),
    count: listStylePresetsByCategory('scene').length
  },
  {
    id: 'prop' as const,
    label: t('stylePicker.categoryProp'),
    count: listStylePresetsByCategory('prop').length
  },
  {
    id: 'weapon' as const,
    label: t('stylePicker.categoryWeapon'),
    count: listStylePresetsByCategory('weapon').length
  },
  {
    id: 'ui' as const,
    label: t('stylePicker.categoryUi'),
    count: listStylePresetsByCategory('ui').length
  }
])

const visibleLibrary = computed(() => listStylePresetsByCategory(activeCategory.value))

const locked = computed(() => new Set(props.selectedLibraryIds))

watch(
  () => props.open,
  (open) => {
    if (open) {
      pending.value = new Set()
      activeCategory.value = 'character'
    }
  }
)

function isLocked(id: string): boolean {
  return locked.value.has(id)
}

function canToggle(id: string): boolean {
  if (isLocked(id)) return false
  if (pending.value.has(id)) return true
  return pending.value.size < props.remaining
}

function toggle(id: string): void {
  if (isLocked(id)) return
  const next = new Set(pending.value)
  if (next.has(id)) {
    next.delete(id)
  } else if (next.size < props.remaining) {
    next.add(id)
  }
  pending.value = next
}

function confirm(): void {
  const items: ProjectStyleImage[] = []
  for (const style of DEFAULT_STYLE_PRESET_LIBRARY) {
    if (!pending.value.has(style.id)) continue
    const prompt = stylePresetPromptText(style, locale.value)
    items.push({
      id: createStyleImageId(),
      name: stylePresetDisplayName(style, locale.value),
      weight: DEFAULT_STYLE_IMAGE_WEIGHT,
      libraryId: style.id,
      ...(prompt ? { prompt } : {})
    })
  }
  emit('confirm', items)
}
</script>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin: 0 0 10px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 88%, #000);
  border: 1px solid var(--border);
}

.tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  background: var(--bg-elevated);
  color: var(--text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, var(--border));
}

.tab-count {
  min-width: 1.5em;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.4;
  background: color-mix(in srgb, var(--bg-panel) 70%, #000);
  color: var(--text-muted);
}

.tab.active .tab-count {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--text);
}

.library {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  padding: 4px 2px 8px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.card.disabled,
.card.full:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.card img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--media-letterbox);
}

.caption {
  display: block;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in srgb, var(--bg-panel) 92%, #000);
}

.idx {
  color: var(--text);
  margin-right: 2px;
}

.badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
}

.footer-hint {
  margin-right: auto;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
