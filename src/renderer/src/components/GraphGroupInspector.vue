<template>
  <div class="group-inspector" v-if="group">
    <div class="head">
      <span class="type">{{ t('graph.group.title') }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.group.hint') }}</p>

    <label>
      {{ t('graph.inspector.group.name') }}
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <div class="stat">
      <span class="stat-label">{{ t('graph.inspector.group.memberCount') }}</span>
      <span class="stat-value">{{ memberCount }}</span>
    </div>
  </div>
  <div v-else class="group-inspector empty">{{ t('graph.inspector.group.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t } = useStudioI18n()
const editor = useEditorKernel()

const localTitle = ref('')

const selectionState = computed(() => {
  const selection = editor.selection.current.value
  if (selection.kind !== 'graph.group') return null
  const groupId = selection.id ?? null
  if (!groupId) return null
  const group = graphEditorHosts.getGroup(selection.hostId, groupId)
  if (!group) return null
  return {
    hostId: selection.hostId,
    group,
    memberCount: graphEditorHosts.getGroupMemberIds(selection.hostId, groupId).length
  }
})

const group = computed(() => selectionState.value?.group ?? null)
const memberCount = computed(() => selectionState.value?.memberCount ?? 0)

const displayTitle = computed(() => {
  const title = group.value?.title?.trim()
  return title || t('graph.group.defaultName')
})

watch(
  group,
  (g) => {
    if (!g) return
    localTitle.value = g.title?.trim() || ''
  },
  { immediate: true }
)

function persistTitle(): void {
  const state = selectionState.value
  if (!state) return
  graphEditorHosts.updateGroup(state.hostId, state.group.id, {
    title: localTitle.value.trim() || t('graph.group.defaultName')
  })
}
</script>

<style scoped>
.group-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.group-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

input {
  font-size: 12px;
}

.stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
}

.stat-label {
  color: var(--text-muted);
}

.stat-value {
  font-variant-numeric: tabular-nums;
}
</style>
