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
  analyzeMxCardUpgradeRoiAndDeckDoctor,
  analyzeMxHypergeometricDrawAndComboOdds,
  analyzeMxSynergyAndInfiniteLoopRisk,
  applyMxInfiniteLoopCircuitBreaker,
  applyMxTopCardUpgrades,
  applyMxWorkbenchDeltaPatchFromPrompt,
  autoBalanceWorkbenchEntities,
  computeMxWorkbenchSnapshotDiff,
  createMxWorkbenchPreset,
  exportMxChapterNumericalSlice,
  exportMxCommercialQaReportMarkdown,
  exportMxNarrativeProgressionBrief,
  exportMxWorkbenchRuntimeCode,
  exportWorkbenchToGameDataTables,
  generateMxBattlePassAndPackTable,
  generateMxEquipmentUpgradeMatrix,
  generateMxLevelProgressionTable,
  getMxCanonicalArchetypeDeck,
  isMxDeltaPatchPrompt,
  mxShouldUseAtbEngine,
  mxShouldUseEffectEngine,
  mxShouldUseEffectEngineForMana,
  MX_WORKBENCH_PRESETS,
  runMxArchetypeBalanceMatrix,
  runMxAscensionLadderAudit,
  runMxCombatKernelSimulation,
  runMxCommercialCohortAnalysis,
  runMxDeckRemovalRoiAnalysis,
  runMxEncounterCounterMatrix,
  runMxLootAndSubstatSimulation,
  runMxPoolDilutionAnalysis,
  runMxRoguelikeEnvelopeSimulation,
  runMxSensitivityTornado,
  simulateMxExtendedCardGenreMatrices,
  simulateMxBossIntentTimelineAndPollution,
  simulateMxJokerSlotOrderAndPlanetTable,
  simulateMxPvpMatchupAndNashEquilibrium,
  solveMxCombatTargetGoalSeek,
  solveMxEnvelopeTargetGoalSeek,
  solveMxSingleTurnLethalAndOrderSkill,
  type MxCombatKernelKind,
  type MxEnemyMechanismKind,
  type MxLootRollMode,
  type MxNumericalWorkbench,
  type MxRelicTriggerPreset,
  type MxWorkbenchPresetId
} from '@shared/gameAssets'
import { useMxStudioStore } from './mxStudioStore'
import MxCardDesignLabPanel from './MxCardDesignLabPanel.vue'

const { locale } = useI18n()
const s = useMxStudioStore()

const isZh = computed(() => String(locale.value).startsWith('zh'))
function L(zh: string, en: string): string {
  return isZh.value ? zh : en
}

const activeSubTab = ref<'combat' | 'envelope' | 'multiplier' | 'loot' | 'card_lab'>('combat')
const aiPromptBarOpen = ref(false)
const wbExportMenuOpen = ref(false)
const syncCanvasOnPreset = ref(true)
const liveFollowStep = ref(false)
const selectedCanvasSourceNodeId = ref('')
const selectedWorkbenchTargetAttr = ref('')
const selectedWorkbenchOutputKey = ref<'damage' | 'winRate' | 'ttk' | 'lootCost' | 'clearRate'>(
  'damage'
)
const selectedCanvasTargetNodeId = ref('')
const bridgeFeedback = ref('')
const oneSentencePrompt = ref('')

function runOneSentenceWorkbench(): void {
  const prompt = oneSentencePrompt.value.trim()
  if (!prompt) return
  if (isMxDeltaPatchPrompt(prompt)) {
    runOneSentenceDeltaPatch()
    return
  }
  const res = s.applyWorkbenchPrompt(prompt, syncCanvasOnPreset.value)
  bridgeFeedback.value = L(
    `已根据「${prompt}」一键生成整套数值体系 (${res.activePresetId})`, // cjk-ok
    `Synthesized full numerical suite from "${prompt}" (${res.activePresetId})`
  )
}

function runOneSentenceDeltaPatch(): void {
  const prompt = oneSentencePrompt.value.trim()
  if (!prompt) return
  if (!pinnedBaselineWb.value) {
    pinnedBaselineWb.value = JSON.parse(JSON.stringify(wb.value))
  }
  const patched = applyMxWorkbenchDeltaPatchFromPrompt(wb.value, prompt)
  s.mutate((d) => {
    d.workbench = patched.workbench
  }, 'wbDeltaPatch')
  bridgeFeedback.value = isZh.value ? patched.summaryZh : patched.summaryEn
}

function runCircuitBreaker(): void {
  if (!pinnedBaselineWb.value) {
    pinnedBaselineWb.value = JSON.parse(JSON.stringify(wb.value))
  }
  let count = 0
  mutateWb((w) => {
    count = applyMxInfiniteLoopCircuitBreaker(w)
  }, 'wbCircuitBreaker')
  bridgeFeedback.value = L(
    `🛡️ 已熔断 ${count} 处无限连/超限乘区风险`, // cjk-ok
    `🛡️ Circuit-broke ${count} infinite-loop / runaway multiplier risks`
  )
}

function runSmithTopUpgrades(): void {
  if (!pinnedBaselineWb.value) {
    pinnedBaselineWb.value = JSON.parse(JSON.stringify(wb.value))
  }
  let count = 0
  mutateWb((w) => {
    count = applyMxTopCardUpgrades(w, 2)
  }, 'wbSmithTopUpgrades')
  bridgeFeedback.value = L(
    `🔨 已将篝火优先级最高的前 ${count} 张核心卡升级为强化版 (Card+)`, // cjk-ok
    `🔨 Upgraded top ${count} S-tier priority cards to Smith version (Card+)`
  )
}

const autoSyncAuditToCombat = ref(true)
const pinnedBaselineWb = ref<MxNumericalWorkbench | null>(null)

function restoreBaselineSnapshot(): void {
  if (!pinnedBaselineWb.value) return
  const snap = JSON.parse(JSON.stringify(pinnedBaselineWb.value))
  s.mutate((d) => {
    d.workbench = snap
  }, 'wbRestoreBaseline')
  bridgeFeedback.value = L(
    '↺ 已回滚还原至 v1.0 基线快照', // cjk-ok
    '↺ Restored workbench to pinned v1.0 baseline snapshot'
  )
}

const wb = computed<MxNumericalWorkbench>(() => {
  if (!s.doc.value.workbench) {
    return createMxWorkbenchPreset('slay_the_spire_dbg')
  }
  return s.doc.value.workbench
})

const isShortDramaMode = computed(() => wb.value.activePresetId === 'short_drama_progression')
const narrativeBriefPreviewOpen = ref(false)
const dramaPreviewChapter = ref(1)
const narrativeBriefMarkdown = computed(() => {
  const totalChaps = Math.max(
    10,
    Math.min(5000, Math.round(wb.value.roguelikeEnvelope.levelMax || 80))
  )
  const curChap = Math.max(1, Math.min(totalChaps, Math.round(dramaPreviewChapter.value || 1)))
  const slice = exportMxChapterNumericalSlice(wb.value, curChap, totalChaps)
  return `${slice.sliceMarkdown}\n\n${exportMxNarrativeProgressionBrief(wb.value)}`
})

function D(gameZh: string, gameEn: string, dramaZh: string, dramaEn: string): string {
  return isShortDramaMode.value ? L(dramaZh, dramaEn) : L(gameZh, gameEn)
}

function copyNarrativeBriefToClipboard(): void {
  const md = narrativeBriefMarkdown.value
  navigator.clipboard?.writeText(md).catch(() => {})
  bridgeFeedback.value = L(
    '📋 已复制《短剧/网文 80 集角色成长与爽点数值大纲》，可直接连线至「创建小说」或「创建剧本」节点', // cjk-ok
    '📋 Copied 80-Episode Narrative Progression Brief for Novel / Screenplay nodes'
  )
}

function jumpToShortDramaView(
  target: 'level_curve' | 'envelope_floors' | 'trump_cards' | 'climax_sim' | 'encounters'
): void {
  if (target === 'level_curve') {
    activeSubTab.value = 'envelope'
    envelopeRightView.value = 'level_curve'
  } else if (target === 'envelope_floors') {
    activeSubTab.value = 'envelope'
    envelopeRightView.value = 'floors'
  } else if (target === 'trump_cards') {
    activeSubTab.value = 'multiplier'
    multiplierRightView.value = 'entities'
  } else if (target === 'climax_sim') {
    activeSubTab.value = 'combat'
    deckRightView.value = 'battle_log'
  } else if (target === 'encounters') {
    activeSubTab.value = 'loot'
    lootRightView.value = 'histogram'
  }
}

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
  activeUserPresetId.value = ''
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
const debouncedEnvelope = ref(wb.value.roguelikeEnvelope)
let matrixDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [wb.value.combatKernel, wb.value.lootRoll, wb.value.roguelikeEnvelope] as const,
  ([ck, lr, env]) => {
    if (matrixDebounceTimer) clearTimeout(matrixDebounceTimer)
    matrixDebounceTimer = setTimeout(() => {
      debouncedCombatKernel.value = ck
      debouncedLootRoll.value = lr
      debouncedEnvelope.value = env
    }, 120)
  },
  { deep: true, immediate: true }
)

const combatRes = computed(() => runMxCombatKernelSimulation(wb.value.combatKernel))
const counterMatrixRes = computed(() => runMxEncounterCounterMatrix(debouncedCombatKernel.value))
const deckRemovalRoiRes = computed(() => runMxDeckRemovalRoiAnalysis(debouncedCombatKernel.value))
const archetypeMatrixRes = computed(() => runMxArchetypeBalanceMatrix(debouncedCombatKernel.value))
const sensitivityTornadoRes = computed(() => runMxSensitivityTornado(debouncedCombatKernel.value))
const envelopeRes = computed(() => runMxRoguelikeEnvelopeSimulation(wb.value.roguelikeEnvelope))
const ascensionLadderRes = computed(() => runMxAscensionLadderAudit(debouncedEnvelope.value))
const levelProgressionRes = computed(() =>
  generateMxLevelProgressionTable(wb.value.roguelikeEnvelope)
)
const multRes = computed(() => analyzeMultiplierPipeline(wb.value.multiplier, 12))
const jokerPlanetRes = computed(() => simulateMxJokerSlotOrderAndPlanetTable(wb.value.multiplier))
const extendedCardGenresRes = computed(() => simulateMxExtendedCardGenreMatrices(wb.value))
const synergyLoopRes = computed(() => analyzeMxSynergyAndInfiniteLoopRisk(wb.value))
const pvpNashRes = computed(() =>
  simulateMxPvpMatchupAndNashEquilibrium({ combatKernel: debouncedCombatKernel.value })
)
const upgradeDeckDoctorRes = computed(() => analyzeMxCardUpgradeRoiAndDeckDoctor(wb.value))
const hypergeomRes = computed(() => analyzeMxHypergeometricDrawAndComboOdds(wb.value))
const lethalPuzzleRes = computed(() => solveMxSingleTurnLethalAndOrderSkill(wb.value))
const bossIntentRes = computed(() => simulateMxBossIntentTimelineAndPollution(wb.value))
// A/B 差分每次需重跑 6 次模拟：防抖 400ms，避免每敲一个字符都卡顿
const snapshotDiffRes = ref<ReturnType<typeof computeMxWorkbenchSnapshotDiff> | null>(null)
let snapshotDiffTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [wb, pinnedBaselineWb],
  () => {
    if (snapshotDiffTimer) clearTimeout(snapshotDiffTimer)
    if (!pinnedBaselineWb.value) {
      snapshotDiffRes.value = null
      return
    }
    snapshotDiffTimer = setTimeout(() => {
      snapshotDiffRes.value = pinnedBaselineWb.value
        ? computeMxWorkbenchSnapshotDiff(pinnedBaselineWb.value, wb.value)
        : null
    }, 400)
  },
  { deep: true, immediate: true }
)
const lootRes = computed(() => runMxLootAndSubstatSimulation(wb.value.lootRoll))
const poolDilutionRes = computed(() => runMxPoolDilutionAnalysis(debouncedLootRoll.value))
const commercialCohortRes = computed(() => runMxCommercialCohortAnalysis(debouncedLootRoll.value))
const equipmentMatrixRes = computed(() => generateMxEquipmentUpgradeMatrix(wb.value.lootRoll))
const battlePassIapRes = computed(() => generateMxBattlePassAndPackTable(wb.value.lootRoll))
const showAllLevelRows = ref(false)

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
    `📦 已导出 6 张全套配表工程包 (cards:${bundle.cards.length} / waves:${bundle.waves.length} / items:${bundle.items.length} / lv:${bundle.levelCurve?.length ?? 0} / equip:+${bundle.equipmentUpgrades?.length ?? 0})`, // cjk-ok
    `📦 Exported 6-table Game Data Bundle (cards:${bundle.cards.length} / waves:${bundle.waves.length} / items:${bundle.items.length} / lv:${bundle.levelCurve?.length ?? 0} / equip:+${bundle.equipmentUpgrades?.length ?? 0})`
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
const actionBarRightView = ref<'units' | 'timeline' | 'tornado'>('units')
const deckRightView = ref<
  | 'cards'
  | 'counter_matrix'
  | 'removal_roi'
  | 'archetype_meta'
  | 'battle_log'
  | 'card_telemetry'
  | 'tornado'
>('cards')
const manaRightView = ref<'cards' | 'battle_log' | 'card_telemetry' | 'tornado'>('cards')
const envelopeRightView = ref<'floors' | 'ascension_ladder' | 'level_curve'>('floors')
const multiplierRightView = ref<
  | 'entities'
  | 'card_gallery'
  | 'upgrade_doctor'
  | 'tactical_lab'
  | 'design_lab'
  | 'synergy_nash'
  | 'joker_planet'
  | 'extended_card_genres'
>('entities')
const lootRightView = ref<
  'histogram' | 'dilution' | 'commercial_cohorts' | 'equipment_matrix' | 'battle_pass_iap'
>('histogram')
const bridgeBarOpen = ref(false)
const stressAuditRunning = ref(false)
const stressAuditProgress = ref(0)
const hoverCombatTurnIdx = ref<number | null>(null)
const selectedCombatTurn = ref<number | null>(null)
const hoverEnvelopeFloorIdx = ref<number | null>(null)
const selectedEnvelopeFloor = ref<number | null>(null)
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
const activeUserPresetId = ref('')

const currentPresetTooltip = computed(() => {
  if (activeUserPresetId.value) {
    const up = savedUserPresets.value.find((p) => p.id === activeUserPresetId.value)
    if (up) return `★ ${up.name}`
  }
  const pr = MX_WORKBENCH_PRESETS.find((p) => p.id === wb.value.activePresetId)
  if (!pr) return ''
  return isZh.value ? pr.descZh : pr.descEn
})

function onPresetDropdownChange(e: Event): void {
  const val = (e.target as HTMLSelectElement).value
  if (val.startsWith('user:')) {
    const uid = val.slice(5)
    const found = savedUserPresets.value.find((p) => p.id === uid)
    if (found) loadUserPreset(found)
  } else {
    selectPreset(val as MxWorkbenchPresetId)
  }
}

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
  activeUserPresetId.value = ''
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
    activeUserPresetId.value = savedUserPresets.value[existingIdx]!.id
  } else {
    const newId = `up_${Date.now()}`
    savedUserPresets.value.push({
      id: newId,
      name,
      workbench: clone
    })
    activeUserPresetId.value = newId
  }
  persistUserPresets()
  bridgeFeedback.value = L(`💾 已保存自定义预设「${name}」`, `💾 Saved custom preset "${name}"`) // cjk-ok
}

function loadUserPreset(preset: MxSavedUserPreset): void {
  activeUserPresetId.value = preset.id
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
  if (activeUserPresetId.value === id) activeUserPresetId.value = ''
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
  pinnedBaselineWb.value = JSON.parse(JSON.stringify(wb.value))
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
    '📌 已锁定当前指标与完整配表为 v1.0 基线快照，修改任意数值即可查看 Δ 差值与单卡变动', // cjk-ok
    '📌 Pinned current metrics & full table as v1.0 baseline; edit any value to see Δ deltas & card diffs'
  )
}

function clearBaselineSnapshot(): void {
  baselineSnap.value = null
  pinnedBaselineWb.value = null
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
  mutateAuditEntity((w) => {
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
  mutateAuditEntity((w) => {
    if (w.multiplier.entities.length <= 1) return
    w.multiplier.entities = w.multiplier.entities.filter((e) => e.id !== id)
  }, 'delEntity')
}

function autoBalanceAllEntities(): void {
  if (!pinnedBaselineWb.value) {
    pinnedBaselineWb.value = JSON.parse(JSON.stringify(wb.value))
  }
  let count = 0
  mutateAuditEntity((w) => {
    const res = autoBalanceWorkbenchEntities(w.multiplier)
    w.multiplier.entities = res.updatedEntities
    count = res.adjustedCount
  }, 'autoBalanceCards')
  bridgeFeedback.value = L(
    `⚖ 已按理论费用公式一键配平 ${count} 项超模/欠模实体配表`, // cjk-ok
    `⚖ Auto-balanced ${count} overpowered/underpowered entities to match cost budget formula`
  )
}

function optimizeJokerSlotOrder(): void {
  mutateWb((w) => {
    w.multiplier.entities = [...w.multiplier.entities].sort((a, b) => {
      const roleRank = (ent: (typeof w.multiplier.entities)[0]): number => {
        const xm = Number(ent.stats.xMult ?? 1)
        const am = Number(ent.stats.addMult ?? ent.stats.block ?? ent.stats.hp ?? 0)
        const ch = Number(ent.stats.chips ?? ent.stats.dmg ?? ent.stats.atk ?? 0)
        if (xm > 1) return 2
        if (am >= ch) return 1
        return 0
      }
      return roleRank(a) - roleRank(b)
    })
  }, 'optimizeJokerSlots')
  bridgeFeedback.value = L(
    `🔄 已按「左加筹码 → 中加倍率(+Mult) → 右乘独立乘区(×Mult)」最优顺序重排实体槽位`, // cjk-ok
    `🔄 Reordered entity slots into optimal [+Chips → +Mult → ×Mult] sequence`
  )
}

function exportRuntimeEngineCode(target: 'unity_cs' | 'godot_gd'): void {
  const res = exportMxWorkbenchRuntimeCode(wb.value, target)
  const blob = new Blob([res.code], {
    type: 'text/plain;charset=utf-8;'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = res.filename
  a.click()
  URL.revokeObjectURL(url)
  navigator.clipboard?.writeText(res.code).catch(() => {})
  bridgeFeedback.value = L(
    `💻 已生成并下载引擎运行时代码 ${res.filename}（已复制到剪贴板）`, // cjk-ok
    `💻 Exported engine runtime code ${res.filename} (& copied to clipboard)`
  )
}

function mutateAuditEntity(fn: (w: MxNumericalWorkbench) => void, key = 'wbAuditEntity'): void {
  mutateWb(fn, key)
  if (autoSyncAuditToCombat.value) {
    syncAuditEntitiesToCombatDeck(false)
  }
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

function toggleFullWorkbenchMode(): void {
  if (s.mode.value === 'workbench') {
    s.mode.value = 'build'
  } else {
    s.mode.value = 'workbench'
    s.resultsOpen.value = true
    s.resultsTab.value = 'workbench'
  }
}

function loadArchetypeIntoEditor(
  archetypeId: 'strength_burst' | 'attrition_block' | 'high_cycle_combo'
): void {
  const customSlot = wb.value.combatKernel.customArchetypeDecks?.[archetypeId]
  const srcDeck =
    customSlot && customSlot.length > 0 ? customSlot : getMxCanonicalArchetypeDeck(archetypeId)
  mutateWb((w) => {
    w.combatKernel.deckCards = JSON.parse(JSON.stringify(srcDeck))
  }, `loadArchetype:${archetypeId}`)
  deckRightView.value = 'cards'
  bridgeFeedback.value = L(
    `↙ 已将流派槽位 [${archetypeId}] 的卡组载入牌库编辑器`, // cjk-ok
    `↙ Loaded archetype slot [${archetypeId}] deck into Deck Designer`
  )
}

function saveCurrentDeckToArchetypeSlot(
  archetypeId: 'strength_burst' | 'attrition_block' | 'high_cycle_combo'
): void {
  mutateWb((w) => {
    if (!w.combatKernel.customArchetypeDecks) {
      w.combatKernel.customArchetypeDecks = {}
    }
    w.combatKernel.customArchetypeDecks[archetypeId] = JSON.parse(
      JSON.stringify(w.combatKernel.deckCards)
    )
  }, `saveArchetype:${archetypeId}`)
  bridgeFeedback.value = L(
    `💾 已将当前编辑卡组覆写保存至天梯对标槽位 [${archetypeId}]`, // cjk-ok
    `💾 Saved current deck into benchmark slot [${archetypeId}]`
  )
}

function resetCustomArchetypeSlot(
  archetypeId: 'strength_burst' | 'attrition_block' | 'high_cycle_combo'
): void {
  mutateWb((w) => {
    if (w.combatKernel.customArchetypeDecks) {
      delete w.combatKernel.customArchetypeDecks[archetypeId]
    }
  }, `resetArchetype:${archetypeId}`)
  bridgeFeedback.value = L(
    `↺ 已恢复流派槽位 [${archetypeId}] 的官方默认基准牌库`, // cjk-ok
    `↺ Restored default canonical deck for slot [${archetypeId}]`
  )
}

async function runHighPrecisionStressAudit(): Promise<void> {
  if (stressAuditRunning.value) return
  stressAuditRunning.value = true
  stressAuditProgress.value = 15
  await new Promise((r) => setTimeout(r, 18))

  // Stage 1: 1,500-run Micro-Combat Monte Carlo
  const highCombat = runMxCombatKernelSimulation({
    ...wb.value.combatKernel,
    runs: 1500
  })
  stressAuditProgress.value = 45
  await new Promise((r) => setTimeout(r, 18))

  // Stage 2: 1,200-run Roguelike Floor Envelope
  const highEnv = runMxRoguelikeEnvelopeSimulation({
    ...wb.value.roguelikeEnvelope,
    runs: 1200
  })
  stressAuditProgress.value = 75
  await new Promise((r) => setTimeout(r, 18))

  // Stage 3: 1,500-run Gacha / Sub-stat / Draft Pool
  const highLoot = runMxLootAndSubstatSimulation({
    ...wb.value.lootRoll,
    runs: 1500
  })
  stressAuditProgress.value = 100

  mutateWb((w) => {
    w.combatKernel.runs = 1500
    w.roguelikeEnvelope.runs = 1200
    w.lootRoll.runs = 1500
  }, 'highPrecisionStressAudit')

  bridgeFeedback.value = L(
    `🔬 1500局高精度压力审计完成：胜率 ${highCombat.winRatePct}% (TTK P50=${highCombat.ttkP50}T) | 首通率 ${highEnv.firstRunClearRatePct}% | 毕业消耗 P50=${highLoot.costP50}`, // cjk-ok
    `🔬 1,500-Run Stress Audit Done: Win ${highCombat.winRatePct}% (TTK=${highCombat.ttkP50}T) | Clear ${highEnv.firstRunClearRatePct}% | Loot Cost P50=${highLoot.costP50}`
  )
  await new Promise((r) => setTimeout(r, 160))
  stressAuditRunning.value = false
  stressAuditProgress.value = 0
}

function onCombatSvgMove(ev: MouseEvent): void {
  const svgEl = ev.currentTarget as SVGSVGElement | null
  const pts = combatRes.value.turnSeries
  if (!svgEl || !pts.length) return
  const rect = svgEl.getBoundingClientRect()
  if (rect.width <= 0) return
  const relX = ((ev.clientX - rect.left) / rect.width) * SVG_W
  const ratio = Math.max(0, Math.min(1, (relX - PAD_L) / Math.max(1, PLOT_W)))
  hoverCombatTurnIdx.value = Math.min(
    pts.length - 1,
    Math.max(0, Math.round(ratio * (pts.length - 1)))
  )
}

function onCombatSvgClick(): void {
  const idx = hoverCombatTurnIdx.value
  const pts = combatRes.value.turnSeries
  if (idx === null || !pts[idx]) return
  selectedCombatTurn.value = pts[idx]!.turn
  if (wb.value.combatKernel.kernel === 'deck_cycle') {
    deckRightView.value = 'battle_log'
  } else if (wb.value.combatKernel.kernel === 'mana_tempo') {
    manaRightView.value = 'battle_log'
  }
}

const hoveredCombatPoint = computed(() => {
  const pts = combatRes.value.turnSeries
  const idx = hoverCombatTurnIdx.value
  if (idx === null || !pts[idx]) return null
  const pt = pts[idx]!
  const max = combatChartBounds.value.max
  return {
    idx,
    pt,
    x: cxAt(idx, pts.length),
    yP50: cyAt(pt.primaryP50, max),
    ySec: cyAt(pt.secondaryMean, max)
  }
})

function onEnvelopeSvgMove(ev: MouseEvent): void {
  const svgEl = ev.currentTarget as SVGSVGElement | null
  const pts = envelopeRes.value.floorSeries
  if (!svgEl || !pts.length) return
  const rect = svgEl.getBoundingClientRect()
  if (rect.width <= 0) return
  const relX = ((ev.clientX - rect.left) / rect.width) * SVG_W
  const ratio = Math.max(0, Math.min(1, (relX - PAD_L) / Math.max(1, PLOT_W)))
  hoverEnvelopeFloorIdx.value = Math.min(
    pts.length - 1,
    Math.max(0, Math.round(ratio * (pts.length - 1)))
  )
}

function onEnvelopeSvgClick(): void {
  const idx = hoverEnvelopeFloorIdx.value
  const pts = envelopeRes.value.floorSeries
  if (idx === null || !pts[idx]) return
  selectedEnvelopeFloor.value = pts[idx]!.floor
}

const hoveredEnvelopePoint = computed(() => {
  const pts = envelopeRes.value.floorSeries
  const idx = hoverEnvelopeFloorIdx.value
  if (idx === null || !pts[idx]) return null
  const pt = pts[idx]!
  const max = envelopeMaxPower.value
  return {
    idx,
    pt,
    x: cxAt(idx, pts.length),
    yPlayer: cyAt(pt.playerP50, max),
    yEnemy: cyAt(pt.enemyPower, max)
  }
})

const uiText = computed(() => ({
  presetLabel: L('旗舰数值预设:', 'Genre Preset:'), // cjk-ok
  presetGroupBuiltin: L('官方旗舰预设 (6大经典品类)', 'Built-in Flagship Presets'), // cjk-ok
  presetGroupUser: L('★ 我的自建预设', '★ My Custom Presets'), // cjk-ok
  deleteUserPresetTip: L('删除当前选中的自建预设', 'Delete selected custom preset'), // cjk-ok
  newBlankBtn: L('从零自建空白体系', 'New Blank System'), // cjk-ok
  newBlankTip: L(
    '清空预置数据，从零搭建你自己的原创游戏数值体系', // cjk-ok
    'Start a clean blank custom numerical system from scratch'
  ),
  bridgeToggleBtn: L('画布双向绑定', 'Canvas Bridge'), // cjk-ok
  fullScreenBtn: L('全屏工作台', 'Full-Screen Lab'), // cjk-ok
  splitScreenBtn: L('还原画布分屏', 'Split Canvas View'), // cjk-ok
  stressAuditBtn: L('高精度审计(1500局)', '1,500-Run Audit'), // cjk-ok
  stressAuditRunningBtn: L('压力采样中', 'Auditing'), // cjk-ok
  tabBattleLog: D(
    '单局逐回合战报', // cjk-ok
    'Turn Battle Log',
    '名场面逐幕剧本推演', // cjk-ok
    'Scene-by-Scene Climax Log'
  ), // cjk-ok
  colTurn: D('回合', 'Turn', '幕次', 'Act'), // cjk-ok
  colCardsPlayed: D(
    '本回合出牌序列', // cjk-ok
    'Cards Played',
    '本幕亮出底牌/反转动作', // cjk-ok
    'Trump Cards / Actions'
  ), // cjk-ok
  colEnergyUsed: D('费用消耗', 'NRG/Mana', '情绪蓄能消耗', 'Tension Cost'), // cjk-ok
  colDmgBlk: D(
    '伤害 / 护甲(场面)', // cjk-ok
    'DMG / BLK(Board)',
    '打脸爽感 / 隐忍护盾', // cjk-ok
    'Slap DMG / Endure Shield'
  ), // cjk-ok
  colRelicProc: D(
    '遗物/节奏触发', // cjk-ok
    'Relic / Tempo',
    '金手指/名场面光环触发', // cjk-ok
    'System / Climax Aura'
  ), // cjk-ok
  colEnemyAfter: D(
    '敌方行动与余血 (我HP/敌HP)', // cjk-ok
    'Enemy Action & HP (Me/Boss)',
    '反派反应与嚣张余值 (我气场/敌威压)', // cjk-ok
    'Villain Reaction & Arrogance'
  ), // cjk-ok
  noCardsPlayed: D('(空过/卡手)', '(Pass / Brick)', '(隐忍蓄势)', '(Enduring)'), // cjk-ok
  loadSlotBtn: L('↙载入', '↙Load'), // cjk-ok
  saveSlotBtn: L('💾覆写', '💾Save'), // cjk-ok
  resetSlotBtn: L('↺还原', '↺Reset'), // cjk-ok
  customSlotTag: L('已自定义', 'Custom'), // cjk-ok
  chartClickHint: D(
    '点击曲线锚点可高亮右侧对应回合/楼层', // cjk-ok
    'Click point to highlight row',
    '点击曲线锚点可高亮右侧对应幕次/剧集节点', // cjk-ok
    'Click point to highlight episode act'
  ), // cjk-ok
  tabCombat: D(
    '① 战斗调度内核', // cjk-ok
    '1. Combat Kernels',
    '① 名场面打脸推演', // cjk-ok
    '1. Climax Face-Slap Sim'
  ), // cjk-ok
  tabCombatTip: D(
    '① 战斗调度内核 (杀戮尖塔DBG / 炉石传说TCG / 阴阳师ATB)', // cjk-ok
    '1. Combat Kernels (DBG / TCG / ATB)',
    '① 名场面交锋内核 (底牌亮出链 / 情绪蓄能曲线 / 群像博弈出手轴)', // cjk-ok
    '1. Climax Confrontation Kernels (Trump Reveal / Tension Curve / Multi-Role Axis)'
  ),
  tabEnvelope: D(
    '② 肉鸽战力包络', // cjk-ok
    '2. Roguelike Envelope',
    '② 80集战力与卡点包络', // cjk-ok
    '2. 80-Ep Power & Cliffhangers'
  ), // cjk-ok
  tabEnvelopeTip: D(
    '② 肉鸽战力包络 vs 怪物膨胀墙 & 进阶审计', // cjk-ok
    '2. Roguelike Envelope vs. Scaling Wall',
    '② 80集主角成长包络 vs 反派跨阶威压墙 & 付费卡点审计', // cjk-ok
    '2. 80-Ep Protagonist Growth vs. Villain Scaling Wall & Paywall Cliffhangers'
  ),
  tabMultiplier: D(
    '③ 乘区与配表审计', // cjk-ok
    '3. Multiplier & Audit',
    '③ 角色乘区与底牌审计', // cjk-ok
    '3. Character Multiplier & Trumps'
  ), // cjk-ok
  tabMultiplierTip: D(
    '③ 乘区边际收益、配表审计与卡牌衍生矩阵', // cjk-ok
    '3. Multiplier ROI & Table Audit',
    '③ 主角成长乘区公式 (境界×金手指×人脉×反转) 与打脸底牌配表审计', // cjk-ok
    '3. Protagonist Growth Multiplier Formula & Trump Card Audit'
  ),
  tabLoot: D(
    '④ 抽卡保底与词条', // cjk-ok
    '4. Gacha & Sub-stats',
    '④ 奇遇人脉与付费转化', // cjk-ok
    '4. Encounters, Backing & Paywall'
  ), // cjk-ok
  tabLootTip: D(
    '④ 抽卡软保底 / 御魂强化 / 幸存者商店词条池', // cjk-ok
    '4. Gacha / Sub-stat / Draft Pool',
    '④ 金手指保底爆发 / 奇遇贵人三选一凑齐4大靠山 / 观众付费转化漏斗', // cjk-ok
    '4. System Pity / 4-Tycoon Backing Draft / Viewer Paywall Funnel'
  ),
  syncBtn: L('⇄ 同步结果至宏观图 Params', '⇄ Sync Metrics to Macro Params'), // cjk-ok
  syncTip: L(
    '将胜率、TTK、乘区总伤、期望抽数与通关率回写为画布全局变量 Params', // cjk-ok
    'Write WinRate, TTK, FinalOutput, ExpectedCost & ClearRate into Macro Diagram Params'
  ),
  kernelDeck: D(
    '牌库洗抽内核 (杀戮尖塔 DBG)', // cjk-ok
    'Deck-Cycle (Slay the Spire DBG)',
    '底牌亮出内核 (名场面反转链)', // cjk-ok
    'Trump-Card Reveal Kernel'
  ), // cjk-ok
  kernelMana: D(
    '法力曲线内核 (炉石传说 TCG)', // cjk-ok
    'Mana-Tempo (Hearthstone TCG)',
    '情绪蓄能内核 (铺垫→高潮节奏)', // cjk-ok
    'Tension-Curve Pacing Kernel'
  ), // cjk-ok
  kernelAction: D(
    '行动条+鬼火内核 (阴阳师/星铁 ATB)', // cjk-ok
    'Action-Bar & Orbs (Onmyoji ATB)',
    '群像交锋出手轴 (多方势力博弈)', // cjk-ok
    'Multi-Faction Turn Axis'
  ), // cjk-ok
  winRate: D('模拟胜率 / 斩杀率', 'Win / Lethal Rate', '名场面反转打脸率', 'Climax Reversal Win%'), // cjk-ok
  ttkP50: D(
    '击杀回合 P50 (P10~P90)', // cjk-ok
    'TTK Turn P50 (P10~P90)',
    '高潮爆发幕数 P50 (P10~P90)', // cjk-ok
    'Climax Act P50 (P10~P90)'
  ), // cjk-ok
  enemyHp: D('目标敌人生命值', 'Enemy HP', '反派嚣张气焰/威压值', 'Villain Arrogance HP'), // cjk-ok
  energyTurn: D('每回合能量', 'Energy / Turn', '每幕铺垫行动点', 'Setup Points / Act'), // cjk-ok
  drawTurn: D('每回合抽牌', 'Draw / Turn', '每幕可用底牌数', 'Trump Cards / Act'), // cjk-ok
  enemyDmg: D('敌人基础伤害', 'Enemy Base DMG', '反派每幕羞辱打压值', 'Villain Suppression / Act'), // cjk-ok
  mulliganCap: D(
    '起手留牌最高费', // cjk-ok
    'Mulligan Max Cost',
    '开篇伏笔最高耗能', // cjk-ok
    'Opening Setup Max Cost'
  ), // cjk-ok
  clearPower: D(
    '对手解场强度/回合', // cjk-ok
    'Enemy Clear / Turn',
    '反派拆招压制/每幕', // cjk-ok
    'Villain Counter / Act'
  ), // cjk-ok
  initOrbs: D('初始鬼火数', 'Initial Orbs', '初始人情/资源点', 'Initial Favor Points'), // cjk-ok
  orbRecover: D('每5次行动回火', 'Orbs / 5 Actions', '每5幕高潮回气', 'Points / 5 Acts'), // cjk-ok
  bossDef: D('目标防御 DEF', 'Target DEF', '反派豪门护盾 DEF', 'Villain Shield DEF'), // cjk-ok
  floorCount: D(
    '总层数 / 波次', // cjk-ok
    'Total Floors / Waves',
    '全剧冲突大幕数 (每幕4集)', // cjk-ok
    'Conflict Chapters (4 Ep/ea)'
  ), // cjk-ok
  playerBase: D('初始构筑战力', 'Player Base Power', '主角开局身价/实力', 'Protagonist Init Power'), // cjk-ok
  synergyRate: D(
    '每层乘区组件命中率%', // cjk-ok
    'Synergy Hit Rate %',
    '每幕奇遇/贵人触发率%', // cjk-ok
    'Encounter Hit Rate %'
  ), // cjk-ok
  synergyMult: D('单件乘区独立倍率(x)', 'Synergy ×Mult', '单次觉醒/靠山倍率(x)', 'Awakening ×Mult'), // cjk-ok
  enemyBase: D('怪物起始强度', 'Enemy Base Power', '前期小反派起始威压', 'Early Villain Power'), // cjk-ok
  enemyGrowth: D(
    '怪物每层膨胀指数(x)', // cjk-ok
    'Enemy Growth Rate',
    '反派跨阶膨胀指数(x)', // cjk-ok
    'Villain Scaling Rate'
  ), // cjk-ok
  metaBonus: D(
    '局外天赋每局增幅%', // cjk-ok
    'Meta Bonus / Run %',
    '系统隐藏底蕴每轮增幅%', // cjk-ok
    'System Hidden Growth %'
  ), // cjk-ok
  firstClear: D(
    '首局裸装通关率', // cjk-ok
    '1st-Run Clear Rate',
    '全剧爽点一气呵成率', // cjk-ok
    'Full-Arc Pacing Pass%'
  ), // cjk-ok
  metaRuns: D(
    '达50%通关所需局数', // cjk-ok
    'Meta Runs to 50% Clear',
    '需隐藏伏笔铺垫轮数', // cjk-ok
    'Setup Arcs Needed'
  ), // cjk-ok
  wallFloors: D(
    '数值劝退墙层数', // cjk-ok
    'Difficulty Spike Walls',
    '付费反转卡点幕 (虐主峰值)', // cjk-ok
    'Paywall Cliffhanger Acts'
  ), // cjk-ok
  runawayFloors: D(
    '数值膨胀割草层', // cjk-ok
    'Runaway Trivial Floors',
    '无脑碾压爽点幕', // cjk-ok
    'Effortless Sweep Acts'
  ), // cjk-ok
  none: L('无 (曲线健康)', 'None (Healthy)'), // cjk-ok
  finalOutput: D(
    '当前面板最终结算值', // cjk-ok
    'Final Pipeline Output',
    '主角名场面综合爆发力', // cjk-ok
    'Climax Total Burst Output'
  ), // cjk-ok
  bestNextAttr: D(
    '当前最高边际收益属性', // cjk-ok
    'Highest Marginal ROI Stat',
    '下一幕最爽升级维度', // cjk-ok
    'Best Next Growth Stat'
  ), // cjk-ok
  budgetFormula: D(
    '理论费用预算公式', // cjk-ok
    'Expected Cost Formula',
    '底牌铺垫成本公式', // cjk-ok
    'Setup Cost Formula'
  ), // cjk-ok
  actualFormula: D(
    '实际单位价值公式', // cjk-ok
    'Entity Value Formula',
    '底牌打脸爽感价值公式', // cjk-ok
    'Trump Climax Value Formula'
  ), // cjk-ok
  modeGacha: D(
    '抽卡大小保底 & 粉尘 (炉石/二游)', // cjk-ok
    'Gacha Pity & Dust (TCG / Banner)',
    '金手指爆发保底 & 爽点兑现', // cjk-ok
    'System Jackpot Pity'
  ), // cjk-ok
  modeSubstat: D(
    '御魂/圣遗物副属性强化 (阴阳师+18速)', // cjk-ok
    'Sub-stat Roll (Onmyoji +18 SPD)',
    '主角核心光环突破 (满级气场)', // cjk-ok
    'Protagonist Aura Breakthrough'
  ), // cjk-ok
  modeDraft: D(
    '肉鸽三选一 & 商店 Reroll 凑羁绊', // cjk-ok
    'Roguelike Draft & Shop Reroll',
    '奇遇贵人三选一 & 凑齐4大靠山', // cjk-ok
    'Encounter Draft & 4-Tycoon Backing'
  ), // cjk-ok
  baseRate: D('基础出金率 %', 'Base SSR Rate %', '平地爆大爽点基础率%', 'Base Big-Climax Rate%'), // cjk-ok
  softPity: D('软保底起始抽', 'Soft Pity Pull', '观众情绪软保底集数', 'Soft Pity Episode'), // cjk-ok
  hardPity: D('硬保底抽数', 'Hard Pity Pull', '必爆大反转硬保底集', 'Hard Pity Climax Ep'), // cjk-ok
  targetCopies: D('目标获取数量', 'Target Copies', '目标大高潮次数', 'Target Climax Count'), // cjk-ok
  targetSubstat: D('目标副属性名', 'Target Sub-stat', '核心光环属性名', 'Target Aura Stat'), // cjk-ok
  targetThresh: D('毕业阈值 (>=)', 'Target Threshold (>=', '光环大成阈值 (>=)', 'Aura Mastery (>='), // cjk-ok
  fourLineRate: D(
    '初始4词条胚子率%', // cjk-ok
    '4-Line Init Rate %',
    '天胡开局气运率%', // cjk-ok
    'God-Tier Start Rate%'
  ), // cjk-ok
  staminaCost: D('单次掉落体力消耗', 'Stamina / Drop', '每集铺垫情绪成本', 'Pacing Cost / Ep'), // cjk-ok
  synergyTag: D(
    '目标流派标签 Tag', // cjk-ok
    'Target Synergy Tag',
    '核心人脉/靠山标签 Tag', // cjk-ok
    'Target Backing Tag'
  ), // cjk-ok
  synergyPieces: D('成型所需件数', 'Pieces Needed', '逆袭成型所需靠山数', 'Backing Allies Needed'), // cjk-ok
  tagAffinity: D(
    '同标签权重加成%', // cjk-ok
    'Tag Affinity Bonus %',
    '主角光环同阵营吸引加成%', // cjk-ok
    'Protagonist Aura Affinity %'
  ), // cjk-ok
  rerollsWave: D(
    '每波商店刷新次数', // cjk-ok
    'Rerolls / Wave',
    '每幕主动布局寻访次数', // cjk-ok
    'Layout Rerolls / Chapter'
  ), // cjk-ok
  attemptsP50: D(
    '中位达成次数 P50 (P10~P90)', // cjk-ok
    'Attempts P50 (P10~P90)',
    '中位成型章节 P50 (P10~P90)', // cjk-ok
    'Completion Chapter P50'
  ), // cjk-ok
  expectedCost: D(
    '中位消耗资源 P50 (均值)', // cjk-ok
    'Expected Cost P50 (Mean)',
    '中位人情/布局消耗 P50 (均值)', // cjk-ok
    'Layout Cost P50 (Mean)'
  ), // cjk-ok
  hitRate: D(
    '单胚子/整局达成率', // cjk-ok
    'Success / Hit Rate',
    '全剧凑齐4大靠山达成率', // cjk-ok
    '4-Backing Completion Rate'
  ), // cjk-ok
  relicTriggers: D('被动遗物钩子', 'Relic Triggers', '主角光环被动钩子', 'Protagonist Aura Hooks'), // cjk-ok
  relicNone: D('无遗物钩子', 'None', '无额外光环', 'None'), // cjk-ok
  relicShuriken: D(
    '手里剑+苦无 (3攻+1力4甲)', // cjk-ok
    'Shuriken + Kunai',
    '越战越勇 (连亮3底牌+气场)', // cjk-ok
    'Momentum Aura (3 Reveals)'
  ), // cjk-ok
  relicNecro: D(
    '死灵之书 (首张≥2费双发)', // cjk-ok
    'Necronomicon 2x',
    '双重反转 (王炸底牌二次打脸)', // cjk-ok
    'Double Reversal 2x'
  ), // cjk-ok
  relicBranch: D(
    '枯木树枝 (消耗即衍生)', // cjk-ok
    'Dead Branch',
    '奇遇连环 (底牌触发新伏笔)', // cjk-ok
    'Chain Encounter'
  ), // cjk-ok
  relicAll: D('全遗物协同开启', 'All Relics Active', '天命主角全光环开启', 'Full Protagonist Aura'), // cjk-ok
  goalSeekTitle: L('逆向目标求解 (CRN二分)', 'Reverse Goal-Seek'), // cjk-ok
  targetWinPct: D('目标胜率%', 'Target Win%', '目标打脸爽度%', 'Target Win%'), // cjk-ok
  solveEnemyHp: D('反推敌方血量', 'Solve Enemy HP', '反推反派威压值', 'Solve Villain HP'), // cjk-ok
  targetClearPct: D('目标首通率%', 'Target Clear%', '目标一气呵成率%', 'Target Pass%'), // cjk-ok
  solveGrowthRate: D(
    '反推怪物膨胀率', // cjk-ok
    'Solve Growth Rate',
    '反推反派膨胀率', // cjk-ok
    'Solve Villain Scaling'
  ), // cjk-ok
  exportQaReportBtn: L('导出QA审计报告', 'Export QA Report'), // cjk-ok
  exportQaReportTip: L(
    '一键生成完整的商业数值立项与QA签收审计报告 (.md)，含4层全链路指标、多流派多样性与付费分层留存表', // cjk-ok
    'Export executive Markdown Commercial Numerical QA Audit Report covering all 4 layers'
  ),
  tabArchetypeMeta: D(
    '4流派天梯多样性', // cjk-ok
    '4-Build Meta Matrix',
    '4大爽剧题材流派对比', // cjk-ok
    '4 Short-Drama Tropes'
  ), // cjk-ok
  colArchetype: D('流派构筑模型', 'Build Archetype', '爽剧叙事流派', 'Drama Archetype'), // cjk-ok
  colMetaShare: D('预估天梯占比%', 'Meta Share %', '受众完播偏好%', 'Audience Share %'), // cjk-ok
  colTier: L('强度梯度', 'Tier'), // cjk-ok
  metaScoreLabel: D(
    '天梯流派百花齐放指数 (Shannon):', // cjk-ok
    'Meta Diversity Score (Shannon):',
    '多线叙事丰富度指数 (Shannon):', // cjk-ok
    'Narrative Diversity Score:'
  ), // cjk-ok
  metaHealthy: L('百花齐放 (健康)', 'Meta Healthy'), // cjk-ok
  metaMonopoly: L('T0单流派垄断!', 'Tier-0 Monopoly!'), // cjk-ok
  metaOvertuned: L('数值膨胀全坐牢!', 'Boss Overtuned!'), // cjk-ok
  tabCommercialCohort: D(
    '商业付费分层遥测', // cjk-ok
    'Commercial Cohorts',
    '观众付费解锁分层留存表', // cjk-ok
    'Viewer Paywall Cohorts'
  ), // cjk-ok
  colCohort: D('玩家付费分层', 'Player Cohort', '观众付费分层', 'Viewer Cohort'), // cjk-ok
  colSpend: D('月均付费$', 'Monthly $', '单剧充值$', 'Series Spend $'), // cjk-ok
  colDailyTries: D('日均获取', 'Daily Tries', '日均刷集数', 'Daily Episodes'), // cjk-ok
  colGradDays: D(
    '中位/非酋毕业天数', // cjk-ok
    'P50 / P90 Days',
    '中位/慢热追完天数', // cjk-ok
    'P50 / P90 Finish Days'
  ), // cjk-ok
  colDay30Rate: D('首月30天毕业率%', '30d Grad %', '全剧80集完播率%', '80-Ep Completion %'), // cjk-ok
  colChurnRisk: D('非酋流失风险', 'Churn Risk', '卡点弃剧风险', 'Drop-Off Risk'), // cjk-ok
  riskLow: L('留存健康', 'Low Risk'), // cjk-ok
  riskMod: L('中度卡点', 'Moderate'), // cjk-ok
  riskHigh: L('高危劝退!', 'High Churn!'), // cjk-ok
  pityElasticityLbl: D(
    '保底付费转化弹性:', // cjk-ok
    'Pity Elasticity:',
    '卡点钩子付费转化弹性:', // cjk-ok
    'Cliffhanger Paywall Elasticity:'
  ), // cjk-ok
  whaleRatioLbl: D(
    '重氪/零氪首月进度比:', // cjk-ok
    'Whale/F2P 30d Ratio:',
    '全集直购/看广告解锁进度比:', // cjk-ok
    'VIP/Ad-Unlock Speed Ratio:'
  ), // cjk-ok
  blendedArpuLbl: L('预估月均ARPU:', 'Est. Monthly ARPU:'), // cjk-ok
  tabCardTelemetry: D('单卡抓位遥测', 'Card Telemetry', '底牌爽感贡献遥测', 'Trump Card Telemetry'), // cjk-ok
  colPlaysPerRun: D('场均打出', 'Plays/Run', '场均亮牌次数', 'Reveals/Clash'), // cjk-ok
  colOutputShare: D('价值贡献占比%', 'Output Share%', '爽感贡献占比%', 'Climax Share%'), // cjk-ok
  colStrandedPct: D('卡手弃置率%', 'Stranded Brick%', '伏笔闲置率%', 'Unused Setup%'), // cjk-ok
  colWinDelta: D('胜率抬升Δ%', 'Win Lift Δ%', '反转爽度抬升Δ%', 'Reversal Lift Δ%'), // cjk-ok
  colPickGrade: D('抓位评级', 'Pick Grade', '名场面评级', 'Climax Grade'), // cjk-ok
  gradeS: D('S 必抓核心', 'S Must-Pick', 'S 王炸名场面', 'S Climax Finisher'), // cjk-ok
  gradeA: D('A 主力构筑', 'A Core', 'A 核心反转牌', 'A Core Reversal'), // cjk-ok
  gradeB: D('B 过渡填充', 'B Filler', 'B 情绪铺垫牌', 'B Tension Setup'), // cjk-ok
  gradeC: D('C 卡手陷阱', 'C Brick Trap', 'C 拖沓注水桥段', 'C Filler Trap'), // cjk-ok
  tabTornado: L('敏感度龙卷风', 'Sensitivity Tornado'), // cjk-ok
  colParamLever: L('核心参数杠杆 (±20%扰动)', 'Parameter Lever (±20%)'), // cjk-ok
  colLowWin: L('下调胜率%', 'Low Win%'), // cjk-ok
  colBaseWin: L('基准胜率%', 'Base Win%'), // cjk-ok
  colHighWin: L('上调胜率%', 'High Win%'), // cjk-ok
  colSwingAmplitude: L('敏感度振幅Δ%', 'Swing Δ%'), // cjk-ok
  tabEnvelopeFloors: D(
    '逐层战力与房间明细', // cjk-ok
    'Floor-by-Floor Envelope',
    '逐幕正反派战力剪刀差', // cjk-ok
    'Chapter Power Envelope'
  ), // cjk-ok
  tabAscensionLadder: D(
    'A0~A20 进阶终局阶梯', // cjk-ok
    'A0–A20 Ascension Ladder',
    '反派压迫梯度 (N1~N20)', // cjk-ok
    'Villain Pressure Ladder'
  ), // cjk-ok
  colAscensionTier: D('进阶等级', 'Ascension Tier', '反派压迫阶位', 'Pressure Tier'), // cjk-ok
  colAscModifier: D(
    '叠加上升词条规则', // cjk-ok
    'Cumulative Modifiers',
    '反派升级施压手段', // cjk-ok
    'Villain Escalation Rule'
  ), // cjk-ok
  colAscClear: D('首通率%', 'Clear %', '逆袭成型率%', 'Reversal %'), // cjk-ok
  colDoubleBoss: D(
    '双Boss连战通过%', // cjk-ok
    '2x Boss Pass%',
    '终局双豪门围剿破局%', // cjk-ok
    'Dual-Boss Finale Pass%'
  ), // cjk-ok
  colAscVerdict: D(
    '终局生态诊断', // cjk-ok
    'Endgame Verdict',
    '虐主/爽感平衡诊断', // cjk-ok
    'Tension Balance Verdict'
  ), // cjk-ok
  ascSweetSpot: L('黄金甜点区', 'Sweet Spot'), // cjk-ok
  ascBrutalFair: L('硬核可解', 'Brutal & Fair'), // cjk-ok
  ascOvertuned: L('数值崩坏墙!', 'Overtuned Wall!'), // cjk-ok
  ascTooEasy: L('膨胀割草', 'Too Easy'), // cjk-ok
  exportUnityCsBtn: L('Unity .cs', 'Unity .cs'), // cjk-ok
  exportGodotGdBtn: L('Godot .gd', 'Godot .gd'), // cjk-ok
  exportEngineTip: L(
    '一键编译当前乘区公式、费用预算、抽卡软硬保底与肉鸽A0~A20膨胀曲线为引擎运行时源码', // cjk-ok
    'Compile current formulas, budget curve, gacha pity & A0-A20 scaling into engine runtime code'
  ),
  tabLevelCurve: D(
    'Lv.1~80 角色突破成长表', // cjk-ok
    'Lv.1–80 Progression & Ascension',
    '第1~80集 角色身份蜕变表', // cjk-ok
    'Ep.1–80 Identity Progression'
  ), // cjk-ok
  lvMaxLbl: D('满级上限', 'Max Lv', '总集数上限', 'Total Eps'), // cjk-ok
  lvGrowthLbl: D('每级成长%', 'Growth%/Lv', '每集身价成长%', 'Growth%/Ep'), // cjk-ok
  lvAscIntervalLbl: D('突破间隔', 'Asc Interval', '大高潮集距', 'Climax Interval'), // cjk-ok
  lvAscBonusLbl: D('突破跃迁%', 'Asc Bonus%', '身份揭晓跃迁%', 'Reveal Jump%'), // cjk-ok
  lvXpExpLbl: D('经验指数', 'XP Exp', '爽点膨胀指数', 'Climax Exp'), // cjk-ok
  lvShowAllBtn: D('展开全等级', 'All Levels', '展开全80集', 'All 80 Eps'), // cjk-ok
  lvShowMilestonesBtn: D('仅里程碑', 'Milestones', '仅关键卡点集', 'Key Climax Eps'), // cjk-ok
  colLvPhase: D('等级 / 突破阶', 'Level / Phase', '剧集 / 身份蜕变阶', 'Episode / Identity Stage'), // cjk-ok
  colLvAtkHpDef: D(
    'HP / ATK / DEF',
    'HP / ATK / DEF',
    '气场 / 手腕 / 护道底蕴', // cjk-ok
    'Aura / Power / Backing'
  ), // cjk-ok
  colLvXpNeed: D('升级/累计经验', 'Next / Cum XP', '本集情绪 / 累计爽点值', 'Ep / Cum Climax XP'), // cjk-ok
  colLvGoldMats: D('突破金币与材料', 'Gold & Mats', '动用资金与关键信物', 'Funds & Key Tokens'), // cjk-ok
  colLvStamDays: D('毕业体力天', 'Stam Days', '连载追更天', 'Release Days'), // cjk-ok
  tabEquipMatrix: D(
    '+1~+15 装备强化阶梯表', // cjk-ok
    '+1~+15 Equipment Upgrade Matrix',
    '+1~+15 权柄/信物进阶阶梯表', // cjk-ok
    '+1~+15 Authority Token Matrix'
  ), // cjk-ok
  eqMaxLvLbl: D('强化上限+', 'Max +Lv', '权柄阶位+', 'Max +Rank'), // cjk-ok
  eqBaseStatLbl: D('主词条初值', 'Base Stat', '初始威慑力', 'Base Prestige'), // cjk-ok
  eqStepStatLbl: D('每级成长', 'Stat/Lv', '每阶威慑成长', 'Prestige/Rank'), // cjk-ok
  eqExpPowLbl: D('狗粮指数', 'EXP Pow', '人情消耗指数', 'Favor Pow'), // cjk-ok
  eqDecayLbl: D('+5后衰减%/级', 'Decay%/Lv', '+5后破局难度%/阶', 'Difficulty%/Rank'), // cjk-ok
  colEqLevel: D('强化等级', 'Level', '权柄等阶', 'Authority Rank'), // cjk-ok
  colEqMainStat: D('主词条数值', 'Main Stat', '权柄威慑值', 'Prestige Stat'), // cjk-ok
  colEqSubRolls: D('副词条跳数', 'Sub Rolls', '附带特权数', 'Privileges'), // cjk-ok
  colEqRatePct: D('成功率%', 'Success%', '单次破局率%', 'Breakthrough%'), // cjk-ok
  colEqExpGold: D(
    '单次狗粮/含败期望金', // cjk-ok
    'EXP / Exp.Gold',
    '单次铺垫/期望资金', // cjk-ok
    'Setup / Exp.Funds'
  ), // cjk-ok
  colEqCumGoldStam: D(
    '累计期望金 / 体力天', // cjk-ok
    'Cum.Gold / Stam Days',
    '累计资金 / 剧情周期', // cjk-ok
    'Cum.Funds / Arc Days'
  ), // cjk-ok
  oneSentencePlaceholder: L(
    '一句话生成全套数值（如：修仙主题小丑牌10底注筹码150包含九转金丹、诛仙剑阵）...', // cjk-ok
    'One-sentence suite (e.g. Xianxia Balatro 10 antes 150 chips)...'
  ),
  oneSentenceBtn: L('🤖 一句话生成全套数值', '🤖 Generate Full Suite'), // cjk-ok
  tabEntityTable: D(
    '卡牌/单位配表审计', // cjk-ok
    'Entity Budget Table',
    '主角底牌/反转技能审计表', // cjk-ok
    'Trump Card Audit Table'
  ), // cjk-ok
  tabJokerPlanet: D(
    '小丑槽位顺序 / 行星牌 / Boss盲注', // cjk-ok
    'Joker Order / Planets / Boss Blinds',
    '亮牌顺序倍增 / 名场面等级 / 反派封锁', // cjk-ok
    'Reveal Order / Climax Tiers / Villain Locks'
  ), // cjk-ok
  optimizeOrderBtn: D(
    '🔄 最优左加右乘重排', // cjk-ok
    '🔄 Optimize Slot Order',
    '🔄 最优先铺垫后王炸重排', // cjk-ok
    '🔄 Optimize Reveal Order'
  ), // cjk-ok
  wrongOrderLbl: D(
    '错位顺序(×Mult在左):', // cjk-ok
    'Wrong Order (×Mult Left):',
    '平铺直叙(先亮王炸):', // cjk-ok
    'Flat Order (Early Reveal):'
  ), // cjk-ok
  curOrderLbl: D('当前槽位得分:', 'Current Order:', '当前亮牌爽度:', 'Current Sequence:'), // cjk-ok
  optOrderLbl: D(
    '最优左加右乘得分:', // cjk-ok
    'Optimal Order:',
    '层层递进最高爽度:', // cjk-ok
    'Escalating Climax Score:'
  ), // cjk-ok
  orderGainLbl: D('摆位放大倍率:', 'Order Gain:', '叙事递进放大倍率:', 'Escalation Mult:'), // cjk-ok
  colHandPlanet: D(
    '德州牌型 / 行星牌', // cjk-ok
    'Poker Hand / Planet',
    '爽剧名场面桥段 / 升级册', // cjk-ok
    'Climax Trope / Upgrade'
  ), // cjk-ok
  colBaseChipsMult: L('初值 / 每级成长', 'Base / +Lv Step'), // cjk-ok
  colLv1Lv5Lv15: D(
    'Lv.1 / Lv.5 / Lv.15 裸分', // cjk-ok
    'Lv.1 / Lv.5 / Lv.15 Raw',
    '前期 / 中期 / 大结局 基础爽度', // cjk-ok
    'Act 1 / Mid / Finale Raw'
  ), // cjk-ok
  colWithJokers: D(
    'Lv.5 满小丑槽得分', // cjk-ok
    'Lv.5 + Optimal Jokers',
    '叠加4大靠山后总爆发', // cjk-ok
    'With Full Backing Burst'
  ), // cjk-ok
  colBlindName: D('Boss 盲注', 'Boss Blind', '反派针对性压制局', 'Villain Suppression Trap'), // cjk-ok
  colBlindRule: L('针对性封锁规则', 'Debuff Rule'), // cjk-ok
  colBlindTargetVsScore: D(
    '盲注目标 vs 实测得分', // cjk-ok
    'Target vs Achieved',
    '反派威压阈值 vs 主角爆发', // cjk-ok
    'Villain Threshold vs Burst'
  ), // cjk-ok
  tabBattlePassIap: D(
    '战令漏斗与礼包定价表', // cjk-ok
    'Battle Pass & IAP Pricing',
    '剧集付费卡点与充值档位表', // cjk-ok
    'Episode Paywall & Top-Up Tiers'
  ), // cjk-ok
  colPackName: D('商城礼包档位', 'IAP Pack Tier', '短剧充值/解锁档位', 'Drama Unlock Tier'), // cjk-ok
  colPackPrice: L('定价 USD', 'Price'), // cjk-ok
  colPackPulls: D(
    '直给抽数 + 折算抽数', // cjk-ok
    'Pulls + Bonus Equiv',
    '解锁集数 + 赠送金豆折算', // cjk-ok
    'Episodes + Bonus Coins'
  ), // cjk-ok
  colPackValuePct: L('性价比锚点 (Value%)', 'Value Ratio %'), // cjk-ok
  colBpLevel: D(
    '战令等级 / 毕业天数', // cjk-ok
    'BP Lv / Days',
    '追剧里程碑 / 追更天数', // cjk-ok
    'Binge Milestone / Days'
  ), // cjk-ok
  colBpFreePaid: D(
    '免费轨 / 付费轨奖励', // cjk-ok
    'Free / Paid Track',
    '免费看广告轨 / 会员解锁轨', // cjk-ok
    'Ad-Free Track / VIP Track'
  ), // cjk-ok
  colBpCumPulls: D(
    '累计免费/付费折算抽', // cjk-ok
    'Cum. Free / Paid Pulls',
    '累计免费/VIP解锁集数', // cjk-ok
    'Cum. Free / VIP Episodes'
  ), // cjk-ok
  tabExtendedGenres: L('自走棋追三 / 三路加注 / 响应链', 'Auto-Battler / 3-Lane Snap / Response'), // cjk-ok
  autoBattlerTitle: L(
    '自走棋 / 酒馆战棋：公共卡池抢卡稀释与 1★→2★→3★ 追三期望金币表', // cjk-ok
    'Auto-Battler Shared Pool & 1★→2★→3★ Star-Up Gold Expectation'
  ),
  colAbTier: L('棋子阶位', 'Cost Tier'), // cjk-ok
  colAbPool: L('卡池/被抢/最佳D牌级', 'Pool / Taken / Best Lv'), // cjk-ok
  colAb2Star: L('2★ 期望(D次/金币)', '2★ (Rolls/Gold)'), // cjk-ok
  colAb3Star: L('3★ 期望(D次/金币)', '3★ (Rolls/Gold)'), // cjk-ok
  colAbPower: L('1★ / 2★ / 3★ 战力', '1★ / 2★ / 3★ Power'), // cjk-ok
  snapTitlePrefix: L('三路战区比大小 (3局2胜率:', '3-Lane Win-2-of-3 ('), // cjk-ok
  snapTitleSuffix: L(
    '%) & 魔方翻倍加注 (1→2→4→8 Cube) EV 决策表', // cjk-ok
    '%) & Cube Doubling EV Matrix'
  ),
  colSnapScenario: L('加注博弈场景', 'Snap / Retreat Scenario'), // cjk-ok
  colSnapWinPct: L('当前胜率', 'Win %'), // cjk-ok
  colSnapPlayEv: L('完赛净期望 (EV)', 'Play-Out EV'), // cjk-ok
  colSnapRetreatCost: L('撤退止损成本', 'Retreat Cost'), // cjk-ok
  colSnapAction: L('最优决策', 'Optimal Action'), // cjk-ok
  responseChainTitle: L(
    '身份局攻防响应链（《三国杀》敌方手牌数 vs 【杀】命中 / 【闪】留存 / 【桃】救回 / 【无懈】反制率）', // cjk-ok
    'Tactical Response Chain (Enemy Hand Size vs Strike Hit / Dodge / Peach / Nullify Odds)'
  ),
  colRcHand: L('敌方手牌', 'Enemy Hand'), // cjk-ok
  colRcDodge: L('握【闪】率', 'Hold Dodge %'), // cjk-ok
  colRcStrike: L('单【杀】/双【杀】命中', '1-Strike / 2-Strike Hit'), // cjk-ok
  colRcPeachNull: L('濒死握【桃】/锦囊被【无懈】', 'Peach / Nullify %'), // cjk-ok
  colRcAdvice: L('战术决策建议', 'Tactical Verdict'), // cjk-ok
  deltaPatchBtn: L('🔧 增量微调', '🔧 Delta Patch'), // cjk-ok
  deltaPatchTip: L(
    '在保留当前卡牌与参数的基础上原地微调（如：高费卡伤害+20%、全卡费用-1、Boss血量翻倍、再加一张绝命毒师(1费10伤毒8)）', // cjk-ok
    'Patch existing workbench in-place (e.g. DMG +20%, Cost -1, Boss HP ×2, add card)'
  ),
  tabCardGallery: D(
    '实体卡牌图鉴墙', // cjk-ok
    'Visual Card Gallery',
    '主角底牌图鉴墙', // cjk-ok
    'Trump Card Gallery'
  ), // cjk-ok
  tabSynergyNash: D(
    '无限连检测 & 4×4互克', // cjk-ok
    'Infinite Loop & 4×4 Nash',
    '底牌连锁 & 4×4流派博弈', // cjk-ok
    'Trump Chain & 4×4 Matrix'
  ), // cjk-ok
  circuitBreakerBtn: L('🛡️ 一键熔断无限连', '🛡️ Circuit-Break Loops'), // cjk-ok
  synergyLoopTitle: D(
    '双卡协同矩阵与无限死循环 / OTK 秒杀预警', // cjk-ok
    'Synergy Matrix & Infinite Loop / OTK Detector',
    '双底牌连环反转协同与战力崩坏预警', // cjk-ok
    'Dual-Trump Reversal Synergy & Power Creep Detector'
  ), // cjk-ok
  colPairCards: D(
    '协同组合 (Card A + Card B)', // cjk-ok
    'Synergy Pair (A + B)',
    '连环底牌组合 (底牌 A + 底牌 B)', // cjk-ok
    'Trump Combo (A + B)'
  ), // cjk-ok
  colSynergyType: L('机制类型', 'Mechanism'), // cjk-ok
  colSynergyMult: L('叠乘/爆发强度', 'Power / Mult'), // cjk-ok
  colSynergyFix: L('防崩坏修复建议', 'Circuit-Breaker Advice'), // cjk-ok
  pvpNashTitle: L(
    '卡组对打互克矩阵与天梯均衡占比 (Replicator Dynamics)', // cjk-ok
    'Deck-vs-Deck Matchup Matrix & Meta Equilibrium'
  ), // cjk-ok
  pvpSourceLbl: L('真实对打模拟 · 每对局数', 'Simulated duels · runs/pair'), // cjk-ok
  colPvpArch: L('对战卡组', 'Deck'), // cjk-ok
  colNashShare: L('均衡出场率%', 'Equilibrium Share%'), // cjk-ok
  tabUpgradeDoctor: D(
    '卡牌升级(Card+) & 构筑体检', // cjk-ok
    'Card+ Upgrade & Deck Doctor',
    '底牌进阶(Card+) & 剧本节奏体检', // cjk-ok
    'Trump Upgrade & Pacing Doctor'
  ), // cjk-ok
  smithTopBtn: D(
    '🔨 一键敲升级S级卡', // cjk-ok
    '🔨 Smith Top S-Cards',
    '🔨 一键升阶核心王炸底牌', // cjk-ok
    '🔨 Upgrade Top Trump Cards'
  ), // cjk-ok
  autoSyncCombatLbl: D(
    '实时联动战斗', // cjk-ok
    'Live Combat Sync',
    '实时联动名场面推演', // cjk-ok
    'Live Climax Sync'
  ), // cjk-ok
  upgradeTableTitle: D(
    '卡牌升级差分 (Card ➔ Card+) 与篝火敲牌 ROI 优先级榜', // cjk-ok
    'Card Upgrade Diff (Card ➔ Card+) & Campfire Smith ROI',
    '底牌伏笔升阶 (初阶 ➔ 觉醒+) 与爽感暴涨优先级榜', // cjk-ok
    'Trump Card Awakening Diff & Climax ROI'
  ), // cjk-ok
  colBaseCard: D('原版卡牌 (Base)', 'Base Card', '初阶底牌 (伏笔)', 'Initial Trump'), // cjk-ok
  colUpgradedCard: D('升级版 (Card+)', 'Upgraded (Card+)', '完全体底牌 (觉醒+)', 'Awakened Trump+'), // cjk-ok
  colUpgradeType: L('强化类型', 'Upgrade Type'), // cjk-ok
  colUpgradeGain: L('等效收益增幅%', 'Value Gain %'), // cjk-ok
  colSmithPriority: D('篝火敲牌优先级', 'Smith Priority', '剧情升阶优先级', 'Awakening Priority'), // cjk-ok
  deckDoctorTitle: D(
    '卡组费用曲线与攻/防/过牌/倍增黄金比例体检仪', // cjk-ok
    'Mana Curve & Off/Def/Draw/Scale Composition Doctor',
    '剧本铺垫/隐忍/反转/王炸黄金节奏配比体检仪', // cjk-ok
    'Drama Setup/Endure/Reversal/Finisher Pacing Doctor'
  ), // cjk-ok
  colRoleName: D('构筑职能维度', 'Deck Role', '叙事桥段职能', 'Narrative Role'), // cjk-ok
  colRoleCountPct: L('当前张数 / 占比%', 'Count / Share%'), // cjk-ok
  colRoleTarget: L('黄金比例区间', 'Golden Range'), // cjk-ok
  colRoleVerdict: D('构筑诊断', 'Diagnosis', '节奏诊断', 'Pacing Verdict'), // cjk-ok
  pinBaselineBtn: L('📌 锁定基线快照', '📌 Pin Baseline'), // cjk-ok
  restoreBaselineBtn: L('↺ 回滚基线', '↺ Revert Baseline'), // cjk-ok
  abDiffTitle: L(
    '⚖️ 版本补丁 A/B 差分对比 (v1.0 Baseline ➔ v1.1 Current):', // cjk-ok
    '⚖️ Balance Patch A/B Diff (v1.0 ➔ v1.1):'
  ), // cjk-ok
  tabTacticalLab: D(
    '上手率 / 斩杀序列 / Boss压测', // cjk-ok
    'Hypergeom / Lethal / Boss Intent',
    '底牌上手率 / 最爽亮牌序列 / 反派压测', // cjk-ok
    'Reveal Odds / Climax Sequence / Villain Test'
  ), // cjk-ok
  tabDesignLab: L('效果引擎·AI战斗·经济闭环·校准', 'Effect Engine · AI · Economy · Calibration'), // cjk-ok
  tabCardLabMain: D(
    '⑤ 卡牌与单局实验室', // cjk-ok
    '5. Card & Run Lab',
    '⑤ 剧情连招与爽点实验室', // cjk-ok
    '5. Plot Combo & Climax Lab'
  ), // cjk-ok
  tabCardLabMainTip: D(
    '⑤ 卡牌与单局实验室 (DSL效果引擎 · 博弈树AI · 单局经济 · 自动配平)', // cjk-ok
    '5. Card & Run Lab (DSL · AI · Economy · Calibration)',
    '⑤ 剧情连招与爽点实验室 (底牌脚本 · 最佳打脸顺序求解 · 80集经济闭环 · 自动配平)', // cjk-ok
    '5. Plot Combo & Climax Lab (Trump DSL · Optimal Slap Solver · 80-Ep Economy)'
  ),
  aiPromptToggleBtn: L('🪄 AI 一句话生成/改表', '🪄 AI Prompt / Patch'), // cjk-ok
  presetExportMenuBtn: L('📦 预设与导出', '📦 Presets & Export'), // cjk-ok
  syncCanvasShortLbl: L('切预设同步画布', 'Sync Canvas'), // cjk-ok
  savePresetShortBtn: L('存为预设', 'Save'), // cjk-ok
  exportDataBundleMenuBtn: L('导出配表工程包 (JSON+CSV)', 'Export Data Tables (JSON+CSV)'), // cjk-ok
  importWorkbenchJsonBtn: L('导入工程 JSON', 'Import Workbench JSON'), // cjk-ok
  exportWorkbenchJsonBtn: L('导出工程 JSON', 'Export Workbench JSON'), // cjk-ok
  effectEngineBadge: L('效果引擎驱动', 'Effect Engine'), // cjk-ok
  effectEngineBadgeTip: L(
    '牌库含效果脚本或已开启效果引擎：本内核结果由卡牌效果引擎模拟', // cjk-ok
    'Deck has effect scripts or engine enabled: results come from the card effect engine'
  ), // cjk-ok
  hypergeomTitle: D(
    '超几何分布：Key卡上手率、Mulligan换牌与双卡Combo凑齐精算表', // cjk-ok
    'Hypergeometric Draw, Mulligan & 2-Card Combo Odds',
    '超几何分布：核心底牌及时亮出率与双底牌连环反转凑齐精算表', // cjk-ok
    'Key Trump Reveal Odds & Dual-Reversal Combo Probability'
  ), // cjk-ok
  colHgCard: D('核心卡牌', 'Key Card', '核心底牌', 'Key Trump Card'), // cjk-ok
  colHgCopies: D('投入张数', 'Copies', '铺垫频次', 'Setup Copies'), // cjk-ok
  colHgT1Mul: D(
    'T1裸抽 / 换牌后%', // cjk-ok
    'T1 Raw / Mulligan%',
    '首幕亮出 / 调度后%', // cjk-ok
    'Act-1 Raw / Tuned%'
  ), // cjk-ok
  colHgT2T3: D(
    'T2 / T3 累计上手%', // cjk-ok
    'T2 / T3 Seen%',
    '第2幕 / 第3幕 亮出率%', // cjk-ok
    'Act-2 / Act-3 Reveal%'
  ), // cjk-ok
  colHgThin3: D('精简3张牌T3提升', 'Thin-3 T3 Gain', '删减3处注水后提升', 'Trim-3 Filler Gain'), // cjk-ok
  lethalTitle: D(
    '单回合最高斩杀线求解器 & 出牌顺序操作上限 (Order-Sensitivity)', // cjk-ok
    'Single-Turn Lethal Solver & Play-Order Skill Ceiling',
    '单场最高打脸爽度求解器 & 亮底牌顺序上限 (先抑后扬 vs 平铺直叙)', // cjk-ok
    'Peak Climax Solver & Reveal-Order Multiplier'
  ), // cjk-ok
  naiveOrderLbl: D('萌新乱序出牌:', 'Naive Order:', '平铺直叙乱亮牌:', 'Flat Reveal Order:'), // cjk-ok
  optimalOrderLbl: D(
    '高手最优序列:', // cjk-ok
    'Optimal Sequence:',
    '黄金递进亮牌序列:', // cjk-ok
    'Optimal Climax Sequence:'
  ), // cjk-ok
  skillGapLbl: D('操作上限倍率:', 'Skill Ceiling:', '叙事张力放大倍率:', 'Tension Ceiling Mult:'), // cjk-ok
  bossIntentTitle: D(
    'Boss 4回合意图循环轴（蓄力/225%重击峰值/塞废牌污染/四连处决）压测', // cjk-ok
    'Boss 4-Turn Intent Cycle (Charge / 225% Spike / Status Pollution / 4-Hit)',
    '大反派 4幕施压循环轴（造势施压/225%当众羞辱峰值/泼脏水栽赃/绝境逼宫）压测', // cjk-ok
    'Villain 4-Act Pressure Cycle (Posture / 225% Humiliation / Frame-Up / Ultimatum)'
  ), // cjk-ok
  colBossTurn: D('Boss 回合意图', 'Boss Turn Intent', '反派施压幕次', 'Villain Act Intent'), // cjk-ok
  colBossRawBlk: D(
    '怪伤 / 期望护甲', // cjk-ok
    'Raw DMG / Block',
    '羞辱强度 / 主角定力', // cjk-ok
    'Suppression / Composure'
  ), // cjk-ok
  colBossNetLoss: D('净掉血缺口', 'Net HP Loss', '虐主受挫缺口', 'Angst Deficit'), // cjk-ok
  colBossSpikeRisk: D(
    '当回合暴毙风险%', // cjk-ok
    'Spike Death Risk%',
    '本幕崩盘弃剧风险%', // cjk-ok
    'Audience Drop Risk%'
  ), // cjk-ok
  colBossNote: D('机制压测诊断', 'Mechanism Diagnosis', '爽点承接诊断', 'Climax Pacing Diagnosis'), // cjk-ok
  dramaViewTag: L('短剧数值视图:', 'Short-Drama View:'), // cjk-ok
  dramaBtnLadder: L('第1~80集身份蜕变阶梯', 'Ep.1-80 Identity Ladder'), // cjk-ok
  dramaBtnWall: L('20幕正反派威压与付费卡点', '20-Act Villain Wall & Paywall'), // cjk-ok
  dramaBtnTrumps: L('主角成长乘区与6大打脸底牌', 'Growth Multiplier & 6 Trump Cards'), // cjk-ok
  dramaBtnClimaxSim: L('名场面逐幕反转推演', 'Scene-by-Scene Climax Sim'), // cjk-ok
  dramaBtnEncounters: L('奇遇贵人凑4大靠山 & 付费转化', '4-Tycoon Backing & Paywall Funnel'), // cjk-ok
  dramaPreviewBriefBtn: L('预览小说/剧本数值大纲', 'Preview Narrative Brief'), // cjk-ok
  dramaCopyBriefBtn: L('复制小说/剧本数值大纲', 'Copy Narrative Brief'), // cjk-ok
  dramaTotalChapLbl: L('动态总章/集数:', 'Total Chapters:'), // cjk-ok
  dramaSliceChapLbl: L('单章围栏预览: 第', 'Chapter Slice: Ch.'), // cjk-ok
  tabDeckDesigner: D('牌库构筑表', 'Deck Designer', '反转底牌构筑表', 'Trump Card Deck'), // cjk-ok
  tabCounterMatrix: D(
    '6机制克制矩阵', // cjk-ok
    '6-Boss Counter Matrix',
    '6类反派克制矩阵', // cjk-ok
    '6-Villain Counter Matrix'
  ), // cjk-ok
  tabRemovalRoi: D('删牌精简与定价ROI', 'Card Removal ROI', '删减注水桥段ROI', 'Filler Trim ROI'), // cjk-ok
  eliteRoomPctLbl: D('精英分岔房率%', 'Elite Room %', '高燃支线冲突率%', 'High-Stakes Subplot %'), // cjk-ok
  campfireRestLbl: D(
    '营火睡觉HP阈值%', // cjk-ok
    'Campfire Rest HP%',
    '过渡舒缓幕触发阈值%', // cjk-ok
    'Breather Scene Threshold%'
  ), // cjk-ok
  interestPer10GLbl: D(
    '每10金层复利', // cjk-ok
    'Interest / 10G',
    '人脉雪球复利系数', // cjk-ok
    'Network Snowball Rate'
  ), // cjk-ok
  competingArchLbl: D(
    '竞争流派池数', // cjk-ok
    'Archetype Pool',
    '竞争支线势力池数', // cjk-ok
    'Competing Faction Pools'
  ), // cjk-ok
  banSlotsLbl: D('禁用Ban位数', 'Ban Slots', '剪除无效支线数', 'Pruned Subplots'), // cjk-ok
  missPityBoostLbl: D('未中保底加权%', 'Miss Pity +%', '绝境贵人保底加权%', 'Crisis Pity Boost %'), // cjk-ok
  tabLootHistogram: D(
    '分布直方图', // cjk-ok
    'Distribution Histogram',
    '靠山奇遇分布直方图', // cjk-ok
    'Backing Distribution'
  ), // cjk-ok
  tabLootDilution: D(
    '扩池稀释与Ban位补偿表', // cjk-ok
    'Pool Dilution & Ban-Slot Matrix',
    '支线稀释与剪支线补偿表', // cjk-ok
    'Subplot Dilution & Pruning'
  ) // cjk-ok
}))
</script>

<template>
  <div
    class="mx-wb-panel"
    :class="{ 'is-full-screen': s.mode.value === 'workbench' }"
    @click="wbExportMenuOpen = false"
  >
    <!-- 顶部旗舰预设切换栏 + 子工作台标签 + 同步按钮 -->
    <header class="mx-wb-header">
      <div class="mx-wb-presets">
        <span class="mx-wb-preset-lbl">{{ uiText.presetLabel }}</span>
        <select
          class="mx-wb-select mx-wb-preset-select"
          :value="activeUserPresetId ? `user:${activeUserPresetId}` : wb.activePresetId"
          :title="currentPresetTooltip"
          @change="onPresetDropdownChange"
        >
          <optgroup :label="uiText.presetGroupBuiltin">
            <option v-for="pr in MX_WORKBENCH_PRESETS" :key="pr.id" :value="pr.id">
              {{ isZh ? pr.nameZh : pr.nameEn }}
            </option>
          </optgroup>
          <optgroup v-if="savedUserPresets.length > 0" :label="uiText.presetGroupUser">
            <option v-for="up in savedUserPresets" :key="up.id" :value="`user:${up.id}`">
              ★ {{ up.name }}
            </option>
          </optgroup>
        </select>

        <button
          v-if="activeUserPresetId"
          type="button"
          class="mx-wb-mini-btn"
          :title="uiText.deleteUserPresetTip"
          @click="removeUserPreset(activeUserPresetId)"
        >
          ×
        </button>

        <button
          type="button"
          class="mx-wb-mini-btn is-accent"
          :title="uiText.newBlankTip"
          @click="initBlankCustomWorkbench"
        >
          ✨ {{ uiText.newBlankBtn }}
        </button>

        <div class="mx-wb-presets-right">
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{ 'is-accent': aiPromptBarOpen }"
            @click="aiPromptBarOpen = !aiPromptBarOpen"
          >
            {{ uiText.aiPromptToggleBtn }} {{ aiPromptBarOpen ? '▴' : '▾' }}
          </button>

          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{ 'is-accent': bridgeBarOpen }"
            @click="bridgeBarOpen = !bridgeBarOpen"
          >
            🔗 {{ uiText.bridgeToggleBtn }} {{ bridgeBarOpen ? '▴' : '▾' }}
          </button>

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
            <span>{{ uiText.syncCanvasShortLbl }}</span>
          </label>

          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{ 'is-accent': s.mode.value === 'workbench' }"
            @click="toggleFullWorkbenchMode"
          >
            ⛶ {{ s.mode.value === 'workbench' ? uiText.splitScreenBtn : uiText.fullScreenBtn }}
          </button>

          <span v-if="!bridgeBarOpen && bridgeFeedback" class="mx-wb-bridge-feedback">
            ✓ {{ bridgeFeedback }}
          </span>
        </div>

        <input
          ref="jsonFileInputRef"
          type="file"
          accept=".json"
          style="display: none"
          @change="onJsonFileChange"
        />
      </div>

      <!-- ═════════════ AI 一句话生成 / 增量微调折叠栏 ═════════════ -->
      <div v-if="aiPromptBarOpen" class="mx-wb-bridge-bar">
        <div class="mx-wb-bridge-group" style="flex: 1">
          <span class="mx-wb-bridge-tag is-in">🪄 AI</span>
          <input
            v-model="oneSentencePrompt"
            type="text"
            class="mx-wb-cell-input"
            style="flex: 1; min-width: 240px; text-align: left"
            :placeholder="uiText.oneSentencePlaceholder"
            @keydown.enter="runOneSentenceWorkbench"
          />
          <button type="button" class="mx-wb-mini-btn is-accent" @click="runOneSentenceWorkbench">
            {{ uiText.oneSentenceBtn }}
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :title="uiText.deltaPatchTip"
            @click="runOneSentenceDeltaPatch"
          >
            {{ uiText.deltaPatchBtn }}
          </button>
        </div>
      </div>

      <!-- ═════════════ 版本补丁前/后快照 A/B 实时差分对比栏 (Balance Patch Snapshot Diff) ═════════════ -->
      <div
        v-if="snapshotDiffRes"
        class="mx-wb-bridge-bar"
        style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.35)"
      >
        <div class="mx-wb-bridge-group" style="flex-wrap: wrap; gap: 8px">
          <span class="mx-wb-bridge-tag is-in">{{ uiText.abDiffTitle }}</span>
          <span class="mx-wb-tag is-good mx-mono">
            Win: {{ snapshotDiffRes.winRateBaseline }}% ➔
            <strong>{{ snapshotDiffRes.winRateCurrent }}%</strong> ({{
              snapshotDiffRes.winRateDeltaPct >= 0
                ? `+${snapshotDiffRes.winRateDeltaPct}%`
                : `${snapshotDiffRes.winRateDeltaPct}%`
            }})
          </span>
          <span class="mx-wb-tag is-good mx-mono">
            TTK: {{ snapshotDiffRes.ttkBaseline }}T ➔
            <strong>{{ snapshotDiffRes.ttkCurrent }}T</strong> ({{
              snapshotDiffRes.ttkDeltaTurns >= 0
                ? `+${snapshotDiffRes.ttkDeltaTurns}T`
                : `${snapshotDiffRes.ttkDeltaTurns}T`
            }})
          </span>
          <span class="mx-wb-tag is-good mx-mono">
            Out: {{ snapshotDiffRes.finalOutputBaseline }} ➔
            <strong>{{ snapshotDiffRes.finalOutputCurrent }}</strong> ({{
              snapshotDiffRes.finalOutputDeltaPct >= 0
                ? `+${snapshotDiffRes.finalOutputDeltaPct}%`
                : `${snapshotDiffRes.finalOutputDeltaPct}%`
            }})
          </span>
          <span class="mx-wb-tag is-warn mx-mono">
            OP Cards: {{ snapshotDiffRes.opCountBaseline }} ➔
            <strong>{{ snapshotDiffRes.opCountCurrent }}</strong>
          </span>
          <span
            v-for="ed in snapshotDiffRes.entityDiffs.slice(0, 3)"
            :key="ed.entityId"
            class="mx-wb-tag mx-mono"
          >
            {{ ed.beforeSummary }} ➔ {{ ed.afterSummary }}
          </span>
          <button type="button" class="mx-wb-mini-btn" @click="restoreBaselineSnapshot">
            {{ uiText.restoreBaselineBtn }}
          </button>
          <button type="button" class="mx-wb-mini-btn" @click="clearBaselineSnapshot">×</button>
        </div>
      </div>

      <!-- ═════════════ 画布资源节点 ↔ 数值工作台 双向实时绑定栏（可折叠） ═════════════ -->
      <div v-if="bridgeBarOpen" class="mx-wb-bridge-bar">
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
          :title="uiText.tabCombatTip"
          @click="activeSubTab = 'combat'"
        >
          {{ uiText.tabCombat }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'envelope' }"
          :title="uiText.tabEnvelopeTip"
          @click="activeSubTab = 'envelope'"
        >
          {{ uiText.tabEnvelope }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'multiplier' }"
          :title="uiText.tabMultiplierTip"
          @click="activeSubTab = 'multiplier'"
        >
          {{ uiText.tabMultiplier }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'loot' }"
          :title="uiText.tabLootTip"
          @click="activeSubTab = 'loot'"
        >
          {{ uiText.tabLoot }}
        </button>
        <button
          type="button"
          class="mx-wb-subtab"
          :class="{ 'is-active': activeSubTab === 'card_lab' }"
          :title="uiText.tabCardLabMainTip"
          @click="activeSubTab = 'card_lab'"
        >
          🧪 {{ uiText.tabCardLabMain }}
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
            class="mx-wb-mini-btn"
            :class="{ 'is-accent': stressAuditRunning }"
            :disabled="stressAuditRunning"
            @click="runHighPrecisionStressAudit"
          >
            🔬
            {{
              stressAuditRunning
                ? `${uiText.stressAuditRunningBtn} ${stressAuditProgress}%`
                : uiText.stressAuditBtn
            }}
          </button>

          <div class="mx-wb-export-wrap" @click.stop>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': wbExportMenuOpen }"
              @click="wbExportMenuOpen = !wbExportMenuOpen"
            >
              {{ uiText.presetExportMenuBtn }} ▾
            </button>
            <div v-if="wbExportMenuOpen" class="mx-wb-export-menu">
              <div class="mx-wb-export-row">
                <input
                  type="text"
                  class="mx-wb-cell-input"
                  style="flex: 1; text-align: left"
                  :value="wb.multiplier.title"
                  :placeholder="L('输入体系名称...', 'System name...')"
                  @input="
                    mutateWb(
                      (w) => (w.multiplier.title = ($event.target as HTMLInputElement).value)
                    )
                  "
                />
                <!-- cjk-ok -->
                <button
                  type="button"
                  class="mx-wb-mini-btn is-accent"
                  @click="
                    () => {
                      saveCurrentAsUserPreset()
                      wbExportMenuOpen = false
                    }
                  "
                >
                  💾 {{ uiText.savePresetShortBtn }}
                </button>
              </div>
              <hr />
              <button
                type="button"
                @click="
                  () => {
                    exportFullGameDataTables()
                    wbExportMenuOpen = false
                  }
                "
              >
                📦 {{ uiText.exportDataBundleMenuBtn }}
              </button>
              <button
                type="button"
                @click="
                  () => {
                    exportCommercialQaReport()
                    wbExportMenuOpen = false
                  }
                "
              >
                📋 {{ uiText.exportQaReportBtn }}
              </button>
              <button
                type="button"
                @click="
                  () => {
                    exportRuntimeEngineCode('unity_cs')
                    wbExportMenuOpen = false
                  }
                "
              >
                🎮 {{ uiText.exportUnityCsBtn }}
              </button>
              <button
                type="button"
                @click="
                  () => {
                    exportRuntimeEngineCode('godot_gd')
                    wbExportMenuOpen = false
                  }
                "
              >
                🤖 {{ uiText.exportGodotGdBtn }}
              </button>
              <hr />
              <button
                type="button"
                @click="
                  () => {
                    triggerWorkbenchJsonImport()
                    wbExportMenuOpen = false
                  }
                "
              >
                📥 {{ uiText.importWorkbenchJsonBtn }}
              </button>
              <button
                type="button"
                @click="
                  () => {
                    exportWorkbenchJson()
                    wbExportMenuOpen = false
                  }
                "
              >
                📤 {{ uiText.exportWorkbenchJsonBtn }}
              </button>
            </div>
          </div>

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

      <!-- ═════════════ 短剧 80 集角色成长与爽点数值导览栏 (Short-Drama Progression Guide Bar) ═════════════ -->
      <div
        v-if="isShortDramaMode"
        class="mx-wb-bridge-bar"
        style="background: rgba(168, 85, 247, 0.08); border-color: rgba(168, 85, 247, 0.35)"
      >
        <div class="mx-wb-bridge-group" style="flex-wrap: wrap; gap: 6px; width: 100%">
          <span
            class="mx-wb-bridge-tag"
            style="background: rgba(168, 85, 247, 0.22); color: #c084fc"
          >
            🎬 {{ uiText.dramaViewTag }}
          </span>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{
              'is-accent': activeSubTab === 'envelope' && envelopeRightView === 'level_curve'
            }"
            @click="jumpToShortDramaView('level_curve')"
          >
            📈 {{ uiText.dramaBtnLadder }}
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{
              'is-accent': activeSubTab === 'envelope' && envelopeRightView === 'floors'
            }"
            @click="jumpToShortDramaView('envelope_floors')"
          >
            🏰 {{ uiText.dramaBtnWall }}
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{
              'is-accent': activeSubTab === 'multiplier' && multiplierRightView === 'entities'
            }"
            @click="jumpToShortDramaView('trump_cards')"
          >
            🃏 {{ uiText.dramaBtnTrumps }}
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{
              'is-accent': activeSubTab === 'combat' && deckRightView === 'battle_log'
            }"
            @click="jumpToShortDramaView('climax_sim')"
          >
            ⚔ {{ uiText.dramaBtnClimaxSim }}
          </button>
          <button
            type="button"
            class="mx-wb-mini-btn"
            :class="{ 'is-accent': activeSubTab === 'loot' && lootRightView === 'histogram' }"
            @click="jumpToShortDramaView('encounters')"
          >
            🤝 {{ uiText.dramaBtnEncounters }}
          </button>

          <span
            style="
              margin-left: auto;
              display: inline-flex;
              align-items: center;
              gap: 5px;
              flex-wrap: wrap;
            "
          >
            <label class="mx-wb-inline-field" style="margin: 0">
              <span>{{ uiText.dramaTotalChapLbl }}</span>
              <input
                v-model.number="wb.roguelikeEnvelope.levelMax"
                type="number"
                min="10"
                max="5000"
                step="10"
                class="mx-wb-input"
                style="width: 58px"
              />
            </label>
            <label class="mx-wb-inline-field" style="margin: 0">
              <span>{{ uiText.dramaSliceChapLbl }}</span>
              <input
                v-model.number="dramaPreviewChapter"
                type="number"
                min="1"
                :max="wb.roguelikeEnvelope.levelMax || 800"
                step="1"
                class="mx-wb-input"
                style="width: 52px"
              />
            </label>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': narrativeBriefPreviewOpen }"
              @click="narrativeBriefPreviewOpen = !narrativeBriefPreviewOpen"
            >
              📖 {{ uiText.dramaPreviewBriefBtn }}
              {{ narrativeBriefPreviewOpen ? '▴' : '▾' }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn is-accent"
              @click="copyNarrativeBriefToClipboard"
            >
              📋 {{ uiText.dramaCopyBriefBtn }}
            </button>
          </span>
        </div>

        <pre
          v-if="narrativeBriefPreviewOpen"
          class="mx-mono"
          style="
            width: 100%;
            max-height: 150px;
            overflow: auto;
            margin: 4px 0 0;
            padding: 6px 8px;
            border-radius: 5px;
            background: var(--bg-panel);
            border: 1px solid var(--border);
            font-size: 10px;
            line-height: 1.45;
            white-space: pre-wrap;
          "
          >{{ narrativeBriefMarkdown }}</pre>
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
          <span
            v-if="
              (wb.combatKernel.kernel === 'deck_cycle' &&
                mxShouldUseEffectEngine(wb.combatKernel)) ||
              (wb.combatKernel.kernel === 'mana_tempo' &&
                mxShouldUseEffectEngineForMana(wb.combatKernel)) ||
              (wb.combatKernel.kernel === 'action_bar' && mxShouldUseAtbEngine(wb.combatKernel))
            "
            class="mx-wb-tag is-good"
            :title="uiText.effectEngineBadgeTip"
          >
            🧪 {{ uiText.effectEngineBadge }} ({{ wb.combatKernel.playPolicy ?? 'greedy' }})
          </span>
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

      <!-- 中间 SVG 曲线图（支持悬停十字准星与点击跳转战报回合） -->
      <div class="mx-wb-chart-box" :title="uiText.chartClickHint">
        <div v-if="hoveredCombatPoint" class="mx-wb-chart-tooltip">
          <strong>T{{ hoveredCombatPoint.pt.turn }}</strong>
          <span>
            P50: {{ hoveredCombatPoint.pt.primaryP50 }} ({{ hoveredCombatPoint.pt.primaryP10 }}~{{
              hoveredCombatPoint.pt.primaryP90
            }})
          </span>
          <span>Sec: {{ hoveredCombatPoint.pt.secondaryMean }}</span>
          <span>Kill%: {{ hoveredCombatPoint.pt.ratePct }}%</span>
        </div>
        <svg
          :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
          class="mx-wb-svg is-interactive"
          @mousemove="onCombatSvgMove"
          @mouseleave="hoverCombatTurnIdx = null"
          @click="onCombatSvgClick"
        >
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
          <g v-if="hoveredCombatPoint">
            <line
              :x1="hoveredCombatPoint.x"
              :y1="PAD_T"
              :x2="hoveredCombatPoint.x"
              :y2="SVG_H - PAD_B"
              stroke="var(--accent)"
              stroke-width="1"
              stroke-dasharray="2 2"
            />
            <circle
              :cx="hoveredCombatPoint.x"
              :cy="hoveredCombatPoint.yP50"
              r="3.5"
              fill="#3b82f6"
              stroke="#fff"
              stroke-width="1"
            />
            <circle
              :cx="hoveredCombatPoint.x"
              :cy="hoveredCombatPoint.ySec"
              r="3"
              fill="#10b981"
              stroke="#fff"
              stroke-width="1"
            />
          </g>
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
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': actionBarRightView === 'tornado' }"
                @click="actionBarRightView = 'tornado'"
              >
                🌪 {{ uiText.tabTornado }}
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

          <table v-else-if="actionBarRightView === 'timeline'" class="mx-wb-table">
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

          <table v-else class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colParamLever }}</th>
                <th>{{ uiText.colLowWin }}</th>
                <th>{{ uiText.colBaseWin }}</th>
                <th>{{ uiText.colHighWin }}</th>
                <th>{{ uiText.colSwingAmplitude }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(bar, bIdx) in sensitivityTornadoRes"
                :key="bar.paramId"
                :class="{ 'is-best-row': bIdx === 0 }"
              >
                <td>
                  <strong>{{ isZh ? bar.labelZh : bar.labelEn }}</strong>
                  <span class="mx-mono" style="margin-left: 4px; opacity: 0.75">
                    ({{ bar.lowValueLabel }} / {{ bar.baseValueLabel }} / {{ bar.highValueLabel }})
                  </span>
                </td>
                <td class="mx-mono">{{ bar.lowParamWinRatePct }}%</td>
                <td class="mx-mono">{{ bar.baseWinRatePct }}%</td>
                <td class="mx-mono">{{ bar.highParamWinRatePct }}%</td>
                <td class="mx-mono">
                  <span
                    class="mx-wb-tag"
                    :class="
                      bar.swingPct >= 20 ? 'is-bad' : bar.swingPct >= 8 ? 'is-warn' : 'is-good'
                    "
                  >
                    ±{{ bar.swingPct }}%
                  </span>
                </td>
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
                🃏 {{ uiText.tabDeckDesigner }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'counter_matrix' }"
                @click="deckRightView = 'counter_matrix'"
              >
                🛡 {{ uiText.tabCounterMatrix }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'removal_roi' }"
                @click="deckRightView = 'removal_roi'"
              >
                ✂ {{ uiText.tabRemovalRoi }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'archetype_meta' }"
                @click="deckRightView = 'archetype_meta'"
              >
                ⚖ {{ uiText.tabArchetypeMeta }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'battle_log' }"
                @click="deckRightView = 'battle_log'"
              >
                📜 {{ uiText.tabBattleLog }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'card_telemetry' }"
                @click="deckRightView = 'card_telemetry'"
              >
                📊 {{ uiText.tabCardTelemetry }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': deckRightView === 'tornado' }"
                @click="deckRightView = 'tornado'"
              >
                🌪 {{ uiText.tabTornado }}
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

          <!-- 商业产品级：4流派天梯多样性与生态平衡矩阵（支持一键载入编辑与自定义覆写槽位） -->
          <div v-else-if="deckRightView === 'archetype_meta'">
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
                  <th></th>
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
                    <span
                      v-if="
                        arc.archetypeId !== 'current_custom' &&
                        wb.combatKernel.customArchetypeDecks?.[arc.archetypeId]?.length
                      "
                      class="mx-wb-tag is-good"
                      style="margin-left: 4px"
                    >
                      {{ uiText.customSlotTag }}
                    </span>
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
                  <td>
                    <div
                      v-if="arc.archetypeId !== 'current_custom'"
                      class="mx-wb-toolbar-btns"
                      style="gap: 2px"
                    >
                      <button
                        type="button"
                        class="mx-wb-mini-btn"
                        @click="loadArchetypeIntoEditor(arc.archetypeId)"
                      >
                        {{ uiText.loadSlotBtn }}
                      </button>
                      <button
                        type="button"
                        class="mx-wb-mini-btn is-accent"
                        @click="saveCurrentDeckToArchetypeSlot(arc.archetypeId)"
                      >
                        {{ uiText.saveSlotBtn }}
                      </button>
                      <button
                        v-if="wb.combatKernel.customArchetypeDecks?.[arc.archetypeId]?.length"
                        type="button"
                        class="mx-wb-mini-btn"
                        @click="resetCustomArchetypeSlot(arc.archetypeId)"
                      >
                        {{ uiText.resetSlotBtn }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 商业产品级：单局（Run #1）逐回合白盒出牌、遗物触发与Boss反击复盘战报 -->
          <table v-else-if="deckRightView === 'battle_log'" class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colTurn }}</th>
                <th>{{ uiText.colCardsPlayed }}</th>
                <th>{{ uiText.colEnergyUsed }}</th>
                <th>{{ uiText.colDmgBlk }}</th>
                <th>{{ uiText.colRelicProc }}</th>
                <th>{{ uiText.colEnemyAfter }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in combatRes.battleReplayLog ?? []"
                :key="item.turn"
                :class="{
                  'is-best-row': selectedCombatTurn === item.turn,
                  'is-warn-row': item.relicsTriggered.length > 0,
                  'is-enemy-row': item.playerHpAfter <= 0
                }"
                @click="selectedCombatTurn = item.turn"
              >
                <td class="mx-mono">
                  <strong>T{{ item.turn }}</strong>
                </td>
                <td>
                  <span v-if="!item.cardsPlayed.length" class="mx-mono">
                    {{ uiText.noCardsPlayed }}
                  </span>
                  <span
                    v-for="(cn, cIdx) in item.cardsPlayed"
                    :key="cIdx"
                    class="mx-wb-tag"
                    style="margin-right: 3px; background: var(--bg-panel)"
                  >
                    {{ cn }}
                  </span>
                </td>
                <td class="mx-mono">{{ item.energyUsed }}</td>
                <td class="mx-mono">{{ item.damageDealt }} / +{{ item.blockGained }}</td>
                <td>
                  <span
                    v-for="(rl, rIdx) in item.relicsTriggered"
                    :key="rIdx"
                    class="mx-wb-tag is-good"
                    style="margin-right: 2px"
                  >
                    {{ rl }}
                  </span>
                  <span v-if="!item.relicsTriggered.length" class="mx-mono">-</span>
                </td>
                <td class="mx-mono">
                  {{ item.enemyAction }} (HP {{ item.playerHpAfter }}/{{ item.enemyHpAfter }})
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 商业产品级：单卡抓位归因、输出贡献占比与卡手弃置率遥测 -->
          <table v-else-if="deckRightView === 'card_telemetry'" class="mx-wb-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Cost×Cnt</th>
                <th>{{ uiText.colPlaysPerRun }}</th>
                <th>{{ uiText.colOutputShare }}</th>
                <th>{{ uiText.colStrandedPct }}</th>
                <th>{{ uiText.colWinDelta }}</th>
                <th>{{ uiText.colPickGrade }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ct in combatRes.cardTelemetry ?? []"
                :key="ct.id"
                :class="{
                  'is-best-row': ct.grade === 'S_must_pick',
                  'is-enemy-row': ct.grade === 'C_brick_trap'
                }"
              >
                <td>
                  <strong>{{ ct.name }}</strong>
                </td>
                <td class="mx-mono">{{ ct.cost }}E × {{ ct.count }}</td>
                <td class="mx-mono">{{ ct.avgPlaysPerRun }}</td>
                <td class="mx-mono">{{ ct.outputSharePct }}%</td>
                <td class="mx-mono">{{ ct.strandedInHandPct }}%</td>
                <td class="mx-mono">
                  {{
                    ct.playedWinDeltaPct > 0
                      ? `+${ct.playedWinDeltaPct}%`
                      : `${ct.playedWinDeltaPct}%`
                  }}
                </td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      ct.grade === 'S_must_pick'
                        ? 'is-good'
                        : ct.grade === 'C_brick_trap'
                          ? 'is-bad'
                          : 'is-warn'
                    "
                  >
                    {{
                      ct.grade === 'S_must_pick'
                        ? uiText.gradeS
                        : ct.grade === 'A_core'
                          ? uiText.gradeA
                          : ct.grade === 'B_filler'
                            ? uiText.gradeB
                            : uiText.gradeC
                    }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 商业产品级：CRN 参数敏感度龙卷风图 -->
          <table v-else class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colParamLever }}</th>
                <th>{{ uiText.colLowWin }}</th>
                <th>{{ uiText.colBaseWin }}</th>
                <th>{{ uiText.colHighWin }}</th>
                <th>{{ uiText.colSwingAmplitude }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(bar, bIdx) in sensitivityTornadoRes"
                :key="bar.paramId"
                :class="{ 'is-best-row': bIdx === 0 }"
              >
                <td>
                  <strong>{{ isZh ? bar.labelZh : bar.labelEn }}</strong>
                  <span class="mx-mono" style="margin-left: 4px; opacity: 0.75">
                    ({{ bar.lowValueLabel }} / {{ bar.baseValueLabel }} / {{ bar.highValueLabel }})
                  </span>
                </td>
                <td class="mx-mono">{{ bar.lowParamWinRatePct }}%</td>
                <td class="mx-mono">{{ bar.baseWinRatePct }}%</td>
                <td class="mx-mono">{{ bar.highParamWinRatePct }}%</td>
                <td class="mx-mono">
                  <span
                    class="mx-wb-tag"
                    :class="
                      bar.swingPct >= 20 ? 'is-bad' : bar.swingPct >= 8 ? 'is-warn' : 'is-good'
                    "
                  >
                    ±{{ bar.swingPct }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else>
          <div class="mx-wb-table-toolbar">
            <div class="mx-wb-toolbar-btns">
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': manaRightView === 'cards' }"
                @click="manaRightView = 'cards'"
              >
                💎 {{ L('法力曲线卡组表', 'Mana Curve Deck') }}
                <!-- cjk-ok -->
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': manaRightView === 'battle_log' }"
                @click="manaRightView = 'battle_log'"
              >
                📜 {{ uiText.tabBattleLog }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': manaRightView === 'card_telemetry' }"
                @click="manaRightView = 'card_telemetry'"
              >
                📊 {{ uiText.tabCardTelemetry }}
              </button>
              <button
                type="button"
                class="mx-wb-mini-btn"
                :class="{ 'is-accent': manaRightView === 'tornado' }"
                @click="manaRightView = 'tornado'"
              >
                🌪 {{ uiText.tabTornado }}
              </button>
            </div>
            <div v-if="manaRightView === 'cards'" class="mx-wb-toolbar-btns">
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
          <table v-if="manaRightView === 'cards'" class="mx-wb-table">
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

          <table v-else-if="manaRightView === 'battle_log'" class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colTurn }}</th>
                <th>{{ uiText.colCardsPlayed }}</th>
                <th>{{ uiText.colEnergyUsed }}</th>
                <th>{{ uiText.colDmgBlk }}</th>
                <th>{{ uiText.colRelicProc }}</th>
                <th>{{ uiText.colEnemyAfter }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in combatRes.battleReplayLog ?? []"
                :key="item.turn"
                :class="{
                  'is-best-row': selectedCombatTurn === item.turn,
                  'is-warn-row': item.relicsTriggered.length > 0
                }"
                @click="selectedCombatTurn = item.turn"
              >
                <td class="mx-mono">
                  <strong>T{{ item.turn }}</strong>
                </td>
                <td>
                  <span v-if="!item.cardsPlayed.length" class="mx-mono">
                    {{ uiText.noCardsPlayed }}
                  </span>
                  <span
                    v-for="(cn, cIdx) in item.cardsPlayed"
                    :key="cIdx"
                    class="mx-wb-tag"
                    style="margin-right: 3px; background: var(--bg-panel)"
                  >
                    {{ cn }}
                  </span>
                </td>
                <td class="mx-mono">{{ item.energyUsed }}</td>
                <td class="mx-mono">{{ item.damageDealt }} / {{ item.blockGained }}</td>
                <td>
                  <span
                    v-for="(rl, rIdx) in item.relicsTriggered"
                    :key="rIdx"
                    class="mx-wb-tag is-good"
                  >
                    {{ rl }}
                  </span>
                  <span v-if="!item.relicsTriggered.length" class="mx-mono">-</span>
                </td>
                <td class="mx-mono">{{ item.enemyAction }} (HP {{ item.enemyHpAfter }})</td>
              </tr>
            </tbody>
          </table>

          <table v-else-if="manaRightView === 'card_telemetry'" class="mx-wb-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Cost×Cnt</th>
                <th>{{ uiText.colPlaysPerRun }}</th>
                <th>{{ uiText.colOutputShare }}</th>
                <th>{{ uiText.colStrandedPct }}</th>
                <th>{{ uiText.colWinDelta }}</th>
                <th>{{ uiText.colPickGrade }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="ct in combatRes.cardTelemetry ?? []"
                :key="ct.id"
                :class="{
                  'is-best-row': ct.grade === 'S_must_pick',
                  'is-enemy-row': ct.grade === 'C_brick_trap'
                }"
              >
                <td>
                  <strong>{{ ct.name }}</strong>
                </td>
                <td class="mx-mono">{{ ct.cost }}M × {{ ct.count }}</td>
                <td class="mx-mono">{{ ct.avgPlaysPerRun }}</td>
                <td class="mx-mono">{{ ct.outputSharePct }}%</td>
                <td class="mx-mono">{{ ct.strandedInHandPct }}%</td>
                <td class="mx-mono">
                  {{
                    ct.playedWinDeltaPct > 0
                      ? `+${ct.playedWinDeltaPct}%`
                      : `${ct.playedWinDeltaPct}%`
                  }}
                </td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      ct.grade === 'S_must_pick'
                        ? 'is-good'
                        : ct.grade === 'C_brick_trap'
                          ? 'is-bad'
                          : 'is-warn'
                    "
                  >
                    {{
                      ct.grade === 'S_must_pick'
                        ? uiText.gradeS
                        : ct.grade === 'A_core'
                          ? uiText.gradeA
                          : ct.grade === 'B_filler'
                            ? uiText.gradeB
                            : uiText.gradeC
                    }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <table v-else class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colParamLever }}</th>
                <th>{{ uiText.colLowWin }}</th>
                <th>{{ uiText.colBaseWin }}</th>
                <th>{{ uiText.colHighWin }}</th>
                <th>{{ uiText.colSwingAmplitude }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(bar, bIdx) in sensitivityTornadoRes"
                :key="bar.paramId"
                :class="{ 'is-best-row': bIdx === 0 }"
              >
                <td>
                  <strong>{{ isZh ? bar.labelZh : bar.labelEn }}</strong>
                  <span class="mx-mono" style="margin-left: 4px; opacity: 0.75">
                    ({{ bar.lowValueLabel }} / {{ bar.baseValueLabel }} / {{ bar.highValueLabel }})
                  </span>
                </td>
                <td class="mx-mono">{{ bar.lowParamWinRatePct }}%</td>
                <td class="mx-mono">{{ bar.baseWinRatePct }}%</td>
                <td class="mx-mono">{{ bar.highParamWinRatePct }}%</td>
                <td class="mx-mono">
                  <span
                    class="mx-wb-tag"
                    :class="
                      bar.swingPct >= 20 ? 'is-bad' : bar.swingPct >= 8 ? 'is-warn' : 'is-good'
                    "
                  >
                    ±{{ bar.swingPct }}%
                  </span>
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
            <span>{{ uiText.eliteRoomPctLbl }}</span>
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
            <span>{{ uiText.campfireRestLbl }}</span>
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
            <span>{{ uiText.interestPer10GLbl }}</span>
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

      <!-- 中间剪刀差包络图（蓝色带：玩家 P10~P90 战力；红虚线：怪物难度膨胀墙；支持悬停十字准星与点击高亮楼层） -->
      <div class="mx-wb-chart-box" :title="uiText.chartClickHint">
        <div v-if="hoveredEnvelopePoint" class="mx-wb-chart-tooltip">
          <strong>F{{ hoveredEnvelopePoint.pt.floor }}</strong>
          <span>
            Player P50: {{ hoveredEnvelopePoint.pt.playerP50 }} ({{
              hoveredEnvelopePoint.pt.playerP10
            }}~{{ hoveredEnvelopePoint.pt.playerP90 }})
          </span>
          <span>Enemy: {{ hoveredEnvelopePoint.pt.enemyPower }}</span>
          <span>Surv: {{ hoveredEnvelopePoint.pt.survivalRatePct }}%</span>
        </div>
        <svg
          :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
          class="mx-wb-svg is-interactive"
          @mousemove="onEnvelopeSvgMove"
          @mouseleave="hoverEnvelopeFloorIdx = null"
          @click="onEnvelopeSvgClick"
        >
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
          <g v-if="hoveredEnvelopePoint">
            <line
              :x1="hoveredEnvelopePoint.x"
              :y1="PAD_T"
              :x2="hoveredEnvelopePoint.x"
              :y2="SVG_H - PAD_B"
              stroke="var(--accent)"
              stroke-width="1"
              stroke-dasharray="2 2"
            />
            <circle
              :cx="hoveredEnvelopePoint.x"
              :cy="hoveredEnvelopePoint.yPlayer"
              r="3.5"
              fill="#2563eb"
              stroke="#fff"
              stroke-width="1"
            />
            <circle
              :cx="hoveredEnvelopePoint.x"
              :cy="hoveredEnvelopePoint.yEnemy"
              r="3"
              fill="#dc2626"
              stroke="#fff"
              stroke-width="1"
            />
          </g>
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

      <!-- 右侧逐层对比表 / A0~A20 进阶终局阶梯矩阵 -->
      <div class="mx-wb-table-box">
        <div class="mx-wb-table-toolbar">
          <div class="mx-wb-toolbar-btns">
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': envelopeRightView === 'floors' }"
              @click="envelopeRightView = 'floors'"
            >
              🏰 {{ uiText.tabEnvelopeFloors }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': envelopeRightView === 'ascension_ladder' }"
              @click="envelopeRightView = 'ascension_ladder'"
            >
              🔥 {{ uiText.tabAscensionLadder }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': envelopeRightView === 'level_curve' }"
              @click="envelopeRightView = 'level_curve'"
            >
              📈 {{ uiText.tabLevelCurve }}
            </button>
          </div>
        </div>

        <table v-if="envelopeRightView === 'floors'" class="mx-wb-table">
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
                'is-best-row': selectedEnvelopeFloor === pt.floor,
                'is-warn-row': pt.status === 'difficulty_wall',
                'is-enemy-row': pt.isBoss
              }"
              @click="selectedEnvelopeFloor = pt.floor"
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

        <table v-else-if="envelopeRightView === 'ascension_ladder'" class="mx-wb-table">
          <thead>
            <tr>
              <th>{{ uiText.colAscensionTier }}</th>
              <th>{{ uiText.colAscModifier }}</th>
              <th>{{ uiText.colAscClear }}</th>
              <th>{{ uiText.colDoubleBoss }}</th>
              <th>Meta 50%</th>
              <th>{{ uiText.colAscVerdict }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in ascensionLadderRes"
              :key="row.code"
              :class="{
                'is-best-row': row.code === 'A0',
                'is-warn-row': row.verdict === 'brutal_fair',
                'is-enemy-row': row.verdict === 'overtuned_wall'
              }"
            >
              <td>
                <strong>{{ isZh ? row.nameZh : row.nameEn }}</strong>
              </td>
              <td>{{ isZh ? row.modifierDescZh : row.modifierDescEn }}</td>
              <td class="mx-mono">{{ row.clearRatePct }}%</td>
              <td class="mx-mono">{{ row.doubleBossPassPct }}%</td>
              <td class="mx-mono">{{ row.metaRunsTo50Pct }} runs</td>
              <td>
                <span
                  class="mx-wb-tag"
                  :class="
                    row.verdict === 'sweet_spot'
                      ? 'is-good'
                      : row.verdict === 'brutal_fair' || row.verdict === 'too_easy'
                        ? 'is-warn'
                        : 'is-bad'
                  "
                >
                  {{
                    row.verdict === 'sweet_spot'
                      ? uiText.ascSweetSpot
                      : row.verdict === 'brutal_fair'
                        ? uiText.ascBrutalFair
                        : row.verdict === 'too_easy'
                          ? uiText.ascTooEasy
                          : uiText.ascOvertuned
                  }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Lv.1 ~ Lv.Max 角色/武器突破成长与经验养成曲线表 -->
        <div v-else>
          <div class="mx-wb-table-toolbar" style="margin-bottom: 6px; flex-wrap: wrap; gap: 6px">
            <label class="mx-wb-inline-field">
              <span>{{ uiText.lvMaxLbl }}</span>
              <input
                v-model.number="wb.roguelikeEnvelope.levelMax"
                type="number"
                min="10"
                max="5000"
                step="10"
                class="mx-wb-input"
                style="width: 60px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.lvGrowthLbl }}</span>
              <input
                v-model.number="wb.roguelikeEnvelope.levelStatGrowthPct"
                type="number"
                min="1"
                max="20"
                step="0.5"
                class="mx-wb-input"
                style="width: 52px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.lvAscIntervalLbl }}</span>
              <input
                v-model.number="wb.roguelikeEnvelope.levelAscensionInterval"
                type="number"
                min="5"
                max="500"
                step="5"
                class="mx-wb-input"
                style="width: 54px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.lvAscBonusLbl }}</span>
              <input
                v-model.number="wb.roguelikeEnvelope.levelAscensionBonusPct"
                type="number"
                min="0"
                max="80"
                step="2"
                class="mx-wb-input"
                style="width: 48px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.lvXpExpLbl }}</span>
              <input
                v-model.number="wb.roguelikeEnvelope.levelXpExponent"
                type="number"
                min="1.1"
                max="3.5"
                step="0.05"
                class="mx-wb-input"
                style="width: 52px"
              />
            </label>
            <button
              type="button"
              class="mx-wb-mini-btn"
              @click="showAllLevelRows = !showAllLevelRows"
            >
              {{ showAllLevelRows ? uiText.lvShowMilestonesBtn : uiText.lvShowAllBtn }}
            </button>
          </div>
          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colLvPhase }}</th>
                <th>{{ uiText.colLvAtkHpDef }}</th>
                <th>{{ uiText.colLvXpNeed }}</th>
                <th>{{ uiText.colLvGoldMats }}</th>
                <th>{{ uiText.colLvStamDays }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in showAllLevelRows
                  ? levelProgressionRes.rows
                  : levelProgressionRes.milestones"
                :key="r.level"
                :class="{
                  'is-best-row': r.level === 1 || r.level === levelProgressionRes.maxLevel,
                  'is-warn-row': r.isBreakthrough
                }"
              >
                <td class="mx-mono">
                  <strong>Lv.{{ r.level }}</strong>
                  <span class="mx-wb-tag is-good" style="margin-left: 4px"
                    >★A{{ r.ascensionStage }}</span
                  >
                </td>
                <td class="mx-mono">{{ r.hp }} / {{ r.atk }} / {{ r.def }}</td>
                <td class="mx-mono">{{ r.xpRequired }} / {{ r.cumulativeXp }}</td>
                <td class="mx-mono">
                  {{ r.goldCost }}G
                  <span v-if="r.breakthroughMats > 0" class="mx-wb-tag is-warn">
                    +{{ r.breakthroughMats }} Mat
                  </span>
                </td>
                <td class="mx-mono">{{ r.staminaDaysToReach }}d</td>
              </tr>
            </tbody>
          </table>
        </div>
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

      <!-- 右侧：卡牌/随从/式神配表超模审计与交互设计表 / 小丑槽位顺序与行星牌表 -->
      <div class="mx-wb-table-box" style="flex: 1.45">
        <div class="mx-wb-table-toolbar">
          <div class="mx-wb-toolbar-btns">
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'entities' }"
              @click="multiplierRightView = 'entities'"
            >
              📋 {{ uiText.tabEntityTable }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'card_gallery' }"
              @click="multiplierRightView = 'card_gallery'"
            >
              🎴 {{ uiText.tabCardGallery }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'upgrade_doctor' }"
              @click="multiplierRightView = 'upgrade_doctor'"
            >
              🔨 {{ uiText.tabUpgradeDoctor }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'tactical_lab' }"
              @click="multiplierRightView = 'tactical_lab'"
            >
              🎲 {{ uiText.tabTacticalLab }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'design_lab' }"
              @click="activeSubTab = 'card_lab'"
            >
              🧪 {{ uiText.tabDesignLab }} ↗
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'synergy_nash' }"
              @click="multiplierRightView = 'synergy_nash'"
            >
              🔗 {{ uiText.tabSynergyNash }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'joker_planet' }"
              @click="multiplierRightView = 'joker_planet'"
            >
              🃏 {{ uiText.tabJokerPlanet }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': multiplierRightView === 'extended_card_genres' }"
              @click="multiplierRightView = 'extended_card_genres'"
            >
              ♟️ {{ uiText.tabExtendedGenres }}
            </button>
          </div>
          <div class="mx-wb-toolbar-btns">
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': autoSyncAuditToCombat }"
              @click="autoSyncAuditToCombat = !autoSyncAuditToCombat"
            >
              ⚡ {{ uiText.autoSyncCombatLbl }} ({{ combatRes.winRatePct }}% /
              {{ combatRes.ttkP50 }}T)
            </button>
            <button
              v-if="multiplierRightView === 'joker_planet'"
              type="button"
              class="mx-wb-mini-btn"
              @click="optimizeJokerSlotOrder"
            >
              {{ uiText.optimizeOrderBtn }}
            </button>
            <template
              v-if="multiplierRightView === 'entities' || multiplierRightView === 'card_gallery'"
            >
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
              <button
                type="button"
                class="mx-wb-mini-btn is-accent"
                @click="autoBalanceAllEntities"
              >
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
            </template>
          </div>
        </div>
        <table v-if="multiplierRightView === 'entities'" class="mx-wb-table">
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
                    mutateAuditEntity((w) => {
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
                    mutateAuditEntity((w) => {
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
                    mutateAuditEntity((w) => {
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

        <!-- 实时可视化实体卡牌图鉴墙（Visual Card Deck Gallery） -->
        <div v-else-if="multiplierRightView === 'card_gallery'" class="mx-card-gallery-grid">
          <div
            v-for="(ent, idx) in wb.multiplier.entities"
            :key="ent.id"
            class="mx-visual-card"
            :class="[
              `is-rarity-${ent.rarity}`,
              {
                'is-op': multRes.entityAudits[idx]?.verdict === 'overpowered',
                'is-up': multRes.entityAudits[idx]?.verdict === 'underpowered'
              }
            ]"
          >
            <div class="mx-vc-top">
              <label class="mx-vc-cost-orb" title="Cost / Mana">
                <input
                  type="number"
                  step="any"
                  class="mx-vc-cost-input mx-mono"
                  :value="ent.cost"
                  @input="
                    mutateAuditEntity((w) => {
                      const target = w.multiplier.entities.find((x) => x.id === ent.id)
                      if (target)
                        target.cost = Number(($event.target as HTMLInputElement).value) || 0
                    })
                  "
                />
              </label>
              <input
                type="text"
                class="mx-vc-title-input"
                :value="ent.name"
                @input="
                  mutateAuditEntity((w) => {
                    const target = w.multiplier.entities.find((x) => x.id === ent.id)
                    if (target) target.name = ($event.target as HTMLInputElement).value
                  })
                "
              />
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
            </div>

            <div class="mx-vc-art-box">
              <span class="mx-vc-emblem">
                {{
                  (ent.stats.xMult ?? 0) > 1
                    ? '🃏'
                    : (ent.stats.dmg ?? ent.stats.atk ?? ent.stats.chips ?? 0) > 0
                      ? '⚔️'
                      : '🛡️'
                }}
              </span>
              <span class="mx-vc-rarity-pill">{{ ent.rarity.toUpperCase() }}</span>
            </div>

            <div class="mx-vc-stats-grid">
              <label v-for="col in wb.multiplier.statColumns" :key="col" class="mx-vc-stat-chip">
                <span class="mx-vc-stat-lbl">{{ col }}</span>
                <input
                  type="number"
                  step="any"
                  class="mx-vc-stat-input mx-mono"
                  :value="ent.stats[col] ?? 0"
                  @input="
                    mutateAuditEntity((w) => {
                      const target = w.multiplier.entities.find((x) => x.id === ent.id)
                      if (target)
                        target.stats[col] = Number(($event.target as HTMLInputElement).value) || 0
                    })
                  "
                />
              </label>
            </div>

            <div class="mx-vc-footer mx-mono">
              <span>Exp: {{ multRes.entityAudits[idx]?.expectedValue ?? 0 }}</span>
              <span
                >Act: <strong>{{ multRes.entityAudits[idx]?.actualValue ?? 0 }}</strong></span
              >
            </div>
          </div>
        </div>

        <!-- 卡牌升级差分 (Card ➔ Card+) 篝火敲牌 ROI 榜 & 卡组费用曲线与职能黄金比例体检仪 -->
        <div v-else-if="multiplierRightView === 'upgrade_doctor'">
          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 6px">
            <span class="mx-wb-tbl-title">
              🔨 {{ uiText.upgradeTableTitle }} · Top:
              <strong class="mx-mono" style="color: #10b981">
                {{ upgradeDeckDoctorRes.upgradeRows[0]?.upgradedName ?? '-' }}
              </strong>
            </span>
            <button type="button" class="mx-wb-mini-btn is-accent" @click="runSmithTopUpgrades">
              {{ uiText.smithTopBtn }}
            </button>
          </div>

          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colBaseCard }}</th>
                <th>{{ uiText.colUpgradedCard }}</th>
                <th>{{ uiText.colUpgradeType }}</th>
                <th>{{ uiText.colUpgradeGain }}</th>
                <th>{{ uiText.colSmithPriority }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="u in upgradeDeckDoctorRes.upgradeRows"
                :key="u.cardId"
                :class="{
                  'is-best-row': u.campfirePriority === 'S_first_smith',
                  'is-warn-row': u.campfirePriority === 'B_filler_smith'
                }"
              >
                <td>
                  <strong>{{ u.baseName }}</strong>
                  <span class="mx-mono" style="opacity: 0.8; margin-left: 4px">
                    ({{ u.baseSummary }})
                  </span>
                </td>
                <td>
                  <strong style="color: #10b981">{{ u.upgradedName }}</strong>
                  <span class="mx-mono" style="opacity: 0.85; margin-left: 4px">
                    ({{ u.upgradedSummary }})
                  </span>
                </td>
                <td>{{ isZh ? u.upgradeKindLabelZh : u.upgradeKindLabelEn }}</td>
                <td class="mx-mono">
                  <strong>+{{ u.valueGainPct }}%</strong> (Win +{{ u.winRateDeltaPct }}%)
                </td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      u.campfirePriority === 'S_first_smith'
                        ? 'is-good'
                        : u.campfirePriority === 'A_high_value'
                          ? 'is-warn'
                          : 'is-bad'
                    "
                  >
                    {{ u.campfirePriority }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 6px">
            <span class="mx-wb-tbl-title">
              📊 {{ uiText.deckDoctorTitle }} · Avg Cost:
              <strong class="mx-mono">{{ upgradeDeckDoctorRes.averageCost }}</strong>
              · Health:
              <strong
                class="mx-mono"
                :style="{
                  color: upgradeDeckDoctorRes.deckHealthScore >= 75 ? '#10b981' : '#f59e0b'
                }"
              >
                {{ upgradeDeckDoctorRes.deckHealthScore }}/100
              </strong>
            </span>
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px">
            <span
              v-for="b in upgradeDeckDoctorRes.costCurve"
              :key="b.costLabel"
              class="mx-wb-tag"
              :class="b.status === 'optimal' ? 'is-good' : 'is-warn'"
            >
              {{ b.costLabel }}: {{ b.cardCount }} ({{ b.sharePct }}% · {{ b.idealRangeLabel }})
            </span>
          </div>

          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colRoleName }}</th>
                <th>{{ uiText.colRoleCountPct }}</th>
                <th>{{ uiText.colRoleTarget }}</th>
                <th>{{ uiText.colRoleVerdict }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in upgradeDeckDoctorRes.roleRatios"
                :key="r.roleId"
                :class="{
                  'is-best-row': r.verdict === 'healthy',
                  'is-warn-row': r.verdict !== 'healthy'
                }"
              >
                <td>
                  <strong>{{ isZh ? r.labelZh : r.labelEn }}</strong>
                </td>
                <td class="mx-mono">
                  <strong>{{ r.cardCount }}</strong> ({{ r.actualPct }}%)
                </td>
                <td class="mx-mono">{{ r.recommendedRange }}</td>
                <td>
                  <span class="mx-wb-tag" :class="r.verdict === 'healthy' ? 'is-good' : 'is-warn'">
                    {{ r.verdict.toUpperCase() }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 卡牌效果引擎 / AI 战斗 / 敌人遗物表 / 单局经济闭环 / 试玩校准 -->
        <MxCardDesignLabPanel v-else-if="multiplierRightView === 'design_lab'" />

        <!-- 专业战术精算实验室：1.超几何上手率/Combo凑齐率 2.单回合最高斩杀序列求解 3.Boss四回合意图循环轴压测 -->
        <div v-else-if="multiplierRightView === 'tactical_lab'">
          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 6px">
            <span class="mx-wb-tbl-title">
              🎲 {{ uiText.hypergeomTitle }} · Deck:
              <strong class="mx-mono">{{ hypergeomRes.deckSize }}</strong>
              · Combo ({{ hypergeomRes.comboPairLabel }}): T1
              <strong class="mx-mono">{{ hypergeomRes.comboT1ProbPct }}%</strong> / T3
              <strong class="mx-mono" style="color: #10b981"
                >{{ hypergeomRes.comboT3ProbPct }}%</strong
              >
              (Thin-3: <strong>{{ hypergeomRes.comboThin3T3ProbPct }}%</strong>)
            </span>
          </div>

          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colHgCard }}</th>
                <th>{{ uiText.colHgCopies }}</th>
                <th>{{ uiText.colHgT1Mul }}</th>
                <th>{{ uiText.colHgT2T3 }}</th>
                <th>{{ uiText.colHgThin3 }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="hg in hypergeomRes.rows"
                :key="hg.cardId"
                :class="{ 'is-best-row': hg.t1MulliganProbPct >= 50 }"
              >
                <td>
                  <strong>{{ hg.cardName }}</strong> ({{ hg.cost }} Cost)
                </td>
                <td class="mx-mono">{{ hg.copiesInDeck }}x</td>
                <td class="mx-mono">
                  {{ hg.t1RawProbPct }}% ➔ <strong>{{ hg.t1MulliganProbPct }}%</strong>
                </td>
                <td class="mx-mono">
                  {{ hg.t2ProbPct }}% / <strong>{{ hg.t3ProbPct }}%</strong>
                </td>
                <td class="mx-mono">
                  <span class="mx-wb-tag is-good">+{{ hg.thin3GainPct }}%</span>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 6px">
            <span class="mx-wb-tbl-title">
              🧩 {{ uiText.lethalTitle }} · {{ uiText.naiveOrderLbl }}
              <strong class="mx-mono">{{ lethalPuzzleRes.naiveOrderDamage }}</strong>
              · {{ uiText.optimalOrderLbl }}
              <strong class="mx-mono" style="color: #10b981">{{
                lethalPuzzleRes.optimalLethalDamage
              }}</strong>
              · {{ uiText.skillGapLbl }}
              <span
                class="mx-wb-tag"
                :class="
                  lethalPuzzleRes.skillCeilingVerdict === 'high_skill_ceiling'
                    ? 'is-good'
                    : 'is-warn'
                "
              >
                {{ lethalPuzzleRes.skillGapRatio }}x ({{ lethalPuzzleRes.skillCeilingVerdict }})
              </span>
            </span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px">
            <span
              v-for="st in lethalPuzzleRes.optimalSteps"
              :key="st.stepIndex"
              class="mx-wb-tag is-good mx-mono"
            >
              #{{ st.stepIndex }} {{ st.cardName }} ({{ st.costPaid }}E: {{ st.effectDesc }} ➔ Σ{{
                st.cumulativeDamage
              }})
            </span>
          </div>

          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 6px">
            <span class="mx-wb-tbl-title">
              👹 {{ uiText.bossIntentTitle }} · Spike Death:
              <strong
                class="mx-mono"
                :style="{ color: bossIntentRes.spikeDeathProbPct >= 35 ? '#ef4444' : '#10b981' }"
              >
                {{ bossIntentRes.spikeDeathProbPct }}%
              </strong>
              · Pollution Brick:
              <strong class="mx-mono">{{ bossIntentRes.pollutedBrickRatePct }}%</strong>
              · Survival:
              <span
                class="mx-wb-tag"
                :class="bossIntentRes.survivalScore >= 65 ? 'is-good' : 'is-bad'"
              >
                {{ bossIntentRes.survivalScore }}/100
              </span>
            </span>
          </div>

          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colBossTurn }}</th>
                <th>{{ uiText.colBossRawBlk }}</th>
                <th>{{ uiText.colBossNetLoss }}</th>
                <th>{{ uiText.colBossSpikeRisk }}</th>
                <th>{{ uiText.colBossNote }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="br in bossIntentRes.rows"
                :key="br.turn"
                :class="{
                  'is-warn-row': br.spikeDeathRiskPct >= 35,
                  'is-best-row': br.netHpLoss === 0
                }"
              >
                <td>
                  <strong>{{ isZh ? br.intentNameZh : br.intentNameEn }}</strong>
                </td>
                <td class="mx-mono">{{ br.incomingRawDmg }} / {{ br.expectedPlayerBlock }} BLK</td>
                <td class="mx-mono">
                  <strong :style="{ color: br.netHpLoss > 0 ? '#ef4444' : '#10b981' }">
                    -{{ br.netHpLoss }} HP
                  </strong>
                </td>
                <td class="mx-mono">{{ br.spikeDeathRiskPct }}%</td>
                <td>{{ isZh ? br.noteZh : br.noteEn }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 双卡无限死循环/OTK秒杀检测器 & 4×4 流派互克与天梯纳什均衡推演 -->
        <div v-else-if="multiplierRightView === 'synergy_nash'">
          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 6px">
            <span class="mx-wb-tbl-title">
              🔗 {{ uiText.synergyLoopTitle }} · OTK Risk:
              <strong
                class="mx-mono"
                :style="{ color: synergyLoopRes.otkRiskScore >= 50 ? '#ef4444' : '#10b981' }"
              >
                {{ synergyLoopRes.otkRiskScore }}/100
              </strong>
              · Loops:
              <span
                class="mx-wb-tag"
                :class="synergyLoopRes.infiniteLoopCount > 0 ? 'is-bad' : 'is-good'"
              >
                {{ synergyLoopRes.infiniteLoopCount }}
              </span>
            </span>
            <button type="button" class="mx-wb-mini-btn is-accent" @click="runCircuitBreaker">
              {{ uiText.circuitBreakerBtn }}
            </button>
          </div>

          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colPairCards }}</th>
                <th>{{ uiText.colSynergyType }}</th>
                <th>{{ uiText.colSynergyMult }}</th>
                <th>{{ uiText.colSynergyFix }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in synergyLoopRes.pairs"
                :key="p.pairId"
                :class="{
                  'is-warn-row': p.riskLevel === 'critical_infinite',
                  'is-enemy-row': p.riskLevel === 'high_otk',
                  'is-best-row': p.riskLevel === 'healthy_synergy'
                }"
              >
                <td>
                  <strong>{{ p.cardAName }}</strong> + <strong>{{ p.cardBName }}</strong>
                </td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      p.riskLevel === 'critical_infinite'
                        ? 'is-bad'
                        : p.riskLevel === 'high_otk'
                          ? 'is-warn'
                          : 'is-good'
                    "
                  >
                    {{ isZh ? p.synergyTypeLabelZh : p.synergyTypeLabelEn }}
                  </span>
                </td>
                <td class="mx-mono">
                  <strong>{{ p.combinedScoreOrMult }}</strong>
                </td>
                <td>{{ isZh ? p.fixSuggestionZh : p.fixSuggestionEn }}</td>
              </tr>
            </tbody>
          </table>

          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
            <span class="mx-wb-tbl-title">
              ⚔️ {{ uiText.pvpNashTitle }} · Health:
              <strong class="mx-mono" style="color: #10b981"
                >{{ pvpNashRes.rpsCycleHealthScore }}/100</strong
              >
              ({{ pvpNashRes.verdict.toUpperCase() }}) ·
              <span class="mx-wb-tag is-good"
                >{{ uiText.pvpSourceLbl }} ×{{ pvpNashRes.runsPerPair }}</span
              >
            </span>
          </div>
          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colPvpArch }}</th>
                <th v-for="a in pvpNashRes.archetypes" :key="a.id">
                  vs {{ isZh ? a.nameZh : a.nameEn }}
                </th>
                <th>{{ uiText.colNashShare }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, ri) in pvpNashRes.rows"
                :key="row.archetypeId"
                :class="{
                  'is-warn-row': row.status === 'tier0_dominant',
                  'is-best-row': row.status === 'balanced_pillar'
                }"
              >
                <td>
                  <strong>{{ isZh ? row.nameZh : row.nameEn }}</strong>
                </td>
                <td v-for="(pct, ci) in row.vsPcts" :key="ci" class="mx-mono">
                  {{ ri === ci ? '—' : `${pct}%` }}
                </td>
                <td class="mx-mono">
                  <strong>{{ row.nashEquilibriumSharePct }}%</strong>
                  <span
                    class="mx-wb-tag"
                    style="margin-left: 4px"
                    :class="
                      row.status === 'tier0_dominant'
                        ? 'is-bad'
                        : row.status === 'unplayable_weak'
                          ? 'is-warn'
                          : 'is-good'
                    "
                  >
                    {{ row.status.toUpperCase() }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 《小丑牌 Balatro》专属三大机制：1~5号槽位左加右乘顺序对比 + 9大牌型行星牌升级表 + 6大Boss盲注针对性封锁审计 -->
        <div v-else-if="multiplierRightView === 'joker_planet'">
          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px; flex-wrap: wrap; gap: 8px">
            <span class="mx-wb-tbl-title">
              {{ uiText.wrongOrderLbl }}
              <strong class="mx-mono">{{ jokerPlanetRes.wrongOrderScore }}</strong>
              · {{ uiText.curOrderLbl }}
              <strong class="mx-mono">{{ jokerPlanetRes.currentOrderScore }}</strong>
              · {{ uiText.optOrderLbl }}
              <strong class="mx-mono" style="color: #10b981">{{
                jokerPlanetRes.optimalOrderScore
              }}</strong>
              · {{ uiText.orderGainLbl }}
              <span class="mx-wb-tag is-good">{{ jokerPlanetRes.orderGainRatio }}x</span>
            </span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px">
            <span
              v-for="st in jokerPlanetRes.optimalSlots"
              :key="st.slotIndex"
              class="mx-wb-tag"
              :class="
                st.role === 'x_mult' ? 'is-bad' : st.role === 'add_mult' ? 'is-warn' : 'is-good'
              "
            >
              #{{ st.slotIndex }} {{ st.name }} ({{ st.effectLabel }} ➔ {{ st.runningScore }})
            </span>
          </div>

          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colHandPlanet }}</th>
                <th>{{ uiText.colBaseChipsMult }}</th>
                <th>{{ uiText.colLv1Lv5Lv15 }}</th>
                <th>{{ uiText.colWithJokers }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in jokerPlanetRes.planetHands"
                :key="p.handId"
                :class="{ 'is-best-row': p.handId === 'flush' || p.handId === 'straight_flush' }"
              >
                <td>
                  <strong>{{ isZh ? p.handNameZh : p.handNameEn }}</strong>
                  <span class="mx-wb-tag is-good" style="margin-left: 4px">
                    🪐 {{ isZh ? p.planetNameZh : p.planetNameEn }}
                  </span>
                </td>
                <td class="mx-mono">
                  {{ p.baseChips }}×{{ p.baseMult }} (+{{ p.deltaChipsPerLv }}/+{{
                    p.deltaMultPerLv
                  }})
                </td>
                <td class="mx-mono">{{ p.lv1Score }} / {{ p.lv5Score }} / {{ p.lv15Score }}</td>
                <td class="mx-mono">
                  <strong>{{ p.lv5WithOptimalJokersScore }}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colBlindName }}</th>
                <th>{{ uiText.colBlindRule }}</th>
                <th>{{ uiText.colBlindTargetVsScore }}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="b in jokerPlanetRes.bossBlinds"
                :key="b.blindId"
                :class="{
                  'is-best-row': b.verdict === 'pass',
                  'is-warn-row': b.verdict === 'risky',
                  'is-enemy-row': b.verdict === 'countered'
                }"
              >
                <td>
                  <strong>{{ isZh ? b.nameZh : b.nameEn }}</strong>
                </td>
                <td>{{ isZh ? b.ruleDescZh : b.ruleDescEn }}</td>
                <td class="mx-mono">
                  {{ b.targetScore }} vs <strong>{{ b.achievedScoreWithOptimal }}</strong>
                </td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      b.verdict === 'pass'
                        ? 'is-good'
                        : b.verdict === 'risky'
                          ? 'is-warn'
                          : 'is-bad'
                    "
                  >
                    {{ b.verdict.toUpperCase() }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 扩展卡牌品类矩阵：1.自走棋酒馆追三期望 2.漫威Snap三路战区加注EV 3.三国杀攻防响应链 -->
        <div v-else>
          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
            <span class="mx-wb-tbl-title"> ♟️ {{ uiText.autoBattlerTitle }} </span>
          </div>
          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colAbTier }}</th>
                <th>{{ uiText.colAbPool }}</th>
                <th>{{ uiText.colAb2Star }}</th>
                <th>{{ uiText.colAb3Star }}</th>
                <th>{{ uiText.colAbPower }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in extendedCardGenresRes.autoBattlerStarRows"
                :key="row.costTier"
                :class="{ 'is-best-row': row.costTier === 3 || row.costTier === 4 }"
              >
                <td>
                  <strong>{{ isZh ? row.tierNameZh : row.tierNameEn }}</strong>
                </td>
                <td class="mx-mono">
                  {{ row.sharedPoolTotal }} / -{{ row.contestedTaken }} / Lv.{{
                    row.optimalShopLevel
                  }}
                </td>
                <td class="mx-mono">
                  {{ row.expectedRolls2Star }}R ({{ row.expectedGold2Star }}G)
                </td>
                <td class="mx-mono">
                  <strong>{{ row.expectedRolls3Star }}R ({{ row.expectedGold3Star }}G)</strong>
                </td>
                <td class="mx-mono">
                  {{ row.star1Power }} ➔ {{ row.star2Power }} ➔
                  <strong>{{ row.star3Power }}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
            <span class="mx-wb-tbl-title">
              ⚡ {{ uiText.snapTitlePrefix }} {{ extendedCardGenresRes.snapWin2Of3RatePct
              }}{{ uiText.snapTitleSuffix }}
            </span>
          </div>
          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colSnapScenario }}</th>
                <th>{{ uiText.colSnapWinPct }}</th>
                <th>{{ uiText.colSnapPlayEv }}</th>
                <th>{{ uiText.colSnapRetreatCost }}</th>
                <th>{{ uiText.colSnapAction }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="sc in extendedCardGenresRes.snapCubeScenarios"
                :key="sc.scenarioId"
                :class="{
                  'is-best-row': sc.optimalAction === 'SNAP',
                  'is-warn-row': sc.optimalAction === 'RETREAT'
                }"
              >
                <td>
                  <strong>{{ isZh ? sc.nameZh : sc.nameEn }}</strong>
                </td>
                <td class="mx-mono">{{ sc.winProbPct }}%</td>
                <td class="mx-mono">
                  <strong :style="{ color: sc.playOutEvCubes >= 0 ? '#10b981' : '#ef4444' }">
                    {{ sc.playOutEvCubes > 0 ? `+${sc.playOutEvCubes}` : sc.playOutEvCubes }} Cubes
                  </strong>
                </td>
                <td class="mx-mono">-{{ sc.retreatCostCubes }} Cube</td>
                <td>
                  <span
                    class="mx-wb-tag"
                    :class="
                      sc.optimalAction === 'SNAP'
                        ? 'is-good'
                        : sc.optimalAction === 'RETREAT'
                          ? 'is-bad'
                          : 'is-warn'
                    "
                  >
                    {{ sc.optimalAction }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <div class="mx-wb-table-toolbar" style="margin-bottom: 4px">
            <span class="mx-wb-tbl-title"> 🗡️ {{ uiText.responseChainTitle }} </span>
          </div>
          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colRcHand }}</th>
                <th>{{ uiText.colRcDodge }}</th>
                <th>{{ uiText.colRcStrike }}</th>
                <th>{{ uiText.colRcPeachNull }}</th>
                <th>{{ uiText.colRcAdvice }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="rc in extendedCardGenresRes.responseChainRows"
                :key="rc.enemyHandCards"
                :class="{ 'is-best-row': rc.enemyHandCards <= 2 }"
              >
                <td class="mx-mono">
                  <strong>{{ rc.enemyHandCards }} Cards</strong>
                </td>
                <td class="mx-mono">{{ rc.holdDodgeProbPct }}%</td>
                <td class="mx-mono">
                  <strong>{{ rc.strikeRawHitRatePct }}%</strong> / {{ rc.doubleStrikeHitRatePct }}%
                </td>
                <td class="mx-mono">
                  {{ rc.holdPeachProbPct }}% / {{ rc.trickNullifiedProbPct }}%
                </td>
                <td>{{ rc.tacticalAdviceZh }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═════════════ SUB-TAB 4: 抽卡保底 / 御魂副属性强化 / 肉鸽三选一词条池 ═════════════ -->
    <div v-else-if="activeSubTab === 'loot'" class="mx-wb-body">
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
            <span>{{ uiText.competingArchLbl }}</span>
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
            <span>{{ uiText.banSlotsLbl }}</span>
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
            <span>{{ uiText.missPityBoostLbl }}</span>
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
              📊 {{ uiText.tabLootHistogram }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'dilution' }"
              @click="lootRightView = 'dilution'"
            >
              🧪 {{ uiText.tabLootDilution }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'commercial_cohorts' }"
              @click="lootRightView = 'commercial_cohorts'"
            >
              💰 {{ uiText.tabCommercialCohort }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'equipment_matrix' }"
              @click="lootRightView = 'equipment_matrix'"
            >
              🔨 {{ uiText.tabEquipMatrix }}
            </button>
            <button
              type="button"
              class="mx-wb-mini-btn"
              :class="{ 'is-accent': lootRightView === 'battle_pass_iap' }"
              @click="lootRightView = 'battle_pass_iap'"
            >
              🎟️ {{ uiText.tabBattlePassIap }}
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
        <div v-else-if="lootRightView === 'commercial_cohorts'">
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

        <!-- +1 ~ +15 装备强化等级、铁匠铺概率衰减与养成消耗阶梯表 -->
        <div v-else-if="lootRightView === 'equipment_matrix'">
          <div class="mx-wb-table-toolbar" style="margin-bottom: 6px; flex-wrap: wrap; gap: 6px">
            <label class="mx-wb-inline-field">
              <span>{{ uiText.eqMaxLvLbl }}</span>
              <input
                v-model.number="wb.lootRoll.equipMaxEnhanceLevel"
                type="number"
                min="5"
                max="25"
                step="1"
                class="mx-wb-input"
                style="width: 48px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.eqBaseStatLbl }}</span>
              <input
                v-model.number="wb.lootRoll.equipBaseMainStat"
                type="number"
                min="1"
                max="1000"
                step="5"
                class="mx-wb-input"
                style="width: 54px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.eqStepStatLbl }}</span>
              <input
                v-model.number="wb.lootRoll.equipMainStatStep"
                type="number"
                min="1"
                max="200"
                step="1"
                class="mx-wb-input"
                style="width: 50px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.eqExpPowLbl }}</span>
              <input
                v-model.number="wb.lootRoll.equipExpGrowthExponent"
                type="number"
                min="1.05"
                max="2.5"
                step="0.05"
                class="mx-wb-input"
                style="width: 52px"
              />
            </label>
            <label class="mx-wb-inline-field">
              <span>{{ uiText.eqDecayLbl }}</span>
              <input
                v-model.number="wb.lootRoll.equipSuccessDecayAfter5Pct"
                type="number"
                min="0"
                max="15"
                step="1"
                class="mx-wb-input"
                style="width: 48px"
              />
            </label>
          </div>
          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colEqLevel }}</th>
                <th>{{ uiText.colEqMainStat }}</th>
                <th>{{ uiText.colEqSubRolls }}</th>
                <th>{{ uiText.colEqRatePct }}</th>
                <th>{{ uiText.colEqExpGold }}</th>
                <th>{{ uiText.colEqCumGoldStam }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="eq in equipmentMatrixRes.rows"
                :key="eq.enhanceLevel"
                :class="{
                  'is-best-row': eq.enhanceLevel % 3 === 0,
                  'is-warn-row': eq.successRatePct < 75 && eq.successRatePct >= 50,
                  'is-enemy-row': eq.successRatePct < 50
                }"
              >
                <td class="mx-mono">
                  <strong>+{{ eq.enhanceLevel }}</strong>
                </td>
                <td class="mx-mono">{{ eq.mainStatValue }}</td>
                <td class="mx-mono">
                  <span class="mx-wb-tag" :class="eq.enhanceLevel % 3 === 0 ? 'is-good' : ''">
                    {{ eq.substatRollsUnlocked }}x
                  </span>
                </td>
                <td class="mx-mono">{{ eq.successRatePct }}%</td>
                <td class="mx-mono">{{ eq.expCost }} EXP / {{ eq.expectedGoldWithFails }}G</td>
                <td class="mx-mono">
                  <strong>{{ eq.cumulativeExpectedGold }}G</strong> ({{
                    eq.cumulativeExpectedStamina
                  }}d)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 商业化长线运营：商城礼包价格锚点（IAP Price Tier Matrix）与赛季战令（Battle Pass Lv.1~50）经验漏斗表 -->
        <div v-else>
          <table class="mx-wb-table" style="margin-bottom: 8px">
            <thead>
              <tr>
                <th>{{ uiText.colPackName }}</th>
                <th>{{ uiText.colPackPrice }}</th>
                <th>{{ uiText.colPackPulls }}</th>
                <th>{{ uiText.colPackValuePct }}</th>
                <th>Limit</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="pk in battlePassIapRes.iapPacks"
                :key="pk.packId"
                :class="{
                  'is-best-row': pk.valueRatioPct >= 400,
                  'is-warn-row': pk.valueRatioPct < 200
                }"
              >
                <td>
                  <strong>{{ isZh ? pk.nameZh : pk.nameEn }}</strong>
                </td>
                <td class="mx-mono">${{ pk.priceUsd }}</td>
                <td class="mx-mono">
                  {{ pk.pullsIncluded }} + {{ pk.bonusResourcesEquivPulls }} =
                  <strong>{{ pk.totalPullEquiv }}</strong>
                </td>
                <td>
                  <span class="mx-wb-tag is-good">{{ pk.valueRatioPct }}% Value</span>
                </td>
                <td class="mx-mono">{{ pk.purchaseLimit }}</td>
              </tr>
            </tbody>
          </table>

          <table class="mx-wb-table">
            <thead>
              <tr>
                <th>{{ uiText.colBpLevel }}</th>
                <th>Cumulative XP</th>
                <th>{{ uiText.colBpFreePaid }}</th>
                <th>{{ uiText.colBpCumPulls }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="bp in battlePassIapRes.battlePassMilestones"
                :key="bp.bpLevel"
                :class="{ 'is-best-row': bp.bpLevel === 30 || bp.bpLevel === 50 }"
              >
                <td class="mx-mono">
                  <strong>BP Lv.{{ bp.bpLevel }}</strong> ({{ bp.daysToReach }}d)
                </td>
                <td class="mx-mono">{{ bp.cumulativeXp }} XP</td>
                <td>
                  {{ bp.freeRewardDesc }} / <strong>{{ bp.paidRewardDesc }}</strong>
                </td>
                <td class="mx-mono">
                  {{ bp.cumulativeFreePullEquiv }} /
                  <strong>{{ bp.cumulativePaidPullEquiv }} pulls</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═════════════ SUB-TAB 5: 卡牌与单局实验室（全宽视图） ═════════════ -->
    <div v-else class="mx-wb-body is-full-lab">
      <MxCardDesignLabPanel />
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

.mx-wb-presets-right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mx-wb-export-wrap {
  position: relative;
}

.mx-wb-export-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 245px;
  padding: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 7px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 45;
}

.mx-wb-export-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
}

.mx-wb-export-menu > button {
  text-align: left;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.mx-wb-export-menu > button:hover {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.mx-wb-export-menu hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 3px 0;
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

.mx-wb-preset-select {
  max-width: 340px;
  min-width: 220px;
  height: 24px;
  font-weight: 600;
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elevated));
  cursor: pointer;
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

.mx-wb-body.is-full-lab {
  flex-direction: column;
  padding: 8px 12px;
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
  position: relative;
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

.mx-wb-chart-tooltip {
  position: absolute;
  top: 6px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--bg-panel) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
  font-size: 10px;
  color: var(--text);
  pointer-events: none;
  z-index: 4;
}

.mx-wb-svg {
  width: 100%;
  height: 100%;
  max-height: 145px;
}

.mx-wb-svg.is-interactive {
  cursor: crosshair;
}

.mx-wb-panel.is-full-screen .mx-wb-svg {
  max-height: 280px;
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
  flex-wrap: wrap;
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
  flex-wrap: wrap;
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

.mx-wb-inline-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.mx-card-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 8px;
  padding: 8px;
}

.mx-visual-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  border: 1.5px solid var(--border);
  background: linear-gradient(165deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.96));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
  transition:
    transform 0.14s ease,
    border-color 0.14s ease;
}

.mx-visual-card:hover {
  transform: translateY(-2px);
}

.mx-visual-card.is-rarity-uncommon {
  border-color: rgba(16, 185, 129, 0.55);
}

.mx-visual-card.is-rarity-rare {
  border-color: rgba(56, 189, 248, 0.65);
}

.mx-visual-card.is-rarity-legendary {
  border-color: rgba(245, 158, 11, 0.85);
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.22);
}

.mx-visual-card.is-op {
  outline: 1px dashed rgba(239, 68, 68, 0.7);
}

.mx-vc-top {
  display: flex;
  align-items: center;
  gap: 5px;
}

.mx-vc-cost-orb {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #38bdf8, #0284c7);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.5);
  flex-shrink: 0;
}

.mx-vc-cost-input {
  width: 22px;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  text-align: center;
}

.mx-vc-title-input {
  flex: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #f8fafc;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 3px;
}

.mx-vc-title-input:hover,
.mx-vc-title-input:focus {
  border-color: var(--border);
  background: var(--bg-input);
}

.mx-vc-art-box {
  height: 44px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.16);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
}

.mx-vc-emblem {
  font-size: 22px;
}

.mx-vc-rarity-pill {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.mx-vc-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}

.mx-vc-stat-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(30, 41, 59, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.14);
  font-size: 9px;
}

.mx-vc-stat-lbl {
  color: var(--text-muted);
  text-transform: uppercase;
}

.mx-vc-stat-input {
  width: 34px;
  border: none;
  background: transparent;
  color: #fde047;
  font-size: 10px;
  font-weight: 700;
  text-align: right;
}

.mx-vc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-muted);
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  padding-top: 4px;
}
</style>
