<template>
  <div class="char-refs-editor">
    <div class="head">
      <span class="title">角色绑定</span>
      <span class="count">{{ refs.length }}/{{ cap }}</span>
      <button
        type="button"
        class="import-btn"
        @click="togglePicker"
      >
        {{ pickerOpen ? '收起' : '从世界目录导入' }}
      </button>
    </div>
    <p class="hint">
      绑定世界人物目录的角色参考图，生成时注入参考图以保证跨分镜同人。
    </p>

    <div
      v-if="refs.length"
      class="bound-list"
    >
      <div
        v-for="(ref, index) in refs"
        :key="`${ref.name}:${index}`"
        class="bound-item"
      >
        <img
          v-if="thumbs[ref.imageUrl ?? '']"
          :src="thumbs[ref.imageUrl ?? '']"
          class="thumb"
          alt=""
        >
        <span
          v-else
          class="thumb placeholder"
        />
        <span class="name">{{ ref.name }}</span>
        <button
          type="button"
          class="remove-btn"
          :title="'移除'"
          @click="removeRef(index)"
        >
          ×
        </button>
      </div>
    </div>
    <p
      v-else
      class="empty"
    >
      尚未绑定角色
    </p>

    <div
      v-if="pickerOpen"
      class="picker"
    >
      <p
        v-if="loading"
        class="picker-hint"
      >
        正在加载世界角色目录…
      </p>
      <p
        v-else-if="available.length === 0"
        class="picker-hint"
      >
        世界人物目录中没有已生成图片的角色
      </p>
      <div
        v-else
        class="catalog-list"
      >
        <button
          v-for="item in available"
          :key="item.name"
          type="button"
          class="catalog-item"
          :disabled="!canAdd"
          @click="addRef(item)"
        >
          <img
            v-if="thumbs[item.imageUrl]"
            :src="thumbs[item.imageUrl]"
            class="thumb"
            alt=""
          >
          <span
            v-else
            class="thumb placeholder"
          />
          <span class="name">{{ item.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { WorldEntityRef } from '@shared/domain'
import {
  DEFAULT_MAX_INPUT_REFERENCES,
  type CharacterReferenceImage
} from '@shared/graph'
import { loadWorldCharacterImages } from '../features/world/characterImageSource'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'

const props = defineProps<{
  modelValue: WorldEntityRef[]
  max?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: WorldEntityRef[]]
}>()

const cap = computed(() =>
  Math.max(0, Math.floor(props.max ?? DEFAULT_MAX_INPUT_REFERENCES))
)
const refs = computed<WorldEntityRef[]>(() => props.modelValue ?? [])

const pickerOpen = ref(false)
const loading = ref(false)
const catalog = ref<CharacterReferenceImage[]>([])
const thumbs = ref<Record<string, string>>({})

const boundNames = computed(
  () => new Set(refs.value.map((ref) => ref.name.trim()).filter(Boolean))
)
const available = computed(() =>
  catalog.value.filter((item) => !boundNames.value.has(item.name.trim()))
)
const canAdd = computed(() => refs.value.length < cap.value)

async function resolveThumb(url: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  return resolveAssetPreviewUrl(url)
}

async function refreshThumbs(): Promise<void> {
  const urls = new Set<string>()
  for (const ref of refs.value) if (ref.imageUrl) urls.add(ref.imageUrl)
  for (const item of catalog.value) urls.add(item.imageUrl)
  const next: Record<string, string> = {}
  await Promise.all(
    [...urls].map(async (url) => {
      const resolved = await resolveThumb(url)
      if (resolved) next[url] = resolved
    })
  )
  thumbs.value = next
}

async function togglePicker(): Promise<void> {
  pickerOpen.value = !pickerOpen.value
  if (!pickerOpen.value) return
  if (!catalog.value.length) {
    loading.value = true
    try {
      catalog.value = loadWorldCharacterImages()
    } finally {
      loading.value = false
    }
  }
  await refreshThumbs()
}

function addRef(item: CharacterReferenceImage): void {
  if (!canAdd.value) return
  if (boundNames.value.has(item.name.trim())) return
  emit('update:modelValue', [
    ...refs.value,
    { name: item.name, imageUrl: item.imageUrl }
  ])
}

function removeRef(index: number): void {
  emit(
    'update:modelValue',
    refs.value.filter((_, i) => i !== index)
  )
}

onMounted(() => {
  void refreshThumbs()
})
</script>

<style scoped>
.char-refs-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.count {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.import-btn {
  margin-left: auto;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
}
.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}
.bound-list,
.catalog-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bound-item,
.catalog-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--bg-input);
}
.catalog-item {
  border: 1px solid var(--border);
  cursor: pointer;
}
.catalog-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--bg-hover);
}
.thumb.placeholder {
  display: inline-block;
  flex: none;
}
.name {
  font-size: 12px;
  color: var(--text-primary);
}
.remove-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.remove-btn:hover {
  color: var(--danger);
  background: var(--bg-hover);
}
.empty,
.picker-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}
</style>
