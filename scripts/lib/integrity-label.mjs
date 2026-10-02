#!/usr/bin/env node
/**
 * 工作区完整性级别（Mandatory Integrity Level）检查与修复的共享实现。
 *
 * 背景：强沙箱的 agent 宿主（workspace-write 模式等）会给工作区根目录挂上
 * `Mandatory Label\Low`，且该 ACE 带 (OI)(CI) 可继承标志——工作区内**新建**的任何文件都会继承
 * 「低完整性」。低完整性的进程无法创建比自身级别更高的安全对象（AppContainer、受限令牌、
 * Job 对象），因此 Electron/Chromium 主进程会以 `0x80000003`(STATUS_BREAKPOINT) 立即中止：
 * 不执行任何 JS、不打印任何错误，症状是「打印完 start electron app... 就静默回到命令行」。
 *
 * 修复只需改**工作区根目录**这一处：Windows 会重新计算子对象的继承 ACE，整棵树的标签一起刷新，
 * 因此不必 /T 递归（比递归快得多，也不会去碰 node_modules 里几万个文件）。
 *
 * 被 scripts/dev-launcher.mjs（启动前自动兜底）与 scripts/fix-workspace-integrity.mjs（手动命令）
 * 共用，避免两处各写一份判断逻辑。
 */
import { execFileSync } from 'node:child_process'

/** icacls 输出随系统语言变化，中英两种写法都匹配 */
export const isLowIntegrity = (icaclsOutput) =>
  /Low Mandatory Level|低强制级别|低完整性级别/i.test(icaclsOutput)

/** 读取对象当前的完整性标签行；对象不存在或无法读取时抛错 */
export function readIntegrityLabel(target) {
  const out = execFileSync('icacls', [target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const line = out.split(/\r?\n/).find((l) => /Mandatory Level|强制级别|完整性级别/i.test(l))
  return line ? line.replace(/\s+/g, ' ').trim() : '(无标签)'
}

/**
 * 把工作区根目录重置为可继承的中等完整性标签。
 *
 * 用 `(OI)(CI)M` 而不是 `M`：把「中等」写成新的可继承值，子对象（含尚未创建的）随之刷新，
 * 避免继续继承旧的「低」。幂等——已是中等时执行等于空操作。
 */
export function resetWorkspaceRootIntegrity(root) {
  execFileSync('icacls', [root, '/setintegritylevel', '(OI)(CI)M'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

/** 把单个目录（不递归）重置为中等完整性，用于 electron 解包目录这类具体目标 */
export function resetDirIntegrity(target) {
  execFileSync('icacls', [target, '/setintegritylevel', 'M'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

/** 读标签的宽松版本：目标不存在或 icacls 不可用时返回 null，供兜底逻辑判断 */
export function tryReadIntegrityLabel(target) {
  try {
    return readIntegrityLabel(target)
  } catch {
    return null
  }
}
