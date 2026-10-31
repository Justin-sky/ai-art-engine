<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  detectWishPromptCategory,
  formatLuckTotal,
  getFairyStageActReaction,
  nextFairyStageAct,
  nextWishFairyId,
  pickFairyPokeReaction,
  pickNextWishChant,
  rollLuckGain,
  selectWishFairyForSession,
  type WishChantCategory,
  type WishFairyExpression,
  type WishFairyId,
  type WishFairyPersona,
  type WishFairyPose,
  type WishFairyStageAct,
  type WishFloatingChant,
  type WishLuckPopup,
  type WishShrinePhase
} from '@shared/chatWishShrine'

const props = defineProps<{
  running: boolean
  sessionId?: string
  sessionTitle?: string
  promptText?: string
  activityText?: string
  outcome?: 'idle' | 'success' | 'error'
  isEn?: boolean
}>()

const STORAGE_MINI_KEY = 'studio.chat.wishShrineMini'

function readInitialMini(): boolean {
  try {
    return localStorage.getItem(STORAGE_MINI_KEY) === '1'
  } catch {
    return false
  }
}

interface BurstParticle {
  uid: number
  symbol: string
  tx: number
  ty: number
  rot: number
}

const minimized = ref(readInitialMini())
const displayPhase = ref<WishShrinePhase>('idle')
const visible = ref(false)
/** 欧气总值（真实累计）与铭牌上滚动显示的值（逐帧追赶，像游戏金币跳字） */
const luckTotal = ref(0)
const displayedLuck = ref(0)
const karmaBump = ref(false)
/** 像伤害数字一样从头顶随机弹出的欧气飘字 */
const luckPopups = ref<WishLuckPopup[]>([])
const mouthTalking = ref(false)
const girlBounce = ref(false)
const activeChants = ref<WishFloatingChant[]>([])
const latestChantText = ref('')
const hoveringActor = ref(false)

/** 每个会话手动切换过的仙子记录 + 当前激活覆盖 */
const STORAGE_FAIRY_KEY = 'studio.chat.wishFairyPreferred'
function readInitialFairyOverride(): WishFairyId | null {
  try {
    const v = localStorage.getItem(STORAGE_FAIRY_KEY)
    if (v === 'miko' || v === 'astral' || v === 'neko' || v === 'muse') return v
  } catch {
    /* ignore */
  }
  return null
}

const sessionFairyOverrides = ref<Record<string, WishFairyId>>({})
const manualFairyId = ref<WishFairyId | null>(readInitialFairyOverride())

/** 当前全身舞台动作剧目（巡游 / 挥杖大魔法 / 律动热舞 / 窗边躲猫猫 / 360°星光回旋） */
const stageAct = ref<WishFairyStageAct>('roam')
const edgeSide = ref<'left' | 'right'>('left')
const activePose = ref<WishFairyPose>('pray')
const activeExpression = ref<WishFairyExpression>('normal')
const comboCount = ref(0)
const burstParticles = ref<BurstParticle[]>([])

/** 窗口内自由来回飘动坐标（px）与朝向 */
const overlayRef = ref<HTMLElement | null>(null)
const posX = ref(48)
const posY = ref(64)
const facingDir = ref<'right' | 'left'>('right')

let roamRafId: number | null = null
let roamLastTime = 0
let roamElapsed = Math.random() * Math.PI * 2
let lastX = 48

let chantTimer: number | null = null
let luckTimer: number | null = null
let poseCycleTimer: number | null = null
let karmaBumpTimer: number | null = null
let mouthTimer: number | null = null
let hideTimer: number | null = null
let critPhaseTimer: number | null = null
let bounceTimer: number | null = null
let expressionResetTimer: number | null = null
let comboResetTimer: number | null = null
let hoverLeaveTimer: number | null = null
let chantSeq = 0
let luckSeq = 0
let burstSeq = 0
let stepIndex = 0
let pokeStepIndex = 0

function onActorMouseEnter(): void {
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
  hoveringActor.value = true
}

function onActorMouseLeave(): void {
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer)
  }
  hoverLeaveTimer = window.setTimeout(() => {
    hoverLeaveTimer = null
    hoveringActor.value = false
  }, 150)
}

const promptCategory = computed<WishChantCategory>(() =>
  detectWishPromptCategory(props.promptText ?? '')
)

// 切换不同会话时：若该会话曾手动指定过仙子则恢复，否则清空手动覆盖以按新会话自动分配不同仙子
watch(
  () => props.sessionId,
  (newSid, oldSid) => {
    if (newSid === oldSid) return
    const sid = (newSid ?? '').trim()
    manualFairyId.value = sid ? (sessionFairyOverrides.value[sid] ?? null) : null
  }
)

/** 当前会话激活的祈福仙子（支持按会话自动匹配 + 手动切换） */
const currentFairy = computed<WishFairyPersona>(() => {
  const sid = (props.sessionId ?? '').trim()
  const preferredId =
    manualFairyId.value ?? (sid ? (sessionFairyOverrides.value[sid] ?? null) : null)
  return selectWishFairyForSession({
    sessionId: sid,
    sessionTitle: props.sessionTitle,
    promptText: props.promptText,
    preferredId
  })
})

/** 综合当前阶段、悬停与点击状态计算的最终表情 */
const effectiveExpression = computed<WishFairyExpression>(() => {
  if (displayPhase.value === 'error') return 'teary'
  if (displayPhase.value === 'success') return 'happy'
  if (displayPhase.value === 'crit') return 'star'
  if (activeExpression.value !== 'normal') return activeExpression.value
  if (hoveringActor.value) return 'wink'
  return 'normal'
})

/** 综合当前阶段、悬停与点击状态计算的最终动作姿态 */
const effectivePose = computed<WishFairyPose>(() => {
  if (displayPhase.value === 'success') return 'cheer'
  if (displayPhase.value === 'crit') return 'cast'
  if (activePose.value !== 'pray') return activePose.value
  if (hoveringActor.value) return 'wave'
  return 'pray'
})

const LANE_OFFSETS = [-18, 6, -8, 14, -12, 10] as const

function toggleMinimized(): void {
  minimized.value = !minimized.value
  try {
    localStorage.setItem(STORAGE_MINI_KEY, minimized.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/**
 * 启动窗口内平滑巡游动画：
 * - 普通巡游：Lissajous 8 字形轨迹自由飞行；
 * - 窗边躲猫猫（edge-peek）：飞到聊天窗口左/右边缘藏起半个身子探头偷看；
 * - 施法/跳舞：驻留舞台中央区域施展大法阵或热舞；
 * - 悬停在仙子或铭牌上时完全定格，确保点击「换人」「魔法」按钮稳如泰山。
 */
function startRoamingLoop(): void {
  stopRoamingLoop()
  roamLastTime = performance.now()
  roamElapsed = Math.random() * Math.PI * 2

  const step = (now: number): void => {
    if (!visible.value) return
    const dt = Math.min(0.08, Math.max(0, (now - roamLastTime) / 1000))
    roamLastTime = now

    const container = overlayRef.value
    const cw = container?.clientWidth || 380
    const ch = container?.clientHeight || 520

    const actorW = minimized.value ? 220 : 280
    const actorH = minimized.value ? 48 : 178
    const minX = 18
    const maxX = Math.max(minX + 20, cw - actorW - 18)
    const minY = minimized.value ? 40 : 58
    const maxY = Math.max(minY + 30, ch - actorH - 28)

    if (!hoveringActor.value) {
      roamElapsed += dt
      if (!minimized.value && stageAct.value === 'edge-peek') {
        // 躲在左/右窗口边缘探出半个身子偷看
        const targetX = edgeSide.value === 'left' ? -24 : Math.max(60, cw - 92)
        const normY = 0.42 + 0.22 * Math.sin(roamElapsed * 0.65)
        const targetY = minY + normY * (maxY - minY)
        posX.value += (targetX - posX.value) * 0.13
        posY.value += (targetY - posY.value) * 0.08
        facingDir.value = edgeSide.value === 'left' ? 'right' : 'left'
        lastX = posX.value
      } else {
        // 施法或跳舞时缩小巡游幅度，聚焦舞台中央展示全身大动作
        const ampScale = stageAct.value === 'cast' || stageAct.value === 'dance' ? 0.35 : 1
        const normX =
          0.5 + 0.45 * ampScale * Math.sin(roamElapsed * 0.55) * Math.cos(roamElapsed * 0.19)
        const normY = 0.45 + 0.4 * ampScale * Math.sin(roamElapsed * 0.37 + 1.1)

        const targetX = minX + normX * (maxX - minX)
        const targetY = minY + normY * (maxY - minY)

        posX.value += (targetX - posX.value) * 0.065
        posY.value += (targetY - posY.value) * 0.065

        const dx = posX.value - lastX
        if (Math.abs(dx) > 0.15) {
          facingDir.value = dx >= 0 ? 'right' : 'left'
        }
        lastX = posX.value
      }
    }

    // 铭牌欧气值逐帧追赶真实总值（金币滚动跳字）
    const gap = luckTotal.value - displayedLuck.value
    if (gap !== 0) {
      const stepVal = Math.sign(gap) * Math.max(1, Math.ceil(Math.abs(gap) * 0.14))
      displayedLuck.value =
        Math.abs(stepVal) >= Math.abs(gap) ? luckTotal.value : displayedLuck.value + stepVal
    }

    roamRafId = window.requestAnimationFrame(step)
  }

  roamRafId = window.requestAnimationFrame(step)
}

function stopRoamingLoop(): void {
  if (roamRafId !== null) {
    window.cancelAnimationFrame(roamRafId)
    roamRafId = null
  }
}

function clearTimers(): void {
  stopRoamingLoop()
  if (chantTimer !== null) {
    window.clearInterval(chantTimer)
    chantTimer = null
  }
  if (poseCycleTimer !== null) {
    window.clearInterval(poseCycleTimer)
    poseCycleTimer = null
  }
  stopLuckLoop()
  if (karmaBumpTimer !== null) {
    window.clearTimeout(karmaBumpTimer)
    karmaBumpTimer = null
  }
  if (mouthTimer !== null) {
    window.clearTimeout(mouthTimer)
    mouthTimer = null
  }
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  if (critPhaseTimer !== null) {
    window.clearTimeout(critPhaseTimer)
    critPhaseTimer = null
  }
  if (bounceTimer !== null) {
    window.clearTimeout(bounceTimer)
    bounceTimer = null
  }
  if (expressionResetTimer !== null) {
    window.clearTimeout(expressionResetTimer)
    expressionResetTimer = null
  }
  if (comboResetTimer !== null) {
    window.clearTimeout(comboResetTimer)
    comboResetTimer = null
  }
  if (hoverLeaveTimer !== null) {
    window.clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
}

function pushCustomChantBubble(
  text: string,
  tone: WishFloatingChant['tone'] = 'charm',
  critical = false
): void {
  const uid = ++chantSeq
  const laneOffsetY = LANE_OFFSETS[uid % LANE_OFFSETS.length] ?? 0
  const durationMs = critical ? 2800 : 3000
  const item: WishFloatingChant = {
    uid,
    id: `custom-${uid}`,
    text,
    tone,
    critical,
    laneOffsetY,
    durationMs
  }
  latestChantText.value = text
  activeChants.value = [...activeChants.value.slice(-4), item]

  mouthTalking.value = true
  if (mouthTimer !== null) window.clearTimeout(mouthTimer)
  mouthTimer = window.setTimeout(() => {
    mouthTalking.value = false
  }, 460)

  window.setTimeout(() => {
    activeChants.value = activeChants.value.filter((c) => c.uid !== uid)
  }, durationMs)
}

function spawnChant(critical = false): void {
  const picked = pickNextWishChant({
    category: promptCategory.value,
    stepIndex: stepIndex++,
    isEn: props.isEn,
    critical
  })
  pushCustomChantBubble(picked.text, picked.tone, picked.critical)
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** 点击时炸出一圈可爱的主题粒子（爱心、铃铛、星芒、猫爪、四叶草） */
function spawnBurstParticles(symbols: readonly string[]): void {
  const count = 6
  const created: BurstParticle[] = []
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + randBetween(-0.25, 0.25)
    const dist = randBetween(34, 62)
    created.push({
      uid: ++burstSeq,
      symbol: symbols[i % symbols.length] ?? '✦',
      tx: Math.round(Math.cos(angle) * dist),
      ty: Math.round(Math.sin(angle) * dist - 10),
      rot: Math.round(randBetween(-35, 35))
    })
  }
  burstParticles.value = [...burstParticles.value.slice(-12), ...created]
  const ids = new Set(created.map((c) => c.uid))
  window.setTimeout(() => {
    burstParticles.value = burstParticles.value.filter((p) => !ids.has(p.uid))
  }, 780)
}

/** 掷一次欧气并从头顶弹出伤害数字式飘字；返回本次档位 */
function spawnLuck(boost = false): WishLuckPopup['tier'] {
  const roll = rollLuckGain({ boost, combo: comboCount.value })
  const uid = ++luckSeq
  const durationMs = roll.tier === 'crit' ? 1700 : roll.tier === 'big' ? 1350 : 1100
  const popup: WishLuckPopup = {
    ...roll,
    uid,
    offsetX: Math.round(randBetween(-26, 26)),
    driftX: Math.round(randBetween(-34, 34)),
    tilt: Math.round(randBetween(-14, 14)),
    durationMs
  }
  luckPopups.value = [...luckPopups.value.slice(-7), popup]
  luckTotal.value += roll.value

  karmaBump.value = false
  if (karmaBumpTimer !== null) window.clearTimeout(karmaBumpTimer)
  window.requestAnimationFrame(() => {
    karmaBump.value = true
    karmaBumpTimer = window.setTimeout(() => {
      karmaBump.value = false
    }, 320)
  })

  window.setTimeout(() => {
    luckPopups.value = luckPopups.value.filter((p) => p.uid !== uid)
  }, durationMs)
  return roll.tier
}

/** 祈愿进行中：以随机间隔持续自动飘欧气 */
function scheduleLuckLoop(): void {
  stopLuckLoop()
  const tick = (): void => {
    if (!props.running || !visible.value) return
    spawnLuck(false)
    if (Math.random() < 0.22) {
      window.setTimeout(() => {
        if (props.running && visible.value) spawnLuck(false)
      }, 140)
    }
    luckTimer = window.setTimeout(tick, Math.round(randBetween(620, 1500)))
  }
  luckTimer = window.setTimeout(tick, 380)
}

function stopLuckLoop(): void {
  if (luckTimer !== null) {
    window.clearTimeout(luckTimer)
    luckTimer = null
  }
}

const AUTO_STAGE_ACTS: readonly WishFairyStageAct[] = [
  'cast',
  'roam',
  'dance',
  'edge-peek',
  'spin',
  'roam'
]

function performStageAct(act: WishFairyStageAct, emitChant = false): void {
  stageAct.value = act
  if (act === 'edge-peek') {
    const container = overlayRef.value
    const cw = container?.clientWidth || 380
    edgeSide.value = posX.value < cw * 0.5 ? 'left' : 'right'
  }
  const spec = getFairyStageActReaction({
    fairyId: currentFairy.value.id,
    act,
    isEn: props.isEn
  })
  activePose.value = spec.pose
  activeExpression.value = spec.expression
  if (act === 'cast' || act === 'dance' || act === 'spin') {
    spawnBurstParticles(spec.burstSymbols)
  }
  if (emitChant) {
    pushCustomChantBubble(spec.text, act === 'cast' ? 'gold' : 'charm', false)
  }
}

/** 祈愿进行中自动轮换仙子的全身舞台大动作（挥杖施法 / 律动热舞 / 窗边躲猫猫 / 360°回旋） */
function startIdlePoseCycle(): void {
  if (poseCycleTimer !== null) window.clearInterval(poseCycleTimer)
  let tickCount = 0
  poseCycleTimer = window.setInterval(() => {
    if (!props.running || !visible.value || comboCount.value > 0) return
    const nextAct = AUTO_STAGE_ACTS[tickCount % AUTO_STAGE_ACTS.length] ?? 'roam'
    tickCount++
    performStageAct(nextAct, nextAct === 'cast' || nextAct === 'edge-peek' || nextAct === 'dance')
  }, 3600)
}

function startPraying(): void {
  clearTimers()
  stepIndex = 0
  luckTotal.value = 0
  displayedLuck.value = 0
  comboCount.value = 0
  luckPopups.value = []
  activeChants.value = []
  burstParticles.value = []
  stageAct.value = 'cast'
  activePose.value = 'cast'
  activeExpression.value = 'star'
  displayPhase.value = 'praying'
  visible.value = true
  startRoamingLoop()
  startIdlePoseCycle()
  spawnBurstParticles(currentFairy.value.burstSymbols)
  spawnChant(false)
  scheduleLuckLoop()
  chantTimer = window.setInterval(() => {
    if (props.running) {
      spawnChant(false)
    }
  }, 1450)
}

function stopPrayingWithOutcome(outcome: 'idle' | 'success' | 'error'): void {
  if (chantTimer !== null) {
    window.clearInterval(chantTimer)
    chantTimer = null
  }
  if (poseCycleTimer !== null) {
    window.clearInterval(poseCycleTimer)
    poseCycleTimer = null
  }
  stopLuckLoop()
  if (!visible.value) return
  stageAct.value = 'roam'
  if (outcome === 'error') {
    displayPhase.value = 'error'
    activeExpression.value = 'teary'
    latestChantText.value = props.isEn
      ? '💦 Mana fluctuated... checking logs!'
      : '💦 呜哇…法力波动了！' // cjk-ok
  } else {
    displayPhase.value = 'success'
    activePose.value = 'dance'
    activeExpression.value = 'happy'
    spawnBurstParticles(currentFairy.value.burstSymbols)
    latestChantText.value = props.isEn ? '✌️ Wish Granted! All Green!' : '✌️ 许愿灵验！功德圆满！' // cjk-ok
  }
  hideTimer = window.setTimeout(() => {
    visible.value = false
    displayPhase.value = 'idle'
    activeChants.value = []
    stopRoamingLoop()
  }, 1600)
}

function applyTemporaryReaction(
  expression: WishFairyExpression,
  pose: WishFairyPose,
  ms = 1250
): void {
  activeExpression.value = expression
  activePose.value = pose
  if (expressionResetTimer !== null) window.clearTimeout(expressionResetTimer)
  expressionResetTimer = window.setTimeout(() => {
    const spec = getFairyStageActReaction({
      fairyId: currentFairy.value.id,
      act: stageAct.value,
      isEn: props.isEn
    })
    activeExpression.value = spec.expression
    activePose.value = spec.pose
  }, ms)
}

function extendPostRunVisibility(): void {
  if (!props.running && visible.value && hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      visible.value = false
      displayPhase.value = 'idle'
      activeChants.value = []
      stopRoamingLoop()
    }, 3800)
  }
}

function triggerGirlBounce(): void {
  girlBounce.value = false
  if (bounceTimer !== null) window.clearTimeout(bounceTimer)
  window.requestAnimationFrame(() => {
    girlBounce.value = true
    bounceTimer = window.setTimeout(() => {
      girlBounce.value = false
    }, 380)
  })
}

/** 用户点击祈福仙子或铭牌：若正在窗边躲猫猫则惊呼跃出，否则触发连击 Combo + 全身魔法/热舞动作 */
function onBlessClick(): void {
  if (!visible.value) return
  extendPostRunVisibility()
  comboCount.value += 1
  if (comboResetTimer !== null) window.clearTimeout(comboResetTimer)
  comboResetTimer = window.setTimeout(() => {
    comboCount.value = 0
  }, 2400)

  triggerGirlBounce()

  // 如果正在窗边躲猫猫时被抓包点击，惊呼一声并华丽旋转跳回舞台中央！
  if (stageAct.value === 'edge-peek') {
    stageAct.value = 'spin'
    spawnBurstParticles(currentFairy.value.burstSymbols)
    applyTemporaryReaction('surprised', 'spin', 1350)
    pushCustomChantBubble(
      props.isEn
        ? '😳 Eek! You caught me peeking! Here is a huge luck burst✨'
        : '😳 呀！躲在窗边被你抓到啦~ 送你一波超级大欧气✨', // cjk-ok
      'gold',
      false
    )
    spawnLuck(true)
    return
  }

  const reaction = pickFairyPokeReaction({
    fairyId: currentFairy.value.id,
    stepIndex: pokeStepIndex++,
    combo: comboCount.value,
    isEn: props.isEn
  })
  spawnBurstParticles(reaction.burstSymbols)
  applyTemporaryReaction(reaction.expression, reaction.pose, 1300)

  const tier = spawnLuck(true)
  if (props.running && tier === 'crit') {
    displayPhase.value = 'crit'
    spawnChant(true)
    if (critPhaseTimer !== null) window.clearTimeout(critPhaseTimer)
    critPhaseTimer = window.setTimeout(() => {
      if (props.running) displayPhase.value = 'praying'
    }, 1050)
  } else {
    pushCustomChantBubble(reaction.text, 'charm', false)
  }
}

/** 一键切换仙子全身舞台大动作（挥杖施法 → 律动热舞 → 窗边躲猫猫 → 360°回旋） */
function onCycleStageAct(): void {
  extendPostRunVisibility()
  const nextAct = nextFairyStageAct(stageAct.value)
  triggerGirlBounce()
  performStageAct(nextAct, true)
  spawnLuck(true)
}

/** 一键切换当前会话的祈福仙子，并触发华丽挥杖转圈登场动作 */
function onCycleFairy(): void {
  extendPostRunVisibility()
  const nextId = nextWishFairyId(currentFairy.value.id)
  manualFairyId.value = nextId
  const sid = (props.sessionId ?? '').trim()
  if (sid) {
    sessionFairyOverrides.value = {
      ...sessionFairyOverrides.value,
      [sid]: nextId
    }
  }
  try {
    localStorage.setItem(STORAGE_FAIRY_KEY, nextId)
  } catch {
    /* ignore */
  }
  triggerGirlBounce()
  const nextPersona = currentFairy.value
  spawnBurstParticles(nextPersona.burstSymbols)
  stageAct.value = 'cast'
  applyTemporaryReaction('star', 'cast', 1400)
  const greet = props.isEn
    ? `${nextPersona.titleEn} (${nextPersona.personalityEn}) reporting in!`
    : `${nextPersona.titleZh}（${nextPersona.personalityZh}）挥杖登场！` // cjk-ok
  pushCustomChantBubble(greet, 'gold', false)
  spawnLuck(true)
}

watch(
  () => props.running,
  (isRunning, wasRunning) => {
    if (isRunning) {
      startPraying()
    } else if (wasRunning) {
      stopPrayingWithOutcome(props.outcome ?? 'success')
    }
  },
  { immediate: true }
)

onMounted(() => {
  if (visible.value && roamRafId === null) {
    startRoamingLoop()
  }
})

onBeforeUnmount(() => {
  clearTimers()
})

const ribbonBadgeText = computed(() => {
  const f = currentFairy.value
  const name = props.isEn ? f.nameEn : f.nameZh
  if (displayPhase.value === 'success') {
    return props.isEn ? `✌️ ${name} · Granted!` : `✌️ ${name} · 灵验！` // cjk-ok
  }
  if (displayPhase.value === 'error') {
    return props.isEn ? `💦 ${name} · Oops` : `💦 ${name} · 波动` // cjk-ok
  }
  if (displayPhase.value === 'crit') {
    return props.isEn ? `🌟 ${name} · SSR Crit!` : `🌟 ${name} · 暴击！` // cjk-ok
  }
  return `${f.emoji} ${name}`
})

const pokeCalloutText = computed(() => {
  if (comboCount.value >= 2) {
    return props.isEn ? `🔥 Combo x${comboCount.value}!` : `🔥 连戳 x${comboCount.value}！` // cjk-ok
  }
  return props.isEn ? '👆 Poke me! +Luck ✨' : '👆 戳戳摸头 +欧气✨' // cjk-ok
})

const blessTooltip = computed(() => {
  const f = currentFairy.value
  return props.isEn
    ? `${f.titleEn} (${f.personalityEn}) — Click to pat & roll SSR luck!`
    : `${f.titleZh}（${f.personalityZh}）— 点击摸头互动攒欧气，连击提升暴击率！` // cjk-ok
})

const switchFairyTooltip = computed(
  () =>
    props.isEn
      ? 'Switch to another blessing fairy persona for this session'
      : '切换当前会话的祈福仙子（小祈 / 星奈 / 奈奈 / 露露）' // cjk-ok
)

const luckTotalText = computed(() => formatLuckTotal(displayedLuck.value, props.isEn))

function luckPopupLabel(popup: WishLuckPopup): string {
  return `+${popup.value.toLocaleString('en-US')}`
}

const critTag = computed(() => (props.isEn ? 'CRIT!' : '暴击!')) // cjk-ok
</script>

<template>
  <Transition name="wish-shrine-fade">
    <div
      v-if="visible"
      ref="overlayRef"
      class="wish-shrine-overlay"
      :class="[`phase-${displayPhase}`, `fairy-${currentFairy.id}`, { minimized }]"
      :style="{
        '--fairy-glow': currentFairy.theme.auraGlow,
        '--fairy-accent': currentFairy.theme.accentColor
      }"
      role="status"
      aria-live="polite"
    >
      <!-- 全窗口背景流星群：在对话窗口上空快速划过 -->
      <div v-if="!minimized" class="wish-window-meteors" aria-hidden="true">
        <span class="window-meteor wm1" />
        <span class="window-meteor wm2" />
        <span class="window-meteor wm3" />
        <span class="window-meteor wm4" />
        <span class="window-meteor wm5" />
      </div>

      <!-- 在窗口内自由来回飘动的祈愿仙子主体 -->
      <div
        class="wish-roaming-actor"
        :style="{
          transform: `translate3d(${Math.round(posX)}px, ${Math.round(posY)}px, 0)`
        }"
        @mouseenter="hoveringActor = true"
        @mouseleave="hoveringActor = false"
      >
        <!-- 游戏伤害数字式欧气飘字：随机数值、随机甩出方向，暴击金色放大 -->
        <div class="luck-popup-layer" :class="{ mini: minimized }" aria-hidden="true">
          <span
            v-for="popup in luckPopups"
            :key="popup.uid"
            class="luck-popup"
            :class="`tier-${popup.tier}`"
            :style="{
              '--pop-x': `${popup.offsetX}px`,
              '--pop-drift': `${popup.driftX}px`,
              '--pop-tilt': `${popup.tilt}deg`,
              '--pop-dur': `${popup.durationMs}ms`
            }"
          >
            <span v-if="popup.tier === 'crit'" class="luck-crit-tag">{{ critTag }}</span>
            <span class="luck-num">{{ luckPopupLabel(popup) }}</span>
          </span>
        </div>

        <!-- 折叠态：跟随后退飘动的迷你护身符胶囊 -->
        <div
          v-if="minimized"
          class="wish-shrine-mini-pill"
          @mouseenter="hoveringActor = true"
          @mouseleave="hoveringActor = false"
          @click="onBlessClick"
        >
          <span class="mini-pray-icon" aria-hidden="true">{{ currentFairy.emoji }}</span>
          <span class="mini-meteor-spark" aria-hidden="true">🌠</span>
          <span class="mini-chant-text">{{ latestChantText }}</span>
          <span class="mini-karma-badge" :class="{ bump: karmaBump }">
            {{ isEn ? `Luck ${luckTotalText}` : `欧气 ${luckTotalText}` /* cjk-ok */ }}
          </span>
          <button
            type="button"
            class="mini-expand-btn"
            :title="
              isEn
                ? 'Trigger Magic / Dance / Edge Peek'
                : '切换动作（施法/跳舞/躲猫猫）' /* cjk-ok */
            "
            @pointerdown.stop
            @click.stop="onCycleStageAct"
          >
            {{ isEn ? '🪄' : '🪄 动作' /* cjk-ok */ }}
          </button>
          <button
            type="button"
            class="mini-expand-btn"
            :title="isEn ? 'Switch Fairy' : '切换祈福仙子' /* cjk-ok */"
            @pointerdown.stop
            @click.stop="onCycleFairy"
          >
            {{ isEn ? '⇄' : '⇄ 换人' /* cjk-ok */ }}
          </button>
          <button
            type="button"
            class="mini-expand-btn"
            :title="isEn ? 'Expand Wish Fairy' : '展开祈福仙子' /* cjk-ok */"
            @pointerdown.stop
            @click.stop="toggleMinimized"
          >
            ▾
          </button>
        </div>

        <!-- 展开态：环绕流星光环的灵动 Q 版祈福仙子 + 口中飘出咒语气泡 -->
        <div v-else class="wish-sprite-scene">
          <!-- 环绕仙子身周的局部快速流星与星尘 -->
          <div class="sprite-local-sky" aria-hidden="true">
            <span class="wish-star s1">✦</span>
            <span class="wish-star s2">✧</span>
            <span class="wish-star s3">✦</span>
            <span class="wish-star s4">⋆</span>
            <span class="wish-meteor m1" />
            <span class="wish-meteor m2" />
            <span class="wish-meteor m3" />
            <span class="wish-meteor m4" />
          </div>

          <div class="sprite-main-row">
            <!-- Q 版全身动态祈福仙子本体 -->
            <div
              class="wish-anime-girl-wrap"
              :class="[
                `pose-${effectivePose}`,
                `expr-${effectiveExpression}`,
                `act-${stageAct}`,
                `edge-${edgeSide}`,
                {
                  bounce: girlBounce,
                  talking: mouthTalking,
                  'face-left': facingDir === 'left',
                  'is-hovered': hoveringActor,
                  'is-edge-peeking': stageAct === 'edge-peek',
                  'combo-fever': comboCount >= 3
                }
              ]"
              :title="blessTooltip"
              @mouseenter="hoveringActor = true"
              @mouseleave="hoveringActor = false"
              @click="onBlessClick"
            >
              <!-- 律动热舞舞台聚光灯与飘飞音符（dance 专属） -->
              <div
                v-if="effectivePose === 'dance' || stageAct === 'dance'"
                class="fairy-dance-stage-fx"
                aria-hidden="true"
              >
                <span class="dance-spotlight-cone" />
                <span class="dance-note n1">♪</span>
                <span class="dance-note n2">♫</span>
                <span class="dance-note n3">♬</span>
              </div>

              <!-- 挥杖大魔法全屏激光束与星轨光束（cast / crit 专属） -->
              <div
                v-if="effectivePose === 'cast' || displayPhase === 'crit'"
                class="fairy-spell-beam-fx"
                aria-hidden="true"
              >
                <span class="spell-beam b1" />
                <span class="spell-beam b2" />
                <span class="spell-beam b3" />
              </div>

              <!-- 悬停或连击时头顶跳出的诱人小气泡（「戳戳摸头 +欧气✨」/「连戳 xN」） -->
              <div
                v-if="hoveringActor || comboCount >= 2 || stageAct === 'edge-peek'"
                class="fairy-poke-callout"
                :class="{ combo: comboCount >= 2 }"
                aria-hidden="true"
              >
                {{
                  stageAct === 'edge-peek' && comboCount < 2
                    ? isEn
                      ? '🫣 Peeking! Click me✨'
                      : '🫣 躲猫猫中~ 戳我抓包✨' /* cjk-ok */
                    : pokeCalloutText
                }}
              </div>

              <!-- 点击爆发的主题粒子（爱心 / 铃铛 / 星芒 / 猫爪 / 四叶草） -->
              <div class="fairy-burst-layer" aria-hidden="true">
                <span
                  v-for="pt in burstParticles"
                  :key="pt.uid"
                  class="burst-particle"
                  :style="{
                    '--bx': `${pt.tx}px`,
                    '--by': `${pt.ty}px`,
                    '--brot': `${pt.rot}deg`
                  }"
                >
                  {{ pt.symbol }}
                </span>
              </div>

              <svg
                :key="currentFairy.id"
                class="wish-anime-girl-svg"
                viewBox="0 0 136 146"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient
                    id="wishHairGrad"
                    x1="20"
                    y1="10"
                    x2="100"
                    y2="118"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" :stop-color="currentFairy.theme.hairTop" />
                    <stop offset="50%" :stop-color="currentFairy.theme.hairMid" />
                    <stop offset="100%" :stop-color="currentFairy.theme.hairBottom" />
                  </linearGradient>
                  <linearGradient
                    id="wishHairShade"
                    x1="60"
                    y1="14"
                    x2="60"
                    y2="110"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" :stop-color="currentFairy.theme.hairShadeTop" />
                    <stop offset="100%" :stop-color="currentFairy.theme.hairShadeBottom" />
                  </linearGradient>
                  <linearGradient
                    id="wishSkinGrad"
                    x1="60"
                    y1="30"
                    x2="60"
                    y2="86"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stop-color="#FFF7F3" />
                    <stop offset="100%" stop-color="#FFE4DA" />
                  </linearGradient>
                  <linearGradient id="wishIrisGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" :stop-color="currentFairy.theme.irisTop" />
                    <stop offset="50%" :stop-color="currentFairy.theme.irisMid" />
                    <stop offset="85%" :stop-color="currentFairy.theme.irisBottom" />
                    <stop offset="100%" :stop-color="currentFairy.theme.irisHighlight" />
                  </linearGradient>
                  <linearGradient
                    id="wishOutfitGrad"
                    x1="60"
                    y1="88"
                    x2="60"
                    y2="124"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" :stop-color="currentFairy.theme.outfitTop" />
                    <stop offset="100%" :stop-color="currentFairy.theme.outfitBottom" />
                  </linearGradient>
                  <linearGradient id="wishRibbonGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" :stop-color="currentFairy.theme.ribbonStart" />
                    <stop offset="100%" :stop-color="currentFairy.theme.ribbonEnd" />
                  </linearGradient>
                  <radialGradient id="wishOrbGrad" cx="50%" cy="50%" r="50%">
                    <stop
                      offset="0%"
                      :stop-color="currentFairy.theme.accentColor"
                      stop-opacity="0.95"
                    />
                    <stop
                      offset="55%"
                      :stop-color="currentFairy.theme.hairMid"
                      stop-opacity="0.5"
                    />
                    <stop
                      offset="100%"
                      :stop-color="currentFairy.theme.hairBottom"
                      stop-opacity="0"
                    />
                  </radialGradient>
                  <radialGradient id="wishCloudGrad" cx="50%" cy="50%" r="50%">
                    <stop
                      offset="0%"
                      :stop-color="currentFairy.theme.wingColor"
                      stop-opacity="0.65"
                    />
                    <stop
                      offset="65%"
                      :stop-color="currentFairy.theme.hairMid"
                      stop-opacity="0.24"
                    />
                    <stop offset="100%" stop-color="#312E81" stop-opacity="0" />
                  </radialGradient>
                </defs>

                <!-- 脚下托举的星云浮空光阵 + 施法/跳舞时的展开式多层魔法阵 -->
                <g class="girl-foot-circle-group">
                  <ellipse
                    cx="60"
                    cy="134"
                    rx="38"
                    ry="6.5"
                    fill="url(#wishCloudGrad)"
                    class="girl-cloud-base"
                  />
                  <ellipse
                    cx="60"
                    cy="134"
                    rx="32"
                    ry="5"
                    fill="none"
                    :stroke="currentFairy.theme.accentColor"
                    stroke-width="1.2"
                    stroke-dasharray="4 3"
                    class="girl-foot-rune-ring"
                  />
                </g>

                <!-- 脑后旋转祈愿星阵光环 + 施法时暴涨的六芒星大结界 -->
                <g class="girl-halo">
                  <circle
                    cx="60"
                    cy="58"
                    r="47"
                    :stroke="currentFairy.theme.accentColor"
                    stroke-opacity="0.58"
                    stroke-width="1.5"
                    stroke-dasharray="4 5 10 5"
                  />
                  <circle
                    cx="60"
                    cy="58"
                    r="40"
                    :stroke="currentFairy.theme.wingColor"
                    stroke-opacity="0.45"
                    stroke-width="1.1"
                  />
                  <!-- 施展大魔法或暴击时显现的巨型六芒星法阵几何 -->
                  <g
                    v-if="
                      effectivePose === 'cast' ||
                      effectivePose === 'dance' ||
                      displayPhase === 'crit'
                    "
                    class="girl-grand-hexagram"
                  >
                    <polygon
                      points="60,12 99,80 21,80"
                      fill="none"
                      :stroke="currentFairy.theme.accentColor"
                      stroke-opacity="0.55"
                      stroke-width="1.2"
                    />
                    <polygon
                      points="60,104 99,36 21,36"
                      fill="none"
                      :stroke="currentFairy.theme.wingColor"
                      stroke-opacity="0.55"
                      stroke-width="1.2"
                    />
                  </g>
                </g>

                <!-- 魔杖挥舞时划出的炫酷 S 形霓虹流光飘带轨迹 -->
                <path
                  v-if="
                    effectivePose === 'cast' ||
                    effectivePose === 'dance' ||
                    effectivePose === 'spin' ||
                    effectivePose === 'wand'
                  "
                  class="girl-wand-ribbon-trail"
                  d="M20 116C34 134 78 130 98 94C114 66 122 34 104 18"
                  fill="none"
                  stroke="url(#wishRibbonGrad)"
                  stroke-width="3.2"
                  stroke-linecap="round"
                  stroke-dasharray="10 6"
                />

                <!-- 背后扑扇的半透明精灵蝶翼（悬停/连击时加速扇动） -->
                <g class="girl-wings">
                  <g class="wing-left">
                    <path
                      d="M42 84C22 68 8 72 11 88C13 98 26 101 40 93Z"
                      :fill="currentFairy.theme.wingColor"
                      fill-opacity="0.46"
                      stroke="#FFFFFF"
                      stroke-opacity="0.75"
                      stroke-width="1.1"
                    />
                    <path
                      d="M41 94C25 95 16 104 21 113C26 120 36 114 43 101Z"
                      :fill="currentFairy.theme.accentColor"
                      fill-opacity="0.38"
                      stroke="#FFFFFF"
                      stroke-opacity="0.65"
                      stroke-width="0.9"
                    />
                  </g>
                  <g class="wing-right">
                    <path
                      d="M78 84C98 68 112 72 109 88C107 98 94 101 80 93Z"
                      :fill="currentFairy.theme.wingColor"
                      fill-opacity="0.46"
                      stroke="#FFFFFF"
                      stroke-opacity="0.75"
                      stroke-width="1.1"
                    />
                    <path
                      d="M79 94C95 95 104 104 99 113C94 120 84 114 77 101Z"
                      :fill="currentFairy.theme.accentColor"
                      fill-opacity="0.38"
                      stroke="#FFFFFF"
                      stroke-opacity="0.65"
                      stroke-width="0.9"
                    />
                  </g>
                </g>

                <!-- 赛博猫娘专属：开心摇摆的霓虹小猫尾 -->
                <path
                  v-if="currentFairy.id === 'neko'"
                  class="girl-neko-tail"
                  d="M76 114C92 116 104 105 102 95C100 88 93 90 95 97C96 102 89 109 77 109"
                  fill="none"
                  :stroke="currentFairy.theme.hairMid"
                  stroke-width="4.5"
                  stroke-linecap="round"
                />

                <!-- ── 四位仙子专属后发与发型轮廓 ── -->
                <!-- 1. 小祈 (miko)：樱粉长双马尾随风摆动 -->
                <g v-if="currentFairy.id === 'miko'">
                  <path
                    class="girl-twintail-left"
                    d="M30 34C13 38 7 57 11 77C14 92 9 106 3 115C17 113 26 99 26 84C26 70 24 55 34 45Z"
                    fill="url(#wishHairShade)"
                  />
                  <path
                    class="girl-twintail-right"
                    d="M90 34C107 38 113 57 109 77C106 92 111 106 117 115C103 113 94 99 94 84C94 70 96 55 86 45Z"
                    fill="url(#wishHairShade)"
                  />
                </g>

                <!-- 2. 星奈 (astral)：星夜大波浪披肩银河长发（内嵌闪烁星辰） -->
                <g v-else-if="currentFairy.id === 'astral'">
                  <path
                    class="girl-twintail-left"
                    d="M28 40C14 54 10 82 14 114C24 118 36 112 42 100L78 100C84 112 96 118 106 114C110 82 106 54 92 40Z"
                    fill="url(#wishHairShade)"
                  />
                  <circle cx="24" cy="96" r="1.8" fill="#FDE047" class="pray-sparkle" />
                  <circle cx="96" cy="92" r="2" fill="#FDE047" class="pray-sparkle sp-left" />
                  <circle cx="29" cy="108" r="1.3" fill="#A5B4FC" />
                </g>

                <!-- 3. 奈奈 (neko)：俏皮高扎赛博双丸子头 + 短翘发束 -->
                <g v-else-if="currentFairy.id === 'neko'">
                  <circle
                    cx="26"
                    cy="30"
                    r="10.5"
                    fill="url(#wishHairShade)"
                    stroke="#2DD4BF"
                    stroke-width="1.2"
                  />
                  <circle
                    cx="94"
                    cy="30"
                    r="10.5"
                    fill="url(#wishHairShade)"
                    stroke="#2DD4BF"
                    stroke-width="1.2"
                  />
                  <path
                    class="girl-twintail-left"
                    d="M22 36C12 44 10 58 16 68C22 63 25 54 27 42Z"
                    fill="url(#wishHairGrad)"
                  />
                  <path
                    class="girl-twintail-right"
                    d="M98 36C108 44 110 58 104 68C98 63 95 54 93 42Z"
                    fill="url(#wishHairGrad)"
                  />
                </g>

                <!-- 4. 露露 (muse)：蜜桃金蓬松精灵云朵卷发 -->
                <g v-else>
                  <circle cx="24" cy="64" r="12" fill="url(#wishHairShade)" />
                  <circle cx="96" cy="64" r="12" fill="url(#wishHairShade)" />
                  <circle cx="26" cy="82" r="10" fill="url(#wishHairGrad)" />
                  <circle cx="94" cy="82" r="10" fill="url(#wishHairGrad)" />
                </g>

                <!-- 基础后发底衬 -->
                <path
                  d="M60 14C34 14 22 34 23 58C24 78 22 92 17 100C29 100 36 94 40 86L80 86C84 94 91 100 103 100C98 92 96 78 97 58C98 34 86 14 60 14Z"
                  fill="url(#wishHairShade)"
                />

                <!-- Q 版悬空小短腿（开心前后晃脚丫） -->
                <g class="girl-legs">
                  <g class="girl-leg-left">
                    <path
                      d="M51 116L49 128"
                      stroke="#FFE4DA"
                      stroke-width="5.2"
                      stroke-linecap="round"
                    />
                    <path
                      d="M50 122L49 129"
                      stroke="#FFFFFF"
                      stroke-width="5.4"
                      stroke-linecap="round"
                    />
                    <ellipse cx="48.5" cy="130" rx="4.2" ry="2.6" fill="url(#wishRibbonGrad)" />
                  </g>
                  <g class="girl-leg-right">
                    <path
                      d="M69 116L71 128"
                      stroke="#FFE4DA"
                      stroke-width="5.2"
                      stroke-linecap="round"
                    />
                    <path
                      d="M70 122L71 129"
                      stroke="#FFFFFF"
                      stroke-width="5.4"
                      stroke-linecap="round"
                    />
                    <ellipse cx="71.5" cy="130" rx="4.2" ry="2.6" fill="url(#wishRibbonGrad)" />
                  </g>
                </g>

                <!-- ── 四位仙子专属服饰造型 ── -->
                <!-- 1. 小祈 (miko)：红白巫女羽织宽袖 + 绯红百褶袴裙 -->
                <g v-if="currentFairy.id === 'miko'">
                  <path d="M37 119L44 92L76 92L83 119Z" fill="#E11D48" />
                  <path d="M44 87L60 103L76 87L78 102L42 102Z" fill="#FFF1F2" />
                  <path
                    d="M39 93C27 99 23 111 26 120L44 117C42 108 44 100 48 95Z"
                    fill="#FFFFFF"
                    stroke="#F43F5E"
                    stroke-width="1.2"
                  />
                  <path
                    d="M81 93C93 99 97 111 94 120L76 117C78 108 76 100 72 95Z"
                    fill="#FFFFFF"
                    stroke="#F43F5E"
                    stroke-width="1.2"
                  />
                  <path
                    d="M50 88L60 99L70 88"
                    stroke="#E11D48"
                    stroke-width="2.6"
                    stroke-linecap="round"
                  />
                </g>

                <!-- 2. 星奈 (astral)：星穹魔女深蓝披肩斗篷 + 金星礼裙 -->
                <g v-else-if="currentFairy.id === 'astral'">
                  <path
                    d="M35 119C36 96 45 87 60 87C75 87 84 96 85 119Z"
                    fill="url(#wishOutfitGrad)"
                  />
                  <path
                    d="M32 108C34 93 45 87 60 87C75 87 86 93 88 108Q74 103 60 107Q46 103 32 108Z"
                    fill="#1E1B4B"
                    stroke="#FDE047"
                    stroke-width="1.1"
                  />
                  <polygon
                    points="60,89 62,93 66,93 63,96 64,100 60,97 56,100 57,96 54,93 58,93"
                    fill="#FDE047"
                  />
                </g>

                <!-- 3. 奈奈 (neko)：赛博机能风霓虹卫衣 + 发光猫爪徽章 -->
                <g v-else-if="currentFairy.id === 'neko'">
                  <path
                    d="M38 118C38 96 46 87 60 87C74 87 82 96 82 118Z"
                    fill="#0F172A"
                    stroke="#2DD4BF"
                    stroke-width="1.3"
                  />
                  <path
                    d="M39 95C29 101 26 111 29 118L44 117C43 108 45 101 49 96Z"
                    fill="#1E293B"
                    stroke="#2DD4BF"
                    stroke-width="1.1"
                  />
                  <path
                    d="M81 95C91 101 94 111 91 118L76 117C77 108 75 101 71 96Z"
                    fill="#1E293B"
                    stroke="#2DD4BF"
                    stroke-width="1.1"
                  />
                  <path d="M38 113L82 113" stroke="#F472B6" stroke-width="2.5" />
                  <circle cx="60" cy="96" r="3.5" fill="#2DD4BF" />
                </g>

                <!-- 4. 露露 (muse)：森系翡翠花瓣蓬蓬裙 -->
                <g v-else>
                  <path
                    d="M34 118C36 96 46 87 60 87C74 87 84 96 86 118Q73 123 60 116Q47 123 34 118Z"
                    fill="url(#wishOutfitGrad)"
                    stroke="#34D399"
                    stroke-width="1.1"
                  />
                  <path
                    d="M37 112Q60 118 83 112L85 118Q60 123 35 118Z"
                    fill="url(#wishRibbonGrad)"
                  />
                </g>

                <!-- 头部整体（支持歪头杀 Head-Tilt 动画） -->
                <g class="girl-head-group">
                  <!-- 脸庞 -->
                  <path
                    d="M35 56C35 38 46 30 60 30C74 30 85 38 85 56C85 70 76 82 60 85C44 82 35 70 35 56Z"
                    fill="url(#wishSkinGrad)"
                  />

                  <!-- 脸颊红晕 + 害羞斜线 -->
                  <ellipse
                    class="girl-blush"
                    cx="41.5"
                    cy="70.5"
                    rx="6"
                    ry="3.1"
                    fill="#FB7185"
                    fill-opacity="0.55"
                  />
                  <ellipse
                    class="girl-blush"
                    cx="78.5"
                    cy="70.5"
                    rx="6"
                    ry="3.1"
                    fill="#FB7185"
                    fill-opacity="0.55"
                  />
                  <path
                    d="M38.5 72L40.1 69M41.5 72L43.1 69M44.5 72L46.1 69M74.5 72L76.1 69M77.5 72L79.1 69M80.5 72L82.1 69"
                    stroke="#F43F5E"
                    stroke-opacity="0.65"
                    stroke-width="0.9"
                    stroke-linecap="round"
                  />

                  <!-- ── 多样化表情眼睛（8 种生动眼神） ── -->
                  <!-- 1. normal: 水汪汪卡姿兰大眼 -->
                  <g v-if="effectiveExpression === 'normal'" class="girl-eyes-open">
                    <g class="girl-eye">
                      <ellipse cx="47" cy="61" rx="7" ry="8.2" fill="#FFFFFF" />
                      <ellipse cx="47" cy="61.6" rx="6" ry="7.5" fill="url(#wishIrisGrad)" />
                      <ellipse cx="47" cy="62.6" rx="2.7" ry="3.5" fill="#1E1B4B" />
                      <ellipse
                        cx="47"
                        cy="66"
                        rx="3.8"
                        ry="1.8"
                        :fill="currentFairy.theme.irisHighlight"
                        fill-opacity="0.8"
                      />
                      <ellipse cx="44.4" cy="57.8" rx="2.5" ry="3" fill="#FFFFFF" />
                      <circle cx="49.8" cy="65.2" r="1.3" fill="#FFFFFF" />
                      <path
                        d="M39 56C42 51 52 51 55.5 55.5"
                        stroke="#3B0764"
                        stroke-width="2.6"
                        stroke-linecap="round"
                      />
                      <path
                        d="M39.4 56L36.6 53.8"
                        stroke="#3B0764"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                    </g>
                    <g class="girl-eye">
                      <ellipse cx="73" cy="61" rx="7" ry="8.2" fill="#FFFFFF" />
                      <ellipse cx="73" cy="61.6" rx="6" ry="7.5" fill="url(#wishIrisGrad)" />
                      <ellipse cx="73" cy="62.6" rx="2.7" ry="3.5" fill="#1E1B4B" />
                      <ellipse
                        cx="73"
                        cy="66"
                        rx="3.8"
                        ry="1.8"
                        :fill="currentFairy.theme.irisHighlight"
                        fill-opacity="0.8"
                      />
                      <ellipse cx="70.4" cy="57.8" rx="2.5" ry="3" fill="#FFFFFF" />
                      <circle cx="75.8" cy="65.2" r="1.3" fill="#FFFFFF" />
                      <path
                        d="M64.5 55.5C68 51 78 51 81 56"
                        stroke="#3B0764"
                        stroke-width="2.6"
                        stroke-linecap="round"
                      />
                      <path
                        d="M80.6 56L83.4 53.8"
                        stroke="#3B0764"
                        stroke-width="1.8"
                        stroke-linecap="round"
                      />
                    </g>
                  </g>

                  <!-- 2. wink: 俏皮单眼 Wink (^_~) -->
                  <g v-else-if="effectiveExpression === 'wink'" class="girl-eyes-wink">
                    <path
                      d="M39.5 61.5C42.5 55.5 51.5 55.5 54.5 61.5"
                      stroke="#3B0764"
                      stroke-width="2.8"
                      stroke-linecap="round"
                    />
                    <path
                      d="M39.5 60.5L36.8 58.2"
                      stroke="#3B0764"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                    <g>
                      <ellipse cx="73" cy="61" rx="7" ry="8.2" fill="#FFFFFF" />
                      <ellipse cx="73" cy="61.6" rx="6" ry="7.5" fill="url(#wishIrisGrad)" />
                      <ellipse cx="73" cy="62.6" rx="2.7" ry="3.5" fill="#1E1B4B" />
                      <ellipse cx="70.4" cy="57.8" rx="2.5" ry="3" fill="#FFFFFF" />
                      <circle cx="75.8" cy="65.2" r="1.3" fill="#FFFFFF" />
                      <path
                        d="M64.5 55.5C68 51 78 51 81 56"
                        stroke="#3B0764"
                        stroke-width="2.6"
                        stroke-linecap="round"
                      />
                    </g>
                  </g>

                  <!-- 3. star: 金光闪闪星星眼 (★_★) -->
                  <g v-else-if="effectiveExpression === 'star'" class="girl-eyes-star">
                    <ellipse cx="47" cy="61.6" rx="6.5" ry="7.8" fill="url(#wishIrisGrad)" />
                    <ellipse cx="73" cy="61.6" rx="6.5" ry="7.8" fill="url(#wishIrisGrad)" />
                    <path
                      d="M47 55L48.8 59.6L53.5 61.6L48.8 63.6L47 68.2L45.2 63.6L40.5 61.6L45.2 59.6Z"
                      fill="#FDE047"
                    />
                    <path
                      d="M73 55L74.8 59.6L79.5 61.6L74.8 63.6L73 68.2L71.2 63.6L66.5 61.6L71.2 59.6Z"
                      fill="#FDE047"
                    />
                    <circle cx="44" cy="57.5" r="1.6" fill="#FFFFFF" />
                    <circle cx="70" cy="57.5" r="1.6" fill="#FFFFFF" />
                    <path
                      d="M39 55.5C42 50.5 52 50.5 55.5 55"
                      stroke="#3B0764"
                      stroke-width="2.6"
                      stroke-linecap="round"
                    />
                    <path
                      d="M64.5 55C68 50.5 78 50.5 81 55.5"
                      stroke="#3B0764"
                      stroke-width="2.6"
                      stroke-linecap="round"
                    />
                  </g>

                  <!-- 4. heart: 粉红心动爱心眼 (♥_♥) -->
                  <g v-else-if="effectiveExpression === 'heart'" class="girl-eyes-star">
                    <ellipse cx="47" cy="61.6" rx="6.5" ry="7.8" fill="url(#wishIrisGrad)" />
                    <ellipse cx="73" cy="61.6" rx="6.5" ry="7.8" fill="url(#wishIrisGrad)" />
                    <path
                      d="M47 66.2C43 63.2 41.5 59.5 43.8 57.6C45.2 56.5 46.6 57.5 47 58.6C47.4 57.5 48.8 56.5 50.2 57.6C52.5 59.5 51 63.2 47 66.2Z"
                      fill="#FF6FA8"
                    />
                    <path
                      d="M73 66.2C69 63.2 67.5 59.5 69.8 57.6C71.2 56.5 72.6 57.5 73 58.6C73.4 57.5 74.8 56.5 76.2 57.6C78.5 59.5 77 63.2 73 66.2Z"
                      fill="#FF6FA8"
                    />
                    <circle cx="44" cy="57.5" r="1.5" fill="#FFFFFF" />
                    <circle cx="70" cy="57.5" r="1.5" fill="#FFFFFF" />
                    <path
                      d="M39 55.5C42 50.5 52 50.5 55.5 55"
                      stroke="#3B0764"
                      stroke-width="2.6"
                      stroke-linecap="round"
                    />
                    <path
                      d="M64.5 55C68 50.5 78 50.5 81 55.5"
                      stroke="#3B0764"
                      stroke-width="2.6"
                      stroke-linecap="round"
                    />
                  </g>

                  <!-- 5. surprised: 被戳中时的呆萌吃惊圆眼 (⊙o⊙) -->
                  <g v-else-if="effectiveExpression === 'surprised'">
                    <circle
                      cx="47"
                      cy="61"
                      r="6.6"
                      fill="#FFFFFF"
                      stroke="#3B0764"
                      stroke-width="2.2"
                    />
                    <circle cx="47" cy="61" r="3.2" fill="url(#wishIrisGrad)" />
                    <circle cx="45.6" cy="59.4" r="1.4" fill="#FFFFFF" />
                    <circle
                      cx="73"
                      cy="61"
                      r="6.6"
                      fill="#FFFFFF"
                      stroke="#3B0764"
                      stroke-width="2.2"
                    />
                    <circle cx="73" cy="61" r="3.2" fill="url(#wishIrisGrad)" />
                    <circle cx="71.6" cy="59.4" r="1.4" fill="#FFFFFF" />
                  </g>

                  <!-- 6. smug: 得意坏笑猫猫眼 (￣︶￣) -->
                  <g v-else-if="effectiveExpression === 'smug'">
                    <path
                      d="M39.5 59.5Q47 64.5 54.5 59.5"
                      stroke="#3B0764"
                      stroke-width="2.7"
                      stroke-linecap="round"
                    />
                    <path
                      d="M65.5 59.5Q73 64.5 80.5 59.5"
                      stroke="#3B0764"
                      stroke-width="2.7"
                      stroke-linecap="round"
                    />
                    <path
                      d="M39 54.5L53 56.5M81 54.5L67 56.5"
                      stroke="#3B0764"
                      stroke-width="1.6"
                      stroke-linecap="round"
                    />
                  </g>

                  <!-- 7. happy: 弯弯月牙笑眼 (^▽^) -->
                  <g v-else-if="effectiveExpression === 'happy'" class="girl-eyes-happy">
                    <path
                      d="M40 63C43 55.5 51 55.5 54 63"
                      stroke="#3B0764"
                      stroke-width="2.8"
                      stroke-linecap="round"
                    />
                    <path
                      d="M66 63C69 55.5 77 55.5 80 63"
                      stroke="#3B0764"
                      stroke-width="2.8"
                      stroke-linecap="round"
                    />
                  </g>

                  <!-- 8. teary: 委屈 >_< -->
                  <g v-else class="girl-eyes-error">
                    <path
                      d="M41 56L50 61L41 66"
                      stroke="#4C1D95"
                      stroke-width="2.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M79 56L70 61L79 66"
                      stroke="#4C1D95"
                      stroke-width="2.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M84 52C84 52 87 57 87 59.5C87 61.2 85.6 62.5 84 62.5C82.4 62.5 81 61.2 81 59.5C81 57 84 52 84 52Z"
                      fill="#38BDF8"
                    />
                  </g>

                  <!-- ── 多样化嘴巴（念咒 / 吐舌头 / 虎牙大笑 / 惊讶小圆嘴 / ω 猫猫嘴） ── -->
                  <g class="girl-mouth-group">
                    <g v-if="mouthTalking || effectiveExpression === 'star'">
                      <path
                        d="M55.8 72.8Q60 71.5 64.2 72.8Q63.8 79 60 79Q56.2 79 55.8 72.8Z"
                        fill="#E11D48"
                      />
                      <ellipse cx="60" cy="77.2" rx="2.4" ry="1.4" fill="#FDA4AF" />
                      <!-- 小虎牙 -->
                      <path d="M61.8 72.8L62.6 74.8L63.4 72.9Z" fill="#FFFFFF" />
                    </g>
                    <g v-else-if="effectiveExpression === 'wink'">
                      <path
                        d="M56 73Q60 75 64 73"
                        stroke="#BE185D"
                        stroke-width="1.7"
                        stroke-linecap="round"
                      />
                      <!-- 俏皮吐小舌头 -->
                      <path
                        d="M58.2 74C58.2 78.2 62.2 78.2 62.2 74Z"
                        fill="#FB7185"
                        stroke="#BE185D"
                        stroke-width="0.9"
                      />
                    </g>
                    <circle
                      v-else-if="effectiveExpression === 'surprised'"
                      cx="60"
                      cy="75"
                      r="2.8"
                      fill="#E11D48"
                    />
                    <path
                      v-else-if="effectiveExpression === 'happy' || effectiveExpression === 'heart'"
                      d="M54.5 72.5Q60 80.5 65.5 72.5Z"
                      fill="#E11D48"
                    />
                    <path
                      v-else
                      d="M55 73Q57.5 76.2 60 73Q62.5 76.2 65 73"
                      stroke="#BE185D"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <!-- 念咒时嘴角冒出的小音符 -->
                    <path
                      v-if="mouthTalking || displayPhase === 'crit'"
                      class="mouth-aura-ring"
                      d="M69 77.5V71.5L72.5 70.5V76M69 77.5A1.4 1.1 0 1 1 66.2 77.5A1.4 1.1 0 1 1 69 77.5ZM72.5 76A1.4 1.1 0 1 1 69.7 76A1.4 1.1 0 1 1 72.5 76Z"
                      fill="#FDE047"
                      stroke="#FDE047"
                      stroke-width="0.9"
                      stroke-linejoin="round"
                    />
                  </g>

                  <!-- 两侧鬓发 + 齐刘海 -->
                  <path
                    d="M36 40C29 54 30 72 35 89C36.5 80 37.5 70 38.5 60C39 52 38 46 36 40Z"
                    fill="url(#wishHairGrad)"
                  />
                  <path
                    d="M84 40C91 54 90 72 85 89C83.5 80 82.5 70 81.5 60C81 52 82 46 84 40Z"
                    fill="url(#wishHairGrad)"
                  />
                  <path
                    d="M34 50C33 30 45 18 60 18C75 18 87 30 86 50C83 44 80 41 77 40L78 51C74 44 70 40 66 38L64.5 49C61 42 58 39 55 38L52.5 50C50 43 47 40 44 40L42 51C40 46 37 46 34 50Z"
                    fill="url(#wishHairGrad)"
                  />
                  <!-- 发丝天使光环高光 -->
                  <path
                    d="M43 26C50 21.5 70 21.5 77 26"
                    stroke="#FFFFFF"
                    stroke-opacity="0.6"
                    stroke-width="2.4"
                    stroke-linecap="round"
                  />

                  <!-- 头顶随风摇晃的呆毛 (Ahoge) -->
                  <path
                    class="girl-ahoge"
                    d="M60 18C56 7 64 1 72 5C66 6 62 11 62.5 18Z"
                    :fill="currentFairy.theme.hairTop"
                  />

                  <!-- ── 四位仙子专属头饰 ── -->
                  <!-- 1. 小祈 (miko)：灵动抖动的粉色狐耳 + 绯红巫女蝴蝶结 -->
                  <g v-if="currentFairy.id === 'miko'" class="fairy-ears">
                    <path
                      class="ear-left"
                      d="M35 27L24 9L45 19Z"
                      :fill="currentFairy.theme.hairTop"
                      stroke="#E11D48"
                      stroke-width="1"
                    />
                    <path d="M34 24L28 13L41 20Z" fill="#FFE4E6" />
                    <path
                      class="ear-right"
                      d="M85 27L96 9L75 19Z"
                      :fill="currentFairy.theme.hairTop"
                      stroke="#E11D48"
                      stroke-width="1"
                    />
                    <path d="M86 24L92 13L79 20Z" fill="#FFE4E6" />
                  </g>

                  <!-- 2. 星奈 (astral)：星月小魔女尖顶帽 + 垂挂金星 -->
                  <g v-else-if="currentFairy.id === 'astral'" class="fairy-witch-hat">
                    <ellipse
                      cx="60"
                      cy="22"
                      rx="31"
                      ry="6.5"
                      fill="#312E81"
                      stroke="#FDE047"
                      stroke-width="1.1"
                    />
                    <path
                      d="M39 21C44 9 58 2 79 4C71 9 69 14 78 21Z"
                      fill="#4338CA"
                      stroke="#A5B4FC"
                      stroke-width="1"
                    />
                    <circle cx="81" cy="6" r="3" fill="#FDE047" class="girl-hairpin" />
                  </g>

                  <!-- 3. 奈奈 (neko)：霓虹发光赛博猫耳耳机 -->
                  <g v-else-if="currentFairy.id === 'neko'" class="fairy-ears">
                    <path
                      class="ear-left"
                      d="M33 28L23 10L45 20Z"
                      fill="#1E293B"
                      stroke="#2DD4BF"
                      stroke-width="1.5"
                    />
                    <path d="M33 25L27 14L41 20Z" fill="#5EEAD4" />
                    <path
                      class="ear-right"
                      d="M87 28L97 10L75 20Z"
                      fill="#1E293B"
                      stroke="#2DD4BF"
                      stroke-width="1.5"
                    />
                    <path d="M87 25L93 14L79 20Z" fill="#5EEAD4" />
                  </g>

                  <!-- 4. 露露 (muse)：悬浮发光小天使光圈 + 四叶草发饰 -->
                  <g v-else class="fairy-angel-crown">
                    <ellipse
                      cx="60"
                      cy="9"
                      rx="16"
                      ry="3.8"
                      fill="none"
                      stroke="#FDE047"
                      stroke-width="2.4"
                    />
                    <circle cx="38" cy="24" r="3.5" fill="#34D399" />
                    <circle cx="43" cy="24" r="3.5" fill="#34D399" />
                    <circle cx="40.5" cy="20" r="3.5" fill="#10B981" />
                  </g>

                  <!-- 双马尾蝴蝶结 -->
                  <g class="girl-bow-left">
                    <path d="M28 35L17 28C13.5 32 13.5 39 17 42Z" fill="url(#wishRibbonGrad)" />
                    <path d="M28 35L37 27C40.5 31 40.5 38 37 41Z" fill="url(#wishRibbonGrad)" />
                    <circle cx="28" cy="35" r="2.8" fill="#FDE047" />
                  </g>
                  <g class="girl-bow-right">
                    <path d="M92 35L103 28C106.5 32 106.5 39 103 42Z" fill="url(#wishRibbonGrad)" />
                    <path d="M92 35L83 27C79.5 31 79.5 38 83 41Z" fill="url(#wishRibbonGrad)" />
                    <circle cx="92" cy="35" r="2.8" fill="#FDE047" />
                  </g>

                  <!-- 发饰星芒 -->
                  <path
                    d="M79 25L80.6 29L84.6 30.6L80.6 32.2L79 36.2L77.4 32.2L73.4 30.6L77.4 29Z"
                    fill="#FDE047"
                    class="girl-hairpin"
                  />
                </g>

                <!-- ── 全身大动作双臂与专属巨型魔法杖（施法 / 热舞 / 窗边躲猫猫 / 祈福） ── -->
                <g class="girl-arms-and-staff">
                  <!-- 左手动作：热舞/欢呼时高举左臂挥舞，躲猫猫时扶住窗框，施法时托起星芒宝珠 -->
                  <g class="girl-left-arm-group">
                    <path
                      v-if="
                        effectivePose === 'dance' ||
                        effectivePose === 'cheer' ||
                        effectivePose === 'cast'
                      "
                      d="M46 95L28 74"
                      stroke="#FFFFFF"
                      stroke-width="5.8"
                      stroke-linecap="round"
                    />
                    <circle
                      v-if="
                        effectivePose === 'dance' ||
                        effectivePose === 'cheer' ||
                        effectivePose === 'cast'
                      "
                      cx="26"
                      cy="72"
                      r="4.8"
                      fill="#FFF3EE"
                      :stroke="currentFairy.theme.wingColor"
                      stroke-width="1.1"
                    />
                    <g v-else-if="effectivePose === 'peek'">
                      <!-- 窗边躲猫猫时小手扒住窗沿 -->
                      <circle
                        cx="36"
                        cy="84"
                        r="5"
                        fill="#FFF3EE"
                        :stroke="currentFairy.theme.wingColor"
                        stroke-width="1.2"
                      />
                    </g>
                    <g v-else>
                      <circle cx="56" cy="98" r="12" fill="url(#wishOrbGrad)" class="pray-orb" />
                      <circle
                        cx="48"
                        cy="98"
                        r="4.8"
                        fill="#FFF3EE"
                        :stroke="currentFairy.theme.wingColor"
                        stroke-width="1.1"
                      />
                    </g>
                  </g>

                  <!-- 右臂大幅度挥动 + 超长华丽专属大魔法杖 -->
                  <g class="girl-right-arm-wave">
                    <path
                      d="M73 95L92 78"
                      stroke="#FFFFFF"
                      stroke-width="6"
                      stroke-linecap="round"
                    />
                    <!-- 巨型魔法杖整体（长杖杆 + 飘带 + 四仙子专属华丽杖头 + 杖尖旋转法阵） -->
                    <g class="girl-magic-staff">
                      <!-- 超长发光魔杖杖杆（从身侧斜贯至头顶上方） -->
                      <line
                        x1="68"
                        y1="122"
                        x2="114"
                        y2="34"
                        stroke="#FDE047"
                        stroke-width="3.4"
                        stroke-linecap="round"
                      />
                      <line
                        x1="68"
                        y1="122"
                        x2="114"
                        y2="34"
                        :stroke="currentFairy.theme.ribbonStart"
                        stroke-width="1.6"
                        stroke-dasharray="5 5"
                        stroke-linecap="round"
                      />
                      <!-- 杖身飘逸长丝带 -->
                      <path
                        class="staff-streamer"
                        d="M104 52C118 58 126 74 118 90C112 102 122 112 130 116"
                        fill="none"
                        stroke="url(#wishRibbonGrad)"
                        stroke-width="2.6"
                        stroke-linecap="round"
                      />

                      <!-- 杖尖召唤小法阵（施法/跳舞时高速旋转放光） -->
                      <circle cx="115" cy="32" r="16" fill="url(#wishOrbGrad)" class="pray-orb" />
                      <circle
                        cx="115"
                        cy="32"
                        r="14"
                        fill="none"
                        :stroke="currentFairy.theme.accentColor"
                        stroke-width="1.2"
                        stroke-dasharray="3 3"
                        class="staff-tip-ring"
                      />

                      <!-- 1. 小祈专属杖头：绯樱神乐大御币金环 + 双神铃 + 垂落纸垂 -->
                      <g v-if="currentFairy.id === 'miko'">
                        <circle
                          cx="115"
                          cy="32"
                          r="9"
                          fill="none"
                          stroke="#FACC15"
                          stroke-width="2.4"
                        />
                        <path
                          d="M115 19L121 27L111 29L118 37L109 40L114 48"
                          fill="none"
                          stroke="#FFFFFF"
                          stroke-width="3"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M115 21L108 28L117 31L109 39"
                          fill="none"
                          stroke="#FB7185"
                          stroke-width="2.4"
                          stroke-linejoin="round"
                        />
                        <circle
                          cx="106"
                          cy="36"
                          r="3.4"
                          fill="#FACC15"
                          stroke="#B45309"
                          stroke-width="0.8"
                        />
                        <circle
                          cx="123"
                          cy="34"
                          r="3.4"
                          fill="#FACC15"
                          stroke="#B45309"
                          stroke-width="0.8"
                        />
                      </g>

                      <!-- 2. 星奈专属杖头：星穹月冕巨型黄金新月 + 八芒星核 -->
                      <g v-else-if="currentFairy.id === 'astral'">
                        <path
                          d="M118 18C107 18 100 27 103 38C106 47 116 50 124 44C116 45 110 39 110 31C110 24 114 20 118 18Z"
                          fill="#FDE047"
                          stroke="#F59E0B"
                          stroke-width="1"
                        />
                        <path
                          d="M118 24L120 29.5L125.5 31.5L120 33.5L118 39L116 33.5L110.5 31.5L116 29.5Z"
                          fill="#FFFFFF"
                          class="pray-sparkle"
                        />
                      </g>

                      <!-- 3. 奈奈专属杖头：赛博霓虹发光猫爪权杖 + 金币挂饰 -->
                      <g v-else-if="currentFairy.id === 'neko'">
                        <circle
                          cx="115"
                          cy="32"
                          r="9.5"
                          fill="#0F172A"
                          stroke="#2DD4BF"
                          stroke-width="2"
                        />
                        <!-- 猫爪肉垫 -->
                        <ellipse cx="115" cy="34.5" rx="4.2" ry="3.2" fill="#F472B6" />
                        <circle cx="110.5" cy="29.5" r="1.8" fill="#5EEAD4" />
                        <circle cx="115" cy="28" r="1.9" fill="#5EEAD4" />
                        <circle cx="119.5" cy="29.5" r="1.8" fill="#5EEAD4" />
                      </g>

                      <!-- 4. 露露专属杖头：森罗四叶草黄金羽翼圣晶杖 -->
                      <g v-else>
                        <path
                          d="M104 32C97 25 99 18 107 23M126 32C133 25 131 18 123 23"
                          fill="none"
                          stroke="#FDE047"
                          stroke-width="2.4"
                          stroke-linecap="round"
                        />
                        <circle cx="112" cy="29" r="4.2" fill="#34D399" />
                        <circle cx="118" cy="29" r="4.2" fill="#10B981" />
                        <circle cx="112" cy="35" r="4.2" fill="#10B981" />
                        <circle cx="118" cy="35" r="4.2" fill="#34D399" />
                        <circle cx="115" cy="32" r="2.2" fill="#FEF08A" />
                      </g>
                    </g>

                    <!-- 握持魔杖的右手 -->
                    <circle
                      cx="91"
                      cy="79"
                      r="4.8"
                      fill="#FFF3EE"
                      :stroke="currentFairy.theme.wingColor"
                      stroke-width="1.1"
                    />
                  </g>
                </g>
              </svg>
            </div>

            <!-- 从仙子口中源源不断飘向空中的咒语粒子流 -->
            <div class="wish-chant-stream" aria-hidden="true">
              <div
                v-for="chant in activeChants"
                :key="chant.uid"
                class="wish-chant-bubble"
                :class="[`tone-${chant.tone}`, { critical: chant.critical }]"
                :style="{
                  '--lane-y': `${chant.laneOffsetY}px`,
                  '--chant-dur': `${chant.durationMs}ms`
                }"
              >
                <span class="chant-tail-dot" />
                <span class="chant-label">{{ chant.text }}</span>
              </div>
            </div>
          </div>

          <!-- 仙子身下悬浮的轻巧祈愿铭牌（点按攒欧气 + 切换动作 + 切换仙子 + 一键折叠） -->
          <div
            class="sprite-foot-ribbon"
            @mouseenter="hoveringActor = true"
            @mouseleave="hoveringActor = false"
            @click="onBlessClick"
          >
            <span class="ribbon-status">{{ ribbonBadgeText }}</span>
            <span class="ribbon-karma" :class="{ bump: karmaBump }">
              {{ isEn ? `✨ Luck ${luckTotalText}` : `✨ 欧气 ${luckTotalText}` /* cjk-ok */ }}
            </span>
            <button
              type="button"
              class="wish-switch-fairy-btn act-btn"
              :title="
                isEn
                  ? 'Trigger Magic / Dance / Window Peek / Spin'
                  : '切换炫酷动作（挥杖施法 / 律动热舞 / 窗边躲猫猫 / 360°回旋）' /* cjk-ok */
              "
              @pointerdown.stop
              @click.stop="onCycleStageAct"
            >
              {{ isEn ? '🪄 Act' : '🪄 动作' /* cjk-ok */ }}
            </button>
            <button
              type="button"
              class="wish-switch-fairy-btn"
              :title="switchFairyTooltip"
              :aria-label="switchFairyTooltip"
              @pointerdown.stop
              @click.stop="onCycleFairy"
            >
              {{ isEn ? '⇄' : '⇄ 换人' /* cjk-ok */ }}
            </button>
            <button
              type="button"
              class="wish-minimize-btn"
              :title="isEn ? 'Minimize' : '收起为小护身符' /* cjk-ok */"
              :aria-label="isEn ? 'Minimize' : '收起为小护身符' /* cjk-ok */"
              @pointerdown.stop
              @click.stop="toggleMinimized"
            >
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 覆盖整个对话消息视口，本身不拦截鼠标滚动与点击 */
.wish-shrine-overlay {
  position: absolute;
  inset: 0;
  z-index: 16;
  pointer-events: none;
  overflow: hidden;
}

/* 全窗口上空斜掠而过的背景流星群 */
.wish-window-meteors {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.window-meteor {
  position: absolute;
  width: 96px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, #fef08a 0%, #38bdf8 48%, rgba(56, 189, 248, 0) 100%);
  transform: rotate(-24deg);
  opacity: 0;
  filter: drop-shadow(0 0 6px #38bdf8);
  animation: wish-window-meteor-fly 2.6s linear infinite;
}

.window-meteor.wm1 {
  top: 12%;
  left: 65%;
  animation-delay: 0.1s;
  animation-duration: 2.2s;
}
.window-meteor.wm2 {
  top: 28%;
  left: 85%;
  background: linear-gradient(90deg, #fbcfe8 0%, #f472b6 48%, rgba(244, 114, 182, 0) 100%);
  filter: drop-shadow(0 0 6px #f472b6);
  animation-delay: 0.8s;
  animation-duration: 2.5s;
}
.window-meteor.wm3 {
  top: 48%;
  left: 72%;
  animation-delay: 1.45s;
  animation-duration: 2.1s;
}
.window-meteor.wm4 {
  top: 18%;
  left: 42%;
  background: linear-gradient(90deg, #fde047 0%, #f59e0b 48%, rgba(245, 158, 11, 0) 100%);
  filter: drop-shadow(0 0 6px #facc15);
  animation-delay: 1.9s;
  animation-duration: 2.4s;
}
.window-meteor.wm5 {
  top: 64%;
  left: 88%;
  animation-delay: 0.45s;
  animation-duration: 2.3s;
}

/* 在窗口中自由飘动的仙子容器 */
.wish-roaming-actor {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  pointer-events: none;
}

.wish-sprite-scene {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px 10px;
  pointer-events: none;
  user-select: none;
}

/* 角色身周局部星尘与小流星 */
.sprite-local-sky {
  position: absolute;
  inset: -12px -40px -8px -12px;
  pointer-events: none;
}

.wish-star {
  position: absolute;
  color: #fde047;
  font-size: 11px;
  text-shadow: 0 0 6px rgba(250, 204, 21, 0.85);
  animation: wish-star-twinkle 1.6s ease-in-out infinite alternate;
}

.wish-star.s1 {
  top: 6%;
  left: 6%;
}
.wish-star.s2 {
  top: 72%;
  left: 4%;
  color: #7dd3fc;
  animation-delay: 0.4s;
}
.wish-star.s3 {
  top: 10%;
  left: 48%;
  animation-delay: 0.9s;
}
.wish-star.s4 {
  top: 62%;
  left: 56%;
  color: #f472b6;
  animation-delay: 0.6s;
}

.wish-meteor {
  position: absolute;
  width: 58px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, #fef08a 0%, #38bdf8 48%, rgba(56, 189, 248, 0) 100%);
  transform: rotate(-22deg);
  opacity: 0;
  filter: drop-shadow(0 0 5px #38bdf8);
  animation: wish-meteor-fly 1.8s linear infinite;
}

.wish-meteor.m1 {
  top: 6px;
  left: 36px;
  animation-delay: 0s;
}
.wish-meteor.m2 {
  top: 28px;
  left: 72px;
  background: linear-gradient(90deg, #fbcfe8 0%, #f472b6 48%, rgba(244, 114, 182, 0) 100%);
  animation-delay: 0.55s;
}
.wish-meteor.m3 {
  top: 52px;
  left: 48px;
  background: linear-gradient(90deg, #fde047 0%, #f59e0b 48%, rgba(245, 158, 11, 0) 100%);
  animation-delay: 1.05s;
}
.wish-meteor.m4 {
  top: 16px;
  left: 96px;
  animation-delay: 1.4s;
}

.sprite-main-row {
  display: flex;
  align-items: center;
  position: relative;
  z-index: 2;
}

/* ── Q 版祈福仙子 SVG 精灵 ── */
.wish-anime-girl-wrap {
  position: relative;
  z-index: 3;
  width: 120px;
  height: 132px;
  flex-shrink: 0;
  cursor: pointer;
  pointer-events: auto;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 48%,
    var(--fairy-glow, rgba(244, 114, 182, 0.36)) 0%,
    rgba(139, 92, 246, 0.2) 52%,
    rgba(30, 22, 74, 0) 74%
  );
  filter: drop-shadow(0 6px 16px rgba(15, 10, 40, 0.55))
    drop-shadow(0 0 12px var(--fairy-glow, rgba(244, 114, 182, 0.4)));
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-anime-girl-wrap:hover {
  transform: scale(1.11) rotate(-3deg);
}

/* 窗口边缘躲藏探头模式（从左/右窗沿斜探出半个身子偷看） */
.wish-anime-girl-wrap.is-edge-peeking.edge-left {
  animation: wish-edge-peek-left 1.4s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.is-edge-peeking.edge-right {
  animation: wish-edge-peek-right 1.4s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.bounce {
  animation: wish-girl-squish 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-anime-girl-wrap.pose-spin .wish-anime-girl-svg {
  animation: wish-girl-twirl 0.72s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-anime-girl-wrap.pose-cheer .wish-anime-girl-svg {
  animation: wish-girl-hop 0.46s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.pose-dance .wish-anime-girl-svg {
  animation: wish-girl-idol-dance 0.52s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.pose-cast .wish-anime-girl-svg {
  animation: wish-girl-cast-levitate 0.9s ease-in-out infinite alternate;
}

.wish-anime-girl-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  animation: wish-girl-float 2s ease-in-out infinite alternate;
}

/* ── 偶像热舞舞台聚光灯与跳动音符特效 ── */
.fairy-dance-stage-fx {
  position: absolute;
  inset: -24px -18px -10px -18px;
  pointer-events: none;
  z-index: 1;
}

.dance-spotlight-cone {
  position: absolute;
  top: -12px;
  left: 50%;
  width: 112px;
  height: 148px;
  transform: translateX(-50%);
  clip-path: polygon(38% 0%, 62% 0%, 100% 100%, 0% 100%);
  background: linear-gradient(
    180deg,
    rgba(254, 240, 138, 0.45) 0%,
    var(--fairy-glow, rgba(244, 114, 182, 0.25)) 60%,
    rgba(30, 27, 75, 0) 100%
  );
  animation: wish-spotlight-sway 1.1s ease-in-out infinite alternate;
}

.dance-note {
  position: absolute;
  font-size: 14px;
  font-weight: 900;
  color: #fde047;
  text-shadow:
    0 0 8px #f472b6,
    0 0 14px #fde047;
  animation: wish-dance-note-float 1.2s ease-out infinite;
}

.dance-note.n1 {
  left: 8px;
  top: 28px;
  animation-delay: 0s;
}
.dance-note.n2 {
  right: 6px;
  top: 18px;
  color: #38bdf8;
  animation-delay: 0.4s;
}
.dance-note.n3 {
  left: 22px;
  top: 6px;
  color: #f472b6;
  animation-delay: 0.8s;
}

/* ── 挥杖施展大魔法的奥术光束特效 ── */
.fairy-spell-beam-fx {
  position: absolute;
  inset: -20px -40px -20px -20px;
  pointer-events: none;
  z-index: 5;
}

.spell-beam {
  position: absolute;
  left: 72%;
  top: 26%;
  width: 110px;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    #ffffff 0%,
    #fde047 35%,
    var(--fairy-accent, #f472b6) 75%,
    rgba(255, 255, 255, 0) 100%
  );
  filter: drop-shadow(0 0 8px #fde047);
  transform-origin: left center;
  animation: wish-spell-beam-shoot 0.85s ease-out infinite;
}

.spell-beam.b1 {
  transform: rotate(-28deg);
  animation-delay: 0s;
}
.spell-beam.b2 {
  transform: rotate(-6deg);
  width: 130px;
  animation-delay: 0.22s;
}
.spell-beam.b3 {
  transform: rotate(18deg);
  width: 96px;
  animation-delay: 0.45s;
}

/* 悬停或连击时头顶弹出的互动小气泡 */
.fairy-poke-callout {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
  color: #1e1b4b;
  background: linear-gradient(90deg, #fef08a, #f9a8d4);
  box-shadow: 0 3px 10px rgba(244, 114, 182, 0.55);
  pointer-events: none;
  animation: wish-callout-bob 0.7s ease-in-out infinite alternate;
}

.fairy-poke-callout.combo {
  color: #fff;
  background: linear-gradient(90deg, #f97316, #ec4899);
  box-shadow: 0 0 12px rgba(249, 115, 22, 0.8);
}

/* 点击爆发粒子层 */
.fairy-burst-layer {
  position: absolute;
  left: 50%;
  top: 48%;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 6;
}

.burst-particle {
  position: absolute;
  left: 0;
  top: 0;
  font-size: 14px;
  line-height: 1;
  pointer-events: none;
  animation: wish-particle-burst 0.76s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.girl-cloud-base {
  animation: wish-orb-pulse 1.6s ease-in-out infinite alternate;
}

.girl-halo {
  transform-origin: 60px 56px;
  animation: wish-halo-spin 12s linear infinite;
}

/* 精灵蝶翼扑扇 */
.wing-left {
  transform-origin: 42px 88px;
  animation: wish-wing-flap-left 0.42s ease-in-out infinite alternate;
}
.wing-right {
  transform-origin: 78px 88px;
  animation: wish-wing-flap-right 0.42s ease-in-out infinite alternate;
}
.wish-anime-girl-wrap:hover .wing-left,
.wish-anime-girl-wrap.combo-fever .wing-left {
  animation-duration: 0.18s;
}
.wish-anime-girl-wrap:hover .wing-right,
.wish-anime-girl-wrap.combo-fever .wing-right {
  animation-duration: 0.18s;
}

/* 头部歪头杀动画 */
.girl-head-group {
  transform-origin: 60px 76px;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.wish-anime-girl-wrap:hover .girl-head-group,
.wish-anime-girl-wrap.pose-peek .girl-head-group {
  transform: rotate(-7deg);
}
.wish-anime-girl-wrap.pose-wave .girl-head-group {
  transform: rotate(5deg);
}

/* 兽耳 / 猫耳抖动 */
.ear-left {
  transform-origin: 35px 24px;
  animation: wish-ear-twitch-l 1.8s ease-in-out infinite alternate;
}
.ear-right {
  transform-origin: 85px 24px;
  animation: wish-ear-twitch-r 1.8s ease-in-out infinite alternate;
}

/* 猫尾摇摆 */
.girl-neko-tail {
  transform-origin: 76px 112px;
  animation: wish-tail-wag 0.9s ease-in-out infinite alternate;
}

/* 悬空小短腿晃动 + 热舞时高抬腿律动踢踏 */
.girl-leg-left {
  transform-origin: 51px 116px;
  animation: wish-leg-swing 0.95s ease-in-out infinite alternate;
}
.girl-leg-right {
  transform-origin: 69px 116px;
  animation: wish-leg-swing 0.95s ease-in-out infinite alternate-reverse;
}
.wish-anime-girl-wrap.pose-dance .girl-leg-left {
  animation: wish-leg-dance-kick-l 0.42s ease-in-out infinite alternate;
}
.wish-anime-girl-wrap.pose-dance .girl-leg-right {
  animation: wish-leg-dance-kick-r 0.42s ease-in-out infinite alternate;
}
.wish-anime-girl-wrap.pose-cast .girl-leg-left {
  transform: rotate(14deg) translateY(-3px);
}
.wish-anime-girl-wrap.pose-cast .girl-leg-right {
  transform: rotate(-18deg) translateY(-5px);
}

/* 挥手与巨型魔法杖手臂大幅度摆动 */
.girl-right-arm-wave {
  transform-origin: 73px 95px;
  animation: wish-arm-wave 0.55s ease-in-out infinite alternate;
}
.wish-anime-girl-wrap.pose-cast .girl-right-arm-wave {
  animation: wish-staff-cast-sweep 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) infinite alternate;
}
.wish-anime-girl-wrap.pose-dance .girl-right-arm-wave {
  animation: wish-staff-dance-wave 0.42s ease-in-out infinite alternate;
}
.girl-left-arm-group {
  transform-origin: 48px 95px;
}
.wish-anime-girl-wrap.pose-dance .girl-left-arm-group {
  animation: wish-staff-dance-wave 0.42s ease-in-out infinite alternate-reverse;
}

/* 杖尖召唤法阵、流光丝带与脚底符文圈 */
.staff-tip-ring {
  transform-origin: 115px 32px;
  animation: wish-halo-spin 3.2s linear infinite;
}
.staff-streamer {
  transform-origin: 104px 52px;
  animation: wish-tail-wag 0.65s ease-in-out infinite alternate;
}
.girl-wand-ribbon-trail {
  animation: wish-ribbon-dash 0.7s linear infinite;
  filter: drop-shadow(0 0 6px var(--fairy-accent, #fde047));
}
.girl-foot-rune-ring {
  transform-origin: 60px 134px;
  animation: wish-orb-pulse 0.9s ease-in-out infinite alternate;
}
.girl-grand-hexagram {
  transform-origin: 60px 58px;
  animation: wish-halo-spin 6s linear infinite reverse;
}

.girl-ahoge {
  transform-origin: 61px 18px;
  animation: wish-ahoge-sway 1.1s ease-in-out infinite alternate;
}

.girl-twintail-left {
  transform-origin: 30px 36px;
  animation: wish-tail-left 1.4s ease-in-out infinite alternate;
}

.girl-twintail-right {
  transform-origin: 90px 36px;
  animation: wish-tail-right 1.4s ease-in-out infinite alternate;
}

.girl-bow-left {
  transform-origin: 28px 35px;
  animation: wish-bow-wiggle 1.5s ease-in-out infinite alternate;
}

.girl-bow-right {
  transform-origin: 92px 35px;
  animation: wish-bow-wiggle 1.5s ease-in-out infinite alternate-reverse;
}

.girl-hairpin {
  transform-box: fill-box;
  transform-origin: center;
  animation: wish-sparkle-pop 1.1s ease-in-out infinite alternate;
}

/* 水汪汪大眼：每 3.2s 眨一次眼 */
.girl-eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: wish-eye-blink 3.2s ease-in-out infinite;
}

.girl-eyes-star {
  transform-origin: 60px 61px;
  animation: wish-star-eyes 0.45s ease-in-out infinite alternate;
}

.girl-blush {
  animation: wish-blush-pulse 1.6s ease-in-out infinite alternate;
}

.girl-praying-hands {
  transform-origin: 60px 100px;
  animation: wish-hands-pray 0.75s ease-in-out infinite alternate;
}

.pray-orb {
  animation: wish-orb-pulse 1s ease-in-out infinite alternate;
}

.pray-sparkle {
  transform-origin: center;
  animation: wish-sparkle-pop 0.85s ease-in-out infinite alternate;
}

.pray-sparkle.sp-left {
  animation-delay: 0.28s;
}
.pray-sparkle.sp-right {
  animation-delay: 0.56s;
}

.mouth-aura-ring {
  transform-origin: 69px 75px;
  animation: wish-mouth-ripple 0.7s ease-out infinite;
}

/* ── 从仙子嘴边飘出的咒语气泡流 ── */
.wish-chant-stream {
  position: relative;
  width: 170px;
  height: 54px;
  margin-left: -10px;
  overflow: visible;
  pointer-events: none;
}

.wish-chant-bubble {
  position: absolute;
  left: 0;
  top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3.5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  color: #f8fafc;
  background: rgba(24, 18, 64, 0.92);
  border: 1px solid rgba(244, 114, 182, 0.65);
  box-shadow:
    0 6px 16px rgba(15, 10, 40, 0.52),
    0 0 10px rgba(244, 114, 182, 0.28);
  transform-origin: left center;
  animation: wish-chant-float var(--chant-dur, 3100ms) cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.chant-tail-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f472b6;
  box-shadow: 0 0 6px #f472b6;
  flex-shrink: 0;
}

.wish-chant-bubble.tone-emerald {
  border-color: rgba(52, 211, 153, 0.72);
  color: #ecfdf5;
}
.wish-chant-bubble.tone-emerald .chant-tail-dot {
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
}

.wish-chant-bubble.tone-gold {
  border-color: rgba(250, 204, 21, 0.78);
  color: #fef9c3;
}
.wish-chant-bubble.tone-gold .chant-tail-dot {
  background: #facc15;
  box-shadow: 0 0 6px #facc15;
}

.wish-chant-bubble.tone-cyan {
  border-color: rgba(56, 189, 248, 0.75);
  color: #e0f2fe;
}
.wish-chant-bubble.tone-cyan .chant-tail-dot {
  background: #38bdf8;
  box-shadow: 0 0 6px #38bdf8;
}

.wish-chant-bubble.critical {
  font-size: 12.5px;
  color: #422006;
  background: linear-gradient(90deg, #fde047 0%, #f59e0b 100%);
  border-color: #fef08a;
  box-shadow: 0 0 18px rgba(250, 204, 21, 0.8);
  z-index: 5;
}
.wish-chant-bubble.critical .chant-tail-dot {
  background: #7c2d12;
  box-shadow: none;
}

/* ── 角色下方悬浮小铭牌 ── */
.sprite-foot-ribbon {
  position: relative;
  z-index: 4;
  margin-top: -6px;
  margin-left: 2px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(24, 16, 56, 0.92), rgba(59, 20, 94, 0.92));
  border: 1px solid rgba(192, 132, 252, 0.55);
  box-shadow: 0 4px 14px rgba(15, 10, 40, 0.5);
  cursor: pointer;
  pointer-events: auto;
}

.ribbon-status {
  font-size: 10.5px;
  font-weight: 700;
  color: #fef08a;
}

.ribbon-karma {
  display: inline-block;
  min-width: 60px;
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #fde68a;
  padding: 0 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(168, 85, 247, 0.4), rgba(236, 72, 153, 0.34));
  text-shadow: 0 0 6px rgba(250, 204, 21, 0.55);
}

.ribbon-karma.bump,
.mini-karma-badge.bump {
  animation: wish-karma-bump 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-switch-fairy-btn {
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
  color: #fef08a;
  background: rgba(168, 85, 247, 0.38);
  border: 1px solid rgba(250, 204, 21, 0.55);
  cursor: pointer;
  transition:
    transform 0.14s ease,
    background 0.14s ease,
    box-shadow 0.14s ease;
}

.wish-switch-fairy-btn:hover {
  transform: scale(1.06);
  background: rgba(236, 72, 153, 0.68);
  box-shadow: 0 0 8px rgba(250, 204, 21, 0.55);
}

.wish-switch-fairy-btn:active {
  transform: scale(0.95);
}

/* ── 游戏伤害数字式欧气飘字 ── */
.luck-popup-layer {
  position: absolute;
  left: 58px;
  top: 2px;
  width: 0;
  height: 0;
  z-index: 8;
  pointer-events: none;
}

.luck-popup-layer.mini {
  left: 26px;
  top: 0;
}

.luck-popup {
  position: absolute;
  left: var(--pop-x, 0px);
  top: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  white-space: nowrap;
  font-family: 'Impact', 'Arial Black', 'Segoe UI Black', system-ui, sans-serif;
  font-style: italic;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.5px;
  opacity: 0;
  will-change: transform, opacity;
  animation: wish-luck-pop var(--pop-dur, 1100ms) cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
}

.luck-num {
  font-size: 15px;
  background: linear-gradient(180deg, #ffffff 0%, #fbcfe8 60%, #f472b6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 0.6px #4a044e) drop-shadow(0 0 0.6px #4a044e)
    drop-shadow(0 1.5px 0 #4a044e) drop-shadow(0 0 4px rgba(244, 114, 182, 0.65));
}

.luck-popup.tier-big .luck-num {
  font-size: 19px;
  background-image: linear-gradient(180deg, #fff7ed 0%, #fdba74 55%, #f97316 100%);
  filter: drop-shadow(0 0 0.7px #431407) drop-shadow(0 0 0.7px #431407) drop-shadow(0 2px 0 #431407)
    drop-shadow(0 0 6px rgba(249, 115, 22, 0.7));
}

.luck-popup.tier-crit {
  animation-name: wish-luck-crit;
  z-index: 2;
}

.luck-popup.tier-crit .luck-num {
  font-size: 25px;
  background-image: linear-gradient(180deg, #fffbeb 0%, #fde047 45%, #f59e0b 80%, #b45309 100%);
  filter: drop-shadow(0 0 0.8px #451a03) drop-shadow(0 0 0.8px #451a03)
    drop-shadow(0 2.5px 0 #451a03) drop-shadow(0 0 10px rgba(250, 204, 21, 0.9));
}

.luck-crit-tag {
  margin-bottom: 1px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-style: normal;
  letter-spacing: 1px;
  color: #fff;
  background: linear-gradient(90deg, #ef4444, #ec4899);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.75);
  transform: skewX(-10deg);
}

.wish-minimize-btn {
  width: 0;
  height: 16px;
  margin-left: -6px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  opacity: 0;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid transparent;
  cursor: pointer;
  padding: 0;
  transition:
    width 0.18s ease,
    margin 0.18s ease,
    opacity 0.18s ease;
}

.wish-roaming-actor:hover .wish-minimize-btn,
.wish-minimize-btn:focus-visible {
  width: 16px;
  margin-left: 0;
  opacity: 1;
  border-color: rgba(148, 163, 184, 0.35);
}

.wish-minimize-btn:hover {
  color: #f8fafc;
  border-color: #c084fc;
}

/* ── 迷你护身符折叠胶囊 ── */
.wish-shrine-mini-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(22, 16, 50, 0.92) 0%, rgba(42, 18, 82, 0.92) 100%);
  border: 1px solid rgba(192, 132, 252, 0.55);
  box-shadow: 0 6px 18px rgba(15, 10, 40, 0.5);
  color: #f8fafc;
  font-size: 11.5px;
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
}

.mini-pray-icon {
  animation: wish-hands-pray 0.85s ease-in-out infinite alternate;
}

.mini-chant-text {
  font-weight: 600;
  color: #fef08a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.mini-karma-badge {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #f0abfc;
  background: rgba(168, 85, 247, 0.28);
}

.mini-expand-btn {
  border: none;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
  padding: 0 2px;
  font-size: 12px;
}

/* ── 关键帧动画 ── */
@keyframes wish-window-meteor-fly {
  0% {
    opacity: 0;
    transform: rotate(-24deg) translateX(60px);
  }
  12% {
    opacity: 0.9;
  }
  65% {
    opacity: 0.75;
  }
  100% {
    opacity: 0;
    transform: rotate(-24deg) translateX(-340px);
  }
}

@keyframes wish-meteor-fly {
  0% {
    opacity: 0;
    transform: rotate(-22deg) translateX(30px);
  }
  15% {
    opacity: 0.95;
  }
  70% {
    opacity: 0.85;
  }
  100% {
    opacity: 0;
    transform: rotate(-22deg) translateX(-140px);
  }
}

@keyframes wish-star-twinkle {
  0% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1.25);
  }
}

@keyframes wish-girl-float {
  0% {
    transform: translateY(2px);
  }
  100% {
    transform: translateY(-5px);
  }
}

@keyframes wish-girl-hop {
  0% {
    transform: translateY(0) scale(1);
  }
  100% {
    transform: translateY(-8px) scale(1.04);
  }
}

@keyframes wish-girl-idol-dance {
  0% {
    transform: translateX(-6px) translateY(2px) rotate(-8deg) scale(1.02, 0.98);
  }
  50% {
    transform: translateX(0) translateY(-7px) rotate(0deg) scale(0.98, 1.05);
  }
  100% {
    transform: translateX(6px) translateY(2px) rotate(8deg) scale(1.02, 0.98);
  }
}

@keyframes wish-girl-cast-levitate {
  0% {
    transform: translateY(-2px) rotate(-4deg) scale(1.04);
  }
  100% {
    transform: translateY(-10px) rotate(4deg) scale(1.09);
  }
}

@keyframes wish-edge-peek-left {
  0% {
    transform: translateX(-14px) rotate(18deg);
  }
  100% {
    transform: translateX(6px) rotate(26deg);
  }
}

@keyframes wish-edge-peek-right {
  0% {
    transform: translateX(14px) rotate(-18deg);
  }
  100% {
    transform: translateX(-6px) rotate(-26deg);
  }
}

@keyframes wish-spotlight-sway {
  0% {
    transform: translateX(-50%) rotate(-10deg);
    opacity: 0.65;
  }
  100% {
    transform: translateX(-50%) rotate(10deg);
    opacity: 0.95;
  }
}

@keyframes wish-dance-note-float {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.5) rotate(-15deg);
  }
  35% {
    opacity: 1;
    transform: translateY(-4px) scale(1.15) rotate(10deg);
  }
  100% {
    opacity: 0;
    transform: translateY(-28px) scale(0.85) rotate(-12deg);
  }
}

@keyframes wish-spell-beam-shoot {
  0% {
    opacity: 0;
    transform: scaleX(0.15) translateX(0);
  }
  25% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: scaleX(1.35) translateX(52px);
  }
}

@keyframes wish-leg-dance-kick-l {
  0% {
    transform: rotate(-6deg) translateY(0);
  }
  100% {
    transform: rotate(28deg) translateY(-4px);
  }
}

@keyframes wish-leg-dance-kick-r {
  0% {
    transform: rotate(-28deg) translateY(-4px);
  }
  100% {
    transform: rotate(6deg) translateY(0);
  }
}

@keyframes wish-staff-cast-sweep {
  0% {
    transform: rotate(-28deg) scale(1.04);
  }
  100% {
    transform: rotate(24deg) scale(1.1);
  }
}

@keyframes wish-staff-dance-wave {
  0% {
    transform: rotate(-22deg);
  }
  100% {
    transform: rotate(22deg);
  }
}

@keyframes wish-ribbon-dash {
  from {
    stroke-dashoffset: 32;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes wish-girl-twirl {
  0% {
    transform: rotate(0deg) scale(1);
  }
  50% {
    transform: rotate(180deg) scale(1.14);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
}

@keyframes wish-girl-squish {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(1.22, 0.82) translateY(3px);
  }
  70% {
    transform: scale(0.92, 1.12) translateY(-5px);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes wish-wing-flap-left {
  0% {
    transform: rotate(-8deg) scaleX(0.88);
  }
  100% {
    transform: rotate(14deg) scaleX(1.06);
  }
}

@keyframes wish-wing-flap-right {
  0% {
    transform: rotate(8deg) scaleX(0.88);
  }
  100% {
    transform: rotate(-14deg) scaleX(1.06);
  }
}

@keyframes wish-ear-twitch-l {
  0%,
  70% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(-12deg);
  }
}

@keyframes wish-ear-twitch-r {
  0%,
  70% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(12deg);
  }
}

@keyframes wish-tail-wag {
  0% {
    transform: rotate(-12deg);
  }
  100% {
    transform: rotate(16deg);
  }
}

@keyframes wish-leg-swing {
  0% {
    transform: rotate(-9deg);
  }
  100% {
    transform: rotate(9deg);
  }
}

@keyframes wish-arm-wave {
  0% {
    transform: rotate(-10deg);
  }
  100% {
    transform: rotate(14deg);
  }
}

@keyframes wish-callout-bob {
  0% {
    transform: translateX(-50%) translateY(0) scale(0.96);
  }
  100% {
    transform: translateX(-50%) translateY(-4px) scale(1.04);
  }
}

@keyframes wish-particle-burst {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(0.4) rotate(0deg);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--bx, 0px)), calc(-50% + var(--by, 0px))) scale(1.15)
      rotate(var(--brot, 0deg));
  }
}

@keyframes wish-halo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes wish-eye-blink {
  0%,
  90%,
  100% {
    transform: scaleY(1);
  }
  94% {
    transform: scaleY(0.08);
  }
}

@keyframes wish-star-eyes {
  0% {
    transform: scale(0.94);
  }
  100% {
    transform: scale(1.08);
  }
}

@keyframes wish-blush-pulse {
  0% {
    fill-opacity: 0.38;
  }
  100% {
    fill-opacity: 0.72;
  }
}

@keyframes wish-bow-wiggle {
  0% {
    transform: rotate(-6deg);
  }
  100% {
    transform: rotate(6deg);
  }
}

@keyframes wish-karma-bump {
  0% {
    transform: scale(1);
  }
  45% {
    transform: scale(1.22);
  }
  100% {
    transform: scale(1);
  }
}

/* 普通 / 大额：弹出放大 → 回弹 → 弧线上飘淡出 */
@keyframes wish-luck-pop {
  0% {
    opacity: 0;
    transform: translate(-50%, 8px) rotate(var(--pop-tilt, 0deg)) scale(0.3);
  }
  12% {
    opacity: 1;
    transform: translate(-50%, -16px) rotate(var(--pop-tilt, 0deg)) scale(1.45);
  }
  26% {
    opacity: 1;
    transform: translate(calc(-50% + var(--pop-drift, 0px) * 0.25), -22px)
      rotate(calc(var(--pop-tilt, 0deg) * 0.4)) scale(1);
  }
  70% {
    opacity: 1;
    transform: translate(calc(-50% + var(--pop-drift, 0px) * 0.7), -44px) rotate(0deg) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--pop-drift, 0px)), -62px) rotate(0deg) scale(0.82);
  }
}

/* 暴击：超大砸入 + 抖动 + 更高飘升 */
@keyframes wish-luck-crit {
  0% {
    opacity: 0;
    transform: translate(-50%, -10px) rotate(var(--pop-tilt, 0deg)) scale(2.6);
  }
  10% {
    opacity: 1;
    transform: translate(-50%, -20px) rotate(var(--pop-tilt, 0deg)) scale(0.9);
  }
  16% {
    transform: translate(calc(-50% - 3px), -22px) rotate(-4deg) scale(1.18);
  }
  22% {
    transform: translate(calc(-50% + 3px), -24px) rotate(4deg) scale(1.08);
  }
  28% {
    opacity: 1;
    transform: translate(-50%, -26px) rotate(0deg) scale(1.12);
  }
  72% {
    opacity: 1;
    transform: translate(calc(-50% + var(--pop-drift, 0px) * 0.5), -50px) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--pop-drift, 0px) * 0.8), -76px) scale(0.9);
  }
}

@keyframes wish-ahoge-sway {
  0% {
    transform: rotate(-11deg);
  }
  100% {
    transform: rotate(13deg);
  }
}

@keyframes wish-tail-left {
  0% {
    transform: rotate(-4deg);
  }
  100% {
    transform: rotate(6deg);
  }
}

@keyframes wish-tail-right {
  0% {
    transform: rotate(4deg);
  }
  100% {
    transform: rotate(-6deg);
  }
}

@keyframes wish-hands-pray {
  0% {
    transform: translateY(2px) rotate(-2.5deg);
  }
  100% {
    transform: translateY(-3.5px) rotate(2.5deg);
  }
}

@keyframes wish-orb-pulse {
  0% {
    opacity: 0.55;
    transform: scale(0.86);
  }
  100% {
    opacity: 1;
    transform: scale(1.16);
  }
}

@keyframes wish-sparkle-pop {
  0% {
    opacity: 0.35;
    transform: scale(0.7);
  }
  100% {
    opacity: 1;
    transform: scale(1.2);
  }
}

@keyframes wish-mouth-ripple {
  0% {
    opacity: 0;
    transform: translate(-2px, 2px) scale(0.6);
  }
  30% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(4px, -7px) scale(1.1) rotate(12deg);
  }
}

/* 咒语从仙子口中诞生 → 向右上方弧线升腾飘散 */
@keyframes wish-chant-float {
  0% {
    opacity: 0;
    transform: translate3d(-14px, 8px, 0) scale(0.42);
  }
  14% {
    opacity: 1;
    transform: translate3d(6px, var(--lane-y, 0px), 0) scale(1.04);
  }
  76% {
    opacity: 0.95;
    transform: translate3d(52px, calc(var(--lane-y, 0px) - 14px), 0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate3d(96px, calc(var(--lane-y, 0px) - 28px), 0) scale(0.9);
  }
}

.wish-shrine-fade-enter-active,
.wish-shrine-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-shrine-fade-enter-from,
.wish-shrine-fade-leave-to {
  opacity: 0;
  transform: scale(0.92);
}
</style>
