<template>
  <div class="note-inspector" v-if="node">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ hintText }}</p>

    <label>
      {{ t('graph.inspector.note.title') }}
      <input v-model="localTitle" @change="persist" />
    </label>

    <label>
      {{ bodyLabel }}
      <ExpandableTextarea
        :key="`${node.id}-body`"
        v-model="localText"
        :title="bodyLabel"
        :rows="8"
        :placeholder="bodyPlaceholder"
        @change="persist"
      />
    </label>
  </div>
  <div v-else class="note-inspector empty">{{ emptyText }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t } = useStudioI18n()
const editor = useEditorKernel()

const localTitle = ref('')
const localText = ref('')

const node = computed(() => {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const n = graphEditorHosts.getNode(selection.hostId, id)
  return n?.category === 'note' ? n : null
})

const isTextNode = computed(() => node.value?.typeId === 'play.script')

const typeLabel = computed(() =>
  isTextNode.value ? t('graph.scriptNode.title') : t('graph.note.title')
)

const hintText = computed(() =>
  isTextNode.value ? t('graph.inspector.script.hint') : t('graph.inspector.note.hint')
)

const bodyLabel = computed(() =>
  isTextNode.value ? t('graph.inspector.script.body') : t('graph.inspector.note.body')
)

const bodyPlaceholder = computed(() =>
  isTextNode.value
    ? t('graph.scriptNode.placeholder')
    : t('graph.note.placeholder')
)

const emptyText = computed(() =>
  isTextNode.value ? t('graph.inspector.script.empty') : t('graph.inspector.note.empty')
)

watch(
  node,
  (n) => {
    if (!n) return
    localTitle.value = n.title ?? ''
    localText.value = n.params.text ?? ''
  },
  { immediate: true }
)

function persist(): void {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id || !node.value) return
  const fallback = isTextNode.value ? '…' : t('graph.note.draftPlaceholder')
  graphEditorHosts.updateNode(
    selection.hostId,
    id,
    { text: localText.value.trim() || fallback },
    localTitle.value
  )
}
</script>

<style scoped>
.note-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.note-inspector.empty {
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

input,
:deep(textarea) {
  font-size: 12px;
}
</style>
