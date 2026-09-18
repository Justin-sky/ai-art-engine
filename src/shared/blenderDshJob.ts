/**
 * 图节点经 dsh 调度 Blender MCP 的作业契约。
 * LLM 只指挥工具；交付物是导出的 GLB + result.json，不是猜出来的欧拉表。
 */
import type { StageVec3 } from './domain'

export type BlenderDshJobKind = 'rig' | 'pose' | 'anim'

export interface BlenderJobRigMeta {
  armature: string
  bones: string[]
  vertexGroups: string[]
  presetId?: string
}

export interface BlenderJobClip {
  name: string
  fps: number
  frameRange: [number, number]
  keyframes: Record<string, Record<number, [number, number, number]>>
  presetId?: string
}

export interface BlenderJobResult {
  ok: boolean
  error?: string
  kind: BlenderDshJobKind
  exportedPath?: string
  rigMeta?: BlenderJobRigMeta
  bonePose?: Record<string, StageVec3>
  clip?: BlenderJobClip
  qa?: { screenshots?: string[]; notes?: string }
}

export interface BlenderJobBriefInput {
  kind: BlenderDshJobKind
  instruction: string
  locale?: string
  inputAbs: string
  outputAbs: string
  resultAbs: string
  skillId: string
}

export const BLENDER_DSH_SKILL_ID: Record<BlenderDshJobKind, string> = {
  rig: 'blender.rigSkin',
  pose: 'blender.pose',
  anim: 'blender.animation'
}

export const BLENDER_DSH_TIMEOUT_MS: Record<BlenderDshJobKind, number> = {
  rig: 6_000_000,
  pose: 3_600_000,
  anim: 7_200_000
}

export function blenderDshError(kind: BlenderDshJobKind, code: string): string {
  if (kind === 'rig') return `GRAPH_MODEL_RIG_${code}`
  if (kind === 'anim') return `GRAPH_MODEL_ANIM_${code}`
  return `GRAPH_MODEL_POSE_${code}`
}

export const BLENDER_JOB_META_PREFIX = 'AIAE_JOB_META:'

/**
 * 收尾时由主进程执行：从当前 Blender 场景读 armature / pose / action。
 * 禁止 open()——safe mode 会拦，overlay 由本进程写 result.json。
 */
export const BLENDER_JOB_READBACK_CODE = [
  'import bpy',
  'import json',
  "meta = {'ok': False, 'rigMeta': {}, 'bonePose': {}, 'clip': {}}",
  "arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']",
  'if arms:',
  '    arm = arms[0]',
  '    names = [b.name for b in arm.data.bones]',
  '    groups = []',
  '    for obj in bpy.data.objects:',
  "        if obj.type == 'MESH':",
  '            for g in obj.vertex_groups:',
  '                groups.append(g.name)',
  '    meta["ok"] = len(names) > 0',
  "    meta['rigMeta'] = {'armature': arm.name, 'bones': names, 'vertexGroups': groups}",
  '    pose = {}',
  '    if arm.pose:',
  '        for pb in arm.pose.bones:',
  '            e = pb.rotation_euler',
  "            pose[pb.name] = {'x': float(e.x), 'y': float(e.y), 'z': float(e.z)}",
  "    meta['bonePose'] = pose",
  '    acts = list(bpy.data.actions)',
  '    if acts:',
  '        a = acts[0]',
  '        fps = int(bpy.context.scene.render.fps)',
  '        if fps < 1:',
  '            fps = 24',
  '        start = int(bpy.context.scene.frame_start)',
  '        end = int(bpy.context.scene.frame_end)',
  "        meta['clip'] = {'name': a.name, 'fps': fps, 'frameRange': [start, end], 'keyframes': {}}",
  `print('${BLENDER_JOB_META_PREFIX}' + json.dumps(meta, separators=(',', ':')))`
].join('\n')

export function blenderExecuteStdout(result: unknown): string {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  const rec = result as Record<string, unknown>
  if (typeof rec.result === 'string') return rec.result
  if (rec.result && typeof rec.result === 'object') {
    const inner = rec.result as Record<string, unknown>
    if (typeof inner.result === 'string') return inner.result
    if (typeof inner.stdout === 'string') return inner.stdout
  }
  if (typeof rec.stdout === 'string') return rec.stdout
  return ''
}

export function parseBlenderJobMetaLine(
  text: string,
  kind: BlenderDshJobKind
): BlenderJobResult | undefined {
  const idx = text.lastIndexOf(BLENDER_JOB_META_PREFIX)
  if (idx < 0) return undefined
  const after = text.slice(idx + BLENDER_JOB_META_PREFIX.length)
  const start = after.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let end = -1
  for (let i = start; i < after.length; i++) {
    const ch = after[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return undefined
  return parseBlenderJobResult(after.slice(start, end + 1), kind)
}

export function blenderJobOverlayReady(kind: BlenderDshJobKind, result: BlenderJobResult): boolean {
  if (kind === 'rig') return !!result.rigMeta?.bones.length
  if (kind === 'pose') return !!result.bonePose && Object.keys(result.bonePose).length > 0
  return !!result.clip?.name
}

export function mergeBlenderJobOverlay(
  base: BlenderJobResult,
  extra: BlenderJobResult | undefined
): BlenderJobResult {
  if (!extra) return base
  const merged: BlenderJobResult = {
    ...base,
    exportedPath: extra.exportedPath || base.exportedPath,
    rigMeta: extra.rigMeta?.bones.length ? extra.rigMeta : base.rigMeta,
    bonePose:
      extra.bonePose && Object.keys(extra.bonePose).length ? extra.bonePose : base.bonePose,
    clip: extra.clip?.name ? extra.clip : base.clip
  }
  if (blenderJobOverlayReady(merged.kind, merged)) {
    merged.ok = true
    delete merged.error
  }
  return merged
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function parseBonePose(raw: unknown): Record<string, StageVec3> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, StageVec3> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = name.trim()
    if (!key) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>
      const x = asFiniteNumber(rec.x)
      const y = asFiniteNumber(rec.y)
      const z = asFiniteNumber(rec.z)
      if (x == null || y == null || z == null) continue
      if (x === 0 && y === 0 && z === 0) continue
      out[key] = { x, y, z }
      continue
    }
    if (Array.isArray(value) && value.length >= 3) {
      const x = asFiniteNumber(value[0])
      const y = asFiniteNumber(value[1])
      const z = asFiniteNumber(value[2])
      if (x == null || y == null || z == null) continue
      if (x === 0 && y === 0 && z === 0) continue
      out[key] = { x, y, z }
    }
  }
  return Object.keys(out).length ? out : undefined
}

function parseRigMeta(raw: unknown): BlenderJobRigMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const armature = typeof rec.armature === 'string' ? rec.armature.trim() : ''
  const bones = Array.isArray(rec.bones)
    ? rec.bones.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const vertexGroups = Array.isArray(rec.vertexGroups)
    ? rec.vertexGroups.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0
      )
    : []
  if (!armature && !bones.length) return undefined
  const presetId = typeof rec.presetId === 'string' ? rec.presetId.trim() : ''
  return {
    armature,
    bones,
    vertexGroups,
    ...(presetId ? { presetId } : {})
  }
}

function parseClip(raw: unknown): BlenderJobClip | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  const fps = asFiniteNumber(rec.fps) ?? 24
  const rangeRaw = rec.frameRange
  const frameRange: [number, number] =
    Array.isArray(rangeRaw) && rangeRaw.length >= 2
      ? [asFiniteNumber(rangeRaw[0]) ?? 1, asFiniteNumber(rangeRaw[1]) ?? 24]
      : [1, 24]
  const keyframes: BlenderJobClip['keyframes'] = {}
  if (rec.keyframes && typeof rec.keyframes === 'object' && !Array.isArray(rec.keyframes)) {
    for (const [bone, frames] of Object.entries(rec.keyframes as Record<string, unknown>)) {
      if (!frames || typeof frames !== 'object' || Array.isArray(frames)) continue
      const mapped: Record<number, [number, number, number]> = {}
      for (const [frame, triple] of Object.entries(frames as Record<string, unknown>)) {
        const f = Number(frame)
        if (!Number.isFinite(f) || !Array.isArray(triple) || triple.length < 3) continue
        const x = asFiniteNumber(triple[0])
        const y = asFiniteNumber(triple[1])
        const z = asFiniteNumber(triple[2])
        if (x == null || y == null || z == null) continue
        mapped[f] = [x, y, z]
      }
      if (Object.keys(mapped).length) keyframes[bone] = mapped
    }
  }
  if (!name && !Object.keys(keyframes).length) return undefined
  const presetId = typeof rec.presetId === 'string' ? rec.presetId.trim() : ''
  return {
    name: name || 'Action',
    fps,
    frameRange,
    keyframes,
    ...(presetId ? { presetId } : {})
  }
}

export function parseBlenderJobResult(
  raw: unknown,
  expectedKind: BlenderDshJobKind
): BlenderJobResult {
  if (typeof raw === 'string') {
    try {
      return parseBlenderJobResult(JSON.parse(raw) as unknown, expectedKind)
    } catch {
      return { ok: false, kind: expectedKind, error: 'GRAPH_MODEL_DSH_RESULT' }
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, kind: expectedKind, error: 'GRAPH_MODEL_DSH_RESULT' }
  }
  const rec = raw as Record<string, unknown>
  const kind =
    rec.kind === 'rig' || rec.kind === 'pose' || rec.kind === 'anim' ? rec.kind : expectedKind
  const ok = rec.ok === true
  const error = typeof rec.error === 'string' && rec.error.trim() ? rec.error.trim() : undefined
  const exportedPath =
    typeof rec.exportedPath === 'string' && rec.exportedPath.trim()
      ? rec.exportedPath.trim()
      : undefined
  const qaRaw = rec.qa
  const qa =
    qaRaw && typeof qaRaw === 'object' && !Array.isArray(qaRaw)
      ? {
          screenshots: Array.isArray((qaRaw as { screenshots?: unknown }).screenshots)
            ? (qaRaw as { screenshots: unknown[] }).screenshots.filter(
                (item): item is string => typeof item === 'string'
              )
            : undefined,
          notes:
            typeof (qaRaw as { notes?: unknown }).notes === 'string'
              ? (qaRaw as { notes: string }).notes
              : undefined
        }
      : undefined
  return {
    ok,
    kind,
    ...(error ? { error } : {}),
    ...(exportedPath ? { exportedPath } : {}),
    ...(parseRigMeta(rec.rigMeta) ? { rigMeta: parseRigMeta(rec.rigMeta) } : {}),
    ...(parseBonePose(rec.bonePose) ? { bonePose: parseBonePose(rec.bonePose) } : {}),
    ...(parseClip(rec.clip) ? { clip: parseClip(rec.clip) } : {}),
    ...(qa ? { qa } : {})
  }
}

const HUMANOID_SIMPLE_RECIPE = [
  'Expanded recipe (humanoid-simple, 21 bones):',
  'Hips (root) at mesh bbox center. Spine → Chest → Neck → Head up the Y/Z spine.',
  'L_Shoulder / R_Shoulder → UpperArm → ForeArm → Hand along the arm span.',
  'L_UpLeg / R_UpLeg → LoLeg → Foot down to the soles.',
  'Scale every bone to the imported MESH bounding box. Then parent_set(ARMATURE_AUTO).',
  'Bone names must be exactly: Hips, Spine, Chest, Neck, Head, L_Shoulder, L_UpperArm, L_ForeArm, L_Hand, R_Shoulder, R_UpperArm, R_ForeArm, R_Hand, L_UpLeg, L_LoLeg, L_Foot, R_UpLeg, R_LoLeg, R_Foot, L_Toes, R_Toes.'
].join('\n')

const HUMANOID_MIXAMO_RECIPE = [
  'Expanded recipe (humanoid-mixamo): humanoid-simple plus finger chains (2–3 bones per finger) and toes.',
  'Prefer Mixamo-style names (mixamorig:Hips …) if the mesh already uses that prefix; otherwise use the humanoid-simple names.',
  'Scale to MESH bbox, then parent_set(ARMATURE_AUTO).'
].join('\n')

const QUADRUPED_RECIPE = [
  'Expanded recipe (quadruped): spine + Head/Neck/Tail + four legs (FrontL/FrontR/BackL/BackR, each Upper+Lower).',
  'Scale to MESH bbox, then parent_set(ARMATURE_AUTO).'
].join('\n')

const PROP_RIGID_RECIPE = [
  'Expanded recipe (prop-rigid): one Root bone at the mesh origin, parent_set(ARMATURE_AUTO) or a single vertex group.',
  'Do not invent extra bones.'
].join('\n')

export function expandBlenderJobInstruction(kind: BlenderDshJobKind, instruction: string): string {
  const raw = instruction.trim()
  if (kind !== 'rig') return raw
  const text = raw.toLowerCase()
  const isMixamo = text.includes('mixamo')
  const isHuman =
    raw.includes('人形') || // cjk-ok（短指令匹配）
    text.includes('humanoid') ||
    /\bhuman\b/.test(text)
  const isQuad = text.includes('quadruped') || raw.includes('四足') // cjk-ok（短指令匹配）
  // 「简单骨架」含「单骨」二字，不能当道具；只认道具 / prop-rigid / 单骨骨架。
  const isProp =
    raw.includes('道具') || // cjk-ok（短指令匹配）
    text.includes('prop-rigid') ||
    raw.includes('单骨骨架') || // cjk-ok（短指令匹配）
    (text.includes('prop') && !isHuman)
  const recipe = isMixamo
    ? HUMANOID_MIXAMO_RECIPE
    : isHuman
      ? HUMANOID_SIMPLE_RECIPE
      : isQuad
        ? QUADRUPED_RECIPE
        : isProp
          ? PROP_RIGID_RECIPE
          : raw.length <= 16
            ? HUMANOID_SIMPLE_RECIPE
            : ''
  if (!recipe) return raw || '(none)'
  if (raw.includes('Expanded recipe') || (raw.includes('Hips') && raw.includes('ARMATURE_AUTO'))) {
    return raw
  }
  return raw ? `${raw}\n\n${recipe}` : recipe
}

export function buildBlenderJobBrief(input: BlenderJobBriefInput): string {
  const locale = input.locale?.trim() || 'zh-CN'
  return [
    `# Blender job (${input.kind})`,
    '',
    `Skill: ${input.skillId}`,
    `Locale: ${locale}`,
    `Input GLB (absolute): ${input.inputAbs}`,
    `Export GLB (absolute): ${input.outputAbs}`,
    `Write result JSON (absolute, app-owned): ${input.resultAbs}`,
    '',
    '## User instruction',
    expandBlenderJobInstruction(input.kind, input.instruction),
    '',
    '## Hard rules',
    '- Load the named skill first. Inspect the real scene at most once, then change it.',
    '- Never invent Euler angles or bone names. Read pose_bones / armature from Blender.',
    '- Import only the input GLB. Do not call generate_model3d or create a new character.',
    '- Do not loop execute_blender_code just to list objects or take screenshots.',
    '- Use get_viewport_screenshot (not custom render scripts) at most once after a real edit.',
    ...(input.kind === 'rig'
      ? [
          '- After import + one bbox read, the NEXT execute_blender_code MUST create an armature, add edit_bones, and parent_set(ARMATURE_AUTO).',
          '- Success requires an ARMATURE object in the scene before export. Inspect-only scripts are a failure.'
        ]
      : [
          '- After large edits, take a viewport screenshot and fix feet / intersections / flipped sides.'
        ]),
    '- Export to the exact output path. Do not write result.json (open() is blocked); the app reads bones back.',
    ''
  ].join('\n')
}

export function buildBlenderJobTask(input: BlenderJobBriefInput): string {
  const skill = input.skillId
  const goal =
    input.kind === 'rig'
      ? 'Create a real armature now. After one import/bbox read, write bones with edit_bones + parent_set(ARMATURE_AUTO). Do not screenshot-loop. Then export a skinned GLB.'
      : input.kind === 'pose'
        ? 'Pose the existing armature with IK/constraints. Keep rest/bind. Export GLB plus bonePose readback.'
        : 'Create a keyframed action on the existing armature, bake it, export GLB with AnimationClip plus clip overlay.'
  return [
    `Use skill "${skill}".`,
    goal,
    `Import "${input.inputAbs}".`,
    `When done, export_scene to "${input.outputAbs}" (glb, include armature/weights/animations as required).`,
    'Do not write result.json (open() is blocked). The app reads armature / pose / clip back from Blender.',
    'Do not guess joint angles in chat. Drive Blender tools, then read values back.',
    '',
    'User instruction:',
    expandBlenderJobInstruction(input.kind, input.instruction)
  ].join('\n')
}

export function validateBlenderJobDelivery(input: {
  kind: BlenderDshJobKind
  result: BlenderJobResult
  outputExists: boolean
}): string | null {
  if (!input.outputExists) return blenderDshError(input.kind, 'EXPORT')
  if (!input.result.ok) return input.result.error || blenderDshError(input.kind, 'FAILED')
  if (input.kind === 'rig' && !input.result.rigMeta?.bones.length) {
    return blenderDshError(input.kind, 'NO_MATCH')
  }
  if (input.kind === 'pose' && !input.result.bonePose) {
    return blenderDshError(input.kind, 'NO_MATCH')
  }
  if (input.kind === 'anim' && !input.result.clip?.name) {
    return blenderDshError(input.kind, 'NO_MATCH')
  }
  return null
}
