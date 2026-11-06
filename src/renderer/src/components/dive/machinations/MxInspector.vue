<script setup lang="ts">
/**
 * Machinations 右侧属性检查器（主题自适应 + 完整节点/连线/出入边管理）：
 *  - 顶部 `#ID / Kind` + 折叠按钮 `»`
 *  - Label + Add notes...
 *  - Functionality 折叠区：Trigger 四宫格、Conversion、Pull Mode、Resources、Ignore disabled inputs + 各图元专属字段
 *  - Connections 折叠区：直接查看/修改该节点的所有入边与出边公式，或一键新增连向目标节点的资源边/状态边
 *  - 选中连线时：编辑公式、快速筹码、实线/虚线切换、反转方向、弧度滑杆、颜色
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  parseMxFlowFormula,
  parseMxStateFormula,
  resolveMxNodeConsumers,
  validateMxFormula,
  type MxEdgeKind,
  type MxNodeKind,
  type MxPullMode,
  type MxTrigger
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'
import MxFormulaEditor from './MxFormulaEditor.vue'

const { t } = useI18n()
const s = useMxStudioStore()

const funcOpen = ref(true)
const condRefsOpen = ref(true)
const connOpen = ref(true)
const styleOpen = ref(true)
const quickTargetNodeId = ref('')
const quickTargetEdgeKind = ref<MxEdgeKind>('resource')

const selectedNode = computed(() => {
  if (s.selection.nodes.length !== 1) return null
  return s.doc.value.nodes.find((n) => n.id === s.selection.nodes[0]) ?? null
})

const selectedNodeConsumerItems = computed(() => {
  void s.topologyRevision.value
  const docSnap = s.peekDoc()
  const selIds = s.selection.nodes
  if (selIds.length !== 1) return []
  const n = docSnap.nodes.find((x) => x.id === selIds[0])
  if (!n || n.kind === 'note') return []
  const res = resolveMxNodeConsumers(docSnap, [n.id])
  const items: Array<{
    key: string
    badge: string
    title: string
    token: string
    formula: string
    onClick: () => void
  }> = []
  for (const nh of res.nodes) {
    const cn = docSnap.nodes.find((x) => x.id === nh.consumerNodeId)
    if (!cn) continue
    const badge =
      nh.sourceField === 'botCondition'
        ? '⚡'
        : cn.kind === 'register'
          ? '[x]'
          : cn.kind === 'end'
            ? '■'
            : 'fx'
    items.push({
      key: `n:${nh.consumerNodeId}:${nh.sourceField}`,
      badge,
      title: cn.label || cn.id,
      token: nh.token,
      formula: nh.formula,
      onClick: () => s.select([cn.id], [])
    })
  }
  for (const eh of res.edges) {
    const ce = docSnap.edges.find((x) => x.id === eh.consumerEdgeId)
    if (!ce) continue
    const fromNode = docSnap.nodes.find((x) => x.id === ce.from)
    const toNode = docSnap.nodes.find((x) => x.id === ce.to)
    const fromLbl = fromNode?.label || ce.from
    const toLbl = ce.targetEdgeId ? `#${ce.targetEdgeId}` : toNode?.label || ce.to
    items.push({
      key: `e:${eh.consumerEdgeId}`,
      badge: ce.kind === 'state' ? '╌►' : '──►',
      title: `${fromLbl} → ${toLbl}`,
      token: eh.token,
      formula: eh.formula,
      onClick: () => s.select([], [ce.id])
    })
  }
  for (const ph of res.params) {
    items.push({
      key: `p:${ph.consumerParamId}`,
      badge: 'x=',
      title: ph.paramName,
      token: ph.token,
      formula: ph.formula,
      onClick: () => {
        s.drawer.value = 'params'
      }
    })
  }
  return items
})

const selectedEdge = computed(() => {
  if (s.selection.nodes.length > 0 || s.selection.edges.length !== 1) return null
  return s.doc.value.edges.find((e) => e.id === s.selection.edges[0]) ?? null
})

const nodeIncomingEdges = computed(() => {
  const n = selectedNode.value
  if (!n) return []
  return s.doc.value.edges.filter((e) => !e.targetEdgeId && e.to === n.id)
})

const nodeOutgoingEdges = computed(() => {
  const n = selectedNode.value
  if (!n) return []
  return s.doc.value.edges.filter((e) => e.from === n.id)
})

const otherConnectableNodes = computed(() => {
  const n = selectedNode.value
  if (!n) return []
  return s.doc.value.nodes.filter((x) => x.id !== n.id && x.kind !== 'note')
})

const triggers: Array<{ id: MxTrigger; badge: string; labelKey: string }> = [
  { id: 'passive', badge: '·', labelKey: 'mx.trigger.passive' },
  { id: 'automatic', badge: '*', labelKey: 'mx.trigger.automatic' },
  { id: 'interactive', badge: '◉', labelKey: 'mx.trigger.interactive' },
  { id: 'enabling', badge: 'e', labelKey: 'mx.trigger.enabling' }
]

const pullModes: Array<{ id: MxPullMode; code: string; labelKey: string }> = [
  { id: 'pull_any', code: 'p', labelKey: 'mx.pull.pull_any' },
  { id: 'pull_all', code: 'p&', labelKey: 'mx.pull.pull_all' },
  { id: 'push_any', code: 'ps', labelKey: 'mx.pull.push_any' },
  { id: 'push_all', code: 'ps&', labelKey: 'mx.pull.push_all' }
]

const availablePullModes = computed(() => {
  const n = selectedNode.value
  if (!n) return []
  if (n.kind === 'source') {
    return pullModes.filter((p) => p.id === 'push_any' || p.id === 'push_all')
  }
  if (n.kind === 'pool') return pullModes
  if (
    n.kind === 'drain' ||
    n.kind === 'converter' ||
    n.kind === 'trader' ||
    n.kind === 'gate' ||
    n.kind === 'delay' ||
    n.kind === 'queue'
  ) {
    return pullModes.filter((p) => p.id === 'pull_any' || p.id === 'pull_all')
  }
  return []
})

const effectiveNodePullMode = computed<MxPullMode>(() => {
  const n = selectedNode.value
  if (!n) return 'pull_any'
  if (n.pullMode) return n.pullMode
  if (n.kind === 'source') return 'push_any'
  if (n.kind === 'converter' || n.kind === 'trader') return 'pull_all'
  return 'pull_any'
})

const swatches = [
  '#3b82f6',
  '#10b981',
  '#ef4444',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#64748b'
]

const resourceChips = [
  '1',
  '2',
  'D6',
  '50%',
  '250%',
  'all',
  '1|2',
  '1|3..6',
  'D6|D6',
  '<4',
  '>=4',
  '1..3'
]
const stateChips = [
  '+1',
  '-1',
  '+50%',
  '+1/3',
  '-2/4',
  '+1i',
  '-1i',
  '=',
  '*',
  '!',
  '25%',
  '>=5',
  '==0',
  '!=0',
  '2..8'
]
const registerFnChips = [
  'lookup(a, 10, 25, 60, 150)',
  'diminish(a, 100, 1)',
  'largerEq(a, 2) * (b + 4)',
  'mod(STEP, 3)',
  'randomInt(1, 10)',
  'clamp(a, 0, 100)'
]

const selectedEdgeFormulaType = computed(() => {
  const e = selectedEdge.value
  if (!e) return ''
  const raw = (e.formula ?? '').trim()
  if (e.kind === 'state') {
    const sp = parseMxStateFormula(raw)
    switch (sp.type) {
      case 'modifier':
        return 'st_modifier'
      case 'fraction_modifier':
        return 'st_fraction'
      case 'interval_modifier':
        return 'st_interval'
      case 'overwrite':
        return 'st_overwrite'
      case 'activator':
        return 'st_activator'
      case 'range':
        return 'st_range'
      case 'probability':
        return 'st_prob'
      case 'trigger':
        return 'st_trigger'
      case 'reverse_trigger':
        return 'st_rev_trigger'
      case 'expr':
        return 'st_formula'
    }
  }
  const fp = parseMxFlowFormula(raw)
  if (fp.type === 'all') return 'all'
  const coreRaw = raw.replace(/\s*(?:\||every\b).*$/i, '').trim()
  const fromNode = s.doc.value.nodes.find((n) => n.id === e.from)
  if (/^(?:>=|<=|==|!=|<>|>|<|=)/.test(coreRaw)) return 'cond_gate'
  if (/^-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?$/.test(coreRaw) && fromNode?.kind === 'gate') {
    return 'cond_gate'
  }
  if (/^\d+(?:\.\d+)?\s*%$/.test(coreRaw) || (fp.probability !== undefined && fp.expr === '1')) {
    return 'chance'
  }
  if (/^\d*[dD]\d+(?:\s*[+-]\s*\d+)?$/.test(coreRaw)) {
    return 'dice'
  }
  if (coreRaw === '' || /^-?\d+(?:\.\d+)?$/.test(coreRaw)) {
    return 'number'
  }
  return 'formula'
})

const activeEdgeChips = computed<string[]>(() => {
  const e = selectedEdge.value
  if (!e) return resourceChips
  if (e.kind === 'state') return stateChips
  switch (selectedEdgeFormulaType.value) {
    case 'number':
      return ['1', '2', '5', '10', '25', '100']
    case 'chance':
      return ['10%', '25%', '50%', '75%', '100%', '250%']
    case 'dice':
      return ['D4', 'D6', 'D8', 'D10', 'D12', 'D20', '2D6', 'D100']
    case 'cond_gate':
      return ['<4', '>=4', '==6', '1..2', '3..4', '5..6']
    case 'all':
      return ['all']
    case 'formula':
    default:
      return ['a + 1', '1..6', 'D6 + 2', 'min(10, a)', 'STEP', 'lookup(a, 1, 2, 5)']
  }
})

const edgeInlineIntervalHint = computed(() => {
  const e = selectedEdge.value
  if (!e || e.kind !== 'resource') return '1'
  const fp = parseMxFlowFormula(e.formula)
  return fp.intervalExpr || (fp.every ? String(fp.every) : '1')
})

function onEdgeFormulaTypeChange(ft: string): void {
  const e = selectedEdge.value
  if (!e) return
  if (selectedEdgeFormulaType.value === ft) return
  const defaults: Record<string, string> = {
    number: '1',
    chance: '50%',
    dice: 'D6',
    formula: 'a + 1',
    all: 'all',
    cond_gate: '<4',
    st_modifier: '+1',
    st_fraction: '+1/3',
    st_interval: '+1i',
    st_overwrite: '=',
    st_activator: '>=5',
    st_range: '2..8',
    st_prob: '25%',
    st_trigger: '*',
    st_rev_trigger: '!',
    st_formula: 'a >= 5'
  }
  const tpl = defaults[ft]
  if (tpl !== undefined) {
    const fp = e.kind === 'resource' ? parseMxFlowFormula(e.formula) : null
    const preservedIv =
      !e.interval && fp && fp.type !== 'all'
        ? fp.intervalExpr || (fp.every ? String(fp.every) : undefined)
        : undefined
    s.updateEdge(e.id, {
      formula: tpl,
      ...(preservedIv ? { interval: preservedIv } : {})
    })
  }
}

function onEdgeIntervalChange(val: string): void {
  const e = selectedEdge.value
  if (!e) return
  const trimmed = val.trim()
  const nextPatch: { interval?: string; formula?: string } = {
    interval: trimmed || undefined
  }
  if (trimmed && /\|/.test(e.formula)) {
    nextPatch.formula = e.formula.replace(/\s*\|.*$/, '').trim() || '1'
  }
  s.updateEdge(e.id, nextPatch, 'edgeInterval')
}

function onEdgeResourceFilterSelect(resId: string): void {
  const e = selectedEdge.value
  if (!e) return
  if (!resId) {
    s.updateEdge(e.id, { resourceFilter: false, resourceId: undefined })
  } else {
    s.updateEdge(e.id, { resourceFilter: true, resourceId: resId })
  }
}

function toggleSelectedEdgeInfluencer(): void {
  const e = selectedEdge.value
  if (!e) return
  s.updateEdge(e.id, { influencer: !e.influencer })
}

function toggleSelectedNodeInfluencer(): void {
  const n = selectedNode.value
  if (!n) return
  s.updateNode(n.id, { influencer: !n.influencer })
}

const selectedNodeFormulaValidation = computed(() => {
  const n = selectedNode.value
  if (
    !n ||
    (n.kind !== 'register' && n.kind !== 'end' && n.kind !== 'delay' && n.kind !== 'queue')
  ) {
    return null
  }
  return validateMxFormula(n.formula, n.kind === 'end' ? 'end' : 'register')
})

const selectedEdgeFormulaValidation = computed(() => {
  const e = selectedEdge.value
  if (!e) return null
  return validateMxFormula(e.formula, e.kind)
})

const selectedEdgeIntervalValidation = computed(() => {
  const e = selectedEdge.value
  if (!e || e.kind !== 'resource' || !e.interval?.trim()) return null
  return validateMxFormula(e.interval.trim(), 'register')
})

function onEdgeKindSwitch(ek: MxEdgeKind): void {
  const e = selectedEdge.value
  if (!e || e.kind === ek) return
  s.updateEdge(e.id, {
    kind: ek,
    ...(ek === 'resource' ? { targetEdgeId: undefined } : {}),
    ...(ek === 'state' && e.formula === '1' ? { formula: '+1' } : {}),
    ...(ek === 'resource' && e.formula === '+1' ? { formula: '1' } : {})
  })
}

function kindTitle(kind: MxNodeKind): string {
  return t(`mx.kind.${kind}`)
}

function edgeEndpointLabel(nodeId: string): string {
  const n = s.doc.value.nodes.find((x) => x.id === nodeId)
  return n ? n.label || n.id : nodeId
}

function onResourceSelect(resId: string): void {
  const n = selectedNode.value
  if (!n) return
  if (!resId) {
    const prevRes = n.resourceId
      ? s.doc.value.resources.find((r) => r.id === n.resourceId)
      : undefined
    s.updateNode(n.id, {
      resourceId: undefined,
      ...(prevRes && n.color === prevRes.color ? { color: undefined } : {})
    })
    return
  }
  const res = s.doc.value.resources.find((r) => r.id === resId)
  s.updateNode(n.id, {
    resourceId: resId,
    ...(res ? { color: res.color } : {})
  })
}

function addQuickConnectionFromInspector(): void {
  const n = selectedNode.value
  if (!n || !quickTargetNodeId.value) return
  s.addEdge(quickTargetEdgeKind.value, n.id, quickTargetNodeId.value)
  s.select([n.id])
  quickTargetNodeId.value = ''
}
</script>

<template>
  <aside class="mx-inspector" :class="{ 'is-collapsed': !s.inspectorOpen.value }">
    <button
      v-if="!s.inspectorOpen.value"
      type="button"
      class="mx-insp-expand"
      :title="t('mx.inspector.expand')"
      @click="s.inspectorOpen.value = true"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="7 4 3 8 7 12" />
        <polyline points="12 4 8 8 12 12" />
      </svg>
    </button>

    <template v-else>
      <!-- ═════════════ 选中单个节点 ═════════════ -->
      <template v-if="selectedNode">
        <header class="mx-insp-head">
          <div class="mx-insp-id">
            <span class="mx-insp-hash">#{{ selectedNode.id }}</span>
            <span class="mx-insp-slash">/</span>
            <span class="mx-insp-kind">{{ kindTitle(selectedNode.kind) }}</span>
          </div>
          <button
            type="button"
            class="mx-insp-collapse"
            :title="t('mx.inspector.collapse')"
            @click="s.inspectorOpen.value = false"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="4 4 8 8 4 12" />
              <polyline points="9 4 13 8 9 12" />
            </svg>
          </button>
        </header>

        <div class="mx-insp-body">
          <!-- Label + Notes -->
          <div class="mx-insp-block">
            <label class="mx-field-label">{{ t('mx.inspector.label') }}</label>
            <input
              class="mx-input"
              type="text"
              :value="selectedNode.label"
              @input="
                s.updateNode(
                  selectedNode.id,
                  { label: ($event.target as HTMLInputElement).value },
                  'label'
                )
              "
            />
            <textarea
              class="mx-textarea"
              rows="2"
              :placeholder="t('mx.inspector.notesPlaceholder')"
              :value="selectedNode.notes ?? ''"
              @input="
                s.updateNode(
                  selectedNode.id,
                  { notes: ($event.target as HTMLTextAreaElement).value },
                  'notes'
                )
              "
            />
          </div>

          <!-- Functionality 折叠区（Note 节点除外） -->
          <div v-if="selectedNode.kind !== 'note'" class="mx-insp-section">
            <button type="button" class="mx-sec-head" @click="funcOpen = !funcOpen">
              <span>{{ t('mx.inspector.functionality') }}</span>
              <span class="mx-caret">{{ funcOpen ? '▾' : '▸' }}</span>
            </button>

            <div v-if="funcOpen" class="mx-sec-body">
              <!-- Trigger 4 宫格 -->
              <label class="mx-field-label">{{ t('mx.inspector.trigger') }}</label>
              <div class="mx-trigger-grid">
                <button
                  v-for="tr in triggers"
                  :key="tr.id"
                  type="button"
                  class="mx-trigger-tile"
                  :class="{ 'is-active': selectedNode.trigger === tr.id }"
                  @click="s.updateNode(selectedNode.id, { trigger: tr.id })"
                >
                  <span class="mx-trigger-icon">{{ tr.badge }}</span>
                  <span class="mx-trigger-name">{{ t(tr.labelKey) }}</span>
                </button>
              </div>

              <!-- Interactive 专属：Player AI Bot 策略 -->
              <template v-if="selectedNode.trigger === 'interactive'">
                <label class="mx-field-label">🤖 {{ t('mx.inspector.botPolicy') }}</label>
                <select
                  class="mx-select"
                  :value="selectedNode.botPolicy ?? 'inherit'"
                  @change="
                    s.updateNode(selectedNode.id, {
                      botPolicy: ($event.target as HTMLSelectElement).value as
                        'inherit' | 'off' | 'greedy' | 'probabilistic' | 'condition'
                    })
                  "
                >
                  <option value="inherit">{{ t('mx.inspector.botInherit') }}</option>
                  <option value="off">{{ t('mx.inspector.botOff') }}</option>
                  <option value="greedy">{{ t('mx.inspector.botGreedy') }}</option>
                  <option value="probabilistic">{{ t('mx.inspector.botProb') }}</option>
                  <option value="condition">{{ t('mx.inspector.botCond') }}</option>
                </select>
                <div v-if="selectedNode.botPolicy === 'probabilistic'" class="mx-two-col">
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.botProbPct') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      min="0"
                      max="100"
                      :value="selectedNode.botProbability ?? 50"
                      @input="
                        s.updateNode(selectedNode.id, {
                          botProbability: Number(($event.target as HTMLInputElement).value) || 0
                        })
                      "
                    />
                  </div>
                </div>
                <div
                  v-if="
                    selectedNode.botPolicy === 'condition' ||
                    ((selectedNode.botPolicy ?? 'inherit') === 'inherit' &&
                      s.doc.value.settings.botMode === 'smart')
                  "
                >
                  <label class="mx-field-label">{{ t('mx.inspector.botCondExpr') }}</label>
                  <MxFormulaEditor
                    :model-value="selectedNode.botCondition ?? ''"
                    placeholder="HP <= 40"
                    context-kind="expr"
                    :owner-node-id="selectedNode.id"
                    target-field="botCondition"
                    compact
                    @update:model-value="
                      (val) => s.updateNode(selectedNode!.id, { botCondition: val }, 'botCond')
                    "
                  />
                </div>
              </template>

              <!-- Conversion (Converter / Trader) -->
              <template v-if="selectedNode.kind === 'converter' || selectedNode.kind === 'trader'">
                <label class="mx-field-label">{{ t('mx.inspector.conversion') }}</label>
                <div class="mx-seg-row">
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': (selectedNode.conversion ?? 'single') === 'single' }"
                    @click="s.updateNode(selectedNode.id, { conversion: 'single' })"
                  >
                    →| {{ t('mx.inspector.conversionSingle') }}
                  </button>
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': selectedNode.conversion === 'multiple' }"
                    @click="s.updateNode(selectedNode.id, { conversion: 'multiple' })"
                  >
                    ⇉| {{ t('mx.inspector.conversionMultiple') }}
                  </button>
                </div>
              </template>

              <!-- Pull Mode -->
              <template v-if="availablePullModes.length > 0">
                <label class="mx-field-label">{{ t('mx.inspector.pullMode') }}</label>
                <div class="mx-pull-grid">
                  <button
                    v-for="pm in availablePullModes"
                    :key="pm.id"
                    type="button"
                    class="mx-pull-btn"
                    :class="{ 'is-active': effectiveNodePullMode === pm.id }"
                    @click="s.updateNode(selectedNode.id, { pullMode: pm.id })"
                  >
                    <span class="mx-pull-code">{{ pm.code }}</span>
                    <span>{{ t(pm.labelKey) }}</span>
                  </button>
                </div>
              </template>

              <!-- Resources 下拉（排除无颜色资源概念的 Register 与 End 节点） -->
              <template v-if="selectedNode.kind !== 'register' && selectedNode.kind !== 'end'">
                <label class="mx-field-label">{{ t('mx.inspector.resources') }}</label>
                <div class="mx-res-select-wrap">
                  <span
                    class="mx-res-dot"
                    :style="{ background: selectedNode.color || '#3b82f6' }"
                  />
                  <select
                    class="mx-select"
                    :value="selectedNode.resourceId ?? ''"
                    @change="onResourceSelect(($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">{{ t('mx.inspector.anyResource') }}</option>
                    <option v-for="r in s.doc.value.resources" :key="r.id" :value="r.id">
                      {{ r.name }}
                    </option>
                  </select>
                </div>
              </template>

              <!-- Ignore disabled inputs（Source 无入边故隐藏） -->
              <label v-if="selectedNode.kind !== 'source'" class="mx-check-row">
                <input
                  type="checkbox"
                  :checked="Boolean(selectedNode.ignoreDisabledInputs)"
                  @change="
                    s.updateNode(selectedNode.id, {
                      ignoreDisabledInputs: ($event.target as HTMLInputElement).checked
                    })
                  "
                />
                <span>{{ t('mx.inspector.ignoreDisabledInputs') }}</span>
              </label>

              <!-- Pool 专属：Initial / Capacity / ShowAs -->
              <template v-if="selectedNode.kind === 'pool'">
                <div class="mx-two-col">
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.initial') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      :value="selectedNode.initial ?? 0"
                      @input="
                        s.updateNode(
                          selectedNode.id,
                          { initial: Number(($event.target as HTMLInputElement).value) || 0 },
                          'initial'
                        )
                      "
                    />
                  </div>
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.capacity') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      :value="selectedNode.capacity ?? -1"
                      @input="
                        s.updateNode(
                          selectedNode.id,
                          { capacity: Number(($event.target as HTMLInputElement).value) },
                          'cap'
                        )
                      "
                    />
                  </div>
                </div>
                <template v-if="selectedNode.capacity && selectedNode.capacity > 0">
                  <label class="mx-field-label">{{ t('mx.inspector.overflowMode') }}</label>
                  <div class="mx-seg-row">
                    <button
                      type="button"
                      class="mx-seg-btn"
                      :class="{ 'is-active': (selectedNode.overflow ?? 'block') === 'block' }"
                      @click="s.updateNode(selectedNode.id, { overflow: 'block' })"
                    >
                      {{ t('mx.inspector.overflowBlock') }}
                    </button>
                    <button
                      type="button"
                      class="mx-seg-btn"
                      :class="{ 'is-active': selectedNode.overflow === 'drain' }"
                      @click="s.updateNode(selectedNode.id, { overflow: 'drain' })"
                    >
                      {{ t('mx.inspector.overflowDrain') }}
                    </button>
                  </div>
                </template>
                <label class="mx-field-label">{{ t('mx.inspector.showInNode') }}</label>
                <div class="mx-seg-row">
                  <button
                    v-for="modeOpt in ['number', 'tokens', 'both'] as const"
                    :key="modeOpt"
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': (selectedNode.showAs ?? 'number') === modeOpt }"
                    @click="s.updateNode(selectedNode.id, { showAs: modeOpt })"
                  >
                    {{ t(`mx.inspector.show_${modeOpt}`) }}
                  </button>
                </div>
                <div class="mx-two-col">
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.displayCapacity') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      min="-1"
                      max="100"
                      :value="selectedNode.displayCapacity ?? 25"
                      @input="
                        s.updateNode(
                          selectedNode.id,
                          {
                            displayCapacity: Math.max(
                              -1,
                              Math.min(
                                100,
                                Number.isFinite(Number(($event.target as HTMLInputElement).value))
                                  ? Math.round(Number(($event.target as HTMLInputElement).value))
                                  : 25
                              )
                            )
                          },
                          'dispCap'
                        )
                      "
                    />
                  </div>
                </div>
                <template v-if="selectedNode.trigger === 'passive'">
                  <label class="mx-field-label">{{ t('mx.inspector.triggerOn') }}</label>
                  <div class="mx-seg-row">
                    <button
                      type="button"
                      class="mx-seg-btn"
                      :class="{
                        'is-active': (selectedNode.triggerOn ?? 'increase') === 'increase'
                      }"
                      @click="s.updateNode(selectedNode.id, { triggerOn: 'increase' })"
                    >
                      {{ t('mx.inspector.trigIncrease') }}
                    </button>
                    <button
                      type="button"
                      class="mx-seg-btn"
                      :class="{ 'is-active': selectedNode.triggerOn === 'decrease' }"
                      @click="s.updateNode(selectedNode.id, { triggerOn: 'decrease' })"
                    >
                      {{ t('mx.inspector.trigDecrease') }}
                    </button>
                    <button
                      type="button"
                      class="mx-seg-btn"
                      :class="{ 'is-active': selectedNode.triggerOn === 'any_change' }"
                      @click="s.updateNode(selectedNode.id, { triggerOn: 'any_change' })"
                    >
                      {{ t('mx.inspector.trigAnyChange') }}
                    </button>
                  </div>
                </template>
              </template>

              <!-- Register 专属：Formula / Initial / Step / Min / Max -->
              <template v-if="selectedNode.kind === 'register'">
                <div class="mx-field-head-row">
                  <label class="mx-field-label">{{ t('mx.inspector.formula') }}</label>
                  <span
                    v-if="selectedNode.formula?.trim() && selectedNodeFormulaValidation"
                    class="mx-formula-status"
                    :class="selectedNodeFormulaValidation.valid ? 'is-ok' : 'is-err'"
                    :title="selectedNodeFormulaValidation.error ?? ''"
                  >
                    {{
                      selectedNodeFormulaValidation.valid
                        ? '✓ OK'
                        : `⚠ ${selectedNodeFormulaValidation.error}`
                    }}
                  </span>
                </div>
                <MxFormulaEditor
                  :model-value="selectedNode.formula ?? ''"
                  placeholder="lookup(a, 10, 25, 60) + 2"
                  context-kind="register"
                  :owner-node-id="selectedNode.id"
                  @update:model-value="
                    (val) => s.updateNode(selectedNode!.id, { formula: val }, 'regFormula')
                  "
                />
                <div class="mx-chip-row">
                  <button
                    v-for="fnChip in registerFnChips"
                    :key="fnChip"
                    type="button"
                    class="mx-chip"
                    @click="s.updateNode(selectedNode.id, { formula: fnChip })"
                  >
                    {{ fnChip }}
                  </button>
                </div>
                <div class="mx-two-col">
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.initial') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      :value="selectedNode.initial ?? 0"
                      @input="
                        s.updateNode(
                          selectedNode.id,
                          { initial: Number(($event.target as HTMLInputElement).value) || 0 },
                          'regInit'
                        )
                      "
                    />
                  </div>
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.regStep') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      :value="selectedNode.step ?? 1"
                      @input="
                        s.updateNode(
                          selectedNode.id,
                          { step: Number(($event.target as HTMLInputElement).value) || 1 },
                          'regStep'
                        )
                      "
                    />
                  </div>
                </div>
                <div class="mx-two-col">
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.min') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      :value="selectedNode.min ?? ''"
                      placeholder="-∞"
                      @input="
                        s.updateNode(selectedNode.id, {
                          min:
                            ($event.target as HTMLInputElement).value === ''
                              ? undefined
                              : Number(($event.target as HTMLInputElement).value)
                        })
                      "
                    />
                  </div>
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.max') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      :value="selectedNode.max ?? ''"
                      placeholder="+∞"
                      @input="
                        s.updateNode(selectedNode.id, {
                          max:
                            ($event.target as HTMLInputElement).value === ''
                              ? undefined
                              : Number(($event.target as HTMLInputElement).value)
                        })
                      "
                    />
                  </div>
                </div>
              </template>

              <!-- Gate 专属：Gate Mode + 条件检定掷骰公式 -->
              <template v-if="selectedNode.kind === 'gate'">
                <label class="mx-field-label">{{ t('mx.inspector.gateMode') }}</label>
                <div class="mx-seg-row">
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': selectedNode.gateMode === 'deterministic' }"
                    @click="s.updateNode(selectedNode.id, { gateMode: 'deterministic' })"
                  >
                    {{ t('mx.inspector.gateDeterministic') }}
                  </button>
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{
                      'is-active':
                        (selectedNode.gateMode ?? 'random') === 'random' ||
                        selectedNode.gateMode === 'dice'
                    }"
                    @click="s.updateNode(selectedNode.id, { gateMode: 'random' })"
                  >
                    🎲 {{ t('mx.inspector.gateDice') }}
                  </button>
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': selectedNode.gateMode === 'skill' }"
                    @click="s.updateNode(selectedNode.id, { gateMode: 'skill' })"
                  >
                    🎯 {{ t('mx.inspector.gateSkill') }}
                  </button>
                </div>

                <template
                  v-if="
                    selectedNode.gateMode !== 'deterministic' && selectedNode.gateMode !== 'skill'
                  "
                >
                  <label class="mx-field-label">{{ t('mx.inspector.gateRollFormula') }}</label>
                  <MxFormulaEditor
                    :model-value="selectedNode.formula ?? ''"
                    placeholder="D6 / 2D6 / D20"
                    context-kind="expr"
                    :owner-node-id="selectedNode.id"
                    compact
                    @update:model-value="
                      (val) => s.updateNode(selectedNode!.id, { formula: val || undefined })
                    "
                  />
                  <div class="mx-chip-row">
                    <button
                      v-for="preset in ['D6', '2D6', 'D20', 'D100']"
                      :key="preset"
                      type="button"
                      class="mx-chip"
                      @click="
                        s.updateNode(selectedNode.id, {
                          formula: preset === 'D6' ? undefined : preset
                        })
                      "
                    >
                      {{ preset }}
                    </button>
                  </div>
                </template>
              </template>

              <!-- Delay / Queue 专属：一键互换 + Delay Steps + 动态延迟公式 -->
              <template v-if="selectedNode.kind === 'delay' || selectedNode.kind === 'queue'">
                <button
                  type="button"
                  class="mx-seg-btn"
                  style="width: 100%; margin-bottom: 6px"
                  @click="
                    s.updateNode(selectedNode.id, {
                      kind: selectedNode.kind === 'delay' ? 'queue' : 'delay'
                    })
                  "
                >
                  ⇄
                  {{
                    t('mx.inspector.switchDelayQueue', {
                      target: kindTitle(selectedNode.kind === 'delay' ? 'queue' : 'delay')
                    })
                  }}
                </button>
                <label class="mx-field-label">{{ t('mx.inspector.delaySteps') }}</label>
                <input
                  class="mx-input"
                  type="number"
                  min="1"
                  max="100"
                  :value="selectedNode.delaySteps ?? 1"
                  @input="
                    s.updateNode(selectedNode.id, {
                      delaySteps: Math.max(
                        1,
                        Number(($event.target as HTMLInputElement).value) || 1
                      )
                    })
                  "
                />
                <label class="mx-field-label">{{ t('mx.inspector.delayExpr') }}</label>
                <MxFormulaEditor
                  :model-value="selectedNode.formula ?? ''"
                  placeholder="D6"
                  context-kind="expr"
                  :owner-node-id="selectedNode.id"
                  compact
                  @update:model-value="
                    (val) => s.updateNode(selectedNode!.id, { formula: val }, 'delayExpr')
                  "
                />
              </template>

              <!-- End 专属：Condition + Multi-input AND/OR -->
              <template v-if="selectedNode.kind === 'end'">
                <label class="mx-field-label">{{ t('mx.inspector.endMode') }}</label>
                <div class="mx-seg-row">
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': (selectedNode.endMode ?? 'all') === 'all' }"
                    @click="s.updateNode(selectedNode.id, { endMode: 'all' })"
                  >
                    {{ t('mx.inspector.endAll') }}
                  </button>
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': selectedNode.endMode === 'any' }"
                    @click="s.updateNode(selectedNode.id, { endMode: 'any' })"
                  >
                    {{ t('mx.inspector.endAny') }}
                  </button>
                </div>
                <div class="mx-field-head-row">
                  <label class="mx-field-label">{{ t('mx.inspector.endCondition') }}</label>
                  <span
                    v-if="selectedNode.formula?.trim() && selectedNodeFormulaValidation"
                    class="mx-formula-status"
                    :class="selectedNodeFormulaValidation.valid ? 'is-ok' : 'is-err'"
                    :title="selectedNodeFormulaValidation.error ?? ''"
                  >
                    {{
                      selectedNodeFormulaValidation.valid
                        ? '✓ OK'
                        : `⚠ ${selectedNodeFormulaValidation.error}`
                    }}
                  </span>
                </div>
                <MxFormulaEditor
                  :model-value="selectedNode.formula ?? ''"
                  placeholder="<=0"
                  context-kind="end"
                  :owner-node-id="selectedNode.id"
                  @update:model-value="(val) => s.updateNode(selectedNode!.id, { formula: val })"
                />
                <div class="mx-chip-row">
                  <button
                    v-for="condChip in ['<=0', '>=100', '==0', 'a <= 0']"
                    :key="condChip"
                    type="button"
                    class="mx-chip"
                    @click="s.updateNode(selectedNode.id, { formula: condChip })"
                  >
                    {{ condChip }}
                  </button>
                </div>
              </template>

              <!-- Track in chart -->
              <label class="mx-check-row">
                <input
                  type="checkbox"
                  :checked="
                    selectedNode.tracked ??
                    (selectedNode.kind === 'pool' || selectedNode.kind === 'register')
                  "
                  @change="
                    s.updateNode(selectedNode.id, {
                      tracked: ($event.target as HTMLInputElement).checked
                    })
                  "
                />
                <span>{{ t('mx.inspector.trackInChart') }}</span>
              </label>
            </div>
          </div>

          <!-- Note 专属内容编辑 -->
          <div v-else class="mx-insp-block">
            <label class="mx-field-label">{{ t('mx.inspector.noteText') }}</label>
            <textarea
              class="mx-textarea"
              rows="5"
              :value="selectedNode.text ?? ''"
              @input="
                s.updateNode(
                  selectedNode.id,
                  { text: ($event.target as HTMLTextAreaElement).value },
                  'noteText'
                )
              "
            />
            <div class="mx-two-col">
              <div>
                <label class="mx-field-label">W</label>
                <input
                  class="mx-input"
                  type="number"
                  :value="selectedNode.width ?? 180"
                  @input="
                    s.updateNode(selectedNode.id, {
                      width: Number(($event.target as HTMLInputElement).value) || 180
                    })
                  "
                />
              </div>
              <div>
                <label class="mx-field-label">H</label>
                <input
                  class="mx-input"
                  type="number"
                  :value="selectedNode.height ?? 90"
                  @input="
                    s.updateNode(selectedNode.id, {
                      height: Number(($event.target as HTMLInputElement).value) || 90
                    })
                  "
                />
              </div>
            </div>
          </div>

          <!-- ═════════════ 引用此节点的条件变量与公式列表 ═════════════ -->
          <div
            v-if="selectedNode.kind !== 'note' && selectedNodeConsumerItems.length > 0"
            class="mx-insp-section mx-cond-refs-section"
          >
            <button type="button" class="mx-sec-head" @click="condRefsOpen = !condRefsOpen">
              <span>
                {{ t('mx.inspector.usedInConditions') }} ({{ selectedNodeConsumerItems.length }})
              </span>
              <span class="mx-caret">{{ condRefsOpen ? '▾' : '▸' }}</span>
            </button>
            <div v-if="condRefsOpen" class="mx-sec-body">
              <div class="mx-cond-ref-hint">{{ t('mx.inspector.usedInConditionsHint') }}</div>
              <div class="mx-cond-ref-list">
                <button
                  v-for="item in selectedNodeConsumerItems"
                  :key="item.key"
                  type="button"
                  class="mx-cond-ref-card"
                  @click="item.onClick()"
                >
                  <div class="mx-cond-ref-top">
                    <span class="mx-cond-ref-badge">{{ item.badge }}</span>
                    <span class="mx-cond-ref-title">{{ item.title }}</span>
                    <span class="mx-cond-ref-tok">{{ item.token }}</span>
                  </div>
                  <div class="mx-cond-ref-formula mx-mono">{{ item.formula }}</div>
                </button>
              </div>
            </div>
          </div>

          <!-- ═════════════ 节点关联连线管理 (Connections) ═════════════ -->
          <div v-if="selectedNode.kind !== 'note'" class="mx-insp-section">
            <button type="button" class="mx-sec-head" @click="connOpen = !connOpen">
              <span
                >{{ t('mx.inspector.connections') }} ({{
                  nodeIncomingEdges.length + nodeOutgoingEdges.length
                }})</span
              >
              <span class="mx-caret">{{ connOpen ? '▾' : '▸' }}</span>
            </button>

            <div v-if="connOpen" class="mx-sec-body">
              <!-- 快速新增连线 -->
              <div class="mx-quick-conn-row">
                <select v-model="quickTargetEdgeKind" class="mx-select" style="width: 78px">
                  <option value="resource">──► Res</option>
                  <option value="state">╌╌► State</option>
                </select>
                <select v-model="quickTargetNodeId" class="mx-select" style="flex: 1">
                  <option value="">{{ t('mx.inspector.connectToPlaceholder') }}</option>
                  <option v-for="tn in otherConnectableNodes" :key="tn.id" :value="tn.id">
                    → {{ tn.label || tn.id }}
                  </option>
                </select>
                <button
                  type="button"
                  class="mx-mini-add-btn"
                  :disabled="!quickTargetNodeId"
                  @click="addQuickConnectionFromInspector"
                >
                  +
                </button>
              </div>

              <!-- 出边列表 -->
              <div v-if="nodeOutgoingEdges.length" class="mx-conn-list">
                <div class="mx-conn-sub">{{ t('mx.inspector.outgoingEdges') }}</div>
                <div v-for="oe in nodeOutgoingEdges" :key="oe.id" class="mx-conn-item">
                  <button
                    type="button"
                    class="mx-conn-badge"
                    :class="{ 'is-state': oe.kind === 'state' }"
                    @click="s.toggleEdgeKind(oe.id)"
                  >
                    {{ oe.kind === 'state' ? '╌►' : '──►' }}
                  </button>
                  <span
                    class="mx-conn-target"
                    @click="oe.targetEdgeId ? s.select([], [oe.targetEdgeId]) : s.select([oe.to])"
                  >
                    {{ oe.targetEdgeId ? `#${oe.targetEdgeId}` : edgeEndpointLabel(oe.to) }}
                  </span>
                  <input
                    type="text"
                    class="mx-input mx-mono mx-conn-rate"
                    :title="t('mx.formulaEditor.dblClickHint')"
                    :value="oe.formula"
                    @dblclick.stop="
                      s.openFormulaModal({ targetType: 'edge', edgeId: oe.id, field: 'formula' })
                    "
                    @input="
                      s.updateEdge(
                        oe.id,
                        { formula: ($event.target as HTMLInputElement).value },
                        'edgeF'
                      )
                    "
                  />
                  <button
                    type="button"
                    class="mx-conn-del"
                    @click="
                      (s.select([], [oe.id]), s.deleteSelection(), s.select([selectedNode.id]))
                    "
                  >
                    ×
                  </button>
                </div>
              </div>

              <!-- 入边列表 -->
              <div v-if="nodeIncomingEdges.length" class="mx-conn-list">
                <div class="mx-conn-sub">{{ t('mx.inspector.incomingEdges') }}</div>
                <div v-for="ie in nodeIncomingEdges" :key="ie.id" class="mx-conn-item">
                  <span class="mx-conn-target" @click="s.select([ie.from])">
                    {{ edgeEndpointLabel(ie.from) }}
                  </span>
                  <button
                    type="button"
                    class="mx-conn-badge"
                    :class="{ 'is-state': ie.kind === 'state' }"
                    @click="s.toggleEdgeKind(ie.id)"
                  >
                    {{ ie.kind === 'state' ? '╌►' : '──►' }}
                  </button>
                  <input
                    type="text"
                    class="mx-input mx-mono mx-conn-rate"
                    :title="t('mx.formulaEditor.dblClickHint')"
                    :value="ie.formula"
                    @dblclick.stop="
                      s.openFormulaModal({ targetType: 'edge', edgeId: ie.id, field: 'formula' })
                    "
                    @input="
                      s.updateEdge(
                        ie.id,
                        { formula: ($event.target as HTMLInputElement).value },
                        'edgeF'
                      )
                    "
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Style & Layer -->
          <div class="mx-insp-section">
            <button type="button" class="mx-sec-head" @click="styleOpen = !styleOpen">
              <span>{{ t('mx.inspector.appearance') }}</span>
              <span class="mx-caret">{{ styleOpen ? '▾' : '▸' }}</span>
            </button>
            <div v-if="styleOpen" class="mx-sec-body">
              <label class="mx-field-label">{{ t('mx.inspector.color') }}</label>
              <div class="mx-swatch-row">
                <button
                  v-for="c in swatches"
                  :key="c"
                  type="button"
                  class="mx-swatch"
                  :class="{ 'is-active': selectedNode.color === c }"
                  :style="{ background: c }"
                  @click="s.updateNode(selectedNode.id, { color: c })"
                />
                <input
                  type="color"
                  class="mx-color-native"
                  :value="selectedNode.color || '#3b82f6'"
                  @input="
                    s.updateNode(selectedNode.id, {
                      color: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </div>

              <label class="mx-field-label">{{ t('mx.inspector.layer') }}</label>
              <select
                class="mx-select"
                :value="selectedNode.layerId ?? ''"
                @change="
                  s.updateNode(selectedNode.id, {
                    layerId: ($event.target as HTMLSelectElement).value || undefined
                  })
                "
              >
                <option value="">{{ t('mx.inspector.layerNone') }}</option>
                <option v-for="ly in s.doc.value.layers" :key="ly.id" :value="ly.id">
                  {{ ly.name }}
                </option>
              </select>

              <button type="button" class="mx-danger-btn" @click="s.deleteSelection()">
                {{ t('mx.inspector.deleteElement') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Pool / Register 节点底部 Mark as influencer 开关栏 -->
        <footer
          v-if="selectedNode.kind === 'pool' || selectedNode.kind === 'register'"
          class="mx-influencer-footer"
          @click="toggleSelectedNodeInfluencer"
        >
          <span class="mx-influencer-label">{{ t('mx.inspector.markAsInfluencer') }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="Boolean(selectedNode.influencer)"
            class="mx-switch"
            :class="{ 'is-on': Boolean(selectedNode.influencer) }"
            @click.stop="toggleSelectedNodeInfluencer"
          >
            <span class="mx-switch-knob" />
          </button>
        </footer>
      </template>

      <!-- ═════════════ 选中单条连线 ═════════════ -->
      <template v-else-if="selectedEdge">
        <header class="mx-insp-head">
          <div class="mx-insp-id">
            <span class="mx-insp-hash">#{{ selectedEdge.id }}</span>
            <span class="mx-insp-slash">/</span>
            <span class="mx-insp-kind">
              {{
                selectedEdge.kind === 'state' ? t('mx.tool.state_edge') : t('mx.tool.resource_edge')
              }}
            </span>
          </div>
          <button
            type="button"
            class="mx-insp-collapse"
            :title="t('mx.inspector.collapse')"
            @click="s.inspectorOpen.value = false"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="4 4 8 8 4 12" />
              <polyline points="9 4 13 8 9 12" />
            </svg>
          </button>
        </header>

        <div class="mx-insp-body">
          <!-- 端点 + Label + Notes -->
          <div class="mx-insp-block">
            <div class="mx-edge-endpoints">
              <span>{{ edgeEndpointLabel(selectedEdge.from) }}</span>
              <span>→</span>
              <span>
                {{
                  selectedEdge.targetEdgeId
                    ? `Edge #${selectedEdge.targetEdgeId}`
                    : edgeEndpointLabel(selectedEdge.to)
                }}
              </span>
              <button
                v-if="!selectedEdge.targetEdgeId"
                type="button"
                class="mx-mini-reverse-btn"
                :title="t('mx.canvas.reverseEdge')"
                @click="s.reverseEdge(selectedEdge.id)"
              >
                ⇄
              </button>
            </div>

            <label class="mx-field-label">{{ t('mx.inspector.label') }}</label>
            <input
              class="mx-input"
              type="text"
              placeholder="var_name / label"
              :value="selectedEdge.label ?? ''"
              @input="
                s.updateEdge(
                  selectedEdge.id,
                  { label: ($event.target as HTMLInputElement).value || undefined },
                  'edgeLabel'
                )
              "
            />
            <textarea
              class="mx-textarea"
              rows="2"
              :placeholder="t('mx.inspector.notesPlaceholder')"
              :value="selectedEdge.notes ?? ''"
              @input="
                s.updateEdge(
                  selectedEdge.id,
                  { notes: ($event.target as HTMLTextAreaElement).value || undefined },
                  'edgeNotes'
                )
              "
            />
          </div>

          <!-- Functionality 折叠区（1:1 对齐 Machinations Connection Functionality 面板） -->
          <div class="mx-insp-section">
            <button type="button" class="mx-sec-head" @click="funcOpen = !funcOpen">
              <span>{{ t('mx.inspector.functionality') }}</span>
              <span class="mx-caret">{{ funcOpen ? '▾' : '▸' }}</span>
            </button>

            <div v-if="funcOpen" class="mx-sec-body">
              <label class="mx-field-label">{{ t('mx.inspector.edgeKind') }}</label>
              <div class="mx-seg-row">
                <button
                  v-for="ek in ['resource', 'state'] as MxEdgeKind[]"
                  :key="ek"
                  type="button"
                  class="mx-seg-btn"
                  :class="{ 'is-active': selectedEdge.kind === ek }"
                  @click="onEdgeKindSwitch(ek)"
                >
                  {{
                    ek === 'resource'
                      ? '──► ' + t('mx.tool.resource_edge')
                      : '╌╌► ' + t('mx.tool.state_edge')
                  }}
                </button>
              </div>

              <!-- Type 下拉（123 Number / % Chance / 🎲 Dice roll / fx Formula / All / Gate Condition / State 全类型） -->
              <div class="mx-field-head-row">
                <label class="mx-field-label">{{ t('mx.inspector.edgeFormulaType') }}</label>
                <span
                  v-if="selectedEdge.formula?.trim() && selectedEdgeFormulaValidation"
                  class="mx-formula-status"
                  :class="selectedEdgeFormulaValidation.valid ? 'is-ok' : 'is-err'"
                  :title="selectedEdgeFormulaValidation.error ?? ''"
                >
                  {{
                    selectedEdgeFormulaValidation.valid
                      ? '✓ OK'
                      : `⚠ ${selectedEdgeFormulaValidation.error}`
                  }}
                </span>
              </div>
              <select
                class="mx-select"
                :value="selectedEdgeFormulaType"
                @change="onEdgeFormulaTypeChange(($event.target as HTMLSelectElement).value)"
              >
                <template v-if="selectedEdge.kind === 'resource'">
                  <option value="number">{{ t('mx.inspector.ft_number') }}</option>
                  <option value="chance">{{ t('mx.inspector.ft_chance') }}</option>
                  <option value="dice">{{ t('mx.inspector.ft_dice') }}</option>
                  <option value="formula">{{ t('mx.inspector.ft_formula') }}</option>
                  <option value="all">{{ t('mx.inspector.ft_all') }}</option>
                  <option value="cond_gate">{{ t('mx.inspector.ft_cond_gate') }}</option>
                </template>
                <template v-else>
                  <option value="st_trigger">{{ t('mx.inspector.ft_st_trigger') }}</option>
                  <option value="st_rev_trigger">{{ t('mx.inspector.ft_st_rev_trigger') }}</option>
                  <option value="st_activator">{{ t('mx.inspector.ft_st_activator') }}</option>
                  <option value="st_range">{{ t('mx.inspector.ft_st_range') }}</option>
                  <option value="st_modifier">{{ t('mx.inspector.ft_st_modifier') }}</option>
                  <option value="st_fraction">{{ t('mx.inspector.ft_st_fraction') }}</option>
                  <option value="st_interval">{{ t('mx.inspector.ft_st_interval') }}</option>
                  <option value="st_overwrite">{{ t('mx.inspector.ft_st_overwrite') }}</option>
                  <option value="st_prob">{{ t('mx.inspector.ft_st_prob') }}</option>
                  <option value="st_formula">{{ t('mx.inspector.ft_st_formula') }}</option>
                </template>
              </select>

              <!-- 紧跟 Type 下方的数值 / 公式输入框 -->
              <MxFormulaEditor
                :model-value="selectedEdge.formula"
                :context-kind="selectedEdge.kind"
                :edge-id="selectedEdge.id"
                @update:model-value="
                  (val) => s.updateEdge(selectedEdge!.id, { formula: val }, 'edgeFormula')
                "
              />

              <div class="mx-chip-row">
                <button
                  v-for="ch in activeEdgeChips"
                  :key="ch"
                  type="button"
                  class="mx-chip"
                  @click="s.updateEdge(selectedEdge.id, { formula: ch })"
                >
                  {{ ch }}
                </button>
              </div>

              <!-- Resource 连接专属：Allow decimals、Interval、Transfer (flow | instant)、Limits、Shuffle Origin -->
              <template v-if="selectedEdge.kind === 'resource'">
                <label class="mx-check-row">
                  <input
                    type="checkbox"
                    :checked="selectedEdge.allowDecimals !== false"
                    @change="
                      s.updateEdge(selectedEdge.id, {
                        allowDecimals: ($event.target as HTMLInputElement).checked
                      })
                    "
                  />
                  <span>{{ t('mx.inspector.allowDecimals') }}</span>
                </label>

                <div class="mx-field-head-row">
                  <label class="mx-field-label">{{ t('mx.inspector.edgeInterval') }}</label>
                  <span
                    v-if="selectedEdgeIntervalValidation"
                    class="mx-formula-status"
                    :class="selectedEdgeIntervalValidation.valid ? 'is-ok' : 'is-err'"
                    :title="selectedEdgeIntervalValidation.error ?? ''"
                  >
                    {{
                      selectedEdgeIntervalValidation.valid
                        ? '✓ OK'
                        : `⚠ ${selectedEdgeIntervalValidation.error}`
                    }}
                  </span>
                </div>
                <MxFormulaEditor
                  :model-value="selectedEdge.interval ?? ''"
                  :placeholder="edgeInlineIntervalHint"
                  context-kind="expr"
                  :edge-id="selectedEdge.id"
                  target-field="interval"
                  compact
                  @update:model-value="onEdgeIntervalChange"
                />

                <label class="mx-field-label">{{ t('mx.inspector.transferMode') }}</label>
                <div class="mx-seg-row">
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{
                      'is-active': (selectedEdge.transferMode ?? 'flow') !== 'instant'
                    }"
                    @click="s.updateEdge(selectedEdge.id, { transferMode: 'flow' })"
                  >
                    {{ t('mx.inspector.transferFlow') }}
                  </button>
                  <button
                    type="button"
                    class="mx-seg-btn"
                    :class="{ 'is-active': selectedEdge.transferMode === 'instant' }"
                    @click="s.updateEdge(selectedEdge.id, { transferMode: 'instant' })"
                  >
                    {{ t('mx.inspector.transferInstant') }}
                  </button>
                </div>

                <div class="mx-two-col">
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.minLimit') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      placeholder="0"
                      :value="selectedEdge.minLimit ?? ''"
                      @input="
                        s.updateEdge(selectedEdge.id, {
                          minLimit:
                            ($event.target as HTMLInputElement).value === ''
                              ? undefined
                              : Number(($event.target as HTMLInputElement).value)
                        })
                      "
                    />
                  </div>
                  <div>
                    <label class="mx-field-label">{{ t('mx.inspector.maxLimit') }}</label>
                    <input
                      class="mx-input"
                      type="number"
                      placeholder="+∞"
                      :value="selectedEdge.maxLimit ?? ''"
                      @input="
                        s.updateEdge(selectedEdge.id, {
                          maxLimit:
                            ($event.target as HTMLInputElement).value === ''
                              ? undefined
                              : Number(($event.target as HTMLInputElement).value)
                        })
                      "
                    />
                  </div>
                </div>

                <label class="mx-check-row">
                  <input
                    type="checkbox"
                    :checked="Boolean(selectedEdge.shuffleOrigin)"
                    @change="
                      s.updateEdge(selectedEdge.id, {
                        shuffleOrigin: ($event.target as HTMLInputElement).checked || undefined
                      })
                    "
                  />
                  <span>{{ t('mx.inspector.shuffleOrigin') }}</span>
                </label>
              </template>

              <!-- Resource Filter 单一下拉框（None + 各定义资源颜色，支持 Resource 与 State 连接） -->
              <label class="mx-field-label">{{ t('mx.inspector.resourceFilter') }}</label>
              <div class="mx-res-select-wrap">
                <span
                  v-if="selectedEdge.resourceFilter && selectedEdge.resourceId"
                  class="mx-res-dot"
                  :style="{
                    background:
                      s.doc.value.resources.find((r) => r.id === selectedEdge?.resourceId)?.color ||
                      '#3b82f6'
                  }"
                />
                <select
                  class="mx-select"
                  :value="selectedEdge.resourceFilter ? (selectedEdge.resourceId ?? '') : ''"
                  @change="onEdgeResourceFilterSelect(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">{{ t('mx.inspector.resourceFilterNone') }}</option>
                  <option v-for="r in s.doc.value.resources" :key="r.id" :value="r.id">
                    {{ r.name }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <!-- Appearance 折叠区 -->
          <div class="mx-insp-section">
            <button type="button" class="mx-sec-head" @click="styleOpen = !styleOpen">
              <span>{{ t('mx.inspector.appearance') }}</span>
              <span class="mx-caret">{{ styleOpen ? '▾' : '▸' }}</span>
            </button>
            <div v-if="styleOpen" class="mx-sec-body">
              <label class="mx-field-label">
                {{ t('mx.inspector.edgeCurvature') }} ({{ selectedEdge.bend ?? 0 }})
              </label>
              <input
                type="range"
                min="-120"
                max="120"
                step="4"
                :value="selectedEdge.bend ?? 0"
                @input="
                  s.updateEdge(
                    selectedEdge.id,
                    { bend: Number(($event.target as HTMLInputElement).value) },
                    'bend'
                  )
                "
              />

              <label class="mx-field-label">{{ t('mx.inspector.color') }}</label>
              <div class="mx-swatch-row">
                <button
                  v-for="c in swatches"
                  :key="c"
                  type="button"
                  class="mx-swatch"
                  :class="{ 'is-active': selectedEdge.color === c }"
                  :style="{ background: c }"
                  @click="s.updateEdge(selectedEdge.id, { color: c })"
                />
              </div>

              <button type="button" class="mx-danger-btn" @click="s.deleteSelection()">
                {{ t('mx.inspector.deleteElement') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 底部固定栏：Mark as influencer 开关（对齐截图底部） -->
        <footer class="mx-influencer-footer" @click="toggleSelectedEdgeInfluencer">
          <span class="mx-influencer-label">{{ t('mx.inspector.markAsInfluencer') }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="Boolean(selectedEdge.influencer)"
            class="mx-switch"
            :class="{ 'is-on': Boolean(selectedEdge.influencer) }"
            @click.stop="toggleSelectedEdgeInfluencer"
          >
            <span class="mx-switch-knob" />
          </button>
        </footer>
      </template>

      <!-- ═════════════ 未选中或选中多个：全局属性 ═════════════ -->
      <template v-else>
        <header class="mx-insp-head">
          <div class="mx-insp-id">
            <span class="mx-insp-kind">{{ t('mx.inspector.diagramSettings') }}</span>
          </div>
          <button
            type="button"
            class="mx-insp-collapse"
            :title="t('mx.inspector.collapse')"
            @click="s.inspectorOpen.value = false"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="4 4 8 8 4 12" />
              <polyline points="9 4 13 8 9 12" />
            </svg>
          </button>
        </header>

        <div class="mx-insp-body">
          <div class="mx-insp-block">
            <label class="mx-field-label">{{ t('mx.inspector.diagramTitle') }}</label>
            <input
              class="mx-input"
              type="text"
              :value="s.doc.value.title"
              @input="
                s.mutate((d) => {
                  d.title = ($event.target as HTMLInputElement).value
                }, 'title')
              "
            />
            <textarea
              class="mx-textarea"
              rows="2"
              :placeholder="t('mx.inspector.notesPlaceholder')"
              :value="s.doc.value.description ?? ''"
              @input="
                s.mutate((d) => {
                  d.description = ($event.target as HTMLTextAreaElement).value
                }, 'desc')
              "
            />

            <div class="mx-two-col">
              <div>
                <label class="mx-field-label">{{ t('mx.inspector.steps') }}</label>
                <input
                  class="mx-input"
                  type="number"
                  min="1"
                  max="500"
                  :value="s.doc.value.settings.steps"
                  @change="
                    s.setSteps(Math.max(1, Number(($event.target as HTMLInputElement).value) || 20))
                  "
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </div>
              <div>
                <label class="mx-field-label">{{ t('mx.inspector.seed') }}</label>
                <input
                  class="mx-input"
                  type="number"
                  :value="s.doc.value.settings.seed"
                  @input="
                    s.mutate((d) => {
                      d.settings.seed = Number(($event.target as HTMLInputElement).value) || 42
                    }, 'seed')
                  "
                />
              </div>
            </div>

            <label class="mx-field-label">{{ t('mx.inspector.actionMode') }}</label>
            <div class="mx-seg-row">
              <button
                type="button"
                class="mx-seg-btn"
                :class="{
                  'is-active':
                    (s.doc.value.settings.actionMode ?? 'simultaneous') === 'simultaneous'
                }"
                @click="s.mutate((d) => (d.settings.actionMode = 'simultaneous'))"
              >
                {{ t('mx.inspector.simultaneous') }}
              </button>
              <button
                type="button"
                class="mx-seg-btn"
                :class="{ 'is-active': s.doc.value.settings.actionMode === 'turn_based' }"
                @click="s.mutate((d) => (d.settings.actionMode = 'turn_based'))"
              >
                {{ t('mx.inspector.turnBased') }}
              </button>
            </div>

            <label class="mx-field-label">🤖 {{ t('mx.inspector.botGlobalMode') }}</label>
            <div class="mx-seg-row">
              <button
                v-for="bm in ['off', 'greedy', 'smart'] as const"
                :key="bm"
                type="button"
                class="mx-seg-btn"
                :class="{
                  'is-active':
                    bm === 'off'
                      ? (s.doc.value.settings.botMode ?? 'off') === 'off' &&
                        !(s.doc.value.agents ?? []).some((a) => a.enabled)
                      : (s.doc.value.settings.botMode ?? 'off') === bm
                }"
                @click="s.setBotMode(bm)"
              >
                {{ t(`mx.inspector.botMode_${bm}`) }}
              </button>
            </div>

            <div class="mx-stat-pills">
              <div class="mx-stat-pill">
                <span class="mx-stat-num">{{ s.doc.value.nodes.length }}</span>
                <span class="mx-stat-lbl">{{ t('mx.inspector.nodesCount') }}</span>
              </div>
              <div class="mx-stat-pill">
                <span class="mx-stat-num">{{ s.doc.value.edges.length }}</span>
                <span class="mx-stat-lbl">{{ t('mx.inspector.edgesCount') }}</span>
              </div>
            </div>

            <div v-if="s.selection.nodes.length > 1" class="mx-field" style="margin-top: 12px">
              <label class="mx-field-label">{{ t('mx.inspector.assignToLayer') }}</label>
              <select
                class="mx-select"
                @change="
                  s.assignNodesToLayer(
                    s.selection.nodes,
                    ($event.target as HTMLSelectElement).value || undefined
                  )
                "
              >
                <option value="">{{ t('mx.inspector.chooseLayer') }}</option>
                <option v-for="ly in s.doc.value.layers" :key="ly.id" :value="ly.id">
                  {{ ly.name }}
                </option>
              </select>
            </div>

            <button
              v-if="s.selection.nodes.length > 1"
              type="button"
              class="mx-danger-btn"
              @click="s.deleteSelection()"
            >
              {{ t('mx.inspector.deleteSelected', { n: s.selection.nodes.length }) }}
            </button>
          </div>
        </div>
      </template>
    </template>
  </aside>
</template>

<style scoped>
.mx-inspector {
  width: 278px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  color: var(--text, #e8eaed);
  font-size: 12px;
  overflow: hidden;
  user-select: none;
}
.mx-inspector.is-collapsed {
  width: 36px;
  align-items: center;
  padding-top: 8px;
}
.mx-insp-expand {
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-muted, #9aa0a6);
  cursor: pointer;
}
.mx-insp-expand:hover {
  color: var(--text, #e8eaed);
  border-color: var(--accent, #3d8bfd);
  background: var(--bg-hover);
}
.mx-insp-expand svg,
.mx-insp-collapse svg {
  display: block;
  flex-shrink: 0;
}

.mx-insp-head {
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elevated);
}
.mx-insp-id {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-insp-hash {
  color: var(--text-muted, #9aa0a6);
  font-family: var(--mono, ui-monospace, monospace);
}
.mx-insp-slash {
  color: var(--border);
}
.mx-insp-kind {
  color: var(--text, #e8eaed);
}
.mx-insp-collapse {
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted, #9aa0a6);
  cursor: pointer;
  border-radius: 5px;
}
.mx-insp-collapse:hover {
  color: var(--text, #e8eaed);
  background: var(--bg-hover);
}

.mx-insp-body {
  flex: 1;
  overflow-y: auto;
}
.mx-insp-block {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}

.mx-insp-section {
  border-bottom: 1px solid var(--border);
}
.mx-sec-head {
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: var(--wash-04, rgba(255, 255, 255, 0.04));
  color: var(--text, #e8eaed);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.mx-sec-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mx-field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #9aa0a6);
  margin-top: 2px;
}
.mx-input,
.mx-select,
.mx-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 12px;
  color: var(--text, #e8eaed);
  background: var(--bg-input);
  outline: none;
}
.mx-input:focus,
.mx-select:focus,
.mx-textarea:focus {
  border-color: var(--accent, #3d8bfd);
}
.mx-mono {
  font-family: var(--mono, ui-monospace, monospace);
}

.mx-trigger-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.mx-trigger-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-muted, #9aa0a6);
  cursor: pointer;
  font-size: 10px;
}
.mx-trigger-tile:hover {
  border-color: var(--accent, #3d8bfd);
}
.mx-trigger-tile.is-active {
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  border-color: var(--accent, #3d8bfd);
  color: var(--text, #e8eaed);
  font-weight: 600;
}
.mx-trigger-icon {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.mx-seg-row {
  display: flex;
  gap: 4px;
}
.mx-seg-btn {
  flex: 1;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-elevated);
  color: var(--text-muted, #9aa0a6);
  font-size: 11px;
  cursor: pointer;
}
.mx-seg-btn.is-active {
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  border-color: var(--accent, #3d8bfd);
  color: var(--text, #e8eaed);
  font-weight: 600;
}

.mx-pull-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.mx-pull-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-elevated);
  color: var(--text-muted, #9aa0a6);
  font-size: 11px;
  cursor: pointer;
}
.mx-pull-btn.is-active {
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  border-color: var(--accent, #3d8bfd);
  color: var(--text, #e8eaed);
  font-weight: 600;
}
.mx-pull-code {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--wash-08, rgba(255, 255, 255, 0.08));
}

.mx-res-select-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mx-res-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mx-check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text, #e8eaed);
  cursor: pointer;
  margin-top: 2px;
}

.mx-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* Connections 区 */
.mx-quick-conn-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mx-mini-add-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--accent, #3d8bfd);
  border-radius: 5px;
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  color: var(--text, #e8eaed);
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}
.mx-mini-add-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.mx-conn-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mx-conn-sub {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted, #9aa0a6);
}
.mx-conn-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mx-conn-badge {
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  font-size: 10px;
  cursor: pointer;
}
.mx-conn-badge.is-state {
  color: #38bdf8;
}
.mx-conn-target {
  flex: 1;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  color: var(--accent, #3d8bfd);
}
.mx-conn-rate {
  width: 68px !important;
  padding: 3px 6px !important;
}
.mx-conn-del {
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-muted, #9aa0a6);
  cursor: pointer;
}

.mx-swatch-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.mx-swatch {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}
.mx-swatch.is-active {
  border-color: var(--text, #e8eaed);
  transform: scale(1.1);
}
.mx-color-native {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.mx-edge-endpoints {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-weight: 600;
  color: var(--text, #e8eaed);
}
.mx-mini-reverse-btn {
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text, #e8eaed);
  padding: 1px 6px;
  cursor: pointer;
}

.mx-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mx-chip {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  font-size: 11px;
  font-family: var(--mono, ui-monospace, monospace);
  cursor: pointer;
}
.mx-chip:hover {
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  border-color: var(--accent, #3d8bfd);
}

.mx-stat-pills {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}
.mx-stat-pill {
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.mx-stat-num {
  font-size: 16px;
  font-weight: 700;
  color: var(--text, #e8eaed);
}
.mx-stat-lbl {
  font-size: 10px;
  color: var(--text-muted, #9aa0a6);
}

.mx-danger-btn {
  margin-top: 6px;
  padding: 6px 10px;
  border: 1px solid rgba(227, 93, 106, 0.45);
  border-radius: 5px;
  background: rgba(227, 93, 106, 0.14);
  color: var(--danger, #e35d6a);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.mx-danger-btn:hover {
  background: rgba(227, 93, 106, 0.25);
}

.mx-field-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.mx-formula-status {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-formula-status.is-ok {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.14);
}
.mx-formula-status.is-err {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.14);
}

.mx-influencer-footer {
  flex-shrink: 0;
  height: 40px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}
.mx-influencer-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text, #e8eaed);
}
.mx-switch {
  position: relative;
  width: 34px;
  height: 19px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--wash-08, rgba(148, 163, 184, 0.25));
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease;
  flex-shrink: 0;
}
.mx-switch.is-on {
  background: var(--accent, #4f46e5);
  border-color: var(--accent, #4f46e5);
}
.mx-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
  transition: transform 0.18s ease;
}
.mx-switch.is-on .mx-switch-knob {
  transform: translateX(15px);
}

.mx-cond-refs-section {
  border-color: color-mix(in srgb, #f59e0b 45%, var(--border));
}
.mx-cond-ref-hint {
  font-size: 11px;
  color: var(--text-muted, #9aa0a6);
  margin-bottom: 4px;
}
.mx-cond-ref-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mx-cond-ref-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, #f59e0b 42%, var(--border));
  background: color-mix(in srgb, #f59e0b 10%, var(--bg-elevated));
  color: var(--text, #e8eaed);
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background 0.14s ease;
}
.mx-cond-ref-card:hover {
  border-color: #f59e0b;
  background: color-mix(in srgb, #f59e0b 18%, var(--bg-elevated));
}
.mx-cond-ref-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mx-cond-ref-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.22);
  color: #f59e0b;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--mono, ui-monospace, monospace);
}
.mx-cond-ref-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 600;
}
.mx-cond-ref-tok {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid rgba(245, 158, 11, 0.5);
  color: #f59e0b;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--mono, ui-monospace, monospace);
}
.mx-cond-ref-formula {
  font-size: 10.5px;
  color: var(--text-muted, #9aa0a6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
