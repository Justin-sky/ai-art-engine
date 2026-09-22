/** 可玩 HTML 生成：系统 / 用户提示词 */

const COMMON_RULES_ZH = `输出必须是完整可运行的单文件 HTML（可用 markdown html 围栏包裹）。
要求：
1. 文档头写注释 <!-- game-mode: 2d --> 或 <!-- game-mode: 3d -->（与实际实现一致）
2. 全屏 canvas；requestAnimationFrame 主循环；R 键可重置
3. 玩法需可交互（WASD / 方向键 / 鼠标至少一种），并有简单胜负或得分反馈
4. 禁止：eval、Function、parent/top、window.open、file://、require、外链大引擎 CDN（Phaser/Pixi 等）
5. 除本约定外不要解释文字，不要输出 HTML 以外的内容`

const COMMON_RULES_EN = `Output a complete runnable single-file HTML document (markdown html fence allowed).
Rules:
1. Put <!-- game-mode: 2d --> or <!-- game-mode: 3d --> in the head matching the implementation
2. Full-viewport canvas; requestAnimationFrame loop; R resets
3. Playable controls (WASD / arrows / mouse) with simple win/score feedback
4. Forbidden: eval, Function, parent/top, window.open, file://, require, CDN engines (Phaser/Pixi)
5. No commentary outside the HTML`

export const DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH = `你是前端小游戏工程师，只用原生 Canvas 2D 写单文件 HTML 小游戏。
${COMMON_RULES_ZH}
2D 专规：只用 canvas.getContext('2d')；简单几何即可；不要写 Three.js / WebGL。`

export const DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_ZH = `你是前端小游戏工程师，用 Three.js ESM 写单文件 HTML 小游戏。
${COMMON_RULES_ZH}
3D 专规：在 <head> 放占位注释 <!-- THREE_INJECT -->；用 import * as THREE from 'three'（宿主会注入本地 three，不要写 CDN script）；简单几何体即可。`

export const DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_ZH = `你是前端小游戏工程师，按用户意图选择 2D Canvas 或 3D Three.js，输出单文件 HTML 小游戏。
${COMMON_RULES_ZH}
若用 3D：头注释写 game-mode: 3d，并放 <!-- THREE_INJECT --> + import * as THREE from 'three'。
若用 2D：头注释写 game-mode: 2d，只用 Canvas 2D，不要 Three。`

export const DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_EN = `You are a frontend mini-game engineer. Build a single-file HTML game with native Canvas 2D only.
${COMMON_RULES_EN}
2D only: canvas.getContext('2d'); simple shapes; no Three.js / WebGL.`

export const DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_EN = `You are a frontend mini-game engineer. Build a single-file HTML game with Three.js ESM.
${COMMON_RULES_EN}
3D: put <!-- THREE_INJECT --> in <head>; import * as THREE from 'three' (host injects local three — no CDN script); simple meshes OK.`

export const DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_EN = `You are a frontend mini-game engineer. Choose 2D Canvas or 3D Three.js from the user intent and output a single-file HTML game.
${COMMON_RULES_EN}
3D: game-mode: 3d + <!-- THREE_INJECT --> + import * as THREE from 'three'.
2D: game-mode: 2d + Canvas 2D only.`

export function resolveGameHtmlSystemPrompt(
  mode: '2d' | '3d' | 'auto',
  raw: string | undefined,
  locale?: string
): string {
  const custom = raw?.trim()
  // 内置默认词不锁死模式：切换 2d/3d 后应跟模式走，而不是继续用旧默认全文
  if (custom && !isBuiltinGameHtmlSystemPrompt(custom)) return custom
  const en = (locale ?? '').toLowerCase().startsWith('en')
  if (mode === '2d')
    return en ? DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_EN : DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH
  if (mode === '3d')
    return en ? DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_EN : DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_ZH
  return en ? DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_EN : DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_ZH
}

/** 是否为任一内置系统提示（含空白归一后相等） */
export function isBuiltinGameHtmlSystemPrompt(raw: string | undefined | null): boolean {
  const text = raw?.trim()
  if (!text) return false
  const builtins = [
    DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_ZH,
    DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_ZH,
    DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_ZH,
    DEFAULT_GAME_HTML_SYSTEM_PROMPT_2D_EN,
    DEFAULT_GAME_HTML_SYSTEM_PROMPT_3D_EN,
    DEFAULT_GAME_HTML_SYSTEM_PROMPT_AUTO_EN
  ]
  return builtins.some((item) => item.trim() === text)
}

export function buildGameHtmlUserPrompt(
  instruction: string,
  mode: '2d' | '3d' | 'auto',
  locale?: string
): string {
  const en = (locale ?? '').toLowerCase().startsWith('en')
  const modeHint =
    mode === '2d'
      ? en
        ? 'HARD REQUIREMENT: Force 2D Canvas only (getContext("2d")). Do NOT use Three.js / WebGL. Head comment must be <!-- game-mode: 2d -->.'
        : '硬性要求：必须使用 2D Canvas（getContext("2d")），禁止 Three.js / WebGL。头注释必须为 <!-- game-mode: 2d -->。'
      : mode === '3d'
        ? en
          ? 'HARD REQUIREMENT: Force 3D Three.js ESM. Put <!-- THREE_INJECT --> in <head>, use import * as THREE from "three", and <!-- game-mode: 3d -->. Do NOT use Canvas 2D gameplay.'
          : '硬性要求：必须使用 3D Three.js ESM。在 <head> 放 <!-- THREE_INJECT -->，用 import * as THREE from "three"，头注释必须为 <!-- game-mode: 3d -->。禁止用 Canvas 2D 实现玩法。'
        : en
          ? 'Choose 2D Canvas or 3D Three.js as appropriate for the brief.'
          : '按玩法自行选择 2D Canvas 或 3D Three.js。'
  const lead = en
    ? 'Create a playable mini-game from this one-sentence brief:'
    : '根据下面一句话生成可试玩的小游戏 HTML：'
  return `${lead}\n${instruction.trim()}\n\n${modeHint}`
}
