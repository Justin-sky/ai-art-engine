import { describe, expect, it } from 'vitest'
import { guardBlenderCode } from '../src/shared/blenderMcp'
import {
  addEdge,
  detectHumanoidJoints,
  emptyAdj,
  HUMANOID_BONE_NAMES,
  type Vec3
} from '../src/shared/blenderHumanoidLandmarks'
import { BLENDER_HUMANOID_RIG_CODE } from '../src/shared/blenderHumanoidRig'

function densify(a: Vec3, b: Vec3, n: number): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  }
  return out
}

function findOrAdd(points: Vec3[], adj: number[][], p: Vec3): number {
  const eps = 1e-6
  for (let i = 0; i < points.length; i++) {
    const q = points[i]!
    if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= eps) return i
  }
  points.push(p)
  adj.push([])
  return points.length - 1
}

function chain(points: Vec3[], adj: number[][], a: Vec3, b: Vec3, n = 8): void {
  const seg = densify(a, b, n)
  let prev = -1
  for (const p of seg) {
    const i = findOrAdd(points, adj, p)
    if (prev >= 0) addEdge(adj, prev, i)
    prev = i
  }
}

function stickFigure() {
  const points: Vec3[] = []
  const adj = emptyAdj(0)
  const hips: Vec3 = [0, 1.0, 0]
  const chest: Vec3 = [0, 1.42, 0]
  const neck: Vec3 = [0, 1.58, 0]
  const head: Vec3 = [0, 1.82, 0]
  const lSho: Vec3 = [0.2, 1.5, 0]
  const lElb: Vec3 = [0.48, 1.32, 0]
  const lHnd: Vec3 = [0.78, 1.12, 0]
  const rSho: Vec3 = [-0.2, 1.5, 0]
  const rElb: Vec3 = [-0.48, 1.32, 0]
  const rHnd: Vec3 = [-0.78, 1.12, 0]
  const lHip: Vec3 = [0.12, 1.0, 0]
  const lKnee: Vec3 = [0.13, 0.52, 0]
  const lFoot: Vec3 = [0.12, 0.04, 0]
  const lToe: Vec3 = [0.12, 0.03, 0.14]
  const rHip: Vec3 = [-0.12, 1.0, 0]
  const rKnee: Vec3 = [-0.13, 0.52, 0]
  const rFoot: Vec3 = [-0.12, 0.04, 0]
  const rToe: Vec3 = [-0.12, 0.03, 0.14]
  chain(points, adj, hips, chest)
  chain(points, adj, chest, neck)
  chain(points, adj, neck, head)
  chain(points, adj, chest, lSho)
  chain(points, adj, lSho, lElb)
  chain(points, adj, lElb, lHnd)
  chain(points, adj, chest, rSho)
  chain(points, adj, rSho, rElb)
  chain(points, adj, rElb, rHnd)
  chain(points, adj, hips, lHip)
  chain(points, adj, lHip, lKnee)
  chain(points, adj, lKnee, lFoot)
  chain(points, adj, lFoot, lToe)
  chain(points, adj, hips, rHip)
  chain(points, adj, rHip, rKnee)
  chain(points, adj, rKnee, rFoot)
  chain(points, adj, rFoot, rToe)
  return {
    graph: { points, adj },
    marks: { head, lHnd, rHnd, lSho, rSho, lFoot, rFoot, hips }
  }
}

function near(a: Vec3, b: Vec3, tol = 0.22): void {
  const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  expect(d, `${a} vs ${b}`).toBeLessThan(tol)
}

describe('blenderHumanoidLandmarks', () => {
  it('places joints from mesh extremities, not a fixed 0.80 shoulder ratio', () => {
    const { graph, marks } = stickFigure()
    const { bones, usedFallback } = detectHumanoidJoints(graph)
    expect(usedFallback).toBe(false)
    expect(bones.map((b) => b.name)).toEqual([...HUMANOID_BONE_NAMES])
    const byName = Object.fromEntries(bones.map((b) => [b.name, b]))
    near(byName.Head.tail, marks.head)
    near(byName.L_Hand.tail, marks.lHnd)
    near(byName.R_Hand.tail, marks.rHnd)
    near(byName.L_UpperArm.head, marks.lSho)
    near(byName.R_UpperArm.head, marks.rSho)
    near(byName.L_Foot.head, marks.lFoot)
    near(byName.R_Foot.head, marks.rFoot)
    expect(byName.L_Shoulder.head[1]).toBeGreaterThan(byName.Hips.head[1] + 0.2)
    expect(byName.L_Hand.tail[0]).toBeGreaterThan(0.5)
    expect(byName.R_Hand.tail[0]).toBeLessThan(-0.5)
  })

  it('ships a mesh-walk Blender script that passes safe-mode', () => {
    expect(BLENDER_HUMANOID_RIG_CODE).toContain('mesh.data.edges')
    expect(BLENDER_HUMANOID_RIG_CODE).toContain('bfs_until')
    expect(BLENDER_HUMANOID_RIG_CODE).toContain('pick_hand')
    expect(BLENDER_HUMANOID_RIG_CODE).toContain('AIAE_LM_')
    expect(BLENDER_HUMANOID_RIG_CODE).toContain('landmarks_unreliable')
    expect(BLENDER_HUMANOID_RIG_CODE).not.toContain('wp(spec')
    const verdict = guardBlenderCode(BLENDER_HUMANOID_RIG_CODE)
    expect(verdict.ok, verdict.reason).toBe(true)
  })
})
