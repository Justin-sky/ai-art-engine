<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  inspectMxFormulaContext,
  validateMxFormula,
  type MxFormulaCatalogItem,
  type MxFormulaContextKind,
  type MxFormulaSymbolRef
} from '@shared/gameAssets'
import { themePreference } from '../../../editor/preferences'
import { useMxStudioStore } from './mxStudioStore'

const { t } = useI18n()
const s = useMxStudioStore()

const resolvedModalTheme = computed<'light' | 'dark'>(() =>
  s.canvasTheme.value === 'auto' ? themePreference.value : s.canvasTheme.value
)

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const draftFormula = ref('')
const caretPos = ref<{ start: number; end: number }>({ start: 0, end: 0 })
const isFocused = ref(false)
const dismissSuggest = ref(false)
const activeSuggestIdx = ref(0)

const varTab = ref<'all' | 'state_input' | 'param' | 'node'>('all')
const varQuery = ref('')
const fnQuery = ref('')
const newParamName = ref('')
const newParamVal = ref<number>(1)

// Draggable panel offset from screen center
const dragOffset = ref<{ x: number; y: number }>({ x: 0, y: 0 })
let dragStart: { mx: number; my: number; ox: number; oy: number } | null = null

const modalTarget = computed(() => s.formulaModal.value)

const resolvedContext = computed<{
  contextKind: MxFormulaContextKind
  validateKind: 'resource' | 'state' | 'end' | 'register'
  ownerNodeId?: string
  edgeId?: string
  badge: string
  title: string
  subtitle: string
  initialValue: string
} | null>(() => {
  const mt = modalTarget.value
  if (!mt) return null
  if (mt.targetType === 'edge') {
    const edge = s.doc.value.edges.find((e) => e.id === mt.edgeId)
    if (!edge) return null
    const fromNode = s.doc.value.nodes.find((n) => n.id === edge.from)
    const toNode = s.doc.value.nodes.find((n) => n.id === edge.to)
    const fromLabel = fromNode ? fromNode.label || fromNode.id : edge.from
    const toLabel = edge.targetEdgeId
      ? `#${edge.targetEdgeId}`
      : toNode
        ? toNode.label || toNode.id
        : edge.to
    if (mt.field === 'interval') {
      return {
        contextKind: 'expr',
        validateKind: 'register',
        edgeId: edge.id,
        badge: '⏱',
        title: t('mx.formulaEditor.modalTitleEdgeInterval'),
        subtitle: `${fromLabel} → ${toLabel} (#${edge.id})`,
        initialValue: edge.interval ?? ''
      }
    }
    return {
      contextKind: edge.kind,
      validateKind: edge.kind,
      edgeId: edge.id,
      badge: edge.kind === 'state' ? '╌►' : '──►',
      title:
        edge.kind === 'state'
          ? t('mx.formulaEditor.modalTitleEdgeState')
          : t('mx.formulaEditor.modalTitleEdgeRes'),
      subtitle: `${fromLabel} → ${toLabel} (#${edge.id})`,
      initialValue: edge.formula ?? ''
    }
  }
  if (mt.targetType === 'node') {
    const node = s.doc.value.nodes.find((n) => n.id === mt.nodeId)
    if (!node) return null
    const sub = `${node.label || node.id} (#${node.id})`
    if (mt.field === 'botCondition') {
      return {
        contextKind: 'expr',
        validateKind: 'register',
        ownerNodeId: node.id,
        badge: '⚡',
        title: t('mx.formulaEditor.modalTitleBotCond'),
        subtitle: sub,
        initialValue: node.botCondition ?? ''
      }
    }
    if (node.kind === 'register') {
      return {
        contextKind: 'register',
        validateKind: 'register',
        ownerNodeId: node.id,
        badge: '[x]',
        title: t('mx.formulaEditor.modalTitleRegister'),
        subtitle: sub,
        initialValue: node.formula ?? ''
      }
    }
    if (node.kind === 'end') {
      return {
        contextKind: 'end',
        validateKind: 'end',
        ownerNodeId: node.id,
        badge: '■',
        title: t('mx.formulaEditor.modalTitleEnd'),
        subtitle: sub,
        initialValue: node.formula ?? ''
      }
    }
    return {
      contextKind: 'expr',
      validateKind: 'register',
      ownerNodeId: node.id,
      badge: node.kind === 'gate' ? '◇' : '⏱',
      title: t('mx.formulaEditor.modalTitleNodeExpr'),
      subtitle: sub,
      initialValue: node.formula ?? ''
    }
  }
  const param = s.doc.value.params.find((p) => p.id === mt.paramId)
  if (!param) return null
  return {
    contextKind: 'expr',
    validateKind: 'register',
    badge: '(x)',
    title: t('mx.formulaEditor.modalTitleParamExpr'),
    subtitle: `${param.name} (#${param.id})`,
    initialValue: param.formula ?? ''
  }
})

watch(
  modalTarget,
  (mt) => {
    if (!mt) return
    const ctx = resolvedContext.value
    draftFormula.value = ctx?.initialValue ?? ''
    varQuery.value = ''
    fnQuery.value = ''
    dismissSuggest.value = false
    dragOffset.value = { x: 0, y: 0 }
    void nextTick(() => {
      const el = textareaRef.value
      if (el) {
        el.focus()
        const len = draftFormula.value.length
        el.setSelectionRange(len, len)
        caretPos.value = { start: len, end: len }
      }
    })
  },
  { immediate: true }
)

const normalizedDraft = computed(() =>
  draftFormula.value
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
)

const inspection = computed(() => {
  const ctx = resolvedContext.value
  if (!ctx) {
    return {
      referencedSymbols: [],
      previewText: null,
      isStochastic: false,
      catalog: []
    }
  }
  return inspectMxFormulaContext(s.doc.value, normalizedDraft.value, {
    contextKind: ctx.contextKind,
    ownerNodeId: ctx.ownerNodeId,
    edgeId: ctx.edgeId,
    values: s.displayValues.value,
    step: s.playStep.value
  })
})

const parenDiagnostics = computed(() => {
  const text = draftFormula.value
  const stack: number[] = []
  const pairByIndex = new Map<number, number>()
  const unmatchedIndices = new Set<number>()
  const depthByIndex = new Map<number, number>()

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') {
      depthByIndex.set(i, stack.length % 4)
      stack.push(i)
    } else if (ch === ')') {
      if (stack.length > 0) {
        const openIdx = stack.pop()!
        const d = stack.length % 4
        depthByIndex.set(i, d)
        pairByIndex.set(openIdx, i)
        pairByIndex.set(i, openIdx)
      } else {
        unmatchedIndices.add(i)
      }
    }
  }
  let missingClose = 0
  for (const unclosedIdx of stack) {
    unmatchedIndices.add(unclosedIdx)
    missingClose++
  }
  const extraClose = unmatchedIndices.size - missingClose

  // Identify matching pair at or enclosing current cursor
  const cur = caretPos.value.start
  let activeOpen = -1
  let activeClose = -1
  if (pairByIndex.has(cur)) {
    const other = pairByIndex.get(cur)!
    activeOpen = Math.min(cur, other)
    activeClose = Math.max(cur, other)
  } else if (cur > 0 && pairByIndex.has(cur - 1)) {
    const other = pairByIndex.get(cur - 1)!
    activeOpen = Math.min(cur - 1, other)
    activeClose = Math.max(cur - 1, other)
  } else {
    // Find tightest enclosing (...) around cursor
    for (const [k, v] of pairByIndex.entries()) {
      if (k < v && k < cur && cur <= v) {
        if (activeOpen === -1 || k > activeOpen) {
          activeOpen = k
          activeClose = v
        }
      }
    }
  }

  return {
    missingClose,
    extraClose,
    unmatchedIndices,
    depthByIndex,
    activeOpen,
    activeClose
  }
})

const syntaxStatus = computed<{ ok: boolean; message: string }>(() => {
  const ctx = resolvedContext.value
  if (!ctx) return { ok: true, message: '' }
  if (parenDiagnostics.value.missingClose > 0) {
    return {
      ok: false,
      message: t('mx.formulaEditor.parenUnmatchedOpen', {
        count: parenDiagnostics.value.missingClose
      })
    }
  }
  if (parenDiagnostics.value.extraClose > 0) {
    return {
      ok: false,
      message: t('mx.formulaEditor.parenUnmatchedClose', {
        count: parenDiagnostics.value.extraClose
      })
    }
  }
  if (!normalizedDraft.value) {
    return { ok: true, message: t('mx.formulaEditor.syntaxValid') }
  }
  const v = validateMxFormula(normalizedDraft.value, ctx.validateKind)
  if (!v.valid) {
    return { ok: false, message: v.error || t('mx.formulaEditor.syntaxError') }
  }
  return { ok: true, message: t('mx.formulaEditor.syntaxValid') }
})

interface HighlightToken {
  key: string
  text: string
  cls: string
}

const highlightedMirrorTokens = computed<HighlightToken[]>(() => {
  const text = draftFormula.value
  if (!text) return []
  const symMap = new Map<string, MxFormulaSymbolRef>()
  for (const sym of inspection.value.referencedSymbols) {
    symMap.set(sym.token, sym)
  }
  const pd = parenDiagnostics.value
  const out: HighlightToken[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '(' || ch === ')') {
      let cls = 'tok-paren'
      if (pd.unmatchedIndices.has(i)) {
        cls = 'tok-paren-err'
      } else {
        const d = pd.depthByIndex.get(i) ?? 0
        cls = `tok-paren tok-depth-${d}`
        if (i === pd.activeOpen || i === pd.activeClose) {
          cls += ' is-match-pair'
        }
      }
      out.push({ key: `p-${i}`, text: ch, cls })
      i++
      continue
    }
    if (/[A-Za-z_]/.test(ch) || (/\d/.test(ch) && /^\d+[dD]\d+/.test(text.slice(i)))) {
      const diceMatch = text.slice(i).match(/^\d+[dD]\d+/)
      if (diceMatch) {
        out.push({ key: `d-${i}`, text: diceMatch[0], cls: 'tok-dice' })
        i += diceMatch[0].length
        continue
      }
      let end = i + 1
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end++
      const word = text.slice(i, end)
      let lookahead = end
      while (lookahead < text.length && /\s/.test(text[lookahead]!)) lookahead++
      const isFnCall = text[lookahead] === '('
      if (/^[dD]\d+$/.test(word)) {
        out.push({ key: `d-${i}`, text: word, cls: 'tok-dice' })
      } else if (isFnCall) {
        out.push({ key: `fn-${i}`, text: word, cls: 'tok-fn' })
      } else {
        const sym = symMap.get(word)
        let cls = 'tok-ident'
        if (sym?.source === 'param') cls = 'tok-param'
        else if (sym?.source === 'state_input') cls = 'tok-state'
        else if (sym?.source === 'node') cls = 'tok-node'
        else if (sym?.source === 'builtin_var') cls = 'tok-builtin'
        else if (sym?.source === 'unknown') cls = 'tok-unknown'
        out.push({ key: `id-${i}`, text: word, cls })
      }
      i = end
      continue
    }
    if (/\d/.test(ch)) {
      let end = i + 1
      while (end < text.length && /[\d.%]/.test(text[end]!)) end++
      out.push({ key: `n-${i}`, text: text.slice(i, end), cls: 'tok-num' })
      i = end
      continue
    }
    out.push({ key: `c-${i}`, text: ch, cls: 'tok-op' })
    i++
  }
  return out
})

function syncCaretFromDom(): void {
  const el = textareaRef.value
  if (!el) return
  caretPos.value = {
    start: el.selectionStart ?? draftFormula.value.length,
    end: el.selectionEnd ?? draftFormula.value.length
  }
}

const activeWord = computed<{ text: string; start: number; end: number } | null>(() => {
  if (!isFocused.value) return null
  const text = draftFormula.value
  const pos = Math.min(caretPos.value.start, text.length)
  if (caretPos.value.start !== caretPos.value.end) return null
  let start = pos
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) start--
  let end = pos
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end++
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
  if (dismissSuggest.value || !activeWord.value) return []
  const q = activeWord.value.text.toLowerCase()
  return inspection.value.catalog
    .filter((it) => {
      if (it.title.toLowerCase() === q && it.insertText === activeWord.value?.text) return false
      return (
        it.title.toLowerCase().includes(q) ||
        it.insertText.toLowerCase().includes(q) ||
        itemSubtitle(it).toLowerCase().includes(q)
      )
    })
    .slice(0, 7)
})

watch(
  () => autocompleteItems.value.length,
  () => {
    activeSuggestIdx.value = 0
  }
)

const variableCatalog = computed(() => {
  const q = varQuery.value.trim().toLowerCase()
  return inspection.value.catalog.filter((it) => {
    if (it.source !== 'param' && it.source !== 'node' && it.source !== 'state_input') {
      return false
    }
    if (varTab.value !== 'all' && it.source !== varTab.value) return false
    if (!q) return true
    return (
      it.title.toLowerCase().includes(q) ||
      it.insertText.toLowerCase().includes(q) ||
      (it.subtitle ?? '').toLowerCase().includes(q)
    )
  })
})

const stateInCount = computed(
  () => inspection.value.catalog.filter((it) => it.source === 'state_input').length
)
const paramCount = computed(
  () => inspection.value.catalog.filter((it) => it.source === 'param').length
)
const nodeCount = computed(
  () => inspection.value.catalog.filter((it) => it.source === 'node').length
)

const functionCatalog = computed(() => {
  const q = fnQuery.value.trim().toLowerCase()
  return inspection.value.catalog.filter((it) => {
    if (it.source !== 'builtin_var' && it.source !== 'dice' && it.source !== 'function') {
      return false
    }
    if (!q) return true
    return (
      it.title.toLowerCase().includes(q) ||
      it.insertText.toLowerCase().includes(q) ||
      itemSubtitle(it).toLowerCase().includes(q)
    )
  })
})

const edgeSyntaxPresets = computed<
  Array<{ key: string; code: string; desc: string; replaceAll?: boolean }>
>(() => {
  const ctx = resolvedContext.value
  if (!ctx) return []
  if (ctx.contextKind === 'resource') {
    return [
      { key: 'all', code: 'all', desc: t('mx.formulaEditor.preset_res_all'), replaceAll: true },
      { key: 'p50', code: '50%', desc: t('mx.formulaEditor.preset_res_prob50'), replaceAll: true },
      {
        key: 'iv3',
        code: '1|3',
        desc: t('mx.formulaEditor.preset_res_interval'),
        replaceAll: true
      }
    ]
  }
  if (ctx.contextKind === 'state') {
    return [
      { key: 'ge1', code: '>=1', desc: t('mx.formulaEditor.preset_st_ge1'), replaceAll: true },
      { key: 'le0', code: '<=0', desc: t('mx.formulaEditor.preset_st_le0'), replaceAll: true },
      { key: 'mod1', code: '+1', desc: t('mx.formulaEditor.preset_st_mod1'), replaceAll: true },
      { key: 'modi', code: '+1i', desc: t('mx.formulaEditor.preset_st_modi'), replaceAll: true },
      { key: 'rng', code: '2..8', desc: t('mx.formulaEditor.preset_st_range'), replaceAll: true },
      { key: 'star', code: '*', desc: t('mx.formulaEditor.preset_st_star'), replaceAll: true }
    ]
  }
  return []
})

const quickOperators = [
  { label: '+', insert: ' + ', back: 0 },
  { label: '−', insert: ' - ', back: 0 },
  { label: '×', insert: ' * ', back: 0 },
  { label: '÷', insert: ' / ', back: 0 },
  { label: '( )', insert: '()', back: 1 },
  { label: ',', insert: ', ', back: 0 },
  { label: '>=', insert: ' >= ', back: 0 },
  { label: '<=', insert: ' <= ', back: 0 },
  { label: '==', insert: ' == ', back: 0 },
  { label: '!=', insert: ' != ', back: 0 },
  { label: '? :', insert: ' ? 1 : 0', back: 5 },
  { label: 'D6', insert: 'D6', back: 0 },
  { label: '2D6', insert: '2D6', back: 0 },
  { label: 'STEP', insert: 'STEP', back: 0 }
]

function insertAtCursor(insertText: string, backOffset = 0, replaceWord = false): void {
  const cur = draftFormula.value
  let start = caretPos.value.start
  let end = caretPos.value.end
  if (replaceWord && activeWord.value) {
    start = activeWord.value.start
    end = activeWord.value.end
  } else {
    start = Math.max(0, Math.min(start, cur.length))
    end = Math.max(start, Math.min(end, cur.length))
  }
  // If selection is non-empty and user clicked `( )`, wrap the selection in parentheses!
  if (!replaceWord && insertText === '()' && end > start) {
    const wrapped = `(${cur.slice(start, end)})`
    draftFormula.value = `${cur.slice(0, start)}${wrapped}${cur.slice(end)}`
    const nextPos = start + wrapped.length
    focusCaret(nextPos)
    return
  }
  draftFormula.value = `${cur.slice(0, start)}${insertText}${cur.slice(end)}`
  const nextPos = start + insertText.length - Math.max(0, backOffset)
  dismissSuggest.value = true
  focusCaret(nextPos)
}

function focusCaret(pos: number): void {
  void nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
    caretPos.value = { start: pos, end: pos }
  })
}

function formatAsMultiline(): void {
  const src = normalizedDraft.value
  if (!src) return
  let out = ''
  let indent = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '(') {
      indent++
      out += '(\n' + '  '.repeat(indent)
    } else if (ch === ')') {
      indent = Math.max(0, indent - 1)
      out += '\n' + '  '.repeat(indent) + ')'
    } else if (ch === ',') {
      out += ',\n' + '  '.repeat(indent)
      while (i + 1 < src.length && src[i + 1] === ' ') i++
    } else {
      out += ch
    }
  }
  draftFormula.value = out
  focusCaret(out.length)
}

function formatAsSingleline(): void {
  draftFormula.value = normalizedDraft.value
  focusCaret(draftFormula.value.length)
}

function onTextareaInput(ev: Event): void {
  draftFormula.value = (ev.target as HTMLTextAreaElement).value
  dismissSuggest.value = false
  void nextTick(syncCaretFromDom)
}

function onTextareaKeydown(ev: KeyboardEvent): void {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault()
    applyAndClose()
    return
  }
  const list = autocompleteItems.value
  if (list.length > 0) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      activeSuggestIdx.value = (activeSuggestIdx.value + 1) % list.length
      return
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      activeSuggestIdx.value = (activeSuggestIdx.value - 1 + list.length) % list.length
      return
    }
    if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.shiftKey)) {
      ev.preventDefault()
      const chosen = list[activeSuggestIdx.value] ?? list[0]
      if (chosen) {
        insertAtCursor(chosen.insertText, chosen.cursorBackOffset ?? 0, true)
      }
      return
    }
    if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      dismissSuggest.value = true
      return
    }
  }
  if (ev.key === 'Escape') {
    ev.preventDefault()
    s.closeFormulaModal()
  }
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

function onSymbolLocate(sym: MxFormulaSymbolRef): void {
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

function onCreateAndInsertParam(): void {
  const raw = newParamName.value.trim()
  if (!raw) return
  const createdIdent = s.upsertParam(
    raw,
    Number.isFinite(newParamVal.value) ? newParamVal.value : 1
  )
  newParamName.value = ''
  newParamVal.value = 1
  insertAtCursor(createdIdent, 0, false)
}

function applyAndClose(): void {
  s.commitFormulaModal(draftFormula.value)
}

function startHeaderDrag(ev: PointerEvent): void {
  if ((ev.target as Element | null)?.closest?.('button')) return
  dragStart = {
    mx: ev.clientX,
    my: ev.clientY,
    ox: dragOffset.value.x,
    oy: dragOffset.value.y
  }
  window.addEventListener('pointermove', onHeaderDragMove)
  window.addEventListener('pointerup', stopHeaderDrag)
}

function onHeaderDragMove(ev: PointerEvent): void {
  if (!dragStart) return
  dragOffset.value = {
    x: dragStart.ox + (ev.clientX - dragStart.mx),
    y: dragStart.oy + (ev.clientY - dragStart.my)
  }
}

function stopHeaderDrag(): void {
  dragStart = null
  window.removeEventListener('pointermove', onHeaderDragMove)
  window.removeEventListener('pointerup', stopHeaderDrag)
}

onBeforeUnmount(() => {
  stopHeaderDrag()
})
</script>

<template>
  <div
    v-if="modalTarget && resolvedContext"
    class="mx-fm-backdrop"
    :data-theme="resolvedModalTheme"
    @pointerdown.stop
    @click.stop="($event) => $event.target === $event.currentTarget && s.closeFormulaModal()"
  >
    <div
      class="mx-fm-panel"
      :style="{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }"
      role="dialog"
      aria-modal="true"
    >
      <!-- 1. 可拖拽顶部标题栏 + 实时语法校验 + 当前求值徽章 -->
      <div
        class="mx-fm-header"
        :title="t('mx.formulaEditor.modalDragHint')"
        @pointerdown="startHeaderDrag"
      >
        <div class="mx-fm-head-left">
          <span class="mx-fm-ctx-badge">{{ resolvedContext.badge }}</span>
          <div class="mx-fm-head-titles">
            <div class="mx-fm-title">{{ resolvedContext.title }}</div>
            <div class="mx-fm-subtitle mx-mono">{{ resolvedContext.subtitle }}</div>
          </div>
        </div>

        <div class="mx-fm-head-right">
          <span class="mx-fm-syntax-pill" :class="syntaxStatus.ok ? 'is-ok' : 'is-err'">
            {{ syntaxStatus.ok ? '✓' : '⚠' }} {{ syntaxStatus.message }}
          </span>
          <span
            v-if="inspection.previewText"
            class="mx-fm-eval-pill mx-mono"
            :class="{ 'is-rng': inspection.isStochastic }"
          >
            <span class="mx-fm-eval-lbl">
              {{
                inspection.isStochastic
                  ? t('mx.formulaEditor.stochasticPreviewLabel')
                  : t('mx.formulaEditor.livePreviewLabel')
              }}:
            </span>
            <strong>{{ inspection.previewText }}</strong>
          </span>
          <button
            type="button"
            class="mx-fm-close-btn"
            :aria-label="t('mx.formulaEditor.cancelBtn')"
            @click="s.closeFormulaModal()"
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path
                d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <!-- 2. 多行公式代码编辑区 + 快捷运算符条 + 彩虹括号语法高亮预览 -->
      <div class="mx-fm-editor-sec">
        <div class="mx-fm-editor-top">
          <span class="mx-fm-sec-lbl">{{ t('mx.formulaEditor.expressionLabel') }}</span>
          <div class="mx-fm-fmt-actions">
            <button type="button" class="mx-fm-fmt-btn" @click="formatAsMultiline">
              ↵ {{ t('mx.formulaEditor.formatMultiline') }}
            </button>
            <button type="button" class="mx-fm-fmt-btn" @click="formatAsSingleline">
              ≡ {{ t('mx.formulaEditor.formatSingleline') }}
            </button>
            <button
              type="button"
              class="mx-fm-fmt-btn is-danger"
              @click="((draftFormula = ''), focusCaret(0))"
            >
              {{ t('mx.formulaEditor.clearFormula') }}
            </button>
          </div>
        </div>

        <div class="mx-fm-textarea-wrap" :class="{ 'is-focused': isFocused }">
          <textarea
            ref="textareaRef"
            class="mx-fm-textarea mx-mono"
            rows="3"
            :value="draftFormula"
            spellcheck="false"
            autocomplete="off"
            @input="onTextareaInput"
            @focus="((isFocused = true), syncCaretFromDom())"
            @blur="isFocused = false"
            @keydown="onTextareaKeydown"
            @keyup="syncCaretFromDom"
            @click="syncCaretFromDom"
          />

          <!-- 输入时浮出的智能补全菜单 -->
          <div v-if="autocompleteItems.length > 0" class="mx-fm-suggest-pop">
            <button
              v-for="(item, idx) in autocompleteItems"
              :key="item.key"
              type="button"
              class="mx-fm-suggest-item"
              :class="{ 'is-active': idx === activeSuggestIdx }"
              @mousedown.prevent="insertAtCursor(item.insertText, item.cursorBackOffset ?? 0, true)"
              @mouseenter="activeSuggestIdx = idx"
            >
              <span class="mx-fm-src-tag" :class="sourceColorClass(item.source, item.nodeKind)">
                {{ sourceBadgeLabel(item.source, item.nodeKind) }}
              </span>
              <span class="mx-fm-suggest-name mx-mono">{{ item.title }}</span>
              <span v-if="itemSubtitle(item)" class="mx-fm-suggest-sub">
                {{ itemSubtitle(item) }}
              </span>
              <span v-if="item.valueText !== undefined" class="mx-fm-suggest-val mx-mono">
                {{ item.valueText }}
              </span>
            </button>
          </div>
        </div>

        <!-- 快捷算符键盘栏 -->
        <div class="mx-fm-op-bar">
          <span class="mx-fm-op-lbl">{{ t('mx.formulaEditor.opToolbarLabel') }}:</span>
          <button
            v-for="op in quickOperators"
            :key="op.label"
            type="button"
            class="mx-fm-op-btn mx-mono"
            @mousedown.prevent="insertAtCursor(op.insert, op.back, false)"
          >
            {{ op.label }}
          </button>
        </div>

        <!-- 语法着色与彩虹括号配对镜像条 -->
        <div v-if="highlightedMirrorTokens.length > 0" class="mx-fm-mirror-box">
          <span class="mx-fm-mirror-lbl">{{ t('mx.formulaEditor.syntaxMirrorLabel') }}</span>
          <div class="mx-fm-mirror-code mx-mono">
            <span v-for="tok in highlightedMirrorTokens" :key="tok.key" :class="tok.cls">{{
              tok.text
            }}</span>
          </div>
        </div>
      </div>

      <!-- 3. 当前公式引用的变量来源拆解与行内实时调参 -->
      <div class="mx-fm-refs-sec">
        <div class="mx-fm-sec-lbl">{{ t('mx.formulaEditor.activeVarsSection') }}</div>
        <div v-if="inspection.referencedSymbols.length > 0" class="mx-fm-ref-grid">
          <div
            v-for="sym in inspection.referencedSymbols"
            :key="sym.token"
            class="mx-fm-ref-card"
            :class="sourceColorClass(sym.source, sym.nodeKind)"
          >
            <button type="button" class="mx-fm-ref-main" @click="onSymbolLocate(sym)">
              <span class="mx-fm-src-tag" :class="sourceColorClass(sym.source, sym.nodeKind)">
                {{ sourceBadgeLabel(sym.source, sym.nodeKind) }}
              </span>
              <span class="mx-fm-ref-tok mx-mono">{{ sym.token }}</span>
              <span v-if="sym.nodeLabel && sym.nodeLabel !== sym.token" class="mx-fm-ref-alias">
                ← {{ sym.nodeLabel }}
              </span>
            </button>

            <div
              v-if="sym.source === 'param' && (sym.paramVarKind ?? 'number') === 'number'"
              class="mx-fm-ref-edit"
            >
              <span class="mx-fm-eq">=</span>
              <input
                class="mx-fm-num-input mx-mono"
                type="number"
                step="any"
                :value="sym.value ?? 0"
                @input="onInlineParamInput(sym, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <span v-else-if="sym.valueText !== undefined" class="mx-fm-ref-val mx-mono">
              = {{ sym.valueText }}
            </span>
            <button
              v-else-if="sym.source === 'unknown'"
              type="button"
              class="mx-fm-promote-btn"
              :title="t('mx.formulaEditor.createAsParamTip')"
              @click="s.upsertParam(sym.token, 1)"
            >
              {{ t('mx.formulaEditor.createAsParam') }}
            </button>
          </div>
        </div>
        <div v-else class="mx-fm-empty-refs">{{ t('mx.formulaEditor.noReferencedVars') }}</div>
      </div>

      <!-- 4. 双栏参考与点选插入工作区（左：图表变量目录 + 新建参数；右：Machinations 函数与语法模板） -->
      <div class="mx-fm-browser-grid">
        <!-- 左栏：可用变量目录 -->
        <div class="mx-fm-col">
          <div class="mx-fm-col-head">
            <span class="mx-fm-col-title">{{ t('mx.formulaEditor.catalogVarsHeader') }}</span>
            <div class="mx-fm-mini-tabs">
              <button
                type="button"
                class="mx-fm-mini-tab"
                :class="{ 'is-active': varTab === 'all' }"
                @click="varTab = 'all'"
              >
                {{ t('mx.formulaEditor.tabAll') }}
              </button>
              <button
                v-if="stateInCount > 0"
                type="button"
                class="mx-fm-mini-tab"
                :class="{ 'is-active': varTab === 'state_input' }"
                @click="varTab = 'state_input'"
              >
                {{ t('mx.formulaEditor.tabStateIn') }} ({{ stateInCount }})
              </button>
              <button
                type="button"
                class="mx-fm-mini-tab"
                :class="{ 'is-active': varTab === 'param' }"
                @click="varTab = 'param'"
              >
                {{ t('mx.formulaEditor.tabParams') }} ({{ paramCount }})
              </button>
              <button
                type="button"
                class="mx-fm-mini-tab"
                :class="{ 'is-active': varTab === 'node' }"
                @click="varTab = 'node'"
              >
                {{ t('mx.formulaEditor.tabNodes') }} ({{ nodeCount }})
              </button>
            </div>
          </div>

          <div class="mx-fm-col-tools">
            <input
              v-model="varQuery"
              type="text"
              class="mx-fm-search"
              :placeholder="t('mx.formulaEditor.searchPlaceholder')"
            />
          </div>

          <div class="mx-fm-new-param-bar">
            <span class="mx-fm-src-tag is-param">(x)</span>
            <input
              v-model="newParamName"
              type="text"
              class="mx-fm-np-name mx-mono"
              :placeholder="t('mx.formulaEditor.newParamNamePlaceholder')"
              @keydown.enter.prevent="onCreateAndInsertParam"
            />
            <input
              v-model.number="newParamVal"
              type="number"
              step="any"
              class="mx-fm-np-val mx-mono"
              :placeholder="t('mx.formulaEditor.newParamValPlaceholder')"
              @keydown.enter.prevent="onCreateAndInsertParam"
            />
            <button
              type="button"
              class="mx-fm-np-btn"
              :disabled="!newParamName.trim()"
              @click="onCreateAndInsertParam"
            >
              {{ t('mx.formulaEditor.newParamCreateInsert') }}
            </button>
          </div>

          <div class="mx-fm-list">
            <button
              v-for="item in variableCatalog"
              :key="item.key"
              type="button"
              class="mx-fm-item"
              @mousedown.prevent="
                insertAtCursor(item.insertText, item.cursorBackOffset ?? 0, false)
              "
            >
              <span class="mx-fm-src-tag" :class="sourceColorClass(item.source, item.nodeKind)">
                {{ sourceBadgeLabel(item.source, item.nodeKind) }}
              </span>
              <span class="mx-fm-item-main">
                <span class="mx-fm-item-title mx-mono">{{ item.title }}</span>
                <span v-if="item.subtitle" class="mx-fm-item-sub">{{ item.subtitle }}</span>
              </span>
              <span v-if="item.valueText !== undefined" class="mx-fm-item-val mx-mono">
                = {{ item.valueText }}
              </span>
            </button>
            <div v-if="variableCatalog.length === 0" class="mx-fm-empty-list">
              {{ t('mx.formulaEditor.emptyCatalog') }}
            </div>
          </div>
        </div>

        <!-- 右栏：内置函数、骰子与连接语法库 -->
        <div class="mx-fm-col">
          <div class="mx-fm-col-head">
            <span class="mx-fm-col-title">{{ t('mx.formulaEditor.catalogFnsHeader') }}</span>
          </div>

          <div class="mx-fm-col-tools">
            <input
              v-model="fnQuery"
              type="text"
              class="mx-fm-search"
              :placeholder="t('mx.formulaEditor.searchPlaceholder')"
            />
          </div>

          <div class="mx-fm-list">
            <template v-if="edgeSyntaxPresets.length > 0 && !fnQuery.trim()">
              <div class="mx-fm-group-hdr">{{ t('mx.formulaEditor.edgePresetsGroup') }}</div>
              <button
                v-for="pr in edgeSyntaxPresets"
                :key="pr.key"
                type="button"
                class="mx-fm-item"
                @mousedown.prevent="((draftFormula = pr.code), focusCaret(pr.code.length))"
              >
                <span class="mx-fm-src-tag is-state-in">{{ resolvedContext.badge }}</span>
                <span class="mx-fm-item-main">
                  <span class="mx-fm-item-title mx-mono">{{ pr.code }}</span>
                  <span class="mx-fm-item-sub">{{ pr.desc }}</span>
                </span>
              </button>
              <div class="mx-fm-group-hdr">{{ t('mx.formulaEditor.mathFnsGroup') }}</div>
            </template>

            <button
              v-for="fn in functionCatalog"
              :key="fn.key"
              type="button"
              class="mx-fm-item"
              @mousedown.prevent="insertAtCursor(fn.insertText, fn.cursorBackOffset ?? 0, false)"
            >
              <span class="mx-fm-src-tag" :class="sourceColorClass(fn.source, fn.nodeKind)">
                {{ sourceBadgeLabel(fn.source, fn.nodeKind) }}
              </span>
              <span class="mx-fm-item-main">
                <span class="mx-fm-item-title mx-mono">{{ fn.title }}</span>
                <span v-if="itemSubtitle(fn)" class="mx-fm-item-sub">{{ itemSubtitle(fn) }}</span>
              </span>
              <span v-if="fn.valueText !== undefined" class="mx-fm-item-val mx-mono">
                {{ fn.valueText }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- 5. 底部确认与取消操作栏 -->
      <div class="mx-fm-footer">
        <span class="mx-fm-shortcut">{{ t('mx.formulaEditor.shortcutHint') }}</span>
        <div class="mx-fm-foot-btns">
          <button type="button" class="mx-fm-btn-cancel" @click="s.closeFormulaModal()">
            {{ t('mx.formulaEditor.cancelBtn') }}
          </button>
          <button type="button" class="mx-fm-btn-apply" @click="applyAndClose">
            ✓ {{ t('mx.formulaEditor.applyBtn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mx-fm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--overlay, rgba(8, 11, 18, 0.45));
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.mx-fm-panel {
  width: min(820px, 94vw);
  max-height: 88vh;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow:
    0 22px 60px var(--shadow, rgba(0, 0, 0, 0.45)),
    0 0 0 1px var(--accent-22, rgba(61, 139, 253, 0.22));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text);
}

.mx-mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* 1. Header */
.mx-fm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  cursor: move;
  user-select: none;
}

.mx-fm-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.mx-fm-ctx-badge {
  height: 28px;
  min-width: 32px;
  padding: 0 7px;
  border-radius: 7px;
  background: rgba(61, 139, 253, 0.16);
  border: 1px solid rgba(61, 139, 253, 0.38);
  color: #3b82f6;
  font-size: 12px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mx-fm-head-titles {
  min-width: 0;
}

.mx-fm-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.mx-fm-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

.mx-fm-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mx-fm-syntax-pill {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.mx-fm-syntax-pill.is-ok {
  background: rgba(16, 185, 129, 0.14);
  color: color-mix(in srgb, #10b981 80%, var(--text));
  border: 1px solid rgba(16, 185, 129, 0.3);
}
.mx-fm-syntax-pill.is-err {
  background: rgba(244, 63, 94, 0.16);
  color: color-mix(in srgb, #f43f5e 82%, var(--text));
  border: 1px solid rgba(244, 63, 94, 0.38);
}

.mx-fm-eval-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  background: var(--accent-12, rgba(59, 130, 246, 0.14));
  color: var(--accent, #3b82f6);
  border: 1px solid var(--accent-28, rgba(59, 130, 246, 0.3));
}
.mx-fm-eval-pill.is-rng {
  background: rgba(245, 158, 11, 0.15);
  color: color-mix(in srgb, #f59e0b 78%, var(--text));
  border-color: rgba(245, 158, 11, 0.34);
}
.mx-fm-eval-lbl {
  font-size: 10.5px;
  opacity: 0.82;
}

.mx-fm-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  line-height: 1;
  cursor: pointer;
}
.mx-fm-close-btn svg {
  display: block;
  pointer-events: none;
}
.mx-fm-close-btn:hover {
  background: rgba(244, 63, 94, 0.16);
  color: #f43f5e;
}

/* 2. Editor section */
.mx-fm-editor-sec {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mx-fm-editor-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mx-fm-sec-lbl {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.mx-fm-fmt-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.mx-fm-fmt-btn {
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}
.mx-fm-fmt-btn:hover {
  border-color: var(--accent);
  color: var(--text);
}
.mx-fm-fmt-btn.is-danger:hover {
  border-color: #f43f5e;
  color: #f43f5e;
}

.mx-fm-textarea-wrap {
  position: relative;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input, var(--bg));
  transition: border-color 0.15s;
}
.mx-fm-textarea-wrap.is-focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(61, 139, 253, 0.18);
}

.mx-fm-textarea {
  width: 100%;
  min-height: 76px;
  max-height: 150px;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  line-height: 1.55;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

/* Autocomplete popup inside modal */
.mx-fm-suggest-pop {
  position: absolute;
  left: 8px;
  right: 8px;
  top: calc(100% + 4px);
  z-index: 40;
  background: var(--bg-elevated);
  border: 1px solid var(--accent);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mx-fm-suggest-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.mx-fm-suggest-item.is-active,
.mx-fm-suggest-item:hover {
  background: var(--bg-hover);
}
.mx-fm-suggest-name {
  font-weight: 700;
}
.mx-fm-suggest-sub {
  color: var(--text-muted);
  font-size: 11px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-fm-suggest-val {
  color: #10b981;
  font-size: 11px;
}

/* Operator keypad */
.mx-fm-op-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.mx-fm-op-lbl {
  font-size: 11px;
  color: var(--text-muted);
  margin-right: 2px;
}
.mx-fm-op-btn {
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.mx-fm-op-btn:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

/* Syntax & rainbow parenthesis mirror */
.mx-fm-mirror-box {
  padding: 6px 10px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--bg-elevated) 48%, var(--bg-input, var(--bg-panel)));
  border: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mx-fm-mirror-lbl {
  font-size: 10px;
  color: var(--text-muted);
}
.mx-fm-mirror-code {
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.tok-param {
  color: color-mix(in srgb, #a855f7 82%, var(--text));
  font-weight: 700;
}
.tok-state {
  color: color-mix(in srgb, #0ea5e9 82%, var(--text));
  font-weight: 700;
}
.tok-node {
  color: color-mix(in srgb, #3b82f6 82%, var(--text));
  font-weight: 700;
}
.tok-builtin {
  color: color-mix(in srgb, #f59e0b 78%, var(--text));
  font-weight: 700;
}
.tok-fn {
  color: color-mix(in srgb, #d97706 80%, var(--text));
  font-weight: 600;
}
.tok-dice {
  color: color-mix(in srgb, #f43f5e 82%, var(--text));
  font-weight: 700;
}
.tok-num {
  color: color-mix(in srgb, #10b981 80%, var(--text));
}
.tok-unknown {
  color: color-mix(in srgb, #f59e0b 78%, var(--text));
  text-decoration: underline wavy #f59e0b;
}
.tok-op {
  color: var(--text-muted);
}
.tok-paren.tok-depth-0 {
  color: #3b82f6;
  font-weight: 800;
}
.tok-paren.tok-depth-1 {
  color: #f59e0b;
  font-weight: 800;
}
.tok-paren.tok-depth-2 {
  color: #10b981;
  font-weight: 800;
}
.tok-paren.tok-depth-3 {
  color: #a855f7;
  font-weight: 800;
}
.tok-paren.is-match-pair {
  background: rgba(250, 204, 21, 0.28);
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.65);
}
.tok-paren-err {
  color: #ffffff;
  background: rgba(244, 63, 94, 0.85);
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 800;
}

/* 3. Active referenced variable sources */
.mx-fm-refs-sec {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mx-fm-ref-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mx-fm-ref-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 5px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  font-size: 11.5px;
}

.mx-fm-ref-main {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: inherit;
  padding: 0;
  cursor: pointer;
}

.mx-fm-ref-tok {
  font-weight: 700;
}
.mx-fm-ref-alias {
  font-size: 11px;
  color: var(--text-muted);
}
.mx-fm-ref-val {
  color: #10b981;
  font-weight: 600;
}
.mx-fm-ref-edit {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.mx-fm-eq {
  opacity: 0.7;
}
.mx-fm-num-input {
  width: 60px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid rgba(168, 85, 247, 0.45);
  background: var(--bg-input, var(--bg));
  color: var(--text);
  font-size: 11.5px;
}
.mx-fm-promote-btn {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.16);
  color: color-mix(in srgb, #f59e0b 78%, var(--text));
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.mx-fm-empty-refs {
  font-size: 11px;
  color: var(--text-muted);
}

/* Source badge colors */
.mx-fm-src-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.mx-fm-src-tag.is-param {
  background: rgba(168, 85, 247, 0.16);
  color: color-mix(in srgb, #a855f7 80%, var(--text));
}
.mx-fm-src-tag.is-state-in {
  background: rgba(14, 165, 233, 0.16);
  color: color-mix(in srgb, #0ea5e9 80%, var(--text));
}
.mx-fm-src-tag.is-pool {
  background: rgba(59, 130, 246, 0.16);
  color: color-mix(in srgb, #3b82f6 80%, var(--text));
}
.mx-fm-src-tag.is-register {
  background: rgba(99, 102, 241, 0.18);
  color: color-mix(in srgb, #6366f1 80%, var(--text));
}
.mx-fm-src-tag.is-builtin {
  background: rgba(245, 158, 11, 0.16);
  color: color-mix(in srgb, #f59e0b 78%, var(--text));
}
.mx-fm-src-tag.is-unknown {
  background: rgba(244, 63, 94, 0.18);
  color: color-mix(in srgb, #f43f5e 80%, var(--text));
}

/* 4. 2-Column Browser */
.mx-fm-browser-grid {
  flex: 1;
  min-height: 190px;
  max-height: 290px;
  display: grid;
  grid-template-columns: 1.08fr 0.92fr;
  overflow: hidden;
}

.mx-fm-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
}
.mx-fm-col:last-child {
  border-right: none;
}

.mx-fm-col-head {
  padding: 7px 12px 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.mx-fm-col-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
}

.mx-fm-mini-tabs {
  display: flex;
  gap: 3px;
}
.mx-fm-mini-tab {
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
  cursor: pointer;
}
.mx-fm-mini-tab.is-active {
  background: rgba(61, 139, 253, 0.16);
  border-color: rgba(61, 139, 253, 0.35);
  color: #3b82f6;
  font-weight: 600;
}

.mx-fm-col-tools {
  padding: 0 12px 6px;
}

.mx-fm-search {
  width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg));
  color: var(--text);
  font-size: 11.5px;
  box-sizing: border-box;
  outline: none;
}
.mx-fm-search:focus {
  border-color: var(--accent);
}

.mx-fm-new-param-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px 6px;
}
.mx-fm-np-name {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg));
  color: var(--text);
  font-size: 11px;
}
.mx-fm-np-val {
  width: 52px;
  padding: 3px 5px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg));
  color: var(--text);
  font-size: 11px;
}
.mx-fm-np-btn {
  padding: 3px 7px;
  border-radius: 5px;
  border: 1px solid rgba(168, 85, 247, 0.45);
  background: rgba(168, 85, 247, 0.16);
  color: color-mix(in srgb, #a855f7 80%, var(--text));
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.mx-fm-np-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mx-fm-list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mx-fm-group-hdr {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  padding: 4px 4px 2px;
}

.mx-fm-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.mx-fm-item:hover {
  background: var(--bg-hover);
  border-color: rgba(61, 139, 253, 0.28);
}

.mx-fm-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.mx-fm-item-title {
  font-size: 11.5px;
  font-weight: 700;
}
.mx-fm-item-sub {
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-fm-item-val {
  font-size: 11px;
  color: #10b981;
  font-weight: 600;
}

.mx-fm-empty-list {
  padding: 14px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
}

/* 5. Footer */
.mx-fm-footer {
  padding: 9px 14px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.mx-fm-shortcut {
  font-size: 11px;
  color: var(--text-muted);
}

.mx-fm-foot-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mx-fm-btn-cancel {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.mx-fm-btn-cancel:hover {
  background: var(--bg-hover);
}

.mx-fm-btn-apply {
  padding: 5px 16px;
  border-radius: 6px;
  border: 1px solid var(--accent, #2563eb);
  background: var(--accent, #2563eb);
  color: var(--on-accent, #ffffff);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.mx-fm-btn-apply:hover {
  background: var(--accent-hover, #1d4ed8);
  border-color: var(--accent-hover, #1d4ed8);
}
</style>
