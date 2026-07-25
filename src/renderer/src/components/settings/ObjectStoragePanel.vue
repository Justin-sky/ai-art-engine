<template>
  <div class="oss-panel">
    <p class="hint">{{ t('settings.objectStorage.hint') }}</p>
    <p class="meta">{{ t('settings.objectStorage.singleEnabledHint') }}</p>

    <div class="toolbar">
      <label class="add-provider">
        <span>{{ t('settings.objectStorage.addProvider') }}</span>
        <select v-model="pendingProviderKind">
          <option v-for="p in providerKinds" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <button type="button" class="primary-btn" @click="addProvider">
        {{ t('settings.objectStorage.add') }}
      </button>
    </div>

    <p v-if="providers.length === 0" class="empty">{{ t('settings.objectStorage.emptyProviders') }}</p>

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
              ? t('settings.objectStorage.expandProvider')
              : t('settings.objectStorage.collapseProvider')
          "
          :title="
            isProviderCollapsed(provider.id)
              ? t('settings.objectStorage.expandProvider')
              : t('settings.objectStorage.collapseProvider')
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
            {{ t('settings.objectStorage.enabled') }}
          </label>
          <button type="button" class="danger" @click="removeProvider(provider.id)">
            {{ t('settings.objectStorage.remove') }}
          </button>
        </div>
      </header>

      <div v-show="!isProviderCollapsed(provider.id)" class="provider-body">
      <label>
        {{ t('settings.objectStorage.label') }}
        <input v-model="provider.label" />
      </label>

      <template v-if="provider.providerKind === 'volcengine-tos'">
        <p class="meta">{{ t('settings.objectStorage.tos.intro') }}</p>

        <label>
          {{ t('settings.objectStorage.tos.region') }}
          <select
            :value="provider.tos.region"
            @change="onTosRegionChange(provider, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="preset in tosRegionPresets" :key="preset.region" :value="preset.region">
              {{ preset.label }} ({{ preset.region }})
            </option>
            <option
              v-if="!isKnownTosRegion(provider.tos.region)"
              :value="provider.tos.region"
            >
              {{ t('settings.objectStorage.tos.customRegion') }} ({{ provider.tos.region }})
            </option>
          </select>
        </label>

        <label>
          {{ t('settings.objectStorage.tos.endpoint') }}
          <input
            v-model="provider.tos.endpoint"
            spellcheck="false"
            placeholder="https://tos-cn-beijing.volces.com"
          />
        </label>

        <label>
          Access Key ID
          <input v-model="provider.tos.accessKeyId" autocomplete="off" spellcheck="false" />
        </label>

        <label>
          Secret Access Key
          <div class="secret-field">
            <input
              v-model="provider.tos.accessKeySecret"
              :type="revealedSecrets[provider.id] ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="reveal-btn"
              :title="
                revealedSecrets[provider.id]
                  ? t('settings.objectStorage.hideSecret')
                  : t('settings.objectStorage.showSecret')
              "
              @click="revealedSecrets[provider.id] = !revealedSecrets[provider.id]"
            >
              <svg
                v-if="!revealedSecrets[provider.id]"
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
        <p class="meta credentials-hint">
          {{ t('settings.objectStorage.tos.getCredentialsHint') }}
          <a
            class="ext-link"
            href="https://console.volcengine.com/iam/keymanage"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://console.volcengine.com/iam/keymanage
          </a>
        </p>

        <label>
          {{ t('settings.objectStorage.tos.bucket') }}
          <input v-model="provider.tos.bucket" spellcheck="false" />
        </label>

        <label>
          {{ t('settings.objectStorage.tos.publicBaseUrl') }}
          <input
            v-model="provider.tos.publicBaseUrl"
            spellcheck="false"
            :placeholder="t('settings.objectStorage.tos.publicBaseUrlPlaceholder')"
          />
        </label>
      </template>

      <template v-else-if="provider.providerKind === 'aliyun-oss'">
        <p class="meta">{{ t('settings.objectStorage.oss.intro') }}</p>

        <label>
          {{ t('settings.objectStorage.oss.region') }}
          <select
            :value="provider.oss.region"
            @change="onOssRegionChange(provider, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="preset in ossRegionPresets" :key="preset.region" :value="preset.region">
              {{ preset.label }} ({{ preset.region }})
            </option>
            <option
              v-if="!isKnownOssRegion(provider.oss.region)"
              :value="provider.oss.region"
            >
              {{ t('settings.objectStorage.oss.customRegion') }} ({{ provider.oss.region }})
            </option>
          </select>
        </label>

        <label>
          {{ t('settings.objectStorage.oss.endpoint') }}
          <input
            v-model="provider.oss.endpoint"
            spellcheck="false"
            placeholder="https://oss-cn-hangzhou.aliyuncs.com"
          />
        </label>

        <label>
          AccessKey ID
          <input v-model="provider.oss.accessKeyId" autocomplete="off" spellcheck="false" />
        </label>

        <label>
          AccessKey Secret
          <div class="secret-field">
            <input
              v-model="provider.oss.accessKeySecret"
              :type="revealedSecrets[provider.id] ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="reveal-btn"
              :title="
                revealedSecrets[provider.id]
                  ? t('settings.objectStorage.hideSecret')
                  : t('settings.objectStorage.showSecret')
              "
              @click="revealedSecrets[provider.id] = !revealedSecrets[provider.id]"
            >
              <svg
                v-if="!revealedSecrets[provider.id]"
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
        <p class="meta credentials-hint">
          {{ t('settings.objectStorage.oss.getCredentialsHint') }}
          <a
            class="ext-link"
            href="https://ram.console.aliyun.com/manage/ak"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://ram.console.aliyun.com/manage/ak
          </a>
        </p>

        <label>
          {{ t('settings.objectStorage.oss.bucket') }}
          <input v-model="provider.oss.bucket" spellcheck="false" />
        </label>

        <label>
          {{ t('settings.objectStorage.oss.publicBaseUrl') }}
          <input
            v-model="provider.oss.publicBaseUrl"
            spellcheck="false"
            :placeholder="t('settings.objectStorage.oss.publicBaseUrlPlaceholder')"
          />
        </label>
      </template>

      <template v-else-if="provider.providerKind === 'tencent-cos'">
        <p class="meta">{{ t('settings.objectStorage.cos.intro') }}</p>

        <label>
          {{ t('settings.objectStorage.cos.region') }}
          <select
            :value="provider.cos.region"
            @change="onCosRegionChange(provider, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="preset in cosRegionPresets" :key="preset.region" :value="preset.region">
              {{ preset.label }} ({{ preset.region }})
            </option>
            <option
              v-if="!isKnownCosRegion(provider.cos.region)"
              :value="provider.cos.region"
            >
              {{ t('settings.objectStorage.cos.customRegion') }} ({{ provider.cos.region }})
            </option>
          </select>
        </label>

        <label>
          SecretId
          <input v-model="provider.cos.secretId" autocomplete="off" spellcheck="false" />
        </label>

        <label>
          SecretKey
          <div class="secret-field">
            <input
              v-model="provider.cos.secretKey"
              :type="revealedSecrets[provider.id] ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              type="button"
              class="reveal-btn"
              :title="
                revealedSecrets[provider.id]
                  ? t('settings.objectStorage.hideSecret')
                  : t('settings.objectStorage.showSecret')
              "
              @click="revealedSecrets[provider.id] = !revealedSecrets[provider.id]"
            >
              <svg
                v-if="!revealedSecrets[provider.id]"
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
        <p class="meta credentials-hint">
          {{ t('settings.objectStorage.cos.getCredentialsHint') }}
          <a
            class="ext-link"
            href="https://console.cloud.tencent.com/cam/capi"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://console.cloud.tencent.com/cam/capi
          </a>
        </p>

        <label>
          {{ t('settings.objectStorage.cos.bucket') }}
          <input
            v-model="provider.cos.bucket"
            spellcheck="false"
            :placeholder="t('settings.objectStorage.cos.bucketPlaceholder')"
          />
        </label>

        <label>
          {{ t('settings.objectStorage.cos.publicBaseUrl') }}
          <input
            v-model="provider.cos.publicBaseUrl"
            spellcheck="false"
            :placeholder="t('settings.objectStorage.cos.publicBaseUrlPlaceholder')"
          />
        </label>
      </template>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { AppSettings } from '@shared/domain'
import {
  ALIYUN_OSS_REGION_PRESETS,
  OBJECT_STORAGE_PROVIDER_KINDS,
  TENCENT_COS_REGION_PRESETS,
  VOLCENGINE_TOS_REGION_PRESETS,
  applyAliyunOssRegionPreset,
  applyTencentCosRegionPreset,
  applyVolcengineTosRegionPreset,
  createObjectStorageProvider,
  enableOnlyObjectStorageProvider,
  type ObjectStorageProviderInstance,
  type ObjectStorageProviderKind
} from '@shared/objectStorage'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  objectStorage: AppSettings['objectStorage']
}>()

const { t } = useStudioI18n()
const providerKinds = OBJECT_STORAGE_PROVIDER_KINDS
const tosRegionPresets = VOLCENGINE_TOS_REGION_PRESETS
const ossRegionPresets = ALIYUN_OSS_REGION_PRESETS
const cosRegionPresets = TENCENT_COS_REGION_PRESETS
const pendingProviderKind = ref<ObjectStorageProviderKind>('volcengine-tos')
const revealedSecrets = reactive<Record<string, boolean>>({})
/** true = 折叠；缺省为展开 */
const collapsedProviders = reactive<Record<string, boolean>>({})

const providers = computed(() => props.objectStorage.providers)

function isProviderCollapsed(providerId: string): boolean {
  return !!collapsedProviders[providerId]
}

function toggleProviderCollapsed(providerId: string): void {
  collapsedProviders[providerId] = !collapsedProviders[providerId]
}

function isKnownTosRegion(region: string): boolean {
  return tosRegionPresets.some((p) => p.region === region)
}

function isKnownOssRegion(region: string): boolean {
  return ossRegionPresets.some((p) => p.region === region)
}

function isKnownCosRegion(region: string): boolean {
  return cosRegionPresets.some((p) => p.region === region)
}

function addProvider(): void {
  const provider = createObjectStorageProvider(pendingProviderKind.value)
  // 已有启用项时，新添加的默认不抢占启用
  const hasEnabled = props.objectStorage.providers.some((p) => p.enabled)
  provider.enabled = !hasEnabled
  props.objectStorage.providers.push(provider)
  collapsedProviders[provider.id] = false
  if (provider.enabled) {
    enableOnlyObjectStorageProvider(props.objectStorage, provider.id)
  }
}

function onEnabledChange(id: string, enabled: boolean): void {
  if (enabled) {
    enableOnlyObjectStorageProvider(props.objectStorage, id)
    return
  }
  const provider = props.objectStorage.providers.find((p) => p.id === id)
  if (provider) provider.enabled = false
}

function removeProvider(id: string): void {
  const idx = props.objectStorage.providers.findIndex((p) => p.id === id)
  if (idx < 0) return
  const wasEnabled = props.objectStorage.providers[idx]!.enabled
  props.objectStorage.providers.splice(idx, 1)
  delete revealedSecrets[id]
  delete collapsedProviders[id]
  // 删掉当前启用项时，自动启用列表中的第一个
  if (wasEnabled && props.objectStorage.providers.length) {
    enableOnlyObjectStorageProvider(props.objectStorage, props.objectStorage.providers[0]!.id)
  }
}

function onTosRegionChange(provider: ObjectStorageProviderInstance, region: string): void {
  Object.assign(provider.tos, applyVolcengineTosRegionPreset(provider.tos, region))
}

function onOssRegionChange(provider: ObjectStorageProviderInstance, region: string): void {
  Object.assign(provider.oss, applyAliyunOssRegionPreset(provider.oss, region))
}

function onCosRegionChange(provider: ObjectStorageProviderInstance, region: string): void {
  Object.assign(provider.cos, applyTencentCosRegionPreset(provider.cos, region))
}
</script>

<style scoped>
.oss-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 280px;
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
  background: rgba(90, 140, 255, 0.25);
  border-color: rgba(90, 140, 255, 0.45);
}

.provider-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(12, 14, 16, 0.55);
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
  color: #f0a0a0;
  border-color: rgba(240, 120, 120, 0.35);
}

.credentials-hint {
  margin-top: -4px;
}

.ext-link {
  color: #8eb6ff;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.ext-link:hover {
  color: #b4ceff;
}
</style>
