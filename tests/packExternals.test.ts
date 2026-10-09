/**
 * `scripts/check-pack-externals.mjs` 的纯逻辑测试。
 *
 * 背景：这个检查负责在打包前拦住「主进程外置依赖，却被 electron-builder 的
 * asar 排除清单排除」的组合 —— 打包版启动时会 require 不到、窗口永不出现
 * （6.1.1 的 chokidar 就是这么翻车的）。所以它**既不能漏报也不能误报**：
 *
 * - 误报：真的踩过。它先前恒取顶层 `node_modules/<name>` 展开闭包，
 *   把某 SDK 内嵌的 node-fetch@2.7.0 当成顶层那份（dsh 的 v3.3.2，纯 ESM
 *   且被 asar 排除），再顺着 v3 的链拖出 8.8 MB 的 web-streams-polyfill ——
 *   报了一串并不存在的冲突。
 * - 漏报：同一处写法只看一层依赖，间接依赖根本没遍历到。
 */
import { describe, expect, it } from 'vitest'
import {
  findPackConflicts,
  readAsarExcluded,
  resolvePackagePath
} from '../scripts/lib/pack-externals.mjs'

/** 构造一份最小 package-lock packages 段 */
function lockOf(entries) {
  const packages = {}
  for (const [path, value] of Object.entries(entries)) {
    packages[path] = typeof value === 'string' ? { version: value } : value
  }
  return packages
}

describe('readAsarExcluded', () => {
  it('解析 electron-builder.yml 的排除清单（含 scope 包）', () => {
    const yml = [
      'files:',
      "  - '!node_modules/@scope/pkg/**'",
      "  - '!node_modules/plain/**'",
      "  - '!**/.vscode/*'",
      "  - '!src/*'"
    ].join('\n')
    const excluded = readAsarExcluded(yml)
    expect([...excluded].sort()).toEqual(['@scope/pkg', 'plain'])
  })
})

describe('resolvePackagePath（Node 解析顺序）', () => {
  it('优先取依赖方内嵌的那份，找不到才回退顶层', () => {
    const packages = lockOf({
      'node_modules/node-fetch': '3.3.2',
      'node_modules/@scope/a/node_modules/node-fetch': '2.7.0'
    })
    // 依赖方是 @scope/a：它自己内嵌了 v2.7.0
    expect(resolvePackagePath('node-fetch', 'node_modules/@scope/a', packages)).toBe(
      'node_modules/@scope/a/node_modules/node-fetch'
    )
    // 依赖方是别处：回退顶层 v3
    expect(resolvePackagePath('node-fetch', 'node_modules/other', packages)).toBe(
      'node_modules/node-fetch'
    )
    // 顶层调用也一样
    expect(resolvePackagePath('node-fetch', '', packages)).toBe('node_modules/node-fetch')
  })

  it('逐级向上找（两层嵌套）', () => {
    const packages = lockOf({
      'node_modules/a/node_modules/b/node_modules/c': '1.0.0'
    })
    expect(resolvePackagePath('c', 'node_modules/a/node_modules/b', packages)).toBe(
      'node_modules/a/node_modules/b/node_modules/c'
    )
  })

  it('找不到返回 null（不能瞎猜成顶层）', () => {
    const packages = lockOf({ 'node_modules/a': '1.0.0' })
    expect(resolvePackagePath('missing', 'node_modules/a', packages)).toBeNull()
  })
})

describe('findPackConflicts', () => {
  it('内嵌副本不算冲突（消费方解析得到它，asar 也会带上）', () => {
    const packages = lockOf({
      // 顶层这份被 asar 排除（dsh 自带，避免重复打包）
      'node_modules/node-fetch': { version: '3.3.2', dependencies: { 'fetch-blob': '^3' } },
      'node_modules/fetch-blob': '3.2.0',
      // 我们的 SDK 内嵌了一份 v2，会进 asar
      'node_modules/@scope/sdk': { version: '1.0.0', dependencies: { 'node-fetch': '^2' } },
      'node_modules/@scope/sdk/node_modules/node-fetch': {
        version: '2.7.0',
        dependencies: { 'whatwg-url': '^5' }
      },
      'node_modules/whatwg-url': '5.0.0'
    })
    const excluded = readAsarExcluded("  - '!node_modules/node-fetch/**'")
    const { conflicts } = findPackConflicts(['@scope/sdk'], excluded, packages)
    expect(conflicts).toEqual([])
  })

  it('依赖真的落在顶层且被排除时报出来（漏报会让打包版启动挂住）', () => {
    const packages = lockOf({
      'node_modules/sdk': { version: '1.0.0', dependencies: { chokidar: '^4' } },
      'node_modules/chokidar': '4.0.0'
    })
    const excluded = readAsarExcluded("  - '!node_modules/chokidar/**'")
    const { conflicts } = findPackConflicts(['sdk'], excluded, packages)
    expect(conflicts).toEqual(['chokidar'])
  })

  it('间接依赖也要遍历到（旧写法只看一层，会漏）', () => {
    const packages = lockOf({
      'node_modules/sdk': { version: '1.0.0', dependencies: { mid: '^1' } },
      'node_modules/mid': { version: '1.0.0', dependencies: { deep: '^1' } },
      'node_modules/deep': '1.0.0'
    })
    const excluded = readAsarExcluded("  - '!node_modules/deep/**'")
    const { conflicts } = findPackConflicts(['sdk'], excluded, packages)
    expect(conflicts).toEqual(['deep'])
  })

  it('未被排除的包不算冲突', () => {
    const packages = lockOf({
      'node_modules/sdk': { version: '1.0.0', dependencies: { axios: '^1' } },
      'node_modules/axios': '1.0.0'
    })
    const excluded = readAsarExcluded("  - '!node_modules/other/**'")
    expect(findPackConflicts(['sdk'], excluded, packages).conflicts).toEqual([])
  })

  it('环形依赖不会死循环（visited 有界）', () => {
    const packages = lockOf({
      'node_modules/a': { version: '1.0.0', dependencies: { b: '^1' } },
      'node_modules/b': { version: '1.0.0', dependencies: { a: '^1' } }
    })
    const { conflicts, visited } = findPackConflicts(['a'], new Set(), packages)
    expect(conflicts).toEqual([])
    // visited 计的是 (fromDir, name) 组合 —— 只要有限即可，重点是没挂住
    expect(visited).toBeGreaterThan(0)
    expect(visited).toBeLessThan(10)
  })
})

/**
 * 对**真实仓库**跑一遍：确认真实依赖闭包可解析，
 * 同时保证真冲突仍然会被抓住（用人为排除清单验证）。
 */
describe('真实仓库的依赖树', () => {
  it('顶层 axios 未被 asar 排除时不报冲突', async () => {
    const { readFileSync } = await import('node:fs')
    const packages = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages
    const excluded = readAsarExcluded(readFileSync('electron-builder.yml', 'utf8'))
    expect(excluded.has('node-fetch')).toBe(true)
    expect(packages['node_modules/axios']).toBeTruthy()
    expect(findPackConflicts(['axios'], excluded, packages).conflicts).toEqual([])
  })

  it('同一份树，若把某个真依赖也排除，仍会报出来（检查没有被架空）', async () => {
    const { readFileSync } = await import('node:fs')
    const packages = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages
    const excluded = readAsarExcluded(readFileSync('electron-builder.yml', 'utf8'))
    // axios 是顶层外置依赖，把它加进排除清单就应当被抓到
    const withAxiosExcluded = new Set([...excluded, 'axios'])
    expect(findPackConflicts(['axios'], withAxiosExcluded, packages).conflicts).toEqual(['axios'])
  })
})
