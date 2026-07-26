<template>
  <div ref="rootEl" class="style-image-picker" :class="{ readonly }">
    <template v-if="showHeader">
      <div class="head">
        <span class="label">{{ label || t('stylePicker.label') }}</span>
        <span class="count">{{ items.length }}/{{ max }}</span>
      </div>

      <p v-if="hint" class="hint">{{ hint }}</p>
      <p v-else-if="readonly" class="hint">{{ t('stylePicker.readonlyHint') }}</p>
      <p v-else class="hint">{{ t('stylePicker.hint', { max }) }}</p>
    </template>

    <div class="tray">
      <div v-for="item in items" :key="item.id" class="slot">
        <img v-if="previewUrl(item)" :src="previewUrl(item)" :alt="item.name" />
        <div v-else class="slot-empty">?</div>
        <span class="slot-name" :title="item.name">{{ item.name }}</span>
        <label class="weight" :title="t('stylePicker.weight')">
          <span class="weight-label">
            {{ t('stylePicker.weight') }}
            <span class="weight-value">{{ Math.round(item.weight * 100) }}%</span>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="item.weight"
            :disabled="readonly"
            @input="onWeightChange(item.id, Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <button
          v-if="!readonly"
          type="button"
          class="remove"
          :title="t('stylePicker.remove')"
          @click="removeItem(item.id)"
        >
          ×
        </button>
      </div>

      <div v-if="!readonly && canAdd" class="add-wrap">
        <button
          type="button"
          class="add-slot"
          :title="t('stylePicker.add')"
          @click="menuOpen = !menuOpen"
        >
          +
        </button>
        <div v-if="menuOpen" class="add-menu" @pointerdown.stop>
          <button type="button" @click="openLibrary">
            {{ t('stylePicker.fromLibrary') }}
          </button>
          <button type="button" @click="pickCustom">
            {{ t('stylePicker.upload') }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <input
      ref="fileInputEl"
      type="file"
      class="file-input"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      @change="onFilesPicked"
    />

    <StyleLibraryDialog
      :open="libraryOpen"
      :selected-library-ids="selectedLibraryIds"
      :remaining="remaining"
      @confirm="onLibraryConfirm"
      @cancel="libraryOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  DEFAULT_STYLE_IMAGE_WEIGHT,
  MAX_STYLE_IMAGES,
  clampStyleImageWeight,
  createStyleImageId,
  normalizeProjectStyleImages,
  type ProjectStyleImage
} from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { getDefaultStylePreset } from '../features/stylePresets/defaultLibrary'
import StyleLibraryDialog from './StyleLibraryDialog.vue'

const props = withDefaults(
  defineProps<{
    modelValue?: ProjectStyleImage[] | null
    max?: number
    label?: string
    hint?: string
    /** 只读：不可添加/删除/调强度（用于跟随全局风格） */
    readonly?: boolean
    /** 是否显示内置标题/计数/说明（外层已有工具条时可关闭） */
    showHeader?: boolean
  }>(),
  {
    modelValue: () => [],
    max: MAX_STYLE_IMAGES,
    readonly: false,
    showHeader: true
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: ProjectStyleImage[]]
}>()

const { t } = useStudioI18n()

const items = computed(() => normalizeProjectStyleImages(props.modelValue, props.max))
const remaining = computed(() => Math.max(0, props.max - items.value.length))
const canAdd = computed(() => remaining.value > 0)
const selectedLibraryIds = computed(() =>
  items.value.map((item) => item.libraryId).filter((id): id is string => Boolean(id))
)

const menuOpen = ref(false)
const libraryOpen = ref(false)
const error = ref('')
const fileInputEl = ref<HTMLInputElement | null>(null)

function previewUrl(item: ProjectStyleImage): string {
  if (item.dataUrl) return item.dataUrl
  if (item.libraryId) return getDefaultStylePreset(item.libraryId)?.imageUrl ?? ''
  return ''
}

function commit(next: ProjectStyleImage[]): void {
  emit('update:modelValue', normalizeProjectStyleImages(next, props.max))
}

function removeItem(id: string): void {
  if (props.readonly) return
  error.value = ''
  commit(items.value.filter((item) => item.id !== id))
}

function onWeightChange(id: string, weight: number): void {
  if (props.readonly) return
  commit(
    items.value.map((item) =>
      item.id === id ? { ...item, weight: clampStyleImageWeight(weight) } : item
    )
  )
}

function openLibrary(): void {
  if (props.readonly) return
  menuOpen.value = false
  error.value = ''
  if (!canAdd.value) {
    error.value = t('stylePicker.maxReached', { max: props.max })
    return
  }
  libraryOpen.value = true
}

function onLibraryConfirm(added: ProjectStyleImage[]): void {
  libraryOpen.value = false
  if (!added.length) return
  commit([...items.value, ...added])
}

function pickCustom(): void {
  if (props.readonly) return
  menuOpen.value = false
  error.value = ''
  if (!canAdd.value) {
    error.value = t('stylePicker.maxReached', { max: props.max })
    return
  }
  fileInputEl.value?.click()
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function onFilesPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return

  const room = remaining.value
  if (room <= 0) {
    error.value = t('stylePicker.maxReached', { max: props.max })
    return
  }

  const take = files.slice(0, room)
  if (files.length > room) {
    error.value = t('stylePicker.truncated', { max: props.max, n: take.length })
  } else {
    error.value = ''
  }

  const added: ProjectStyleImage[] = []
  for (const file of take) {
    if (!file.type.startsWith('image/')) continue
    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (!dataUrl.startsWith('data:')) continue
      const baseName = file.name.replace(/\.[^.]+$/, '').trim()
      added.push({
        id: createStyleImageId(),
        name: baseName || t('stylePicker.customName'),
        weight: DEFAULT_STYLE_IMAGE_WEIGHT,
        dataUrl
      })
    } catch {
      error.value = t('stylePicker.readFailed')
    }
  }
  if (added.length) commit([...items.value, ...added])
}

const rootEl = ref<HTMLElement | null>(null)

function onDocPointerDown(event: PointerEvent): void {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (rootEl.value && target && rootEl.value.contains(target)) {
    const wrap = rootEl.value.querySelector('.add-wrap')
    if (wrap && wrap.contains(target)) return
  }
  menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
})
</script>

<style scoped>
.style-image-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.style-image-picker.readonly .weight input {
  opacity: 0.7;
  cursor: default;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
}

.count {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-muted);
}

.tray {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.slot {
  position: relative;
  width: 112px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
}

.slot img,
.slot-empty {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--media-letterbox);
}

.slot-empty {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 18px;
}

.slot-name {
  display: block;
  padding: 4px 6px 0;
  font-size: 10px;
  line-height: 1.25;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.weight {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 4px 6px 6px;
}

.weight-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.weight-value {
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.weight input {
  width: 100%;
  margin: 0;
  accent-color: var(--accent);
}

.remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.remove:hover {
  background: rgba(180, 40, 40, 0.9);
}

.add-wrap {
  position: relative;
}

.add-slot {
  width: 112px;
  aspect-ratio: 1;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.add-slot:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.add-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 5;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.add-menu button {
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
}

.add-menu button:hover {
  background: var(--bg-elevated);
}

.error {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}

.file-input {
  display: none;
}
</style>
