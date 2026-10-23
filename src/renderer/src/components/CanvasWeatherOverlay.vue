<template>
  <div
    v-if="weatherSystemEnabled"
    ref="rootEl"
    class="canvas-weather-overlay"
    :class="[`is-weather-${currentWeather}`, { 'is-active': currentWeather !== 'idle' }]"
  >
    <canvas ref="canvasEl" class="canvas-weather-overlay__canvas" />

    <!-- Compact interactive Genshin-inspired Anime Weather HUD Pill -->
    <div
      ref="hudEl"
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
          ✦
        </button>

        <button
          type="button"
          class="canvas-weather-hud__dice canvas-weather-hud__palette-cycle"
          :title="`${t('settings.weatherSystem.paletteLabel')}: ${currentPaletteLabel}`"
          @click="cyclePalette"
        >
          <span
            class="canvas-weather-hud__swatch"
            :style="{ background: currentPaletteGradient }"
          />
        </button>
      </div>

      <div v-if="hudExpanded" class="canvas-weather-hud__panel">
        <div class="canvas-weather-hud__palettes">
          <div class="canvas-weather-hud__section-title">
            {{ t('settings.weatherSystem.paletteLabel') }}
          </div>
          <div class="canvas-weather-hud__palette-grid">
            <button
              v-for="pal in paletteOptions"
              :key="pal.value"
              type="button"
              class="canvas-weather-hud__palette-btn"
              :class="{ 'is-selected': canvasPalette === pal.value }"
              @click="selectPalette(pal.value)"
            >
              <span class="canvas-weather-hud__swatch" :style="{ background: pal.gradient }" />
              <span>{{ pal.label }}</span>
            </button>
          </div>
        </div>

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
            <span>✦</span>
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
import type { CanvasScenePaletteId } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  editorPreferences,
  setCanvasPalette,
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
const hudEl = ref<HTMLDivElement | null>(null)
const hudExpanded = ref(false)

function onGlobalPointerDown(e: PointerEvent): void {
  if (!hudExpanded.value) return
  const el = hudEl.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  hudExpanded.value = false
}

function onGlobalKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && hudExpanded.value) {
    hudExpanded.value = false
  }
}

const weatherSystemEnabled = editorPreferences.weatherSystemEnabled
const weatherSfxEnabled = editorPreferences.weatherSfxEnabled
const weatherBgmEnabled = editorPreferences.weatherBgmEnabled
const canvasPalette = editorPreferences.canvasPalette
const currentWeather = canvasWeatherState.currentWeather
const manualOverride = canvasWeatherState.manualOverride

const paletteOptions = computed<
  Array<{ value: CanvasScenePaletteId; label: string; gradient: string }>
>(() => [
  {
    value: 'classic',
    label: t('settings.weatherSystem.paletteClassic'),
    gradient: 'linear-gradient(135deg, #1e2228 0%, #363b44 100%)'
  },
  {
    value: 'auto',
    label: t('settings.weatherSystem.paletteAuto'),
    gradient: 'linear-gradient(135deg, #4da4f5 0%, #f2cce0 50%, #7fdc2c 100%)'
  },
  {
    value: 'fontaine',
    label: t('settings.weatherSystem.paletteFontaine'),
    gradient: 'linear-gradient(135deg, #69aaf5 0%, #b8e2f8 50%, #48dcd0 100%)'
  },
  {
    value: 'celestia',
    label: t('settings.weatherSystem.paletteCelestia'),
    gradient: 'linear-gradient(135deg, #6d97ee 0%, #f2cce0 52%, #fce4b4 100%)'
  },
  {
    value: 'mondstadt',
    label: t('settings.weatherSystem.paletteMondstadt'),
    gradient: 'linear-gradient(135deg, #196ec8 0%, #35bac9 52%, #7fdc2c 100%)'
  },
  {
    value: 'natlan',
    label: t('settings.weatherSystem.paletteNatlan'),
    gradient: 'linear-gradient(135deg, #7680a6 0%, #d87a58 52%, #82a952 100%)'
  },
  {
    value: 'liyue',
    label: t('settings.weatherSystem.paletteLiyue'),
    gradient: 'linear-gradient(135deg, #b87c84 0%, #fbb874 52%, #ffe69a 100%)'
  },
  {
    value: 'starry_night',
    label: t('settings.weatherSystem.paletteStarryNight'),
    gradient: 'linear-gradient(135deg, #070c24 0%, #1d56a8 52%, #48d0ff 100%)'
  },
  {
    value: 'twilight_dusk',
    label: t('settings.weatherSystem.paletteTwilightDusk'),
    gradient: 'linear-gradient(135deg, #232b4a 0%, #824b6c 48%, #f27268 100%)'
  }
])

const currentPaletteOption = computed(
  () =>
    paletteOptions.value.find((p) => p.value === canvasPalette.value) ?? paletteOptions.value[0]!
)
const currentPaletteLabel = computed(() => currentPaletteOption.value.label)
const currentPaletteGradient = computed(() => currentPaletteOption.value.gradient)

async function persistCanvasPaletteChoice(next: CanvasScenePaletteId): Promise<void> {
  setCanvasPalette(next)
  try {
    if (
      typeof window.studio?.getSettings === 'function' &&
      typeof window.studio?.setSettings === 'function'
    ) {
      const current = await window.studio.getSettings()
      await window.studio.setSettings({
        ...current,
        editor: {
          ...current.editor,
          canvasPalette: next
        }
      })
    }
  } catch {
    // ignore persistence errors in preview
  }
}

function selectPalette(next: CanvasScenePaletteId): void {
  void persistCanvasPaletteChoice(next)
}

function cyclePalette(): void {
  const list = paletteOptions.value.map((p) => p.value)
  const idx = list.indexOf(canvasPalette.value)
  const next = list[(idx + 1) % list.length] ?? 'auto'
  void persistCanvasPaletteChoice(next)
}

const weatherIcon = computed(() => {
  switch (currentWeather.value) {
    case 'wind':
      return '🍃'
    case 'rain':
      return '💧'
    case 'thunderstorm':
      return '⚡'
    case 'typhoon':
      return '🌀'
    case 'blizzard':
      return '❄️'
    case 'hail':
      return '💎'
    case 'sandstorm':
      return '✨'
    case 'meteor':
      return '🌠'
    case 'aurora':
      return '🦋'
    case 'fog':
      return '☁️'
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
    { value: 'auto', icon: '✦', label: t('settings.weatherSystem.modeAuto') },
    { value: 'wind', icon: '🍃', label: t('settings.weatherSystem.modeWind') },
    { value: 'rain', icon: '💧', label: t('settings.weatherSystem.modeRain') },
    { value: 'thunderstorm', icon: '⚡', label: t('settings.weatherSystem.modeThunderstorm') },
    { value: 'typhoon', icon: '🌀', label: t('settings.weatherSystem.modeTyphoon') },
    { value: 'blizzard', icon: '❄️', label: t('settings.weatherSystem.modeBlizzard') },
    { value: 'hail', icon: '💎', label: t('settings.weatherSystem.modeHail') },
    { value: 'sandstorm', icon: '✨', label: t('settings.weatherSystem.modeSandstorm') },
    { value: 'meteor', icon: '🌠', label: t('settings.weatherSystem.modeMeteor') },
    { value: 'aurora', icon: '🦋', label: t('settings.weatherSystem.modeAurora') },
    { value: 'fog', icon: '☁️', label: t('settings.weatherSystem.modeFog') },
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

// --- Genshin / Cel-Shaded Anime Particle & Phenomenon State ---

interface RainDrop {
  x: number
  y: number
  len: number
  speed: number
  windSlope: number
  alpha: number
  tint: 'aqua' | 'sky' | 'white'
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
  star?: boolean
}

interface WaterRipple {
  x: number
  y: number
  rx: number
  ry: number
  maxRx: number
  life: number
  maxLife: number
  color: string
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
  hasLoop: boolean
}

interface FloraParticle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  size: number
  kind: 'petal' | 'dandelion' | 'anemoLeaf'
  alpha: number
  phase: number
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
  sparkle: boolean
}

interface MeteorStreak {
  x: number
  y: number
  vx: number
  vy: number
  len: number
  size: number
  rarity: 'gold' | 'pink' | 'sky'
  life: number
  maxLife: number
}

interface StarPoint {
  x: number
  y: number
  radius: number
  phase: number
  speed: number
  fourPoint: boolean
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
  isCrystalfly: boolean
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
const ripples: WaterRipple[] = []
const windStreaks: WindStreak[] = []
const floraParticles: FloraParticle[] = []
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
let isMounted = false
let resizeObserver: ResizeObserver | null = null
let viewportW = 1280
let viewportH = 720
let lastFrameTime = performance.now()
let nextAutoLightningAt = 0
let nextMeteorSpawnAt = 0

// --- Stylized Anime Primitives (4-Point Star Flare, Sakura Petal, Dandelion Seed, Crystalfly) ---

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  innerR: number,
  rot: number,
  fillStyle: string
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.fillStyle = fillStyle
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2
    const nextAngle = angle + Math.PI / 4
    if (i === 0) {
      ctx.moveTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR)
    } else {
      ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR)
    }
    ctx.lineTo(Math.cos(nextAngle) * innerR, Math.sin(nextAngle) * innerR)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawSakuraPetal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number,
  fillColor: string,
  highlightColor: string
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.beginPath()
  ctx.moveTo(0, size)
  ctx.bezierCurveTo(-size * 0.95, size * 0.35, -size * 0.85, -size * 0.75, -size * 0.22, -size)
  ctx.lineTo(0, -size * 0.62)
  ctx.lineTo(size * 0.22, -size)
  ctx.bezierCurveTo(size * 0.85, -size * 0.75, size * 0.95, size * 0.35, 0, size)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = highlightColor
  ctx.lineWidth = 0.75
  ctx.stroke()
  ctx.restore()
}

function drawDandelionSeed(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number,
  alpha: number
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  // Soft Anemo glow halo
  const halo = ctx.createRadialGradient(0, -size * 0.3, 0, 0, -size * 0.3, size * 1.9)
  halo.addColorStop(0, `rgba(240, 253, 250, ${alpha * 0.75})`)
  halo.addColorStop(0.5, `rgba(94, 234, 212, ${alpha * 0.32})`)
  halo.addColorStop(1, 'rgba(94, 234, 212, 0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(0, -size * 0.3, size * 1.9, 0, Math.PI * 2)
  ctx.fill()

  // Delicate stem & radiating fluff filaments
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.9})`
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(0, size * 0.9)
  ctx.lineTo(0, -size * 0.2)
  ctx.stroke()

  const rays = 7
  for (let i = 0; i < rays; i++) {
    const a = -Math.PI * 0.85 + (i / (rays - 1)) * Math.PI * 0.7
    ctx.beginPath()
    ctx.moveTo(0, -size * 0.2)
    ctx.lineTo(Math.cos(a) * size * 1.15, -size * 0.2 + Math.sin(a) * size * 1.15)
    ctx.stroke()
  }

  // Luminous seed core
  ctx.fillStyle = `rgba(167, 243, 208, ${alpha})`
  ctx.beginPath()
  ctx.arc(0, size * 0.9, size * 0.22, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawCrystalfly(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  now: number,
  phase: number,
  wingColor: string,
  coreColor: string
): void {
  const flap = 0.35 + 0.65 * Math.abs(Math.sin(now * 0.009 + phase))
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.sin(now * 0.002 + phase) * 0.28)

  ctx.fillStyle = wingColor
  // Upper wings
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size * 2.1 * flap, -size * 1.5)
  ctx.lineTo(-size * 0.8 * flap, -size * 0.2)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(size * 2.1 * flap, -size * 1.5)
  ctx.lineTo(size * 0.8 * flap, -size * 0.2)
  ctx.closePath()
  ctx.fill()

  // Lower wings
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-size * 1.5 * flap, size * 1.3)
  ctx.lineTo(-size * 0.4 * flap, size * 0.3)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(size * 1.5 * flap, size * 1.3)
  ctx.lineTo(size * 0.4 * flap, size * 0.3)
  ctx.closePath()
  ctx.fill()

  // Glowing diamond core
  drawFourPointStar(ctx, 0, 0, size * 1.2, size * 0.35, 0, coreColor)
  ctx.restore()
}

function initParticles(w: number, h: number): void {
  const tints: RainDrop['tint'][] = ['aqua', 'sky', 'white']
  raindrops.length = 0
  for (let i = 0; i < 165; i++) {
    raindrops.push({
      x: Math.random() * (w + 300) - 150,
      y: Math.random() * h,
      len: 20 + Math.random() * 26,
      speed: 720 + Math.random() * 480,
      windSlope: 0.18 + Math.random() * 0.1,
      alpha: 0.32 + Math.random() * 0.48,
      tint: tints[i % 3]!
    })
  }

  windStreaks.length = 0
  for (let i = 0; i < 32; i++) {
    windStreaks.push({
      x: Math.random() * w,
      y: Math.random() * h,
      len: 130 + Math.random() * 210,
      speed: 380 + Math.random() * 400,
      amp: 8 + Math.random() * 18,
      freq: 0.011 + Math.random() * 0.015,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.22 + Math.random() * 0.36,
      width: 1.2 + Math.random() * 1.8,
      hasLoop: i % 3 === 0
    })
  }

  const kinds: FloraParticle['kind'][] = ['dandelion', 'petal', 'anemoLeaf']
  floraParticles.length = 0
  for (let i = 0; i < 36; i++) {
    floraParticles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 180 + Math.random() * 210,
      vy: -25 + Math.random() * 75,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 4.5,
      size: 4.5 + Math.random() * 4.5,
      kind: kinds[i % 3]!,
      alpha: 0.65 + Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2
    })
  }

  snowflakes.length = 0
  for (let i = 0; i < 135; i++) {
    const radius = 1.6 + Math.random() * 4.8
    snowflakes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      radius,
      speedY: 62 + radius * 22 + Math.random() * 38,
      speedX: 68 + Math.random() * 88,
      swayAmp: 22 + Math.random() * 30,
      swayFreq: 1.3 + Math.random() * 1.9,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.55 + Math.random() * 0.42,
      crystalline: radius > 3.6
    })
  }

  hailstones.length = 0
  for (let i = 0; i < 75; i++) {
    hailstones.push({
      x: Math.random() * (w + 200) - 100,
      y: Math.random() * h,
      vx: 120 + Math.random() * 80,
      vy: 640 + Math.random() * 380,
      size: 4.0 + Math.random() * 4.2,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 10,
      bounced: false,
      alpha: 0.75 + Math.random() * 0.25
    })
  }

  sandGrains.length = 0
  for (let i = 0; i < 175; i++) {
    sandGrains.push({
      x: Math.random() * w,
      y: Math.random() * h,
      speedX: 460 + Math.random() * 480,
      speedY: (Math.random() - 0.48) * 75,
      size: 1.4 + Math.random() * 2.6,
      alpha: 0.35 + Math.random() * 0.5,
      hue: 38 + Math.random() * 16,
      sparkle: i % 5 === 0
    })
  }

  stars.length = 0
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.88,
      radius: 1.0 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      speed: 1.6 + Math.random() * 2.8,
      fourPoint: i % 3 === 0
    })
  }

  fogBanks.length = 0
  for (let i = 0; i < 14; i++) {
    fogBanks.push({
      x: Math.random() * w,
      y: (i / 14) * h + (Math.random() - 0.5) * 70,
      rx: 260 + Math.random() * 320,
      ry: 68 + Math.random() * 90,
      speedX: (i % 2 === 0 ? 1 : -1) * (16 + Math.random() * 24),
      alpha: 0.1 + Math.random() * 0.11,
      phase: Math.random() * Math.PI * 2
    })
  }

  sunMotes.length = 0
  for (let i = 0; i < 56; i++) {
    sunMotes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 14 + Math.random() * 20,
      vy: -20 - Math.random() * 28,
      radius: 1.8 + Math.random() * 3.4,
      alpha: 0.38 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      isCrystalfly: i < 7
    })
  }
}

function buildLightningGeometry(
  id: number,
  targetX: number,
  targetY: number,
  createdAt: number
): RenderedBolt {
  const startX = Math.max(40, Math.min(viewportW - 40, targetX + (Math.random() - 0.5) * 240))
  const startY = -10
  const segments: RenderedBolt['segments'] = []

  const steps = 13
  let prevX = startX
  let prevY = startY

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const jitter = i === steps ? 0 : (Math.random() - 0.5) * 72 * (1 - t * 0.4)
    const nextX = startX + (targetX - startX) * t + jitter
    const nextY = startY + (targetY - startY) * t
    segments.push({ x1: prevX, y1: prevY, x2: nextX, y2: nextY, main: true })

    if (i > 2 && i < steps - 1 && Math.random() < 0.46) {
      let bx = nextX
      let by = nextY
      const bSteps = 3 + Math.floor(Math.random() * 3)
      const dir = Math.random() < 0.5 ? -1 : 1
      for (let b = 0; b < bSteps; b++) {
        const nbx = bx + dir * (20 + Math.random() * 34)
        const nby = by + 22 + Math.random() * 28
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
    durationMs: 520
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

function spawnSplash(
  x: number,
  y: number,
  count = 4,
  color?: string,
  speedScale = 1,
  star = false
): void {
  if (splashes.length > 220) return
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI * (0.12 + Math.random() * 0.76)
    const speed = (50 + Math.random() * 120) * speedScale
    splashes.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 1.5 + Math.random() * 2.2,
      alpha: 0.92,
      life: 0,
      maxLife: 0.28 + Math.random() * 0.24,
      color,
      star: star || i % 2 === 0
    })
  }
}

function spawnRipple(x: number, y: number, color = 'rgba(125, 211, 252, 0.85)'): void {
  if (ripples.length > 45) return
  ripples.push({
    x,
    y,
    rx: 2,
    ry: 0.8,
    maxRx: 18 + Math.random() * 16,
    life: 0,
    maxLife: 0.48 + Math.random() * 0.22,
    color
  })
}

function renderFrame(now: number): void {
  try {
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
      return
    }
    const ctx = cvs.getContext('2d')
    if (!ctx) {
      return
    }

    ctx.clearRect(0, 0, viewportW, viewportH)

    if (
      weather === 'idle' &&
      activeBolts.length === 0 &&
      splashes.length === 0 &&
      ripples.length === 0
    ) {
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

    // 1. Fresh Genshin-style Luminous Sky Backdrop Tint
    drawAtmosphereTint(ctx, weather, now)

    // 2. Typhoon Anemo Elemental Vortex
    if (weather === 'typhoon') {
      drawTyphoonVortex(ctx, now)
    }

    // 3. Ley Line & Irminsul Aurora Curtains + Crystalflies
    if (weather === 'aurora') {
      drawAuroraSpectacle(ctx, dt, now, nodes)
    }

    // 4. Wish Starfall (Genshin Gacha Shooting Stars)
    if (weather === 'meteor') {
      drawMeteorShower(ctx, dt, now, nodes)
    }

    // 5. Anemo Breeze Ribbons, Dandelion Seeds & Sakura Petals
    if (weather === 'wind' || weather === 'thunderstorm' || weather === 'typhoon') {
      drawWindAndLeaves(ctx, weather, dt, now, nodes)
    }

    // 6. Dragonspine Cryo Snowflakes & Cel-Shaded Snow Puffs
    if (weather === 'blizzard') {
      drawBlizzardSnow(ctx, dt, now, nodes)
    }

    // 7. Cryo Diamond Prism Hailstorm
    if (weather === 'hail') {
      drawHailstorm(ctx, dt, nodes)
    }

    // 8. Sumeru Golden Mirage Sand Ribbons & Diamond Dust
    if (weather === 'sandstorm') {
      drawSandstorm(ctx, dt, now, nodes)
    }

    // 9. Chenyu Vale Celadon Cloud Sea & Adeptal Motes
    if (weather === 'fog') {
      drawDenseFog(ctx, dt, now)
    }

    // 10. Fontaine Hydro Rain, Concentric Ripples & Splashes
    if (
      weather === 'rain' ||
      weather === 'thunderstorm' ||
      weather === 'typhoon' ||
      splashes.length > 0 ||
      ripples.length > 0
    ) {
      drawRainAndSplashes(ctx, weather, dt, nodes)
    }

    // 11. Inazuma Electro Lightning Bolts & Sigil Rings
    if (activeBolts.length > 0) {
      drawLightningBolts(ctx, now)
    }

    // 12. Teyvat Clear Sunny Sky (Bokeh Lens Flares, Sunbeams, Double Rainbow, Dandelions)
    if (weather === 'sunny') {
      drawSunnySpectacle(ctx, dt, now)
    }
  } finally {
    if (isMounted) {
      rafId = requestAnimationFrame(renderFrame)
    }
  }
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
    // Mondstadt Anemo mint-sky breeze
    grad.addColorStop(0, 'rgba(94, 234, 212, 0.13)')
    grad.addColorStop(0.55, 'rgba(186, 230, 253, 0.07)')
    grad.addColorStop(1, 'rgba(167, 243, 208, 0.05)')
  } else if (weather === 'rain') {
    // Fontaine Hydro crystal azure
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.15)')
    grad.addColorStop(0.55, 'rgba(125, 211, 252, 0.09)')
    grad.addColorStop(1, 'rgba(224, 242, 254, 0.06)')
  } else if (weather === 'thunderstorm') {
    // Inazuma Electro violet-sakura sky
    grad.addColorStop(0, 'rgba(168, 85, 247, 0.16)')
    grad.addColorStop(0.55, 'rgba(216, 180, 254, 0.09)')
    grad.addColorStop(1, 'rgba(244, 114, 182, 0.06)')
  } else if (weather === 'typhoon') {
    // Anemo storm domain teal-cyan
    grad.addColorStop(0, 'rgba(45, 212, 191, 0.17)')
    grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.11)')
    grad.addColorStop(1, 'rgba(153, 246, 228, 0.08)')
  } else if (weather === 'blizzard') {
    // Dragonspine luminous ice-blue & pearl white
    grad.addColorStop(0, 'rgba(186, 230, 253, 0.19)')
    grad.addColorStop(0.5, 'rgba(224, 242, 254, 0.11)')
    grad.addColorStop(1, 'rgba(240, 249, 255, 0.14)')
  } else if (weather === 'hail') {
    // Cryo crystal cyan-lavender
    grad.addColorStop(0, 'rgba(125, 211, 252, 0.17)')
    grad.addColorStop(0.55, 'rgba(196, 181, 253, 0.09)')
    grad.addColorStop(1, 'rgba(224, 242, 254, 0.10)')
  } else if (weather === 'sandstorm') {
    // Sumeru sunlit champagne gold
    grad.addColorStop(0, 'rgba(253, 224, 71, 0.16)')
    grad.addColorStop(0.55, 'rgba(251, 191, 36, 0.11)')
    grad.addColorStop(1, 'rgba(254, 243, 199, 0.08)')
  } else if (weather === 'meteor') {
    // Genshin Wish starry twilight indigo-rose
    grad.addColorStop(0, 'rgba(99, 102, 241, 0.18)')
    grad.addColorStop(0.55, 'rgba(192, 132, 252, 0.11)')
    grad.addColorStop(1, 'rgba(244, 114, 182, 0.06)')
  } else if (weather === 'aurora') {
    // Irminsul / Ley Line pastel mint & sakura
    grad.addColorStop(0, 'rgba(110, 231, 183, 0.16)')
    grad.addColorStop(0.5, 'rgba(196, 181, 253, 0.11)')
    grad.addColorStop(1, 'rgba(249, 168, 212, 0.07)')
  } else if (weather === 'fog') {
    // Chenyu Vale celadon jade morning mist
    grad.addColorStop(0, 'rgba(204, 251, 241, 0.17)')
    grad.addColorStop(0.6, 'rgba(224, 242, 254, 0.12)')
    grad.addColorStop(1, 'rgba(209, 250, 229, 0.14)')
  } else if (weather === 'sunny') {
    const pulse = 0.88 + Math.sin(now * 0.002) * 0.12
    grad.addColorStop(0, `rgba(254, 240, 138, ${0.18 * pulse})`)
    grad.addColorStop(0.45, `rgba(125, 211, 252, ${0.1 * pulse})`)
    grad.addColorStop(1, 'rgba(254, 249, 195, 0.05)')
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, viewportW, viewportH)
  ctx.restore()
}

function drawTyphoonVortex(ctx: CanvasRenderingContext2D, now: number): void {
  const cx = vortexEyeNorm.x * viewportW
  const cy = vortexEyeNorm.y * viewportH
  const maxR = Math.hypot(viewportW, viewportH) * 0.58

  ctx.save()
  ctx.translate(cx, cy)

  // Luminous Anemo turquoise-emerald core aura
  const eyeGrad = ctx.createRadialGradient(0, 0, 12, 0, 0, maxR)
  eyeGrad.addColorStop(0, 'rgba(240, 253, 250, 0.24)')
  eyeGrad.addColorStop(0.14, 'rgba(94, 234, 212, 0.18)')
  eyeGrad.addColorStop(0.38, 'rgba(125, 211, 252, 0.10)')
  eyeGrad.addColorStop(1, 'rgba(167, 243, 208, 0)')
  ctx.fillStyle = eyeGrad
  ctx.beginPath()
  ctx.arc(0, 0, maxR, 0, Math.PI * 2)
  ctx.fill()

  // Cel-shaded spiral Anemo wind blades
  const baseAngle = -now * 0.0028
  ctx.lineCap = 'round'
  for (let arm = 0; arm < 6; arm++) {
    const armOffset = (arm * Math.PI * 2) / 6
    ctx.beginPath()
    for (let s = 0; s <= 55; s++) {
      const ratio = s / 55
      const r = 24 + ratio * maxR * 0.84
      const theta = baseAngle + armOffset + ratio * 3.8
      const px = Math.cos(theta) * r
      const py = Math.sin(theta) * r * 0.84
      if (s === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.strokeStyle = arm % 2 === 0 ? 'rgba(240, 253, 250, 0.34)' : 'rgba(94, 234, 212, 0.26)'
    ctx.lineWidth = arm % 2 === 0 ? 2.6 : 1.6
    ctx.stroke()

    // Orbiting 4-point Anemo star sparkles along the wind arms
    const starRatio = ((now * 0.00045 + arm * 0.17) % 0.85) + 0.08
    const sr = 24 + starRatio * maxR * 0.84
    const stheta = baseAngle + armOffset + starRatio * 3.8
    drawFourPointStar(
      ctx,
      Math.cos(stheta) * sr,
      Math.sin(stheta) * sr * 0.84,
      6.5,
      1.8,
      now * 0.002,
      'rgba(240, 253, 250, 0.85)'
    )
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

  // Soft pastel Cryo vignette along screen borders
  const frostGrad = ctx.createRadialGradient(
    viewportW * 0.5,
    viewportH * 0.5,
    Math.min(viewportW, viewportH) * 0.34,
    viewportW * 0.5,
    viewportH * 0.5,
    Math.max(viewportW, viewportH) * 0.72
  )
  frostGrad.addColorStop(0, 'rgba(240, 249, 255, 0)')
  frostGrad.addColorStop(1, 'rgba(186, 230, 253, 0.26)')
  ctx.fillStyle = frostGrad
  ctx.fillRect(0, 0, viewportW, viewportH)

  // Cel-shaded fluffy snow caps + tiny Cryo star sparkles on top of visible nodes
  for (const node of nodes) {
    if (node.screenWidth < 30) continue
    const left = node.screenX + 8
    const right = node.screenX + node.screenWidth - 8
    const top = node.screenY

    ctx.beginPath()
    ctx.moveTo(left, top + 2)
    const segments = 6
    for (let i = 1; i <= segments; i++) {
      const ratio = i / segments
      const px = left + (right - left) * ratio
      const mound = Math.sin(ratio * Math.PI) * 6.5
      ctx.lineTo(px, top - mound)
    }
    ctx.lineTo(right, top + 2)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.92)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // Swirling Cryo snowflakes & 4-point ice dust
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
      // Genshin Cryo 6-pointed geometric ice crystal with dendritic branches
      ctx.save()
      ctx.translate(flake.x, flake.y)
      ctx.rotate(now * 0.0007 + flake.phase)
      ctx.strokeStyle = `rgba(255, 255, 255, ${flake.alpha})`
      ctx.lineWidth = 1.25
      const r = flake.radius * 1.35
      for (let k = 0; k < 6; k++) {
        ctx.rotate(Math.PI / 3)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(r, 0)
        ctx.moveTo(r * 0.58, 0)
        ctx.lineTo(r * 0.82, -r * 0.26)
        ctx.moveTo(r * 0.58, 0)
        ctx.lineTo(r * 0.82, r * 0.26)
        ctx.stroke()
      }
      ctx.fillStyle = `rgba(186, 230, 253, ${flake.alpha})`
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else {
      drawFourPointStar(
        ctx,
        flake.x,
        flake.y,
        flake.radius * 1.5,
        flake.radius * 0.45,
        flake.phase,
        `rgba(240, 249, 255, ${flake.alpha})`
      )
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
      stone.vy += 940 * dt
    }

    // Collide with node roofs -> bounce & burst into 4-point Cryo star sparkles!
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
          stone.vy = -(230 + Math.random() * 170)
          stone.vx = (Math.random() - 0.5) * 250
          stone.bounced = true
          spawnSplash(stone.x, topY, 5, 'rgba(224, 242, 254, 0.96)', 1.35, true)
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
      stone.vx = 120 + Math.random() * 80
      stone.vy = 640 + Math.random() * 380
      stone.bounced = false
    }

    // Cel-shaded two-tone Cryo diamond prism
    ctx.save()
    ctx.translate(stone.x, stone.y)
    ctx.rotate(stone.rot)
    const s = stone.size
    ctx.beginPath()
    ctx.moveTo(0, -s * 1.25)
    ctx.lineTo(s * 0.82, 0)
    ctx.lineTo(0, s * 1.25)
    ctx.lineTo(-s * 0.82, 0)
    ctx.closePath()
    ctx.fillStyle = `rgba(240, 249, 255, ${stone.alpha})`
    ctx.fill()
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)'
    ctx.lineWidth = 1.1
    ctx.stroke()

    // Inner bright facet highlight
    ctx.beginPath()
    ctx.moveTo(0, -s * 1.25)
    ctx.lineTo(s * 0.82, 0)
    ctx.lineTo(0, 0)
    ctx.closePath()
    ctx.fillStyle = 'rgba(186, 230, 253, 0.65)'
    ctx.fill()
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

  // Sumeru sunlit champagne-gold silk wind ribbons
  ctx.lineCap = 'round'
  for (let b = 0; b < 5; b++) {
    const baseY = viewportH * (0.16 + b * 0.18)
    ctx.beginPath()
    for (let x = 0; x <= viewportW; x += 28) {
      const y =
        baseY +
        Math.sin(x * 0.006 - now * 0.0035 + b * 1.3) * 28 +
        Math.cos(x * 0.012 - now * 0.002 + b) * 14
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = b % 2 === 0 ? 'rgba(254, 240, 138, 0.22)' : 'rgba(251, 191, 36, 0.16)'
    ctx.lineWidth = 18
    ctx.stroke()
  }

  // Sparkling golden sand grains & 4-point desert star motes
  for (const grain of sandGrains) {
    grain.x += grain.speedX * dt
    grain.y += (grain.speedY + Math.sin(now * 0.004 + grain.x * 0.01) * 32) * dt

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

    if (grain.sparkle) {
      drawFourPointStar(
        ctx,
        grain.x,
        grain.y,
        grain.size * 2.4,
        grain.size * 0.65,
        now * 0.003 + grain.hue,
        `rgba(254, 249, 195, ${grain.alpha})`
      )
    } else {
      ctx.strokeStyle = `hsla(${grain.hue}, 96%, 78%, ${grain.alpha})`
      ctx.lineWidth = grain.size
      ctx.beginPath()
      ctx.moveTo(grain.x, grain.y)
      ctx.lineTo(grain.x - grain.size * 6, grain.y - grain.speedY * 0.012)
      ctx.stroke()
    }
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

  // 1. Twinkling anime starry sky with 4-point star flares
  for (const star of stars) {
    const twinkle = 0.38 + 0.62 * Math.abs(Math.sin(now * 0.0012 * star.speed + star.phase))
    if (star.fourPoint) {
      drawFourPointStar(
        ctx,
        star.x,
        star.y,
        star.radius * 2.6 * twinkle,
        star.radius * 0.65 * twinkle,
        0,
        `rgba(254, 249, 195, ${twinkle * 0.92})`
      )
    } else {
      ctx.fillStyle = `rgba(224, 242, 254, ${twinkle * 0.85})`
      ctx.beginPath()
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 2. Spawn Genshin "Wish" shooting stars (Gold 5★, Pink-Violet Intertwined, Sky-Blue Acquaint)
  if (now > nextMeteorSpawnAt && meteors.length < 8) {
    nextMeteorSpawnAt = now + 380 + Math.random() * 580
    const startX = Math.random() * viewportW * 0.85
    const startY = -30
    const angle = Math.PI * (0.18 + Math.random() * 0.12)
    const speed = 740 + Math.random() * 440
    const roll = Math.random()
    const rarity: MeteorStreak['rarity'] = roll < 0.38 ? 'gold' : roll < 0.72 ? 'pink' : 'sky'
    meteors.push({
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      len: 145 + Math.random() * 145,
      size: 2.5 + Math.random() * 1.8,
      rarity,
      life: 0,
      maxLife: 1.15 + Math.random() * 0.55
    })
  }

  // 3. Update & render Wish shooting stars with 4-point star heads & sparkling tails
  ctx.lineCap = 'round'
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]!
    m.life += dt
    m.x += m.vx * dt
    m.y += m.vy * dt

    for (const node of nodes) {
      if (
        m.x >= node.screenX &&
        m.x <= node.screenX + node.screenWidth &&
        m.y >= node.screenY &&
        m.y <= node.screenY + Math.min(48, node.screenHeight * 0.4)
      ) {
        const burstColor =
          m.rarity === 'gold'
            ? 'rgba(254, 240, 138, 0.98)'
            : m.rarity === 'pink'
              ? 'rgba(244, 114, 182, 0.96)'
              : 'rgba(125, 211, 252, 0.96)'
        spawnSplash(m.x, m.y, 10, burstColor, 1.65, true)
        const mag = Math.max(1, Math.hypot(m.vx, m.vy))
        applyMeteorNodeImpact(node.id, m.vx / mag, m.vy / mag)
        m.life = m.maxLife
        break
      }
    }

    if (m.life >= m.maxLife || m.x > viewportW + 220 || m.y > viewportH + 220) {
      meteors.splice(i, 1)
      continue
    }

    const fade = 1 - m.life / m.maxLife
    const mag = Math.max(1, Math.hypot(m.vx, m.vy))
    const tailX = m.x - (m.vx / mag) * m.len
    const tailY = m.y - (m.vy / mag) * m.len

    const tailGrad = ctx.createLinearGradient(tailX, tailY, m.x, m.y)
    if (m.rarity === 'gold') {
      tailGrad.addColorStop(0, 'rgba(251, 191, 36, 0)')
      tailGrad.addColorStop(0.45, `rgba(244, 114, 182, ${0.42 * fade})`)
      tailGrad.addColorStop(0.8, `rgba(253, 224, 71, ${0.85 * fade})`)
      tailGrad.addColorStop(1, `rgba(255, 255, 255, ${0.98 * fade})`)
    } else if (m.rarity === 'pink') {
      tailGrad.addColorStop(0, 'rgba(168, 85, 247, 0)')
      tailGrad.addColorStop(0.5, `rgba(192, 132, 252, ${0.52 * fade})`)
      tailGrad.addColorStop(0.82, `rgba(244, 114, 182, ${0.85 * fade})`)
      tailGrad.addColorStop(1, `rgba(255, 255, 255, ${0.98 * fade})`)
    } else {
      tailGrad.addColorStop(0, 'rgba(56, 189, 248, 0)')
      tailGrad.addColorStop(0.55, `rgba(94, 234, 212, ${0.52 * fade})`)
      tailGrad.addColorStop(0.85, `rgba(125, 211, 252, ${0.85 * fade})`)
      tailGrad.addColorStop(1, `rgba(255, 255, 255, ${0.98 * fade})`)
    }

    ctx.strokeStyle = tailGrad
    ctx.lineWidth = m.size * 1.45
    ctx.beginPath()
    ctx.moveTo(tailX, tailY)
    ctx.lineTo(m.x, m.y)
    ctx.stroke()

    // Signature Genshin Wish 4-point star flare head
    const headColor =
      m.rarity === 'gold'
        ? `rgba(254, 249, 195, ${fade})`
        : m.rarity === 'pink'
          ? `rgba(252, 231, 243, ${fade})`
          : `rgba(224, 242, 254, ${fade})`
    drawFourPointStar(ctx, m.x, m.y, m.size * 4.4, m.size * 1.15, now * 0.004, headColor)
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

  // Pastel Genshin Ley Line / Irminsul silk ribbons (Mint, Sky-Cyan, Sakura-Pink, Lavender)
  const ribbons = [
    {
      yBase: viewportH * 0.22,
      height: 195,
      colorA: 'rgba(110, 231, 183, 0.24)',
      colorB: 'rgba(125, 211, 252, 0.12)',
      speed: 0.0013,
      phase: 0
    },
    {
      yBase: viewportH * 0.34,
      height: 210,
      colorA: 'rgba(249, 168, 212, 0.20)',
      colorB: 'rgba(196, 181, 253, 0.10)',
      speed: -0.0015,
      phase: 2.1
    },
    {
      yBase: viewportH * 0.16,
      height: 165,
      colorA: 'rgba(125, 211, 252, 0.22)',
      colorB: 'rgba(167, 243, 208, 0.09)',
      speed: 0.0018,
      phase: 4.2
    }
  ]

  const cols = 44
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
      curtainGrad.addColorStop(0, 'rgba(255, 255, 255, 0)')
      curtainGrad.addColorStop(0.35, rib.colorA)
      curtainGrad.addColorStop(0.75, rib.colorB)
      curtainGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')

      ctx.fillStyle = curtainGrad
      ctx.fillRect(x, topY, colW + 1.5, rib.height)
    }
  }

  // Rising Crystalflies & 4-point elemental motes
  for (const mote of sunMotes) {
    mote.x += Math.sin(now * 0.002 + mote.phase) * 24 * dt
    mote.y += mote.vy * 1.1 * dt
    if (mote.y < -25) {
      mote.y = viewportH + 20
      mote.x = Math.random() * viewportW
    }
    const pulse = 0.55 + 0.45 * Math.sin(now * 0.005 + mote.phase)
    if (mote.isCrystalfly) {
      drawCrystalfly(
        ctx,
        mote.x,
        mote.y,
        mote.radius * 2.1,
        now,
        mote.phase,
        `rgba(167, 243, 208, ${0.78 * pulse})`,
        `rgba(240, 253, 250, ${0.95 * pulse})`
      )
    } else {
      const color =
        mote.phase > Math.PI
          ? `rgba(167, 243, 208, ${mote.alpha * pulse})`
          : `rgba(249, 168, 212, ${mote.alpha * pulse})`
      drawFourPointStar(
        ctx,
        mote.x,
        mote.y,
        mote.radius * 2.2,
        mote.radius * 0.6,
        now * 0.002 + mote.phase,
        color
      )
    }
  }

  // Soft pastel Ley Line resonance border around visible nodes
  if (nodes.length > 0) {
    ctx.strokeStyle = 'rgba(167, 243, 208, 0.28)'
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

  // Chenyu Vale celadon-jade & pearlescent cloud sea
  for (const bank of fogBanks) {
    bank.x += bank.speedX * dt
    if (bank.speedX > 0 && bank.x - bank.rx > viewportW + 100) {
      bank.x = -bank.rx - 60
    } else if (bank.speedX < 0 && bank.x + bank.rx < -100) {
      bank.x = viewportW + bank.rx + 60
    }

    const breathe = 0.88 + 0.12 * Math.sin(now * 0.0012 + bank.phase)
    const grad = ctx.createRadialGradient(bank.x, bank.y, 12, bank.x, bank.y, bank.rx)
    grad.addColorStop(0, `rgba(240, 253, 250, ${bank.alpha * 1.35 * breathe})`)
    grad.addColorStop(0.55, `rgba(204, 251, 241, ${bank.alpha * 0.85 * breathe})`)
    grad.addColorStop(1, 'rgba(204, 251, 241, 0)')

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(bank.x, bank.y, bank.rx, bank.ry * breathe, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Floating golden-jade adeptal spirit motes (仙谷金绿灵光)
  for (let i = 0; i < 24; i++) {
    const mote = sunMotes[i]
    if (!mote) continue
    mote.x += Math.sin(now * 0.0014 + mote.phase) * 16 * dt
    mote.y += mote.vy * 0.65 * dt
    if (mote.y < -20) {
      mote.y = viewportH + 15
      mote.x = Math.random() * viewportW
    }
    const glow = 0.5 + 0.5 * Math.sin(now * 0.0035 + mote.phase)
    drawFourPointStar(
      ctx,
      mote.x,
      mote.y,
      mote.radius * 2.1,
      mote.radius * 0.55,
      0,
      i % 2 === 0 ? `rgba(254, 240, 138, ${0.72 * glow})` : `rgba(167, 243, 208, ${0.78 * glow})`
    )
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
  const speedMul = weather === 'typhoon' ? 1.75 : weather === 'thunderstorm' ? 1.3 : 1.0
  const eyeX = vortexEyeNorm.x * viewportW
  const eyeY = vortexEyeNorm.y * viewportH

  ctx.save()
  ctx.lineCap = 'round'

  // Cel-shaded Genshin Anemo wind ribbons with curling loops
  for (const streak of windStreaks) {
    streak.x += streak.speed * speedMul * dt
    streak.y += Math.sin(now * 0.002 + streak.phase) * 26 * dt
    if (streak.x - streak.len > viewportW + 80) {
      streak.x = -streak.len - Math.random() * 120
      streak.y = Math.random() * viewportH
    }

    ctx.beginPath()
    const segs = 12
    for (let i = 0; i <= segs; i++) {
      const ratio = i / segs
      const sx = streak.x - (1 - ratio) * streak.len
      const loopOffset =
        streak.hasLoop && ratio > 0.55 && ratio < 0.85
          ? Math.sin(((ratio - 0.55) / 0.3) * Math.PI * 2) * 10
          : 0
      const sy =
        streak.y + Math.sin(sx * streak.freq + now * 0.006 + streak.phase) * streak.amp + loopOffset
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }

    const grad = ctx.createLinearGradient(streak.x - streak.len, streak.y, streak.x, streak.y)
    if (weather === 'thunderstorm') {
      grad.addColorStop(0, 'rgba(233, 213, 255, 0)')
      grad.addColorStop(0.5, `rgba(244, 114, 182, ${streak.alpha * 0.85})`)
      grad.addColorStop(1, 'rgba(233, 213, 255, 0)')
    } else {
      grad.addColorStop(0, 'rgba(153, 246, 228, 0)')
      grad.addColorStop(0.5, `rgba(240, 253, 250, ${streak.alpha})`)
      grad.addColorStop(0.85, `rgba(94, 234, 212, ${streak.alpha * 0.85})`)
      grad.addColorStop(1, 'rgba(153, 246, 228, 0)')
    }
    ctx.strokeStyle = grad
    ctx.lineWidth = streak.width
    ctx.stroke()
  }

  // Floating Mondstadt Dandelion Seeds, Inazuma Sakura Petals & Anemo Leaves
  for (const item of floraParticles) {
    if (weather === 'typhoon') {
      const rx = item.x - eyeX
      const ry = item.y - eyeY
      const dist = Math.max(35, Math.hypot(rx, ry))
      const tx = -ry / dist
      const ty = rx / dist
      item.vx = tx * 430 - (rx / dist) * 65
      item.vy = ty * 430 - (ry / dist) * 65
    } else {
      item.vx = (240 + Math.sin(now * 0.003 + item.size) * 80) * speedMul
      item.vy = Math.cos(now * 0.0035 + item.phase) * 48
    }

    item.x += item.vx * dt
    item.y += item.vy * dt
    item.rot += item.vrot * dt

    for (const node of nodes) {
      if (
        item.x >= node.screenX &&
        item.x <= node.screenX + node.screenWidth &&
        item.y >= node.screenY &&
        item.y <= node.screenY + node.screenHeight
      ) {
        item.y = node.screenY - 4
        item.vy = -Math.abs(item.vy) - 42
        break
      }
    }

    if (item.x > viewportW + 40) {
      item.x = -30
      item.y = Math.random() * viewportH
    } else if (item.x < -40) {
      item.x = viewportW + 30
    }
    if (item.y > viewportH + 40) item.y = -20
    if (item.y < -40) item.y = viewportH + 20

    if (weather === 'thunderstorm' || item.kind === 'petal') {
      // Sacred Sakura / Windwheel Blossom Petal
      drawSakuraPetal(
        ctx,
        item.x,
        item.y,
        item.size,
        item.rot,
        `rgba(251, 207, 232, ${item.alpha})`,
        `rgba(244, 114, 182, ${item.alpha * 0.85})`
      )
    } else if (item.kind === 'dandelion') {
      // Glowing Mondstadt Dandelion Seed
      drawDandelionSeed(
        ctx,
        item.x,
        item.y,
        item.size * 0.95,
        Math.sin(now * 0.003 + item.phase) * 0.35,
        item.alpha
      )
    } else {
      // Fresh mint-emerald Anemo leaf
      drawSakuraPetal(
        ctx,
        item.x,
        item.y,
        item.size * 0.9,
        item.rot,
        `rgba(167, 243, 208, ${item.alpha})`,
        `rgba(52, 211, 153, ${item.alpha * 0.9})`
      )
    }
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
  const slopeMul = weather === 'typhoon' ? 1.65 : weather === 'thunderstorm' ? 1.15 : 0.72
  const speedMul = weather === 'typhoon' ? 1.3 : 1.0

  ctx.save()
  ctx.lineCap = 'round'

  if (isRaining) {
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
          spawnSplash(drop.x, topY, 3, 'rgba(224, 242, 254, 0.95)')
          spawnRipple(drop.x, topY, 'rgba(125, 211, 252, 0.9)')
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
          if (Math.random() < 0.16) {
            spawnRipple(
              Math.max(20, Math.min(viewportW - 20, drop.x)),
              viewportH - 12 - Math.random() * 48,
              'rgba(186, 230, 253, 0.75)'
            )
          }
          drop.y = -20 - Math.random() * 80
          drop.x = Math.random() * (viewportW + 350) - 250
        } else {
          const dx = drop.len * drop.windSlope * slopeMul
          const dy = drop.len
          const dropGrad = ctx.createLinearGradient(drop.x - dx, drop.y - dy, drop.x, drop.y)
          const headColor =
            drop.tint === 'aqua'
              ? `rgba(165, 243, 252, ${drop.alpha})`
              : drop.tint === 'sky'
                ? `rgba(186, 230, 253, ${drop.alpha})`
                : `rgba(255, 255, 255, ${drop.alpha})`
          dropGrad.addColorStop(0, 'rgba(186, 230, 253, 0)')
          dropGrad.addColorStop(1, headColor)
          ctx.strokeStyle = dropGrad
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(drop.x - dx, drop.y - dy)
          ctx.lineTo(drop.x, drop.y)
          ctx.stroke()
        }
      }
    }
  }

  // Concentric Anime Water Ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i]!
    rp.life += dt
    if (rp.life >= rp.maxLife) {
      ripples.splice(i, 1)
      continue
    }
    const progress = rp.life / rp.maxLife
    const rx = 3 + progress * rp.maxRx
    const ry = rx * 0.32
    const fade = 1 - progress
    ctx.strokeStyle = rp.color.replace(/[\d.]+\)$/, `${(0.82 * fade).toFixed(3)})`)
    ctx.lineWidth = 1.25 * fade
    ctx.beginPath()
    ctx.ellipse(rp.x, rp.y, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Hydro Droplet & Star Splashes
  for (let i = splashes.length - 1; i >= 0; i--) {
    const sp = splashes[i]!
    sp.life += dt
    if (sp.life >= sp.maxLife) {
      splashes.splice(i, 1)
      continue
    }
    sp.vy += 380 * dt
    sp.x += sp.vx * dt
    sp.y += sp.vy * dt
    const fade = 1 - sp.life / sp.maxLife
    const fill = sp.color ?? `rgba(224, 242, 254, ${sp.alpha * fade})`
    if (sp.star) {
      drawFourPointStar(ctx, sp.x, sp.y, sp.radius * 2.4 * fade, sp.radius * 0.65 * fade, 0, fill)
    } else {
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(sp.x, sp.y, sp.radius * fade, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

function drawLightningBolts(ctx: CanvasRenderingContext2D, now: number): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let i = activeBolts.length - 1; i >= 0; i--) {
    const bolt = activeBolts[i]!
    // Clamp age >= 0: bolt.createdAt uses performance.now() while `now` is the rAF vsync timestamp,
    // which can precede bolt.createdAt when a bolt is spawned mid-frame during heavy canvas work.
    const age = Math.max(0, now - bolt.createdAt)
    if (age >= bolt.durationMs) {
      activeBolts.splice(i, 1)
      continue
    }

    const lifeRatio = Math.min(1, Math.max(0, 1 - age / bolt.durationMs))
    const flicker = age < 140 ? (Math.floor(age / 25) % 2 === 0 ? 1 : 0.5) : lifeRatio

    // Pastel lilac-white anime flash
    if (age < 110) {
      ctx.fillStyle = `rgba(243, 232, 255, ${(1 - age / 110) * 0.2})`
      ctx.fillRect(0, 0, viewportW, viewportH)
    }

    // Inazuma Electro violet-magenta outer glow + bright white-lilac core
    ctx.shadowColor = 'rgba(192, 132, 252, 0.95)'
    ctx.shadowBlur = 20
    for (const seg of bolt.segments) {
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.strokeStyle = seg.main
        ? `rgba(250, 245, 255, ${0.98 * flicker})`
        : `rgba(232, 121, 249, ${0.78 * flicker})`
      ctx.lineWidth = seg.main ? 3.4 * lifeRatio + 1.1 : 1.6 * lifeRatio
      ctx.stroke()
    }

    // Electro sigil ring + 4-point star burst at target impact point
    const ringProgress = Math.min(1, Math.max(0, age / bolt.durationMs))
    const ringRadius = Math.max(0.5, 16 + ringProgress * 140)
    ctx.shadowBlur = 0
    ctx.strokeStyle = `rgba(216, 180, 254, ${(1 - ringProgress) * 0.85})`
    ctx.lineWidth = Math.max(0.1, 2.4 * (1 - ringProgress))
    ctx.beginPath()
    ctx.arc(bolt.targetX, bolt.targetY, ringRadius, 0, Math.PI * 2)
    ctx.stroke()

    drawFourPointStar(
      ctx,
      bolt.targetX,
      bolt.targetY,
      26 * (1 - ringProgress),
      6 * (1 - ringProgress),
      ringProgress * Math.PI,
      `rgba(250, 245, 255, ${(1 - ringProgress) * 0.95})`
    )
  }

  ctx.restore()
}

function drawSunnySpectacle(ctx: CanvasRenderingContext2D, dt: number, now: number): void {
  ctx.save()

  const sunX = viewportW * 0.84
  const sunY = viewportH * 0.11

  // Luminous golden-azure anime sun halo
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, viewportW * 0.58)
  sunGlow.addColorStop(0, 'rgba(255, 251, 235, 0.52)')
  sunGlow.addColorStop(0.22, 'rgba(254, 240, 138, 0.24)')
  sunGlow.addColorStop(0.55, 'rgba(186, 230, 253, 0.09)')
  sunGlow.addColorStop(1, 'rgba(254, 240, 138, 0)')
  ctx.fillStyle = sunGlow
  ctx.fillRect(0, 0, viewportW, viewportH)

  // Cel-shaded diagonal sunbeams
  for (let r = 0; r < 7; r++) {
    const angle = Math.PI * 0.58 + r * 0.105 + Math.sin(now * 0.0008 + r) * 0.028
    const spread = 0.036
    const beamLen = Math.hypot(viewportW, viewportH) * 0.92
    ctx.beginPath()
    ctx.moveTo(sunX, sunY)
    ctx.lineTo(sunX + Math.cos(angle - spread) * beamLen, sunY + Math.sin(angle - spread) * beamLen)
    ctx.lineTo(sunX + Math.cos(angle + spread) * beamLen, sunY + Math.sin(angle + spread) * beamLen)
    ctx.closePath()
    const beamGrad = ctx.createRadialGradient(sunX, sunY, 20, sunX, sunY, beamLen * 0.78)
    beamGrad.addColorStop(0, 'rgba(255, 251, 235, 0.18)')
    beamGrad.addColorStop(1, 'rgba(255, 251, 235, 0)')
    ctx.fillStyle = beamGrad
    ctx.fill()
  }

  // Anime camera lens-flare bokeh circles along the sun diagonal
  const bokehSteps = [
    { dist: 0.18, r: 22, color: 'rgba(254, 240, 138, 0.18)' },
    { dist: 0.31, r: 38, color: 'rgba(167, 243, 208, 0.14)' },
    { dist: 0.46, r: 16, color: 'rgba(249, 168, 212, 0.16)' },
    { dist: 0.62, r: 48, color: 'rgba(125, 211, 252, 0.12)' },
    { dist: 0.76, r: 28, color: 'rgba(254, 249, 195, 0.16)' }
  ]
  for (const bk of bokehSteps) {
    const bx = sunX - viewportW * bk.dist * 0.72
    const by = sunY + viewportH * bk.dist * 0.68
    ctx.fillStyle = bk.color
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(bx, by, bk.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // Pastel anime rainbow arc
  const rbCx = viewportW * 0.46
  const rbCy = viewportH * 0.92
  const rbRadius = Math.min(viewportW, viewportH) * 0.78
  const rainbowColors = [
    'rgba(251, 113, 133, 0.12)',
    'rgba(251, 191, 36, 0.12)',
    'rgba(110, 231, 183, 0.12)',
    'rgba(125, 211, 252, 0.12)',
    'rgba(196, 181, 253, 0.12)'
  ]
  ctx.lineCap = 'round'
  rainbowColors.forEach((color, idx) => {
    ctx.beginPath()
    ctx.arc(rbCx, rbCy, rbRadius - idx * 8.5, Math.PI * 1.12, Math.PI * 1.88)
    ctx.strokeStyle = color
    ctx.lineWidth = 7.5
    ctx.stroke()
  })

  // Floating golden 4-point sparkles & dandelion seeds
  for (let i = 0; i < sunMotes.length; i++) {
    const mote = sunMotes[i]!
    mote.x += (mote.vx + Math.sin(now * 0.0015 + mote.phase) * 12) * dt
    mote.y += mote.vy * dt
    if (mote.y < -20) {
      mote.y = viewportH + 15
      mote.x = Math.random() * viewportW
    }
    if (mote.x > viewportW + 20) mote.x = -15

    const twinkle = 0.55 + Math.sin(now * 0.004 + mote.phase) * 0.45
    if (i % 5 === 0) {
      drawDandelionSeed(ctx, mote.x, mote.y, mote.radius * 1.7, 0.2, mote.alpha * twinkle)
    } else {
      drawFourPointStar(
        ctx,
        mote.x,
        mote.y,
        mote.radius * 2.2,
        mote.radius * 0.6,
        now * 0.002 + mote.phase,
        i % 2 === 0
          ? `rgba(254, 249, 195, ${mote.alpha * twinkle})`
          : `rgba(167, 243, 208, ${mote.alpha * twinkle})`
      )
    }
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
  isMounted = true
  updateCanvasSize()
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateCanvasSize()
    })
    resizeObserver.observe(rootEl.value)
  }
  window.addEventListener('pointerdown', onGlobalPointerDown, true)
  window.addEventListener('keydown', onGlobalKeyDown)
  lastFrameTime = performance.now()
  rafId = requestAnimationFrame(renderFrame)
})

onBeforeUnmount(() => {
  isMounted = false
  window.removeEventListener('pointerdown', onGlobalPointerDown, true)
  window.removeEventListener('keydown', onGlobalKeyDown)
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
  gap: 6px;
}

.canvas-weather-hud__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.38);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.68), rgba(15, 23, 42, 0.58));
  backdrop-filter: blur(12px);
  color: #f8fafc;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.15s ease;
}

.canvas-weather-hud.is-active .canvas-weather-hud__pill {
  border-color: rgba(153, 246, 228, 0.72);
  box-shadow:
    0 0 18px rgba(94, 234, 212, 0.28),
    0 0 0 1px rgba(254, 249, 195, 0.22) inset;
}

.canvas-weather-hud__pill:hover,
.canvas-weather-hud__dice:hover {
  background: linear-gradient(135deg, rgba(51, 65, 85, 0.78), rgba(30, 41, 59, 0.72));
  border-color: rgba(254, 240, 138, 0.75);
}

.canvas-weather-hud__dice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.36);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.68), rgba(15, 23, 42, 0.58));
  backdrop-filter: blur(12px);
  color: #fef08a;
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
  border-radius: 14px;
  border: 1px solid rgba(226, 232, 240, 0.34);
  background: linear-gradient(160deg, rgba(30, 41, 59, 0.84), rgba(15, 23, 42, 0.78));
  backdrop-filter: blur(16px);
  box-shadow:
    0 12px 28px rgba(15, 23, 42, 0.32),
    0 0 0 1px rgba(254, 249, 195, 0.14) inset;
  min-width: 276px;
}

.canvas-weather-hud__palettes {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.16);
}

.canvas-weather-hud__section-title {
  font-size: 10.5px;
  color: #cbd5e1;
  letter-spacing: 0.03em;
  opacity: 0.9;
}

.canvas-weather-hud__palette-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.canvas-weather-hud__palette-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.16);
  background: rgba(51, 65, 85, 0.42);
  color: #e2e8f0;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.canvas-weather-hud__palette-btn:hover {
  background: rgba(71, 85, 105, 0.65);
  border-color: rgba(186, 230, 253, 0.45);
  color: #ffffff;
}

.canvas-weather-hud__palette-btn.is-selected {
  border-color: rgba(254, 240, 138, 0.85);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.34), rgba(244, 114, 182, 0.28));
  color: #fffbeb;
  box-shadow: 0 0 12px rgba(253, 224, 71, 0.24);
}

.canvas-weather-hud__swatch {
  width: 13px;
  height: 13px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 0 6px rgba(248, 250, 252, 0.35);
  flex-shrink: 0;
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
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.16);
  background: rgba(51, 65, 85, 0.42);
  color: #e2e8f0;
  font-size: 11.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.canvas-weather-hud__mode-btn:hover {
  background: rgba(71, 85, 105, 0.65);
  border-color: rgba(186, 230, 253, 0.45);
  color: #ffffff;
}

.canvas-weather-hud__mode-btn.is-selected {
  border-color: rgba(153, 246, 228, 0.82);
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.36), rgba(56, 189, 248, 0.32));
  color: #f0fdfa;
  box-shadow: 0 0 12px rgba(94, 234, 212, 0.24);
}

.canvas-weather-hud__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  padding-top: 6px;
  border-top: 1px solid rgba(226, 232, 240, 0.16);
}

.canvas-weather-hud__action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.2);
  background: rgba(51, 65, 85, 0.4);
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.canvas-weather-hud__action-btn.is-on {
  border-color: rgba(110, 231, 183, 0.68);
  background: rgba(16, 185, 129, 0.28);
  color: #ecfdf5;
}

.canvas-weather-hud__action-btn.is-shuffle {
  border-color: rgba(244, 114, 182, 0.58);
  background: rgba(192, 132, 252, 0.26);
  color: #fdf2f8;
}

.canvas-weather-hud__action-btn.is-shuffle:hover {
  background: rgba(217, 70, 239, 0.38);
}

.canvas-weather-hud__action-btn.is-strike {
  border-color: rgba(253, 224, 71, 0.65);
  background: rgba(234, 179, 8, 0.26);
  color: #fef9c3;
}

.canvas-weather-hud__action-btn.is-strike:hover {
  background: rgba(234, 179, 8, 0.4);
}
</style>
