<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.generate.hint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="localTitle" @change="persist" />
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
      <p v-if="modelOptions.length === 0" class="hint">{{ modelsHint }}</p>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_BEAT_SPLIT_SYSTEM_PROMPT_EN,
  DEFAULT_BEAT_SPLIT_SYSTEM_PROMPT_ZH,
  DEFAULT_BEAT_UNIT_GEN_SYSTEM_PROMPT_EN,
  DEFAULT_BEAT_UNIT_GEN_SYSTEM_PROMPT_ZH,
  DEFAULT_OPTIMIZE_SYSTEM_PROMPT_EN,
  DEFAULT_OPTIMIZE_SYSTEM_PROMPT_ZH,
  DEFAULT_WORLD_EXTRACT_SYSTEM_PROMPT_EN,
  DEFAULT_WORLD_EXTRACT_SYSTEM_PROMPT_ZH,
  DEFAULT_TO_PROMPT_SYSTEM_PROMPT_EN,
  DEFAULT_TO_PROMPT_SYSTEM_PROMPT_ZH,
  DEFAULT_UI_SPLIT_SYSTEM_PROMPT_EN,
  DEFAULT_UI_SPLIT_SYSTEM_PROMPT_ZH,
  defaultBeatSplitSystemPrompt,
  defaultBeatUnitGenSystemPrompt,
  defaultOptimizeSystemPrompt,
  defaultWorldExtractSystemPrompt,
  defaultToPromptSystemPrompt,
  defaultUiSplitSystemPrompt,
  resolveBeatSplitSystemPrompt,
  resolveBeatUnitGenSystemPrompt,
  resolveOptimizeSystemPrompt,
  resolveWorldExtractSystemPrompt,
  resolveToPromptSystemPrompt,
  resolveUiSplitSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelModality,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { useProjectStore } from '../stores/project'

const TOOL_TYPE_IDS = new Set([
  'prompt.optimize',
  'image.toPrompt',
  'world.extract',
  'beat.split',
  'beat.unitGen',
  'ui.split'
])

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current?.typeId || !TOOL_TYPE_IDS.has(current.typeId)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const isToPrompt = computed(() => node.value?.typeId === 'image.toPrompt')
const isWorldExtract = computed(() => node.value?.typeId === 'world.extract')
const isBeatSplit = computed(() => node.value?.typeId === 'beat.split')
const isBeatUnitGen = computed(() => node.value?.typeId === 'beat.unitGen')
const isUiSplit = computed(() => node.value?.typeId === 'ui.split')

const typeLabel = computed(() => {
  if (node.value?.typeId) return graphTypeLabel(node.value.typeId)
  if (isToPrompt.value) return t('graph.types.image.toPrompt')
  if (isWorldExtract.value) return t('graph.types.world.extract')
  if (isBeatSplit.value) return t('graph.types.beat.split')
  if (isBeatUnitGen.value) return t('graph.types.beat.unitGen')
  if (isUiSplit.value) return t('graph.types.ui.split')
  return t('graph.types.prompt.optimize')
})

const modelModality = computed((): GenerateModelModality => 'text')

const modelsHint = computed(() => t('graph.inspector.generate.configureModelsHint'))

const localTitle = ref('')
const systemPrompt = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

async function loadModels(preferredKey?: string): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    modelModality.value,
    preferredKey,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

function resolveSystemPrompt(raw: string | undefined, nextLocale: string): string {
  if (isToPrompt.value) return resolveToPromptSystemPrompt(raw, nextLocale)
  if (isWorldExtract.value) return resolveWorldExtractSystemPrompt(raw, nextLocale)
  if (isBeatSplit.value) {
    const trimmed = raw?.trim() ?? ''
    // 曾误绑「提示词优化」默认文案：视为未配置，改回场拆解默认
    if (
      trimmed === DEFAULT_OPTIMIZE_SYSTEM_PROMPT_EN ||
      trimmed === DEFAULT_OPTIMIZE_SYSTEM_PROMPT_ZH
    ) {
      return defaultBeatSplitSystemPrompt(nextLocale)
    }
    return resolveBeatSplitSystemPrompt(raw, nextLocale)
  }
  if (isBeatUnitGen.value) {
    const trimmed = raw?.trim() ?? ''
    if (
      trimmed === DEFAULT_OPTIMIZE_SYSTEM_PROMPT_EN ||
      trimmed === DEFAULT_OPTIMIZE_SYSTEM_PROMPT_ZH
    ) {
      return defaultBeatUnitGenSystemPrompt(nextLocale)
    }
    return resolveBeatUnitGenSystemPrompt(raw, nextLocale)
  }
  if (isUiSplit.value) return resolveUiSplitSystemPrompt(raw, nextLocale)
  return resolveOptimizeSystemPrompt(raw, nextLocale)
}

function defaultSystemPrompt(nextLocale: string): string {
  if (isToPrompt.value) return defaultToPromptSystemPrompt(nextLocale)
  if (isWorldExtract.value) return defaultWorldExtractSystemPrompt(nextLocale)
  if (isBeatSplit.value) return defaultBeatSplitSystemPrompt(nextLocale)
  if (isBeatUnitGen.value) return defaultBeatUnitGenSystemPrompt(nextLocale)
  if (isUiSplit.value) return defaultUiSplitSystemPrompt(nextLocale)
  return defaultOptimizeSystemPrompt(nextLocale)
}

function isDefaultSystemPrompt(value: string): boolean {
  if (isToPrompt.value) {
    return (
      value === DEFAULT_TO_PROMPT_SYSTEM_PROMPT_EN || value === DEFAULT_TO_PROMPT_SYSTEM_PROMPT_ZH
    )
  }
  if (isWorldExtract.value) {
    return (
      value === DEFAULT_WORLD_EXTRACT_SYSTEM_PROMPT_EN ||
      value === DEFAULT_WORLD_EXTRACT_SYSTEM_PROMPT_ZH
    )
  }
  if (isBeatSplit.value) {
    return (
      value === DEFAULT_BEAT_SPLIT_SYSTEM_PROMPT_EN ||
      value === DEFAULT_BEAT_SPLIT_SYSTEM_PROMPT_ZH
    )
  }
  if (isBeatUnitGen.value) {
    return (
      value === DEFAULT_BEAT_UNIT_GEN_SYSTEM_PROMPT_EN ||
      value === DEFAULT_BEAT_UNIT_GEN_SYSTEM_PROMPT_ZH
    )
  }
  if (isUiSplit.value) {
    return (
      value === DEFAULT_UI_SPLIT_SYSTEM_PROMPT_EN || value === DEFAULT_UI_SPLIT_SYSTEM_PROMPT_ZH
    )
  }
  return value === DEFAULT_OPTIMIZE_SYSTEM_PROMPT_EN || value === DEFAULT_OPTIMIZE_SYSTEM_PROMPT_ZH
}

function loadGenerateConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  systemPrompt.value = resolveSystemPrompt(current.params.generateSystemPrompt, String(locale.value))
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
    localTitle.value = current.title ?? typeLabel.value
    const sameNode =
      current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadGenerateConfig(current)
  },
  { immediate: true }
)

watch(
  () => project.sessionEpoch,
  () => {
    loadedNodeId.value = null
    loadedHostId.value = null
  }
)

watch(
  () =>
    [
      node.value?.params.generateProviderInstanceId,
      node.value?.params.generateModel
    ] as const,
  ([providerInstanceId, model]) => {
    const key = preferredModelKey(providerInstanceId, model)
    if (key && key !== selectedModelKey.value && modelOptions.value.some((o) => o.key === key)) {
      selectedModelKey.value = key
    }
  }
)

watch(locale, (next) => {
  const cur = systemPrompt.value.trim()
  if (!cur || isDefaultSystemPrompt(cur)) {
    systemPrompt.value = defaultSystemPrompt(String(next))
  }
})

function persist(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value.trim())
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

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 6px 0 0;
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

select,
input,
textarea,
:deep(textarea) {
  font-size: 12px;
}

.gen-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  margin-top: 4px;
}
</style>
