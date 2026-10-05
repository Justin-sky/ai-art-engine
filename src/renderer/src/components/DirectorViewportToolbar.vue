<template>
  <div class="toolbar-wrap">
    <div
      v-if="ratioMenuOpen"
      ref="ratioMenuEl"
      class="ratio-menu"
      role="dialog"
      :aria-label="t('director.stage.aspectRatio')"
    >
      <div class="ratio-title">
        {{ t('director.stage.aspectRatio') }}
      </div>
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

    <div
      v-if="sensMenuOpen"
      ref="sensMenuEl"
      class="sens-menu"
      role="dialog"
      :aria-label="t('settings.stageControls.title')"
    >
      <div class="ratio-title">
        {{ t('settings.stageControls.title') }}
      </div>
      <p class="sens-hint">{{ t('settings.stageControls.hint') }}</p>
      <label v-for="item in sensItems" :key="item.key" class="sens-row">
        <span class="sens-label">
          {{ t(item.labelKey) }}
          <em class="sens-value">{{ formatStageControlValue(item.key, local[item.key]) }}</em>
        </span>
        <input
          v-model.number="local[item.key]"
          type="range"
          :min="item.min"
          :max="item.max"
          :step="item.step"
        />
      </label>
      <button type="button" class="sens-reset" @click="onResetSensitivity">
        {{ t('settings.stageControls.reset') }}
      </button>
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
        :class="{ active: sensMenuOpen }"
        :title="t('director.stage.sensitivity')"
        :aria-label="t('director.stage.sensitivity')"
        :aria-expanded="sensMenuOpen"
        @click.stop="toggleSensMenu"
      >
        <span class="tool-icon" v-html="SENS_ICON" />
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { DirectorAspectRatio, StageControlPreferences, TransformMode } from '@shared/domain'
import type { DirectorStageEditMode } from '../features/director/useDirectorStageScene'
import { DIRECTOR_ASPECT_RATIO_OPTIONS } from '../features/director/aspectRatios'
import { DIRECTOR_TRANSFORM_TOOLS } from '../features/director/transformTools'
import {
  STAGE_CONTROL_ITEMS,
  defaultStageControls,
  formatStageControlValue
} from '../features/director/stageControlItems'
import { persistStageControls } from '../features/director/persistStageControls'
import { stageControls, setStageControls } from '../editor/preferences'
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

/* ------------------------------------------------------------------ *
 * 操控灵敏度浮层
 *
 * 这里用的是**本地副本 + 防抖落盘**：
 * - 拖动时只改 `local`，但立刻把值写回偏好 `stageControls` —— 导演台是实时读偏好的，
 *   所以边拖边能感觉到手感变化，不用等落盘；
 * - 停手 400ms 后写盘（`setSettings` 是整体替换语义，每次拖动都写太浪费）；
 * - 落盘返回的是**主进程钳制后的值**，用它回填 `local`，避免「滑块显示 3 实际 2」。
 * ------------------------------------------------------------------ */
const sensItems = STAGE_CONTROL_ITEMS
const local = reactive<StageControlPreferences>({ ...stageControls.value })
const sensMenuOpen = ref(false)
const sensMenuEl = ref<HTMLElement | null>(null)
let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 拖动即时生效：导演台每次交互都读偏好，所以这里不需要等落盘 */
watch(
  local,
  (next) => {
    setStageControls(next)
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void persistStageControls(next)
        .then((saved) => Object.assign(local, saved))
        .catch((error) => console.warn('[director] persist stage controls failed:', error))
    }, 400)
  },
  { deep: true }
)

/** 外部（设置页 / 读盘）改了偏好时同步回来，避免浮层显示旧值 */
watch(stageControls, (next) => {
  for (const item of sensItems) {
    if (local[item.key] !== next[item.key]) local[item.key] = next[item.key]
  }
})

function onResetSensitivity(): void {
  Object.assign(local, defaultStageControls())
}

onBeforeUnmount(() => {
  if (persistTimer) clearTimeout(persistTimer)
})

const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>`

const SCENE_MODE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>`

const ANIM_MODE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 6V4.5"/><path d="M10.5 4h3"/><path d="M7.2 7.2l-1.1-1.1"/><path d="M12 13l3.2 2.4"/></svg>`

const BOUNDS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>`

/** 灵敏度：滑杆造型，与「重置视角」的 ⟲ 区分开 */
const SENS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="17" r="2"/></svg>`

const activeRatioIcon = computed(
  () => ratioOptions.find((option) => option.id === props.aspectRatio)?.icon ?? ratioOptions[0].icon
)

function ratioLabel(id: DirectorAspectRatio): string {
  return id === 'auto' ? t('director.stage.aspectAuto') : id
}

function closeMenus(): void {
  ratioMenuOpen.value = false
  sensMenuOpen.value = false
}

function onSetMode(mode: TransformMode): void {
  closeMenus()
  emit('setMode', mode)
}
function onSetStageMode(mode: DirectorStageEditMode): void {
  closeMenus()
  emit('setStageEditMode', mode)
}
function onReset(): void {
  closeMenus()
  emit('resetView')
}
function onCapture(): void {
  closeMenus()
  emit('capture')
}
function onToggleSelectionBounds(): void {
  closeMenus()
  emit('toggleSelectionBounds')
}
function toggleRatioMenu(): void {
  ratioMenuOpen.value = !ratioMenuOpen.value
  sensMenuOpen.value = false
}
function toggleSensMenu(): void {
  sensMenuOpen.value = !sensMenuOpen.value
  ratioMenuOpen.value = false
}
function onPickRatio(ratio: DirectorAspectRatio): void {
  emit('setAspectRatio', ratio)
  ratioMenuOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!ratioMenuOpen.value && !sensMenuOpen.value) return
  const target = event.target as HTMLElement | null
  if (ratioMenuEl.value?.contains(target)) return
  if (sensMenuEl.value?.contains(target)) return
  if (target?.closest('.toolbar-wrap')) return
  closeMenus()
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
}

.ratio-menu {
  min-width: 292px;
}

/* 灵敏度浮层：比比例菜单窄一点，5 行滑杆 */
.sens-menu {
  width: 268px;
  padding: 10px 12px 12px;
  border-radius: 12px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sens-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--text);
}

/* 「拖动即时生效」的说明：浮层里没有保存按钮，不说清楚会让人以为没生效 */
.sens-hint {
  margin: -2px 0 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
}

.sens-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.sens-value {
  color: var(--text-muted);
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.sens-row input[type='range'] {
  width: 100%;
}

.sens-reset {
  align-self: flex-start;
  margin-top: 2px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.sens-reset:hover {
  background: var(--bg-hover);
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
