<script setup lang="ts">
/**
 * 通用游戏数值与肉鸽（Roguelike / DBG / TCG / ATB / Gacha）仿真工作台面板。
 *
 * 集成于 MachinationsStudio 底部面板的 `⚔ Numerical & Roguelike Lab` 标签页，包含四大核心模块：
 * 1. 【战斗调度内核 (Combat Kernels)】：
 *    - `deck_cycle`（《杀戮尖塔》洗抽牌库 + 能量预算 + 力量/易伤/格挡回合仿真）
 *    - `mana_tempo`（《炉石传说》1~10费法力曲线 + 按费拍怪率/卡手率 + 随从场面交换）
 *    - `action_bar`（《阴阳师》/《星铁》速度行动条拉条/超车检测 + 全队8鬼火/5格回火池断火率）
 * 2. 【肉鸽全局战力包络线 vs 怪物膨胀墙 (Roguelike Power Envelope)】：
 *    - 模拟 1..N 层/波次中天胡(P90) / 均运(P50) / 非酋(P10) 构筑成长包络线 vs 关卡难度墙，
 *      自动标记「数值劝退墙」与「后期割草崩坏层」，并计算局外养成（Meta-Progression）通关局数。
 * 3. 【乘区公式边际收益与配表超模审计 (Multiplier Pipeline & Table Audit)】：
 *    - 自定义属性与乘区阶段公式、自动计算每项属性的边际收益 ROI 与最优加点拐点轨迹，
 *      并对卡牌/随从/式神/武器配表进行费效比偏离审计（抓出超模卡与废卡）。
 * 4. 【多维概率、保底与御魂词条强化模拟器 (Gacha / Sub-stat / Draft Pool)】：
 *    - 抽卡大小保底与奥术之尘折算、阴阳师御魂/圣遗物 +15 满速词条强化期望体力、肉鸽商店 Reroll 凑羁绊成型率。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  analyzeMultiplierPipeline,
  createMxWorkbenchPreset,
  exportMxCommercialQaReportMarkdown,
  exportWorkbenchToGameDataTables,
  MX_WORKBENCH_PRESETS,
  runMxArchetypeBalanceMatrix,
  runMxCombatKernelSimulation,
  runMxCommercialCohortAnalysis,
  runMxDeckRemovalRoiAnalysis,
  runMxEncounterCounterMatrix,
  runMxLootAndSubstatSimulation,
  runMxPoolDilutionAnalysis,
  runMxRoguelikeEnvelopeSimulation,
  solveMxCombatTargetGoalSeek,
  solveMxEnvelopeTargetGoalSeek,
  type MxCombatKernelKind,
  type MxEnemyMechanismKind,
  type MxLootRollMode,
  type MxNumericalWorkbench,
  type MxRelicTriggerPreset,
  type MxWorkbenchPresetId
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'

const { locale } = useI18n()
const s = useMxStudioStore()

const isZh = computed(() => String(locale.value).startsWith('zh'))
function L(zh: string, en: string): string {
  return isZh.value ? zh : en
}

const activeSubTab = ref<'combat' | 'envelope' | 'multiplier' | 'loot'>('combat')
const syncCanvasOnPreset = ref(true)
const liveFollowStep = ref(false)
const selectedCanvasSourceNodeId = ref('')
const selectedWorkbenchTargetAttr = ref('')
const selectedWorkbenchOutputKey = ref<'damage' | 'winRate' | 'ttk' | 'lootCost' | 'clearRate'>(
  'damage'
)
const selectedCanvasTargetNodeId = ref('')
const bridgeFeedback = ref('')

const wb = computed<MxNumericalWorkbench>(() => {
  if (!s.doc.value.workbench) {
    return createMxWorkbenchPreset('slay_the_spire_dbg')
  }
  return s.doc.value.workbench
})

const canvasBridgeNodes = computed(() =>
  s.doc.value.nodes.filter(
    (n) =>
      n.kind === 'pool' || n.kind === 'register' || n.kind === 'source' || n.kind === 'converter'
  )
)

const canvasValueNodes = computed(() =>
  s.doc.value.nodes.filter((n) => n.kind === 'pool' || n.kind === 'register')
)

function getCanvasNodeLiveVal(nodeId: string): number {
  const v = s.displayValues.value?.[nodeId]
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100
  const nd = s.doc.value.nodes.find((n) => n.id === nodeId)
  return nd?.initial ?? 0
}

watch(
  () => [canvasValueNodes.value, wb.value.multiplier.attributes] as const,
  ([nodes, attrs]) => {
    if (
      !selectedCanvasSourceNodeId.value ||
      !nodes.some((n) => n.id === selectedCanvasSourceNodeId.value)
    ) {
      const preferred =
        nodes.find((n) => /power|战力|chips|筹码|orbs|鬼火|mana|水晶|gold|金币/i.test(n.label)) ??
        nodes[0] // cjk-ok
      selectedCanvasSourceNodeId.value = preferred?.id ?? ''
    }
    if (
      !selectedCanvasTargetNodeId.value ||
      !canvasBridgeNodes.value.some((n) => n.id === selectedCanvasTargetNodeId.value)
    ) {
      const preferredTarget =
        canvasBridgeNodes.value.find((n) =>
          /power|战力|score|chips|筹码|gold|金币/i.test(n.label)
        ) ?? // cjk-ok
        canvasBridgeNodes.value[0]
      selectedCanvasTargetNodeId.value = preferredTarget?.id ?? ''
    }
    if (
      !selectedWorkbenchTargetAttr.value ||
      !attrs.some((a) => a.name === selectedWorkbenchTargetAttr.value)
    ) {
      selectedWorkbenchTargetAttr.value = attrs[0]?.name ?? ''
    }
  },
  { immediate: true }
)

function pullCanvasNodeIntoWorkbench(): void {
  const srcId = selectedCanvasSourceNodeId.value
  const attrName = selectedWorkbenchTargetAttr.value
  if (!srcId || !attrName) return
  const liveVal = getCanvasNodeLiveVal(srcId)
  const srcNode = s.doc.value.nodes.find((n) => n.id === srcId)
  mutateWb((w) => {
    const attr = w.multiplier.attributes.find((a) => a.name === attrName)
    if (attr) {
      attr.value = Math.max(attr.min, Math.min(attr.max, liveVal))
    }
  }, `pullCanvas:${srcId}`)
  s.select([srcId])
  bridgeFeedback.value = `${srcNode?.label ?? srcId} (${liveVal}) → ${attrName}`
}

watch(
  () => [s.playStep.value, s.displayValues.value] as const,
  () => {
    if (!liveFollowStep.value) return
    pullCanvasNodeIntoWorkbench()
  }
)

function mutateWb(fn: (w: MxNumericalWorkbench) => void, key = 'wb'): void {
  s.mutate((d) => {
    if (!d.workbench) {
      d.workbench = createMxWorkbenchPreset('slay_the_spire_dbg')
    }
    fn(d.workbench)
  }, key)
}

function selectPreset(id: MxWorkbenchPresetId): void {
  s.applyWorkbenchPreset(id, syncCanvasOnPreset.value)
  bridgeFeedback.value = syncCanvasOnPreset.value
    ? L('已同步切换上方画布节点与下方数值模型', 'Synced top canvas topology & bottom workbench') // cjk-ok
    : L('已切换下方数值预设', 'Switched workbench preset') // cjk-ok
}

function setCombatKernel(k: MxCombatKernelKind): void {
  mutateWb((w) => {
    w.combatKernel.kernel = k
  }, 'wbKernel')
}

function setLootMode(m: MxLootRollMode): void {
  mutateWb((w) => {
    w.lootRoll.mode = m
  }, 'wbLootMode')
}

const debouncedCombatKernel = ref(wb.value.combatKernel)
const debouncedLootRoll = ref(wb.value.lootRoll)
let matrixDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [wb.value.combatKernel, wb.value.lootRoll] as const,
  ([ck, lr]) => {
    if (matrixDebounceTimer) clearTimeout(matrixDebounceTimer)
    matrixDebounceTimer = setTimeout(() => {
      debouncedCombatKernel.value = ck
      debouncedLootRoll.value = lr
    }, 120)
  },
  { deep: true, immediate: true }
)

const combatRes = computed(() => runMxCombatKernelSimulation(wb.value.combatKernel))
const counterMatrixRes = computed(() => runMxEncounterCounterMatrix(debouncedCombatKernel.value))
const deckRemovalRoiRes = computed(() => runMxDeckRemovalRoiAnalysis(debouncedCombatKernel.value))
const archetypeMatrixRes = computed(() => runMxArchetypeBalanceMatrix(debouncedCombatKernel.value))
const envelopeRes = computed(() => runMxRoguelikeEnvelopeSimulation(wb.value.roguelikeEnvelope))
const multRes = computed(() => analyzeMultiplierPipeline(wb.value.multiplier, 12))
const lootRes = computed(() => runMxLootAndSubstatSimulation(wb.value.lootRoll))
const poolDilutionRes = computed(() => runMxPoolDilutionAnalysis(debouncedLootRoll.value))
const commercialCohortRes = computed(() => runMxCommercialCohortAnalysis(debouncedLootRoll.value))

const goalSeekWinRate = ref(75)
const goalSeekClearRate = ref(25)

function setEnemyMechanism(mech: MxEnemyMechanismKind): void {
  mutateWb((w) => {
    w.combatKernel.enemyMechanism = mech
  }, 'wbEnemyMech')
}

function setRelicTriggerPreset(preset: MxRelicTriggerPreset): void {
  mutateWb((w) => {
    w.combatKernel.relicTriggerPreset = preset
  }, 'wbRelicPreset')
}

function runCombatGoalSeek(): void {
  const solved = solveMxCombatTargetGoalSeek(wb.value.combatKernel, goalSeekWinRate.value)
  mutateWb((w) => {
    if (w.combatKernel.kernel === 'deck_cycle') {
      w.combatKernel.enemyHp = solved.recommendedEnemyHp
    } else if (w.combatKernel.kernel === 'mana_tempo') {
      w.combatKernel.opponentHp = solved.recommendedEnemyHp
    } else {
      w.combatKernel.targetEnemyHp = solved.recommendedEnemyHp
    }
  }, 'wbCombatGoalSeek')
  bridgeFeedback.value = L(
    `🎯 逆向求解完成：目标胜率 ${solved.targetWinRatePct}% → 敌方血量 ${solved.previousEnemyHp} ➔ ${solved.recommendedEnemyHp} (实测胜率 ${solved.achievedWinRatePct}%, TTK ${solved.achievedTtkP50}T)`, // cjk-ok
    `🎯 Goal-Seek solved: Target Win ${solved.targetWinRatePct}% → Enemy HP ${solved.previousEnemyHp} ➔ ${solved.recommendedEnemyHp} (Actual ${solved.achievedWinRatePct}%, TTK ${solved.achievedTtkP50}T)`
  )
}

function runEnvelopeGoalSeek(): void {
  const solved = solveMxEnvelopeTargetGoalSeek(wb.value.roguelikeEnvelope, goalSeekClearRate.value)
  mutateWb((w) => {
    w.roguelikeEnvelope.enemyGrowthRate = solved.recommendedGrowthRate
  }, 'wbEnvelopeGoalSeek')
  bridgeFeedback.value = L(
    `🎯 逆向求解完成：目标首通率 ${solved.targetClearRatePct}% → 怪物膨胀率 ${solved.previousGrowthRate}x ➔ ${solved.recommendedGrowthRate}x (实测首通 ${solved.achievedClearRatePct}%)`, // cjk-ok
    `🎯 Goal-Seek solved: Target Clear ${solved.targetClearRatePct}% → Enemy Growth ${solved.previousGrowthRate}x ➔ ${solved.recommendedGrowthRate}x (Actual ${solved.achievedClearRatePct}%)`
  )
}

function exportFullGameDataTables(): void {
  const bundle = exportWorkbenchToGameDataTables(wb.value)
  const blob = new Blob([bundle.jsonText], {
    type: 'application/json;charset=utf-8;'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(wb.value.multiplier.title || wb.value.activePresetId || 'game').replace(/\s+/g, '-')}-data-tables-bundle.json`
  a.click()
  URL.revokeObjectURL(url)
  navigator.clipboard?.writeText(bundle.tableCsvs['cards.csv'] ?? '').catch(() => {})
  bridgeFeedback.value = L(
    `📦 已导出配表工程包 (cards:${bundle.cards.length} / waves:${bundle.waves.length} / items:${bundle.items.length}) 并复制卡牌 CSV`, // cjk-ok
    `📦 Exported Game Data Tables bundle (cards:${bundle.cards.length} / waves:${bundle.waves.length} / items:${bundle.items.length})`
  )
}

function exportCommercialQaReport(): void {
  const md = exportMxCommercialQaReportMarkdown(wb.value)
  const blob = new Blob([md], {
    type: 'text/markdown;charset=utf-8;'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(wb.value.multiplier.title || wb.value.activePresetId || 'game').replace(/\s+/g, '-')}-commercial-qa-report.md`
  a.click()
  URL.revokeObjectURL(url)
  navigator.clipboard?.writeText(md).catch(() => {})
  bridgeFeedback.value = L(
    `📋 已导出商业数值立项与 QA 签收审计报告 (.md) 并复制到剪贴板`, // cjk-ok
    `📋 Exported Commercial Numerical QA Audit Report (.md) & copied to clipboard`
  )
}

function syncToMacroGraph(): void {
  const touched = s.syncWorkbenchToMacroParams({
    CombatWinRate: combatRes.value.winRatePct,
    CombatTTK: combatRes.value.ttkP50,
    DamageOutput: multRes.value.finalOutput,
    LootExpectedCost: lootRes.value.costP50,
    ClearRatePct: envelopeRes.value.firstRunClearRatePct
  })
  bridgeFeedback.value = L(
    `已回写画布参数并生成/更新 ${touched.length} 个画布联动节点`, // cjk-ok
    `Synced params & updated ${touched.length} canvas bridge nodes`
  )
}

function pushWorkbenchMetricToCanvasNode(): void {
  const targetId = selectedCanvasTargetNodeId.value
  if (!targetId) return
  const map: Record<typeof selectedWorkbenchOutputKey.value, { val: number; label: string }> = {
    damage: { val: multRes.value.finalOutput, label: 'DamageOutput' },
    winRate: { val: combatRes.value.winRatePct, label: 'CombatWinRate%' },
    ttk: { val: combatRes.value.ttkP50, label: 'CombatTTK' },
    lootCost: { val: lootRes.value.costP50, label: 'LootExpectedCost' },
    clearRate: { val: envelopeRes.value.firstRunClearRatePct, label: 'ClearRate%' }
  }
  const item = map[selectedWorkbenchOutputKey.value]
  s.injectValueToCanvasNode(targetId, item.val, item.label)
  const targetNode = s.doc.value.nodes.find((n) => n.id === targetId)
  bridgeFeedback.value = `${item.label} (${item.val}) ↗ ${targetNode?.label ?? targetId}`
}

// ───────── 节点类型（UI 元数据）国际化映射 ─────────
const NODE_KIND_ZH_MAP: Record<string, string> = {
  pool: '资源池', // cjk-ok
  register: '公式寄存器', // cjk-ok
  source: '产出源', // cjk-ok
  converter: '转换器', // cjk-ok
  drain: '消耗池', // cjk-ok
  gate: '概率门', // cjk-ok
  delay: '延迟节点', // cjk-ok
  end: '终局条件' // cjk-ok
}

function localizeNodeKind(kind: string): string {
  if (!isZh.value) return kind
  return NODE_KIND_ZH_MAP[kind] ?? kind
}

// ───────── 卡牌设计与配表自动配平辅助函数 ─────────
const DEFAULT_DECK_COLS = ['damage', 'block', 'draw', 'applyStrength', 'applyVulnerable', 'exhaust']
const DECK_BUILTIN_COL_META: Record<string, { label: string; labelZh: string; isBool?: boolean }> =
  {
    damage: { label: 'DMG', labelZh: '伤害 DMG' }, // cjk-ok
    hits: { label: 'Hits', labelZh: '连击段数 Hits' }, // cjk-ok
    block: { label: 'Blk', labelZh: '格挡 Blk' }, // cjk-ok
    draw: { label: 'Draw', labelZh: '抽牌 Draw' }, // cjk-ok
    energyGain: { label: '+NRG', labelZh: '回费 +NRG' }, // cjk-ok
    applyStrength: { label: '+STR', labelZh: '力量 +STR' }, // cjk-ok
    applyVulnerable: { label: 'Vuln', labelZh: '易伤 Vuln' }, // cjk-ok
    applyWeak: { label: 'Weak', labelZh: '虚弱 Weak' }, // cjk-ok
    poison: { label: 'Poison', labelZh: '中毒 Poison' }, // cjk-ok
    heal: { label: 'Heal', labelZh: '治疗 Heal' }, // cjk-ok
    exhaust: { label: 'Exh', labelZh: '消耗 Exh', isBool: true } // cjk-ok
  }

const DEFAULT_MANA_COLS = ['attack', 'health', 'directDamage', 'drawCards']
const MANA_BUILTIN_COL_META: Record<string, { label: string; labelZh: string; isBool?: boolean }> =
  {
    attack: { label: 'ATK', labelZh: '攻击力 ATK' }, // cjk-ok
    health: { label: 'HP', labelZh: '生命值 HP' }, // cjk-ok
    directDamage: { label: 'Spell', labelZh: '直伤法术 Spell' }, // cjk-ok
    drawCards: { label: 'Draw', labelZh: '过牌 Draw' }, // cjk-ok
    taunt: { label: 'Taunt', labelZh: '嘲讽 Taunt', isBool: true }, // cjk-ok
    divineShield: { label: 'Shield', labelZh: '圣盾 Shield', isBool: true } // cjk-ok
  }

const newDeckColKey = ref('hits')
const customDeckColName = ref('')
const newManaColKey = ref('taunt')
const customManaColName = ref('')
const newAuditColName = ref('')
const newAuditColWeight = ref(2)
const actionBarRightView = ref<'units' | 'timeline'>('units')
const deckRightView = ref<'cards' | 'counter_matrix' | 'removal_roi' | 'archetype_meta'>('cards')
const lootRightView = ref<'histogram' | 'dilution' | 'commercial_cohorts'>('histogram')
const newMultAttrName = ref('')
const csvFileInputRef = ref<HTMLInputElement | null>(null)
const jsonFileInputRef = ref<HTMLInputElement | null>(null)
const csvImportTarget = ref<'deck' | 'mana' | 'action' | 'audit'>('audit')

interface MxSavedUserPreset {
  id: string
  name: string
  workbench: MxNumericalWorkbench
}

const USER_PRESETS_STORAGE_KEY = 'agy.mx.customUserPresets.v1'
const savedUserPresets = ref<MxSavedUserPreset[]>([])

try {
  const raw = localStorage.getItem(USER_PRESETS_STORAGE_KEY)
  if (raw) {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) savedUserPresets.value = parsed
  }
} catch {
  // ignore storage errors
}

function persistUserPresets(): void {
  try {
    localStorage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(savedUserPresets.value))
  } catch {
    // ignore storage errors
  }
}

function initBlankCustomWorkbench(): void {
  mutateWb((w) => {
    w.multiplier.title = L('我的原创数值体系', 'My Custom Numerical System') // cjk-ok
    w.multiplier.attributes = [
      {
        id: 'attr_base',
        name: 'BasePower',
        label: 'Base',
        value: 20,
        min: 1,
        max: 9999,
        stepPerBudget: 5
      },
      {
        id: 'attr_mult',
        name: 'BonusMult',
        label: 'Mult%',
        value: 0.25,
        min: 0,
        max: 50,
        stepPerBudget: 0.1
      }
    ]
    w.multiplier.stages = [{ id: 'st_1', name: 'CoreOut', formula: 'BasePower * (1 + BonusMult)' }]
    w.multiplier.finalFormula = 'CoreOut'
    w.multiplier.expectedBudgetFormula = 'cost * 8 + 4'
    w.multiplier.entityValueFormula = 'power * 1 + shield * 1'
    w.multiplier.statColumns = ['power', 'shield']
    w.multiplier.entities = [
      {
        id: 'custom_1',
        name: 'Starter Card 1',
        cost: 1,
        rarity: 'common',
        tags: ['starter'],
        stats: { power: 7, shield: 5 }
      }
    ]
    w.combatKernel.deckActiveColumns = ['damage', 'block', 'draw']
    w.combatKernel.deckCards = [
      {
        id: 'd_1',
        name: 'Starter Card 1',
        cost: 1,
        count: 4,
        damage: 7,
        block: 5,
        draw: 0,
        energyGain: 0,
        applyStrength: 0,
        applyVulnerable: 0,
        applyWeak: 0,
        exhaust: false,
        priority: 5
      }
    ]
    w.combatKernel.manaActiveColumns = ['attack', 'health', 'directDamage']
    w.combatKernel.manaCurveDeck = [
      {
        id: 'm_1',
        name: 'Starter Unit 1',
        manaCost: 1,
        count: 2,
        kind: 'minion',
        attack: 2,
        health: 2,
        directDamage: 0,
        drawCards: 0
      }
    ]
    w.combatKernel.actionUnits = [
      {
        id: 'u_1',
        name: 'Hero 1',
        team: 'ally',
        speed: 150,
        attack: 5000,
        critDamageMult: 2.0,
        skillRatio: 2.2,
        orbCost: 2,
        pullGaugePct: 0,
        pushGaugePct: 0,
        orbGain: 0
      },
      {
        id: 'u_boss',
        name: 'Boss',
        team: 'enemy',
        speed: 120,
        attack: 4000,
        critDamageMult: 1.5,
        skillRatio: 1.5,
        orbCost: 0,
        pullGaugePct: 0,
        pushGaugePct: 0,
        orbGain: 0
      }
    ]
  }, 'initBlankCustom')
  bridgeFeedback.value = L(
    '✨ 已初始化空白自定义数值体系，可自由定义公式、属性列、卡牌与战斗规则', // cjk-ok
    '✨ Initialized blank custom numerical system; define your own formulas, columns & cards'
  )
}

function saveCurrentAsUserPreset(): void {
  const name =
    (wb.value.multiplier.title || '').trim() || `Custom ${savedUserPresets.value.length + 1}`
  const clone = JSON.parse(JSON.stringify(wb.value)) as MxNumericalWorkbench
  const existingIdx = savedUserPresets.value.findIndex((p) => p.name === name)
  if (existingIdx >= 0) {
    savedUserPresets.value[existingIdx]!.workbench = clone
  } else {
    savedUserPresets.value.push({
      id: `up_${Date.now()}`,
      name,
      workbench: clone
    })
  }
  persistUserPresets()
  bridgeFeedback.value = L(`💾 已保存自定义预设「${name}」`, `💾 Saved custom preset "${name}"`) // cjk-ok
}

function loadUserPreset(preset: MxSavedUserPreset): void {
  mutateWb((w) => {
    const clone = JSON.parse(JSON.stringify(preset.workbench)) as MxNumericalWorkbench
    Object.assign(w, clone)
  }, `loadUserPreset:${preset.id}`)
  bridgeFeedback.value = L(
    `已加载自定义预设「${preset.name}」`,
    `Loaded custom preset "${preset.name}"`
  ) // cjk-ok
}

function removeUserPreset(id: string): void {
  savedUserPresets.value = savedUserPresets.value.filter((p) => p.id !== id)
  persistUserPresets()
}

function exportWorkbenchJson(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    workbench: wb.value
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(wb.value.multiplier.title || 'custom-workbench').replace(/\s+/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
  bridgeFeedback.value = L(
    '📤 已导出完整自定义数值体系 JSON 工程文件',
    '📤 Exported full custom workbench JSON file'
  ) // cjk-ok
}

function triggerWorkbenchJsonImport(): void {
  if (jsonFileInputRef.value) {
    jsonFileInputRef.value.value = ''
    jsonFileInputRef.value.click()
  }
}

function onJsonFileChange(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result ?? ''))
      const incoming = (parsed?.workbench ?? parsed) as MxNumericalWorkbench
      if (incoming && incoming.multiplier && incoming.combatKernel && incoming.roguelikeEnvelope) {
        mutateWb((w) => {
          Object.assign(w, incoming)
        }, 'importWbJson')
        bridgeFeedback.value = L(
          '📥 已成功导入自定义数值体系 JSON 工程',
          '📥 Imported custom workbench JSON project'
        ) // cjk-ok
      }
    } catch {
      bridgeFeedback.value = L('JSON 格式无效，导入失败', 'Invalid JSON format') // cjk-ok
    }
  }
  reader.readAsText(file)
}

interface MxBaselineSnapshot {
  pinnedAt: string
  winRatePct: number
  ttkP50: number
  firstRunClearRatePct: number
  metaRunsTo50PctClear: number
  finalOutput: number
  lootSuccessRatePct: number
  lootCostP50: number
}

const baselineSnap = ref<MxBaselineSnapshot | null>(null)

function pinBaselineSnapshot(): void {
  baselineSnap.value = {
    pinnedAt: new Date().toLocaleTimeString(),
    winRatePct: combatRes.value.winRatePct,
    ttkP50: combatRes.value.ttkP50,
    firstRunClearRatePct: envelopeRes.value.firstRunClearRatePct,
    metaRunsTo50PctClear: envelopeRes.value.metaRunsTo50PctClear,
    finalOutput: multRes.value.finalOutput,
    lootSuccessRatePct: lootRes.value.successRatePct,
    lootCostP50: lootRes.value.costP50
  }
  bridgeFeedback.value = L(
    '📌 已锁定当前指标为基准快照，修改任意数值即可查看 Δ 差值', // cjk-ok
    '📌 Pinned current metrics as baseline; edit any value to see Δ deltas'
  )
}

function clearBaselineSnapshot(): void {
  baselineSnap.value = null
  bridgeFeedback.value = L('已清除 A/B 基准快照对比', 'Cleared A/B baseline snapshot') // cjk-ok
}

function fmtDelta(cur: number, base: number | undefined, suffix = ''): string {
  if (base === undefined) return ''
  const d = Math.round((cur - base) * 100) / 100
  if (Math.abs(d) < 1e-4) return `±0${suffix}`
  return d > 0 ? `+${d}${suffix}` : `${d}${suffix}`
}

function deltaClass(cur: number, base: number | undefined, lowerIsBetter = false): string {
  if (base === undefined) return ''
  const d = cur - base
  if (Math.abs(d) < 1e-4) return 'is-neutral'
  const isGood = lowerIsBetter ? d < 0 : d > 0
  return isGood ? 'is-good' : 'is-bad'
}

function getAuditColWeight(colName: string): number {
  const f = wb.value.multiplier.entityValueFormula || ''
  const escaped = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reAfter = new RegExp(`\\b${escaped}\\s*\\*\\s*([+-]?\\d+(?:\\.\\d+)?)`)
  const mAfter = f.match(reAfter)
  if (mAfter) return Number(mAfter[1])
  const reBefore = new RegExp(`([+-]?\\d+(?:\\.\\d+)?)\\s*\\*\\s*\\b${escaped}\\b`)
  const mBefore = f.match(reBefore)
  if (mBefore) return Number(mBefore[1])
  const reBare = new RegExp(`\\b${escaped}\\b`)
  if (reBare.test(f)) return 1
  return 0
}

function setAuditColWeight(colName: string, weight: number): void {
  const wVal = Number.isFinite(weight) ? Math.round(weight * 100) / 100 : 1
  mutateWb((w) => {
    const f = w.multiplier.entityValueFormula || ''
    const escaped = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const reAfter = new RegExp(`(\\b${escaped}\\s*\\*\\s*)([+-]?\\d+(?:\\.\\d+)?)`)
    if (reAfter.test(f)) {
      w.multiplier.entityValueFormula = f.replace(reAfter, `$1${wVal}`)
      return
    }
    const reBefore = new RegExp(`([+-]?\\d+(?:\\.\\d+)?)(\\s*\\*\\s*\\b${escaped}\\b)`)
    if (reBefore.test(f)) {
      w.multiplier.entityValueFormula = f.replace(reBefore, `${wVal}$2`)
      return
    }
    const reBare = new RegExp(`\\b${escaped}\\b`)
    if (reBare.test(f)) {
      w.multiplier.entityValueFormula = f.replace(reBare, `${colName} * ${wVal}`)
      return
    }
    w.multiplier.entityValueFormula = f.trim()
      ? `${f.trim()} + ${colName} * ${wVal}`
      : `${colName} * ${wVal}`
  }, `colWeight:${colName}`)
}

const activeDeckCols = computed<string[]>(() => {
  const cols = wb.value.combatKernel.deckActiveColumns
  return Array.isArray(cols) && cols.length > 0 ? cols : DEFAULT_DECK_COLS
})

const availableDeckBuiltinCols = computed(() =>
  Object.keys(DECK_BUILTIN_COL_META).filter((k) => !activeDeckCols.value.includes(k))
)

const activeManaCols = computed<string[]>(() => {
  const cols = wb.value.combatKernel.manaActiveColumns
  return Array.isArray(cols) && cols.length > 0 ? cols : DEFAULT_MANA_COLS
})

const availableManaBuiltinCols = computed(() =>
  Object.keys(MANA_BUILTIN_COL_META).filter((k) => !activeManaCols.value.includes(k))
)

function deckColDropdownLabel(col: string): string {
  const meta = DECK_BUILTIN_COL_META[col]
  if (!meta) return col
  return isZh.value ? meta.labelZh : `${meta.label} (${col})`
}

function manaColDropdownLabel(col: string): string {
  const meta = MANA_BUILTIN_COL_META[col]
  if (!meta) return col
  return isZh.value ? meta.labelZh : `${meta.label} (${col})`
}

function deckColLabel(col: string): string {
  return DECK_BUILTIN_COL_META[col]?.label ?? col
}

function isDeckColBool(col: string): boolean {
  return Boolean(DECK_BUILTIN_COL_META[col]?.isBool)
}

function getDeckCardColVal(card: Record<string, any>, col: string): number {
  if (col in DECK_BUILTIN_COL_META) {
    if (col === 'hits') return Number(card.hits ?? 1)
    return Number(card[col] ?? 0)
  }
  return Number(card.customStats?.[col] ?? 0)
}

function setDeckCardColVal(cardId: string, col: string, val: number | boolean): void {
  mutateWb((w) => {
    const target = w.combatKernel.deckCards.find((x) => x.id === cardId) as
      Record<string, any> | undefined
    if (!target) return
    if (col in DECK_BUILTIN_COL_META) {
      target[col] = val
    } else {
      if (!target.customStats) target.customStats = {}
      target.customStats[col] = Number(val) || 0
    }
  })
}

function addDeckColumn(): void {
  const custom = customDeckColName.value.trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '')
  const colKey = custom || newDeckColKey.value
  if (!colKey) return
  mutateWb((w) => {
    const cur =
      Array.isArray(w.combatKernel.deckActiveColumns) && w.combatKernel.deckActiveColumns.length > 0
        ? [...w.combatKernel.deckActiveColumns]
        : [...DEFAULT_DECK_COLS]
    if (!cur.includes(colKey)) {
      cur.push(colKey)
    }
    w.combatKernel.deckActiveColumns = cur
    for (const c of w.combatKernel.deckCards) {
      if (!(colKey in DECK_BUILTIN_COL_META)) {
        if (!c.customStats) c.customStats = {}
        if (c.customStats[colKey] === undefined) c.customStats[colKey] = 0
      } else if (colKey === 'hits' && c.hits === undefined) {
        c.hits = 1
      }
    }
  }, 'addDeckCol')
  customDeckColName.value = ''
  if (availableDeckBuiltinCols.value.length > 0) {
    newDeckColKey.value = availableDeckBuiltinCols.value[0]!
  }
}

function removeDeckColumn(colKey: string): void {
  mutateWb((w) => {
    const cur =
      Array.isArray(w.combatKernel.deckActiveColumns) && w.combatKernel.deckActiveColumns.length > 0
        ? [...w.combatKernel.deckActiveColumns]
        : [...DEFAULT_DECK_COLS]
    if (cur.length <= 1) return
    w.combatKernel.deckActiveColumns = cur.filter((c) => c !== colKey)
  }, 'delDeckCol')
}

function manaColLabel(col: string): string {
  return MANA_BUILTIN_COL_META[col]?.label ?? col
}

function isManaColBool(col: string): boolean {
  return Boolean(MANA_BUILTIN_COL_META[col]?.isBool)
}

function getManaCardColVal(card: Record<string, any>, col: string): number {
  if (col in MANA_BUILTIN_COL_META) {
    return Number(card[col] ?? 0)
  }
  return Number(card.customStats?.[col] ?? 0)
}

function setManaCardColVal(cardId: string, col: string, val: number | boolean): void {
  mutateWb((w) => {
    const target = w.combatKernel.manaCurveDeck.find((x) => x.id === cardId) as
      Record<string, any> | undefined
    if (!target) return
    if (col in MANA_BUILTIN_COL_META) {
      target[col] = val
    } else {
      if (!target.customStats) target.customStats = {}
      target.customStats[col] = Number(val) || 0
    }
  })
}

function addManaColumn(): void {
  const custom = customManaColName.value.trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '')
  const colKey = custom || newManaColKey.value
  if (!colKey) return
  mutateWb((w) => {
    const cur =
      Array.isArray(w.combatKernel.manaActiveColumns) && w.combatKernel.manaActiveColumns.length > 0
        ? [...w.combatKernel.manaActiveColumns]
        : [...DEFAULT_MANA_COLS]
    if (!cur.includes(colKey)) {
      cur.push(colKey)
    }
    w.combatKernel.manaActiveColumns = cur
    for (const c of w.combatKernel.manaCurveDeck) {
      if (!(colKey in MANA_BUILTIN_COL_META)) {
        if (!c.customStats) c.customStats = {}
        if (c.customStats[colKey] === undefined) c.customStats[colKey] = 0
      }
    }
  }, 'addManaCol')
  customManaColName.value = ''
  if (availableManaBuiltinCols.value.length > 0) {
    newManaColKey.value = availableManaBuiltinCols.value[0]!
  }
}

function removeManaColumn(colKey: string): void {
  mutateWb((w) => {
    const cur =
      Array.isArray(w.combatKernel.manaActiveColumns) && w.combatKernel.manaActiveColumns.length > 0
        ? [...w.combatKernel.manaActiveColumns]
        : [...DEFAULT_MANA_COLS]
    if (cur.length <= 1) return
    w.combatKernel.manaActiveColumns = cur.filter((c) => c !== colKey)
  }, 'delManaCol')
}

function addAuditStatColumn(): void {
  const rawName = newAuditColName.value.trim().replace(/[^a-zA-Z0-9_]/g, '')
  const colName = rawName || `stat_${wb.value.multiplier.statColumns.length + 1}`
  const weight = Number(newAuditColWeight.value) || 1
  mutateWb((w) => {
    if (!w.multiplier.statColumns.includes(colName)) {
      w.multiplier.statColumns.push(colName)
      for (const ent of w.multiplier.entities) {
        if (ent.stats[colName] === undefined) {
          ent.stats[colName] = 0
        }
      }
      if (!w.multiplier.entityValueFormula.includes(colName)) {
        w.multiplier.entityValueFormula = `${w.multiplier.entityValueFormula.trim()} + ${colName} * ${weight}`
      }
    }
  }, 'addAuditCol')
  newAuditColName.value = ''
}

function removeAuditStatColumn(colName: string): void {
  mutateWb((w) => {
    if (w.multiplier.statColumns.length <= 1) return
    w.multiplier.statColumns = w.multiplier.statColumns.filter((c) => c !== colName)
    for (const ent of w.multiplier.entities) {
      delete ent.stats[colName]
    }
  }, 'delAuditCol')
}

function addDeckCycleCard(): void {
  mutateWb((w) => {
    const idx = w.combatKernel.deckCards.length + 1
    w.combatKernel.deckCards.push({
      id: `card_${Date.now()}_${idx}`,
      name: `New Card ${idx}`,
      cost: 1,
      count: 2,
      damage: 9,
      block: 0,
      draw: 1,
      energyGain: 0,
      applyStrength: 0,
      applyVulnerable: 0,
      applyWeak: 0,
      exhaust: false,
      priority: 6
    })
  }, 'addDeckCard')
}

function removeDeckCycleCard(id: string): void {
  mutateWb((w) => {
    if (w.combatKernel.deckCards.length <= 1) return
    w.combatKernel.deckCards = w.combatKernel.deckCards.filter((c) => c.id !== id)
  }, 'delDeckCard')
}

function addManaCurveCard(): void {
  mutateWb((w) => {
    const idx = w.combatKernel.manaCurveDeck.length + 1
    w.combatKernel.manaCurveDeck.push({
      id: `mcard_${Date.now()}_${idx}`,
      name: `Minion ${idx}`,
      manaCost: 3,
      count: 2,
      kind: 'minion',
      attack: 3,
      health: 4,
      directDamage: 0,
      drawCards: 0
    })
  }, 'addManaCard')
}

function removeManaCurveCard(id: string): void {
  mutateWb((w) => {
    if (w.combatKernel.manaCurveDeck.length <= 1) return
    w.combatKernel.manaCurveDeck = w.combatKernel.manaCurveDeck.filter((c) => c.id !== id)
  }, 'delManaCard')
}

function addActionBarUnit(): void {
  mutateWb((w) => {
    const idx = w.combatKernel.actionUnits.length + 1
    w.combatKernel.actionUnits.push({
      id: `unit_${Date.now()}_${idx}`,
      name: `Shikigami ${idx}`,
      team: 'ally',
      speed: 145,
      attack: 6800,
      critDamageMult: 2.2,
      skillRatio: 2.6,
      orbCost: 3,
      pullGaugePct: 0,
      pushGaugePct: 0,
      orbGain: 0
    })
  }, 'addActionUnit')
}

function removeActionBarUnit(id: string): void {
  mutateWb((w) => {
    if (w.combatKernel.actionUnits.length <= 1) return
    w.combatKernel.actionUnits = w.combatKernel.actionUnits.filter((u) => u.id !== id)
  }, 'delActionUnit')
}

function addMultiplierAttribute(): void {
  const raw = newMultAttrName.value.trim().replace(/[^a-zA-Z0-9_]/g, '')
  const attrName = raw || `stat_${wb.value.multiplier.attributes.length + 1}`
  mutateWb((w) => {
    if (w.multiplier.attributes.some((a) => a.name === attrName)) return
    w.multiplier.attributes.push({
      id: `attr_${Date.now()}`,
      name: attrName,
      label: attrName,
      value: 0.2,
      min: 0,
      max: 100,
      stepPerBudget: 0.08
    })
    const stageName = `mult_${attrName}`
    w.multiplier.stages.push({
      id: `st_${Date.now()}`,
      name: stageName,
      formula: `1 + ${attrName}`
    })
    w.multiplier.finalFormula = `(${w.multiplier.finalFormula}) * ${stageName}`
  }, 'addMultAttr')
  newMultAttrName.value = ''
}

function removeMultiplierAttribute(attrName: string): void {
  mutateWb((w) => {
    if (w.multiplier.attributes.length <= 1) return
    w.multiplier.attributes = w.multiplier.attributes.filter((a) => a.name !== attrName)
  }, 'delMultAttr')
}

function addMultiplierStage(): void {
  mutateWb((w) => {
    const idx = w.multiplier.stages.length + 1
    const stageName = `stage_${idx}`
    w.multiplier.stages.push({
      id: `st_${Date.now()}_${idx}`,
      name: stageName,
      formula: '1.15'
    })
    if (!w.multiplier.finalFormula.includes(stageName)) {
      w.multiplier.finalFormula = `${w.multiplier.finalFormula} * ${stageName}`
    }
  }, 'addMultStage')
}

function removeMultiplierStage(id: string): void {
  mutateWb((w) => {
    if (w.multiplier.stages.length <= 1) return
    w.multiplier.stages = w.multiplier.stages.filter((s) => s.id !== id)
  }, 'delMultStage')
}

function addAuditEntity(): void {
  mutateWb((w) => {
    const idx = w.multiplier.entities.length + 1
    const stats: Record<string, number> = {}
    for (const col of w.multiplier.statColumns) {
      stats[col] = 0
    }
    const primaryCol = w.multiplier.statColumns[0]
    if (primaryCol) stats[primaryCol] = 8
    w.multiplier.entities.push({
      id: `ent_${Date.now()}_${idx}`,
      name: `Custom Card ${idx}`,
      cost: 1,
      rarity: 'common',
      tags: ['custom'],
      stats
    })
  }, 'addEntity')
}

function removeAuditEntity(id: string): void {
  mutateWb((w) => {
    if (w.multiplier.entities.length <= 1) return
    w.multiplier.entities = w.multiplier.entities.filter((e) => e.id !== id)
  }, 'delEntity')
}

function autoBalanceAllEntities(): void {
  const audits = multRes.value.entityAudits
  const primaryCol = wb.value.multiplier.statColumns[0]
  if (!primaryCol) return
  const primaryWeight = Math.max(0.1, Math.abs(getAuditColWeight(primaryCol)) || 1)
  mutateWb((w) => {
    for (const ent of w.multiplier.entities) {
      const audit = audits.find((a) => a.id === ent.id)
      if (!audit || audit.verdict === 'balanced') continue
      const diff = (audit.expectedValue - audit.actualValue) / primaryWeight
      const curPrimary = ent.stats[primaryCol] ?? 0
      ent.stats[primaryCol] = Math.max(0, Math.round((curPrimary + diff) * 10) / 10)
    }
  }, 'autoBalanceCards')
  bridgeFeedback.value = L(
    '已按费用基准公式自动配平全部超模/亏模卡牌',
    'Auto-balanced all cards to match cost budget formula'
  ) // cjk-ok
}

function syncAuditEntitiesToCombatDeck(switchTab = true): void {
  mutateWb((w) => {
    if (w.combatKernel.kernel === 'action_bar') {
      const existingEnemies = w.combatKernel.actionUnits.filter((u) => u.team === 'enemy')
      const allyUnits = w.multiplier.entities.map((e) => ({
        id: e.id,
        name: e.name,
        team: 'ally' as const,
        speed: Math.max(80, e.stats.spd ?? e.stats.speed ?? 140),
        attack: Math.max(1000, (e.stats.atk ?? e.stats.aoe_dmg ?? e.stats.dmg ?? 3) * 2400),
        critDamageMult: 2.2,
        skillRatio: Math.max(1, (e.stats.aoe_dmg ?? e.stats.dmg ?? e.stats.atk ?? 10) / 8),
        orbCost: Math.max(0, Math.min(5, Math.round(e.cost))),
        pullGaugePct: e.stats.pull ?? e.stats.pullGaugePct ?? 0,
        pushGaugePct: e.stats.push ?? e.stats.pushGaugePct ?? 0,
        orbGain: e.stats.orb_gen ?? e.stats.orbGain ?? 0
      }))
      w.combatKernel.actionUnits = [...allyUnits, ...existingEnemies]
    } else if (w.combatKernel.kernel === 'mana_tempo') {
      const stdSet = new Set([
        'atk',
        'attack',
        'hp',
        'health',
        'dmg',
        'directDamage',
        'draw',
        'drawCards',
        'taunt',
        'shield',
        'divineShield'
      ])
      const extraCols = w.multiplier.statColumns.filter((c) => !stdSet.has(c))
      if (extraCols.length > 0) {
        const curCols =
          Array.isArray(w.combatKernel.manaActiveColumns) && w.combatKernel.manaActiveColumns.length
            ? [...w.combatKernel.manaActiveColumns]
            : [...DEFAULT_MANA_COLS]
        for (const ec of extraCols) {
          if (!curCols.includes(ec)) curCols.push(ec)
        }
        w.combatKernel.manaActiveColumns = curCols
      }
      w.combatKernel.manaCurveDeck = w.multiplier.entities.map((e) => {
        const customStats: Record<string, number> = {}
        for (const ec of extraCols) {
          customStats[ec] = e.stats[ec] ?? 0
        }
        return {
          id: e.id,
          name: e.name,
          manaCost: Math.max(0, Math.min(10, Math.round(e.cost))),
          count: e.rarity === 'legendary' ? 1 : 2,
          kind: (e.stats.atk ?? 0) > 0 || (e.stats.hp ?? 0) > 0 ? 'minion' : 'spell',
          attack: e.stats.atk ?? e.stats.attack ?? e.stats.dmg ?? 2,
          health: Math.max(1, e.stats.hp ?? e.stats.health ?? e.stats.block ?? 2),
          directDamage: e.stats.dmg ?? e.stats.directDamage ?? 0,
          drawCards: e.stats.draw ?? e.stats.drawCards ?? 0,
          taunt: Boolean(e.stats.taunt),
          divineShield: Boolean(e.stats.shield ?? e.stats.divineShield),
          customStats
        }
      })
    } else {
      const stdMap: Record<string, string> = {
        dmg: 'damage',
        damage: 'damage',
        hits: 'hits',
        block: 'block',
        draw: 'draw',
        nrg: 'energyGain',
        energyGain: 'energyGain',
        str: 'applyStrength',
        applyStrength: 'applyStrength',
        vuln: 'applyVulnerable',
        applyVulnerable: 'applyVulnerable',
        weak: 'applyWeak',
        applyWeak: 'applyWeak',
        poison: 'poison',
        heal: 'heal',
        exhaust: 'exhaust'
      }
      const curCols =
        Array.isArray(w.combatKernel.deckActiveColumns) && w.combatKernel.deckActiveColumns.length
          ? [...w.combatKernel.deckActiveColumns]
          : [...DEFAULT_DECK_COLS]
      for (const col of w.multiplier.statColumns) {
        const mapped = stdMap[col] ?? col
        if (!curCols.includes(mapped)) curCols.push(mapped)
      }
      w.combatKernel.deckActiveColumns = curCols

      w.combatKernel.deckCards = w.multiplier.entities.map((e, i) => {
        const customStats: Record<string, number> = {}
        for (const col of w.multiplier.statColumns) {
          if (!(col in stdMap)) {
            customStats[col] = e.stats[col] ?? 0
          }
        }
        return {
          id: e.id,
          name: e.name,
          cost: Math.max(0, Math.min(5, Math.round(e.cost))),
          count: e.rarity === 'rare' || e.rarity === 'legendary' ? 1 : 2,
          damage: e.stats.dmg ?? e.stats.damage ?? e.stats.atk ?? e.stats.chips ?? 0,
          hits: Math.max(1, e.stats.hits ?? 1),
          block: e.stats.block ?? e.stats.hp ?? 0,
          draw: e.stats.draw ?? 0,
          energyGain: e.stats.energyGain ?? e.stats.nrg ?? 0,
          applyStrength: e.stats.str ?? e.stats.applyStrength ?? e.stats.add_mult ?? 0,
          applyVulnerable: e.stats.vuln ?? e.stats.applyVulnerable ?? 0,
          applyWeak: e.stats.weak ?? e.stats.applyWeak ?? 0,
          poison: e.stats.poison ?? 0,
          heal: e.stats.heal ?? 0,
          exhaust: (e.stats.str ?? 0) > 0 || Boolean(e.stats.exhaust),
          priority: 10 - i,
          customStats
        }
      })
    }
  }, 'syncCardsToDeck')
  if (switchTab) {
    activeSubTab.value = 'combat'
    bridgeFeedback.value = L(
      '已将配表单位/卡牌及自定义列同步至战斗内核并开启模拟测试',
      'Synced card/unit table & custom columns into Combat Kernel simulator'
    ) // cjk-ok
  }
}

function runFullPipelineCascade(): void {
  // 1) ③ 配表 → ① 战斗内核（支持 deck_cycle / mana_tempo / action_bar 全内核）
  if (wb.value.multiplier.entities.length > 0) {
    syncAuditEntitiesToCombatDeck(false)
  }
  // 2) ① 战斗模拟实测场均输出 + ④ 词条成型率 → ② 肉鸽战力包络
  const cRes = runMxCombatKernelSimulation(wb.value.combatKernel)
  const lRes = runMxLootAndSubstatSimulation(wb.value.lootRoll)
  const earlyTurns = cRes.turnSeries.slice(0, 4)
  const avgEarlyOut =
    earlyTurns.length > 0
      ? earlyTurns.reduce((s, p) => s + p.primaryP50 + p.secondaryMean * 0.5, 0) / earlyTurns.length
      : 25
  const derivedBasePower = Math.max(10, Math.round(avgEarlyOut))
  const derivedSynergyRate = Math.max(15, Math.min(80, Math.round(lRes.successRatePct * 0.65 + 15)))
  const derivedCampfireHpThresh = Math.max(
    30,
    Math.min(75, Math.round(100 - cRes.winRatePct * 0.55))
  )

  mutateWb((w) => {
    w.roguelikeEnvelope.playerBasePower = derivedBasePower
    w.roguelikeEnvelope.synergyHitRatePct = derivedSynergyRate
    w.roguelikeEnvelope.campfireRestHpThresholdPct = derivedCampfireHpThresh
  }, 'fullCascade')

  // 3) 全量回写至上方宏观图 Params 与桥接节点
  const eRes = runMxRoguelikeEnvelopeSimulation(wb.value.roguelikeEnvelope)
  s.syncWorkbenchToMacroParams({
    CombatWinRate: cRes.winRatePct,
    CombatTTK: cRes.ttkP50,
    DamageOutput: multRes.value.finalOutput,
    LootExpectedCost: lRes.costP50,
    ClearRatePct: eRes.firstRunClearRatePct,
    EliteChallengePct: eRes.eliteChallengeRatePct ?? 0,
    CampfireUpgradePct: eRes.campfireUpgradeRatioPct ?? 0,
    SnowballIndex: eRes.snowballPolarizationIndex ?? 1
  })
  bridgeFeedback.value = L(
    `⚡ 全链路已贯通：配表(${wb.value.multiplier.entities.length}项) → 胜率 ${cRes.winRatePct}% → 初战力 ${derivedBasePower} / 锻造率 ${eRes.campfireUpgradeRatioPct ?? 0}% (通关率 ${eRes.firstRunClearRatePct}%) → 画布已同步`, // cjk-ok
    `⚡ Full cascade: Table(${wb.value.multiplier.entities.length}) → Win ${cRes.winRatePct}% → BasePower ${derivedBasePower} / Upgrade ${eRes.campfireUpgradeRatioPct ?? 0}% (Clear ${eRes.firstRunClearRatePct}%) → Canvas synced`
  )
}

function csvEscape(val: unknown): string {
  const str = String(val ?? '')
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function exportTableCsv(target: 'deck' | 'mana' | 'action' | 'audit'): void {
  const rows: string[][] = []
  if (target === 'audit') {
    const cols = wb.value.multiplier.statColumns
    rows.push(['name', 'cost', ...cols, 'expectedValue', 'actualValue', 'deviationPct', 'verdict'])
    wb.value.multiplier.entities.forEach((ent, idx) => {
      const audit = multRes.value.entityAudits[idx]
      rows.push([
        ent.name,
        String(ent.cost),
        ...cols.map((c) => String(ent.stats[c] ?? 0)),
        String(audit?.expectedValue ?? 0),
        String(audit?.actualValue ?? 0),
        `${audit?.deviationPct ?? 0}%`,
        String(audit?.verdict ?? 'balanced')
      ])
    })
  } else if (target === 'action') {
    rows.push([
      'name',
      'team',
      'speed',
      'attack',
      'skillRatio',
      'orbCost',
      'orbGain',
      'pullGaugePct'
    ])
    wb.value.combatKernel.actionUnits.forEach((u) => {
      rows.push([
        u.name,
        u.team,
        String(u.speed),
        String(u.attack),
        String(u.skillRatio),
        String(u.orbCost),
        String(u.orbGain),
        String(u.pullGaugePct)
      ])
    })
  } else if (target === 'deck') {
    const cols = activeDeckCols.value
    rows.push(['name', 'cost', 'count', ...cols])
    wb.value.combatKernel.deckCards.forEach((c) => {
      rows.push([
        c.name,
        String(c.cost),
        String(c.count),
        ...cols.map((col) =>
          isDeckColBool(col)
            ? String(Boolean((c as Record<string, any>)[col]))
            : String(getDeckCardColVal(c as Record<string, any>, col))
        )
      ])
    })
  } else {
    const cols = activeManaCols.value
    rows.push(['name', 'manaCost', 'count', ...cols])
    wb.value.combatKernel.manaCurveDeck.forEach((c) => {
      rows.push([
        c.name,
        String(c.manaCost),
        String(c.count),
        ...cols.map((col) =>
          isManaColBool(col)
            ? String(Boolean((c as Record<string, any>)[col]))
            : String(getManaCardColVal(c as Record<string, any>, col))
        )
      ])
    })
  }

  const csvBody = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${wb.value.activePresetId}-${target}-table.csv`
  a.click()
  URL.revokeObjectURL(url)
  navigator.clipboard?.writeText(csvBody).catch(() => {})
  bridgeFeedback.value = L(
    `📤 已导出 ${rows.length - 1} 行 CSV 文件并复制到剪贴板（可直接粘贴至 Excel）`, // cjk-ok
    `📤 Exported ${rows.length - 1} rows to CSV file & copied to clipboard`
  )
}

function triggerCsvImport(target: 'deck' | 'mana' | 'action' | 'audit'): void {
  csvImportTarget.value = target
  if (csvFileInputRef.value) {
    csvFileInputRef.value.value = ''
    csvFileInputRef.value.click()
  }
}

function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

function onCsvFileChange(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const raw = String(reader.result ?? '').replace(/^\uFEFF/, '')
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) return
    const sep = lines[0]!.includes('\t') && !lines[0]!.includes(',') ? '\t' : ','
    const headers = parseCsvLine(lines[0]!, sep)
    const dataRows = lines.slice(1).map((l) => parseCsvLine(l, sep))
    const target = csvImportTarget.value

    if (target === 'audit') {
      const ignoreSet = new Set([
        'name',
        'card',
        'card / entity',
        'cost',
        'expectedvalue',
        'actualvalue',
        'deviationpct',
        'verdict',
        'exp',
        'act',
        'audit'
      ])
      const statColIndices: Array<{ col: string; idx: number }> = []
      let nameIdx = 0
      let costIdx = 1
      headers.forEach((h, i) => {
        const lower = h.toLowerCase()
        if (lower === 'name' || lower === 'card' || lower === 'card / entity') nameIdx = i
        else if (lower === 'cost' || lower === 'mana') costIdx = i
        else if (!ignoreSet.has(lower) && h) {
          const clean = h.replace(/[^a-zA-Z0-9_]/g, '')
          if (clean) statColIndices.push({ col: clean, idx: i })
        }
      })
      mutateWb((w) => {
        const newCols = statColIndices.map((s) => s.col)
        if (newCols.length > 0) {
          w.multiplier.statColumns = newCols
          for (const col of newCols) {
            if (!w.multiplier.entityValueFormula.includes(col)) {
              w.multiplier.entityValueFormula = `${w.multiplier.entityValueFormula.trim()} + ${col} * 1`
            }
          }
        }
        w.multiplier.entities = dataRows.map((r, rIdx) => {
          const stats: Record<string, number> = {}
          for (const sc of statColIndices) {
            stats[sc.col] = Number(r[sc.idx]) || 0
          }
          return {
            id: `csv_ent_${Date.now()}_${rIdx}`,
            name: r[nameIdx] || `Card ${rIdx + 1}`,
            cost: Number(r[costIdx]) || 0,
            rarity: 'common',
            tags: ['imported'],
            stats
          }
        })
      }, 'importAuditCsv')
    } else if (target === 'action') {
      mutateWb((w) => {
        w.combatKernel.actionUnits = dataRows.map((r, rIdx) => ({
          id: `csv_unit_${Date.now()}_${rIdx}`,
          name: r[0] || `Unit ${rIdx + 1}`,
          team: r[1]?.toLowerCase() === 'enemy' ? 'enemy' : 'ally',
          speed: Math.max(50, Number(r[2]) || 140),
          attack: Math.max(100, Number(r[3]) || 5000),
          critDamageMult: 2.0,
          skillRatio: Math.max(0.5, Number(r[4]) || 2.0),
          orbCost: Math.max(0, Number(r[5]) || 0),
          orbGain: Math.max(0, Number(r[6]) || 0),
          pullGaugePct: Math.max(0, Number(r[7]) || 0),
          pushGaugePct: 0
        }))
      }, 'importActionCsv')
    } else if (target === 'deck') {
      const colIndices: Array<{ col: string; idx: number }> = []
      let nameIdx = 0
      let costIdx = 1
      let cntIdx = 2
      headers.forEach((h, i) => {
        const lower = h.toLowerCase()
        if (lower === 'name' || lower === 'card') nameIdx = i
        else if (lower === 'cost') costIdx = i
        else if (lower === 'count' || lower === 'cnt') cntIdx = i
        else if (h) colIndices.push({ col: h, idx: i })
      })
      mutateWb((w) => {
        if (colIndices.length > 0) {
          w.combatKernel.deckActiveColumns = colIndices.map((c) => c.col)
        }
        w.combatKernel.deckCards = dataRows.map((r, rIdx) => {
          const card: Record<string, any> = {
            id: `csv_dcard_${Date.now()}_${rIdx}`,
            name: r[nameIdx] || `Card ${rIdx + 1}`,
            cost: Math.max(0, Number(r[costIdx]) || 0),
            count: Math.max(1, Number(r[cntIdx]) || 1),
            damage: 0,
            block: 0,
            draw: 0,
            energyGain: 0,
            applyStrength: 0,
            applyVulnerable: 0,
            applyWeak: 0,
            exhaust: false,
            priority: 6,
            customStats: {}
          }
          for (const ci of colIndices) {
            const rawVal = r[ci.idx] ?? '0'
            if (isDeckColBool(ci.col)) {
              card[ci.col] = rawVal === 'true' || rawVal === '1'
            } else if (ci.col in DECK_BUILTIN_COL_META) {
              card[ci.col] = Number(rawVal) || 0
            } else {
              card.customStats[ci.col] = Number(rawVal) || 0
            }
          }
          return card as any
        })
      }, 'importDeckCsv')
    } else {
      const colIndices: Array<{ col: string; idx: number }> = []
      let nameIdx = 0
      let costIdx = 1
      let cntIdx = 2
      headers.forEach((h, i) => {
        const lower = h.toLowerCase()
        if (lower === 'name' || lower === 'card') nameIdx = i
        else if (lower === 'manacost' || lower === 'mana' || lower === 'cost') costIdx = i
        else if (lower === 'count' || lower === 'cnt') cntIdx = i
        else if (h) colIndices.push({ col: h, idx: i })
      })
      mutateWb((w) => {
        if (colIndices.length > 0) {
          w.combatKernel.manaActiveColumns = colIndices.map((c) => c.col)
        }
        w.combatKernel.manaCurveDeck = dataRows.map((r, rIdx) => {
          const card: Record<string, any> = {
            id: `csv_mcard_${Date.now()}_${rIdx}`,
            name: r[nameIdx] || `Card ${rIdx + 1}`,
            manaCost: Math.max(0, Number(r[costIdx]) || 0),
            count: Math.max(1, Number(r[cntIdx]) || 1),
            kind: 'minion',
            attack: 0,
            health: 1,
            directDamage: 0,
            drawCards: 0,
            customStats: {}
          }
          for (const ci of colIndices) {
            const rawVal = r[ci.idx] ?? '0'
            if (isManaColBool(ci.col)) {
              card[ci.col] = rawVal === 'true' || rawVal === '1'
            } else if (ci.col in MANA_BUILTIN_COL_META) {
              card[ci.col] = Number(rawVal) || 0
            } else {
              card.customStats[ci.col] = Number(rawVal) || 0
            }
          }
          return card as any
        })
      }, 'importManaCsv')
    }
    bridgeFeedback.value = L(
      `📥 已成功导入 ${dataRows.length} 行 CSV 数据并实时更新模拟结果`, // cjk-ok
      `📥 Imported ${dataRows.length} CSV rows and updated simulation`
    )
  }
  reader.readAsText(file)
}

// ───────── SVG 几何计算辅助 ─────────
const SVG_W = 460
const SVG_H = 136
const PAD_L = 38
const PAD_R = 12
const PAD_T = 10
const PAD_B = 20
const PLOT_W = SVG_W - PAD_L - PAD_R
const PLOT_H = SVG_H - PAD_T - PAD_B

const combatChartBounds = computed(() => {
  const pts = combatRes.value.turnSeries
  let max = 10
  for (const p of pts) {
    if (p.primaryP90 > max) max = p.primaryP90
    if (p.secondaryMean > max) max = p.secondaryMean
  }
  return { min: 0, max: Math.ceil(max * 1.08) }
})

function cxAt(idx: number, count: number): number {
  return PAD_L + (idx / Math.max(1, count - 1)) * PLOT_W
}

function cyAt(val: number, maxVal: number): number {
  return PAD_T + PLOT_H - (Math.max(0, val) / Math.max(1e-6, maxVal)) * PLOT_H
}

const combatBandPath = computed(() => {
  const pts = combatRes.value.turnSeries
  if (!pts.length) return ''
  const max = combatChartBounds.value.max
  const top = pts.map(
    (p, i) => `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.primaryP90, max).toFixed(1)}`
  )
  const bot = [...pts].reverse().map((p, rIdx) => {
    const i = pts.length - 1 - rIdx
    return `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.primaryP10, max).toFixed(1)}`
  })
  return `M ${top.join(' L ')} L ${bot.join(' L ')} Z`
})

const combatP50Line = computed(() => {
  const pts = combatRes.value.turnSeries
  const max = combatChartBounds.value.max
  return pts
    .map((p, i) => `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.primaryP50, max).toFixed(1)}`)
    .join(' ')
})

const combatSecondaryLine = computed(() => {
  const pts = combatRes.value.turnSeries
  const max = combatChartBounds.value.max
  return pts
    .map((p, i) => `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.secondaryMean, max).toFixed(1)}`)
    .join(' ')
})

const envelopeMaxPower = computed(() => {
  const pts = envelopeRes.value.floorSeries
  let max = 10
  for (const p of pts) {
    if (p.playerP90 > max) max = p.playerP90
    if (p.enemyPower > max) max = p.enemyPower
  }
  return Math.ceil(max * 1.08)
})

const envelopeBandPath = computed(() => {
  const pts = envelopeRes.value.floorSeries
  if (!pts.length) return ''
  const max = envelopeMaxPower.value
  const top = pts.map(
    (p, i) => `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.playerP90, max).toFixed(1)}`
  )
  const bot = [...pts].reverse().map((p, rIdx) => {
    const i = pts.length - 1 - rIdx
    return `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.playerP10, max).toFixed(1)}`
  })
  return `M ${top.join(' L ')} L ${bot.join(' L ')} Z`
})

const envelopePlayerP50Line = computed(() => {
  const pts = envelopeRes.value.floorSeries
  const max = envelopeMaxPower.value
  return pts
    .map((p, i) => `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.playerP50, max).toFixed(1)}`)
    .join(' ')
})

const envelopeEnemyLine = computed(() => {
  const pts = envelopeRes.value.floorSeries
  const max = envelopeMaxPower.value
  return pts
    .map((p, i) => `${cxAt(i, pts.length).toFixed(1)},${cyAt(p.enemyPower, max).toFixed(1)}`)
    .join(' ')
})

const uiText = computed(() => ({
  presetLabel: L('旗舰数值预设:', 'Genre Preset:'), // cjk-ok
  tabCombat: L('① 战斗调度内核 (尖塔/炉石/阴阳师)', '1. Combat Kernels (DBG / TCG / ATB)'), // cjk-ok
  tabEnvelope: L('② 肉鸽战力包络 vs 膨胀墙', '2. Roguelike Envelope vs. Scaling Wall'), // cjk-ok
  tabMultiplier: L('③ 乘区边际收益与配表审计', '3. Multiplier ROI & Table Audit'), // cjk-ok
  tabLoot: L('④ 抽卡保底 / 御魂强化 / 词条池', '4. Gacha / Sub-stat / Draft Pool'), // cjk-ok
  syncBtn: L('⇄ 同步结果至宏观图 Params', '⇄ Sync Metrics to Macro Params'), // cjk-ok
  syncTip: L(
    '将胜率、TTK、乘区总伤、期望抽数与通关率回写为画布全局变量 Params', // cjk-ok
    'Write WinRate, TTK, FinalOutput, ExpectedCost & ClearRate into Macro Diagram Params'
  ),
  kernelDeck: L('牌库洗抽内核 (杀戮尖塔 DBG)', 'Deck-Cycle (Slay the Spire DBG)'), // cjk-ok
  kernelMana: L('法力曲线内核 (炉石传说 TCG)', 'Mana-Tempo (Hearthstone TCG)'), // cjk-ok
  kernelAction: L('行动条+鬼火内核 (阴阳师/星铁 ATB)', 'Action-Bar & Orbs (Onmyoji ATB)'), // cjk-ok
  winRate: L('模拟胜率 / 斩杀率', 'Win / Lethal Rate'), // cjk-ok
  ttkP50: L('击杀回合 P50 (P10~P90)', 'TTK Turn P50 (P10~P90)'), // cjk-ok
  enemyHp: L('目标敌人生命值', 'Enemy HP'), // cjk-ok
  energyTurn: L('每回合能量', 'Energy / Turn'), // cjk-ok
  drawTurn: L('每回合抽牌', 'Draw / Turn'), // cjk-ok
  enemyDmg: L('敌人基础伤害', 'Enemy Base DMG'), // cjk-ok
  mulliganCap: L('起手留牌最高费', 'Mulligan Max Cost'), // cjk-ok
  clearPower: L('对手解场强度/回合', 'Enemy Clear / Turn'), // cjk-ok
  initOrbs: L('初始鬼火数', 'Initial Orbs'), // cjk-ok
  orbRecover: L('每5次行动回火', 'Orbs / 5 Actions'), // cjk-ok
  bossDef: L('目标防御 DEF', 'Target DEF'), // cjk-ok
  floorCount: L('总层数 / 波次', 'Total Floors / Waves'), // cjk-ok
  playerBase: L('初始构筑战力', 'Player Base Power'), // cjk-ok
  synergyRate: L('每层乘区组件命中率%', 'Synergy Hit Rate %'), // cjk-ok
  synergyMult: L('单件乘区独立倍率(x)', 'Synergy ×Mult'), // cjk-ok
  enemyBase: L('怪物起始强度', 'Enemy Base Power'), // cjk-ok
  enemyGrowth: L('怪物每层膨胀指数(x)', 'Enemy Growth Rate'), // cjk-ok
  metaBonus: L('局外天赋每局增幅%', 'Meta Bonus / Run %'), // cjk-ok
  firstClear: L('首局裸装通关率', '1st-Run Clear Rate'), // cjk-ok
  metaRuns: L('达50%通关所需局数', 'Meta Runs to 50% Clear'), // cjk-ok
  wallFloors: L('数值劝退墙层数', 'Difficulty Spike Walls'), // cjk-ok
  runawayFloors: L('数值膨胀割草层', 'Runaway Trivial Floors'), // cjk-ok
  none: L('无 (曲线健康)', 'None (Healthy)'), // cjk-ok
  finalOutput: L('当前面板最终结算值', 'Final Pipeline Output'), // cjk-ok
  bestNextAttr: L('当前最高边际收益属性', 'Highest Marginal ROI Stat'), // cjk-ok
  budgetFormula: L('理论费用预算公式', 'Expected Cost Formula'), // cjk-ok
  actualFormula: L('实际单位价值公式', 'Entity Value Formula'), // cjk-ok
  modeGacha: L('抽卡大小保底 & 粉尘 (炉石/二游)', 'Gacha Pity & Dust (TCG / Banner)'), // cjk-ok
  modeSubstat: L('御魂/圣遗物副属性强化 (阴阳师+18速)', 'Sub-stat Roll (Onmyoji +18 SPD)'), // cjk-ok
  modeDraft: L('肉鸽三选一 & 商店 Reroll 凑羁绊', 'Roguelike Draft & Shop Reroll'), // cjk-ok
  baseRate: L('基础出金率 %', 'Base SSR Rate %'), // cjk-ok
  softPity: L('软保底起始抽', 'Soft Pity Pull'), // cjk-ok
  hardPity: L('硬保底抽数', 'Hard Pity Pull'), // cjk-ok
  targetCopies: L('目标获取数量', 'Target Copies'), // cjk-ok
  targetSubstat: L('目标副属性名', 'Target Sub-stat'), // cjk-ok
  targetThresh: L('毕业阈值 (>=)', 'Target Threshold (>='), // cjk-ok
  fourLineRate: L('初始4词条胚子率%', '4-Line Init Rate %'), // cjk-ok
  staminaCost: L('单次掉落体力消耗', 'Stamina / Drop'), // cjk-ok
  synergyTag: L('目标流派标签 Tag', 'Target Synergy Tag'), // cjk-ok
  synergyPieces: L('成型所需件数', 'Pieces Needed'), // cjk-ok
  tagAffinity: L('同标签权重加成%', 'Tag Affinity Bonus %'), // cjk-ok
  rerollsWave: L('每波商店刷新次数', 'Rerolls / Wave'), // cjk-ok
  attemptsP50: L('中位达成次数 P50 (P10~P90)', 'Attempts P50 (P10~P90)'), // cjk-ok
  expectedCost: L('中位消耗资源 P50 (均值)', 'Expected Cost P50 (Mean)'), // cjk-ok
  hitRate: L('单胚子/整局达成率', 'Success / Hit Rate'), // cjk-ok
  relicTriggers: L('被动遗物钩子', 'Relic Triggers'), // cjk-ok
  relicNone: L('无遗物钩子', 'None'), // cjk-ok
  relicShuriken: L('手里剑+苦无 (3攻+1力4甲)', 'Shuriken + Kunai'), // cjk-ok
  relicNecro: L('死灵之书 (首张≥2费双发)', 'Necronomicon 2x'), // cjk-ok
  relicBranch: L('枯木树枝 (消耗即衍生)', 'Dead Branch'), // cjk-ok
  relicAll: L('全遗物协同开启', 'All Relics Active'), // cjk-ok
  goalSeekTitle: L('逆向目标求解 (CRN二分)', 'Reverse Goal-Seek'), // cjk-ok
  targetWinPct: L('目标胜率%', 'Target Win%'), // cjk-ok
  solveEnemyHp: L('反推敌方血量', 'Solve Enemy HP'), // cjk-ok
  targetClearPct: L('目标首通率%', 'Target Clear%'), // cjk-ok
  solveGrowthRate: L('反推怪物膨胀率', 'Solve Growth Rate'), // cjk-ok
  exportQaReportBtn: L('导出QA审计报告', 'Export QA Report'), // cjk-ok
  exportQaReportTip: L(
    '一键生成完整的商业数值立项与QA签收审计报告 (.md)，含4层全链路指标、多流派多样性与付费分层留存表', // cjk-ok
    'Export executive Markdown Commercial Numerical QA Audit Report covering all 4 layers'
  ),
  tabArchetypeMeta: L('4流派天梯多样性', '4-Build Meta Matrix'), // cjk-ok
  colArchetype: L('流派构筑模型', 'Build Archetype'), // cjk-ok
  colMetaShare: L('预估天梯占比%', 'Meta Share %'), // cjk-ok
  colTier: L('强度梯度', 'Tier'), // cjk-ok
  metaScoreLabel: L('天梯流派百花齐放指数 (Shannon):', 'Meta Diversity Score (Shannon):'), // cjk-ok
  metaHealthy: L('百花齐放 (健康)', 'Meta Healthy'), // cjk-ok
  metaMonopoly: L('T0单流派垄断!', 'Tier-0 Monopoly!'), // cjk-ok
  metaOvertuned: L('数值膨胀全坐牢!', 'Boss Overtuned!'), // cjk-ok
  tabCommercialCohort: L('商业付费分层遥测', 'Commercial Cohorts'), // cjk-ok
  colCohort: L('玩家付费分层', 'Player Cohort'), // cjk-ok
  colSpend: L('月均付费$', 'Monthly $'), // cjk-ok
  colDailyTries: L('日均获取', 'Daily Tries'), // cjk-ok
  colGradDays: L('中位/非酋毕业天数', 'P50 / P90 Days'), // cjk-ok
  colDay30Rate: L('首月30天毕业率%', '30d Grad %'), // cjk-ok
  colChurnRisk: L('非酋流失风险', 'Churn Risk'), // cjk-ok
  riskLow: L('留存健康', 'Low Risk'), // cjk-ok
  riskMod: L('中度卡点', 'Moderate'), // cjk-ok
  riskHigh: L('高危劝退!', 'High Churn!'), // cjk-ok
  pityElasticityLbl: L('保底付费转化弹性:', 'Pity Elasticity:'), // cjk-ok
  whaleRatioLbl: L('重氪/零氪首月进度比:', 'Whale/F2P 30d Ratio:'), // cjk-ok
  blendedArpuLbl: L('预估月均ARPU:', 'Est. Monthly ARPU:') // cjk-ok
}))
</script>

<template>
  <div class="mx-wb-panel">
    <!-- 顶部旗舰预设切换栏 + 子工作台标签 + 同步按钮 -->
    <header class="mx-wb-header">
      <div class="mx-wb-presets">
        <span class="mx-wb-preset-lbl">{{ uiText.presetLabel }}</span>
        <button
          v-for="pr in MX_WORKBENCH_PRESETS"
          :key="pr.id"
          type="button"
          class="mx-wb-preset-btn"
          :class="{ 'is-active': wb.activePresetId === pr.id }"
          :title="isZh ? pr.descZh : pr.descEn"
          @click="selectPreset(pr.id)"
        >
          {{ isZh ? pr.nameZh : pr.nameEn }}
        </button>

        <!-- 用户自建预设胶囊列表 -->
        <span v-for="up in savedUserPresets" :key="up.id" class="mx-wb-user-preset-pill">
          <button type="button" class="mx-wb-preset-btn" @click="loadUserPreset(up)">
            ★ {{ up.name }}
          </button>
          <button
            type="button"
            class="mx-wb-col-del"
            :title="L('删除该自建预设', 'Remove custom preset')"
            @click="removeUserPreset(up.id)"
          >
            ×
          </button>
          <!-- cjk-ok -->
        </span>

        <button
          type="button"
          class="mx-wb-mini-btn is-accent"
          :title="
            L(
              '清空预置数据，从零搭建你自己的原创游戏数值体系',
              'Start a clean blank custom numerical system from scratch'
            )
          "
          @click="initBlankCustomWorkbench"
        >
          <!-- cjk-ok -->
          ✨ {{ L('从零自建空白体系', 'New Blank System') }}
          <!-- cjk-ok -->
        </button>
        <input
          type="text"
          class="mx-wb-cell-input"
          style="width: 108px; text-align: left"
          :value="wb.multiplier.title"
          :placeholder="L('输入体系名称...', 'System name...')"
          @input="mutateWb((w) => (w.multiplier.title = ($event.target as HTMLInputElement).value))"
        />
        <!-- cjk-ok -->
        <button
          type="button"
          class="mx-wb-mini-btn"
          :title="
            L(
              '将当前设计的全套数值保存为顶部快捷预设',
              'Save current workbench as a reusable custom preset'
            )
          "
          @click="saveCurrentAsUserPreset"
        >
          <!-- cjk-ok -->
          💾 {{ L('存为预设', 'Save Preset') }}
          <!-- cjk-ok -->
        </button>
        <button
          type="button"
          class="mx-wb-mini-btn"
          :title="L('导入完整数值工程 JSON', 'Import workbench JSON')"
          @click="triggerWorkbenchJsonImport"
        >
          📥 JSON
        </button>
        <!-- cjk-ok -->
        <button
          type="button"
          class="mx-wb-mini-btn"
          :title="L('导出完整数值工程 JSON', 'Export workbench JSON')"
          @click="exportWorkbenchJson"
        >
          📤 JSON
        </button>
        <!-- cjk-ok -->
        <input
          ref="jsonFileInputRef"
          type="file"
          accept=".json"
          style="display: none"
          @change="onJsonFileChange"
        />

        <label
          class="mx-wb-bridge-chk"
          :title="
            L(
              '切换预设时自动把上方画布替换为对应游戏的资源节点拓扑图',
              'Automatically switch top canvas resource graph when switching genre presets'
            )
          "
        >
          <!-- cjk-ok -->
          <input v-model="syncCanvasOnPreset" type="checkbox" />
          <span>{{ L('切预设同步画布节点', 'Sync Canvas Graph on Preset') }}</span>
          <!-- cjk-ok -->
        </label>
      </div>

      <!-- ═════════════ 画布资源节点 ↔ 数值工作台 双向实时绑定栏 ═════════════ -->
      <div class="mx-wb-bridge-bar">
        <div class="mx-wb-bridge-group">
          <span class="mx-wb-bridge-tag is-in">
            {{ L('① 画布节点 → 数值属性:', '1. Canvas Node → Stat:') }}
            <!-- cjk-ok -->
          </span>
          <select v-model="selectedCanvasSourceNodeId" class="mx-wb-select">
            <option v-for="nd in canvasValueNodes" :key="nd.id" :value="nd.id">
              {{ nd.label }} [{{ L(`第${s.playStep.value}步`, `Step ${s.playStep.value}`) }}:
              {{ getCanvasNodeLiveVal(nd.id) }}]
              <!-- cjk-ok -->
            </option>
          </select>
          <span class="mx-wb-bridge-arrow">→</span>
          <select v-model="selectedWorkbenchTargetAttr" class="mx-wb-select">
            <option v-for="attr in wb.multiplier.attributes" :key="attr.id" :value="attr.name">
              {{ attr.name }} ({{ attr.label }}: {{ attr.value }})
            </option>
          </select>
          <button type="button" class="mx-wb-mini-btn" @click="pullCanvasNodeIntoWorkbench">
            {{ L('↙ 读入当前步数值', '↙ Pull Value') }}
            <!-- cjk-ok -->
          </button>
          <label class="mx-wb-bridge-chk">
            <input v-model="liveFollowStep" type="checkbox" />
            <span>{{ L('⚡ 跟随播放步实时驱动', '⚡ Live Follow Step') }}</span>
            <!-- cjk-ok -->
          </label>
        </div>

        <div class="mx-wb-bridge-group">
          <span class="mx-wb-bridge-tag is-out">
            {{ L('② 数值结果 → 画布节点:', '2. Output → Canvas Node:') }}
            <!-- cjk-ok -->
          </span>
          <select v-model="selectedWorkbenchOutputKey" class="mx-wb-select">
            <option value="damage">
              💥 {{ L('乘区产出', 'Pipeline Output') }} ({{ multRes.finalOutput }})
              <!-- cjk-ok -->
            </option>
            <option value="winRate">
              ⚔ {{ L('模拟胜率%', 'Win Rate %') }} ({{ combatRes.winRatePct }}%)
              <!-- cjk-ok -->
            </option>
            <option value="ttk">
              ⏱ {{ L('击杀回合TTK', 'TTK P50') }} ({{ combatRes.ttkP50 }}T)
              <!-- cjk-ok -->
            </option>
            <option value="lootCost">
              🎲 {{ L('期望消耗', 'Expected Cost') }} ({{ lootRes.costP50 }})
              <!-- cjk-ok -->
            </option>
            <option value="clearRate">
              📈 {{ L('首局通关率%', '1st Clear %') }} ({{ envelopeRes.firstRunClearRatePct }}%)
              <!-- cjk-ok -->
            </option>
          </select>
          <span class="mx-wb-bridge-arrow">→</span>
          <select v-model="selectedCanvasTargetNodeId" class="mx-wb-select">
            <option v-for="nd in canvasBridgeNodes" :key="nd.id" :value="nd.id">
              {{ nd.label }} ({{ localizeNodeKind(nd.kind) }})
            </option>
          </select>
          <button
            type="button"
            class="mx-wb-mini-btn is-accent"
            @click="pushWorkbenchMetricToCanvasNode"
          >
            {{ L('↗ 注入该节点', '↗ Push to Node') }}
            <!-- cjk-ok -->
          </button>
        </div>

        <span v-if="bridgeFeedback" class="mx-wb-bridge-feedback"> ✓ {{ bridgeFeedback }} </span>
      </div>

      <div class="mx-wb-subtabs">
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'combat' }"
          @click="activeSubTab = 'combat'"
        >
          {{ uiText.tabCombat }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'envelope' }"
          @click="activeSubTab = 'envelope'"
        >
          {{ uiText.tabEnvelope }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'multiplier' }"
          @click="activeSubTab = 'multiplier'"
        >
          {{ uiText.tabMultiplier }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'loot' }"
          @click="activeSubTab = 'loot'"
        >
          {{ uiText.tabLoot }}
        </button>

        <div class="mx-wb-header-actions">
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{ 'is-accent': Boolean(baselineSnap) }"
            :title="
              L(
                '锁定当前各项指标为基准快照，修改任意数值后自动显示红绿 Δ 差值',
                'Pin current metrics as baseline snapshot to show live Δ deltas'
              )
            "
            @click="pinBaselineSnapshot"
          >
            <!-- cjk-ok -->
            📌
            {{
              baselineSnap
                ? L(`更新基准 (${baselineSnap.pinnedAt})`, `Re-pin (${baselineSnap.pinnedAt})`)
                : L('锁定基准对比', 'Pin Baseline')
            }}
            <!-- cjk-ok -->
          </button>
          <button
            v-if="baselineSnap"
            type="button"
            class="mx-wb-mini-btn"
            :title="L('清除 A/B 基准对比', 'Clear baseline')"
            @click="clearBaselineSnapshot"
          >
            ×
          </button>
          <!-- cjk-ok -->
          <button
            type="button"
            class="mx-wb-cascade-btn"
            :title="
              L(
                '一键贯通：③卡牌配表 → ①战斗模拟 → ②肉鸽初始战力与词条率 → 上方画布节点',
                '1-Click Cascade: 3. Card Table → 1. Combat Sim → 2. Roguelike Power → Macro Canvas'
              )
            "
            @click="runFullPipelineCascade"
          >
            <!-- cjk-ok -->
            ⚡ {{ L('全链路贯通', 'Full Cascade') }}
            <!-- cjk-ok -->
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn is-accent"
            :title="
              L(
                '一键将当前卡牌、波次、遗物与角色编译为标准 game.data_table 工程数据包 (JSON + CSV)', // cjk-ok
                'Compile cards, waves, relics & characters into standard GameDataTable bundle'
              )
            "
            @click="exportFullGameDataTables"
          >
            📦 {{ L('导出配表工程包', 'Export Data Tables') }}
            <!-- cjk-ok -->
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :title="uiText.exportQaReportTip"
            @click="exportCommercialQaReport"
          >
            📋 {{ uiText.exportQaReportBtn }}
          </button>
          <button
            type="button"
            class="mx-wb-sync-btn"
            :title="uiText.syncTip"
            @click="syncToMacroGraph"
          >
            {{ uiText.syncBtn }}
          </button>
        </div>
        <input
          ref="csvFileInputRef"
          type="file"
          accept=".csv,.txt,.tsv"
          style="display: none"
          @change="onCsvFileChange"
        />
      </div>
    </header>

    <!-- ═════════════ SUB-TAB 1: 三大微观战斗调度内核 (尖塔 / 炉石 / 阴阳师) ═════════════ -->
    <div v-if="activeSubTab === 'combat'" class="mx-wb-body">
      <div class="mx-wb-left-col">
        <div class="mx-wb-mode-bar">
          <button
            type="button"
            class="mx-wb-mode-pill"
            :class="{ 'is-active': wb.combatKernel.kernel === 'deck_cycle' }"
            @click="setCombatKernel('deck_cycle')"
          >
            🃏 {{ uiText.kernelDeck }}
          </button>
          <button
            type="button"
            class="mx-wb-mode-pill"
            :class="{ 'is-active': wb.combatKernel.kernel === 'mana_tempo' }"
            @click="setCombatKernel('mana_tempo')"
          >
            💎 {{ uiText.kernelMana }}
          </button>
          <button
            type="button"
            class="mx-wb-mode-pill"
            :class="{ 'is-active': wb.combatKernel.kernel === 'action_bar' }"
            @click="setCombatKernel('action_bar')"
          >
            ⚡ {{ uiText.kernelAction }}
          </button>
        </div>

        <!-- 战斗参数快速调节行 -->
        <div v-if="wb.combatKernel.kernel === 'deck_cycle'" class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.enemyHp }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.enemyHp"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.enemyHp =
                      Number(($event.target as HTMLInputElement).value) || 100)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.energyTurn }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.energyPerTurn"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.energyPerTurn =
                      Number(($event.target as HTMLInputElement).value) || 3)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.drawTurn }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.drawPerTurn"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.drawPerTurn =
                      Number(($event.target as HTMLInputElement).value) || 5)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.enemyDmg }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.enemyBaseDamage"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.enemyBaseDamage =
                      Number(($event.target as HTMLInputElement).value) || 10)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('Boss机制检定', 'Boss Mechanism') }}</span>
            <!-- cjk-ok -->
            <select
              class="mx-wb-select"
              :value="wb.combatKernel.enemyMechanism ?? 'standard'"
              @change="
                setEnemyMechanism(
                  ($event.target as HTMLSelectElement).value as MxEnemyMechanismKind
                )
              "
            >
              <option value="standard">{{ L('标准单体木桩', 'Standard Boss') }}</option>
              <!-- cjk-ok -->
              <option value="aoe_swarm">{{ L('多怪群攻 (AOE)', 'Multi-Mob Swarm') }}</option>
              <!-- cjk-ok -->
              <option value="status_polluter">{{ L('塞灼伤/眩晕污染', 'Status Polluter') }}</option>
              <!-- cjk-ok -->
              <option value="card_limit_punisher">
                {{ L('限牌吞噬者 (12张/轮)', 'Time-Eater Cap') }}
              </option>
              <!-- cjk-ok -->
              <option value="thorns_armor">{{ L('反伤重甲坦克', 'Thorns + Plated') }}</option>
              <!-- cjk-ok -->
              <option value="berserk_race">{{ L('狂暴竞速 DPS', 'Berserk Race') }}</option>
              <!-- cjk-ok -->
            </select>
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.relicTriggers }}</span>
            <select
              class="mx-wb-select"
              :value="wb.combatKernel.relicTriggerPreset ?? 'none'"
              @change="
                setRelicTriggerPreset(
                  ($event.target as HTMLSelectElement).value as MxRelicTriggerPreset
                )
              "
            >
              <option value="none">{{ uiText.relicNone }}</option>
              <option value="shuriken_kunai">{{ uiText.relicShuriken }}</option>
              <option value="necronomicon">{{ uiText.relicNecro }}</option>
              <option value="dead_branch">{{ uiText.relicBranch }}</option>
              <option value="all_synergy">{{ uiText.relicAll }}</option>
            </select>
          </label>
        </div>

        <div v-else-if="wb.combatKernel.kernel === 'mana_tempo'" class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.enemyHp }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.opponentHp"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.opponentHp =
                      Number(($event.target as HTMLInputElement).value) || 30)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.mulliganCap }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.mulliganMaxCost"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.mulliganMaxCost =
                      Number(($event.target as HTMLInputElement).value) || 3)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.clearPower }}</span>
            <input
              type="number"
              step="0.5"
              class="mx-wb-input"
              :value="wb.combatKernel.opponentClearPowerPerTurn"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.opponentClearPowerPerTurn =
                      Number(($event.target as HTMLInputElement).value) || 2)
                )
              "
            />
          </label>
        </div>

        <div v-else class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.enemyHp }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.targetEnemyHp"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.targetEnemyHp =
                      Number(($event.target as HTMLInputElement).value) || 50000)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.bossDef }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.targetEnemyDef"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.targetEnemyDef =
                      Number(($event.target as HTMLInputElement).value) || 400)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.initOrbs }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.initialOrbs"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.initialOrbs =
                      Number(($event.target as HTMLInputElement).value) || 4)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.orbRecover }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.combatKernel.orbRecoveryPer5Actions"
              @input="
                mutateWb(
                  (w) =>
                    (w.combatKernel.orbRecoveryPer5Actions =
                      Number(($event.target as HTMLInputElement).value) || 4)
                )
              "
            />
          </label>
        </div>

        <!-- 逆向目标求解器（Reverse Goal-Seek） -->
        <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
          <span class="mx-wb-tbl-title">🎯 {{ uiText.goalSeekTitle }}</span>
          <div class="mx-wb-toolbar-btns">
            <span style="font-size: 10px; color: var(--text-muted)">{{ uiText.targetWinPct }}</span>
            <input
              v-model.number="goalSeekWinRate"
              type="number"
              min="5"
              max="98"
              class="mx-wb-cell-input is-narrow"
            />
            <button type="button" class="mx-wb-mini-btn is-accent" @click="runCombatGoalSeek">
              ⚡ {{ uiText.solveEnemyHp }}
            </button>
          </div>
        </div>

        <!-- KPI 摘要卡片 -->
        <div class="mx-wb-kpi-strip">
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.winRate }}</span>
            <strong class="mx-wb-kpi-val is-accent">
              {{ combatRes.winRatePct }}%
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="deltaClass(combatRes.winRatePct, baselineSnap.winRatePct)"
              >
                {{ fmtDelta(combatRes.winRatePct, baselineSnap.winRatePct, '%') }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.ttkP50 }}</span>
            <strong class="mx-wb-kpi-val">
              {{ combatRes.ttkP50 }} ({{ combatRes.ttkP10 }}~{{ combatRes.ttkP90 }})
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="deltaClass(combatRes.ttkP50, baselineSnap.ttkP50, true)"
              >
                {{ fmtDelta(combatRes.ttkP50, baselineSnap.ttkP50, 'T') }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ combatRes.kpi1Label }}</span>
            <strong class="mx-wb-kpi-val">{{ combatRes.kpi1Value }}</strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ combatRes.kpi2Label }}</span>
            <strong class="mx-wb-kpi-val">{{ combatRes.kpi2Value }}</strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ combatRes.kpi3Label }}</span>
            <strong class="mx-wb-kpi-val">{{ combatRes.kpi3Value }}</strong>
          </div>
        </div>

        <div v-if="combatRes.speedTuneAdvisory" class="mx-wb-advisory">
          ⚡ {{ combatRes.speedTuneAdvisory }}
        </div>
      </div>

      <!-- 中间 SVG 曲线图 -->
      <div class="mx-wb-chart-box">
        <svg :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="mx-wb-svg">
          <line
            :x1="PAD_L"
            :y1="SVG_H - PAD_B"
            :x2="SVG_W - PAD_R"
            :y2="SVG_H - PAD_B"
            stroke="var(--border)"
          />
          <path :d="combatBandPath" fill="#3b82f6" fill-opacity="0.18" />
          <polyline :points="combatP50Line" fill="none" stroke="#3b82f6" stroke-width="2.2" />
          <polyline
            :points="combatSecondaryLine"
            fill="none"
            stroke="#10b981"
            stroke-width="1.6"
            stroke-dasharray="3 3"
          />
          <text
            :x="PAD_L - 4"
            :y="PAD_T + 8"
            text-anchor="end"
            font-size="9"
            fill="var(--text-muted)"
          >
            {{ combatChartBounds.max }}
          </text>
          <text
            :x="PAD_L - 4"
            :y="SVG_H - PAD_B"
            text-anchor="end"
            font-size="9"
            fill="var(--text-muted)"
          >
            0
          </text>
          <text :x="PAD_L" :y="SVG_H - 5" font-size="9" fill="var(--text-muted)">T1</text>
          <text
            :x="SVG_W - PAD_R"
            :y="SVG_H - 5"
            text-anchor="end"
            font-size="9"
            fill="var(--text-muted)"
          >
            T{{ combatRes.turnSeries.length }}
          </text>
        </svg>
      </div>

      <!-- 右侧配表/排轴明细表 -->
      <div class="mx-wb-table-box">
        <div v-if="wb.combatKernel.kernel === 'action_bar'">
          <div class="mx-wb-table-toolbar">
            <div class="mx-wb-toolbar-btns">
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': actionBarRightView === 'units' }"
                @click="actionBarRightView = 'units'"
              >
                ⚡ {{ L('式神/角色阵容表', 'Unit Lineup') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': actionBarRightView === 'timeline' }"
                @click="actionBarRightView = 'timeline'"
              >
                📜 {{ L('行动排轴日志', 'Action Timeline') }}
                <!-- cjk-ok -->
              </button>
            </div>
            <div v-if="actionBarRightView === 'units'" class="mx-wb-toolbar-btns">
              <button type="button" class="mx-wb-mini-btn is-accent" @click="addActionBarUnit">
                + {{ L('新增单位', 'Add Unit') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :title="L('导入 CSV / Excel 制表符文件', 'Import CSV / TSV')"
                @click="triggerCsvImport('action')"
              >
                📥 CSV
              </button>
              <!-- cjk-ok -->
              <button
                type="button"
                class="mx-wb-mini-btn"
                :title="L('导出 CSV 文件并复制到剪贴板', 'Export CSV & copy')"
                @click="exportTableCsv('action')"
              >
                📤 CSV
              </button>
              <!-- cjk-ok -->
            </div>
          </div>

          <table v-if="actionBarRightView === 'units'" class="mx-wb-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Side</th>
                <th>SPD</th>
                <th>ATK</th>
                <th>Mult</th>
                <th>Orbs</th>
                <th>+Orb</th>
                <th>Pull%</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="u in wb.combatKernel.actionUnits"
                :key="u.id"
                :class="{ 'is-enemy-row': u.team === 'enemy' }"
              >
                <td>
                  <input
                    type="text"
                    class="mx-wb-name-input"
                    :value="u.name"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target) target.name = ($event.target as HTMLInputElement).value
                      })
                    "
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="mx-wb-mini-btn"
                    @click="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target) target.team = target.team === 'ally' ? 'enemy' : 'ally'
                      })
                    "
                  >
                    {{ u.team === 'ally' ? 'Ally' : 'Boss' }}
                  </button>
                </td>
                <td>
                  <input
                    type="number"
                    class="mx-wb-cell-input is-narrow"
                    :value="u.speed"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target)
                          target.speed = Math.max(
                            50,
                            Number(($event.target as HTMLInputElement).value) || 100
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="100"
                    class="mx-wb-cell-input"
                    :value="u.attack"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target)
                          target.attack = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.1"
                    class="mx-wb-cell-input is-narrow"
                    :value="u.skillRatio"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target)
                          target.skillRatio = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 1
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    class="mx-wb-cell-input is-narrow"
                    :value="u.orbCost"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target)
                          target.orbCost = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    class="mx-wb-cell-input is-narrow"
                    :value="u.orbGain"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target)
                          target.orbGain = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="5"
                    class="mx-wb-cell-input is-narrow"
                    :value="u.pullGaugePct"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.actionUnits.find((x) => x.id === u.id)
                        if (target)
                          target.pullGaugePct = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <button type="button" class="mx-wb-del-btn" @click="removeActionBarUnit(u.id)">
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <table v-else class="mx-wb-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Unit</th>
                <th>SPD</th>
                <th>Orbs</th>
                <th>Pull / Cast</th>
                <th>DMG</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ev in combatRes.actionTimeline"
                :key="ev.actionIndex"
                :class="{ 'is-enemy-row': ev.team === 'enemy', 'is-warn-row': ev.starvedOrb }"
              >
                <td class="mx-mono">#{{ ev.actionIndex }}</td>
                <td>{{ ev.unitName }}</td>
                <td class="mx-mono">{{ ev.speed }}</td>
                <td class="mx-mono">{{ ev.orbsBefore }}→{{ ev.orbsAfter }}</td>
                <td>
                  <span v-if="ev.starvedOrb" class="mx-wb-tag is-bad">NO ORB!</span>
                  <span v-else-if="ev.pulledGaugePct > 0" class="mx-wb-tag is-good"
                    >+{{ ev.pulledGaugePct }}% AV</span
                  >
                  <span v-else>{{ ev.skillCast ? 'Skill' : 'Basic' }}</span>
                </td>
                <td class="mx-mono">{{ ev.damageDealt }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="wb.combatKernel.kernel === 'deck_cycle'">
          <div class="mx-wb-table-toolbar">
            <div class="mx-wb-toolbar-btns">
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'cards' }"
                @click="deckRightView = 'cards'"
              >
                🃏 {{ L('牌库构筑表', 'Deck Designer') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'counter_matrix' }"
                @click="deckRightView = 'counter_matrix'"
              >
                🛡 {{ L('6机制克制矩阵', '6-Boss Counter Matrix') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'removal_roi' }"
                @click="deckRightView = 'removal_roi'"
              >
                ✂ {{ L('删牌精简与定价ROI', 'Card Removal ROI') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'archetype_meta' }"
                @click="deckRightView = 'archetype_meta'"
              >
                ⚖ {{ uiText.tabArchetypeMeta }}
              </button>
            </div>
            <div v-if="deckRightView === 'cards'" class="mx-wb-toolbar-btns">
              <select
                v-if="availableDeckBuiltinCols.length"
                v-model="newDeckColKey"
                class="mx-wb-select is-mini"
              >
                <option v-for="col in availableDeckBuiltinCols" :key="col" :value="col">
                  {{ deckColDropdownLabel(col) }}
                </option>
              </select>
              <input
                v-model="customDeckColName"
                type="text"
                class="mx-wb-cell-input"
                style="width: 64px"
                :placeholder="L('自定义列...', 'Custom col...')"
              />
              <!-- cjk-ok -->
              <button type="button" class="mx-wb-mini-btn" @click="addDeckColumn">
                + {{ L('加列', 'Col') }}
                <!-- cjk-ok -->
              </button>
              <button type="button" class="mx-wb-mini-btn is-accent" @click="addDeckCycleCard">
                + {{ L('新增卡牌', 'Add Card') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :title="L('导入 CSV / Excel 制表符文件', 'Import CSV / TSV')"
                @click="triggerCsvImport('deck')"
              >
                📥 CSV
              </button>
              <!-- cjk-ok -->
              <button
                type="button"
                class="mx-wb-mini-btn"
                :title="L('导出 CSV 文件并复制到剪贴板', 'Export CSV & copy')"
                @click="exportTableCsv('deck')"
              >
                📤 CSV
              </button>
              <!-- cjk-ok -->
            </div>
          </div>
          <table v-if="deckRightView === 'cards'" class="mx-wb-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Cost</th>
                <th>Cnt</th>
                <th v-for="col in activeDeckCols" :key="col">
                  <span class="mx-wb-th-wrap">
                    {{ deckColLabel(col) }}
                    <button
                      v-if="activeDeckCols.length > 1"
                      type="button"
                      class="mx-wb-col-del"
                      :title="L('删除该属性列', 'Remove column')"
                      @click="removeDeckColumn(col)"
                    >
                      ×
                    </button>
                    <!-- cjk-ok -->
                  </span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in wb.combatKernel.deckCards" :key="c.id">
                <td>
                  <input
                    type="text"
                    class="mx-wb-name-input"
                    :value="c.name"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.deckCards.find((x) => x.id === c.id)
                        if (target) target.name = ($event.target as HTMLInputElement).value
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="6"
                    class="mx-wb-cell-input is-narrow"
                    :value="c.cost"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.deckCards.find((x) => x.id === c.id)
                        if (target)
                          target.cost = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    class="mx-wb-cell-input is-narrow"
                    :value="c.count"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.deckCards.find((x) => x.id === c.id)
                        if (target)
                          target.count = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td v-for="col in activeDeckCols" :key="col">
                  <input
                    v-if="isDeckColBool(col)"
                    type="checkbox"
                    :checked="Boolean((c as Record<string, any>)[col])"
                    @change="
                      setDeckCardColVal(c.id, col, ($event.target as HTMLInputElement).checked)
                    "
                  />
                  <input
                    v-else
                    type="number"
                    step="any"
                    class="mx-wb-cell-input is-narrow"
                    :value="getDeckCardColVal(c, col)"
                    @input="
                      setDeckCardColVal(
                        c.id,
                        col,
                        Number(($event.target as HTMLInputElement).value) || 0
                      )
                    "
                  />
                </td>
                <td>
                  <button type="button" class="mx-wb-del-btn" @click="removeDeckCycleCard(c.id)">
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 6-Boss 机制克制矩阵表 -->
          <table v-else-if="deckRightView === 'counter_matrix'" class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ L('Boss 机制', 'Mechanism') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('胜率%', 'Win %') }}</th>
                <!-- cjk-ok -->
                <th>TTK P50</th>
                <th>{{ L('均战损HP', 'HP Lost') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('克制判定', 'Verdict') }}</th>
                <!-- cjk-ok -->
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in counterMatrixRes"
                :key="row.mechanism"
                :class="{
                  'is-enemy-row': row.verdict === 'countered',
                  'is-warn-row': row.verdict === 'skill_check'
                }"
              >
                <td>
                  <strong>{{ isZh ? row.nameZh : row.nameEn }}</strong>
                </td>
                <td class="mx-mono">{{ row.winRatePct }}%</td>
                <td class="mx-mono">{{ row.ttkP50 }}T</td>
                <td class="mx-mono">-{{ row.avgHpLoss }}</td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      row.verdict === 'favored'
                        ? 'is-good'
                        : row.verdict === 'skill_check'
                          ? 'is-warn'
                          : 'is-bad'
                    "
                  >
                    {{
                      row.verdict === 'favored'
                        ? L('优势碾压', 'Favored')
                        : row.verdict === 'skill_check'
                          ? L('机制均势', 'Skill Check')
                          : L('被严重针对', 'Countered!')
                    }}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    class="mx-wb-mini-btn"
                    :class="{
                      'is-accent': (wb.combatKernel.enemyMechanism ?? 'standard') === row.mechanism
                    }"
                    @click="setEnemyMechanism(row.mechanism)"
                  >
                    {{ L('设为当前', 'Test') }}
                    <!-- cjk-ok -->
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 删牌精简 & 诅咒污染边际收益与商店删牌定价表 -->
          <table v-else-if="deckRightView === 'removal_roi'" class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ L('牌库精简/污染档位', 'Deck Thinning / Curse') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('总卡数', 'Deck') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('T1核心上手%', 'T1 Core %') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('胜率 / TTK', 'Win % / TTK') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('省血HP', 'HP Saved') }}</th>
                <!-- cjk-ok -->
                <th>{{ L('商店删牌建议金', 'Fair Gold') }}</th>
                <!-- cjk-ok -->
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in deckRemovalRoiRes"
                :key="r.deltaCards"
                :class="{
                  'is-enemy-row': r.deltaCards > 0,
                  'is-best-row': r.deltaCards === -2
                }"
              >
                <td>{{ isZh ? r.labelZh : r.labelEn }}</td>
                <td class="mx-mono">{{ r.deckSize }}</td>
                <td class="mx-mono">{{ r.turn1CoreDrawPct }}%</td>
                <td class="mx-mono">{{ r.winRatePct }}% ({{ r.ttkP50 }}T)</td>
                <td class="mx-mono">
                  {{ r.hpSavedVsBase > 0 ? `+${r.hpSavedVsBase}` : r.hpSavedVsBase }}
                </td>
                <td class="mx-mono">
                  <span v-if="r.fairShopGoldPrice > 0" class="mx-wb-tag is-good">
                    {{ r.fairShopGoldPrice }}G
                  </span>
                  <span v-else class="mx-mono">-</span>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 商业产品级：4流派天梯多样性与生态平衡矩阵 -->
          <div v-else>
            <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
              <span class="mx-wb-tbl-title">
                {{ uiText.metaScoreLabel }}
                <strong class="mx-mono">{{ archetypeMatrixRes.metaDiversityScore }}/100</strong>
              </span>
              <span
                class="mx-wb-tag"
                :class="
                  archetypeMatrixRes.verdict === 'meta_healthy'
                    ? 'is-good'
                    : archetypeMatrixRes.verdict === 'tier0_monopoly'
                      ? 'is-warn'
                      : 'is-bad'
                "
              >
                {{
                  archetypeMatrixRes.verdict === 'meta_healthy'
                    ? uiText.metaHealthy
                    : archetypeMatrixRes.verdict === 'tier0_monopoly'
                      ? uiText.metaMonopoly
                      : uiText.metaOvertuned
                }}
              </span>
            </div>
            <table class="mx-wb-table">
              <thead>
                <tr>
                  <th>{{ uiText.colArchetype }}</th>
                  <th>Win %</th>
                  <th>TTK P50</th>
                  <th>HP Loss</th>
                  <th>{{ uiText.colMetaShare }}</th>
                  <th>{{ uiText.colTier }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="arc in archetypeMatrixRes.rows"
                  :key="arc.archetypeId"
                  :class="{
                    'is-best-row': arc.archetypeId === 'current_custom',
                    'is-warn-row': arc.tier === 'T0_dominant',
                    'is-enemy-row': arc.tier === 'T3_unplayable'
                  }"
                >
                  <td>
                    <strong>{{ isZh ? arc.nameZh : arc.nameEn }}</strong>
                  </td>
                  <td class="mx-mono">{{ arc.winRatePct }}%</td>
                  <td class="mx-mono">{{ arc.ttkP50 }}T</td>
                  <td class="mx-mono">-{{ arc.avgHpLoss }}</td>
                  <td class="mx-mono">{{ arc.metaSharePct }}%</td>
                  <td>
                    <span
                      class="mx-wb-tag"
                      :class="
                        arc.tier === 'T1_viable'
                          ? 'is-good'
                          : arc.tier === 'T0_dominant' || arc.tier === 'T2_niche'
                            ? 'is-warn'
                            : 'is-bad'
                      "
                    >
                      {{ arc.tier }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-else>
          <div class="mx-wb-table-toolbar">
            <span class="mx-wb-tbl-title">
              💎 {{ L('法力曲线卡组表', 'Mana Curve Deck') }}
              <!-- cjk-ok -->
            </span>
            <div class="mx-wb-toolbar-btns">
              <select
                v-if="availableManaBuiltinCols.length"
                v-model="newManaColKey"
                class="mx-wb-select is-mini"
              >
                <option v-for="col in availableManaBuiltinCols" :key="col" :value="col">
                  {{ manaColDropdownLabel(col) }}
                </option>
              </select>
              <input
                v-model="customManaColName"
                type="text"
                class="mx-wb-cell-input"
                style="width: 64px"
                :placeholder="L('自定义列...', 'Custom col...')"
              />
              <!-- cjk-ok -->
              <button type="button" class="mx-wb-mini-btn" @click="addManaColumn">
                + {{ L('加列', 'Col') }}
                <!-- cjk-ok -->
              </button>
              <button type="button" class="mx-wb-mini-btn is-accent" @click="addManaCurveCard">
                + {{ L('新增卡牌', 'Add Card') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :title="L('导入 CSV / Excel 制表符文件', 'Import CSV / TSV')"
                @click="triggerCsvImport('mana')"
              >
                📥 CSV
              </button>
              <!-- cjk-ok -->
              <button
                type="button"
                class="mx-wb-mini-btn"
                :title="L('导出 CSV 文件并复制到剪贴板', 'Export CSV & copy')"
                @click="exportTableCsv('mana')"
              >
                📤 CSV
              </button>
              <!-- cjk-ok -->
            </div>
          </div>
          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Mana</th>
                <th>Cnt</th>
                <th v-for="col in activeManaCols" :key="col">
                  <span class="mx-wb-th-wrap">
                    {{ manaColLabel(col) }}
                    <button
                      v-if="activeManaCols.length > 1"
                      type="button"
                      class="mx-wb-col-del"
                      :title="L('删除该属性列', 'Remove column')"
                      @click="removeManaColumn(col)"
                    >
                      ×
                    </button>
                    <!-- cjk-ok -->
                  </span>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in wb.combatKernel.manaCurveDeck" :key="c.id">
                <td>
                  <input
                    type="text"
                    class="mx-wb-name-input"
                    :value="c.name"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.manaCurveDeck.find((x) => x.id === c.id)
                        if (target) target.name = ($event.target as HTMLInputElement).value
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    class="mx-wb-cell-input is-narrow"
                    :value="c.manaCost"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.manaCurveDeck.find((x) => x.id === c.id)
                        if (target)
                          target.manaCost = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    class="mx-wb-cell-input is-narrow"
                    :value="c.count"
                    @input="
                      mutateWb((w) => {
                        const target = w.combatKernel.manaCurveDeck.find((x) => x.id === c.id)
                        if (target)
                          target.count = Math.max(
                            0,
                            Number(($event.target as HTMLInputElement).value) || 0
                          )
                      })
                    "
                  />
                </td>
                <td v-for="col in activeManaCols" :key="col">
                  <input
                    v-if="isManaColBool(col)"
                    type="checkbox"
                    :checked="Boolean((c as Record<string, any>)[col])"
                    @change="
                      setManaCardColVal(c.id, col, ($event.target as HTMLInputElement).checked)
                    "
                  />
                  <input
                    v-else
                    type="number"
                    step="any"
                    class="mx-wb-cell-input is-narrow"
                    :value="getManaCardColVal(c, col)"
                    @input="
                      setManaCardColVal(
                        c.id,
                        col,
                        Number(($event.target as HTMLInputElement).value) || 0
                      )
                    "
                  />
                </td>
                <td>
                  <button type="button" class="mx-wb-del-btn" @click="removeManaCurveCard(c.id)">
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═════════════ SUB-TAB 2: 肉鸽战力包络线 vs 关卡难度膨胀墙 ═════════════ -->
    <div v-else-if="activeSubTab === 'envelope'" class="mx-wb-body">
      <div class="mx-wb-left-col">
        <div class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.floorCount }}</span>
            <input
              type="number"
              min="5"
              max="40"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.floors"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.floors =
                      Number(($event.target as HTMLInputElement).value) || 15)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.playerBase }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.playerBasePower"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.playerBasePower =
                      Number(($event.target as HTMLInputElement).value) || 30)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.synergyRate }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.synergyHitRatePct"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.synergyHitRatePct =
                      Number(($event.target as HTMLInputElement).value) || 35)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.synergyMult }}</span>
            <input
              type="number"
              step="0.05"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.synergyMultPerHit"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.synergyMultPerHit =
                      Number(($event.target as HTMLInputElement).value) || 1.25)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.enemyBase }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.enemyBasePower"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.enemyBasePower =
                      Number(($event.target as HTMLInputElement).value) || 25)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.enemyGrowth }}</span>
            <input
              type="number"
              step="0.02"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.enemyGrowthRate"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.enemyGrowthRate =
                      Number(($event.target as HTMLInputElement).value) || 1.22)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.metaBonus }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.metaBonusPerRunPct"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.metaBonusPerRunPct =
                      Number(($event.target as HTMLInputElement).value) || 5)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('精英分岔房率%', 'Elite Room %') }}</span>
            <!-- cjk-ok -->
            <input
              type="number"
              min="0"
              max="80"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.eliteRoomRatePct ?? 25"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.eliteRoomRatePct = Math.max(
                      0,
                      Number(($event.target as HTMLInputElement).value) || 0
                    ))
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('营火睡觉HP阈值%', 'Campfire Rest HP%') }}</span>
            <!-- cjk-ok -->
            <input
              type="number"
              min="10"
              max="90"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.campfireRestHpThresholdPct ?? 55"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.campfireRestHpThresholdPct = Math.max(
                      10,
                      Number(($event.target as HTMLInputElement).value) || 55
                    ))
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('每10金层复利', 'Interest / 10G') }}</span>
            <!-- cjk-ok -->
            <input
              type="number"
              min="0"
              max="5"
              step="0.5"
              class="mx-wb-input"
              :value="wb.roguelikeEnvelope.interestPer10Gold ?? 1"
              @input="
                mutateWb(
                  (w) =>
                    (w.roguelikeEnvelope.interestPer10Gold = Math.max(
                      0,
                      Number(($event.target as HTMLInputElement).value) || 0
                    ))
                )
              "
            />
          </label>
        </div>

        <!-- 肉鸽包络逆向目标求解器 -->
        <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
          <span class="mx-wb-tbl-title">🎯 {{ uiText.goalSeekTitle }}</span>
          <div class="mx-wb-toolbar-btns">
            <span style="font-size: 10px; color: var(--text-muted)">{{
              uiText.targetClearPct
            }}</span>
            <input
              v-model.number="goalSeekClearRate"
              type="number"
              min="5"
              max="95"
              class="mx-wb-cell-input is-narrow"
            />
            <button type="button" class="mx-wb-mini-btn is-accent" @click="runEnvelopeGoalSeek">
              ⚡ {{ uiText.solveGrowthRate }}
            </button>
          </div>
        </div>

        <div class="mx-wb-kpi-strip">
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.firstClear }}</span>
            <strong class="mx-wb-kpi-val is-accent">
              {{ envelopeRes.firstRunClearRatePct }}%
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="
                  deltaClass(envelopeRes.firstRunClearRatePct, baselineSnap.firstRunClearRatePct)
                "
              >
                {{
                  fmtDelta(envelopeRes.firstRunClearRatePct, baselineSnap.firstRunClearRatePct, '%')
                }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.metaRuns }}</span>
            <strong class="mx-wb-kpi-val">
              {{ envelopeRes.metaRunsTo50PctClear }} runs
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="
                  deltaClass(
                    envelopeRes.metaRunsTo50PctClear,
                    baselineSnap.metaRunsTo50PctClear,
                    true
                  )
                "
              >
                {{ fmtDelta(envelopeRes.metaRunsTo50PctClear, baselineSnap.metaRunsTo50PctClear) }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.wallFloors }}</span>
            <strong
              class="mx-wb-kpi-val"
              :class="{ 'is-warn': envelopeRes.difficultyWallFloors.length > 0 }"
            >
              {{
                envelopeRes.difficultyWallFloors.length
                  ? `F${envelopeRes.difficultyWallFloors.join(', F')}`
                  : uiText.none
              }}
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ L('精英敢挑战 / 营火锻造', 'Elite / Smith %') }}</span>
            <!-- cjk-ok -->
            <strong class="mx-wb-kpi-val">
              {{ envelopeRes.eliteChallengeRatePct ?? 0 }}% /
              {{ envelopeRes.campfireUpgradeRatioPct ?? 0 }}%
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{
              L('复利利息 / 贫富极化比', 'Interest / P90÷P10')
            }}</span>
            <!-- cjk-ok -->
            <strong class="mx-wb-kpi-val">
              +{{ envelopeRes.avgInterestGoldEarned ?? 0 }}G ({{
                envelopeRes.snowballPolarizationIndex ?? 1
              }}x)
            </strong>
          </div>
        </div>
      </div>

      <!-- 中间剪刀差包络图（蓝色带：玩家 P10~P90 战力；红虚线：怪物难度膨胀墙） -->
      <div class="mx-wb-chart-box">
        <svg :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="mx-wb-svg">
          <line
            :x1="PAD_L"
            :y1="SVG_H - PAD_B"
            :x2="SVG_W - PAD_R"
            :y2="SVG_H - PAD_B"
            stroke="var(--border)"
          />
          <path :d="envelopeBandPath" fill="#2563eb" fill-opacity="0.2" />
          <polyline
            :points="envelopePlayerP50Line"
            fill="none"
            stroke="#2563eb"
            stroke-width="2.2"
          />
          <polyline
            :points="envelopeEnemyLine"
            fill="none"
            stroke="#dc2626"
            stroke-width="2"
            stroke-dasharray="4 3"
          />
          <text
            :x="PAD_L - 4"
            :y="PAD_T + 8"
            text-anchor="end"
            font-size="9"
            fill="var(--text-muted)"
          >
            {{ envelopeMaxPower }}
          </text>
          <text :x="PAD_L" :y="SVG_H - 5" font-size="9" fill="#2563eb">■ Player P10-P90</text>
          <text :x="SVG_W - PAD_R" :y="SVG_H - 5" text-anchor="end" font-size="9" fill="#dc2626">
            --- Enemy Wall
          </text>
        </svg>
      </div>

      <!-- 右侧逐层对比表 -->
      <div class="mx-wb-table-box">
        <table class="mx-wb-table">
          <thead>
            <tr>
              <th>Floor</th>
              <th>Room</th>
              <th>Enemy</th>
              <th>Player P50 (P10~P90)</th>
              <th>HP% / Gold</th>
              <th>Surv %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="pt in envelopeRes.floorSeries"
              :key="pt.floor"
              :class="{
                'is-warn-row': pt.status === 'difficulty_wall',
                'is-enemy-row': pt.isBoss
              }"
            >
              <td class="mx-mono">{{ pt.isBoss ? `★F${pt.floor}` : `F${pt.floor}` }}</td>
              <td class="mx-mono">
                <span v-if="pt.roomType === 'campfire'" class="mx-wb-tag is-good">🔥Camp</span>
                <span v-else-if="pt.roomType === 'shop'" class="mx-wb-tag is-good">💰Shop</span>
                <span v-else-if="pt.roomType === 'elite_mix'" class="mx-wb-tag is-warn"
                  >⚔Elite</span
                >
                <span v-else-if="pt.roomType === 'boss'" class="mx-wb-tag is-bad">👑Boss</span>
                <span v-else>Mob</span>
              </td>
              <td class="mx-mono">{{ pt.enemyPower }}</td>
              <td class="mx-mono">{{ pt.playerP50 }} ({{ pt.playerP10 }}~{{ pt.playerP90 }})</td>
              <td class="mx-mono">{{ pt.avgHpPct ?? 100 }}% / {{ pt.avgGold ?? 0 }}G</td>
              <td class="mx-mono">{{ pt.survivalRatePct }}%</td>
              <td>
                <span v-if="pt.status === 'difficulty_wall'" class="mx-wb-tag is-bad">WALL!</span>
                <span v-else-if="pt.status === 'runaway_trivial'" class="mx-wb-tag is-warn"
                  >TRIVIAL</span
                >
                <span v-else class="mx-wb-tag is-good">OK</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ═════════════ SUB-TAB 3: 乘区边际收益与实体配表超模审计 ═════════════ -->
    <div v-else-if="activeSubTab === 'multiplier'" class="mx-wb-body">
      <div class="mx-wb-left-col">
        <div class="mx-wb-param-grid">
          <label v-for="attr in wb.multiplier.attributes" :key="attr.id" class="mx-wb-field">
            <span>{{ attr.name }} ({{ attr.label }})</span>
            <input
              type="number"
              step="any"
              class="mx-wb-input"
              :value="attr.value"
              @input="
                mutateWb((w) => {
                  const target = w.multiplier.attributes.find((x) => x.id === attr.id)
                  if (target) target.value = Number(($event.target as HTMLInputElement).value) || 0
                })
              "
            />
          </label>
        </div>

        <div class="mx-wb-formula-row">
          <label class="mx-wb-field" style="flex: 1">
            <span>{{ uiText.budgetFormula }}</span>
            <input
              type="text"
              class="mx-wb-input mx-mono"
              :value="wb.multiplier.expectedBudgetFormula"
              @input="
                mutateWb((w) => {
                  w.multiplier.expectedBudgetFormula = ($event.target as HTMLInputElement).value
                })
              "
            />
          </label>
          <label class="mx-wb-field" style="flex: 1.4">
            <span>{{ uiText.actualFormula }}</span>
            <input
              type="text"
              class="mx-wb-input mx-mono"
              :value="wb.multiplier.entityValueFormula"
              @input="
                mutateWb((w) => {
                  w.multiplier.entityValueFormula = ($event.target as HTMLInputElement).value
                })
              "
            />
          </label>
        </div>

        <div class="mx-wb-kpi-strip">
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.finalOutput }}</span>
            <strong class="mx-wb-kpi-val is-accent">
              {{ multRes.finalOutput }}
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="deltaClass(multRes.finalOutput, baselineSnap.finalOutput)"
              >
                {{ fmtDelta(multRes.finalOutput, baselineSnap.finalOutput) }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.bestNextAttr }}</span>
            <strong class="mx-wb-kpi-val">
              {{ multRes.marginalReturns.find((m) => m.isOptimalNextPick)?.attrName ?? '-' }}
              (+{{
                multRes.marginalReturns.find((m) => m.isOptimalNextPick)?.marginalRoiPct ?? 0
              }}%)
            </strong>
          </div>
        </div>
      </div>

      <!-- 中间：各属性边际收益率对比与乘区阶段编辑表 -->
      <div class="mx-wb-table-box">
        <div class="mx-wb-table-toolbar">
          <span class="mx-wb-tbl-title">
            📈 {{ L('属性乘区与边际收益 (ROI)', 'Stat Multipliers & ROI') }}
            <!-- cjk-ok -->
          </span>
          <div class="mx-wb-toolbar-btns">
            <input
              v-model="newMultAttrName"
              type="text"
              class="mx-wb-cell-input"
              style="width: 68px"
              :placeholder="L('新属性名...', 'New stat...')"
            />
            <!-- cjk-ok -->
            <button type="button" class="mx-wb-mini-btn is-accent" @click="addMultiplierAttribute">
              + {{ L('加属性', 'Stat') }}
              <!-- cjk-ok -->
            </button>
            <button type="button" class="mx-wb-mini-btn" @click="addMultiplierStage">
              + {{ L('加乘区', 'Stage') }}
              <!-- cjk-ok -->
            </button>
          </div>
        </div>
        <table class="mx-wb-table">
          <thead>
            <tr>
              <th>Stat</th>
              <th>Value</th>
              <th>+1 Budget</th>
              <th>New Out</th>
              <th>ROI</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in multRes.marginalReturns"
              :key="m.attrName"
              :class="{ 'is-best-row': m.isOptimalNextPick }"
            >
              <td class="mx-mono">
                <strong>{{ m.attrName }}</strong>
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  class="mx-wb-cell-input"
                  :value="m.currentValue"
                  @input="
                    mutateWb((w) => {
                      const target = w.multiplier.attributes.find((x) => x.name === m.attrName)
                      if (target)
                        target.value = Number(($event.target as HTMLInputElement).value) || 0
                    })
                  "
                />
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  class="mx-wb-cell-input is-narrow"
                  :value="m.stepDelta"
                  @input="
                    mutateWb((w) => {
                      const target = w.multiplier.attributes.find((x) => x.name === m.attrName)
                      if (target)
                        target.stepPerBudget = Math.max(
                          0.001,
                          Number(($event.target as HTMLInputElement).value) || 0.1
                        )
                    })
                  "
                />
              </td>
              <td class="mx-mono">{{ m.boostedOutput }}</td>
              <td class="mx-mono">
                <span class="mx-wb-tag" :class="m.isOptimalNextPick ? 'is-good' : ''">
                  +{{ m.marginalRoiPct }}%
                </span>
              </td>
              <td>
                <button
                  v-if="wb.multiplier.attributes.length > 1"
                  type="button"
                  class="mx-wb-del-btn"
                  @click="removeMultiplierAttribute(m.attrName)"
                >
                  ×
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 乘区阶段公式内联编辑 -->
        <div class="mx-wb-stage-list">
          <div v-for="st in wb.multiplier.stages" :key="st.id" class="mx-wb-stage-row">
            <input
              type="text"
              class="mx-wb-cell-input mx-mono"
              style="width: 72px; text-align: left"
              :value="st.name"
              @input="
                mutateWb((w) => {
                  const target = w.multiplier.stages.find((x) => x.id === st.id)
                  if (target) target.name = ($event.target as HTMLInputElement).value.trim()
                })
              "
            />
            <span>=</span>
            <input
              type="text"
              class="mx-wb-input mx-mono"
              style="flex: 1; height: 20px"
              :value="st.formula"
              @input="
                mutateWb((w) => {
                  const target = w.multiplier.stages.find((x) => x.id === st.id)
                  if (target) target.formula = ($event.target as HTMLInputElement).value
                })
              "
            />
            <span class="mx-mono" style="color: var(--accent)"
              >({{ multRes.stageValues[st.name] ?? 0 }})</span
            >
            <button
              v-if="wb.multiplier.stages.length > 1"
              type="button"
              class="mx-wb-del-btn"
              @click="removeMultiplierStage(st.id)"
            >
              ×
            </button>
          </div>
          <div class="mx-wb-stage-row">
            <strong class="mx-mono" style="width: 72px">FinalOut</strong>
            <span>=</span>
            <input
              type="text"
              class="mx-wb-input mx-mono"
              style="flex: 1; height: 20px"
              :value="wb.multiplier.finalFormula"
              @input="
                mutateWb(
                  (w) => (w.multiplier.finalFormula = ($event.target as HTMLInputElement).value)
                )
              "
            />
          </div>
        </div>
      </div>

      <!-- 右侧：卡牌/随从/式神配表超模审计与交互设计表 -->
      <div class="mx-wb-table-box" style="flex: 1.45">
        <div class="mx-wb-table-toolbar">
          <span class="mx-wb-tbl-title">
            🃏 {{ L('卡牌/单位配表设计器', 'Card / Unit Budget Designer') }}
            <!-- cjk-ok -->
          </span>
          <div class="mx-wb-toolbar-btns">
            <input
              v-model="newAuditColName"
              type="text"
              class="mx-wb-cell-input"
              style="width: 68px"
              :placeholder="L('新列名(如poison)', 'Col name...')"
            />
            <!-- cjk-ok -->
            <input
              v-model="newAuditColWeight"
              type="number"
              step="0.5"
              class="mx-wb-cell-input is-narrow"
              :title="
                L('该属性每 1 点的价值权重（自动追加到价值公式）', 'Formula weight per point')
              "
            />
            <!-- cjk-ok -->
            <button type="button" class="mx-wb-mini-btn" @click="addAuditStatColumn">
              + {{ L('加列', 'Col') }}
              <!-- cjk-ok -->
            </button>
            <button type="button" class="mx-wb-mini-btn" @click="addAuditEntity">
              + {{ L('加卡', 'Card') }}
              <!-- cjk-ok -->
            </button>
            <button type="button" class="mx-wb-mini-btn is-accent" @click="autoBalanceAllEntities">
              ⚖ {{ L('自动配平', 'Balance') }}
              <!-- cjk-ok -->
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              @click="syncAuditEntitiesToCombatDeck(true)"
            >
              ⇄ {{ L('送入战斗', 'To Combat') }}
              <!-- cjk-ok -->
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :title="L('导入 CSV / Excel 制表符文件', 'Import CSV / TSV')"
              @click="triggerCsvImport('audit')"
            >
              📥 CSV
            </button>
            <!-- cjk-ok -->
            <button
              type="button"
              class="mx-wb-mini-btn"
              :title="L('导出 CSV 文件并复制到剪贴板', 'Export CSV & copy')"
              @click="exportTableCsv('audit')"
            >
              📤 CSV
            </button>
            <!-- cjk-ok -->
          </div>
        </div>
        <table class="mx-wb-table">
          <thead>
            <tr>
              <th>Card / Entity</th>
              <th>Cost</th>
              <th v-for="col in wb.multiplier.statColumns" :key="col">
                <div class="mx-wb-th-col">
                  <span class="mx-wb-th-wrap">
                    {{ col }}
                    <button
                      v-if="wb.multiplier.statColumns.length > 1"
                      type="button"
                      class="mx-wb-col-del"
                      :title="L('删除该属性列', 'Remove column')"
                      @click="removeAuditStatColumn(col)"
                    >
                      ×
                    </button>
                    <!-- cjk-ok -->
                  </span>
                  <label
                    class="mx-wb-th-weight"
                    :title="
                      L('表头直接调价值权重（实时同步上方公式）', 'Adjust column weight in formula')
                    "
                  >
                    <!-- cjk-ok -->
                    <span>×</span>
                    <input
                      type="number"
                      step="0.5"
                      class="mx-wb-weight-input"
                      :value="getAuditColWeight(col)"
                      @input="
                        setAuditColWeight(
                          col,
                          Number(($event.target as HTMLInputElement).value) || 0
                        )
                      "
                    />
                  </label>
                </div>
              </th>
              <th>Exp</th>
              <th>Act</th>
              <th>Audit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(ent, idx) in wb.multiplier.entities"
              :key="ent.id"
              :class="{
                'is-warn-row': multRes.entityAudits[idx]?.verdict === 'overpowered',
                'is-enemy-row': multRes.entityAudits[idx]?.verdict === 'underpowered'
              }"
            >
              <td>
                <input
                  type="text"
                  class="mx-wb-name-input"
                  :value="ent.name"
                  @input="
                    mutateWb((w) => {
                      const target = w.multiplier.entities.find((x) => x.id === ent.id)
                      if (target) target.name = ($event.target as HTMLInputElement).value
                    })
                  "
                />
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  class="mx-wb-cell-input is-narrow"
                  :value="ent.cost"
                  @input="
                    mutateWb((w) => {
                      const target = w.multiplier.entities.find((x) => x.id === ent.id)
                      if (target)
                        target.cost = Number(($event.target as HTMLInputElement).value) || 0
                    })
                  "
                />
              </td>
              <td v-for="col in wb.multiplier.statColumns" :key="col">
                <input
                  type="number"
                  step="any"
                  class="mx-wb-cell-input is-narrow"
                  :value="ent.stats[col] ?? 0"
                  @input="
                    mutateWb((w) => {
                      const target = w.multiplier.entities.find((x) => x.id === ent.id)
                      if (target)
                        target.stats[col] = Number(($event.target as HTMLInputElement).value) || 0
                    })
                  "
                />
              </td>
              <td class="mx-mono">{{ multRes.entityAudits[idx]?.expectedValue ?? 0 }}</td>
              <td class="mx-mono">{{ multRes.entityAudits[idx]?.actualValue ?? 0 }}</td>
              <td class="mx-mono">
                <span
                  v-if="multRes.entityAudits[idx]"
                  class="mx-wb-tag"
                  :class="
                    multRes.entityAudits[idx]!.verdict === 'overpowered'
                      ? 'is-bad'
                      : multRes.entityAudits[idx]!.verdict === 'underpowered'
                        ? 'is-warn'
                        : 'is-good'
                  "
                >
                  {{
                    multRes.entityAudits[idx]!.deviationPct > 0
                      ? `+${multRes.entityAudits[idx]!.deviationPct}%`
                      : `${multRes.entityAudits[idx]!.deviationPct}%`
                  }}
                </span>
              </td>
              <td>
                <button type="button" class="mx-wb-del-btn" @click="removeAuditEntity(ent.id)">
                  ×
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ═════════════ SUB-TAB 4: 抽卡保底 / 御魂副属性强化 / 肉鸽三选一词条池 ═════════════ -->
    <div v-else class="mx-wb-body">
      <div class="mx-wb-left-col">
        <div class="mx-wb-mode-bar">
          <button
            type="button"
            class="mx-wb-mode-pill"
            :class="{ 'is-active': wb.lootRoll.mode === 'gacha_pity' }"
            @click="setLootMode('gacha_pity')"
          >
            🎴 {{ uiText.modeGacha }}
          </button>
          <button
            type="button"
            class="mx-wb-mode-pill"
            :class="{ 'is-active': wb.lootRoll.mode === 'substat_enhance' }"
            @click="setLootMode('substat_enhance')"
          >
            🔮 {{ uiText.modeSubstat }}
          </button>
          <button
            type="button"
            class="mx-wb-mode-pill"
            :class="{ 'is-active': wb.lootRoll.mode === 'roguelike_draft' }"
            @click="setLootMode('roguelike_draft')"
          >
            🎲 {{ uiText.modeDraft }}
          </button>
        </div>

        <div v-if="wb.lootRoll.mode === 'gacha_pity'" class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.baseRate }}</span>
            <input
              type="number"
              step="0.1"
              class="mx-wb-input"
              :value="wb.lootRoll.baseSsrRatePct"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.baseSsrRatePct =
                      Number(($event.target as HTMLInputElement).value) || 1)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.softPity }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.lootRoll.softPityStart"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.softPityStart =
                      Number(($event.target as HTMLInputElement).value) || 50)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.hardPity }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.lootRoll.hardPityPull"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.hardPityPull =
                      Number(($event.target as HTMLInputElement).value) || 90)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.targetCopies }}</span>
            <input
              type="number"
              min="1"
              max="7"
              class="mx-wb-input"
              :value="wb.lootRoll.targetCopies"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.targetCopies =
                      Number(($event.target as HTMLInputElement).value) || 1)
                )
              "
            />
          </label>
        </div>

        <div v-else-if="wb.lootRoll.mode === 'substat_enhance'" class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.targetSubstat }}</span>
            <input
              type="text"
              class="mx-wb-input mx-mono"
              :value="wb.lootRoll.targetSubstatName"
              @input="
                mutateWb(
                  (w) => (w.lootRoll.targetSubstatName = ($event.target as HTMLInputElement).value)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.targetThresh }}</span>
            <input
              type="number"
              step="0.5"
              class="mx-wb-input"
              :value="wb.lootRoll.targetSubstatThreshold"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.targetSubstatThreshold =
                      Number(($event.target as HTMLInputElement).value) || 15)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.fourLineRate }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.lootRoll.fourLineInitRatePct"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.fourLineInitRatePct =
                      Number(($event.target as HTMLInputElement).value) || 20)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.staminaCost }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.lootRoll.staminaPerDrop"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.staminaPerDrop =
                      Number(($event.target as HTMLInputElement).value) || 12)
                )
              "
            />
          </label>
        </div>

        <div v-else class="mx-wb-param-grid">
          <label class="mx-wb-field">
            <span>{{ uiText.synergyTag }}</span>
            <input
              type="text"
              class="mx-wb-input mx-mono"
              :value="wb.lootRoll.targetSynergyTag"
              @input="
                mutateWb(
                  (w) => (w.lootRoll.targetSynergyTag = ($event.target as HTMLInputElement).value)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.synergyPieces }}</span>
            <input
              type="number"
              min="1"
              max="10"
              class="mx-wb-input"
              :value="wb.lootRoll.targetSynergyCount"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.targetSynergyCount =
                      Number(($event.target as HTMLInputElement).value) || 4)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.tagAffinity }}</span>
            <input
              type="number"
              class="mx-wb-input"
              :value="wb.lootRoll.tagAffinityBonusPct"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.tagAffinityBonusPct =
                      Number(($event.target as HTMLInputElement).value) || 0)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ uiText.rerollsWave }}</span>
            <input
              type="number"
              min="0"
              max="6"
              class="mx-wb-input"
              :value="wb.lootRoll.rerollsPerWave"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.rerollsPerWave =
                      Number(($event.target as HTMLInputElement).value) || 0)
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('竞争流派池数', 'Archetype Pool') }}</span>
            <!-- cjk-ok -->
            <input
              type="number"
              min="2"
              max="12"
              class="mx-wb-input"
              :value="wb.lootRoll.competingArchetypes ?? 5"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.competingArchetypes = Math.max(
                      2,
                      Number(($event.target as HTMLInputElement).value) || 5
                    ))
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('禁用Ban位数', 'Ban Slots') }}</span>
            <!-- cjk-ok -->
            <input
              type="number"
              min="0"
              max="5"
              class="mx-wb-input"
              :value="wb.lootRoll.banSlotsCount ?? 1"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.banSlotsCount = Math.max(
                      0,
                      Number(($event.target as HTMLInputElement).value) || 0
                    ))
                )
              "
            />
          </label>
          <label class="mx-wb-field">
            <span>{{ L('未中保底加权%', 'Miss Pity +%') }}</span>
            <!-- cjk-ok -->
            <input
              type="number"
              min="0"
              max="60"
              class="mx-wb-input"
              :value="wb.lootRoll.pityMissStreakBoostPct ?? 15"
              @input="
                mutateWb(
                  (w) =>
                    (w.lootRoll.pityMissStreakBoostPct = Math.max(
                      0,
                      Number(($event.target as HTMLInputElement).value) || 0
                    ))
                )
              "
            />
          </label>
        </div>

        <div class="mx-wb-kpi-strip">
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.hitRate }}</span>
            <strong class="mx-wb-kpi-val is-accent">
              {{ lootRes.successRatePct }}%
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="deltaClass(lootRes.successRatePct, baselineSnap.lootSuccessRatePct)"
              >
                {{ fmtDelta(lootRes.successRatePct, baselineSnap.lootSuccessRatePct, '%') }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.attemptsP50 }}</span>
            <strong class="mx-wb-kpi-val">
              {{ lootRes.attemptsP50 }} ({{ lootRes.attemptsP10 }}~{{ lootRes.attemptsP90 }})
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ uiText.expectedCost }}</span>
            <strong class="mx-wb-kpi-val">
              {{ lootRes.costP50 }} ({{ lootRes.costMean }})
              <span
                v-if="baselineSnap"
                class="mx-wb-delta"
                :class="deltaClass(lootRes.costP50, baselineSnap.lootCostP50, true)"
              >
                {{ fmtDelta(lootRes.costP50, baselineSnap.lootCostP50) }}
              </span>
            </strong>
          </div>
          <div class="mx-wb-kpi-box">
            <span class="mx-wb-kpi-lbl">{{ lootRes.secondaryMetricLabel }}</span>
            <strong class="mx-wb-kpi-val">{{ lootRes.secondaryMetricMean }}</strong>
          </div>
        </div>
      </div>

      <!-- 右侧分布直方图与扩池稀释/Ban位矩阵切换 -->
      <div class="mx-wb-table-box" style="flex: 1.4">
        <div class="mx-wb-table-toolbar">
          <div class="mx-wb-toolbar-btns">
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'histogram' }"
              @click="lootRightView = 'histogram'"
            >
              📊 {{ L('分布直方图', 'Distribution Histogram') }}
              <!-- cjk-ok -->
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'dilution' }"
              @click="lootRightView = 'dilution'"
            >
              🧪 {{ L('扩池稀释与Ban位补偿表', 'Pool Dilution & Ban-Slot Matrix') }}
              <!-- cjk-ok -->
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'commercial_cohorts' }"
              @click="lootRightView = 'commercial_cohorts'"
            >
              💰 {{ uiText.tabCommercialCohort }}
            </button>
          </div>
        </div>
        <table v-if="lootRightView === 'histogram'" class="mx-wb-table">
          <thead>
            <tr>
              <th>Bucket / Tier</th>
              <th>Samples</th>
              <th>Share %</th>
              <th>Distribution Bar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in lootRes.histogram" :key="b.bucketLabel">
              <td class="mx-mono">{{ b.bucketLabel }}</td>
              <td class="mx-mono">{{ b.count }}</td>
              <td class="mx-mono">{{ b.pct }}%</td>
              <td style="width: 45%">
                <div class="mx-wb-bar-track">
                  <div
                    class="mx-wb-bar-fill"
                    :style="{ width: `${Math.min(100, b.pct * 1.6)}%` }"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <table v-else-if="lootRightView === 'dilution'" class="mx-wb-table">
          <thead>
            <tr>
              <th>{{ L('流派池总数', 'Archetypes') }}</th>
              <!-- cjk-ok -->
              <th>{{ L('有效词条池', 'Pool Size') }}</th>
              <!-- cjk-ok -->
              <th>{{ L('无Ban成型率%', 'No-Ban %') }}</th>
              <!-- cjk-ok -->
              <th>{{ L(`开Ban+保底成型%`, 'With Ban %') }}</th>
              <!-- cjk-ok -->
              <th>{{ L('期望刷新金', 'Exp. Gold') }}</th>
              <!-- cjk-ok -->
              <th>{{ L('稀释诊断', 'Verdict') }}</th>
              <!-- cjk-ok -->
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in poolDilutionRes"
              :key="row.archetypesCount"
              :class="{
                'is-best-row': row.archetypesCount === (wb.lootRoll.competingArchetypes ?? 5),
                'is-warn-row': row.verdict === 'diluted',
                'is-enemy-row': row.verdict === 'collapsed'
              }"
            >
              <td class="mx-mono">
                <strong>{{ row.archetypesCount }} {{ L('大流派', 'Pools') }}</strong>
                <!-- cjk-ok -->
              </td>
              <td class="mx-mono">{{ row.effectivePoolSize }}</td>
              <td class="mx-mono">{{ row.noBanCompletionPct }}%</td>
              <td class="mx-mono">
                <strong>{{ row.withBanCompletionPct }}%</strong>
              </td>
              <td class="mx-mono">{{ row.expectedGoldCost }}G</td>
              <td>
                <span
                  class="mx-wb-tag"
                  :class="
                    row.verdict === 'healthy'
                      ? 'is-good'
                      : row.verdict === 'diluted'
                        ? 'is-warn'
                        : 'is-bad'
                  "
                >
                  {{
                    row.verdict === 'healthy'
                      ? L('成型健康', 'Healthy')
                      : row.verdict === 'diluted'
                        ? L('池稀释需Ban', 'Diluted')
                        : L('严重卡池崩塌', 'Collapsed')
                  }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <!-- 商业产品级：玩家付费分层（F2P/小R/中R/大R）留存卡点与毕业周期遥测表 -->
        <div v-else>
          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
            <span class="mx-wb-tbl-title">
              {{ uiText.pityElasticityLbl }}
              <strong class="mx-mono">{{ commercialCohortRes.pityElasticityScore }}/100</strong>
              · {{ uiText.whaleRatioLbl }}
              <strong class="mx-mono">{{ commercialCohortRes.whaleToF2pProgressRatio }}x</strong>
              · {{ uiText.blendedArpuLbl }}
              <strong class="mx-mono">${{ commercialCohortRes.estimatedBlendedArpuUsd }}</strong>
            </span>
          </div>
          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colCohort }}</th>
                <th>{{ uiText.colSpend }}</th>
                <th>{{ uiText.colDailyTries }}</th>
                <th>{{ uiText.colGradDays }}</th>
                <th>{{ uiText.colDay30Rate }}</th>
                <th>{{ uiText.colChurnRisk }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in commercialCohortRes.cohorts"
                :key="c.cohortId"
                :class="{
                  'is-best-row': c.cohortId === 'minnow_pass',
                  'is-warn-row': c.frustrationChokeRisk === 'moderate',
                  'is-enemy-row': c.frustrationChokeRisk === 'high_churn'
                }"
              >
                <td>
                  <strong>{{ isZh ? c.nameZh : c.nameEn }}</strong>
                </td>
                <td class="mx-mono">${{ c.monthlySpendUsd }}</td>
                <td class="mx-mono">{{ c.dailyAttempts }}/d</td>
                <td class="mx-mono">{{ c.daysToGraduateP50 }}d / {{ c.daysToGraduateP90 }}d</td>
                <td class="mx-mono">
                  <strong>{{ c.day30GraduationRatePct }}%</strong>
                </td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      c.frustrationChokeRisk === 'low'
                        ? 'is-good'
                        : c.frustrationChokeRisk === 'moderate'
                          ? 'is-warn'
                          : 'is-bad'
                    "
                  >
                    {{
                      c.frustrationChokeRisk === 'low'
                        ? uiText.riskLow
                        : c.frustrationChokeRisk === 'moderate'
                          ? uiText.riskMod
                          : uiText.riskHigh
                    }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mx-wb-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font-size: 11px;
}

.mx-wb-header {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.mx-wb-presets,
.mx-wb-subtabs {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mx-wb-bridge-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 7%, var(--bg-panel));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
}

.mx-wb-bridge-group {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mx-wb-bridge-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.mx-wb-bridge-tag.is-in {
  background: rgba(34, 197, 94, 0.16);
  color: #22c55e;
}

.mx-wb-bridge-tag.is-out {
  background: rgba(59, 130, 246, 0.18);
  color: #60a5fa;
}

.mx-wb-bridge-arrow {
  color: var(--text-muted);
  font-weight: 700;
}

.mx-wb-select {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  max-width: 195px;
}

.mx-wb-mini-btn {
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.mx-wb-mini-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.mx-wb-mini-btn.is-accent {
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  color: var(--accent);
}

.mx-wb-bridge-chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  margin-left: 4px;
}

.mx-wb-bridge-feedback {
  font-size: 10px;
  font-weight: 600;
  color: #22c55e;
  margin-left: auto;
}

.mx-wb-preset-lbl {
  font-weight: 700;
  color: var(--text-muted);
  margin-right: 2px;
}

.mx-wb-preset-btn,
.mx-wb-subtab,
.mx-wb-mode-pill {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.mx-wb-preset-btn:hover,
.mx-wb-subtab:hover,
.mx-wb-mode-pill:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.mx-wb-preset-btn.is-active,
.mx-wb-subtab.is-active,
.mx-wb-mode-pill.is-active {
  border-color: var(--accent);
  background: var(--accent-12);
  color: var(--accent);
}

.mx-wb-sync-btn {
  margin-left: auto;
  padding: 3px 9px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.mx-wb-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  overflow: auto;
}

.mx-wb-left-col {
  flex: 1.25;
  min-width: 290px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mx-wb-mode-bar {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.mx-wb-param-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 5px;
}

.mx-wb-formula-row {
  display: flex;
  gap: 6px;
}

.mx-wb-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-muted);
  font-size: 10px;
}

.mx-wb-input {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
}

.mx-wb-kpi-strip {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mx-wb-kpi-box {
  flex: 1;
  min-width: 82px;
  padding: 4px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
}

.mx-wb-kpi-lbl {
  font-size: 9px;
  color: var(--text-muted);
}

.mx-wb-kpi-val {
  font-size: 12px;
  color: var(--text);
}

.mx-wb-kpi-val.is-accent {
  color: var(--accent);
}

.mx-wb-kpi-val.is-warn {
  color: #dc2626;
}

.mx-wb-advisory {
  padding: 4px 8px;
  border-radius: 5px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: var(--text);
  font-size: 10px;
}

.mx-wb-chart-box {
  flex: 1.05;
  min-width: 240px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
}

.mx-wb-svg {
  width: 100%;
  height: 100%;
  max-height: 145px;
}

.mx-wb-table-box {
  flex: 1.15;
  min-width: 250px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  overflow: auto;
}

.mx-wb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.mx-wb-table th,
.mx-wb-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.mx-wb-table th {
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 10px;
}

.mx-wb-cell-input {
  width: 44px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  text-align: center;
}

.mx-wb-cell-input.is-narrow {
  width: 36px;
  padding: 0 2px;
}

.mx-wb-name-input {
  width: 102px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
}

.mx-wb-name-input:hover,
.mx-wb-name-input:focus {
  border-color: var(--border);
  background: var(--bg-input);
}

.mx-wb-table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  position: sticky;
  top: 0;
  z-index: 2;
}

.mx-wb-tbl-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
}

.mx-wb-toolbar-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mx-wb-del-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}

.mx-wb-del-btn:hover {
  color: #ef4444;
}

.mx-wb-th-wrap {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.mx-wb-col-del {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.65;
}

.mx-wb-col-del:hover {
  color: #ef4444;
  opacity: 1;
}

.mx-wb-select.is-mini {
  max-width: 110px;
  font-size: 10px;
  padding: 1px 4px;
}

.is-best-row {
  background: rgba(16, 185, 129, 0.12);
}

.is-warn-row {
  background: rgba(239, 68, 68, 0.12);
}

.is-enemy-row {
  background: rgba(245, 158, 11, 0.1);
}

.mx-wb-tag {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.mx-wb-tag.is-good {
  background: rgba(16, 185, 129, 0.18);
  color: #10b981;
}

.mx-wb-tag.is-bad {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.mx-wb-tag.is-warn {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.mx-wb-bar-track {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-panel);
  overflow: hidden;
}

.mx-wb-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
}

.mx-wb-header-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mx-wb-cascade-btn {
  padding: 3px 8px;
  border: 1px solid #f59e0b;
  border-radius: 5px;
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.mx-wb-cascade-btn:hover {
  background: rgba(245, 158, 11, 0.28);
}

.mx-wb-delta {
  display: inline-block;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}

.mx-wb-delta.is-good {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
}

.mx-wb-delta.is-bad {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.mx-wb-delta.is-neutral {
  background: rgba(148, 163, 184, 0.18);
  color: var(--text-muted);
}

.mx-wb-th-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mx-wb-th-weight {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  color: var(--text-muted);
  font-weight: 500;
}

.mx-wb-weight-input {
  width: 32px;
  height: 15px;
  padding: 0 2px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-input);
  color: var(--accent);
  font-size: 9px;
  text-align: center;
}

.mx-wb-stage-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.mx-wb-stage-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
}

.mx-wb-user-preset-pill {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
</style>
