'use strict'
/**
 * afterPack 钩子：未配置正式开发者证书时，对 macOS .app 做 ad-hoc 签名。
 *
 * 背景：Apple Silicon (arm64) 的内核强制要求可执行文件至少带 ad-hoc 代码签名，
 * 完全未签名的 arm64 包会被 macOS 判为「已损坏，无法打开」。
 * 本钩子用于 electron-builder 未签名分支（无 CSC_LINK/MAC_CSC_LINK，
 * CI 传 --config.mac.identity=null）：afterPack 在默认签名之前执行，
 * 未签名分支之后不会再有其他签名覆盖这里的 ad-hoc 签名，产物即可在 M 系列上运行。
 * 已配置正式证书时直接跳过，交给 electron-builder 用真实证书签名（含公证流程）。
 *
 * electron-builder 会对每个架构各调用一次本钩子（如 --x64 --arm64 各一次）。
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // 正式签名（Developer ID / Mac Developer）时不要插手
  if (process.env.CSC_LINK || process.env.MAC_CSC_LINK) return

  const { execFileSync } = require('node:child_process')
  const { readdirSync } = require('node:fs')
  const { join } = require('node:path')

  const { appOutDir } = context
  const apps = readdirSync(appOutDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('.app'))
    .map((e) => join(appOutDir, e.name))
  if (apps.length === 0) {
    console.warn('[adhoc-sign] no .app found in', appOutDir)
    return
  }
  for (const app of apps) {
    console.log(`[adhoc-sign] codesign --force --deep --sign - ${app}`)
    // 注意：不追加 --options runtime（避免 hardened runtime 引入 entitlements/JIT 约束），
    // 仅满足 arm64 内核的 ad-hoc 签名要求。
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], {
      stdio: 'inherit'
    })
  }
}
