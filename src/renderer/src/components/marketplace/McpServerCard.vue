<template>
  <p class="hint">
    <template v-if="info">
      <span class="mcp-running">{{ t('settings.mcp.running', { port: info.port }) }}</span>
      · {{ info.endpoint }}
    </template>
    <template v-else>
      {{ t('settings.mcp.notRunning') }}
    </template>
  </p>

  <label>
    {{ t('settings.mcp.port') }}
    <div class="number-row">
      <input v-model.number="portInput" type="number" min="1" max="65535" :disabled="busy" />
      <button type="button" class="about-btn primary" :disabled="busy" @click="restart(false)">
        {{
          busy
            ? t('settings.mcp.restarting')
            : info
              ? t('settings.mcp.restart')
              : t('settings.mcp.start')
        }}
      </button>
    </div>
  </label>
  <p class="hint">{{ t('settings.mcp.portHint') }}</p>

  <div class="mcp-row">
    <span class="about-label">{{ t('settings.mcp.token') }}</span>
    <code class="mcp-value">{{ tokenVisible && info ? info.token : '••••••••••••••••' }}</code>
    <button v-if="info" type="button" class="about-btn" @click="tokenVisible = !tokenVisible">
      {{ t(tokenVisible ? 'settings.mcp.hide' : 'settings.mcp.show') }}
    </button>
    <button v-if="info" type="button" class="about-btn" @click="copy(info.token)">
      {{ t('settings.mcp.copy') }}
    </button>
    <button v-if="info" type="button" class="about-btn" :disabled="busy" @click="restart(true)">
      {{ t('settings.mcp.resetToken') }}
    </button>
    <button
      v-if="info && !tokenEditing"
      type="button"
      class="about-btn"
      :disabled="busy"
      @click="startTokenEdit"
    >
      {{ t('settings.mcp.editToken') }}
    </button>
  </div>

  <div v-if="tokenEditing" class="mcp-row">
    <span class="about-label">{{ t('settings.mcp.token') }}</span>
    <input
      v-model="tokenInput"
      type="text"
      class="mcp-token-input"
      spellcheck="false"
      :placeholder="t('settings.mcp.tokenPlaceholder')"
      :disabled="busy"
    />
    <button type="button" class="about-btn" :disabled="busy" @click="applyTokenEdit">
      {{ t('settings.mcp.saveToken') }}
    </button>
    <button type="button" class="about-btn" :disabled="busy" @click="tokenEditing = false">
      {{ t('settings.mcp.cancelEdit') }}
    </button>
  </div>

  <div v-if="info" class="mcp-row">
    <span class="about-label">{{ t('settings.mcp.endpoint') }}</span>
    <code class="mcp-value">{{ info.endpoint }}</code>
    <button type="button" class="about-btn" @click="copy(info.endpoint)">
      {{ t('settings.mcp.copy') }}
    </button>
  </div>

  <div v-if="info" class="mcp-row">
    <span class="about-label">{{ t('settings.mcp.command') }}</span>
    <code class="mcp-value mcp-cmd">{{ claudeCommand }}</code>
    <button type="button" class="about-btn" @click="copy(claudeCommand)">
      {{ t('settings.mcp.copy') }}
    </button>
  </div>

  <p v-if="info" class="hint">{{ t('settings.mcp.hint') }}</p>

  <p v-if="message" class="msg" :class="{ error: isError }">{{ message }}</p>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { McpServerInfo } from '@shared/ipc'
import { useStudioI18n } from '../../composables/useStudioI18n'

/**
 * MCP 主服务卡片（从设置页原样搬出）。
 *
 * 与设置页不同的一点：这里**不再直接绑父级 `form`**，也不再自己落盘设置 ——
 * 端口与 token 走的是 `restartMcpServer` 这条独立链路（主进程落盘 + 热重启），
 * 与 `setSettings` 无关，所以搬出来不需要表单管道。
 */
const props = defineProps<{ info: McpServerInfo | null }>()
const emit = defineEmits<{ updated: [info: McpServerInfo] }>()

const { t } = useStudioI18n()
const busy = ref(false)
const tokenVisible = ref(false)
const tokenEditing = ref(false)
const tokenInput = ref('')
const portInput = ref<number | null>(null)
const message = ref('')
const isError = ref(false)

watch(
  () => props.info,
  (next) => {
    portInput.value = next?.port ?? null
  },
  { immediate: true }
)

/** Claude Code HTTP 直连注册命令（一键复制） */
const claudeCommand = computed(() => {
  if (!props.info) return ''
  return `claude mcp add --transport http aiartengine ${props.info.endpoint} --header "Authorization: Bearer ${props.info.token}"`
})

async function copy(text: string): Promise<void> {
  await window.studio.writeClipboardText(text)
  message.value = t('settings.mcp.copied')
  isError.value = false
}

/** 应用端口修改（resetToken=true 时同时重置 token）并重启/启动 MCP 服务 */
async function restart(resetToken: boolean): Promise<void> {
  if (busy.value) return
  busy.value = true
  message.value = t('settings.mcp.restarting')
  isError.value = false
  try {
    const next = await window.studio.restartMcpServer({
      ...(portInput.value ? { port: portInput.value } : {}),
      resetToken
    })
    if (next) emit('updated', next)
    portInput.value = next?.port ?? null
    message.value = resetToken ? t('settings.mcp.tokenReset') : t('settings.mcp.restarted')
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function startTokenEdit(): void {
  tokenInput.value = props.info?.token ?? ''
  tokenEditing.value = true
}

/** 保存自定义 token：校验后经 MCP_RESTART 应用（服务热重启，旧 token 立即失效） */
async function applyTokenEdit(): Promise<void> {
  if (busy.value) return
  const token = tokenInput.value.trim()
  if (!/^\S{8,128}$/.test(token)) {
    message.value = t('settings.mcp.tokenInvalid')
    isError.value = true
    return
  }
  busy.value = true
  isError.value = false
  try {
    const next = await window.studio.restartMcpServer({ token, resetToken: false })
    if (next) emit('updated', next)
    tokenEditing.value = false
    message.value = t('settings.mcp.tokenSaved')
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.hint {
  color: var(--text-muted);
  line-height: 1.5;
  font-size: 12px;
  margin: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.mcp-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mcp-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
  flex: 1 1 220px;
  min-width: 0;
}

.mcp-cmd {
  flex-basis: 100%;
}

.about-label {
  color: var(--text-muted);
  font-size: 12px;
  min-width: 56px;
}

.about-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.about-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.about-btn.primary {
  background: rgba(47, 107, 255, 0.22);
  border-color: rgba(47, 107, 255, 0.45);
}

.mcp-token-input {
  flex: 1 1 260px;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.mcp-running {
  color: var(--success);
}

.number-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.msg {
  color: var(--success);
  font-size: 12px;
  margin: 0;
}

.msg.error {
  color: var(--danger-muted);
}
</style>
