<script setup lang="ts">
/**
 * 卡牌数值设计实验室面板（嵌入数值工作台「③ 乘区与配表」右侧视图）：
 * 1. 卡牌效果脚本编辑（DSL）与解析校验
 * 2. 效果引擎 AI 战斗模拟 + 三策略操作上限测量
 * 3. 敌人 / 意图 / 遭遇 / 遗物 / 卡池 可编辑表
 * 4. 单局经济闭环蒙特卡洛
 * 5. 试玩日志 CSV 校准
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  calibrateMxBattleModel,
  createMxWorkbenchPreset,
  ensureMxCardDesignLab,
  formatMxAtbSummary,
  formatMxCardEffectSummary,
  makeScriptCard,
  measureMxPolicySkillGap,
  mxAtbLegacySkillScript,
  mxCardValuePerCost,
  mxLegacyCardToScript,
  mxManaCardToScript,
  mxResolveCardEffects,
  parseMxAtbScript,
  parseMxCardEffectScript,
  parseMxPlaytestLogCsv,
  resolveMxEncounterEnemies,
  runMxLabEncounterSimulation,
  type MxActionBarUnitSpec,
  type MxBattleSimResult,
  type MxCalibrationResult,
  type MxCardDesignLabConfig,
  type MxCardMarginalValueResult,
  type MxCardRebalanceSuggestion,
  type MxEncounterSpec,
  type MxEnemyIntent,
  type MxNumericalWorkbench,
  type MxPlayPolicy,
  type MxPolicySkillGapResult,
  type MxRelicTrigger,
  type MxRunEconomyConfig,
  type MxRunEconomyResult,
  type MxStatusId,
  type MxTierHpSolveResult
} from '@shared/gameAssets'
import { cardLabCompute, isCardLabWorkerActive } from './cardLabWorkerClient'
import { useMxStudioStore } from './mxStudioStore'

const { locale } = useI18n()
const s = useMxStudioStore()
const isZh = computed(() => String(locale.value).startsWith('zh'))
function L(zh: string, en: string): string {
  return isZh.value ? zh : en
}

const wb = computed<MxNumericalWorkbench>(
  () => s.doc.value.workbench ?? createMxWorkbenchPreset('slay_the_spire_dbg')
)
const lab = computed<MxCardDesignLabConfig>(() => ensureMxCardDesignLab(wb.value))

function mutateWb(fn: (w: MxNumericalWorkbench) => void, key = 'labWb'): void {
  s.mutate((d) => {
    if (!d.workbench) d.workbench = createMxWorkbenchPreset('slay_the_spire_dbg')
    fn(d.workbench)
  }, key)
}

function mutateLab(fn: (l: MxCardDesignLabConfig) => void, key = 'labCfg'): void {
  mutateWb((w) => {
    const l = ensureMxCardDesignLab(w)
    fn(l)
    w.designLab = l
  }, key)
}

function num(e: Event, fallback = 0): number {
  const v = Number((e.target as HTMLInputElement).value)
  return Number.isFinite(v) ? v : fallback
}
function str(e: Event): string {
  return (e.target as HTMLInputElement).value
}
function bool(e: Event): boolean {
  return (e.target as HTMLInputElement).checked
}

type LabTab = 'scripts' | 'battle' | 'value' | 'tables' | 'economy' | 'calibration'
const tab = ref<LabTab>('scripts')
const busy = ref(false)
const feedback = ref('')

async function runBusy(fn: () => void | Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  await new Promise((r) => setTimeout(r, 16))
  try {
    await fn()
  } catch (err) {
    feedback.value = `⚠ ${err instanceof Error ? err.message : String(err)}`
  } finally {
    busy.value = false
  }
}

const POLICIES: MxPlayPolicy[] = ['random', 'greedy', 'search', 'rollout']
const STATUSES: MxStatusId[] = [
  'vulnerable',
  'weak',
  'poison',
  'strength',
  'dexterity',
  'frail',
  'thorns'
]
const RELIC_TRIGGERS: MxRelicTrigger[] = [
  'combat_start',
  'turn_start',
  'turn_end',
  'every_n_attacks',
  'every_n_turns',
  'on_exhaust',
  'combat_end',
  'first_attack_cost_gte'
]
const TIERS: MxEncounterSpec['tier'][] = ['normal', 'elite', 'boss']

// ───────── 1. 效果脚本 ─────────
const scriptRows = computed(() =>
  wb.value.combatKernel.deckCards.map((c) => {
    const fx = mxResolveCardEffects(c)
    return {
      card: c,
      usingScript: Boolean(c.effectScript?.trim()),
      legacy: mxLegacyCardToScript(c),
      summary: formatMxCardEffectSummary(fx),
      errors: fx.errors,
      vpc: Math.round(mxCardValuePerCost(c) * 10) / 10
    }
  })
)

function setCardScript(id: string, script: string): void {
  mutateWb((w) => {
    const c = w.combatKernel.deckCards.find((x) => x.id === id)
    if (c) c.effectScript = script
  }, `labScript:${id}`)
}

function convertAllToScripts(): void {
  let n = 0
  mutateWb((w) => {
    for (const c of w.combatKernel.deckCards) {
      if (!c.effectScript?.trim()) {
        c.effectScript = mxLegacyCardToScript(c)
        n++
      }
    }
  }, 'labConvertAll')
  feedback.value = L(
    `已将 ${n} 张卡的基础字段转换为效果脚本`, // cjk-ok
    `Converted ${n} cards to effect scripts`
  ) // cjk-ok
}

function addScriptCard(): void {
  mutateWb((w) => {
    const idx = w.combatKernel.deckCards.length + 1
    w.combatKernel.deckCards.push(
      makeScriptCard(`script_${Date.now()}`, `New Card ${idx}`, 1, 'dmg 6', 'common', 1)
    )
  }, 'labAddCard')
}

function removeDeckCard(id: string): void {
  mutateWb((w) => {
    if (w.combatKernel.deckCards.length <= 1) return
    w.combatKernel.deckCards = w.combatKernel.deckCards.filter((c) => c.id !== id)
  }, 'labDelCard')
}

// mana_tempo（炉石式）法力卡组的效果脚本：填写任意一张即自动改由效果引擎驱动
const manaRows = computed(() =>
  (wb.value.combatKernel.manaCurveDeck ?? []).map((c) => {
    const fx = parseMxCardEffectScript(mxManaCardToScript(c))
    return {
      card: c,
      generated: mxManaCardToScript({ ...c, effectScript: '' }),
      summary: formatMxCardEffectSummary(fx),
      errors: fx.errors
    }
  })
)

function setManaScript(id: string, script: string): void {
  mutateWb((w) => {
    const c = w.combatKernel.manaCurveDeck.find((x) => x.id === id)
    if (c) c.effectScript = script
  }, `labManaScript:${id}`)
}

// action_bar（阴阳师/星铁式）行动条单位技能脚本：填写任一单位即自动改由 ATB 效果引擎驱动
const atbRows = computed(() =>
  (wb.value.combatKernel.actionUnits ?? []).map((u) => {
    const src = u.skillScript?.trim() ? u.skillScript : mxAtbLegacySkillScript(u)
    const fx = parseMxAtbScript(src)
    return {
      unit: u,
      generated: mxAtbLegacySkillScript(u),
      summary: formatMxAtbSummary(fx),
      errors: fx.errors
    }
  })
)

function patchAtbUnit(id: string, patch: Partial<MxActionBarUnitSpec>): void {
  mutateWb((w) => {
    const u = w.combatKernel.actionUnits.find((x) => x.id === id)
    if (u) Object.assign(u, patch)
  }, `labAtb:${id}`)
}

// ───────── 2. AI 战斗 ─────────
const battleRes = ref<MxBattleSimResult | null>(null)
const skillGapRes = ref<MxPolicySkillGapResult | null>(null)

function runBattle(): void {
  void runBusy(() => {
    battleRes.value = runMxLabEncounterSimulation(wb.value, lab.value)
  })
}

function runSkillGap(): void {
  void runBusy(() => {
    const l = lab.value
    skillGapRes.value = measureMxPolicySkillGap({
      deck: wb.value.combatKernel.deckCards,
      enemies: resolveMxEncounterEnemies(l, l.selectedEncounterId),
      relics: l.relics.filter((r) => l.activeRelicIds.includes(r.id)),
      playerHp: l.playerHp,
      energyPerTurn: wb.value.combatKernel.energyPerTurn || 3,
      drawPerTurn: wb.value.combatKernel.drawPerTurn || 5,
      maxTurns: l.maxTurns,
      runs: Math.max(20, Math.min(200, l.battleRuns)),
      seed: wb.value.combatKernel.seed || 1
    })
  })
}

// ───────── 3. 表格编辑 ─────────
function addEnemy(): void {
  mutateLab((l) => {
    l.enemies.push({
      id: `enemy_${Date.now()}`,
      name: 'New Enemy',
      hp: 40,
      pattern: 'cycle',
      intents: [
        { name: 'Attack', damage: 8, hits: 1, block: 0, strengthGain: 0, addStatusCards: 0 }
      ]
    })
  }, 'labAddEnemy')
}

function removeEnemy(id: string): void {
  mutateLab((l) => {
    l.enemies = l.enemies.filter((e) => e.id !== id)
    for (const enc of l.encounters) enc.enemyIds = enc.enemyIds.filter((x) => x !== id)
  }, 'labDelEnemy')
}

function patchEnemy(id: string, patch: Record<string, unknown>): void {
  mutateLab((l) => {
    const e = l.enemies.find((x) => x.id === id)
    if (e) Object.assign(e, patch)
  }, `labEnemy:${id}`)
}

function patchIntent(enemyId: string, idx: number, patch: Partial<MxEnemyIntent>): void {
  mutateLab((l) => {
    const it = l.enemies.find((x) => x.id === enemyId)?.intents[idx]
    if (it) Object.assign(it, patch)
  }, `labIntent:${enemyId}:${idx}`)
}

function addIntent(enemyId: string): void {
  mutateLab((l) => {
    l.enemies
      .find((x) => x.id === enemyId)
      ?.intents.push({
        name: 'Attack',
        damage: 6,
        hits: 1,
        block: 0,
        strengthGain: 0,
        addStatusCards: 0
      })
  }, 'labAddIntent')
}

function removeIntent(enemyId: string, idx: number): void {
  mutateLab((l) => {
    const e = l.enemies.find((x) => x.id === enemyId)
    if (e && e.intents.length > 1) e.intents.splice(idx, 1)
  }, 'labDelIntent')
}

function addEncounter(): void {
  mutateLab((l) => {
    l.encounters.push({
      id: `enc_${Date.now()}`,
      name: 'New Encounter',
      tier: 'normal',
      enemyIds: l.enemies[0] ? [l.enemies[0].id] : []
    })
  }, 'labAddEnc')
}

function patchEncounter(id: string, patch: Partial<MxEncounterSpec>): void {
  mutateLab((l) => {
    const e = l.encounters.find((x) => x.id === id)
    if (e) Object.assign(e, patch)
  }, `labEnc:${id}`)
}

function removeEncounter(id: string): void {
  mutateLab((l) => {
    if (l.encounters.length <= 1) return
    l.encounters = l.encounters.filter((e) => e.id !== id)
    if (l.selectedEncounterId === id) l.selectedEncounterId = l.encounters[0]!.id
  }, 'labDelEnc')
}

function toggleRelic(id: string): void {
  mutateLab((l) => {
    l.activeRelicIds = l.activeRelicIds.includes(id)
      ? l.activeRelicIds.filter((x) => x !== id)
      : [...l.activeRelicIds, id]
  }, 'labRelicToggle')
}

function patchRelic(id: string, patch: Record<string, unknown>): void {
  mutateLab((l) => {
    const r = l.relics.find((x) => x.id === id)
    if (r) Object.assign(r, patch)
  }, `labRelic:${id}`)
}

function addRelic(): void {
  mutateLab((l) => {
    l.relics.push({
      id: `relic_${Date.now()}`,
      name: 'New Relic',
      trigger: 'combat_start',
      script: 'blk 5'
    })
  }, 'labAddRelic')
}

function patchPoolCard(id: string, patch: Record<string, unknown>): void {
  mutateLab((l) => {
    const c = l.cardPool.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
  }, `labPool:${id}`)
}

function addPoolCard(): void {
  mutateLab((l) => {
    l.cardPool.push(makeScriptCard(`pool_${Date.now()}`, 'New Pool Card', 1, 'dmg 7', 'common'))
  }, 'labAddPool')
}

function removePoolCard(id: string): void {
  mutateLab((l) => {
    l.cardPool = l.cardPool.filter((c) => c.id !== id)
  }, 'labDelPool')
}

// ───────── 3b. 模拟边际价值 & 重配平 ─────────
const valueRes = ref<MxCardMarginalValueResult | null>(null)
const valueRuns = ref(30)
const rebalanceRes = ref<MxCardRebalanceSuggestion | null>(null)

function runMarginalValue(): void {
  void runBusy(async () => {
    valueRes.value = await cardLabCompute.marginal(wb.value, lab.value, { runs: valueRuns.value })
    rebalanceRes.value = null
  })
}

function runRebalance(cardId: string): void {
  const card = lab.value.cardPool.find((c) => c.id === cardId)
  const target = valueRes.value?.medianPoolValuePerCost
  if (!card || target === undefined) return
  void runBusy(async () => {
    rebalanceRes.value = await cardLabCompute.rebalance(wb.value, lab.value, card, {
      targetValuePerCost: target,
      runs: valueRuns.value
    })
  })
}

function applyRebalance(): void {
  const sug = rebalanceRes.value
  if (!sug) return
  mutateLab((l) => {
    const idx = l.cardPool.findIndex((c) => c.id === sug.cardId)
    if (idx >= 0) l.cardPool[idx] = { ...sug.suggestedCard, effectScript: sug.afterScript }
  }, 'labApplyRebalance')
  feedback.value = L(
    `已将 ${sug.cardName} 数值 ×${sug.scaleFactor}`, // cjk-ok
    `Scaled ${sug.cardName} ×${sug.scaleFactor}`
  ) // cjk-ok
  rebalanceRes.value = null
}

// ───────── 4. 经济闭环 ─────────
const economyRes = ref<MxRunEconomyResult | null>(null)
const ECO_NUM_FIELDS: Array<keyof MxRunEconomyConfig> = [
  'floors',
  'runs',
  'startGold',
  'goldPerNormal',
  'goldPerElite',
  'cardRewardChoices',
  'rareWeightGrowthPerFloor',
  'shopEveryNFloors',
  'removePrice',
  'removePriceGrowth',
  'restEveryNFloors',
  'restHealPct',
  'eliteEveryNFloors',
  'enemyHpGrowthPerFloor',
  'enemyDmgGrowthPerFloor',
  'eventRatePct',
  'potionSlots',
  'potionDropRatePct'
]

function setEco(field: keyof MxRunEconomyConfig, v: number): void {
  mutateLab((l) => {
    ;(l.economy as unknown as Record<string, unknown>)[field] = v
  }, `labEco:${field}`)
}

function runEconomy(): void {
  void runBusy(async () => {
    economyRes.value = await cardLabCompute.economy(wb.value, lab.value)
    workerActive.value = isCardLabWorkerActive()
  })
}

// 目标通关率 → 反解某层级敌人血量
const workerActive = ref(false)
const solveTier = ref<MxEncounterSpec['tier']>('boss')
const solveTarget = ref(40)
/** 第二目标：该层级平均战损 %（留空 = 只按通关率求血量） */
const solveLossTarget = ref<number | null>(null)
const solveRes = ref<MxTierHpSolveResult | null>(null)

function runSolveHp(): void {
  void runBusy(async () => {
    solveRes.value = await cardLabCompute.solveHp(wb.value, lab.value, {
      tier: solveTier.value,
      targetClearRatePct: solveTarget.value,
      targetTierHpLossPct: solveLossTarget.value ?? undefined
    })
    workerActive.value = isCardLabWorkerActive()
  })
}

function applySolveHp(): void {
  const res = solveRes.value
  if (!res) return
  mutateLab((l) => {
    l.enemies = res.labPatch.enemies.map((e) => ({
      ...e,
      intents: e.intents.map((it) => ({ ...it }))
    }))
    l.encounters = res.labPatch.encounters.map((e) => ({ ...e, enemyIds: [...e.enemyIds] }))
  }, 'labApplySolveHp')
  feedback.value = L(
    `已按 血量×${res.scale} / 伤害×${res.dmgScale} 写回 ${res.enemyRows.length} 个敌人`, // cjk-ok
    `Applied HP ×${res.scale} / DMG ×${res.dmgScale} to ${res.enemyRows.length} enemies`
  ) // cjk-ok
  solveRes.value = null
  economyRes.value = null
}

// ───────── 5. 校准 ─────────
const csvText = ref('')
const calibrationRes = ref<MxCalibrationResult | null>(null)
const csvErrors = ref<string[]>([])

function runCalibration(): void {
  void runBusy(() => {
    const parsed = parseMxPlaytestLogCsv(csvText.value)
    csvErrors.value = parsed.errors
    calibrationRes.value = parsed.rows.length
      ? calibrateMxBattleModel(wb.value, lab.value, parsed.rows)
      : null
  })
}

function applyCalibrationScale(): void {
  const scale = calibrationRes.value?.suggestedEnemyHpScale
  if (!scale) return
  mutateLab((l) => {
    for (const e of l.enemies) e.hp = Math.max(1, Math.round(e.hp * scale))
  }, 'labApplyCalib')
  feedback.value = L(`已将所有敌人血量 ×${scale}`, `Scaled all enemy HP ×${scale}`) // cjk-ok
}

const relicSummary = (script: string): string =>
  formatMxCardEffectSummary(parseMxCardEffectScript(script))
const poolSummary = (c: MxCardDesignLabConfig['cardPool'][number]): string =>
  formatMxCardEffectSummary(mxResolveCardEffects(c))

const ui = computed(() => ({
  tabScripts: L('🧾 效果脚本', '🧾 Effect Scripts'), // cjk-ok
  tabBattle: L('🧠 AI 战斗 / 操作上限', '🧠 AI Battle / Skill Gap'), // cjk-ok
  tabValue: L('📊 真实边际价值 / 配平', '📊 Marginal Value / Rebalance'), // cjk-ok
  kernelUseEngine: L('工作台战斗内核改用效果引擎', 'Workbench kernel uses effect engine'), // cjk-ok
  kernelPolicy: L('内核出牌策略', 'Kernel policy'), // cjk-ok
  kernelHint: L(
    '牌库中任意卡填写脚本时，「① 战斗调度内核」的胜率/逆向求解/龙卷风/遥测/战报会自动改由效果引擎驱动；旧内核的敌人参数、6 种机制与遗物预设会被映射为意图表与遗物。', // cjk-ok
    'When any card has a script, the Combat Kernel tab (win rate, goal-seek, tornado, telemetry, replay) is driven by the effect engine; legacy enemy params, 6 mechanisms and relic presets are mapped automatically.'
  ), // cjk-ok
  valueHint: L(
    '卡池卡：在当前牌组中多加 1 张后跨多个遭遇模拟的胜率/战损变化；牌组卡：去掉 1 张后的变化（负值=拖后腿，建议删除）。与线性估值公式的排名差过大会被标出。', // cjk-ok
    'Pool cards: Δ from adding one copy across encounters; deck cards: Δ from removing one copy (negative = dead weight). Large rank gaps vs the linear formula are flagged.'
  ), // cjk-ok
  runValue: L('▶ 模拟测算边际价值', '▶ Measure Marginal Value'), // cjk-ok
  baseline: L('当前牌组基线', 'Baseline'), // cjk-ok
  medianVpc: L('卡池单费价值中位数', 'Pool median value/cost'), // cjk-ok
  poolValueTitle: L('卡池卡：加入 1 张的真实价值', 'Pool cards: value of adding one copy'), // cjk-ok
  deckValueTitle: L('牌组卡：保留 1 张的真实价值', 'Deck cards: value of keeping one copy'), // cjk-ok
  colHpSaved: L('节省战损', 'HP Saved'), // cjk-ok
  colSimVpc: L('模拟单费价值(排名)', 'Sim Value/Cost (rank)'), // cjk-ok
  colLinVpc: L('公式单费价值(排名)', 'Formula Value/Cost (rank)'), // cjk-ok
  colVerdict: L('公式偏差', 'Formula Bias'), // cjk-ok
  rebalanceBtn: L('求解配平', 'Rebalance'), // cjk-ok
  rebalanceTitle: L('配平建议', 'Rebalance Suggestion'), // cjk-ok
  target: L('目标单费价值', 'Target value/cost'), // cjk-ok
  applyRebalance: L('应用到卡池', 'Apply to Pool'), // cjk-ok
  removeHint: L('建议删除', 'Remove'), // cjk-ok
  tabTables: L('👹 敌人·遭遇·遗物·卡池', '👹 Enemies · Encounters · Relics · Pool'), // cjk-ok
  tabEconomy: L('💰 单局经济闭环', '💰 Run Economy Loop'), // cjk-ok
  tabCalibration: L('📈 试玩校准', '📈 Playtest Calibration'), // cjk-ok
  running: L('计算中…', 'Running…'), // cjk-ok
  dslHelp: L(
    '语法：语句用 ; 分隔。[触发:] [if 条件:] 操作 数值[x段数] [@all|@random|@self] [*x|*played|*hand|*exhausted]。触发：on_draw / turn_start / turn_end / on_exhaust / deathrattle(亡语)；条件：hand<=2、played>=3、energy>=2、hp<=50%、enemyhp<=30%、enemy.vuln、first；基础操作：dmg blk draw nrg vuln weak poison str dex frail thorns heal discard scry retain_all copy double summon(如 summon 3/2 taunt divine charge lifesteal) replay generate；高阶原语：discover 3 -1(发现三选一并减费) / tutor 1(牌库定向检索高价值牌) / revive 1(复活阵亡随从或打捞弃牌) / discount 1 [@all](手牌减费) / buff 2/2(全体友方随从+攻/+血)；自定义公式逃生口：expr dmg=block、expr heal=missing_hp*0.5（可用变量：hp max_hp missing_hp block energy turn hand draw discard exhausted played attacks board board_atk dead str dex thorns enemy_hp enemy_block enemy_poison enemy_vuln x）；关键词：kw exhaust, retain, innate, ethereal, power, x, unplayable。', // cjk-ok
    'Syntax: statements separated by ;. [trigger:] [if cond:] op amount[xHits] [@all|@random|@self] [*x|*played|*hand|*exhausted]. Triggers: on_draw / turn_start / turn_end / on_exhaust / deathrattle; conditions: hand<=2, played>=3, energy>=2, hp<=50%, enemyhp<=30%, enemy.vuln, first; base ops: dmg blk draw nrg vuln weak poison str dex frail thorns heal discard scry retain_all copy double summon (e.g. summon 3/2 taunt divine charge lifesteal) replay generate; high-order ops: discover 3 -1 / tutor 1 / revive 1 / discount 1 [@all] / buff 2/2; custom formula escape hatch: expr dmg=block, expr heal=missing_hp*0.5 (vars: hp max_hp missing_hp block energy turn hand draw discard exhausted played attacks board board_atk dead str dex thorns enemy_hp enemy_block enemy_poison enemy_vuln x); keywords: kw exhaust, retain, innate, ethereal, power, x, unplayable.'
  ),
  convertAll: L('⇢ 基础字段全部转为脚本', '⇢ Convert All to Scripts'), // cjk-ok
  addCard: L('+ 新增脚本卡', '+ Script Card'), // cjk-ok
  colCard: L('卡牌', 'Card'), // cjk-ok
  colCost: L('费用', 'Cost'), // cjk-ok
  colCount: L('张数', 'Copies'), // cjk-ok
  colScript: L('效果脚本（留空=使用基础字段）', 'Effect Script (empty = legacy fields)'), // cjk-ok
  colParsed: L('解析结果', 'Parsed'), // cjk-ok
  colVpc: L('单费价值', 'Value/Cost'), // cjk-ok
  encounter: L('遭遇', 'Encounter'), // cjk-ok
  policy: L('出牌策略', 'Play Policy'), // cjk-ok
  runs: L('模拟局数', 'Runs'), // cjk-ok
  playerHp: L('玩家血量', 'Player HP'), // cjk-ok
  runBattle: L('▶ 运行战斗模拟', '▶ Run Battle Sim'), // cjk-ok
  runSkillGap: L(
    '🎯 测量操作上限（乱出/贪心/搜索）', // cjk-ok
    '🎯 Measure Skill Gap (Random/Greedy/Search)'
  ), // cjk-ok
  policyHint: L(
    'random=萌新随机出牌；greedy=按优先级贪心；search=枚举本回合出牌+敌方回应（2-ply）；rollout=多回合蒙特卡洛前瞻（对未知抽牌重新洗混采样，仅 PvE）', // cjk-ok
    'random = novice; greedy = priority-based; search = 2-ply lookahead (this turn + enemy response); rollout = multi-turn Monte Carlo lookahead with reshuffled unknown draws (PvE only)'
  ),
  winRate: L('胜率', 'Win'), // cjk-ok
  ttk: L('击杀回合 P50/均值', 'TTK P50/Mean'), // cjk-ok
  hpLoss: L('平均战损 / P90', 'HP Loss Avg / P90'), // cjk-ok
  colPlays: L('场均打出', 'Plays'), // cjk-ok
  colDmg: L('场均伤害', 'DMG'), // cjk-ok
  colBlk: L('场均格挡', 'BLK'), // cjk-ok
  colStranded: L('卡手率', 'Stranded'), // cjk-ok
  replayTitle: L('样本局逐回合战报', 'Sample Battle Replay'), // cjk-ok
  colTurn: L('回合', 'Turn'), // cjk-ok
  colPlayed: L('出牌', 'Played'), // cjk-ok
  colEnemyAct: L('敌方行动', 'Enemy Actions'), // cjk-ok
  colHp: L('我方HP / 敌方HP', 'HP Me / Enemy'), // cjk-ok
  gapTitle: L('同一随机数下三种策略对比', 'Three policies under common random numbers'), // cjk-ok
  gapWin: L('搜索 vs 乱出 胜率差', 'Search − Random Win'), // cjk-ok
  gapLoss: L('战损比（乱出/搜索）', 'HP-Loss Ratio (Random/Search)'), // cjk-ok
  enemies: L('敌人与意图表', 'Enemies & Intents'), // cjk-ok
  addEnemy: L('+ 敌人', '+ Enemy'), // cjk-ok
  addIntent: L('+ 意图', '+ Intent'), // cjk-ok
  pattern: L('意图模式', 'Pattern'), // cjk-ok
  thorns: L('荆棘', 'Thorns'), // cjk-ok
  colIntent: L('意图名', 'Intent'), // cjk-ok
  colIDmg: L('伤害', 'DMG'), // cjk-ok
  colIHits: L('段数', 'Hits'), // cjk-ok
  colIBlk: L('格挡', 'BLK'), // cjk-ok
  colIStr: L('力量+', 'STR+'), // cjk-ok
  colIStatus: L('施加状态', 'Apply Status'), // cjk-ok
  colIStatusCards: L('塞废牌', 'Status Cards'), // cjk-ok
  colIWeight: L('权重', 'Weight'), // cjk-ok
  solveTitle: L('🎯 目标通关率 → 反解敌人血量', '🎯 Target Clear Rate → Solve Enemy HP'), // cjk-ok
  solveHint: L(
    '单目标（仅填目标通关率）：二分求解该层级敌人血量缩放；双目标（同时填层级战损 %）：在（血量 × 伤害）二维空间搜索；跨层级共用敌人会自动拆分为本层专属副本，不污染其他层', // cjk-ok
    'Single target (clear rate only): bisects tier enemy HP scale; dual target (+ tier HP loss %): searches 2D (HP × damage) space; shared enemies across tiers are auto-cloned into tier-isolated copies'
  ),
  atbScripts: L(
    '行动条单位技能脚本（action_bar 内核）', // cjk-ok
    'ATB Unit Skill Scripts (action_bar kernel)'
  ), // cjk-ok
  atbScriptsHint: L(
    '留空时按技能倍率/拉条/推条列自动生成；填写任一脚本或勾选「效果引擎」后，行动条内核改由 ATB 效果引擎驱动（双方真实血量/防御、敌方反击、单位阵亡）。语法：dmg 倍率[x段数] [@all|@random|@lowest]；heal 百分比% [@allies|@ally_lowest]；shield 百分比%；pull 幅度；push 幅度 @all；orb 数量；spd/atk 幅度；stun 概率%', // cjk-ok
    'Empty = generated from ratio/pull/push columns. Fill any script or enable the engine to run action_bar on the ATB effect engine (real HP/DEF, enemy counter-attacks, unit deaths). Ops: dmg ratio[xHits] [@all|@random|@lowest]; heal pct% [@allies|@ally_lowest]; shield pct%; pull pct; push pct @all; orb n; spd/atk pct; stun chance%'
  ),
  colTeam: L('阵营', 'Team'), // cjk-ok
  colSpd: L('速度', 'SPD'), // cjk-ok
  colUnitHp: L('血量', 'HP'), // cjk-ok
  solveTarget: L('目标通关率 %', 'Target Clear %'), // cjk-ok
  solveLossTarget: L('层级战损 %', 'Tier HP Loss %'), // cjk-ok
  solveLossHint: L(
    '可选第二目标：该层级每场战斗平均损失的血量占最大血量的百分比。填写后同时搜索血量与伤害两个系数', // cjk-ok
    'Optional second target: average HP lost per fight of this tier (% of max HP). When set, both HP and damage scales are searched'
  ),
  solveCloned: L('本层专属副本', 'tier copy'), // cjk-ok
  tierStats: L('分层统计', 'By Tier'), // cjk-ok
  solveRun: L('▶ 反解血量', '▶ Solve HP'), // cjk-ok
  solveApply: L('写回敌人表', 'Apply to Enemies'), // cjk-ok
  solveTooHard: L(
    '最小缩放仍达不到目标：瓶颈不在该层级（检查其他层或卡组）', // cjk-ok
    'Even the minimum scale misses the target: the bottleneck is elsewhere'
  ), // cjk-ok
  solveTooEasy: L(
    '最大缩放仍高于目标：该层级不构成威胁，需改伤害/机制', // cjk-ok
    'Even the maximum scale is above target: this tier is no threat, change damage/mechanics'
  ), // cjk-ok
  workerTip: L(
    '重计算在后台线程运行，界面不会卡顿', // cjk-ok
    'Heavy computation runs in a background worker'
  ), // cjk-ok
  manaScripts: L(
    '法力卡组效果脚本（mana_tempo 内核）', // cjk-ok
    'Mana Deck Effect Scripts (mana_tempo kernel)'
  ), // cjk-ok
  manaScriptsHint: L(
    '留空时按攻/血/直伤/抽牌列自动生成（灰色占位）；任意一张填写脚本或勾选「效果引擎」后，法力曲线内核改由效果引擎驱动：水晶 1→上限成长、手牌保留、起手调度，随从支持嘲讽/圣盾/冲锋/吸血/亡语，可切换 search 策略', // cjk-ok
    'Empty = generated from ATK/HP/Spell/Draw columns (grey placeholder). Fill any script or enable the engine to run the mana kernel on the effect engine: crystal ramp, kept hand, mulligan, minions with taunt/divine/charge/lifesteal/deathrattle, and the search policy'
  ),
  colIClear: L('解场', 'Clear Board'), // cjk-ok
  colIClearHint: L(
    '对玩家场上随从造成的解场伤害总量（从前排依次结算，圣盾抵消 2 点）', // cjk-ok
    'Total damage dealt to the player board (front minion first; divine shield absorbs 2)'
  ),
  pickMode: L('选卡方式', 'Pick Mode'), // cjk-ok
  pickFormula: L('估值公式', 'Formula'), // cjk-ok
  pickSimulated: L('实战模拟', 'Simulated'), // cjk-ok
  pickSimRuns: L('每候选模拟场数', 'Sims per Option'), // cjk-ok
  pickModeHint: L(
    '实战模拟：对每个奖励/商品（含跳过）以及商店删卡候选（价值最低的至多 8 种）用共同随机数各跑 N 场「下一场战斗 + 终局 Boss」，按胜场剩余血量择优；比估值公式慢约 20 倍，但不会被公式误导', // cjk-ok
    'Simulated: each offer (and skip) plus shop-removal candidates (up to 8 lowest-value cards) is scored by N common-random-number battles vs the next fight + the final boss, ranked by HP left on wins. ~20x slower than the formula, but not misled by it'
  ),
  encounters: L('遭遇表', 'Encounters'), // cjk-ok
  addEncounter: L('+ 遭遇', '+ Encounter'), // cjk-ok
  colTier: L('层级', 'Tier'), // cjk-ok
  colEnemyIds: L('敌人ID（逗号分隔）', 'Enemy IDs (comma-separated)'), // cjk-ok
  relics: L('遗物表（勾选=生效）', 'Relics (checked = active)'), // cjk-ok
  addRelic: L('+ 遗物', '+ Relic'), // cjk-ok
  colTrigger: L('触发', 'Trigger'), // cjk-ok
  cardPool: L('卡池（奖励/商店抽取）', 'Card Pool (rewards / shop)'), // cjk-ok
  addPool: L('+ 卡池卡', '+ Pool Card'), // cjk-ok
  colRarity: L('稀有度', 'Rarity'), // cjk-ok
  runEconomy: L('▶ 运行单局经济闭环', '▶ Run Economy Loop'), // cjk-ok
  ecoHint: L(
    '逐层：战斗（效果引擎，血量跨层继承）→ 金币 → 三选一/跳过 → 商店买卡/删卡 → 篝火回血或升级', // cjk-ok
    'Per floor: battle (effect engine, HP carries over) → gold → pick/skip reward → shop buy/remove → rest heal or upgrade'
  ),
  clearRate: L('通关率', 'Clear Rate'), // cjk-ok
  deathFloors: L('死亡层分布', 'Death Floors'), // cjk-ok
  cardsAdded: L('加卡/删卡/升级', 'Added/Removed/Upgraded'), // cjk-ok
  goldFlow: L('金币 收入/支出', 'Gold Earned/Spent'), // cjk-ok
  finalDeck: L('终局卡组张数', 'Final Deck Size'), // cjk-ok
  skipRate: L('奖励跳过率', 'Reward Skip Rate'), // cjk-ok
  branchingMap: L('分叉地图（智能择路/事件）', 'Branching Map (Smart Route / Events)'), // cjk-ok
  branchingMapHint: L(
    '开启后每层生成 2~3 条分叉候选（含问号随机事件：免费删卡/升级/回血赠药/卖血换金）；AI 残血（<48%）主动绕开精英并优先篝火/事件，健康（≥65%）主动猎杀精英，金币充足时优先进商店', // cjk-ok
    'Generates 2-3 candidate nodes per floor (including random events: free removal, upgrade, heal+potion, HP-for-gold); AI avoids elites when HP < 48% and seeks rest/events, hunts elites when HP >= 65%, and visits shops when gold is high'
  ),
  routePotionStats: L('事件/避战精英/喝药', 'Events / Elites Avoided / Potions Used'), // cjk-ok
  colFloor: L('层', 'Floor'), // cjk-ok
  colNode: L('节点', 'Node'), // cjk-ok
  colAlive: L('存活率', 'Alive'), // cjk-ok
  colAvgHp: L('平均血量', 'Avg HP'), // cjk-ok
  colAvgGold: L('平均金币', 'Avg Gold'), // cjk-ok
  colDeckSize: L('卡组张数', 'Deck Size'), // cjk-ok
  calHint: L(
    '粘贴试玩日志 CSV（表头：encounter,won,turns,hp_loss；encounter 填遭遇 ID 或名称）。有战损数据时按平均战损校准，否则按胜率校准。', // cjk-ok
    'Paste playtest CSV (header: encounter,won,turns,hp_loss). Calibrates on average HP loss when present, else on win rate.'
  ),
  runCalibration: L('▶ 对比预测并校准', '▶ Compare & Calibrate'), // cjk-ok
  applyScale: L('应用建议系数到全部敌人血量', 'Apply scale to all enemy HP'), // cjk-ok
  calTarget: L('校准目标', 'Target'), // cjk-ok
  suggested: L('建议敌方血量系数', 'Suggested Enemy HP Scale'), // cjk-ok
  winErr: L('胜率误差 校准前→后', 'Win Error Before→After'), // cjk-ok
  lossErr: L('战损误差 校准前→后', 'HP-Loss Error Before→After'), // cjk-ok
  colSamples: L('样本', 'N'), // cjk-ok
  colObsPred: L('实测 / 预测 / 校准后', 'Observed / Predicted / Calibrated'), // cjk-ok
  unmatched: L('未匹配遭遇', 'Unmatched'), // cjk-ok
  ecoLabels: {
    floors: L('层数', 'Floors'), // cjk-ok
    runs: L('模拟局数', 'Runs'), // cjk-ok
    startGold: L('初始金币', 'Start Gold'), // cjk-ok
    goldPerNormal: L('普通战金币', 'Gold/Normal'), // cjk-ok
    goldPerElite: L('精英战金币', 'Gold/Elite'), // cjk-ok
    cardRewardChoices: L('奖励选项数', 'Reward Choices'), // cjk-ok
    rareWeightGrowthPerFloor: L('稀有权重每层+', 'Rare Wt +/Floor'), // cjk-ok
    shopEveryNFloors: L('商店间隔', 'Shop Every N'), // cjk-ok
    removePrice: L('删卡价格', 'Remove Price'), // cjk-ok
    removePriceGrowth: L('删卡涨价', 'Remove +Price'), // cjk-ok
    restEveryNFloors: L('篝火间隔', 'Rest Every N'), // cjk-ok
    restHealPct: L('篝火回血%', 'Rest Heal %'), // cjk-ok
    eliteEveryNFloors: L('精英间隔', 'Elite Every N'), // cjk-ok
    enemyHpGrowthPerFloor: L('敌血每层成长', 'Enemy HP +/Floor'), // cjk-ok
    enemyDmgGrowthPerFloor: L('敌伤每层成长', 'Enemy DMG +/Floor'), // cjk-ok
    eventRatePct: L('事件概率%', 'Event Rate %'), // cjk-ok
    potionSlots: L('药水栏位', 'Potion Slots'), // cjk-ok
    potionDropRatePct: L('药水掉率%', 'Potion Drop %') // cjk-ok
  } as Record<string, string>
}))
</script>

<template>
  <div class="dl-root">
    <div class="dl-tabs">
      <button
        v-for="t in ['scripts', 'battle', 'value', 'tables', 'economy', 'calibration'] as const"
        :key="t"
        type="button"
        class="dl-btn"
        :class="{ 'is-on': tab === t }"
        @click="tab = t"
      >
        {{
          t === 'scripts'
            ? ui.tabScripts
            : t === 'battle'
              ? ui.tabBattle
              : t === 'value'
                ? ui.tabValue
                : t === 'tables'
                  ? ui.tabTables
                  : t === 'economy'
                    ? ui.tabEconomy
                    : ui.tabCalibration
        }}
      </button>
      <span v-if="busy" class="dl-tag is-warn">{{ ui.running }}</span>
      <span v-else-if="feedback" class="dl-feedback">✓ {{ feedback }}</span>
    </div>

    <!-- 1. 效果脚本 -->
    <div v-if="tab === 'scripts'">
      <p class="dl-help">{{ ui.dslHelp }}</p>
      <div class="dl-row">
        <button type="button" class="dl-btn is-on" @click="convertAllToScripts">
          {{ ui.convertAll }}
        </button>
        <button type="button" class="dl-btn" @click="addScriptCard">{{ ui.addCard }}</button>
        <label class="dl-field">
          <input
            type="checkbox"
            :checked="Boolean(wb.combatKernel.useEffectEngine)"
            @change="
              mutateWb(
                (w) =>
                  (w.combatKernel.useEffectEngine = ($event.target as HTMLInputElement).checked),
                'labUseEngine'
              )
            "
          />
          <span>{{ ui.kernelUseEngine }}</span>
        </label>
        <label class="dl-field">
          <span>{{ ui.kernelPolicy }}</span>
          <select
            class="dl-input"
            :value="wb.combatKernel.playPolicy ?? 'greedy'"
            @change="
              mutateWb(
                (w) => (w.combatKernel.playPolicy = str($event) as MxPlayPolicy),
                'labKernelPolicy'
              )
            "
          >
            <option v-for="p in POLICIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
      </div>
      <p class="dl-help">{{ ui.kernelHint }}</p>
      <table class="dl-table">
        <thead>
          <tr>
            <th>{{ ui.colCard }}</th>
            <th>{{ ui.colCost }}</th>
            <th>{{ ui.colCount }}</th>
            <th style="min-width: 220px">{{ ui.colScript }}</th>
            <th>{{ ui.colParsed }}</th>
            <th>{{ ui.colVpc }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in scriptRows" :key="r.card.id" :class="{ 'is-bad-row': r.errors.length }">
            <td>
              <input
                class="dl-input"
                :value="r.card.name"
                @input="
                  mutateWb((w) => {
                    const c = w.combatKernel.deckCards.find((x) => x.id === r.card.id)
                    if (c) c.name = str($event)
                  }, `labName:${r.card.id}`)
                "
              />
            </td>
            <td>
              <input
                type="number"
                class="dl-input is-num"
                :value="r.card.cost"
                @input="
                  mutateWb((w) => {
                    const c = w.combatKernel.deckCards.find((x) => x.id === r.card.id)
                    if (c) c.cost = num($event, 0)
                  }, `labCost:${r.card.id}`)
                "
              />
            </td>
            <td>
              <input
                type="number"
                class="dl-input is-num"
                :value="r.card.count"
                @input="
                  mutateWb((w) => {
                    const c = w.combatKernel.deckCards.find((x) => x.id === r.card.id)
                    if (c) c.count = Math.max(1, num($event, 1))
                  }, `labCount:${r.card.id}`)
                "
              />
            </td>
            <td>
              <input
                class="dl-input is-mono"
                :value="r.card.effectScript ?? ''"
                :placeholder="r.legacy"
                @input="setCardScript(r.card.id, str($event))"
              />
            </td>
            <td class="dl-mono">
              {{ r.summary }}
              <div v-for="(er, i) in r.errors" :key="i" class="dl-err">⚠ {{ er }}</div>
            </td>
            <td class="dl-mono">{{ r.vpc }}</td>
            <td>
              <button type="button" class="dl-x" @click="removeDeckCard(r.card.id)">×</button>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="wb.combatKernel.kernel === 'mana_tempo' && manaRows.length">
        <div class="dl-title">{{ ui.manaScripts }}</div>
        <p class="dl-help">{{ ui.manaScriptsHint }}</p>
        <table class="dl-table">
          <thead>
            <tr>
              <th>{{ ui.colCard }}</th>
              <th>{{ ui.colCost }}</th>
              <th>{{ ui.colCount }}</th>
              <th style="min-width: 240px">{{ ui.colScript }}</th>
              <th>{{ ui.colParsed }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in manaRows" :key="m.card.id" :class="{ 'is-bad-row': m.errors.length }">
              <td>{{ m.card.name }}</td>
              <td class="dl-mono">{{ m.card.manaCost }}</td>
              <td class="dl-mono">{{ m.card.count }}</td>
              <td>
                <input
                  class="dl-input is-mono"
                  :value="m.card.effectScript ?? ''"
                  :placeholder="m.generated"
                  @input="setManaScript(m.card.id, str($event))"
                />
              </td>
              <td class="dl-mono">
                {{ m.summary }}
                <div v-for="(er, i) in m.errors" :key="i" class="dl-err">⚠ {{ er }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template v-if="wb.combatKernel.kernel === 'action_bar' && atbRows.length">
        <div class="dl-title">{{ ui.atbScripts }}</div>
        <p class="dl-help">{{ ui.atbScriptsHint }}</p>
        <table class="dl-table">
          <thead>
            <tr>
              <th>{{ ui.colCard }}</th>
              <th>{{ ui.colTeam }}</th>
              <th>{{ ui.colSpd }}</th>
              <th>{{ ui.colUnitHp }}</th>
              <th style="min-width: 240px">{{ ui.colScript }}</th>
              <th>{{ ui.colParsed }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in atbRows" :key="a.unit.id" :class="{ 'is-bad-row': a.errors.length }">
              <td>{{ a.unit.name }}</td>
              <td class="dl-mono">{{ a.unit.team }}</td>
              <td class="dl-mono">{{ a.unit.speed }}</td>
              <td>
                <input
                  type="number"
                  class="dl-input is-num"
                  :value="a.unit.hp ?? ''"
                  placeholder="auto"
                  @input="
                    patchAtbUnit(a.unit.id, {
                      hp: str($event).trim() === '' ? undefined : Math.max(1, num($event, 1))
                    })
                  "
                />
              </td>
              <td>
                <input
                  class="dl-input is-mono"
                  :value="a.unit.skillScript ?? ''"
                  :placeholder="a.generated"
                  @input="patchAtbUnit(a.unit.id, { skillScript: str($event) })"
                />
              </td>
              <td class="dl-mono">
                {{ a.summary }}
                <div v-for="(er, i) in a.errors" :key="i" class="dl-err">⚠ {{ er }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <!-- 2. AI 战斗 -->
    <div v-else-if="tab === 'battle'">
      <div class="dl-row">
        <label class="dl-field">
          <span>{{ ui.encounter }}</span>
          <select
            class="dl-input"
            :value="lab.selectedEncounterId"
            @change="mutateLab((l) => (l.selectedEncounterId = str($event)), 'labSelEnc')"
          >
            <option v-for="e in lab.encounters" :key="e.id" :value="e.id">
              {{ e.name }} ({{ e.tier }})
            </option>
          </select>
        </label>
        <label class="dl-field">
          <span>{{ ui.policy }}</span>
          <select
            class="dl-input"
            :value="lab.policy"
            @change="mutateLab((l) => (l.policy = str($event) as MxPlayPolicy), 'labPolicy')"
          >
            <option v-for="p in POLICIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label class="dl-field">
          <span>{{ ui.runs }}</span>
          <input
            type="number"
            class="dl-input is-num"
            :value="lab.battleRuns"
            @input="mutateLab((l) => (l.battleRuns = Math.max(10, num($event, 100))), 'labRuns')"
          />
        </label>
        <label class="dl-field">
          <span>{{ ui.playerHp }}</span>
          <input
            type="number"
            class="dl-input is-num"
            :value="lab.playerHp"
            @input="mutateLab((l) => (l.playerHp = Math.max(1, num($event, 80))), 'labHp')"
          />
        </label>
        <button type="button" class="dl-btn is-on" :disabled="busy" @click="runBattle">
          {{ ui.runBattle }}
        </button>
        <button type="button" class="dl-btn" :disabled="busy" @click="runSkillGap">
          {{ ui.runSkillGap }}
        </button>
      </div>
      <p class="dl-help">{{ ui.policyHint }}</p>

      <div v-if="skillGapRes" class="dl-card">
        <div class="dl-title">{{ ui.gapTitle }}</div>
        <div class="dl-row">
          <span
            v-for="r in [skillGapRes.random, skillGapRes.greedy, skillGapRes.search]"
            :key="r.policy"
            class="dl-tag dl-mono"
          >
            {{ r.policy }}: {{ ui.winRate }} {{ r.winRatePct }}% · TTK {{ r.ttkMean }} · HP -{{
              r.avgHpLoss
            }}
          </span>
        </div>
        <div class="dl-row">
          <span class="dl-tag is-good dl-mono"
            >{{ ui.gapWin }}: {{ skillGapRes.skillGapWinPct }}pp</span
          >
          <span class="dl-tag is-good dl-mono"
            >{{ ui.gapLoss }}: {{ skillGapRes.hpLossRatio }}x</span
          >
          <span
            class="dl-tag"
            :class="skillGapRes.verdict === 'flat_brainless' ? 'is-warn' : 'is-good'"
          >
            {{ skillGapRes.verdict }}
          </span>
        </div>
      </div>

      <div v-if="battleRes" class="dl-card">
        <div class="dl-row">
          <span class="dl-tag is-good dl-mono">{{ ui.winRate }} {{ battleRes.winRatePct }}%</span>
          <span class="dl-tag dl-mono"
            >{{ ui.ttk }} {{ battleRes.ttkP50 }} / {{ battleRes.ttkMean }}</span
          >
          <span class="dl-tag dl-mono"
            >{{ ui.hpLoss }} {{ battleRes.avgHpLoss }} / {{ battleRes.hpLossP90 }}</span
          >
          <span class="dl-tag dl-mono">{{ battleRes.policy }} ×{{ battleRes.runs }}</span>
        </div>
        <div class="dl-split-grid">
          <div>
            <table class="dl-table">
              <thead>
                <tr>
                  <th>{{ ui.colCard }}</th>
                  <th>{{ ui.colPlays }}</th>
                  <th>{{ ui.colDmg }}</th>
                  <th>{{ ui.colBlk }}</th>
                  <th>{{ ui.colStranded }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in battleRes.cardStats" :key="c.cardId">
                  <td>{{ c.cardName }}</td>
                  <td class="dl-mono">{{ c.playsPerBattle }}</td>
                  <td class="dl-mono">{{ c.damagePerBattle }}</td>
                  <td class="dl-mono">{{ c.blockPerBattle }}</td>
                  <td class="dl-mono">{{ c.strandedPct }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div class="dl-title">{{ ui.replayTitle }}</div>
            <table class="dl-table">
              <thead>
                <tr>
                  <th>{{ ui.colTurn }}</th>
                  <th>{{ ui.colPlayed }}</th>
                  <th>DMG / BLK</th>
                  <th>{{ ui.colEnemyAct }}</th>
                  <th>{{ ui.colHp }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in battleRes.replay" :key="t.turn">
                  <td class="dl-mono">T{{ t.turn }}</td>
                  <td class="dl-mono">{{ t.cardsPlayed.join(' ➔ ') || '-' }}</td>
                  <td class="dl-mono">{{ t.damageDealt }} / {{ t.blockGained }}</td>
                  <td class="dl-mono">{{ t.enemyActions.join(', ') || '-' }}</td>
                  <td class="dl-mono">{{ t.playerHpAfter }} / {{ t.enemyHpAfter }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 表格 -->
    <div v-else-if="tab === 'value'">
      <p class="dl-help">{{ ui.valueHint }}</p>
      <div class="dl-row">
        <label class="dl-field">
          <span>{{ ui.runs }}</span>
          <input v-model.number="valueRuns" type="number" class="dl-input is-num" />
        </label>
        <button type="button" class="dl-btn is-on" :disabled="busy" @click="runMarginalValue">
          {{ ui.runValue }}
        </button>
      </div>
      <div v-if="rebalanceRes" class="dl-card">
        <div class="dl-title">{{ ui.rebalanceTitle }}: {{ rebalanceRes.cardName }}</div>
        <div class="dl-row">
          <span class="dl-tag dl-mono">{{ ui.target }} {{ rebalanceRes.targetValuePerCost }}</span>
          <span class="dl-tag is-good dl-mono"
            >×{{ rebalanceRes.scaleFactor }} → {{ rebalanceRes.achievedValuePerCost }}</span
          >
          <span class="dl-tag dl-mono"
            >{{ rebalanceRes.beforeScript }} ➔ {{ rebalanceRes.afterScript }}</span
          >
          <button type="button" class="dl-btn is-on" @click="applyRebalance">
            {{ ui.applyRebalance }}
          </button>
        </div>
      </div>
      <div v-if="valueRes" class="dl-card">
        <div class="dl-row">
          <span class="dl-tag dl-mono"
            >{{ ui.baseline }}: {{ ui.winRate }} {{ valueRes.baselineWinPct }}% · HP -{{
              valueRes.baselineHpLoss
            }}</span
          >
          <span class="dl-tag dl-mono"
            >{{ ui.encounter }}: {{ valueRes.encounterIds.join(', ') }} ×{{
              valueRes.runsPerEncounter
            }}</span
          >
          <span class="dl-tag is-good dl-mono"
            >{{ ui.medianVpc }} {{ valueRes.medianPoolValuePerCost }}</span
          >
        </div>
        <div class="dl-split-grid">
          <div>
            <div class="dl-title">{{ ui.poolValueTitle }}</div>
            <table class="dl-table">
              <thead>
                <tr>
                  <th>{{ ui.colCard }}</th>
                  <th>{{ ui.colCost }}</th>
                  <th>Δ{{ ui.winRate }}</th>
                  <th>{{ ui.colHpSaved }}</th>
                  <th>{{ ui.colSimVpc }}</th>
                  <th>{{ ui.colLinVpc }}</th>
                  <th>{{ ui.colVerdict }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in valueRes.poolRows"
                  :key="r.cardId"
                  :class="{ 'is-bad-row': r.verdict !== 'consistent' }"
                >
                  <td>{{ r.cardName }}</td>
                  <td class="dl-mono">{{ r.cost }}</td>
                  <td class="dl-mono">{{ r.deltaWinPct > 0 ? '+' : '' }}{{ r.deltaWinPct }}pp</td>
                  <td class="dl-mono">{{ r.hpSaved }}</td>
                  <td class="dl-mono">{{ r.simValuePerCost }} (#{{ r.simRank }})</td>
                  <td class="dl-mono">{{ r.linearValuePerCost }} (#{{ r.linearRank }})</td>
                  <td>
                    <span
                      class="dl-tag"
                      :class="r.verdict === 'consistent' ? 'is-good' : 'is-warn'"
                      >{{ r.verdict }}</span
                    >
                  </td>
                  <td>
                    <button
                      type="button"
                      class="dl-btn"
                      :disabled="busy"
                      @click="runRebalance(r.cardId)"
                    >
                      {{ ui.rebalanceBtn }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div class="dl-title">{{ ui.deckValueTitle }}</div>
            <table class="dl-table">
              <thead>
                <tr>
                  <th>{{ ui.colCard }}</th>
                  <th>{{ ui.colCost }}</th>
                  <th>Δ{{ ui.winRate }}</th>
                  <th>{{ ui.colHpSaved }}</th>
                  <th>{{ ui.colSimVpc }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in valueRes.deckRows"
                  :key="r.cardId"
                  :class="{ 'is-bad-row': r.simValue < 0 }"
                >
                  <td>
                    {{ r.cardName }}
                    <span v-if="r.simValue < 0" class="dl-tag is-warn">{{ ui.removeHint }}</span>
                  </td>
                  <td class="dl-mono">{{ r.cost }}</td>
                  <td class="dl-mono">{{ r.deltaWinPct > 0 ? '+' : '' }}{{ r.deltaWinPct }}pp</td>
                  <td class="dl-mono">{{ r.hpSaved }}</td>
                  <td class="dl-mono">{{ r.simValuePerCost }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 表格 -->
    <div v-else-if="tab === 'tables'">
      <div class="dl-row">
        <span class="dl-title">{{ ui.enemies }}</span>
        <button type="button" class="dl-btn" @click="addEnemy">{{ ui.addEnemy }}</button>
      </div>
      <div class="dl-enemy-grid">
        <div v-for="e in lab.enemies" :key="e.id" class="dl-card">
          <div class="dl-row">
            <span class="dl-tag dl-mono">{{ e.id }}</span>
            <input
              class="dl-input"
              :value="e.name"
              @input="patchEnemy(e.id, { name: str($event) })"
            />
            <label class="dl-field"
              ><span>HP</span
              ><input
                type="number"
                class="dl-input is-num"
                :value="e.hp"
                @input="patchEnemy(e.id, { hp: Math.max(1, num($event, 1)) })"
            /></label>
            <label class="dl-field"
              ><span>{{ ui.pattern }}</span
              ><select
                class="dl-input"
                :value="e.pattern"
                @change="patchEnemy(e.id, { pattern: str($event) })"
              >
                <option value="cycle">cycle</option>
                <option value="random">random</option>
              </select></label
            >
            <label class="dl-field"
              ><span>{{ ui.thorns }}</span
              ><input
                type="number"
                class="dl-input is-num"
                :value="e.thorns ?? 0"
                @input="patchEnemy(e.id, { thorns: num($event, 0) })"
            /></label>
            <button type="button" class="dl-btn" @click="addIntent(e.id)">
              {{ ui.addIntent }}
            </button>
            <button type="button" class="dl-x" @click="removeEnemy(e.id)">×</button>
          </div>
          <table class="dl-table">
            <thead>
              <tr>
                <th>{{ ui.colIntent }}</th>
                <th>{{ ui.colIDmg }}</th>
                <th>{{ ui.colIHits }}</th>
                <th>{{ ui.colIBlk }}</th>
                <th>{{ ui.colIStr }}</th>
                <th>{{ ui.colIStatus }}</th>
                <th>{{ ui.colIStatusCards }}</th>
                <th :title="ui.colIClearHint">{{ ui.colIClear }}</th>
                <th v-if="e.pattern === 'random'">{{ ui.colIWeight }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, ii) in e.intents" :key="ii">
                <td>
                  <input
                    class="dl-input"
                    :value="it.name"
                    @input="patchIntent(e.id, ii, { name: str($event) })"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.damage"
                    @input="patchIntent(e.id, ii, { damage: num($event, 0) })"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.hits"
                    @input="patchIntent(e.id, ii, { hits: Math.max(1, num($event, 1)) })"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.block"
                    @input="patchIntent(e.id, ii, { block: num($event, 0) })"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.strengthGain"
                    @input="patchIntent(e.id, ii, { strengthGain: num($event, 0) })"
                  />
                </td>
                <td>
                  <select
                    class="dl-input"
                    :value="it.applyStatus ?? ''"
                    @change="
                      patchIntent(e.id, ii, {
                        applyStatus: (str($event) || undefined) as MxStatusId | undefined
                      })
                    "
                  >
                    <option value="">-</option>
                    <option v-for="st in STATUSES" :key="st" :value="st">{{ st }}</option>
                  </select>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.applyAmount ?? 0"
                    @input="patchIntent(e.id, ii, { applyAmount: num($event, 0) })"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.addStatusCards"
                    @input="patchIntent(e.id, ii, { addStatusCards: Math.max(0, num($event, 0)) })"
                  />
                  <select
                    class="dl-input"
                    :value="it.statusCardKind ?? 'dazed'"
                    @change="
                      patchIntent(e.id, ii, {
                        statusCardKind: str($event) as 'dazed' | 'slimed' | 'burn' | 'wound'
                      })
                    "
                  >
                    <option value="dazed">Dazed</option>
                    <option value="slimed">Slimed</option>
                    <option value="burn">Burn</option>
                    <option value="wound">Wound</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.clearBoard ?? 0"
                    @input="
                      patchIntent(e.id, ii, {
                        clearBoard: Math.max(0, num($event, 0)) || undefined
                      })
                    "
                  />
                </td>
                <td v-if="e.pattern === 'random'">
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="it.weight ?? 1"
                    @input="patchIntent(e.id, ii, { weight: Math.max(0, num($event, 1)) })"
                  />
                </td>
                <td>
                  <button type="button" class="dl-x" @click="removeIntent(e.id, ii)">×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="dl-split-grid">
        <div class="dl-card">
          <div class="dl-row">
            <span class="dl-title">{{ ui.encounters }}</span>
            <button type="button" class="dl-btn" @click="addEncounter">
              {{ ui.addEncounter }}
            </button>
          </div>
          <table class="dl-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{{ ui.colCard }}</th>
                <th>{{ ui.colTier }}</th>
                <th>{{ ui.colEnemyIds }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="enc in lab.encounters" :key="enc.id">
                <td class="dl-mono">{{ enc.id }}</td>
                <td>
                  <input
                    class="dl-input"
                    :value="enc.name"
                    @input="patchEncounter(enc.id, { name: str($event) })"
                  />
                </td>
                <td>
                  <select
                    class="dl-input"
                    :value="enc.tier"
                    @change="
                      patchEncounter(enc.id, { tier: str($event) as MxEncounterSpec['tier'] })
                    "
                  >
                    <option v-for="t in TIERS" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td>
                  <input
                    class="dl-input is-mono"
                    :value="enc.enemyIds.join(', ')"
                    @change="
                      patchEncounter(enc.id, {
                        enemyIds: str($event)
                          .split(/[,\s]+/)
                          .filter(Boolean)
                      })
                    "
                  />
                </td>
                <td>
                  <button type="button" class="dl-x" @click="removeEncounter(enc.id)">×</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="dl-card">
          <div class="dl-row">
            <span class="dl-title">{{ ui.relics }}</span>
            <button type="button" class="dl-btn" @click="addRelic">{{ ui.addRelic }}</button>
          </div>
          <table class="dl-table">
            <thead>
              <tr>
                <th></th>
                <th>{{ ui.colCard }}</th>
                <th>{{ ui.colTrigger }}</th>
                <th>N</th>
                <th>{{ ui.colScript }}</th>
                <th>{{ ui.colParsed }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in lab.relics" :key="r.id">
                <td>
                  <input
                    type="checkbox"
                    :checked="lab.activeRelicIds.includes(r.id)"
                    @change="toggleRelic(r.id)"
                  />
                </td>
                <td>
                  <input
                    class="dl-input"
                    :value="r.name"
                    @input="patchRelic(r.id, { name: str($event) })"
                  />
                </td>
                <td>
                  <select
                    class="dl-input"
                    :value="r.trigger"
                    @change="patchRelic(r.id, { trigger: str($event) })"
                  >
                    <option v-for="t in RELIC_TRIGGERS" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    class="dl-input is-num"
                    :value="r.n ?? 3"
                    @input="patchRelic(r.id, { n: Math.max(1, num($event, 3)) })"
                  />
                </td>
                <td>
                  <input
                    class="dl-input is-mono"
                    :value="r.script"
                    @input="patchRelic(r.id, { script: str($event) })"
                  />
                </td>
                <td class="dl-mono">{{ relicSummary(r.script) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="dl-row">
        <span class="dl-title">{{ ui.cardPool }}</span>
        <button type="button" class="dl-btn" @click="addPoolCard">{{ ui.addPool }}</button>
      </div>
      <table class="dl-table">
        <thead>
          <tr>
            <th>{{ ui.colCard }}</th>
            <th>{{ ui.colCost }}</th>
            <th>{{ ui.colRarity }}</th>
            <th>{{ ui.colScript }}</th>
            <th>{{ ui.colParsed }}</th>
            <th>{{ ui.colVpc }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in lab.cardPool" :key="c.id">
            <td>
              <input
                class="dl-input"
                :value="c.name"
                @input="patchPoolCard(c.id, { name: str($event) })"
              />
            </td>
            <td>
              <input
                type="number"
                class="dl-input is-num"
                :value="c.cost"
                @input="patchPoolCard(c.id, { cost: num($event, 0) })"
              />
            </td>
            <td>
              <select
                class="dl-input"
                :value="c.rarity ?? 'common'"
                @change="patchPoolCard(c.id, { rarity: str($event) })"
              >
                <option value="common">common</option>
                <option value="uncommon">uncommon</option>
                <option value="rare">rare</option>
              </select>
            </td>
            <td>
              <input
                class="dl-input is-mono"
                :value="c.effectScript ?? ''"
                @input="patchPoolCard(c.id, { effectScript: str($event) })"
              />
            </td>
            <td class="dl-mono">{{ poolSummary(c) }}</td>
            <td class="dl-mono">{{ Math.round(mxCardValuePerCost(c) * 10) / 10 }}</td>
            <td><button type="button" class="dl-x" @click="removePoolCard(c.id)">×</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 4. 经济闭环 -->
    <div v-else-if="tab === 'economy'">
      <p class="dl-help">{{ ui.ecoHint }}</p>
      <div class="dl-grid">
        <label v-for="f in ECO_NUM_FIELDS" :key="f" class="dl-field">
          <span>{{ ui.ecoLabels[f] }}</span>
          <input
            type="number"
            step="any"
            class="dl-input is-num"
            :value="lab.economy[f] as number"
            @input="setEco(f, num($event, 0))"
          />
        </label>
        <label class="dl-field">
          <span>{{ ui.policy }}</span>
          <select
            class="dl-input"
            :value="lab.economy.policy"
            @change="
              mutateLab((l) => (l.economy.policy = str($event) as MxPlayPolicy), 'labEcoPolicy')
            "
          >
            <option v-for="p in POLICIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label class="dl-field" :title="ui.pickModeHint">
          <span>{{ ui.pickMode }}</span>
          <select
            class="dl-input"
            :value="lab.economy.pickMode ?? 'formula'"
            @change="
              mutateLab(
                (l) => (l.economy.pickMode = str($event) as 'formula' | 'simulated'),
                'labEcoPickMode'
              )
            "
          >
            <option value="formula">{{ ui.pickFormula }}</option>
            <option value="simulated">{{ ui.pickSimulated }}</option>
          </select>
        </label>
        <label v-if="lab.economy.pickMode === 'simulated'" class="dl-field">
          <span>{{ ui.pickSimRuns }}</span>
          <input
            type="number"
            class="dl-input is-num"
            :value="lab.economy.pickSimRuns ?? 6"
            @input="
              mutateLab(
                (l) => (l.economy.pickSimRuns = Math.max(2, Math.min(40, num($event, 6)))),
                'labEcoPickRuns'
              )
            "
          />
        </label>
        <label class="dl-check" :title="ui.branchingMapHint">
          <input
            type="checkbox"
            :checked="lab.economy.branchingMap !== false"
            @change="mutateLab((l) => (l.economy.branchingMap = bool($event)), 'labEcoBranching')"
          />
          <span>{{ ui.branchingMap }}</span>
        </label>
      </div>
      <div class="dl-row">
        <button type="button" class="dl-btn is-on" :disabled="busy" @click="runEconomy">
          {{ ui.runEconomy }}
        </button>
      </div>
      <div v-if="economyRes" class="dl-card">
        <div class="dl-row">
          <span class="dl-tag is-good dl-mono"
            >{{ ui.clearRate }} {{ economyRes.clearRatePct }}%</span
          >
          <span class="dl-tag dl-mono"
            >{{ economyRes.pickMode === 'simulated' ? ui.pickSimulated : ui.pickFormula
            }}<template v-if="economyRes.pickSimBattles">
              · {{ economyRes.pickSimBattles }} sims</template
            ></span
          >
          <span class="dl-tag dl-mono">
            {{ ui.cardsAdded }} {{ economyRes.avgCardsAdded }} / {{ economyRes.avgCardsRemoved }} /
            {{ economyRes.avgUpgrades }}
          </span>
          <span class="dl-tag dl-mono"
            >{{ ui.goldFlow }} {{ economyRes.avgGoldEarned }} / {{ economyRes.avgGoldSpent }}</span
          >
          <span class="dl-tag dl-mono">{{ ui.finalDeck }} {{ economyRes.avgFinalDeckSize }}</span>
          <span class="dl-tag dl-mono">{{ ui.skipRate }} {{ economyRes.rewardSkipRatePct }}%</span>
          <span class="dl-tag dl-mono">
            {{ ui.routePotionStats }} {{ economyRes.avgEventsVisited ?? 0 }} /
            {{ economyRes.avgElitesAvoided ?? 0 }} / {{ economyRes.avgPotionsUsed ?? 0 }}
          </span>
        </div>
        <div class="dl-row">
          <span class="dl-title">{{ ui.tierStats }}:</span>
          <span v-for="t in economyRes.tierStats" :key="t.tier" class="dl-tag dl-mono">
            {{ t.tier }} ×{{ t.fights }} · {{ ui.winRate }} {{ t.winRatePct }}% · HP -{{
              t.avgHpLossPct
            }}%
          </span>
        </div>
        <div class="dl-row">
          <span class="dl-title">{{ ui.deathFloors }}:</span>
          <span
            v-for="d in economyRes.deathFloorHistogram"
            :key="d.floor"
            class="dl-tag is-warn dl-mono"
          >
            F{{ d.floor }} ×{{ d.deaths }}
          </span>
        </div>
        <table class="dl-table">
          <thead>
            <tr>
              <th>{{ ui.colFloor }}</th>
              <th>{{ ui.colNode }}</th>
              <th>{{ ui.colAlive }}</th>
              <th>{{ ui.colAvgHp }}</th>
              <th>{{ ui.colAvgGold }}</th>
              <th>{{ ui.colDeckSize }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in economyRes.floorRows"
              :key="r.floor"
              :class="{ 'is-bad-row': r.aliveRatePct < 50 }"
            >
              <td class="dl-mono">{{ r.floor }}</td>
              <td class="dl-mono">{{ r.node }}</td>
              <td class="dl-mono">{{ r.aliveRatePct }}%</td>
              <td class="dl-mono">{{ r.avgHp }}</td>
              <td class="dl-mono">{{ r.avgGold }}</td>
              <td class="dl-mono">{{ r.avgDeckSize }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="dl-title">{{ ui.solveTitle }}</div>
      <p class="dl-help">{{ ui.solveHint }}</p>
      <div class="dl-row">
        <label class="dl-field">
          <span>{{ ui.colTier }}</span>
          <select
            class="dl-input"
            :value="solveTier"
            @change="solveTier = str($event) as MxEncounterSpec['tier']"
          >
            <option v-for="t in TIERS" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="dl-field">
          <span>{{ ui.solveTarget }}</span>
          <input
            type="number"
            class="dl-input is-num"
            :value="solveTarget"
            @input="solveTarget = Math.max(0, Math.min(100, num($event, 40)))"
          />
        </label>
        <label class="dl-field" :title="ui.solveLossHint">
          <span>{{ ui.solveLossTarget }}</span>
          <input
            type="number"
            class="dl-input is-num"
            :value="solveLossTarget ?? ''"
            placeholder="-"
            @input="
              solveLossTarget =
                str($event).trim() === '' ? null : Math.max(0, Math.min(100, num($event, 0)))
            "
          />
        </label>
        <button type="button" class="dl-btn is-on" :disabled="busy" @click="runSolveHp">
          {{ ui.solveRun }}
        </button>
        <span v-if="workerActive" class="dl-tag dl-mono" :title="ui.workerTip">⚙ worker</span>
      </div>
      <div v-if="solveRes" class="dl-card">
        <div class="dl-row">
          <span class="dl-tag dl-mono" :class="solveRes.converged ? 'is-good' : 'is-warn'">
            HP ×{{ solveRes.scale }} · DMG ×{{ solveRes.dmgScale }} → {{ ui.clearRate }}
            {{ solveRes.achievedClearRatePct }}% ({{ ui.solveTarget }}
            {{ solveRes.targetClearRatePct }}%)
          </span>
          <span class="dl-tag dl-mono">
            {{ ui.solveLossTarget }} {{ solveRes.achievedTierHpLossPct }}%<template
              v-if="solveRes.targetTierHpLossPct !== undefined"
            >
              / {{ solveRes.targetTierHpLossPct }}%</template
            >
          </span>
          <span v-if="solveRes.bound === 'too_hard'" class="dl-tag is-warn">{{
            ui.solveTooHard
          }}</span>
          <span v-if="solveRes.bound === 'too_easy'" class="dl-tag is-warn">{{
            ui.solveTooEasy
          }}</span>
          <button
            type="button"
            class="dl-btn"
            :disabled="!solveRes.enemyRows.length"
            @click="applySolveHp"
          >
            {{ ui.solveApply }}
          </button>
        </div>
        <div class="dl-row">
          <span v-for="e in solveRes.enemyRows" :key="e.id" class="dl-tag dl-mono"
            >{{ e.name }} {{ e.hpBefore }} → {{ e.hpAfter
            }}<template v-if="e.cloned"> ({{ ui.solveCloned }})</template></span
          >
        </div>
        <div class="dl-row">
          <span v-for="(it, i) in solveRes.iterations" :key="i" class="dl-tag dl-mono"
            >×{{ it.scale }}/{{ it.dmgScale }}: {{ it.clearRatePct }}% · -{{
              it.tierHpLossPct
            }}%</span
          >
        </div>
      </div>
    </div>

    <!-- 5. 校准 -->
    <div v-else>
      <p class="dl-help">{{ ui.calHint }}</p>
      <textarea
        v-model="csvText"
        class="dl-textarea"
        rows="7"
        placeholder="encounter,won,turns,hp_loss&#10;n_jaw,1,5,12&#10;n_jaw,0,9,80&#10;e_nob,1,8,35"
      ></textarea>
      <div class="dl-row">
        <button type="button" class="dl-btn is-on" :disabled="busy" @click="runCalibration">
          {{ ui.runCalibration }}
        </button>
        <button v-if="calibrationRes" type="button" class="dl-btn" @click="applyCalibrationScale">
          {{ ui.applyScale }} (×{{ calibrationRes.suggestedEnemyHpScale }})
        </button>
      </div>
      <div v-for="(er, i) in csvErrors" :key="i" class="dl-err">⚠ {{ er }}</div>
      <div v-if="calibrationRes" class="dl-card">
        <div class="dl-row">
          <span class="dl-tag dl-mono"
            >{{ ui.calTarget }}: {{ calibrationRes.calibrationTarget }}</span
          >
          <span class="dl-tag is-good dl-mono"
            >{{ ui.suggested }}: ×{{ calibrationRes.suggestedEnemyHpScale }}</span
          >
          <span class="dl-tag dl-mono">
            {{ ui.winErr }}: {{ calibrationRes.meanAbsWinErrBefore }} →
            {{ calibrationRes.meanAbsWinErrAfter }}pp
          </span>
          <span class="dl-tag dl-mono">
            {{ ui.lossErr }}: {{ calibrationRes.meanAbsHpLossErrBefore }} →
            {{ calibrationRes.meanAbsHpLossErrAfter }}
          </span>
          <span v-if="calibrationRes.unmatchedEncounters.length" class="dl-tag is-warn dl-mono">
            {{ ui.unmatched }}: {{ calibrationRes.unmatchedEncounters.join(', ') }}
          </span>
        </div>
        <table class="dl-table">
          <thead>
            <tr>
              <th>{{ ui.encounter }}</th>
              <th>{{ ui.colSamples }}</th>
              <th>{{ ui.winRate }} · {{ ui.colObsPred }}</th>
              <th>HP Loss · {{ ui.colObsPred }}</th>
              <th>TTK</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in calibrationRes.rows" :key="r.encounterId">
              <td class="dl-mono">{{ r.encounterId }}</td>
              <td class="dl-mono">{{ r.samples }}</td>
              <td class="dl-mono">
                {{ r.observedWinPct }}% / {{ r.predictedWinPct }}% / {{ r.calibratedWinPct }}%
              </td>
              <td class="dl-mono">
                {{ r.observedHpLoss }} / {{ r.predictedHpLoss }} / {{ r.calibratedHpLoss }}
              </td>
              <td class="dl-mono">{{ r.observedTurns }} / {{ r.predictedTurns }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dl-root {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--text);
}
.dl-tabs,
.dl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.dl-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.dl-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.dl-btn.is-on {
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  color: var(--accent);
}
.dl-btn:disabled {
  opacity: 0.5;
  cursor: progress;
}
.dl-x {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
}
.dl-x:hover {
  color: #ef4444;
}
.dl-help {
  margin: 0 0 4px;
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.5;
}
.dl-title {
  font-weight: 700;
  font-size: 11px;
}
.dl-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 6px;
  background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
}
.dl-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 6px;
}
.dl-table th,
.dl-table td {
  border-bottom: 1px solid var(--border);
  padding: 2px 4px;
  text-align: left;
  vertical-align: top;
}
.dl-table th {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 600;
}
.dl-table tr.is-bad-row td {
  background: rgba(239, 68, 68, 0.08);
}
.dl-input {
  width: 100%;
  min-width: 60px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
}
.dl-input.is-num {
  width: 56px;
  min-width: 44px;
}
.dl-input.is-mono,
.dl-mono {
  font-family: var(--font-mono, ui-monospace, monospace);
}
.dl-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
}
.dl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 4px 10px;
  margin-bottom: 6px;
}
.dl-grid .dl-field {
  justify-content: space-between;
}
.dl-split-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
  gap: 10px;
  align-items: start;
}
.dl-enemy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
  gap: 8px;
  align-items: start;
  margin-bottom: 6px;
}
.dl-tag {
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elevated));
  font-size: 10px;
}
.dl-tag.is-good {
  background: rgba(16, 185, 129, 0.16);
  color: #10b981;
}
.dl-tag.is-warn {
  background: rgba(245, 158, 11, 0.16);
  color: #f59e0b;
}
.dl-err {
  color: #ef4444;
  font-size: 10px;
}
.dl-feedback {
  color: #22c55e;
  font-size: 10px;
  font-weight: 600;
}
.dl-textarea {
  width: 100%;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 4px;
  margin-bottom: 4px;
}
</style>
