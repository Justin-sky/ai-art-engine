<template>
  <div class="script-editor">
    <div v-if="!embedded && !diving" class="script-toolbar">
      <span>{{ t('asset.type.script') }}</span>
      <span class="spacer" />
      <span class="mode-hint">{{ t('script.hint.assetGraph') }}</span>
      <GraphToolbarCollapseBtn v-model="scriptToolbarCollapsed" />
    </div>

    <div v-show="!diving" ref="splitHostEl" class="script-split">
      <NodeGraphEditor
        ref="scriptGraphRef"
        class="script-main"
        :class="{ 'with-shot-pane': embedPaneOpen }"
        :style="embedPaneOpen ? { flexBasis: `${scriptPanePercent}%`, flexGrow: 0, flexShrink: 0 } : undefined"
        :asset-id="scriptAssetId"
        :hide-toolbar="!embedded && scriptToolbarCollapsed"
      />

      <template v-if="embedPaneKind">
        <div
          class="split-handle"
          role="separator"
          aria-orientation="horizontal"
          :aria-valuenow="Math.round(scriptPanePercent)"
          :title="t('script.pane.resizeSplit')"
          @pointerdown="onSplitPointerDown"
        />
        <section class="shot-embed-pane">
          <header class="shot-embed-pane-head">
            <span class="shot-embed-pane-title">{{ embedPaneTitle }}</span>
            <span class="shot-embed-pane-hint">{{ embedPaneHint }}</span>
            <GraphToolbarCollapseBtn v-model="shotToolbarCollapsed" />
            <button type="button" class="shot-embed-pane-close" @click="closeEmbedPane">
              {{ t('script.dialog.close') }}
            </button>
          </header>
          <ShotEditorBody
            :key="embedPaneKind"
            ref="shotEditorBodyRef"
            class="shot-embed-pane-body"
            :kind="embedPaneKind"
            :hide-graph-toolbar="shotToolbarCollapsed"
            :script-asset-id="scriptAssetId"
          />
        </section>
      </template>
    </div>

    <EditorDiveChildHost :frame="diving ? diveTop : null" />

    <ShotTableDialog
      v-if="tableOpen"
      ref="tableDialogRef"
      :script-asset-id="scriptAssetId"
      :world-element-outputs="tableWorldOutputs"
      @close="tableOpen = false"
    />
    <ScriptTimelineDialog
      v-if="timelineOpen"
      ref="timelineDialogRef"
      :script-asset-id="scriptAssetId"
      @close="timelineOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import NodeGraphEditor from './NodeGraphEditor.vue'
import ShotEditorBody from './ShotEditorBody.vue'
import ShotTableDialog from './ShotTableDialog.vue'
import ScriptTimelineDialog from './ScriptTimelineDialog.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'
import { shotScriptAssetId, isDraftAssetId } from '@shared/domain'
import { storeToRefs } from 'pinia'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useAssetRecord } from '../composables/useAssetRecord'
import { scriptPreviewKey } from '../features/script/scriptPreview'
import { readShotTableWorldOutputs } from '../features/script/readShotTableWorldOutputs'
import { applyShotSplitJson } from '../features/script/applyShotSplitOnOpen'
import type { WorldElementGenResult } from '@shared/graph'

type EmbedPaneKind = 'image' | 'video'

const props = defineProps<{
  scriptAssetId: string
  /** 嵌在外层 dive 内时不作为 dive 根、不 consume */
  embedded?: boolean
}>()
const { t } = useStudioI18n()
const { asset: scriptAsset } = useAssetRecord(props.scriptAssetId)

const rootTitle = computed(
  () => scriptAsset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop } = useEditorDiveHost({
  kind: 'script',
  assetId: () => props.scriptAssetId,
  rootTitle,
  enabled: () => !props.embedded
})

provide('scriptAssetId', computed(() => props.scriptAssetId))

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { drafts } = storeToRefs(useDraftStore())
const embedPaneKind = ref<EmbedPaneKind | null>(null)
const tableOpen = ref(false)
const tableWorldOutputs = ref<WorldElementGenResult[]>([])
const timelineOpen = ref(false)
const scriptToolbarCollapsed = ref(false)
const shotToolbarCollapsed = ref(false)
const shotEditorBodyRef = ref<InstanceType<typeof ShotEditorBody> | null>(null)
const tableDialogRef = ref<InstanceType<typeof ShotTableDialog> | null>(null)
const timelineDialogRef = ref<InstanceType<typeof ScriptTimelineDialog> | null>(null)
const scriptGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const splitHostEl = ref<HTMLElement | null>(null)

const embedPaneOpen = computed(() => embedPaneKind.value != null)
const embedPaneTitle = computed(() =>
  embedPaneKind.value === 'image'
    ? t('script.dialog.shotImageEditor')
    : t('script.dialog.shotVideoEditor')
)
const embedPaneHint = computed(() =>
  embedPaneKind.value === 'image' ? t('script.hint.imageGraph') : t('script.hint.videoGraph')
)

const scriptPanePercent = ref(48)
let splitDragging = false

async function openShotPane(kind: 'image' | 'video'): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  if (embedPaneKind.value && embedPaneKind.value !== kind) {
    await shotEditorBodyRef.value?.flushSave()
  }
  embedPaneKind.value = kind
  await ensureScopedSelection('shot')
}

async function closeEmbedPane(): Promise<void> {
  await shotEditorBodyRef.value?.flushSave()
  embedPaneKind.value = null
  workspace.focusProjectGlobals()
}

async function openShotTable(): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  // 打开即按上游拆分填充分镜列表（表格节点执行只产出输出）；
  // 导入失败不应挡住表格，独立窗口还要等写盘完成才能读到新分镜
  try {
    await applyShotSplitJson(props.scriptAssetId)
  } catch {
    /* 保留已有分镜列表 */
  }
  tableWorldOutputs.value = readShotTableWorldOutputs(props.scriptAssetId)
  if (isDraftAssetId(props.scriptAssetId)) {
    tableOpen.value = true
    await ensureScopedSelection('shot')
    return
  }
  void window.studio.openShotTableWindow(props.scriptAssetId)
}

async function openScriptTimeline(): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  if (isDraftAssetId(props.scriptAssetId)) {
    timelineOpen.value = true
    return
  }
  void window.studio.openScriptTimelineWindow(props.scriptAssetId)
}

provide(scriptPreviewKey, {
  openShotImageEditor: () => {
    void openShotPane('image')
  },
  openShotEditor: () => {
    void openShotPane('video')
  },
  openShotTable: () => {
    void openShotTable()
  },
  openScriptTimeline: () => {
    void openScriptTimeline()
  }
})

const visibleShots = computed(() => {
  if (isDraftAssetId(props.scriptAssetId)) {
    const draft = drafts.value.find((d) => d.id === props.scriptAssetId)
    return draft?.shots ?? []
  }
  return project.shots.filter((s) => shotScriptAssetId(s) === props.scriptAssetId)
})

/**
 * 只在分镜集合的成员发生变化时同步选择。
 * 不直接 watch visibleShots 数组，保存分镜会替换对象并导致监听器自触发。
 */
const visibleShotIds = computed(() => visibleShots.value.map((shot) => shot.id).join('\n'))

async function ensureScopedSelection(inspector: 'shot' | 'project' = 'shot'): Promise<void> {
  const visible = visibleShots.value
  if (!visible.length) return
  if (isDraftAssetId(props.scriptAssetId)) {
    for (const shot of visible) {
      if (!project.shots.some((s) => s.id === shot.id)) {
        await project.persistShot(shot)
      }
    }
  }
  const currentId = project.activeShotId
  if (!(currentId && visible.some((s) => s.id === currentId))) {
    await project.selectShot(visible[0].id)
  }
  if (inspector === 'project') workspace.focusProjectGlobals()
  else workspace.focusShot()
}

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
  scriptPanePercent.value = Math.min(100, Math.max(0, ratio))
}

useEditorDocumentSession({
  id: () => `editor:script:${props.scriptAssetId}`,
  save: async () => {
    await shotEditorBodyRef.value?.flushSave()
    await tableDialogRef.value?.flushSave()
    await timelineDialogRef.value?.flushSave()
  },
  saveOnUnmount: false
})

let stopTableClosed: (() => void) | null = null

onMounted(async () => {
  if (!isDraftAssetId(props.scriptAssetId)) {
    await project.refreshShots()
  }
  await ensureScopedSelection('project')
  stopTableClosed = window.studio.onShotTableClosed((payload) => {
    if (payload.scriptAssetId !== props.scriptAssetId) return
    void project.refreshShots()
  })
})

onBeforeUnmount(() => {
  onSplitPointerUp()
  stopTableClosed?.()
  stopTableClosed = null
  if (!props.embedded) workspace.consumeScriptEditor(props.scriptAssetId)
})

watch(
  [() => props.scriptAssetId, visibleShotIds],
  () => {
    void ensureScopedSelection('project')
  }
)

watch(
  () => props.scriptAssetId,
  () => {
    embedPaneKind.value = null
    shotToolbarCollapsed.value = false
    timelineOpen.value = false
  }
)
</script>

<style scoped>
.script-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.script-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.spacer {
  flex: 1;
}

.mode-hint {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.script-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.script-main {
  flex: 1;
  min-height: 0;
}

.script-main.with-shot-pane {
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

.shot-embed-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
}

.shot-embed-pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  font-size: 12px;
}

.shot-embed-pane-title {
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.shot-embed-pane-hint {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}

.shot-embed-pane-close {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.shot-embed-pane-close:hover {
  border-color: var(--accent);
}

.shot-embed-pane-body {
  flex: 1;
  min-height: 0;
}
</style>
