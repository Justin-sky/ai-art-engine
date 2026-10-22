<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  detectWishPromptCategory,
  formatLuckTotal,
  pickNextWishChant,
  rollLuckGain,
  type WishChantCategory,
  type WishFloatingChant,
  type WishLuckPopup,
  type WishShrinePhase
} from '@shared/chatWishShrine'

const props = defineProps<{
  running: boolean
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

/** 窗口内自由来回飘动坐标（px）与朝向 */
const overlayRef = ref<HTMLElement | null>(null)
const posX = ref(48)
const posY = ref(64)
const facingDir = ref<'right' | 'left'>('right')

let roamRafId: number | null = null
let roamStartTime = 0
let roamPhaseOffset = Math.random() * Math.PI * 2
let lastX = 48

let chantTimer: number | null = null
let luckTimer: number | null = null
let karmaBumpTimer: number | null = null
let mouthTimer: number | null = null
let hideTimer: number | null = null
let critPhaseTimer: number | null = null
let bounceTimer: number | null = null
let chantSeq = 0
let luckSeq = 0
let stepIndex = 0

const promptCategory = computed<WishChantCategory>(() =>
  detectWishPromptCategory(props.promptText ?? '')
)

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
 * 启动窗口内平滑巡游动画（Lissajous 8 字形 + 柔和水波漂浮轨迹），
 * 自动感知聊天面板宽高并在面板安全边距内上下左右来回飘动。
 */
function startRoamingLoop(): void {
  stopRoamingLoop()
  roamStartTime = performance.now()
  roamPhaseOffset = Math.random() * Math.PI * 2

  const step = (now: number): void => {
    if (!visible.value) return
    const container = overlayRef.value
    const cw = container?.clientWidth || 380
    const ch = container?.clientHeight || 520

    // 为右侧飘出的咒语气泡预留安全宽度，避免贴边被裁切
    const actorW = minimized.value ? 180 : 250
    const actorH = minimized.value ? 48 : 150
    const minX = 16
    const maxX = Math.max(minX + 20, cw - actorW - 16)
    // 顶部留出欧气飘字上升的空间
    const minY = minimized.value ? 40 : 60
    const maxY = Math.max(minY + 30, ch - actorH - 28)

    // 悬停时减缓飘动速度，方便用户连点攒欧气
    const speedFactor = hoveringActor.value ? 0.18 : 1
    const elapsed = ((now - roamStartTime) / 1000) * speedFactor + roamPhaseOffset

    // 双频正弦合成来回巡游轨迹：覆盖左中右与上中下区域
    const normX = 0.5 + 0.46 * Math.sin(elapsed * 0.55) * Math.cos(elapsed * 0.19)
    const normY = 0.45 + 0.42 * Math.sin(elapsed * 0.37 + 1.1)

    const targetX = minX + normX * (maxX - minX)
    const targetY = minY + normY * (maxY - minY)

    posX.value += (targetX - posX.value) * 0.06
    posY.value += (targetY - posY.value) * 0.06

    const dx = posX.value - lastX
    if (Math.abs(dx) > 0.15) {
      facingDir.value = dx >= 0 ? 'right' : 'left'
    }
    lastX = posX.value

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
}

function spawnChant(critical = false): void {
  const picked = pickNextWishChant({
    category: promptCategory.value,
    stepIndex: stepIndex++,
    isEn: props.isEn,
    critical
  })
  const uid = ++chantSeq
  const laneOffsetY = LANE_OFFSETS[uid % LANE_OFFSETS.length] ?? 0
  const durationMs = critical ? 2800 : 3100
  const item: WishFloatingChant = {
    uid,
    id: picked.id,
    text: picked.text,
    tone: picked.tone,
    critical: picked.critical,
    laneOffsetY,
    durationMs
  }
  latestChantText.value = picked.text
  activeChants.value = [...activeChants.value.slice(-4), item]

  // 触发二次元娘张嘴念咒动作
  mouthTalking.value = true
  if (mouthTimer !== null) window.clearTimeout(mouthTimer)
  mouthTimer = window.setTimeout(() => {
    mouthTalking.value = false
  }, 420)

  window.setTimeout(() => {
    activeChants.value = activeChants.value.filter((c) => c.uid !== uid)
  }, durationMs)
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** 掷一次欧气并从头顶弹出伤害数字式飘字；返回本次档位 */
function spawnLuck(boost = false): WishLuckPopup['tier'] {
  const roll = rollLuckGain({ boost })
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
  // 下一帧再加 class，保证连续触发时动画能重播
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

/** 祈愿进行中：以随机间隔持续自动飘欧气（不等距，更像连续打击） */
function scheduleLuckLoop(): void {
  stopLuckLoop()
  const tick = (): void => {
    if (!props.running || !visible.value) return
    // 偶尔来一个双连击
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

function startPraying(): void {
  clearTimers()
  stepIndex = 0
  luckTotal.value = 0
  displayedLuck.value = 0
  luckPopups.value = []
  activeChants.value = []
  displayPhase.value = 'praying'
  visible.value = true
  startRoamingLoop()
  // 立即从口中飘出第一句核心咒语（“不报错！绝不报红！”）
  spawnChant(false)
  scheduleLuckLoop()
  chantTimer = window.setInterval(() => {
    if (props.running) {
      spawnChant(false)
    }
  }, 1250)
}

function stopPrayingWithOutcome(outcome: 'idle' | 'success' | 'error'): void {
  if (chantTimer !== null) {
    window.clearInterval(chantTimer)
    chantTimer = null
  }
  stopLuckLoop()
  if (!visible.value) return
  if (outcome === 'error') {
    displayPhase.value = 'error'
    latestChantText.value = props.isEn
      ? '💦 Mana fluctuated... checking logs!'
      : '💦 呜哇…法力波动了！' // cjk-ok
  } else {
    displayPhase.value = 'success'
    latestChantText.value = props.isEn ? '✌️ Wish Granted! All Green!' : '✌️ 许愿灵验！功德圆满！' // cjk-ok
  }
  hideTimer = window.setTimeout(() => {
    visible.value = false
    displayPhase.value = 'idle'
    activeChants.value = []
    stopRoamingLoop()
  }, 1150)
}

/** 用户点击二次元祈祷娘或护身符：触发 Q 弹反馈 + 随机欧气飘字（暴击时金色咒语） */
function onBlessClick(): void {
  if (!visible.value) return
  girlBounce.value = true
  if (bounceTimer !== null) window.clearTimeout(bounceTimer)
  bounceTimer = window.setTimeout(() => {
    girlBounce.value = false
  }, 360)

  const tier = spawnLuck(true)
  if (props.running && tier === 'crit') {
    displayPhase.value = 'crit'
    spawnChant(true)
    if (critPhaseTimer !== null) window.clearTimeout(critPhaseTimer)
    critPhaseTimer = window.setTimeout(() => {
      if (props.running) displayPhase.value = 'praying'
    }, 900)
  }
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
  if (displayPhase.value === 'success') {
    return props.isEn ? '✌️ Wish Granted!' : '✌️ 许愿灵验！' // cjk-ok
  }
  if (displayPhase.value === 'error') {
    return props.isEn ? '💦 Mana Backfire' : '💦 法力波动' // cjk-ok
  }
  if (displayPhase.value === 'crit') {
    return props.isEn ? '🌟 SSR Luck Crit!' : '🌟 欧气暴击！' // cjk-ok
  }
  return props.isEn ? '🙏 Wishing...' : '🙏 虔诚祈愿中' // cjk-ok
})

const blessTooltip = computed(
  () =>
    props.isEn
      ? 'Click the floating shrine maiden to roll luck — crits spawn a golden chant!'
      : '点击飘动中的二次元祈祷娘掷欧气，暴击时从口中喷出金色咒语！' // cjk-ok
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
      :class="[`phase-${displayPhase}`, { minimized }]"
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
        <div v-if="minimized" class="wish-shrine-mini-pill" @click="onBlessClick">
          <span class="mini-pray-icon" aria-hidden="true">🙏</span>
          <span class="mini-meteor-spark" aria-hidden="true">🌠</span>
          <span class="mini-chant-text">{{ latestChantText }}</span>
          <span class="mini-karma-badge" :class="{ bump: karmaBump }">
            {{ isEn ? `Luck ${luckTotalText}` : `欧气 ${luckTotalText}` /* cjk-ok */ }}
          </span>
          <button
            type="button"
            class="mini-expand-btn"
            :title="isEn ? 'Expand Wish Maiden' : '展开二次元祈祷娘' /* cjk-ok */"
            @click.stop="toggleMinimized"
          >
            ▾
          </button>
        </div>

        <!-- 展开态：环绕流星光环的无框二次元祈祷娘 + 口中飘出咒语气泡 -->
        <div v-else class="wish-sprite-scene">
          <!-- 环绕二次元娘身周的局部快速流星与星尘 -->
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
            <!-- 双手合十二次元祈祷娘本体 -->
            <div
              class="wish-anime-girl-wrap"
              :class="{
                bounce: girlBounce,
                talking: mouthTalking,
                'face-left': facingDir === 'left'
              }"
              :title="blessTooltip"
              @click="onBlessClick"
            >
              <svg
                class="wish-anime-girl-svg"
                viewBox="0 0 120 130"
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
                    <stop offset="0%" stop-color="#FFB3D9" />
                    <stop offset="45%" stop-color="#F48FD8" />
                    <stop offset="100%" stop-color="#A78BFA" />
                  </linearGradient>
                  <linearGradient
                    id="wishHairShade"
                    x1="60"
                    y1="14"
                    x2="60"
                    y2="110"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stop-color="#E879C9" />
                    <stop offset="100%" stop-color="#7C3AED" />
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
                    <stop offset="0%" stop-color="#3B0764" />
                    <stop offset="45%" stop-color="#9333EA" />
                    <stop offset="80%" stop-color="#EC4899" />
                    <stop offset="100%" stop-color="#FBCFE8" />
                  </linearGradient>
                  <linearGradient
                    id="wishOutfitGrad"
                    x1="60"
                    y1="88"
                    x2="60"
                    y2="124"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stop-color="#FFFFFF" />
                    <stop offset="100%" stop-color="#E9E3FF" />
                  </linearGradient>
                  <linearGradient id="wishRibbonGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#FF6FA8" />
                    <stop offset="100%" stop-color="#E11D74" />
                  </linearGradient>
                  <radialGradient id="wishOrbGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#FEF08A" stop-opacity="0.95" />
                    <stop offset="55%" stop-color="#F472B6" stop-opacity="0.5" />
                    <stop offset="100%" stop-color="#A855F7" stop-opacity="0" />
                  </radialGradient>
                  <radialGradient id="wishCloudGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#F0ABFC" stop-opacity="0.6" />
                    <stop offset="65%" stop-color="#818CF8" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="#312E81" stop-opacity="0" />
                  </radialGradient>
                </defs>

                <!-- 脚下托举的星云浮空底座 -->
                <ellipse
                  cx="60"
                  cy="124"
                  rx="38"
                  ry="6.5"
                  fill="url(#wishCloudGrad)"
                  class="girl-cloud-base"
                />

                <!-- 脑后旋转祈愿星阵光环 -->
                <g class="girl-halo">
                  <circle
                    cx="60"
                    cy="54"
                    r="47"
                    stroke="#FACC15"
                    stroke-opacity="0.5"
                    stroke-width="1.4"
                    stroke-dasharray="4 6"
                  />
                  <circle
                    cx="60"
                    cy="54"
                    r="41"
                    stroke="#F9A8D4"
                    stroke-opacity="0.4"
                    stroke-width="1"
                  />
                </g>

                <!-- 双马尾（随风摆动）+ 后发 -->
                <path
                  class="girl-twintail-left"
                  d="M30 34C13 38 7 57 11 77C14 92 9 106 3 117C17 115 26 101 26 86C26 72 24 56 34 45Z"
                  fill="url(#wishHairShade)"
                />
                <path
                  class="girl-twintail-right"
                  d="M90 34C107 38 113 57 109 77C106 92 111 106 117 117C103 115 94 101 94 86C94 72 96 56 86 45Z"
                  fill="url(#wishHairShade)"
                />
                <path
                  d="M60 14C34 14 22 34 23 58C24 78 22 92 17 102C29 102 36 96 40 88L80 88C84 96 91 102 103 102C98 92 96 78 97 58C98 34 86 14 60 14Z"
                  fill="url(#wishHairShade)"
                />

                <!-- 巫女服：白色上衣 + 宽袖 + 绯色裙摆 -->
                <path
                  d="M37 124C37 101 45 89 60 89C75 89 83 101 83 124Z"
                  fill="url(#wishOutfitGrad)"
                />
                <path
                  d="M39 97C29 103 25 114 27 124L45 124C43 113 45 105 49 99Z"
                  fill="#FFFFFF"
                  stroke="#DDD6FE"
                  stroke-width="1"
                />
                <path
                  d="M81 97C91 103 95 114 93 124L75 124C77 113 75 105 71 99Z"
                  fill="#FFFFFF"
                  stroke="#DDD6FE"
                  stroke-width="1"
                />
                <path d="M38 117L82 117L84 125L36 125Z" fill="url(#wishRibbonGrad)" />
                <path
                  d="M50 89L60 102L70 89"
                  stroke="#F43F5E"
                  stroke-width="2.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />

                <!-- 脸庞 -->
                <path
                  d="M35 56C35 38 46 30 60 30C74 30 85 38 85 56C85 70 76 82 60 85C44 82 35 70 35 56Z"
                  fill="url(#wishSkinGrad)"
                />

                <!-- 脸颊红晕 + 害羞斜线 -->
                <ellipse
                  class="girl-blush"
                  cx="42"
                  cy="71"
                  rx="5.5"
                  ry="2.8"
                  fill="#FB7185"
                  fill-opacity="0.5"
                />
                <ellipse
                  class="girl-blush"
                  cx="78"
                  cy="71"
                  rx="5.5"
                  ry="2.8"
                  fill="#FB7185"
                  fill-opacity="0.5"
                />
                <path
                  d="M39 72.5L40.6 69.5M42 72.5L43.6 69.5M45 72.5L46.6 69.5M75 72.5L76.6 69.5M78 72.5L79.6 69.5M81 72.5L82.6 69.5"
                  stroke="#F43F5E"
                  stroke-opacity="0.65"
                  stroke-width="0.9"
                  stroke-linecap="round"
                />

                <!-- 眼睛：祈愿中=水汪汪大眼（会眨眼）/ 暴击=星星眼 / 成功=笑眯眼 / 报错=>_< -->
                <g
                  v-if="displayPhase === 'praying' || displayPhase === 'idle'"
                  class="girl-eyes-open"
                >
                  <g class="girl-eye">
                    <ellipse cx="47" cy="61" rx="7" ry="8.2" fill="#FFFFFF" />
                    <ellipse cx="47" cy="61.6" rx="6" ry="7.5" fill="url(#wishIrisGrad)" />
                    <ellipse cx="47" cy="62.6" rx="2.7" ry="3.5" fill="#2E1065" />
                    <ellipse cx="47" cy="66" rx="3.8" ry="1.8" fill="#FBCFE8" fill-opacity="0.75" />
                    <ellipse cx="44.6" cy="58" rx="2.4" ry="2.9" fill="#FFFFFF" />
                    <circle cx="49.8" cy="65.2" r="1.2" fill="#FFFFFF" />
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
                    <ellipse cx="73" cy="62.6" rx="2.7" ry="3.5" fill="#2E1065" />
                    <ellipse cx="73" cy="66" rx="3.8" ry="1.8" fill="#FBCFE8" fill-opacity="0.75" />
                    <ellipse cx="70.6" cy="58" rx="2.4" ry="2.9" fill="#FFFFFF" />
                    <circle cx="75.8" cy="65.2" r="1.2" fill="#FFFFFF" />
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
                <g v-else-if="displayPhase === 'crit'" class="girl-eyes-star">
                  <ellipse cx="47" cy="61.6" rx="6.4" ry="7.8" fill="url(#wishIrisGrad)" />
                  <ellipse cx="73" cy="61.6" rx="6.4" ry="7.8" fill="url(#wishIrisGrad)" />
                  <path
                    d="M47 55.5L48.6 59.8L53 61.6L48.6 63.4L47 67.7L45.4 63.4L41 61.6L45.4 59.8Z"
                    fill="#FDE047"
                  />
                  <path
                    d="M73 55.5L74.6 59.8L79 61.6L74.6 63.4L73 67.7L71.4 63.4L67 61.6L71.4 59.8Z"
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
                <g v-else-if="displayPhase === 'success'" class="girl-eyes-happy">
                  <path
                    d="M40 63C43 56 51 56 54 63"
                    stroke="#3B0764"
                    stroke-width="2.8"
                    stroke-linecap="round"
                  />
                  <path
                    d="M66 63C69 56 77 56 80 63"
                    stroke="#3B0764"
                    stroke-width="2.8"
                    stroke-linecap="round"
                  />
                </g>
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

                <!-- 嘴巴：ω 猫猫嘴 / 念咒张嘴 / 成功大笑 -->
                <g class="girl-mouth-group">
                  <g v-if="mouthTalking || displayPhase === 'crit'">
                    <path
                      d="M56.2 73Q60 72 63.8 73Q63.4 78.6 60 78.6Q56.6 78.6 56.2 73Z"
                      fill="#E11D48"
                    />
                    <ellipse cx="60" cy="77" rx="2.2" ry="1.2" fill="#FDA4AF" />
                  </g>
                  <path
                    v-else-if="displayPhase === 'success'"
                    d="M54.5 72.5Q60 80 65.5 72.5Z"
                    fill="#E11D48"
                  />
                  <path
                    v-else
                    d="M55.5 73Q57.75 76 60 73Q62.25 76 64.5 73"
                    stroke="#BE185D"
                    stroke-width="1.6"
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

                <!-- 两侧鬓发 + 尖尖齐刘海 -->
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
                <!-- 发丝高光 -->
                <path
                  d="M43 26C50 21.5 70 21.5 77 26"
                  stroke="#FFFFFF"
                  stroke-opacity="0.55"
                  stroke-width="2.4"
                  stroke-linecap="round"
                />
                <path d="M47 30L49 27.5L51 30L49 32.5Z" fill="#FFFFFF" fill-opacity="0.7" />

                <!-- 头顶随风摇晃的呆毛 (Ahoge) -->
                <path
                  class="girl-ahoge"
                  d="M60 18C56 7 64 1 72 5C66 6 62 11 62.5 18Z"
                  fill="#F9A8D4"
                />

                <!-- 双马尾蝴蝶结 -->
                <g class="girl-bow-left">
                  <path d="M28 35L17 28C13.5 32 13.5 39 17 42Z" fill="url(#wishRibbonGrad)" />
                  <path d="M28 35L37 27C40.5 31 40.5 38 37 41Z" fill="url(#wishRibbonGrad)" />
                  <path d="M27 36L23 46L27.5 44L29 48L30 37Z" fill="#E11D74" />
                  <circle cx="28" cy="35" r="2.8" fill="#FDE047" />
                </g>
                <g class="girl-bow-right">
                  <path d="M92 35L103 28C106.5 32 106.5 39 103 42Z" fill="url(#wishRibbonGrad)" />
                  <path d="M92 35L83 27C79.5 31 79.5 38 83 41Z" fill="url(#wishRibbonGrad)" />
                  <path d="M93 36L97 46L92.5 44L91 48L90 37Z" fill="#E11D74" />
                  <circle cx="92" cy="35" r="2.8" fill="#FDE047" />
                </g>

                <!-- 发饰：金色星星发卡 + 爱心发卡 -->
                <path
                  d="M79 25L80.6 29L84.6 30.6L80.6 32.2L79 36.2L77.4 32.2L73.4 30.6L77.4 29Z"
                  fill="#FDE047"
                  class="girl-hairpin"
                />
                <path
                  d="M42 36C38 33 38 29 40.5 29C41.5 29 42 30 42 30.5C42 30 42.5 29 43.5 29C46 29 46 33 42 36Z"
                  fill="#F472B6"
                />

                <!-- 双手合十祈祷（上下轻摇 + 指尖金光） -->
                <g class="girl-praying-hands">
                  <circle cx="60" cy="98" r="14" fill="url(#wishOrbGrad)" class="pray-orb" />
                  <!-- 袖口 -->
                  <path
                    d="M43 110C47 105.5 51.5 104 55 104.5L56 109C52 109 48 111 45 113.5Z"
                    fill="#FFFFFF"
                    stroke="#DDD6FE"
                    stroke-width="0.9"
                  />
                  <path
                    d="M77 110C73 105.5 68.5 104 65 104.5L64 109C68 109 72 111 75 113.5Z"
                    fill="#FFFFFF"
                    stroke="#DDD6FE"
                    stroke-width="0.9"
                  />
                  <!-- 合十的两只小手（指尖朝上 + 指缝 + 拇指） -->
                  <path
                    d="M59.6 87C57.4 87.6 55 91.5 54.6 96.5C54.3 100.5 55.6 104.5 59.6 106.5Z"
                    fill="#FFF3EE"
                    stroke="#F9A8D4"
                    stroke-width="0.9"
                  />
                  <path
                    d="M60.4 87C62.6 87.6 65 91.5 65.4 96.5C65.7 100.5 64.4 104.5 60.4 106.5Z"
                    fill="#FFEDE6"
                    stroke="#F9A8D4"
                    stroke-width="0.9"
                  />
                  <path
                    d="M57.6 90.5L57.4 97M56 93L55.9 98.5M62.4 90.5L62.6 97M64 93L64.1 98.5"
                    stroke="#F9A8D4"
                    stroke-width="0.7"
                    stroke-linecap="round"
                  />
                  <path
                    d="M59.4 100.5C57.6 100.8 57 102.8 58 104.5M60.6 100.5C62.4 100.8 63 102.8 62 104.5"
                    stroke="#F9A8D4"
                    stroke-width="0.8"
                    stroke-linecap="round"
                  />
                  <path
                    class="pray-sparkle sp-top"
                    d="M72 82L73.2 85.2L76.4 86.4L73.2 87.6L72 90.8L70.8 87.6L67.6 86.4L70.8 85.2Z"
                    fill="#FEF08A"
                  />
                  <path
                    class="pray-sparkle sp-left"
                    d="M46 92L47 94.5L49.5 95.5L47 96.5L46 99L45 96.5L42.5 95.5L45 94.5Z"
                    fill="#7DD3FC"
                  />
                  <path
                    class="pray-sparkle sp-right"
                    d="M74 92L75 94.5L77.5 95.5L75 96.5L74 99L73 96.5L70.5 95.5L73 94.5Z"
                    fill="#F472B6"
                  />
                </g>
              </svg>
            </div>

            <!-- 从二次元娘口中源源不断飘向空中的咒语粒子流 -->
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

          <!-- 二次元娘身下悬浮的轻巧祈愿铭牌（点按攒欧气 + 一键折叠） -->
          <div class="sprite-foot-ribbon" @click="onBlessClick">
            <span class="ribbon-status">{{ ribbonBadgeText }}</span>
            <span class="ribbon-karma" :class="{ bump: karmaBump }">
              {{ isEn ? `✨ Luck ${luckTotalText}` : `✨ 欧气 ${luckTotalText}` /* cjk-ok */ }}
            </span>
            <button
              type="button"
              class="wish-minimize-btn"
              :title="isEn ? 'Minimize' : '收起为小护身符' /* cjk-ok */"
              :aria-label="isEn ? 'Minimize' : '收起为小护身符' /* cjk-ok */"
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

/* ── 二次元祈祷娘 SVG 精灵 ── */
.wish-anime-girl-wrap {
  position: relative;
  z-index: 3;
  width: 96px;
  height: 104px;
  flex-shrink: 0;
  cursor: pointer;
  pointer-events: auto;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 45%,
    rgba(244, 114, 182, 0.32) 0%,
    rgba(139, 92, 246, 0.24) 48%,
    rgba(30, 22, 74, 0) 72%
  );
  filter: drop-shadow(0 6px 16px rgba(15, 10, 40, 0.55))
    drop-shadow(0 0 10px rgba(244, 114, 182, 0.35));
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-anime-girl-wrap:hover {
  transform: scale(1.08);
}

.wish-anime-girl-wrap.bounce {
  animation: wish-girl-squish 0.36s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.wish-anime-girl-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  animation: wish-girl-float 2.2s ease-in-out infinite alternate;
}

.girl-cloud-base {
  animation: wish-orb-pulse 1.6s ease-in-out infinite alternate;
}

.girl-halo {
  transform-origin: 60px 54px;
  animation: wish-halo-spin 12s linear infinite;
}

.girl-ahoge {
  transform-origin: 61px 18px;
  animation: wish-ahoge-sway 1.3s ease-in-out infinite alternate;
}

.girl-twintail-left {
  transform-origin: 30px 36px;
  animation: wish-tail-left 1.6s ease-in-out infinite alternate;
}

.girl-twintail-right {
  transform-origin: 90px 36px;
  animation: wish-tail-right 1.6s ease-in-out infinite alternate;
}

.girl-bow-left {
  transform-origin: 28px 35px;
  animation: wish-bow-wiggle 1.6s ease-in-out infinite alternate;
}

.girl-bow-right {
  transform-origin: 92px 35px;
  animation: wish-bow-wiggle 1.6s ease-in-out infinite alternate-reverse;
}

.girl-hairpin {
  transform-box: fill-box;
  transform-origin: center;
  animation: wish-sparkle-pop 1.1s ease-in-out infinite alternate;
}

/* 水汪汪大眼：每 3.6s 眨一次眼 */
.girl-eye {
  transform-box: fill-box;
  transform-origin: center;
  animation: wish-eye-blink 3.6s ease-in-out infinite;
}

.girl-eyes-star {
  transform-origin: 60px 61px;
  animation: wish-star-eyes 0.5s ease-in-out infinite alternate;
}

.girl-blush {
  animation: wish-blush-pulse 1.8s ease-in-out infinite alternate;
}

.girl-praying-hands {
  transform-origin: 60px 100px;
  animation: wish-hands-pray 0.8s ease-in-out infinite alternate;
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

/* ── 从二次元娘嘴边飘出的咒语气泡流 ── */
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
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  min-width: 64px;
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

/* ── 游戏伤害数字式欧气飘字 ── */
.luck-popup-layer {
  position: absolute;
  /* 展开态：角色头顶（padding 10 + 半个角色宽 48） */
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

/* 只在悬停角色 / 铭牌时出现收起按钮，避免被误认为欧气值的负号 */
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
    transform: translateY(-4px);
  }
}

@keyframes wish-girl-squish {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.18, 0.86);
  }
  75% {
    transform: scale(0.94, 1.07);
  }
  100% {
    transform: scale(1);
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
    transform: scale(0.96);
  }
  100% {
    transform: scale(1.06);
  }
}

@keyframes wish-blush-pulse {
  0% {
    fill-opacity: 0.38;
  }
  100% {
    fill-opacity: 0.68;
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

/* 咒语从二次元娘口中诞生 → 向右上方弧线升腾飘散 */
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
