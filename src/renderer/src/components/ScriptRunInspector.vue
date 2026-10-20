<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.scriptRun.hint') }}
    </p>

    <GraphNodeRunControl
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label class="title-field">
      <span class="field-label">{{ t('graph.inspector.displayName') }}</span>
      <input v-model="localTitle" @change="persistTitle" />
    </label>

    <!-- 商用脚本模板 -->
    <section class="block">
      <div class="block-head">
        <span class="block-title">{{ t('graph.scriptRun.templates.label') }}</span>
      </div>
      <select class="template-select" value="" @change="onSelectTemplate">
        <option value="" disabled>{{ t('graph.scriptRun.templates.placeholder') }}</option>
        <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">
          {{ t(`graph.scriptRun.templates.${tpl.id}`) }}
        </option>
      </select>
    </section>

    <!-- 端口声明 -->
    <section class="block">
      <div class="block-head">
        <span class="block-title">{{ t('graph.scriptRun.ports') }}</span>
        <span class="block-count">{{ portCountLabel }}</span>
      </div>
      <div class="ports-grid">
        <PortDeclEditor
          :title="t('graph.scriptRun.inputs')"
          :ports="draft.ports.inputs"
          @update="(ports) => updatePorts('inputs', ports)"
        />
        <PortDeclEditor
          :title="t('graph.scriptRun.outputs')"
          :ports="draft.ports.outputs"
          @update="(ports) => updatePorts('outputs', ports)"
        />
      </div>
    </section>

    <!-- 可用能力 -->
    <section class="block">
      <div class="block-head">
        <span class="block-title">{{ t('graph.scriptRun.capabilities') }}</span>
        <span class="block-count"
          >{{ draft.capabilities.length }} / {{ allCapabilities.length }}</span
        >
      </div>
      <p class="field-hint">
        {{ t('graph.scriptRun.capabilitiesHint') }}
      </p>
      <div class="caps-grid">
        <label
          v-for="cap in allCapabilities"
          :key="cap"
          class="cap"
          :class="{ 'cap-on': draft.capabilities.includes(cap) }"
        >
          <input
            type="checkbox"
            :checked="draft.capabilities.includes(cap)"
            @change="toggleCapability(cap, ($event.target as HTMLInputElement).checked)"
          />
          <code>{{ cap }}</code>
        </label>
      </div>
    </section>

    <!-- 代码 -->
    <section class="block code-section">
      <div class="block-head">
        <span class="block-title">{{ t('graph.scriptRun.code') }}</span>
        <div class="block-head-right">
          <span class="block-count" :class="{ 'count-warn': codeNearLimit }">
            {{ codeCountLabel }}
          </span>
          <button
            type="button"
            class="expand-btn"
            :title="t('graph.scriptRun.expandEditorHint')"
            @click="codeDialogOpen = true"
          >
            {{ t('graph.scriptRun.expandEditor') }}
          </button>
        </div>
      </div>
      <CodeEditor v-model="draft.code" :extra-lib="typings" @change="persistCode" />
    </section>

    <!-- 实时上游 inputs 快照 -->
    <section class="block">
      <details class="advanced" :open="hasConnectedInputs">
        <summary>{{ t('graph.scriptRun.inputsPreview.title') }}</summary>
        <pre class="inputs-pre">{{ inputsPreviewJson }}</pre>
      </details>
    </section>

    <!-- 控制台与执行诊断 (Console) -->
    <section class="block">
      <div class="block-head">
        <span class="block-title">{{ t('graph.scriptRun.console.title') }}</span>
        <div class="block-head-right">
          <span v-if="diagnostics.runMs != null" class="block-count">
            {{ t('graph.scriptRun.console.duration', { ms: diagnostics.runMs }) }}
          </span>
          <button
            v-if="diagnostics.logs.length || diagnostics.error"
            type="button"
            class="expand-btn"
            @click="clearDiagnostics"
          >
            {{ t('graph.scriptRun.console.clear') }}
          </button>
        </div>
      </div>
      <div class="console-box">
        <div v-if="diagnostics.error" class="console-error">
          {{ diagnostics.error }}
        </div>
        <div
          v-for="(entry, idx) in diagnostics.logs"
          :key="idx"
          class="console-line"
          :class="`lv-${entry.level}`"
        >
          <span class="lv-tag">{{ entry.level.toUpperCase() }}</span>
          <span class="lv-msg">{{ entry.message }}</span>
        </div>
        <div v-if="!diagnostics.error && !diagnostics.logs.length" class="console-empty">
          {{ t('graph.scriptRun.console.empty') }}
        </div>
      </div>
    </section>

    <!-- 资源上限 -->
    <section class="block">
      <details class="advanced">
        <summary>{{ t('graph.scriptRun.limits') }}</summary>
        <div class="limits-grid">
          <label>
            <span class="field-label">{{ t('graph.scriptRun.timeoutMs') }}</span>
            <input
              v-model.number="draft.limits.timeoutMs"
              type="number"
              :min="100"
              :max="maxLimits.timeoutMs"
              step="500"
              @change="persistLimits"
            />
          </label>
          <label>
            <span class="field-label">{{ t('graph.scriptRun.memoryMb') }}</span>
            <input
              v-model.number="draft.limits.memoryMb"
              type="number"
              :min="16"
              :max="maxLimits.memoryMb"
              step="16"
              @change="persistLimits"
            />
          </label>
        </div>
      </details>
    </section>

    <!-- 输出预览：脚本端口名可自定义、可多口，逐个端口各给一块预览并标出端口名 -->
    <template v-if="node && hostId">
      <section v-for="port in draft.ports.outputs" :key="port.id" class="output-port">
        <div class="output-port-head">
          <code class="output-port-id">{{ port.id }}</code>
          <span class="output-port-type">{{ port.dataType }}</span>
        </div>
        <GraphNodeOutputPreview :node="node" :host-id="hostId" :port-id="port.id" />
      </section>
    </template>

    <ScriptCodeEditorDialog
      :open="codeDialogOpen"
      :title="t('graph.scriptRun.editor.title', { name: displayTitle })"
      :code="draft.code"
      :extra-lib="typings"
      :inputs-preview="inputsPreview"
      :diagnostics="diagnostics"
      :can-run="!blocked"
      :is-running="runStatus === 'running'"
      @save="onDialogSave"
      @run="onDialogRun"
      @apply-template="applyTemplate"
      @clear-logs="clearDiagnostics"
      @close="codeDialogOpen = false"
    />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  readScriptNodeParams,
  readScriptRunDiagnostics,
  SCRIPT_CAPABILITIES,
  SCRIPT_MAX_CODE_CHARS,
  SCRIPT_MAX_LIMITS,
  SCRIPT_NODE_TEMPLATES,
  type GraphNodeParams,
  type ScriptCapability,
  type ScriptNodeParams,
  type ScriptNodeTemplate,
  type ScriptPortDecl
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import CodeEditor from './CodeEditor.vue'
import ScriptCodeEditorDialog from './ScriptCodeEditorDialog.vue'
import PortDeclEditor from './PortDeclEditor.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  buildScriptNodeTypings,
  buildUpstreamInputsPreview,
  scriptCodeDialogRequest
} from '../features/graph/model/scriptNodeTypings'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'script.run' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('script.run'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const allCapabilities = SCRIPT_CAPABILITIES
const maxLimits = SCRIPT_MAX_LIMITS
const templates = SCRIPT_NODE_TEMPLATES
const localTitle = ref('')
const codeDialogOpen = ref(false)
let lastDialogReqSeq = scriptCodeDialogRequest.value?.seq ?? 0

/** 端口数概览：N 入 · M 出（装前就能看出接线规模） */
const portCountLabel = computed(
  () =>
    `${draft.ports.inputs.length} ${t('graph.scriptRun.inPortsShort')} · ` +
    `${draft.ports.outputs.length} ${t('graph.scriptRun.outPortsShort')}`
)
/** 代码规模：字符数 / 上限；接近上限时标黄提醒（超长会被市场拒） */
const codeCountLabel = computed(() => `${draft.code.length} / ${SCRIPT_MAX_CODE_CHARS}`)
const codeNearLimit = computed(() => draft.code.length >= SCRIPT_MAX_CODE_CHARS * 0.9)

// 本地草稿：编辑时改草稿，change 时整份写回（避免每次按键都落盘）
const draft = reactive<ScriptNodeParams>(readScriptNodeParams({}))
let loadedId: string | null = null

watch(
  node,
  (current) => {
    if (!current) {
      loadedId = null
      codeDialogOpen.value = false
      return
    }
    const key = `${hostId.value}:${current.id}`
    if (key === loadedId) return
    // 切到另一个脚本节点：关掉大编辑窗，避免它继续显示上一个节点的代码
    codeDialogOpen.value = false
    loadedId = key
    const params = readScriptNodeParams(current.params as Record<string, unknown>)
    draft.code = params.code
    draft.ports = params.ports
    draft.capabilities = params.capabilities
    draft.limits = params.limits
    localTitle.value = current.title ?? ''
  },
  { immediate: true }
)

// 画布双击 script.run 卡片时，自动打开独立大编辑窗
watch(
  [node, scriptCodeDialogRequest],
  ([current, req]) => {
    if (!current || !req || req.seq === lastDialogReqSeq) return
    if (req.hostId === hostId.value && req.nodeId === current.id) {
      lastDialogReqSeq = req.seq
      codeDialogOpen.value = true
    }
  },
  { immediate: true }
)

const typings = computed(() =>
  buildScriptNodeTypings({
    inputs: draft.ports.inputs,
    outputs: draft.ports.outputs,
    capabilities: draft.capabilities
  })
)

const inputsPreview = computed(() => {
  void graphEditorHosts.revision.value
  if (!node.value || !hostId.value) return {}
  const doc = graphEditorHosts.getDocument(hostId.value)
  return buildUpstreamInputsPreview(doc, node.value.id, draft.ports.inputs)
})

const hasConnectedInputs = computed(() =>
  Object.values(inputsPreview.value).some((arr) => Array.isArray(arr) && arr.length > 0)
)

const inputsPreviewJson = computed(() => JSON.stringify(inputsPreview.value, null, 2))

const diagnostics = computed(() => {
  void graphEditorHosts.revision.value
  return readScriptRunDiagnostics(node.value?.params as Record<string, unknown> | undefined)
})

function persist(patch: Partial<GraphNodeParams>): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, patch)
}

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value)
}
function persistCode(): void {
  persist({ code: draft.code } as unknown as Partial<GraphNodeParams>)
}
/** 大编辑窗保存：写回草稿（同步内嵌编辑器）并落盘 */
function onDialogSave(code: string): void {
  draft.code = code
  persistCode()
}
function onDialogRun(code: string): void {
  if (draft.code !== code) {
    draft.code = code
    persistCode()
  }
  toggleRun()
}
function persistLimits(): void {
  persist({ limits: { ...draft.limits } } as unknown as Partial<GraphNodeParams>)
}
function updatePorts(side: 'inputs' | 'outputs', ports: ScriptPortDecl[]): void {
  draft.ports = { ...draft.ports, [side]: ports }
  persist({ ports: { ...draft.ports } } as unknown as Partial<GraphNodeParams>)
}
function toggleCapability(cap: ScriptCapability, on: boolean): void {
  const set = new Set(draft.capabilities)
  if (on) set.add(cap)
  else set.delete(cap)
  draft.capabilities = [...set]
  persist({ capabilities: draft.capabilities } as unknown as Partial<GraphNodeParams>)
}
function applyTemplate(tpl: ScriptNodeTemplate): void {
  draft.code = tpl.code
  draft.ports = {
    inputs: tpl.ports.inputs.map((p) => ({ ...p })),
    outputs: tpl.ports.outputs.map((p) => ({ ...p }))
  }
  draft.capabilities = [...tpl.capabilities]
  persist({
    code: draft.code,
    ports: draft.ports,
    capabilities: draft.capabilities
  } as unknown as Partial<GraphNodeParams>)
}
function onSelectTemplate(ev: Event): void {
  const select = ev.target as HTMLSelectElement
  const tplId = select.value
  select.value = ''
  const tpl = templates.find((item) => item.id === tplId)
  if (tpl) applyTemplate(tpl)
}
function clearDiagnostics(): void {
  persist({
    scriptLastLogs: [],
    scriptLastError: '',
    scriptLastRunMs: undefined
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}
.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}
.head .type {
  font-size: 11px;
  color: var(--text-muted);
}
.head h2 {
  margin: 6px 0 0;
  font-size: 14px;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
.title-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.template-select {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text);
  font-size: 12px;
}

/* 每个区块一个顶边分隔 + 小标题行，让端口 / 能力 / 代码 / 上限各成一段，便于扫读 */
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.block-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.block-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.block-count {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.count-warn {
  color: #d9a441;
}
.expand-btn {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}
.expand-btn:hover {
  border-color: var(--accent);
  color: var(--text);
}

.ports-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}
.field-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* 能力勾选：每条是一个可点的小胶囊，选中后高亮 —— 比裸复选框更容易一眼看出开了哪些 */
.caps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}
.cap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  background: var(--bg-input, var(--bg-panel));
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.cap:hover {
  border-color: var(--text-muted);
}
.cap-on {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.cap input {
  flex: none;
  margin: 0;
}
.cap code {
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-section {
  flex: 1 1 auto;
  min-height: 240px;
}

.inputs-pre {
  margin: 6px 0 0;
  padding: 6px 8px;
  max-height: 160px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.console-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
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

.advanced summary {
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.limits-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 6px;
}
.limits-grid label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title-field input,
.limits-grid input {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input, var(--bg-panel));
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

/* 逐端口输出预览：端口名 + 类型做小标头，底下接 GraphNodeOutputPreview */
.output-port {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.output-port-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.output-port-id {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.output-port-type {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
