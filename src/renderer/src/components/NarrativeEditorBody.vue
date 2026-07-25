<template>
  <div class="narrative-editor">
    <aside class="unit-list-pane">
      <p v-if="!rows.length" class="empty">{{ t('narrative.editor.empty') }}</p>
      <ul v-else class="unit-list">
        <li
          v-for="row in rows"
          :key="row.id"
          class="unit-row"
          :class="{ active: row.id === selectedId }"
          @click="selectedId = row.id"
        >
          <span class="unit-order">{{ row.order }}</span>
          <div class="unit-main">
            <span class="unit-title">{{ row.title || t('narrative.table.unit') }}</span>
            <span class="unit-meta">
              <span v-if="row.dramaticFunction" class="unit-fn">{{ row.dramaticFunction }}</span>
              <span class="unit-status" :data-status="row.status">{{ row.status }}</span>
            </span>
          </div>
        </li>
      </ul>
    </aside>

    <section class="unit-detail-pane">
      <p v-if="!selected" class="empty">{{ t('narrative.editor.selectHint') }}</p>
      <template v-else>
        <header class="detail-header">
          <h2>{{ selected.order }}. {{ selected.title }}</h2>
          <div class="detail-tags">
            <span v-if="selected.dramaticFunction">{{ selected.dramaticFunction }}</span>
            <span v-if="selected.location">{{ selected.location }}</span>
            <span v-if="selected.characters.length">{{ selected.characters.join('、') }}</span>
            <span class="unit-status" :data-status="selected.status">{{ selected.status }}</span>
          </div>
        </header>
        <label class="field">
          <span>{{ t('narrative.table.column.summary') }}</span>
          <textarea
            :value="selected.summary"
            rows="3"
            :placeholder="t('narrative.table.placeholder.summary')"
            @change="onSummaryChange(($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <label class="field body">
          <span>{{ t('narrative.editor.fullText') }}</span>
          <textarea
            :value="selected.sourceExcerpt"
            rows="16"
            :placeholder="t('narrative.editor.fullTextPlaceholder')"
            @change="onExcerptChange(($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { NarrativeUnitRow } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadNarrativeCatalog,
  saveNarrativeCatalog
} from '../features/narrative/applyNarrativeCatalogOnOpen'

const props = defineProps<{
  narrativeAssetId: string
}>()

const { t } = useStudioI18n()
const rows = ref<NarrativeUnitRow[]>([])
const selectedId = ref('')
let saveTimer: ReturnType<typeof setTimeout> | null = null

const selected = computed(
  () => rows.value.find((row) => row.id === selectedId.value) ?? null
)

function ensureSelection(): void {
  if (!rows.value.length) {
    selectedId.value = ''
    return
  }
  if (!rows.value.some((row) => row.id === selectedId.value)) {
    selectedId.value = rows.value[0]!.id
  }
}

function reload(): void {
  rows.value = loadNarrativeCatalog(props.narrativeAssetId)
  ensureSelection()
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNarrativeCatalog(props.narrativeAssetId, rows.value)
  }, 280)
}

function patchSelected(patch: Partial<NarrativeUnitRow>): void {
  const id = selectedId.value
  if (!id) return
  rows.value = rows.value.map((row) => (row.id === id ? { ...row, ...patch } : row))
  scheduleSave()
}

function onSummaryChange(value: string): void {
  patchSelected({ summary: value })
}

function onExcerptChange(value: string): void {
  patchSelected({ sourceExcerpt: value })
}

async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveNarrativeCatalog(props.narrativeAssetId, rows.value)
}

watch(
  () => props.narrativeAssetId,
  () => reload(),
  { immediate: true }
)

onMounted(() => {
  reload()
})

defineExpose({
  flushSave,
  reload
})
</script>

<style scoped>
.narrative-editor {
  display: flex;
  min-height: 0;
  height: 100%;
  background: var(--bg-panel);
}

.unit-list-pane {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow: auto;
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--border));
}

.unit-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.unit-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}

.unit-row:hover {
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
}

.unit-row.active {
  background: var(--bg-elevated);
  border-color: var(--border);
}

.unit-order {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--border) 55%, transparent);
}

.unit-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.unit-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.unit-fn {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.unit-status {
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
}

.unit-status[data-status='已审核'] {
  color: var(--ok, #3a9a5a);
}

.unit-detail-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  overflow: auto;
}

.detail-header h2 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 650;
  color: var(--text);
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.detail-tags > span {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.field.body {
  flex: 1;
  min-height: 0;
}

.field textarea {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  line-height: 1.55;
}

.field textarea::-webkit-resizer {
  background-color: var(--bg-elevated);
  background-image: var(--resizer-grip);
  border: none;
}

.field.body textarea {
  flex: 1;
  min-height: 240px;
  resize: none;
}

.empty {
  margin: 24px 16px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
