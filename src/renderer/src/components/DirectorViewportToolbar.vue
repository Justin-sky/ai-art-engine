<template>
  <div class="toolbar-wrap">
    <div
      v-if="ratioMenuOpen"
      ref="ratioMenuEl"
      class="ratio-menu"
      role="dialog"
      :aria-label="t('director.stage.aspectRatio')"
    >
      <div class="ratio-title">{{ t('director.stage.aspectRatio') }}</div>
      <div class="ratio-grid">
        <button
          v-for="option in ratioOptions"
          :key="option.id"
          type="button"
          class="ratio-item"
          :class="{ active: aspectRatio === option.id }"
          @click="onPickRatio(option.id)"
        >
          <span class="ratio-icon" v-html="option.icon" />
          <span class="ratio-label">{{ ratioLabel(option.id) }}</span>
        </button>
      </div>
    </div>

    <div class="toolbar">
      <button
        type="button"
        class="tool-btn"
        :class="{ active: stageEditMode === 'scene' }"
        :title="t('director.stage.modeScene')"
        :aria-label="t('director.stage.modeScene')"
        @click="onSetStageMode('scene')"
      >
        <span class="tool-icon" v-html="SCENE_MODE_ICON" />
      </button>
      <button
        type="button"
        class="tool-btn"
        :class="{ active: stageEditMode === 'animation' }"
        :title="t('director.stage.modeAnimation')"
        :aria-label="t('director.stage.modeAnimation')"
        @click="onSetStageMode('animation')"
      >
        <span class="tool-icon" v-html="ANIM_MODE_ICON" />
      </button>
      <span class="sep" />
      <button
        v-for="tool in tools"
        :key="tool.mode"
        type="button"
        class="tool-btn"
        :class="{ active: transformMode === tool.mode }"
        :title="t(tool.labelKey)"
        :aria-label="t(tool.labelKey)"
        @click="onSetMode(tool.mode)"
      >
        <span class="tool-icon" v-html="tool.icon" />
      </button>
      <span class="sep" />
      <button
        type="button"
        class="tool-btn"
        :class="{ active: ratioMenuOpen }"
        :title="t('director.stage.aspectRatio')"
        :aria-label="t('director.stage.aspectRatio')"
        :aria-expanded="ratioMenuOpen"
        @click.stop="toggleRatioMenu"
      >
        <span class="tool-icon" v-html="activeRatioIcon" />
      </button>
      <button
        type="button"
        class="tool-btn"
        :title="t('director.stage.resetView')"
        @click="onReset"
      >
        ⟲
      </button>
      <button
        type="button"
        class="tool-btn"
        :class="{ active: selectionBoundsVisible }"
        :title="t('director.stage.selectionBounds')"
        :aria-label="t('director.stage.selectionBounds')"
        :aria-pressed="selectionBoundsVisible"
        @click="onToggleSelectionBounds"
      >
        <span class="tool-icon" v-html="BOUNDS_ICON" />
      </button>
      <button
        type="button"
        class="tool-btn"
        :title="t('director.stage.captureShot')"
        :aria-label="t('director.stage.captureShot')"
        @click="onCapture"
      >
        <span class="tool-icon" v-html="CAMERA_ICON" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DirectorAspectRatio, TransformMode } from '@shared/domain'
import type { DirectorStageEditMode } from '../features/director/useDirectorStageScene'
import { DIRECTOR_ASPECT_RATIO_OPTIONS } from '../features/director/aspectRatios'
import { DIRECTOR_TRANSFORM_TOOLS } from '../features/director/transformTools'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  transformMode: TransformMode
  aspectRatio: DirectorAspectRatio
  stageEditMode: DirectorStageEditMode
  selectionBoundsVisible: boolean
}>()

const emit = defineEmits<{
  setMode: [mode: TransformMode]
  setStageEditMode: [mode: DirectorStageEditMode]
  resetView: []
  capture: []
  setAspectRatio: [ratio: DirectorAspectRatio]
  toggleSelectionBounds: []
}>()

const { t } = useStudioI18n()
const tools = DIRECTOR_TRANSFORM_TOOLS
const ratioOptions = DIRECTOR_ASPECT_RATIO_OPTIONS
const ratioMenuOpen = ref(false)
const ratioMenuEl = ref<HTMLElement | null>(null)

const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>`

const SCENE_MODE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>`

const ANIM_MODE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 6V4.5"/><path d="M10.5 4h3"/><path d="M7.2 7.2l-1.1-1.1"/><path d="M12 13l3.2 2.4"/></svg>`

const BOUNDS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>`

const activeRatioIcon = computed(
  () =>
    ratioOptions.find((option) => option.id === props.aspectRatio)?.icon ??
    ratioOptions[0].icon
)

function ratioLabel(id: DirectorAspectRatio): string {
  return id === 'auto' ? t('director.stage.aspectAuto') : id
}

function onSetMode(mode: TransformMode): void {
  ratioMenuOpen.value = false
  emit('setMode', mode)
}
function onSetStageMode(mode: DirectorStageEditMode): void {
  ratioMenuOpen.value = false
  emit('setStageEditMode', mode)
}
function onReset(): void {
  ratioMenuOpen.value = false
  emit('resetView')
}
function onCapture(): void {
  ratioMenuOpen.value = false
  emit('capture')
}
function onToggleSelectionBounds(): void {
  ratioMenuOpen.value = false
  emit('toggleSelectionBounds')
}
function toggleRatioMenu(): void {
  ratioMenuOpen.value = !ratioMenuOpen.value
}
function onPickRatio(ratio: DirectorAspectRatio): void {
  emit('setAspectRatio', ratio)
  ratioMenuOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!ratioMenuOpen.value) return
  const target = event.target as HTMLElement | null
  if (ratioMenuEl.value?.contains(target)) return
  if (target?.closest('.toolbar-wrap')) return
  ratioMenuOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<style scoped>
.toolbar-wrap {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 999px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px var(--shadow);
}

.tool-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
}

.tool-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tool-btn.active {
  background: var(--accent);
  color: #fff;
}

.tool-icon {
  display: flex;
  width: 18px;
  height: 18px;
}

.tool-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.sep {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--border);
}

.ratio-menu {
  padding: 10px 12px 12px;
  border-radius: 12px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px var(--shadow);
  min-width: 292px;
}

.ratio-title {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.ratio-grid {
  display: grid;
  grid-template-columns: repeat(4, 64px);
  gap: 8px;
}

.ratio-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 64px;
  height: 64px;
  padding: 6px 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.ratio-item:hover {
  background: var(--bg-hover);
}

.ratio-item.active {
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.ratio-icon {
  display: flex;
  width: 28px;
  height: 28px;
  color: var(--text);
}

.ratio-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.ratio-label {
  font-size: 11px;
  line-height: 1;
  color: var(--text-muted);
}
</style>
