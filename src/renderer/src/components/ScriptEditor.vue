<template>
  <div class="script-editor">
    <div class="script-toolbar">
      <span>{{ t('asset.type.script') }}</span>
      <span class="spacer" />
      <span class="mode-hint">{{ t('script.hint.assetGraph') }}</span>
    </div>
    <NodeGraphEditor ref="scriptGraphRef" class="script-main" :asset-id="scriptAssetId" />
    <ShotEditorDialog
      v-if="editorOpen"
      ref="editorDialogRef"
      :script-asset-id="scriptAssetId"
      @close="editorOpen = false"
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
const editorOpen = ref(false)
const tableOpen = ref(false)
const editorDialogRef = ref<InstanceType<typeof ShotEditorDialog> | null>(null)
const tableDialogRef = ref<InstanceType<typeof ShotTableDialog> | null>(null)
const scriptGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)

async function openShotEditor(): Promise<void> {
  await scriptGraphRef.value?.flushSave?.()
  if (isDraftAssetId(props.scriptAssetId)) {
    editorOpen.value = true
    await ensureScopedSelection('project')
    return
  }
  void window.studio.openShotEditorWindow(props.scriptAssetId)
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
  openShotEditor: () => {
    void openShotEditor()
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

useEditorDocumentSession({
  id: () => `editor:script:${props.scriptAssetId}`,
  save: async () => {
    await editorDialogRef.value?.flushSave()
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

.script-main {
  flex: 1;
  min-height: 0;
}
</style>
