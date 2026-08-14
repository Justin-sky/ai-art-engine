<template>
  <div
    ref="rootRef"
    class="beat-table"
  >
    <div class="table-toolbar">
      <span class="count">{{ rows.length }}</span>
      <button
        type="button"
        @click="onAdd"
      >
        {{ t('beat.table.new') }}
      </button>
    </div>
    <p
      v-if="error"
      class="table-error"
    >
      {{ error }}
    </p>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="col-order">
              {{ t('beat.table.column.order') }}
            </th>
            <th class="col-title">
              {{ t('beat.table.column.title') }}
            </th>
            <th class="col-text">
              {{ t('beat.table.column.time') }}
            </th>
            <th class="col-text">
              {{ t('beat.table.column.durationHint') }}
            </th>
            <th class="col-text">
              {{ t('beat.table.column.location') }}
            </th>
            <th class="col-refs">
              {{ t('beat.table.column.locations') }}
            </th>
            <th class="col-refs">
              {{ t('beat.table.column.characters') }}
            </th>
            <th class="col-long">
              {{ t('beat.table.column.action') }}
            </th>
            <th class="col-long">
              {{ t('beat.table.column.conflict') }}
            </th>
            <th class="col-long">
              {{ t('beat.table.column.atmosphere') }}
            </th>
            <th class="col-refs">
              {{ t('beat.table.column.props') }}
            </th>
            <th class="col-refs">
              {{ t('beat.table.column.weapons') }}
            </th>
            <th class="col-long">
              {{ t('beat.table.column.sourceExcerpt') }}
            </th>
            <th class="col-status">
              {{ t('beat.table.column.status') }}
            </th>
            <th class="col-actions" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
          >
            <td
              class="col-order"
              @click.stop
            >
              <input
                type="number"
                min="1"
                :value="row.order"
                @change="onOrderChange(row.id, ($event.target as HTMLInputElement).value)"
              >
            </td>
            <td
              class="col-title"
              @click.stop
            >
              <input
                :value="row.title"
                @change="onTitleChange(row.id, ($event.target as HTMLInputElement).value)"
              >
            </td>
            <td
              v-for="field in LEAD_TEXT_FIELDS"
              :key="field"
              class="col-text"
              @click.stop
            >
              <textarea
                rows="2"
                :value="row[field]"
                @change="
                  onTextChange(row.id, field, ($event.target as HTMLTextAreaElement).value)
                "
              />
            </td>
            <td
              v-for="field in REF_FIELDS.slice(0, 2)"
              :key="field"
              class="col-refs"
              @click.stop
            >
              <div class="ref-list">
                <div
                  v-for="(refItem, index) in row[field]"
                  :key="`${field}-${index}`"
                  class="ref-chip"
                >
                  <input
                    class="ref-name"
                    :value="refItem.name"
                    @change="
                      onRefNameChange(
                        row.id,
                        field,
                        index,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                  >
                  <button
                    type="button"
                    class="ref-remove"
                    :title="t('common.delete')"
                    @click="removeRef(row.id, field, index)"
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  class="ref-add"
                  :title="t('beat.table.bind.add')"
                  @click="addRef(row.id, field)"
                >
                  +
                </button>
              </div>
            </td>
            <td
              v-for="field in CORE_TEXT_FIELDS"
              :key="field"
              class="col-long"
              @click.stop
            >
              <textarea
                rows="2"
                :value="row[field]"
                @change="
                  onTextChange(row.id, field, ($event.target as HTMLTextAreaElement).value)
                "
              />
            </td>
            <td
              v-for="field in REF_FIELDS.slice(2)"
              :key="field"
              class="col-refs"
              @click.stop
            >
              <div class="ref-list">
                <div
                  v-for="(refItem, index) in row[field]"
                  :key="`${field}-${index}`"
                  class="ref-chip"
                >
                  <input
                    class="ref-name"
                    :value="refItem.name"
                    @change="
                      onRefNameChange(
                        row.id,
                        field,
                        index,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                  >
                  <button
                    type="button"
                    class="ref-remove"
                    :title="t('common.delete')"
                    @click="removeRef(row.id, field, index)"
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  class="ref-add"
                  :title="t('beat.table.bind.add')"
                  @click="addRef(row.id, field)"
                >
                  +
                </button>
              </div>
            </td>
            <td
              class="col-long"
              @click.stop
            >
              <textarea
                rows="2"
                :value="row.sourceExcerpt"
                @change="
                  onTextChange(
                    row.id,
                    'sourceExcerpt',
                    ($event.target as HTMLTextAreaElement).value
                  )
                "
              />
            </td>
            <td
              class="col-status"
              @click.stop
            >
              <select
                class="review-status"
                :data-status="row.status"
                :value="row.status"
                @change="onStatusChange(row.id, ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="opt in REVIEW_STATUS_OPTIONS"
                  :key="opt"
                  :value="opt"
                >
                  {{ opt }}
                </option>
              </select>
            </td>
            <td
              class="col-actions"
              @click.stop
            >
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
      <p
        v-if="!rows.length"
        class="empty"
      >
        {{ t('beat.table.empty') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  DEFAULT_REVIEW_STATUS,
  normalizeReviewStatus,
  REVIEW_STATUS_OPTIONS
} from '@shared/graph'
import {
  stableBeatId,
  type BeatRow,
  type BeatWorldRef
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadBeatCatalog,
  saveBeatCatalog
} from '../features/beat/applyBeatCatalogOnOpen'

const LEAD_TEXT_FIELDS = ['time', 'durationHint', 'location'] as const
const CORE_TEXT_FIELDS = ['action', 'conflict', 'atmosphere'] as const
const REF_FIELDS = ['locations', 'characters', 'props', 'weapons'] as const
type RefField = (typeof REF_FIELDS)[number]
type TextField =
  | (typeof LEAD_TEXT_FIELDS)[number]
  | (typeof CORE_TEXT_FIELDS)[number]
  | 'sourceExcerpt'

const FIELD_TYPE: Record<RefField, BeatWorldRef['type']> = {
  locations: '场景',
  characters: '角色',
  props: '道具',
  weapons: '武器'
}

const props = defineProps<{
  beatAssetId: string
}>()

const { t } = useStudioI18n()
const rootRef = ref<HTMLElement | null>(null)
const error = ref('')
const rows = ref<BeatRow[]>([])

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
    await trackWrite(saveBeatCatalog(props.beatAssetId, rows.value.map((r) => ({ ...r }))))
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

function findRow(id: string): BeatRow | undefined {
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

function onTextChange(id: string, field: TextField, value: string): void {
  const row = findRow(id)
  if (!row || value === row[field]) return
  row[field] = value
  schedulePersist()
}

function onRefNameChange(id: string, field: RefField, index: number, value: string): void {
  const row = findRow(id)
  if (!row) return
  const trimmed = value.trim()
  const current = row[field][index]
  if (!current || trimmed === current.name) return
  if (!trimmed) {
    row[field].splice(index, 1)
  } else {
    row[field][index] = { name: trimmed, type: FIELD_TYPE[field] }
  }
  schedulePersist()
}

function addRef(id: string, field: RefField): void {
  const row = findRow(id)
  if (!row) return
  row[field].push({ name: '', type: FIELD_TYPE[field] })
  schedulePersist()
}

function removeRef(id: string, field: RefField, index: number): void {
  const row = findRow(id)
  if (!row) return
  row[field].splice(index, 1)
  schedulePersist()
}

function onStatusChange(id: string, value: string): void {
  const next = normalizeReviewStatus(value)
  const row = findRow(id)
  if (!row || next === row.status) return
  row.status = next
  schedulePersist()
}

function onAdd(): void {
  const order = rows.value.length + 1
  const title = `${t('beat.table.unit')} ${order}`
  rows.value.push({
    id: stableBeatId(title, order),
    title,
    order,
    time: '',
    durationHint: '',
    location: '',
    locations: [],
    characters: [],
    action: '',
    conflict: '',
    atmosphere: '',
    props: [],
    weapons: [],
    sourceExcerpt: '',
  status: DEFAULT_REVIEW_STATUS
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
  rows.value = loadBeatCatalog(props.beatAssetId).map((row) => ({
    ...row,
    locations: row.locations.map((item) => ({ ...item, imageUrl: undefined })),
    characters: row.characters.map((item) => ({ ...item, imageUrl: undefined })),
    props: row.props.map((item) => ({ ...item, imageUrl: undefined })),
    weapons: row.weapons.map((item) => ({ ...item, imageUrl: undefined }))
  }))
})

onBeforeUnmount(() => {
  clearPersistTimer()
})

defineExpose({ flushSave })
</script>

<style scoped>
.beat-table {
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

textarea {
  --textarea-bg: var(--bg-elevated);
  background: var(--textarea-bg);
}

.col-order {
  width: 56px;
}

.col-title {
  width: 120px;
}

.col-text {
  width: 104px;
  min-width: 90px;
}

.col-long {
  width: 180px;
  min-width: 150px;
}

.col-refs {
  width: 120px;
  min-width: 100px;
}

.col-status {
  width: 88px;
}

.col-actions {
  width: 36px;
}

.ref-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ref-chip {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ref-name {
  flex: 1;
  min-width: 0;
  padding: 3px 4px;
}

.ref-add,
.ref-remove,
.del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.ref-add {
  align-self: flex-start;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  border: 1px dashed var(--border);
  border-radius: 4px;
}

.ref-remove,
.del {
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
