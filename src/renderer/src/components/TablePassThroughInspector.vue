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

    <div v-if="batchKind" class="batch-block">
      <label class="batch-option">
        <input v-model="onlyMissing" type="checkbox" />
        <span>{{ t('graph.inspector.shotBatch.onlyMissing') }}</span>
      </label>
      <label class="batch-option">
        <input v-model="collectAfter" type="checkbox" />
        <span>{{ t('graph.inspector.shotBatch.collectAfter') }}</span>
      </label>
      <button
        type="button"
        class="batch-btn"
        :disabled="batchBusy || isGraphRunning"
        @click="onBatchRun"
      >
        <span class="icon-batch" aria-hidden="true" />
        <span class="batch-btn-label">{{ batchBusy ? '…' : batchButtonLabel }}</span>
      </button>
      <p v-if="batchMessage" class="batch-msg">{{ batchMessage }}</p>
    </div>

    <template v-if="isNarrativeGen">
      <label>
        {{ t('graph.inspector.generate.mediaOutputDir') }}
        <div class="path-row">
          <input :value="mediaOutputDirDisplay" readonly :title="mediaOutputDirDisplay" />
          <button type="button" class="path-btn" @click="pickMediaOutputDir">
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
                <code class="path-line">{{
                  item.relativePath || t('graph.output.narrativePathPending')
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
import {
  isDraftAssetId,
  normalizeProjectRelativeDir,
  resolveMediaOutputDir,
  shotScriptAssetId,
  toProjectRelativeDir,
  type Shot
} from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { useGraphTaskStore } from '../stores/graphTasks'
import { useProjectStore } from '../stores/project'
import { useDraftStore } from '../stores/drafts'
import { promptAlert } from '../composables/useStudioPrompt'

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
  'narrative.table',
  'narrative.gen'
])

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const taskStore = useGraphTaskStore()
const project = useProjectStore()
const drafts = useDraftStore()

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

const isNarrativeGen = computed(() => node.value?.typeId === 'narrative.gen')

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : t('graph.inspector.node.title')
)

const hint = computed(() => {
  const typeId = node.value?.typeId
  if (typeId === 'world.table') return t('graph.inspector.worldTable.hint')
  if (typeId === 'world.gen') return t('graph.inspector.worldGen.hint')
  if (typeId === 'narrative.table') return t('graph.inspector.narrativeTable.hint')
  if (typeId === 'narrative.gen') return t('graph.inspector.narrativeGen.hint')
  if (typeId === 'script.shotImageGen') return t('graph.inspector.shotImageGen.hint')
  if (typeId === 'script.shotVideoGen') return t('graph.inspector.shotVideoGen.hint')
  return t('graph.inspector.shotTable.hint')
})

const batchKind = computed<'visual' | 'shotWorkflow' | 'world' | 'narrative' | null>(() => {
  const typeId = node.value?.typeId
  if (typeId === 'script.shotImageGen') return 'visual'
  if (typeId === 'script.shotVideoGen') return 'shotWorkflow'
  if (typeId === 'world.gen') return 'world'
  if (typeId === 'narrative.gen') return 'narrative'
  return null
})

const batchButtonLabel = computed(() => {
  if (batchKind.value === 'world') return t('graph.inspector.shotBatch.runElements')
  if (batchKind.value === 'narrative') return t('graph.inspector.shotBatch.runUnits')
  return t('graph.inspector.shotBatch.runShots')
})

const onlyMissing = ref(true)
const collectAfter = ref(false)
const batchBusy = ref(false)
const batchMessage = ref('')
const localTitle = ref('')
const resolvedGeneratedText = ref<Record<string, string>>({})
const textNotepadOpen = ref(false)
const textNotepadTitle = ref('')
const textNotepadBody = ref('')
let resolveToken = 0

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
  if (!current || !isNarrativeGen.value) return []
  return (current.params.generatedTexts ?? []).filter(
    (item) => item.id && (item.text?.trim() || item.relativePath?.trim())
  )
})

watch(
  node,
  (current) => {
    localTitle.value = current?.title || typeLabel.value
    batchMessage.value = ''
  },
  { immediate: true }
)

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

async function pickMediaOutputDir(): Promise<void> {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid || !isNarrativeGen.value) return
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

function resolveHostAssetId(): string | null {
  const id = hostId.value
  const assetMatch = /^asset:([^:]+)/.exec(id)
  if (assetMatch?.[1]) return assetMatch[1]
  return null
}

function resolveScriptShots(scriptAssetId: string): Shot[] {
  if (isDraftAssetId(scriptAssetId)) {
    return drafts.getDraft(scriptAssetId)?.shots ?? []
  }
  return project.shots.filter((s) => shotScriptAssetId(s) === scriptAssetId)
}

async function onBatchRun(): Promise<void> {
  const kind = batchKind.value
  const current = node.value
  if (!kind || !current || batchBusy.value) return

  batchBusy.value = true
  batchMessage.value = ''
  try {
    const assetId = resolveHostAssetId()
    if (!assetId) {
      await promptAlert({
        title: typeLabel.value,
        message: t('graph.inspector.shotBatch.empty')
      })
      return
    }

    let result
    if (kind === 'world') {
      const draft = drafts.getDraft(assetId)
      const asset = project.assets.find((a) => a.id === assetId)
      if (draft?.type !== 'world' && asset?.type !== 'world') {
        await promptAlert({
          title: typeLabel.value,
          message: t('graph.inspector.shotBatch.empty')
        })
        return
      }
      result = taskStore.enqueueWorldElementBatch({
        worldAssetId: assetId,
        onlyMissing: onlyMissing.value
      })
    } else if (kind === 'narrative') {
      const draft = drafts.getDraft(assetId)
      const asset = project.assets.find((a) => a.id === assetId)
      if (draft?.type !== 'narrative' && asset?.type !== 'narrative') {
        await promptAlert({
          title: typeLabel.value,
          message: t('graph.inspector.shotBatch.empty')
        })
        return
      }
      result = taskStore.enqueueNarrativeUnitBatch({
        narrativeAssetId: assetId,
        onlyMissing: onlyMissing.value
      })
    } else {
      const draft = drafts.getDraft(assetId)
      const asset = project.assets.find((a) => a.id === assetId)
      if (draft?.type !== 'script' && asset?.type !== 'script') {
        await promptAlert({
          title: typeLabel.value,
          message: t('graph.inspector.shotBatch.empty')
        })
        return
      }
      const shots = resolveScriptShots(assetId)
      if (!shots.length) {
        await promptAlert({
          title: typeLabel.value,
          message: t('graph.inspector.shotBatch.empty')
        })
        return
      }
      result = taskStore.enqueueScriptShotBatch({
        scriptAssetId: assetId,
        shots,
        kind,
        onlyMissing: onlyMissing.value
      })
    }

    batchMessage.value = t('graph.inspector.shotBatch.result', {
      enqueued: result.enqueued,
      skipped: result.skipped,
      duplicates: result.duplicates
    })

    if (result.enqueued > 0) {
      taskStore.openDialog(document.querySelector<HTMLElement>('[data-graph-task-anchor]'))
    } else if (result.skipped + result.duplicates === 0) {
      await promptAlert({
        title: typeLabel.value,
        message: t('graph.inspector.shotBatch.empty')
      })
    }

    if (collectAfter.value && result.taskIds.length) {
      await taskStore.waitForTaskIds(result.taskIds)
      const runHost = graphRunHosts.get(hostId.value)
      if (runHost && current.id) {
        await runHost.runToNode(current.id)
      }
    }
  } finally {
    batchBusy.value = false
  }
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

.batch-block {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.batch-option {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: var(--text);
  line-height: 1.35;
  cursor: pointer;
  user-select: none;
}

.batch-option > input[type='checkbox'] {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 2px 0 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  accent-color: var(--accent);
}

.batch-option > span {
  flex: 1;
  min-width: 0;
}

.batch-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg) 70%, var(--bg-elevated));
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}

.batch-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
}

.batch-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.batch-btn-label {
  line-height: 1;
}

.icon-batch {
  position: relative;
  width: 11px;
  height: 10px;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 1.5px;
}

.icon-batch::before,
.icon-batch::after {
  content: '';
  position: absolute;
  left: 1.5px;
  right: 1.5px;
  height: 1.5px;
  background: currentColor;
  border-radius: 1px;
}

.icon-batch::before {
  top: 2px;
}

.icon-batch::after {
  bottom: 2px;
}

.batch-msg {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}
</style>
