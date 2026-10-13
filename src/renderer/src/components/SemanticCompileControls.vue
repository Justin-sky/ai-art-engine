<template>
  <label class="compile-llm" :title="t('graph.inspector.semantic.promptsWithModelHint')">
    <input type="checkbox" :checked="semanticLlm" @change="onLlmChange" />
    <span>{{ t('graph.inspector.semantic.promptsWithModel') }}</span>
  </label>
  <details v-if="packOptions.length" class="compile-packs">
    <summary :title="t('graph.inspector.semantic.rulePacksHint')">
      {{ t('graph.inspector.semantic.rulePacks') }}
      <span class="count">{{ selectedLabel }}</span>
    </summary>
    <div class="pack-list">
      <label v-for="pack in packOptions" :key="pack.id" class="pack">
        <input
          type="checkbox"
          :checked="selected.includes(pack.id)"
          @change="togglePack(pack.id)"
        />
        <span>{{ pack.title }}</span>
      </label>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { collectRulePacks, type SemanticPack } from '@shared/semanticTimeline'
import { useStudioI18n } from '../composables/useStudioI18n'

/**
 * 语义编译节点指令面板的附加控件：「用模型写提示词」开关 + 导演规则包选择。
 * 只 emit，由卡片写回节点参数（`semanticLlm` / `rulePackIds`）。
 */
const props = defineProps<{
  semanticLlm: boolean
  /** 逗号分隔；空 = 内置 + 全部已装 */
  rulePackIds: string
}>()

const emit = defineEmits<{
  'update:semanticLlm': [value: boolean]
  'update:rulePackIds': [value: string]
}>()

const { t } = useStudioI18n()

const packs = ref<SemanticPack[]>([])
onMounted(async () => {
  try {
    packs.value = (await window.studio.semanticListPacks()) ?? []
  } catch {
    packs.value = []
  }
})

const packOptions = computed(() =>
  collectRulePacks(packs.value).map((p) => ({ id: p.id, title: p.title || p.id }))
)

const selected = computed(() =>
  props.rulePackIds
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
)

const selectedLabel = computed(() =>
  selected.value.length
    ? `${selected.value.length}/${packOptions.value.length}`
    : t('graph.inspector.semantic.rulePacksAll')
)

function onLlmChange(event: Event): void {
  emit('update:semanticLlm', (event.target as HTMLInputElement).checked)
}

function togglePack(id: string): void {
  const next = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
  emit('update:rulePackIds', next.join(','))
}
</script>

<style scoped>
.compile-llm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.compile-llm:hover {
  color: var(--text);
}

.compile-llm input,
.pack input {
  margin: 0;
  accent-color: var(--accent);
}

.compile-packs {
  position: relative;
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
}

.compile-packs summary {
  cursor: pointer;
  list-style: none;
  height: 24px;
  line-height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
}

.compile-packs summary:hover,
.compile-packs summary:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}

.count {
  margin-left: 4px;
  color: var(--text);
}

.pack-list {
  position: absolute;
  z-index: 5;
  bottom: calc(100% + 4px);
  left: 0;
  min-width: 180px;
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
}

.pack {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  white-space: nowrap;
}
</style>
