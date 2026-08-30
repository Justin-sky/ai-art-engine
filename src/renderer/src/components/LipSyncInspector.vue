<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.lipSync.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview
      v-if="node && hostId"
      :node="node"
      :host-id="hostId"
    />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input
        v-model="localTitle"
        @change="persistTitle"
      >
    </label>

    <section class="gen-config">
      <label>
        {{ t('graph.inspector.generate.systemPrompt') }}
        <ExpandableTextarea
          :key="`sys-${node.id}`"
          v-model="systemPrompt"
          :title="t('graph.inspector.generate.systemPrompt')"
          :rows="4"
          :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
          @change="persistGenerateConfig"
        />
      </label>
      <p
        v-if="modelOptions.length === 0"
        class="hint"
      >
        {{ t('graph.inspector.generate.configureVideoModelsHint') }}
      </p>
      <p
        v-else
        class="field-hint"
      >
        {{ t('graph.inspector.lipSync.modelHint') }}
      </p>
    </section>
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_LIP_SYNC_SYSTEM_PROMPT_EN,
  DEFAULT_LIP_SYNC_SYSTEM_PROMPT_ZH,
  defaultLipSyncSystemPrompt,
  resolveLipSyncSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'video.lipSync' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('video.lipSync'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const localTitle = ref('')
const systemPrompt = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

async function loadModels(preferredKey?: string): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    'video',
    preferredKey,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

function loadGenerateConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  localTitle.value = current.title ?? ''
  systemPrompt.value = resolveLipSyncSystemPrompt(
    current.params.generateSystemPrompt,
    String(locale.value)
  )
  const preferred = preferredModelKey(
    current.params.generateProviderInstanceId,
    current.params.generateModel
  )
  void loadModels(preferred)
}

watch(
  node,
  (current) => {
    if (!current) {
      localTitle.value = ''
      systemPrompt.value = ''
      modelOptions.value = []
      selectedModelKey.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadGenerateConfig(current)
  },
  { immediate: true }
)

watch(locale, (next) => {
  if (!node.value) return
  const cur = systemPrompt.value.trim()
  if (!cur || isDefaultSystemPrompt(cur)) {
    systemPrompt.value = defaultLipSyncSystemPrompt(String(next))
  }
})

function isDefaultSystemPrompt(value: string): boolean {
  return (
    value === DEFAULT_LIP_SYNC_SYSTEM_PROMPT_EN || value === DEFAULT_LIP_SYNC_SYSTEM_PROMPT_ZH
  )
}

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value)
}

function persistGenerateConfig(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateSystemPrompt: systemPrompt.value
  })
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

.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.path-row {
  display: flex;
  gap: 6px;
}

.path-row input {
  flex: 1;
  min-width: 0;
}

.btn {
  flex-shrink: 0;
}

.gen-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
