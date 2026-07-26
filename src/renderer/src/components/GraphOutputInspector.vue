<template>
  <div v-if="node" class="output-inspector">
    <div class="head">
      <span class="type">{{ outputLabel }}</span>
      <h2>{{ node.title || outputLabel }}</h2>
    </div>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <template v-if="isGenerateScriptOutput">
      <label>
        {{ t('graph.inspector.displayName') }}
        <input v-model="localTitle" @change="persist" />
      </label>
      <div class="export-row">
        <button
          type="button"
          class="export-btn"
          :disabled="!canExport || exporting"
          :title="t('graph.output.exportScreenplay')"
          @click="exportScreenplay"
        >
          <span class="icon-export" aria-hidden="true" />
          <span class="label">
            {{ exporting ? t('graph.output.exporting') : t('graph.output.exportScreenplay') }}
          </span>
        </button>
        <span v-if="exportMessage" class="export-msg" :class="{ error: exportFailed }">
          {{ exportMessage }}
        </span>
      </div>
    </template>

    <template v-else-if="isVoiceOutput">
      <p class="hint">{{ t('graph.output.voiceHint') }}</p>
      <label>
        {{ t('graph.inspector.displayName') }}
        <input v-model="localTitle" @change="persist" />
      </label>
      <label>
        {{ t('graph.output.volume') }}
        <input v-model.number="volume" type="range" min="0" max="1" step="0.05" @change="persist" />
        <span class="value">{{ Math.round(volume * 100) }}%</span>
      </label>
      <label class="row">
        <input v-model="muted" type="checkbox" @change="persist" />
        {{ t('graph.output.muted') }}
      </label>
      <label class="row">
        <input v-model="loop" type="checkbox" @change="persist" />
        {{ t('graph.output.loop') }}
      </label>
    </template>

    <template v-else-if="isVideoOutput">
      <p class="hint">{{ t('graph.output.videoHint') }}</p>
      <label>
        {{ t('graph.inspector.displayName') }}
        <input v-model="localTitle" @change="persist" />
      </label>
      <label>
        {{ t('graph.output.speed') }}
        <select v-model.number="playbackRate" @change="persist">
          <option :value="0.5">0.5×</option>
          <option :value="0.75">0.75×</option>
          <option :value="1">1×</option>
          <option :value="1.25">1.25×</option>
          <option :value="1.5">1.5×</option>
          <option :value="2">2×</option>
        </select>
      </label>
      <div class="export-row">
        <button
          type="button"
          class="export-btn"
          :disabled="!canExportVideo || exporting"
          :title="t('graph.output.exportVideo')"
          @click="exportVideo"
        >
          <span class="icon-export" aria-hidden="true" />
          <span class="label">
            {{ exporting ? t('graph.output.exporting') : t('graph.output.exportVideo') }}
          </span>
        </button>
        <span v-if="exportMessage" class="export-msg" :class="{ error: exportFailed }">
          {{ exportMessage }}
        </span>
      </div>
    </template>

    <template v-else-if="isImageOutput">
      <p class="hint">{{ t('graph.output.imageHint') }}</p>
      <label>
        {{ t('graph.inspector.displayName') }}
        <input v-model="localTitle" @change="persist" />
      </label>
      <div class="export-row">
        <button
          type="button"
          class="export-btn"
          :disabled="!canExportImages || exporting"
          :title="t('graph.output.exportImages')"
          @click="exportImagesBatch"
        >
          <span class="icon-export" aria-hidden="true" />
          <span class="label">
            {{ exporting ? t('graph.output.exporting') : t('graph.output.exportImages') }}
          </span>
        </button>
        <span v-if="exportMessage" class="export-msg" :class="{ error: exportFailed }">
          {{ exportMessage }}
        </span>
      </div>
    </template>

    <template v-else>
      <p class="hint">{{ t('graph.output.connectHint') }}</p>
      <label>
        {{ t('graph.inspector.displayName') }}
        <input v-model="localTitle" @change="persist" />
      </label>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetInfo } from '@shared/domain'
import {
  flattenImagesValues,
  resolveNodeType,
  textFromGraphValue,
  type GraphImageItem,
  type GraphValue
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useProjectStore } from '../stores/project'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const { t } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()
const volume = ref(1)
const muted = ref(false)
const loop = ref(false)
const playbackRate = ref(1)
const localTitle = ref('')
const exporting = ref(false)
const exportMessage = ref('')
const exportFailed = ref(false)
let exportMsgTimer: ReturnType<typeof setTimeout> | null = null

const node = computed(() => {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || resolveNodeType(current)?.inspector !== 'output') return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const isVoiceOutput = computed(() => node.value?.params.outputKind === 'voice')
const isImageOutput = computed(() => node.value?.params.outputKind === 'image')
const isVideoOutput = computed(() => {
  const kind = node.value?.params.outputKind
  return !kind || kind === 'video'
})
const isGenerateScriptOutput = computed(() => {
  const current = node.value
  if (!current) return false
  if (current.typeId === 'output.narrative' || current.typeId === 'output.narrativeUnit') {
    return false
  }
  return current.typeId === 'output.text' || current.params.outputKind === 'text'
})
const isDirectorOutput = computed(() => {
  const hostId = editor.selection.current.value.hostId
  if (!hostId?.startsWith('asset:')) return false
  const assetId = hostId.slice('asset:'.length)
  const asset = project.assets.find((item) => item.id === assetId)
  return asset?.type === 'motion' && node.value?.params.outputKind === 'image'
})
const outputLabel = computed(() => {
  if (node.value?.typeId === 'output.narrativeUnit') return t('graph.titles.narrativeUnitOutput')
  if (node.value?.typeId === 'output.narrative') return t('graph.titles.narrativeOutput')
  if (isGenerateScriptOutput.value) return t('graph.titles.screenplayOutput')
  if (isDirectorOutput.value) return t('graph.titles.directorOutput')
  if (isVoiceOutput.value) return t('graph.titles.assetOutput.voice')
  if (node.value?.params.outputKind === 'text') return t('graph.titles.assetOutput.text')
  if (isVideoOutput.value) return t('graph.titles.assetOutput.video')
  if (node.value?.params.outputKind === 'image') return t('graph.titles.assetOutput.image')
  return t('graph.titles.assetOutput.scene')
})

const resultText = computed(() => {
  const current = node.value
  if (!current) return ''
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const host = selection.kind === 'graph.node' ? graphRunHosts.get(selection.hostId) : null
  const live = textFromGraphValue(host?.runStates[current.id]?.outputs?.out)
  if (live.trim()) return live
  return current.params.resultText ?? ''
})

const canExport = computed(() => resultText.value.trim().length > 0)

function collectVideoAssetIds(value: GraphValue | undefined, into: string[]): void {
  if (!value) return
  if (value.kind === 'asset' && value.assetType === 'video' && value.assetId) {
    into.push(value.assetId)
    return
  }
  if (value.kind === 'output') {
    for (const item of value.items) collectVideoAssetIds(item, into)
  }
}

function resolveExportVideoAsset(): AssetInfo | null {
  const current = node.value
  if (!current) return null
  const selection = editor.selection.current.value
  const host = selection.kind === 'graph.node' ? graphRunHosts.get(selection.hostId) : null
  const ids: string[] = []
  collectVideoAssetIds(host?.runStates[current.id]?.outputs?.out, ids)

  // 输出节点落盘常不含 outputs：沿入边找上游视频资产
  if (!ids.length && selection.kind === 'graph.node' && selection.hostId) {
    const edges = graphEditorHosts.listIncomingEdges(selection.hostId, current.id)
    for (const edge of edges) {
      const source = graphEditorHosts.getNode(selection.hostId, edge.sourceNodeId)
      if (source?.assetType === 'video' && source.assetId) ids.push(source.assetId)
      collectVideoAssetIds(host?.runStates[edge.sourceNodeId]?.outputs?.out, ids)
    }
  }

  for (const assetId of ids) {
    const asset = project.assets.find((item) => item.id === assetId)
    if (asset?.relativePath?.trim()) return asset
  }
  return null
}

const canExportVideo = computed(() => {
  void graphEditorHosts.revision.value
  void graphRunHosts.get(hostId.value)?.runStates
  return !!resolveExportVideoAsset()
})

function pushUniqueImage(into: GraphImageItem[], item: GraphImageItem): void {
  const rel = item.relativePath?.trim()
  const data = item.dataUrl?.trim()
  if (!rel && !data) return
  const key = item.id?.trim() || rel || data!.slice(0, 64)
  if (into.some((row) => (row.id?.trim() || row.relativePath?.trim() || row.dataUrl?.slice(0, 64)) === key)) {
    return
  }
  into.push(item)
}

function collectImagesFromValue(value: GraphValue | undefined, into: GraphImageItem[]): void {
  if (!value) return
  for (const item of flattenImagesValues([value])) pushUniqueImage(into, item)
  if (value.kind === 'asset' && (value.assetType === 'image' || value.assetType === 'canvas')) {
    const asset = project.assets.find((a) => a.id === value.assetId)
    const relativePath = value.relativePath?.trim() || asset?.relativePath?.trim()
    if (relativePath) {
      pushUniqueImage(into, { id: value.assetId, dataUrl: '', relativePath })
    }
  }
  if (value.kind === 'output') {
    for (const item of value.items) collectImagesFromValue(item, into)
  }
}

function resolveExportImages(): GraphImageItem[] {
  const current = node.value
  if (!current) return []
  const selection = editor.selection.current.value
  if (selection.kind !== 'graph.node' || !selection.hostId) return []
  const host = graphRunHosts.get(selection.hostId)
  const items: GraphImageItem[] = []
  // 以输出节点自身为准（runStates / cameraShots / generatedImages）
  collectImagesFromValue(host?.runStates[current.id]?.outputs?.out, items)
  if (!items.length) {
    for (const shot of current.params.cameraShots ?? []) {
      pushUniqueImage(items, intoAsItem(shot))
    }
    for (const shot of current.params.generatedImages ?? []) {
      pushUniqueImage(items, intoAsItem(shot))
    }
  }

  // 输出为空时再回退上游
  if (!items.length) {
    const edges = graphEditorHosts.listIncomingEdges(selection.hostId, current.id)
    for (const edge of edges) {
      const source = graphEditorHosts.getNode(selection.hostId, edge.sourceNodeId)
      collectImagesFromValue(host?.runStates[edge.sourceNodeId]?.outputs?.out, items)
      for (const shot of source?.params.generatedImages ?? []) {
        pushUniqueImage(items, intoAsItem(shot))
      }
      for (const shot of source?.params.cameraShots ?? []) {
        pushUniqueImage(items, intoAsItem(shot))
      }
      if (source?.assetType === 'image' || source?.assetType === 'canvas') {
        const asset = source.assetId
          ? project.assets.find((a) => a.id === source.assetId)
          : null
        const relativePath = asset?.relativePath?.trim()
        if (relativePath) {
          pushUniqueImage(items, { id: source.assetId, dataUrl: '', relativePath })
        }
      }
    }
  }
  return items
}

function intoAsItem(shot: {
  id?: string
  dataUrl?: string
  relativePath?: string
}): GraphImageItem {
  return {
    id: shot.id,
    dataUrl: shot.dataUrl || '',
    ...(shot.relativePath ? { relativePath: shot.relativePath } : {})
  }
}

const canExportImages = computed(() => {
  void graphEditorHosts.revision.value
  void project.assets.length
  void graphRunHosts.get(hostId.value)?.runStates
  return resolveExportImages().length > 0
})

watch(
  node,
  (current) => {
    if (!current) return
    localTitle.value = current.title ?? outputLabel.value
    volume.value = current.params.volume ?? 1
    muted.value = current.params.muted === true
    loop.value = current.params.loop === true
    playbackRate.value = current.params.playbackRate ?? 1
  },
  { immediate: true }
)

function persist(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  if (isVoiceOutput.value) {
    graphEditorHosts.updateNode(
      selection.hostId,
      node.value.id,
      {
        volume: volume.value,
        muted: muted.value,
        loop: loop.value
      },
      localTitle.value.trim()
    )
    return
  }
  if (isVideoOutput.value) {
    graphEditorHosts.updateNode(
      selection.hostId,
      node.value.id,
      { playbackRate: playbackRate.value },
      localTitle.value.trim()
    )
    return
  }
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
}

function sanitizeFileBase(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ')
  return cleaned || 'output'
}

function flashExportMessage(message: string, failed = false): void {
  exportMessage.value = message
  exportFailed.value = failed
  if (exportMsgTimer) clearTimeout(exportMsgTimer)
  exportMsgTimer = setTimeout(() => {
    exportMessage.value = ''
    exportFailed.value = false
    exportMsgTimer = null
  }, 3200)
}

function extensionFromPath(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim())
  return match?.[1]?.toLowerCase() || 'mp4'
}

async function exportScreenplay(): Promise<void> {
  const text = resultText.value
  if (!text.trim() || exporting.value) return
  exporting.value = true
  try {
    const defaultName = `${sanitizeFileBase(localTitle.value || outputLabel.value)}.txt`
    const savedPath = await window.studio.saveTextFile({
      content: text,
      defaultPath: defaultName,
      filters: [
        { name: t('graph.output.exportFilterText'), extensions: ['txt'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!savedPath) return
    flashExportMessage(t('graph.output.exportSuccess'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.output.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportVideo(): Promise<void> {
  const asset = resolveExportVideoAsset()
  if (!asset?.relativePath?.trim() || exporting.value) return
  exporting.value = true
  try {
    const url = await window.studio.getAssetFileUrl(asset.relativePath)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = new Uint8Array(await response.arrayBuffer())
    const ext = extensionFromPath(asset.relativePath)
    const defaultName = `${sanitizeFileBase(localTitle.value || asset.name || outputLabel.value)}.${ext}`
    const savedPath = await window.studio.saveBinaryFile({
      data: buffer,
      defaultPath: defaultName,
      filters: [
        { name: t('graph.output.exportFilterVideo'), extensions: [ext, 'mp4', 'webm', 'mov'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!savedPath) return
    flashExportMessage(t('graph.output.exportVideoSuccess'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.output.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'png'
}

async function resolveImageBytes(
  item: GraphImageItem
): Promise<{ data: Uint8Array; ext: string }> {
  const relativePath = item.relativePath?.trim()
  if (relativePath) {
    const url = await window.studio.getAssetFileUrl(relativePath)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = new Uint8Array(await response.arrayBuffer())
    return { data, ext: extensionFromPath(relativePath) }
  }
  const dataUrl = item.dataUrl?.trim()
  if (!dataUrl) throw new Error('empty image')
  if (dataUrl.startsWith('data:')) {
    const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i)
    if (!match) throw new Error('invalid data URL')
    const mime = match[1] || 'image/png'
    const isBase64 = !!match[2]
    const payload = match[3] || ''
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
    return { data, ext: extensionFromMime(mime) }
  }
  const response = await fetch(dataUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const mime = response.headers.get('content-type') || ''
  return {
    data,
    ext: mime.startsWith('image/') ? extensionFromMime(mime) : 'png'
  }
}

async function exportImagesBatch(): Promise<void> {
  const items = resolveExportImages()
  if (!items.length || exporting.value) return
  exporting.value = true
  try {
    const base = sanitizeFileBase(localTitle.value || outputLabel.value)
    const files: Array<{ fileName: string; data: Uint8Array }> = []
    for (const [index, item] of items.entries()) {
      const { data, ext } = await resolveImageBytes(item)
      files.push({
        fileName: `${base}-${String(index + 1).padStart(2, '0')}.${ext}`,
        data
      })
    }
    const result = await window.studio.saveBinaryFilesToDirectory({ files })
    if (!result) return
    flashExportMessage(t('graph.output.exportImagesSuccess', { n: result.written }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.output.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.output-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.type,
.hint {
  color: var(--text-muted);
  font-size: 11px;
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

label.row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

select,
input {
  font-size: 12px;
}

.export-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.export-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--success) 40%, var(--border));
  background: var(--bg-elevated);
  color: var(--success);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.export-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--success) 14%, var(--bg-elevated));
}

.export-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.export-btn .label {
  line-height: 1;
}

.icon-export {
  position: relative;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-top: none;
  border-radius: 0 0 2px 2px;
}

.icon-export::before {
  content: '';
  position: absolute;
  left: 50%;
  top: -5px;
  width: 1.5px;
  height: 7px;
  background: currentColor;
  transform: translateX(-50%);
}

.icon-export::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -1px;
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4px solid currentColor;
  transform: translateX(-50%);
}

.export-msg {
  font-size: 11px;
  color: #7dcea0;
  line-height: 1.35;
}

.export-msg.error {
  color: var(--danger, #e07070);
}

.value {
  color: var(--text);
  font-size: 11px;
}
</style>
