<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.framePull.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <div class="captured-summary">
      <span>{{ t('graph.inspector.framePull.captured', { n: frames.length }) }}</span>
      <span v-if="rangeInfo.valid" class="range-pill">
        {{
          t('graph.inspector.framePull.rangeBadge', {
            inFrame: rangeInfo.inFrame,
            outFrame: rangeInfo.outFrame,
            count: rangeInfo.frameCount,
            duration: rangeInfo.segmentDurationSec.toFixed(2)
          })
        }}
      </span>
    </div>

    <div v-if="spliceHistory.length > 0 || activeVideoPath" class="splice-card">
      <div class="splice-head">
        <span class="splice-status">
          {{ t('graph.inspector.framePull.splicedBanner', { n: spliceHistory.length || 1 }) }}
        </span>
        <button type="button" class="restore-btn" @click="restoreOriginal">
          {{ t('graph.inspector.framePull.restoreOriginal') }}
        </button>
      </div>
      <div v-if="spliceHistory.length > 0" class="splice-list">
        <div v-for="rec in spliceHistory" :key="rec.id" class="splice-row">
          <span class="splice-tag">
            {{
              t('graph.inspector.framePull.historyItemLabel', {
                inFrame: rec.inFrame,
                outFrame: rec.outFrame,
                duration: Math.max(0.1, rec.outSec - rec.inSec).toFixed(2)
              })
            }}
          </span>
          <span class="splice-desc">{{ rec.instruction || '—' }}</span>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  normalizeFramePullRange,
  type FramePullSpliceRecord,
  type GraphImageItem
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
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
  return current?.typeId === 'video.framePull' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const typeLabel = computed(() => graphTypeLabel('video.framePull'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)
const frames = computed<GraphImageItem[]>(() => node.value?.params.generatedImages ?? [])
const spliceHistory = computed<FramePullSpliceRecord[]>(
  () => node.value?.params.framePullSpliceHistory ?? []
)
const activeVideoPath = computed(() => node.value?.params.framePullActiveVideoPath ?? '')

const rangeInfo = computed(() =>
  normalizeFramePullRange({
    inFrame: node.value?.params.framePullInFrame,
    outFrame: node.value?.params.framePullOutFrame,
    totalFrames: node.value?.params.frameFilmstripTotalFrames,
    fps: node.value?.params.frameFilmstripFps
  })
)

function restoreOriginal(): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    framePullActiveVideoPath: undefined,
    framePullSpliceHistory: [],
    frameFilmstripKey: ''
  })
}

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
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

.captured-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.range-pill {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: #f59e0b;
  font-size: 11px;
  font-weight: 600;
}

.splice-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}

.splice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.splice-status {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}

.restore-btn {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.splice-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.splice-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.splice-tag {
  font-weight: 600;
  color: #f59e0b;
  white-space: nowrap;
}

.splice-desc {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
