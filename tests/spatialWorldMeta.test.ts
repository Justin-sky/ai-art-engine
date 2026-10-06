import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findWorldMetaByJob,
  mergeSpatialWorldMeta,
  readSpatialWorldExtras,
  readSpatialWorldId,
  type SpatialWorldJobLike
} from '../src/shared/spatialWorldMeta'

/**
 * 世界的**身份与附件**要落进资产记录。
 *
 * 起因：`world_id` 与两份附件（`.spz` 高斯泼溅 / 360 全景）原先**只存在于图的节点参数**
 * （运行态），资产记录里什么都没有。后果有两条，都是真的：
 *
 * 1. 「空间世界导出」只认 `world_id` —— 重启应用后拿不到它，**再也导不出网格**
 * 2. 泼溅与全景留在 `Cache/`，既不是资产库资产、也没有任何记录说明它们属于这个世界；
 *    缓存被清理后，这个「可漫游世界」就只剩网格了
 *
 * 判定逻辑抽成纯函数（主进程服务依赖 Electron 单例，测不了）。
 */
describe('mergeSpatialWorldMeta：只写有值的字段', () => {
  it('写入 world_id 与附件', () => {
    const merged = mergeSpatialWorldMeta(
      {},
      {
        spatialWorldId: 'ec78f30d',
        spatialWorldExtras: [
          { kind: 'splats', relativePath: 'Cache/Models/w.spz', assetId: 'splat-1' },
          { kind: 'pano', relativePath: 'Cache/Models/w.png' }
        ]
      }
    )
    expect(merged.spatialWorldId).toBe('ec78f30d')
    expect(merged.spatialWorldExtras).toHaveLength(2)
  })

  it('不改动原对象（纯函数）', () => {
    const base = { transform: { x: 1 } }
    mergeSpatialWorldMeta(base, { spatialWorldId: 'w1' })
    expect(base).toEqual({ transform: { x: 1 } })
  })

  it('保留 base 里的其它字段', () => {
    const merged = mergeSpatialWorldMeta(
      { transform: { x: 1 }, color: '#fff' },
      { spatialWorldId: 'w1' }
    )
    expect(merged).toMatchObject({ transform: { x: 1 }, color: '#fff', spatialWorldId: 'w1' })
  })

  it('空值不覆盖已有信息（附件下载失败不该抹掉上次的路径）', () => {
    const prev = {
      spatialWorldId: 'w1',
      spatialWorldExtras: [{ kind: 'splats', relativePath: 'Cache/a.spz' }]
    }
    const merged = mergeSpatialWorldMeta(prev, {})
    expect(merged.spatialWorldId).toBe('w1')
    expect(merged.spatialWorldExtras).toHaveLength(1)
  })

  it('world_id 以新值为准（重新生成后就是新的世界）', () => {
    expect(
      mergeSpatialWorldMeta({ spatialWorldId: 'old' }, { spatialWorldId: 'new' }).spatialWorldId
    ).toBe('new')
  })

  it('附件里没有 relativePath 的条目被丢掉', () => {
    const merged = mergeSpatialWorldMeta(
      {},
      {
        spatialWorldExtras: [
          { kind: 'splats', relativePath: '  ' },
          { kind: 'pano', relativePath: 'Cache/Models/w.png' }
        ]
      }
    )
    expect(merged.spatialWorldExtras).toHaveLength(1)
    expect(merged.spatialWorldExtras?.[0]?.kind).toBe('pano')
  })

  it('base 为 undefined 也能用', () => {
    expect(mergeSpatialWorldMeta(undefined, { spatialWorldId: 'w1' }).spatialWorldId).toBe('w1')
  })
})

describe('读取助手：脏数据一律丢掉', () => {
  it('readSpatialWorldId 只认非空字符串', () => {
    expect(readSpatialWorldId({ spatialWorldId: ' w1 ' })).toBe('w1')
    expect(readSpatialWorldId({ spatialWorldId: '   ' })).toBeUndefined()
    expect(readSpatialWorldId({ spatialWorldId: 123 })).toBeUndefined()
    expect(readSpatialWorldId({})).toBeUndefined()
    expect(readSpatialWorldId(null)).toBeUndefined()
  })

  it('readSpatialWorldExtras 丢掉非法条目', () => {
    const extras = readSpatialWorldExtras({
      spatialWorldExtras: [
        { kind: 'splats', relativePath: 'Cache/a.spz', assetId: 'id-1' },
        { kind: 'pano' },
        'not-an-object',
        null,
        { kind: 'pano', relativePath: 'Cache/b.png' }
      ]
    })
    expect(extras.map((e) => e.relativePath)).toEqual(['Cache/a.spz', 'Cache/b.png'])
    expect(extras[0]?.assetId).toBe('id-1')
    // 缺 kind 的给个兜底名，不要变成 undefined
    expect(extras[1]?.kind).toBe('pano')
  })

  it('非数组返回空清单（不抛错）', () => {
    expect(readSpatialWorldExtras({ spatialWorldExtras: 'oops' })).toEqual([])
    expect(readSpatialWorldExtras(undefined)).toEqual([])
  })
})

describe('findWorldMetaByJob：从任务记录里找回世界的身份', () => {
  const jobs: SpatialWorldJobLike[] = [
    {
      kind: 'spatialWorldExport',
      assetId: 'export-1',
      relativePath: 'Cache/Models/export.glb'
    },
    {
      kind: 'spatialWorld',
      assetId: 'world-asset-1',
      relativePath: 'Cache/Models/世界.glb',
      resourceId: 'ec78f30d',
      extras: [
        { kind: 'splats', relativePath: 'Cache/Models/世界.spz', assetId: 'splat-1' },
        { kind: 'pano', relativePath: 'Cache/Models/世界.png' },
        { kind: 'pano', relativePath: '   ' }
      ]
    }
  ]

  it('按资产 id 命中，抽出 world_id 与附件（丢掉空路径）', () => {
    const meta = findWorldMetaByJob(jobs, { assetId: 'world-asset-1' })
    expect(meta?.spatialWorldId).toBe('ec78f30d')
    expect(meta?.spatialWorldExtras?.map((e) => e.kind)).toEqual(['splats', 'pano'])
    expect(meta?.spatialWorldExtras?.[0]?.assetId).toBe('splat-1')
  })

  it('资产 id 对不上时退回按相对路径匹配', () => {
    const meta = findWorldMetaByJob(jobs, { relativePath: 'Cache/Models/世界.glb' })
    expect(meta?.spatialWorldId).toBe('ec78f30d')
  })

  it('**不会**命中导出任务（`spatialWorldExport` 不是世界生成）', () => {
    expect(findWorldMetaByJob(jobs, { assetId: 'export-1' })).toBeNull()
    expect(findWorldMetaByJob(jobs, { relativePath: 'Cache/Models/export.glb' })).toBeNull()
  })

  it('查不到返回 null', () => {
    expect(findWorldMetaByJob(jobs, { assetId: 'nope' })).toBeNull()
    expect(findWorldMetaByJob([], { assetId: 'world-asset-1' })).toBeNull()
  })

  it('只有 extras、没有 world_id 时也算找到（附件仍然要带走）', () => {
    const meta = findWorldMetaByJob(
      [{ kind: 'spatialWorld', assetId: 'a', extras: [{ kind: 'splats', relativePath: 'x.spz' }] }],
      { assetId: 'a' }
    )
    expect(meta?.spatialWorldId).toBeUndefined()
    expect(meta?.spatialWorldExtras).toHaveLength(1)
  })

  it('两者都没有时返回 null（避免写入一个空壳）', () => {
    expect(
      findWorldMetaByJob([{ kind: 'spatialWorld', assetId: 'a' }], { assetId: 'a' })
    ).toBeNull()
  })
})

/**
 * 主进程侧的接线（依赖 Electron 单例，跑不起来，按源码断言）。
 */
describe('主进程接线：身份落盘 + 附件跟随', () => {
  const VIDEO_JOB = readFileSync(resolve('src/main/services/videoJobService.ts'), 'utf8')
  const PROJECT = readFileSync(resolve('src/main/services/projectService.ts'), 'utf8')

  it('附件下载完把 world_id 与附件写回资产记录', () => {
    expect(VIDEO_JOB).toContain('persistWorldMetaOnAsset')
    expect(VIDEO_JOB).toMatch(/this\.persistWorldMetaOnAsset\(job, resolved\)/)
    // 只对世界生成做，导出任务不该被当成世界
    expect(VIDEO_JOB).toMatch(/if \(job\.kind !== 'spatialWorld'\) return/)
  })

  it('写回前重读最新资产（任务期间可能被改名 / 移动 / 入库）', () => {
    expect(VIDEO_JOB).toMatch(
      /private persistWorldMetaOnAsset[\s\S]{0,1600}projectService\.listAssets\(\)\.find/
    )
  })

  it('保存到资产库时把附件一并复制并登记', () => {
    expect(PROJECT).toContain('attachSpatialWorldExtras')
    expect(PROJECT).toMatch(/copy world \$\{extra\.kind\} attachment/)
    // 关联关系写回主产物
    expect(PROJECT).toMatch(/spatialWorldExtras: linked/)
  })

  it('附件缺失时不阻断主产物入库（留着原路径记录）', () => {
    expect(PROJECT).toMatch(/if \(!existsSync\(srcAbs\)\) \{[\s\S]{0,200}linked\.push\(extra\)/)
  })

  it('循环依赖已打断：projectService 不 import videoJobService', () => {
    // videoJobService 依赖 projectService（读工程、登记资产），反向再依赖就成环
    expect(PROJECT).not.toMatch(/from '\.\/videoJobService'/)
    expect(PROJECT).toContain('setWorldMetaJobResolver')
    expect(VIDEO_JOB).toMatch(/setWorldMetaJobResolver\(\(\) => videoJobService\.list\(\)\)/)
  })

  it('附件类型走既有判定（.spz → 模型资产 / .png → 图片资产）', () => {
    expect(PROJECT).toMatch(/attachSpatialWorldExtras[\s\S]{0,2000}detectAssetType\(srcAbs\)/)
  })
})
