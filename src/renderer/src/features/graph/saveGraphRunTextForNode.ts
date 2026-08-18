import { resolveMediaOutputDir } from '@shared/domain'
import type { GraphNode } from '@shared/graph'
import { useProjectStore } from '../../stores/project'

/** 图执行剧本落盘：按节点配置解析目录，写入工程并返回相对路径 */
export async function saveGraphRunTextForNode(input: {
  content: string
  key: string
  outputDir?: string
  node: GraphNode
  hostAssetId?: string | null
}): Promise<string> {
  const project = useProjectStore()
  const outputDir = resolveMediaOutputDir({
    mediaOutputDir: input.outputDir ?? input.node.params.mediaOutputDir,
    cacheOutputDir: project.config?.cacheOutputDir,
    kind: 'text'
  })
  const relativePath = await window.studio.saveGraphRunText({
    content: input.content,
    key: input.key,
    outputDir
  })
  if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
    await project.scheduleRefreshLibrary()
  }
  return relativePath
}
