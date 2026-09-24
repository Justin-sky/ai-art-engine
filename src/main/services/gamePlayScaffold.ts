/**
 * 可玩 HTML 脚手架：对齐 pelican-bike 结构（纯 Node + esbuild，无 React/Vite）。
 * 布局：package.json / build.mjs / index.template.html / src/*.js
 * 仅主进程使用。
 * @see https://github.com/riba2534/claude-opus-5-5-demo/tree/main/pelican-bike
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export function writeNodeGamePlayScaffold(
  projectDir: string,
  preferredMode: '2d' | '3d' | 'auto'
): void {
  mkdirSync(join(projectDir, 'src'), { recursive: true })

  const is3d = preferredMode === '3d'
  const deps: Record<string, string> = {
    esbuild: '^0.25.0'
  }
  if (is3d) deps.three = '^0.185.0'

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'aiart-gameplay',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          build: 'node build.mjs'
        },
        dependencies: deps
      },
      null,
      2
    ) + '\n',
    'utf8'
  )

  writeFileSync(join(projectDir, 'build.mjs'), BUILD_MJS, 'utf8')

  const modeComment = is3d ? '3d' : '2d'
  writeFileSync(
    join(projectDir, 'index.template.html'),
    `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <!-- game-mode: ${modeComment} -->
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
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
/*APP_JS*/
    </script>
  </body>
</html>
`,
    'utf8'
  )

  writeFileSync(join(projectDir, 'src', 'main.js'), is3d ? SAMPLE_MAIN_3D : SAMPLE_MAIN_2D, 'utf8')
}

/** @deprecated 使用 writeNodeGamePlayScaffold */
export const writeViteReactScaffold = writeNodeGamePlayScaffold

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

const SAMPLE_MAIN_2D = `/** Seed 2D sample — dsh agent should replace / extend under src/. */
const root = document.getElementById('app')
const canvas = document.createElement('canvas')
root.appendChild(canvas)
const ctx = canvas.getContext('2d')

let x = 40
let y = 40
let vx = 2
let vy = 1.5
let score = 0
const keys = new Set()

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') {
    x = 40
    y = 40
    score = 0
  }
  keys.add(e.key)
})
window.addEventListener('keyup', (e) => keys.delete(e.key))

function loop() {
  const w = (canvas.width = canvas.clientWidth)
  const h = (canvas.height = canvas.clientHeight)
  if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) x -= 3
  if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) x += 3
  if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) y -= 3
  if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) y += 3
  x += vx
  y += vy
  if (x < 12 || x > w - 12) {
    vx *= -1
    score += 1
  }
  if (y < 12 || y > h - 12) {
    vy *= -1
    score += 1
  }
  x = Math.max(12, Math.min(w - 12, x))
  y = Math.max(12, Math.min(h - 12, y))
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#6cf'
  ctx.beginPath()
  ctx.arc(x, y, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = '16px sans-serif'
  ctx.fillText('score ' + score + ' · WASD/arrows · R reset', 12, 24)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
`

const SAMPLE_MAIN_3D = `import * as THREE from 'three'

/** Seed 3D sample — dsh agent should replace / extend under src/. */
const root = document.getElementById('app')
const canvas = document.createElement('canvas')
root.appendChild(canvas)

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111111)
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 1.2, 4)
const light = new THREE.DirectionalLight(0xffffff, 1.2)
light.position.set(2, 4, 3)
scene.add(light)
scene.add(new THREE.AmbientLight(0xffffff, 0.35))
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x66ccff })
)
scene.add(mesh)

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') mesh.rotation.set(0, 0, 0)
})

function loop() {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(1, h)
  camera.updateProjectionMatrix()
  mesh.rotation.x += 0.01
  mesh.rotation.y += 0.015
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
`
