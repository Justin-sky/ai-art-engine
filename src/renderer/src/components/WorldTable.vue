<template>
  <div
    ref="rootRef"
    class="world-table"
  >
    <div class="table-toolbar">
      <div class="tabs">
        <button
          v-for="kind in WORLD_ELEMENT_KINDS"
          :key="kind"
          type="button"
          class="tab"
          :class="{ active: !briefTab && activeKind === kind }"
          @click="activeKind = kind; briefTab = null"
        >
          {{ t(`world.tab.${kind}`) }}
          <span class="count">{{ catalog[kind].length }}</span>
        </button>
        <button
          type="button"
          class="tab brief-tab"
          :class="{ active: briefTab === 'style' }"
          @click="briefTab = briefTab === 'style' ? null : 'style'"
        >
          {{ t('world.table.briefStyle') }}
        </button>
        <button
          type="button"
          class="tab brief-tab"
          :class="{ active: briefTab === 'worldview' }"
          @click="briefTab = briefTab === 'worldview' ? null : 'worldview'"
        >
          {{ t('world.table.briefWorldview') }}
        </button>
      </div>
      <button
        v-if="!briefTab"
        type="button"
        @click="onAdd"
      >
        {{ t('world.table.new') }}
      </button>
    </div>
    <p
      v-if="error"
      class="table-error"
    >
      {{ error }}
    </p>
    <div
      v-if="!briefTab"
      class="table-scroll"
    >
      <table>
        <thead>
          <tr>
            <th class="col-idx">
              #
            </th>
            <th class="col-name">
              {{ t('world.table.column.name') }}
            </th>
            <th class="col-prompt">
              {{ t('world.table.column.prompt') }}
            </th>
            <th class="col-status">
              {{ t('world.table.column.status') }}
            </th>
            <th class="col-actions" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in catalog[activeKind]"
            :key="item.id"
          >
            <td class="col-idx">
              {{ index + 1 }}
            </td>
            <td
              class="col-name"
              @click.stop
            >
              <input
                :value="item.name"
                @change="onNameChange(item.id, ($event.target as HTMLInputElement).value)"
              >
            </td>
            <td
              class="col-prompt"
              @click.stop
            >
              <textarea
                rows="2"
                :value="item.prompt"
                :placeholder="t('world.table.placeholder.prompt')"
                @change="onPromptChange(item.id, ($event.target as HTMLTextAreaElement).value)"
              />
            </td>
            <td
              class="col-status"
              @click.stop
            >
              <select
                class="review-status"
                :data-status="item.status"
                :value="item.status"
                @change="onStatusChange(item.id, ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="opt in REVIEW_STATUS_OPTIONS"
                  :key="opt"
                  :value="opt"
                >
                  {{ t(`review.${opt}`) }}
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
                @click="onDelete(item.id)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="!catalog[activeKind].length"
        class="empty"
      >
        {{ t('world.table.empty') }}
      </p>
    </div>
    <div
      v-else
      class="brief-editor"
    >
      <label class="brief-label">{{ briefTab === 'style' ? t('world.table.briefStyle') : t('world.table.briefWorldview') }}</label>
      <textarea
        class="brief-textarea"
        :value="briefTab === 'style' ? catalog.style : catalog.worldview"
        :placeholder="
          briefTab === 'style'
            ? t('world.table.placeholder.style')
            : t('world.table.placeholder.worldview')
        "
        @change="onBriefChange(($event.target as HTMLTextAreaElement).value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  DEFAULT_REVIEW_STATUS,
  normalizeReviewStatus,
  REVIEW_STATUS_OPTIONS
} from '@shared/graph'
import {
  emptyWorldElementCatalog,
  stableWorldElementId,
  WORLD_ELEMENT_KINDS,
  type WorldElementCatalog,
  type WorldElementKind
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { loadWorldCatalog, saveWorldCatalog } from '../features/world/applyWorldCatalogOnOpen'

const props = defineProps<{
  worldAssetId: string
}>()

const { t } = useStudioI18n()
const rootRef = ref<HTMLElement | null>(null)
const activeKind = ref<WorldElementKind>('characters')
const briefTab = ref<'style' | 'worldview' | null>(null)
const error = ref('')
const catalog = reactive<WorldElementCatalog>(emptyWorldElementCatalog())

const PERSIST_DEBOUNCE_MS = 280
const pendingWrites = new Set<Promise<unknown>>()
let dirty = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pendingWrites.add(promise)
  void promise.finally(() => pendingWrites.delete(promise))
  return promise
}

function replaceCatalog(next: WorldElementCatalog): void {
  for (const kind of WORLD_ELEMENT_KINDS) {
    catalog[kind] = next[kind].map((item) => ({ ...item }))
  }
  catalog.style = next.style ?? ''
  catalog.worldview = next.worldview ?? ''
  dirty = false
}

function clearPersistTimer(): void {
  if (!persistTimer) return
  clearTimeout(persistTimer)
  persistTimer = null
}

function snapshotCatalog(): WorldElementCatalog {
  const out = emptyWorldElementCatalog()
  for (const kind of WORLD_ELEMENT_KINDS) {
    out[kind] = catalog[kind].map((item) => ({ ...item }))
  }
  out.style = catalog.style ?? ''
  out.worldview = catalog.worldview ?? ''
  return out
}

async function persistNow(): Promise<void> {
  clearPersistTimer()
  if (!dirty) return
  dirty = false
  error.value = ''
  try {
    await trackWrite(saveWorldCatalog(props.worldAssetId, snapshotCatalog()))
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

function onNameChange(id: string, name: string): void {
  const trimmed = name.trim()
  const list = catalog[activeKind.value]
  const item = list.find((row) => row.id === id)
  if (!item || !trimmed || trimmed === item.name) return
  item.name = trimmed
  schedulePersist()
}

function onPromptChange(id: string, prompt: string): void {
  const item = catalog[activeKind.value].find((row) => row.id === id)
  if (!item || prompt === item.prompt) return
  item.prompt = prompt
  schedulePersist()
}

function onStatusChange(id: string, value: string): void {
  const next = normalizeReviewStatus(value)
  const item = catalog[activeKind.value].find((row) => row.id === id)
  if (!item || next === item.status) return
  item.status = next
  schedulePersist()
}

function onBriefChange(value: string): void {
  if (!briefTab.value) return
  if (briefTab.value === 'style') {
    if (catalog.style === value) return
    catalog.style = value
  } else {
    if (catalog.worldview === value) return
    catalog.worldview = value
  }
  schedulePersist()
}

function onAdd(): void {
  const kind = activeKind.value
  const name = `${t(`world.tab.${kind}`)} ${catalog[kind].length + 1}`
  catalog[kind].push({
    id: stableWorldElementId(kind, name),
    name,
    prompt: '',
  status: DEFAULT_REVIEW_STATUS
  })
  schedulePersist()
}

function onDelete(id: string): void {
  const kind = activeKind.value
  catalog[kind] = catalog[kind].filter((item) => item.id !== id)
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
  replaceCatalog(loadWorldCatalog(props.worldAssetId))
})

onBeforeUnmount(() => {
  clearPersistTimer()
})

defineExpose({ flushSave })
</script>

<style scoped>
.world-table {
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

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
}

.tab.active {
  color: var(--text);
  border-color: var(--border);
  background: var(--bg-elevated);
}

.count {
  font-size: 10px;
  opacity: 0.7;
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
}

.brief-tab {
  color: var(--accent);
}

.brief-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
}

.brief-label {
  font-size: 12px;
  color: var(--text-muted);
}

.brief-textarea {
  flex: 1;
  min-height: 120px;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  padding: 8px;
  font: inherit;
  line-height: 1.5;
}

table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  padding: 8px;
  text-align: left;
  color: var(--text-muted);
}

td {
  border-bottom: 1px solid var(--border);
  padding: 6px 8px;
  vertical-align: top;
}

.col-idx {
  width: 40px;
  color: var(--text-muted);
}

.col-name {
  width: 160px;
}

.col-status {
  width: 96px;
}

.col-actions {
  width: 36px;
}

.review-status {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  padding: 4px 6px;
}

.review-status:focus {
  outline: none;
  border-color: var(--border);
  background: var(--bg-elevated);
}

.review-status[data-status='reviewed'],
.review-status[data-status='已审核'] { /* cjk-ok 后半段选择器兼容旧文档残留的中文 data-status */
  color: #7dcea0;
}

input,
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font: inherit;
  padding: 4px 6px;
  resize: vertical;
}

textarea {
  --textarea-bg: var(--bg-panel);
}

input:focus,
textarea:focus {
  outline: none;
  border-color: var(--border);
  background: var(--bg-elevated);
}

textarea:focus {
  --textarea-bg: var(--bg-elevated);
}

.del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.del:hover {
  color: var(--danger);
}

.empty {
  margin: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
