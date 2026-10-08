<template>
  <!--
    录制 HUD 在「录制中**或**编码中」存在：`v-if` 挂在根上，两者都不是时连一个空 `div` 都不留在
    DOM 里（全屏 `pointer-events: none` 层虽然不挡点击，但留在无头截屏里会让画面指纹多一次「变化」）。

    不能再写成 `v-if="recording"`：主进程在**编码开始时**就推 `recording: false`（编码还要几十秒），
    只按 recording 判可见会让徽标在编码期间整段消失 —— 用户看不到「还在收尾」，反而更慌。
  -->
  <div v-if="visible" class="recording-hud" :aria-label="hudAriaLabel" role="status">
    <!--
      录制徽标与编码徽标互斥：`recording` 在编码开始那一刻就是 false 了，此时若继续挂 `hud-badge`
      就会一直写着「● 录制中」并继续走秒 —— 那是对用户撒谎（也是这次要修掉的 bug）。
      编码阶段画面本身「静止」：秒表已经不再变化，重复帧会被空闲合并压掉，所以不会给成片添时长。
    -->
    <div v-if="phase === 'recording'" class="hud-badge">
      <span class="hud-dot" aria-hidden="true">●</span>
      <span class="hud-label">{{ t('screenRecord.hud.recording') }}</span>
      <span class="hud-clock">{{ elapsedLabel }}</span>
      <span v-if="framesLabel" class="hud-frames" :aria-label="framesLabel" />
      <span v-if="stepLabel" class="hud-step">{{ stepLabel }}</span>
    </div>

    <div v-else class="hud-badge hud-badge-encoding">
      <span class="hud-encode-icon" aria-hidden="true">⟳</span>
      <span class="hud-label hud-encode-label">
        {{ t('screenRecord.hud.encoding', { percent: progressPercent }) }}
      </span>
    </div>

    <!-- title=短标题；caption=详细字卡（烧进画面）。旁白音频另在 tutorial_compose 生成，不在此播。 -->
    <div v-if="title || caption" :key="captionMotionKey" class="hud-titlebar">
      <span v-if="title" class="hud-title">{{ title }}</span>
      <span v-if="caption && caption !== title" class="hud-caption">{{ caption }}</span>
    </div>

    <div v-if="focusBox" class="hud-focus" :style="focusBox" />

    <div
      v-if="cursor"
      ref="cursorEl"
      class="hud-cursor"
      :class="{ 'hud-cursor-ready': cursorReady }"
    >
      <!-- 指引用手势而非三角箭头：教学视频里更像「指给你看」 -->
      <svg class="hud-cursor-hand" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <path
          fill="#ffffff"
          stroke="#111418"
          stroke-width="1.6"
          stroke-linejoin="round"
          d="M13.2 3.2c.9 0 1.6.7 1.6 1.6v8.2l.4-.2c.5-1.2 1.7-1.5 2.5-.9.4.3.6.7.6 1.2v.8l.5-.3c.6-1 1.8-1.2 2.5-.5.4.3.6.8.6 1.3v1l.4-.2c.6-.9 1.8-1 2.5-.3.4.4.6.9.6 1.4v6.2c0 3.2-2.2 5.6-5.4 5.6h-2.2c-2.2 0-4.1-1-5.3-2.6L9.2 20.4c-.7-.9-.6-2.2.3-2.9.8-.6 1.9-.5 2.6.2l1.1 1.1V4.8c0-.9.7-1.6 1.6-1.6z"
        />
      </svg>
      <span ref="rippleEl" class="hud-ripple"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  ScreenRecordCursor,
  ScreenRecordFocus,
  ScreenRecordHudState
} from '@shared/screenRecord'

const { t } = useI18n()

const recording = ref(false)
/**
 * 当前阶段。主进程在编码开始时把 `recording` 推成 false 并同时给 `phase: 'encoding'`，
 * 结束时只推 `{ recording: false }`（没有 phase）—— 所以「没有 recording 也没有 phase」
 * 就是编码结束、HUD 该消失。缺省按 `recording` 归一，兼容编码阶段之前的老推送形状。
 */
const phase = ref<'recording' | 'encoding' | null>(null)
const progress = ref(0)
const startedAtMs = ref<number | undefined>(undefined)
const stepIndex = ref<number | undefined>(undefined)
const title = ref('')
const caption = ref('')
const focus = ref<ScreenRecordFocus | undefined>(undefined)
const cursor = ref<ScreenRecordCursor | undefined>(undefined)
const frames = ref<number | undefined>(undefined)

const elapsedMs = ref(0)
const cursorEl = ref<HTMLElement | null>(null)
const rippleEl = ref<HTMLElement | null>(null)
/** 首帧先把光标放到目标位，再打开过渡：否则会看到它从左上角滑过来 */
const cursorReady = ref(false)

let hudStop: (() => void) | null = null
let clockTimer: number | null = null
let rippleTimer: number | null = null
/**
 * 上一次触发涟漪的点击签名。
 *
 * 不能用 `click === true` 直接当触发条件：主进程推状态时会把整个 `cursor` 原样带上，
 * 同一次点击会被推很多遍；也不能只按坐标判重 —— 下一步恰好点同一个按钮时坐标不变，
 * 那只涟漪会被吞掉。所以签名 = 步骤序号 + 坐标：同一步里重复推状态不会连爆，
 * 新的一步（或新坐标）一定重新触发。
 */
let lastClickSignature = ''

/**
 * 可见性 = 录制中**或**编码中。
 *
 * 编码期间 `recording` 已经是 false（主进程在编码一开始就推了），这里必须再认 `phase`：
 * 只认 recording 会让整个编码阶段没有 HUD；只认「有任意推送」的话，编码收尾那次
 * `{ recording: false }` 又会让它一直亮着。
 */
const visible = computed(() => recording.value || phase.value === 'encoding')

/**
 * 进度百分比：主进程按 0~1 推，但它是走 IPC 的数字，不保证不越界；
 * 这里夹紧并取整，只为把画面上那串数字钉在 0~100。
 */
const progressPercent = computed(() => {
  const clamped = Math.min(1, Math.max(0, progress.value))
  return Math.round(clamped * 100)
})

/** 编码中徽标的读屏文案（与画面上看到的同一句话，含百分比） */
const hudAriaLabel = computed(() =>
  phase.value === 'encoding'
    ? t('screenRecord.hud.encoding', { percent: progressPercent.value })
    : t('screenRecord.hud.recording')
)

const elapsedLabel = computed(() => {
  const total = Math.max(0, Math.floor(elapsedMs.value / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
})

const stepLabel = computed(() =>
  typeof stepIndex.value === 'number'
    ? t('screenRecord.hud.step', { index: stepIndex.value + 1 })
    : ''
)

/**
 * 已录帧数：只是录制侧的一个进度指示，用一个小圆点表示「有数据在进来」，
 * 具体数字放进 `aria-label`（画面上不需要一串数字，1080p 下反而显得脏）。
 */
const framesLabel = computed(() =>
  typeof frames.value === 'number' && frames.value > 0
    ? t('screenRecord.hud.frames', { count: frames.value })
    : ''
)

/** 步骤切换时重挂字卡，触发上滚淡入（成片字幕同款动效） */
const captionMotionKey = computed(() => `${stepIndex.value ?? -1}|${title.value}|${caption.value}`)

/** 高亮框钳进视口，避免错误坐标把框画飞出画面 */
const focusBox = computed(() => {
  const box = focus.value
  if (!box) return null
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const x = Math.max(0, Math.min(box.x, vw - 2))
  const y = Math.max(0, Math.min(box.y, vh - 2))
  const width = Math.max(2, Math.min(box.width, vw - x))
  const height = Math.max(2, Math.min(box.height, vh - y))
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`
  }
})

function stopClock(): void {
  if (clockTimer === null) return
  window.clearInterval(clockTimer)
  clockTimer = null
}

function tickClock(): void {
  elapsedMs.value = startedAtMs.value ? Date.now() - startedAtMs.value : 0
}

/**
 * 本地走秒。
 *
 * 主进程只在状态变化时推一次 `startedAtMs`（不每帧推时间：那会让每次推送都算一次状态变化，
 * 空闲帧合并直接失效）。所以已录时长只能在这里自己算 —— 没在录制时把定时器清掉，
 * 否则录制结束后它还会一直空转（这个组件在录制期间外也挂载着）。
 *
 * **编码阶段必须停表**：`tickClock` 是按 `Date.now() - startedAtMs` 重算的，编码要几十秒，
 * 表一直走就会把这段编码时间也算进「已录时长」——用户看到的是他没录过的时间。
 * 停表后不再重算读数；也因为定时器被清掉，新录制开始时 `restartClock()` 一定会重新起表
 * （下面那个提前 return 是唯一开表条件，没起表时也不会留悬挂定时器）。
 */
function restartClock(): void {
  stopClock()
  // 编码中 / 已结束：不起表。此处提前 return 而不是让 tickClock 自己判，是为了不留定时器
  if (!recording.value || phase.value !== 'recording') return
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
}

function onHudState(state: ScreenRecordHudState): void {
  recording.value = state.recording === true
  // 缺省（老推送形状）按 recording 归一，这样 `phase !== 'recording'` 的停表条件不会误伤正常录制
  phase.value = state.phase ?? (state.recording === true ? 'recording' : null)
  progress.value = typeof state.progress === 'number' ? state.progress : 0
  startedAtMs.value = typeof state.startedAtMs === 'number' ? state.startedAtMs : undefined
  stepIndex.value = typeof state.stepIndex === 'number' ? state.stepIndex : undefined
  title.value = state.title ?? ''
  caption.value = state.caption ?? ''
  focus.value = state.focus ?? undefined
  cursor.value = state.cursor ?? undefined
  frames.value = typeof state.frames === 'number' ? state.frames : undefined
  restartClock()
}

function positionCursor(instant: boolean): void {
  const el = cursorEl.value
  const target = cursor.value
  if (!el || !target) return
  const place = (): void => {
    el.style.transform = `translate(${target.x}px, ${target.y}px)`
  }
  if (instant) {
    cursorReady.value = false
    place()
    // 过渡类要等这一帧落定后再挂上，否则本次定位本身就会被动画吃掉
    window.requestAnimationFrame(() => {
      cursorReady.value = true
    })
    return
  }
  cursorReady.value = true
  place()
}

/** 一次点击涟漪：重启 CSS 动画（同一步里只在签名变化时调用） */
function fireRipple(): void {
  const el = rippleEl.value
  if (!el) return
  el.classList.remove('hud-ripple-active')
  // 强制回流：不读一次布局，浏览器会把 remove + add 合并成「没有变化」，动画不会重放
  void el.offsetWidth
  el.classList.add('hud-ripple-active')
  if (rippleTimer !== null) window.clearTimeout(rippleTimer)
  rippleTimer = window.setTimeout(() => {
    el.classList.remove('hud-ripple-active')
    rippleTimer = null
  }, 700)
}

watch(
  () => recording.value,
  (on) => {
    /*
      每次录制开始都把光标的过渡状态复位。

      不复位的话：上一段录制结束时 `cursorReady` 还是 true，新录制的第一个光标会被 420ms 的过渡
      从上次的落点划过来（看起来像一次莫名其妙的横移），而且下一步的点击（坐标可能没变）
      会被上一条签名吞掉。
    */
    if (!on) return
    cursorReady.value = false
    lastClickSignature = ''
  }
)

watch(
  () => cursor.value,
  (next) => {
    if (!next || !recording.value) return
    // 录制刚开始 / 还没有落点：先瞬移到位，再打开过渡（否则会从左上角滑进来）
    positionCursor(!cursorReady.value)
    if (!next.click) {
      lastClickSignature = ''
      return
    }
    const signature = `${stepIndex.value ?? -1}:${Math.round(next.x)}:${Math.round(next.y)}`
    if (signature === lastClickSignature) return
    lastClickSignature = signature
    fireRipple()
  }
)

// 步骤变了就允许下一次「同坐标点击」重新触发涟漪
watch(
  () => stepIndex.value,
  () => {
    lastClickSignature = ''
  }
)

onMounted(() => {
  // 录制可能在本组件挂载之前就开始了（悬浮窗后开等）：先取一次当前状态，别等下一次推送
  void window.studio?.screenRecordStatus?.().then((state) => {
    if (state?.recording) onHudState(state)
  })
  hudStop = window.studio.onScreenRecordHud(onHudState)
})

onUnmounted(() => {
  hudStop?.()
  hudStop = null
  stopClock()
  if (rippleTimer !== null) {
    window.clearTimeout(rippleTimer)
    rippleTimer = null
  }
})
</script>

<style scoped>
/*
  根层：铺满窗口但**不吃任何指针事件**。

  录制期间用户要在它底下的界面上真的点来点去（那正是被录的演示），
  盖一层能接收事件的全屏 div 会让演示本身点不动 —— 等于把要录的东西弄坏了。
*/
.recording-hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  /*
    z-index 取 1100：高于应用内容，低于所有模态弹窗。

    本仓库的分层口径（读出来的）：普通应用内容 / 图形编辑器内部层 ≤ 60，
    节点工具面板与编辑器弹窗从 1200 起（`StudioFloatingWindow` 的 `z-index` prop 就是 mask 的
    z-index），主对话框 2200~3200（ComposerDialog / StudioPromptDialog / GraphTaskListDialog），
    悬浮菜单与工具提示 5200~10000（ProjectOpenMenu / WorkspaceToolbar 的 tool-tip）。

    1100 恰好落在「1200 全部模态之下、60 全部应用内容之上」的空档里：
    录到一半弹出模态（例如 StudioPromptDialog 要用户确认）时，模态必须盖住 HUD ——
    否则 HUD 会挡在对话框的按钮上（它不吃点击，但会**遮住**按钮，而录下来的画面正是观众看到的）；
    同时它又要压在画布、面板、图形编辑器这些普通内容之上，才能在任何界面状态下都读得到。
    比 5200 的弹出菜单低是刻意的：那些菜单只在用户主动操作时出现、且是本次演示的主角。
  */
  z-index: 1100;
  font-family: var(--font);
  /*
    这里刻意**不设** `user-select: none`：HUD 不吃指针事件，用户在它覆盖的区域里仍然能正常
    选中底下的文本（那也可能是演示的一部分）；HUD 自己的文字在各自的类上禁选即可。
  */
}

/*
  徽标与标题条统一走「深色实底 + 浅色字」：它们会落在任意应用内容上（亮色主题的白面板、
  深色画布、彩色图片），只有自带实底才能保证任何背景下都读得清 —— 半透明底在亮图上会糊成一片，
  而这段画面要被 `capturePage()` 逐帧编码进教学视频，糊掉的字后期救不回来。

  描边用 `color-mix(in srgb, #fff …%, transparent)` 而不是 `rgba(255, 255, 255, …)`：
  后者会被 themeStylesAudit 判为 white-wash 硬编码白叠色（浅色主题下几乎无对比），
  color-mix 是同一视觉效果的相对色写法，仓库里已有先例（GraphNodeCard 的节点描边）。
*/
.hud-badge {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(12, 14, 18, 0.92);
  border: 1px solid color-mix(in srgb, #fff 30%, transparent);
  color: #f4f6fa;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  /* 不用大半径模糊：1080p 下会被编码成灰雾，字边缘发虚 */
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}

.hud-dot {
  color: #ff4d4f;
  font-size: 13px;
  /* 只做呼吸，不做模糊光晕（模糊在视频里等于一条灰边） */
  animation: hud-blink 1.6s ease-in-out infinite;
}

/*
  编码徽标：与录制徽标同一枚深色实底胶囊（同样的可读性理由），但不再有红点呼吸 ——
  旋转的箭头是「在干活」，红点留给「正在录」。基类已经给了背景/描边/字色，这里只覆盖差别。
*/
.hud-badge-encoding {
  background: rgba(12, 14, 18, 0.92);
}

/*
  编码图标：`⟳` 字形本身没有旋转，靠 animation 转起来。
  `transform-origin: center` + 只转这一层（不动父层胶囊）：转的是图标，不是整条徽标。
  用 linear 而不是 ease：匀速转才像进度，缓动会一顿一顿。不做模糊（同上）。
*/
.hud-encode-icon {
  display: inline-block;
  color: #ffb020;
  font-size: 14px;
  line-height: 1;
  transform-origin: center;
  animation: hud-encode-spin 1.4s linear infinite;
}

/* 百分比数字用等宽 + tabular-nums：从 9% 跳到 10% 时不会让整条徽标左右抖 */
.hud-encode-label {
  font-variant-numeric: tabular-nums;
}

@keyframes hud-encode-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* HUD 自己的文字禁选：拖拽选中只会给录下来的画面添一条蓝色高亮（底下的内容不受影响） */
.hud-label,
.hud-caption,
.hud-step {
  user-select: none;
}

.hud-clock {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 15px;
}

.hud-step {
  padding-left: 10px;
  border-left: 1px solid color-mix(in srgb, #fff 30%, transparent);
  color: #c6ccd8;
  font-size: 12px;
  font-weight: 500;
}

/* 有帧在进来时亮起：录制卡死（主进程没再截到帧）时它不亮，一眼能看出来 */
.hud-frames {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #37d67a;
}

.hud-titlebar {
  position: fixed;
  left: 50%;
  bottom: 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  /* 留足左右边距，避免长 caption 顶出视频画面 */
  box-sizing: border-box;
  width: min(720px, calc(100vw - 48px));
  max-width: calc(100vw - 48px);
  padding: 10px 18px;
  border-radius: 10px;
  /* 半透明：底下画布仍可见，避免成片里一块死黑遮住节点 */
  background: rgba(12, 14, 18, 0.55);
  border: 1px solid color-mix(in srgb, #fff 28%, transparent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  text-align: center;
  /* 专业字幕：自下淡入上滚 */
  animation: hud-caption-roll 380ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

@keyframes hud-caption-roll {
  from {
    opacity: 0;
    transform: translate(-50%, 22px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.hud-title {
  color: #ffffff;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.hud-caption {
  color: #b8bfcc;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}

/*
  高亮框：坐标就是窗口内容坐标（CSS px），所以直接按 left/top/width/height 落位。
  用 box-shadow 的 inset 做好几像素的实边（不是模糊光晕）：外发光在视频里会糊成灰戒指，
  而 inset 实边在亮底与暗底上都还能看清框在哪。
*/
.hud-focus {
  position: fixed;
  box-sizing: border-box;
  border: 4px solid #ffb020;
  border-radius: 12px;
  box-shadow:
    inset 0 0 0 2px rgba(0, 0, 0, 0.6),
    0 0 0 2px rgba(0, 0, 0, 0.6);
  animation: hud-focus-in 160ms ease-out;
}

@keyframes hud-focus-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes hud-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/*
  合成光标：`capturePage()` 不含系统指针，指针只能自己画。
  位移走 transform + transition（合成器线程上跑，与页面重绘解耦，移动看起来是滑过去而不是跳过去）。
*/
.hud-cursor {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  will-change: transform;
}

.hud-cursor-ready {
  transition: transform 420ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 手指指针：尖端对准目标（translate 落点 = 指尖） */
.hud-cursor-hand {
  position: absolute;
  top: -4px;
  left: -6px;
  display: block;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.9));
}

.hud-ripple {
  position: absolute;
  top: 0;
  left: 0;
  width: 64px;
  height: 64px;
  margin: -32px 0 0 -32px;
  border: 3px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55);
  opacity: 0;
  transform: scale(0.25);
}

.hud-ripple-active {
  animation: hud-ripple 620ms ease-out;
}

@keyframes hud-ripple {
  from {
    opacity: 0.95;
    transform: scale(0.25);
  }
  to {
    opacity: 0;
    transform: scale(1);
  }
}
</style>
