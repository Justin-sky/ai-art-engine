/** 可玩 HTML：2D Canvas / 3D Three.js 单文件契约 */

export type GamePlayMode = '2d' | '3d' | 'auto'

export const GAME_MODE_COMMENT_RE = /<!--\s*game-mode\s*:\s*(2d|3d)\s*-->/i
export const THREE_INJECT_MARKER = '<!-- THREE_INJECT -->'

/** 静态 <canvas> 或 JS 动态 createElement('canvas')（Node/esbuild 脚手架常用后者） */
export function hasPlayableCanvas(html: string): boolean {
  return /<canvas[\s>]/i.test(html) || /createElement\s*\(\s*['"]canvas['"]\s*\)/i.test(html)
}

/** Three / WebGL 线索；esbuild 打包后通常仍保留 WebGLRenderer 等标识字符串 */
export function hasThreeClue(html: string): boolean {
  if (html.includes(THREE_INJECT_MARKER)) return true
  return /THREE_INJECT|from\s+['"]three['"]|three\.module|WebGLRenderer|PerspectiveCamera|WebGLRenderTarget|MeshStandardMaterial|BufferGeometry|THREE\./i.test(
    html
  )
}

/** 从模型输出中抽出完整 HTML 文档 */
export function extractGameHtml(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  const fences = [...text.matchAll(/```([^\n`]*)\n?([\s\S]*?)```/g)].map((m) => ({
    lang: (m[1] ?? '').trim().toLowerCase(),
    body: (m[2] ?? '').trim()
  }))

  const scored = fences
    .map((f) => {
      let score = 0
      if (f.lang === 'html' || f.lang === 'htm') score += 100
      if (/<!doctype\s+html|<html[\s>]/i.test(f.body)) score += 50
      if (/<canvas[\s>]/i.test(f.body)) score += 20
      if (/<script[\s>]/i.test(f.body)) score += 10
      return { ...f, score }
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || b.body.length - a.body.length)

  const fromFence = scored[0]?.body
  const candidate = (fromFence ?? text).trim()
  if (!candidate) return null

  if (!/<html[\s>]/i.test(candidate) && !/<!doctype\s+html/i.test(candidate)) {
    // 允许只有 fragment：包一层壳
    if (/<canvas[\s>]/i.test(candidate) || /<script[\s>]/i.test(candidate)) {
      return wrapHtmlFragment(candidate)
    }
    return null
  }
  return candidate
}

function wrapHtmlFragment(body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- game-mode: 2d -->
<title>Game</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#111}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
${body}
</body>
</html>`
}

/**
 * 解析头注释或启发式判定 2d/3d。
 * preferred 仅作偏好：内容无 Three 线索时不把 3d 偏好/注释硬判成 3d
 * （cook 后的 Node 工程常保留脚手架 `game-mode: 3d` 注释，但 agent 已改成 2D）。
 */
export function detectGamePlayMode(html: string, preferred: GamePlayMode = 'auto'): '2d' | '3d' {
  const content3d = hasThreeClue(html)
  if (preferred === '2d') return '2d'
  if (preferred === '3d') return content3d ? '3d' : '2d'
  if (content3d) return '3d'
  const m = html.match(GAME_MODE_COMMENT_RE)
  if (m?.[1]?.toLowerCase() === '3d') return '2d' // 注释过时、无 Three → 按 2d
  if (m?.[1]) return '2d'
  return '2d'
}

export interface ValidateGameHtmlResult {
  ok: boolean
  mode: '2d' | '3d'
  errors: string[]
  warnings: string[]
}

/** 轻量校验：结构 / 模式线索；不做危险 API 启发式拦截（cook 后的 Three 打包体易误杀） */
export function validateGameHtml(
  html: string,
  preferred: GamePlayMode = 'auto'
): ValidateGameHtmlResult {
  const errors: string[] = []
  const warnings: string[] = []
  const mode = detectGamePlayMode(html, preferred)

  if (!hasPlayableCanvas(html)) {
    // 3D 偶发完全由库内部建 canvas；有 Three 线索即可
    if (!(mode === '3d' && hasThreeClue(html))) {
      errors.push('缺少 <canvas>')
    }
  }
  if (/phaser|pixi\.js|from\s+['"]pixi/i.test(html)) {
    warnings.push('检测到 Phaser/Pixi 外链倾向；v1 建议原生 Canvas / Three')
  }
  if (preferred === '3d' && mode === '2d') {
    warnings.push('偏好 3D 但产物无 Three 线索，已按 2D 受理')
  }
  if (mode === '3d' && !hasThreeClue(html)) {
    errors.push('3D 模式需要 Three 引用或 <!-- THREE_INJECT -->')
  }

  return { ok: errors.length === 0, mode, errors, warnings }
}

/**
 * three.module 含 `from "./three.core.min.js"`；把其作为 data: URL 注入时，
 * 相对路径无法解析（base scheme 非 hierarchical）。把相对导入改写成 core 的绝对 data URL。
 */
export function rewriteThreeCoreRelativeImports(
  threeModuleSource: string,
  threeCoreSource: string
): string {
  const core = threeCoreSource.trim()
  if (!core) return threeModuleSource
  const coreDataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(core)
  return threeModuleSource.replace(/(["'])\.\/three\.core(?:\.min)?\.js\1/g, () =>
    JSON.stringify(coreDataUrl)
  )
}

/**
 * 将本地 three.module 源码注入为 importmap data URL，并替换 CDN / 占位。
 * 仅 3D 使用；threeModuleSource 为 three.module.js（或 .min）全文。
 * 传入 threeCoreSource（three.core.min.js）时改写相对导入，避免 data: 基址下解析失败。
 */
export function injectThreeIntoHtml(
  html: string,
  threeModuleSource: string,
  threeCoreSource = ''
): string {
  const moduleSrc = rewriteThreeCoreRelativeImports(threeModuleSource, threeCoreSource)
  const dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(moduleSrc)
  const importMap = `<script type="importmap">
{"imports":{"three":${JSON.stringify(dataUrl)}}}
</script>`

  let next = html
  // 去掉常见 CDN script，避免双加载
  next = next.replace(/<script[^>]+src=["'][^"']*three[^"']*["'][^>]*>\s*<\/script>/gi, '')
  if (next.includes(THREE_INJECT_MARKER)) {
    next = next.replace(THREE_INJECT_MARKER, `${THREE_INJECT_MARKER}\n${importMap}`)
  } else if (/<\/head>/i.test(next)) {
    next = next.replace(/<\/head>/i, `${importMap}\n</head>`)
  } else {
    next = `${importMap}\n${next}`
  }

  // 保证至少有一处 ESM import 提示：若全文无 from 'three'，在 body 末尾不强制改用户代码
  return next
}

export function ensureGameModeComment(html: string, mode: '2d' | '3d'): string {
  if (GAME_MODE_COMMENT_RE.test(html)) {
    return html.replace(GAME_MODE_COMMENT_RE, `<!-- game-mode: ${mode} -->`)
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (h) => `${h}\n<!-- game-mode: ${mode} -->`)
  }
  return `<!-- game-mode: ${mode} -->\n${html}`
}
