<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('marketplace.ext.add')"
    :subtitle="t('marketplace.ext.addHint')"
    :close-title="t('marketplace.ext.cancelAdd')"
    :default-width="560"
    :default-height="520"
    :min-width="420"
    :min-height="360"
    :z-index="3200"
    :detachable="false"
    @close="emit('close')"
  >
    <div class="add-form">
      <label class="field">
        <span>{{ t('marketplace.ext.name') }}</span>
        <input
          ref="nameInputEl"
          v-model="draft.name"
          type="text"
          spellcheck="false"
          :placeholder="t('marketplace.ext.namePlaceholder')"
          @keydown.enter.prevent="submit"
        />
      </label>

      <label class="field">
        <span>{{ t('marketplace.ext.transport') }}</span>
        <select v-model="draft.transport">
          <option value="http">{{ t('marketplace.ext.transportHttp') }}</option>
          <option value="stdio">{{ t('marketplace.ext.transportStdio') }}</option>
        </select>
      </label>

      <template v-if="draft.transport === 'http'">
        <label class="field">
          <span>{{ t('marketplace.ext.url') }}</span>
          <input
            v-model="draft.url"
            type="text"
            spellcheck="false"
            placeholder="https://example.com/mcp"
            @keydown.enter.prevent="submit"
          />
        </label>
        <p class="hint">{{ t('marketplace.ext.httpWarning') }}</p>
      </template>

      <template v-else>
        <label class="field">
          <span>{{ t('marketplace.ext.command') }}</span>
          <input
            v-model="draft.command"
            type="text"
            spellcheck="false"
            placeholder="npx"
            @keydown.enter.prevent="submit"
          />
          <small class="hint">{{ t('marketplace.ext.commandHint') }}</small>
        </label>
        <label class="field">
          <span>{{ t('marketplace.ext.args') }}</span>
          <textarea
            v-model="draft.argsText"
            rows="3"
            spellcheck="false"
            :placeholder="t('marketplace.ext.argsPlaceholder')"
          />
          <small class="hint">{{ t('marketplace.ext.argsHint') }}</small>
        </label>
        <!-- stdio 会在本机执行第三方代码：这句必须显眼，别让用户顺手就点添加 -->
        <p class="warning">{{ t('marketplace.ext.stdioWarning') }}</p>
      </template>

      <p v-if="error" class="error">{{ error }}</p>

      <template v-if="probedTools">
        <p class="ok">{{ t('marketplace.ext.probeOk', { count: probedTools.length }) }}</p>
        <ul v-if="probedTools.length" class="tools">
          <li v-for="tool in probedTools" :key="tool.name">
            <code>{{ tool.name }}</code>
            <span v-if="tool.description">{{ tool.description }}</span>
          </li>
        </ul>
        <p v-else class="hint">{{ t('marketplace.ext.probeEmpty') }}</p>
      </template>
    </div>

    <template #footer>
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">
        {{ t('marketplace.ext.cancelAdd') }}
      </button>
      <button type="button" class="btn primary" :disabled="busy" @click="submit">
        {{ busy ? t('marketplace.ext.adding') : t('marketplace.ext.confirmAdd') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from 'vue'
import type { ExternalMcpProbeResult } from '@shared/ipc'
import type { ExternalMcpServer } from '@shared/externalMcp'
import { useStudioI18n } from '../../composables/useStudioI18n'
import StudioFloatingWindow from '../StudioFloatingWindow.vue'
import {
  createEmptyExternalMcpDraft,
  draftToExternalMcpServer,
  type ExternalMcpDraft
} from '../../features/marketplace/buildMarketplaceCards'

/**
 * 「添加 MCP 服务」对话框。
 *
 * 为什么是弹窗而不是页内表单：参数有 5–6 项、还要选接入方式，塞在卡片网格上方会把
 * 列表推下去且容易被误当成筛选区。弹窗与任务列表 / 执行日志等窗口同一套外壳，
 * 关掉就干净了。
 *
 * 表单本身不落盘：校验与预检通过后只把结果 `emit` 给父级，由它负责合并进设置
 * （`setSettings` 是整对象替换，只有父级知道当前完整设置）。
 */
const props = defineProps<{
  open: boolean
  /** 已有的服务 id：用于给新 id 去重 */
  existingIds: readonly string[]
}>()
const emit = defineEmits<{
  close: []
  /** 预检通过：父级负责落盘并展开新卡片 */
  added: [payload: { server: ExternalMcpServer; toolCount: number }]
}>()

const { t } = useStudioI18n()

const draft = reactive<ExternalMcpDraft>(createEmptyExternalMcpDraft())
const busy = ref(false)
const error = ref('')
const probedTools = ref<Array<{ name: string; description?: string }> | null>(null)
const nameInputEl = ref<HTMLInputElement | null>(null)

function reset(): void {
  Object.assign(draft, createEmptyExternalMcpDraft())
  busy.value = false
  error.value = ''
  probedTools.value = null
}

onMounted(async () => {
  await nextTick()
  nameInputEl.value?.focus()
})

/** 失败文案：reasonKey 走 locale；`marketplace.ext.reason.*` 还要把外部服务原文附上 */
function probeErrorText(result: ExternalMcpProbeResult): string {
  const key = result.reasonKey
  if (!key) return result.error ?? t('marketplace.ext.probeFailed')
  const label = t(key)
  const detail = key.startsWith('marketplace.ext.reason.') ? result.error?.trim() : ''
  return detail ? `${label}（${detail}）` : label
}

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = ''
  probedTools.value = null

  const converted = draftToExternalMcpServer(draft, props.existingIds)
  if (!converted.server) {
    // 由纯函数给出原因键：缺地址 / 地址非法 / 缺命令
    error.value = t(`marketplace.ext.${converted.reason}`)
    return
  }

  busy.value = true
  try {
    /**
     * 先探测再保存：连不上就不要留下来。
     *
     * 保存一条连不上的配置，用户只会在下次对话里发现「工具没出现」，而真正的原因
     * （地址错 / 401 / 命令不存在）只有这一层才知道。失败时把原因留在弹窗里让用户改。
     */
    const result = await window.studio.probeExternalMcp(converted.server)
    if (!result.ok) {
      error.value = probeErrorText(result)
      return
    }
    emit('added', { server: converted.server, toolCount: result.tools?.length ?? 0 })
    reset()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.add-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.field input,
.field select,
.field textarea {
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
}

.field textarea {
  font-family: var(--mono);
  resize: vertical;
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
}

/* stdio 会在本机跑第三方代码，提示必须显眼 */
.warning {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger-muted);
}

.ok {
  margin: 0;
  font-size: 12px;
  color: var(--success);
}

.tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow: auto;
}

.tools li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--text-muted);
}

.tools code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
}

.btn {
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: rgba(47, 107, 255, 0.22);
  border-color: rgba(47, 107, 255, 0.45);
}
</style>
