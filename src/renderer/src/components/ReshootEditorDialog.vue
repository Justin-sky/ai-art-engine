<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="1120"
    :default-height="660"
    :min-width="840"
    :min-height="520"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="reshoot-editor">
      <div class="stage-col">
        <div v-if="videoUrl && !videoError" class="stage">
          <video
            ref="videoEl"
            class="video-el"
            :src="videoUrl"
            playsinline
            preload="auto"
            @loadedmetadata="onLoaded"
            @durationchange="onLoaded"
            @timeupdate="onTimeUpdate"
            @play="playing = true"
            @pause="playing = false"
            @seeked="onSeeked"
            @error="onVideoError"
          />

          <div class="transport" @pointerdown.stop @click.stop @wheel.stop>
            <div class="transport-actions">
              <button
                type="button"
                class="ctrl-btn"
                :title="t('graph.media.restart')"
                @click="seekToStart"
              >
                <span class="icon-restart" />
              </button>
              <button
                type="button"
                class="ctrl-btn"
                :title="t('graph.inspector.framePull.prevFrame')"
                @click="stepPrev"
              >
                <span class="icon-step-back" />
              </button>
              <button
                type="button"
                class="ctrl-btn primary"
                :title="playing ? t('graph.media.pause') : t('graph.media.play')"
                @click="togglePlayback"
              >
                <span :class="{ pause: playing, triangle: !playing }" />
              </button>
              <button
                type="button"
                class="ctrl-btn"
                :title="t('graph.inspector.framePull.nextFrame')"
                @click="stepNext"
              >
                <span class="icon-step-fwd" />
              </button>
              <div class="time-row inline">
                <span>{{ formatTime(time) }} / {{ formatTime(duration) }}</span>
              </div>
            </div>
            <div class="progress-wrap">
              <input
                class="progress"
                type="range"
                min="0"
                max="1000"
                step="1"
                :value="progressValue"
                @input="onSeekInput"
                @change="onSeekChange"
              />
            </div>
            <div class="segment-summary" :class="{ active: segmentActive }">
              <span class="segment-dot start" />
              <span>{{ formatTime(startSec) }}</span>
              <span class="segment-arrow">→</span>
              <span>{{ formatTime(endSec) }}</span>
              <span class="segment-dot end" />
              <span v-if="segmentActive" class="segment-range">
                {{ t('graph.inspector.reshoot.range', { range: segmentRange }) }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="stage empty">
          <span>{{
            videoError
              ? t('graph.preview.videoError')
              : t('graph.inspector.reshoot.noSource')
          }}</span>
        </div>
      </div>

      <div class="side-col">
        <div class="segment">
          <h3>{{ t('graph.inspector.reshoot.segment') }}</h3>
          <div class="segment-row">
            <button
              type="button"
              class="ghost"
              :disabled="!videoUrl || videoError"
              @click="markStart"
            >
              {{ t('graph.inspector.reshoot.markStart', { time: formatTime(time) }) }}
            </button>
            <button
              type="button"
              class="ghost"
              :disabled="!videoUrl || videoError"
              @click="markEnd"
            >
              {{ t('graph.inspector.reshoot.markEnd', { time: formatTime(time) }) }}
            </button>
          </div>
          <div class="segment-inputs">
            <label>
              {{ t('graph.inspector.reshoot.start') }}
              <input
                type="number"
                min="0"
                step="0.1"
                :value="startSec"
                @input="onStartInput"
              />
            </label>
            <label>
              {{ t('graph.inspector.reshoot.end') }}
              <input
                type="number"
                min="0"
                step="0.1"
                :value="endSec"
                @input="onEndInput"
              />
            </label>
          </div>
          <p class="segment-hint">{{ t('graph.inspector.reshoot.segmentHint') }}</p>
        </div>

        <div class="instruction-block">
          <div class="instruction-header">
            <span class="instruction-label">{{ t('graph.inspector.reshoot.instruction') }}</span>
            <InstructionModelSelect
              v-model="selectedModelKey"
              :options="modelOptions"
              :title="t('graph.inspector.reshoot.model')"
              :empty-label="t('graph.inspector.generate.noModels')"
              @change="persistGenerateModel"
            />
          </div>
          <GraphInstructionMentionEditor
            v-model="instruction"
            :host-id="props.hostId"
            :node-id="props.nodeId"
            :preset-kind="'reshoot'"
            :rows="6"
            :placeholder="t('graph.inspector.reshoot.instructionPlaceholder')"
            @change="persistInstruction"
            @expand="instructionDialogOpen = true"
          />
          <GraphInstructionEditorDialog
            v-if="instructionDialogMounted"
            :open="instructionDialogOpen"
            v-model="instruction"
            :host-id="props.hostId"
            :node-id="props.nodeId"
            :preset-kind="'reshoot'"
            :placeholder="t('graph.inspector.reshoot.instructionPlaceholder')"
            @change="persistInstruction"
            @close="instructionDialogOpen = false"
          />
        </div>

        <div class="actions">
          <button
            type="button"
            class="primary"
            :disabled="!videoUrl || videoError"
            @click="onClose"
          >
            {{ t('graph.inspector.reshoot.done') }}
          </button>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import GraphInstructionMentionEditor from './GraphInstructionMentionEditor.vue'
import GraphInstructionEditorDialog from './GraphInstructionEditorDialog.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamVideoUrl } from '../features/graph/model/resolveNodeUpstreamVideoUrl'
import { useFrameStepper } from '../composables/useFrameStepper'
import { useProjectStore } from '../stores/project'
import {
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'

const props = defineProps<{
  open: boolean
  hostId: string
  nodeId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const windowTitle = computed(() => t('graph.types.video.reshoot'))

const node = computed(() => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !props.nodeId) return null
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'video.reshoot' ? current : null
})

const videoUrl = ref('')
const duration = ref(0)
const playing = ref(false)
const seeking = ref(false)
const videoError = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)
const {
  fps,
  frame,
  time,
  refreshMetadata,
  step,
  seekToTime
} = useFrameStepper(videoEl)

const startSec = computed(() => Number(node.value?.params.reshootStartSec ?? 0))
const endSec = computed(() => Number(node.value?.params.reshootEndSec ?? 0))
const instruction = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const instructionDialogMounted = ref(false)
const instructionDialogOpen = ref(false)
const segmentActive = computed(() => {
  return (
    Number.isFinite(startSec.value) &&
    Number.isFinite(endSec.value) &&
    endSec.value > startSec.value &&
    startSec.value >= 0
  )
})
const segmentRange = computed(() => `${formatTime(startSec.value)}—${formatTime(endSec.value)}`)

const progressValue = computed(() => {
  if (!duration.value) return 0
  return Math.round((time.value / duration.value) * 1000)
})

let videoToken = 0

watch(
  () => node.value?.params.generateInstruction,
  (value) => {
    const next = String(value ?? '')
    if (next !== instruction.value) instruction.value = next
  },
  { immediate: true }
)

watch(instructionDialogOpen, (open) => {
  if (open) instructionDialogMounted.value = true
})

async function refreshModelOptions(): Promise<void> {
  const preferred = preferredModelKey(
    node.value?.params.generateProviderInstanceId ?? '',
    node.value?.params.generateModel ?? ''
  )
  const { options, selectedKey } = await loadGenerateModelOptions(
    'video',
    preferred,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

function persistInstruction(): void {
  updateParams({ generateInstruction: instruction.value })
}

function persistGenerateModel(): void {
  const parsed = parseModelKey(selectedModelKey.value)
  updateParams({
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function syncFromVideo(): void {
  const v = videoEl.value
  if (!v) return
  time.value = v.currentTime || 0
  frame.value = Math.round(time.value * fps.value)
}

async function refreshVideo(): Promise<void> {
  const token = ++videoToken
  if (!props.open || !props.hostId || !props.nodeId) {
    videoUrl.value = ''
    duration.value = 0
    return
  }
  const document = graphEditorHosts.getDocument(props.hostId)
  const runStates = graphRunHosts.get(props.hostId)?.runStates
  const { url } = await resolveNodeUpstreamVideoUrl({
    document,
    nodeId: props.nodeId,
    runStates,
    assets: project.assets
  })
  if (token !== videoToken) return
  videoUrl.value = url
  duration.value = 0
  videoError.value = false
}

watch([() => props.open, () => props.hostId, () => props.nodeId, node], refreshVideo, {
  immediate: true
})

function onLoaded(): void {
  const v = videoEl.value
  if (!v) return
  duration.value = Number.isFinite(v.duration) ? v.duration : 0
  refreshMetadata()
  syncFromVideo()
}

function onTimeUpdate(): void {
  if (!seeking.value) syncFromVideo()
}

function onSeeked(): void {
  syncFromVideo()
}

function onVideoError(): void {
  if (!videoUrl.value) return
  videoError.value = true
  playing.value = false
}

function onSeekInput(e: Event): void {
  seeking.value = true
  if (!duration.value) return
  const value = Number((e.target as HTMLInputElement).value)
  time.value = (value / 1000) * duration.value
}

function onSeekChange(e: Event): void {
  seeking.value = false
  if (!duration.value) return
  const value = Number((e.target as HTMLInputElement).value)
  void seekToTime((value / 1000) * duration.value)
}

async function togglePlayback(): Promise<void> {
  const v = videoEl.value
  if (!v) return
  if (!v.paused) {
    v.pause()
    playing.value = false
    return
  }
  playing.value = true
  try {
    await v.play()
    playing.value = !v.paused
  } catch {
    playing.value = false
  }
}

function seekToStart(): void {
  void seekToTime(0)
}

function stepPrev(): void {
  void step(-1)
}

function stepNext(): void {
  void step(1)
}

function updateParams(patch: Record<string, unknown>): void {
  if (!props.hostId || !props.nodeId) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, patch)
}

function markStart(): void {
  updateParams({ reshootStartSec: Math.round(time.value * 100) / 100 })
}

function markEnd(): void {
  updateParams({ reshootEndSec: Math.round(time.value * 100) / 100 })
}

function onStartInput(e: Event): void {
  updateParams({ reshootStartSec: Number((e.target as HTMLInputElement).value) })
}

function onEndInput(e: Event): void {
  updateParams({ reshootEndSec: Number((e.target as HTMLInputElement).value) })
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.open) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (!node.value || !videoUrl.value) return
  if (e.key === ',' || e.key === '<') {
    e.preventDefault()
    stepPrev()
  } else if (e.key === '.' || e.key === '>') {
    e.preventDefault()
    stepNext()
  } else if (e.key === ' ') {
    e.preventDefault()
    void togglePlayback()
  }
}

function onClose(): void {
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void refreshModelOptions()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  videoToken += 1
})
</script>

<style scoped>
.reshoot-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 12px;
  height: 100%;
  padding: 14px;
  box-sizing: border-box;
}

.stage-col {
  min-width: 0;
}

.stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}

.stage.empty {
  min-height: 240px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.video-el {
  width: 100%;
  max-height: 400px;
  background: #000;
  border-radius: 8px;
  outline: none;
}

.transport {
  display: flex;
  flex-direction: column;
  gap: 8px;
  user-select: none;
}

.transport-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.ctrl-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
}

.ctrl-btn .triangle {
  width: 0;
  height: 0;
  border-left: 9px solid currentColor;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  margin-left: 2px;
}

.ctrl-btn .pause {
  width: 8px;
  height: 12px;
  border-left: 3px solid currentColor;
  border-right: 3px solid currentColor;
}

.ctrl-btn .icon-restart {
  width: 11px;
  height: 11px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  position: relative;
}

.ctrl-btn .icon-restart::after {
  content: '';
  position: absolute;
  right: -3px;
  top: -3px;
  border-left: 4px solid currentColor;
  border-top: 2px solid transparent;
  border-bottom: 2px solid transparent;
}

.ctrl-btn .icon-step-back {
  width: 0;
  height: 0;
  border-right: 8px solid currentColor;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  position: relative;
  margin-right: 4px;
}

.ctrl-btn .icon-step-back::after {
  content: '';
  position: absolute;
  left: 3px;
  top: -6px;
  width: 2px;
  height: 12px;
  background: currentColor;
}

.ctrl-btn .icon-step-fwd {
  width: 0;
  height: 0;
  border-left: 8px solid currentColor;
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  position: relative;
  margin-left: 4px;
}

.ctrl-btn .icon-step-fwd::after {
  content: '';
  position: absolute;
  right: 3px;
  top: -6px;
  width: 2px;
  height: 12px;
  background: currentColor;
}

.time-row {
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.time-row.inline {
  margin-left: 6px;
}

.progress-wrap {
  display: flex;
  align-items: center;
}

.progress {
  width: 100%;
  accent-color: var(--accent);
}

.segment-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.segment-summary.active {
  border-color: var(--accent);
  color: var(--text);
}

.segment-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.segment-dot.start {
  background: var(--accent);
}

.segment-dot.end {
  background: #e5484d;
}

.segment-arrow {
  color: var(--text-muted);
}

.segment-range {
  margin-left: auto;
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.segment h3 {
  margin: 0 0 8px;
  font-size: 13px;
}

.segment-row {
  display: flex;
  gap: 8px;
}

.segment-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.segment-inputs label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.segment-inputs input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
}

.segment-hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.instruction-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.instruction-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.instruction-label {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.actions {
  margin-top: auto;
}

.actions .primary {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}

.actions .primary:disabled,
.segment-row .ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.segment-row .ghost {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
</style>
