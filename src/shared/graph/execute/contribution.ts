import type { AssetType } from '../../domain'
import type { GraphAssetValue, GraphGenerationContribution } from './types'

function inferRole(type: AssetType): string {
  if (type === 'video') return 'motion'
  return 'character'
}

export function reindexContribution(
  genRefs: Array<{
    role: string
    assetId: string
    refIndex: number
    label?: string
    weight?: number
  }>,
  audioRefs: Array<{
    kind: string
    assetId?: string
    text?: string
    refIndex?: number
  }>
): GraphGenerationContribution {
  const visual = genRefs.map((ref, i) => ({ ...ref, refIndex: i + 1 }))
  const voiceOnly = audioRefs.filter((a) => a.kind === 'voice' && a.assetId)
  const others = audioRefs.filter((a) => a.kind !== 'voice' || !a.assetId)
  const base = visual.length
  const voices = voiceOnly.map((v, i) => ({ ...v, refIndex: base + i + 1 }))
  return { genRefs: visual, audioRefs: [...others, ...voices] }
}

export function contributionFromAssets(items: GraphAssetValue[]): GraphGenerationContribution {
  const genRefs: GraphGenerationContribution['genRefs'] = []
  const audioRefs: GraphGenerationContribution['audioRefs'] = []
  for (const item of items) {
    if (item.assetType === 'voice') {
      audioRefs.push({ kind: 'voice', assetId: item.assetId })
    } else {
      genRefs.push({
        role: inferRole(item.assetType),
        assetId: item.assetId,
        refIndex: 0,
        label: item.label,
        weight: item.weight ?? 0.85
      })
    }
  }
  return reindexContribution(genRefs, audioRefs)
}
