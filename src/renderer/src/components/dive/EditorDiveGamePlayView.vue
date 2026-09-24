<template>
  <div class="dive-view game-play-dive">
    <header class="toolbar">
      <span class="mode" :title="modeLabel">{{ modeLabel }}</span>
      <span v-if="pathHint" class="path" :title="pathHint">{{ pathHint }}</span>
      <span class="spacer" />
      <button type="button" :disabled="!html" @click="showSource = !showSource">
        {{
          showSource ? t('studio.dive.gamePlay.hideSource') : t('studio.dive.gamePlay.showSource')
        }}
      </button>
      <button type="button" :disabled="!html || loading" @click="reload">
        {{ t('studio.dive.gamePlay.reload') }}
      </button>
      <button type="button" class="done" @click="onClose">
        {{ t('studio.dive.gamePlay.done') }}
      </button>
    </header>

    <p v-if="loading" class="empty">{{ t('studio.dive.gamePlay.loading') }}</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="!html" class="empty">{{ t('studio.dive.gamePlay.empty') }}</p>

    <div v-else class="body">
      <iframe
        v-show="!showSource"
        :key="reloadKey"
        class="sandbox"
        title="game-play-sandbox"
        sandbox="allow-scripts allow-pointer-lock"
        :src="frameSrc || 'about:blank'"
      />
      <pre v-show="showSource" class="source">{{ html }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GraphNode, GraphNodeParams } from '@shared/graph'
import {
  detectGamePlayMode,
  injectThreeIntoHtml,
  prepareGameHtml,
  resolvePreferredGamePlayMode
} from '@shared/gamePlay'
import threeModuleSource from 'virtual:three-module-source'
import threeCoreSource from 'virtual:three-core-source'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { closeGamePlaySandboxDialog } from '../../features/media/gamePlaySandboxDialog'
import { readGraphRunText } from '../../features/graph/readGraphRunText'
import { useProjectStore } from '../../stores/project'

const props = defineProps<{
  frameKey: string
  hostId?: string
  nodeId?: string
  gamePlayAssetId?: string
  /** 浮窗模式：完成按钮关对话框而非 dive.pop */
  dialogMode?: boolean
}>()

const { t } = useI18n()
const editorDive = inject(editorDiveKey, null)
const project = useProjectStore()

const reloadKey = ref(0)
const showSource = ref(false)
const error = ref('')
const html = ref('')
const frameSrc = ref('')
const pathHint = ref('')
const loading = ref(false)
const mode = ref<'2d' | '3d'>('2d')
let loadSeq = 0
let activeDocUrl = ''

const modeLabel = computed(() =>
  mode.value === '3d' ? t('studio.dive.gamePlay.mode3d') : t('studio.dive.gamePlay.mode2d')
)

function buildPlayableHtml(source: string, playMode: '2d' | '3d'): string {
  if (playMode !== '3d') return source
  try {
    return injectThreeIntoHtml(source, threeModuleSource, threeCoreSource)
  } catch {
    return source
  }
}

async function releaseActiveDoc(): Promise<void> {
  const url = activeDocUrl
  activeDocUrl = ''
  frameSrc.value = ''
  if (!url) return
  try {
    await window.studio.releaseGameplayDocument(url)
  } catch {
    // ignore
  }
}

async function publishFrame(source: string, playMode: '2d' | '3d', seq: number): Promise<void> {
  const doc = buildPlayableHtml(source, playMode)
  if (!doc.trim()) {
    await releaseActiveDoc()
    return
  }
  const url = await window.studio.openGameplayDocument(doc)
  if (seq !== loadSeq) {
    try {
      await window.studio.releaseGameplayDocument(url)
    } catch {
      // ignore
    }
    return
  }
  const prev = activeDocUrl
  activeDocUrl = url
  frameSrc.value = url
  if (prev && prev !== url) {
    try {
      await window.studio.releaseGameplayDocument(prev)
    } catch {
      // ignore
    }
  }
}

type RawHtml = { html: string; path: string; preferred: '2d' | '3d' | 'auto' }

async function hydrateFromPath(path: string): Promise<string> {
  const p = path.trim()
  if (!p) return ''
  try {
    return (await readGraphRunText(p))?.trim() || ''
  } catch {
    return ''
  }
}

async function resolveFromParams(params: GraphNodeParams | undefined | null): Promise<RawHtml> {
  const preferred = resolvePreferredGamePlayMode(params?.gamePlayMode)
  let path = params?.gamePlayHtmlPath?.trim() || params?.gamePlayBuildHtmlPath?.trim() || ''
  // 优先落盘路径，避免节点 params 里残留巨大 HTML 字符串
  let htmlBody = path ? await hydrateFromPath(path) : ''
  if (!htmlBody) {
    htmlBody = params?.gamePlayHtml?.trim() || params?.text?.trim() || ''
  }
  if (!htmlBody && Array.isArray(params?.generatedTexts) && params.generatedTexts.length) {
    const selectedId = params.selectedTextId?.trim()
    const items = params.generatedTexts
    const picked =
      (selectedId ? items.find((item) => item.id === selectedId) : undefined) ??
      items[items.length - 1]
    if (picked) {
      htmlBody = picked.text?.trim() || ''
      const itemPath = picked.relativePath?.trim() || ''
      if (itemPath) path = path || itemPath
      if (!htmlBody && itemPath) htmlBody = await hydrateFromPath(itemPath)
    }
  }
  return { html: htmlBody, path, preferred }
}

async function resolveFromNode(node: GraphNode | null | undefined): Promise<RawHtml> {
  if (!node) return { html: '', path: '', preferred: 'auto' }
  return resolveFromParams(node.params)
}

async function resolveUpstream(hostId: string, nodeId: string): Promise<RawHtml> {
  const incoming = graphEditorHosts.listIncomingEdges(hostId, nodeId)
  for (const edge of incoming) {
    const src = graphEditorHosts.getNode(hostId, edge.sourceNodeId)
    const resolved = await resolveFromNode(src)
    if (resolved.html.trim()) return resolved
  }
  return { html: '', path: '', preferred: 'auto' }
}

async function readRawHtml(): Promise<RawHtml> {
  if (props.gamePlayAssetId) {
    const asset = project.assets.find((a) => a.id === props.gamePlayAssetId)
    return resolveFromParams((asset?.genParams ?? {}) as GraphNodeParams)
  }
  const hostId = props.hostId?.trim()
  const nodeId = props.nodeId?.trim()
  if (!hostId || !nodeId) return { html: '', path: '', preferred: 'auto' }
  void graphEditorHosts.revision.value
  const local = await resolveFromNode(graphEditorHosts.getNode(hostId, nodeId))
  if (local.html.trim()) return local
  // 未 cook 的可玩节点：回退上游 game.htmlGen 的全文 / 落盘路径
  const upstream = await resolveUpstream(hostId, nodeId)
  if (upstream.html.trim()) {
    return {
      html: upstream.html,
      path: upstream.path || local.path,
      preferred: local.preferred !== 'auto' ? local.preferred : upstream.preferred
    }
  }
  return local
}

async function load(): Promise<void> {
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const raw = await readRawHtml()
    if (seq !== loadSeq) return
    pathHint.value = raw.path
    if (!raw.html.trim()) {
      html.value = ''
      await releaseActiveDoc()
      return
    }
    let nextHtml = raw.html
    let nextMode: '2d' | '3d' = detectGamePlayMode(raw.html, raw.preferred)
    try {
      const prepared = prepareGameHtml(raw.html, raw.preferred)
      nextHtml = prepared.html
      nextMode = prepared.mode
    } catch (e) {
      // 已落盘但不完全合规时仍尝试试玩
      error.value = e instanceof Error ? e.message : String(e)
    }
    html.value = nextHtml
    mode.value = nextMode
    try {
      await publishFrame(nextHtml, nextMode, seq)
    } catch (e) {
      if (seq !== loadSeq) return
      error.value = e instanceof Error ? e.message : String(e)
      await releaseActiveDoc()
    }
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function reload(): Promise<void> {
  await load()
  reloadKey.value += 1
}

function onClose(): void {
  void releaseActiveDoc()
  if (props.dialogMode) {
    closeGamePlaySandboxDialog()
    return
  }
  editorDive?.popTo(-1)
}

onBeforeUnmount(() => {
  void releaseActiveDoc()
})

watch(
  () =>
    [
      props.hostId,
      props.nodeId,
      props.gamePlayAssetId,
      props.frameKey,
      graphEditorHosts.revision.value
    ] as const,
  () => {
    void load().then(() => {
      reloadKey.value += 1
    })
  },
  { immediate: true }
)
</script>

<style scoped>
.game-play-dive {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.toolbar button {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: inherit;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}
.toolbar button.done {
  background: color-mix(in srgb, var(--accent, #3498db) 20%, transparent);
  border-color: color-mix(in srgb, var(--accent, #3498db) 45%, transparent);
}
.mode {
  font-size: 12px;
  opacity: 0.85;
}
.path {
  font-size: 11px;
  opacity: 0.55;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.error,
.empty {
  margin: 12px;
  font-size: 13px;
  opacity: 0.85;
}
.error {
  color: var(--danger, #c0392b);
}
.body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.sandbox,
.source {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  margin: 0;
}
.source {
  padding: 12px;
  overflow: auto;
  background: var(--bg-input);
  color: var(--fg-soft);
  font:
    12px/1.45 ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
