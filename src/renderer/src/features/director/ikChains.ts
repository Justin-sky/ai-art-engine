import * as THREE from 'three'
import type { DirectorIkChainSpec, DirectorIkChainSlotId } from '@shared/domain'
import {
  collectSkinningBones,
  isAuxiliaryPoseBone,
  normalizeBoneName
} from './skeletonRetarget'

export type IkChainSlot = DirectorIkChainSlotId

export type IkChain = {
  id: IkChainSlot
  /** ???????? */
  effector: string
  /** ????????? */
  links: string[]
  /** ?????????? */
  manual?: boolean
}

export const IK_CHAIN_SLOTS: IkChainSlot[] = ['slot1', 'slot2', 'slot3', 'slot4']

type AutoSlotHint = {
  id: IkChainSlot
  kind: 'hand' | 'foot'
  side: 'left' | 'right'
}

/** ?????????????????????? UI? */
const AUTO_SLOT_HINTS: AutoSlotHint[] = [
  { id: 'slot1', kind: 'hand', side: 'left' },
  { id: 'slot2', kind: 'hand', side: 'right' },
  { id: 'slot3', kind: 'foot', side: 'left' },
  { id: 'slot4', kind: 'foot', side: 'right' }
]

function isEffectorKey(key: string, kind: 'hand' | 'foot'): boolean {
  if (kind === 'hand') {
    if (/thumb|index|middle|ring|pinky|finger/.test(key)) return false
    return /(^|[^a-z])(hand|wrist)([^a-z]|$)/.test(key) || key.endsWith('hand') || key.endsWith('wrist')
  }
  if (/toe|ball/.test(key)) return false
  return /(^|[^a-z])(foot|ankle)([^a-z]|$)/.test(key) || key.endsWith('foot') || key.endsWith('ankle')
}

function sideOfKey(key: string): 'left' | 'right' | null {
  if (key.includes('left')) return 'left'
  if (key.includes('right')) return 'right'
  if (/^l(hand|wrist|foot|ankle|arm|forearm|upleg|leg|shoulder)/.test(key)) return 'left'
  if (/^r(hand|wrist|foot|ankle|arm|forearm|upleg|leg|shoulder)/.test(key)) return 'right'
  return null
}

function isChainStopKey(key: string): boolean {
  return (
    /^(hips?|pelvis|spine\d*|chest|neck|head|root|armature)$/.test(key) ||
    key.includes('spine') ||
    key === 'hips' ||
    key === 'hip' ||
    key === 'pelvis'
  )
}

/** ? effector ??????????????????????????? */
export function collectIkLinkNames(effector: THREE.Bone, maxLinks = 3): string[] {
  const links: string[] = []
  let p: THREE.Object3D | null = effector.parent
  while (p && links.length < maxLinks) {
    if (p instanceof THREE.Bone) {
      const name = p.name?.trim()
      if (name && !isAuxiliaryPoseBone(name)) {
        const key = normalizeBoneName(name)
        if (isChainStopKey(key)) break
        links.push(name)
      }
    }
    p = p.parent
  }
  return links
}

export function findBoneByName(root: THREE.Object3D, boneName: string): THREE.Bone | null {
  const key = boneName.trim()
  if (!key) return null
  for (const bone of collectSkinningBones(root)) {
    if (bone.name?.trim() === key) return bone
  }
  return null
}

/** ???????????links ?????????????? */
export function resolveIkChainFromSpec(
  root: THREE.Object3D,
  spec: DirectorIkChainSpec
): IkChain | null {
  const effectorName = spec.effector?.trim()
  if (!effectorName) return null
  const effector = findBoneByName(root, effectorName)
  let links =
    spec.links?.map((n) => n.trim()).filter(Boolean) ??
    (effector ? collectIkLinkNames(effector, 3) : [])
  links = links.filter((n) => n !== effectorName)
  if (!links.length) return null
  links = links.filter((n) => !!findBoneByName(root, n))
  if (!links.length) return null
  return { id: spec.id, effector: effectorName, links, manual: true }
}

/** ???? ? ??????? id ?????? */
export function mergeIkChains(
  root: THREE.Object3D,
  overrides?: DirectorIkChainSpec[] | null
): IkChain[] {
  const byId = new Map<IkChainSlot, IkChain>()
  for (const chain of detectDefaultIkChains(root)) {
    byId.set(chain.id, chain)
  }
  if (overrides?.length) {
    for (const spec of overrides) {
      const resolved = resolveIkChainFromSpec(root, spec)
      if (resolved) byId.set(resolved.id, resolved)
    }
  }
  return IK_CHAIN_SLOTS.map((id) => byId.get(id)).filter((c): c is IkChain => !!c)
}

function pickEffector(
  bones: THREE.Bone[],
  kind: 'hand' | 'foot',
  side: 'left' | 'right'
): THREE.Bone | null {
  const scored: { bone: THREE.Bone; score: number }[] = []
  for (const bone of bones) {
    const name = bone.name?.trim()
    if (!name || isAuxiliaryPoseBone(name)) continue
    const key = normalizeBoneName(name)
    if (!isEffectorKey(key, kind)) continue
    if (sideOfKey(key) !== side) continue
    scored.push({ bone, score: key.length })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored[0]?.bone ?? null
}

/** ????????? IK ????????????? */
export function detectDefaultIkChains(root: THREE.Object3D): IkChain[] {
  const bones = collectSkinningBones(root)
  if (!bones.length) return []

  const out: IkChain[] = []
  for (const hint of AUTO_SLOT_HINTS) {
    const effector = pickEffector(bones, hint.kind, hint.side)
    if (!effector) continue
    const effectorName = effector.name.trim()
    const links = collectIkLinkNames(effector, 3)
    if (links.length < 1) continue
    out.push({ id: hint.id, effector: effectorName, links, manual: false })
  }
  return out
}
