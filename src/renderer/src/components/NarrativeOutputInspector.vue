<template>
  <div v-if="node" class="narrative-output-inspector">
    <div class="head">
      <span class="type">{{ t('graph.titles.narrativeOutput') }}</span>
      <h2>{{ node.title || t('graph.titles.narrativeOutput') }}</h2>
    </div>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <label>
      {{ t('graph.inspector.generate.mediaOutputDir') }}
      <div class="path-row">
        <input :value="mediaOutputDirDisplay" readonly :title="mediaOutputDirDisplay" />
        <button type="button" class="btn" @click="pickMediaOutputDir">
          {{ t('common.browse') }}
        </button>
      </div>
      <span class="field-hint">{{ t('graph.inspector.generate.mediaOutputDirHint') }}</span>
    </label>

    <section class="generated-texts" :aria-label="t('graph.output.narrativePaths')">
      <div class="section-head">
        <span class="section-title">{{ t('graph.output.narrativePaths') }}</span>
        <span v-if="generatedTexts.length" class="section-count">
          {{ t('graph.inspector.generate.generatedTextsCount', { n: generatedTexts.length }) }}
        </span>
      </div>
      <p class="section-hint">{{ t('graph.output.narrativePathsHint') }}</p>
      <div v-if="!generatedTexts.length" class="empty">
        {{ t('graph.output.narrativePathsEmpty') }}
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
              <code class="path-line">{{ item.relativePath || t('graph.output.narrativePathPending') }}</code>
              <pre class="path-preview">{{
                resolvedGeneratedText[item.id || `index:${index}`] || '…'
              }}</pre>
            </div>
          </button>
        </li>
      </ul>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <GraphTextNotepadDialog
      :open="textNotepadOpen"
      :title="textNotepadTitle"
      :text="textNotepadBody"
      :editable="false"
      @close="textNotepadOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  normalizeProjectRelativeDir,
  resolveMediaOutputDir,
  toProjectRelativeDir
} from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import { isNarrativeOutputNode } from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../stores/project'

type StoredGeneratedText = {
  id?: string
  text?: string
  relativePath?: string
  createdAt?: string
}

const { t } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()
const localTitle = ref('')
const resolvedGeneratedText = ref<Record<string, string>>({})
const textNotepadOpen = ref(false)
const textNotepadTitle = ref('')
const textNotepadBody = ref('')
let resolveToken = 0

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || !isNarrativeOutputNode(current)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const hostAssetDirs = computed(() => {
  const hid = hostId.value
  if (hid.startsWith('asset:')) {
    const id = hid.slice('asset:'.length).split(':')[0]
    const asset = project.assets.find((a) => a.id === id) ?? null
    return assetMediaHostDirs(asset, project.folders)
  }
  return assetMediaHostDirs(null, project.folders)
})

const mediaOutputDirDisplay = computed(() =>
  resolveMediaOutputDir({
    mediaOutputDir: node.value?.params.mediaOutputDir,
    hostRelativePath: hostAssetDirs.value.hostRelativePath,
    hostFolderDir: hostAssetDirs.value.hostFolderDir,
    hostAssetName: hostAssetDirs.value.hostAssetName,
    kind: 'text'
  })
)

const generatedTexts = computed((): StoredGeneratedText[] => {
  void graphEditorHosts.revision.value
  const current = node.value
  if (!current) return []
  return (current.params.generatedTexts ?? []).filter(
    (item) => item.id && (item.text?.trim() || item.relativePath?.trim())
  )
})

watch(
  node,
  (current) => {
    localTitle.value = current?.title ?? ''
  },
  { immediate: true }
)

function persistTitle(): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, { title: localTitle.value.trim() })
  graphEditorHosts.bumpRevision()
}

async function pickMediaOutputDir(): Promise<void> {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const root = project.rootPath
  if (!root) return
  const abs = await window.studio.selectDirectory()
  if (!abs) return
  const relative = toProjectRelativeDir(abs, root)
  const normalized = normalizeProjectRelativeDir(relative)
  if (relative === null || !normalized) {
    window.alert(t('graph.inspector.generate.pathOutsideProject'))
    return
  }
  graphEditorHosts.updateNode(hid, current.id, { mediaOutputDir: normalized })
  graphEditorHosts.bumpRevision()
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
  textNotepadTitle.value = item.relativePath?.trim() || t('graph.output.narrativePaths')
  textNotepadBody.value = body
  textNotepadOpen.value = true
}
</script>

<style scoped>
.narrative-output-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-height: 0;
}

.head .type {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

label input {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg-panel));
  color: var(--text);
  font: inherit;
}

.path-row {
  display: flex;
  gap: 8px;
}

.path-row input {
  flex: 1;
  min-width: 0;
}

.btn {
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg-panel));
  color: var(--text);
  cursor: pointer;
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
