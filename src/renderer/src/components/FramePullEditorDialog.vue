<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="1220"
    :default-height="720"
    :min-width="920"
    :min-height="560"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="frame-pull-editor">
      <div class="stage-col">
        <div v-if="videoUrl && !videoError" class="stage">
          <div
            v-if="hasSplicedVideo"
            class="spliced-banner"
            :class="{ original: previewingOriginal }"
          >
            <span class="spliced-dot" />
            <span class="spliced-text">
              {{
                previewingOriginal
                  ? t('graph.inspector.framePull.splicedBannerOriginal')
                  : t('graph.inspector.framePull.splicedBanner', { n: spliceHistory.length || 1 })
              }}
            </span>
            <div class="spliced-actions">
              <button
                v-if="sourceVideoRelativePath"
                type="button"
                class="banner-btn"
                :disabled="reshootRunning"
                @click="toggleCompareOriginal"
              >
                {{
                  previewingOriginal
                    ? t('graph.inspector.framePull.viewSpliced')
                    : t('graph.inspector.framePull.compareOriginal')
                }}
              </button>
              <button
                v-if="spliceHistory.length > 0"
                type="button"
                class="banner-btn"
                :disabled="reshootRunning"
                @click="undoLastSplice"
              >
                {{ t('graph.inspector.framePull.undoLastSplice') }}
              </button>
              <button
                type="button"
                class="banner-btn danger"
                :disabled="reshootRunning"
                @click="restoreOriginalVideo"
              >
                {{ t('graph.inspector.framePull.restoreOriginal') }}
              </button>
            </div>
          </div>

          <video
            ref="videoEl"
            class="video-el"
            :src="videoUrl"
            playsinline
            preload="auto"
            crossorigin="anonymous"
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

              <div class="range-mark-group">
                <button
                  type="button"
                  class="range-btn"
                  :disabled="!videoUrl || videoError"
                  @click="markInPoint"
                >
                  {{ t('graph.inspector.framePull.markIn') }}
                </button>
                <button
                  type="button"
                  class="range-btn"
                  :disabled="!videoUrl || videoError"
                  @click="markOutPoint"
                >
                  {{ t('graph.inspector.framePull.markOut') }}
                </button>
                <button
                  v-if="rangeInfo.valid"
                  type="button"
                  class="range-btn"
                  :class="{ active: loopRange }"
                  @click="loopRange = !loopRange"
                >
                  {{ t('graph.inspector.framePull.loopRange') }}
                </button>
                <button
                  v-if="rangeInfo.valid"
                  type="button"
                  class="range-btn ghost"
                  @click="clearRange"
                >
                  {{ t('graph.inspector.framePull.clearRange') }}
                </button>
              </div>

              <div class="time-row inline">
                <span>{{
                  t('graph.inspector.framePull.frameLabel', {
                    frame,
                    total: displayTotalFrames > 0 ? displayTotalFrames : '—'
                  })
                }}</span>
                <span>{{ formatTime(time) }} / {{ formatTime(duration) }}</span>
              </div>
            </div>

            <div class="progress-wrap">
              <div
                v-if="rangeInfo.valid && duration > 0"
                class="progress-range-bar"
                :style="progressRangeStyle"
              />
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

            <div
              v-if="filmstrip.length"
              ref="filmstripEl"
              class="filmstrip"
              @pointerleave="onFilmstripPointerLeave"
            >
              <button
                v-for="thumb in filmstrip"
                :key="thumb.frame"
                type="button"
                class="filmstrip-thumb"
                :class="{
                  active: isFilmstripActive(thumb.frame),
                  'in-range': isThumbInRange(thumb.frame),
                  'is-in-point': isThumbInPoint(thumb.frame),
                  'is-out-point': isThumbOutPoint(thumb.frame),
                  captured: capturedFrameSet.has(thumb.frame)
                }"
                :title="
                  t('graph.inspector.framePull.frameLabel', {
                    frame: thumb.frame,
                    total: displayTotalFrames
                  })
                "
                @pointerdown="onThumbPointerDown(thumb.frame, $event)"
                @pointerenter="onThumbPointerEnter(thumb.frame)"
                @click="onFilmstripClick(thumb.frame, $event)"
              >
                <img :src="thumb.dataUrl" alt="" loading="lazy" draggable="false" />
                <span v-if="isThumbInPoint(thumb.frame)" class="filmstrip-io-badge in">IN</span>
                <span v-else-if="isThumbOutPoint(thumb.frame)" class="filmstrip-io-badge out"
                  >OUT</span
                >
                <span v-if="capturedFrameSet.has(thumb.frame)" class="filmstrip-captured-dot" />
                <span class="filmstrip-frame-label">{{ thumb.frame }}</span>
              </button>
            </div>

            <div class="filmstrip-footer">
              <span v-if="filmstripModeLabel" class="filmstrip-mode">
                {{ filmstripModeLabel }}
              </span>
              <span class="range-status" :class="{ active: rangeInfo.valid }">
                {{
                  rangeInfo.valid
                    ? t('graph.inspector.framePull.rangeBadge', {
                        inFrame: rangeInfo.inFrame,
                        outFrame: rangeInfo.outFrame,
                        count: rangeInfo.frameCount,
                        duration: rangeInfo.segmentDurationSec.toFixed(2)
                      })
                    : t('graph.inspector.framePull.rangeHint')
                }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="stage empty">
          <span>{{
            videoError ? t('graph.preview.videoError') : t('graph.inspector.framePull.noSource')
          }}</span>
        </div>
      </div>

      <div class="side-col">
        <div class="actions">
          <button
            type="button"
            class="primary"
            :disabled="!videoUrl || videoError || reshootRunning"
            @click="captureCurrent"
          >
            {{ t('graph.inspector.framePull.capture') }}
          </button>
          <button
            type="button"
            class="ghost"
            :disabled="!videoUrl || videoError || !rangeInfo.valid || reshootRunning"
            @click="captureRangeBatch"
          >
            {{ t('graph.inspector.framePull.captureRangeBatch') }}
          </button>
          <button
            type="button"
            class="ghost"
            :disabled="!frames.length || reshootRunning"
            @click="clearFrames"
          >
            {{ t('graph.inspector.framePull.clear') }}
          </button>
          <span class="capture-count">
            {{ t('graph.inspector.framePull.captured', { n: frames.length }) }}
          </span>
        </div>

        <div class="side-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="side-tab"
            :class="{ active: activeSideTab === 'reshoot' }"
            @click="activeSideTab = 'reshoot'"
          >
            {{ t('graph.inspector.framePull.tabReshoot') }}
          </button>
          <button
            type="button"
            role="tab"
            class="side-tab"
            :class="{ active: activeSideTab === 'frames' }"
            @click="activeSideTab = 'frames'"
          >
            {{ t('graph.inspector.framePull.tabFrames', { n: frames.length }) }}
          </button>
        </div>

        <div v-if="activeSideTab === 'reshoot'" class="reshoot-panel">
          <div class="anchor-grid">
            <div class="anchor-card">
              <div class="anchor-head">
                <span class="anchor-title">
                  {{ t('graph.inspector.framePull.anchorInTitle') }}
                  <strong v-if="rangeInfo.valid">F{{ rangeInfo.inFrame }}</strong>
                </span>
                <button
                  v-if="rangeInfo.valid"
                  type="button"
                  class="link-btn"
                  @click="seekToFrame(rangeInfo.inFrame)"
                >
                  {{ t('graph.inspector.framePull.anchorJump') }}
                </button>
              </div>
              <div class="anchor-thumb-wrap">
                <img v-if="inAnchorPreviewUrl" :src="inAnchorPreviewUrl" alt="" />
                <span v-else class="anchor-empty">IN</span>
              </div>
              <select
                class="anchor-select"
                :value="firstFrameOverrideId"
                @change="onFirstFrameOverrideChange"
              >
                <option value="">
                  {{
                    t('graph.inspector.framePull.anchorAutoFrame', {
                      frame: rangeInfo.valid ? rangeInfo.inFrame : frame
                    })
                  }}
                </option>
                <option v-for="item in frames" :key="item.id" :value="item.id">
                  {{ frameItemLabel(item) }}
                </option>
              </select>
            </div>

            <div class="anchor-card" :class="{ muted: conditioningMode === 'first_only' }">
              <div class="anchor-head">
                <span class="anchor-title">
                  {{ t('graph.inspector.framePull.anchorOutTitle') }}
                  <strong v-if="rangeInfo.valid">F{{ rangeInfo.outFrame }}</strong>
                </span>
                <button
                  v-if="rangeInfo.valid"
                  type="button"
                  class="link-btn"
                  @click="seekToFrame(rangeInfo.outFrame)"
                >
                  {{ t('graph.inspector.framePull.anchorJump') }}
                </button>
              </div>
              <div class="anchor-thumb-wrap">
                <img v-if="outAnchorPreviewUrl" :src="outAnchorPreviewUrl" alt="" />
                <span v-else class="anchor-empty">OUT</span>
              </div>
              <select
                class="anchor-select"
                :value="lastFrameOverrideId"
                :disabled="conditioningMode === 'first_only'"
                @change="onLastFrameOverrideChange"
              >
                <option value="">
                  {{
                    t('graph.inspector.framePull.anchorAutoFrame', {
                      frame: rangeInfo.valid ? rangeInfo.outFrame : frame
                    })
                  }}
                </option>
                <option v-for="item in frames" :key="item.id" :value="item.id">
                  {{ frameItemLabel(item) }}
                </option>
              </select>
            </div>
          </div>

          <div class="form-grid">
            <label class="form-field">
              <span>{{ t('graph.inspector.framePull.conditioningLabel') }}</span>
              <select :value="conditioningMode" @change="onConditioningModeChange">
                <option value="first_last">
                  {{ t('graph.inspector.framePull.conditioningFirstLast') }}
                </option>
                <option value="first_only">
                  {{ t('graph.inspector.framePull.conditioningFirstOnly') }}
                </option>
                <option value="video_ref">
                  {{ t('graph.inspector.framePull.conditioningVideoRef') }}
                </option>
              </select>
            </label>

            <label class="form-field">
              <span>{{ t('graph.inspector.framePull.fitModeLabel') }}</span>
              <select :value="fitMode" @change="onFitModeChange">
                <option value="stretch">
                  {{ t('graph.inspector.framePull.fitModeStretch') }}
                </option>
                <option value="trim">
                  {{ t('graph.inspector.framePull.fitModeTrim') }}
                </option>
              </select>
            </label>

            <label class="checkbox-field">
              <input type="checkbox" :checked="keepAudio" @change="onKeepAudioChange" />
              <span>{{ t('graph.inspector.framePull.keepAudioLabel') }}</span>
            </label>
          </div>

          <div class="instruction-section">
            <div class="instruction-header">
              <span class="instruction-label">{{
                t('graph.inspector.framePull.instructionLabel')
              }}</span>
              <InstructionModelSelect
                v-model="selectedModelKey"
                :options="modelOptions"
                :title="t('graph.inspector.framePull.modelLabel')"
                :empty-label="t('graph.inspector.generate.noModels')"
                @change="persistGenerateModel"
              />
            </div>

            <div class="preset-chips">
              <button
                v-for="preset in reshootPresets"
                :key="preset.key"
                type="button"
                class="preset-chip"
                @click="applyReshootPreset(preset.prompt)"
              >
                {{ preset.label }}
              </button>
            </div>

            <div v-if="rangeNotes.length > 0" class="notes-merged-badge">
              {{ t('graph.inspector.framePull.notesMergedBadge', { n: rangeNotes.length }) }}
            </div>

            <GraphInstructionMentionEditor
              v-model="instruction"
              :host-id="props.hostId"
              :node-id="props.nodeId"
              :preset-kind="'reshoot'"
              :rows="4"
              :placeholder="t('graph.inspector.framePull.instructionPlaceholder')"
              @change="persistInstruction"
              @expand="instructionDialogOpen = true"
            />
            <GraphInstructionEditorDialog
              v-if="instructionDialogMounted"
              v-model="instruction"
              :open="instructionDialogOpen"
              :host-id="props.hostId"
              :node-id="props.nodeId"
              :preset-kind="'reshoot'"
              :placeholder="t('graph.inspector.framePull.instructionPlaceholder')"
              @change="persistInstruction"
              @close="instructionDialogOpen = false"
            />
          </div>

          <div class="reshoot-run-box">
            <button
              type="button"
              class="run-reshoot-btn"
              :disabled="!videoUrl || videoError || reshootRunning"
              @click="runSegmentReshootAndSplice"
            >
              {{ reshootRunning ? reshootStepText : t('graph.inspector.framePull.runReshootBtn') }}
            </button>
            <p v-if="reshootError" class="reshoot-error">{{ reshootError }}</p>
          </div>

          <div v-if="spliceHistory.length > 0" class="splice-history">
            <div class="history-head">
              <span>{{
                t('graph.inspector.framePull.historyTitle', { n: spliceHistory.length })
              }}</span>
            </div>
            <div class="history-list">
              <button
                v-for="rec in spliceHistory"
                :key="rec.id"
                type="button"
                class="history-item"
                @click="selectHistoryRecord(rec)"
              >
                <span class="history-range">
                  {{
                    t('graph.inspector.framePull.historyItemLabel', {
                      inFrame: rec.inFrame,
                      outFrame: rec.outFrame,
                      duration: Math.max(0.1, rec.outSec - rec.inSec).toFixed(2)
                    })
                  }}
                </span>
                <span class="history-prompt">{{ rec.instruction || '—' }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-else class="frames-panel">
          <div v-if="frames.length" class="frames">
            <div
              v-for="item in frames"
              :key="item.id"
              class="frame-item"
              :class="{ active: item.id === selectedFrameId }"
              @click="selectFrame(item.id)"
            >
              <img :src="item.dataUrl" alt="" loading="lazy" />
              <span class="frame-meta">{{ frameItemLabel(item) }}</span>
              <button
                type="button"
                class="frame-remove"
                :title="t('graph.inspector.framePull.remove')"
                @click.stop="removeFrame(item.id)"
              >
                ×
              </button>
            </div>
          </div>
          <p v-else class="frames-empty">
            {{ t('graph.inspector.framePull.framesEmpty') }}
          </p>

          <label v-if="selectedFrameId" class="note">
            {{ t('graph.inspector.framePull.note') }}
            <textarea
              :value="currentNote"
              rows="4"
              :placeholder="t('graph.inspector.framePull.notePlaceholder')"
              @input="onNoteInput"
            />
          </label>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildFramePullReshootPrompt,
  buildFramePullSpliceSegments,
  collectMentionedIndexes,
  collectRangeFrameNotes,
  computeAdaptiveFilmstripTimes,
  expandIncomingThroughBundles,
  isBoundaryInputNode,
  normalizeFramePullRange,
  parsePulledFrameIndex,
  recommendVideoGenerationDuration,
  resolveFramePullReshootSystemPrompt,
  softResolveBoundaryInputParams,
  type FramePullConditioningMode,
  type FramePullFilmstripMode,
  type FramePullFitMode,
  type FramePullSpliceRecord,
  type GraphImageItem,
  type GraphNode
} from '@shared/graph'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import GraphInstructionMentionEditor from './GraphInstructionMentionEditor.vue'
import GraphInstructionEditorDialog from './GraphInstructionEditorDialog.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamVideoUrl } from '../features/graph/model/resolveNodeUpstreamVideoUrl'
import { invalidateAssetUrlCache, resolveAssetFileUrl } from '../features/media/assetUrlCache'
import {
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { useFrameStepper } from '../composables/useFrameStepper'
import { useProjectStore } from '../stores/project'

const props = defineProps<{
  open: boolean
  hostId: string
  nodeId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t, locale } = useStudioI18n()
const project = useProjectStore()

const windowTitle = computed(() => t('graph.types.video.framePull'))

const node = computed(() => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !props.nodeId) return null
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'video.framePull' ? current : null
})

const videoUrl = ref('')
const videoRelativePath = ref('')
const upstreamVideoRelativePath = ref('')
const previewingOriginal = ref(false)
const duration = ref(0)
const playing = ref(false)
const seeking = ref(false)
const videoError = ref(false)
const loopRange = ref(false)
const activeSideTab = ref<'reshoot' | 'frames'>('reshoot')

const filmstrip = ref<Array<{ frame: number; dataUrl: string }>>([])
const filmstripEl = ref<HTMLElement | null>(null)
const filmstripMode = ref<FramePullFilmstripMode>('')
let followFilmstrip = false

const draggingRange = ref(false)
const dragAnchorFrame = ref<number | null>(null)

const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const instruction = ref('')
const instructionDialogMounted = ref(false)
const instructionDialogOpen = ref(false)
const reshootRunning = ref(false)
const reshootStep = ref<'capture' | 'generate' | 'splice'>('capture')
const reshootError = ref('')

const videoEl = ref<HTMLVideoElement | null>(null)
const {
  fps,
  frame,
  totalFrames,
  time,
  measureFps,
  refreshMetadata,
  step,
  seekToTime,
  captureFrame
} = useFrameStepper(videoEl)

const progressValue = computed(() => {
  if (!duration.value) return 0
  return Math.round((time.value / duration.value) * 1000)
})

const frames = computed<GraphImageItem[]>(() => node.value?.params.generatedImages ?? [])
const selectedFrameId = computed(() => node.value?.params.selectedImageId ?? '')
const currentNote = computed(() => {
  const notes = node.value?.params.frameNotes
  return (notes && selectedFrameId.value && notes[selectedFrameId.value]) || ''
})

const cachedFilmstrip = computed(() => node.value?.params.frameFilmstrip ?? [])
const cachedTotalFrames = computed(() => node.value?.params.frameFilmstripTotalFrames ?? 0)
const cachedFps = computed(() => node.value?.params.frameFilmstripFps ?? 0)

const displayTotalFrames = computed(() => {
  if (cachedFilmstrip.value.length && cachedTotalFrames.value > 0) {
    return cachedTotalFrames.value
  }
  return totalFrames.value > 0 ? totalFrames.value : 0
})

const rangeInfo = computed(() =>
  normalizeFramePullRange({
    inFrame: node.value?.params.framePullInFrame,
    outFrame: node.value?.params.framePullOutFrame,
    totalFrames: displayTotalFrames.value,
    fps: fps.value,
    durationSec: duration.value
  })
)

const progressRangeStyle = computed(() => {
  if (!rangeInfo.value.valid || duration.value <= 0) return {}
  const leftPct = Math.max(0, Math.min(100, (rangeInfo.value.inSec / duration.value) * 100))
  const widthPct = Math.max(
    1,
    Math.min(
      100 - leftPct,
      ((rangeInfo.value.outSec - rangeInfo.value.inSec) / duration.value) * 100
    )
  )
  return {
    left: `${leftPct.toFixed(2)}%`,
    width: `${widthPct.toFixed(2)}%`
  }
})

const conditioningMode = computed<FramePullConditioningMode>(
  () => node.value?.params.framePullConditioningMode ?? 'first_last'
)
const fitMode = computed<FramePullFitMode>(() => node.value?.params.framePullFitMode ?? 'stretch')
const keepAudio = computed<boolean>(() => node.value?.params.framePullKeepAudio !== false)
const firstFrameOverrideId = computed(() => node.value?.params.framePullFirstFrameId ?? '')
const lastFrameOverrideId = computed(() => node.value?.params.framePullLastFrameId ?? '')
const spliceHistory = computed<FramePullSpliceRecord[]>(
  () => node.value?.params.framePullSpliceHistory ?? []
)
const activeSplicedPath = computed(() => node.value?.params.framePullActiveVideoPath?.trim() ?? '')
const sourceVideoRelativePath = computed(
  () =>
    node.value?.params.framePullSourceVideoPath?.trim() ||
    upstreamVideoRelativePath.value.trim() ||
    ''
)
const hasSplicedVideo = computed(() => Boolean(activeSplicedPath.value))

const rangeNotes = computed(() => {
  if (!rangeInfo.value.valid) return []
  return collectRangeFrameNotes({
    frames: frames.value,
    frameNotes: node.value?.params.frameNotes,
    inFrame: rangeInfo.value.inFrame,
    outFrame: rangeInfo.value.outFrame
  })
})

const reshootPresets = computed(() => [
  {
    key: 'artifact',
    label: t('graph.inspector.framePull.presetFixArtifact'),
    prompt: t('graph.inspector.framePull.presetFixArtifactPrompt')
  },
  {
    key: 'smooth',
    label: t('graph.inspector.framePull.presetSmoothMotion'),
    prompt: t('graph.inspector.framePull.presetSmoothMotionPrompt')
  },
  {
    key: 'acting',
    label: t('graph.inspector.framePull.presetEnhanceActing'),
    prompt: t('graph.inspector.framePull.presetEnhanceActingPrompt')
  },
  {
    key: 'camera',
    label: t('graph.inspector.framePull.presetStabilizeCam'),
    prompt: t('graph.inspector.framePull.presetStabilizeCamPrompt')
  }
])

const reshootStepText = computed(() => {
  if (reshootStep.value === 'capture') return t('graph.inspector.framePull.runningStepCapture')
  if (reshootStep.value === 'generate') return t('graph.inspector.framePull.runningStepGenerate')
  return t('graph.inspector.framePull.runningStepSplice')
})

const filmstripModeLabel = computed(() => {
  if (filmstripMode.value === 'keyframe') return t('graph.inspector.framePull.keyframeStrip')
  if (filmstripMode.value === 'hybrid') return t('graph.inspector.framePull.hybridStrip')
  if (filmstripMode.value === 'uniform') return t('graph.inspector.framePull.uniformStrip')
  if (filmstripMode.value === 'frame') return t('graph.inspector.framePull.frameStripFallback')
  return ''
})

function findFramePreviewUrl(targetFrame: number, overrideId?: string): string {
  if (overrideId) {
    const found = frames.value.find((item) => item.id === overrideId)
    if (found?.dataUrl) return found.dataUrl
  }
  const exactPulled = frames.value.find((item) => parsePulledFrameIndex(item.id) === targetFrame)
  if (exactPulled?.dataUrl) return exactPulled.dataUrl
  if (!filmstrip.value.length) return ''
  let best = filmstrip.value[0]!
  let bestDist = Math.abs(best.frame - targetFrame)
  for (const thumb of filmstrip.value) {
    const dist = Math.abs(thumb.frame - targetFrame)
    if (dist < bestDist) {
      best = thumb
      bestDist = dist
    }
  }
  return best.dataUrl
}

const inAnchorPreviewUrl = computed(() => {
  const target = rangeInfo.value.valid ? rangeInfo.value.inFrame : frame.value
  return findFramePreviewUrl(target, firstFrameOverrideId.value)
})

const outAnchorPreviewUrl = computed(() => {
  const target = rangeInfo.value.valid ? rangeInfo.value.outFrame : frame.value
  return findFramePreviewUrl(target, lastFrameOverrideId.value)
})

const capturedFrameSet = computed<Set<number>>(() => {
  const set = new Set<number>()
  for (const item of frames.value) {
    const idx = parsePulledFrameIndex(item.id)
    if (idx != null) set.add(idx)
  }
  return set
})

let videoToken = 0
let filmstripToken = 0

function updateParams(patch: Record<string, unknown>): void {
  if (!props.hostId || !props.nodeId || !node.value) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, patch)
}

watch(
  () => node.value?.params.generateInstruction,
  (val) => {
    const next = String(val ?? '')
    if (next !== instruction.value) instruction.value = next
  },
  { immediate: true }
)

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

watch(
  () => [
    props.open,
    node.value?.params.generateModel,
    node.value?.params.generateProviderInstanceId
  ],
  ([isOpen]) => {
    if (isOpen) void refreshModelOptions()
  },
  { immediate: true }
)

watch(instructionDialogOpen, (open) => {
  if (open) instructionDialogMounted.value = true
})

function persistGenerateModel(): void {
  const parsed = parseModelKey(selectedModelKey.value)
  updateParams({
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function persistInstruction(): void {
  updateParams({ generateInstruction: instruction.value })
}

function applyReshootPreset(promptText: string): void {
  const current = instruction.value.trim()
  const next = current ? `${current}；${promptText}` : promptText
  instruction.value = next
  updateParams({ generateInstruction: next })
}

function onConditioningModeChange(e: Event): void {
  const mode = (e.target as HTMLSelectElement).value as FramePullConditioningMode
  updateParams({ framePullConditioningMode: mode })
}

function onFitModeChange(e: Event): void {
  const mode = (e.target as HTMLSelectElement).value as FramePullFitMode
  updateParams({ framePullFitMode: mode })
}

function onKeepAudioChange(e: Event): void {
  const checked = (e.target as HTMLInputElement).checked
  updateParams({ framePullKeepAudio: checked })
}

function onFirstFrameOverrideChange(e: Event): void {
  const id = (e.target as HTMLSelectElement).value
  updateParams({ framePullFirstFrameId: id || undefined })
}

function onLastFrameOverrideChange(e: Event): void {
  const id = (e.target as HTMLSelectElement).value
  updateParams({ framePullLastFrameId: id || undefined })
}

function beginNavigation(): void {
  filmstripToken += 1
  followFilmstrip = true
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function hashString(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return `k${h.toString(36)}`
}

function syncFromVideo(): void {
  const v = videoEl.value
  if (!v) return
  time.value = v.currentTime || 0
  frame.value = Math.round(time.value * fps.value)
}

async function refreshVideo(): Promise<void> {
  const token = ++videoToken
  filmstripToken += 1
  filmstrip.value = []
  if (!props.open || !props.hostId || !props.nodeId) {
    videoUrl.value = ''
    videoRelativePath.value = ''
    upstreamVideoRelativePath.value = ''
    duration.value = 0
    return
  }
  const document = graphEditorHosts.getDocument(props.hostId)
  const runStates = graphRunHosts.get(props.hostId)?.runStates
  const upstream = await resolveNodeUpstreamVideoUrl({
    document,
    nodeId: props.nodeId,
    runStates,
    assets: project.assets
  })
  if (token !== videoToken) return
  upstreamVideoRelativePath.value = upstream.relativePath

  const activeRel = node.value?.params.framePullActiveVideoPath?.trim() ?? ''
  if (activeRel && !previewingOriginal.value) {
    const splicedUrl = await resolveAssetFileUrl(activeRel)
    if (token !== videoToken) return
    if (splicedUrl) {
      videoUrl.value = splicedUrl
      videoRelativePath.value = activeRel
      duration.value = 0
      videoError.value = false
      return
    }
  }

  if (previewingOriginal.value && sourceVideoRelativePath.value) {
    const origUrl = await resolveAssetFileUrl(sourceVideoRelativePath.value)
    if (token !== videoToken) return
    if (origUrl) {
      videoUrl.value = origUrl
      videoRelativePath.value = sourceVideoRelativePath.value
      duration.value = 0
      videoError.value = false
      return
    }
  }

  videoUrl.value = upstream.url
  videoRelativePath.value = upstream.relativePath
  duration.value = 0
  videoError.value = false
}

watch(
  [
    () => props.open,
    () => props.hostId,
    () => props.nodeId,
    () => node.value?.params.framePullActiveVideoPath,
    previewingOriginal
  ],
  refreshVideo,
  { immediate: true }
)

function onLoaded(): void {
  const v = videoEl.value
  if (!v) return
  duration.value = Number.isFinite(v.duration) ? v.duration : 0
  refreshMetadata()
  syncFromVideo()
  void scheduleFilmstrip()
}

function onTimeUpdate(): void {
  followFilmstrip = false
  if (!seeking.value) {
    syncFromVideo()
    const v = videoEl.value
    if (
      v &&
      !v.paused &&
      loopRange.value &&
      rangeInfo.value.valid &&
      v.currentTime >= rangeInfo.value.outSec
    ) {
      v.currentTime = rangeInfo.value.inSec
      syncFromVideo()
    }
  }
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
  beginNavigation()
  void seekToTime((value / 1000) * duration.value).then((landed) => {
    if (landed != null) syncSelectionToPosition(landed)
  })
}

async function togglePlayback(): Promise<void> {
  const v = videoEl.value
  if (!v) return
  if (!v.paused) {
    v.pause()
    playing.value = false
    return
  }
  if (
    loopRange.value &&
    rangeInfo.value.valid &&
    (v.currentTime < rangeInfo.value.inSec || v.currentTime >= rangeInfo.value.outSec)
  ) {
    v.currentTime = rangeInfo.value.inSec
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
  beginNavigation()
  void seekToTime(0).then((landed) => {
    if (landed != null) syncSelectionToPosition(landed)
  })
}

function seekToFrame(targetFrame: number): void {
  if (fps.value <= 0) return
  beginNavigation()
  void seekToTime(targetFrame / fps.value).then((landed) => {
    if (landed != null) syncSelectionToPosition(landed)
  })
}

function stepPrev(): void {
  beginNavigation()
  void step(-1).then((landed) => {
    if (landed != null) syncSelectionToPosition(landed)
  })
}

function stepNext(): void {
  beginNavigation()
  void step(1).then((landed) => {
    if (landed != null) syncSelectionToPosition(landed)
  })
}

function markInPoint(): void {
  if (!node.value) return
  const cur = Math.max(0, Math.round(frame.value))
  const maxIdx = Math.max(
    cur + 1,
    displayTotalFrames.value > 0 ? displayTotalFrames.value - 1 : cur + Math.round(fps.value * 2)
  )
  const existingOut = node.value.params.framePullOutFrame
  const nextOut =
    existingOut != null && Number.isFinite(existingOut) && existingOut > cur
      ? existingOut
      : Math.min(maxIdx, cur + Math.max(1, Math.round(fps.value * 2)))
  updateParams({
    framePullInFrame: cur,
    framePullOutFrame: nextOut
  })
}

function markOutPoint(): void {
  if (!node.value) return
  const cur = Math.max(1, Math.round(frame.value))
  const existingIn = node.value.params.framePullInFrame
  const nextIn =
    existingIn != null && Number.isFinite(existingIn) && existingIn < cur
      ? existingIn
      : Math.max(0, cur - Math.max(1, Math.round(fps.value * 2)))
  updateParams({
    framePullInFrame: nextIn,
    framePullOutFrame: cur
  })
}

function clearRange(): void {
  loopRange.value = false
  updateParams({
    framePullInFrame: undefined,
    framePullOutFrame: undefined,
    framePullFirstFrameId: undefined,
    framePullLastFrameId: undefined
  })
}

function onThumbPointerDown(frameNumber: number, e: PointerEvent): void {
  if (e.button !== 0 || e.shiftKey) return
  draggingRange.value = true
  dragAnchorFrame.value = frameNumber
}

function onThumbPointerEnter(frameNumber: number): void {
  if (!draggingRange.value || dragAnchorFrame.value == null) return
  if (frameNumber === dragAnchorFrame.value) return
  const lo = Math.min(dragAnchorFrame.value, frameNumber)
  const hi = Math.max(dragAnchorFrame.value, frameNumber)
  updateParams({
    framePullInFrame: lo,
    framePullOutFrame: hi
  })
}

function onFilmstripPointerLeave(): void {
  // Keep drag state until pointerup on window
}

function onWindowPointerUp(): void {
  draggingRange.value = false
  dragAnchorFrame.value = null
}

function isThumbInRange(frameNumber: number): boolean {
  if (!rangeInfo.value.valid) return false
  return frameNumber >= rangeInfo.value.inFrame && frameNumber <= rangeInfo.value.outFrame
}

const closestInThumbFrame = computed<number | null>(() => {
  if (!rangeInfo.value.valid || !filmstrip.value.length) return null
  let best = filmstrip.value[0]!.frame
  let bestDist = Math.abs(best - rangeInfo.value.inFrame)
  for (const item of filmstrip.value) {
    const d = Math.abs(item.frame - rangeInfo.value.inFrame)
    if (d < bestDist) {
      best = item.frame
      bestDist = d
    }
  }
  return best
})

const closestOutThumbFrame = computed<number | null>(() => {
  if (!rangeInfo.value.valid || !filmstrip.value.length) return null
  let best = filmstrip.value[0]!.frame
  let bestDist = Math.abs(best - rangeInfo.value.outFrame)
  for (const item of filmstrip.value) {
    const d = Math.abs(item.frame - rangeInfo.value.outFrame)
    if (d < bestDist) {
      best = item.frame
      bestDist = d
    }
  }
  return best
})

function isThumbInPoint(frameNumber: number): boolean {
  return rangeInfo.value.valid && closestInThumbFrame.value === frameNumber
}

function isThumbOutPoint(frameNumber: number): boolean {
  return (
    rangeInfo.value.valid &&
    closestOutThumbFrame.value === frameNumber &&
    closestOutThumbFrame.value !== closestInThumbFrame.value
  )
}

async function scheduleFilmstrip(): Promise<void> {
  followFilmstrip = false
  const v = videoEl.value
  const token = ++filmstripToken
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return

  const cacheKey = `${hashString(videoUrl.value)}:v5`
  const cached = cachedFilmstrip.value
  if (cached.length && node.value?.params.frameFilmstripKey === cacheKey) {
    filmstrip.value = cached
    filmstripMode.value = node.value?.params.frameFilmstripMode ?? ''
    if (cachedFps.value > 0) {
      fps.value = cachedFps.value
    }
    refreshMetadata()
    syncFromVideo()
    return
  }

  const prevPreload = v.preload
  v.preload = 'auto'
  try {
    const snapFps = await measureFps()
    if (token !== filmstripToken) return
    const snapTotal = Math.max(1, Math.round(v.duration * snapFps))
    let targets: number[] | null = null
    if (videoRelativePath.value.trim()) {
      try {
        targets = await window.studio.detectVideoKeyframes(videoRelativePath.value)
      } catch {
        targets = null
      }
      if (token !== filmstripToken) return
    }

    const plan = computeAdaptiveFilmstripTimes({
      durationSec: v.duration,
      fps: snapFps,
      keyframeTimes: targets,
      minThumbs: 18,
      maxThumbs: 36
    })
    filmstripMode.value = plan.mode

    const thumbs: Array<{ frame: number; dataUrl: string }> = []
    for (let i = 0; i < plan.times.length; i += 1) {
      if (token !== filmstripToken) return
      await seekToTime(plan.times[i]!)
      const dataUrl = captureFrame(64)
      if (dataUrl) thumbs.push({ frame: plan.frames[i]!, dataUrl })
      if (i % 6 === 0 || i === plan.times.length - 1) filmstrip.value = [...thumbs]
    }
    if (token !== filmstripToken) return
    filmstrip.value = thumbs
    if (node.value && thumbs.length) {
      updateParams({
        frameFilmstrip: thumbs,
        frameFilmstripKey: cacheKey,
        frameFilmstripTotalFrames: snapTotal,
        frameFilmstripFps: snapFps,
        frameFilmstripMode: plan.mode
      })
    }
  } finally {
    v.preload = prevPreload
  }
  void seekToTime(0)
}

function captureCurrent(): void {
  const url = captureFrame()
  if (!node.value || !url) return
  const n = Math.round(frame.value)
  const id = `pull:${n}:${Date.now()}`
  const item: GraphImageItem = {
    id,
    dataUrl: url,
    createdAt: new Date().toISOString()
  }
  updateParams({
    generatedImages: [...(node.value.params.generatedImages ?? []), item],
    selectedImageId: id,
    frameNotes: { ...(node.value.params.frameNotes ?? {}), [id]: '' }
  })
}

async function captureRangeBatch(): Promise<void> {
  if (!node.value || !rangeInfo.value.valid || fps.value <= 0) return
  beginNavigation()
  const count = Math.min(4, rangeInfo.value.frameCount)
  const targetFrames: number[] = []
  for (let i = 0; i < count; i += 1) {
    const ratio = count <= 1 ? 0 : i / (count - 1)
    const f = Math.round(
      rangeInfo.value.inFrame + ratio * (rangeInfo.value.outFrame - rangeInfo.value.inFrame)
    )
    if (!targetFrames.includes(f)) targetFrames.push(f)
  }

  const nextItems = [...(node.value.params.generatedImages ?? [])]
  const nextNotes = { ...(node.value.params.frameNotes ?? {}) }
  let lastId = node.value.params.selectedImageId ?? ''

  for (const f of targetFrames) {
    await seekToTime(f / fps.value)
    const url = captureFrame()
    if (!url) continue
    const id = `pull:${f}:${Date.now()}_${f}`
    nextItems.push({
      id,
      dataUrl: url,
      createdAt: new Date().toISOString()
    })
    nextNotes[id] = nextNotes[id] ?? ''
    lastId = id
  }

  updateParams({
    generatedImages: nextItems,
    selectedImageId: lastId,
    frameNotes: nextNotes
  })
}

async function captureFullResFrameAt(targetFrame: number, overrideId?: string): Promise<string> {
  if (overrideId) {
    const item = frames.value.find((f) => f.id === overrideId)
    if (item?.dataUrl?.trim()) return item.dataUrl.trim()
    if (item?.relativePath?.trim()) {
      const mediaUrl = await window.studio.getAssetMediaDataUrl(item.relativePath.trim())
      if (mediaUrl) return mediaUrl
    }
  }
  const exactItem = frames.value.find((f) => parsePulledFrameIndex(f.id) === targetFrame)
  if (exactItem?.dataUrl?.trim()) return exactItem.dataUrl.trim()
  if (fps.value > 0) {
    await seekToTime(targetFrame / fps.value)
    const captured = captureFrame()
    if (captured) return captured
  }
  return findFramePreviewUrl(targetFrame, overrideId)
}

async function ensureSourceVideoRelativePath(): Promise<string> {
  const currentRel = videoRelativePath.value.trim()
  if (currentRel) return currentRel
  if (videoUrl.value.startsWith('data:')) {
    const savedRel = await window.studio.saveGraphRunMedia({
      dataUrl: videoUrl.value,
      key: `framepull_src_${props.nodeId}_${Date.now()}`
    })
    if (savedRel) {
      videoRelativePath.value = savedRel
      if (!upstreamVideoRelativePath.value) upstreamVideoRelativePath.value = savedRel
      return savedRel
    }
  }
  return ''
}

async function resolveSourceNodeImageDataUrl(src: GraphNode): Promise<string> {
  if (src.params.previewDataUrl?.trim().startsWith('data:')) {
    return src.params.previewDataUrl.trim()
  }
  const images = src.params.generatedImages
  if (Array.isArray(images) && images.length > 0) {
    const selectedId = src.params.selectedImageId?.trim()
    const picked =
      (selectedId ? images.find((row) => row.id === selectedId) : undefined) ||
      images[images.length - 1]
    if (picked?.dataUrl?.trim().startsWith('data:')) {
      return picked.dataUrl.trim()
    }
    if (picked?.relativePath?.trim()) {
      try {
        const mediaUrl = await window.studio.getAssetMediaDataUrl(picked.relativePath.trim())
        if (mediaUrl?.trim()) return mediaUrl.trim()
      } catch {
        // fall through
      }
    }
  }
  let rel =
    src.params.previewRelativePath?.trim() ||
    (src.assetType === 'image' && src.assetId
      ? project.assets.find((a) => a.id === src.assetId)?.relativePath?.trim()
      : '') ||
    ''
  if (!rel && isBoundaryInputNode(src)) {
    const val = softResolveBoundaryInputParams(src)
    if (val?.kind === 'image' && val.dataUrl?.trim().startsWith('data:')) {
      return val.dataUrl.trim()
    }
    if (val?.kind === 'image' && val.relativePath?.trim()) {
      rel = val.relativePath.trim()
    } else if (val?.kind === 'images' && val.items.length > 0) {
      const first = val.items[0]
      if (first?.dataUrl?.trim().startsWith('data:')) return first.dataUrl.trim()
      if (first?.relativePath?.trim()) rel = first.relativePath.trim()
    }
  }
  if (rel) {
    try {
      const mediaUrl = await window.studio.getAssetMediaDataUrl(rel)
      if (mediaUrl?.trim()) return mediaUrl.trim()
    } catch {
      // ignore missing ref image
    }
  }
  return ''
}

async function resolveConnectedReferenceImages(instructionRaw: string): Promise<{
  urls: string[]
  rewrittenInstruction: string
}> {
  const document = graphEditorHosts.getDocument(props.hostId)
  if (!document) return { urls: [], rewrittenInstruction: instructionRaw }
  const nodesById = new Map((document.nodes ?? []).map((n) => [n.id, n]))
  const logicalEdges = expandIncomingThroughBundles(document, props.nodeId)
  const indexed: Array<{ index: number; url: string }> = []
  for (let i = 0; i < logicalEdges.length; i += 1) {
    const edge = logicalEdges[i]!
    const src = nodesById.get(edge.sourceNodeId)
    if (!src) continue
    const url = await resolveSourceNodeImageDataUrl(src)
    if (url) {
      indexed.push({ index: i + 1, url })
    }
  }

  const mentioned = collectMentionedIndexes(instructionRaw)
  if (mentioned.size === 0) {
    return {
      urls: indexed.map((entry) => entry.url),
      rewrittenInstruction: instructionRaw
    }
  }

  const selected = indexed.filter((entry) => mentioned.has(entry.index))
  const remap = new Map<number, number>()
  selected.forEach((entry, idx) => {
    remap.set(entry.index, idx + 1)
  })
  const rewrittenInstruction = instructionRaw.replace(/@(\d+)/g, (full, num: string) => {
    const mapped = remap.get(Number(num))
    return mapped != null ? `@${mapped}` : full
  })
  return {
    urls: selected.map((entry) => entry.url),
    rewrittenInstruction
  }
}

async function runSegmentReshootAndSplice(): Promise<void> {
  reshootError.value = ''
  if (!node.value) return
  if (!rangeInfo.value.valid) {
    reshootError.value = t('graph.inspector.framePull.errorNoRange')
    return
  }

  const v = videoEl.value
  if (v && !v.paused) {
    v.pause()
    playing.value = false
  }

  reshootRunning.value = true
  reshootStep.value = 'capture'
  beginNavigation()

  try {
    const currentVideoRel = await ensureSourceVideoRelativePath()
    if (!currentVideoRel) {
      throw new Error(t('graph.inspector.framePull.errorNoSourceFile'))
    }

    const originalSourceRel =
      node.value.params.framePullSourceVideoPath?.trim() ||
      upstreamVideoRelativePath.value.trim() ||
      currentVideoRel

    const { inFrame, outFrame, inSec, outSec, segmentDurationSec } = rangeInfo.value
    const mode = conditioningMode.value

    // 1. 解析输入端口参考图（含图片束与 @n 引用筛选）及首尾锚点帧
    const { urls: connectedRefImages, rewrittenInstruction } =
      await resolveConnectedReferenceImages(instruction.value)

    const firstFrameDataUrl =
      mode === 'video_ref'
        ? undefined
        : await captureFullResFrameAt(inFrame, firstFrameOverrideId.value)
    // 方舟 Seedance 等模型：last_frame 不可与 reference_image 混用；有参考图接入时走首帧+参考图
    const lastFrameDataUrl =
      mode === 'first_last' && connectedRefImages.length === 0
        ? await captureFullResFrameAt(outFrame, lastFrameOverrideId.value)
        : undefined

    // 2. 组装重拍提示词并调用视频生成模型
    reshootStep.value = 'generate'
    const prompt = buildFramePullReshootPrompt({
      instruction: rewrittenInstruction,
      inFrame,
      outFrame,
      inSec,
      outSec,
      conditioningMode: mode,
      rangeNotes: rangeNotes.value,
      locale: locale.value
    })
    const systemPrompt = resolveFramePullReshootSystemPrompt(
      node.value.params.generateSystemPrompt,
      locale.value
    )
    const fullPrompt = `${systemPrompt}\n\n${prompt}`

    const parsedModel = parseModelKey(selectedModelKey.value)
    const model = parsedModel?.model || node.value.params.generateModel || undefined
    const providerInstanceId =
      parsedModel?.providerInstanceId || node.value.params.generateProviderInstanceId || undefined

    // 参考图排在前面以保证 @1..@k 与 inputReferences 槽位一一对应；video_ref 模式下源视频用 @视频1 指代
    const inputReferences: Array<{ kind: 'video_url' | 'image_url'; url: string }> = []
    for (const imgUrl of connectedRefImages) {
      inputReferences.push({ kind: 'image_url', url: imgUrl })
    }
    if (mode === 'video_ref') {
      const videoDataUrl = await window.studio.getAssetMediaDataUrl(currentVideoRel)
      if (videoDataUrl) {
        inputReferences.push({ kind: 'video_url', url: videoDataUrl })
      }
    }

    const genResult = await window.studio.generateVideo({
      prompt: fullPrompt,
      model,
      providerInstanceId,
      duration: recommendVideoGenerationDuration(segmentDurationSec),
      ...(firstFrameDataUrl ? { firstFrameImageUrl: firstFrameDataUrl } : {}),
      ...(lastFrameDataUrl ? { lastFrameImageUrl: lastFrameDataUrl } : {}),
      ...(inputReferences.length ? { inputReferences } : {}),
      name: `framepull_clip_f${inFrame}_${outFrame}_${Date.now()}`
    })

    if (!genResult?.relativePath) {
      throw new Error('Video generation returned empty relativePath')
    }

    // 3. 调用主进程 FFmpeg 管线（semanticRebuild）将生成的片段无缝替换回当前视频
    reshootStep.value = 'splice'
    const totalDurationSec = duration.value > 0 ? duration.value : outSec
    const segments = buildFramePullSpliceSegments({
      sourceDurationSec: totalDurationSec,
      inSec,
      outSec,
      generatedClipRelativePath: genResult.relativePath,
      fitMode: fitMode.value
    })

    const safeTimelineId = `framepull_${props.nodeId.replace(/[^\w.-]+/g, '_')}`
    const rebuildResult = await window.studio.semanticRebuild({
      timelineId: safeTimelineId,
      clips: [{ key: 'reshoot', relativePath: genResult.relativePath }],
      segments,
      sourceRelativePath: currentVideoRel,
      keepAudio: keepAudio.value,
      burnSubtitles: false,
      fps: fps.value > 0 ? Math.round(fps.value) : undefined,
      label: `f${inFrame}_${outFrame}`
    })

    if (!rebuildResult.ok || !rebuildResult.outputRelativePath) {
      throw new Error(rebuildResult.error || 'FFmpeg segment splice failed')
    }

    const splicedRel = rebuildResult.outputRelativePath
    invalidateAssetUrlCache(splicedRel)

    const record: FramePullSpliceRecord = {
      id: `splice:${Date.now()}`,
      inFrame,
      outFrame,
      inSec,
      outSec,
      instruction: instruction.value.trim(),
      conditioningMode: mode,
      fitMode: fitMode.value,
      keepAudio: keepAudio.value,
      clipRelativePath: genResult.relativePath,
      outputRelativePath: splicedRel,
      model: genResult.model || model,
      createdAt: new Date().toISOString()
    }

    const nextHistory = [...spliceHistory.value, record]
    const nextGeneratedVideos = [
      ...(node.value.params.generatedVideos ?? []),
      {
        id: record.id,
        relativePath: splicedRel,
        createdAt: record.createdAt
      }
    ]

    previewingOriginal.value = false
    updateParams({
      framePullSourceVideoPath: originalSourceRel,
      framePullActiveVideoPath: splicedRel,
      framePullSpliceHistory: nextHistory,
      generatedVideos: nextGeneratedVideos,
      selectedVideoId: record.id,
      // 清空旧胶片条缓存键以触发新合成视频的胶片条刷新
      frameFilmstripKey: ''
    })

    // 同步更新运行态输出口 out-video，令下游视频节点即刻拿到替换后的新视频
    syncRunStateVideoOutput(splicedRel, record.id)

    await refreshVideo()
    void seekToTime(inSec)
  } catch (err) {
    reshootError.value = err instanceof Error ? err.message : String(err)
  } finally {
    reshootRunning.value = false
  }
}

function syncRunStateVideoOutput(relativePath: string, id?: string): void {
  const runHost = graphRunHosts.get(props.hostId)
  if (!runHost) return
  const existing = runHost.runStates[props.nodeId]
  const prevOutputs = existing?.outputs ?? {}
  runHost.runStates[props.nodeId] = {
    status: 'done',
    outputs: {
      ...prevOutputs,
      'out-video': {
        kind: 'video',
        id: id ?? `framepull:${relativePath}`,
        relativePath
      }
    }
  }
}

function toggleCompareOriginal(): void {
  previewingOriginal.value = !previewingOriginal.value
}

function undoLastSplice(): void {
  if (!node.value || spliceHistory.value.length === 0) return
  const nextHistory = spliceHistory.value.slice(0, -1)
  const prevRecord = nextHistory[nextHistory.length - 1]
  const nextActivePath = prevRecord ? prevRecord.outputRelativePath : undefined
  previewingOriginal.value = false
  updateParams({
    framePullActiveVideoPath: nextActivePath,
    framePullSpliceHistory: nextHistory,
    frameFilmstripKey: ''
  })
  syncRunStateVideoOutput(nextActivePath || sourceVideoRelativePath.value)
}

function restoreOriginalVideo(): void {
  if (!node.value) return
  previewingOriginal.value = false
  updateParams({
    framePullActiveVideoPath: undefined,
    framePullSpliceHistory: [],
    frameFilmstripKey: ''
  })
  if (sourceVideoRelativePath.value) {
    syncRunStateVideoOutput(sourceVideoRelativePath.value)
  }
}

function selectHistoryRecord(rec: FramePullSpliceRecord): void {
  updateParams({
    framePullInFrame: rec.inFrame,
    framePullOutFrame: rec.outFrame
  })
  beginNavigation()
  void seekToTime(rec.inSec)
}

function selectFrame(id?: string): void {
  if (!node.value || !id) return
  updateParams({ selectedImageId: id })
  const idx = parsePulledFrameIndex(id)
  if (idx != null && fps.value > 0) {
    beginNavigation()
    void seekToTime(idx / fps.value).then((landed) => {
      if (landed != null) syncSelectionToPosition(landed)
    })
  }
}

function removeFrame(id?: string): void {
  const current = node.value
  if (!current || !id) return
  const next = (current.params.generatedImages ?? []).filter((item) => item.id !== id)
  const notes = { ...(current.params.frameNotes ?? {}) }
  delete notes[id]
  const patch: Record<string, unknown> = { generatedImages: next, frameNotes: notes }
  if (current.params.selectedImageId === id) {
    patch.selectedImageId = next[next.length - 1]?.id ?? ''
  }
  updateParams(patch)
}

function clearFrames(): void {
  if (!node.value) return
  updateParams({
    generatedImages: [],
    selectedImageId: '',
    frameNotes: {}
  })
}

function frameItemLabel(item: GraphImageItem): string {
  const idx = parsePulledFrameIndex(item.id)
  return idx != null ? `${t('graph.inspector.framePull.frameShort')} ${idx}` : (item.id ?? '')
}

function isFilmstripActive(frameNumber: number): boolean {
  return frame.value === frameNumber
}

const activeFilmstripIndex = computed(() => {
  return filmstrip.value.findIndex((thumb) => thumb.frame === frame.value)
})

function scrollActiveThumbIntoView(): void {
  const el = filmstripEl.value
  const idx = activeFilmstripIndex.value
  if (!el || idx < 0) return
  const thumb = el.children[idx] as HTMLElement | undefined
  if (!thumb) return
  const left = thumb.offsetLeft - (el.clientWidth - thumb.clientWidth) / 2
  el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
}

watch(activeFilmstripIndex, (idx) => {
  if (!followFilmstrip || idx < 0) return
  scrollActiveThumbIntoView()
})

function syncSelectionToPosition(currentFrame: number): void {
  if (!node.value || displayTotalFrames.value <= 0) return
  const captured = frames.value.find((item) => parsePulledFrameIndex(item.id) === currentFrame)
  if (captured?.id && captured.id !== selectedFrameId.value) {
    updateParams({ selectedImageId: captured.id })
  }
}

async function onFilmstripClick(frameIndex: number, e?: MouseEvent): Promise<void> {
  if (e?.shiftKey && node.value) {
    const anchor =
      node.value.params.framePullInFrame != null
        ? node.value.params.framePullInFrame
        : Math.round(frame.value)
    const lo = Math.min(anchor, frameIndex)
    const hi = Math.max(anchor, frameIndex)
    updateParams({
      framePullInFrame: lo,
      framePullOutFrame: hi
    })
  }
  beginNavigation()
  if (fps.value <= 0) return
  const landed = await seekToTime(frameIndex / fps.value)
  if (landed != null) syncSelectionToPosition(landed)
}

function onNoteInput(e: Event): void {
  if (!node.value || !selectedFrameId.value) return
  const text = (e.target as HTMLTextAreaElement).value
  updateParams({
    frameNotes: { ...(node.value.params.frameNotes ?? {}), [selectedFrameId.value]: text }
  })
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
  } else if (e.key === '[' || e.key === 'i' || e.key === 'I') {
    e.preventDefault()
    markInPoint()
  } else if (e.key === ']' || e.key === 'o' || e.key === 'O') {
    e.preventDefault()
    markOutPoint()
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
  window.addEventListener('pointerup', onWindowPointerUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointerup', onWindowPointerUp)
  videoToken += 1
  filmstripToken += 1
})
</script>

<style scoped>
.frame-pull-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 372px;
  gap: 14px;
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

.spliced-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
  font-size: 12px;
}

.spliced-banner.original {
  background: color-mix(in srgb, #f59e0b 14%, var(--bg-elevated));
  border-color: color-mix(in srgb, #f59e0b 45%, var(--border));
}

.spliced-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.spliced-banner.original .spliced-dot {
  background: #f59e0b;
}

.spliced-text {
  font-weight: 600;
  color: var(--text);
}

.spliced-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.banner-btn {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.banner-btn.danger {
  color: #ef4444;
}

.banner-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.video-el {
  width: 100%;
  max-height: 56vh;
  background: #000;
  border-radius: 8px;
}

.transport {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.transport-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
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
  font-size: 13px;
}

.ctrl-btn.primary {
  background: var(--accent);
  color: #fff;
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

.range-mark-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}

.range-btn {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.range-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  color: var(--accent);
  font-weight: 600;
}

.range-btn.ghost {
  background: transparent;
  color: var(--text-muted);
}

.range-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.progress-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.progress-range-bar {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 8px;
  border-radius: 4px;
  background: color-mix(in srgb, #f59e0b 55%, transparent);
  border: 1px solid #f59e0b;
  pointer-events: none;
  z-index: 0;
}

.progress {
  position: relative;
  z-index: 1;
  width: 100%;
  accent-color: var(--accent);
}

.filmstrip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 2px 0 4px;
  user-select: none;
}

.filmstrip-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 60px;
  height: 36px;
  padding: 0;
  border: 2px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: #000;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    transform 0.1s ease;
  box-sizing: border-box;
}

.filmstrip-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.filmstrip-thumb.in-range {
  border-color: #f59e0b;
  box-shadow: 0 0 0 1px color-mix(in srgb, #f59e0b 65%, transparent);
}

.filmstrip-thumb.active {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 12px color-mix(in srgb, var(--accent) 50%, transparent);
  filter: brightness(1.1);
}

.filmstrip-io-badge {
  position: absolute;
  top: 1px;
  left: 1px;
  z-index: 2;
  padding: 0 3px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 700;
  line-height: 12px;
  color: #000;
  background: #f59e0b;
  pointer-events: none;
}

.filmstrip-captured-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 1;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  border: 1px solid rgba(0, 0, 0, 0.55);
  pointer-events: none;
  box-sizing: border-box;
}

.filmstrip-frame-label {
  position: absolute;
  right: 2px;
  bottom: 1px;
  z-index: 1;
  padding: 0 2px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 8px;
  line-height: 11px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.filmstrip-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.filmstrip-mode {
  font-size: 11px;
  color: var(--text-muted);
}

.range-status {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.range-status.active {
  color: #f59e0b;
  font-weight: 600;
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.actions button.primary {
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  padding: 6px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.actions button.ghost {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  padding: 5px 9px;
  font-size: 12px;
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.capture-count {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.side-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.side-tab {
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.side-tab.active {
  background: var(--accent);
  color: #fff;
}

.reshoot-panel,
.frames-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.anchor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.anchor-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}

.anchor-card.muted {
  opacity: 0.45;
}

.anchor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.anchor-title strong {
  color: #f59e0b;
  margin-left: 4px;
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  padding: 0;
  cursor: pointer;
}

.anchor-thumb-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 5px;
  overflow: hidden;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.anchor-thumb-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.anchor-empty {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.anchor-select {
  width: 100%;
  padding: 4px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.form-field select {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
}

.checkbox-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.instruction-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.instruction-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.instruction-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-chip {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.preset-chip:hover {
  border-color: var(--accent);
  color: var(--text);
}

.notes-merged-badge {
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 11px;
}

.reshoot-textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
  font-family: inherit;
}

.reshoot-run-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-reshoot-btn {
  width: 100%;
  padding: 9px 14px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.run-reshoot-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.reshoot-error {
  margin: 0;
  font-size: 11px;
  color: #ef4444;
  line-height: 1.4;
}

.splice-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.history-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.history-range {
  font-weight: 600;
  color: #f59e0b;
  white-space: nowrap;
}

.history-prompt {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frames {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}

.frames-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.frame-item {
  position: relative;
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.frame-item:hover {
  border-color: var(--border);
}

.frame-item.active {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 12px color-mix(in srgb, var(--accent) 35%, transparent);
}

.frame-item.active::after {
  content: '✓';
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.frame-item img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
  background: #000;
}

.frame-meta {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 4px;
}

.frame-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.note {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.note textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
  font-family: inherit;
}
</style>
