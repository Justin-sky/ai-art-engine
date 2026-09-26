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
