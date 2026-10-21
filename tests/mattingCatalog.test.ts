import { describe, expect, it } from 'vitest'
import {
  findMattingCatalogModel,
  MATTING_CATALOG,
  pickPreferredMattingModel
} from '../src/shared/mattingCatalog'
import { isAllowedYoloDownloadUrl } from '../src/shared/yoloDownload'

describe('高精抠图模型下载目录（mattingCatalog）', () => {
  it('所有高精抠图 ONNX 条目 id 唯一且下载源在白名单内', () => {
    expect(MATTING_CATALOG.map((m) => m.id)).toEqual([
      'rmbg-1.4-q8',
      'birefnet-lite',
      'rmbg-1.4',
      'modnet'
    ])
    for (const model of MATTING_CATALOG) {
      expect(model.fileName).toBe(`${model.id}.onnx`)
      expect(isAllowedYoloDownloadUrl(model.url)).toBe(true)
      expect(model.minBytes).toBeGreaterThan(10 * 1024 * 1024)
      expect(findMattingCatalogModel(model.id)?.url).toBe(model.url)
    }
  })

  it('按精度优先级自动挑出首选已安装模型', () => {
    const picked = pickPreferredMattingModel([
      { id: 'modnet', kind: 'segment', path: '/m/modnet.onnx', sizeMb: 25 },
      { id: 'birefnet-lite', kind: 'segment', path: '/m/birefnet-lite.onnx', sizeMb: 178 },
      { id: 'rmbg-1.4-q8', kind: 'segment', path: '/m/rmbg-1.4-q8.onnx', sizeMb: 44 }
    ])
    expect(picked?.id).toBe('birefnet-lite')
  })
})
