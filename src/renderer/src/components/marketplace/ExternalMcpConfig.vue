<template>
  <div class="ext">
    <label class="ext-field">
      <span>{{ t('marketplace.ext.name') }}</span>
      <input
        :value="server.name"
        type="text"
        spellcheck="false"
        :placeholder="t('marketplace.ext.namePlaceholder')"
        @input="patch({ name: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="ext-field">
      <span>{{ t('marketplace.ext.transport') }}</span>
      <select
        :value="server.transport"
        @change="onTransportChange(($event.target as HTMLSelectElement).value)"
      >
        <option value="http">{{ t('marketplace.ext.transportHttp') }}</option>
        <option value="stdio">{{ t('marketplace.ext.transportStdio') }}</option>
      </select>
    </label>

    <template v-if="server.transport === 'http'">
      <label class="ext-field">
        <span>{{ t('marketplace.ext.url') }}</span>
        <input
          :value="server.url"
          type="text"
          spellcheck="false"
          placeholder="https://example.com/mcp"
          @input="patch({ url: ($event.target as HTMLInputElement).value })"
        />
        <small v-if="reason === 'invalidUrl'" class="ext-warn">
          {{ t('marketplace.ext.invalidUrl') }}
        </small>
      </label>
      <label class="ext-field">
        <span>{{ t('marketplace.ext.headers') }}</span>
        <textarea
          :value="headersText"
          rows="3"
          spellcheck="false"
          :placeholder="t('marketplace.ext.headersPlaceholder')"
          @input="onHeadersInput(($event.target as HTMLTextAreaElement).value)"
        />
        <small class="ext-hint">{{ t('marketplace.ext.headersHint') }}</small>
      </label>
    </template>

    <template v-else>
      <label class="ext-field">
        <span>{{ t('marketplace.ext.command') }}</span>
        <input
          :value="server.command"
          type="text"
          spellcheck="false"
          placeholder="npx"
          @input="patch({ command: ($event.target as HTMLInputElement).value })"
        />
        <small class="ext-hint">{{ t('marketplace.ext.commandHint') }}</small>
      </label>
      <label class="ext-field">
        <span>{{ t('marketplace.ext.args') }}</span>
        <textarea
          :value="argsText"
          rows="3"
          spellcheck="false"
          :placeholder="t('marketplace.ext.argsPlaceholder')"
          @input="onArgsInput(($event.target as HTMLTextAreaElement).value)"
        />
        <small class="ext-hint">{{ t('marketplace.ext.argsHint') }}</small>
      </label>
      <label class="ext-field">
        <span>{{ t('marketplace.ext.env') }}</span>
        <textarea
          :value="envText"
          rows="3"
          spellcheck="false"
          :placeholder="t('marketplace.ext.envPlaceholder')"
          @input="onEnvInput(($event.target as HTMLTextAreaElement).value)"
        />
        <small class="ext-hint">{{ t('marketplace.ext.envHint') }}</small>
      </label>
    </template>

    <label class="ext-field">
      <span>{{ t('marketplace.ext.timeout') }}</span>
      <input
        :value="server.timeoutMs"
        type="number"
        :min="EXTERNAL_MCP_MIN_TIMEOUT_MS"
        :max="EXTERNAL_MCP_MAX_TIMEOUT_MS"
        step="1000"
        @input="patch({ timeoutMs: Number(($event.target as HTMLInputElement).value) })"
      />
      <small class="ext-hint">{{ t('marketplace.ext.timeoutHint') }}</small>
    </label>

    <label class="ext-toggle">
      <input
        type="checkbox"
        :checked="server.enabled"
        @change="patch({ enabled: ($event.target as HTMLInputElement).checked })"
      />
      <span>{{ t('marketplace.ext.enabled') }}</span>
    </label>

    <p class="ext-hint ext-warning">
      {{
        t(
          server.transport === 'stdio'
            ? 'marketplace.ext.stdioWarning'
            : 'marketplace.ext.httpWarning'
        )
      }}
    </p>

    <div class="ext-actions">
      <button type="button" class="mp-btn" :disabled="testing" @click="runProbe">
        {{ testing ? t('marketplace.ext.testing') : t('marketplace.ext.test') }}
      </button>
      <button type="button" class="mp-btn danger" @click="emit('remove')">
        {{ t('marketplace.ext.remove') }}
      </button>
    </div>

    <p v-if="probeError" class="ext-result error">{{ probeError }}</p>
    <template v-else-if="probedTools">
      <p class="ext-result ok">
        {{ t('marketplace.ext.probeOk', { count: probedTools.length }) }}
      </p>
      <ul v-if="probedTools.length" class="ext-tools">
        <li v-for="tool in probedTools" :key="tool.name">
          <code>{{ tool.name }}</code>
          <span v-if="tool.description">{{ tool.description }}</span>
        </li>
      </ul>
      <p v-else class="ext-hint">{{ t('marketplace.ext.probeEmpty') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ExternalMcpProbeResult } from '@shared/ipc'
import {
  EXTERNAL_MCP_MAX_TIMEOUT_MS,
  EXTERNAL_MCP_MIN_TIMEOUT_MS,
  externalMcpUnusableReason,
  type ExternalMcpServer,
  type ExternalMcpTransport
} from '@shared/externalMcp'
import { useStudioI18n } from '../../composables/useStudioI18n'

/**
 * 一条**第三方 MCP 服务**的编辑面板（卡片展开后的详情）。
 *
 * 与内建的两条 MCP 卡不同，这里是用户自己加的东西，所以必须能改、能测、能删。
 *
 * 键值型字段（headers / env）用「每行 `KEY=VALUE`」的文本编辑而不是逐行小表单：
 * 这类配置通常整块从别处粘贴，文本框是唯一不折腾的形态。空行与没有 `=` 的行忽略。
 */
const props = defineProps<{ server: ExternalMcpServer }>()
const emit = defineEmits<{
  patch: [patch: Partial<ExternalMcpServer>]
  remove: []
}>()

const { t } = useStudioI18n()

const testing = ref(false)
const probeError = ref('')
const probedTools = ref<Array<{ name: string; description?: string }> | null>(null)

const reason = computed(() => externalMcpUnusableReason(props.server))

function patch(next: Partial<ExternalMcpServer>): void {
  emit('patch', next)
}

/** 切换传输形态时清掉另一种形态的字段，避免残留值让「看起来配了、其实没配」 */
function onTransportChange(value: string): void {
  const transport: ExternalMcpTransport = value === 'stdio' ? 'stdio' : 'http'
  if (transport === props.server.transport) return
  probedTools.value = null
  probeError.value = ''
  patch(
    transport === 'http'
      ? { transport, command: '', args: [], env: {} }
      : { transport, url: '', headers: {} }
  )
}

function recordToText(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function textToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key) continue
    out[key] = trimmed.slice(eq + 1).trim()
  }
  return out
}

const headersText = computed(() => recordToText(props.server.headers))
const envText = computed(() => recordToText(props.server.env))
const argsText = computed(() => props.server.args.join('\n'))

function onHeadersInput(text: string): void {
  probedTools.value = null
  probeError.value = ''
  patch({ headers: textToRecord(text) })
}

function onEnvInput(text: string): void {
  probedTools.value = null
  probeError.value = ''
  patch({ env: textToRecord(text) })
}

/** 参数按行切：含空格的参数（如路径）不必再加引号 */
function onArgsInput(text: string): void {
  probedTools.value = null
  probeError.value = ''
  patch({
    args: text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  })
}

/**
 * 探测失败的显示文案。
 *
 * `reasonKey` 有两种来源，都指向 locale，**不是**主进程给的成品文案：
 * - `marketplace.ext.*`：配置层原因（缺地址 / 地址非法 / 缺命令），键本身就是完整文案
 * - `marketplace.ext.reason.*`：连接层原因（超时 / 401 / 子进程退出），需要把外部服务
 *   或退出码的原文附在括号里，否则用户只知道「失败了」而不知为什么
 */
function probeErrorText(result: ExternalMcpProbeResult): string {
  const key = result.reasonKey
  if (!key) return result.error ?? t('marketplace.ext.probeFailed')
  const label = t(key)
  const detail = key.startsWith('marketplace.ext.reason.') ? result.error?.trim() : ''
  return detail ? `${label}（${detail}）` : label
}

async function runProbe(): Promise<void> {
  if (testing.value) return
  testing.value = true
  probeError.value = ''
  probedTools.value = null
  try {
    const result = await window.studio.probeExternalMcp(props.server)
    if (result.ok) {
      probedTools.value = result.tools ?? []
    } else {
      probeError.value = probeErrorText(result)
    }
  } catch (e) {
    probeError.value = e instanceof Error ? e.message : String(e)
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.ext {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ext-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.ext-field input,
.ext-field select,
.ext-field textarea {
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
}

.ext-field textarea {
  font-family: var(--mono);
  resize: vertical;
}

.ext-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.ext-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.ext-warn,
.ext-result.error {
  font-size: 11px;
  color: var(--danger-muted);
}

/* stdio 会在本机执行第三方代码，这句提示必须显眼 */
.ext-warning {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--text);
}

.ext-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mp-btn {
  padding: 5px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.mp-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.mp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mp-btn.danger {
  color: var(--danger-muted);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.ext-result {
  margin: 0;
  font-size: 12px;
}

.ext-result.ok {
  color: var(--success);
}

.ext-tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
}

.ext-tools li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.ext-tools code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
}
</style>
