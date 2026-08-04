<template>
  <div class="anim-panel" :class="{ collapsed }">
    <div class="anim-toolbar">
      <div class="toolbar-side">
        <div class="playback">
          <button
            type="button"
            class="icon-btn"
            :title="playing ? t('director.stage.anim.pause') : t('director.stage.anim.play')"
            @click="togglePlay"
          >
            <span v-if="playing" v-html="ICON_PAUSE" />
            <span v-else v-html="ICON_PLAY" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :title="t('director.stage.anim.stop')"
            @click="scene.stopAnimation()"
          >
            <span v-html="ICON_STOP" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ active: loop }"
            :title="t('director.stage.anim.loop')"
            @click="scene.setAnimLoop(!loop)"
          >
            <span v-html="ICON_LOOP" />
          </button>
        </div>

        <div class="time-fields">
          <input
            class="time-input"
            type="number"
            min="0"
            step="0.01"
            :value="currentTime.toFixed(2)"
            @change="onSeek"
          />
          <input
            class="time-input"
            type="number"
            min="0.1"
            step="0.1"
            :value="duration.toFixed(2)"
            @change="onDuration"
          />
          <span class="unit">s</span>
        </div>

        <div v-show="!collapsed" class="add-wrap">
          <button type="button" class="add-btn" @click.stop="toggleAddMenu">
            <span>+</span>
            <span>{{ t('director.stage.anim.addTrack') }}</span>
          </button>
          <div v-if="addMenuOpen" class="menu add-menu" @click.stop>
            <button
              v-for="item in addCandidates"
              :key="`${item.kind}:${item.id}`"
              type="button"
              class="menu-item"
              @click="addTrack(item.kind, item.id)"
            >
              {{ item.name }}
              <span class="menu-tag">{{
                item.kind === 'camera'
                  ? t('director.stage.anim.cameraTag')
                  : t('director.stage.anim.objectTag')
              }}</span>
            </button>
            <div v-if="!addCandidates.length" class="menu-empty">
              {{ t('director.stage.anim.noTargets') }}
            </div>
          </div>
        </div>
      </div>

      <div ref="rulerWrapEl" class="ruler-wrap" @scroll="onRulerScroll" @pointerdown="onRulerPointerDown">
        <div class="ruler" :style="{ width: `${rulerWidth}px` }">
          <span
            v-for="mark in rulerMarks"
            :key="`${mark.major ? 'M' : 'm'}-${mark.t}`"
            class="ruler-mark"
            :class="{
              major: mark.major,
              minor: !mark.major,
              'is-start': mark.major && mark.t <= 0,
              'is-end': mark.major && Math.abs(mark.t - duration) < 1e-6
            }"
            :style="{ left: `${mark.x}px` }"
          >
            <i class="tick" />
            <span v-if="mark.label" class="tick-label">{{ mark.label }}</span>
          </span>
          <div
            class="playhead playhead-ruler"
            :style="{ left: `${timeToX(currentTime)}px` }"
            :title="`${currentTime.toFixed(2)}s`"
            @pointerdown.stop="onPlayheadPointerDown"
          >
            <span class="playhead-handle" />
            <span class="playhead-stem" />
          </div>
        </div>
      </div>

      <div class="ruler-tools">
        <label class="speed-field" :title="t('director.stage.anim.playbackRate')">
          <span class="speed-label">{{ t('director.stage.anim.playbackRateShort') }}</span>
          <input
            class="speed-input"
            type="number"
            min="0.1"
            max="8"
            step="0.1"
            :value="playbackRate"
            :disabled="exporting"
            @change="onPlaybackRate"
          />
        </label>
        <input
          class="zoom-slider"
          type="range"
          min="30"
          max="200"
          step="1"
          :value="pxPerSecond"
          :style="{ '--zoom-fill': zoomFill }"
          :title="t('director.stage.anim.zoom')"
          :aria-label="t('director.stage.anim.zoom')"
          @input="onZoomInput"
        />
        <button
          type="button"
          class="icon-btn export-btn"
          :class="{ busy: exporting }"
          :disabled="exporting"
          :title="
            exporting ? t('director.stage.anim.exporting') : t('director.stage.anim.exportVideo')
          "
          :aria-label="t('director.stage.anim.exportVideo')"
          @click="onExportVideo"
        >
          <span v-html="ICON_EXPORT" />
        </button>
        <button
          type="button"
          class="icon-btn collapse-btn"
          :title="collapsed ? t('director.stage.anim.expand') : t('director.stage.anim.collapse')"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        >
          <span v-html="collapsed ? ICON_EXPAND : ICON_COLLAPSE" />
        </button>
      </div>
    </div>

    <div v-show="!collapsed" class="anim-body">
      <div class="track-list">
        <div v-if="!tracks.length" class="empty">{{ t('director.stage.anim.empty') }}</div>
        <div
          v-for="track in tracks"
          :key="track.id"
          class="track-block"
          :class="{
            selected: track.id === selectedTrackId,
            'asset-drag-over': dropTrackId === track.id
          }"
          @dragenter.prevent="onTrackDragEnter(track, $event)"
          @dragover.prevent="onTrackDragOver(track, $event)"
          @dragleave="onTrackDragLeave(track, $event)"
          @drop.prevent="onTrackDrop(track, $event)"
          @click="scene.selectAnimTrack(track.id)"
        >
          <div class="track-row" @click="scene.selectAnimTrack(track.id)">
            <span class="track-name">
              {{ track.name }}
              <span v-if="skeletonSegments(track).length" class="skel-badge">{{
                t('director.stage.anim.skeletonBadge')
              }}</span>
              <span v-if="track.cameraCut" class="skel-badge cut-badge">{{
                t('director.stage.anim.cameraCutTag')
              }}</span>
            </span>
            <template v-if="!track.cameraCut">
              <button
                type="button"
                class="orient-btn"
                :class="{ active: track.orientToPath }"
                :title="t('director.stage.anim.orientToPath')"
                :aria-pressed="track.orientToPath === true"
                @click.stop="toggleOrientToPath(track)"
              >
                <span class="orient-icon" v-html="ICON_ORIENT" />
              </button>
              <div class="axis-wrap">
                <button
                  type="button"
                  class="forward-axis-btn"
                  :title="t('director.stage.anim.pathForwardAxis')"
                  @click.stop="toggleAxisMenu(track.id)"
                >
                  {{ track.pathForwardAxis ?? (track.targetKind === 'camera' ? '-z' : '-x') }}
                </button>
                <div
                  v-if="axisMenuTrackId === track.id"
                  class="menu axis-menu"
                  @click.stop
                >
                  <button
                    v-for="axis in forwardAxes"
                    :key="axis"
                    type="button"
                    class="menu-item axis-item"
                    :class="{ active: axis === (track.pathForwardAxis ?? (track.targetKind === 'camera' ? '-z' : '-x')) }"
                    @click="onForwardAxisPick(track, axis)"
                  >
                    {{ axis }}
                  </button>
                </div>
              </div>
              <div class="draw-wrap">
                <button
                  type="button"
                  class="draw-btn"
                  :class="{ active: pathDrawMode?.trackId === track.id }"
                  @click.stop="toggleDrawMenu(track.id)"
                >
                  <span class="draw-icon" v-html="ICON_PATH" />
                  <span>{{ t('director.stage.anim.drawPath') }}</span>
                </button>
                <div
                  v-if="drawMenuTrackId === track.id"
                  class="menu draw-menu"
                  @click.stop
                >
                  <button
                    v-for="kind in pathKinds"
                    :key="kind"
                    type="button"
                    class="menu-item"
                    @click="startDraw(track.id, kind)"
                  >
                    <span class="kind-icon" v-html="pathIcons[kind]" />
                    <span>{{ t(`director.stage.anim.path.${kind}`) }}</span>
                  </button>
                </div>
              </div>
            </template>
            <button
              v-if="track.cameraCut"
              type="button"
              class="cut-add-btn"
              :title="t('director.stage.anim.cameraCutAddHint')"
              @click.stop="addCameraCutAtPlayhead(track)"
            >
              +
            </button>
            <button
              v-if="track.cameraCut && scene.animSelectedCameraCutSegmentId.value"
              type="button"
              class="cut-remove-btn"
              :title="t('director.stage.anim.cameraCutRemoveHint')"
              @click.stop="removeSelectedCameraCutSegment(track)"
            >
              ×
            </button>
            <button
              v-if="!track.cameraCut"
              type="button"
              class="remove-btn"
              :title="t('director.stage.anim.removeTrack')"
              @click.stop="scene.removeAnimTrack(track.id)"
            >
              ×
            </button>
          </div>
          <div
            v-if="!track.cameraCut && (hasKeyframes(track) || track.id === selectedTrackId)"
            class="sub-row"
          >
            <span class="kf" v-html="ICON_KEY" />
            <span>{{ t('director.stage.position') }}</span>
            <button
              type="button"
              class="kf-add"
              :title="t('director.stage.anim.addKeyframeHint')"
              @click.stop="scene.addAnimKeyframe(track.id)"
            >
              +
            </button>
            <span class="pos">{{ formatKeyframeHint(track) }}</span>
          </div>
          <div
            v-if="track.id === selectedTrackId && track.targetKind === 'object'"
            class="sub-row skeleton-row"
          >
            <span class="skel-label">{{ t('director.stage.anim.skeleton') }}</span>
            <span class="skel-count">{{
              t('director.stage.anim.skeletonClipCount', { n: skeletonSegments(track).length })
            }}</span>
            <template v-if="selectedSkeletonSegment(track)">
              <span
                class="skel-clip-name"
                :title="selectedSkeletonSegment(track)?.clip"
              >{{ skeletonSegLabel(selectedSkeletonSegment(track)!) }}</span>
              <label class="skel-speed" :title="t('director.stage.anim.skeletonSpeed')">
                <span>×</span>
                <input
                  type="number"
                  min="0.25"
                  max="2"
                  step="0.25"
                  :value="selectedSkeletonSegment(track)?.speed ?? 1"
                  @click.stop
                  @change="onSelectedSegmentSpeedInput(track, $event)"
                />
              </label>
              <button
                type="button"
                class="orient-btn"
                :class="{ active: selectedSkeletonSegment(track)?.loop !== false }"
                :title="t('director.stage.anim.skeletonLoop')"
                :aria-pressed="selectedSkeletonSegment(track)?.loop !== false"
                @click.stop="toggleSelectedSegmentLoop(track)"
              >
                <span v-html="ICON_LOOP" />
              </button>
              <button
                type="button"
                class="remove-btn"
                :title="t('director.stage.anim.removeSkeletonClip')"
                @click.stop="removeSelectedSegment(track)"
              >
                ×
              </button>
            </template>
            <span v-else class="skel-empty">{{ t('director.stage.anim.skeletonDropHint') }}</span>
          </div>
        </div>
      </div>

      <div
        ref="timelineEl"
        class="timeline"
        :style="{ '--px-per-sec': `${pxPerSecond}px` }"
        @wheel.prevent="onTimelineWheel"
        @scroll="onTimelineScroll"
      >
        <div class="timeline-inner" :style="{ width: `${rulerWidth}px` }">
          <div
            v-for="track in tracks"
            :key="`bar-${track.id}`"
            class="timeline-block"
            :class="{ selected: track.id === selectedTrackId }"
          >
            <div
              v-if="!track.cameraCut"
              class="timeline-row"
              @click="scene.selectAnimTrack(track.id)"
            >
              <div
                class="clip"
                :style="clipStyle(track)"
                @pointerdown.stop="onClipPointerDown($event, track.id)"
              />
            </div>
            <div
              v-if="!track.cameraCut && (hasKeyframes(track) || track.id === selectedTrackId)"
              class="timeline-row kf-row"
            >
              <div
                v-if="track.keyframes.length >= 2"
                class="kf-line"
                :style="kfLineStyle(track)"
              />
              <button
                v-for="kf in track.keyframes"
                :key="kf.id"
                type="button"
                class="diamond"
                :class="{ active: kf.id === selectedKeyframeId }"
                :style="{ left: `${timeToX(kf.time)}px` }"
                :title="`${kf.time.toFixed(2)}s`"
                @pointerdown.stop="onKeyframePointerDown($event, track.id, kf.id)"
                @click.stop="scene.selectAnimKeyframe(track.id, kf.id)"
              />
            </div>
            <div
              v-if="track.targetKind === 'object'"
              class="timeline-row skel-lane"
              :class="{ 'asset-drag-over': dropTrackId === track.id }"
              @dragenter.prevent="onTrackDragEnter(track, $event)"
              @dragover.prevent="onTimelineSkelDragOver(track, $event)"
              @dragleave="onTrackDragLeave(track, $event)"
              @drop.prevent="onTimelineSkelDrop(track, $event)"
              @click="scene.selectAnimTrack(track.id)"
            >
              <div
                v-for="seg in skeletonSegments(track)"
                :key="seg.id"
                class="skel-clip"
                :class="{ active: seg.id === selectedSkeletonClipId }"
                :style="skeletonSegStyle(seg)"
                :title="skeletonSegTitle(seg)"
                @pointerdown.stop="onSkeletonSegPointerDown($event, track.id, seg.id, 'move')"
                @click.stop="scene.selectSkeletonClipSegment(track.id, seg.id)"
              >
                <span
                  class="skel-handle left"
                  @pointerdown.stop="onSkeletonSegPointerDown($event, track.id, seg.id, 'left')"
                />
                <span class="skel-clip-label">{{ skeletonSegLabel(seg) }}</span>
                <span
                  class="skel-handle right"
                  @pointerdown.stop="onSkeletonSegPointerDown($event, track.id, seg.id, 'right')"
                />
              </div>
              <div v-if="!skeletonSegments(track).length" class="skel-lane-hint">
                {{ t('director.stage.anim.skeletonDropHint') }}
              </div>
            </div>
            <div
              v-if="track.cameraCut"
              class="timeline-row cut-lane"
              :class="{ 'camera-drag-over': dropCutTrackId === track.id }"
              @dragenter.prevent="onCutLaneDragEnter(track, $event)"
              @dragover.prevent="onCutLaneDragOver(track, $event)"
              @dragleave="onCutLaneDragLeave(track, $event)"
              @drop.prevent="onCutLaneDrop(track, $event)"
              @click="scene.selectAnimTrack(track.id)"
            >
              <div
                v-for="seg in cameraCutSegments(track)"
                :key="seg.id"
                class="cut-clip"
                :class="{
                  active: seg.id === scene.animSelectedCameraCutSegmentId.value,
                  playing: playing && scene.stage.value.activeCameraId === seg.cameraId
                }"
                :style="cameraCutSegStyle(seg)"
                :title="cameraCutSegTitle(seg)"
                @pointerdown.stop="onCameraCutSegPointerDown($event, track.id, seg.id, 'move')"
                @click.stop="scene.selectCameraCutSegment(track.id, seg.id)"
              >
                <span
                  class="skel-handle left"
                  @pointerdown.stop="onCameraCutSegPointerDown($event, track.id, seg.id, 'left')"
                />
                <span class="cut-clip-label">{{ cameraName(seg.cameraId) }}</span>
                <span
                  class="skel-handle right"
                  @pointerdown.stop="onCameraCutSegPointerDown($event, track.id, seg.id, 'right')"
                />
              </div>
              <div v-if="!cameraCutSegments(track).length" class="skel-lane-hint">
                {{ t('director.stage.anim.cameraCutDropHint') }}
              </div>
            </div>
          </div>
          <div
            class="playhead playhead-track"
            :style="{ left: `${timeToX(currentTime)}px` }"
          />
        </div>
      </div>
    </div>

    <div v-if="pathDrawMode" class="draw-hint">
      {{ drawHint }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  directorTrackCameraCutSegments,
  directorTrackSkeletonClips,
  isAnimationModelAsset,
  type DirectorAnimPathKind,
  type DirectorAnimTrack,
  type DirectorCameraCutSegment,
  type DirectorPathForwardAxis,
  type DirectorSkeletonClipSegment
} from '@shared/domain'
import { DIRECTOR_ANIM_PATH_KINDS, DIRECTOR_PATH_FORWARD_AXES } from '@shared/domain'
import { skeletonClipLabel } from '../features/director/skeletonAnim'
import { useStudioI18n } from '../composables/useStudioI18n'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'

const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'
const ICON_STOP =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>'
const ICON_LOOP =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
const ICON_COLLAPSE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 16h16"/></svg>'
const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 8h16"/></svg>'
const ICON_PATH =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M7 17c4-1 6-7 10-10"/></svg>'
const ICON_ORIENT =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 10.2v4.3"/><path d="M5.8 12.2h4.4"/><path d="M6.6 16.8 8 14.5l1.4 2.3"/><path d="M12 12c2.2-0.4 4.8-0.2 7.2 1.6"/><path d="M16.8 11.2 19.4 13.6 16.6 15"/></svg>'
/** 红色圆点录制样式 */
const ICON_EXPORT =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="#e53935"/></svg>'
const ICON_KEY =
  '<svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor"><path d="M6 1.2 10.8 6 6 10.8 1.2 6Z"/></svg>'
/** 层级相机行拖入机位轨时使用的 MIME（与 DirectorSceneHierarchy 一致） */
const DIRECTOR_CAMERA_DRAG_MIME = 'application/x-director-camera-id'

const pathIcons: Record<DirectorAnimPathKind, string> = {
  circle:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="7"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12h16"/></svg>',
  rect: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>',
  pencil:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>'
}

const { t } = useStudioI18n()
const scene = inject(directorStageSceneKey)!
const workspace = useWorkspaceStore()

const addMenuOpen = ref(false)
const drawMenuTrackId = ref<string | null>(null)
const axisMenuTrackId = ref<string | null>(null)
const dropTrackId = ref<string | null>(null)
const dropCutTrackId = ref<string | null>(null)
const timelineEl = ref<HTMLElement | null>(null)
const rulerWrapEl = ref<HTMLElement | null>(null)
const pxPerSecond = ref(80)
const collapsed = ref(false)
const pathKinds = DIRECTOR_ANIM_PATH_KINDS
const forwardAxes = DIRECTOR_PATH_FORWARD_AXES
let syncingScroll = false

const zoomFill = computed(() => {
  const min = 30
  const max = 200
  const pct = ((pxPerSecond.value - min) / (max - min)) * 100
  return `${Math.min(100, Math.max(0, pct))}%`
})

const animation = computed(
  () =>
    scene.stage.value.animation ?? {
      duration: 10,
      loop: true,
      tracks: [] as DirectorAnimTrack[]
    }
)
const tracks = computed(() =>
  animation.value.tracks
    .map((track) => ({
      ...track,
      keyframes: track.keyframes ?? []
    }))
    // 机位切换轨固定在时间线最上面
    .sort((a, b) => Number(b.cameraCut === true) - Number(a.cameraCut === true))
)
const duration = computed(() => animation.value.duration)
const loop = computed(() => animation.value.loop)
const playing = computed(() => scene.animPlaying.value)
const currentTime = computed(() => scene.animTime.value)
const playbackRate = computed(() => scene.animPlaybackRate.value)
const exporting = computed(() => scene.animExporting.value)
const selectedTrackId = computed(() => scene.animSelectedTrackId.value)
const selectedKeyframeId = computed(() => scene.animSelectedKeyframeId.value)
const pathDrawMode = computed(() => scene.pathDrawMode.value)

const addCandidates = computed(() => {
  const used = new Set(
    tracks.value.filter((tr) => !tr.cameraCut).map((tr) => `${tr.targetKind}:${tr.targetId}`)
  )
  const cameras = (scene.stage.value.cameras ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: 'camera' as const
  }))
  const objects = scene.stage.value.objects.map((o) => ({
    id: o.id,
    name: o.name,
    kind: 'object' as const
  }))
  return [...cameras, ...objects].filter((item) => !used.has(`${item.kind}:${item.id}`))
})

const TIME_ORIGIN_PAD = 10

/** 轨迹/刻度内容宽度：终点刻度线刚好落在右边缘 */
const rulerWidth = computed(
  () => TIME_ORIGIN_PAD + Math.max(1, duration.value * pxPerSecond.value)
)

const rulerMarks = computed(() => {
  const marks: { t: number; x: number; label?: string; major: boolean }[] = []
  const majorStep =
    duration.value <= 20 ? 1 : duration.value <= 60 ? 2 : Math.max(5, Math.round(duration.value / 10))
  const end = duration.value
  const minorStep = majorStep / 10
  const totalMinors = Math.ceil(end / minorStep - 1e-9)

  for (let i = 0; i <= totalMinors; i++) {
    const t = Math.min(end, i * minorStep)
    const isMajor = i % 10 === 0
    if (isMajor) {
      marks.push({
        t,
        x: timeToX(t),
        label: `${Math.round(t)}s`,
        major: true
      })
    } else if (t < end - 1e-9) {
      marks.push({ t, x: timeToX(t), major: false })
    }
  }

  const lastMajor = [...marks].reverse().find((m) => m.major)
  if (!lastMajor || Math.abs(lastMajor.t - end) > 1e-6) {
    const label =
      Math.abs(end - Math.round(end)) < 1e-6
        ? `${Math.round(end)}s`
        : `${Number(end.toFixed(2))}s`
    marks.push({ t: end, x: timeToX(end), label, major: true })
  }
  return marks
})

const drawHint = computed(() => {
  const mode = pathDrawMode.value
  if (!mode) return ''
  return t(`director.stage.anim.drawHint.${mode.kind}`)
})

function timeToX(time: number): number {
  return TIME_ORIGIN_PAD + time * pxPerSecond.value
}

function clipStyle(track: DirectorAnimTrack): Record<string, string> {
  const left = timeToX(track.start)
  const width = Math.max(8, timeToX(track.end) - left)
  return {
    left: `${left}px`,
    width: `${width}px`
  }
}

function hasKeyframes(track: DirectorAnimTrack): boolean {
  return (track.keyframes?.length ?? 0) > 0
}

function skeletonSegments(track: DirectorAnimTrack): DirectorSkeletonClipSegment[] {
  return directorTrackSkeletonClips(track)
}

const selectedSkeletonClipId = computed(() => scene.animSelectedSkeletonClipId.value)

function selectedSkeletonSegment(track: DirectorAnimTrack): DirectorSkeletonClipSegment | null {
  const id = selectedSkeletonClipId.value
  if (!id) return skeletonSegments(track)[0] ?? null
  return skeletonSegments(track).find((item) => item.id === id) ?? null
}

function skeletonSegLabel(seg: DirectorSkeletonClipSegment): string {
  return skeletonClipLabel(seg.clip, 0)
}

function skeletonSegTitle(seg: DirectorSkeletonClipSegment): string {
  const name = skeletonSegLabel(seg)
  return `${name} · ${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s`
}

function skeletonSegStyle(seg: DirectorSkeletonClipSegment): Record<string, string> {
  const left = timeToX(seg.start)
  const width = Math.max(12, timeToX(seg.end) - left)
  return {
    left: `${left}px`,
    width: `${width}px`
  }
}

function cameraCutSegments(track: DirectorAnimTrack): DirectorCameraCutSegment[] {
  return directorTrackCameraCutSegments(track)
}

function cameraName(cameraId: string): string {
  return scene.stage.value.cameras?.find((c) => c.id === cameraId)?.name ?? cameraId
}

function cameraCutSegStyle(seg: DirectorCameraCutSegment): Record<string, string> {
  const left = timeToX(seg.start)
  const width = Math.max(12, timeToX(seg.end) - left)
  return {
    left: `${left}px`,
    width: `${width}px`
  }
}

function cameraCutSegTitle(seg: DirectorCameraCutSegment): string {
  return `${cameraName(seg.cameraId)} · ${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s`
}

/** 在播放头位置给当前激活相机添加一段机位区间 */
function addCameraCutAtPlayhead(track: DirectorAnimTrack): void {
  const cameraId = scene.stage.value.activeCameraId
  if (!cameraId || !scene.stage.value.cameras?.some((c) => c.id === cameraId)) return
  const t = currentTime.value
  const end = Math.min(duration.value, t + 1.5)
  scene.addCameraCutSegment(track.id, cameraId, Math.max(0, t), Math.max(t + 0.1, end))
}

function removeSelectedCameraCutSegment(track: DirectorAnimTrack): void {
  const segmentId = scene.animSelectedCameraCutSegmentId.value
  if (!segmentId) return
  scene.removeCameraCutSegment(track.id, segmentId)
}

function isCameraCutDrag(event: DragEvent): boolean {
  const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : []
  if (types.includes(DIRECTOR_CAMERA_DRAG_MIME)) return true
  // 兼容：text/plain 值为相机 id 的层级行拖入
  const raw = event.dataTransfer?.getData('text/plain')
  if (raw && scene.stage.value.cameras?.some((c) => c.id === raw)) return true
  const shared = (window as unknown as { __directorCameraDragId?: string }).__directorCameraDragId
  return !!shared && !!scene.stage.value.cameras?.some((c) => c.id === shared)
}

function onCutLaneDragEnter(track: DirectorAnimTrack, event: DragEvent): void {
  if (!isCameraCutDrag(event)) return
  dropCutTrackId.value = track.id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onCutLaneDragOver(track: DirectorAnimTrack, event: DragEvent): void {
  // 始终接受拖放，避免显示禁止图标；是否为相机在 drop 时校验
  dropCutTrackId.value = isCameraCutDrag(event) ? track.id : null
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onCutLaneDragLeave(track: DirectorAnimTrack, event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  const block = event.currentTarget as HTMLElement | null
  if (next && block?.contains(next)) return
  if (dropCutTrackId.value === track.id) dropCutTrackId.value = null
}

function onCutLaneDrop(track: DirectorAnimTrack, event: DragEvent): void {
  dropCutTrackId.value = null
  const cameraId =
    event.dataTransfer?.getData(DIRECTOR_CAMERA_DRAG_MIME) ||
    event.dataTransfer?.getData('text/plain') ||
    (window as unknown as { __directorCameraDragId?: string }).__directorCameraDragId ||
    ''
  if (!cameraId) return
  if (!scene.stage.value.cameras?.some((c) => c.id === cameraId)) return
  const t = dropTimeFromEvent(event)
  const end = Math.min(duration.value, t + 1.5)
  scene.selectAnimTrack(track.id)
  scene.addCameraCutSegment(track.id, cameraId, Math.max(0, t), Math.max(t + 0.1, end))
}

type CutSegDragMode = 'move' | 'left' | 'right'
let cutSegDrag: {
  trackId: string
  segmentId: string
  mode: CutSegDragMode
  startX: number
  originStart: number
  originEnd: number
} | null = null

function onCameraCutSegPointerDown(
  e: PointerEvent,
  trackId: string,
  segmentId: string,
  mode: CutSegDragMode
): void {
  if (e.button !== 0) return
  const track = tracks.value.find((tr) => tr.id === trackId)
  const seg = track ? cameraCutSegments(track).find((item) => item.id === segmentId) : null
  if (!track || !seg) return
  scene.selectCameraCutSegment(trackId, segmentId)
  cutSegDrag = {
    trackId,
    segmentId,
    mode,
    startX: e.clientX,
    originStart: seg.start,
    originEnd: seg.end
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onCameraCutSegPointerMove)
  window.addEventListener('pointerup', onCameraCutSegPointerUp)
}

function onCameraCutSegPointerMove(e: PointerEvent): void {
  if (!cutSegDrag) return
  const dt = (e.clientX - cutSegDrag.startX) / pxPerSecond.value
  const span = cutSegDrag.originEnd - cutSegDrag.originStart
  if (cutSegDrag.mode === 'move') {
    let start = cutSegDrag.originStart + dt
    start = Math.max(0, Math.min(start, duration.value - span))
    scene.setCameraCutSegmentRange(cutSegDrag.trackId, cutSegDrag.segmentId, start, start + span)
    return
  }
  if (cutSegDrag.mode === 'left') {
    const start = Math.max(0, Math.min(cutSegDrag.originEnd - 0.05, cutSegDrag.originStart + dt))
    scene.setCameraCutSegmentRange(
      cutSegDrag.trackId,
      cutSegDrag.segmentId,
      start,
      cutSegDrag.originEnd
    )
    return
  }
  const end = Math.min(
    duration.value,
    Math.max(cutSegDrag.originStart + 0.05, cutSegDrag.originEnd + dt)
  )
  scene.setCameraCutSegmentRange(cutSegDrag.trackId, cutSegDrag.segmentId, cutSegDrag.originStart, end)
}

function onCameraCutSegPointerUp(): void {
  cutSegDrag = null
  window.removeEventListener('pointermove', onCameraCutSegPointerMove)
  window.removeEventListener('pointerup', onCameraCutSegPointerUp)
}

function isStudioAssetDrag(event: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : []
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

function canAcceptAnimationAssetDrop(track: DirectorAnimTrack, event: DragEvent): boolean {
  if (track.targetKind !== 'object') return false
  if (!isStudioAssetDrag(event)) return false
  const asset = workspace.draggingAsset
  if (asset) return isAnimationModelAsset(asset)
  return true
}

function onTrackDragEnter(track: DirectorAnimTrack, event: DragEvent): void {
  if (!canAcceptAnimationAssetDrop(track, event)) return
  dropTrackId.value = track.id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onTrackDragOver(track: DirectorAnimTrack, event: DragEvent): void {
  if (!canAcceptAnimationAssetDrop(track, event)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }
  dropTrackId.value = track.id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onTimelineSkelDragOver(track: DirectorAnimTrack, event: DragEvent): void {
  onTrackDragOver(track, event)
}

function onTrackDragLeave(track: DirectorAnimTrack, event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  const block = event.currentTarget as HTMLElement | null
  if (next && block?.contains(next)) return
  if (dropTrackId.value === track.id) dropTrackId.value = null
}

function dropTimeFromEvent(event: DragEvent): number {
  const el = timelineEl.value
  if (!el) return scene.animTime.value
  const x = event.clientX - el.getBoundingClientRect().left + el.scrollLeft
  return Math.max(0, Math.min(duration.value, (x - TIME_ORIGIN_PAD) / pxPerSecond.value))
}

async function onTrackDrop(track: DirectorAnimTrack, event: DragEvent): Promise<void> {
  dropTrackId.value = null
  if (track.targetKind !== 'object') return
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset || !isAnimationModelAsset(asset)) return
  scene.selectAnimTrack(track.id)
  await scene.applyAnimationAssetToAnimTrack(track.id, asset.id)
}

async function onTimelineSkelDrop(track: DirectorAnimTrack, event: DragEvent): Promise<void> {
  dropTrackId.value = null
  if (track.targetKind !== 'object') return
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset || !isAnimationModelAsset(asset)) return
  scene.selectAnimTrack(track.id)
  await scene.applyAnimationAssetToAnimTrack(track.id, asset.id, dropTimeFromEvent(event))
}

function onSelectedSegmentSpeedInput(track: DirectorAnimTrack, event: Event): void {
  const seg = selectedSkeletonSegment(track)
  if (!seg) return
  const speed = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(speed)) return
  scene.updateSkeletonClipSegment(track.id, seg.id, {
    speed: Math.min(2, Math.max(0.25, speed))
  })
}

function toggleSelectedSegmentLoop(track: DirectorAnimTrack): void {
  const seg = selectedSkeletonSegment(track)
  if (!seg) return
  scene.updateSkeletonClipSegment(track.id, seg.id, { loop: seg.loop === false })
}

function removeSelectedSegment(track: DirectorAnimTrack): void {
  const seg = selectedSkeletonSegment(track)
  if (!seg) return
  scene.removeSkeletonClipSegment(track.id, seg.id)
}

function formatKeyframeHint(track: DirectorAnimTrack): string {
  const kfs = track.keyframes ?? []
  if (!kfs.length) return ''
  const atPlay =
    kfs.find((kf) => Math.abs(kf.time - currentTime.value) < 0.06) ??
    kfs.slice().sort((a, b) => Math.abs(a.time - currentTime.value) - Math.abs(b.time - currentTime.value))[0]
  const p = atPlay?.position
  if (!p) return ''
  return `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`
}

function kfLineStyle(track: DirectorAnimTrack): Record<string, string> {
  const kfs = [...(track.keyframes ?? [])].sort((a, b) => a.time - b.time)
  if (kfs.length < 2) return { display: 'none' }
  const left = timeToX(kfs[0].time)
  const right = timeToX(kfs[kfs.length - 1].time)
  return {
    left: `${left}px`,
    width: `${Math.max(2, right - left)}px`
  }
}

function togglePlay(): void {
  if (playing.value) scene.pauseAnimation()
  else scene.playAnimation()
}

function onSeek(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(value)) scene.seekAnimation(value)
}

function onDuration(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(value)) scene.setAnimDuration(value)
}

function toggleAddMenu(): void {
  addMenuOpen.value = !addMenuOpen.value
  drawMenuTrackId.value = null
  axisMenuTrackId.value = null
}

function addTrack(kind: 'camera' | 'object', id: string): void {
  scene.addAnimTrack(kind, id)
  addMenuOpen.value = false
}

function toggleDrawMenu(trackId: string): void {
  drawMenuTrackId.value = drawMenuTrackId.value === trackId ? null : trackId
  axisMenuTrackId.value = null
  addMenuOpen.value = false
}

function toggleAxisMenu(trackId: string): void {
  axisMenuTrackId.value = axisMenuTrackId.value === trackId ? null : trackId
  drawMenuTrackId.value = null
  addMenuOpen.value = false
}

function toggleOrientToPath(track: DirectorAnimTrack): void {
  scene.setAnimTrackOrientToPath(track.id, !track.orientToPath)
}

function onForwardAxisPick(track: DirectorAnimTrack, axis: DirectorPathForwardAxis): void {
  scene.setAnimTrackPathForwardAxis(track.id, axis)
  axisMenuTrackId.value = null
}

function startDraw(trackId: string, kind: DirectorAnimPathKind): void {
  drawMenuTrackId.value = null
  scene.beginPathDraw(trackId, kind)
}

function onTimelineWheel(e: WheelEvent): void {
  const next = Math.min(200, Math.max(30, pxPerSecond.value * (e.deltaY > 0 ? 0.9 : 1.1)))
  pxPerSecond.value = next
}

function onZoomInput(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  pxPerSecond.value = Math.min(200, Math.max(30, value))
}

function onPlaybackRate(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  scene.setAnimPlaybackRate(value)
}

async function onExportVideo(): Promise<void> {
  if (exporting.value) return
  try {
    await scene.exportAnimationVideo()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    window.alert(message)
  }
}

function onTimelineScroll(): void {
  if (syncingScroll || !timelineEl.value || !rulerWrapEl.value) return
  syncingScroll = true
  rulerWrapEl.value.scrollLeft = timelineEl.value.scrollLeft
  syncingScroll = false
}

function onRulerScroll(): void {
  if (syncingScroll || !timelineEl.value || !rulerWrapEl.value) return
  syncingScroll = true
  timelineEl.value.scrollLeft = rulerWrapEl.value.scrollLeft
  syncingScroll = false
}

let clipDrag: { trackId: string; startX: number; originStart: number; originEnd: number } | null =
  null
let keyframeDrag: { trackId: string; keyframeId: string; startX: number; originTime: number } | null =
  null
let playheadDragging = false

function clientXToTime(clientX: number): number {
  const wrap = rulerWrapEl.value
  if (!wrap) return currentTime.value
  const rect = wrap.getBoundingClientRect()
  const x = clientX - rect.left + wrap.scrollLeft
  const t = (x - TIME_ORIGIN_PAD) / pxPerSecond.value
  return Math.min(duration.value, Math.max(0, t))
}

function seekToClientX(clientX: number, persist = false): void {
  const time = clientXToTime(clientX)
  scene.seekAnimation(time, { persist })
}

function onRulerPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.playhead')) return
  playheadDragging = true
  seekToClientX(e.clientX, false)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPlayheadPointerMove)
  window.addEventListener('pointerup', onPlayheadPointerUp)
}

function onPlayheadPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  playheadDragging = true
  seekToClientX(e.clientX, false)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPlayheadPointerMove)
  window.addEventListener('pointerup', onPlayheadPointerUp)
}

function onPlayheadPointerMove(e: PointerEvent): void {
  if (!playheadDragging) return
  seekToClientX(e.clientX, false)
}

function onPlayheadPointerUp(): void {
  if (playheadDragging) {
    scene.seekAnimation(currentTime.value, { persist: false })
  }
  playheadDragging = false
  window.removeEventListener('pointermove', onPlayheadPointerMove)
  window.removeEventListener('pointerup', onPlayheadPointerUp)
}

function onClipPointerDown(e: PointerEvent, trackId: string): void {
  const track = tracks.value.find((tr) => tr.id === trackId)
  if (!track) return
  clipDrag = {
    trackId,
    startX: e.clientX,
    originStart: track.start,
    originEnd: track.end
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onClipPointerMove)
  window.addEventListener('pointerup', onClipPointerUp)
}

function onClipPointerMove(e: PointerEvent): void {
  if (!clipDrag) return
  const dt = (e.clientX - clipDrag.startX) / pxPerSecond.value
  const span = clipDrag.originEnd - clipDrag.originStart
  let start = clipDrag.originStart + dt
  start = Math.max(0, Math.min(start, duration.value - span))
  scene.setAnimTrackRange(clipDrag.trackId, start, start + span)
}

function onClipPointerUp(): void {
  clipDrag = null
  window.removeEventListener('pointermove', onClipPointerMove)
  window.removeEventListener('pointerup', onClipPointerUp)
}

type SkelSegDragMode = 'move' | 'left' | 'right'
let skelSegDrag: {
  trackId: string
  segmentId: string
  mode: SkelSegDragMode
  startX: number
  originStart: number
  originEnd: number
} | null = null

function onSkeletonSegPointerDown(
  e: PointerEvent,
  trackId: string,
  segmentId: string,
  mode: SkelSegDragMode
): void {
  if (e.button !== 0) return
  const track = tracks.value.find((tr) => tr.id === trackId)
  const seg = track ? skeletonSegments(track).find((item) => item.id === segmentId) : null
  if (!track || !seg) return
  scene.selectSkeletonClipSegment(trackId, segmentId)
  skelSegDrag = {
    trackId,
    segmentId,
    mode,
    startX: e.clientX,
    originStart: seg.start,
    originEnd: seg.end
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onSkeletonSegPointerMove)
  window.addEventListener('pointerup', onSkeletonSegPointerUp)
}

function onSkeletonSegPointerMove(e: PointerEvent): void {
  if (!skelSegDrag) return
  const dt = (e.clientX - skelSegDrag.startX) / pxPerSecond.value
  const span = skelSegDrag.originEnd - skelSegDrag.originStart
  if (skelSegDrag.mode === 'move') {
    let start = skelSegDrag.originStart + dt
    start = Math.max(0, Math.min(start, duration.value - span))
    scene.setSkeletonClipSegmentRange(
      skelSegDrag.trackId,
      skelSegDrag.segmentId,
      start,
      start + span
    )
    return
  }
  if (skelSegDrag.mode === 'left') {
    const start = skelSegDrag.originStart + dt
    scene.setSkeletonClipSegmentRange(
      skelSegDrag.trackId,
      skelSegDrag.segmentId,
      start,
      skelSegDrag.originEnd
    )
    return
  }
  const end = skelSegDrag.originEnd + dt
  scene.setSkeletonClipSegmentRange(
    skelSegDrag.trackId,
    skelSegDrag.segmentId,
    skelSegDrag.originStart,
    end
  )
}

function onSkeletonSegPointerUp(): void {
  skelSegDrag = null
  window.removeEventListener('pointermove', onSkeletonSegPointerMove)
  window.removeEventListener('pointerup', onSkeletonSegPointerUp)
}

function onKeyframePointerDown(e: PointerEvent, trackId: string, keyframeId: string): void {
  const track = tracks.value.find((tr) => tr.id === trackId)
  const kf = track?.keyframes.find((item) => item.id === keyframeId)
  if (!track || !kf) return
  scene.selectAnimKeyframe(trackId, keyframeId)
  keyframeDrag = {
    trackId,
    keyframeId,
    startX: e.clientX,
    originTime: kf.time
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onKeyframePointerMove)
  window.addEventListener('pointerup', onKeyframePointerUp)
}

function onKeyframePointerMove(e: PointerEvent): void {
  if (!keyframeDrag) return
  const dt = (e.clientX - keyframeDrag.startX) / pxPerSecond.value
  scene.moveAnimKeyframe(
    keyframeDrag.trackId,
    keyframeDrag.keyframeId,
    keyframeDrag.originTime + dt
  )
}

function onKeyframePointerUp(): void {
  keyframeDrag = null
  window.removeEventListener('pointermove', onKeyframePointerMove)
  window.removeEventListener('pointerup', onKeyframePointerUp)
}

function onDocPointerDown(e: PointerEvent): void {
  const target = e.target as HTMLElement | null
  if (!target?.closest('.add-wrap')) addMenuOpen.value = false
  if (!target?.closest('.draw-wrap')) drawMenuTrackId.value = null
  if (!target?.closest('.axis-wrap')) axisMenuTrackId.value = null
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  window.removeEventListener('pointermove', onClipPointerMove)
  window.removeEventListener('pointerup', onClipPointerUp)
  window.removeEventListener('pointermove', onKeyframePointerMove)
  window.removeEventListener('pointerup', onKeyframePointerUp)
  window.removeEventListener('pointermove', onPlayheadPointerMove)
  window.removeEventListener('pointerup', onPlayheadPointerUp)
})
</script>

<style scoped>
.anim-panel {
  position: relative;
  flex-shrink: 0;
  height: 176px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: #16181b;
  color: var(--text);
  user-select: none;
  transition: height 0.18s ease;
  overflow: visible;
}

.anim-panel.collapsed {
  height: 40px;
}

.anim-panel.collapsed .anim-toolbar {
  border-bottom: none;
}

.anim-toolbar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0;
  border-bottom: 1px solid var(--wash-06);
  flex-shrink: 0;
  height: 40px;
  box-sizing: border-box;
  position: relative;
  z-index: 5;
  overflow: visible;
}

.toolbar-side {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  box-sizing: border-box;
  border-right: 1px solid var(--wash-06);
  overflow: visible;
  z-index: 2;
}

.playback {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 0;
}

.icon-btn > span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover,
.icon-btn.active {
  background: var(--wash-08);
  color: var(--text);
}

.time-fields {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.time-input {
  width: 52px;
  height: 26px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #101214;
  color: var(--text);
  font-size: 12px;
}

.unit {
  font-size: 12px;
  color: var(--text-muted);
}

.add-wrap,
.draw-wrap,
.axis-wrap {
  position: relative;
  flex-shrink: 0;
}

.add-btn,
.draw-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.add-btn:hover,
.draw-btn:hover,
.draw-btn.active,
.orient-btn:hover,
.orient-btn.active {
  background: rgba(91, 156, 245, 0.16);
  border-color: rgba(91, 156, 245, 0.45);
  color: var(--accent-fg);
}

.orient-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.orient-icon {
  display: inline-flex;
  color: inherit;
}

.orient-btn.active .orient-icon {
  color: #5b9cf5;
}

.forward-axis-btn {
  box-sizing: border-box;
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  flex: 0 0 36px;
}

.forward-axis-btn:hover,
.axis-wrap:has(.axis-menu) .forward-axis-btn {
  border-color: rgba(91, 156, 245, 0.45);
  background: rgba(91, 156, 245, 0.12);
  color: var(--accent-fg);
}

.axis-menu {
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 44px;
  padding: 3px;
}

.axis-item {
  justify-content: center;
  padding: 5px 8px;
  font-variant-numeric: tabular-nums;
}

.axis-item.active {
  background: rgba(91, 156, 245, 0.28);
  color: var(--accent-fg);
}

.draw-icon {
  display: inline-flex;
  color: #5b9cf5;
}

.ruler-wrap {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  scrollbar-width: none;
  cursor: pointer;
}

.ruler-wrap::-webkit-scrollbar {
  display: none;
}

.ruler {
  position: relative;
  height: 100%;
  min-height: 22px;
  overflow: visible;
}

.ruler-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.ruler-mark .tick {
  display: block;
  width: 1px;
  height: 8px;
  margin-top: 4px;
  background: var(--wash-40);
  flex-shrink: 0;
}

.ruler-mark.minor .tick {
  height: 4px;
  margin-top: 8px;
  background: var(--wash-22);
}

.ruler-mark.major .tick {
  height: 8px;
  margin-top: 4px;
  background: var(--wash-45);
}

.ruler-mark .tick-label {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1;
  color: var(--text-muted);
  white-space: nowrap;
  /* 与刻度线水平居中，统一落在刻度下方 */
  transform: none;
}

.ruler-tools {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 268px;
  box-sizing: border-box;
  padding: 0 10px;
  justify-content: flex-end;
  background: linear-gradient(90deg, transparent, #16181b 18%);
  z-index: 6;
  pointer-events: auto;
}

.speed-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
  cursor: default;
}

.speed-label {
  white-space: nowrap;
}

.speed-input {
  width: 48px !important;
  height: 26px;
  padding: 0 4px !important;
  border-radius: 6px;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.export-btn {
  width: 26px;
  height: 26px;
  border: 1px solid var(--wash-12);
  border-radius: 6px;
}

.export-btn :deep(svg) {
  display: block;
}

.export-btn.busy {
  opacity: 0.55;
  cursor: wait;
}

.export-btn.busy :deep(circle) {
  fill: #c62828;
}

.zoom-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 88px;
  height: 4px;
  margin: 0;
  padding: 0 !important;
  border: none;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    #f2f2f2 0%,
    #f2f2f2 var(--zoom-fill, 33%),
    var(--slider-thumb-border) var(--zoom-fill, 33%),
    var(--slider-thumb-border) 100%
  );
  outline: none;
  cursor: pointer;
}

.zoom-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: transparent;
}

.zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

.zoom-slider::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--slider-thumb-border);
}

.zoom-slider::-moz-range-progress {
  height: 4px;
  border-radius: 999px;
  background: #f2f2f2;
}

.zoom-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

.collapse-btn {
  width: 26px;
  height: 26px;
  border: 1px solid var(--wash-12);
  border-radius: 6px;
}

.anim-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.track-list {
  width: 340px;
  flex-shrink: 0;
  overflow: auto;
  border-right: 1px solid var(--wash-06);
}

.empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.track-block {
  border-bottom: 1px solid var(--wash-04);
}

.track-block.selected {
  background: rgba(45, 160, 170, 0.22);
}

.track-block.asset-drag-over {
  background: rgba(91, 156, 245, 0.18);
  outline: 1px dashed rgba(91, 156, 245, 0.65);
  outline-offset: -2px;
}

.track-row,
.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 8px 0 12px;
}

.sub-row {
  min-height: 26px;
  padding-left: 28px;
  font-size: 11px;
  color: var(--text-muted);
}

.track-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.pos {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.kf {
  display: inline-flex;
  color: #5b9cf5;
}

.kf-add {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(91, 156, 245, 0.45);
  border-radius: 4px;
  background: transparent;
  color: var(--accent-fg);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.kf-add:hover {
  background: rgba(91, 156, 245, 0.2);
}

.skel-badge {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 3px;
  border: 1px solid rgba(126, 200, 160, 0.45);
  color: #9ed9b5;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.skeleton-row {
  gap: 8px;
}

.skel-label {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.skel-asset {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 88px;
  height: 22px;
  padding: 0 2px 0 6px;
  border-radius: 4px;
  border: 1px solid rgba(126, 200, 160, 0.4);
  background: rgba(126, 200, 160, 0.1);
  color: #9ed9b5;
  flex-shrink: 0;
}

.skel-asset-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.skel-asset-clear {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.skel-asset-clear:hover {
  background: var(--wash-12);
}

.skel-clip-name {
  flex: 1;
  min-width: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text);
}

.skel-speed {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--text-muted);
  font-size: 11px;
}

.skel-speed input {
  width: 48px;
  height: 22px;
  border: 1px solid var(--wash-12);
  border-radius: 4px;
  background: #15181c;
  color: var(--text);
  font-size: 11px;
  padding: 0 4px;
}

.skel-empty {
  color: var(--text-muted);
  font-size: 11px;
}

.remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.remove-btn:hover {
  background: var(--wash-08);
  color: var(--danger-muted);
}

.timeline {
  flex: 1;
  min-width: 0;
  overflow: auto;
  position: relative;
  background: var(--graph-viewport-bg);
}

.timeline-inner {
  position: relative;
  min-height: 100%;
  box-sizing: border-box;
  background-color: var(--director-sky);
  background-image: repeating-linear-gradient(
    90deg,
    var(--wash-05) 0,
    var(--wash-05) 1px,
    transparent 1px,
    transparent var(--px-per-sec, 80px)
  );
  box-shadow: inset -1px 0 0 var(--wash-14);
}

.timeline-block.selected .timeline-row {
  background: rgba(45, 160, 170, 0.12);
}

.timeline-row {
  position: relative;
  height: 32px;
  border-bottom: 1px solid var(--wash-04);
}

.timeline-row.kf-row {
  height: 26px;
}

.clip {
  position: absolute;
  top: 8px;
  height: 16px;
  border-radius: 3px;
  background: #2da0aa;
  cursor: grab;
}

.timeline-row.skel-lane {
  height: 28px;
  background: rgba(0, 0, 0, 0.12);
}

.timeline-row.skel-lane.asset-drag-over {
  background: rgba(91, 156, 245, 0.16);
  outline: 1px dashed rgba(91, 156, 245, 0.55);
  outline-offset: -2px;
}

.skel-lane-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding-left: 12px;
  font-size: 10px;
  color: var(--text-muted);
  pointer-events: none;
}

.skel-clip {
  position: absolute;
  top: 4px;
  height: 20px;
  display: flex;
  align-items: center;
  gap: 0;
  border-radius: 4px;
  border: 1px solid rgba(126, 200, 160, 0.55);
  background: linear-gradient(180deg, rgba(72, 140, 110, 0.95), rgba(48, 110, 88, 0.95));
  color: #e8fff2;
  cursor: grab;
  box-sizing: border-box;
  overflow: hidden;
  user-select: none;
}

.skel-clip.active {
  border-color: #b6f0cd;
  box-shadow: 0 0 0 1px rgba(182, 240, 205, 0.35);
}

.skel-clip-label {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
  font-size: 10px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.skel-handle {
  width: 6px;
  align-self: stretch;
  flex-shrink: 0;
  cursor: ew-resize;
  background: var(--wash-18);
}

.skel-handle:hover {
  background: var(--wash-35);
}

.add-btn.cut-btn {
  border-color: rgba(91, 156, 245, 0.45);
  color: var(--accent-fg);
}

.cut-badge {
  border-color: rgba(91, 156, 245, 0.5);
  color: #9ec9f5;
}

.cut-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.cut-add-btn:hover {
  border-color: rgba(91, 156, 245, 0.5);
  background: rgba(91, 156, 245, 0.16);
  color: var(--accent-fg);
}

.cut-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.cut-remove-btn:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(240, 113, 120, 0.14);
}

.timeline-row.cut-lane {
  background: rgba(91, 156, 245, 0.05);
}

.timeline-row.cut-lane.camera-drag-over {
  background: rgba(91, 156, 245, 0.16);
  outline: 1px dashed rgba(91, 156, 245, 0.55);
  outline-offset: -2px;
}

.cut-clip {
  position: absolute;
  top: 4px;
  height: 20px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  border: 1px solid rgba(91, 156, 245, 0.6);
  background: linear-gradient(180deg, rgba(64, 118, 190, 0.95), rgba(42, 88, 150, 0.95));
  color: #e8f2ff;
  cursor: grab;
  box-sizing: border-box;
  overflow: hidden;
  user-select: none;
}

.cut-clip.active {
  border-color: #b8d6f7;
  box-shadow: 0 0 0 1px rgba(184, 214, 247, 0.35);
}

.cut-clip.playing {
  border-color: #ffe08a;
  box-shadow: 0 0 0 1px rgba(255, 224, 138, 0.45);
}

.cut-clip-label {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
  font-size: 10px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.skel-count {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.kf-line {
  position: absolute;
  top: 50%;
  height: 1px;
  margin-top: -0.5px;
  background: #2da0aa;
  pointer-events: none;
  opacity: 0.85;
}

.diamond {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  padding: 0;
  border: 1.5px solid #5b9cf5;
  border-radius: 0;
  background: #121416;
  transform: translateY(-50%) rotate(45deg);
  cursor: ew-resize;
  z-index: 2;
}

.diamond.active {
  background: #5b9cf5;
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 1px rgba(158, 197, 255, 0.35);
}

.playhead {
  position: absolute;
  pointer-events: auto;
  z-index: 5;
  cursor: ew-resize;
}

.playhead-ruler {
  top: 0;
  bottom: 0;
  width: 12px;
  margin-left: -6px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.playhead-handle {
  display: block;
  width: 10px;
  height: 12px;
  margin-top: 2px;
  flex-shrink: 0;
  background: #fff;
  clip-path: polygon(0 0, 100% 0, 100% 68%, 50% 100%, 0 68%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.playhead-stem {
  display: block;
  width: 1px;
  flex: 1;
  min-height: 4px;
  background: #fff;
}

.playhead-track {
  top: 0;
  bottom: 0;
  width: 1px;
  margin-left: 0;
  background: #fff;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.menu {
  position: absolute;
  z-index: 20;
  min-width: 160px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #1c1e21;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
}

.add-menu {
  top: calc(100% + 4px);
  left: 0;
}

.draw-menu {
  top: calc(100% + 4px);
  right: 0;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover {
  background: rgba(91, 156, 245, 0.2);
}

.menu-tag {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.menu-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.kind-icon {
  display: inline-flex;
  width: 16px;
  justify-content: center;
  color: #ddd;
}

.draw-hint {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(20, 24, 28, 0.92);
  border: 1px solid rgba(125, 211, 160, 0.35);
  color: #9fe3b8;
  font-size: 11px;
  pointer-events: none;
}
</style>
