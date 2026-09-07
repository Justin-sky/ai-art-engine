<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('stage2dVideo.dialogTitle')"
    :z-index="1310"
    :default-width="900"
    :default-height="620"
    :min-width="720"
    :min-height="460"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="sav-root">
      <aside class="sav-library">
        <p class="sav-side-title">
          {{ t('stage2dVideo.video') }}
        </p>
        <div v-if="!videoAssets.length" class="sav-empty">
          {{ t('stage2dVideo.videoEmpty') }}
        </div>
        <div v-else class="sav-assets">
          <button
            v-for="asset in videoAssets"
            :key="asset.id"
            type="button"
            class="sav-asset"
            :class="{ active: chosen?.id === asset.id }"
            :disabled="running"
            @click="chooseVideo(asset)"
          >
            {{ asset.name }}
          </button>
        </div>
      </aside>

      <div class="sav-main">
        <video v-if="previewUrl" :src="previewUrl" class="sav-video" controls muted playsinline />

        <div class="sav-params">
          <label class="sav-field">
            <span>{{ t('stage2dVideo.fps') }}</span>
            <select v-model.number="fps" :disabled="running">
              <option v-for="item in fpsOptions" :key="item" :value="item">
                {{ item }}
              </option>
            </select>
          </label>
          <label class="sav-check">
            <input v-model="flip" type="checkbox" :disabled="running" />
            {{ t('stage2dVideo.flip') }}
          </label>
          <label class="sav-check">
            <input v-model="loop" type="checkbox" :disabled="running" />
            {{ t('stage2dVideo.loop') }}
          </label>
        </div>

        <p v-if="durationSec > 0" class="sav-sample">
          {{
            t('stage2dVideo.sampling', {
              fps,
              count: estimateCount,
              seconds: formatSec(durationSec)
            })
          }}
        </p>

        <div class="sav-actions">
          <button type="button" class="sav-primary" :disabled="!canRun" @click="runAnalysis">
            {{
              running
                ? t('stage2dVideo.busy', { done: progress, total: estimateCount || 1 })
                : t('stage2dVideo.start')
            }}
          </button>
        </div>

        <p v-if="message" class="sav-message" :class="`kind-${messageKind}`">
          {{ message }}
        </p>

        <div v-if="built" class="sav-result">
          <label class="sav-field">
            <span>{{ t('stage2dVideo.name') }}</span>
            <input v-model="actionName" type="text" />
          </label>
          <p class="sav-done">
            {{
              t('stage2dVideo.doneInfo', {
                count: built.keyframes.length,
                seconds: formatSec(built.duration ?? 0)
              })
            }}
          </p>
          <div class="sav-result-actions">
            <button type="button" class="sav-primary" @click="applyAction">
              {{ t('stage2dVideo.apply') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetInfo } from '@shared/domain'
import {
  normalizeStage2dAction,
  solveStage2dPoseFromSkeleton,
  type Stage2dAction,
  type Stage2dPose,
  type Stage2dRig
} from '@shared/gameAssets'
import type { YoloPoseResult, YoloSkeletonPoint } from '@shared/yolo'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  POSE_KEYPOINT_MIN_CONF,
  bestPoseModel,
  followUpSelectedIndex
} from '../features/director/poseQuality'
import { dataUrlToRawInput, getYoloStatus, yoloPose } from '../features/yolo/api'
import { resolveAssetFileUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  rig: Stage2dRig
}>()

const emit = defineEmits<{
  close: []
  applied: [action: Stage2dAction]
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const fpsOptions = [4, 6, 8, 10, 12, 15, 24]
/** 单条表演视频最多采样帧数（避免长时间批量推理卡死 IPC） */
const MAX_FRAMES = 60
const GRAB_WIDTH = 720
const INFER_MAX_SIDE = 960

const videoAssets = computed(() =>
  project.assets.filter((asset) => asset.type === 'video' && !!asset.relativePath?.trim())
)

const chosen = ref<AssetInfo | null>(null)
const previewUrl = ref('')
const durationSec = ref(0)
const fps = ref(8)
const flip = ref(false)
const loop = ref(false)
const running = ref(false)
const progress = ref(0)
const aborted = ref(false)
const message = ref('')
const messageKind = ref<'info' | 'warn' | 'ok' | 'error'>('info')
const poseModelId = ref('')
const actionName = ref('')
const built = ref<Stage2dAction | null>(null)

const estimateCount = computed(() =>
  durationSec.value > 0
    ? Math.min(MAX_FRAMES, Math.max(2, Math.round(durationSec.value * fps.value)))
    : 0
)
const canRun = computed(
  () => !!chosen.value && durationSec.value > 0 && !!poseModelId.value && !running.value
)

function setMessage(text: string, kind: 'info' | 'warn' | 'ok' | 'error' = 'info'): void {
  message.value = text
  messageKind.value = kind
}

function formatSec(sec: number): string {
  const v = Math.max(0, Math.round(sec * 10) / 10)
  return `${v}s`
}

async function refreshYoloStatus(): Promise<void> {
  try {
    const status = await getYoloStatus()
    const models = (status.models ?? []).filter((model) => model.kind === 'pose')
    if (!models.length) {
      poseModelId.value = ''
      setMessage(t('stage2d.poseNoPoseModel'), 'error')
      return
    }
    const best = bestPoseModel(models)
    poseModelId.value = best?.id ?? models[0]?.id ?? ''
    setMessage('', 'info')
  } catch {
    poseModelId.value = ''
    setMessage(t('stage2d.poseYoloUnavailable'), 'error')
  }
}

function reset(): void {
  chosen.value = null
  previewUrl.value = ''
  durationSec.value = 0
  running.value = false
  progress.value = 0
  aborted.value = false
  built.value = null
  actionName.value = ''
  message.value = ''
  messageKind.value = 'info'
}

function onClose(): void {
  if (running.value) aborted.value = true
  emit('close')
}

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const done = (): void => {
      const d = Number.isFinite(video.duration) ? video.duration : 0
      video.removeAttribute('src')
      video.load()
      resolve(Math.max(0, d))
    }
    video.onloadedmetadata = done
    video.onerror = done
    video.src = url
  })
}

async function chooseVideo(asset: AssetInfo): Promise<void> {
  if (running.value) return
  chosen.value = asset
  actionName.value = asset.name
  built.value = null
  previewUrl.value = ''
  durationSec.value = 0
  message.value = ''
  const url = await resolveAssetFileUrl(asset.relativePath)
  if (!url) {
    setMessage(t('stage2dVideo.errorVideoOpen', { message: 'file url empty' }), 'error')
    return
  }
  previewUrl.value = url
  const duration = await probeDuration(url)
  if (chosen.value?.id !== asset.id) return
  durationSec.value = duration
  if (!duration) {
    setMessage(t('stage2dVideo.errorVideoOpen', { message: 'probe duration failed' }), 'warn')
  }
}

function meanConf(skeleton: readonly YoloSkeletonPoint[]): number {
  let sum = 0
  let count = 0
  for (const point of skeleton) {
    if (point && Number.isFinite(point.confidence)) {
      sum += point.confidence
      count += 1
    }
  }
  return count ? sum / count : 0
}

function pickSkeleton(
  result: YoloPoseResult,
  previous: readonly YoloSkeletonPoint[] | null
): YoloSkeletonPoint[] | null {
  if (!result.skeletons.length) return null
  const followed = previous ? followUpSelectedIndex(previous, result.skeletons) : null
  if (typeof followed === 'number' && result.skeletons[followed]) return result.skeletons[followed]
  let bestIndex = 0
  let bestScore = -1
  for (let index = 0; index < result.skeletons.length; index += 1) {
    const score = meanConf(result.skeletons[index])
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return result.skeletons[bestIndex] ?? null
}

async function runAnalysis(): Promise<void> {
  const asset = chosen.value
  if (!asset || running.value) return
  const count = estimateCount.value
  const duration = durationSec.value
  if (!count || !duration || !poseModelId.value) {
    setMessage(t('stage2dVideo.errorNoVideo'), 'error')
    return
  }
  aborted.value = false
  running.value = true
  progress.value = 0
  built.value = null
  setMessage('', 'info')
  try {
    const timestamps: number[] = []
    for (let index = 0; index < count; index += 1) {
      timestamps.push(count > 1 ? (index * duration) / (count - 1) : 0)
    }
    const frameUrls = await window.studio.grabVideoFramesAtTimestamps(
      asset.relativePath,
      timestamps,
      { width: GRAB_WIDTH }
    )
    const captured: Array<{ time: number; pose: Stage2dPose }> = []
    let previous: YoloSkeletonPoint[] | null = null
    for (let index = 0; index < frameUrls.length; index += 1) {
      if (aborted.value) break
      const time = frameUrls[index].timeSec ?? timestamps[index] ?? duration
      try {
        const input = await dataUrlToRawInput(frameUrls[index].dataUrl, INFER_MAX_SIDE)
        const result = await yoloPose({
          image: input,
          modelId: poseModelId.value,
          confThreshold: 0.25
        })
        const skeleton = pickSkeleton(result, previous)
        if (skeleton) {
          previous = skeleton
          const solved = solveStage2dPoseFromSkeleton({
            rig: props.rig,
            skeleton,
            flip: flip.value,
            driveTorso: true,
            minConfidence: POSE_KEYPOINT_MIN_CONF
          })
          if (solved.driven.length > 0) {
            captured.push({ time, pose: solved.pose })
          }
        }
      } catch (err) {
        void err
      }
      progress.value = index + 1
    }
    if (aborted.value) {
      setMessage('', 'info')
      return
    }
    if (!captured.length) {
      setMessage(t('stage2dVideo.errorPose', { message: '' }), 'error')
      return
    }
    const keyframes: Array<{ time: number; pose: Stage2dPose }> = []
    for (const entry of captured) keyframes.push({ time: entry.time, pose: entry.pose })
    if (keyframes[0].time > 0.0001) {
      keyframes.unshift({ time: 0, pose: keyframes[0].pose })
    }
    const lastTime = keyframes[keyframes.length - 1].time
    if (loop.value && keyframes.length > 1) {
      const step = 1 / Math.max(1, fps.value)
      keyframes.push({ time: lastTime + step, pose: keyframes[0].pose })
    }
    const action = normalizeStage2dAction({
      name: actionName.value.trim() || t('stage2dVideo.actionDefaultName'),
      loop: loop.value,
      duration: keyframes[keyframes.length - 1].time,
      keyframes: keyframes.map((entry) => ({ time: entry.time, pose: entry.pose }))
    })
    built.value = action
    setMessage('', 'info')
  } catch (err) {
    console.error('[stage2dActionFromVideo] failed:', err)
    setMessage(t('stage2dVideo.errorRun'), 'error')
  } finally {
    running.value = false
  }
}

function applyAction(): void {
  const action = built.value
  if (!action || running.value) return
  emit('applied', action)
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      reset()
      return
    }
    reset()
    void refreshYoloStatus()
  },
  { immediate: true }
)
</script>

<style scoped>
.sav-root {
  display: flex;
  height: 100%;
  min-height: 0;
}

.sav-library {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.sav-side-title {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.sav-empty {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-faint);
}

.sav-assets {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.sav-asset {
  text-align: left;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sav-asset:hover {
  background: var(--bg-soft);
}

.sav-asset.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.sav-main {
  flex: 1;
  min-width: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.sav-video {
  width: 100%;
  max-height: 220px;
  border-radius: 8px;
  background: #000;
}

.sav-params {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.sav-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sav-field span {
  font-size: 12px;
  color: var(--text-muted);
}

.sav-field input,
.sav-field select {
  min-width: 120px;
}

.sav-check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-strong);
}

.sav-sample {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}

.sav-actions,
.sav-result-actions {
  display: flex;
  gap: 8px;
}

.sav-message {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.sav-message.kind-info {
  color: var(--text-muted);
}

.sav-message.kind-warn {
  color: var(--warning);
}

.sav-message.kind-ok {
  color: var(--accent);
}

.sav-message.kind-error {
  color: var(--danger);
}

.sav-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
}

.sav-done {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-strong);
}
</style>
