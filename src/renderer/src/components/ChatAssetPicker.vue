<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('studio.chat.mentionTitle')"
    :subtitle="t('studio.chat.mentionSubtitle')"
    :z-index="2600"
    :default-width="640"
    :default-height="480"
    :min-width="420"
    :min-height="320"
    @close="emit('cancel')"
  >
    <div class="toolbar">
      <div class="type-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          class="type-tab"
          :class="{ active: typeFilter === tab.value }"
          @click="typeFilter = tab.value"
        >
          {{ tab.label }}
          <span class="count">{{ countByType(tab.value) }}</span>
        </button>
      </div>
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
      {{ query.trim() ? t('studio.chat.mentionNoMatch') : t('studio.chat.mentionEmpty') }}
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
          excluded: excluded.has(asset.id)
        }"
        :disabled="excluded.has(asset.id)"
        :title="asset.name"
        :aria-selected="pending.has(asset.id)"
        @click="toggle(asset.id)"
        @dblclick="pickOne(asset.id)"
      >
        <div
          v-if="asset.type === 'voice'"
          class="thumb thumb-fallback"
        >
          <span class="fallback-icon">🎵</span>
          <span class="type-badge">{{ typeLabel(asset) }}</span>
        </div>
        <div
          v-else-if="thumbUrls[asset.id]"
          class="thumb"
        >
          <img
            :src="thumbUrls[asset.id]"
            :alt="asset.name"
          >
          <span class="type-badge">{{ typeLabel(asset) }}</span>
        </div>
        <div
          v-else
          class="thumb thumb-fallback"
        >
          <span class="fallback-icon">{{ asset.type === 'video' ? '🎬' : '🖼️' }}</span>
          <span class="type-badge">{{ typeLabel(asset) }}</span>
        </div>
        <span
          class="caption"
          :title="asset.name"
        >{{ asset.name }}</span>
      </button>
    </div>

    <template #footer>
      <span class="footer-hint">
        {{ pending.size ? t('studio.chat.mentionPicked', { n: pending.size }) : t('studio.chat.mentionHint') }}
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
import type { AssetInfo, AssetType } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useProjectStore } from '../stores/project'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

/** 可被 @ 引用的资产类型：图片 / 视频 / 音频（voice 为工程语音资产） */
const MENTION_TYPES: ReadonlySet<AssetType> = new Set(['image', 'video', 'voice'])
const TYPE_LABEL_KEY: Record<string, string> = {
  image: 'studio.chat.mentionTypeImage',
  video: 'studio.chat.mentionTypeVideo',
  voice: 'studio.chat.mentionTypeAudio'
}

const props = defineProps<{
  open: boolean
  /** 已引用资产路径（去重） */
  excludedPaths: string[]
}>()

const emit = defineEmits<{
  confirm: [relativePaths: string[]]
  cancel: []
}>()

const { t } = useStudioI18n()
const project = useProjectStore()
const query = ref('')
const typeFilter = ref<'all' | 'image' | 'video' | 'voice'>('all')
const pending = ref<Set<string>>(new Set())
const thumbUrls = ref<Record<string, string>>({})
let thumbToken = 0

const tabs = computed(() => [
  { value: 'all' as const, label: t('studio.chat.mentionTypeAll') },
  { value: 'image' as const, label: t('studio.chat.mentionTypeImage') },
  { value: 'video' as const, label: t('studio.chat.mentionTypeVideo') },
  { value: 'voice' as const, label: t('studio.chat.mentionTypeAudio') }
])

const mentionAssets = computed(() =>
  project.assets.filter((asset) => MENTION_TYPES.has(asset.type) && asset.relativePath?.trim())
)

const excluded = computed(() => new Set(props.excludedPaths.map((p) => p.replace(/\\/g, '/'))))

const visibleAssets = computed(() => {
  const q = query.value.trim().toLowerCase()
  return mentionAssets.value.filter((asset) => {
    if (typeFilter.value !== 'all' && asset.type !== typeFilter.value) return false
    if (!q) return true
    return asset.name.toLowerCase().includes(q)
  })
})

function countByType(type: 'all' | AssetType): number {
  if (type === 'all') return mentionAssets.value.length
  return mentionAssets.value.filter((a) => a.type === type).length
}

function typeLabel(asset: AssetInfo): string {
  return t(TYPE_LABEL_KEY[asset.type] ?? 'studio.chat.mentionTypeFile')
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pending.value = new Set()
    query.value = ''
    typeFilter.value = 'all'
    void resolveThumbs(mentionAssets.value)
  }
)

watch(mentionAssets, (assets) => {
  if (!props.open) return
  void resolveThumbs(assets)
})

async function resolveThumbs(assets: AssetInfo[]): Promise<void> {
  const token = ++thumbToken
  const next = { ...thumbUrls.value }
  await Promise.all(
    assets.map(async (asset) => {
      if (next[asset.id]) return
      // 音频资产没有可视化缩略图，直接显示图标，避免用 <img> 加载音频文件出现破损图
      if (asset.type === 'voice') return
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

function toggle(id: string): void {
  if (excluded.value.has(id)) return
  const next = new Set(pending.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  pending.value = next
}

function pickOne(id: string): void {
  if (excluded.value.has(id)) return
  const paths = mentionAssets.value.filter((a) => a.id === id).map((a) => a.relativePath.trim())
  if (paths.length) emit('confirm', paths)
}

function confirm(): void {
  const paths = mentionAssets.value
    .filter((a) => pending.value.has(a.id))
    .map((a) => a.relativePath.trim())
    .filter(Boolean)
  if (!paths.length) return
  emit('confirm', paths)
}
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 0 10px;
}

.type-tabs {
  display: flex;
  gap: 6px;
}

.type-tab {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

.type-tab.active {
  border-color: var(--accent-45);
  background: var(--accent-18);
  color: var(--accent-fg);
}

.type-tab .count {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.7;
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
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
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
.card.excluded {
  opacity: 0.55;
  cursor: default;
}

.thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: var(--graph-preview-bg, var(--bg-input));
  display: block;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.fallback-icon {
  font-size: 32px;
  line-height: 1;
  opacity: 0.85;
}

.type-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 75%, #000);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
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
