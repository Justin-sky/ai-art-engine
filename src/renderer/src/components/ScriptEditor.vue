<template>
  <div class="script-editor">
    <div class="script-toolbar">
      <span>{{ t('asset.type.script') }}</span>
      <span class="spacer" />
      <span class="mode-hint">{{ t('script.hint.assetGraph') }}</span>
    </div>

    <div ref="splitHostEl" class="script-split">
      <NodeGraphEditor
        ref="scriptGraphRef"
        class="script-main"
        :class="{ 'with-image-pane': imageEditorOpen }"
        :style="imageEditorOpen ? { flexBasis: `${scriptPanePercent}%`, flexGrow: 0, flexShrink: 0 } : undefined"
        :asset-id="scriptAssetId"
      />

      <template v-if="imageEditorOpen">
        <div
          class="split-handle"
          role="separator"
          aria-orientation="horizontal"
          :aria-valuenow="Math.round(scriptPanePercent)"
          :title="t('script.pane.resizeSplit')"
          @pointerdown="onSplitPointerDown"
        />
        <section class="shot-image-pane">
          <header class="shot-image-pane-head">
            <span class="shot-image-pane-title">{{ t('script.dialog.shotImageEditor') }}</span>
            <span class="shot-image-pane-hint">{{ t('script.hint.imageGraphEmbedded') }}</span>
            <button type="button" class="shot-image-pane-close" @click="closeShotImagePane">
              {{ t('script.dialog.close') }}
            </button>
          </header>
          <ShotEditorBody
            ref="imageEditorBodyRef"
            class="shot-image-pane-body"
            kind="image"
            embedded
            :script-asset-id="scriptAssetId"
          />
        </section>
      </template>
    </div>

    <ShotEditorDialog
      v-if="videoEditorOpen"
      ref="videoEditorDialogRef"
      kind="video"
      :script-asset-id="scriptAssetId"
      @close="videoEditorOpen = false"
    />
    <ShotTableDialog
      v-if="tableOpen"
      ref="tableDialogRef"
      :script-asset-id="scriptAssetId"
      @close="tableOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import NodeGraphEditor from './NodeGraphEditor.vue'
import ShotEditorBody from './ShotEditorBody.vue'
import ShotEditorDialog from './ShotEditorDialog.vue'
import ShotTableDialog from './ShotTableDialog.vue'
import { shotScriptAssetId, isDraftAssetId } from '@shared/domain'
import { storeToRefs } from 'pinia'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { scriptPreviewKey } from '../features/script/scriptPreview'

const props = defineProps<{
  scriptAssetId: string
}>()
const { t } = useStudioI18n()

provide('scriptAssetId', computed(() => props.scriptAssetId))

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { drafts } = storeToRefs(useDraftStore())
const imageEditorOpen = ref(false)
const videoEditorOpen = ref(false)
const tableOpen = ref(false)
const imageEditorBodyRef = ref<InstanceType<typeof ShotEditorBody> | null>(null)
const videoEditorDialogRef = ref<InstanceType<typeof ShotEditorDialog> | null>(null)
const tableDialogRef = ref<InstanceType<typeof ShotTableDialog> | null>(null)
const scriptGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const splitHostEl = ref<HTMLElement | null>(null)

const SCRIPT_PANE_MIN = 28
const SCRIPT_PANE_MAX = 78
const scriptPanePercent = ref(48)
let splitDragging = false

async function openShotImageEditor(): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  imageEditorOpen.value = true
  await ensureScopedSelection('shot')
}

async function closeShotImagePane(): Promise<void> {
  await imageEditorBodyRef.value?.flushSave()
  imageEditorOpen.value = false
  workspace.focusProjectGlobals()
}

async function openShotVideoEditor(): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  if (isDraftAssetId(props.scriptAssetId)) {
    videoEditorOpen.value = true
    await ensureScopedSelection('shot')
    return
  }
  void window.studio.openShotEditorWindow(props.scriptAssetId, 'video')
}

async function openShotTable(): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  if (isDraftAssetId(props.scriptAssetId)) {
    tableOpen.value = true
    await ensureScopedSelection('shot')
    return
  }
  void window.studio.openShotTableWindow(props.scriptAssetId)
}

provide(scriptPreviewKey, {
  openShotImageEditor: () => {
    void openShotImageEditor()
  },
  openShotEditor: () => {
    void openShotVideoEditor()
  },
  openShotTable: () => {
    void openShotTable()
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
  scriptPanePercent.value = Math.min(SCRIPT_PANE_MAX, Math.max(SCRIPT_PANE_MIN, ratio))
}

useEditorDocumentSession({
  id: () => `editor:script:${props.scriptAssetId}`,
  save: async () => {
    await imageEditorBodyRef.value?.flushSave()
    await videoEditorDialogRef.value?.flushSave()
    await tableDialogRef.value?.flushSave()
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
  workspace.consumeScriptEditor(props.scriptAssetId)
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
    imageEditorOpen.value = false
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

.script-main.with-image-pane {
  min-height: 120px;
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
  background: var(--accent, #5b8def);
}

.shot-image-pane {
  flex: 1;
  min-height: 160px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-panel, var(--bg-elevated));
  overflow: hidden;
}

.shot-image-pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 12px;
}

.shot-image-pane-title {
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.shot-image-pane-hint {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}

.shot-image-pane-close {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
}

.shot-image-pane-close:hover {
  border-color: var(--accent, #5b8def);
}

.shot-image-pane-body {
  flex: 1;
  min-height: 0;
}
</style>
