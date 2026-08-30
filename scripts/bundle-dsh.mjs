#!/usr/bin/env node
/**
 * 生成自包含的 dsh（@deepseek-ai/dsh）运行体，供 electron-builder 作为 extraResources 打入安装包。
 *
 * 背景：dsh 是外部 npm CLI（DeepSeek Harness），需要系统 Node 运行。应用打包时把它
 * 一起带到 `<resources>/dsh`，用户安装后开箱即用，不再依赖 npx 现场下载。
 *
 * 做法：不重新 `npm install`。dsh 的依赖树有 60+ 个子包，在干净的 CI 上解析安装既慢
 * （数分钟）又吃内存（npm/arborist 超过默认 2GB heap 会 OOM）。改为直接复用主项目根
 * `node_modules` 中已解析好的依赖闭包（对 dependencies + optionalDependencies 做 BFS），
 * 复制到临时目录形成扁平、自包含的依赖树，再整体复制到 `out/dsh-bundle`。
 *
 * 版本从 package.json 的 dependencies 读取，保证与运行时解析入口一致。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

/** 解析包在根 node_modules 中的目录（支持 scoped；版本冲突时可能嵌套在子包的 node_modules 下） */
function resolvePkgDir(name) {
  const pkgPath = (nm) =>
    name.startsWith('@') ? join(nm, ...name.split('/')) : join(nm, name)

  const top = pkgPath(join(ROOT, 'node_modules'))
  if (existsSync(top)) return top

  // 回退：递归扫描嵌套 node_modules（npm 处理版本冲突的嵌套树，含 scoped 包），
  // 深度上限 2 层，避免全树遍历。
  const rootNm = join(ROOT, 'node_modules')
  let hit = null
  const walk = (dir, depth) => {
    if (hit || depth > 2) return
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (hit) return
      if (!ent.isDirectory()) continue
      const p = join(dir, ent.name)
      if (ent.name === 'node_modules') {
        const cand = pkgPath(p)
        if (existsSync(cand)) {
          hit = cand
          return
        }
        walk(p, depth + 1)
      } else {
        walk(p, depth)
      }
    }
  }
  walk(rootNm, 0)
  return hit
}

/** BFS 收集 dsh 的完整依赖闭包（dependencies + optionalDependencies） */
function collectPackages(entryName) {
  const queue = [{ name: entryName, optional: false }]
  const seen = new Set()
  const found = new Map()
  while (queue.length) {
    const { name, optional } = queue.shift()
    if (seen.has(name)) continue
    const src = resolvePkgDir(name)
    if (!src) {
      // optional 依赖按平台安装（如 node-addon-require-builtin-*），本平台未安装即用不到，跳过
      if (optional) continue
      console.error(`[bundle-dsh] 根 node_modules 缺少已安装依赖: ${name}（请先执行 npm ci）`)
      process.exit(1)
    }
    seen.add(name)
    found.set(name, src)
    const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!seen.has(dep)) queue.push({ name: dep, optional: false })
    }
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      if (!seen.has(dep)) queue.push({ name: dep, optional: true })
    }
    // peerDependencies 由 npm 自动安装进树，同样是运行所需（如 dsh-app-boot 的 cordis 插件），
    // 缺失时按 optional 处理（跳过），由后续完整性校验兜底。
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) {
      if (!seen.has(dep)) queue.push({ name: dep, optional: true })
    }
  }
  return found
}

/** 完整性校验：产物 node_modules 中每个包声明的依赖与 peer 依赖都必须存在（扁平布局） */
function verifyBundle() {
  const nm = join(OUT_DIR, 'node_modules')
  const has = (name) =>
    existsSync(name.startsWith('@') ? join(nm, ...name.split('/')) : join(nm, name))
  const missing = new Set()
  for (const ent of readdirSync(nm, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const root = join(nm, ent.name)
    const dirs = ent.name.startsWith('@')
      ? readdirSync(root).map((n) => join(root, n))
      : [root]
    for (const dir of dirs) {
      const pkgJson = join(dir, 'package.json')
      if (!existsSync(pkgJson)) continue
      const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
      // peerDependenciesMeta.optional=true 的 peer 不装也合法（如 ws 的 bufferutil、
      // zustand 的 @types/react），运行时会降级，不视为缺失。
      const optionalPeers = new Set(
        Object.entries(pkg.peerDependenciesMeta ?? {})
          .filter(([, m]) => m?.optional)
          .map(([k]) => k)
      )
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        if (!has(dep)) missing.add(dep)
      }
      for (const dep of Object.keys(pkg.peerDependencies ?? {})) {
        if (!has(dep) && !optionalPeers.has(dep)) missing.add(dep)
      }
    }
  }
  if (missing.size > 0) {
    console.error(`[bundle-dsh] 完整性校验失败，产物缺少依赖: ${[...missing].join(', ')}`)
    process.exit(1)
  }
  console.log('[bundle-dsh] 完整性校验通过（所有包的直接依赖与 peer 依赖均已包含）')
}

/** 把依赖闭包复制到 stage 的扁平 node_modules，形成自包含树 */
function buildStage(packages, version) {
  rmSync(STAGE_DIR, { recursive: true, force: true })
  mkdirSync(STAGE_DIR, { recursive: true })
  const stageNm = join(STAGE_DIR, 'node_modules')
  for (const [name, src] of packages) {
    const dest = join(stageNm, name)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(src, dest, { recursive: true })
  }
  writeFileSync(
    join(STAGE_DIR, 'package.json'),
    `${JSON.stringify({ name: 'dsh-runtime', private: true, version }, null, 2)}\n`
  )
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
  console.log(`[bundle-dsh] 从已安装依赖构建 ${DSH_PACKAGE}@${version} 自包含运行体…`)

  const packages = collectPackages(DSH_PACKAGE)
  console.log(`[bundle-dsh] 依赖闭包共 ${packages.size} 个包`)
  buildStage(packages, version)

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
  writeFileSync(join(OUT_DIR, 'package.json'), readFileSync(join(STAGE_DIR, 'package.json')))

  verifyBundle()

  const mb = (dirSize(OUT_DIR) / 1024 / 1024).toFixed(1)
  console.log(`[bundle-dsh] 完成：${relative(ROOT, OUT_DIR)}（约 ${mb} MB）`)
}

main()
