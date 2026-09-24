/**
 * 导演台 AI 白模：经 dsh 多轮 agent 读参考图并写出 build_scene 结果。
 * 交付物是 result.json（objects[]）；舞台应用仍由渲染端 applySceneBlockoutObjects。
 */

export const BLOCKOUT_DSH_SKILL_HINT = 'director.blockout'
export const BLOCKOUT_DSH_TIMEOUT_MS = 1_800_000
export const BLOCKOUT_JOB_ROOT = 'Cache/BlockoutJobs'
export const MAX_BLOCKOUT_DSH_REFS = 3

export interface BlockoutJobResult {
  ok: boolean
  error?: string
  summary?: string
  /** 原始 objects 数组（交给渲染端 parse / fix / apply） */
  objects?: unknown[]
}

export interface BlockoutJobBriefInput {
  instruction: string
  locale?: string
  layoutMode: 'perspective' | 'panorama'
  /** 完整 system 规则（几何目录 / 透视或全景） */
  systemPrompt: string
  /** 用户侧上下文（指令、相机、深度提示等） */
  userPrompt: string
  resultAbs: string
  briefAbs: string
  /** 工程相对路径，如 Cache/BlockoutJobs/<id>/refs/0.png */
  refRelativePaths: string[]
}

export function blockoutDshError(code: string): string {
  return `DIRECTOR_BLOCKOUT_${code}`
}

export function buildBlockoutJobBrief(input: BlockoutJobBriefInput): string {
  const locale = input.locale?.trim() || 'zh-CN'
  const refs =
    input.refRelativePaths.length > 0
      ? input.refRelativePaths.map((p, i) => `- ref ${i + 1}: @${p}`).join('\n')
      : '- (no reference images)'
  return [
    '# Director stage AI blockout job (multi-turn dsh)',
    '',
    `Locale: ${locale}`,
    `Layout mode: ${input.layoutMode}`,
    `Write result JSON (absolute): ${input.resultAbs}`,
    `Brief path: ${input.briefAbs}`,
    '',
    '## Reference images (also attached via @paths in the task)',
    refs,
    '',
    '## System rules (must follow)',
    input.systemPrompt.trim() || '(none)',
    '',
    '## User context',
    input.userPrompt.trim() || '(none)',
    '',
    '## Hard rules',
    '- Study the reference images carefully across multiple turns if needed (depth layers, occlusion, proportions).',
    '- Rebuild the scene with ONLY the allowed stage primitives from the system rules.',
    '- Do NOT call generate_image / generate_video / MCP media tools. Do NOT create GLB files.',
    '- Do NOT invent CDN / http(s) asset URLs.',
    '- When finished, overwrite the result JSON path with exactly:',
    '  {"ok":true,"summary":"one line","objects":[...]}',
    '  where `objects` matches the build_scene arguments.objects schema in the system rules.',
    '- On failure write {"ok":false,"error":"..."}.',
    '- Do not wrap the JSON in markdown fences.',
    ''
  ].join('\n')
}

export function buildBlockoutJobTask(input: BlockoutJobBriefInput): string {
  const atRefs = input.refRelativePaths.map((p) => `@${p}`).join(' ')
  return [
    'Build a director-stage AI blockout (white-model) scene from the reference images.',
    `Read the brief file: ${input.briefAbs}`,
    `When finished, write result JSON to: ${input.resultAbs}`,
    'Follow the brief hard rules. Multi-turn analysis is encouraged; deliver one final result.json.',
    '',
    atRefs ? `Reference images: ${atRefs}` : 'Reference images: (none)',
    '',
    'User instruction:',
    input.instruction.trim() || '(none)'
  ].join('\n')
}

export function parseBlockoutJobResult(raw: string): BlockoutJobResult | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    const objects = Array.isArray(data.objects) ? data.objects : undefined
    // 兼容直接写出 build_scene function-call
    let nestedObjects = objects
    let summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 200) : undefined
    if (!nestedObjects && data.arguments && typeof data.arguments === 'object') {
      const args = data.arguments as Record<string, unknown>
      if (Array.isArray(args.objects)) nestedObjects = args.objects
      if (!summary && typeof args.summary === 'string') {
        summary = args.summary.trim().slice(0, 200)
      }
    }
    const ok =
      data.ok === true ||
      (data.ok !== false && Array.isArray(nestedObjects) && nestedObjects.length > 0)
    return {
      ok,
      ...(typeof data.error === 'string' ? { error: data.error } : {}),
      ...(summary ? { summary } : {}),
      ...(nestedObjects ? { objects: nestedObjects } : {})
    }
  } catch {
    return null
  }
}

export function validateBlockoutJobDelivery(result: BlockoutJobResult | null): string | null {
  if (!result) return blockoutDshError('RESULT')
  if (!result.ok) return result.error || blockoutDshError('FAILED')
  if (!result.objects?.length) return blockoutDshError('NO_OBJECTS')
  return null
}
