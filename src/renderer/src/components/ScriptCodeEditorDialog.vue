<template>
  <StudioFloatingWindow
    :open="open"
    :title="title"
    :close-title="t('graph.scriptRun.editor.close')"
    :z-index="2600"
    :default-width="1040"
    :default-height="780"
    :min-width="580"
    :min-height="460"
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
      <select class="tpl-select" value="" @change="onSelectTemplate">
        <option value="" disabled>{{ t('graph.scriptRun.templates.placeholder') }}</option>
        <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">
          {{ t(`graph.scriptRun.templates.${tpl.id}`) }}
        </option>
      </select>

      <button
        type="button"
        class="tool-btn"
        :class="{ active: debugOpen }"
        @click="debugOpen = !debugOpen"
      >
        {{ t('graph.scriptRun.editor.toggleDebug') }}
      </button>

      <button
        v-if="canRun"
        type="button"
        class="tool-btn run-btn"
        :disabled="isRunning"
        @click="onRunClick"
      >
        {{ isRunning ? t('graph.scriptRun.editor.running') : t('graph.scriptRun.editor.run') }}
      </button>

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

      <div v-if="debugOpen" class="debug-drawer">
        <div class="debug-col">
          <div class="debug-head">
            <span class="debug-title">{{ t('graph.scriptRun.inputsPreview.title') }}</span>
          </div>
          <pre class="debug-pre">{{ inputsJson }}</pre>
        </div>

        <div class="debug-col">
          <div class="debug-head">
            <span class="debug-title">{{ t('graph.scriptRun.console.title') }}</span>
            <div class="debug-meta">
              <span v-if="diagnostics?.runMs != null" class="run-ms">
                {{ t('graph.scriptRun.console.duration', { ms: diagnostics.runMs }) }}
              </span>
              <button
                v-if="diagnostics?.logs.length || diagnostics?.error"
                type="button"
                class="mini-btn"
                @click="emit('clearLogs')"
              >
                {{ t('graph.scriptRun.console.clear') }}
              </button>
            </div>
          </div>

          <div class="console-body">
            <div v-if="diagnostics?.error" class="console-error">
              {{ diagnostics.error }}
            </div>
            <div
              v-for="(entry, idx) in diagnostics?.logs ?? []"
              :key="idx"
              class="console-line"
              :class="`lv-${entry.level}`"
            >
              <span class="lv-tag">{{ entry.level.toUpperCase() }}</span>
              <span class="lv-msg">{{ entry.message }}</span>
            </div>
            <div v-if="!diagnostics?.error && !diagnostics?.logs.length" class="console-empty">
              {{ t('graph.scriptRun.console.empty') }}
            </div>
          </div>
        </div>
      </div>
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
 * 脚本代码的**独立大编辑窗（Script IDE）**：
 * - 支持在画布上双击 `script.run` 卡片或点击检查器「展开编辑」直接打开；
 * - 内置商用脚本模板切换、实时上游 `inputs` JSON 快照预览、Console 日志与报错行号定位，
 *   并可直接点「▶ 运行脚本」边改边跑。
 */
import { computed, ref, watch } from 'vue'
import {
  SCRIPT_MAX_CODE_CHARS,
  SCRIPT_NODE_TEMPLATES,
  type ScriptNodeTemplate,
  type ScriptRunDiagnostics
} from '@shared/graph'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import CodeEditor from './CodeEditor.vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  open: boolean
  title: string
  code: string
  /** 注入 Monaco 的 .d.ts 类型提示（inputs / om / console / 返回值） */
  extraLib?: string
  /** 实时上游输入快照（供左侧调试栏对照） */
  inputsPreview?: Record<string, unknown[]>
  /** 最近一次执行的 Console 日志、耗时与报错 */
  diagnostics?: ScriptRunDiagnostics
  /** 是否允许在弹窗顶栏直接运行节点 */
  canRun?: boolean
  isRunning?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [code: string]
  run: [code: string]
  applyTemplate: [template: ScriptNodeTemplate]
  clearLogs: []
}>()

const { t } = useStudioI18n()
const maxChars = SCRIPT_MAX_CODE_CHARS
const templates = SCRIPT_NODE_TEMPLATES
const draft = ref('')
const baseline = ref('')
const debugOpen = ref(true)

const dirty = computed(() => draft.value !== baseline.value)
const nearLimit = computed(() => draft.value.length >= maxChars * 0.9)

const inputsJson = computed(() => {
  const preview = props.inputsPreview ?? {}
  return JSON.stringify(preview, null, 2)
})

watch(
  () => props.open,
  (visible) => {
    if (!visible) return
    draft.value = props.code ?? ''
    baseline.value = props.code ?? ''
  },
  { immediate: true }
)

// 外部（inspector 内嵌编辑器或模板套用）在窗口打开期间改了代码时同步进来
watch(
  () => props.code,
  (next) => {
    if (!props.open) return
    draft.value = next ?? ''
    baseline.value = next ?? ''
  }
)

function save(): void {
  if (!dirty.value) return
  emit('save', draft.value)
  baseline.value = draft.value
}

function onRunClick(): void {
  if (dirty.value) {
    emit('save', draft.value)
    baseline.value = draft.value
  }
  debugOpen.value = true
  emit('run', draft.value)
}

function onSelectTemplate(ev: Event): void {
  const select = ev.target as HTMLSelectElement
  const tplId = select.value
  select.value = ''
  const tpl = templates.find((item) => item.id === tplId)
  if (!tpl) return
  draft.value = tpl.code
  baseline.value = tpl.code
  emit('applyTemplate', tpl)
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
.tpl-select {
  height: 28px;
  max-width: 220px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
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
  cursor: pointer;
}
.tool-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.tool-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.tool-btn.run-btn {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  font-weight: 600;
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
  gap: 8px;
  min-height: 0;
  min-width: 0;
  height: 100%;
  padding: 10px 12px;
  box-sizing: border-box;
}
.editor-body :deep(.code-editor) {
  flex: 1 1 auto;
  min-height: 240px;
}
.debug-drawer {
  flex: 0 0 190px;
  min-height: 150px;
  max-height: 240px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.debug-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  overflow: hidden;
}
.debug-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}
.debug-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}
.debug-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.run-ms {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.mini-btn {
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}
.mini-btn:hover {
  border-color: var(--accent);
  color: var(--text);
}
.debug-pre {
  margin: 0;
  padding: 6px 8px;
  flex: 1;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.console-body {
  flex: 1;
  overflow: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.console-error {
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #f87171;
  white-space: pre-wrap;
  word-break: break-word;
}
.console-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1.4;
  word-break: break-word;
}
.lv-tag {
  flex: none;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.18);
  color: var(--text-muted);
}
.lv-warn .lv-tag {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}
.lv-error .lv-tag {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.lv-msg {
  color: var(--text);
  white-space: pre-wrap;
}
.console-empty {
  color: var(--text-muted);
  font-family: inherit;
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
