import { computed, readonly, ref, watch } from 'vue'
import { editorPreferences } from '../../editor/preferences'
import { canvasWeatherAudio, type WeatherKind } from './canvasWeatherAudio'

export type { WeatherKind }

export interface WeatherNodeRect {
  id: string
  /** World-space X */
  x: number
  /** World-space Y */
  y: number
  /** World-space width */
  width: number
  /** World-space height */
  height: number
  /** Screen-space X (relative to viewport container) */
  screenX: number
  /** Screen-space Y (relative to viewport container) */
  screenY: number
  /** Screen-space width */
  screenWidth: number
  /** Screen-space height */
  screenHeight: number
  /** Whether this node is currently running or highlighted */
  isActive?: boolean
}

export interface NodeWeatherTransform {
  /** World-space X offset (px) */
  dx: number
  /** World-space Y offset (px) */
  dy: number
  /** Tilt rotation in degrees */
  rotDeg: number
  /** 0..1 lightning plasma charge for visual highlight */
  electricCharge: number
  /** 0..1 rain / mist wetness gloss */
  wetness: number
  /** 0..1 sunlit golden rim */
  sunlitGlow: number
  /** 0..1 blizzard / hail icy frost & snow cap */
  frostLevel: number
  /** 0..1 sandstorm amber desert dust rim */
  dustLevel: number
  /** 0..1 aurora / meteor cosmic iridescent aura */
  auroraGlow: number
}

interface NodePhysicsInternal {
  dx: number
  dy: number
  vx: number
  vy: number
  rot: number
  vrot: number
  electricCharge: number
  wetness: number
  sunlitGlow: number
  frostLevel: number
  dustLevel: number
  auroraGlow: number
  seed: number
}

export interface LightningStrikeEvent {
  id: number
  /** Screen-space target X */
  targetScreenX: number
  /** Screen-space target Y */
  targetScreenY: number
  /** Target node ID if striking a node */
  targetNodeId: string | null
  intensity: number
  createdAt: number
}

/**
 * Pool of 10 active natural & extreme weather spectacles that play randomly during task execution.
 */
export const ACTIVE_WEATHER_POOL: readonly WeatherKind[] = [
  'wind',
  'rain',
  'thunderstorm',
  'typhoon',
  'blizzard',
  'hail',
  'sandstorm',
  'meteor',
  'aurora',
  'fog'
]

const activeTaskSources = new Set<string>()
const currentWeather = ref<WeatherKind>('idle')
const manualOverride = ref<'auto' | WeatherKind>('auto')
const weatherIntensity = ref(0)
const lightningEvents = ref<LightningStrikeEvent[]>([])
let nextLightningId = 1

let shuffledBag: WeatherKind[] = []
let cycleTimeout: ReturnType<typeof setTimeout> | null = null
let sunnyTimeout: ReturnType<typeof setTimeout> | null = null

const nodePhysicsMap = new Map<string, NodePhysicsInternal>()
const nodeTransformsReactive = ref<Record<string, NodeWeatherTransform>>({})
const physicsTickVersion = ref(0)

// Vortex eye position in screen normalized coordinates (0..1)
export const vortexEyeNorm = {
  x: 0.5,
  y: 0.45,
  vx: 0.08,
  vy: 0.05
}

function hashSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

function getOrCreateNodePhysics(id: string): NodePhysicsInternal {
  let state = nodePhysicsMap.get(id)
  if (!state) {
    state = {
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      rot: 0,
      vrot: 0,
      electricCharge: 0,
      wetness: 0,
      sunlitGlow: 0,
      frostLevel: 0,
      dustLevel: 0,
      auroraGlow: 0,
      seed: hashSeed(id)
    }
    nodePhysicsMap.set(id, state)
  }
  return state
}

function clearTimers(): void {
  if (cycleTimeout) {
    clearTimeout(cycleTimeout)
    cycleTimeout = null
  }
  if (sunnyTimeout) {
    clearTimeout(sunnyTimeout)
    sunnyTimeout = null
  }
}

/**
 * Draw the next random weather from a Fisher-Yates shuffled bag,
 * guaranteeing no immediate back-to-back duplicate weather.
 */
export function pickNextRandomWeather(exclude?: WeatherKind): WeatherKind {
  if (shuffledBag.length === 0) {
    const fresh = [...ACTIVE_WEATHER_POOL]
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = fresh[i]!
      fresh[i] = fresh[j]!
      fresh[j] = tmp
    }
    // Avoid repeating the current weather at the boundary between two bags
    const avoid = exclude ?? currentWeather.value
    if (fresh[0] === avoid && fresh.length > 1) {
      const swapIdx = 1 + Math.floor(Math.random() * (fresh.length - 1))
      const tmp = fresh[0]!
      fresh[0] = fresh[swapIdx]!
      fresh[swapIdx] = tmp
    }
    shuffledBag = fresh
  }

  let picked = shuffledBag.shift()!
  const avoid = exclude ?? currentWeather.value
  if (picked === avoid && shuffledBag.length > 0) {
    const next = shuffledBag.shift()!
    shuffledBag.push(picked)
    picked = next
  }
  return picked
}

function applyEffectiveWeather(next: WeatherKind): void {
  if (!editorPreferences.weatherSystemEnabled.value) {
    currentWeather.value = 'idle'
    canvasWeatherAudio.setWeather('idle')
    return
  }
  currentWeather.value = next
  canvasWeatherAudio.setWeather(next)
}

function scheduleNextRandomStormStep(): void {
  if (cycleTimeout) {
    clearTimeout(cycleTimeout)
    cycleTimeout = null
  }
  // Randomized duration (4.4s - 6.8s) so weather shifts feel organic
  const nextDelayMs = Math.round(4400 + Math.random() * 2400)
  cycleTimeout = setTimeout(() => {
    cycleTimeout = null
    if (manualOverride.value !== 'auto') return
    if (activeTaskSources.size === 0) return
    const nextKind = pickNextRandomWeather(currentWeather.value)
    applyEffectiveWeather(nextKind)
    scheduleNextRandomStormStep()
  }, nextDelayMs)
}

function startStormCycle(): void {
  clearTimers()
  shuffledBag = []
  const firstKind = pickNextRandomWeather(currentWeather.value)
  applyEffectiveWeather(firstKind)
  scheduleNextRandomStormStep()
}

/**
 * Immediately switch to a newly picked random weather spectacle.
 */
export function shuffleWeatherNow(): WeatherKind {
  const next = pickNextRandomWeather(currentWeather.value)
  if (manualOverride.value !== 'auto') {
    manualOverride.value = next
  }
  applyEffectiveWeather(next)
  if (manualOverride.value === 'auto' && activeTaskSources.size > 0) {
    scheduleNextRandomStormStep()
  }
  return next
}

/**
 * Notify the weather system that an AI chat task or graph execution has started.
 */
export function notifyWeatherTaskStart(sourceId = 'ai-chat'): void {
  const wasEmpty = activeTaskSources.size === 0
  activeTaskSources.add(sourceId)
  if (!editorPreferences.weatherSystemEnabled.value) return

  if (sunnyTimeout) {
    clearTimeout(sunnyTimeout)
    sunnyTimeout = null
  }

  if (manualOverride.value !== 'auto') {
    applyEffectiveWeather(manualOverride.value)
    return
  }

  if (wasEmpty || currentWeather.value === 'idle' || currentWeather.value === 'sunny') {
    startStormCycle()
  }
}

/** Duration (ms) of the 'sunny' celebration weather after a task completes before returning to 'idle'. */
export const SUNNY_COMPLETE_DURATION_MS = 2000

/**
 * Notify the weather system that an AI chat task or graph execution has completed.
 * Transitions the weather to 'sunny' (clear sky + golden rays + rainbow) for 2s before returning to 'idle'.
 * Ignores completion calls for sources that were not actively running (e.g. initial watcher evaluation on canvas mount).
 */
export function notifyWeatherTaskComplete(sourceId = 'ai-chat'): void {
  const wasActive = activeTaskSources.delete(sourceId)
  if (!wasActive) return
  if (activeTaskSources.size > 0) return

  clearTimers()
  if (!editorPreferences.weatherSystemEnabled.value) {
    applyEffectiveWeather('idle')
    return
  }

  if (manualOverride.value !== 'auto') {
    return
  }

  applyEffectiveWeather('sunny')
  sunnyTimeout = setTimeout(() => {
    sunnyTimeout = null
    if (activeTaskSources.size === 0 && manualOverride.value === 'auto') {
      applyEffectiveWeather('idle')
    }
  }, SUNNY_COMPLETE_DURATION_MS)
}

/**
 * Escalate or pulse the weather when an AI tool call or node action happens during execution.
 */
export function notifyWeatherTaskPulse(opts?: {
  preferLightning?: boolean
  targetNodeId?: string | null
}): void {
  if (!editorPreferences.weatherSystemEnabled.value) return
  if (activeTaskSources.size === 0 && manualOverride.value === 'auto') {
    notifyWeatherTaskStart('ai-chat')
  }
  // 30% chance on tool call to also shift to a fresh random weather front when in 'auto' mode
  if (manualOverride.value === 'auto' && activeTaskSources.size > 0 && Math.random() < 0.3) {
    shuffleWeatherNow()
  }
  if (opts?.preferLightning) {
    triggerWeatherLightningStrike({ targetNodeId: opts.targetNodeId ?? null, intensity: 1.0 })
  } else if (currentWeather.value === 'meteor') {
    canvasWeatherAudio.playMeteorWhooshSfx()
  } else {
    canvasWeatherAudio.playWindGustSfx(0.85)
  }
}

/**
 * Manually set weather mode ('auto' or a specific WeatherKind) from the HUD pill.
 */
export function setWeatherManualMode(mode: 'auto' | WeatherKind): void {
  manualOverride.value = mode
  clearTimers()
  if (mode === 'auto') {
    if (activeTaskSources.size > 0) {
      startStormCycle()
    } else {
      applyEffectiveWeather('idle')
    }
  } else {
    applyEffectiveWeather(mode)
  }
}

/**
 * Trigger a lightning bolt strike on a node or viewport position, applying radial shockwave physics.
 */
export function triggerWeatherLightningStrike(opts?: {
  targetScreenX?: number
  targetScreenY?: number
  targetNodeId?: string | null
  intensity?: number
  visibleNodes?: WeatherNodeRect[]
}): LightningStrikeEvent | null {
  if (!editorPreferences.weatherSystemEnabled.value) return null

  const nodes = opts?.visibleNodes ?? lastKnownVisibleNodes
  let targetNode: WeatherNodeRect | undefined

  if (opts?.targetNodeId) {
    targetNode = nodes.find((n) => n.id === opts.targetNodeId)
  }
  if (!targetNode && nodes.length > 0) {
    const activeNodes = nodes.filter((n) => n.isActive)
    const pool = activeNodes.length > 0 ? activeNodes : nodes
    targetNode = pool[Math.floor(Math.random() * pool.length)]
  }

  const targetScreenX =
    opts?.targetScreenX ??
    (targetNode
      ? targetNode.screenX + targetNode.screenWidth * (0.25 + Math.random() * 0.5)
      : 480 + (Math.random() - 0.5) * 320)
  const targetScreenY =
    opts?.targetScreenY ??
    (targetNode ? targetNode.screenY + Math.min(28, targetNode.screenHeight * 0.2) : 280)

  const intensity = opts?.intensity ?? 1.0
  const ev: LightningStrikeEvent = {
    id: nextLightningId++,
    targetScreenX,
    targetScreenY,
    targetNodeId: targetNode?.id ?? null,
    intensity,
    createdAt: performance.now()
  }

  lightningEvents.value = [...lightningEvents.value.slice(-5), ev]
  canvasWeatherAudio.playLightningStrikeSfx(intensity)

  // Apply instantaneous physical recoil to the struck node and radial shockwave to nearby nodes
  for (const node of nodes) {
    const phys = getOrCreateNodePhysics(node.id)
    const nodeCenterX = node.screenX + node.screenWidth * 0.5
    const nodeCenterY = node.screenY + node.screenHeight * 0.5
    const rx = nodeCenterX - targetScreenX
    const ry = nodeCenterY - targetScreenY
    const dist = Math.hypot(rx, ry)

    if (targetNode && node.id === targetNode.id) {
      phys.electricCharge = 1.0
      phys.vy += 155 * intensity
      phys.vx += (Math.random() - 0.5) * 140 * intensity
      phys.vrot += (Math.random() - 0.5) * 28 * intensity
    } else if (dist < 620) {
      const falloff = Math.pow(1 - dist / 620, 1.6)
      const nx = dist > 1 ? rx / dist : 0
      const ny = dist > 1 ? ry / dist : 1
      phys.vx += nx * 165 * falloff * intensity
      phys.vy += ny * 145 * falloff * intensity
      phys.vrot += nx * 18 * falloff * intensity
      phys.electricCharge = Math.max(phys.electricCharge, falloff * 0.65)
    }
  }

  return ev
}

/**
 * Apply a micro-impulse when a raindrop splashes onto the top border of a node card.
 */
export function applyRaindropNodeImpact(nodeId: string, hitRatioX = 0.5): void {
  const phys = getOrCreateNodePhysics(nodeId)
  phys.vy += 8.5
  phys.vrot += (hitRatioX - 0.5) * 2.8
  phys.wetness = Math.min(1, phys.wetness + 0.06)
  canvasWeatherAudio.playRainSplashSfx()
}

/**
 * Apply a sharp bouncy impact when a hailstone strikes the top border of a node card.
 */
export function applyHailstoneNodeImpact(nodeId: string, hitRatioX = 0.5): void {
  const phys = getOrCreateNodePhysics(nodeId)
  phys.vy += 24
  phys.vx += (hitRatioX - 0.5) * 18
  phys.vrot += (hitRatioX - 0.5) * 6.8
  phys.frostLevel = Math.min(1, phys.frostLevel + 0.09)
  canvasWeatherAudio.playHailImpactSfx()
}

/**
 * Apply a cosmic shockwave & aurora glow when a meteor streaks close to or impacts a node card.
 */
export function applyMeteorNodeImpact(nodeId: string, dirX = 0.7, dirY = 0.7): void {
  const phys = getOrCreateNodePhysics(nodeId)
  phys.vx += dirX * 85
  phys.vy += dirY * 85
  phys.vrot += (Math.random() - 0.5) * 14
  phys.auroraGlow = 1.0
  canvasWeatherAudio.playMeteorWhooshSfx()
}

let lastKnownVisibleNodes: WeatherNodeRect[] = []

/**
 * Step the spring-damper physics simulation for all visible canvas nodes.
 * Called once per animation frame by `CanvasWeatherOverlay.vue`.
 */
export function stepNodeWeatherPhysics(
  visibleNodes: WeatherNodeRect[],
  dtSec: number,
  viewportWidth: number,
  viewportHeight: number,
  suppressDisplacement = false
): void {
  lastKnownVisibleNodes = visibleNodes
  const dt = Math.min(0.05, Math.max(0.001, dtSec))
  const weather = currentWeather.value
  const nowSec = performance.now() * 0.001

  // Smooth weather intensity envelope
  const targetIntensity = weather === 'idle' ? 0 : 1
  weatherIntensity.value += (targetIntensity - weatherIntensity.value) * Math.min(1, dt * 3.2)

  // Move typhoon vortex eye smoothly around the canvas
  if (weather === 'typhoon') {
    vortexEyeNorm.x = 0.5 + Math.sin(nowSec * 0.55) * 0.22 + Math.cos(nowSec * 0.23) * 0.08
    vortexEyeNorm.y = 0.46 + Math.cos(nowSec * 0.48) * 0.18
  }

  const nextTransforms: Record<string, NodeWeatherTransform> = {}
  const activeIds = new Set<string>()

  const eyeScreenX = vortexEyeNorm.x * Math.max(1, viewportWidth)
  const eyeScreenY = vortexEyeNorm.y * Math.max(1, viewportHeight)

  for (const node of visibleNodes) {
    activeIds.add(node.id)
    const phys = getOrCreateNodePhysics(node.id)
    const phase = phys.seed * Math.PI * 2

    let forceX = 0
    let forceY = 0
    let torque = 0

    // Decay surface states unless reinforced by current weather
    let wetnessTarget = 0
    let sunlitTarget = 0
    let frostTarget = 0
    let dustTarget = 0
    let auroraTarget = 0

    if (!suppressDisplacement && editorPreferences.weatherSystemEnabled.value) {
      switch (weather) {
        case 'wind': {
          const gustWave =
            Math.sin(nowSec * 2.8 - node.x * 0.0045 + phase) * 0.65 +
            Math.sin(nowSec * 5.3 - node.x * 0.008 - node.y * 0.003) * 0.35
          const baseWind = 58 + Math.sin(nowSec * 0.9) * 24
          forceX = baseWind + gustWave * 68
          forceY = Math.cos(nowSec * 3.1 + phase) * 18
          torque = (forceX * 0.038 + gustWave * 1.8) * (0.85 + phys.seed * 0.3)
          break
        }

        case 'rain': {
          const breeze = 22 + Math.sin(nowSec * 2.1 - node.x * 0.004 + phase) * 24
          forceX = breeze
          forceY = 10 + Math.sin(nowSec * 6.5 + phase) * 8
          torque = breeze * 0.025
          wetnessTarget = 1
          break
        }

        case 'thunderstorm': {
          const squall =
            Math.sin(nowSec * 3.6 - node.x * 0.005 + phase) * 75 +
            Math.cos(nowSec * 7.2 + phase * 1.7) * 32
          forceX = 48 + squall
          forceY = Math.sin(nowSec * 4.4 + phase) * 26
          torque = forceX * 0.036
          wetnessTarget = 1
          break
        }

        case 'typhoon': {
          const nodeCx = node.screenX + node.screenWidth * 0.5
          const nodeCy = node.screenY + node.screenHeight * 0.5
          const rx = nodeCx - eyeScreenX
          const ry = nodeCy - eyeScreenY
          const dist = Math.max(40, Math.hypot(rx, ry))
          const nx = rx / dist
          const ny = ry / dist
          const vortexStrength = Math.min(1.35, 320 / (dist + 120))
          const tangentSpeed = 135 * vortexStrength
          const suctionSpeed = dist > 150 ? -42 * vortexStrength : 30
          const flutter = Math.sin(nowSec * 9.5 + phase) * 28

          forceX = -ny * tangentSpeed + nx * suctionSpeed + flutter
          forceY = nx * tangentSpeed + ny * suctionSpeed + Math.cos(nowSec * 8.2 + phase) * 24
          torque = (-ny * 3.2 + Math.sin(nowSec * 7.8 + phase) * 2.6) * vortexStrength
          wetnessTarget = 1
          break
        }

        case 'blizzard': {
          // Freezing arctic gale + high-frequency shivering tremor
          const shiver = Math.sin(nowSec * 24 + phase * 3) * 14
          const snowGust = Math.sin(nowSec * 2.4 - node.x * 0.004 + phase) * 52
          forceX = 42 + snowGust + shiver
          forceY = 8 + Math.cos(nowSec * 3.2 + phase) * 14
          torque = snowGust * 0.032 + Math.sin(nowSec * 18 + phase) * 0.65
          frostTarget = 1
          break
        }

        case 'hail': {
          // Downward bombardment vibration + icy frost
          forceX = 18 + Math.sin(nowSec * 3.0 + phase) * 22
          forceY = 16 + Math.abs(Math.sin(nowSec * 9.2 + phase * 2)) * 22
          torque = Math.sin(nowSec * 11.5 + phase) * 1.4
          frostTarget = 0.85
          wetnessTarget = 0.5
          break
        }

        case 'sandstorm': {
          // Strong horizontal desert dune gale + gritty vibration
          const sandWall =
            72 +
            Math.sin(nowSec * 3.1 - node.x * 0.005 + phase) * 64 +
            Math.sin(nowSec * 14.0 + phase) * 12
          forceX = sandWall
          forceY = Math.sin(nowSec * 4.2 + phase) * 15
          torque = sandWall * 0.034
          dustTarget = 1
          break
        }

        case 'meteor': {
          // Low-gravity celestial float
          forceX = Math.sin(nowSec * 1.4 + phase) * 16
          forceY = -14 + Math.cos(nowSec * 1.8 + phase) * 14
          torque = Math.sin(nowSec * 1.2 + phase) * 0.85
          auroraTarget = 0.75
          break
        }

        case 'aurora': {
          // Harmonic geomagnetic levitation wave across world X
          const magWave = Math.sin(nowSec * 1.8 - node.x * 0.0035 + phase)
          forceX = Math.cos(nowSec * 1.3 + phase) * 18
          forceY = magWave * 26 - 8
          torque = magWave * 1.25
          auroraTarget = 1
          break
        }

        case 'fog': {
          // Slow, dreamy mist drift
          forceX = Math.sin(nowSec * 0.85 + phase) * 14
          forceY = Math.cos(nowSec * 0.95 + phase) * 10
          torque = Math.sin(nowSec * 0.75 + phase) * 0.45
          wetnessTarget = 0.45
          break
        }

        case 'sunny': {
          forceX = Math.sin(nowSec * 1.2 + phase) * 10
          forceY = -12 + Math.cos(nowSec * 1.5 + phase) * 9
          torque = Math.sin(nowSec * 1.1 + phase) * 0.45
          sunlitTarget = 1
          break
        }

        case 'idle':
        default:
          break
      }
    }

    // Smooth surface coating transitions (decay rapidly once weather returns to idle)
    const rate = weather === 'idle' ? 3.5 : suppressDisplacement ? 1.4 : 0.55
    phys.wetness += (wetnessTarget - phys.wetness) * Math.min(1, dt * rate)
    phys.sunlitGlow += (sunlitTarget - phys.sunlitGlow) * Math.min(1, dt * (rate + 0.25))
    phys.frostLevel += (frostTarget - phys.frostLevel) * Math.min(1, dt * rate)
    phys.dustLevel += (dustTarget - phys.dustLevel) * Math.min(1, dt * rate)
    phys.auroraGlow += (auroraTarget - phys.auroraGlow) * Math.min(1, dt * rate)

    // Spring-damper integration
    const stiffness = suppressDisplacement ? 42 : 18
    const damping = suppressDisplacement ? 12 : 5.4

    const ax = forceX - stiffness * phys.dx - damping * phys.vx
    const ay = forceY - stiffness * phys.dy - damping * phys.vy
    const arot = torque - stiffness * 1.2 * phys.rot - damping * 1.1 * phys.vrot

    phys.vx += ax * dt
    phys.vy += ay * dt
    phys.vrot += arot * dt

    phys.dx += phys.vx * dt
    phys.dy += phys.vy * dt
    phys.rot += phys.vrot * dt

    // Clamp max excursion so nodes remain easy to read and click
    phys.dx = Math.max(-22, Math.min(22, phys.dx))
    phys.dy = Math.max(-16, Math.min(16, phys.dy))
    phys.rot = Math.max(-3.6, Math.min(3.6, phys.rot))

    phys.electricCharge = Math.max(0, phys.electricCharge - dt * 1.35)

    if (
      Math.abs(phys.dx) > 0.04 ||
      Math.abs(phys.dy) > 0.04 ||
      Math.abs(phys.rot) > 0.02 ||
      phys.electricCharge > 0.01 ||
      phys.wetness > 0.01 ||
      phys.sunlitGlow > 0.01 ||
      phys.frostLevel > 0.01 ||
      phys.dustLevel > 0.01 ||
      phys.auroraGlow > 0.01
    ) {
      nextTransforms[node.id] = {
        dx: phys.dx,
        dy: phys.dy,
        rotDeg: phys.rot,
        electricCharge: phys.electricCharge,
        wetness: phys.wetness,
        sunlitGlow: phys.sunlitGlow,
        frostLevel: phys.frostLevel,
        dustLevel: phys.dustLevel,
        auroraGlow: phys.auroraGlow
      }
    }
  }

  // Prune stale node entries
  if (nodePhysicsMap.size > visibleNodes.length + 40) {
    for (const key of nodePhysicsMap.keys()) {
      if (!activeIds.has(key)) {
        nodePhysicsMap.delete(key)
      }
    }
  }

  nodeTransformsReactive.value = nextTransforms
  physicsTickVersion.value = (physicsTickVersion.value + 1) % 1000000
}

export function getNodeWeatherTransform(nodeId: string): NodeWeatherTransform | undefined {
  return nodeTransformsReactive.value[nodeId]
}

// Keep audio buses synchronized when user toggles preferences in Settings or HUD
watch(
  () => [
    editorPreferences.weatherSystemEnabled.value,
    editorPreferences.weatherSfxEnabled.value,
    editorPreferences.weatherBgmEnabled.value
  ],
  ([sysOn]) => {
    canvasWeatherAudio.syncPreferences()
    if (!sysOn) {
      currentWeather.value = 'idle'
      canvasWeatherAudio.setWeather('idle')
      nodeTransformsReactive.value = {}
    } else if (manualOverride.value !== 'auto') {
      applyEffectiveWeather(manualOverride.value)
    } else if (activeTaskSources.size > 0 && currentWeather.value === 'idle') {
      startStormCycle()
    }
  },
  { flush: 'sync' }
)

export const canvasWeatherState = {
  currentWeather: readonly(currentWeather),
  manualOverride: readonly(manualOverride),
  weatherIntensity: readonly(weatherIntensity),
  lightningEvents: readonly(lightningEvents),
  nodeTransforms: readonly(nodeTransformsReactive),
  physicsTickVersion: readonly(physicsTickVersion),
  isWeatherActive: computed(
    () =>
      editorPreferences.weatherSystemEnabled.value &&
      (currentWeather.value !== 'idle' || Object.keys(nodeTransformsReactive.value).length > 0)
  )
}
