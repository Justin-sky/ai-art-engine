<template>
  <div class="search-panel">
    <p class="hint">
      {{ t('settings.search.hint') }}
    </p>

    <div class="toolbar">
      <label class="add-provider">
        <span>{{ t('settings.search.addProvider') }}</span>
        <select v-model="pendingProviderKind">
          <option v-for="p in providerKinds" :key="p.id" :value="p.id">{{ kindLabel(p) }}</option>
        </select>
      </label>
      <button type="button" class="primary-btn" @click="addProvider">
        {{ t('settings.search.add') }}
      </button>
    </div>

    <p v-if="providers.length === 0" class="empty">
      {{ t('settings.search.emptyProviders') }}
    </p>

    <article
      v-for="provider in providers"
      :key="provider.id"
      class="provider-card"
      :class="{ collapsed: isProviderCollapsed(provider.id) }"
    >
      <header class="provider-head">
        <button
          type="button"
          class="collapse-toggle"
          :aria-expanded="!isProviderCollapsed(provider.id)"
          :aria-label="
            isProviderCollapsed(provider.id)
              ? t('settings.search.expandProvider')
              : t('settings.search.collapseProvider')
          "
          :title="
            isProviderCollapsed(provider.id)
              ? t('settings.search.expandProvider')
              : t('settings.search.collapseProvider')
          "
          @click="toggleProviderCollapsed(provider.id)"
        >
          <span class="chevron" aria-hidden="true">▾</span>
          <strong>{{ provider.label }}</strong>
          <span class="badge">{{ provider.providerKind }}</span>
        </button>
        <div class="head-actions">
          <label class="check" @click.stop>
            <input
              type="checkbox"
              :checked="provider.enabled"
              @change="onEnabledChange(provider.id, ($event.target as HTMLInputElement).checked)"
            />
            {{ t('settings.search.enabled') }}
          </label>
          <button type="button" class="danger" @click="removeProvider(provider.id)">
            {{ t('settings.search.remove') }}
          </button>
        </div>
      </header>

      <div v-show="!isProviderCollapsed(provider.id)" class="provider-body">
        <label>
          {{ t('settings.search.label') }}
          <input v-model="provider.label" />
        </label>

        <label>
          {{ t('settings.search.apiKey') }}
          <div class="secret-field">
            <input
              v-model="provider.apiKey"
              :type="revealedKeys[provider.id] ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('settings.search.apiKeyPlaceholder')"
            />
            <button
              type="button"
              class="reveal-btn"
              :title="
                revealedKeys[provider.id]
                  ? t('settings.objectStorage.hideSecret')
                  : t('settings.objectStorage.showSecret')
              "
              @click="revealedKeys[provider.id] = !revealedKeys[provider.id]"
            >
              <svg
                v-if="!revealedKeys[provider.id]"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z"
                />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2.1 3.51 3.5 2.1l18.4 18.4-1.41 1.41-3.17-3.17A12.3 12.3 0 0 1 12 19c-5 0-9.27-3.11-11-7a13.4 13.4 0 0 1 4.68-5.41L2.1 3.51zM12 7a5 5 0 0 1 4.9 4.03l-1.56-1.56A3 3 0 0 0 12 9c-.4 0-.78.08-1.13.23L9.3 7.66A4.9 4.9 0 0 1 12 7zm9.9 4.49A13.4 13.4 0 0 0 17.4 7.4l-1.5 1.5c.9.7 1.67 1.55 2.27 2.51-.9 1.72-2.4 3.2-4.3 4.2l1.55 1.55c2.2-1.2 4.02-3.05 5.18-5.27a.75.75 0 0 0 0-.4z"
                />
              </svg>
            </button>
          </div>
        </label>

        <label>
          {{ t('settings.search.baseUrl') }}
          <input
            v-model="provider.baseUrl"
            spellcheck="false"
            :placeholder="t('settings.search.baseUrlPlaceholder')"
          />
        </label>

        <p class="meta">
          {{ t('settings.search.capabilitiesLabel') }}:
          <span v-for="cap in kindCapabilities(provider.providerKind)" :key="cap" class="badge">
            {{ t(`settings.search.capabilities.${cap}`) }}
          </span>
        </p>

        <p class="meta credentials-hint">
          {{ t('settings.search.getKeyHint') }}:
          <a
            class="ext-link"
            :href="searchProviderCredentialsUrl(provider.providerKind)"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ searchProviderCredentialsUrl(provider.providerKind) }}
          </a>
        </p>

        <div class="test-row">
          <button
            type="button"
            class="primary-btn"
            :disabled="testing[provider.id]"
            @click="testConnection(provider.id)"
          >
            {{ testing[provider.id] ? '…' : t('settings.search.testConnection') }}
          </button>
          <span v-if="testStatus[provider.id] === 'ok'" class="test-status ok">{{
            t('settings.search.testOk')
          }}</span>
          <span v-else-if="testStatus[provider.id] === 'failed'" class="test-status failed">{{
            testError[provider.id] || t('settings.search.testFailed')
          }}</span>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { AppSettings } from '@shared/domain'
import {
  SEARCH_PROVIDER_KINDS,
  createSearchProviderInstance,
  searchProviderCredentialsUrl,
  type SearchCapability,
  type SearchProviderKind,
  type SearchProviderKindMeta,
  type SearchSettings
} from '@shared/searchProvider'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  search: SearchSettings
}>()

const emit = defineEmits<{
  (e: 'test-message', payload: { ok: boolean; message: string }): void
}>()

const { t } = useStudioI18n()

/** UI 仅暴露可被真实配置的 provider；mock-search 调试用不出现在下拉里 */
const providerKinds = computed<readonly SearchProviderKindMeta[]>(() =>
  SEARCH_PROVIDER_KINDS.filter((p) => p.id !== 'mock-search')
)
const pendingProviderKind = ref<SearchProviderKind>(providerKinds.value[0]?.id ?? 'deepseek-search')

const revealedKeys = reactive<Record<string, boolean>>({})
const collapsedProviders = reactive<Record<string, boolean>>({})
const testing = reactive<Record<string, boolean>>({})
const testStatus = reactive<Record<string, 'ok' | 'failed' | undefined>>({})
const testError = reactive<Record<string, string>>({})

const providers = computed(() => props.search.providers)

function isProviderCollapsed(providerId: string): boolean {
  return !!collapsedProviders[providerId]
}

function toggleProviderCollapsed(providerId: string): void {
  collapsedProviders[providerId] = !collapsedProviders[providerId]
}

function kindLabel(p: SearchProviderKindMeta): string {
  if (p.labelKey) return t(p.labelKey)
  return p.label
}

function kindCapabilities(kind: SearchProviderKind): readonly SearchCapability[] {
  return SEARCH_PROVIDER_KINDS.find((p) => p.id === kind)?.capabilities ?? []
}

/** 当切换 providerKind 时，若 baseUrl 与旧 meta 默认 URL 一致则同步更新到新默认值；保留用户自定义值 */
function syncBaseUrlOnKindChange(provider: ReturnType<typeof createSearchProviderInstance>): void {
  const meta = SEARCH_PROVIDER_KINDS.find((p) => p.id === provider.providerKind)
  if (!meta) return
  provider.baseUrl = meta.defaultBaseUrl
  provider.label = meta.label
}

function addProvider(): void {
  const provider = createSearchProviderInstance(pendingProviderKind.value)
  syncBaseUrlOnKindChange(provider)
  // eslint-disable-next-line vue/no-mutating-props
  props.search.providers.push(provider)
  collapsedProviders[provider.id] = false
  delete testStatus[provider.id]
  delete testError[provider.id]
}

function removeProvider(id: string): void {
  const idx = props.search.providers.findIndex((p) => p.id === id)
  if (idx < 0) return
  // eslint-disable-next-line vue/no-mutating-props
  props.search.providers.splice(idx, 1)
  delete revealedKeys[id]
  delete collapsedProviders[id]
  delete testing[id]
  delete testStatus[id]
  delete testError[id]
}

function onEnabledChange(id: string, enabled: boolean): void {
  const provider = props.search.providers.find((p) => p.id === id)
  if (provider) provider.enabled = enabled
}

async function testConnection(id: string): Promise<void> {
  if (testing[id]) return
  testing[id] = true
  delete testStatus[id]
  delete testError[id]
  try {
    await window.studio.testSearchProvider({ id })
    testStatus[id] = 'ok'
    emit('test-message', { ok: true, message: t('settings.search.testOk') })
  } catch (e) {
    testStatus[id] = 'failed'
    testError[id] = e instanceof Error ? e.message : String(e)
    emit('test-message', { ok: false, message: testError[id] })
  } finally {
    delete testing[id]
  }
}

/** AppSettings 反向引用类型守卫（避免 renderer 因 SearchSettings 字段被裁剪而类型退化） */
export type _AppSettings = AppSettings
</script>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 220px;
}

.hint,
.meta,
.empty {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}

.add-provider {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 160px;
  color: var(--text-muted);
}

.primary-btn {
  background: var(--accent-25);
  border-color: var(--accent-45);
}

.provider-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-inset);
}

.provider-card.collapsed {
  gap: 0;
}

.provider-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.collapse-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 4px 2px 0;
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.collapse-toggle:hover {
  color: var(--text);
}

.collapse-toggle .chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 24px;
  line-height: 1;
  transition: transform 0.15s ease;
}

.provider-card.collapsed .collapse-toggle .chevron {
  transform: rotate(-90deg);
}

.collapse-toggle strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
}

.badge:not(:last-child) {
  margin-right: 4px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.check input {
  width: auto;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.secret-field {
  position: relative;
  display: flex;
  align-items: center;
}

.secret-field input {
  width: 100%;
  padding-right: 36px;
}

.reveal-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.reveal-btn:hover {
  color: var(--text);
  background: var(--wash-06);
}

.danger {
  color: var(--danger-muted);
  border-color: rgba(240, 120, 120, 0.35);
}

.credentials-hint {
  margin-top: -4px;
}

.ext-link {
  color: var(--accent-fg);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.ext-link:hover {
  color: var(--accent-fg);
}

.test-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}

.test-status {
  font-size: 12px;
}

.test-status.ok {
  color: var(--success);
}

.test-status.failed {
  color: var(--danger-muted);
  word-break: break-word;
}
</style>
