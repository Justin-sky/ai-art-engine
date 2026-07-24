<template>
  <section class="gen-refs">
    <div class="section-head">
      <h3>{{ t('shot.refs.title') }}</h3>
      <span class="section-hint">{{ t('shot.refs.hint') }}</span>
    </div>

    <div v-if="graphBound" class="frame-slots">
      <div class="frame-slot">
        <span class="frame-label">{{ t('shot.refs.firstFrame') }}</span>
        <div class="frame-thumb">
          <img v-if="firstFrameThumb" :src="firstFrameThumb" alt="" />
          <span v-else class="frame-empty">—</span>
        </div>
        <button type="button" class="pick-btn" @click="pickFrame('first')">
          {{ firstFrameAssetId ? t('shot.refs.changeFrame') : t('shot.refs.setFrame') }}
        </button>
        <button
          v-if="firstFrameAssetId"
          type="button"
          class="clear"
          :title="t('shot.refs.clearFrame')"
          @click="clearFrame('first')"
        >
          ×
        </button>
      </div>
      <div class="frame-slot">
        <span class="frame-label">{{ t('shot.refs.lastFrame') }}</span>
        <div class="frame-thumb">
          <img v-if="lastFrameThumb" :src="lastFrameThumb" alt="" />
          <span v-else class="frame-empty">—</span>
        </div>
        <button type="button" class="pick-btn" @click="pickFrame('last')">
          {{ lastFrameAssetId ? t('shot.refs.changeFrame') : t('shot.refs.setFrame') }}
        </button>
        <button
          v-if="lastFrameAssetId"
          type="button"
          class="clear"
          :title="t('shot.refs.clearFrame')"
          @click="clearFrame('last')"
        >
          ×
        </button>
      </div>
      <p class="frame-hint">{{ t('shot.refs.frameHint') }}</p>
    </div>

    <div
      class="drop-zone"
      :class="{ 'drop-over': dropOver }"
      @dragover.prevent="onDragOver($event)"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop($event)"
    >
      <span>{{ t('shot.refs.drop') }}</span>
      <button type="button" class="pick-btn" @click="pickRef">{{ t('shot.refs.add') }}</button>
    </div>

    <div
      v-for="ref in unifiedRefs"
      :key="`${ref.kind}-${ref.assetId}-${ref.refIndex}`"
      class="ref-row"
      :class="{ 'audio-row': ref.kind === 'voice' }"
    >
      <span class="ref-badge">{{ t('shot.refs.badge', { n: ref.refIndex }) }}</span>
      <div class="thumb">
        <img v-if="ref.kind === 'visual' && thumbUrl(ref.assetId)" :src="thumbUrl(ref.assetId)" alt="" />
        <span v-else-if="ref.kind === 'voice'" class="audio-icon">🗣️</span>
        <span v-else class="badge">{{ assetTypeForId(ref.assetId) }}</span>
      </div>
      <div class="ref-fields">
        <span class="type-tag">{{ assetTypeForId(ref.assetId) }}</span>
        <input
          v-if="ref.kind === 'visual'"
          :value="labelFor(ref.assetId)"
          class="ref-label"
          :placeholder="t('shot.refs.notes')"
          @input="onLabelChange(ref.assetId, ($event.target as HTMLInputElement).value)"
        />
        <span class="asset-name">{{ assetName(ref.assetId) }}</span>
      </div>
      <label v-if="ref.kind === 'visual'" class="weight" :title="t('shot.refs.weight')">
        <input
          :value="weightFor(ref.assetId)"
          type="range"
          min="0"
          max="1"
          step="0.05"
          @input="onWeightChange(ref.assetId, Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <button type="button" class="insert-btn" :title="t('shot.refs.insertVisual')" @click="insertMention(ref)">
        @{{ ref.refIndex }}
      </button>
      <button type="button" class="clear" :title="t('shot.refs.remove')" @click="removeRef(ref)">×</button>
    </div>

    <p v-if="!unifiedRefs.length" class="empty-hint">
      {{ t('shot.refs.help') }}
    </p>

    <p v-if="dropError" class="drop-error">{{ dropError }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  assetAcceptsShotRef,
  buildUnifiedShotRefs,
  inferGenRefRole,
  reindexAllShotRefs,
  type AssetInfo,
  type ShotAudioRef,
  type ShotGenRef,
  type UnifiedShotRef
} from '@shared/domain'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  cloneGraphDocument,
  connectShotVideoReference,
  disconnectShotVideoReference,
  findShotWorkflowVideoNode,
  getVideoFrameAssetId,
  listVideoMentionContribution,
  setVideoFrameAsset,
  type GraphDocument
} from '@shared/graph'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import {
  graphEditorHosts,
  useGraphEditorRevision
} from '../features/graph/model/graphEditorHosts'

const props = defineProps<{
  genRefs: ShotGenRef[]
  audioRefs: ShotAudioRef[]
  /** shotWorkflow hostId，有值时以图上 asset.video 为准 */
  hostId?: string | null
}>()

const emit = defineEmits<{
  change: [
    payload: {
      genRefs: ShotGenRef[]
      audioRefs: ShotAudioRef[]
    }
  ]
  'insert-mention': [token: string]
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { t, assetTypeLabel } = useStudioI18n()
const graphRevision = useGraphEditorRevision()

const localGenRefs = ref<ShotGenRef[]>([])
const localAudioRefs = ref<ShotAudioRef[]>([])
const dropOver = ref(false)
const dropError = ref('')
const thumbUrls = ref<Record<string, string>>({})

const liveGraph = computed((): GraphDocument | null => {
  void graphRevision.value
  if (!props.hostId) return null
  return workspace.getActiveGraph()
})

const graphBound = computed(
  () => !!props.hostId && !!liveGraph.value && !!findShotWorkflowVideoNode(liveGraph.value!)
)

const firstFrameAssetId = computed(() =>
  liveGraph.value ? getVideoFrameAssetId(liveGraph.value, VIDEO_FIRST_FRAME_PORT_ID) : null
)
const lastFrameAssetId = computed(() =>
  liveGraph.value ? getVideoFrameAssetId(liveGraph.value, VIDEO_LAST_FRAME_PORT_ID) : null
)
const firstFrameThumb = computed(() =>
  firstFrameAssetId.value ? thumbUrl(firstFrameAssetId.value) : undefined
)
const lastFrameThumb = computed(() =>
  lastFrameAssetId.value ? thumbUrl(lastFrameAssetId.value) : undefined
)

const unifiedRefs = computed(() =>
  buildUnifiedShotRefs(localGenRefs.value, localAudioRefs.value)
)

function syncLocalsFromPropsOrGraph(): void {
  if (graphBound.value && liveGraph.value) {
    const contrib = listVideoMentionContribution(liveGraph.value)
    localGenRefs.value = contrib.genRefs
    localAudioRefs.value = contrib.audioRefs
    return
  }
  const indexed = reindexAllShotRefs(
    props.genRefs.map((r) => ({ ...r, weight: r.weight ?? 0.75 })),
    props.audioRefs.map((r) => ({ ...r }))
  )
  localGenRefs.value = indexed.genRefs
  localAudioRefs.value = indexed.audioRefs
  syncRolesFromAssets()
}

watch(
  () =>
    [
      props.hostId,
      graphRevision.value,
      // 仅追踪引用列表身份，避免 deep 遍历整份 GraphDocument
      props.genRefs,
      props.audioRefs,
      firstFrameAssetId.value,
      lastFrameAssetId.value,
      graphBound.value
    ] as const,
  () => syncLocalsFromPropsOrGraph(),
  { immediate: true }
)

watch(
  () => project.assets.map((a) => a.id).join(','),
  async () => {
    for (const a of project.assets) {
      if (thumbUrls.value[a.id]) continue
      if (a.type !== 'image' || !a.relativePath) continue
      try {
        thumbUrls.value[a.id] = await resolveAssetPreviewUrl(a.relativePath)
      } catch {
        /* ignore */
      }
    }
  },
  { immediate: true }
)

function thumbUrl(assetId: string): string | undefined {
  return thumbUrls.value[assetId]
}

function assetName(assetId: string): string {
  return project.assets.find((a) => a.id === assetId)?.name ?? assetId.slice(0, 8)
}

function assetTypeForId(assetId: string): string {
  const type = project.assets.find((a) => a.id === assetId)?.type
  return type ? assetTypeLabel(type) : '?'
}

function labelFor(assetId: string): string {
  return localGenRefs.value.find((r) => r.assetId === assetId)?.label ?? ''
}

function weightFor(assetId: string): number {
  return localGenRefs.value.find((r) => r.assetId === assetId)?.weight ?? 0.75
}

function applyGraph(next: GraphDocument): void {
  if (!props.hostId) return
  graphEditorHosts.applyExternalGraph(props.hostId, next)
  const contrib = listVideoMentionContribution(next)
  localGenRefs.value = contrib.genRefs
  localAudioRefs.value = contrib.audioRefs
  emit('change', {
    genRefs: contrib.genRefs.map((r) => ({ ...r })),
    audioRefs: contrib.audioRefs.map((r) => ({ ...r }))
  })
}

function emitLocalChange(): void {
  dropError.value = ''
  syncRolesFromAssets()
  const indexed = reindexAllShotRefs(localGenRefs.value, localAudioRefs.value)
  localGenRefs.value = indexed.genRefs
  localAudioRefs.value = indexed.audioRefs
  emit('change', {
    genRefs: localGenRefs.value.map((r) => ({ ...r })),
    audioRefs: localAudioRefs.value.map((r) => ({ ...r }))
  })
}

function onLabelChange(assetId: string, label: string): void {
  const ref = localGenRefs.value.find((r) => r.assetId === assetId)
  if (ref) ref.label = label
  if (graphBound.value && liveGraph.value && props.hostId) {
    const node = liveGraph.value.nodes.find((n) => n.assetId === assetId)
    if (node) {
      graphEditorHosts.updateNode(props.hostId, node.id, { label })
    }
  }
  emitLocalChange()
}

function onWeightChange(assetId: string, weight: number): void {
  const ref = localGenRefs.value.find((r) => r.assetId === assetId)
  if (ref) ref.weight = weight
  if (graphBound.value && liveGraph.value && props.hostId) {
    const node = liveGraph.value.nodes.find((n) => n.assetId === assetId)
    if (node) {
      graphEditorHosts.updateNode(props.hostId, node.id, { weight })
    }
  }
  emitLocalChange()
}

function syncRolesFromAssets(): void {
  for (const item of localGenRefs.value) {
    const asset = project.assets.find((a) => a.id === item.assetId)
    if (asset) item.role = inferGenRefRole(asset.type)
  }
}

function resolveDroppedAsset(e: DragEvent): AssetInfo | null {
  return workspace.resolveDraggedAsset(e)
}

function validateRefAsset(asset: AssetInfo): string | null {
  if (!assetAcceptsShotRef(asset.type)) {
    return t('shot.refs.error.invalidType')
  }
  if (!asset.relativePath) {
    return t('shot.refs.error.noFile')
  }
  return null
}

function onDragOver(e: DragEvent): void {
  const asset = workspace.draggingAsset
  if (!asset && !e.dataTransfer?.types.includes('application/x-studio-asset')) return
  e.dataTransfer!.dropEffect = 'copy'
  dropOver.value = true
}

function onDragLeave(): void {
  dropOver.value = false
}

function addRef(asset: AssetInfo): void {
  if (graphBound.value && liveGraph.value) {
    applyGraph(
      connectShotVideoReference(liveGraph.value, {
        id: asset.id,
        type: asset.type,
        name: asset.name
      })
    )
    return
  }
  if (asset.type === 'voice') {
    if (localAudioRefs.value.some((a) => a.kind === 'voice' && a.assetId === asset.id)) return
    localAudioRefs.value.push({ kind: 'voice', assetId: asset.id })
  } else {
    if (localGenRefs.value.some((r) => r.assetId === asset.id)) return
    const role = inferGenRefRole(asset.type)
    localGenRefs.value.push({
      role,
      assetId: asset.id,
      refIndex: 0,
      label: '',
      weight: role === 'background' ? 0.8 : 0.85
    })
  }
  emitLocalChange()
}

function onDrop(e: DragEvent): void {
  dropOver.value = false
  dropError.value = ''
  const asset = resolveDroppedAsset(e)
  if (!asset) {
    dropError.value = t('shot.refs.error.dropFailed')
    return
  }
  const err = validateRefAsset(asset)
  if (err) {
    dropError.value = err
    return
  }
  addRef(asset)
  workspace.setDraggingAsset(null)
}

async function pickRef(): Promise<void> {
  dropError.value = ''
  const files = await window.studio.selectFiles([
    { name: t('asset.fileFilter.image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    { name: t('asset.fileFilter.audio'), extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
  ])
  if (!files.length) return
  try {
    const result = await window.studio.importAssets({ filePaths: files })
    await project.refreshAssets()
    for (const asset of result.imported) {
      const err = validateRefAsset(asset)
      if (err) {
        dropError.value = err
        continue
      }
      addRef(asset)
    }
  } catch (e) {
    dropError.value = e instanceof Error ? e.message : String(e)
  }
}

function removeRef(item: UnifiedShotRef): void {
  if (graphBound.value && liveGraph.value) {
    applyGraph(disconnectShotVideoReference(liveGraph.value, item.assetId))
    return
  }
  if (item.kind === 'voice') {
    localAudioRefs.value = localAudioRefs.value.filter(
      (a) => !(a.kind === 'voice' && a.assetId === item.assetId)
    )
  } else {
    localGenRefs.value = localGenRefs.value.filter((r) => r.assetId !== item.assetId)
  }
  emitLocalChange()
}

async function pickFrame(slot: 'first' | 'last'): Promise<void> {
  if (!graphBound.value || !liveGraph.value) return
  dropError.value = ''
  const files = await window.studio.selectFiles([
    { name: t('asset.fileFilter.image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
  ])
  if (!files.length) return
  try {
    const result = await window.studio.importAssets({ filePaths: files })
    await project.refreshAssets()
    const asset = result.imported.find((item) => item.type === 'image')
    if (!asset) {
      dropError.value = t('shot.refs.error.invalidType')
      return
    }
    const port = slot === 'first' ? VIDEO_FIRST_FRAME_PORT_ID : VIDEO_LAST_FRAME_PORT_ID
    applyGraph(
      setVideoFrameAsset(cloneGraphDocument(liveGraph.value), port, {
        id: asset.id,
        type: asset.type,
        name: asset.name
      })
    )
  } catch (e) {
    dropError.value = e instanceof Error ? e.message : String(e)
  }
}

function clearFrame(slot: 'first' | 'last'): void {
  if (!graphBound.value || !liveGraph.value) return
  const port = slot === 'first' ? VIDEO_FIRST_FRAME_PORT_ID : VIDEO_LAST_FRAME_PORT_ID
  applyGraph(setVideoFrameAsset(liveGraph.value, port, null))
}

function insertMention(ref: UnifiedShotRef): void {
  emit('insert-mention', `@${ref.refIndex}`)
}
</script>

<style scoped>
.gen-refs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.section-head h3 {
  margin: 0;
  font-size: 12px;
  color: var(--text);
}

.section-hint {
  font-size: 10px;
  color: var(--text-muted);
}

.frame-slots {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}

.frame-slot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.frame-label {
  width: 36px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.frame-thumb {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.frame-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.frame-empty {
  font-size: 12px;
  color: var(--text-muted);
}

.frame-hint {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.35;
}

.drop-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
  transition:
    border-color 0.15s,
    background 0.15s;
}

.drop-zone.drop-over {
  border-color: var(--accent);
  background: rgba(61, 139, 253, 0.08);
}

.ref-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}

.ref-badge {
  font-size: 10px;
  color: var(--accent);
  flex-shrink: 0;
}

.thumb {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.audio-icon {
  font-size: 14px;
}

.badge {
  font-size: 9px;
  color: var(--text-muted);
}

.ref-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.type-tag {
  font-size: 9px;
  color: var(--text-muted);
}

.ref-label {
  width: 100%;
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text);
}

.ref-label:focus {
  border-color: var(--border);
  background: var(--bg-elevated);
  outline: none;
}

.asset-name {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weight {
  display: flex;
  align-items: center;
  margin: 0;
}

.weight input {
  width: 64px;
}

.insert-btn,
.pick-btn,
.clear {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 4px;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
}

.clear {
  color: var(--text-muted);
  padding: 2px 6px;
}

.empty-hint {
  margin: 0;
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
}

.drop-error {
  margin: 0;
  font-size: 10px;
  color: #e85d5d;
}
</style>
