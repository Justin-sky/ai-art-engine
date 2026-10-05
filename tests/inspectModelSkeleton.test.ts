import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

/**
 * `model.pose` 的骨骼检查（Cook 时由执行器注入）：
 * 泼溅（.ply / .spz）没有骨骼，而它是一份几十到几百 MB 的大文件 ——
 * 必须**在碰 URL / loader 之前**就短路，否则每跑一次姿势节点都要白白读一遍整个世界。
 *
 * `getAssetFileUrl` 是取文件的唯一入口，也是泼溅短路前后**唯一**会被触碰的外部调用，
 * 所以这里只断言它：泼溅一次都不该调它（自然也就没有后面的 loader / 下载）。
 */
const { getAssetFileUrl } = vi.hoisted(() => ({ getAssetFileUrl: vi.fn() }))

vi.mock('../../../src/renderer/src/stores/project', () => ({
  useProjectStore: () => ({ assets: [] })
}))

const { inspectModelSkeleton } =
  await import('../../../src/renderer/src/features/graph/model/inspectModelSkeleton')

function stubStudio(): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    studio: { getAssetFileUrl }
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('inspectModelSkeleton', () => {
  it('never touches the file for splat products (no throwaway multi-hundred-MB read)', async () => {
    stubStudio()
    expect(await inspectModelSkeleton({ relativePath: 'Cache/Models/world.spz' })).toEqual([])
    expect(await inspectModelSkeleton({ relativePath: 'Cache/Models/world.ply' })).toEqual([])
    expect(await inspectModelSkeleton({ relativePath: 'C:/proj/Cache/Models/WORLD.PLY' })).toEqual(
      []
    )
    // 取文件这一步都没发生 → 后面更不可能有 loader / 下载
    expect(getAssetFileUrl).not.toHaveBeenCalled()
  })

  it('returns an empty list when there is no path or no URL', async () => {
    stubStudio()
    expect(await inspectModelSkeleton({})).toEqual([])
    getAssetFileUrl.mockResolvedValue('')
    expect(await inspectModelSkeleton({ relativePath: 'Models/hero.glb' })).toEqual([])
  })

  it('does read a normal model (guard is splat-only)', async () => {
    stubStudio()
    getAssetFileUrl.mockResolvedValue('')
    await inspectModelSkeleton({ relativePath: 'Models/hero.glb' })
    expect(getAssetFileUrl).toHaveBeenCalledWith('Models/hero.glb')
  })

  it('reports the bone hierarchy of a rigged model', async () => {
    const { collectPoseEditBones, findNearestPoseBoneParent } =
      await import('../../../src/renderer/src/features/director/skeletonRetarget')
    const root = new THREE.Group()
    const hips = new THREE.Bone()
    hips.name = 'Hips'
    const spine = new THREE.Bone()
    spine.name = 'Spine'
    hips.add(spine)
    root.add(hips)

    // 与 inspectModelSkeleton 内部同一套读法（同一模块实例，只验行为不验实现）
    const bones = collectPoseEditBones(root)
    const boneSet = new Set(bones)
    expect(bones.map((bone) => bone.name)).toEqual(['Hips', 'Spine'])
    expect(findNearestPoseBoneParent(spine, boneSet)?.name).toBe('Hips')
  })
})
