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
  validateMxFormula,
  type MxEdgeKind,
  type MxNodeKind,
  type MxPullMode,
  type MxTrigger
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'

const { t } = useI18n()
const s = useMxStudioStore()

const funcOpen = ref(true)
const connOpen = ref(true)
const styleOpen = ref(true)
const quickTargetNodeId = ref('')
const quickTargetEdgeKind = ref<MxEdgeKind>('resource')

const selectedNode = computed(() => {
  if (s.selection.nodes.length !== 1) return null
  return s.doc.value.nodes.find((n) => n.id === s.selection.nodes[0]) ?? null
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
  '5',
  'D6',
  '2D6',
  '50%',
  'all',
  '1 every 2',
  'lookup(a, 10, 25, 60)',
  'diminish(a, 100)'
]
const stateChips = ['+1', '-1', '+2', '*', '!', '>0', '<=0', '>=5', '==0']
const registerFnChips = [
  'lookup(a, 10, 25, 60, 150)',
  'diminish(a, 100, 1)',
  'lerp(10, 100, a / 10)',
  'smoothstep(0, 10, a)',
  'clamp(a, 0, 100)'
]

const selectedNodeFormulaValidation = computed(() => {
  const n = selectedNode.value
  if (!n || (n.kind !== 'register' && n.kind !== 'end')) return null
  return validateMxFormula(n.formula, n.kind === 'end' ? 'end' : 'register')
})

const selectedEdgeFormulaValidation = computed(() => {
  const e = selectedEdge.value
  if (!e) return null
  return validateMxFormula(e.formula, e.kind)
})

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
  const res = s.doc.value.resources.find((r) => r.id === resId)
  s.updateNode(n.id, {
    resourceId: resId || undefined,
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
                  <input
                    class="mx-input mx-mono"
                    type="text"
                    placeholder="HP <= 40"
                    :value="selectedNode.botCondition ?? ''"
                    @input="
                      s.updateNode(
                        selectedNode.id,
                        { botCondition: ($event.target as HTMLInputElement).value },
                        'botCond'
                      )
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
              <template
                v-if="
                  selectedNode.kind === 'pool' ||
                  selectedNode.kind === 'converter' ||
                  selectedNode.kind === 'trader' ||
                  selectedNode.kind === 'gate' ||
                  selectedNode.kind === 'drain' ||
                  selectedNode.kind === 'source'
                "
              >
                <label class="mx-field-label">{{ t('mx.inspector.pullMode') }}</label>
                <div class="mx-pull-grid">
                  <button
                    v-for="pm in pullModes"
                    :key="pm.id"
                    type="button"
                    class="mx-pull-btn"
                    :class="{ 'is-active': selectedNode.pullMode === pm.id }"
                    @click="s.updateNode(selectedNode.id, { pullMode: pm.id })"
                  >
                    <span class="mx-pull-code">{{ pm.code }}</span>
                    <span>{{ t(pm.labelKey) }}</span>
                  </button>
                </div>
              </template>

              <!-- Resources 下拉 -->
              <label class="mx-field-label">{{ t('mx.inspector.resources') }}</label>
              <div class="mx-res-select-wrap">
                <span class="mx-res-dot" :style="{ background: selectedNode.color || '#3b82f6' }" />
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

              <!-- Ignore disabled inputs -->
              <label class="mx-check-row">
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
                <input
                  class="mx-input mx-mono"
                  type="text"
                  placeholder="lookup(a, 10, 25, 60) + 2"
                  :value="selectedNode.formula ?? ''"
                  @input="
                    s.updateNode(
                      selectedNode.id,
                      { formula: ($event.target as HTMLInputElement).value },
                      'regFormula'
                    )
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

              <!-- Gate 专属：Gate Mode -->
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
                      'is-active': (selectedNode.gateMode ?? 'random') !== 'deterministic'
                    }"
                    @click="s.updateNode(selectedNode.id, { gateMode: 'random' })"
                  >
                    🎲 {{ t('mx.inspector.gateDice') }}
                  </button>
                </div>
              </template>

              <!-- Delay / Queue 专属：Delay Steps -->
              <template v-if="selectedNode.kind === 'delay' || selectedNode.kind === 'queue'">
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
              </template>

              <!-- End 专属：Condition -->
              <template v-if="selectedNode.kind === 'end'">
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
                <input
                  class="mx-input mx-mono"
                  type="text"
                  placeholder="<=0"
                  :value="selectedNode.formula ?? ''"
                  @input="
                    s.updateNode(selectedNode.id, {
                      formula: ($event.target as HTMLInputElement).value
                    })
                  "
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
                  <span class="mx-conn-target" @click="s.select([oe.to])">
                    {{ oe.targetEdgeId ? `#${oe.targetEdgeId}` : edgeEndpointLabel(oe.to) }}
                  </span>
                  <input
                    type="text"
                    class="mx-input mx-mono mx-conn-rate"
                    :value="oe.formula"
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
                    :value="ie.formula"
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

            <label class="mx-field-label">{{ t('mx.inspector.edgeKind') }}</label>
            <div class="mx-seg-row">
              <button
                v-for="ek in ['resource', 'state'] as MxEdgeKind[]"
                :key="ek"
                type="button"
                class="mx-seg-btn"
                :class="{ 'is-active': selectedEdge.kind === ek }"
                @click="s.updateEdge(selectedEdge.id, { kind: ek })"
              >
                {{
                  ek === 'resource'
                    ? '──► ' + t('mx.tool.resource_edge')
                    : '╌╌► ' + t('mx.tool.state_edge')
                }}
              </button>
            </div>

            <div class="mx-field-head-row">
              <label class="mx-field-label">{{ t('mx.inspector.formula') }}</label>
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
            <input
              class="mx-input mx-mono"
              type="text"
              :value="selectedEdge.formula"
              @input="
                s.updateEdge(
                  selectedEdge.id,
                  { formula: ($event.target as HTMLInputElement).value },
                  'edgeFormula'
                )
              "
            />

            <div class="mx-chip-row">
              <button
                v-for="ch in selectedEdge.kind === 'state' ? stateChips : resourceChips"
                :key="ch"
                type="button"
                class="mx-chip"
                @click="s.updateEdge(selectedEdge.id, { formula: ch })"
              >
                {{ ch }}
              </button>
            </div>

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
                :class="{ 'is-active': (s.doc.value.settings.botMode ?? 'off') === bm }"
                @click="
                  () => {
                    s.mutate((d) => {
                      d.settings.botMode = bm
                    })
                    s.playAgain()
                  }
                "
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
</style>
