/**
 * 可玩 HTML：经 dsh 多轮 agent 生成纯 Node（esbuild）工程的作业契约。
 * 结构对齐 pelican-bike：package.json / build.mjs / index.template.html / src/*.js
 * 交付物是 project/ + result.json；单文件 HTML 由宿主 cook（npm install + node build.mjs）产出。
 * @see https://github.com/riba2534/claude-opus-5-5-demo/tree/main/pelican-bike
 */

export const GAME_PLAY_DSH_SKILL_HINT = 'gameplay.nodeEsbuild'
export const GAME_PLAY_DSH_TIMEOUT_MS = 3_600_000
/** 工程根下存放可玩 HTML 作业的目录；与对话路径的 `gamePlayJob.ts` 共用同一份常量 */
export { GAME_PLAY_PROJECT_ROOT as GAME_PLAY_JOB_ROOT } from './gamePlayJob'

export type GamePlayDshMode = '2d' | '3d' | 'auto'

export interface GamePlayJobResult {
  ok: boolean
  error?: string
  /** 相对 project 根的入口模板，默认 index.template.html */
  entry?: string
  /** 2d | 3d */
  gameMode?: '2d' | '3d'
}

export interface GamePlayJobBriefInput {
  instruction: string
  locale?: string
  preferredMode: GamePlayDshMode
  projectAbs: string
  resultAbs: string
  briefAbs: string
  referenceNote?: string
  /** 在既有工程目录上继续改，不重建脚手架 */
  resume?: boolean
}

export function gamePlayDshError(code: string): string {
  return `GRAPH_GAMEPLAY_${code}`
}

export function buildGamePlayJobBrief(input: GamePlayJobBriefInput): string {
  const locale = input.locale?.trim() || 'zh-CN'
  const modeHint =
    input.preferredMode === '2d'
      ? 'Prefer Canvas 2D (no three). Keep package.json deps to esbuild only.'
      : input.preferredMode === '3d'
        ? 'Prefer Three.js via npm dependency `three` (import from "three" in src/).'
        : 'Choose Canvas 2D or Three.js from the brief; add `three` only if 3D.'
  const resumeBlock = input.resume
    ? [
        '## Resume',
        '- CONTINUE the existing project in place. Do NOT recreate or wipe the scaffold.',
        '- Keep working files under src/; update index.template.html only if needed (preserve /*APP_JS*/).',
        '- Apply the latest user instruction as an incremental change on top of current code.',
        ''
      ]
    : []
  return [
    `# Playable HTML job (pure Node + esbuild)${input.resume ? ' — resume' : ''}`,
    '',
    `Locale: ${locale}`,
    `Preferred mode: ${input.preferredMode}`,
    `Project directory (absolute): ${input.projectAbs}`,
    `Write result JSON (absolute): ${input.resultAbs}`,
    `Brief path: ${input.briefAbs}`,
    '',
    '## User instruction',
    input.instruction.trim() || '(none)',
    '',
    ...(input.referenceNote?.trim() ? ['## References', input.referenceNote.trim(), ''] : []),
    ...resumeBlock,
    '## Project layout (like pelican-bike)',
    '- package.json — type:module; scripts.build = "node build.mjs"; deps: esbuild (+ three if 3D)',
    '- build.mjs — esbuild bundles src/main.js as IIFE, injects into index.template.html at /*APP_JS*/, writes dist/index.html',
    '- index.template.html — HTML/CSS shell with /*APP_JS*/ placeholder (no CDN script tags)',
    '- src/main.js — entry; split helpers into src/*.js and import them',
    '',
    '## Hard rules',
    '- Pure Node.js project: NO React / Vue / Vite / Webpack / TypeScript / Phaser / Pixi.',
    '- Allowed: plain ES modules under src/, Canvas 2D, and optionally `three` + `esbuild` from npm.',
    '- Do NOT call npm install / npm run build / node build.mjs. The host app builds later.',
    '- No CDN scripts, no external http(s) asset URLs, no eval / new Function / parent / top / window.open / file://.',
    '- If using raw WebGL1 GLSL with dFdx/dFdy/fwidth, put `#extension GL_OES_standard_derivatives : enable` at the top of that fragment shader (before precision).',
    '- Full-viewport playable mini-game with rAF loop; R resets; keyboard or mouse controls; simple score or win/lose.',
    `- ${modeHint}`,
    '- Keep the /*APP_JS*/ marker in index.template.html so build.mjs can inject the bundle.',
    '- When done, write result.json exactly to the result path:',
    '  {"ok":true,"entry":"index.template.html","gameMode":"2d"|"3d"}',
    '- On failure write {"ok":false,"error":"..."}.',
    ''
  ].join('\n')
}

export function buildGamePlayJobTask(input: GamePlayJobBriefInput): string {
  const lead = input.resume
    ? 'CONTINUE editing the existing pure Node + esbuild mini-game project (same directory as last run). Do not recreate the scaffold.'
    : 'Implement a playable mini-game in the prepared pure Node + esbuild project (pelican-bike style).'
  return [
    lead,
    `Project directory: ${input.projectAbs}`,
    `Read the brief file: ${input.briefAbs}`,
    `When finished, write result JSON to: ${input.resultAbs}`,
    'Do not run npm or build.mjs. Follow the brief hard rules. No React/Vite.',
    '',
    'User instruction:',
    input.instruction.trim() || '(none)'
  ].join('\n')
}

export function parseGamePlayJobResult(raw: string): GamePlayJobResult | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    const ok = data.ok === true
    const gameMode = data.gameMode === '2d' || data.gameMode === '3d' ? data.gameMode : undefined
    return {
      ok,
      ...(typeof data.error === 'string' ? { error: data.error } : {}),
      ...(typeof data.entry === 'string' ? { entry: data.entry } : {}),
      ...(gameMode ? { gameMode } : {})
    }
  } catch {
    return null
  }
}

/** 验收 result.json + 工程入口模板是否存在 */
export function validateGamePlayJobDelivery(input: {
  result: GamePlayJobResult | null
  projectIndexExists: boolean
}): string | null {
  if (!input.projectIndexExists) return gamePlayDshError('NO_ENTRY')
  if (!input.result) return gamePlayDshError('RESULT')
  if (!input.result.ok) return input.result.error || gamePlayDshError('FAILED')
  return null
}
