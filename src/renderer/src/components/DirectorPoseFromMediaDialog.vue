<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('director.stage.poseMediaTitle')"
    :subtitle="targetSubtitle"
    :default-width="960"
    :default-height="700"
    :min-width="760"
    :min-height="520"
    body-class="pad-none"
    @close="emit('close')"
  >
    <div class="pm-root">
      <aside class="pm-library">
        <div class="pm-kind-tabs">
          <button
            type="button"
            class="pm-kind-tab"
            :class="{ active: kindFilter === 'image' }"
            @click="kindFilter = 'image'"
          >
            {{ t('director.stage.poseMediaKindImage') }}
          </button>
          <button
            type="button"
            class="pm-kind-tab"
            :class="{ active: kindFilter === 'video' }"
            @click="kindFilter = 'video'"
          >
            {{ t('director.stage.poseMediaKindVideo') }}
          </button>
          <button
            type="button"
            class="pm-kind-tab"
            :class="{ active: kindFilter === 'all' }"
            @click="kindFilter = 'all'"
          >
            {{ t('director.stage.poseMediaKindAll') }}
          </button>
        </div>
        <input
          v-model="query"
          class="pm-search"
          type="search"
          spellcheck="false"
          :placeholder="t('director.stage.poseMediaSearchPlaceholder')"
        >
        <div class="pm-library-list">
          <button
            v-for="asset in filteredAssets"
            :key="asset.id"
            type="button"
            class="pm-asset-card"
            :class="{ active: chosen?.assetId === asset.id }"
            :title="asset.name"
            @click="chooseAsset(asset)"
          >
            <img
              v-if="thumbUrls[asset.relativePath]"
              :src="thumbUrls[asset.relativePath]"
              :alt="asset.name"
            >
            <span
              v-else
              class="pm-asset-fallback"
            >{{ asset.type === 'video' ? t('director.stage.poseMediaKindVideoShort') : t('director.stage.poseMediaKindImageShort') }}</span>
            <span class="pm-asset-kind">{{ asset.type === 'video' ? t('director.stage.poseMediaKindVideoShort') : t('director.stage.poseMediaKindImageShort') }}</span>
          </button>
          <p
            v-if="!filteredAssets.length"
            class="pm-library-empty"
          >
            {{ t('director.stage.poseMediaNoMedia') }}
          </p>
        </div>
      </aside>

      <main class="pm-main">
        <template v-if="!chosen">
          <div class="pm-empty-stage">
            <p class="pm-empty-title">
              {{ t('director.stage.poseMediaPickHint') }}
            </p>
          </div>
        </template>

        <template v-else-if="videoMode && !frameSource">
          <div class="pm-video-stage">
            <video
              ref="videoEl"
              class="pm-video"
              :src="videoUrl"
              controls
              playsinline
              :poster="videoPosterUrl"
            />
            <div class="pm-video-row">
              <button
                type="button"
                class="pm-ghost-btn"
                :disabled="grabbingFrame"
                @click="grabVideoFrame"
              >
                {{ grabbingFrame ? t('director.stage.poseMediaGrabbingFrame') : t('director.stage.poseMediaGrabVideoFrame') }}
              </button>
              <p class="pm-video-hint">
                {{ t('director.stage.poseMediaVideoHint') }}
              </p>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="pm-preview-stage">
            <img
              v-if="previewUrl"
              :src="previewUrl"
              :alt="chosen?.name ?? ''"
              class="pm-preview-img"
            >
            <svg
              v-if="result && overlayW > 0"
              class="pm-overlay"
              :viewBox="`0 0 ${overlayW} ${overlayH}`"
              preserveAspectRatio="none"
              role="img"
              :aria-label="t('director.stage.poseMediaSkeletonAria')"
              @click="onStageClick"
            >
              <g
                v-for="(skel, pIndex) in result.skeletons"
                :key="pIndex"
                :class="['pm-person', { selected: pIndex === selectedPerson }]"
              >
                <line
                  v-for="(edge, eIndex) in personLines(skel)"
                  :key="eIndex"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                />
                <circle
                  v-for="pt in personPoints(skel)"
                  :key="pt.index"
                  :cx="pt.x"
                  :cy="pt.y"
                  :r="pIndex === selectedPerson ? 5 : 3"
                />
              </g>
            </svg>
          </div>

          <div
            v-if="result && !result.skeletons.length"
            class="pm-status-line warn"
          >
            {{ t('director.stage.poseMediaNoPerson') }}
          </div>

          <div
            v-if="result && result.skeletons.length"
            class="pm-person-chips"
          >
            <span class="pm-person-label">{{ t('director.stage.poseMediaPersonLabel') }}</span>
            <button
              v-for="(_person, pIndex) in result.skeletons"
              :key="pIndex"
              type="button"
              class="pm-person-chip"
              :class="{ active: selectedPerson === pIndex }"
              @click="selectedPerson = pIndex"
            >
              {{ t('director.stage.poseMediaPerson', { n: pIndex + 1 }) }}
            </button>
          </div>
        </template>

        <div
          v-if="frameSource && videoMode"
          class="pm-back-video-row"
        >
          <button
            type="button"
            class="pm-ghost-btn"
            @click="backToVideo"
          >
            {{ t('director.stage.poseMediaBackToVideo') }}
          </button>
          <span
            v-if="frameTimeSec !== null"
            class="pm-frame-time"
          >{{ t('director.stage.poseMediaFrameTime', { sec: frameTimeSec.toFixed(2) }) }}</span>
        </div>

        <div
          v-if="chosen"
          class="pm-controls"
        >
          <label class="pm-control-field">
            <span class="pm-control-label">{{ t('director.stage.poseMediaModelLabel') }}</span>
            <select
              v-model="poseModelId"
              class="pm-select"
              :disabled="!poseModels.length || detecting || applying"
              @change="onPoseModelPicked"
            >
              <option
                v-if="!poseModels.length"
                value=""
              >{{ t('director.stage.poseMediaNoPoseModel') }}</option>
              <option
                v-for="model in poseModels"
                :key="model.id"
                :value="model.id"
              >{{ model.id }}</option>
            </select>
          </label>

          <label class="pm-check">
            <input
              v-model="flip"
              type="checkbox"
              :disabled="applying"
            >
            <span>{{ t('director.stage.poseMediaFlip') }}</span>
          </label>
          <label class="pm-check">
            <input
              v-model="driveTorso"
              type="checkbox"
              :disabled="applying"
            >
            <span>{{ t('director.stage.poseMediaDriveTorso') }}</span>
          </label>

          <div class="pm-control-actions">
            <button
              type="button"
              class="pm-detect-btn"
              :disabled="!canDetect || detecting || applying"
              @click="detectPose"
            >
              {{ detecting ? t('director.stage.poseMediaDetecting') : t('director.stage.poseMediaDetect') }}
            </button>
            <button
              v-if="yoloError"
              type="button"
              class="pm-link-btn"
              @click="refreshYoloStatus"
            >
              {{ t('director.stage.poseMediaRefreshYolo') }}
            </button>
          </div>
          <p
            v-if="bindBoneCount === 0"
            class="pm-inline-warn"
          >
            {{ t('director.stage.poseMediaErrorNoBones') }}
          </p>
        </div>
      </main>
    </div>

    <template #footer>
      <div class="pm-footer">
        <span
          v-if="message"
          class="pm-footer-msg"
          :class="messageKind"
          :title="message"
        >{{ message }}</span>
        <div class="pm-footer-actions">
          <button
            type="button"
            class="pm-ghost-btn"
            :disabled="!applied || savingPreset"
            @click="saveAsPreset"
          >
            {{ savingPreset ? t('director.stage.poseMediaSavingPreset') : t('director.stage.poseMediaSavePreset') }}
          </button>
          <button
            type="button"
            class="pm-apply-btn"
            :disabled="!canApply || applying"
            @click="applyPose"
          >
            {{ applying ? t('director.stage.poseMediaApplying') : (applied ? t('director.stage.poseMediaAppliedShort') : t('director.stage.poseMediaApply')) }}
          </button>
        </div>
      </div>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue'
import type { AssetInfo } from '@shared/domain'
import type {
  YoloImageInput,
  YoloModelInfo,
  YoloPoseResult,
  YoloSkeletonPoint,
  YoloStatus
} from '@shared/yolo'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import type { DirectorStageSceneApi } from '../features/director/useDirectorStageScene'
import { getYoloStatus, yoloPose } from '../features/yolo/api'
import { loadImageElement, imageToRaw } from '../features/yolo/cutout'
import { resolveAssetFileUrl, resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import {
  COCO17_SKELETON_EDGES,
  solvePoseFromSkeleton,
  summarizeSolveResult
} from '../features/director/poseFromMedia'
import {
  POSE_KEYPOINT_MIN_CONF,
  bestPoseModel,
  followUpSelectedIndex,
  sortPosePeople
} from '../features/director/poseQuality'
import { useProjectStore } from '../stores/project'

/** 推理输入最长边（与一键抠图一致：模型只吃 640，再大只是浪费 IPC） */
const MAX_INFER_SIDE = 1600
/** 左侧素材列表单次渲染上限（搜索可继续缩小范围） */
const MAX_VISIBLE_ASSETS = 300
const IMAGE_FILE_RE = /\.(png|jpe?g)$/i

interface ChosenAsset {
  assetId: string
  name: string
  relativePath: string
  kind: 'image' | 'video'
}

interface DetectSource {
  assetId: string
  name: string
  /** 展示用 URL（画布坐标与推理结果同空间） */
  displayUrl: string
  input: YoloImageInput
  /** 视频取帧的时间点（秒）；图片素材为 null */
  frameTimeSec: number | null
}

const props = defineProps<{
  open: boolean
  objectId: string
  objectName?: string
  objectLocked?: boolean
  scene: DirectorStageSceneApi
}>()

const emit = defineEmits<{
  close: []
  applied: [payload: { objectId: string; driven: number }]
}>()

const { t } = useStudioI18n()
const project = useProjectStore()

const kindFilter = ref<'all' | 'image' | 'video'>('image')
const query = ref('')
const thumbUrls = ref<Record<string, string>>({})

const chosen = ref<ChosenAsset | null>(null)
const videoUrl = ref('')
const videoPosterUrl = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)
const frameSource = ref<DetectSource | null>(null)
const frameTimeSec = ref<number | null>(null)

const yoloStatus = ref<YoloStatus | null>(null)
const poseModelId = ref('')
/** 用户是否手动选过 pose 模型；false 时每次刷新可自动升级到当前最准的可用模型 */
const userPickedModel = ref(false)
const detecting = ref(false)
const applying = ref(false)
const grabbingFrame = ref(false)
const savingPreset = ref(false)

const result = ref<YoloPoseResult | null>(null)
const selectedPerson = ref(0)
const flip = ref(false)
const driveTorso = ref(true)
const bindBoneCount = ref(0)
const applied = ref(false)

const message = ref('')
const messageKind = ref<'info' | 'warn' | 'ok' | 'error'>('info')
const ownObjectUrls: string[] = []

const targetSubtitle = computed(() => {
  if (!props.objectName) return t('director.stage.poseMediaSubtitle')
  return `${props.objectName} · ${t('director.stage.poseMediaSubtitle')}`
})

function setMessage(text: string, kind: 'info' | 'warn' | 'ok' | 'error' = 'info'): void {
  message.value = text
  messageKind.value = kind
}

/** 把解算结果中幅度最大的几个偏移转成可读角度示例，便于确认写入的实际姿势量级 */
function summarizeDrivenDegrees(
  bonePose: Record<string, { x: number; y: number; z: number }> | undefined
): string {
  if (!bonePose) return ''
  const rows: string[] = []
  for (const [name, rot] of Object.entries(bonePose)) {
    if (!rot) continue
    const parts: string[] = []
    for (const axis of ['x', 'y', 'z'] as const) {
      const deg = (rot[axis] * 180) / Math.PI
      if (Math.abs(deg) < 0.5) continue
      parts.push(`${axis.toUpperCase()}${Math.round(deg)}°`)
    }
    if (!parts.length) continue
    const short = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name
    rows.push(`${short} ${parts.join(' ')}`)
    if (rows.length >= 4) break
  }
  return rows.join('；')
}

/** 将「应用后从网格骨骼回读的已生效偏移」转成可读摘要（≈0 即数据没作用到骨骼） */
function summarizeMeasuredDegrees(
  measured: { name: string; x: number; y: number; z: number }[] | undefined
): string {
  if (!measured?.length) return ''
  const rows: string[] = []
  for (const item of measured) {
    if (rows.length >= 3) break
    const parts: string[] = []
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(item[axis]) < 1) continue
      parts.push(`${axis.toUpperCase()}${Math.round(item[axis])}°`)
    }
    const short = item.name.includes(':')
      ? item.name.slice(item.name.lastIndexOf(':') + 1)
      : item.name
    rows.push(parts.length ? `${short} ${parts.join(' ')}` : `${short} ≈0°`)
  }
  return rows.join('；')
}

function clearTransientState(): void {
  chosen.value = null
  videoUrl.value = ''
  videoPosterUrl.value = ''
  frameSource.value = null
  frameTimeSec.value = null
  videoEl.value = null
  result.value = null
  selectedPerson.value = 0
  flip.value = false
  driveTorso.value = true
  applied.value = false
  savingPreset.value = false
  message.value = ''
  for (const url of ownObjectUrls.splice(0)) URL.revokeObjectURL(url)
}

const filteredAssets = computed(() => {
  const q = query.value.trim().toLowerCase()
  const out: AssetInfo[] = []
  for (const asset of project.assets) {
    if (!asset.relativePath) continue
    if (asset.type !== 'image' && asset.type !== 'video') continue
    if (kindFilter.value !== 'all' && asset.type !== kindFilter.value) continue
    if (q && !asset.name.toLowerCase().includes(q)) continue
    out.push(asset)
    if (out.length >= MAX_VISIBLE_ASSETS) break
  }
  return out
})

watch(
  () => [props.open, props.objectId] as const,
  ([open]) => {
    if (!open) {
      clearTransientState()
      return
    }
    clearTransientState()
    void refreshYoloStatus()
    refreshBoneState()
  },
  { immediate: true }
)

watch(
  () => props.objectLocked,
  (locked) => {
    if (locked) setMessage(t('director.stage.poseMediaObjectLocked'), 'warn')
  }
)

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

function refreshBoneState(): void {
  if (!props.objectId) {
    bindBoneCount.value = 0
    return
  }
  bindBoneCount.value = props.scene.listObjectPoseBindBones(props.objectId).length
}

async function refreshYoloStatus(): Promise<void> {
  try {
    yoloStatus.value = await getYoloStatus()
    const poseModels = poseModelsFor(yoloStatus.value)
    if (!poseModels.length) {
      poseModelId.value = ''
      setMessage(
        t('director.stage.poseMediaErrorNoPoseModel'),
        yoloStatus.value?.ready ? 'warn' : 'error'
      )
      return
    }
    if (!poseModels.some((m) => m.id === poseModelId.value)) {
      poseModelId.value = pickDefaultPoseModel(poseModels)
    } else if (!userPickedModel.value) {
      // 没手动选过则随已装模型自动升级到当前最准档位（如下载了 x-pose 后直接生效）
      const bestId = pickDefaultPoseModel(poseModels)
      if (bestId && bestId !== poseModelId.value) poseModelId.value = bestId
    }
    setMessage('', 'info')
  } catch (err) {
    yoloStatus.value = null
    poseModelId.value = ''
    setMessage(t('director.stage.poseMediaErrorYoloUnavailable'), 'error')
    void err
  }
}

function poseModelsFor(status: YoloStatus | null): YoloModelInfo[] {
  return (status?.models ?? []).filter((m) => m.kind === 'pose')
}

/** 默认/最优 pose 模型：在已装模型里挑档位最高者（n<s<m<l<x），质量优先 */
function pickDefaultPoseModel(models: YoloModelInfo[]): string {
  return bestPoseModel(models)?.id ?? ''
}

const poseModels = computed<YoloModelInfo[]>(() => poseModelsFor(yoloStatus.value))
const yoloError = computed(() => {
  const status = yoloStatus.value
  if (!status) return true
  if (!status.ready) return true
  return !poseModels.value.length
})

function onPoseModelPicked(): void {
  userPickedModel.value = true
}

const videoMode = computed(() => chosen.value?.kind === 'video')
const previewUrl = computed(() => frameSource.value?.displayUrl ?? '')

async function chooseAsset(asset: AssetInfo): Promise<void> {
  if (asset.type !== 'image' && asset.type !== 'video') return
  clearTransientState()
  chosen.value = {
    assetId: asset.id,
    name: asset.name,
    relativePath: asset.relativePath,
    kind: asset.type
  }
  bindBoneCount.value = props.scene.listObjectPoseBindBones(props.objectId).length
  const isCurrent = (): boolean => chosen.value?.assetId === asset.id && props.open

  if (asset.type === 'video') {
    const url = await resolveAssetFileUrl(asset.relativePath)
    if (!isCurrent()) return
    videoUrl.value = url
    videoPosterUrl.value = await resolveAssetPreviewUrl(asset.relativePath)
    return
  }
  const fileUrl = await resolveAssetFileUrl(asset.relativePath)
  if (!isCurrent()) return
  const rel = asset.relativePath
  if (!fileUrl) {
    setMessage(t('director.stage.poseMediaErrorFileMissing'), 'error')
    chosen.value = null
    return
  }
  if (IMAGE_FILE_RE.test(rel)) {
    frameSource.value = {
      assetId: asset.id,
      name: asset.name,
      displayUrl: fileUrl,
      input: { kind: 'file', path: rel },
      frameTimeSec: null
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
      input: { kind: 'raw', width: raw.width, height: raw.height, rgba: raw.rgba },
      frameTimeSec: null
    }
  } catch {
    if (!isCurrent()) return
    setMessage(t('director.stage.poseMediaErrorFileMissing'), 'error')
    frameSource.value = null
    chosen.value = null
  }
}

async function rawToObjectUrl(raw: { width: number; height: number; rgba: Uint8Array }): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = raw.width
  canvas.height = raw.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('PoseFromMedia: canvas 2d context unavailable')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raw.rgba), raw.width, raw.height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PoseFromMedia: PNG encode failed'))), 'image/png')
  })
  const url = URL.createObjectURL(blob)
  ownObjectUrls.push(url)
  return url
}

async function grabVideoFrame(): Promise<void> {
  const el = videoEl.value
  if (!el || !chosen.value) return
  const timeSec = Number.isFinite(el.currentTime) ? el.currentTime : 0
  grabbingFrame.value = true
  try {
    const nat = el.videoWidth || 1280
    const width = Math.max(320, Math.min(1280, nat))
    const frames = await window.studio.grabVideoFramesAtTimestamps(chosen.value.relativePath, [timeSec], { width })
    const frame = frames[0]
    if (!frame) {
      setMessage(t('director.stage.poseMediaErrorFrameEmpty'), 'error')
      return
    }
    frameSource.value = {
      assetId: chosen.value.assetId,
      name: chosen.value.name,
      displayUrl: frame.dataUrl,
      input: { kind: 'dataUrl', dataUrl: frame.dataUrl },
      frameTimeSec: timeSec
    }
    frameTimeSec.value = timeSec
    result.value = null
    setMessage('', 'info')
  } catch (err) {
    setMessage(t('director.stage.poseMediaErrorFrameEmpty'), 'error')
    void err
  } finally {
    grabbingFrame.value = false
  }
}

function backToVideo(): void {
  frameSource.value = null
  frameTimeSec.value = null
  result.value = null
  applied.value = false
  setMessage('', 'info')
}

const canDetect = computed(
  () =>
    !!chosen.value &&
    !!frameSource.value &&
    !!poseModelId.value &&
    !yoloError.value &&
    bindBoneCount.value > 0 &&
    !props.objectLocked
)

async function detectPose(): Promise<void> {
  const src = frameSource.value
  if (!src || !poseModelId.value) return
  detecting.value = true
  // 保留上一轮结果，用于重新检测时跟随用户选中的那个人
  const previous = result.value
  const previousIndex = selectedPerson.value
  result.value = null
  try {
    const rawInput = toRaw(src.input)
    const imageInput: YoloImageInput =
      rawInput.kind === 'file'
        ? { kind: 'file', path: rawInput.path }
        : rawInput.kind === 'dataUrl'
          ? { kind: 'dataUrl', dataUrl: rawInput.dataUrl }
          : { kind: 'raw', width: rawInput.width, height: rawInput.height, rgba: rawInput.rgba }
    const r = await yoloPose({ image: imageInput, modelId: poseModelId.value, confThreshold: 0.25 })
    // 主体排序使默认命中 = 画面最大的人，且每次结果顺序稳定
    const sorted = sortPosePeople(r.skeletons, r.boxes)
    r.skeletons = sorted.skeletons
    r.boxes = sorted.boxes
    result.value = r
    selectedPerson.value = r.skeletons.length
      ? (followUpSelectedIndex(previous?.skeletons[previousIndex], r.skeletons) ?? 0)
      : 0
    applied.value = false
    if (!r.skeletons.length) {
      setMessage(t('director.stage.poseMediaNoPerson'), 'warn')
    } else {
      setMessage(
        t('director.stage.poseMediaDetectedPeople', { count: r.skeletons.length }),
        'ok'
      )
    }
  } catch (err) {
    console.error('[poseFromMedia] pose detect failed:', err)
    setMessage(`${t('director.stage.poseMediaErrorDetect')}（${describeErr(err)}）`, 'error')
  } finally {
    detecting.value = false
  }
}

/** 提取 Electron 包裹后的真实错误文案，供脚注诊断展示 */
function describeErr(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const match = /Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)$/.exec(raw)
  const msg = (match ? match[1] : raw).trim()
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
}

const overlayW = computed(() => result.value?.width ?? 0)
const overlayH = computed(() => result.value?.height ?? 0)

function personPoints(skel: readonly YoloSkeletonPoint[]): Array<{ index: number; x: number; y: number }> {
  const out: Array<{ index: number; x: number; y: number }> = []
  for (let i = 0; i < skel.length; i++) {
    const p = skel[i]
    if (!p) continue
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (Number.isFinite(p.confidence) && p.confidence < POSE_KEYPOINT_MIN_CONF) continue
    out.push({ index: i, x: p.x, y: p.y })
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
  const svg = (event.currentTarget as SVGElement | null)
  const r = result.value
  if (!r || !svg || !r.skeletons.length) return
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
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

const canApply = computed(
  () =>
    !!result.value &&
    result.value.skeletons.length > 0 &&
    selectedPerson.value >= 0 &&
    selectedPerson.value < result.value.skeletons.length &&
    bindBoneCount.value > 0 &&
    !props.objectLocked &&
    !applying.value
)

async function applyPose(): Promise<void> {
  const r = result.value
  if (!r || !canApply.value) return
  const skel = r.skeletons[selectedPerson.value]
  if (!skel || !props.objectId) return
  applying.value = true
  try {
    const bones = props.scene.listObjectPoseBindBones(props.objectId)
    if (!bones.length) {
      setMessage(t('director.stage.poseMediaErrorNoBones'), 'error')
      return
    }
    const solved = solvePoseFromSkeleton({
      bones,
      skeleton: skel,
      flip: flip.value,
      driveTorso: driveTorso.value,
      // 与叠加层同一置信度下限：低于阈值的关键点不画也不驱动（所见即所驱） cjk-ok
      minConfidence: POSE_KEYPOINT_MIN_CONF
    })
    if (!solved.drivenBones.length) {
      const stat = summarizeSolveResult(solved)
      setMessage(t('director.stage.poseMediaSolveEmpty', { ok: stat.ok, total: stat.total }), 'warn')
      return
    }
    const okCount = summarizeSolveResult(solved).ok
    if (window.location.search.includes('debugPoseMedia')) {
      console.log(
        `[poseMedia] driven=${Object.keys(solved.bonePose).length} keys=${JSON.stringify(Object.keys(solved.bonePose))}`
      )
      for (const [name, rot] of Object.entries(solved.bonePose)) {
        if (!rot) continue
        console.log(
          `  ${name}: x=${(rot.x * 180) / Math.PI} y=${(rot.y * 180) / Math.PI} z=${(rot.z * 180) / Math.PI}`
        )
      }
    }
    const ok = props.scene.setObjectBonePoseWithUndo(
      props.objectId,
      solved.bonePose,
      t('director.stage.poseMediaUndoLabel')
    )
    if (!ok) {
      setMessage(t('director.stage.poseMediaObjectLocked'), 'error')
      return
    }
    applied.value = true
    const detail = summarizeDrivenDegrees(solved.bonePose)
    const sampleNames = Object.keys(solved.bonePose).slice(0, 6)
    const readbackList = summarizeMeasuredDegrees(
      props.scene.readAppliedObjectBonePoseDeg(props.objectId, sampleNames)
    )
    setMessage(
      t('director.stage.poseMediaApplied', {
        ok: okCount,
        total: solved.segments.length,
        detail: detail ? `（${detail}）` : '',
        readback: readbackList ? t('director.stage.poseMediaReadback', { list: readbackList }) : ''
      }),
      'ok'
    )
    emit('applied', { objectId: props.objectId, driven: okCount })
  } catch (err) {
    setMessage(t('director.stage.poseMediaErrorApply'), 'error')
    void err
  } finally {
    applying.value = false
  }
}

async function saveAsPreset(): Promise<void> {
  if (!applied.value || !props.objectId) return
  savingPreset.value = true
  try {
    const presetId = props.scene.saveObjectPosePreset(props.objectId)
    if (!presetId) {
      setMessage(t('director.stage.poseMediaErrorPreset'), 'error')
      return
    }
    setMessage(t('director.stage.poseMediaPresetSaved'), 'ok')
  } finally {
    savingPreset.value = false
  }
}
</script>

<style scoped>
.pm-root {
  display: flex;
  height: 100%;
  min-height: 0;
}

.pm-library {
  flex: none;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-panel) 40%, transparent);
  min-height: 0;
}

.pm-kind-tabs {
  display: flex;
  gap: 4px;
}

.pm-kind-tab {
  flex: 1;
  padding: 4px 6px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.pm-kind-tab.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.pm-search {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
}

.pm-library-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  align-content: start;
  align-items: start;
}

.pm-asset-card {
  position: relative;
  display: block;
  width: 100%;
  height: 0;
  padding: 0 0 100% 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-input);
  cursor: pointer;
  box-sizing: border-box;
}

.pm-asset-card img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pm-asset-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
}

.pm-asset-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-muted);
}

.pm-asset-kind {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  font-size: 9px;
  line-height: 14px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg) 78%, #000 22%);
  color: var(--text-muted);
  pointer-events: none;
}

.pm-library-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: 18px 6px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.pm-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.pm-empty-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border);
  border-radius: 10px;
}

.pm-empty-title {
  font-size: 13px;
  color: var(--text-muted);
}

.pm-video-stage,
.pm-preview-stage {
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

.pm-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pm-video-row {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pm-video-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.pm-preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.pm-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.pm-person line {
  stroke: rgba(125, 211, 252, 0.35);
  stroke-width: 2;
  stroke-linecap: round;
}

.pm-person circle {
  fill: rgba(147, 197, 253, 0.4);
}

.pm-person.selected line {
  stroke: var(--accent, #38bdf8);
  stroke-width: 3;
}

.pm-person.selected circle {
  fill: #38bdf8;
  stroke: #fff;
  stroke-width: 1;
}

.pm-status-line {
  margin: 0;
  font-size: 12px;
}

.pm-status-line.warn {
  color: #fbbf24;
}

.pm-person-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.pm-person-label {
  font-size: 11px;
  color: var(--text-muted);
}

.pm-person-chip {
  padding: 3px 10px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 20px;
  cursor: pointer;
}

.pm-person-chip.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.pm-back-video-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pm-frame-time {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.pm-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
}

.pm-control-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pm-control-label {
  font-size: 11px;
  color: var(--text-muted);
}

.pm-select {
  max-width: 220px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
}

.pm-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.pm-control-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.pm-ghost-btn,
.pm-detect-btn,
.pm-apply-btn,
.pm-link-btn {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
}

.pm-ghost-btn {
  color: var(--text);
  background: var(--bg-input);
  border: 1px solid var(--border);
}

.pm-link-btn {
  padding: 3px 6px;
  font-size: 11px;
  color: var(--accent);
  background: transparent;
  border: none;
}

.pm-detect-btn {
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
}

.pm-ghost-btn:disabled,
.pm-detect-btn:disabled,
.pm-apply-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pm-inline-warn {
  flex-basis: 100%;
  margin: 0;
  font-size: 11px;
  color: #fbbf24;
}

.pm-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.pm-footer-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.pm-footer-msg.info {
  color: var(--text-muted);
}

.pm-footer-msg.warn {
  color: #fbbf24;
}

.pm-footer-msg.ok {
  color: #4ade80;
}

.pm-footer-msg.error {
  color: #f87171;
}

.pm-footer-actions {
  display: flex;
  gap: 8px;
  flex: none;
}

.pm-apply-btn {
  color: #fff;
  background: color-mix(in srgb, var(--accent) 80%, #000 10%);
  border: 1px solid color-mix(in srgb, var(--accent) 70%, #fff 10%);
}
</style>
