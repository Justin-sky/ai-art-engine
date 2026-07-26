<template>
  <div class="inspector" v-if="unit">
    <div class="head">
      <div>
        <div class="type">
          {{
            isRefNode
              ? t('graph.types.narrative.unitRef')
              : t('narrative.unit.inspector.type', { n: unit.order })
          }}
        </div>
        <h2>{{ t('narrative.unit.inspector.title') }}</h2>
      </div>
      <span class="status" :data-status="local.status">{{ local.status }}</span>
    </div>

    <label v-if="isRefNode && refNode">
      {{ t('graph.inspector.displayName') }}
      <input v-model="localNodeTitle" @change="persistNodeTitle" />
    </label>

    <label>
      {{ t('narrative.table.column.order') }}
      <input
        type="number"
        min="1"
        step="1"
        v-model.number="local.order"
        @change="persist"
      />
    </label>

    <label>
      {{ t('narrative.table.column.title') }}
      <input v-model="local.title" @change="persist" />
    </label>

    <label>
      {{ t('narrative.table.column.dramaticFunction') }}
      <input v-model="local.dramaticFunction" @change="persist" />
    </label>

    <label>
      {{ t('narrative.table.column.location') }}
      <input v-model="local.location" @change="persist" />
    </label>

    <label>
      {{ t('narrative.table.column.characters') }}
      <input
        :value="local.characters.join('、')"
        @change="onCharactersChange(($event.target as HTMLInputElement).value)"
      />
    </label>

    <label>
      {{ t('narrative.table.column.summary') }}
      <textarea v-model="local.summary" rows="4" @change="persist" />
    </label>

    <label>
      {{ t('narrative.unit.inspector.sourceExcerpt') }}
      <textarea v-model="local.sourceExcerpt" rows="4" @change="persist" />
    </label>

    <label>
      {{ t('narrative.unit.inspector.emotionalBeat') }}
      <input v-model="local.emotionalBeat" @change="persist" />
    </label>

    <label>
      {{ t('narrative.unit.inspector.durationHint') }}
      <input v-model="local.durationHint" @change="persist" />
    </label>

    <label>
      {{ t('narrative.table.column.status') }}
      <select v-model="local.status" @change="persist">
        <option value="未审核">未审核</option>
        <option value="已审核">已审核</option>
      </select>
    </label>

    <GraphNodeOutputPreview
      v-if="isRefNode && refNode && hostId"
      :node="refNode"
      :host-id="hostId"
    />
  </div>
  <div v-else class="inspector empty">{{ t('narrative.unit.inspector.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  readBoundUnitIdFromNodeParams,
  type GraphNode,
  type NarrativeUnitRow
} from '@shared/graph'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import {
  loadNarrativeCatalog,
  saveNarrativeCatalog
} from '../features/narrative/applyNarrativeCatalogOnOpen'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useWorkspaceStore } from '../stores/workspace'

const props = defineProps<{
  narrativeAssetId?: string
  unitId?: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()

const narrativeAssetId = computed(
  () => props.narrativeAssetId ?? workspace.activeNarrativeAssetId ?? ''
)

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const refNode = computed((): GraphNode | null => {
  const selection = editor.selection.current.value
  if (selection.kind !== 'graph.node' || !selection.id) return null
  const current = graphEditorHosts.getNode(selection.hostId, selection.id)
  return current?.typeId === 'narrative.unitRef' ? current : null
})

const isRefNode = computed(() => Boolean(refNode.value))

const resolvedUnitId = computed(() => {
  const fromProp = props.unitId?.trim()
  if (fromProp) return fromProp
  const bound = readBoundUnitIdFromNodeParams(refNode.value?.params)
  if (bound) return bound
  return workspace.activeNarrativeUnitId
})

const unit = computed(() => {
  const id = resolvedUnitId.value
  if (!id || !narrativeAssetId.value) return null
  return loadNarrativeCatalog(narrativeAssetId.value).find((row) => row.id === id) ?? null
})

const local = reactive({
  order: 1,
  title: '',
  dramaticFunction: '',
  location: '',
  characters: [] as string[],
  summary: '',
  sourceExcerpt: '',
  emotionalBeat: '',
  durationHint: '',
  status: '未审核' as NarrativeUnitRow['status']
})

const localNodeTitle = ref('')

watch(
  unit,
  (next) => {
    if (!next) return
    local.order = next.order
    local.title = next.title
    local.dramaticFunction = next.dramaticFunction
    local.location = next.location
    local.characters = [...next.characters]
    local.summary = next.summary
    local.sourceExcerpt = next.sourceExcerpt
    local.emotionalBeat = next.emotionalBeat
    local.durationHint = next.durationHint
    local.status = next.status
  },
  { immediate: true }
)

watch(
  refNode,
  (node) => {
    localNodeTitle.value = node?.title ?? ''
    // 仅展示绑定单元字段，不要改 activeNarrativeUnitId：
    // 否则会按 :key 拆掉当前单元画布，运行中会卡死。
  },
  { immediate: true }
)

function onCharactersChange(raw: string): void {
  local.characters = raw
    .split(/[,，;；、]/)
    .map((part) => part.trim())
    .filter(Boolean)
  void persist()
}

function persistNodeTitle(): void {
  const node = refNode.value
  if (!node || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.id, {}, localNodeTitle.value.trim())
}

async function persist(): Promise<void> {
  const current = unit.value
  if (!current || !narrativeAssetId.value) return
  const order =
    typeof local.order === 'number' && Number.isFinite(local.order)
      ? Math.max(1, Math.round(local.order))
      : current.order
  local.order = order
  const rows = loadNarrativeCatalog(narrativeAssetId.value).map((row) =>
    row.id === current.id
      ? {
          ...row,
          order,
          title: local.title,
          dramaticFunction: local.dramaticFunction,
          location: local.location,
          characters: [...local.characters],
          summary: local.summary,
          sourceExcerpt: local.sourceExcerpt,
          emotionalBeat: local.emotionalBeat,
          durationHint: local.durationHint,
          status: local.status
        }
      : row
  )
  await saveNarrativeCatalog(narrativeAssetId.value, rows)
}
</script>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.status {
  font-size: 11px;
  color: var(--text-muted);
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

input,
textarea,
select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

textarea {
  resize: vertical;
}
</style>
