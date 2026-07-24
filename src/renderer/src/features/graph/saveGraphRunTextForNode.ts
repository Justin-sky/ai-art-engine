import { resolveMediaOutputDir } from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import type { GraphNode } from '@shared/graph'
import { useProjectStore } from '../../stores/project'

function resolveNodeOwnerAsset(node: GraphNode, hostAssetId?: string | null) {
  const project = useProjectStore()
  if (node.assetId) {
    const bound = project.assets.find((a) => a.id === node.assetId)
    if (bound) return bound
  }
  if (hostAssetId) {
    return project.assets.find((a) => a.id === hostAssetId) ?? null
  }
  return null
}

/** 图执行剧本落盘：按节点配置 / 宿主资产解析目录，写入工程并返回相对路径 */
export async function saveGraphRunTextForNode(input: {
  content: string
  key: string
  outputDir?: string
  node: GraphNode
  hostAssetId?: string | null
}): Promise<string> {
  const project = useProjectStore()
  const host = resolveNodeOwnerAsset(input.node, input.hostAssetId)
  const dirs = assetMediaHostDirs(host, project.folders)
  const outputDir = resolveMediaOutputDir({
    mediaOutputDir: input.outputDir ?? input.node.params.mediaOutputDir,
    hostRelativePath: dirs.hostRelativePath,
    hostFolderDir: dirs.hostFolderDir,
    hostAssetName: dirs.hostAssetName,
    kind: 'text'
  })
  const relativePath = await window.studio.saveGraphRunText({
    content: input.content,
    key: input.key,
    outputDir
  })
  await project.scheduleRefreshLibrary()
  return relativePath
}
