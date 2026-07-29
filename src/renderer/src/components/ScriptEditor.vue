<template>
  <div class="script-editor">
    <div v-if="showDiveShellBar && diveContext" class="dive-shell-bar">
      <EditorDiveBar
        :root-title="diveContext.rootTitle"
        :frames="diveContext.frames"
        @pop-to="diveContext.popTo"
      />
    </div>

    <div v-if="!embedded && !diving" class="script-toolbar">
      <span>{{ t('asset.type.script') }}</span>
      <span class="spacer" />
      <span class="mode-hint">{{ t('script.hint.assetGraph') }}</span>
      <GraphToolbarCollapseBtn v-model="scriptToolbarCollapsed" />
    </div>

    <NodeGraphEditor
      v-show="!diving"
      ref="scriptGraphRef"
      class="script-main"
      :asset-id="scriptAssetId"
      :hide-toolbar="!embedded && scriptToolbarCollapsed"
    />

    <EditorDiveChildHost :frame="diving ? diveTop : null" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveBar from './EditorDiveBar.vue'
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
import { editorDiveFlush } from '../features/graph/model/editorDiveFlush'
import { isEditorDiveViewFrame } from '../features/graph/model/editorDive'

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
const { diving, diveTop, diveContext } = useEditorDiveHost({
  kind: 'script',
  assetId: () => props.scriptAssetId,
  rootTitle,
  enabled: () => !props.embedded
})
const showDiveShellBar = computed(
  () => !props.embedded && diving.value && isEditorDiveViewFrame(diveTop.value)
)

provide('scriptAssetId', computed(() => props.scriptAssetId))

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { drafts } = storeToRefs(useDraftStore())
const scriptToolbarCollapsed = ref(false)
const scriptGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)

const visibleShots = computed(() => {
  if (isDraftAssetId(props.scriptAssetId)) {
    const draft = drafts.value.find((d) => d.id === props.scriptAssetId)
    return draft?.shots ?? []
  }
  return project.shots.filter((s) => shotScriptAssetId(s) === props.scriptAssetId)
})

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
    const top = diveTop.value
    if (top) await editorDiveFlush.flush(top.key)
    await scriptGraphRef.value?.flushSave?.()
  },
  saveOnUnmount: false
})

onMounted(async () => {
  if (!isDraftAssetId(props.scriptAssetId)) {
    await project.refreshShots()
  }
  await ensureScopedSelection('project')
})

onBeforeUnmount(() => {
  if (!props.embedded) workspace.consumeScriptEditor(props.scriptAssetId)
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

.dive-shell-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.script-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.script-toolbar .spacer {
  flex: 1;
}

.mode-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.script-main {
  flex: 1;
  min-height: 0;
}
</style>
