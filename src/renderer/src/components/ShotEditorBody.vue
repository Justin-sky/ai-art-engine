<template>
  <div class="shot-editor-body">
    <div class="script-dialog-main">
      <div class="graph-row">
        <NodeGraphEditor
          ref="graphRef"
          class="script-dialog-graph"
          :scope="graphScope"
          :hide-toolbar="hideGraphToolbar"
        />
      </div>
      <div class="shots-section" :class="{ collapsed: !shotsExpanded }">
        <button
          type="button"
          class="shots-collapse-btn"
          :title="shotsExpanded ? t('shot.strip.collapse') : t('shot.strip.expand')"
          :aria-label="shotsExpanded ? t('shot.strip.collapse') : t('shot.strip.expand')"
          :aria-expanded="shotsExpanded"
          @click="shotsExpanded = !shotsExpanded"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              v-if="shotsExpanded"
              fill="currentColor"
              d="M3.2 9.8 8 5l4.8 4.8-.9.9L8 6.8 4.1 10.7z"
            />
            <path
              v-else
              fill="currentColor"
              d="M3.2 6.2 8 11l4.8-4.8-.9-.9L8 9.2 4.1 5.3z"
            />
          </svg>
          <span v-if="!shotsExpanded" class="shots-collapse-label">{{ t('shot.strip.title') }}</span>
        </button>
        <ShotStrip
          v-show="shotsExpanded"
          class="script-dialog-shots"
          :script-asset-id="scriptAssetId"
          @request-shot-params-inspector="focusShotParamsInspector"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, provide, ref } from 'vue'
import type { GraphAddScope } from '@shared/graph'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import NodeGraphEditor from './NodeGraphEditor.vue'
import ShotStrip from './ShotStrip.vue'

const props = withDefaults(
  defineProps<{
    scriptAssetId: string
    /** image → 每镜 visualGraphJson；video → 每镜 graphJson */
    kind?: 'image' | 'video'
    /** 由外层标题栏折叠按钮控制，收起后完全隐藏图工具栏 */
    hideGraphToolbar?: boolean
  }>(),
  {
    kind: 'video',
    hideGraphToolbar: false
  }
)

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const graphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const shotsExpanded = ref(true)

// Dive 子树内也提供 scriptAssetId，保证 NodeGraphEditor 入队能解析 script-shot target
provide(
  'scriptAssetId',
  computed(() => props.scriptAssetId)
)

const graphScope = computed<GraphAddScope>(() =>
  props.kind === 'image' ? 'visual' : 'shotWorkflow'
)

function focusShotParamsInspector(): void {
  graphRef.value?.focusActiveShotParams()
}

onMounted(() => {
  workspace.registerScriptGraphGetter(props.scriptAssetId, () =>
    graphRef.value?.getGraphDocument() ?? null
  )
  // Inspector 由 NodeGraphEditor.ensureShotParamsForActiveShotCanvas 统一到 ShotParamsInspector
})

onBeforeUnmount(() => {
  workspace.unregisterScriptGraphGetter(props.scriptAssetId)
  void graphRef.value?.flushSave()
})

defineExpose({
  flushSave: () => graphRef.value?.flushSave(),
  focusShotParamsInspector
})
</script>

<style scoped>
.shot-editor-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.script-dialog-main {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.graph-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.script-dialog-graph {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.shots-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  position: relative;
}

.shots-collapse-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.shots-section:not(.collapsed) .shots-collapse-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  width: 22px;
  height: 22px;
  padding: 0;
  justify-content: center;
  border-radius: 4px;
}

.shots-section:not(.collapsed) .shots-collapse-btn:hover {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.shots-section.collapsed .shots-collapse-btn {
  width: 100%;
}

.shots-collapse-btn:hover {
  color: var(--text);
}

.shots-collapse-label {
  font-weight: 600;
}

.script-dialog-shots {
  flex-shrink: 0;
  height: 120px;
}

.shots-section:not(.collapsed) .script-dialog-shots :deep(.strip-toolbar) {
  padding-left: 30px;
}
</style>
