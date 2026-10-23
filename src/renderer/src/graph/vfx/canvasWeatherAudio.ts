import { editorPreferences } from '../../editor/preferences'

export type WeatherKind =
  | 'idle'
  | 'wind'
  | 'rain'
  | 'thunderstorm'
  | 'typhoon'
  | 'blizzard'
  | 'hail'
  | 'sandstorm'
  | 'meteor'
  | 'aurora'
  | 'fog'
  | 'sunny'

/**
 * Procedural WebAudio synthesizer for the Canvas Dynamic Weather System.
 *
 * Generates:
 * 1. Continuous weather ambience beds (wind howling, rain downpour, storm rumble, typhoon vortex,
 *    arctic blizzard whistle, sandstorm grit hiss, aurora/meteor cosmic drone, dense fog resonance)
 * 2. Physical impact SFX (lightning strike + thunder clap, wind gust whoosh, raindrop node splash,
 *    hailstone ice clatter, shooting-star Doppler whoosh, sunny clear chime)
 * 3. Generative ambient background music (BGM) that adapts its harmony and rhythm to all 11 weather moods
 */
class CanvasWeatherAudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxBus: GainNode | null = null
  private bgmBus: GainNode | null = null

  private noiseBuffer: AudioBuffer | null = null
  private brownNoiseBuffer: AudioBuffer | null = null

  // Continuous SFX nodes
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private windLfo: OscillatorNode | null = null

  private rainGain: GainNode | null = null
  private rainHighGain: GainNode | null = null

  private vortexGain: GainNode | null = null
  private vortexFilter: BiquadFilterNode | null = null
  private vortexLfo: OscillatorNode | null = null

  // Continuous BGM scheduler
  private bgmTimer: ReturnType<typeof setInterval> | null = null
  private bgmStep = 0
  private currentWeather: WeatherKind = 'idle'
  private isRunningLoop = false
  private lastSplashAt = 0
  private lastHailAt = 0
  private lastGustAt = 0
  private lastMeteorAt = 0

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return null
      try {
        this.ctx = new AudioCtx()
        this.masterGain = this.ctx.createGain()
        this.masterGain.gain.value = 0.85
        this.masterGain.connect(this.ctx.destination)

        this.sfxBus = this.ctx.createGain()
        this.sfxBus.gain.value = editorPreferences.weatherSfxEnabled.value ? 0.75 : 0.0001
        this.sfxBus.connect(this.masterGain)

        this.bgmBus = this.ctx.createGain()
        this.bgmBus.gain.value = editorPreferences.weatherBgmEnabled.value ? 0.52 : 0.0001
        this.bgmBus.connect(this.masterGain)

        this.buildNoiseBuffers(this.ctx)
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined)
    }
    return this.ctx
  }

  private buildNoiseBuffers(ctx: AudioContext): void {
    const sampleRate = ctx.sampleRate
    const length = sampleRate * 4 // 4 seconds loop

    // Pink-ish noise buffer for rain, sand & wind
    const pinkBuffer = ctx.createBuffer(2, length, sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const out = pinkBuffer.getChannelData(ch)
      let b0 = 0
      let b1 = 0
      let b2 = 0
      let b3 = 0
      let b4 = 0
      let b5 = 0
      let b6 = 0
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.969 * b2 + white * 0.153852
        b3 = 0.8665 * b3 + white * 0.3104856
        b4 = 0.55 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.016898
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045
        b6 = white * 0.115926
      }
    }
    this.noiseBuffer = pinkBuffer

    // Brown noise buffer for deep thunder, typhoon & cosmic rumble
    const brownBuffer = ctx.createBuffer(2, length, sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const out = brownBuffer.getChannelData(ch)
      let lastOut = 0
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        out[i] = (lastOut + 0.02 * white) / 1.02
        lastOut = out[i]
        out[i] *= 0.28
      }
    }
    this.brownNoiseBuffer = brownBuffer
  }

  private startContinuousBeds(): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus || !this.noiseBuffer || !this.brownNoiseBuffer) return
    if (this.isRunningLoop) return
    this.isRunningLoop = true

    const now = ctx.currentTime

    // 1. Wind / Blizzard / Sand Bed
    const windSrc = ctx.createBufferSource()
    windSrc.buffer = this.noiseBuffer
    windSrc.loop = true

    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.setValueAtTime(320, now)
    windFilter.Q.setValueAtTime(3.2, now)

    const windLfo = ctx.createOscillator()
    windLfo.type = 'sine'
    windLfo.frequency.setValueAtTime(0.22, now)
    const windLfoGain = ctx.createGain()
    windLfoGain.gain.setValueAtTime(190, now)
    windLfo.connect(windLfoGain)
    windLfoGain.connect(windFilter.frequency)

    const windGain = ctx.createGain()
    windGain.gain.setValueAtTime(0.0001, now)

    windSrc.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(this.sfxBus)

    windSrc.start(now)
    windLfo.start(now)

    this.windFilter = windFilter
    this.windGain = windGain
    this.windLfo = windLfo

    // 2. Rain / Grit / Shimmer Bed
    const rainSrc = ctx.createBufferSource()
    rainSrc.buffer = this.noiseBuffer
    rainSrc.loop = true

    const rainFilter = ctx.createBiquadFilter()
    rainFilter.type = 'bandpass'
    rainFilter.frequency.setValueAtTime(1450, now)
    rainFilter.Q.setValueAtTime(0.75, now)

    const rainGain = ctx.createGain()
    rainGain.gain.setValueAtTime(0.0001, now)

    const rainHighFilter = ctx.createBiquadFilter()
    rainHighFilter.type = 'highpass'
    rainHighFilter.frequency.setValueAtTime(3600, now)

    const rainHighGain = ctx.createGain()
    rainHighGain.gain.setValueAtTime(0.0001, now)

    rainSrc.connect(rainFilter)
    rainFilter.connect(rainGain)
    rainGain.connect(this.sfxBus)

    rainSrc.connect(rainHighFilter)
    rainHighFilter.connect(rainHighGain)
    rainHighGain.connect(this.sfxBus)

    rainSrc.start(now)
    this.rainGain = rainGain
    this.rainHighGain = rainHighGain

    // 3. Typhoon / Sub-Rumble / Deep Drone Bed
    const vortexSrc = ctx.createBufferSource()
    vortexSrc.buffer = this.brownNoiseBuffer
    vortexSrc.loop = true

    const vortexFilter = ctx.createBiquadFilter()
    vortexFilter.type = 'lowpass'
    vortexFilter.frequency.setValueAtTime(240, now)
    vortexFilter.Q.setValueAtTime(4.5, now)

    const vortexLfo = ctx.createOscillator()
    vortexLfo.type = 'triangle'
    vortexLfo.frequency.setValueAtTime(0.48, now)
    const vortexLfoGain = ctx.createGain()
    vortexLfoGain.gain.setValueAtTime(160, now)
    vortexLfo.connect(vortexLfoGain)
    vortexLfoGain.connect(vortexFilter.frequency)

    const vortexGain = ctx.createGain()
    vortexGain.gain.setValueAtTime(0.0001, now)

    vortexSrc.connect(vortexFilter)
    vortexFilter.connect(vortexGain)
    vortexGain.connect(this.sfxBus)

    vortexSrc.start(now)
    vortexLfo.start(now)

    this.vortexFilter = vortexFilter
    this.vortexGain = vortexGain
    this.vortexLfo = vortexLfo

    // 4. Start BGM generative loop
    if (!this.bgmTimer) {
      this.bgmStep = 0
      this.bgmTimer = setInterval(() => {
        this.tickBgmPhrase()
      }, 1600)
    }
  }

  public syncPreferences(): void {
    if (!this.ctx || !this.sfxBus || !this.bgmBus) return
    const now = this.ctx.currentTime
    const systemOn = editorPreferences.weatherSystemEnabled.value
    const sfxOn = systemOn && editorPreferences.weatherSfxEnabled.value
    const bgmOn = systemOn && editorPreferences.weatherBgmEnabled.value

    this.sfxBus.gain.setTargetAtTime(sfxOn ? 0.75 : 0.0001, now, 0.15)
    this.bgmBus.gain.setTargetAtTime(bgmOn ? 0.52 : 0.0001, now, 0.25)
  }

  public setWeather(weather: WeatherKind): void {
    const prev = this.currentWeather
    this.currentWeather = weather

    if (!editorPreferences.weatherSystemEnabled.value) {
      this.fadeToIdle()
      return
    }

    if (weather !== 'idle') {
      this.startContinuousBeds()
    }
    this.syncPreferences()

    if (!this.ctx || !this.windGain || !this.rainGain || !this.rainHighGain || !this.vortexGain) {
      return
    }

    const now = this.ctx.currentTime
    const tau = 0.65

    switch (weather) {
      case 'wind':
        this.windGain.gain.setTargetAtTime(0.42, now, tau)
        this.windFilter?.frequency.setTargetAtTime(380, now, tau)
        this.windFilter?.Q.setTargetAtTime(3.2, now, tau)
        this.windLfo?.frequency.setTargetAtTime(0.28, now, tau)
        this.rainGain.gain.setTargetAtTime(0.0001, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.0001, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.08, now, tau)
        break

      case 'rain':
        this.windGain.gain.setTargetAtTime(0.18, now, tau)
        this.windFilter?.Q.setTargetAtTime(2.5, now, tau)
        this.rainGain.gain.setTargetAtTime(0.38, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.16, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.04, now, tau)
        break

      case 'thunderstorm':
        this.windGain.gain.setTargetAtTime(0.36, now, tau)
        this.windFilter?.frequency.setTargetAtTime(440, now, tau)
        this.windFilter?.Q.setTargetAtTime(3.4, now, tau)
        this.rainGain.gain.setTargetAtTime(0.48, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.22, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(210, now, tau)
        this.vortexLfo?.frequency.setTargetAtTime(0.35, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.26, now, tau)
        break

      case 'typhoon':
        this.windGain.gain.setTargetAtTime(0.62, now, tau)
        this.windFilter?.frequency.setTargetAtTime(560, now, tau)
        this.windFilter?.Q.setTargetAtTime(4.0, now, tau)
        this.windLfo?.frequency.setTargetAtTime(0.65, now, tau)
        this.rainGain.gain.setTargetAtTime(0.45, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.25, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(340, now, tau)
        this.vortexLfo?.frequency.setTargetAtTime(0.85, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.55, now, tau)
        break

      case 'blizzard':
        // High-Q arctic howling wind + crisp snow flurry hiss
        this.windGain.gain.setTargetAtTime(0.52, now, tau)
        this.windFilter?.frequency.setTargetAtTime(680, now, tau)
        this.windFilter?.Q.setTargetAtTime(6.5, now, tau)
        this.windLfo?.frequency.setTargetAtTime(0.38, now, tau)
        this.rainGain.gain.setTargetAtTime(0.06, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.12, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(190, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.18, now, tau)
        break

      case 'hail':
        // Crisp ice-storm downpour + wind
        this.windGain.gain.setTargetAtTime(0.32, now, tau)
        this.windFilter?.frequency.setTargetAtTime(420, now, tau)
        this.windFilter?.Q.setTargetAtTime(3.0, now, tau)
        this.rainGain.gain.setTargetAtTime(0.34, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.32, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(240, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.16, now, tau)
        break

      case 'sandstorm':
        // Dry desert sand friction hiss + deep dune resonance
        this.windGain.gain.setTargetAtTime(0.48, now, tau)
        this.windFilter?.frequency.setTargetAtTime(510, now, tau)
        this.windFilter?.Q.setTargetAtTime(2.0, now, tau)
        this.windLfo?.frequency.setTargetAtTime(0.44, now, tau)
        this.rainGain.gain.setTargetAtTime(0.22, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.28, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(150, now, tau)
        this.vortexLfo?.frequency.setTargetAtTime(0.25, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.32, now, tau)
        break

      case 'meteor':
        // Deep night breeze + subtle cosmic sub-bass
        this.windGain.gain.setTargetAtTime(0.12, now, tau)
        this.windFilter?.frequency.setTargetAtTime(280, now, tau)
        this.windFilter?.Q.setTargetAtTime(3.8, now, tau)
        this.rainGain.gain.setTargetAtTime(0.0001, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.02, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(120, now, tau)
        this.vortexLfo?.frequency.setTargetAtTime(0.18, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.22, now, tau)
        break

      case 'aurora':
        // Solar-wind harmonic whisper
        this.windGain.gain.setTargetAtTime(0.14, now, tau)
        this.windFilter?.frequency.setTargetAtTime(340, now, tau)
        this.windFilter?.Q.setTargetAtTime(5.2, now, tau)
        this.windLfo?.frequency.setTargetAtTime(0.16, now, tau)
        this.rainGain.gain.setTargetAtTime(0.0001, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.03, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(140, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.15, now, tau)
        break

      case 'fog':
        // Gentle hollow valley mist resonance
        this.windGain.gain.setTargetAtTime(0.16, now, tau)
        this.windFilter?.frequency.setTargetAtTime(210, now, tau)
        this.windFilter?.Q.setTargetAtTime(4.8, now, tau)
        this.windLfo?.frequency.setTargetAtTime(0.14, now, tau)
        this.rainGain.gain.setTargetAtTime(0.04, now, tau)
        this.rainHighGain.gain.setTargetAtTime(0.0001, now, tau)
        this.vortexFilter?.frequency.setTargetAtTime(110, now, tau)
        this.vortexGain.gain.setTargetAtTime(0.12, now, tau)
        break

      case 'sunny':
        this.windGain.gain.setTargetAtTime(0.08, now, 0.9)
        this.windFilter?.frequency.setTargetAtTime(260, now, 0.9)
        this.rainGain.gain.setTargetAtTime(0.0001, now, 0.6)
        this.rainHighGain.gain.setTargetAtTime(0.0001, now, 0.6)
        this.vortexGain.gain.setTargetAtTime(0.0001, now, 0.6)
        if (prev !== 'sunny') {
          this.playSunnyClearSfx()
        }
        break

      case 'idle':
      default:
        this.fadeToIdle()
        break
    }
  }

  private fadeToIdle(): void {
    if (!this.ctx || !this.windGain || !this.rainGain || !this.rainHighGain || !this.vortexGain) {
      return
    }
    const now = this.ctx.currentTime
    const tau = 0.8
    this.windGain.gain.setTargetAtTime(0.0001, now, tau)
    this.rainGain.gain.setTargetAtTime(0.0001, now, tau)
    this.rainHighGain.gain.setTargetAtTime(0.0001, now, tau)
    this.vortexGain.gain.setTargetAtTime(0.0001, now, tau)
  }

  /**
   * High-voltage lightning crack followed by rolling low-frequency thunder rumble.
   */
  public playLightningStrikeSfx(intensity = 1): void {
    if (
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherSfxEnabled.value
    ) {
      return
    }
    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus || !this.brownNoiseBuffer || !this.noiseBuffer) return

    const now = ctx.currentTime
    const scale = Math.max(0.35, Math.min(1.3, intensity))

    // 1. Electric snap / arc crackle
    const crackSrc = ctx.createBufferSource()
    crackSrc.buffer = this.noiseBuffer
    const crackFilter = ctx.createBiquadFilter()
    crackFilter.type = 'highpass'
    crackFilter.frequency.setValueAtTime(1800, now)
    const crackGain = ctx.createGain()
    crackGain.gain.setValueAtTime(0.45 * scale, now)
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)

    crackSrc.connect(crackFilter)
    crackFilter.connect(crackGain)
    crackGain.connect(this.sfxBus)
    crackSrc.start(now)
    crackSrc.stop(now + 0.2)

    // 2. High-voltage descending impulse zap
    const zapOsc = ctx.createOscillator()
    zapOsc.type = 'sawtooth'
    zapOsc.frequency.setValueAtTime(920, now)
    zapOsc.frequency.exponentialRampToValueAtTime(48, now + 0.14)
    const zapGain = ctx.createGain()
    zapGain.gain.setValueAtTime(0.22 * scale, now)
    zapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    zapOsc.connect(zapGain)
    zapGain.connect(this.sfxBus)
    zapOsc.start(now)
    zapOsc.stop(now + 0.16)

    // 3. Rolling thunder boom
    const thunderSrc = ctx.createBufferSource()
    thunderSrc.buffer = this.brownNoiseBuffer
    thunderSrc.loop = true

    const thunderFilter = ctx.createBiquadFilter()
    thunderFilter.type = 'lowpass'
    thunderFilter.frequency.setValueAtTime(190, now + 0.04)
    thunderFilter.frequency.exponentialRampToValueAtTime(55, now + 2.6)

    const thunderGain = ctx.createGain()
    thunderGain.gain.setValueAtTime(0.001, now)
    thunderGain.gain.linearRampToValueAtTime(0.85 * scale, now + 0.08)
    thunderGain.gain.exponentialRampToValueAtTime(0.28 * scale, now + 0.45)
    // Secondary echo swell
    thunderGain.gain.linearRampToValueAtTime(0.46 * scale, now + 0.72)
    thunderGain.gain.exponentialRampToValueAtTime(0.0008, now + 2.8)

    thunderSrc.connect(thunderFilter)
    thunderFilter.connect(thunderGain)
    thunderGain.connect(this.sfxBus)
    thunderSrc.start(now)
    thunderSrc.stop(now + 2.9)
  }

  /**
   * Subtle water droplet splash when raindrops collide with a node card's top border.
   */
  public playRainSplashSfx(): void {
    if (
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherSfxEnabled.value
    ) {
      return
    }
    const perfNow = performance.now()
    if (perfNow - this.lastSplashAt < 110) return
    this.lastSplashAt = perfNow

    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    const baseFreq = 1100 + Math.random() * 1400
    osc.frequency.setValueAtTime(baseFreq, now)
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.045)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.032, now)
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.05)

    osc.connect(gain)
    gain.connect(this.sfxBus)
    osc.start(now)
    osc.stop(now + 0.055)
  }

  /**
   * Crisp icy clatter / crystalline ping when a hailstone bounces off a node card roof.
   */
  public playHailImpactSfx(): void {
    if (
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherSfxEnabled.value
    ) {
      return
    }
    const perfNow = performance.now()
    if (perfNow - this.lastHailAt < 85) return
    this.lastHailAt = perfNow

    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    const freq = 1950 + Math.random() * 1650
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.52, now + 0.065)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.065, now)
    gain.gain.exponentialRampToValueAtTime(0.0006, now + 0.07)

    osc.connect(gain)
    gain.connect(this.sfxBus)
    osc.start(now)
    osc.stop(now + 0.075)
  }

  /**
   * Celestial Doppler whoosh + stardust chime when a shooting star / meteor streaks across the canvas.
   */
  public playMeteorWhooshSfx(): void {
    if (
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherSfxEnabled.value
    ) {
      return
    }
    const perfNow = performance.now()
    if (perfNow - this.lastMeteorAt < 650) return
    this.lastMeteorAt = perfNow

    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return

    const now = ctx.currentTime

    // 1. Doppler filter sweep
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.setValueAtTime(5.5, now)
    filter.frequency.setValueAtTime(1600, now)
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.55)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.18, now + 0.12)
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.58)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.sfxBus)
    src.start(now)
    src.stop(now + 0.6)

    // 2. Stardust harmonic bell
    const bell = ctx.createOscillator()
    bell.type = 'sine'
    const bellFreq = 1046.5 + Math.random() * 523.25
    bell.frequency.setValueAtTime(bellFreq, now + 0.08)
    const bellGain = ctx.createGain()
    bellGain.gain.setValueAtTime(0.055, now + 0.08)
    bellGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.85)
    bell.connect(bellGain)
    bellGain.connect(this.sfxBus)
    bell.start(now + 0.08)
    bell.stop(now + 0.9)
  }

  /**
   * Whooshing wind gust swell when a wind wave pushes nodes.
   */
  public playWindGustSfx(strength = 0.7): void {
    if (
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherSfxEnabled.value
    ) {
      return
    }
    const perfNow = performance.now()
    if (perfNow - this.lastGustAt < 900) return
    this.lastGustAt = perfNow

    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return

    const now = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.setValueAtTime(4.0, now)
    filter.frequency.setValueAtTime(240, now)
    filter.frequency.exponentialRampToValueAtTime(680, now + 0.45)
    filter.frequency.exponentialRampToValueAtTime(220, now + 1.15)

    const gain = ctx.createGain()
    const peak = Math.min(0.32, Math.max(0.08, strength * 0.25))
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.4)
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 1.2)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.sfxBus)
    src.start(now)
    src.stop(now + 1.25)
  }

  /**
   * Warm sunlit wind-chime / celesta resolution chord when tasks complete and the sky clears.
   */
  public playSunnyClearSfx(): void {
    if (
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherSfxEnabled.value
    ) {
      return
    }
    const ctx = this.ensureContext()
    if (!ctx || !this.sfxBus) return

    const now = ctx.currentTime
    // C Major 9 Lydian sparkle: C5, E5, G5, B5, D6, F#6, G6
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1479.98, 1567.98]
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.085
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, start)

      const overtone = ctx.createOscillator()
      overtone.type = 'triangle'
      overtone.frequency.setValueAtTime(freq * 2, start)

      const noteGain = ctx.createGain()
      noteGain.gain.setValueAtTime(0.0001, start)
      noteGain.gain.linearRampToValueAtTime(0.11, start + 0.025)
      noteGain.gain.exponentialRampToValueAtTime(0.0005, start + 1.85)

      const overtoneGain = ctx.createGain()
      overtoneGain.gain.setValueAtTime(0.025, start)
      overtoneGain.gain.exponentialRampToValueAtTime(0.0002, start + 0.65)

      osc.connect(noteGain)
      overtone.connect(overtoneGain)
      overtoneGain.connect(noteGain)
      noteGain.connect(this.sfxBus!)

      osc.start(start)
      overtone.start(start)
      osc.stop(start + 1.9)
      overtone.stop(start + 1.9)
    })
  }

  /**
   * Generative ambient background music phrase scheduler.
   * Adapts scale & timbre to all 11 active weather states.
   */
  private tickBgmPhrase(): void {
    if (
      this.currentWeather === 'idle' ||
      !editorPreferences.weatherSystemEnabled.value ||
      !editorPreferences.weatherBgmEnabled.value
    ) {
      return
    }
    const ctx = this.ensureContext()
    if (!ctx || !this.bgmBus) return

    const now = ctx.currentTime
    const step = this.bgmStep++

    // Harmony palettes (in Hz) per weather mood
    const palettes: Record<Exclude<WeatherKind, 'idle'>, number[][]> = {
      wind: [
        [293.66, 440.0, 523.25, 659.25], // Dm9 Dorian breeze
        [349.23, 523.25, 659.25, 783.99], // Fmaj7
        [261.63, 392.0, 493.88, 587.33], // Cmaj9
        [220.0, 329.63, 440.0, 523.25] // Am7
      ],
      rain: [
        [220.0, 329.63, 392.0, 493.88], // Am9 droplets
        [174.61, 261.63, 329.63, 392.0], // Fmaj7
        [196.0, 293.66, 392.0, 493.88], // G6
        [164.81, 246.94, 329.63, 392.0] // Em7
      ],
      thunderstorm: [
        [146.83, 220.0, 293.66, 349.23], // Dm tension
        [116.54, 174.61, 233.08, 293.66], // Bbmaj7
        [130.81, 196.0, 261.63, 311.13], // Cm7
        [110.0, 164.81, 220.0, 277.18] // Asus4/A
      ],
      typhoon: [
        [130.81, 196.0, 246.94, 311.13], // Cm(maj7) vortex
        [103.83, 155.56, 207.65, 261.63], // Abmaj7
        [116.54, 174.61, 220.0, 293.66], // Bb6
        [98.0, 146.83, 196.0, 246.94] // G7sus4
      ],
      blizzard: [
        [246.94, 369.99, 440.0, 554.37], // Bm9 crystalline winter
        [196.0, 293.66, 369.99, 493.88], // Gmaj7#11
        [220.0, 329.63, 415.3, 493.88], // Amaj9
        [185.0, 277.18, 369.99, 440.0] // F#m7
      ],
      hail: [
        [164.81, 246.94, 329.63, 369.99], // Em(add9) staccato ice
        [196.0, 293.66, 392.0, 466.16], // Gm
        [146.83, 220.0, 293.66, 369.99], // D
        [130.81, 196.0, 261.63, 329.63] // Cmaj7
      ],
      sandstorm: [
        [146.83, 185.0, 220.0, 261.63], // D Phrygian Dominant desert mirage
        [155.56, 196.0, 233.08, 293.66], // Ebmaj7
        [130.81, 164.81, 196.0, 246.94], // Cmaj7
        [146.83, 220.0, 277.18, 329.63] // D6
      ],
      meteor: [
        [261.63, 392.0, 493.88, 739.99], // Cmaj7#11 starry cosmos
        [293.66, 440.0, 554.37, 830.61], // Dmaj9
        [233.08, 349.23, 440.0, 659.25], // Bbmaj7#11
        [196.0, 293.66, 369.99, 587.33] // Gmaj9
      ],
      aurora: [
        [174.61, 261.63, 349.23, 440.0, 523.25], // Fmaj9 Nordic lights
        [196.0, 293.66, 392.0, 493.88, 587.33], // G6/9
        [220.0, 329.63, 440.0, 523.25, 659.25], // Am9
        [130.81, 196.0, 293.66, 329.63, 493.88] // Cmaj9
      ],
      fog: [
        [164.81, 246.94, 311.13, 392.0], // Em(maj7) mist
        [146.83, 207.65, 261.63, 329.63], // Whole-tone impressionist veil
        [130.81, 196.0, 246.94, 329.63], // Cmaj7
        [123.47, 185.0, 246.94, 311.13] // B7sus4
      ],
      sunny: [
        [261.63, 392.0, 493.88, 587.33, 659.25], // Cmaj9 warm glow
        [293.66, 440.0, 554.37, 659.25, 783.99], // D6/9 Lydian lift
        [349.23, 523.25, 659.25, 783.99, 987.77], // Fmaj9
        [392.0, 587.33, 783.99, 987.77, 1174.66] // G6/9
      ]
    }

    const chordList = palettes[this.currentWeather]
    if (!chordList) return
    const chord = chordList[step % chordList.length]

    // 1. Warm ambient pad swell on every 2nd step
    if (step % 2 === 0) {
      chord.slice(0, 3).forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        osc.type =
          this.currentWeather === 'typhoon' || this.currentWeather === 'sandstorm'
            ? 'sawtooth'
            : this.currentWeather === 'aurora' || this.currentWeather === 'meteor'
              ? 'sine'
              : 'triangle'
        osc.frequency.setValueAtTime(freq, now)
        osc.detune.setValueAtTime((idx - 1) * 6, now)

        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.setValueAtTime(
          this.currentWeather === 'sunny' || this.currentWeather === 'aurora' ? 1400 : 720,
          now
        )

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.linearRampToValueAtTime(0.065, now + 0.85)
        gain.gain.exponentialRampToValueAtTime(0.0004, now + 3.4)

        osc.connect(filter)
        filter.connect(gain)
        gain.connect(this.bgmBus!)

        osc.start(now)
        osc.stop(now + 3.5)
      })
    }

    // 2. Arpeggiated ambient melody droplet
    const arpFreq = chord[(step * 2 + Math.floor(Math.random() * chord.length)) % chord.length] * 2
    const arpOsc = ctx.createOscillator()
    arpOsc.type = this.currentWeather === 'hail' ? 'triangle' : 'sine'
    arpOsc.frequency.setValueAtTime(arpFreq, now + 0.25)

    const arpGain = ctx.createGain()
    arpGain.gain.setValueAtTime(0.0001, now + 0.25)
    arpGain.gain.linearRampToValueAtTime(0.045, now + 0.3)
    arpGain.gain.exponentialRampToValueAtTime(
      0.0004,
      now + (this.currentWeather === 'hail' ? 0.85 : 1.65)
    )

    arpOsc.connect(arpGain)
    arpGain.connect(this.bgmBus)
    arpOsc.start(now + 0.25)
    arpOsc.stop(now + 1.7)
  }

  public dispose(): void {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer)
      this.bgmTimer = null
    }
    this.fadeToIdle()
  }
}

export const canvasWeatherAudio = new CanvasWeatherAudioEngine()
