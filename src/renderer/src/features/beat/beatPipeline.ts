/**
 * 场图管道：从各单元 beatUnit 子图收集「场输出」文本。
 * 不级联跑单元子图中的生成节点；需在底栏细化侧先行跑完。
 */
import { isDraftAssetId } from '@shared/domain'
import {
  collectTextFromBeatGraph,
  normalizeScopedGraph,
  readBeatGraphFromGenParams,
  type GraphTextItem
} from '@shared/graph'
import { readGraphRunText } from '../graph/readGraphRunText'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import { loadBeatCatalog } from './applyBeatCatalogOnOpen'

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('GRAPH_CANCELLED')
    err.name = 'AbortError'
    throw err
  }
}

function readBeatGenParams(
  beatAssetId: string
): Record<string, unknown> | undefined {
  if (isDraftAssetId(beatAssetId)) {
    return useDraftStore().getDraft(beatAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === beatAssetId)?.genParams as
    | Record<string, unknown>
    | undefined
}

async function hydrateTextItem(item: GraphTextItem): Promise<GraphTextItem> {
  if (item.text?.trim()) return item
  const relativePath = item.relativePath?.trim()
  if (!relativePath) return item
  const text = await readGraphRunText(relativePath)
  return text ? { ...item, text } : item
}

export type CollectBeatUnitTextsResult = {
  items: GraphTextItem[]
}

/**
 * 按目录顺序收集各单元细化图已有文本输出（不级联跑生成）。
 */
export async function collectBeatUnitTexts(input: {
  beatAssetId: string
  signal?: AbortSignal
}): Promise<CollectBeatUnitTextsResult> {
  const rows = loadBeatCatalog(input.beatAssetId)
  const genParams = readBeatGenParams(input.beatAssetId) ?? {}
  const items: GraphTextItem[] = []

  for (const row of rows) {
    assertNotAborted(input.signal)
    const raw = readBeatGraphFromGenParams(genParams, row.id)
    const doc = normalizeScopedGraph('beatUnit', raw ?? null, {
      assetType: 'beat'
    })
    const collected = collectTextFromBeatGraph(doc)
    if (!collected) continue

    const hydrated = await hydrateTextItem(collected)
    if (!hydrated.text.trim() && !hydrated.relativePath?.trim()) continue

    items.push({
      ...hydrated,
      id: row.id,
      title: row.title.trim() || hydrated.title || row.id
    })
  }

  return { items }
}
