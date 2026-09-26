/**
 * 可玩 HTML 脚手架：对齐 pelican-bike 结构（纯 Node + esbuild，无 React/Vite）。
 * 布局：package.json / build.mjs / index.template.html / src/core/* / src/assets/* / src/main.js
 * 仅主进程使用。
 * @see https://github.com/riba2534/claude-opus-5-5-demo/tree/main/pelican-bike
 *
 * 资产层约定（v2）：程序化资产生成是这条路线的核心——几何用 BufferGeometry 造、
 * 贴图用 Canvas 2D 画、音效用 WebAudio 合成、关卡由种子推导，全部可复现。
 * `src/core/*` 一律**不 import three**（2D 工程没有 three 依赖），three 由 ctx 注入。
 */
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

type ScaffoldFile = { path: string; content: string }

function writeFiles(projectDir: string, files: ScaffoldFile[]): void {
  for (const file of files) {
    const abs = join(projectDir, ...file.path.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, file.content, 'utf8')
  }
}

export function writeNodeGamePlayScaffold(
  projectDir: string,
  preferredMode: '2d' | '3d' | 'auto'
): void {
  const is3d = preferredMode === '3d'
  const deps: Record<string, string> = { esbuild: '^0.25.0' }
  if (is3d) deps.three = '^0.185.0'

  const files: ScaffoldFile[] = [
    {
      path: 'package.json',
      content:
        JSON.stringify(
          {
            name: 'aiart-gameplay',
            private: true,
            version: '0.0.0',
            type: 'module',
            scripts: { build: 'node build.mjs' },
            dependencies: deps
          },
          null,
          2
        ) + '\n'
    },
    { path: 'build.mjs', content: BUILD_MJS },
    { path: 'index.template.html', content: indexTemplate(is3d ? '3d' : '2d') },
    { path: 'src/core/rng.js', content: CORE_RNG },
    { path: 'src/core/palette.js', content: CORE_PALETTE },
    { path: 'src/core/registry.js', content: CORE_REGISTRY },
    { path: 'src/assets/texture/panel.js', content: ASSET_TEXTURE_PANEL },
    { path: 'src/assets/audio/sfx.js', content: ASSET_AUDIO_SFX },
    { path: 'src/assets/geometry/crystal.js', content: ASSET_GEOMETRY_CRYSTAL },
    { path: 'src/assets/material/metal.js', content: ASSET_MATERIAL_METAL },
    { path: 'src/assets/level/ring.js', content: ASSET_LEVEL_RING },
    { path: 'src/main.js', content: is3d ? SAMPLE_MAIN_3D : SAMPLE_MAIN_2D }
  ]
  // 2D 工程不带 three 依赖：删掉只服务 3D 的资产模块，避免留下无法构建的 import
  const kept = is3d
    ? files
    : files.filter((file) => !/assets\/(geometry|material|level)\//.test(file.path))
  writeFiles(projectDir, kept)
}

/** @deprecated 使用 writeNodeGamePlayScaffold */
export const writeViteReactScaffold = writeNodeGamePlayScaffold

function indexTemplate(mode: '2d' | '3d'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <!-- game-mode: ${mode} -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Playable Game</title>
    <style>
      html, body, #app {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #111;
      }
      #app, #app canvas {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      #hud {
        position: fixed;
        left: 12px;
        top: 10px;
        color: #fff;
        font: 14px/1.4 system-ui, sans-serif;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="hud"></div>
    <script>
/*APP_JS*/
    </script>
  </body>
</html>
`
}

const BUILD_MJS = `import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const minify = !process.argv.includes('--dev')
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify,
  write: false,
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'warning'
})
const js = res.outputFiles[0].text.replace(/<\\/script/gi, '<\\/script')
let html = readFileSync('index.template.html', 'utf8')
html = html.replace('/*APP_JS*/', () => js)
mkdirSync('dist', { recursive: true })
writeFileSync('dist/index.html', html)
console.log(\`dist/index.html \${(html.length / 1024).toFixed(1)} KB (js \${(js.length / 1024).toFixed(1)} KB)\`)
`

const CORE_RNG = `/**
 * 种子随机：同一个种子 → 同一批资产；改一个字符即整批换风格。
 * 所有程序化资产都必须走这里的 rng，禁止 Math.random（否则不可复现）。
 */
export function hashSeed(text) {
  let h = 2166136261 >>> 0
  const s = String(text == null ? '' : text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function createRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** rng 常用包装：range / int / pick / sign / jitter / weighted */
export function rngHelpers(rng) {
  return {
    next: rng,
    range: (min, max) => min + rng() * (max - min),
    int: (min, max) => Math.floor(min + rng() * (max - min + 1)),
    pick: (list) => list[Math.floor(rng() * list.length)],
    sign: () => (rng() < 0.5 ? -1 : 1),
    jitter: (value, amount) => value + (rng() * 2 - 1) * amount,
    weighted: (entries) => {
      let total = 0
      for (const entry of entries) total += entry.weight
      let roll = rng() * total
      for (const entry of entries) {
        roll -= entry.weight
        if (roll <= 0) return entry.value
      }
      return entries.length ? entries[entries.length - 1].value : undefined
    }
  }
}

/** 关卡种子：URL ?seed=xxx 优先，其次 window.__GAME_SEED__，最后默认值 */
export function createGameSeed(fallback) {
  try {
    const fromUrl = new URLSearchParams(location.search).get('seed')
    if (fromUrl && fromUrl.trim()) return fromUrl.trim()
  } catch (error) {
    /* ignore */
  }
  const injected = typeof window !== 'undefined' ? window.__GAME_SEED__ : ''
  if (typeof injected === 'string' && injected.trim()) return injected.trim()
  return fallback || 'seed-1'
}
`

const CORE_PALETTE = `import { rngHelpers } from './rng.js'

/** HSL → #rrggbb，供 Canvas 填充与 three 材质共用 */
export function hsl(h, s, l) {
  const sat = Math.max(0, Math.min(1, s / 100))
  const lig = Math.max(0, Math.min(1, l / 100))
  const k = (n) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n) => {
    const value = lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

/**
 * 一套自洽配色：同一 rng 派生基准色相与配色方案，
 * 所有资产（贴图 / 材质 / 灯光 / UI）都从这里取色，风格不会花。
 */
export function createPalette(rng, options) {
  const opts = options || {}
  const r = rngHelpers(rng)
  const baseHue = typeof opts.baseHue === 'number' ? opts.baseHue : r.range(0, 360)
  const scheme = opts.scheme || r.pick(['analogous', 'complement', 'triad'])
  const shift = scheme === 'complement' ? 180 : scheme === 'triad' ? 120 : 28
  const accentHue = (baseHue + shift) % 360
  const secondHue = (baseHue + shift * 2) % 360
  const saturation = typeof opts.saturation === 'number' ? opts.saturation : r.range(38, 62)
  const base = hsl(baseHue, saturation, 52)
  const accent = hsl(accentHue, Math.min(90, saturation + 18), 58)
  const second = hsl(secondHue, saturation, 46)
  return {
    scheme,
    baseHue,
    base,
    accent,
    second,
    dark: hsl(baseHue, saturation * 0.7, 16),
    mid: hsl(baseHue, saturation * 0.8, 34),
    light: hsl(baseHue, saturation * 0.5, 82),
    sky: hsl((baseHue + 200) % 360, saturation * 0.6, 24),
    list: [base, accent, second, hsl(baseHue, saturation * 0.5, 70)],
    /** 同色系明度阶梯，用于面板 / 条纹等重复元素 */
    shades: (count) => {
      const out = []
      for (let i = 0; i < count; i += 1) {
        out.push(hsl(baseHue, saturation, 24 + (56 * i) / Math.max(1, count - 1)))
      }
      return out
    }
  }
}
`

const CORE_REGISTRY = `/**
 * 资产注册表：每个程序化资产都用 defineAsset 声明，玩法侧只按 id 取。
 *
 * 约定：
 * - id 形如 <kind>_<slug>（如 texture_panel / geometry_crystal），全局唯一；
 * - build(ctx) 返回该资产的产物（BufferGeometry / 材质 / HTMLCanvasElement / 音效对象 / 布局数据）；
 * - ctx 由调用方统一提供：{ seed, rng, palette, THREE }；
 * - core/* 不得 import three（2D 工程没有 three 依赖），需要 three 的资产模块自己 import。
 */
const assets = new Map()

export function defineAsset(spec) {
  if (!spec || !spec.id) throw new Error('defineAsset: id is required')
  if (typeof spec.build !== 'function') throw new Error('defineAsset: build() is required')
  if (assets.has(spec.id)) throw new Error('defineAsset: duplicate id ' + spec.id)
  assets.set(spec.id, {
    id: spec.id,
    kind: spec.kind || 'misc',
    note: spec.note || '',
    build: spec.build
  })
  return spec.id
}

export function listAssets() {
  return Array.from(assets.values())
}

export function assetIds() {
  return Array.from(assets.keys())
}

export function getAsset(id) {
  return assets.get(id)
}

/** 按 id 构建资产；未知 id / 构建失败都直接抛错，方便宿主与门禁看到原因 */
export function buildAsset(id, ctx) {
  const spec = assets.get(id)
  if (!spec) throw new Error('unknown asset: ' + id)
  return spec.build(ctx)
}
`

const ASSET_TEXTURE_PANEL = `import { rngHelpers } from '../../core/rng.js'
import { hsl } from '../../core/palette.js'

/**
 * 程序化贴图：Canvas 2D 画好直接当 three.CanvasTexture 用（不依赖 three，2D / 3D 通用）。
 * 返回 HTMLCanvasElement，调用方自己 \`new THREE.CanvasTexture(canvas)\`。
 */
export function build(ctx) {
  const size = ctx.size || 256
  const r = rngHelpers(ctx.rng)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  const hue = (ctx.palette.baseHue + r.range(-14, 14) + 360) % 360
  g.fillStyle = hsl(hue, 26, 62)
  g.fillRect(0, 0, size, size)

  // 横向板缝 + 细噪点：低多边形风格里最省事又不塑料的配方
  const rows = r.int(4, 7)
  const rowH = size / rows
  for (let i = 0; i < rows; i += 1) {
    g.fillStyle = hsl(hue, 24, 46 + r.range(-6, 10))
    g.fillRect(0, i * rowH, size, Math.max(1, rowH * 0.08))
    g.fillStyle = hsl(hue, 30, 34 + r.range(-4, 8))
    g.fillRect(0, i * rowH + rowH * 0.12, size, Math.max(1, rowH * 0.04))
  }
  for (let i = 0; i < size * 6; i += 1) {
    g.fillStyle = 'rgba(255,255,255,' + (r.range(0.02, 0.09)).toFixed(3) + ')'
    g.fillRect(r.int(0, size - 1), r.int(0, size - 1), 1, 1)
  }
  return canvas
}
`

const ASSET_AUDIO_SFX = `/**
 * 程序化音效：WebAudio 合成，零素材、同种子同音色。
 * 返回 { play(ctx, when) }，玩法侧首次用户输入后再 resume AudioContext（浏览器策略）。
 */
export function createSfxBank(options) {
  const opts = options || {}
  const baseFreq = opts.baseFreq || 440
  const volume = opts.volume == null ? 0.18 : opts.volume
  // 本地线性同余：噪声也要可复现（禁止 Math.random，同种子必须同音色）
  let noiseState = (opts.noiseSeed == null ? 1 : opts.noiseSeed) >>> 0
  const nextNoise = () => {
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0
    return (noiseState / 4294967296) * 2 - 1
  }

  function tone(ctx, config) {
    const t0 = (config.when || ctx.currentTime) + 0.001
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = config.type || 'triangle'
    osc.frequency.setValueAtTime(config.from, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, config.to), t0 + config.duration)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(config.volume == null ? volume : config.volume, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + config.duration)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + config.duration + 0.02)
  }

  /** 噪声脉冲：脚步 / 撞击这类不需要音高的声音 */
  function noise(ctx, config) {
    const duration = config.duration || 0.14
    const frames = Math.floor(ctx.sampleRate * duration)
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i += 1) {
      data[i] = nextNoise() * (1 - i / frames)
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = config.filter || 'lowpass'
    filter.frequency.value = config.cutoff || 900
    const gain = ctx.createGain()
    gain.gain.value = config.volume == null ? volume : config.volume
    src.connect(filter).connect(gain).connect(ctx.destination)
    src.start((config.when || ctx.currentTime) + 0.001)
  }

  return {
    /** 拾取 / 得分：向上两声 */
    pickup: (ctx) => {
      tone(ctx, { from: baseFreq * 1.5, to: baseFreq * 2.4, duration: 0.12 })
      tone(ctx, {
        from: baseFreq * 2.4,
        to: baseFreq * 3.2,
        duration: 0.1,
        when: ctx.currentTime + 0.09,
        type: 'sine'
      })
    },
    /** 受伤 / 失败：向下滑 + 一点噪声 */
    hurt: (ctx) => {
      tone(ctx, { from: baseFreq * 0.9, to: baseFreq * 0.35, duration: 0.3, type: 'sawtooth' })
      noise(ctx, { duration: 0.18, cutoff: 600 })
    },
    /** 胜利：三音琶音 */
    win: (ctx) => {
      const steps = [1, 1.26, 1.5, 2]
      steps.forEach((ratio, i) => {
        tone(ctx, {
          from: baseFreq * ratio,
          to: baseFreq * ratio * 1.01,
          duration: 0.18,
          when: ctx.currentTime + i * 0.12,
          type: 'triangle'
        })
      })
    },
    /** 脚步 / 落地 */
    step: (ctx) => noise(ctx, { duration: 0.1, cutoff: 420, volume: volume * 0.7 })
  }
}
`

const ASSET_GEOMETRY_CRYSTAL = `import * as THREE from 'three'
import { rngHelpers } from '../../core/rng.js'

/**
 * 程序化几何：正二十面体做径向抖动 → 晶体感（比 Box 多几分辨识度，成本还是常数级）。
 * 返回 BufferGeometry，材质与实例化由调用方决定。
 */
export function build(ctx) {
  const r = rngHelpers(ctx.rng)
  const geometry = new THREE.IcosahedronGeometry(ctx.size || 0.5, ctx.detail == null ? 1 : ctx.detail)
  const position = geometry.getAttribute('position')
  const vector = new THREE.Vector3()
  for (let i = 0; i < position.count; i += 1) {
    vector.fromBufferAttribute(position, i)
    vector.multiplyScalar(r.range(0.72, 1.28))
    vector.y *= r.range(1.05, 1.5)
    position.setXYZ(i, vector.x, vector.y, vector.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}
`

const ASSET_MATERIAL_METAL = `import * as THREE from 'three'
import { build as buildPanelTexture } from '../texture/panel.js'
import { hsl } from '../../core/palette.js'

/** 程序化材质：把 Canvas 贴图包成标准材质（GLTF / 导出友好，不用自定义 shader） */
export function build(ctx) {
  const canvas = ctx.canvas || buildPanelTexture(ctx)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(ctx.repeat || 1, ctx.repeat || 1)
  texture.colorSpace = THREE.SRGBColorSpace
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: ctx.color || 0xffffff,
    roughness: ctx.roughness == null ? 0.62 : ctx.roughness,
    metalness: ctx.metalness == null ? 0.18 : ctx.metalness,
    emissive: new THREE.Color(ctx.emissive || hsl((ctx.palette.baseHue + 180) % 360, 70, 52)),
    emissiveIntensity: ctx.emissiveIntensity == null ? 0.35 : ctx.emissiveIntensity
  })
}
`

const ASSET_LEVEL_RING = `import { rngHelpers } from '../../core/rng.js'

/**
 * 程序化关卡：环形走廊上摆一圈拾取物，位置 / 缩放 / 自转全由种子推导。
 * 返回纯数据（不依赖 three），玩法侧自己组装 InstancedMesh 或普通 Mesh。
 */
export function build(ctx) {
  const r = rngHelpers(ctx.rng)
  const count = ctx.count || 10
  const radius = ctx.radius || 7
  const items = []
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + r.range(-0.12, 0.12)
    const dist = radius + r.range(-0.6, 0.6)
    items.push({
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      y: r.range(0.45, 1.05),
      scale: r.range(0.7, 1.35),
      spin: r.range(0.4, 1.4) * r.sign(),
      hueShift: r.range(-20, 20)
    })
  }
  return { radius, count, items }
}
`

const SAMPLE_MAIN_2D = `import { createGameSeed, createRng, rngHelpers } from './core/rng.js'
import { createPalette } from './core/palette.js'
import { defineAsset, buildAsset, listAssets } from './core/registry.js'
import { build as buildPanel } from './assets/texture/panel.js'
import { createSfxBank } from './assets/audio/sfx.js'

/** Seed 2D sample — dsh agent should replace / extend under src/. */
const seed = createGameSeed()
const rng = createRng(seed)
const rand = rngHelpers(rng)
const palette = createPalette(rng)
const sfx = createSfxBank({ baseFreq: rand.range(360, 520), noiseSeed: rand.int(1, 1000000000) })

defineAsset({ id: 'texture_panel', kind: 'texture', build: (ctx) => buildPanel(ctx) })

const root = document.getElementById('app')
const hud = document.getElementById('hud')
const canvas = document.createElement('canvas')
root.appendChild(canvas)
const ctx = canvas.getContext('2d')

const panel = buildAsset('texture_panel', { rng, palette, size: 256 })
const pattern = ctx.createPattern(panel, 'repeat')

let audio = null
const ensureAudio = () => {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()
  if (audio.state === 'suspended') audio.resume()
  return audio
}

let player = { x: 60, y: 60 }
let velocity = { x: 2.2, y: 1.6 }
let score = 0
let target = { x: rand.range(80, 420), y: rand.range(80, 300) }
const keys = new Set()

window.addEventListener('keydown', (event) => {
  ensureAudio()
  if (event.key === 'r' || event.key === 'R') reset()
  keys.add(event.key)
})
window.addEventListener('keyup', (event) => keys.delete(event.key))

function reset() {
  player = { x: 60, y: 60 }
  score = 0
  target = { x: rand.range(80, 420), y: rand.range(80, 300) }
}

function loop() {
  const w = (canvas.width = canvas.clientWidth)
  const h = (canvas.height = canvas.clientHeight)
  if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) player.x -= 3
  if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) player.x += 3
  if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) player.y -= 3
  if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) player.y += 3
  player.x += velocity.x
  player.y += velocity.y
  if (player.x < 12 || player.x > w - 12) velocity.x *= -1
  if (player.y < 12 || player.y > h - 12) velocity.y *= -1
  player.x = Math.max(12, Math.min(w - 12, player.x))
  player.y = Math.max(12, Math.min(h - 12, player.y))

  if (Math.hypot(player.x - target.x, player.y - target.y) < 22) {
    score += 1
    if (audio) sfx.pickup(audio)
    target = { x: rand.range(40, Math.max(80, w - 40)), y: rand.range(40, Math.max(80, h - 40)) }
  }

  ctx.fillStyle = palette.dark
  ctx.fillRect(0, 0, w, h)
  ctx.globalAlpha = 0.18
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, w, h)
  ctx.globalAlpha = 1

  ctx.fillStyle = palette.accent
  ctx.beginPath()
  ctx.arc(target.x, target.y, 14, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = palette.base
  ctx.beginPath()
  ctx.arc(player.x, player.y, 12, 0, Math.PI * 2)
  ctx.fill()

  if (hud) {
    hud.textContent =
      'seed ' + seed + ' · score ' + score + ' · WASD/arrows · R reset · assets ' + listAssets().length
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
`

const SAMPLE_MAIN_3D = `import * as THREE from 'three'
import { createGameSeed, createRng, rngHelpers } from './core/rng.js'
import { createPalette } from './core/palette.js'
import { defineAsset, buildAsset, listAssets } from './core/registry.js'
import { build as buildCrystal } from './assets/geometry/crystal.js'
import { build as buildMetal } from './assets/material/metal.js'
import { build as buildRing } from './assets/level/ring.js'
import { createSfxBank } from './assets/audio/sfx.js'

/** Seed 3D sample — dsh agent should replace / extend under src/. */
const seed = createGameSeed()
const rng = createRng(seed)
const rand = rngHelpers(rng)
const palette = createPalette(rng)
const sfx = createSfxBank({ baseFreq: rand.range(320, 460), noiseSeed: rand.int(1, 1000000000) })

defineAsset({ id: 'geometry_crystal', kind: 'geometry', build: (ctx) => buildCrystal(ctx) })
defineAsset({ id: 'material_metal', kind: 'material', build: (ctx) => buildMetal(ctx) })
defineAsset({ id: 'level_ring', kind: 'level', build: (ctx) => buildRing(ctx) })

const root = document.getElementById('app')
const hud = document.getElementById('hud')
const canvas = document.createElement('canvas')
root.appendChild(canvas)

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
const scene = new THREE.Scene()
scene.background = new THREE.Color(palette.sky)
scene.fog = new THREE.Fog(palette.sky, 12, 34)

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120)
const keyLight = new THREE.DirectionalLight(0xffffff, 1.25)
keyLight.position.set(4, 7, 5)
scene.add(keyLight)
scene.add(new THREE.AmbientLight(palette.light, 0.45))
const rimLight = new THREE.PointLight(palette.accent, 12, 26)
rimLight.position.set(-6, 4, -6)
scene.add(rimLight)

const floorMaterial = buildAsset('material_metal', {
  rng,
  palette,
  repeat: 6,
  roughness: 0.85,
  metalness: 0.05,
  emissiveIntensity: 0.05
})
const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), floorMaterial)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

const level = buildAsset('level_ring', { rng, palette, count: 10, radius: 7 })
const crystalGeometry = buildAsset('geometry_crystal', { rng, palette, size: 0.42, detail: 1 })
const crystalMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(palette.accent),
  emissive: new THREE.Color(palette.accent),
  emissiveIntensity: 0.7,
  roughness: 0.35,
  metalness: 0.1
})
const pickups = level.items.map((item) => {
  const mesh = new THREE.Mesh(crystalGeometry, crystalMaterial)
  mesh.position.set(item.x, item.y, item.z)
  mesh.scale.setScalar(item.scale)
  mesh.userData.spin = item.spin
  mesh.userData.taken = false
  scene.add(mesh)
  return mesh
})

const player = new THREE.Mesh(
  THREE.CapsuleGeometry
    ? new THREE.CapsuleGeometry(0.3, 0.7, 4, 12)
    : new THREE.BoxGeometry(0.6, 1.1, 0.6),
  new THREE.MeshStandardMaterial({ color: palette.base, roughness: 0.5, metalness: 0.2 })
)
player.position.set(0, 0.6, 0)
scene.add(player)

let score = 0
let heading = 0
let hurt = 0
let audio = null
const keys = new Set()

function ensureAudio() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()
  if (audio.state === 'suspended') audio.resume()
  return audio
}

function reset() {
  score = 0
  hurt = 0
  player.position.set(0, 0.6, 0)
  heading = 0
  for (const item of pickups) {
    item.visible = true
    item.userData.taken = false
  }
}

window.addEventListener('keydown', (event) => {
  ensureAudio()
  if (event.key === 'r' || event.key === 'R') reset()
  keys.add(event.key)
})
window.addEventListener('keyup', (event) => keys.delete(event.key))
canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect()
  heading = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2.4
})

camera.position.set(0, 6.4, 11)

function loop() {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(1, h)
  camera.updateProjectionMatrix()

  const forward =
    (keys.has('ArrowUp') || keys.has('w') || keys.has('W') ? 1 : 0) -
    (keys.has('ArrowDown') || keys.has('s') || keys.has('S') ? 1 : 0)
  const strafe =
    (keys.has('ArrowRight') || keys.has('d') || keys.has('D') ? 1 : 0) -
    (keys.has('ArrowLeft') || keys.has('a') || keys.has('A') ? 1 : 0)
  const speed = 0.085
  player.position.x += (strafe * Math.cos(heading) + forward * Math.sin(heading)) * speed
  player.position.z += (forward * Math.cos(heading) - strafe * Math.sin(heading)) * speed
  player.position.x = Math.max(-15, Math.min(15, player.position.x))
  player.position.z = Math.max(-15, Math.min(15, player.position.z))
  player.rotation.y = heading

  for (const item of pickups) {
    if (item.userData.taken) continue
    item.rotation.y += item.userData.spin * 0.02
    item.position.y += Math.sin(performance.now() * 0.002 + item.position.x) * 0.002
    if (item.position.distanceTo(player.position) < 1.05) {
      item.userData.taken = true
      item.visible = false
      score += 1
      if (audio) sfx.pickup(audio)
      if (score >= pickups.length && audio) sfx.win(audio)
    }
  }

  if (player.position.length() > 15.5 && hurt <= 0) {
    hurt = 1
    if (audio) sfx.hurt(audio)
  }
  hurt = Math.max(0, hurt - 0.01)

  camera.position.x += (player.position.x - camera.position.x) * 0.08
  camera.position.z += (player.position.z + 11 - camera.position.z) * 0.08
  camera.lookAt(player.position.x, player.position.y + 0.4, player.position.z)

  if (hud) {
    hud.textContent =
      'seed ' + seed + ' · score ' + score + '/' + pickups.length + ' · WASD + 鼠标转向 · R reset · assets ' + listAssets().length
  }
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
`
