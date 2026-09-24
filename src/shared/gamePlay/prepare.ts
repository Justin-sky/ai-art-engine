import { fail } from '../errors/appError'
import { SHARED_ERRORS } from '../errors/catalog'
import type { GamePlayMode } from './gameHtml'
import { detectGamePlayMode, ensureGameModeComment, extractGameHtml } from './gameHtml'
import { SAMPLE_GAME_HTML_2D, SAMPLE_GAME_HTML_3D } from './sampleGames'

export function sampleGameHtmlForMode(mode: '2d' | '3d'): string {
  return mode === '3d' ? SAMPLE_GAME_HTML_3D : SAMPLE_GAME_HTML_2D
}

export function resolvePreferredGamePlayMode(raw: unknown): GamePlayMode {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (v === '2d' || v === '3d' || v === 'auto') return v
  return 'auto'
}

export interface PreparedGameHtml {
  html: string
  mode: '2d' | '3d'
  warnings: string[]
}

/**
 * 抽取 HTML → 判定 mode → 写入头注释。
 * 不做结构硬校验：Node/esbuild 打包体常用动态 canvas、压缩 Three，硬规则易误杀 cook。
 */
export function prepareGameHtml(raw: string, preferred: GamePlayMode = 'auto'): PreparedGameHtml {
  const extracted = extractGameHtml(raw)
  if (!extracted) {
    throw fail(SHARED_ERRORS.gameHtmlExtractFailed)
  }
  const mode = detectGamePlayMode(extracted, preferred)
  const html = ensureGameModeComment(extracted, mode)
  return { html, mode, warnings: [] }
}

/** 无模型 / seed：按 preferred 或启发式给样例 */
export function seedGameHtml(preferred: GamePlayMode = 'auto'): PreparedGameHtml {
  const mode = preferred === 'auto' ? '2d' : preferred
  const html = sampleGameHtmlForMode(mode)
  return { html, mode: detectGamePlayMode(html, mode), warnings: [] }
}
