/**
 * 打包一致性检查的纯逻辑（`scripts/check-pack-externals.mjs` 调用）。
 *
 * 提出来是为了可单测：这段逻辑先前**恒取顶层 `node_modules/<name>`** 展开依赖闭包，
 * 不看 Node 的嵌套解析，于是把 `@elevenlabs/elevenlabs-js` 内嵌的 node-fetch@2.7.0
 * 误当成顶层那份（dsh 的 node-fetch@3.3.2，纯 ESM 且被 asar 排除），
 * 再顺着 v3 的链拖出 8.8 MB 的 web-streams-polyfill，报了一串**不存在的冲突**。
 */

/** 解析 electron-builder.yml 里形如 `- '!node_modules/foo/**'` 的 asar 排除清单 */
export function readAsarExcluded(builderConfig) {
  return new Set(
    [
      ...builderConfig.matchAll(
        /^\s*-\s*'!node_modules\/((?:@[^/'"]+\/[^/'"]+)|(?:[^/'"]+))\/\*\*'/gm
      )
    ].map((match) => match[1])
  )
}

/**
 * 按 Node 的解析顺序找包的实际安装位置：
 * 先从「依赖它的那个包」自己的 node_modules 逐级往上找，最后才回退到顶层提升的那份。
 *
 * @param {string} name 包名（含 scope）
 * @param {string} fromDir 依赖方所在目录；顶层传空串
 * @param {Record<string, unknown>} packages package-lock 的 `packages` 段
 */
export function resolvePackagePath(name, fromDir, packages) {
  for (const dir of ancestorDirs(fromDir)) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`
    if (packages[candidate]) return candidate
  }
  return null
}

/**
 * 从 fromDir 一路向上给出「可能含 node_modules 的目录」。
 *
 * 用**边界**（`node_modules/` 出现的位置）截断，不要拿 `lastIndexOf` 的结果当偏移量 ——
 * 前者返回的是 `${'node_modules'}` 的长度（12），后者才是 `/node_modules/` 的起点（13），
 * 差一位会把包名截掉最后一个字符，解析随之落到顶层那份上（这个 bug 真踩过）。
 */
function ancestorDirs(fromDir) {
  const dirs = []
  let dir = fromDir
  for (;;) {
    dirs.push(dir)
    if (!dir) break
    const at = dir.lastIndexOf('/node_modules/')
    if (at < 0) {
      dir = ''
      continue
    }
    // `node_modules` 字面量本身永远不会出现在它自己的路径里，所以这个查找是安全的
    dir = dir.slice(0, at)
  }
  return dirs
}

/**
 * 展开依赖闭包，返回**真的会踩坑**的包：既出现在 asar 排除清单里，
 * 又（按解析顺序）落在顶层 `node_modules/<name>` —— 只有这个位置会被
 * electron-builder 的 `!node_modules/<pkg>/**` 覆盖；嵌套副本会照常打进 asar。
 *
 * @param {Iterable<string>} externals 主进程 / preload 外置的包名
 * @param {Set<string>} excluded asar 排除清单
 * @param {Record<string, { dependencies?: Record<string, string> }>} packages
 */
export function findPackConflicts(externals, excluded, packages) {
  const queue = [...externals].map((name) => ({ name, fromDir: '' }))
  const visited = new Set()
  const conflicts = new Set()

  while (queue.length > 0) {
    const { name, fromDir } = queue.shift()
    const key = `${fromDir}=>${name}`
    if (visited.has(key)) continue
    visited.add(key)

    const pkgPath = resolvePackagePath(name, fromDir, packages)
    if (!pkgPath) continue
    // 只有落在**顶层** `node_modules/<name>` 的才会被 asar 排除规则覆盖；
    // 嵌套副本会照常打进 asar，运行时 require 得到
    if (excluded.has(name) && !pkgPath.includes('/node_modules/')) conflicts.add(name)

    const dependencies = packages[pkgPath]?.dependencies
    if (!dependencies) continue
    // 这个包自己的目录**就是**解析它依赖时的起点（不再反推，反推容易差一位）
    for (const dep of Object.keys(dependencies)) {
      queue.push({ name: dep, fromDir: pkgPath })
    }
  }

  return { conflicts: [...conflicts], visited: visited.size }
}
