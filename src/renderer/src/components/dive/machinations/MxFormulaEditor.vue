<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  inspectMxFormulaContext,
  type MxFormulaCatalogItem,
  type MxFormulaContextKind,
  type MxFormulaSymbolRef
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    contextKind?: MxFormulaContextKind
    ownerNodeId?: string
    edgeId?: string
    paramId?: string
    targetField?: 'formula' | 'interval' | 'botCondition'
    compact?: boolean
  }>(),
  {
    placeholder: '',
    contextKind: 'expr',
    ownerNodeId: undefined,
    edgeId: undefined,
    paramId: undefined,
    targetField: 'formula',
    compact: false
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()
const s = useMxStudioStore()

const inputRef = ref<HTMLInputElement | null>(null)
const isFocused = ref(false)
const builderOpen = ref(false)
const dismissSuggest = ref(false)
const activeSuggestIdx = ref(0)
const activeTab = ref<'all' | 'param' | 'node' | 'state_input' | 'builtin'>('all')
const filterQuery = ref('')
const newParamName = ref('')
const newParamVal = ref<number>(1)
const caretPos = ref<{ start: number; end: number }>({ start: 0, end: 0 })

const inspection = computed(() =>
  inspectMxFormulaContext(s.doc.value, props.modelValue, {
    contextKind: props.contextKind,
    ownerNodeId: props.ownerNodeId,
    edgeId: props.edgeId,
    values: s.displayValues.value,
    step: s.playStep.value
  })
)

const hasStateInputsInCatalog = computed(() =>
  inspection.value.catalog.some((it) => it.source === 'state_input')
)

const paramCount = computed(
  () => inspection.value.catalog.filter((it) => it.source === 'param').length
)
const nodeCount = computed(
  () => inspection.value.catalog.filter((it) => it.source === 'node').length
)
const stateInCount = computed(
  () => inspection.value.catalog.filter((it) => it.source === 'state_input').length
)

function syncCaretFromDom(): void {
  const el = inputRef.value
  if (!el) return
  caretPos.value = {
    start: el.selectionStart ?? props.modelValue.length,
    end: el.selectionEnd ?? props.modelValue.length
  }
}

const activeWord = computed<{ text: string; start: number; end: number } | null>(() => {
  if (!isFocused.value) return null
  const text = props.modelValue ?? ''
  const pos = Math.min(caretPos.value.start, text.length)
  if (caretPos.value.start !== caretPos.value.end) return null
  let start = pos
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) {
    start--
  }
  let end = pos
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) {
    end++
  }
  const word = text.slice(start, pos)
  if (!word || /^\d+$/.test(word)) return null
  return { text: word, start, end }
})

function itemSubtitle(item: MxFormulaCatalogItem): string {
  if (item.fnId) {
    const key = `mx.formulaEditor.fn_${item.fnId}`
    const translated = t(key)
    if (translated !== key) return translated
  }
  return item.subtitle ?? ''
}

const autocompleteItems = computed<MxFormulaCatalogItem[]>(() => {
  if (builderOpen.value || dismissSuggest.value || !activeWord.value) return []
  const q = activeWord.value.text.toLowerCase()
  return inspection.value.catalog
    .filter((it) => {
      if (it.title.toLowerCase() === q && it.insertText === activeWord.value?.text) return false
      return (
        it.title.toLowerCase().includes(q) ||
        it.insertText.toLowerCase().includes(q) ||
        (it.subtitle ?? '').toLowerCase().includes(q)
      )
    })
    .slice(0, 8)
})

watch(
  () => autocompleteItems.value.length,
  () => {
    activeSuggestIdx.value = 0
  }
)

const filteredCatalog = computed<MxFormulaCatalogItem[]>(() => {
  const q = filterQuery.value.trim().toLowerCase()
  return inspection.value.catalog.filter((it) => {
    if (activeTab.value === 'param' && it.source !== 'param') return false
    if (activeTab.value === 'node' && it.source !== 'node') return false
    if (activeTab.value === 'state_input' && it.source !== 'state_input') return false
    if (
      activeTab.value === 'builtin' &&
      it.source !== 'builtin_var' &&
      it.source !== 'dice' &&
      it.source !== 'function'
    ) {
      return false
    }
    if (!q) return true
    const sub = itemSubtitle(it).toLowerCase()
    return (
      it.title.toLowerCase().includes(q) ||
      it.insertText.toLowerCase().includes(q) ||
      sub.includes(q)
    )
  })
})

function onInput(e: Event): void {
  const val = (e.target as HTMLInputElement).value
  dismissSuggest.value = false
  emit('update:modelValue', val)
  nextTick(syncCaretFromDom)
}

function onFocus(): void {
  isFocused.value = true
  dismissSuggest.value = false
  syncCaretFromDom()
}

function onBlur(): void {
  isFocused.value = false
}

function onKeydown(e: KeyboardEvent): void {
  const list = autocompleteItems.value
  if (list.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeSuggestIdx.value = (activeSuggestIdx.value + 1) % list.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeSuggestIdx.value = (activeSuggestIdx.value - 1 + list.length) % list.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const chosen = list[activeSuggestIdx.value] ?? list[0]
      if (chosen) insertCatalogItem(chosen, true)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      dismissSuggest.value = true
      return
    }
  }
}

function insertCatalogItem(item: MxFormulaCatalogItem, replaceCurrentWord = false): void {
  const current = props.modelValue ?? ''
  let replaceStart = caretPos.value.start
  let replaceEnd = caretPos.value.end
  if (replaceCurrentWord && activeWord.value) {
    replaceStart = activeWord.value.start
    replaceEnd = activeWord.value.end
  } else {
    replaceStart = Math.max(0, Math.min(replaceStart, current.length))
    replaceEnd = Math.max(replaceStart, Math.min(replaceEnd, current.length))
  }
  const before = current.slice(0, replaceStart)
  const after = current.slice(replaceEnd)
  const nextText = `${before}${item.insertText}${after}`
  const nextCursor =
    before.length + item.insertText.length - Math.max(0, item.cursorBackOffset ?? 0)
  emit('update:modelValue', nextText)
  dismissSuggest.value = true
  nextTick(() => {
    const el = inputRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(nextCursor, nextCursor)
    caretPos.value = { start: nextCursor, end: nextCursor }
  })
}

function sourceBadgeLabel(
  source: MxFormulaSymbolRef['source'] | MxFormulaCatalogItem['source'],
  nodeKind?: string
): string {
  switch (source) {
    case 'param':
      return t('mx.formulaEditor.srcParam')
    case 'state_input':
      return t('mx.formulaEditor.srcStateIn')
    case 'node':
      if (nodeKind === 'pool') return t('mx.formulaEditor.srcPool')
      if (nodeKind === 'register') return t('mx.formulaEditor.srcRegister')
      return t('mx.formulaEditor.srcNode')
    case 'builtin_var':
      return t('mx.formulaEditor.srcBuiltin')
    case 'dice':
      return t('mx.formulaEditor.srcDice')
    case 'function':
      return t('mx.formulaEditor.srcFn')
    case 'unknown':
    default:
      return t('mx.formulaEditor.srcUnknown')
  }
}

function sourceColorClass(
  source: MxFormulaSymbolRef['source'] | MxFormulaCatalogItem['source'],
  nodeKind?: string
): string {
  switch (source) {
    case 'param':
      return 'is-param'
    case 'state_input':
      return 'is-state-in'
    case 'node':
      return nodeKind === 'register' ? 'is-register' : 'is-pool'
    case 'builtin_var':
    case 'dice':
    case 'function':
      return 'is-builtin'
    case 'unknown':
    default:
      return 'is-unknown'
  }
}

function onSymbolClick(sym: MxFormulaSymbolRef): void {
  if (sym.source === 'param') {
    s.drawer.value = 'params'
  } else if ((sym.source === 'node' || sym.source === 'state_input') && sym.nodeId) {
    s.select([sym.nodeId], [])
  }
}

function onInlineParamInput(sym: MxFormulaSymbolRef, rawVal: string): void {
  if (!sym.paramId) return
  const num = Number(rawVal)
  if (!Number.isFinite(num)) return
  s.setParamValue(sym.paramId, num)
}

function onCreateUnknownAsParam(token: string): void {
  s.upsertParam(token, 1)
}

const canOpenModal = computed(() => Boolean(props.edgeId || props.ownerNodeId || props.paramId))

function openFullModal(): void {
  if (props.edgeId) {
    s.openFormulaModal({
      targetType: 'edge',
      edgeId: props.edgeId,
      field: props.targetField === 'interval' ? 'interval' : 'formula'
    })
  } else if (props.ownerNodeId) {
    s.openFormulaModal({
      targetType: 'node',
      nodeId: props.ownerNodeId,
      field: props.targetField === 'botCondition' ? 'botCondition' : 'formula'
    })
  } else if (props.paramId) {
    s.openFormulaModal({
      targetType: 'param',
      paramId: props.paramId
    })
  }
}

function onCreateAndInsertParam(): void {
  const raw = newParamName.value.trim()
  if (!raw) return
  const createdIdent = s.upsertParam(
    raw,
    Number.isFinite(newParamVal.value) ? newParamVal.value : 1
  )
  newParamName.value = ''
  newParamVal.value = 1
  insertCatalogItem({
    key: `param:${createdIdent}`,
    insertText: createdIdent,
    source: 'param',
    title: createdIdent
  })
}
</script>

<template>
  <div class="mx-fe-root" :class="{ 'is-compact': compact }">
    <!-- 1. 主公式输入行 + 实时预览胶囊 + fx 展开按钮 -->
    <div class="mx-fe-input-wrap" :class="{ 'is-focused': isFocused }">
      <input
        ref="inputRef"
        class="mx-fe-input mx-mono"
        type="text"
        :value="modelValue"
        :placeholder="placeholder"
        :title="canOpenModal ? t('mx.formulaEditor.dblClickHint') : undefined"
        autocomplete="off"
        spellcheck="false"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
        @keyup="syncCaretFromDom"
        @click="syncCaretFromDom"
        @dblclick.stop="openFullModal"
      />
      <span
        v-if="inspection.previewText"
        class="mx-fe-preview mx-mono"
        :class="{ 'is-rng': inspection.isStochastic }"
      >
        {{ inspection.previewText }}
      </span>
      <button
        type="button"
        class="mx-fe-fx-btn"
        :class="{ 'is-open': builderOpen }"
        :title="t('mx.formulaEditor.toggleBtnTip')"
        @click="builderOpen = !builderOpen"
      >
        fx
      </button>
      <button
        v-if="canOpenModal"
        type="button"
        class="mx-fe-fx-btn"
        :title="t('mx.formulaEditor.expandModalTip')"
        @click="openFullModal"
      >
        ⤢
      </button>

      <!-- 2. 输入时自动浮出的智能补全菜单 -->
      <div v-if="autocompleteItems.length > 0" class="mx-fe-suggest-pop">
        <button
          v-for="(item, idx) in autocompleteItems"
          :key="item.key"
          type="button"
          class="mx-fe-suggest-item"
          :class="{ 'is-active': idx === activeSuggestIdx }"
          @mousedown.prevent="insertCatalogItem(item, true)"
          @mouseenter="activeSuggestIdx = idx"
        >
          <span class="mx-fe-src-tag" :class="sourceColorClass(item.source, item.nodeKind)">
            {{ sourceBadgeLabel(item.source, item.nodeKind) }}
          </span>
          <span class="mx-fe-suggest-name mx-mono">{{ item.title }}</span>
          <span v-if="itemSubtitle(item)" class="mx-fe-suggest-sub">
            {{ itemSubtitle(item) }}
          </span>
          <span v-if="item.valueText !== undefined" class="mx-fe-suggest-val mx-mono">
            = {{ item.valueText }}
          </span>
        </button>
      </div>
    </div>

    <!-- 3. 常驻可见：当前公式中各变量的来源透视栏（一眼看懂变量从哪来、当前值是多少） -->
    <div v-if="inspection.referencedSymbols.length > 0" class="mx-fe-sources-box">
      <div v-for="sym in inspection.referencedSymbols" :key="sym.token" class="mx-fe-sym-row">
        <button
          type="button"
          class="mx-fe-sym-main"
          :class="{
            'is-clickable':
              sym.source === 'param' || sym.source === 'node' || sym.source === 'state_input'
          }"
          :title="
            sym.source === 'param'
              ? t('mx.formulaEditor.clickJumpParam')
              : sym.source === 'node' || sym.source === 'state_input'
                ? t('mx.formulaEditor.clickJumpNode')
                : ''
          "
          @click="onSymbolClick(sym)"
        >
          <span class="mx-fe-src-tag" :class="sourceColorClass(sym.source, sym.nodeKind)">
            {{ sourceBadgeLabel(sym.source, sym.nodeKind) }}
          </span>
          <span class="mx-fe-sym-tok mx-mono">{{ sym.token }}</span>
          <span v-if="sym.nodeLabel && sym.nodeLabel !== sym.token" class="mx-fe-sym-label">
            · {{ sym.nodeLabel }}
          </span>
        </button>

        <!-- 全局固定数值参数：支持直接在公式下方改值！ -->
        <div
          v-if="sym.source === 'param' && (sym.paramVarKind ?? 'number') === 'number'"
          class="mx-fe-param-inline"
        >
          <span class="mx-fe-eq">=</span>
          <input
            type="number"
            step="any"
            class="mx-fe-param-num mx-mono"
            :value="sym.value ?? 0"
            @input="onInlineParamInput(sym, ($event.target as HTMLInputElement).value)"
          />
        </div>

        <!-- 其他已知变量：展示当前实时值 -->
        <span v-else-if="sym.valueText !== undefined" class="mx-fe-sym-val mx-mono">
          = {{ sym.valueText }}
        </span>

        <!-- 未定义变量：一键创建为全局参数 -->
        <button
          v-else-if="sym.source === 'unknown'"
          type="button"
          class="mx-fe-create-param-btn"
          :title="t('mx.formulaEditor.createAsParamTip')"
          @click="onCreateUnknownAsParam(sym.token)"
        >
          {{ t('mx.formulaEditor.createAsParam') }}
        </button>
      </div>
    </div>

    <!-- 4. 可展开 fx 公式构建器与全量变量选择器 -->
    <div v-if="builderOpen" class="mx-fe-builder">
      <div class="mx-fe-tabs">
        <button
          type="button"
          class="mx-fe-tab"
          :class="{ 'is-active': activeTab === 'all' }"
          @click="activeTab = 'all'"
        >
          {{ t('mx.formulaEditor.tabAll') }}
        </button>
        <button
          type="button"
          class="mx-fe-tab"
          :class="{ 'is-active': activeTab === 'param' }"
          @click="activeTab = 'param'"
        >
          {{ t('mx.formulaEditor.tabParams') }}
          <span v-if="paramCount" class="mx-fe-tab-cnt">{{ paramCount }}</span>
        </button>
        <button
          type="button"
          class="mx-fe-tab"
          :class="{ 'is-active': activeTab === 'node' }"
          @click="activeTab = 'node'"
        >
          {{ t('mx.formulaEditor.tabNodes') }}
          <span v-if="nodeCount" class="mx-fe-tab-cnt">{{ nodeCount }}</span>
        </button>
        <button
          v-if="hasStateInputsInCatalog"
          type="button"
          class="mx-fe-tab"
          :class="{ 'is-active': activeTab === 'state_input' }"
          @click="activeTab = 'state_input'"
        >
          {{ t('mx.formulaEditor.tabStateIn') }}
          <span class="mx-fe-tab-cnt">{{ stateInCount }}</span>
        </button>
        <button
          type="button"
          class="mx-fe-tab"
          :class="{ 'is-active': activeTab === 'builtin' }"
          @click="activeTab = 'builtin'"
        >
          {{ t('mx.formulaEditor.tabBuiltins') }}
        </button>
      </div>

      <div class="mx-fe-search-row">
        <input
          v-model="filterQuery"
          type="text"
          class="mx-fe-search-input"
          :placeholder="t('mx.formulaEditor.searchPlaceholder')"
        />
      </div>

      <div class="mx-fe-catalog-list">
        <div
          v-if="activeTab === 'param' && paramCount === 0 && !filterQuery.trim()"
          class="mx-fe-empty"
        >
          {{ t('mx.formulaEditor.emptyParamsHint') }}
        </div>
        <div v-else-if="filteredCatalog.length === 0" class="mx-fe-empty">
          {{ t('mx.formulaEditor.emptyCatalog') }}
        </div>
        <button
          v-for="item in filteredCatalog"
          :key="item.key"
          type="button"
          class="mx-fe-cat-row"
          @mousedown.prevent="insertCatalogItem(item, false)"
        >
          <div class="mx-fe-cat-top">
            <span class="mx-fe-src-tag" :class="sourceColorClass(item.source, item.nodeKind)">
              {{ sourceBadgeLabel(item.source, item.nodeKind) }}
            </span>
            <span class="mx-fe-cat-title mx-mono">{{ item.title }}</span>
            <span v-if="item.valueText !== undefined" class="mx-fe-cat-val mx-mono">
              = {{ item.valueText }}
            </span>
          </div>
          <div v-if="itemSubtitle(item)" class="mx-fe-cat-sub">
            {{ itemSubtitle(item) }}
          </div>
        </button>
      </div>

      <!-- 快捷新建全局参数并插入公式 -->
      <div
        v-if="activeTab === 'param' || (activeTab === 'all' && paramCount === 0)"
        class="mx-fe-new-param-bar"
      >
        <input
          v-model="newParamName"
          type="text"
          class="mx-fe-np-name mx-mono"
          :placeholder="t('mx.formulaEditor.newParamNamePlaceholder')"
          @keydown.enter.prevent="onCreateAndInsertParam"
        />
        <input
          v-model.number="newParamVal"
          type="number"
          step="any"
          class="mx-fe-np-val mx-mono"
          :placeholder="t('mx.formulaEditor.newParamValPlaceholder')"
          @keydown.enter.prevent="onCreateAndInsertParam"
        />
        <button
          type="button"
          class="mx-fe-np-btn"
          :disabled="!newParamName.trim()"
          @mousedown.prevent="onCreateAndInsertParam"
        >
          {{ t('mx.formulaEditor.newParamCreateInsert') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mx-fe-root {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
}

.mx-fe-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: border-color 0.14s ease;
}
.mx-fe-input-wrap.is-focused {
  border-color: var(--accent);
}

.mx-fe-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  padding: 5px 7px;
  font-size: 12px;
}
.mx-fe-root.is-compact .mx-fe-input {
  padding: 4px 6px;
  font-size: 11.5px;
}

.mx-fe-preview {
  flex-shrink: 0;
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.13);
  color: #3b82f6;
  margin-right: 3px;
}
.mx-fe-preview.is-rng {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
}

.mx-fe-fx-btn {
  flex-shrink: 0;
  height: 22px;
  padding: 0 6px;
  margin-right: 3px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 700;
  font-style: italic;
  cursor: pointer;
  transition: all 0.12s ease;
}
.mx-fe-fx-btn:hover,
.mx-fe-fx-btn.is-open {
  color: #ffffff;
  background: var(--accent);
  border-color: var(--accent);
}

/* 智能联想补全浮层 */
.mx-fe-suggest-pop {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 3px);
  z-index: 40;
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  border-radius: 7px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  max-height: 196px;
  overflow-y: auto;
  padding: 3px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mx-fe-suggest-item {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 11px;
  cursor: pointer;
}
.mx-fe-suggest-item:hover,
.mx-fe-suggest-item.is-active {
  background: var(--bg-hover);
}
.mx-fe-suggest-name {
  font-weight: 600;
  flex-shrink: 0;
}
.mx-fe-suggest-sub {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 10.5px;
}
.mx-fe-suggest-val {
  flex-shrink: 0;
  color: #3b82f6;
  font-size: 10.5px;
}

/* 来源颜色徽章 */
.mx-fe-src-tag {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1.35;
}
.mx-fe-src-tag.is-param {
  background: rgba(245, 158, 11, 0.18);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.35);
}
.mx-fe-src-tag.is-pool {
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.32);
}
.mx-fe-src-tag.is-register {
  background: rgba(139, 92, 246, 0.18);
  color: #8b5cf6;
  border: 1px solid rgba(139, 92, 246, 0.35);
}
.mx-fe-src-tag.is-state-in {
  background: rgba(14, 165, 233, 0.18);
  color: #0ea5e9;
  border: 1px solid rgba(14, 165, 233, 0.35);
}
.mx-fe-src-tag.is-builtin {
  background: rgba(6, 182, 212, 0.15);
  color: #06b6d4;
  border: 1px solid rgba(6, 182, 212, 0.3);
}
.mx-fe-src-tag.is-unknown {
  background: rgba(239, 68, 68, 0.16);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.36);
}

/* 常驻变量来源透视框 */
.mx-fe-sources-box {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 6px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.06);
  border: 1px dashed var(--border);
}
.mx-fe-sym-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  min-height: 21px;
}
.mx-fe-sym-main {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 3px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 11px;
}
.mx-fe-sym-main.is-clickable {
  cursor: pointer;
}
.mx-fe-sym-main.is-clickable:hover {
  background: var(--bg-hover);
}
.mx-fe-sym-tok {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-fe-sym-label {
  color: var(--text-muted);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-fe-sym-val {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 10.5px;
}

.mx-fe-param-inline {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mx-fe-eq {
  color: var(--text-muted);
  font-size: 10.5px;
}
.mx-fe-param-num {
  width: 52px;
  padding: 1px 4px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  background: var(--bg-elevated);
  color: var(--text);
  text-align: right;
  outline: none;
}
.mx-fe-param-num:focus {
  border-color: #f59e0b;
}

.mx-fe-create-param-btn {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.mx-fe-create-param-btn:hover {
  background: rgba(245, 158, 11, 0.28);
}

/* 展开式 fx 公式构建器 */
.mx-fe-builder {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border-radius: 7px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.mx-fe-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.mx-fe-tab {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
  cursor: pointer;
}
.mx-fe-tab:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.mx-fe-tab.is-active {
  color: var(--text);
  background: rgba(61, 139, 253, 0.16);
  border-color: rgba(61, 139, 253, 0.45);
  font-weight: 600;
}
.mx-fe-tab-cnt {
  font-size: 9.5px;
  opacity: 0.8;
}

.mx-fe-search-row {
  display: flex;
}
.mx-fe-search-input {
  width: 100%;
  padding: 4px 7px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  outline: none;
}
.mx-fe-search-input:focus {
  border-color: var(--accent);
}

.mx-fe-catalog-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 184px;
  overflow-y: auto;
}
.mx-fe-empty {
  padding: 10px 6px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}

.mx-fe-cat-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.mx-fe-cat-row:hover {
  background: var(--bg-hover);
}
.mx-fe-cat-top {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
}
.mx-fe-cat-title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-fe-cat-val {
  flex-shrink: 0;
  font-size: 10.5px;
  color: #3b82f6;
}
.mx-fe-cat-sub {
  padding-left: 2px;
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 新建并插入全局参数栏 */
.mx-fe-new-param-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 5px;
  border-top: 1px solid var(--border);
}
.mx-fe-np-name {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  outline: none;
}
.mx-fe-np-val {
  width: 46px;
  padding: 3px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  text-align: right;
  outline: none;
}
.mx-fe-np-btn {
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.mx-fe-np-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mx-fe-np-btn:not(:disabled):hover {
  background: rgba(245, 158, 11, 0.28);
}

.mx-mono {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
</style>
