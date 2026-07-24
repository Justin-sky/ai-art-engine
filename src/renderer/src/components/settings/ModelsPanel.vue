<template>
  <div class="models-panel">
    <p class="hint">{{ t('settings.models.unifiedHint') }}</p>

    <div class="toolbar">
      <label class="add-provider">
        <span>{{ t('settings.models.addProvider') }}</span>
        <select v-model="pendingProviderKind">
          <option v-for="p in providerKinds" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <button type="button" class="primary-btn" @click="addProvider">
        {{ t('settings.models.add') }}
      </button>
    </div>

    <p v-if="providers.length === 0" class="empty">{{ t('settings.models.emptyProviders') }}</p>

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
              ? t('settings.models.expandProvider')
              : t('settings.models.collapseProvider')
          "
          :title="
            isProviderCollapsed(provider.id)
              ? t('settings.models.expandProvider')
              : t('settings.models.collapseProvider')
          "
          @click="toggleProviderCollapsed(provider.id)"
        >
          <span class="chevron" aria-hidden="true">▾</span>
          <strong>{{ provider.label }}</strong>
          <span class="badge">{{ provider.providerKind }}</span>
        </button>
        <div class="head-actions">
          <label class="check" @click.stop>
            <input type="checkbox" v-model="provider.enabled" />
            {{ t('settings.models.enabled') }}
          </label>
          <button type="button" class="danger" @click="removeProvider(provider.id)">
            {{ t('settings.models.remove') }}
          </button>
        </div>
      </header>

      <div v-show="!isProviderCollapsed(provider.id)" class="provider-body">
      <label>
        {{ t('settings.models.label') }}
        <input v-model="provider.label" />
      </label>
      <label>
        {{ t('settings.models.baseUrl') }}
        <input v-model="provider.baseUrl" spellcheck="false" />
      </label>
      <label>
        API Key
        <div class="secret-field">
          <input
            v-model="provider.apiKey"
            :type="revealedKeys[provider.id] ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="reveal-btn"
            :aria-label="
              revealedKeys[provider.id]
                ? t('settings.models.hideApiKey')
                : t('settings.models.showApiKey')
            "
            :title="
              revealedKeys[provider.id]
                ? t('settings.models.hideApiKey')
                : t('settings.models.showApiKey')
            "
            @click="toggleKeyReveal(provider.id)"
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

      <div class="modality-tabs" role="tablist">
        <button
          v-for="mod in settingsModalitiesFor(provider)"
          :key="mod"
          type="button"
          role="tab"
          class="mod-tab"
          :class="{ active: currentModality(provider) === mod }"
          :aria-selected="currentModality(provider) === mod"
          @click="activeModality[provider.id] = mod"
        >
          {{ modalityTabLabel(provider, mod) }}
          <span
            v-if="modalityConfig(provider, mod).selectedModelIds.length"
            class="mod-count"
          >
            {{ modalityConfig(provider, mod).selectedModelIds.length }}
          </span>
        </button>
      </div>

      <p class="meta">{{ modalityHintText(provider) }}</p>

      <div v-if="!isArkVoiceModality(provider)" class="catalog-toolbar">
        <button
          type="button"
          :disabled="loadingKey === catalogKey(provider.id, currentModality(provider)) || !provider.apiKey.trim()"
          @click="refreshModels(provider, currentModality(provider))"
        >
          {{
            loadingKey === catalogKey(provider.id, currentModality(provider))
              ? t('settings.models.testingConnection')
              : t('settings.models.fetchModels')
          }}
        </button>
        <span
          v-if="catalogErrors[catalogKey(provider.id, currentModality(provider))]"
          class="err"
        >
          {{ catalogErrors[catalogKey(provider.id, currentModality(provider))] }}
        </span>
        <span
          v-else-if="(catalogs[catalogKey(provider.id, currentModality(provider))] ?? []).length"
          class="meta"
        >
          {{
            t('settings.models.catalogCount', {
              n: (catalogs[catalogKey(provider.id, currentModality(provider))] ?? []).length
            })
          }}
        </span>
      </div>

      <div class="manual-add">
        <input
          v-model="manualModelIds[catalogKey(provider.id, currentModality(provider))]"
          type="text"
          spellcheck="false"
          :placeholder="
            isArkVoiceModality(provider)
              ? t('settings.models.manualSpeakerPlaceholder')
              : t('settings.models.manualModelPlaceholder')
          "
          @keydown.enter.prevent="
            addManualModel(provider, currentModality(provider))
          "
        />
        <button
          type="button"
          @click="addManualModel(provider, currentModality(provider))"
        >
          {{
            isArkVoiceModality(provider)
              ? t('settings.models.manualSpeakerAdd')
              : t('settings.models.manualModelAdd')
          }}
        </button>
      </div>

      <p
        v-if="
          !isArkVoiceModality(provider) &&
          catalogs[catalogKey(provider.id, currentModality(provider))] &&
          !(catalogs[catalogKey(provider.id, currentModality(provider))] ?? []).length &&
          !catalogErrors[catalogKey(provider.id, currentModality(provider))]
        "
        class="meta empty-catalog"
      >
        {{ t('settings.models.emptyCatalog') }}
      </p>

      <p
        v-else-if="
          isArkVoiceModality(provider) &&
          !modalityConfig(provider, 'audio').selectedModelIds.length
        "
        class="meta empty-catalog"
      >
        {{ t('settings.models.emptySpeakers') }}
      </p>

      <div
        v-if="modalityCatalog(provider).length"
        class="model-list-wrap"
      >
        <div class="list-actions">
          <button
            v-if="!isArkVoiceModality(provider)"
            type="button"
            @click="selectAll(provider, currentModality(provider))"
          >
            {{ t('settings.models.selectAll') }}
          </button>
          <button type="button" @click="clearSelection(provider, currentModality(provider))">
            {{ t('settings.models.clearSelection') }}
          </button>
          <input
            v-model="filters[catalogKey(provider.id, currentModality(provider))]"
            class="filter"
            type="search"
            :placeholder="
              isArkVoiceModality(provider)
                ? t('settings.models.filterSpeakerPlaceholder')
                : t('settings.models.filterPlaceholder')
            "
          />
        </div>
        <ul class="model-list">
          <li
            v-for="model in modalityCatalog(provider)"
            :key="model.id"
          >
            <label class="check model-row">
              <input
                type="checkbox"
                :checked="
                  modalityConfig(provider, currentModality(provider)).selectedModelIds.includes(
                    model.id
                  )
                "
                @change="
                  toggleModel(
                    provider,
                    currentModality(provider),
                    model.id,
                    ($event.target as HTMLInputElement).checked
                  )
                "
              />
              <span class="model-text">
                <span class="model-name">{{ model.name }}</span>
                <span class="model-id">{{ model.id }}</span>
                <span v-if="capabilitySummary(model)" class="model-caps">{{
                  capabilitySummary(model)
                }}</span>
              </span>
            </label>
          </li>
        </ul>
      </div>

      <label
        v-if="modalityConfig(provider, currentModality(provider)).selectedModelIds.length"
      >
        {{
          isArkVoiceModality(provider)
            ? t('settings.models.defaultSpeaker')
            : t('settings.models.defaultModel')
        }}
        <select
          :value="modalityConfig(provider, currentModality(provider)).defaultModelId"
          @change="
            setDefaultModel(
              provider,
              currentModality(provider),
              ($event.target as HTMLSelectElement).value
            )
          "
        >
          <option
            v-for="id in modalityConfig(provider, currentModality(provider)).selectedModelIds"
            :key="id"
            :value="id"
          >
            {{ id }}
          </option>
        </select>
      </label>
      <p
        v-if="modalityConfig(provider, currentModality(provider)).selectedModelIds.length"
        class="meta"
      >
        {{
          t(
            isArkVoiceModality(provider)
              ? 'settings.models.selectedSpeakerCount'
              : 'settings.models.selectedCount',
            {
              n: modalityConfig(provider, currentModality(provider)).selectedModelIds.length
            }
          )
        }}
      </p>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { AppSettings } from '@shared/domain'
import {
  MODEL_MODALITIES,
  MODEL_PROVIDER_KINDS,
  catalogEntryFromModel,
  createProviderInstance,
  modalityConfig,
  syncModalityCatalogEntries,
  type CatalogModel,
  type ModelModality,
  type ModelProviderInstance,
  type ModelProviderKind
} from '@shared/openrouter'
import { resolveVolcengineArkModelCapabilities } from '@shared/modelProviders/volcengineArk/modelCapabilities'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { clearImageGenerateCapabilitiesCache } from '../../features/graph/model/imageGenerateCapabilities'
import { clearVideoGenerateCapabilitiesCache } from '../../features/graph/model/videoGenerateCapabilities'

const props = defineProps<{
  models: AppSettings['models']
}>()

const { t } = useStudioI18n()

/** OpenRouter 不展示音频；方舟展示「声音」页签（底层仍为 audio 模态） */
function settingsModalitiesFor(provider: ModelProviderInstance): ModelModality[] {
  if (provider.providerKind === 'volcengine-ark') {
    return [...MODEL_MODALITIES]
  }
  return MODEL_MODALITIES.filter((m) => m !== 'audio')
}

function modalityTabLabel(provider: ModelProviderInstance, mod: ModelModality): string {
  if (mod === 'audio' && provider.providerKind === 'volcengine-ark') {
    return t('settings.models.modality.audio')
  }
  return t(`settings.models.modality.${mod}`)
}

function isArkVoiceModality(provider: ModelProviderInstance): boolean {
  return provider.providerKind === 'volcengine-ark' && currentModality(provider) === 'audio'
}

/** 方舟声音：把已勾选手填 speaker 同步进本地列表，便于展示 */
function ensureArkVoiceCatalog(provider: ModelProviderInstance): void {
  if (!isArkVoiceModality(provider)) return
  const key = catalogKey(provider.id, 'audio')
  const sel = modalityConfig(provider, 'audio')
  const list = catalogs[key] ?? (catalogs[key] = [])
  const seen = new Set(list.map((m) => m.id))
  for (const id of sel.selectedModelIds) {
    if (!seen.has(id)) {
      list.push({ id, name: id, modality: 'audio' })
      seen.add(id)
    }
  }
}

function modalityCatalog(provider: ModelProviderInstance): CatalogModel[] {
  ensureArkVoiceCatalog(provider)
  return filteredCatalog(provider.id, currentModality(provider))
}

const providerKinds = MODEL_PROVIDER_KINDS
const pendingProviderKind = ref<ModelProviderKind>('openrouter')
const loadingKey = ref<string | null>(null)
const catalogs = reactive<Record<string, CatalogModel[]>>({})
const catalogErrors = reactive<Record<string, string>>({})
const filters = reactive<Record<string, string>>({})
const manualModelIds = reactive<Record<string, string>>({})
const revealedKeys = reactive<Record<string, boolean>>({})
const activeModality = reactive<Record<string, ModelModality>>({})
/** true = 折叠；缺省为展开 */
const collapsedProviders = reactive<Record<string, boolean>>({})

const providers = computed(() => props.models.providers)

function isProviderCollapsed(providerId: string): boolean {
  return !!collapsedProviders[providerId]
}

function toggleProviderCollapsed(providerId: string): void {
  collapsedProviders[providerId] = !collapsedProviders[providerId]
}

function catalogKey(providerId: string, modality: ModelModality): string {
  return `${providerId}:${modality}`
}

function currentModality(provider: ModelProviderInstance): ModelModality {
  const allowed = settingsModalitiesFor(provider)
  const mod = activeModality[provider.id] ?? 'text'
  return allowed.includes(mod) ? mod : 'text'
}

function modalityHintText(provider: ModelProviderInstance): string {
  const mod = currentModality(provider)
  if (provider.providerKind === 'volcengine-ark') {
    return t(`settings.models.arkModalityHint.${mod}`)
  }
  return t(`settings.models.modalityHint.${mod}`)
}

function toggleKeyReveal(providerId: string): void {
  revealedKeys[providerId] = !revealedKeys[providerId]
}

function addProvider(): void {
  const provider = createProviderInstance(pendingProviderKind.value)
  props.models.providers.push(provider)
  activeModality[provider.id] = 'text'
  collapsedProviders[provider.id] = false
}

function removeProvider(id: string): void {
  const idx = props.models.providers.findIndex((p) => p.id === id)
  if (idx >= 0) props.models.providers.splice(idx, 1)
  delete collapsedProviders[id]
  delete activeModality[id]
  delete revealedKeys[id]
  for (const mod of MODEL_MODALITIES) {
    const key = catalogKey(id, mod)
    delete catalogs[key]
    delete catalogErrors[key]
    delete filters[key]
    delete manualModelIds[key]
  }
}

async function refreshModels(
  provider: ModelProviderInstance,
  modality: ModelModality
): Promise<void> {
  const key = catalogKey(provider.id, modality)
  loadingKey.value = key
  catalogErrors[key] = ''
  try {
    if (typeof window.studio?.listModels !== 'function') {
      throw new Error(
        'window.studio.listModels 不可用：请完全退出并重新运行 npm run dev（preload 变更不会热更新）'
      )
    }
    const list = await window.studio.listModels({
      modality,
      providerInstanceId: provider.id,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerKind: provider.providerKind
    })
    catalogs[key] = list
    const sel = modalityConfig(provider, modality)
    const seen = new Set(list.map((m) => m.id))
    // 保留已勾选但不在远端目录的模型（手动添加 / 方舟音频 Resource ID）
    for (const id of sel.selectedModelIds) {
      if (!seen.has(id)) {
        const saved = sel.catalog?.[id]
        catalogs[key].push({
          id,
          name: saved?.name || id,
          modality,
          ...(saved?.capabilities ? { capabilities: saved.capabilities } : {})
        })
        seen.add(id)
      }
    }
    // 把分辨率 / 时长 / supported_frame_images 等能力写入设置快照
    syncModalityCatalogEntries(sel, catalogs[key])
    clearImageGenerateCapabilitiesCache()
    clearVideoGenerateCapabilitiesCache()
    if (sel.defaultModelId && !sel.selectedModelIds.includes(sel.defaultModelId)) {
      sel.defaultModelId = sel.selectedModelIds[0] ?? ''
    }
  } catch (e) {
    catalogs[key] = []
    catalogErrors[key] = e instanceof Error ? e.message : String(e)
  } finally {
    loadingKey.value = null
  }
}

function addManualModel(provider: ModelProviderInstance, modality: ModelModality): void {
  const key = catalogKey(provider.id, modality)
  const id = (manualModelIds[key] ?? '').trim()
  if (!id) return
  const list = catalogs[key] ?? (catalogs[key] = [])
  if (!list.some((m) => m.id === id)) {
    // 方舟视频/图片：手填接入点时附带静态能力，便于一并写入设置快照
    let capabilities: Record<string, unknown> | undefined
    if (provider.providerKind === 'volcengine-ark' && (modality === 'video' || modality === 'image')) {
      capabilities = resolveVolcengineArkModelCapabilities(id, id, modality) ?? undefined
    }
    list.unshift({ id, name: id, modality, ...(capabilities ? { capabilities } : {}) })
  }
  toggleModel(provider, modality, id, true)
  manualModelIds[key] = ''
}

function filteredCatalog(providerId: string, modality: ModelModality): CatalogModel[] {
  const key = catalogKey(providerId, modality)
  const q = (filters[key] ?? '').trim().toLowerCase()
  const list = catalogs[key] ?? []
  if (!q) return list
  return list.filter(
    (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
  )
}

function toggleModel(
  provider: ModelProviderInstance,
  modality: ModelModality,
  modelId: string,
  checked: boolean
): void {
  const sel = modalityConfig(provider, modality)
  if (checked) {
    if (!sel.selectedModelIds.includes(modelId)) sel.selectedModelIds.push(modelId)
    if (!sel.defaultModelId) sel.defaultModelId = modelId
    const fromList = (catalogs[catalogKey(provider.id, modality)] ?? []).find((m) => m.id === modelId)
    if (fromList) {
      sel.catalog = { ...(sel.catalog ?? {}), [modelId]: catalogEntryFromModel(fromList) }
    }
  } else {
    sel.selectedModelIds = sel.selectedModelIds.filter((id) => id !== modelId)
    if (sel.catalog?.[modelId]) {
      const next = { ...sel.catalog }
      delete next[modelId]
      sel.catalog = Object.keys(next).length ? next : undefined
    }
    if (sel.defaultModelId === modelId) {
      sel.defaultModelId = sel.selectedModelIds[0] ?? ''
    }
  }
  clearImageGenerateCapabilitiesCache()
  clearVideoGenerateCapabilitiesCache()
}

function selectAll(provider: ModelProviderInstance, modality: ModelModality): void {
  const sel = modalityConfig(provider, modality)
  const list = filteredCatalog(provider.id, modality)
  const set = new Set(sel.selectedModelIds)
  for (const m of list) set.add(m.id)
  sel.selectedModelIds = [...set]
  if (!sel.defaultModelId && sel.selectedModelIds.length) {
    sel.defaultModelId = sel.selectedModelIds[0]
  }
  syncModalityCatalogEntries(sel, catalogs[catalogKey(provider.id, modality)] ?? list)
  clearImageGenerateCapabilitiesCache()
  clearVideoGenerateCapabilitiesCache()
}

function clearSelection(provider: ModelProviderInstance, modality: ModelModality): void {
  const sel = modalityConfig(provider, modality)
  sel.selectedModelIds = []
  sel.defaultModelId = ''
  sel.catalog = undefined
  clearImageGenerateCapabilitiesCache()
  clearVideoGenerateCapabilitiesCache()
}

function setDefaultModel(
  provider: ModelProviderInstance,
  modality: ModelModality,
  modelId: string
): void {
  modalityConfig(provider, modality).defaultModelId = modelId
}

function capabilitySummary(model: CatalogModel): string {
  const caps = model.capabilities
  if (!caps) return ''
  const parts: string[] = []
  const voices = caps.supported_voices as string[] | undefined
  if (voices?.length) {
    parts.push(
      `voices: ${voices.slice(0, 6).join(', ')}${voices.length > 6 ? ` +${voices.length - 6}` : ''}`
    )
  }
  const resolutions = caps.supported_resolutions as string[] | undefined
  const ratios = caps.supported_aspect_ratios as string[] | undefined
  const durations = caps.supported_durations as number[] | undefined
  const frames = caps.supported_frame_images as string[] | undefined
  if (resolutions?.length) parts.push(resolutions.join('/'))
  if (ratios?.length) parts.push(ratios.slice(0, 4).join(', ') + (ratios.length > 4 ? '…' : ''))
  if (durations?.length) parts.push(`${Math.min(...durations)}–${Math.max(...durations)}s`)
  if (frames?.length) {
    const labels = frames.map((f) =>
      f === 'first_frame' ? '首帧' : f === 'last_frame' ? '尾帧' : f
    )
    parts.push(labels.join('+'))
  }
  const sp = caps.supported_parameters
  if (sp && typeof sp === 'object' && !Array.isArray(sp)) {
    const keys = Object.keys(sp as object)
    if (keys.length) parts.push(keys.slice(0, 5).join(', '))
  }
  return parts.join(' · ')
}
</script>

<style scoped>
.models-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 360px;
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
  width: 16px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
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
  background: rgba(255, 255, 255, 0.06);
}

.danger {
  color: #f0a0a0;
  border-color: rgba(240, 120, 120, 0.35);
}

.modality-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
}

.mod-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
}

.mod-tab:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.mod-tab.active {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.14);
}

.mod-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  background: rgba(90, 140, 255, 0.28);
  color: var(--text);
}

.catalog-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.manual-add {
  display: flex;
  gap: 8px;
  align-items: center;
}

.manual-add input {
  flex: 1;
  min-width: 0;
}

.empty-catalog {
  margin: 0;
}

.err {
  color: #f0a0a0;
  font-size: 12px;
}

.model-list-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.filter {
  flex: 1;
  min-width: 140px;
}

.model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.2);
}

.model-list li {
  border-bottom: 1px solid var(--border);
}

.model-list li:last-child {
  border-bottom: none;
}

.model-row {
  padding: 8px 10px;
  align-items: flex-start;
}

.model-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.model-name {
  color: var(--text);
  font-size: 13px;
}

.model-id,
.model-caps {
  color: var(--text-muted);
  font-size: 11px;
  word-break: break-all;
}
</style>
