<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.gameHtmlGen.inspectorHint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label class="field">
      <span>{{ t('graph.gameHtmlGen.mode') }}</span>
      <select :value="mode" @change="onModeChange">
        <option value="auto">
          {{ t('graph.gameHtmlGen.modeAuto') }}
        </option>
        <option value="2d">
          {{ t('graph.gameHtmlGen.mode2d') }}
        </option>
        <option value="3d">
          {{ t('graph.gameHtmlGen.mode3d') }}
        </option>
      </select>
    </label>

    <label class="field">
      <span>{{ t('graph.gameHtmlGen.instruction') }}</span>
      <textarea
        v-model="instruction"
        class="instruction"
        rows="4"
        :placeholder="t('graph.gameHtmlGen.instructionPlaceholder')"
        @change="persistInstruction"
      />
    </label>

    <label class="field">
      <span>{{ t('graph.gameHtmlGen.systemPrompt') }}</span>
      <textarea
        v-model="systemPrompt"
        class="instruction"
        rows="6"
        :placeholder="t('graph.gameHtmlGen.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>

    <GraphNodeOutputPreview
      v-if="hostId"
      :node="node"
      :host-id="hostId"
      clearable
      @clear-output="onClearOutput"
    />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  resolveGameHtmlSystemPrompt,
  resolvePreferredGamePlayMode,
  isBuiltinGameHtmlSystemPrompt,
  type GamePlayMode
} from '@shared/gamePlay'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'game.htmlGen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('game.htmlGen'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const mode = computed((): GamePlayMode =>
  resolvePreferredGamePlayMode(node.value?.params.gamePlayMode)
)
const instruction = ref('')
const systemPrompt = ref('')

watch(
  () => node.value?.params.generateInstruction,
  (stored) => {
    instruction.value = stored ?? ''
  },
  { immediate: true }
)

watch(
  () =>
    [
      node.value?.params.generateSystemPrompt,
      node.value?.params.gamePlayMode,
      locale.value
    ] as const,
  ([stored, playMode]) => {
    systemPrompt.value = resolveGameHtmlSystemPrompt(
      resolvePreferredGamePlayMode(playMode),
      stored,
      String(locale.value)
    )
  },
  { immediate: true }
)

function patchParams(patch: Record<string, unknown>): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, patch)
}

function onModeChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  const next = resolvePreferredGamePlayMode(value)
  const stored = node.value?.params.generateSystemPrompt
  const patch: Record<string, unknown> = { gamePlayMode: next }
  // 切换模式时清掉内置默认系统词，避免旧 2D 默认锁死 3D 生成
  if (isBuiltinGameHtmlSystemPrompt(stored)) {
    patch.generateSystemPrompt = ''
  }
  patchParams(patch)
}

function persistInstruction(): void {
  patchParams({ generateInstruction: instruction.value })
}

function persistSystemPrompt(): void {
  const trimmed = systemPrompt.value.trim()
  const modeDefault = resolveGameHtmlSystemPrompt(
    mode.value,
    undefined,
    String(locale.value)
  ).trim()
  // 与当前模式默认相同则不落盘，让模式切换始终生效
  patchParams({ generateSystemPrompt: trimmed === modeDefault ? '' : systemPrompt.value })
}

function onClearOutput(): void {
  if (!node.value || !hostId.value) return
  const host = graphRunHosts.get(hostId.value)
  if (host && !host.isRunning.value) {
    delete host.runStates[node.value.id]
  }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generatedTexts: [],
    selectedTextId: '',
    gamePlayHtml: '',
    gamePlayHtmlPath: '',
    text: ''
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field :is(input, select, textarea) {
  width: 100%;
  box-sizing: border-box;
}

.instruction {
  resize: vertical;
  font-family: inherit;
}
</style>
