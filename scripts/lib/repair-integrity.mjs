#!/usr/bin/env node
/**
 * 把工作区里会阻断可执行程序的「低完整性」标签重置为「中等」，并打印每一步的结果。
 *
 * 逻辑集中在同目录的 integrity-label.mjs：dev-launcher 与 scripts/fix-workspace-integrity.mjs
 * 共用同一份实现（后者是本文件的命令行入口，调用导出的 main()）。
 *
 * 用法：
 *   npm run fix:integrity                 # 重置工作区根目录 + electron 解包目录
 *   npm run fix:integrity -- --check      # 只查看当前标签，不做修改
 *   npm run fix:integrity -- --only=dist  # 只处理 electron 解包目录（不碰工作区根目录）
 */
import {
  isLowIntegrity,
  resetDirIntegrity,
  resetWorkspaceRootIntegrity,
  tryReadIntegrityLabel
} from './integrity-label.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const projectRoot = resolve(scriptDir, '..', '..')

/** 修复目标：工作区根目录（整棵树靠继承刷新）与 electron 解包目录（具体目标，不递归） */
export const integrityTargets = [
  { key: 'root', path: projectRoot, reset: resetWorkspaceRootIntegrity },
  {
    key: 'dist',
    path: resolve(projectRoot, 'node_modules', 'electron', 'dist'),
    reset: resetDirIntegrity
  }
]

/**
 * 修复给定的目标列表。
 * @returns {{changed: string[], failed: string[]}} changed 为实际改动的目标 key
 */
export function repairIntegrityTargets(targets, { log = () => {} } = {}) {
  const changed = []
  const failed = []
  for (const target of targets) {
    const before = tryReadIntegrityLabel(target.path)
    if (before === null) {
      log(`  ${target.path}\n    (不存在或无法读取，跳过)`)
      continue
    }
    log(`  ${target.path}\n    ${before}`)
    if (!isLowIntegrity(before)) continue
    try {
      target.reset(target.path)
      const after = tryReadIntegrityLabel(target.path)
      if (after !== null && !isLowIntegrity(after)) {
        changed.push(target.key)
        log(`    ✓ 已重置为中等完整性`)
      } else {
        failed.push(target.key)
        log(`    ✗ 重置后仍为低完整性`)
      }
    } catch (err) {
      failed.push(target.key)
      log(`    ✗ 重置失败：${err.message}`)
    }
  }
  return { changed, failed }
}

/** 命令行入口；导出给 scripts/fix-workspace-integrity.mjs 调用（该文件是 npm 脚本的 argv[1]） */
export function main() {
  const argv = process.argv.slice(2)
  const checkOnly = argv.includes('--check')
  const onlyArg = argv.find((a) => a.startsWith('--only='))
  const only = onlyArg ? onlyArg.slice('--only='.length) : null
  const targets = only ? integrityTargets.filter((t) => t.key === only) : integrityTargets

  if (targets.length === 0) {
    console.error(
      `未知的 --only 取值「${only}」，可用：${integrityTargets.map((t) => t.key).join(' / ')}`
    )
    process.exit(2)
  }

  console.log(`工作区：${projectRoot}${checkOnly ? '（--check：只读，不改动）' : ''}\n`)

  if (checkOnly) {
    for (const target of targets) {
      const label = tryReadIntegrityLabel(target.path)
      console.log(`  ${target.path}`)
      console.log(
        `    ${label ?? '(不存在或无法读取)'}${label && isLowIntegrity(label) ? '   <-- 低完整性，会阻断可执行程序' : ''}`
      )
    }
    console.log('\n（--check 模式未做任何修改；执行 npm run fix:integrity 才会修复）')
    return 0
  }

  const { changed, failed } = repairIntegrityTargets(targets, { log: (m) => console.log(m) })
  if (failed.length > 0) {
    console.error(`\n有 ${failed.length} 项未修复（${failed.join(' / ')}）。请用管理员终端执行：`)
    for (const key of failed) {
      const target = integrityTargets.find((t) => t.key === key)
      console.error(`  icacls "${target.path}" /setintegritylevel M /T /C`)
    }
    return 1
  }
  console.log(changed.length > 0 ? `\n完成，已修复：${changed.join(' / ')}` : '\n无需修复。')
  return 0
}
