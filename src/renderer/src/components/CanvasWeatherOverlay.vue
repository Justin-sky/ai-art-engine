<template>
  <div
    v-if="weatherSystemEnabled"
    ref="rootEl"
    class="canvas-weather-overlay"
    :class="[`is-weather-${currentWeather}`, { 'is-active': currentWeather !== 'idle' }]"
  >
    <canvas ref="canvasEl" class="canvas-weather-overlay__canvas" />

    <!-- Compact interactive Weather HUD Pill -->
    <div
      class="canvas-weather-hud"
      :class="{ 'is-expanded': hudExpanded, 'is-active': currentWeather !== 'idle' }"
      @pointerdown.stop
      @click.stop
    >
      <div class="canvas-weather-hud__bar">
        <button
          type="button"
          class="canvas-weather-hud__pill"
          :title="t('settings.weatherSystem.hudTitle')"
          @click="hudExpanded = !hudExpanded"
        >
          <span class="canvas-weather-hud__icon" aria-hidden="true">{{ weatherIcon }}</span>
          <span class="canvas-weather-hud__label">{{ currentWeatherLabel }}</span>
          <span class="canvas-weather-hud__caret" aria-hidden="true">{{
            hudExpanded ? '▴' : '▾'
          }}</span>
        </button>

        <button
          type="button"
          class="canvas-weather-hud__dice"
          :title="t('settings.weatherSystem.randomNext')"
          @click="onShuffleNow"
        >
          🎲
        </button>
      </div>

      <div v-if="hudExpanded" class="canvas-weather-hud__panel">
        <div class="canvas-weather-hud__modes">
          <button
            v-for="item in modeOptions"
            :key="item.value"
            type="button"
            class="canvas-weather-hud__mode-btn"
            :class="{
              'is-selected':
                manualOverride === item.value ||
                (manualOverride === 'auto' &&
                  item.value !== 'auto' &&
                  currentWeather === item.value)
            }"
            @click="selectMode(item.value)"
          >
            <span>{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </button>
        </div>

        <div class="canvas-weather-hud__actions">
          <button
            type="button"
            class="canvas-weather-hud__action-btn"
            :class="{ 'is-on': weatherSfxEnabled }"
            @click="toggleSfx"
          >
            <span>{{ weatherSfxEnabled ? '🔊' : '🔇' }}</span>
            <span>{{ t('settings.weatherSystem.sfxToggle') }}</span>
          </button>
          <button
            type="button"
            class="canvas-weather-hud__action-btn"
            :class="{ 'is-on': weatherBgmEnabled }"
            @click="toggleBgm"
          >
            <span>{{ weatherBgmEnabled ? '🎵' : '🔕' }}</span>
            <span>{{ t('settings.weatherSystem.bgmToggle') }}</span>
          </button>
          <button
            type="button"
            class="canvas-weather-hud__action-btn is-shuffle"
            @click="onShuffleNow"
          >
            <span>🎲</span>
            <span>{{ t('settings.weatherSystem.randomNext') }}</span>
          </button>
          <button
            type="button"
            class="canvas-weather-hud__action-btn is-strike"
            @click="fireManualStrike"
          >
            <span>⚡</span>
            <span>{{ t('settings.weatherSystem.triggerStrike') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  editorPreferences,
  setWeatherBgmEnabled,
  setWeatherSfxEnabled
} from '../editor/preferences'
import {
  applyHailstoneNodeImpact,
  applyMeteorNodeImpact,
  applyRaindropNodeImpact,
  canvasWeatherState,
  setWeatherManualMode,
  shuffleWeatherNow,
  stepNodeWeatherPhysics,
  triggerWeatherLightningStrike,
  vortexEyeNorm,
  type WeatherKind,
  type WeatherNodeRect
} from '../graph/vfx/canvasWeatherEngine'

const props = defineProps<{
  visibleNodes: WeatherNodeRect[]
  suppressNodePhysics?: boolean
}>()

const { t } = useStudioI18n()

const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const hudExpanded = ref(false)

const weatherSystemEnabled = editorPreferences.weatherSystemEnabled
const weatherSfxEnabled = editorPreferences.weatherSfxEnabled
const weatherBgmEnabled = editorPreferences.weatherBgmEnabled
const currentWeather = canvasWeatherState.currentWeather
const manualOverride = canvasWeatherState.manualOverride

const weatherIcon = computed(() => {
  switch (currentWeather.value) {
    case 'wind':
      return '🌬️'
    case 'rain':
      return '🌧️'
    case 'thunderstorm':
      return '⛈️'
    case 'typhoon':
      return '🌀'
    case 'blizzard':
      return '❄️'
    case 'hail':
      return '🧊'
    case 'sandstorm':
      return '🏜️'
    case 'meteor':
      return '☄️'
    case 'aurora':
      return '🌌'
    case 'fog':
      return '🌫️'
    case 'sunny':
      return '🌤️'
    case 'idle':
    default:
      return '☀️'
  }
})

const currentWeatherLabel = computed(() => {
  switch (currentWeather.value) {
    case 'wind':
      return t('settings.weatherSystem.modeWind')
    case 'rain':
      return t('settings.weatherSystem.modeRain')
    case 'thunderstorm':
      return t('settings.weatherSystem.modeThunderstorm')
    case 'typhoon':
      return t('settings.weatherSystem.modeTyphoon')
    case 'blizzard':
      return t('settings.weatherSystem.modeBlizzard')
    case 'hail':
      return t('settings.weatherSystem.modeHail')
    case 'sandstorm':
      return t('settings.weatherSystem.modeSandstorm')
    case 'meteor':
      return t('settings.weatherSystem.modeMeteor')
    case 'aurora':
      return t('settings.weatherSystem.modeAurora')
    case 'fog':
      return t('settings.weatherSystem.modeFog')
    case 'sunny':
      return t('settings.weatherSystem.modeSunny')
    case 'idle':
    default:
      return manualOverride.value === 'auto'
        ? t('settings.weatherSystem.modeAuto')
        : t('settings.weatherSystem.modeIdle')
  }
})

const modeOptions = computed<Array<{ value: 'auto' | WeatherKind; icon: string; label: string }>>(
  () => [
    { value: 'auto', icon: '🎲', label: t('settings.weatherSystem.modeAuto') },
    { value: 'wind', icon: '🌬️', label: t('settings.weatherSystem.modeWind') },
    { value: 'rain', icon: '🌧️', label: t('settings.weatherSystem.modeRain') },
    { value: 'thunderstorm', icon: '⛈️', label: t('settings.weatherSystem.modeThunderstorm') },
    { value: 'typhoon', icon: '🌀', label: t('settings.weatherSystem.modeTyphoon') },
    { value: 'blizzard', icon: '❄️', label: t('settings.weatherSystem.modeBlizzard') },
    { value: 'hail', icon: '🧊', label: t('settings.weatherSystem.modeHail') },
    { value: 'sandstorm', icon: '🏜️', label: t('settings.weatherSystem.modeSandstorm') },
    { value: 'meteor', icon: '☄️', label: t('settings.weatherSystem.modeMeteor') },
    { value: 'aurora', icon: '🌌', label: t('settings.weatherSystem.modeAurora') },
    { value: 'fog', icon: '🌫️', label: t('settings.weatherSystem.modeFog') },
    { value: 'sunny', icon: '🌤️', label: t('settings.weatherSystem.modeSunny') },
    { value: 'idle', icon: '⏸️', label: t('settings.weatherSystem.modeIdle') }
  ]
)

function selectMode(mode: 'auto' | WeatherKind): void {
  setWeatherManualMode(mode)
}

function onShuffleNow(): void {
  shuffleWeatherNow()
}

function toggleSfx(): void {
  setWeatherSfxEnabled(!weatherSfxEnabled.value)
}

function toggleBgm(): void {
  setWeatherBgmEnabled(!weatherBgmEnabled.value)
}

function fireManualStrike(): void {
  if (currentWeather.value === 'idle') {
    setWeatherManualMode('thunderstorm')
  }
  triggerWeatherLightningStrike({
    visibleNodes: props.visibleNodes,
    intensity: 1.15
  })
}

// --- Particle & Phenomenon State ---

interface RainDrop {
  x: number
  y: number
  len: number
  speed: number
  windSlope: number
  alpha: number
}

interface SplashParticle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  life: number
  maxLife: number
  color?: string
}

interface WindStreak {
  x: number
  y: number
  len: number
  speed: number
  amp: number
  freq: number
  phase: number
  alpha: number
  width: number
}

interface LeafParticle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  size: number
  hue: number
  alpha: number
}

interface SnowflakeParticle {
  x: number
  y: number
  radius: number
  speedY: number
  speedX: number
  swayAmp: number
  swayFreq: number
  phase: number
  alpha: number
  crystalline: boolean
}

interface HailStone {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vrot: number
  bounced: boolean
  alpha: number
}

interface SandGrain {
  x: number
  y: number
  speedX: number
  speedY: number
  size: number
  alpha: number
  hue: number
}

interface MeteorStreak {
  x: number
  y: number
  vx: number
  vy: number
  len: number
  size: number
  hue: number
  life: number
  maxLife: number
}

interface StarPoint {
  x: number
  y: number
  radius: number
  phase: number
  speed: number
}

interface FogBank {
  x: number
  y: number
  rx: number
  ry: number
  speedX: number
  alpha: number
  phase: number
}

interface SunMote {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  phase: number
}

interface RenderedBolt {
  id: number
  segments: Array<{ x1: number; y1: number; x2: number; y2: number; main: boolean }>
  targetX: number
  targetY: number
  createdAt: number
  durationMs: number
}

const raindrops: RainDrop[] = []
const splashes: SplashParticle[] = []
const windStreaks: WindStreak[] = []
const leaves: LeafParticle[] = []
const snowflakes: SnowflakeParticle[] = []
const hailstones: HailStone[] = []
const sandGrains: SandGrain[] = []
const meteors: MeteorStreak[] = []
const stars: StarPoint[] = []
const fogBanks: FogBank[] = []
const sunMotes: SunMote[] = []
const activeBolts: RenderedBolt[] = []
const seenLightningIds = new Set<number>()

let rafId: number | null = null
let resizeObserver: ResizeObserver | null = null
let viewportW = 1280
let viewportH = 720
let lastFrameTime = performance.now()
let nextAutoLightningAt = 0
let nextMeteorSpawnAt = 0

function initParticles(w: number, h: number): void {
  raindrops.length = 0
  for (let i = 0; i < 190; i++) {
    raindrops.push({
      x: Math.random() * (w + 300) - 150,
      y: Math.random() * h,
      len: 16 + Math.random() * 22,
      speed: 780 + Math.random() * 520,
      windSlope: 0.24 + Math.random() * 0.12,
      alpha: 0.25 + Math.random() * 0.45
    })
  }

  windStreaks.length = 0
  for (let i = 0; i < 38; i++) {
    windStreaks.push({
      x: Math.random() * w,
      y: Math.random() * h,
      len: 110 + Math.random() * 190,
      speed: 420 + Math.random() * 440,
      amp: 6 + Math.random() * 16,
      freq: 0.012 + Math.random() * 0.018,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.14 + Math.random() * 0.28,
      width: 1 + Math.random() * 1.8
    })
  }

  leaves.length = 0
  for (let i = 0; i < 28; i++) {
    leaves.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 220 + Math.random() * 240,
      vy: -30 + Math.random() * 90,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 8,
      size: 4 + Math.random() * 5,
      hue: 155 + Math.random() * 45,
      alpha: 0.45 + Math.random() * 0.4
    })
  }

  snowflakes.length = 0
  for (let i = 0; i < 145; i++) {
    const radius = 1.4 + Math.random() * 4.2
    snowflakes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      radius,
      speedY: 75 + radius * 28 + Math.random() * 45,
      speedX: 95 + Math.random() * 110,
      swayAmp: 18 + Math.random() * 28,
      swayFreq: 1.5 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.45 + Math.random() * 0.5,
      crystalline: radius > 4.2
    })
  }

  hailstones.length = 0
  for (let i = 0; i < 85; i++) {
    hailstones.push({
      x: Math.random() * (w + 200) - 100,
      y: Math.random() * h,
      vx: 140 + Math.random() * 90,
      vy: 680 + Math.random() * 420,
      size: 3.2 + Math.random() * 3.8,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 14,
      bounced: false,
      alpha: 0.65 + Math.random() * 0.3
    })
  }

  sandGrains.length = 0
  for (let i = 0; i < 210; i++) {
    sandGrains.push({
      x: Math.random() * w,
      y: Math.random() * h,
      speedX: 520 + Math.random() * 560,
      speedY: (Math.random() - 0.45) * 90,
      size: 1.2 + Math.random() * 2.8,
      alpha: 0.25 + Math.random() * 0.45,
      hue: 28 + Math.random() * 20
    })
  }

  stars.length = 0
  for (let i = 0; i < 95; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.85,
      radius: 0.8 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      speed: 1.8 + Math.random() * 3.2
    })
  }

  fogBanks.length = 0
  for (let i = 0; i < 14; i++) {
    fogBanks.push({
      x: Math.random() * w,
      y: (i / 14) * h + (Math.random() - 0.5) * 80,
      rx: 260 + Math.random() * 320,
      ry: 70 + Math.random() * 95,
      speedX: (i % 2 === 0 ? 1 : -1) * (18 + Math.random() * 28),
      alpha: 0.08 + Math.random() * 0.1,
      phase: Math.random() * Math.PI * 2
    })
  }

  sunMotes.length = 0
  for (let i = 0; i < 55; i++) {
    sunMotes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 12 + Math.random() * 18,
      vy: -18 - Math.random() * 26,
      radius: 1.5 + Math.random() * 3.2,
      alpha: 0.25 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2
    })
  }
}

function buildLightningGeometry(
  id: number,
  targetX: number,
  targetY: number,
  createdAt: number
): RenderedBolt {
  const startX = Math.max(40, Math.min(viewportW - 40, targetX + (Math.random() - 0.5) * 260))
  const startY = -10
  const segments: RenderedBolt['segments'] = []

  const steps = 14
  let prevX = startX
  let prevY = startY

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const jitter = i === steps ? 0 : (Math.random() - 0.5) * 68 * (1 - t * 0.45)
    const nextX = startX + (targetX - startX) * t + jitter
    const nextY = startY + (targetY - startY) * t
    segments.push({ x1: prevX, y1: prevY, x2: nextX, y2: nextY, main: true })

    if (i > 2 && i < steps - 1 && Math.random() < 0.42) {
      let bx = nextX
      let by = nextY
      const bSteps = 3 + Math.floor(Math.random() * 4)
      const dir = Math.random() < 0.5 ? -1 : 1
      for (let b = 0; b < bSteps; b++) {
        const nbx = bx + dir * (18 + Math.random() * 32)
        const nby = by + 22 + Math.random() * 30
        segments.push({ x1: bx, y1: by, x2: nbx, y2: nby, main: false })
        bx = nbx
        by = nby
      }
    }

    prevX = nextX
    prevY = nextY
  }

  return {
    id,
    segments,
    targetX,
    targetY,
    createdAt,
    durationMs: 460
  }
}

function updateCanvasSize(): void {
  const el = rootEl.value
  const cvs = canvasEl.value
  if (!el || !cvs) return
  const rect = el.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  viewportW = Math.max(1, Math.floor(rect.width))
  viewportH = Math.max(1, Math.floor(rect.height))
  cvs.width = Math.floor(viewportW * dpr)
  cvs.height = Math.floor(viewportH * dpr)
  const ctx = cvs.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  if (raindrops.length === 0) {
    initParticles(viewportW, viewportH)
  }
}

function spawnSplash(x: number, y: number, count = 4, color?: string, speedScale = 1): void {
  if (splashes.length > 220) return
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI * (0.15 + Math.random() * 0.7)
    const speed = (45 + Math.random() * 115) * speedScale
    splashes.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 1.2 + Math.random() * 1.8,
      alpha: 0.8,
      life: 0,
      maxLife: 0.24 + Math.random() * 0.2,
      color
    })
  }
}

function renderFrame(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) * 0.001))
  lastFrameTime = now

  const weather = currentWeather.value
  const nodes = props.visibleNodes

  // Step per-node physics every frame when weather is active or nodes are settling
  if (weather !== 'idle' || Object.keys(canvasWeatherState.nodeTransforms.value).length > 0) {
    stepNodeWeatherPhysics(nodes, dt, viewportW, viewportH, Boolean(props.suppressNodePhysics))
  }

  const cvs = canvasEl.value
  if (!cvs) {
    rafId = requestAnimationFrame(renderFrame)
    return
  }
  const ctx = cvs.getContext('2d')
  if (!ctx) {
    rafId = requestAnimationFrame(renderFrame)
    return
  }

  ctx.clearRect(0, 0, viewportW, viewportH)

  if (weather === 'idle' && activeBolts.length === 0 && splashes.length === 0) {
    rafId = requestAnimationFrame(renderFrame)
    return
  }

  // Ingest newly triggered lightning events from the engine
  for (const ev of canvasWeatherState.lightningEvents.value) {
    if (!seenLightningIds.has(ev.id)) {
      seenLightningIds.add(ev.id)
      activeBolts.push(
        buildLightningGeometry(ev.id, ev.targetScreenX, ev.targetScreenY, ev.createdAt)
      )
    }
  }

  // Periodic automatic lightning strikes during thunderstorm & typhoon
  if ((weather === 'thunderstorm' || weather === 'typhoon') && now > nextAutoLightningAt) {
    const interval =
      weather === 'thunderstorm' ? 1900 + Math.random() * 2300 : 2800 + Math.random() * 3000
    nextAutoLightningAt = now + interval
    triggerWeatherLightningStrike({
      visibleNodes: nodes,
      intensity: weather === 'typhoon' ? 0.9 : 1.05
    })
  }

  // 1. Atmospheric Sky Backdrop Tint
  drawAtmosphereTint(ctx, weather, now)

  // 2. Typhoon Vortex Spiral Eye
  if (weather === 'typhoon') {
    drawTyphoonVortex(ctx, now)
  }

  // 3. Aurora Borealis Curtains
  if (weather === 'aurora') {
    drawAuroraSpectacle(ctx, dt, now, nodes)
  }

  // 4. Meteor Shower & Starry Sky
  if (weather === 'meteor') {
    drawMeteorShower(ctx, dt, now, nodes)
  }

  // 5. Wind Streaks & Leaves (Wind, Thunderstorm, Typhoon)
  if (weather === 'wind' || weather === 'thunderstorm' || weather === 'typhoon') {
    drawWindAndLeaves(ctx, weather, dt, now, nodes)
  }

  // 6. Blizzard Snowflakes & Node Snow Caps
  if (weather === 'blizzard') {
    drawBlizzardSnow(ctx, dt, now, nodes)
  }

  // 7. Hailstorm Ice Bombardment
  if (weather === 'hail') {
    drawHailstorm(ctx, dt, nodes)
  }

  // 8. Sandstorm Desert Gale
  if (weather === 'sandstorm') {
    drawSandstorm(ctx, dt, now, nodes)
  }

  // 9. Dense Valley Fog & Mist
  if (weather === 'fog') {
    drawDenseFog(ctx, dt, now)
  }

  // 10. Raindrops & Node Top-Edge Collision Splashes
  if (
    weather === 'rain' ||
    weather === 'thunderstorm' ||
    weather === 'typhoon' ||
    splashes.length > 0
  ) {
    drawRainAndSplashes(ctx, weather, dt, nodes)
  }

  // 11. Branching Lightning Bolts & Impact Shockwaves
  if (activeBolts.length > 0) {
    drawLightningBolts(ctx, now)
  }

  // 12. Sunny Clear Sky (God Rays, Rainbow Arc, Golden Motes)
  if (weather === 'sunny') {
    drawSunnySpectacle(ctx, dt, now)
  }

  rafId = requestAnimationFrame(renderFrame)
}

function drawAtmosphereTint(
  ctx: CanvasRenderingContext2D,
  weather: WeatherKind,
  now: number
): void {
  if (weather === 'idle') return
  ctx.save()
  const grad = ctx.createLinearGradient(0, 0, 0, viewportH)
  if (weather === 'wind') {
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.08)')
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.04)')
  } else if (weather === 'rain') {
    grad.addColorStop(0, 'rgba(30, 58, 138, 0.14)')
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.10)')
  } else if (weather === 'thunderstorm') {
    grad.addColorStop(0, 'rgba(49, 46, 129, 0.18)')
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.14)')
  } else if (weather === 'typhoon') {
    grad.addColorStop(0, 'rgba(13, 148, 136, 0.16)')
    grad.addColorStop(0.5, 'rgba(30, 41, 59, 0.16)')
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.18)')
  } else if (weather === 'blizzard') {
    grad.addColorStop(0, 'rgba(186, 230, 253, 0.16)')
    grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.09)')
    grad.addColorStop(1, 'rgba(224, 242, 254, 0.12)')
  } else if (weather === 'hail') {
    grad.addColorStop(0, 'rgba(51, 65, 85, 0.20)')
    grad.addColorStop(1, 'rgba(14, 116, 144, 0.12)')
  } else if (weather === 'sandstorm') {
    grad.addColorStop(0, 'rgba(217, 119, 6, 0.18)')
    grad.addColorStop(0.55, 'rgba(180, 83, 9, 0.14)')
    grad.addColorStop(1, 'rgba(120, 53, 15, 0.16)')
  } else if (weather === 'meteor') {
    grad.addColorStop(0, 'rgba(30, 27, 75, 0.24)')
    grad.addColorStop(0.6, 'rgba(49, 46, 129, 0.14)')
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.08)')
  } else if (weather === 'aurora') {
    grad.addColorStop(0, 'rgba(6, 95, 70, 0.18)')
    grad.addColorStop(0.5, 'rgba(88, 28, 135, 0.12)')
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.08)')
  } else if (weather === 'fog') {
    grad.addColorStop(0, 'rgba(148, 163, 184, 0.16)')
    grad.addColorStop(0.6, 'rgba(100, 116, 139, 0.14)')
    grad.addColorStop(1, 'rgba(71, 85, 105, 0.18)')
  } else if (weather === 'sunny') {
    const pulse = 0.85 + Math.sin(now * 0.002) * 0.15
    grad.addColorStop(0, `rgba(251, 191, 36, ${0.15 * pulse})`)
    grad.addColorStop(0.45, `rgba(56, 189, 248, ${0.07 * pulse})`)
    grad.addColorStop(1, 'rgba(253, 224, 71, 0.03)')
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, viewportW, viewportH)
  ctx.restore()
}

function drawTyphoonVortex(ctx: CanvasRenderingContext2D, now: number): void {
  const cx = vortexEyeNorm.x * viewportW
  const cy = vortexEyeNorm.y * viewportH
  const maxR = Math.hypot(viewportW, viewportH) * 0.62

  ctx.save()
  ctx.translate(cx, cy)

  const eyeGrad = ctx.createRadialGradient(0, 0, 18, 0, 0, maxR)
  eyeGrad.addColorStop(0, 'rgba(45, 212, 191, 0.02)')
  eyeGrad.addColorStop(0.12, 'rgba(56, 189, 248, 0.14)')
  eyeGrad.addColorStop(0.38, 'rgba(99, 102, 241, 0.09)')
  eyeGrad.addColorStop(1, 'rgba(15, 23, 42, 0)')
  ctx.fillStyle = eyeGrad
  ctx.beginPath()
  ctx.arc(0, 0, maxR, 0, Math.PI * 2)
  ctx.fill()

  const baseAngle = -now * 0.0024
  ctx.lineCap = 'round'
  for (let arm = 0; arm < 5; arm++) {
    const armOffset = (arm * Math.PI * 2) / 5
    ctx.beginPath()
    for (let s = 0; s <= 55; s++) {
      const ratio = s / 55
      const r = 34 + ratio * maxR * 0.85
      const theta = baseAngle + armOffset + ratio * 4.2
      const px = Math.cos(theta) * r
      const py = Math.sin(theta) * r * 0.82
      if (s === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = arm % 2 === 0 ? 'rgba(125, 211, 252, 0.16)' : 'rgba(167, 243, 208, 0.13)'
    ctx.lineWidth = 2.2
    ctx.stroke()
  }

  ctx.restore()
}

function drawBlizzardSnow(
  ctx: CanvasRenderingContext2D,
  dt: number,
  now: number,
  nodes: WeatherNodeRect[]
): void {
  ctx.save()

  // Frosty vignette along screen borders
  const frostGrad = ctx.createRadialGradient(
    viewportW * 0.5,
    viewportH * 0.5,
    Math.min(viewportW, viewportH) * 0.32,
    viewportW * 0.5,
    viewportH * 0.5,
    Math.max(viewportW, viewportH) * 0.72
  )
  frostGrad.addColorStop(0, 'rgba(224, 242, 254, 0)')
  frostGrad.addColorStop(1, 'rgba(186, 230, 253, 0.22)')
  ctx.fillStyle = frostGrad
  ctx.fillRect(0, 0, viewportW, viewportH)

  // Draw snowdrifts accumulated on top of visible nodes
  ctx.fillStyle = 'rgba(240, 249, 255, 0.72)'
  for (const node of nodes) {
    if (node.screenWidth < 30) continue
    ctx.beginPath()
    const left = node.screenX + 6
    const right = node.screenX + node.screenWidth - 6
    const top = node.screenY
    ctx.moveTo(left, top + 2)
    const segments = 6
    for (let i = 1; i <= segments; i++) {
      const ratio = i / segments
      const px = left + (right - left) * ratio
      const mound = Math.sin(ratio * Math.PI) * 5.5
      ctx.lineTo(px, top - mound)
    }
    ctx.lineTo(right, top + 2)
    ctx.closePath()
    ctx.fill()
  }

  // Swirling snowflakes
  for (const flake of snowflakes) {
    flake.x +=
      (flake.speedX + Math.sin(now * 0.001 * flake.swayFreq + flake.phase) * flake.swayAmp) * dt
    flake.y += flake.speedY * dt

    if (flake.y > viewportH + 15) {
      flake.y = -12
      flake.x = Math.random() * (viewportW + 200) - 100
    }
    if (flake.x > viewportW + 20) flake.x = -15
    if (flake.x < -20) flake.x = viewportW + 15

    if (flake.crystalline) {
      // 6-pointed ice crystal starflake
      ctx.save()
      ctx.translate(flake.x, flake.y)
      ctx.rotate(now * 0.0008 + flake.phase)
      ctx.strokeStyle = `rgba(240, 249, 255, ${flake.alpha})`
      ctx.lineWidth = 1.2
      for (let k = 0; k < 3; k++) {
        ctx.rotate(Math.PI / 3)
        ctx.beginPath()
        ctx.moveTo(-flake.radius, 0)
        ctx.lineTo(flake.radius, 0)
        ctx.stroke()
      }
      ctx.restore()
    } else {
      ctx.fillStyle = `rgba(240, 249, 255, ${flake.alpha})`
      ctx.beginPath()
      ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

function drawHailstorm(ctx: CanvasRenderingContext2D, dt: number, nodes: WeatherNodeRect[]): void {
  ctx.save()

  for (const stone of hailstones) {
    const prevY = stone.y
    stone.x += stone.vx * dt
    stone.y += stone.vy * dt
    stone.rot += stone.vrot * dt
    if (stone.bounced) {
      stone.vy += 980 * dt
    }

    // Collide with node roofs -> bounce high & shatter into icy shards!
    if (!stone.bounced) {
      for (const node of nodes) {
        const topY = node.screenY
        if (
          prevY <= topY &&
          stone.y >= topY &&
          stone.x >= node.screenX + 4 &&
          stone.x <= node.screenX + node.screenWidth - 4
        ) {
          stone.y = topY - 2
          stone.vy = -(220 + Math.random() * 180)
          stone.vx = (Math.random() - 0.5) * 260
          stone.bounced = true
          spawnSplash(stone.x, topY, 5, 'rgba(186, 230, 253, 0.9)', 1.35)
          if (Math.random() < 0.45) {
            const hitRatio = (stone.x - node.screenX) / Math.max(1, node.screenWidth)
            applyHailstoneNodeImpact(node.id, hitRatio)
          }
          break
        }
      }
    }

    if (stone.y > viewportH + 30 || stone.x > viewportW + 160 || stone.x < -160) {
      stone.y = -20 - Math.random() * 120
      stone.x = Math.random() * (viewportW + 240) - 120
      stone.vx = 140 + Math.random() * 90
      stone.vy = 680 + Math.random() * 420
      stone.bounced = false
    }

    // Draw faceted diamond hailstone
    ctx.save()
    ctx.translate(stone.x, stone.y)
    ctx.rotate(stone.rot)
    ctx.fillStyle = `rgba(224, 242, 254, ${stone.alpha})`
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, -stone.size)
    ctx.lineTo(stone.size * 0.85, 0)
    ctx.lineTo(0, stone.size)
    ctx.lineTo(-stone.size * 0.85, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

function drawSandstorm(
  ctx: CanvasRenderingContext2D,
  dt: number,
  now: number,
  nodes: WeatherNodeRect[]
): void {
  ctx.save()

  // Rolling desert dust waves
  for (let b = 0; b < 4; b++) {
    const waveY = viewportH * (0.2 + b * 0.22) + Math.sin(now * 0.0015 + b) * 35
    const dustGrad = ctx.createLinearGradient(0, waveY - 120, 0, waveY + 120)
    dustGrad.addColorStop(0, 'rgba(245, 158, 11, 0)')
    dustGrad.addColorStop(0.5, 'rgba(217, 119, 6, 0.08)')
    dustGrad.addColorStop(1, 'rgba(180, 83, 9, 0)')
    ctx.fillStyle = dustGrad
    ctx.fillRect(0, waveY - 120, viewportW, 240)
  }

  // Fast horizontal sand grains & dune streaks
  for (const grain of sandGrains) {
    grain.x += grain.speedX * dt
    grain.y += (grain.speedY + Math.sin(now * 0.004 + grain.x * 0.01) * 35) * dt

    // Deflect over node roofs
    for (const node of nodes) {
      if (
        grain.x >= node.screenX &&
        grain.x <= node.screenX + node.screenWidth &&
        grain.y >= node.screenY &&
        grain.y <= node.screenY + 24
      ) {
        grain.y = node.screenY - 3
        break
      }
    }

    if (grain.x > viewportW + 40) {
      grain.x = -30
      grain.y = Math.random() * viewportH
    }
    if (grain.y < -20) grain.y = viewportH + 15
    if (grain.y > viewportH + 20) grain.y = -15

    ctx.strokeStyle = `hsla(${grain.hue}, 88%, 68%, ${grain.alpha})`
    ctx.lineWidth = grain.size
    ctx.beginPath()
    ctx.moveTo(grain.x, grain.y)
    ctx.lineTo(grain.x - grain.size * 7, grain.y - grain.speedY * 0.015)
    ctx.stroke()
  }

  ctx.restore()
}

function drawMeteorShower(
  ctx: CanvasRenderingContext2D,
  dt: number,
  now: number,
  nodes: WeatherNodeRect[]
): void {
  ctx.save()

  // 1. Twinkling starry night backdrop
  for (const star of stars) {
    const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(now * 0.001 * star.speed + star.phase))
    ctx.fillStyle = `rgba(224, 231, 255, ${twinkle * 0.8})`
    ctx.beginPath()
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // 2. Spawn shooting stars periodically
  if (now > nextMeteorSpawnAt && meteors.length < 7) {
    nextMeteorSpawnAt = now + 420 + Math.random() * 680
    const startX = Math.random() * viewportW * 0.85
    const startY = -30
    const angle = Math.PI * (0.18 + Math.random() * 0.14)
    const speed = 780 + Math.random() * 480
    meteors.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      len: 110 + Math.random() * 130,
      size: 2.2 + Math.random() * 2.0,
      hue: Math.random() < 0.5 ? 45 : 265,
      life: 0,
      maxLife: 1.1 + Math.random() * 0.6
    })
  }

  // 3. Update & render shooting stars
  ctx.lineCap = 'round'
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]!
    m.life += dt
    m.x += m.vx * dt
    m.y += m.vy * dt

    // Check if meteor hits or grazes a visible node card
    for (const node of nodes) {
      if (
        m.x >= node.screenX &&
        m.x <= node.screenX + node.screenWidth &&
        m.y >= node.screenY &&
        m.y <= node.screenY + Math.min(48, node.screenHeight * 0.4)
      ) {
        spawnSplash(m.x, m.y, 10, 'rgba(253, 224, 71, 0.95)', 1.7)
        const mag = Math.max(1, Math.hypot(m.vx, m.vy))
        applyMeteorNodeImpact(node.id, m.vx / mag, m.vy / mag)
        m.life = m.maxLife
        break
      }
    }

    if (m.life >= m.maxLife || m.x > viewportW + 200 || m.y > viewportH + 200) {
      meteors.splice(i, 1)
      continue
    }

    const fade = 1 - m.life / m.maxLife
    const mag = Math.max(1, Math.hypot(m.vx, m.vy))
    const tailX = m.x - (m.vx / mag) * m.len
    const tailY = m.y - (m.vy / mag) * m.len

    const tailGrad = ctx.createLinearGradient(tailX, tailY, m.x, m.y)
    tailGrad.addColorStop(0, `hsla(${m.hue}, 95%, 75%, 0)`)
    tailGrad.addColorStop(0.7, `hsla(${m.hue}, 95%, 75%, ${0.55 * fade})`)
    tailGrad.addColorStop(1, `rgba(255, 255, 255, ${0.98 * fade})`)

    ctx.strokeStyle = tailGrad
    ctx.lineWidth = m.size
    ctx.beginPath()
    ctx.moveTo(tailX, tailY)
    ctx.lineTo(m.x, m.y)
    ctx.stroke()

    // Glowing meteor head
    ctx.fillStyle = `rgba(254, 249, 195, ${0.95 * fade})`
    ctx.beginPath()
    ctx.arc(m.x, m.y, m.size * 1.4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function drawAuroraSpectacle(
  ctx: CanvasRenderingContext2D,
  dt: number,
  now: number,
  nodes: WeatherNodeRect[]
): void {
  ctx.save()

  // Undulating Aurora Borealis curtains across the upper/mid viewport
  const ribbons = [
    {
      yBase: viewportH * 0.22,
      height: 190,
      colorA: 'rgba(52, 211, 153, 0.22)',
      colorB: 'rgba(56, 189, 248, 0.08)',
      speed: 0.0012,
      phase: 0
    },
    {
      yBase: viewportH * 0.34,
      height: 210,
      colorA: 'rgba(192, 132, 252, 0.18)',
      colorB: 'rgba(52, 211, 153, 0.06)',
      speed: -0.0015,
      phase: 2.1
    },
    {
      yBase: viewportH * 0.16,
      height: 160,
      colorA: 'rgba(56, 189, 248, 0.20)',
      colorB: 'rgba(167, 139, 250, 0.05)',
      speed: 0.0018,
      phase: 4.2
    }
  ]

  const cols = 42
  const colW = viewportW / cols

  for (const rib of ribbons) {
    for (let c = 0; c <= cols; c++) {
      const x = c * colW
      const wave =
        Math.sin(c * 0.22 + now * rib.speed + rib.phase) * 38 +
        Math.cos(c * 0.11 - now * rib.speed * 1.4) * 22
      const topY = rib.yBase + wave - rib.height * 0.5
      const botY = topY + rib.height

      const curtainGrad = ctx.createLinearGradient(x, topY, x, botY)
      curtainGrad.addColorStop(0, 'rgba(16, 185, 129, 0)')
      curtainGrad.addColorStop(0.35, rib.colorA)
      curtainGrad.addColorStop(0.75, rib.colorB)
      curtainGrad.addColorStop(1, 'rgba(15, 23, 42, 0)')

      ctx.fillStyle = curtainGrad
      ctx.fillRect(x, topY, colW + 1.5, rib.height)
    }
  }

  // Rising geomagnetic plasma motes
  for (const mote of sunMotes) {
    mote.x += Math.sin(now * 0.002 + mote.phase) * 22 * dt
    mote.y += mote.vy * 1.15 * dt
    if (mote.y < -20) {
      mote.y = viewportH + 15
      mote.x = Math.random() * viewportW
    }
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005 + mote.phase)
    ctx.fillStyle =
      mote.phase > Math.PI
        ? `rgba(52, 211, 153, ${mote.alpha * pulse})`
        : `rgba(192, 132, 252, ${mote.alpha * pulse})`
    ctx.beginPath()
    ctx.arc(mote.x, mote.y, mote.radius * 1.1, 0, Math.PI * 2)
    ctx.fill()
  }

  // Subtle geomagnetic resonance Halo around visible nodes
  if (nodes.length > 0) {
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.18)'
    ctx.lineWidth = 1.5
    for (const node of nodes) {
      ctx.strokeRect(
        node.screenX - 2,
        node.screenY - 2,
        node.screenWidth + 4,
        node.screenHeight + 4
      )
    }
  }

  ctx.restore()
}

function drawDenseFog(ctx: CanvasRenderingContext2D, dt: number, now: number): void {
  ctx.save()

  for (const bank of fogBanks) {
    bank.x += bank.speedX * dt
    if (bank.speedX > 0 && bank.x - bank.rx > viewportW + 100) {
      bank.x = -bank.rx - 60
    } else if (bank.speedX < 0 && bank.x + bank.rx < -100) {
      bank.x = viewportW + bank.rx + 60
    }

    const breathe = 0.85 + 0.15 * Math.sin(now * 0.0012 + bank.phase)
    const grad = ctx.createRadialGradient(bank.x, bank.y, 10, bank.x, bank.y, bank.rx)
    grad.addColorStop(0, `rgba(226, 232, 240, ${bank.alpha * breathe})`)
    grad.addColorStop(0.55, `rgba(148, 163, 184, ${bank.alpha * 0.65 * breathe})`)
    grad.addColorStop(1, 'rgba(148, 163, 184, 0)')

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(bank.x, bank.y, bank.rx, bank.ry * breathe, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function drawWindAndLeaves(
  ctx: CanvasRenderingContext2D,
  weather: WeatherKind,
  dt: number,
  now: number,
  nodes: WeatherNodeRect[]
): void {
  const speedMul = weather === 'typhoon' ? 1.85 : weather === 'thunderstorm' ? 1.35 : 1.0
  const eyeX = vortexEyeNorm.x * viewportW
  const eyeY = vortexEyeNorm.y * viewportH

  ctx.save()
  ctx.lineCap = 'round'

  for (const streak of windStreaks) {
    streak.x += streak.speed * speedMul * dt
    streak.y += Math.sin(now * 0.002 + streak.phase) * 28 * dt
    if (streak.x - streak.len > viewportW + 80) {
      streak.x = -streak.len - Math.random() * 120
      streak.y = Math.random() * viewportH
    }

    ctx.beginPath()
    const segs = 8
    for (let i = 0; i <= segs; i++) {
      const ratio = i / segs
      const sx = streak.x - (1 - ratio) * streak.len
      const sy = streak.y + Math.sin(sx * streak.freq + now * 0.006 + streak.phase) * streak.amp
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }

    const grad = ctx.createLinearGradient(streak.x - streak.len, streak.y, streak.x, streak.y)
    grad.addColorStop(0, 'rgba(186, 230, 253, 0)')
    grad.addColorStop(0.5, `rgba(186, 230, 253, ${streak.alpha})`)
    grad.addColorStop(1, 'rgba(224, 242, 254, 0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = streak.width
    ctx.stroke()
  }

  for (const leaf of leaves) {
    if (weather === 'typhoon') {
      const rx = leaf.x - eyeX
      const ry = leaf.y - eyeY
      const dist = Math.max(35, Math.hypot(rx, ry))
      const tx = -ry / dist
      const ty = rx / dist
      leaf.vx = tx * 460 - (rx / dist) * 75
      leaf.vy = ty * 460 - (ry / dist) * 75
    } else {
      leaf.vx = (280 + Math.sin(now * 0.003 + leaf.size) * 90) * speedMul
      leaf.vy = Math.cos(now * 0.004 + leaf.hue) * 55
    }

    leaf.x += leaf.vx * dt
    leaf.y += leaf.vy * dt
    leaf.rot += leaf.vrot * dt

    for (const node of nodes) {
      if (
        leaf.x >= node.screenX &&
        leaf.x <= node.screenX + node.screenWidth &&
        leaf.y >= node.screenY &&
        leaf.y <= node.screenY + node.screenHeight
      ) {
        leaf.y = node.screenY - 4
        leaf.vy = -Math.abs(leaf.vy) - 45
        break
      }
    }

    if (leaf.x > viewportW + 40) {
      leaf.x = -30
      leaf.y = Math.random() * viewportH
    } else if (leaf.x < -40) {
      leaf.x = viewportW + 30
    }
    if (leaf.y > viewportH + 40) leaf.y = -20
    if (leaf.y < -40) leaf.y = viewportH + 20

    ctx.save()
    ctx.translate(leaf.x, leaf.y)
    ctx.rotate(leaf.rot)
    ctx.fillStyle = `hsla(${leaf.hue}, 85%, 72%, ${leaf.alpha})`
    ctx.beginPath()
    ctx.ellipse(0, 0, leaf.size * 1.4, leaf.size * 0.65, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

function drawRainAndSplashes(
  ctx: CanvasRenderingContext2D,
  weather: WeatherKind,
  dt: number,
  nodes: WeatherNodeRect[]
): void {
  const isRaining = weather === 'rain' || weather === 'thunderstorm' || weather === 'typhoon'
  const slopeMul = weather === 'typhoon' ? 1.85 : weather === 'thunderstorm' ? 1.3 : 0.85
  const speedMul = weather === 'typhoon' ? 1.35 : 1.0

  ctx.save()
  ctx.lineCap = 'round'

  if (isRaining) {
    ctx.lineWidth = 1.35
    for (const drop of raindrops) {
      const prevY = drop.y
      const vx = drop.speed * drop.windSlope * slopeMul
      const vy = drop.speed * speedMul
      drop.x += vx * dt
      drop.y += vy * dt

      let hitNode = false
      for (const node of nodes) {
        const topY = node.screenY
        if (
          prevY <= topY &&
          drop.y >= topY &&
          drop.x >= node.screenX + 4 &&
          drop.x <= node.screenX + node.screenWidth - 4
        ) {
          spawnSplash(drop.x, topY, 3)
          if (Math.random() < 0.22) {
            const hitRatio = (drop.x - node.screenX) / Math.max(1, node.screenWidth)
            applyRaindropNodeImpact(node.id, hitRatio)
          }
          drop.y = -20 - Math.random() * 140
          drop.x = Math.random() * (viewportW + 300) - 200
          hitNode = true
          break
        }
      }

      if (!hitNode) {
        if (drop.y > viewportH + 30 || drop.x > viewportW + 180) {
          drop.y = -20 - Math.random() * 80
          drop.x = Math.random() * (viewportW + 350) - 250
        } else {
          const dx = drop.len * drop.windSlope * slopeMul
          const dy = drop.len
          ctx.strokeStyle = `rgba(186, 230, 253, ${drop.alpha})`
          ctx.beginPath()
          ctx.moveTo(drop.x, drop.y)
          ctx.lineTo(drop.x - dx, drop.y - dy)
          ctx.stroke()
        }
      }
    }
  }

  for (let i = splashes.length - 1; i >= 0; i--) {
    const sp = splashes[i]!
    sp.life += dt
    if (sp.life >= sp.maxLife) {
      splashes.splice(i, 1)
      continue
    }
    sp.vy += 420 * dt
    sp.x += sp.vx * dt
    sp.y += sp.vy * dt
    const fade = 1 - sp.life / sp.maxLife
    ctx.fillStyle = sp.color ?? `rgba(224, 242, 254, ${sp.alpha * fade})`
    ctx.beginPath()
    ctx.arc(sp.x, sp.y, sp.radius * fade, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function drawLightningBolts(ctx: CanvasRenderingContext2D, now: number): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let i = activeBolts.length - 1; i >= 0; i--) {
    const bolt = activeBolts[i]!
    const age = now - bolt.createdAt
    if (age >= bolt.durationMs) {
      activeBolts.splice(i, 1)
      continue
    }

    const lifeRatio = 1 - age / bolt.durationMs
    const flicker = age < 130 ? (Math.floor(age / 25) % 2 === 0 ? 1 : 0.45) : lifeRatio

    if (age < 120) {
      ctx.fillStyle = `rgba(224, 242, 254, ${(1 - age / 120) * 0.22})`
      ctx.fillRect(0, 0, viewportW, viewportH)
    }

    ctx.shadowColor = 'rgba(125, 211, 252, 0.95)'
    ctx.shadowBlur = 18
    for (const seg of bolt.segments) {
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.strokeStyle = seg.main
        ? `rgba(224, 242, 254, ${0.95 * flicker})`
        : `rgba(165, 243, 252, ${0.65 * flicker})`
      ctx.lineWidth = seg.main ? 3.2 * lifeRatio + 1 : 1.4 * lifeRatio
      ctx.stroke()
    }

    const ringProgress = age / bolt.durationMs
    const ringRadius = 14 + ringProgress * 135
    ctx.shadowBlur = 0
    ctx.strokeStyle = `rgba(125, 211, 252, ${(1 - ringProgress) * 0.75})`
    ctx.lineWidth = 2.4 * (1 - ringProgress)
    ctx.beginPath()
    ctx.arc(bolt.targetX, bolt.targetY, ringRadius, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()
}

function drawSunnySpectacle(ctx: CanvasRenderingContext2D, dt: number, now: number): void {
  ctx.save()

  const sunX = viewportW * 0.84
  const sunY = viewportH * 0.12

  const sunGlow = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, viewportW * 0.55)
  sunGlow.addColorStop(0, 'rgba(254, 240, 138, 0.42)')
  sunGlow.addColorStop(0.25, 'rgba(253, 224, 71, 0.18)')
  sunGlow.addColorStop(0.6, 'rgba(251, 191, 36, 0.06)')
  sunGlow.addColorStop(1, 'rgba(251, 191, 36, 0)')
  ctx.fillStyle = sunGlow
  ctx.fillRect(0, 0, viewportW, viewportH)

  for (let r = 0; r < 7; r++) {
    const angle = Math.PI * 0.58 + r * 0.11 + Math.sin(now * 0.0008 + r) * 0.03
    const spread = 0.038
    const beamLen = Math.hypot(viewportW, viewportH) * 0.9
    ctx.beginPath()
    ctx.moveTo(sunX, sunY)
    ctx.lineTo(sunX + Math.cos(angle - spread) * beamLen, sunY + Math.sin(angle - spread) * beamLen)
    ctx.lineTo(sunX + Math.cos(angle + spread) * beamLen, sunY + Math.sin(angle + spread) * beamLen)
    ctx.closePath()
    const beamGrad = ctx.createRadialGradient(sunX, sunY, 20, sunX, sunY, beamLen * 0.75)
    beamGrad.addColorStop(0, 'rgba(254, 249, 195, 0.14)')
    beamGrad.addColorStop(1, 'rgba(254, 249, 195, 0)')
    ctx.fillStyle = beamGrad
    ctx.fill()
  }

  const rbCx = viewportW * 0.46
  const rbCy = viewportH * 0.92
  const rbRadius = Math.min(viewportW, viewportH) * 0.78
  const rainbowColors = [
    'rgba(248, 113, 113, 0.09)',
    'rgba(251, 191, 36, 0.09)',
    'rgba(74, 222, 128, 0.09)',
    'rgba(56, 189, 248, 0.09)',
    'rgba(167, 139, 250, 0.09)'
  ]
  ctx.lineCap = 'round'
  rainbowColors.forEach((color, idx) => {
    ctx.beginPath()
    ctx.arc(rbCx, rbCy, rbRadius - idx * 8, Math.PI * 1.12, Math.PI * 1.88)
    ctx.strokeStyle = color
    ctx.lineWidth = 7
    ctx.stroke()
  })

  for (const mote of sunMotes) {
    mote.x += (mote.vx + Math.sin(now * 0.0015 + mote.phase) * 10) * dt
    mote.y += mote.vy * dt
    if (mote.y < -20) {
      mote.y = viewportH + 15
      mote.x = Math.random() * viewportW
    }
    if (mote.x > viewportW + 20) mote.x = -15

    const twinkle = 0.55 + Math.sin(now * 0.004 + mote.phase) * 0.45
    ctx.fillStyle = `rgba(254, 240, 138, ${mote.alpha * twinkle})`
    ctx.beginPath()
    ctx.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

watch(
  () => currentWeather.value,
  () => {
    if (raindrops.length === 0) {
      updateCanvasSize()
    }
  }
)

onMounted(() => {
  updateCanvasSize()
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateCanvasSize()
    })
    resizeObserver.observe(rootEl.value)
  }
  lastFrameTime = performance.now()
  rafId = requestAnimationFrame(renderFrame)
})

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.canvas-weather-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
  overflow: hidden;
}

.canvas-weather-overlay__canvas {
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}

.canvas-weather-hud {
  position: absolute;
  top: 12px;
  left: 14px;
  pointer-events: auto;
  z-index: 12;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.canvas-weather-hud__bar {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.canvas-weather-hud__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(10px);
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.15s ease;
}

.canvas-weather-hud.is-active .canvas-weather-hud__pill {
  border-color: rgba(56, 189, 248, 0.55);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.22);
}

.canvas-weather-hud__pill:hover,
.canvas-weather-hud__dice:hover {
  background: rgba(30, 41, 59, 0.88);
  border-color: rgba(125, 211, 252, 0.65);
}

.canvas-weather-hud__dice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(10px);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.canvas-weather-hud__dice:active {
  transform: rotate(90deg) scale(0.92);
}

.canvas-weather-hud__icon {
  font-size: 14px;
  line-height: 1;
}

.canvas-weather-hud__caret {
  font-size: 10px;
  opacity: 0.75;
}

.canvas-weather-hud__panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: rgba(15, 23, 42, 0.88);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 28px rgba(2, 6, 23, 0.45);
  min-width: 256px;
}

.canvas-weather-hud__modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.canvas-weather-hud__mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(30, 41, 59, 0.55);
  color: #cbd5e1;
  font-size: 11.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.canvas-weather-hud__mode-btn:hover {
  background: rgba(51, 65, 85, 0.78);
  color: #f8fafc;
}

.canvas-weather-hud__mode-btn.is-selected {
  border-color: rgba(56, 189, 248, 0.75);
  background: rgba(14, 116, 144, 0.38);
  color: #f0f9ff;
}

.canvas-weather-hud__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding-top: 6px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}

.canvas-weather-hud__action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.5);
  color: #94a3b8;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.canvas-weather-hud__action-btn.is-on {
  border-color: rgba(52, 211, 153, 0.55);
  background: rgba(6, 95, 70, 0.32);
  color: #d1fae5;
}

.canvas-weather-hud__action-btn.is-shuffle {
  border-color: rgba(167, 139, 250, 0.48);
  background: rgba(76, 29, 149, 0.32);
  color: #ede9fe;
}

.canvas-weather-hud__action-btn.is-shuffle:hover {
  background: rgba(109, 40, 217, 0.45);
}

.canvas-weather-hud__action-btn.is-strike {
  border-color: rgba(250, 204, 21, 0.48);
  background: rgba(113, 63, 18, 0.32);
  color: #fef08a;
}

.canvas-weather-hud__action-btn.is-strike:hover {
  background: rgba(161, 98, 7, 0.48);
}
</style>
