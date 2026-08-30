#!/usr/bin/env node
/**
 * 生成自包含的 dsh（@deepseek-ai/dsh）运行体，供 electron-builder 作为 extraResources 打入安装包。
 *
 * 背景：dsh 是外部 npm CLI（DeepSeek Harness），需要系统 Node 运行。应用打包时把它
 * 一起带到 `<resources>/dsh`，用户安装后开箱即用，不再依赖 npx 现场下载。
 *
 * 做法：在临时目录用 `npm install --prefix` 装一份「扁平、自包含」的依赖树（dsh 及其全部
 * 依赖都落在 node_modules 下），整体复制到 `out/dsh-bundle`。与主项目 node_modules 解耦，
 * 无论主工程是否安装过该包都能独立产出，且不会因 npm 提升（hoisting）缺失依赖。
 *
 * 版本从 package.json 的 dependencies 读取，保证与运行时解析入口一致。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_PACKAGE = '@deepseek-ai/dsh'
const OUT_DIR = join(ROOT, 'out', 'dsh-bundle')
const STAGE_DIR = join(ROOT, 'out', '.dsh-stage')

/** 主 package.json 中固定的 dsh 版本（单一事实来源） */
function resolveDshVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.dependencies?.[DSH_PACKAGE]
  if (!version) {
    console.error(`[bundle-dsh] package.json 的 dependencies 缺少 ${DSH_PACKAGE}`)
    process.exit(1)
  }
  return version
}

/** npm install --prefix，得到自包含依赖树 */
function installStage(version) {
  console.log(`[bundle-dsh] 安装 ${DSH_PACKAGE}@${version} 自包含运行体…`)
  mkdirSync(STAGE_DIR, { recursive: true })
  for (const f of ['package.json', 'package-lock.json']) rmSync(join(STAGE_DIR, f), { force: true })
  rmSync(join(STAGE_DIR, 'node_modules'), { recursive: true, force: true })

  const args = [
    'install',
    '--prefix',
    STAGE_DIR,
    '--no-audit',
    '--no-fund',
    '--no-save',
    `${DSH_PACKAGE}@${version}`
  ]
  // Windows 上无法直接 spawn npm.cmd（返回 EINVAL，status 为 null），
  // 需经 cmd.exe /c 执行；含空格路径在命令串中加引号。
  const res =
    process.platform === 'win32'
      ? spawnSync(
          'cmd.exe',
          ['/d', '/s', '/c', `npm ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`],
          { stdio: 'inherit' }
        )
      : spawnSync('npm', args, { stdio: 'inherit' })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

/** 解析包的 bin 入口（bin 为字符串或对象，对象取首个值） */
function resolveEntry(packageRoot) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const bin = pkg.bin
  if (!bin) return null
  const name = typeof bin === 'string' ? bin : Object.keys(bin)[0]
  return name ? join(packageRoot, bin[name] ?? bin) : null
}

function dirSize(root) {
  let total = 0
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else total += st.size
    }
  }
  walk(root)
  return total
}

function main() {
  const version = resolveDshVersion()
  installStage(version)

  const packageRoot = join(STAGE_DIR, 'node_modules', DSH_PACKAGE)
  const entry = resolveEntry(packageRoot)
  if (!entry || !existsSync(entry)) {
    console.error(`[bundle-dsh] 未找到 dsh 入口（预期 ${DSH_PACKAGE} 的 bin）`)
    process.exit(1)
  }
  console.log(`[bundle-dsh] 入口校验通过: ${relative(ROOT, entry)}`)

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  cpSync(join(STAGE_DIR, 'node_modules'), join(OUT_DIR, 'node_modules'), { recursive: true })
  for (const f of ['package.json', 'package-lock.json']) rmSync(join(OUT_DIR, f), { force: true })

  const mb = (dirSize(OUT_DIR) / 1024 / 1024).toFixed(1)
  console.log(`[bundle-dsh] 完成：${relative(ROOT, OUT_DIR)}（约 ${mb} MB）`)
}

main()
