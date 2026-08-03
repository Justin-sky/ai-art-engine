<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ hint }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <template v-if="isBeatGen">
      <section class="generated-texts" :aria-label="t('graph.output.beatPaths')">
        <div class="section-head">
          <span class="section-title">{{ t('graph.output.beatPaths') }}</span>
          <span v-if="generatedTexts.length" class="section-count">
            {{ t('graph.inspector.generate.generatedTextsCount', { n: generatedTexts.length }) }}
          </span>
        </div>
        <p class="section-hint">{{ t('graph.output.beatPathsHint') }}</p>
        <div v-if="!generatedTexts.length" class="empty">
          {{ t('graph.output.beatPathsEmpty') }}
        </div>
        <ul v-else class="path-list">
          <li v-for="(item, index) in generatedTexts" :key="item.id || `index:${index}`">
            <button
              type="button"
              class="path-card"
              :title="t('graph.inspector.generate.generatedTextsOpen')"
              @dblclick="openGeneratedText(item.id || `index:${index}`)"
            >
              <span class="path-index">{{ index + 1 }}</span>
              <div class="path-main">
                <code class="path-line">{{
                  item.relativePath || t('graph.output.beatPathPending')
                }}</code>
                <pre class="path-preview">{{
                  resolvedGeneratedText[item.id || `index:${index}`] || '…'
                }}</pre>
              </div>
            </button>
          </li>
        </ul>
      </section>
    </template>

    <GraphNodeOutputPreview v-else-if="node && hostId" :node="node" :host-id="hostId" />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <GraphTextNotepadDialog
      :open="textNotepadOpen"
      :title="textNotepadTitle"
      :text="textNotepadBody"
      :editable="false"
      @close="textNotepadOpen = false"
    />
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

type StoredGeneratedText = {
  id?: string
  text?: string
  relativePath?: string
  createdAt?: string
}

const PASS_THROUGH_TYPE_IDS = new Set([
  'script.shotTable',
  'script.shotImageGen',
  'script.shotVideoGen',
  'world.table',
  'world.gen',
  'beat.table',
  'beat.gen'
])

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || !current.typeId || !PASS_THROUGH_TYPE_IDS.has(current.typeId)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const isBeatGen = computed(() => node.value?.typeId === 'beat.gen')

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : t('graph.inspector.node.title')
)

const hint = computed(() => {
  const typeId = node.value?.typeId
  if (typeId === 'world.table') return t('graph.inspector.worldTable.hint')
  if (typeId === 'world.gen') return t('graph.inspector.worldGen.hint')
  if (typeId === 'beat.table') return t('graph.inspector.beatTable.hint')
  if (typeId === 'beat.gen') return t('graph.inspector.beatGen.hint')
  if (typeId === 'script.shotImageGen') return t('graph.inspector.shotImageGen.hint')
  if (typeId === 'script.shotVideoGen') return t('graph.inspector.shotVideoGen.hint')
  return t('graph.inspector.shotTable.hint')
})

const localTitle = ref('')
const resolvedGeneratedText = ref<Record<string, string>>({})
const textNotepadOpen = ref(false)
const textNotepadTitle = ref('')
const textNotepadBody = ref('')
let resolveToken = 0

const generatedTexts = computed((): StoredGeneratedText[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current || !isBeatGen.value) return []
  return (current.params.generatedTexts ?? []).filter(
    (item) => item.id && (item.text?.trim() || item.relativePath?.trim())
  )
})

watch(
  node,
  (current) => {
    localTitle.value = current?.title || typeLabel.value
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

async function loadGeneratedTextBody(item: StoredGeneratedText): Promise<string> {
  const inline = item.text?.trim()
  if (inline) return item.text ?? ''
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

async function resolveGeneratedTextPreviews(): Promise<void> {
  const token = ++resolveToken
  const next: Record<string, string> = {}
  await Promise.all(
    generatedTexts.value.map(async (item, index) => {
      const key = item.id || `index:${index}`
      const body = await loadGeneratedTextBody(item)
      const snippet = body.trim()
      next[key] = snippet
        ? snippet.length > 160
          ? `${snippet.slice(0, 160)}…`
          : snippet
        : item.relativePath?.trim() || '…'
    })
  )
  if (token !== resolveToken) return
  resolvedGeneratedText.value = next
}

watch(generatedTexts, () => void resolveGeneratedTextPreviews(), { immediate: true, deep: true })

onBeforeUnmount(() => {
  resolveToken += 1
})

async function openGeneratedText(key: string): Promise<void> {
  const list = generatedTexts.value
  const index = list.findIndex((item, i) => (item.id || `index:${i}`) === key)
  const item = index >= 0 ? list[index] : undefined
  if (!item) return
  const body = await loadGeneratedTextBody(item)
  textNotepadTitle.value = item.relativePath?.trim() || t('graph.output.beatPaths')
  textNotepadBody.value = body
  textNotepadOpen.value = true
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 0;
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

label > input:not([type='checkbox']) {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}

.path-row {
  display: flex;
  gap: 8px;
}

.path-row input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}

.path-btn {
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}

.field-hint,
.section-hint,
.empty {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
}

.generated-texts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.section-head {
  display: flex;
  align-items: baseline;
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

.path-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}

.path-card {
  width: 100%;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  text-align: left;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated, var(--bg-panel));
  color: inherit;
  cursor: pointer;
}

.path-card:hover {
  border-color: color-mix(in srgb, var(--accent, #6a8) 45%, var(--border));
}

.path-index {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--border) 55%, transparent);
}

.path-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.path-line {
  font-size: 11px;
  color: var(--text);
  word-break: break-all;
}

.path-preview {
  margin: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
  white-space: pre-wrap;
  max-height: 4.4em;
  overflow: hidden;
}
</style>
