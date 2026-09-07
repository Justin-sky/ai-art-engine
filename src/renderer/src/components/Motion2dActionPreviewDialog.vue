<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="state.title || t('stage2d.actionPreviewTitle')"
    :z-index="2200"
    :default-width="920"
    :default-height="640"
    :min-width="560"
    :min-height="400"
    body-class="pad-none motion2d-action-preview-body"
    @close="closeMotion2dActionPreviewDialog"
  >
    <div
      v-if="state.open"
      class="m2d-action-preview"
    >
      <!-- 资产包/装配缺失：给引导，不出骨架 -->
      <div
        v-if="noPreviewableRig"
        class="m2d-empty"
      >
        <p class="m2d-empty-title">
          {{
            noPreviewableRig === 'noPack'
              ? t('stage2d.actionPreviewNoPack')
              : t('stage2d.actionPreviewNoRig')
          }}
        </p>
        <p class="m2d-empty-hint">
          {{ t('stage2d.actionPreviewNoRigHint') }}
        </p>
      </div>

      <template v-else>
        <div class="m2d-toolbar">
          <button
            type="button"
            class="play-btn"
            :class="{ active: playing }"
            :disabled="!playable"
            :title="playing ? t('stage2d.actionPreviewPause') : t('stage2d.actionPreviewPlay')"
            @click="togglePlay"
          >
            {{ playing ? '❚❚' : '▶' }}
          </button>
          <button
            type="button"
            :disabled="!playing && time === 0"
            :title="t('stage2d.actionPreviewStop')"
            @click="stopPlayback"
          >
            ■
          </button>

          <input
            :value="time"
            class="scrub"
            type="range"
            min="0"
            :max="duration || 0"
            step="0.01"
            :disabled="!playable"
            @input="onScrub"
          >
          <span class="time-label">{{ formatTime(time) }} / {{ formatTime(duration) }}</span>
          <span class="loop-chip">{{
            t(looping ? 'stage2d.actionPreviewLoop' : 'stage2d.actionPreviewOnce')
          }}</span>
        </div>

        <div class="stage stage-checker">
          <svg
            :viewBox="viewBox"
            preserveAspectRatio="xMidYMid meet"
            aria-label="stage-2d-action-preview"
          >
            <line
              v-for="(seg, index) in segments"
              :key="`l${index}`"
              class="bone"
              :x1="seg.x1"
              :y1="seg.y1"
              :x2="seg.x2"
              :y2="seg.y2"
            />
            <circle
              v-for="joint in jointPivots"
              :key="joint.jointId"
              class="joint"
              :cx="joint.x"
              :cy="joint.y"
              :r="jointRadius"
            />
          </svg>
        </div>

        <p
          v-if="noKeyframes"
          class="m2d-banner"
        >
          {{ t('stage2d.actionPreviewNoFrames') }}
        </p>
        <p
          v-else-if="playable"
          class="m2d-hint"
        >
          {{ t('stage2d.actionPreviewHint') }}
        </p>
        <p
          v-else
          class="m2d-banner"
        >
          {{ t('stage2d.actionPreviewSingleFrame') }}
        </p>
      </template>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  closeMotion2dActionPreviewDialog,
  motion2dActionPreviewDialogState
} from '../features/media/motion2dActionPreviewDialog'
import {
  computeStage2dRigTransforms,
  normalizeStage2dRig,
  readStage2dActionAssetFromGenParams,
  sampleStage2dAction,
  type Stage2dPose,
  type Stage2dRig
} from '@shared/gameAssets'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const project = useProjectStore()
const { t } = useStudioI18n()
const state = motion2dActionPreviewDialogState

/** 实时采样摆姿在舞台坐标系里的 Y 轴是「向下为正」，关节越小越接近 0/顶部 */
const FALLBACK_VIEW_BOX = '-120 -40 360 440'

const asset = computed(() =>
  state.open ? (project.assets.find((item) => item.id === state.assetId) ?? null) : null
)
const pack = computed(() =>
  asset.value ? readStage2dActionAssetFromGenParams(asset.value.genParams) : null
)
const rig = computed<Stage2dRig | null>(() =>
  pack.value?.rig ? normalizeStage2dRig(pack.value.rig) : null
)
const action = computed(() => pack.value?.action ?? null)

/** 没有动作帧 / 只有默认空帧的资产：骨架可看，但不可播 */
const keyframes = computed(() => action.value?.keyframes ?? [])
const hasAnyPoseKey = computed(() =>
  keyframes.value.some((frame) => Object.keys(frame.pose ?? {}).length > 0)
)
const noKeyframes = computed(() => keyframes.value.length === 0 || !hasAnyPoseKey.value)
const duration = computed(() => Math.max(0, Number(action.value?.duration) || 0))
const looping = computed(() => action.value?.loop !== false)
const playable = computed(
  () => !!rig.value?.joints.length && !noKeyframes.value && duration.value > 0
)

const noPreviewableRig = computed<'noPack' | 'noRig' | null>(() => {
  if (!pack.value) return 'noPack'
  const r = rig.value
  if (!r || !r.joints.length) return 'noRig'
  return null
})

const time = ref(0)
const playing = ref(false)

function formatTime(sec: number): string {
  const value = Number.isFinite(sec) ? sec : 0
  return `${Number(value.toFixed(2))}s`
}

function onScrub(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  const max = duration.value
  if (!Number.isFinite(value)) return
  time.value = max > 0 ? Math.min(Math.max(0, value), max) : 0
}

/** 关节世界变换（FK），驱动骨架线与圆点 */
const sampledPose = computed<Stage2dPose>(() =>
  action.value ? sampleStage2dAction(action.value, time.value) : {}
)
const jointTransforms = computed(() =>
  rig.value ? computeStage2dRigTransforms(rig.value, sampledPose.value) : []
)
const jointById = computed(
  () => new Map((rig.value?.joints ?? []).map((joint) => [joint.id, joint]))
)
const segments = computed(() => {
  const transformById = new Map(jointTransforms.value.map((item) => [item.jointId, item]))
  const list: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (const item of jointTransforms.value) {
    const parentId = jointById.value.get(item.jointId)?.parentId
    const parent = parentId ? transformById.get(parentId) : undefined
    if (parent) list.push({ x1: parent.x, y1: parent.y, x2: item.x, y2: item.y })
  }
  return list
})
const jointPivots = computed(() => jointTransforms.value)

/** 静态取景：绑定位 ∪ 每个关键帧覆盖到的骨架端点，再留约 18% 边距，播放时不跳视口 */
const viewBox = computed(() => {
  const r = rig.value
  if (!r) return FALLBACK_VIEW_BOX
  const poses: Stage2dPose[] = [{}, ...keyframes.value.map((frame) => frame.pose ?? {})]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let touched = false
  for (const pose of poses) {
    for (const item of computeStage2dRigTransforms(r, pose)) {
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) continue
      minX = Math.min(minX, item.x)
      minY = Math.min(minY, item.y)
      maxX = Math.max(maxX, item.x)
      maxY = Math.max(maxY, item.y)
      touched = true
    }
  }
  if (!touched) {
    if (Number.isFinite(r.root.x)) minX = maxX = r.root.x
    if (Number.isFinite(r.root.y)) minY = maxY = r.root.y
    touched = Number.isFinite(r.root.x) && Number.isFinite(r.root.y)
  }
  if (!touched) return FALLBACK_VIEW_BOX
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const pad = Math.max(24, Math.max(spanX, spanY) * 0.18)
  return `${minX - pad} ${minY - pad} ${spanX + pad * 2} ${spanY + pad * 2}`
})

/** 骨架圆点半径：跟随视口宽度（小骨架大半径，大骨架小半径） */
const jointRadius = computed(() => {
  const [, , w] = viewBox.value.split(' ').map(Number)
  return Number.isFinite(w) ? Math.max(2.2, Math.min(5.5, w / 140)) : 3
})

function togglePlay(): void {
  if (!playable.value) return
  if (playing.value) {
    playing.value = false
    return
  }
  if (time.value >= duration.value && looping.value) time.value = 0
  playing.value = true
}

function stopPlayback(): void {
  playing.value = false
  time.value = 0
}

let rafId = 0
let lastTs = 0
function tick(ts: number): void {
  if (!playing.value) {
    rafId = 0
    return
  }
  const dt = lastTs ? (ts - lastTs) / 1000 : 0
  lastTs = ts
  const dur = duration.value
  if (dur > 0) {
    let next = time.value + dt
    if (looping.value) {
      next = ((next % dur) + dur) % dur
    } else {
      next = Math.min(next, dur)
      if (next >= dur) {
        time.value = next
        playing.value = false
        rafId = 0
        return
      }
    }
    time.value = next
  }
  rafId = requestAnimationFrame(tick)
}

watch(playing, (on) => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  lastTs = 0
  if (on) rafId = requestAnimationFrame(tick)
})

/** 换资产 / 换动作数据：复位时间与播放 */
watch(
  () => pack.value?.action,
  () => {
    playing.value = false
    time.value = 0
  }
)

watch(
  () => state.open,
  (open) => {
    if (!open) {
      playing.value = false
      time.value = 0
    }
  }
)

onBeforeUnmount(() => {
  playing.value = false
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<style scoped>
:deep(.motion2d-action-preview-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.m2d-action-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 10px;
  box-sizing: border-box;
}

.m2d-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.m2d-toolbar button {
  min-width: 34px;
  height: 28px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.m2d-toolbar button:hover:not(:disabled) {
  border-color: var(--accent);
}

.m2d-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

.m2d-toolbar .play-btn {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
}

.m2d-toolbar .play-btn.active {
  background: var(--bg-input);
  color: var(--accent);
}

.scrub {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.time-label {
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  white-space: nowrap;
  font-size: 12px;
}

.loop-chip {
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  white-space: nowrap;
}

.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.stage svg {
  width: 100%;
  height: 100%;
  display: block;
}

.bone {
  stroke: var(--accent);
  stroke-width: 2;
  stroke-opacity: 0.85;
  stroke-linecap: round;
}

.joint {
  fill: var(--bg-input);
  stroke: var(--accent);
  stroke-width: 1.6;
}

.m2d-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 20px;
}

.m2d-empty-title {
  font-size: 14px;
  font-weight: 600;
}

.m2d-empty-hint,
.m2d-hint,
.m2d-banner {
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.m2d-empty-hint,
.m2d-banner {
  color: var(--text-dim);
}

.m2d-hint {
  color: var(--text-dim);
  opacity: 0.9;
}

.m2d-banner {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 6px 10px;
}

.stage-checker {
  background-color: var(--bg-input);
  background-image:
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    ),
    linear-gradient(45deg, var(--wash-16) 25%, transparent 25%, transparent 75%, var(--wash-16) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    8px 8px;
}
</style>
