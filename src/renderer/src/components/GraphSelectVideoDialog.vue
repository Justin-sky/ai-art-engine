<template>
  <StudioFloatingWindow
    :open="open"
    :z-index="1200"
    :default-width="720"
    :default-height="640"
    :min-width="480"
    :min-height="360"
    @close="onClose"
  >
    <template #title>
      <div class="title-block">
        <span class="app-mark">{{ t('graph.selectVideo.appMark') }}</span>
        <h2 class="title" :title="title">{{ title }}</h2>
      </div>
    </template>

    <template #title-actions>
      <button type="button" class="tool-btn" :disabled="!dirty" @click="save">
        {{ t('common.save') }}
      </button>
    </template>

    <p class="hint">{{ t('graph.selectVideo.hint') }}</p>
    <div v-if="!items.length" class="empty">{{ t('graph.selectVideo.empty') }}</div>
    <div v-else class="video-grid" role="listbox" :aria-label="t('graph.selectVideo.appMark')">
      <button
        v-for="(item, index) in items"
        :key="itemKey(item, index)"
        type="button"
        class="card"
        role="option"
        :aria-selected="draftId === itemKey(item, index)"
        :class="{ selected: draftId === itemKey(item, index) }"
        @click="draftId = itemKey(item, index)"
      >
        <video
          :src="resolvedThumbSrc(item, index)"
          muted
          playsinline
          preload="metadata"
          :title="t('graph.selectVideo.previewHint')"
          @dblclick.stop="openPreview(item)"
        />
        <span class="caption">{{ index + 1 }}</span>
      </button>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { videoItemKey, type GraphVideoItem } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

const props = defineProps<{
  open: boolean
  title: string
  items: GraphVideoItem[]
  selectedVideoId?: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [selectedVideoId: string]
}>()

const { t } = useStudioI18n()
const draftId = ref('')
const thumbSrc = ref<Record<string, string>>({})
let thumbToken = 0

function itemKey(item: GraphVideoItem, index: number): string {
  return videoItemKey(item, index)
}

function resolvedThumbSrc(item: GraphVideoItem, index: number): string {
  const key = itemKey(item, index)
  return thumbSrc.value[key] || item.dataUrl || ''
}

async function resolveThumbs(): Promise<void> {
  const token = ++thumbToken
  const next: Record<string, string> = {}
  await Promise.all(
    props.items.map(async (item, index) => {
      const key = itemKey(item, index)
      const relativePath = item.relativePath?.trim()
      if (relativePath) {
        try {
          next[key] = await window.studio.getAssetFileUrl(relativePath)
          return
        } catch {
          /* fall through */
        }
      }
      if (item.dataUrl?.trim()) next[key] = item.dataUrl
    })
  )
  if (token !== thumbToken) return
  thumbSrc.value = next
}

watch(
  () => [props.open, props.items] as const,
  ([open]) => {
    if (!open) return
    void resolveThumbs()
  },
  { immediate: true, deep: true }
)

const dirty = computed(() => {
  const current = props.selectedVideoId ?? (props.items[0] ? itemKey(props.items[0], 0) : '')
  return draftId.value !== current
})

watch(
  () => [props.open, props.items, props.selectedVideoId] as const,
  ([open]) => {
    if (!open) return
    if (props.selectedVideoId) {
      draftId.value = props.selectedVideoId
      return
    }
    draftId.value = props.items[0] ? itemKey(props.items[0], 0) : ''
  },
  { immediate: true, deep: true }
)

function save(): void {
  if (!draftId.value) return
  emit('save', draftId.value)
}

async function openPreview(item: GraphVideoItem): Promise<void> {
  await openFullImagePreview({
    dataUrl: item.dataUrl,
    relativePath: item.relativePath
  })
}

function onClose(): void {
  emit('close')
}
</script>

<style scoped>
.title-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-mark {
  font-size: 10px;
  color: var(--text-muted);
}

.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}

.tool-btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent);
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.empty {
  padding: 32px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
  padding: 2px 0 8px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
  color: inherit;
  cursor: pointer;
}

.card:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--bg-hover);
}

.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.card video {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: var(--graph-preview-bg);
  display: block;
  cursor: zoom-in;
  pointer-events: auto;
}

.caption {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.card.selected .caption {
  color: var(--text);
}
</style>
