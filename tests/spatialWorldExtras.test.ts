import { describe, expect, it } from 'vitest'
import {
  extraDownloadSuffix,
  extraDownloadUrlExt,
  hasPendingExtras,
  recoveryDelayMs,
  shouldRecoverJob,
  siblingOutputPath
} from '../src/main/services/videoJobService'
import {
  pickSpzUrl,
  pickWorldId,
  spatialWorldExtraDownloads
} from '../src/main/services/modelProviders/worldlabs/adapter'

/**
 * 空间世界的附加产物：SPZ 高斯泼溅与 360 全景图**随 world 一起返回**（不用调
 * `worlds/{id}:export`，也不额外扣积分），落盘在主产物旁边的同名文件里，
 * 导入 Blender / Unreal 时整个文件夹搬过去即可。
 */
describe('world extra downloads', () => {
  it('collects splats + pano from the world response', () => {
    const extras = spatialWorldExtraDownloads({
      id: 'w-1',
      assets: {
        mesh: { collider_mesh_url: 'https://cdn.example.com/world.glb' },
        splats: {
          spz_urls: {
            '500k': 'https://cdn.example.com/world_500k.spz',
            full_res: 'https://cdn.example.com/world.spz'
          }
        },
        imagery: { pano_url: 'https://cdn.example.com/world_pano.png' }
      }
    })
    expect(extras).toEqual([
      { kind: 'splats', url: 'https://cdn.example.com/world.spz' },
      { kind: 'pano', url: 'https://cdn.example.com/world_pano.png' }
    ])
  })

  it('returns nothing when the world carries no splats or pano', () => {
    expect(spatialWorldExtraDownloads({ id: 'w-1', assets: { mesh: {} } })).toEqual([])
    expect(spatialWorldExtraDownloads(null)).toEqual([])
  })

  it('picks the highest-resolution spz key it can recognise', () => {
    // 官方未固定键名：先认全分辨率别名，再按数字取最大的一份
    expect(pickSpzUrl({ full_res: 'https://c/full.spz', '500k': 'https://c/500.spz' })).toBe(
      'https://c/full.spz'
    )
    expect(pickSpzUrl({ '500k': 'https://c/500.spz', '2m': 'https://c/2m.spz' })).toBe(
      'https://c/2m.spz'
    )
    expect(
      pickSpzUrl({ splat_150000: 'https://c/150k.spz', splat_2000000: 'https://c/2m.spz' })
    ).toBe('https://c/2m.spz')
    expect(pickSpzUrl({ weird: 'https://c/only.spz' })).toBe('https://c/only.spz')
    // 非公网地址（本地路径 / data URL）与空映射都当没有
    expect(pickSpzUrl({ full_res: 'Cache/Models/x.spz' })).toBe('')
    expect(pickSpzUrl({})).toBe('')
    expect(pickSpzUrl(null)).toBe('')
  })

  /**
   * world_id 是「下游能不能用这个世界」的关键字段：网格 URL 拿得到、id 拿不到时，
   * 世界照样下载得下来，但「空间世界导出」永远用不了它 —— 所以这里按多种可能写法都试。
   */
  it('reads the world id wherever the upstream puts it', () => {
    expect(pickWorldId({ id: 'w-1' })).toBe('w-1')
    expect(pickWorldId({ id: '  w-1  ' })).toBe('w-1')
    // 上游未逐字段固定：另一些写法也要认
    expect(pickWorldId({ world_id: 'w-2' })).toBe('w-2')
    expect(pickWorldId({ world: { id: 'w-3' } })).toBe('w-3')
    expect(pickWorldId({ world: { world_id: 'w-4' } })).toBe('w-4')
    // 优先用最直接的 id
    expect(pickWorldId({ id: 'direct', world_id: 'other' })).toBe('direct')
    // 都没有就是空串（由调用方决定怎么报错），不猜
    expect(pickWorldId({ assets: { mesh: {} } })).toBe('')
    expect(pickWorldId({ id: '   ' })).toBe('')
    expect(pickWorldId(null)).toBe('')
    expect(pickWorldId(undefined)).toBe('')
  })
})

describe('extra output paths', () => {
  it('puts extras next to the main artifact with kind suffixes', () => {
    expect(extraDownloadSuffix('splats')).toBe('.spz')
    expect(extraDownloadSuffix('pano')).toBe('.pano.png')
    expect(extraDownloadSuffix('weird kind!')).toBe('.weirdkind')

    expect(siblingOutputPath('Cache/Models/world.glb', '.spz')).toBe('Cache/Models/world.spz')
    expect(siblingOutputPath('Cache/Models/world.glb', '.pano.png')).toBe(
      'Cache/Models/world.pano.png'
    )
    expect(siblingOutputPath('Assets\\Shots\\a.glb', '.spz')).toBe('Assets/Shots/a.spz')
    // 没有扩展名 / 没有目录也要稳
    expect(siblingOutputPath('Cache/Models/world', '.spz')).toBe('Cache/Models/world.spz')
    expect(siblingOutputPath('world.glb', '.spz')).toBe('world.spz')
  })

  /**
   * 泼溅只认 `.ply` / `.spz` 扩展名：上游直链给了后缀就按它落盘，
   * 否则（签名 URL / 按哈希命名）才退回按类型的 `.spz` 约定。
   */
  it('prefers the extension carried by the upstream URL', () => {
    expect(extraDownloadUrlExt('https://cdn.example.com/world.spz')).toBe('.spz')
    expect(extraDownloadUrlExt('https://cdn.example.com/a/b/world_full.PLY?sign=1#x')).toBe('.ply')
    expect(extraDownloadUrlExt('https://cdn.example.com/pano.png')).toBe('.png')
    // 拿不到后缀：交回调用方按类型约定兜底
    expect(extraDownloadUrlExt('https://cdn.example.com/signed-hash')).toBe('')
    expect(extraDownloadUrlExt('')).toBe('')
  })
})

/**
 * 「下载失败后的补取」：上游已经生成、积分已经花掉，只是文件没下回来 ——
 * 打开工程时应该自动再取一次，而不是让用户重新花钱生成。
 * 这里锁住判定条件本身（记录里存着 resourceId 才算数，不去猜 error 文案）。
 */
describe('job recovery decision', () => {
  const base = {
    status: 'failed' as const,
    kind: 'spatialWorld' as const,
    resourceId: 'w-1',
    providerJobId: 'op-1',
    pollingUrl: '',
    recoveryAttempts: 0,
    extras: undefined
  }

  it('recovers a failed job that still holds the upstream resource id', () => {
    expect(shouldRecoverJob(base)).toBe(true)
    // 只有 pollingUrl 也行（pollWorld 用它当 operation id）
    expect(shouldRecoverJob({ ...base, providerJobId: '', pollingUrl: 'op-1' })).toBe(true)
  })

  it('leaves alone what cannot be recovered without regenerating', () => {
    // 没拿到 resourceId：失败可能发生在提交 / 轮询阶段，重试没有意义
    expect(shouldRecoverJob({ ...base, resourceId: undefined })).toBe(false)
    expect(shouldRecoverJob({ ...base, resourceId: '  ' })).toBe(false)
    // 视频任务没有 resourceId 概念，这条通路不覆盖
    expect(shouldRecoverJob({ ...base, kind: 'video' })).toBe(false)
    // 没有 operation id 就重新拿不到直链
    expect(shouldRecoverJob({ ...base, providerJobId: '', pollingUrl: '' })).toBe(false)
    // 正在跑的 / 用户主动取消的不动
    expect(shouldRecoverJob({ ...base, status: 'running' })).toBe(false)
    expect(shouldRecoverJob({ ...base, status: 'submitted' })).toBe(false)
    expect(shouldRecoverJob({ ...base, status: 'cancelled' })).toBe(false)
  })

  it('gives up after the retry budget is spent', () => {
    expect(shouldRecoverJob({ ...base, recoveryAttempts: 2 })).toBe(true)
    expect(shouldRecoverJob({ ...base, recoveryAttempts: 3 })).toBe(false)
    expect(shouldRecoverJob({ ...base, recoveryAttempts: 9 })).toBe(false)
    // 预算可注入，便于按需收紧
    expect(shouldRecoverJob({ ...base, recoveryAttempts: 1 }, 1)).toBe(false)
    // 退避随次数递增，不与刚失败的那次挤在同一时间窗
    expect(recoveryDelayMs(1)).toBeLessThan(recoveryDelayMs(3))
  })

  it('also tops up extras that never made it to disk', () => {
    const succeeded = { ...base, status: 'succeeded' as const, extras: undefined }
    expect(shouldRecoverJob(succeeded)).toBe(false)
    // 成功的任务：主产物在，缺一项附加产物（只有直链、没有落盘路径）
    expect(
      shouldRecoverJob({
        ...succeeded,
        extras: [
          { kind: 'splats', url: 'https://c/world.spz', relativePath: 'Cache/Models/world.spz' },
          { kind: 'pano', url: 'https://c/world.pano.png' }
        ]
      })
    ).toBe(true)
    // 附加产物都齐了就不再打扰
    expect(
      shouldRecoverJob({
        ...succeeded,
        extras: [
          { kind: 'splats', url: 'https://c/world.spz', relativePath: 'Cache/Models/world.spz' },
          {
            kind: 'pano',
            url: 'https://c/world.pano.png',
            relativePath: 'Cache/Models/world.pano.png'
          }
        ]
      })
    ).toBe(false)
    expect(hasPendingExtras({ extras: [{ kind: 'pano', url: 'https://c/p.png' }] })).toBe(true)
    expect(hasPendingExtras({ extras: [] })).toBe(false)
  })
})
