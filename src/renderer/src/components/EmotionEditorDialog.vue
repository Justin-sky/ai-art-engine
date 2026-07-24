<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="820"
    :default-height="520"
    :min-width="680"
    :min-height="420"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="body">
        <div class="preview-pane">
          <img v-if="previewUrl" class="preview-img" :src="previewUrl" alt="" />
          <div v-else class="preview-empty">
            <span class="empty-icon">😶</span>
            <span>{{ t('graph.emotion.previewEmpty') }}</span>
          </div>
        </div>

        <div class="pad-pane">
          <div class="pad-frame">
            <span class="axis-y-max">{{ t('graph.emotion.axis.excited') }}</span>
            <div class="pad-mid">
              <span class="axis-x-min">{{ t('graph.emotion.axis.close') }}</span>
              <div
                class="pad-grid"
                @pointerdown="onPadPointer"
                @pointermove="onPadPointer"
              >
                <button
                  v-for="cell in cells"
                  :key="`${cell.x}-${cell.y}`"
                  type="button"
                  class="pad-dot"
                  :class="{
                    active: cell.x === draft.gridX && cell.y === draft.gridY,
                    cross:
                      cell.x === draft.gridX || cell.y === draft.gridY,
                    center: cell.x === 2 && cell.y === 2
                  }"
                  :style="{ gridColumn: cell.x + 1, gridRow: 5 - cell.y }"
                  :title="cell.label"
                  @click="selectCell(cell.x, cell.y)"
                />
              </div>
              <span class="axis-x-max">{{ t('graph.emotion.axis.distant') }}</span>
            </div>
            <span class="axis-y-min">{{ t('graph.emotion.axis.calm') }}</span>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <div class="locate">
          <span class="locate-label">{{ t('graph.emotion.locate') }}</span>
          <strong class="locate-value">{{ currentLabel }}</strong>
        </div>
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.emotion.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  DEFAULT_EMOTION_PAD,
  EMOTION_GRID,
  EMOTION_GRID_SIZE,
  clampEmotionIndex,
  emotionPadToNodePatch,
  getEmotionCell,
  normalizeEmotionPad,
  type EmotionGridIndex,
  type EmotionPadState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  previewUrl?: string | null
  setup?: Partial<EmotionPadState> | null
}>()

const emit = defineEmits<{
  close: []
  save: [payload: ReturnType<typeof emotionPadToNodePatch>]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.emotion.appMark'))

const draft = reactive<EmotionPadState>(normalizeEmotionPad())

const cells = computed(() => {
  const list: Array<{ x: EmotionGridIndex; y: EmotionGridIndex; label: string }> = []
  for (let y = 0; y < EMOTION_GRID_SIZE; y++) {
    for (let x = 0; x < EMOTION_GRID_SIZE; x++) {
      list.push({
        x: x as EmotionGridIndex,
        y: y as EmotionGridIndex,
        label: EMOTION_GRID[y]![x]!.label
      })
    }
  }
  return list
})

const currentLabel = computed(() => getEmotionCell(draft).label)

const dirty = computed(() => {
  const a = normalizeEmotionPad(props.setup)
  const b = normalizeEmotionPad(draft)
  return a.gridX !== b.gridX || a.gridY !== b.gridY
})

watch(
  () => [props.open, props.setup] as const,
  ([open]) => {
    if (!open) return
    Object.assign(draft, normalizeEmotionPad(props.setup))
  },
  { immediate: true, deep: true }
)

function selectCell(x: EmotionGridIndex, y: EmotionGridIndex): void {
  draft.gridX = x
  draft.gridY = y
}

function resetParams(): void {
  Object.assign(draft, normalizeEmotionPad(DEFAULT_EMOTION_PAD))
}

function onPadPointer(e: PointerEvent): void {
  if (e.type === 'pointermove' && e.buttons === 0) return
  const target = e.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  const u = (e.clientX - rect.left) / Math.max(1, rect.width)
  const v = (e.clientY - rect.top) / Math.max(1, rect.height)
  const x = clampEmotionIndex(u * (EMOTION_GRID_SIZE - 1))
  // 屏幕向下为平静(y小)，向上为激动(y大)
  const y = clampEmotionIndex((1 - v) * (EMOTION_GRID_SIZE - 1))
  selectCell(x, y)
}

function save(): void {
  emit('save', emotionPadToNodePatch(normalizeEmotionPad(draft)))
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
  height: 100%;
  min-height: 0;
  padding: 12px 14px;
  box-sizing: border-box;
  gap: 12px;
}

.body {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.preview-pane {
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  background: var(--graph-preview-bg);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted, #9aa3ad);
  font-size: 12px;
}

.empty-icon {
  font-size: 36px;
  opacity: 0.7;
}

.pad-pane {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.pad-frame {
  width: min(100%, 360px);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  justify-items: center;
}

.axis-y-max,
.axis-y-min,
.axis-x-min,
.axis-x-max {
  font-size: 12px;
  color: var(--text-muted, #9aa3ad);
}

.pad-mid {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
}

.pad-grid {
  aspect-ratio: 1 / 1;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-template-rows: repeat(5, 1fr);
  place-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border, #3a4048);
  border-radius: 14px;
  padding: 14px;
  box-sizing: border-box;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.pad-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: color-mix(in srgb, var(--text-muted) 55%, transparent);
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.pad-dot.cross {
  background: color-mix(in srgb, var(--text) 72%, transparent);
}

.pad-dot.center:not(.active) {
  background: transparent;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.pad-dot.active {
  width: 18px;
  height: 18px;
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

.pad-dot:hover {
  transform: scale(1.15);
}

.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.locate {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}

.locate-label {
  color: var(--text-muted, #9aa3ad);
}

.locate-value {
  color: var(--text, #e8eaed);
  font-weight: 600;
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

@media (max-width: 760px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>
