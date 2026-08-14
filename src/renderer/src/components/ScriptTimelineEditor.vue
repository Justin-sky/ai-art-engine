<template>
  <div class="script-timeline">
    <div class="workspace">
      <aside class="panel sources-panel">
        <div class="panel-head">
          <span class="panel-title">{{ t('script.timeline.sources') }}</span>
          <div class="panel-actions">
            <button
              type="button"
              class="ghost-btn"
              :disabled="sourcesBusy"
              @click="reloadSources"
            >
              {{ sourcesBusy ? '…' : t('script.timeline.refreshSources') }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              :disabled="!videoSources.length"
              @click="autoPlaceAll"
            >
              {{ t('script.timeline.autoPlace') }}
            </button>
          </div>
        </div>
        <div
          class="source-list"
          @contextmenu.prevent="onImportedPanelContextMenu"
        >
          <section
            v-if="inputSources.length"
            class="source-group"
          >
            <div class="source-group-head">
              <span>{{ t('script.timeline.sourceGroup.input') }}</span>
              <span class="source-group-count">{{ inputSources.length }}</span>
            </div>
            <div
              v-for="src in inputSources"
              :key="`in-${src.id}`"
              class="source-card origin-input"
              draggable="true"
              @dragstart="onSourceDragStart($event, src)"
              @dblclick="onSourceActivate(src)"
            >
              <span
                class="source-thumb"
                :class="sourceThumbClass(src)"
                aria-hidden="true"
              >
                <img
                  v-if="sourceThumbUrls[src.id]"
                  :src="sourceThumbUrls[src.id]"
                  alt=""
                >
                <span
                  v-else-if="sourceMediaKind(src) === 'voice'"
                  class="source-thumb-glyph"
                >{{
                  voiceSourceIcon
                }}</span>
              </span>
              <span class="source-meta">
                <span class="source-name">{{ src.title }}</span>
                <span class="source-tags">
                  <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                  <span
                    v-if="src.durationSec"
                    class="source-dur"
                  >{{ formatTime(src.durationSec) }}</span>
                </span>
              </span>
            </div>
          </section>

          <section
            class="source-group imported-panel"
            @contextmenu.prevent="onImportedPanelContextMenu"
            @dragover.prevent="onImportedRootDragOver"
            @drop.prevent="onImportedRootDrop"
          >
            <div class="source-group-head">
              <span>{{ t('script.timeline.sourceGroup.imported') }}</span>
              <span class="source-group-count">{{ importedSources.length }}</span>
            </div>

            <div
              v-for="group in sourceGroups"
              :key="group.id"
              class="source-folder"
              :class="{
                collapsed: collapsedGroupIds.has(group.id),
                'drag-over': dropGroupId === group.id
              }"
              @contextmenu.prevent.stop="onGroupContextMenu($event, group.id)"
              @dragover.prevent.stop="onGroupDragOver($event, group.id)"
              @dragleave="onGroupDragLeave($event, group.id)"
              @drop.prevent.stop="onGroupDrop($event, group.id)"
            >
              <button
                type="button"
                class="folder-head"
                @click="toggleGroupCollapsed(group.id)"
              >
                <span
                  class="folder-chevron"
                  aria-hidden="true"
                >{{
                  collapsedGroupIds.has(group.id) ? '▸' : '▾'
                }}</span>
                <span class="folder-title">{{ group.title }}</span>
                <span class="source-group-count">{{ sourcesInGroup(group.id).length }}</span>
              </button>
              <div
                v-show="!collapsedGroupIds.has(group.id)"
                class="folder-body"
              >
                <div
                  v-for="src in sourcesInGroup(group.id)"
                  :key="`im-${src.id}`"
                  class="source-card origin-imported"
                  draggable="true"
                  @dragstart="onSourceDragStart($event, src)"
                  @dblclick="onSourceActivate(src)"
                >
                  <span
                    class="source-thumb"
                    :class="sourceThumbClass(src)"
                    aria-hidden="true"
                  >
                    <img
                      v-if="sourceThumbUrls[src.id]"
                      :src="sourceThumbUrls[src.id]"
                      alt=""
                    >
                    <span
                      v-else-if="sourceMediaKind(src) === 'voice'"
                      class="source-thumb-glyph"
                    >{{
                      voiceSourceIcon
                    }}</span>
                  </span>
                  <span class="source-meta">
                    <span class="source-name">{{ src.title }}</span>
                    <span class="source-tags">
                      <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                      <span
                        v-if="src.durationSec"
                        class="source-dur"
                      >{{
                        formatTime(src.durationSec)
                      }}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    class="source-remove"
                    :title="t('script.timeline.removeSource')"
                    @pointerdown.stop
                    @click.stop="removeSource(src.id)"
                  >
                    ×
                  </button>
                </div>
                <div
                  v-if="!sourcesInGroup(group.id).length"
                  class="folder-empty"
                >
                  {{ t('script.timeline.groupEmpty') }}
                </div>
              </div>
            </div>

            <div
              class="ungrouped-zone"
              :class="{ 'drag-over': dropGroupId === '' }"
              @contextmenu.prevent="onImportedPanelContextMenu"
              @dragover.prevent.stop="onGroupDragOver($event, '')"
              @dragleave="onGroupDragLeave($event, '')"
              @drop.prevent.stop="onGroupDrop($event, '')"
            >
              <div
                v-if="sourceGroups.length && ungroupedImportedSources.length"
                class="ungrouped-label"
              >
                {{ t('script.timeline.ungrouped') }}
              </div>
              <div
                v-for="src in ungroupedImportedSources"
                :key="`im-${src.id}`"
                class="source-card origin-imported"
                draggable="true"
                @dragstart="onSourceDragStart($event, src)"
                @dblclick="onSourceActivate(src)"
              >
                <span
                  class="source-thumb"
                  :class="sourceThumbClass(src)"
                  aria-hidden="true"
                >
                  <img
                    v-if="sourceThumbUrls[src.id]"
                    :src="sourceThumbUrls[src.id]"
                    alt=""
                  >
                  <span
                    v-else-if="sourceMediaKind(src) === 'voice'"
                    class="source-thumb-glyph"
                  >{{
                    voiceSourceIcon
                  }}</span>
                </span>
                <span class="source-meta">
                  <span class="source-name">{{ src.title }}</span>
                  <span class="source-tags">
                    <span class="source-tag imported">{{
                      t('script.timeline.sourceGroup.importedTag')
                    }}</span>
                    <span class="source-tag">{{ sourceMediaLabel(src) }}</span>
                    <span
                      v-if="src.durationSec"
                      class="source-dur"
                    >{{
                      formatTime(src.durationSec)
                    }}</span>
                  </span>
                </span>
                <button
                  type="button"
                  class="source-remove"
                  :title="t('script.timeline.removeSource')"
                  @pointerdown.stop
                  @click.stop="removeSource(src.id)"
                >
                  ×
                </button>
              </div>
              <div
                v-if="!importedSources.length && !sourceGroups.length"
                class="panel-empty subtle"
              >
                {{
                  inputSources.length
                    ? t('script.timeline.importedEmpty')
                    : t('script.timeline.sourcesEmpty')
                }}
              </div>
            </div>
          </section>
        </div>

        <div
          v-if="sourceCtx"
          class="source-ctx-menu"
          :style="{ left: `${sourceCtx.x}px`, top: `${sourceCtx.y}px` }"
          @pointerdown.stop
        >
          <button
            type="button"
            @click="createImportedGroup"
          >
            {{ t('script.timeline.createGroup') }}
          </button>
          <button
            v-if="sourceCtx.groupId"
            type="button"
            @click="renameImportedGroup"
          >
            {{ t('script.timeline.renameGroup') }}
          </button>
          <button
            v-if="sourceCtx.groupId"
            type="button"
            class="danger"
            @click="deleteImportedGroup"
          >
            {{ t('script.timeline.deleteGroup') }}
          </button>
        </div>
      </aside>

      <section class="panel preview-panel">
        <div class="preview-stage">
          <video
            v-if="previewSrc"
            ref="previewEl"
            class="preview-video"
            :src="previewSrc"
            playsinline
            preload="metadata"
            @ended="onPreviewEnded"
            @timeupdate="onPreviewTimeUpdate"
            @loadedmetadata="onPreviewLoaded"
          />
          <div
            v-else
            class="preview-empty"
          >
            <span
              class="play-glyph"
              aria-hidden="true"
            />
            <p>{{ t('script.timeline.emptyPreview') }}</p>
          </div>
          <div
            v-if="activeSubtitleText"
            class="subtitle-overlay"
          >
            {{ activeSubtitleText }}
          </div>
          <div class="preview-transport">
            <button
              type="button"
              class="preview-play-btn"
              :title="
                playing && playMode === 'solo'
                  ? t('script.timeline.pause')
                  : t('script.timeline.playSelected')
              "
              :disabled="!selectedPlayableClip"
              @click="togglePreviewPlay"
            >
              <span :class="playing && playMode === 'solo' ? 'pause' : 'triangle'" />
            </button>
            <span class="time">{{ formatTime(playheadSec) }} / {{ formatTime(totalDuration) }}</span>
          </div>
        </div>
      </section>
    </div>

    <section
      class="timeline-dock"
      :class="{ collapsed: timelineCollapsed }"
    >
      <header class="timeline-bar">
        <span class="timeline-bar-title">{{ t('script.dialog.timeline') }}</span>
        <div
          class="timeline-controls"
          @pointerdown.stop
        >
          <label
            class="ctrl-field"
            :title="t('script.timeline.durationHint')"
          >
            <span>{{ t('script.timeline.duration') }}</span>
            <input
              v-model.number="durationInputSec"
              class="ctrl-input"
              type="number"
              min="1"
              max="3600"
              step="1"
              @change="commitDuration"
            >
            <span class="ctrl-unit">s</span>
          </label>
          <label class="ctrl-field">
            <span>{{ t('script.timeline.rate') }}</span>
            <select
              v-model.number="playbackRate"
              class="ctrl-select"
              @change="onRateChange"
            >
              <option
                v-for="rate in PLAYBACK_RATE_OPTIONS"
                :key="rate"
                :value="rate"
              >
                {{ rate }}x
              </option>
            </select>
          </label>
          <label class="ctrl-check">
            <input
              v-model="loopPlayback"
              type="checkbox"
              @change="scheduleSave"
            >
            <span>{{ t('script.timeline.loop') }}</span>
          </label>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.toStart')"
            @click="seekToStart"
          >
            ⏮
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="
              playing && playMode === 'timeline'
                ? t('script.timeline.pause')
                : t('script.timeline.playTimeline')
            "
            @click="toggleTimelinePlay"
          >
            {{ playing && playMode === 'timeline' ? '⏸' : '▶' }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :title="t('script.timeline.zoomFit')"
            @click="zoomFit"
          >
            {{ t('script.timeline.zoomFit') }}
          </button>
          <span class="zoom-readout">{{ Math.round(zoomFactor * 100) }}%</span>
          <button
            type="button"
            class="export-btn"
            :disabled="exporting || !clips.length"
            :title="t('script.timeline.exportHint')"
            @click="exportTimeline"
          >
            {{
              exporting
                ? t('script.timeline.exporting', {
                  progress: Math.round(exportProgress * 100)
                })
                : t('script.timeline.export')
            }}
          </button>
        </div>
        <GraphToolbarCollapseBtn v-model="timelineCollapsed" />
      </header>

      <div
        v-show="!timelineCollapsed"
        ref="timelineBoardEl"
        class="timeline-board"
        :class="{ scrollable: needsHScroll }"
        @wheel.prevent="onTimelineWheel"
      >
        <div
          class="timeline-inner"
          :style="{ width: `${TRACK_LABEL_W + laneWidth}px` }"
        >
          <div class="ruler-row">
            <div class="track-label gutter" />
            <div
              class="ruler"
              @pointerdown="onRulerPointerDown"
            >
              <span
                v-for="mark in rulerMarks"
                :key="mark.t"
                class="ruler-tick"
                :style="{ left: `${mark.x}px` }"
              />
              <span
                v-for="mark in rulerMarks"
                :key="`lbl-${mark.t}`"
                class="ruler-mark"
                :class="{ start: mark.t === 0, end: mark.isEnd }"
                :style="{ left: `${mark.x}px` }"
              >
                {{ mark.label }}
              </span>
            </div>
          </div>

          <div
            v-for="track in tracks"
            :key="track.kind"
            class="track-row droppable"
            :data-track-kind="track.kind"
            :class="{ 'drag-over': dragOverTrack === track.kind }"
            @dragenter.prevent="onTrackDragOver($event, track.kind)"
            @dragover.prevent="onTrackDragOver($event, track.kind)"
            @dragleave="onTrackDragLeave($event, track.kind)"
            @drop.prevent="onTrackDrop($event, track.kind)"
          >
            <div class="track-label">
              {{ track.label }}
            </div>
            <div class="track-lane">
              <template v-if="track.kind === 'video' && !clipsOn(track.kind).length">
                <div class="lane-empty">
                  <span
                    class="play-glyph sm"
                    aria-hidden="true"
                  />
                  <span>{{ t('script.timeline.videoEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'voice' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span
                    class="speaker"
                    aria-hidden="true"
                  />
                  <span>{{ t('script.timeline.voiceEmpty') }}</span>
                </div>
              </template>
              <template v-else-if="track.kind === 'subtitle' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.subtitleEmpty') }}</span>
                </div>
                <button
                  type="button"
                  class="create-hint"
                  @click="addBlankSubtitle"
                >
                  {{ t('script.timeline.addSubtitle') }}
                </button>
              </template>
              <template v-else-if="track.kind === 'music' && !clipsOn(track.kind).length">
                <div class="lane-muted">
                  <span>{{ t('script.timeline.musicEmpty') }}</span>
                </div>
              </template>
              <button
                v-for="clip in clipsOn(track.kind)"
                :key="clip.id"
                type="button"
                class="clip"
                :class="{
                  active: clip.id === activeClipId,
                  subtitle: clip.track === 'subtitle',
                  dragging: clipDrag?.clipId === clip.id
                }"
                :style="clipStyle(clip)"
                @pointerdown.stop="onClipPointerDown($event, clip)"
                @dblclick.stop="onClipDblClick(clip)"
              >
                <span class="clip-title">{{ clipDisplayTitle(clip) }}</span>
                <span
                  class="clip-remove"
                  :title="t('script.timeline.removeClip')"
                  @pointerdown.stop
                  @click.stop="removeClip(clip.id)"
                >
                  ×
                </span>
              </button>
            </div>
          </div>

          <div
            class="playhead"
            :style="{ left: `${TRACK_LABEL_W + timeToX(playheadSec)}px` }"
            aria-hidden="true"
          >
            <span class="playhead-cap" />
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="subtitleEditor"
      class="subtitle-edit-mask"
      @click.self="cancelSubtitleEdit"
    >
      <div
        class="subtitle-edit-panel"
        role="dialog"
        aria-modal="true"
      >
        <div class="subtitle-edit-title">
          {{ t('script.timeline.editSubtitle') }}
        </div>
        <input
          ref="subtitleInputEl"
          v-model="subtitleEditor.draft"
          class="subtitle-edit-input"
          type="text"
          maxlength="200"
          @keydown.enter.prevent="commitSubtitleEdit"
          @keydown.escape.prevent="cancelSubtitleEdit"
        >
        <div class="subtitle-edit-actions">
          <button
            type="button"
            class="ghost-btn"
            @click="cancelSubtitleEdit"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="export-btn"
            @click="commitSubtitleEdit"
          >
            {{ t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ASSET_TYPE_ICONS, isDraftAssetId, type AssetInfo } from '@shared/domain'
import {
  normalizePlaybackRate,
  normalizeScriptTimelineSource,
  normalizeScriptTimelineSourceGroup,
  readScriptTimelineFromGenParams,
  withScriptTimeline,
  type ScriptTimelineClip,
  type ScriptTimelineDocument,
  type ScriptTimelineSource,
  type ScriptTimelineSourceGroup,
  type ScriptTimelineSourceMediaKind,
  type ScriptTimelineTrackKind,
  type TimelineExportClip
} from '@shared/graph'
import { detectImportAssetType, isImportablePath } from '@shared/import'
import { useStudioI18n } from '../composables/useStudioI18n'
import { persistAssetRecord } from '../composables/useAssetRecord'
import { promptAlert, promptConfirm, promptText } from '../composables/useStudioPrompt'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'
import { collectScriptTimelineSources } from '../features/script/collectScriptTimelineSources'
import { exportTimelineViaRecorder } from '../features/script/exportTimelineFallback'
import { toPlain } from '../utils/toPlain'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'

const props = defineProps<{
  scriptAssetId: string
}>()

const { t } = useStudioI18n()
const project = useProjectStore()
const drafts = useDraftStore()
const workspace = useWorkspaceStore()

const DRAFT_MIME = 'application/x-aiart-timeline-source'
/** 导入列表内整理分组用（与上轨 MIME 并存） */
const SOURCE_MOVE_MIME = 'application/x-aiart-timeline-source-id'
const TRACK_LABEL_W = 72
const PX_PER_SEC_MAX = 160
const PX_PER_SEC_MIN = 4
const ZOOM_MIN = 0.25
const ZOOM_MAX = 8
const minLaneSec = 12
const PLAYBACK_RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

const sources = ref<ScriptTimelineSource[]>([])
const sourceGroups = ref<ScriptTimelineSourceGroup[]>([])
const clips = ref<ScriptTimelineClip[]>([])
const sourcesBusy = ref(false)
/** 视频素材首帧预览 URL（与资产库列表同源） */
const sourceThumbUrls = ref<Record<string, string>>({})
const sourceThumbPathById = new Map<string, string>()
const voiceSourceIcon = ASSET_TYPE_ICONS.voice
const collapsedGroupIds = ref<Set<string>>(new Set())
const dropGroupId = ref<string | null>(null)
const sourceCtx = ref<{ x: number; y: number; groupId: string | null } | null>(null)
const playheadSec = ref(0)
const playing = ref(false)
/** timeline=整轨联播；solo=仅预览区播选中片段 */
const playMode = ref<'timeline' | 'solo' | null>(null)
const activeClipId = ref<string | null>(null)
const previewSrc = ref('')
const previewEl = ref<HTMLVideoElement | null>(null)
const timelineBoardEl = ref<HTMLElement | null>(null)
const timelineCollapsed = ref(false)
const viewportLanePx = ref(0)
/** 相对「铺满可视宽度」的缩放倍率 */
const zoomFactor = ref(1)
const durationSec = ref(minLaneSec)
const durationInputSec = ref(minLaneSec)
const playbackRate = ref(1)
const loopPlayback = ref(false)
const exporting = ref(false)
const exportProgress = ref(0)
const subtitleEditor = ref<{ clipId: string | null; draft: string } | null>(null)
const subtitleInputEl = ref<HTMLInputElement | null>(null)
/** 当前可放置高亮的轨道 */
const dragOverTrack = ref<ScriptTimelineTrackKind | null>(null)
/** 轨道片段指针拖拽（自由挪动时间 / 换轨） */
const clipDrag = ref<{
  clipId: string
  pointerId: number
  grabOffsetSec: number
  moved: boolean
} | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let playSeq = 0
const audioEls = new Map<string, HTMLAudioElement>()

const hostId = computed(() => `asset:${props.scriptAssetId}`)

const tracks = computed(() => [
  { kind: 'video' as const, label: t('script.timeline.track.video') },
  { kind: 'voice' as const, label: t('script.timeline.track.voice') },
  { kind: 'subtitle' as const, label: t('script.timeline.track.subtitle') },
  { kind: 'music' as const, label: t('script.timeline.track.music') }
])

const inputSources = computed(() =>
  sources.value.filter((s) => (s.origin ?? 'input') === 'input')
)
const importedSources = computed(() =>
  sources.value.filter((s) => s.origin === 'imported')
)
const ungroupedImportedSources = computed(() =>
  importedSources.value.filter((s) => !s.groupId || !sourceGroups.value.some((g) => g.id === s.groupId))
)
const videoSources = computed(() =>
  sources.value.filter((s) => (s.mediaKind ?? 'video') === 'video')
)

const selectedPlayableClip = computed(() => {
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  if (!clip) return null
  if (clip.track === 'video' || clip.track === 'voice' || clip.track === 'music') return clip
  return null
})

function sourcesInGroup(groupId: string): ScriptTimelineSource[] {
  return importedSources.value.filter((s) => s.groupId === groupId)
}

function toggleGroupCollapsed(groupId: string): void {
  const next = new Set(collapsedGroupIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedGroupIds.value = next
}

function closeSourceCtx(): void {
  sourceCtx.value = null
}

function onImportedPanelContextMenu(e: MouseEvent): void {
  sourceCtx.value = { x: e.clientX, y: e.clientY, groupId: null }
}

function onGroupContextMenu(e: MouseEvent, groupId: string): void {
  sourceCtx.value = { x: e.clientX, y: e.clientY, groupId }
}

function isImportedSourceDrag(e: DragEvent): boolean {
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  // 仅导入项带 SOURCE_MOVE_MIME；节点输入只有 DRAFT_MIME，不应高亮分组
  return types.includes(SOURCE_MOVE_MIME)
}

function onImportedRootDragOver(e: DragEvent): void {
  if (!isImportedSourceDrag(e)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onImportedRootDrop(e: DragEvent): void {
  // 落到面板空白处：移出分组
  void moveImportedSourceToGroup(e, null)
}

function onGroupDragOver(e: DragEvent, groupId: string): void {
  if (!isImportedSourceDrag(e)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropGroupId.value = groupId
}

function onGroupDragLeave(e: DragEvent, groupId: string): void {
  const related = e.relatedTarget as Node | null
  const el = e.currentTarget as HTMLElement | null
  if (related && el?.contains(related)) return
  if (dropGroupId.value === groupId) dropGroupId.value = null
}

function onGroupDrop(e: DragEvent, groupId: string): void {
  dropGroupId.value = null
  void moveImportedSourceToGroup(e, groupId || null)
}

async function moveImportedSourceToGroup(
  e: DragEvent,
  groupId: string | null
): Promise<void> {
  const id =
    e.dataTransfer?.getData(SOURCE_MOVE_MIME) ||
    (() => {
      const raw = e.dataTransfer?.getData(DRAFT_MIME)
      if (!raw) return ''
      try {
        const parsed = JSON.parse(raw) as { id?: string }
        return typeof parsed.id === 'string' ? parsed.id : ''
      } catch {
        return ''
      }
    })()
  if (!id) return
  const src = sources.value.find((s) => s.id === id)
  if (!src || src.origin !== 'imported') return
  const nextGroupId =
    groupId && sourceGroups.value.some((g) => g.id === groupId) ? groupId : null
  if ((src.groupId ?? null) === nextGroupId) return
  sources.value = sources.value.map((s) =>
    s.id === id ? { ...s, groupId: nextGroupId } : s
  )
  scheduleSave()
}

async function createImportedGroup(): Promise<void> {
  closeSourceCtx()
  const name = await promptText({
    title: t('script.timeline.createGroup'),
    message: t('script.timeline.groupNamePrompt'),
    defaultValue: t('script.timeline.groupNameDefault', {
      n: sourceGroups.value.length + 1
    }),
    placeholder: t('script.timeline.groupNamePlaceholder')
  })
  if (name == null) return
  const title = name.trim() || t('script.timeline.groupNameDefault', {
    n: sourceGroups.value.length + 1
  })
  const group: ScriptTimelineSourceGroup = {
    id: `sg:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
    title
  }
  sourceGroups.value = [...sourceGroups.value, group]
  scheduleSave()
}

async function renameImportedGroup(): Promise<void> {
  const groupId = sourceCtx.value?.groupId
  closeSourceCtx()
  const group = sourceGroups.value.find((g) => g.id === groupId)
  if (!group) return
  const name = await promptText({
    title: t('script.timeline.renameGroup'),
    message: t('script.timeline.groupNamePrompt'),
    defaultValue: group.title,
    placeholder: t('script.timeline.groupNamePlaceholder')
  })
  if (name == null) return
  const title = name.trim()
  if (!title) return
  sourceGroups.value = sourceGroups.value.map((g) =>
    g.id === group.id ? { ...g, title } : g
  )
  scheduleSave()
}

async function deleteImportedGroup(): Promise<void> {
  const groupId = sourceCtx.value?.groupId
  closeSourceCtx()
  if (!groupId) return
  const group = sourceGroups.value.find((g) => g.id === groupId)
  if (!group) return
  const ok = await promptConfirm({
    title: t('script.timeline.deleteGroup'),
    message: t('script.timeline.deleteGroupConfirm', { name: group.title })
  })
  if (!ok) return
  sourceGroups.value = sourceGroups.value.filter((g) => g.id !== groupId)
  sources.value = sources.value.map((s) =>
    s.origin === 'imported' && s.groupId === groupId ? { ...s, groupId: null } : s
  )
  const collapsed = new Set(collapsedGroupIds.value)
  collapsed.delete(groupId)
  collapsedGroupIds.value = collapsed
  scheduleSave()
}

function sourceMediaKind(src: ScriptTimelineSource): ScriptTimelineSourceMediaKind {
  return src.mediaKind === 'voice' ? 'voice' : 'video'
}

function sourceMediaLabel(src: ScriptTimelineSource): string {
  return sourceMediaKind(src) === 'voice'
    ? t('script.timeline.track.voice')
    : t('script.timeline.track.video')
}

function sourceThumbClass(src: ScriptTimelineSource): string {
  return sourceMediaKind(src) === 'voice' ? 'voice' : 'video'
}

function sourceRelativePath(source: {
  relativePath?: string
  assetId?: string
}): string {
  return (
    source.relativePath?.trim() ||
    (source.assetId
      ? project.assets.find((a) => a.id === source.assetId)?.relativePath?.trim()
      : '') ||
    ''
  )
}

async function loadSourceThumb(src: ScriptTimelineSource): Promise<void> {
  if (sourceMediaKind(src) === 'voice') return
  const rel = sourceRelativePath(src)
  if (!rel) return
  if (sourceThumbPathById.get(src.id) === rel && sourceThumbUrls.value[src.id]) return
  try {
    const url = await resolveAssetPreviewUrl(rel)
    if (!url) return
    sourceThumbPathById.set(src.id, rel)
    sourceThumbUrls.value = { ...sourceThumbUrls.value, [src.id]: url }
  } catch {
    /* 首帧提取失败时保留类型占位色 */
  }
}

async function refreshSourceThumbs(): Promise<void> {
  const alive = new Set(sources.value.map((s) => s.id))
  for (const id of [...sourceThumbPathById.keys()]) {
    if (alive.has(id)) continue
    sourceThumbPathById.delete(id)
    if (sourceThumbUrls.value[id]) {
      const next = { ...sourceThumbUrls.value }
      delete next[id]
      sourceThumbUrls.value = next
    }
  }
  for (const src of sources.value) {
    const rel = sourceRelativePath(src)
    if (sourceThumbPathById.get(src.id) && sourceThumbPathById.get(src.id) !== rel) {
      sourceThumbPathById.delete(src.id)
      if (sourceThumbUrls.value[src.id]) {
        const next = { ...sourceThumbUrls.value }
        delete next[src.id]
        sourceThumbUrls.value = next
      }
    }
    await loadSourceThumb(src)
  }
}

function defaultTrackForSource(src: ScriptTimelineSource): ScriptTimelineTrackKind {
  return sourceMediaKind(src) === 'voice' ? 'voice' : 'video'
}

function onSourceActivate(src: ScriptTimelineSource): void {
  void addSourceToTrack(src, defaultTrackForSource(src))
}

function sourceIdentityKey(src: Pick<ScriptTimelineSource, 'id' | 'assetId' | 'relativePath'>): string {
  const assetId = src.assetId?.trim()
  if (assetId) return `asset:${assetId}`
  const rel = src.relativePath?.trim().replace(/\\/g, '/')
  if (rel) return `path:${rel}`
  return `id:${src.id}`
}

function upsertImportedSource(
  source: ScriptTimelineSource,
  mediaKind: ScriptTimelineSourceMediaKind,
  durationSec?: number
): void {
  const normalized = normalizeScriptTimelineSource({
    ...source,
    origin: 'imported',
    mediaKind,
    ...(durationSec && durationSec > 0 ? { durationSec } : {})
  })
  if (!normalized) return
  const key = sourceIdentityKey(normalized)
  const idx = sources.value.findIndex((s) => sourceIdentityKey(s) === key)
  if (idx >= 0) {
    const prev = sources.value[idx]!
    sources.value = sources.value.map((s, i) =>
      i === idx
        ? {
            ...prev,
            ...normalized,
            // 刷新节点输入时不应把已有导入项盖成 input；这里强制 imported
            origin: 'imported',
            groupId: prev.groupId ?? null,
            durationSec: normalized.durationSec ?? prev.durationSec
          }
        : s
    )
  } else {
    sources.value = [...sources.value, { ...normalized, groupId: null }]
  }
}

function removeSource(id: string): void {
  const src = sources.value.find((s) => s.id === id)
  // 节点输入不可删；仅「导入素材」可从列表移除并同步清轨道
  if (!src || src.origin !== 'imported') return
  sources.value = sources.value.filter((s) => s.id !== id)
  const key = sourceIdentityKey(src)
  const removedClipIds = new Set<string>()
  clips.value = clips.value.filter((clip) => {
    const sameSource =
      clip.sourceId === src.id ||
      sourceIdentityKey({
        id: clip.sourceId,
        assetId: clip.assetId,
        relativePath: clip.relativePath
      }) === key
    if (sameSource) removedClipIds.add(clip.id)
    return !sameSource
  })
  if (activeClipId.value && removedClipIds.has(activeClipId.value)) {
    activeClipId.value = null
    previewSrc.value = ''
  }
  scheduleSave()
}

function patchSourceDuration(sourceId: string, durationSec: number): void {
  if (!(durationSec > 0)) return
  sources.value = sources.value.map((s) =>
    s.id === sourceId && !(s.durationSec && s.durationSec > 0) ? { ...s, durationSec } : s
  )
}

const contentEndSec = computed(() => {
  let max = 0
  for (const clip of clips.value) {
    max = Math.max(max, clip.startSec + clip.durationSec)
  }
  return max
})

/** 时间线总时长：用户设置与内容末端取较大 */
const totalDuration = computed(() =>
  Math.max(minLaneSec, durationSec.value, contentEndSec.value + (contentEndSec.value > 0 ? 0.5 : 0))
)

const fitPxPerSec = computed(() => {
  if (viewportLanePx.value <= 0) return 48
  return viewportLanePx.value / totalDuration.value
})

const pxPerSec = computed(() => {
  const raw = fitPxPerSec.value * zoomFactor.value
  return Math.min(PX_PER_SEC_MAX, Math.max(PX_PER_SEC_MIN, raw))
})

const laneWidth = computed(() =>
  Math.max(Math.ceil(totalDuration.value * pxPerSec.value), viewportLanePx.value || 0)
)

const needsHScroll = computed(() => laneWidth.value > viewportLanePx.value + 1)

const activeSubtitleText = computed(() => {
  for (const clip of clipsOn('subtitle')) {
    if (
      playheadSec.value >= clip.startSec &&
      playheadSec.value < clip.startSec + clip.durationSec
    ) {
      return (clip.text || clip.title).trim()
    }
  }
  return ''
})

const rulerMarks = computed(() => {
  const marks: Array<{ t: number; x: number; label: string; isEnd?: boolean }> = []
  const duration = totalDuration.value
  const pps = pxPerSec.value
  const step = pps >= 48 ? 1 : pps >= 24 ? 2 : pps >= 12 ? 5 : pps >= 6 ? 10 : 30
  for (let t = 0; t <= duration + 0.001; t += step) {
    const sec = Math.min(duration, t)
    marks.push({
      t: sec,
      x: timeToX(sec),
      label: formatTime(sec),
      isEnd: Math.abs(sec - duration) < 0.001
    })
    if (sec >= duration) break
  }
  const last = marks[marks.length - 1]
  if (!last || Math.abs(last.t - duration) > 0.05) {
    marks.push({
      t: duration,
      x: timeToX(duration),
      label: formatTime(duration),
      isEnd: true
    })
  } else {
    last.isEnd = true
  }
  return marks
})

function timeToX(sec: number): number {
  return Math.max(0, sec) * pxPerSec.value
}

function xToTime(x: number): number {
  return Math.max(0, x / pxPerSec.value)
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function clipsOn(kind: ScriptTimelineTrackKind): ScriptTimelineClip[] {
  return clips.value
    .filter((c) => c.track === kind)
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
}

function clipStyle(clip: ScriptTimelineClip): Record<string, string> {
  return {
    left: `${timeToX(clip.startSec)}px`,
    width: `${Math.max(36, timeToX(clip.durationSec))}px`
  }
}

function readGenParams(): Record<string, unknown> {
  if (isDraftAssetId(props.scriptAssetId)) {
    return { ...(drafts.getDraft(props.scriptAssetId)?.genParams ?? {}) }
  }
  const asset = project.assets.find((a) => a.id === props.scriptAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

function loadPersisted(): void {
  const doc = readScriptTimelineFromGenParams(readGenParams())
  clips.value = doc.clips.map((c) => ({ ...c }))
  if (doc.sources?.length) {
    sources.value = doc.sources
      .map((s) => normalizeScriptTimelineSource(s))
      .filter((s): s is ScriptTimelineSource => !!s)
  } else {
    sources.value = []
  }
  sourceGroups.value = (doc.sourceGroups ?? [])
    .map((g) => normalizeScriptTimelineSourceGroup(g))
    .filter((g): g is ScriptTimelineSourceGroup => !!g)
  // 清理指向已删分组的引用
  const groupIds = new Set(sourceGroups.value.map((g) => g.id))
  sources.value = sources.value.map((s) =>
    s.origin === 'imported' && s.groupId && !groupIds.has(s.groupId)
      ? { ...s, groupId: null }
      : s
  )
  const settings = doc.settings
  const content = contentEndSec.value
  const nextDuration = Math.max(
    minLaneSec,
    settings?.durationSec ?? Math.max(minLaneSec, content > 0 ? content + 2 : minLaneSec)
  )
  durationSec.value = nextDuration
  durationInputSec.value = Math.round(nextDuration)
  playbackRate.value = normalizePlaybackRate(settings?.playbackRate ?? 1)
  loopPlayback.value = settings?.loop === true
  applyPlaybackRate()
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persist()
  }, 280)
}

async function persist(): Promise<void> {
  const doc: ScriptTimelineDocument = {
    clips: toPlain(clips.value) as ScriptTimelineClip[],
    sources: toPlain(sources.value) as ScriptTimelineSource[],
    sourceGroups: toPlain(sourceGroups.value) as ScriptTimelineSourceGroup[],
    settings: {
      durationSec: durationSec.value,
      playbackRate: playbackRate.value,
      loop: loopPlayback.value
    }
  }
  const next = withScriptTimeline(readGenParams(), doc)
  if (isDraftAssetId(props.scriptAssetId)) {
    drafts.updateDraft(props.scriptAssetId, { genParams: next })
    return
  }
  await persistAssetRecord(props.scriptAssetId, { genParams: next })
}

function commitDuration(): void {
  const n = Number(durationInputSec.value)
  if (!Number.isFinite(n)) {
    durationInputSec.value = Math.round(durationSec.value)
    return
  }
  durationSec.value = Math.min(3600, Math.max(minLaneSec, Math.max(n, contentEndSec.value)))
  durationInputSec.value = Math.round(durationSec.value)
  scheduleSave()
}

function onRateChange(): void {
  playbackRate.value = normalizePlaybackRate(playbackRate.value)
  applyPlaybackRate()
  scheduleSave()
}

function applyPlaybackRate(): void {
  const el = previewEl.value
  if (el) el.playbackRate = playbackRate.value
  for (const audio of audioEls.values()) {
    audio.playbackRate = playbackRate.value
  }
}

function seekToStart(): void {
  playheadSec.value = 0
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(playing.value)
}

function zoomFit(): void {
  zoomFactor.value = 1
  const board = timelineBoardEl.value
  if (board) board.scrollLeft = 0
}

function onTimelineWheel(e: WheelEvent): void {
  const board = timelineBoardEl.value
  if (!board) return
  const rect = board.getBoundingClientRect()
  const cursorLaneX = e.clientX - rect.left + board.scrollLeft - TRACK_LABEL_W
  const timeAtCursor = Math.max(0, cursorLaneX / pxPerSec.value)
  const direction = e.deltaY < 0 ? 1 : -1
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomFactor.value * (direction > 0 ? 1.12 : 1 / 1.12)))
  if (Math.abs(next - zoomFactor.value) < 0.001) return
  zoomFactor.value = next
  void nextTick(() => {
    const newX = timeAtCursor * pxPerSec.value
    const viewX = e.clientX - rect.left - TRACK_LABEL_W
    board.scrollLeft = Math.max(0, newX - viewX)
  })
}

async function resolveSrc(source: {
  relativePath?: string
  assetId?: string
}): Promise<string> {
  const rel = sourceRelativePath(source)
  if (!rel) return ''
  try {
    return (await window.studio.getAssetFileUrl(rel)) || ''
  } catch {
    return ''
  }
}

async function probeDuration(src: string, media: 'video' | 'audio' = 'video'): Promise<number> {
  if (!src) return 3
  return new Promise((resolve) => {
    const el = media === 'audio' ? document.createElement('audio') : document.createElement('video')
    el.preload = 'metadata'
    el.src = src
    const done = (sec: number) => {
      el.removeAttribute('src')
      el.load()
      resolve(sec > 0 && Number.isFinite(sec) ? sec : 3)
    }
    el.onloadedmetadata = () => done(el.duration)
    el.onerror = () => done(3)
    window.setTimeout(() => done(3), 4000)
  })
}

async function reloadSources(): Promise<void> {
  sourcesBusy.value = true
  try {
    const collected = await collectScriptTimelineSources({
      scriptAssetId: props.scriptAssetId,
      hostId: hostId.value
    })
    const inputNext = collected
      .map((s) =>
        normalizeScriptTimelineSource({
          ...s,
          origin: 'input',
          mediaKind: s.mediaKind === 'voice' ? 'voice' : 'video'
        })
      )
      .filter((s): s is ScriptTimelineSource => !!s)
    const inputKeys = new Set(inputNext.map((s) => sourceIdentityKey(s)))
    // 刷新只更新「节点输入」；拖入的导入素材保留，且不被同路径输入覆盖
    const preservedImported = sources.value
      .filter((s) => {
        if (s.origin === 'imported') return !inputKeys.has(sourceIdentityKey(s))
        // 旧数据无 origin：不在本次输入集合里的视为导入项保留
        if (s.origin == null) return !inputKeys.has(sourceIdentityKey(s))
        return false
      })
      .map(
        (s) =>
          normalizeScriptTimelineSource({
            ...s,
            origin: 'imported',
            mediaKind: s.mediaKind === 'voice' ? 'voice' : 'video'
          })!
      )
      .filter(Boolean)
    sources.value = [...inputNext, ...preservedImported]
    scheduleSave()
  } finally {
    sourcesBusy.value = false
  }
}

function newClipId(): string {
  return `clip:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
}

function nextStartOnTrack(kind: ScriptTimelineTrackKind): number {
  const list = clipsOn(kind)
  if (!list.length) return 0
  const last = list[list.length - 1]!
  return last.startSec + last.durationSec
}

async function addSourceToTrack(
  source: ScriptTimelineSource,
  track: ScriptTimelineTrackKind,
  startSec?: number
): Promise<void> {
  const url = track === 'subtitle' ? '' : await resolveSrc(source)
  let durationSec = source.durationSec && source.durationSec > 0 ? source.durationSec : 0
  if (track === 'subtitle') {
    durationSec = durationSec > 0 ? Math.min(durationSec, 4) : 3
  } else if (!(durationSec > 0)) {
    const media = track === 'voice' || track === 'music' ? 'audio' : 'video'
    durationSec = await probeDuration(url, media)
  }
  const clip: ScriptTimelineClip = {
    id: newClipId(),
    track,
    sourceId: source.id,
    title: source.title,
    relativePath: source.relativePath,
    assetId: source.assetId,
    startSec: startSec ?? nextStartOnTrack(track),
    durationSec,
    ...(track === 'subtitle' ? { text: source.title } : {})
  }
  clips.value = [...clips.value, clip]
  activeClipId.value = clip.id
  patchSourceDuration(source.id, durationSec)
  scheduleSave()
  if (track === 'video') void showClipPreview(clip)
}

function addBlankSubtitle(): void {
  const placeholder = t('script.timeline.subtitlePlaceholder')
  const clip: ScriptTimelineClip = {
    id: newClipId(),
    track: 'subtitle',
    sourceId: `subtitle:${Date.now()}`,
    title: placeholder,
    text: placeholder,
    startSec: Math.max(0, playheadSec.value),
    durationSec: 3
  }
  clips.value = [...clips.value, clip]
  activeClipId.value = clip.id
  scheduleSave()
  openSubtitleEditor(clip)
}

function clipDisplayTitle(clip: ScriptTimelineClip): string {
  if (clip.track === 'subtitle') return (clip.text || clip.title).trim() || clip.title
  return clip.title
}

function onClipDblClick(clip: ScriptTimelineClip): void {
  if (clip.track === 'subtitle') {
    openSubtitleEditor(clip)
    return
  }
  seekToClip(clip)
}

function openSubtitleEditor(clip: ScriptTimelineClip): void {
  subtitleEditor.value = {
    clipId: clip.id,
    draft: clip.text || clip.title || ''
  }
  void nextTick(() => {
    const el = subtitleInputEl.value
    if (!el) return
    el.focus()
    el.select()
  })
}

function cancelSubtitleEdit(): void {
  subtitleEditor.value = null
}

function commitSubtitleEdit(): void {
  const editor = subtitleEditor.value
  if (!editor) return
  const text = editor.draft.trim() || t('script.timeline.subtitlePlaceholder')
  if (editor.clipId) {
    clips.value = clips.value.map((c) =>
      c.id === editor.clipId ? { ...c, text, title: text } : c
    )
  }
  subtitleEditor.value = null
  scheduleSave()
}

async function autoPlaceAll(): Promise<void> {
  if (!videoSources.value.length) await reloadSources()
  const videos = videoSources.value
  if (!videos.length) return
  clips.value = clips.value.filter((c) => c.track !== 'video')
  let cursor = 0
  for (const src of videos) {
    const url = await resolveSrc(src)
    const durationSec =
      src.durationSec && src.durationSec > 0 ? src.durationSec : await probeDuration(url, 'video')
    clips.value.push({
      id: newClipId(),
      track: 'video',
      sourceId: src.id,
      title: src.title,
      relativePath: src.relativePath,
      assetId: src.assetId,
      startSec: cursor,
      durationSec
    })
    patchSourceDuration(src.id, durationSec)
    cursor += durationSec
  }
  clips.value = [...clips.value]
  scheduleSave()
  const first = clipsOn('video')[0]
  if (first) {
    activeClipId.value = first.id
    void showClipPreview(first)
  }
}

function removeClip(id: string): void {
  clips.value = clips.value.filter((c) => c.id !== id)
  if (activeClipId.value === id) activeClipId.value = null
  scheduleSave()
}

function selectClip(clip: ScriptTimelineClip): void {
  activeClipId.value = clip.id
  void showClipPreview(clip)
}

function seekToClip(clip: ScriptTimelineClip): void {
  playheadSec.value = clip.startSec
  void showClipPreview(clip)
}

async function showClipPreview(clip: ScriptTimelineClip): Promise<void> {
  previewSrc.value = await resolveSrc(clip)
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  try {
    el.currentTime = 0
  } catch {
    /* ignore */
  }
}

function onSourceDragStart(e: DragEvent, source: ScriptTimelineSource): void {
  e.dataTransfer?.setData(DRAFT_MIME, JSON.stringify(source))
  if (source.origin === 'imported') {
    e.dataTransfer?.setData(SOURCE_MOVE_MIME, source.id)
    e.dataTransfer!.effectAllowed = 'copyMove'
  } else {
    e.dataTransfer!.effectAllowed = 'copy'
  }
}

function trackKindAtClientY(clientY: number): ScriptTimelineTrackKind | null {
  const board = timelineBoardEl.value
  if (!board) return null
  const rows = board.querySelectorAll<HTMLElement>('.track-row[data-track-kind]')
  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (clientY < rect.top || clientY > rect.bottom) continue
    const kind = row.dataset.trackKind
    if (
      kind === 'video' ||
      kind === 'voice' ||
      kind === 'subtitle' ||
      kind === 'music'
    ) {
      return kind
    }
  }
  return null
}

function laneRectForTrack(kind: ScriptTimelineTrackKind): DOMRect | null {
  const lane = timelineBoardEl.value?.querySelector(
    `.track-row[data-track-kind="${kind}"] .track-lane`
  ) as HTMLElement | null
  return lane?.getBoundingClientRect() ?? null
}

function bindClipDragListeners(): void {
  window.addEventListener('pointermove', onClipPointerMove)
  window.addEventListener('pointerup', onClipPointerUp)
  window.addEventListener('pointercancel', onClipPointerUp)
}

function unbindClipDragListeners(): void {
  window.removeEventListener('pointermove', onClipPointerMove)
  window.removeEventListener('pointerup', onClipPointerUp)
  window.removeEventListener('pointercancel', onClipPointerUp)
}

function onClipPointerDown(e: PointerEvent, clip: ScriptTimelineClip): void {
  if (e.button !== 0) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.clip-remove')) return
  selectClip(clip)
  const rect = laneRectForTrack(clip.track)
  const timeAtPointer = rect ? xToTime(e.clientX - rect.left) : clip.startSec
  // 换轨会重挂载 DOM，监听挂在 window 上以免丢掉拖拽
  unbindClipDragListeners()
  clipDrag.value = {
    clipId: clip.id,
    pointerId: e.pointerId,
    grabOffsetSec: timeAtPointer - clip.startSec,
    moved: false
  }
  bindClipDragListeners()
  e.preventDefault()
}

function onClipPointerMove(e: PointerEvent): void {
  const session = clipDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  const clip = clips.value.find((c) => c.id === session.clipId)
  if (!clip) return
  const kind = trackKindAtClientY(e.clientY) ?? clip.track
  const rect = laneRectForTrack(kind)
  if (!rect) return
  const startSec = Math.max(0, xToTime(e.clientX - rect.left) - session.grabOffsetSec)
  if (Math.abs(startSec - clip.startSec) < 0.001 && kind === clip.track) return
  session.moved = true
  clips.value = clips.value.map((c) =>
    c.id === session.clipId
      ? {
          ...c,
          track: kind,
          startSec,
          ...(kind === 'subtitle' && !c.text ? { text: c.text || c.title } : {})
        }
      : c
  )
}

function onClipPointerUp(e: PointerEvent): void {
  const session = clipDrag.value
  if (!session || e.pointerId !== session.pointerId) return
  clipDrag.value = null
  unbindClipDragListeners()
  if (session.moved) scheduleSave()
}

function isStudioAssetDrag(e: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

function hasExternalFiles(e: DragEvent): boolean {
  if (isStudioAssetDrag(e)) return false
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return types.includes('Files')
}

function canDropAssetOnTrack(asset: AssetInfo, kind: ScriptTimelineTrackKind): boolean {
  if (kind === 'video') return asset.type === 'video'
  if (kind === 'voice' || kind === 'music') return asset.type === 'voice'
  if (kind === 'subtitle') return asset.type === 'video' || asset.type === 'voice'
  return false
}

/** 拖到不匹配轨道时自动改送到合适轨道（如声音拖到视频轨 → 配音轨） */
function resolveTargetTrack(
  asset: AssetInfo,
  requested: ScriptTimelineTrackKind
): ScriptTimelineTrackKind | null {
  if (canDropAssetOnTrack(asset, requested)) return requested
  if (asset.type === 'voice') return requested === 'music' ? 'music' : 'voice'
  if (asset.type === 'video') return requested === 'subtitle' ? 'subtitle' : 'video'
  return null
}

function canAcceptExternalFilesOnTrack(kind: ScriptTimelineTrackKind): boolean {
  return kind === 'video' || kind === 'voice' || kind === 'music' || kind === 'subtitle'
}

function onTrackDragOver(e: DragEvent, kind: ScriptTimelineTrackKind): void {
  if (!e.dataTransfer) return

  if (e.dataTransfer.types.includes(DRAFT_MIME)) {
    // 素材上轨为 copy；若仍有 move 会话则配合 effectAllowed，避免 copy/move 不匹配导致无法放下
    const allowed = e.dataTransfer.effectAllowed
    e.dataTransfer.dropEffect =
      allowed === 'move' || allowed === 'linkMove' ? 'move' : 'copy'
    dragOverTrack.value = kind
    return
  }

  if (isStudioAssetDrag(e)) {
    const asset = workspace.resolveDraggedAsset(e)
    if (asset && !resolveTargetTrack(asset, kind)) {
      e.dataTransfer.dropEffect = 'none'
      dragOverTrack.value = null
      return
    }
    // dragover 阶段 Chromium 常读不到自定义 MIME；未解析到资产时仍放行，drop 时再校验
    e.dataTransfer.dropEffect = 'copy'
    dragOverTrack.value = kind
    return
  }

  if (hasExternalFiles(e) && canAcceptExternalFilesOnTrack(kind)) {
    e.dataTransfer.dropEffect = 'copy'
    dragOverTrack.value = kind
    return
  }

  e.dataTransfer.dropEffect = 'none'
  dragOverTrack.value = null
}

function onTrackDragLeave(e: DragEvent, kind: ScriptTimelineTrackKind): void {
  const related = e.relatedTarget as Node | null
  const row = e.currentTarget as HTMLElement | null
  if (related && row?.contains(related)) return
  if (dragOverTrack.value === kind) dragOverTrack.value = null
}

function assetToSource(asset: AssetInfo): ScriptTimelineSource | null {
  if (asset.type !== 'video' && asset.type !== 'voice') return null
  const relativePath = asset.relativePath?.trim()
  if (!relativePath && !asset.id) return null
  return {
    id: asset.id,
    title: asset.name?.trim() || asset.id,
    relativePath: relativePath || undefined,
    assetId: asset.id
  }
}

function dropStartFromEvent(e: DragEvent, kind: ScriptTimelineTrackKind): number {
  const lane = (e.currentTarget as HTMLElement).querySelector('.track-lane') as HTMLElement | null
  const rect = lane?.getBoundingClientRect()
  return rect ? Math.max(0, xToTime(e.clientX - rect.left)) : nextStartOnTrack(kind)
}

function resolveDroppedAssets(e: DragEvent): AssetInfo[] {
  const idsRaw = e.dataTransfer?.getData(STUDIO_ASSET_IDS_DRAG_MIME)
  if (idsRaw) {
    try {
      const parsed = JSON.parse(idsRaw) as unknown
      if (Array.isArray(parsed)) {
        const list = parsed
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => project.assets.find((a) => a.id === id) ?? null)
          .filter((a): a is AssetInfo => !!a)
        if (list.length) return list
      }
    } catch {
      /* fall through */
    }
  }
  const one = workspace.resolveDraggedAsset(e)
  return one ? [one] : []
}

function getDroppedFilePaths(e: DragEvent): string[] {
  const list = e.dataTransfer?.files
  if (!list?.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length; i++) {
    const path = window.studio.getPathForFile(list[i]!)
    if (path) paths.push(path)
  }
  return paths
}

function filterImportableMediaPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    if (!isImportablePath(path)) return false
    try {
      const type = detectImportAssetType(path)
      return type === 'video' || type === 'voice'
    } catch {
      return false
    }
  })
}

async function appendAssetsToTrack(
  assets: AssetInfo[],
  requestedKind: ScriptTimelineTrackKind,
  dropStart: number
): Promise<number> {
  const cursors = new Map<ScriptTimelineTrackKind, number>()
  let placed = 0
  for (const asset of assets) {
    const track = resolveTargetTrack(asset, requestedKind)
    if (!track) continue
    const source = assetToSource(asset)
    if (!source) continue
    const mediaKind: ScriptTimelineSourceMediaKind =
      asset.type === 'voice' ? 'voice' : 'video'
    // 先写入左侧「导入」列表；从轨道删除片段不会移除列表项
    upsertImportedSource(source, mediaKind)
    const listed = sources.value.find((s) => sourceIdentityKey(s) === sourceIdentityKey(source)) ?? {
      ...source,
      origin: 'imported' as const,
      mediaKind
    }
    const start = cursors.has(track)
      ? cursors.get(track)!
      : track === requestedKind
        ? dropStart
        : nextStartOnTrack(track)
    await addSourceToTrack(listed, track, start)
    placed += 1
    const last = clips.value[clips.value.length - 1]
    if (last) {
      cursors.set(track, last.startSec + last.durationSec)
      upsertImportedSource(listed, mediaKind, last.durationSec)
    }
  }
  return placed
}

async function importDroppedFilesOntoTrack(
  paths: string[],
  kind: ScriptTimelineTrackKind,
  dropStart: number
): Promise<void> {
  const accepted = filterImportableMediaPaths(paths)
  if (!accepted.length) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.dropUnsupported')
    })
    return
  }
  try {
    const result = await window.studio.importAssets({ filePaths: accepted })
    project.patchAssets(result.imported)
    if (!result.imported.length) {
      const detail =
        result.skipped.map((s) => s.reason).join('; ') || t('script.timeline.dropUnsupported')
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: t('script.timeline.importFailed', { error: detail })
      })
      return
    }
    const placed = await appendAssetsToTrack(result.imported, kind, dropStart)
    if (!placed) {
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: t('script.timeline.dropUnsupported')
      })
    }
  } catch (err) {
    await promptAlert({
      title: t('script.dialog.timeline'),
      message: t('script.timeline.importFailed', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }
}

async function onTrackDrop(e: DragEvent, kind: ScriptTimelineTrackKind): Promise<void> {
  dragOverTrack.value = null
  const dropStart = dropStartFromEvent(e, kind)

  const raw = e.dataTransfer?.getData(DRAFT_MIME)
  if (raw) {
    let payload: ScriptTimelineSource & {
      _moveClipId?: string
      durationSec?: number
      text?: string
    }
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (payload._moveClipId) {
      const idx = clips.value.findIndex((c) => c.id === payload._moveClipId)
      if (idx >= 0) {
        const prev = clips.value[idx]!
        const next: ScriptTimelineClip = {
          ...prev,
          track: kind,
          startSec: dropStart,
          ...(kind === 'subtitle' && !prev.text
            ? { text: prev.text || prev.title }
            : {})
        }
        clips.value = clips.value.map((c, i) => (i === idx ? next : c))
        scheduleSave()
        return
      }
    }
    await addSourceToTrack(
      {
        id: payload.id,
        title: payload.title,
        relativePath: payload.relativePath,
        assetId: payload.assetId,
        durationSec: payload.durationSec
      },
      kind,
      dropStart
    )
    return
  }

  const assets = resolveDroppedAssets(e)
  if (assets.length) {
    const placed = await appendAssetsToTrack(assets, kind, dropStart)
    workspace.setDraggingAsset(null)
    if (!placed) {
      await promptAlert({
        title: t('script.dialog.timeline'),
        message: t('script.timeline.dropUnsupported')
      })
    }
    return
  }

  // 资产库拖放但未能解析：静默忽略，避免误报系统文件错误
  if (isStudioAssetDrag(e)) {
    workspace.setDraggingAsset(null)
    return
  }

  const paths = getDroppedFilePaths(e)
  if (paths.length) {
    await importDroppedFilesOntoTrack(paths, kind, dropStart)
  }
}

function onRulerPointerDown(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  playheadSec.value = xToTime(e.clientX - rect.left)
  void syncPreviewToPlayhead()
  void syncAudioToPlayhead(playing.value)
}

function clipAtPlayhead(): ScriptTimelineClip | null {
  const list = clipsOn('video')
  for (const clip of list) {
    if (playheadSec.value >= clip.startSec && playheadSec.value < clip.startSec + clip.durationSec) {
      return clip
    }
  }
  return list.find((c) => c.startSec >= playheadSec.value) ?? null
}

function stopAllAudio(): void {
  for (const el of audioEls.values()) {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
  }
}

function disposeAudioPool(): void {
  for (const el of audioEls.values()) {
    try {
      el.pause()
      el.removeAttribute('src')
      el.load()
    } catch {
      /* ignore */
    }
  }
  audioEls.clear()
}

async function syncAudioToPlayhead(playingNow: boolean): Promise<void> {
  const audioClips = clips.value.filter((c) => c.track === 'voice' || c.track === 'music')
  const alive = new Set(audioClips.map((c) => c.id))
  for (const id of [...audioEls.keys()]) {
    if (alive.has(id)) continue
    const dead = audioEls.get(id)
    if (dead) {
      try {
        dead.pause()
        dead.removeAttribute('src')
        dead.load()
      } catch {
        /* ignore */
      }
    }
    audioEls.delete(id)
  }

  for (const clip of audioClips) {
    let el = audioEls.get(clip.id)
    if (!el) {
      el = new Audio()
      el.preload = 'auto'
      audioEls.set(clip.id, el)
      el.src = await resolveSrc(clip)
    }
    const local = playheadSec.value - clip.startSec
    const inRange = local >= -0.05 && local < clip.durationSec
    el.playbackRate = playbackRate.value
    if (!inRange) {
      if (!el.paused) el.pause()
      continue
    }
    try {
      if (Math.abs(el.currentTime - Math.max(0, local)) > 0.35) {
        el.currentTime = Math.max(0, local)
      }
    } catch {
      /* ignore */
    }
    if (playingNow) {
      if (el.paused) void el.play().catch(() => undefined)
    } else if (!el.paused) {
      el.pause()
    }
  }
}

async function syncPreviewToPlayhead(): Promise<void> {
  const clip = clipAtPlayhead()
  if (!clip) {
    previewSrc.value = ''
    return
  }
  activeClipId.value = clip.id
  const url = await resolveSrc(clip)
  if (previewSrc.value !== url) previewSrc.value = url
  await Promise.resolve()
  const el = previewEl.value
  if (!el) return
  applyPlaybackRate()
  const local = Math.max(0, playheadSec.value - clip.startSec)
  try {
    if (Math.abs(el.currentTime - local) > 0.2) el.currentTime = local
  } catch {
    /* ignore */
  }
}

function stopPlayback(): void {
  playing.value = false
  playMode.value = null
  playSeq += 1
  previewEl.value?.pause()
  stopAllAudio()
}

/** 时间线工具栏：整轨联播（视频序列 + 声音轨） */
async function toggleTimelinePlay(): Promise<void> {
  if (playing.value && playMode.value === 'timeline') {
    stopPlayback()
    return
  }
  stopPlayback()
  playMode.value = 'timeline'
  playing.value = true
  const seq = ++playSeq
  await syncAudioToPlayhead(true)
  await runSequence(seq)
}

/** 预览区：只播放当前选中的视频/声音片段 */
async function togglePreviewPlay(): Promise<void> {
  if (playing.value && playMode.value === 'solo') {
    stopPlayback()
    return
  }
  const clip = selectedPlayableClip.value
  if (!clip) return
  stopPlayback()
  playMode.value = 'solo'
  playing.value = true
  const seq = ++playSeq
  await runSoloClip(clip, seq)
}

async function runSoloClip(clip: ScriptTimelineClip, seq: number): Promise<void> {
  do {
    if (seq !== playSeq || !playing.value || playMode.value !== 'solo') return
    activeClipId.value = clip.id
    playheadSec.value = clip.startSec
    stopAllAudio()

    if (clip.track === 'video') {
      previewSrc.value = await resolveSrc(clip)
      await Promise.resolve()
      const el = previewEl.value
      if (!el) break
      try {
        applyPlaybackRate()
        el.currentTime = 0
        await el.play()
      } catch {
        break
      }
      await waitUntilClipEnd(el, clip, seq, { syncAudio: false })
    } else {
      // 声音：用独立 audio，不带动其他轨
      previewSrc.value = ''
      let el = audioEls.get(clip.id)
      if (!el) {
        el = new Audio()
        el.preload = 'auto'
        audioEls.set(clip.id, el)
      }
      el.src = await resolveSrc(clip)
      el.playbackRate = playbackRate.value
      try {
        el.currentTime = 0
        await el.play()
      } catch {
        break
      }
      await waitUntilAudioClipEnd(el, clip, seq)
    }

    if (!loopPlayback.value || seq !== playSeq || !playing.value || playMode.value !== 'solo') break
  } while (loopPlayback.value)

  if (seq === playSeq) {
    playing.value = false
    playMode.value = null
    stopAllAudio()
    previewEl.value?.pause()
  }
}

function waitUntilAudioClipEnd(
  el: HTMLAudioElement,
  clip: ScriptTimelineClip,
  seq: number
): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (seq !== playSeq || !playing.value || playMode.value !== 'solo') {
        cleanup()
        resolve()
        return
      }
      playheadSec.value = clip.startSec + (el.currentTime || 0)
      if (el.ended || el.currentTime >= clip.durationSec - 0.05) {
        cleanup()
        resolve()
      }
    }
    const cleanup = () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', tick)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', tick)
  })
}

async function runSequence(seq: number): Promise<void> {
  const list = clipsOn('video')
  if (!list.length) {
    // 仅音频/字幕时按时间轴空播
    const end = totalDuration.value
    const started = performance.now()
    const origin = playheadSec.value
    while (seq === playSeq && playing.value) {
      const elapsed = ((performance.now() - started) / 1000) * playbackRate.value
      playheadSec.value = origin + elapsed
      await syncAudioToPlayhead(true)
      if (playheadSec.value >= end) {
        if (loopPlayback.value) {
          playheadSec.value = 0
          return runSequence(seq)
        }
        break
      }
      await new Promise((r) => window.setTimeout(r, 40))
    }
    playing.value = false
    playMode.value = null
    stopAllAudio()
    return
  }

  const playFrom = async (startIndex: number, localOffset: number): Promise<void> => {
    for (let i = startIndex; i < list.length; i++) {
      if (seq !== playSeq || !playing.value) return
      const clip = list[i]!
      activeClipId.value = clip.id
      const startLocal = i === startIndex ? localOffset : 0
      playheadSec.value = clip.startSec + startLocal
      previewSrc.value = await resolveSrc(clip)
      await Promise.resolve()
      const el = previewEl.value
      if (!el) continue
      try {
        applyPlaybackRate()
        el.currentTime = startLocal
        await el.play()
      } catch {
        continue
      }
      await waitUntilClipEnd(el, clip, seq)
    }
  }

  let index = list.findIndex(
    (c) => playheadSec.value >= c.startSec && playheadSec.value < c.startSec + c.durationSec
  )
  let localOffset = 0
  if (index >= 0) {
    localOffset = Math.max(0, playheadSec.value - list[index]!.startSec)
  } else {
    index = list.findIndex((c) => c.startSec >= playheadSec.value)
    if (index < 0) index = 0
  }

  do {
    if (seq !== playSeq || !playing.value) return
    await playFrom(index, localOffset)
    if (!loopPlayback.value || seq !== playSeq || !playing.value) break
    index = 0
    localOffset = 0
    playheadSec.value = 0
  } while (loopPlayback.value)

  if (seq === playSeq) {
    playing.value = false
    playMode.value = null
    stopAllAudio()
  }
}

function waitUntilClipEnd(
  el: HTMLVideoElement,
  clip: ScriptTimelineClip,
  seq: number,
  options?: { syncAudio?: boolean }
): Promise<void> {
  const syncAudio = options?.syncAudio !== false
  return new Promise((resolve) => {
    const tick = () => {
      if (seq !== playSeq || !playing.value) {
        cleanup()
        resolve()
        return
      }
      playheadSec.value = clip.startSec + (el.currentTime || 0)
      if (syncAudio) void syncAudioToPlayhead(true)
      if (el.ended || el.currentTime >= clip.durationSec - 0.05) {
        cleanup()
        resolve()
      }
    }
    const cleanup = () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('ended', tick)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', tick)
  })
}

function onPreviewEnded(): void {
  /* sequence loop handles advance */
}

function onPreviewTimeUpdate(): void {
  if (!playing.value) return
  // solo 声音由 audio 回调推进
  if (playMode.value === 'solo' && selectedPlayableClip.value?.track !== 'video') return
  const clip = clips.value.find((c) => c.id === activeClipId.value)
  const el = previewEl.value
  if (!clip || !el) return
  playheadSec.value = clip.startSec + (el.currentTime || 0)
}

function onPreviewLoaded(): void {
  applyPlaybackRate()
}

function resolveClipRelativePath(clip: ScriptTimelineClip): string | undefined {
  const rel = clip.relativePath?.trim()
  if (rel) return rel
  if (!clip.assetId) return undefined
  return project.assets.find((a) => a.id === clip.assetId)?.relativePath?.trim() || undefined
}

async function exportTimeline(): Promise<void> {
  if (exporting.value || !clips.value.length) return
  stopPlayback()
  await persist()

  exporting.value = true
  exportProgress.value = 0
  const unsub = window.studio.onTimelineExportProgress(({ progress }) => {
    exportProgress.value = progress
  })
  try {
    const exportClips: TimelineExportClip[] = clips.value.map((c) => ({
      track: c.track,
      relativePath: resolveClipRelativePath(c),
      text: c.text,
      title: c.title,
      startSec: c.startSec,
      durationSec: c.durationSec
    }))
    const defaultFileName = `cut-${Date.now()}.mp4`
    let result = await window.studio.exportScriptTimeline({
      clips: exportClips,
      durationSec: totalDuration.value,
      playbackRate: playbackRate.value,
      defaultFileName
    })

    const needFallback =
      !result.ok &&
      !result.canceled &&
      /ffmpeg|ENOENT|not found|无法启动/i.test(result.error)

    if (needFallback) {
      exportProgress.value = 0.05
      const fb = await exportTimelineViaRecorder({
        clips: clips.value,
        durationSec: totalDuration.value,
        playbackRate: playbackRate.value,
        resolveSrc,
        defaultFileName: defaultFileName.replace(/\.mp4$/i, '.webm'),
        onProgress: (ratio) => {
          exportProgress.value = ratio
        }
      })
      if (fb.ok) {
        await promptAlert({
          title: t('script.timeline.export'),
          message: t('script.timeline.exportDoneFallback', { path: fb.filePath })
        })
        return
      }
      const prevError = result.ok ? 'export failed' : result.error
      const fbError = fb.ok ? 'fallback failed' : fb.error
      result = { ok: false, error: `${prevError}\n\n录制回退也失败：${fbError}` }
    }

    if (result.ok) {
      if (result.assetId) await project.refreshAssets()
      await promptAlert({
        title: t('script.timeline.export'),
        message: t('script.timeline.exportDone', { path: result.filePath })
      })
    } else if (!result.canceled) {
      await promptAlert({
        title: t('script.timeline.export'),
        message: t('script.timeline.exportFailed', { error: result.error })
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await promptAlert({
      title: t('script.timeline.export'),
      message: t('script.timeline.exportFailed', { error: message })
    })
  } finally {
    unsub()
    exporting.value = false
    exportProgress.value = 0
  }
}

function onDocPointerDownForSourceCtx(e: PointerEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('.source-ctx-menu')) return
  closeSourceCtx()
}

onMounted(async () => {
  loadPersisted()
  await reloadSources()
  const first = clipsOn('video')[0]
  if (first) void showClipPreview(first)
  bindTimelineViewport()
  window.addEventListener('pointerdown', onDocPointerDownForSourceCtx, true)
})

watch(
  () => props.scriptAssetId,
  async () => {
    stopPlayback()
    disposeAudioPool()
    sourceThumbUrls.value = {}
    sourceThumbPathById.clear()
    loadPersisted()
    await reloadSources()
  }
)

watch(
  () =>
    sources.value
      .map(
        (s) =>
          `${s.id}:${s.relativePath ?? ''}:${s.assetId ?? ''}:${s.mediaKind ?? ''}`
      )
      .join('|'),
  () => {
    void refreshSourceThumbs()
  },
  { immediate: true }
)

watch(timelineCollapsed, async (collapsed) => {
  if (collapsed) return
  await Promise.resolve()
  bindTimelineViewport()
})

watch(contentEndSec, (end) => {
  if (end <= durationSec.value) return
  durationSec.value = Math.max(durationSec.value, end)
  durationInputSec.value = Math.round(durationSec.value)
})

let timelineViewportRo: ResizeObserver | null = null

function bindTimelineViewport(): void {
  timelineViewportRo?.disconnect()
  const el = timelineBoardEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  const update = () => {
    viewportLanePx.value = Math.max(0, el.clientWidth - TRACK_LABEL_W)
  }
  update()
  timelineViewportRo = new ResizeObserver(update)
  timelineViewportRo.observe(el)
}

onBeforeUnmount(() => {
  stopPlayback()
  disposeAudioPool()
  timelineViewportRo?.disconnect()
  timelineViewportRo = null
  unbindClipDragListeners()
  clipDrag.value = null
  window.removeEventListener('pointerdown', onDocPointerDownForSourceCtx, true)
  closeSourceCtx()
  if (saveTimer) clearTimeout(saveTimer)
  void persist()
})

defineExpose({ flushSave: persist, reloadSources })
</script>

<style scoped>
.script-timeline {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.workspace {
  flex: 1;
  min-height: 120px;
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(280px, 1fr);
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sources-panel {
  background: var(--bg-elevated);
  border-right: 1px solid var(--border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.panel-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.panel-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.source-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.imported-panel {
  flex: 1;
  min-height: 120px;
  padding-bottom: 4px;
}

.source-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: none;
}

.source-folder {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 88%, var(--bg-elevated));
  overflow: hidden;
}

.source-folder.drag-over,
.ungrouped-zone.drag-over {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.folder-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.folder-head:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.folder-chevron {
  width: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.folder-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.folder-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 6px 8px;
}

.folder-empty {
  padding: 6px 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.ungrouped-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 64px;
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 2px;
}

.ungrouped-label {
  padding: 2px 2px 0;
  font-size: 10px;
  color: var(--text-muted);
}

.panel-empty.subtle {
  padding: 10px 4px;
  font-size: 11px;
}

.source-ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-ctx-menu button {
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.source-ctx-menu button:hover {
  background: var(--bg-hover);
}

.source-ctx-menu button.danger {
  color: var(--danger);
}

.source-group-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 16%, transparent);
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  color: var(--text-muted);
}

.source-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  color: var(--text);
  cursor: grab;
  text-align: left;
  box-sizing: border-box;
}

.source-card.origin-imported {
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
  background: color-mix(in srgb, var(--success) 6%, var(--bg-panel));
}

.source-card:active {
  cursor: grabbing;
}

.source-card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.source-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.source-remove:hover {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.source-thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  flex-shrink: 0;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 28%, var(--bg-elevated)),
    var(--bg-input)
  );
}

.source-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.source-thumb.voice {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--warning) 32%, var(--bg-elevated)),
    var(--bg-input)
  );
}

.source-thumb-glyph {
  font-size: 16px;
  line-height: 1;
  user-select: none;
}

.source-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.source-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.source-tag {
  font-size: 10px;
  color: var(--text-muted);
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-muted) 12%, transparent);
}

.source-tag.imported {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 16%, transparent);
}

.source-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-dur {
  font-size: 10px;
  color: var(--text-muted);
}

.preview-panel {
  background: var(--media-letterbox);
}

.preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.subtitle-overlay {
  position: absolute;
  left: 50%;
  bottom: 52px;
  transform: translateX(-50%);
  max-width: min(90%, 640px);
  padding: 6px 12px;
  border-radius: 6px;
  /* 叠在预览画面上：固定暗底白字，不受亮色主题影响 */
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 18px;
  line-height: 1.35;
  text-align: center;
  text-shadow: 0 1px 2px var(--on-media-line-shadow);
  pointer-events: none;
  z-index: 2;
}

.preview-transport {
  position: absolute;
  left: 10px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
}

.preview-play-btn {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preview-play-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preview-play-btn .triangle {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent currentColor;
}

.preview-play-btn .pause {
  width: 8px;
  height: 10px;
  box-sizing: border-box;
  border-left: 2.5px solid currentColor;
  border-right: 2.5px solid currentColor;
}

.play-glyph {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--text-muted) 55%, transparent);
  position: relative;
}

.play-glyph::before {
  content: '';
  position: absolute;
  left: 17px;
  top: 13px;
  border-style: solid;
  border-width: 8px 0 8px 12px;
  border-color: transparent transparent transparent color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.play-glyph.sm {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.play-glyph.sm::before {
  left: 8px;
  top: 5px;
  border-width: 5px 0 5px 8px;
}

.ghost-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-muted);
  cursor: pointer;
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.timeline-dock {
  flex: none;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.timeline-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  min-height: 36px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.timeline-dock.collapsed .timeline-bar {
  border-bottom: none;
}

.timeline-bar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.timeline-controls {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.ctrl-field,
.ctrl-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.ctrl-input,
.ctrl-select {
  width: 64px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
}

.ctrl-select {
  width: auto;
  min-width: 64px;
}

.ctrl-unit {
  font-size: 10px;
}

.ctrl-check input {
  margin: 0;
}

.zoom-readout {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 36px;
}

.export-btn {
  margin-left: 4px;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.export-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.subtitle-edit-mask {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: var(--overlay);
}

.subtitle-edit-panel {
  width: min(420px, calc(100% - 32px));
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.subtitle-edit-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.subtitle-edit-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  font-size: 13px;
}

.subtitle-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.timeline-board {
  flex: none;
  overflow: hidden;
  background: var(--bg-panel);
}

.timeline-board.scrollable {
  overflow-x: auto;
  overflow-y: hidden;
}

.timeline-inner {
  position: relative;
  height: 236px; /* 标尺 28 + 4 轨 × 52 */
  overflow: hidden;
}

.ruler-row,
.track-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: stretch;
}

.ruler-row {
  height: 28px;
}

.track-row {
  height: 52px;
}

.track-label {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-muted);
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
  z-index: 3;
}

.track-label.gutter {
  min-height: 0;
}

.ruler {
  position: relative;
  height: 28px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 80%, var(--bg));
  cursor: ew-resize;
  overflow: hidden;
}

.ruler-tick {
  position: absolute;
  top: 16px;
  bottom: 0;
  width: 0;
  border-left: 1px solid color-mix(in srgb, var(--text-muted) 45%, transparent);
  pointer-events: none;
}

.ruler-mark {
  position: absolute;
  top: 3px;
  font-size: 10px;
  line-height: 1;
  color: var(--text-muted);
  pointer-events: none;
  white-space: nowrap;
  transform: translateX(-50%);
}

.ruler-mark.start {
  transform: translateX(0);
  padding-left: 2px;
}

.ruler-mark.end:not(.start) {
  transform: translateX(-100%);
  padding-right: 2px;
}

.track-lane {
  position: relative;
  height: 52px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--bg));
  overflow: hidden;
}

.track-row.droppable .track-lane {
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
}

.track-row.drag-over .track-lane {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-panel));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
}

.lane-empty,
.lane-muted {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  pointer-events: none;
}

.create-hint {
  position: absolute;
  left: 50%;
  top: 4px;
  transform: translateX(-50%);
  z-index: 1;
  font-size: 11px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.speaker {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  opacity: 0.7;
}

.clip {
  position: absolute;
  top: 8px;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated));
  color: var(--text);
  font-size: 11px;
  cursor: grab;
  overflow: hidden;
  z-index: 1;
  touch-action: none;
  user-select: none;
}

.clip.dragging {
  cursor: grabbing;
  z-index: 4;
  opacity: 0.92;
}

.clip.active {
  outline: 1px solid var(--accent);
}

.clip.subtitle {
  background: color-mix(in srgb, var(--accent) 35%, var(--bg-elevated));
}

.clip-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-remove {
  flex: none;
  opacity: 0.7;
  font-size: 14px;
  line-height: 1;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px solid var(--success);
  pointer-events: none;
  z-index: 2;
}

.playhead-cap {
  position: absolute;
  top: 0;
  left: -6px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 8px 6px 0 6px;
  border-color: var(--success) transparent transparent transparent;
}
</style>
