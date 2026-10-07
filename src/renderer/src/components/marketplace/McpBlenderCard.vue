<template>
  <div class="mcp-row">
    <label class="check">
      <input v-model="cfg.enabled" type="checkbox" :disabled="busy" />
      <span>{{ t('settings.mcp.blender.enabled') }}</span>
    </label>
    <span v-if="!cfg.enabled" class="hint-inline">{{
      t('settings.mcp.blender.notEnabledHint')
    }}</span>
    <span v-else-if="info?.connected" class="mcp-running">
      {{ t('settings.mcp.blender.connected') }}
    </span>
    <span v-else-if="info?.lastError" class="hint-inline error">
      {{ t('settings.mcp.blender.connectError', { error: info.lastError }) }}
    </span>
    <span v-else class="hint-inline">{{ t('settings.mcp.blender.notConnected') }}</span>
  </div>

  <div v-if="info" class="mcp-row">
    <span class="about-label">{{ t('settings.mcp.blender.endpoint') }}</span>
    <code class="mcp-value mcp-cmd">{{ info.endpoint || '—' }}</code>
    <button
      v-if="info.endpoint"
      type="button"
      class="about-btn"
      @click="copyEndpoint(info.endpoint)"
    >
      {{ t('settings.mcp.blender.copyEndpoint') }}
    </button>
  </div>

  <div class="number-row">
    <label>
      {{ t('settings.mcp.blender.addonType') }}
      <select v-model="cfg.addonType" :disabled="busy">
        <option value="community">{{ t('settings.mcp.blender.addonTypeCommunity') }}</option>
        <option value="official">{{ t('settings.mcp.blender.addonTypeOfficial') }}</option>
      </select>
      <span class="hint">{{ t('settings.mcp.blender.addonTypeHint') }}</span>
    </label>
    <label>
      {{ t('settings.mcp.blender.serverHost') }}
      <input v-model="cfg.serverHost" type="text" spellcheck="false" :disabled="busy" />
      <span class="hint">{{ t('settings.mcp.blender.serverHostHint') }}</span>
    </label>
    <label>
      {{ t('settings.mcp.blender.serverPort') }}
      <input v-model.number="cfg.serverPort" type="number" min="1" max="65535" :disabled="busy" />
      <span class="hint">{{ t('settings.mcp.blender.serverPortHint') }}</span>
    </label>
  </div>

  <div class="mcp-row">
    <button type="button" class="about-btn primary" :disabled="busy" @click="applyAndReconnect">
      {{
        busy ? t('settings.mcp.blender.restartBusy') : t('settings.mcp.blender.applyAndReconnect')
      }}
    </button>
  </div>

  <template v-if="info?.connected">
    <div class="mcp-row">
      <span class="about-label">{{ t('settings.mcp.blender.blenderVersion') }}</span>
      <code class="mcp-value">{{ info.blenderVersion || '—' }}</code>
    </div>
    <div class="mcp-row">
      <span class="about-label">{{ t('settings.mcp.blender.addonVersion') }}</span>
      <code class="mcp-value">{{ info.addonVersion || '—' }}</code>
    </div>
    <div class="mcp-row">
      <span class="about-label">{{ t('settings.mcp.blender.protocolVersion') }}</span>
      <code class="mcp-value">{{ info.protocolVersion || '—' }}</code>
    </div>
    <div class="mcp-row">
      <span class="about-label">{{ t('settings.mcp.blender.lastCheckedAt') }}</span>
      <code class="mcp-value">{{ info.lastCheckedAt || '—' }}</code>
    </div>
  </template>

  <p class="hint">{{ t('settings.mcp.blender.addonSetup') }}</p>

  <p v-if="message" class="msg" :class="{ error: isError }">{{ message }}</p>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { McpBlenderBridgeInfo } from '@shared/ipc'
import type { AppSettings } from '@shared/domain'
import { useStudioI18n } from '../../composables/useStudioI18n'

/**
 * Blender 工具面卡片（从设置页原样搬出，含 4 秒探活轮询）。
 *
 * 配置通过 `update` 事件回写父级表单（父级统一防抖落盘），因为 `addonType` /
 * `serverHost` / `serverPort` 属于**设置项**，要走 `setSettings` 持久化；
 * 而「应用并重连」额外调 `restartBlenderMcp` 让主进程立即生效。
 */
const props = defineProps<{
  info: McpBlenderBridgeInfo | null
  blenderMcp: AppSettings['blenderMcp']
}>()
const emit = defineEmits<{
  update: [patch: Partial<AppSettings['blenderMcp']>]
  updated: [info: McpBlenderBridgeInfo]
}>()

const { t } = useStudioI18n()
const busy = ref(false)
const message = ref('')
const isError = ref(false)

/** 本地副本：直接 v-model 绑 props 会触发「改父级 prop」告警 */
const cfg = reactive<AppSettings['blenderMcp']>({ ...props.blenderMcp })
watch(
  () => props.blenderMcp,
  (next) => Object.assign(cfg, next),
  { deep: true }
)
watch(cfg, () => emit('update', { ...cfg }), { deep: true })

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // addon 是否可达只有主进程知道，靠轮询把连接状态驱动到 UI（用户可能中途才开 Blender）
  pollTimer = setInterval(() => {
    void refreshStatus()
  }, 4000)
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

/** 拉一次状态。主进程侧探活按 TTL 缓存，这里只取缓存值，开销可忽略 */
async function refreshStatus(): Promise<void> {
  if (busy.value) return
  try {
    const info = await window.studio.getBlenderMcpInfo()
    if (info) emit('updated', info)
  } catch {
    // 刷新失败不打扰用户：真正的连接问题会由主进程写进 lastError 展示
  }
}

/**
 * 提交当前配置并重连。主进程会落盘 + 断开旧 TCP + 立即探活并返回完整状态，
 * 所以一次调用同时拿到「配置生效」与「连上了没有」。
 */
async function applyAndReconnect(): Promise<void> {
  if (busy.value) return
  busy.value = true
  message.value = t('settings.mcp.blender.restartBusy')
  isError.value = false
  try {
    const next = await window.studio.restartBlenderMcp({
      enabled: cfg.enabled,
      serverHost: cfg.serverHost,
      serverPort: cfg.serverPort,
      safeMode: cfg.safeMode,
      addonType: cfg.addonType
    })
    emit('updated', next)
    message.value = cfg.enabled
      ? t('settings.mcp.blender.restartOk')
      : t('settings.mcp.blender.restartDisabled')
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

/** 复制工具面端点（外部 MCP 客户端接入用） */
async function copyEndpoint(text: string): Promise<void> {
  await window.studio.writeClipboardText(text)
  message.value = t('settings.mcp.blender.endpointCopied')
  isError.value = false
}
</script>

<style scoped>
.hint {
  color: var(--text-muted);
  line-height: 1.5;
  font-size: 12px;
  margin: 0;
}

.hint-inline {
  color: var(--text-muted);
  font-size: 12px;
}

.hint-inline.error {
  color: var(--danger-muted);
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
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
  min-width: 84px;
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

.mcp-running {
  color: var(--success);
}

.number-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
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
