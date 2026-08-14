<template>
  <div
    v-if="node"
    class="demo-inspector"
  >
    <div class="head">
      <span class="type">{{ t('graph.demo.badge') }}</span>
      <h2>{{ node.title || t('graph.demo.title') }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.demo.inspector.hint') }}
    </p>

    <label>
      {{ t('graph.inspector.note.title') }}
      <input
        v-model="localTitle"
        @change="persist"
      >
    </label>

    <label>
      {{ t('graph.inspector.note.body') }}
      <textarea
        v-model="localText"
        rows="8"
        @change="persist"
      />
    </label>
  </div>
  <div
    v-else
    class="demo-inspector empty"
  >
    {{ t('graph.inspector.note.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStudioI18n } from '../../../composables/useStudioI18n'
import { useEditorKernel } from '../../kernel'
import { graphEditorHosts } from '../../../features/graph/model/graphEditorHosts'

const { t } = useStudioI18n()
const editor = useEditorKernel()

const localTitle = ref('')
const localText = ref('')

const node = computed(() => {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'plugin.example.node' ? current : null
})

watch(
  node,
  (current) => {
    if (!current) return
    localTitle.value = current.title ?? ''
    localText.value = current.params.text ?? ''
  },
  { immediate: true }
)

function persist(): void {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return
  graphEditorHosts.updateNode(
    selection.hostId,
    id,
    { text: localText.value.trim() || t('graph.demo.placeholder') },
    localTitle.value
  )
}
</script>

<style scoped>
.demo-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.demo-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: #6ec8ff;
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
textarea {
  font-size: 12px;
}
</style>
