<template>
  <div class="mention-wrap">
    <textarea
      ref="textareaEl"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @click="closeMenu"
      @scroll="onTextareaScroll"
      @blur="onBlur"
      @focus="$emit('focus')"
    />
    <!-- Teleport 到 body：画布 transform 会改变 fixed 包含块，导致节点上定位错位 -->
    <Teleport to="body">
      <ul
        v-if="menuOpen && filteredOptions.length"
        ref="menuEl"
        class="mention-menu"
        :style="menuStyle"
      >
        <li
          v-for="(opt, i) in filteredOptions"
          :key="opt.token"
          :class="{ active: i === menuIndex }"
          @mousedown.prevent="pickOption(opt)"
        >
          <span class="token">{{ opt.token }}</span>
          <span class="label">{{ opt.label }}</span>
        </li>
      </ul>
    </Teleport>
    <p v-if="options.length && hintText" class="mention-hint">
      {{ hintText }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { RefMentionOption } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { getTextareaCaretClientRect } from '../utils/textareaCaretCoords'

const { t, assetTypeLabel } = useStudioI18n()

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: RefMentionOption[]
    rows?: number
    placeholder?: string
    /** 省略则使用生成指令的引用提示；传空字符串可隐藏 */
    hint?: string
  }>(),
  {
    rows: 4
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
  focus: []
}>()

const hintText = computed(() =>
  props.hint === undefined ? t('graph.inspector.generate.mentionHint') : props.hint
)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const menuEl = ref<HTMLUListElement | null>(null)
const menuOpen = ref(false)
const menuIndex = ref(0)
const menuStyle = ref<Record<string, string>>({})
const mentionQuery = ref('')
const mentionStart = ref(-1)
const MENU_MAX_H = 160
const MENU_ITEM_H = 28
const MENU_PAD_H = 8

const filteredOptions = computed(() => {
  const q = mentionQuery.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(
    (o) =>
      o.token.toLowerCase().includes(q) ||
      o.label.toLowerCase().includes(q) ||
      (assetTypeLabel('voice').toLowerCase().includes(q) && o.kind === 'voice')
  )
})

function onInput(e: Event): void {
  const el = e.target as HTMLTextAreaElement
  emit('update:modelValue', el.value)
  detectMention(el)
  emit('change')
}

function detectMention(el: HTMLTextAreaElement): void {
  const pos = el.selectionStart ?? 0
  const before = el.value.slice(0, pos)
  const match = before.match(/@([^\s@]*)$/)
  if (!match || !props.options.length) {
    closeMenu()
    return
  }
  mentionStart.value = pos - match[0].length
  mentionQuery.value = match[1]
  menuIndex.value = 0
  menuOpen.value = true
  // 用当前光标（含 @ 后已输入字符），长文滚动后更准；nextTick 后再按真实菜单高度贴齐
  updateMenuPosition(el, pos)
  void nextTick(() => {
    if (menuOpen.value && textareaEl.value) updateMenuPosition(textareaEl.value, pos)
  })
}

/** 估算/测量菜单高度；翻转到光标上方时必须用真实高度，否则会按 160px 顶飞 */
function resolveMenuHeight(): number {
  const measured = menuEl.value?.offsetHeight ?? 0
  if (measured > 0) return Math.min(MENU_MAX_H, measured)
  const estimate = MENU_PAD_H + filteredOptions.value.length * MENU_ITEM_H
  return Math.min(MENU_MAX_H, Math.max(MENU_ITEM_H + MENU_PAD_H, estimate))
}

/** 将菜单锚在光标行下方（视口 fixed；下方不够则紧贴光标上方） */
function updateMenuPosition(el: HTMLTextAreaElement, atIndex: number): void {
  const caret = getTextareaCaretClientRect(el, atIndex)
  const rect = el.getBoundingClientRect()
  // 行高上限，防止异常测量把菜单夹到框顶/翻到屏外
  const caretH = Math.min(Math.max(caret.height, 14), 48)

  // 限制在 textarea 与视口的交集内（长文滚动 / 节点部分移出视口时）
  const clipTop = Math.max(rect.top, 0)
  const clipBottom = Math.min(rect.bottom, window.innerHeight)
  const clipLeft = Math.max(rect.left, 0)
  const clipRight = Math.min(rect.right, window.innerWidth)
  if (clipBottom - clipTop < 8 || clipRight - clipLeft < 8) {
    // textarea 几乎不可见时，退到框底中部，避免菜单飞到 (0,0)
    menuStyle.value = {
      position: 'fixed',
      top: `${Math.min(Math.max(8, rect.bottom + 4), window.innerHeight - 40)}px`,
      left: `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 208))}px`,
      right: 'auto',
      zIndex: '4000'
    }
    return
  }

  const caretTop = Math.min(Math.max(caret.top, clipTop), clipBottom - caretH)
  const caretLeft = Math.min(Math.max(caret.left, clipLeft), Math.max(clipLeft, clipRight - 8))

  const menuH = resolveMenuHeight()
  const gap = 4
  const belowTop = caretTop + caretH + gap
  const spaceBelow = window.innerHeight - 8 - belowTop
  const spaceAbove = caretTop - gap - 8
  let top = belowTop
  // 下方放不下完整菜单，且上方空间更充裕（或下方几乎没有）时，翻到光标正上方
  if (spaceBelow < menuH && spaceAbove > spaceBelow) {
    top = Math.max(8, caretTop - menuH - gap)
  }
  top = Math.min(Math.max(top, 8), window.innerHeight - Math.min(menuH, 40))
  const maxLeft = Math.max(8, window.innerWidth - 208)
  const left = Math.min(Math.max(8, caretLeft), maxLeft)
  menuStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    right: 'auto',
    // 需高于 StudioFloatingWindow（指令放大窗 2500 等）
    zIndex: '4000'
  }
}

function refreshMenuPosition(): void {
  const el = textareaEl.value
  if (!menuOpen.value || !el || mentionStart.value < 0) return
  const pos = el.selectionStart ?? mentionStart.value
  updateMenuPosition(el, pos)
}

function onTextareaScroll(): void {
  refreshMenuPosition()
}

function onWindowScrollOrResize(): void {
  refreshMenuPosition()
}

watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener('scroll', onWindowScrollOrResize, true)
    window.addEventListener('resize', onWindowScrollOrResize)
  } else {
    window.removeEventListener('scroll', onWindowScrollOrResize, true)
    window.removeEventListener('resize', onWindowScrollOrResize)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onWindowScrollOrResize, true)
  window.removeEventListener('resize', onWindowScrollOrResize)
})

function onKeydown(e: KeyboardEvent): void {
  if (!menuOpen.value || !filteredOptions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    menuIndex.value = (menuIndex.value + 1) % filteredOptions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    menuIndex.value =
      (menuIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    pickOption(filteredOptions.value[menuIndex.value])
  } else if (e.key === 'Escape') {
    closeMenu()
  }
}

function pickOption(opt: RefMentionOption): void {
  const el = textareaEl.value
  if (!el || mentionStart.value < 0) return
  const pos = el.selectionStart ?? 0
  const inserted = opt.insertText ?? opt.token
  const next = `${el.value.slice(0, mentionStart.value)}${inserted} ${el.value.slice(pos)}`
  emit('update:modelValue', next)
  emit('change')
  closeMenu()
  void nextTick(() => {
    const cursor = mentionStart.value + inserted.length + 1
    el.focus()
    el.setSelectionRange(cursor, cursor)
  })
}

function closeMenu(): void {
  menuOpen.value = false
  mentionQuery.value = ''
  mentionStart.value = -1
}

function onBlur(): void {
  setTimeout(closeMenu, 120)
}

function focus(): void {
  textareaEl.value?.focus()
}

function getSelection(): { start: number; end: number } {
  const el = textareaEl.value
  return {
    start: el?.selectionStart ?? props.modelValue.length,
    end: el?.selectionEnd ?? props.modelValue.length
  }
}

function setSelection(start: number, end = start): void {
  void nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.focus()
    el.setSelectionRange(start, end)
  })
}

defineExpose({ focus, getSelection, setSelection })
</script>

<style scoped>
.mention-wrap {
  position: relative;
  width: 100%;
}

textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}

textarea::-webkit-resizer {
  background-color: var(--textarea-bg);
  background-image: var(--resizer-grip);
  border: none;
}

.mention-menu {
  position: fixed;
  z-index: 4000;
  margin: 0;
  padding: 4px 0;
  min-width: 180px;
  max-width: 320px;
  list-style: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  max-height: 160px;
  overflow: auto;
}

.mention-menu li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
}

.mention-menu li:hover,
.mention-menu li.active {
  background: var(--accent-12);
}

.token {
  color: var(--accent);
  font-weight: 600;
  flex-shrink: 0;
}

.label {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-hint {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--text-muted);
}

.mention-hint code {
  font-size: 10px;
  color: var(--accent);
}
</style>
