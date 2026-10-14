<template>
  <StudioFloatingWindow
    :open="open"
    :title="title"
    :close-title="t('graph.scriptRun.editor.close')"
    :z-index="2600"
    :default-width="960"
    :default-height="760"
    :min-width="520"
    :min-height="420"
    variant="editor"
    body-class="pad-none"
    @close="onClose"
  >
    <template #title>
      <div class="title-block">
        <span class="app-mark">{{ t('graph.scriptRun.editor.appMark') }}</span>
        <h2 class="title" :title="title">
          {{ title }}
        </h2>
      </div>
    </template>

    <template #title-actions>
      <button
        type="button"
        class="tool-btn"
        :class="{ dirty }"
        :disabled="!dirty"
        :title="t('graph.scriptRun.editor.saveHint')"
        @click="save"
      >
        {{ t('common.save') }}
      </button>
    </template>

    <div class="editor-body">
      <CodeEditor v-model="draft" :extra-lib="extraLib" />
    </div>

    <template #footer>
      <div class="statusbar">
        <span>{{
          dirty ? t('graph.scriptRun.editor.unsaved') : t('graph.scriptRun.editor.saved')
        }}</span>
        <span class="status-right" :class="{ 'count-warn': nearLimit }">
          {{ draft.length }} / {{ maxChars }}
        </span>
      </div>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
/**
 * 脚本代码的**独立大编辑窗**：inspector 里只放一个紧凑的内嵌编辑器，真正写代码时双击 /
 * 点「展开编辑」在这里开一个可拖拽缩放、带类型提示（extraLib）的全尺寸 Monaco 窗口。
 *
 * 本地草稿 + 显式保存：避免每次按键都回写节点参数（与记事本弹窗同一取舍）。关闭时若有未保存
 * 改动，按记事本的习惯**自动落盘**，不丢用户的编辑。
 */
import { computed, ref, watch } from 'vue'
import { SCRIPT_MAX_CODE_CHARS } from '@shared/graph'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import CodeEditor from './CodeEditor.vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  open: boolean
  title: string
  code: string
  /** 注入 Monaco 的 .d.ts 类型提示（inputs / om / 返回值），与 inspector 内嵌编辑器一致 */
  extraLib?: string
}>()

const emit = defineEmits<{ close: []; save: [code: string] }>()

const { t } = useStudioI18n()
const maxChars = SCRIPT_MAX_CODE_CHARS
const draft = ref('')
const baseline = ref('')

const dirty = computed(() => draft.value !== baseline.value)
const nearLimit = computed(() => draft.value.length >= maxChars * 0.9)

watch(
  () => props.open,
  (visible) => {
    if (!visible) return
    draft.value = props.code ?? ''
    baseline.value = props.code ?? ''
  },
  { immediate: true }
)

// 外部（inspector 内嵌编辑器）在窗口打开期间改了代码且本地未脏时，同步进来，保持两处一致
watch(
  () => props.code,
  (next) => {
    if (!props.open || dirty.value) return
    draft.value = next ?? ''
    baseline.value = next ?? ''
  }
)

function save(): void {
  if (!dirty.value) return
  emit('save', draft.value)
  baseline.value = draft.value
}

function onClose(): void {
  if (dirty.value) {
    emit('save', draft.value)
    baseline.value = draft.value
  }
  emit('close')
}
</script>

<style scoped>
.title-block {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.app-mark {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.tool-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
}
.tool-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.tool-btn.dirty {
  border-color: color-mix(in srgb, var(--success) 55%, var(--border));
  color: var(--success);
}
.editor-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding: 10px 12px;
  box-sizing: border-box;
}
.editor-body :deep(.code-editor) {
  flex: 1 1 auto;
  min-height: 0;
}
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  color: var(--text-muted);
  font-size: 11px;
}
.status-right {
  font-variant-numeric: tabular-nums;
}
.count-warn {
  color: #d9a441;
}
</style>
