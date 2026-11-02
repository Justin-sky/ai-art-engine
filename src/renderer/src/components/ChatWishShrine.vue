<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import fairyThinkingPng from '@renderer/assets/wish-fairy/thinking.png'
import fairyCastingPng from '@renderer/assets/wish-fairy/casting.png'
import fairyCritPng from '@renderer/assets/wish-fairy/crit.png'
import fairySuccessPng from '@renderer/assets/wish-fairy/success.png'
import fairyErrorPng from '@renderer/assets/wish-fairy/error.png'
import fairyPeekPng from '@renderer/assets/wish-fairy/peek.png'
import {
  buildFairySpellLinks,
  computeFairyCastPosition,
  detectWishPromptCategory,
  formatLuckTotal,
  generateJaggedLightningBolt,
  getFairyStageActReaction,
  nextFairyStageAct,
  nextWishFairyId,
  pickFairyPokeReaction,
  pickNextWishChant,
  rollLuckGain,
  selectWishFairyForSession,
  type WishChantCategory,
  type WishCookingNodeTarget,
  type WishFairyExpression,
  type WishFairyId,
  type WishFairyPersona,
  type WishFairyPose,
  type WishFairyStageAct,
  type WishFloatingChant,
  type WishLuckPopup,
  type WishShrinePhase,
  type WishSpellLink
} from '@shared/chatWishShrine'

const props = defineProps<{
  running: boolean
  sessionId?: string
  sessionTitle?: string
  promptText?: string
  activityText?: string
  outcome?: 'idle' | 'success' | 'error'
  isEn?: boolean
  /** 节点画布中正在 cook（运行中）的节点目标列表（屏幕坐标） */
  cookingTargets?: readonly WishCookingNodeTarget[]
}>()

const activeCookingTargets = computed<readonly WishCookingNodeTarget[]>(
  () => props.cookingTargets ?? []
)

const isAnyActive = computed(() => props.running || activeCookingTargets.value.length > 0)

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
const spellCanvasRef = ref<HTMLCanvasElement | null>(null)
const staffTipCircleRef = ref<SVGCircleElement | null>(null)
const posX = ref(48)
const posY = ref(64)
const facingDir = ref<'right' | 'left'>('right')
/** 实时从 DOM 测量的法杖杖头中心在画布视口中的精确坐标（跟随挥杖动画实时跳动） */
const liveWandPos = ref<{ x: number; y: number } | null>(null)

interface SpellCometParticle {
  x: number
  y: number
  vx: number
  vy: number
  targetId: string
  targetX: number
  targetY: number
  color: string
  size: number
  life: number
  maxLife: number
  trail: Array<{ x: number; y: number }>
}

interface SpellImpactSpark {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  alpha: number
  decay: number
}

const spellComets: SpellCometParticle[] = []
const spellSparks: SpellImpactSpark[] = []
let lastCometSpawnAt = 0

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
  if (displayPhase.value === 'crit' || activeCookingTargets.value.length > 0) return 'star'
  if (activeExpression.value !== 'normal') return activeExpression.value
  return 'normal'
})

/** 综合当前阶段、悬停与点击状态计算的最终动作姿态 */
const effectivePose = computed<WishFairyPose>(() => {
  if (displayPhase.value === 'success') return 'cheer'
  if (displayPhase.value === 'crit' || activeCookingTargets.value.length > 0) return 'cast'
  if (activePose.value !== 'pray') return activePose.value
  return 'pray'
})

export type WishFairySpriteKey = 'thinking' | 'casting' | 'crit' | 'success' | 'error' | 'peek'

const FAIRY_SPRITE_MAP: Record<WishFairySpriteKey, string> = {
  thinking: fairyThinkingPng,
  casting: fairyCastingPng,
  crit: fairyCritPng,
  success: fairySuccessPng,
  error: fairyErrorPng,
  peek: fairyPeekPng
}

/** 420ms 节拍器：驱动热舞多帧切换与 360° 回旋连续换姿 */
const actionBeatTick = ref(0)

/** 根据当前阶段、动作姿态与节点运行状态自动映射对应的 2D 二次元蓝鲸仙子立绘（含多帧热舞与回旋） */
const activeFairySpriteKey = computed<WishFairySpriteKey>(() => {
  if (displayPhase.value === 'error' || effectiveExpression.value === 'teary') return 'error'
  if (displayPhase.value === 'success' || effectivePose.value === 'cheer') return 'success'
  if (stageAct.value === 'edge-peek' || effectivePose.value === 'peek') return 'peek'
  // 律动热舞：跟随音乐节拍在「元气比耶跳跃 (crit)」与「双手高举欢呼 (success)」之间逐拍交替跳动！
  if (stageAct.value === 'dance' || effectivePose.value === 'dance') {
    return actionBeatTick.value % 2 === 0 ? 'crit' : 'success'
  }
  // 360° 星光回旋：高速旋转中连续切换施法/比耶/欢呼三帧姿态
  if (stageAct.value === 'spin' || effectivePose.value === 'spin') {
    const spinFrames: readonly WishFairySpriteKey[] = ['casting', 'crit', 'success']
    return spinFrames[actionBeatTick.value % spinFrames.length] ?? 'crit'
  }
  if (
    activeCookingTargets.value.length > 0 ||
    stageAct.value === 'cast' ||
    effectivePose.value === 'cast' ||
    effectivePose.value === 'wand'
  ) {
    return 'casting'
  }
  if (
    displayPhase.value === 'crit' ||
    comboCount.value > 0 ||
    effectivePose.value === 'wave' ||
    effectiveExpression.value === 'wink' ||
    effectiveExpression.value === 'heart' ||
    effectiveExpression.value === 'smug' ||
    effectiveExpression.value === 'surprised'
  ) {
    return 'crit'
  }
  return 'thinking'
})

const activeFairySpriteSrc = computed<string>(() => FAIRY_SPRITE_MAP[activeFairySpriteKey.value])

/**
 * 控制 2D 立绘水平镜像翻转：
 * - peek.png 原图从左侧探出朝右看，当在右窗边躲猫猫时镜像翻转；
 * - dance 热舞模式下，每两拍左右交替镜像踏步，形成真正的二次元偶像左右律动舞步；
 * - casting.png 原图魔杖在画面左侧，朝右施法时镜像翻转使星芒魔杖朝向右侧（与咒语飘字同侧）；
 * - 其余立绘在朝左飞行时轻轻镜像翻转。
 */
const spriteFlipX = computed<boolean>(() => {
  if (activeFairySpriteKey.value === 'peek') {
    return edgeSide.value === 'right'
  }
  if (stageAct.value === 'dance' || effectivePose.value === 'dance') {
    return Math.floor(actionBeatTick.value / 2) % 2 === 1
  }
  if (activeFairySpriteKey.value === 'casting') {
    return facingDir.value === 'right'
  }
  return facingDir.value === 'left'
})

/** SVG 视图坐标系（136×146）下魔杖星芒尖端与手部支点的精确坐标（严格对齐 2D 立绘翻转方向） */
const wandTipSvgCoord = computed(() => {
  const wandOnRight =
    activeFairySpriteKey.value === 'casting' ? spriteFlipX.value : !spriteFlipX.value
  return {
    x: wandOnRight ? 109 : 27,
    y: 28,
    pivotX: wandOnRight ? 94 : 42,
    pivotY: 64
  }
})

/** 实时计算从仙子法杖尖端飞向所有正在 cook 节点的近程/远程魔法轨迹 */
const spellLinks = computed<WishSpellLink[]>(() =>
  buildFairySpellLinks(
    {
      x: posX.value,
      y: posY.value,
      facing: facingDir.value,
      wandX: liveWandPos.value?.x,
      wandY: liveWandPos.value?.y
    },
    activeCookingTargets.value
  )
)

const wandScreenPoint = computed(() => ({
  x: Math.round(liveWandPos.value?.x ?? posX.value + (spriteFlipX.value ? 109 : 27)),
  y: Math.round(liveWandPos.value?.y ?? posY.value + 28),
  bodyCenterX: Math.round(posX.value + 64),
  bodyCenterY: Math.round(posY.value + 72)
}))

const SPELL_PALETTE = ['#38bdf8', '#fde047', '#f472b6', '#c084fc', '#34d399'] as const

/** 缓存单条脉冲细闪电几何，避免每 16ms 高频全量重随导致画面杂乱闪烁 */
let cachedBoltState: {
  slotKey: string
  targetIdx: number
  color: string
  bolt: ReturnType<typeof generateJaggedLightningBolt>
} | null = null
let cometTargetRoundRobin = 0

function spawnImpactSparks(x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 35 + Math.random() * 75
    spellSparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 14,
      color: SPELL_PALETTE[i % SPELL_PALETTE.length]!,
      size: 0.75 + Math.random() * 0.85,
      alpha: 0.9,
      decay: 2.1 + Math.random() * 1.1
    })
  }
  if (spellSparks.length > 72) {
    spellSparks.splice(0, spellSparks.length - 72)
  }
}

/**
 * 60fps 精致纤细 Canvas 施法特效渲染器：
 * 1. 每个正在执行的节点仅保留 1 条纤细柔美的星光引导丝线（0.65px 极细亮核 + 1.4px 柔光），画面清爽不遮挡；
 * 2. 闪电采用「单发轮流脉冲」机制：同一时刻全场最多只出现 1 条纤细闪电弧（0.75px 核心线宽），在多个目标节点间错峰跳动并带有呼吸留白；
 * 3. 低频发射小巧星芒微粒飞弹，命中节点时绽放细腻小星花。
 */
function renderSpellVfxFrame(now: number, dt: number, cw: number, ch: number): void {
  const canvas = spellCanvasRef.value
  if (!canvas) return
  const links = spellLinks.value
  if (minimized.value || links.length === 0) {
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    spellComets.length = 0
    spellSparks.length = 0
    cachedBoltState = null
    return
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const targetW = Math.max(1, Math.round(cw * dpr))
  const targetH = Math.max(1, Math.round(ch * dpr))
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  ctx.globalCompositeOperation = 'lighter'

  const tSec = now * 0.001
  const wx = wandScreenPoint.value.x
  const wy = wandScreenPoint.value.y

  // 1. 杖头小巧精致星芒光晕与 2 根极细微电丝
  const muzzleGrad = ctx.createRadialGradient(wx, wy, 0.5, wx, wy, 13)
  muzzleGrad.addColorStop(0, 'rgba(255, 255, 255, 0.92)')
  muzzleGrad.addColorStop(0.35, 'rgba(253, 224, 71, 0.65)')
  muzzleGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.24)')
  muzzleGrad.addColorStop(1, 'rgba(56, 189, 248, 0)')
  ctx.fillStyle = muzzleGrad
  ctx.beginPath()
  ctx.arc(wx, wy, 13, 0, Math.PI * 2)
  ctx.fill()

  for (let m = 0; m < 2; m++) {
    const ang = tSec * 3.8 + m * Math.PI + (Math.random() - 0.5) * 0.4
    const len = 7 + Math.random() * 5
    const bolt = generateJaggedLightningBolt({
      x1: wx,
      y1: wy,
      x2: wx + Math.cos(ang) * len,
      y2: wy + Math.sin(ang) * len,
      segments: 4,
      jitterAmplitude: 2.2,
      forkChance: 0
    })
    ctx.strokeStyle = m % 2 === 0 ? '#fde047' : '#38bdf8'
    ctx.globalAlpha = 0.65
    ctx.lineWidth = 0.7
    ctx.beginPath()
    bolt.main.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  }

  // 2. 低频轮流发射单颗小巧星尘飞弹（每次仅 1 颗，避免漫天粗弹道杂乱）
  const spawnInterval = 260
  if (now - lastCometSpawnAt >= spawnInterval) {
    lastCometSpawnAt = now
    const link = links[cometTargetRoundRobin % links.length]!
    cometTargetRoundRobin += 1
    const isLong = link.mode === 'longRange'
    const baseAngle = Math.atan2(link.targetY - wy, link.targetX - wx)
    const spreadAngle = baseAngle + (Math.random() - 0.5) * 0.45
    const initSpeed = isLong ? 270 + Math.random() * 80 : 210 + Math.random() * 60
    const impactJitterX =
      (Math.random() - 0.5) * Math.min(36, Math.max(12, link.nodeScreenWidth * 0.25))
    const impactJitterY =
      (Math.random() - 0.5) * Math.min(22, Math.max(8, link.nodeScreenHeight * 0.2))
    spellComets.push({
      x: wx,
      y: wy,
      vx: Math.cos(spreadAngle) * initSpeed,
      vy: Math.sin(spreadAngle) * initSpeed,
      targetId: link.id,
      targetX: link.targetX + impactJitterX,
      targetY: link.targetY + impactJitterY,
      color: SPELL_PALETTE[cometTargetRoundRobin % SPELL_PALETTE.length]!,
      size: 1.7,
      life: 0,
      maxLife: isLong ? 0.92 : 0.68,
      trail: [{ x: wx, y: wy }]
    })
    if (spellComets.length > 18) {
      spellComets.splice(0, spellComets.length - 18)
    }
  }

  // 3. 每个目标节点仅绘制 1 条极细柔光导流丝线（清晰优雅，不遮挡画布）
  for (let idx = 0; idx < links.length; idx++) {
    const link = links[idx]!
    const isLong = link.mode === 'longRange'
    const dx = link.targetX - wx
    const dy = link.targetY - wy
    const dist = Math.max(1, Math.hypot(dx, dy))
    const nx = -dy / dist
    const ny = dx / dist
    const baseArch = isLong ? Math.min(68, Math.max(24, dist * 0.14)) : Math.min(28, dist * 0.08)
    const streamColor = SPELL_PALETTE[idx % SPELL_PALETTE.length]!
    const steps = 24

    ctx.beginPath()
    const pts: Array<{ x: number; y: number }> = []
    for (let k = 0; k <= steps; k++) {
      const u = k / steps
      const env = Math.sin(u * Math.PI)
      const wave = Math.sin(u * 6.2 - tSec * 4.2 + idx * 1.3) * 3.8 * env
      const px = wx + dx * u + nx * wave
      const py = wy + dy * u + ny * wave - baseArch * env
      pts.push({ x: px, y: py })
      if (k === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }

    // 外层纤细柔光丝
    ctx.strokeStyle = streamColor
    ctx.globalAlpha = 0.26
    ctx.lineWidth = 1.35
    ctx.shadowColor = streamColor
    ctx.shadowBlur = 4
    ctx.stroke()

    // 内层 0.6px 极细星光芯线
    ctx.strokeStyle = '#ffffff'
    ctx.globalAlpha = 0.58
    ctx.lineWidth = 0.6
    ctx.shadowBlur = 0
    ctx.stroke()

    // 沿纤细丝线滑行的微距流光点
    const surgeT = (tSec * 1.15 + idx * 0.33) % 1
    const headIdx = Math.min(pts.length - 1, Math.max(2, Math.floor(surgeT * pts.length)))
    const tailIdx = Math.max(0, headIdx - 3)
    ctx.beginPath()
    for (let m = tailIdx; m <= headIdx; m++) {
      const p = pts[m]!
      if (m === tailIdx) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.strokeStyle = '#ffffff'
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 1.3
    ctx.shadowColor = streamColor
    ctx.shadowBlur = 4
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  // 4. 单发脉冲纤细闪电弧：同一时刻全场最多只出现 1 条细闪电，在目标节点间轮流错峰触发
  const cycleMs = 240
  const activeDurationMs = 145
  const cycleIndex = Math.floor(now / cycleMs)
  const cycleElapsed = now % cycleMs
  if (cycleElapsed <= activeDurationMs) {
    const targetIdx = cycleIndex % links.length
    const activeLink = links[targetIdx]!
    const isLong = activeLink.mode === 'longRange'
    const dist = Math.max(1, Math.hypot(activeLink.targetX - wx, activeLink.targetY - wy))
    const baseArch = isLong ? Math.min(68, Math.max(24, dist * 0.14)) : Math.min(28, dist * 0.08)
    // 每 75ms 更新一次折线形态，避免每帧剧烈乱跳
    const morphStep = Math.floor(now / 75)
    const slotKey = `${cycleIndex}:${morphStep}:${activeLink.id}`

    if (!cachedBoltState || cachedBoltState.slotKey !== slotKey) {
      const strikeX =
        activeLink.targetX + (Math.random() - 0.5) * Math.min(34, activeLink.nodeScreenWidth * 0.25)
      const strikeY =
        activeLink.targetY + (Math.random() - 0.5) * Math.min(20, activeLink.nodeScreenHeight * 0.2)
      const boltColor = targetIdx % 2 === 0 ? '#38bdf8' : '#fde047'
      cachedBoltState = {
        slotKey,
        targetIdx,
        color: boltColor,
        bolt: generateJaggedLightningBolt({
          x1: wx,
          y1: wy,
          x2: strikeX,
          y2: strikeY,
          archLift: baseArch,
          swayOffset: 0,
          jitterAmplitude: isLong ? 8.5 : 6.2,
          segments: isLong ? 12 : 10,
          forkChance: 0.16
        })
      }
      if (Math.random() < 0.4) {
        spawnImpactSparks(strikeX, strikeY, 2)
      }
    }

    const pulseEnvelope = Math.sin((cycleElapsed / activeDurationMs) * Math.PI)
    const { bolt, color: boltGlowColor } = cachedBoltState

    // 外层纤细电弧辉光（1.7px）
    ctx.beginPath()
    bolt.main.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.strokeStyle = boltGlowColor
    ctx.globalAlpha = 0.42 * pulseEnvelope
    ctx.lineWidth = 1.7
    ctx.shadowColor = boltGlowColor
    ctx.shadowBlur = 5
    ctx.stroke()

    // 内层极细纯白闪电芯（0.75px）
    ctx.beginPath()
    bolt.main.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.strokeStyle = '#ffffff'
    ctx.globalAlpha = 0.88 * pulseEnvelope
    ctx.lineWidth = 0.75
    ctx.shadowBlur = 2
    ctx.stroke()

    // 极细微侧向分叉（最多 1~2 小支，0.5px 细丝）
    for (const fork of bolt.forks) {
      ctx.beginPath()
      fork.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.strokeStyle = '#ffffff'
      ctx.globalAlpha = fork.alpha * 0.65 * pulseEnvelope
      ctx.lineWidth = 0.5
      ctx.shadowBlur = 0
      ctx.stroke()
    }
    ctx.shadowBlur = 0
  }

  // 5. 更新并绘制小巧星尘彗星（纤细拖尾）
  for (let i = spellComets.length - 1; i >= 0; i--) {
    const c = spellComets[i]!
    c.life += dt
    const liveLink = links.find((l) => l.id === c.targetId) ?? links[0]
    if (liveLink) {
      c.targetX = liveLink.targetX
      c.targetY = liveLink.targetY
    }
    const toX = c.targetX - c.x
    const toY = c.targetY - c.y
    const remDist = Math.hypot(toX, toY)
    if (remDist < 16 || c.life >= c.maxLife) {
      spawnImpactSparks(c.x, c.y, 4)
      spellComets.splice(i, 1)
      continue
    }
    const steerStrength = 7 + (c.life / c.maxLife) * 14
    const desiredSpeed = 380
    const desiredVx = (toX / remDist) * desiredSpeed
    const desiredVy = (toY / remDist) * desiredSpeed
    c.vx += (desiredVx - c.vx) * Math.min(1, dt * steerStrength)
    c.vy += (desiredVy - c.vy) * Math.min(1, dt * steerStrength)
    c.x += c.vx * dt
    c.y += c.vy * dt
    c.trail.push({ x: c.x, y: c.y })
    if (c.trail.length > 8) c.trail.shift()

    for (let t = 1; t < c.trail.length; t++) {
      const p0 = c.trail[t - 1]!
      const p1 = c.trail[t]!
      const ratio = t / c.trail.length
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.strokeStyle = c.color
      ctx.globalAlpha = ratio * 0.65
      ctx.lineWidth = c.size * ratio * 0.95
      ctx.lineCap = 'round'
      ctx.shadowColor = c.color
      ctx.shadowBlur = 4
      ctx.stroke()
    }
    ctx.shadowBlur = 5
    ctx.shadowColor = c.color
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 0.92
    ctx.beginPath()
    ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // 6. 更新并绘制细腻星花粒子
  for (let i = spellSparks.length - 1; i >= 0; i--) {
    const sp = spellSparks[i]!
    sp.alpha -= sp.decay * dt
    if (sp.alpha <= 0) {
      spellSparks.splice(i, 1)
      continue
    }
    sp.vx *= Math.pow(0.25, dt)
    sp.vy = sp.vy * Math.pow(0.25, dt) + 60 * dt
    const prevX = sp.x
    const prevY = sp.y
    sp.x += sp.vx * dt
    sp.y += sp.vy * dt

    ctx.beginPath()
    ctx.moveTo(prevX, prevY)
    ctx.lineTo(sp.x, sp.y)
    ctx.strokeStyle = sp.color
    ctx.globalAlpha = sp.alpha * 0.85
    ctx.lineWidth = sp.size
    ctx.lineCap = 'round'
    ctx.shadowColor = sp.color
    ctx.shadowBlur = 3
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  ctx.restore()
}

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
    actionBeatTick.value = Math.floor(now / 420)

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
      const cookingList = activeCookingTargets.value
      if (!minimized.value && cookingList.length > 0) {
        // 节点正在 cook：单节点时飞到该节点旁专注施法；多节点时飞到所有节点的几何中心同时对所有节点施法
        stageAct.value = 'cast'
        activePose.value = 'cast'
        const castTarget = computeFairyCastPosition(
          cookingList,
          { width: cw, height: ch },
          facingDir.value
        )
        const hoverBobY = Math.sin(roamElapsed * 3.2) * 5
        const hoverBobX = cookingList.length >= 2 ? Math.cos(roamElapsed * 2.1) * 4 : 0
        posX.value += (castTarget.x + hoverBobX - posX.value) * 0.14
        posY.value += (castTarget.y + hoverBobY - posY.value) * 0.14
        facingDir.value = castTarget.facing
        lastX = posX.value
      } else if (!minimized.value && stageAct.value === 'edge-peek') {
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

    // 实时读取 DOM 中挥舞魔杖杖尖的精确屏幕坐标，使闪电与流光 100% 从魔杖星月尖端射出
    if (container && staffTipCircleRef.value) {
      const overlayRect = container.getBoundingClientRect()
      const tipRect = staffTipCircleRef.value.getBoundingClientRect()
      if (overlayRect.width > 0 && tipRect.width > 0) {
        liveWandPos.value = {
          x: tipRect.left - overlayRect.left + tipRect.width * 0.5,
          y: tipRect.top - overlayRect.top + tipRect.height * 0.5
        }
      }
    } else {
      liveWandPos.value = null
    }

    // 渲染 60fps 游戏级 Canvas 施法特效（分叉闪电链 / 多条不规则湍流流光 / 追踪奥术流星群 / 爆裂火花）
    renderSpellVfxFrame(now, dt, cw, ch)

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

const LANE_OFFSETS = [-10, 4, -4, 10, -14, 7] as const

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
    if (!isAnyActive.value || !visible.value) return
    spawnLuck(false)
    if (Math.random() < 0.22) {
      window.setTimeout(() => {
        if (isAnyActive.value && visible.value) spawnLuck(false)
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
  'roam',
  'cast',
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
  let tickCount = 1
  poseCycleTimer = window.setInterval(() => {
    if (
      !isAnyActive.value ||
      !visible.value ||
      comboCount.value > 0 ||
      hoveringActor.value ||
      activeCookingTargets.value.length > 0
    ) {
      return
    }
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
  const hasNodesCooking = activeCookingTargets.value.length > 0
  stageAct.value = hasNodesCooking ? 'cast' : 'roam'
  activePose.value = hasNodesCooking ? 'cast' : 'pray'
  activeExpression.value = hasNodesCooking ? 'star' : 'normal'
  displayPhase.value = 'praying'
  visible.value = true
  startRoamingLoop()
  startIdlePoseCycle()
  spawnBurstParticles(currentFairy.value.burstSymbols)
  spawnChant(false)
  scheduleLuckLoop()
  chantTimer = window.setInterval(() => {
    if (isAnyActive.value) {
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
  isAnyActive,
  (active, wasActive) => {
    if (active) {
      startPraying()
    } else if (wasActive) {
      stopPrayingWithOutcome(props.outcome === 'error' ? 'error' : 'success')
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
      <!-- 全窗口背景流星群：在画布上空快速划过 -->
      <div v-if="!minimized" class="wish-window-meteors" aria-hidden="true">
        <span class="window-meteor wm1" />
        <span class="window-meteor wm2" />
        <span class="window-meteor wm3" />
        <span class="window-meteor wm4" />
        <span class="window-meteor wm5" />
      </div>

      <!-- 60fps 游戏级 Canvas 施法特效层：加法混色渲染分叉闪电链、多条不规则湍流魔力流光、追踪奥术流星群与节点护盾电弧 -->
      <canvas
        v-show="!minimized && spellLinks.length > 0"
        ref="spellCanvasRef"
        class="wish-spell-vfx-canvas"
        aria-hidden="true"
      />

      <!-- 全画布节点施法法阵 SVG 层：负责旋转几何结界、魔杖杖尖星核与靶心双重六芒星封印 -->
      <svg
        v-if="!minimized && spellLinks.length > 0"
        class="wish-canvas-spell-layer"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="wish-sky-pillar-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0" />
            <stop offset="35%" :stop-color="currentFairy.theme.accentColor" stop-opacity="0.22" />
            <stop offset="85%" stop-color="#fde047" stop-opacity="0.45" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0.75" />
          </linearGradient>
          <filter id="wish-spell-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <!-- 多节点同时施法时：在仙子身后展开纤细轻盈的星轨环 -->
        <g
          v-if="spellLinks.length >= 2"
          class="wish-central-conflux-array"
          :transform="`translate(${wandScreenPoint.bodyCenterX}, ${wandScreenPoint.bodyCenterY})`"
        >
          <circle
            r="52"
            fill="none"
            :stroke="currentFairy.theme.accentColor"
            stroke-width="0.9"
            stroke-opacity="0.45"
            stroke-dasharray="6 5 2 5"
            class="conflux-ring-outer"
          />
          <circle
            r="38"
            fill="none"
            stroke="#fde047"
            stroke-width="0.75"
            stroke-opacity="0.4"
            stroke-dasharray="10 6"
            class="conflux-ring-inner"
          />
        </g>

        <!-- 魔杖尖端精致小巧星核 -->
        <g
          class="wish-wand-muzzle"
          :transform="`translate(${wandScreenPoint.x}, ${wandScreenPoint.y})`"
        >
          <circle
            r="9"
            :fill="currentFairy.theme.accentColor"
            fill-opacity="0.24"
            class="muzzle-pulse-outer"
          />
          <circle
            r="5.5"
            fill="none"
            stroke="#fef08a"
            stroke-width="0.9"
            stroke-dasharray="3 2.5"
            class="muzzle-spin-ring"
          />
          <circle r="2.6" fill="#ffffff" filter="url(#wish-spell-glow)" />
        </g>

        <!-- 逐个渲染每个正在执行/等待节点的靶心纤细六芒星微法阵 -->
        <g
          v-for="link in spellLinks"
          :key="link.id"
          class="wish-spell-link-group"
          :class="`mode-${link.mode}`"
        >
          <!-- 目标节点中心：纤细精致的微缩六芒星法阵 -->
          <g
            class="wish-target-impact-sigil"
            :transform="`translate(${link.targetX}, ${link.targetY})`"
          >
            <circle
              :r="link.mode === 'longRange' ? 26 : 20"
              fill="none"
              :stroke="link.mode === 'longRange' ? '#38bdf8' : '#fde047'"
              stroke-width="0.9"
              stroke-opacity="0.55"
              stroke-dasharray="6 4 2 4"
              class="target-sigil-outer"
            />
            <circle
              :r="link.mode === 'longRange' ? 17 : 13"
              fill="none"
              stroke="#f472b6"
              stroke-width="0.75"
              stroke-opacity="0.48"
              stroke-dasharray="4 3"
              class="target-sigil-inner"
            />
            <polygon
              :points="
                link.mode === 'longRange' ? '0,-15 13,7.5 -13,7.5' : '0,-11 9.5,5.5 -9.5,5.5'
              "
              fill="none"
              stroke="#fef08a"
              stroke-width="0.75"
              stroke-opacity="0.52"
              class="target-sigil-hex-a"
            />
            <polygon
              :points="
                link.mode === 'longRange' ? '0,15 13,-7.5 -13,-7.5' : '0,11 9.5,-5.5 -9.5,-5.5'
              "
              fill="none"
              stroke="#38bdf8"
              stroke-width="0.75"
              stroke-opacity="0.52"
              class="target-sigil-hex-b"
            />
            <circle
              r="6"
              fill="none"
              stroke="#ffffff"
              stroke-width="0.9"
              stroke-opacity="0.65"
              class="target-shockwave-ring"
            />
            <circle r="2.2" fill="#ffffff" filter="url(#wish-spell-glow)" />
          </g>
        </g>
      </svg>

      <!-- 目标节点头顶的实时施法状态铭牌（区分近程魔力注入 vs 远程天基星轨轰击） -->
      <div
        v-if="!minimized && spellLinks.length > 0"
        class="wish-target-hud-layer"
        aria-hidden="true"
      >
        <div
          v-for="link in spellLinks"
          :key="`hud-${link.id}`"
          class="wish-target-hud-pill"
          :class="`mode-${link.mode}`"
          :style="{
            left: `${link.targetX}px`,
            top: `${link.nodeScreenY + link.nodeScreenHeight + 10}px`
          }"
        >
          <span class="hud-icon">{{ link.mode === 'longRange' ? '☄️' : '⚡' }}</span>
          <span class="hud-label">
            {{
              link.mode === 'longRange'
                ? isEn
                  ? `Starlight Artillery · ${link.title}`
                  : `远程星轨大魔法 · ${link.title}` /* cjk-ok */
                : isEn
                  ? `Arcane Channeling · ${link.title}`
                  : `魔力持续注入 · ${link.title}` /* cjk-ok */
            }}
          </span>
        </div>
      </div>

      <!-- 在窗口内自由来回飘动的祈愿仙子主体 -->
      <div
        class="wish-roaming-actor"
        :style="{
          transform: `translate3d(${Math.round(posX)}px, ${Math.round(posY)}px, 0)`
        }"
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
          @mouseenter="onActorMouseEnter"
          @mouseleave="onActorMouseLeave"
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
            <!-- 2D 二次元全身动态蓝鲸祈福仙子本体 -->
            <div
              class="wish-anime-girl-wrap"
              :class="[
                `sprite-${activeFairySpriteKey}`,
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
              @mouseenter="onActorMouseEnter"
              @mouseleave="onActorMouseLeave"
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

              <!-- 挥杖大魔法全屏激光束与星轨光束（仅在未定向对画布节点施法时显示） -->
              <div
                v-if="
                  (effectivePose === 'cast' || displayPhase === 'crit') && spellLinks.length === 0
                "
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

              <!-- 点击爆发的主题粒子（蓝鲸 / 气泡 / 星芒 / 爱心 / 四叶草） -->
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

              <!-- 底层魔法星阵、脚底浮空符文圈与魔杖杖尖发射锚点 SVG -->
              <svg
                :key="currentFairy.id"
                class="wish-anime-girl-svg"
                viewBox="0 0 136 146"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
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
                    cx="68"
                    cy="135"
                    rx="42"
                    ry="7"
                    fill="url(#wishCloudGrad)"
                    class="girl-cloud-base"
                  />
                  <ellipse
                    cx="68"
                    cy="135"
                    rx="35"
                    ry="5.2"
                    fill="none"
                    :stroke="currentFairy.theme.accentColor"
                    stroke-width="1.3"
                    stroke-dasharray="4 3"
                    class="girl-foot-rune-ring"
                  />
                </g>

                <!-- 脑后旋转祈愿星阵光环 + 施法时暴涨的六芒星大结界 -->
                <g class="girl-halo">
                  <circle
                    cx="68"
                    cy="64"
                    r="50"
                    :stroke="currentFairy.theme.accentColor"
                    stroke-opacity="0.52"
                    stroke-width="1.4"
                    stroke-dasharray="4 5 10 5"
                  />
                  <circle
                    cx="68"
                    cy="64"
                    r="42"
                    :stroke="currentFairy.theme.wingColor"
                    stroke-opacity="0.38"
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
                      points="68,14 111,89 25,89"
                      fill="none"
                      :stroke="currentFairy.theme.accentColor"
                      stroke-opacity="0.58"
                      stroke-width="1.2"
                    />
                    <polygon
                      points="68,114 111,39 25,39"
                      fill="none"
                      :stroke="currentFairy.theme.wingColor"
                      stroke-opacity="0.58"
                      stroke-width="1.2"
                    />
                  </g>
                </g>

                <!-- 背后扑扇的半透明海洋星光精灵翼（施法/热舞/悬停时加速扑扇） -->
                <g class="girl-wings">
                  <g class="wing-left">
                    <path
                      d="M46 84C22 66 6 70 10 88C12 100 28 103 44 94Z"
                      :fill="currentFairy.theme.wingColor"
                      fill-opacity="0.48"
                      stroke="#FFFFFF"
                      stroke-opacity="0.78"
                      stroke-width="1.1"
                    />
                    <path
                      d="M45 94C27 96 16 106 22 116C28 123 39 116 47 102Z"
                      :fill="currentFairy.theme.accentColor"
                      fill-opacity="0.38"
                      stroke="#FFFFFF"
                      stroke-opacity="0.65"
                      stroke-width="0.9"
                    />
                  </g>
                  <g class="wing-right">
                    <path
                      d="M90 84C114 66 130 70 126 88C124 100 108 103 92 94Z"
                      :fill="currentFairy.theme.wingColor"
                      fill-opacity="0.48"
                      stroke="#FFFFFF"
                      stroke-opacity="0.78"
                      stroke-width="1.1"
                    />
                    <path
                      d="M91 94C109 96 120 106 114 116C108 123 97 116 89 102Z"
                      :fill="currentFairy.theme.accentColor"
                      fill-opacity="0.38"
                      stroke="#FFFFFF"
                      stroke-opacity="0.65"
                      stroke-width="0.9"
                    />
                  </g>
                </g>

                <!-- 魔杖星芒杖尖发射锚点（对齐 2D 立绘星芒魔杖杖头） -->
                <g
                  class="girl-right-arm-wave"
                  :style="{
                    transformOrigin: `${wandTipSvgCoord.pivotX}px ${wandTipSvgCoord.pivotY}px`
                  }"
                >
                  <circle
                    ref="staffTipCircleRef"
                    :cx="wandTipSvgCoord.x"
                    :cy="wandTipSvgCoord.y"
                    r="8"
                    fill="url(#wishOrbGrad)"
                    :fill-opacity="activeFairySpriteKey === 'casting' ? 0.55 : 0.14"
                    class="pray-orb"
                  />
                  <circle
                    v-if="activeFairySpriteKey === 'casting' || effectivePose === 'dance'"
                    :cx="wandTipSvgCoord.x"
                    :cy="wandTipSvgCoord.y"
                    r="7.5"
                    fill="none"
                    :stroke="currentFairy.theme.accentColor"
                    stroke-width="0.9"
                    stroke-opacity="0.65"
                    stroke-dasharray="2.5 2.5"
                    class="staff-tip-ring"
                    :style="{
                      transformOrigin: `${wandTipSvgCoord.x}px ${wandTipSvgCoord.y}px`
                    }"
                  />
                </g>
              </svg>

              <!-- 高清透明 2D 二次元蓝鲸仙子立绘舞台（支持呆毛摇摆、蓝鲸鳍耳抖动、多帧热舞、360°回旋与思考转圈） -->
              <div class="wish-anime-girl-stage" aria-hidden="true">
                <div class="wish-sprite-flip-container" :class="{ 'flip-x': spriteFlipX }">
                  <!-- 1. 主体基础立绘层 -->
                  <img
                    class="wish-anime-girl-sprite base-layer"
                    :src="activeFairySpriteSrc"
                    :alt="currentFairy.titleZh"
                    draggable="false"
                  />

                  <!-- 2. 独立骨骼动画层：头顶呆毛随风摇摆 (Ahoge Sway) -->
                  <img
                    class="wish-anime-girl-sprite part-ahoge"
                    :src="activeFairySpriteSrc"
                    alt=""
                    draggable="false"
                  />

                  <!-- 3. 独立骨骼动画层：左侧蓝鲸鳍耳灵动扇动 (Left Whale Fin Ear Twitch) -->
                  <img
                    class="wish-anime-girl-sprite part-ear-left"
                    :src="activeFairySpriteSrc"
                    alt=""
                    draggable="false"
                  />

                  <!-- 4. 独立骨骼动画层：右侧蓝鲸鳍耳灵动扇动 (Right Whale Fin Ear Twitch) -->
                  <img
                    class="wish-anime-girl-sprite part-ear-right"
                    :src="activeFairySpriteSrc"
                    alt=""
                    draggable="false"
                  />
                </div>

                <!-- 思考态专属：还原原画额头刘海正中央的 12 辐旋转 Loading 菊花圈 -->
                <svg
                  v-if="activeFairySpriteKey === 'thinking'"
                  class="fairy-forehead-spinner"
                  viewBox="0 0 40 40"
                >
                  <g class="spinner-spokes" transform="translate(20, 20)">
                    <line
                      v-for="idx in 12"
                      :key="idx"
                      x1="0"
                      y1="-8.5"
                      x2="0"
                      y2="-15.5"
                      stroke="currentColor"
                      stroke-width="2.9"
                      stroke-linecap="round"
                      :transform="`rotate(${(idx - 1) * 30})`"
                      :opacity="(0.22 + (idx / 12) * 0.78).toFixed(2)"
                    />
                  </g>
                </svg>

                <!-- 思考态专属：头顶左上角呆萌漫画思考云朵气泡「正在思考....」 -->
                <div
                  v-if="activeFairySpriteKey === 'thinking' && comboCount === 0"
                  class="fairy-thinking-cloud"
                >
                  <span class="cloud-body">{{
                    isEn ? 'Thinking....' : '正在思考....' /* cjk-ok */
                  }}</span>
                  <span class="cloud-dot d1" />
                  <span class="cloud-dot d2" />
                </div>

                <!-- 报错委屈态专属：双眼两侧持续飙出的动态泪珠流 -->
                <div v-if="activeFairySpriteKey === 'error'" class="fairy-error-tears">
                  <span class="teardrop t-left">💧</span>
                  <span class="teardrop t-right">💧</span>
                </div>

                <!-- 念咒说话时嘴边欢快跳出的小音符 -->
                <div v-if="mouthTalking || displayPhase === 'crit'" class="fairy-talk-notes">
                  <span class="talk-note tn1">♪</span>
                  <span class="talk-note tn2">✦</span>
                </div>
              </div>

              <!-- 仙子侧边悬浮快捷图标栏（动作切换 / 切换仙子） -->
              <div
                class="fairy-side-actions"
                @mouseenter="onActorMouseEnter"
                @mouseleave="onActorMouseLeave"
                @click.stop
              >
                <button
                  type="button"
                  class="wish-switch-fairy-btn act-btn"
                  :title="
                    isEn
                      ? 'Trigger Magic / Dance / Window Peek / Spin'
                      : '切换炫酷动作（挥杖施法 / 律动热舞 / 窗边躲猫猫 / 360°回旋）' /* cjk-ok */
                  "
                  :aria-label="
                    isEn
                      ? 'Trigger Magic / Dance / Window Peek / Spin'
                      : '切换炫酷动作（挥杖施法 / 律动热舞 / 窗边躲猫猫 / 360°回旋）' /* cjk-ok */
                  "
                  @pointerdown.stop
                  @click.stop="onCycleStageAct"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M3 13L10.8 5.2M11.5 2L12.1 3.7L13.8 4.3L12.1 4.9L11.5 6.6L10.9 4.9L9.2 4.3L10.9 3.7L11.5 2ZM5.2 2.2L5.5 3.1L6.4 3.4L5.5 3.7L5.2 4.6L4.9 3.7L4 3.4L4.9 3.1L5.2 2.2Z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="wish-switch-fairy-btn"
                  :title="switchFairyTooltip"
                  :aria-label="switchFairyTooltip"
                  @pointerdown.stop
                  @click.stop="onCycleFairy"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M3 5.5H12.5M12.5 5.5L10 3M12.5 5.5L10 8M13 10.5H3.5M3.5 10.5L6 8M3.5 10.5L6 13"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
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

          <!-- 仙子身下悬浮的轻巧祈愿铭牌（点按攒欧气 + 一键折叠） -->
          <div
            class="sprite-foot-ribbon"
            @mouseenter="onActorMouseEnter"
            @mouseleave="onActorMouseLeave"
            @click="onBlessClick"
          >
            <span class="ribbon-status">{{ ribbonBadgeText }}</span>
            <span class="ribbon-karma" :class="{ bump: karmaBump }">
              {{ isEn ? `✨ Luck ${luckTotalText}` : `✨ 欧气 ${luckTotalText}` /* cjk-ok */ }}
            </span>
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
/* 覆盖整个节点画布视口，本身不拦截鼠标滚动与点击 */
.wish-shrine-overlay {
  position: absolute;
  inset: 0;
  z-index: 16;
  pointer-events: none;
  overflow: hidden;
}

/* ── 60fps 游戏级 Canvas 施法特效层（分叉闪电链 + 湍流流光丝带 + 追踪奥术流星群） ── */
.wish-spell-vfx-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}

/* ── 全画布节点施法 SVG 特效层（旋转法阵结界 + 魔杖聚能核 + 靶心双重六芒星） ── */
.wish-canvas-spell-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 3;
  pointer-events: none;
  overflow: visible;
}

.wish-roaming-actor {
  position: relative;
  z-index: 4;
}

.conflux-ring-outer {
  animation: wish-halo-spin 8s linear infinite;
}

.conflux-ring-inner {
  animation: wish-halo-spin-reverse 5.5s linear infinite;
}

.conflux-hex-a {
  animation: wish-halo-spin 10s linear infinite;
}

.conflux-hex-b {
  animation: wish-halo-spin-reverse 10s linear infinite;
}

.muzzle-pulse-outer {
  animation: wish-spell-muzzle-pulse 0.75s ease-in-out infinite alternate;
}

.muzzle-spin-ring {
  animation: wish-halo-spin 2.4s linear infinite;
}

.target-node-aura-rect {
  animation: wish-dash-march 1.1s linear infinite;
  filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.65));
}

.orbital-pillar-column {
  animation: wish-pillar-throb 0.65s ease-in-out infinite alternate;
}

.orbital-pillar-core {
  animation: wish-dash-fall 0.45s linear infinite;
}

.spell-helix-ribbon.ribbon-a {
  animation: wish-dash-march 0.6s linear infinite;
}

.spell-helix-ribbon.ribbon-b {
  animation: wish-dash-march 0.78s linear infinite reverse;
}

.spell-beam-rune-pulse {
  animation: wish-dash-march 0.42s linear infinite;
}

.target-sigil-outer {
  animation: wish-halo-spin 4.2s linear infinite;
}

.target-sigil-inner {
  animation: wish-halo-spin-reverse 2.8s linear infinite;
}

.target-sigil-hex-a {
  animation: wish-halo-spin 6s linear infinite;
}

.target-sigil-hex-b {
  animation: wish-halo-spin-reverse 6s linear infinite;
}

.target-shockwave-ring {
  animation: wish-target-shockwave 1.1s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

/* ── 目标节点头顶的实时施法状态铭牌 ── */
.wish-target-hud-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}

.wish-target-hud-pill {
  position: absolute;
  transform: translate(-50%, 0);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2.5px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  color: #fef08a;
  background: linear-gradient(135deg, rgba(24, 16, 56, 0.92), rgba(76, 29, 149, 0.9));
  border: 1px solid rgba(250, 204, 21, 0.72);
  box-shadow:
    0 4px 14px rgba(15, 10, 40, 0.55),
    0 0 12px rgba(250, 204, 21, 0.42);
}

.wish-target-hud-pill.mode-longRange {
  color: #e0f2fe;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(88, 28, 135, 0.92));
  border-color: rgba(56, 189, 248, 0.85);
  box-shadow:
    0 4px 16px rgba(15, 10, 40, 0.65),
    0 0 16px rgba(56, 189, 248, 0.6);
}

@keyframes wish-halo-spin-reverse {
  from {
    transform: rotate(360deg);
  }
  to {
    transform: rotate(0deg);
  }
}

@keyframes wish-dash-march {
  from {
    stroke-dashoffset: 64;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes wish-dash-fall {
  from {
    stroke-dashoffset: 36;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes wish-pillar-throb {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 0.95;
  }
}

@keyframes wish-spell-muzzle-pulse {
  from {
    transform: scale(0.85);
    opacity: 0.65;
  }
  to {
    transform: scale(1.25);
    opacity: 1;
  }
}

@keyframes wish-target-shockwave {
  0% {
    transform: scale(0.5);
    opacity: 0.95;
  }
  100% {
    transform: scale(3.4);
    opacity: 0;
  }
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

/* ── 2D 二次元蓝鲸祈福仙子容器（外层作为绝对稳定的固定点击热区，不做位移/旋转以彻底杜绝悬停边界抖动） ── */
.wish-anime-girl-wrap {
  position: relative;
  z-index: 3;
  width: 128px;
  height: 138px;
  flex-shrink: 0;
  cursor: pointer;
  pointer-events: auto;
  border-radius: 28px;
  background: radial-gradient(
    circle at 50% 50%,
    var(--fairy-glow, rgba(56, 189, 248, 0.38)) 0%,
    rgba(59, 130, 246, 0.18) 54%,
    rgba(30, 22, 74, 0) 74%
  );
  filter: drop-shadow(0 6px 16px rgba(15, 10, 40, 0.55))
    drop-shadow(0 0 12px var(--fairy-glow, rgba(56, 189, 248, 0.42)));
}

.wish-anime-girl-wrap.is-hovered .wish-anime-girl-svg,
.wish-anime-girl-wrap.is-hovered .wish-anime-girl-stage {
  scale: 1.07;
}

/* 窗口边缘躲藏探头模式（作用在 pointer-events: none 的内部图层上，不影响外层热区盒） */
.wish-anime-girl-wrap.is-edge-peeking.edge-left .wish-anime-girl-svg,
.wish-anime-girl-wrap.is-edge-peeking.edge-left .wish-anime-girl-stage {
  animation: wish-edge-peek-left 1.4s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.is-edge-peeking.edge-right .wish-anime-girl-svg,
.wish-anime-girl-wrap.is-edge-peeking.edge-right .wish-anime-girl-stage {
  animation: wish-edge-peek-right 1.4s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.bounce .wish-anime-girl-svg,
.wish-anime-girl-wrap.bounce .wish-anime-girl-stage {
  animation: wish-girl-squish 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-anime-girl-wrap.pose-spin .wish-anime-girl-svg,
.wish-anime-girl-wrap.pose-spin .wish-anime-girl-stage,
.wish-anime-girl-wrap.act-spin .wish-anime-girl-svg,
.wish-anime-girl-wrap.act-spin .wish-anime-girl-stage {
  animation: wish-girl-twirl 1.05s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
}

.wish-anime-girl-wrap.pose-cheer .wish-anime-girl-svg,
.wish-anime-girl-wrap.pose-cheer .wish-anime-girl-stage,
.wish-anime-girl-wrap.sprite-success .wish-anime-girl-svg,
.wish-anime-girl-wrap.sprite-success .wish-anime-girl-stage {
  animation: wish-girl-hop 0.44s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.pose-dance .wish-anime-girl-svg,
.wish-anime-girl-wrap.pose-dance .wish-anime-girl-stage,
.wish-anime-girl-wrap.act-dance .wish-anime-girl-svg,
.wish-anime-girl-wrap.act-dance .wish-anime-girl-stage {
  animation: wish-girl-idol-dance 0.42s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.pose-cast .wish-anime-girl-svg,
.wish-anime-girl-wrap.pose-cast .wish-anime-girl-stage,
.wish-anime-girl-wrap.sprite-casting .wish-anime-girl-svg,
.wish-anime-girl-wrap.sprite-casting .wish-anime-girl-stage {
  animation: wish-girl-cast-levitate 0.78s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.sprite-thinking .wish-anime-girl-stage {
  animation: wish-girl-think-tilt 1.8s ease-in-out infinite alternate;
}

.wish-anime-girl-wrap.sprite-error .wish-anime-girl-stage {
  animation: wish-girl-error-shiver 0.28s ease-in-out infinite alternate;
}

.wish-anime-girl-svg {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  transition: scale 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: wish-girl-float 2s ease-in-out infinite alternate;
}

/* ── 2D 二次元高清透明立绘舞台层（含多部件独立骨骼动画） ── */
.wish-anime-girl-stage {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
  transition: scale 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: wish-girl-float 2s ease-in-out infinite alternate;
}

.wish-sprite-flip-container {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-sprite-flip-container.flip-x {
  transform: scaleX(-1);
}

.wish-anime-girl-wrap.talking .wish-sprite-flip-container {
  animation: wish-girl-talk-nod 0.19s ease-in-out infinite alternate;
}

.wish-anime-girl-sprite {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  user-select: none;
}

.wish-anime-girl-sprite.base-layer {
  filter: drop-shadow(0 4px 10px rgba(15, 23, 42, 0.42));
}

/* 独立骨骼动画层 1：头顶呆毛随风摇摆 */
.wish-anime-girl-sprite.part-ahoge {
  clip-path: ellipse(22% 10% at 52% 7%);
  transform-origin: 52% 15%;
  animation: wish-part-ahoge-sway 1.05s ease-in-out infinite alternate;
}

/* 独立骨骼动画层 2：左侧蓝鲸鳍耳灵动扑扇 */
.wish-anime-girl-sprite.part-ear-left {
  clip-path: ellipse(15% 13% at 13% 49%);
  transform-origin: 24% 46%;
  animation: wish-part-ear-left 1.35s ease-in-out infinite alternate;
}

/* 独立骨骼动画层 3：右侧蓝鲸鳍耳灵动扑扇 */
.wish-anime-girl-sprite.part-ear-right {
  clip-path: ellipse(15% 13% at 87% 44%);
  transform-origin: 76% 43%;
  animation: wish-part-ear-right 1.35s ease-in-out infinite alternate;
}

/* 报错委屈态：双眼两侧持续流下的动态泪珠 */
.fairy-error-tears {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}

.fairy-error-tears .teardrop {
  position: absolute;
  top: 46%;
  font-size: 12px;
  filter: drop-shadow(0 0 4px #38bdf8);
  animation: wish-teardrop-fall 0.72s ease-in infinite;
}

.fairy-error-tears .teardrop.t-left {
  left: 24%;
}

.fairy-error-tears .teardrop.t-right {
  right: 24%;
  animation-delay: 0.36s;
}

/* 念咒说话时嘴角跃出的发光小音符 */
.fairy-talk-notes {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}

.fairy-talk-notes .talk-note {
  position: absolute;
  right: 18%;
  top: 52%;
  font-size: 12px;
  font-weight: 900;
  color: #fde047;
  text-shadow: 0 0 6px #38bdf8;
  animation: wish-mouth-ripple 0.68s ease-out infinite;
}

.fairy-talk-notes .talk-note.tn2 {
  right: 10%;
  top: 46%;
  color: #f472b6;
  animation-delay: 0.32s;
}

/* 还原参考图标志性：蓝鲸仙子思考态额头正中央旋转的 12 辐 Loading 圈 */
.fairy-forehead-spinner {
  position: absolute;
  left: 50%;
  top: 29%;
  width: 30px;
  height: 30px;
  transform: translate(-50%, -50%);
  color: rgba(248, 250, 252, 0.92);
  filter: drop-shadow(0 1px 3px rgba(15, 23, 42, 0.72));
  pointer-events: none;
  z-index: 3;
}

.fairy-forehead-spinner .spinner-spokes {
  animation: wish-forehead-spin 1s steps(12, end) infinite;
}

/* 还原参考图标志性：左上角二次元漫画思考云朵气泡「正在思考....」 */
.fairy-thinking-cloud {
  position: absolute;
  top: -10px;
  left: -26px;
  z-index: 4;
  pointer-events: none;
  animation: wish-callout-bob 1.1s ease-in-out infinite alternate;
}

.fairy-thinking-cloud .cloud-body {
  display: inline-block;
  padding: 2.5px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.2px;
  white-space: nowrap;
  color: #1e293b;
  background: #ffffff;
  border: 1.8px solid #1e293b;
  box-shadow: 0 3px 8px rgba(15, 23, 42, 0.32);
}

.fairy-thinking-cloud .cloud-dot {
  position: absolute;
  background: #ffffff;
  border: 1.6px solid #1e293b;
  border-radius: 50%;
}

.fairy-thinking-cloud .cloud-dot.d1 {
  width: 6px;
  height: 6px;
  right: 14px;
  bottom: -6px;
}

.fairy-thinking-cloud .cloud-dot.d2 {
  width: 4.5px;
  height: 4.5px;
  right: 8px;
  bottom: -11px;
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
  transform-origin: 68px 64px;
  animation: wish-halo-spin 12s linear infinite;
}

/* 精灵蝶翼扑扇 */
.wing-left {
  transform-origin: 46px 88px;
  animation: wish-wing-flap-left 0.34s ease-in-out infinite alternate;
}
.wing-right {
  transform-origin: 90px 88px;
  animation: wish-wing-flap-right 0.34s ease-in-out infinite alternate;
}

/* 挥手与巨型魔法杖手臂大幅度摆动（带动杖尖发射点同步挥舞） */
.girl-right-arm-wave {
  animation: wish-arm-wave 0.55s ease-in-out infinite alternate;
}
.wish-anime-girl-wrap.pose-cast .girl-right-arm-wave,
.wish-anime-girl-wrap.sprite-casting .girl-right-arm-wave {
  animation: wish-staff-cast-sweep 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) infinite alternate;
}
.wish-anime-girl-wrap.pose-dance .girl-right-arm-wave,
.wish-anime-girl-wrap.act-dance .girl-right-arm-wave {
  animation: wish-staff-dance-wave 0.42s ease-in-out infinite alternate;
}

/* 杖尖召唤法阵、流光丝带与脚底符文圈 */
.staff-tip-ring {
  transform-origin: 109px 34px;
  animation: wish-halo-spin 3.2s linear infinite;
}
.staff-streamer {
  transform-origin: 108px 42px;
  animation: wish-tail-wag 0.62s ease-in-out infinite alternate;
}
.girl-wand-ribbon-trail {
  animation: wish-ribbon-dash 0.7s linear infinite;
  filter: drop-shadow(0 0 6px var(--fairy-accent, #fde047));
}
.girl-foot-rune-ring {
  transform-origin: 68px 135px;
  animation: wish-orb-pulse 0.9s ease-in-out infinite alternate;
}
.girl-grand-hexagram {
  transform-origin: 68px 64px;
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

.fairy-side-actions {
  position: absolute;
  right: -10px;
  bottom: 10px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 5px;
  pointer-events: auto;
}

.wish-switch-fairy-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fef08a;
  background: linear-gradient(135deg, rgba(88, 28, 135, 0.88), rgba(168, 85, 247, 0.72));
  border: 1px solid rgba(250, 204, 21, 0.65);
  box-shadow: 0 2px 8px rgba(15, 10, 40, 0.55);
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
  width: 16px;
  height: 16px;
  margin-left: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  opacity: 0.78;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.35);
  cursor: pointer;
  padding: 0;
  transition:
    opacity 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.wish-minimize-btn:hover,
.wish-minimize-btn:focus-visible {
  opacity: 1;
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
    transform: translateY(2.5px) scale(1.01, 0.99);
  }
  100% {
    transform: translateY(-5.5px) scale(0.995, 1.012);
  }
}

@keyframes wish-girl-think-tilt {
  0% {
    transform: translateY(2px) rotate(-4deg) scale(1.01, 0.99);
  }
  50% {
    transform: translateY(-4px) rotate(0deg) scale(0.99, 1.015);
  }
  100% {
    transform: translateY(2px) rotate(4deg) scale(1.01, 0.99);
  }
}

@keyframes wish-girl-talk-nod {
  0% {
    transform: translateY(0) scaleY(1);
  }
  100% {
    transform: translateY(-2.5px) scaleY(1.025);
  }
}

@keyframes wish-part-ahoge-sway {
  0% {
    transform: rotate(-9deg) translateX(-1px);
  }
  100% {
    transform: rotate(10deg) translateX(1.5px);
  }
}

@keyframes wish-part-ear-left {
  0%,
  35% {
    transform: rotate(0deg) scaleY(1);
  }
  100% {
    transform: rotate(-10deg) translateY(-1.5px) scaleY(1.05);
  }
}

@keyframes wish-part-ear-right {
  0%,
  35% {
    transform: rotate(0deg) scaleY(1);
  }
  100% {
    transform: rotate(10deg) translateY(-1.5px) scaleY(1.05);
  }
}

@keyframes wish-part-wand-wave {
  0% {
    transform: rotate(-12deg) translateY(2px) scale(1.02);
  }
  100% {
    transform: rotate(14deg) translateY(-3px) scale(1.06);
  }
}

@keyframes wish-teardrop-fall {
  0% {
    opacity: 0;
    transform: translateY(-2px) scale(0.6);
  }
  30% {
    opacity: 1;
    transform: translateY(4px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(18px) scale(0.75);
  }
}

@keyframes wish-forehead-spin {
  from {
    transform: translate(20px, 20px) rotate(0deg);
  }
  to {
    transform: translate(20px, 20px) rotate(360deg);
  }
}

@keyframes wish-girl-error-shiver {
  0% {
    transform: translateX(-2.5px) translateY(1px) rotate(-2deg);
  }
  100% {
    transform: translateX(2.5px) translateY(-1px) rotate(2deg);
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
    transform: rotate(-3deg) scale(1);
  }
  100% {
    transform: rotate(3deg) scale(1.02);
  }
}

@keyframes wish-staff-dance-wave {
  0% {
    transform: rotate(-5deg);
  }
  100% {
    transform: rotate(5deg);
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
