import { resolveMediaOutputDir } from '@shared/domain'
import type { GraphNode } from '@shared/graph'
import { useProjectStore } from '../../stores/project'

/** 图执行落盘：按节点配置解析目录，写入工程并返回相对路径 */
export async function saveGraphRunMediaForNode(input: {
  dataUrl: string
  key: string
  outputDir?: string
  node: GraphNode
  hostAssetId?: string | null
  kind?: 'image' | 'video' | 'text' | 'voice'
}): Promise<string> {
  const project = useProjectStore()
  const outputDir = resolveMediaOutputDir({
    mediaOutputDir: input.outputDir ?? input.node.params.mediaOutputDir,
    cacheOutputDir: project.config?.cacheOutputDir,
    kind: input.kind ?? 'image'
  })
  // data: / http(s) 均交给主进程解析；勿在渲染进程 fetch（易被 CORS 拦下）
  const relativePath = await window.studio.saveGraphRunMedia({
    dataUrl: input.dataUrl,
    key: input.key,
    outputDir
  })
  // Cache/ 不进资产库；显式写到 Assets/ 时仍刷新
  if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
    await project.scheduleRefreshLibrary()
  }
  return relativePath
}
