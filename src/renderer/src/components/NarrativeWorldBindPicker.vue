<template>
  <div class="bind-picker-overlay" @click.self="emit('close')">
    <div class="bind-picker" role="dialog" :aria-label="t('narrative.table.bind.title')">
      <header class="bind-head">
        <strong>{{ t('narrative.table.bind.title') }}</strong>
        <button type="button" class="close" :title="t('narrative.dialog.close')" @click="emit('close')">
          ×
        </button>
      </header>

      <p v-if="!items.length" class="empty">{{ emptyText }}</p>

      <div v-else class="sections">
        <section v-for="group in groups" :key="group.type" class="section">
          <h3>{{ group.label }}</h3>
          <div v-if="!group.items.length" class="section-empty">—</div>
          <div v-else class="grid">
            <button
              v-for="(item, index) in group.items"
              :key="`${item.type}:${item.name}:${index}`"
              type="button"
              class="card"
              :title="item.name"
              @click="onSelect(item)"
            >
              <img v-if="thumbUrl(item)" :src="thumbUrl(item)" :alt="item.name" />
              <div v-else class="thumb-fallback">?</div>
              <span>{{ item.name }}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { NarrativeWorldRef, WorldElementGenResult, WorldElementOutputType } from '@shared/graph'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = withDefaults(
  defineProps<{
    items: WorldElementGenResult[]
    /** 打开绑定时的列类型，用于默认高亮该分组（仍展示全部四类） */
    focusType?: WorldElementOutputType
    emptyText?: string
  }>(),
  {
    emptyText: ''
  }
)

const emit = defineEmits<{
  select: [ref: NarrativeWorldRef]
  close: []
}>()

const { t } = useStudioI18n()
const emptyText = computed(
  () =>
    props.emptyText?.trim() ||
    t('shot.table.bind.empty')
)


const TYPES: WorldElementOutputType[] = ['角色', '场景', '道具', '武器']

const groups = computed(() => {
  const ordered = props.focusType
    ? [props.focusType, ...TYPES.filter((type) => type !== props.focusType)]
    : TYPES
  return ordered.map((type) => ({
    type,
    label:
      type === '角色'
        ? t('narrative.table.column.characters')
        : type === '场景'
          ? t('narrative.table.column.scenes')
          : type === '道具'
            ? t('narrative.table.column.props')
            : t('narrative.table.column.weapons'),
    items: props.items.filter((item) => item.type === type)
  }))
})

const thumbUrls = ref<Record<string, string>>({})
let thumbToken = 0

function itemKey(item: WorldElementGenResult): string {
  return `${item.type}:${item.name}:${item.imageUrl}`
}

function thumbUrl(item: WorldElementGenResult): string {
  const url = item.imageUrl?.trim() || ''
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:') || /^https?:/i.test(url)) return url
  return thumbUrls.value[itemKey(item)] || ''
}

watch(
  () => props.items,
  async (items) => {
    const token = ++thumbToken
    const next: Record<string, string> = {}
    await Promise.all(
      items.map(async (item) => {
        const url = item.imageUrl?.trim() || ''
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || /^https?:/i.test(url)) {
          return
        }
        try {
          const resolved = await resolveAssetPreviewUrl(url)
          if (token !== thumbToken) return
          next[itemKey(item)] = resolved
        } catch {
          /* ignore broken preview */
        }
      })
    )
    if (token === thumbToken) thumbUrls.value = next
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  thumbToken += 1
})

function onSelect(item: WorldElementGenResult): void {
  emit('select', {
    name: item.name,
    imageUrl: item.imageUrl,
    type: item.type
  })
}
</script>

<style scoped>
.bind-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  padding: 24px;
}

.bind-picker {
  width: min(920px, 100%);
  max-height: min(720px, 90vh);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 40px color-mix(in srgb, #000 35%, transparent);
  overflow: hidden;
}

.bind-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.bind-head strong {
  font-size: 14px;
}

.close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
}

.sections {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section h3 {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 600;
}

.section-empty,
.empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.empty {
  padding: 32px 16px;
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.card:hover {
  border-color: var(--accent, #5b8def);
}

.card img,
.thumb-fallback {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 6px;
  background: var(--bg);
}

.thumb-fallback {
  display: grid;
  place-items: center;
  color: var(--text-muted);
}

.card span {
  font-size: 11px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
