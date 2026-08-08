<template>
  <StudioFloatingWindow
    :open="open"
    :close-title="t('graph.notepad.close')"
    :z-index="2600"
    :default-width="920"
    :default-height="760"
    :min-width="480"
    :min-height="420"
    :embedded="embedded"
    body-class="pad-none"
    @close="onClose"
  >
    <template #title>
      <div class="title-block">
        <span class="app-mark">{{ t('graph.notepad.appMark') }}</span>
        <h2 class="title" :title="title">{{ title }}</h2>
      </div>
    </template>

    <template #title-actions>
      <button
        type="button"
        class="tool-btn"
        :title="t('graph.notepad.copy')"
        :disabled="!draft.length"
        @click="copyText"
      >
        {{ t('graph.notepad.copy') }}
      </button>
      <button
        v-if="editable"
        type="button"
        class="tool-btn"
        :class="{ dirty }"
        :disabled="!dirty || saving"
        :title="t('graph.notepad.saveHint')"
        @click="save"
      >
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </template>

    <div class="pad-body">
      <div v-if="images.length" class="image-batch" :aria-label="t('graph.notepad.imageBatch')">
        <div v-for="(item, index) in images" :key="`${item.url}-${index}`" class="image-card">
          <img :src="item.url" :alt="item.label || ''" />
          <span v-if="item.label" class="image-label" :title="item.label">{{ item.label }}</span>
        </div>
      </div>

      <textarea
        ref="editorEl"
        v-model="draft"
        class="editor"
        spellcheck="false"
        :readonly="!editable"
        :style="{ fontSize: `${fontSize}px` }"
        :placeholder="editable ? t('graph.notepad.placeholder') : t('graph.notepad.emptyReadonly')"
        :title="t('graph.notepad.fontZoomHint')"
        @keydown.ctrl.s.prevent="onSaveShortcut"
        @keydown.meta.s.prevent="onSaveShortcut"
      />
    </div>

    <template #footer>
      <div class="statusbar">
        <span>{{ statusLeft }}</span>
        <span class="status-right">{{ statusRight }}</span>
      </div>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { estimateTokenCount } from '@shared/textTokens'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export interface NotepadPreviewImage {
  url: string
  label?: string
}

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    text: string
    editable?: boolean
    /** 覆盖 dive 注入：false 时始终作为独立模态浮层（如指令提示词预览） */
    embedded?: boolean
    /** 最终提示词预览时一并展示的批量参考图（风格图 + 端口图） */
    images?: NotepadPreviewImage[]
  }>(),
  {
    editable: true,
    embedded: undefined,
    images: () => []
  }
)

const emit = defineEmits<{
  close: []
  save: [text: string]
}>()

const FONT_SIZE_KEY = 'ai-art-engine.notepad.fontSize'
const FONT_SIZE_DEFAULT = 13
const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 36

const { t } = useStudioI18n()
const draft = ref('')
const baseline = ref('')
const saving = ref(false)
const editorEl = ref<HTMLTextAreaElement | null>(null)
const copiedFlash = ref(false)
const tokenCount = ref(0)
let tokenTimer: ReturnType<typeof setTimeout> | null = null

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

function readStoredFontSize(): number {
  try {
    return clampFontSize(Number(localStorage.getItem(FONT_SIZE_KEY) || FONT_SIZE_DEFAULT))
  } catch {
    return FONT_SIZE_DEFAULT
  }
}

const fontSize = ref(readStoredFontSize())

function setFontSize(next: number): void {
  const clamped = clampFontSize(next)
  if (clamped === fontSize.value) return
  fontSize.value = clamped
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(clamped))
  } catch {
    // ignore quota / private mode
  }
}

/** Ctrl/Cmd + 滚轮缩放编辑区字体（须非 passive 才能阻止浏览器缩放） */
function onEditorWheel(e: WheelEvent): void {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const step = e.deltaY < 0 ? 1 : -1
  setFontSize(fontSize.value + step)
}

let wheelTarget: HTMLTextAreaElement | null = null

function bindEditorWheel(): void {
  unbindEditorWheel()
  const el = editorEl.value
  if (!el) return
  wheelTarget = el
  el.addEventListener('wheel', onEditorWheel, { passive: false })
}

function unbindEditorWheel(): void {
  wheelTarget?.removeEventListener('wheel', onEditorWheel)
  wheelTarget = null
}

const editable = computed(() => props.editable !== false)
const images = computed(() => props.images.filter((item) => Boolean(item.url?.trim())))
const dirty = computed(() => draft.value !== baseline.value)

const lineCount = computed(() => {
  if (!draft.value) return 0
  return draft.value.split('\n').length
})

const charCount = computed(() => draft.value.length)

const statusLeft = computed(() => {
  if (copiedFlash.value) return t('graph.notepad.copied')
  if (!editable.value) return t('graph.notepad.readonly')
  return dirty.value ? t('graph.notepad.unsaved') : t('graph.notepad.saved')
})

const statusRight = computed(() =>
  [
    t('graph.notepad.fontSize', { size: fontSize.value }),
    t('graph.notepad.stats', {
      lines: lineCount.value,
      chars: charCount.value,
      tokens: tokenCount.value
    })
  ].join(' · ')
)

function scheduleTokenCount(text: string): void {
  if (tokenTimer) clearTimeout(tokenTimer)
  tokenTimer = setTimeout(() => {
    tokenCount.value = estimateTokenCount(text)
    tokenTimer = null
  }, 120)
}

watch(
  () => draft.value,
  (text) => scheduleTokenCount(text),
  { immediate: true }
)

onBeforeUnmount(() => {
  if (tokenTimer) clearTimeout(tokenTimer)
  unbindEditorWheel()
})

function syncDraftFromProps(): void {
  draft.value = props.text ?? ''
  baseline.value = props.text ?? ''
  saving.value = false
  copiedFlash.value = false
}

watch(
  () => props.open,
  async (visible) => {
    if (!visible) {
      unbindEditorWheel()
      return
    }
    syncDraftFromProps()
    await nextTick()
    // StudioFloatingWindow 会延迟两帧再挂 body slot，再等一帧聚焦
    await nextTick()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bindEditorWheel()
        editorEl.value?.focus()
        editorEl.value?.setSelectionRange(0, 0)
      })
    })
  },
  { immediate: true }
)

watch(
  () => props.text,
  (next) => {
    if (!props.open || dirty.value) return
    draft.value = next ?? ''
    baseline.value = next ?? ''
  }
)

function onSaveShortcut(): void {
  if (!editable.value) return
  save()
}

function save(): void {
  if (!editable.value || !dirty.value || saving.value) return
  saving.value = true
  emit('save', draft.value)
  baseline.value = draft.value
  saving.value = false
}

function onClose(): void {
  if (editable.value && dirty.value) {
    emit('save', draft.value)
    baseline.value = draft.value
  }
  emit('close')
}

async function copyText(): Promise<void> {
  if (!draft.value) return
  try {
    await navigator.clipboard.writeText(draft.value)
    copiedFlash.value = true
    window.setTimeout(() => {
      copiedFlash.value = false
    }, 1200)
  } catch {
    // ignore clipboard failures
  }
}

defineExpose({
  markSaved(text?: string): void {
    if (typeof text === 'string') {
      draft.value = text
      baseline.value = text
    } else {
      baseline.value = draft.value
    }
    saving.value = false
  }
})
</script>

<style scoped>
.title-block {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.app-mark {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.tool-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
}

.tool-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tool-btn.dirty {
  border-color: color-mix(in srgb, var(--success) 55%, var(--border));
  color: var(--success);
}

.pad-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

.image-batch {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 0 0 auto;
  max-height: 168px;
  overflow: auto;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
}

.image-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 88px;
  min-width: 88px;
}

.image-card img {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
}

.image-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
}

.editor {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  height: auto;
  resize: none;
  border: none;
  border-radius: 0;
  padding: 16px 18px;
  background: var(--bg-input);
  color: var(--text);
  font-family: 'Cascadia Code', 'Consolas', 'SF Mono', ui-monospace, monospace;
  font-size: 13px; /* 实际字号由 :style fontSize 覆盖，可 Ctrl/Cmd+滚轮缩放 */
  line-height: 1.55;
  outline: none;
  box-sizing: border-box;
  white-space: pre-wrap;
  tab-size: 2;
}

.editor:focus {
  border: none;
  box-shadow: none;
}

.editor[readonly] {
  color: var(--text);
  cursor: default;
}

.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  color: var(--text-muted);
  font-size: 11px;
}

.status-right {
  font-variant-numeric: tabular-nums;
}
</style>
