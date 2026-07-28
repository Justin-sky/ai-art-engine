<template>
  <div class="asset-editor" :class="{ graph: supportsGraph }" v-if="asset">
    <template v-if="supportsGraph">
    <div v-if="!embedded && !diving" class="toolbar">
      <span>{{ typeLabel }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('asset.editor.graphHint') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>
    <NodeGraphEditor
      v-show="!diving"
      class="asset-graph"
      :asset-id="assetId"
      :hide-toolbar="!embedded && toolbarCollapsed"
    />
    <EditorDiveChildHost :frame="diving ? diveTop : null" />
    </template>

    <template v-else>
    <header class="head">
      <div>
        <div class="type">
          <span>{{ typeLabel }}</span>
          <span v-if="isDraft" class="draft-mark">*</span>
        </div>
        <h2 class="title-row">
          <span>{{ isDraft ? (local.name || t('common.unnamed')) : asset.name }}</span>
          <span v-if="isDraft" class="draft-mark">*</span>
        </h2>
      </div>
      <button @click="onAttach">{{ attachLabel }}</button>
    </header>

    <div class="preview">
      <img
        v-if="previewUrl && isImageLike"
        :src="previewUrl"
        alt=""
        loading="lazy"
        decoding="async"
        class="preview-image"
        :title="t('graph.selectImage.previewHint')"
        @dblclick="openFullPreview"
      />
      <video v-else-if="previewUrl && isVideoLike" :src="previewUrl" controls />
      <audio v-else-if="previewUrl && isAudioLike" :src="previewUrl" controls />
      <div v-else-if="previewLoading" class="placeholder">
        <span>{{ typeLabel }}</span>
        <p>{{ t('asset.editor.loadingPreview') }}</p>
      </div>
      <div v-else class="placeholder">
        <span>{{ typeLabel }}</span>
        <p>{{ asset.relativePath ? t('asset.editor.noPreview') : t('asset.editor.noMedia') }}</p>
      </div>
    </div>

    <label>
      {{ t('asset.field.name') }}
      <input v-model="local.name" @change="persist" />
    </label>

    <label>
      {{ t('asset.field.description') }}
      <textarea
        v-model="local.prompt"
        rows="5"
        @change="persist"
        :placeholder="t('asset.editor.descPlaceholder')"
      />
    </label>

    <label>
      {{ t('asset.field.notes') }}
      <textarea v-model="local.notes" rows="3" @change="persist" :placeholder="t('asset.field.notesPlaceholder')" />
    </label>

    <p v-if="error" class="err">{{ error }}</p>
    <p class="meta" v-if="!isDraft">ID {{ asset.id.slice(0, 8) }} · v{{ asset.version }}</p>
    <p v-else-if="isDraft" class="meta draft-hint">{{ t('asset.editor.draftHint') }}</p>
    </template>
  </div>
  <div v-else class="asset-editor empty">{{ t('asset.editor.notFound') }}</div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { isDraftAssetId, isMediaFileAsset, isImportedMediaRefAsset, isSoundAsset, isScreenplayAsset, isSubgraphAsset, type AssetType } from '@shared/domain'
import { persistAssetRecord, useAssetRecord } from '../composables/useAssetRecord'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'

const props = defineProps<{
  assetId: string
  /** 嵌在外层 dive 内 */
  embedded?: boolean
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { t, assetTypeLabel } = useStudioI18n()
const error = ref('')
const previewUrl = ref('')
const previewLoading = ref(false)
const toolbarCollapsed = ref(false)
let previewLoadToken = 0
const { asset, isDraft } = useAssetRecord(props.assetId)
const typeLabel = computed(() => (asset.value ? assetTypeLabel(asset.value.type) : ''))

const local = reactive({
  name: '',
  prompt: '',
  notes: ''
})

const isImageLike = computed(() => asset.value?.type === 'image')
const isVideoLike = computed(() => asset.value?.type === 'video' || asset.value?.type === 'motion')
const isAudioLike = computed(() => !!asset.value && isSoundAsset(asset.value.type))
const supportsGraph = computed(
  () =>
    !!asset.value &&
    !isImportedMediaRefAsset(asset.value) &&
    (isMediaFileAsset(asset.value.type) ||
      isScreenplayAsset(asset.value.type) ||
      isSubgraphAsset(asset.value.type))
)

const diveKind = computed(() =>
  asset.value && isScreenplayAsset(asset.value.type) ? ('screenplay' as const) : ('asset' as const)
)
const rootTitle = computed(
  () => asset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop } = useEditorDiveHost({
  kind: diveKind,
  assetId: () => props.assetId,
  rootTitle,
  enabled: () => !props.embedded
})

onMounted(() => {
  if (supportsGraph.value) workspace.focusProjectGlobals()
})

const attachLabel = computed(() =>
  asset.value?.relativePath
    ? t('asset.editor.import.replaceFile')
    : t('asset.editor.import.importFile')
)

watch(
  asset,
  async (a) => {
    if (!a) return
    local.name = a.name
    local.prompt = a.prompt ?? ''
    local.notes = a.notes ?? ''
    previewUrl.value = ''
    if (!a.relativePath) {
      previewLoading.value = false
      return
    }
    const token = ++previewLoadToken
    previewLoading.value = true
    try {
      const url =
        a.type === 'image'
          ? await resolveAssetPreviewUrl(a.relativePath)
          : await window.studio.getAssetFileUrl(a.relativePath)
      if (token !== previewLoadToken) return
      previewUrl.value = url
    } catch {
      if (token !== previewLoadToken) return
      previewUrl.value = ''
    } finally {
      if (token === previewLoadToken) previewLoading.value = false
    }
  },
  { immediate: true }
)

async function openFullPreview(): Promise<void> {
  if (!asset.value?.relativePath || !isImageLike.value) return
  await openFullImagePreview({ relativePath: asset.value.relativePath })
}

async function persistNow(): Promise<void> {
  if (!asset.value) return
  error.value = ''
  await persistAssetRecord(props.assetId, {
    name: local.name.trim() || asset.value.name,
    prompt: local.prompt,
    notes: local.notes
  }, {
    recordCommand: true,
    label: 'Edit asset'
  })
}

const assetDocument = useEditorDocumentSession({
  id: () => `asset:${props.assetId}`,
  save: persistNow
})

function persist(): void {
  assetDocument.markDirty()
}

function filtersForType(type: AssetType): { name: string; extensions: string[] }[] {
  switch (type) {
    case 'image':
      return [{ name: t('asset.fileFilter.image'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    case 'video':
    case 'motion':
      return [{ name: t('asset.fileFilter.video'), extensions: ['mp4', 'mov', 'webm', 'glb', 'gltf', 'png', 'jpg'] }]
    case 'voice':
      return [{ name: t('asset.fileFilter.audio'), extensions: ['mp3', 'wav', 'ogg', 'm4a'] }]
    default:
      return [{ name: t('asset.fileFilter.all'), extensions: ['png', 'jpg', 'mp4', 'mp3', 'txt', 'md'] }]
  }
}

async function onAttach(): Promise<void> {
  if (!asset.value) return
  error.value = ''
  const files = await window.studio.selectFiles(filtersForType(asset.value.type))
  if (!files.length) return
  try {
    if (isDraftAssetId(asset.value.id)) {
      await persistAssetRecord(props.assetId, { pendingFilePath: files[0] })
      return
    }
    const updated = await window.studio.attachAssetFile({
      assetId: asset.value.id,
      filePath: files[0]
    })
    const idx = project.assets.findIndex((a) => a.id === updated.id)
    if (idx >= 0) project.assets[idx] = updated
    else project.assets.push(updated)
    local.prompt = updated.prompt ?? local.prompt
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<style scoped>
.asset-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
  background: var(--bg-panel);
}

.asset-editor.graph {
  gap: 0;
  padding: 0;
  overflow: hidden;
}

.asset-editor.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.asset-graph {
  flex: 1;
  min-height: 0;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.type {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.type,
.title-row {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
}

.draft-mark {
  color: #f5a623;
  font-weight: 600;
  line-height: 1;
}

.type .draft-mark {
  font-size: 13px;
}

.title-row .draft-mark {
  font-size: 15px;
}

.draft-hint {
  color: #f5a623;
}

.head h2 {
  font-size: 16px;
  margin-top: 2px;
}

.preview {
  background: var(--graph-preview-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview img,
.preview video {
  max-width: 100%;
  max-height: 240px;
  display: block;
}

.preview img.preview-image {
  cursor: zoom-in;
}

.preview audio {
  width: 90%;
}

.placeholder {
  text-align: center;
  color: var(--text-muted);
  padding: 24px;
}

.placeholder span {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text);
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

textarea {
  min-height: 120px;
}

.err {
  color: var(--danger);
  font-size: 12px;
}

.meta {
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--mono);
}
</style>
