// 泼溅体检：headless Electron 里把一份 .spz / .ply **真渲染出来**并量出数据。
//
// 为什么要这个：泼溅在应用里出不来时，「文件本身坏了」和「应用接入坏了」从界面上一模一样
// （都是一片空白）。这个脚本用与应用同一套 Spark + 同一套取景逻辑跑一遍，输出
// numSplats / 包围盒 / 构图相机参数 / 非背景像素占比，并落一张 PNG —— 两者一次就能分辨。
//
// 用法（工程根目录）：
//   node scripts/splat-inspect/run.mjs "<泼溅文件绝对路径>" [输出目录]
// 产物：<输出目录>/splat-inspect.png 与 splat-inspect.log.json（默认输出到系统临时目录）
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(here, '..', '..')

function fail(message) {
  console.error(message)
  process.exit(2)
}

const input = process.argv[2]
if (!input) fail('用法: node scripts/splat-inspect/run.mjs "<泼溅文件绝对路径>" [输出目录]')
const splatPath = resolve(input)
if (!existsSync(splatPath)) fail(`找不到文件: ${splatPath}`)

const outDir = process.argv[3] ? resolve(process.argv[3]) : tmpdir()
mkdirSync(outDir, { recursive: true })

const electronBinary = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
const electronPosix = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron')
const electron = existsSync(electronBinary) ? electronBinary : electronPosix
if (!existsSync(electron)) fail(`找不到 Electron: ${electron}`)

const threeUrl = new URL(
  `file:///${join(projectRoot, 'node_modules/three/build/three.module.js').replace(/\\/g, '/')}`
)
const threeAddonsUrl = new URL(
  `file:///${join(projectRoot, 'node_modules/three/examples/jsm/').replace(/\\/g, '/')}`
)
const sparkUrl = new URL(
  `file:///${join(projectRoot, 'node_modules/@sparkjsdev/spark/dist/spark.module.js').replace(/\\/g, '/')}`
)

// 页面与其中的文件都在输出目录里生成，避免污染仓库
const pageHtml = readFileSync(join(here, 'page.html'), 'utf8')
  .replace('__THREE_URL__', threeUrl.href)
  .replace('__THREE_ADDONS_URL__', threeAddonsUrl.href + '/')
  .replace('__SPARK_URL__', sparkUrl.href)
writeFileSync(join(outDir, 'splat-inspect.html'), pageHtml)
const splatName = `splat${extname(splatPath).toLowerCase() || '.spz'}`
copyFileSync(splatPath, join(outDir, 'splat.bin'))
writeFileSync(join(outDir, 'splat-name.txt'), splatName)

/**
 * 要试的配置变体。默认只跑「原样」，加 `--variants` 会逐个试：
 * 用来定位「什么配置下泼溅才会真的累加进渲染」（Spark 的 LOD / 排序 / 累加器各有开关）。
 */
const variants = process.argv.includes('--variants')
  ? [
      { name: 'default' },
      { name: 'renderer.lod-off', rendererOptions: { enableLod: false } },
      { name: 'mesh.nonLod', meshOptions: { nonLod: true } },
      {
        name: 'renderer.lod-off+mesh.nonLod',
        rendererOptions: { enableLod: false },
        meshOptions: { nonLod: true }
      },
      { name: 'explicit-update', explicitUpdate: true },
      {
        name: 'explicit-update+lod-off',
        explicitUpdate: true,
        rendererOptions: { enableLod: false }
      },
      { name: 'renderer.autoUpdate-off', rendererOptions: { autoUpdate: false } },
      { name: 'renderer.preUpdate-off', rendererOptions: { preUpdate: false } },
      { name: 'renderer.sortRadial-off', rendererOptions: { sortRadial: false } }
    ]
  : [{ name: 'default' }]
writeFileSync(join(outDir, 'variants.json'), JSON.stringify(variants))

const mainSource = `
const { app, BrowserWindow } = require('electron')
const { writeFileSync, readFileSync } = require('fs')
const { join } = require('path')
// 数据目录（页面 / splat.bin / 产物）由 run.mjs 通过环境变量给出；
// main.cjs 必须留在仓库里，才能 require 到 node_modules 里的 electron
const dir = process.env.SPLAT_INSPECT_DIR
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 760,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true }
  })
  win.webContents.on('console-message', (event) => {
    console.log('[page] ' + event.message)
  })
  await win.loadFile(join(dir, 'splat-inspect.html'))
  await win.webContents.executeJavaScript(
    'window.__splatName = ' + JSON.stringify(readFileSync(join(dir, 'splat-name.txt'), 'utf8')) + '; true'
  )
  await win.webContents.executeJavaScript(
    'window.__variants = ' + readFileSync(join(dir, 'variants.json'), 'utf8') + '; true'
  )
  const deadline = Date.now() + 240000
  let probe = null
  while (Date.now() < deadline) {
    probe = await win.webContents.executeJavaScript('window.__probe ?? null')
    if (probe && (probe.ok || probe.logs.some((line) => line.startsWith('ERR')))) break
    await new Promise((r) => setTimeout(r, 400))
  }
  writeFileSync(join(dir, 'splat-inspect.log.json'), JSON.stringify(probe, null, 2))
  if (probe && probe.dataUrl) {
    writeFileSync(join(dir, 'splat-inspect.png'), Buffer.from(probe.dataUrl.split(',')[1] || '', 'base64'))
  }
  // 每个变体各落一张 PNG（文件名即变体名，便于直接比对哪套配置出画）
  // 注意：\${...} 要转义 —— 这段源码本身是 run.mjs 里的模板字符串
  if (probe && probe.shots) {
    for (const [name, dataUrl] of Object.entries(probe.shots)) {
      const safe = String(name).replace(/[^a-z0-9._-]/gi, '_')
      writeFileSync(
        join(dir, 'variant-' + safe + '.png'),
        Buffer.from(String(dataUrl).split(',')[1] || '', 'base64')
      )
    }
  }
  app.exit(0)
})
`
const runtimeDir = join(here, '.runtime')
mkdirSync(runtimeDir, { recursive: true })
const mainPath = join(runtimeDir, 'main.cjs')
writeFileSync(mainPath, mainSource)

// ELECTRON_RUN_AS_NODE 一旦存在（哪怕是空串）Electron 就以 Node 模式启动、拿不到 app：
// 必须整个删掉这个键
const childEnv = { ...process.env, SPLAT_INSPECT_DIR: outDir }
delete childEnv.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [mainPath], {
  stdio: 'inherit',
  env: childEnv
})
child.on('exit', (code) => {
  const logPath = join(outDir, 'splat-inspect.log.json')
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : null
  console.log('\n=== 泼溅体检 ===')
  console.log(`输入: ${splatPath}`)
  console.log(`输出目录: ${outDir}`)
  if (log?.logs) console.log(log.logs.join('\n'))
  console.log(`结果: ${log?.ok ? '渲染成功' : '未成功'}`)
  console.log(`PNG: ${join(outDir, 'splat-inspect.png')}`)
  process.exit(code ?? (log?.ok ? 0 : 1))
})
