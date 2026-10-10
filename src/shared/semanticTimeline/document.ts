import { timelineId } from './ids'
import { defaultEvidencePaths } from './storage'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  type MediaFacts,
  type SemanticTimeline,
  type SemanticTrackKind
} from './types'

const EMPTY_TRACKS: SemanticTrackKind[] = [
  'story',
  'character',
  'camera',
  'emotion',
  'audio',
  'text',
  'vfx',
  'edit'
]

/** 空语义工程（分析前骨架） */
export function createEmptySemanticTimeline(
  sourceAssetId: string,
  facts: MediaFacts,
  vocabulary = 'commerce.v1'
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
    events: [],
    beats: [],
    intents: [],
    tracks: EMPTY_TRACKS.map((kind) => ({ kind, items: [] })),
    edits: [],
    vocabulary,
    createdAt: now,
    updatedAt: now
  }
}

/** 重建 tracks.items 索引（从 events/beats/intents） */
export function rebuildTracks(doc: SemanticTimeline): SemanticTimeline {
  const tracks = EMPTY_TRACKS.map((kind) => ({ kind, items: [] as string[] }))
  const byKind = Object.fromEntries(tracks.map((t) => [t.kind, t])) as Record<
    SemanticTrackKind,
    { kind: SemanticTrackKind; items: string[] }
  >
  for (const beat of doc.beats) byKind.story.items.push(beat.id)
  for (const ent of doc.entities) {
    if (ent.kind === 'person') byKind.character.items.push(ent.id)
  }
  for (const intent of doc.intents) {
    for (const tech of intent.techniques) {
      byKind[tech.track]?.items.push(intent.id)
    }
  }
  for (const ev of doc.events) {
    if (ev.type === 'emotion') byKind.emotion.items.push(ev.id)
    if (ev.type === 'audio') byKind.audio.items.push(ev.id)
    if (ev.type === 'text') byKind.text.items.push(ev.id)
    if (ev.type === 'camera') byKind.camera.items.push(ev.id)
  }
  // 去重
  for (const t of tracks) t.items = [...new Set(t.items)]
  return { ...doc, tracks, updatedAt: new Date().toISOString() }
}
