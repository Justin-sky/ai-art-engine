#!/usr/bin/env node
/**
 * 打包一致性自检：主进程 / preload 外置（externalizeDepsPlugin）的第三方包，必须能在
 * 打包后的 asar 内解析到。
 *
 * 背景：electron-builder.yml 的 files 里有一份「dsh 依赖闭包」排除清单（dsh 运行时自带
 * 一份，避免在 asar 里重复打包）。主进程 bundle 是外置依赖的，所以只要某个包**同时**
 * 出现在那份清单里，打包版就会在启动时 require 不到 → 主进程抛
 * "Cannot find module 'xxx'"、弹错误框挂住、窗口永不出现；而 CI 冒烟只能看到
 * 「60s 内没到就绪状态」，极难定位（6.1.1 的 chokidar 就是这么翻车的）。
 *
 * 用法：先 `npm run build`，再 `node scripts/check-pack-externals.mjs`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const bundles = ['main/index.js', 'main/yoloWorker.js', 'preload/index.js']
  .map((entry) => join(root, 'out', entry))
  .filter((file) => existsSync(file))

if (bundles.length === 0) {
  console.error('[check-pack-externals] 找不到 out/ 产物，请先执行 npm run build')
  process.exit(1)
}

// 1) electron-builder.yml 里的 asar 排除清单（形如 - '!node_modules/foo/**'）
const builderConfig = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
const excluded = new Set(
  [
    ...builderConfig.matchAll(
      /^\s*-\s*'!node_modules\/((?:@[^/'"]+\/[^/'"]+)|(?:[^/'"]+))\/\*\*'/gm
    )
  ].map((match) => match[1])
)

// 2) bundle 里 require 到的第三方包（排除相对路径、内置模块）
const externals = new Set()
for (const file of bundles) {
  for (const match of readFileSync(file, 'utf8').matchAll(/require\((["'])([^"']+)\1\)/g)) {
    const specifier = match[2]
    const isBuiltin = specifier.startsWith('node:') || builtinModules.includes(specifier)
    if (specifier.startsWith('.') || specifier.startsWith('/') || isBuiltin) continue
    externals.add(
      specifier
        .split('/')
        .slice(0, specifier.startsWith('@') ? 2 : 1)
        .join('/')
    )
  }
}

// 3) 沿 package-lock 的生产依赖闭包展开（只看 dependencies，跳过 optional / peer / dev）
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const queue = [...externals]
const visited = new Set()
const conflicts = []
while (queue.length > 0) {
  const name = queue.shift()
  if (visited.has(name)) continue
  visited.add(name)
  if (excluded.has(name)) conflicts.push(name)
  const dependencies = lock.packages?.[`node_modules/${name}`]?.dependencies
  if (dependencies) queue.push(...Object.keys(dependencies))
}

if (conflicts.length > 0) {
  console.error(
    '[check-pack-externals] 以下包被主进程 / preload 外置依赖，却又被 electron-builder.yml 排除在 asar 之外：'
  )
  for (const name of conflicts) console.error(`  - ${name}`)
  console.error('打包版启动时会在 asar 内 require 不到并挂住。二选一修：')
  console.error(
    '  a) 在 electron.vite.config.ts 的 externalizeDepsPlugin({ exclude: [...] }) 里把它打进 bundle；'
  )
  console.error(
    '  b) 从 electron-builder.yml 的 files 排除清单里去掉它（注意别与 dsh 自带的那份重复打包）。'
  )
  process.exit(1)
}

console.log(
  `[check-pack-externals] OK：${externals.size} 个外置包、依赖闭包共 ${visited.size} 个包，均未被 asar 排除`
)
