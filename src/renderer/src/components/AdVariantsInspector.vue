<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.adVariants.hint') }}
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
      {{ t('graph.adVariants.product') }}
      <ExpandableTextarea
        :key="`product-${node.id}`"
        v-model="product"
        :title="t('graph.adVariants.product')"
        :rows="3"
        :placeholder="t('graph.adVariants.productPlaceholder')"
        @change="persistProduct"
      />
    </label>

    <label>
      {{ t('graph.adVariants.aspectRatio') }}
      <input
        v-model="aspectRatio"
        class="aspect-input"
        type="text"
        :placeholder="t('graph.adVariants.aspectRatioPlaceholder')"
        @change="persistAspectRatio"
      >
    </label>

    <label>
      {{ t('graph.inspector.generate.systemPrompt') }}
      <ExpandableTextarea
        :key="`sys-${node.id}`"
        v-model="systemPrompt"
        :title="t('graph.inspector.generate.systemPrompt')"
        :rows="4"
        :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>
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
  DEFAULT_AD_VARIANT_SYSTEM_PROMPT_EN,
  DEFAULT_AD_VARIANT_SYSTEM_PROMPT_ZH,
  defaultAdVariantSystemPrompt,
  readAdVariantMatrixFromNode,
  resolveAdVariantSystemPrompt,
  type AdVariantMatrix
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.adVariants' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const typeLabel = computed(() => graphTypeLabel('image.adVariants'))

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const product = ref('')
const aspectRatio = ref('')
const systemPrompt = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

function rawMatrix(): Partial<AdVariantMatrix> {
  const raw = node.value?.params?.adVariantMatrix
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Partial<AdVariantMatrix>)
    : {}
}

function loadConfig(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  const matrix = readAdVariantMatrixFromNode(current.params)
  product.value = matrix.product
  aspectRatio.value = matrix.aspectRatio ?? ''
  systemPrompt.value = resolveAdVariantSystemPrompt(
    current.params.generateSystemPrompt,
    String(locale.value)
  )
}

watch(
  node,
  (current) => {
    if (!current) {
      product.value = ''
      aspectRatio.value = ''
      systemPrompt.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadConfig(current)
  },
  { immediate: true }
)

watch(locale, (next) => {
  if (!node.value) return
  const current = systemPrompt.value.trim()
  if (!current || isDefaultSystemPrompt(current)) {
    systemPrompt.value = defaultAdVariantSystemPrompt(String(next))
  }
})

function isDefaultSystemPrompt(value: string): boolean {
  return value === DEFAULT_AD_VARIANT_SYSTEM_PROMPT_EN || value === DEFAULT_AD_VARIANT_SYSTEM_PROMPT_ZH
}

function persistProduct(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    adVariantMatrix: { ...rawMatrix(), product: product.value }
  })
}

function persistAspectRatio(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    adVariantMatrix: {
      ...rawMatrix(),
      aspectRatio: aspectRatio.value.trim() || undefined
    }
  })
}

function persistSystemPrompt(): void {
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

.aspect-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
}
</style>
