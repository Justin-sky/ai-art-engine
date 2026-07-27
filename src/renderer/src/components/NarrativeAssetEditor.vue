<template>
  <div class="narrative-asset-editor">
    <div v-if="!embedded && !diving" class="toolbar">
      <span>{{ t('studio.editor.narrative') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('narrative.asset.hint') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>

    <div v-show="!diving" ref="splitHostEl" class="narrative-split">
      <NodeGraphEditor
        ref="narrativeGraphRef"
        class="narrative-main"
        :class="{ 'with-gen-pane': genPaneOpen }"
        :style="genPaneOpen ? { flexBasis: `${mainPanePercent}%`, flexGrow: 0, flexShrink: 0 } : undefined"
        :asset-id="narrativeAssetId"
        :hide-toolbar="!embedded && toolbarCollapsed"
      />

      <template v-if="genPaneOpen">
        <div
          class="split-handle"
          role="separator"
          aria-orientation="horizontal"
          :aria-valuenow="Math.round(mainPanePercent)"
          :title="t('narrative.pane.resizeSplit')"
          @pointerdown="onSplitPointerDown"
        />
        <section class="gen-embed-pane">
          <header class="gen-embed-pane-head">
            <span class="gen-embed-pane-title">{{ t('narrative.dialog.gen') }}</span>
            <span class="gen-embed-pane-hint">{{ t('narrative.hint.gen') }}</span>
            <GraphToolbarCollapseBtn v-model="genToolbarCollapsed" />
            <button type="button" class="gen-embed-pane-close" @click="closeGenPane">
              {{ t('narrative.dialog.close') }}
            </button>
          </header>
          <NarrativeUnitEditorBody
            ref="genBodyRef"
            class="gen-embed-pane-body"
            :narrative-asset-id="narrativeAssetId"
            :hide-graph-toolbar="genToolbarCollapsed"
          />
        </section>
      </template>
    </div>

    <EditorDiveChildHost :frame="diving ? diveTop : null" />

    <NarrativeTableDialog
      v-if="tableOpen"
      ref="tableDialogRef"
      :narrative-asset-id="narrativeAssetId"
      @close="tableOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useAssetRecord } from '../composables/useAssetRecord'
import { narrativeEditorKey } from '../features/narrative/narrativeEditor'
import { narrativeTableKey } from '../features/narrative/narrativeTable'
import { loadNarrativeCatalog } from '../features/narrative/applyNarrativeCatalogOnOpen'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import NarrativeUnitEditorBody from './NarrativeUnitEditorBody.vue'
import NarrativeTableDialog from './NarrativeTableDialog.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'

const props = defineProps<{
  narrativeAssetId: string
  /** 嵌在外层 dive 内时不作为 dive 根、不 consume */
  embedded?: boolean
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const { asset: narrativeAsset } = useAssetRecord(props.narrativeAssetId)
const narrativeGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const genBodyRef = ref<InstanceType<typeof NarrativeUnitEditorBody> | null>(null)
const tableDialogRef = ref<InstanceType<typeof NarrativeTableDialog> | null>(null)
const splitHostEl = ref<HTMLElement | null>(null)
const toolbarCollapsed = ref(false)
const genToolbarCollapsed = ref(false)
const genPaneOpen = ref(false)
const tableOpen = ref(false)
const mainPanePercent = ref(48)
let splitDragging = false

const rootTitle = computed(
  () => narrativeAsset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop } = useEditorDiveHost({
  kind: 'narrative',
  assetId: () => props.narrativeAssetId,
  rootTitle,
  enabled: () => !props.embedded
})

provide('narrativeAssetId', computed(() => props.narrativeAssetId))

async function openTable(): Promise<void> {
  await narrativeGraphRef.value?.flushSave?.()
  tableOpen.value = true
}

async function openGenPane(): Promise<void> {
  await narrativeGraphRef.value?.flushSave?.()
  const rows = [...loadNarrativeCatalog(props.narrativeAssetId)].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title)
  )
  if (rows.length) {
    const current = workspace.activeNarrativeUnitId
    const keep = current && rows.some((row) => row.id === current) ? current : rows[0].id
    workspace.selectNarrativeUnit(keep, props.narrativeAssetId)
  } else {
    workspace.selectNarrativeUnit(null, props.narrativeAssetId)
  }
  genPaneOpen.value = true
  await Promise.resolve()
  genBodyRef.value?.reloadStrip?.()
  workspace.focusNarrativeUnit()
}

async function closeGenPane(): Promise<void> {
  await genBodyRef.value?.flushSave()
  genPaneOpen.value = false
  workspace.focusProjectGlobals()
}

provide(narrativeTableKey, {
  openNarrativeTable: () => {
    void openTable()
  }
})

provide(narrativeEditorKey, {
  openNarrativeEditor: () => {
    void openGenPane()
  }
})

function onSplitPointerDown(e: PointerEvent): void {
  splitDragging = true
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  window.addEventListener('pointermove', onSplitPointerMove)
  window.addEventListener('pointerup', onSplitPointerUp)
  window.addEventListener('pointercancel', onSplitPointerUp)
}

function onSplitPointerMove(e: PointerEvent): void {
  if (!splitDragging) return
  updateSplitFromClientY(e.clientY)
}

function onSplitPointerUp(): void {
  splitDragging = false
  window.removeEventListener('pointermove', onSplitPointerMove)
  window.removeEventListener('pointerup', onSplitPointerUp)
  window.removeEventListener('pointercancel', onSplitPointerUp)
}

function updateSplitFromClientY(clientY: number): void {
  const host = splitHostEl.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  if (rect.height <= 0) return
  const ratio = ((clientY - rect.top) / rect.height) * 100
  mainPanePercent.value = Math.min(100, Math.max(0, ratio))
}

useEditorDocumentSession({
  id: () => `editor:narrative:${props.narrativeAssetId}`,
  save: async () => {
    await genBodyRef.value?.flushSave()
    await tableDialogRef.value?.flushSave()
  },
  saveOnUnmount: false
})

watch(
  () => props.narrativeAssetId,
  () => {
    genPaneOpen.value = false
    workspace.selectNarrativeUnit(null, null)
  }
)

onBeforeUnmount(() => {
  onSplitPointerUp()
  if (!props.embedded) workspace.consumeNarrativeEditor(props.narrativeAssetId)
})
</script>

<style scoped>
.narrative-asset-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  color: var(--text-muted);
  font-size: 11px;
}

.narrative-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.narrative-main {
  flex: 1;
  min-height: 0;
}

.narrative-main.with-gen-pane {
  min-height: 0;
}

.split-handle {
  flex: none;
  height: 6px;
  cursor: row-resize;
  background: var(--border);
  touch-action: none;
}

.split-handle:hover,
.split-handle:active {
  background: var(--accent);
}

.gen-embed-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
}

.gen-embed-pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  font-size: 12px;
}

.gen-embed-pane-title {
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.gen-embed-pane-hint {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}

.gen-embed-pane-close {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.gen-embed-pane-close:hover {
  border-color: var(--accent);
}

.gen-embed-pane-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
