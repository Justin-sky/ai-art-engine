<template>
  <div ref="rootRef" class="narrative-table">
    <div class="table-toolbar">
      <span class="count">{{ rows.length }}</span>
      <button type="button" @click="onAdd">{{ t('narrative.table.new') }}</button>
    </div>
    <p v-if="error" class="table-error">{{ error }}</p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="col-order">{{ t('narrative.table.column.order') }}</th>
            <th class="col-title">{{ t('narrative.table.column.title') }}</th>
            <th class="col-summary">{{ t('narrative.table.column.summary') }}</th>
            <th class="col-function">{{ t('narrative.table.column.dramaticFunction') }}</th>
            <th class="col-chars">{{ t('narrative.table.column.characters') }}</th>
            <th class="col-location">{{ t('narrative.table.column.location') }}</th>
            <th class="col-status">{{ t('narrative.table.column.status') }}</th>
            <th class="col-actions" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="col-order" @click.stop>
              <input
                type="number"
                min="1"
                :value="row.order"
                @change="onOrderChange(row.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="col-title" @click.stop>
              <input
                :value="row.title"
                @change="onTitleChange(row.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="col-summary" @click.stop>
              <textarea
                rows="2"
                :value="row.summary"
                :placeholder="t('narrative.table.placeholder.summary')"
                @change="onSummaryChange(row.id, ($event.target as HTMLTextAreaElement).value)"
              />
            </td>
            <td class="col-function" @click.stop>
              <select
                :value="row.dramaticFunction"
                @change="
                  onFunctionChange(row.id, ($event.target as HTMLSelectElement).value)
                "
              >
                <option v-for="opt in DRAMATIC_FUNCTIONS" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </td>
            <td class="col-chars" @click.stop>
              <input
                :value="row.characters.join('、')"
                @change="onCharactersChange(row.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="col-location" @click.stop>
              <input
                :value="row.location"
                @change="onLocationChange(row.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td class="col-status" @click.stop>
              <select
                class="review-status"
                :data-status="row.status"
                :value="row.status"
                @change="onStatusChange(row.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="opt in SHOT_REVIEW_STATUS_OPTIONS" :key="opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </td>
            <td class="col-actions" @click.stop>
              <button
                type="button"
                class="del"
                :title="t('common.delete')"
                @click="onDelete(row.id)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty">{{ t('narrative.table.empty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  DEFAULT_SHOT_REVIEW_STATUS,
  normalizeShotReviewStatus,
  SHOT_REVIEW_STATUS_OPTIONS
} from '@shared/domain'
import {
  stableNarrativeUnitId,
  type NarrativeUnitRow
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadNarrativeCatalog,
  saveNarrativeCatalog
} from '../features/narrative/applyNarrativeCatalogOnOpen'

const DRAMATIC_FUNCTIONS = ['建置', '冲突', '转折', '高潮', '收束', '过渡'] as const

const props = defineProps<{
  narrativeAssetId: string
}>()

const { t } = useStudioI18n()
const rootRef = ref<HTMLElement | null>(null)
const error = ref('')
const rows = ref<NarrativeUnitRow[]>([])

const PERSIST_DEBOUNCE_MS = 280
const pendingWrites = new Set<Promise<unknown>>()
let dirty = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pendingWrites.add(promise)
  void promise.finally(() => pendingWrites.delete(promise))
  return promise
}

function clearPersistTimer(): void {
  if (!persistTimer) return
  clearTimeout(persistTimer)
  persistTimer = null
}

async function persistNow(): Promise<void> {
  clearPersistTimer()
  if (!dirty) return
  dirty = false
  error.value = ''
  try {
    await trackWrite(saveNarrativeCatalog(props.narrativeAssetId, rows.value.map((r) => ({ ...r }))))
  } catch (e) {
    dirty = true
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function schedulePersist(): void {
  dirty = true
  clearPersistTimer()
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistNow()
  }, PERSIST_DEBOUNCE_MS)
}

function findRow(id: string): NarrativeUnitRow | undefined {
  return rows.value.find((row) => row.id === id)
}

function onOrderChange(id: string, value: string): void {
  const row = findRow(id)
  const n = Number(value)
  if (!row || !Number.isFinite(n) || Math.round(n) === row.order) return
  row.order = Math.max(1, Math.round(n))
  rows.value = [...rows.value].sort((a, b) => a.order - b.order)
  schedulePersist()
}

function onTitleChange(id: string, title: string): void {
  const row = findRow(id)
  const trimmed = title.trim()
  if (!row || !trimmed || trimmed === row.title) return
  row.title = trimmed
  schedulePersist()
}

function onSummaryChange(id: string, summary: string): void {
  const row = findRow(id)
  if (!row || summary === row.summary) return
  row.summary = summary
  schedulePersist()
}

function onFunctionChange(id: string, value: string): void {
  const row = findRow(id)
  if (!row || value === row.dramaticFunction) return
  row.dramaticFunction = value
  schedulePersist()
}

function onCharactersChange(id: string, value: string): void {
  const row = findRow(id)
  if (!row) return
  const next = value
    .split(/[,，;；、]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (next.join('\0') === row.characters.join('\0')) return
  row.characters = next
  schedulePersist()
}

function onLocationChange(id: string, location: string): void {
  const row = findRow(id)
  if (!row || location === row.location) return
  row.location = location
  schedulePersist()
}

function onStatusChange(id: string, value: string): void {
  const next = normalizeShotReviewStatus(value)
  const row = findRow(id)
  if (!row || next === row.status) return
  row.status = next
  schedulePersist()
}

function onAdd(): void {
  const order = rows.value.length + 1
  const title = `${t('narrative.table.unit')} ${order}`
  rows.value.push({
    id: stableNarrativeUnitId(title, order),
    title,
    order,
    summary: '',
    dramaticFunction: '建置',
    characters: [],
    location: '',
    sourceExcerpt: '',
    emotionalBeat: '',
    durationHint: '中',
    status: DEFAULT_SHOT_REVIEW_STATUS
  })
  schedulePersist()
}

function onDelete(id: string): void {
  rows.value = rows.value.filter((row) => row.id !== id)
  schedulePersist()
}

async function flushSave(): Promise<void> {
  const active = document.activeElement
  if (active instanceof HTMLElement && rootRef.value?.contains(active)) {
    active.blur()
  }
  await nextTick()
  await persistNow()
  if (pendingWrites.size) await Promise.all([...pendingWrites])
}

onMounted(() => {
  rows.value = loadNarrativeCatalog(props.narrativeAssetId).map((row) => ({ ...row }))
})

onBeforeUnmount(() => {
  clearPersistTimer()
})

defineExpose({ flushSave })
</script>

<style scoped>
.narrative-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.count {
  font-size: 12px;
  color: var(--text-muted);
}

.table-error {
  margin: 0;
  padding: 4px 10px;
  color: var(--danger);
  font-size: 11px;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 16px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  border-bottom: 1px solid var(--border);
  padding: 6px 4px;
  vertical-align: top;
  text-align: left;
}

th {
  color: var(--text-muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  z-index: 1;
}

input,
textarea,
select {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  color: inherit;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 6px;
}

.col-order {
  width: 56px;
}

.col-title {
  width: 120px;
}

.col-function {
  width: 88px;
}

.col-chars,
.col-location {
  width: 110px;
}

.col-status {
  width: 88px;
}

.col-actions {
  width: 36px;
}

.del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
}

.empty {
  margin: 24px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.review-status[data-status='已审核'] {
  color: var(--success, #3d9a6a);
}
</style>
