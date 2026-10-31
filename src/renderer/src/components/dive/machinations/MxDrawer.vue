<script setup lang="ts">
/**
 * Machinations 左侧滑出抽屉（对应左导航栏 8 个入口）：
 *  - Agent：自然语言生成/扩展经济系统图
 *  - Templates：10 套经典游戏经济模板一键加载
 *  - Resources：多资源类型（名称 + 颜色）管理
 *  - Params (x)：全局变量表与 Scenarios 多套数值方案对比
 *  - Layers：图层显隐与锁定管理
 *  - Clips：选中子图保存为复用片段 & 一键插入画布
 *  - History：版本快照保存与回滚
 *  - Docs：Machinations 节点与公式语法速查手册
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createMxFromTemplate,
  MX_TEMPLATES,
  mxNewId,
  mxNodeColor,
  type MxAgent,
  type MxAgentGoalAsset,
  type MxAgentImportance,
  type MxAgentPersonality,
  type MxAgentUtilityCurve,
  type MxTemplateId
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'

const emit = defineEmits<{
  (e: 'fitView'): void
}>()

const { t, locale } = useI18n()
const s = useMxStudioStore()

const clipName = ref('')
const snapName = ref('')
const agentSearch = ref('')
const agentAiPrompt = ref('')
const wizardAgentId = ref('')
const wizardStep = ref<1 | 2 | 3>(2)
const collapsedGoalIds = ref<Record<string, boolean>>({})

const importanceStops: MxAgentImportance[] = ['min', 'low', 'med', 'high', 'max']
const utilityCurveOptions: MxAgentUtilityCurve[] = ['linear', 'diminishing', 'urgency', 'step']
const personalityOptions: MxAgentPersonality[] = [
  'rational',
  'aggressive',
  'hoarder',
  'balanced',
  'chaotic'
]

const filteredAgents = computed<MxAgent[]>(() => {
  const list = s.doc.value.agents ?? []
  const q = agentSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.personality.toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q)
  )
})

const editingAgent = computed<MxAgent | null>(
  () => (s.doc.value.agents ?? []).find((a) => a.id === wizardAgentId.value) ?? null
)

const goalCandidateNodes = computed(() =>
  s.doc.value.nodes.filter((n) => n.kind === 'pool' || n.kind === 'register')
)

const interactiveNodes = computed(() =>
  s.doc.value.nodes.filter((n) => n.trigger === 'interactive')
)

const convertibleActionNodes = computed(() =>
  s.doc.value.nodes.filter(
    (n) =>
      n.trigger !== 'interactive' &&
      (n.kind === 'source' || n.kind === 'converter' || n.kind === 'trader' || n.kind === 'pool')
  )
)

function createNewAgent(withAi: boolean): void {
  const promptText = agentAiPrompt.value.trim()
  const created = withAi ? s.addAgentWithAi(promptText || undefined) : s.addAgent()
  if (withAi) agentAiPrompt.value = ''
  wizardAgentId.value = created.id
  wizardStep.value = withAi ? 2 : 1
}

function goalCurrentValue(g: MxAgentGoalAsset): number {
  const raw = s.displayValues.value?.[g.nodeId] ?? 0
  return Math.round(raw * 10) / 10
}

function goalTargetNumber(g: MxAgentGoalAsset): number {
  const n = Number(g.targetFormula)
  return Number.isFinite(n) ? n : 100
}

function goalProgressPct(g: MxAgentGoalAsset): number {
  const cur = goalCurrentValue(g)
  const target = goalTargetNumber(g)
  if (g.trajectory === 'downwards') {
    if (cur <= target) return 100
    const startVal =
      s.doc.value.nodes.find((nd) => nd.id === g.nodeId)?.initial || Math.max(target + 100, cur)
    if (startVal <= target) return 100
    return Math.max(0, Math.min(100, Math.round(((startVal - cur) / (startVal - target)) * 100)))
  }
  if (target <= 0) return cur >= target ? 100 : 0
  return Math.max(0, Math.min(100, Math.round((cur / target) * 100)))
}

function openAgentWizard(id: string, step: 1 | 2 | 3 = 2): void {
  wizardAgentId.value = id
  wizardStep.value = step
}

function closeAgentWizard(): void {
  wizardAgentId.value = ''
}

function addGoalAssetToCurrent(): void {
  const ag = editingAgent.value
  if (!ag) return
  const defaultNode = goalCandidateNodes.value[0]
  const newGoal: MxAgentGoalAsset = {
    id: mxNewId('goal'),
    nodeId: defaultNode?.id ?? '',
    targetFormula: String(
      defaultNode?.capacity && defaultNode.capacity > 0 ? defaultNode.capacity : 100
    ),
    importance: 'med',
    continuePastTarget: false,
    trajectory: 'upwards'
  }
  s.updateAgent(ag.id, { goals: [...ag.goals, newGoal] })
}

function updateGoalAsset(goalId: string, patch: Partial<MxAgentGoalAsset>): void {
  const ag = editingAgent.value
  if (!ag) return
  const nextGoals = ag.goals.map((g) => (g.id === goalId ? { ...g, ...patch } : g))
  s.updateAgent(ag.id, { goals: nextGoals })
}

function removeGoalAsset(goalId: string): void {
  const ag = editingAgent.value
  if (!ag) return
  s.updateAgent(ag.id, { goals: ag.goals.filter((g) => g.id !== goalId) })
}

function importanceIndex(imp: MxAgentImportance): number {
  const idx = importanceStops.indexOf(imp)
  return idx >= 0 ? idx : 2
}

function onImportanceSliderInput(goalId: string, e: Event): void {
  const idx = Math.max(0, Math.min(4, Number((e.target as HTMLInputElement).value)))
  updateGoalAsset(goalId, { importance: importanceStops[idx] ?? 'med' })
}

function toggleControlledNode(nodeId: string): void {
  const ag = editingAgent.value
  if (!ag) return
  const set = new Set(ag.controlledNodeIds)
  if (set.has(nodeId)) set.delete(nodeId)
  else set.add(nodeId)
  s.updateAgent(ag.id, { controlledNodeIds: [...set] })
}

function convertNodeToInteractiveAndBind(nodeId: string): void {
  const ag = editingAgent.value
  if (!ag) return
  s.updateNode(nodeId, { trigger: 'interactive' })
  const nextIds = Array.from(new Set([...ag.controlledNodeIds, nodeId]))
  s.updateAgent(ag.id, { controlledNodeIds: nextIds })
}

function nodeDotColor(nodeId: string): string {
  const n = s.doc.value.nodes.find((x) => x.id === nodeId)
  if (!n) return '#3b82f6'
  return mxNodeColor(s.doc.value, n)
}

function isZh(): boolean {
  return String(locale.value).startsWith('zh')
}

function applyTemplate(id: MxTemplateId): void {
  const doc = createMxFromTemplate(id)
  s.replaceDoc(doc)
  s.playAgain()
  setTimeout(() => emit('fitView'), 30)
}

function addResource(): void {
  const colors = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777']
  const color = colors[s.doc.value.resources.length % colors.length]!
  s.mutate((d) => {
    d.resources.push({
      id: mxNewId('res'),
      name: `Resource ${d.resources.length + 1}`,
      color
    })
  })
}

function removeResource(id: string): void {
  if (s.doc.value.resources.length <= 1) return
  s.mutate((d) => {
    d.resources = d.resources.filter((r) => r.id !== id)
  })
}

function addParam(): void {
  s.mutate((d) => {
    const idx = d.params.length + 1
    d.params.push({
      id: mxNewId('p'),
      name: `x${idx}`,
      value: 1
    })
  })
}

function removeParam(id: string): void {
  s.mutate((d) => {
    d.params = d.params.filter((p) => p.id !== id)
  })
}

function addScenario(): void {
  s.addScenario()
}

function addLayer(): void {
  s.mutate((d) => {
    d.layers.push({
      id: mxNewId('ly'),
      name: `Layer ${d.layers.length + 1}`,
      visible: true,
      locked: false
    })
  })
}

function saveSelectionAsClip(): void {
  const set = new Set(s.selection.nodes)
  if (!set.size) return
  const nodes = JSON.parse(JSON.stringify(s.doc.value.nodes.filter((n) => set.has(n.id))))
  const edges = JSON.parse(
    JSON.stringify(s.doc.value.edges.filter((e) => set.has(e.from) && set.has(e.to)))
  )
  const name = clipName.value.trim() || `Clip ${s.doc.value.clips.length + 1}`
  s.mutate((d) => {
    d.clips.push({ id: mxNewId('clip'), name, nodes, edges })
  })
  clipName.value = ''
}

function insertClip(id: string): void {
  const clip = s.doc.value.clips.find((c) => c.id === id)
  if (!clip) return
  s.pasteNodes({ nodes: clip.nodes, edges: clip.edges }, 48)
}

function removeClip(id: string): void {
  s.mutate((d) => {
    d.clips = d.clips.filter((c) => c.id !== id)
  })
}

function handleSaveSnapshot(): void {
  const name = snapName.value.trim() || `v${s.doc.value.history.length + 1}`
  s.saveSnapshot(name)
  snapName.value = ''
}
</script>

<template>
  <aside v-if="s.drawer.value" class="mx-drawer">
    <header class="mx-drawer-head">
      <span class="mx-drawer-title">{{ t(`mx.nav.${s.drawer.value}`) }}</span>
      <button type="button" class="mx-drawer-close" @click="s.drawer.value = ''">×</button>
    </header>

    <div class="mx-drawer-body">
      <!-- ═════════════ 0. ARTIFICIAL AGENTS (1:1 复刻截图 Agents 面板) ═════════════ -->
      <template v-if="s.drawer.value === 'agents'">
        <div class="mx-ag-search-box">
          <input
            v-model="agentSearch"
            type="text"
            class="mx-input"
            :placeholder="t('mx.agents.searchPlaceholder')"
          />
        </div>

        <div class="mx-ag-ai-prompt-box">
          <input
            v-model="agentAiPrompt"
            type="text"
            class="mx-input mx-ag-ai-prompt-input"
            :placeholder="t('mx.agents.aiPromptPlaceholder')"
            @keydown.enter="createNewAgent(true)"
          />
          <button type="button" class="mx-ag-btn-ai" @click="createNewAgent(true)">
            {{ t('mx.agents.newWithAi') }}
          </button>
        </div>

        <button type="button" class="mx-ag-btn-outline" @click="createNewAgent(false)">
          {{ t('mx.agents.newAgent') }}
        </button>

        <button
          type="button"
          class="mx-ag-btn-arena"
          :title="t('mx.agents.arenaHint')"
          @click="s.runAllAgentsArena()"
        >
          ⚔ {{ t('mx.agents.runArena') }}
        </button>

        <!-- 空状态（复刻截图中央机器人图标与文案） -->
        <div v-if="!filteredAgents.length" class="mx-ag-empty">
          <div class="mx-ag-empty-circle">🤖</div>
          <div class="mx-ag-empty-title">{{ t('mx.agents.emptyTitle') }}</div>
          <div class="mx-ag-empty-desc">{{ t('mx.agents.emptyDesc') }}</div>
        </div>

        <!-- 已创建智能体卡片列表 -->
        <div v-else class="mx-ag-list">
          <div
            v-for="ag in filteredAgents"
            :key="ag.id"
            class="mx-ag-card"
            :class="{ 'is-disabled': !ag.enabled }"
          >
            <div class="mx-ag-card-top">
              <span class="mx-ag-dot" :style="{ background: ag.color || '#6366f1' }" />
              <span class="mx-ag-name" @click="openAgentWizard(ag.id, 2)">{{ ag.name }}</span>
              <span class="mx-ag-badge">{{ ag.personality }}</span>
              <input
                type="checkbox"
                :checked="ag.enabled"
                @change="
                  s.updateAgent(ag.id, {
                    enabled: ($event.target as HTMLInputElement).checked
                  })
                "
              />
            </div>

            <div class="mx-ag-card-meta">
              {{
                t('mx.agents.assetsCount', {
                  g: ag.goals.length,
                  c: ag.controlledNodeIds.length || interactiveNodes.length
                })
              }}
              · H={{ ag.lookaheadHorizon ?? 2 }}
            </div>

            <div v-if="ag.goals.length" class="mx-ag-goal-progress-list">
              <div
                v-for="g in ag.goals"
                :key="g.id"
                class="mx-ag-goal-prog-item"
                @click="openAgentWizard(ag.id, 2)"
              >
                <div class="mx-ag-goal-prog-top">
                  <span class="mx-ag-goal-prog-name">
                    <span class="mx-ag-dot-sm" :style="{ background: nodeDotColor(g.nodeId) }" />
                    {{ s.doc.value.nodes.find((n) => n.id === g.nodeId)?.label || g.nodeId }}
                    {{ g.trajectory === 'downwards' ? '↓' : '↑' }}
                  </span>
                  <span class="mx-ag-goal-prog-val mx-mono">
                    {{ goalCurrentValue(g) }} / {{ g.targetFormula }} ({{ goalProgressPct(g) }}%)
                  </span>
                </div>
                <div class="mx-ag-goal-prog-bar">
                  <div
                    class="mx-ag-goal-prog-fill"
                    :style="{
                      width: `${goalProgressPct(g)}%`,
                      background: nodeDotColor(g.nodeId)
                    }"
                  />
                </div>
              </div>
            </div>

            <div class="mx-ag-card-actions">
              <button type="button" class="mx-mini-btn" @click="openAgentWizard(ag.id, 2)">
                ⚙ {{ t('mx.agents.editBtn') }}
              </button>
              <button type="button" class="mx-mini-btn" @click="s.duplicateAgent(ag.id)">⧉</button>
              <button type="button" class="mx-row-del" @click="s.deleteAgent(ag.id)">×</button>
            </div>
          </div>
        </div>
      </template>

      <!-- ═════════════ 1. TEMPLATES ═════════════ -->
      <template v-else-if="s.drawer.value === 'templates'">
        <p class="mx-hint">{{ t('mx.drawer.templatesHint') }}</p>
        <div class="mx-tpl-list">
          <div
            v-for="tpl in MX_TEMPLATES"
            :key="tpl.id"
            class="mx-tpl-card"
            @click="applyTemplate(tpl.id)"
          >
            <div class="mx-tpl-top">
              <span class="mx-tpl-name">{{ isZh() ? tpl.nameZh : tpl.nameEn }}</span>
              <span class="mx-tpl-tag">{{ tpl.category }}</span>
            </div>
            <div class="mx-tpl-desc">{{ isZh() ? tpl.descZh : tpl.descEn }}</div>
          </div>
        </div>
      </template>

      <!-- ═════════════ 3. RESOURCES ═════════════ -->
      <template v-else-if="s.drawer.value === 'resources'">
        <div class="mx-list-hdr">
          <span>{{ t('mx.drawer.resourcesHint') }}</span>
          <button type="button" class="mx-mini-btn" @click="addResource">
            + {{ t('mx.drawer.add') }}
          </button>
        </div>
        <div class="mx-item-list">
          <div v-for="r in s.doc.value.resources" :key="r.id" class="mx-item-row">
            <input
              type="color"
              class="mx-color-pick"
              :value="r.color"
              @input="
                s.mutate((d) => {
                  const target = d.resources.find((x) => x.id === r.id)
                  if (target) target.color = ($event.target as HTMLInputElement).value
                })
              "
            />
            <input
              type="text"
              class="mx-input"
              :value="r.name"
              @input="
                s.mutate((d) => {
                  const target = d.resources.find((x) => x.id === r.id)
                  if (target) target.name = ($event.target as HTMLInputElement).value
                }, 'resName')
              "
            />
            <button type="button" class="mx-row-del" @click="removeResource(r.id)">×</button>
          </div>
        </div>
      </template>

      <!-- ═════════════ 4. PARAMS & SCENARIOS ═════════════ -->
      <template v-else-if="s.drawer.value === 'params'">
        <div class="mx-list-hdr">
          <span>{{ t('mx.drawer.paramsHint') }}</span>
          <button type="button" class="mx-mini-btn" @click="addParam">+ x</button>
        </div>
        <div class="mx-item-list">
          <div v-for="p in s.doc.value.params" :key="p.id" class="mx-item-row">
            <input
              type="text"
              class="mx-input mx-mono"
              style="width: 72px"
              :value="p.name"
              @input="
                s.mutate((d) => {
                  const target = d.params.find((x) => x.id === p.id)
                  if (target) target.name = ($event.target as HTMLInputElement).value
                }, 'pKey')
              "
            />
            <span>=</span>
            <input
              type="number"
              class="mx-input mx-mono"
              :value="p.value"
              @input="
                s.mutate((d) => {
                  const target = d.params.find((x) => x.id === p.id)
                  if (target) target.value = Number(($event.target as HTMLInputElement).value) || 0
                }, 'pVal')
              "
            />
            <button type="button" class="mx-row-del" @click="removeParam(p.id)">×</button>
          </div>
        </div>

        <div class="mx-list-hdr" style="margin-top: 12px">
          <span>Scenarios</span>
          <div style="display: flex; gap: 4px">
            <button type="button" class="mx-mini-btn" @click="s.runAllScenariosCompare()">
              ⇄ {{ t('mx.results.compare') }}
            </button>
            <button type="button" class="mx-mini-btn" @click="addScenario">+ Scenario</button>
          </div>
        </div>
        <div class="mx-item-list">
          <div
            class="mx-scenario-card"
            :class="{ 'is-active': !s.doc.value.activeScenarioId }"
            @click="s.selectScenario(undefined)"
          >
            <div class="mx-sc-top">
              <strong>Baseline</strong>
            </div>
          </div>
          <div
            v-for="sc in s.doc.value.scenarios"
            :key="sc.id"
            class="mx-scenario-card"
            :class="{ 'is-active': s.doc.value.activeScenarioId === sc.id }"
            @click="s.selectScenario(sc.id)"
          >
            <div class="mx-sc-top" style="display: flex; gap: 4px; align-items: center">
              <input
                type="text"
                class="mx-input"
                :value="sc.name"
                @click.stop
                @input="
                  s.mutate((d) => {
                    const target = d.scenarios.find((x) => x.id === sc.id)
                    if (target) target.name = ($event.target as HTMLInputElement).value
                  }, 'scName')
                "
              />
              <button type="button" class="mx-row-del" @click.stop="s.removeScenario(sc.id)">
                ×
              </button>
            </div>
            <div v-for="p in s.doc.value.params" :key="p.id" class="mx-sc-param" @click.stop>
              <span class="mx-mono">{{ p.name }}</span>
              <input
                type="number"
                step="0.1"
                class="mx-input mx-mono"
                :value="sc.params[p.name] ?? p.value"
                @input="
                  (ev) => {
                    s.mutate((d) => {
                      const target = d.scenarios.find((x) => x.id === sc.id)
                      if (target)
                        target.params[p.name] = Number((ev.target as HTMLInputElement).value) || 0
                    }, 'scOv')
                    s.runAllScenariosCompare()
                  }
                "
              />
            </div>
          </div>
        </div>
      </template>

      <!-- ═════════════ 5. LAYERS ═════════════ -->
      <template v-else-if="s.drawer.value === 'layers'">
        <div class="mx-list-hdr">
          <span>{{ t('mx.drawer.layersHint') }}</span>
          <button type="button" class="mx-mini-btn" @click="addLayer">
            + {{ t('mx.drawer.add') }}
          </button>
        </div>
        <div class="mx-item-list">
          <div v-for="ly in s.doc.value.layers" :key="ly.id" class="mx-item-row">
            <button
              type="button"
              class="mx-icon-toggle"
              :class="{ 'is-off': !ly.visible }"
              @click="
                s.mutate((d) => {
                  const target = d.layers.find((x) => x.id === ly.id)
                  if (target) target.visible = !target.visible
                })
              "
            >
              👁
            </button>
            <button
              type="button"
              class="mx-icon-toggle"
              :class="{ 'is-on': ly.locked }"
              @click="
                s.mutate((d) => {
                  const target = d.layers.find((x) => x.id === ly.id)
                  if (target) target.locked = !target.locked
                })
              "
            >
              🔒
            </button>
            <input
              type="text"
              class="mx-input"
              :value="ly.name"
              @input="
                s.mutate((d) => {
                  const target = d.layers.find((x) => x.id === ly.id)
                  if (target) target.name = ($event.target as HTMLInputElement).value
                }, 'lyName')
              "
            />
          </div>
        </div>
      </template>

      <!-- ═════════════ 6. CLIPS ═════════════ -->
      <template v-else-if="s.drawer.value === 'clips'">
        <p class="mx-hint">{{ t('mx.drawer.clipsHint') }}</p>
        <div class="mx-item-row">
          <input
            v-model="clipName"
            type="text"
            class="mx-input"
            :placeholder="t('mx.drawer.clipNamePlaceholder')"
          />
          <button
            type="button"
            class="mx-mini-btn"
            :disabled="!s.selection.nodes.length"
            @click="saveSelectionAsClip"
          >
            {{ t('mx.drawer.saveClip') }}
          </button>
        </div>
        <div class="mx-item-list" style="margin-top: 8px">
          <div v-for="c in s.doc.value.clips" :key="c.id" class="mx-tpl-card">
            <div class="mx-tpl-top">
              <span class="mx-tpl-name">{{ c.name }}</span>
              <button type="button" class="mx-row-del" @click="removeClip(c.id)">×</button>
            </div>
            <div class="mx-tpl-desc">{{ c.nodes.length }} nodes · {{ c.edges.length }} edges</div>
            <button
              type="button"
              class="mx-mini-btn"
              style="margin-top: 4px"
              @click="insertClip(c.id)"
            >
              + {{ t('mx.drawer.insertClip') }}
            </button>
          </div>
        </div>
      </template>

      <!-- ═════════════ 7. HISTORY ═════════════ -->
      <template v-else-if="s.drawer.value === 'history'">
        <div class="mx-item-row">
          <input
            v-model="snapName"
            type="text"
            class="mx-input"
            :placeholder="t('mx.drawer.snapshotPlaceholder')"
          />
          <button type="button" class="mx-mini-btn" @click="handleSaveSnapshot">
            {{ t('mx.drawer.saveSnapshot') }}
          </button>
        </div>
        <div class="mx-item-list" style="margin-top: 8px">
          <div v-for="h in [...s.doc.value.history].reverse()" :key="h.id" class="mx-tpl-card">
            <div class="mx-tpl-top">
              <span class="mx-tpl-name">{{ h.name }}</span>
              <span class="mx-tpl-tag">{{ h.createdAt.slice(11, 19) }}</span>
            </div>
            <button
              type="button"
              class="mx-mini-btn"
              style="margin-top: 4px"
              @click="s.restoreSnapshot(h.id)"
            >
              ↺ {{ t('mx.drawer.restore') }}
            </button>
          </div>
        </div>
      </template>

      <!-- ═════════════ 8. DOCS ═════════════ -->
      <template v-else-if="s.drawer.value === 'docs'">
        <div class="mx-docs">
          <h4>{{ t('mx.docs.nodesTitle') }}</h4>
          <ul>
            <li><b>△ Source</b> — {{ t('mx.docs.source') }}</li>
            <li><b>○ Pool</b> — {{ t('mx.docs.pool') }}</li>
            <li><b>▽ Drain</b> — {{ t('mx.docs.drain') }}</li>
            <li><b>▷| Converter</b> — {{ t('mx.docs.converter') }}</li>
            <li><b>◇ Gate</b> — {{ t('mx.docs.gate') }}</li>
            <li><b>⧉ Trader</b> — {{ t('mx.docs.trader') }}</li>
            <li><b>[x] Register</b> — {{ t('mx.docs.register') }}</li>
            <li><b>⏱ Delay / ⊜ Queue</b> — {{ t('mx.docs.delay') }}</li>
            <li><b>■ End</b> — {{ t('mx.docs.end') }}</li>
          </ul>
          <h4>{{ t('mx.docs.formulasTitle') }}</h4>
          <ul>
            <li><code>1</code>, <code>5</code> — {{ t('mx.docs.fixed') }}</li>
            <li><code>D6</code>, <code>2D6+1</code> — {{ t('mx.docs.dice') }}</li>
            <li><code>50%</code>, <code>0.25</code> — {{ t('mx.docs.prob') }}</li>
            <li><code>all</code> — {{ t('mx.docs.all') }}</li>
            <li><code>1 every 3</code> — {{ t('mx.docs.interval') }}</li>
            <li><code>+1</code>, <code>-2</code> — {{ t('mx.docs.modifier') }}</li>
            <li><code>&gt;0</code>, <code>&lt;=0</code> — {{ t('mx.docs.activator') }}</li>
            <li><code>*</code>, <code>!</code> — {{ t('mx.docs.triggerStar') }}</li>
          </ul>
        </div>
      </template>
    </div>

    <!-- ═════════════ 3-Step Artificial Agent 配置向导弹窗（1:1 复刻截图 Personality -> Goals -> Control） ═════════════ -->
    <Teleport to="body">
      <div v-if="editingAgent" class="mx-ag-modal-backdrop" @pointerdown.self="closeAgentWizard">
        <div class="mx-ag-modal" @pointerdown.stop>
          <!-- 顶部三步进度条（1 Personality — 2 Goals — 3 Control） -->
          <header class="mx-ag-stepper-hdr">
            <div class="mx-ag-stepper">
              <button
                type="button"
                class="mx-ag-step-item"
                :class="{
                  'is-active': wizardStep === 1,
                  'is-done': wizardStep > 1
                }"
                @click="wizardStep = 1"
              >
                <span class="mx-ag-step-circle">{{ wizardStep > 1 ? '✓' : '1' }}</span>
                <span class="mx-ag-step-lbl">{{ t('mx.agents.step1Title') }}</span>
              </button>

              <span class="mx-ag-step-line" :class="{ 'is-filled': wizardStep >= 2 }" />

              <button
                type="button"
                class="mx-ag-step-item"
                :class="{
                  'is-active': wizardStep === 2,
                  'is-done': wizardStep > 2
                }"
                @click="wizardStep = 2"
              >
                <span class="mx-ag-step-circle">{{ wizardStep > 2 ? '✓' : '📊' }}</span>
                <span class="mx-ag-step-lbl">{{ t('mx.agents.step2Title') }}</span>
              </button>

              <span class="mx-ag-step-line" :class="{ 'is-filled': wizardStep >= 3 }" />

              <button
                type="button"
                class="mx-ag-step-item"
                :class="{ 'is-active': wizardStep === 3 }"
                @click="wizardStep = 3"
              >
                <span class="mx-ag-step-circle">3</span>
                <span class="mx-ag-step-lbl">{{ t('mx.agents.step3Title') }}</span>
              </button>
            </div>

            <button type="button" class="mx-ag-modal-close" @click="closeAgentWizard">×</button>
          </header>

          <!-- ─── STEP 1: PERSONALITY ─── -->
          <div v-if="wizardStep === 1" class="mx-ag-modal-body">
            <div class="mx-ag-form-row">
              <div class="mx-ag-field" style="flex: 1">
                <label>{{ t('mx.agents.nameLabel') }}</label>
                <input
                  type="text"
                  class="mx-input"
                  :value="editingAgent.name"
                  @input="
                    s.updateAgent(editingAgent.id, {
                      name: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </div>
              <div class="mx-ag-field" style="width: 90px">
                <label>{{ t('mx.agents.colorLabel') }}</label>
                <input
                  type="color"
                  class="mx-ag-color-input"
                  :value="editingAgent.color || '#6366f1'"
                  @input="
                    s.updateAgent(editingAgent.id, {
                      color: ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </div>
              <div class="mx-ag-field" style="width: 150px">
                <label>{{ t('mx.agents.actionsPerStepLabel') }}</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  class="mx-input mx-mono"
                  :value="editingAgent.actionsPerStep ?? 1"
                  @input="
                    s.updateAgent(editingAgent.id, {
                      actionsPerStep: Math.max(
                        1,
                        Math.min(5, Number(($event.target as HTMLInputElement).value) || 1)
                      )
                    })
                  "
                />
              </div>
            </div>

            <div class="mx-ag-section-lbl">{{ t('mx.agents.personalityLabel') }}</div>
            <div class="mx-ag-persona-grid">
              <button
                v-for="p in personalityOptions"
                :key="p"
                type="button"
                class="mx-ag-persona-card"
                :class="{ 'is-selected': editingAgent.personality === p }"
                @click="s.updateAgent(editingAgent.id, { personality: p })"
              >
                <div class="mx-ag-persona-title">{{ t(`mx.agents.p_${p}`) }}</div>
                <div class="mx-ag-persona-desc">{{ t(`mx.agents.p_${p}_desc`) }}</div>
              </button>
            </div>

            <!-- 规划视野与势能引导高级设置 (Lookahead Horizon + Discount + Topological Shaping) -->
            <div class="mx-ag-form-row" style="margin-top: 6px">
              <div class="mx-ag-field" style="flex: 1">
                <label
                  >{{ t('mx.agents.lookaheadHorizon') }} ({{
                    editingAgent.lookaheadHorizon ?? 2
                  }})</label
                >
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  class="mx-ag-imp-slider"
                  :value="editingAgent.lookaheadHorizon ?? 2"
                  @input="
                    s.updateAgent(editingAgent.id, {
                      lookaheadHorizon: Math.max(
                        1,
                        Math.min(5, Number(($event.target as HTMLInputElement).value) || 2)
                      )
                    })
                  "
                />
              </div>
              <div class="mx-ag-field" style="width: 120px">
                <label>{{ t('mx.agents.discountLabel') }}</label>
                <input
                  type="number"
                  min="0.1"
                  max="1"
                  step="0.05"
                  class="mx-input mx-mono"
                  :value="editingAgent.discount ?? 0.65"
                  @input="
                    s.updateAgent(editingAgent.id, {
                      discount: Math.max(
                        0.1,
                        Math.min(1, Number(($event.target as HTMLInputElement).value) || 0.65)
                      )
                    })
                  "
                />
              </div>
            </div>
            <label class="mx-ag-check-row">
              <input
                type="checkbox"
                :checked="editingAgent.shapingEnabled !== false"
                @change="
                  s.updateAgent(editingAgent.id, {
                    shapingEnabled: ($event.target as HTMLInputElement).checked
                  })
                "
              />
              <span>{{ t('mx.agents.shapingLabel') }}</span>
            </label>
          </div>

          <!-- ─── STEP 2: GOALS (Agent assets · 1:1 复刻截图第 2 步) ─── -->
          <div v-else-if="wizardStep === 2" class="mx-ag-modal-body">
            <div class="mx-ag-assets-hdr">
              <div class="mx-ag-assets-title">
                <span>📊</span>
                <span>{{ t('mx.agents.assetsTitle') }}</span>
              </div>
              <div class="mx-ag-assets-actions">
                <button type="button" class="mx-ag-link-btn" @click="addGoalAssetToCurrent">
                  {{ t('mx.agents.addAsset') }}
                </button>
                <button
                  type="button"
                  class="mx-ag-link-btn is-ai"
                  @click="s.fillAgentGoalsWithAi(editingAgent.id)"
                >
                  {{ t('mx.agents.addWithAi') }}
                </button>
              </div>
            </div>

            <div class="mx-ag-bullets">
              <div>{{ t('mx.agents.bullet1', { name: editingAgent.name }) }}</div>
              <div>{{ t('mx.agents.bullet2', { name: editingAgent.name }) }}</div>
            </div>

            <div class="mx-ag-goal-cards">
              <div v-for="goal in editingAgent.goals" :key="goal.id" class="mx-ag-goal-card">
                <button
                  v-if="editingAgent.goals.length > 1"
                  type="button"
                  class="mx-ag-goal-del"
                  @click="removeGoalAsset(goal.id)"
                >
                  ×
                </button>

                <!-- Diagram node 选择行 -->
                <div class="mx-ag-goal-row">
                  <span class="mx-ag-goal-lbl">{{ t('mx.agents.diagramNode') }}</span>
                  <div class="mx-ag-node-select-wrap">
                    <span
                      class="mx-ag-node-circle"
                      :style="{ borderColor: nodeDotColor(goal.nodeId) }"
                    />
                    <select
                      class="mx-ag-node-select"
                      :value="goal.nodeId"
                      @change="
                        updateGoalAsset(goal.id, {
                          nodeId: ($event.target as HTMLSelectElement).value
                        })
                      "
                    >
                      <option v-for="nd in goalCandidateNodes" :key="nd.id" :value="nd.id">
                        {{ nd.label || nd.id }} ({{ nd.kind === 'pool' ? 'Pool' : 'Register' }})
                      </option>
                    </select>
                  </div>
                </div>

                <!-- Target value 公式行 -->
                <div class="mx-ag-goal-row">
                  <span class="mx-ag-goal-lbl">{{ t('mx.agents.targetValue') }}</span>
                  <input
                    type="text"
                    class="mx-ag-target-input mx-mono"
                    :placeholder="t('mx.agents.targetPlaceholder')"
                    :value="goal.targetFormula"
                    @input="
                      updateGoalAsset(goal.id, {
                        targetFormula: ($event.target as HTMLInputElement).value
                      })
                    "
                  />
                </div>

                <!-- Advanced options 折叠头 -->
                <div
                  class="mx-ag-adv-hdr"
                  @click="collapsedGoalIds[goal.id] = !collapsedGoalIds[goal.id]"
                >
                  <span>{{ t('mx.agents.advancedOptions') }}</span>
                  <span>{{ collapsedGoalIds[goal.id] ? '▾' : '▴' }}</span>
                </div>

                <div v-if="!collapsedGoalIds[goal.id]" class="mx-ag-adv-body">
                  <!-- Importance 5 档滑杆 (Min - Low - Med - High - Max) -->
                  <div class="mx-ag-goal-row is-slider-row">
                    <span class="mx-ag-goal-lbl">{{ t('mx.agents.importance') }}</span>
                    <div class="mx-ag-slider-col">
                      <input
                        type="range"
                        min="0"
                        max="4"
                        step="1"
                        class="mx-ag-imp-slider"
                        :value="importanceIndex(goal.importance)"
                        @input="onImportanceSliderInput(goal.id, $event)"
                      />
                      <div class="mx-ag-imp-ticks">
                        <span
                          v-for="imp in importanceStops"
                          :key="imp"
                          :class="{ 'is-active': goal.importance === imp }"
                          @click="updateGoalAsset(goal.id, { importance: imp })"
                        >
                          {{ t(`mx.agents.imp_${imp}`) }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Continue accumulation past target value 复选框 -->
                  <label class="mx-ag-check-row">
                    <input
                      type="checkbox"
                      :checked="goal.continuePastTarget"
                      @change="
                        updateGoalAsset(goal.id, {
                          continuePastTarget: ($event.target as HTMLInputElement).checked
                        })
                      "
                    />
                    <span>{{ t('mx.agents.continuePastTarget') }}</span>
                  </label>

                  <!-- Trajectory: Upwards | Downwards -->
                  <div class="mx-ag-goal-row">
                    <span class="mx-ag-goal-lbl">{{ t('mx.agents.trajectory') }}</span>
                    <div class="mx-ag-traj-group">
                      <button
                        type="button"
                        class="mx-ag-traj-btn"
                        :class="{ 'is-active': goal.trajectory === 'upwards' }"
                        @click="updateGoalAsset(goal.id, { trajectory: 'upwards' })"
                      >
                        {{ t('mx.agents.upwards') }}
                      </button>
                      <button
                        type="button"
                        class="mx-ag-traj-btn"
                        :class="{ 'is-active': goal.trajectory === 'downwards' }"
                        @click="updateGoalAsset(goal.id, { trajectory: 'downwards' })"
                      >
                        {{ t('mx.agents.downwards') }}
                      </button>
                    </div>
                  </div>

                  <!-- Utility Response Curve: Linear | Diminishing | Urgency | Step -->
                  <div class="mx-ag-goal-row">
                    <span class="mx-ag-goal-lbl">{{ t('mx.agents.utilityCurve') }}</span>
                    <div class="mx-ag-traj-group">
                      <button
                        v-for="cv in utilityCurveOptions"
                        :key="cv"
                        type="button"
                        class="mx-ag-traj-btn"
                        :class="{ 'is-active': (goal.utilityCurve ?? 'linear') === cv }"
                        @click="updateGoalAsset(goal.id, { utilityCurve: cv })"
                      >
                        {{ t(`mx.agents.curve_${cv}`) }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ─── STEP 3: CONTROL (受控交互节点绑定) ─── -->
          <div v-else class="mx-ag-modal-body">
            <div class="mx-ag-assets-hdr">
              <div class="mx-ag-assets-title">
                <span>🎮</span>
                <span>{{ t('mx.agents.controlTitle') }}</span>
              </div>
              <div v-if="interactiveNodes.length" class="mx-ag-assets-actions">
                <button
                  type="button"
                  class="mx-ag-link-btn"
                  @click="
                    s.updateAgent(editingAgent.id, {
                      controlledNodeIds: interactiveNodes.map((n) => n.id)
                    })
                  "
                >
                  {{ t('mx.agents.selectAll') }}
                </button>
                <button
                  type="button"
                  class="mx-ag-link-btn"
                  @click="s.updateAgent(editingAgent.id, { controlledNodeIds: [] })"
                >
                  {{ t('mx.agents.clearAll') }}
                </button>
              </div>
            </div>

            <div class="mx-ag-bullets">
              <div>{{ t('mx.agents.controlBullet1', { name: editingAgent.name }) }}</div>
            </div>

            <div v-if="interactiveNodes.length" class="mx-ag-ctrl-list">
              <label
                v-for="nd in interactiveNodes"
                :key="nd.id"
                class="mx-ag-ctrl-item"
                :class="{
                  'is-checked':
                    editingAgent.controlledNodeIds.includes(nd.id) ||
                    editingAgent.controlledNodeIds.length === 0
                }"
              >
                <input
                  type="checkbox"
                  :checked="editingAgent.controlledNodeIds.includes(nd.id)"
                  @change="toggleControlledNode(nd.id)"
                />
                <span class="mx-ag-dot" :style="{ background: nodeDotColor(nd.id) }" />
                <span class="mx-ag-ctrl-name">{{ nd.label || nd.id }}</span>
                <span class="mx-ag-badge">{{ nd.kind }}</span>
              </label>
            </div>
            <div v-else class="mx-ag-bullets">
              {{ t('mx.agents.noInteractiveNodes') }}
            </div>

            <template v-if="convertibleActionNodes.length">
              <div class="mx-ag-section-lbl" style="margin-top: 12px">
                {{ t('mx.agents.convertAndBind') }}
              </div>
              <div class="mx-ag-ctrl-list">
                <div v-for="nd in convertibleActionNodes" :key="nd.id" class="mx-ag-ctrl-item">
                  <span class="mx-ag-dot" :style="{ background: nodeDotColor(nd.id) }" />
                  <span class="mx-ag-ctrl-name">{{ nd.label || nd.id }}</span>
                  <span class="mx-ag-badge">{{ nd.kind }} ({{ nd.trigger }})</span>
                  <button
                    type="button"
                    class="mx-mini-btn"
                    @click="convertNodeToInteractiveAndBind(nd.id)"
                  >
                    + {{ t('mx.agents.convertBtn') }}
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- ─── 底部导航按钮 (Back | Cancel | Next/Done) ─── -->
          <footer class="mx-ag-modal-ftr">
            <div>
              <button
                v-if="wizardStep > 1"
                type="button"
                class="mx-ag-ftr-back"
                @click="wizardStep = (wizardStep - 1) as 1 | 2"
              >
                {{ t('mx.agents.back') }}
              </button>
            </div>
            <div class="mx-ag-ftr-right">
              <button type="button" class="mx-ag-ftr-cancel" @click="closeAgentWizard">
                {{ t('mx.agents.cancel') }}
              </button>
              <button
                v-if="wizardStep < 3"
                type="button"
                class="mx-ag-ftr-next"
                @click="wizardStep = (wizardStep + 1) as 2 | 3"
              >
                {{ t('mx.agents.next') }}
              </button>
              <button v-else type="button" class="mx-ag-ftr-next" @click="closeAgentWizard">
                {{ t('mx.agents.done') }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.mx-drawer {
  width: 264px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  color: var(--text);
  font-size: 12px;
  z-index: 15;
}
.mx-drawer-head {
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elevated);
}
.mx-drawer-title {
  font-weight: 700;
  color: var(--text);
}
.mx-drawer-close {
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--text-muted);
  cursor: pointer;
}
.mx-drawer-close:hover {
  color: var(--text);
}
.mx-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mx-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
.mx-input,
.mx-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}
.mx-input:focus,
.mx-textarea:focus {
  border-color: var(--accent);
  outline: none;
}
.mx-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.mx-primary-btn {
  padding: 7px 12px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #ffffff;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.mx-primary-btn:hover {
  background: var(--accent-hover, #1d4ed8);
}
.mx-quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;
}
.mx-prompt-chip {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}
.mx-prompt-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.mx-tpl-list,
.mx-item-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mx-tpl-card {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-elevated);
  cursor: pointer;
  transition:
    border-color 0.14s,
    background 0.14s;
}
.mx-tpl-card:hover {
  border-color: var(--accent);
  background: var(--accent-12);
}
.mx-tpl-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.mx-tpl-name {
  font-weight: 700;
  color: var(--text);
}
.mx-tpl-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--text-muted);
}
.mx-tpl-desc {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}
.mx-list-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}
.mx-mini-btn {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.mx-mini-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.mx-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mx-color-pick {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}
.mx-row-del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
}
.mx-row-del:hover {
  color: var(--danger, #dc2626);
}
.mx-scenario-card {
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mx-scenario-card.is-active {
  border-color: var(--accent);
  background: var(--accent-12);
}
.mx-sc-param {
  display: grid;
  grid-template-columns: 60px 1fr;
  align-items: center;
  gap: 6px;
}
.mx-icon-toggle {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 2px 5px;
  cursor: pointer;
}
.mx-icon-toggle.is-off {
  opacity: 0.35;
}
.mx-docs h4 {
  margin: 6px 0 4px;
  font-size: 12px;
  color: var(--text);
}
.mx-docs ul {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.mx-docs code {
  padding: 1px 4px;
  background: var(--bg-elevated);
  color: var(--accent);
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ═════════════ Agents 侧边栏与 3-Step 配置弹窗样式 ═════════════ */
.mx-ag-search-box {
  margin-bottom: 2px;
}
.mx-ag-btn-ai {
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 6px;
  background: #4f46e5;
  color: #ffffff;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.mx-ag-btn-ai:hover {
  background: #4338ca;
}
.mx-ag-btn-outline {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #6366f1;
  border-radius: 6px;
  background: transparent;
  color: #6366f1;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.mx-ag-btn-outline:hover {
  background: rgba(99, 102, 241, 0.1);
}
.mx-ag-empty {
  margin-top: 36px;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}
.mx-ag-empty-circle {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
}
.mx-ag-empty-title {
  font-weight: 700;
  font-size: 13px;
  color: var(--text);
}
.mx-ag-empty-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
.mx-ag-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.mx-ag-card {
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mx-ag-card.is-disabled {
  opacity: 0.55;
}
.mx-ag-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mx-ag-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.mx-ag-dot-sm {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.mx-ag-name {
  flex: 1;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mx-ag-name:hover {
  color: #6366f1;
}
.mx-ag-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.14);
  color: #6366f1;
  font-weight: 600;
}
.mx-ag-card-meta {
  font-size: 11px;
  color: var(--text-muted);
}
.mx-ag-goal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mx-ag-goal-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  font-size: 10px;
  color: var(--text);
  cursor: pointer;
}
.mx-ag-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

/* ─── 3-Step Modal ─── */
.mx-ag-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.mx-ag-modal {
  width: 580px;
  max-width: 94vw;
  max-height: 86vh;
  background: var(--bg-panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 22px 54px rgba(0, 0, 0, 0.32);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mx-ag-stepper-hdr {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
}
.mx-ag-stepper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.mx-ag-step-item {
  border: none;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--text-muted);
}
.mx-ag-step-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  transition: all 0.15s;
}
.mx-ag-step-item.is-active .mx-ag-step-circle,
.mx-ag-step-item.is-done .mx-ag-step-circle {
  background: #4f46e5;
  border-color: #4f46e5;
  color: #ffffff;
}
.mx-ag-step-lbl {
  font-size: 11px;
  font-weight: 600;
}
.mx-ag-step-item.is-active .mx-ag-step-lbl {
  color: var(--text);
  font-weight: 700;
}
.mx-ag-step-line {
  width: 72px;
  height: 2px;
  background: var(--border);
  margin-bottom: 16px;
}
.mx-ag-step-line.is-filled {
  background: #4f46e5;
}
.mx-ag-modal-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}
.mx-ag-modal-close:hover {
  color: var(--text);
}
.mx-ag-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mx-ag-form-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.mx-ag-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mx-ag-field label,
.mx-ag-section-lbl {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}
.mx-ag-color-input {
  width: 100%;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  cursor: pointer;
}
.mx-ag-persona-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.mx-ag-persona-card {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
  transition: all 0.14s;
}
.mx-ag-persona-card:hover {
  border-color: #6366f1;
}
.mx-ag-persona-card.is-selected {
  border-color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
}
.mx-ag-persona-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.mx-ag-persona-desc {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}
.mx-ag-assets-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mx-ag-assets-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.mx-ag-assets-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mx-ag-link-btn {
  border: none;
  background: transparent;
  color: #4f46e5;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 5px;
}
.mx-ag-link-btn:hover {
  background: rgba(79, 70, 229, 0.1);
}
.mx-ag-bullets {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
.mx-ag-goal-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mx-ag-goal-card {
  position: relative;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mx-ag-goal-del {
  position: absolute;
  top: 8px;
  right: 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}
.mx-ag-goal-del:hover {
  color: #dc2626;
}
.mx-ag-goal-row {
  display: grid;
  grid-template-columns: 115px 1fr;
  align-items: center;
  gap: 10px;
}
.mx-ag-goal-row.is-slider-row {
  align-items: start;
}
.mx-ag-goal-lbl {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}
.mx-ag-node-select-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-input);
}
.mx-ag-node-circle {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2.5px solid #f59e0b;
  flex-shrink: 0;
}
.mx-ag-node-select {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  outline: none;
}
.mx-ag-target-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
}
.mx-ag-adv-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
  padding-top: 2px;
}
.mx-ag-adv-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}
.mx-ag-slider-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mx-ag-imp-slider {
  width: 100%;
  accent-color: #4f46e5;
  cursor: pointer;
}
.mx-ag-imp-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}
.mx-ag-imp-ticks span {
  cursor: pointer;
}
.mx-ag-imp-ticks span.is-active {
  color: #4f46e5;
  font-weight: 700;
}
.mx-ag-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}
.mx-ag-traj-group {
  display: inline-flex;
  gap: 8px;
}
.mx-ag-traj-btn {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.mx-ag-traj-btn.is-active {
  border-color: #4f46e5;
  background: rgba(79, 70, 229, 0.12);
  color: #4f46e5;
  font-weight: 700;
}
.mx-ag-ctrl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mx-ag-ctrl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  cursor: pointer;
}
.mx-ag-ctrl-item.is-checked {
  border-color: #4f46e5;
  background: rgba(79, 70, 229, 0.08);
}
.mx-ag-ctrl-name {
  flex: 1;
  font-weight: 600;
  font-size: 12px;
}
.mx-ag-modal-ftr {
  padding: 12px 24px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-elevated);
}
.mx-ag-ftr-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mx-ag-ftr-back {
  border: none;
  background: transparent;
  color: #4f46e5;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  padding: 7px 12px;
}
.mx-ag-ftr-cancel {
  padding: 7px 16px;
  border: 1px solid #4f46e5;
  border-radius: 6px;
  background: transparent;
  color: #4f46e5;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
}
.mx-ag-ftr-next {
  padding: 7px 18px;
  border: none;
  border-radius: 6px;
  background: #4f46e5;
  color: #ffffff;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
}
.mx-ag-ftr-next:hover {
  background: #4338ca;
}
.mx-ag-ai-prompt-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mx-ag-ai-prompt-input {
  font-size: 11px;
  border-color: rgba(79, 70, 229, 0.35);
}
.mx-ag-btn-arena {
  width: 100%;
  padding: 7px 12px;
  border: 1px dashed rgba(99, 102, 241, 0.55);
  border-radius: 6px;
  background: rgba(99, 102, 241, 0.08);
  color: #6366f1;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.mx-ag-btn-arena:hover {
  background: rgba(99, 102, 241, 0.16);
  border-color: #6366f1;
}
.mx-ag-goal-progress-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 2px;
}
.mx-ag-goal-prog-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  border-radius: 5px;
  background: var(--bg-input);
  cursor: pointer;
}
.mx-ag-goal-prog-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
}
.mx-ag-goal-prog-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: var(--text-primary);
}
.mx-ag-goal-prog-val {
  color: var(--text-muted);
  font-size: 10px;
}
.mx-ag-goal-prog-bar {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
  overflow: hidden;
}
.mx-ag-goal-prog-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}
</style>
