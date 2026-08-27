<template>
  <div
    v-if="unit"
    class="inspector"
  >
    <div class="head">
      <div>
        <div class="type">
          {{
            isRefNode
              ? t('graph.types.beat.unitRef')
              : t('beat.unit.inspector.type', { n: unit.order })
          }}
        </div>
        <h2>{{ t('beat.unit.inspector.title') }}</h2>
      </div>
      <span
        class="status"
        :data-status="local.status"
      >{{ t(`review.${local.status}`) }}</span>
    </div>

    <label v-if="isRefNode && refNode">
      {{ t('graph.inspector.displayName') }}
      <input
        v-model="localNodeTitle"
        @change="persistNodeTitle"
      >
    </label>

    <label>
      {{ t('beat.table.column.order') }}
      <input
        v-model.number="local.order"
        type="number"
        min="1"
        step="1"
        @change="persist"
      >
    </label>

    <label>
      {{ t('beat.table.column.title') }}
      <input
        v-model="local.title"
        @change="persist"
      >
    </label>

    <label>
      {{ t('beat.table.column.time') }}
      <input
        v-model="local.time"
        @change="persist"
      >
    </label>

    <label>
      {{ t('beat.table.column.durationHint') }}
      <input
        v-model="local.durationHint"
        @change="persist"
      >
    </label>

    <label>
      {{ t('beat.table.column.location') }}
      <input
        v-model="local.location"
        @change="persist"
      >
    </label>

    <label>
      {{ t('beat.table.column.locations') }}
      <input
        :value="namesOf(local.locations)"
        @change="onRefsChange('locations', ($event.target as HTMLInputElement).value)"
      >
    </label>

    <label>
      {{ t('beat.table.column.characters') }}
      <input
        :value="namesOf(local.characters)"
        @change="onRefsChange('characters', ($event.target as HTMLInputElement).value)"
      >
    </label>

    <label>
      {{ t('beat.table.column.action') }}
      <textarea
        v-model="local.action"
        rows="3"
        @change="persist"
      />
    </label>

    <label>
      {{ t('beat.table.column.conflict') }}
      <textarea
        v-model="local.conflict"
        rows="3"
        @change="persist"
      />
    </label>

    <label>
      {{ t('beat.table.column.atmosphere') }}
      <textarea
        v-model="local.atmosphere"
        rows="3"
        @change="persist"
      />
    </label>

    <label>
      {{ t('beat.table.column.props') }}
      <input
        :value="namesOf(local.props)"
        @change="onRefsChange('props', ($event.target as HTMLInputElement).value)"
      >
    </label>

    <label>
      {{ t('beat.table.column.weapons') }}
      <input
        :value="namesOf(local.weapons)"
        @change="onRefsChange('weapons', ($event.target as HTMLInputElement).value)"
      >
    </label>

    <label>
      {{ t('beat.unit.inspector.sourceExcerpt') }}
      <textarea
        v-model="local.sourceExcerpt"
        rows="4"
        @change="persist"
      />
    </label>

    <label>
      {{ t('beat.table.column.status') }}
      <select
        v-model="local.status"
        @change="persist"
      >
        <option
          v-for="opt in REVIEW_STATUS_OPTIONS"
          :key="opt"
          :value="opt"
        >
          {{ t(`review.${opt}`) }}
        </option>
      </select>
    </label>

    <GraphNodeOutputPreview
      v-if="isRefNode && refNode && hostId"
      :node="refNode"
      :host-id="hostId"
    />
  </div>
  <div
    v-else
    class="inspector empty"
  >
    {{ t('beat.unit.inspector.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  asWorldRefList,
  readBoundBeatIdFromNodeParams,
  REVIEW_STATUS_OPTIONS,
  type GraphNode,
  type BeatRow,
  type BeatWorldRef
} from '@shared/graph'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import {
  loadBeatCatalog,
  saveBeatCatalog
} from '../features/beat/applyBeatCatalogOnOpen'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useWorkspaceStore } from '../stores/workspace'

type RefField = 'locations' | 'characters' | 'props' | 'weapons'

const props = defineProps<{
  beatAssetId?: string
  beatId?: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()

const beatAssetId = computed(
  () => props.beatAssetId ?? workspace.activeBeatAssetId ?? ''
)

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const refNode = computed((): GraphNode | null => {
  const selection = editor.selection.current.value
  if (selection.kind !== 'graph.node' || !selection.id) return null
  const current = graphEditorHosts.getNode(selection.hostId, selection.id)
  return current?.typeId === 'beat.unitRef' ? current : null
})

const isRefNode = computed(() => Boolean(refNode.value))

const resolvedBeatId = computed(() => {
  const fromProp = props.beatId?.trim()
  if (fromProp) return fromProp
  const bound = readBoundBeatIdFromNodeParams(refNode.value?.params)
  if (bound) return bound
  return workspace.activeBeatId
})

const unit = computed(() => {
  const id = resolvedBeatId.value
  if (!id || !beatAssetId.value) return null
  return loadBeatCatalog(beatAssetId.value).find((row) => row.id === id) ?? null
})

const local = reactive({
  order: 1,
  title: '',
  time: '',
  durationHint: '',
  location: '',
  locations: [] as BeatWorldRef[],
  characters: [] as BeatWorldRef[],
  action: '',
  conflict: '',
  atmosphere: '',
  props: [] as BeatWorldRef[],
  weapons: [] as BeatWorldRef[],
  sourceExcerpt: '',
  status: 'unreviewed' as BeatRow['status']
})

const localNodeTitle = ref('')

function namesOf(refs: BeatWorldRef[]): string {
  return refs.map((item) => item.name).filter(Boolean).join('、')
}

function cloneRefs(refs: BeatWorldRef[]): BeatWorldRef[] {
  return refs.map((item) => ({ ...item }))
}

watch(
  unit,
  (next) => {
    if (!next) return
    local.order = next.order
    local.title = next.title
    local.time = next.time
    local.durationHint = next.durationHint
    local.location = next.location
    local.locations = cloneRefs(next.locations)
    local.characters = cloneRefs(next.characters)
    local.action = next.action
    local.conflict = next.conflict
    local.atmosphere = next.atmosphere
    local.props = cloneRefs(next.props)
    local.weapons = cloneRefs(next.weapons)
    local.sourceExcerpt = next.sourceExcerpt
    local.status = next.status
  },
  { immediate: true }
)

watch(
  refNode,
  (node) => {
    localNodeTitle.value = node?.title ?? ''
    // 仅展示绑定场字段，不要改 activeBeatId：
    // 否则会按 :key 拆掉当前单元画布，运行中会卡死。
  },
  { immediate: true }
)

function onRefsChange(field: RefField, raw: string): void {
  const previous = local[field]
  const next = asWorldRefList(raw).map((ref) => {
    const matched = previous.find((item) => item.name === ref.name)
    return matched ? { ...matched } : ref
  })
  local[field] = next
  void persist()
}

function persistNodeTitle(): void {
  const node = refNode.value
  if (!node || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.id, {}, localNodeTitle.value.trim())
}

async function persist(): Promise<void> {
  const current = unit.value
  if (!current || !beatAssetId.value) return
  const order =
    typeof local.order === 'number' && Number.isFinite(local.order)
      ? Math.max(1, Math.round(local.order))
      : current.order
  local.order = order
  const rows = loadBeatCatalog(beatAssetId.value).map((row) =>
    row.id === current.id
      ? {
          ...row,
          order,
          title: local.title,
          time: local.time,
          durationHint: local.durationHint,
          location: local.location,
          locations: cloneRefs(local.locations),
          characters: cloneRefs(local.characters),
          action: local.action,
          conflict: local.conflict,
          atmosphere: local.atmosphere,
          props: cloneRefs(local.props),
          weapons: cloneRefs(local.weapons),
          sourceExcerpt: local.sourceExcerpt,
          status: local.status
        }
      : row
  )
  await saveBeatCatalog(beatAssetId.value, rows)
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
