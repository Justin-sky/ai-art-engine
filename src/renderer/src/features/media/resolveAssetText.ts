import { isDraftAssetId } from '@shared/domain'
import {
  collectScreenplayTextRelativePaths,
  resolveAssetTextFromGenParams
} from '@shared/graph'
import { isTextFilePath } from '@shared/import'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import { fetchTextFromAssetRelativePath } from './assetUrlCache'

export { fetchTextFromAssetRelativePath } from './assetUrlCache'

async function fetchFirstTextFile(paths: string[]): Promise<string | undefined> {
  for (const relativePath of paths) {
    if (!isTextFilePath(relativePath)) continue
    try {
      const fromFile = (await fetchTextFromAssetRelativePath(relativePath)).trim()
      if (fromFile) return fromFile
    } catch {
      // 尝试下一路径
    }
  }
  return undefined
}

/**
 * 按资产 id 解析剧本文本。
 * 导入引用：relativePath → studio-media URL；新建剧本 / 草稿：graphJson / generatedTexts。
 */
export async function resolveAssetText(assetId: string): Promise<string | undefined> {
  if (isDraftAssetId(assetId)) {
    const draft = useDraftStore().getDraft(assetId)
    if (!draft) return undefined
    const genParams = draft.genParams as Record<string, unknown> | undefined
    const fromGraph = resolveAssetTextFromGenParams(genParams, null)
    if (fromGraph) return fromGraph
    return fetchFirstTextFile(collectScreenplayTextRelativePaths(genParams?.graphJson))
  }

  const project = useProjectStore()
  const asset = project.assets.find((item) => item.id === assetId)
  if (!asset) return undefined

  const relativePath = asset.relativePath?.trim()
  // 仅旁挂 txt/md 视为剧本正文；勿把 .asset.json 等元数据当正文读
  if (relativePath && isTextFilePath(relativePath)) {
    try {
      const fromFile = (await fetchTextFromAssetRelativePath(relativePath)).trim()
      if (fromFile) return fromFile
    } catch {
      // 旁挂文件读失败时回退 graphJson
    }
  }

  const genParams = asset.genParams as Record<string, unknown> | undefined
  const fromGraph = resolveAssetTextFromGenParams(genParams, null)
  if (fromGraph) return fromGraph

  // 正文已落盘到 generatedTexts.relativePath，params.text 可能为空
  return fetchFirstTextFile(collectScreenplayTextRelativePaths(genParams?.graphJson))
}
