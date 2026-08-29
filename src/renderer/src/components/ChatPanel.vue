<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { HarnessEvent, HarnessStatus, McpActivity } from '@shared/ipc'
import { useStudioI18n } from '../composables/useStudioI18n'

type ChatMsg =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; final?: boolean }
  | { kind: 'status'; text: string }
  | {
      kind: 'tool'
      name: string
      state: 'start' | 'done' | 'error'
      detail?: string
    }

const { t } = useStudioI18n()

const messages = ref<ChatMsg[]>([])
const draft = ref('')
const running = ref(false)
const status = ref<HarnessStatus | null>(null)
const listRef = ref<HTMLElement | null>(null)

let stopEvent: (() => void) | null = null
let stopActivity: (() => void) | null = null
// MCP 活动 id → 已渲染的工具卡（会话内去重并原地更新状态）
const toolById = new Map<string, ChatMsg & { kind: 'tool' }>()

const ready = computed(
  () =>
    !!status.value?.nodeOk &&
    !!status.value?.mcpRunning &&
    !!status.value?.hasDeepseekKey
)
const statusText = computed(() => {
  const s = status.value
  if (!s) return t('studio.chat.checking')
  if (ready.value) return t('studio.chat.ready')
  return s.message ?? t('studio.chat.unavailable')
})
const statusWarn = computed(() => !!status.value && !ready.value)

function scrollToBottom(): void {
  void nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
  })
}

function pushAssistant(text: string, replace = false): void {
  const last = messages.value[messages.value.length - 1]
  if (!replace && last?.kind === 'assistant' && !last.final) {
    last.text += text
  } else {
    messages.value.push({ kind: 'assistant', text, final: replace })
  }
  scrollToBottom()
}

function pushStatus(text: string): void {
  messages.value.push({ kind: 'status', text })
  scrollToBottom()
}

function onHarnessEvent(event: HarnessEvent): void {
  switch (event.type) {
    case 'assistant':
      pushAssistant(event.text)
      break
    case 'status':
      pushStatus(event.text)
      break
    case 'tool':
      messages.value.push({
        kind: 'tool',
        name: event.name,
        state: event.state,
        detail: event.detail
      })
      scrollToBottom()
      break
    case 'final':
      // 覆盖流式文本为完整最终回答，避免重复
      pushAssistant(event.text, true)
      break
    case 'done':
      running.value = false
      break
    case 'error':
      pushStatus(event.message)
      running.value = false
      break
  }
}

/** 工具调用卡：dsh 通过 MCP 触发的生成活动，会话期间实时呈现 */
function onMcpActivity(activity: McpActivity): void {
  if (!running.value) return
  const state =
    activity.status === 'completed'
      ? 'done'
      : activity.status === 'failed'
        ? 'error'
        : 'start'
  const prev = toolById.get(activity.id)
  if (prev) {
    prev.state = state
    prev.detail = activity.error
    return
  }
  const card: ChatMsg & { kind: 'tool' } = {
    kind: 'tool',
    name: activity.title || activity.tool,
    state,
    detail: activity.error
  }
  toolById.set(activity.id, card)
  messages.value.push(card)
  scrollToBottom()
}

async function onSend(): Promise<void> {
  const task = draft.value.trim()
  if (!task || running.value || !ready.value) return
  draft.value = ''
  toolById.clear()
  messages.value.push({ kind: 'user', text: task })
  scrollToBottom()
  running.value = true
  const result = await window.studio.runHarnessTask({ task })
  if (!result.started) {
    pushStatus(result.message ?? 'failed to start')
    running.value = false
  }
}

async function onAbort(): Promise<void> {
  await window.studio.abortHarnessTask()
}

onMounted(async () => {
  stopEvent = window.studio.onHarnessEvent(onHarnessEvent)
  stopActivity = window.studio.onMcpActivityUpdated(onMcpActivity)
  status.value = await window.studio.getHarnessStatus()
})

onBeforeUnmount(() => {
  stopEvent?.()
  stopActivity?.()
})
</script>

<template>
  <div class="chat-panel">
    <div class="chat-status" :class="{ warn: statusWarn }">
      <span class="dot" />
      <span class="status-text">{{ statusText }}</span>
    </div>

    <div ref="listRef" class="chat-messages">
      <div v-if="!messages.length" class="chat-empty">{{ t('studio.chat.empty') }}</div>
      <template v-for="(msg, i) in messages" :key="i">
        <div v-if="msg.kind === 'user'" class="msg-row user">
          <div class="bubble user">{{ msg.text }}</div>
        </div>
        <div v-else-if="msg.kind === 'assistant'" class="msg-row assistant">
          <div class="bubble assistant"><pre>{{ msg.text }}</pre></div>
        </div>
        <div v-else-if="msg.kind === 'status'" class="msg-status">{{ msg.text }}</div>
        <div v-else class="msg-tool" :class="msg.state">
          <span class="tool-icon" />
          <span class="tool-name">{{ msg.name }}</span>
          <span class="tool-state">
            {{ msg.state === 'start' ? t('studio.chat.toolRunning') : msg.state === 'done' ? t('studio.chat.toolDone') : t('studio.chat.toolFailed') }}
          </span>
          <span v-if="msg.detail" class="tool-detail" :title="msg.detail">{{ msg.detail }}</span>
        </div>
      </template>
      <div v-if="running" class="msg-status running">
        <span class="dots"><i /><i /><i /></span>
      </div>
    </div>

    <div class="chat-input">
      <textarea
        v-model="draft"
        rows="3"
        :placeholder="t('studio.chat.placeholder')"
        :disabled="running"
        @keydown.enter.exact.prevent="onSend"
      />
      <div class="chat-actions">
        <button v-if="running" class="btn abort" @click="onAbort">
          {{ t('studio.chat.stop') }}
        </button>
        <button
          v-else
          class="btn send"
          :disabled="!draft.trim() || !ready"
          @click="onSend"
        >
          {{ t('studio.chat.send') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
}

.chat-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.chat-status .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--success);
}

.chat-status.warn .dot {
  background: var(--warning);
}

.chat-status .status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-empty {
  margin: auto;
  max-width: 240px;
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

.msg-row {
  display: flex;
}

.msg-row.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 88%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble.user {
  background: var(--accent-18);
}

.bubble.assistant {
  background: var(--bg-elevated);
  width: 100%;
}

.bubble pre {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-status {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
}

.msg-status.running {
  display: flex;
  justify-content: center;
  padding: 2px 0;
}

.dots i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin: 0 2px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: chat-dots 1.2s infinite ease-in-out;
}

.dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes chat-dots {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

.msg-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
}

.msg-tool .tool-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--accent);
}

.msg-tool.done .tool-icon {
  background: var(--success);
}

.msg-tool.error .tool-icon {
  background: var(--danger);
}

.msg-tool .tool-name {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-tool .tool-state {
  flex: none;
}

.msg-tool .tool-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-input {
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-input textarea {
  width: 100%;
  resize: none;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
}

.chat-input textarea:focus {
  outline: none;
  border-color: var(--accent-45);
}

.chat-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.btn {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn.send {
  background: var(--accent-18);
  border-color: var(--accent-45);
  color: var(--accent-fg);
}

.btn.send:hover:not(:disabled) {
  background: var(--accent-25);
}

.btn.abort {
  border-color: var(--danger);
  color: var(--danger-muted);
}
</style>
