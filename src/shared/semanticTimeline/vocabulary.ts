import type { BeatVocabulary } from './types'

/** 内置带货节拍词表（核心默认；市场包可替换） */
export const COMMERCE_VOCABULARY: BeatVocabulary = {
  id: 'commerce.v1',
  title: 'Commerce / 带货', // cjk-ok
  beats: [
    { type: 'hook', label: 'Hook', description: '开场痛点或悬念' }, // cjk-ok
    { type: 'problem', label: 'Problem', description: '问题放大' }, // cjk-ok
    { type: 'product-intro', label: 'Product Intro', description: '产品出场' }, // cjk-ok
    { type: 'demo', label: 'Demo', description: '演示质地/用法' }, // cjk-ok
    { type: 'proof', label: 'Proof', description: '效果/对比证明' }, // cjk-ok
    { type: 'offer', label: 'Offer', description: '价格与赠品' }, // cjk-ok
    { type: 'cta', label: 'CTA', description: '行动号召' } // cjk-ok
  ]
}

export const DRAMA_VOCABULARY: BeatVocabulary = {
  id: 'drama.v1',
  title: 'Drama / 短剧', // cjk-ok
  beats: [
    { type: 'intro', label: 'Intro' },
    { type: 'conflict', label: 'Conflict' },
    { type: 'climax', label: 'Climax' },
    { type: 'resolution', label: 'Resolution' }
  ]
}

export const BUILTIN_VOCABULARIES: BeatVocabulary[] = [COMMERCE_VOCABULARY, DRAMA_VOCABULARY]

export function findVocabulary(id: string): BeatVocabulary | undefined {
  return BUILTIN_VOCABULARIES.find((v) => v.id === id)
}

/** 按事件时间比例把事件粗分到词表节拍（无 LLM 时的兜底） */
export function assignBeatsByTimeFraction(
  durationSec: number,
  vocabulary: BeatVocabulary
): Array<{ type: string; startFrac: number; endFrac: number }> {
  const n = vocabulary.beats.length
  if (n === 0 || durationSec <= 0) return []
  return vocabulary.beats.map((b, i) => ({
    type: b.type,
    startFrac: i / n,
    endFrac: (i + 1) / n
  }))
}
