import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_SCENE_PALETTE_VALUES, normalizeCanvasScenePalette } from '../src/shared/domain'
import {
  editorPreferences,
  setCanvasPalette,
  setWeatherBgmEnabled,
  setWeatherSfxEnabled,
  setWeatherSystemEnabled
} from '../src/renderer/src/editor/preferences'
import {
  ACTIVE_WEATHER_POOL,
  SUNNY_COMPLETE_DURATION_MS,
  applyHailstoneNodeImpact,
  applyMeteorNodeImpact,
  applyRaindropNodeImpact,
  canvasWeatherState,
  notifyWeatherTaskComplete,
  notifyWeatherTaskStart,
  pickNextRandomWeather,
  setWeatherManualMode,
  shuffleWeatherNow,
  stepNodeWeatherPhysics,
  triggerWeatherLightningStrike,
  type WeatherNodeRect
} from '../src/renderer/src/graph/vfx/canvasWeatherEngine'

const SAMPLE_NODES: WeatherNodeRect[] = [
  {
    id: 'node-a',
    x: 100,
    y: 120,
    width: 240,
    height: 160,
    screenX: 100,
    screenY: 120,
    screenWidth: 240,
    screenHeight: 160,
    isActive: true
  },
  {
    id: 'node-b',
    x: 420,
    y: 180,
    width: 240,
    height: 160,
    screenX: 420,
    screenY: 180,
    screenWidth: 240,
    screenHeight: 160,
    isActive: false
  }
]

describe('canvasWeatherEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setWeatherSystemEnabled(true)
    setWeatherSfxEnabled(true)
    setWeatherBgmEnabled(true)
    setWeatherManualMode('auto')
    notifyWeatherTaskComplete('ai-chat')
    vi.advanceTimersByTime(10000)
  })

  it('does not trigger sunny weather on initial canvas open when no task was active', () => {
    expect(canvasWeatherState.currentWeather.value).toBe('idle')
    notifyWeatherTaskComplete('graph:main')
    expect(canvasWeatherState.currentWeather.value).toBe('idle')
  })

  it('randomly cycles through the 10 weather spectacles without immediate repeats and clears to sunny for 2s on completion', () => {
    expect(canvasWeatherState.currentWeather.value).toBe('idle')
    expect(ACTIVE_WEATHER_POOL.length).toBe(10)
    expect(SUNNY_COMPLETE_DURATION_MS).toBe(2000)

    notifyWeatherTaskStart('ai-chat')
    const first = canvasWeatherState.currentWeather.value
    expect(ACTIVE_WEATHER_POOL).toContain(first)

    const seen = new Set<string>([first])
    let prev = first
    for (let i = 0; i < 9; i++) {
      const next = shuffleWeatherNow()
      expect(ACTIVE_WEATHER_POOL).toContain(next)
      expect(next).not.toBe(prev)
      seen.add(next)
      prev = next
    }
    // Over 10 draws of a 10-weather shuffled bag, all 10 weather types are visited
    expect(seen.size).toBe(ACTIVE_WEATHER_POOL.length)

    const beforeTimer = canvasWeatherState.currentWeather.value
    vi.advanceTimersByTime(6900)
    expect(canvasWeatherState.currentWeather.value).not.toBe(beforeTimer)

    notifyWeatherTaskComplete('ai-chat')
    expect(canvasWeatherState.currentWeather.value).toBe('sunny')

    vi.advanceTimersByTime(1900)
    expect(canvasWeatherState.currentWeather.value).toBe('sunny')

    vi.advanceTimersByTime(200)
    expect(canvasWeatherState.currentWeather.value).toBe('idle')
  })

  it('guarantees pickNextRandomWeather never immediately repeats the excluded weather', () => {
    let last = pickNextRandomWeather('wind')
    expect(last).not.toBe('wind')
    for (let i = 0; i < 30; i++) {
      const next = pickNextRandomWeather(last)
      expect(next).not.toBe(last)
      last = next
    }
  })

  it('applies physical sway, raindrop splash, hailstone bounce, meteor impact, and lightning recoil to visible nodes', () => {
    setWeatherManualMode('blizzard')
    stepNodeWeatherPhysics(SAMPLE_NODES, 0.016, 1280, 720, false)
    stepNodeWeatherPhysics(SAMPLE_NODES, 0.016, 1280, 720, false)

    const blizzardTf = canvasWeatherState.nodeTransforms.value['node-a']
    expect(blizzardTf).toBeDefined()
    expect(blizzardTf!.frostLevel).toBeGreaterThan(0)

    applyRaindropNodeImpact('node-a', 0.3)
    applyHailstoneNodeImpact('node-a', 0.7)
    applyMeteorNodeImpact('node-a', 0.6, 0.8)
    stepNodeWeatherPhysics(SAMPLE_NODES, 0.016, 1280, 720, false)

    const impactTf = canvasWeatherState.nodeTransforms.value['node-a']
    expect(impactTf?.wetness).toBeGreaterThan(0)
    expect(impactTf?.frostLevel).toBeGreaterThan(0.05)
    expect(impactTf?.auroraGlow).toBeGreaterThan(0.5)

    const strike = triggerWeatherLightningStrike({
      targetNodeId: 'node-a',
      visibleNodes: SAMPLE_NODES,
      intensity: 1.0
    })
    expect(strike?.targetNodeId).toBe('node-a')
    stepNodeWeatherPhysics(SAMPLE_NODES, 0.016, 1280, 720, false)
    const struckTf = canvasWeatherState.nodeTransforms.value['node-a']
    expect(struckTf?.electricCharge).toBeGreaterThan(0.5)
  })

  it('disables weather and clears transforms when weatherSystemEnabled is turned off', () => {
    notifyWeatherTaskStart('ai-chat')
    expect(ACTIVE_WEATHER_POOL).toContain(canvasWeatherState.currentWeather.value)

    setWeatherSystemEnabled(false)
    expect(canvasWeatherState.currentWeather.value).toBe('idle')
  })

  it('supports switching and normalizing all 7 Genshin scene palettes (fontaine, celestia, mondstadt, natlan, liyue, starry_night, twilight_dusk) plus auto and classic', () => {
    expect(CANVAS_SCENE_PALETTE_VALUES).toEqual([
      'auto',
      'fontaine',
      'celestia',
      'mondstadt',
      'natlan',
      'liyue',
      'starry_night',
      'twilight_dusk',
      'classic'
    ])
    for (const id of CANVAS_SCENE_PALETTE_VALUES) {
      setCanvasPalette(id)
      expect(editorPreferences.canvasPalette.value).toBe(id)
    }
    expect(normalizeCanvasScenePalette('invalid-value')).toBe('classic')
  })
})
