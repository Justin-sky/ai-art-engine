import { describe, expect, it } from 'vitest'
import {
  findSam2CatalogModel,
  SAM2_CATALOG,
  SAM2_CATALOG_BASE_URL,
  sam2OnnxFileNames
} from '../src/shared/sam2Catalog'
import { isAllowedYoloDownloadUrl } from '../src/shared/yoloDownload'

describe('SAM 2.1 下载目录', () => {
  it('四档 ONNX 压缩包地址可下载且互不重复', () => {
    expect(SAM2_CATALOG.map((model) => model.id)).toEqual([
      'sam2.1_hiera_tiny',
      'sam2.1_hiera_small',
      'sam2.1_hiera_base_plus',
      'sam2.1_hiera_large'
    ])
    const ids = SAM2_CATALOG.map((model) => model.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const model of SAM2_CATALOG) {
      expect(model.fileName).toBe(`${model.id}_20260221.zip`)
      expect(model.url).toBe(`${SAM2_CATALOG_BASE_URL}/${model.fileName}`)
      expect(isAllowedYoloDownloadUrl(model.url)).toBe(true)
      expect(model.minBytes).toBeGreaterThan(50 * 1024 * 1024)
      expect(findSam2CatalogModel(model.id)?.fileName).toBe(model.fileName)
      expect(sam2OnnxFileNames(model.id)).toEqual({
        encoder: `${model.id}.encoder.onnx`,
        decoder: `${model.id}.decoder.onnx`
      })
    }
  })
})
