<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('stage2d.poseDialogTitle')"
    :subtitle="t('stage2d.poseDialogSubtitle')"
    :z-index="1300"
    :default-width="1000"
    :default-height="680"
    :min-width="820"
    :min-height="500"
    body-class="pad-none"
    @close="closeDialog"
  >
    <div class="sp-root">
      <aside class="sp-library">
        <input
          v-model="query"
          class="sp-search"
          type="text"
          :placeholder="t('stage2d.poseSearch')"
        >
        <div class="sp-library-list">
          <button
            v-for="asset in filteredAssets"
            :key="asset.id"
            type="button"
            class="sp-asset-card"
            :class="{ active: chosen?.assetId === asset.id }"
            @click="chooseAsset(asset)"
          >
            <img
              v-if="thumbUrls[asset.relativePath]"
              :src="thumbUrls[asset.relativePath]"
              alt=""
            >
            <span
              v-else
              class="sp-asset-fallback"
            >🖼</span>
            <span class="sp-asset-name">{{ asset.name }}</span>
          </button>
          <p
            v-if="!filteredAssets.length"
            class="sp-library-empty"
          >
            {{ t('stage2d.poseNoImages') }}
          </p>
        </div>
      </aside>

      <section class="sp-main">
        <div class="sp-stage">
          <template v-if="previewUrl">
            <img
              :src="previewUrl"
              class="sp-preview-img"
              alt=""
            >
            <svg
              v-if="result && result.skeletons.length"
              class="sp-overlay"
              :viewBox="`0 0 ${overlayW} ${overlayH}`"
              @click="onStageClick"
            >
              <g
                v-for="(skel, personIndex) in result.skeletons"
                :key="personIndex"
                :class="{ person: true, selected: personIndex === selectedPerson }"
              >
                <line
                  v-for="(edge, edgeIndex) in personLines(skel)"
                  :key="`l${edgeIndex}`"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                />
                <circle
                  v-for="(point, pointIndex) in personPoints(skel)"
                  :key="`p${pointIndex}`"
                  :cx="point.x"
                  :cy="point.y"
                  r="4"
                />
              </g>
            </svg>
          </template>
          <div
            v-else
            class="sp-empty-stage"
          >
            <span>{{ t('stage2d.posePickFirst') }}</span>
          </div>
        </div>

        <div class="sp-controls">
          <label class="sp-field">
            <span>{{ t('stage2d.poseModel') }}</span>
            <select
              v-model="poseModelId"
              @change="onPoseModelPicked"
            >
              <option
                v-for="model in poseModels"
                :key="model.id"
                :value="model.id"
              >
                {{ model.id }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="sp-action"
            :disabled="!canDetect || detecting"
            @click="detectPose"
          >
            {{ detecting ? t('stage2d.poseDetecting') : t('stage2d.poseDetect') }}
          </button>
          <label class="sp-check">
            <input
              v-model="flip"
              type="checkbox"
            >
            {{ t('stage2d.poseFlip') }}
          </label>
          <label class="sp-check">
            <input
              v-model="driveTorso"
              type="checkbox"
            >
            {{ t('stage2d.poseDriveTorso') }}
          </label>
          <label
            v-if="result && result.skeletons.length > 1"
            class="sp-field sp-person"
          >
            <span>{{ t('stage2d.posePerson') }}</span>
            <select v-model.number="selectedPerson">
              <option
                v-for="(_, personIndex) in result.skeletons"
                :key="personIndex"
                :value="personIndex"
              >
                {{ t('stage2d.posePersonName', { n: personIndex + 1 }) }}
              </option>
            </select>
          </label>
        </div>

        <div class="sp-solve">
          <template v-if="drivableRoles === 0">
            <p class="sp-status warn">
              {{ t('stage2d.poseRigNoDrivable') }}
            </p>
          </template>
          <template v-else-if="result && result.skeletons.length">
            <p class="sp-status ok">
              {{ t('stage2d.posePeopleFound', { count: result.skeletons.length }) }}
            </p>
            <ul
              v-if="solved.segments.length"
              class="sp-seg-list"
            >
              <li
                v-for="(seg, segIndex) in solved.segments"
                :key="segIndex"
                class="sp-seg"
                :class="`s-${seg.status}`"
                :title="segReason(seg)"
              >
                {{ segLabel(seg) }}
              </li>
            </ul>
          </template>
          <p
            v-else-if="chosen && yoloError"
            class="sp-status warn"
          >
            {{ t('stage2d.poseYoloUnavailable') }}
          </p>
          <p
            v-else
            class="sp-status"
          >
            {{ t('stage2d.poseSolveEmptyHint') }}
          </p>
        </div>

        <p
          v-if="message"
          class="sp-status"
          :class="messageKind"
        >
          {{ message }}
        </p>
      </section>
    </div>

    <template #footer>
      <span class="sp-footer-hint">{{ t('stage2d.poseFooterHint') }}</span>
      <button
        type="button"
        class="icon"
        @click="closeDialog"
      >
        {{ t('stage2d.poseCancel') }}
      </button>
      <button
        type="button"
        class="primary"
        :disabled="!canApply"
        @click="applyPose"
      >
        {{ t('stage2d.poseApply') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetInfo } from '@shared/domain'
import {
  classifyStage2dJoint,
  solveStage2dPoseFromSkeleton,
  summarizeStage2dSolve,
  type Stage2dJointRole,
  type Stage2dPose,
  type Stage2dPoseSolveSegment,
  type Stage2dRig
} from '@shared/gameAssets'
import type { YoloImageInput, YoloModelInfo, YoloPoseResult, YoloSkeletonPoint, YoloStatus } from '@shared/yolo'
import { useStudioI18n } from '../composables/useStudioI18n'
import { COCO17_SKELETON_EDGES } from '../features/director/poseFromMedia'
import {
  POSE_KEYPOINT_MIN_CONF,
  bestPoseModel,
  followUpSelectedIndex,
  sortPosePeople
} from '../features/director/poseQuality'
import { getYoloStatus, yoloPose } from '../features/yolo/api'
import { imageToRaw, loadImageElement } from '../features/yolo/cutout'
import { resolveAssetFileUrl, resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

/** 推理输入最长边（与一键抠图一致） */
const MAX_INFER_SIDE = 1600
/** 素材列表单次渲染上限 */
const MAX_VISIBLE_ASSETS = 300
const IMAGE_FILE_RE = /\.(png|jpe?g)$/i

interface ChosenAsset {
  assetId: string
  name: string
  relativePath: string
}

interface DetectSource {
  assetId: string
  name: string
  displayUrl: string
  input: YoloImageInput
}

/** 能被图片姿势驱动的关节角色（其余是末端装饰点） */
const DRIVABLE_ROLES: Stage2dJointRole[] = [
  'chest',
  'shoulder',
  'elbow',
  'wrist',
  'hip',
  'knee',
  'ankle'
]

const props = defineProps<{
  open: boolean
  rig: Stage2dRig
}>()

const emit = defineEmits<{
  close: []
  applied: [payload: { pose: Stage2dPose }]
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const query = ref('')
const thumbUrls = ref<Record<string, string>>({})
const chosen = ref<ChosenAsset | null>(null)
const frameSource = ref<DetectSource | null>(null)
const yoloStatus = ref<YoloStatus | null>(null)
const poseModelId = ref('')
/** 用户手动选过模型后不再自动换档 */
const userPickedModel = ref(false)
const detecting = ref(false)
const applying = ref(false)
const result = ref<YoloPoseResult | null>(null)
const selectedPerson = ref(0)
const flip = ref(false)
const driveTorso = ref(true)
const message = ref('')
const messageKind = ref<'info' | 'warn' | 'ok' | 'error'>('info')
const ownObjectUrls: string[] = []

const drivableRoles = computed(() => {
  const roles = new Set<Stage2dJointRole>()
  for (const joint of props.rig.joints) {
    const cls = classifyStage2dJoint(joint.name || joint.id)
    if (DRIVABLE_ROLES.includes(cls.role)) roles.add(cls.role)
  }
  return roles.size
})

const yoloError = computed(() => {
  const status = yoloStatus.value
  if (!status || !status.ready) return true
  return !poseModels.value.length
})

const poseModels = computed<YoloModelInfo[]>(() => {
  return (yoloStatus.value?.models ?? []).filter((model) => model.kind === 'pose')
})

function setMessage(text: string, kind: 'info' | 'warn' | 'ok' | 'error' = 'info'): void {
  message.value = text
  messageKind.value = kind
}

function clearTransientState(): void {
  chosen.value = null
  frameSource.value = null
  result.value = null
  selectedPerson.value = 0
  flip.value = false
  driveTorso.value = true
  userPickedModel.value = false
  message.value = ''
  for (const url of ownObjectUrls.splice(0)) URL.revokeObjectURL(url)
}

async function refreshYoloStatus(): Promise<void> {
  try {
    yoloStatus.value = await getYoloStatus()
    const models = poseModels.value
    if (!models.length) {
      poseModelId.value = ''
      setMessage(t('stage2d.poseNoPoseModel'), yoloStatus.value?.ready ? 'warn' : 'error')
      return
    }
    if (!models.some((m) => m.id === poseModelId.value)) {
      poseModelId.value = bestPoseModel(models)?.id ?? ''
    } else if (!userPickedModel.value) {
      const bestId = bestPoseModel(models)?.id ?? ''
      if (bestId && bestId !== poseModelId.value) poseModelId.value = bestId
    }
    setMessage('', 'info')
  } catch (err) {
    yoloStatus.value = null
    poseModelId.value = ''
    setMessage(t('stage2d.poseYoloUnavailable'), 'error')
    void err
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      clearTransientState()
      return
    }
    clearTransientState()
    void refreshYoloStatus()
  },
  { immediate: true }
)

const filteredAssets = computed(() => {
  const q = query.value.trim().toLowerCase()
  const out: AssetInfo[] = []
  for (const asset of project.assets) {
    if (!asset.relativePath || asset.type !== 'image') continue
    if (q && !asset.name.toLowerCase().includes(q)) continue
    out.push(asset)
    if (out.length >= MAX_VISIBLE_ASSETS) break
  }
  return out
})

watch(
  () => (props.open ? filteredAssets.value.map((a) => a.relativePath).join('\u0000') : ''),
  (key) => {
    if (!props.open || !key) return
    void loadMissingThumbnails(key.split('\u0000'))
  },
  { immediate: true }
)

async function loadMissingThumbnails(paths: string[]): Promise<void> {
  const missing = paths.filter((p) => !thumbUrls.value[p])
  for (const rel of missing.slice(0, 40)) {
    const url = await resolveAssetPreviewUrl(rel)
    if (url) thumbUrls.value = { ...thumbUrls.value, [rel]: url }
  }
}

async function rawToObjectUrl(raw: { width: number; height: number; rgba: Uint8Array }): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = raw.width
  canvas.height = raw.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Stage2dPose: canvas unavailable')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raw.rgba), raw.width, raw.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Stage2dPose: PNG encode failed'))), 'image/png')
  })
  const url = URL.createObjectURL(blob)
  ownObjectUrls.push(url)
  return url
}

const isCurrent = (): boolean => props.open

async function chooseAsset(asset: AssetInfo): Promise<void> {
  if (asset.type !== 'image') return
  chosen.value = {
    assetId: asset.id,
    name: asset.name,
    relativePath: asset.relativePath
  }
  frameSource.value = null
  result.value = null
  selectedPerson.value = 0
  setMessage('', 'info')
  const fileUrl = await resolveAssetFileUrl(asset.relativePath)
  if (!isCurrent() || !fileUrl) {
    if (fileUrl) return
    setMessage(t('stage2d.poseFileMissing'), 'error')
    chosen.value = null
    return
  }
  if (IMAGE_FILE_RE.test(asset.relativePath)) {
    frameSource.value = {
      assetId: asset.id,
      name: asset.name,
      displayUrl: fileUrl,
      input: { kind: 'file', path: asset.relativePath }
    }
    return
  }
  try {
    const img = await loadImageElement(fileUrl)
    if (!isCurrent()) return
    const raw = imageToRaw(img, MAX_INFER_SIDE)
    const displayUrl = await rawToObjectUrl(raw)
    if (!isCurrent()) return
    frameSource.value = {
      assetId: asset.id,
      name: asset.name,
      displayUrl,
      input: { kind: 'raw', width: raw.width, height: raw.height, rgba: raw.rgba }
    }
  } catch {
    if (!isCurrent()) return
    setMessage(t('stage2d.poseFileMissing'), 'error')
    frameSource.value = null
    chosen.value = null
  }
}

const canDetect = computed(
  () =>
    !!chosen.value &&
    !!frameSource.value &&
    !!poseModelId.value &&
    !yoloError.value &&
    drivableRoles.value > 0
)

async function detectPose(): Promise<void> {
  const src = frameSource.value
  if (!src || !poseModelId.value || !canDetect.value) return
  detecting.value = true
  const previous = result.value
  const previousIndex = selectedPerson.value
  result.value = null
  try {
    const r = await yoloPose({
      image: src.input,
      modelId: poseModelId.value,
      confThreshold: 0.25
    })
    const sorted = sortPosePeople(r.skeletons, r.boxes)
    r.skeletons = sorted.skeletons
    r.boxes = sorted.boxes
    result.value = r
    selectedPerson.value = r.skeletons.length
      ? (followUpSelectedIndex(previous?.skeletons[previousIndex], r.skeletons) ?? 0)
      : 0
    if (!r.skeletons.length) {
      setMessage(t('stage2d.poseNoPerson'), 'warn')
    } else {
      setMessage(t('stage2d.posePeopleFound', { count: r.skeletons.length }), 'ok')
    }
  } catch (err) {
    console.error('[stage2dPose] detect failed:', err)
    setMessage(t('stage2d.poseDetectError'), 'error')
  } finally {
    detecting.value = false
  }
}

watch(frameSource, () => {
  if (isCurrent() && frameSource.value && poseModelId.value && !yoloError.value) void detectPose()
})

watch(poseModelId, () => {
  if (isCurrent() && frameSource.value && poseModelId.value && !yoloError.value) void detectPose()
})

const previewUrl = computed(() => frameSource.value?.displayUrl ?? '')
const overlayW = computed(() => result.value?.width ?? 0)
const overlayH = computed(() => result.value?.height ?? 0)

function personPoints(skel: readonly YoloSkeletonPoint[]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (const point of skel) {
    if (!point) continue
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    if (Number.isFinite(point.confidence) && point.confidence < POSE_KEYPOINT_MIN_CONF) continue
    out.push({ x: point.x, y: point.y })
  }
  return out
}

function personLines(
  skel: readonly YoloSkeletonPoint[]
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (const [a, b] of COCO17_SKELETON_EDGES) {
    const pa = skel[a]
    const pb = skel[b]
    if (!pa || !pb) continue
    if (
      (Number.isFinite(pa.confidence) && pa.confidence < POSE_KEYPOINT_MIN_CONF) ||
      (Number.isFinite(pb.confidence) && pb.confidence < POSE_KEYPOINT_MIN_CONF)
    ) {
      continue
    }
    out.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y })
  }
  return out
}

function onStageClick(event: MouseEvent): void {
  const svg = event.currentTarget as SVGElement | null
  const r = result.value
  if (!r || !svg || !r.skeletons.length) return
  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const sx = ((event.clientX - rect.left) / rect.width) * r.width
  const sy = ((event.clientY - rect.top) / rect.height) * r.height
  let best = -1
  let bestDist = 90 * (r.width / Math.max(1, rect.width))
  for (let i = 0; i < r.skeletons.length; i++) {
    const pts = personPoints(r.skeletons[i])
    if (!pts.length) continue
    let cx = 0
    let cy = 0
    for (const pt of pts) {
      cx += pt.x
      cy += pt.y
    }
    cx /= pts.length
    cy /= pts.length
    const dist = Math.hypot(cx - sx, cy - sy)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  if (best >= 0) selectedPerson.value = best
}

function onPoseModelPicked(): void {
  userPickedModel.value = true
}

const solved = computed(() => {
  const r = result.value
  if (!r) return { pose: {} as Stage2dPose, driven: [] as string[], segments: [] as Stage2dPoseSolveSegment[] }
  const skel = r.skeletons[selectedPerson.value]
  if (!skel) return { pose: {} as Stage2dPose, driven: [] as string[], segments: [] as Stage2dPoseSolveSegment[] }
  return solveStage2dPoseFromSkeleton({
    rig: props.rig,
    skeleton: skel,
    flip: flip.value,
    driveTorso: driveTorso.value,
    minConfidence: POSE_KEYPOINT_MIN_CONF
  })
})

function segReason(seg: Stage2dPoseSolveSegment): string {
  if (seg.status === 'ok') return t('stage2d.segOk')
  if (seg.status === 'no-joint') return t('stage2d.segNoJoint')
  if (seg.status === 'no-tip') return t('stage2d.segNoTip')
  if (seg.status === 'no-keypoints') return t('stage2d.segNoKp')
  return t('stage2d.segDeg')
}

function segLabel(seg: Stage2dPoseSolveSegment): string {
  const side =
    seg.side === 'l'
      ? t('stage2d.sideL')
      : seg.side === 'r'
        ? t('stage2d.sideR')
        : ''
  const names: Record<Stage2dPoseSolveSegment['key'], string> = {
    torso: t('stage2d.segTorso'),
    upperarm: t('stage2d.segUpperarm'),
    forearm: t('stage2d.segForearm'),
    thigh: t('stage2d.segThigh'),
    shin: t('stage2d.segShin')
  }
  return `${side}${names[seg.key]}`
}

const canApply = computed(
  () =>
    !!result.value &&
    result.value.skeletons.length > 0 &&
    selectedPerson.value >= 0 &&
    selectedPerson.value < result.value.skeletons.length &&
    drivableRoles.value > 0 &&
    !applying.value &&
    solved.value.driven.length > 0
)

function applyPose(): void {
  if (!canApply.value) return
  applying.value = true
  const stat = summarizeStage2dSolve(solved.value)
  emit('applied', { pose: solved.value.pose })
  // 让 footer 文案有时间反映到界面再关闭（父级监听 applied 后即关闭本窗）
  window.setTimeout(() => {
    applying.value = false
    setMessage(t('stage2d.poseApplied', { ok: stat.ok, total: stat.total }), 'ok')
  }, 120)
}

function closeDialog(): void {
  if (applying.value) return
  emit('close')
}
</script>

<style scoped>
.sp-root {
  display: flex;
  height: 100%;
  min-height: 0;
}

.sp-library {
  flex: none;
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-panel) 40%, transparent);
  min-height: 0;
}

.sp-search {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
}

.sp-library-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  align-content: start;
}

.sp-asset-card {
  position: relative;
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 8px;
  align-items: center;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  cursor: pointer;
  text-align: left;
}

.sp-asset-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
}

.sp-asset-card img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  display: block;
}

.sp-asset-fallback {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--text-muted);
  background: var(--bg-panel);
  border-radius: 6px;
}

.sp-asset-name {
  font-size: 12px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.sp-library-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 16px 4px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.sp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.sp-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
}

.sp-empty-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
}

.sp-preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.sp-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.sp-overlay .person line {
  stroke: rgba(125, 211, 252, 0.35);
  stroke-width: 2;
  stroke-linecap: round;
}

.sp-overlay .person circle {
  fill: rgba(147, 197, 253, 0.4);
}

.sp-overlay .person.selected line {
  stroke: var(--accent, #38bdf8);
  stroke-width: 3;
}

.sp-overlay .person.selected circle {
  fill: #38bdf8;
  stroke: #fff;
  stroke-width: 1;
}

.sp-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.sp-check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.sp-action {
  padding: 5px 12px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  cursor: pointer;
}

.sp-action:disabled {
  opacity: 0.5;
  cursor: default;
}

.sp-solve {
  min-height: 22px;
}

.sp-seg-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sp-seg {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 20px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--bg-input);
}

.sp-seg.s-ok {
  color: #4ade80;
  border-color: color-mix(in srgb, #4ade80 45%, var(--border));
}

.sp-seg.s-no-joint,
.sp-seg.s-no-tip {
  color: #fbbf24;
  border-color: color-mix(in srgb, #fbbf24 45%, var(--border));
}

.sp-seg.s-no-keypoints,
.sp-seg.s-degenerate {
  color: var(--text-muted);
  opacity: 0.8;
}

.sp-status {
  margin: 2px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.sp-status.warn {
  color: #fbbf24;
}

.sp-status.ok {
  color: #4ade80;
}

.sp-status.error {
  color: #f87171;
}

.sp-footer-hint {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 8px;
}
</style>
