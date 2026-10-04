<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>

    <p class="hint">{{ t('graph.portrait.hint') }}</p>

    <div class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorChanged') }}</span>
      <span class="stat-value">{{ changedCount }}</span>
    </div>
    <div v-if="regionCount" class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorRegions') }}</span>
      <span class="stat-value">{{ regionCount }}</span>
    </div>
    <div v-if="idPhotoSpec" class="stat">
      <span class="stat-label">{{ t('graph.portrait.fields.idPhotoSpecId') }}</span>
      <span class="stat-value">{{ t(`graph.portrait.options.${idPhotoSpec}`) }}</span>
    </div>
    <div v-if="riskCount" class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorRisk') }}</span>
      <span class="stat-value warn">{{ riskCount }}</span>
    </div>
    <div v-if="bakedPath" class="stat">
      <span class="stat-label">{{ t('graph.portrait.inspectorBaked') }}</span>
      <span class="stat-value path" :title="bakedPath">{{ bakedPath }}</span>
    </div>

    <!-- 输出预览：与其它节点共用同一套（缩略图 / 全屏 / 存资产库 / 多版本点选） -->
    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <div v-if="prompt" class="prompt-box">
      <span class="stat-label">{{ t('graph.portrait.promptPreview') }}</span>
      <p class="prompt-text">{{ prompt }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  changedPortraitParamCount,
  normalizePortraitRetouch,
  portraitHighRiskTierCount
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.portrait' ? current : null
})

/** 选中节点所属的图宿主：输出预览要按它去取 runStates / 图库 */
const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const typeLabel = computed(() => graphTypeLabel('image.portrait'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const changedCount = computed(() => {
  const current = node.value
  if (!current) return 0
  return changedPortraitParamCount(normalizePortraitRetouch(current.params.portraitRetouch))
})

const riskCount = computed(() => {
  const current = node.value
  if (!current) return 0
  return portraitHighRiskTierCount(normalizePortraitRetouch(current.params.portraitRetouch))
})

const regionCount = computed(
  () => normalizePortraitRetouch(node.value?.params.portraitRetouch).manualRegions.length
)
const idPhotoSpec = computed(() => {
  const value = node.value?.params.portraitRetouch?.idPhotoSpecId
  return value && value !== 'none' ? value : ''
})
const bakedPath = computed(() => node.value?.params.portraitBakedRelativePath?.trim() ?? '')
/** 最近一次 Cook 实际发给模型的提示词：让用户在节点上就能核对模型收到了什么 */
const prompt = computed(() => node.value?.params.portraitPrompt?.trim() ?? '')
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
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
}

.stat {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.stat-label {
  color: var(--text-muted);
}

.stat-value {
  color: var(--text);
}

.stat-value.path {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stat-value.warn {
  color: #f59e0b;
}

.prompt-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.prompt-text {
  margin: 0;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.7;
  word-break: break-word;
}
</style>
