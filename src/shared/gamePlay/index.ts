export {
  detectGamePlayMode,
  ensureGameModeComment,
  extractGameHtml,
  gameHtmlBrowserIssue,
  hasPlayableCanvas,
  hasThreeClue,
  injectThreeIntoHtml,
  rewriteThreeCoreRelativeImports,
  THREE_INJECT_MARKER,
  validateGameHtml,
  type GameHtmlBrowserIssue,
  type GamePlayMode,
  type ValidateGameHtmlResult
} from './gameHtml'
export { SAMPLE_GAME_HTML_2D, SAMPLE_GAME_HTML_3D } from './sampleGames'
export {
  prepareGameHtml,
  resolvePreferredGamePlayMode,
  sampleGameHtmlForMode,
  seedGameHtml,
  type PreparedGameHtml
} from './prepare'
export {
  buildGameHtmlUserPrompt,
  resolveGameHtmlSystemPrompt,
  isBuiltinGameHtmlSystemPrompt,
  DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH,
  DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_ZH,
  DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_ZH
} from './prompts'

export {
  GAME_PLAY_DSH_TIMEOUT_MS,
  buildGamePlayJobBrief,
  buildGamePlayJobTask,
  parseGamePlayJobResult,
  validateGamePlayJobDelivery,
  gamePlayDshError
} from '../gamePlayDshJob'
