import type { NodeExecuteContext } from '@shared/graph'

/**
 * `asset.gamePlay` 节点侧的 cook：主进程 npm + node build.mjs 构建并内联单文件。
 *
 * 游戏**生成**已改由 AI 对话面板驱动（MCP `gameplay_*` 工具 + 内置技能），图内不再有
 * 「可玩 HTML 生成」节点；这里保留的是兼容层能力——旧工程里的 `asset.gamePlay` 节点
 * 仍能把既有工程目录 cook 成单文件，再双击进沙盒试玩。
 */
export async function buildGamePlayProjectForNode(
  input: Parameters<NonNullable<NodeExecuteContext['buildGamePlayProject']>>[0]
): Promise<{ html: string; buildHtmlRelativePath: string }> {
  input.log?.('cook: npm install + node build.mjs…')
  const built = await window.studio.buildGamePlayProject({
    projectRelativeDir: input.projectRelativeDir
  })
  for (const line of built.logs.slice(-20)) {
    input.log?.(line)
  }
  input.log?.(`cook: single HTML ${built.bytes}B`)
  return {
    html: built.html,
    buildHtmlRelativePath: built.buildHtmlRelativePath
  }
}
