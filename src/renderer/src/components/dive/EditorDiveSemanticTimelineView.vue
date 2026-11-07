<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  PRODUCTION_LABEL_META,
  applySemanticEdit,
  migrateSemanticTimeline,
  resolveShotDisplayPrompts,
  summarizeSemanticDiff,
  type SemanticEditInput,
  type SemanticTimeline,
  type ShotEvidence,
  type UtteranceEvidence
} from '@shared/semanticTimeline'
import SemanticTimelineEditor from '../SemanticTimelineEditor.vue'
import SemanticCompareView from '../SemanticCompareView.vue'
import SemanticBreakdownWorkspacePanels from './SemanticBreakdownWorkspacePanels.vue'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { SEMANTIC_REFERENCE_IMAGES_PORT_ID } from '@shared/graph/semanticTimelineNodes'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../../features/graph/model/graphRunHosts'
import { semanticTimelineSavePayload } from '../../features/graph/model/semanticTimelineSave'
import {
  candidatesFromSourceNode,
  mergeCandidates,
  type ReferenceCandidate
} from '../../features/graph/model/semanticReferenceCandidates'

const { t, locale } = useStudioI18n()

const props = defineProps<{
  frameKey: string
  timelineId: string
  sourceAssetId?: string
  sourceRelativePath?: string
  resultRelativePath?: string
  timelineJson?: string
  graphHostId?: string
  graphNodeId?: string
}>()

type WorkspaceTab = 'timeline' | 'remake' | 'audio' | 'report'
const activeTab = ref<WorkspaceTab>('timeline')
const editorRef = ref<InstanceType<typeof SemanticTimelineEditor> | null>(null)

const timeline = ref<SemanticTimeline | null>(null)
const error = ref('')
const hint = ref('')
const missingPath = ref('')
const originalUrl = ref('')
const resultUrl = ref('')
const compareVideoUrl = ref('')

const isEn = computed(() => locale.value.toLowerCase().startsWith('en'))
const timelineId = computed(() => props.timelineId?.trim() ?? '')

function parseInline(raw: string | undefined): SemanticTimeline | null {
  const text = raw?.trim()
  if (!text) return null
  try {
    const doc = JSON.parse(text) as SemanticTimeline
    if (doc && typeof doc === 'object' && typeof doc.id === 'string') return doc
  } catch {
    /* not json */
  }
  return null
}

function resolvedSourceRelativePath(doc: SemanticTimeline | null): string {
  const explicit = props.sourceRelativePath?.trim()
  if (explicit) return explicit
  const assetId = (doc?.source?.assetId ?? props.sourceAssetId ?? '').trim()
  if (assetId.startsWith('path:')) return assetId.slice('path:'.length).trim()
  const host = props.graphHostId?.trim()
  const nodeId = props.graphNodeId?.trim()
  if (host && nodeId) {
    const selfNode = graphEditorHosts.getNode(host, nodeId)
    const ownRel = String(selfNode?.params?.sourceRelativePath ?? '').trim()
    if (ownRel) return ownRel
    const runStates = graphRunHosts.get(host)?.runStates
    for (const edge of graphEditorHosts.listIncomingEdges(host, nodeId, 'in')) {
      const source = graphEditorHosts.getNode(host, edge.sourceNodeId)
      if (!source) continue
      const out = runStates?.[source.id]?.outputs?.[edge.sourcePort || 'out']
      if (out && out.kind === 'video' && out.relativePath?.trim()) return out.relativePath.trim()
      const previewRel = String(
        source.params?.previewRelativePath ?? source.params?.sourceRelativePath ?? ''
      ).trim()
      if (previewRel) return previewRel
    }
  }
  return ''
}

function findDownstreamRebuildNodeId(): string | null {
  const host = props.graphHostId?.trim()
  const startId = props.graphNodeId?.trim()
  if (!host || !startId) return null
  const selfNode = graphEditorHosts.getNode(host, startId)
  if (selfNode?.typeId === 'semantic.rebuild') return selfNode.id
  const edges = graphEditorHosts.listEdges(host)
  const nodes = graphEditorHosts.listNodes(host)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const edge of edges) {
      if (edge.source !== curr || visited.has(edge.target)) continue
      visited.add(edge.target)
      queue.push(edge.target)
      const targetNode = byId.get(edge.target)
      if (targetNode?.typeId === 'semantic.rebuild') return targetNode.id
    }
  }
  return null
}

function discoverDownstreamRemakePaths(): { outputRel: string; compareRel: string } {
  const explicitOut = props.resultRelativePath?.trim() ?? ''
  const host = props.graphHostId?.trim()
  const rebuildId = findDownstreamRebuildNodeId()
  if (!host || !rebuildId) {
    return { outputRel: explicitOut, compareRel: '' }
  }
  const targetNode = graphEditorHosts.getNode(host, rebuildId)
  if (!targetNode) return { outputRel: explicitOut, compareRel: '' }
  const runOut = graphRunHosts.get(host)?.runStates?.[targetNode.id]?.outputs?.['out-video']
  const outputRel =
    explicitOut ||
    (runOut && runOut.kind === 'video' && runOut.relativePath?.trim()
      ? runOut.relativePath.trim()
      : String(targetNode.params?.rebuildLastOutput ?? '').trim())
  const compareRel = String(targetNode.params?.rebuildLastCompare ?? '').trim()
  return { outputRel, compareRel }
}

async function load(): Promise<void> {
  error.value = ''
  hint.value = ''
  missingPath.value = ''
  timeline.value = null
  originalUrl.value = ''
  resultUrl.value = ''
  compareVideoUrl.value = ''

  const inline = parseInline(props.timelineJson)
  if (inline) {
    timeline.value = inline
    const disk = await readDiskTimeline(inline.id)
    if (disk && isNewerDoc(disk, inline)) timeline.value = disk
  } else {
    const id = timelineId.value
    if (!id) {
      hint.value = t('graph.semanticTimeline.noTimelineHint')
      return
    }
    const rel = `Semantic/${id}/timeline.json`
    try {
      const text = await window.studio.readProjectFile(rel)
      if (text?.trim()) {
        timeline.value = JSON.parse(text) as SemanticTimeline
      }
      if (!timeline.value) {
        error.value = t('graph.semanticTimeline.timelineFileMissing')
        missingPath.value = rel
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      missingPath.value = rel
    }
  }

  if (timeline.value) timeline.value = await toV2(timeline.value)

  try {
    const srcRel = resolvedSourceRelativePath(timeline.value)
    if (srcRel) {
      originalUrl.value = (await window.studio.getAssetFileUrl(srcRel)) ?? ''
    }
    const { outputRel, compareRel } = discoverDownstreamRemakePaths()
    if (outputRel) {
      resultUrl.value = (await window.studio.getAssetFileUrl(outputRel)) ?? ''
    }
    if (compareRel) {
      compareVideoUrl.value = (await window.studio.getAssetFileUrl(compareRel)) ?? ''
    }
  } catch {
    /* preview urls optional */
  }
}

async function readDiskTimeline(id: string | undefined): Promise<SemanticTimeline | null> {
  const stl = id?.trim()
  if (!stl?.startsWith('stl.')) return null
  try {
    const text = await window.studio.readProjectFile(`Semantic/${stl}/timeline.json`)
    return text?.trim() ? (JSON.parse(text) as SemanticTimeline) : null
  } catch {
    return null
  }
}

function isNewerDoc(a: SemanticTimeline, b: SemanticTimeline): boolean {
  const ea = a.edits?.length ?? 0
  const eb = b.edits?.length ?? 0
  if (ea !== eb) return ea > eb
  const ta = Date.parse(a.updatedAt ?? '')
  const tb = Date.parse(b.updatedAt ?? '')
  return Number.isFinite(ta) && Number.isFinite(tb) && ta > tb
}

async function toV2(doc: SemanticTimeline): Promise<SemanticTimeline> {
  if ((doc.shots?.length ?? 0) > 0 && doc.baseline) return migrateSemanticTimeline(doc)
  let evidence: { shots?: ShotEvidence[]; utterances?: UtteranceEvidence[] } = {}
  if (doc.id && window.studio.semanticLoadEvidence) {
    try {
      const ev = await window.studio.semanticLoadEvidence(doc.id)
      evidence = { shots: ev?.shots ?? [], utterances: ev?.utterances ?? [] }
    } catch {
      /* fallback without evidence */
    }
  }
  return migrateSemanticTimeline(doc, evidence)
}

const editError = ref('')
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const saveState = ref<SaveState>('idle')

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function applyEdit(input: SemanticEditInput): void {
  const current = timeline.value
  if (!current) return
  editError.value = ''
  try {
    timeline.value = applySemanticEdit(current, input)
  } catch (e) {
    editError.value = errorText(e)
    return
  }
  scheduleSave()
}

let saveChain: Promise<void> = Promise.resolve()
let saveQueued = false

function scheduleSave(): void {
  saveState.value = 'saving'
  if (saveQueued) return
  saveQueued = true
  saveChain = saveChain.then(async () => {
    saveQueued = false
    const doc = timeline.value
    if (!doc) return
    try {
      await window.studio.semanticSaveTimeline(semanticTimelineSavePayload(doc))
      if (!saveQueued) saveState.value = 'saved'
    } catch (e) {
      saveState.value = 'error'
      editError.value = `${t('graph.semanticInspector.saveFailed')}${errorText(e)}`
      const disk = await readDiskTimeline(doc.id)
      if (disk) {
        timeline.value = await toV2(disk)
        editError.value += ` ${t('graph.semanticInspector.reloaded')}`
      }
    }
  })
}

const editSummary = computed(() => {
  const doc = timeline.value
  if (!doc) return null
  const s = summarizeSemanticDiff(doc)
  return { shots: s.dirtyShots, removed: s.removedShots, lines: s.dirtyDialogue }
})

const saveLabel = computed(() =>
  saveState.value === 'saving'
    ? t('graph.semanticInspector.saving')
    : saveState.value === 'saved'
      ? t('graph.semanticInspector.saved')
      : ''
)

onMounted(() => {
  void load()
})

const referenceCandidates = computed(() => {
  const host = props.graphHostId?.trim()
  const nodeId = props.graphNodeId?.trim()
  const fromPort: ReferenceCandidate[] = []
  if (host && nodeId) {
    const runStates = graphRunHosts.get(host)?.runStates
    for (const edge of graphEditorHosts.listIncomingEdges(
      host,
      nodeId,
      SEMANTIC_REFERENCE_IMAGES_PORT_ID
    )) {
      const source = graphEditorHosts.getNode(host, edge.sourceNodeId)
      if (!source) continue
      fromPort.push(...candidatesFromSourceNode(source, runStates?.[source.id], edge.sourcePort))
    }
  }
  return mergeCandidates(fromPort)
})

watch(
  () => [
    props.timelineId,
    props.timelineJson,
    props.sourceRelativePath,
    props.resultRelativePath,
    graphEditorHosts.revision.value
  ],
  () => {
    void load()
  }
)

const promptByShot = computed((): Record<string, string> =>
  timeline.value ? resolveShotDisplayPrompts(timeline.value) : {}
)

const activeShotIds = computed(() =>
  (timeline.value?.shots ?? []).filter((s) => !s.removed).map((s) => s.id)
)

function handleRerunShot(shotId: string): void {
  const id = shotId.trim()
  if (!id) return
  const host = props.graphHostId?.trim()
  const rebuildNodeId = findDownstreamRebuildNodeId()
  if (!host || !rebuildNodeId) return
  const runHost = graphRunHosts.get(host)
  if (!runHost || runHost.isRunning.value) return
  graphEditorHosts.updateNode(host, rebuildNodeId, { rebuildOnlyShotIds: id })
  void runHost.runToNode(rebuildNodeId)
}

const breakdownSummary = computed(() => timeline.value?.breakdown?.summary)
const provenanceBadges = computed(() => {
  const p = timeline.value?.breakdown?.provenance
  if (!p) return []
  const list: string[] = []
  if (p.aigcImplicitLabel?.label) {
    list.push(
      `${t('graph.semanticTimeline.rea.provenanceAigc')}${p.aigcImplicitLabel.contentProducer ? ` (${p.aigcImplicitLabel.contentProducer})` : ''}`
    )
  }
  if (p.hasC2pa) list.push(t('graph.semanticTimeline.rea.provenanceC2pa'))
  if (p.generatorHint) {
    list.push(t('graph.semanticTimeline.rea.provenanceGen', { v: p.generatorHint }))
  }
  if (p.editorHint) {
    list.push(t('graph.semanticTimeline.rea.provenanceEditor', { v: p.editorHint }))
  }
  if (p.make || p.model) {
    list.push(
      t('graph.semanticTimeline.rea.provenanceCamera', {
        v: [p.make, p.model].filter(Boolean).join(' ')
      })
    )
  }
  if (p.platformTranscode) {
    list.push(t('graph.semanticTimeline.rea.provenancePlatform', { v: p.platformTranscode }))
  }
  return list
})

const openQuestions = computed(() => timeline.value?.breakdown?.wholeVideo?.openQuestions ?? [])

function handleSeekFromSubPanel(sec: number): void {
  activeTab.value = 'timeline'
  void nextTick(() => {
    editorRef.value?.seekTo(sec)
  })
}
</script>

<template>
  <div class="dive-semantic dive-view">
    <p v-if="error" class="err">
      {{ error }}
      <span v-if="missingPath" class="path">{{ missingPath }}</span>
    </p>
    <div v-else-if="hint" class="hint">
      <p>{{ hint }}</p>
      <p class="hint-sub">{{ t('graph.semanticTimeline.noTimelineHintSub') }}</p>
    </div>

    <template v-if="timeline">
      <!-- Top 4-Axis Forensic Verdict & Mode Tabs -->
      <div class="verdict-shell">
        <div v-if="breakdownSummary" class="verdict-top">
          <span class="verdict-badge">{{ t('graph.semanticTimeline.rea.verdictLabel') }}</span>
          <strong class="verdict-text">
            {{ isEn ? breakdownSummary.verdictEn : breakdownSummary.verdict }}
          </strong>
          <span class="verdict-conf">
            {{
              t('graph.semanticTimeline.rea.confidenceLabel', {
                pct: Math.round(breakdownSummary.confidence * 100)
              })
            }}
          </span>

          <div class="mix-pills">
            <span
              v-for="m in breakdownSummary.productionMix"
              :key="m.label"
              class="mix-pill"
              :style="{
                '--mix-color': PRODUCTION_LABEL_META[m.label]?.color ?? '#457b9d'
              }"
            >
              <i class="mix-dot" />
              {{ isEn ? m.labelEn : m.labelZh }} {{ Math.round(m.ratio * 100) }}%
            </span>
          </div>

          <div v-if="provenanceBadges.length" class="prov-pills">
            <span v-for="(badge, idx) in provenanceBadges" :key="idx" class="prov-pill">
              {{ badge }}
            </span>
          </div>
        </div>

        <details v-if="openQuestions.length" class="open-questions">
          <summary>
            {{ t('graph.semanticTimeline.rea.openQuestionsTitle', { n: openQuestions.length }) }}
          </summary>
          <ul>
            <li v-for="(q, idx) in openQuestions" :key="idx">{{ q }}</li>
          </ul>
        </details>

        <div class="workspace-bar">
          <nav class="mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: activeTab === 'timeline' }"
              @click="activeTab = 'timeline'"
            >
              {{ t('graph.semanticTimeline.rea.tabTimeline') }}
            </button>
            <button
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: activeTab === 'remake' }"
              @click="activeTab = 'remake'"
            >
              {{ t('graph.semanticTimeline.rea.tabRemakePlan') }}
            </button>
            <button
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: activeTab === 'audio' }"
              @click="activeTab = 'audio'"
            >
              {{ t('graph.semanticTimeline.rea.tabAudioLayers') }}
            </button>
            <button
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: activeTab === 'report' }"
              @click="activeTab = 'report'"
            >
              {{ t('graph.semanticTimeline.rea.tabReportCompare') }}
            </button>
          </nav>

          <div v-if="editSummary" class="edit-status" role="status" aria-live="polite">
            <span class="edit-bar-title">{{ t('graph.semanticEdit.title') }}</span>
            <span class="edit-bar-summary">{{ t('graph.semanticEdit.summary', editSummary) }}</span>
            <span v-if="saveLabel" class="edit-bar-save">{{ saveLabel }}</span>
          </div>
        </div>

        <p v-if="editError" class="edit-bar-err" role="alert">{{ editError }}</p>
      </div>

      <!-- Mode 1: Multi-Track Editor & Per-Shot Forensic Inspector -->
      <template v-if="activeTab === 'timeline'">
        <SemanticTimelineEditor
          ref="editorRef"
          :timeline="timeline"
          :prompt-by-shot="promptByShot"
          :reference-candidates="referenceCandidates"
          @edit="applyEdit"
        />
        <SemanticCompareView
          v-if="originalUrl && resultUrl"
          class="compare"
          :original-url="originalUrl"
          :result-url="resultUrl"
          :compare-video-url="compareVideoUrl"
          :shot-ids="activeShotIds"
          @rerun-shot="handleRerunShot"
        />
      </template>

      <!-- Modes 2-4: Remake Plan / Sound & Packaging / Report & Compare -->
      <SemanticBreakdownWorkspacePanels
        v-else
        :mode="activeTab"
        :timeline="timeline"
        :source-relative-path="resolvedSourceRelativePath(timeline)"
        :original-url="originalUrl"
        :result-url="resultUrl"
        :compare-video-url="compareVideoUrl"
        @seek-and-switch-timeline="handleSeekFromSubPanel"
        @edit="applyEdit"
        @rerun-shot="handleRerunShot"
      />
    </template>
  </div>
</template>

<style scoped>
.dive-semantic {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow: auto;
  padding: 8px;
}
.err {
  color: #f87171;
  font-size: 13px;
}
.err .path {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-family: Consolas, monospace;
  font-size: 12px;
}
.hint {
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
}
.hint-sub {
  color: var(--text-muted);
  font-size: 12px;
}
.verdict-shell {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  font-size: 12px;
}
.verdict-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.verdict-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  color: var(--text);
  font-weight: 600;
  font-size: 11px;
}
.verdict-text {
  color: var(--text);
  font-size: 13px;
}
.verdict-conf {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mix-pills,
.prov-pills {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.mix-pill,
.prov-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
}
.mix-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mix-color);
}
.prov-pill {
  color: var(--text-muted);
}
.open-questions {
  font-size: 12px;
  color: var(--text-muted);
  border-top: 1px dashed var(--border);
  padding-top: 6px;
}
.open-questions summary {
  cursor: pointer;
  font-weight: 600;
  color: #f4a261;
}
.open-questions ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
.workspace-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.mode-tabs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mode-tab {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}
.mode-tab:hover {
  color: var(--text);
}
.mode-tab.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  border-color: var(--accent);
  color: var(--text);
  font-weight: 600;
}
.edit-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.edit-bar-title {
  font-weight: 600;
  color: var(--text);
}
.edit-bar-summary,
.edit-bar-save {
  color: var(--text-muted);
}
.edit-bar-err {
  margin: 0;
  color: #f87171;
}
.compare {
  min-height: 220px;
  flex: 0 0 auto;
}
</style>
