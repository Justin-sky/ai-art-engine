/**
 * 剧集 Agent 流水线：agent-state.json 读写。
 * 文件放在工程 Cache 目录，按作用域键（通常为集编号）区分，避免不同集互相覆盖。
 */

function stateRelativePath(scopeKey: string): string {
  const safe = String(scopeKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '-')
  return `Cache/agent-state-${safe}.json`
}

export async function readEpisodeAgentState(scopeKey: string): Promise<string | null> {
  return window.studio.readProjectFile(stateRelativePath(scopeKey))
}

export async function writeEpisodeAgentState(scopeKey: string, content: string): Promise<void> {
  await window.studio.writeProjectFile({
    relativePath: stateRelativePath(scopeKey),
    content
  })
}
