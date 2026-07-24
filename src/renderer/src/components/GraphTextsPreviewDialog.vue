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
        <span class="app-mark">{{ t('graph.textsPreview.appMark') }}</span>
        <h2 class="title" :title="title">{{ title }}</h2>
      </div>
    </template>

    <p class="hint">{{ t('graph.textsPreview.hint') }}</p>
    <div v-if="!items.length" class="empty">{{ t('graph.textsPreview.empty') }}</div>
    <div v-else class="text-grid" :aria-label="t('graph.textsPreview.appMark')">
      <button
        v-for="(item, index) in items"
        :key="itemKey(item, index)"
        type="button"
        class="card"
        :title="t('graph.textsPreview.openHint')"
        @dblclick="openItem(item, index)"
      >
        <pre class="snippet">{{ resolvedBody(item, index) }}</pre>
        <span class="caption">{{ index + 1 }}</span>
      </button>
    </div>
  </StudioFloatingWindow>

  <GraphTextNotepadDialog
    :open="notepadOpen"
    :title="notepadTitle"
    :text="notepadText"
    :editable="false"
    @close="closeNotepad"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { GraphTextItem } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'

const props = defineProps<{
  open: boolean
  title: string
  items: GraphTextItem[]
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const resolved = ref<Record<string, string>>({})
let resolveToken = 0

const notepadOpen = ref(false)
const notepadText = ref('')
const notepadTitle = ref('')

function itemKey(item: GraphTextItem, index: number): string {
  return item.id?.trim() || `text:${index}`
}

function resolvedBody(item: GraphTextItem, index: number): string {
  const key = itemKey(item, index)
  const body = resolved.value[key] ?? item.text ?? ''
  const snippet = body.trim()
  if (!snippet) return item.relativePath?.trim() || '…'
  return snippet.length > 220 ? `${snippet.slice(0, 220)}…` : snippet
}

async function loadTextBody(item: GraphTextItem): Promise<string> {
  const inline = item.text?.trim()
  if (inline) return item.text
  const relativePath = item.relativePath?.trim()
  if (!relativePath) return ''
  try {
    const url = await window.studio.getAssetFileUrl(relativePath)
    if (!url) return ''
    const res = await fetch(url)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

async function resolveBodies(): Promise<void> {
  const token = ++resolveToken
  const next: Record<string, string> = {}
  await Promise.all(
    props.items.map(async (item, index) => {
      const key = itemKey(item, index)
      next[key] = await loadTextBody(item)
    })
  )
  if (token !== resolveToken) return
  resolved.value = next
}

watch(
  () => [props.open, props.items] as const,
  ([open]) => {
    if (!open) {
      resolveToken += 1
      resolved.value = {}
      closeNotepad()
      return
    }
    void resolveBodies()
  },
  { immediate: true, deep: true }
)

async function openItem(item: GraphTextItem, index: number): Promise<void> {
  const key = itemKey(item, index)
  const body = resolved.value[key] ?? (await loadTextBody(item))
  notepadTitle.value = `${props.title} · ${index + 1}`
  notepadText.value = body
  notepadOpen.value = true
}

function closeNotepad(): void {
  notepadOpen.value = false
  notepadText.value = ''
  notepadTitle.value = ''
}

function onClose(): void {
  emit('close')
}
</script>

<style scoped>
.title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.app-mark {
  font-size: 11px;
  opacity: 0.65;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  margin: 0 0 10px;
  font-size: 12px;
  opacity: 0.72;
}

.empty {
  display: grid;
  place-items: center;
  min-height: 180px;
  font-size: 13px;
  opacity: 0.65;
}

.text-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.card {
  position: relative;
  display: block;
  width: 100%;
  min-height: 120px;
  margin: 0;
  padding: 10px 10px 22px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  background: var(--graph-preview-bg, var(--bg-elevated));
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

.card:hover {
  border-color: color-mix(in srgb, var(--accent, #6ea8fe) 55%, var(--border));
}

.snippet {
  margin: 0;
  max-height: 140px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text);
}

.caption {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 11px;
  opacity: 0.55;
}
</style>
