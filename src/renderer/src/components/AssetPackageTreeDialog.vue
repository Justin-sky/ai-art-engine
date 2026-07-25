<template>
  <StudioFloatingWindow
    :open="open"
    :title="title"
    :subtitle="subtitle"
    :show-close="false"
    :default-width="520"
    :default-height="520"
    :min-width="360"
    :min-height="280"
    @close="onCancel"
  >
    <div class="panel">
      <div class="toolbar">
        <button type="button" @click="selectAll">{{ t('asset.package.selectAll') }}</button>
        <button type="button" @click="selectNone">{{ t('asset.package.selectNone') }}</button>
        <label class="deps">
          <input v-model="includeDependencies" type="checkbox" />
          {{ t('asset.package.includeDependencies') }}
        </label>
      </div>

      <div class="tree" role="tree">
        <div
          v-for="(row, index) in visibleRows"
          :key="row.guid"
          class="tree-row"
          :class="{ alt: index % 2 === 1 }"
          :style="{ paddingLeft: `${4 + row.depth * 14}px` }"
        >
          <input
            class="row-check"
            type="checkbox"
            :checked="selected.has(row.guid)"
            :ref="(el) => bindIndeterminate(el, row.guid)"
            @click.stop
            @change="onToggle(row.guid, ($event.target as HTMLInputElement).checked)"
          />
          <span
            class="twist"
            :class="{
              open: row.kind === 'folder' && expanded.has(row.guid),
              hidden: !(row.kind === 'folder' && row.hasChildren)
            }"
            @click.stop="toggleExpanded(row.guid)"
          />
          <FolderTreeIcon
            v-if="row.kind === 'folder'"
            :open="row.hasChildren && expanded.has(row.guid)"
          />
          <span v-else class="asset-icon" aria-hidden="true" />
          <span class="tree-label" :title="row.name" @click="onToggle(row.guid, !selected.has(row.guid))">
            {{ row.name }}
          </span>
          <span v-if="row.assetType" class="type">{{ row.assetType }}</span>
        </div>
        <p v-if="!rows.length" class="empty">{{ t('asset.package.emptyTree') }}</p>
      </div>

      <p class="count">
        {{ t('asset.package.selectedCount', { count: selected.size }) }}
      </p>
      <p v-if="tip" class="tip">{{ tip }}</p>
      <p v-if="error" class="err">{{ error }}</p>
    </div>

    <template #footer>
      <button type="button" @click="onCancel">{{ t('common.cancel') }}</button>
      <button
        type="button"
        class="primary"
        :disabled="busy || selected.size === 0"
        @click="onConfirm"
      >
        {{ confirmLabel }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  collectDescendantGuids,
  toggleTreeSelection,
  type AssetPackageTreeRow
} from '@shared/assetPackage/tree'
import { useStudioI18n } from '../composables/useStudioI18n'
import FolderTreeIcon from './FolderTreeIcon.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    subtitle?: string
    confirmLabel: string
    rows: AssetPackageTreeRow[]
    initialSelected?: string[]
    initialIncludeDependencies?: boolean
    busy?: boolean
    error?: string
    tip?: string
  }>(),
  {
    subtitle: '',
    initialSelected: () => [],
    initialIncludeDependencies: true,
    busy: false,
    error: '',
    tip: ''
  }
)

const emit = defineEmits<{
  confirm: [payload: { selectedGuids: string[]; includeDependencies: boolean }]
  cancel: []
}>()

const { t } = useStudioI18n()
const selected = ref<Set<string>>(new Set())
const expanded = ref<Set<string>>(new Set())
const includeDependencies = ref(true)

const rows = computed(() => props.rows)

function expandAllFolders(list: AssetPackageTreeRow[]): Set<string> {
  return new Set(list.filter((r) => r.kind === 'folder' && r.hasChildren).map((r) => r.guid))
}

watch(
  () => props.open,
  (visible) => {
    if (!visible) return
    includeDependencies.value = props.initialIncludeDependencies
    expanded.value = expandAllFolders(props.rows)
    const initial = props.initialSelected?.length
      ? props.initialSelected
      : props.rows.map((r) => r.guid)
    let next = new Set<string>()
    for (const guid of initial) {
      next.add(guid)
      for (const d of collectDescendantGuids(props.rows, guid)) next.add(d)
    }
    const valid = new Set(props.rows.map((r) => r.guid))
    selected.value = new Set([...next].filter((id) => valid.has(id)))
  }
)

const visibleRows = computed(() => {
  const list = props.rows
  const out: AssetPackageTreeRow[] = []
  let skipUntilDepth: number | null = null
  for (const row of list) {
    if (skipUntilDepth !== null) {
      if (row.depth > skipUntilDepth) continue
      skipUntilDepth = null
    }
    out.push(row)
    if (row.kind === 'folder' && row.hasChildren && !expanded.value.has(row.guid)) {
      skipUntilDepth = row.depth
    }
  }
  return out
})

function toggleExpanded(guid: string): void {
  const next = new Set(expanded.value)
  if (next.has(guid)) next.delete(guid)
  else next.add(guid)
  expanded.value = next
}

function onToggle(guid: string, checked: boolean): void {
  selected.value = toggleTreeSelection(props.rows, selected.value, guid, checked)
}

function isIndeterminate(guid: string): boolean {
  const descendants = collectDescendantGuids(props.rows, guid)
  if (!descendants.length) return false
  const selectedCount = descendants.filter((id) => selected.value.has(id)).length
  if (selectedCount === 0 || selectedCount === descendants.length) return false
  return true
}

function bindIndeterminate(el: unknown, guid: string): void {
  if (!(el instanceof HTMLInputElement)) return
  el.indeterminate = isIndeterminate(guid)
}

function selectAll(): void {
  selected.value = new Set(props.rows.map((r) => r.guid))
  expanded.value = expandAllFolders(props.rows)
}

function selectNone(): void {
  selected.value = new Set()
}

function onCancel(): void {
  if (props.busy) return
  emit('cancel')
}

function onConfirm(): void {
  if (props.busy || selected.value.size === 0) return
  emit('confirm', {
    selectedGuids: [...selected.value],
    includeDependencies: includeDependencies.value
  })
}
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.toolbar button {
  font-size: 11px;
  line-height: 16px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.toolbar button:hover {
  background: #333;
}

.deps {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}

.tree {
  border: 1px solid var(--border);
  border-radius: 2px;
  flex: 1 1 auto;
  min-height: 120px;
  overflow: auto;
  background: var(--bg);
  padding: 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-height: 20px;
  padding-top: 1px;
  padding-right: 8px;
  padding-bottom: 1px;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
  cursor: default;
  user-select: none;
}

.tree-row.alt {
  background: var(--wash-02);
}

.tree-row:hover {
  background: var(--bg-elevated);
  color: var(--text);
}

.row-check {
  width: 13px;
  height: 13px;
  margin: 0 2px 0 0;
  flex-shrink: 0;
  accent-color: #3d8bfd;
  cursor: pointer;
}

.twist {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.twist::before {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid #8a8a8a;
  transform-origin: 25% 50%;
  transition: transform 0.1s ease;
}

.twist.open::before {
  transform: rotate(90deg);
}

.twist.hidden {
  visibility: hidden;
  pointer-events: none;
}

.asset-icon {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 1px solid #6a6a6a;
  border-radius: 1px;
  background: linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%);
}

.tree-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 2px;
  cursor: pointer;
}

.type {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.75;
  padding-left: 6px;
}

.empty {
  margin: 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.count,
.tip {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.tip {
  font-size: 12px;
  white-space: pre-wrap;
}

.err {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #e57373);
  white-space: pre-wrap;
  flex-shrink: 0;
}
</style>
