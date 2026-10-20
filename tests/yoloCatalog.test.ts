import { describe, expect, it } from 'vitest'
import { YOLO_CATALOG, YOLO_KIND_ORDER, YOLO_SCALE_ORDER } from '../src/shared/yoloCatalog'
import {
  isBuiltinDecodableBytes,
  isBuiltinDecodableDataUrl,
  isJpegBytes,
  isPngBytes,
  isWebpBytes
} from '../src/main/yolo/imageDecoder'

describe('YOLO 官方可下载目录（yoloCatalog）', () => {
  it('覆盖 detect / segment / pose × s/m/l/x，id 全局唯一', () => {
    expect(YOLO_CATALOG.length).toBe(YOLO_KIND_ORDER.length * YOLO_SCALE_ORDER.length)
    expect(YOLO_CATALOG.length).toBe(12)
    expect(new Set(YOLO_CATALOG.map((m) => m.id)).size).toBe(YOLO_CATALOG.length)
    for (const kind of YOLO_KIND_ORDER) {
      expect(YOLO_CATALOG.filter((m) => m.kind === kind).length).toBe(YOLO_SCALE_ORDER.length)
    }
  })

  it('文件名后缀与官方 release 资产一致（segment 是 -seg，不是 -segment），url 指向对应资产', () => {
    for (const m of YOLO_CATALOG) {
      expect(m.fileName).toBe(`${m.id}.onnx`)
      expect(m.url.endsWith(`/${m.fileName}`)).toBe(true)
      if (m.kind === 'segment') {
        expect(m.id).toMatch(/^yolo11[smlx]-seg$/)
      } else if (m.kind === 'pose') {
        expect(m.id).toMatch(/^yolo11[smlx]-pose$/)
      } else {
        expect(m.id).toMatch(/^yolo11[smlx]$/)
      }
    }
  })

  it('下载后的文件名去掉 .onnx 即模型 id，能被目录扫描按 kind 识别', () => {
    for (const m of YOLO_CATALOG) {
      const idFromFile = m.fileName.replace(/\.onnx$/, '')
      expect(idFromFile).toBe(m.id)
      // 与主进程 kindOfModelId 规则保持一致：
      // 含 seg → segment；含 pose → pose；否则 detect
      const inferred = idFromFile.toLowerCase().includes('seg')
        ? 'segment'
        : idFromFile.toLowerCase().includes('pose')
          ? 'pose'
          : 'detect'
      expect(inferred).toBe(m.kind)
    }
  })

  it('识别真实 PNG / JPEG 与伪装成 .png 后缀的 WebP 字节头（imageDecoder）', () => {
    const pngHead = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const jpegHead = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    // RIFF....WEBPVP8 （如伪装成 Assets/2.png 的 WebP 文件）
    const disguisedWebpHead = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x6c, 0x0b, 0x01, 0x00, 0x57, 0x45, 0x42, 0x50
    ])

    expect(isPngBytes(pngHead)).toBe(true)
    expect(isBuiltinDecodableBytes(pngHead)).toBe(true)
    expect(isJpegBytes(jpegHead)).toBe(true)
    expect(isBuiltinDecodableBytes(jpegHead)).toBe(true)

    expect(isWebpBytes(disguisedWebpHead)).toBe(true)
    expect(isPngBytes(disguisedWebpHead)).toBe(false)
    expect(isBuiltinDecodableBytes(disguisedWebpHead)).toBe(false)

    const webpDataUrl = `data:image/png;base64,${Buffer.from(disguisedWebpHead).toString('base64')}`
    expect(isBuiltinDecodableDataUrl(webpDataUrl)).toBe(false)

    const realPngDataUrl = `data:image/png;base64,${Buffer.from(pngHead).toString('base64')}`
    expect(isBuiltinDecodableDataUrl(realPngDataUrl)).toBe(true)
  })
})
