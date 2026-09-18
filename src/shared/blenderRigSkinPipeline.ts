/**
 * 迭代式人形蒙皮管线：分阶段脚本 + 结构化 QA + 轮次判定。
 * Blender 是真值来源；应用侧硬校验决定是否导出，不信任 Agent 自报成功。
 */
import { HUMANOID_BONE_NAMES, type Vec3 } from './blenderHumanoidLandmarks'

export const AIAE_LANDMARK_PREFIX = 'AIAE_LM_'
export const AIAE_RIG_ANALYSIS_PREFIX = 'AIAE_RIG_ANALYSIS:'
export const AIAE_RIG_QA_PREFIX = 'AIAE_RIG_QA:'
export const AIAE_HUMANOID_LANDMARKS_MARKER = 'AIAE_HUMANOID_LANDMARKS'
export const AIAE_HUMANOID_BIND_MARKER = 'AIAE_HUMANOID_BIND_FROM_LANDMARKS'
export const AIAE_RIG_QA_MARKER = 'AIAE_RIG_QA'
export const AIAE_RIG_WEIGHT_REPAIR_MARKER = 'AIAE_RIG_WEIGHT_REPAIR'

/** 0 = 不限制 dsh 返工轮次；仅 PASS / stuck / abort / 总超时结束 */
export const RIG_SKIN_MAX_ATTEMPTS = 0
export const RIG_SKIN_STUCK_STREAK = 2
/** 硬 QA 脚本含 Pose 测试，单次 MCP 调用允许更长 */
export const RIG_QA_COMMAND_TIMEOUT_MS = 180_000
/** 0 = 瞬时 MCP 断线时不限次重试 QA（直到成功、abort 或上层超时） */
export const RIG_QA_TRANSIENT_RETRIES = 0
/** 单次 evaluate 内的瞬时重试上限（主进程）；渲染层可再套一层不限次 */
export const RIG_QA_TRANSIENT_RETRIES_PER_EVAL = 3
export const RIG_QA_TRANSIENT_BACKOFF_CAP_MS = 8_000
/** 权重扫描上限：全网格逐顶点会在稠密 mesh 上把 Blender 主线程卡死并掐断 MCP TCP */
export const RIG_QA_WEIGHT_SAMPLE_CAP = 4000

export function rigAttemptLimit(maxAttempts?: number): number {
  const max = maxAttempts ?? RIG_SKIN_MAX_ATTEMPTS
  return max > 0 ? max : Number.POSITIVE_INFINITY
}

export function shouldContinueTransientQaRetry(tryIndex: number, maxRetries?: number): boolean {
  const max = maxRetries ?? RIG_QA_TRANSIENT_RETRIES
  if (max <= 0) return true
  return tryIndex < max
}

export function transientQaBackoffMs(tryIndex: number): number {
  return Math.min(RIG_QA_TRANSIENT_BACKOFF_CAP_MS, 800 * Math.max(1, tryIndex + 1))
}

export type RigMeshRole = 'body' | 'clothes' | 'hair' | 'accessory' | 'unknown'

export type RigLandmarkId =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'l_shoulder'
  | 'l_elbow'
  | 'l_wrist'
  | 'l_hand'
  | 'r_shoulder'
  | 'r_elbow'
  | 'r_wrist'
  | 'r_hand'
  | 'l_hip'
  | 'l_knee'
  | 'l_ankle'
  | 'l_toe'
  | 'r_hip'
  | 'r_knee'
  | 'r_ankle'
  | 'r_toe'

export const RIG_LANDMARK_IDS: readonly RigLandmarkId[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'l_shoulder',
  'l_elbow',
  'l_wrist',
  'l_hand',
  'r_shoulder',
  'r_elbow',
  'r_wrist',
  'r_hand',
  'l_hip',
  'l_knee',
  'l_ankle',
  'l_toe',
  'r_hip',
  'r_knee',
  'r_ankle',
  'r_toe'
] as const

export interface RigMeshInfo {
  name: string
  role: RigMeshRole
  verts: number
  worldBboxMin: Vec3
  worldBboxMax: Vec3
}

export interface RigSceneAnalysis {
  upAxis: 0 | 1 | 2
  sideAxis: 0 | 1 | 2
  fwdAxis: 0 | 1 | 2
  meshes: RigMeshInfo[]
  bodyMeshNames: string[]
  landmarkIds: string[]
  confidence: number
  notes: string[]
}

export interface RigBoneGeom {
  name: string
  parent: string
  head: Vec3
  tail: Vec3
}

export interface RigQaFail {
  code: string
  message: string
  bone?: string
  mesh?: string
}

export interface RigPoseMetric {
  name: string
  bboxGrowth: number
  spikeCount: number
  ok: boolean
}

export interface RigQaReport {
  pass: boolean
  attempt: number
  fingerprint: string
  boneCount: number
  requiredBonesOk: boolean
  parentChainOk: boolean
  vertexGroupCount: number
  unweightedRatio: number
  maxInfluences: number
  weightSumError: number
  zeroInfluenceBones: string[]
  deformMeshes: string[]
  bones: RigBoneGeom[]
  poseMetrics: RigPoseMetric[]
  fails: RigQaFail[]
  notes: string[]
  screenshots?: string[]
  visualPass?: boolean
}

export interface RigAttempt {
  index: number
  phase: 'landmark' | 'bind' | 'repair' | 'qa'
  qa?: RigQaReport
  error?: string
}

export type RigTerminateReason =
  'pass' | 'max_attempts' | 'stuck' | 'no_body' | 'no_landmarks' | 'dsh_failed' | 'export_failed'

export function rigQaFingerprint(
  qa: Pick<RigQaReport, 'fails' | 'unweightedRatio' | 'boneCount'>
): string {
  const codes = qa.fails
    .map((f) => f.code)
    .sort()
    .join('|')
  const ratio = Math.round(qa.unweightedRatio * 1000)
  return `${qa.boneCount}:${ratio}:${codes}`
}

export function isRigQaPass(qa: RigQaReport): boolean {
  return (
    qa.pass === true &&
    qa.requiredBonesOk &&
    qa.parentChainOk &&
    qa.fails.length === 0 &&
    qa.unweightedRatio <= 0.08 &&
    qa.vertexGroupCount > 0 &&
    qa.visualPass !== false
  )
}

/** Blender MCP TCP / 超时类瞬时错误（可重连重试，不应当蒙皮拓扑失败） */
export function isTransientBlenderError(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('epipe') ||
    text.includes('etimedout') ||
    text.includes('socket hang up') ||
    text.includes('主动断开') || // cjk-ok（Blender MCP 中文错误）
    text.includes('连接已重置') || // cjk-ok
    text.includes('无法连接 blender') || // cjk-ok
    text.includes('响应超时') || // cjk-ok
    text.includes('connection reset') ||
    text.includes('broken pipe')
  )
}

export function isTransientRigQa(qa: RigQaReport | undefined): boolean {
  if (!qa || qa.pass) return false
  if (!qa.fails.length) return false
  return qa.fails.every(
    (f) => f.code === 'QA_TRANSIENT' || (f.code === 'QA_EXEC' && isTransientBlenderError(f.message))
  )
}

export function shouldStopRigAttempts(input: {
  attempt: number
  maxAttempts?: number
  qa?: RigQaReport
  previousFingerprint?: string
  stuckStreak?: number
}): { stop: boolean; reason?: RigTerminateReason } {
  const max = rigAttemptLimit(input.maxAttempts)
  if (input.qa && isRigQaPass(input.qa)) return { stop: true, reason: 'pass' }
  if (Number.isFinite(max) && input.attempt >= max) return { stop: true, reason: 'max_attempts' }
  // 瞬时 MCP 断线不算「无进展 stuck」——下一轮应重跑 QA，而不是停掉
  if (isTransientRigQa(input.qa)) return { stop: false }
  const fp = input.qa?.fingerprint || ''
  if (fp && input.previousFingerprint && fp === input.previousFingerprint) {
    const streak = (input.stuckStreak ?? 1) + 1
    if (streak >= RIG_SKIN_STUCK_STREAK) return { stop: true, reason: 'stuck' }
  }
  return { stop: false }
}

export function parsePrefixedJson<T = unknown>(text: string, prefix: string): T | undefined {
  const idx = text.lastIndexOf(prefix)
  if (idx < 0) return undefined
  const after = text.slice(idx + prefix.length)
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
  try {
    return JSON.parse(after.slice(start, end + 1)) as T
  } catch {
    return undefined
  }
}

function asFinite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : null
}

function asVec3(raw: unknown): Vec3 | undefined {
  if (!Array.isArray(raw) || raw.length < 3) return undefined
  const x = asFinite(raw[0])
  const y = asFinite(raw[1])
  const z = asFinite(raw[2])
  if (x == null || y == null || z == null) return undefined
  return [x, y, z]
}

export function parseRigSceneAnalysis(raw: unknown): RigSceneAnalysis | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const upAxis = (asFinite(rec.upAxis) ?? 2) as 0 | 1 | 2
  const sideAxis = (asFinite(rec.sideAxis) ?? 0) as 0 | 1 | 2
  const fwdAxis = (asFinite(rec.fwdAxis) ?? 1) as 0 | 1 | 2
  const meshes: RigMeshInfo[] = []
  if (Array.isArray(rec.meshes)) {
    for (const item of rec.meshes) {
      if (!item || typeof item !== 'object') continue
      const m = item as Record<string, unknown>
      const name = typeof m.name === 'string' ? m.name.trim() : ''
      if (!name) continue
      const roleRaw = typeof m.role === 'string' ? m.role : 'unknown'
      const role: RigMeshRole =
        roleRaw === 'body' || roleRaw === 'clothes' || roleRaw === 'hair' || roleRaw === 'accessory'
          ? roleRaw
          : 'unknown'
      const min = asVec3(m.worldBboxMin) ?? ([0, 0, 0] as Vec3)
      const max = asVec3(m.worldBboxMax) ?? ([0, 0, 0] as Vec3)
      meshes.push({
        name,
        role,
        verts: asFinite(m.verts) ?? 0,
        worldBboxMin: min,
        worldBboxMax: max
      })
    }
  }
  const bodyMeshNames = Array.isArray(rec.bodyMeshNames)
    ? rec.bodyMeshNames.filter((n): n is string => typeof n === 'string' && !!n.trim())
    : meshes.filter((m) => m.role === 'body').map((m) => m.name)
  const landmarkIds = Array.isArray(rec.landmarkIds)
    ? rec.landmarkIds.filter((n): n is string => typeof n === 'string' && !!n.trim())
    : []
  const notes = Array.isArray(rec.notes)
    ? rec.notes.filter((n): n is string => typeof n === 'string')
    : []
  return {
    upAxis,
    sideAxis,
    fwdAxis,
    meshes,
    bodyMeshNames,
    landmarkIds,
    confidence: asFinite(rec.confidence) ?? 0,
    notes
  }
}

export function parseRigQaReport(raw: unknown, attempt = 1): RigQaReport | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const rec = raw as Record<string, unknown>
  const fails: RigQaFail[] = []
  if (Array.isArray(rec.fails)) {
    for (const item of rec.fails) {
      if (!item || typeof item !== 'object') continue
      const f = item as Record<string, unknown>
      const code = typeof f.code === 'string' ? f.code.trim() : ''
      const message = typeof f.message === 'string' ? f.message.trim() : code
      if (!code) continue
      fails.push({
        code,
        message,
        ...(typeof f.bone === 'string' ? { bone: f.bone } : {}),
        ...(typeof f.mesh === 'string' ? { mesh: f.mesh } : {})
      })
    }
  }
  const bones: RigBoneGeom[] = []
  if (Array.isArray(rec.bones)) {
    for (const item of rec.bones) {
      if (!item || typeof item !== 'object') continue
      const b = item as Record<string, unknown>
      const name = typeof b.name === 'string' ? b.name.trim() : ''
      const parent = typeof b.parent === 'string' ? b.parent : ''
      const head = asVec3(b.head)
      const tail = asVec3(b.tail)
      if (!name || !head || !tail) continue
      bones.push({ name, parent, head, tail })
    }
  }
  const poseMetrics: RigPoseMetric[] = []
  if (Array.isArray(rec.poseMetrics)) {
    for (const item of rec.poseMetrics) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (!name) continue
      poseMetrics.push({
        name,
        bboxGrowth: asFinite(p.bboxGrowth) ?? 0,
        spikeCount: asFinite(p.spikeCount) ?? 0,
        ok: p.ok === true
      })
    }
  }
  const unweightedRatio = asFinite(rec.unweightedRatio) ?? 1
  const boneCount = asFinite(rec.boneCount) ?? bones.length
  const report: RigQaReport = {
    pass: rec.pass === true,
    attempt,
    fingerprint: '',
    boneCount,
    requiredBonesOk: rec.requiredBonesOk === true,
    parentChainOk: rec.parentChainOk === true,
    vertexGroupCount: asFinite(rec.vertexGroupCount) ?? 0,
    unweightedRatio,
    maxInfluences: asFinite(rec.maxInfluences) ?? 0,
    weightSumError: asFinite(rec.weightSumError) ?? 0,
    zeroInfluenceBones: Array.isArray(rec.zeroInfluenceBones)
      ? rec.zeroInfluenceBones.filter((n): n is string => typeof n === 'string')
      : [],
    deformMeshes: Array.isArray(rec.deformMeshes)
      ? rec.deformMeshes.filter((n): n is string => typeof n === 'string')
      : [],
    bones,
    poseMetrics,
    fails,
    notes: Array.isArray(rec.notes)
      ? rec.notes.filter((n): n is string => typeof n === 'string')
      : [],
    ...(Array.isArray(rec.screenshots)
      ? {
          screenshots: rec.screenshots.filter((n): n is string => typeof n === 'string')
        }
      : {}),
    ...(typeof rec.visualPass === 'boolean' ? { visualPass: rec.visualPass } : {})
  }
  report.fingerprint =
    typeof rec.fingerprint === 'string' && rec.fingerprint.trim()
      ? rec.fingerprint.trim()
      : rigQaFingerprint(report)
  if (report.pass && !isRigQaPass(report)) report.pass = false
  return report
}

export function summarizeRigQaForAgent(qa: RigQaReport): string {
  const lines = [
    `QA attempt=${qa.attempt} pass=${qa.pass} fingerprint=${qa.fingerprint}`,
    `bones=${qa.boneCount} vertexGroups=${qa.vertexGroupCount} unweighted=${qa.unweightedRatio.toFixed(3)}`,
    `requiredBonesOk=${qa.requiredBonesOk} parentChainOk=${qa.parentChainOk}`
  ]
  if (qa.fails.length) {
    lines.push('Fails:')
    for (const f of qa.fails.slice(0, 12)) {
      lines.push(`- ${f.code}: ${f.message}${f.bone ? ` (${f.bone})` : ''}`)
    }
  }
  if (qa.poseMetrics.length) {
    lines.push('Pose metrics:')
    for (const p of qa.poseMetrics) {
      lines.push(`- ${p.name}: growth=${p.bboxGrowth.toFixed(3)} spikes=${p.spikeCount} ok=${p.ok}`)
    }
  }
  if (qa.notes.length) lines.push(`Notes: ${qa.notes.slice(0, 6).join('; ')}`)
  return lines.join('\n')
}

/** Empty 名称列表（供脚本与单测共用） */
export const LANDMARK_EMPTY_NAMES = RIG_LANDMARK_IDS.map((id) => `${AIAE_LANDMARK_PREFIX}${id}`)

/**
 * 阶段 1：按网格连通与端点估计关节，创建 AIAE_LM_* Empty。
 * 不创建 Armature；多 Mesh 时只让 body/clothes 参与肢体端点搜索。
 */
export const BLENDER_HUMANOID_LANDMARKS_CODE = [
  `# ${AIAE_HUMANOID_LANDMARKS_MARKER}`,
  'import bpy',
  'import json',
  'import math',
  'if bpy.context.view_layer.objects.active is not None:',
  '    bpy.ops.object.mode_set(mode="OBJECT")',
  'olds = [o for o in bpy.data.objects if o.name.startswith("AIAE_LM_")]',
  'for o in olds:',
  '    bpy.data.objects.remove(o, do_unlink=True)',
  'meshes = [o for o in bpy.data.objects if o.type == "MESH"]',
  'if not meshes:',
  "    raise RuntimeError('no mesh')",
  'mesh_infos = []',
  'for mesh in meshes:',
  '    mw = mesh.matrix_world',
  '    xs = []',
  '    ys = []',
  '    zs = []',
  '    for v in mesh.data.vertices:',
  '        p = mw @ v.co',
  '        xs.append(p.x)',
  '        ys.append(p.y)',
  '        zs.append(p.z)',
  '    if not xs:',
  '        continue',
  '    mesh_infos.append({',
  "        'obj': mesh,",
  "        'name': mesh.name,",
  "        'verts': len(mesh.data.vertices),",
  "        'min': (min(xs), min(ys), min(zs)),",
  "        'max': (max(xs), max(ys), max(zs)),",
  "        'vol': max(max(xs)-min(xs), 0.001) * max(max(ys)-min(ys), 0.001) * max(max(zs)-min(zs), 0.001)",
  '    })',
  'if not mesh_infos:',
  "    raise RuntimeError('empty meshes')",
  'i = 0',
  'while i < len(mesh_infos):',
  '    j = i + 1',
  '    while j < len(mesh_infos):',
  '        if mesh_infos[j]["vol"] > mesh_infos[i]["vol"]:',
  '            tmp = mesh_infos[i]',
  '            mesh_infos[i] = mesh_infos[j]',
  '            mesh_infos[j] = tmp',
  '        j += 1',
  '    i += 1',
  'body = mesh_infos[0]',
  'body_names = [body["name"]]',
  'roles = {}',
  'roles[body["name"]] = "body"',
  'bx0, by0, bz0 = body["min"]',
  'bx1, by1, bz1 = body["max"]',
  'bcx = (bx0 + bx1) * 0.5',
  'bcy = (by0 + by1) * 0.5',
  'bcz = (bz0 + bz1) * 0.5',
  'bdiag = math.sqrt((bx1-bx0)**2 + (by1-by0)**2 + (bz1-bz0)**2)',
  'for info in mesh_infos[1:]:',
  '    mn = info["min"]',
  '    mx = info["max"]',
  '    cx = (mn[0] + mx[0]) * 0.5',
  '    cy = (mn[1] + mx[1]) * 0.5',
  '    cz = (mn[2] + mx[2]) * 0.5',
  '    dist = math.sqrt((cx-bcx)**2 + (cy-bcy)**2 + (cz-bcz)**2)',
  '    ratio = info["vol"] / max(body["vol"], 1e-6)',
  '    nm = info["name"].lower()',
  '    if "hair" in nm or "wig" in nm:',
  '        roles[info["name"]] = "hair"',
  '    elif ratio < 0.08 or dist > bdiag * 0.55:',
  '        roles[info["name"]] = "accessory"',
  '    elif ratio < 0.55:',
  '        roles[info["name"]] = "clothes"',
  '        body_names.append(info["name"])',
  '    else:',
  '        roles[info["name"]] = "body"',
  '        body_names.append(info["name"])',
  'pts = []',
  'adj = []',
  'for mesh in meshes:',
  '    if roles.get(mesh.name, "unknown") == "accessory":',
  '        continue',
  '    if roles.get(mesh.name) == "hair":',
  '        continue',
  '    mw = mesh.matrix_world',
  '    base = len(pts)',
  '    for v in mesh.data.vertices:',
  '        p = mw @ v.co',
  '        pts.append((p.x, p.y, p.z))',
  '        adj.append([])',
  '    for e in mesh.data.edges:',
  '        a = base + e.vertices[0]',
  '        b = base + e.vertices[1]',
  '        adj[a].append(b)',
  '        adj[b].append(a)',
  'if len(pts) < 8:',
  "    raise RuntimeError('too few verts')",
  'xs = [p[0] for p in pts]',
  'ys = [p[1] for p in pts]',
  'zs = [p[2] for p in pts]',
  'minx, maxx = min(xs), max(xs)',
  'miny, maxy = min(ys), max(ys)',
  'minz, maxz = min(zs), max(zs)',
  'sx = max(maxx - minx, 0.001)',
  'sy = max(maxy - miny, 0.001)',
  'sz = max(maxz - minz, 0.001)',
  'if sz >= sy and sz >= sx:',
  '    up, side, fwd = 2, 0, 1',
  '    umin, ur = minz, sz',
  'elif sx >= sy and sx >= sz:',
  '    up, side, fwd = 0, 2, 1',
  '    umin, ur = minx, sx',
  'else:',
  '    up, side, fwd = 1, 0, 2',
  '    umin, ur = miny, sy',
  'smin = min(p[side] for p in pts)',
  'smax = max(p[side] for p in pts)',
  'sr = max(smax - smin, 0.001)',
  'cx = (smin + smax) * 0.5',
  'def unorm(p):',
  '    return (p[up] - umin) / ur',
  'def sidev(p):',
  '    return p[side]',
  'def fwdv(p):',
  '    return p[fwd]',
  'midw = [abs(sidev(p) - cx) for p in pts if 0.35 <= unorm(p) <= 0.7]',
  'midw.sort()',
  'torso_r = midw[int(len(midw) * 0.35)] if midw else sr * 0.2',
  'if torso_r < sr * 0.14:',
  '    torso_r = sr * 0.14',
  'def lerp(a, b, t):',
  '    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)',
  'def avg(a, b):',
  '    return ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5)',
  'def centroid(lo, hi, rad):',
  '    x = y = z = n = 0.0',
  '    for p in pts:',
  '        u = unorm(p)',
  '        if u < lo or u > hi:',
  '            continue',
  '        if abs(sidev(p) - cx) > rad:',
  '            continue',
  '        x += p[0]',
  '        y += p[1]',
  '        z += p[2]',
  '        n += 1.0',
  '    if n < 1:',
  '        return None',
  '    return (x / n, y / n, z / n)',
  'def bfs_until(start):',
  '    prev = {start: -1}',
  '    q = [start]',
  '    qi = 0',
  '    hit = -1',
  '    while qi < len(q):',
  '        i = q[qi]',
  '        qi += 1',
  '        if i != start and abs(sidev(pts[i]) - cx) <= torso_r * 1.25:',
  '            hit = i',
  '            break',
  '        for j in adj[i]:',
  '            if j not in prev:',
  '                prev[j] = i',
  '                q.append(j)',
  '    if hit < 0:',
  '        return []',
  '    path = []',
  '    i = hit',
  '    while i >= 0:',
  '        path.append(i)',
  '        i = prev[i]',
  '    path.reverse()',
  '    return path',
  'def path_pt(path, t):',
  '    if not path:',
  '        return pts[0]',
  '    idx = int(round((len(path) - 1) * t))',
  '    if idx < 0:',
  '        idx = 0',
  '    if idx >= len(path):',
  '        idx = len(path) - 1',
  '    return pts[path[idx]]',
  'def highest_on_path(path):',
  '    idx = len(path) - 1',
  '    best = -1e18',
  '    k = 0',
  '    while k < len(path):',
  '        u = pts[path[k]][up]',
  '        if u >= best:',
  '            best = u',
  '            idx = k',
  '        k += 1',
  '    return pts[path[idx]], idx',
  'def path_pt_len(path, t, last):',
  '    n = last + 1',
  '    if n < 1:',
  '        return path_pt(path, t)',
  '    idx = int(round((n - 1) * t))',
  '    if idx < 0:',
  '        idx = 0',
  '    if idx >= len(path):',
  '        idx = len(path) - 1',
  '    return pts[path[idx]]',
  'def pick_extreme(sign, lo, hi, mode):',
  '    best = -1',
  '    score = 1e18 if mode == "upMin" else -1e18',
  '    i = 0',
  '    while i < len(pts):',
  '        p = pts[i]',
  '        u = unorm(p)',
  '        s = sidev(p) - cx',
  '        if u >= lo and u <= hi and ((sign > 0 and s > 0) or (sign < 0 and s < 0)):',
  '            if mode == "side":',
  '                v = abs(s)',
  '                if v > score:',
  '                    score = v',
  '                    best = i',
  '            elif mode == "upMin":',
  '                v = p[up]',
  '                if v < score:',
  '                    score = v',
  '                    best = i',
  '            else:',
  '                v = fwdv(p)',
  '                if v > score:',
  '                    score = v',
  '                    best = i',
  '        i += 1',
  '    return best',
  'def pick_hand(sign):',
  '    ranked = []',
  '    i = 0',
  '    while i < len(pts):',
  '        p = pts[i]',
  '        u = unorm(p)',
  '        s = sidev(p) - cx',
  '        if 0.22 <= u <= 0.92 and ((sign > 0 and s > 0) or (sign < 0 and s < 0)):',
  '            ranked.append((abs(s), i))',
  '        i += 1',
  '    ranked.sort(reverse=True)',
  '    best_i = ranked[0][1] if ranked else -1',
  '    best_path = []',
  '    best_score = -1e18',
  '    k = 0',
  '    limit = min(24, len(ranked))',
  '    while k < limit:',
  '        i = ranked[k][1]',
  '        path = bfs_until(i)',
  '        if len(path) >= 4:',
  '            top_u = max(unorm(pts[j]) for j in path)',
  '            if top_u <= 0.95:',
  '                end_u = unorm(pts[path[-1]])',
  '                score = abs(sidev(pts[i]) - cx)',
  '                if end_u > 0.48:',
  '                    score += sr * 0.15',
  '                if score > best_score:',
  '                    best_score = score',
  '                    best_i = i',
  '                    best_path = path',
  '        k += 1',
  '    return best_i, best_path',
  'head = centroid(0.88, 1.0, sr * 0.22)',
  'if head is None:',
  '    hi = pick_extreme(1, 0.85, 1.0, "side")',
  '    head = pts[hi] if hi >= 0 else pts[0]',
  'lh_i, lh_path = pick_hand(1)',
  'rh_i, rh_path = pick_hand(-1)',
  'lf_i = pick_extreme(1, 0.0, 0.28, "upMin")',
  'rf_i = pick_extreme(-1, 0.0, 0.28, "upMin")',
  'lt_i = pick_extreme(1, 0.0, 0.12, "fwdMax")',
  'rt_i = pick_extreme(-1, 0.0, 0.12, "fwdMax")',
  'l_foot = pts[lf_i] if lf_i >= 0 else head',
  'r_foot = pts[rf_i] if rf_i >= 0 else l_foot',
  'l_toe = pts[lt_i] if lt_i >= 0 else l_foot',
  'r_toe = pts[rt_i] if rt_i >= 0 else r_foot',
  'l_hand = pts[lh_i] if lh_i >= 0 else head',
  'r_hand = pts[rh_i] if rh_i >= 0 else head',
  'lf_path = bfs_until(lf_i) if lf_i >= 0 else []',
  'rf_path = bfs_until(rf_i) if rf_i >= 0 else []',
  'path_ok = len(lh_path) >= 4 and len(rh_path) >= 4 and len(lf_path) >= 4 and len(rf_path) >= 4',
  'if not path_ok:',
  "    raise RuntimeError('landmarks_unreliable: limb paths missing; refuse fixed-ratio fallback')",
  'l_sho, l_sho_i = highest_on_path(lh_path)',
  'r_sho, r_sho_i = highest_on_path(rh_path)',
  'l_elb = path_pt_len(lh_path, 0.5, l_sho_i)',
  'r_elb = path_pt_len(rh_path, 0.5, r_sho_i)',
  'l_wri = path_pt(lh_path, 0.12)',
  'r_wri = path_pt(rh_path, 0.12)',
  'l_hip = path_pt(lf_path, 1.0)',
  'r_hip = path_pt(rf_path, 1.0)',
  'sho_u = (unorm(l_sho) + unorm(r_sho)) * 0.5',
  'hip_u = (unorm(l_hip) + unorm(r_hip)) * 0.5',
  'if sho_u - hip_u < 0.08:',
  "    raise RuntimeError('landmarks_unreliable: torso too short')",
  'l_knee = path_pt(lf_path, 0.5)',
  'r_knee = path_pt(rf_path, 0.5)',
  'hips = avg(l_hip, r_hip)',
  'chest = centroid((unorm(hips) + sho_u) * 0.5 - 0.04, sho_u + 0.02, torso_r)',
  'if chest is None:',
  '    chest = lerp(hips, head, 0.62)',
  'neck = centroid(sho_u - 0.02, unorm(head) - 0.04, torso_r * 0.7)',
  'if neck is None:',
  '    neck = lerp(chest, head, 0.45)',
  'spine = lerp(hips, chest, 0.45)',
  'marks = {',
  "    'hips': hips, 'spine': spine, 'chest': chest, 'neck': neck, 'head': head,",
  "    'l_shoulder': l_sho, 'l_elbow': l_elb, 'l_wrist': l_wri, 'l_hand': l_hand,",
  "    'r_shoulder': r_sho, 'r_elbow': r_elb, 'r_wrist': r_wri, 'r_hand': r_hand,",
  "    'l_hip': l_hip, 'l_knee': l_knee, 'l_ankle': l_foot, 'l_toe': l_toe,",
  "    'r_hip': r_hip, 'r_knee': r_knee, 'r_ankle': r_foot, 'r_toe': r_toe,",
  '}',
  'for key, loc in marks.items():',
  '    empty = bpy.data.objects.new("AIAE_LM_" + key, None)',
  '    empty.empty_display_type = "SPHERE"',
  '    empty.empty_display_size = ur * 0.02',
  '    empty.location = loc',
  '    bpy.context.collection.objects.link(empty)',
  'analysis = {',
  "    'upAxis': up, 'sideAxis': side, 'fwdAxis': fwd,",
  "    'bodyMeshNames': body_names,",
  "    'landmarkIds': list(marks.keys()),",
  "    'confidence': 0.85,",
  "    'notes': ['landmarks from mesh edge walks; accessories/hair excluded'],",
  "    'meshes': []",
  '}',
  'for info in mesh_infos:',
  '    analysis["meshes"].append({',
  '        "name": info["name"],',
  '        "role": roles.get(info["name"], "unknown"),',
  '        "verts": info["verts"],',
  '        "worldBboxMin": list(info["min"]),',
  '        "worldBboxMax": list(info["max"])',
  '    })',
  `print('${AIAE_RIG_ANALYSIS_PREFIX}' + json.dumps(analysis, separators=(',', ':')))`,
  "print('AIAE_HUMANOID_LANDMARKS_OK', len(marks))"
].join('\n')

/**
 * 阶段 2：从 AIAE_LM_* Empty 建 21 骨 + ARMATURE_AUTO + 权重清理。
 * 禁止猜 head/tail——只读 Empty 世界坐标。
 */
export const BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE = [
  `# ${AIAE_HUMANOID_BIND_MARKER}`,
  'import bpy',
  'import math',
  'if bpy.context.view_layer.objects.active is not None:',
  '    bpy.ops.object.mode_set(mode="OBJECT")',
  'def lm(key):',
  '    name = "AIAE_LM_" + key',
  '    obj = bpy.data.objects.get(name)',
  '    if obj is None:',
  "        raise RuntimeError('missing landmark ' + name)",
  '    return obj.matrix_world.translation.copy()',
  'need = ["hips","spine","chest","neck","head","l_shoulder","l_elbow","l_wrist","l_hand","r_shoulder","r_elbow","r_wrist","r_hand","l_hip","l_knee","l_ankle","l_toe","r_hip","r_knee","r_ankle","r_toe"]',
  'for k in need:',
  '    lm(k)',
  'hips = lm("hips")',
  'spine = lm("spine")',
  'chest = lm("chest")',
  'neck = lm("neck")',
  'head = lm("head")',
  'l_sho = lm("l_shoulder")',
  'l_elb = lm("l_elbow")',
  'l_wri = lm("l_wrist")',
  'l_hand = lm("l_hand")',
  'r_sho = lm("r_shoulder")',
  'r_elb = lm("r_elbow")',
  'r_wri = lm("r_wrist")',
  'r_hand = lm("r_hand")',
  'l_hip = lm("l_hip")',
  'l_knee = lm("l_knee")',
  'l_foot = lm("l_ankle")',
  'l_toe = lm("l_toe")',
  'r_hip = lm("r_hip")',
  'r_knee = lm("r_knee")',
  'r_foot = lm("r_ankle")',
  'r_toe = lm("r_toe")',
  'def ensure(a, b):',
  '    dx, dy, dz = b.x - a.x, b.y - a.y, b.z - a.z',
  '    if dx * dx + dy * dy + dz * dz < 1e-8:',
  '        b = b.copy()',
  '        b.z = b.z + 0.01',
  '    return b',
  'def lerp_v(a, b, t):',
  '    return a.lerp(b, t)',
  'bones = [',
  '    ("Hips", "", hips, spine),',
  '    ("Spine", "Hips", spine, chest),',
  '    ("Chest", "Spine", chest, neck),',
  '    ("Neck", "Chest", neck, lerp_v(neck, head, 0.55)),',
  '    ("Head", "Neck", lerp_v(neck, head, 0.55), head),',
  '    ("L_Shoulder", "Chest", lerp_v(neck, l_sho, 0.35), l_sho),',
  '    ("L_UpperArm", "L_Shoulder", l_sho, l_elb),',
  '    ("L_ForeArm", "L_UpperArm", l_elb, l_wri),',
  '    ("L_Hand", "L_ForeArm", l_wri, l_hand),',
  '    ("R_Shoulder", "Chest", lerp_v(neck, r_sho, 0.35), r_sho),',
  '    ("R_UpperArm", "R_Shoulder", r_sho, r_elb),',
  '    ("R_ForeArm", "R_UpperArm", r_elb, r_wri),',
  '    ("R_Hand", "R_ForeArm", r_wri, r_hand),',
  '    ("L_UpLeg", "Hips", l_hip, l_knee),',
  '    ("L_LoLeg", "L_UpLeg", l_knee, l_foot),',
  '    ("L_Foot", "L_LoLeg", l_foot, lerp_v(l_foot, l_toe, 0.65)),',
  '    ("L_Toes", "L_Foot", lerp_v(l_foot, l_toe, 0.65), l_toe),',
  '    ("R_UpLeg", "Hips", r_hip, r_knee),',
  '    ("R_LoLeg", "R_UpLeg", r_knee, r_foot),',
  '    ("R_Foot", "R_LoLeg", r_foot, lerp_v(r_foot, r_toe, 0.65)),',
  '    ("R_Toes", "R_Foot", lerp_v(r_foot, r_toe, 0.65), r_toe),',
  ']',
  'olds = [o for o in bpy.data.objects if o.type == "ARMATURE"]',
  'for o in olds:',
  '    bpy.data.objects.remove(o, do_unlink=True)',
  "arm_data = bpy.data.armatures.new('Armature')",
  "arm_obj = bpy.data.objects.new('Armature', arm_data)",
  'bpy.context.collection.objects.link(arm_obj)',
  'bpy.context.view_layer.objects.active = arm_obj',
  'arm_obj.select_set(True)',
  'bpy.ops.object.mode_set(mode="EDIT")',
  'created = {}',
  'ebones = arm_obj.data.edit_bones',
  'for spec in bones:',
  '    bone = ebones.new(spec[0])',
  '    bone.head = spec[2]',
  '    bone.tail = ensure(spec[2], spec[3])',
  '    if spec[1] and spec[1] in created:',
  '        bone.parent = created[spec[1]]',
  '        bone.use_connect = False',
  '    created[spec[0]] = bone',
  'bpy.ops.object.mode_set(mode="OBJECT")',
  'deform = []',
  'for mesh in bpy.data.objects:',
  '    if mesh.type != "MESH":',
  '        continue',
  '    nm = mesh.name.lower()',
  '    if nm.startswith("aiae_lm_"):',
  '        continue',
  '    if "weapon" in nm or "gun" in nm or "sword" in nm or "prop" in nm:',
  '        continue',
  '    deform.append(mesh)',
  'if not deform:',
  '    deform = [o for o in bpy.data.objects if o.type == "MESH"]',
  'for mesh in deform:',
  '    for obj in bpy.data.objects:',
  '        obj.select_set(False)',
  '    mesh.select_set(True)',
  '    arm_obj.select_set(True)',
  '    bpy.context.view_layer.objects.active = arm_obj',
  '    bpy.ops.object.parent_set(type="ARMATURE_AUTO")',
  'bone_names = set(created.keys())',
  'for mesh in deform:',
  '    keep = []',
  '    for g in list(mesh.vertex_groups):',
  '        if g.name in bone_names:',
  '            keep.append(g.name)',
  '        else:',
  '            mesh.vertex_groups.remove(g)',
  '    bpy.context.view_layer.objects.active = mesh',
  '    mesh.select_set(True)',
  '    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")',
  '    try:',
  '        bpy.ops.object.vertex_group_normalize_all(lock_active=False)',
  '        bpy.ops.object.vertex_group_limit_total(limit=4)',
  '        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01)',
  '    except Exception:',
  '        pass',
  '    bpy.ops.object.mode_set(mode="OBJECT")',
  '    has_arm = False',
  '    for mod in mesh.modifiers:',
  '        if mod.type == "ARMATURE":',
  '            mod.object = arm_obj',
  '            has_arm = True',
  '    if not has_arm:',
  '        mod = mesh.modifiers.new(name="Armature", type="ARMATURE")',
  '        mod.object = arm_obj',
  "print('AIAE_HUMANOID_BIND_OK', len(created), len(deform))"
].join('\n')

/** 兼容旧 brief：landmarks + bind 连续执行 */
export const BLENDER_HUMANOID_RIG_PIPELINE_CODE = [
  `# AIAE_HUMANOID_RIG`,
  BLENDER_HUMANOID_LANDMARKS_CODE,
  BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE
].join('\n\n')

/** 局部权重返工：肩/肘/髋/膝邻域在父骨与子骨之间重分配 */
export const BLENDER_RIG_WEIGHT_REPAIR_CODE = [
  `# ${AIAE_RIG_WEIGHT_REPAIR_MARKER}`,
  'import bpy',
  'import math',
  'arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]',
  'if not arms:',
  "    raise RuntimeError('no armature')",
  'arm = arms[0]',
  'pairs = [',
  '    ("L_UpperArm", "L_Shoulder"),',
  '    ("L_ForeArm", "L_UpperArm"),',
  '    ("R_UpperArm", "R_Shoulder"),',
  '    ("R_ForeArm", "R_UpperArm"),',
  '    ("L_UpLeg", "Hips"),',
  '    ("L_LoLeg", "L_UpLeg"),',
  '    ("R_UpLeg", "Hips"),',
  '    ("R_LoLeg", "R_UpLeg"),',
  ']',
  'for mesh in bpy.data.objects:',
  '    if mesh.type != "MESH":',
  '        continue',
  '    if not mesh.vertex_groups:',
  '        continue',
  '    bpy.context.view_layer.objects.active = mesh',
  '    mesh.select_set(True)',
  '    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")',
  '    for child, parent in pairs:',
  '        if mesh.vertex_groups.get(child) is None or mesh.vertex_groups.get(parent) is None:',
  '            continue',
  '        mesh.vertex_groups.active = mesh.vertex_groups[child]',
  '        try:',
  '            bpy.ops.object.vertex_group_smooth(factor=0.35, repeat=2, expand=0.05)',
  '        except Exception:',
  '            pass',
  '    try:',
  '        bpy.ops.object.vertex_group_normalize_all(lock_active=False)',
  '        bpy.ops.object.vertex_group_limit_total(limit=4)',
  '        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01)',
  '    except Exception:',
  '        pass',
  '    bpy.ops.object.mode_set(mode="OBJECT")',
  "print('AIAE_RIG_WEIGHT_REPAIR_OK')"
].join('\n')

/**
 * 应用侧硬 QA：结构 + 权重采样 + 标准 Pose（bound_box）数值门禁。
 * 通过 stdout 打印 AIAE_RIG_QA JSON；不写盘。
 * 刻意轻量，避免稠密网格全顶点扫描把 MCP TCP 掐断。
 */
export const BLENDER_RIG_QA_CODE = [
  `# ${AIAE_RIG_QA_MARKER}`,
  'import bpy',
  'import json',
  'import math',
  'from mathutils import Euler, Vector',
  'required = [' + HUMANOID_BONE_NAMES.map((n) => `"${n}"`).join(', ') + ']',
  'parents = {',
  '    "Hips": "", "Spine": "Hips", "Chest": "Spine", "Neck": "Chest", "Head": "Neck",',
  '    "L_Shoulder": "Chest", "L_UpperArm": "L_Shoulder", "L_ForeArm": "L_UpperArm", "L_Hand": "L_ForeArm",',
  '    "R_Shoulder": "Chest", "R_UpperArm": "R_Shoulder", "R_ForeArm": "R_UpperArm", "R_Hand": "R_ForeArm",',
  '    "L_UpLeg": "Hips", "L_LoLeg": "L_UpLeg", "L_Foot": "L_LoLeg", "L_Toes": "L_Foot",',
  '    "R_UpLeg": "Hips", "R_LoLeg": "R_UpLeg", "R_Foot": "R_LoLeg", "R_Toes": "R_Foot"',
  '}',
  `SAMPLE_CAP = ${RIG_QA_WEIGHT_SAMPLE_CAP}`,
  'fails = []',
  'notes = []',
  'bone_names = []',
  'geom = []',
  'deform = []',
  'vg_names = set()',
  'unweighted_ratio = 1.0',
  'max_inf = 0',
  'sum_err = 1.0',
  'zero_bones = []',
  'pose_metrics = []',
  'required_ok = False',
  'parent_ok = False',
  'passed = False',
  'try:',
  '    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]',
  '    if not arms:',
  '        fails.append({"code": "NO_ARMATURE", "message": "scene has no armature"})',
  '        raise RuntimeError("no armature")',
  '    arm = arms[0]',
  '    if bpy.context.view_layer.objects.active is not None:',
  '        bpy.ops.object.mode_set(mode="OBJECT")',
  '    bpy.context.view_layer.objects.active = arm',
  '    for pb in arm.pose.bones:',
  '        pb.rotation_mode = "XYZ"',
  '        pb.rotation_euler = (0.0, 0.0, 0.0)',
  '        pb.location = (0.0, 0.0, 0.0)',
  '    bpy.context.view_layer.update()',
  '    bone_names = [b.name for b in arm.data.bones]',
  '    required_ok = True',
  '    for name in required:',
  '        if name not in bone_names:',
  '            required_ok = False',
  '            fails.append({"code": "MISSING_BONE", "message": "missing " + name, "bone": name})',
  '    parent_ok = True',
  '    for name, expect in parents.items():',
  '        b = arm.data.bones.get(name)',
  '        if b is None:',
  '            continue',
  '        actual = b.parent.name if b.parent else ""',
  '        if actual != expect:',
  '            parent_ok = False',
  '            fails.append({"code": "BAD_PARENT", "message": name + " parent=" + actual + " expect=" + expect, "bone": name})',
  '    for b in arm.data.bones:',
  '        head = arm.matrix_world @ b.head_local',
  '        tail = arm.matrix_world @ b.tail_local',
  '        geom.append({"name": b.name, "parent": b.parent.name if b.parent else "", "head": [head.x, head.y, head.z], "tail": [tail.x, tail.y, tail.z]})',
  '    for mesh in bpy.data.objects:',
  '        if mesh.type != "MESH":',
  '            continue',
  '        if mesh.name.startswith("AIAE_LM_"):',
  '            continue',
  '        has_arm = False',
  '        for mod in mesh.modifiers:',
  '            if mod.type == "ARMATURE" and mod.object == arm:',
  '                has_arm = True',
  '        if has_arm or mesh.parent == arm or mesh.vertex_groups:',
  '            deform.append(mesh)',
  '    if not deform:',
  '        fails.append({"code": "NO_DEFORM_MESH", "message": "no skinned mesh"})',
  '    unweighted = 0',
  '    total_v = 0',
  '    max_inf = 0',
  '    sum_err = 0.0',
  '    influence = {n: 0.0 for n in bone_names}',
  '    for mesh in deform:',
  '        for g in mesh.vertex_groups:',
  '            vg_names.add(g.name)',
  '        verts = mesh.data.vertices',
  '        n = len(verts)',
  '        if n <= 0:',
  '            continue',
  '        step = max(1, int(math.ceil(n / float(SAMPLE_CAP))))',
  '        if step > 1:',
  '            notes.append("weight_sample_stride=" + str(step) + " mesh=" + mesh.name)',
  '        for i in range(0, n, step):',
  '            v = verts[i]',
  '            total_v += 1',
  '            weights = []',
  '            for g in v.groups:',
  '                grp = mesh.vertex_groups[g.group]',
  '                if grp.name in influence:',
  '                    weights.append((grp.name, g.weight))',
  '                    influence[grp.name] = influence[grp.name] + g.weight',
  '            if not weights:',
  '                unweighted += 1',
  '                continue',
  '            if len(weights) > max_inf:',
  '                max_inf = len(weights)',
  '            s = 0.0',
  '            for pair in weights:',
  '                s += pair[1]',
  '            sum_err = max(sum_err, abs(s - 1.0))',
  '    unweighted_ratio = (unweighted / total_v) if total_v else 1.0',
  '    zero_bones = [n for n in bone_names if influence.get(n, 0.0) <= 1e-6]',
  '    if unweighted_ratio > 0.08:',
  '        fails.append({"code": "UNWEIGHTED", "message": "unweighted ratio " + str(round(unweighted_ratio, 4))})',
  '    if not vg_names:',
  '        fails.append({"code": "NO_VERTEX_GROUPS", "message": "vertex groups empty"})',
  '    if zero_bones:',
  '        fails.append({"code": "ZERO_INFLUENCE", "message": ",".join(zero_bones[:8])})',
  '    def mesh_bbox_diag():',
  '        xs = []',
  '        ys = []',
  '        zs = []',
  '        for mesh in deform:',
  '            mw = mesh.matrix_world',
  '            for corner in mesh.bound_box:',
  '                p = mw @ Vector(corner)',
  '                xs.append(p.x)',
  '                ys.append(p.y)',
  '                zs.append(p.z)',
  '        if not xs:',
  '            return 0.0',
  '        return math.sqrt((max(xs)-min(xs))**2 + (max(ys)-min(ys))**2 + (max(zs)-min(zs))**2)',
  '    rest_diag = mesh_bbox_diag()',
  '    pose_specs = [',
  '        ("arms_up", [("L_UpperArm", (0.0, 0.0, -1.2)), ("R_UpperArm", (0.0, 0.0, 1.2))]),',
  '        ("elbows", [("L_ForeArm", (0.0, -1.4, 0.0)), ("R_ForeArm", (0.0, -1.4, 0.0))]),',
  '        ("knees", [("L_LoLeg", (1.2, 0.0, 0.0)), ("R_LoLeg", (1.2, 0.0, 0.0))])',
  '    ]',
  '    for pose_name, rots in pose_specs:',
  '        for pb in arm.pose.bones:',
  '            pb.rotation_euler = (0.0, 0.0, 0.0)',
  '        for bone_name, euler in rots:',
  '            pb = arm.pose.bones.get(bone_name)',
  '            if pb is not None:',
  '                pb.rotation_euler = Euler(euler, "XYZ")',
  '        bpy.context.view_layer.update()',
  '        diag = mesh_bbox_diag()',
  '        growth = (diag / rest_diag) if rest_diag > 1e-6 else 99.0',
  '        ok = growth < 1.85',
  '        if not ok:',
  '            fails.append({"code": "POSE_EXPLODE", "message": pose_name + " growth=" + str(round(growth, 3))})',
  '        pose_metrics.append({"name": pose_name, "bboxGrowth": growth, "spikeCount": 0, "ok": ok})',
  '    for pb in arm.pose.bones:',
  '        pb.rotation_euler = (0.0, 0.0, 0.0)',
  '    bpy.context.view_layer.update()',
  '    passed = len(fails) == 0 and required_ok and parent_ok and unweighted_ratio <= 0.08 and len(vg_names) > 0',
  'except Exception as exc:',
  '    fails.append({"code": "QA_EXEC", "message": str(exc)[:240]})',
  '    passed = False',
  'report = {',
  '    "pass": passed,',
  '    "boneCount": len(bone_names),',
  '    "requiredBonesOk": required_ok,',
  '    "parentChainOk": parent_ok,',
  '    "vertexGroupCount": len(vg_names),',
  '    "unweightedRatio": unweighted_ratio,',
  '    "maxInfluences": max_inf,',
  '    "weightSumError": sum_err,',
  '    "zeroInfluenceBones": zero_bones,',
  '    "deformMeshes": [m.name for m in deform],',
  '    "bones": geom,',
  '    "poseMetrics": pose_metrics,',
  '    "fails": fails,',
  '    "notes": notes',
  '}',
  `print('${AIAE_RIG_QA_PREFIX}' + json.dumps(report, separators=(',', ':')))`,
  "print('AIAE_RIG_QA_OK', passed)"
].join('\n')

export const BLENDER_RIG_PREPARE_EXPORT_CODE = [
  'import bpy',
  'if bpy.context.view_layer.objects.active is not None:',
  '    bpy.ops.object.mode_set(mode="OBJECT")',
  'arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]',
  'if arms:',
  '    arm = arms[0]',
  '    bpy.context.view_layer.objects.active = arm',
  '    if arm.pose:',
  '        for pb in arm.pose.bones:',
  '            pb.rotation_mode = "XYZ"',
  '            pb.rotation_euler = (0.0, 0.0, 0.0)',
  '            pb.location = (0.0, 0.0, 0.0)',
  '    bpy.context.view_layer.update()',
  'temps = [o for o in bpy.data.objects if o.name.startswith("AIAE_LM_")]',
  'for o in temps:',
  '    bpy.data.objects.remove(o, do_unlink=True)',
  "print('AIAE_RIG_PREPARE_EXPORT_OK')"
].join('\n')

export function humanoidIterativeRecipe(): string {
  return [
    'Expanded recipe (humanoid iterative skinning):',
    '1) Import input.glb once.',
    `2) Run execute_blender_code with marker ${AIAE_HUMANOID_LANDMARKS_MARKER} verbatim (creates AIAE_LM_* empties from mesh walks; accessories/hair excluded). Do not invent joint coords.`,
    '3) Take get_viewport_screenshot from front/side if needed; move AIAE_LM_* empties only when a joint is clearly wrong.',
    `4) Run execute_blender_code with marker ${AIAE_HUMANOID_BIND_MARKER} verbatim (bones ONLY from empties + ARMATURE_AUTO + weight cleanup).`,
    '5) Do NOT export yet and do NOT write result.json. The app runs hard QA and may ask for repair.',
    'Landmark script:',
    BLENDER_HUMANOID_LANDMARKS_CODE,
    'Bind script:',
    BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE,
    'Weight repair script (only when QA says UNWEIGHTED / POSE_EXPLODE / ZERO_INFLUENCE):',
    BLENDER_RIG_WEIGHT_REPAIR_CODE
  ].join('\n')
}

export function buildRigRepairTaskHint(qa: RigQaReport): string {
  if (isTransientRigQa(qa)) {
    return [
      'Previous app QA could not talk to Blender (transient MCP disconnect / timeout).',
      summarizeRigQaForAgent(qa),
      'Do NOT rebuild landmarks unless the scene lost the armature. Wait, then confirm Armature still exists. Do not export — the app will re-run hard QA.'
    ].join('\n')
  }
  const jointFails = qa.fails.some(
    (f) =>
      f.code === 'MISSING_BONE' ||
      f.code === 'BAD_PARENT' ||
      f.code === 'NO_ARMATURE' ||
      f.code === 'landmarks_unreliable'
  )
  const weightFails = qa.fails.some(
    (f) =>
      f.code === 'UNWEIGHTED' ||
      f.code === 'POSE_EXPLODE' ||
      f.code === 'ZERO_INFLUENCE' ||
      f.code === 'NO_VERTEX_GROUPS'
  )
  const lines = [
    'Previous app QA failed. Repair the CURRENT Blender scene (do not re-import unless the scene is empty).',
    summarizeRigQaForAgent(qa)
  ]
  if (jointFails) {
    lines.push(
      `Adjust AIAE_LM_* empties, then re-run ${AIAE_HUMANOID_BIND_MARKER} verbatim. If landmarks are missing, re-run ${AIAE_HUMANOID_LANDMARKS_MARKER} first.`
    )
  }
  if (weightFails) {
    lines.push(
      `Run ${AIAE_RIG_WEIGHT_REPAIR_MARKER} verbatim, or tweak shoulder/hip vertex groups then normalize/limit/clean.`
    )
  }
  lines.push('Do not export. The app will re-run hard QA.')
  return lines.join('\n')
}
