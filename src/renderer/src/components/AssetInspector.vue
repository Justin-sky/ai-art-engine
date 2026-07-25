<template>
  <div class="inspector" v-if="asset">
    <div class="head">
      <div>
        <div class="type">{{ typeLabel }}</div>
        <h2>{{ t('asset.inspector.title') }}</h2>
      </div>
      <span class="icon" :title="typeLabel">{{ typeIcon }}</span>
    </div>

    <label>
      {{ t('asset.field.name') }}
      <input v-model="local.name" @change="persist" />
    </label>

    <label>
      {{ t('asset.field.type') }}
      <input :value="typeLabel" disabled />
    </label>

    <GraphNodeOutputPreview
      v-if="graphPreviewNode && graphPreviewHostId"
      :node="graphPreviewNode"
      :host-id="graphPreviewHostId"
    />
    <AssetMediaPreview v-else-if="asset" :key="asset.id" :asset="asset" />

    <template v-if="asset && isStoryboardScript(asset.type)">
      <label>
        {{ t('asset.inspector.shotCount') }}
        <input :value="t('asset.inspector.shotCountValue', { n: scriptShotCount })" disabled />
      </label>
    </template>

    <template v-else-if="asset && isDirectorDeck(asset.type)">
      <label>
        {{ t('asset.inspector.linkedPanorama') }}
        <input :value="linkedPanoramaName" disabled />
      </label>
      <label>
        {{ t('asset.inspector.stageObjects') }}
        <input :value="t('asset.inspector.shotCountValue', { n: directorStage.objects.length })" disabled />
      </label>
      <label>
        {{ t('asset.inspector.transformMode') }}
        <input :value="directorModeLabel" disabled />
      </label>
    </template>

    <template v-else-if="asset && isPoseModelAsset(asset)">
      <div class="bone-panel">
        <p class="hint">{{ t('asset.inspector.pose.hint') }}</p>
        <div class="section-label">
          {{ t('asset.inspector.pose.bones', { n: poseAssetBoneNames.length }) }}
        </div>
        <ul v-if="poseAssetBoneNames.length" class="bone-list">
          <li v-for="bone in poseAssetBoneNames" :key="bone">{{ bone }}</li>
        </ul>
        <p v-else class="hint">{{ t('asset.inspector.pose.empty') }}</p>
      </div>
    </template>

    <template v-else-if="asset && asset.type === 'model'">
      <div class="model-layout">
      <div v-if="!isAnimationOnlyModel" class="model-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="model-tab"
          :class="{ active: modelTab === 'preview' }"
          :aria-selected="modelTab === 'preview'"
          @click="modelTab = 'preview'"
        >
          {{ t('asset.inspector.tabs.preview') }}
        </button>
        <button
          type="button"
          role="tab"
          class="model-tab"
          :class="{ active: modelTab === 'animation' }"
          :aria-selected="modelTab === 'animation'"
          @click="modelTab = 'animation'"
        >
          {{ t('asset.inspector.tabs.animation') }}
        </button>
        <button
          type="button"
          role="tab"
          class="model-tab"
          :class="{ active: modelTab === 'skeleton' }"
          :aria-selected="modelTab === 'skeleton'"
          @click="modelTab = 'skeleton'"
        >
          {{ t('asset.inspector.tabs.skeleton') }}
        </button>
      </div>

      <ModelPreview
        :key="`${asset.id}:${asset.relativePath ?? ''}`"
        :relative-path="asset.relativePath"
        :transform="modelTransform"
        :preview-clip="previewClip"
        :preview-playing="previewPlaying && modelTab === 'animation'"
        :preview-speed="previewSpeed"
        :show-skeleton="showSkeletonOverlay"
        :selected-bone="modelTab === 'skeleton' ? selectedBone : null"
        @clips="onModelClips"
        @bones="onModelBones"
        @meta="onModelMeta"
        @select-bone="onSelectBone"
        @scene-defaults="onModelSceneDefaults"
      />

      <div class="model-panel" :class="{ fill: modelTab === 'skeleton' }">
      <template v-if="modelTab === 'preview' && !isAnimationOnlyModel">
        <div class="section-label">{{ t('asset.inspector.transform.position') }}</div>
        <div class="vec-row">
          <label>
            X
            <input type="number" step="0.01" :value="local.position.x" disabled />
          </label>
          <label>
            Y
            <input type="number" step="0.01" :value="local.position.y" disabled />
          </label>
          <label>
            Z
            <input type="number" step="0.01" :value="local.position.z" disabled />
          </label>
        </div>

        <div class="section-label">{{ t('asset.inspector.transform.rotation') }}</div>
        <div class="vec-row">
          <label>
            X
            <input type="number" step="0.1" :value="local.rotationDeg.x" disabled />
          </label>
          <label>
            Y
            <input type="number" step="0.1" :value="local.rotationDeg.y" disabled />
          </label>
          <label>
            Z
            <input type="number" step="0.1" :value="local.rotationDeg.z" disabled />
          </label>
        </div>

        <div class="section-label">{{ t('asset.inspector.transform.scale') }}</div>
        <div class="vec-row">
          <label>
            X
            <input type="number" step="0.01" min="0.001" :value="local.scale.x" disabled />
          </label>
          <label>
            Y
            <input type="number" step="0.01" min="0.001" :value="local.scale.y" disabled />
          </label>
          <label>
            Z
            <input type="number" step="0.01" min="0.001" :value="local.scale.z" disabled />
          </label>
        </div>

        <label class="color-row">
          {{ t('director.stage.color') }}
          <span class="color-control">
            <input :value="local.color" type="color" disabled />
            <input :value="local.color" type="text" disabled />
          </span>
        </label>
      </template>

      <template v-else-if="modelTab === 'animation' || isAnimationOnlyModel">
        <template v-if="modelClips.length">
          <label>
            {{ t('asset.inspector.animation.clip') }}
            <select :value="previewClip ?? ''" @change="onPreviewClipChange">
              <option value="">{{ t('asset.inspector.animation.none') }}</option>
              <option v-for="clip in modelClips" :key="clip" :value="clip">{{ clip }}</option>
            </select>
          </label>
          <div class="anim-controls">
            <button
              type="button"
              class="anim-btn"
              :disabled="!previewClip"
              @click="togglePreviewPlaying"
            >
              {{
                previewPlaying
                  ? t('asset.inspector.animation.pause')
                  : t('asset.inspector.animation.play')
              }}
            </button>
            <label class="speed-inline">
              {{ t('asset.inspector.animation.speed') }}
              <input
                type="number"
                min="0.25"
                max="2"
                step="0.25"
                :value="previewSpeed"
                @change="onPreviewSpeedChange"
              />
            </label>
          </div>
          <div class="section-label">{{ t('asset.inspector.animation.clipList') }}</div>
          <ul class="clip-list">
            <li
              v-for="clip in modelClips"
              :key="clip"
              :class="{ active: clip === previewClip }"
              @click="selectPreviewClip(clip)"
            >
              {{ clip }}
            </li>
          </ul>
        </template>
        <p v-else class="hint">{{ t('asset.inspector.animation.empty') }}</p>
      </template>

      <template v-else-if="modelTab === 'skeleton'">
        <p class="hint">{{ t('asset.inspector.skeleton.hint') }}</p>
        <div class="section-label">
          {{ t('asset.inspector.skeleton.bones', { n: modelBones.length }) }}
        </div>
        <ul v-if="modelBones.length" class="bone-list">
          <li
            v-for="bone in modelBones"
            :key="bone"
            :class="{ active: bone === selectedBone }"
            @click="onBoneListClick(bone)"
          >
            {{ bone }}
          </li>
        </ul>
        <p v-else class="hint">{{ t('asset.inspector.skeleton.empty') }}</p>
      </template>
      </div>
      </div>
    </template>

    <template v-else>
      <label v-if="showContentPrompt">
        {{ promptLabel }}
        <textarea
          v-model="local.prompt"
          rows="5"
          @change="persist"
          :placeholder="promptPlaceholder"
        />
      </label>

      <label v-if="showMediaPath">
        {{ t('asset.field.file') }}
        <input :value="asset.relativePath || t('asset.inspector.unlinked')" disabled />
      </label>
    </template>

    <label v-if="showAssetNotes">
      {{ t('asset.field.notes') }}
      <textarea v-model="local.notes" rows="3" @change="persist" :placeholder="t('asset.field.notesPlaceholder')" />
    </label>

    <p v-if="error" class="err">{{ error }}</p>
    <p class="meta">ID {{ asset.id.slice(0, 8) }} · v{{ asset.version }}</p>
  </div>
  <div v-else class="inspector empty">{{ t('asset.inspector.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  assetDisplayIcon,
  isAnimationModelAsset,
  isDirectorDeck,
  isImportedMediaRefAsset,
  isMediaFileAsset,
  isPoseModelAsset,
  isStoryboardScript,
  readDirectorStage,
  readModelAssetTransform,
  readModelAssetColor,
  readPoseAssetData,
  shotScriptAssetId,
  type AssetInfo,
  type ModelPreviewMeta,
  type StageVec3
} from '@shared/domain'
import type { GraphNode, GraphValue } from '@shared/graph'
import { resolveAssetPreviewMediaPath } from '@shared/graph'
import { isAudioFilePath, isVideoFilePath } from '@shared/import'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import ModelPreview from './ModelPreview.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import AssetMediaPreview from './AssetMediaPreview.vue'
import type { ModelSceneDefaults } from '../features/director/modelSceneDefaults'

const project = useProjectStore()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()
const { t, assetTypeLabel } = useStudioI18n()
const error = ref('')
const modelTab = ref<'preview' | 'animation' | 'skeleton'>('preview')
const modelClips = ref<string[]>([])
const modelBones = ref<string[]>([])
const modelMeta = ref<ModelPreviewMeta | null>(null)
const previewClip = ref<string | null>(null)
const previewPlaying = ref(false)
const previewSpeed = ref(1)
const selectedBone = ref<string | null>(null)
let persistingModelKind = false

const local = reactive({
  name: '',
  prompt: '',
  notes: '',
  position: { x: 0, y: 0, z: 0 } as StageVec3,
  rotationDeg: { x: 0, y: 0, z: 0 } as StageVec3,
  scale: { x: 1, y: 1, z: 1 } as StageVec3,
  color: '#ffffff'
})

function radToDeg(v: StageVec3): StageVec3 {
  return {
    x: Number(((v.x * 180) / Math.PI).toFixed(2)),
    y: Number(((v.y * 180) / Math.PI).toFixed(2)),
    z: Number(((v.z * 180) / Math.PI).toFixed(2))
  }
}

function degToRad(v: StageVec3): StageVec3 {
  return {
    x: (finiteNumber(v.x) * Math.PI) / 180,
    y: (finiteNumber(v.y) * Math.PI) / 180,
    z: (finiteNumber(v.z) * Math.PI) / 180
  }
}

function finiteNumber(n: number, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

function normalizeScale(v: StageVec3): StageVec3 {
  return {
    x: Math.max(0.001, finiteNumber(v.x, 1)),
    y: Math.max(0.001, finiteNumber(v.y, 1)),
    z: Math.max(0.001, finiteNumber(v.z, 1))
  }
}

/** 资产库选中，或节点图引用节点选中时解析到同一份资产。 */
const asset = computed((): AssetInfo | null => {
  const selection = editor.selection.current.value
  // 图上的资产引用：优先按节点绑定的资产解析（含草稿）
  if (selection.kind === 'graph.node' && selection.id && selection.hostId) {
    const node = graphEditorHosts.getNode(selection.hostId, selection.id)
    if (node?.assetId) return workspace.resolveAssetById(node.assetId)
  }
  return workspace.selectedAsset
})

/** 资产自身或图执行输出是否已有可预览媒体（优先走统一的 AssetMediaPreview） */
function hasAssetFilePreview(a: AssetInfo | null | undefined): boolean {
  if (!a) return false
  if (a.type === 'video' || a.type === 'voice') {
    const own = a.relativePath?.trim() || ''
    if (own) {
      if (a.type === 'video') return isVideoFilePath(own)
      return isAudioFilePath(own)
    }
    const resolved = resolveAssetPreviewMediaPath(a, project.assets)?.trim() || ''
    if (!resolved) return false
    if (a.type === 'video') return isVideoFilePath(resolved)
    return isAudioFilePath(resolved)
  }
  return !!(
    a.thumbnailPath?.trim() ||
    a.relativePath?.trim() ||
    (isMediaFileAsset(a.type) && resolveAssetPreviewMediaPath(a, project.assets))
  )
}

function assetById(id: string | undefined): AssetInfo | undefined {
  if (!id) return undefined
  return project.assets.find((item) => item.id === id)
}

function graphValueHasPreview(value: GraphValue | undefined): boolean {
  if (!value) return false
  if (value.kind === 'image') {
    return !!value.dataUrl?.trim() || !!value.relativePath?.trim()
  }
  if (value.kind === 'images') {
    return value.items.some(
      (item) => !!item.dataUrl?.trim() || !!item.relativePath?.trim()
    )
  }
  if (value.kind === 'text') return !!value.text.trim()
  if (value.kind === 'asset') {
    const type = value.assetType
    if (
      type === 'screenplay' ||
      type === 'script'
    ) {
      return true
    }
    if (
      type === 'image' ||
      type === 'video' ||
      type === 'voice' ||
      type === 'canvas'
    ) {
      return hasAssetFilePreview(assetById(value.assetId))
    }
    return false
  }
  if (value.kind === 'output') {
    if (value.items.some((item) => graphValueHasPreview(item))) return true
    if (
      value.images?.some(
        (item) => !!item.dataUrl?.trim() || !!item.relativePath?.trim()
      )
    ) {
      return true
    }
    if (value.notes.some((note) => !!note.text.trim())) return true
  }
  return false
}

function nodeHasGraphPreview(hostId: string, node: GraphNode): boolean {
  const runOut = graphRunHosts.get(hostId)?.runStates?.[node.id]?.outputs?.out
  if (graphValueHasPreview(runOut)) return true
  if (typeof node.params.previewDataUrl === 'string' && node.params.previewDataUrl.trim()) {
    return true
  }
  if (typeof node.params.previewRelativePath === 'string' && node.params.previewRelativePath.trim()) {
    return true
  }
  if (
    node.params.cameraShots?.some(
      (shot) => !!shot.dataUrl?.trim() || !!shot.relativePath?.trim()
    )
  ) {
    return true
  }
  if (node.assetId && node.assetType && hasAssetFilePreview(assetById(node.assetId))) {
    return true
  }
  // 输出节点：落盘后无 outputs，沿上游看是否仍有可预览源
  if (node.category === 'output') {
    void graphEditorHosts.revision.value
    return upstreamHasPreview(hostId, node.id, new Set([node.id]))
  }
  return false
}

function upstreamHasPreview(hostId: string, nodeId: string, visited: Set<string>): boolean {
  for (const edge of graphEditorHosts.listIncomingEdges(hostId, nodeId)) {
    if (visited.has(edge.sourceNodeId)) continue
    visited.add(edge.sourceNodeId)
    const source = graphEditorHosts.getNode(hostId, edge.sourceNodeId)
    if (!source) continue
    if (source.params.previewDataUrl?.trim()) return true
    if (source.params.previewRelativePath?.trim()) return true
    if (
      source.params.cameraShots?.some(
        (shot) => !!shot.dataUrl?.trim() || !!shot.relativePath?.trim()
      )
    ) {
      return true
    }
    if (source.assetId && source.assetType) {
      if (source.assetType === 'screenplay' || source.assetType === 'script') return true
      if (hasAssetFilePreview(assetById(source.assetId))) return true
    }
    if (upstreamHasPreview(hostId, source.id, visited)) return true
  }
  return false
}

/**
 * 库选中且尚无媒体文件时：复用打开的资产图输出节点预览
 *（执行结果只活在 runStates 里，不会写入 relativePath）。
 */
function resolveLibraryGraphPreview(
  a: AssetInfo
): { hostId: string; node: GraphNode } | null {
  const hostId = `asset:${a.id}`
  void graphEditorHosts.revision.value
  // 订阅 runStates，执行写回后触发预览切换
  void graphRunHosts.get(hostId)?.runStates
  const output =
    graphEditorHosts.findNode(hostId, (n) => n.category === 'output') ?? null
  if (output && nodeHasGraphPreview(hostId, output)) {
    return { hostId, node: output }
  }
  const bound =
    graphEditorHosts.findNode(hostId, (n) => n.assetId === a.id) ?? null
  if (bound && nodeHasGraphPreview(hostId, bound)) {
    return { hostId, node: bound }
  }
  return null
}

const graphPreviewNode = computed((): GraphNode | null => {
  const selection = editor.selection.current.value
  if (selection.kind === 'graph.node' && selection.id && selection.hostId) {
    const node = graphEditorHosts.getNode(selection.hostId, selection.id)
    if (!node?.assetId) return null
    // 剧本 / 分镜引用：走 AssetMediaPreview 读正文，不用图节点输出预览
    if (node.assetType === 'screenplay' || node.assetType === 'script') return null
    return node
  }
  if (selection.kind !== 'asset') return null
  const a = asset.value
  if (!a) return null
  // 自身已有媒体文件时走 AssetMediaPreview，避免空图预览挡住文件预览
  if (hasAssetFilePreview(a)) return null
  if (!isMediaFileAsset(a.type) && a.type !== 'screenplay') {
    return null
  }
  return resolveLibraryGraphPreview(a)?.node ?? null
})

const graphPreviewHostId = computed(() => {
  const selection = editor.selection.current.value
  if (selection.kind === 'graph.node') {
    const node =
      selection.id && selection.hostId
        ? graphEditorHosts.getNode(selection.hostId, selection.id)
        : null
    if (node?.assetType === 'screenplay' || node?.assetType === 'script') return ''
    return selection.hostId ?? ''
  }
  if (selection.kind !== 'asset') return ''
  const a = asset.value
  if (!a || hasAssetFilePreview(a)) return ''
  if (!isMediaFileAsset(a.type) && a.type !== 'screenplay') {
    return ''
  }
  return resolveLibraryGraphPreview(a)?.hostId ?? ''
})
const typeLabel = computed(() => {
  if (!asset.value) return ''
  if (isPoseModelAsset(asset.value)) return t('asset.type.modelPose')
  if (isAnimationModelAsset(asset.value) || modelMeta.value?.animationOnly) {
    return t('asset.type.modelAnimation')
  }
  if (isImportedMediaRefAsset(asset.value)) {
    if (asset.value.type === 'image') return t('asset.type.imageRef')
    if (asset.value.type === 'video') return t('asset.type.videoRef')
    if (asset.value.type === 'voice') return t('asset.type.voiceRef')
    if (asset.value.type === 'screenplay') return t('asset.type.screenplayRef')
  }
  return assetTypeLabel(asset.value.type)
})
const poseAssetBoneNames = computed(() => {
  const data = readPoseAssetData(asset.value?.genParams)
  return data ? Object.keys(data.bones).sort((a, b) => a.localeCompare(b)) : []
})
const typeIcon = computed(() => {
  if (!asset.value) return ''
  if (modelMeta.value?.animationOnly) return assetDisplayIcon({ type: 'model', genParams: { modelKind: 'animation' } })
  return assetDisplayIcon(asset.value)
})
const isAnimationOnlyModel = computed(
  () => isAnimationModelAsset(asset.value) || modelMeta.value?.animationOnly === true
)
const showSkeletonOverlay = computed(
  () =>
    modelTab.value === 'skeleton' ||
    (isAnimationOnlyModel.value && modelTab.value === 'animation')
)
const showMediaPath = computed(
  () =>
    !(asset.value && isStoryboardScript(asset.value.type)) &&
    !(asset.value && isDirectorDeck(asset.value.type)) &&
    asset.value?.type !== 'model'
)
/** 图/视频/声音/引用剧本：库 Inspector 只保留名称 / 预览 / 路径 */
const showContentPrompt = computed(
  () =>
    !!asset.value &&
    !isMediaFileAsset(asset.value.type) &&
    !isImportedMediaRefAsset(asset.value)
)
const showAssetNotes = computed(
  () =>
    !!asset.value &&
    asset.value.type !== 'model' &&
    !isMediaFileAsset(asset.value.type) &&
    !isImportedMediaRefAsset(asset.value)
)
const modelTransform = computed(() => ({
  position: {
    x: finiteNumber(local.position.x),
    y: finiteNumber(local.position.y),
    z: finiteNumber(local.position.z)
  },
  rotation: degToRad(local.rotationDeg),
  scale: normalizeScale(local.scale)
}))
const scriptShotCount = computed(() => {
  if (!asset.value || !isStoryboardScript(asset.value.type)) return 0
  return project.shots.filter((s) => shotScriptAssetId(s) === asset.value!.id).length
})
const directorStage = computed(() => readDirectorStage(asset.value?.genParams))
const linkedPanoramaName = computed(() => {
  const id = directorStage.value.linkedPanoramaAssetId
  if (!id) return t('common.none')
  return project.assets.find((a) => a.id === id)?.name ?? t('asset.deleted')
})
const directorModeLabel = computed(() => {
  const m = directorStage.value.transformMode
  if (m === 'rotate') return t('director.transform.rotate')
  if (m === 'scale') return t('director.transform.scale')
  return t('director.transform.translate')
})

const promptLabel = computed(() => {
  switch (asset.value?.type) {
    case 'image':
      return t('asset.contentLabel.image')
    case 'video':
      return t('asset.contentLabel.video')
    case 'motion':
      return t('asset.contentLabel.motion')
    case 'voice':
      return t('asset.contentLabel.audio')
    case 'model':
      return t('asset.contentLabel.model')
    default:
      return t('asset.contentLabel.default')
  }
})

const promptPlaceholder = computed(() => {
  switch (asset.value?.type) {
    case 'image':
      return t('asset.inspector.promptPlaceholder.image')
    case 'video':
      return t('asset.inspector.promptPlaceholder.video')
    case 'motion':
      return t('asset.inspector.promptPlaceholder.motion')
    case 'voice':
      return t('asset.inspector.promptPlaceholder.audio')
    case 'model':
      return t('asset.inspector.promptPlaceholder.model')
    default:
      return t('asset.contentPlaceholder.default')
  }
})

function readGenString(gen: Record<string, unknown> | undefined, key: string): string {
  const v = gen?.[key]
  return typeof v === 'string' ? v : ''
}

function readGenNumber(gen: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = gen?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

watch(
  asset,
  (a, prev) => {
    if (!a) return
    const switchedAsset = !prev || prev.id !== a.id
    local.name = a.name
    local.prompt = a.prompt ?? ''
    local.notes = a.notes ?? ''
    const transform = readModelAssetTransform(a.genParams)
    local.position = { ...transform.position }
    local.rotationDeg = radToDeg(transform.rotation)
    local.scale = { ...transform.scale }
    local.color = readModelAssetColor(a.genParams) ?? '#ffffff'
    if (a.type === 'model') {
      const savedClip = readGenString(a.genParams, 'previewClip')
      previewClip.value = savedClip || null
      previewSpeed.value = readGenNumber(a.genParams, 'previewClipSpeed', 1)
      // Persist preview/clip updates the same asset; keep tab & playback state.
      if (switchedAsset) {
        previewPlaying.value = false
        selectedBone.value = null
        modelMeta.value = null
        modelClips.value = []
        modelBones.value = []
        modelTab.value = isAnimationModelAsset(a) ? 'animation' : 'preview'
      }
    }
    error.value = ''
  },
  { immediate: true }
)

function onModelClips(names: string[]): void {
  modelClips.value = names
  if (previewClip.value && !names.includes(previewClip.value)) {
    previewClip.value = names[0] ?? null
    previewPlaying.value = false
  } else if (!previewClip.value && names.length) {
    previewClip.value = names[0] ?? null
  }
}

function onModelBones(names: string[]): void {
  modelBones.value = names
  if (selectedBone.value && !names.includes(selectedBone.value)) {
    selectedBone.value = null
  }
}

function onModelMeta(meta: ModelPreviewMeta): void {
  modelMeta.value = meta
  if (meta.animationOnly) {
    modelTab.value = 'animation'
    void persistAnimationModelKind()
  }
}

async function onModelSceneDefaults(defaults: ModelSceneDefaults): Promise<void> {
  if (!asset.value || asset.value.type !== 'model') return
  local.position = { ...defaults.transform.position }
  local.rotationDeg = radToDeg(defaults.transform.rotation)
  local.scale = { ...defaults.transform.scale }
  local.color = defaults.color

  const prev = asset.value.genParams ?? {}
  const prevColor = readModelAssetColor(prev)
  const prevTransform = readModelAssetTransform(prev)
  const sameTransform =
    prevTransform.position.x === defaults.transform.position.x &&
    prevTransform.position.y === defaults.transform.position.y &&
    prevTransform.position.z === defaults.transform.position.z &&
    prevTransform.rotation.x === defaults.transform.rotation.x &&
    prevTransform.rotation.y === defaults.transform.rotation.y &&
    prevTransform.rotation.z === defaults.transform.rotation.z &&
    prevTransform.scale.x === defaults.transform.scale.x &&
    prevTransform.scale.y === defaults.transform.scale.y &&
    prevTransform.scale.z === defaults.transform.scale.z
  if (sameTransform && prevColor === defaults.color && prev.transform != null && prevColor != null) {
    return
  }

  const genParams: Record<string, unknown> = {
    ...prev,
    transform: { ...defaults.transform },
    color: defaults.color
  }
  try {
    await project.persistAssetCommand(
      {
        ...asset.value,
        genParams
      },
      'Sync model defaults from file'
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function persistAnimationModelKind(): Promise<void> {
  if (!asset.value || asset.value.type !== 'model') return
  if (isAnimationModelAsset(asset.value) || persistingModelKind) return
  persistingModelKind = true
  try {
    const genParams: Record<string, unknown> = {
      ...(asset.value.genParams ?? {}),
      modelKind: 'animation'
    }
    await project.persistAssetCommand(
      {
        ...asset.value,
        genParams
      },
      'Mark animation clip asset'
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    persistingModelKind = false
  }
}

function onSelectBone(name: string | null): void {
  selectedBone.value = name
}

function onBoneListClick(bone: string): void {
  selectedBone.value = selectedBone.value === bone ? null : bone
}

function selectPreviewClip(clip: string): void {
  previewClip.value = clip
  previewPlaying.value = true
  void persistModelPreview()
}

function onPreviewClipChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  previewClip.value = value || null
  if (!previewClip.value) previewPlaying.value = false
  void persistModelPreview()
}

function onPreviewSpeedChange(event: Event): void {
  const speed = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(speed)) return
  previewSpeed.value = Math.min(2, Math.max(0.25, speed))
  void persistModelPreview()
}

function togglePreviewPlaying(): void {
  if (!previewClip.value) return
  previewPlaying.value = !previewPlaying.value
}

async function persistModelPreview(): Promise<void> {
  if (!asset.value || asset.value.type !== 'model') return
  error.value = ''
  const genParams: Record<string, unknown> = {
    ...(asset.value.genParams ?? {}),
    previewClip: previewClip.value ?? '',
    previewClipSpeed: previewSpeed.value
  }
  genParams.transform = {
    position: {
      x: finiteNumber(local.position.x),
      y: finiteNumber(local.position.y),
      z: finiteNumber(local.position.z)
    },
    rotation: degToRad(local.rotationDeg),
    scale: normalizeScale(local.scale)
  }
  genParams.color = local.color
  try {
    await project.persistAssetCommand(
      {
        ...asset.value,
        name: local.name.trim() || asset.value.name,
        prompt: local.prompt,
        notes: local.notes,
        genParams
      },
      'Update model preview clip'
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function persist(): Promise<void> {
  if (!asset.value) return
  error.value = ''
  const genParams: Record<string, unknown> = { ...(asset.value.genParams ?? {}) }

  if (asset.value.type === 'model') {
    genParams.transform = {
      position: {
        x: finiteNumber(local.position.x),
        y: finiteNumber(local.position.y),
        z: finiteNumber(local.position.z)
      },
      rotation: degToRad(local.rotationDeg),
      scale: normalizeScale(local.scale)
    }
    genParams.color = local.color
    genParams.previewClip = previewClip.value ?? ''
    genParams.previewClipSpeed = previewSpeed.value
  }

  const next: AssetInfo = {
    ...asset.value,
    name: local.name.trim() || asset.value.name,
    prompt: local.prompt,
    notes: local.notes,
    genParams
  }

  try {
    await project.persistAssetCommand(next, 'Update asset inspector')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.inspector:not(:has(.model-layout)):not(:has(.bone-panel)) {
  overflow: auto;
}

.inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.model-layout,
.bone-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.model-layout :deep(.model-preview) {
  flex-shrink: 0;
}

.model-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: auto;
}

.model-panel.fill {
  flex: 1;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.head h2 {
  margin: 2px 0 0;
  font-size: 14px;
}

.type {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.icon {
  font-size: 20px;
  line-height: 1;
}

.section-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.model-tabs {
  display: flex;
  gap: 4px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--border) 35%, transparent);
}

.model-tab {
  flex: 1;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.model-tab.active {
  background: color-mix(in srgb, var(--bg-elevated) 92%, white 8%);
  color: var(--text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
}

.anim-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.anim-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}

.anim-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.speed-inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.speed-inline input {
  width: 64px;
}

.clip-list,
.bone-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 180px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
}

.model-panel.fill .bone-list,
.bone-panel .bone-list {
  flex: 1;
  min-height: 120px;
  max-height: none;
  overflow: auto;
}

.model-tabs,
.meta,
.err,
.hint,
.section-label {
  flex-shrink: 0;
}

.clip-list li,
.bone-list li {
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
  color: var(--text);
}

.clip-list li:last-child,
.bone-list li:last-child {
  border-bottom: none;
}

.clip-list li {
  cursor: pointer;
}

.clip-list li:hover,
.clip-list li.active,
.bone-list li:hover,
.bone-list li.active {
  background: color-mix(in srgb, #5b9cf5 16%, transparent);
}

.bone-list li {
  cursor: pointer;
}

.bone-list li.active {
  background: color-mix(in srgb, #2ee6ff 22%, transparent);
  color: #b8f7ff;
}

.check-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.vec-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.vec-row label {
  min-width: 0;
}

.vec-row input {
  width: 100%;
}

.color-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.color-control {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.color-control input[type='color'] {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  background: transparent;
}

.color-control input[type='text'] {
  width: 88px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

input:disabled {
  opacity: 0.75;
  cursor: default;
}

.content {
  min-height: 180px;
  font-family: var(--mono);
  line-height: 1.5;
}

.err {
  color: #e57373;
  font-size: 12px;
}

.meta {
  margin-top: auto;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
