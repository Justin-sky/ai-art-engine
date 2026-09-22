import { fail } from '../errors/appError'
import { SHARED_ERRORS } from '../errors/catalog'
import type { GamePlayMode } from './gameHtml'
import {
  detectGamePlayMode,
  ensureGameModeComment,
  extractGameHtml,
  validateGameHtml
} from './gameHtml'
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

/** 抽取 → 校验 → 写入 mode 头注释（Three 注入留给沙盒打开时） */
export function prepareGameHtml(raw: string, preferred: GamePlayMode = 'auto'): PreparedGameHtml {
  const extracted = extractGameHtml(raw)
  if (!extracted) {
    throw fail(SHARED_ERRORS.gameHtmlExtractFailed)
  }
  const validated = validateGameHtml(extracted, preferred)
  if (!validated.ok) {
    throw fail(SHARED_ERRORS.gameHtmlInvalid, {
      reason: validated.errors.join('; ')
    })
  }
  const html = ensureGameModeComment(extracted, validated.mode)
  return { html, mode: validated.mode, warnings: validated.warnings }
}

/** 无模型 / seed：按 preferred 或启发式给样例 */
export function seedGameHtml(preferred: GamePlayMode = 'auto'): PreparedGameHtml {
  const mode = preferred === 'auto' ? '2d' : preferred
  const html = sampleGameHtmlForMode(mode)
  return { html, mode: detectGamePlayMode(html, mode), warnings: [] }
}
