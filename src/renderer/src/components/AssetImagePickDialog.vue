<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('director.stage.blockoutLibraryTitle')"
    :subtitle="t('director.stage.blockoutLibrarySubtitle', { max: remaining })"
    :z-index="2600"
    :default-width="720"
    :default-height="560"
    :min-width="480"
    :min-height="360"
    @close="emit('cancel')"
  >
    <div class="toolbar">
      <input
        v-model="query"
        class="search"
        type="search"
        :placeholder="t('common.search')"
      >
    </div>
    <div
      v-if="!visibleAssets.length"
      class="empty"
    >
      {{ query.trim() ? t('director.stage.blockoutLibraryNoMatch') : t('director.stage.blockoutLibraryEmpty') }}
    </div>
    <div
      v-else
      class="library"
      role="listbox"
    >
      <button
        v-for="asset in visibleAssets"
        :key="asset.id"
        type="button"
        class="card"
        role="option"
        :class="{
          selected: pending.has(asset.id),
          disabled: isLocked(asset.id),
          full: !pending.has(asset.id) && !canToggle(asset.id)
        }"
        :disabled="isLocked(asset.id) || (!pending.has(asset.id) && !canToggle(asset.id))"
        :title="asset.name"
        :aria-selected="pending.has(asset.id)"
        @click="toggle(asset.id)"
        @dblclick="pickOne(asset.id)"
      >
        <img
          v-if="thumbUrls[asset.id]"
          :src="thumbUrls[asset.id]"
          :alt="asset.name"
        >
        <span
          v-else
          class="thumb-fallback"
        >🖼</span>
        <span
          class="caption"
          :title="asset.name"
        >{{ asset.name }}</span>
        <span
          v-if="isLocked(asset.id)"
          class="badge"
        >{{ t('director.stage.blockoutLibraryAdded') }}</span>
      </button>
    </div>

    <template #footer>
      <span class="footer-hint">
        {{ t('director.stage.blockoutLibraryPicked', { n: pending.size, max: remaining }) }}
      </span>
      <button
        type="button"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="primary"
        :disabled="!pending.size"
        @click="confirm"
      >
        {{ t('common.confirm') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AssetInfo } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  /** 已作为参考图的资产，不可再选 */
  selectedAssetIds: string[]
  /** 本次还可新增的数量 */
  remaining: number
}>()

const emit = defineEmits<{
  confirm: [assetIds: string[]]
  cancel: []
}>()

const { t } = useStudioI18n()
const project = useProjectStore()
const query = ref('')
const pending = ref<Set<string>>(new Set())
const thumbUrls = ref<Record<string, string>>({})
let thumbToken = 0

const imageAssets = computed(() =>
  project.assets.filter((asset) => asset.type === 'image' && asset.relativePath)
)

const visibleAssets = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = imageAssets.value
  if (!q) return list
  return list.filter((asset) => asset.name.toLowerCase().includes(q))
})

const locked = computed(() => new Set(props.selectedAssetIds))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pending.value = new Set()
    query.value = ''
    void resolveThumbs(imageAssets.value)
  }
)

watch(imageAssets, (assets) => {
  if (!props.open) return
  void resolveThumbs(assets)
})

async function resolveThumbs(assets: AssetInfo[]): Promise<void> {
  const token = ++thumbToken
  const next = { ...thumbUrls.value }
  await Promise.all(
    assets.map(async (asset) => {
      if (next[asset.id]) return
      const path = asset.thumbnailPath?.trim() || asset.relativePath?.trim() || ''
      if (!path) return
      try {
        next[asset.id] = await resolveAssetPreviewUrl(path)
      } catch {
        /* keep fallback */
      }
    })
  )
  if (token !== thumbToken) return
  thumbUrls.value = next
}

function isLocked(id: string): boolean {
  return locked.value.has(id)
}

function canToggle(id: string): boolean {
  if (isLocked(id)) return false
  if (pending.value.has(id)) return true
  return pending.value.size < props.remaining
}

function toggle(id: string): void {
  if (isLocked(id) || props.remaining <= 0) return
  const next = new Set(pending.value)
  if (next.has(id)) next.delete(id)
  else if (next.size < props.remaining) next.add(id)
  pending.value = next
}

function pickOne(id: string): void {
  if (isLocked(id) || props.remaining <= 0) return
  emit('confirm', [id])
}

function confirm(): void {
  const ids = imageAssets.value.map((asset) => asset.id).filter((id) => pending.value.has(id))
  if (!ids.length) return
  emit('confirm', ids)
}
</script>

<style scoped>
.toolbar {
  display: flex;
  margin: 0 0 10px;
}

.search {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}

.search:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}

.empty {
  padding: 36px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.library {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  padding: 4px 2px 8px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
  color: inherit;
  cursor: pointer;
}

.card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--bg-hover);
}

.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.card:disabled,
.card.disabled,
.card.full {
  opacity: 0.55;
  cursor: default;
}

.card img,
.thumb-fallback {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: var(--graph-preview-bg, var(--bg-input));
  display: block;
}

.thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.caption {
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-muted);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card.selected .caption {
  color: var(--text);
}

.badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 75%, #000);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
}

.footer-hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.primary {
  border: none;
  background: var(--accent, #4a90e2);
  color: #fff;
}
</style>
