#!/usr/bin/env node
/**
 * 生成自包含的 dsh（@deepseek-ai/dsh）运行体目录，供 electron-builder 作为 extraResources 打入安装包。
 *
 * 背景：dsh 是外部 npm CLI（DeepSeek Harness），需要系统 Node 运行。应用打包时把它
 * 一起带到安装包内，用户安装后开箱即用，不再依赖 npx 现场下载。
 *
 * 做法：不重新 `npm install`。dsh 的依赖树有 60+ 个子包，在干净的 CI 上解析安装既慢
 * （数分钟）又吃内存（npm/arborist 超过默认 2GB heap 会 OOM）。改为直接复用主项目根
 * `node_modules` 中已解析好的依赖闭包（对 dependencies + optionalDependencies 做 BFS），
 * 复制到临时目录形成扁平、自包含的依赖树，再整体复制到 `out/dsh`。
 *
 * 打包形态：不做任何文件过滤（npm 包会把运行时代码放在 doc/、examples/ 等看似文档的
 * 目录里，如 yaml 的 dist/doc/directives.js，裁剪有误删风险）。完整依赖闭包以目录形式
 * 随安装包分发到 `<resources>/dsh`：
 *   - dsh 与应用一起安装、一起升级（electron-updater 会整体替换 resources），
 *     不存在 userData 里的旧版本残留，无需版本号指纹比对；
 *   - 无首次启动解压等待，启动即可用；
 *   - 未压缩文件交由 NSIS 的 solid LZMA 统一压缩，比「先 zip 再打包」（已压缩内容
 *     无法二次压缩）得到的安装包更小。
 *
 * 版本从 package.json 的 dependencies 读取，保证与运行时解析入口一致。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_PACKAGE = '@deepseek-ai/dsh'
const OUT_DIR = join(ROOT, 'out', 'dsh')
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

/**
 * 非运行必需文件过滤：减少安装包体积与文件数量，NSIS 安装更快。
 * 被过滤的内容 Node 运行时用不到，npm 生态中公认可安全移除：
 *   - sourcemap（*.map）、TypeScript 类型声明（*.d.ts）：仅开发/调试用
 *   - Markdown 文档（*.md）
 *   - 仓库/工具配置类点文件（.gitignore、.npmignore、.editorconfig …）
 *   - test / docs / example 目录：仅仓库内容
 *
 * 两处例外（都是踩过坑的）：
 *   1. 包的 dist/ 下存在「看似文档目录、实为运行时代码」的文件（如 yaml 的
 *      dist/doc/directives.js），因此 dist/ 内路径只应用扩展名规则，不做目录名过滤；
 *   2. 点文件只过滤「明确的仓库/工具配置」，不能一刀切——运行时数据文件同样以点开头
 *      （如 @earendil-works/pi-ai 的 dist/providers/data/.manifest.json），
 *      一刀切会让 dsh 启动时找不到清单文件。
 */
const IGNORED_DIR_RE =
  /(^|[\\/])(test|tests|__tests__|docs?|example|examples|\.history|\.yarn|\.cache|\.idea|\.vscode|\.nyc_output|coverage)([\\/]|$)/
const IGNORED_EXT_RE = /\.(map|md|markdown)$/i
const IGNORED_D_TS_RE = /\.d\.ts$/i
const DIST_DIR_RE = /(^|[\\/])dist([\\/]|$)/
const IGNORED_DOT_FILE_RE =
  /^\.(?:DS_Store|git(?:ignore|attributes|modules)?|npm(?:ignore|rc)|nvmrc|yarn(?:rc|integrity)|travis\.yml|editorconfig|eslint(?:ignore|rc(?:\.[a-z]+)?)|prettier(?:ignore|rc(?:\.[a-z]+)?)|babelrc(?:\.[a-z]+)?|browserslistrc|nycrc|mocharc\.[a-z]+|commitlintrc\.[a-z]+|stylelintrc(?:\.[a-z]+)?|dockerignore|tool-versions|vscode|github|idea)$/i

let filteredCount = 0
let filteredBytes = 0

function markFiltered(src) {
  filteredCount++
  try {
    const st = statSync(src)
    filteredBytes += st.isDirectory() ? dirSize(src) : st.size
  } catch {
    /* 读取失败不计入统计 */
  }
  return false
}

function isRuntimeFile(src) {
  const base = basename(src)
  if (IGNORED_EXT_RE.test(base) || IGNORED_D_TS_RE.test(base) || IGNORED_DOT_FILE_RE.test(base)) {
    return markFiltered(src)
  }
  if (!DIST_DIR_RE.test(src) && IGNORED_DIR_RE.test(src)) return markFiltered(src)
  return true
}

/** 把依赖闭包复制到 stage 的扁平 node_modules，形成自包含树（按 isRuntimeFile 裁剪） */
async function buildStage(packages, version) {
  rmSync(STAGE_DIR, { recursive: true, force: true })
  mkdirSync(STAGE_DIR, { recursive: true })
  const stageNm = join(STAGE_DIR, 'node_modules')
  for (const [name, src] of packages) {
    const dest = join(stageNm, name)
    mkdirSync(dirname(dest), { recursive: true })
    await cp(src, dest, { recursive: true, filter: isRuntimeFile })
  }
  writeFileSync(
    join(STAGE_DIR, 'package.json'),
    `${JSON.stringify({ name: 'dsh-runtime', private: true, version }, null, 2)}\n`
  )
}

/**
 * 引用可达性校验：产物内 JS 文件的「相对」require / import 目标必须真实存在。
 * 依赖闭包与完整性校验只能证明「包在」，无法证明「包内的文件没被裁掉」；
 * 本校验直接解析相对引用路径，可捕获 yaml 的 dist/doc/directives.js 这类误删。
 */
function verifyReachableRequires(packages) {
  const root = join(OUT_DIR, 'node_modules')

  /**
   * 产物内路径 → 原始依赖目录中的同位置路径。
   * 用于区分「裁剪误删」与「包内本就不存在的可选引用」——后者在源包里同样找不到
   * （如 protobufjs 的 ./compiled，只在 try/catch 中 require），不应判为裁剪事故。
   */
  function sourcePathOf(target) {
    const rel = relative(root, target)
    const parts = rel.split(/[\\/]/)
    const scoped = parts[0].startsWith('@')
    const pkgName = scoped ? parts.slice(0, 2).join('/') : parts[0]
    const src = packages.get(pkgName)
    if (!src) return null
    return join(src, ...parts.slice(scoped ? 2 : 1))
  }
  const EXTS = ['', '.js', '.cjs', '.mjs', '.json', '.node']
  const INDEXES = ['index.js', 'index.cjs', 'index.mjs', 'index.json']
  const files = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(?:c|m)?js$/.test(ent.name)) files.push(p)
    }
  }
  walk(root)

  const re = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]*)['"]|require\(\s*['"](\.[^'"]*)['"]\s*\)/g
  // 带扩展名的引用明确指向某个具体文件，缺失即裁剪误删（致命）；
  // 不带扩展名的可能是目录 / index 解析，也可能是源码里的说明性字符串（如 React 的
  // './MyComponent'）或类型引用（fast-uri 的 './types/index'），仅提示不阻塞。
  const missing = new Map()
  const loose = new Map()
  for (const file of files) {
    let src
    try {
      src = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let m
    while ((m = re.exec(src))) {
      const spec = m[1] ?? m[2]
      if (!spec) continue
      // 跳过误报：源码里的解释性字符串（'.command()'、'./MyComponent'）不是模块路径；
      // .ts/.tsx 是源码引用，运行时加载的是编译产物，不作为缺失判定。
      if (/[()\s]/.test(spec) || /\.(?:ts|tsx)$/i.test(spec)) continue
      const target = resolve(dirname(file), spec)
      const hit =
        EXTS.some((ext) => existsSync(target + ext) && statSync(target + ext).isFile()) ||
        INDEXES.some((idx) => existsSync(join(target, idx)))
      if (hit) continue
      // 只在「源包里有、产物里没了」时判为裁剪误删
      const src = sourcePathOf(target)
      // 只有「引用了具体文件（带扩展名）、该文件在源包里确实存在、产物里却没了」
      // 才算裁剪误删；目录/包引用（'./'、'./types/index'）与包内可选引用不在此列。
      const realDeletion =
        /\.[a-z0-9]+$/i.test(spec) &&
        src !== null &&
        existsSync(src) &&
        statSync(src).isFile()
      const bucket = realDeletion ? missing : loose
      if (!bucket.has(file)) bucket.set(file, new Set())
      bucket.get(file).add(spec)
    }
  }

  if (missing.size > 0) {
    const sample = [...missing.entries()]
      .slice(0, 8)
      .map(([f, specs]) => `  ${relative(root, f)} -> ${[...specs].join(', ')}`)
      .join('\n')
    console.error(
      `[bundle-dsh] 引用可达性校验失败：${missing.size} 个文件引用的具体文件不存在（裁剪误删）：\n${sample}`
    )
    process.exit(1)
  }
  if (loose.size > 0) {
    const sample = [...loose.entries()]
      .slice(0, 5)
      .map(([f, specs]) => `  ${relative(root, f)} -> ${[...specs].join(', ')}`)
      .join('\n')
    console.warn(
      `[bundle-dsh] 提示：${loose.size} 个文件含未解析到的无扩展名引用（多为注释/示例字符串或类型引用，不影响运行）：\n${sample}`
    )
  }
  console.log(
    `[bundle-dsh] 引用可达性校验通过（扫描 ${files.length} 个 JS 文件，带扩展名的相对引用全部可达）`
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

async function main() {
  const version = resolveDshVersion()
  console.log(`[bundle-dsh] 从已安装依赖构建 ${DSH_PACKAGE}@${version} 自包含运行体…`)

  const packages = collectPackages(DSH_PACKAGE)
  console.log(`[bundle-dsh] 依赖闭包共 ${packages.size} 个包`)
  filteredCount = 0
  filteredBytes = 0
  await buildStage(packages, version)
  if (filteredCount > 0) {
    console.log(
      `[bundle-dsh] 已裁剪非运行文件：${filteredCount} 项，约 ${(filteredBytes / 1024 / 1024).toFixed(1)} MB`
    )
  }

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
  verifyReachableRequires(packages)

  const mb = (dirSize(OUT_DIR) / 1024 / 1024).toFixed(1)
  console.log(`[bundle-dsh] 完成：${relative(ROOT, OUT_DIR)}（约 ${mb} MB）`)
}

await main().catch((err) => {
  console.error(`[bundle-dsh] 失败：${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  process.exit(1)
})
