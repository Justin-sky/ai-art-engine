/**
 * 叙事单元图管道：从各单元 narrativeUnit 子图收集「叙事输出」文本。
 * 不级联跑单元子图中的生成节点；需在底栏细化侧先行跑完。
 */
import { isDraftAssetId } from '@shared/domain'
import {
  collectTextFromNarrativeUnitGraph,
  normalizeScopedGraph,
  readNarrativeUnitGraphFromGenParams,
  type GraphTextItem
} from '@shared/graph'
import { readGraphRunText } from '../graph/readGraphRunText'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'
import { loadNarrativeCatalog } from './applyNarrativeCatalogOnOpen'

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('GRAPH_CANCELLED')
    err.name = 'AbortError'
    throw err
  }
}

function readNarrativeGenParams(
  narrativeAssetId: string
): Record<string, unknown> | undefined {
  if (isDraftAssetId(narrativeAssetId)) {
    return useDraftStore().getDraft(narrativeAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === narrativeAssetId)?.genParams as
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

export type CollectNarrativeUnitTextsResult = {
  items: GraphTextItem[]
}

/**
 * 按目录顺序收集各单元细化图已有文本输出（不级联跑生成）。
 */
export async function collectNarrativeUnitTexts(input: {
  narrativeAssetId: string
  signal?: AbortSignal
}): Promise<CollectNarrativeUnitTextsResult> {
  const rows = loadNarrativeCatalog(input.narrativeAssetId)
  const genParams = readNarrativeGenParams(input.narrativeAssetId) ?? {}
  const items: GraphTextItem[] = []

  for (const row of rows) {
    assertNotAborted(input.signal)
    const raw = readNarrativeUnitGraphFromGenParams(genParams, row.id)
    const doc = normalizeScopedGraph('narrativeUnit', raw ?? null, {
      assetType: 'narrative'
    })
    const collected = collectTextFromNarrativeUnitGraph(doc)
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
