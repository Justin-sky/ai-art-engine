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
          <img
            class="emotion-preview"
            :src="emotionPreviewUrl"
            :alt="currentLabel"
            :title="currentLabel"
            draggable="false"
          />
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
        <ImageGenerateModelField
          ref="modelFieldEl"
          :open="open"
          :generate-model="generateModel"
          :generate-provider-instance-id="generateProviderInstanceId"
          @change="onModelChange"
        />
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.emotion.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
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
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

/** 预切好的 5×5 小图：每格已向内缩 6px，并去掉深色背景 */
const emotionCellModules = import.meta.glob('../assets/emotion-pad/cells/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>

const emotionCellUrls: Record<string, string> = {}
for (const [path, url] of Object.entries(emotionCellModules)) {
  const name = path.split('/').pop()?.replace(/\.png$/i, '')
  if (name) emotionCellUrls[name] = url
}

const props = defineProps<{
  open: boolean
  previewUrl?: string | null
  setup?: Partial<EmotionPadState> | null
  generateModel?: string
  generateProviderInstanceId?: string
}>()

export type EmotionEditorSavePayload = ReturnType<typeof emotionPadToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

const emit = defineEmits<{
  close: []
  update: [payload: EmotionEditorSavePayload]
  save: [payload: EmotionEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.emotion.appMark'))

const draft = reactive<EmotionPadState>(normalizeEmotionPad())
const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
} | null>(null)
const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})

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

const emotionPreviewUrl = computed(
  () => emotionCellUrls[`${draft.gridX}-${draft.gridY}`] ?? emotionCellUrls['2-2'] ?? ''
)

const dirty = computed(() => {
  const a = normalizeEmotionPad(props.setup)
  const b = normalizeEmotionPad(draft)
  const modelDirty =
    modelDraft.generateModel !== (props.generateModel ?? '') ||
    modelDraft.generateProviderInstanceId !== (props.generateProviderInstanceId ?? '')
  return a.gridX !== b.gridX || a.gridY !== b.gridY || modelDirty
})

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  modelDraft.generateModel = payload.generateModel
  modelDraft.generateProviderInstanceId = payload.generateProviderInstanceId
}

const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

function buildSavePayload(): EmotionEditorSavePayload {
  const model = modelFieldEl.value?.currentSelection() ?? { ...modelDraft }
  return {
    ...emotionPadToNodePatch(normalizeEmotionPad(draft)),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, normalizeEmotionPad(props.setup))
    modelDraft.generateModel = props.generateModel ?? ''
    modelDraft.generateProviderInstanceId = props.generateProviderInstanceId ?? ''
    void nextTick(() => {
      hydrating.value = false
      emitPreview()
    })
  },
  { immediate: true }
)

watch(draft, () => emitPreview(), { deep: true })
watch(modelDraft, () => emitPreview(), { deep: true })

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
  emit('save', buildSavePayload())
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
  position: relative;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--graph-preview-bg);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
}

.emotion-preview {
  width: min(72%, 280px);
  aspect-ratio: 1 / 1;
  flex: none;
  object-fit: contain;
  display: block;
  border-radius: 14px;
  background: transparent;
  user-select: none;
  -webkit-user-drag: none;
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
  color: var(--text-muted);
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
  border: 1px solid var(--border);
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
  color: var(--text-muted);
}

.locate-value {
  color: var(--text);
  font-weight: 600;
}

.reset-btn {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
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
