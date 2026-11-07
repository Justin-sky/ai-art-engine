import { timelineId } from './ids'
import { defaultEvidencePaths } from './storage'
import { SEMANTIC_TIMELINE_SCHEMA, type MediaFacts, type SemanticTimeline } from './types'

/** 空语义工程（分析前骨架） */
export function createEmptySemanticTimeline(
  sourceAssetId: string,
  facts: MediaFacts
): SemanticTimeline {
  const id = timelineId(sourceAssetId)
  const now = new Date().toISOString()
  const paths = defaultEvidencePaths(id)
  return {
    id,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: {
      assetId: sourceAssetId,
      fps: facts.fps,
      duration: facts.durationSec,
      width: facts.width,
      height: facts.height
    },
    evidence: {
      mediaFacts: facts,
      shotsPath: paths.shotsPath,
      utterancesPath: paths.utterancesPath,
      entitiesPath: paths.entitiesPath,
      ocrPath: paths.ocrPath,
      hashes: {}
    },
    entities: [],
    shots: [],
    dialogue: [],
    textLayers: [],
    speakers: [],
    edits: [],
    createdAt: now,
    updatedAt: now
  }
}
