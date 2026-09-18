<template>
  <section class="generated-models" :aria-label="t('graph.inspector.generate.generatedModels')">
    <div class="section-head">
      <span class="section-title">{{ t('graph.inspector.generate.generatedModels') }}</span>
      <span v-if="items.length" class="section-count">
        {{ t('graph.inspector.generate.generatedModelsCount', { n: items.length }) }}
      </span>
    </div>
    <p class="section-hint">
      {{ t('graph.inspector.generate.generatedModelsHint') }}
    </p>
    <div v-if="!items.length" class="empty-shots">
      {{ t('graph.inspector.generate.generatedModelsEmpty') }}
    </div>
    <div v-else class="shot-grid">
      <div
        v-for="(item, index) in items"
        :key="item.id || `index:${index}`"
        class="shot-card"
        :class="{ selected: isSelected(item.id || `index:${index}`) }"
      >
        <button
          type="button"
          class="shot-thumb"
          :title="t('graph.inspector.generate.setAsOutput')"
          @click="selectItem(item.id || `index:${index}`)"
        >
          <img
            v-if="thumbs[item.id || `index:${index}`]"
            :src="thumbs[item.id || `index:${index}`]"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span v-else class="shot-loading">…</span>
          <span class="shot-index">{{ index + 1 }}</span>
        </button>
        <PreviewSaveToLibraryButton
          v-if="canSave(item.relativePath)"
          compact
          class="shot-save"
          :can-save="true"
          :saved="isSaved(item.relativePath)"
          :saving="isSaving(item.relativePath)"
          @save="openSave(item.relativePath!)"
        />
        <button
          type="button"
          class="shot-delete"
          :title="t('graph.inspector.generate.generatedModelsDelete')"
          @click.stop="removeItem(item.id)"
        >
          ×
        </button>
      </div>
    </div>
    <SaveAssetDialog
      ref="dialogRef"
      :open="dialogOpen"
      :default-name="defaultName"
      :default-folder-id="defaultFolderId"
      :title="t('studio.chat.saveToLibraryTitle')"
      :subtitle="t('studio.chat.saveToLibrarySubtitle')"
      @confirm="confirmSave"
      @cancel="closeDialog"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GraphNode } from '@shared/graph'
import { thumbRelativePathFor } from '@shared/media/thumbnailPath'
import PreviewSaveToLibraryButton from './PreviewSaveToLibraryButton.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import { useSaveCacheAsset } from '../composables/useSaveCacheAsset'
import { useStudioI18n } from '../composables/useStudioI18n'
import { ensureModelPreviewUrl } from '../features/media/ensureModelPreviewUrl'
import {
  deleteGalleryOutput,
  selectGalleryOutput
} from '../features/graph/model/graphGalleryOutput'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { invalidateAssetUrlCache } from '../features/media/assetUrlCache'

const props = defineProps<{
  node: GraphNode
  hostId: string
}>()

const { t } = useStudioI18n()
const { canSave, isSaved, isSaving, openSave, dialogOpen, dialogRef, defaultName, defaultFolderId, confirmSave, closeDialog } =
  useSaveCacheAsset()

const items = computed(() => {
  void graphEditorHosts.revision.value
  return (props.node.params.generatedModels ?? []).filter(
    (item) => item.id && item.relativePath?.trim()
  )
})

const thumbs = ref<Record<string, string>>({})
let resolveToken = 0

async function resolveThumbs(): Promise<void> {
  const token = ++resolveToken
  const next: Record<string, string> = {}
  await Promise.all(
    items.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const relativePath = item.relativePath?.trim()
      if (!relativePath) return
      try {
        const url = await ensureModelPreviewUrl({ relativePath })
        if (url) next[key] = url
      } catch {
        /* skip */
      }
    })
  )
  if (token !== resolveToken) return
  thumbs.value = next
}

watch(items, () => void resolveThumbs(), { immediate: true, deep: true })

function isSelected(key: string): boolean {
  const selected = props.node.params.selectedModelId?.trim()
  if (selected) return selected === key
  const last = items.value[items.value.length - 1]
  return Boolean(last && (last.id || '') === key)
}

function selectItem(key: string): void {
  const item = items.value.find((entry, i) => (entry.id || `index:${i}`) === key)
  if (!item?.id) return
  selectGalleryOutput(props.hostId, props.node, 'model', item.id)
  graphEditorHosts.bumpRevision()
}

function removeItem(id: string | undefined): void {
  if (!id) return
  const result = deleteGalleryOutput(props.hostId, props.node, 'model', id)
  graphEditorHosts.bumpRevision()
  const relativePath = result.relativePath?.trim()
  if (relativePath) {
    invalidateAssetUrlCache(relativePath)
    invalidateAssetUrlCache(thumbRelativePathFor(relativePath))
    void window.studio.deleteGraphRunMedia(relativePath).catch((err) => {
      console.warn('[GeneratedModelsGallery] delete graph media failed', relativePath, err)
    })
  }
}
</script>

<style scoped>
.generated-models {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.section-count {
  font-size: 11px;
  color: var(--text-muted);
}

.section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.empty-shots {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
}

.shot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.shot-card {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.shot-card.selected {
  border-color: color-mix(in srgb, var(--accent, #5a8cff) 75%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent, #5a8cff) 45%, transparent);
}

.shot-thumb {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: var(--graph-preview-bg, var(--bg-elevated));
  cursor: pointer;
  aspect-ratio: 1;
}

.shot-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.shot-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 72px;
  color: var(--text-muted);
  font-size: 14px;
}

.shot-index {
  position: absolute;
  left: 6px;
  bottom: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.shot-save {
  position: absolute;
  right: 26px;
  top: 4px;
}

.shot-delete {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
}

.shot-delete:hover {
  background: rgba(180, 40, 40, 0.85);
}
</style>
