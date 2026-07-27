<template>
  <div class="world-element-editor">
    <div v-if="!embedded && !diving" class="toolbar">
      <span>{{ t('studio.editor.world') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('world.asset.hint') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>

    <div v-show="!diving" ref="splitHostEl" class="world-split">
      <NodeGraphEditor
        ref="worldGraphRef"
        class="world-main"
        :class="{ 'with-editor-pane': editorPaneOpen }"
        :style="editorPaneOpen ? { flexBasis: `${mainPanePercent}%`, flexGrow: 0, flexShrink: 0 } : undefined"
        :asset-id="worldAssetId"
        :hide-toolbar="!embedded && toolbarCollapsed"
      />

      <template v-if="editorPaneOpen">
        <div
          class="split-handle"
          role="separator"
          aria-orientation="horizontal"
          :aria-valuenow="Math.round(mainPanePercent)"
          :title="t('world.pane.resizeSplit')"
          @pointerdown="onSplitPointerDown"
        />
        <section class="editor-embed-pane">
          <header class="editor-embed-pane-head">
            <span class="editor-embed-pane-title">{{ t('world.dialog.editor') }}</span>
            <WorldEditorTabs v-model="editorActiveTab" class="editor-embed-tabs" />
            <span class="editor-embed-pane-hint">{{ t('world.hint.editor') }}</span>
            <GraphToolbarCollapseBtn v-model="editorToolbarCollapsed" />
            <button type="button" class="editor-embed-pane-close" @click="closeEditorPane">
              {{ t('world.dialog.close') }}
            </button>
          </header>
          <WorldEditorBody
            ref="editorBodyRef"
            class="editor-embed-pane-body"
            :world-asset-id="worldAssetId"
            :active-tab="editorActiveTab"
            :hide-graph-toolbar="editorToolbarCollapsed"
          />
        </section>
      </template>
    </div>

    <EditorDiveChildHost :frame="diving ? diveTop : null" />

    <WorldTableDialog
      v-if="tableOpen"
      ref="tableDialogRef"
      :world-asset-id="worldAssetId"
      @close="tableOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from 'vue'
import { isDraftAssetId } from '@shared/domain'
import type { WorldElementKind } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useAssetRecord } from '../composables/useAssetRecord'
import { applyWorldCatalog } from '../features/world/applyWorldCatalogOnOpen'
import { worldEditorKey, worldElementKindKey } from '../features/world/worldEditor'
import { worldTableKey } from '../features/world/worldTable'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import WorldEditorBody from './WorldEditorBody.vue'
import WorldEditorTabs from './WorldEditorTabs.vue'
import WorldTableDialog from './WorldTableDialog.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'

const props = defineProps<{
  worldAssetId: string
  /** 嵌在外层 dive 内时不作为 dive 根、不 consume */
  embedded?: boolean
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const { asset: worldAsset } = useAssetRecord(props.worldAssetId)
const worldGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const editorBodyRef = ref<InstanceType<typeof WorldEditorBody> | null>(null)
const tableDialogRef = ref<InstanceType<typeof WorldTableDialog> | null>(null)
const splitHostEl = ref<HTMLElement | null>(null)
const toolbarCollapsed = ref(false)
const editorToolbarCollapsed = ref(false)
const editorPaneOpen = ref(false)
const tableOpen = ref(false)
const editorActiveTab = ref<WorldElementKind>('characters')

const rootTitle = computed(
  () => worldAsset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop } = useEditorDiveHost({
  kind: 'world',
  assetId: () => props.worldAssetId,
  rootTitle,
  enabled: () => !props.embedded
})

provide('worldAssetId', computed(() => props.worldAssetId))
provide(worldElementKindKey, editorActiveTab)

const mainPanePercent = ref(48)
let splitDragging = false

async function openEditorPane(tab: WorldElementKind = 'characters'): Promise<void> {
  await worldGraphRef.value?.flushSave?.()
  // 按主图提取/表格目录物化四类子图：图片生成 + 图片输出（侧栏打开前写入 genParams）
  try {
    await applyWorldCatalog(props.worldAssetId)
  } catch (error) {
    console.warn('[world] applyWorldCatalog on open failed', error)
  }
  editorActiveTab.value = tab
  editorPaneOpen.value = true
  workspace.focusProjectGlobals()
}

async function closeEditorPane(): Promise<void> {
  await editorBodyRef.value?.flushSave()
  editorPaneOpen.value = false
  workspace.focusProjectGlobals()
}

async function openTable(): Promise<void> {
  await worldGraphRef.value?.flushSave?.()
  if (isDraftAssetId(props.worldAssetId)) {
    tableOpen.value = true
    return
  }
  void window.studio.openWorldTableWindow(props.worldAssetId)
}

provide(worldEditorKey, {
  openWorldEditor: (tab) => {
    void openEditorPane(tab ?? 'characters')
  }
})

provide(worldTableKey, {
  openWorldTable: () => {
    void openTable()
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
  id: () => `editor:world:${props.worldAssetId}`,
  save: async () => {
    await editorBodyRef.value?.flushSave()
    await tableDialogRef.value?.flushSave()
  },
  saveOnUnmount: false
})

watch(
  () => props.worldAssetId,
  () => {
    editorPaneOpen.value = false
    editorToolbarCollapsed.value = false
    editorActiveTab.value = 'characters'
  }
)

onBeforeUnmount(() => {
  onSplitPointerUp()
  if (!props.embedded) workspace.consumeWorldEditor(props.worldAssetId)
})
</script>

<style scoped>
.world-element-editor {
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
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.world-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.world-main {
  flex: 1;
  min-height: 0;
}

.world-main.with-editor-pane {
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

.editor-embed-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
}

.editor-embed-pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  font-size: 12px;
}

.editor-embed-pane-title {
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.editor-embed-tabs {
  flex-shrink: 0;
}

.editor-embed-pane-hint {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}

.editor-embed-pane-close {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.editor-embed-pane-close:hover {
  border-color: var(--accent);
}

.editor-embed-pane-body {
  flex: 1;
  min-height: 0;
}
</style>
