<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.comicPage.hint') }}
    </p>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <ComicPageCanvas :page="page" exportable :export-name="exportName" />

    <details class="gen-config">
      <summary class="section-head">
        <span class="field-label">{{ t('graph.inspector.comicPage.json') }}</span>
        <button type="button" class="reset-btn" @click.stop="resetPage">
          {{ t('graph.inspector.comicPage.reset') }}
        </button>
      </summary>
      <textarea v-model="text" class="json-editor" rows="14" spellcheck="false" @change="persist" />
      <p v-if="parseError" class="error">
        {{ parseError }}
      </p>
    </details>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createComicPage, parseComicPage, serializeComicPage, type ComicPage } from '@shared/graph'
import ComicPageCanvas from './ComicPageCanvas.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'comic.page' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const typeLabel = computed(() => graphTypeLabel('comic.page'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const localTitle = ref('')
const text = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

const page = computed<ComicPage>(() => parseComicPage(text.value) ?? createComicPage())

const exportName = computed(() => (node.value?.title || typeLabel.value).trim())

const parseError = computed(() => {
  const raw = text.value.trim()
  if (!raw) return ''
  return parseComicPage(raw) ? '' : t('graph.inspector.comicPage.invalidJson')
})

function loadPage(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  localTitle.value = current.title ?? ''
  const raw = current.params.comicPage?.trim() ?? ''
  text.value = raw || serializeComicPage(createComicPage())
}

watch(
  () => [node.value, node.value?.params.comicPage] as const,
  ([current]) => {
    if (!current) {
      localTitle.value = ''
      text.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    const raw = current.params.comicPage?.trim() || serializeComicPage(createComicPage())
    if (!sameNode || raw !== text.value) loadPage(current)
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

function persist(): void {
  if (!node.value) return
  const parsed = parseComicPage(text.value)
  if (!parsed) return
  const selection = editor.selection.current.value
  const serialized = serializeComicPage(parsed)
  text.value = serialized
  graphEditorHosts.updateNode(selection.hostId, node.value.id, { comicPage: serialized })
}

function resetPage(): void {
  text.value = serializeComicPage(createComicPage())
  persist()
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.gen-config {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.reset-btn {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.reset-btn:hover {
  color: var(--text);
  border-color: var(--accent);
}

.json-editor {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 10px;
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
}

.error {
  margin: 0;
  font-size: 11px;
  color: var(--danger, #e05a5a);
  line-height: 1.4;
}
</style>
