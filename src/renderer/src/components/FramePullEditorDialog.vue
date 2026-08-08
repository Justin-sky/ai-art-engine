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
    <div class="frame-pull-editor">
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
            <div v-if="filmstrip.length" ref="filmstripEl" class="filmstrip">
              <button
                v-for="thumb in filmstrip"
                :key="thumb.frame"
                type="button"
                class="filmstrip-thumb"
                :class="{
                  active: isFilmstripActive(thumb.frame),
                  captured: capturedFrameSet.has(thumb.frame)
                }"
                :title="t('graph.inspector.framePull.frameLabel', {
                  frame: thumb.frame,
                  total: displayTotalFrames
                })"
                @click="onFilmstripClick(thumb.frame)"
              >
                <img :src="thumb.dataUrl" alt="" loading="lazy" />
                <span
                  v-if="capturedFrameSet.has(thumb.frame)"
                  class="filmstrip-captured-dot"
                />
                <span class="filmstrip-frame-label">{{ thumb.frame }}</span>
              </button>
            </div>
            <span v-if="filmstripMode" class="filmstrip-mode">
              {{
                filmstripMode === 'keyframe'
                  ? t('graph.inspector.framePull.keyframeStrip')
                  : t('graph.inspector.framePull.frameStripFallback')
              }}
            </span>
          </div>
        </div>
        <div v-else class="stage empty">
          <span>{{
            videoError
              ? t('graph.preview.videoError')
              : t('graph.inspector.framePull.noSource')
          }}</span>
        </div>
      </div>

      <div class="side-col">
        <div class="actions">
          <button
            type="button"
            class="primary"
            :disabled="!videoUrl || videoError"
            @click="captureCurrent"
          >
            {{ t('graph.inspector.framePull.capture') }}
          </button>
          <button type="button" class="ghost" :disabled="!frames.length" @click="clearFrames">
            {{ t('graph.inspector.framePull.clear') }}
          </button>
          <span class="capture-count">
            {{ t('graph.inspector.framePull.captured', { n: frames.length }) }}
          </span>
        </div>

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
        <p v-else class="frames-empty">{{ t('graph.inspector.framePull.framesEmpty') }}</p>

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
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GraphImageItem } from '@shared/graph'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { resolveNodeUpstreamVideoUrl } from '../features/graph/model/resolveNodeUpstreamVideoUrl'
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

const { t } = useStudioI18n()
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
const duration = ref(0)
const playing = ref(false)
const seeking = ref(false)
const videoError = ref(false)
const filmstrip = ref<Array<{ frame: number; dataUrl: string }>>([])
const filmstripEl = ref<HTMLElement | null>(null)
const filmstripMode = ref<'keyframe' | 'frame' | ''>('')
/** 联动时是否跟随滚动胶片条（播放中 / 生成胶片条时不跟随，避免抢滚动条） */
let followFilmstrip = false

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

/** 已持久化的胶片条快照（首帧序列生成时保存） */
const cachedFilmstrip = computed(() => node.value?.params.frameFilmstrip ?? [])
const cachedTotalFrames = computed(() => node.value?.params.frameFilmstripTotalFrames ?? 0)
const cachedFps = computed(() => node.value?.params.frameFilmstripFps ?? 0)

/** 展示用总帧数：优先用快照值，避免每次用 时长×fps 现场计算 */
const displayTotalFrames = computed(() => {
  if (cachedFilmstrip.value.length && cachedTotalFrames.value > 0) {
    return cachedTotalFrames.value
  }
  return totalFrames.value > 0 ? totalFrames.value : 0
})

/** 已抽取帧对应的帧号集合（胶片格 = 帧号，命中的格显示标记） */
const capturedFrameSet = computed<Set<number>>(() => {
  const set = new Set<number>()
  for (const item of frames.value) {
    const match = /^pull:(\d+):/.exec(item.id ?? '')
    if (match) set.add(Number(match[1]))
  }
  return set
})

let videoToken = 0
let filmstripToken = 0

/** 用户手动导航：取消进行中的胶片条生成，并让胶片条跟随滚动 */
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

/** 视频 URL → 短哈希，作为胶片条缓存的来源标识 */
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
    duration.value = 0
    return
  }
  const document = graphEditorHosts.getDocument(props.hostId)
  const runStates = graphRunHosts.get(props.hostId)?.runStates
  const { url, relativePath } = await resolveNodeUpstreamVideoUrl({
    document,
    nodeId: props.nodeId,
    runStates,
    assets: project.assets
  })
  if (token !== videoToken) return
  videoUrl.value = url
  videoRelativePath.value = relativePath
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
  scheduleFilmstrip()
}

function onTimeUpdate(): void {
  followFilmstrip = false
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

async function scheduleFilmstrip(): Promise<void> {
  followFilmstrip = false
  const v = videoEl.value
  const token = ++filmstripToken
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return

  // 同源视频已缓存胶片条：直接复用，避免重复抽帧（v3：关键帧胶片条；旧缓存自动作废）
  const cacheKey = `${hashString(videoUrl.value)}:v3`
  const cached = cachedFilmstrip.value
  if (cached.length && node.value?.params.frameFilmstripKey === cacheKey) {
    filmstrip.value = cached
    filmstripMode.value = node.value?.params.frameFilmstripMode ?? ''
    // 锁定首帧序列生成时快照的帧率与总帧数，之后不再现场计算
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
    // 真实播放一小段实测帧率（seek 回调间隔是跳帧距离，不能测帧率）
    const snapFps = await measureFps()
    if (token !== filmstripToken) return
    const snapTotal = Math.max(1, Math.round(v.duration * snapFps))
    // 优先用主进程 ffprobe 提取关键帧时间；无 ffprobe / 失败时回退逐帧
    let targets: number[] | null = null
    if (videoRelativePath.value.trim()) {
      try {
        targets = await window.studio.detectVideoKeyframes(videoRelativePath.value)
      } catch {
        targets = null
      }
      if (token !== filmstripToken) return
    }
    const times =
      targets && targets.length
        ? targets.map((t) => Math.min(t, v.duration)).sort((a, b) => a - b)
        : Array.from({ length: snapTotal }, (_, i) => i / snapFps)
    const mode: 'keyframe' | 'frame' = targets && targets.length ? 'keyframe' : 'frame'
    filmstripMode.value = mode
    // 每格对应一个关键帧（或逐帧回退时每格一帧），格上标真实帧号
    const thumbs: Array<{ frame: number; dataUrl: string }> = []
    for (let i = 0; i < times.length; i += 1) {
      if (token !== filmstripToken) return
      await seekToTime(times[i]!)
      const dataUrl = captureFrame(56)
      if (dataUrl) thumbs.push({ frame: Math.round(times[i]! * snapFps), dataUrl })
      // 渐进渲染：边生成边填充，长视频也有进度反馈
      if (i % 8 === 0 || i === times.length - 1) filmstrip.value = [...thumbs]
    }
    if (token !== filmstripToken) return
    filmstrip.value = thumbs
    if (node.value && thumbs.length) {
      graphEditorHosts.updateNode(props.hostId, props.nodeId, {
        frameFilmstrip: thumbs,
        frameFilmstripKey: cacheKey,
        frameFilmstripTotalFrames: snapTotal,
        frameFilmstripFps: snapFps,
        frameFilmstripMode: mode
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
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
    generatedImages: [...(node.value.params.generatedImages ?? []), item],
    selectedImageId: id,
    frameNotes: { ...(node.value.params.frameNotes ?? {}), [id]: '' }
  })
}

function selectFrame(id?: string): void {
  if (!node.value || !id) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, { selectedImageId: id })
  // 联动：选中抽取帧时，视频跳到该帧所在时间，胶片条高亮跟随
  const match = /^pull:(\d+):/.exec(id)
  if (match) {
    beginNavigation()
    void seekToTime(Number(match[1]) / fps.value).then((landed) => {
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
  graphEditorHosts.updateNode(props.hostId, props.nodeId, patch)
}

function clearFrames(): void {
  if (!node.value) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
    generatedImages: [],
    selectedImageId: '',
    frameNotes: {}
  })
}

function frameItemLabel(item: GraphImageItem): string {
  const match = /^pull:(\d+):/.exec(item.id ?? '')
  return match
    ? `${t('graph.inspector.framePull.frameShort')} ${match[1]}`
    : (item.id ?? '')
}

/** 胶片格 = 帧号：第 i 格即第 i 帧，当前帧号即高亮格 */
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

/** 手动导航落点后，把帧列表选中态同步到当前位置精确命中的抽取帧（不命中不改动） */
function syncSelectionToPosition(currentFrame: number): void {
  if (!node.value || displayTotalFrames.value <= 0) return
  const captured = frames.value.find((item) => {
    const match = /^pull:(\d+):/.exec(item.id ?? '')
    return match && Number(match[1]) === currentFrame
  })
  if (captured?.id && captured.id !== selectedFrameId.value) {
    graphEditorHosts.updateNode(props.hostId, props.nodeId, { selectedImageId: captured.id })
  }
}

/** 点击第 i 格 = 跳到第 i 帧；该帧已有抽取帧则顺带选中（一套算法，无分段映射） */
async function onFilmstripClick(frameIndex: number): Promise<void> {
  beginNavigation()
  if (fps.value <= 0) return
  const landed = await seekToTime(frameIndex / fps.value)
  if (landed != null) syncSelectionToPosition(landed)
}

function onNoteInput(e: Event): void {
  if (!node.value || !selectedFrameId.value) return
  const text = (e.target as HTMLTextAreaElement).value
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
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
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  videoToken += 1
  filmstripToken += 1
})
</script>

<style scoped>
.frame-pull-editor {
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
  max-height: 62vh;
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
  gap: 8px;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
  white-space: nowrap;
}

.progress {
  width: 100%;
  accent-color: var(--accent);
}

.filmstrip {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.filmstrip-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 56px;
  height: 32px;
  padding: 0;
  border: 2px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: #000;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
  box-sizing: border-box;
}

.filmstrip-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.filmstrip-thumb.active {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 12px color-mix(in srgb, var(--accent) 50%, transparent);
  filter: brightness(1.1);
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

.filmstrip-mode {
  font-size: 11px;
  color: var(--text-muted);
}

.side-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.actions button.primary {
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

.actions button.ghost {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.capture-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
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
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
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
