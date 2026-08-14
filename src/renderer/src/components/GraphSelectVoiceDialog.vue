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
        <span class="app-mark">{{ t('graph.selectVoice.appMark') }}</span>
        <h2
          class="title"
          :title="title"
        >
          {{ title }}
        </h2>
      </div>
    </template>

    <template #title-actions>
      <button
        type="button"
        class="tool-btn"
        :disabled="!dirty"
        @click="save"
      >
        {{ t('common.save') }}
      </button>
    </template>

    <p class="hint">
      {{ t('graph.selectVoice.hint') }}
    </p>
    <div
      v-if="!items.length"
      class="empty"
    >
      {{ t('graph.selectVoice.empty') }}
    </div>
    <div
      v-else
      class="voice-grid"
      role="listbox"
      :aria-label="t('graph.selectVoice.appMark')"
    >
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
        <audio
          :src="resolvedThumbSrc(item, index)"
          controls
          preload="metadata"
          :title="t('graph.selectVoice.previewHint')"
          @dblclick.stop="openPreview(item)"
          @click.stop
        />
        <span class="caption">{{ index + 1 }}</span>
      </button>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { voiceItemKey, type GraphVoiceItem } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

const props = defineProps<{
  open: boolean
  title: string
  items: GraphVoiceItem[]
  selectedVoiceId?: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [selectedVoiceId: string]
}>()

const { t } = useStudioI18n()
const draftId = ref('')
const thumbSrc = ref<Record<string, string>>({})
let thumbToken = 0

function itemKey(item: GraphVoiceItem, index: number): string {
  return voiceItemKey(item, index)
}

function resolvedThumbSrc(item: GraphVoiceItem, index: number): string {
  const key = itemKey(item, index)
  return thumbSrc.value[key] || ''
}

async function resolveThumbs(): Promise<void> {
  const token = ++thumbToken
  const next: Record<string, string> = {}
  await Promise.all(
    props.items.map(async (item, index) => {
      const key = itemKey(item, index)
      const relativePath = item.relativePath?.trim()
      if (!relativePath) return
      try {
        next[key] = await window.studio.getAssetFileUrl(relativePath)
      } catch {
        /* ignore */
      }
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
  const current = props.selectedVoiceId ?? (props.items[0] ? itemKey(props.items[0], 0) : '')
  return draftId.value !== current
})

watch(
  () => [props.open, props.items, props.selectedVoiceId] as const,
  ([open]) => {
    if (!open) return
    if (props.selectedVoiceId) {
      draftId.value = props.selectedVoiceId
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

async function openPreview(item: GraphVoiceItem): Promise<void> {
  await openFullImagePreview({
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

.voice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  padding: 2px 0 8px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
  color: inherit;
  cursor: pointer;
  gap: 6px;
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

.card audio {
  width: 100%;
  display: block;
}

.caption {
  padding: 2px 4px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.card.selected .caption {
  color: var(--text);
}
</style>
