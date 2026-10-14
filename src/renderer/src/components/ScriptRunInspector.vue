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
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label class="title-field">
      <span class="field-label">{{ t('graph.inspector.displayName') }}</span>
      <input v-model="localTitle" @change="persistTitle" />
    </label>

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

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <ScriptCodeEditorDialog
      :open="codeDialogOpen"
      :title="t('graph.scriptRun.editor.title', { name: displayTitle })"
      :code="draft.code"
      :extra-lib="typings"
      @save="onDialogSave"
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
  SCRIPT_CAPABILITIES,
  SCRIPT_MAX_CODE_CHARS,
  SCRIPT_MAX_LIMITS,
  type GraphNodeParams,
  type ScriptCapability,
  type ScriptNodeParams,
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
import { buildScriptNodeTypings } from '../features/graph/model/scriptNodeTypings'

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

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('script.run'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const allCapabilities = SCRIPT_CAPABILITIES
const maxLimits = SCRIPT_MAX_LIMITS
const localTitle = ref('')
const codeDialogOpen = ref(false)

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

const typings = computed(() =>
  buildScriptNodeTypings({
    inputs: draft.ports.inputs,
    outputs: draft.ports.outputs,
    capabilities: draft.capabilities
  })
)

function persist(patch: Partial<ScriptNodeParams>): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, patch as Partial<GraphNodeParams>)
}

function persistTitle(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {}, localTitle.value)
}
function persistCode(): void {
  persist({ code: draft.code })
}
/** 大编辑窗保存：写回草稿（同步内嵌编辑器）并落盘 */
function onDialogSave(code: string): void {
  draft.code = code
  persistCode()
}
function persistLimits(): void {
  persist({ limits: { ...draft.limits } })
}
function updatePorts(side: 'inputs' | 'outputs', ports: ScriptPortDecl[]): void {
  draft.ports = { ...draft.ports, [side]: ports }
  persist({ ports: { ...draft.ports } })
}
function toggleCapability(cap: ScriptCapability, on: boolean): void {
  const set = new Set(draft.capabilities)
  if (on) set.add(cap)
  else set.delete(cap)
  draft.capabilities = [...set]
  persist({ capabilities: draft.capabilities })
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
  min-height: 260px;
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
</style>
